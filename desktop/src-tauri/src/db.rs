//! The practice database: one SQLCipher file, opened with a raw 256-bit key that the UI
//! unwraps from the keyring. All SQL lives in the TypeScript core; this module only runs it.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};

pub const DB_FILE: &str = "practice.db";

#[derive(Default)]
pub struct DbState {
    conn: Mutex<Option<Connection>>,
}

#[derive(Debug, Deserialize)]
pub struct Statement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Value>,
}

#[derive(Debug, Serialize)]
pub struct ExecResult {
    pub changes: usize,
}

fn key_pragma(key_hex: &str) -> AppResult<Zeroizing<String>> {
    if key_hex.len() != 64 || !key_hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(AppError::Invalid("key must be 32 bytes of hex".into()));
    }
    Ok(Zeroizing::new(format!("x'{key_hex}'")))
}

/// Opens (or creates) an SQLCipher database and proves the key is right.
pub fn open_at(path: &Path, key_hex: &str, create: bool) -> AppResult<Connection> {
    if !create && !path.exists() {
        return Err(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "no practice database on this device",
        )));
    }
    let mut flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    if create {
        flags |= OpenFlags::SQLITE_OPEN_CREATE;
    }
    let conn = Connection::open_with_flags(path, flags)?;
    let pragma = key_pragma(key_hex)?;
    conn.pragma_update(None, "key", pragma.as_str())?;
    // Reading the schema fails with "file is not a database" when the key is wrong.
    if let Err(e) = conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
        r.get::<_, i64>(0)
    }) {
        return Err(match e {
            rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::NotADatabase => {
                AppError::WrongKey
            }
            other => AppError::Db(other),
        });
    }
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(conn)
}

fn to_sql(v: &Value) -> AppResult<SqlValue> {
    Ok(match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(i64::from(*b)),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else {
                SqlValue::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        Value::String(s) => SqlValue::Text(s.clone()),
        Value::Array(_) | Value::Object(_) => {
            return Err(AppError::Invalid(
                "parameters must be scalars; serialise JSON in the caller".into(),
            ))
        }
    })
}

fn from_sql(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::Number(i.into()),
        ValueRef::Real(f) => Number::from_f64(f)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(_) => Value::Null,
    }
}

pub fn exec_on(conn: &Connection, sql: &str, params: &[Value]) -> AppResult<ExecResult> {
    let values = params.iter().map(to_sql).collect::<AppResult<Vec<_>>>()?;
    let mut stmt = conn.prepare_cached(sql)?;
    let changes = stmt.execute(params_from_iter(values))?;
    Ok(ExecResult { changes })
}

pub fn query_on(
    conn: &Connection,
    sql: &str,
    params: &[Value],
) -> AppResult<Vec<Map<String, Value>>> {
    let values = params.iter().map(to_sql).collect::<AppResult<Vec<_>>>()?;
    let mut stmt = conn.prepare_cached(sql)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows = stmt.query(params_from_iter(values))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut obj = Map::with_capacity(names.len());
        for (i, name) in names.iter().enumerate() {
            obj.insert(name.clone(), from_sql(row.get_ref(i)?));
        }
        out.push(obj);
    }
    Ok(out)
}

/// Runs statements in one transaction; any failure rolls all of them back.
pub fn batch_on(conn: &mut Connection, statements: &[Statement]) -> AppResult<usize> {
    let tx = conn.transaction()?;
    let mut changes = 0;
    for s in statements {
        changes += exec_on(&tx, &s.sql, &s.params)?.changes;
    }
    tx.commit()?;
    Ok(changes)
}

/// Runs a whole script (used for migrations) in one transaction.
pub fn script_on(conn: &mut Connection, sql: &str) -> AppResult<()> {
    let tx = conn.transaction()?;
    tx.execute_batch(sql)?;
    tx.commit()?;
    Ok(())
}

impl DbState {
    pub fn open(&self, dir: &Path, key_hex: &str, create: bool) -> AppResult<()> {
        std::fs::create_dir_all(dir)?;
        let conn = open_at(&db_path(dir), key_hex, create)?;
        *self.conn.lock().expect("db mutex poisoned") = Some(conn);
        Ok(())
    }

    pub fn close(&self) {
        // Dropping the connection releases SQLCipher's key material.
        self.conn.lock().expect("db mutex poisoned").take();
    }

    pub fn with<T>(&self, f: impl FnOnce(&mut Connection) -> AppResult<T>) -> AppResult<T> {
        let mut guard = self.conn.lock().expect("db mutex poisoned");
        let conn = guard.as_mut().ok_or(AppError::NotOpen)?;
        f(conn)
    }
}

pub fn db_path(dir: &Path) -> PathBuf {
    dir.join(DB_FILE)
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    const OTHER: &str = "ff0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

    #[test]
    fn creates_reopens_and_rejects_wrong_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        {
            let mut c = open_at(&path, KEY, true).unwrap();
            script_on(
                &mut c,
                "CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('Inês — sleep routine');",
            )
            .unwrap();
        }
        let c = open_at(&path, KEY, false).unwrap();
        let rows = query_on(&c, "SELECT x FROM t", &[]).unwrap();
        assert_eq!(rows[0]["x"], Value::String("Inês — sleep routine".into()));
        drop(c);
        assert!(matches!(
            open_at(&path, OTHER, false),
            Err(AppError::WrongKey)
        ));
    }

    #[test]
    fn file_on_disk_holds_no_plaintext() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        let mut c = open_at(&path, KEY, true).unwrap();
        script_on(
            &mut c,
            "CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('PLAINTEXT-CANARY-123');",
        )
        .unwrap();
        let needle = b"PLAINTEXT-CANARY-123";
        let has_plaintext = |p: &Path| {
            std::fs::read(p)
                .map(|b| b.windows(needle.len()).any(|w| w == needle))
                .unwrap_or(false)
        };
        // Before and after the write-ahead log is folded into the main file.
        assert!(!has_plaintext(&path) && !has_plaintext(&path.with_extension("db-wal")));
        c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").unwrap();
        drop(c);
        let bytes = std::fs::read(&path).unwrap();
        assert!(!has_plaintext(&path));
        assert!(!bytes.starts_with(b"SQLite format 3"));
    }

    #[test]
    fn batch_rolls_back_on_error() {
        let dir = tempfile::tempdir().unwrap();
        let mut c = open_at(&dir.path().join("t.db"), KEY, true).unwrap();
        script_on(&mut c, "CREATE TABLE t (x INTEGER PRIMARY KEY);").unwrap();
        let stmts = vec![
            Statement {
                sql: "INSERT INTO t VALUES (?)".into(),
                params: vec![1.into()],
            },
            Statement {
                sql: "INSERT INTO t VALUES (?)".into(),
                params: vec![1.into()],
            },
        ];
        assert!(batch_on(&mut c, &stmts).is_err());
        let rows = query_on(&c, "SELECT count(*) AS n FROM t", &[]).unwrap();
        assert_eq!(rows[0]["n"], Value::Number(0.into()));
    }

    #[test]
    fn rejects_malformed_key() {
        assert!(key_pragma("abc").is_err());
        assert!(key_pragma(&"zz".repeat(32)).is_err());
    }
}

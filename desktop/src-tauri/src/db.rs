//! Project databases: one SQLCipher file per project (`projects/<id>/project.db`), opened with
//! a raw 256-bit key that the UI derives from the library key. One project is open at a time.
//! All SQL lives in the TypeScript core; this module only runs it.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};
use crate::files;

struct OpenDb {
    project: String,
    conn: Connection,
}

#[derive(Default)]
pub struct DbState {
    inner: Mutex<Option<OpenDb>>,
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
    if !create && !path.is_file() {
        return Err(AppError::not_found("no project database at this path"));
    }
    let pragma = key_pragma(key_hex)?;
    let mut flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    if create {
        flags |= OpenFlags::SQLITE_OPEN_CREATE;
    }
    let conn = Connection::open_with_flags(path, flags)?;
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
    fn lock(&self) -> std::sync::MutexGuard<'_, Option<OpenDb>> {
        // A panic while the lock was held leaves no half-done state worth refusing over:
        // SQLite rolls back an unfinished transaction. Keep serving instead of panicking forever.
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Opens a project's database, closing whichever one was open (even when this fails, so
    /// the UI never keeps writing into the project it meant to leave).
    pub fn open(&self, data: &Path, project: &str, key_hex: &str, create: bool) -> AppResult<()> {
        let path = files::project_db(data, project)?;
        // Checked before anything touches the disk.
        key_pragma(key_hex)?;
        let mut guard = self.lock();
        guard.take();
        let dir = path
            .parent()
            .ok_or_else(|| AppError::Invalid("bad project path".into()))?;
        let existed = dir.exists();
        if !create && !path.is_file() {
            return Err(AppError::not_found("no such project"));
        }
        std::fs::create_dir_all(dir)?;
        match open_at(&path, key_hex, create) {
            Ok(conn) => {
                *guard = Some(OpenDb {
                    project: project.to_owned(),
                    conn,
                });
                Ok(())
            }
            Err(e) => {
                // A failed create must not leave a folder that looks like a project.
                if !existed {
                    let _ = std::fs::remove_dir_all(dir);
                }
                Err(e)
            }
        }
    }

    pub fn close(&self) {
        // Dropping the connection releases SQLCipher's key material.
        self.lock().take();
    }

    /// Closes the database if it belongs to `project` (before that project is erased).
    pub fn close_project(&self, project: &str) {
        let mut guard = self.lock();
        if guard.as_ref().is_some_and(|o| o.project == project) {
            guard.take();
        }
    }

    #[cfg(test)]
    pub fn open_project(&self) -> Option<String> {
        self.lock().as_ref().map(|o| o.project.clone())
    }

    #[cfg(test)]
    pub fn with<T>(&self, f: impl FnOnce(&mut Connection) -> AppResult<T>) -> AppResult<T> {
        self.with_project(None, f)
    }

    /// Runs `f` on the open database, but only if it is `project` (when given). A call that was
    /// meant for a project the UI has since left fails instead of landing in the next one:
    /// IPC calls are not guaranteed to arrive in the order they were made.
    pub fn with_project<T>(
        &self,
        project: Option<&str>,
        f: impl FnOnce(&mut Connection) -> AppResult<T>,
    ) -> AppResult<T> {
        let mut guard = self.lock();
        let open = guard.as_mut().ok_or(AppError::NotOpen)?;
        if project.is_some_and(|p| p != open.project) {
            return Err(AppError::NotOpen);
        }
        f(&mut open.conn)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    const OTHER: &str = "ff0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    const P1: &str = "6f1e0c52-7a3b-4c8d-9e0f-112233445566";
    const P2: &str = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

    fn contains(p: &Path, needle: &[u8]) -> bool {
        std::fs::read(p)
            .map(|b| b.windows(needle.len()).any(|w| w == needle))
            .unwrap_or(false)
    }

    #[test]
    fn creates_reopens_and_rejects_wrong_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        {
            let mut c = open_at(&path, KEY, true).unwrap();
            script_on(
                &mut c,
                "CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('Inês — entrevista 3 🎙️ 日本語');",
            )
            .unwrap();
        }
        let c = open_at(&path, KEY, false).unwrap();
        let rows = query_on(&c, "SELECT x FROM t", &[]).unwrap();
        assert_eq!(
            rows[0]["x"],
            Value::String("Inês — entrevista 3 🎙️ 日本語".into())
        );
        drop(c);
        assert!(matches!(
            open_at(&path, OTHER, false),
            Err(AppError::WrongKey)
        ));
        // Uppercase hex is the same key.
        assert!(open_at(&path, &KEY.to_uppercase(), false).is_ok());
    }

    #[test]
    fn opening_a_missing_database_without_create_is_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let err = open_at(&dir.path().join("none.db"), KEY, false).unwrap_err();
        assert_eq!(err.code(), "NOT_FOUND");
        assert!(!dir.path().join("none.db").exists());
    }

    #[test]
    fn file_on_disk_holds_no_plaintext() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("project.db");
        let wal = dir.path().join("project.db-wal");
        let mut c = open_at(&path, KEY, true).unwrap();
        script_on(
            &mut c,
            "CREATE TABLE coding (text TEXT); INSERT INTO coding VALUES ('PLAINTEXT-CANARY-123');",
        )
        .unwrap();
        let needle = b"PLAINTEXT-CANARY-123";
        // While the write-ahead log holds the change, and after it is folded into the main file.
        assert!(std::fs::metadata(&wal).unwrap().len() > 0, "WAL in use");
        assert!(!contains(&path, needle) && !contains(&wal, needle));
        assert!(!contains(&wal, b"coding"));
        c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").unwrap();
        drop(c);
        let bytes = std::fs::read(&path).unwrap();
        assert!(!contains(&path, needle));
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
        assert_eq!(batch_on(&mut c, &[]).unwrap(), 0);
    }

    #[test]
    fn script_rolls_back_on_error() {
        let dir = tempfile::tempdir().unwrap();
        let mut c = open_at(&dir.path().join("t.db"), KEY, true).unwrap();
        assert!(script_on(&mut c, "CREATE TABLE a (x); CREATE TABLE a (x);").is_err());
        let rows = query_on(&c, "SELECT count(*) AS n FROM sqlite_master", &[]).unwrap();
        assert_eq!(rows[0]["n"], Value::Number(0.into()));
    }

    #[test]
    fn parameters_and_values_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let mut c = open_at(&dir.path().join("t.db"), KEY, true).unwrap();
        script_on(&mut c, "CREATE TABLE t (a, b, c, d, e);").unwrap();
        let big = "ç".repeat(1_000_000);
        let r = exec_on(
            &c,
            "INSERT INTO t VALUES (?, ?, ?, ?, ?)",
            &[
                Value::Null,
                Value::from(9_007_199_254_740_993_i64),
                Value::from(1.5),
                Value::from(true),
                Value::from(big.clone()),
            ],
        )
        .unwrap();
        assert_eq!(r.changes, 1);
        let rows = query_on(&c, "SELECT * FROM t", &[]).unwrap();
        let row = &rows[0];
        assert_eq!(row["a"], Value::Null);
        assert_eq!(row["b"], Value::from(9_007_199_254_740_993_i64));
        assert_eq!(row["c"], Value::from(1.5));
        assert_eq!(row["d"], Value::from(1));
        assert_eq!(row["e"].as_str().unwrap().len(), big.len());
        // Arrays and objects must be serialised by the caller.
        let err = exec_on(
            &c,
            "INSERT INTO t (a) VALUES (?)",
            &[serde_json::json!([1])],
        );
        assert_eq!(err.unwrap_err().code(), "INVALID");
        // Column names are kept as written, including aliases with non-ASCII letters.
        let rows = query_on(&c, "SELECT 1 AS \"número\"", &[]).unwrap();
        assert_eq!(rows[0]["número"], Value::from(1));
    }

    #[test]
    fn rejects_malformed_key() {
        assert!(key_pragma("abc").is_err());
        assert!(key_pragma(&"zz".repeat(32)).is_err());
        assert!(key_pragma(&format!("{KEY}'")).is_err());
        assert!(key_pragma("").is_err());
    }

    #[test]
    fn two_projects_with_different_keys() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path();
        let db = DbState::default();
        assert_eq!(db.with(|_| Ok(())).unwrap_err().code(), "DB_NOT_OPEN");

        db.open(data, P1, KEY, true).unwrap();
        db.with(|c| script_on(c, "CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('one');"))
            .unwrap();
        // Opening the second project closes the first.
        db.open(data, P2, OTHER, true).unwrap();
        assert_eq!(db.open_project().as_deref(), Some(P2));
        db.with(|c| script_on(c, "CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('two');"))
            .unwrap();

        assert_eq!(
            files::list_projects(data).unwrap(),
            vec![P1.to_string(), P2.to_string()]
        );

        // Each project only opens with its own key; a failed open leaves nothing open.
        assert!(matches!(
            db.open(data, P1, OTHER, false),
            Err(AppError::WrongKey)
        ));
        assert_eq!(db.open_project(), None);
        assert_eq!(db.with(|_| Ok(())).unwrap_err().code(), "DB_NOT_OPEN");
        // The wrong key did not damage the folder.
        assert!(files::project_exists(data, P1).unwrap());

        db.open(data, P1, KEY, false).unwrap();
        let rows = db.with(|c| query_on(c, "SELECT x FROM t", &[])).unwrap();
        assert_eq!(rows[0]["x"], Value::from("one"));
        db.open(data, P2, OTHER, false).unwrap();
        let rows = db.with(|c| query_on(c, "SELECT x FROM t", &[])).unwrap();
        assert_eq!(rows[0]["x"], Value::from("two"));
    }

    #[test]
    fn erasing_one_project_keeps_the_other() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path();
        let db = DbState::default();
        db.open(data, P2, OTHER, true).unwrap();
        db.with(|c| script_on(c, "CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('kept');"))
            .unwrap();
        db.open(data, P1, KEY, true).unwrap();
        db.with(|c| script_on(c, "CREATE TABLE t (x TEXT);"))
            .unwrap();
        files::write_atomic(&files::blob_file(data, P1, "b1").unwrap(), b"sealed").unwrap();

        // Closing another project is a no-op; closing the open one closes it.
        db.close_project(P2);
        assert_eq!(db.open_project().as_deref(), Some(P1));
        db.close_project(P1);
        assert_eq!(db.open_project(), None);
        files::erase_project(data, P1).unwrap();

        assert_eq!(files::list_projects(data).unwrap(), vec![P2.to_string()]);
        assert!(!data.join("projects").join(P1).exists());
        assert_eq!(
            db.open(data, P1, KEY, false).unwrap_err().code(),
            "NOT_FOUND"
        );
        db.open(data, P2, OTHER, false).unwrap();
        let rows = db.with(|c| query_on(c, "SELECT x FROM t", &[])).unwrap();
        assert_eq!(rows[0]["x"], Value::from("kept"));
    }

    #[test]
    fn project_folders_hold_no_plaintext() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path();
        let db = DbState::default();
        db.open(data, P1, KEY, true).unwrap();
        db.with(|c| {
            script_on(c, "CREATE TABLE doctext (text TEXT);")?;
            exec_on(
                c,
                "INSERT INTO doctext VALUES (?)",
                &[Value::from("Participant CANARY-PT-é-42 said…")],
            )
        })
        .unwrap();
        let needle = "CANARY-PT-é-42".as_bytes();
        let check_all = || {
            for e in walkdir::WalkDir::new(data) {
                let e = e.unwrap();
                if e.file_type().is_file() {
                    assert!(!contains(e.path(), needle), "{}", e.path().display());
                    assert!(!contains(e.path(), b"doctext"), "{}", e.path().display());
                }
            }
        };
        check_all();
        db.with(|c| Ok(c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?))
            .unwrap();
        db.close();
        check_all();
    }

    #[test]
    fn a_created_project_is_on_disk_at_once() {
        // A database file with no pages opens with any key; creating one must write its
        // (encrypted) header so a later wrong key is detected even if nothing was written.
        let dir = tempfile::tempdir().unwrap();
        let db = DbState::default();
        db.open(dir.path(), P1, KEY, true).unwrap();
        db.close();
        assert!(matches!(
            db.open(dir.path(), P1, OTHER, false),
            Err(AppError::WrongKey)
        ));
    }

    #[test]
    fn bad_ids_and_keys_touch_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let db = DbState::default();
        for bad in ["..", "../escape", "a/b", "A", ".x", ""] {
            assert_eq!(
                db.open(dir.path(), bad, KEY, true).unwrap_err().code(),
                "INVALID"
            );
        }
        assert_eq!(
            db.open(dir.path(), P1, "short", true).unwrap_err().code(),
            "INVALID"
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn calls_for_another_project_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let db = DbState::default();
        db.open(dir.path(), P1, KEY, true).unwrap();
        db.with_project(Some(P1), |c| script_on(c, "CREATE TABLE t (x);"))
            .unwrap();
        db.open(dir.path(), P2, OTHER, true).unwrap();
        let err = db
            .with_project(Some(P1), |c| script_on(c, "CREATE TABLE u (x);"))
            .unwrap_err();
        assert_eq!(err.code(), "DB_NOT_OPEN");
        // Nothing reached the second project.
        let rows = db
            .with_project(Some(P2), |c| {
                query_on(c, "SELECT name FROM sqlite_master", &[])
            })
            .unwrap();
        assert!(rows.is_empty());
        // Closing for a project that is not open leaves the open one alone.
        db.close_project(P1);
        assert_eq!(db.open_project().as_deref(), Some(P2));
    }

    #[test]
    fn reopening_the_same_project_works() {
        let dir = tempfile::tempdir().unwrap();
        let db = DbState::default();
        db.open(dir.path(), P1, KEY, true).unwrap();
        db.with(|c| script_on(c, "CREATE TABLE t (x);")).unwrap();
        db.open(dir.path(), P1, KEY, false).unwrap();
        db.open(dir.path(), P1, KEY, true).unwrap();
        let rows = db
            .with(|c| query_on(c, "SELECT name FROM sqlite_master", &[]))
            .unwrap();
        assert_eq!(rows.len(), 1);
    }
}

//! File access for the UI. Three areas:
//! - app files: small named files in the app data directory (keyring, device preferences);
//! - blobs: attachment files, already encrypted by the UI before they arrive here;
//! - user files: paths the therapist picked in a system dialog (backups, exports, imports).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::error::{AppError, AppResult};

pub const BLOB_DIR: &str = "blobs";

fn valid_name(name: &str) -> bool {
    let b = name.as_bytes();
    !b.is_empty()
        && b.len() <= 64
        && b[0].is_ascii_alphanumeric()
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"._-".contains(c))
        && !name.contains("..")
}

pub fn app_file(dir: &Path, name: &str) -> AppResult<PathBuf> {
    if !valid_name(name) {
        return Err(AppError::Invalid(format!("bad app file name: {name}")));
    }
    Ok(dir.join(name))
}

pub fn blob_file(dir: &Path, id: &str) -> AppResult<PathBuf> {
    if !valid_name(id) {
        return Err(AppError::Invalid("bad blob id".into()));
    }
    Ok(dir.join(BLOB_DIR).join(id))
}

/// Writes through a temporary file and a rename so a crash never leaves half a file.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(format!(
        "{}tmp",
        path.extension()
            .map(|e| format!("{}.", e.to_string_lossy()))
            .unwrap_or_default()
    ));
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

pub fn read_optional(path: &Path) -> AppResult<Option<Vec<u8>>> {
    match fs::read(path) {
        Ok(b) => Ok(Some(b)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[derive(Debug, Serialize)]
pub struct Entry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_ms: u64,
    pub depth: usize,
}

/// Lists a directory, optionally recursively. Hidden files are skipped; symlinks are not followed.
pub fn list(path: &Path, recursive: bool, max_entries: usize) -> AppResult<Vec<Entry>> {
    let max_depth = if recursive { 16 } else { 1 };
    let mut out = Vec::new();
    let walker = walkdir::WalkDir::new(path)
        .min_depth(1)
        .max_depth(max_depth)
        .follow_links(false)
        .sort_by_file_name()
        .into_iter()
        .filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.'));
    for entry in walker {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue, // unreadable entries are skipped, not fatal
        };
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        out.push(Entry {
            path: entry.path().to_string_lossy().into_owned(),
            name: entry.file_name().to_string_lossy().into_owned(),
            is_dir: meta.is_dir(),
            size: if meta.is_dir() { 0 } else { meta.len() },
            modified_ms: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            depth: entry.depth(),
        });
        if out.len() >= max_entries {
            break;
        }
    }
    Ok(out)
}

/// Removes the whole practice from this device: database, keyring and attachments.
pub fn erase_practice(dir: &Path) -> AppResult<()> {
    for name in [
        crate::db::DB_FILE,
        "practice.db-wal",
        "practice.db-shm",
        "keyring.json",
    ] {
        match fs::remove_file(dir.join(name)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    match fs::remove_dir_all(dir.join(BLOB_DIR)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_confined() {
        assert!(valid_name("keyring.json"));
        assert!(valid_name("0b7c2d9e-1f4a-4c1e-9d2b-3a4f5e6d7c8b"));
        for bad in ["", "../x", "a/b", "A.json", ".hidden", "a\\b", "x..y"] {
            assert!(!valid_name(bad), "{bad}");
        }
    }

    #[test]
    fn atomic_write_and_list() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("sub").join("Inês notes.txt");
        write_atomic(&p, b"hello").unwrap();
        write_atomic(&p, b"hello again").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"hello again");
        fs::write(dir.path().join(".hidden"), b"x").unwrap();
        let entries = list(dir.path(), true, 100).unwrap();
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["sub", "Inês notes.txt"]);
        assert!(entries[0].is_dir);
        assert_eq!(entries[1].size, 11);
    }

    #[test]
    fn erase_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("keyring.json"), b"{}").unwrap();
        fs::create_dir_all(dir.path().join(BLOB_DIR)).unwrap();
        erase_practice(dir.path()).unwrap();
        erase_practice(dir.path()).unwrap();
        assert!(!dir.path().join("keyring.json").exists());
    }
}

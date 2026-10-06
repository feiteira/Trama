//! File access for the UI. Three areas:
//! - app files: a few named files in the app data directory (keyring, project list, device
//!   preferences);
//! - projects: `projects/<projectId>/project.db` and `projects/<projectId>/blobs/<blobId>`
//!   (original documents and media, already encrypted by the UI before they arrive here);
//! - user files: paths the researcher picked in a system dialog (imports, exports, backups).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::error::{AppError, AppResult};

pub const PROJECTS_DIR: &str = "projects";
pub const BLOB_DIR: &str = "blobs";
pub const DB_FILE: &str = "project.db";
pub const KEYRING_FILE: &str = "keyring.json";
pub const LIBRARY_FILE: &str = "library.json";
pub const PREFS_FILE: &str = "prefs.json";

/// The only names the UI may read or write in the app data directory.
const APP_FILES: [&str; 3] = [PREFS_FILE, KEYRING_FILE, LIBRARY_FILE];

/// Project ids, blob ids and app file names all become path components, so they are held to
/// a strict alphabet: no separators, no leading dot, no "..", no upper case (which would
/// alias on case-insensitive file systems), and short enough for any file system.
pub fn valid_name(name: &str) -> bool {
    let b = name.as_bytes();
    !b.is_empty()
        && b.len() <= 64
        && b[0].is_ascii_alphanumeric()
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"._-".contains(c))
        && !name.contains("..")
}

fn check(kind: &str, name: &str) -> AppResult<()> {
    if valid_name(name) {
        Ok(())
    } else {
        // The bad value is not echoed: it could be anything the UI was handed.
        Err(AppError::Invalid(format!("bad {kind}")))
    }
}

pub fn app_file(dir: &Path, name: &str) -> AppResult<PathBuf> {
    if !APP_FILES.contains(&name) {
        return Err(AppError::Invalid(format!("not an app file: {name}")));
    }
    Ok(dir.join(name))
}

pub fn projects_root(dir: &Path) -> PathBuf {
    dir.join(PROJECTS_DIR)
}

pub fn project_dir(dir: &Path, project: &str) -> AppResult<PathBuf> {
    check("project id", project)?;
    Ok(projects_root(dir).join(project))
}

pub fn project_db(dir: &Path, project: &str) -> AppResult<PathBuf> {
    Ok(project_dir(dir, project)?.join(DB_FILE))
}

pub fn blob_file(dir: &Path, project: &str, id: &str) -> AppResult<PathBuf> {
    let project_dir = project_dir(dir, project)?;
    check("blob id", id)?;
    Ok(project_dir.join(BLOB_DIR).join(id))
}

/// A blob is only written into a project that exists, so a stray call cannot leave behind a
/// folder that no project owns (and that the project list would never show).
pub fn blob_file_for_write(dir: &Path, project: &str, id: &str) -> AppResult<PathBuf> {
    let path = blob_file(dir, project, id)?;
    if !project_dir(dir, project)?.is_dir() {
        return Err(AppError::not_found("no such project"));
    }
    Ok(path)
}

/// Distinguishes temporary files of concurrent writes to the same path.
static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// How old a temporary file of `write_atomic` must be before another write in the same folder
/// treats it as left over (a crash, a drive unplugged mid-write) and removes it.
const STALE_TMP: std::time::Duration = std::time::Duration::from_secs(60 * 60);

/// True for a name `write_atomic` gives its temporary files: `.{name}.{pid}-{counter}.tmp`.
fn is_atomic_tmp(name: &str) -> bool {
    let Some(rest) = name.strip_prefix('.').and_then(|n| n.strip_suffix(".tmp")) else {
        return false;
    };
    let Some((head, tail)) = rest.rsplit_once('.') else {
        return false;
    };
    let Some((pid, n)) = tail.split_once('-') else {
        return false;
    };
    !head.is_empty()
        && !pid.is_empty()
        && !n.is_empty()
        && pid.bytes().all(|b| b.is_ascii_digit())
        && n.bytes().all(|b| b.is_ascii_digit())
}

/// Removes temporary files of earlier `write_atomic` calls in `dir` that are older than
/// STALE_TMP. Listings skip dot-files, so nothing else would ever find them; each would stay a
/// full-size hidden copy (of a backup, say) that sync clients keep uploading.
fn remove_stale_tmps(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if !is_atomic_tmp(&name.to_string_lossy()) {
            continue;
        }
        let stale = entry
            .metadata()
            .ok()
            .filter(|m| m.is_file())
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age > STALE_TMP);
        if stale {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Writes through a temporary file and a rename so a crash never leaves half a file. The
/// temporary name starts with a dot, so listings skip it and it can never be a valid id.
/// Temporary files an earlier write left behind in the same folder are removed once stale.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Invalid("path has no parent folder".into()))?;
    let name = path
        .file_name()
        .ok_or_else(|| AppError::Invalid("path has no file name".into()))?;
    fs::create_dir_all(parent)?;
    remove_stale_tmps(parent);
    let tmp = parent.join(format!(
        ".{}.{}-{}.tmp",
        name.to_string_lossy(),
        std::process::id(),
        TMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let written = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        // Rust's rename replaces an existing file on Windows too (MOVEFILE_REPLACE_EXISTING).
        fs::rename(&tmp, path)
    })();
    if let Err(e) = written {
        let _ = fs::remove_file(&tmp);
        return Err(e.into());
    }
    // Makes the rename itself durable: without it a power cut can bring back the old file.
    #[cfg(unix)]
    if let Ok(d) = fs::File::open(parent) {
        let _ = d.sync_all();
    }
    Ok(())
}

pub fn read_optional(path: &Path) -> AppResult<Option<Vec<u8>>> {
    match fs::read(path) {
        Ok(b) => Ok(Some(b)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

fn remove_file_if_exists(path: &Path) -> AppResult<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

fn remove_dir_if_exists(path: &Path) -> AppResult<()> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

pub fn remove_blob(dir: &Path, project: &str, id: &str) -> AppResult<()> {
    remove_file_if_exists(&blob_file(dir, project, id)?)
}

/// Ids of a project's blobs: the regular files of its blob folder with a name a blob id can
/// have (temporary files of an unfinished write, links and anything else are left out).
pub fn list_blobs(dir: &Path, project: &str) -> AppResult<Vec<String>> {
    let entries = match fs::read_dir(project_dir(dir, project)?.join(BLOB_DIR)) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if valid_name(&name) {
            out.push(name);
        }
    }
    out.sort();
    Ok(out)
}

/// Ids of the project folders that hold a database. Anything else under `projects/` (a
/// half-created folder, a stray file, a name the UI could never have made) is ignored.
pub fn list_projects(dir: &Path) -> AppResult<Vec<String>> {
    let entries = match fs::read_dir(projects_root(dir)) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry?;
        // file_type() does not follow symlinks: a linked folder is not one of ours.
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if valid_name(&name) && entry.path().join(DB_FILE).is_file() {
            out.push(name);
        }
    }
    out.sort();
    Ok(out)
}

pub fn project_exists(dir: &Path, project: &str) -> AppResult<bool> {
    Ok(project_db(dir, project)?.is_file())
}

/// Removes a project's folder: database, write-ahead log and blobs. Idempotent. The caller
/// closes the database first (Windows refuses to delete an open file).
pub fn erase_project(dir: &Path, project: &str) -> AppResult<()> {
    remove_dir_if_exists(&project_dir(dir, project)?)
}

/// Removes the library from this device: keyring, project list and every project. Device
/// preferences (language, theme) stay. The keyring goes first: without it nothing that is
/// left can be decrypted, should a later step fail.
pub fn erase_all(dir: &Path) -> AppResult<()> {
    remove_file_if_exists(&dir.join(KEYRING_FILE))?;
    remove_file_if_exists(&dir.join(LIBRARY_FILE))?;
    // Temporary files a crash in the middle of write_atomic may have left behind.
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let leftover = [KEYRING_FILE, LIBRARY_FILE]
                .iter()
                .any(|f| name.starts_with(&format!(".{f}.")) && name.ends_with(".tmp"));
            if leftover {
                remove_file_if_exists(&entry.path())?;
            }
        }
    }
    remove_dir_if_exists(&projects_root(dir))
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
    if !path.is_dir() {
        // walkdir would report a missing folder as an error entry, which is skipped below and
        // would look like an empty folder.
        return Err(AppError::not_found("no such folder"));
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "0b7c2d9e-1f4a-4c1e-9d2b-3a4f5e6d7c8b";

    #[test]
    fn names_are_confined() {
        assert!(valid_name("keyring.json"));
        assert!(valid_name(ID));
        assert!(valid_name(&"a".repeat(64)));
        for bad in [
            "", "../x", "..", ".", "a/b", "a\\b", "A.json", ".hidden", "-x", "_x", "x..y", "x\0y",
            "x y", "é", "ａ", // fullwidth a
            "c:", "/etc",
        ] {
            assert!(!valid_name(bad), "{bad:?}");
        }
        assert!(!valid_name(&"a".repeat(65)));
    }

    #[test]
    fn only_known_app_files() {
        let dir = Path::new("/data");
        for ok in ["prefs.json", "keyring.json", "library.json"] {
            assert_eq!(app_file(dir, ok).unwrap(), dir.join(ok));
        }
        for bad in [
            "project.db",
            "other.json",
            "../keyring.json",
            "projects",
            "",
        ] {
            assert!(app_file(dir, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn project_and_blob_paths_reject_traversal() {
        let dir = Path::new("/data");
        assert_eq!(
            blob_file(dir, ID, "b1").unwrap(),
            dir.join("projects").join(ID).join("blobs").join("b1")
        );
        for bad in ["..", "../other", "a/b", "a\\b", ".x", "X"] {
            assert!(project_dir(dir, bad).is_err(), "{bad}");
            assert!(blob_file(dir, bad, "b1").is_err(), "{bad}");
            assert!(blob_file(dir, ID, bad).is_err(), "{bad}");
            assert!(erase_project(dir, bad).is_err(), "{bad}");
            assert!(project_exists(dir, bad).is_err(), "{bad}");
        }
        let err = project_dir(dir, "../x").unwrap_err();
        assert_eq!(err.code(), "INVALID");
    }

    #[test]
    fn atomic_write_and_list() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("sub").join("Inês — notas 日本.txt");
        write_atomic(&p, b"hello").unwrap();
        write_atomic(&p, b"hello again").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"hello again");
        write_atomic(&dir.path().join("empty.bin"), b"").unwrap();
        fs::write(dir.path().join(".hidden"), b"x").unwrap();
        let entries = list(dir.path(), true, 100).unwrap();
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["empty.bin", "sub", "Inês — notas 日本.txt"]);
        assert!(entries[1].is_dir);
        assert_eq!(entries[2].size, 11);
        assert_eq!(entries[2].depth, 2);
        // No temporary files left behind.
        let all: Vec<_> = fs::read_dir(dir.path().join("sub")).unwrap().collect();
        assert_eq!(all.len(), 1);
        // Non-recursive and capped listings.
        assert_eq!(list(dir.path(), false, 100).unwrap().len(), 2);
        assert_eq!(list(dir.path(), true, 1).unwrap().len(), 1);
    }

    #[test]
    fn stale_temporary_files_are_removed_by_the_next_write() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir
            .path()
            .join(".Trama backup ab12cd 2026-10-05 093015.trama.4242-7.tmp");
        let fresh = dir
            .path()
            .join(".Trama backup ab12cd 2026-10-05 103015.trama.4243-0.tmp");
        let other = dir.path().join(".hidden.tmp");
        for p in [&old, &fresh, &other] {
            fs::write(p, b"x").unwrap();
        }
        let two_hours_ago = std::time::SystemTime::now() - std::time::Duration::from_secs(7200);
        for p in [&old, &other] {
            fs::File::options()
                .write(true)
                .open(p)
                .unwrap()
                .set_modified(two_hours_ago)
                .unwrap();
        }
        assert!(is_atomic_tmp(&old.file_name().unwrap().to_string_lossy()));
        assert!(!is_atomic_tmp(".hidden.tmp"));
        assert!(!is_atomic_tmp("Trama backup.trama.1-2.tmp"));
        write_atomic(
            &dir.path()
                .join("Trama backup ab12cd 2026-10-06 093015.trama"),
            b"new",
        )
        .unwrap();
        assert!(!old.exists(), "a stale temporary file is removed");
        assert!(fresh.exists(), "one that may still be written is kept");
        assert!(other.exists(), "files of another shape are never touched");
    }

    #[test]
    fn listing_a_missing_folder_is_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let err = list(&dir.path().join("nope"), false, 10).unwrap_err();
        assert_eq!(err.code(), "NOT_FOUND");
    }

    #[test]
    fn atomic_write_of_a_large_file() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("big.bin");
        let bytes: Vec<u8> = (0..20 * 1024 * 1024).map(|i| (i % 251) as u8).collect();
        write_atomic(&p, &bytes).unwrap();
        assert_eq!(fs::read(&p).unwrap(), bytes);
    }

    #[test]
    fn atomic_write_into_a_missing_parent_fails_cleanly_on_a_file() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("file"), b"x").unwrap();
        // The "parent" is a file, so the folder cannot be created.
        assert!(write_atomic(&dir.path().join("file").join("child"), b"y").is_err());
    }

    #[test]
    fn lists_only_real_projects() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list_projects(dir.path()).unwrap().is_empty());
        let root = projects_root(dir.path());
        for id in ["b-project", "a-project"] {
            fs::create_dir_all(root.join(id)).unwrap();
            fs::write(root.join(id).join(DB_FILE), b"x").unwrap();
        }
        fs::create_dir_all(root.join("no-db")).unwrap();
        fs::create_dir_all(root.join("Upper")).unwrap();
        fs::write(root.join("Upper").join(DB_FILE), b"x").unwrap();
        fs::write(root.join("stray-file"), b"x").unwrap();
        assert_eq!(
            list_projects(dir.path()).unwrap(),
            vec!["a-project", "b-project"]
        );
        assert!(project_exists(dir.path(), "a-project").unwrap());
        assert!(!project_exists(dir.path(), "no-db").unwrap());
        assert!(!project_exists(dir.path(), "missing").unwrap());
    }

    #[test]
    fn blobs_need_their_project() {
        let dir = tempfile::tempdir().unwrap();
        let err = blob_file_for_write(dir.path(), ID, "b1").unwrap_err();
        assert_eq!(err.code(), "NOT_FOUND");
        fs::create_dir_all(project_dir(dir.path(), ID).unwrap()).unwrap();
        let p = blob_file_for_write(dir.path(), ID, "b1").unwrap();
        write_atomic(&p, &[0, 1, 2, 255]).unwrap();
        assert_eq!(fs::read(&p).unwrap(), vec![0, 1, 2, 255]);
        remove_blob(dir.path(), ID, "b1").unwrap();
        remove_blob(dir.path(), ID, "b1").unwrap(); // idempotent
        assert!(!p.exists());
    }

    #[test]
    fn lists_blobs_without_temporary_files() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list_blobs(dir.path(), ID).unwrap().is_empty());
        fs::create_dir_all(project_dir(dir.path(), ID).unwrap()).unwrap();
        assert!(list_blobs(dir.path(), ID).unwrap().is_empty());
        for id in ["b2", "b1"] {
            write_atomic(&blob_file_for_write(dir.path(), ID, id).unwrap(), b"x").unwrap();
        }
        let blobs = project_dir(dir.path(), ID).unwrap().join(BLOB_DIR);
        fs::write(blobs.join(".b3.42-0.tmp"), b"x").unwrap();
        fs::create_dir(blobs.join("sub")).unwrap();
        assert_eq!(list_blobs(dir.path(), ID).unwrap(), vec!["b1", "b2"]);
        assert!(list_blobs(dir.path(), "../x").is_err());
    }

    #[test]
    fn erase_project_keeps_the_others() {
        let dir = tempfile::tempdir().unwrap();
        for id in ["one", "two"] {
            let p = blob_file(dir.path(), id, "b1").unwrap();
            write_atomic(&p, b"sealed").unwrap();
            fs::write(project_db(dir.path(), id).unwrap(), b"db").unwrap();
        }
        erase_project(dir.path(), "one").unwrap();
        erase_project(dir.path(), "one").unwrap(); // idempotent
        assert_eq!(list_projects(dir.path()).unwrap(), vec!["two"]);
        assert!(!project_dir(dir.path(), "one").unwrap().exists());
        assert!(blob_file(dir.path(), "two", "b1").unwrap().exists());
    }

    #[test]
    fn erase_all_keeps_prefs_and_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        for f in APP_FILES {
            write_atomic(&dir.path().join(f), b"{}").unwrap();
        }
        fs::write(dir.path().join(".keyring.json.1-0.tmp"), b"{}").unwrap();
        let p = blob_file(dir.path(), "one", "b1").unwrap();
        write_atomic(&p, b"sealed").unwrap();
        erase_all(dir.path()).unwrap();
        erase_all(dir.path()).unwrap();
        assert!(dir.path().join(PREFS_FILE).exists());
        assert!(!dir.path().join(KEYRING_FILE).exists());
        assert!(!dir.path().join(LIBRARY_FILE).exists());
        assert!(!dir.path().join(".keyring.json.1-0.tmp").exists());
        assert!(!projects_root(dir.path()).exists());
        let left: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(left, vec![PREFS_FILE]);
    }
}

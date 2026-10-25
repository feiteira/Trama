//! Trama desktop shell. The UI (React) owns the data model, SQL and cryptography; this crate
//! provides what a webview cannot: encrypted SQLite files (one per project), fast Argon2id,
//! access to files the researcher chooses, and on-device speech (recording a call, transcribing
//! recordings; see speech/). Trama makes no network connections: there is no
//! HTTP client here and the capability file grants no network permission.

mod db;
mod error;
mod files;
mod kdf;
mod speech;

use std::path::{Path, PathBuf};

use percent_encoding::percent_decode_str;
use serde::Serialize;
use serde_json::{Map, Value};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, State};

use db::{DbState, ExecResult, Statement};
use error::{AppError, AppResult};
use speech::Speech;

struct Paths {
    data: PathBuf,
    example: bool,
}

/// `trama-desktop --example` opens the fictional example library (the "Trama (example)"
/// launcher). It lives in its own folder, emptied at every start and exit, so it never
/// touches the researcher's own library.
fn example_mode() -> bool {
    std::env::args().skip(1).any(|a| a == "--example")
}

fn resolve_data_dir(app: &AppHandle, example: bool) -> PathBuf {
    // TRAMA_DATA_DIR lets testers keep a separate library (and runs a portable copy).
    if let Some(dir) = std::env::var_os("TRAMA_DATA_DIR").filter(|d| !d.is_empty()) {
        let mut dir = PathBuf::from(dir);
        // A relative path would move with the working directory between launches.
        if dir.is_relative() {
            if let Ok(cwd) = std::env::current_dir() {
                dir = cwd.join(dir);
            }
        }
        return if example { dir.join("example") } else { dir };
    }
    if example {
        return app
            .path()
            .app_cache_dir()
            .expect("the platform provides an app cache directory")
            .join("example");
    }
    app.path()
        .app_data_dir()
        .expect("the platform provides an app data directory")
}

fn body_bytes(req: &Request<'_>) -> AppResult<Vec<u8>> {
    match req.body() {
        InvokeBody::Raw(b) => Ok(b.clone()),
        InvokeBody::Json(_) => Err(AppError::Invalid("expected raw bytes".into())),
    }
}

/// Header values are percent-encoded by the UI: HTTP headers cannot carry non-ASCII paths.
fn header(req: &Request<'_>, name: &str) -> AppResult<String> {
    let raw = req
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::Invalid(format!("missing header {name}")))?;
    percent_decode_str(raw)
        .decode_utf8()
        .map(|s| s.into_owned())
        .map_err(|_| AppError::Invalid(format!("header {name} is not UTF-8")))
}

fn user_path(p: &str) -> AppResult<PathBuf> {
    let path = PathBuf::from(p);
    if !path.is_absolute() {
        return Err(AppError::Invalid("path must be absolute".into()));
    }
    Ok(path)
}

/// Runs file and CPU-heavy work off the async runtime's threads.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
}

// ── Project databases ────────────────────────────────────────────────────────────────────

#[tauri::command]
async fn db_open(
    paths: State<'_, Paths>,
    db: State<'_, DbState>,
    project: String,
    key_hex: String,
    create: bool,
) -> AppResult<()> {
    let key = zeroize::Zeroizing::new(key_hex);
    db.open(&paths.data, &project, &key, create)
}

// `project` on the calls below is optional: when the UI sends it, a call for a project that
// is no longer the open one fails with DB_NOT_OPEN (see DbState::with_project).

#[tauri::command]
async fn db_close(db: State<'_, DbState>, project: Option<String>) -> AppResult<()> {
    match project {
        Some(p) => db.close_project(&p),
        None => db.close(),
    }
    Ok(())
}

#[tauri::command]
async fn db_exec(
    db: State<'_, DbState>,
    project: Option<String>,
    sql: String,
    params: Vec<Value>,
) -> AppResult<ExecResult> {
    db.with_project(project.as_deref(), |c| db::exec_on(c, &sql, &params))
}

#[tauri::command]
async fn db_query(
    db: State<'_, DbState>,
    project: Option<String>,
    sql: String,
    params: Vec<Value>,
) -> AppResult<Vec<Map<String, Value>>> {
    db.with_project(project.as_deref(), |c| db::query_on(c, &sql, &params))
}

#[tauri::command]
async fn db_batch(
    db: State<'_, DbState>,
    project: Option<String>,
    statements: Vec<Statement>,
) -> AppResult<usize> {
    db.with_project(project.as_deref(), |c| db::batch_on(c, &statements))
}

#[tauri::command]
async fn db_script(db: State<'_, DbState>, project: Option<String>, sql: String) -> AppResult<()> {
    db.with_project(project.as_deref(), |c| db::script_on(c, &sql))
}

// ── Projects and the library ─────────────────────────────────────────────────────────────

#[tauri::command]
async fn project_list(paths: State<'_, Paths>) -> AppResult<Vec<String>> {
    files::list_projects(&paths.data)
}

#[tauri::command]
async fn project_exists(paths: State<'_, Paths>, project: String) -> AppResult<bool> {
    files::project_exists(&paths.data, &project)
}

#[tauri::command]
async fn project_erase(
    paths: State<'_, Paths>,
    db: State<'_, DbState>,
    project: String,
) -> AppResult<()> {
    // Validated before closing anything, so a bad id cannot close the open project.
    files::project_dir(&paths.data, &project)?;
    db.close_project(&project);
    files::erase_project(&paths.data, &project)
}

#[tauri::command]
async fn erase_all(paths: State<'_, Paths>, db: State<'_, DbState>) -> AppResult<()> {
    db.close();
    files::erase_all(&paths.data)
}

// ── Key derivation ───────────────────────────────────────────────────────────────────────

#[tauri::command]
async fn kdf_argon2id(
    secret_hex: String,
    salt_hex: String,
    m: u32,
    t: u32,
    p: u32,
    len: usize,
) -> AppResult<String> {
    let secret_hex = zeroize::Zeroizing::new(secret_hex);
    let secret = zeroize::Zeroizing::new(
        hex::decode(secret_hex.as_str()).map_err(|_| AppError::Invalid("secret hex".into()))?,
    );
    let salt = hex::decode(&salt_hex).map_err(|_| AppError::Invalid("salt hex".into()))?;
    // 64 MiB of memory-hard work takes a while: off the async runtime's threads.
    let out = blocking(move || kdf::argon2id(&secret, &salt, m, t, p, len)).await?;
    Ok(hex::encode(&*out))
}

// ── App files and project blobs ──────────────────────────────────────────────────────────

#[tauri::command]
async fn app_file_read(paths: State<'_, Paths>, name: String) -> AppResult<Option<String>> {
    let path = files::app_file(&paths.data, &name)?;
    Ok(files::read_optional(&path)?.map(|b| String::from_utf8_lossy(&b).into_owned()))
}

#[tauri::command]
async fn app_file_write(paths: State<'_, Paths>, name: String, text: String) -> AppResult<()> {
    files::write_atomic(&files::app_file(&paths.data, &name)?, text.as_bytes())
}

#[tauri::command]
async fn blob_write(paths: State<'_, Paths>, request: Request<'_>) -> AppResult<()> {
    let project = header(&request, "x-project")?;
    let id = header(&request, "x-blob-id")?;
    let path = files::blob_file_for_write(&paths.data, &project, &id)?;
    let bytes = body_bytes(&request)?;
    blocking(move || files::write_atomic(&path, &bytes)).await
}

#[tauri::command]
async fn blob_read(paths: State<'_, Paths>, project: String, id: String) -> AppResult<Response> {
    let path = files::blob_file(&paths.data, &project, &id)?;
    let bytes = blocking(move || Ok(std::fs::read(path)?)).await?;
    Ok(Response::new(bytes))
}

/// Adds to a blob as it is made (a recording); returns its new length.
#[tauri::command]
async fn blob_append(paths: State<'_, Paths>, request: Request<'_>) -> AppResult<u64> {
    let project = header(&request, "x-project")?;
    let id = header(&request, "x-blob-id")?;
    let path = files::blob_file_for_write(&paths.data, &project, &id)?;
    let bytes = body_bytes(&request)?;
    blocking(move || files::append(&path, &bytes)).await
}

/// Overwrites part of a blob (a recording's first frame, once its length is known), and with
/// `x-truncate: 1` ends the blob after it.
#[tauri::command]
async fn blob_write_at(paths: State<'_, Paths>, request: Request<'_>) -> AppResult<()> {
    let project = header(&request, "x-project")?;
    let id = header(&request, "x-blob-id")?;
    let offset: u64 = header(&request, "x-offset")?
        .parse()
        .map_err(|_| AppError::Invalid("offset".into()))?;
    let truncate = header(&request, "x-truncate")? == "1";
    let path = files::blob_file(&paths.data, &project, &id)?;
    let bytes = body_bytes(&request)?;
    blocking(move || files::write_at(&path, offset, &bytes, truncate)).await
}

#[tauri::command]
async fn blob_read_range(
    paths: State<'_, Paths>,
    project: String,
    id: String,
    offset: u64,
    length: u64,
) -> AppResult<Response> {
    let path = files::blob_file(&paths.data, &project, &id)?;
    let bytes = blocking(move || files::read_range(&path, offset, length)).await?;
    Ok(Response::new(bytes))
}

#[tauri::command]
async fn blob_size(paths: State<'_, Paths>, project: String, id: String) -> AppResult<u64> {
    let path = files::blob_file(&paths.data, &project, &id)?;
    Ok(std::fs::metadata(path)?.len())
}

#[tauri::command]
async fn blob_delete(paths: State<'_, Paths>, project: String, id: String) -> AppResult<()> {
    files::remove_blob(&paths.data, &project, &id)
}

#[tauri::command]
async fn blob_list(paths: State<'_, Paths>, project: String) -> AppResult<Vec<String>> {
    files::list_blobs(&paths.data, &project)
}

// ── Files the researcher chose ───────────────────────────────────────────────────────────

#[tauri::command]
async fn fs_read(path: String) -> AppResult<Response> {
    let path = user_path(&path)?;
    let bytes = blocking(move || Ok(std::fs::read(path)?)).await?;
    Ok(Response::new(bytes))
}

#[tauri::command]
async fn fs_write(request: Request<'_>) -> AppResult<()> {
    let path = user_path(&header(&request, "x-path")?)?;
    let bytes = body_bytes(&request)?;
    blocking(move || files::write_atomic(&path, &bytes)).await
}

#[tauri::command]
async fn fs_list(path: String, recursive: bool) -> AppResult<Vec<files::Entry>> {
    let path = user_path(&path)?;
    blocking(move || files::list(&path, recursive, 20_000)).await
}

#[tauri::command]
async fn fs_remove(path: String) -> AppResult<()> {
    // Files only: removing a folder the researcher picked is never what an app action means.
    std::fs::remove_file(user_path(&path)?)?;
    Ok(())
}

#[tauri::command]
async fn fs_exists(path: String) -> AppResult<bool> {
    Ok(Path::new(&path).is_absolute() && Path::new(&path).exists())
}

#[derive(Serialize)]
struct AppInfo {
    version: String,
    os: String,
    data_dir: String,
    example: bool,
}

#[tauri::command]
fn app_info(app: AppHandle, paths: State<'_, Paths>) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        os: std::env::consts::OS.to_string(),
        data_dir: paths.data.to_string_lossy().into_owned(),
        example: paths.example,
    }
}

// Mobile-ready: `tauri android/ios` call this entry point from the generated host app (with
// the staticlib/cdylib crate types in Cargo.toml). Folder pickers do not exist on phones.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Native open/save dialogs: the only plugin. No http, no opener — Trama stays offline.
        .plugin(tauri_plugin_dialog::init())
        .manage(DbState::default())
        .setup(|app| {
            let example = example_mode();
            let data = resolve_data_dir(app.handle(), example);
            if example && data.exists() {
                std::fs::remove_dir_all(&data)?;
            }
            std::fs::create_dir_all(&data)?;
            app.manage(Paths { data, example });
            app.manage(Speech::new(speech::locate(app.handle())));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_open,
            db_close,
            db_exec,
            db_query,
            db_batch,
            db_script,
            project_list,
            project_exists,
            project_erase,
            erase_all,
            kdf_argon2id,
            app_file_read,
            app_file_write,
            blob_write,
            blob_read,
            blob_append,
            blob_write_at,
            blob_read_range,
            blob_size,
            blob_delete,
            blob_list,
            fs_read,
            fs_write,
            fs_list,
            fs_remove,
            fs_exists,
            app_info,
            speech::speech_info,
            speech::transcribe_start,
            speech::transcribe_status,
            speech::transcribe_take,
            speech::transcribe_cancel,
            speech::recorder_start,
            speech::recorder_status,
            speech::recorder_take,
            speech::recorder_stop,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Trama")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(speech) = app.try_state::<Speech>() {
                    speech.shutdown();
                }
                // try_state: absent when setup failed before managing it.
                let Some(paths) = app.try_state::<Paths>() else {
                    return;
                };
                if paths.example {
                    // Closed first: Windows cannot delete an open database file.
                    app.state::<DbState>().close();
                    let _ = std::fs::remove_dir_all(&paths.data);
                }
            }
        });
}

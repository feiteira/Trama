//! Sala desktop shell. The UI (react-native-web) owns the data model, SQL and cryptography;
//! this crate provides what a webview cannot: an encrypted SQLite file, fast Argon2id and
//! access to files the therapist chooses. The only network access is the optional connection
//! to The Human Loop, limited to its hosts by the capability file.

mod db;
mod error;
mod files;
mod kdf;

use std::path::{Path, PathBuf};

use percent_encoding::percent_decode_str;
use serde::Serialize;
use serde_json::{Map, Value};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, State};

use db::{DbState, ExecResult, Statement};
use error::{AppError, AppResult};

struct Paths {
    data: PathBuf,
    example: bool,
}

/// `sala-desktop --example` opens the fictional example practice (the "Sala (example)"
/// launcher). It lives in its own folder, emptied at every start and exit, so it never
/// touches the therapist's practice.
fn example_mode() -> bool {
    std::env::args().skip(1).any(|a| a == "--example")
}

fn resolve_data_dir(app: &AppHandle, example: bool) -> PathBuf {
    // SALA_DATA_DIR lets testers keep a separate practice (and runs a portable copy).
    if let Some(dir) = std::env::var_os("SALA_DATA_DIR") {
        let dir = PathBuf::from(dir);
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

fn header(req: &Request<'_>, name: &str) -> AppResult<String> {
    let raw = req
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::Invalid(format!("missing header {name}")))?;
    Ok(percent_decode_str(raw).decode_utf8_lossy().into_owned())
}

fn user_path(p: &str) -> AppResult<PathBuf> {
    let path = PathBuf::from(p);
    if !path.is_absolute() {
        return Err(AppError::Invalid("path must be absolute".into()));
    }
    Ok(path)
}

// ── Practice database ────────────────────────────────────────────────────────────────────

#[tauri::command]
async fn db_exists(paths: State<'_, Paths>) -> AppResult<bool> {
    Ok(db::db_path(&paths.data).exists())
}

#[tauri::command]
async fn db_open(
    paths: State<'_, Paths>,
    db: State<'_, DbState>,
    key_hex: String,
    create: bool,
) -> AppResult<()> {
    let key = zeroize::Zeroizing::new(key_hex);
    db.open(&paths.data, &key, create)
}

#[tauri::command]
async fn db_close(db: State<'_, DbState>) -> AppResult<()> {
    db.close();
    Ok(())
}

#[tauri::command]
async fn db_exec(db: State<'_, DbState>, sql: String, params: Vec<Value>) -> AppResult<ExecResult> {
    db.with(|c| db::exec_on(c, &sql, &params))
}

#[tauri::command]
async fn db_query(
    db: State<'_, DbState>,
    sql: String,
    params: Vec<Value>,
) -> AppResult<Vec<Map<String, Value>>> {
    db.with(|c| db::query_on(c, &sql, &params))
}

#[tauri::command]
async fn db_batch(db: State<'_, DbState>, statements: Vec<Statement>) -> AppResult<usize> {
    db.with(|c| db::batch_on(c, &statements))
}

#[tauri::command]
async fn db_script(db: State<'_, DbState>, sql: String) -> AppResult<()> {
    db.with(|c| db::script_on(c, &sql))
}

#[tauri::command]
async fn erase_practice(paths: State<'_, Paths>, db: State<'_, DbState>) -> AppResult<()> {
    db.close();
    files::erase_practice(&paths.data)
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
    let secret = zeroize::Zeroizing::new(
        hex::decode(&secret_hex).map_err(|_| AppError::Invalid("secret hex".into()))?,
    );
    let salt = hex::decode(&salt_hex).map_err(|_| AppError::Invalid("salt hex".into()))?;
    let out =
        tauri::async_runtime::spawn_blocking(move || kdf::argon2id(&secret, &salt, m, t, p, len))
            .await
            .map_err(|e| AppError::Other(e.to_string()))??;
    Ok(hex::encode(&*out))
}

// ── App files and attachment blobs ───────────────────────────────────────────────────────

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
    let id = header(&request, "x-blob-id")?;
    let bytes = body_bytes(&request)?;
    files::write_atomic(&files::blob_file(&paths.data, &id)?, &bytes)
}

#[tauri::command]
async fn blob_read(paths: State<'_, Paths>, id: String) -> AppResult<Response> {
    let bytes = std::fs::read(files::blob_file(&paths.data, &id)?)?;
    Ok(Response::new(bytes))
}

#[tauri::command]
async fn blob_delete(paths: State<'_, Paths>, id: String) -> AppResult<()> {
    match std::fs::remove_file(files::blob_file(&paths.data, &id)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

// ── Files the therapist chose ────────────────────────────────────────────────────────────

#[tauri::command]
async fn fs_read(path: String) -> AppResult<Response> {
    Ok(Response::new(std::fs::read(user_path(&path)?)?))
}

#[tauri::command]
async fn fs_write(request: Request<'_>) -> AppResult<()> {
    let path = user_path(&header(&request, "x-path")?)?;
    files::write_atomic(&path, &body_bytes(&request)?)
}

#[tauri::command]
async fn fs_list(path: String, recursive: bool) -> AppResult<Vec<files::Entry>> {
    let path = user_path(&path)?;
    tauri::async_runtime::spawn_blocking(move || files::list(&path, recursive, 20_000))
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
}

#[tauri::command]
async fn fs_remove(path: String) -> AppResult<()> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Only used after the therapist chooses "Join The Loop", and for the update check when
        // they turn it on; scoped in capabilities/default.json to The Human Loop's hosts and the
        // one public file that names the latest version.
        .plugin(tauri_plugin_http::init())
        // Opens Sala's download page in the browser; scoped to Sala's website.
        .plugin(tauri_plugin_opener::init())
        .manage(DbState::default())
        .setup(|app| {
            let example = example_mode();
            let data = resolve_data_dir(app.handle(), example);
            if example && data.exists() {
                std::fs::remove_dir_all(&data)?;
            }
            std::fs::create_dir_all(&data)?;
            app.manage(Paths { data, example });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_exists,
            db_open,
            db_close,
            db_exec,
            db_query,
            db_batch,
            db_script,
            erase_practice,
            kdf_argon2id,
            app_file_read,
            app_file_write,
            blob_write,
            blob_read,
            blob_delete,
            fs_read,
            fs_write,
            fs_list,
            fs_remove,
            fs_exists,
            app_info,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Sala")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let paths = app.state::<Paths>();
                if paths.example {
                    app.state::<DbState>().close();
                    let _ = std::fs::remove_dir_all(&paths.data);
                }
            }
        });
}

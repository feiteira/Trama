# Building Trama on each platform

Trama is one codebase: a React UI (`app/`) inside a Tauri 2 shell (`desktop/src-tauri/`, Rust).
The shell links SQLCipher with a vendored OpenSSL, so no system SQLite or OpenSSL is needed.
It has no network code: no HTTP client, no update check, and no network permission in
`capabilities/default.json`.

Everything below runs from the repository root after `npm install` (Node 22.12 or later, and a
stable Rust toolchain from `rust-toolchain.toml`).

| Command | What it does |
|---|---|
| `npm run dev` | Desktop app with hot reload |
| `npm run test:rust` / `npm run lint:rust` | `cargo test` / `cargo fmt --check` and `clippy -D warnings` |
| `npm run build:desktop` | Installers for the current system, in `desktop/src-tauri/target/release/bundle/` |

Release builds are unsigned unless you sign them yourself. The manual GitHub workflow
(`.github/workflows/ci.yml`, run from the Actions tab) builds Linux, Windows and, when asked
for by name, macOS. It uses no secrets.

## Linux

```bash
sudo apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev librsvg2-dev patchelf
npm run build:desktop        # AppImage, .deb and .rpm
```

On Fedora: `webkit2gtk4.1-devel gtk3-devel libsoup3-devel librsvg2-devel patchelf`. The .deb and
.rpm also install a **Trama (example)** launcher (`linux/trama-example.desktop`), which runs
`trama-desktop --example`.

Audio and video playback in the webview uses the system's GStreamer. The AppImage does not bundle
it (`bundleMediaFramework: false`), so playing media needs GStreamer's "good" plugins installed
on the system (most desktops have them).

## Windows

Install the [Tauri prerequisites](https://tauri.app/start/prerequisites/): Visual Studio Build
Tools with "Desktop development with C++", and Strawberry Perl, which OpenSSL's vendored build
needs (`choco install strawberryperl`). Then:

```powershell
npm run build:desktop        # NSIS .exe and .msi, in English, Portuguese and Spanish
```

Both installers add a **Trama (example)** Start-menu shortcut, named in the installer's language
(`windows/installer-hooks.nsh`, `windows/example-shortcut.wxs`). The installer downloads the
WebView2 runtime from Microsoft if the computer does not have it (Windows 10 and 11 normally do);
the app itself never connects anywhere.

## macOS

Install Xcode's command-line tools (`xcode-select --install`), then:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run tauri --workspace @trama/desktop -- build --target universal-apple-darwin --bundles app,dmg
```

Unsigned or ad hoc–signed apps open after **System Settings → Privacy & Security → Open
Anyway**. Distributing to others needs a Developer ID certificate and notarisation
(`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`; see Tauri's macOS
signing guide).

## Where the data lives

`app_data_dir()` — `~/.local/share/eu.thehumanloop.trama` on Linux,
`%APPDATA%\eu.thehumanloop.trama` on Windows, `~/Library/Application Support/eu.thehumanloop.trama`
on macOS. `TRAMA_DATA_DIR=/some/folder` uses another folder (testing, a portable copy). The
example library (`--example`) lives in the app *cache* folder, under `example/`, and is emptied
at every start and exit.

## Towards iOS and Android (tablets)

The shell is already mobile-ready: `lib.rs` keeps `#[cfg_attr(mobile, tauri::mobile_entry_point)]`,
`Cargo.toml` builds the `staticlib` and `cdylib` crate types, `npx tauri icon` has generated the
Android and iOS icons, and the UI talks to the device only through `app/src/platform/types.ts`,
whose Tauri implementation (`platform/tauri.ts`) is shared with phones and tablets.

```bash
cd desktop
npx tauri android init       # needs Android Studio, the SDK and the NDK (ANDROID_HOME, NDK_HOME)
npx tauri android dev
npx tauri ios init           # macOS with Xcode only
npx tauri ios dev
```

Things to know before the first mobile build:

- **OpenSSL.** `rusqlite`'s `bundled-sqlcipher-vendored-openssl` compiles OpenSSL from source for
  each target. On Android that needs the NDK's clang on the `PATH` (Tauri's Android tooling sets
  it up when `NDK_HOME` is set) and Perl; on iOS it builds with Xcode's toolchain.
- **Files.** There are no folder pickers on Android or iOS: `dialogs.pickFolder` cannot work, so
  automatic backups to a folder need another design there (for example, a "save a backup" file
  dialog or the system share sheet). Picking files and saving one file through the dialog plugin
  do work; the paths they return may be content URIs on Android, which `fs_read`/`fs_write`
  (plain absolute paths) do not yet understand.
- **Window.** `setTitle` and the close-request hook do nothing useful on phones; the app should
  save as it goes rather than rely on a final save at exit (the OS may stop a backgrounded app
  without warning).
- **Capabilities.** `capabilities/default.json` names the `main` window; mobile uses the same
  file. Keep it free of network permissions.
- **UI.** The interface is plain React DOM with CSS custom properties and is built to be
  responsive, with every action reachable without a mouse-only gesture, so a tablet in landscape
  is the realistic first mobile target. Phone widths need their own review of the workbench,
  where the document and the codebook sit side by side.

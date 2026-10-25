# Desktop end-to-end test

`run.mjs` drives the **real Trama desktop app** (the release build, in its WebKitGTK webview)
through W3C WebDriver, on Linux. It catches what the browser demo and Vitest cannot: the Tauri
content security policy, the capability file, the Rust shell (SQLCipher, Argon2id, files),
native-window behaviour, restarts and what actually lands on disk.

```bash
npm run build:desktop                        # release build (AppImage, deb + the binary)
xvfb-run -a node tools/desktop-e2e/run.mjs   # ~1 minute
```

Do not run it while `npm run build:desktop` is bundling: the bundler rewrites the binary and fails
with "Text file busy" if the app is running.

## Requirements

- A release build at `desktop/src-tauri/target/release/trama-desktop` (or `TRAMA_BIN`).
- `WebKitWebDriver` (Debian/Ubuntu package `webkit2gtk-driver`) and `cargo install tauri-driver`.
- An X display: `xvfb-run` (package `xvfb`) or a desktop session.
- `python3` with `libX11.so.6` (always there with WebKitGTK on X11): closing the window the way a
  person does, see below.
- Optional, recommended: `dbus-run-session` (package `dbus`). The driver then runs on a private
  D-Bus session; with the desktop's bus each app start waits ~30 s under Xvfb for portals that
  cannot answer.

No npm packages: it talks to `tauri-driver` with `fetch`.

## What it checks

It uses a throwaway library (`TRAMA_DATA_DIR` in a temporary folder), never yours, and made-up
marker words unique to the run.

1. **Styles in the real webview.** The welcome screen and the project shell are laid out (grid,
   flex rail beside the screen), and every kind of style applies: stylesheet, `<style>` element,
   `style=""` attribute and CSSOM inline styles (a coded passage's colour is an inline style).
   Guards `dangerousDisableAssetCspModification: ["style-src"]`: without it Tauri adds a nonce
   and WebKit drops inline styles while the browser demo still looks right.
2. **Fonts.** Instrument Sans and Literata (self-hosted) load and the interface uses them.
3. **No network.** `plugin:http|fetch`, `plugin:opener|open_url` and `plugin:shell|open` are
   refused; `fetch`, XHR, WebSocket and an image to `https://example.com` are blocked, with CSP
   violations for `connect-src` and `img-src` (so it is the policy, not a missing network); and
   neither the app nor its WebKit processes hold a socket to anything but loopback (the WebDriver
   link), read from `/proc`.
4. **First run and the main workflow.** Create a library (name, passphrase, recovery phrase; a
   wrong check word is refused) → create a project → import a text document (non-ASCII path)
   through the file dialog → select a passage with the DOM Selection API and code it with a new
   code from the selection popover → lock with Ctrl+L (nothing of the project stays on screen or in
   the window title) → a wrong passphrase is refused → unlock → the coding is still there.
5. **Quit and restart.** The window is closed with an X11 `WM_DELETE_WINDOW`, as a window
   manager's close button does, so the app's exit handlers run (WebDriver's "close window" kills
   the process). After a restart and unlock, the document, its coding and the code are there.
6. **Nothing readable on disk.** Every file in the library (keyring, `library.json`,
   `prefs.json`, `projects/*/project.db*`, blobs) is searched for the document's marker word, a
   phrase of the document, the code's name and the project's name, in UTF-8 and UTF-16: none may
   appear. `project.db` must not start with `SQLite format 3`; `keyring.json` has 2 slots
   (passphrase and recovery phrase); `library.json` does not show the project name.
7. **Smallest window (1000×660).** Asking for 800×500 leaves the window at its minimum; every
   screen of the navigation rail and an open document fit without sideways scrolling.
8. **Window title.** "Trama" on the welcome and locked screens, "<project> · Trama" in a project,
   "<project> · Example · Trama" (or Exemplo/Ejemplo) for the example.
9. **`--example`.** Opens straight into the fictional example project; a change (a new code on a
   passage) is gone after a restart; the real library's files are byte-for-byte unchanged and the
   example folder is removed when the app exits.
10. **125% scale.** The example part and a final real-library session run with
    `GDK_DPI_SCALE=1.25` (`devicePixelRatio` 1.25 in WebKitGTK): every screen opens and fits, the
    workbench settles (no render loop from fields that grow with their text), the coded passage
    is shown. WebKitWebDriver aims its pointer wrongly at fractional scales, so this part clicks
    through the DOM.

Native file dialogs cannot be driven by WebDriver: the test queues answers in
`window.__TRAMA_E2E_DIALOGS__` (see `app/src/platform/tauri.ts`); each dialog call takes the next
one. Nothing sets it in normal use.

## Output and failures

Each step prints its name, a short note and its time; a summary of timings ends the run. The exit
code is 0 when everything passed.

When a step fails the run stops and prints the error, a WebDriver screenshot (saved in the
artifacts folder), the crash screen's text if the app crashed, uncaught page errors and
`console.error` calls, the page's text and the tail of the driver's log.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `TRAMA_BIN` | `desktop/src-tauri/target/release/trama-desktop` | the app binary to test |
| `TRAMA_E2E_ARTIFACTS` | a new `trama-e2e-artifacts-*` folder in the temp dir | where screenshots go |
| `TRAMA_E2E_SHOTS` | off | `1`: a screenshot of every screen (at the minimum size and at 125%), not only on failure |
| `TRAMA_E2E_KEEP` | off | `1`: keep the temporary library and files for inspection |
| `TRAMA_E2E_PRIVATE_BUS` | on when `dbus-run-session` exists | `0`: use the inherited D-Bus session |
| `TRAMA_E2E_TIMEOUT_MS` | 900000 | a watchdog for the whole run |
| `TRAMA_SPEECH_DIR` | `desktop/src-tauri/resources/speech` | the speech model handed to the app for the transcription step (skipped without it, or without ffmpeg's flite voice for the sample) |
| `TRAMA_E2E_BUNDLED_SPEECH` | off | `1`: hand no model to the app, which must find the one it carries (an installed .deb, an extracted AppImage run through its `AppRun`; the quit step then cannot find the app's process) |

The driver listens on a free local port chosen at each run, so several runs (or another WebDriver
session) do not collide. The app must not already be running from the same binary: the test
finds the app's process by its binary (to close its window and wait for it to exit), so it
refuses to start.

# AGENTS.md

Guidance for coding agents (and people) working in this repository. `CLAUDE.md` imports this file.

## What Trama is

Trama is a free, open-source **qualitative data analysis** (QDA / CAQDAS) app — the kind of tool researchers use to code interview transcripts, field notes, open survey answers and documents. Import material, highlight passages and apply codes from a hierarchical codebook, write memos, describe cases with attributes, retrieve coded segments, run queries (co-occurrence, code × document, code × attribute, word frequencies, text search), check inter-coder agreement, merge a teammate's copy, and exchange whole projects with NVivo, MAXQDA and ATLAS.ti through the open **REFI-QDA** standard (`.qdpx`, `.qdc`).

Everything stays on the researcher's computer, encrypted (SQLCipher + Argon2id, a 12-word recovery phrase), with **no account and no network connection at all**. Interview data is personal data; ethics boards and GDPR favour exactly this. Desktop first (Linux, then Windows and macOS from the same code); the UI is responsive so a tablet build (Tauri mobile) can follow.

## Commands

```bash
npm install                      # from the repo root (npm workspaces: app, desktop)
npm run dev                      # desktop app with hot reload (Tauri + Vite)
npm run dev:web                  # browser demo at http://localhost:1420 — the example project, in memory
npm run typecheck                # tsc --noEmit — also fails on any missing translation
npm test                         # Vitest (app/src/**/*.test.ts)
npx vitest run src/core/qda --root app          # one directory or file
npm run test:rust                # cargo test (SQLCipher, Argon2 vectors, file helpers, speech)
npm run lint:rust                # cargo fmt --check + clippy -D warnings
npm run build:desktop            # installers for the current OS (AppImage/deb/rpm on Linux), speech model bundled
npm run fetch:speech             # the speech model files (575 MB, SHA-256 checked) for debug builds
npm run gen:privacy              # regenerate PRIVACY.md from app/src/core/privacy/flows.ts
npm run screenshots              # manual screenshots, all three languages (Playwright + the demo)
xvfb-run -a node tools/desktop-e2e/run.mjs   # the real desktop app via WebDriver (after a release build)
```

Linux builds need `libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev librsvg2-dev patchelf libasound2-dev libclang-dev cmake` (the last three for recording and whisper.cpp).

Build and test locally. Never trigger macOS/Windows CI builds unless explicitly asked.

## Architecture

```
app/src/core/        platform-free TypeScript (no DOM, no React): runs in Vitest under Node
  model/             record types (types.ts), validation (validate.ts)
  store/             Store over SQL (store.ts), schema + migrations (schema.ts), Db interface
  crypto/            Argon2id (kdf), keyring (passphrase + BIP-39 recovery slots), sealed frames
  i18n/              typed catalogs, one file per namespace per language (locales/{en,pt,es}/*.ts)
  qda/               analysis: offsets, ranges & text-edit remapping, agreement statistics,
                     co-occurrence, matrices, word frequency, stop words, search/KWIC
  import/            parsers → ImportedDoc (txt, md, docx, odt, rtf, html, pdf, vtt, srt, transcripts, csv, xlsx)
  export/            .trama container (trama.ts), REFI-QDA qdpx/qdc (refi/), office writers (csv, xlsx, docx, html)
  privacy/           "What leaves this device" — source of PRIVACY.md
  speech/            transcription results → transcript turns (echo removal, sync points), WAV header
  text/              normalisation (fold), small Markdown parser
app/src/platform/    the device boundary (types.ts) + tauri.ts (desktop/mobile), memory.ts + sqljs.ts (tests, demo)
app/src/services/    library (keyring, project list), project (store, blobs, me), domain operations
                     (documents, codes, codings, memos, cases, groups, pseudonyms, log), undo, backups, data files,
                     recording (a call sealed into a blob as it is made) and transcription (queue, engine)
app/src/ui/          design system: tokens (tokens.css), components, icons (lucide-react), i18n provider
app/src/shell/       app state (welcome/locked/library/project), router, layout, auto-lock, savers, error boundary
app/src/features/    screens, one folder each: onboarding, projects, workbench, codes, segments, memos, cases,
                     analysis, agreement, importer, exporter, pseudonyms, log, settings, help, speech
app/src/demo/        browser demo boot + the fictional example project (exampleProject.ts)
desktop/src-tauri/   Rust shell: SQLCipher databases (one per project), Argon2id, file I/O, dialogs, speech/
                     (recording with cpal, decoding with Symphonia, whisper.cpp via whisper-rs). No network.
docs/                manual (en/pt/es), public specs (export format), security notes
test-vectors/        crypto vectors checked by both Vitest and cargo test
```

### Storage: one library, many projects

- **Library** = `keyring.json` (a random 256-bit *library key* wrapped twice: passphrase slot and 12-word BIP-39 recovery-phrase slot, Argon2id m=64 MiB, t=3, p=4, AES-256-GCM) + `library.json` (the project list, AES-256-GCM under `subkey(libraryKey, 'trama.library.v1')`, so even project *names* are not readable on disk).
- **Project** = `projects/<projectId>/project.db` (SQLCipher, raw key = `subkey(libraryKey, 'trama.project.v1', utf8(projectId))`) + `projects/<projectId>/blobs/` (original files and media, sealed with XChaCha20-Poly1305 frames under `subkey(projectKey, 'trama.files.v1')`, context `blob:<blobId>`).
- The library key never changes; changing the passphrase or recovery phrase rewraps one slot. Unlocking with the recovery phrase forces choosing a new passphrase.
- Rust knows no schema: it runs SQL it is given (`db_open {project,keyHex,create}`, `db_exec`, `db_query`, `db_batch`, `db_script`, `db_close`). One project is open at a time.
- The example library (`trama-desktop --example`, passphrase `trama`) lives in a separate folder emptied at every start and exit; it must never touch the researcher's own library.

### Data model (core/model/types.ts)

Kinds: `coder`, `document`, `doctext` (the text, same id as its document), `code`, `coding`, `docgroup`, `attribute`, `case`, `memo`, `pseudonym`, `log`, `setting`. Each is one table: base columns, the record as JSON in `data`, and indexed columns copied out of it (`core/store/schema.ts`).

- **Offsets.** Every `start`/`end` is a UTF-16 offset into the canonical text, half-open `[start, end)`. Canonical text: LF line endings, no BOM, NFC. REFI-QDA counts Unicode code points; convert only at that boundary (`core/qda/offsets.ts`).
- **Paragraphs** are runs separated by `\n`. Transcripts keep one speaker turn per paragraph (`Speaker: text`) and `doctext.sync` holds timestamps (`{pos, ms}`) for media playback.
- **A coding** is one code on one span by one coder. Several codes on the same span are several codings. `coding.text` mirrors the coded text and must be kept in step when the document text changes.
- **Editing a document's text** (typo fixes, pseudonymisation) must remap every coding and sync point through the edit (`core/qda/ranges.ts`); codings that collapse to nothing are removed.
- **Me.** Who codes on this computer is device-local: store meta key `me` = a coder id. A teammate opening a copy picks or creates their coder.
- **Writes go through `Store`**, which validates, stamps a hybrid logical clock and notifies subscribers; screens read through `useLive` so they refresh on change. Deletes are tombstones (`deleted = 1`). `Store.merge` keeps the newer version of each record — that is how a teammate's copy merges (same project id, same record ids).
- **Audit trail.** Domain services append a `log` record for meaningful changes (see `LOG_ACTIONS`). Never edit or delete log entries.
- **Pseudonymisation key** (`pseudonym` records) is personal data: excluded from every export and backup-less file (qdpx, csv, docx) unless the researcher explicitly includes it.
- Schema changes are new entries appended to `MIGRATIONS` — never edit a shipped one (`schema.test.ts` pins migration 1).

### Services (app/src/services)

- `library.ts` — `Library.state(platform)`, `Library.create(platform, {passphrase, recoveryPhrase})`, `Library.unlock(platform, slot, secret)`, `library.projects` (list of `ProjectInfo {id, name, description, color, created_at, opened_at}`), `createProject`, `openProject(id) → Project`, `updateProject`, `deleteProject`, `changeSecret`, `changePassphrase`, `lock()`. Keys are wiped on lock; copy keys before any await that must outlive a lock.
- `project.ts` — `Project {id, info, store, platform, me: Coder}`, `addBlob(bytes, filename, mime) → MediaRef`, `readBlob(ref)`, `removeBlob(ref)`, `log(action, summary, target?)`, `close()`.
- Domain services (`documents.ts`, `codes.ts`, `codings.ts`, `memos.ts`, `cases.ts`, `groups.ts`, `pseudonyms.ts`) hold every multi-record operation (create a document with its text, delete a code with its codings, merge codes, apply/remove a coding, edit text with remapping…). Screens call these, not raw `store.put`, for anything beyond a one-field edit. `undo.ts` keeps an in-memory undo/redo stack of reversible operations for the open project.
- `backup.ts` / `datafile.ts` — automatic encrypted backups to a chosen folder, `.trama` export/import (optionally password-protected), restore, merge a teammate's copy.

### Speech (recording a call, transcribing recordings)

Desktop only (`platform.speech`; absent in the browser demo, where the screens say so).

- **The model ships with the app.** `tools/fetch-speech-models.mjs` downloads whisper.cpp's `ggml-large-v3-turbo-q5_0.bin` and Silero VAD at *build* time into `desktop/src-tauri/resources/speech/` (gitignored), checking pinned SHA-256s; `tauri.speech.conf.json` bundles them and only release builds pass it (`--config`), so `cargo test`/clippy never need them. The shell finds them in its resources, `TRAMA_SPEECH_DIR`, or (debug) `resources/speech/`. The app itself downloads nothing.
- **whisper.cpp is built for other people's CPUs**: `.cargo/config.toml` sets `GGML_NATIVE=OFF` + AVX2/FMA/F16C; the shell refuses transcription on x86-64 without them (`UNSUPPORTED_CPU`). macOS minimum is 14.2 (cpal's Core Audio taps).
- **Transcription** (`speech/transcribe.rs`): Silero VAD finds speech, the stretches are joined with short pauses and transcribed, and times are mapped back word by word (DTW token times), cutting segments at real pauses — whisper.cpp's own VAD only runs in `whisper_full`, not the `whisper_full_with_state` whisper-rs calls, and its segment starts after a pause are unreliable. Do not use whisper-rs 0.16's `set_abort_callback_safe`: its trampoline reads the closure as the wrong type (random aborts); `abort_if_cancelled` is the raw replacement. A call recorded in Trama has two channels (left: microphone, right: what the computer played) transcribed apart (`channels: 'split'`); `core/speech/transcript.ts` interleaves them into turns and drops microphone segments that repeat the other side (echo without headphones).
- **Recording** (`speech/capture.rs`, `services/recording.ts`): two cpal streams (Linux: the PulseAudio monitor of the default output; Windows: WASAPI loopback; macOS: process tap), resampled to 16 kHz and kept in step with the clock (WASAPI sends nothing during silence). The UI takes the PCM every 400 ms and seals it into the blob in 256 KiB frames (`blobs.append`); the WAV length in frame 0 is rewritten at the stop (`blobs.writeAt`). Store meta `recording.open` marks a recording in progress: `afterOpen` recovers it after a crash and the blob sweep spares it. Recording holds the idle auto-lock off and is saved by a saver before any lock.
- **Queue**: store meta `speech.queue` (device-local), run one at a time by `features/speech/controller.ts`; a transcript is only written into a document without text (`fillTranscript`, one undo step, audit entry naming the engine).
- Tests: `platform/fakeSpeech.ts` stands in for the shell (also `?speech=fake` in the demo, for screenshots). Opt-in real runs: `TRAMA_SPEECH_SAMPLE=<file> [TRAMA_SPEECH_CHANNELS=split] cargo test --release transcribes_a_sample -- --ignored --nocapture`, and `record_from_devices` for the devices. The desktop e2e transcribes a flite-synthesised sample when ffmpeg and the model are present.

### UI (app/src/ui, app/src/shell, app/src/features)

- **Plain React DOM** (React 18) with CSS. Styles live in `.css` files next to components using CSS custom properties from `ui/tokens.css` (light and dark). Inline `style={{}}` is allowed for computed values (positions, code colours). Icons: `lucide-react`. Fonts are self-hosted via `@fontsource-variable` (Instrument Sans for the interface, Literata for document text) — never a font CDN.
- **Styles in the desktop app depend on `dangerousDisableAssetCspModification: ["style-src"]`** in `tauri.conf.json`: Tauri otherwise adds a nonce to `style-src`, WebKit then ignores `'unsafe-inline'` and every inline style is dropped while the browser demo still looks fine. The desktop e2e test checks the real app's layout for this reason.
- **No DOM APIs in `core/`.** `services/` may not touch the DOM either (they run in Vitest).
- Every interactive element a test needs has a `data-testid`.
- Keyboard first: every action reachable by keyboard; shortcuts shown with `useKeyLabel()` (⌘ on macOS, Ctrl elsewhere).
- Test UI at a fractional scale too (Playwright `deviceScaleFactor: 1.25`, or `GDK_DPI_SCALE=1.25` for the desktop app): WebKit rounds sizes, and an auto-growing field that follows `scrollHeight` exactly can grow on every render (use `ui/grow.ts`).
- Release builds have no developer console: the error boundary shows the error as selectable text.

## Languages

Everything user-facing ships in **English, European Portuguese (pt-PT) and European Spanish (es-ES)**: the UI, the manual, privacy text, release notes.

- UI strings: `app/src/core/i18n/locales/en/<namespace>.ts` is the source of truth; `pt/<namespace>.ts` and `es/<namespace>.ts` are typed `Messages['<namespace>']`, so a missing key fails `npm run typecheck`. Add a key to all three in the same change. Use `t('namespace.key')` and plurals `tp('namespace.key', n)` with `{ one, other }` objects.
- Portuguese is European (ecrã, ficheiro, palavra-passe, frase de recuperação, guardar, eliminar, utilizador). Spanish is from Spain (ordenador, contraseña, archivo, guardar). Address the reader formally (você implied / usted).
- Glossary (keep consistent everywhere):

| English | Português | Español |
|---|---|---|
| project | projeto | proyecto |
| document | documento | documento |
| code | código | código |
| codebook | livro de códigos | libro de códigos |
| coded segment | segmento codificado | segmento codificado |
| coding (the act) | codificação | codificación |
| memo | memorando | memorando |
| case | caso | caso |
| attribute | atributo | atributo |
| document group | grupo de documentos | grupo de documentos |
| coder | codificador | codificador |
| inter-coder agreement | concordância entre codificadores | acuerdo entre codificadores |
| co-occurrence | coocorrência | coocurrencia |
| pseudonymisation | pseudonimização | seudonimización |
| transcript | transcrição | transcripción |
| library | biblioteca | biblioteca |
| recovery phrase | frase de recuperação | frase de recuperación |
| passphrase | frase-passe | frase de contraseña |

## Privacy

Trama makes **no network connections**: there is no HTTP client, no update check, no telemetry. The Tauri capability file grants no network permission and the desktop e2e test checks that. `core/privacy/flows.ts` lists every way data can leave the computer (backups, exports, copies to the clipboard of segments) and generates `PRIVACY.md` (`npm run gen:privacy`); any feature that writes data outside the library must add an entry. Recording and transcription add none: audio and text stay in memory and in the encrypted project. The only download is the build's speech model fetch.

## What belongs in this repository

The app, its documentation (manual, specs, security notes) and tests. Never commit real research data, real interview transcripts or anything identifying a participant; test fixtures are fictional.

## Conventions

- TypeScript strict; `noUncheckedIndexedAccess` is on.
- Tests sit next to the code (`*.test.ts`). Core and services logic is tested in Node with `SqlJsDb` and the memory platform; use the fast KDF params `{algo:'argon2id', m:64, t:1, p:1, key_len:32}` in tests.
- Comments explain why, not what. Match the surrounding style.
- Commit messages: imperative summary line, then a short body when useful.

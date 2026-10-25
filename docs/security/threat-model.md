# Threat model (desktop, offline)

What Trama protects, against whom, and where the limits are. Reviewed whenever a feature changes how data is stored, or adds a way for data to leave the computer.

Trama is used for qualitative research data: interview and focus-group transcripts, recordings, field notes and participants' attributes. That material is personal data, often special-category data under the GDPR, and research ethics approvals usually require it to be stored encrypted, kept out of third-party cloud services and pseudonymised before it is shared.

## Assets

- **Research material**: documents and their text, original files (PDF, Word), audio and video recordings.
- **Analysis**: the codebook, coded segments and comments, memos, cases and attributes, document groups, the audit trail.
- **The pseudonymisation key**: the list pairing participants' real names and details with their pseudonyms. It re-identifies people and is the most sensitive single record in a project.
- **Metadata**: the names of projects and documents, which can themselves be revealing ("Interviews — HIV clinic, Porto").
- **Secrets**: the passphrase, the 12-word recovery phrase, the library key they unlock and the per-project keys derived from it.

## How data is protected

| Where | Protection |
|---|---|
| `keyring.json` | A random 256-bit **library key**, wrapped twice with AES-256-GCM: once under Argon2id(passphrase) and once under Argon2id(recovery phrase). Argon2id parameters: m = 64 MiB, t = 3, p = 4, a fresh 32-byte salt per slot. The file contains no usable secret on its own. Changing the passphrase or the recovery phrase rewraps one slot; the library key never changes. |
| Project list (`library.json`) | AES-256-GCM under a subkey of the library key (HKDF-SHA-256, label `trama.library.v1`), so even project names and descriptions are unreadable on disk. |
| Project database (`projects/<id>/project.db`) | **SQLCipher** (AES-256), opened with a **raw 256-bit key** derived per project: HKDF-SHA-256(library key, `trama.project.v1`, project id). No passphrase-based key derivation inside SQLCipher; each project has its own key. |
| Original files and recordings (`projects/<id>/blobs/`) | **XChaCha20-Poly1305** in authenticated 1 MiB frames, under a subkey of the project key (`trama.files.v1`). Each frame's associated data binds it to its file (`blob:<id>`), its position and whether it is the last, so frames cannot be reordered, swapped between files or truncated unnoticed. |
| A call being recorded | The audio (16-bit stereo, 16 kHz: the microphone and what the computer plays) stays in the shell's memory until the UI takes it, every fraction of a second; the UI seals it into the recording's blob in 256 KiB frames as it arrives (same framing and key), so unencrypted audio never touches the disk and a crash loses only the last seconds. The first frame is rewritten (same size) with the WAV length at the end; a recording cut short is closed and saved the next time the project opens. A device-local store meta key names the recording in progress. |
| Transcription | On this computer: the recording is decrypted in memory, handed to whisper.cpp in the shell and the text comes back to be written into the document. The speech model ships with the app (its files are checked against their SHA-256 when the app is built); nothing is downloaded or uploaded. The queue of recordings waiting to be transcribed is device-local store meta. |
| Automatic backups | The whole project as a `.trama` file, sealed with the same framing under a per-backup key derived from the library key (`trama.backup.v1` with a random salt). The keyring travels inside, so the passphrase or recovery phrase opens a backup on another computer. |
| Password-protected exports and teammate copies | Argon2id(password) with the same parameters as the keyring and a fresh salt, then the same authenticated framing. |
| Device preferences (`prefs.json`) | Not encrypted, because they are needed before unlocking. They hold only the interface language, the theme, the auto-lock delay and the id of the last project opened — never a name or any content. |
| While unlocked | Keys stay in memory while Trama is unlocked. Trama locks after a period without use (5–60 minutes, default 10), on `Ctrl+L` and when the window closes: it saves pending edits, closes the database and overwrites the key buffers it holds. Unlocking with the recovery phrase forces choosing a new passphrase. |
| Network | None. The Rust shell has no HTTP client; the Tauri capability file grants no network or opener permission; the content security policy allows no remote origin. There is no update check, no telemetry and no crash reporting. The desktop end-to-end test checks the capability set. |

## Threats considered

| Threat | Mitigation | Limits |
|---|---|---|
| Lost or stolen laptop, powered off or locked | Everything on disk is encrypted; nothing is readable without the passphrase or the recovery phrase, including project names. | A weak passphrase can be guessed offline. Argon2id makes each guess cost 64 MiB and noticeable time, and Trama requires at least 10 characters and shows a strength meter. |
| Someone uses the computer while Trama is open | Auto-lock after inactivity; manual lock with `Ctrl+L`. | Until it locks, whoever is at the keyboard sees what the researcher sees. |
| Backup drive, network share or cloud-sync folder read by someone else | Backups are encrypted and authenticated; tampering is detected on restore. | File names reveal that a Trama backup exists, when it was made, its size, and which backups belong to the same project (a six-hex-digit tag, an HKDF output of the project key under its own label, that reveals nothing about the key). |
| An exported file reaches the wrong person | `.trama` exports and teammate copies can be password-protected (proposed by default for teammate copies). The pseudonymisation key is excluded from every export unless explicitly included; deleted records are exported only as tombstones without content. REFI-QDA exports leave out the original PDF of any document whose text was edited (e.g. pseudonymised), because it would still show the removed names. | REFI-QDA files, codebooks, tables and reports are not encrypted — the formats and the programs that read them do not support it. The app says so where they are made, and lists every way out in Settings and `PRIVACY.md`. |
| Re-identification of participants in shared material | Pseudonymisation replaces names consistently across documents, remaps codings and time stamps, and keeps its key inside the encrypted project. Deleting a key entry erases the original immediately. | Suggestions only find capitalised words; indirect identifiers (job, street, rare events) need the researcher's reading. Original PDF and Word files keep the original text; they are excluded from REFI-QDA exports after edits but remain inside the encrypted project and its backups. |
| Network attacker, tracking, vendor access | No network code and no network permission. Nothing is sent to the developers or anyone else. | Installers come from wherever the researcher downloads them; verify the source. On Windows, the installer (not the app) may download Microsoft's WebView2 runtime if it is missing. |
| Malicious or malformed file imported (DOCX, PDF, RTF, QDPX, `.trama`) | Files are parsed as data only; nothing is executed. ZIP entries that could escape a folder (zip-slip) are refused and reported. REFI-QDA references to files outside the archive are never followed. `.trama` manifests carry SHA-256 hashes of every member. | Parsers (pdf.js, mammoth, XML) are third-party code and may have bugs; keep Trama updated. |
| Someone is recorded without knowing | Recording starts only after the researcher confirms that everyone on the call has agreed; a strip on every screen shows that a recording is running; the operating system shows its own microphone indicator. | Trama cannot verify consent, and it records whatever the computer plays while it runs, including other apps' sounds. |
| A transcript misattributes or invents words | Transcripts are only written into documents without text, never over the researcher's; the audit trail names the engine and model; the manual asks for a check against the recording before coding. Silence is cut out before the model hears it, which avoids most invented sentences. | Automatic transcription mishears names and overlapping speech, and can miss a very short reply. Several people on the other side of a call share one speaker name. |
| Teammate's copy overwrites work | Merging previews what comes in; per record the newer version wins; nothing is removed unless deleted on the other side after the last local change. Copies of a different project are refused. Every merge is logged. | A teammate with a wrong system clock can make their edits look newer. Coders are labels, not authenticated identities: anyone with a copy can type any name. |
| Tampering with the audit trail | Log entries are append-only through the app; the audit trail is inside the encrypted database. | Someone with the passphrase and database tools could edit the database directly. The trail documents work for ethics and methods purposes; it is not a forensic, signed log. |
| Compromised dependency or build | Lockfiles, pinned versions, a reviewed and small dependency set, CI builds from tagged commits with no secrets. | Installers are not yet code-signed. |

## Out of scope

- Malware running with the researcher's user rights on an unlocked computer: it can read the screen, the clipboard and the process memory.
- Forensic recovery of keys from memory or swap while Trama is unlocked. JavaScript strings (the passphrase as typed) cannot be reliably wiped.
- Losing **both** the passphrase and the recovery phrase: by design nobody, including the developers, can open the library.
- Data after it leaves Trama unencrypted (exports, the clipboard): its protection is the researcher's storage.
- Side channels, hardware attacks, and attackers who can modify the Trama binary on the researcher's computer.

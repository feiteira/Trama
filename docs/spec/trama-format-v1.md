# The `.trama` file, version 1

A `.trama` file holds one whole Trama project: its documents and their text, the codebook, the coded segments, memos, cases and attributes, the audit trail, and the original files and media. Trama writes it when a project is exported, handed to a teammate or backed up, and reads it to import, merge or restore. It is meant to stay readable without Trama.

A `.trama` file is either a plain ZIP archive or that ZIP inside an encrypted container.

## Plain file: a ZIP archive

| Path | Content |
|---|---|
| `manifest.json` | What the file holds (see below), including the SHA-256 of every other file. |
| `data/<kind>.jsonl` | Every record of that kind, one JSON object per line (UTF-8, LF), including deleted ones (`"deleted": true`). Kinds: `coder`, `document`, `doctext`, `code`, `coding`, `docgroup`, `attribute`, `case`, `memo`, `pseudonym`, `log`, `setting`. One file per kind, possibly empty. **This is the lossless copy Trama imports.** |
| `blobs/<blob id>` | Original files and media (PDF, Word, audio, video) exactly as they were added, unencrypted inside the archive. A document points at them through `original.blob_id` / `media.blob_id`. Blob ids match `[a-z0-9][a-z0-9._-]*`. Already-compressed media are stored without compression. |
| `readable/README.txt` | A short description of the archive. |
| `readable/documents/<name>.txt` | The text of each live document. |
| `readable/codebook.md` | The codebook as Markdown: the code hierarchy as headings, each code's definition, when to use it, when not to, and an example. |
| `readable/memos/<title>.md` | Each live memo. |

Everything under `readable/` is a convenience for people without Trama. Trama never reads it back; only `data/` and `blobs/` count. File names under `readable/` are made safe for every system (characters such as `/ \ : * ? " < > |` become `_`, names are cut at 80 characters (never inside a character: an emoji is kept whole or left out), duplicates get ` (2)`, ` (3)`…).

### manifest.json

```json
{
  "format": "trama-project",
  "version": 1,
  "app_version": "0.1.0",
  "created_at": "2026-10-05T12:00:00Z",
  "project": { "id": "<uuid or null>", "name": "…", "description": "…" },
  "counts": { "document": 12, "code": 40, "coding": 913, "…": 0 },
  "include_pseudonyms": false,
  "files": { "data/code.jsonl": "<sha256 hex>", "blobs/<id>": "<sha256 hex>", "…": "…" },
  "me": "<coder id>"
}
```

- `counts` counts live (not deleted) records per kind.
- `project.id` is the project's id. Two files with the same project id are copies of the same project, and can be merged.
- `me` appears in backups only: the coder who works on the computer that made the backup, so a restore does not need to ask.
- `include_pseudonyms`: the pseudonymisation key (`pseudonym` records, which pair real names with their replacements) is personal data. It is in the file only when the researcher explicitly included it (always in backups, which are encrypted); otherwise `data/pseudonym.jsonl` is empty.

Readers must:

- refuse a file whose `format` is not `trama-project`, or whose `version` is greater than they understand;
- verify every checksum in `files` for the entries they read (`data/`, `blobs/`), and refuse a file in which such an entry, or any entry other than `manifest.json` and those under `readable/`, is not listed in `files`. Entries under `readable/` are never read, so a damaged or missing readable copy does not make the file unreadable;
- check the uncompressed sizes the archive declares before inflating anything, and refuse an archive that would expand far beyond its own size (Trama: at most 2 GiB per blob, 512 MiB per other entry, and in all the larger of 1 GiB and 32 times the archive's size);
- refuse entry names that are absolute, contain `\`, a drive letter, or a `.`, `..` or empty path segment.

### Records

Every record has `id`, `created_at` (ISO 8601 UTC), `updated_at_hlc` and `deleted`, plus the fields of its kind (see `app/src/core/model/types.ts` in Trama's source code). `updated_at_hlc` is a hybrid logical clock stamp — 15-digit milliseconds, a 5-character base-36 counter and a device id, joined by `-` — and orders versions of a record by plain string comparison. When two versions of a record meet (a merge), the one with the greater stamp wins.

Text positions (`start`, `end` of a coding, `pos` of a transcript sync point) are UTF-16 code-unit offsets into the document's text (`doctext.text`), half-open `[start, end)`. The text is Unicode NFC with LF line endings and no byte-order mark. A `doctext` record has the same `id` as its `document`.

A deleted record may also carry:

| Field | Meaning |
|---|---|
| `deleted_batch` | An id shared by records deleted together, so they can be restored together. |
| `scrubbed` | `true` when the record's content is not in the file: it was erased for good, or the file is an export (see `content_omitted`). Its content fields hold empty values; it cannot be restored from this file. |
| `content_omitted` | `true` in an export, never in a backup: the deleted record was written without its content, so a file handed to someone never holds what was deleted. On merge, a copy of the record that is already there and older keeps its content, marked deleted. |

Readers that do not know a field should ignore it.

## Encrypted file

```
offset 0   "TRAMAENC"            8 bytes
offset 8   header length         uint32, big-endian
offset 12  header                UTF-8 JSON, <header length> bytes
then       sealed ZIP
```

Header, password mode (exports):

```json
{ "format": "trama-encrypted", "v": 1, "mode": "password",
  "kdf": { "algo": "argon2id", "m": 65536, "t": 3, "p": 4, "key_len": 32, "salt": "<base64, 32 bytes>" } }
```

The key is Argon2id(password as UTF-8 of its Unicode NFC form, salt, m KiB, t passes, p lanes, 32 bytes).

Header, library-key mode (backups):

```json
{ "format": "trama-encrypted", "v": 1, "mode": "library-key", "salt": "<base64, 32 bytes>", "keyring": { … } }
```

The keyring is the library's `keyring.json`: two AES-256-GCM-wrapped copies of the 32-byte library key, one under Argon2id of the passphrase (NFC) and one under Argon2id of the 12-word BIP-39 recovery phrase (trimmed, lower case, single spaces), each with its own salt, nonce and parameters; the GCM associated data is `"trama.keyring.v1"`. The file key is HKDF-SHA-256(input key = library key, salt = header salt, info = `"trama.backup.v1"`, 32 bytes). A backup therefore opens on another computer with the original passphrase or recovery phrase.

Sealed data:

```
"TRAMF1" | frame size (uint32, big-endian) | frame…
frame = nonce (24 bytes) | XChaCha20-Poly1305 ciphertext of up to <frame size> bytes (+16-byte tag)
```

Each frame's associated data is `context | frame index (uint32 BE) | last-frame flag (1 byte: 1 for the last frame, else 0)`, with `context = "trama.file.v1:" + hex(SHA-256(header bytes))`. This binds every frame to its header and position and detects reordering and truncation. An empty ZIP still has one (empty) frame.

## Backup file names

Backups are named `Trama backup <tag> <yyyy-MM-dd HHmmss>.trama`, in the local time of the computer that made them. `<tag>` is six hex digits derived from the project's key, so several projects (and several computers) can share one backup folder without one thinning out another's backups.

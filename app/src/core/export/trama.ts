import { sha256 } from '@noble/hashes/sha2.js';
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { concatBytes, fromBase64, fromUtf8, randomBytes, readU32be, toBase64, toHex, u32be, utf8, wipe } from '../bytes';
import { open, seal } from '../crypto/frames';
import { ARGON2_PARAMS, type Kdf, type KdfParams, normalizePassphrase } from '../crypto/kdf';
import { type Keyring, type SlotKind, subkey, unlockKeyring } from '../crypto/keyring';
import { parseHlc } from '../hlc';
import type { Code, DocText, Document, Entity, Kind, Memo } from '../model/types';
import { KINDS } from '../model/types';
import type { BundleRecord, ProjectBundle } from './bundle';

// The .trama file: one ZIP holding a whole project in open formats (docs/spec/trama-format-v1.md).
// It may be wrapped in an encrypted container, either under a password the researcher chooses
// (exports) or under the library key with the keyring alongside (backups), so a backup opens on
// another computer with the original passphrase or recovery phrase.

export const FORMAT = 'trama-project';
export const FORMAT_VERSION = 1;

/** Blob ids become file names, inside the archive and in the project folder. */
const BLOB_PATH_ID = /^[a-z0-9][a-z0-9._-]*$/;

export interface Manifest {
  format: typeof FORMAT;
  version: number;
  app_version: string;
  created_at: string;
  project: { id: string | null; name: string; description: string };
  /** Live records per kind. */
  counts: Partial<Record<Kind, number>>;
  include_pseudonyms: boolean;
  /** Path → SHA-256 (hex) of every other file in the archive. */
  files: Record<string, string>;
  /** Backups only: the coder who made it (device-local `me`), so a restore needs no "who are you?". */
  me?: string | null;
}

export interface BuildOptions {
  appVersion: string;
  /** The pseudonymisation key is personal data: left out unless explicitly included. */
  includePseudonyms?: boolean;
  now?: Date;
  /** README.txt text; a plain English description by default. */
  readme?: string;
  me?: string | null;
}

/** A bundle read from a .trama file, with the manifest it came with. */
export interface TramaBundle extends ProjectBundle {
  manifest: Manifest;
}

export type NotTramaReason =
  | 'unknown-type' | 'not-zip' | 'no-manifest' | 'format' | 'newer-version' | 'checksum' | 'unlisted-file'
  | 'unsafe-path' | 'bad-record' | 'header';

export class NotTramaFileError extends Error {
  constructor(readonly reason: NotTramaReason, detail = '') {
    super(`This is not a Trama project file, or it is damaged (${reason}${detail ? `: ${detail}` : ''}).`);
  }
}

// ── Writing ────────────────────────────────────────────────────────────────────────────

const ALREADY_COMPRESSED = /^(image\/(jpeg|png|webp|gif|heic|avif)|application\/(pdf|zip|gzip|vnd\.openxmlformats|vnd\.oasis)|video\/|audio\/)/;

/** Media that compressing again would only slow down: by type, or by its first bytes. */
function alreadyCompressed(mime: string | undefined, bytes: Uint8Array): boolean {
  if (mime && ALREADY_COMPRESSED.test(mime)) return true;
  const head = toHex(bytes.subarray(0, 8));
  // PDF, PNG, JPEG, ZIP (docx, odt), gzip, MP3, Ogg, WebM/MKV, FLAC; then MP4/MOV/M4A/HEIC ("ftyp").
  return /^(25504446|89504e47|ffd8ff|504b0304|1f8b|494433|fff[23b]|4f676753|1a45dfa3|664c6143)/.test(head) || toHex(bytes.subarray(4, 8)) === '66747970';
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

/** A file name that is valid on every desktop system, for the readable copies. */
export function safeName(s: string, fallback = 'untitled'): string {
  const name = s
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '');
  if (!name) return fallback;
  return RESERVED.test(name) ? `_${name}` : name;
}

function uniquePath(used: Set<string>, dir: string, base: string, ext: string): string {
  let path = `${dir}/${base}${ext}`;
  for (let i = 2; used.has(path.toLowerCase()); i++) path = `${dir}/${base} (${i})${ext}`;
  used.add(path.toLowerCase());
  return path;
}

const DEFAULT_README = `Trama project file (.trama), format version 1
=============================================

This archive holds a qualitative research project made with Trama, in open formats.

manifest.json     what the file holds, and the SHA-256 checksum of every other file
data/<kind>.jsonl every record (documents, codes, coded segments, memos, cases, ...),
                  one JSON object per line. This is the copy Trama reads back.
blobs/<id>        original files and media (PDF, audio, video) exactly as they were added
readable/         plain copies to read without Trama: the documents' text, the codebook
                  and the memos. Trama ignores this folder when it opens the file.

Text positions (start, end) count UTF-16 code units in the document's text.
The full specification is docs/spec/trama-format-v1.md in Trama's source code.
`;

function codebookMarkdown(projectName: string, codes: Code[]): string {
  const live = codes.filter((c) => !c.deleted);
  const ids = new Set(live.map((c) => c.id));
  const children = new Map<string | null, Code[]>();
  for (const c of live) {
    // A code whose parent is gone sits at the top rather than disappearing.
    const parent = c.parent_id && ids.has(c.parent_id) ? c.parent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), c]);
  }
  for (const list of children.values()) list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const lines = [`# Codebook — ${projectName}`, ''];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const c of children.get(parent) ?? []) {
      if (seen.has(c.id)) continue; // a cycle left by a bad merge must not loop forever
      seen.add(c.id);
      lines.push(`${'#'.repeat(Math.min(depth + 2, 6))} ${c.name}${c.codable ? '' : ' (category)'}`, '');
      const field = (label: string, v: string) => {
        if (v.trim()) lines.push(`**${label}:** ${v.trim()}`, '');
      };
      field('Definition', c.description);
      field('When to use', c.inclusion);
      field('When not to use', c.exclusion);
      field('Example', c.example);
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  // Codes caught in a parent cycle never hang below the top: list them too.
  for (const c of live) if (!seen.has(c.id)) lines.push(`## ${c.name}`, '');
  return lines.join('\n');
}

/** Builds the (unencrypted) ZIP of a project bundle. Records are written as they are. */
export function buildTramaZip(bundle: ProjectBundle, opts: BuildOptions): Uint8Array {
  const now = opts.now ?? new Date();
  const includePseudonyms = !!opts.includePseudonyms;
  const files: Zippable = {};
  const hashes: Record<string, string> = {};
  const add = (path: string, bytes: Uint8Array, compress = true) => {
    files[path] = [bytes, { level: compress ? 6 : 0 }];
    hashes[path] = toHex(sha256(bytes));
  };

  const byKind = new Map<Kind, Entity<Kind>[]>(KINDS.map((k) => [k, []]));
  for (const r of bundle.records) {
    if (r.kind === 'pseudonym' && !includePseudonyms) continue;
    byKind.get(r.kind)?.push(r.record);
  }

  // 1. Lossless records, one JSON object per line, tombstones included (a merge needs deletes).
  const counts: Partial<Record<Kind, number>> = {};
  for (const [kind, list] of byKind) {
    counts[kind] = list.filter((r) => !r.deleted).length;
    add(`data/${kind}.jsonl`, utf8(list.map((r) => JSON.stringify(r)).join('\n') + (list.length ? '\n' : '')));
  }

  // 2. Original files and media, as they were added.
  const mimes = new Map<string, string>();
  for (const d of byKind.get('document') as Document[]) {
    for (const ref of [d.original, d.media]) if (ref) mimes.set(ref.blob_id, ref.mime);
  }
  for (const [id, bytes] of bundle.blobs) {
    if (!BLOB_PATH_ID.test(id)) throw new Error(`invalid blob id: ${id}`);
    add(`blobs/${id}`, bytes, !alreadyCompressed(mimes.get(id), bytes));
  }

  // 3. Readable copies, for people without Trama. The importer never reads them.
  const used = new Set<string>();
  const texts = new Map((byKind.get('doctext') as DocText[]).filter((t) => !t.deleted).map((t) => [t.id, t.text]));
  const docs = (byKind.get('document') as Document[]).filter((d) => !d.deleted).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  for (const d of docs) {
    const text = texts.get(d.id);
    if (text === undefined) continue;
    add(uniquePath(used, 'readable/documents', safeName(d.name), '.txt'), utf8(text));
  }
  add('readable/codebook.md', utf8(codebookMarkdown(bundle.project.name, byKind.get('code') as Code[])));
  for (const m of (byKind.get('memo') as Memo[]).filter((x) => !x.deleted)) {
    add(uniquePath(used, 'readable/memos', safeName(m.title, 'memo'), '.md'), utf8(`# ${m.title || 'Memo'}\n\n${m.body}\n`));
  }
  add('readable/README.txt', utf8(opts.readme ?? DEFAULT_README));

  const manifest: Manifest = {
    format: FORMAT,
    version: FORMAT_VERSION,
    app_version: opts.appVersion,
    created_at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    project: { id: bundle.project.id, name: bundle.project.name, description: bundle.project.description },
    counts,
    include_pseudonyms: includePseudonyms,
    files: hashes,
    ...(opts.me !== undefined ? { me: opts.me } : {}),
  };
  files['manifest.json'] = [utf8(JSON.stringify(manifest, null, 2)), { level: 6 }];
  // ZIP timestamps cannot go before 1980; a clock that wrong must not break the export.
  return zipSync(files, { mtime: now.getFullYear() < 1980 ? new Date(1980, 0, 1) : now });
}

// ── Reading ────────────────────────────────────────────────────────────────────────────

/**
 * Archive paths are only ever looked up, never written to disk, but a path that could escape
 * a folder (zip-slip) or means different things on different systems marks a forged file.
 */
export function isSafePath(path: string): boolean {
  if (!path || path.length > 1024 || path.startsWith('/') || path.includes('\\') || path.includes('\u0000')) return false;
  if (/^[a-zA-Z]:/.test(path)) return false;
  const parts = path.replace(/\/$/, '').split('/');
  return parts.every((p) => p !== '' && p !== '.' && p !== '..');
}

function parseJson(bytes: Uint8Array, reason: NotTramaReason, what: string): unknown {
  try {
    return JSON.parse(fromUtf8(bytes)) as unknown;
  } catch {
    throw new NotTramaFileError(reason, what);
  }
}

function checkRecord(kind: Kind, r: unknown): Entity<Kind> {
  const rec = r as Partial<Entity<Kind>> | null;
  const ok =
    !!rec && typeof rec === 'object' && !Array.isArray(rec) &&
    typeof rec.id === 'string' && rec.id.length > 0 && rec.id.length <= 200 &&
    typeof rec.created_at === 'string' && typeof rec.deleted === 'boolean' && typeof rec.updated_at_hlc === 'string';
  if (!ok) throw new NotTramaFileError('bad-record', kind);
  try {
    parseHlc(rec.updated_at_hlc!);
  } catch {
    throw new NotTramaFileError('bad-record', `${kind} ${rec.id}`);
  }
  return rec as Entity<Kind>;
}

/** Reads and verifies an unencrypted .trama ZIP. */
export function readTramaZip(zip: Uint8Array): TramaBundle {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip);
  } catch {
    throw new NotTramaFileError('not-zip');
  }
  for (const path of Object.keys(files)) {
    if (!isSafePath(path)) throw new NotTramaFileError('unsafe-path', path);
  }
  const rawManifest = files['manifest.json'];
  if (!rawManifest) throw new NotTramaFileError('no-manifest');
  const manifest = parseJson(rawManifest, 'no-manifest', 'manifest.json') as Manifest;
  if (!manifest || typeof manifest !== 'object' || manifest.format !== FORMAT) throw new NotTramaFileError('format');
  if (typeof manifest.version !== 'number' || manifest.version > FORMAT_VERSION) throw new NotTramaFileError('newer-version', String(manifest.version));
  if (!manifest.files || typeof manifest.files !== 'object') throw new NotTramaFileError('no-manifest', 'files');
  for (const [path, hash] of Object.entries(manifest.files)) {
    if (!isSafePath(path)) throw new NotTramaFileError('unsafe-path', path);
    const bytes = files[path];
    if (!bytes || typeof hash !== 'string' || toHex(sha256(bytes)) !== hash.toLowerCase()) throw new NotTramaFileError('checksum', path);
  }
  // What the importer reads must be covered by a checksum: nothing slipped in afterwards.
  for (const [path, bytes] of Object.entries(files)) {
    if (path === 'manifest.json' || (path.endsWith('/') && bytes.length === 0)) continue;
    if (!(path in manifest.files)) throw new NotTramaFileError('unlisted-file', path);
  }

  // The newest version of a record wins should one appear twice.
  const byId = new Map<string, BundleRecord>();
  for (const kind of KINDS) {
    const raw = files[`data/${kind}.jsonl`];
    if (!raw) continue;
    const lines = fromUtf8(raw).split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new NotTramaFileError('bad-record', kind);
      }
      const record = checkRecord(kind, parsed);
      const key = `${kind}\u0000${record.id}`;
      const prev = byId.get(key);
      if (!prev || prev.record.updated_at_hlc < record.updated_at_hlc) byId.set(key, { kind, record } as BundleRecord);
    }
  }

  const blobs = new Map<string, Uint8Array>();
  for (const [path, bytes] of Object.entries(files)) {
    if (!path.startsWith('blobs/')) continue;
    const id = path.slice('blobs/'.length);
    if (!BLOB_PATH_ID.test(id)) throw new NotTramaFileError('unsafe-path', path);
    blobs.set(id, bytes);
  }

  const project = manifest.project ?? { id: null, name: '', description: '' };
  return {
    manifest,
    project: {
      id: typeof project.id === 'string' && project.id ? project.id : null,
      name: typeof project.name === 'string' ? project.name : '',
      description: typeof project.description === 'string' ? project.description : '',
      origin: `Trama ${manifest.app_version ?? ''}`.trim(),
    },
    records: [...byId.values()],
    blobs,
    warnings: [],
  };
}

// ── Encrypted container ────────────────────────────────────────────────────────────────

// "TRAMAENC" (8 bytes) | header length (u32 BE, at offset 8) | header JSON (from offset 12) | sealed ZIP
const MAGIC = utf8('TRAMAENC');
const HEADER_AT = MAGIC.length + 4;
const HEADER_MAX = 1 << 20;
const ENC_FORMAT = 'trama-encrypted';

type Header =
  | { format: typeof ENC_FORMAT; v: 1; mode: 'password'; kdf: KdfParams & { salt: string } }
  | { format: typeof ENC_FORMAT; v: 1; mode: 'library-key'; salt: string; keyring: Keyring };

export type Protection = Header['mode'] | 'none';

const context = (headerBytes: Uint8Array) => `trama.file.v1:${toHex(sha256(headerBytes))}`;

/** The key of a backup file: HKDF of the library key with the file's own salt. */
export const backupFileKey = (libraryKey: Uint8Array, salt: Uint8Array) => subkey(libraryKey, 'trama.backup.v1', salt);

function wrap(header: Header, key: Uint8Array, zip: Uint8Array): Uint8Array {
  const h = utf8(JSON.stringify(header));
  return concatBytes(MAGIC, u32be(h.length), h, seal(key, zip, context(h)));
}

export async function encryptWithPassword(zip: Uint8Array, password: string, kdf: Kdf, params: KdfParams = ARGON2_PARAMS): Promise<Uint8Array> {
  if (!password) throw new Error('empty password');
  const salt = randomBytes(32);
  const key = await kdf(utf8(normalizePassphrase(password)), salt, params);
  try {
    return wrap({ format: ENC_FORMAT, v: 1, mode: 'password', kdf: { ...params, salt: toBase64(salt) } }, key, zip);
  } finally {
    wipe(key);
  }
}

/** Backups: encrypted under the library key, restorable with the passphrase or recovery phrase. */
export function encryptWithLibraryKey(zip: Uint8Array, libraryKey: Uint8Array, keyring: Keyring): Uint8Array {
  const salt = randomBytes(32);
  const key = backupFileKey(libraryKey, salt);
  try {
    return wrap({ format: ENC_FORMAT, v: 1, mode: 'library-key', salt: toBase64(salt), keyring }, key, zip);
  } finally {
    wipe(key);
  }
}

const startsWith = (bytes: Uint8Array, prefix: Uint8Array) => bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);

/** How a file is protected. Throws NotTramaFileError for anything that is not a .trama file. */
export function protectionOf(bytes: Uint8Array): Protection {
  // A ZIP starts with a local file header, or with the end record when it is empty.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6))) return 'none';
  if (startsWith(bytes, MAGIC)) return readHeader(bytes).header.mode;
  throw new NotTramaFileError('unknown-type');
}

function readHeader(bytes: Uint8Array): { header: Header; headerBytes: Uint8Array; body: Uint8Array } {
  if (bytes.length < HEADER_AT) throw new NotTramaFileError('header', 'truncated');
  const len = readU32be(bytes, MAGIC.length);
  if (len === 0 || len > HEADER_MAX || HEADER_AT + len > bytes.length) throw new NotTramaFileError('header', 'length');
  const headerBytes = bytes.subarray(HEADER_AT, HEADER_AT + len);
  const header = parseJson(headerBytes, 'header', 'json') as Header;
  if (!header || header.format !== ENC_FORMAT) throw new NotTramaFileError('header', 'format');
  if (header.v !== 1) throw new NotTramaFileError('newer-version', `encryption v${String(header.v)}`);
  if (header.mode === 'password') {
    if (!header.kdf || header.kdf.algo !== 'argon2id' || typeof header.kdf.salt !== 'string') throw new NotTramaFileError('header', 'kdf');
  } else if (header.mode === 'library-key') {
    if (typeof header.salt !== 'string' || !header.keyring || !Array.isArray(header.keyring.slots)) throw new NotTramaFileError('header', 'keyring');
  } else {
    throw new NotTramaFileError('header', 'mode');
  }
  return { header, headerBytes, body: bytes.subarray(HEADER_AT + len) };
}

/** The keyring a backup carries, without unlocking anything (null for other files). */
export function keyringOf(bytes: Uint8Array): Keyring | null {
  if (protectionOf(bytes) !== 'library-key') return null;
  const { header } = readHeader(bytes);
  return header.mode === 'library-key' ? header.keyring : null;
}

export type Unlock =
  | { kind: 'none' }
  | { kind: 'password'; password: string }
  | { kind: 'secret'; slot: SlotKind; secret: string }
  | { kind: 'library-key'; libraryKey: Uint8Array };

/** The file needs a different way to open it (a password, a passphrase…). */
export class UnlockRequiredError extends Error {
  constructor(readonly protection: Protection) {
    super(`this file is protected (${protection})`);
  }
}

/**
 * Returns the ZIP inside a .trama file. Throws DecryptError (core/crypto/frames) for a wrong
 * password or a damaged file, WrongSecretError for a wrong passphrase or recovery phrase.
 * For backups it also returns the keyring they carry and, when unlocked with a secret, the
 * library key it unwrapped (the caller wipes it).
 */
export async function decryptTrama(
  bytes: Uint8Array,
  unlock: Unlock,
  kdf: Kdf,
): Promise<{ zip: Uint8Array; protection: Protection; keyring?: Keyring; libraryKey?: Uint8Array }> {
  const protection = protectionOf(bytes);
  if (protection === 'none') return { zip: bytes, protection };
  const { header, headerBytes, body } = readHeader(bytes);
  if (header.mode === 'password') {
    if (unlock.kind !== 'password') throw new UnlockRequiredError('password');
    const { salt, ...params } = header.kdf;
    const key = await kdf(utf8(normalizePassphrase(unlock.password)), fromBase64(salt), params);
    try {
      return { zip: open(key, body, context(headerBytes)), protection };
    } finally {
      wipe(key);
    }
  }
  let libraryKey: Uint8Array;
  let unwrapped = false;
  if (unlock.kind === 'library-key') libraryKey = unlock.libraryKey;
  else if (unlock.kind === 'secret') {
    libraryKey = await unlockKeyring(header.keyring, unlock.slot, unlock.secret, kdf);
    unwrapped = true;
  } else throw new UnlockRequiredError('library-key');
  const key = backupFileKey(libraryKey, fromBase64(header.salt));
  try {
    const zip = open(key, body, context(headerBytes));
    return { zip, protection, keyring: header.keyring, ...(unwrapped ? { libraryKey } : {}) };
  } catch (e) {
    if (unwrapped) wipe(libraryKey);
    throw e;
  } finally {
    wipe(key);
  }
}

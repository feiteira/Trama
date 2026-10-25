import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { fromHex, toHex } from '../core/bytes';
import { checkKdfParams, type Kdf } from '../core/crypto/kdf';
import type { Db, Row, SqlParam, SqlStatement } from '../core/store/db';
import {
  type AppInfo,
  type FileEntry,
  type FileFilter,
  type Platform,
  PlatformError,
  type RecorderStatus,
  type SpeechInfo,
  type TranscribeStatus,
  type Transcription,
} from './types';

// The desktop (and later phone) platform: every call goes to the Rust shell over Tauri's local
// IPC. Nothing here opens a network connection; there is no http or opener plugin.

type Args = Record<string, unknown> | Uint8Array;

async function call<T>(cmd: string, args?: Args, headers?: Record<string, string>): Promise<T> {
  try {
    return await invoke<T>(cmd, args, headers ? { headers } : undefined);
  } catch (e) {
    throw toPlatformError(e);
  }
}

/** The shell rejects with `{code, message}`; Tauri itself (unknown command, bad arguments) with a string. */
export function toPlatformError(e: unknown): PlatformError {
  if (e instanceof PlatformError) return e;
  if (typeof e === 'object' && e !== null) {
    const { code, message } = e as { code?: unknown; message?: unknown };
    if (typeof code === 'string' && code) return new PlatformError(code, typeof message === 'string' ? message : code);
    if (e instanceof Error) return new PlatformError('ERROR', e.message);
  }
  return new PlatformError('ERROR', String(e));
}

/** Binary responses arrive as an ArrayBuffer; older IPC paths may hand back a number array. */
function toBytes(r: ArrayBuffer | Uint8Array | number[]): Uint8Array {
  if (r instanceof Uint8Array) return r;
  if (r instanceof ArrayBuffer) return new Uint8Array(r);
  return Uint8Array.from(r);
}

/** A raw body is sent whole; a view into a larger buffer is copied so only its bytes go. */
function body(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
}

// Header values are percent-encoded: headers cannot carry non-ASCII paths (the shell decodes).
const h = (v: string) => encodeURIComponent(v);

/**
 * One project database is open at a time in the shell. Each handle names its project on every
 * call, so a handle kept after another project was opened fails with DB_NOT_OPEN instead of
 * reading or writing the other project.
 */
let openDb: TauriDb | null = null;

class TauriDb implements Db {
  private closed = false;
  constructor(readonly project: string) {}

  private check() {
    if (this.closed || openDb !== this) throw new PlatformError('DB_NOT_OPEN', 'this project database is closed');
  }
  async exec(sql: string, params: SqlParam[] = []) {
    this.check();
    return call<{ changes: number }>('db_exec', { project: this.project, sql, params });
  }
  async query<T extends Row = Row>(sql: string, params: SqlParam[] = []) {
    this.check();
    return call<T[]>('db_query', { project: this.project, sql, params });
  }
  async batch(statements: SqlStatement[]) {
    this.check();
    return call<number>('db_batch', {
      project: this.project,
      statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })),
    });
  }
  async script(sql: string) {
    this.check();
    return call<void>('db_script', { project: this.project, sql });
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    if (openDb === this) openDb = null;
    // Names the project: closing a stale handle must not close the project opened after it.
    await call<void>('db_close', { project: this.project });
  }
  /** The shell closed it (another project opened, the project or library was erased). */
  invalidate() {
    this.closed = true;
  }
}

function forgetOpenDb(project?: string) {
  if (openDb && (project === undefined || openDb.project === project)) {
    openDb.invalidate();
    openDb = null;
  }
}

export const tauriKdf: Kdf = async (secret, salt, params) => {
  if (params.algo !== 'argon2id') throw new PlatformError('INVALID', `unsupported KDF ${String(params.algo)}`);
  // Parameters may come from a file: bounded here as in the shell (kdf.rs).
  checkKdfParams(params);
  return fromHex(
    await call<string>('kdf_argon2id', {
      secretHex: toHex(secret),
      saltHex: toHex(salt),
      m: params.m,
      t: params.t,
      p: params.p,
      len: params.key_len,
    }),
  );
};

const PREFS_FILE = 'prefs.json';

/** prefs.json as a flat string map; anything else in it (a hand edit, an old format) is dropped. */
export function parsePrefs(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/**
 * Joins with the separator the folder already uses: backslashes only (or a bare drive) means
 * Windows. Windows also accepts "/", so a mixed path gets "/".
 */
export function joinPath(dir: string, name: string): string {
  if (dir.endsWith('/') || dir.endsWith('\\')) return dir + name;
  const windows = /^[A-Za-z]:$/.test(dir) || (dir.includes('\\') && !dir.includes('/'));
  return dir + (windows ? '\\' : '/') + name;
}

// Automated tests (WebDriver) cannot operate native file dialogs. A test may queue answers in
// window.__TRAMA_E2E_DIALOGS__; each dialog call takes the next one. Nothing sets it in normal use.
function queuedAnswer(): { hit: boolean; value: string | string[] | null } {
  const w = globalThis as unknown as { __TRAMA_E2E_DIALOGS__?: (string | string[] | null)[] };
  const q = w.__TRAMA_E2E_DIALOGS__;
  if (!Array.isArray(q) || q.length === 0) return { hit: false, value: null };
  return { hit: true, value: q.shift() ?? null };
}

const dialogFilters = (filters: FileFilter[]) =>
  // An empty filter list would hide every file on some systems; no filters means "all files".
  filters.filter((f) => f.extensions.length > 0).map((f) => ({ name: f.name, extensions: f.extensions.map((e) => e.replace(/^\./, '')) }));

// Every registered exit handler runs, together, before the window closes.
const exitHandlers = new Set<() => Promise<void>>();
let exitListening = false;
let exiting = false;

function listenForExit() {
  if (exitListening) return;
  exitListening = true;
  const win = getCurrentWindow();
  void win.onCloseRequested(async (event) => {
    // Every request is held back, a repeated one too: the first one's handlers are still
    // saving, and the window is closed when they are done.
    event.preventDefault();
    if (exiting) return;
    exiting = true;
    try {
      await Promise.allSettled([...exitHandlers].map((fn) => fn()));
    } finally {
      await win.destroy();
    }
  });
}

export function createTauriPlatform(): Platform {
  // Serialises preference updates: each one reads, merges and writes the whole file.
  let prefsQueue: Promise<unknown> = Promise.resolve();
  const readPrefs = async () => parsePrefs(await call<string | null>('app_file_read', { name: PREFS_FILE }));

  return {
    kind: 'desktop',
    info: () => call<AppInfo>('app_info'),
    prefs: {
      get: readPrefs,
      set(values) {
        const next = prefsQueue.then(async () => {
          const current = await readPrefs();
          await call('app_file_write', { name: PREFS_FILE, text: JSON.stringify({ ...current, ...values }, null, 2) });
        });
        prefsQueue = next.catch(() => undefined);
        return next;
      },
    },
    keyring: {
      read: () => call<string | null>('app_file_read', { name: 'keyring.json' }),
      write: (json) => call<void>('app_file_write', { name: 'keyring.json', text: json }),
    },
    libraryFile: {
      read: () => call<string | null>('app_file_read', { name: 'library.json' }),
      write: (text) => call<void>('app_file_write', { name: 'library.json', text }),
    },
    async eraseAll() {
      forgetOpenDb();
      await call<void>('erase_all');
    },
    projects: {
      list: () => call<string[]>('project_list'),
      exists: (id) => call<boolean>('project_exists', { project: id }),
      async open(id, key, create) {
        // The shell closes whatever was open, even if this open fails.
        forgetOpenDb();
        await call<void>('db_open', { project: id, keyHex: toHex(key), create });
        const db = new TauriDb(id);
        openDb = db;
        return db;
      },
      async erase(id) {
        forgetOpenDb(id);
        await call<void>('project_erase', { project: id });
      },
    },
    kdf: tauriKdf,
    blobs: {
      write: (project, id, bytes) => call<void>('blob_write', body(bytes), { 'x-project': h(project), 'x-blob-id': h(id) }),
      read: async (project, id) => toBytes(await call<ArrayBuffer>('blob_read', { project, id })),
      remove: (project, id) => call<void>('blob_delete', { project, id }),
      list: (project) => call<string[]>('blob_list', { project }),
      append: (project, id, bytes) => call<number>('blob_append', body(bytes), { 'x-project': h(project), 'x-blob-id': h(id) }),
      writeAt: (project, id, offset, bytes, truncate = false) =>
        call<void>('blob_write_at', body(bytes), { 'x-project': h(project), 'x-blob-id': h(id), 'x-offset': String(offset), 'x-truncate': truncate ? '1' : '0' }),
      readRange: async (project, id, offset, length) => toBytes(await call<ArrayBuffer>('blob_read_range', { project, id, offset, length })),
      size: (project, id) => call<number>('blob_size', { project, id }),
    },
    files: {
      read: async (path) => toBytes(await call<ArrayBuffer>('fs_read', { path })),
      write: (path, bytes) => call<void>('fs_write', body(bytes), { 'x-path': h(path) }),
      list: (path, recursive) => call<FileEntry[]>('fs_list', { path, recursive }),
      remove: (path) => call<void>('fs_remove', { path }),
      exists: (path) => call<boolean>('fs_exists', { path }),
      join: joinPath,
    },
    dialogs: {
      async pickFolder(title) {
        const q = queuedAnswer();
        if (q.hit) return typeof q.value === 'string' ? q.value : null;
        const r = await openDialog({ directory: true, multiple: false, title });
        return typeof r === 'string' ? r : null;
      },
      async pickFiles(title, filters, multiple) {
        const q = queuedAnswer();
        if (q.hit) return q.value === null ? [] : Array.isArray(q.value) ? q.value : [q.value];
        const r = await openDialog({ directory: false, multiple, title, filters: dialogFilters(filters) });
        if (!r) return [];
        return Array.isArray(r) ? r : [r];
      },
      async saveFile(title, defaultName, filters) {
        const q = queuedAnswer();
        if (q.hit) return typeof q.value === 'string' ? q.value : null;
        return (await saveDialog({ title, defaultPath: defaultName, filters: dialogFilters(filters) })) ?? null;
      },
    },
    speech: {
      info: () => call<SpeechInfo>('speech_info'),
      transcribe: {
        start: (bytes, opts) =>
          call<void>('transcribe_start', body(bytes), { 'x-ext': h(opts.ext), 'x-language': h(opts.language ?? ''), 'x-channels': opts.channels }),
        status: () => call<TranscribeStatus>('transcribe_status'),
        take: () => call<Transcription | null>('transcribe_take'),
        cancel: () => call<void>('transcribe_cancel'),
      },
      recorder: {
        start: () => call<RecorderStatus>('recorder_start'),
        status: () => call<RecorderStatus | null>('recorder_status'),
        take: async () => toBytes(await call<ArrayBuffer>('recorder_take')),
        stop: async () => toBytes(await call<ArrayBuffer>('recorder_stop')),
      },
    },
    setTitle: (title) => getCurrentWindow().setTitle(title),
    onBeforeExit(handler) {
      exitHandlers.add(handler);
      listenForExit();
      return () => void exitHandlers.delete(handler);
    },
  };
}

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

import { toHex } from '../core/bytes';
import { jsKdf } from '../core/crypto/kdf';
import type { Db } from '../core/store/db';
import { SqlJsDb } from './sqljs';
import { type AppInfo, type FileEntry, type Platform, PlatformError } from './types';

// A platform that keeps everything in memory: for tests, the browser demo and the
// screenshot pipeline. Nothing persists and nothing is encrypted at rest — the database "key"
// is only remembered, so a wrong one fails the way SQLCipher would.

export interface MemoryPlatformOptions {
  locateFile?: (file: string) => string;
  /** Files visible to "pick" dialogs and imports, keyed by absolute path. */
  files?: Map<string, Uint8Array>;
  /** What the pick dialogs return, in order. */
  dialogAnswers?: (string | string[] | null)[];
  /** What "choose a folder" returns once the queued answers run out. */
  defaultFolder?: string;
  /** Behave like the example library (`--example`): backups are refused. */
  example?: boolean;
  /** On-device speech (tests hand in a fake; the browser demo has none). */
  speech?: Platform['speech'];
}

export interface MemoryPlatform extends Platform {
  fileStore: Map<string, Uint8Array>;
  queueAnswer: (a: string | string[] | null) => void;
  /** Makes an empty folder exist (folders holding files exist anyway). */
  addDir: (path: string) => void;
  /** Raw (sealed) blob bytes of a project, for tests that look at what is stored. */
  blobStore: (project: string) => Map<string, Uint8Array>;
}

interface MemoryProject {
  db: SqlJsDb;
  keyHex: string;
  blobs: Map<string, Uint8Array>;
}

// The same rule the desktop shell applies to project and blob ids (they become file names).
const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/;

export function createMemoryPlatform(opts: MemoryPlatformOptions = {}): MemoryPlatform {
  const fileStore = opts.files ?? new Map<string, Uint8Array>();
  // When each file was last written; files handed in through `opts.files` count as very old.
  const mtimes = new Map<string, number>();
  // Folders that exist although nothing is in them yet: ones a dialog picked.
  const dirs = new Set<string>();
  const trim = (p: string) => (p.length > 1 ? p.replace(/\/$/, '') : p);
  if (opts.defaultFolder) dirs.add(trim(opts.defaultFolder));
  const answers = [...(opts.dialogAnswers ?? [])];
  const projects = new Map<string, MemoryProject>();
  // Blobs written before (or without) a database: the desktop shell creates the folder on write.
  const looseBlobs = new Map<string, Map<string, Uint8Array>>();
  let prefs: Record<string, string> = {};
  let keyring: string | null = null;
  let libraryFile: string | null = null;

  const next = () => (answers.length ? answers.shift()! : null);
  const notFound = (p: string) => new PlatformError('NOT_FOUND', `not found: ${p}`);
  const checkId = (what: string, id: string) => {
    if (!SAFE_ID.test(id)) throw new PlatformError('INVALID', `invalid ${what} id: ${id}`);
  };
  const blobsOf = (project: string, create: boolean): Map<string, Uint8Array> | null => {
    const p = projects.get(project);
    if (p) return p.blobs;
    let loose = looseBlobs.get(project);
    if (!loose && create) looseBlobs.set(project, (loose = new Map()));
    return loose ?? null;
  };
  const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-test';

  return {
    kind: 'demo',
    fileStore,
    queueAnswer: (a) => void answers.push(a),
    addDir: (path) => void dirs.add(trim(path)),
    blobStore: (project) => blobsOf(project, true)!,
    info: async (): Promise<AppInfo> => ({ version, os: 'web', data_dir: '/demo', example: !!opts.example }),
    ...(opts.speech ? { speech: opts.speech } : {}),
    prefs: {
      get: async () => ({ ...prefs }),
      set: async (v) => void (prefs = { ...prefs, ...v }),
    },
    keyring: {
      read: async () => keyring,
      write: async (json) => void (keyring = json),
    },
    libraryFile: {
      read: async () => libraryFile,
      write: async (text) => void (libraryFile = text),
    },
    eraseAll: async () => {
      keyring = null;
      libraryFile = null;
      projects.clear();
      looseBlobs.clear();
    },
    projects: {
      list: async () => [...projects.keys()].sort(),
      exists: async (id) => projects.has(id),
      async open(id, key, create): Promise<Db> {
        checkId('project', id);
        const hex = toHex(key);
        let p = projects.get(id);
        if (!p) {
          if (!create) throw notFound(`project ${id}`);
          p = { db: await SqlJsDb.create({ locateFile: opts.locateFile }), keyHex: hex, blobs: looseBlobs.get(id) ?? new Map() };
          looseBlobs.delete(id);
          projects.set(id, p);
        } else if (hex !== p.keyHex) {
          throw new PlatformError('WRONG_KEY', 'wrong key');
        }
        const inner = p.db;
        let closed = false;
        const live = () => {
          // A handle used after close (or after the project was erased) fails like the shell does.
          if (closed || projects.get(id)?.db !== inner) throw new PlatformError('NOT_OPEN', `project ${id} is not open`);
          return inner;
        };
        // Closing the handle must not destroy the in-memory database (it models a file).
        return {
          exec: async (s, prm) => live().exec(s, prm),
          query: async (s, prm) => live().query(s, prm),
          batch: async (s) => live().batch(s),
          script: async (s) => live().script(s),
          close: async () => void (closed = true),
        } as Db;
      },
      erase: async (id) => {
        projects.delete(id);
        looseBlobs.delete(id);
      },
    },
    kdf: jsKdf,
    blobs: {
      write: async (project, id, bytes) => {
        checkId('project', project);
        checkId('blob', id);
        blobsOf(project, true)!.set(id, bytes.slice());
      },
      read: async (project, id) => {
        const b = blobsOf(project, false)?.get(id);
        if (!b) throw notFound(`blob ${id}`);
        return b.slice();
      },
      remove: async (project, id) => void blobsOf(project, false)?.delete(id),
      list: async (project) => [...(blobsOf(project, false)?.keys() ?? [])].sort(),
      append: async (project, id, bytes) => {
        checkId('project', project);
        checkId('blob', id);
        const m = blobsOf(project, true)!;
        const cur = m.get(id) ?? new Uint8Array(0);
        const next = new Uint8Array(cur.length + bytes.length);
        next.set(cur);
        next.set(bytes, cur.length);
        m.set(id, next);
        return next.length;
      },
      writeAt: async (project, id, offset, bytes, truncate = false) => {
        const m = blobsOf(project, false);
        const cur = m?.get(id);
        if (!m || !cur) throw notFound(`blob ${id}`);
        if (offset > cur.length) throw new PlatformError('INVALID', 'offset past the end of the file');
        const end = offset + bytes.length;
        const next = new Uint8Array(truncate ? end : Math.max(cur.length, end));
        next.set(cur.subarray(0, Math.min(cur.length, next.length)));
        next.set(bytes, offset);
        m.set(id, next);
      },
      readRange: async (project, id, offset, length) => {
        const b = blobsOf(project, false)?.get(id);
        if (!b) throw notFound(`blob ${id}`);
        return b.slice(offset, offset + length);
      },
      size: async (project, id) => {
        const b = blobsOf(project, false)?.get(id);
        if (!b) throw notFound(`blob ${id}`);
        return b.length;
      },
    },
    files: {
      read: async (path) => {
        const b = fileStore.get(path);
        if (!b) throw notFound(path);
        return b.slice();
      },
      write: async (path, bytes) => {
        fileStore.set(path, bytes.slice());
        mtimes.set(path, Date.now());
        // The folders above it exist from now on, also once the file is removed again.
        for (let i = path.indexOf('/', 1); i > 0; i = path.indexOf('/', i + 1)) dirs.add(path.slice(0, i));
      },
      list: async (dir, recursive) => {
        const prefix = dir.endsWith('/') ? dir : `${dir}/`;
        const entries = new Map<string, FileEntry>();
        for (const [path, bytes] of fileStore) {
          if (!path.startsWith(prefix)) continue;
          const parts = path.slice(prefix.length).split('/');
          if (!recursive && parts.length > 1) {
            const d = prefix + parts[0];
            entries.set(d, { path: d, name: parts[0]!, is_dir: true, size: 0, modified_ms: 0, depth: 1 });
            continue;
          }
          for (let i = 1; i < parts.length; i++) {
            const d = prefix + parts.slice(0, i).join('/');
            entries.set(d, { path: d, name: parts[i - 1]!, is_dir: true, size: 0, modified_ms: 0, depth: i });
          }
          entries.set(path, { path, name: parts[parts.length - 1]!, is_dir: false, size: bytes.length, modified_ms: mtimes.get(path) ?? 0, depth: parts.length });
        }
        if (!entries.size && !dirs.has(trim(dir))) throw notFound(dir);
        return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
      },
      remove: async (path) => {
        fileStore.delete(path);
        mtimes.delete(path);
      },
      exists: async (path) => dirs.has(trim(path)) || fileStore.has(path) || [...fileStore.keys()].some((k) => k.startsWith(`${trim(path)}/`)),
      join: (dir, name) => `${dir.replace(/\/$/, '')}/${name}`,
    },
    dialogs: {
      pickFolder: async () => {
        const a = answers.length ? next() : (opts.defaultFolder ?? null);
        if (typeof a !== 'string') return null;
        dirs.add(trim(a)); // a folder the dialog showed exists
        return a;
      },
      pickFiles: async () => {
        const a = next();
        return a === null ? [] : Array.isArray(a) ? a : [a];
      },
      saveFile: async (_t, name) => {
        const a = answers.length ? next() : `/demo/exports/${name}`;
        return typeof a === 'string' ? a : null;
      },
    },
    setTitle: async () => {},
    onBeforeExit: () => () => {},
  };
}

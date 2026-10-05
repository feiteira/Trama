import { jsKdf } from '../core/crypto/kdf';
import { APP_VERSION } from '../loop/buildInfo';
import type { Db } from '../core/store/db';
import { SqlJsDb } from './sqljs';
import { type FileEntry, type Platform, PlatformError } from './types';

// A platform that keeps everything in memory: for tests, the browser demo and the
// screenshot pipeline. Nothing persists and nothing is encrypted at rest.

export interface MemoryPlatformOptions {
  locateFile?: (file: string) => string;
  /** Files visible to "pick" dialogs and imports, keyed by absolute path. */
  files?: Map<string, Uint8Array>;
  /** What the pick dialogs return, in order. */
  dialogAnswers?: (string | string[] | null)[];
  /** What "choose a folder" returns once the queued answers run out. */
  defaultFolder?: string;
  /** A stand-in for The Human Loop (tests and the demo). */
  http?: Platform['http'];
  /** Where "open a web page" goes (the demo opens a browser tab); links are also recorded. */
  openLink?: (url: string) => void;
}

export interface MemoryPlatform extends Platform {
  fileStore: Map<string, Uint8Array>;
  queueAnswer: (a: string | string[] | null) => void;
  openedLinks: string[];
  /** Makes an empty folder exist (folders holding files exist anyway). */
  addDir: (path: string) => void;
}

export function createMemoryPlatform(opts: MemoryPlatformOptions = {}): MemoryPlatform {
  const fileStore = opts.files ?? new Map<string, Uint8Array>();
  // When each file was last written; files handed in through `opts.files` count as very old.
  const mtimes = new Map<string, number>();
  // Folders that exist although nothing is in them yet: ones a dialog picked.
  const dirs = new Set<string>();
  const trim = (p: string) => (p.length > 1 ? p.replace(/\/$/, '') : p);
  if (opts.defaultFolder) dirs.add(trim(opts.defaultFolder));
  const openedLinks: string[] = [];
  const blobs = new Map<string, Uint8Array>();
  const answers = [...(opts.dialogAnswers ?? [])];
  let prefs: Record<string, string> = {};
  let keyring: string | null = null;
  let db: SqlJsDb | null = null;
  let dbKey: string | null = null;

  const next = () => (answers.length ? answers.shift()! : null);
  const notFound = (p: string) => new PlatformError('NOT_FOUND', `not found: ${p}`);

  return {
    kind: 'demo',
    fileStore,
    queueAnswer: (a) => void answers.push(a),
    addDir: (path) => void dirs.add(trim(path)),
    info: async () => ({ version: APP_VERSION, os: 'demo', data_dir: '/demo', example: false }),
    prefs: {
      get: async () => ({ ...prefs }),
      set: async (v) => void (prefs = { ...prefs, ...v }),
    },
    keyring: {
      read: async () => keyring,
      write: async (json) => void (keyring = json),
    },
    practice: {
      exists: async () => db !== null,
      async open(key, create): Promise<Db> {
        const hex = Array.from(key, (b) => b.toString(16).padStart(2, '0')).join('');
        if (!db) {
          if (!create) throw notFound('practice');
          db = await SqlJsDb.create({ locateFile: opts.locateFile });
          dbKey = hex;
        } else if (hex !== dbKey) {
          throw new PlatformError('WRONG_KEY', 'wrong key');
        }
        const inner = db;
        // Closing the handle must not destroy the in-memory database (it models a file).
        return {
          exec: (s, p) => inner.exec(s, p),
          query: (s, p) => inner.query(s, p),
          batch: (s) => inner.batch(s),
          script: (s) => inner.script(s),
          close: async () => {},
        } as Db;
      },
      erase: async () => {
        db = null;
        dbKey = null;
        keyring = null;
        blobs.clear();
      },
    },
    kdf: jsKdf,
    http: opts.http ?? null,
    openedLinks,
    openLink: async (url) => {
      openedLinks.push(url);
      opts.openLink?.(url);
    },
    blobs: {
      write: async (id, bytes) => void blobs.set(id, bytes.slice()),
      read: async (id) => {
        const b = blobs.get(id);
        if (!b) throw notFound(id);
        return b.slice();
      },
      remove: async (id) => void blobs.delete(id),
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
        const a = next();
        return typeof a === 'string' ? a : `/demo/exports/${name}`;
      },
    },
    setTitle: async () => {},
    onBeforeExit: () => () => {},
  };
}

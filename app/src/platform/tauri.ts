import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { fetch as nativeFetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import { fromHex, toHex } from '../core/bytes';
import type { Kdf } from '../core/crypto/kdf';
import type { Db, Row, SqlParam, SqlStatement } from '../core/store/db';
import { type AppInfo, type FileEntry, type Platform, PlatformError } from './types';

// The desktop platform: every call goes to the Rust shell over Tauri's local IPC.

async function call<T>(cmd: string, args?: Record<string, unknown> | Uint8Array, headers?: Record<string, string>): Promise<T> {
  try {
    return await invoke<T>(cmd, args, headers ? { headers } : undefined);
  } catch (e) {
    const err = e as { code?: string; message?: string } | string;
    if (typeof err === 'object' && err?.code) throw new PlatformError(err.code, err.message ?? err.code);
    throw new PlatformError('ERROR', String(err));
  }
}

class TauriDb implements Db {
  exec(sql: string, params: SqlParam[] = []) {
    return call<{ changes: number }>('db_exec', { sql, params });
  }
  query<T extends Row = Row>(sql: string, params: SqlParam[] = []) {
    return call<T[]>('db_query', { sql, params });
  }
  batch(statements: SqlStatement[]) {
    return call<number>('db_batch', { statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })) });
  }
  script(sql: string) {
    return call<void>('db_script', { sql });
  }
  close() {
    return call<void>('db_close');
  }
}

const tauriKdf: Kdf = async (secret, salt, params) =>
  fromHex(
    await call<string>('kdf_argon2id', {
      secretHex: toHex(secret),
      saltHex: toHex(salt),
      m: params.m,
      t: params.t,
      p: params.p,
      len: params.key_len,
    }),
  );

const PREFS_FILE = 'prefs.json';

// Automated tests (WebDriver) cannot operate native file dialogs. A test may queue answers in
// window.__SALA_E2E_DIALOGS__; each dialog call takes the next one. Nothing sets it in normal use.
function queuedAnswer(): { hit: boolean; value: string | string[] | null } {
  const q = (window as unknown as { __SALA_E2E_DIALOGS__?: (string | string[] | null)[] }).__SALA_E2E_DIALOGS__;
  if (!q || q.length === 0) return { hit: false, value: null };
  return { hit: true, value: q.shift() ?? null };
}
const sep = () => (navigator.userAgent.includes('Windows') ? '\\' : '/');

export function createTauriPlatform(): Platform {
  return {
    kind: 'desktop',
    info: () => call<AppInfo>('app_info'),
    prefs: {
      async get() {
        const raw = await call<string | null>('app_file_read', { name: PREFS_FILE });
        try {
          return raw ? (JSON.parse(raw) as Record<string, string>) : {};
        } catch {
          return {};
        }
      },
      async set(values) {
        const current = await this.get();
        await call('app_file_write', { name: PREFS_FILE, text: JSON.stringify({ ...current, ...values }, null, 2) });
      },
    },
    keyring: {
      read: () => call<string | null>('app_file_read', { name: 'keyring.json' }),
      write: (json) => call('app_file_write', { name: 'keyring.json', text: json }),
    },
    practice: {
      exists: () => call<boolean>('db_exists'),
      async open(key, create) {
        await call('db_open', { keyHex: toHex(key), create });
        return new TauriDb();
      },
      erase: () => call('erase_practice'),
    },
    kdf: tauriKdf,
    // Native HTTP (not subject to CORS), limited to The Human Loop's hosts by capabilities.
    http: { fetch: (url, init) => nativeFetch(url, init) },
    openLink: (url) => openUrl(url),
    blobs: {
      write: (id, bytes) => call('blob_write', bytes, { 'x-blob-id': id }),
      read: async (id) => new Uint8Array(await call<ArrayBuffer>('blob_read', { id })),
      remove: (id) => call('blob_delete', { id }),
    },
    files: {
      read: async (path) => new Uint8Array(await call<ArrayBuffer>('fs_read', { path })),
      write: (path, bytes) => call('fs_write', bytes, { 'x-path': encodeURIComponent(path) }),
      list: (path, recursive) => call<FileEntry[]>('fs_list', { path, recursive }),
      remove: (path) => call('fs_remove', { path }),
      exists: (path) => call<boolean>('fs_exists', { path }),
      join: (dir, name) => (dir.endsWith('/') || dir.endsWith('\\') ? dir + name : dir + sep() + name),
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
        const r = await openDialog({ directory: false, multiple, title, filters });
        if (!r) return [];
        return Array.isArray(r) ? r : [r];
      },
      async saveFile(title, defaultName, filters) {
        const q = queuedAnswer();
        if (q.hit) return typeof q.value === 'string' ? q.value : null;
        return (await saveDialog({ title, defaultPath: defaultName, filters })) ?? null;
      },
    },
    setTitle: (title) => getCurrentWindow().setTitle(title),
    onBeforeExit(handler) {
      let unlisten: (() => void) | null = null;
      let done = false;
      const win = getCurrentWindow();
      void win
        .onCloseRequested(async (event) => {
          // Every request is held back, a repeated one too: the first one's handler is still
          // saving, and it closes the window when it is done.
          event.preventDefault();
          if (done) return;
          done = true;
          try {
            await handler();
          } finally {
            await win.destroy();
          }
        })
        .then((u) => (unlisten = u));
      return () => unlisten?.();
    },
  };
}

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;


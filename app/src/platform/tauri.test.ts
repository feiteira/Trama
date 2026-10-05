import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformError } from './types';

// The Tauri APIs are replaced by fakes: these tests check what the adapter sends to the shell
// and how it maps the answers, not the shell itself (that is `cargo test`).

type Call = { cmd: string; args: unknown; options: unknown };
const calls: Call[] = [];
let respond: (cmd: string, args: unknown) => unknown = () => undefined;

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args?: unknown, options?: unknown) => {
    calls.push({ cmd, args, options });
    return respond(cmd, args);
  }),
}));

const win = {
  closeHandler: null as null | ((e: { preventDefault: () => void }) => Promise<void>),
  destroyed: 0,
  title: '',
  onCloseRequested: vi.fn(async (fn: (e: { preventDefault: () => void }) => Promise<void>) => {
    win.closeHandler = fn;
    return () => {};
  }),
  destroy: vi.fn(async () => void win.destroyed++),
  setTitle: vi.fn(async (t: string) => void (win.title = t)),
};
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => win }));

const dialog = { open: vi.fn(async (_o: unknown): Promise<unknown> => null), save: vi.fn(async (_o: unknown): Promise<unknown> => null) };
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (o: unknown) => dialog.open(o),
  save: (o: unknown) => dialog.save(o),
}));

const { createTauriPlatform, joinPath, parsePrefs, toPlatformError, tauriKdf, isTauri } = await import('./tauri');

const KEY = new Uint8Array(32).map((_, i) => i);
const P1 = '6f1e0c52-7a3b-4c8d-9e0f-112233445566';
const P2 = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

beforeEach(() => {
  calls.length = 0;
  respond = () => undefined;
  dialog.open.mockClear();
  dialog.save.mockClear();
  delete (globalThis as { __TRAMA_E2E_DIALOGS__?: unknown }).__TRAMA_E2E_DIALOGS__;
});

describe('errors', () => {
  it('maps shell errors to PlatformError codes', async () => {
    respond = () => {
      throw { code: 'WRONG_KEY', message: 'wrong key for the project database' };
    };
    const p = createTauriPlatform();
    const err = await p.projects.open(P1, KEY, false).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlatformError);
    expect((err as PlatformError).code).toBe('WRONG_KEY');
  });

  it('maps strings and unknown values to ERROR', () => {
    expect(toPlatformError('command x not found').code).toBe('ERROR');
    expect(toPlatformError('command x not found').message).toBe('command x not found');
    expect(toPlatformError(new Error('boom')).message).toBe('boom');
    expect(toPlatformError(null).code).toBe('ERROR');
    expect(toPlatformError({ code: '' }).code).toBe('ERROR');
    expect(toPlatformError({ code: 'NOT_FOUND' }).message).toBe('NOT_FOUND');
    const pe = new PlatformError('INVALID', 'x');
    expect(toPlatformError(pe)).toBe(pe);
  });
});

describe('projects and databases', () => {
  it('opens with the project id and hex key, and names the project on every call', async () => {
    const p = createTauriPlatform();
    const db = await p.projects.open(P1, KEY, true);
    expect(calls[0]).toMatchObject({
      cmd: 'db_open',
      args: { project: P1, keyHex: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', create: true },
    });
    respond = (cmd) => (cmd === 'db_query' ? [{ n: 1 }] : cmd === 'db_batch' ? 2 : { changes: 1 });
    expect(await db.exec('INSERT INTO t VALUES (?)', ['Inês'])).toEqual({ changes: 1 });
    expect(await db.query('SELECT 1 AS n')).toEqual([{ n: 1 }]);
    expect(await db.batch([{ sql: 'A' }, { sql: 'B', params: [1, null] }])).toBe(2);
    await db.script('CREATE TABLE t (x)');
    expect(calls.slice(1).map((c) => c.args)).toEqual([
      { project: P1, sql: 'INSERT INTO t VALUES (?)', params: ['Inês'] },
      { project: P1, sql: 'SELECT 1 AS n', params: [] },
      { project: P1, statements: [{ sql: 'A', params: [] }, { sql: 'B', params: [1, null] }] },
      { project: P1, sql: 'CREATE TABLE t (x)' },
    ]);
  });

  it('a handle kept after opening another project refuses to run', async () => {
    const p = createTauriPlatform();
    const a = await p.projects.open(P1, KEY, true);
    const b = await p.projects.open(P2, KEY, true);
    calls.length = 0;
    await expect(a.exec('DELETE FROM t')).rejects.toMatchObject({ code: 'DB_NOT_OPEN' });
    expect(calls).toHaveLength(0);
    // Closing the stale handle must not close the project opened after it.
    await a.close();
    expect(calls).toHaveLength(0);
    await b.query('SELECT 1');
    expect(calls[0]?.args).toMatchObject({ project: P2 });
    await b.close();
    expect(calls[1]).toMatchObject({ cmd: 'db_close', args: { project: P2 } });
    await b.close(); // twice is fine
    expect(calls).toHaveLength(2);
    await expect(b.query('SELECT 1')).rejects.toMatchObject({ code: 'DB_NOT_OPEN' });
  });

  it('a failed open leaves no usable handle behind', async () => {
    const p = createTauriPlatform();
    const a = await p.projects.open(P1, KEY, true);
    respond = (cmd) => {
      if (cmd === 'db_open') throw { code: 'WRONG_KEY', message: 'x' };
    };
    await expect(p.projects.open(P2, KEY, false)).rejects.toMatchObject({ code: 'WRONG_KEY' });
    await expect(a.query('SELECT 1')).rejects.toMatchObject({ code: 'DB_NOT_OPEN' });
  });

  it('erasing the open project or everything invalidates its handle', async () => {
    const p = createTauriPlatform();
    const a = await p.projects.open(P1, KEY, true);
    await p.projects.erase(P2);
    await a.query('SELECT 1'); // erasing another project leaves it open
    await p.projects.erase(P1);
    await expect(a.query('SELECT 1')).rejects.toMatchObject({ code: 'DB_NOT_OPEN' });
    const b = await p.projects.open(P2, KEY, true);
    await p.eraseAll();
    await expect(b.query('SELECT 1')).rejects.toMatchObject({ code: 'DB_NOT_OPEN' });
    expect(calls.map((c) => c.cmd)).toContain('erase_all');
    expect(calls.find((c) => c.cmd === 'project_erase')?.args).toEqual({ project: P2 });
  });

  it('lists and checks projects', async () => {
    respond = (cmd) => (cmd === 'project_list' ? [P1, P2] : true);
    const p = createTauriPlatform();
    expect(await p.projects.list()).toEqual([P1, P2]);
    expect(await p.projects.exists(P1)).toBe(true);
    expect(calls[1]).toMatchObject({ cmd: 'project_exists', args: { project: P1 } });
  });
});

describe('app files', () => {
  it('reads and writes the keyring and library file by name', async () => {
    respond = (cmd, args) => (cmd === 'app_file_read' ? `read:${(args as { name: string }).name}` : undefined);
    const p = createTauriPlatform();
    expect(await p.keyring.read()).toBe('read:keyring.json');
    expect(await p.libraryFile.read()).toBe('read:library.json');
    await p.keyring.write('{"v":1}');
    await p.libraryFile.write('sealed');
    expect(calls.slice(2).map((c) => c.args)).toEqual([
      { name: 'keyring.json', text: '{"v":1}' },
      { name: 'library.json', text: 'sealed' },
    ]);
  });

  it('merges preferences and serialises concurrent updates', async () => {
    let file: string | null = null;
    respond = (cmd, args) => {
      if (cmd === 'app_file_read') return file;
      if (cmd === 'app_file_write') file = (args as { text: string }).text;
    };
    const p = createTauriPlatform();
    expect(await p.prefs.get()).toEqual({});
    await Promise.all([p.prefs.set({ lang: 'pt' }), p.prefs.set({ theme: 'dark' }), p.prefs.set({ lang: 'es' })]);
    expect(await p.prefs.get()).toEqual({ lang: 'es', theme: 'dark' });
  });

  it('a failed preference write does not block the next one', async () => {
    let fail = true;
    respond = (cmd) => {
      if (cmd === 'app_file_write' && fail) {
        fail = false;
        throw { code: 'IO_ERROR', message: 'disk full' };
      }
      return cmd === 'app_file_read' ? null : undefined;
    };
    const p = createTauriPlatform();
    await expect(p.prefs.set({ a: '1' })).rejects.toMatchObject({ code: 'IO_ERROR' });
    await expect(p.prefs.set({ a: '2' })).resolves.toBeUndefined();
  });

  it('parses only flat string preferences', () => {
    expect(parsePrefs(null)).toEqual({});
    expect(parsePrefs('')).toEqual({});
    expect(parsePrefs('not json')).toEqual({});
    expect(parsePrefs('[1,2]')).toEqual({});
    expect(parsePrefs('"x"')).toEqual({});
    expect(parsePrefs('{"lang":"pt","n":1,"o":{},"name":"Inês 🌿"}')).toEqual({ lang: 'pt', name: 'Inês 🌿' });
  });
});

describe('binary transfers', () => {
  it('sends blob bytes as a raw body with encoded headers', async () => {
    const p = createTauriPlatform();
    const bytes = new Uint8Array([0, 1, 2, 255]);
    await p.blobs.write(P1, 'b1.bin', bytes);
    expect(calls[0]?.cmd).toBe('blob_write');
    expect(calls[0]?.args).toBe(bytes);
    expect(calls[0]?.options).toEqual({ headers: { 'x-project': P1, 'x-blob-id': 'b1.bin' } });
  });

  it('copies a view so only its bytes are sent', async () => {
    const p = createTauriPlatform();
    const big = new Uint8Array(100).map((_, i) => i);
    await p.files.write('/tmp/x', big.subarray(10, 13));
    const sent = calls[0]?.args as Uint8Array;
    expect(sent.byteLength).toBe(3);
    expect(sent.buffer.byteLength).toBe(3);
    expect([...sent]).toEqual([10, 11, 12]);
  });

  it('percent-encodes non-ASCII paths', async () => {
    const p = createTauriPlatform();
    await p.files.write('/home/inês/Entrevistas 日本/notas.txt', new Uint8Array());
    const header = (calls[0]?.options as { headers: Record<string, string> }).headers['x-path']!;
    expect(header).toMatch(/^[\x21-\x7e]+$/);
    expect(decodeURIComponent(header)).toBe('/home/inês/Entrevistas 日本/notas.txt');
  });

  it('reads binary answers as ArrayBuffer or number arrays', async () => {
    const p = createTauriPlatform();
    respond = () => new Uint8Array([1, 2, 3]).buffer;
    expect([...(await p.blobs.read(P1, 'b1'))]).toEqual([1, 2, 3]);
    respond = () => [4, 5];
    expect([...(await p.files.read('/x'))]).toEqual([4, 5]);
    expect(calls[0]).toMatchObject({ cmd: 'blob_read', args: { project: P1, id: 'b1' } });
    await p.blobs.remove(P1, 'b1');
    expect(calls[2]).toMatchObject({ cmd: 'blob_delete', args: { project: P1, id: 'b1' } });
  });
});

describe('kdf', () => {
  it('passes parameters as hex and lengths', async () => {
    respond = () => 'aabb';
    const out = await tauriKdf(new TextEncoder().encode('pá'), new Uint8Array(16), { algo: 'argon2id', m: 64, t: 1, p: 1, key_len: 32 });
    expect([...out]).toEqual([0xaa, 0xbb]);
    expect(calls[0]?.args).toEqual({ secretHex: '70c3a1', saltHex: '00'.repeat(16), m: 64, t: 1, p: 1, len: 32 });
  });
});

describe('paths', () => {
  it('joins with the folder separator', () => {
    expect(joinPath('/home/ana', 'x.qdpx')).toBe('/home/ana/x.qdpx');
    expect(joinPath('/home/ana/', 'x.qdpx')).toBe('/home/ana/x.qdpx');
    expect(joinPath('/', 'x')).toBe('/x');
    expect(joinPath('C:\\Users\\Ana', 'x.qdpx')).toBe('C:\\Users\\Ana\\x.qdpx');
    expect(joinPath('C:\\', 'x')).toBe('C:\\x');
    expect(joinPath('C:', 'x')).toBe('C:\\x');
    expect(joinPath('\\\\server\\share', 'x')).toBe('\\\\server\\share\\x');
    expect(joinPath('C:/Users/Ana', 'x')).toBe('C:/Users/Ana/x');
    expect(joinPath('/home/a\\b', 'x')).toBe('/home/a\\b/x');
    expect(joinPath('/home/ana/Ação 日本', 'é.txt')).toBe('/home/ana/Ação 日本/é.txt');
  });
});

describe('dialogs', () => {
  it('uses queued e2e answers before the native dialogs', async () => {
    (globalThis as { __TRAMA_E2E_DIALOGS__?: unknown }).__TRAMA_E2E_DIALOGS__ = ['/data', ['/a', '/b'], null, '/out.qdpx'];
    const p = createTauriPlatform();
    expect(await p.dialogs.pickFolder('t')).toBe('/data');
    expect(await p.dialogs.pickFiles('t', [], true)).toEqual(['/a', '/b']);
    expect(await p.dialogs.pickFiles('t', [], true)).toEqual([]);
    expect(await p.dialogs.saveFile('t', 'x.qdpx', [])).toBe('/out.qdpx');
    expect(dialog.open).not.toHaveBeenCalled();
    // Queue empty: the native dialog answers.
    dialog.open.mockResolvedValueOnce('/picked');
    expect(await p.dialogs.pickFiles('t', [], false)).toEqual(['/picked']);
  });

  it('passes titles and filters, dropping empty filters and leading dots', async () => {
    const p = createTauriPlatform();
    dialog.open.mockResolvedValueOnce(['/a.docx']);
    await p.dialogs.pickFiles('Import', [{ name: 'Word', extensions: ['.docx', 'odt'] }, { name: 'None', extensions: [] }], true);
    expect(dialog.open).toHaveBeenCalledWith({ directory: false, multiple: true, title: 'Import', filters: [{ name: 'Word', extensions: ['docx', 'odt'] }] });
    dialog.save.mockResolvedValueOnce(null);
    expect(await p.dialogs.saveFile('Export', 'Projeto.qdpx', [{ name: 'REFI-QDA', extensions: ['qdpx'] }])).toBeNull();
    expect(dialog.save).toHaveBeenCalledWith({ title: 'Export', defaultPath: 'Projeto.qdpx', filters: [{ name: 'REFI-QDA', extensions: ['qdpx'] }] });
    dialog.open.mockResolvedValueOnce(['/not-a-string']);
    expect(await p.dialogs.pickFolder('Folder')).toBeNull();
  });
});

describe('window', () => {
  it('sets the title', async () => {
    await createTauriPlatform().setTitle('Entrevistas — Trama');
    expect(win.title).toBe('Entrevistas — Trama');
  });

  it('runs every exit handler once, then closes the window, even if one fails', async () => {
    const p = createTauriPlatform();
    const order: string[] = [];
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    p.onBeforeExit(async () => {
      await slow;
      order.push('save');
    });
    p.onBeforeExit(async () => {
      order.push('fail');
      throw new Error('backup folder missing');
    });
    const off = p.onBeforeExit(async () => void order.push('removed'));
    off();
    expect(win.onCloseRequested).toHaveBeenCalledTimes(1);
    const prevent = vi.fn();
    const first = win.closeHandler!({ preventDefault: prevent });
    // A second request while saving is held back and does nothing more.
    await win.closeHandler!({ preventDefault: prevent });
    expect(prevent).toHaveBeenCalledTimes(2);
    expect(win.destroyed).toBe(0);
    release();
    await first;
    expect(order.sort()).toEqual(['fail', 'save']);
    expect(win.destroyed).toBe(1);
  });
});

describe('isTauri', () => {
  it('is false outside the webview', () => {
    expect(isTauri()).toBe(false);
  });
});

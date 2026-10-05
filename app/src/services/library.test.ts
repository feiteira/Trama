import { describe, expect, it } from 'vitest';
import { fromUtf8 } from '../core/bytes';
import { newRecoveryPhrase, WrongSecretError } from '../core/crypto/keyring';
import type { ProjectBundle } from '../core/export/bundle';
import { SETTING_KEYS } from '../core/model/types';
import type { Db } from '../core/store/db';
import { Store } from '../core/store/store';
import { createMemoryPlatform, type MemoryPlatform } from '../platform/memory';
import { PlatformError } from '../platform/types';
import { Library, LibraryError, sanitizeRecords } from './library';
import { NeedsCoderError, projectKeyOf } from './project';
import { FAST_KDF } from './testing';

const PASS = 'correct horse battery';

async function setup(opts: { now?: () => Date } = {}) {
  const platform = createMemoryPlatform();
  const phrase = newRecoveryPhrase();
  const library = await Library.create(platform, { passphrase: PASS, recoveryPhrase: phrase }, { params: FAST_KDF, ...opts });
  return { platform, phrase, library };
}

const opens = async (platform: MemoryPlatform, slot: 'passphrase' | 'recovery_phrase', secret: string) => {
  try {
    await (await Library.unlock(platform, slot, secret)).lock();
    return true;
  } catch (e) {
    if (e instanceof WrongSecretError) return false;
    throw e;
  }
};

describe('creating and unlocking a library', () => {
  it('goes from no library to one that unlocks with the passphrase or the recovery phrase', async () => {
    const platform = createMemoryPlatform();
    expect(await Library.state(platform)).toBe('none');
    const phrase = newRecoveryPhrase();
    const library = await Library.create(platform, { passphrase: 'Inês é ótima', recoveryPhrase: phrase }, { params: FAST_KDF });
    expect(await Library.state(platform)).toBe('ready');
    expect(library.projects).toEqual([]);
    expect(library.mustChangePassphrase).toBe(false);
    await library.lock();

    // NFD typing of the same passphrase unlocks too.
    const again = await Library.unlock(platform, 'passphrase', 'Inês é ótima'.normalize('NFD'));
    expect(again.mustChangePassphrase).toBe(false);
    await again.lock();
    await expect(Library.unlock(platform, 'passphrase', 'wrong')).rejects.toBeInstanceOf(WrongSecretError);
    await expect(Library.unlock(platform, 'recovery_phrase', newRecoveryPhrase())).rejects.toBeInstanceOf(WrongSecretError);

    const viaPhrase = await Library.unlock(platform, 'recovery_phrase', `  ${phrase.toUpperCase()}  `, { params: FAST_KDF });
    expect(viaPhrase.mustChangePassphrase).toBe(true);
    await viaPhrase.changeSecret('passphrase', 'a brand new one');
    expect(viaPhrase.mustChangePassphrase).toBe(false);
    await viaPhrase.lock();
    expect(await opens(platform, 'passphrase', 'a brand new one')).toBe(true);
    expect(await opens(platform, 'passphrase', 'Inês é ótima')).toBe(false);
  });

  it('refuses to create a second library, a bad recovery phrase or an empty passphrase', async () => {
    const { platform, library } = await setup();
    await expect(Library.create(platform, { passphrase: 'x', recoveryPhrase: newRecoveryPhrase() }, { params: FAST_KDF })).rejects.toMatchObject({ code: 'EXISTS' });
    await library.lock();
    const fresh = createMemoryPlatform();
    await expect(Library.create(fresh, { passphrase: 'x', recoveryPhrase: 'not twelve words' })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(Library.create(fresh, { passphrase: '', recoveryPhrase: newRecoveryPhrase() })).rejects.toMatchObject({ code: 'INVALID' });
    expect(await Library.state(fresh)).toBe('none');
  });

  it('writes the keyring last and removes what it wrote when setup fails', async () => {
    const platform = createMemoryPlatform();
    platform.keyring.write = async () => {
      throw new PlatformError('ERROR', 'os error 28: no space left on device');
    };
    await expect(Library.create(platform, { passphrase: PASS, recoveryPhrase: newRecoveryPhrase() }, { params: FAST_KDF })).rejects.toThrow(/no space/);
    expect(await platform.libraryFile.read()).toBeNull();
    expect(await Library.state(platform)).toBe('none');
  });

  it('reports projects left without a keyring, and no library at all', async () => {
    const { platform, library } = await setup();
    await library.createProject({ name: 'Estudo', coderName: 'Ana' });
    await library.lock();
    const raw = await platform.keyring.read();
    await platform.keyring.write(null as unknown as string); // the keyring file was lost
    expect(await Library.state(platform)).toBe('noKeyring');
    await expect(Library.unlock(platform, 'passphrase', PASS)).rejects.toMatchObject({ code: 'NO_LIBRARY' });
    await platform.keyring.write(raw!);
    expect(await Library.state(platform)).toBe('ready');
    await platform.eraseAll();
    expect(await Library.state(platform)).toBe('none');
  });
});

describe('changing secrets', () => {
  it('checks the current passphrase and leaves it when typed wrong', async () => {
    const { platform, library } = await setup();
    await expect(library.changePassphrase('wrong', 'next one')).rejects.toBeInstanceOf(WrongSecretError);
    await library.changePassphrase(PASS, 'next one');
    await library.lock();
    expect(await opens(platform, 'passphrase', 'next one')).toBe(true);
    expect(await opens(platform, 'passphrase', PASS)).toBe(false);
  });

  it('still wraps the real library key when Trama locks while the key derivation runs', async () => {
    const { platform, library } = await setup();
    const p = await library.createProject({ name: 'Estudo', coderName: 'Ana' });
    const id = p.id;
    const kdf = platform.kdf;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    platform.kdf = async (...args) => {
      await gate;
      return kdf(...args);
    };
    const changing = library.changeSecret('passphrase', 'new pass word', { params: FAST_KDF });
    await library.lock(); // the library key is wiped in place meanwhile
    release();
    await changing;
    platform.kdf = kdf;
    const reopened = await Library.unlock(platform, 'passphrase', 'new pass word');
    const project = await reopened.openProject(id); // the project key still derives correctly
    expect(project.me.name).toBe('Ana');
    await reopened.lock();
  });

  it('keeps both a new passphrase and a new recovery phrase saved close together', async () => {
    const { platform, library, phrase } = await setup();
    const newPhrase = newRecoveryPhrase();
    const a = library.changeSecret('passphrase', 'new pass word');
    const b = library.changeSecret('recovery_phrase', newPhrase);
    await library.lock();
    await Promise.all([a, b]);
    expect(await opens(platform, 'passphrase', 'new pass word')).toBe(true);
    expect(await opens(platform, 'recovery_phrase', newPhrase)).toBe(true);
    expect(await opens(platform, 'recovery_phrase', phrase)).toBe(false);
  });

  it('refuses once locked, and refuses an invalid recovery phrase', async () => {
    const { library } = await setup();
    await expect(library.changeSecret('recovery_phrase', 'one two three')).rejects.toMatchObject({ code: 'INVALID' });
    await library.lock();
    await expect(library.changeSecret('passphrase', 'x')).rejects.toBeInstanceOf(LibraryError);
  });
});

describe('projects', () => {
  it('creates a project with its first coder as me, its settings and a log entry', async () => {
    const now = () => new Date('2026-10-05T12:00:00.123Z');
    const { library } = await setup({ now });
    const project = await library.createProject({ name: '  Estudo   piloto ', description: 'Entrevistas', coderName: 'Ana Sousa' });
    expect(project.store.projectId).toBe(project.id);
    expect(project.me.name).toBe('Ana Sousa');
    expect(project.needsCoder).toBe(false);
    expect(await project.store.getMeta('me')).toBe(project.me.id);
    expect((await project.store.get('setting', SETTING_KEYS.projectName))!.value).toBe('Estudo piloto');
    expect((await project.store.get('setting', SETTING_KEYS.projectDescription))!.value).toBe('Entrevistas');
    const [log] = await project.store.list('log');
    expect(log).toMatchObject({ action: 'project.create', at: '2026-10-05T12:00:00Z', coder_id: project.me.id, summary: 'Estudo piloto' });
    expect(library.projects).toEqual([
      { id: project.id, name: 'Estudo piloto', description: 'Entrevistas', color: expect.stringMatching(/^#[0-9a-f]{6}$/), created_at: '2026-10-05T12:00:00.123Z', opened_at: '2026-10-05T12:00:00.123Z' },
    ]);
    expect(project.info.name).toBe('Estudo piloto');
    expect(library.current).toBe(project);
  });

  it('validates names and colours before making anything', async () => {
    const { platform, library } = await setup();
    await expect(library.createProject({ name: ' ', coderName: 'Ana' })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(library.createProject({ name: 'X', coderName: '' })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(library.createProject({ name: 'X', coderName: 'Ana', color: 'blue' })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(library.createProject({ name: 'x'.repeat(201), coderName: 'Ana' })).rejects.toMatchObject({ code: 'INVALID' });
    expect(await platform.projects.list()).toEqual([]);
  });

  it('keeps the project list encrypted: no project name or description readable on disk', async () => {
    const { platform, library } = await setup();
    await library.createProject({ name: 'Violência doméstica Lisboa', description: 'Participantes de Benfica', coderName: 'Ana' });
    const file = (await platform.libraryFile.read())!;
    expect(JSON.parse(file)).toMatchObject({ format: 'trama-library', v: 1 });
    for (const word of ['Violência', 'Lisboa', 'Benfica', 'Ana']) {
      expect(file).not.toContain(word);
      expect((await platform.keyring.read())!).not.toContain(word);
    }
  });

  it('lists projects again after locking and unlocking, and opens them', async () => {
    let t = new Date('2026-10-05T12:00:00Z').getTime();
    const now = () => new Date(t);
    const { platform, library } = await setup({ now });
    const a = await library.createProject({ name: 'A', coderName: 'Ana' });
    const b = await library.createProject({ name: 'B', coderName: 'Ana' });
    expect(a.isOpen).toBe(false); // opening another closes the first
    expect(library.current).toBe(b);
    await library.lock();

    const again = await Library.unlock(platform, 'passphrase', PASS, { now });
    expect(again.projects.map((p) => p.name)).toEqual(['A', 'B']);
    t += 3600_000;
    const pa = await again.openProject(a.id);
    expect(await again.openProject(a.id)).toBe(pa); // already open
    expect(pa.me.name).toBe('Ana');
    expect(again.projects.find((p) => p.id === a.id)!.opened_at).toBe('2026-10-05T13:00:00.000Z');
    await expect(again.openProject('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await again.lock();
  });

  it('runs project operations one at a time, so only one project is ever open', async () => {
    const { library } = await setup();
    const a = await library.createProject({ name: 'A', coderName: 'Ana' });
    const b = await library.createProject({ name: 'B', coderName: 'Ana' });
    const [pa, pb] = await Promise.all([library.openProject(a.id), library.openProject(b.id)]);
    expect(pa.isOpen).toBe(false);
    expect(pb.isOpen).toBe(true);
    expect(library.current).toBe(pb);
  });

  it('updates a project and mirrors its name and description into the open project', async () => {
    const { library } = await setup();
    const p = await library.createProject({ name: 'Old', coderName: 'Ana' });
    const info = await library.updateProject(p.id, { name: 'New name', description: 'Desc', color: '#29A37A' });
    expect(info).toMatchObject({ name: 'New name', description: 'Desc', color: '#29a37a' });
    expect(p.info.name).toBe('New name');
    expect((await p.store.get('setting', SETTING_KEYS.projectName))!.value).toBe('New name');
    expect((await p.store.get('setting', SETTING_KEYS.projectDescription))!.value).toBe('Desc');
    await expect(library.updateProject(p.id, { name: '' })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(library.updateProject('nope', { name: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('deletes a project with its database and files', async () => {
    const { platform, library } = await setup();
    const keep = await library.createProject({ name: 'Keep', coderName: 'Ana' });
    const gone = await library.createProject({ name: 'Gone', coderName: 'Ana' });
    await gone.addBlob(new Uint8Array([1, 2, 3]), 'a.pdf', 'application/pdf');
    await library.deleteProject(gone.id);
    expect(gone.isOpen).toBe(false);
    expect(library.current).toBeNull();
    expect(await platform.projects.list()).toEqual([keep.id]);
    expect(platform.blobStore(gone.id).size).toBe(0);
    expect(library.projects.map((p) => p.name)).toEqual(['Keep']);
    await expect(library.deleteProject(gone.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('removes a project it could not finish making, so nothing half-made is left', async () => {
    const { platform, library } = await setup();
    platform.libraryFile.write = async () => {
      throw new PlatformError('ERROR', 'disk full');
    };
    await expect(library.createProject({ name: 'X', coderName: 'Ana' })).rejects.toThrow(/disk full/);
    expect(await platform.projects.list()).toEqual([]);
    expect(library.projects).toEqual([]);
    expect(library.current).toBeNull();
  });

  it('refuses to open a project with the wrong key', async () => {
    const { platform, library } = await setup();
    const p = await library.createProject({ name: 'A', coderName: 'Ana' });
    await library.closeProject();
    await expect(platform.projects.open(p.id, new Uint8Array(32), false)).rejects.toMatchObject({ code: 'WRONG_KEY' });
    await expect(platform.projects.open('not-there', new Uint8Array(32), false)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('reconciling the list with the disk', () => {
  async function orphan(platform: MemoryPlatform, library: Library, id: string, name: string | null) {
    const keys = library.copyKeys();
    const db = await platform.projects.open(id, projectKeyOf(keys.libraryKey, id), true);
    keys.wipe();
    const store = await Store.open(db);
    if (name) await store.put('setting', { id: SETTING_KEYS.projectName, value: name });
    await store.close();
  }

  it('lists a project found on disk but missing from the list, and takes its own name when opened', async () => {
    const { platform, library } = await setup();
    const id = '0f0e0d0c-aaaa-4bbb-8ccc-123456789abc';
    await orphan(platform, library, id, 'Estudo perdido');
    await library.lock();
    const again = await Library.unlock(platform, 'passphrase', PASS);
    expect(again.projects).toEqual([expect.objectContaining({ id, name: 'Recovered project 0f0e0d0c', recovered: true })]);
    // The list was saved: the next unlock lists it too.
    const p = await again.openProject(id);
    expect(p.needsCoder).toBe(true); // nobody is "me" in a database found like this
    expect(() => p.me).toThrow(NeedsCoderError);
    expect(again.projects[0]).toMatchObject({ name: 'Estudo perdido' });
    expect(again.projects[0]!.recovered).toBeUndefined();
    await again.lock();
    const third = await Library.unlock(platform, 'passphrase', PASS);
    expect(third.projects.map((x) => x.name)).toEqual(['Estudo perdido']);
    await third.lock();
  });

  it('drops entries whose folder is gone', async () => {
    const { platform, library } = await setup();
    const p = await library.createProject({ name: 'A', coderName: 'Ana' });
    await library.lock();
    await platform.projects.erase(p.id);
    const again = await Library.unlock(platform, 'passphrase', PASS);
    expect(again.projects).toEqual([]);
    await again.lock();
  });

  it('still opens with a damaged list, and lists the projects from disk', async () => {
    const { platform, library } = await setup();
    const p = await library.createProject({ name: 'A', coderName: 'Ana' });
    await library.lock();
    await platform.libraryFile.write('{"format":"trama-library","v":1,"nonce":"AAAA","ct":"AAAA"}');
    const again = await Library.unlock(platform, 'passphrase', PASS);
    expect(again.registryDamaged).toBe(true);
    expect(again.projects.map((x) => x.id)).toEqual([p.id]);
    const opened = await again.openProject(p.id);
    expect(opened.info.name).toBe('A'); // the name inside the project
    expect(again.registryDamaged).toBe(false); // opening saved a good list
    expect(opened.me.name).toBe('Ana');
    await again.lock();
  });
});

describe('locking', () => {
  it('closes the open project, wipes the keys, and is safe to repeat', async () => {
    const { library } = await setup();
    const p = await library.createProject({ name: 'A', coderName: 'Ana' });
    const ref = await p.addBlob(new Uint8Array([9, 9]), 'x.bin', 'application/octet-stream');
    const keys = library.copyKeys();
    await Promise.all([library.lock(), library.lock()]);
    await library.lock();
    expect(library.isOpen).toBe(false);
    expect(p.isOpen).toBe(false);
    expect(library.current).toBeNull();
    expect(() => library.copyKeys()).toThrow(LibraryError);
    expect(() => p.copyKeys()).toThrow(/closed/);
    await expect(p.readBlob(ref)).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(library.createProject({ name: 'B', coderName: 'Ana' })).rejects.toMatchObject({ code: 'LOCKED' });
    // A copy taken before the lock is independent of it.
    expect(keys.libraryKey.some((b) => b !== 0)).toBe(true);
    keys.wipe();
    expect(keys.libraryKey.every((b) => b === 0)).toBe(true);
  });
});

describe('importing a bundle', () => {
  async function source() {
    const { library } = await setup();
    const p = await library.createProject({ name: 'Fonte', description: 'Origem', coderName: 'Rui' });
    const doc = await p.store.put('document', {
      name: 'Entrevista 1', kind: 'text', group_ids: [], case_id: null, source: null,
      original: await p.addBlob(new TextEncoder().encode('%PDF-1.7 fake'), 'e1.pdf', 'application/pdf'),
      media: null, chars: 5, order: 1, color: null,
    });
    await p.store.put('doctext', { id: doc.id, text: 'Olá 🌍', sync: [] });
    const records = [];
    for await (const r of p.store.all()) records.push(r);
    const blobs = new Map([[doc.original!.blob_id, await p.readBlob(doc.original!)]]);
    const bundle: ProjectBundle = { project: { id: p.id, name: 'Fonte', description: 'Origem', origin: 'Trama test' }, records: records as ProjectBundle['records'], blobs, warnings: [] };
    return { bundle, doc, me: p.me };
  }

  it('makes a new project with new id, keeping record ids and stamps, and the files', async () => {
    const { bundle, doc } = await source();
    const { library } = await setup();
    const p = await library.importBundle(bundle, { coderName: 'Ana' });
    expect(p.id).not.toBe(bundle.project.id);
    expect(p.info.name).toBe('Fonte');
    expect(p.me.name).toBe('Ana');
    const got = (await p.store.get('document', doc.id))!;
    expect(got.updated_at_hlc).toBe(doc.updated_at_hlc);
    expect(fromUtf8(await p.readBlob(got.original!))).toBe('%PDF-1.7 fake');
    expect((await p.store.get('doctext', doc.id))!.text).toBe('Olá 🌍');
    expect((await p.coders()).map((c) => c.name)).toEqual(['Ana', 'Rui']);
    expect((await p.store.list('log')).some((l) => l.action === 'project.import')).toBe(true);
  });

  it('keeps the id of a teammate copy and asks who is coding instead of guessing', async () => {
    const { bundle, me } = await source();
    const { library } = await setup();
    const p = await library.importBundle(bundle, { keepId: true, name: 'Cópia' });
    expect(p.id).toBe(bundle.project.id);
    expect(p.info.name).toBe('Cópia');
    expect(p.needsCoder).toBe(true);
    expect(() => p.me).toThrow(NeedsCoderError);
    await p.setMe(me.id);
    expect(p.me.name).toBe('Rui');
    await expect(library.importBundle(bundle, { keepId: true })).rejects.toMatchObject({ code: 'EXISTS' });
  });

  it('leaves out invalid records, renames odd blob ids, and drops unreferenced blobs', async () => {
    const { bundle, doc } = await source();
    const odd = 'Some File.PDF';
    const records = bundle.records.map((r) =>
      r.kind === 'document' ? { ...r, record: { ...r.record, original: { ...r.record.original!, blob_id: odd } } } : r,
    ) as ProjectBundle['records'];
    records.push({ kind: 'code', record: { id: 'bad', created_at: 'x', updated_at_hlc: 'not a stamp', deleted: false } as never });
    records.push({ kind: 'coder', record: { id: 'c2', created_at: '2026-01-01T00:00:00Z', updated_at_hlc: '000001700000000-00000-ab', deleted: false, name: '', color: '#000000' } });
    const blobs = new Map([[odd, new Uint8Array([1])], ['unused', new Uint8Array([2])]]);
    const { library, platform } = await setup();
    const p = await library.importBundle({ ...bundle, records, blobs }, { coderName: 'Ana' });
    const got = (await p.store.get('document', doc.id))!;
    expect(got.original!.blob_id).not.toBe(odd);
    expect(await p.readBlob(got.original!)).toEqual(new Uint8Array([1]));
    expect(platform.blobStore(p.id).size).toBe(1);
    expect(await p.store.get('code', 'bad')).toBeNull();
    expect(await p.store.get('coder', 'c2')).toBeNull();
    const log = (await p.store.list('log')).find((l) => l.action === 'project.import')!;
    expect(log.summary).toMatch(/2 left out/);
  });

  it('removes the new project when the import fails part-way', async () => {
    const { bundle } = await source();
    const { library, platform } = await setup();
    const write = platform.blobs.write;
    platform.blobs.write = async () => {
      throw new PlatformError('ERROR', 'disk full');
    };
    await expect(library.importBundle(bundle, { coderName: 'Ana' })).rejects.toThrow(/disk full/);
    platform.blobs.write = write;
    expect(await platform.projects.list()).toEqual([]);
    expect(library.projects).toEqual([]);
  });
});

describe('importing without opening', () => {
  /** Like the desktop shell: opening a database closes the one open before, and its handle stops working. */
  function oneConnection(platform: MemoryPlatform): void {
    const open = platform.projects.open.bind(platform.projects);
    let live: { dead: boolean } | null = null;
    platform.projects.open = async (id, key, create) => {
      if (live) live.dead = true;
      const inner = await open(id, key, create);
      const me = { dead: false };
      live = me;
      const check = () => {
        if (me.dead) throw new PlatformError('DB_NOT_OPEN', 'this project database is closed');
      };
      return {
        exec: async (sql, params) => (check(), inner.exec(sql, params)),
        query: async (sql, params) => (check(), inner.query(sql, params)),
        batch: async (st) => (check(), inner.batch(st)),
        script: async (sql) => (check(), inner.script(sql)),
        close: async () => {
          me.dead = true;
          await inner.close();
        },
      } as Db;
    };
  }

  async function withOpenProject() {
    const { bundle } = await (async () => {
      const { library } = await setup();
      const p = await library.createProject({ name: 'Fonte', coderName: 'Rui' });
      await p.store.put('code', { name: 'Trust', parent_id: null, color: '#e4572e', description: '', inclusion: '', exclusion: '', example: '', order: 1, codable: true, shortcut: null });
      const records = [];
      for await (const r of p.store.all()) records.push(r);
      const doc = await p.store.put('document', {
        name: 'E1', kind: 'pdf', group_ids: [], case_id: null, source: null, original: await p.addBlob(new Uint8Array([1, 2, 3]), 'e1.pdf', 'application/pdf'), media: null, chars: 0, order: 1, color: null,
      });
      records.push({ kind: 'document', record: doc });
      return { bundle: { project: { id: p.id, name: 'Fonte', description: '', origin: null }, records, blobs: new Map([[doc.original!.blob_id, new Uint8Array([1, 2, 3])]]), warnings: [] } as ProjectBundle };
    })();
    const { library, platform } = await setup();
    oneConnection(platform);
    const open = await library.createProject({ name: 'Aberto', coderName: 'Ana' });
    return { library, platform, open, bundle };
  }

  it('adds the project to the list and leaves the open project open and working', async () => {
    const { library, open, bundle } = await withOpenProject();
    const info = await library.importBundle(bundle, { open: false, coderName: 'Ana' });
    expect(info).toMatchObject({ name: 'Fonte', opened_at: null });
    expect(library.current).toBe(open);
    expect(open.isOpen).toBe(true);
    await open.store.put('memo', { title: 'still here', body: '', target: { kind: 'project', id: null }, coder_id: open.me.id, color: null });
    expect(await open.store.count('memo')).toBe(1);
    expect(library.projects.map((p) => p.name)).toEqual(['Aberto', 'Fonte']);
    const imported = await library.openProject(info.id);
    expect(await imported.store.count('code')).toBe(1);
    expect(imported.me.name).toBe('Ana');
    expect(library.projects.find((p) => p.id === info.id)!.opened_at).not.toBeNull();
  });

  it('makes calls of the open project wait while its database is parked, instead of failing', async () => {
    const { library, platform, open, bundle } = await withOpenProject();
    const write = platform.blobs.write;
    let during: Promise<number> | null = null;
    platform.blobs.write = async (project, id, bytes) => {
      // The import is writing the new project's files: the open project's database is closed now.
      during ??= open.store.count('coder');
      return write(project, id, bytes);
    };
    await library.importBundle(bundle, { open: false });
    platform.blobs.write = write;
    expect(during).not.toBeNull();
    expect(await during).toBe(1);
  });

  it('keeps the open project open when the import fails part-way', async () => {
    const { library, platform, open, bundle } = await withOpenProject();
    const write = platform.blobs.write;
    platform.blobs.write = async () => {
      throw new PlatformError('ERROR', 'disk full');
    };
    await expect(library.importBundle(bundle, { open: false })).rejects.toThrow(/disk full/);
    platform.blobs.write = write;
    expect(library.current).toBe(open);
    expect(await open.store.count('coder')).toBe(1);
    expect(library.projects.map((p) => p.name)).toEqual(['Aberto']);
  });

  it('closes the open project if Trama locks while it is parked', async () => {
    const { library, platform, open, bundle } = await withOpenProject();
    const write = platform.blobs.write;
    let locking: Promise<void> | null = null;
    platform.blobs.write = async (project, id, bytes) => {
      locking ??= library.lock();
      return write(project, id, bytes);
    };
    await expect(library.importBundle(bundle, { open: false })).rejects.toMatchObject({ code: 'LOCKED' });
    await locking;
    expect(open.isOpen).toBe(false);
    expect(library.current).toBeNull();
  });

  it('imports without opening when no project is open', async () => {
    const { bundle } = await withOpenProject();
    const { library } = await setup();
    const info = await library.importBundle(bundle, { open: false, coderName: 'Ana' });
    expect(library.current).toBeNull();
    expect(library.projects.map((p) => p.id)).toEqual([info.id]);
  });
});

describe('observing the library', () => {
  it('reports every change to the list and to which project is open', async () => {
    const { library } = await setup();
    const seen: string[] = [];
    const stop = library.subscribe((c) => seen.push(`${c.type}${c.id ? '' : ':-'}`));
    const r0 = library.revision;
    const a = await library.createProject({ name: 'A', coderName: 'Ana' });
    await library.updateProject(a.id, { name: 'A2' });
    const b = await library.createProject({ name: 'B', coderName: 'Ana' });
    await library.openProject(a.id);
    await library.closeProject();
    await library.deleteProject(b.id);
    expect(seen).toEqual(['create', 'update', 'close', 'create', 'close', 'open', 'close', 'delete']);
    expect(library.revision).toBe(r0 + seen.length);
    // A listener that throws does not break the library or the other listeners.
    const other: string[] = [];
    library.subscribe(() => {
      throw new Error('boom');
    });
    library.subscribe((c) => other.push(c.type));
    stop();
    await library.updateProject(a.id, { color: '#29a37a' });
    expect(other).toEqual(['update']);
    expect(seen).toHaveLength(8);
    await library.lock();
    expect(other).toEqual(['update', 'lock']);
  });
});

describe('sanitizeRecords', () => {
  it('keeps the newest of duplicates and tombstones of odd shape that can still be indexed', () => {
    const base = { created_at: '2026-01-01T00:00:00Z', deleted: false };
    const out = sanitizeRecords([
      { kind: 'coder', record: { ...base, id: 'a', updated_at_hlc: '000001700000000-00000-ab', name: 'Old', color: '#000000' } },
      { kind: 'coder', record: { ...base, id: 'a', updated_at_hlc: '000001700000001-00000-ab', name: 'New', color: '#000000' } },
      { kind: 'memo', record: { ...base, id: 'm', deleted: true, updated_at_hlc: '000001700000000-00000-ab', title: '', body: '', target: { kind: 'project', id: null }, coder_id: null, color: null, scrubbed: true, content_omitted: true } as never },
      { kind: 'memo', record: { ...base, id: 'n', deleted: true, updated_at_hlc: '000001700000000-00000-ab' } as never },
    ]);
    expect(out.rejected).toBe(1);
    expect(out.records.map((r) => r.record.id).sort()).toEqual(['a', 'm']);
    expect(out.records.find((r) => r.record.id === 'a')!.record).toMatchObject({ name: 'New' });
    expect((out.records.find((r) => r.record.id === 'm')!.record as { content_omitted?: boolean }).content_omitted).toBeUndefined();
  });

  it('handles an empty list', () => {
    expect(sanitizeRecords([])).toEqual({ records: [], rejected: 0 });
  });
});

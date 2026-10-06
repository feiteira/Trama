// What a lock, a crash or a full disk leaves behind is put right, and never keeps a project shut.
import { describe, expect, it } from 'vitest';
import { utf8 } from '../core/bytes';
import { newRecoveryPhrase } from '../core/crypto/keyring';
import { readTramaZip } from '../core/export/trama';
import type { Db } from '../core/store/db';
import { createMemoryPlatform } from '../platform/memory';
import { PlatformError, type Platform } from '../platform/types';
import { restoreBackup, runBackup, setBackupFolder } from './backup';
import { createCode } from './codes';
import { applyCode } from './codings';
import { exportProjectFile, importProjectFile, mergeTeammateCopy, previewMerge } from './datafile';
import { createDocument, createDocuments } from './documents';
import { Library } from './library';
import { allCodings } from './queries';
import { FAST_KDF } from './testing';

const create = (platform: Platform) => Library.create(platform, { passphrase: 'pass word', recoveryPhrase: newRecoveryPhrase() }, { params: FAST_KDF });
const unlock = (platform: Platform) => Library.unlock(platform, 'passphrase', 'pass word', { params: FAST_KDF });

describe('a project list that cannot be written', () => {
  const diskFull = () => new PlatformError('IO_ERROR', 'file error: No space left on device (os error 28)');
  function fullable() {
    const base = createMemoryPlatform();
    const state = { full: false };
    const platform: Platform = { ...base, libraryFile: { read: base.libraryFile.read, write: async (t) => (state.full ? Promise.reject(diskFull()) : base.libraryFile.write(t)) } };
    return { base, platform, state };
  }

  it('still opens projects, and still unlocks', async () => {
    const { base, platform, state } = fullable();
    const lib = await create(platform);
    const p = await lib.createProject({ name: 'Thesis', coderName: 'Ana' });
    const other = await lib.createProject({ name: 'Other', coderName: 'Ana' });
    await lib.closeProject();
    state.full = true;
    const opened = await lib.openProject(p.id);
    expect(opened.info.name).toBe('Thesis');
    await lib.lock();
    await base.projects.erase(other.id);
    const again = await unlock(platform);
    expect(again.projects.map((x) => x.name)).toEqual(['Thesis']);
    // Creating a project still fails loudly: the list is the record of that.
    await expect(again.createProject({ name: 'New', coderName: 'Ana' })).rejects.toMatchObject({ code: 'IO_ERROR' });
  });
});

describe('a lock while a project is being made', () => {
  it('leaves no empty "recovered project", whatever moment it comes', async () => {
    for (let n = 1; n <= 24; n++) {
      const base = createMemoryPlatform();
      let arm = -1;
      let calls = 0;
      let lib: Library | null = null;
      const hit = async () => {
        if (arm > 0 && ++calls === arm) void lib!.lock();
      };
      const wrap = (db: Db): Db => ({
        exec: async (s, p) => (await hit(), db.exec(s, p)),
        query: async (s, p) => (await hit(), db.query(s, p)),
        batch: async (s) => (await hit(), db.batch(s)),
        script: async (s) => (await hit(), db.script(s)),
        close: () => db.close(),
      });
      const platform: Platform = { ...base, projects: { ...base.projects, open: async (id, k, c) => wrap(await base.projects.open(id, k, c)) } };
      lib = await create(platform);
      const src = await lib.createProject({ name: 'Source', coderName: 'Ana' });
      await createDocument(src, { name: 'D', kind: 'text', text: 'hello' });
      const bundle = readTramaZip(await exportProjectFile(src, { includePseudonyms: false }));
      calls = 0;
      arm = n;
      await lib.importBundle(bundle, { name: 'Imported', coderName: 'Ana' }).catch(() => null);
      arm = -1;
      const again = await unlock(platform);
      const listed = again.projects.map((p) => p.name).sort();
      expect(listed.some((x) => x.startsWith('Recovered project')), `lock at call ${n}: ${listed.join(', ')}`).toBe(false);
      expect((await base.projects.list()).length).toBe(listed.length);
    }
  });
});

describe('when a project opens', () => {
  it('files an import stored before a lock stopped it are removed', async () => {
    const platform = createMemoryPlatform();
    const lib = await create(platform);
    const p = await lib.createProject({ name: 'P', coderName: 'Ana' });
    const big = new Uint8Array(100_000);
    const inputs = [1, 2, 3].map((i) => ({ name: `Rec ${i}`, kind: 'transcript' as const, text: `T ${i}`, media: { bytes: big, filename: `r${i}.mp3`, mime: 'audio/mpeg' } }));
    await expect(createDocuments(p, inputs, { onProgress: async (d) => { if (d === 2) await lib.lock(); } })).rejects.toBeTruthy();
    // The failed batch removed its own files, though the project had closed.
    expect(platform.blobStore(p.id).size).toBe(0);
    // A file nothing points to (a crash before the batch could clean up) goes when the project opens.
    platform.blobStore(p.id).set('stray-blob', new Uint8Array(10));
    const again = await unlock(platform);
    const p2 = await again.openProject(p.id);
    expect(platform.blobStore(p.id).size).toBe(0);
    const { document } = await createDocument(p2, { name: 'Kept', kind: 'text', text: 'x', media: { bytes: utf8('ID3'), filename: 'k.mp3', mime: 'audio/mpeg' } });
    await again.closeProject();
    await again.openProject(p.id);
    expect([...platform.blobStore(p.id).keys()]).toEqual([document.media!.blob_id]);
  });

  it('what a write cut in half by an older Trama left is put right: codings past the end, a document without its text', async () => {
    const platform = createMemoryPlatform();
    const lib = await create(platform);
    const p = await lib.createProject({ name: 'P', coderName: 'Ana' });
    const { document: d } = await createDocument(p, { name: 'I1', kind: 'text', text: 'We stayed in.\nIt was cold and windy.' });
    const { document: d2 } = await createDocument(p, { name: 'I2', kind: 'text', text: 'Other.' });
    const { code } = await createCode(p, { name: 'Weather' });
    await applyCode(p, { documentId: d.id, start: 30, end: 35, codeId: code.id });
    // The text and length written, the removal of the coding not.
    await p.store.update('doctext', d.id, { text: 'We stayed in.' });
    await p.store.update('document', d.id, { chars: 13 });
    // A delete whose document tombstone was never written.
    await p.store.remove('doctext', [d2.id], { batch: 'b1' });
    await lib.closeProject();
    const p2 = await lib.openProject(p.id);
    expect(await allCodings(p2)).toEqual([]);
    expect((await p2.store.get('doctext', d2.id))!.deleted).toBe(false);
  });
});

describe('a backup restored next to its original', () => {
  it('exchanges copies with the team both ways', async () => {
    const platform = createMemoryPlatform();
    const ana = await create(platform);
    const pa = await ana.createProject({ name: 'Gardens', coderName: 'Ana' });
    const { document: doc } = await createDocument(pa, { name: 'Interview', kind: 'text', text: 'We grow beans and talk.' });
    const { code } = await createCode(pa, { name: 'Food' });
    platform.addDir('/usb');
    await setBackupFolder(pa, '/usb');
    await runBackup(pa);
    const rui = await create(createMemoryPlatform());
    const pr = await importProjectFile(rui, await exportProjectFile(pa, { includePseudonyms: false }), { kind: 'none' }, { asCopyOfSameProject: true });
    await pr.setMe((await pr.addCoder('Rui')).id);
    const [file] = await platform.files.list('/usb', false);
    const restored = await restoreBackup(ana, await platform.files.read(file!.path));
    expect(restored.id).not.toBe(pa.id);
    expect(restored.copyId).toBe(pa.id);
    await applyCode(pr, { documentId: doc.id, start: 8, end: 13, codeId: code.id });
    const fromRui = readTramaZip(await exportProjectFile(pr, { includePseudonyms: false }));
    await previewMerge(restored, fromRui);
    expect((await mergeTeammateCopy(restored, fromRui)).added).toBeGreaterThan(0);
    expect((await allCodings(restored)).map((c) => c.text)).toEqual(['beans']);
    await applyCode(restored, { documentId: doc.id, start: 18, end: 22, codeId: code.id });
    await mergeTeammateCopy(pr, readTramaZip(await exportProjectFile(restored, { includePseudonyms: false })));
    expect((await allCodings(pr)).map((c) => c.text).sort()).toEqual(['beans', 'talk']);
  });
});

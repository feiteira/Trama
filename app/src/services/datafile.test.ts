import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { fromUtf8, utf8 } from '../core/bytes';
import { DecryptError } from '../core/crypto/frames';
import { newRecoveryPhrase } from '../core/crypto/keyring';
import { protectionOf, readTramaZip, UnlockRequiredError } from '../core/export/trama';
import type { Draft } from '../core/model/types';
import { createMemoryPlatform } from '../platform/memory';
import {
  classifyMerge, DataFileError, exportProjectFile, importProjectFile, localStamps, mergeTeammateCopy, openProjectFile, previewMerge, projectToBundle,
  withoutContent,
} from './datafile';
import type { BundleRecord } from '../core/export/bundle';
import { Library } from './library';
import type { Project } from './project';
import { FAST_KDF, sha256hex } from './testing';

/** A clock the test moves by hand, shared by a library and its projects. */
function clock(start = '2026-10-05T12:00:00Z') {
  let t = new Date(start).getTime();
  return { now: () => new Date(t), advance: (ms: number) => void (t += ms) };
}

async function newLibrary(c = clock()) {
  const platform = createMemoryPlatform();
  const library = await Library.create(platform, { passphrase: 'pass word', recoveryPhrase: newRecoveryPhrase() }, { params: FAST_KDF, now: c.now });
  return { platform, library, clock: c };
}

const code = (name: string): Draft<'code'> => ({
  name, parent_id: null, color: '#e4572e', description: '', inclusion: '', exclusion: '', example: '', order: 1, codable: true, shortcut: null,
});

async function seeded(project: Project) {
  const s = project.store;
  const original = await project.addBlob(utf8('%PDF-1.7 interview'), 'entrevista.pdf', 'application/pdf');
  const doc = await s.put('document', {
    name: 'Entrevista Inês', kind: 'text', group_ids: [], case_id: null,
    source: { filename: 'entrevista.pdf', format: 'pdf', imported_at: '2026-10-05T12:00:00.000Z', text_sha256: sha256hex('A Maria Silva disse olá.') },
    original, media: null, chars: 24, order: 1, color: null,
  });
  await s.put('doctext', { id: doc.id, text: 'A Maria Silva disse olá.', sync: [] });
  const trust = await s.put('code', code('Confiança'));
  const coding = await s.put('coding', { document_id: doc.id, code_id: trust.id, coder_id: project.me.id, start: 2, end: 13, text: 'Maria Silva', comment: '' });
  await s.put('pseudonym', { original: 'Maria Silva', replacement: 'P1', note: '', whole_word: true, case_sensitive: false, applied_at: null, applied_count: 0 });
  return { doc, trust, coding, original };
}

describe('exporting and importing a .trama file', () => {
  it('round-trips a project into another library, without the pseudonymisation key by default', async () => {
    const a = await newLibrary();
    const p = await a.library.createProject({ name: 'Estudo 🌱', description: 'Piloto', coderName: 'Ana' });
    const { doc, coding } = await seeded(p);
    const bytes = await exportProjectFile(p, { includePseudonyms: false });
    expect(protectionOf(bytes)).toBe('none');
    const files = unzipSync(bytes);
    expect(strFromU8(files['data/pseudonym.jsonl']!)).toBe('');
    expect((await p.store.list('log')).some((l) => l.action === 'export')).toBe(true);

    const b = await newLibrary();
    const imported = await importProjectFile(b.library, bytes, { kind: 'none' }, { coderName: 'Rui' });
    expect(imported.id).not.toBe(p.id);
    expect(imported.info.name).toBe('Estudo 🌱');
    expect(imported.me.name).toBe('Rui');
    expect((await imported.store.get('coding', coding.id))!.text).toBe('Maria Silva');
    expect(await imported.store.count('pseudonym')).toBe(0);
    const d = (await imported.store.get('document', doc.id))!;
    expect(fromUtf8(await imported.readBlob(d.original!))).toBe('%PDF-1.7 interview');
  });

  it('includes the pseudonymisation key when asked, and protects with a password', async () => {
    const a = await newLibrary();
    const p = await a.library.createProject({ name: 'Estudo', coderName: 'Ana' });
    await seeded(p);
    const bytes = await exportProjectFile(p, { includePseudonyms: true, password: 'segredo' });
    expect(protectionOf(bytes)).toBe('password');
    expect(fromUtf8(bytes)).not.toContain('Maria');
    await expect(openProjectFile(a.platform, bytes, { kind: 'none' })).rejects.toBeInstanceOf(UnlockRequiredError);
    await expect(openProjectFile(a.platform, bytes, { kind: 'password', password: 'errado' })).rejects.toBeInstanceOf(DecryptError);
    const { bundle } = await openProjectFile(a.platform, bytes, { kind: 'password', password: 'segredo' });
    expect(bundle.records.filter((r) => r.kind === 'pseudonym')).toHaveLength(1);
    expect(bundle.manifest.include_pseudonyms).toBe(true);
  });

  it('carries deleted records without their content, so a file never holds what was deleted', async () => {
    const a = await newLibrary();
    const p = await a.library.createProject({ name: 'Estudo', coderName: 'Ana' });
    const { doc } = await seeded(p);
    await p.store.remove('doctext', [doc.id]);
    await p.store.remove('document', [doc.id]);
    const bytes = await exportProjectFile(p, { includePseudonyms: false });
    const bundle = readTramaZip(bytes);
    const tomb = bundle.records.find((r) => r.kind === 'doctext' && r.record.id === doc.id)!.record as { text: string; scrubbed?: boolean; content_omitted?: boolean; deleted: boolean };
    expect(tomb).toMatchObject({ text: '', deleted: true, scrubbed: true, content_omitted: true });
    expect(bundle.blobs.size).toBe(0); // the deleted document's file stays home
    const text = Object.values(unzipSync(bytes)).map((f) => strFromU8(f)).join('\n');
    expect(text).not.toContain('Entrevista Inês');
    expect(text).not.toContain('disse olá');
  });

  it('leaves out a file that is missing and says so, but stops when the project closes', async () => {
    const a = await newLibrary();
    const p = await a.library.createProject({ name: 'Estudo', coderName: 'Ana' });
    const { original } = await seeded(p);
    await p.removeBlob(original);
    const bundle = await projectToBundle(p, { includeDeleted: false, includePseudonyms: false });
    expect(bundle.blobs.size).toBe(0);
    expect(bundle.warnings).toEqual(['Entrevista Inês: entrevista.pdf']);
    await expect(projectToBundle(p, { includeDeleted: false, includePseudonyms: false, shouldStop: () => true })).rejects.toThrow(/locking/);
  });

  it('blanks content but keeps what the database indexes', () => {
    const memo = { id: 'm', created_at: 'x', updated_at_hlc: 'h', deleted: true, title: 'Secret', body: 'Secret', target: { kind: 'code' as const, id: 'c' }, coder_id: null, color: null, deleted_batch: 'b' };
    expect(withoutContent('memo', memo)).toMatchObject({ title: '', body: '', target: { kind: 'code', id: 'c' }, deleted_batch: 'b', scrubbed: true, content_omitted: true });
  });
});

describe('merging a teammate\'s copy', () => {
  /** Ana's project, and Rui's copy of it in his own library, both with the same record ids. */
  async function twoCopies() {
    const c = clock();
    const ana = await newLibrary(c);
    const pa = await ana.library.createProject({ name: 'Estudo partilhado', coderName: 'Ana' });
    const seed = await seeded(pa);
    const file = await exportProjectFile(pa, { includePseudonyms: false });
    const rui = await newLibrary(c);
    const pr = await importProjectFile(rui.library, file, { kind: 'none' }, { asCopyOfSameProject: true });
    expect(pr.id).toBe(pa.id);
    expect(pr.needsCoder).toBe(true);
    await pr.setMe((await pr.addCoder('Rui')).id);
    return { c, ana, pa, rui, pr, seed };
  }

  it('brings each side the other\'s work, the newer edit winning, in either order', async () => {
    const { c, pa, pr, seed } = await twoCopies();
    // Both edit the same code; Rui later. Each adds their own coding.
    c.advance(1000);
    await pa.store.update('code', seed.trust.id, { description: 'Ana\'s definition' });
    const anaCoding = await pa.store.put('coding', { document_id: seed.doc.id, code_id: seed.trust.id, coder_id: pa.me.id, start: 0, end: 1, text: 'A', comment: '' });
    c.advance(1000);
    await pr.store.update('code', seed.trust.id, { description: 'Rui\'s definition' });
    const ruiCoding = await pr.store.put('coding', { document_id: seed.doc.id, code_id: seed.trust.id, coder_id: pr.me.id, start: 2, end: 7, text: 'Maria', comment: '' });
    c.advance(1000);
    await pa.store.remove('coding', [seed.coding.id]); // Ana deletes the first coding

    const fromRui = readTramaZip(await exportProjectFile(pr, { includePseudonyms: false }));
    const fromAna = readTramaZip(await exportProjectFile(pa, { includePseudonyms: false }));
    // The preview counts exactly what the merge then does, and writes nothing.
    const before = await pa.store.count('coding');
    const preview = await previewMerge(pa, fromRui);
    expect(await pa.store.count('coding')).toBe(before);
    expect(preview.newCoders.map((x) => x.name)).toEqual(['Rui']);
    expect(preview.byKind.coding).toEqual({ added: 1, updated: 0 });
    expect(preview.byKind.code).toEqual({ added: 0, updated: 1 });
    const intoAna = await mergeTeammateCopy(pa, fromRui);
    expect(intoAna).toMatchObject({ added: preview.added, updated: preview.updated, unchanged: preview.unchanged, rejected: preview.rejected });
    const intoRui = await mergeTeammateCopy(pr, fromAna);
    expect(intoAna.added).toBeGreaterThanOrEqual(2); // Rui's coder and coding (and his logs)
    expect(intoAna.updated).toBeGreaterThanOrEqual(1);
    expect(intoRui.updated).toBeGreaterThanOrEqual(1);

    for (const p of [pa, pr]) {
      expect((await p.store.get('code', seed.trust.id))!.description).toBe('Rui\'s definition');
      expect((await p.store.get('coding', seed.coding.id))!.deleted).toBe(true);
      expect(await p.store.get('coding', anaCoding.id)).not.toBeNull();
      expect(await p.store.get('coding', ruiCoding.id)).not.toBeNull();
      // Both coders are there: agreement between them can be measured.
      expect((await p.coders()).map((x) => x.name)).toEqual(['Ana', 'Rui']);
    }
    // Each kept who "me" is.
    expect(pa.me.name).toBe('Ana');
    expect(pr.me.name).toBe('Rui');

    // Merging the same copy again changes nothing.
    const again = await mergeTeammateCopy(pa, fromRui);
    expect(again.added + again.updated).toBe(0);
    expect((await pa.store.list('log')).filter((l) => l.action === 'project.merge')).toHaveLength(2);
  });

  it('keeps the content of a record here that the copy deleted, so it can still be restored', async () => {
    const { c, pa, pr, seed } = await twoCopies();
    c.advance(1000);
    await pr.store.remove('doctext', [seed.doc.id]);
    const fromRui = readTramaZip(await exportProjectFile(pr, { includePseudonyms: false }));
    await mergeTeammateCopy(pa, fromRui);
    const here = (await pa.store.get('doctext', seed.doc.id))!;
    expect(here.deleted).toBe(true);
    expect(here.text).toBe('A Maria Silva disse olá.');
    expect((await pa.store.restore('doctext', [seed.doc.id]))[0]!.text).toBe('A Maria Silva disse olá.');
  });

  it('stores files the copy has and this project lacks', async () => {
    const { pa, pr, seed } = await twoCopies();
    await pa.removeBlob(seed.original);
    const result = await mergeTeammateCopy(pa, readTramaZip(await exportProjectFile(pr, { includePseudonyms: false })));
    expect(result.blobs).toBe(1);
    expect(fromUtf8(await pa.readBlob(seed.original))).toBe('%PDF-1.7 interview');
  });

  it('never keeps a pseudonymisation key from being left out of a copy', async () => {
    const { pa, pr } = await twoCopies();
    await mergeTeammateCopy(pa, readTramaZip(await exportProjectFile(pr, { includePseudonyms: false })));
    expect(await pa.store.count('pseudonym')).toBe(1);
  });

  it('refuses a different project, and forgets the last backup so the next one is made', async () => {
    const { ana, pa } = await twoCopies();
    const other = await ana.library.createProject({ name: 'Outro', coderName: 'Ana' });
    const otherFile = readTramaZip(await exportProjectFile(other, { includePseudonyms: false }));
    const back = await ana.library.openProject(pa.id);
    await expect(mergeTeammateCopy(back, otherFile)).rejects.toBeInstanceOf(DataFileError);
    await expect(previewMerge(back, otherFile)).rejects.toMatchObject({ code: 'DIFFERENT_PROJECT' });
    await expect(mergeTeammateCopy(back, { ...otherFile, project: { ...otherFile.project, id: null } })).rejects.toMatchObject({ code: 'DIFFERENT_PROJECT' });
    await back.store.setMeta('backup.last_hlc', 'x');
    const self = readTramaZip(await exportProjectFile(back, { includePseudonyms: false }));
    await mergeTeammateCopy(back, self);
    expect(await back.store.getMeta('backup.last_hlc')).toBeNull();
  });
});

describe('merge preview', () => {
  const base = (id: string, hlc: string, deleted = false) => ({ id, created_at: '2026-01-01T00:00:00Z', updated_at_hlc: hlc, deleted });

  it('counts new, newer and unchanged records the way a merge decides', () => {
    const local = new Map([
      [
        'coding',
        new Map([
          ['c1', 'h5'],
          ['c2', 'h5'],
        ]),
      ],
      ['coder', new Map([['ana', 'h1']])],
    ]) as Parameters<typeof classifyMerge>[2];
    const records = [
      { kind: 'coder', record: { ...base('ana', 'h1'), name: 'Ana', color: '#000000' } },
      { kind: 'coder', record: { ...base('rui', 'h2'), name: 'Rui', color: '#b5179e' } },
      { kind: 'coder', record: { ...base('gone', 'h2', true), name: '', color: '#000000' } },
      { kind: 'coding', record: { ...base('c1', 'h9') } },
      { kind: 'coding', record: { ...base('c2', 'h1') } },
      { kind: 'coding', record: { ...base('c3', 'h1') } },
      { kind: 'memo', record: { ...base('m1', 'h1') } },
      { kind: 'log', record: { ...base('l1', 'h1') } },
    ] as unknown as BundleRecord[];
    const p = classifyMerge('Gardens', records, local, 2);
    expect(p).toMatchObject({ projectName: 'Gardens', added: 5, updated: 1, unchanged: 2, rejected: 2 });
    expect(p.byKind.coding).toEqual({ added: 1, updated: 1 });
    expect(p.byKind.memo).toEqual({ added: 1, updated: 0 });
    // A record arriving deleted shows nowhere; kinds with nothing to show are left out.
    expect(p.byKind.coder).toEqual({ added: 1, updated: 0 });
    expect(p.byKind.log).toEqual({ added: 1, updated: 0 });
    expect(Object.keys(p.byKind).sort()).toEqual(['coder', 'coding', 'log', 'memo']);
    expect(p.newCoders).toEqual([{ id: 'rui', name: 'Rui', color: '#b5179e' }]);
  });

  it('reads the stamps of the project, deleted records included, and counts damaged records', async () => {
    const { library } = await newLibrary();
    const project = await library.createProject({ name: 'Hortas', coderName: 'Ana' });
    const c = await project.store.put('code', code('Trust'));
    await project.store.remove('code', [c.id]);
    const stamps = await localStamps(project.store);
    expect(stamps.get('code')?.has(c.id)).toBe(true);
    expect(stamps.get('coder')?.get(project.me.id)).toMatchObject({ updated_at_hlc: project.me.updated_at_hlc });
    const preview = await previewMerge(project, {
      project: { id: project.id, name: 'Copy', description: '', origin: null },
      records: [{ kind: 'coder', record: project.me }, { kind: 'coder', record: { ...project.me, id: 'x', name: '', updated_at_hlc: 'bad' } }] as BundleRecord[],
      blobs: new Map(),
      warnings: [],
    });
    expect(preview).toMatchObject({ added: 0, updated: 0, unchanged: 1, rejected: 1, newCoders: [] });
  });
});

describe('exports leave out the original files of edited documents', () => {
  it('a pseudonymised PDF\'s original (and a file name holding the name) stays out of .trama files; a merge back keeps them here', async () => {
    const { createDocument } = await import('./documents');
    const { apply, createPseudonym } = await import('./pseudonyms');
    const c = clock();
    const a = await newLibrary(c);
    const p = await a.library.createProject({ name: 'Estudo', coderName: 'Ana' });
    const { document: doc } = await createDocument(p, {
      name: 'Interview 1', kind: 'pdf', text: 'Maria Silva said she was afraid.',
      source: { filename: 'Maria_Silva_interview.pdf', format: 'pdf' },
      original: { bytes: utf8('%PDF-1.7 ... Maria Silva said she was afraid ...'), filename: 'Maria_Silva_interview.pdf', mime: 'application/pdf' },
    });
    await createPseudonym(p, { original: 'Maria Silva', replacement: 'P1' });
    expect((await apply(p)).replacements).toBeGreaterThanOrEqual(1);
    const bytes = await exportProjectFile(p, { includePseudonyms: false });
    const files = unzipSync(bytes);
    for (const [name, content] of Object.entries(files)) {
      expect(strFromU8(content).includes('Maria Silva'), name).toBe(false);
      expect(strFromU8(content).includes('Maria_Silva'), name).toBe(false);
    }
    expect(Object.keys(files).some((n) => n.startsWith('blobs/'))).toBe(false);
    // Asked for explicitly, the original travels.
    const withOriginals = unzipSync(await exportProjectFile(p, { includePseudonyms: false, includeEditedOriginals: true }));
    expect(Object.keys(withOriginals).some((n) => n.startsWith('blobs/'))).toBe(true);

    // A teammate's newer version of the document merged back keeps the original and file name here.
    c.advance(1000);
    const rui = await newLibrary(c);
    const pr = await importProjectFile(rui.library, bytes, { kind: 'none' }, { asCopyOfSameProject: true });
    await pr.setMe((await pr.addCoder('Rui')).id);
    c.advance(1000);
    const { renameDocument } = await import('./documents');
    await renameDocument(pr, doc.id, 'Interview one');
    await mergeTeammateCopy(p, readTramaZip(await exportProjectFile(pr, { includePseudonyms: false })));
    const back = (await p.store.get('document', doc.id))!;
    expect(back.name).toBe('Interview one');
    expect(back.original?.blob_id).toBe(doc.original!.blob_id);
    // Applying the key replaced the name in the file names too.
    expect(back.source?.filename).toBe('P1_interview.pdf');
  });
});

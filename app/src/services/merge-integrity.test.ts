// Merging a teammate's copy keeps texts, codings and documents coherent (reconcile.ts).
import { describe, expect, it } from 'vitest';
import { newRecoveryPhrase } from '../core/crypto/keyring';
import { readTramaZip } from '../core/export/trama';
import { createMemoryPlatform } from '../platform/memory';
import { createCode, deleteCode } from './codes';
import { applyCode, setComment } from './codings';
import { exportProjectFile, importProjectFile, mergeTeammateCopy, previewMerge } from './datafile';
import { createDocument, deleteDocuments, editDocumentText, renameDocument } from './documents';
import { Library } from './library';
import { apply, createPseudonym } from './pseudonyms';
import { allCodings, listCodesWithCounts, listDocuments, projectSummary } from './queries';
import { FAST_KDF } from './testing';
import type { Project } from './project';

const TEXT = 'Ana: I started in Porto with Rui.\nAna: Trust came later.';

function clock(start = '2026-10-05T12:00:00Z') {
  let t = new Date(start).getTime();
  return { now: () => new Date(t), advance: (ms = 1000) => void (t += ms) };
}

async function twoCopies() {
  const c = clock();
  const mk = () => Library.create(createMemoryPlatform(), { passphrase: 'pass word', recoveryPhrase: newRecoveryPhrase() }, { params: FAST_KDF, now: c.now });
  const ana = await mk();
  const pa = await ana.createProject({ name: 'Shared', coderName: 'Ana' });
  const { document: doc } = await createDocument(pa, { name: 'Interview 1', kind: 'transcript', text: TEXT });
  const { code } = await createCode(pa, { name: 'Trust' });
  const start = TEXT.indexOf('Trust');
  const { coding } = await applyCode(pa, { documentId: doc.id, start, end: start + 5, codeId: code.id });
  c.advance();
  const rui = await mk();
  const pr = await importProjectFile(rui, await exportProjectFile(pa, { includePseudonyms: false }), { kind: 'none' }, { asCopyOfSameProject: true });
  await pr.setMe((await pr.addCoder('Rui')).id);
  c.advance();
  return { c, pa, pr, doc, code, coding };
}

const copyOf = async (p: Project) => readTramaZip(await exportProjectFile(p, { includePseudonyms: false }));

async function slices(p: Project, docId: string) {
  const text = (await p.store.get('doctext', docId))!.text;
  return (await allCodings(p)).filter((c) => c.document_id === docId).map((c) => ({ stored: c.text, doc: text.slice(c.start, c.end), inside: c.end <= text.length }));
}

describe('merging keeps codings on their words', () => {
  it('A1: a coding the teammate made on the old text lands on the same words of my edited text', async () => {
    const { c, pa, pr, doc, code } = await twoCopies();
    await editDocumentText(pa, doc.id, TEXT.replace('Porto', 'Porto city'));
    c.advance();
    const s = TEXT.indexOf('Trust came later');
    await applyCode(pr, { documentId: doc.id, start: s, end: s + 'Trust came later'.length, codeId: code.id });
    c.advance();
    const r = await mergeTeammateCopy(pa, await copyOf(pr));
    expect(r.reanchored).toBeGreaterThanOrEqual(1);
    for (const x of await slices(pa, doc.id)) {
      expect(x.inside).toBe(true);
      expect(x.doc).toBe(x.stored);
    }
    expect((await slices(pa, doc.id)).map((x) => x.doc).sort()).toEqual(['Trust', 'Trust came later']);
  });

  it('A2: a newer comment on the old offsets does not move my coding off its words', async () => {
    const { c, pa, pr, doc, coding } = await twoCopies();
    await editDocumentText(pa, doc.id, TEXT.replace('Porto', 'Porto city'));
    c.advance();
    await setComment(pr, coding.id, 'Rui thinks this is key');
    c.advance();
    await mergeTeammateCopy(pa, await copyOf(pr));
    const got = (await pa.store.get('coding', coding.id))!;
    const text = (await pa.store.get('doctext', doc.id))!.text;
    expect(got.comment).toBe('Rui thinks this is key');
    expect(text.slice(got.start, got.end)).toBe('Trust');
    expect(got.text).toBe('Trust');
  });

  it('removes codings whose words are gone, and never leaves one past the end of the text', async () => {
    const { c, pa, pr, doc, code } = await twoCopies();
    await editDocumentText(pa, doc.id, 'Ana: Trust.');
    c.advance();
    const s = TEXT.indexOf('I started');
    await applyCode(pr, { documentId: doc.id, start: s, end: s + 20, codeId: code.id });
    c.advance();
    const r = await mergeTeammateCopy(pa, await copyOf(pr));
    expect(r.removedCodings).toBe(1);
    const all = await slices(pa, doc.id);
    expect(all).toEqual([{ stored: 'Trust', doc: 'Trust', inside: true }]);
  });

  it('A8: a teammate\'s later typo fix does not undo my pseudonymisation; the conflict is reported', async () => {
    const { c, pa, pr, doc } = await twoCopies();
    await createPseudonym(pa, { original: 'Rui', replacement: '[P2]' });
    await apply(pa);
    c.advance();
    await editDocumentText(pr, doc.id, TEXT.replace('later.', 'later!'));
    c.advance();
    const copy = await copyOf(pr);
    const preview = await previewMerge(pa, copy);
    expect(preview.textConflicts.map((x) => x.documentId)).toEqual([doc.id]);
    const r = await mergeTeammateCopy(pa, copy);
    expect(r.textConflicts.map((x) => x.name)).toEqual(['Interview 1']);
    const text = (await pa.store.get('doctext', doc.id))!.text;
    expect(text).not.toContain('Rui');
    expect(text).toContain('[P2]');
  });

  it('a teammate\'s text that descends from mine (they edited after receiving it) is taken', async () => {
    const { c, pa, pr, doc, coding } = await twoCopies();
    await editDocumentText(pr, doc.id, TEXT.replace('Porto', 'Lisbon'));
    c.advance();
    const r = await mergeTeammateCopy(pa, await copyOf(pr));
    expect(r.textConflicts).toEqual([]);
    const text = (await pa.store.get('doctext', doc.id))!.text;
    expect(text).toContain('Lisbon');
    const got = (await pa.store.get('coding', coding.id))!;
    expect(text.slice(got.start, got.end)).toBe('Trust');
  });
});

describe('merging keeps derived and paired records in step', () => {
  it('A7: document.chars follows the merged text, so character agreement is right', async () => {
    const { c, pa, pr, doc } = await twoCopies();
    const long = TEXT + '\nAna: ' + 'More talk about the garden and the neighbours. '.repeat(20);
    await editDocumentText(pa, doc.id, long);
    c.advance();
    await renameDocument(pr, doc.id, 'Interview one');
    c.advance();
    await mergeTeammateCopy(pa, await copyOf(pr));
    const d = (await pa.store.get('document', doc.id))!;
    const t = (await pa.store.get('doctext', doc.id))!;
    expect(d.name).toBe('Interview one');
    expect(d.chars).toBe(t.text.length);
  });

  it('A6: a document deleted here and renamed there later comes back with its text and codings', async () => {
    const { c, pa, pr, doc, coding } = await twoCopies();
    await deleteDocuments(pa, [doc.id]);
    c.advance();
    await renameDocument(pr, doc.id, 'Interview one');
    c.advance();
    await mergeTeammateCopy(pa, await copyOf(pr));
    const rows = await listDocuments(pa);
    expect(rows.map((r) => r.document.name)).toEqual(['Interview one']);
    expect((await pa.store.get('doctext', doc.id))!.deleted).toBe(false);
    expect((await pa.store.get('coding', coding.id))!.deleted).toBe(false);
    expect(rows[0]!.codings).toBe(1);
  });

  it('A3: a teammate\'s coding with a code deleted here brings the code back (newer work wins), counted everywhere', async () => {
    const { c, pa, pr, doc, code } = await twoCopies();
    await deleteCode(pa, code.id, { withChildren: 'delete' });
    c.advance();
    const s = TEXT.indexOf('Trust came');
    await applyCode(pr, { documentId: doc.id, start: s, end: s + 16, codeId: code.id });
    c.advance();
    const r = await mergeTeammateCopy(pa, await copyOf(pr));
    expect(r.revived).toEqual([{ kind: 'code', id: code.id, name: 'Trust' }]);
    expect((await pa.store.get('code', code.id))!.deleted).toBe(false);
    // Rui's coding and Ana's own (taken by her delete) are both back, and counted alike.
    expect((await listDocuments(pa))[0]!.codings).toBe(2);
    expect((await projectSummary(pa)).codings).toBe(2);
    expect(await allCodings(pa)).toHaveLength(2);
  });

  it('A4: codings in a document deleted here are not counted in the codebook or the overview', async () => {
    const { c, pa, pr, doc, code } = await twoCopies();
    await deleteDocuments(pa, [doc.id]);
    c.advance();
    const s = TEXT.indexOf('Trust came');
    await applyCode(pr, { documentId: doc.id, start: s, end: s + 16, codeId: code.id });
    c.advance();
    await mergeTeammateCopy(pa, await copyOf(pr));
    const row = (await listCodesWithCounts(pa)).find((r) => r.code.id === code.id)!;
    expect(row).toMatchObject({ own: 0, documents: 0 });
    expect(await projectSummary(pa)).toMatchObject({ codings: 0, codedDocuments: 0, documents: 0 });
  });
});

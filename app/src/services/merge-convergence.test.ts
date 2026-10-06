// Merging copies both ways converges, keeps work over deletes, and never brings back names a
// pseudonymisation replaced (reconcile.ts, datafile.ts, revs.ts).
import { describe, expect, it } from 'vitest';
import { newRecoveryPhrase } from '../core/crypto/keyring';
import { readTramaZip } from '../core/export/trama';
import { createMemoryPlatform } from '../platform/memory';
import { createCode, deleteCode, updateCode } from './codes';
import { applyCode, setComment } from './codings';
import { exportProjectFile, importProjectFile, mergeTeammateCopy, previewMerge } from './datafile';
import { createDocument, deleteDocuments, editDocumentText, renameDocument, setDocumentColor, takeTeammateText } from './documents';
import { Library } from './library';
import { apply, createPseudonym } from './pseudonyms';
import { allCodings } from './queries';
import { MERGE_PENDING } from './reconcile';
import { FAST_KDF } from './testing';
import { UndoManager } from './undo';
import type { Project } from './project';

const TEXT = 'Ana: I started in Porto with Rui.\nAna: Trust came later.';

function clock(start = '2026-10-05T12:00:00Z') {
  let t = new Date(start).getTime();
  return { now: () => new Date(t), advance: (ms = 1000) => void (t += ms) };
}

async function twoCopies(name = 'Interview 1') {
  const c = clock();
  const platform = createMemoryPlatform();
  const mk = (pl = createMemoryPlatform()) => Library.create(pl, { passphrase: 'pass word', recoveryPhrase: newRecoveryPhrase() }, { params: FAST_KDF, now: c.now });
  const ana = await mk(platform);
  const pa = await ana.createProject({ name: 'Shared', coderName: 'Ana' });
  const { document: doc } = await createDocument(pa, { name, kind: 'transcript', text: TEXT });
  const { code } = await createCode(pa, { name: 'Trust' });
  const start = TEXT.indexOf('Trust');
  const { coding } = await applyCode(pa, { documentId: doc.id, start, end: start + 5, codeId: code.id });
  c.advance();
  const rui = await mk();
  const pr = await importProjectFile(rui, await exportProjectFile(pa, { includePseudonyms: false }), { kind: 'none' }, { asCopyOfSameProject: true });
  await pr.setMe((await pr.addCoder('Rui')).id);
  c.advance();
  return { c, ana, platform, pa, pr, doc, code, coding };
}

const copyOf = async (p: Project) => readTramaZip(await exportProjectFile(p, { includePseudonyms: false }));
const textOf = async (p: Project, id: string) => (await p.store.get('doctext', id))!.text;

/** Every live coding sits on its words, and none holds an original of `names`. */
async function coherent(p: Project, names: string[] = []) {
  for (const c of await allCodings(p)) {
    const t = await textOf(p, c.document_id);
    expect(t.slice(c.start, c.end), `coding ${c.id}`).toBe(c.text);
    for (const n of names) expect(c.text).not.toContain(n);
  }
}

describe('text conflicts converge', () => {
  it('after a conflict and a hand merge, each side merging the other once ends with one text and no conflict', async () => {
    const { c, pa, pr, doc } = await twoCopies();
    await editDocumentText(pa, doc.id, TEXT.replace('Porto', 'Porto city'));
    c.advance();
    await editDocumentText(pr, doc.id, TEXT.replace('later.', 'later!'));
    c.advance();
    const r1 = await mergeTeammateCopy(pa, await copyOf(pr));
    expect(r1.textConflicts.map((x) => x.documentId)).toEqual([doc.id]);
    expect(await textOf(pa, doc.id)).toContain('Porto city');
    c.advance();
    // Ana brings Rui's change over by hand, as the conflict notice says.
    await editDocumentText(pa, doc.id, TEXT.replace('Porto', 'Porto city').replace('later.', 'later!'));
    c.advance();
    const r2 = await mergeTeammateCopy(pr, await copyOf(pa));
    expect(r2.textConflicts).toEqual([]);
    c.advance();
    const r3 = await mergeTeammateCopy(pa, await copyOf(pr));
    expect(r3.textConflicts).toEqual([]);
    expect(await textOf(pr, doc.id)).toBe(await textOf(pa, doc.id));
    expect(await textOf(pa, doc.id)).toBe(TEXT.replace('Porto', 'Porto city').replace('later.', 'later!'));
    // Nothing more moves: a further round updates nothing (only Ana's new log entries come in).
    c.advance();
    const r4 = await mergeTeammateCopy(pr, await copyOf(pa));
    expect([r4.updated, r4.reanchored, r4.textConflicts.length]).toEqual([0, 0, 0]);
  });

  it('the side whose text lost a conflict is told when it merges back, and can take the other text', async () => {
    const { c, pa, pr, doc } = await twoCopies();
    await editDocumentText(pa, doc.id, TEXT.replace('Porto', 'Porto city'));
    c.advance();
    await editDocumentText(pr, doc.id, TEXT.replace('later.', 'later!'));
    c.advance();
    const r1 = await mergeTeammateCopy(pa, await copyOf(pr));
    c.advance();
    const r2 = await mergeTeammateCopy(pr, await copyOf(pa));
    expect(r2.textConflicts).toEqual([]);
    expect(r2.textsReplaced.map((x) => x.documentId)).toEqual([doc.id]);
    expect(await textOf(pr, doc.id)).toBe(await textOf(pa, doc.id));
    // Ana could have taken Rui's text instead: both copies then keep that one.
    const conflict = r1.textConflicts[0]!;
    await takeTeammateText(pa, doc.id, conflict.theirText!, conflict.theirRevs!);
    c.advance();
    expect((await mergeTeammateCopy(pr, await copyOf(pa))).textConflicts).toEqual([]);
    expect(await textOf(pr, doc.id)).toBe(TEXT.replace('later.', 'later!'));
    await coherent(pa);
    await coherent(pr);
  });

  it('an undo is a new revision: a copy holding the text from before it is a conflict, never taken silently', async () => {
    const { c, pa, doc } = await twoCopies();
    const m = new UndoManager();
    const pasted = TEXT.replace('Porto', 'Porto (Maria Silva, Rua das Flores 12)');
    m.record((await editDocumentText(pa, doc.id, pasted)).undo);
    c.advance();
    const rui = await Library.create(createMemoryPlatform(), { passphrase: 'pass word', recoveryPhrase: newRecoveryPhrase() }, { params: FAST_KDF, now: c.now });
    const pr = await importProjectFile(rui, await exportProjectFile(pa, { includePseudonyms: false }), { kind: 'none' }, { asCopyOfSameProject: true });
    await pr.setMe((await pr.addCoder('Rui')).id);
    c.advance();
    await m.undo();
    expect(await textOf(pa, doc.id)).toBe(TEXT);
    c.advance();
    await editDocumentText(pr, doc.id, pasted.replace('later.', 'later!'));
    c.advance();
    const r = await mergeTeammateCopy(pa, await copyOf(pr));
    expect(r.textConflicts).toHaveLength(1);
    expect(await textOf(pa, doc.id)).not.toContain('Maria');
  });

  it('many saves on one side, none on the other: the copy is taken (no conflict)', async () => {
    const { c, pa, pr, doc } = await twoCopies();
    for (let i = 0; i < 80; i++) await editDocumentText(pr, doc.id, `${TEXT} v${i}`);
    c.advance();
    const r = await mergeTeammateCopy(pa, await copyOf(pr));
    expect(r.textConflicts).toEqual([]);
    expect(await textOf(pa, doc.id)).toBe(`${TEXT} v79`);
  });
});

describe('records brought back by a merge are put back on their words', () => {
  it('a code deleted here, then the text edited, and the code renamed there: its codings sit on their words', async () => {
    const { c, pa, pr, doc, code, coding } = await twoCopies();
    await deleteCode(pa, code.id, { withChildren: 'delete' });
    c.advance();
    await editDocumentText(pa, doc.id, TEXT.replace('Porto', 'Porto, the city of my childhood,'));
    c.advance();
    await updateCode(pr, code.id, { name: 'Trust (Rui)' });
    c.advance();
    await mergeTeammateCopy(pa, await copyOf(pr));
    const got = (await pa.store.get('coding', coding.id))!;
    expect(got.deleted).toBe(false);
    expect((await textOf(pa, doc.id)).slice(got.start, got.end)).toBe('Trust');
    await coherent(pa);
  });

  it('a code deleted here, then pseudonymisation, and the code renamed there: no coding holds the real name', async () => {
    const { c, pa, pr, doc, code } = await twoCopies();
    const s = TEXT.indexOf('with Rui');
    await applyCode(pa, { documentId: doc.id, start: s, end: s + 8, codeId: code.id });
    c.advance();
    await deleteCode(pa, code.id, { withChildren: 'delete' });
    c.advance();
    await createPseudonym(pa, { original: 'Rui', replacement: '[P2]' });
    await apply(pa);
    c.advance();
    await updateCode(pr, code.id, { name: 'Trust (Rui)' });
    c.advance();
    await mergeTeammateCopy(pa, await copyOf(pr));
    expect(await allCodings(pa)).toHaveLength(2);
    await coherent(pa, ['Rui']);
    // The code's name from the copy got the key applied too.
    expect((await pa.store.get('code', code.id))!.name).toBe('Trust ([P2])');
  });

  it('a document deleted here and edited there comes back with what its delete took, on the right words', async () => {
    const { c, pa, pr, doc, code } = await twoCopies();
    const s = TEXT.indexOf('Porto');
    const { coding: porto } = await applyCode(pa, { documentId: doc.id, start: s, end: s + 5, codeId: code.id });
    c.advance();
    await deleteDocuments(pa, [doc.id]);
    c.advance();
    await editDocumentText(pr, doc.id, `Interviewer: hello Porto.\n${TEXT}`);
    c.advance();
    await mergeTeammateCopy(pa, await copyOf(pr));
    const got = (await pa.store.get('coding', porto.id))!;
    expect(got.deleted).toBe(false);
    expect(got.start).toBe(`Interviewer: hello Porto.\n${TEXT}`.lastIndexOf('Porto'));
    await coherent(pa);
  });
});

describe('a merge never brings back names the key replaced', () => {
  it('a document name and a coding comment from a copy made before the key was applied get it applied again', async () => {
    const { c, pa, pr, doc, coding } = await twoCopies('Interview with Rui');
    await createPseudonym(pa, { original: 'Rui', replacement: '[P2]' });
    await apply(pa);
    expect((await pa.store.get('document', doc.id))!.name).toBe('Interview with [P2]');
    c.advance();
    await setDocumentColor(pr, doc.id, '#aa3355');
    await setComment(pr, coding.id, 'Rui hesitates here');
    c.advance();
    const r = await mergeTeammateCopy(pa, await copyOf(pr));
    const d = (await pa.store.get('document', doc.id))!;
    expect(d.name).toBe('Interview with [P2]');
    expect(d.color).toBe('#aa3355');
    expect((await pa.store.get('coding', coding.id))!.comment).toBe('[P2] hesitates here');
    expect(r.repseudonymised.map((h) => h.field).sort()).toEqual(['comment', 'name']);
    expect(r.originalsFound).toEqual([]);
    expect(JSON.stringify(r.repseudonymised)).not.toContain('Rui');
  });

  it('a document deleted here before pseudonymisation and touched there comes back pseudonymised', async () => {
    const { c, pa, doc } = await twoCopies();
    const { document: d2 } = await createDocument(pa, { name: 'Other', kind: 'text', text: 'Rui was here too.' });
    c.advance();
    const rui = await Library.create(createMemoryPlatform(), { passphrase: 'pass word', recoveryPhrase: newRecoveryPhrase() }, { params: FAST_KDF, now: c.now });
    const pr = await importProjectFile(rui, await exportProjectFile(pa, { includePseudonyms: false }), { kind: 'none' }, { asCopyOfSameProject: true });
    await pr.setMe((await pr.addCoder('Rui')).id);
    c.advance();
    await deleteDocuments(pa, [d2.id]);
    c.advance();
    await createPseudonym(pa, { original: 'Rui', replacement: '[P2]' });
    await apply(pa);
    c.advance();
    await renameDocument(pr, d2.id, 'Other (checked)');
    c.advance();
    const r = await mergeTeammateCopy(pa, await copyOf(pr));
    expect((await pa.store.get('document', d2.id))!.deleted).toBe(false);
    expect(await textOf(pa, d2.id)).toBe('[P2] was here too.');
    expect((await pa.store.get('doctext', d2.id))!.deleted).toBe(false);
    expect(await textOf(pa, doc.id)).not.toContain('Rui');
    // Apply reached the trash too, so the text came back pseudonymised with nothing left to redo.
    expect(r.repseudonymised.some((h) => h.kind === 'text' && h.id === d2.id)).toBe(false);
    expect(JSON.stringify(r.repseudonymised)).not.toContain('Rui');
  });
});

describe('newer work wins over a delete', () => {
  it('codings made here after the teammate deleted their code keep the code, on both sides', async () => {
    const { c, pa, pr, doc } = await twoCopies();
    const { code: plan } = await createCode(pa, { name: 'Planning' });
    c.advance();
    const rui = await Library.create(createMemoryPlatform(), { passphrase: 'pass word', recoveryPhrase: newRecoveryPhrase() }, { params: FAST_KDF, now: c.now });
    const pr2 = await importProjectFile(rui, await exportProjectFile(pa, { includePseudonyms: false }), { kind: 'none' }, { asCopyOfSameProject: true });
    await pr2.setMe((await pr2.addCoder('Rui')).id);
    void pr;
    c.advance();
    await deleteCode(pr2, plan.id, { withChildren: 'delete' });
    c.advance();
    const s = TEXT.indexOf('Trust came');
    const { coding: mine } = await applyCode(pa, { documentId: doc.id, start: s, end: s + 16, codeId: plan.id });
    c.advance();
    const r = await mergeTeammateCopy(pa, await copyOf(pr2));
    expect(r.revived).toEqual([{ kind: 'code', id: plan.id, name: 'Planning' }]);
    expect(r.removedCodings).toBe(0);
    expect((await pa.store.get('code', plan.id))!.deleted).toBe(false);
    expect((await pa.store.get('coding', mine.id))!.deleted).toBe(false);
    c.advance();
    // Rui merging Ana's copy gets the code back with her coding: both sides alike.
    await mergeTeammateCopy(pr2, await copyOf(pa));
    expect((await pr2.store.get('code', plan.id))!.deleted).toBe(false);
    expect((await pr2.store.get('coding', mine.id))!.deleted).toBe(false);
  });

  it('a teammate coding with a code deleted here before they saw the delete brings it back too', async () => {
    const { c, pa, pr, doc, code } = await twoCopies();
    await deleteCode(pa, code.id, { withChildren: 'delete' });
    c.advance();
    const s = TEXT.indexOf('Porto');
    const { coding: theirs } = await applyCode(pr, { documentId: doc.id, start: s, end: s + 5, codeId: code.id });
    c.advance();
    const pv = await previewMerge(pa, await copyOf(pr));
    expect(pv.textConflicts).toEqual([]);
    const r = await mergeTeammateCopy(pa, await copyOf(pr));
    expect(r.revived.map((x) => x.id)).toEqual([code.id]);
    expect((await pa.store.get('coding', theirs.id))!.deleted).toBe(false);
    await coherent(pa);
  });
});

describe('a merge cut short is finished when the project opens again', () => {
  it('a lock between writing the records and putting them in step', async () => {
    const { c, ana, platform, pa, pr, doc, code } = await twoCopies();
    await editDocumentText(pa, doc.id, TEXT.replace('Porto', 'Porto city'));
    c.advance();
    const s = TEXT.indexOf('Trust came later');
    await applyCode(pr, { documentId: doc.id, start: s, end: s + 16, codeId: code.id });
    c.advance();
    const bundle = await copyOf(pr);
    const merge = pa.store.merge.bind(pa.store);
    (pa.store as unknown as { merge: typeof merge }).merge = async (r) => {
      const n = await merge(r);
      await ana.lock();
      return n;
    };
    await expect(mergeTeammateCopy(pa, bundle)).rejects.toBeTruthy();
    const again = await Library.unlock(platform, 'passphrase', 'pass word', { params: FAST_KDF, now: c.now });
    const p2 = await again.openProject(pa.id);
    expect(await p2.store.getMeta(MERGE_PENDING)).toBeNull();
    await coherent(p2);
    expect((await allCodings(p2)).some((x) => x.text === 'Trust came later')).toBe(true);
    const logs = await p2.store.list('log', { where: "json_extract(data, '$.action') = 'project.merge'" });
    expect(logs.map((l) => l.summary).join()).toContain('(interrupted)');
  });
});

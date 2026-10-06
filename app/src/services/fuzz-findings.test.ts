// Regression tests for what fuzzing the data layer found (fuzz.merge.test.ts): each is the
// smallest sequence that broke an invariant, with the fix in reconcile.ts, undo.ts or a restore.
import { describe, expect, it } from 'vitest';
import { newRecoveryPhrase } from '../core/crypto/keyring';
import { readTramaZip } from '../core/export/trama';
import { createMemoryPlatform } from '../platform/memory';
import { createCode, deleteCode, moveCode, restoreCodes, updateCode } from './codes';
import { applyCode, removeCoding, setComment } from './codings';
import { exportProjectFile, importProjectFile, mergeTeammateCopy } from './datafile';
import { createDocument, deleteDocuments, editDocumentText, renameDocument, restoreDocuments } from './documents';
import { Library } from './library';
import { createMemo, deleteMemo, restoreMemos } from './memos';
import type { Project } from './project';
import { allCodings } from './queries';
import { FAST_KDF, makeTestProject } from './testing';
import { UndoManager } from './undo';

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
  const at = TEXT.indexOf('Trust');
  const { coding } = await applyCode(pa, { documentId: doc.id, start: at, end: at + 5, codeId: code.id });
  c.advance();
  const pr = await importProjectFile(await mk(), await exportProjectFile(pa, { includePseudonyms: false }), { kind: 'none' }, { asCopyOfSameProject: true });
  await pr.setMe((await pr.addCoder('Rui')).id);
  c.advance();
  return { c, pa, pr, doc, code, coding };
}

const copyOf = async (p: Project) => readTramaZip(await exportProjectFile(p, { includePseudonyms: false }));
const textOf = async (p: Project, id: string) => (await p.store.get('doctext', id))!.text;
const liveIds = async (p: Project, kind: 'coding' | 'memo' | 'code') => (await p.store.list(kind)).map((r) => r.id).sort();

/** Every live coding sits on its words, on a live, codable code of a live document. */
async function coherent(p: Project) {
  for (const c of await p.store.list('coding')) {
    expect(c.text, `coding ${c.id}`).toBe((await textOf(p, c.document_id)).slice(c.start, c.end));
    const code = (await p.store.get('code', c.code_id))!;
    expect(code.deleted || !code.codable, `code of ${c.id}`).toBe(false);
    expect((await p.store.get('document', c.document_id))!.deleted).toBe(false);
  }
  for (const m of await p.store.list('memo')) {
    if (m.target.kind !== 'project') expect((await p.store.get(m.target.kind, m.target.id))?.deleted, `memo ${m.title}`).toBe(false);
  }
}

describe('merging leaves no reference to something deleted or changed on the other side', () => {
  it('a memo written on a coding the teammate removed goes to the trash with that coding, and back with it', async () => {
    const { c, pa, pr, coding } = await twoCopies();
    const { batch } = await removeCoding(pa, [coding.id]).then(async (r) => ({ ...r, batch: (await pa.store.get('coding', coding.id) as { deleted_batch?: string }).deleted_batch! }));
    c.advance();
    const { memo } = await createMemo(pr, { title: 'Why trust', body: 'Later.', target: { kind: 'coding', id: coding.id } });
    c.advance();
    await mergeTeammateCopy(pr, await copyOf(pa));
    expect((await pr.store.get('memo', memo.id))!.deleted).toBe(true);
    await coherent(pr);
    // Ana's merge agrees; restoring her delete brings the coding back with Rui's memo.
    await mergeTeammateCopy(pa, await copyOf(pr));
    await coherent(pa);
    expect((await pa.store.get('memo', memo.id) as { deleted_batch?: string }).deleted_batch).toBe(batch);
  });

  it('a memo about a code the teammate deleted is not left about a deleted code', async () => {
    const { c, pa, pr, code } = await twoCopies();
    await deleteCode(pa, code.id, { withChildren: 'delete' });
    c.advance();
    await createMemo(pr, { title: 'On trust', body: '', target: { kind: 'code', id: code.id } });
    // The memo is newer work than the delete, but a memo alone does not bring a code back.
    c.advance();
    await mergeTeammateCopy(pa, await copyOf(pr));
    await coherent(pa);
    expect(await liveIds(pa, 'memo')).toEqual([]);
  });

  it('a code made a category on one side while the other coded with it stays codable', async () => {
    const { c, pa, pr, doc } = await twoCopies();
    const { code } = await createCode(pa, { name: 'Place' });
    c.advance();
    const pr2 = pr;
    await mergeTeammateCopy(pr2, await copyOf(pa));
    c.advance();
    const at = TEXT.indexOf('Porto');
    await applyCode(pa, { documentId: doc.id, start: at, end: at + 5, codeId: code.id });
    c.advance();
    await updateCode(pr, code.id, { codable: false });
    c.advance();
    await mergeTeammateCopy(pa, await copyOf(pr));
    expect((await pa.store.get('code', code.id))!.codable).toBe(true);
    await coherent(pa);
    await mergeTeammateCopy(pr, await copyOf(pa));
    expect((await pr.store.get('code', code.id))!.codable).toBe(true);
    await coherent(pr);
  });

  it('codes moved under each other on both sides do not form a cycle', async () => {
    const { c, pa, pr } = await twoCopies();
    const { code: x } = await createCode(pa, { name: 'X' });
    const { code: y } = await createCode(pa, { name: 'Y' });
    c.advance();
    await mergeTeammateCopy(pr, await copyOf(pa));
    c.advance();
    await moveCode(pa, x.id, y.id, null);
    c.advance();
    await moveCode(pr, y.id, x.id, null);
    c.advance();
    await mergeTeammateCopy(pa, await copyOf(pr));
    const parents = new Map((await pa.store.list('code')).map((k) => [k.id, k.parent_id]));
    // X sorts first: it moves to the top, where the codebook already showed it.
    expect([parents.get(x.id), parents.get(y.id)]).toEqual([null, x.id]);
    c.advance();
    await mergeTeammateCopy(pr, await copyOf(pa));
    expect((await pr.store.get('code', x.id))!.parent_id).toBeNull();
    expect((await pr.store.get('code', y.id))!.parent_id).toBe(x.id);
  });

  it('a code the teammate deleted but renamed here keeps its codings on both sides alike', async () => {
    const { c, pa, pr, code, coding } = await twoCopies();
    await deleteCode(pr, code.id, { withChildren: 'lift' });
    c.advance();
    await updateCode(pa, code.id, { name: 'Trust (renamed)' });
    c.advance();
    await mergeTeammateCopy(pa, await copyOf(pr));
    expect((await pa.store.get('code', code.id))!.deleted).toBe(false);
    expect(await liveIds(pa, 'coding')).toEqual([coding.id]);
    c.advance();
    await mergeTeammateCopy(pr, await copyOf(pa));
    expect(await liveIds(pr, 'coding')).toEqual([coding.id]);
    await coherent(pa);
    await coherent(pr);
  });

  it('a document the teammate deleted but edited here keeps its codings on both sides alike', async () => {
    const { c, pa, pr, doc, coding } = await twoCopies();
    await deleteDocuments(pr, [doc.id]);
    c.advance();
    await editDocumentText(pa, doc.id, `${TEXT}\nAna: That is all.`);
    c.advance();
    await mergeTeammateCopy(pa, await copyOf(pr));
    expect((await pa.store.get('document', doc.id))!.deleted).toBe(false);
    expect(await liveIds(pa, 'coding')).toEqual([coding.id]);
    c.advance();
    await mergeTeammateCopy(pr, await copyOf(pa));
    expect(await liveIds(pr, 'coding')).toEqual([coding.id]);
    expect(await textOf(pr, doc.id)).toBe(await textOf(pa, doc.id));
    await coherent(pa);
    await coherent(pr);
  });
});

describe('restoring from the trash brings nothing back without what it belongs to', () => {
  it('a document deleted on both sides: restoring one delete leaves its codings in the trash with the other', async () => {
    const { c, pa, pr, doc, coding } = await twoCopies();
    const mine = await deleteDocuments(pr, [doc.id]);
    c.advance();
    await deleteDocuments(pa, [doc.id]);
    c.advance();
    // Ana's delete is newer: the document is now in her delete; the coding stays in Rui's.
    await mergeTeammateCopy(pr, await copyOf(pa));
    const r = await restoreDocuments(pr, mine.batch);
    expect(r).toMatchObject({ documents: 0, codings: 0 });
    expect((await pr.store.get('coding', coding.id))!.deleted).toBe(true);
    await coherent(pr);
  });

  it('a memo restored after what it is about was deleted goes back to the trash', async () => {
    const ctx = await makeTestProject();
    const { document: d } = await createDocument(ctx, { name: 'Interview 1', kind: 'text', text: TEXT });
    const { memo } = await createMemo(ctx, { title: 'Note', body: '', target: { kind: 'document', id: d.id } });
    const { batch } = await deleteMemo(ctx, memo.id);
    await deleteDocuments(ctx, [d.id]);
    expect(await restoreMemos(ctx, batch)).toBe(0);
    expect((await ctx.store.get('memo', memo.id))!.deleted).toBe(true);
  });

  it('codings restored with their code go back to the trash when their document was deleted since', async () => {
    const ctx = await makeTestProject();
    const { document: d } = await createDocument(ctx, { name: 'Interview 1', kind: 'text', text: TEXT });
    const { code } = await createCode(ctx, { name: 'Trust' });
    const at = TEXT.indexOf('Trust');
    const { coding } = await applyCode(ctx, { documentId: d.id, start: at, end: at + 5, codeId: code.id });
    const { batch } = await deleteCode(ctx, code.id, { withChildren: 'delete' });
    await deleteDocuments(ctx, [d.id]);
    expect(await restoreCodes(ctx, batch)).toMatchObject({ codes: 1, codings: 0 });
    expect((await ctx.store.get('coding', coding.id))!.deleted).toBe(true);
  });
});

describe('undo and redo after a merge', () => {
  it('undoing a text edit moves a teammate\'s coding merged in since along with the text', async () => {
    const { c, pa, pr, doc, code } = await twoCopies();
    const m = new UndoManager();
    m.record((await editDocumentText(pa, doc.id, TEXT.replace('Ana: I started', 'Ana: Well, I started'))).undo);
    c.advance();
    await mergeTeammateCopy(pr, await copyOf(pa));
    c.advance();
    const at = (await textOf(pr, doc.id)).indexOf('Porto');
    const { coding } = await applyCode(pr, { documentId: doc.id, start: at, end: at + 5, codeId: code.id });
    c.advance();
    await mergeTeammateCopy(pa, await copyOf(pr));
    await m.undo();
    expect(await textOf(pa, doc.id)).toBe(TEXT);
    const got = (await pa.store.get('coding', coding.id))!;
    expect(TEXT.slice(got.start, got.end)).toBe('Porto');
    await coherent(pa);
    await m.redo();
    await coherent(pa);
  });

  it('undoing a text edit that would leave a teammate\'s coding without its words is refused, writing nothing', async () => {
    const { c, pa, pr, doc, code } = await twoCopies();
    const m = new UndoManager();
    m.record((await editDocumentText(pa, doc.id, TEXT.replace('Porto', 'Porto and Braga'))).undo);
    c.advance();
    await mergeTeammateCopy(pr, await copyOf(pa));
    c.advance();
    const at = (await textOf(pr, doc.id)).indexOf('Braga');
    await applyCode(pr, { documentId: doc.id, start: at, end: at + 5, codeId: code.id });
    c.advance();
    await mergeTeammateCopy(pa, await copyOf(pr));
    const before = await textOf(pa, doc.id);
    await expect(m.undo()).rejects.toMatchObject({ code: 'changed_since' });
    expect(await textOf(pa, doc.id)).toBe(before);
    await coherent(pa);
  });

  it('undoing a coding removal after a merge changed the text puts it back on its words', async () => {
    const { c, pa, pr, doc, coding } = await twoCopies();
    const m = new UndoManager();
    m.record((await removeCoding(pa, [coding.id])).undo);
    c.advance();
    await editDocumentText(pr, doc.id, TEXT.replace('Ana: I started', 'Ana: Well, I started'));
    c.advance();
    await mergeTeammateCopy(pa, await copyOf(pr));
    await m.undo();
    const got = (await pa.store.get('coding', coding.id))!;
    expect(got.deleted).toBe(false);
    expect(got.text).toBe('Trust');
    await coherent(pa);
  });

  it('undo never makes a code a category while codings use it, nor moves codes into a cycle', async () => {
    const ctx = await makeTestProject();
    const m = new UndoManager();
    const { document: d } = await createDocument(ctx, { name: 'Interview 1', kind: 'text', text: TEXT });
    const { code: theme } = await createCode(ctx, { name: 'Theme', codable: false });
    const u = await updateCode(ctx, theme.id, { codable: true });
    const at = TEXT.indexOf('Trust');
    const { coding } = await applyCode(ctx, { documentId: d.id, start: at, end: at + 5, codeId: theme.id });
    // The coding's own step is not on the stack (another window, a dropped step).
    m.record(u.undo);
    await expect(m.undo()).rejects.toMatchObject({ code: 'changed_since' });
    expect((await ctx.store.get('code', theme.id))!.codable).toBe(true);
    expect((await ctx.store.get('coding', coding.id))!.deleted).toBe(false);

    const { code: x } = await createCode(ctx, { name: 'X' });
    const { code: y } = await createCode(ctx, { name: 'Y', parent_id: x.id });
    const moved = await moveCode(ctx, y.id, null, null);
    await moveCode(ctx, x.id, y.id, null);
    m.record(moved.undo);
    await expect(m.undo()).rejects.toMatchObject({ code: 'changed_since' });
    expect((await ctx.store.get('code', y.id))!.parent_id).toBeNull();
  });
});

describe('copies that merge each other end alike', () => {
  it('what one side brings back from its trash during the second merge reaches the other with its next', async () => {
    // Rui deletes a code, which takes his coding with it; Ana keeps working with the code. Ana's
    // merge brings the code back for her work, but Rui's coding only exists in his trash (a copy
    // never carries a deleted record's content): his merge of her copy brings it back, and Ana
    // has it with her next merge.
    const { c, pa, pr, doc, code } = await twoCopies();
    const at = TEXT.indexOf('Porto');
    const { coding: his } = await applyCode(pr, { documentId: doc.id, start: at, end: at + 5, codeId: code.id });
    c.advance();
    await deleteCode(pr, code.id, { withChildren: 'delete' });
    c.advance();
    const s2 = TEXT.indexOf('came');
    await applyCode(pa, { documentId: doc.id, start: s2, end: s2 + 4, codeId: code.id });
    c.advance();
    await mergeTeammateCopy(pa, await copyOf(pr));
    c.advance();
    await mergeTeammateCopy(pr, await copyOf(pa));
    expect((await pr.store.get('coding', his.id))!.deleted).toBe(false);
    c.advance();
    await mergeTeammateCopy(pa, await copyOf(pr));
    expect(await liveIds(pa, 'coding')).toEqual(await liveIds(pr, 'coding'));
    expect((await allCodings(pa)).map((x) => x.text).sort()).toEqual(['Porto', 'Trust', 'came']);
  });
});

describe('moving codings along with a text edit is not newer work', () => {
  // A text edit rewrites the codings of the document (their offsets) and the document (its
  // length). Those writes follow the text; they must not count as newer than what the teammate
  // did to the same records meanwhile.
  it('a coding removed here stays removed after merging a teammate\'s edit that moved it', async () => {
    const { c, pa, pr, doc, coding } = await twoCopies();
    await removeCoding(pa, [coding.id]);
    c.advance();
    await editDocumentText(pr, doc.id, TEXT.replace('Ana: I started', 'Ana: Well, I started'));
    c.advance();
    await mergeTeammateCopy(pa, await copyOf(pr));
    expect((await pa.store.get('coding', coding.id))!.deleted).toBe(true);
    c.advance();
    await mergeTeammateCopy(pr, await copyOf(pa));
    expect((await pr.store.get('coding', coding.id))!.deleted).toBe(true);
  });

  it('a code deleted here does not come back because a teammate\'s edit moved its codings', async () => {
    const { c, pa, pr, doc, code } = await twoCopies();
    await deleteCode(pa, code.id, { withChildren: 'delete' });
    c.advance();
    await editDocumentText(pr, doc.id, TEXT.replace('Ana: I started', 'Ana: Well, I started'));
    c.advance();
    const r = await mergeTeammateCopy(pa, await copyOf(pr));
    expect(r.revived).toEqual([]);
    expect((await pa.store.get('code', code.id))!.deleted).toBe(true);
    expect(await liveIds(pa, 'coding')).toEqual([]);
  });

  it('a comment written on one side survives the other side\'s edit that moved the coding', async () => {
    const { c, pa, pr, doc, coding } = await twoCopies();
    await setComment(pr, coding.id, 'after the move');
    c.advance();
    await editDocumentText(pa, doc.id, TEXT.replace('Ana: I started', 'Ana: Well, I started'));
    c.advance();
    await mergeTeammateCopy(pa, await copyOf(pr));
    const got = (await pa.store.get('coding', coding.id))!;
    expect(got.comment).toBe('after the move');
    expect(got.text).toBe('Trust');
    c.advance();
    await mergeTeammateCopy(pr, await copyOf(pa));
    expect((await pr.store.get('coding', coding.id))!).toMatchObject({ comment: 'after the move', text: 'Trust', start: got.start });
  });

  it('a document renamed on one side keeps its name after the other side\'s edit of its text', async () => {
    const { c, pa, pr, doc } = await twoCopies();
    await renameDocument(pr, doc.id, 'Interview with Ana');
    c.advance();
    await editDocumentText(pa, doc.id, `${TEXT}\nAna: That is all.`);
    c.advance();
    await mergeTeammateCopy(pa, await copyOf(pr));
    expect((await pa.store.get('document', doc.id))!).toMatchObject({ name: 'Interview with Ana', chars: TEXT.length + 18 });
    c.advance();
    await mergeTeammateCopy(pr, await copyOf(pa));
    expect((await pr.store.get('document', doc.id))!).toMatchObject({ name: 'Interview with Ana', chars: TEXT.length + 18 });
  });

  it('a coding brought back here stays back after a teammate\'s edit that moved it in the trash', async () => {
    const { c, pa, pr, doc, coding } = await twoCopies();
    const m = new UndoManager();
    m.record((await removeCoding(pa, [coding.id])).undo);
    c.advance();
    await mergeTeammateCopy(pr, await copyOf(pa));
    c.advance();
    await m.undo();
    c.advance();
    // Rui's edit moves the coding he has in the trash.
    await editDocumentText(pr, doc.id, TEXT.replace('Ana: I started', 'Ana: Well, I started'));
    c.advance();
    await mergeTeammateCopy(pa, await copyOf(pr));
    expect((await pa.store.get('coding', coding.id))!).toMatchObject({ deleted: false, text: 'Trust' });
    c.advance();
    await mergeTeammateCopy(pr, await copyOf(pa));
    expect((await pr.store.get('coding', coding.id))!).toMatchObject({ deleted: false, text: 'Trust' });
    await coherent(pa);
    await coherent(pr);
  });
});

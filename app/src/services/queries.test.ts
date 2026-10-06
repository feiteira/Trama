import { describe, expect, it } from 'vitest';
import { createCase } from './cases';
import { createCode, deleteCode } from './codes';
import { applyCode } from './codings';
import { createDocument, deleteDocuments, reorderDocument } from './documents';
import { addToGroup, createGroup } from './groups';
import { createMemo } from './memos';
import { allCodings, codingsForCodes, listCoders, listCodesWithCounts, listDocuments, projectSummary, recentActivity } from './queries';
import { makeTestProject } from './testing';

async function setup() {
  const ctx = await makeTestProject();
  const { case: c } = await createCase(ctx, { name: 'P01' });
  const d1 = (await createDocument(ctx, { name: 'Entrevista 1', kind: 'text', text: 'Alpha beta gamma. Delta epsilon.', case_id: c.id })).document;
  const d2 = (await createDocument(ctx, { name: 'Entrevista 2', kind: 'text', text: 'Zeta eta theta.' })).document;
  const { group } = await createGroup(ctx, { name: 'Onda 1' });
  await addToGroup(ctx, group.id, [d1.id]);
  const emotions = (await createCode(ctx, { name: 'Emoções' })).code;
  const fear = (await createCode(ctx, { name: 'Medo', parent_id: emotions.id })).code;
  const joy = (await createCode(ctx, { name: 'Alegria', parent_id: emotions.id })).code;
  const lone = (await createCode(ctx, { name: 'Solo' })).code;
  await applyCode(ctx, { documentId: d1.id, start: 0, end: 5, codeId: fear.id });
  await applyCode(ctx, { documentId: d1.id, start: 18, end: 23, codeId: fear.id });
  await applyCode(ctx, { documentId: d2.id, start: 0, end: 4, codeId: joy.id });
  await applyCode(ctx, { documentId: d2.id, start: 5, end: 8, codeId: emotions.id });
  return { ctx, d1, d2, emotions, fear, joy, lone, c, group };
}

describe('queries', () => {
  it('lists documents with counts, case and group names', async () => {
    const { ctx, d1, d2 } = await setup();
    await reorderDocument(ctx, d2.id, d1.id);
    const rows = await listDocuments(ctx);
    expect(rows.map((r) => [r.document.name, r.codings, r.caseName, r.groupNames])).toEqual([
      ['Entrevista 2', 2, null, []],
      ['Entrevista 1', 2, 'P01', ['Onda 1']],
    ]);
  });

  it('lists codes in tree order with own and aggregate counts', async () => {
    const { ctx } = await setup();
    const rows = await listCodesWithCounts(ctx);
    expect(rows.map((r) => [r.code.name, r.depth, r.own, r.total, r.documents, r.documentsTotal, r.childCount])).toEqual([
      ['Emoções', 0, 1, 4, 1, 2, 2],
      ['Medo', 1, 2, 2, 1, 1, 0],
      ['Alegria', 1, 1, 1, 1, 1, 0],
      ['Solo', 0, 0, 0, 0, 0, 0],
    ]);
  });

  it('retrieves codings of codes, optionally with children, in document order', async () => {
    const { ctx, emotions, fear } = await setup();
    expect((await codingsForCodes(ctx, [emotions.id])).map((c) => c.text)).toEqual(['eta']);
    expect((await codingsForCodes(ctx, [emotions.id], { includeChildren: true })).map((c) => c.text)).toEqual(['Alpha', 'Delta', 'Zeta', 'eta']);
    expect((await codingsForCodes(ctx, [fear.id])).length).toBe(2);
    expect(await codingsForCodes(ctx, [])).toEqual([]);
    expect((await allCodings(ctx)).length).toBe(4);
  });

  it('leaves out codings of deleted documents and codes', async () => {
    const { ctx, d2, fear } = await setup();
    await deleteDocuments(ctx, [d2.id]);
    await deleteCode(ctx, fear.id, { withChildren: 'delete' });
    expect(await allCodings(ctx)).toEqual([]);
    // A coding pointing to a code that is gone (as after merging a copy) is skipped too.
    const { document } = await createDocument(ctx, { name: 'X', kind: 'text', text: 'hello' });
    await ctx.store.put('coding', { document_id: document.id, code_id: 'ghost', coder_id: ctx.me.id, start: 0, end: 5, text: 'hello', comment: '' });
    expect(await allCodings(ctx)).toEqual([]);
  });

  it('lists coders, me first, with counts', async () => {
    const { ctx, d1, lone } = await setup();
    const other = await ctx.store.put('coder', { name: 'Beatriz', color: '#e4572e' });
    const me = ctx.me;
    ctx.actAs(other);
    await applyCode(ctx, { documentId: d1.id, start: 0, end: 5, codeId: lone.id });
    ctx.actAs(me);
    const rows = await listCoders(ctx);
    expect(rows.map((r) => [r.coder.name, r.codings, r.isMe])).toEqual([
      ['Ana', 4, true],
      ['Beatriz', 1, false],
    ]);
  });

  it('summarises the project and recent activity', async () => {
    const { ctx } = await setup();
    await createMemo(ctx, { title: 'Ideias', target: { kind: 'project', id: null } });
    const s = await projectSummary(ctx);
    expect(s).toMatchObject({ documents: 2, codes: 4, codings: 4, codedDocuments: 2, memos: 1, cases: 1, groups: 1, coders: 1, pseudonyms: 0, attributes: 0 });
    expect(s.chars).toBe('Alpha beta gamma. Delta epsilon.'.length + 'Zeta eta theta.'.length);
    expect(s.lastActivity).not.toBeNull();
    const recent = await recentActivity(ctx, 3);
    expect(recent.length).toBe(3);
    expect(recent[0]!.action).toBe('memo.create');
  });

  it('works on an empty project', async () => {
    const ctx = await makeTestProject();
    expect(await listDocuments(ctx)).toEqual([]);
    expect(await listCodesWithCounts(ctx)).toEqual([]);
    expect((await projectSummary(ctx)).lastActivity).toBeNull();
  });
});

describe('counts agree with retrieval when codings outlive their document or code', () => {
  it('leaves orphaned codings (as a merge into an older project can leave them) out of every count', async () => {
    const { ctx, d1, d2, fear, joy } = await setup();
    // Orphans written directly, as an older merge left them: the parents deleted, the codings live.
    const orphanInDoc = (await ctx.store.list('coding', { where: 'document_id = ?', params: [d2.id] }))[0]!;
    await ctx.store.remove('document', [d2.id]);
    await ctx.store.remove('code', [fear.id]);
    expect(orphanInDoc.deleted).toBe(false);
    const live = await allCodings(ctx);
    const summary = await projectSummary(ctx);
    expect(summary.codings).toBe(live.length);
    expect(summary.codedDocuments).toBe(new Set(live.map((c) => c.document_id)).size);
    const docs = await listDocuments(ctx);
    expect(docs.find((r) => r.document.id === d1.id)!.codings).toBe(live.filter((c) => c.document_id === d1.id).length);
    const joyRow = (await listCodesWithCounts(ctx)).find((r) => r.code.id === joy.id)!;
    expect(joyRow).toMatchObject({ own: 0, documents: 0 });
  });
});

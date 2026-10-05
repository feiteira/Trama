import { describe, expect, it } from 'vitest';
import { PALETTE } from '../core/model/types';
import { codeUsage, createCode, deleteCode, mergeCodes, moveCode, restoreCodes, setShortcut, splitCode, updateCode } from './codes';
import { applyCode, setComment } from './codings';
import { createDocument } from './documents';
import { createMemo } from './memos';
import { listLog } from './log';
import { makeTestProject } from './testing';

const TEXT = 'Ana trusts her neighbours. She fears the winter. She loves the river.';

async function setup() {
  const ctx = await makeTestProject();
  const { document: doc } = await createDocument(ctx, { name: 'Interview 1', kind: 'text', text: TEXT });
  return { ctx, doc };
}

const span = (word: string) => ({ start: TEXT.indexOf(word), end: TEXT.indexOf(word) + word.length });

describe('createCode / updateCode', () => {
  it('creates codes in order with cycling colours and trimmed names', async () => {
    const { ctx } = await setup();
    const a = await createCode(ctx, { name: '  Trust \n issues ' });
    const b = await createCode(ctx, { name: 'Fear' });
    expect(a.code.name).toBe('Trust issues');
    expect(a.code.color).toBe(PALETTE[0]);
    expect(b.code.color).toBe(PALETTE[1]);
    expect(b.code.order).toBeGreaterThan(a.code.order);
    const c = await createCode(ctx, { name: 'First', beforeId: a.code.id });
    expect(c.code.order).toBeLessThan(a.code.order);
    await expect(createCode(ctx, { name: ' ' })).rejects.toMatchObject({ code: 'invalid_argument' });
    await expect(createCode(ctx, { name: 'x', parent_id: 'nope' })).rejects.toMatchObject({ code: 'not_found' });
    expect((await listLog(ctx, { action: 'code.create' })).length).toBe(3);
  });

  it('logs a rename apart from an edit and undoes both', async () => {
    const { ctx } = await setup();
    const { code } = await createCode(ctx, { name: 'Trust' });
    const r = await updateCode(ctx, code.id, { name: 'Confiança', description: 'Relações de confiança' });
    expect(r.code.name).toBe('Confiança');
    const logs = await listLog(ctx, { action: ['code.rename', 'code.edit'] });
    expect(logs.map((l) => l.action).sort()).toEqual(['code.edit', 'code.rename']);
    expect(logs.find((l) => l.action === 'code.rename')!.summary).toBe('"Trust" → "Confiança"');
    // Further definition edits soon after are not logged again.
    await updateCode(ctx, code.id, { description: 'Relações de confiança mútua' });
    expect((await listLog(ctx, { action: 'code.edit' })).length).toBe(1);
    await r.undo.undo();
    const back = (await ctx.store.get('code', code.id))!;
    expect(back.name).toBe('Trust');
    expect(back.description).toBe('');
    expect((await updateCode(ctx, code.id, { name: 'Trust' })).undo.detail).toBe('"Trust"');
  });
});

describe('moveCode', () => {
  it('moves under a parent and refuses cycles', async () => {
    const { ctx } = await setup();
    const parent = (await createCode(ctx, { name: 'Emotions' })).code;
    const child = (await createCode(ctx, { name: 'Fear' })).code;
    const r = await moveCode(ctx, child.id, parent.id, null);
    expect(r.code.parent_id).toBe(parent.id);
    expect((await listLog(ctx, { action: 'code.move' }))[0]!.summary).toBe('"Fear" → "Emotions"');
    await expect(moveCode(ctx, parent.id, child.id, null)).rejects.toMatchObject({ code: 'cycle' });
    await expect(moveCode(ctx, parent.id, parent.id, null)).rejects.toMatchObject({ code: 'cycle' });
    await r.undo.undo();
    expect((await ctx.store.get('code', child.id))!.parent_id).toBeNull();
  });

  it('reorders among siblings', async () => {
    const { ctx } = await setup();
    const ids = [];
    for (const n of ['A', 'B', 'C']) ids.push((await createCode(ctx, { name: n })).code.id);
    await moveCode(ctx, ids[2]!, null, ids[0]!);
    const names = (await ctx.store.list('code', { order: 'sort' })).map((c) => c.name);
    expect(names).toEqual(['C', 'A', 'B']);
  });
});

describe('setShortcut', () => {
  it('keeps shortcuts unique', async () => {
    const { ctx } = await setup();
    const a = (await createCode(ctx, { name: 'A' })).code;
    const b = (await createCode(ctx, { name: 'B' })).code;
    await setShortcut(ctx, a.id, 3);
    const r = await setShortcut(ctx, b.id, 3);
    expect((await ctx.store.get('code', a.id))!.shortcut).toBeNull();
    expect((await ctx.store.get('code', b.id))!.shortcut).toBe(3);
    await r.undo.undo();
    expect((await ctx.store.get('code', a.id))!.shortcut).toBe(3);
    await expect(setShortcut(ctx, a.id, 10)).rejects.toMatchObject({ code: 'invalid_argument' });
    await setShortcut(ctx, a.id, null);
    expect((await ctx.store.get('code', a.id))!.shortcut).toBeNull();
  });
});

describe('deleteCode', () => {
  async function tree() {
    const s = await setup();
    const top = (await createCode(s.ctx, { name: 'Top' })).code;
    const emotions = (await createCode(s.ctx, { name: 'Emotions' })).code;
    const fear = (await createCode(s.ctx, { name: 'Fear', parent_id: emotions.id })).code;
    const love = (await createCode(s.ctx, { name: 'Love', parent_id: emotions.id })).code;
    const after = (await createCode(s.ctx, { name: 'After' })).code;
    await applyCode(s.ctx, { documentId: s.doc.id, ...span('fears the winter'), codeId: fear.id });
    await applyCode(s.ctx, { documentId: s.doc.id, ...span('loves the river'), codeId: love.id });
    const { coding } = await applyCode(s.ctx, { documentId: s.doc.id, ...span('She'), codeId: emotions.id });
    await createMemo(s.ctx, { title: 'On emotions', target: { kind: 'code', id: emotions.id } });
    await createMemo(s.ctx, { title: 'On segment', target: { kind: 'coding', id: coding.id } });
    return { ...s, top, emotions, fear, love, after };
  }

  it("with children 'delete': codes, codings and memos go in one batch", async () => {
    const { ctx, emotions, fear } = await tree();
    const r = await deleteCode(ctx, emotions.id, { withChildren: 'delete' });
    expect([r.codes, r.codings, r.memos]).toEqual([3, 3, 2]);
    expect(await ctx.store.count('code')).toBe(2);
    expect(await ctx.store.count('coding')).toBe(0);
    expect(await ctx.store.count('memo')).toBe(0);
    expect((await listLog(ctx, { action: 'code.delete' }))[0]!.summary).toContain('×3');
    const restored = await restoreCodes(ctx, r.batch);
    expect(restored).toEqual({ codes: 3, codings: 3 });
    expect((await ctx.store.get('code', fear.id))!.parent_id).toBe(emotions.id);
    expect(await ctx.store.count('memo')).toBe(2);
  });

  it("with children 'lift': children take the deleted code's place", async () => {
    const { ctx, emotions, fear, love } = await tree();
    const r = await deleteCode(ctx, emotions.id, { withChildren: 'lift' });
    expect(r.codes).toBe(1);
    expect(r.codings).toBe(1);
    const order = (await ctx.store.list('code', { order: 'sort' })).map((c) => `${c.name}:${c.parent_id ?? '-'}`);
    expect(order).toEqual(['Top:-', 'Fear:-', 'Love:-', 'After:-']);
    expect(await ctx.store.count('coding')).toBe(2);
    await r.undo.undo();
    expect((await ctx.store.get('code', fear.id))!.parent_id).toBe(emotions.id);
    expect((await ctx.store.get('code', love.id))!.parent_id).toBe(emotions.id);
    expect(await ctx.store.count('coding')).toBe(3);
    await r.undo.redo();
    expect(await ctx.store.count('code')).toBe(4);
  });
});

describe('mergeCodes', () => {
  it('moves codings, drops exact duplicates, reparents children and fills the definition', async () => {
    const { ctx, doc } = await setup();
    const target = (await createCode(ctx, { name: 'Trust' })).code;
    const source = (await createCode(ctx, { name: 'Confidence', description: 'Feeling safe with others' })).code;
    const sub = (await createCode(ctx, { name: 'Neighbours', parent_id: source.id })).code;
    await setShortcut(ctx, source.id, 4);
    // Same span by the same coder under both codes: a duplicate after the merge.
    const t1 = await applyCode(ctx, { documentId: doc.id, ...span('trusts her neighbours'), codeId: target.id });
    const s1 = await applyCode(ctx, { documentId: doc.id, ...span('trusts her neighbours'), codeId: source.id });
    await setComment(ctx, s1.coding.id, 'strong statement');
    await createMemo(ctx, { title: 'dup memo', target: { kind: 'coding', id: s1.coding.id } });
    const s2 = await applyCode(ctx, { documentId: doc.id, ...span('loves the river'), codeId: source.id });
    // Another coder's identical span is not a duplicate.
    const other = await ctx.store.put('coder', { name: 'Rui', color: '#29a37a' });
    const me = ctx.me;
    ctx.actAs(other);
    const o1 = await applyCode(ctx, { documentId: doc.id, ...span('trusts her neighbours'), codeId: source.id });
    ctx.actAs(me);
    await createMemo(ctx, { title: 'code memo', target: { kind: 'code', id: source.id } });

    const r = await mergeCodes(ctx, [source.id, target.id], target.id);
    expect(r.moved).toBe(2);
    expect(r.duplicatesRemoved).toBe(1);
    expect(r.childrenMoved).toBe(1);
    expect((await ctx.store.get('code', source.id))!.deleted).toBe(true);
    const t = (await ctx.store.get('code', target.id))!;
    expect(t.description).toBe('Feeling safe with others');
    expect(t.shortcut).toBe(4);
    expect((await ctx.store.get('code', sub.id))!.parent_id).toBe(target.id);
    expect((await ctx.store.get('coding', s2.coding.id))!.code_id).toBe(target.id);
    expect((await ctx.store.get('coding', o1.coding.id))!.code_id).toBe(target.id);
    expect((await ctx.store.get('coding', s1.coding.id))!.deleted).toBe(true);
    expect((await ctx.store.get('coding', t1.coding.id))!.comment).toBe('strong statement');
    const memos = await ctx.store.list('memo');
    expect(memos.find((m) => m.title === 'dup memo')!.target).toEqual({ kind: 'coding', id: t1.coding.id });
    expect(memos.find((m) => m.title === 'code memo')!.target).toEqual({ kind: 'code', id: target.id });
    expect((await listLog(ctx, { action: 'code.merge' }))[0]!.summary).toBe('"Confidence" → "Trust" ×2');

    await r.undo.undo();
    expect((await ctx.store.get('code', source.id))!.deleted).toBe(false);
    expect((await ctx.store.get('coding', s1.coding.id))!.code_id).toBe(source.id);
    expect((await ctx.store.get('coding', s1.coding.id))!.deleted).toBe(false);
    expect((await ctx.store.get('coding', t1.coding.id))!.comment).toBe('');
    expect((await ctx.store.get('code', sub.id))!.parent_id).toBe(source.id);
    expect((await ctx.store.get('code', target.id))!.description).toBe('');
    await r.undo.redo();
    expect((await ctx.store.get('code', source.id))!.deleted).toBe(true);
    expect(await ctx.store.count('coding', 'code_id = ?', [target.id])).toBe(3);
  });

  it('merges a parent into its own child without a cycle', async () => {
    const { ctx } = await setup();
    const root = (await createCode(ctx, { name: 'Root' })).code;
    const parent = (await createCode(ctx, { name: 'Parent', parent_id: root.id })).code;
    const child = (await createCode(ctx, { name: 'Child', parent_id: parent.id })).code;
    const sibling = (await createCode(ctx, { name: 'Sibling', parent_id: parent.id })).code;
    await mergeCodes(ctx, [parent.id], child.id);
    expect((await ctx.store.get('code', child.id))!.parent_id).toBe(root.id);
    expect((await ctx.store.get('code', sibling.id))!.parent_id).toBe(child.id);
  });

  it('refuses an empty merge', async () => {
    const { ctx } = await setup();
    const a = (await createCode(ctx, { name: 'A' })).code;
    await expect(mergeCodes(ctx, [a.id], a.id)).rejects.toMatchObject({ code: 'invalid_argument' });
    await expect(mergeCodes(ctx, ['nope'], a.id)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('splitCode and codeUsage', () => {
  it('moves chosen codings into a new child code', async () => {
    const { ctx, doc } = await setup();
    const code = (await createCode(ctx, { name: 'Feelings' })).code;
    const a = await applyCode(ctx, { documentId: doc.id, ...span('fears the winter'), codeId: code.id });
    await applyCode(ctx, { documentId: doc.id, ...span('loves the river'), codeId: code.id });
    const r = await splitCode(ctx, code.id, { newName: 'Fear', codingIds: [a.coding.id] });
    expect(r.code.parent_id).toBe(code.id);
    expect(r.moved).toBe(1);
    expect((await ctx.store.get('coding', a.coding.id))!.code_id).toBe(r.code.id);
    const usage = await codeUsage(ctx);
    expect(usage.get(code.id)).toEqual({ codings: 1, documents: 1 });
    expect(usage.get(r.code.id)).toEqual({ codings: 1, documents: 1 });
    expect((await listLog(ctx, { action: 'code.split' }))[0]!.summary).toBe('"Feelings" → "Fear" ×1');
    await r.undo.undo();
    expect((await ctx.store.get('coding', a.coding.id))!.code_id).toBe(code.id);
    expect((await ctx.store.get('code', r.code.id))!.deleted).toBe(true);
    const other = (await createCode(ctx, { name: 'Other' })).code;
    const b = await applyCode(ctx, { documentId: doc.id, ...span('Ana'), codeId: other.id });
    await expect(splitCode(ctx, code.id, { newName: 'X', codingIds: [b.coding.id] })).rejects.toMatchObject({ code: 'invalid_argument' });
  });
});

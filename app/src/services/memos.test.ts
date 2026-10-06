import { describe, expect, it } from 'vitest';
import { createCode } from './codes';
import { createDocument } from './documents';
import { listLog } from './log';
import { allMemos, createMemo, deleteMemo, memosFor, restoreMemos, updateMemo } from './memos';
import { makeTestProject } from './testing';

describe('memos', () => {
  it('creates memos about targets and lists them', async () => {
    const ctx = await makeTestProject();
    const { document } = await createDocument(ctx, { name: 'D', kind: 'text', text: 'x' });
    const { code } = await createCode(ctx, { name: 'C' });
    const p = await createMemo(ctx, { title: '  Ideias   gerais ', body: '**Notas** 😀', target: { kind: 'project', id: null } });
    const d = await createMemo(ctx, { title: 'Sobre D', target: { kind: 'document', id: document.id } });
    await createMemo(ctx, { title: 'Sobre C', target: { kind: 'code', id: code.id } });
    expect(p.memo.title).toBe('Ideias gerais');
    expect(p.memo.coder_id).toBe(ctx.me.id);
    expect((await memosFor(ctx, { kind: 'project', id: null })).map((m) => m.id)).toEqual([p.memo.id]);
    expect((await memosFor(ctx, { kind: 'document', id: document.id })).map((m) => m.id)).toEqual([d.memo.id]);
    expect((await allMemos(ctx)).map((m) => m.title)).toEqual(['Sobre C', 'Sobre D', 'Ideias gerais']);
    expect((await listLog(ctx, { action: 'memo.create' })).map((l) => l.summary)).toContain('"Ideias gerais"');
    await expect(createMemo(ctx, { target: { kind: 'case', id: 'nope' } })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('updates, logging typing sessions once, and sorts by last update', async () => {
    const ctx = await makeTestProject();
    const a = await createMemo(ctx, { title: 'A', target: { kind: 'project', id: null } });
    await createMemo(ctx, { title: 'B', target: { kind: 'project', id: null } });
    const r = await updateMemo(ctx, a.memo.id, { body: 'first draft' });
    const r2 = await updateMemo(ctx, a.memo.id, { body: 'second draft' });
    expect((await listLog(ctx, { action: 'memo.edit' })).length).toBe(1);
    expect((await allMemos(ctx))[0]!.id).toBe(a.memo.id);
    const same = await updateMemo(ctx, a.memo.id, { body: 'second draft' });
    expect(same.undo.weight).toBe(0);
    await r2.undo.undo();
    await r.undo.undo();
    expect((await ctx.store.get('memo', a.memo.id))!.body).toBe('');
  });

  it('deletes and restores, never logging the body', async () => {
    const ctx = await makeTestProject();
    const a = await createMemo(ctx, { title: '', body: 'Ana Lima said something private', target: { kind: 'project', id: null } });
    const r = await deleteMemo(ctx, a.memo.id);
    expect(await ctx.store.count('memo')).toBe(0);
    expect(await restoreMemos(ctx, r.batch)).toBe(1);
    expect(await ctx.store.count('memo')).toBe(1);
    // Restored off the undo stack: the delete's undo/redo must not write over that.
    await expect(r.undo.undo()).rejects.toMatchObject({ code: 'changed_since' });
    expect(await ctx.store.count('memo')).toBe(1);
    const all = await listLog(ctx);
    expect(all.some((l) => l.summary.includes('Ana Lima'))).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createCode, updateCode } from './codes';
import { createDocument } from './documents';
import { listLog } from './log';
import { makeTestProject } from './testing';
import { chunks, combineUndo, commit, draftOf, listIn, noopUndo, Plan, recordsInBatch, restoreBatch, UndoManager, type Undoable } from './undo';

function counter(label = 'code.edit' as const) {
  const state = { value: 0 };
  const make = (delta: number, weight = 1): Undoable => ({
    label,
    detail: `+${delta}`,
    weight,
    async undo() {
      state.value -= delta;
    },
    async redo() {
      state.value += delta;
    },
  });
  return { state, make };
}

describe('UndoManager', () => {
  it('undoes and redoes in order, and a new record clears redo', async () => {
    const m = new UndoManager();
    const { state, make } = counter();
    expect(m.canUndo).toBe(false);
    expect(await m.undo()).toBeNull();
    for (const d of [1, 2, 3]) {
      state.value += d;
      m.record(make(d));
    }
    expect(m.labels.undo).toEqual({ label: 'code.edit', detail: '+3' });
    await m.undo();
    await m.undo();
    expect(state.value).toBe(1);
    expect(m.canRedo).toBe(true);
    await m.redo();
    expect(state.value).toBe(3);
    state.value += 10;
    m.record(make(10));
    expect(m.canRedo).toBe(false);
    expect(await m.redo()).toBeNull();
  });

  it('keeps at most 100 entries and caps memory', async () => {
    const m = new UndoManager();
    const { make } = counter();
    for (let i = 0; i < 150; i++) m.record(make(1));
    let n = 0;
    while (await m.undo()) n++;
    expect(n).toBe(100);
    const small = new UndoManager({ maxWeight: 10 });
    for (let i = 0; i < 5; i++) small.record(make(1, 4));
    let k = 0;
    while (await small.undo()) k++;
    expect(k).toBe(2);
  });

  it('runs operations one at a time and notifies subscribers', async () => {
    const m = new UndoManager();
    const order: string[] = [];
    const slow = (name: string): Undoable => ({
      label: 'code.edit',
      detail: name,
      weight: 1,
      undo: () => new Promise((r) => setTimeout(() => (order.push(`undo ${name}`), r()), name === 'a' ? 5 : 20)),
      redo: async () => void order.push(`redo ${name}`),
    });
    m.record(slow('a'));
    m.record(slow('b'));
    const listener = vi.fn();
    const off = m.subscribe(listener);
    await Promise.all([m.undo(), m.undo(), m.redo()]);
    expect(order).toEqual(['undo b', 'undo a', 'redo a']);
    expect(listener).toHaveBeenCalledTimes(3);
    off();
    m.clear();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(m.canUndo || m.canRedo).toBe(false);
  });

  it('drops an entry whose undo fails, and keeps working', async () => {
    const m = new UndoManager();
    const { state, make } = counter();
    m.record(make(1));
    m.record({ ...make(2), undo: async () => Promise.reject(new Error('disk full')) });
    await expect(m.undo()).rejects.toThrow('disk full');
    expect(m.canRedo).toBe(false);
    state.value = 1;
    await m.undo();
    expect(state.value).toBe(0);
  });

  it('combines undoables, undoing newest first', async () => {
    const seen: string[] = [];
    const part = (n: string): Undoable => ({ label: 'code.edit', detail: n, weight: 2, undo: async () => void seen.push(`u${n}`), redo: async () => void seen.push(`r${n}`) });
    const c = combineUndo('code.merge', 'x', [part('1'), part('2')]);
    expect(c.weight).toBe(4);
    await c.undo();
    await c.redo();
    expect(seen).toEqual(['u2', 'u1', 'r1', 'r2']);
    await noopUndo('code.edit').undo();
  });
});

describe('Plan and commit', () => {
  it('merges changes to one record and lets a remove cancel a pending create', async () => {
    const ctx = await makeTestProject();
    const { code } = await createCode(ctx, { name: 'A' });
    const plan = new Plan();
    plan.change('code', code, { name: 'B' });
    plan.change('code', code, { color: '#000000' });
    expect(plan.view('code', code)).toMatchObject({ name: 'B', color: '#000000' });
    const tmp = plan.create('code', { ...draftOf(code), id: undefined, name: 'temp' });
    plan.remove('code', { ...code, id: tmp });
    expect(plan.count('code', 'written')).toBe(1);
    expect(plan.count('code', 'removed')).toBe(0);
    const { saved, undo } = await commit(ctx, plan, { label: 'code.edit', detail: '', logs: [{ action: 'code.edit', summary: 'x' }] });
    expect(saved.get('code', code.id).name).toBe('B');
    expect(saved.find('code', tmp)).toBeUndefined();
    expect(() => saved.get('code', tmp)).toThrow();
    await undo.undo();
    expect((await ctx.store.get('code', code.id))!.name).toBe('A');
    const log = await listLog(ctx, { action: 'code.edit' });
    expect(log.map((l) => l.summary)).toEqual(['↶ x', 'x']);
    await undo.redo();
    expect((await ctx.store.get('code', code.id))!.color).toBe('#000000');
    expect((await listLog(ctx, { limit: 1 }))[0]!.summary).toBe('↷ x');
  });

  it('refuses to change a record being deleted', async () => {
    const ctx = await makeTestProject();
    const { code } = await createCode(ctx, { name: 'A' });
    const plan = new Plan();
    plan.remove('code', code);
    expect(() => plan.change('code', code, { name: 'B' })).toThrow();
    expect(plan.isRemoved('code', code.id)).toBe(true);
  });

  it('writes nothing when validation fails', async () => {
    const ctx = await makeTestProject();
    const { code } = await createCode(ctx, { name: 'A' });
    const plan = new Plan();
    plan.change('code', code, { name: 'B' });
    plan.change('code', code, { color: 'not a colour' });
    await expect(commit(ctx, plan, { label: 'code.edit', detail: '', logs: [] })).rejects.toThrow();
    expect((await ctx.store.get('code', code.id))!.name).toBe('A');
  });

  it('logs inverse actions on undo', async () => {
    const ctx = await makeTestProject();
    const { undo } = await createCode(ctx, { name: 'Ω' });
    await undo.undo();
    expect((await listLog(ctx, { action: 'code.delete' }))[0]!.summary).toBe('↶ "Ω"');
  });

  it('finds and restores records by delete batch', async () => {
    const ctx = await makeTestProject();
    const a = (await createCode(ctx, { name: 'A' })).code;
    const b = (await createCode(ctx, { name: 'B' })).code;
    const plan = new Plan();
    plan.remove('code', a);
    plan.remove('code', b);
    const { batch } = await commit(ctx, plan, { label: 'code.delete', detail: '', logs: [] });
    expect((await recordsInBatch(ctx.store, 'code', batch)).map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
    expect(await recordsInBatch(ctx.store, 'code', 'other')).toEqual([]);
    const restored = await restoreBatch(ctx, batch, ['code', 'coding']);
    expect(restored.get('code')!.length).toBe(2);
    expect(restored.has('coding')).toBe(false);
    await updateCode(ctx, a.id, { name: 'A2' });
  });
});

describe('helpers', () => {
  it('chunks lists and queries large IN lists', async () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([])).toEqual([]);
    const ctx = await makeTestProject();
    const { document } = await createDocument(ctx, { name: 'D', kind: 'text', text: '' });
    const ids = [document.id, ...Array.from({ length: 1500 }, (_, i) => `missing-${i}`)];
    expect((await listIn(ctx.store, 'document', 'id', ids)).length).toBe(1);
    await expect(listIn(ctx.store, 'document', 'nope', ['x'])).rejects.toThrow();
  });
});

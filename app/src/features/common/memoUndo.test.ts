import { describe, expect, it } from 'vitest';
import { createMemo, updateMemo } from '../../services/memos';
import { UndoManager } from '../../services/undo';
import { MemoSaveUndo } from './memoUndo';
import { makeTestProject } from '../../services/testing';

describe('MemoSaveUndo', () => {
  it('undo then redo of "create memo" keeps the text typed afterwards', async () => {
    const ctx = await makeTestProject();
    const m = new UndoManager();
    const saves = new MemoSaveUndo(m);
    const detach = saves.attach();
    const { memo, undo } = await createMemo(ctx, { target: { kind: 'project', id: null } });
    m.record(undo);
    // Autosaves while typing (what MemoEditor.save does).
    saves.saved(memo.id, (await updateMemo(ctx, memo.id, { title: 'Emerging theme', body: 'Twenty' })).undo);
    saves.saved(memo.id, (await updateMemo(ctx, memo.id, { body: 'Twenty minutes of careful writing.' })).undo);
    // One entry for the run of typing, on top of the creation.
    expect(m.labels.undo?.label).toBe('memo.edit');
    await m.undo(); // the typing
    expect((await ctx.store.get('memo', memo.id))?.body).toBe('');
    await m.undo(); // the creation
    expect((await ctx.store.get('memo', memo.id))?.deleted).toBe(true);
    expect(m.canUndo).toBe(false);
    await m.redo();
    await m.redo();
    const back = await ctx.store.get('memo', memo.id);
    expect(back?.deleted).toBe(false);
    expect(back?.title).toBe('Emerging theme');
    expect(back?.body).toBe('Twenty minutes of careful writing.');
    detach();
  });

  it('starts a new entry once anything else touched the stack (undoing a colour change keeps later text)', async () => {
    const ctx = await makeTestProject();
    const m = new UndoManager();
    const saves = new MemoSaveUndo(m);
    saves.attach();
    const { memo, undo } = await createMemo(ctx, { target: { kind: 'project', id: null } });
    m.record(undo);
    saves.saved(memo.id, (await updateMemo(ctx, memo.id, { body: 'first' })).undo);
    m.record((await updateMemo(ctx, memo.id, { color: '#ff0000' })).undo);
    saves.saved(memo.id, (await updateMemo(ctx, memo.id, { body: 'first and second' })).undo);
    await m.undo(); // the later typing
    expect((await ctx.store.get('memo', memo.id))?.body).toBe('first');
    await m.undo(); // the colour
    const r = await ctx.store.get('memo', memo.id);
    expect(r?.color).toBeNull();
    expect(r?.body).toBe('first');
    await m.redo();
    await m.redo();
    expect((await ctx.store.get('memo', memo.id))?.body).toBe('first and second');
  });

  it('ignores saves that changed nothing', async () => {
    const ctx = await makeTestProject();
    const m = new UndoManager();
    const saves = new MemoSaveUndo(m);
    saves.attach();
    const { memo } = await createMemo(ctx, { target: { kind: 'project', id: null } });
    saves.saved(memo.id, (await updateMemo(ctx, memo.id, { body: '' })).undo);
    expect(m.canUndo).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { PALETTE } from '../core/model/types';
import { addCoder, nextCoderColor, recolourCoder, renameCoder } from './coders';
import { listLog } from './log';
import { makeTestProject } from './testing';

describe('coders', () => {
  it('adds a coder with a free palette colour, logs it and undoes it', async () => {
    const ctx = await makeTestProject();
    // "Ana" has #3a6ea5, which is not in the palette: the first palette colour is free.
    const { coder, undo } = await addCoder(ctx, { name: '  Rui   Lopes ' });
    expect(coder).toMatchObject({ name: 'Rui Lopes', color: PALETTE[0] });
    const [entry] = await listLog(ctx, { action: 'coder.add' });
    expect(entry).toMatchObject({ summary: '"Rui Lopes"', target_kind: 'coder', target_id: coder.id });
    expect(undo.label).toBe('coder.add');
    await undo.undo();
    expect(await ctx.store.get('coder', coder.id)).toMatchObject({ deleted: true });
    await undo.redo();
    expect(await ctx.store.get('coder', coder.id)).toMatchObject({ deleted: false, name: 'Rui Lopes' });
  });

  it('refuses empty and duplicate names, and bad colours', async () => {
    const ctx = await makeTestProject();
    await expect(addCoder(ctx, { name: '  ' })).rejects.toMatchObject({ code: 'invalid_argument' });
    await expect(addCoder(ctx, { name: 'ana' })).rejects.toMatchObject({ code: 'duplicate' });
    await expect(addCoder(ctx, { name: 'Rui', color: 'red' })).rejects.toMatchObject({ code: 'invalid_argument' });
    const { coder } = await addCoder(ctx, { name: 'Rui', color: '#B5179E' });
    expect(coder.color).toBe('#b5179e');
    await expect(renameCoder(ctx, coder.id, 'ANA')).rejects.toMatchObject({ code: 'duplicate' });
    await expect(renameCoder(ctx, 'nope', 'X')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('renames with an undoable, logged change; the same name changes nothing', async () => {
    const ctx = await makeTestProject();
    const { coder } = await addCoder(ctx, { name: 'Rui' });
    const same = await renameCoder(ctx, coder.id, ' Rui ');
    expect(same.undo.weight).toBe(0);
    const r = await renameCoder(ctx, coder.id, 'Rui Lopes');
    expect(r.coder.name).toBe('Rui Lopes');
    expect((await listLog(ctx, { action: 'coder.edit' }))[0]!.summary).toBe('"Rui" → "Rui Lopes"');
    await r.undo.undo();
    expect((await ctx.store.get('coder', coder.id))!.name).toBe('Rui');
  });

  it('keeps the cached "me" in step through a rename, its undo and its redo', async () => {
    const ctx = await makeTestProject();
    const r = await renameCoder(ctx, ctx.me.id, 'Ana Sousa');
    expect(ctx.me.name).toBe('Ana Sousa');
    await r.undo.undo();
    expect(ctx.me.name).toBe('Ana');
    await r.undo.redo();
    expect(ctx.me.name).toBe('Ana Sousa');
    await recolourCoder(ctx, ctx.me.id, PALETTE[4]!);
    expect(ctx.me.color).toBe(PALETTE[4]);
  });

  it('logs trying several colours once, but undoes each', async () => {
    const ctx = await makeTestProject();
    const { coder } = await addCoder(ctx, { name: 'Rui' });
    const a = await recolourCoder(ctx, coder.id, PALETTE[2]!);
    const b = await recolourCoder(ctx, coder.id, PALETTE[3]!);
    expect(b.coder.color).toBe(PALETTE[3]);
    expect(await listLog(ctx, { action: 'coder.edit' })).toHaveLength(1);
    await b.undo.undo();
    expect((await ctx.store.get('coder', coder.id))!.color).toBe(PALETTE[2]);
    await a.undo.undo();
    expect((await ctx.store.get('coder', coder.id))!.color).toBe(PALETTE[0]);
    expect((await recolourCoder(ctx, coder.id, PALETTE[0]!.toUpperCase())).undo.weight).toBe(0);
  });

  it('picks the next colour no coder has', () => {
    expect(nextCoderColor([])).toBe(PALETTE[0]);
    expect(nextCoderColor([{ color: PALETTE[0]! }, { color: PALETTE[2]! }])).toBe(PALETTE[1]);
    expect(nextCoderColor(PALETTE.map((color) => ({ color })))).toBe(PALETTE[PALETTE.length % PALETTE.length]);
  });
});

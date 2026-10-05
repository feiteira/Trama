import { describe, expect, it } from 'vitest';
import { LOG_COLUMNS, listLog, logAsRows, recentlyLogged } from './log';
import { makeTestProject } from './testing';

describe('listLog', () => {
  it('lists newest first, pages, and filters', async () => {
    let t = Date.parse('2026-01-01T10:00:00Z');
    const ctx = await makeTestProject({ now: () => new Date(t) });
    for (let i = 0; i < 5; i++) {
      t += 1000;
      await ctx.log(i % 2 ? 'code.create' : 'document.add', `"item ${i}"`, { kind: 'x', id: `id${i}` });
    }
    // Two entries in the same second still page correctly.
    await ctx.log('memo.create', '"same second"');
    const all = await listLog(ctx);
    expect(all.map((e) => e.summary)).toEqual(['"same second"', '"item 4"', '"item 3"', '"item 2"', '"item 1"', '"item 0"']);
    const page1 = await listLog(ctx, { limit: 2 });
    const page2 = await listLog(ctx, { limit: 2, before: page1[1] });
    const page3 = await listLog(ctx, { limit: 10, before: page2[1] });
    expect([...page1, ...page2, ...page3].map((e) => e.id)).toEqual(all.map((e) => e.id));
    expect((await listLog(ctx, { action: 'code.create' })).length).toBe(2);
    expect((await listLog(ctx, { action: ['code.create', 'memo.create'] })).length).toBe(3);
    expect((await listLog(ctx, { action: [] })).length).toBe(6);
    expect((await listLog(ctx, { targetId: 'id2' }))[0]!.summary).toBe('"item 2"');
    expect((await listLog(ctx, { coderId: ctx.me.id })).length).toBe(6);
    expect((await listLog(ctx, { coderId: 'other' })).length).toBe(0);
  });
});

describe('logAsRows', () => {
  it('exports oldest first with coder names and a header', async () => {
    const ctx = await makeTestProject();
    await ctx.log('document.add', '"Entrevista 1"', { kind: 'document', id: 'd1' });
    await ctx.log('export', 'qdpx');
    const entries = await listLog(ctx);
    const rows = logAsRows(entries, new Map([[ctx.me.id, 'Ana']]));
    expect(rows[0]).toEqual([...LOG_COLUMNS]);
    expect(rows[1]!.slice(1)).toEqual(['Ana', 'document.add', '"Entrevista 1"', 'document', 'd1']);
    expect(rows[2]!.slice(2)).toEqual(['export', 'qdpx', '', '']);
    expect(logAsRows(entries, new Map(), { header: false })[0]![1]).toBe(ctx.me.id);
    expect(logAsRows([], new Map())).toEqual([[...LOG_COLUMNS]]);
  });
});

describe('recentlyLogged', () => {
  it('is true only for the same action, target and coder just now', async () => {
    const ctx = await makeTestProject();
    expect(await recentlyLogged(ctx, 'memo.edit', 'm1')).toBe(false);
    await ctx.log('memo.edit', '"x"', { kind: 'memo', id: 'm1' });
    expect(await recentlyLogged(ctx, 'memo.edit', 'm1')).toBe(true);
    expect(await recentlyLogged(ctx, 'memo.edit', 'm2')).toBe(false);
    expect(await recentlyLogged(ctx, 'code.edit', 'm1')).toBe(false);
    expect(await recentlyLogged(ctx, 'memo.edit', 'm1', 0)).toBe(false);
  });
});

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

  it('bounds by time on both sides', async () => {
    let t = Date.parse('2026-01-01T10:00:00Z');
    const ctx = await makeTestProject({ now: () => new Date(t) });
    for (let i = 0; i < 4; i++) {
      t += 60_000;
      await ctx.log('memo.edit', `"m${i}"`);
    }
    const all = await listLog(ctx);
    // `after` with an empty stamp keeps the entry at that very second.
    const from = await listLog(ctx, { after: { at: all[2]!.at, updated_at_hlc: '' } });
    expect(from.map((e) => e.summary)).toEqual(['"m3"', '"m2"', '"m1"']);
    expect((await listLog(ctx, { after: all[2]! })).map((e) => e.summary)).toEqual(['"m3"', '"m2"']);
    const window = await listLog(ctx, { after: all[3]!, before: all[0]! });
    expect(window.map((e) => e.summary)).toEqual(['"m2"', '"m1"']);
  });

  it('filters by text without case or accents, filling each page with matches', async () => {
    let t = Date.parse('2026-01-01T10:00:00Z');
    const ctx = await makeTestProject({ now: () => new Date(t) });
    // Enough entries that the matches lie beyond the first rows read.
    for (let i = 0; i < 1200; i++) {
      t += 1000;
      const name = i % 400 === 7 ? `"Confiança ${i}"` : `"item ${i}"`;
      await ctx.log(i % 2 ? 'code.create' : 'code.rename', `${name} ×${i}`);
    }
    const hits = await listLog(ctx, { text: 'CONFIANCA' });
    expect(hits.map((e) => e.summary)).toEqual(['"Confiança 807" ×807', '"Confiança 407" ×407', '"Confiança 7" ×7']);
    expect(await listLog(ctx, { text: 'confiança', limit: 2 })).toHaveLength(2);
    expect(await listLog(ctx, { text: 'confiança', before: hits[1]! })).toHaveLength(1);
    // Every word must appear; the action counts as text too.
    expect(await listLog(ctx, { text: 'confianca rename' })).toHaveLength(0);
    expect(await listLog(ctx, { text: 'confianca create' })).toHaveLength(3);
    // Numbers are looked for by the database.
    expect((await listLog(ctx, { text: '×1199' }))[0]!.summary).toBe('"item 1199" ×1199');
    // With `describe`, the sentence the screen shows is searched too.
    const described = await listLog(ctx, { text: 'renomeou 807', describe: (e) => (e.action === 'code.rename' ? 'Mudou o nome… renomeou' : 'Criou') });
    expect(described).toHaveLength(0);
    const described2 = await listLog(ctx, { text: 'criou 807', describe: (e) => (e.action === 'code.rename' ? 'Renomeou' : 'Criou') });
    expect(described2.map((e) => e.summary)).toEqual(['"Confiança 807" ×807']);
    expect(await listLog(ctx, { text: '   ' })).toHaveLength(200);
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

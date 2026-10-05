import { describe, expect, it } from 'vitest';
import { dropEntries, type Entry, isRouteName, MAX_STEPS, popEntry, pushEntry, replaceTop, type Route, routeId, sameRoute } from './router';

const e = (key: number, route: Route): Entry => ({ key, route });
const names = (s: Entry[]) => s.map((x) => x.route.name);

describe('routes', () => {
  it('compares routes whatever their key order and unset or empty fields', () => {
    expect(sameRoute({ name: 'workbench', docId: 'd1', codeId: undefined }, { name: 'workbench', docId: 'd1' })).toBe(true);
    expect(sameRoute({ name: 'analysis', query: '' }, { name: 'analysis' })).toBe(true);
    expect(sameRoute({ name: 'segments', codeIds: [] }, { name: 'segments' })).toBe(true);
    expect(sameRoute({ docId: 'd1', name: 'workbench' } as Route, { name: 'workbench', docId: 'd1' })).toBe(true);
    expect(sameRoute({ name: 'workbench', select: { end: 9, start: 3 } }, { name: 'workbench', select: { start: 3, end: 9 } })).toBe(true);
    expect(sameRoute({ name: 'workbench', select: { start: 3, end: 9 } }, { name: 'workbench', select: { start: 3, end: 10 } })).toBe(false);
    expect(sameRoute({ name: 'codes', codeId: 'a' }, { name: 'codes', codeId: 'b' })).toBe(false);
  });

  it('keeps the order of a list of codes (it is meaningful)', () => {
    expect(sameRoute({ name: 'segments', codeIds: ['a', 'b'] }, { name: 'segments', codeIds: ['b', 'a'] })).toBe(false);
  });

  it('handles Unicode in queries', () => {
    const a: Route = { name: 'analysis', tool: 'search', query: 'coração 💬' };
    expect(routeId(a)).toContain('coração 💬');
    expect(sameRoute(a, { name: 'analysis', query: 'coração 💬', tool: 'search' })).toBe(true);
  });

  it('knows its route names', () => {
    expect(isRouteName('codes')).toBe(true);
    expect(isRouteName('Codes')).toBe(false);
    expect(isRouteName(null)).toBe(false);
    expect(isRouteName('')).toBe(false);
  });
});

describe('history', () => {
  it('skips a step to the place already showing', () => {
    const s = [e(0, { name: 'workbench' }), e(1, { name: 'codes', codeId: 'c' })];
    expect(pushEntry(s, { name: 'codes', codeId: 'c' }, 2)).toBe(s);
    expect(names(pushEntry(s, { name: 'codes' }, 2))).toEqual(['workbench', 'codes', 'codes']);
  });

  it(`keeps at most ${MAX_STEPS} steps, dropping the oldest`, () => {
    let s: Entry[] = [e(0, { name: 'workbench' })];
    for (let i = 1; i <= 200; i++) s = pushEntry(s, { name: 'memos', memoId: String(i) }, i);
    expect(s).toHaveLength(MAX_STEPS);
    expect(s[s.length - 1]!.route).toEqual({ name: 'memos', memoId: '200' });
    expect(s[0]!.route).toEqual({ name: 'memos', memoId: String(200 - MAX_STEPS + 1) });
  });

  it('replaces the current place in place, keeping its key', () => {
    const s = [e(0, { name: 'workbench' }), e(4, { name: 'analysis' })];
    const out = replaceTop(s, { name: 'analysis', tool: 'words' }, 9);
    expect(out).toEqual([e(0, { name: 'workbench' }), e(4, { name: 'analysis', tool: 'words' })]);
    expect(replaceTop(out, { name: 'analysis', tool: 'words' }, 10)).toBe(out);
    expect(replaceTop([], { name: 'log' }, 3)).toEqual([e(3, { name: 'log' })]);
  });

  it('goes back but never past the first place', () => {
    const s = [e(0, { name: 'workbench' }), e(1, { name: 'codes' })];
    expect(names(popEntry(s))).toEqual(['workbench']);
    const one = [e(0, { name: 'workbench' })];
    expect(popEntry(one)).toBe(one);
  });

  it('drops places that no longer exist and joins what becomes equal', () => {
    const s = [
      e(0, { name: 'workbench', docId: 'a' }),
      e(1, { name: 'memos', memoId: 'm' }),
      e(2, { name: 'workbench', docId: 'a' }),
      e(3, { name: 'memos', memoId: 'm' }),
      e(4, { name: 'codes' }),
    ];
    const out = dropEntries(s, (r) => r.name === 'memos' && r.memoId === 'm', e(9, { name: 'workbench' }));
    expect(names(out)).toEqual(['workbench', 'codes']);
    expect(out[0]!.key).toBe(2);
  });

  it('falls back when nothing is left', () => {
    const out = dropEntries([e(0, { name: 'memos', memoId: 'x' })], () => true, e(9, { name: 'workbench' }));
    expect(out).toEqual([e(9, { name: 'workbench' })]);
  });
});

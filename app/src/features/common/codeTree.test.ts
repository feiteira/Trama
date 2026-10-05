import { describe, expect, it } from 'vitest';
import {
  branchIds,
  codeChoices,
  dropZone,
  filterChoices,
  filterTree,
  parentsOf,
  pathsOf,
  resolveDrop,
  subtreeIds,
  treeKeyMove,
  typeAhead,
  visibleRows,
  type TreeItem,
} from './codeTree';

const item = (id: string, depth: number, name = id): TreeItem => ({ id, name, depth, color: '#3a6ea5', codable: true, shortcut: null, own: 1, total: 1, childCount: 0 });

// community
//   belonging
//   conflict
//     disputes
// wellbeing
//   stress
// place
const ITEMS: TreeItem[] = [
  item('community', 0, 'Community'),
  item('belonging', 1, 'Belonging'),
  item('conflict', 1, 'Conflict'),
  item('disputes', 2, 'Disputes over plots'),
  item('wellbeing', 0, 'Wellbeing'),
  item('stress', 1, 'Stress relief'),
  item('place', 0, 'Place'),
];

const ids = (rows: { item: { id: string } }[]) => rows.map((r) => r.item.id);

describe('structure', () => {
  it('derives parents and paths from the display order', () => {
    const p = parentsOf(ITEMS);
    expect(p.get('community')).toBeNull();
    expect(p.get('disputes')).toBe('conflict');
    expect(p.get('stress')).toBe('wellbeing');
    expect(pathsOf(ITEMS).get('disputes')).toEqual(['Community', 'Conflict', 'Disputes over plots']);
  });

  it('finds a branch and the codes that have children', () => {
    expect([...subtreeIds(ITEMS, 'community')]).toEqual(['community', 'belonging', 'conflict', 'disputes']);
    expect([...subtreeIds(ITEMS, 'place')]).toEqual(['place']);
    expect(branchIds(ITEMS)).toEqual(['community', 'conflict', 'wellbeing']);
  });
});

describe('visibleRows', () => {
  it('hides collapsed branches and numbers siblings', () => {
    const rows = visibleRows(ITEMS, new Set(['conflict', 'wellbeing']), null);
    expect(ids(rows)).toEqual(['community', 'belonging', 'conflict', 'wellbeing', 'place']);
    const conflict = rows.find((r) => r.item.id === 'conflict')!;
    expect(conflict).toMatchObject({ hasChildren: true, expanded: false, setSize: 2, posInSet: 2, parentId: 'community' });
    const place = rows.find((r) => r.item.id === 'place')!;
    expect(place).toMatchObject({ hasChildren: false, setSize: 3, posInSet: 3 });
  });

  it('collapsing a parent hides grandchildren too', () => {
    expect(ids(visibleRows(ITEMS, new Set(['community']), null))).toEqual(['community', 'wellbeing', 'stress', 'place']);
  });

  it('keeps the ancestors of matches while filtering, branches open', () => {
    const f = filterTree(ITEMS, 'disputes');
    expect(f).not.toBeNull();
    const rows = visibleRows(ITEMS, new Set(['community', 'conflict']), f);
    expect(ids(rows)).toEqual(['community', 'conflict', 'disputes']);
    expect(rows.map((r) => r.match)).toEqual([false, false, true]);
    expect(rows[0]!.expanded).toBe(true);
  });

  it('filters ignoring accents and case, word by word', () => {
    const items = [item('a', 0, 'Pertença'), item('b', 1, 'Conflito entre vizinhos')];
    expect([...filterTree(items, 'PERTENCA')!.matches]).toEqual(['a']);
    expect([...filterTree(items, 'vizinhos conflito')!.visible].sort()).toEqual(['a', 'b']);
    expect(filterTree(items, '   ')).toBeNull();
  });

  it('stays fast on a large codebook', () => {
    const many: TreeItem[] = [];
    for (let i = 0; i < 3000; i++) many.push(item(`c${i}`, i % 4, `Code ${i}`));
    const t0 = performance.now();
    for (let k = 0; k < 20; k++) visibleRows(many, new Set(), filterTree(many, `code ${k}`));
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('treeKeyMove', () => {
  const rows = visibleRows(ITEMS, new Set(['wellbeing']), null);
  const at = (id: string) => rows.findIndex((r) => r.item.id === id);

  it('moves up, down, home and end', () => {
    expect(treeKeyMove('ArrowDown', rows, 0)).toEqual({ kind: 'focus', index: 1 });
    expect(treeKeyMove('ArrowUp', rows, 0)).toEqual({ kind: 'focus', index: 0 });
    expect(treeKeyMove('End', rows, 0)).toEqual({ kind: 'focus', index: rows.length - 1 });
    expect(treeKeyMove('Home', rows, 3)).toEqual({ kind: 'focus', index: 0 });
    expect(treeKeyMove('ArrowDown', rows, -1)).toEqual({ kind: 'focus', index: 0 });
  });

  it('opens, enters, closes and climbs', () => {
    expect(treeKeyMove('ArrowRight', rows, at('wellbeing'))).toEqual({ kind: 'expand', id: 'wellbeing' });
    expect(treeKeyMove('ArrowRight', rows, at('community'))).toEqual({ kind: 'focus', index: at('belonging') });
    expect(treeKeyMove('ArrowRight', rows, at('belonging'))).toEqual({ kind: 'none' });
    expect(treeKeyMove('ArrowLeft', rows, at('community'))).toEqual({ kind: 'collapse', id: 'community' });
    expect(treeKeyMove('ArrowLeft', rows, at('disputes'))).toEqual({ kind: 'focus', index: at('conflict') });
    expect(treeKeyMove('ArrowLeft', rows, at('place'))).toEqual({ kind: 'none' });
  });
});

describe('typeAhead', () => {
  const rows = visibleRows(ITEMS, new Set(), null);
  it('finds the next row starting with the typed text, wrapping', () => {
    expect(rows[typeAhead(rows, 0, 'b')]!.item.id).toBe('belonging');
    expect(rows[typeAhead(rows, 0, 'p')]!.item.id).toBe('place');
    expect(rows[typeAhead(rows, 6, 'c')]!.item.id).toBe('community');
    expect(typeAhead(rows, 0, 'zz')).toBe(-1);
  });
  it('keeps the current row while a longer prefix still matches; a repeated letter cycles', () => {
    const c = rows.findIndex((r) => r.item.id === 'conflict');
    expect(typeAhead(rows, c, 'con')).toBe(c);
    expect(rows[typeAhead(rows, 0, 'cc')]!.item.id).toBe('conflict');
  });
});

describe('drag and drop', () => {
  const rows = visibleRows(ITEMS, new Set(), null);

  it('splits a row into before / inside / after', () => {
    expect(dropZone(2, 30)).toBe('before');
    expect(dropZone(15, 30)).toBe('inside');
    expect(dropZone(28, 30)).toBe('after');
  });

  it('refuses dropping a code into itself or its own branch', () => {
    expect(resolveDrop(rows, ITEMS, 'community', 'community', 'inside')).toEqual({ ok: false, reason: 'self' });
    expect(resolveDrop(rows, ITEMS, 'community', 'disputes', 'inside')).toEqual({ ok: false, reason: 'cycle' });
    expect(resolveDrop(rows, ITEMS, 'conflict', 'disputes', 'before')).toEqual({ ok: false, reason: 'cycle' });
  });

  it('computes parent and next sibling', () => {
    expect(resolveDrop(rows, ITEMS, 'place', 'stress', 'inside')).toEqual({ ok: true, parentId: 'stress', beforeId: null });
    expect(resolveDrop(rows, ITEMS, 'place', 'belonging', 'before')).toEqual({ ok: true, parentId: 'community', beforeId: 'belonging' });
    expect(resolveDrop(rows, ITEMS, 'stress', 'belonging', 'after')).toEqual({ ok: true, parentId: 'community', beforeId: 'conflict' });
    // Below an open branch: becomes its first child.
    expect(resolveDrop(rows, ITEMS, 'place', 'community', 'after')).toEqual({ ok: true, parentId: 'community', beforeId: 'belonging' });
    // Below a closed branch: its next sibling.
    const closed = visibleRows(ITEMS, new Set(['community']), null);
    expect(resolveDrop(closed, ITEMS, 'place', 'community', 'after')).toEqual({ ok: true, parentId: null, beforeId: 'wellbeing' });
    // After the last top-level code.
    expect(resolveDrop(rows, ITEMS, 'belonging', 'place', 'after')).toEqual({ ok: true, parentId: null, beforeId: null });
  });

  it('reports a drop that changes nothing', () => {
    expect(resolveDrop(rows, ITEMS, 'conflict', 'belonging', 'after')).toEqual({ ok: false, reason: 'noop' });
    expect(resolveDrop(rows, ITEMS, 'belonging', 'conflict', 'before')).toEqual({ ok: false, reason: 'noop' });
    expect(resolveDrop(rows, ITEMS, 'disputes', 'conflict', 'inside')).toEqual({ ok: false, reason: 'noop' });
  });
});

describe('codeChoices', () => {
  it('lists codes with paths, leaving out a branch when asked', () => {
    const all = codeChoices(ITEMS);
    expect(all.find((c) => c.id === 'disputes')!.path).toBe('Community › Conflict › Disputes over plots');
    const parents = codeChoices(ITEMS, ['conflict'], { excludeBranches: true });
    expect(parents.map((c) => c.id)).toEqual(['community', 'belonging', 'wellbeing', 'stress', 'place']);
    expect(filterChoices(all, 'comm disp').map((c) => c.id)).toEqual(['disputes']);
  });
});

describe('matchRanges', () => {
  it('maps folded matches back to the name', async () => {
    const { matchRanges } = await import('./codeTree');
    expect(matchRanges('Pertença à comunidade', 'pertenca')).toEqual([[0, 8]]);
    expect(matchRanges('Conflict over plots', 'plot con')).toEqual([[0, 3], [14, 18]]);
    expect(matchRanges('Anything', '')).toEqual([]);
  });
});

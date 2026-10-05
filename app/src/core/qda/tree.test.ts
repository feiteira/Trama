import { describe, expect, it } from 'vitest';
import { buildTree, orderAfterLast, placeBefore, type TreeCode } from './tree';

const c = (id: string, parent_id: string | null, order: number, name = id): TreeCode => ({ id, parent_id, order, name });

describe('buildTree', () => {
  const codes = [
    c('emotions', null, 2, 'Emotions'),
    c('trust', null, 1, 'Trust'),
    c('joy', 'emotions', 2, 'Joy'),
    c('anger', 'emotions', 2, 'Anger'),
    c('rage', 'anger', 1, 'Rage'),
    c('fear', 'emotions', 1, 'Fear'),
  ];
  const tree = buildTree(codes);

  it('orders by order, then name', () => {
    expect(tree.flatten().map((f) => `${'-'.repeat(f.depth)}${f.code.id}`)).toEqual([
      'trust', 'emotions', '-fear', '-anger', '--rage', '-joy',
    ]);
    expect(tree.childrenOf(null).map((x) => x.id)).toEqual(['trust', 'emotions']);
    expect(tree.childrenOf('emotions').map((x) => x.id)).toEqual(['fear', 'anger', 'joy']);
    expect(tree.childrenOf('missing')).toEqual([]);
  });

  it('answers descendants, ancestors and paths', () => {
    expect(tree.descendants('emotions').map((x) => x.id)).toEqual(['fear', 'anger', 'rage', 'joy']);
    expect(tree.descendants('rage')).toEqual([]);
    expect(tree.descendants('nope')).toEqual([]);
    expect(tree.ancestors('rage').map((x) => x.id)).toEqual(['anger', 'emotions']);
    expect(tree.path('rage')).toEqual(['Emotions', 'Anger', 'Rage']);
    expect(tree.path('nope')).toEqual([]);
  });

  it('detects moves that would create cycles', () => {
    expect(tree.wouldCycle('emotions', 'rage')).toBe(true);
    expect(tree.wouldCycle('emotions', 'emotions')).toBe(true);
    expect(tree.wouldCycle('rage', 'trust')).toBe(false);
    expect(tree.wouldCycle('emotions', null)).toBe(false);
    expect(tree.wouldCycle('anger', 'joy')).toBe(false);
  });

  it('aggregates counts and sets up the tree', () => {
    const agg = tree.aggregate(new Map([['rage', 3], ['anger', 2], ['joy', 1], ['ghost', 10]]));
    expect(agg.get('emotions')).toEqual({ own: 0, total: 6 });
    expect(agg.get('anger')).toEqual({ own: 2, total: 5 });
    expect(agg.get('trust')).toEqual({ own: 0, total: 0 });
    expect(agg.has('ghost')).toBe(false);
    const docs = tree.aggregateSets(new Map([['rage', new Set(['d1', 'd2'])], ['joy', new Set(['d2', 'd3'])]]));
    expect([...docs.get('emotions')!].sort()).toEqual(['d1', 'd2', 'd3']);
  });

  it('puts orphans at the root', () => {
    const t = buildTree([c('a', 'deleted-parent', 1), c('b', null, 2)]);
    expect(t.flatten().map((f) => [f.code.id, f.depth])).toEqual([['a', 0], ['b', 0]]);
    expect(t.ancestors('a')).toEqual([]);
  });

  it('breaks cycles from merged copies instead of losing codes', () => {
    const t = buildTree([c('x', 'y', 1, 'X'), c('y', 'x', 2, 'Y'), c('z', 'y', 1, 'Z'), c('self', 'self', 3)]);
    const flat = t.flatten();
    expect(flat.map((f) => f.code.id).sort()).toEqual(['self', 'x', 'y', 'z']);
    expect(flat.find((f) => f.code.id === 'x')!.depth).toBe(0);
    expect(t.path('z')).toEqual(['X', 'Y', 'Z']);
  });

  it('handles empty input, Unicode names and deep hierarchies', () => {
    expect(buildTree([]).flatten()).toEqual([]);
    const u = buildTree([c('1', null, 1, 'Émotions'), c('2', null, 1, 'emoções'), c('3', null, 1, 'Ámbito')]);
    expect(u.flatten().map((f) => f.code.name)).toEqual(['Ámbito', 'emoções', 'Émotions']);
    const deep = Array.from({ length: 20_000 }, (_, i) => c(`n${i}`, i ? `n${i - 1}` : null, 1));
    const d = buildTree(deep);
    expect(d.flatten()[19_999]!.depth).toBe(19_999);
    expect(d.aggregate(new Map([['n19999', 1]])).get('n0')!.total).toBe(1);
  });

  it('sorts numbered names naturally', () => {
    const t = buildTree([c('a', null, 1, 'Theme 10'), c('b', null, 1, 'Theme 2')]);
    expect(t.flatten().map((f) => f.code.name)).toEqual(['Theme 2', 'Theme 10']);
  });
});

describe('placeBefore', () => {
  const sibs = [{ id: 'a', order: 1 }, { id: 'b', order: 2 }, { id: 'c', order: 3 }];

  it('places between neighbours', () => {
    expect(placeBefore(sibs, 'c', 'b')).toEqual({ order: 1.5, renumber: null });
    expect(placeBefore(sibs, 'c', 'a')).toEqual({ order: 0, renumber: null });
    expect(placeBefore(sibs, 'a', null)).toEqual({ order: 4, renumber: null });
    expect(placeBefore(sibs, 'new', 'missing')).toEqual({ order: 4, renumber: null });
    expect(placeBefore([], 'x', null)).toEqual({ order: 1, renumber: null });
  });

  it('renumbers when there is no room', () => {
    const same = [{ id: 'a', order: 1 }, { id: 'b', order: 1 }];
    const r = placeBefore(same, 'x', 'b');
    expect(r.renumber).not.toBeNull();
    expect([...r.renumber!.entries()]).toEqual([['a', 1], ['x', 2], ['b', 3]]);
    // Many halvings in the same gap eventually run out of precision.
    let list = [{ id: 'a', order: 1 }, { id: 'b', order: 2 }];
    let renumbered = false;
    for (let i = 0; i < 80; i++) {
      const p = placeBefore(list, `n${i}`, 'b');
      if (p.renumber) {
        renumbered = true;
        list = [...p.renumber.entries()].map(([id, order]) => ({ id, order }));
      } else list = [...list, { id: `n${i}`, order: p.order }];
    }
    expect(renumbered).toBe(true);
    const orders = list.map((x) => x.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('orderAfterLast', () => {
    expect(orderAfterLast([])).toBe(1);
    expect(orderAfterLast([{ order: 2.5 }, { order: 1 }])).toBe(3);
  });
});

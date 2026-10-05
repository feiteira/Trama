import { describe, expect, it } from 'vitest';
import { cooccurrence, pairsOf } from './cooccurrence';
import { coding, treeOf } from './fixtures';

// Text with three paragraphs: line 0 = [0,50), line 1 = [51,150), line 2 = [151,250).
const text = 'x'.repeat(50) + '\n' + 'y'.repeat(99) + '\n' + 'z'.repeat(99);
const cs = [
  coding('d', 'A', 0, 100, { id: 'a1' }), // lines 0–1
  coding('d', 'B', 10, 20, { id: 'b1' }), // line 0
  coding('d', 'B', 30, 40, { id: 'b2' }), // line 0
  coding('d', 'B', 200, 210, { id: 'b3' }), // line 2
  coding('d', 'B', 120, 130, { id: 'b4' }), // line 1
  coding('d', 'C', 95, 105, { id: 'c1', coder_id: 'rui' }), // line 1
  coding('e', 'A', 0, 10, { id: 'a2' }),
  coding('e', 'B', 0, 10, { id: 'gone', deleted: true }),
];

describe('cooccurrence: overlap', () => {
  // A–B: a1 overlaps b1 and b2 → 2 pairs; 1 segment of A meets B; 2 segments of B meet A.
  //   Jaccard = (1 + 2) / (n_A 2 + n_B 4) = 0.5.
  // A–C: a1 overlaps c1 ([95,100)) → 1; Jaccard = (1 + 1) / (2 + 1) = 2/3.
  // B–C: none (b4 starts at 120, c1 ends at 105).
  const r = cooccurrence(cs, ['A', 'B', 'C'], { mode: 'overlap' });

  it('counts pairs symmetrically with segment counts on the diagonal', () => {
    expect(r.matrix).toEqual([
      [2, 2, 1],
      [2, 4, 0],
      [1, 0, 1],
    ]);
    expect(r.segmentCounts).toEqual([2, 4, 1]);
  });

  it('counts segments with at least one co-occurrence, by direction', () => {
    expect(r.segmentsWith).toEqual([
      [2, 1, 1],
      [2, 4, 0],
      [1, 0, 1],
    ]);
  });

  it('normalises with the segment Jaccard index', () => {
    expect(r.jaccard[0]![1]).toBeCloseTo(0.5, 12);
    expect(r.jaccard[1]![0]).toBeCloseTo(0.5, 12);
    expect(r.jaccard[0]![2]).toBeCloseTo(2 / 3, 12);
    expect(r.jaccard[1]![2]).toBe(0);
    expect(r.jaccard.map((row, i) => row[i])).toEqual([1, 1, 1]);
  });

  it('keeps the co-occurring pairs for drill-down, in either orientation', () => {
    expect(r.pairs.get('A|B')!.map((p) => [p.aId, p.bId])).toEqual([['a1', 'b1'], ['a1', 'b2']]);
    expect(pairsOf(r, 'B', 'A').map((p) => [p.aId, p.bId, p.aStart, p.bStart])).toEqual([['b1', 'a1', 10, 0], ['b2', 'a1', 30, 0]]);
    expect(pairsOf(r, 'B', 'C')).toEqual([]);
    expect(cooccurrence(cs, ['A', 'B'], { mode: 'overlap', details: false }).pairs.size).toBe(0);
  });

  it('can require the same coder', () => {
    const s = cooccurrence(cs, ['A', 'B', 'C'], { mode: 'overlap', sameCoder: true });
    expect(s.matrix[0]![2]).toBe(0);
    expect(s.matrix[0]![1]).toBe(2);
  });

  it('does not count touching segments as overlapping', () => {
    const t = cooccurrence([coding('d', 'A', 0, 5), coding('d', 'B', 5, 10)], ['A', 'B'], { mode: 'overlap' });
    expect(t.matrix[0]![1]).toBe(0);
  });
});

describe('cooccurrence: proximity and paragraph', () => {
  it('counts segments within a distance', () => {
    // Gaps to c1 [95,105): b2 → 55, b1 → 75, b4 → 15, b3 → 95.
    expect(cooccurrence(cs, ['B', 'C'], { mode: 'proximity', distance: 0 }).matrix[0]![1]).toBe(0);
    expect(cooccurrence(cs, ['B', 'C'], { mode: 'proximity', distance: 15 }).matrix[0]![1]).toBe(1);
    expect(cooccurrence(cs, ['B', 'C'], { mode: 'proximity', distance: 60 }).matrix[0]![1]).toBe(2);
    expect(cooccurrence(cs, ['B', 'C'], { mode: 'proximity', distance: 95 }).matrix[0]![1]).toBe(4);
    // Touching segments are at distance 0.
    expect(cooccurrence([coding('d', 'A', 0, 5), coding('d', 'B', 5, 10)], ['A', 'B'], { mode: 'proximity' }).matrix[0]![1]).toBe(1);
  });

  it('pairs segments of B with each other (a code with itself is the diagonal only)', () => {
    const r = cooccurrence(cs, ['B'], { mode: 'proximity', distance: 1000 });
    expect(r.matrix).toEqual([[4]]);
  });

  it('counts segments sharing a paragraph', () => {
    const r = cooccurrence(cs, ['A', 'B', 'C'], { mode: 'paragraph', texts: { d: text } });
    // A (lines 0–1) meets b1, b2 (line 0), b4 (line 1) → 3; and c1 (line 1).
    // B–C: b4 shares line 1 with c1 → 1. Document e has no text → compared by overlap.
    expect(r.matrix).toEqual([
      [2, 3, 1],
      [3, 4, 1],
      [1, 1, 1],
    ]);
    expect(r.missingTexts).toEqual(['e']);
    const m = cooccurrence(cs, ['A', 'B'], { mode: 'paragraph', texts: new Map([['d', text], ['e', 'short']]) });
    expect(m.missingTexts).toEqual([]);
  });
});

describe('cooccurrence: hierarchy and edge cases', () => {
  const descendants = treeOf({ P: null, B: 'P' });

  it('counts descendants for their ancestor without pairing a segment with itself', () => {
    const r = cooccurrence(cs, ['A', 'P'], { mode: 'overlap', includeChildren: true, descendants });
    expect(r.matrix).toEqual([[2, 2], [2, 4]]);
    const both = cooccurrence(cs, ['P', 'B'], { mode: 'overlap', includeChildren: true, descendants });
    // Every B segment counts as P too, but B segments do not overlap each other.
    expect(both.matrix).toEqual([[4, 0], [0, 4]]);
    const overl = cooccurrence([coding('d', 'B', 0, 10, { id: 'x' }), coding('d', 'B', 5, 15, { id: 'y' })], ['P', 'B'], { mode: 'overlap', includeChildren: true, descendants });
    // x as P with y as B, and y as P with x as B.
    expect(overl.matrix[0]![1]).toBe(2);
    expect(overl.segmentsWith).toEqual([[2, 2], [2, 2]]);
  });

  it('handles no codings, unknown codes and duplicate code ids', () => {
    const r = cooccurrence([], ['A', 'B'], { mode: 'overlap' });
    expect(r.matrix).toEqual([[0, 0], [0, 0]]);
    expect(r.jaccard).toEqual([[0, 0], [0, 0]]);
    expect(cooccurrence(cs, [], { mode: 'overlap' }).matrix).toEqual([]);
    expect(cooccurrence(cs, ['A', 'A'], { mode: 'overlap' }).codes).toEqual(['A']);
  });

  it('counts one long segment against many short ones (pairs vs segments)', () => {
    const list = [coding('d', 'A', 0, 100), ...[0, 20, 40].map((s) => coding('d', 'B', s, s + 5))];
    const r = cooccurrence(list, ['A', 'B'], { mode: 'overlap' });
    expect(r.matrix[0]![1]).toBe(3);
    expect(r.segmentsWith[0]![1]).toBe(1);
    expect(r.segmentsWith[1]![0]).toBe(3);
    expect(r.jaccard[0]![1]).toBe(1);
  });
});

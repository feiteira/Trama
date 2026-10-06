import { describe, expect, it } from 'vitest';
import { coding } from '../../../core/qda/fixtures';
import { cooccurrence } from '../../../core/qda/cooccurrence';
import { codeDocumentMatrix } from '../../../core/qda/matrix';
import { doc } from '../../../core/qda/fixtures';
import { ALL_CODERS, coderCounts, dedupeSegments, effectiveScope, pooledCooccurrence, scopeCodings } from './coders';

// Ana coded the project; Rui re-coded one passage for the agreement check and disagreed.
const ana = [
  coding('d1', 'grief', 0, 50, { coder_id: 'ana' }),
  coding('d1', 'belonging', 100, 150, { coder_id: 'ana' }),
  coding('d1', 'purpose', 120, 160, { coder_id: 'ana' }),
];
const rui = [
  coding('d1', 'stress', 0, 50, { coder_id: 'rui' }), // disagreement with Ana's "grief"
  coding('d1', 'belonging', 100, 150, { coder_id: 'rui' }), // agreement: the same segment
];
const all = [...ana, ...rui];

describe('coder scope', () => {
  it('a disagreement between two coders is not a co-occurrence', () => {
    // What the tools did before: pooling every coder.
    expect(cooccurrence(all, ['stress', 'grief'], { mode: 'overlap' }).matrix[0]![1]).toBe(1);
    const pooled = pooledCooccurrence(all, ['stress', 'grief', 'belonging', 'purpose'], { mode: 'overlap', details: true });
    expect(pooled.matrix[0]![1]).toBe(0);
    expect(pooled.jaccard[0]![1]).toBe(0);
    // Ana's own co-occurrence survives, once, though Rui coded "belonging" there too.
    expect(pooled.matrix[2]![3]).toBe(1);
    expect(pooled.pairs.get('belonging|purpose')).toHaveLength(1);
    // The diagonal counts the segment both coders coded alike once.
    expect(pooled.segmentCounts).toEqual([1, 1, 1, 1]);
    expect(pooled.jaccard[2]![3]).toBe(1);
  });

  it('a single coder counts only their codings', () => {
    const { counted } = scopeCodings(all, 'ana', 'ana');
    expect(counted).toHaveLength(3);
    const m = codeDocumentMatrix(counted, ['belonging'], [doc('d1', 200)], { measure: 'segments' });
    expect(m.cells[0]![0]).toBe(1);
  });

  it('all coders count a segment coded alike by several coders once, keeping my coding', () => {
    const { counted, raw } = scopeCodings(all, ALL_CODERS, 'rui');
    expect(raw).toHaveLength(5);
    expect(counted).toHaveLength(4);
    expect(counted.find((c) => c.code_id === 'belonging')?.coder_id).toBe('rui');
    expect(dedupeSegments(all)).toHaveLength(4);
  });

  it('chooses a sensible default scope', () => {
    const coders = coderCounts(all, new Map([['ana', 'Ana'], ['rui', 'Rui']]));
    expect(coders.map((c) => [c.id, c.count])).toEqual([['ana', 3], ['rui', 2]]);
    expect(effectiveScope('', coders, 'rui')).toBe('rui');
    expect(effectiveScope('', coders, 'someone-else')).toBe(ALL_CODERS);
    expect(effectiveScope('ana', coders, 'rui')).toBe('ana');
    expect(effectiveScope('gone', coders, 'rui')).toBe('rui');
    expect(effectiveScope(ALL_CODERS, coders, 'rui')).toBe(ALL_CODERS);
    const one = coderCounts(ana, new Map());
    expect(effectiveScope('', one, 'me')).toBe('ana');
    expect(effectiveScope(ALL_CODERS, one, 'me')).toBe('ana');
  });
});

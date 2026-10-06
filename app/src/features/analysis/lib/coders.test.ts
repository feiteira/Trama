import { describe, expect, it } from 'vitest';
import { coding } from '../../../core/qda/fixtures';
import { cooccurrence } from '../../../core/qda/cooccurrence';
import { codeDocumentMatrix } from '../../../core/qda/matrix';
import { doc } from '../../../core/qda/fixtures';
import { createExampleLibrary } from '../../../demo/exampleLibrary';
import { createMemoryPlatform } from '../../../platform/memory';
import { FAST_KDF } from '../../../services/testing';
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

describe('all coders: one passage, several boundaries', () => {
  it('two coders coding 10–50 and 12–50 with the same code give 1 segment', () => {
    const list = [coding('d1', 'x', 10, 50, { coder_id: 'ana' }), coding('d1', 'x', 12, 50, { coder_id: 'rui' })];
    expect(scopeCodings(list, ALL_CODERS, 'rui').counted.map((c) => c.coder_id)).toEqual(['rui']);
    expect(dedupeSegments(list)).toHaveLength(1);
    const m = codeDocumentMatrix(scopeCodings(list, ALL_CODERS, 'ana').counted, ['x'], [doc('d1', 200)], { measure: 'segments' });
    expect(m.cells[0]![0]).toBe(1);
  });

  it('keeps apart what one coder split, what does not overlap, other codes and other documents', () => {
    const list = [
      coding('d1', 'x', 10, 20, { coder_id: 'ana' }),
      coding('d1', 'x', 30, 40, { coder_id: 'ana' }),
      coding('d1', 'x', 10, 40, { coder_id: 'rui' }), // covers both of Ana's: one passage, Ana's two segments
      coding('d1', 'x', 100, 120, { coder_id: 'rui' }), // nobody else: its own passage
      coding('d1', 'y', 10, 40, { coder_id: 'ana' }), // another code
      coding('d2', 'x', 10, 40, { coder_id: 'ana' }), // another document
      coding('d1', 'x', 40, 60, { coder_id: 'ana' }), // touches Rui's end (half-open): not an overlap with it
    ];
    const kept = dedupeSegments(list, 'rui');
    expect(kept.filter((c) => c.document_id === 'd1' && c.code_id === 'x').map((c) => [c.coder_id, c.start])).toEqual([
      ['ana', 10],
      ['ana', 30],
      ['rui', 100],
      ['ana', 40],
    ]);
    expect(kept).toHaveLength(6);
    // One coder's own overlapping codings are never merged with each other.
    const own = [coding('d1', 'x', 10, 50, { coder_id: 'ana' }), coding('d1', 'x', 20, 60, { coder_id: 'ana' })];
    expect(dedupeSegments(own)).toHaveLength(2);
  });

  it('a co-occurrence both coders found with their own boundaries counts once', () => {
    const list = [
      coding('d1', 'a', 0, 50, { coder_id: 'ana' }),
      coding('d1', 'b', 20, 80, { coder_id: 'ana' }),
      coding('d1', 'a', 0, 45, { coder_id: 'rui' }),
      coding('d1', 'b', 25, 80, { coder_id: 'rui' }),
    ];
    const r = pooledCooccurrence(list, ['a', 'b'], { mode: 'overlap', details: true });
    expect(r.segmentCounts).toEqual([1, 1]);
    expect(r.matrix[0]![1]).toBe(1);
    expect(r.jaccard[0]![1]).toBe(1);
  });

  it('the example project: Rui’s re-coded passages are not counted again (165 segments before, 148 passages)', async () => {
    const { library, project } = await createExampleLibrary(createMemoryPlatform(), { locale: 'en', params: FAST_KDF });
    const codings = await project.store.list('coding');
    expect(codings).toHaveLength(175);
    expect(scopeCodings(codings, ALL_CODERS, project.me.id).counted).toHaveLength(148);
    await library.lock();
  });
});

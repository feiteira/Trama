import { describe, expect, it } from 'vitest';
import { codeFrequencyBars, codeTimeline, documentPortrait } from './charts';
import { code, coding, treeOf } from './fixtures';

const codes = [code('P', { color: '#e4572e' }), code('K', { color: '#29a37a', parent_id: 'P' }), code('Q', { color: '#3a6ea5' }), code('Z', { deleted: true })];
const descendants = treeOf({ P: null, K: 'P', Q: null });
const cs = [
  coding('d1', 'P', 0, 10),
  coding('d1', 'K', 5, 20),
  coding('d2', 'K', 0, 4),
  coding('d1', 'Q', 0, 30),
  coding('d1', 'Q', 10, 40),
  coding('d1', 'Q', 0, 5, { deleted: true }),
];

describe('codeFrequencyBars', () => {
  it('counts segments, documents and characters per code', () => {
    expect(codeFrequencyBars(cs, codes).map((b) => [b.codeId, b.value])).toEqual([['P', 1], ['K', 2], ['Q', 2]]);
    expect(codeFrequencyBars(cs, codes, { measure: 'documents' }).map((b) => b.value)).toEqual([1, 2, 1]);
    expect(codeFrequencyBars(cs, codes, { measure: 'characters' }).map((b) => b.value)).toEqual([10, 19, 40]);
    expect(codeFrequencyBars(cs, codes, { measure: 'characters', includeChildren: true, descendants }).map((b) => b.value)).toEqual([24, 19, 40]);
  });

  it('sorts, hides zeros, limits and carries names and colours', () => {
    const bars = codeFrequencyBars(cs, codes, { measure: 'characters', sort: 'value', limit: 2 });
    expect(bars).toEqual([
      { codeId: 'Q', name: 'Q', color: '#3a6ea5', value: 40 },
      { codeId: 'K', name: 'K', color: '#29a37a', value: 19 },
    ]);
    // Ties keep codebook order.
    expect(codeFrequencyBars(cs, codes, { sort: 'value' }).map((b) => b.codeId)).toEqual(['K', 'Q', 'P']);
    expect(codeFrequencyBars([], codes, { hideZero: true })).toEqual([]);
  });
});

describe('documentPortrait', () => {
  it('shows the dominant code per slice, with the mix', () => {
    // 50 characters in 5 slices of 10. Q covers [0,40), P [0,10), K [5,20).
    const p = documentPortrait(cs, codes, 50, { slices: 5, documentId: 'd1' });
    expect(p.map((s) => [s.start, s.end, s.codeId, s.share])).toEqual([
      [0, 10, 'P', 1], // P 10, Q 10, K 5: tie broken by codebook order
      [10, 20, 'K', 1], // K 10, Q 10
      [20, 30, 'Q', 1],
      [30, 40, 'Q', 1],
      [40, 50, null, 0],
    ]);
    expect(p[0]!.mix).toEqual([
      { codeId: 'P', color: '#e4572e', share: 1 },
      { codeId: 'Q', color: '#3a6ea5', share: 1 },
      { codeId: 'K', color: '#29a37a', share: 0.5 },
    ]);
    expect(p[0]!.color).toBe('#e4572e');
  });

  it('uses uneven slices that tile the document exactly', () => {
    const p = documentPortrait([coding('d', 'Q', 0, 7)], codes, 7, { slices: 3 });
    expect(p.map((s) => [s.start, s.end])).toEqual([[0, 2], [2, 4], [4, 7]]);
    expect(p.every((s) => s.share === 1)).toBe(true);
  });

  it('never makes more slices than characters and handles empty documents', () => {
    expect(documentPortrait([], codes, 3, { slices: 100 }).length).toBe(3);
    expect(documentPortrait([], codes, 0)).toEqual([]);
    expect(documentPortrait([coding('d', 'Q', 5, 500)], codes, 10, { slices: 2 }).map((s) => s.share)).toEqual([0, 1]);
  });

  it('only counts the codes passed', () => {
    const p = documentPortrait(cs, [codes[2]!], 50, { slices: 5, documentId: 'd1' });
    expect(p[0]!.codeId).toBe('Q');
  });
});

describe('codeTimeline', () => {
  it('places segments along the document by characters', () => {
    const t = codeTimeline(cs, codes, 40, { documentId: 'd1' });
    expect(t.unit).toBe('characters');
    expect(t.lanes.map((l) => [l.codeId, l.segments.map((s) => [s.from, s.to])])).toEqual([
      ['P', [[0, 0.25]]],
      ['K', [[0.125, 0.5]]],
      ['Q', [[0, 0.75], [0.25, 1]]],
    ]);
  });

  it('places segments by paragraph for transcripts', () => {
    const text = 'A: one\nB: two\nA: three\nB: four';
    const list = [coding('d', 'Q', text.indexOf('two'), text.indexOf('three') + 5)];
    const t = codeTimeline(list, codes, text.length, { unit: 'paragraphs', text });
    expect(t.unit).toBe('paragraphs');
    expect(t.lanes[0]!.segments[0]).toMatchObject({ from: 0.25, to: 0.75 });
    expect(codeTimeline(list, codes, text.length, { unit: 'paragraphs' }).unit).toBe('characters');
  });

  it('can fold children into their parent lane and copes with empty documents', () => {
    const t = codeTimeline(cs, codes, 40, { documentId: 'd1', includeChildren: true, descendants });
    expect(t.lanes[0]!.segments.length).toBe(2);
    expect(codeTimeline(cs, codes, 0, { documentId: 'd1' }).lanes[0]!.segments[0]).toMatchObject({ from: 0, to: 0 });
    expect(codeTimeline([], codes, 10).lanes).toEqual([]);
  });
});

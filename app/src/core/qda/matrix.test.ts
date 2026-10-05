import { describe, expect, it } from 'vitest';
import type { DocGroup } from '../model/types';
import { attribute, coding, doc, kase, treeOf } from './fixtures';
import { codeDocumentMatrix, documentColumns } from './matrix';

const descendants = treeOf({ P: null, K: 'P', Q: null });
const documents = [
  doc('d1', 100, { group_ids: ['g1'], case_id: 'c1' }),
  doc('d2', 200, { group_ids: ['g1', 'g2'], case_id: 'c2' }),
  doc('d3', 50),
  doc('dx', 10, { deleted: true }),
];
const cs = [
  coding('d1', 'P', 0, 10),
  coding('d1', 'K', 5, 20),
  coding('d1', 'Q', 50, 60),
  coding('d1', 'Q', 55, 65),
  coding('d2', 'K', 0, 100),
  coding('d3', 'Q', 0, 50),
  coding('d3', 'Q', 0, 50, { deleted: true }),
  coding('dx', 'Q', 0, 5),
];
const codes = ['P', 'K', 'Q'];

describe('codeDocumentMatrix', () => {
  it('counts segments, with column totals over all codings', () => {
    const m = codeDocumentMatrix(cs, codes, documents, { measure: 'segments' });
    expect(m.rows).toEqual(codes);
    expect(m.cols.map((c) => c.key)).toEqual(['d1', 'd2', 'd3']);
    expect(m.cells).toEqual([[1, 0, 0], [1, 1, 0], [2, 0, 1]]);
    expect(m.rowTotals).toEqual([1, 2, 3]);
    expect(m.colTotals).toEqual([4, 1, 1]);
    expect(m.grandTotal).toBe(6);
  });

  it('aggregates children without double counting in totals', () => {
    const m = codeDocumentMatrix(cs, codes, documents, { measure: 'segments', includeChildren: true, descendants });
    expect(m.cells[0]).toEqual([2, 1, 0]);
    expect(m.rowTotals[0]).toBe(3);
    expect(m.colTotals).toEqual([4, 1, 1]); // not 2 + 1 + 2
    expect(m.grandTotal).toBe(6);
  });

  it('counts coded characters once where segments overlap', () => {
    const m = codeDocumentMatrix(cs, codes, documents, { measure: 'characters' });
    expect(m.cells).toEqual([[10, 0, 0], [15, 100, 0], [15, 0, 50]]);
    expect(m.colTotals).toEqual([35, 100, 50]); // d1: [0,20) ∪ [50,65)
    expect(m.grandTotal).toBe(185);
    const c = codeDocumentMatrix(cs, codes, documents, { measure: 'characters', includeChildren: true, descendants });
    expect(c.cells[0]).toEqual([20, 100, 0]);
  });

  it('reports presence and the number of codes present per column', () => {
    const m = codeDocumentMatrix(cs, codes, documents, { measure: 'presence' });
    expect(m.cells).toEqual([[1, 0, 0], [1, 1, 0], [1, 0, 1]]);
    expect(m.rowTotals).toEqual([1, 2, 2]);
    expect(m.colTotals).toEqual([3, 1, 1]);
    expect(m.grandTotal).toBe(3);
  });

  it('computes coverage as a percentage of the documents', () => {
    const m = codeDocumentMatrix(cs, codes, documents, { measure: 'percentOfDoc' });
    expect(m.cells[1]).toEqual([15, 50, 0]);
    expect(m.rowTotals[1]).toBeCloseTo((115 / 350) * 100, 12);
    expect(m.colTotals).toEqual([35, 50, 100]);
    expect(m.grandTotal).toBeCloseTo((185 / 350) * 100, 12);
  });

  it('clamps stale offsets to the document length', () => {
    const m = codeDocumentMatrix([coding('d3', 'Q', 40, 80)], ['Q'], documents, { measure: 'percentOfDoc' });
    expect(m.cells[0]![2]).toBe(20);
  });

  it('groups documents by group (a document can count in several)', () => {
    const groups: DocGroup[] = [
      { id: 'g1', name: 'Urban', color: '#3a6ea5', order: 0, created_at: '', updated_at_hlc: '', deleted: false },
      { id: 'g2', name: 'Rural', color: '#3a6ea5', order: 1, created_at: '', updated_at_hlc: '', deleted: false },
      { id: 'g3', name: 'Old', color: '#3a6ea5', order: 2, created_at: '', updated_at_hlc: '', deleted: true },
    ];
    const m = codeDocumentMatrix(cs, codes, documents, { measure: 'segments', groupBy: { by: 'group', groups } });
    expect(m.cols.map((c) => [c.label, c.documentIds, c.chars])).toEqual([['Urban', ['d1', 'd2'], 300], ['Rural', ['d2'], 200]]);
    expect(m.cells).toEqual([[1, 0], [2, 1], [2, 0]]);
    // Row totals count d2 once.
    expect(m.rowTotals).toEqual([1, 2, 2]);
    const p = codeDocumentMatrix(cs, codes, documents, { measure: 'presence', groupBy: { by: 'group', groups } });
    expect(p.cells[1]).toEqual([2, 1]);
  });

  it('groups by case, with a column for documents without one', () => {
    const cases = [kase('c1', {}), kase('c2', {}), kase('c9', {}, { deleted: true })];
    const m = codeDocumentMatrix(cs, codes, documents, { measure: 'segments', groupBy: { by: 'case', cases } });
    expect(m.cols.map((c) => [c.key, c.kind, c.documentIds])).toEqual([['c1', 'case', ['d1']], ['c2', 'case', ['d2']], ['nocase', 'nocase', ['d3']]]);
  });

  it('groups by attribute value', () => {
    const cases = [kase('c1', { site: 'Porto' }), kase('c2', { site: 'lisboa' })];
    const site = attribute('site', 'choice', ['Porto', 'Lisboa', 'Faro']);
    const m = codeDocumentMatrix(cs, codes, documents, { measure: 'segments', groupBy: { by: 'attribute', cases, attribute: site } });
    expect(m.cols.map((c) => [c.label, c.kind, c.documentIds])).toEqual([
      ['Porto', 'value', ['d1']],
      ['Lisboa', 'value', ['d2']],
      ['Faro', 'value', []],
      ['(no value)', 'empty', ['d3']],
    ]);
    expect(m.cells[2]).toEqual([2, 0, 0, 1]);
  });

  it('accepts Code records, ignores duplicates and handles empty input', () => {
    expect(codeDocumentMatrix([], [], [], { measure: 'segments' })).toMatchObject({ rows: [], cols: [], cells: [], grandTotal: 0 });
    const m = codeDocumentMatrix(cs, ['Q', 'Q'], [], { measure: 'percentOfDoc' });
    expect(m.rows).toEqual(['Q']);
    expect(m.cells).toEqual([[]]);
    expect(m.rowTotals).toEqual([0]);
    expect(documentColumns([doc('a', 1), doc('a', 1)]).length).toBe(1);
  });
});

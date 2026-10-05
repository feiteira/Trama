import { describe, expect, it } from 'vitest';
import { attribute, code, coding, doc, kase, treeOf } from './fixtures';
import { filterCodings, segmentContext, sortSegments } from './segments';

const descendants = treeOf({ health: null, gp: 'health', nurse: 'health', money: null });
const documents = [
  doc('d1', 100, { group_ids: ['g1'], case_id: 'c1', order: 1 }),
  doc('d2', 100, { group_ids: ['g2'], case_id: 'c2', order: 2 }),
  doc('d3', 100, { group_ids: ['g1', 'g2'], case_id: null, order: 3 }),
  doc('d4', 100, { case_id: 'c3', deleted: true }),
];
const cases = [kase('c1', { age: 34, site: 'Porto', urban: true }), kase('c2', { age: '71', site: 'Évora ', urban: false }), kase('c3', { age: 50 })];
const attributes = [attribute('age', 'number'), attribute('site', 'text'), attribute('urban', 'boolean')];
const ctx = { documents, cases, attributes, descendants };

const cs = [
  coding('d1', 'health', 0, 10, { id: 'h1' }),
  coding('d1', 'gp', 5, 8, { id: 'gp1', coder_id: 'rui' }),
  coding('d1', 'money', 20, 30, { id: 'm1' }),
  coding('d2', 'nurse', 0, 50, { id: 'n2' }),
  coding('d2', 'money', 10, 20, { id: 'm2', coder_id: 'rui' }),
  coding('d3', 'money', 0, 5, { id: 'm3' }),
  coding('d4', 'money', 0, 5, { id: 'm4' }),
  coding('d1', 'money', 0, 5, { id: 'gone', deleted: true }),
];
const ids = (list: { id: string }[]) => list.map((c) => c.id);

describe('filterCodings', () => {
  it('returns live codings of live documents with no filter', () => {
    expect(ids(filterCodings(cs, {}, ctx))).toEqual(['h1', 'gp1', 'm1', 'n2', 'm2', 'm3']);
    // Without documents, a deleted document cannot be recognised.
    expect(ids(filterCodings(cs, {}))).toContain('m4');
  });

  it('distinguishes "no constraint" from "nothing selected"', () => {
    expect(filterCodings(cs, { codeIds: [] }, ctx)).toEqual([]);
    expect(filterCodings(cs, { documentIds: [] }, ctx)).toEqual([]);
  });

  it('filters by code, with or without descendants', () => {
    expect(ids(filterCodings(cs, { codeIds: ['health'] }, ctx))).toEqual(['h1']);
    expect(ids(filterCodings(cs, { codeIds: ['health'], includeChildren: true }, ctx))).toEqual(['h1', 'gp1', 'n2']);
    expect(() => filterCodings(cs, { codeIds: ['health'], includeChildren: true })).toThrow(/descendants/);
  });

  it('filters by document, group, case and coder', () => {
    expect(ids(filterCodings(cs, { documentIds: ['d2'] }, ctx))).toEqual(['n2', 'm2']);
    expect(ids(filterCodings(cs, { groupIds: ['g1'] }, ctx))).toEqual(['h1', 'gp1', 'm1', 'm3']);
    expect(ids(filterCodings(cs, { caseIds: ['c2', 'c3'] }, ctx))).toEqual(['n2', 'm2']);
    expect(ids(filterCodings(cs, { coderIds: ['rui'] }, ctx))).toEqual(['gp1', 'm2']);
    expect(ids(filterCodings(cs, { groupIds: ['g2'], codeIds: ['money'] }, ctx))).toEqual(['m2', 'm3']);
    expect(() => filterCodings(cs, { groupIds: ['g1'] })).toThrow(/documents/);
  });

  it('filters by attribute conditions, typed', () => {
    const f = (conds: Parameters<typeof filterCodings>[1]['attributeConditions'], match?: 'all' | 'any') =>
      ids(filterCodings(cs, { attributeConditions: conds, attributeMatch: match }, ctx));
    expect(f([{ attributeId: 'age', op: 'gt', value: 40 }])).toEqual(['n2', 'm2']); // '71' read as a number
    expect(f([{ attributeId: 'age', op: 'lt', value: '40' }])).toEqual(['h1', 'gp1', 'm1']);
    expect(f([{ attributeId: 'site', op: 'eq', value: 'evora' }])).toEqual(['n2', 'm2']);
    expect(f([{ attributeId: 'site', op: 'contains', value: 'POR' }])).toEqual(['h1', 'gp1', 'm1']);
    expect(f([{ attributeId: 'site', op: 'neq', value: 'Porto' }])).toEqual(['n2', 'm2', 'm3']); // no case → not equal
    expect(f([{ attributeId: 'site', op: 'empty' }])).toEqual(['m3']);
    expect(f([{ attributeId: 'site', op: 'notEmpty' }])).toEqual(['h1', 'gp1', 'm1', 'n2', 'm2']);
    expect(f([{ attributeId: 'urban', op: 'eq', value: 'yes' }])).toEqual(['h1', 'gp1', 'm1']);
    expect(f([{ attributeId: 'age', op: 'gt', value: 40 }, { attributeId: 'urban', op: 'eq', value: true }])).toEqual([]);
    expect(f([{ attributeId: 'age', op: 'gt', value: 40 }, { attributeId: 'urban', op: 'eq', value: true }], 'any')).toEqual(['h1', 'gp1', 'm1', 'n2', 'm2']);
    expect(() => filterCodings(cs, { attributeConditions: [{ attributeId: 'age', op: 'empty' }] }, { documents })).toThrow(/cases/);
  });

  it('keeps segments overlapping, within or containing other codes', () => {
    expect(ids(filterCodings(cs, { codeIds: ['health'], overlapWith: { codeIds: ['gp'], mode: 'overlap' } }, ctx))).toEqual(['h1']);
    expect(ids(filterCodings(cs, { codeIds: ['gp'], overlapWith: { codeIds: ['health'], mode: 'within' } }, ctx))).toEqual(['gp1']);
    expect(ids(filterCodings(cs, { codeIds: ['health'], overlapWith: { codeIds: ['gp'], mode: 'contains' } }, ctx))).toEqual(['h1']);
    expect(ids(filterCodings(cs, { codeIds: ['health'], overlapWith: { codeIds: ['gp'], mode: 'within' } }, ctx))).toEqual([]);
    expect(ids(filterCodings(cs, { codeIds: ['money'], overlapWith: { codeIds: ['health'], mode: 'overlap', includeChildren: true } }, ctx))).toEqual(['m2']);
    expect(ids(filterCodings(cs, { codeIds: ['health'], overlapWith: { codeIds: ['gp'], mode: 'overlap', sameCoder: true } }, ctx))).toEqual([]);
    // Touching is not overlapping.
    const touch = [coding('d1', 'a', 0, 5, { id: 'x' }), coding('d1', 'b', 5, 9, { id: 'y' })];
    expect(filterCodings(touch, { codeIds: ['a'], overlapWith: { codeIds: ['b'], mode: 'overlap' } })).toEqual([]);
  });

  it('never relates a segment to itself', () => {
    expect(filterCodings(cs, { codeIds: ['money'], overlapWith: { codeIds: ['money'], mode: 'overlap' } }, ctx)).toEqual([]);
    const two = [coding('d', 'a', 0, 5, { id: 'p' }), coding('d', 'a', 2, 4, { id: 'q' })];
    expect(ids(filterCodings(two, { overlapWith: { codeIds: ['a'], mode: 'contains' } }))).toEqual(['p']);
  });

  it('finds overlaps behind long earlier segments (running maximum of ends)', () => {
    const list = [
      coding('d', 'b', 0, 1000, { id: 'long' }),
      coding('d', 'b', 10, 20, { id: 's1' }),
      coding('d', 'b', 30, 40, { id: 's2' }),
      coding('d', 'a', 500, 510, { id: 'target' }),
      coding('d', 'a', 2000, 2010, { id: 'far' }),
    ];
    expect(ids(filterCodings(list, { codeIds: ['a'], overlapWith: { codeIds: ['b'], mode: 'within' } }))).toEqual(['target']);
  });
});

describe('sortSegments', () => {
  const codes = [code('money'), code('health'), code('gp'), code('nurse')];
  const list = [
    coding('d2', 'health', 5, 9, { id: 'a', created_at: '2026-03-01T00:00:00Z' }),
    coding('d1', 'money', 50, 90, { id: 'b', created_at: '2026-01-01T00:00:00Z' }),
    coding('d1', 'health', 10, 12, { id: 'c', created_at: '2026-02-01T00:00:00Z' }),
    coding('dX', 'gp', 0, 1, { id: 'd', created_at: '2026-02-01T00:00:00Z' }),
  ];
  it('sorts by document order and position', () => {
    expect(ids(sortSegments(list, 'document', { documents }))).toEqual(['c', 'b', 'a', 'd']);
    expect(ids(sortSegments(list, 'document', { documents }, true))).toEqual(['d', 'a', 'b', 'c']);
  });
  it('sorts by codebook order', () => {
    expect(ids(sortSegments(list, 'code', { documents, codes }))).toEqual(['b', 'c', 'a', 'd']);
  });
  it('sorts by length and creation time with deterministic ties', () => {
    expect(ids(sortSegments(list, 'length', { documents }))).toEqual(['d', 'c', 'a', 'b']);
    expect(ids(sortSegments(list, 'length', { documents }, true))).toEqual(['b', 'a', 'c', 'd']);
    expect(ids(sortSegments(list, 'created', { documents }))).toEqual(['b', 'c', 'd', 'a']);
  });
  it('does not mutate its input', () => {
    const copy = [...list];
    sortSegments(list, 'length');
    expect(list).toEqual(copy);
  });
});

describe('segmentContext', () => {
  const text = 'Intro line.\n\nAna: I trust my GP because she listens.\nRui: Same here.\n\nEnd.';
  const s = text.indexOf('trust');
  it('returns the paragraph around a segment', () => {
    const c = segmentContext(text, { start: s, end: s + 5 });
    expect(c.before).toBe('Ana: I ');
    expect(c.coded).toBe('trust');
    expect(c.after).toBe(' my GP because she listens.');
    expect(text.slice(c.start, c.end)).toBe('Ana: I trust my GP because she listens.');
  });
  it('adds neighbouring non-blank paragraphs on request', () => {
    const c = segmentContext(text, { start: s, end: s + 5 }, { paragraphs: 1 });
    expect(text.slice(c.start, c.end)).toBe('Intro line.\n\nAna: I trust my GP because she listens.\nRui: Same here.');
  });
  it('spans several paragraphs and clamps offsets', () => {
    const c = segmentContext(text, { start: s, end: text.indexOf('Same') + 4 });
    expect(c.after).toBe(' here.');
    const d = segmentContext('abc', { start: -5, end: 99 });
    expect(d).toEqual({ start: 0, end: 3, before: '', coded: 'abc', after: '' });
    expect(segmentContext('', { start: 0, end: 0 })).toEqual({ start: 0, end: 0, before: '', coded: '', after: '' });
  });
});

describe('integration with the code tree', () => {
  it('accepts buildTree(codes).descendants as it is', async () => {
    const { buildTree } = await import('./tree');
    const tree = buildTree([code('health'), code('gp', { parent_id: 'health' }), code('money')]);
    const list = [coding('d', 'gp', 0, 1, { id: 'x' }), coding('d', 'money', 0, 1, { id: 'y' })];
    expect(ids(filterCodings(list, { codeIds: ['health'], includeChildren: true }, { descendants: tree.descendants }))).toEqual(['x']);
  });
});

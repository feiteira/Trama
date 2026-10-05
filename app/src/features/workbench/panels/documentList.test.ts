import { describe, expect, it } from 'vitest';
import { displayOrder, filterDocs, rangeIds, reorderPlan, sectionDocs, sortDocs, type DocItem } from './documentList';
import { definitionSummary } from './panelText';

const doc = (id: string, over: Partial<DocItem> = {}): DocItem => ({
  id,
  name: id,
  kind: 'text',
  codings: 0,
  caseId: null,
  caseName: null,
  groupIds: [],
  groupNames: [],
  color: null,
  order: 0,
  addedAt: '2026-01-01T00:00:00Z',
  filename: '',
  ...over,
});

const DOCS: DocItem[] = [
  doc('a', { name: 'Interview 10', order: 1, codings: 3, caseId: 'p1', caseName: 'Maria', groupIds: ['g1'], groupNames: ['Interviews'], addedAt: '2026-01-03T00:00:00Z' }),
  doc('b', { name: 'Interview 2', order: 2, codings: 12, caseId: 'p2', caseName: 'João', groupIds: ['g1', 'g2'], groupNames: ['Interviews', 'Wave 1'], addedAt: '2026-01-01T00:00:00Z' }),
  doc('c', { name: 'Field notes', order: 3, codings: 0, filename: 'notes-open-day.docx', addedAt: '2026-01-05T00:00:00Z' }),
];

describe('filter and sort', () => {
  it('finds by name, case, group and file name, accents ignored', () => {
    expect(filterDocs(DOCS, 'joao').map((d) => d.id)).toEqual(['b']);
    expect(filterDocs(DOCS, 'wave').map((d) => d.id)).toEqual(['b']);
    expect(filterDocs(DOCS, 'open-day').map((d) => d.id)).toEqual(['c']);
    expect(filterDocs(DOCS, 'interview maria').map((d) => d.id)).toEqual(['a']);
    expect(filterDocs(DOCS, ' ').length).toBe(3);
  });

  it('sorts by manual order, name (numeric), most coded and recently added', () => {
    expect(sortDocs(DOCS, 'manual', 'en').map((d) => d.id)).toEqual(['a', 'b', 'c']);
    expect(sortDocs(DOCS, 'name', 'en').map((d) => d.id)).toEqual(['c', 'b', 'a']);
    expect(sortDocs(DOCS, 'coded', 'en').map((d) => d.id)).toEqual(['b', 'a', 'c']);
    expect(sortDocs(DOCS, 'recent', 'en').map((d) => d.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('sections', () => {
  const groups = [
    { id: 'g1', name: 'Interviews', color: '#3a6ea5' },
    { id: 'g2', name: 'Wave 1', color: '#29a37a' },
    { id: 'g3', name: 'Empty', color: '#7a7f87' },
  ];
  const cases = [
    { id: 'p2', name: 'João', color: null },
    { id: 'p1', name: 'Maria', color: '#e4572e' },
  ];

  it('groups by document group (a document can show twice), empty groups left out', () => {
    const s = sectionDocs(DOCS, 'group', groups, cases, 'No group', 'en');
    expect(s.map((x) => [x.key, x.items.map((d) => d.id)])).toEqual([
      ['g1', ['a', 'b']],
      ['g2', ['b']],
      ['none', ['c']],
    ]);
    expect(displayOrder(s)).toEqual(['a', 'b', 'c']);
    expect(displayOrder(s, new Set(['g1']))).toEqual(['b', 'c']);
  });

  it('groups by case, cases by name', () => {
    const s = sectionDocs(DOCS, 'case', groups, cases, 'No case', 'en');
    expect(s.map((x) => [x.title, x.items.map((d) => d.id)])).toEqual([
      ['João', ['b']],
      ['Maria', ['a']],
      ['No case', ['c']],
    ]);
  });

  it('one untitled section when not grouping', () => {
    expect(sectionDocs(DOCS, 'all', groups, cases, '', 'en')).toEqual([{ key: 'all', kind: 'all', title: null, color: null, items: DOCS }]);
  });
});

describe('selection and reordering', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];

  it('selects a range either way', () => {
    expect(rangeIds(order, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeIds(order, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(rangeIds(order, null, 'c')).toEqual(['c']);
    expect(rangeIds(order, 'x', 'c')).toEqual(['c']);
  });

  it('computes where dragged documents go', () => {
    expect(reorderPlan(order, ['e'], 'b', false)).toEqual({ beforeId: 'b', ids: ['e'] });
    expect(reorderPlan(order, ['a'], 'c', true)).toEqual({ beforeId: 'd', ids: ['a'] });
    expect(reorderPlan(order, ['a'], 'e', true)).toEqual({ beforeId: null, ids: ['a'] });
    // Several, keeping their order, skipping dragged neighbours.
    expect(reorderPlan(order, ['d', 'b'], 'a', false)).toEqual({ beforeId: 'a', ids: ['b', 'd'] });
    expect(reorderPlan(order, ['a', 'b'], 'c', true)).toEqual({ beforeId: 'd', ids: ['a', 'b'] });
    expect(reorderPlan(order, ['b', 'c'], 'b', true)).toBeNull();
  });

  it('reports a drop that moves nothing', () => {
    expect(reorderPlan(order, ['b'], 'b', false)).toBeNull();
    expect(reorderPlan(order, ['b'], 'a', true)).toBeNull();
    expect(reorderPlan(order, ['b', 'c'], 'd', false)).toBeNull();
    expect(reorderPlan(order, [], 'a', false)).toBeNull();
  });
});

describe('definitionSummary', () => {
  it('collapses whitespace and cuts at a word', () => {
    expect(definitionSummary('  Feeling  part\nof the garden. ')).toBe('Feeling part of the garden.');
    const long = 'word '.repeat(60);
    const s = definitionSummary(long, 50);
    expect(s.endsWith('word…')).toBe(true);
    expect(s.length).toBeLessThanOrEqual(51);
  });
});

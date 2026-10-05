import { describe, expect, it } from 'vitest';
import type { Attribute, Coding } from '../../core/model/types';
import {
  activeFilterCount, clearedFilter, coreSort, DEFAULT_FILTER, describeFilter, type FilterState, filterForCodes, isCompleteCondition, type KnownIds, matchText,
  parseFilter, serializeFilter, toggleId, toSegmentFilter,
} from './filter';

const known: KnownIds = {
  codes: new Set(['a', 'b', 'c']),
  documents: new Set(['d1', 'd2']),
  groups: new Set(['g1']),
  cases: new Set(['k1']),
  coders: new Set(['me', 'rui']),
  attributes: new Set(['age', 'member']),
};

const attr = (id: string, type: Attribute['type']): Attribute => ({
  id, type, name: id, options: [], description: '', order: 0, created_at: '', updated_at_hlc: '', deleted: false,
});

const coding = (id: string, text: string): Coding => ({
  id, text, document_id: 'd1', code_id: 'a', coder_id: 'me', start: 0, end: text.length, comment: '', created_at: '', updated_at_hlc: '', deleted: false,
});

describe('toSegmentFilter', () => {
  it('puts no constraint when nothing is ticked', () => {
    expect(toSegmentFilter(DEFAULT_FILTER, known)).toEqual({});
  });

  it('keeps only ids that still exist, and drops a list left empty', () => {
    const f: FilterState = { ...DEFAULT_FILTER, codeIds: ['a', 'gone'], documentIds: ['gone'], coderIds: ['rui'] };
    expect(toSegmentFilter(f, known)).toEqual({ codeIds: ['a'], includeChildren: true, coderIds: ['rui'] });
  });

  it('applies complete attribute conditions only, typed by attribute', () => {
    const f: FilterState = {
      ...DEFAULT_FILTER,
      attributeMatch: 'any',
      conditions: [
        { key: '1', attributeId: 'age', op: 'gt', value: ' 40 ' },
        { key: '2', attributeId: 'member', op: 'eq', value: 'true' },
        { key: '3', attributeId: 'age', op: 'eq', value: '' },
        { key: '4', attributeId: '', op: 'empty', value: '' },
        { key: '5', attributeId: 'age', op: 'empty', value: '' },
      ],
    };
    expect(toSegmentFilter(f, known, [attr('age', 'number'), attr('member', 'boolean')])).toEqual({
      attributeConditions: [
        { attributeId: 'age', op: 'gt', value: '40' },
        { attributeId: 'member', op: 'eq', value: true },
        { attributeId: 'age', op: 'empty', value: undefined },
      ],
      attributeMatch: 'any',
    });
  });

  it('adds co-location only when switched on with codes', () => {
    const off: FilterState = { ...DEFAULT_FILTER, overlap: { on: false, codeIds: ['b'], mode: 'within', includeChildren: false } };
    expect(toSegmentFilter(off, known).overlapWith).toBeUndefined();
    const noCodes: FilterState = { ...DEFAULT_FILTER, overlap: { on: true, codeIds: [], mode: 'within', includeChildren: false } };
    expect(toSegmentFilter(noCodes, known).overlapWith).toBeUndefined();
    const on: FilterState = { ...DEFAULT_FILTER, overlap: { on: true, codeIds: ['b', 'x'], mode: 'within', includeChildren: false } };
    expect(toSegmentFilter(on, known).overlapWith).toEqual({ codeIds: ['b'], mode: 'within', includeChildren: false });
  });
});

describe('parseFilter', () => {
  it('round-trips', () => {
    const f: FilterState = {
      ...DEFAULT_FILTER,
      codeIds: ['a'],
      text: 'garden',
      conditions: [{ key: 'k', attributeId: 'age', op: 'lt', value: '30' }],
      overlap: { on: true, codeIds: ['b'], mode: 'contains', includeChildren: false },
      sort: 'newest',
      context: 'sentence',
    };
    expect(parseFilter(serializeFilter(f))).toEqual(f);
  });

  it('falls back field by field on bad input', () => {
    expect(parseFilter(null)).toEqual(DEFAULT_FILTER);
    expect(parseFilter('not json')).toEqual(DEFAULT_FILTER);
    expect(parseFilter('42')).toEqual(DEFAULT_FILTER);
    const f = parseFilter(JSON.stringify({ codeIds: ['a', 3, 'a', ''], sort: 'weird', context: 'paragraph', conditions: [{ op: 'nope' }, null] }));
    expect(f.codeIds).toEqual(['a']);
    expect(f.sort).toBe('document');
    expect(f.context).toBe('paragraph');
    expect(f.conditions).toEqual([{ key: 'c0', attributeId: '', op: 'eq', value: '' }]);
    expect(f.overlap).toEqual(DEFAULT_FILTER.overlap);
  });
});

describe('helpers', () => {
  it('filterForCodes keeps sort and context only', () => {
    const base: FilterState = { ...DEFAULT_FILTER, documentIds: ['d1'], sort: 'code', context: 'paragraph' };
    expect(filterForCodes(['a', 'a', 'b'], base)).toEqual({ ...DEFAULT_FILTER, codeIds: ['a', 'b'], sort: 'code', context: 'paragraph' });
  });

  it('coreSort maps newest to created descending', () => {
    expect(coreSort('newest')).toEqual({ by: 'created', descending: true });
    expect(coreSort('code')).toEqual({ by: 'code', descending: false });
  });

  it('matchText needs every word, ignoring case and accents', () => {
    const list = [coding('1', 'O coração da horta'), coding('2', 'Nobody asked me'), coding('3', 'the HORTA is calm')];
    expect(matchText(list, 'horta').map((c) => c.id)).toEqual(['1', '3']);
    expect(matchText(list, 'coracao  HORTA').map((c) => c.id)).toEqual(['1']);
    expect(matchText(list, '   ')).toHaveLength(3);
  });

  it('counts active filter groups', () => {
    expect(activeFilterCount(DEFAULT_FILTER)).toBe(0);
    const f: FilterState = {
      ...DEFAULT_FILTER,
      codeIds: ['a'],
      documentIds: ['d1'],
      groupIds: ['g1'],
      text: ' x ',
      conditions: [{ key: '1', attributeId: 'age', op: 'eq', value: '' }],
      overlap: { on: true, codeIds: ['b'], mode: 'overlap', includeChildren: true },
    };
    expect(activeFilterCount(f, known)).toBe(4);
    expect(activeFilterCount({ ...f, codeIds: ['gone'] }, known)).toBe(3);
    expect(activeFilterCount(clearedFilter({ ...f, sort: 'length' }))).toBe(0);
    expect(clearedFilter({ ...f, sort: 'length' }).sort).toBe('length');
  });

  it('isCompleteCondition', () => {
    expect(isCompleteCondition({ key: '', attributeId: 'age', op: 'notEmpty', value: '' })).toBe(true);
    expect(isCompleteCondition({ key: '', attributeId: 'age', op: 'eq', value: ' ' })).toBe(false);
    expect(isCompleteCondition({ key: '', attributeId: 'zzz', op: 'eq', value: '1' }, known.attributes)).toBe(false);
  });

  it('toggleId', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
    const same = ['a'];
    expect(toggleId(same, 'a', true)).toBe(same);
  });
});

describe('describeFilter', () => {
  const names = {
    code: (id: string) => ({ a: 'Calm', b: 'Belonging' })[id],
    document: (id: string) => ({ d1: 'Interview 1' })[id],
    group: (id: string) => ({ g1: 'Interviews' })[id],
    case: (id: string) => ({ k1: 'Amina' })[id],
    coder: (id: string) => ({ me: 'Ana' })[id],
    attribute: (id: string) => ({ age: 'Age' })[id],
  };
  const labels = {
    all: 'All',
    codes: (l: string) => `Codes: ${l}`,
    codesWithChildren: (l: string) => `Codes+: ${l}`,
    documents: (l: string) => `Docs: ${l}`,
    groups: (l: string) => `Groups: ${l}`,
    cases: (l: string) => `Cases: ${l}`,
    conditions: (m: string, l: string) => `Cond (${m}): ${l}`,
    coders: (l: string) => `Coders: ${l}`,
    text: (q: string) => `Text: ${q}`,
    colocation: (m: string, l: string) => `Co: ${m} ${l}`,
    condition: (a: string, op: string, v: string) => `${a} ${op} ${v}`.trim(),
  };

  it('says "all" without filters', () => {
    expect(describeFilter(DEFAULT_FILTER, names, labels)).toEqual(['All']);
  });

  it('one line per narrowing, skipping unknown ids', () => {
    const f: FilterState = {
      ...DEFAULT_FILTER,
      codeIds: ['a', 'zzz'],
      includeChildren: false,
      documentIds: ['d1'],
      groupIds: ['g1'],
      caseIds: ['k1'],
      coderIds: ['me'],
      text: ' quiet ',
      conditions: [{ key: '1', attributeId: 'age', op: 'gt', value: '40' }, { key: '2', attributeId: 'age', op: 'eq', value: '' }],
      overlap: { on: true, codeIds: ['b'], mode: 'within', includeChildren: true },
    };
    expect(describeFilter(f, names, labels)).toEqual([
      'Codes: Calm', 'Groups: Interviews', 'Docs: Interview 1', 'Cases: Amina', 'Cond (all): Age gt 40', 'Coders: Ana', 'Text: quiet', 'Co: within Belonging',
    ]);
  });
});

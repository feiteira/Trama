import { describe, expect, it } from 'vitest';
import { attributeBuckets, attributeValue, foldValue, isEmptyValue, meetsCondition, toBoolean, toNumber } from './attributes';
import { codeAttributeCrosstab } from './crosstab';
import { attribute, coding, doc, kase, treeOf } from './fixtures';

const age = attribute('age', 'number');
const cases = [
  kase('c1', { age: 25 }),
  kase('c2', { age: '34' }),
  kase('c3', { age: 61 }),
  kase('c4', { age: 70 }),
  kase('c5', {}),
  kase('c6', { age: 30 }), // no documents
  kase('c7', { age: 99 }, { deleted: true }),
];
const documents = [
  doc('d1', 10, { case_id: 'c1' }),
  doc('d2', 10, { case_id: 'c2' }),
  doc('d3', 10, { case_id: 'c3' }),
  doc('d4', 10, { case_id: 'c4' }),
  doc('d5', 10, { case_id: 'c5' }),
  doc('d6', 10),
  doc('d7', 10, { case_id: 'c1' }),
  doc('d8', 10, { case_id: 'c7' }), // its case is deleted → no value
];
const cs = [
  coding('d1', 'X', 0, 1),
  coding('d1', 'X', 2, 3),
  coding('d7', 'X', 0, 1),
  coding('d3', 'X', 0, 1),
  coding('d2', 'Y', 0, 1),
  coding('d5', 'Y', 0, 1),
  coding('d6', 'Y', 0, 1),
  coding('d6', 'Y', 4, 5, { deleted: true }),
];

describe('codeAttributeCrosstab', () => {
  it('buckets distinct numeric values and counts segments', () => {
    const t = codeAttributeCrosstab(cs, ['X', 'Y'], documents, cases, age, { measure: 'segments' });
    expect(t.buckets.map((b) => b.label)).toEqual(['25', '30', '34', '61', '70', '(no value)']);
    expect(t.counts).toEqual([[3, 0, 0, 1, 0, 0], [0, 0, 1, 0, 0, 2]]);
    expect(t.rowTotals).toEqual([4, 3]);
    expect(t.colTotals).toEqual([3, 0, 1, 1, 0, 2]);
    expect(t.grandTotal).toBe(7);
    expect(t.bases).toEqual([2, 0, 1, 1, 1, 3]); // documents per bucket
    expect(t.percents).toBeNull();
    expect(t.tests).toEqual([null, null]);
  });

  it('counts documents and cases', () => {
    const d = codeAttributeCrosstab(cs, ['X', 'Y'], documents, cases, age, { measure: 'documents' });
    expect(d.counts).toEqual([[2, 0, 0, 1, 0, 0], [0, 0, 1, 0, 0, 2]]);
    const c = codeAttributeCrosstab(cs, ['X', 'Y'], documents, cases, age, { measure: 'cases' });
    // d6 has no case: left out of the cases measure.
    expect(c.counts).toEqual([[1, 0, 0, 1, 0, 0], [0, 0, 1, 0, 0, 1]]);
    // Cases with at least one document; c6 (age 30) has none.
    expect(c.bases).toEqual([1, 0, 1, 1, 1, 1]);
    expect(c.rowTotals).toEqual([2, 2]);
  });

  it('computes row and column percentages', () => {
    const r = codeAttributeCrosstab(cs, ['X', 'Y'], documents, cases, age, { measure: 'segments', percent: 'row' });
    expect(r.percents![0]).toEqual([75, 0, 0, 25, 0, 0]);
    const c = codeAttributeCrosstab(cs, ['X', 'Y'], documents, cases, age, { measure: 'documents', percent: 'column' });
    // Share of the bucket's documents: 25 → 2 of 2; 30 → no documents (null); no value → 2 of 3.
    expect(c.percents![0]).toEqual([100, null, 0, 100, 0, 0]);
    expect(c.percents![1]![5]).toBeCloseTo(200 / 3, 12);
    const s = codeAttributeCrosstab(cs, ['X', 'Y'], documents, cases, age, { measure: 'segments', percent: 'column' });
    expect(s.percents![0]).toEqual([100, null, 0, 100, null, 0]);
  });

  it('uses quantile bins and user ranges for numbers', () => {
    const q = codeAttributeCrosstab(cs, ['X'], documents, cases, age, { measure: 'segments', bins: { kind: 'quantile', count: 2 } });
    expect(q.buckets.map((b) => b.label)).toEqual(['25–30', '34–70', '(no value)']);
    expect(q.counts).toEqual([[3, 1, 0]]);
    const r = codeAttributeCrosstab(cs, ['X'], documents, cases, age, {
      measure: 'segments',
      bins: { kind: 'ranges', ranges: [{ max: 40 }, { min: 40, max: 65, label: 'middle' }] },
    });
    expect(r.buckets.map((b) => b.label)).toEqual(['< 40', 'middle', '(other)', '(no value)']);
    expect(r.counts).toEqual([[3, 1, 0, 0]]);
  });

  it('runs a chi-square test per code for documents and cases', () => {
    const t = codeAttributeCrosstab(cs, ['X', 'Y'], documents, cases, age, { measure: 'documents' });
    // X with/without over buckets 25, 34, 61, 70 (30 has no documents and drops out).
    expect(t.tests[0]!.df).toBe(3);
    expect(t.tests[0]!.n).toBe(5);
    expect(t.tests[0]!.p).toBeGreaterThan(0);
  });

  it('aggregates children and counts a shared segment once in column totals', () => {
    const t = codeAttributeCrosstab(cs, ['P', 'X'], documents, cases, age, { measure: 'segments', includeChildren: true, descendants: treeOf({ X: 'P' }) });
    expect(t.counts[0]).toEqual(t.counts[1]);
    expect(t.colTotals[0]).toBe(3);
  });

  it('handles boolean, choice and text attributes', () => {
    const cs2 = [coding('a', 'X', 0, 1), coding('b', 'X', 0, 1), coding('c', 'X', 0, 1)];
    const docs2 = [doc('a', 1, { case_id: 'k1' }), doc('b', 1, { case_id: 'k2' }), doc('c', 1, { case_id: 'k3' })];
    const cases2 = [kase('k1', { u: 'sim', s: 'Porto', lvl: 'high' }), kase('k2', { u: false, s: ' porto', lvl: 'Low' }), kase('k3', { u: 'maybe', s: 'Évora', lvl: 'odd' })];
    const b = codeAttributeCrosstab(cs2, ['X'], docs2, cases2, attribute('u', 'boolean'), { measure: 'documents' });
    expect(b.buckets.map((x) => x.key)).toEqual(['v:true', 'v:false', 'other', 'empty']);
    expect(b.counts).toEqual([[1, 1, 1, 0]]);
    const s = codeAttributeCrosstab(cs2, ['X'], docs2, cases2, attribute('s', 'text'), { measure: 'documents' });
    expect(s.buckets.map((x) => x.label)).toEqual(['Évora', 'Porto', '(no value)']);
    expect(s.counts).toEqual([[1, 2, 0]]);
    const c = codeAttributeCrosstab(cs2, ['X'], docs2, cases2, attribute('lvl', 'choice', ['Low', 'High']), { measure: 'documents' });
    expect(c.buckets.map((x) => x.label)).toEqual(['Low', 'High', 'odd', '(no value)']);
    expect(c.counts).toEqual([[1, 1, 1, 0]]);
  });

  it('handles no codings and no cases', () => {
    const t = codeAttributeCrosstab([], ['X'], [], [], age, { measure: 'cases', percent: 'row' });
    expect(t.buckets.map((b) => b.kind)).toEqual(['empty']);
    expect(t.counts).toEqual([[0]]);
    expect(t.percents).toEqual([[null]]);
    expect(t.tests).toEqual([null]);
  });
});

describe('attribute values', () => {
  it('coerces numbers and booleans', () => {
    expect(toNumber('3,5')).toBe(3.5);
    expect(toNumber(' -2 ')).toBe(-2);
    expect(toNumber('.5')).toBe(0.5);
    expect(toNumber('12 years')).toBeNaN();
    expect(toNumber(null)).toBeNaN();
    expect(toBoolean('Sí')).toBe(true);
    expect(toBoolean('não')).toBe(false);
    expect(toBoolean('perhaps')).toBeNull();
    expect(toBoolean(1)).toBe(true);
    expect(isEmptyValue('  ')).toBe(true);
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue(false)).toBe(false);
    expect(foldValue('  Évora   Sul ')).toBe('evora sul');
    expect(attributeValue(kase('k', { a: ' ' }), 'a')).toBeNull();
    expect(attributeValue(null, 'a')).toBeNull();
  });

  it('meets conditions by type', () => {
    const date = attribute('d', 'date');
    expect(meetsCondition('2024-03-01', { attributeId: 'd', op: 'lt', value: '2024-12-31' }, date)).toBe(true);
    expect(meetsCondition('2024-03-01', { attributeId: 'd', op: 'gt', value: '2024-12-31' }, date)).toBe(false);
    const lvl = attribute('l', 'choice', ['Low', 'Mid', 'High']);
    expect(meetsCondition('High', { attributeId: 'l', op: 'gt', value: 'mid' }, lvl)).toBe(true);
    expect(meetsCondition('Low', { attributeId: 'l', op: 'gt', value: 'Mid' }, lvl)).toBe(false);
    expect(meetsCondition(null, { attributeId: 'l', op: 'lt', value: 'Mid' }, lvl)).toBe(false);
    expect(meetsCondition(null, { attributeId: 'l', op: 'neq', value: 'Mid' }, lvl)).toBe(true);
    expect(meetsCondition(42, { attributeId: 'x', op: 'contains', value: '4' })).toBe(true);
    expect(meetsCondition(true, { attributeId: 'x', op: 'contains', value: 'yes' }, attribute('x', 'boolean'))).toBe(true);
    expect(meetsCondition('abc', { attributeId: 'x', op: 'contains', value: '' })).toBe(false);
    expect(meetsCondition('10', { attributeId: 'x', op: 'gt', value: 9 })).toBe(true); // inferred numeric
    expect(meetsCondition('abc', { attributeId: 'x', op: 'gt', value: 9 }, attribute('x', 'number'))).toBe(false);
    expect(meetsCondition(undefined, { attributeId: 'x', op: 'empty' })).toBe(true);
  });

  it('orders date buckets chronologically and adds unseen values lazily as "(other)"', () => {
    const d = attribute('d', 'date');
    const b = attributeBuckets([kase('a', { d: '2024-05-01' }), kase('b', { d: '2023-01-09' })], d);
    expect(b.buckets.map((x) => x.label)).toEqual(['2023-01-09', '2024-05-01', '(no value)']);
    expect(b.keyOf('2030-01-01')).toBe('other');
    expect(b.buckets.map((x) => x.kind)).toEqual(['value', 'value', 'other', 'empty']);
    expect(b.keyOf(null)).toBe('empty');
  });

  it('puts unparseable numbers in "(other)"', () => {
    const b = attributeBuckets([kase('a', { n: 'n/a' }), kase('b', { n: 3 })], attribute('n', 'number'));
    expect(b.buckets.map((x) => x.label)).toEqual(['3', '(other)', '(no value)']);
    expect(b.keyOf('n/a')).toBe('other');
    expect(b.keyOf('3')).toBe('v:3');
  });
});

import { describe, expect, it } from 'vitest';
import type { Attribute, Case } from '../../core/model/types';
import {
  buildRows, editText, exportTable, filterRows, formatValue, lostOnTypeChange, nextName, nextSort, parseInput, parseOptions, safeFileName, sortRows,
  type CaseRow,
} from './values';

const base = { created_at: '2026-01-01T00:00:00.000Z', updated_at_hlc: '0', deleted: false };
const attr = (id: string, type: Attribute['type'], options: string[] = []): Attribute => ({ ...base, id, name: id.toUpperCase(), type, options, description: '', order: 0 });
const kase = (id: string, name: string, values: Case['values'] = {}, description = ''): Case => ({ ...base, id, name, description, values, color: null });

const en = { bcp47: 'en-GB', yes: 'Yes', no: 'No' };
const pt = { bcp47: 'pt-PT', yes: 'Sim', no: 'Não' };

describe('formatValue / editText / parseInput', () => {
  it('shows numbers, dates and booleans in the reader’s language', () => {
    expect(formatValue('number', 1234.5, en)).toBe('1,234.5');
    expect(formatValue('number', 1234.5, pt)).toMatch(/^1\s?234,5$/);
    expect(formatValue('date', '2026-03-09', en)).toBe('9 Mar 2026');
    expect(formatValue('boolean', true, pt)).toBe('Sim');
    expect(formatValue('boolean', false, en)).toBe('No');
    expect(formatValue('text', null, en)).toBe('');
    expect(formatValue('choice', 'Nurse', en)).toBe('Nurse');
  });

  it('starts editors with the decimal mark of the reader and no grouping', () => {
    expect(editText('number', 1234.5, 'pt-PT')).toBe('1234,5');
    expect(editText('number', 1234.5, 'en-GB')).toBe('1234.5');
    expect(editText('date', '2026-03-09', 'en-GB')).toBe('2026-03-09');
    expect(editText('text', undefined, 'en-GB')).toBe('');
  });

  it('parses what was typed back, refusing what does not fit the type', () => {
    expect(parseInput('number', '1234,5')).toEqual({ ok: true, value: 1234.5 });
    expect(parseInput('number', 'many')).toEqual({ ok: false });
    expect(parseInput('date', '2026-02-30')).toEqual({ ok: false });
    expect(parseInput('boolean', 'sim')).toEqual({ ok: true, value: true });
    expect(parseInput('text', '  ')).toEqual({ ok: true, value: null });
  });
});

describe('rows', () => {
  const age = attr('age', 'number');
  const role = attr('role', 'choice', ['Nurse', 'Doctor']);
  const cases = [kase('a', 'Ana', { age: 41, role: 'Nurse' }), kase('b', 'bruno', { age: 29 }), kase('c', 'Carla', { role: 'Doctor' }, 'night shift')];
  const docs = [
    { id: 'd1', name: 'Interview Ana', case_id: 'a', codings: 5 },
    { id: 'd2', name: 'Follow-up Ana', case_id: 'a', codings: 2 },
    { id: 'd3', name: 'Interview Carla', case_id: 'c', codings: 7 },
    { id: 'd4', name: 'Notes', case_id: null, codings: 1 },
  ];
  const rows = buildRows(cases, docs);
  const names = (rs: CaseRow[]) => rs.map((r) => r.case.name);

  it('collects each case’s documents and coded segments', () => {
    expect(rows[0]!.documents.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(rows[0]!.codings).toBe(7);
    expect(rows[1]!.documents).toEqual([]);
    expect(rows[1]!.codings).toBe(0);
  });

  it('sorts by name, counts and typed values, empty values last', () => {
    expect(names(sortRows(rows, null, [age], 'en'))).toEqual(['Ana', 'bruno', 'Carla']);
    expect(names(sortRows(rows, { key: { kind: 'name' }, dir: 'desc' }, [], 'en'))).toEqual(['Carla', 'bruno', 'Ana']);
    expect(names(sortRows(rows, { key: { kind: 'attr', id: 'age' }, dir: 'asc' }, [age], 'en'))).toEqual(['bruno', 'Ana', 'Carla']);
    expect(names(sortRows(rows, { key: { kind: 'attr', id: 'age' }, dir: 'desc' }, [age], 'en'))).toEqual(['Ana', 'bruno', 'Carla']);
    expect(names(sortRows(rows, { key: { kind: 'attr', id: 'role' }, dir: 'asc' }, [role], 'en'))).toEqual(['Carla', 'Ana', 'bruno']);
    expect(names(sortRows(rows, { key: { kind: 'codings' }, dir: 'desc' }, [], 'en'))).toEqual(['Ana', 'Carla', 'bruno']);
    expect(names(sortRows(rows, { key: { kind: 'documents' }, dir: 'asc' }, [], 'en'))).toEqual(['bruno', 'Carla', 'Ana']);
  });

  it('cycles a column’s sort: ascending, descending, none', () => {
    const k = { kind: 'codings' } as const;
    const s1 = nextSort(null, k);
    expect(s1).toEqual({ key: k, dir: 'asc' });
    const s2 = nextSort(s1, k);
    expect(s2?.dir).toBe('desc');
    expect(nextSort(s2, k)).toBeNull();
    expect(nextSort(s2, { kind: 'name' })).toEqual({ key: { kind: 'name' }, dir: 'asc' });
  });

  it('filters on names, descriptions, documents and shown values', () => {
    expect(names(filterRows(rows, 'follow', [age, role], en))).toEqual(['Ana']);
    expect(names(filterRows(rows, 'NIGHT', [age, role], en))).toEqual(['Carla']);
    expect(names(filterRows(rows, 'doctor carla', [age, role], en))).toEqual(['Carla']);
    expect(names(filterRows(rows, '29', [age, role], en))).toEqual(['bruno']);
    expect(filterRows(rows, '  ', [age], en)).toHaveLength(3);
  });

  it('exports one row per case with typed values', () => {
    const table = exportTable(rows, [age, role], { case: 'Case', description: 'Description', documents: 'Documents', codings: 'Coded segments' });
    expect(table[0]).toEqual(['Case', 'Description', 'Documents', 'AGE', 'ROLE', 'Coded segments']);
    expect(table[1]).toEqual(['Ana', '', 'Interview Ana; Follow-up Ana', 41, 'Nurse', 7]);
    expect(table[2]).toEqual(['bruno', '', '', 29, null, 0]);
  });
});

describe('attribute helpers', () => {
  it('counts the values a type change would clear', () => {
    const a = attr('x', 'text');
    const cases = [kase('1', 'A', { x: '12' }), kase('2', 'B', { x: 'twelve' }), kase('3', 'C', {})];
    expect(lostOnTypeChange(a, 'number', cases)).toBe(1);
    expect(lostOnTypeChange(a, 'date', cases)).toBe(2);
    expect(lostOnTypeChange(a, 'choice', cases)).toBe(0);
    expect(lostOnTypeChange(a, 'text', cases)).toBe(0);
  });

  it('reads options one per line', () => {
    expect(parseOptions(' Nurse \n\ndoctor\nNURSE\n  Porter  ')).toEqual(['Nurse', 'doctor', 'Porter']);
  });

  it('finds a free name and a safe file name', () => {
    expect(nextName((n) => `Case ${n}`, ['Case 1', 'case 2'])).toBe('Case 3');
    expect(safeFileName('Hortas: 2026/27?', 'cases')).toBe('Hortas 2026 27');
    expect(safeFileName('???', 'cases')).toBe('cases');
  });
});

describe('stabilise', () => {
  it('keeps unchanged rows and replaces changed ones', async () => {
    const { stabilise } = await import('./values');
    const a = kase('a', 'Ana');
    const b = kase('b', 'Bruno');
    const first = buildRows([a, b], [{ id: 'd1', name: 'I1', case_id: 'a', codings: 1 }]);
    const prev = new Map(first.map((r) => [r.case.id, r]));
    const again = stabilise(prev, buildRows([{ ...a }, { ...b, updated_at_hlc: '1' }], [{ id: 'd1', name: 'I1', case_id: 'a', codings: 1 }]));
    expect(again[0]).toBe(first[0]);
    expect(again[1]).not.toBe(first[1]);
    const more = stabilise(prev, buildRows([a, b], [{ id: 'd1', name: 'I1', case_id: 'a', codings: 2 }]));
    expect(more[0]).not.toBe(first[0]);
  });
});

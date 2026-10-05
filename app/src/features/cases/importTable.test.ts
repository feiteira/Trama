import { describe, expect, it } from 'vitest';
import type { Attribute } from '../../core/model/types';
import { countMatches, guessNameColumn, planColumns, tableToImport } from './importTable';

const attr = (id: string, name: string, type: Attribute['type']): Attribute => ({ id, name, type, options: [], description: '', order: 0, created_at: '', updated_at_hlc: '', deleted: false });

const headers = ['Age', 'Participante', 'Role', 'Start'];
const rows = [
  ['41', 'Ana', 'Nurse', '2026-01-02'],
  ['29', 'Bruno', 'Doctor', '2026-02-03'],
  ['35', 'Zé', 'Nurse', ''],
];

describe('guessNameColumn', () => {
  it('prefers the column matching existing cases', () => {
    expect(guessNameColumn(headers, rows, ['ana', 'BRUNO'])).toBe(1);
  });
  it('falls back to a header that names cases, then the first column', () => {
    expect(guessNameColumn(headers, rows, [])).toBe(1);
    expect(guessNameColumn(['A', 'B'], [['1', '2']], [])).toBe(0);
    expect(guessNameColumn(['x', 'Nome'], [['1', '2']], ['nobody'])).toBe(1);
  });
});

describe('planColumns', () => {
  it('maps columns to existing attributes by name and infers new ones', () => {
    const plan = planColumns(headers, rows, 1, [attr('r', 'role', 'choice')]);
    expect(plan.map((p) => [p.index, p.kind, p.kind === 'new' ? p.type : p.attr.id])).toEqual([
      [0, 'new', 'number'],
      [2, 'existing', 'r'],
      [3, 'new', 'date'],
    ]);
  });
});

describe('tableToImport', () => {
  it('puts the name column first and keeps only the chosen columns', () => {
    expect(tableToImport(headers, rows.slice(0, 1), 1, [3, 0])).toEqual({
      rows: [
        ['Participante', 'Start', 'Age'],
        ['Ana', '2026-01-02', '41'],
      ],
      nameColumn: 0,
    });
  });
});

describe('countMatches', () => {
  it('counts distinct names that match or are missing', () => {
    expect(countMatches([...rows, ['1', 'ana', '', '']], 1, ['Ana'])).toEqual({ matched: 1, missing: 2 });
  });
});

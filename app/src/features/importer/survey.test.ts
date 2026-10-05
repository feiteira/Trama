import { describe, expect, it } from 'vitest';
import type { ImportedTable } from '../../core/import';
import { defaultMapping, mappingProblem, makesCases, setRole, surveyCount, surveyDefaults, toSurveyOptions } from './survey';

const long = (i: number) => `I come to the garden because it gives me a reason to talk to my neighbours, number ${i}.`;

const table: ImportedTable = {
  name: 'Survey',
  headers: ['Timestamp', 'Respondent ID', 'Age', 'Neighbourhood', 'What does the garden mean to you?', 'Anything else?', 'Email address', 'Empty'],
  rows: Array.from({ length: 20 }, (_, i) => [
    `2026/05/0${(i % 9) + 1} 10:0${i % 10}`,
    `R${String(i + 1).padStart(2, '0')}`,
    String(20 + i),
    ['Northbank', 'Kiln Hill', 'Mulberry Vale'][i % 3]!,
    long(i),
    i % 2 ? `Short note ${i} about the plots` : '',
    `p${i}@example.org`,
    '',
  ]),
};

describe('surveyDefaults', () => {
  it('guesses id, answers and attributes, leaving out timestamps, emails and empty columns', () => {
    expect(surveyDefaults(table)).toEqual(['ignore', 'id', 'attribute', 'attribute', 'text', 'text', 'ignore', 'ignore']);
  });

  it('recognises id headers in Portuguese and Spanish, only when the values are unique', () => {
    const t = (h: string, vals: string[]): ImportedTable => ({ name: 's', headers: [h, 'Resposta'], rows: vals.map((v, i) => [v, long(i)]) });
    expect(surveyDefaults(t('Código', ['P1', 'P2']))[0]).toBe('id');
    expect(surveyDefaults(t('Nº', ['1', '2']))[0]).toBe('id');
    expect(surveyDefaults(t('Participante', ['A', 'A']))[0]).toBe('attribute');
    expect(surveyDefaults(t('Grupo', ['A', 'B']))[0]).toBe('attribute');
  });
});

describe('mapping', () => {
  it('keeps one id column', () => {
    expect(setRole(['id', 'text', 'attribute'], 2, 'id')).toEqual(['ignore', 'text', 'id']);
    expect(setRole(['id', 'text'], 1, 'attribute')).toEqual(['id', 'attribute']);
  });

  it('turns roles into survey options', () => {
    const m = defaultMapping(table);
    expect(toSurveyOptions(m)).toEqual({ idColumn: 1, textColumns: [4, 5], attributeColumns: [2, 3], layout: 'one-per-respondent' });
    expect(toSurveyOptions({ ...m, roles: ['text'] }).idColumn).toBeNull();
  });

  it('needs an answer column and rows', () => {
    expect(mappingProblem(table, { ...defaultMapping(table), roles: table.headers.map(() => 'attribute' as const) })).toBe('noText');
    expect(mappingProblem({ ...table, rows: [] }, defaultMapping(table))).toBe('noRows');
    expect(mappingProblem(table, defaultMapping(table))).toBeNull();
  });

  it('counts documents, cases and answers', () => {
    const m = defaultMapping(table);
    expect(surveyCount(table, m)).toEqual({ documents: 20, cases: 20, answers: 30 });
    expect(surveyCount(table, { ...m, layout: 'one-per-question' })).toEqual({ documents: 2, cases: 0, answers: 30 });
    expect(makesCases({ ...m, createCases: false })).toBe(false);
  });
});

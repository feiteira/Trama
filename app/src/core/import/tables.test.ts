import { readFileSync } from 'node:fs';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { columnLetter, detectDelimiter, parseCsv, rowsToTable, tidyHeaders } from './csv';
import { surveyToDocuments } from './survey';
import { decodeText } from './text';
import type { ImportedTable } from './types';
import { formatKind, formatNumber, listXlsxSheets, readXlsx, serialToText } from './xlsx';

const bytes = (name: string) => new Uint8Array(readFileSync(new URL(`../../../test-fixtures/import/${name}`, import.meta.url)));

describe('parseCsv', () => {
  it('reads semicolons, a BOM, quoted delimiters and quoted newlines', () => {
    expect(parseCsv(decodeText(bytes('survey-semicolon.csv')), 'inquérito')).toEqual({
      name: 'inquérito',
      headers: ['ID', 'Idade', 'Comentário'],
      rows: [
        ['P01', '34', 'Gosto muito; mesmo, muito'],
        ['P02', '41,5', 'Duas\nlinhas'],
      ],
      warnings: [],
    });
  });

  it('reads commas with escaped quotes and empty cells', () => {
    expect(parseCsv(decodeText(bytes('survey-comma.csv')), 's').rows).toEqual([
      ['R1', '30', 'Hello, "world"'],
      ['R2', '', ''],
    ]);
  });

  it('honours an Excel "sep=" line', () => {
    const t = parseCsv(decodeText(bytes('survey-excel-sep.csv')), 's');
    expect(t.headers).toEqual(['Nome', 'Opinião']);
    expect(t.rows).toEqual([['Ana', '\u{201c}Boa\u{201d}']]);
  });

  it('detects the delimiter from consistent splits, header included', () => {
    expect(detectDelimiter('Nome;Nota\nAna;1,5\nRui;2,5')).toBe(';');
    expect(detectDelimiter('a,b,c\n1,2,3\n4,5,6')).toBe(',');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(detectDelimiter('a|b|c\n1|2|3')).toBe('|');
    expect(detectDelimiter('"x;y",b\n"1;2",3')).toBe(',');
    expect(detectDelimiter('uma só coluna\nvalor')).toBe(',');
  });

  it('names empty headers by column letter, numbers duplicates and pads rows', () => {
    const t = parseCsv('Nome,,Nome\nAna,1,2,extra\nRui\n', 's');
    expect(t.headers).toEqual(['Nome', 'B', 'Nome (2)', 'D']);
    expect(t.rows).toEqual([
      ['Ana', '1', '2', 'extra'],
      ['Rui', '', '', ''],
    ]);
    expect(t.warnings).toEqual(['table.raggedRows:2']);
  });

  it('skips blank lines, canonicalises cells and handles empty input', () => {
    expect(parseCsv('\r\n a ; b \r\n\r\n ;  \r\nx\u{301};y\r\n', 's')).toMatchObject({ headers: ['a', 'b'], rows: [['x\u{301}'.normalize('NFC'), 'y']] });
    expect(parseCsv('', 's')).toEqual({ name: 's', headers: [], rows: [], warnings: [] });
  });

  it('parses a large file quickly', () => {
    const lines = ['id;idade;resposta'];
    for (let i = 0; i < 60_000; i++) lines.push(`R${i};${20 + (i % 50)};"Resposta número ${i}; com ponto e vírgula e acentuação"`);
    const t0 = performance.now();
    const t = parseCsv(lines.join('\r\n'), 'grande');
    expect(performance.now() - t0).toBeLessThan(5000); // guards against quadratic time, not a benchmark
    expect(t.rows).toHaveLength(60_000);
    expect(t.rows[59_999]![2]).toBe('Resposta número 59999; com ponto e vírgula e acentuação');
  });
});

describe('csv helpers', () => {
  it('column letters', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });
  it('tidyHeaders treats case-variants as duplicates', () => {
    expect(tidyHeaders(['Idade', 'idade ', ' '], 3)).toEqual(['Idade', 'idade (2)', 'C']);
  });
  it('rowsToTable drops empty rows before the header', () => {
    expect(rowsToTable('t', [[], ['', ''], ['h1', 'h2'], ['a', 'b']])).toMatchObject({ headers: ['h1', 'h2'], rows: [['a', 'b']] });
  });
});

describe('readXlsx', () => {
  it('reads the first sheet: shared, rich and inline strings, numbers, booleans, dates, errors, formulas', () => {
    const r = readXlsx(bytes('survey.xlsx'), 'inquérito');
    expect(r.sheets).toEqual([
      { name: 'Respostas', hidden: false },
      { name: 'Códigos', hidden: false },
    ]);
    expect(r.sheet).toBe(0);
    expect(r.table.headers).toEqual(['ID', 'Idade', 'Data', 'O que mais valoriza?', 'Ativo', 'Horas', 'Registo']);
    expect(r.table.rows).toEqual([
      ['P01', '34', '2024-01-15', 'A proximidade da família.', 'TRUE', '1.5', '2024-01-15 18:00'],
      ['P02', '0.3', '1900-02-29', 'Ter tempo', 'FALSE', '', 'P02x'],
      ['P03', '', '', 'Linha 1\nLinha 2 \u{2014} ação \u{1f600}', '', '', ''],
    ]);
    expect(r.table.warnings).toEqual([]);
  });

  it('reads another sheet by index or name and drops leading empty columns', () => {
    const byName = readXlsx(bytes('survey.xlsx'), 'x', { sheet: 'Códigos' });
    expect(byName.sheet).toBe(1);
    expect(byName.table.headers).toEqual(['Código', 'Definição']);
    expect(byName.table.rows).toEqual([['Família', 'Laços familiares']]);
    expect(readXlsx(bytes('survey.xlsx'), 'x', { sheet: 1 }).table).toEqual(byName.table);
    expect(listXlsxSheets(bytes('survey.xlsx')).map((s) => s.name)).toEqual(['Respostas', 'Códigos']);
  });

  it('skips hidden sheets by default, reports formulas without a value, reads percentages and 1904 dates', () => {
    const files = unzipSync(bytes('survey.xlsx'));
    const dec = (n: string) => new TextDecoder().decode(files[n]);
    files['xl/workbook.xml'] = strToU8(dec('xl/workbook.xml').replace('<workbookPr/>', '<workbookPr date1904="1"/>').replace('name="Respostas"', 'name="Respostas" state="hidden"'));
    files['xl/styles.xml'] = strToU8(dec('xl/styles.xml').replace('<xf numFmtId="22" applyNumberFormat="1"/>', '<xf numFmtId="22" applyNumberFormat="1"/><xf numFmtId="10"/>').replace('count="5"', 'count="6"'));
    files['xl/worksheets/sheet2.xml'] = strToU8(
      dec('xl/worksheets/sheet2.xml').replace(
        '</sheetData>',
        '<row r="3"><c r="B3"><f>1+1</f></c><c r="C3" s="1"><v>0</v></c><c r="D3" s="5"><v>0.125</v></c></row></sheetData>',
      ),
    );
    const r = readXlsx(zipSync(files), 'x');
    expect(r.sheet).toBe(1);
    expect(r.table.headers).toEqual(['Código', 'Definição', 'D']); // named after its spreadsheet column
    expect(r.table.rows[1]).toEqual(['', '1904-01-01', '12.5%']);
    expect(r.table.warnings).toEqual(['xlsx.formulasWithoutValue:1']);
  });

  it('reports damaged workbooks', () => {
    expect(() => readXlsx(new Uint8Array([0x50, 0x4b, 3, 4, 0]), 'x')).toThrow(expect.objectContaining({ code: 'DAMAGED' }));
    expect(() => readXlsx(zipSync({ 'a.xml': strToU8('<a/>') }), 'x')).toThrow(expect.objectContaining({ code: 'DAMAGED' }));
    expect(() => readXlsx(bytes('survey.xlsx'), 'x', { sheet: 'Não existe' })).toThrow(expect.objectContaining({ code: 'DAMAGED' }));
  });
});

describe('xlsx number formats', () => {
  it('recognises dates, times and durations in custom formats', () => {
    expect(formatKind('dd/mm/yyyy')).toBe('date');
    expect(formatKind('[$-816]d" de "mmmm" de "yyyy;@')).toBe('date');
    expect(formatKind('yyyy-mm-dd hh:mm')).toBe('datetime');
    expect(formatKind('hh:mm:ss')).toBe('time');
    expect(formatKind('[h]:mm:ss')).toBe('duration');
    expect(formatKind('mmm-yy')).toBe('date');
    expect(formatKind('0.00"h"')).toBeNull();
    expect(formatKind('#,##0.00 "dias"')).toBeNull();
    expect(formatKind('General')).toBeNull();
    expect(formatKind('[Red]0.00')).toBeNull();
    expect(formatKind('0.00\\d')).toBeNull();
  });

  it('converts serial numbers in both date systems', () => {
    expect(serialToText(45306, 'date', false, false)).toBe('2024-01-15');
    expect(serialToText(1, 'date', false, false)).toBe('1900-01-01');
    expect(serialToText(59, 'date', false, false)).toBe('1900-02-28');
    expect(serialToText(61, 'date', false, false)).toBe('1900-03-01');
    expect(serialToText(0, 'date', true, false)).toBe('1904-01-01');
    expect(serialToText(45306.5, 'datetime', false, true)).toBe('2024-01-15 12:00:00');
    expect(serialToText(0.99999999, 'time', false, false)).toBe('00:00');
    expect(serialToText(0.75, 'time', false, true)).toBe('18:00:00');
    expect(serialToText(1.5, 'duration', false, true)).toBe('36:00:00');
  });

  it('prints numbers without floating-point noise', () => {
    expect(formatNumber('0.30000000000000004')).toBe('0.3');
    expect(formatNumber('42')).toBe('42');
    expect(formatNumber('-1.5E-3')).toBe('-0.0015');
    expect(formatNumber('1E+22')).toBe('1e+22');
    expect(formatNumber('abc')).toBe('abc');
  });
});

describe('surveyToDocuments', () => {
  const table: ImportedTable = {
    name: 'Inquérito',
    headers: ['ID', 'Idade', 'O que valoriza?', 'O que mudaria?'],
    rows: [
      ['P01', '34', 'A família.', 'Os horários.\n\nE o salário.'],
      ['P02', '41', '', 'Nada 😀'],
      ['', '29', 'Tempo livre.', ''],
      ['P01', '50', '', ''],
    ],
    source: { filename: 'inquerito.xlsx', format: 'xlsx' },
  };

  it('makes one document per respondent with question headings and answer spans', () => {
    const r = surveyToDocuments(table, { idColumn: 0, textColumns: [2, 3], attributeColumns: [1] });
    expect(r.documents.map((d) => [d.name, d.text])).toEqual([
      ['P01', 'O que valoriza?\nA família.\nO que mudaria?\nOs horários.\nE o salário.'],
      ['P02', 'O que mudaria?\nNada 😀'],
      ['Inquérito 3', 'O que valoriza?\nTempo livre.'],
    ]);
    expect(r.documents[0]).toMatchObject({ kind: 'survey', sync: [], speakers: [], source: { filename: 'inquerito.xlsx', format: 'xlsx' } });
    for (const [k, spans] of r.questionSpans.entries()) {
      for (const s of spans) expect(r.documents[k]!.text.slice(s.start, s.end)).toBe(table.rows[s.row]![s.column]!.replace('\n\n', '\n'));
    }
    expect(r.questionSpans[0]!.map((s) => [s.question, s.start, s.end])).toEqual([
      ['O que valoriza?', 16, 26],
      ['O que mudaria?', 42, 67],
    ]);
    expect(r.cases).toEqual([
      { name: 'P01', values: { Idade: '34' } },
      { name: 'P02', values: { Idade: '41' } },
      { name: 'Inquérito 3', values: { Idade: '29' } },
      { name: 'P01 (2)', values: { Idade: '50' } },
    ]);
    expect(r.caseNames).toEqual(['P01', 'P02', 'Inquérito 3']);
  });

  it('makes one document per question with respondent headings', () => {
    const r = surveyToDocuments(table, { idColumn: 0, textColumns: [3, 2], attributeColumns: [], layout: 'one-per-question' });
    expect(r.documents.map((d) => [d.name, d.text])).toEqual([
      ['O que mudaria?', 'P01\nOs horários.\nE o salário.\nP02\nNada 😀'],
      ['O que valoriza?', 'P01\nA família.\nInquérito 3\nTempo livre.'],
    ]);
    expect(r.questionSpans[1]!.map((s) => [s.respondent, r.documents[1]!.text.slice(s.start, s.end)])).toEqual([
      ['P01', 'A família.'],
      ['Inquérito 3', 'Tempo livre.'],
    ]);
    expect(r.caseNames).toEqual([null, null]);
  });

  it('ignores invalid columns and handles no id column and empty tables', () => {
    const r = surveyToDocuments(table, { idColumn: 99, textColumns: [2, 2, -1, 50], attributeColumns: [7] });
    expect(r.documents.map((d) => d.name)).toEqual(['Inquérito 1', 'Inquérito 3']);
    expect(r.cases[0]).toEqual({ name: 'Inquérito 1', values: {} });
    expect(surveyToDocuments({ name: 't', headers: [], rows: [] }, { textColumns: [0], attributeColumns: [] })).toEqual({ documents: [], cases: [], questionSpans: [], caseNames: [] });
  });

  it('shortens long question headers used as document names', () => {
    const long: ImportedTable = { name: 't', headers: ['Q'.repeat(300)], rows: [['resposta']] };
    const r = surveyToDocuments(long, { textColumns: [0], attributeColumns: [], layout: 'one-per-question' });
    expect(r.documents[0]!.name.length).toBeLessThanOrEqual(200);
    expect(r.questionSpans[0]![0]!.question).toBe('Q'.repeat(300));
  });
});

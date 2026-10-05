import { describe, expect, it } from 'vitest';
import { importQdc, exportQdc } from '../../core/export/refi';
import { buildDocx } from '../../core/export/office';
import type { Code } from '../../core/model/types';
import { en } from '../../core/i18n/locales/en';
import { pt } from '../../core/i18n/locales/pt';
import { es } from '../../core/i18n/locales/es';
import { parseCsv } from '../../core/import/csv';
import { toCsv } from '../../core/export/office/csv';
import {
  codebookMarkdown,
  codebookReport,
  codebookTable,
  COLUMNS,
  importedFromQdc,
  parseCodebookTable,
  planCodebookMerge,
  safeFileName,
  splitPath,
  type CodebookEntry,
  type ExistingCode,
  type ImportedCode,
  type ReportLabels,
  type TableLabels,
} from './codebookIO';

const code = (id: string, name: string, over: Partial<Code> = {}): CodebookEntry['code'] => ({
  id,
  name,
  color: '#3a6ea5',
  codable: true,
  shortcut: null,
  description: '',
  inclusion: '',
  exclusion: '',
  example: '',
  ...over,
});

const ENTRIES: CodebookEntry[] = [
  { code: code('c', 'Community', { codable: false, color: '#d1495b' }), depth: 0, path: ['Community'], own: 0, total: 5, documents: 3 },
  {
    code: code('b', 'Belonging', { shortcut: 1, description: 'Feeling part of the garden.', inclusion: 'Talk of “our” garden.', exclusion: 'Plot rules.', example: '“It is our place.”' }),
    depth: 1,
    path: ['Community', 'Belonging'],
    own: 5,
    total: 5,
    documents: 3,
  },
];

const TABLE: TableLabels = {
  headers: { name: 'Name', path: 'Path', parent: 'Parent', colour: 'Colour', codable: 'Codable', shortcut: 'Shortcut', definition: 'Definition', inclusion: 'When to use', exclusion: 'When not to use', example: 'Example', segments: 'Coded segments', documents: 'Documents' },
  yes: 'yes',
  no: 'no',
};

const REPORT: ReportLabels = {
  title: 'Codebook',
  subtitle: 'Community gardens',
  definition: 'Definition',
  inclusion: 'When to use',
  exclusion: 'When not to use',
  example: 'Example',
  category: 'Category',
  usage: (e) => `${e.own} coded segments in ${e.documents} documents`,
  shortcut: (n) => `Shortcut ${n}`,
  empty: 'No codes.',
};

describe('export', () => {
  it('writes a table with paths and counts', () => {
    const rows = codebookTable(ENTRIES, TABLE);
    expect(rows[0]).toEqual(COLUMNS.map((c) => TABLE.headers[c]));
    expect(rows[2]).toEqual(['Belonging', 'Community > Belonging', 'Community', '#3a6ea5', 'yes', 1, 'Feeling part of the garden.', 'Talk of “our” garden.', 'Plot rules.', '“It is our place.”', 5, 3]);
    expect(rows[1]![4]).toBe('no');
  });

  it('writes Markdown with nested headings and criteria', () => {
    const md = codebookMarkdown(ENTRIES, REPORT);
    expect(md).toContain('# Codebook');
    expect(md).toContain('## Community');
    expect(md).toContain('### Belonging');
    expect(md).toContain('**When to use:** Talk of “our” garden.');
    expect(md).toContain('> “It is our place.”');
    expect(md).toContain('*5 coded segments in 3 documents · \\#3a6ea5 · Shortcut 1*');
  });

  it('builds a report the Word writer accepts', () => {
    const doc = codebookReport(ENTRIES, REPORT);
    expect(doc.blocks[0]).toMatchObject({ type: 'heading', level: 1 });
    expect(doc.blocks.some((b) => b.type === 'paragraph' && b.style === 'quote')).toBe(true);
    const bytes = buildDocx(doc);
    expect(bytes.length).toBeGreaterThan(1000);
    expect(codebookReport([], REPORT).blocks).toEqual([{ type: 'paragraph', text: 'No codes.' }]);
  });

  it('makes safe file names', () => {
    expect(safeFileName('Hortas: “2026” / wave 1')).toBe('Hortas “2026” wave 1');
    expect(safeFileName('   ')).toBe('codebook');
  });
});

describe('import', () => {
  it('reads back its own table in every interface language', () => {
    for (const cat of [en, pt, es]) {
      const h = cat.codes.io.headers;
      const labels: TableLabels = { headers: h, yes: cat.common.yes, no: cat.common.no };
      const csv = toCsv(codebookTable(ENTRIES, labels), { delimiter: ';' });
      const table = parseCsv(csv, 'codebook.csv');
      const res = parseCodebookTable(table.headers, table.rows);
      expect(res.problem).toBeNull();
      expect(res.codes.map((c) => c.path)).toEqual([['Community'], ['Community', 'Belonging']]);
      expect(res.codes[0]!.codable).toBe(false);
      expect(res.codes[1]).toMatchObject({ codable: true, description: 'Feeling part of the garden.', inclusion: 'Talk of “our” garden.', example: '“It is our place.”' });
    }
  });

  it('accepts a name + parent table, other programs’ headers, and odd colours', () => {
    const res = parseCodebookTable(
      ['Code', 'Parent code', 'Color', 'Description'],
      [
        ['Stress', 'Wellbeing', 'A1B2C3', 'Worry and pressure'],
        ['', 'x', '', ''],
        ['Wellbeing', '', '#abc', ''],
      ],
    );
    expect(res.skipped).toBe(1);
    expect(res.codes).toEqual([
      { path: ['Wellbeing', 'Stress'], color: '#a1b2c3', codable: null, description: 'Worry and pressure', inclusion: null, exclusion: null, example: null },
      { path: ['Wellbeing'], color: '#aabbcc', codable: null, description: null, inclusion: null, exclusion: null, example: null },
    ]);
    expect(splitPath(' A >B › C ')).toEqual(['A', 'B', 'C']);
  });

  it('refuses a table without a name column', () => {
    expect(parseCodebookTable(['Colour'], [['#ffffff']]).problem).toBe('noNameColumn');
    expect(parseCodebookTable(['Name'], [['']]).problem).toBe('empty');
  });

  it('reads codes from a .qdc file as paths', () => {
    const codes: Code[] = [
      { ...code('p', 'Place', { codable: false }), parent_id: null, order: 1, created_at: '', updated_at_hlc: '', deleted: false },
      { ...code('n', 'Nature', { description: 'Green things', inclusion: 'Trees' }), parent_id: 'p', order: 1, created_at: '', updated_at_hlc: '', deleted: false },
    ];
    const xml = exportQdc(codes, { origin: 'Trama 0.1.0' });
    const imported = importedFromQdc(importQdc(xml));
    expect(imported.map((c) => c.path)).toEqual([['Place'], ['Place', 'Nature']]);
    expect(imported[1]).toMatchObject({ codable: true, description: 'Green things', inclusion: 'Trees' });
    expect(imported[0]!.codable).toBe(false);
  });
});

describe('planCodebookMerge', () => {
  const existing: ExistingCode[] = [
    { id: 'w', path: ['Wellbeing'], code: { color: '#29a37a', codable: false, description: '', inclusion: '', exclusion: '', example: '' } },
    { id: 's', path: ['Wellbeing', 'Stress'], code: { color: '#5c946e', codable: true, description: 'Pressure', inclusion: '', exclusion: '', example: '' } },
    { id: 'p', path: ['Place'], code: { color: '#2b9eb3', codable: false, description: '', inclusion: '', exclusion: '', example: '' } },
    { id: 'n', path: ['Place', 'Nature'], code: { color: '#3fa34d', codable: true, description: '', inclusion: '', exclusion: '', example: '' } },
  ];
  const imp = (path: string[], over: Partial<ImportedCode> = {}): ImportedCode => ({ path, color: null, codable: null, description: null, inclusion: null, exclusion: null, example: null, ...over });

  it('matches by path (accents and case ignored) and fills only empty fields', () => {
    const plan = planCodebookMerge(existing, [imp(['wellbeing', 'STRESS'], { description: 'Worry', inclusion: 'Deadlines', color: '#000000' })], { overwrite: false });
    expect(plan.items).toEqual([{ path: ['Wellbeing', 'Stress'], status: 'update', existingId: 's', implicit: false, fields: { inclusion: 'Deadlines' } }]);
    expect(plan).toMatchObject({ created: 0, updated: 1, unchanged: 0 });
  });

  it('overwrites every value from the file when asked', () => {
    const plan = planCodebookMerge(existing, [imp(['Wellbeing', 'Stress'], { description: 'Worry', color: '#000000', codable: true })], { overwrite: true });
    expect(plan.items[0]!.fields).toEqual({ description: 'Worry', color: '#000000' });
  });

  it('creates new codes parents first, with missing parents', () => {
    const plan = planCodebookMerge(existing, [imp(['Food', 'Sharing', 'Seeds'], { color: '#8c6d46' }), imp(['Wellbeing', 'Grief'])], { overwrite: false });
    expect(plan.items.map((i) => [i.path.join('/'), i.status, i.implicit])).toEqual([
      ['Food', 'new', true],
      ['Wellbeing/Grief', 'new', false],
      ['Food/Sharing', 'new', true],
      ['Food/Sharing/Seeds', 'new', false],
    ]);
    expect(plan.created).toBe(4);
  });

  it('matches a unique name elsewhere in the tree, and its children follow', () => {
    const plan = planCodebookMerge(existing, [imp(['Nature'], { description: 'Plants' }), imp(['Nature', 'Birds'])], { overwrite: false });
    expect(plan.items.map((i) => [i.path.join('/'), i.status, i.existingId])).toEqual([
      ['Place/Nature', 'update', 'n'],
      ['Place/Nature/Birds', 'new', null],
    ]);
  });

  it('reports unchanged codes and ignores duplicates in the file', () => {
    const plan = planCodebookMerge(existing, [imp(['Wellbeing']), imp(['Wellbeing'], { description: 'x' })], { overwrite: false });
    expect(plan.items).toHaveLength(1);
    expect(plan).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
  });

  it('a parent listed after its child is a real code, not an implicit one', () => {
    const plan = planCodebookMerge([], [imp(['A', 'B']), imp(['A'], { description: 'Top' })], { overwrite: false });
    expect(plan.items.map((i) => [i.path.join('/'), i.implicit, i.fields])).toEqual([
      ['A', false, { description: 'Top' }],
      ['A/B', false, {}],
    ]);
  });
});

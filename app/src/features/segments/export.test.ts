import { describe, expect, it } from 'vitest';
import { buildDocx, buildHtml, buildXlsx, toCsv } from '../../core/export/office';
import type { Coding } from '../../core/model/types';
import { clipboardText, type ExportLabels, perCode, safeFileName, type SegmentRow, segmentReport, sourceOf, tableRows, xlsxSheets } from './export';

const labels: ExportLabels = {
  code: 'Code', codePath: 'Code path', document: 'Document', paragraph: 'Paragraph', start: 'Start', end: 'End', coder: 'Coder', text: 'Text',
  context: 'Context', comment: 'Comment', created: 'Created', paragraphShort: (n) => `¶ ${n}`, segmentCount: (n) => `${n} coded segments`,
  summary: 'Summary', segments: 'Segments', documents: 'Documents',
};

const coding = (id: string, code: string, doc: string, text: string, comment = ''): Coding => ({
  id, code_id: code, document_id: doc, coder_id: 'me', start: 10, end: 10 + text.length, text, comment,
  created_at: '2026-10-01T10:00:00.000Z', updated_at_hlc: '', deleted: false,
});

const row = (c: Coding, codeName: string, docName: string, paragraph: number | null = 3): SegmentRow => ({
  coding: c, codeName, codePath: codeName === 'Calm' ? ['Wellbeing', 'Calm'] : [codeName], codeColor: '#29a37a', documentName: docName, paragraph, coderName: 'Ana',
});

const rows = [
  row(coding('1', 'calm', 'd1', 'It is quiet\nhere.'), 'Calm', 'Interview 1'),
  row(coding('2', 'bel', 'd2', 'Nobody asks for papers', 'key quote'), 'Belonging', 'Interview 2', null),
  row(coding('3', 'calm', 'd2', '=HYPERLINK("x")'), 'Calm', 'Interview 2', 7),
];

describe('segment exports', () => {
  it('sourceOf', () => {
    expect(sourceOf(rows[0]!, labels)).toBe('Interview 1, ¶ 3');
    expect(sourceOf(rows[1]!, labels)).toBe('Interview 2');
  });

  it('clipboard text: quote, source and code path, comment', () => {
    expect(clipboardText(rows.slice(0, 2), labels)).toBe(
      '“It is quiet here.”\n— Interview 1, ¶ 3 · Wellbeing / Calm · Ana\n\n“Nobody asks for papers”\n— Interview 2 · Belonging · Ana\nComment: key quote',
    );
  });

  it('table rows, with a context column only when context is shown', () => {
    const t = tableRows(rows, labels);
    expect(t[0]).toEqual(['Code', 'Code path', 'Document', 'Paragraph', 'Start', 'End', 'Coder', 'Text', 'Comment', 'Created']);
    expect(t[1]!.slice(0, 4)).toEqual(['Calm', 'Wellbeing / Calm', 'Interview 1', 3]);
    expect(t[2]![3]).toBeNull();
    const withCtx = tableRows([{ ...rows[0]!, shown: { before: 'Well, ', coded: 'it is quiet', after: ' now', cutBefore: true, cutAfter: false } }], labels);
    expect(withCtx[0]).toContain('Context');
    expect(withCtx[1]![8]).toBe('…Well, it is quiet now');
    // The CSV writer still guards formulas in participants' words.
    expect(toCsv(t)).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('groups by code in codebook order', () => {
    const g = perCode(rows, ['bel', 'calm']);
    expect(g.map((x) => [x.codeId, x.rows.length])).toEqual([['bel', 1], ['calm', 2]]);
    expect(perCode(rows, []).map((x) => x.codeId)).toEqual(['bel', 'calm']);
  });

  it('xlsx sheets: segments and a per-code summary', () => {
    const sheets = xlsxSheets(rows, ['calm', 'bel'], labels);
    expect(sheets.map((s) => s.name)).toEqual(['Segments', 'Summary']);
    expect(sheets[1]!.rows).toEqual([['Code', 'Segments', 'Documents'], ['Wellbeing / Calm', 2, 2], ['Belonging', 1, 1]]);
    expect(buildXlsx(sheets).length).toBeGreaterThan(500);
  });

  it('report grouped by code with sources, writable as docx and html', () => {
    const doc = segmentReport(rows, ['calm', 'bel'], labels, { title: 'Coded segments', subtitle: 'Project · 5 Oct 2026', description: ['Codes: Calm'] });
    const headings = doc.blocks.filter((b) => b.type === 'heading');
    expect(headings).toHaveLength(2);
    const html = buildHtml(doc);
    expect(html).toContain('Wellbeing / Calm');
    expect(html).toContain('Interview 2, ¶ 7');
    expect(html).toContain('key quote');
    expect(html.indexOf('Wellbeing / Calm')).toBeLessThan(html.indexOf('Belonging'));
    expect(buildDocx(doc).length).toBeGreaterThan(1000);
  });

  it('report shows context around the coded text in bold', () => {
    const r = { ...rows[0]!, shown: { before: 'So ', coded: 'it is quiet', after: '.', cutBefore: false, cutAfter: true } };
    const html = buildHtml(segmentReport([r], [], labels, { title: 't', subtitle: 's' }));
    expect(html).toContain('<strong>it is quiet</strong>');
    expect(html).toContain('.…');
  });

  it('safeFileName', () => {
    expect(safeFileName('My: project / segments?', 'docx')).toBe('My project segments.docx');
    expect(safeFileName('  ', 'csv')).toBe('Trama.csv');
  });
});

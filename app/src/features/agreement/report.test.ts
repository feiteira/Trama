import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { buildDocx, buildHtml, buildXlsx } from '../../core/export/office';
import type { Coding } from '../../core/model/types';
import { makeI18n } from '../../ui/i18n';
import { codeRows, pairDisagreements, runAgreement } from './model';
import { buildReport, buildWorkbook, codeTable, disagreementTable, documentTable, type ReportInput, summaryLines } from './report';

let seq = 0;
const coding = (coder: string, code: string, doc: string, start: number, end: number, text = ''): Coding => ({
  id: `c${++seq}`,
  created_at: '2026-01-01T00:00:00Z',
  updated_at_hlc: `h${seq}`,
  deleted: false,
  document_id: doc,
  code_id: code,
  coder_id: coder,
  start,
  end,
  text,
  comment: '',
});

function input(locale: 'en' | 'pt' = 'en'): ReportInput {
  const a = [coding('A', 'k1', 'd1', 0, 50, 'alpha text'), coding('A', 'k2', 'd1', 60, 80, 'shared <b>quote</b>')];
  const b = [coding('B', 'k1', 'd1', 0, 50), coding('B', 'k2', 'd1', 60, 70, 'shorter')];
  const result = runAgreement({ codingsA: a, codingsB: b, documents: [{ id: 'd1', length: 100 }], codeIds: ['k1', 'k2'], threshold: 0.9 });
  const codeNames = new Map([
    ['k1', { name: 'Trust', color: '#e4572e' }],
    ['k2', { name: 'Access', color: '#3a6ea5' }],
  ]);
  const i18n = makeI18n(locale);
  return {
    t: i18n.t,
    tp: i18n.tp,
    bcp47: i18n.meta.bcp47,
    projectName: 'Gardens',
    coderA: { name: 'Ana', color: '#e4572e' },
    coderB: { name: 'Rui', color: '#b5179e' },
    date: '5 October 2026',
    version: '0.1.0',
    result,
    rows: codeRows(result, codeNames),
    documentNames: new Map([['d1', 'Interview 1']]),
    codeNames,
    threshold: 0.9,
    disagreements: pairDisagreements(result.segment.disagreements),
    codingText: new Map([...a, ...b].map((c) => [c.id, c.text])),
  };
}

describe('agreement report', () => {
  it('summarises every level with how to read it', () => {
    const lines = summaryLines(input());
    expect(lines).toHaveLength(9);
    expect(lines[0]![1]).toBe('Cohen’s kappa');
    expect(lines[0]![3]).toMatch(/^Landis & Koch: /);
    expect(lines.some((l) => l[1] === 'Brennan–Prediger κ')).toBe(true);
  });

  it('builds tables with numbers as numbers and a pooled totals row', () => {
    const i = input();
    const codes = codeTable(i);
    expect(codes[0]![0]).toBe('Code');
    expect(codes).toHaveLength(4); // header, 2 codes, totals
    expect(codes[1]).toEqual(['Trust', 100, 100, 1, 1, 50, 0, 0, 2, 0, 100, 100, null]);
    expect(codes[3]![0]).toBe('All codes, pooled');
    expect(typeof codes[3]![3]).toBe('number');
    expect(documentTable(i)).toHaveLength(2);
    // The boundary pair of Access gives one line per coder.
    const dis = disagreementTable(i);
    expect(dis).toHaveLength(3);
    expect(dis[1]!.slice(0, 4)).toEqual(['Interview 1', 'Access', 'Boundaries differ', 'Ana']);
    expect(dis[1]![7]).toBe('shared <b>quote</b>');
  });

  it('writes Word, HTML and Excel files that hold the report', () => {
    const i = input();
    const doc = buildReport(i);
    expect(doc.title).toBe('Inter-coder agreement');
    expect(doc.subtitle).toBe('Gardens · Ana and Rui · 5 October 2026');
    const html = buildHtml(doc);
    expect(html).toContain('Krippendorff');
    expect(html).toContain('shared &lt;b&gt;quote&lt;/b&gt;');
    expect(html).not.toContain('<b>quote</b>');
    const docx = unzipSync(buildDocx(doc));
    expect(new TextDecoder().decode(docx['word/document.xml'])).toContain('Pooled, not averaged');
    const xlsx = unzipSync(buildXlsx(buildWorkbook(i)));
    expect(Object.keys(xlsx).filter((k) => k.startsWith('xl/worksheets/sheet'))).toHaveLength(4);
  });

  it('follows the interface language', () => {
    const doc = buildReport(input('pt'));
    expect(doc.lang).toBe('pt-PT');
    expect(doc.title).not.toBe('Inter-coder agreement');
    expect(summaryLines(input('pt'))[0]![2]).toMatch(/^\d,\d{3}$/);
  });
});

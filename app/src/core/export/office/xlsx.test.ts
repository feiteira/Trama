import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { attr, child, children, parseXml, textOf } from '../refi/xml';
import { buildXlsx, columnName, safeSheetName } from './xlsx';

const NOW = () => new Date('2026-10-05T12:00:00Z');

function unpack(bytes: Uint8Array): Record<string, string> {
  return Object.fromEntries(Object.entries(unzipSync(bytes)).map(([k, v]) => [k, strFromU8(v)]));
}

/** A Python with openpyxl, for an independent reader check (skipped when absent). */
const python = [process.env.OFFICE_PYTHON, process.env.REFI_XSD_PYTHON, 'python3'].find(
  (p) => p && spawnSync(p, ['-c', 'import openpyxl'], { encoding: 'utf8' }).status === 0,
);

describe('xlsx', () => {
  const sheets = [
    {
      name: 'Segmentos: códigos/2026',
      rows: [
        ['Documento', 'Código', 'Início', 'Texto', 'Verificado'],
        ['Entrevista 1', 'Alegria 😀', 12, 'Gosto muito do meu trabalho & da equipa <sempre>', true],
        ['Entrevista 2', 'Stress', 3.25, 'Linha um\nLinha dois', false],
        ['Entrevista 3', null, undefined, '', { value: 'negrito', bold: true }],
        ['_x0041_ literal', 'Alegria 😀', -7, 'x'.repeat(40_000), null],
      ],
    },
    { name: 'Segmentos: códigos/2026', rows: [['Matriz'], [1, 2, 3]], header: false, widths: [30, 12] },
  ];
  const bytes = buildXlsx(sheets, { title: 'Exportação', creator: 'Trama', now: NOW });
  const files = unpack(bytes);

  it('has every part, all well-formed', () => {
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/app.xml',
      'docProps/core.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/sharedStrings.xml',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
    for (const xml of Object.values(files)) expect(() => parseXml(xml)).not.toThrow();
  });

  it('names sheets safely and uniquely', () => {
    const wb = parseXml(files['xl/workbook.xml']!);
    const names = children(child(wb, 'sheets')!, 'sheet').map((s) => attr(s, 'name'));
    expect(names).toEqual(['Segmentos códigos 2026', 'Segmentos códigos 2026 (2)']);
  });

  it('writes shared strings, numbers, booleans and bold header cells', () => {
    const sst = parseXml(files['xl/sharedStrings.xml']!);
    const strings = children(sst, 'si').map((si) => textOf(si));
    expect(strings).toContain('Gosto muito do meu trabalho & da equipa <sempre>');
    expect(strings.filter((s) => s === 'Alegria 😀')).toHaveLength(1); // shared
    expect(attr(sst, 'count')).toBe('17');
    expect(strings).toContain('_x005F_x0041_ literal');
    const long = strings.find((s) => s.startsWith('xxx'))!;
    expect(long.length).toBe(32_767);
    const sheet = files['xl/worksheets/sheet1.xml']!;
    expect(sheet).toContain('<c r="C2" s="3"><v>12</v></c>'.replace(' s="3"', ''));
    expect(sheet).toContain('<c r="E2" t="b"><v>1</v></c>');
    expect(sheet).toContain('<c r="C3"><v>3.25</v></c>');
    expect(sheet).toMatch(/<c r="A1" t="s" s="1">/);
    expect(sheet).toMatch(/<c r="E4" t="s" s="3">/);
    expect(sheet).toMatch(/<c r="D3" t="s" s="2">/); // wrapped (has a line break)
    expect(sheet).not.toContain('r="B4"'); // empty cells are left out
  });

  it('freezes the header row and sets column widths', () => {
    const s1 = files['xl/worksheets/sheet1.xml']!;
    expect(s1).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(s1).toContain('<dimension ref="A1:E5"/>');
    expect(s1).toMatch(/<col min="4" max="4" width="60" customWidth="1"\/>/);
    const s2 = files['xl/worksheets/sheet2.xml']!;
    expect(s2).not.toContain('<pane');
    expect(s2).toContain('<col min="1" max="1" width="30" customWidth="1"/>');
    expect(s2).toContain('<col min="3" max="3" width="10" customWidth="1"/>');
  });

  it('writes an empty workbook and refuses oversize sheets', () => {
    const empty = unpack(buildXlsx([]));
    expect(empty['xl/workbook.xml']).toContain('name="Sheet1"');
    expect(() => buildXlsx([{ name: 'wide', rows: [new Array(16_385).fill(1)] }])).toThrow(/columns/);
  });

  it('handles a large sheet', () => {
    const rows = [['n', 'texto'], ...Array.from({ length: 50_000 }, (_, i) => [i, `segmento ${i % 1000}`])];
    const t0 = Date.now();
    const big = buildXlsx([{ name: 'Big', rows }]);
    expect(Date.now() - t0).toBeLessThan(5000);
    const sst = parseXml(unpack(big)['xl/sharedStrings.xml']!);
    expect(attr(sst, 'uniqueCount')).toBe('1002');
  });

  it('column names and sheet names', () => {
    expect([0, 25, 26, 51, 52, 701, 702, 16383].map(columnName)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA', 'XFD']);
    const used = new Set<string>();
    expect(safeSheetName("  'History'  ", used)).toBe('History_');
    expect(safeSheetName('', used)).toBe('Sheet');
    expect(safeSheetName('sheet', used)).toBe('sheet (2)');
    expect(Array.from(safeSheetName('😀'.repeat(40), used))).toHaveLength(31);
  });

  it.skipIf(!python)('opens in openpyxl', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trama-xlsx-'));
    try {
      const file = join(dir, 'x.xlsx');
      writeFileSync(file, bytes);
      const code = `import openpyxl,sys,json\nwb=openpyxl.load_workbook(sys.argv[1])\nws=wb.worksheets[0]\nprint(json.dumps([wb.sheetnames, ws['B2'].value, ws['C3'].value, ws['E2'].value, ws['A1'].font.b, ws.freeze_panes]))`;
      const r = spawnSync(python!, ['-c', code, file], { encoding: 'utf8' });
      expect(r.stderr).toBe('');
      expect(JSON.parse(r.stdout)).toEqual([['Segmentos códigos 2026', 'Segmentos códigos 2026 (2)'], 'Alegria 😀', 3.25, true, true, 'A2']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

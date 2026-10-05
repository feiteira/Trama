import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { children, descendants, parseXml, textOf } from '../refi/xml';
import type { ReportDocument } from './blocks';
import { chip } from './blocks';
import { buildDocx } from './docx';

const NOW = () => new Date('2026-10-05T12:00:00Z');

const SAMPLE: ReportDocument = {
  title: 'Livro de códigos — Projeto Bem-estar',
  subtitle: 'Exportado a 5 de outubro de 2026',
  lang: 'pt-PT',
  generator: 'Trama 0.1.0',
  blocks: [
    { type: 'heading', level: 1, text: 'Emoções' },
    { type: 'paragraph', text: [chip('#f3a712'), ' ', { text: 'Alegria 😀', bold: true }, ' — ', { text: 'expressões de felicidade', italic: true }] },
    { type: 'paragraph', text: '“Gosto muito do meu trabalho” & <equipa>\nsegunda linha\tcom tab', style: 'quote' },
    { type: 'paragraph', text: [{ text: 'Entrevista 1, 12–40', small: true, color: '#5f6368' }, { text: ' id-42', mono: true }], style: 'small' },
    { type: 'heading', level: 2, text: 'Lista' },
    { type: 'list', items: ['primeiro', [{ text: 'segundo', bold: true }]] },
    { type: 'list', items: ['um', 'dois'], ordered: true },
    { type: 'heading', level: 3, text: 'Matriz' },
    { type: 'table', header: ['Código', 'Entrevista 1', 'Entrevista 2'], rows: [[[chip('#e4572e'), ' Stress'], 3, 0], ['Alegria', 1, null]], widths: [2, 1, 1] },
    { type: 'pageBreak' },
    { type: 'paragraph', text: [{ text: 'Cor inválida', color: 'red;}', shade: 'url(x)' }] },
  ],
};

/** A Python with python-docx, for an independent reader check (skipped when absent). */
const python = [process.env.OFFICE_PYTHON, process.env.REFI_XSD_PYTHON, 'python3'].find(
  (p) => p && spawnSync(p, ['-c', 'import docx'], { encoding: 'utf8' }).status === 0,
);
const soffice = ['soffice', 'libreoffice'].find((c) => spawnSync(c, ['--version'], { encoding: 'utf8' }).status === 0);

describe('docx', () => {
  const bytes = buildDocx(SAMPLE, { now: NOW });
  const files = Object.fromEntries(Object.entries(unzipSync(bytes)).map(([k, v]) => [k, strFromU8(v)]));
  const doc = parseXml(files['word/document.xml']!);

  it('has the required parts, all well-formed', () => {
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/app.xml',
      'docProps/core.xml',
      'word/_rels/document.xml.rels',
      'word/document.xml',
      'word/styles.xml',
    ]);
    for (const xml of Object.values(files)) expect(() => parseXml(xml)).not.toThrow();
    expect(files['docProps/core.xml']).toContain('<dc:title>Livro de códigos — Projeto Bem-estar</dc:title>');
    expect(files['word/styles.xml']).toContain('<w:lang w:val="pt-PT"/>');
  });

  it('uses heading styles and keeps the text', () => {
    const styles = descendants(doc, 'pStyle').map((s) => s.getAttribute('w:val'));
    expect(styles).toEqual(expect.arrayContaining(['Title', 'Subtitle', 'Heading1', 'Heading2', 'Heading3', 'Quote', 'Small', 'ListParagraph']));
    const text = descendants(doc, 't').map((t) => textOf(t)).join('');
    expect(text).toContain('“Gosto muito do meu trabalho” & <equipa>');
    expect(text).toContain('Alegria 😀');
  });

  it('writes bold, italic, colour, shading, breaks, tabs and page breaks', () => {
    const xml = files['word/document.xml']!;
    expect(xml).toContain('<w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Alegria 😀</w:t>');
    expect(xml).toContain('<w:i/>');
    expect(xml).toContain('<w:shd w:val="clear" w:color="auto" w:fill="F3A712"/>');
    expect(xml).toContain('<w:color w:val="5F6368"/>');
    expect(xml).toContain('<w:rFonts w:ascii="Consolas"');
    expect(xml).toContain('<w:br/>');
    expect(xml).toContain('<w:tab/>');
    expect(xml).toContain('<w:br w:type="page"/>');
    expect(xml).not.toContain('red;}');
    expect(xml).not.toContain('url(x)');
  });

  it('writes tables with a repeated header row and proportional widths', () => {
    const [tbl] = descendants(doc, 'tbl');
    const rows = children(tbl!, 'tr');
    expect(rows).toHaveLength(3);
    expect(descendants(rows[0]!, 'tblHeader')).toHaveLength(1);
    const cols = descendants(tbl!, 'gridCol').map((g) => Number(g.getAttribute('w:w')));
    expect(Math.abs(cols[0]! - cols[1]! * 2)).toBeLessThanOrEqual(2);
    // every cell has a paragraph, even an empty one
    for (const tc of descendants(tbl!, 'tc')) expect(children(tc, 'p')).toHaveLength(1);
  });

  it('writes an empty document and US Letter on request', () => {
    const empty = unzipSync(buildDocx({ title: '', blocks: [] }, { page: 'letter' }));
    const xml = strFromU8(empty['word/document.xml']!);
    expect(() => parseXml(xml)).not.toThrow();
    expect(xml).toContain('w:w="12240"');
  });

  it.skipIf(!python)('opens in python-docx', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trama-docx-'));
    try {
      const file = join(dir, 'r.docx');
      writeFileSync(file, bytes);
      const code = `import docx,sys,json\nd=docx.Document(sys.argv[1])\nprint(json.dumps([[p.style.name for p in d.paragraphs][:3], len(d.tables), d.tables[0].cell(1,1).text, d.core_properties.title]))`;
      const r = spawnSync(python!, ['-c', code, file], { encoding: 'utf8' });
      expect(r.stderr).toBe('');
      expect(JSON.parse(r.stdout)).toEqual([['Title', 'Subtitle', 'Heading 1'], 1, '3', 'Livro de códigos — Projeto Bem-estar']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!soffice)('LibreOffice converts it to text', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trama-soffice-'));
    try {
      const file = join(dir, 'r.docx');
      writeFileSync(file, bytes);
      const r = spawnSync(soffice!, ['--headless', '--convert-to', 'txt:Text', '--outdir', dir, file], { encoding: 'utf8', timeout: 60_000 });
      expect(r.status).toBe(0);
      const txt = readFileSync(join(dir, 'r.txt'), 'utf8');
      expect(txt).toContain('Alegria 😀');
      expect(txt).toContain('Gosto muito do meu trabalho');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);
});

import { describe, expect, it } from 'vitest';
import { chip, columnCount, contrastText, runsOf, safeColor } from './blocks';
import { buildHtml, escapeHtml } from './html';

describe('html report', () => {
  const html = buildHtml({
    title: 'Segmentos <codificados> & "citações"',
    subtitle: 'Projeto Bem-estar',
    lang: 'pt-PT',
    generator: 'Trama 0.1.0',
    blocks: [
      { type: 'heading', level: 1, text: 'Alegria' },
      { type: 'paragraph', text: [chip('#29a37a'), ' ', { text: 'Alegria', bold: true }, { text: ' (3)', small: true }] },
      { type: 'paragraph', text: '<script>alert(1)</script>\nlinha 2 😀', style: 'quote' },
      { type: 'paragraph', text: [{ text: 'x', color: 'red" onclick="evil', shade: '#000000', mono: true, italic: true }] },
      { type: 'list', items: ['um', 'dois'], ordered: true },
      { type: 'table', header: ['Código', 'N'], rows: [['Alegria', 3], ['Stress']], widths: [3, 1] },
      { type: 'pageBreak' },
      { type: 'paragraph', text: 'fim', style: 'small' },
    ],
  });

  it('is a standalone document with inline CSS and no scripts or external resources', () => {
    expect(html.startsWith('<!doctype html>\n<html lang="pt-PT">')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('<style>');
    expect(html).toContain('@page');
    expect(html).not.toMatch(/<script|<link|src=|https?:\/\//);
    expect(html.endsWith('</html>\n')).toBe(true);
  });

  it('escapes every text and drops unsafe colours', () => {
    expect(html).toContain('<title>Segmentos &lt;codificados&gt; &amp; &quot;citações&quot;</title>');
    expect(html).toContain('<blockquote>&lt;script&gt;alert(1)&lt;/script&gt;<br>linha 2 😀</blockquote>');
    expect(html).not.toContain('onclick');
    expect(html).toContain('<span style="background:#000000;color:#ffffff;print-color-adjust:exact;-webkit-print-color-adjust:exact"><em><code>x</code></em></span>');
  });

  it('writes headings below the title, lists, tables and page breaks', () => {
    expect(html).toContain('<h2>Alegria</h2>');
    expect(html).toContain('<ol><li>um</li><li>dois</li></ol>');
    expect(html).toContain('<thead><tr><th>Código</th><th>N</th></tr></thead>');
    expect(html).toContain('<td class="num">3</td>');
    expect(html).toContain('<tr><td>Stress</td><td></td></tr>');
    expect(html).toContain('<col style="width:75.00%">');
    expect(html).toContain('<div class="page-break"></div>');
    expect(html).toContain('<p class="small">fim</p>');
    expect(html).toContain('<strong>Alegria</strong><small> (3)</small>');
  });

  it('helpers', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    expect(safeColor('#ABCDEF')).toBe('#abcdef');
    expect(safeColor('#abc')).toBeNull();
    expect(safeColor(undefined)).toBeNull();
    expect(contrastText('#ffffff')).toBe('#000000');
    expect(contrastText('#3a6ea5')).toBe('#ffffff');
    expect(contrastText('#f3a712')).toBe('#000000');
    expect(runsOf(null)).toEqual([]);
    expect(runsOf(2.5)).toEqual([{ text: '2.5' }]);
    expect(columnCount(undefined, [[1], [1, 2, 3]])).toBe(3);
    expect(columnCount([], [])).toBe(1);
  });

  it('an empty report is still a valid page', () => {
    const empty = buildHtml({ title: '', blocks: [] });
    expect(empty).toContain('<html lang="en">');
    expect(empty).toContain('<title></title>');
  });
});

// Standalone HTML report: one file, inline CSS, no scripts and no external resources, so it
// opens anywhere, prints cleanly (headers repeat, rows do not split) and leaks nothing.
import type { Block, Inline, ReportDocument, TableCell } from './blocks';
import { columnCount, contrastText, runsOf, safeColor } from './blocks';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function inlineHtml(inline: Inline | number | null | undefined): string {
  return runsOf(inline)
    .map((r) => {
      let html = escapeHtml(r.text).replace(/\n/g, '<br>').replace(/\t/g, '&emsp;');
      const style: string[] = [];
      const color = safeColor(r.color);
      const shade = safeColor(r.shade);
      if (color) style.push(`color:${color}`);
      if (shade) {
        style.push(`background:${shade}`);
        if (!color) style.push(`color:${contrastText(shade)}`);
      }
      // Shaded runs keep their colour when printed.
      if (shade) style.push('print-color-adjust:exact;-webkit-print-color-adjust:exact');
      if (r.mono) html = `<code>${html}</code>`;
      if (r.small) html = `<small>${html}</small>`;
      if (r.italic) html = `<em>${html}</em>`;
      if (r.bold) html = `<strong>${html}</strong>`;
      return style.length ? `<span style="${style.join(';')}">${html}</span>` : html;
    })
    .join('');
}

function cellHtml(tag: 'td' | 'th', c: TableCell): string {
  const numeric = typeof c === 'number';
  return `<${tag}${numeric ? ' class="num"' : ''}>${inlineHtml(c)}</${tag}>`;
}

function blockHtml(b: Block): string {
  switch (b.type) {
    case 'heading': {
      const level = b.level + 1; // h1 is the report title
      return `<h${level}>${inlineHtml(b.text)}</h${level}>`;
    }
    case 'paragraph':
      if (b.style === 'quote') return `<blockquote>${inlineHtml(b.text)}</blockquote>`;
      return `<p${b.style === 'small' ? ' class="small"' : ''}>${inlineHtml(b.text)}</p>`;
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      return `<${tag}>${b.items.map((i) => `<li>${inlineHtml(i)}</li>`).join('')}</${tag}>`;
    }
    case 'table': {
      const columns = columnCount(b.header, b.rows);
      const rel = Array.from({ length: columns }, (_, i) => Math.max(0, b.widths?.[i] ?? 1));
      const total = rel.reduce((x, y) => x + y, 0) || 1;
      const cols = b.widths ? `<colgroup>${rel.map((w) => `<col style="width:${((w / total) * 100).toFixed(2)}%">`).join('')}</colgroup>` : '';
      const head = b.header ? `<thead><tr>${Array.from({ length: columns }, (_, i) => cellHtml('th', b.header![i])).join('')}</tr></thead>` : '';
      const body = b.rows.map((r) => `<tr>${Array.from({ length: columns }, (_, i) => cellHtml('td', r[i])).join('')}</tr>`).join('\n');
      return `<table>${cols}${head}<tbody>\n${body}\n</tbody></table>`;
    }
    case 'pageBreak':
      return '<div class="page-break"></div>';
  }
}

const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #ffffff; color: #1f2328; font: 15px/1.55 "Instrument Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 52rem; margin: 0 auto; padding: 2.5rem 1rem 4rem; }
h1 { font-size: 1.9rem; line-height: 1.2; margin: 0 0 .25rem; }
.subtitle { color: #5f6368; margin: 0 0 2rem; }
h2 { font-size: 1.4rem; margin: 2.2rem 0 .6rem; border-bottom: 1px solid #d0d7de; padding-bottom: .25rem; }
h3 { font-size: 1.15rem; margin: 1.6rem 0 .5rem; }
h4 { font-size: 1rem; margin: 1.2rem 0 .4rem; }
h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
p { margin: 0 0 .7rem; }
.small, small { color: #5f6368; font-size: .85em; }
blockquote { margin: .5rem 0 .9rem; padding: .2rem 0 .2rem .9rem; border-left: 3px solid #9aa0a6; font-family: Literata, Georgia, "Times New Roman", serif; font-style: italic; break-inside: avoid; }
code { font-family: ui-monospace, Consolas, "Liberation Mono", monospace; font-size: .9em; }
ul, ol { margin: 0 0 .8rem; padding-left: 1.4rem; }
table { width: 100%; border-collapse: collapse; margin: .4rem 0 1.2rem; font-size: .92em; }
th, td { border: 1px solid #bfc4ca; padding: .3rem .45rem; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th { background: #edeff2; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
.table-wrap { overflow-x: auto; }
.page-break { break-after: page; page-break-after: always; }
footer { margin-top: 3rem; color: #5f6368; font-size: .8rem; }
@page { size: A4; margin: 2cm; }
@media print {
  body { font-size: 11pt; }
  main { max-width: none; padding: 0; }
  th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .table-wrap { overflow: visible; }
}
`;

/** A complete, self-contained HTML document for a report. */
export function buildHtml(doc: ReportDocument): string {
  const lang = escapeHtml(doc.lang ?? 'en');
  const body = doc.blocks
    .map((b) => (b.type === 'table' ? `<div class="table-wrap">${blockHtml(b)}</div>` : blockHtml(b)))
    .join('\n');
  return [
    '<!doctype html>',
    `<html lang="${lang}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    // Nothing in a report may reach the network, even if text in it looks like markup.
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`,
    doc.generator ? `<meta name="generator" content="${escapeHtml(doc.generator)}">` : '',
    `<title>${escapeHtml(doc.title)}</title>`,
    `<style>${CSS}</style>`,
    '</head>',
    '<body>',
    '<main>',
    `<h1>${escapeHtml(doc.title)}</h1>`,
    doc.subtitle ? `<p class="subtitle">${escapeHtml(doc.subtitle)}</p>` : '',
    body,
    doc.generator ? `<footer>${escapeHtml(doc.generator)}</footer>` : '',
    '</main>',
    '</body>',
    '</html>',
    '',
  ]
    .filter((l) => l !== '')
    .join('\n') + '\n';
}

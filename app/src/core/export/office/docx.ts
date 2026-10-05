// Minimal WordprocessingML (.docx) writer for reports: title, headings, paragraphs with bold,
// italic, coloured and shaded runs, simple lists, tables with a repeated header row and page
// breaks. Styles are real Word styles (Heading 1–3, Quote…), so the navigation pane and a
// table of contents work in Word and LibreOffice.
import { zipSync, type Zippable } from 'fflate';
import { utf8 } from '../../bytes';
import { xmlAttr, xmlText } from '../refi/xml';
import type { Block, Inline, ReportDocument, TableCell } from './blocks';
import { columnCount, runsOf, safeColor } from './blocks';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface DocxOptions {
  /** Paper size: A4 (default, Portugal and Spain) or US Letter. */
  page?: 'a4' | 'letter';
  now?: () => Date;
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MARGIN = 1134; // 2 cm in twips
const PAGES = { a4: { w: 11906, h: 16838 }, letter: { w: 12240, h: 15840 } } as const;

function runXml(text: string, style: Exclude<ReturnType<typeof runsOf>[number], string>): string {
  const props: string[] = [];
  // Child order of w:rPr is fixed by the schema: rFonts, b, i, color, sz, shd.
  if (style.mono) props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>');
  if (style.bold) props.push('<w:b/>');
  if (style.italic) props.push('<w:i/>');
  const color = safeColor(style.color);
  if (color) props.push(`<w:color w:val="${color.slice(1).toUpperCase()}"/>`);
  if (style.small) props.push('<w:sz w:val="18"/><w:szCs w:val="18"/>');
  const shade = safeColor(style.shade);
  if (shade) props.push(`<w:shd w:val="clear" w:color="auto" w:fill="${shade.slice(1).toUpperCase()}"/>`);
  const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
  // Line breaks and tabs are elements in WordprocessingML, not characters.
  const pieces: string[] = [];
  for (const [i, line] of text.split('\n').entries()) {
    if (i > 0) pieces.push('<w:br/>');
    for (const [j, seg] of line.split('\t').entries()) {
      if (j > 0) pieces.push('<w:tab/>');
      if (seg) pieces.push(`<w:t xml:space="preserve">${xmlText(seg)}</w:t>`);
    }
  }
  return pieces.length ? `<w:r>${rPr}${pieces.join('')}</w:r>` : '';
}

function inlineXml(inline: Inline | number | null | undefined): string {
  return runsOf(inline)
    .map((r) => runXml(r.text, r))
    .join('');
}

function paragraph(inline: Inline | number | null | undefined, pPr = ''): string {
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inlineXml(inline)}</w:p>`;
}

function tableXml(block: Extract<Block, { type: 'table' }>, usable: number): string {
  const columns = columnCount(block.header, block.rows);
  const rel = Array.from({ length: columns }, (_, i) => Math.max(0.0001, block.widths?.[i] ?? 1));
  const total = rel.reduce((a, b) => a + b, 0);
  const widths = rel.map((w) => Math.max(200, Math.floor((w / total) * usable)));
  const cell = (c: TableCell, i: number, header: boolean) => {
    const shd = header ? '<w:shd w:val="clear" w:color="auto" w:fill="EDEFF2"/>' : '';
    const runs = header ? runsOf(c).map((r) => ({ ...r, bold: true })) : c;
    return `<w:tc><w:tcPr><w:tcW w:w="${widths[i]}" w:type="dxa"/>${shd}</w:tcPr>${paragraph(runs as Inline, '<w:spacing w:before="40" w:after="40"/>')}</w:tc>`;
  };
  const row = (cells: readonly TableCell[], header: boolean) => {
    const full = Array.from({ length: columns }, (_, i) => cells[i]);
    // A header row repeats at the top of every page; rows never split across pages.
    const trPr = header ? '<w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>' : '<w:trPr><w:cantSplit/></w:trPr>';
    return `<w:tr>${trPr}${full.map((c, i) => cell(c, i, header)).join('')}</w:tr>`;
  };
  return (
    '<w:tbl><w:tblPr><w:tblStyle w:val="TramaTable"/><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="fixed"/></w:tblPr>' +
    `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
    (block.header ? row(block.header, true) : '') +
    block.rows.map((r) => row(r, false)).join('') +
    '</w:tbl>'
  );
}

function bodyXml(doc: ReportDocument, usable: number): string {
  const parts: string[] = [];
  parts.push(paragraph(doc.title, '<w:pStyle w:val="Title"/>'));
  if (doc.subtitle) parts.push(paragraph(doc.subtitle, '<w:pStyle w:val="Subtitle"/>'));
  for (const b of doc.blocks) {
    switch (b.type) {
      case 'heading':
        parts.push(paragraph(b.text, `<w:pStyle w:val="Heading${b.level}"/>`));
        break;
      case 'paragraph':
        parts.push(paragraph(b.text, b.style === 'quote' ? '<w:pStyle w:val="Quote"/>' : b.style === 'small' ? '<w:pStyle w:val="Small"/>' : ''));
        break;
      case 'list':
        b.items.forEach((item, i) => {
          // Numbering definitions are a part of their own; a hanging indent with the marker as
          // text looks the same and stays editable.
          const marker = b.ordered ? `${i + 1}.\t` : '•\t';
          parts.push(`<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:tabs><w:tab w:val="left" w:pos="360"/></w:tabs><w:ind w:left="360" w:hanging="360"/></w:pPr>${runXml(marker, { text: marker })}${inlineXml(item)}</w:p>`);
        });
        break;
      case 'table':
        parts.push(tableXml(b, usable));
        // Word wants a paragraph between consecutive tables and before the section end.
        parts.push('<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>');
        break;
      case 'pageBreak':
        parts.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
        break;
    }
  }
  return parts.join('');
}

const STYLES_XML =
  DECL +
  `<w:styles xmlns:w="${W}">` +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:color w:val="5F6368"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>' +
  [1, 2, 3]
    .map((l) => {
      const size = [0, 32, 26, 23][l];
      return `<w:style w:type="paragraph" w:styleId="Heading${l}"><w:name w:val="heading ${l}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${l === 1 ? 360 : 240}" w:after="120"/><w:outlineLvl w:val="${l - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
    })
    .join('') +
  '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="9AA0A6"/></w:pBdr><w:ind w:left="284" w:right="284"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Small"><w:name w:val="Small"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="5F6368"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/></w:pPr></w:style>' +
  '<w:style w:type="table" w:styleId="TramaTable"><w:name w:val="Trama Table"/><w:tblPr><w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="BFC4CA"/>`).join('') +
  '</w:tblBorders><w:tblCellMar><w:left w:w="85" w:type="dxa"/><w:right w:w="85" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
  '</w:styles>';

/** Builds a .docx file from a report document. */
export function buildDocx(doc: ReportDocument, opts: DocxOptions = {}): Uint8Array {
  const page = PAGES[opts.page ?? 'a4'];
  const usable = page.w - 2 * MARGIN;
  const now = (opts.now ?? (() => new Date()))();
  const lang = doc.lang ?? 'en-GB';
  const files: Zippable = {};
  files['[Content_Types].xml'] = utf8(
    DECL +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>',
  );
  files['_rels/.rels'] = utf8(
    DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>',
  );
  files['word/_rels/document.xml.rels'] = utf8(
    DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>',
  );
  files['word/styles.xml'] = utf8(STYLES_XML.replace('<w:lang w:val="en-GB"/>', `<w:lang w:val="${xmlAttr(lang)}"/>`));
  files['word/document.xml'] = utf8(
    DECL +
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
      bodyXml(doc, usable) +
      `<w:sectPr><w:pgSz w:w="${page.w}" w:h="${page.h}"/><w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>` +
      '</w:body></w:document>',
  );
  files['docProps/core.xml'] = utf8(
    DECL +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${xmlText(doc.title)}</dc:title>` +
      `<dc:language>${xmlText(lang)}</dc:language>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now.toISOString().replace(/\.\d{3}Z$/, 'Z')}</dcterms:created>` +
      '</cp:coreProperties>',
  );
  files['docProps/app.xml'] = utf8(
    DECL +
      `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${xmlText(doc.generator ?? 'Trama')}</Application></Properties>`,
  );
  return zipSync(files, { level: 6, mtime: now });
}

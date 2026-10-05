// Minimal SpreadsheetML (.xlsx) writer: several sheets, shared strings, numbers and booleans,
// a bold frozen header row, column widths and wrapped long text. Enough for codebooks, coded
// segments, matrices and agreement tables; opens in Excel, LibreOffice and Numbers.
import { zipSync, type Zippable } from 'fflate';
import { utf8 } from '../../bytes';
import { xmlAttr, xmlText } from '../refi/xml';

export type XlsxValue = string | number | boolean | null | undefined;
export type XlsxCell = XlsxValue | { value: XlsxValue; bold?: boolean };

export interface XlsxSheet {
  name: string;
  rows: readonly (readonly XlsxCell[])[];
  /** The first row is a header: bold, shaded and frozen while scrolling. Default true. */
  header?: boolean;
  /** Column widths in characters; measured from the content when omitted. */
  widths?: readonly number[];
}

export interface XlsxOptions {
  title?: string;
  creator?: string;
  now?: () => Date;
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const XLSX_LIMITS = { rows: 1_048_576, columns: 16_384, cellChars: 32_767, sheetName: 31 } as const;

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// Style indexes in styles.xml (cellXfs).
const STYLE = { normal: 0, header: 1, wrap: 2, bold: 3, boldWrap: 4 } as const;

/** Column letters: 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * A sheet name Excel accepts: no []:*?/\, at most 31 characters, not blank, not starting or
 * ending with an apostrophe, not "History" (reserved), unique ignoring case.
 */
export function safeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[[\]:*?/\\\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').trim();
  if (!base) base = 'Sheet';
  if (base.toLowerCase() === 'history') base = 'History_';
  base = Array.from(base).slice(0, XLSX_LIMITS.sheetName).join('');
  let candidate = base;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) {
    const suffix = ` (${i})`;
    candidate = Array.from(base).slice(0, XLSX_LIMITS.sheetName - suffix.length).join('').trimEnd() + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/** Excel reads `_xHHHH_` in cell text as an escaped character; a literal one is escaped itself. */
function escapeExcel(s: string): string {
  return s.replace(/_(x[0-9a-fA-F]{4}_)/g, '_x005F_$1');
}

class SharedStrings {
  private readonly index = new Map<string, number>();
  readonly list: string[] = [];
  count = 0;

  add(s: string): number {
    this.count++;
    let i = this.index.get(s);
    if (i === undefined) {
      i = this.list.length;
      this.list.push(s);
      this.index.set(s, i);
    }
    return i;
  }
}

const cellValue = (c: XlsxCell): XlsxValue => (c !== null && typeof c === 'object' ? c.value : c);
const cellBold = (c: XlsxCell): boolean => c !== null && typeof c === 'object' && !!c.bold;

function displayLength(v: XlsxValue): number {
  if (v === null || v === undefined) return 0;
  const s = typeof v === 'string' ? v : String(v);
  // The longest line, in code points; wide (CJK) characters count double.
  let max = 0;
  for (const line of s.split('\n')) {
    let n = 0;
    for (const ch of line) n += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1;
    max = Math.max(max, n);
  }
  return max;
}

function measureWidths(rows: readonly (readonly XlsxCell[])[], columns: number): number[] {
  const widths = new Array<number>(columns).fill(0);
  // The first rows are enough to size columns; scanning a 100 000-row export would be wasted time.
  for (const row of rows.slice(0, 2000)) {
    row.forEach((c, i) => {
      widths[i] = Math.max(widths[i]!, displayLength(cellValue(c)));
    });
  }
  return widths.map((w) => Math.min(60, Math.max(8, w + 2)));
}

function sheetXml(sheet: XlsxSheet, strings: SharedStrings, first: boolean): string {
  const header = sheet.header !== false && sheet.rows.length > 0;
  if (sheet.rows.length > XLSX_LIMITS.rows) throw new Error(`Sheet "${sheet.name}" has more than ${XLSX_LIMITS.rows} rows`);
  let columns = 1;
  for (const r of sheet.rows) if (r.length > columns) columns = r.length;
  if (columns > XLSX_LIMITS.columns) throw new Error(`Sheet "${sheet.name}" has more than ${XLSX_LIMITS.columns} columns`);
  const widths = sheet.widths ? Array.from({ length: columns }, (_, i) => sheet.widths![i] ?? 10) : measureWidths(sheet.rows, columns);

  const parts: string[] = [DECL, `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">`];
  const lastRow = Math.max(1, sheet.rows.length);
  parts.push(`<dimension ref="A1:${columnName(columns - 1)}${lastRow}"/>`);
  parts.push(`<sheetViews><sheetView workbookViewId="0"${first ? ' tabSelected="1"' : ''}>`);
  if (header) parts.push('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>');
  parts.push('</sheetView></sheetViews>');
  parts.push('<sheetFormatPr defaultRowHeight="15"/>');
  parts.push('<cols>');
  widths.forEach((w, i) => parts.push(`<col min="${i + 1}" max="${i + 1}" width="${Math.max(1, Math.min(255, w))}" customWidth="1"/>`));
  parts.push('</cols><sheetData>');
  sheet.rows.forEach((row, r) => {
    const cells: string[] = [];
    row.forEach((c, i) => {
      const v = cellValue(c);
      const ref = `${columnName(i)}${r + 1}`;
      const isHeader = header && r === 0;
      const bold = isHeader || cellBold(c);
      if (v === null || v === undefined || v === '') {
        if (isHeader) cells.push(`<c r="${ref}" s="${STYLE.header}"/>`);
        return;
      }
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) return;
        cells.push(`<c r="${ref}"${isHeader ? ` s="${STYLE.header}"` : bold ? ` s="${STYLE.bold}"` : ''}><v>${v}</v></c>`);
      } else if (typeof v === 'boolean') {
        cells.push(`<c r="${ref}" t="b"${isHeader ? ` s="${STYLE.header}"` : bold ? ` s="${STYLE.bold}"` : ''}><v>${v ? 1 : 0}</v></c>`);
      } else {
        let s = v;
        if (s.length > XLSX_LIMITS.cellChars) s = s.slice(0, XLSX_LIMITS.cellChars - 1) + '…';
        const wrap = s.includes('\n') || displayLength(s) > (widths[i] ?? 10);
        const style = isHeader ? STYLE.header : bold ? (wrap ? STYLE.boldWrap : STYLE.bold) : wrap ? STYLE.wrap : STYLE.normal;
        cells.push(`<c r="${ref}" t="s"${style ? ` s="${style}"` : ''}><v>${strings.add(s)}</v></c>`);
      }
    });
    parts.push(`<row r="${r + 1}">${cells.join('')}</row>`);
  });
  parts.push('</sheetData>');
  parts.push('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>');
  parts.push('</worksheet>');
  return parts.join('');
}

const STYLES_XML =
  DECL +
  `<styleSheet xmlns="${NS_MAIN}">` +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFEDEFF2"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left/><right/><top/><bottom style="thin"><color rgb="FF9AA0A6"/></bottom><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="5">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/** Builds an .xlsx file. Throws when a sheet exceeds Excel's row or column limits. */
export function buildXlsx(sheets: readonly XlsxSheet[], opts: XlsxOptions = {}): Uint8Array {
  const list = sheets.length ? sheets : [{ name: 'Sheet1', rows: [] }];
  const strings = new SharedStrings();
  const used = new Set<string>();
  const names = list.map((s) => safeSheetName(s.name, used));
  const files: Zippable = {};
  const worksheets = list.map((s, i) => sheetXml(s, strings, i === 0));
  const now = (opts.now ?? (() => new Date()))();
  const created = now.toISOString().replace(/\.\d{3}Z$/, 'Z');

  files['[Content_Types].xml'] = utf8(
    DECL +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>',
  );
  files['_rels/.rels'] = utf8(
    DECL +
      `<Relationships xmlns="${NS_PKG_REL}">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>',
  );
  files['docProps/core.xml'] = utf8(
    DECL +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      (opts.title ? `<dc:title>${xmlText(opts.title)}</dc:title>` : '') +
      (opts.creator ? `<dc:creator>${xmlText(opts.creator)}</dc:creator>` : '') +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>` +
      '</cp:coreProperties>',
  );
  files['docProps/app.xml'] = utf8(
    DECL + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Trama</Application></Properties>',
  );
  files['xl/workbook.xml'] = utf8(
    DECL +
      `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
      '<bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
      names.map((n, i) => `<sheet name="${xmlAttr(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets></workbook>',
  );
  files['xl/_rels/workbook.xml.rels'] = utf8(
    DECL +
      `<Relationships xmlns="${NS_PKG_REL}">` +
      list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `<Relationship Id="rId${list.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
      '</Relationships>',
  );
  worksheets.forEach((xml, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = utf8(xml);
  });
  files['xl/styles.xml'] = utf8(STYLES_XML);
  files['xl/sharedStrings.xml'] = utf8(
    DECL +
      `<sst xmlns="${NS_MAIN}" count="${strings.count}" uniqueCount="${strings.list.length}">` +
      strings.list.map((s) => `<si><t xml:space="preserve">${xmlText(escapeExcel(s))}</t></si>`).join('') +
      '</sst>',
  );
  return zipSync(files, { level: 6, mtime: now });
}

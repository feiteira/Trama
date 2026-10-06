import type { Element } from '@xmldom/xmldom';
import { columnLetter, rowsToTable } from './csv';
import { ImportError, type ImportedTable, WARNING, warning } from './types';
import { childElements, descendants, firstChild, parseXml, readZip, textContent, zipText } from './xml';

// A minimal .xlsx reader for survey exports (Google Forms, Microsoft Forms, LimeSurvey,
// Qualtrics, REDCap): sheet list, shared and inline strings, numbers, booleans, and dates
// recognised from their number format and written as YYYY-MM-DD. Formulas give their saved
// result. Styling, merged cells and charts are ignored.

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const STRICT = 'http://purl.oclc.org/ooxml/spreadsheetml/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL_STRICT = 'http://purl.oclc.org/ooxml/officeDocument/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

export interface XlsxSheet {
  name: string;
  hidden: boolean;
}

export interface XlsxResult {
  sheets: XlsxSheet[];
  /** Index of the sheet read into `table`. */
  sheet: number;
  table: ImportedTable;
}

export interface XlsxOptions {
  /** Sheet index (from 0) or name. Default: the first visible sheet. */
  sheet?: number | string;
}

/** Resolves a relationship target against the folder of the part that refers to it. */
function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/** Elements by local name in either the transitional or the strict namespace. */
const kids = (el: Element, local: string) => [...childElements(el, MAIN, local), ...childElements(el, STRICT, local)];
const deep = (el: Element, local: string) => [...descendants(el, MAIN, local), ...descendants(el, STRICT, local)];
const kid = (el: Element, local: string) => firstChild(el, MAIN, local) ?? firstChild(el, STRICT, local);

/** Text of a shared or inline string: plain <t> or rich-text runs, without phonetic hints. */
function stringItem(si: Element): string {
  const t = kid(si, 't');
  if (t) return textContent(t);
  return kids(si, 'r')
    .map((r) => {
      const rt = kid(r, 't');
      return rt ? textContent(rt) : '';
    })
    .join('');
}

// Built-in number formats that are dates or times (ECMA-376 18.8.30, plus the CJK ones).
const BUILTIN_DATE = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 57, 58]);
const BUILTIN_TIME = new Set([18, 19, 20, 21, 32, 33, 45, 46, 47, 55, 56]);

type DateKind = 'date' | 'datetime' | 'time' | 'duration' | null;

/** What a custom number format displays: a date, a time, both, an elapsed time, or a number. */
export function formatKind(code: string): DateKind {
  // Only the first section matters for positive numbers; drop literals, colours and locales.
  const first = code.split(';')[0] ?? '';
  const f = first
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/_.|\*./g, '');
  if (/\[(h+|m+|s+)\]/i.test(f)) return 'duration';
  const bare = f.replace(/\[[^\]]*\]/g, '').toLowerCase();
  if (/general|@/.test(bare) && !/[ydhs]/.test(bare.replace('general', ''))) return null;
  const date = /[yd]/.test(bare) || /(^|[^h:])m{3,}/.test(bare);
  const time = /[hs]/.test(bare);
  if (date && time) return 'datetime';
  if (date) return 'date';
  if (time) return 'time';
  return null;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Excel serial date → "YYYY-MM-DD", "YYYY-MM-DD HH:MM[:SS]", "HH:MM[:SS]" or "H:MM:SS". */
export function serialToText(serial: number, kind: Exclude<DateKind, null>, date1904: boolean, seconds: boolean): string {
  if (kind === 'duration') {
    const total = Math.round(serial * 86400);
    return `${Math.floor(total / 3600)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  }
  // Excel's 1900 system counts a 29 February 1900 that never was (serial 60).
  if (!date1904 && Math.floor(serial) === 60 && kind !== 'time') return kind === 'date' ? '1900-02-29' : '1900-02-29 00:00';
  const days = Math.floor(serial);
  let ms = Math.round((serial - days) * 86400) * 1000;
  let dayOffset = days;
  if (ms >= 86400000) {
    ms -= 86400000;
    dayOffset++;
  }
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : dayOffset < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const d = new Date(epoch + dayOffset * 86400000 + ms);
  const ymd = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${seconds ? `:${pad(d.getUTCSeconds())}` : ''}`;
  if (kind === 'date') return ymd;
  if (kind === 'time') return hm;
  return `${ymd} ${hm}`;
}

/** Numbers as Excel shows them in General format: no binary noise (0.1 + 0.2 → 0.3). */
export function formatNumber(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n) || raw.trim() === '') return raw.trim();
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return String(n);
  return String(Number(n.toPrecision(15)));
}

/** "BC12" → column 54 (from 0); -1 when it is not a cell reference. */
function columnOf(ref: string): number {
  const m = /^([A-Z]{1,3})\d*$/i.exec(ref);
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]!.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function rowOf(ref: string): number {
  const m = /(\d+)$/.exec(ref);
  return m ? Number(m[1]) - 1 : -1;
}

interface Workbook {
  files: Record<string, Uint8Array>;
  sheets: (XlsxSheet & { path: string })[];
  date1904: boolean;
  sharedStringsPath: string;
  stylesPath: string;
}

function openWorkbook(bytes: Uint8Array): Workbook {
  // Everything but the worksheets (read on demand) and the media.
  const files = readZip(bytes, (n) => n.endsWith('.xml') || n.endsWith('.rels'));
  const rootRels = zipText(files, '_rels/.rels');
  let wbPath = 'xl/workbook.xml';
  if (rootRels) {
    for (const r of descendants(parseXml(rootRels, 'xlsx').documentElement!, PKG_REL, 'Relationship')) {
      if (/\/officeDocument$/.test(r.getAttribute('Type') ?? '')) wbPath = resolvePath('', r.getAttribute('Target') ?? wbPath);
    }
  }
  const wbXml = zipText(files, wbPath);
  if (!wbXml) throw new ImportError('DAMAGED', 'xlsx', 'workbook.xml missing');
  const wb = parseXml(wbXml, 'xlsx').documentElement!;
  const relsPath = resolvePath(wbPath, `_rels/${wbPath.split('/').pop()}.rels`);
  const targets = new Map<string, string>();
  const dir = wbPath.split('/').slice(0, -1).join('/');
  let sharedStringsPath = `${dir}/sharedStrings.xml`;
  let stylesPath = `${dir}/styles.xml`;
  const relsXml = zipText(files, relsPath);
  if (relsXml) {
    for (const r of descendants(parseXml(relsXml, 'xlsx').documentElement!, PKG_REL, 'Relationship')) {
      const target = resolvePath(wbPath, r.getAttribute('Target') ?? '');
      const type = r.getAttribute('Type') ?? '';
      targets.set(r.getAttribute('Id') ?? '', target);
      if (/\/sharedStrings$/.test(type)) sharedStringsPath = target;
      else if (/\/styles$/.test(type)) stylesPath = target;
    }
  }
  const pr = kid(wb, 'workbookPr');
  const date1904 = /^(1|true)$/i.test(pr?.getAttribute('date1904') ?? '');
  const sheets = deep(wb, 'sheet').map((s) => {
    const id = s.getAttributeNS(REL, 'id') ?? s.getAttributeNS(REL_STRICT, 'id') ?? '';
    return {
      name: s.getAttribute('name') ?? '',
      hidden: /hidden/i.test(s.getAttribute('state') ?? ''),
      path: targets.get(id) ?? '',
    };
  });
  return { files, sheets, date1904, sharedStringsPath, stylesPath };
}

/** The workbook's sheets, for a sheet chooser. */
export function listXlsxSheets(bytes: Uint8Array): XlsxSheet[] {
  return openWorkbook(bytes).sheets.map(({ name, hidden }) => ({ name, hidden }));
}

export function readXlsx(bytes: Uint8Array, name: string, opts: XlsxOptions = {}): XlsxResult {
  const wb = openWorkbook(bytes);
  if (!wb.sheets.length) throw new ImportError('DAMAGED', 'xlsx', 'no sheets');
  let index: number;
  if (typeof opts.sheet === 'number') index = opts.sheet;
  else if (typeof opts.sheet === 'string') index = wb.sheets.findIndex((s) => s.name === opts.sheet);
  else index = Math.max(0, wb.sheets.findIndex((s) => !s.hidden));
  const sheet = wb.sheets[index];
  if (!sheet) throw new ImportError('DAMAGED', 'xlsx', `no sheet ${String(opts.sheet)}`);

  const shared: string[] = [];
  const sstXml = zipText(wb.files, wb.sharedStringsPath);
  if (sstXml) for (const si of kids(parseXml(sstXml, 'xlsx').documentElement!, 'si')) shared.push(stringItem(si));

  const styleKinds: { kind: DateKind; seconds: boolean; percent: boolean }[] = [];
  const stylesXml = zipText(wb.files, wb.stylesPath);
  if (stylesXml) {
    const st = parseXml(stylesXml, 'xlsx').documentElement!;
    const custom = new Map<number, string>();
    const numFmts = kid(st, 'numFmts');
    if (numFmts) for (const f of kids(numFmts, 'numFmt')) custom.set(Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? '');
    const xfs = kid(st, 'cellXfs');
    for (const xf of xfs ? kids(xfs, 'xf') : []) {
      const id = Number(xf.getAttribute('numFmtId') ?? 0);
      const code = custom.get(id);
      let kind: DateKind = null;
      let seconds = false;
      let percent = id === 9 || id === 10;
      if (code !== undefined) {
        const bare = (code.split(';')[0] ?? '').replace(/"[^"]*"/g, '').replace(/\\./g, '');
        kind = formatKind(code);
        seconds = /s/i.test(bare.replace(/\[[^\]]*\]/g, ''));
        percent = !kind && bare.includes('%');
      } else if (BUILTIN_DATE.has(id)) kind = id === 22 ? 'datetime' : 'date';
      else if (BUILTIN_TIME.has(id)) {
        kind = id === 46 ? 'duration' : 'time';
        seconds = [19, 21, 45, 46, 47].includes(id);
      }
      styleKinds.push({ kind, seconds, percent });
    }
  }

  const sheetXml = zipText(wb.files, sheet.path);
  if (sheetXml === null) throw new ImportError('DAMAGED', 'xlsx', `${sheet.path} missing`);
  const ws = parseXml(sheetXml, 'xlsx').documentElement!;
  const data = kid(ws, 'sheetData');
  // Only cells with a value are kept, sparsely: a sheet saved with whole-column formatting has
  // empty <row> elements down to row 1 048 576, and a stray value in column XFD would make every
  // row 16 384 cells wide. Padding those out cost gigabytes for a one-row table.
  const grid = new Map<number, Map<number, string>>();
  const usedCols = new Set<number>();
  let noValue = 0;
  let r = -1;
  for (const row of data ? kids(data, 'row') : []) {
    const rAttr = row.getAttribute('r');
    r = rAttr ? Number(rAttr) - 1 : r + 1;
    if (!Number.isInteger(r) || r < 0 || r > 2_000_000) continue;
    let c = -1;
    for (const cell of kids(row, 'c')) {
      const ref = cell.getAttribute('r') ?? '';
      const col = ref ? columnOf(ref) : -1;
      c = col >= 0 ? col : c + 1;
      if (ref && rowOf(ref) >= 0 && rowOf(ref) !== r) continue;
      if (c > 16383) continue;
      const t = cell.getAttribute('t') ?? 'n';
      const v = kid(cell, 'v');
      const raw = v ? textContent(v) : '';
      let value = '';
      if (t === 's') value = shared[Number(raw)] ?? '';
      else if (t === 'inlineStr') {
        const is = kid(cell, 'is');
        value = is ? stringItem(is) : '';
      } else if (t === 'str') value = raw;
      else if (t === 'b') value = raw === '1' || raw.toLowerCase() === 'true' ? 'TRUE' : 'FALSE';
      else if (t === 'e') value = ''; // #N/A, #DIV/0!: no data
      else if (t === 'd') value = raw.replace(/T00:00:00(?:\.0+)?Z?$/, '').replace('T', ' ').replace(/Z$/, '');
      else if (raw !== '') {
        const style = styleKinds[Number(cell.getAttribute('s') ?? 0)];
        const n = Number(raw);
        if (style?.kind && Number.isFinite(n) && n >= 0) value = serialToText(n, style.kind, wb.date1904, style.seconds);
        else if (style?.percent && Number.isFinite(n)) value = `${formatNumber(String(n * 100))}%`;
        else value = formatNumber(raw);
      }
      if (!v && !kid(cell, 'is') && kid(cell, 'f')) noValue++;
      if (value) {
        let cells = grid.get(r);
        if (!cells) grid.set(r, (cells = new Map()));
        cells.set(c, value);
        usedCols.add(c);
      }
    }
  }
  // Columns no row uses at all are left out (they hold no data), the rest keep their order. Every
  // row gets the same width, so a row ending in empty cells is not reported as ragged.
  const cols = [...usedCols].sort((a, b) => a - b);
  const rows: string[][] = [...grid.keys()]
    .sort((a, b) => a - b)
    .map((k) => {
      const cells = grid.get(k)!;
      return cols.map((col) => cells.get(col) ?? '');
    });
  // A column with data but no header is named by its letter in the sheet, not by its new position.
  const header = rows.find((row) => row.some((v) => v.trim()));
  if (header) cols.forEach((col, k) => {
    if (!header[k]?.trim()) header[k] = columnLetter(col);
  });
  const table = rowsToTable(name, rows);
  if (noValue) table.warnings = [...(table.warnings ?? []), warning(WARNING.formulasWithoutValue, noValue)];
  // Columns before the first used one (A empty, data from B) are not data.
  trimLeadingEmptyColumns(table);
  return { sheets: wb.sheets.map(({ name: n, hidden }) => ({ name: n, hidden })), sheet: index, table };
}

function trimLeadingEmptyColumns(t: ImportedTable): void {
  let lead = 0;
  const isEmptyCol = (k: number) => /^[A-Z]{1,3}$/.test(t.headers[k] ?? '') && t.rows.every((row) => !row[k]);
  while (lead < t.headers.length && isEmptyCol(lead)) lead++;
  if (!lead) return;
  t.headers = t.headers.slice(lead);
  t.rows = t.rows.map((row) => row.slice(lead));
}

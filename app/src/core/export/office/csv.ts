// CSV writer (RFC 4180): fields quoted when needed, CRLF after every row, optional UTF-8 BOM
// so Excel on Windows reads accents correctly instead of guessing the ANSI code page.
import { utf8 } from '../../bytes';

export type CsvCell = string | number | boolean | null | undefined;

export interface CsvOptions {
  /** Field separator. Excel in Portugal and Spain expects ';' when opening by double-click. */
  delimiter?: ',' | ';' | '\t';
  /**
   * Neutralise text that a spreadsheet would run as a formula (CSV injection): a cell starting
   * with = + - @ (or tab / CR) gets a leading apostrophe. On by default: exported segments are
   * participants' words, and "=HYPERLINK(…)" in a quote must stay text.
   */
  guardFormulas?: boolean;
  /**
   * Decimal mark of numbers. By default ',' when the delimiter is ';' — the spreadsheets that
   * expect ';' (Portugal, Spain) do so because the comma is their decimal mark, and would open
   * 0.857 as text, or as 857 where '.' groups thousands — and '.' otherwise.
   */
  decimal?: '.' | ',';
}

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvField(cell: CsvCell, opts: CsvOptions = {}): string {
  const delimiter = opts.delimiter ?? ',';
  let s: string;
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'number') {
    const decimal = opts.decimal ?? (delimiter === ';' ? ',' : '.');
    s = Number.isFinite(cell) ? String(cell) : '';
    if (decimal === ',') s = s.replace('.', ',');
  }
  else if (typeof cell === 'boolean') s = cell ? 'true' : 'false';
  else {
    s = cell;
    // Numbers stay numbers (a negative value is not a formula); only text is guarded.
    if (opts.guardFormulas !== false && FORMULA_START.test(s)) s = `'${s}`;
  }
  return s.includes(delimiter) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows → CSV text, each row ended by CRLF. */
export function toCsv(rows: readonly (readonly CsvCell[])[], opts: CsvOptions = {}): string {
  const delimiter = opts.delimiter ?? ',';
  let out = '';
  for (const row of rows) out += row.map((c) => csvField(c, opts)).join(delimiter) + '\r\n';
  return out;
}

/** CSV as file bytes: UTF-8, with a byte-order mark unless `bom: false`. */
export function csvBytes(rows: readonly (readonly CsvCell[])[], opts: CsvOptions & { bom?: boolean } = {}): Uint8Array {
  return utf8((opts.bom === false ? '' : '﻿') + toCsv(rows, opts));
}

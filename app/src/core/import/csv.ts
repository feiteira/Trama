import Papa, { type ParseError } from 'papaparse';
import { canonicalize } from './text';
import { type ImportedTable, WARNING, warning } from './types';

// CSV/TSV → table. Excel in Portugal and Spain writes ";" (the comma is the decimal
// separator) and sometimes a "sep=;" first line; Google Forms and LimeSurvey write ","; TSV
// comes from copying cells. The delimiter is the candidate that splits the first lines
// (header included) most consistently into more than one column.

const CANDIDATES = [';', ',', '\t', '|'] as const;

export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 64 * 1024);
  let best: string = ',';
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const rows = Papa.parse<string[]>(sample, { delimiter: d, preview: 50, skipEmptyLines: true }).data;
    if (rows.length === 0) continue;
    // When the sample ends mid-file, its last row may be cut short.
    const usable = sample.length < text.length && rows.length > 2 ? rows.slice(0, -1) : rows;
    const counts = usable.map((r) => r.length);
    const freq = new Map<number, number>();
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
    let mode = 1;
    let modeN = 0;
    for (const [c, k] of freq) if (k > modeN || (k === modeN && c > mode)) [mode, modeN] = [c, k];
    if (mode < 2) continue;
    const headerMatches = counts[0] === mode ? 1 : 0;
    // Consistency first, then a header that agrees, then more columns.
    const score = (modeN / counts.length) * 100 + headerMatches * 10 + Math.min(mode, 50) / 50;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/** A1-style column name, for headers left empty. Language-neutral on purpose. */
export function columnLetter(index: number): string {
  let s = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Headers: trimmed, empty ones named by column letter, duplicates numbered. */
export function tidyHeaders(raw: string[], width: number): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (let i = 0; i < width; i++) {
    let h = canonicalize(raw[i] ?? '').replace(/\s+/g, ' ').trim() || columnLetter(i);
    const key = h.toLocaleLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) h = `${h} (${n})`;
    out.push(h);
  }
  return out;
}

/**
 * Rows of cells → a table: the first non-empty row is the header, empty rows go, short rows
 * are padded and the header widened for long ones. Columns with no value in any row (header
 * included) are left out, as readXlsx does: Excel saves every CSV row out to the sheet's used
 * range, so one stray value in column XFD would otherwise make every row 16 384 cells wide.
 * A kept column without a header is named by its letter in the file, not by its new position.
 */
export function rowsToTable(name: string, rows: string[][]): ImportedTable {
  const clean: string[][] = [];
  const lengths: number[] = [];
  for (const r of rows) {
    // Trailing empty cells are dropped before anything else is done to them.
    let end = r.length;
    while (end > 0 && !r[end - 1]!.trim()) end--;
    const row = new Array<string>(end);
    let any = false;
    for (let i = 0; i < end; i++) {
      const c = canonicalize(r[i]!).trim();
      row[i] = c;
      if (c) any = true;
    }
    if (!any) continue;
    clean.push(row);
    lengths.push(r.length);
  }
  const [header = [], ...body] = clean;
  const headerLength = lengths[0] ?? 0;
  // A loop, not Math.max(...rows): a spread of 100 000 rows overflows the call stack.
  let width = 0;
  for (const r of clean) width = Math.max(width, r.length);
  const used = new Uint8Array(width);
  for (const r of clean) for (let i = 0; i < r.length; i++) if (r[i]) used[i] = 1;
  const cols: number[] = [];
  for (let i = 0; i < width; i++) if (used[i]) cols.push(i);
  const every = cols.length === width;
  let ragged = 0;
  // Ragged compares the rows as written: a row Excel padded to the header's width is not ragged.
  const out = body.map((r, k) => {
    if (lengths[k + 1] !== headerLength) ragged++;
    if (!every) return cols.map((c) => r[c] ?? '');
    return r.length < width ? [...r, ...Array<string>(width - r.length).fill('')] : r;
  });
  const warnings = ragged ? [warning(WARNING.raggedRows, ragged)] : [];
  const names = cols.map((c) => header[c] || columnLetter(c));
  return { name, headers: cols.length ? tidyHeaders(names, cols.length) : [], rows: out, warnings };
}

export interface CsvOptions {
  /** Force a delimiter (TSV files, or the researcher's choice). */
  delimiter?: string;
}

/** Parses CSV text (already decoded) into a table. */
export function parseCsv(text: string, name: string, opts: CsvOptions = {}): ImportedTable {
  let body = text.replace(/^\u{feff}/u, '');
  let delimiter = opts.delimiter;
  // Excel's "sep=;" line names the delimiter.
  const sep = /^sep=(.)\r?\n/i.exec(body);
  if (sep) {
    body = body.slice(sep[0].length);
    delimiter ??= sep[1]!;
  }
  delimiter ??= detectDelimiter(body);
  const parsed = Papa.parse<string[]>(body, { delimiter, skipEmptyLines: 'greedy' });
  const table = rowsToTable(name, parsed.data);
  // An unbalanced quote swallows the following lines into one cell: the next respondents vanish
  // and their answers are attributed to someone else, invisibly once imported. Say where.
  const lines = quoteErrorLines(body, parsed.errors, sep ? 2 : 1);
  if (lines.length) table.warnings = [warning(WARNING.malformedQuotes, lines.join(',')), ...(table.warnings ?? [])];
  return table;
}

/** File line numbers (from 1) where Papa found a broken quoted field. */
function quoteErrorLines(body: string, errors: ParseError[], firstLine: number): number[] {
  const at = errors.flatMap((e) => (e.type === 'Quotes' && typeof e.index === 'number' ? [e.index] : [])).sort((a, b) => a - b);
  const lines: number[] = [];
  let line = firstLine;
  let pos = 0;
  for (const index of at) {
    for (; pos < index && pos < body.length; pos++) if (body.charCodeAt(pos) === 10) line++;
    if (lines[lines.length - 1] !== line) lines.push(line);
  }
  return lines;
}

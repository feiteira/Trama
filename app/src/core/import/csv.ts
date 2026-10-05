import Papa from 'papaparse';
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
 * are padded and the header widened for long ones.
 */
export function rowsToTable(name: string, rows: string[][]): ImportedTable {
  const cleanRows = rows.map((r) => r.map((c) => canonicalize(c).trim())).filter((r) => r.some((c) => c));
  const [header = [], ...body] = cleanRows;
  // reduce, not Math.max(...rows): a spread of 100 000 rows overflows the call stack.
  const width = body.reduce((w, r) => Math.max(w, r.length), header.length);
  let ragged = 0;
  const out = body.map((r) => {
    if (r.length !== header.length) ragged++;
    return r.length < width ? [...r, ...Array<string>(width - r.length).fill('')] : r;
  });
  const warnings = ragged ? [warning(WARNING.raggedRows, ragged)] : [];
  return { name, headers: width ? tidyHeaders(header, width) : [], rows: out, warnings };
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
  return rowsToTable(name, parsed.data);
}

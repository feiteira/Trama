// Numbers, file names and export tables for the analysis tools.

/** A count or measure for display: integers as they are, others with up to `digits` decimals. */
export function formatValue(v: number | null | undefined, locale: string, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: Number.isInteger(v) ? 0 : digits }).format(v);
}

/** A number with exactly `digits` decimals, in the reader's locale ("0.50" / "0,50"). */
export function formatFixed(v: number | null | undefined, locale: string, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}

/** A percentage with one decimal ("12.5 %" / "12,5 %" by locale). */
export function formatPercent(v: number | null | undefined, locale: string, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: digits, minimumFractionDigits: v === 0 || v === 100 ? 0 : Math.min(1, digits) }).format(v / 100);
}

/** A p-value as reported in papers: "< 0.001" or three decimals. */
export function formatP(p: number, locale: string): string {
  if (!Number.isFinite(p)) return '–';
  const nf = new Intl.NumberFormat(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  return p < 0.001 ? `< ${nf.format(0.001)}` : nf.format(p);
}

/** A file name from a title: no path separators or characters file systems refuse. */
export function safeFileName(name: string, ext: string): string {
  const base = name.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Trama';
  return `${base}.${ext}`;
}

export type Cell = string | number | null;

/**
 * A matrix as table rows: a header (corner label, column labels, optional total), one row per
 * row label, and an optional totals row.
 */
export function matrixRows(
  corner: string,
  rowLabels: readonly string[],
  colLabels: readonly string[],
  cells: readonly (readonly (number | null)[])[],
  totals?: { label: string; rows: readonly number[]; cols: readonly number[]; grand: number },
): Cell[][] {
  const out: Cell[][] = [[corner, ...colLabels, ...(totals ? [totals.label] : [])]];
  rowLabels.forEach((label, r) => {
    out.push([label, ...(cells[r] ?? []).map((v) => (v === null || !Number.isFinite(v) ? null : round(v))), ...(totals ? [round(totals.rows[r] ?? 0)] : [])]);
  });
  if (totals) out.push([totals.label, ...totals.cols.map(round), round(totals.grand)]);
  return out;
}

const round = (v: number) => (Number.isInteger(v) ? v : Math.round(v * 1000) / 1000);

/** "Wellbeing › Belonging" style label for exports, indented by depth for on-screen tables. */
export const pathLabel = (path: readonly string[]): string => path.join(' › ');

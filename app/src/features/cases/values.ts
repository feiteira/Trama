// The cases table as data: rows, typed values shown and edited in the reader's language,
// sorting, filtering and the export table. Pure (no React, no store).

import type { Attribute, AttributeType, AttributeValue, Case } from '../../core/model/types';
import { fold } from '../../core/text/normalize';
import { coerceValue, type Coerced } from '../../services/cases';

export interface CaseDoc {
  id: string;
  name: string;
  codings: number;
}

export interface CaseRow {
  case: Case;
  documents: CaseDoc[];
  /** Coded segments in the case's documents. */
  codings: number;
}

export interface ValueFormat {
  /** BCP 47 tag of the interface language. */
  bcp47: string;
  yes: string;
  no: string;
}

/** Builds the rows: each case with its documents (in list order) and their coded segments. */
export function buildRows(cases: readonly Case[], docs: readonly { id: string; name: string; case_id: string | null; codings: number }[]): CaseRow[] {
  const byCase = new Map<string, CaseDoc[]>();
  for (const d of docs) {
    if (!d.case_id) continue;
    let list = byCase.get(d.case_id);
    if (!list) byCase.set(d.case_id, (list = []));
    list.push({ id: d.id, name: d.name, codings: d.codings });
  }
  return cases.map((c) => {
    const documents = byCase.get(c.id) ?? [];
    return { case: c, documents, codings: documents.reduce((n, d) => n + d.codings, 0) };
  });
}

const numberFormats = new Map<string, Intl.NumberFormat>();
function numberFormat(bcp47: string, grouping: boolean): Intl.NumberFormat {
  const k = `${bcp47}|${grouping}`;
  let f = numberFormats.get(k);
  if (!f) numberFormats.set(k, (f = new Intl.NumberFormat(bcp47, { maximumFractionDigits: 6, useGrouping: grouping })));
  return f;
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();
function dateFormat(bcp47: string): Intl.DateTimeFormat {
  let f = dateFormats.get(bcp47);
  if (!f) dateFormats.set(bcp47, (f = new Intl.DateTimeFormat(bcp47, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })));
  return f;
}

/** A value as the grid shows it ("" for none). */
export function formatValue(type: AttributeType, value: AttributeValue | undefined, fmt: ValueFormat): string {
  if (value === null || value === undefined || value === '') return '';
  switch (type) {
    case 'number':
      return typeof value === 'number' ? numberFormat(fmt.bcp47, true).format(value) : String(value);
    case 'date': {
      const m = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
      return m ? dateFormat(fmt.bcp47).format(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : String(value);
    }
    case 'boolean':
      return value === true ? fmt.yes : value === false ? fmt.no : String(value);
    default:
      return String(value);
  }
}

/** A value as its editor starts with it: numbers in the reader's decimal mark, dates as ISO. */
export function editText(type: AttributeType, value: AttributeValue | undefined, bcp47: string): string {
  if (value === null || value === undefined) return '';
  if (type === 'number' && typeof value === 'number') return numberFormat(bcp47, false).format(value);
  return String(value);
}

/** What the researcher typed, converted to the attribute's type. */
export function parseInput(type: AttributeType, raw: string): Coerced {
  return coerceValue(type, raw);
}

// ---------------------------------------------------------------------------------------------
// Sorting and filtering

export type SortKey = { kind: 'name' } | { kind: 'documents' } | { kind: 'codings' } | { kind: 'attr'; id: string };
export interface Sort {
  key: SortKey;
  dir: 'asc' | 'desc';
}

export const sortKeyId = (k: SortKey): string => (k.kind === 'attr' ? `attr:${k.id}` : k.kind);

function compareValues(type: AttributeType, a: AttributeValue, b: AttributeValue, collator: Intl.Collator): number {
  if (type === 'number' && typeof a === 'number' && typeof b === 'number') return a - b;
  if (type === 'boolean' && typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  if (type === 'date') return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  return collator.compare(String(a), String(b));
}

/**
 * Rows in the chosen order. Empty values go last whichever the direction; ties fall back to
 * the case name, so the order is stable while values are edited.
 */
export function sortRows(rows: readonly CaseRow[], sort: Sort | null, attrs: readonly Attribute[], bcp47: string): CaseRow[] {
  const collator = new Intl.Collator(bcp47, { sensitivity: 'base', numeric: true });
  const byName = (a: CaseRow, b: CaseRow) => collator.compare(a.case.name, b.case.name) || (a.case.id < b.case.id ? -1 : 1);
  const out = [...rows];
  if (!sort) return out.sort(byName);
  const sign = sort.dir === 'asc' ? 1 : -1;
  const key = sort.key;
  if (key.kind === 'name') return out.sort((a, b) => sign * byName(a, b));
  if (key.kind === 'documents') return out.sort((a, b) => sign * (a.documents.length - b.documents.length) || byName(a, b));
  if (key.kind === 'codings') return out.sort((a, b) => sign * (a.codings - b.codings) || byName(a, b));
  const attr = attrs.find((x) => x.id === key.id);
  if (!attr) return out.sort(byName);
  return out.sort((a, b) => {
    const va = a.case.values[attr.id] ?? null;
    const vb = b.case.values[attr.id] ?? null;
    if (va === null && vb === null) return byName(a, b);
    if (va === null) return 1;
    if (vb === null) return -1;
    return sign * compareValues(attr.type, va, vb, collator) || byName(a, b);
  });
}

/** Clicking a column header: ascending, then descending, then back to the name order. */
export function nextSort(cur: Sort | null, key: SortKey): Sort | null {
  if (!cur || sortKeyId(cur.key) !== sortKeyId(key)) return { key, dir: 'asc' };
  if (cur.dir === 'asc') return { key, dir: 'desc' };
  return null;
}

/**
 * Rows matching every word of the query in the case's name, description, document names or
 * shown values (accents and case ignored).
 */
export function filterRows(rows: readonly CaseRow[], query: string, attrs: readonly Attribute[], fmt: ValueFormat): CaseRow[] {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return [...rows];
  return rows.filter((r) => {
    const hay = fold(
      [r.case.name, r.case.description, ...r.documents.map((d) => d.name), ...attrs.map((a) => formatValue(a.type, r.case.values[a.id], fmt))].join('\n'),
    );
    return words.every((w) => hay.includes(w));
  });
}

// ---------------------------------------------------------------------------------------------
// Export

export interface ExportHeaders {
  case: string;
  description: string;
  documents: string;
  codings: string;
}

export type ExportCell = string | number | boolean | null;

/**
 * The cases table for CSV/XLSX: one row per case with its description, document names, each
 * attribute's value (numbers stay numbers, dates ISO) and the coded segment count.
 */
export function exportTable(rows: readonly CaseRow[], attrs: readonly Attribute[], headers: ExportHeaders): ExportCell[][] {
  const head: ExportCell[] = [headers.case, headers.description, headers.documents, ...attrs.map((a) => a.name), headers.codings];
  return [
    head,
    ...rows.map((r): ExportCell[] => [
      r.case.name,
      r.case.description,
      r.documents.map((d) => d.name).join('; '),
      ...attrs.map((a) => r.case.values[a.id] ?? null),
      r.codings,
    ]),
  ];
}

/** A file name from the project name: no characters that file systems refuse. */
export function safeFileName(name: string, fallback: string): string {
  const s = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return s || fallback;
}

// ---------------------------------------------------------------------------------------------
// Attribute type changes

/** How many cases hold a value that would be cleared by turning the attribute into `type`. */
export function lostOnTypeChange(attr: Attribute, type: AttributeType, cases: readonly Case[], options?: readonly string[]): number {
  if (type === attr.type) return 0;
  let lost = 0;
  const opts = options?.map((o) => fold(o));
  for (const c of cases) {
    const v = c.values[attr.id];
    if (v === undefined || v === null) continue;
    const r = coerceValue(type, v);
    if (!r.ok || r.value === null) lost++;
    // Turning into a choice keeps every value (they become options) unless options are given.
    else if (type === 'choice' && opts && opts.length && typeof r.value === 'string' && !opts.includes(fold(r.value))) lost++;
  }
  return lost;
}

/** Choice options typed one per line: trimmed, empty lines and repeats dropped. */
export function parseOptions(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const o = line.replace(/\s+/g, ' ').trim();
    if (!o || seen.has(fold(o))) continue;
    seen.add(fold(o));
    out.push(o);
  }
  return out;
}

/** A name not yet taken among `taken` ("Case 4" when Case 1–3 exist). */
export function nextName(base: (n: number) => string, taken: Iterable<string>): string {
  const set = new Set([...taken].map((t) => fold(t)));
  for (let n = 1; ; n++) {
    const name = base(n);
    if (!set.has(fold(name))) return name;
  }
}

/**
 * Keeps the previous row object where nothing in it changed, so memoised grid rows skip
 * rendering when a load brings the same data (a coding added elsewhere reloads the table).
 */
export function stabilise(prev: ReadonlyMap<string, CaseRow>, next: readonly CaseRow[]): CaseRow[] {
  return next.map((r) => {
    const p = prev.get(r.case.id);
    if (
      p &&
      p.case.updated_at_hlc === r.case.updated_at_hlc &&
      p.codings === r.codings &&
      p.documents.length === r.documents.length &&
      p.documents.every((d, i) => d.id === r.documents[i]!.id && d.name === r.documents[i]!.name && d.codings === r.documents[i]!.codings)
    ) {
      return p;
    }
    return r;
  });
}

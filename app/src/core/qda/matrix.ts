// Code × document matrix (MAXQDA's Code Matrix Browser, NVivo's matrix coding query with
// documents or cases as columns), with columns optionally grouped by document group, case or
// case attribute value.
//
// Measures for a cell (code row × column of documents):
//   segments      coded segments of the code (with includeChildren, of its descendants too);
//   characters    characters coded at least once with the code: overlapping segments are not
//                 counted twice;
//   presence      documents in the column where the code occurs (0/1 for a single document);
//   percentOfDoc  characters / characters of the column's documents × 100 (coverage).
// Row totals are over the distinct documents of all columns (a document in two groups counts
// once). Column totals are over all rows without double counting a segment or a character that
// several rows share (a parent and a child); for presence the column total is the number of
// codes that occur in the column. The grand total follows the column rule over all documents.

import type { Attribute, Case, Code, Coding, DocGroup, Document } from '../model/types';
import { type BinSpec, type BucketKind, attributeBuckets, attributeValue } from './attributes';
import { type Descendants, type Span, codeRows, groupBy, mergeSpans, totalLength } from './util';

export type MatrixMeasure = 'segments' | 'characters' | 'presence' | 'percentOfDoc';

export type DocumentGrouping =
  | { by: 'document' }
  | { by: 'group'; groups: readonly DocGroup[] }
  | { by: 'case'; cases: readonly Case[] }
  | { by: 'attribute'; cases: readonly Case[]; attribute: Attribute; bins?: BinSpec };

export type ColumnKind = 'document' | 'group' | 'case' | 'nocase' | BucketKind;

export interface MatrixColumn {
  /** Document, group or case id, or the attribute bucket key. 'nocase' for documents without a case. */
  key: string;
  kind: ColumnKind;
  /** Name, or the bucket's language-neutral label ("(no value)", "18–29"…). */
  label: string;
  documentIds: string[];
  /** Characters in the column's documents. */
  chars: number;
}

export interface CodeMatrix {
  measure: MatrixMeasure;
  /** Code ids, in the order given. */
  rows: string[];
  cols: MatrixColumn[];
  /** cells[row][col]. */
  cells: number[][];
  rowTotals: number[];
  colTotals: number[];
  grandTotal: number;
}

export interface MatrixOptions {
  measure: MatrixMeasure;
  includeChildren?: boolean;
  descendants?: Descendants;
  groupBy?: DocumentGrouping;
}

interface DocStats {
  chars: number;
  segs: number[];
  coded: number[];
  /** Distinct codings counting for any row, and characters coded by any row. */
  allSegs: number;
  allCoded: number;
}

/** Per document and row: segment counts and coded characters (union of spans). */
export function documentCodeStats(
  codings: readonly Coding[],
  codeIds: readonly string[],
  documents: readonly Document[],
  includeChildren?: boolean,
  descendants?: Descendants,
): Map<string, DocStats> {
  const rows = codeRows(codeIds, includeChildren, descendants);
  const k = codeIds.length;
  const byDoc = groupBy(
    codings.filter((c) => !c.deleted && rows.has(c.code_id)),
    (c) => c.document_id,
  );
  const out = new Map<string, DocStats>();
  for (const d of documents) {
    if (d.deleted || out.has(d.id)) continue;
    const list = byDoc.get(d.id) ?? [];
    const spans: Span[][] = Array.from({ length: k }, () => []);
    const segs = new Array<number>(k).fill(0);
    const all: Span[] = [];
    // Clamp to the document's length so coverage never exceeds 100 % on stale offsets.
    const clamp = (x: number) => (d.chars > 0 ? Math.max(0, Math.min(x, d.chars)) : x);
    for (const c of list) {
      const s = { start: clamp(c.start), end: clamp(c.end) };
      for (const r of rows.get(c.code_id)!) {
        segs[r]!++;
        spans[r]!.push(s);
      }
      all.push(s);
    }
    out.set(d.id, {
      chars: d.chars,
      segs,
      coded: spans.map((l) => totalLength(mergeSpans(l))),
      allSegs: list.length,
      allCoded: totalLength(mergeSpans(all)),
    });
  }
  return out;
}

/** Columns for a grouping of the (live) documents. */
export function documentColumns(documents: readonly Document[], grouping: DocumentGrouping = { by: 'document' }): MatrixColumn[] {
  const docs = documents.filter((d) => !d.deleted);
  const charsOf = (ids: string[]) => {
    const set = new Set(ids);
    return docs.filter((d) => set.has(d.id)).reduce((s, d) => s + d.chars, 0);
  };
  const col = (key: string, kind: ColumnKind, label: string, documentIds: string[]): MatrixColumn => ({
    key,
    kind,
    label,
    documentIds,
    chars: charsOf(documentIds),
  });
  switch (grouping.by) {
    case 'document': {
      const seen = new Set<string>();
      return docs.filter((d) => !seen.has(d.id) && seen.add(d.id)).map((d) => col(d.id, 'document', d.name, [d.id]));
    }
    case 'group':
      return grouping.groups
        .filter((g) => !g.deleted)
        .map((g) => col(g.id, 'group', g.name, docs.filter((d) => d.group_ids.includes(g.id)).map((d) => d.id)));
    case 'case': {
      const cases = grouping.cases.filter((c) => !c.deleted);
      const known = new Set(cases.map((c) => c.id));
      const cols = cases.map((c) => col(c.id, 'case', c.name, docs.filter((d) => d.case_id === c.id).map((d) => d.id)));
      const none = docs.filter((d) => d.case_id === null || !known.has(d.case_id)).map((d) => d.id);
      if (none.length) cols.push(col('nocase', 'nocase', '(no case)', none));
      return cols;
    }
    case 'attribute': {
      const caseById = new Map(grouping.cases.filter((c) => !c.deleted).map((c) => [c.id, c]));
      const b = attributeBuckets(grouping.cases, grouping.attribute, grouping.bins);
      const members = new Map<string, string[]>();
      for (const d of docs) {
        const c = d.case_id !== null ? caseById.get(d.case_id) : undefined;
        const key = b.keyOf(attributeValue(c, grouping.attribute.id));
        const l = members.get(key);
        if (l) l.push(d.id);
        else members.set(key, [d.id]);
      }
      return b.buckets.map((bk) => col(bk.key, bk.kind, bk.label, members.get(bk.key) ?? []));
    }
  }
}

const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);

export function codeDocumentMatrix(
  codings: readonly Coding[],
  codes: readonly (Code | string)[],
  documents: readonly Document[],
  opts: MatrixOptions,
): CodeMatrix {
  const rows = [...new Set(codes.map((c) => (typeof c === 'string' ? c : c.id)))];
  const cols = documentColumns(documents, opts.groupBy);
  const stats = documentCodeStats(codings, rows, documents, opts.includeChildren, opts.descendants);
  const m = opts.measure;

  const cell = (r: number, docIds: readonly string[]): number => {
    let segs = 0;
    let coded = 0;
    let present = 0;
    let chars = 0;
    for (const id of docIds) {
      const s = stats.get(id);
      if (!s) continue;
      segs += s.segs[r]!;
      coded += s.coded[r]!;
      if (s.segs[r]! > 0) present++;
      chars += s.chars;
    }
    switch (m) {
      case 'segments':
        return segs;
      case 'characters':
        return coded;
      case 'presence':
        return present;
      case 'percentOfDoc':
        return pct(coded, chars);
    }
  };
  const allRows = (docIds: readonly string[]): number => {
    let segs = 0;
    let coded = 0;
    let chars = 0;
    for (const id of docIds) {
      const s = stats.get(id);
      if (!s) continue;
      segs += s.allSegs;
      coded += s.allCoded;
      chars += s.chars;
    }
    return m === 'segments' ? segs : m === 'characters' ? coded : pct(coded, chars);
  };

  const cells = rows.map((_, r) => cols.map((c) => cell(r, c.documentIds)));
  const universe = [...new Set(cols.flatMap((c) => c.documentIds))];
  const rowTotals = rows.map((_, r) => cell(r, universe));
  const colTotals = cols.map((c, j) => (m === 'presence' ? cells.filter((row) => row[j]! > 0).length : allRows(c.documentIds)));
  const grandTotal = m === 'presence' ? rowTotals.filter((x) => x > 0).length : allRows(universe);
  return { measure: m, rows, cols, cells, rowTotals, colTotals, grandTotal };
}

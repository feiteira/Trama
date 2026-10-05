// Code × attribute crosstab (MAXQDA's Crosstab, NVivo's matrix coding by attribute value).
// Rows are codes; columns are buckets of one case attribute (values, ranges, "(no value)").
//
// Measures: 'segments' counts coded segments in the bucket's documents; 'documents' counts
// documents with at least one segment of the code; 'cases' counts cases with at least one
// segment of the code in any of their documents. Documents without a case fall in "(no value)"
// for segments and documents, and are left out of the cases measure (there is no case to count).

import type { Attribute, Case, Code, Coding, Document } from '../model/types';
import { type BinSpec, type Bucket, attributeBuckets, attributeValue } from './attributes';
import { type ChiSquareResult, chiSquareTest } from './stats';
import { type Descendants, codeRows } from './util';

export type CrosstabMeasure = 'segments' | 'documents' | 'cases';
export type PercentMode = 'none' | 'row' | 'column';

export interface CrosstabOptions {
  measure: CrosstabMeasure;
  /**
   * 'row': share of the row total. 'column': for documents and cases, the share of the bucket's
   * documents or cases that have the code (its `base`); for segments, the share of the column's
   * segments. Undefined shares (a zero denominator) are null.
   */
  percent?: PercentMode;
  /** Number attributes: distinct values, quantile bins or ranges (default: see attributeBuckets). */
  bins?: BinSpec;
  includeChildren?: boolean;
  descendants?: Descendants;
}

export interface Crosstab {
  attributeId: string;
  measure: CrosstabMeasure;
  percent: PercentMode;
  /** Code ids, in the order given. */
  rows: string[];
  buckets: Bucket[];
  counts: number[][];
  /** Present when percent is 'row' or 'column'. */
  percents: (number | null)[][] | null;
  rowTotals: number[];
  /**
   * Distinct segments / documents / cases with any of the row codes in the bucket (a segment
   * that counts for a parent and its child is counted once).
   */
  colTotals: number[];
  grandTotal: number;
  /**
   * Units in each bucket: documents (segments and documents measures) or cases that have at
   * least one document (cases measure; a case without documents has no data to code).
   */
  bases: number[];
  /**
   * Documents and cases measures: per code, Pearson's chi-square on the 2 × buckets table
   * (with the code / without it), leaving out "(no value)" and "(other)". Null when not
   * computable (fewer than two non-empty buckets, or the code is in all or none of the units).
   */
  tests: (ChiSquareResult | null)[];
}

export function codeAttributeCrosstab(
  codings: readonly Coding[],
  codes: readonly (Code | string)[],
  documents: readonly Document[],
  cases: readonly Case[],
  attribute: Attribute,
  opts: CrosstabOptions,
): Crosstab {
  const rowIds = [...new Set(codes.map((c) => (typeof c === 'string' ? c : c.id)))];
  const rowsOf = codeRows(rowIds, opts.includeChildren, opts.descendants);
  const measure = opts.measure;
  const liveCases = cases.filter((c) => !c.deleted);
  const caseById = new Map(liveCases.map((c) => [c.id, c]));
  const b = attributeBuckets(liveCases, attribute, opts.bins);

  // Each live document's bucket, and its case (when the case is known and live).
  const docs = documents.filter((d) => !d.deleted);
  const docBucket = new Map<string, string>();
  const docCase = new Map<string, string>();
  for (const d of docs) {
    const c = d.case_id !== null ? caseById.get(d.case_id) : undefined;
    docBucket.set(d.id, b.keyOf(attributeValue(c, attribute.id)));
    if (c) docCase.set(d.id, c.id);
  }
  // Read after keyOf: a value outside the case list adds the "(other)" bucket.
  const buckets = b.buckets;
  const col = new Map(buckets.map((bk, j) => [bk.key, j]));
  const R = rowIds.length;
  const B = buckets.length;
  const counts = Array.from({ length: R }, () => new Array<number>(B).fill(0));
  const colUnits = Array.from({ length: B }, () => new Set<string>());
  const colSegs = new Array<number>(B).fill(0);
  const unitSets = Array.from({ length: R }, () => Array.from({ length: B }, () => new Set<string>()));

  for (const c of codings) {
    if (c.deleted) continue;
    const rows = rowsOf.get(c.code_id);
    const key = docBucket.get(c.document_id);
    if (!rows || key === undefined) continue;
    const j = col.get(key)!;
    if (measure === 'segments') {
      for (const r of rows) counts[r]![j]!++;
      colSegs[j]!++;
      continue;
    }
    const unit = measure === 'documents' ? c.document_id : docCase.get(c.document_id);
    if (unit === undefined) continue;
    for (const r of rows) unitSets[r]![j]!.add(unit);
    colUnits[j]!.add(unit);
  }
  if (measure !== 'segments') for (let r = 0; r < R; r++) for (let j = 0; j < B; j++) counts[r]![j] = unitSets[r]![j]!.size;

  const bases = new Array<number>(B).fill(0);
  if (measure === 'cases') {
    const withDocs = new Set<string>();
    for (const d of docs) {
      const cid = docCase.get(d.id);
      if (cid !== undefined && !withDocs.has(cid)) {
        withDocs.add(cid);
        bases[col.get(docBucket.get(d.id)!)!]!++;
      }
    }
  } else for (const d of docs) bases[col.get(docBucket.get(d.id)!)!]!++;

  const rowTotals = counts.map((row) => row.reduce((s, x) => s + x, 0));
  const colTotals = measure === 'segments' ? colSegs : colUnits.map((s) => s.size);
  const grandTotal = colTotals.reduce((s, x) => s + x, 0);
  const percent = opts.percent ?? 'none';
  let percents: (number | null)[][] | null = null;
  if (percent !== 'none') {
    percents = counts.map((row, r) =>
      row.map((x, j) => {
        const base = percent === 'row' ? rowTotals[r]! : measure === 'segments' ? colTotals[j]! : bases[j]!;
        return base > 0 ? (x / base) * 100 : null;
      }),
    );
  }

  const tested = buckets.map((bk, j) => (bk.kind === 'empty' || bk.kind === 'other' ? -1 : j)).filter((j) => j >= 0);
  const tests = counts.map((row) => {
    if (measure === 'segments') return null;
    return chiSquareTest([tested.map((j) => row[j]!), tested.map((j) => bases[j]! - row[j]!)]);
  });

  return { attributeId: attribute.id, measure, percent, rows: rowIds, buckets, counts, percents, rowTotals, colTotals, grandTotal, bases, tests };
}

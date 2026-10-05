// Keyword-in-context results as the screen shows them: grouped by document in list order, with
// per-document counts, optionally narrowed to the segments of a code, and flattened into the
// rows of a virtual list.

import type { KwicRow, SearchHit } from '../../../core/qda/search';
import { type Span, mergeSpans, upperBound } from '../../../core/qda/util';

export interface KwicGroup {
  documentId: string;
  name: string;
  rows: KwicRow[];
  /** Hits in the document (all of them, also those past the display limit). */
  total: number;
}

/** Groups rows by document, in the order of `docs` (the document list); unknown documents last. */
export function groupKwic(rows: readonly KwicRow[], docs: readonly { id: string; name: string }[], totals?: ReadonlyMap<string, number>): KwicGroup[] {
  const byDoc = new Map<string, KwicRow[]>();
  for (const r of rows) {
    const l = byDoc.get(r.documentId);
    if (l) l.push(r);
    else byDoc.set(r.documentId, [r]);
  }
  const out: KwicGroup[] = [];
  const seen = new Set<string>();
  for (const d of docs) {
    const list = byDoc.get(d.id);
    seen.add(d.id);
    if (!list && !(totals?.get(d.id) ?? 0)) continue;
    out.push({ documentId: d.id, name: d.name, rows: list ?? [], total: Math.max(totals?.get(d.id) ?? 0, list?.length ?? 0) });
  }
  for (const [id, list] of byDoc) if (!seen.has(id)) out.push({ documentId: id, name: id, rows: list, total: Math.max(totals?.get(id) ?? 0, list.length) });
  return out;
}

/**
 * The hits that lie inside a span of `spans` (per document, any overlap of spans allowed).
 * Used for "search within the segments of a code".
 */
export function hitsWithin<T extends { documentId: string; start: number; end: number }>(hits: readonly T[], spans: ReadonlyMap<string, readonly Span[]>): T[] {
  const merged = new Map<string, { starts: number[]; list: Span[] }>();
  for (const [doc, list] of spans) {
    const m = mergeSpans(list);
    merged.set(doc, { starts: m.map((s) => s.start), list: m });
  }
  return hits.filter((h) => {
    const m = merged.get(h.documentId);
    if (!m) return false;
    const i = upperBound(m.starts, h.start) - 1;
    const s = i >= 0 ? m.list[i] : undefined;
    return !!s && s.start <= h.start && h.end <= s.end;
  });
}

/** Hits per document. */
export function countPerDocument(hits: readonly { documentId: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const h of hits) m.set(h.documentId, (m.get(h.documentId) ?? 0) + 1);
  return m;
}

export type KwicItem =
  | { kind: 'doc'; key: string; group: KwicGroup; collapsed: boolean }
  | { kind: 'hit'; key: string; row: KwicRow; group: KwicGroup; index: number };

/** The virtual list's rows: a heading per document, then its hits unless collapsed. */
export function flattenKwic(groups: readonly KwicGroup[], collapsed: ReadonlySet<string>): KwicItem[] {
  const out: KwicItem[] = [];
  for (const g of groups) {
    const c = collapsed.has(g.documentId);
    out.push({ kind: 'doc', key: `d:${g.documentId}`, group: g, collapsed: c });
    if (c) continue;
    g.rows.forEach((row, index) => out.push({ kind: 'hit', key: `h:${g.documentId}:${row.start}:${row.end}`, row, group: g, index }));
  }
  return out;
}

/** Rows for a CSV/XLSX export of the hits (header first). */
export function kwicExportRows(groups: readonly KwicGroup[], header: readonly string[]): (string | number)[][] {
  const rows: (string | number)[][] = [[...header]];
  for (const g of groups) for (const r of g.rows) rows.push([g.name, r.start, r.end, r.left, r.keyword, r.right]);
  return rows;
}

/** SearchHit → the span shape autocoding wants. */
export const hitSpan = (h: SearchHit | KwicRow) => ({ documentId: h.documentId, start: h.start, end: h.end });

// Retrieval of coded segments: filters (codes, documents, groups, cases, attributes, coders,
// overlap with other codes), sorting, and the paragraph context around a segment.

import type { Attribute, Case, Code, Coding, Document } from '../model/types';
import { type AttributeCondition, attributeValue, meetsCondition } from './attributes';
import { lineIndex } from './text';
import { type Descendants, type Span, descendantIds, groupBy, lowerBound } from './util';

export type { AttributeCondition } from './attributes';

export type OverlapMode = 'overlap' | 'within' | 'contains';

export interface SegmentFilter {
  /**
   * Every list filter follows the same rule: undefined means "no constraint", an empty list
   * means "nothing matches" (no code activated → no segments).
   */
  codeIds?: readonly string[];
  /** Segments of the selected codes' descendants count too (needs ctx.descendants). */
  includeChildren?: boolean;
  documentIds?: readonly string[];
  /** Documents in any of these groups (needs ctx.documents). */
  groupIds?: readonly string[];
  /** Documents belonging to any of these cases (needs ctx.documents). */
  caseIds?: readonly string[];
  /** Conditions on the document's case (needs ctx.documents and ctx.cases). */
  attributeConditions?: readonly AttributeCondition[];
  /** How conditions combine (default 'all'). */
  attributeMatch?: 'all' | 'any';
  coderIds?: readonly string[];
  /**
   * Keep only segments that relate to a segment of these codes in the same document:
   * 'overlap' shares at least one character, 'within' lies inside it, 'contains' encloses it.
   * A segment never relates to itself.
   */
  overlapWith?: {
    codeIds: readonly string[];
    mode: OverlapMode;
    includeChildren?: boolean;
    /** Only the same coder's segments count (default false: anyone's). */
    sameCoder?: boolean;
  };
}

export interface SegmentContext {
  documents?: readonly Document[];
  cases?: readonly Case[];
  attributes?: readonly Attribute[];
  descendants?: Descendants;
}

function need<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`filterCodings: ${what} needed for this filter`);
  return v;
}

function codeSet(ids: readonly string[], includeChildren: boolean | undefined, descendants: Descendants | undefined): Set<string> {
  const s = new Set(ids);
  if (includeChildren) {
    const d = need(descendants, 'ctx.descendants');
    for (const id of ids) for (const x of descendantIds(d, id)) s.add(x);
  }
  return s;
}

/** Codings of one document sorted by start, with a running maximum of ends for overlap lookups. */
interface DocIndex {
  items: Coding[];
  starts: number[];
  maxEnd: number[];
}

function indexByDocument(codings: readonly Coding[]): Map<string, DocIndex> {
  const out = new Map<string, DocIndex>();
  for (const [doc, list] of groupBy(codings, (c) => c.document_id)) {
    list.sort((a, b) => a.start - b.start || a.end - b.end);
    const maxEnd: number[] = [];
    let m = -Infinity;
    for (const c of list) {
      m = Math.max(m, c.end);
      maxEnd.push(m);
    }
    out.set(doc, { items: list, starts: list.map((c) => c.start), maxEnd });
  }
  return out;
}

function relates(a: Coding, b: Coding, mode: OverlapMode): boolean {
  switch (mode) {
    case 'overlap':
      return a.start < b.end && b.start < a.end;
    case 'within':
      return b.start <= a.start && a.end <= b.end;
    case 'contains':
      return a.start <= b.start && b.end <= a.end;
  }
}

function hasRelated(a: Coding, idx: DocIndex, mode: OverlapMode, sameCoder: boolean): boolean {
  // Only b with b.start ≤ a.end can relate in any mode (b.start < a.end for overlap, ≤ for the
  // others, where an empty b at a.end is "within"), and only b with b.end ≥ a.start. The running
  // maximum of ends lets a binary search skip every b that ends too early.
  const hi = lowerBound(idx.starts, a.end + 1);
  const lo = lowerBound(idx.maxEnd, a.start);
  for (let i = lo; i < hi; i++) {
    const b = idx.items[i]!;
    if (b.id === a.id) continue;
    if (sameCoder && b.coder_id !== a.coder_id) continue;
    if (relates(a, b, mode)) return true;
  }
  return false;
}

/** Live codings that pass every filter, in input order. */
export function filterCodings(codings: readonly Coding[], filter: SegmentFilter, ctx: SegmentContext = {}): Coding[] {
  const all = codings.filter((c) => !c.deleted);
  const docs = ctx.documents ? new Map(ctx.documents.map((d) => [d.id, d])) : null;
  const needDoc = filter.groupIds || filter.caseIds || filter.attributeConditions?.length;
  if (needDoc) need(docs ?? undefined, 'ctx.documents');
  const cases = filter.attributeConditions?.length ? new Map(need(ctx.cases, 'ctx.cases').map((c) => [c.id, c])) : null;
  const attrs = new Map((ctx.attributes ?? []).map((a) => [a.id, a]));

  const codeOk = filter.codeIds ? codeSet(filter.codeIds, filter.includeChildren, ctx.descendants) : null;
  const docOk = filter.documentIds ? new Set(filter.documentIds) : null;
  const groupOk = filter.groupIds ? new Set(filter.groupIds) : null;
  const caseOk = filter.caseIds ? new Set(filter.caseIds) : null;
  const coderOk = filter.coderIds ? new Set(filter.coderIds) : null;
  const conds = filter.attributeConditions ?? [];
  const matchAny = filter.attributeMatch === 'any';

  // Per-document verdict for the document-level filters, computed once per document.
  const docVerdict = new Map<string, boolean>();
  const docPasses = (docId: string): boolean => {
    const cached = docVerdict.get(docId);
    if (cached !== undefined) return cached;
    let ok = !docOk || docOk.has(docId);
    const d = docs?.get(docId);
    if (ok && d?.deleted) ok = false;
    if (ok && needDoc) {
      if (!d) ok = false;
      else {
        if (groupOk && !d.group_ids.some((g) => groupOk.has(g))) ok = false;
        if (ok && caseOk && !(d.case_id !== null && caseOk.has(d.case_id))) ok = false;
        if (ok && conds.length) {
          const c = d.case_id !== null ? cases!.get(d.case_id) : undefined;
          const live = c && !c.deleted ? c : undefined;
          const test = (cond: AttributeCondition) => meetsCondition(attributeValue(live, cond.attributeId), cond, attrs.get(cond.attributeId));
          ok = matchAny ? conds.some(test) : conds.every(test);
        }
      }
    }
    docVerdict.set(docId, ok);
    return ok;
  };

  let out = all.filter(
    (c) => (!codeOk || codeOk.has(c.code_id)) && (!coderOk || coderOk.has(c.coder_id)) && docPasses(c.document_id),
  );

  const ow = filter.overlapWith;
  if (ow) {
    const others = codeSet(ow.codeIds, ow.includeChildren, ctx.descendants);
    const index = indexByDocument(all.filter((c) => others.has(c.code_id)));
    out = out.filter((a) => {
      const idx = index.get(a.document_id);
      return !!idx && hasRelated(a, idx, ow.mode, !!ow.sameCoder);
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------------------------

export type SegmentSort = 'document' | 'code' | 'length' | 'created';

export interface SortContext {
  /** Documents in list order (their position is the sort key); unknown ones go last by id. */
  documents?: readonly Document[];
  /** Codes in codebook display order (their position is the sort key). */
  codes?: readonly Code[];
}

/**
 * A sorted copy. 'document': document order, then position; 'code': codebook order, then
 * document order and position; 'length': shorter first; 'created': oldest first. Ties fall back
 * to document order and position, then id, so the order is fully deterministic.
 */
export function sortSegments(codings: readonly Coding[], by: SegmentSort, ctx: SortContext = {}, descending = false): Coding[] {
  const docRank = new Map((ctx.documents ?? []).map((d, i) => [d.id, i]));
  const codeRank = new Map((ctx.codes ?? []).map((c, i) => [c.id, i]));
  const rank = (m: Map<string, number>, id: string) => m.get(id) ?? Number.MAX_SAFE_INTEGER;
  const byDoc = (a: Coding, b: Coding) =>
    rank(docRank, a.document_id) - rank(docRank, b.document_id) ||
    (a.document_id < b.document_id ? -1 : a.document_id > b.document_id ? 1 : 0) ||
    a.start - b.start ||
    a.end - b.end;
  const primary: (a: Coding, b: Coding) => number =
    by === 'document'
      ? () => 0
      : by === 'code'
        ? (a, b) => rank(codeRank, a.code_id) - rank(codeRank, b.code_id) || (a.code_id < b.code_id ? -1 : a.code_id > b.code_id ? 1 : 0)
        : by === 'length'
          ? (a, b) => a.end - a.start - (b.end - b.start)
          : (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);
  // `descending` reverses the chosen key only; ties keep reading order.
  const sign = descending ? -1 : 1;
  const idCmp = (a: Coding, b: Coding) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (by === 'document') return [...codings].sort((a, b) => sign * (byDoc(a, b) || idCmp(a, b)));
  return [...codings].sort((a, b) => sign * primary(a, b) || byDoc(a, b) || idCmp(a, b));
}

// ---------------------------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------------------------

export interface SegmentWithContext {
  /** The span shown: whole paragraphs around the segment. */
  start: number;
  end: number;
  before: string;
  coded: string;
  after: string;
}

/**
 * The paragraph(s) around [start, end): the lines the segment touches plus `paragraphs` more
 * non-blank lines on each side (default 0), so a short coded phrase is read in its paragraph.
 * Offsets are clamped to the text.
 */
export function segmentContext(text: string, span: Span, opts: { paragraphs?: number } = {}): SegmentWithContext {
  const s = Math.max(0, Math.min(span.start, text.length));
  const e = Math.max(s, Math.min(span.end, text.length));
  const lines = lineIndex(text);
  let first = lines.lineOf(s);
  let last = lines.lineOf(e > s ? e - 1 : e);
  const isBlank = (i: number) => {
    const sp = lines.span(i);
    return text.slice(sp.start, sp.end).trim() === '';
  };
  for (let k = opts.paragraphs ?? 0; k > 0; ) {
    if (first === 0) break;
    first--;
    if (!isBlank(first)) k--;
  }
  for (let k = opts.paragraphs ?? 0; k > 0; ) {
    if (last >= lines.count - 1) break;
    last++;
    if (!isBlank(last)) k--;
  }
  let start = lines.span(first).start;
  let end = lines.span(last).end;
  // Blank lines picked up at the edges add nothing to read.
  while (start < s && /\s/.test(text[start]!)) start++;
  while (end > e && /\s/.test(text[end - 1]!)) end--;
  return { start, end, before: text.slice(start, s), coded: text.slice(s, e), after: text.slice(e, end) };
}

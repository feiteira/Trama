// Data for charts (the drawing is the screens' business): code frequency bars, document
// portraits (a document as a strip of coloured blocks) and code timelines per document.

import type { Code, Coding } from '../model/types';
import { lineIndex } from './text';
import { type Descendants, type Span, clampSpans, codeRows, groupBy, mergeSpans, totalLength, upperBound } from './util';

export type BarMeasure = 'segments' | 'documents' | 'characters';

export interface CodeBar {
  codeId: string;
  name: string;
  color: string;
  value: number;
}

export interface CodeBarOptions {
  measure?: BarMeasure;
  includeChildren?: boolean;
  descendants?: Descendants;
  /** 'value': largest first (ties in codebook order); 'codebook': the order given (default). */
  sort?: 'value' | 'codebook';
  /** Leave out codes with a value of 0 (default false). */
  hideZero?: boolean;
  limit?: number;
}

/**
 * One bar per code. 'characters' counts each coded character once per code even where its
 * segments overlap. Pass codes in codebook display order.
 */
export function codeFrequencyBars(codings: readonly Coding[], codes: readonly Code[], opts: CodeBarOptions = {}): CodeBar[] {
  const list = codes.filter((c) => !c.deleted);
  const rows = codeRows(list.map((c) => c.id), opts.includeChildren, opts.descendants);
  const k = list.length;
  const segs = new Array<number>(k).fill(0);
  const docs = Array.from({ length: k }, () => new Set<string>());
  const spans = Array.from({ length: k }, () => new Map<string, Span[]>());
  for (const c of codings) {
    if (c.deleted) continue;
    for (const r of rows.get(c.code_id) ?? []) {
      segs[r]!++;
      docs[r]!.add(c.document_id);
      const m = spans[r]!;
      const l = m.get(c.document_id);
      if (l) l.push({ start: c.start, end: c.end });
      else m.set(c.document_id, [{ start: c.start, end: c.end }]);
    }
  }
  const measure = opts.measure ?? 'segments';
  let bars = list.map((code, r): CodeBar => {
    let value: number;
    if (measure === 'segments') value = segs[r]!;
    else if (measure === 'documents') value = docs[r]!.size;
    else {
      value = 0;
      for (const l of spans[r]!.values()) value += totalLength(mergeSpans(l));
    }
    return { codeId: code.id, name: code.name, color: code.color, value };
  });
  if (opts.hideZero) bars = bars.filter((b) => b.value > 0);
  if (opts.sort === 'value') bars = bars.map((b, i) => ({ b, i })).sort((x, y) => y.b.value - x.b.value || x.i - y.i).map((x) => x.b);
  if (opts.limit !== undefined && bars.length > opts.limit) bars = bars.slice(0, Math.max(0, opts.limit));
  return bars;
}

export interface PortraitShare {
  codeId: string;
  color: string;
  /** Fraction of the slice's characters coded with the code (0–1). */
  share: number;
}

export interface PortraitSlice {
  start: number;
  end: number;
  /** The code covering most of the slice (ties: the earlier code in the list); null if uncoded. */
  codeId: string | null;
  color: string | null;
  /** Fraction of the slice covered by the dominant code. */
  share: number;
  /** Every code present in the slice, largest share first (for blended portraits). */
  mix: PortraitShare[];
}

export interface PortraitOptions {
  /** Number of slices (default 100; fewer when the document is shorter). */
  slices?: number;
  /** Only codings of this document are used (default: all codings passed). */
  documentId?: string;
}

/**
 * The document cut into equal slices of characters; each slice shows the code that covers most
 * of it. Only the codes passed count, and their order breaks ties.
 */
export function documentPortrait(codings: readonly Coding[], codes: readonly Code[], length: number, opts: PortraitOptions = {}): PortraitSlice[] {
  const L = Math.max(0, Math.floor(length));
  if (L === 0) return [];
  const n = Math.max(1, Math.min(Math.floor(opts.slices ?? 100), L));
  const bounds = new Int32Array(n + 1);
  for (let i = 0; i <= n; i++) bounds[i] = Math.floor((i * L) / n);
  const list = codes.filter((c) => !c.deleted);
  const index = new Map(list.map((c, i) => [c.id, i]));
  const byCode = groupBy(
    codings.filter((c) => !c.deleted && index.has(c.code_id) && (opts.documentId === undefined || c.document_id === opts.documentId)),
    (c) => c.code_id,
  );
  // cover[i][slice] = characters of slice covered by code i.
  const cover = new Map<number, Float64Array>();
  for (const [codeId, cs] of byCode) {
    const i = index.get(codeId)!;
    const arr = new Float64Array(n);
    for (const s of mergeSpans(clampSpans(cs, L))) {
      let k = upperBound(bounds, s.start) - 1;
      while (k < n && bounds[k]! < s.end) {
        const ov = Math.min(s.end, bounds[k + 1]!) - Math.max(s.start, bounds[k]!);
        if (ov > 0) arr[k]! += ov;
        k++;
      }
    }
    cover.set(i, arr);
  }
  const order = [...cover.keys()].sort((a, b) => a - b);
  const out: PortraitSlice[] = [];
  for (let k = 0; k < n; k++) {
    const start = bounds[k]!;
    const end = bounds[k + 1]!;
    const size = end - start;
    const mix: PortraitShare[] = [];
    for (const i of order) {
      const v = cover.get(i)![k]!;
      if (v > 0) mix.push({ codeId: list[i]!.id, color: list[i]!.color, share: v / size });
    }
    // Stable sort keeps codebook order among equal shares, so mix[0] is the dominant code.
    mix.sort((a, b) => b.share - a.share);
    const top = mix[0];
    out.push({ start, end, codeId: top?.codeId ?? null, color: top?.color ?? null, share: top?.share ?? 0, mix });
  }
  return out;
}

export interface TimelineSegment {
  codingId: string;
  start: number;
  end: number;
  /** Position along the document, 0–1 (characters or paragraphs, see `unit`). */
  from: number;
  to: number;
}

export interface TimelineLane {
  codeId: string;
  name: string;
  color: string;
  segments: TimelineSegment[];
}

export interface TimelineOptions {
  documentId?: string;
  /** 'paragraphs' (needs text) places segments by paragraph, as a transcript's turns. */
  unit?: 'characters' | 'paragraphs';
  text?: string;
  includeChildren?: boolean;
  descendants?: Descendants;
}

/**
 * One lane per code with segments in the document (codebook order as given), each segment
 * placed along the document. With includeChildren a lane also shows its descendants' segments.
 */
export function codeTimeline(codings: readonly Coding[], codes: readonly Code[], length: number, opts: TimelineOptions = {}): {
  unit: 'characters' | 'paragraphs';
  lanes: TimelineLane[];
} {
  const list = codes.filter((c) => !c.deleted);
  const rows = codeRows(list.map((c) => c.id), opts.includeChildren, opts.descendants);
  const unit = opts.unit === 'paragraphs' && opts.text !== undefined ? 'paragraphs' : 'characters';
  const lines = unit === 'paragraphs' ? lineIndex(opts.text!) : null;
  const L = Math.max(0, length);
  const place = (c: Coding): [number, number] => {
    if (lines) {
      const first = lines.lineOf(c.start);
      const last = lines.lineOf(c.end > c.start ? c.end - 1 : c.start);
      return [first / lines.count, (last + 1) / lines.count];
    }
    if (L === 0) return [0, 0];
    return [Math.min(1, Math.max(0, c.start / L)), Math.min(1, Math.max(0, c.end / L))];
  };
  const lanes: TimelineLane[] = list.map((c) => ({ codeId: c.id, name: c.name, color: c.color, segments: [] }));
  for (const c of codings) {
    if (c.deleted || (opts.documentId !== undefined && c.document_id !== opts.documentId)) continue;
    for (const r of rows.get(c.code_id) ?? []) {
      const [from, to] = place(c);
      lanes[r]!.segments.push({ codingId: c.id, start: c.start, end: c.end, from, to });
    }
  }
  for (const l of lanes) l.segments.sort((a, b) => a.start - b.start || a.end - b.end);
  return { unit, lanes: lanes.filter((l) => l.segments.length > 0) };
}

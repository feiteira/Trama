// Code co-occurrence (MAXQDA's Code Relations Browser, NVivo's matrix coding with AND,
// ATLAS.ti's code co-occurrence table).
//
// Two segments co-occur when they are in the same document, are different codings, and:
//   'overlap'    share at least one character;
//   'paragraph'  touch at least one common paragraph (line, see text.ts);
//   'proximity'  are at most `distance` characters apart (gap = later start − earlier end;
//                overlapping segments have a negative gap, touching ones a gap of 0).
//
// Counting, for codes A ≠ B (both reported, so screens can show either):
//   matrix[A][B]       the number of co-occurring segment *pairs* (a of A, b of B). Symmetric.
//                      One long segment of A overlapping three segments of B counts 3, as in
//                      MAXQDA, where each intersection is one co-occurrence.
//   segmentsWith[A][B] the number of segments of A that co-occur with at least one segment of
//                      B. Directed: in the example above it is 1, and segmentsWith[B][A] is 3.
//   jaccard[A][B]      (segmentsWith[A][B] + segmentsWith[B][A]) / (n_A + n_B): the Jaccard
//                      index over the segments of A and B, where "in the intersection" means
//                      "co-occurs with the other code". 0 = never together, 1 = every segment of
//                      each code co-occurs with the other. Symmetric, always within [0, 1].
// The diagonal holds each code's number of segments (jaccard: 1, or 0 for an unused code).
// With includeChildren a descendant's segment counts for its selected ancestor, and a segment
// is never paired with itself.

import type { Coding } from '../model/types';
import { lineIndex } from './text';
import { type Descendants, codeRows, groupBy } from './util';

export type CooccurrenceMode = 'overlap' | 'paragraph' | 'proximity';

export interface CooccurrenceOptions {
  mode: CooccurrenceMode;
  /** Proximity mode: largest gap in characters (default 0: touching or overlapping). */
  distance?: number;
  /** Paragraph mode: document id → text. Documents without a text fall back to 'overlap'. */
  texts?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
  /** Only segments by the same coder co-occur (default false). */
  sameCoder?: boolean;
  includeChildren?: boolean;
  descendants?: Descendants;
  /** Collect the co-occurring pairs for drill-down (default true). */
  details?: boolean;
}

export interface CooccurrencePair {
  documentId: string;
  /** The coding counted for the first code of the key, and its span. */
  aId: string;
  aStart: number;
  aEnd: number;
  bId: string;
  bStart: number;
  bEnd: number;
}

export interface CooccurrenceResult {
  codes: string[];
  matrix: number[][];
  segmentsWith: number[][];
  jaccard: number[][];
  segmentCounts: number[];
  /** Key `${codes[i]}|${codes[j]}` with i < j (use pairsOf for either order). */
  pairs: Map<string, CooccurrencePair[]>;
  /** Paragraph mode: documents that had no text and were compared by overlap instead. */
  missingTexts: string[];
}

function getText(texts: CooccurrenceOptions['texts'], id: string): string | undefined {
  if (!texts) return undefined;
  if (texts instanceof Map) return texts.get(id);
  const r = texts as Readonly<Record<string, string>>;
  return Object.prototype.hasOwnProperty.call(r, id) ? r[id] : undefined;
}

interface Item {
  c: Coding;
  rows: number[];
  s: number;
  e: number;
  with: Set<number> | null;
}

const square = (k: number, fill = 0) => Array.from({ length: k }, () => new Array<number>(k).fill(fill));

export function cooccurrence(codings: readonly Coding[], codeIds: readonly string[], opts: CooccurrenceOptions): CooccurrenceResult {
  const codes = [...new Set(codeIds)];
  const k = codes.length;
  const rows = codeRows(codes, opts.includeChildren, opts.descendants);
  const matrix = square(k);
  const directed = square(k);
  const counts = new Array<number>(k).fill(0);
  const pairs = new Map<string, CooccurrencePair[]>();
  const missingTexts: string[] = [];
  const details = opts.details !== false;
  const distance = Math.max(0, opts.distance ?? 0);
  const relevant = codings.filter((c) => !c.deleted && rows.has(c.code_id));

  for (const [documentId, list] of groupBy(relevant, (c) => c.document_id)) {
    let mode = opts.mode;
    let lines: ReturnType<typeof lineIndex> | null = null;
    if (mode === 'paragraph') {
      const text = getText(opts.texts, documentId);
      if (text === undefined) {
        missingTexts.push(documentId);
        mode = 'overlap';
      } else lines = lineIndex(text);
    }
    const items: Item[] = list.map((c) => {
      const r = rows.get(c.code_id)!;
      for (const i of r) counts[i]!++;
      if (lines) {
        // Paragraph units: the lines from the segment's first to its last character.
        const p1 = lines.lineOf(c.start);
        const p2 = lines.lineOf(c.end > c.start ? c.end - 1 : c.start);
        return { c, rows: r, s: p1, e: p2 + 1, with: null };
      }
      return { c, rows: r, s: c.start, e: c.end, with: null };
    });
    items.sort((a, b) => a.s - b.s || a.e - b.e);
    const prox = mode === 'proximity';
    const reach = prox ? distance : 0;

    let active: Item[] = [];
    for (const x of items) {
      // A segment that ends before x starts (beyond the reach) cannot meet any later one either.
      active = active.filter((y) => (prox ? y.e + reach >= x.s : y.e > x.s));
      for (const y of active) {
        if (opts.sameCoder && y.c.coder_id !== x.c.coder_id) continue;
        const meets = prox ? Math.max(x.s, y.s) - Math.min(x.e, y.e) <= reach : x.s < y.e && y.s < x.e;
        if (!meets) continue;
        for (const r of x.rows) {
          for (const q of y.rows) {
            if (r === q) continue;
            const i = Math.min(r, q);
            const j = Math.max(r, q);
            matrix[i]![j]!++;
            (x.with ??= new Set()).add(q);
            (y.with ??= new Set()).add(r);
            if (details) {
              const key = `${codes[i]}|${codes[j]}`;
              const a = r === i ? x.c : y.c;
              const b = r === i ? y.c : x.c;
              const entry = { documentId, aId: a.id, aStart: a.start, aEnd: a.end, bId: b.id, bStart: b.start, bEnd: b.end };
              const l = pairs.get(key);
              if (l) l.push(entry);
              else pairs.set(key, [entry]);
            }
          }
        }
      }
      active.push(x);
    }
    for (const x of items) {
      if (!x.with) continue;
      for (const r of x.rows) for (const q of x.with) if (q !== r) directed[r]![q]!++;
    }
  }

  const jaccard = square(k);
  for (let i = 0; i < k; i++) {
    matrix[i]![i] = counts[i]!;
    directed[i]![i] = counts[i]!;
    jaccard[i]![i] = counts[i]! > 0 ? 1 : 0;
    for (let j = i + 1; j < k; j++) {
      matrix[j]![i] = matrix[i]![j]!;
      const n = counts[i]! + counts[j]!;
      const v = n > 0 ? (directed[i]![j]! + directed[j]![i]!) / n : 0;
      jaccard[i]![j] = v;
      jaccard[j]![i] = v;
    }
  }
  return { codes, matrix, segmentsWith: directed, jaccard, segmentCounts: counts, pairs, missingTexts };
}

/** The co-occurring pairs of two codes, oriented so that `a*` fields belong to code `a`. */
export function pairsOf(result: CooccurrenceResult, a: string, b: string): CooccurrencePair[] {
  const direct = result.pairs.get(`${a}|${b}`);
  if (direct) return direct;
  const rev = result.pairs.get(`${b}|${a}`);
  if (!rev) return [];
  return rev.map((p) => ({ documentId: p.documentId, aId: p.bId, aStart: p.bStart, aEnd: p.bEnd, bId: p.aId, bStart: p.aStart, bEnd: p.aEnd }));
}

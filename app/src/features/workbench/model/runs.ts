import type { Para } from './paragraphs';

// Highlights inside a paragraph: the paragraph's text is cut into runs wherever the set of
// codings covering it changes (or a find match, or the speaker label, starts or ends). Each run
// is one <span>, so a coded passage that two codings overlap draws both of them on the shared
// part and only one on the rest.

export interface Mark {
  id: string;
  start: number;
  end: number;
}

export interface FindMark {
  start: number;
  end: number;
  /** Position among all matches of the document. */
  index: number;
}

export interface Run {
  start: number;
  end: number;
  /** Codings covering the run, in the order of `marks` as given. */
  ids: string[];
  /** Part of the speaker label. */
  label: boolean;
  /** Index of the find match covering the run, or -1. */
  find: number;
}

/**
 * Cuts paragraph `para` into runs. `marks` may hold codings that start before or end after
 * the paragraph (they are clipped); their order decides the order of each run's `ids`.
 */
export function buildRuns(para: Pick<Para, 'start' | 'end' | 'labelEnd'>, marks: readonly Mark[], finds: readonly FindMark[] = []): Run[] {
  const { start, end } = para;
  if (end <= start) return [];
  const cuts = new Set<number>([start, end]);
  const clip = (n: number) => Math.max(start, Math.min(end, n));
  if (para.labelEnd > start && para.labelEnd < end) cuts.add(para.labelEnd);
  const inside = marks.filter((m) => m.end > start && m.start < end && m.end > m.start);
  for (const m of inside) {
    cuts.add(clip(m.start));
    cuts.add(clip(m.end));
  }
  const found = finds.filter((f) => f.end > start && f.start < end && f.end > f.start);
  for (const f of found) {
    cuts.add(clip(f.start));
    cuts.add(clip(f.end));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const runs: Run[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const ids: string[] = [];
    for (const m of inside) if (m.start <= a && m.end >= b) ids.push(m.id);
    let find = -1;
    for (const f of found) {
      if (f.start <= a && f.end >= b) {
        find = f.index;
        break;
      }
    }
    runs.push({ start: a, end: b, ids, label: b <= para.labelEnd, find });
  }
  return runs;
}

/**
 * Codings per paragraph: `out[i]` lists the marks touching paragraph i (in the order given),
 * or is undefined when none does. A mark spanning several paragraphs is listed in each.
 */
export function marksByParagraph<M extends Mark>(paras: readonly Pick<Para, 'start' | 'end'>[], marks: readonly M[]): (M[] | undefined)[] {
  const out: (M[] | undefined)[] = new Array(paras.length);
  for (const m of marks) {
    if (m.end <= m.start) continue;
    // First paragraph whose end reaches past the mark's start.
    let lo = 0;
    let hi = paras.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (paras[mid]!.end <= m.start) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < paras.length && paras[i]!.start < m.end; i++) {
      if (paras[i]!.end <= paras[i]!.start) continue;
      (out[i] ??= []).push(m);
    }
  }
  return out;
}

/** Find matches per paragraph (matches are sorted and never cross a paragraph boundary). */
export function findsByParagraph(paras: readonly Pick<Para, 'start' | 'end'>[], finds: readonly FindMark[]): (FindMark[] | undefined)[] {
  return marksByParagraph(paras, finds.map((f) => ({ ...f, id: String(f.index) })));
}

/** The marks covering position `pos` (a click inside the text). */
export function marksAt<M extends Mark>(marks: readonly M[], pos: number): M[] {
  return marks.filter((m) => m.start <= pos && m.end > pos);
}

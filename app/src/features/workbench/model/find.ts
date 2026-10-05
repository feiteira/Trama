import { type Folded, fold, foldWithMap, isWordCharAt, originalSpan } from '../../../core/qda/text';

// Find in document (Ctrl/⌘+F): every occurrence of what was typed, ignoring case and accents
// like the rest of Trama's search, as spans of the canonical text.

export interface FindOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  /** At most this many matches (default 10 000). */
  limit?: number;
}

export interface FindSpan {
  start: number;
  end: number;
}

// One document is searched at a time while typing: keep its folded form between keystrokes.
let cache: { text: string; cs: boolean; folded: Folded } | null = null;

function folded(text: string, cs: boolean): Folded {
  if (cache && cache.text === text && cache.cs === cs) return cache.folded;
  const f = foldWithMap(text, { caseSensitive: cs });
  cache = { text, cs, folded: f };
  return f;
}

/** Matches of `query` in `text`, in order, never overlapping and never crossing a line. */
export function findAll(text: string, query: string, opts: FindOptions = {}): FindSpan[] {
  const q = fold(query.trim(), { caseSensitive: !!opts.caseSensitive });
  if (!q) return [];
  const f = folded(text, !!opts.caseSensitive);
  const limit = opts.limit ?? 10_000;
  const out: FindSpan[] = [];
  for (let at = f.folded.indexOf(q); at !== -1 && out.length < limit; ) {
    const span = originalSpan(f, at, at + q.length);
    const crossesLine = text.slice(span.start, span.end).includes('\n');
    const whole = !opts.wholeWord || (!isWordCharAt(text, span.start - 1) && !isWordCharAt(text, span.end));
    if (!crossesLine && whole && span.end > span.start) {
      out.push(span);
      at = f.folded.indexOf(q, at + q.length);
    } else at = f.folded.indexOf(q, at + 1);
  }
  return out;
}

/** The match to show first: the first one at or after `pos` (wrapping to the first). */
export function firstMatchFrom(matches: readonly FindSpan[], pos: number): number {
  if (!matches.length) return -1;
  let lo = 0;
  let hi = matches.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (matches[mid]!.start < pos) lo = mid + 1;
    else hi = mid;
  }
  return lo < matches.length ? lo : 0;
}

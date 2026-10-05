import type { SyncPoint } from '../../../core/model/types';

// How the viewer cuts a document's canonical text into paragraphs. Every line (text between
// `\n`s) is one paragraph element, so a paragraph's offsets are simply its line's offsets and
// selections map back to the text without any bookkeeping for hidden characters.

export interface Para {
  index: number;
  start: number;
  end: number;
  /**
   * End of the speaker label of a transcript turn ("Marta:"), colon included; equals `start`
   * when the paragraph has none. The label is part of the text: only its style differs.
   */
  labelEnd: number;
  /** Media time of the turn (the first sync point inside the paragraph), or null. */
  ms: number | null;
  /** Only whitespace: drawn as a small gap, not a line of text. */
  blank: boolean;
}

// A turn's label: a name of up to four words, then a colon and a space ("Dr. Sousa: …",
// "Entrevistadora: …", "P3: …"). Sentences that merely contain a colon are not labels.
const LABEL = /^\[?[\p{L}\p{N}][\p{L}\p{N}\p{M} .'’()_-]{0,40}?\]?:(?=\s)/u;

/** Length of the speaker label at the start of `line`, colon included, or 0. */
export function speakerLabelLength(line: string): number {
  const m = LABEL.exec(line);
  if (!m) return 0;
  const words = m[0].slice(0, -1).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return 0;
  return m[0].length;
}

/**
 * The paragraphs of a text. `transcript` turns on speaker labels; `sync` (sorted by pos) gives
 * each paragraph the time of its first sync point.
 */
export function splitParagraphs(text: string, opts: { transcript?: boolean; sync?: readonly SyncPoint[] } = {}): Para[] {
  const out: Para[] = [];
  const sync = opts.sync ?? [];
  let si = 0;
  let start = 0;
  for (let index = 0; ; index++) {
    const nl = text.indexOf('\n', start);
    const end = nl < 0 ? text.length : nl;
    const line = text.slice(start, end);
    const blank = line.trim() === '';
    const labelEnd = opts.transcript && !blank ? start + speakerLabelLength(line) : start;
    // Sync points before this paragraph (in a blank line or the gap) are skipped.
    while (si < sync.length && sync[si]!.pos < start) si++;
    let ms: number | null = null;
    if (si < sync.length && sync[si]!.pos <= end && !blank) ms = sync[si]!.ms;
    out.push({ index, start, end, labelEnd, ms, blank });
    if (nl < 0) break;
    start = nl + 1;
  }
  return out;
}

/** Index of the paragraph holding `pos` (a position on a `\n` belongs to the line it ends). */
export function paragraphIndexAt(paras: readonly Para[], pos: number): number {
  let lo = 0;
  let hi = paras.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (paras[mid]!.start <= pos) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/**
 * The paragraph being spoken at `ms`: the last timed paragraph whose time is at or before it.
 * -1 before the first timed paragraph. `timed` lists indexes of paragraphs with a time, in
 * text order (times are assumed to grow with the text, as transcripts do).
 */
export function paragraphAtTime(paras: readonly Para[], timed: readonly number[], ms: number): number {
  let lo = 0;
  let hi = timed.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = paras[timed[mid]!]!.ms!;
    if (t <= ms) {
      found = timed[mid]!;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** A media time as 4:05 or 1:02:09. */
export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

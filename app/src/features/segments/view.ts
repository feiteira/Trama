// What a segment card shows beyond the coding itself: its paragraph number and the text
// around it. Both need the document's text, which is loaded only for documents on screen.

import type { Coding } from '../../core/model/types';
import { segmentContext } from '../../core/qda/segments';
import { fold as foldText, foldWithMap, type LineIndex, lineIndex, originalSpan, sentenceAt, type Span } from '../../core/qda/text';
import { mergeSpans } from '../../core/qda/util';
import type { ContextMode } from './filter';

export interface DocTextInfo {
  text: string;
  lines: LineIndex;
  /** ordinals[i] = 1-based number of the paragraph on line i (blank lines share the previous number). */
  ordinals: Int32Array;
}

const NON_BLANK = /\S/;

/** The text with its line index and paragraph numbering, built once per document. */
export function docTextInfo(text: string): DocTextInfo {
  const lines = lineIndex(text);
  const ordinals = new Int32Array(lines.count);
  let n = 0;
  for (let i = 0; i < lines.count; i++) {
    const sp = lines.span(i);
    if (NON_BLANK.test(text.slice(sp.start, sp.end))) n++;
    ordinals[i] = Math.max(1, n);
  }
  return { text, lines, ordinals };
}

/**
 * The paragraph a position is in, numbered as a reader counts them (blank lines are not
 * paragraphs), from 1.
 */
export function paragraphNumber(info: DocTextInfo, pos: number): number {
  const line = info.lines.lineOf(Math.max(0, Math.min(pos, info.text.length)));
  return info.ordinals[line] ?? 1;
}

export interface ShownText {
  before: string;
  coded: string;
  after: string;
  /** Context was cut short at the start / end (an ellipsis is shown). */
  cutBefore: boolean;
  cutAfter: boolean;
}

/** Context shown on each side at most, so a coded phrase in a 1 MB one-paragraph text stays readable. */
export const CONTEXT_MAX = 420;

function cutStart(s: string, max: number): { text: string; cut: boolean } {
  if (s.length <= max) return { text: s, cut: false };
  let i = s.length - max;
  const space = s.indexOf(' ', i);
  if (space >= 0 && space - i < 40) i = space + 1;
  return { text: s.slice(i), cut: true };
}

function cutEnd(s: string, max: number): { text: string; cut: boolean } {
  if (s.length <= max) return { text: s, cut: false };
  let i = max;
  const space = s.lastIndexOf(' ', i);
  if (space >= 0 && i - space < 40) i = space;
  return { text: s.slice(0, i), cut: true };
}

/**
 * The coded text with the requested context. Without the document's text (still loading, or
 * 'none'), the coding's own copy of its text is shown.
 */
export function shownText(coding: Pick<Coding, 'start' | 'end' | 'text'>, mode: ContextMode, text: string | null, max = CONTEXT_MAX): ShownText {
  const plain: ShownText = { before: '', coded: coding.text, after: '', cutBefore: false, cutAfter: false };
  if (mode === 'none' || text === null) return plain;
  const s = Math.max(0, Math.min(coding.start, text.length));
  const e = Math.max(s, Math.min(coding.end, text.length));
  let from = s;
  let to = e;
  if (mode === 'paragraph') {
    const ctx = segmentContext(text, { start: s, end: e });
    from = ctx.start;
    to = ctx.end;
  } else {
    const a = sentenceAt(text, s);
    const b = sentenceAt(text, e > s ? e - 1 : e);
    if (a) from = Math.min(from, a.start);
    if (b) to = Math.max(to, b.end);
  }
  const before = cutStart(text.slice(from, s), max);
  const after = cutEnd(text.slice(e, to), max);
  return { before: before.text, coded: text.slice(s, e), after: after.text, cutBefore: before.cut, cutAfter: after.cut };
}

/** Distinct documents among the segments. */
export function documentCount(codings: readonly Pick<Coding, 'document_id'>[]): number {
  const s = new Set<string>();
  for (const c of codings) s.add(c.document_id);
  return s.size;
}

/** Text for one line of a list: whitespace runs (line breaks too) as single spaces. */
export const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * Where the words of a "text contains" query occur in `text` (case and accents ignored), as
 * merged spans of the original text, for highlighting.
 */
export function matchSpans(text: string, query: string): Span[] {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (!words.length || !text) return [];
  const f = foldWithMap(text);
  const out: Span[] = [];
  for (const w of words) {
    for (let i = f.folded.indexOf(w); i >= 0; i = f.folded.indexOf(w, i + w.length)) out.push(originalSpan(f, i, i + w.length));
  }
  return mergeSpans(out);
}

/** `text` cut into plain and matched pieces, in order. */
export function splitBySpans(text: string, spans: readonly Span[]): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const sp of spans) {
    const s = Math.max(at, Math.min(sp.start, text.length));
    const e = Math.max(s, Math.min(sp.end, text.length));
    if (s > at) out.push({ text: text.slice(at, s), hit: false });
    if (e > s) out.push({ text: text.slice(s, e), hit: true });
    at = e;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}

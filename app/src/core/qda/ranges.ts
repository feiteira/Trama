// Text edits and how positions move through them. Codings, sync points and anything else that
// points into a document's text are remapped through these when the text changes (a typo fix,
// pseudonymisation), so a coded passage stays on the same words.
//
// An edit list is in the coordinates of the OLD text: sorted, non-overlapping, never touching
// (touching edits are merged), each replacing old[start, end) with `insert`. Offsets are UTF-16
// code units, like everywhere else in the model; edits never split a surrogate pair.

export interface TextEdit {
  start: number;
  end: number;
  insert: string;
}

export interface Span {
  start: number;
  end: number;
}

export type Assoc = 'before' | 'after';

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** True when `pos` falls between the two halves of a surrogate pair. */
export function splitsPair(text: string, pos: number): boolean {
  return pos > 0 && pos < text.length && isHigh(text.charCodeAt(pos - 1)) && isLow(text.charCodeAt(pos));
}

/**
 * Sorts edits, drops no-ops and merges touching ones, so the result is a canonical edit list.
 * Overlapping edits are ambiguous and rejected.
 */
export function normalizeEdits(edits: readonly TextEdit[]): TextEdit[] {
  const sorted = edits
    .map((e, i) => ({ e, i }))
    .sort((x, y) => x.e.start - y.e.start || x.e.end - y.e.end || x.i - y.i)
    .map(({ e }) => e);
  const out: TextEdit[] = [];
  for (const e of sorted) {
    if (!Number.isInteger(e.start) || !Number.isInteger(e.end) || e.start < 0 || e.end < e.start) {
      throw new RangeError(`bad edit [${e.start}, ${e.end})`);
    }
    if (e.start === e.end && e.insert === '') continue;
    const prev = out[out.length - 1];
    if (prev && e.start < prev.end) throw new RangeError(`overlapping edits at ${e.start}`);
    if (prev && e.start === prev.end) {
      out[out.length - 1] = { start: prev.start, end: e.end, insert: prev.insert + e.insert };
    } else {
      out.push({ start: e.start, end: e.end, insert: e.insert });
    }
  }
  return out;
}

/** Applies an edit list (in old-text coordinates) to `text`. */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
  const list = normalizeEdits(edits);
  const parts: string[] = [];
  let at = 0;
  for (const e of list) {
    if (e.end > text.length) throw new RangeError(`edit [${e.start}, ${e.end}) beyond the text (${text.length})`);
    parts.push(text.slice(at, e.start), e.insert);
    at = e.end;
  }
  parts.push(text.slice(at));
  return parts.join('');
}

// Cumulative length change before each edit, cached per edit list: mapping hundreds of codings
// through thousands of pseudonym replacements stays O(log n) per position.
const deltas = new WeakMap<readonly TextEdit[], Float64Array>();

function prefixDeltas(edits: readonly TextEdit[]): Float64Array {
  let d = deltas.get(edits);
  if (!d) {
    d = new Float64Array(edits.length + 1);
    for (let i = 0; i < edits.length; i++) {
      const e = edits[i]!;
      d[i + 1] = d[i]! + e.insert.length - (e.end - e.start);
    }
    deltas.set(edits, d);
  }
  return d;
}

function mapPos(pos: number, edits: readonly TextEdit[], onInsert: Assoc, inside: Assoc): number {
  const d = prefixDeltas(edits);
  // First edit whose end is at or after pos (ends are strictly increasing in a normalised list).
  let lo = 0;
  let hi = edits.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (edits[mid]!.end < pos) lo = mid + 1;
    else hi = mid;
  }
  const e = edits[lo];
  const delta = d[lo]!;
  if (!e || pos < e.start) return pos + delta;
  const newStart = e.start + delta;
  const newEnd = newStart + e.insert.length;
  if (e.start === e.end) return onInsert === 'before' ? newStart : newEnd;
  if (pos === e.start) return newStart;
  if (pos === e.end) return newEnd;
  return inside === 'before' ? newStart : newEnd;
}

/**
 * Where `pos` lands after the edits (a normalised list, as `computeEdits` or `normalizeEdits`
 * return). Text inserted exactly at `pos` ends up after it with 'before' and before it with
 * 'after'. A position inside replaced text moves to the start ('before') or end ('after') of
 * the replacement.
 */
export function mapOffset(pos: number, edits: readonly TextEdit[], assoc: Assoc = 'after'): number {
  return mapPos(pos, edits, assoc, assoc);
}

/**
 * Where a range lands after the edits, or null when nothing of it is left. Text inserted at the
 * range's edges stays outside it; text that replaces part of the range (a name inside a coded
 * passage) becomes part of it, so the passage keeps covering whole words.
 */
export function mapRange(range: Span, edits: readonly TextEdit[]): Span | null {
  if (!edits.length) return range.end > range.start ? { start: range.start, end: range.end } : null;
  const start = mapPos(range.start, edits, 'after', 'before');
  const end = mapPos(range.end, edits, 'before', 'after');
  return end > start ? { start, end } : null;
}

/**
 * Replaces several spans at once (e.g. every match of a pseudonym). Matches that overlap an
 * earlier accepted one are skipped (earlier start wins, then the longer one), so the caller can
 * pass overlapping candidates. Returns the new text, the edit list and how many were applied.
 */
export function replaceAll(text: string, matches: readonly TextEdit[]): { text: string; edits: TextEdit[]; applied: number } {
  const sorted = [...matches].sort((a, b) => a.start - b.start || b.end - a.end);
  const accepted: TextEdit[] = [];
  let reach = 0;
  for (const m of sorted) {
    if (m.start < 0 || m.end > text.length || m.end < m.start) throw new RangeError(`bad match [${m.start}, ${m.end})`);
    if (splitsPair(text, m.start) || splitsPair(text, m.end)) throw new RangeError(`match splits a surrogate pair at ${m.start}`);
    if (accepted.length && m.start < reach) continue;
    accepted.push({ start: m.start, end: m.end, insert: m.insert });
    reach = m.end;
  }
  const edits = normalizeEdits(accepted.filter((e) => text.slice(e.start, e.end) !== e.insert));
  return { text: applyEdits(text, edits), edits, applied: accepted.length };
}

// ---------------------------------------------------------------------------------------------
// Diff

// Token classes. Edits are computed over tokens so that a changed word is replaced as a whole:
// "Ana" → "Anabela" is one replacement of the word, and a coding that ended at "Ana" grows to
// "Anabela" instead of stopping in the middle of it. Ideographic scripts have no spaces, so
// each of their characters is a token of its own.
const WORD = 1;
const SPACE = 2;
const SINGLE = 3; // newline, punctuation, ideographs: one code point per token
const RE_SINGLE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const RE_WORD = /[\p{L}\p{N}\p{M}_]/u;
const RE_TOKEN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]|[\p{L}\p{N}\p{M}_]+|[^\S\n]+|[\s\S]/gu;

function classOf(cp: string): number {
  if (RE_SINGLE_SCRIPT.test(cp)) return SINGLE;
  if (RE_WORD.test(cp)) return WORD;
  if (cp !== '\n' && /\s/.test(cp)) return SPACE;
  return SINGLE;
}

function cpBefore(s: string, pos: number): string {
  if (pos >= 2 && isLow(s.charCodeAt(pos - 1)) && isHigh(s.charCodeAt(pos - 2))) return s.slice(pos - 2, pos);
  return s.slice(pos - 1, pos);
}

function cpAt(s: string, pos: number): string {
  if (isHigh(s.charCodeAt(pos)) && isLow(s.charCodeAt(pos + 1))) return s.slice(pos, pos + 2);
  return s.slice(pos, pos + 1);
}

/** Whether the tokenizer always cuts `s` at `pos` (looking only at the neighbouring characters). */
function boundary(s: string, pos: number): boolean {
  if (pos <= 0 || pos >= s.length) return true;
  if (splitsPair(s, pos)) return false;
  const a = classOf(cpBefore(s, pos));
  const b = classOf(cpAt(s, pos));
  return a !== b || a === SINGLE;
}

interface Tokens {
  ids: Int32Array;
  /** Character offset of each token, plus the end (length ids.length + 1). */
  pos: Int32Array;
}

function tokenize(s: string, from: number, to: number, intern: Map<string, number>): Tokens {
  const ids: number[] = [];
  const pos: number[] = [];
  const re = new RegExp(RE_TOKEN.source, 'gu');
  const sub = s.slice(from, to);
  let m: RegExpExecArray | null;
  while ((m = re.exec(sub))) {
    let id = intern.get(m[0]);
    if (id === undefined) {
      id = intern.size;
      intern.set(m[0], id);
    }
    ids.push(id);
    pos.push(from + m.index);
  }
  pos.push(to);
  return { ids: Int32Array.from(ids), pos: Int32Array.from(pos) };
}

/**
 * Work allowed for one diff (snake steps). Beyond it the region still unresolved is treated as
 * one replacement: always correct, only coarser. Keeps pathological inputs (two unrelated 1 MB
 * texts) to well under a second.
 */
const DIFF_BUDGET = 30_000_000;

/** Equal runs [aStart, bStart, length] between two token sequences, in order (Myers, linear space). */
function matchRuns(a: Int32Array, b: Int32Array): number[] {
  const out: number[] = [];
  const budget = { left: DIFF_BUDGET };

  const walk = (aLo: number, aHi: number, bLo: number, bHi: number): void => {
    let pre = 0;
    while (aLo + pre < aHi && bLo + pre < bHi && a[aLo + pre] === b[bLo + pre]) pre++;
    if (pre) out.push(aLo, bLo, pre);
    aLo += pre;
    bLo += pre;
    let suf = 0;
    while (aHi - suf > aLo && bHi - suf > bLo && a[aHi - suf - 1] === b[bHi - suf - 1]) suf++;
    aHi -= suf;
    bHi -= suf;
    if (aLo < aHi && bLo < bHi) {
      const split = bisect(a, aLo, aHi, b, bLo, bHi, budget);
      if (split) {
        walk(aLo, split[0], bLo, split[1]);
        walk(split[0], aHi, split[1], bHi);
      }
    }
    if (suf) out.push(aHi, bHi, suf);
  };

  walk(0, a.length, 0, b.length);
  return out;
}

/** The middle snake of a[aLo,aHi) × b[bLo,bHi) (after Myers 1986 / diff-match-patch), or null. */
function bisect(
  a: Int32Array, aLo: number, aHi: number,
  b: Int32Array, bLo: number, bHi: number,
  budget: { left: number },
): [number, number] | null {
  const n = aHi - aLo;
  const m = bHi - bLo;
  const maxD = Math.ceil((n + m) / 2);
  const vOffset = maxD;
  const vLength = 2 * maxD + 2;
  const v1 = new Int32Array(vLength).fill(-1);
  const v2 = new Int32Array(vLength).fill(-1);
  v1[vOffset + 1] = 0;
  v2[vOffset + 1] = 0;
  const delta = n - m;
  const front = delta % 2 !== 0;
  let k1start = 0;
  let k1end = 0;
  let k2start = 0;
  let k2end = 0;
  for (let d = 0; d < maxD; d++) {
    if (budget.left <= 0) return null;
    for (let k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
      const k1Offset = vOffset + k1;
      let x1 = k1 === -d || (k1 !== d && v1[k1Offset - 1]! < v1[k1Offset + 1]!) ? v1[k1Offset + 1]! : v1[k1Offset - 1]! + 1;
      let y1 = x1 - k1;
      const x0 = x1;
      while (x1 < n && y1 < m && a[aLo + x1] === b[bLo + y1]) {
        x1++;
        y1++;
      }
      budget.left -= x1 - x0 + 1;
      v1[k1Offset] = x1;
      if (x1 > n) k1end += 2;
      else if (y1 > m) k1start += 2;
      else if (front) {
        const k2Offset = vOffset + delta - k1;
        if (k2Offset >= 0 && k2Offset < vLength && v2[k2Offset] !== -1) {
          const x2 = n - v2[k2Offset]!;
          if (x1 >= x2) return [aLo + x1, bLo + y1];
        }
      }
    }
    for (let k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
      const k2Offset = vOffset + k2;
      let x2 = k2 === -d || (k2 !== d && v2[k2Offset - 1]! < v2[k2Offset + 1]!) ? v2[k2Offset + 1]! : v2[k2Offset - 1]! + 1;
      let y2 = x2 - k2;
      const x0 = x2;
      while (x2 < n && y2 < m && a[aHi - x2 - 1] === b[bHi - y2 - 1]) {
        x2++;
        y2++;
      }
      budget.left -= x2 - x0 + 1;
      v2[k2Offset] = x2;
      if (x2 > n) k2end += 2;
      else if (y2 > m) k2start += 2;
      else if (!front) {
        const k1Offset = vOffset + delta - k2;
        if (k1Offset >= 0 && k1Offset < vLength && v1[k1Offset] !== -1) {
          const x1 = v1[k1Offset]!;
          const y1 = vOffset + x1 - k1Offset;
          if (x1 >= n - x2) return [aLo + x1, bLo + y1];
        }
      }
    }
  }
  return null;
}

/**
 * The edits that turn `oldText` into `newText`, word by word (see the token classes above):
 * a common prefix and suffix are cut off first (the usual typo fix touches one word of a long
 * transcript), then the rest is diffed over tokens with Myers' algorithm.
 */
export function computeEdits(oldText: string, newText: string): TextEdit[] {
  if (oldText === newText) return [];
  const a = oldText;
  const b = newText;
  const min = Math.min(a.length, b.length);
  let p = 0;
  while (p < min && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  // Back up to a token boundary that holds in both texts.
  while (p > 0 && !(boundary(a, p) && boundary(b, p))) p--;
  let s = 0;
  while (s < min - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  while (s > 0 && !(boundary(a, a.length - s) && boundary(b, b.length - s))) s--;
  const aEnd = a.length - s;
  const bEnd = b.length - s;
  if (p === aEnd || p === bEnd) return [{ start: p, end: aEnd, insert: b.slice(p, bEnd) }];

  const intern = new Map<string, number>();
  const ta = tokenize(a, p, aEnd, intern);
  const tb = tokenize(b, p, bEnd, intern);
  const runs = matchRuns(ta.ids, tb.ids);
  const edits: TextEdit[] = [];
  let ai = 0;
  let bi = 0;
  const gap = (aj: number, bj: number) => {
    if (aj === ai && bj === bi) return;
    edits.push({ start: ta.pos[ai]!, end: ta.pos[aj]!, insert: b.slice(tb.pos[bi]!, tb.pos[bj]!) });
  };
  for (let r = 0; r < runs.length; r += 3) {
    const ra = runs[r]!;
    const rb = runs[r + 1]!;
    gap(ra, rb);
    ai = ra + runs[r + 2]!;
    bi = rb + runs[r + 2]!;
  }
  gap(ta.ids.length, tb.ids.length);
  return normalizeEdits(edits);
}

// ---------------------------------------------------------------------------------------------
// Units of text: paragraphs and sentences, for autocoding and "expand to sentence".

/** Paragraphs: runs separated by `\n` (empty ones are skipped). */
export function paragraphSpans(text: string): Span[] {
  const out: Span[] = [];
  let at = 0;
  while (at <= text.length) {
    let nl = text.indexOf('\n', at);
    if (nl < 0) nl = text.length;
    if (nl > at) out.push({ start: at, end: nl });
    at = nl + 1;
  }
  return out;
}

// A sentence ends at . ! ? … (or their ideographic forms), with any closing quotes or brackets,
// followed by whitespace or the end of the paragraph. Abbreviations ("Dr.") split too: it is a
// heuristic the researcher can widen by hand.
const RE_SENTENCE_END = /[.!?…。！？]+["'”’»)\]]*(?=\s|$)|[。！？]+/gu;

/** Sentences, never crossing a paragraph break, trimmed of surrounding whitespace. */
export function sentenceSpans(text: string): Span[] {
  const out: Span[] = [];
  for (const para of paragraphSpans(text)) {
    const body = text.slice(para.start, para.end);
    const re = new RegExp(RE_SENTENCE_END.source, 'gu');
    let from = 0;
    let m: RegExpExecArray | null;
    const push = (s: number, e: number) => {
      const t = trimSpan(text, { start: para.start + s, end: para.start + e });
      if (t) out.push(t);
    };
    while ((m = re.exec(body))) {
      const end = m.index + m[0].length;
      push(from, end);
      from = end;
    }
    push(from, body.length);
  }
  return out;
}

/** The span without leading and trailing whitespace, or null when nothing else is in it. */
export function trimSpan(text: string, span: Span): Span | null {
  let { start, end } = span;
  start = Math.max(0, Math.min(start, text.length));
  end = Math.max(start, Math.min(end, text.length));
  while (start < end && /\s/.test(text[start]!)) start++;
  while (end > start && /\s/.test(text[end - 1]!)) end--;
  // Never cut a surrogate pair in half: widen to the whole character.
  if (splitsPair(text, start)) start--;
  if (splitsPair(text, end)) end++;
  return end > start ? { start, end } : null;
}

/**
 * Widens a span to whole units: from the start of the unit holding `span.start` to the end of
 * the unit holding the last character. `units` are sorted, non-overlapping (from
 * paragraphSpans/sentenceSpans). A span edge in the gap between units keeps its position.
 */
export function expandToUnits(span: Span, units: readonly Span[]): Span {
  const find = (pos: number): Span | undefined => {
    let lo = 0;
    let hi = units.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (units[mid]!.end <= pos) lo = mid + 1;
      else hi = mid;
    }
    const u = units[lo];
    return u && u.start <= pos ? u : undefined;
  };
  const first = find(span.start);
  const last = find(Math.max(span.start, span.end - 1));
  return { start: Math.min(span.start, first?.start ?? span.start), end: Math.max(span.end, last?.end ?? span.end) };
}

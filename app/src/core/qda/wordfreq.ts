// Word frequencies (word clouds and lists), words within the segments of a code, keyness
// between two sets of texts (log-likelihood), and keyword-in-context for a word.
//
// Counting: words are tokens as defined in text.ts, lower-cased (accents kept: in Portuguese
// "é" and "e" are different words), with curly apostrophes made straight. An elided article
// that is a stop word of the language is dropped ("l'école" → "école", "dell'anno" → "anno"),
// and in English a possessive 's is ("children's" → "children").
//
// Transcript markup is not what anyone said, so by default it is not counted: the speaker label
// that starts each turn of a transcript ("Interviewer: …") and transcribers' annotations in
// square brackets ("[laughs]", "[ri-se]", "[ríe]", "[inaudible]", "[00:12:03]"). A text counts as
// a transcript when its kind says so, or, without a kind, when most of its paragraphs start with
// a speaker label. `includeMarkup` counts them anyway.

import type { Coding } from '../model/types';
import { contextAround, DEFAULT_SEARCH_LIMIT, type KwicRow, kwic, type SearchHit, type SearchOptions, type SearchResult } from './search';
import { logLikelihood, logRatio, chiSquarePValue } from './stats';
import { stopwordsFor } from './stopwords';
import { wordRegex } from './text';
import { type Descendants, type Span, codeRows, groupBy, mergeSpans } from './util';

export interface WordFrequencyOptions {
  /** Language of the material, for stop words ('en', 'pt', 'es', 'fr', 'de', 'it', 'nl'). */
  language?: string | null;
  /** Words left out besides the language's stop words (any case). */
  extraStopwords?: readonly string[];
  /** Leave out the language's stop words (default true). */
  useStopwords?: boolean;
  /** Shortest word counted, in characters (default 3). */
  minLength?: number;
  /** Count tokens without letters, such as "2023" (default false). */
  includeNumbers?: boolean;
  /** Most frequent words returned (default: all). */
  limit?: number;
  /** Count transcript speaker labels and [bracketed annotations] too (default false). */
  includeMarkup?: boolean;
}

export interface WordCount {
  word: string;
  count: number;
  /** Number of texts the word occurs in. */
  documents: number;
  /** count / countedTokens × 100. */
  percent: number;
}

export interface WordFrequencies {
  /** Most frequent first; ties in code-unit order of the word. */
  words: WordCount[];
  /** Every word token in the texts, before any filtering (the corpus size). */
  totalTokens: number;
  /** Tokens left after stop words, length and number filters. */
  countedTokens: number;
  /** Distinct words after filtering (before `limit`). */
  distinctWords: number;
}

export type TextInput = string | { id?: string; text: string; /** The document kind ('transcript', 'text'…), when known. */ kind?: string };

// A speaker label at the start of a paragraph: a short name (up to 4 words, 40 characters)
// followed by a colon and a space, optionally after a [timestamp].
const SPEAKER = /^[ \t]*(?:\[[^\]\n]{0,40}\][ \t]*)?([\p{L}\p{M}][\p{L}\p{M}\p{N}.'’_-]*(?: [\p{L}\p{M}\p{N}.'’_-]+){0,3})[ \t]*:(?=[ \t]|$)/u;
const BRACKETED = /\[[^\]\n]{0,120}\]/g;

/**
 * Spans of transcript markup in a text: speaker labels starting paragraphs (only in a
 * transcript, see the top of this file) and bracketed annotations anywhere. In text order.
 */
export function markupSpans(text: string, kind?: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const labels: { start: number; end: number }[] = [];
  let paragraphs = 0;
  for (let at = 0; at <= text.length; ) {
    let nl = text.indexOf('\n', at);
    if (nl < 0) nl = text.length;
    const line = text.slice(at, nl);
    if (line.trim()) {
      paragraphs++;
      const m = SPEAKER.exec(line);
      if (m && m[1]!.length <= 40) labels.push({ start: at, end: at + m[0].length });
    }
    at = nl + 1;
  }
  const transcript = kind !== undefined ? kind === 'transcript' : labels.length >= 2 && labels.length * 2 >= paragraphs;
  if (transcript) out.push(...labels);
  BRACKETED.lastIndex = 0;
  for (let m = BRACKETED.exec(text); m; m = BRACKETED.exec(text)) out.push({ start: m.index, end: m.index + m[0].length });
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** The text with its markup (markupSpans) blanked out by spaces: offsets stay as they were. */
export function maskMarkup(text: string, kind?: string): string {
  const spans = markupSpans(text, kind);
  if (!spans.length) return text;
  let out = '';
  let at = 0;
  for (const s of spans) {
    if (s.end <= at) continue;
    const from = Math.max(at, s.start);
    out += text.slice(at, from) + ' '.repeat(s.end - from);
    at = s.end;
  }
  return out + text.slice(at);
}

const HAS_LETTER = /\p{L}/u;
const HYPHENS = /[‐‑]/g;
const APOS = /[’ʼ]/g;

interface Counter {
  count: number;
  docs: number;
  last: number;
}

/** Normalises one lower-cased token; '' means "skip". */
function makeNormaliser(language: string | null | undefined, stop: ReadonlySet<string>) {
  const english = (language ?? '').toLowerCase().startsWith('en');
  return (w: string): string => {
    if (w.indexOf("'") >= 0) {
      const i = w.indexOf("'");
      if (stop.has(w.slice(0, i + 1))) w = w.slice(i + 1);
      if (english && w.endsWith("'s") && w.length > 2 && !stop.has(w)) w = w.slice(0, -2);
    }
    return w;
  };
}

function codePointLength(w: string, atLeast: number): number {
  // Only count code points when surrogates could make the UTF-16 length misleading.
  if (w.length >= atLeast * 2) return w.length;
  let n = 0;
  for (let i = 0; i < w.length; i++) {
    const c = w.charCodeAt(i);
    if (c < 0xdc00 || c > 0xdfff) n++;
  }
  return n;
}

interface Tally {
  counts: Map<string, Counter>;
  totalTokens: number;
  countedTokens: number;
}

function tally(texts: readonly TextInput[], opts: WordFrequencyOptions): Tally {
  const minLength = Math.max(1, opts.minLength ?? 3);
  const includeNumbers = !!opts.includeNumbers;
  const base = opts.useStopwords === false ? new Set<string>() : stopwordsFor(opts.language);
  const stop = new Set(base);
  for (const w of opts.extraStopwords ?? []) {
    const n = w.normalize('NFC').toLowerCase().replace(APOS, "'").trim();
    if (n) stop.add(n);
  }
  // Elisions are recognised from the language's list even when stop words are kept.
  const normalise = makeNormaliser(opts.language, stopwordsFor(opts.language));
  const counts = new Map<string, Counter>();
  let totalTokens = 0;
  let countedTokens = 0;
  texts.forEach((t, doc) => {
    let raw = typeof t === 'string' ? t : t.text;
    if (!raw) return;
    if (!opts.includeMarkup) raw = maskMarkup(raw, typeof t === 'string' ? undefined : t.kind);
    // Lower-casing the whole text first is much faster than per token; offsets are not needed.
    const text = raw.toLowerCase().replace(APOS, "'").replace(HYPHENS, '-');
    const re = wordRegex();
    for (let m = re.exec(text); m; m = re.exec(text)) {
      totalTokens++;
      const w = normalise(m[0]);
      if (!w) continue;
      const c0 = w.charCodeAt(0);
      if (!includeNumbers && !(c0 >= 97 && c0 <= 122) && !HAS_LETTER.test(w)) continue;
      if (codePointLength(w, minLength) < minLength) continue;
      if (stop.has(w)) continue;
      countedTokens++;
      const e = counts.get(w);
      if (!e) counts.set(w, { count: 1, docs: 1, last: doc });
      else {
        e.count++;
        if (e.last !== doc) {
          e.docs++;
          e.last = doc;
        }
      }
    }
  });
  return { counts, totalTokens, countedTokens };
}

const byCountThenWord = (a: WordCount, b: WordCount) => b.count - a.count || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0);

/** Word frequencies over texts (each text counts as one document for `documents`). */
export function wordFrequencies(texts: readonly TextInput[], opts: WordFrequencyOptions = {}): WordFrequencies {
  const t = tally(texts, opts);
  const words: WordCount[] = [];
  for (const [word, c] of t.counts) {
    words.push({ word, count: c.count, documents: c.docs, percent: t.countedTokens ? (c.count / t.countedTokens) * 100 : 0 });
  }
  words.sort(byCountThenWord);
  const limit = opts.limit ?? Infinity;
  return {
    words: words.length > limit ? words.slice(0, Math.max(0, limit)) : words,
    totalTokens: t.totalTokens,
    countedTokens: t.countedTokens,
    distinctWords: words.length,
  };
}

export interface WordsByCodeOptions extends WordFrequencyOptions {
  includeChildren?: boolean;
  descendants?: Descendants;
  /**
   * Document id → text. With texts, overlapping segments are merged first so no word is
   * counted twice; without, each segment's own `text` is used (identical spans are counted
   * once, partly overlapping ones twice).
   */
  texts?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
}

function lookup(texts: WordsByCodeOptions['texts'], id: string): string | undefined {
  if (!texts) return undefined;
  if (texts instanceof Map) return texts.get(id);
  const r = texts as Readonly<Record<string, string>>;
  return Object.prototype.hasOwnProperty.call(r, id) ? r[id] : undefined;
}

/** The coded text of the codes, one entry per document (pieces joined by line breaks). */
export function codedTexts(codings: readonly Coding[], codeIds: readonly string[], opts: WordsByCodeOptions = {}): { id: string; text: string }[] {
  const rows = codeRows(codeIds, opts.includeChildren, opts.descendants);
  const selected = codings.filter((c) => !c.deleted && rows.has(c.code_id) && c.end > c.start);
  const out: { id: string; text: string }[] = [];
  for (const [docId, list] of groupBy(selected, (c) => c.document_id)) {
    const text = lookup(opts.texts, docId);
    let pieces: string[];
    if (text !== undefined) {
      pieces = mergeSpans(list.map((c): Span => ({ start: c.start, end: c.end }))).map((s) => text.slice(s.start, s.end));
    } else {
      const seen = new Set<string>();
      pieces = [];
      for (const c of [...list].sort((a, b) => a.start - b.start || a.end - b.end)) {
        const k = `${c.start}:${c.end}`;
        if (!seen.has(k)) {
          seen.add(k);
          pieces.push(c.text);
        }
      }
    }
    out.push({ id: docId, text: pieces.join('\n') });
  }
  return out;
}

/** Word frequencies within the segments of the given codes (`documents` = documents). */
export function wordsByCode(codings: readonly Coding[], codeIds: readonly string[], opts: WordsByCodeOptions = {}): WordFrequencies {
  return wordFrequencies(codedTexts(codings, codeIds, opts), opts);
}

export interface KeywordRow {
  word: string;
  countA: number;
  countB: number;
  /** Occurrences per 10,000 tokens of each side. */
  perTenThousandA: number;
  perTenThousandB: number;
  /** Log-likelihood G² (1 degree of freedom). */
  logLikelihood: number;
  p: number;
  /** log2 of the ratio of relative frequencies (effect size; positive = more frequent in A). */
  logRatio: number;
  /** Which side uses the word more, relative to its size (null when equal). */
  overused: 'A' | 'B' | null;
}

export interface CompareOptions extends WordFrequencyOptions {
  /** Leave out words whose combined count is below this (default 2). */
  minCount?: number;
}

/**
 * Keyness of every word between texts A and B, most distinctive first (highest G²). Corpus
 * sizes are each side's total tokens before filtering, as in Rayson & Garside (2000).
 */
export function compareFrequencies(a: readonly TextInput[], b: readonly TextInput[], opts: CompareOptions = {}): {
  rows: KeywordRow[];
  totalA: number;
  totalB: number;
} {
  const ta = tally(a, opts);
  const tb = tally(b, opts);
  const c = ta.totalTokens;
  const d = tb.totalTokens;
  const minCount = opts.minCount ?? 2;
  const words = new Set([...ta.counts.keys(), ...tb.counts.keys()]);
  const rows: KeywordRow[] = [];
  for (const word of words) {
    const x = ta.counts.get(word)?.count ?? 0;
    const y = tb.counts.get(word)?.count ?? 0;
    if (x + y < minCount) continue;
    const ll = logLikelihood(x, y, c, d);
    const ra = c ? x / c : 0;
    const rb = d ? y / d : 0;
    rows.push({
      word,
      countA: x,
      countB: y,
      perTenThousandA: ra * 10_000,
      perTenThousandB: rb * 10_000,
      logLikelihood: ll,
      p: chiSquarePValue(ll, 1),
      logRatio: logRatio(x, y, c, d),
      overused: ra > rb ? 'A' : rb > ra ? 'B' : null,
    });
  }
  rows.sort((p, q) => q.logLikelihood - p.logLikelihood || (p.word < q.word ? -1 : p.word > q.word ? 1 : 0));
  const limit = opts.limit ?? Infinity;
  return { rows: rows.length > limit ? rows.slice(0, Math.max(0, limit)) : rows, totalA: c, totalB: d };
}

/**
 * Where one word occurs as counted above (same tokens, same normalisation, markup left out
 * unless `includeMarkup`), as search hits: the word list's KWIC total then always equals the
 * word's count. "falar" is not found inside "falar-me" (one word), "well-being" is found as
 * "well‐being". Limit and context as in searchTexts.
 */
export function wordHits(
  docs: readonly { id: string; text: string; kind?: string }[],
  word: string,
  opts: WordFrequencyOptions & SearchOptions = {},
): SearchResult {
  const limit = Math.max(0, opts.limit ?? DEFAULT_SEARCH_LIMIT);
  const width = opts.context ?? 60;
  const target = word.normalize('NFC').toLowerCase().replace(APOS, "'").replace(HYPHENS, '-').trim();
  const normalise = makeNormaliser(opts.language, stopwordsFor(opts.language));
  const hits: SearchHit[] = [];
  const perDocument = new Map<string, number>();
  let total = 0;
  if (!target) return { hits, total, truncated: false, perDocument };
  for (const doc of docs) {
    if (!doc.text) continue;
    const masked = opts.includeMarkup ? doc.text : maskMarkup(doc.text, doc.kind);
    // Lower-casing keeps UTF-16 offsets for the letters words are made of.
    const lower = masked.toLowerCase();
    const text = lower.length === doc.text.length ? lower.replace(APOS, "'").replace(HYPHENS, '-') : null;
    const re = wordRegex();
    const src = text ?? masked;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      const tok = text ? m[0] : m[0].toLowerCase().replace(APOS, "'").replace(HYPHENS, '-');
      const norm = normalise(tok);
      if (norm !== target) continue;
      total++;
      perDocument.set(doc.id, (perDocument.get(doc.id) ?? 0) + 1);
      if (hits.length >= limit) continue;
      // The word itself: without an elided article ("l'école") or a possessive ("children's").
      let start = m.index;
      let end = start + m[0].length;
      if (norm.length < tok.length && tok.endsWith(norm)) start = end - norm.length;
      else if (norm.length < tok.length && tok.startsWith(norm)) end = start + norm.length;
      const ctx = contextAround(doc.text, start, end, width);
      hits.push({ documentId: doc.id, start, end, before: ctx.before, match: doc.text.slice(start, end), after: ctx.after });
    }
  }
  return { hits, total, truncated: total > hits.length, perDocument };
}

/** Keyword-in-context rows for one word as counted above (see `wordHits`). */
export function wordKwic(docs: readonly { id: string; text: string; kind?: string }[], word: string, opts: WordFrequencyOptions & SearchOptions & { width?: number } = {}): {
  rows: KwicRow[];
  total: number;
  truncated: boolean;
} {
  if (!word.trim()) return { rows: [], total: 0, truncated: false };
  const r = wordHits(docs, word, opts);
  return { rows: kwic(r.hits, opts.width), total: r.total, truncated: r.truncated };
}

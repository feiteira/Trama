// Text positions at the REFI-QDA boundary.
//
// Trama stores UTF-16 offsets into an LF-only, BOM-less, NFC text. REFI-QDA files count Unicode
// code points (spec §10.2) into the text file as written, but real producers deviate: ATLAS.ti
// writes CRLF files and counts each CRLF as one character, NVivo counts it as two, some tools
// may count UTF-16 units, and QualCoder leaves a BOM in front. The maps below convert offsets
// between these spaces for whole documents; the detection picks the counting a file uses by
// checking which one makes the selections' text start with their `name`.

export type Side = 'start' | 'end';

/**
 * A monotonic map between two index spaces that agree except at a few places ("events"),
 * where `fromLen` units on one side correspond to `toLen` units on the other (a surrogate pair
 * vs one code point, CRLF vs LF, a decomposed vs a composed character). Between events the
 * spaces advance together. Lookups are binary searches over the events, so a 20-million
 * character document costs memory only for its line breaks and special characters.
 *
 * A position strictly inside an event (the middle of a surrogate pair, between CR and LF) has
 * no exact image: `start` positions round down, `end` positions round up, so a span never
 * loses the characters it touches.
 */
export class OffsetMap {
  private readonly from: Int32Array;
  private readonly to: Int32Array;
  private readonly fromLen: Int32Array;
  private readonly toLen: Int32Array;

  constructor(
    events: OffsetMapBuilder,
    readonly fromLength: number,
    readonly toLength: number,
  ) {
    this.from = Int32Array.from(events.from);
    this.to = Int32Array.from(events.to);
    this.fromLen = Int32Array.from(events.fromLen);
    this.toLen = Int32Array.from(events.toLen);
  }

  static identity(length: number): OffsetMap {
    return new OffsetMap(new OffsetMapBuilder(), length, length);
  }

  get isIdentity(): boolean {
    return this.from.length === 0;
  }

  forward(pos: number, side: Side = 'start'): number {
    return lookup(this.from, this.fromLen, this.to, this.toLen, clamp(pos, this.fromLength), side);
  }

  backward(pos: number, side: Side = 'start'): number {
    return lookup(this.to, this.toLen, this.from, this.fromLen, clamp(pos, this.toLength), side);
  }
}

export class OffsetMapBuilder {
  from: number[] = [];
  to: number[] = [];
  fromLen: number[] = [];
  toLen: number[] = [];

  add(from: number, to: number, fromLen: number, toLen: number): void {
    this.from.push(from);
    this.to.push(to);
    this.fromLen.push(fromLen);
    this.toLen.push(toLen);
  }
}

const clamp = (pos: number, max: number) => (pos < 0 ? 0 : pos > max ? max : Math.floor(pos));

function lookup(keys: Int32Array, keyLen: Int32Array, vals: Int32Array, valLen: Int32Array, pos: number, side: Side): number {
  // Last event whose key is ≤ pos.
  let lo = 0;
  let hi = keys.length - 1;
  let k = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid]! <= pos) {
      k = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (k < 0) return pos;
  const key = keys[k]!;
  const len = keyLen[k]!;
  const val = vals[k]!;
  if (pos === key) return val;
  if (pos < key + len) return side === 'start' ? val : val + valLen[k]!;
  return val + valLen[k]! + (pos - key - len);
}

// ---------------------------------------------------------------------------------------------
// UTF-16 ↔ code points

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** Map from UTF-16 offsets (forward) to code-point offsets (backward converts back). */
export function codePointMap(text: string): OffsetMap {
  const b = new OffsetMapBuilder();
  let cp = 0;
  for (let i = 0; i < text.length; i++) {
    if (isHigh(text.charCodeAt(i)) && i + 1 < text.length && isLow(text.charCodeAt(i + 1))) {
      b.add(i, cp, 2, 1);
      i++;
    }
    cp++;
  }
  return new OffsetMap(b, text.length, cp);
}

export function codePointLength(text: string): number {
  let n = text.length;
  for (let i = 0; i + 1 < text.length; i++) {
    if (isHigh(text.charCodeAt(i)) && isLow(text.charCodeAt(i + 1))) {
      n--;
      i++;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------------------------
// Raw REFI text → LF text

export interface PositionMode {
  /** What one position counts. */
  unit: 'codepoint' | 'utf16';
  /** How many positions one CRLF takes. */
  crlf: 1 | 2;
}

export const SPEC_MODE: PositionMode = { unit: 'codepoint', crlf: 2 };

export const modeKey = (m: PositionMode) => `${m.unit}/${m.crlf}`;

/**
 * Turns a text as decoded from a REFI file (BOM already removed) into LF-only text, with a map
 * from the file's positions (counted as `mode` says) to UTF-16 offsets of the LF text.
 * A lone CR (classic Mac) becomes LF one-for-one.
 */
export function rawToLf(raw: string, mode: PositionMode): { text: string; map: OffsetMap } {
  const b = new OffsetMapBuilder();
  const cp = mode.unit === 'codepoint';
  const hasCr = raw.includes('\r');
  if (!hasCr && (!cp || !hasAstral(raw))) return { text: raw, map: OffsetMap.identity(raw.length) };
  let u = 0; // position in the file's units
  let o = 0; // offset in the LF text
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c === 13 && raw.charCodeAt(i + 1) === 10) {
      if (mode.crlf === 2) {
        b.add(u, o, 2, 1);
        u += 2;
      } else u += 1;
      o += 1;
      i++;
    } else if (cp && isHigh(c) && isLow(raw.charCodeAt(i + 1))) {
      b.add(u, o, 1, 2);
      u += 1;
      o += 2;
      i++;
    } else {
      u++;
      o++;
    }
  }
  const text = hasCr ? raw.replace(/\r\n?/g, '\n') : raw;
  return { text, map: new OffsetMap(b, u, o) };
}

const ASTRAL = /[\uD800-\uDBFF][\uDC00-\uDFFF]/;
const hasAstral = (s: string) => ASTRAL.test(s);

// ---------------------------------------------------------------------------------------------
// NFC with offsets

// A character that may combine with what precedes it: marks, Hangul medial/final jamo.
const CONTINUES = /[\p{M}ᅠ-ᇿ]/u;
// A cluster: one code point and the characters that may compose with it.
const CLUSTER = /[\s\S][\p{M}ᅠ-ᇿ]*/gu;
const CHUNK = 1 << 16;

/**
 * Normalises to NFC and maps offsets of the input (forward) to offsets of the result. Most
 * texts are already NFC: they are checked in chunks and copied untouched; only chunks that
 * change are normalised cluster by cluster, so positions inside a recomposed character still
 * round outward.
 */
export function toNfc(text: string): { text: string; map: OffsetMap } {
  if (text.normalize('NFC') === text) return { text, map: OffsetMap.identity(text.length) };
  const b = new OffsetMapBuilder();
  const out: string[] = [];
  let o = 0;
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + CHUNK);
    // Never split a cluster (or a surrogate pair) between chunks.
    while (end < text.length && (isLow(text.charCodeAt(end)) || CONTINUES.test(String.fromCodePoint(text.codePointAt(end)!)))) end++;
    const chunk = text.slice(i, end);
    const norm = chunk.normalize('NFC');
    if (norm === chunk) {
      out.push(chunk);
      o += chunk.length;
    } else {
      CLUSTER.lastIndex = 0;
      for (let m = CLUSTER.exec(chunk); m; m = CLUSTER.exec(chunk)) {
        const c = m[0];
        const n = c.normalize('NFC');
        if (n.length !== c.length) b.add(i + m.index, o, c.length, n.length);
        out.push(n);
        o += n.length;
      }
    }
    i = end;
  }
  return { text: out.join(''), map: new OffsetMap(b, text.length, o) };
}

// ---------------------------------------------------------------------------------------------
// Importing a text

/** A REFI text made canonical, with its positions converter. */
export interface CanonicalText {
  text: string;
  /** REFI position → UTF-16 offset into `text` (clamped to the text). */
  toCanonical(pos: number, side: Side): number;
  /** The largest valid REFI position for this text under the chosen mode. */
  maxPosition: number;
}

export function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Canonical (LF, NFC) text and position converter for a raw REFI text under `mode`. */
export function canonicalize(raw: string, mode: PositionMode): CanonicalText {
  const lf = rawToLf(stripBom(raw), mode);
  const nfc = toNfc(lf.text);
  return {
    text: nfc.text,
    maxPosition: lf.map.fromLength,
    toCanonical: (pos, side) => nfc.map.forward(lf.map.forward(pos, side), side),
  };
}

/** A selection whose `name` may show the start of its text (ATLAS.ti, Trama, MAXQDA…). */
export interface SelectionProbe {
  start: number;
  end: number;
  name: string;
}

/** The counting modes that differ for this text (one when it has neither CRLF nor astral characters). */
export function candidateModes(raw: string): PositionMode[] {
  const crlf = raw.includes('\r\n');
  const astral = hasAstral(raw);
  const units: PositionMode['unit'][] = astral ? ['codepoint', 'utf16'] : ['codepoint'];
  const crlfs: PositionMode['crlf'][] = crlf ? [2, 1] : [2];
  return units.flatMap((unit) => crlfs.map((c) => ({ unit, crlf: c })));
}

const MAX_PROBES = 64;
const NAME_PREFIX = 60;

const squash = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

/**
 * Whether the selected text agrees with a selection name, or null when the name says nothing
 * about the text (empty, a label too short to count). The selected text must start with the
 * name (whitespace runs compared as one space, a trailing ellipsis ignored); leading
 * whitespace in the selection counts, so a span shifted onto a line break does not agree.
 */
export function nameAgrees(selected: string, name: string): boolean | null {
  let n = squash(name);
  n = n.replace(/(…|\.\.\.)$/, '').trimEnd();
  if (n.length < 3) return null;
  const s = selected.normalize('NFC').replace(/\s+/g, ' ');
  return s.startsWith(n.slice(0, NAME_PREFIX));
}

/** Evenly spaced probes across the document: late selections tell the modes apart best. */
export function sampleProbes(probes: SelectionProbe[]): SelectionProbe[] {
  const usable = probes.filter((p) => squash(p.name).length >= 3).sort((a, b) => a.start - b.start);
  if (usable.length <= MAX_PROBES) return usable;
  const out: SelectionProbe[] = [];
  for (let k = 0; k < MAX_PROBES; k++) out.push(usable[Math.round((k * (usable.length - 1)) / (MAX_PROBES - 1))]!);
  return out;
}

/** How many probes each candidate mode explains (by `modeKey`). */
export function scoreModes(raw: string, probes: SelectionProbe[]): Map<string, number> {
  const scores = new Map<string, number>();
  const body = stripBom(raw);
  const sample = sampleProbes(probes);
  for (const mode of candidateModes(body)) {
    let score = 0;
    if (sample.length) {
      const lf = rawToLf(body, mode);
      for (const p of sample) {
        if (p.start < 0 || p.end > lf.map.fromLength || p.end <= p.start) {
          score--; // impossible under this mode
          continue;
        }
        const s = lf.map.forward(p.start, 'start');
        const e = lf.map.forward(p.end, 'end');
        if (nameAgrees(lf.text.slice(s, e), p.name) === true) score++;
      }
    }
    scores.set(modeKey(mode), score);
  }
  return scores;
}

/**
 * Picks the mode for one text: the candidate that explains the most probes; on a tie (or no
 * evidence) the one closest to `prior` (counting unit and CRLF rule judged separately).
 */
export function chooseMode(raw: string, scores: Map<string, number>, prior: PositionMode): PositionMode {
  const candidates = candidateModes(stripBom(raw));
  let best = candidates[0]!;
  let bestScore = -Infinity;
  for (const m of candidates) {
    const s = scores.get(modeKey(m)) ?? 0;
    const closeness = (m.unit === prior.unit ? 0.2 : 0) + (m.crlf === prior.crlf ? 0.1 : 0);
    if (s + closeness > bestScore) {
      best = m;
      bestScore = s + closeness;
    }
  }
  return best;
}

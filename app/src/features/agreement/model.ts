// View models of the agreement screen: interpretation bands, default selections, running the
// three levels of core/qda/agreement.ts over a selection, the per-code and per-document table
// rows, and the disagreements list. Pure (no DOM, no React), tested in Node.

import type { Code, Coding, Document } from '../../core/model/types';
import {
  type BinaryStats,
  binaryStats,
  type CharacterAgreement,
  characterAgreement,
  type DocumentAgreement,
  documentAgreement,
  type SegmentAgreement,
  type SegmentAgreementCode,
  segmentAgreement,
  type SegmentDisagreement,
  type AgreementTable,
} from '../../core/qda/agreement';

export type Level = 'character' | 'segment' | 'document';
export const LEVELS: readonly Level[] = ['character', 'segment', 'document'];

// ── Interpretation ───────────────────────────────────────────────────────────────────────────

/** Landis & Koch (1977) labels for kappa. Conventions, not thresholds with a meaning of their own. */
export type KappaBand = 'poor' | 'slight' | 'fair' | 'moderate' | 'substantial' | 'almostPerfect';
export const KAPPA_BANDS: readonly { band: KappaBand; from: number }[] = [
  { band: 'poor', from: -Infinity },
  { band: 'slight', from: 0 },
  { band: 'fair', from: 0.2 },
  { band: 'moderate', from: 0.4 },
  { band: 'substantial', from: 0.6 },
  { band: 'almostPerfect', from: 0.8 },
];

// Values are compared after rounding to two decimals, as the bands are published (0.21–0.40…),
// so a kappa shown as "0.40" is never labelled one band up.
const round2 = (x: number) => Math.round(x * 100) / 100;

export function kappaBand(k: number | null): KappaBand | null {
  if (k === null || !Number.isFinite(k)) return null;
  const r = round2(k);
  if (r < 0) return 'poor';
  if (r <= 0.2) return 'slight';
  if (r <= 0.4) return 'fair';
  if (r <= 0.6) return 'moderate';
  if (r <= 0.8) return 'substantial';
  return 'almostPerfect';
}

/** Krippendorff's guidance: rely on α ≥ .800; draw tentative conclusions only from α ≥ .667. */
export type AlphaBand = 'reliable' | 'tentative' | 'unreliable';

export function alphaBand(a: number | null): AlphaBand | null {
  if (a === null || !Number.isFinite(a)) return null;
  const r = Math.round(a * 1000) / 1000;
  if (r >= 0.8) return 'reliable';
  if (r >= 0.667) return 'tentative';
  return 'unreliable';
}

/** How a table cell is tinted: a calm three-step scale, or none when there is no value. */
export type Tone = 'good' | 'fair' | 'weak' | 'none';

export function kappaTone(k: number | null): Tone {
  const b = kappaBand(k);
  if (b === null) return 'none';
  if (b === 'substantial' || b === 'almostPerfect') return 'good';
  if (b === 'moderate') return 'fair';
  return 'weak';
}

export function alphaTone(a: number | null): Tone {
  const b = alphaBand(a);
  return b === null ? 'none' : b === 'reliable' ? 'good' : b === 'tentative' ? 'fair' : 'weak';
}

/** Percentages (0–100): ≥ 80 good, ≥ 60 fair. */
export function percentTone(p: number | null): Tone {
  if (p === null || !Number.isFinite(p)) return 'none';
  if (p >= 80) return 'good';
  if (p >= 60) return 'fair';
  return 'weak';
}

// ── Formatting ───────────────────────────────────────────────────────────────────────────────

export const DASH = '—';

const nf = new Map<string, Intl.NumberFormat>();
function numberFormat(bcp47: string, digits: number, style: 'decimal' | 'percent' = 'decimal'): Intl.NumberFormat {
  const key = `${bcp47}|${digits}|${style}`;
  let f = nf.get(key);
  if (!f) nf.set(key, (f = new Intl.NumberFormat(bcp47, { style, minimumFractionDigits: digits, maximumFractionDigits: digits })));
  return f;
}

/** A coefficient (kappa, alpha) with fixed decimals; a dash when undefined. */
export function fmtCoef(x: number | null, bcp47: string, digits = 2): string {
  if (x === null || !Number.isFinite(x)) return DASH;
  // −0.00 reads as a sign error.
  const v = Math.abs(x) < 0.5 * 10 ** -digits ? 0 : x;
  return numberFormat(bcp47, digits).format(v);
}

/** A percentage given in 0–100, one decimal; a dash when undefined. */
export function fmtPercent(p: number | null, bcp47: string, digits = 1): string {
  if (p === null || !Number.isFinite(p)) return DASH;
  return numberFormat(bcp47, digits, 'percent').format(p / 100);
}

export function fmtInt(n: number, bcp47: string): string {
  return numberFormat(bcp47, 0).format(n);
}

// ── Selection ────────────────────────────────────────────────────────────────────────────────

/** Live codings of one coder. */
export function codingsOf(codings: readonly Coding[], coderId: string | null): Coding[] {
  if (!coderId) return [];
  return codings.filter((c) => !c.deleted && c.coder_id === coderId && c.end > c.start);
}

/**
 * The coders compared first: me (when I coded anything) as A and whoever coded most besides as
 * B; without codings by me, the two who coded most. Null sides when there are not enough coders.
 */
export function defaultPair(
  coders: readonly { id: string }[],
  counts: ReadonlyMap<string | null, number>,
  meId: string | null,
): { a: string | null; b: string | null } {
  const n = (id: string) => counts.get(id) ?? 0;
  const ranked = [...coders].sort((x, y) => n(y.id) - n(x.id));
  const me = meId && coders.some((c) => c.id === meId) && n(meId) > 0 ? meId : null;
  const a = me ?? ranked[0]?.id ?? null;
  const b = ranked.find((c) => c.id !== a)?.id ?? null;
  return { a, b };
}

const docsOf = (codings: readonly Coding[]) => new Set(codings.map((c) => c.document_id));

/** Documents both coders coded, in the order given. */
export function docsBothCoded(documents: readonly Pick<Document, 'id'>[], a: readonly Coding[], b: readonly Coding[]): string[] {
  const da = docsOf(a);
  const db = docsOf(b);
  return documents.filter((d) => da.has(d.id) && db.has(d.id)).map((d) => d.id);
}

export interface CodeUse {
  /** Used by both coders in the documents. */
  both: string[];
  /** Used by only one of them (left out by default, but a complete disagreement). */
  oneOnly: string[];
}

/** Which codes each coder used within some documents, in the order of `codes`. */
export function codeUse(codes: readonly Pick<Code, 'id'>[], a: readonly Coding[], b: readonly Coding[], documentIds: readonly string[]): CodeUse {
  const docs = new Set(documentIds);
  const used = (list: readonly Coding[]) => new Set(list.filter((c) => docs.has(c.document_id)).map((c) => c.code_id));
  const ua = used(a);
  const ub = used(b);
  const both: string[] = [];
  const oneOnly: string[] = [];
  for (const c of codes) {
    const x = ua.has(c.id);
    const y = ub.has(c.id);
    if (x && y) both.push(c.id);
    else if (x || y) oneOnly.push(c.id);
  }
  return { both, oneOnly };
}

// ── Running the comparison ───────────────────────────────────────────────────────────────────

export interface AgreementInput {
  codingsA: readonly Coding[];
  codingsB: readonly Coding[];
  /** The selected documents, in display order, with their text length. */
  documents: readonly { id: string; length: number }[];
  codeIds: readonly string[];
  /** Segment overlap threshold, 0.5–1. */
  threshold: number;
}

export interface DocLevelCounts extends AgreementTable {
  /** Codes compared in the document (both + aOnly + bOnly + neither). */
  total: number;
}

export interface PerDocument {
  documentId: string;
  /** All selected codes pooled within the document. */
  character: BinaryStats;
  segment: { agree: number; disagree: number; percent: number | null; codes: SegmentAgreementCode[] };
  /** Codes present per coder in this document. */
  presence: BinaryStats;
}

export interface AgreementResult {
  character: CharacterAgreement;
  segment: SegmentAgreement;
  document: DocumentAgreement;
  perDocument: PerDocument[];
  documentIds: string[];
  codeIds: string[];
}

const EMPTY: AgreementTable = { both: 0, aOnly: 0, bOnly: 0, neither: 0 };
const add = (x: AgreementTable, y: AgreementTable): AgreementTable => ({
  both: x.both + y.both,
  aOnly: x.aOnly + y.aOnly,
  bOnly: x.bOnly + y.bOnly,
  neither: x.neither + y.neither,
});

/** All three levels over a selection, plus per-document figures for the tables and sparklines. */
export function runAgreement(input: AgreementInput): AgreementResult {
  const docIds = input.documents.map((d) => d.id);
  const docSet = new Set(docIds);
  const codeIds = [...new Set(input.codeIds)];
  const codeSet = new Set(codeIds);
  const keep = (list: readonly Coding[]) => list.filter((c) => docSet.has(c.document_id) && codeSet.has(c.code_id));
  const a = keep(input.codingsA);
  const b = keep(input.codingsB);
  const character = characterAgreement(a, b, input.documents, codeIds);
  const segment = segmentAgreement(a, b, codeIds, { threshold: input.threshold, documentIds: docIds });
  const document = documentAgreement(a, b, docIds, codeIds);

  // Per document: segment agreement run on each document's codings only (linear overall).
  const byDoc = (list: Coding[]) => {
    const m = new Map<string, Coding[]>();
    for (const c of list) {
      let l = m.get(c.document_id);
      if (!l) m.set(c.document_id, (l = []));
      l.push(c);
    }
    return m;
  };
  const ad = byDoc(a);
  const bd = byDoc(b);
  const presenceA = new Set(a.map((c) => `${c.code_id}\u0000${c.document_id}`));
  const presenceB = new Set(b.map((c) => `${c.code_id}\u0000${c.document_id}`));
  const perDocument = docIds.map((documentId, di): PerDocument => {
    let t = EMPTY;
    for (const c of character.codes) t = add(t, c.perDocument[di]!.stats);
    const s = segmentAgreement(ad.get(documentId) ?? [], bd.get(documentId) ?? [], codeIds, { threshold: input.threshold });
    const p = { both: 0, aOnly: 0, bOnly: 0, neither: 0 };
    for (const id of codeIds) {
      const x = presenceA.has(`${id}\u0000${documentId}`);
      const y = presenceB.has(`${id}\u0000${documentId}`);
      if (x && y) p.both++;
      else if (x) p.aOnly++;
      else if (y) p.bOnly++;
      else p.neither++;
    }
    return {
      documentId,
      character: binaryStats(t),
      segment: { agree: s.agree, disagree: s.disagree, percent: s.percent, codes: s.codes },
      presence: binaryStats(p),
    };
  });
  return { character, segment, document, perDocument, documentIds: docIds, codeIds };
}

// ── Table rows ───────────────────────────────────────────────────────────────────────────────

export interface CodeRow {
  codeId: string;
  name: string;
  color: string;
  character: BinaryStats;
  segment: SegmentAgreementCode;
  document: BinaryStats;
  /** One value per selected document (0–1), null where there was nothing to compare. */
  spark: Record<Level, (number | null)[]>;
}

export function codeRows(result: AgreementResult, codes: ReadonlyMap<string, Pick<Code, 'name' | 'color'>>): CodeRow[] {
  return result.codeIds.map((codeId, i) => {
    const ch = result.character.codes[i]!;
    const sg = result.segment.codes[i]!;
    const dc = result.document.codes[i]!;
    const code = codes.get(codeId);
    return {
      codeId,
      name: code?.name ?? '?',
      color: code?.color ?? '#7a7f87',
      character: ch.pooled,
      segment: sg,
      document: dc.stats,
      spark: {
        character: ch.perDocument.map((p) => (p.stats.percentAmongCoded === null ? null : p.stats.percentAmongCoded / 100)),
        segment: result.perDocument.map((p) => {
          const pc = p.segment.codes[i]?.percent;
          return pc === null || pc === undefined ? null : pc / 100;
        }),
        document: result.perDocument.map((_p, di) => {
          const st = ch.perDocument[di]?.stats;
          if (!st) return null;
          const x = st.both + st.aOnly > 0;
          const y = st.both + st.bOnly > 0;
          return x && y ? 1 : x || y ? 0 : null;
        }),
      },
    };
  });
}

export type SortKey = 'name' | 'kappa' | 'alpha' | 'percent' | 'percentCoded' | 'agree' | 'disagree' | 'aOnly' | 'bOnly' | 'units';
export type SortDirection = 'asc' | 'desc';

/** The number a column of the per-code table shows at a level (null: nothing to show). */
export function codeValue(row: CodeRow, key: Exclude<SortKey, 'name'>, level: Level): number | null {
  if (level === 'segment') {
    const s = row.segment;
    switch (key) {
      case 'percent':
        return s.percent;
      case 'agree':
        return s.agree;
      case 'disagree':
        return s.disagree;
      case 'aOnly':
        return s.aDisagree;
      case 'bOnly':
        return s.bDisagree;
      case 'units':
        return s.agree + s.disagree;
      default:
        return null;
    }
  }
  const st = level === 'character' ? row.character : row.document;
  switch (key) {
    case 'kappa':
      return st.kappa;
    case 'alpha':
      return st.alpha;
    case 'percent':
      return st.percentAgreement;
    case 'percentCoded':
      return st.percentAmongCoded;
    case 'agree':
      return st.both;
    case 'disagree':
      return st.aOnly + st.bOnly;
    case 'aOnly':
      return st.aOnly;
    case 'bOnly':
      return st.bOnly;
    case 'units':
      return st.both + st.aOnly + st.bOnly;
  }
}

/** Sorted copy; rows without a value always go last, ties by name. */
export function sortCodeRows(rows: readonly CodeRow[], key: SortKey, dir: SortDirection, level: Level, collator: Intl.Collator): CodeRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((x, y) => {
    if (key === 'name') return sign * collator.compare(x.name, y.name);
    const a = codeValue(x, key, level);
    const b = codeValue(y, key, level);
    if (a === null && b === null) return collator.compare(x.name, y.name);
    if (a === null) return 1;
    if (b === null) return -1;
    return sign * (a - b) || collator.compare(x.name, y.name);
  });
}

// ── Disagreements ────────────────────────────────────────────────────────────────────────────

export interface SideSpan {
  codingId: string;
  start: number;
  end: number;
}

export type DisagreementKind = 'boundary' | 'onlyA' | 'onlyB';

export interface DisagreementItem {
  /** Stable while both codings exist: "<A coding id>|<B coding id>" with "-" for a missing side. */
  key: string;
  kind: DisagreementKind;
  documentId: string;
  codeId: string;
  a: SideSpan | null;
  b: SideSpan | null;
  /** Overlap ratio between the two sides (0 when only one coded). */
  overlap: number;
  /** The union of both sides. */
  start: number;
  end: number;
}

const spanKey = (codeId: string, documentId: string, s: { start: number; end: number }) => `${codeId}\u0000${documentId}\u0000${s.start}\u0000${s.end}`;

/**
 * The disagreeing segments as items to review. A segment of A and one of B that overlap but
 * fall short of the threshold are one "boundary" item, paired when each is the other's
 * closest match (else with the closest still unpaired); the rest stand alone.
 */
export function pairDisagreements(list: readonly SegmentDisagreement[], docOrder: ReadonlyMap<string, number> = new Map()): DisagreementItem[] {
  const bByKey = new Map<string, SegmentDisagreement>();
  for (const d of list) if (d.coder === 'B') bByKey.set(spanKey(d.codeId, d.documentId, d), d);
  const usedB = new Set<string>();
  const items: DisagreementItem[] = [];
  const as = list.filter((d) => d.coder === 'A');
  // Mutual pairs first, so a non-mutual claim never steals a segment from its true partner.
  const pending: SegmentDisagreement[] = [];
  const pair = (a: SegmentDisagreement, b: SegmentDisagreement) => {
    usedB.add(b.codingId);
    items.push({
      key: `${a.codingId}|${b.codingId}`,
      kind: 'boundary',
      documentId: a.documentId,
      codeId: a.codeId,
      a: { codingId: a.codingId, start: a.start, end: a.end },
      b: { codingId: b.codingId, start: b.start, end: b.end },
      overlap: a.bestOverlap,
      start: Math.min(a.start, b.start),
      end: Math.max(a.end, b.end),
    });
  };
  for (const a of as) {
    const b = a.closest ? bByKey.get(spanKey(a.codeId, a.documentId, a.closest)) : undefined;
    if (b && !usedB.has(b.codingId) && b.closest && b.closest.start === a.start && b.closest.end === a.end) pair(a, b);
    else pending.push(a);
  }
  for (const a of pending) {
    const b = a.closest ? bByKey.get(spanKey(a.codeId, a.documentId, a.closest)) : undefined;
    if (b && !usedB.has(b.codingId)) pair(a, b);
    else items.push(single(a));
  }
  for (const d of list) if (d.coder === 'B' && !usedB.has(d.codingId)) items.push(single(d));
  const rank = (id: string) => docOrder.get(id) ?? Number.MAX_SAFE_INTEGER;
  return items.sort(
    (x, y) =>
      rank(x.documentId) - rank(y.documentId) ||
      (x.documentId < y.documentId ? -1 : x.documentId > y.documentId ? 1 : 0) ||
      x.start - y.start ||
      x.end - y.end ||
      (x.key < y.key ? -1 : 1),
  );
}

function single(d: SegmentDisagreement): DisagreementItem {
  const side = { codingId: d.codingId, start: d.start, end: d.end };
  return {
    key: d.coder === 'A' ? `${d.codingId}|-` : `-|${d.codingId}`,
    kind: d.coder === 'A' ? 'onlyA' : 'onlyB',
    documentId: d.documentId,
    codeId: d.codeId,
    a: d.coder === 'A' ? side : null,
    b: d.coder === 'B' ? side : null,
    overlap: d.bestOverlap,
    start: d.start,
    end: d.end,
  };
}

export type Resolution = 'acceptA' | 'acceptB' | 'keepBoth';

/** The codings a resolution removes: accepting A removes B's coding, and the other way round. */
export function resolutionRemoves(item: DisagreementItem, choice: Resolution): string[] {
  if (choice === 'acceptA') return item.b ? [item.b.codingId] : [];
  if (choice === 'acceptB') return item.a ? [item.a.codingId] : [];
  return [];
}

/** What was resolved in this session (the review is a working list, not project data). */
export interface ReviewState {
  /** Items kept as they are. */
  kept: ReadonlySet<string>;
  /** Coding that stayed → the coding removed by accepting it. */
  survivors: ReadonlyMap<string, string>;
}

export const EMPTY_REVIEW: ReviewState = { kept: new Set(), survivors: new Map() };

/** The review after resolving an item; removing nothing counts as keeping it. */
export function reviewAfter(state: ReviewState, item: DisagreementItem, choice: Resolution): ReviewState {
  const removes = resolutionRemoves(item, choice);
  if (!removes.length) return { ...state, kept: new Set([...state.kept, item.key]) };
  const survivor = choice === 'acceptA' ? item.a : item.b;
  if (!survivor) return state;
  return { ...state, survivors: new Map([...state.survivors, [survivor.codingId, removes[0]!]]) };
}

/**
 * Whether an item counts as resolved. After "Accept A" on a boundary pair, A's segment is left
 * on its own: it is resolved for as long as B's removed coding stays removed (an Undo brings
 * the pair back as it was).
 */
export function isResolved(item: DisagreementItem, state: ReviewState, liveCodingIds: ReadonlySet<string>): boolean {
  if (state.kept.has(item.key)) return true;
  if (item.kind === 'boundary') return false;
  const side = item.a ?? item.b;
  const removed = side ? state.survivors.get(side.codingId) : undefined;
  return removed !== undefined && !liveCodingIds.has(removed);
}

// ── The passage around a disagreement ────────────────────────────────────────────────────────

/**
 * The stretch of text to show around [start, end): whole paragraphs, but at most about
 * `context` characters on either side (cut at a space), so a long transcript turn stays short.
 */
export function passageWindow(text: string, start: number, end: number, context = 360): { start: number; end: number; cutBefore: boolean; cutAfter: boolean } {
  const s0 = Math.max(0, Math.min(start, text.length));
  const e0 = Math.max(s0, Math.min(end, text.length));
  const para0 = text.lastIndexOf('\n', s0 - 1) + 1;
  let para1 = text.indexOf('\n', e0);
  if (para1 < 0) para1 = text.length;
  let s = para0;
  let e = para1;
  let cutBefore = false;
  let cutAfter = false;
  if (s0 - s > context) {
    const sp = text.indexOf(' ', s0 - context);
    s = sp >= 0 && sp < s0 ? sp + 1 : s0 - context;
    cutBefore = true;
  }
  if (e - e0 > context) {
    const sp = text.lastIndexOf(' ', e0 + context);
    e = sp > e0 ? sp : e0 + context;
    cutAfter = true;
  }
  return { start: s, end: e, cutBefore, cutAfter };
}

export interface Piece {
  start: number;
  end: number;
  a: boolean;
  b: boolean;
}

/** The window cut where either coder's spans begin or end, marking who coded each piece. */
export function pieces(
  from: number,
  to: number,
  aSpans: readonly { start: number; end: number }[],
  bSpans: readonly { start: number; end: number }[],
): Piece[] {
  const cuts = new Set<number>([from, to]);
  for (const s of [...aSpans, ...bSpans]) {
    if (s.start > from && s.start < to) cuts.add(s.start);
    if (s.end > from && s.end < to) cuts.add(s.end);
  }
  const xs = [...cuts].sort((x, y) => x - y);
  const inside = (spans: readonly { start: number; end: number }[], p: number, q: number) => spans.some((s) => s.start <= p && s.end >= q);
  const out: Piece[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const p = xs[i]!;
    const q = xs[i + 1]!;
    if (q <= p) continue;
    const piece = { start: p, end: q, a: inside(aSpans, p, q), b: inside(bSpans, p, q) };
    const last = out[out.length - 1];
    if (last && last.a === piece.a && last.b === piece.b) last.end = q;
    else out.push(piece);
  }
  return out;
}

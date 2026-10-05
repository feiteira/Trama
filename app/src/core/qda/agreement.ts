// Inter-coder agreement between two coders, A and B, at three levels. Every number can be
// traced back to the counts it comes from; nothing is averaged without saying so.
//
// (a) Character level (like NVivo's coding comparison, but pooled correctly). For one code and
//     one document every character gets a label per coder: coded (1) or not (0). The 2 × 2
//     table counts characters coded by both, by A only, by B only, by neither. Per code the
//     tables of all documents are *added* before computing kappa or alpha (a pooled estimate,
//     not an unweighted average of per-document kappas, which lets a two-line document weigh as
//     much as a long interview). Statistics:
//       percent agreement     (both + neither) / all characters;
//       percent among coded   both / (both + A only + B only): agreement over the characters
//                             at least one coder coded, since the large "neither" mass of a
//                             rarely used code makes plain percent agreement look excellent;
//       Cohen's kappa         (po − pe) / (1 − pe), pe from each coder's own coding rate;
//       Krippendorff's alpha  nominal, two coders, units = characters (coincidence matrix).
//     When there is no variation at all (every character has the same label from both coders,
//     e.g. nobody used the code) chance agreement is total, both kappa and alpha are 0/0 and we
//     report null ("undefined"), never 1 or 0.
// (b) Segment level (like MAXQDA). A segment of A agrees when B has a segment of the same code
//     in the same document overlapping it by at least `threshold` of their combined span
//     (overlap / (max end − min start); default 0.9), or by any amount with 'any'. Every
//     segment of both coders is checked (both directions), independently: one long segment of
//     B can confirm several of A. Percent = agreements / (agreements + disagreements).
//     Brennan & Prediger's kappa = (po − 1/k) / (1 − 1/k): chance agreement is 1/k with k =
//     the number of codes compared, because at segment level there is no "neither" cell from
//     which Cohen's pe could be estimated. With a single code k is taken as 2 (coded / not).
// (c) Document level: for each code, whether each coder used it at least once in each
//     document; the same 2 × 2 statistics over documents.

import type { Coding } from '../model/types';
import { type Descendants, type Span, clampSpans, codeRows, groupBy, intersectLength, mergeSpans, totalLength } from './util';

export interface AgreementTable {
  /** Units (characters or documents) coded by both coders. */
  both: number;
  aOnly: number;
  bOnly: number;
  neither: number;
}

export interface BinaryStats extends AgreementTable {
  total: number;
  percentAgreement: number | null;
  /** both / (both + aOnly + bOnly) × 100: agreement among units at least one coder coded. */
  percentAmongCoded: number | null;
  kappa: number | null;
  alpha: number | null;
}

const EMPTY_TABLE: AgreementTable = { both: 0, aOnly: 0, bOnly: 0, neither: 0 };

function addTables(x: AgreementTable, y: AgreementTable): AgreementTable {
  return { both: x.both + y.both, aOnly: x.aOnly + y.aOnly, bOnly: x.bOnly + y.bOnly, neither: x.neither + y.neither };
}

/**
 * Cohen's kappa for a 2 × 2 table, via the exact identity
 * κ = 2(ad − bc) / ((a + b)(b + d) + (a + c)(c + d)), which avoids rounding in po and pe.
 * Null when undefined (no variation: chance agreement is 1).
 */
export function cohenKappa(t: AgreementTable): number | null {
  const a = t.both;
  const b = t.aOnly;
  const c = t.bOnly;
  const d = t.neither;
  const den = (a + b) * (b + d) + (a + c) * (c + d);
  if (den === 0) return null;
  return (2 * (a * d - b * c)) / den;
}

/** Cohen's kappa for a k × k confusion matrix (rows: coder A's category, columns: B's). */
export function cohenKappaMatrix(m: readonly (readonly number[])[]): number | null {
  const k = m.length;
  let n = 0;
  let agree = 0;
  const row = new Array<number>(k).fill(0);
  const col = new Array<number>(k).fill(0);
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      const x = m[i]![j] ?? 0;
      n += x;
      row[i]! += x;
      col[j]! += x;
      if (i === j) agree += x;
    }
  }
  if (n === 0) return null;
  const po = agree / n;
  let pe = 0;
  for (let i = 0; i < k; i++) pe += (row[i]! / n) * (col[i]! / n);
  if (1 - pe <= 1e-12) return null;
  return (po - pe) / (1 - pe);
}

/**
 * Krippendorff's alpha, nominal, two coders, binary values, no missing data. Coincidence
 * matrix: each unit contributes its pair of values in both orders, so o01 = A only + B only,
 * n0 = 2·neither + o01, n1 = 2·both + o01, n = 2·units, and α = 1 − (n − 1)·o01 / (n0·n1).
 * Null when n0·n1 = 0 (no variation) or there are fewer than two units.
 */
export function krippendorffAlphaBinary(t: AgreementTable): number | null {
  const o01 = t.aOnly + t.bOnly;
  const n0 = 2 * t.neither + o01;
  const n1 = 2 * t.both + o01;
  const n = n0 + n1;
  if (n < 4 || n0 === 0 || n1 === 0) return null;
  return 1 - ((n - 1) * o01) / (n0 * n1);
}

/**
 * Krippendorff's alpha for nominal data, any number of coders, missing values allowed (null).
 * `units[u][c]` is coder c's value for unit u. Units with fewer than two values are not
 * pairable and are skipped. Null when expected disagreement is 0 (only one value in use).
 */
export function krippendorffAlphaNominal(units: readonly (readonly (string | number | boolean | null | undefined)[])[]): number | null {
  const o = new Map<string, Map<string, number>>();
  const add = (c: string, k: string, w: number) => {
    let row = o.get(c);
    if (!row) o.set(c, (row = new Map()));
    row.set(k, (row.get(k) ?? 0) + w);
  };
  for (const unit of units) {
    const vals = unit.filter((v): v is string | number | boolean => v !== null && v !== undefined).map((v) => `${typeof v}:${v}`);
    const m = vals.length;
    if (m < 2) continue;
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (i !== j) add(vals[i]!, vals[j]!, 1 / (m - 1));
  }
  const nc = new Map<string, number>();
  let n = 0;
  let disagreeObs = 0;
  for (const [c, row] of o) {
    for (const [k, w] of row) {
      nc.set(c, (nc.get(c) ?? 0) + w);
      n += w;
      if (c !== k) disagreeObs += w;
    }
  }
  let disagreeExp = 0;
  for (const [c, a] of nc) for (const [k, b] of nc) if (c !== k) disagreeExp += a * b;
  if (n <= 1 || disagreeExp === 0) return null;
  return 1 - ((n - 1) * disagreeObs) / disagreeExp;
}

/** All statistics for a 2 × 2 table (percentages in 0–100). */
export function binaryStats(t: AgreementTable): BinaryStats {
  const total = t.both + t.aOnly + t.bOnly + t.neither;
  const coded = t.both + t.aOnly + t.bOnly;
  return {
    ...t,
    total,
    percentAgreement: total > 0 ? ((t.both + t.neither) / total) * 100 : null,
    percentAmongCoded: coded > 0 ? (t.both / coded) * 100 : null,
    kappa: cohenKappa(t),
    alpha: krippendorffAlphaBinary(t),
  };
}

// ---------------------------------------------------------------------------------------------
// (a) Character level
// ---------------------------------------------------------------------------------------------

export interface DocumentLength {
  id: string;
  /** Text length in UTF-16 code units (Document.chars). */
  length: number;
}

export interface AgreementOptions {
  includeChildren?: boolean;
  descendants?: Descendants;
}

export interface CharacterAgreementCode {
  codeId: string;
  /** Tables of all documents added together. */
  pooled: BinaryStats;
  perDocument: { documentId: string; stats: BinaryStats }[];
}

export interface CharacterAgreement {
  codes: CharacterAgreementCode[];
  /** All codes pooled: every (code, character) is one unit. */
  overall: BinaryStats;
}

function spansByRowAndDoc(codings: readonly Coding[], rows: Map<string, number[]>, k: number): Map<string, Span[][]> {
  const out = new Map<string, Span[][]>();
  for (const c of codings) {
    if (c.deleted) continue;
    const rs = rows.get(c.code_id);
    if (!rs) continue;
    let perRow = out.get(c.document_id);
    if (!perRow) out.set(c.document_id, (perRow = Array.from({ length: k }, () => [])));
    for (const r of rs) perRow[r]!.push({ start: c.start, end: c.end });
  }
  return out;
}

/** Character-level agreement per code, pooled over the documents given. */
export function characterAgreement(
  codingsA: readonly Coding[],
  codingsB: readonly Coding[],
  documents: readonly DocumentLength[],
  codeIds: readonly string[],
  opts: AgreementOptions = {},
): CharacterAgreement {
  const ids = [...new Set(codeIds)];
  const rows = codeRows(ids, opts.includeChildren, opts.descendants);
  const sa = spansByRowAndDoc(codingsA, rows, ids.length);
  const sb = spansByRowAndDoc(codingsB, rows, ids.length);
  const docs = [...new Map(documents.map((d) => [d.id, d])).values()];
  let overall = EMPTY_TABLE;
  const codes = ids.map((codeId, r): CharacterAgreementCode => {
    let pooled = EMPTY_TABLE;
    const perDocument = docs.map((d) => {
      const L = Math.max(0, d.length);
      const ua = mergeSpans(clampSpans(sa.get(d.id)?.[r] ?? [], L));
      const ub = mergeSpans(clampSpans(sb.get(d.id)?.[r] ?? [], L));
      const la = totalLength(ua);
      const lb = totalLength(ub);
      const both = intersectLength(ua, ub);
      const t = { both, aOnly: la - both, bOnly: lb - both, neither: L - la - lb + both };
      pooled = addTables(pooled, t);
      return { documentId: d.id, stats: binaryStats(t) };
    });
    overall = addTables(overall, pooled);
    return { codeId, pooled: binaryStats(pooled), perDocument };
  });
  return { codes, overall: binaryStats(overall) };
}

// ---------------------------------------------------------------------------------------------
// (b) Segment level
// ---------------------------------------------------------------------------------------------

export interface SegmentAgreementOptions extends AgreementOptions {
  /** Share of the combined span that must overlap (0–1, default 0.9), or 'any' overlap. */
  threshold?: number | 'any';
  /** Only segments in these documents are compared (usually the ones both coders coded). */
  documentIds?: readonly string[];
}

export interface SegmentDisagreement {
  /** Whose segment found no match. */
  coder: 'A' | 'B';
  codingId: string;
  codeId: string;
  documentId: string;
  start: number;
  end: number;
  /** Best overlap ratio reached with the other coder's segments of the code (0 if none). */
  bestOverlap: number;
  /** The other coder's segment that came closest, if any overlapped at all. */
  closest: Span | null;
}

export interface SegmentAgreementCode {
  codeId: string;
  aAgree: number;
  aDisagree: number;
  bAgree: number;
  bDisagree: number;
  agree: number;
  disagree: number;
  percent: number | null;
}

export interface SegmentAgreement {
  threshold: number | 'any';
  codes: SegmentAgreementCode[];
  agree: number;
  disagree: number;
  percent: number | null;
  /** Number of categories used for chance agreement (see the header). */
  categories: number;
  chance: number;
  /** Brennan & Prediger's kappa; null when there are no segments. */
  kappa: number | null;
  disagreements: SegmentDisagreement[];
}

/** Overlap of two spans divided by their combined span (max end − min start). */
export function overlapRatio(a: Span, b: Span): number {
  const ov = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  if (ov <= 0) return 0;
  const span = Math.max(a.end, b.end) - Math.min(a.start, b.start);
  return span > 0 ? ov / span : 0;
}

interface Seg {
  c: Coding;
  row: number;
}

function segmentsByKey(codings: readonly Coding[], rows: Map<string, number[]>, docOk: Set<string> | null): Map<string, Seg[]> {
  const list: Seg[] = [];
  for (const c of codings) {
    if (c.deleted || c.end <= c.start) continue;
    if (docOk && !docOk.has(c.document_id)) continue;
    for (const row of rows.get(c.code_id) ?? []) list.push({ c, row });
  }
  const m = groupBy(list, (s) => `${s.row}\u0000${s.c.document_id}`);
  for (const l of m.values()) l.sort((x, y) => x.c.start - y.c.start);
  return m;
}

export function segmentAgreement(
  codingsA: readonly Coding[],
  codingsB: readonly Coding[],
  codeIds: readonly string[],
  opts: SegmentAgreementOptions = {},
): SegmentAgreement {
  const ids = [...new Set(codeIds)];
  const threshold = opts.threshold ?? 0.9;
  if (threshold !== 'any' && !(threshold > 0 && threshold <= 1)) throw new RangeError('threshold must be in (0, 1] or "any"');
  const rows = codeRows(ids, opts.includeChildren, opts.descendants);
  const docOk = opts.documentIds ? new Set(opts.documentIds) : null;
  const ga = segmentsByKey(codingsA, rows, docOk);
  const gb = segmentsByKey(codingsB, rows, docOk);
  const codes: SegmentAgreementCode[] = ids.map((codeId) => ({ codeId, aAgree: 0, aDisagree: 0, bAgree: 0, bDisagree: 0, agree: 0, disagree: 0, percent: null }));
  const disagreements: SegmentDisagreement[] = [];

  const check = (mine: Map<string, Seg[]>, theirs: Map<string, Seg[]>, coder: 'A' | 'B') => {
    for (const [key, segs] of mine) {
      const other = theirs.get(key) ?? [];
      for (const s of segs) {
        let best = 0;
        let closest: Span | null = null;
        // `other` is sorted by start: everything starting at or after s.end cannot overlap.
        for (const o of other) {
          if (o.c.start >= s.c.end) break;
          const r = overlapRatio(s.c, o.c);
          if (r > best) {
            best = r;
            closest = { start: o.c.start, end: o.c.end };
          }
        }
        const ok = threshold === 'any' ? best > 0 : best >= threshold - 1e-12;
        const row = codes[s.row]!;
        if (coder === 'A') {
          if (ok) row.aAgree++;
          else row.aDisagree++;
        } else if (ok) row.bAgree++;
        else row.bDisagree++;
        if (!ok) {
          disagreements.push({
            coder,
            codingId: s.c.id,
            codeId: ids[s.row]!,
            documentId: s.c.document_id,
            start: s.c.start,
            end: s.c.end,
            bestOverlap: best,
            closest,
          });
        }
      }
    }
  };
  check(ga, gb, 'A');
  check(gb, ga, 'B');

  let agree = 0;
  let disagree = 0;
  for (const c of codes) {
    c.agree = c.aAgree + c.bAgree;
    c.disagree = c.aDisagree + c.bDisagree;
    c.percent = c.agree + c.disagree > 0 ? (c.agree / (c.agree + c.disagree)) * 100 : null;
    agree += c.agree;
    disagree += c.disagree;
  }
  disagreements.sort(
    (x, y) => (x.documentId < y.documentId ? -1 : x.documentId > y.documentId ? 1 : 0) || x.start - y.start || x.end - y.end || (x.coder < y.coder ? -1 : x.coder > y.coder ? 1 : 0),
  );
  const categories = Math.max(2, ids.length);
  const chance = 1 / categories;
  const po = agree + disagree > 0 ? agree / (agree + disagree) : null;
  return {
    threshold,
    codes,
    agree,
    disagree,
    percent: po === null ? null : po * 100,
    categories,
    chance,
    kappa: po === null ? null : (po - chance) / (1 - chance),
    disagreements,
  };
}

// ---------------------------------------------------------------------------------------------
// (c) Document level
// ---------------------------------------------------------------------------------------------

export interface DocumentAgreementCode {
  codeId: string;
  stats: BinaryStats;
  /** Documents where only one coder used the code. */
  disagreements: { documentId: string; coder: 'A' | 'B' }[];
}

export interface DocumentAgreement {
  codes: DocumentAgreementCode[];
  /** All (code, document) pairs pooled. */
  overall: BinaryStats;
}

export function documentAgreement(
  codingsA: readonly Coding[],
  codingsB: readonly Coding[],
  documentIds: readonly string[],
  codeIds: readonly string[],
  opts: AgreementOptions = {},
): DocumentAgreement {
  const ids = [...new Set(codeIds)];
  const docs = [...new Set(documentIds)];
  const rows = codeRows(ids, opts.includeChildren, opts.descendants);
  const presence = (codings: readonly Coding[]) => {
    const s = new Set<string>();
    for (const c of codings) {
      if (c.deleted) continue;
      for (const r of rows.get(c.code_id) ?? []) s.add(`${r}\u0000${c.document_id}`);
    }
    return s;
  };
  const pa = presence(codingsA);
  const pb = presence(codingsB);
  let overall = EMPTY_TABLE;
  const codes = ids.map((codeId, r): DocumentAgreementCode => {
    const t = { both: 0, aOnly: 0, bOnly: 0, neither: 0 };
    const disagreements: { documentId: string; coder: 'A' | 'B' }[] = [];
    for (const d of docs) {
      const a = pa.has(`${r}\u0000${d}`);
      const b = pb.has(`${r}\u0000${d}`);
      if (a && b) t.both++;
      else if (a) {
        t.aOnly++;
        disagreements.push({ documentId: d, coder: 'A' });
      } else if (b) {
        t.bOnly++;
        disagreements.push({ documentId: d, coder: 'B' });
      } else t.neither++;
    }
    overall = addTables(overall, t);
    return { codeId, stats: binaryStats(t), disagreements };
  });
  return { codes, overall: binaryStats(overall) };
}

// ---------------------------------------------------------------------------------------------
// Report table
// ---------------------------------------------------------------------------------------------

export interface AgreementSummaryRow {
  /** null for the totals row. */
  codeId: string | null;
  charPercent: number | null;
  charPercentAmongCoded: number | null;
  charKappa: number | null;
  charAlpha: number | null;
  segAgree: number | null;
  segDisagree: number | null;
  segPercent: number | null;
  docPercent: number | null;
  docKappa: number | null;
}

export const AGREEMENT_SUMMARY_COLUMNS = [
  'codeId', 'charPercent', 'charPercentAmongCoded', 'charKappa', 'charAlpha',
  'segAgree', 'segDisagree', 'segPercent', 'docPercent', 'docKappa',
] as const satisfies readonly (keyof AgreementSummaryRow)[];

/**
 * One row per code and a totals row (codeId null), joining whichever levels were computed.
 * The totals row holds the pooled character and document statistics and, for segments, the
 * overall counts; segment kappa (Brennan & Prediger) is an overall figure only: see `segment`.
 */
export function agreementSummary(levels: {
  character?: CharacterAgreement;
  segment?: SegmentAgreement;
  document?: DocumentAgreement;
}): AgreementSummaryRow[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const l of [levels.character?.codes, levels.segment?.codes, levels.document?.codes]) {
    for (const c of l ?? []) if (!seen.has(c.codeId)) seen.add(c.codeId) && ids.push(c.codeId);
  }
  const ch = new Map((levels.character?.codes ?? []).map((c) => [c.codeId, c.pooled]));
  const sg = new Map((levels.segment?.codes ?? []).map((c) => [c.codeId, c]));
  const dc = new Map((levels.document?.codes ?? []).map((c) => [c.codeId, c.stats]));
  const row = (codeId: string | null, c?: BinaryStats, s?: { agree: number; disagree: number; percent: number | null }, d?: BinaryStats): AgreementSummaryRow => ({
    codeId,
    charPercent: c?.percentAgreement ?? null,
    charPercentAmongCoded: c?.percentAmongCoded ?? null,
    charKappa: c?.kappa ?? null,
    charAlpha: c?.alpha ?? null,
    segAgree: s ? s.agree : null,
    segDisagree: s ? s.disagree : null,
    segPercent: s?.percent ?? null,
    docPercent: d?.percentAgreement ?? null,
    docKappa: d?.kappa ?? null,
  });
  const rows = ids.map((id) => row(id, ch.get(id), sg.get(id), dc.get(id)));
  rows.push(row(null, levels.character?.overall, levels.segment, levels.document?.overall));
  return rows;
}

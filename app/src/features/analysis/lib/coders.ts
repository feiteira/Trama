// Whose codings the analysis tools count.
//
// A project can hold several coders' codings: a teammate's copy merged in, a second coder who
// re-coded some documents for the agreement check. Pooling them silently is wrong: a passage
// coded by two coders counts twice, and two coders disagreeing about one passage (one says
// "Stress relief", the other "Grief & loss") would read as the two codes co-occurring. So the
// tools count one coder's codings (by default the researcher at this computer), or all coders
// with identical segments counted once and co-occurrence counted within each coder.

import type { Coding } from '../../../core/model/types';
import { cooccurrence, type CooccurrenceOptions, type CooccurrencePair, type CooccurrenceResult } from '../../../core/qda/cooccurrence';

/** Every coder's codings, with identical segments counted once. */
export const ALL_CODERS = 'all';

export interface CoderCount {
  id: string;
  name: string;
  count: number;
}

/** Coders who have codings, most codings first (then by name). */
export function coderCounts(codings: readonly Coding[], names: ReadonlyMap<string, string>): CoderCount[] {
  const m = new Map<string, number>();
  for (const c of codings) m.set(c.coder_id, (m.get(c.coder_id) ?? 0) + 1);
  return [...m]
    .map(([id, count]) => ({ id, name: names.get(id) ?? '', count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/**
 * The scope in effect: the stored choice while that coder still has codings (or 'all'), else
 * the researcher at this computer when they have codings, else the only coder, else all.
 */
export function effectiveScope(choice: string, coders: readonly CoderCount[], meId: string): string {
  if (choice === ALL_CODERS) return coders.length > 1 ? ALL_CODERS : (coders[0]?.id ?? ALL_CODERS);
  if (choice && coders.some((c) => c.id === choice)) return choice;
  if (coders.some((c) => c.id === meId)) return meId;
  if (coders.length === 1) return coders[0]!.id;
  return ALL_CODERS;
}

const spanKey = (c: Pick<Coding, 'document_id' | 'code_id' | 'start' | 'end'>) => `${c.document_id}\u0000${c.code_id}\u0000${c.start}\u0000${c.end}`;

/** One coding per (document, code, start, end): the same segment coded alike by several coders. */
export function dedupeSegments(codings: readonly Coding[], preferCoder?: string): Coding[] {
  const kept = new Map<string, number>();
  const out: Coding[] = [];
  for (const c of codings) {
    const k = spanKey(c);
    const at = kept.get(k);
    if (at === undefined) {
      kept.set(k, out.length);
      out.push(c);
    } else if (preferCoder && c.coder_id === preferCoder && out[at]!.coder_id !== preferCoder) out[at] = c;
  }
  return out;
}

/** The codings counted for a scope: one coder's, or everyone's with identical segments once. */
export function scopeCodings(codings: readonly Coding[], scope: string, meId: string): { counted: Coding[]; raw: Coding[] } {
  if (scope !== ALL_CODERS) {
    const own = codings.filter((c) => c.coder_id === scope);
    return { counted: own, raw: own };
  }
  return { counted: dedupeSegments(codings, meId), raw: [...codings] };
}

/**
 * Co-occurrence over several coders' codings: two segments co-occur only when one coder coded
 * both (a disagreement is not a co-occurrence), and a pair found by several coders, like a
 * segment coded alike by several coders, counts once. The diagonal holds the segments as
 * `dedupeSegments` counts them.
 */
export function pooledCooccurrence(raw: readonly Coding[], codeIds: readonly string[], opts: CooccurrenceOptions): CooccurrenceResult {
  const within = cooccurrence(raw, codeIds, { ...opts, sameCoder: true, details: true });
  const counted = cooccurrence(dedupeSegments(raw), codeIds, { ...opts, mode: 'overlap', details: false });
  const byId = new Map(raw.map((c) => [c.id, c]));
  const { codes } = within;
  const k = codes.length;
  const matrix = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const directed = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const jaccard = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const counts = counted.segmentCounts;
  const pairs = new Map<string, CooccurrencePair[]>();
  const key = (id: string, documentId: string, start: number, end: number) => {
    const c = byId.get(id);
    return `${documentId}\u0000${c?.code_id ?? id}\u0000${start}\u0000${end}`;
  };
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const list = within.pairs.get(`${codes[i]}|${codes[j]}`);
      if (!list) continue;
      const seen = new Set<string>();
      const aSegs = new Set<string>();
      const bSegs = new Set<string>();
      const kept: CooccurrencePair[] = [];
      for (const p of list) {
        const a = key(p.aId, p.documentId, p.aStart, p.aEnd);
        const b = key(p.bId, p.documentId, p.bStart, p.bEnd);
        const pk = `${a}\u0001${b}`;
        if (seen.has(pk)) continue;
        seen.add(pk);
        aSegs.add(a);
        bSegs.add(b);
        kept.push(p);
      }
      matrix[i]![j] = matrix[j]![i] = kept.length;
      directed[i]![j] = aSegs.size;
      directed[j]![i] = bSegs.size;
      if (opts.details !== false) pairs.set(`${codes[i]}|${codes[j]}`, kept);
    }
  }
  for (let i = 0; i < k; i++) {
    matrix[i]![i] = counts[i]!;
    directed[i]![i] = counts[i]!;
    jaccard[i]![i] = counts[i]! > 0 ? 1 : 0;
    for (let j = i + 1; j < k; j++) {
      const n = counts[i]! + counts[j]!;
      // Never above 1, even if one coder's segments of a code overlap each other.
      const v = n > 0 ? Math.min(1, (directed[i]![j]! + directed[j]![i]!) / n) : 0;
      jaccard[i]![j] = jaccard[j]![i] = v;
    }
  }
  return { codes, matrix, segmentsWith: directed, jaccard, segmentCounts: counts, pairs, missingTexts: within.missingTexts };
}

// Putting codings back on their words when they may sit on another version of their text: after
// a merge (reconcile.ts) and when deleted codings are restored.

import type { Coding, Draft, Kind } from '../core/model/types';
import { pseudonymiseText } from '../core/qda/pseudonymise';
import { computeEdits, mapRange, type TextEdit } from '../core/qda/ranges';
import type { ProjectContext } from './context';
import { draftOf } from './undo';

/** Where `needle` occurs in `text` closest to `near`, or -1. */
function nearest(text: string, needle: string, near: number): number {
  if (!needle) return -1;
  let best = -1;
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
    if (best < 0 || Math.abs(i - near) < Math.abs(best - near)) best = i;
    if (i > near) break;
  }
  return best;
}

/**
 * Re-anchors a coding on `text`: kept when it already sits on its words; else mapped from the
 * version of the text it was made against (one of `versions` holding its words at its offsets),
 * else found by its words nearest its old place. Null: it cannot be placed.
 */
export function anchor(
  c: Pick<Coding, 'start' | 'end' | 'text'>,
  text: string,
  versions: readonly string[],
  edits: (from: string) => TextEdit[],
  opts: { unique?: boolean } = {},
): { start: number; end: number } | null {
  if (c.end <= text.length && c.start < c.end && text.slice(c.start, c.end) === c.text) return { start: c.start, end: c.end };
  for (const v of versions) {
    if (v === text || c.end > v.length || v.slice(c.start, c.end) !== c.text) continue;
    return mapRange({ start: c.start, end: c.end }, edits(v));
  }
  // `unique`: guessing between several occurrences could put the coding on another passage
  // (another participant's words): only words found once are placed.
  if (opts.unique && c.text && text.indexOf(c.text) !== text.lastIndexOf(c.text)) return null;
  const at = nearest(text, c.text, c.start);
  return at >= 0 ? { start: at, end: at + c.text.length } : null;
}

/** Re-anchors (or removes) the given live codings of one document against its current text. */
export function anchorAll(codings: readonly Coding[], text: string, versions: readonly string[]): { moved: { coding: Coding; start: number; end: number; text: string }[]; lost: Coding[] } {
  const cache = new Map<string, TextEdit[]>();
  const edits = (from: string) => cache.get(from) ?? cache.set(from, computeEdits(from, text)).get(from)!;
  const moved: { coding: Coding; start: number; end: number; text: string }[] = [];
  const lost: Coding[] = [];
  for (const c of codings) {
    const r = anchor(c, text, versions, edits);
    if (!r) lost.push(c);
    else if (r.start !== c.start || r.end !== c.end || text.slice(r.start, r.end) !== c.text) moved.push({ coding: c, ...r, text: text.slice(r.start, r.end) });
  }
  return { moved, lost };
}

/**
 * Re-anchors restored codings on their document's current text. Codings in the trash follow text
 * edits (`applyTextEdits`), so they normally sit on their words already. One deleted by an older
 * Trama before the text changed still holds the offsets and words of the old text: it is found
 * again by its words when they occur once (with the applied pseudonymisation key put into them,
 * when the names were replaced meanwhile), else deleted again rather than put on another passage
 * holding the same words. Returns how many were moved and removed.
 */
export async function reanchorRestored(ctx: ProjectContext, codingIds: readonly string[], batch: string): Promise<{ moved: number; removed: number }> {
  if (!codingIds.length) return { moved: 0, removed: 0 };
  const codings = [...(await ctx.store.getMany('coding', codingIds)).values()].filter((c) => !c.deleted);
  const key = (await ctx.store.list('pseudonym')).filter((p) => p.applied_at !== null);
  const byDoc = new Map<string, Coding[]>();
  for (const c of codings) (byDoc.get(c.document_id) ?? byDoc.set(c.document_id, []).get(c.document_id)!).push(c);
  const texts = await ctx.store.getMany('doctext', byDoc.keys());
  const writes: { kind: Kind; draft: Draft<Kind> }[] = [];
  const lost: string[] = [];
  for (const [docId, list] of byDoc) {
    const t = texts.get(docId);
    if (!t || t.deleted) continue;
    for (const c of list) {
      let r = anchor(c, t.text, [], () => [], { unique: true });
      let words = c.text;
      if (!r && key.length) {
        words = pseudonymiseText(c.text, key);
        if (words !== c.text) r = anchor({ ...c, text: words }, t.text, [], () => [], { unique: true });
      }
      if (!r) {
        lost.push(c.id);
        continue;
      }
      const text = t.text.slice(r.start, r.end);
      if (r.start !== c.start || r.end !== c.end || text !== c.text) writes.push({ kind: 'coding', draft: { ...draftOf(c), start: r.start, end: r.end, text } as Draft<Kind> });
    }
  }
  if (writes.length) await ctx.store.putMany(writes);
  const removed = lost.length ? await ctx.store.remove('coding', lost, { batch }) : 0;
  return { moved: writes.length, removed };
}

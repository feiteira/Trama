// Keeping a project coherent after merging a teammate's copy.
//
// `Store.merge` keeps the newer version of each record on its own. Some records only make sense
// together: a coding is a span of one version of a document's text, `document.chars` is the
// length of its text, a document and its text are deleted and restored as one. After the records
// are merged, this puts them back in step: codings made against another version of the text
// move back onto their words, a document never stays without its text, codings of deleted codes
// and documents go, and `chars` follows the text.

import type { BundleRecord } from '../core/export/bundle';
import { compareHlc } from '../core/hlc';
import { uuid } from '../core/ids';
import type { Code, Coding, DocText, Document, Draft, Kind } from '../core/model/types';
import { compareSiblings } from '../core/qda/tree';
import { TABLES } from '../core/store/schema';
import { compareVersions, semOf, type Store, type Tombstone, type Versioned } from '../core/store/store';
import { anchorAll } from './anchor';
import { capRevs, knows, latestRev, revsOf, seenRev } from './revs';
import { draftOf, recordsInBatch } from './undo';

/** A document whose text was changed both here and in the copy since they last matched. */
export interface TextConflict {
  documentId: string;
  name: string;
  /** The copy's text and revisions (to offer "take the teammate's text instead", see `takeTeammateText`). */
  theirText?: string;
  theirRevs?: string[];
}

type IncomingText = BundleRecord & { kind: 'doctext'; record: DocText };

/**
 * Texts edited on both sides: the copy's text and the one here differ and neither lists the
 * other's latest revision. Whichever is newer, this project's text is kept (a newer typo fix
 * must not undo pseudonymisation done here, say) and the document is reported, so the
 * researcher can bring the teammate's changes over by hand (or take their text). The kept
 * text then records the copy's revision as seen (`seen`): the copies converge, the teammate's
 * next merge takes this text and tells them so (`replaced`).
 *
 * `drop` holds the ids of the copy's texts that would otherwise have won and must be left out
 * of the merge; `replaced`, documents whose text here the copy's replaces because the teammate
 * already kept theirs over this one in a conflict.
 */
export async function textConflicts(
  store: Store,
  records: readonly BundleRecord[],
): Promise<{ conflicts: TextConflict[]; drop: Set<string>; seen: Map<string, string>; replaced: TextConflict[] }> {
  const incoming = records.filter((r): r is IncomingText => r.kind === 'doctext' && !r.record.deleted);
  const conflicts: TextConflict[] = [];
  const replaced: TextConflict[] = [];
  const drop = new Set<string>();
  const seen = new Map<string, string>();
  if (!incoming.length) return { conflicts, drop, seen, replaced };
  const here = await store.getMany('doctext', incoming.map((r) => r.record.id));
  const names = new Map<string, string>();
  for (const r of records) if (r.kind === 'document') names.set(r.record.id, r.record.name);
  const docsHere = await store.getMany('document', incoming.map((r) => r.record.id));
  for (const { record: theirs } of incoming) {
    const mine = here.get(theirs.id);
    if (!mine || mine.deleted || mine.text === theirs.text) continue;
    const theirsWins = compareVersions(mine as Versioned, theirs as Versioned) < 0;
    const name = docsHere.get(theirs.id)?.name || names.get(theirs.id) || theirs.id;
    if (theirsWins) {
      const rel = knows(theirs, latestRev(mine));
      if (rel === 'listed') continue;
      if (rel === 'seen') {
        replaced.push({ documentId: theirs.id, name });
        continue;
      }
      drop.add(theirs.id);
    } else if (knows(mine, latestRev(theirs))) continue;
    seen.set(theirs.id, latestRev(theirs));
    conflicts.push({ documentId: theirs.id, name, theirText: theirs.text, theirRevs: revsOf(theirs) });
  }
  return { conflicts, drop, seen, replaced };
}

/** What a merge is about to write, worked out before it does (see `Store.merge`'s rule). */
export interface MergeTouches {
  /** Documents whose document or doctext record the merge writes. */
  docs: Set<string>;
  /** Codings the merge writes. */
  codings: Set<string>;
  /** Live texts here before the merge, of the documents the merge touches (or the text of one deleted here). */
  before: Map<string, string>;
  /** Live texts the copy carries (of the documents whose codings may need placing). */
  theirs: Map<string, string>;
  /** Codes deleted here that the merge brings back live, with their delete batch. */
  revivedCodes: Map<string, string>;
  /**
   * Codes the copy deleted whose delete loses here (the code was changed here since), with the
   * copy's delete batch: what that delete took with the code (codings, memos, which the copy's
   * newer tombstones delete here) comes back, as the copy will bring it back when it takes the
   * code from this project (`revivedCodes` there).
   */
  keptCodes: Map<string, string>;
  /** Likewise documents the copy deleted that stay live here (changed here since). */
  keptDocs: Map<string, string>;
  /** Documents deleted here before the merge, with their delete batch. */
  deadHere: Map<string, string | null>;
  /** Codings the copy carries. */
  copyCodings: Set<string>;
  /** Of those, the ones that were here before the merge (deleted or not). */
  knownCodings: Set<string>;
  /** Codes and documents the copy deletes (its tombstone wins), by `kind:id`, with the tombstone's stamp. */
  theirDeletes: Map<string, string>;
  /** Texts kept here over the copy's in a conflict: the copy's revision, to record as seen. */
  seen: Map<string, string>;
  /** Every record the merge writes (`kind:id`). */
  written: Set<string>;
}

export async function mergeTouches(store: Store, records: readonly BundleRecord[]): Promise<MergeTouches> {
  const byKind = new Map<Kind, BundleRecord[]>();
  for (const r of records) (byKind.get(r.kind) ?? byKind.set(r.kind, []).get(r.kind)!).push(r);
  const wins = new Map<Kind, BundleRecord[]>();
  const knownCodings = new Set<string>();
  for (const [kind, list] of byKind) {
    const stamps = await store.stamps(kind, list.map((r) => r.record.id));
    if (kind === 'coding') for (const id of stamps.keys()) knownCodings.add(id);
    wins.set(kind, list.filter((r) => {
      const here = stamps.get(r.record.id);
      return here === undefined || compareVersions(here, r.record as Versioned) < 0;
    }));
  }
  const written = new Set<string>();
  for (const [kind, list] of wins) for (const r of list) written.add(`${kind}:${r.record.id}`);
  const docs = new Set<string>();
  for (const r of [...(wins.get('document') ?? []), ...(wins.get('doctext') ?? [])]) docs.add(r.record.id);
  const codingWins = (wins.get('coding') ?? []) as { record: Coding }[];
  const codings = new Set(codingWins.map((r) => r.record.id));
  const textIds = new Set([...docs, ...codingWins.map((r) => r.record.document_id)]);
  const theirs = new Map<string, string>();
  for (const r of byKind.get('doctext') ?? []) if (!r.record.deleted && textIds.has(r.record.id)) theirs.set(r.record.id, (r.record as DocText).text);
  const before = new Map<string, string>();
  const deadHere = new Map<string, string | null>();
  const textsHere = await store.getMany('doctext', textIds);
  for (const [id, d] of await store.getMany('document', docs)) {
    if (d.deleted) deadHere.set(id, (d as Tombstone<'document'>).deleted_batch ?? null);
  }
  for (const [id, t] of textsHere) {
    // A document deleted here keeps its text in the trash: what its codings were placed on.
    if (!t.deleted || (deadHere.has(id) && !(t as Tombstone<'doctext'>).scrubbed)) before.set(id, t.text);
  }
  const revivedCodes = new Map<string, string>();
  const liveCodes = (wins.get('code') ?? []).filter((r) => !r.record.deleted);
  if (liveCodes.length) {
    for (const [id, c] of await store.getMany('code', liveCodes.map((r) => r.record.id))) {
      const batch = (c as Tombstone<'code'>).deleted_batch;
      if (c.deleted && batch) revivedCodes.set(id, batch);
    }
  }
  // The copy's deletes of codes and documents that lose here.
  const kept = async (kind: 'code' | 'document'): Promise<Map<string, string>> => {
    const out = new Map<string, string>();
    const won = new Set((wins.get(kind) ?? []).map((r) => r.record.id));
    const lost = new Map<string, string>();
    for (const r of byKind.get(kind) ?? []) {
      const b = (r.record as Tombstone<typeof kind>).deleted_batch;
      if (r.record.deleted && b && !won.has(r.record.id)) lost.set(r.record.id, b);
    }
    if (lost.size) for (const [id, x] of await store.getMany(kind, lost.keys())) if (!x.deleted) out.set(id, lost.get(id)!);
    return out;
  };
  const keptCodes = await kept('code');
  const keptDocs = await kept('document');
  const theirDeletes = new Map<string, string>();
  for (const kind of ['code', 'document'] as const) {
    for (const r of wins.get(kind) ?? []) if (r.record.deleted) theirDeletes.set(`${kind}:${r.record.id}`, r.record.updated_at_hlc);
  }
  const copyCodings = new Set((byKind.get('coding') ?? []).map((r) => r.record.id));
  return { docs, codings, before, theirs, revivedCodes, keptCodes, keptDocs, deadHere, copyCodings, knownCodings, theirDeletes, seen: new Map(), written };
}

/** `MergeTouches` as text (meta `merge.pending`), so a merge cut short can be finished. */
export function touchesToJson(t: MergeTouches): string {
  return JSON.stringify({
    docs: [...t.docs], codings: [...t.codings], before: [...t.before], theirs: [...t.theirs], revivedCodes: [...t.revivedCodes], keptCodes: [...t.keptCodes], keptDocs: [...t.keptDocs],
    deadHere: [...t.deadHere], copyCodings: [...t.copyCodings], knownCodings: [...t.knownCodings], theirDeletes: [...t.theirDeletes],
    seen: [...t.seen], written: [...t.written],
  });
}

export function touchesFromJson(json: string): MergeTouches {
  const o = JSON.parse(json) as Record<string, unknown[]>;
  const arr = <T>(k: string) => (Array.isArray(o[k]) ? (o[k] as T[]) : []);
  return {
    docs: new Set(arr<string>('docs')), codings: new Set(arr<string>('codings')), before: new Map(arr<[string, string]>('before')),
    theirs: new Map(arr<[string, string]>('theirs')), revivedCodes: new Map(arr<[string, string]>('revivedCodes')),
    keptCodes: new Map(arr<[string, string]>('keptCodes')), keptDocs: new Map(arr<[string, string]>('keptDocs')),
    deadHere: new Map(arr<[string, string | null]>('deadHere')), copyCodings: new Set(arr<string>('copyCodings')),
    knownCodings: new Set(arr<string>('knownCodings')), theirDeletes: new Map(arr<[string, string]>('theirDeletes')),
    seen: new Map(arr<[string, string]>('seen')), written: new Set(arr<string>('written')),
  };
}

/** The meta key a merge holds while its records are written but not yet put in step. */
export const MERGE_PENDING = 'merge.pending';

export interface ReconcileResult {
  /** Codings moved back onto their words (made against another version of the text). */
  reanchored: number;
  /** Codings deleted: their words are gone from the merged text, or their document or code is deleted. */
  removedCodings: number;
  /** Documents or texts brought back, or deleted, so that a document and its text go together. */
  paired: number;
  /**
   * Codes and documents deleted on one side that came back because there is newer work in them
   * (codings made after the delete, or that the side which deleted never had).
   */
  revived: { kind: 'code' | 'document'; id: string; name: string }[];
  /** Records brought back from the trash (`kind:id`). */
  restored: Set<string>;
}

/**
 * Puts the merged records back in step (see the top of this file). Writes through the store
 * directly: these are consequences of the merge, not steps of their own. Running it again on the
 * same `touched` changes nothing more (a merge cut short is finished this way).
 */
export async function reconcile(store: Store, touched: MergeTouches): Promise<ReconcileResult> {
  const result: ReconcileResult = { reanchored: 0, removedCodings: 0, paired: 0, revived: [], restored: new Set() };
  const batch = uuid();
  /** Codings brought back from the trash: placed like the merge's own, never counted as new work. */
  const back = new Set<string>();
  const restore = async (kind: Kind, ids: string[]) => {
    if (!ids.length) return;
    const { restored } = await store.write({ restores: [{ kind, ids }] });
    for (const r of restored.get(kind) ?? []) {
      result.restored.add(`${kind}:${r.id}`);
      if (kind === 'coding') back.add(r.id);
    }
  };
  // What one delete took with a document: its codings and the memos on it or on them.
  const restoreDocBatch = async (id: string, b: string | null | undefined) => {
    if (!b) return;
    const codings = (await recordsInBatch(store, 'coding', b)).filter((c) => c.document_id === id);
    await restore('coding', codings.map((c) => c.id));
    const memoTargets = new Set([id, ...codings.map((c) => c.id)]);
    const memos = (await recordsInBatch(store, 'memo', b)).filter((m) => m.target.id !== null && memoTargets.has(m.target.id));
    await restore('memo', memos.map((m) => m.id));
  };

  // 0. A text kept here over the copy's in a conflict records the copy's revision as seen.
  if (touched.seen.size) {
    const texts = await store.getMany('doctext', touched.seen.keys());
    const puts: { kind: Kind; draft: Draft<Kind> }[] = [];
    for (const [id, rev] of touched.seen) {
      const t = texts.get(id);
      if (!t || t.deleted || knows(t, rev)) continue;
      puts.push({ kind: 'doctext', draft: { ...draftOf(t), revs: capRevs([...revsOf(t), seenRev(rev)]) } as Draft<Kind> });
    }
    if (puts.length) await store.putMany(puts);
  }

  // 1. A document and its text go together. The newer of the live one and the delete decides.
  //    A document deleted here and brought back by the merge brings back what its delete took.
  const docs = await store.getMany('document', touched.docs);
  const texts = await store.getMany('doctext', touched.docs);
  for (const id of touched.docs) {
    const d = docs.get(id) as Tombstone<'document'> | undefined;
    const t = texts.get(id) as Tombstone<'doctext'> | undefined;
    if (!d || !t) continue;
    if (d.deleted === t.deleted) {
      if (!d.deleted && touched.deadHere.has(id)) await restoreDocBatch(id, touched.deadHere.get(id));
      continue;
    }
    const [live, dead, deadKind, liveKind] = d.deleted ? [t, d, 'document', 'doctext'] as const : [d, t, 'doctext', 'document'] as const;
    const revive = compareVersions(live as Versioned, dead as Versioned) > 0 && !dead.scrubbed;
    if (revive) {
      await restore(deadKind, [id]);
      await restoreDocBatch(id, touched.deadHere.get(id) ?? dead.deleted_batch);
    } else {
      await store.remove(liveKind, [id], { batch: dead.deleted_batch ?? batch });
    }
    result.paired++;
  }

  // 1b. A document the copy deleted that stays live here (changed here since) brings back what
  //     the copy's delete took from it, as the copy will when it takes the document from here.
  for (const [id, b] of touched.keptDocs) {
    const d = await store.get('document', id);
    if (d && !d.deleted) await restoreDocBatch(id, b);
  }

  // 2. A code brought back live brings back what its delete took (codings, and the memos on the
  //    code and on them). So does a code the copy deleted that stays live here (`keptCodes`):
  //    both sides then end with the same records back.
  for (const [codeId, b] of [...touched.revivedCodes, ...touched.keptCodes]) {
    const code = await store.get('code', codeId);
    if (!code || code.deleted) continue;
    const codings = (await recordsInBatch(store, 'coding', b)).filter((c) => c.code_id === codeId);
    await restore('coding', codings.map((c) => c.id));
    const targets = new Set([codeId, ...codings.map((c) => c.id)]);
    const memos = (await recordsInBatch(store, 'memo', b)).filter((m) => m.target.id !== null && targets.has(m.target.id));
    await restore('memo', memos.map((m) => m.id));
  }

  // 2b. Newer work wins over a delete: a code (or a document the copy deleted) that live codings
  //     still use, made after the delete or never seen by the side that deleted, comes back.
  await reviveForWork(store, touched, result, back, restore, restoreDocBatch);

  // 3. Codings back onto their words, wherever the text or the coding came from the other side
  //    (or from the trash: deleted before the text changed).
  const checkDocs = new Set(touched.docs);
  const extra = new Set([...touched.codings, ...back]);
  const writtenCodings = extra.size ? await store.getMany('coding', extra) : new Map<string, Coding>();
  for (const c of writtenCodings.values()) if (!c.deleted) checkDocs.add(c.document_id);
  const writes: { kind: Kind; draft: Draft<Kind>; derived?: boolean }[] = [];
  const doomed: string[] = [];
  const liveTexts = await store.getMany('doctext', checkDocs);
  for (const id of checkDocs) {
    const t = liveTexts.get(id);
    if (!t || t.deleted) continue;
    const textChanged = touched.before.get(id) !== t.text;
    const all = await store.list('coding', { where: 'document_id = ?', params: [id] });
    const check = textChanged ? all : all.filter((c) => extra.has(c.id));
    const versions = [touched.before.get(id), touched.theirs.get(id)].filter((v): v is string => v !== undefined);
    const { moved, lost } = anchorAll(check, t.text, versions);
    for (const m of moved) writes.push({ kind: 'coding', draft: { ...draftOf(m.coding), start: m.start, end: m.end, text: m.text } as Draft<Kind>, derived: true });
    for (const c of lost) doomed.push(c.id);
    result.reanchored += moved.length;
  }

  // 4. `chars` follows the text.
  const docsNow = await store.getMany('document', checkDocs);
  for (const id of checkDocs) {
    const d = docsNow.get(id);
    const t = liveTexts.get(id);
    if (d && !d.deleted && t && !t.deleted && d.chars !== t.text.length) {
      writes.push({ kind: 'document', draft: { ...draftOf(d), chars: t.text.length } as Draft<Kind>, derived: true });
    }
  }
  if (writes.length) await store.write({ puts: writes });

  // 5. Codings whose document or code is deleted (a teammate coded in something deleted here).
  const orphans = await store.db.query<{ id: string }>(
    `SELECT id FROM ${TABLES.coding.table} WHERE deleted = 0 AND (document_id NOT IN (SELECT id FROM ${TABLES.document.table} WHERE deleted = 0) OR code_id NOT IN (SELECT id FROM ${TABLES.code.table} WHERE deleted = 0))`,
  );
  const gone = [...new Set([...doomed, ...orphans.map((o) => o.id)])];
  if (gone.length) {
    const memos = await store.list('memo', { where: `target_kind = 'coding' AND target_id IN (SELECT value FROM json_each(?))`, params: [JSON.stringify(gone)] });
    const removes = [{ kind: 'coding' as Kind, ids: gone, batch }];
    if (memos.length) removes.push({ kind: 'memo', ids: memos.map((m) => m.id), batch });
    result.removedCodings = (await store.write({ removes })).removed - memos.length;
  }

  // 6. What the copy brought in about something deleted here (or deleted in the copy while it
  //    was being worked on here): a coding of a code that became a category, a memo about a
  //    deleted record. See `settleReferences`.
  await settleReferences(store, batch);
  return result;
}

/** What `settleReferences` changed. */
export interface Settled {
  /** Codes that are codable again, or moved to the top to break a cycle. */
  codes: number;
  /** Codings sent back to the trash (their document or code is deleted). */
  codings: number;
  /** Memos sent to the trash (what they are about is deleted). */
  memos: number;
}

/**
 * Puts right references that a merge or a restore can leave pointing to something that no longer
 * takes them, as the operations that would have refused them locally would:
 * - a code that became a category (on one side) while codings of it were made (on the other) is
 *   codable again: a category cannot hold codings, and the newer work is kept;
 * - a coding whose document or code is deleted (brought back from the trash without it, say)
 *   goes to the trash with that delete (its batch), so it comes back when they do;
 * - likewise a memo about a deleted record;
 * - codes moved under each other on both sides (a cycle): the first of the cycle in sibling
 *   order moves to the top, where the codebook already shows it (core/qda/tree.ts).
 * Writes through the store directly (a consequence of the merge or restore, not a step of its
 * own).
 */
export async function settleReferences(store: Store, batch: string = uuid()): Promise<Settled> {
  const out: Settled = { codes: 0, codings: 0, memos: 0 };
  const liveCodes = await store.list('code');
  const parents = new Map(liveCodes.map((c) => [c.id, c.parent_id]));
  const byId = new Map(liveCodes.map((c) => [c.id, c]));
  const roots: Code[] = [];
  const settled = new Set<string>();
  for (const c of liveCodes) {
    const trail: string[] = [];
    for (let at: string | null = c.id; at !== null && byId.has(at) && !settled.has(at); at = parents.get(at) ?? null) {
      const i = trail.indexOf(at);
      if (i >= 0) {
        const cycle = trail.slice(i).map((id) => byId.get(id)!).sort(compareSiblings);
        roots.push(cycle[0]!);
        parents.set(cycle[0]!.id, null);
        break;
      }
      trail.push(at);
    }
    for (const id of trail) settled.add(id);
  }
  if (roots.length) out.codes += (await store.putMany(roots.map((c) => ({ kind: 'code' as Kind, draft: { ...draftOf(c), parent_id: null } as Draft<Kind> })))).length;
  const categories = (await store.list('code')).filter((c) => !c.codable);
  if (categories.length) {
    const used = await store.db.query<{ code_id: string }>(
      `SELECT DISTINCT code_id FROM ${TABLES.coding.table} WHERE deleted = 0 AND code_id IN (SELECT value FROM json_each(?))`,
      [JSON.stringify(categories.map((c) => c.id))],
    );
    const ids = new Set(used.map((u) => u.code_id));
    const puts = categories.filter((c) => ids.has(c.id)).map((c) => ({ kind: 'code' as Kind, draft: { ...draftOf(c), codable: true } as Draft<Kind> }));
    if (puts.length) out.codes += (await store.putMany(puts)).length;
  }
  /** Removes, grouped by the batch each record joins. */
  const trash = async (kind: Kind, items: { id: string; batch: string }[]) => {
    const groups = new Map<string, string[]>();
    for (const i of items) (groups.get(i.batch) ?? groups.set(i.batch, []).get(i.batch)!).push(i.id);
    if (!groups.size) return 0;
    return (await store.write({ removes: [...groups].map(([b, ids]) => ({ kind, ids, batch: b })) })).removed;
  };
  const orphans = await store.db.query<{ id: string; document_id: string; code_id: string }>(
    `SELECT id, document_id, code_id FROM ${TABLES.coding.table} WHERE deleted = 0 AND (document_id NOT IN (SELECT id FROM ${TABLES.document.table} WHERE deleted = 0) OR code_id NOT IN (SELECT id FROM ${TABLES.code.table} WHERE deleted = 0))`,
  );
  if (orphans.length) {
    const docs = await store.getMany('document', orphans.map((o) => o.document_id));
    const codes = await store.getMany('code', orphans.map((o) => o.code_id));
    out.codings = await trash('coding', orphans.map((o) => {
      const d = docs.get(o.document_id) as Tombstone<'document'> | undefined;
      const c = codes.get(o.code_id) as Tombstone<'code'> | undefined;
      const b = (d?.deleted ? d.deleted_batch : undefined) ?? (c?.deleted ? c.deleted_batch : undefined) ?? batch;
      return { id: o.id, batch: b };
    }));
  }
  const memos = (await store.list('memo')).filter((m) => m.target.kind !== 'project');
  if (memos.length) {
    const byKind = new Map<Kind, Set<string>>();
    for (const m of memos) {
      const kind = m.target.kind as Kind;
      (byKind.get(kind) ?? byKind.set(kind, new Set()).get(kind)!).add(m.target.id!);
    }
    const targets = new Map<string, Tombstone<Kind> | undefined>();
    for (const [kind, ids] of byKind) {
      const found = await store.getMany(kind, ids);
      for (const id of ids) targets.set(`${kind}:${id}`, found.get(id) as Tombstone<Kind> | undefined);
    }
    const doomed: { id: string; batch: string }[] = [];
    for (const m of memos) {
      const t = targets.get(`${m.target.kind}:${m.target.id}`);
      if (!t || t.deleted) doomed.push({ id: m.id, batch: t?.deleted_batch ?? batch });
    }
    out.memos = await trash('memo', doomed);
  }
  return out;
}

/** Step 2b of `reconcile`. */
async function reviveForWork(
  store: Store,
  touched: MergeTouches,
  result: ReconcileResult,
  back: ReadonlySet<string>,
  restore: (kind: Kind, ids: string[]) => Promise<void>,
  restoreDocBatch: (id: string, b: string | null | undefined) => Promise<void>,
): Promise<void> {
  // A coding counts as newer work by its last meaningful change (moved along with a text edit
  // is not work on it).
  const rows = await store.db.query<{ id: string; code_id: string; document_id: string; hlc: string }>(
    `SELECT id, code_id, document_id, coalesce(json_extract(data, '$.sem'), hlc) AS hlc FROM ${TABLES.coding.table} WHERE deleted = 0 AND (document_id IN (SELECT id FROM ${TABLES.document.table} WHERE deleted = 1) OR code_id IN (SELECT id FROM ${TABLES.code.table} WHERE deleted = 1))`,
  );
  if (!rows.length) return;
  const codeIds = [...new Set(rows.map((r) => r.code_id))];
  const docIds = [...new Set(rows.map((r) => r.document_id))];
  const codes = await store.getMany('code', codeIds);
  const docs = await store.getMany('document', docIds);
  // Work the side that deleted never had: made here and not in the copy (the copy deleted), or
  // brought by the copy and not here before (deleted here).
  const unseen = (kind: 'code' | 'document', id: string, codingId: string) =>
    touched.theirDeletes.has(`${kind}:${id}`) ? !touched.copyCodings.has(codingId) : touched.copyCodings.has(codingId) && !touched.knownCodings.has(codingId);
  const counts = (kind: 'code' | 'document', tomb: Tombstone<'code'> | Tombstone<'document'>, r: (typeof rows)[number]) =>
    !back.has(r.id) && (compareHlc(r.hlc, semOf(tomb as Versioned)) > 0 || unseen(kind, tomb.id, r.id));
  const reviveCodes = new Set<string>();
  const reviveDocs = new Set<string>();
  for (const r of rows) {
    const c = codes.get(r.code_id) as Tombstone<'code'> | undefined;
    if (c?.deleted && !c.scrubbed && counts('code', c, r)) reviveCodes.add(c.id);
    const d = docs.get(r.document_id) as Tombstone<'document'> | undefined;
    // A document deleted HERE stays deleted (a participant may have withdrawn): only the copy's
    // delete gives way to work made here.
    if (d?.deleted && !d.scrubbed && touched.theirDeletes.has(`document:${d.id}`) && counts('document', d, r)) reviveDocs.add(d.id);
  }
  for (const id of reviveCodes) {
    // Its deleted parents too, so it does not hang under a deleted code.
    const chain: Tombstone<'code'>[] = [];
    let at: Tombstone<'code'> | null = codes.get(id) as Tombstone<'code'>;
    for (let i = 0; at && at.deleted && !at.scrubbed && i < 1000; i++) {
      chain.push(at);
      at = at.parent_id ? ((await store.get('code', at.parent_id)) as Tombstone<'code'> | null) : null;
    }
    await restore('code', chain.map((c) => c.id));
    const b = (codes.get(id) as Tombstone<'code'>).deleted_batch;
    if (b) {
      const codings = (await recordsInBatch(store, 'coding', b)).filter((c) => c.code_id === id);
      await restore('coding', codings.map((c) => c.id));
      const targets = new Set([id, ...codings.map((c) => c.id)]);
      const memos = (await recordsInBatch(store, 'memo', b)).filter((m) => m.target.id !== null && targets.has(m.target.id));
      await restore('memo', memos.map((m) => m.id));
    }
    result.revived.push({ kind: 'code', id, name: codes.get(id)!.name });
  }
  for (const id of reviveDocs) {
    const d = docs.get(id) as Tombstone<'document'>;
    const t = (await store.get('doctext', id)) as Tombstone<'doctext'> | null;
    if (!t || t.scrubbed) continue;
    await restore('document', [id]);
    await restore('doctext', [id]);
    await restoreDocBatch(id, d.deleted_batch);
    result.revived.push({ kind: 'document', id, name: d.name });
  }
}

/**
 * Checks an imported project's derived data against its texts (a file merged by an older Trama,
 * or edited elsewhere, can disagree): `chars` is set from the text, and a coding that does not
 * sit on its words is moved to them (nearest its old place), or, past the end of the text with
 * its words nowhere, removed; one inside the text whose words are nowhere keeps its place and
 * shows the text it covers. Returns how many records were put right.
 */
export async function repairImported(store: Store): Promise<{ documents: number; codings: number; removed: number }> {
  const texts = await store.list('doctext');
  const len = new Map(texts.map((t) => [t.id, t.text.length]));
  const writes: { kind: Kind; draft: Draft<Kind>; derived: boolean }[] = [];
  let documents = 0;
  for (const d of (await store.list('document')) as Document[]) {
    const n = len.get(d.id);
    if (n !== undefined && n !== d.chars) {
      writes.push({ kind: 'document', draft: { ...draftOf(d), chars: n } as Draft<Kind>, derived: true });
      documents++;
    }
  }
  let codings = 0;
  const doomed: string[] = [];
  for (const t of texts) {
    const all = await store.list('coding', { where: 'document_id = ?', params: [t.id] });
    const { moved, lost } = anchorAll(all, t.text, []);
    for (const m of moved) writes.push({ kind: 'coding', draft: { ...draftOf(m.coding), start: m.start, end: m.end, text: m.text } as Draft<Kind>, derived: true });
    codings += moved.length;
    for (const c of lost) {
      if (c.end <= t.text.length) {
        writes.push({ kind: 'coding', draft: { ...draftOf(c), text: t.text.slice(c.start, c.end) } as Draft<Kind>, derived: true });
        codings++;
      } else doomed.push(c.id);
    }
  }
  if (writes.length) await store.write({ puts: writes });
  const removed = doomed.length ? await store.remove('coding', doomed, { batch: uuid() }) : 0;
  return { documents, codings, removed };
}

/**
 * A cheap check of what an interrupted write (by an older Trama, which wrote one operation in
 * several transactions) can leave, put right when found: a live document without its text, a
 * live text whose document is deleted, live codings of a deleted document or code, codings past
 * the end of their text (then every coding is checked against its text, `repairImported`).
 */
export async function checkIntegrity(store: Store): Promise<{ texts: number; codings: number }> {
  const D = TABLES.document.table;
  const T = TABLES.doctext.table;
  const C = TABLES.coding.table;
  const K = TABLES.code.table;
  let texts = 0;
  // A live document whose text was deleted with it (the document's delete did not get written):
  // the text comes back with what the same delete took.
  const noText = await store.db.query<{ id: string }>(
    `SELECT d.id AS id FROM ${D} d LEFT JOIN ${T} t ON t.id = d.id WHERE d.deleted = 0 AND (t.id IS NULL OR t.deleted = 1)`,
  );
  for (const { id } of noText) {
    const t = (await store.get('doctext', id)) as Tombstone<'doctext'> | null;
    if (t && !t.scrubbed) {
      await store.restore('doctext', [id]);
      if (t.deleted_batch) {
        const codings = (await recordsInBatch(store, 'coding', t.deleted_batch)).filter((c) => c.document_id === id);
        const memos = (await recordsInBatch(store, 'memo', t.deleted_batch)).filter((m) => m.target.id === id || codings.some((c) => c.id === m.target.id));
        await store.write({ restores: [{ kind: 'coding', ids: codings.map((c) => c.id) }, { kind: 'memo', ids: memos.map((m) => m.id) }] });
      }
    } else {
      const d = await store.get('document', id);
      await store.remove('document', [id], { batch: uuid() });
      console.error('a document without its text was deleted', d?.id);
    }
    texts++;
  }
  // A live text whose document is deleted: it goes in the document's delete.
  const orphanTexts = await store.db.query<{ id: string }>(`SELECT t.id AS id FROM ${T} t JOIN ${D} d ON d.id = t.id WHERE t.deleted = 0 AND d.deleted = 1`);
  for (const { id } of orphanTexts) {
    const d = (await store.get('document', id)) as Tombstone<'document'> | null;
    await store.remove('doctext', [id], { batch: d?.deleted_batch ?? uuid() });
    texts++;
  }
  const orphans = await store.db.query<{ id: string }>(
    `SELECT id FROM ${C} WHERE deleted = 0 AND (document_id NOT IN (SELECT id FROM ${D} WHERE deleted = 0) OR code_id NOT IN (SELECT id FROM ${K} WHERE deleted = 0))`,
  );
  let codings = orphans.length ? await store.remove('coding', orphans.map((o) => o.id), { batch: uuid() }) : 0;
  // `chars` is the text's length (UTF-16, as offsets are): a coding past it was not remapped.
  const past = await store.db.query<{ n: number }>(
    `SELECT count(*) AS n FROM ${C} c JOIN ${D} d ON d.id = c.document_id WHERE c.deleted = 0 AND d.deleted = 0 AND c.end_pos > json_extract(d.data, '$.chars')`,
  );
  if (Number(past[0]?.n ?? 0) > 0 || texts > 0) {
    const fixed = await repairImported(store);
    codings += fixed.codings + fixed.removed;
  }
  return { texts, codings };
}

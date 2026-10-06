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
import type { Coding, DocText, Document, Draft, Kind } from '../core/model/types';
import { TABLES } from '../core/store/schema';
import type { Store, Tombstone } from '../core/store/store';
import { anchorAll } from './anchor';
import { textRev } from './documents';
import { draftOf, recordsInBatch } from './undo';

/** A document whose text was changed both here and in the copy since they last matched. */
export interface TextConflict {
  documentId: string;
  name: string;
}

const revsOf = (t: Pick<DocText, 'text' | 'revs'>): string[] => (t.revs?.length ? t.revs : [textRev(t.text)]);

/**
 * Texts edited on both sides: the copy's text and the one here differ and neither lists the
 * other among its earlier versions. Whichever is newer, this project's text is kept (a newer
 * typo fix must not undo pseudonymisation done here, say) and the document is reported, so the
 * researcher can bring the teammate's changes over by hand. `drop` holds the ids of the copy's
 * texts that would otherwise have won and must be left out of the merge.
 */
export async function textConflicts(store: Store, records: readonly BundleRecord[]): Promise<{ conflicts: TextConflict[]; drop: Set<string> }> {
  const incoming = records.filter((r): r is BundleRecord & { kind: 'doctext'; record: DocText } => r.kind === 'doctext' && !r.record.deleted);
  const conflicts: TextConflict[] = [];
  const drop = new Set<string>();
  if (!incoming.length) return { conflicts, drop };
  const here = await store.getMany('doctext', incoming.map((r) => r.record.id));
  const names = new Map<string, string>();
  for (const r of records) if (r.kind === 'document') names.set(r.record.id, r.record.name);
  const docsHere = await store.getMany('document', incoming.map((r) => r.record.id));
  for (const { record: theirs } of incoming) {
    const mine = here.get(theirs.id);
    if (!mine || mine.deleted || mine.text === theirs.text) continue;
    const theirsWins = compareHlc(mine.updated_at_hlc, theirs.updated_at_hlc) < 0;
    const descends = theirsWins ? revsOf(theirs).includes(textRev(mine.text)) : revsOf(mine).includes(textRev(theirs.text));
    if (descends) continue;
    if (theirsWins) drop.add(theirs.id);
    const name = docsHere.get(theirs.id)?.name || names.get(theirs.id) || theirs.id;
    conflicts.push({ documentId: theirs.id, name });
  }
  return { conflicts, drop };
}

/** What a merge is about to write, worked out before it does (see `Store.merge`'s rule). */
export interface MergeTouches {
  /** Documents whose document or doctext record the merge writes. */
  docs: Set<string>;
  /** Codings the merge writes. */
  codings: Set<string>;
  /** Live texts here before the merge, of the documents the merge touches. */
  before: Map<string, string>;
  /** Live texts the copy carries. */
  theirs: Map<string, string>;
  /** Codes deleted here that the merge brings back live, with their delete batch. */
  revivedCodes: Map<string, string>;
}

export async function mergeTouches(store: Store, records: readonly BundleRecord[]): Promise<MergeTouches> {
  const byKind = new Map<Kind, BundleRecord[]>();
  for (const r of records) (byKind.get(r.kind) ?? byKind.set(r.kind, []).get(r.kind)!).push(r);
  const wins = new Map<Kind, BundleRecord[]>();
  for (const [kind, list] of byKind) {
    const stamps = await store.stamps(kind, list.map((r) => r.record.id));
    wins.set(kind, list.filter((r) => {
      const h = stamps.get(r.record.id)?.hlc;
      return h === undefined || compareHlc(h, r.record.updated_at_hlc) < 0;
    }));
  }
  const docs = new Set<string>();
  for (const r of [...(wins.get('document') ?? []), ...(wins.get('doctext') ?? [])]) docs.add(r.record.id);
  const codingWins = (wins.get('coding') ?? []) as { record: Coding }[];
  const codings = new Set(codingWins.map((r) => r.record.id));
  const theirs = new Map<string, string>();
  for (const r of byKind.get('doctext') ?? []) if (!r.record.deleted) theirs.set(r.record.id, (r.record as DocText).text);
  const textIds = new Set([...docs, ...codingWins.map((r) => r.record.document_id)]);
  const before = new Map<string, string>();
  for (const [id, t] of await store.getMany('doctext', textIds)) if (!t.deleted) before.set(id, t.text);
  const revivedCodes = new Map<string, string>();
  const liveCodes = (wins.get('code') ?? []).filter((r) => !r.record.deleted);
  if (liveCodes.length) {
    for (const [id, c] of await store.getMany('code', liveCodes.map((r) => r.record.id))) {
      const batch = (c as Tombstone<'code'>).deleted_batch;
      if (c.deleted && batch) revivedCodes.set(id, batch);
    }
  }
  return { docs, codings, before, theirs, revivedCodes };
}

export interface ReconcileResult {
  /** Codings moved back onto their words (made against another version of the text). */
  reanchored: number;
  /** Codings deleted: their words are gone from the merged text, or their document or code is deleted. */
  removedCodings: number;
  /** Documents or texts brought back, or deleted, so that a document and its text go together. */
  paired: number;
}

/**
 * Puts the merged records back in step (see the top of this file). Writes through the store
 * directly: these are consequences of the merge, not steps of their own.
 */
export async function reconcile(store: Store, touched: MergeTouches): Promise<ReconcileResult> {
  const result: ReconcileResult = { reanchored: 0, removedCodings: 0, paired: 0 };
  const batch = uuid();

  // 1. A document and its text go together. The newer of the live one and the delete decides.
  const docs = await store.getMany('document', touched.docs);
  const texts = await store.getMany('doctext', touched.docs);
  for (const id of touched.docs) {
    const d = docs.get(id) as Tombstone<'document'> | undefined;
    const t = texts.get(id) as Tombstone<'doctext'> | undefined;
    if (!d || !t || d.deleted === t.deleted) continue;
    const [live, dead, deadKind, liveKind] = d.deleted ? [t, d, 'document', 'doctext'] as const : [d, t, 'doctext', 'document'] as const;
    const revive = compareHlc(live.updated_at_hlc, dead.updated_at_hlc) > 0 && !dead.scrubbed;
    if (revive) {
      await store.restore(deadKind, [id]);
      // What the same delete took with it: the document's codings and the memos on them.
      if (dead.deleted_batch) {
        const codings = (await recordsInBatch(store, 'coding', dead.deleted_batch)).filter((c) => c.document_id === id);
        await store.restore('coding', codings.map((c) => c.id));
        const memoTargets = new Set([id, ...codings.map((c) => c.id)]);
        const memos = (await recordsInBatch(store, 'memo', dead.deleted_batch)).filter((m) => m.target.id !== null && memoTargets.has(m.target.id));
        await store.restore('memo', memos.map((m) => m.id));
      }
    } else {
      await store.remove(liveKind, [id], { batch: dead.deleted_batch ?? batch });
    }
    result.paired++;
  }

  // 2. A code brought back live brings back the codings its delete took.
  for (const [codeId, b] of touched.revivedCodes) {
    const code = await store.get('code', codeId);
    if (!code || code.deleted) continue;
    const codings = (await recordsInBatch(store, 'coding', b)).filter((c) => c.code_id === codeId);
    await store.restore('coding', codings.map((c) => c.id));
  }

  // 3. Codings back onto their words, wherever the text or the coding came from the other side.
  const checkDocs = new Set(touched.docs);
  const writtenCodings = touched.codings.size ? await store.getMany('coding', touched.codings) : new Map<string, Coding>();
  for (const c of writtenCodings.values()) if (!c.deleted) checkDocs.add(c.document_id);
  const writes: { kind: Kind; draft: Draft<Kind> }[] = [];
  const doomed: string[] = [];
  const liveTexts = await store.getMany('doctext', checkDocs);
  for (const id of checkDocs) {
    const t = liveTexts.get(id);
    if (!t || t.deleted) continue;
    const textChanged = touched.before.get(id) !== t.text;
    const all = await store.list('coding', { where: 'document_id = ?', params: [id] });
    const check = textChanged ? all : all.filter((c) => touched.codings.has(c.id));
    const versions = [touched.before.get(id), touched.theirs.get(id)].filter((v): v is string => v !== undefined);
    const { moved, lost } = anchorAll(check, t.text, versions);
    for (const m of moved) writes.push({ kind: 'coding', draft: { ...draftOf(m.coding), start: m.start, end: m.end, text: m.text } as Draft<Kind> });
    for (const c of lost) doomed.push(c.id);
    result.reanchored += moved.length;
  }

  // 4. `chars` follows the text.
  const docsNow = await store.getMany('document', checkDocs);
  for (const id of checkDocs) {
    const d = docsNow.get(id);
    const t = liveTexts.get(id);
    if (d && !d.deleted && t && !t.deleted && d.chars !== t.text.length) {
      writes.push({ kind: 'document', draft: { ...draftOf(d), chars: t.text.length } as Draft<Kind> });
    }
  }
  if (writes.length) await store.putMany(writes);

  // 5. Codings whose document or code is deleted (a teammate coded in something deleted here).
  const orphans = await store.db.query<{ id: string }>(
    `SELECT id FROM ${TABLES.coding.table} WHERE deleted = 0 AND (document_id NOT IN (SELECT id FROM ${TABLES.document.table} WHERE deleted = 0) OR code_id NOT IN (SELECT id FROM ${TABLES.code.table} WHERE deleted = 0))`,
  );
  const gone = [...new Set([...doomed, ...orphans.map((o) => o.id)])];
  if (gone.length) {
    const memos = await store.list('memo', { where: `target_kind = 'coding' AND target_id IN (SELECT value FROM json_each(?))`, params: [JSON.stringify(gone)] });
    result.removedCodings = await store.remove('coding', gone, { batch });
    if (memos.length) await store.remove('memo', memos.map((m) => m.id), { batch });
  }
  return result;
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
  const writes: { kind: Kind; draft: Draft<Kind> }[] = [];
  let documents = 0;
  for (const d of (await store.list('document')) as Document[]) {
    const n = len.get(d.id);
    if (n !== undefined && n !== d.chars) {
      writes.push({ kind: 'document', draft: { ...draftOf(d), chars: n } as Draft<Kind> });
      documents++;
    }
  }
  let codings = 0;
  const doomed: string[] = [];
  for (const t of texts) {
    const all = await store.list('coding', { where: 'document_id = ?', params: [t.id] });
    const { moved, lost } = anchorAll(all, t.text, []);
    for (const m of moved) writes.push({ kind: 'coding', draft: { ...draftOf(m.coding), start: m.start, end: m.end, text: m.text } as Draft<Kind> });
    codings += moved.length;
    for (const c of lost) {
      if (c.end <= t.text.length) {
        writes.push({ kind: 'coding', draft: { ...draftOf(c), text: t.text.slice(c.start, c.end) } as Draft<Kind> });
        codings++;
      } else doomed.push(c.id);
    }
  }
  if (writes.length) await store.putMany(writes);
  const removed = doomed.length ? await store.remove('coding', doomed, { batch: uuid() }) : 0;
  return { documents, codings, removed };
}

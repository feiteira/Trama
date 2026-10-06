// Undo and redo for the open project, and the plumbing every domain service writes through.
//
// How it fits together:
// - A domain operation (applyCode, mergeCodes, deleteDocuments…) builds a `Plan` of record
//   writes and deletes, then `commit`s it. `commit` writes the plan and its audit-log entries in
//   ONE transaction (the deletes as tombstones under one batch id), so a lock or a crash never
//   leaves half an operation, and returns an `Undoable` holding the records as they were before
//   and after.
// - The operation returns that Undoable next to its result, e.g.
//     const { coding, undo } = await applyCode(ctx, {...});
//     undoManager.record(undo);
//   Screens record it on the project's UndoManager; Ctrl+Z calls `manager.undo()`.
// - `label` is a stable id (a LogAction, or 'group.edit' / 'pseudonym.edit' / 'document.order'
//   / 'document.media'), for the UI to translate ("Undo apply code"); `detail` is the
//   language-neutral summary (names, counts) also written to the log.
// - Undo writes the "before" records back (records the operation created become tombstones);
//   redo writes the "after" records. Both are logged, prefixed ↶ / ↷, so the audit trail shows
//   them. The stack assumes it is used in order (undo the newest first), like any editor.
// - Before writing, undo and redo check that every record they would write back still carries
//   the stamp THIS step's last write gave it (the operation, or its previous undo/redo). A record
//   written since by anything else — a later step, a recording attached, a teammate's copy
//   merged, an erased key entry — makes the step refuse (ServiceError 'changed_since') instead of
//   silently overwriting the newer change. Each undo and redo is one transaction too: a step
//   made of several (`combineUndo`) is checked whole first and written whole, or not at all.

import { uuid } from '../core/ids';
import type { Base, Draft, Entity, Kind, LogAction } from '../core/model/types';
import { appendRev } from './revs';
import { ErasedRecordError, type Store } from '../core/store/store';
import { TABLES } from '../core/store/schema';
import type { ProjectContext } from './context';

// ---------------------------------------------------------------------------------------------
// Errors

export type ServiceErrorCode =
  | 'not_found'
  | 'not_codable'
  | 'empty_span'
  | 'cycle'
  | 'invalid_value'
  | 'invalid_argument'
  | 'too_large'
  | 'duplicate'
  /** Undo/redo refused: a record it would write back was changed since the operation. */
  | 'changed_since';

/** A refused domain operation. `code` is stable, for the UI to explain in the reader's language. */
export class ServiceError extends Error {
  constructor(
    readonly code: ServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

// ---------------------------------------------------------------------------------------------
// Undoable operations

export type UndoLabel = LogAction | 'group.edit' | 'pseudonym.edit' | 'document.order' | 'document.media';

export interface Undoable {
  label: UndoLabel;
  /** Language-neutral detail (names, counts). */
  detail: string;
  /** Rough memory held (characters), so the stack can drop old entries holding whole texts. */
  weight: number;
  undo(): Promise<void>;
  redo(): Promise<void>;
  /** The records (`kind:id`) this step writes back, so the stack can forget steps about them. */
  touches?: readonly string[];
  /**
   * Records (`kind:id`) whose content was erased for good: recording this entry drops every
   * step of the stack that touches them (they hold the erased content in memory), and the entry
   * itself is not kept.
   */
  forget?: readonly string[];
}

/** The key the undo stack uses for a record. */
export const undoKey = (kind: Kind, id: string): string => `${kind}:${id}`;

/** Undo refusals that can never succeed later: the step is dropped from the stack. */
function isRefusal(e: unknown): boolean {
  return (e instanceof ServiceError && e.code === 'changed_since') || e instanceof ErasedRecordError;
}

/**
 * One Undoable made of several. Steps written by `commit` are joined into one: checked whole,
 * then written in one transaction, so a refusal leaves nothing half undone. Any other part runs
 * in turn (newest first on undo); when one fails, the parts already run are put back.
 */
export function combineUndo(label: UndoLabel, detail: string, parts: Undoable[]): Undoable {
  const live = parts.filter((p) => !(p.weight === 0 && !stepOf(p)));
  const steps = live.map(stepOf);
  if (live.length && steps.every((st): st is Step => !!st)) {
    return withStep({ label, detail, weight: parts.reduce((n, p) => n + p.weight, 0) }, Step.join(steps, 'all'));
  }
  return {
    label,
    detail,
    weight: parts.reduce((n, p) => n + p.weight, 0),
    touches: parts.flatMap((p) => p.touches ?? []),
    async undo() {
      await runAll([...parts].reverse(), 'undo');
    },
    async redo() {
      await runAll(parts, 'redo');
    },
  };
}

async function runAll(parts: Undoable[], dir: 'undo' | 'redo'): Promise<void> {
  const done: Undoable[] = [];
  for (const p of parts) {
    try {
      await (dir === 'undo' ? p.undo() : p.redo());
    } catch (e) {
      // Put back what was already done, newest first, so the step is never left half applied.
      for (const d of done.reverse()) await (dir === 'undo' ? d.redo() : d.undo()).catch((err: unknown) => console.error('putting back part of a step failed', err));
      throw e;
    }
    done.push(p);
  }
}

/**
 * The span of several consecutive steps of one thing (the autosaves of one memo): undo writes
 * back the state before `first`, redo the state after `last`. Both must come from `commit`.
 */
export function spanUndo(first: Undoable, last: Undoable): Undoable {
  const a = stepOf(first);
  const b = stepOf(last);
  if (!a || !b) return { ...last, undo: () => first.undo(), redo: () => last.redo() };
  if (a === b) return first;
  return withStep({ label: last.label, detail: last.detail, weight: first.weight + last.weight }, Step.join([a, b], 'last'));
}

export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
  undo: { label: UndoLabel; detail: string } | null;
  redo: { label: UndoLabel; detail: string } | null;
}

/** The undo/redo stacks of one open project. Create one per project; clear it on close. */
export class UndoManager {
  private done: Undoable[] = [];
  private undone: Undoable[] = [];
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly max: number;
  private readonly maxWeight: number;

  constructor(opts: { max?: number; maxWeight?: number } = {}) {
    this.max = opts.max ?? 100;
    // Text edits keep both versions of a document: cap what the stack holds (~64 M chars).
    this.maxWeight = opts.maxWeight ?? 64_000_000;
  }

  record(entry: Undoable): void {
    if (entry.forget?.length) {
      this.forget(entry.forget);
      return;
    }
    this.done.push(entry);
    this.undone = [];
    this.trim();
    this.emit();
  }

  /** Undoes the newest operation. Resolves to it, or null when there was nothing to undo. */
  undo(): Promise<Undoable | null> {
    return this.run(this.done, this.undone, (e) => e.undo());
  }

  redo(): Promise<Undoable | null> {
    return this.run(this.undone, this.done, (e) => e.redo());
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  get labels(): UndoState {
    const top = (s: Undoable[]) => {
      const e = s[s.length - 1];
      return e ? { label: e.label, detail: e.detail } : null;
    };
    return { canUndo: this.canUndo, canRedo: this.canRedo, undo: top(this.done), redo: top(this.undone) };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.done = [];
    this.undone = [];
    this.emit();
  }

  /**
   * Drops every step that touches one of the records (`kind:id`), every step older than the
   * newest of them, and the redo stack: older steps hold the content from before (names a
   * pseudonymisation replaced, say) and could no longer be undone in order anyway.
   */
  forget(keys: readonly string[]): void {
    const doomed = new Set(keys);
    const hit = (e: Undoable) => (e.touches ?? []).some((k) => doomed.has(k));
    let last = -1;
    this.done.forEach((e, i) => {
      if (hit(e)) last = i;
    });
    this.done = this.done.slice(last + 1);
    this.undone = [];
    this.emit();
  }

  // Operations run one at a time: a second Ctrl+Z pressed while the first is writing waits.
  private run(from: Undoable[], to: Undoable[], act: (e: Undoable) => Promise<void>): Promise<Undoable | null> {
    const next = this.queue.then(async () => {
      const entry = from.pop();
      if (!entry) return null;
      try {
        await act(entry);
      } catch (e) {
        // A step writes all or nothing. One refused for good (something changed since) is
        // dropped; one that failed otherwise (a lock, a full disk) stays to be tried again.
        if (!isRefusal(e)) from.push(entry);
        this.emit();
        throw e;
      }
      to.push(entry);
      this.trim();
      this.emit();
      return entry;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  private trim(): void {
    while (this.done.length > this.max) this.done.shift();
    let weight = this.done.reduce((n, e) => n + e.weight, 0) + this.undone.reduce((n, e) => n + e.weight, 0);
    while (weight > this.maxWeight && this.done.length > 1) weight -= this.done.shift()!.weight;
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

// ---------------------------------------------------------------------------------------------
// Plans: what one operation writes

type AnyEntity = Entity<Kind>;
type TombstoneFields = { deleted_batch?: string; scrubbed?: boolean };

/** A record without its base and tombstone fields, ready to write back. */
export function draftOf<K extends Kind>(record: Entity<K>): Draft<K> {
  const { created_at: _c, updated_at_hlc: _h, deleted: _d, deleted_batch: _b, scrubbed: _s, ...rest } = record as Entity<K> &
    Base &
    TombstoneFields;
  return rest as unknown as Draft<K>;
}

interface PutItem {
  kind: Kind;
  draft: Draft<Kind>;
  /** The record as stored before (null: created by this plan). */
  before: AnyEntity | null;
  /** A deleted record changed in place: it stays deleted, in its delete batch. */
  tomb?: boolean;
}

const keyOf = undoKey;

export class Plan {
  private puts = new Map<string, PutItem>();
  private dels = new Map<string, { kind: Kind; record: AnyEntity }>();

  /** Adds a new record; returns its id (assigned now, so other records can refer to it). */
  create<K extends Kind>(kind: K, draft: Draft<K>): string {
    const id = draft.id ?? uuid();
    this.puts.set(keyOf(kind, id), { kind, draft: { ...draft, id } as Draft<Kind>, before: null });
    return id;
  }

  /** Changes fields of a stored record (several changes to one record merge). */
  change<K extends Kind>(kind: K, record: Entity<K>, patch: Partial<Draft<K>>): Draft<K> {
    const key = keyOf(kind, record.id);
    if (this.dels.has(key)) throw new Error(`${key} is being deleted`);
    const prev = this.puts.get(key);
    const draft = { ...(prev ? prev.draft : draftOf(record)), ...patch, id: record.id } as Draft<Kind>;
    this.puts.set(key, { kind, draft, before: prev ? prev.before : (record as AnyEntity) });
    return draft as Draft<K>;
  }

  /**
   * Changes fields of a deleted record, which stays deleted (in its delete batch): codings in the
   * trash follow a text edit, so restoring them puts them back on their words.
   */
  changeDeleted<K extends Kind>(kind: K, record: Entity<K>, patch: Partial<Draft<K>>): void {
    if (!record.deleted || (record as Entity<K> & TombstoneFields).scrubbed) return;
    const key = keyOf(kind, record.id);
    const prev = this.puts.get(key);
    const draft = { ...(prev ? prev.draft : draftOf(record)), ...patch, id: record.id } as Draft<Kind>;
    this.puts.set(key, { kind, draft, before: prev ? prev.before : (record as AnyEntity), tomb: true });
  }

  /** Deletes a stored record (a tombstone). Cancels a pending change or creation of it. */
  remove<K extends Kind>(kind: K, record: Entity<K>): void {
    const key = keyOf(kind, record.id);
    const prev = this.puts.get(key);
    this.puts.delete(key);
    if (prev && prev.before === null) return;
    const stored = (prev?.before ?? record) as AnyEntity;
    if (!stored.deleted) this.dels.set(key, { kind, record: stored });
  }

  /** The pending version of a record (its draft when this plan changes it). */
  view<K extends Kind>(kind: K, record: Entity<K>): Entity<K> {
    const p = this.puts.get(keyOf(kind, record.id));
    return p ? ({ ...record, ...p.draft } as Entity<K>) : record;
  }

  isRemoved(kind: Kind, id: string): boolean {
    return this.dels.has(keyOf(kind, id));
  }

  get isEmpty(): boolean {
    return this.puts.size === 0 && this.dels.size === 0;
  }

  /** How many records of `kind` the plan deletes / writes. */
  count(kind: Kind, what: 'removed' | 'written'): number {
    let n = 0;
    for (const x of what === 'removed' ? this.dels.values() : this.puts.values()) if (x.kind === kind) n++;
    return n;
  }

  /** @internal */
  entries() {
    return { puts: [...this.puts.values()], dels: [...this.dels.values()] };
  }
}

export interface LogSpec {
  action: LogAction;
  summary: string;
  target?: { kind: string; id: string };
}

interface Snap {
  kind: Kind;
  id: string;
  /** The record before the step (null: the step created it). */
  before: AnyEntity | null;
  /** The record after the step (a tombstone when the step deleted it). */
  after: AnyEntity | null;
  /** The delete batch for a record this step created and its undo deletes again. */
  batch: string;
}

const INVERSE: Partial<Record<LogAction, LogAction>> = {
  'document.add': 'document.delete',
  'document.delete': 'document.restore',
  'document.restore': 'document.delete',
  'code.create': 'code.delete',
  'code.delete': 'code.restore',
  'code.restore': 'code.delete',
  'coding.add': 'coding.remove',
  'coding.remove': 'coding.add',
  'memo.create': 'memo.delete',
  'memo.delete': 'memo.create',
  'case.create': 'case.delete',
  'case.delete': 'case.create',
};

/** Records written by a plan. A document and its text share an id, hence the kind. */
export class Saved {
  private records = new Map<string, AnyEntity>();
  /** @internal */
  set(kind: Kind, record: AnyEntity): void {
    this.records.set(keyOf(kind, record.id), record);
  }
  get<K extends Kind>(kind: K, id: string): Entity<K> {
    const r = this.records.get(keyOf(kind, id));
    if (!r) throw new Error(`${kind} ${id} was not written`);
    return r as Entity<K>;
  }
  find<K extends Kind>(kind: K, id: string): Entity<K> | undefined {
    return this.records.get(keyOf(kind, id)) as Entity<K> | undefined;
  }
}

export interface Committed {
  /** Records written by the plan. */
  saved: Saved;
  /** The id shared by this operation's tombstones (for "recently deleted" and restores). */
  batch: string;
  undo: Undoable;
}

/** The audit-trail records of `logs`, to write in the same transaction (when the context can). */
function logPuts(ctx: ProjectContext, logs: readonly LogSpec[], prefix = '', inverse = false): { kind: Kind; draft: Draft<Kind> }[] | null {
  if (!ctx.logRecord) return null;
  return logs.map((l) => ({ kind: 'log' as Kind, draft: ctx.logRecord!(inverse ? (INVERSE[l.action] ?? l.action) : l.action, `${prefix}${l.summary}`, l.target) as Draft<Kind> }));
}

/**
 * Writes a plan: every create, change and delete (tombstones under one batch id) and the log
 * entries, in one transaction. Returns what was written and how to undo it.
 */
export async function commit(
  ctx: ProjectContext,
  plan: Plan,
  meta: { label: UndoLabel; detail: string; logs: LogSpec[]; batch?: string; extraMeta?: { key: string; value: string | null }[] },
): Promise<Committed> {
  const batch = meta.batch ?? uuid();
  const { puts, dels } = plan.entries();
  const live = puts.filter((p) => !p.tomb);
  const tombs = puts.filter((p) => p.tomb);
  const logs = logPuts(ctx, meta.logs);
  const removes = [...groupIds(dels)].map(([kind, ids]) => ({ kind, ids, batch }));
  // The stamps the records carry before this step: an undo writes that content back.
  const beforeStamps = new Map<string, string>();
  for (const p of puts) if (p.before) beforeStamps.set(keyOf(p.kind, p.before.id), p.before.updated_at_hlc);
  for (const d of dels) beforeStamps.set(keyOf(d.kind, d.record.id), d.record.updated_at_hlc);
  const res = await ctx.store.write({
    puts: [...live.map((p) => ({ kind: p.kind, draft: p.draft })), ...(logs ?? [])],
    tombstones: tombs.map((p) => ({ kind: p.kind, draft: p.draft, batch: (p.before as (AnyEntity & TombstoneFields) | null)?.deleted_batch })),
    removes,
    ...(meta.extraMeta ? { meta: meta.extraMeta } : {}),
  });
  const saved = new Saved();
  res.saved.slice(0, live.length).forEach((r, i) => saved.set(live[i]!.kind, r as AnyEntity));
  if (!logs) for (const l of meta.logs) await ctx.log(l.action, l.summary, l.target);

  const tombAfter = (p: PutItem): AnyEntity => {
    const b = (p.before as (AnyEntity & TombstoneFields) | null)?.deleted_batch;
    return { ...p.before, ...p.draft, deleted: true, ...(b ? { deleted_batch: b } : {}), updated_at_hlc: res.stamps.get(keyOf(p.kind, p.draft.id!)) } as unknown as AnyEntity;
  };
  const snaps: Snap[] = [
    ...live.map((p) => ({ kind: p.kind, id: p.draft.id!, before: p.before, after: saved.find(p.kind, p.draft.id!) ?? null, batch })),
    ...tombs.map((p) => ({ kind: p.kind, id: p.draft.id!, before: p.before, after: tombAfter(p), batch })),
    ...dels.map((d) => ({ kind: d.kind, id: d.record.id, before: d.record, after: { ...d.record, deleted: true, deleted_batch: batch } as unknown as AnyEntity, batch })),
  ];
  const step = new Step(ctx, snaps, meta.logs, res.stamps, beforeStamps, res.stamps);
  return { saved, batch, undo: withStep({ label: meta.label, detail: meta.detail, weight: step.weight }, step) };
}

// The step behind an Undoable made by `commit` (or joined from such), kept off the object's
// enumerable properties so a wrapper made by spreading (`{ ...undo, undo() {…} }`) does not
// take it along and bypass the wrapper.
const STEP = Symbol('step');
const stepOf = (u: Undoable): Step | undefined => (u as unknown as { [STEP]?: Step })[STEP];

function withStep(head: Pick<Undoable, 'label' | 'detail' | 'weight'>, step: Step): Undoable {
  const u: Undoable = {
    ...head,
    touches: step.keys(),
    undo: () => step.run('undo'),
    redo: () => step.run('redo'),
  };
  Object.defineProperty(u, STEP, { value: step, enumerable: false });
  return u;
}

/**
 * The records one step wrote, as they were before and after, and the stamp each carries since
 * this step last wrote it. Undo and redo write only over records that still carry those stamps.
 */
class Step {
  private state: 'done' | 'undone' = 'done';

  constructor(
    private readonly ctx: ProjectContext,
    private readonly snaps: Snap[],
    private readonly logs: LogSpec[],
    /** `kind:id` → the stamp this step's last write left. */
    private stamps: Map<string, string>,
    /** `kind:id` → the stamp the content in `before` carried (records that existed). */
    private readonly beforeStamps: ReadonlyMap<string, string>,
    /** `kind:id` → the stamp the content in `after` carried when the step was first written. */
    private readonly afterStamps: ReadonlyMap<string, string>,
  ) {}

  /** Several consecutive steps as one: the first state before, the last state after. */
  static join(steps: Step[], logs: 'all' | 'last'): Step {
    const byKey = new Map<string, Snap>();
    const stamps = new Map<string, string>();
    const before = new Map<string, string>();
    const after = new Map<string, string>();
    for (const st of steps) {
      if (st.state !== 'done') throw new Error('only steps that are done can be joined');
      for (const sn of st.snaps) {
        const k = keyOf(sn.kind, sn.id);
        const prev = byKey.get(k);
        byKey.set(k, prev ? { ...prev, after: sn.after } : { ...sn });
        if (!prev && st.beforeStamps.has(k)) before.set(k, st.beforeStamps.get(k)!);
        const h = st.stamps.get(k);
        if (h !== undefined) stamps.set(k, h);
        const a = st.afterStamps.get(k);
        if (a !== undefined) after.set(k, a);
      }
    }
    const allLogs = logs === 'all' ? steps.flatMap((st) => st.logs) : steps[steps.length - 1]!.logs;
    return new Step(steps[0]!.ctx, [...byKey.values()], allLogs, stamps, before, after);
  }

  keys(): string[] {
    return this.snaps.map((sn) => keyOf(sn.kind, sn.id));
  }

  get weight(): number {
    return this.snaps.reduce((n, sn) => n + weigh(sn.before) + weigh(sn.after), 0);
  }

  async run(dir: 'undo' | 'redo'): Promise<void> {
    if ((dir === 'undo') !== (this.state === 'done')) {
      throw new ServiceError('changed_since', `this step is already ${dir === 'undo' ? 'undone' : 'done'}`);
    }
    const { store } = this.ctx;
    await this.expectUnchanged();
    const target = (sn: Snap) => (dir === 'undo' ? sn.before : sn.after);
    // A text written back is a new revision of it, not the old one again: a teammate's copy
    // that holds the text from before must not pass for one made after (see `DocText.revs`).
    const texts = await store.getMany('doctext', this.snaps.filter((sn) => sn.kind === 'doctext').map((sn) => sn.id));
    const puts: { kind: Kind; draft: Draft<Kind> }[] = [];
    const tombstones: { kind: Kind; draft: Draft<Kind>; batch?: string }[] = [];
    const removes = new Map<string, { kind: Kind; ids: string[]; batch: string }>();
    for (const sn of this.snaps) {
      const rec = target(sn);
      if (!rec) {
        const k = `${sn.kind}\u0000${sn.batch}`;
        (removes.get(k) ?? removes.set(k, { kind: sn.kind, ids: [], batch: sn.batch }).get(k)!).ids.push(sn.id);
        continue;
      }
      let draft = draftOf(rec) as Draft<Kind>;
      if (sn.kind === 'doctext') {
        const now = texts.get(sn.id);
        const d = draft as Draft<'doctext'>;
        if (now) draft = { ...d, revs: d.text === now.text ? now.revs : appendRev(now) } as Draft<Kind>;
      }
      if (rec.deleted) tombstones.push({ kind: sn.kind, draft, batch: (rec as AnyEntity & TombstoneFields).deleted_batch ?? sn.batch });
      else puts.push({ kind: sn.kind, draft });
    }
    const logs = logPuts(this.ctx, this.logs, dir === 'undo' ? '↶ ' : '↷ ', dir === 'undo');
    const res = await store.write({ puts: [...puts, ...(logs ?? [])], tombstones, removes: [...removes.values()] });
    if (!logs) {
      for (const l of this.logs) {
        await this.ctx.log(dir === 'undo' ? (INVERSE[l.action] ?? l.action) : l.action, `${dir === 'undo' ? '↶' : '↷'} ${l.summary}`, l.target);
      }
    }
    const next = new Map<string, string>();
    const known = dir === 'undo' ? this.beforeStamps : this.afterStamps;
    for (const k of this.keys()) {
      const h = res.stamps.get(k);
      if (h === undefined) continue;
      next.set(k, h);
      // What this write put back is the content that carried `known` before: a neighbouring
      // step of the stack that expects that content (the step before, on undo) accepts it.
      const was = known.get(k);
      if (was !== undefined && was !== h) sameContent(store, k, h, was);
    }
    this.stamps = next;
    this.state = dir === 'undo' ? 'undone' : 'done';
  }

  /** Refuses (ServiceError 'changed_since') unless every record still carries this step's stamp. */
  private async expectUnchanged(): Promise<void> {
    const byKind = new Map<Kind, string[]>();
    for (const sn of this.snaps) (byKind.get(sn.kind) ?? byKind.set(sn.kind, []).get(sn.kind)!).push(sn.id);
    for (const [kind, ids] of byKind) {
      const now = await this.ctx.store.stamps(kind, ids);
      for (const id of ids) {
        const n = now.get(id);
        const k = keyOf(kind, id);
        const want = this.stamps.get(k);
        if (!n || n.scrubbed || want === undefined || canonical(this.ctx.store, k, n.hlc) !== canonical(this.ctx.store, k, want)) {
          throw new ServiceError('changed_since', `${kind} ${id} was changed since; this step can no longer be undone or redone`);
        }
      }
    }
  }
}

// Stamps that stand for the same content of a record: an undo writes back the content a record
// had before its step, under a new stamp. The step before it on the stack expects the old stamp;
// this lets it recognise its own content. Only undo and redo add entries, each for exactly the
// snapshot it wrote, so a write by anything else always makes a stamp no step accepts.
const aliases = new WeakMap<Store, Map<string, string>>();

function sameContent(store: Store, key: string, stamp: string, was: string): void {
  const map = aliases.get(store) ?? aliases.set(store, new Map()).get(store)!;
  map.set(`${key}\u0000${stamp}`, canonical(store, key, was));
}

function canonical(store: Store, key: string, stamp: string): string {
  const map = aliases.get(store);
  let s = stamp;
  for (let i = 0; map && i < 10_000; i++) {
    const next = map.get(`${key}\u0000${s}`);
    if (next === undefined || next === s) break;
    s = next;
  }
  return s;
}

/** An Undoable that does nothing (an operation that turned out to change nothing). */
export function noopUndo(label: UndoLabel, detail = ''): Undoable {
  return { label, detail, weight: 0, undo: async () => undefined, redo: async () => undefined };
}

function weigh(r: AnyEntity | null): number {
  if (!r) return 8;
  if ('text' in r && typeof (r as { text: unknown }).text === 'string') return (r as { text: string }).text.length + 100;
  if ('body' in r && typeof (r as { body: unknown }).body === 'string') return (r as { body: string }).body.length + 100;
  return 150;
}

function groupIds(items: { kind: Kind; record: { id: string } }[]): Map<Kind, string[]> {
  const out = new Map<Kind, string[]>();
  for (const i of items) {
    const list = out.get(i.kind) ?? [];
    list.push(i.record.id);
    out.set(i.kind, list);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Small shared helpers

/** The live record, or ServiceError('not_found'). */
export async function need<K extends Kind>(ctx: ProjectContext, kind: K, id: string): Promise<Entity<K>> {
  const r = await ctx.store.get(kind, id);
  if (!r || r.deleted) throw new ServiceError('not_found', `${kind} ${id} not found`);
  return r;
}

/** Tombstones deleted together under `batch`. */
export async function recordsInBatch<K extends Kind>(store: Store, kind: K, batch: string): Promise<Entity<K>[]> {
  return store.list(kind, {
    includeDeleted: true,
    where: "deleted = 1 AND json_extract(data, '$.deleted_batch') = ?",
    params: [batch],
  });
}

/** Restores, in the given kind order, everything deleted under `batch`. Returns ids per kind. */
export async function restoreBatch(ctx: ProjectContext, batch: string, kinds: readonly Kind[]): Promise<Map<Kind, string[]>> {
  const restores: { kind: Kind; ids: string[] }[] = [];
  for (const kind of kinds) {
    const ids = (await recordsInBatch(ctx.store, kind, batch)).map((r) => r.id);
    if (ids.length) restores.push({ kind, ids });
  }
  // One transaction: a document never comes back without its text, whatever cuts in.
  const { restored } = await ctx.store.write({ restores });
  const out = new Map<Kind, string[]>();
  for (const [kind, list] of restored) if (list.length) out.set(kind, list.map((r) => r.id));
  return out;
}

/** `"name"` for log summaries. */
export const q = (s: string): string => `"${s}"`;

/** Splits a long id list for `IN (…)` queries (SQLite limits bound parameters). */
export function chunks<T>(list: readonly T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Live records of `kind` whose indexed `column` is one of `values`. */
export async function listIn<K extends Kind>(store: Store, kind: K, column: string, values: readonly string[]): Promise<Entity<K>[]> {
  const cols = Object.keys(TABLES[kind].columns);
  if (column !== 'id' && !cols.includes(column)) throw new Error(`${kind} has no indexed column ${column}`);
  const out: Entity<K>[] = [];
  for (const part of chunks([...new Set(values)])) {
    out.push(...(await store.list(kind, { where: `${column} IN (${part.map(() => '?').join(', ')})`, params: part })));
  }
  return out;
}

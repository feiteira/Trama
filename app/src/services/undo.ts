// Undo and redo for the open project, and the plumbing every domain service writes through.
//
// How it fits together:
// - A domain operation (applyCode, mergeCodes, deleteDocuments…) builds a `Plan` of record
//   writes and deletes, then `commit`s it. `commit` writes the plan (one putMany, then the
//   deletes as tombstones under one batch id), appends the audit-log entries, and returns an
//   `Undoable` holding the records as they were before and after.
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

import { uuid } from '../core/ids';
import type { Base, Draft, Entity, Kind, LogAction } from '../core/model/types';
import type { Store } from '../core/store/store';
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
  | 'too_large';

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
}

/** One Undoable made of several, undone newest first. */
export function combineUndo(label: UndoLabel, detail: string, parts: Undoable[]): Undoable {
  return {
    label,
    detail,
    weight: parts.reduce((n, p) => n + p.weight, 0),
    async undo() {
      for (let i = parts.length - 1; i >= 0; i--) await parts[i]!.undo();
    },
    async redo() {
      for (const p of parts) await p.redo();
    },
  };
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

  // Operations run one at a time: a second Ctrl+Z pressed while the first is writing waits.
  private run(from: Undoable[], to: Undoable[], act: (e: Undoable) => Promise<void>): Promise<Undoable | null> {
    const next = this.queue.then(async () => {
      const entry = from.pop();
      if (!entry) return null;
      try {
        await act(entry);
      } catch (e) {
        // A half-applied entry cannot be trusted either way: drop it.
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
}

const keyOf = (kind: Kind, id: string) => `${kind}:${id}`;

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
  /** null: the record did not exist. */
  record: AnyEntity | null;
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

/**
 * Writes a plan: every create/change in one transaction, then the deletes as tombstones under
 * one batch id, then the log entries. Returns what was written and how to undo it.
 */
export async function commit(
  ctx: ProjectContext,
  plan: Plan,
  meta: { label: UndoLabel; detail: string; logs: LogSpec[] },
): Promise<Committed> {
  const batch = uuid();
  const { puts, dels } = plan.entries();
  const saved = new Saved();
  if (puts.length) {
    const written = await ctx.store.putMany(puts.map((p) => ({ kind: p.kind, draft: p.draft })));
    written.forEach((r, i) => saved.set(puts[i]!.kind, r as AnyEntity));
  }
  for (const [kind, ids] of groupIds(dels)) await ctx.store.remove(kind, ids, { batch });

  const before: Snap[] = [
    ...puts.map((p) => ({ kind: p.kind, id: p.draft.id!, record: p.before })),
    ...dels.map((d) => ({ kind: d.kind, id: d.record.id, record: d.record })),
  ];
  const after: Snap[] = [
    ...puts.map((p) => ({ kind: p.kind, id: p.draft.id!, record: saved.find(p.kind, p.draft.id!) ?? null })),
    ...dels.map((d) => ({ kind: d.kind, id: d.record.id, record: { ...d.record, deleted: true, deleted_batch: batch } as unknown as AnyEntity })),
  ];
  for (const l of meta.logs) await ctx.log(l.action, l.summary, l.target);

  const weight = [...before, ...after].reduce((n, s) => n + weigh(s), 0);
  return {
    saved,
    batch,
    undo: {
      label: meta.label,
      detail: meta.detail,
      weight,
      async undo() {
        await applySnaps(ctx.store, before, batch);
        for (const l of meta.logs) await ctx.log(INVERSE[l.action] ?? l.action, `↶ ${l.summary}`, l.target);
      },
      async redo() {
        await applySnaps(ctx.store, after, batch);
        for (const l of meta.logs) await ctx.log(l.action, `↷ ${l.summary}`, l.target);
      },
    },
  };
}

/** An Undoable that does nothing (an operation that turned out to change nothing). */
export function noopUndo(label: UndoLabel, detail = ''): Undoable {
  return { label, detail, weight: 0, undo: async () => undefined, redo: async () => undefined };
}

function weigh(s: Snap): number {
  if (!s.record) return 16;
  if (s.kind === 'doctext') return (s.record as Entity<'doctext'>).text.length + 64;
  if (s.kind === 'coding') return (s.record as Entity<'coding'>).text.length + 200;
  if (s.kind === 'memo') return (s.record as Entity<'memo'>).body.length + 200;
  return 300;
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

async function applySnaps(store: Store, snaps: Snap[], batch: string): Promise<void> {
  const live = snaps.filter((s) => s.record && !s.record.deleted);
  if (live.length) await store.putMany(live.map((s) => ({ kind: s.kind, draft: draftOf(s.record!) as Draft<Kind> })));
  const dead = new Map<string, { kind: Kind; batch: string; ids: string[] }>();
  for (const s of snaps) {
    if (s.record && !s.record.deleted) continue;
    const b = (s.record as (AnyEntity & TombstoneFields) | null)?.deleted_batch ?? batch;
    const key = `${s.kind}\u0000${b}`;
    const g = dead.get(key) ?? { kind: s.kind, batch: b, ids: [] };
    g.ids.push(s.id);
    dead.set(key, g);
  }
  for (const g of dead.values()) await store.remove(g.kind, g.ids, { batch: g.batch });
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
  const out = new Map<Kind, string[]>();
  for (const kind of kinds) {
    const ids = (await recordsInBatch(ctx.store, kind, batch)).map((r) => r.id);
    if (!ids.length) continue;
    const restored = await ctx.store.restore(kind, ids);
    out.set(kind, restored.map((r) => r.id));
  }
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

import { compareHlc, Hlc } from '../hlc';
import { uuid } from '../ids';
import type { Base, Draft, Entity, Kind } from '../model/types';
import { KINDS } from '../model/types';
import { validate } from '../model/validate';
import { randomBytes, toHex } from '../bytes';
import type { Db, Row, SqlParam, SqlStatement } from './db';
import { MIGRATIONS, SCHEMA_VERSION, TABLES } from './schema';

export interface ListOptions {
  /** SQL condition over the kind's indexed columns (see schema.ts), with `?` placeholders. */
  where?: string;
  params?: SqlParam[];
  order?: string;
  limit?: number;
  includeDeleted?: boolean;
}

export type ChangeListener = (kinds: ReadonlySet<Kind>) => void;

/**
 * What a tombstone may carry in its data besides the record: the delete it belonged to (so
 * one Undo restores a folder with its pages), and whether its content has been scrubbed.
 */
export interface TombstoneInfo {
  deleted_batch?: string;
  scrubbed?: boolean;
}

export type Tombstone<K extends Kind> = Entity<K> & TombstoneInfo;

/**
 * A write that would bring back a record whose content was erased for good (a scrubbed
 * tombstone, e.g. a deleted entry of the pseudonymisation key). Nothing of the batch is written.
 */
export class ErasedRecordError extends Error {
  constructor(
    readonly kind: Kind,
    readonly id: string,
  ) {
    super(`${kind} ${id} was erased and cannot be written again`);
    this.name = 'ErasedRecordError';
  }
}

/** Lookups by id are batched: SQLite limits bound parameters, so `IN (…)` takes this many at a time. */
const ID_CHUNK = 500;

/** One group of a `summarise`: how many live records share a value, and the newest of them. */
export interface Summary {
  key: string | null;
  count: number;
  /** The largest value of the summarised column within the group. */
  max: string | null;
  /** The newest write stamp within the group. */
  hlc: string;
}

interface RecordRow extends Row {
  id: string;
  created_at: string;
  hlc: string;
  deleted: number;
  data: string;
}

/**
 * The project store: typed records over the encrypted database. Every write is validated,
 * stamped with a hybrid logical clock, and announced to subscribers so screens refresh.
 * Deletes are tombstones, so a restore or a later sync can tell "deleted" from "never existed".
 */
export class Store {
  private listeners = new Set<ChangeListener>();

  private constructor(
    readonly db: Db,
    readonly hlc: Hlc,
    readonly projectId: string,
    private readonly now: () => Date,
  ) {}

  static async open(db: Db, opts: { now?: () => Date } = {}): Promise<Store> {
    const now = opts.now ?? (() => new Date());
    await migrate(db);
    const meta = await readMeta(db);
    let device = meta.device_id;
    let project = meta.project_id;
    const writes: SqlStatement[] = [];
    if (!device) {
      device = toHex(randomBytes(4));
      writes.push(metaWrite('device_id', device));
    }
    if (!project) {
      project = uuid();
      writes.push(metaWrite('project_id', project), metaWrite('created_at', now().toISOString()));
    }
    if (writes.length) await db.batch(writes);
    const hlc = new Hlc(device, () => now().getTime());
    const store = new Store(db, hlc, project, now);
    // Never issue a stamp older than one already stored (clock moved back, restored backup…).
    const latest = await store.latestHlc();
    if (latest) hlc.observe(latest);
    return store;
  }

  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(kinds: Iterable<Kind>): void {
    const set = new Set(kinds);
    for (const l of this.listeners) l(set);
  }

  async get<K extends Kind>(kind: K, id: string): Promise<Entity<K> | null> {
    const rows = await this.db.query<RecordRow>(
      `SELECT id, created_at, hlc, deleted, data FROM ${TABLES[kind].table} WHERE id = ?`,
      [id],
    );
    const row = rows[0];
    return row ? toEntity<K>(row) : null;
  }

  /** Several records by id (deleted ones included), in as few queries as possible. */
  async getMany<K extends Kind>(kind: K, ids: Iterable<string>): Promise<Map<string, Entity<K>>> {
    const out = new Map<string, Entity<K>>();
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += ID_CHUNK) {
      const part = unique.slice(i, i + ID_CHUNK);
      const rows = await this.db.query<RecordRow>(
        `SELECT id, created_at, hlc, deleted, data FROM ${TABLES[kind].table} WHERE id IN (${part.map(() => '?').join(', ')})`,
        part,
      );
      for (const r of rows) out.set(r.id, toEntity<K>(r));
    }
    return out;
  }

  /** Creation time, stamp and erasure of several records, without reading their data. */
  async stamps(kind: Kind, ids: Iterable<string>): Promise<Map<string, { created_at: string; hlc: string; scrubbed: boolean }>> {
    const out = new Map<string, { created_at: string; hlc: string; scrubbed: boolean }>();
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += ID_CHUNK) {
      const part = unique.slice(i, i + ID_CHUNK);
      const rows = await this.db.query<{ id: string; created_at: string; hlc: string; scrubbed: number | null }>(
        `SELECT id, created_at, hlc, json_extract(data, '$.scrubbed') AS scrubbed FROM ${TABLES[kind].table} WHERE id IN (${part.map(() => '?').join(', ')})`,
        part,
      );
      for (const r of rows) out.set(r.id, { created_at: r.created_at, hlc: r.hlc, scrubbed: !!r.scrubbed });
    }
    return out;
  }

  async list<K extends Kind>(kind: K, opts: ListOptions = {}): Promise<Entity<K>[]> {
    const conds = [];
    if (!opts.includeDeleted) conds.push('deleted = 0');
    if (opts.where) conds.push(`(${opts.where})`);
    const sql = [
      `SELECT id, created_at, hlc, deleted, data FROM ${TABLES[kind].table}`,
      conds.length ? `WHERE ${conds.join(' AND ')}` : '',
      opts.order ? `ORDER BY ${opts.order}` : '',
      opts.limit ? `LIMIT ${Math.floor(opts.limit)}` : '',
    ].join(' ');
    const rows = await this.db.query<RecordRow>(sql, opts.params ?? []);
    return rows.map((r) => toEntity<K>(r));
  }

  async count(kind: Kind, where = '', params: SqlParam[] = []): Promise<number> {
    const rows = await this.db.query<{ n: number }>(
      `SELECT count(*) AS n FROM ${TABLES[kind].table} WHERE deleted = 0 ${where ? `AND (${where})` : ''}`,
      params,
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Live records grouped by one indexed column (see schema.ts): per group, how many there
   * are, the largest value of another indexed column (only among values up to `maxUpTo`, when
   * given; null when none is), and the newest stamp. Reads no record data, so it stays cheap on
   * a large practice.
   */
  async summarise(kind: Kind, by: string, maxOf: string, opts: { maxUpTo?: string } = {}): Promise<Summary[]> {
    const columns = Object.keys(TABLES[kind].columns);
    for (const c of [by, maxOf]) if (!columns.includes(c)) throw new Error(`${kind} has no indexed column ${c}`);
    const upTo = opts.maxUpTo !== undefined;
    const max = upTo ? `max(CASE WHEN ${maxOf} <= ? THEN ${maxOf} END)` : `max(${maxOf})`;
    const rows = await this.db.query<{ k: string | null; n: number; m: string | null; h: string }>(
      `SELECT ${by} AS k, count(*) AS n, ${max} AS m, max(hlc) AS h FROM ${TABLES[kind].table} WHERE deleted = 0 GROUP BY ${by}`,
      upTo ? [opts.maxUpTo!] : [],
    );
    return rows.map((r) => ({ key: r.k, count: Number(r.n), max: r.m, hlc: r.h }));
  }

  /** The newest write stamp in the project, or null when it holds no records. */
  async latestHlc(): Promise<string | null> {
    let latest: string | null = null;
    for (const kind of KINDS) {
      const rows = await this.db.query<{ hlc: string | null }>(`SELECT max(hlc) AS hlc FROM ${TABLES[kind].table}`);
      const h = rows[0]?.hlc ?? null;
      if (h && (!latest || h > latest)) latest = h;
    }
    return latest;
  }

  /** Creates a record (or replaces one, when the draft carries an existing id). */
  async put<K extends Kind>(kind: K, draft: Draft<K>): Promise<Entity<K>> {
    const [saved] = await this.putMany([{ kind, draft }]);
    return saved as Entity<K>;
  }

  /**
   * Creates or replaces records in one transaction. A record whose content was erased (a
   * scrubbed tombstone) is never written over: the whole batch is refused (ErasedRecordError).
   */
  async putMany(items: { kind: Kind; draft: Draft<Kind> }[]): Promise<Base[]> {
    const saved: Base[] = [];
    const statements: SqlStatement[] = [];
    const cleaned = items.map(({ kind, draft }) => ({ kind, clean: validate(kind, draft) }));
    // Existing records, looked up once per kind rather than once per record.
    const byKind = new Map<Kind, string[]>();
    for (const { kind, clean } of cleaned) if (clean.id) (byKind.get(kind) ?? byKind.set(kind, []).get(kind)!).push(clean.id);
    const known = new Map<Kind, Map<string, { created_at: string; scrubbed: boolean }>>();
    for (const [kind, ids] of byKind) known.set(kind, await this.stamps(kind, ids));
    for (const { kind, clean } of cleaned) {
      const id = clean.id ?? uuid();
      const existing = clean.id ? known.get(kind)?.get(id) : undefined;
      if (existing?.scrubbed) throw new ErasedRecordError(kind, id);
      const record = {
        ...clean,
        id,
        created_at: existing?.created_at ?? this.now().toISOString(),
        updated_at_hlc: this.hlc.tick(),
        deleted: false,
      } as Entity<Kind>;
      statements.push(upsert(kind, record));
      saved.push(record);
    }
    await this.db.batch(statements);
    this.emit(items.map((i) => i.kind));
    return saved;
  }

  /** Applies a partial change to an existing record. */
  async update<K extends Kind>(kind: K, id: string, patch: Partial<Draft<K>>): Promise<Entity<K>> {
    const current = await this.get(kind, id);
    if (!current || current.deleted) throw new Error(`${kind} ${id} not found`);
    const { created_at: _c, updated_at_hlc: _h, deleted: _d, ...rest } = current as Entity<K> & Base;
    return this.put(kind, { ...rest, ...patch, id } as Draft<K>);
  }

  /**
   * Marks records deleted. The record's data is kept so history and restores stay coherent.
   * `batch` names the delete these records belong to (one id shared by a folder and its
   * pages, notes and documents), so they can be restored together. Returns how many records
   * were deleted; ones already deleted are left as they are.
   */
  async remove(kind: Kind, ids: string[], opts: { batch?: string } = {}): Promise<number> {
    const statements: SqlStatement[] = [];
    const found = await this.getMany(kind, ids);
    for (const id of new Set(ids)) {
      const current = found.get(id);
      if (!current || current.deleted) continue;
      const tomb: Tombstone<Kind> = { ...current, deleted: true, updated_at_hlc: this.hlc.tick() };
      if (opts.batch) tomb.deleted_batch = opts.batch;
      statements.push(upsert(kind, tomb));
    }
    if (!statements.length) return 0;
    await this.db.batch(statements);
    this.emit([kind]);
    return statements.length;
  }

  /**
   * Brings deleted records back, validated like any write. Records that are live, missing or
   * scrubbed are skipped. Returns the records restored.
   */
  async restore<K extends Kind>(kind: K, ids: string[]): Promise<Entity<K>[]> {
    const restored: Entity<K>[] = [];
    const statements: SqlStatement[] = [];
    const found = await this.getMany(kind, ids);
    for (const id of new Set(ids)) {
      const current = (found.get(id) ?? null) as Tombstone<K> | null;
      if (!current || !current.deleted || current.scrubbed) continue;
      const { created_at, updated_at_hlc: _h, deleted: _d, deleted_batch: _b, scrubbed: _s, ...rest } = current as Tombstone<K> & Base;
      const clean = validate(kind, { ...rest, id } as Draft<K>);
      const record = { ...clean, id, created_at, updated_at_hlc: this.hlc.tick(), deleted: false } as Entity<K>;
      statements.push(upsert(kind, record));
      restored.push(record);
    }
    if (!statements.length) return restored;
    await this.db.batch(statements);
    this.emit([kind]);
    return restored;
  }

  /**
   * Deleted records whose delete was stamped from `sinceMs` up to (not including) `untilMs`,
   * newest first. Scrubbed records are left out: there is nothing in them to show or restore.
   */
  async listDeleted<K extends Kind>(kind: K, sinceMs: number, untilMs?: number): Promise<Tombstone<K>[]> {
    const conds = ['deleted = 1', 'hlc >= ?'];
    const params: SqlParam[] = [hlcFloor(sinceMs)];
    if (untilMs !== undefined) {
      conds.push('hlc < ?');
      params.push(hlcFloor(untilMs));
    }
    const rows = await this.list(kind, { includeDeleted: true, where: conds.join(' AND '), params, order: 'hlc DESC' });
    return (rows as Tombstone<K>[]).filter((r) => !r.scrubbed);
  }

  /**
   * Erases the content of deleted records for good. `blank` returns the record's content
   * fields as valid empties (they are validated like any write); the id, creation time and
   * the delete itself are kept, so a later merge of an older copy cannot bring the content
   * back. Live records are never touched. Returns how many records were scrubbed.
   */
  async scrub<K extends Kind>(kind: K, ids: string[], blank: (record: Entity<K>) => Draft<K>): Promise<number> {
    const statements: SqlStatement[] = [];
    const found = await this.getMany(kind, ids);
    for (const id of new Set(ids)) {
      const current = (found.get(id) ?? null) as Tombstone<K> | null;
      if (!current || !current.deleted || current.scrubbed) continue;
      const clean = validate(kind, { ...blank(current), id } as Draft<K>) as Draft<Kind>;
      const info: TombstoneInfo = { scrubbed: true };
      const record = { ...clean, ...info, id, created_at: current.created_at, updated_at_hlc: this.hlc.tick(), deleted: true } as Entity<Kind>;
      statements.push(upsert(kind, record));
    }
    if (!statements.length) return 0;
    await this.db.batch(statements);
    this.emit([kind]);
    return statements.length;
  }

  /**
   * Writes records that came from elsewhere (a `.sala` file), keeping whichever version of
   * each record is newer. Returns how many records were written.
   */
  async merge(records: { kind: Kind; record: Entity<Kind> }[]): Promise<number> {
    const statements: SqlStatement[] = [];
    const kinds = new Set<Kind>();
    // Stamps of the records here, read per kind in chunks (never one query per record).
    const byKind = new Map<Kind, string[]>();
    for (const { kind, record } of records) {
      if (KINDS.includes(kind)) (byKind.get(kind) ?? byKind.set(kind, []).get(kind)!).push(record.id);
    }
    const here = new Map<Kind, Map<string, { hlc: string }>>();
    for (const [kind, ids] of byKind) here.set(kind, await this.stamps(kind, ids));
    // Within one call the newest version of an id wins too.
    const written = new Map<string, string>();
    for (const { kind, record } of records) {
      if (!KINDS.includes(kind)) continue;
      this.hlc.observe(record.updated_at_hlc);
      const key = `${kind}\u0000${record.id}`;
      const current = written.get(key) ?? here.get(kind)?.get(record.id)?.hlc;
      if (current !== undefined && compareHlc(current, record.updated_at_hlc) >= 0) continue;
      statements.push(upsert(kind, record));
      written.set(key, record.updated_at_hlc);
      kinds.add(kind);
    }
    // Large imports are written in chunks so one transaction never holds everything.
    for (let i = 0; i < statements.length; i += 500) {
      await this.db.batch(statements.slice(i, i + 500));
    }
    if (kinds.size) this.emit(kinds);
    return statements.length;
  }

  async getMeta(key: string): Promise<string | null> {
    const rows = await this.db.query<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
    return rows[0]?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db.batch([metaWrite(key, value)]);
  }

  async deleteMeta(key: string): Promise<void> {
    await this.db.exec('DELETE FROM meta WHERE key = ?', [key]);
  }

  /** Every record of every kind, including tombstones — for export and backup. */
  async *all(): AsyncGenerator<{ kind: Kind; record: Entity<Kind> }> {
    for (const kind of KINDS) {
      for (const record of await this.list(kind, { includeDeleted: true, order: 'id' })) {
        yield { kind, record };
      }
    }
  }

  async close(): Promise<void> {
    this.listeners.clear();
    await this.db.close();
  }
}

function toEntity<K extends Kind>(row: RecordRow): Entity<K> {
  const data = JSON.parse(row.data) as Record<string, unknown>;
  return {
    ...data,
    id: row.id,
    created_at: row.created_at,
    updated_at_hlc: row.hlc,
    deleted: row.deleted === 1,
  } as Entity<K>;
}

function upsert(kind: Kind, record: Entity<Kind>): SqlStatement {
  const spec = TABLES[kind] as unknown as {
    table: string;
    columns: Record<string, { from: (r: Entity<Kind>) => SqlParam }>;
  };
  const { id, created_at, updated_at_hlc, deleted, ...data } = record;
  const extra = Object.entries(spec.columns);
  const cols = ['id', 'created_at', 'hlc', 'deleted', 'data', ...extra.map(([n]) => n)];
  const params: SqlParam[] = [
    id,
    created_at,
    updated_at_hlc,
    deleted ? 1 : 0,
    JSON.stringify(data),
    ...extra.map(([, c]) => c.from(record)),
  ];
  const updates = cols.slice(1).map((c) => `${c} = excluded.${c}`).join(', ');
  return {
    sql: `INSERT INTO ${spec.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT(id) DO UPDATE SET ${updates}`,
    params,
  };
}

function metaWrite(key: string, value: string): SqlStatement {
  return {
    sql: 'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    params: [key, value],
  };
}

async function migrate(db: Db): Promise<void> {
  await db.script('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  const rows = await db.query<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'");
  const current = Number(rows[0]?.value ?? 0);
  if (current > SCHEMA_VERSION) {
    throw new Error('This project was saved by a newer version of Trama. Please update Trama.');
  }
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await db.script(
      `${m.sql}\nINSERT INTO meta (key, value) VALUES ('schema_version', '${m.version}') ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    );
  }
}

async function readMeta(db: Db): Promise<Record<string, string>> {
  const rows = await db.query<{ key: string; value: string }>('SELECT key, value FROM meta');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** The smallest stamp at or after `ms`: stamps start with fixed-width milliseconds. */
function hlcFloor(ms: number): string {
  return String(Math.max(0, Math.floor(ms))).padStart(15, '0');
}

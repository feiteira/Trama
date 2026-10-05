import type { Entity, Kind } from '../model/types';
import type { SqlParam } from './db';

// Each kind is one table: the base columns, the record as JSON in `data`, and a few
// columns copied out of the record purely so they can be indexed and queried.
//
// Migration 1 is generated from TABLES below. schema.test.ts pins its SQL: once a version
// has shipped, never change TABLES in a way that alters it — append a migration instead
// (ALTER TABLE … ADD COLUMN plus a backfill).

interface TableSpec<K extends Kind> {
  table: string;
  columns: Record<string, { type: 'TEXT' | 'INTEGER' | 'REAL'; from: (r: Entity<K>) => SqlParam }>;
  indexes: string[][];
}

export const TABLES: { [K in Kind]: TableSpec<K> } = {
  coder: { table: 'coders', columns: {}, indexes: [] },
  document: {
    table: 'documents',
    columns: {
      sort: { type: 'REAL', from: (r) => r.order },
      case_id: { type: 'TEXT', from: (r) => r.case_id },
    },
    indexes: [['sort'], ['case_id']],
  },
  doctext: { table: 'doctexts', columns: {}, indexes: [] },
  code: {
    table: 'codes',
    columns: {
      parent_id: { type: 'TEXT', from: (r) => r.parent_id },
      sort: { type: 'REAL', from: (r) => r.order },
    },
    indexes: [['parent_id', 'sort']],
  },
  coding: {
    table: 'codings',
    columns: {
      document_id: { type: 'TEXT', from: (r) => r.document_id },
      code_id: { type: 'TEXT', from: (r) => r.code_id },
      coder_id: { type: 'TEXT', from: (r) => r.coder_id },
      start: { type: 'INTEGER', from: (r) => r.start },
      end_pos: { type: 'INTEGER', from: (r) => r.end },
    },
    indexes: [['document_id', 'start'], ['code_id'], ['coder_id']],
  },
  docgroup: { table: 'docgroups', columns: { sort: { type: 'REAL', from: (r) => r.order } }, indexes: [] },
  attribute: { table: 'attributes', columns: { sort: { type: 'REAL', from: (r) => r.order } }, indexes: [] },
  case: { table: 'cases', columns: {}, indexes: [] },
  memo: {
    table: 'memos',
    columns: {
      target_kind: { type: 'TEXT', from: (r) => r.target.kind },
      target_id: { type: 'TEXT', from: (r) => r.target.id },
    },
    indexes: [['target_kind', 'target_id']],
  },
  pseudonym: { table: 'pseudonyms', columns: {}, indexes: [] },
  log: { table: 'log', columns: { at: { type: 'TEXT', from: (r) => r.at } }, indexes: [['at']] },
  setting: { table: 'settings', columns: {}, indexes: [] },
};

function createTable<K extends Kind>(spec: TableSpec<K>): string {
  const extra = Object.entries(spec.columns).map(([name, c]) => `, ${name} ${c.type}`).join('');
  const idx = spec.indexes
    .map((cols) => `CREATE INDEX IF NOT EXISTS idx_${spec.table}_${cols.join('_')} ON ${spec.table} (${cols.join(', ')});`)
    .join('\n');
  return `CREATE TABLE IF NOT EXISTS ${spec.table} (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  hlc TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL${extra}
);
CREATE INDEX IF NOT EXISTS idx_${spec.table}_hlc ON ${spec.table} (hlc);
${idx}`;
}

/** Ordered migrations. Never edit a published one — append a new step. */
export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: [
      `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
      ...(Object.values(TABLES) as TableSpec<Kind>[]).map(createTable),
    ].join('\n'),
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it } from 'vitest';
import { SqlJsDb } from '../../platform/sqljs';
import { toHex, utf8 } from '../bytes';
import { KINDS } from '../model/types';
import { MIGRATIONS, SCHEMA_VERSION, TABLES } from './schema';

describe('schema', () => {
  it('never changes migration 1 once shipped (append a migration instead)', () => {
    // If this fails you changed TABLES in a way that alters migration 1. Researchers' projects
    // were created with the old SQL: revert, and append a migration (ALTER TABLE … plus backfill).
    expect(MIGRATIONS[0]!.version).toBe(1);
    expect(toHex(sha256(utf8(MIGRATIONS[0]!.sql)))).toBe('9b59ed5fc2d53ab51d06bf8810c5b1eb6cf9a3a0c0be8b60b0b4427d04409c93');
  });

  it('numbers migrations 1, 2, 3… in order', () => {
    MIGRATIONS.forEach((m, i) => expect(m.version).toBe(i + 1));
    expect(SCHEMA_VERSION).toBe(MIGRATIONS.length);
  });

  it('gives every kind its own table, with the base columns and its indexed columns', async () => {
    const db = await SqlJsDb.create();
    for (const m of MIGRATIONS) await db.script(m.sql);
    const tables = new Set((await db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name));
    expect(tables.has('meta')).toBe(true);
    const names = KINDS.map((k) => TABLES[k].table);
    expect(new Set(names).size).toBe(KINDS.length);
    expect(Object.keys(TABLES).sort()).toEqual([...KINDS].sort());
    for (const kind of KINDS) {
      const spec = TABLES[kind];
      expect(tables.has(spec.table), spec.table).toBe(true);
      const cols = (await db.query<{ name: string }>(`PRAGMA table_info(${spec.table})`)).map((r) => r.name);
      expect(cols).toEqual(expect.arrayContaining(['id', 'created_at', 'hlc', 'deleted', 'data', ...Object.keys(spec.columns)]));
      const idx = (await db.query<{ name: string }>(`PRAGMA index_list(${spec.table})`)).map((r) => r.name);
      expect(idx).toContain(`idx_${spec.table}_hlc`);
    }
    await db.close();
  });

  it('can run twice over the same database (every statement is IF NOT EXISTS)', async () => {
    const db = await SqlJsDb.create();
    await db.script(MIGRATIONS[0]!.sql);
    await expect(db.script(MIGRATIONS[0]!.sql)).resolves.toBeUndefined();
    await db.close();
  });
});

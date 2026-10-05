import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import type { Db, Row, SqlParam, SqlStatement } from '../core/store/db';

// In-memory SQLite (WebAssembly). Used by the tests and by the browser demo that the
// manual's screenshots are taken from. It is not encrypted and never holds real data.

let sqlPromise: Promise<SqlJsStatic> | null = null;

export function loadSqlJs(locateFile?: (file: string) => string): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs(locateFile ? { locateFile } : undefined);
  return sqlPromise;
}

export class SqlJsDb implements Db {
  constructor(private readonly database: Database) {}

  static async create(opts: { locateFile?: (file: string) => string; data?: Uint8Array } = {}): Promise<SqlJsDb> {
    const SQL = await loadSqlJs(opts.locateFile);
    return new SqlJsDb(new SQL.Database(opts.data));
  }

  async exec(sql: string, params: SqlParam[] = []): Promise<{ changes: number }> {
    this.database.run(sql, params);
    return { changes: this.database.getRowsModified() };
  }

  async query<T extends Row = Row>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    const stmt = this.database.prepare(sql);
    try {
      stmt.bind(params);
      const out: T[] = [];
      while (stmt.step()) out.push(stmt.getAsObject() as T);
      return out;
    } finally {
      stmt.free();
    }
  }

  async batch(statements: SqlStatement[]): Promise<number> {
    let changes = 0;
    this.database.run('BEGIN');
    try {
      for (const s of statements) {
        this.database.run(s.sql, s.params ?? []);
        changes += this.database.getRowsModified();
      }
      this.database.run('COMMIT');
    } catch (e) {
      this.database.run('ROLLBACK');
      throw e;
    }
    return changes;
  }

  async script(sql: string): Promise<void> {
    this.database.run('BEGIN');
    try {
      this.database.exec(sql);
      this.database.run('COMMIT');
    } catch (e) {
      this.database.run('ROLLBACK');
      throw e;
    }
  }

  async close(): Promise<void> {
    this.database.close();
  }

  export(): Uint8Array {
    return this.database.export();
  }
}

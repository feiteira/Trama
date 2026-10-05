// The storage boundary. Platform adapters implement it: SQLCipher through the desktop shell,
// sql.js in tests and the demo build, op-sqlite on phones later. All SQL lives in this core.

export type SqlParam = string | number | null;
export type Row = Record<string, SqlParam>;

export interface SqlStatement {
  sql: string;
  params?: SqlParam[];
}

export interface Db {
  exec(sql: string, params?: SqlParam[]): Promise<{ changes: number }>;
  query<T extends Row = Row>(sql: string, params?: SqlParam[]): Promise<T[]>;
  /** Runs all statements in one transaction. */
  batch(statements: SqlStatement[]): Promise<number>;
  /** Runs a multi-statement script in one transaction (migrations). */
  script(sql: string): Promise<void>;
  close(): Promise<void>;
}

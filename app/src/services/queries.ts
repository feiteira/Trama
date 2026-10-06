// Read-only loaders the screens use. Counts come from SQL over indexed columns, so lists of a
// large project do not parse every coding's JSON.

import type { Code, Coder, Coding, Document, LogEntry } from '../core/model/types';
import { TABLES } from '../core/store/schema';
import { buildTree } from '../core/qda/tree';
import { codeUsage } from './codes';
import type { ProjectContext } from './context';
import { listLog } from './log';
import { listIn } from './undo';

export interface DocumentRow {
  document: Document;
  codings: number;
  caseName: string | null;
  groupNames: string[];
}

/**
 * SQL condition: a coding whose document and code are live. Others (possible after merging a
 * teammate's copy into an older project) are counted nowhere, as retrieval leaves them out.
 */
export const LIVE_CODING = `deleted = 0 AND document_id IN (SELECT id FROM ${TABLES.document.table} WHERE deleted = 0) AND code_id IN (SELECT id FROM ${TABLES.code.table} WHERE deleted = 0)`;

async function countBy(ctx: ProjectContext, column: string): Promise<Map<string, number>> {
  const rows = await ctx.store.db.query<{ k: string; n: number }>(
    `SELECT ${column} AS k, count(*) AS n FROM ${TABLES.coding.table} WHERE ${LIVE_CODING} GROUP BY ${column}`,
  );
  return new Map(rows.map((r) => [r.k, Number(r.n)]));
}

/** Documents in list order, with coding counts and their case and group names. */
export async function listDocuments(ctx: ProjectContext): Promise<DocumentRow[]> {
  const [docs, cases, groups, counts] = await Promise.all([
    ctx.store.list('document', { order: 'sort, id' }),
    ctx.store.list('case'),
    ctx.store.list('docgroup', { order: 'sort, id' }),
    countBy(ctx, 'document_id'),
  ]);
  const caseName = new Map(cases.map((c) => [c.id, c.name]));
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  return docs.map((d) => ({
    document: d,
    codings: counts.get(d.id) ?? 0,
    caseName: d.case_id ? caseName.get(d.case_id) ?? null : null,
    groupNames: d.group_ids.map((g) => groupName.get(g)).filter((n): n is string => n !== undefined),
  }));
}

export interface CodeRow {
  code: Code;
  depth: number;
  /** Codings of this code. */
  own: number;
  /** Codings of this code and every code below it. */
  total: number;
  /** Documents this code appears in. */
  documents: number;
  /** Documents this code or one below it appears in. */
  documentsTotal: number;
  childCount: number;
}

/** The codebook in tree order, with counts. */
export async function listCodesWithCounts(ctx: ProjectContext): Promise<CodeRow[]> {
  const [codes, usage, pairs] = await Promise.all([
    ctx.store.list('code'),
    codeUsage(ctx),
    ctx.store.db.query<{ c: string; d: string }>(
      `SELECT DISTINCT code_id AS c, document_id AS d FROM ${TABLES.coding.table} WHERE ${LIVE_CODING}`,
    ),
  ]);
  const tree = buildTree(codes);
  const docsOf = new Map<string, Set<string>>();
  for (const p of pairs) {
    const s = docsOf.get(p.c) ?? new Set<string>();
    s.add(p.d);
    docsOf.set(p.c, s);
  }
  const counts = tree.aggregate(new Map([...usage].map(([id, u]) => [id, u.codings])));
  const docSets = tree.aggregateSets(docsOf);
  return tree.flatten().map(({ code, depth }) => ({
    code,
    depth,
    own: counts.get(code.id)?.own ?? 0,
    total: counts.get(code.id)?.total ?? 0,
    documents: usage.get(code.id)?.documents ?? 0,
    documentsTotal: docSets.get(code.id)?.size ?? 0,
    childCount: tree.get(code.id)?.children.length ?? 0,
  }));
}

async function liveIds(ctx: ProjectContext, kind: 'document' | 'code'): Promise<Set<string>> {
  const rows = await ctx.store.db.query<{ id: string }>(`SELECT id FROM ${TABLES[kind].table} WHERE deleted = 0`);
  return new Set(rows.map((r) => r.id));
}

/**
 * Orders codings for retrieval: by document (list order), then position. Codings whose document
 * or code is gone (possible after merging a teammate's copy) are left out.
 */
async function forRetrieval(ctx: ProjectContext, codings: Coding[]): Promise<Coding[]> {
  const [docs, codes] = await Promise.all([ctx.store.list('document', { order: 'sort, id' }), liveIds(ctx, 'code')]);
  const rank = new Map(docs.map((d, i) => [d.id, i]));
  return codings
    .filter((c) => rank.has(c.document_id) && codes.has(c.code_id))
    .sort((a, b) => rank.get(a.document_id)! - rank.get(b.document_id)! || a.start - b.start || a.end - b.end || (a.id < b.id ? -1 : 1));
}

/** Codings of some codes (and, with `includeChildren`, of every code below them). */
export async function codingsForCodes(ctx: ProjectContext, codeIds: string[], opts: { includeChildren?: boolean } = {}): Promise<Coding[]> {
  let ids = new Set(codeIds);
  if (opts.includeChildren) {
    const tree = buildTree(await ctx.store.list('code'));
    ids = new Set([...ids, ...[...ids].flatMap((id) => tree.descendants(id).map((c) => c.id))]);
  }
  if (!ids.size) return [];
  return forRetrieval(ctx, await listIn(ctx.store, 'coding', 'code_id', [...ids]));
}

/** Every live coding, in retrieval order. */
export async function allCodings(ctx: ProjectContext): Promise<Coding[]> {
  return forRetrieval(ctx, await ctx.store.list('coding'));
}

export interface CoderRow {
  coder: Coder;
  codings: number;
  isMe: boolean;
}

/** Coders of the project, me first, then by name. */
export async function listCoders(ctx: ProjectContext): Promise<CoderRow[]> {
  const [coders, counts] = await Promise.all([ctx.store.list('coder'), countBy(ctx, 'coder_id')]);
  const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
  return coders
    .map((coder) => ({ coder, codings: counts.get(coder.id) ?? 0, isMe: coder.id === ctx.me.id }))
    .sort((a, b) => Number(b.isMe) - Number(a.isMe) || collator.compare(a.coder.name, b.coder.name));
}

export interface ProjectSummary {
  documents: number;
  /** Characters of text across documents. */
  chars: number;
  codes: number;
  codings: number;
  /** Documents with at least one coding. */
  codedDocuments: number;
  memos: number;
  cases: number;
  attributes: number;
  groups: number;
  coders: number;
  pseudonyms: number;
  /** Time of the newest log entry. */
  lastActivity: string | null;
}

/** Counts for the project overview. */
export async function projectSummary(ctx: ProjectContext): Promise<ProjectSummary> {
  const s = ctx.store;
  const [documents, codes, codings, memos, cases, attributes, groups, coders, pseudonyms, docs, coded, last] = await Promise.all([
    s.count('document'),
    s.count('code'),
    s.db.query<{ n: number }>(`SELECT count(*) AS n FROM ${TABLES.coding.table} WHERE ${LIVE_CODING}`).then((r) => Number(r[0]?.n ?? 0)),
    s.count('memo'),
    s.count('case'),
    s.count('attribute'),
    s.count('docgroup'),
    s.count('coder'),
    s.count('pseudonym'),
    s.list('document'),
    s.db.query<{ n: number }>(`SELECT count(DISTINCT document_id) AS n FROM ${TABLES.coding.table} WHERE ${LIVE_CODING}`),
    listLog(ctx, { limit: 1 }),
  ]);
  return {
    documents,
    chars: docs.reduce((n, d) => n + d.chars, 0),
    codes,
    codings,
    codedDocuments: Number(coded[0]?.n ?? 0),
    memos,
    cases,
    attributes,
    groups,
    coders,
    pseudonyms,
    lastActivity: last[0]?.at ?? null,
  };
}

/** The newest log entries. */
export async function recentActivity(ctx: ProjectContext, limit = 20): Promise<LogEntry[]> {
  return listLog(ctx, { limit });
}

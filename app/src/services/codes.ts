// The codebook: creating, editing, moving, deleting, merging and splitting codes. Every
// operation that touches codings too (delete, merge, split) is one batch with one undo.

import type { Code, Coding, Memo } from '../core/model/types';
import { LIMITS, PALETTE } from '../core/model/types';
import { TABLES } from '../core/store/schema';
import { buildTree, orderAfterLast, placeBefore } from '../core/qda/tree';
import type { ProjectContext } from './context';
import { recentlyLogged } from './log';
import { commit, listIn, need, noopUndo, Plan, q, restoreBatch, ServiceError, type LogSpec, type Undoable } from './undo';

export interface NewCode {
  name: string;
  parent_id?: string | null;
  color?: string;
  description?: string;
  inclusion?: string;
  exclusion?: string;
  example?: string;
  codable?: boolean;
  /** Place it before this sibling (default: after the last one). */
  beforeId?: string | null;
}

export type CodePatch = Partial<Pick<Code, 'name' | 'color' | 'description' | 'inclusion' | 'exclusion' | 'example' | 'codable'>>;

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

function requireName(name: string): string {
  const n = tidy(name);
  if (!n) throw new ServiceError('invalid_argument', 'a code name is required');
  if (n.length > LIMITS.codeNameMax) throw new ServiceError('invalid_argument', `code names are up to ${LIMITS.codeNameMax} characters`);
  return n;
}

/** The colour a new code gets: the palette in turn, by how many codes there are. */
export function nextColor(liveCodes: number): string {
  return PALETTE[liveCodes % PALETTE.length]!;
}

export async function createCode(ctx: ProjectContext, input: NewCode): Promise<{ code: Code; undo: Undoable }> {
  const name = requireName(input.name);
  const parentId = input.parent_id ?? null;
  if (parentId) await need(ctx, 'code', parentId);
  const codes = await ctx.store.list('code');
  const siblings = codes.filter((c) => c.parent_id === parentId);
  const order = input.beforeId ? placeBefore(siblings, '', input.beforeId) : { order: orderAfterLast(siblings), renumber: null };
  const plan = new Plan();
  const id = plan.create('code', {
    name,
    parent_id: parentId,
    color: input.color ?? nextColor(codes.length),
    description: input.description ?? '',
    inclusion: input.inclusion ?? '',
    exclusion: input.exclusion ?? '',
    example: input.example ?? '',
    order: order.renumber?.get('') ?? order.order,
    codable: input.codable ?? true,
    shortcut: null,
  });
  if (order.renumber) {
    for (const s of siblings) {
      const o = order.renumber.get(s.id);
      if (o !== undefined && o !== s.order) plan.change('code', s, { order: o });
    }
  }
  const { saved, undo } = await commit(ctx, plan, {
    label: 'code.create',
    detail: q(name),
    logs: [{ action: 'code.create', summary: q(name), target: { kind: 'code', id } }],
  });
  return { code: saved.get('code', id), undo };
}

/** Edits a code. A rename is logged as such; definition edits typed over a few minutes log once. */
export async function updateCode(ctx: ProjectContext, id: string, patch: CodePatch): Promise<{ code: Code; undo: Undoable }> {
  const code = await need(ctx, 'code', id);
  const clean: CodePatch = { ...patch };
  if (patch.name !== undefined) clean.name = requireName(patch.name);
  const changed = (Object.keys(clean) as (keyof CodePatch)[]).filter((k) => clean[k] !== undefined && clean[k] !== code[k]);
  if (!changed.length) return { code, undo: noopUndo('code.edit', q(code.name)) };
  const plan = new Plan();
  plan.change('code', code, clean);
  const target = { kind: 'code', id };
  const logs: LogSpec[] = [];
  const renamed = changed.includes('name');
  if (renamed) logs.push({ action: 'code.rename', summary: `${q(code.name)} → ${q(clean.name!)}`, target });
  const others = changed.filter((k) => k !== 'name');
  if (others.length && !(await recentlyLogged(ctx, 'code.edit', id))) {
    logs.push({ action: 'code.edit', summary: `${q(clean.name ?? code.name)}: ${others.join(', ')}`, target });
  }
  const { saved, undo } = await commit(ctx, plan, {
    label: renamed ? 'code.rename' : 'code.edit',
    detail: renamed ? `${q(code.name)} → ${q(clean.name!)}` : q(code.name),
    logs,
  });
  return { code: saved.get('code', id), undo };
}

/** Moves a code under `parentId` (null: the top level), before `beforeId` (null: last). */
export async function moveCode(ctx: ProjectContext, id: string, parentId: string | null, beforeId: string | null): Promise<{ code: Code; undo: Undoable }> {
  const code = await need(ctx, 'code', id);
  if (parentId) await need(ctx, 'code', parentId);
  const codes = await ctx.store.list('code');
  const tree = buildTree(codes);
  if (tree.wouldCycle(id, parentId)) throw new ServiceError('cycle', 'a code cannot be moved under itself');
  const siblings = codes.filter((c) => c.parent_id === parentId && c.id !== id);
  const { order, renumber } = placeBefore(siblings, id, beforeId === id ? null : beforeId);
  const plan = new Plan();
  plan.change('code', code, { parent_id: parentId, order });
  if (renumber) {
    for (const s of siblings) {
      const o = renumber.get(s.id);
      if (o !== undefined && o !== s.order) plan.change('code', s, { order: o });
    }
  }
  const where = parentId ? q(tree.path(parentId).join(' / ')) : '/';
  const summary = `${q(code.name)} → ${where}`;
  const logs: LogSpec[] = code.parent_id !== parentId ? [{ action: 'code.move', summary, target: { kind: 'code', id } }] : [];
  const { saved, undo } = await commit(ctx, plan, { label: 'code.move', detail: summary, logs });
  return { code: saved.get('code', id), undo };
}

/** Gives a code favourite key 1–9 (taking it from any other code), or clears it. */
export async function setShortcut(ctx: ProjectContext, id: string, n: number | null): Promise<{ code: Code; undo: Undoable }> {
  if (n !== null && !(Number.isInteger(n) && n >= 1 && n <= 9)) throw new ServiceError('invalid_argument', 'shortcut 1–9 or null');
  const code = await need(ctx, 'code', id);
  if (code.shortcut === n) return { code, undo: noopUndo('code.edit', q(code.name)) };
  const plan = new Plan();
  if (n !== null) {
    for (const other of await ctx.store.list('code')) {
      if (other.id !== id && other.shortcut === n) plan.change('code', other, { shortcut: null });
    }
  }
  plan.change('code', code, { shortcut: n });
  const summary = `${q(code.name)}: ${n ?? '∅'}`;
  const { saved, undo } = await commit(ctx, plan, {
    label: 'code.edit',
    detail: summary,
    logs: [{ action: 'code.edit', summary, target: { kind: 'code', id } }],
  });
  return { code: saved.get('code', id), undo };
}

export interface DeletedCodes {
  batch: string;
  codes: number;
  codings: number;
  memos: number;
  undo: Undoable;
}

/**
 * Deletes a code with its codings and the memos attached to them, as one batch. Its children
 * are deleted too ('delete') or move up to its parent, where it was ('lift').
 */
export async function deleteCode(ctx: ProjectContext, id: string, opts: { withChildren: 'delete' | 'lift' }): Promise<DeletedCodes> {
  const code = await need(ctx, 'code', id);
  const codes = await ctx.store.list('code');
  const tree = buildTree(codes);
  const plan = new Plan();
  const doomed: Code[] = [code];
  if (opts.withChildren === 'delete') doomed.push(...tree.descendants(id));
  else if (tree.childrenOf(id).length) {
    // The children take the deleted code's place among its siblings, in their own order.
    const siblings = tree.childrenOf(code.parent_id && tree.get(code.parent_id) ? code.parent_id : null);
    const children = tree.childrenOf(id);
    const next = siblings.flatMap((s) => (s.id === id ? children : [s]));
    next.forEach((s, i) => {
      const parent = children.includes(s) ? code.parent_id : s.parent_id;
      if (s.order !== i + 1 || s.parent_id !== parent) plan.change('code', s, { order: i + 1, parent_id: parent });
    });
  }
  const ids = doomed.map((c) => c.id);
  const codings = await listIn(ctx.store, 'coding', 'code_id', ids);
  const memos = [
    ...(await listIn(ctx.store, 'memo', 'target_id', ids)).filter((m) => m.target.kind === 'code'),
    ...(await listIn(ctx.store, 'memo', 'target_id', codings.map((c) => c.id))).filter((m) => m.target.kind === 'coding'),
  ];
  for (const m of memos) plan.remove('memo', m);
  for (const c of codings) plan.remove('coding', c);
  for (const c of doomed) plan.remove('code', c);
  const summary = `${doomed.map((c) => q(c.name)).join(', ')} ×${codings.length}`;
  const { batch, undo } = await commit(ctx, plan, {
    label: 'code.delete',
    detail: summary,
    logs: [{ action: 'code.delete', summary, target: { kind: 'code', id } }],
  });
  return { batch, codes: doomed.length, codings: codings.length, memos: memos.length, undo };
}

/**
 * Brings back codes deleted together (from "recently deleted"), with their codings and memos.
 * Children that were lifted stay where they are now.
 */
export async function restoreCodes(ctx: ProjectContext, batch: string): Promise<{ codes: number; codings: number }> {
  const restored = await restoreBatch(ctx, batch, ['code', 'coding', 'memo']);
  const ids = restored.get('code') ?? [];
  for (const id of ids) {
    const c = await ctx.store.get('code', id);
    if (c) await ctx.log('code.restore', q(c.name), { kind: 'code', id });
  }
  return { codes: ids.length, codings: restored.get('coding')?.length ?? 0 };
}

export interface MergeResult {
  /** Codings moved to the target. */
  moved: number;
  /** Codings dropped because the target already had the same coding (document, span, coder). */
  duplicatesRemoved: number;
  /** Child codes moved under the target. */
  childrenMoved: number;
  undo: Undoable;
}

const DEFINITION_FIELDS = ['description', 'inclusion', 'exclusion', 'example'] as const;
const codingKey = (c: Coding) => `${c.document_id}\u0000${c.start}\u0000${c.end}\u0000${c.coder_id}`;

function joinComments(a: string, b: string): string {
  if (!b.trim() || a.includes(b)) return a;
  if (!a.trim()) return b;
  return `${a}\n${b}`.slice(0, LIMITS.commentMax);
}

/**
 * Merges codes into `targetId`: their codings move to it (exact duplicates — same document,
 * span and coder — are dropped, their comments and memos kept on the surviving coding), their
 * child codes move under it, memos about them move to it, and empty definition fields of the
 * target are filled from theirs. The merged codes are deleted.
 */
export async function mergeCodes(ctx: ProjectContext, sourceIds: string[], targetId: string): Promise<MergeResult> {
  const target = await need(ctx, 'code', targetId);
  const sources: Code[] = [];
  for (const id of new Set(sourceIds)) if (id !== targetId) sources.push(await need(ctx, 'code', id));
  if (!sources.length) throw new ServiceError('invalid_argument', 'nothing to merge');
  const codes = await ctx.store.list('code');
  const byId = new Map(codes.map((c) => [c.id, c]));
  const tree = buildTree(codes);
  const sourceSet = new Set(sources.map((s) => s.id));
  const plan = new Plan();

  // Codings: the target's first, so on a duplicate the target's coding is the one kept.
  const targetCodings = await ctx.store.list('coding', { where: 'code_id = ?', params: [targetId] });
  const sourceCodings = (await listIn(ctx.store, 'coding', 'code_id', [...sourceSet])).sort(
    (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0),
  );
  const kept = new Map<string, Coding>(targetCodings.map((c) => [codingKey(c), c]));
  const dropped = new Map<string, string>(); // dropped coding id → kept coding id
  let moved = 0;
  for (const c of sourceCodings) {
    const k = codingKey(c);
    const keep = kept.get(k);
    if (keep) {
      const comment = joinComments(plan.view('coding', keep).comment, c.comment);
      if (comment !== plan.view('coding', keep).comment) plan.change('coding', keep, { comment });
      plan.remove('coding', c);
      dropped.set(c.id, keep.id);
    } else {
      plan.change('coding', c, { code_id: targetId });
      kept.set(k, c);
      moved++;
    }
  }

  // Memos about a merged code go to the target; memos about a dropped coding to the kept one.
  const memos: Memo[] = [
    ...(await listIn(ctx.store, 'memo', 'target_id', [...sourceSet])).filter((m) => m.target.kind === 'code'),
    ...(await listIn(ctx.store, 'memo', 'target_id', [...dropped.keys()])).filter((m) => m.target.kind === 'coding'),
  ];
  for (const m of memos) {
    const to = m.target.kind === 'code' ? targetId : dropped.get(m.target.id!)!;
    plan.change('memo', m, { target: { kind: m.target.kind, id: to } as Memo['target'] });
  }

  // Children of merged codes move under the target, except the branch holding the target
  // itself, which moves up to where the merged code was (anything else would be a cycle).
  const resolvedParent = (code: Code): string | null => {
    let p = code.parent_id;
    for (let guard = 0; p !== null && sourceSet.has(p) && guard < codes.length; guard++) p = byId.get(p)?.parent_id ?? null;
    return p === targetId || (p !== null && sourceSet.has(p)) ? null : p;
  };
  const targetLine = new Set([targetId, ...tree.ancestors(targetId).map((c) => c.id)]);
  let nextOrder = orderAfterLast(codes.filter((c) => c.parent_id === targetId));
  let childrenMoved = 0;
  for (const s of sources) {
    for (const child of tree.childrenOf(s.id)) {
      if (sourceSet.has(child.id)) continue;
      if (targetLine.has(child.id)) plan.change('code', child, { parent_id: resolvedParent(s) });
      else {
        plan.change('code', child, { parent_id: targetId, order: nextOrder++ });
        childrenMoved++;
      }
    }
  }

  const patch: Partial<Code> = {};
  for (const f of DEFINITION_FIELDS) {
    if (target[f].trim()) continue;
    const joined = sources.map((s) => s[f].trim()).filter(Boolean).join('\n\n');
    if (joined) patch[f] = joined;
  }
  if (target.shortcut === null) {
    const sc = sources.find((s) => s.shortcut !== null)?.shortcut;
    if (sc) patch.shortcut = sc;
  }
  if (Object.keys(patch).length) plan.change('code', target, patch);
  for (const s of sources) plan.remove('code', s);

  const summary = `${sources.map((s) => q(s.name)).join(', ')} → ${q(target.name)} ×${moved}`;
  const { undo } = await commit(ctx, plan, {
    label: 'code.merge',
    detail: summary,
    logs: [{ action: 'code.merge', summary, target: { kind: 'code', id: targetId } }],
  });
  return { moved, duplicatesRemoved: dropped.size, childrenMoved, undo };
}

/** Creates a child code of `id` named `newName` and moves the given codings of `id` into it. */
export async function splitCode(
  ctx: ProjectContext,
  id: string,
  opts: { newName: string; codingIds: string[]; color?: string },
): Promise<{ code: Code; moved: number; undo: Undoable }> {
  const parent = await need(ctx, 'code', id);
  const name = requireName(opts.newName);
  const codings: Coding[] = [];
  for (const cid of new Set(opts.codingIds)) {
    const c = await need(ctx, 'coding', cid);
    if (c.code_id !== id) throw new ServiceError('invalid_argument', `coding ${cid} is not coded with ${id}`);
    codings.push(c);
  }
  const codes = await ctx.store.list('code');
  const plan = new Plan();
  const newId = plan.create('code', {
    name,
    parent_id: id,
    color: opts.color ?? nextColor(codes.length),
    description: '',
    inclusion: '',
    exclusion: '',
    example: '',
    order: orderAfterLast(codes.filter((c) => c.parent_id === id)),
    codable: true,
    shortcut: null,
  });
  for (const c of codings) plan.change('coding', c, { code_id: newId });
  const summary = `${q(parent.name)} → ${q(name)} ×${codings.length}`;
  const { saved, undo } = await commit(ctx, plan, {
    label: 'code.split',
    detail: summary,
    logs: [{ action: 'code.split', summary, target: { kind: 'code', id: newId } }],
  });
  return { code: saved.get('code', newId), moved: codings.length, undo };
}

export interface CodeUse {
  codings: number;
  documents: number;
}

/** How many live codings each code has, and in how many documents. Reads no record data. */
export async function codeUsage(ctx: ProjectContext): Promise<Map<string, CodeUse>> {
  const rows = await ctx.store.db.query<{ code_id: string; n: number; d: number }>(
    `SELECT code_id, count(*) AS n, count(DISTINCT document_id) AS d FROM ${TABLES.coding.table} WHERE deleted = 0 GROUP BY code_id`,
  );
  return new Map(rows.map((r) => [r.code_id, { codings: Number(r.n), documents: Number(r.d) }]));
}

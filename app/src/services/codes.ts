// The codebook: creating, editing, moving, deleting, merging and splitting codes. Every
// operation that touches codings too (delete, merge, split) is one batch with one undo.

import type { Code, Coding, Memo } from '../core/model/types';
import { LIMITS, PALETTE } from '../core/model/types';
import { TABLES } from '../core/store/schema';
import { buildTree, orderAfterLast, placeBefore } from '../core/qda/tree';
import type { ProjectContext } from './context';
import { reanchorRestored } from './anchor';
import { restoredKeys } from './documents';
import { reapplyKey } from './pseudonyms';
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

/** One code of a batch (`createCodes`). */
export interface CodeDraft extends Omit<NewCode, 'parent_id' | 'beforeId'> {
  /** A key other drafts of the batch name as their parent (any string, unique in the batch). */
  ref?: string;
  /** Under an existing code (`id`), under an earlier draft of the batch (`ref`), or at the top (null). */
  parent?: { id: string } | { ref: string } | null;
}

export interface CreateCodesOptions {
  /** Changes to existing codes written in the same step (an imported codebook updating definitions). */
  updates?: readonly { id: string; patch: CodePatch }[];
  /** What the batch came from (a file name), for the audit trail. */
  source?: string;
}

/**
 * Creates many codes, nested through references to each other, and optionally edits existing
 * ones, in one write: one undo step and one audit-trail entry. New codes go after their
 * siblings in the order given; colours continue the palette.
 */
export async function createCodes(
  ctx: ProjectContext,
  drafts: readonly CodeDraft[],
  opts: CreateCodesOptions = {},
): Promise<{ codes: Code[]; updated: number; undo: Undoable }> {
  const updates = opts.updates ?? [];
  if (!drafts.length && !updates.length) return { codes: [], updated: 0, undo: noopUndo('code.create') };
  const stored = await ctx.store.list('code');
  const byId = new Map(stored.map((c) => [c.id, c]));
  const plan = new Plan();
  const refs = new Map<string, string>();
  const nextOrder = new Map<string | null, number>();
  const orderUnder = (parentId: string | null) => {
    const o = nextOrder.get(parentId) ?? orderAfterLast(stored.filter((c) => c.parent_id === parentId));
    nextOrder.set(parentId, o + 1);
    return o;
  };
  let colours = stored.length;
  const ids: string[] = [];
  for (const d of drafts) {
    const name = requireName(d.name);
    let parentId: string | null = null;
    if (d.parent && 'ref' in d.parent) {
      const p = refs.get(d.parent.ref);
      if (!p) throw new ServiceError('invalid_argument', `parent ${q(d.parent.ref)} is not an earlier code of the batch`);
      parentId = p;
    } else if (d.parent && 'id' in d.parent) {
      if (!byId.has(d.parent.id)) throw new ServiceError('not_found', `code ${d.parent.id} not found`);
      parentId = d.parent.id;
    }
    if (d.ref !== undefined && refs.has(d.ref)) throw new ServiceError('invalid_argument', `the batch names ${q(d.ref)} twice`);
    const id = plan.create('code', {
      name,
      parent_id: parentId,
      color: d.color ?? nextColor(colours++),
      description: d.description ?? '',
      inclusion: d.inclusion ?? '',
      exclusion: d.exclusion ?? '',
      example: d.example ?? '',
      order: orderUnder(parentId),
      codable: d.codable ?? true,
      shortcut: null,
    });
    if (d.ref !== undefined) refs.set(d.ref, id);
    ids.push(id);
  }
  let updated = 0;
  for (const u of updates) {
    const code = byId.get(u.id);
    if (!code) throw new ServiceError('not_found', `code ${u.id} not found`);
    const clean: CodePatch = { ...u.patch };
    if (clean.name !== undefined) clean.name = requireName(clean.name);
    // A code with coded segments stays codable: a category cannot hold codings.
    if (clean.codable === false && code.codable && (await ctx.store.count('coding', 'code_id = ?', [code.id])) > 0) delete clean.codable;
    const changed = (Object.keys(clean) as (keyof CodePatch)[]).filter((k) => clean[k] !== undefined && clean[k] !== code[k]);
    if (!changed.length) continue;
    plan.change('code', code, clean);
    updated++;
  }
  if (plan.isEmpty) return { codes: [], updated: 0, undo: noopUndo('code.create') };
  // `×3 → "book.qdc" ~1` (3 created from the file, 1 edited), `~1 ×3` without a source; only
  // edits are logged as such.
  const action = ids.length ? 'code.create' : 'code.edit';
  const n = ids.length || updated;
  const edits = ids.length && updated ? `~${updated}` : '';
  const summary = opts.source !== undefined ? `×${n} → ${q(opts.source)}${edits ? ` ${edits}` : ''}` : `${edits ? `${edits} ` : ''}×${n}`;
  const { saved, undo } = await commit(ctx, plan, { label: action, detail: summary, logs: [{ action, summary }] });
  return { codes: ids.map((id) => saved.get('code', id)), updated, undo };
}

/**
 * Edits a code. A rename is logged as such; definition edits typed over a few minutes log once.
 * Turning a code with coded segments into a category is refused ('not_codable': a category
 * cannot hold codings); a code that becomes a category gives up its shortcut.
 */
export async function updateCode(ctx: ProjectContext, id: string, patch: CodePatch): Promise<{ code: Code; undo: Undoable }> {
  const code = await need(ctx, 'code', id);
  const clean: CodePatch & { shortcut?: null } = { ...patch };
  if (patch.name !== undefined) clean.name = requireName(patch.name);
  if (patch.codable === false && code.codable) {
    const n = await ctx.store.count('coding', 'code_id = ?', [id]);
    if (n > 0) throw new ServiceError('not_codable', `${code.name} has ${n} coded segments; a category cannot hold them`);
    if (code.shortcut !== null) clean.shortcut = null;
  }
  const changed = (Object.keys(clean) as (keyof typeof clean)[]).filter((k) => clean[k] !== undefined && clean[k] !== code[k]);
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
export async function restoreCodes(ctx: ProjectContext, batch: string): Promise<{ codes: number; codings: number; pseudonymised: number }> {
  const restored = await restoreBatch(ctx, batch, ['code', 'coding', 'memo']);
  // The text may have changed since the delete (a typo fix, pseudonymisation).
  const fixed = await reanchorRestored(ctx, restored.get('coding') ?? [], batch);
  const ids = restored.get('code') ?? [];
  for (const id of ids) {
    const c = await ctx.store.get('code', id);
    if (c) await ctx.log('code.restore', q(c.name), { kind: 'code', id });
  }
  // Deleted before the pseudonymisation key was applied: names, definitions, comments, memos.
  const pseudonymised = (await reapplyKey(ctx, restoredKeys(restored), 'restore')).replacements;
  return { codes: ids.length, codings: (restored.get('coding')?.length ?? 0) - fixed.removed, pseudonymised };
}

export interface MergeResult {
  /** Codings moved to the target. */
  moved: number;
  /**
   * Codings folded into another coding of the same coder and document because their spans
   * overlap or touch (the coding-merge rule), exact duplicates included.
   */
  duplicatesRemoved: number;
  /** Child codes moved under the target. */
  childrenMoved: number;
  undo: Undoable;
}

const DEFINITION_FIELDS = ['description', 'inclusion', 'exclusion', 'example'] as const;

function joinComments(a: string, b: string): string {
  if (!b.trim() || a.includes(b)) return a;
  if (!a.trim()) return b;
  return `${a}\n${b}`.slice(0, LIMITS.commentMax);
}

/**
 * Merges codes into `targetId` (a codable code; a category is refused with 'not_codable'): their
 * codings move to it under the coding-merge rule (a coder's overlapping or touching codings
 * become one, their comments and memos kept on the surviving coding), their
 * child codes move under it, memos about them move to it, and empty definition fields of the
 * target are filled from theirs. The merged codes are deleted.
 */
export async function mergeCodes(ctx: ProjectContext, sourceIds: string[], targetId: string): Promise<MergeResult> {
  const target = await need(ctx, 'code', targetId);
  // A category cannot hold codings (it cannot be applied, nor reached by a shortcut).
  if (!target.codable) throw new ServiceError('not_codable', `${target.name} only groups other codes`);
  const sources: Code[] = [];
  for (const id of new Set(sourceIds)) if (id !== targetId) sources.push(await need(ctx, 'code', id));
  if (!sources.length) throw new ServiceError('invalid_argument', 'nothing to merge');
  const codes = await ctx.store.list('code');
  const byId = new Map(codes.map((c) => [c.id, c]));
  const tree = buildTree(codes);
  const sourceSet = new Set(sources.map((s) => s.id));
  const plan = new Plan();

  // Codings move to the target under the coding-merge rule (codings.ts): one coder never holds
  // the same code twice on overlapping or touching spans of a document. Where a moved coding
  // overlaps or touches one of the same coder's codings of the target (or another moved one),
  // they become one coding over both spans, comments joined; the earliest-starting one is kept.
  const targetCodings = await ctx.store.list('coding', { where: 'code_id = ?', params: [targetId] });
  const sourceCodings = (await listIn(ctx.store, 'coding', 'code_id', [...sourceSet])).sort(
    (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0),
  );
  const groupKey = (c: Coding) => `${c.document_id}\u0000${c.coder_id}`;
  const held = new Map<string, Coding[]>(); // current versions of the target's codings, per document and coder
  for (const c of targetCodings) (held.get(groupKey(c)) ?? held.set(groupKey(c), []).get(groupKey(c))!).push(c);
  const dropped = new Map<string, string>(); // absorbed coding id → coding that took it over
  const grown = new Set<string>(); // codings whose span grew: their text is read again below
  let moved = 0;
  for (const c of sourceCodings) {
    const mine = held.get(groupKey(c)) ?? held.set(groupKey(c), []).get(groupKey(c))!;
    const touching = mine.filter((m) => m.start <= c.end && m.end >= c.start);
    if (!touching.length) {
      plan.change('coding', c, { code_id: targetId });
      mine.push({ ...c, code_id: targetId });
      moved++;
      continue;
    }
    const all = [...touching, c].sort((a, b) => a.start - b.start || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
    const keep = all[0]!;
    let start = keep.start;
    let end = keep.end;
    let comment = keep.comment;
    for (const x of all.slice(1)) {
      start = Math.min(start, x.start);
      end = Math.max(end, x.end);
      comment = joinComments(comment, x.comment);
      plan.remove('coding', x);
      dropped.set(x.id, keep.id);
      const i = mine.findIndex((m) => m.id === x.id);
      if (i >= 0) mine.splice(i, 1);
    }
    const next = { ...keep, code_id: targetId, start, end, comment };
    plan.change('coding', keep, { code_id: targetId, start, end, comment });
    if (start !== keep.start || end !== keep.end) grown.add(keep.id);
    const i = mine.findIndex((m) => m.id === keep.id);
    if (i >= 0) mine[i] = next;
    else {
      mine.push(next);
      moved++;
    }
  }
  // A coding that grew shows the text it now covers.
  const grownCodings = [...held.values()].flat().filter((c) => grown.has(c.id));
  for (const docId of new Set(grownCodings.map((c) => c.document_id))) {
    const dt = await ctx.store.get('doctext', docId);
    if (!dt || dt.deleted) continue;
    for (const c of grownCodings) {
      if (c.document_id !== docId) continue;
      const end = Math.min(c.end, dt.text.length);
      const stored = sourceCodings.find((x) => x.id === c.id) ?? targetCodings.find((x) => x.id === c.id)!;
      plan.change('coding', stored, { text: dt.text.slice(c.start, end), end });
    }
  }
  // Chains (a absorbed into b, b into c) resolve to the coding that survived.
  const survivor = (id: string) => {
    let cur = id;
    for (let i = 0; dropped.has(cur) && i <= dropped.size; i++) cur = dropped.get(cur)!;
    return cur;
  };

  // Memos about a merged code go to the target; memos about a dropped coding to the kept one.
  const memos: Memo[] = [
    ...(await listIn(ctx.store, 'memo', 'target_id', [...sourceSet])).filter((m) => m.target.kind === 'code'),
    ...(await listIn(ctx.store, 'memo', 'target_id', [...dropped.keys()])).filter((m) => m.target.kind === 'coding'),
  ];
  for (const m of memos) {
    const to = m.target.kind === 'code' ? targetId : survivor(m.target.id!);
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

/**
 * How many live codings each code has, and in how many live documents. Reads no record data.
 * Codings in a deleted document are not counted (retrieval leaves them out too).
 */
export async function codeUsage(ctx: ProjectContext): Promise<Map<string, CodeUse>> {
  const rows = await ctx.store.db.query<{ code_id: string; n: number; d: number }>(
    `SELECT code_id, count(*) AS n, count(DISTINCT document_id) AS d FROM ${TABLES.coding.table} WHERE deleted = 0 AND document_id IN (SELECT id FROM ${TABLES.document.table} WHERE deleted = 0) GROUP BY code_id`,
  );
  return new Map(rows.map((r) => [r.code_id, { codings: Number(r.n), documents: Number(r.d) }]));
}

// Memos: the researcher's notes about the project, a document, a code, a coded segment or a case.

import type { Memo, MemoTarget } from '../core/model/types';
import { LIMITS } from '../core/model/types';
import type { ProjectContext } from './context';
import { recentlyLogged } from './log';
import { commit, need, noopUndo, Plan, q, restoreBatch, type LogSpec, type Undoable } from './undo';

export interface NewMemo {
  title?: string;
  body?: string;
  target: MemoTarget;
  color?: string | null;
}

export type MemoPatch = Partial<Pick<Memo, 'title' | 'body' | 'color' | 'target'>>;

/** How a memo is named in the log: its title, never its body (which may quote participants). */
const memoLabel = (m: { title: string }) => q(m.title || '…');

async function checkTarget(ctx: ProjectContext, target: MemoTarget): Promise<void> {
  if (target.kind !== 'project') await need(ctx, target.kind, target.id);
}

export async function createMemo(ctx: ProjectContext, input: NewMemo): Promise<{ memo: Memo; undo: Undoable }> {
  await checkTarget(ctx, input.target);
  const plan = new Plan();
  const id = plan.create('memo', {
    title: input.title ?? '',
    body: input.body ?? '',
    target: input.target,
    coder_id: ctx.me.id,
    color: input.color ?? null,
  });
  // The title as validation will store it.
  const title = (input.title ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.nameMax);
  const { saved, undo } = await commit(ctx, plan, {
    label: 'memo.create',
    detail: memoLabel({ title }),
    logs: [{ action: 'memo.create', summary: memoLabel({ title }), target: { kind: 'memo', id } }],
  });
  const memo = saved.get('memo', id);
  return { memo, undo };
}

/** Edits a memo. Saves made while typing log once every few minutes, not every time. */
export async function updateMemo(ctx: ProjectContext, id: string, patch: MemoPatch): Promise<{ memo: Memo; undo: Undoable }> {
  const memo = await need(ctx, 'memo', id);
  if (patch.target) await checkTarget(ctx, patch.target);
  const changed = (Object.keys(patch) as (keyof MemoPatch)[]).some(
    (k) => patch[k] !== undefined && JSON.stringify(patch[k]) !== JSON.stringify(memo[k]),
  );
  if (!changed) return { memo, undo: noopUndo('memo.edit', memoLabel(memo)) };
  const plan = new Plan();
  plan.change('memo', memo, patch);
  const title = patch.title ?? memo.title;
  const logs: LogSpec[] = (await recentlyLogged(ctx, 'memo.edit', id)) ? [] : [{ action: 'memo.edit', summary: memoLabel({ title }), target: { kind: 'memo', id } }];
  const { saved, undo } = await commit(ctx, plan, { label: 'memo.edit', detail: memoLabel({ title }), logs });
  return { memo: saved.get('memo', id), undo };
}

export async function deleteMemo(ctx: ProjectContext, id: string): Promise<{ batch: string; undo: Undoable }> {
  const memo = await need(ctx, 'memo', id);
  const plan = new Plan();
  plan.remove('memo', memo);
  const { batch, undo } = await commit(ctx, plan, {
    label: 'memo.delete',
    detail: memoLabel(memo),
    logs: [{ action: 'memo.delete', summary: memoLabel(memo), target: { kind: 'memo', id } }],
  });
  return { batch, undo };
}

/** Brings back memos deleted together (from "recently deleted"). */
export async function restoreMemos(ctx: ProjectContext, batch: string): Promise<number> {
  const ids = (await restoreBatch(ctx, batch, ['memo'])).get('memo') ?? [];
  for (const id of ids) {
    const m = await ctx.store.get('memo', id);
    if (m) await ctx.log('memo.create', `↶ ${memoLabel(m)}`, { kind: 'memo', id });
  }
  return ids.length;
}

const byUpdated = (a: Memo, b: Memo) => (a.updated_at_hlc < b.updated_at_hlc ? 1 : a.updated_at_hlc > b.updated_at_hlc ? -1 : 0);

/** Live memos about one target, most recently updated first. */
export async function memosFor(ctx: ProjectContext, target: MemoTarget): Promise<Memo[]> {
  const memos =
    target.kind === 'project'
      ? await ctx.store.list('memo', { where: "target_kind = 'project'" })
      : await ctx.store.list('memo', { where: 'target_kind = ? AND target_id = ?', params: [target.kind, target.id] });
  return memos.sort(byUpdated);
}

/** Every live memo, most recently updated first. */
export async function allMemos(ctx: ProjectContext): Promise<Memo[]> {
  return (await ctx.store.list('memo')).sort(byUpdated);
}

// Document groups (sets of documents: "Wave 1", "Teachers"…). A document lists the groups it
// belongs to, so deleting a group also takes its id out of every document.
//

import type { DocGroup, Document } from '../core/model/types';
import { PALETTE } from '../core/model/types';
import { orderAfterLast, placeBefore } from '../core/qda/tree';
import type { ProjectContext } from './context';
import { commit, need, noopUndo, Plan, q, ServiceError, type Undoable } from './undo';

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

export async function createGroup(ctx: ProjectContext, input: { name: string; color?: string }): Promise<{ group: DocGroup; undo: Undoable }> {
  const name = tidy(input.name);
  if (!name) throw new ServiceError('invalid_argument', 'a group name is required');
  const groups = await ctx.store.list('docgroup');
  const plan = new Plan();
  const id = plan.create('docgroup', { name, color: input.color ?? PALETTE[groups.length % PALETTE.length]!, order: orderAfterLast(groups) });
  const { saved, undo } = await commit(ctx, plan, { label: 'group.edit', detail: q(name), logs: [{ action: 'group.create', summary: q(name), target: { kind: 'docgroup', id } }] });
  return { group: saved.get('docgroup', id), undo };
}

async function patchGroup(ctx: ProjectContext, id: string, patch: Partial<DocGroup>): Promise<{ group: DocGroup; undo: Undoable }> {
  const group = await need(ctx, 'docgroup', id);
  const plan = new Plan();
  plan.change('docgroup', group, patch);
  const { saved, undo } = await commit(ctx, plan, { label: 'group.edit', detail: q(group.name), logs: [{ action: 'group.edit', summary: q(group.name), target: { kind: 'docgroup', id } }] });
  return { group: saved.get('docgroup', id), undo };
}

export async function renameGroup(ctx: ProjectContext, id: string, name: string): Promise<{ group: DocGroup; undo: Undoable }> {
  const n = tidy(name);
  if (!n) throw new ServiceError('invalid_argument', 'a group name is required');
  return patchGroup(ctx, id, { name: n });
}

export async function recolourGroup(ctx: ProjectContext, id: string, color: string): Promise<{ group: DocGroup; undo: Undoable }> {
  return patchGroup(ctx, id, { color });
}

export async function reorderGroup(ctx: ProjectContext, id: string, beforeId: string | null): Promise<Undoable> {
  const group = await need(ctx, 'docgroup', id);
  const groups = await ctx.store.list('docgroup');
  const { order, renumber } = placeBefore(groups, id, beforeId === id ? null : beforeId);
  const plan = new Plan();
  if (renumber) {
    for (const g of groups) {
      const o = renumber.get(g.id);
      if (o !== undefined && o !== g.order) plan.change('docgroup', g, { order: o });
    }
  } else plan.change('docgroup', group, { order });
  if (plan.isEmpty) return noopUndo('group.edit');
  return (await commit(ctx, plan, { label: 'group.edit', detail: q(group.name), logs: [] })).undo;
}

/** Deletes a group; its documents stay, without it. */
export async function deleteGroup(ctx: ProjectContext, id: string): Promise<{ batch: string; documents: number; undo: Undoable }> {
  const group = await need(ctx, 'docgroup', id);
  const plan = new Plan();
  const members = (await ctx.store.list('document')).filter((d) => d.group_ids.includes(id));
  for (const d of members) plan.change('document', d, { group_ids: d.group_ids.filter((g) => g !== id) });
  plan.remove('docgroup', group);
  const summary = `${q(group.name)} → ∅ ×${members.length}`;
  const { batch, undo } = await commit(ctx, plan, { label: 'group.edit', detail: summary, logs: [{ action: 'group.delete', summary, target: { kind: 'docgroup', id } }] });
  return { batch, documents: members.length, undo };
}

async function membership(ctx: ProjectContext, groupId: string, docIds: string[], add: boolean): Promise<{ changed: number; undo: Undoable }> {
  const group = await need(ctx, 'docgroup', groupId);
  const plan = new Plan();
  const changed: Document[] = [];
  for (const id of new Set(docIds)) {
    const d = await need(ctx, 'document', id);
    const has = d.group_ids.includes(groupId);
    if (has === add) continue;
    plan.change('document', d, { group_ids: add ? [...d.group_ids, groupId] : d.group_ids.filter((g) => g !== groupId) });
    changed.push(d);
  }
  if (!changed.length) return { changed: 0, undo: noopUndo('group.edit') };
  const names = changed.length <= 3 ? changed.map((d) => q(d.name)).join(', ') : `×${changed.length}`;
  const summary = add ? `${names} → ${q(group.name)}` : `${names} ← ${q(group.name)}`;
  const { undo } = await commit(ctx, plan, { label: 'group.edit', detail: summary, logs: [{ action: 'group.edit', summary, target: { kind: 'docgroup', id: groupId } }] });
  return { changed: changed.length, undo };
}

export function addToGroup(ctx: ProjectContext, groupId: string, docIds: string[]): Promise<{ changed: number; undo: Undoable }> {
  return membership(ctx, groupId, docIds, true);
}

export function removeFromGroup(ctx: ProjectContext, groupId: string, docIds: string[]): Promise<{ changed: number; undo: Undoable }> {
  return membership(ctx, groupId, docIds, false);
}

/** Live groups in their order. */
export async function listGroups(ctx: ProjectContext): Promise<DocGroup[]> {
  return ctx.store.list('docgroup', { order: 'sort, id' });
}

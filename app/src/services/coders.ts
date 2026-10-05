// Coders: adding a teammate by hand, renaming one and changing their colour. Undoable and logged
// like any other change, so the audit trail says who was added and who was renamed when.
//
// Coders are never deleted here: their codings carry the coder id, and agreement between coders
// is measured on them. A coder added by mistake is renamed or simply left unused.

import type { Coder } from '../core/model/types';
import { HEX_COLOR, LIMITS, PALETTE } from '../core/model/types';
import type { ProjectContext } from './context';
import { listLog, recentlyLogged } from './log';
import { commit, need, noopUndo, Plan, q, ServiceError, type Undoable } from './undo';

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const nameKey = (s: string) => tidy(s).normalize('NFC').toLocaleLowerCase();

function requireName(name: string): string {
  const n = tidy(name);
  if (!n) throw new ServiceError('invalid_argument', 'a coder name is required');
  if (n.length > LIMITS.nameMax) throw new ServiceError('invalid_argument', `coder names are up to ${LIMITS.nameMax} characters`);
  return n;
}

function requireColor(color: string): string {
  const c = color.toLowerCase();
  if (!HEX_COLOR.test(c)) throw new ServiceError('invalid_argument', 'colour: #rrggbb');
  return c;
}

/** Two coders with the same name could not be told apart in agreement results. */
async function checkUnique(ctx: ProjectContext, name: string, exceptId?: string): Promise<Coder[]> {
  const coders = await ctx.store.list('coder');
  if (coders.some((c) => c.id !== exceptId && nameKey(c.name) === nameKey(name))) {
    throw new ServiceError('duplicate', `there is already a coder named ${q(name)}`);
  }
  return coders;
}

/** The colour a new coder gets: the first palette colour no coder has yet. */
export function nextCoderColor(coders: readonly Pick<Coder, 'color'>[]): string {
  const used = new Set(coders.map((c) => c.color.toLowerCase()));
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[coders.length % PALETTE.length]!;
}

/** Keeps the cached `me` in step when an operation, its undo or its redo touches that coder. */
function followMe(ctx: ProjectContext, id: string, undo: Undoable): Undoable {
  if (!ctx.reloadMe || ctx.me.id !== id) return undo;
  const reload = () => ctx.reloadMe?.() ?? Promise.resolve();
  return {
    ...undo,
    async undo() {
      await undo.undo();
      await reload();
    },
    async redo() {
      await undo.redo();
      await reload();
    },
  };
}

/** Adds a coder (a teammate whose copy will be merged, or who codes on this computer too). */
export async function addCoder(ctx: ProjectContext, input: { name: string; color?: string }): Promise<{ coder: Coder; undo: Undoable }> {
  const name = requireName(input.name);
  const coders = await checkUnique(ctx, name);
  const color = input.color !== undefined ? requireColor(input.color) : nextCoderColor(coders);
  const plan = new Plan();
  const id = plan.create('coder', { name, color });
  const { saved, undo } = await commit(ctx, plan, {
    label: 'coder.add',
    detail: q(name),
    logs: [{ action: 'coder.add', summary: q(name), target: { kind: 'coder', id } }],
  });
  return { coder: saved.get('coder', id), undo };
}

export async function renameCoder(ctx: ProjectContext, id: string, name: string): Promise<{ coder: Coder; undo: Undoable }> {
  const coder = await need(ctx, 'coder', id);
  const next = requireName(name);
  if (next === coder.name) return { coder, undo: noopUndo('coder.edit', q(coder.name)) };
  await checkUnique(ctx, next, id);
  const plan = new Plan();
  plan.change('coder', coder, { name: next });
  const summary = `${q(coder.name)} → ${q(next)}`;
  const { saved, undo } = await commit(ctx, plan, {
    label: 'coder.edit',
    detail: summary,
    logs: [{ action: 'coder.edit', summary, target: { kind: 'coder', id } }],
  });
  if (ctx.me.id === id) await ctx.reloadMe?.();
  return { coder: saved.get('coder', id), undo: followMe(ctx, id, undo) };
}

/**
 * Gives a coder a new colour. Trying colours one after another is one change in the audit trail
 * (logged once within a few minutes), though each stays its own undo step.
 */
export async function recolourCoder(ctx: ProjectContext, id: string, color: string): Promise<{ coder: Coder; undo: Undoable }> {
  const coder = await need(ctx, 'coder', id);
  const next = requireColor(color);
  if (next === coder.color.toLowerCase()) return { coder, undo: noopUndo('coder.edit', q(coder.name)) };
  const plan = new Plan();
  plan.change('coder', coder, { color: next });
  const summary = `${q(coder.name)}: color`;
  const [last] = await listLog(ctx, { limit: 1 });
  const again = last?.summary === summary && (await recentlyLogged(ctx, 'coder.edit', id));
  const logs = again ? [] : [{ action: 'coder.edit' as const, summary, target: { kind: 'coder', id } }];
  const { saved, undo } = await commit(ctx, plan, { label: 'coder.edit', detail: q(coder.name), logs });
  if (ctx.me.id === id) await ctx.reloadMe?.();
  return { coder: saved.get('coder', id), undo: followMe(ctx, id, undo) };
}

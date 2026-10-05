// The audit trail: reading it, exporting it, and the logging conventions of the domain services.
//
// Summaries are language-neutral so the trail reads the same whatever language the app is in,
// and survives export: names in double quotes, `→` for "became/moved to", `×N` for how many
// records an operation touched, `∅` for "none", and `↶` / `↷` in front of an undone / redone
// operation. The pseudonymisation key never appears in a summary.

import type { LogAction, LogEntry } from '../core/model/types';
import type { ProjectContext } from './context';

export interface LogQuery {
  /** Newest entries first; at most this many (default 200). */
  limit?: number;
  /** Continue after this entry (the last one of the previous page). */
  before?: Pick<LogEntry, 'at' | 'updated_at_hlc'>;
  action?: LogAction | readonly LogAction[];
  coderId?: string;
  targetId?: string;
}

/** Log entries, newest first. */
export async function listLog(ctx: ProjectContext, opts: LogQuery = {}): Promise<LogEntry[]> {
  const conds: string[] = [];
  const params: (string | number)[] = [];
  if (opts.before) {
    conds.push('(at < ? OR (at = ? AND hlc < ?))');
    params.push(opts.before.at, opts.before.at, opts.before.updated_at_hlc);
  }
  const actions = opts.action === undefined ? [] : typeof opts.action === 'string' ? [opts.action] : [...opts.action];
  if (actions.length) {
    conds.push(`json_extract(data, '$.action') IN (${actions.map(() => '?').join(', ')})`);
    params.push(...actions);
  }
  if (opts.coderId) {
    conds.push("json_extract(data, '$.coder_id') = ?");
    params.push(opts.coderId);
  }
  if (opts.targetId) {
    conds.push("json_extract(data, '$.target_id') = ?");
    params.push(opts.targetId);
  }
  return ctx.store.list('log', {
    where: conds.length ? conds.join(' AND ') : undefined,
    params,
    order: 'at DESC, hlc DESC',
    limit: Math.max(1, Math.floor(opts.limit ?? 200)),
  });
}

/** Column ids of `logAsRows` (stable, for the exporter to translate into headers). */
export const LOG_COLUMNS = ['at', 'coder', 'action', 'summary', 'target_kind', 'target_id'] as const;

/**
 * The trail as table rows for CSV/XLSX export, oldest first, coders by name. With `header`
 * (the default) the first row holds LOG_COLUMNS.
 */
export function logAsRows(entries: readonly LogEntry[], coderNames: ReadonlyMap<string, string>, opts: { header?: boolean } = {}): string[][] {
  const rows = [...entries]
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.updated_at_hlc < b.updated_at_hlc ? -1 : 1))
    .map((e) => [
      e.at,
      e.coder_id ? coderNames.get(e.coder_id) ?? e.coder_id : '',
      e.action,
      e.summary,
      e.target_kind ?? '',
      e.target_id ?? '',
    ]);
  return opts.header === false ? rows : [[...LOG_COLUMNS], ...rows];
}

/**
 * Whether an edit should go unlogged because the same coder logged the same action on the
 * same record moments ago: a definition or memo typed over a few minutes is one change in the
 * trail, not one per autosave.
 */
export async function recentlyLogged(ctx: ProjectContext, action: LogAction, targetId: string, windowMs = 10 * 60_000): Promise<boolean> {
  const [last] = await listLog(ctx, { limit: 1 });
  if (!last || last.action !== action || last.target_id !== targetId || last.coder_id !== ctx.me.id) return false;
  return Date.now() - Date.parse(last.at) < windowMs;
}

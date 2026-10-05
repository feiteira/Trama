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
  /** Continue after this entry (the last one of the previous page): only older entries. */
  before?: Pick<LogEntry, 'at' | 'updated_at_hlc'>;
  /** Only newer entries than this one. `{ at, updated_at_hlc: '' }` keeps entries at `at` too. */
  after?: Pick<LogEntry, 'at' | 'updated_at_hlc'>;
  action?: LogAction | readonly LogAction[];
  coderId?: string;
  targetId?: string;
  /**
   * Every word must appear in the entry, case and accents ignored: in its summary or action,
   * or in what `describe` says of it (the sentence the screen shows, in the reader's language).
   */
  text?: string;
  describe?: (entry: LogEntry) => string;
}

/** Lower case, accents removed (as the screens search). */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Rows read at a time while a text filter is applied. */
const SCAN = 500;

/**
 * Log entries, newest first. Bounds, actions, coder and target are applied by the database. The
 * text filter is applied while reading, page by page, so a page holds `limit` matching entries:
 * SQLite cannot compare text without case and accents, and the sentence shown is not stored.
 * Words without letters (numbers, symbols) are looked for by the database too, when there is no
 * `describe` to search.
 */
export async function listLog(ctx: ProjectContext, opts: LogQuery = {}): Promise<LogEntry[]> {
  const conds: string[] = [];
  const params: (string | number)[] = [];
  if (opts.before) {
    conds.push('(at < ? OR (at = ? AND hlc < ?))');
    params.push(opts.before.at, opts.before.at, opts.before.updated_at_hlc);
  }
  if (opts.after) {
    conds.push('(at > ? OR (at = ? AND hlc > ?))');
    params.push(opts.after.at, opts.after.at, opts.after.updated_at_hlc);
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
  const limit = Math.max(1, Math.floor(opts.limit ?? 200));
  const words = fold(opts.text ?? '').split(/\s+/).filter(Boolean);
  if (!words.length) {
    return ctx.store.list('log', { where: conds.length ? conds.join(' AND ') : undefined, params, order: 'at DESC, hlc DESC', limit });
  }
  // Without `describe`, a word can only be in the summary or the action: one with no letter has
  // no case or accent to fold, so SQLite can look for it as it is.
  if (!opts.describe) {
    for (const w of words) {
      if (/\p{L}/u.test(w)) continue;
      conds.push("instr(json_extract(data, '$.summary') || ' ' || json_extract(data, '$.action'), ?) > 0");
      params.push(w);
    }
  }
  const matches = (e: LogEntry) => {
    const hay = fold(`${e.summary}\n${e.action}${opts.describe ? `\n${opts.describe(e)}` : ''}`);
    return words.every((w) => hay.includes(w));
  };
  const out: LogEntry[] = [];
  let cursor: Pick<LogEntry, 'at' | 'updated_at_hlc'> | null = null;
  for (;;) {
    const page: LogEntry[] = await ctx.store.list('log', {
      where: [...conds, ...(cursor ? ['(at < ? OR (at = ? AND hlc < ?))'] : [])].join(' AND ') || undefined,
      params: cursor ? [...params, cursor.at, cursor.at, cursor.updated_at_hlc] : params,
      order: 'at DESC, hlc DESC',
      limit: SCAN,
    });
    for (const e of page) {
      if (!matches(e)) continue;
      out.push(e);
      if (out.length >= limit) return out;
    }
    if (page.length < SCAN) return out;
    const last = page[page.length - 1]!;
    cursor = { at: last.at, updated_at_hlc: last.updated_at_hlc };
  }
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

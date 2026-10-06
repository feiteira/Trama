// The audit trail as readable sentences. Log summaries are language-neutral (services/log.ts):
// names in double quotes, `→`, `×N`, `∅`, and `↶` / `↷` for undo and redo. This reads that
// shape back and picks a sentence template in the interface language for the action; whatever
// the template cannot say is kept as a muted detail, so nothing in the summary is lost.

import { DateTime } from 'luxon';
import { LOG_ACTIONS, type LogAction, type LogEntry } from '../../core/model/types';
import { fold } from '../../core/text/normalize';

// ---------------------------------------------------------------------------------------------
// Action groups (the filter)

export const ACTION_GROUPS = ['project', 'documents', 'codes', 'coding', 'memos', 'cases', 'groups', 'pseudonyms'] as const;
export type ActionGroup = (typeof ACTION_GROUPS)[number];

export function groupOf(action: LogAction): ActionGroup {
  const head = action.split('.')[0];
  switch (head) {
    case 'document':
      return 'documents';
    case 'code':
      return 'codes';
    case 'coding':
      return 'coding';
    case 'memo':
      return 'memos';
    case 'case':
    case 'attribute':
      return 'cases';
    case 'group':
      return 'groups';
    case 'pseudonym':
      return 'pseudonyms';
    default:
      return 'project';
  }
}

/** The actions of some groups (all of them when none is chosen). */
export function actionsOf(groups: readonly ActionGroup[]): LogAction[] {
  if (!groups.length) return [...LOG_ACTIONS];
  const want = new Set(groups);
  return LOG_ACTIONS.filter((a) => want.has(groupOf(a)));
}

// ---------------------------------------------------------------------------------------------
// Reading a summary

export interface ParsedSummary {
  /** The entry records an undo (↶) or a redo (↷) of the operation. */
  undo: 'undo' | 'redo' | null;
  /** `+ ` / `− ` in front: something added to or removed from a list (attributes). */
  op: 'add' | 'remove' | null;
  /** Names before the arrow (or the only names). */
  a: string[];
  /** Names after the arrow. */
  b: string[];
  /** The arrow led to nothing (∅). */
  none: boolean;
  /** A count (`×N`). */
  n: number | null;
  /** What is left that has no place in a template (field ids, offsets…). */
  rest: string;
}

const NAMES = /^"([^"]*)"((?:, "[^"]*")*)/;

/** Leading quoted names ("a", "b") and the text after them. */
function takeNames(s: string): { names: string[]; rest: string } {
  const m = NAMES.exec(s);
  if (!m) return { names: [], rest: s };
  const names = [m[1]!];
  if (m[2]) for (const x of m[2].matchAll(/"([^"]*)"/g)) names.push(x[1]!);
  return { names, rest: s.slice(m[0].length) };
}

export function parseSummary(summary: string): ParsedSummary {
  let s = summary.trim();
  let undo: ParsedSummary['undo'] = null;
  if (s.startsWith('↶')) undo = 'undo';
  else if (s.startsWith('↷')) undo = 'redo';
  if (undo) s = s.slice(1).trim();
  let op: ParsedSummary['op'] = null;
  if (s.startsWith('+ ')) op = 'add';
  else if (s.startsWith('− ') || s.startsWith('- ')) op = 'remove';
  if (op) s = s.slice(2).trim();

  let n: number | null = null;
  // A count alone (`×3`, `×3 (5)`), or after the names (`"Trust" ×12`).
  const alone = /^×(\d+)(?: \((\d+)\))?$/.exec(s);
  if (alone) return { undo, op, a: [], b: [], none: false, n: Number(alone[1]), rest: '' };
  // A count leading to names (`×12 → "Interview 1", "Interview 2"`).
  const lead = /^×(\d+) → /.exec(s);
  if (lead) {
    const r = takeNames(s.slice(lead[0].length));
    if (r.names.length) return { undo, op, a: [], b: r.names, none: false, n: Number(lead[1]), rest: r.rest.trim() };
  }
  const tail = / ×(\d+)$/.exec(s);
  if (tail) {
    n = Number(tail[1]);
    s = s.slice(0, tail.index);
  }

  const left = takeNames(s);
  let rest = left.rest;
  let b: string[] = [];
  let none = false;
  if (left.names.length && rest.startsWith(' → ')) {
    const right = rest.slice(3);
    if (right.startsWith('∅')) {
      none = true;
      rest = right.slice(1);
    } else {
      const r = takeNames(right);
      if (r.names.length) {
        b = r.names;
        rest = r.rest;
      }
    }
  }
  if (!left.names.length) rest = s;
  return { undo, op, a: left.names, b, none, n, rest: rest.trim() };
}

// ---------------------------------------------------------------------------------------------
// Templates

/**
 * Which sentence shapes the catalog has for an action (log.actions.<group>.<verb>.<shape>).
 * Every action has `plain`, a phrase without names. The others take {a} (names before the
 * arrow), {b} (names after it) and {n} (the count); `add…`/`remove…` are for `+`/`−` summaries.
 */
export type Shape = 'plain' | 'one' | 'two' | 'oneN' | 'twoN' | 'n' | 'nB' | 'addOne' | 'removeOne';

export const TEMPLATES: Record<LogAction, readonly Shape[]> = {
  'project.create': ['plain', 'one'],
  'project.merge': ['plain', 'one'],
  'project.import': ['plain', 'one'],
  'document.add': ['plain', 'one', 'n'],
  'document.rename': ['plain', 'two'],
  'document.edit': ['plain', 'one', 'two', 'oneN'],
  'document.delete': ['plain', 'one'],
  'document.restore': ['plain', 'one'],
  'code.create': ['plain', 'one', 'n', 'nB'],
  'code.rename': ['plain', 'two'],
  'code.edit': ['plain', 'one', 'n', 'nB'],
  'code.move': ['plain', 'one', 'two'],
  'code.merge': ['plain', 'twoN'],
  'code.split': ['plain', 'twoN'],
  'code.delete': ['plain', 'one', 'oneN'],
  'code.restore': ['plain', 'one'],
  'coding.add': ['plain', 'two'],
  'coding.remove': ['plain', 'two', 'oneN', 'n'],
  'coding.edit': ['plain', 'one', 'two'],
  'coding.autocode': ['plain', 'oneN'],
  'memo.create': ['plain', 'one'],
  'memo.edit': ['plain', 'one'],
  'memo.delete': ['plain', 'one'],
  'case.create': ['plain', 'one', 'n'],
  'case.edit': ['plain', 'one', 'two'],
  'case.delete': ['plain', 'one'],
  'attribute.edit': ['plain', 'one', 'two', 'addOne', 'removeOne'],
  'group.create': ['plain', 'one'],
  'group.edit': ['plain', 'one', 'two'],
  'group.delete': ['plain', 'one'],
  'pseudonym.apply': ['plain', 'n', 'nB'],
  export: ['plain', 'one'],
  backup: ['plain', 'one'],
  'coder.add': ['plain', 'one'],
  'coder.edit': ['plain', 'one', 'two'],
};

/** The message key of a template: `export` → log.actions.project.export.plain. */
export function templateKey(action: LogAction, shape: Shape): string {
  const [head, verb] = action.includes('.') ? action.split('.') : ['project', action];
  return `log.actions.${head}.${verb}.${shape}`;
}

export interface Sentence {
  action: LogAction;
  /** Message key of the template (log.actions.…). */
  key: string;
  shape: Shape;
  vars: { a: string[]; b: string[]; n: number | null };
  undo: 'undo' | 'redo' | null;
  /** Detail left over, already tidied (curly quotes), or null. */
  detail: string | null;
}

/** Quotation marks around names: “…” in English, «…» in Portuguese and Spanish. */
export type Quotes = readonly [string, string];
export const CURLY: Quotes = ['“', '”'];
export const quotesFor = (locale: string): Quotes => (locale === 'en' ? CURLY : ['«', '»']);

/** The reader's quotation marks for names; `∅` becomes the reader's word for "none". */
export function tidyDetail(s: string, none: string, quotes: Quotes = CURLY): string {
  return s.replace(/"([^"]*)"/g, `${quotes[0]}$1${quotes[1]}`).replace(/∅/g, none).trim();
}

// ---------------------------------------------------------------------------------------------
// Details in the reader's language
//
// Summaries keep some plain identifiers after the names: the code fields that changed
// (`"Trust": codable, color`), an attribute's type (`+ "Gender": choice`), what was exported
// (`codebook .csv`, `.qdpx (MAXQDA line endings)`, `segments ×12 → file.docx`), how many records
// an import brought. Entries are never rewritten, so these are translated when shown.

export type DetailPhrase = 'crlf' | 'password' | 'pseudonyms' | 'codebook' | 'report' | 'agreement' | 'analysis';
export type DetailCount = 'segments' | 'memos' | 'records' | 'leftOut';

export interface DetailWords {
  /** A code field id (`codable`, `color`…), or null when unknown. */
  field(id: string): string | null;
  /** An attribute type id (`choice`…), or null when unknown. */
  attrType(id: string): string | null;
  phrase(id: DetailPhrase): string;
  count(id: DetailCount, n: number): string;
}

const CODE_FIELDS = new Set(['name', 'color', 'parent_id', 'shortcut', 'codable', 'description', 'inclusion', 'exclusion', 'example', 'order']);

/** The part of a summary after its names, in the reader's words where it is a known shape. */
export function localizeRest(action: LogAction, rest: string, w: DetailWords): string {
  if (!rest) return rest;
  const colon = /^:\s*/.exec(rest);
  const body = colon ? rest.slice(colon[0].length) : rest;
  const pre = colon ? ': ' : '';
  if (action === 'code.edit') {
    const ids = body.split(/,\s*/);
    if (ids.every((id) => CODE_FIELDS.has(id))) {
      const words = ids.map((id) => w.field(id));
      if (words.every((x): x is string => !!x)) return pre + words.join(', ');
    }
    return rest;
  }
  if (action === 'attribute.edit') {
    const m = /^(\w+)(?: → (\w+))?$/.exec(body);
    if (!m) return rest;
    const a = w.attrType(m[1]!);
    const b = m[2] ? w.attrType(m[2]) : null;
    if (!a || (m[2] && !b)) return rest;
    return pre + (b ? `${a} → ${b}` : a);
  }
  if (action === 'project.import') {
    return rest.replace(/(\d+) records/, (_, n: string) => w.count('records', Number(n))).replace(/, (\d+) left out/, (_, n: string) => `, ${w.count('leftOut', Number(n))}`);
  }
  if (action === 'export') {
    let m = /^(segments|memos) ×(\d+) → (.*)$/s.exec(rest);
    if (m) return `${w.count(m[1] as 'segments' | 'memos', Number(m[2]))} → ${m[3]}`;
    m = /^(codebook|project report|agreement) (\.\w+)(.*)$/s.exec(rest);
    if (m) return `${w.phrase(m[1] === 'project report' ? 'report' : (m[1] as 'codebook' | 'agreement'))} ${m[2]}${m[3]}`;
    m = /^analysis: (.*)$/s.exec(rest);
    if (m) return `${w.phrase('analysis')}: ${m[1]}`;
    if (rest === '(pseudonyms)') return `(${w.phrase('pseudonyms')})`;
    return rest
      .replace(' (MAXQDA line endings)', ` (${w.phrase('crlf')})`)
      .replace(' (password)', ` (${w.phrase('password')})`)
      .replace(' + pseudonyms', ` + ${w.phrase('pseudonyms')}`);
  }
  return rest;
}

/** The sentence for one entry: the best template its summary fits, and what is left over. */
export function buildSentence(entry: Pick<LogEntry, 'action' | 'summary'>, none = '∅', quotes: Quotes = CURLY, words?: DetailWords): Sentence {
  const action = entry.action;
  const p = parseSummary(entry.summary);
  if (words) p.rest = localizeRest(action, p.rest, words);
  // The project's name is logged bare when it is created.
  if (action === 'project.create' && !p.a.length && p.rest && !p.rest.includes('"')) {
    p.a = [p.rest];
    p.rest = '';
  }
  const has = new Set(TEMPLATES[action] ?? ['plain']);
  const vars = { a: p.a, b: p.b, n: p.n };
  let shape = 'plain' as Shape;
  let usedN = false;
  let usedNames = false;
  const pick = (s: Shape, withN: boolean) => {
    if (!has.has(s)) return false;
    shape = s;
    usedN = withN;
    usedNames = s !== 'n' && s !== 'plain';
    return true;
  };
  // Quoted names the parser could not place (`"a" ← "b"`): no template would say it right.
  const stray = p.rest.includes('"');
  if (stray) {
    // plain
  } else if (p.op === 'add' && p.a.length) pick('addOne', false);
  else if (p.op === 'remove' && p.a.length) pick('removeOne', false);
  else if (p.a.length && p.b.length) (p.n !== null && pick('twoN', true)) || pick('two', false);
  else if (p.a.length && !p.none) (p.n !== null && pick('oneN', true)) || pick('one', false);
  else if (p.a.length && p.none) pick('one', false);
  else if (!p.a.length && p.n !== null) (p.b.length > 0 && pick('nB', true)) || pick('n', true);

  // What the template did not say becomes the detail.
  const left: string[] = [];
  const quoted = (xs: string[]) => xs.map((x) => `"${x}"`).join(', ');
  if (!usedNames) {
    if (p.a.length) left.push(p.b.length ? `${quoted(p.a)} → ${quoted(p.b)}` : quoted(p.a));
    else if (p.b.length) left.push(`→ ${quoted(p.b)}`);
  } else if (shape === 'one' && p.b.length) left.push(`→ ${quoted(p.b)}`);
  if (p.none) left.push('→ ∅');
  if (p.rest) left.push(p.rest.replace(/^:\s*/, ''));
  if (p.n !== null && !usedN) left.push(`×${p.n}`);
  const detail = left.length ? tidyDetail(left.join(' '), none, quotes) : null;
  return { action, key: templateKey(action, shape), shape, vars, undo: p.undo, detail };
}

// ---------------------------------------------------------------------------------------------
// Templates → parts the screen renders (names emphasised)

export type Part = { text: string } | { slot: 'a' | 'b' | 'n' };

/** Splits a translated template on its {a} {b} {n} slots. */
export function splitTemplate(template: string): Part[] {
  const out: Part[] = [];
  let last = 0;
  for (const m of template.matchAll(/\{(a|b|n)\}/g)) {
    if (m.index! > last) out.push({ text: template.slice(last, m.index) });
    out.push({ slot: m[1] as 'a' | 'b' | 'n' });
    last = m.index! + m[0].length;
  }
  if (last < template.length) out.push({ text: template.slice(last) });
  return out;
}

/** The sentence as plain text (for searching and copying). */
export function sentenceText(template: string, s: Sentence, fmtN: (n: number) => string = String, quotes: Quotes = CURLY): string {
  const names = (xs: string[]) => xs.map((x) => `${quotes[0]}${x}${quotes[1]}`).join(', ');
  const body = splitTemplate(template)
    .map((p) => ('text' in p ? p.text : p.slot === 'n' ? (s.vars.n === null ? '' : fmtN(s.vars.n)) : names(s.vars[p.slot])))
    .join('');
  return s.detail ? `${body} ${s.detail}` : body;
}

// ---------------------------------------------------------------------------------------------
// Days and filters

/** The local calendar day of an ISO time (yyyy-mm-dd). */
export const dayOf = (iso: string): string => DateTime.fromISO(iso).toISODate() ?? iso.slice(0, 10);

export interface Day<T> {
  day: string;
  items: T[];
}

/** Consecutive entries of the same local day, in the order given (newest first). */
export function groupByDay<T extends { at: string }>(entries: readonly T[]): Day<T>[] {
  const out: Day<T>[] = [];
  for (const e of entries) {
    const day = dayOf(e.at);
    const cur = out[out.length - 1];
    if (cur && cur.day === day) cur.items.push(e);
    else out.push({ day, items: [e] });
  }
  return out;
}

export interface LogFilter {
  groups: ActionGroup[];
  coderId: string | null;
  /** yyyy-mm-dd, inclusive, local days. */
  from: string | null;
  to: string | null;
  text: string;
}

export const EMPTY_FILTER: LogFilter = { groups: [], coderId: null, from: null, to: null, text: '' };

export const filterActive = (f: LogFilter): boolean => f.groups.length > 0 || !!f.coderId || !!f.from || !!f.to || !!f.text.trim();

/** The exclusive upper bound for listLog's `before`: the start of the day after `to`. */
export function beforeBound(to: string | null): { at: string; updated_at_hlc: string } | undefined {
  if (!to) return undefined;
  const d = DateTime.fromISO(to);
  if (!d.isValid) return undefined;
  // Log times are whole seconds (isoSeconds). No hlc sorts below '', so an entry at exactly
  // this instant is left out too.
  return { at: d.plus({ days: 1 }).startOf('day').toUTC().toISO({ suppressMilliseconds: true })!, updated_at_hlc: '' };
}

/** The lower bound for entries on or after the `from` day (yyyy-mm-dd, local time), for `listLog`. */
export function afterBound(from: string | null): { at: string; updated_at_hlc: string } | undefined {
  if (!from) return undefined;
  const d = DateTime.fromISO(from);
  if (!d.isValid) return undefined;
  // No hlc sorts below '': an entry at exactly midnight is kept.
  return { at: d.startOf('day').toUTC().toISO({ suppressMilliseconds: true })!, updated_at_hlc: '' };
}

/** Whether an entry is on or after the `from` day. */
export const onOrAfter = (iso: string, from: string | null): boolean => !from || dayOf(iso) >= from;

/** Every word of the query appears in the text (accents and case ignored). */
export function matchesText(text: string, query: string): boolean {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = fold(text);
  return words.every((w) => hay.includes(w));
}

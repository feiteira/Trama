// The code tree's view model, kept free of React so it can be tested and stays cheap: every
// function here is one pass (or close to it) over the codebook in display order, so a codebook
// of several hundred codes filters and redraws on every keystroke without effort.

import { fold } from '../../core/text/normalize';

/** One code as the tree shows it (the shape of services/queries CodeRow, flattened). */
export interface TreeItem {
  id: string;
  name: string;
  depth: number;
  color: string;
  codable: boolean;
  shortcut: number | null;
  /** Coded segments of the code itself. */
  own: number;
  /** Coded segments of the code and everything below it. */
  total: number;
  childCount: number;
}

export interface VisibleRow {
  item: TreeItem;
  /** Effective parent as displayed (null at the top level). */
  parentId: string | null;
  hasChildren: boolean;
  expanded: boolean;
  /** WAI-ARIA aria-setsize / aria-posinset among the visible siblings. */
  setSize: number;
  posInSet: number;
  /** The code's name matches the filter (ancestors shown only for context do not). */
  match: boolean;
}

export type CountMode = 'own' | 'total' | 'none';

/** Parent of each code, as the depth-first order says (orphans and cycles are already roots). */
export function parentsOf(items: readonly TreeItem[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const stack: TreeItem[] = [];
  for (const it of items) {
    while (stack.length && stack[stack.length - 1]!.depth >= it.depth) stack.pop();
    out.set(it.id, stack.length ? stack[stack.length - 1]!.id : null);
    stack.push(it);
  }
  return out;
}

/** Names from the top level down to each code. */
export function pathsOf(items: readonly TreeItem[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const stack: TreeItem[] = [];
  for (const it of items) {
    while (stack.length && stack[stack.length - 1]!.depth >= it.depth) stack.pop();
    out.set(it.id, [...stack.map((s) => s.name), it.name]);
    stack.push(it);
  }
  return out;
}

/** The ids of a code and every code below it (a contiguous run in display order). */
export function subtreeIds(items: readonly TreeItem[], id: string): Set<string> {
  const out = new Set<string>();
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return out;
  out.add(id);
  const depth = items[i]!.depth;
  for (let j = i + 1; j < items.length && items[j]!.depth > depth; j++) out.add(items[j]!.id);
  return out;
}

export interface FilterResult {
  /** Codes to show: the matches and their ancestors. */
  visible: Set<string>;
  matches: Set<string>;
}

/**
 * Codes whose name contains every word of `query` (accents and case ignored), with their
 * ancestors kept so each match is seen in its place. Null when there is no query.
 */
export function filterTree(items: readonly TreeItem[], query: string): FilterResult | null {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return null;
  const visible = new Set<string>();
  const matches = new Set<string>();
  const stack: TreeItem[] = [];
  for (const it of items) {
    while (stack.length && stack[stack.length - 1]!.depth >= it.depth) stack.pop();
    const name = fold(it.name);
    if (words.every((w) => name.includes(w))) {
      matches.add(it.id);
      visible.add(it.id);
      for (const a of stack) visible.add(a.id);
    }
    stack.push(it);
  }
  return { visible, matches };
}

/**
 * The rows on screen: collapsed branches hidden, or — while filtering — the matches with their
 * ancestors, every branch open.
 */
export function visibleRows(items: readonly TreeItem[], collapsed: ReadonlySet<string>, filter: FilterResult | null): VisibleRow[] {
  const parents = parentsOf(items);
  const rows: VisibleRow[] = [];
  // Index (in display order) of each code's children among the rows shown: for setsize/posinset.
  const siblings = new Map<string | null, VisibleRow[]>();
  let hideBelow = Infinity; // depth under which rows are inside a collapsed branch
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (it.depth > hideBelow) continue;
    hideBelow = Infinity;
    if (filter && !filter.visible.has(it.id)) continue;
    const next = items[i + 1];
    const hasChildren = next !== undefined && next.depth > it.depth;
    const expanded = hasChildren && (filter ? true : !collapsed.has(it.id));
    const parentId = parents.get(it.id) ?? null;
    const row: VisibleRow = { item: it, parentId, hasChildren, expanded, setSize: 0, posInSet: 0, match: filter ? filter.matches.has(it.id) : false };
    rows.push(row);
    const list = siblings.get(parentId);
    if (list) list.push(row);
    else siblings.set(parentId, [row]);
    if (hasChildren && !expanded) hideBelow = it.depth;
  }
  for (const list of siblings.values()) {
    list.forEach((r, i) => {
      r.setSize = list.length;
      r.posInSet = i + 1;
    });
  }
  return rows;
}

/** Codes that have children (what "collapse all" folds). */
export function branchIds(items: readonly TreeItem[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < items.length - 1; i++) if (items[i + 1]!.depth > items[i]!.depth) out.push(items[i]!.id);
  return out;
}

export function countOf(item: TreeItem, mode: CountMode): number | null {
  return mode === 'none' ? null : mode === 'own' ? item.own : item.total;
}

// ---------------------------------------------------------------------------------------------
// Keyboard

export type TreeMove =
  | { kind: 'focus'; index: number }
  | { kind: 'expand'; id: string }
  | { kind: 'collapse'; id: string }
  | { kind: 'none' };

/** The WAI-ARIA tree pattern's arrow keys, Home and End. */
export function treeKeyMove(key: string, rows: readonly VisibleRow[], index: number): TreeMove {
  if (!rows.length) return { kind: 'none' };
  const at = Math.max(0, Math.min(rows.length - 1, index));
  const row = rows[at]!;
  switch (key) {
    case 'ArrowDown':
      return { kind: 'focus', index: Math.min(rows.length - 1, index < 0 ? 0 : at + 1) };
    case 'ArrowUp':
      return { kind: 'focus', index: index < 0 ? 0 : Math.max(0, at - 1) };
    case 'Home':
      return { kind: 'focus', index: 0 };
    case 'End':
      return { kind: 'focus', index: rows.length - 1 };
    case 'ArrowRight':
      if (row.hasChildren && !row.expanded) return { kind: 'expand', id: row.item.id };
      if (row.hasChildren && row.expanded && at + 1 < rows.length) return { kind: 'focus', index: at + 1 };
      return { kind: 'none' };
    case 'ArrowLeft': {
      if (row.hasChildren && row.expanded) return { kind: 'collapse', id: row.item.id };
      if (row.parentId === null) return { kind: 'none' };
      for (let j = at - 1; j >= 0; j--) if (rows[j]!.item.id === row.parentId) return { kind: 'focus', index: j };
      return { kind: 'none' };
    }
    default:
      return { kind: 'none' };
  }
}

/**
 * Type-ahead: the next row (after `from`, wrapping) whose name starts with `typed`. While the
 * researcher keeps typing a longer prefix, the current row may still match and stays.
 */
export function typeAhead(rows: readonly { item: { name: string } }[], from: number, typed: string): number {
  const prefix = fold(typed);
  if (!prefix || !rows.length) return -1;
  const n = rows.length;
  // A single repeated letter cycles through the rows starting with it.
  const cycling = prefix.length > 1 && [...prefix].every((c) => c === prefix[0]);
  const needle = cycling ? prefix[0]! : prefix;
  const startOffset = prefix.length === 1 || cycling ? 1 : 0;
  for (let k = 0; k < n; k++) {
    const i = (((from < 0 ? 0 : from) + startOffset + k) % n + n) % n;
    if (fold(rows[i]!.item.name).startsWith(needle)) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------------------------
// Drag and drop

export type DropZone = 'before' | 'inside' | 'after';

/** Where over a row the pointer is: the top quarter puts it before, the bottom after. */
export function dropZone(offsetY: number, height: number): DropZone {
  if (height <= 0) return 'inside';
  const f = offsetY / height;
  if (f < 0.28) return 'before';
  if (f > 0.72) return 'after';
  return 'inside';
}

export type DropResult =
  | { ok: true; parentId: string | null; beforeId: string | null }
  | { ok: false; reason: 'self' | 'cycle' | 'noop' };

/**
 * Where a code dragged onto a row goes, as services/codes.moveCode wants it: a parent and the
 * sibling to sit before (null: last). Dropping a code into itself or its own branch is refused.
 */
export function resolveDrop(rows: readonly VisibleRow[], items: readonly TreeItem[], dragId: string, targetId: string, zone: DropZone): DropResult {
  if (dragId === targetId) return { ok: false, reason: 'self' };
  const branch = subtreeIds(items, dragId);
  if (branch.has(targetId)) return { ok: false, reason: 'cycle' };
  const ti = rows.findIndex((r) => r.item.id === targetId);
  if (ti < 0) return { ok: false, reason: 'noop' };
  const target = rows[ti]!;
  const parents = parentsOf(items);
  let parentId: string | null;
  let beforeId: string | null;
  if (zone === 'inside') {
    parentId = targetId;
    beforeId = null;
  } else if (zone === 'before') {
    parentId = target.parentId;
    beforeId = targetId;
  } else if (target.hasChildren && target.expanded) {
    // Just below an open branch: the first of its children.
    parentId = targetId;
    beforeId = rows[ti + 1]?.parentId === targetId ? rows[ti + 1]!.item.id : null;
  } else {
    parentId = target.parentId;
    beforeId = nextSibling(items, parents, targetId);
  }
  if (beforeId === dragId) beforeId = nextSibling(items, parents, dragId);
  // Where it already is: nothing to write.
  if ((parents.get(dragId) ?? null) === parentId && nextSibling(items, parents, dragId) === beforeId) return { ok: false, reason: 'noop' };
  return { ok: true, parentId, beforeId };
}

function nextSibling(items: readonly TreeItem[], parents: Map<string, string | null>, id: string): string | null {
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const depth = items[i]!.depth;
  const parent = parents.get(id) ?? null;
  for (let j = i + 1; j < items.length; j++) {
    const d = items[j]!.depth;
    if (d < depth) return null;
    if (d === depth) return (parents.get(items[j]!.id) ?? null) === parent ? items[j]!.id : null;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Pickers

export interface CodeChoice {
  id: string;
  name: string;
  /** "Parent › Child" for display and search. */
  path: string;
  depth: number;
  color: string;
  codable: boolean;
}

/**
 * Codes to choose from (a merge target, a new parent), in tree order. `exclude` leaves out
 * those codes — and, with `excludeBranches`, everything below them too.
 */
export function codeChoices(items: readonly TreeItem[], exclude: Iterable<string> = [], opts: { excludeBranches?: boolean } = {}): CodeChoice[] {
  const paths = pathsOf(items);
  const skip = new Set<string>();
  for (const id of exclude) {
    if (opts.excludeBranches) for (const x of subtreeIds(items, id)) skip.add(x);
    else skip.add(id);
  }
  return items
    .filter((it) => !skip.has(it.id))
    .map((it) => ({ id: it.id, name: it.name, path: paths.get(it.id)!.join(' › '), depth: it.depth, color: it.color, codable: it.codable }));
}

/** Choices whose path contains every word of `query`. */
export function filterChoices(choices: readonly CodeChoice[], query: string): CodeChoice[] {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return choices.slice();
  return choices.filter((c) => {
    const p = fold(c.path);
    return words.every((w) => p.includes(w));
  });
}

/** Character ranges of `name` that match the words of `query` (accents and case ignored). */
export function matchRanges(name: string, query: string): [number, number][] {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  let folded = '';
  const from: number[] = [];
  for (let i = 0; i < name.length; i++) {
    const ch = name[i]!;
    const f = /\s/.test(ch) ? ' ' : ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (let k = 0; k < f.length; k++) {
      folded += f[k];
      from.push(i);
    }
  }
  const ranges: [number, number][] = [];
  for (const w of words) {
    const at = folded.indexOf(w);
    if (at >= 0) ranges.push([from[at]!, from[at + w.length - 1]! + 1]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

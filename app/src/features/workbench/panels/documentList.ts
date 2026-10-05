// The documents panel's view model: filtering, sorting, sections by group or case, range
// selection and where a drag puts documents. Pure, so a project of hundreds of documents
// re-sorts on every keystroke without effort, and it is tested in Node.

import type { DocKind } from '../../../core/model/types';
import { fold } from '../../../core/text/normalize';

/** Documents dragged from the list (JSON array of ids). */
export const DOCS_MIME = 'application/x-trama-documents';

export const SORTS = ['manual', 'name', 'coded', 'recent'] as const;
export type DocSort = (typeof SORTS)[number];
export const GROUPINGS = ['all', 'group', 'case'] as const;
export type DocGrouping = (typeof GROUPINGS)[number];

/** What the list needs of a document (services/queries DocumentRow, flattened). */
export interface DocItem {
  id: string;
  name: string;
  kind: DocKind;
  codings: number;
  caseId: string | null;
  caseName: string | null;
  groupIds: string[];
  groupNames: string[];
  color: string | null;
  order: number;
  /** When it was added (ISO): `source.imported_at`, else `created_at`. */
  addedAt: string;
  filename: string;
}

export interface Section {
  /** 'all', a group id, a case id, or 'none' (no group / no case). */
  key: string;
  kind: 'all' | 'group' | 'case' | 'none';
  title: string | null;
  color: string | null;
  items: DocItem[];
}

/** Documents whose name, case, groups or file name contain every word of `query`. */
export function filterDocs(items: readonly DocItem[], query: string): DocItem[] {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return items.slice();
  return items.filter((d) => {
    const hay = fold([d.name, d.caseName ?? '', ...d.groupNames, d.filename].join(' \u0001 '));
    return words.every((w) => hay.includes(w));
  });
}

export function sortDocs(items: readonly DocItem[], sort: DocSort, locale: string): DocItem[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const byOrder = (a: DocItem, b: DocItem) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const list = items.slice();
  switch (sort) {
    case 'name':
      return list.sort((a, b) => collator.compare(a.name, b.name) || byOrder(a, b));
    case 'coded':
      return list.sort((a, b) => b.codings - a.codings || byOrder(a, b));
    case 'recent':
      return list.sort((a, b) => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0) || byOrder(a, b));
    default:
      return list.sort(byOrder);
  }
}

/**
 * Sections of an already sorted list. By group, a document in two groups shows in both; by
 * case, each document once. Empty groups and cases are left out; documents without one come
 * last, under `noneTitle`.
 */
export function sectionDocs(
  items: readonly DocItem[],
  grouping: DocGrouping,
  groups: readonly { id: string; name: string; color: string }[],
  cases: readonly { id: string; name: string; color: string | null }[],
  noneTitle: string,
  locale: string,
): Section[] {
  if (grouping === 'all') return [{ key: 'all', kind: 'all', title: null, color: null, items: items.slice() }];
  const buckets = new Map<string, DocItem[]>();
  const none: DocItem[] = [];
  for (const d of items) {
    const keys = grouping === 'group' ? d.groupIds : d.caseId ? [d.caseId] : [];
    if (!keys.length) none.push(d);
    for (const k of keys) {
      const b = buckets.get(k);
      if (b) b.push(d);
      else buckets.set(k, [d]);
    }
  }
  const out: Section[] = [];
  if (grouping === 'group') {
    for (const g of groups) {
      const b = buckets.get(g.id);
      if (b?.length) out.push({ key: g.id, kind: 'group', title: g.name, color: g.color, items: b });
    }
  } else {
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    for (const c of [...cases].sort((a, b) => collator.compare(a.name, b.name))) {
      const b = buckets.get(c.id);
      if (b?.length) out.push({ key: c.id, kind: 'case', title: c.name, color: c.color, items: b });
    }
  }
  if (none.length) out.push({ key: 'none', kind: 'none', title: noneTitle, color: null, items: none });
  return out;
}

/** Visible document ids in display order, each once (a document in two groups counts once). */
export function displayOrder(sections: readonly Section[], collapsed: ReadonlySet<string> = new Set()): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of sections) {
    if (collapsed.has(s.key)) continue;
    for (const d of s.items) {
      if (!seen.has(d.id)) {
        seen.add(d.id);
        out.push(d.id);
      }
    }
  }
  return out;
}

/** The ids from `anchor` to `to` (inclusive) in display order, for Shift+click. */
export function rangeIds(order: readonly string[], anchor: string | null, to: string): string[] {
  const b = order.indexOf(to);
  if (b < 0) return [];
  const a = anchor ? order.indexOf(anchor) : -1;
  if (a < 0) return [to];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return order.slice(lo, hi + 1);
}

/**
 * Where dropping `dragged` documents over `targetId` (above or below it) puts them, as the
 * sibling they go before (null: the end). `order` is the full manual order. Dragged documents
 * keep their relative order. Null when nothing would move.
 */
export function reorderPlan(order: readonly string[], dragged: readonly string[], targetId: string, below: boolean): { beforeId: string | null; ids: string[] } | null {
  const moving = new Set(dragged);
  const ids = order.filter((id) => moving.has(id));
  if (!ids.length) return null;
  const at = order.indexOf(targetId);
  if (at < 0) return null;
  let i = below ? at + 1 : at;
  while (i < order.length && moving.has(order[i]!)) i++;
  const beforeId = order[i] ?? null;
  // Already there: the dragged documents are contiguous right before `beforeId`.
  const rest = order.filter((id) => !moving.has(id));
  const insertAt = beforeId === null ? rest.length : rest.indexOf(beforeId);
  const next = [...rest.slice(0, insertAt), ...ids, ...rest.slice(insertAt)];
  if (next.every((id, k) => id === order[k])) return null;
  return { beforeId, ids };
}

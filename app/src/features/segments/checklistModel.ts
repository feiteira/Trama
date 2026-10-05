// Rows a checklist shows: tree order with collapsed branches hidden, or, while searching,
// the matching items together with their ancestors (dimmed) so a sub-code keeps its place.

import { fold } from '../../core/text/normalize';

export interface ChecklistItem {
  id: string;
  label: string;
  /** Tree depth (0 at the root); items must come in tree order (parents before children). */
  depth?: number;
  color?: string | null;
  count?: number;
}

export interface ChecklistRow {
  item: ChecklistItem;
  hasChildren: boolean;
  collapsed: boolean;
  /** Shown only as the ancestor of a match. */
  dim: boolean;
  /** Index of the parent among the visible rows, -1 at the root. */
  parentIndex: number;
  /** Every item below this one (to show a partly ticked branch). */
  descendantIds: string[];
}

/** `query` must already be folded (core/text/normalize fold). */
export function visibleRows(items: readonly ChecklistItem[], query: string, collapsed: ReadonlySet<string>): ChecklistRow[] {
  const n = items.length;
  const depth = (i: number) => items[i]!.depth ?? 0;
  // Parent of each item by depth, and the end of each item's subtree.
  const parent = new Int32Array(n).fill(-1);
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    while (stack.length && depth(stack[stack.length - 1]!) >= depth(i)) stack.pop();
    parent[i] = stack.length ? stack[stack.length - 1]! : -1;
    stack.push(i);
  }
  const subtreeEnd = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let j = i + 1;
    while (j < n && depth(j) > depth(i)) j++;
    subtreeEnd[i] = j;
  }
  const descendants = (i: number) => items.slice(i + 1, subtreeEnd[i]).map((x) => x.id);

  let show: boolean[];
  let dim: boolean[];
  if (query) {
    const words = query.split(' ').filter(Boolean);
    const hit = items.map((it) => {
      const label = fold(it.label);
      return words.every((w) => label.includes(w));
    });
    show = hit.slice();
    dim = items.map(() => false);
    for (let i = 0; i < n; i++) {
      if (!hit[i]) continue;
      for (let p = parent[i]!; p >= 0 && !show[p]; p = parent[p]!) {
        show[p] = true;
        dim[p] = true;
      }
    }
  } else {
    show = items.map(() => true);
    dim = items.map(() => false);
    for (let i = 0; i < n; i++) {
      if (!show[i]) continue;
      if (collapsed.has(items[i]!.id)) for (let j = i + 1; j < subtreeEnd[i]!; j++) show[j] = false;
    }
  }

  const rowIndex = new Int32Array(n).fill(-1);
  const out: ChecklistRow[] = [];
  for (let i = 0; i < n; i++) {
    if (!show[i]) continue;
    rowIndex[i] = out.length;
    const p = parent[i]!;
    out.push({
      item: items[i]!,
      hasChildren: subtreeEnd[i]! > i + 1,
      collapsed: !query && collapsed.has(items[i]!.id),
      dim: dim[i]!,
      parentIndex: p >= 0 ? rowIndex[p]! : -1,
      descendantIds: subtreeEnd[i]! > i + 1 ? descendants(i) : [],
    });
  }
  return out;
}

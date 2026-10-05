// The code tree (codebook hierarchy) as pure data. Codes point to their parent; a merge with a
// teammate's copy can leave a code whose parent was deleted, or even two codes pointing to each
// other. Both are shown rather than lost: orphans and cycle members are placed at the root.

export interface TreeCode {
  id: string;
  parent_id: string | null;
  order: number;
  name: string;
}

export interface TreeNode<T extends TreeCode> {
  code: T;
  depth: number;
  children: TreeNode<T>[];
}

export interface Counts {
  /** Count for the code itself. */
  own: number;
  /** Count for the code and all its descendants. */
  total: number;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Sibling order: `order`, then name, then id (so ties are stable across devices). */
export function compareSiblings(a: TreeCode, b: TreeCode): number {
  return a.order - b.order || collator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export interface CodeTree<T extends TreeCode> {
  roots: TreeNode<T>[];
  get(id: string): TreeNode<T> | undefined;
  /** Children of a code (or of the root, for null), in order. */
  childrenOf(id: string | null): T[];
  /** Every code below `id`, depth first in display order (not including `id`). */
  descendants(id: string): T[];
  /** From the parent up to the root (as displayed: orphans have no ancestors). */
  ancestors(id: string): T[];
  /** Names from the root down to the code itself. */
  path(id: string): string[];
  /** Whether moving `id` under `newParent` would make it its own ancestor. */
  wouldCycle(id: string, newParent: string | null): boolean;
  /** Every code in display order with its depth (0 at the root). */
  flatten(): { code: T; depth: number }[];
  /** Sums per-code counts up the tree. Codes missing from `own` count 0. */
  aggregate(own: ReadonlyMap<string, number>): Map<string, Counts>;
  /** Unions per-code sets up the tree (e.g. documents a code or its children appear in). */
  aggregateSets<V>(own: ReadonlyMap<string, ReadonlySet<V>>): Map<string, Set<V>>;
}

export function buildTree<T extends TreeCode>(codes: readonly T[]): CodeTree<T> {
  const nodes = new Map<string, TreeNode<T>>();
  for (const c of codes) if (!nodes.has(c.id)) nodes.set(c.id, { code: c, depth: 0, children: [] });

  // Effective parent: the stored one when it exists and does not lead into a cycle.
  const parentOf = new Map<string, string | null>();
  for (const n of nodes.values()) {
    const p = n.code.parent_id;
    parentOf.set(n.code.id, p !== null && p !== n.code.id && nodes.has(p) ? p : null);
  }
  // Break cycles: walk up from each code; a code met twice on one walk is in a cycle, and the
  // first in sibling order among the cycle's members becomes a root.
  const settled = new Set<string>();
  for (const id of nodes.keys()) {
    const trail: string[] = [];
    const onTrail = new Set<string>();
    let cur: string | null = id;
    while (cur !== null && !settled.has(cur)) {
      if (onTrail.has(cur)) {
        const cycle = trail.slice(trail.indexOf(cur)).map((x) => nodes.get(x)!.code);
        cycle.sort(compareSiblings);
        parentOf.set(cycle[0]!.id, null);
        break;
      }
      trail.push(cur);
      onTrail.add(cur);
      cur = parentOf.get(cur) ?? null;
    }
    for (const t of trail) settled.add(t);
  }

  const roots: TreeNode<T>[] = [];
  for (const n of nodes.values()) {
    const p = parentOf.get(n.code.id) ?? null;
    if (p === null) roots.push(n);
    else nodes.get(p)!.children.push(n);
  }
  const byOrder = (a: TreeNode<T>, b: TreeNode<T>) => compareSiblings(a.code, b.code);
  const flat: { code: T; depth: number }[] = [];
  // Iterative depth-first walk: deep hierarchies must not overflow the stack.
  roots.sort(byOrder);
  const stack: TreeNode<T>[] = [...roots].reverse();
  while (stack.length) {
    const n = stack.pop()!;
    const p = parentOf.get(n.code.id) ?? null;
    n.depth = p === null ? 0 : nodes.get(p)!.depth + 1;
    flat.push({ code: n.code, depth: n.depth });
    n.children.sort(byOrder);
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]!);
  }
  const index = new Map(flat.map((f, i) => [f.code.id, i]));

  const descendants = (id: string): T[] => {
    const i = index.get(id);
    if (i === undefined) return [];
    const depth = flat[i]!.depth;
    const out: T[] = [];
    for (let j = i + 1; j < flat.length && flat[j]!.depth > depth; j++) out.push(flat[j]!.code);
    return out;
  };

  const ancestors = (id: string): T[] => {
    const out: T[] = [];
    let p = parentOf.get(id) ?? null;
    while (p !== null) {
      out.push(nodes.get(p)!.code);
      p = parentOf.get(p) ?? null;
    }
    return out;
  };

  return {
    roots,
    get: (id) => nodes.get(id),
    childrenOf: (id) => (id === null ? roots : nodes.get(id)?.children ?? []).map((n) => n.code),
    descendants,
    ancestors,
    path: (id) => {
      const n = nodes.get(id);
      return n ? [...ancestors(id).reverse().map((c) => c.name), n.code.name] : [];
    },
    wouldCycle: (id, newParent) => {
      if (newParent === null) return false;
      if (newParent === id) return true;
      return ancestors(newParent).some((c) => c.id === id);
    },
    flatten: () => flat.slice(),
    aggregate: (own) => {
      const out = new Map<string, Counts>();
      // Children come after their parent in `flat`: walk backwards so children are done first.
      for (let i = flat.length - 1; i >= 0; i--) {
        const n = nodes.get(flat[i]!.code.id)!;
        const o = own.get(n.code.id) ?? 0;
        let total = o;
        for (const c of n.children) total += out.get(c.code.id)!.total;
        out.set(n.code.id, { own: o, total });
      }
      return out;
    },
    aggregateSets: <V>(own: ReadonlyMap<string, ReadonlySet<V>>) => {
      const out = new Map<string, Set<V>>();
      for (let i = flat.length - 1; i >= 0; i--) {
        const n = nodes.get(flat[i]!.code.id)!;
        const set = new Set<V>(own.get(n.code.id) ?? []);
        for (const c of n.children) for (const v of out.get(c.code.id)!) set.add(v);
        out.set(n.code.id, set);
      }
      return out;
    },
  };
}

/**
 * Where to put an item so it sits just before `beforeId` among `siblings` (or last, for null),
 * using fractional ordering so only the moved item is written. When the gap is too small to
 * split (after many moves, or imported items sharing an order), every sibling is renumbered:
 * `renumber` then holds the new order of each sibling, the moved item included.
 */
export function placeBefore<T extends { id: string; order: number }>(
  siblings: readonly T[],
  movingId: string,
  beforeId: string | null,
): { order: number; renumber: Map<string, number> | null } {
  const list = [...siblings].filter((s) => s.id !== movingId).sort((a, b) => a.order - b.order);
  let idx = beforeId === null ? list.length : list.findIndex((s) => s.id === beforeId);
  if (idx < 0) idx = list.length;
  const prev = list[idx - 1]?.order;
  const next = list[idx]?.order;
  let order: number;
  if (prev === undefined && next === undefined) order = 1;
  else if (prev === undefined) order = next! - 1;
  else if (next === undefined) order = prev + 1;
  else order = (prev + next) / 2;
  const ok = Number.isFinite(order) && (prev === undefined || order > prev) && (next === undefined || order < next);
  if (ok) return { order, renumber: null };
  const renumber = new Map<string, number>();
  const ordered = [...list.slice(0, idx).map((s) => s.id), movingId, ...list.slice(idx).map((s) => s.id)];
  ordered.forEach((id, i) => renumber.set(id, i + 1));
  return { order: renumber.get(movingId)!, renumber };
}

/** The order for a new item placed after all `siblings`. */
export function orderAfterLast(siblings: readonly { order: number }[]): number {
  let max = 0;
  for (const s of siblings) if (Number.isFinite(s.order) && s.order > max) max = s.order;
  return Math.floor(max) + 1;
}

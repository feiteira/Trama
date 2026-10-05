// The codebook as rows of an analysis table: tree order, depth for indentation, collapsible
// branches, and the default choice of codes for a co-occurrence query.

import type { Code } from '../../../core/model/types';

export interface CodeLine {
  id: string;
  name: string;
  color: string;
  depth: number;
  parentId: string | null;
  hasChildren: boolean;
  codable: boolean;
  /** Names from the root down to the code ("Wellbeing › Belonging"). */
  path: string[];
}

/** Rows from a flattened tree (core/qda/tree.ts `flatten()`), in display order. */
export function codeLines(flat: readonly { code: Code; depth: number }[]): CodeLine[] {
  const out: CodeLine[] = [];
  const stack: string[] = [];
  flat.forEach(({ code, depth }, i) => {
    stack.length = depth;
    stack.push(code.name);
    const next = flat[i + 1];
    out.push({
      id: code.id,
      name: code.name,
      color: code.color,
      depth,
      parentId: depth === 0 ? null : code.parent_id,
      hasChildren: !!next && next.depth > depth,
      codable: code.codable,
      path: [...stack],
    });
  });
  return out;
}

/** The rows left once the descendants of every collapsed code are hidden. */
export function visibleLines<T extends { id: string; depth: number }>(lines: readonly T[], collapsed: ReadonlySet<string>): T[] {
  if (!collapsed.size) return lines.slice();
  const out: T[] = [];
  let hideBelow = Infinity;
  for (const l of lines) {
    if (l.depth > hideBelow) continue;
    hideBelow = Infinity;
    out.push(l);
    if (collapsed.has(l.id)) hideBelow = l.depth;
  }
  return out;
}

/**
 * Codes offered by default for co-occurrence: codable codes with segments, the `max` most used,
 * kept in codebook order (a matrix in codebook order reads like the codebook).
 */
export function defaultCodeSelection(lines: readonly CodeLine[], segments: ReadonlyMap<string, number>, max = 40): string[] {
  const used = lines.filter((l) => l.codable && (segments.get(l.id) ?? 0) > 0);
  if (used.length <= max) return used.map((l) => l.id);
  const keep = new Set(
    [...used]
      .map((l, i) => ({ l, i }))
      .sort((a, b) => (segments.get(b.l.id) ?? 0) - (segments.get(a.l.id) ?? 0) || a.i - b.i)
      .slice(0, max)
      .map((x) => x.l.id),
  );
  return used.filter((l) => keep.has(l.id)).map((l) => l.id);
}

/** Ids kept in codebook order, dropping ids no longer in the codebook. */
export function inCodebookOrder(lines: readonly { id: string }[], ids: Iterable<string>): string[] {
  const want = new Set(ids);
  return lines.filter((l) => want.has(l.id)).map((l) => l.id);
}

/** Segments per code (own codings only). */
export function segmentCounts(codings: readonly { code_id: string; deleted?: boolean }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of codings) if (!c.deleted) m.set(c.code_id, (m.get(c.code_id) ?? 0) + 1);
  return m;
}

import type { Code } from '../../../core/model/types';
import { buildTree } from '../../../core/qda/tree';
import { fold } from '../../../core/text/normalize';

// Finding a code to apply from the coding popover: type a few letters of its name (or of a
// parent's name), accents and case ignored.

export interface CodeOption {
  id: string;
  name: string;
  color: string;
  /** Names of the ancestors, root first. */
  path: string[];
  codable: boolean;
  shortcut: number | null;
  depth: number;
}

/** Every live code in codebook order with its path. */
export function codeOptions(codes: readonly Code[]): CodeOption[] {
  const tree = buildTree(codes.filter((c) => !c.deleted));
  return tree.flatten().map(({ code, depth }) => ({
    id: code.id,
    name: code.name,
    color: code.color,
    path: tree.path(code.id).slice(0, -1),
    codable: code.codable,
    shortcut: code.shortcut,
    depth,
  }));
}

function score(o: CodeOption, words: string[]): number {
  const name = fold(o.name);
  const path = fold(o.path.join(' '));
  let total = 0;
  for (const w of words) {
    let best = 0;
    if (name === w) best = 120;
    else if (name.startsWith(w)) best = 100;
    else if (name.includes(` ${w}`) || name.includes(`-${w}`)) best = 70;
    else if (name.includes(w)) best = 45;
    else if (path.includes(w)) best = 20;
    if (!best) return 0;
    total += best;
  }
  return total;
}

/** Codable codes matching `query`, best first (codebook order breaks ties). */
export function searchCodes(options: readonly CodeOption[], query: string, limit = 50): CodeOption[] {
  const words = fold(query).split(' ').filter(Boolean);
  const codable = options.filter((o) => o.codable);
  if (!words.length) return codable.slice(0, limit);
  return codable
    .map((o, i) => ({ o, i, s: score(o, words) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.o);
}

/** A code whose name is exactly `query` (accents and case ignored), codable or not. */
export function exactCode(options: readonly CodeOption[], query: string): CodeOption | undefined {
  const q = fold(query);
  return q ? options.find((o) => fold(o.name) === q) : undefined;
}

/** The codes with a favourite key, by key. */
export function favourites(options: readonly CodeOption[]): CodeOption[] {
  return options.filter((o) => o.codable && o.shortcut !== null && o.shortcut >= 1 && o.shortcut <= 9).sort((a, b) => a.shortcut! - b.shortcut!);
}

/** Recently used codes that still exist and can be applied, most recent first. */
export function recentCodes(options: readonly CodeOption[], recentIds: readonly string[], limit = 5): CodeOption[] {
  const byId = new Map(options.map((o) => [o.id, o]));
  const out: CodeOption[] = [];
  for (const id of recentIds) {
    const o = byId.get(id);
    if (o && o.codable && !out.includes(o)) out.push(o);
    if (out.length >= limit) break;
  }
  return out;
}

/** `recent` with `id` moved to the front, at most `max` long. */
export function pushRecent(recent: readonly string[], id: string, max = 12): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, max);
}

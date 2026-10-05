// The pseudonymisation key as data: numbered replacements for suggestions, the CSV of the key,
// and preview samples split for highlighting. Pure.

import type { Pseudonym } from '../../core/model/types';
import { fold } from '../../core/text/normalize';

/** The pattern with {n} replaced, or the pattern followed by the number when it has no {n}. */
export function fillPattern(pattern: string, n: number): string {
  const p = pattern.trim() || '[{n}]';
  return p.includes('{n}') ? p.split('{n}').join(String(n)) : `${p} ${n}`;
}

/**
 * The first number not used yet by a replacement following the pattern, so a second round of
 * suggestions goes on from "[Participant 4]" instead of reusing "[Participant 1]".
 */
export function nextNumber(pattern: string, existing: readonly string[]): number {
  const p = pattern.trim() || '[{n}]';
  const [before, after] = p.includes('{n}') ? [p.slice(0, p.indexOf('{n}')), p.slice(p.indexOf('{n}') + 3)] : [`${p} `, ''];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${esc(before)}(\\d+)${esc(after)}$`, 'i');
  let max = 0;
  for (const r of existing) {
    const m = re.exec(r.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** Replacements for `count` new entries, numbered on from the existing ones. */
export function numberedReplacements(pattern: string, count: number, existing: readonly string[]): string[] {
  const start = nextNumber(pattern, existing);
  return Array.from({ length: count }, (_, i) => fillPattern(pattern, start + i));
}

export interface KeyHeaders {
  original: string;
  replacement: string;
  wholeWord: string;
  caseSensitive: string;
  note: string;
  appliedAt: string;
  appliedCount: string;
}

/** The key as table rows for CSV, sorted by original. */
export function keyRows(entries: readonly Pseudonym[], h: KeyHeaders, yes: string, no: string): string[][] {
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const sorted = [...entries].sort((a, b) => collator.compare(a.original, b.original));
  return [
    [h.original, h.replacement, h.wholeWord, h.caseSensitive, h.note, h.appliedAt, h.appliedCount],
    ...sorted.map((p) => [p.original, p.replacement, p.whole_word ? yes : no, p.case_sensitive ? yes : no, p.note, p.applied_at ?? '', String(p.applied_count)]),
  ];
}

/** Whether an original is already in the key (spaces and Unicode form ignored, as the service does). */
export function inKey(original: string, entries: readonly Pick<Pseudonym, 'id' | 'original'>[], exceptId?: string): boolean {
  const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
  const k = norm(original);
  return !!k && entries.some((e) => e.id !== exceptId && norm(e.original) === k);
}

/** A context sample trimmed to whole words at its outer ends, with an ellipsis where cut. */
export function trimContext(before: string, after: string): { before: string; after: string } {
  const b = before.replace(/\s+/g, ' ');
  const a = after.replace(/\s+/g, ' ');
  const cutB = b.length >= 40 && /\S/.test(b[0] ?? '') ? b.replace(/^\S*\s/, '') : b;
  const cutA = a.length >= 40 && /\S/.test(a[a.length - 1] ?? '') ? a.replace(/\s\S*$/, '') : a;
  return { before: (cutB !== b ? '…' : '') + cutB, after: cutA + (cutA !== a ? '…' : '') };
}

/** Suggestions in a review list: filter by text (accents and case ignored). */
export function filterCandidates<T extends { text: string }>(list: readonly T[], query: string): T[] {
  const q = fold(query);
  return q ? list.filter((c) => fold(c.text).includes(q)) : [...list];
}

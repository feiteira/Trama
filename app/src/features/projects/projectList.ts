import { fold } from '../../core/text/normalize';
import type { ProjectInfo } from '../../services/project';

// Ordering and finding projects on the library screen. Pure, tested in Node.

export const PROJECT_SORTS = ['recent', 'name', 'created'] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];

/** Projects whose name or description contains every word of `query` (accents and case ignored). */
export function filterProjects(list: readonly ProjectInfo[], query: string): ProjectInfo[] {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return [...list];
  return list.filter((p) => {
    const hay = fold(`${p.name} ${p.description}`);
    return words.every((w) => hay.includes(w));
  });
}

/**
 * `recent`: last opened first, never-opened ones after by creation (newest first); `name`: by the
 * reader's collation (accents and numbers sorted naturally); `created`: newest first. Ties fall
 * back to the name, then the id, so the order is stable.
 */
export function sortProjects(list: readonly ProjectInfo[], by: ProjectSort, bcp47 = 'en'): ProjectInfo[] {
  const collator = new Intl.Collator(bcp47, { sensitivity: 'base', numeric: true });
  const byName = (a: ProjectInfo, b: ProjectInfo) => collator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const desc = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? 1 : -1);
  const out = [...list];
  switch (by) {
    case 'name':
      return out.sort(byName);
    case 'created':
      return out.sort((a, b) => desc(a.created_at, b.created_at) || byName(a, b));
    case 'recent':
      return out.sort((a, b) => desc(a.opened_at, b.opened_at) || desc(a.created_at, b.created_at) || byName(a, b));
  }
}

export const isProjectSort = (s: string | null | undefined): s is ProjectSort => (PROJECT_SORTS as readonly string[]).includes(s ?? '');

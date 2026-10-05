import type { UiLocale } from '../../core/i18n/languages';
import { buildChapters, type Chapter } from './manualModel';

// The user manual, bundled into the app so Help works offline: docs/manual/<lang>/*.md as text
// and the screenshots in docs/manual/img/<lang>/ as asset URLs.

const ROOT = '../../../../docs/manual/';

const raw = import.meta.glob('../../../../docs/manual/*/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const imgs = import.meta.glob('../../../../docs/manual/img/*/*.{png,jpg,webp,svg}', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** "<lang>/<file>" → Markdown. */
export const MANUAL_SOURCES: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.slice(ROOT.length), v]));

const cache = new Map<UiLocale, Chapter[]>();

/** The manual in the interface language, chapter by chapter falling back to English. */
export function manualChapters(locale: UiLocale): Chapter[] {
  let hit = cache.get(locale);
  if (!hit) {
    hit = buildChapters(MANUAL_SOURCES, locale);
    cache.set(locale, hit);
  }
  return hit;
}

/**
 * The bundled URL of an image written in the manual as "../img/<lang>/<name>.png", falling
 * back to the English screenshot; null when there is none yet.
 */
export function manualImage(src: string): string | null {
  const m = /img\/([a-z]{2})\/([\w.-]+)$/.exec(src);
  if (!m) return null;
  return imgs[`${ROOT}img/${m[1]}/${m[2]}`] ?? imgs[`${ROOT}img/en/${m[2]}`] ?? null;
}

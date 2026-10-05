import { detectUiLocale, isUiLocale, type UiLocale } from '../core/i18n/languages';
import type { Platform } from '../platform/types';

// Device preferences: readable before unlock (the welcome and unlock screens need the language
// and theme), so they never hold research content — at most a project id, which says nothing.

export const THEMES = ['system', 'light', 'dark'] as const;
export type ThemePref = (typeof THEMES)[number];

export const AUTO_LOCK_MINUTES = [5, 10, 15, 30, 60] as const;
export type AutoLockMinutes = (typeof AUTO_LOCK_MINUTES)[number];
export const DEFAULT_AUTO_LOCK: AutoLockMinutes = 10;

export interface DevicePrefs {
  locale: UiLocale;
  theme: ThemePref;
  autoLockMinutes: AutoLockMinutes;
  /** The project to open after unlocking. */
  lastProjectId: string | null;
}

/** Keys in prefs.json. */
const KEYS = { locale: 'locale', theme: 'theme', autoLockMinutes: 'auto_lock_minutes', lastProjectId: 'last_project_id' } as const;

/**
 * Reads the preferences, with defaults for anything unset or unreadable. `systemLocale` is the
 * computer's language tag (navigator.language in the UI): it decides the language until the
 * researcher picks one.
 */
export async function readPrefs(platform: Platform, systemLocale?: string | null): Promise<DevicePrefs> {
  let raw: Record<string, string> = {};
  try {
    raw = await platform.prefs.get();
  } catch (e) {
    // A damaged prefs.json must not keep anyone from their library: defaults it is.
    console.error('reading preferences failed', e);
  }
  const minutes = Number(raw[KEYS.autoLockMinutes]);
  const theme = raw[KEYS.theme];
  return {
    locale: isUiLocale(raw[KEYS.locale]) ? raw[KEYS.locale] as UiLocale : detectUiLocale(systemLocale),
    theme: (THEMES as readonly string[]).includes(theme ?? '') ? (theme as ThemePref) : 'system',
    autoLockMinutes: (AUTO_LOCK_MINUTES as readonly number[]).includes(minutes) ? (minutes as AutoLockMinutes) : DEFAULT_AUTO_LOCK,
    lastProjectId: raw[KEYS.lastProjectId] || null,
  };
}

/** Saves some preferences; invalid values are refused rather than stored. */
export async function writePrefs(platform: Platform, patch: Partial<DevicePrefs>): Promise<void> {
  const out: Record<string, string> = {};
  if (patch.locale !== undefined) {
    if (!isUiLocale(patch.locale)) throw new Error(`unknown locale: ${String(patch.locale)}`);
    out[KEYS.locale] = patch.locale;
  }
  if (patch.theme !== undefined) {
    if (!(THEMES as readonly string[]).includes(patch.theme)) throw new Error(`unknown theme: ${String(patch.theme)}`);
    out[KEYS.theme] = patch.theme;
  }
  if (patch.autoLockMinutes !== undefined) {
    if (!(AUTO_LOCK_MINUTES as readonly number[]).includes(patch.autoLockMinutes)) throw new Error(`auto-lock must be one of ${AUTO_LOCK_MINUTES.join(', ')}`);
    out[KEYS.autoLockMinutes] = String(patch.autoLockMinutes);
  }
  if (patch.lastProjectId !== undefined) out[KEYS.lastProjectId] = patch.lastProjectId ?? '';
  if (Object.keys(out).length) await platform.prefs.set(out);
}

/** Whether the researcher has picked a language yet (otherwise the system's is followed). */
export async function hasChosenLocale(platform: Platform): Promise<boolean> {
  try {
    return isUiLocale((await platform.prefs.get())[KEYS.locale]);
  } catch {
    return false;
  }
}

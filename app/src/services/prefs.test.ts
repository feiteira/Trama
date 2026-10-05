import { describe, expect, it } from 'vitest';
import { createMemoryPlatform } from '../platform/memory';
import { hasChosenLocale, readPrefs, writePrefs } from './prefs';

describe('device preferences', () => {
  it('defaults to the system language, the system theme and a 10-minute auto-lock', async () => {
    const platform = createMemoryPlatform();
    expect(await readPrefs(platform, 'pt-BR')).toEqual({ locale: 'pt', theme: 'system', autoLockMinutes: 10, lastProjectId: null });
    expect((await readPrefs(platform, 'es-419')).locale).toBe('es');
    expect((await readPrefs(platform, 'de-DE')).locale).toBe('en');
    expect((await readPrefs(platform)).locale).toBe('en');
    expect((await readPrefs(platform, '')).locale).toBe('en');
    expect(await hasChosenLocale(platform)).toBe(false);
  });

  it('saves and reads back each preference, a chosen language winning over the system one', async () => {
    const platform = createMemoryPlatform();
    await writePrefs(platform, { locale: 'es', theme: 'dark', autoLockMinutes: 30, lastProjectId: 'p-1' });
    expect(await readPrefs(platform, 'pt-PT')).toEqual({ locale: 'es', theme: 'dark', autoLockMinutes: 30, lastProjectId: 'p-1' });
    expect(await hasChosenLocale(platform)).toBe(true);
    await writePrefs(platform, { lastProjectId: null });
    expect((await readPrefs(platform)).lastProjectId).toBeNull();
    await writePrefs(platform, {}); // nothing to do
    expect((await readPrefs(platform)).theme).toBe('dark');
  });

  it('refuses invalid values and ignores invalid stored ones', async () => {
    const platform = createMemoryPlatform();
    await expect(writePrefs(platform, { locale: 'fr' as never })).rejects.toThrow();
    await expect(writePrefs(platform, { theme: 'blue' as never })).rejects.toThrow();
    await expect(writePrefs(platform, { autoLockMinutes: 7 as never })).rejects.toThrow();
    await platform.prefs.set({ locale: 'xx', theme: 'neon', auto_lock_minutes: 'soon' });
    expect(await readPrefs(platform, 'pt')).toEqual({ locale: 'pt', theme: 'system', autoLockMinutes: 10, lastProjectId: null });
  });

  it('falls back to defaults when the preferences cannot be read', async () => {
    const platform = createMemoryPlatform();
    platform.prefs.get = async () => {
      throw new Error('damaged prefs.json');
    };
    expect(await readPrefs(platform, 'es-ES')).toMatchObject({ locale: 'es', theme: 'system' });
    expect(await hasChosenLocale(platform)).toBe(false);
  });
});

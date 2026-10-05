import { DateTime, Settings } from 'luxon';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { isUiLocale, type UiLocale } from '../core/i18n/languages';
import { createMemoryPlatform, type MemoryPlatform } from '../platform/memory';
import type { LibraryOptions } from '../services/library';
import type { Phase } from '../shell/AppState';
import { isRouteName, type Route } from '../shell/router';
import { EXAMPLE_KDF } from './exampleConstants';
import { createExampleLibrary } from './exampleLibrary';
import { exampleCoderNames } from './exampleProject';

// The browser demo. URL parameters (all optional):
//   demo=empty            a first run (the welcome screen) instead of the example project
//   lang=en|pt|es         interface and example-content language
//   theme=light|dark      otherwise the system's
//   clock=2026-10-05T10:30  a fixed "now" (Europe/Lisbon) and seeded randomness, so ids, the
//                         recovery phrase and every date are identical on each run (screenshots)
//   route=locked|library|<route name>   where to start (default: the example project's documents)
//   name=Ana              the researcher's name (default: the example study's researcher)
// Everything lives in memory and disappears when the tab closes. The passphrase is "trama".

export interface DemoBoot {
  platform: MemoryPlatform;
  initialPhase?: Phase;
  libraryOptions: LibraryOptions;
}

/** Freezes time and seeds crypto.getRandomValues. Demo only: the real app never does this. */
function freeze(clock: string): void {
  let seed = 0x7a3a;
  globalThis.crypto.getRandomValues = (<T extends ArrayBufferView | null>(arr: T): T => {
    if (arr) {
      const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      for (let i = 0; i < bytes.length; i++) {
        // Math.imul keeps the product exact (a plain * loses bits above 2^53 and falls into a
        // cycle of a few hundred values).
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        bytes[i] = seed >>> 24;
      }
    }
    return arr;
  }) as Crypto['getRandomValues'];
  // Math.random too: the recovery-phrase check picks its words with it.
  let mseed = 0x1234;
  Math.random = () => {
    mseed = (Math.imul(mseed, 1664525) + 1013904223) >>> 0;
    return mseed / 2 ** 32;
  };
  const fixed = DateTime.fromISO(clock, { zone: 'Europe/Lisbon' }).toMillis();
  if (!Number.isFinite(fixed)) return;
  Settings.now = () => fixed;
  Settings.defaultZone = 'Europe/Lisbon';
  const RealDate = Date;
  // Freeze Date too, so every "now" in the app agrees.
  globalThis.Date = class extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(fixed);
      else super(...(args as [number]));
    }
    static override now() {
      return fixed;
    }
  } as DateConstructor;
}

export async function bootDemo(): Promise<DemoBoot> {
  const q = new URLSearchParams(window.location.search);
  const lang: UiLocale = isUiLocale(q.get('lang')) ? (q.get('lang') as UiLocale) : 'en';
  const clock = q.get('clock');
  if (clock) freeze(clock);

  const platform = createMemoryPlatform({ locateFile: () => wasmUrl, defaultFolder: '/home/demo/Documents' });
  // Hooks for the end-to-end tests and the screenshot pipeline (demo only).
  (window as unknown as { __tramaDemo: unknown }).__tramaDemo = {
    addFile: (path: string, base64: string) => platform.fileStore.set(path, Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0))),
    queueAnswer: platform.queueAnswer,
  };
  const theme = q.get('theme');
  const coderName = q.get('name') ?? exampleCoderNames(lang).researcher;
  await platform.prefs.set({ locale: lang, theme: theme === 'dark' || theme === 'light' ? theme : 'system' });
  const libraryOptions: LibraryOptions = { params: EXAMPLE_KDF };

  if (q.get('demo') === 'empty') return { platform, libraryOptions };

  await platform.prefs.set({ coder_name: coderName });
  const { library, project } = await createExampleLibrary(platform, { locale: lang, coderName, params: EXAMPLE_KDF });
  const route = q.get('route') ?? 'workbench';
  if (route === 'locked') {
    await library.lock();
    return { platform, libraryOptions, initialPhase: { name: 'locked' } };
  }
  if (route === 'library') {
    await library.closeProject();
    return { platform, libraryOptions, initialPhase: { name: 'library', library } };
  }
  const initialRoute: Route = isRouteName(route) ? ({ name: route } as Route) : { name: 'workbench' };
  return { platform, libraryOptions, initialPhase: { name: 'project', library, project, initialRoute } };
}

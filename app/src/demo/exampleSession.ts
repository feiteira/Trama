import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { UiLocale } from '../core/i18n/languages';
import { createMemoryPlatform } from '../platform/memory';
import type { Platform } from '../platform/types';
import { createExampleLibrary, type ExampleLibrary } from './exampleLibrary';

/**
 * "Try the example project": an example library held in memory only (sql.js), beside the
 * real platform. Nothing reaches the disk, and leaving it simply drops it.
 */
export async function createExampleSession(locale: UiLocale, coderName?: string): Promise<ExampleLibrary & { platform: Platform }> {
  const platform = createMemoryPlatform({ locateFile: () => wasmUrl, example: true });
  const made = await createExampleLibrary(platform, { locale, coderName });
  return { platform, ...made };
}

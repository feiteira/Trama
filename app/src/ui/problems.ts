// Errors the computer reports, in the reader's language. The desktop shell passes on the
// operating system's own English text ("No space left on device (os error 28)"), and the store
// and file readers speak English too: the few a researcher can act on get a sentence that says
// what to do. Pure (no DOM), so screens and the toast share it.

import { NotTramaFileError } from '../core/export/trama';
import { NewerSchemaError } from '../core/store/store';
import { PlatformError } from '../platform/types';
import type { MessageKey } from './i18n';

export type Problem = 'newerProject' | 'newerFile' | 'diskFull' | 'permission' | 'notFound' | 'wrongKey';

// ENOSPC is error 28 on Linux and macOS; Windows says 112 or 39. SQLite: "database or disk is full".
const DISK_FULL = /os error (28|39|112)\b|no space left|not enough space|disk (is )?full/i;
const NO_PERMISSION = /os error (13|5|1)\b|permission denied|access is denied|operation not permitted|read-only file system/i;

/** What a researcher can do something about, or null for anything else. */
export function problemOf(e: unknown): Problem | null {
  if (e instanceof NewerSchemaError) return 'newerProject';
  if (e instanceof NotTramaFileError && e.reason === 'newer-version') return 'newerFile';
  if (e instanceof PlatformError) {
    if (e.code === 'WRONG_KEY') return 'wrongKey';
    if (e.code === 'NOT_FOUND') return 'notFound';
    if (e.code === 'PERMISSION_DENIED') return 'permission';
  }
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  if (DISK_FULL.test(message)) return 'diskFull';
  if (e instanceof PlatformError && NO_PERMISSION.test(message)) return 'permission';
  return null;
}

/** The sentence for a known problem, or null. */
export function problemKey(e: unknown): MessageKey | null {
  const p = problemOf(e);
  return p ? (`common.problems.${p}` as const) : null;
}

import type { FileFilter, Platform } from '../../platform/types';

/** The name part of a path (either separator). */
export const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

/**
 * Asks where to save, then writes the bytes there. Resolves to the file name, or null when
 * the researcher cancelled.
 */
export async function saveBytes(platform: Platform, opts: { title: string; defaultName: string; filter: FileFilter; bytes: Uint8Array | (() => Uint8Array | Promise<Uint8Array>) }): Promise<string | null> {
  const path = await platform.dialogs.saveFile(opts.title, opts.defaultName, [opts.filter]);
  if (!path) return null;
  const bytes = typeof opts.bytes === 'function' ? await opts.bytes() : opts.bytes;
  await platform.files.write(path, bytes);
  return baseName(path);
}

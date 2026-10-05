import type { FileFilter, Platform } from '../../platform/types';

/** A file name valid on every desktop system (no path separators or reserved characters). */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.replace(/^\.+/, '') || 'trama';
}

/** The last part of a path, either separator. */
export const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

/**
 * Asks where to save and writes the bytes there. Returns the file's name, or null when the
 * researcher cancelled.
 */
export async function saveBytes(platform: Platform, title: string, defaultName: string, filter: FileFilter, bytes: Uint8Array): Promise<string | null> {
  const path = await platform.dialogs.saveFile(title, safeFileName(defaultName), [filter]);
  if (!path) return null;
  await platform.files.write(path, bytes);
  return baseName(path);
}

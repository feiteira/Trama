import type { Platform } from '../../platform/types';

// Saving an export the researcher asked for (CSV, XLSX) through the save dialog. Shared by the
// cases, audit trail and pseudonymisation screens.

export interface SaveRequest {
  title: string;
  defaultName: string;
  filter: { name: string; extensions: string[] };
  bytes: () => Uint8Array;
}

/** Asks where to save and writes the file. Resolves to its name, or null when cancelled. */
export async function saveExport(platform: Platform, req: SaveRequest): Promise<string | null> {
  const path = await platform.dialogs.saveFile(req.title, req.defaultName, [req.filter]);
  if (!path) return null;
  await platform.files.write(path, req.bytes());
  return baseName(path);
}

export const baseName = (path: string): string => path.split(/[\\/]/).pop() || path;

/** The CSV delimiter a spreadsheet in this language expects when the file is double-clicked. */
export const csvDelimiter = (locale: string): ',' | ';' => (locale === 'en' ? ',' : ';');

/** Today as yyyy-mm-dd, for file names. */
export function stamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

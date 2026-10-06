import { DateTime } from 'luxon';
import { safeName } from '../../core/export/trama';

// The Export section's choices and the files they produce: what each export is called, which
// extension and type it gets, and when its options are complete. Pure, so it is tested.

export type ExportKind = 'trama' | 'qdpx' | 'codebook' | 'report';
// The same five formats as the Codebook screen's Export menu (codes/useCodebookFiles.tsx).
export type CodebookFormat = 'qdc' | 'docx' | 'csv' | 'xlsx' | 'md';
export type ReportFormat = 'docx' | 'html';

export const CODEBOOK_FORMATS: readonly CodebookFormat[] = ['qdc', 'docx', 'csv', 'xlsx', 'md'];
export const REPORT_FORMATS: readonly ReportFormat[] = ['docx', 'html'];

export interface TramaOptions {
  protect: boolean;
  password: string;
  confirm: string;
  includePseudonyms: boolean;
}

export const DEFAULT_TRAMA: TramaOptions = { protect: false, password: '', confirm: '', includePseudonyms: false };

export type TramaProblem = 'passwordRequired' | 'mismatch' | null;

/** What keeps a .trama export from starting, if anything. */
export function tramaProblem(o: TramaOptions): TramaProblem {
  if (!o.protect) return null;
  if (!o.password) return 'passwordRequired';
  if (o.password.normalize('NFC') !== o.confirm.normalize('NFC')) return 'mismatch';
  return null;
}

/** The .trama export's options as services/datafile takes them. */
export function tramaExportOptions(o: TramaOptions): { password?: string; includePseudonyms: boolean } {
  return { includePseudonyms: o.includePseudonyms, ...(o.protect && o.password ? { password: o.password } : {}) };
}

export function extensionOf(kind: ExportKind, format?: CodebookFormat | ReportFormat): string {
  if (kind === 'trama') return 'trama';
  if (kind === 'qdpx') return 'qdpx';
  return format ?? 'docx';
}

/**
 * The suggested file name: the project's name, what it is (when not the whole project) and
 * the date, e.g. "Community gardens - codebook 2026-10-05.qdc".
 */
export function exportFileName(projectName: string, what: string | null, ext: string, now: Date): string {
  const date = DateTime.fromJSDate(now).toFormat('yyyy-MM-dd');
  const base = safeName(what ? `${projectName} - ${what}` : projectName, 'Trama');
  return `${base} ${date}.${ext}`;
}

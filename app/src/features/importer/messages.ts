// Why a file could not be imported, and what to check in one that was: the importers speak in
// language-neutral codes (core/import/types.ts); these turn them into catalog keys.

import { ImportError, parseWarning, WARNING } from '../../core/import';
import type { Vars } from '../../core/i18n/translate';
import type { MessageKey, PluralKey } from '../../ui/i18n';
import type { Failure } from './model';

export type Msg = { key: MessageKey; vars?: Vars } | { plural: PluralKey; n: number; vars?: Vars };

/** Renders a Msg with the screen's t/tp. */
export function say(m: Msg, t: (k: MessageKey, v?: Vars) => string, tp: (k: PluralKey, n: number, v?: Vars) => string): string {
  return 'key' in m ? t(m.key, m.vars) : tp(m.plural, m.n, m.vars);
}

export function failureOf(e: unknown): Failure {
  if (e instanceof ImportError) return { code: e.code, detail: e.detail, message: e.message };
  return { code: 'ERROR', detail: null, message: e instanceof Error ? e.message : String(e) };
}

const UNSUPPORTED: Record<string, MessageKey> = {
  doc: 'importer.errors.unsupportedDoc',
  xls: 'importer.errors.unsupportedXls',
  ods: 'importer.errors.unsupportedOds',
  ppt: 'importer.errors.unsupportedSlides',
  pptx: 'importer.errors.unsupportedSlides',
  odp: 'importer.errors.unsupportedSlides',
  image: 'importer.errors.unsupportedImage',
  media: 'importer.errors.unsupportedMedia',
};

/** One sentence saying why the file was not read, and what to do about it when we know. */
export function failureMessage(f: Failure): Msg {
  switch (f.code) {
    case 'UNSUPPORTED':
      return { key: (f.detail && UNSUPPORTED[f.detail]) || 'importer.errors.unsupported' };
    case 'EMPTY':
      return { key: 'importer.errors.empty' };
    case 'DAMAGED':
      return { key: 'importer.errors.damaged' };
    case 'ENCRYPTED_PDF':
      return { key: f.detail === 'incorrect-password' ? 'importer.errors.pdfWrongPassword' : 'importer.errors.pdfPassword' };
    case 'TOO_LARGE':
      return { key: 'importer.errors.tooLarge' };
    case 'NO_MEDIA_MATCH':
      return { key: 'importer.errors.noMediaMatch' };
    case 'READ':
      return { key: 'importer.errors.read', vars: { message: f.message ?? '' } };
    default:
      return { key: 'importer.errors.other', vars: { message: f.message ?? '' } };
  }
}

const count = (arg: string | null) => {
  const n = Number.parseInt(arg ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

/** Formats "2,5,7" as "2, 5 and 7" in the interface's language (with Intl.ListFormat). */
export function pageList(arg: string | null, bcp47: string): string {
  const pages = (arg ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (pages.length > 8) return `${pages.slice(0, 7).join(', ')}…`;
  try {
    return new Intl.ListFormat(bcp47, { type: 'conjunction' }).format(pages);
  } catch {
    return pages.join(', ');
  }
}

/** The sentence for one importer warning code. */
export function warningMessage(w: string, bcp47: string): Msg {
  const { code, arg } = parseWarning(w);
  switch (code) {
    case WARNING.legacyEncoding:
      return { key: 'importer.warnings.legacyEncoding' };
    case WARNING.pdfImagePages: {
      const pages = (arg ?? '').split(',').filter(Boolean).length;
      return { plural: 'importer.warnings.pdfImagePages', n: pages, vars: { pages: pageList(arg, bcp47) } };
    }
    case WARNING.pdfNoText:
      return { key: 'importer.warnings.pdfNoText' };
    case WARNING.imagesSkipped:
      return { plural: 'importer.warnings.imagesSkipped', n: count(arg) };
    case WARNING.commentsSkipped:
      return { plural: 'importer.warnings.commentsSkipped', n: count(arg) };
    case WARNING.rtfCodePage:
      return { key: 'importer.warnings.rtfCodePage', vars: { page: arg ?? '?' } };
    case WARNING.cuesSkipped:
      return { plural: 'importer.warnings.cuesSkipped', n: count(arg) };
    case WARNING.formulasWithoutValue:
      return { plural: 'importer.warnings.formulas', n: count(arg) };
    case WARNING.raggedRows:
      return { plural: 'importer.warnings.raggedRows', n: count(arg) };
    case WARNING.malformedQuotes: {
      const lines = (arg ?? '').split(',').filter(Boolean).length;
      return { plural: 'importer.warnings.malformedQuotes', n: lines, vars: { lines: pageList(arg, bcp47) } };
    }
    default:
      return { key: 'importer.warnings.other', vars: { code: w } };
  }
}

/** Warnings worth stopping at (the document will be empty or wrong without a look). */
export function isSerious(w: string): boolean {
  const { code } = parseWarning(w);
  return code === WARNING.pdfNoText || code === WARNING.pdfImagePages || code === WARNING.legacyEncoding || code === WARNING.rtfCodePage || code === WARNING.malformedQuotes;
}

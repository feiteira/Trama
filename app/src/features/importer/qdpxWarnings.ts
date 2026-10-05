// What a REFI-QDA project import could not carry over, grouped for the summary shown before the
// project is created. The reader (core/export/refi/qdpx-import.ts) reports each warning with a
// stable code, a count and the item it names; each code has its sentence in the catalogs.

import type { QdpxWarning, QdpxWarningCode } from '../../core/export/refi';
import type { Vars } from '../../core/i18n/translate';
import type { MessageKey, PluralKey } from '../../ui/i18n';

export type WarningGroup = 'sources' | 'coding' | 'cases' | 'other';
export const WARNING_GROUPS: readonly WarningGroup[] = ['sources', 'coding', 'cases', 'other'];

export type QdpxNote =
  | { group: WarningGroup; plural: PluralKey; n: number; raw: string }
  | { group: WarningGroup; key: MessageKey; vars: Vars; raw: string }
  | { group: WarningGroup; raw: string };

/** Warnings about one named item ("The PDF “Report” was skipped…"); every other code is a count. */
const NAMED: Partial<Record<QdpxWarningCode, true>> = { pdfSkipped: true, pdfNoText: true, videoSkipped: true, audioSkipped: true, tooLong: true, unsafePath: true };

/** Where each warning is listed. A new code fails the typecheck until it is placed (and worded). */
const GROUP: Record<QdpxWarningCode, WarningGroup> = {
  pdfSkipped: 'sources',
  pdfNoText: 'sources',
  videoSkipped: 'sources',
  audioSkipped: 'sources',
  tooLong: 'sources',
  unsafePath: 'other',
  pdfSelection: 'coding',
  picture: 'sources',
  pictureSelection: 'coding',
  mediaSelection: 'coding',
  externalMedia: 'sources',
  externalPdf: 'sources',
  externalText: 'sources',
  missingFile: 'sources',
  missingCode: 'coding',
  badSpan: 'coding',
  clampedSpan: 'coding',
  duplicateCoding: 'coding',
  caseCoding: 'cases',
  twoCases: 'cases',
  selectionCase: 'cases',
  caseCodeRef: 'cases',
  link: 'other',
  codeSet: 'other',
  noteMember: 'other',
  graph: 'other',
  badValue: 'cases',
  timeDropped: 'cases',
  conflictingValue: 'cases',
  sharedCaseValues: 'cases',
  madeCodable: 'other',
  truncatedComment: 'coding',
  truncatedMemo: 'other',
  noText: 'sources',
  unresolvedNote: 'other',
  syncPoint: 'sources',
  richTextOnly: 'sources',
  invalidRecord: 'other',
};

const keyOf = (code: QdpxWarningCode): string => (NAMED[code] ? `importer.qdpx.named.${code}` : `importer.qdpx.counted.${code}`);

/** Every catalog key used here (checked against the catalogs by a test). */
export const QDPX_KEYS: readonly string[] = (Object.keys(GROUP) as QdpxWarningCode[]).map(keyOf);

export function classifyQdpxWarning(w: QdpxWarning): QdpxNote {
  const group = GROUP[w.code];
  // A code this version does not know (a newer reader): shown as the reader worded it.
  if (!group) return { group: 'other', raw: w.message };
  if (NAMED[w.code]) return { group, key: keyOf(w.code) as MessageKey, vars: { name: w.detail ?? '' }, raw: w.message };
  return { group, plural: keyOf(w.code) as PluralKey, n: w.count, raw: w.message };
}

/** The warnings by group, in display order; empty groups left out. */
export function groupQdpxWarnings(warnings: readonly QdpxWarning[]): { group: WarningGroup; notes: QdpxNote[] }[] {
  const by = new Map<WarningGroup, QdpxNote[]>();
  for (const w of warnings) {
    const n = classifyQdpxWarning(w);
    by.set(n.group, [...(by.get(n.group) ?? []), n]);
  }
  return WARNING_GROUPS.filter((g) => by.has(g)).map((group) => ({ group, notes: by.get(group)! }));
}

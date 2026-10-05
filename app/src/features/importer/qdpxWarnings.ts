// What a REFI-QDA project import could not carry over, grouped for the summary shown before the
// project is created. The reader (core/export/refi/qdpx-import.ts) words its warnings in plain
// English; the known ones are recognised here and translated, anything else is shown as it is.

import type { Vars } from '../../core/i18n/translate';
import type { MessageKey, PluralKey } from '../../ui/i18n';

export type WarningGroup = 'sources' | 'coding' | 'cases' | 'other';
export const WARNING_GROUPS: readonly WarningGroup[] = ['sources', 'coding', 'cases', 'other'];

export type QdpxNote =
  | { group: WarningGroup; plural: PluralKey; n: number; raw: string }
  | { group: WarningGroup; key: MessageKey; vars: Vars; raw: string }
  | { group: WarningGroup; raw: string };

type Counted = [RegExp, WarningGroup, PluralKey];

const P = 'importer.qdpx.counted.';
// "<n> …" sentences (the COUNTED table of the reader), by their wording after the number.
const COUNTED: Counted[] = [
  [/^area selection\(s\) on PDF pages/, 'coding', `${P}pdfSelection` as PluralKey],
  [/^picture source\(s\)/, 'sources', `${P}picture` as PluralKey],
  [/^coded area\(s\) on pictures/, 'coding', `${P}pictureSelection` as PluralKey],
  [/^coded audio\/video time range/, 'coding', `${P}mediaSelection` as PluralKey],
  [/^audio\/video file\(s\) stored outside/, 'sources', `${P}externalMedia` as PluralKey],
  [/^PDF file\(s\) stored outside/, 'sources', `${P}externalPdf` as PluralKey],
  [/^source\(s\) whose text file is stored outside/, 'sources', `${P}externalText` as PluralKey],
  [/^file\(s\) referenced by the project were missing/, 'sources', `${P}missingFile` as PluralKey],
  [/^coding\(s\) pointing to a code that does not exist/, 'coding', `${P}missingCode` as PluralKey],
  [/^coded segment\(s\) with positions outside/, 'coding', `${P}badSpan` as PluralKey],
  [/^coded segment\(s\) ran past the end/, 'coding', `${P}clampedSpan` as PluralKey],
  [/^duplicate coding\(s\)/, 'coding', `${P}duplicateCoding` as PluralKey],
  [/^coding\(s\) to cases/, 'cases', `${P}caseCoding` as PluralKey],
  [/^document\(s\) belonged to more than one case/, 'cases', `${P}twoCases` as PluralKey],
  [/^case assignment\(s\) of a text selection/, 'cases', `${P}selectionCase` as PluralKey],
  [/^code reference\(s\) on cases/, 'cases', `${P}caseCodeRef` as PluralKey],
  [/^link\(s\) between objects/, 'other', `${P}link` as PluralKey],
  [/^set\(s\) of codes/, 'other', `${P}codeSet` as PluralKey],
  [/^memo\(s\) listed in sets/, 'other', `${P}noteMember` as PluralKey],
  [/^graph\(s\)/, 'other', `${P}graph` as PluralKey],
  [/^attribute value\(s\) did not match/, 'cases', `${P}badValue` as PluralKey],
  [/^date-time value\(s\)/, 'cases', `${P}timeDropped` as PluralKey],
  [/^document variable value\(s\) conflicted/, 'cases', `${P}conflictingValue` as PluralKey],
  [/^document variable value\(s\) were stored on a case/, 'cases', `${P}sharedCaseValues` as PluralKey],
  [/^code\(s\) marked as folders/, 'other', `${P}madeCodable` as PluralKey],
  [/^long segment comment\(s\)/, 'coding', `${P}truncatedComment` as PluralKey],
  [/^memo\(s\) were too long/, 'other', `${P}truncatedMemo` as PluralKey],
  [/^document\(s\) had no text/, 'sources', `${P}noText` as PluralKey],
  [/^memo reference\(s\)/, 'other', `${P}unresolvedNote` as PluralKey],
  [/^transcript time stamp\(s\)/, 'sources', `${P}syncPoint` as PluralKey],
  [/^text\(s\) were read from Word files/, 'sources', `${P}richTextOnly` as PluralKey],
  [/^item\(s\) could not be imported/, 'other', `${P}invalidRecord` as PluralKey],
];

const NAMED: [RegExp, WarningGroup, MessageKey][] = [
  [/^The PDF "(.*)" was skipped: neither the PDF nor its text was included\.$/, 'sources', 'importer.qdpx.named.pdfSkipped'],
  [/^The PDF "(.*)" was imported without text/, 'sources', 'importer.qdpx.named.pdfNoText'],
  [/^The video "(.*)" was skipped/, 'sources', 'importer.qdpx.named.videoSkipped'],
  [/^The audio "(.*)" was skipped/, 'sources', 'importer.qdpx.named.audioSkipped'],
  [/^The document "(.*)" was skipped: its text is longer/, 'sources', 'importer.qdpx.named.tooLong'],
  [/^A file with an unsafe path was ignored: (.*)$/, 'other', 'importer.qdpx.named.unsafePath'],
];

/** Every catalog key used here (checked against the catalogs by a test). */
export const QDPX_KEYS: readonly string[] = [...COUNTED.map((c) => c[2]), ...NAMED.map((n) => n[2])];

export function classifyQdpxWarning(raw: string): QdpxNote {
  const counted = /^(\d+) (.*)$/.exec(raw);
  if (counted) {
    const rest = counted[2]!;
    for (const [re, group, plural] of COUNTED) if (re.test(rest)) return { group, plural, n: Number(counted[1]), raw };
  }
  for (const [re, group, key] of NAMED) {
    const m = re.exec(raw);
    if (m) return { group, key, vars: { name: m[1] ?? '' }, raw };
  }
  return { group: 'other', raw };
}

/** The warnings by group, in display order; empty groups left out. */
export function groupQdpxWarnings(warnings: readonly string[]): { group: WarningGroup; notes: QdpxNote[] }[] {
  const by = new Map<WarningGroup, QdpxNote[]>();
  for (const w of warnings) {
    const n = classifyQdpxWarning(w);
    by.set(n.group, [...(by.get(n.group) ?? []), n]);
  }
  return WARNING_GROUPS.filter((g) => by.has(g)).map((group) => ({ group, notes: by.get(group)! }));
}

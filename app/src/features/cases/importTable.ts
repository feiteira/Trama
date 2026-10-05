// Preparing a spreadsheet of case attributes for services/cases.importAttributeTable: which
// column holds case names, what each other column would become, and the rows to send.

import type { Attribute, AttributeType } from '../../core/model/types';
import { fold } from '../../core/text/normalize';
import { inferAttributeType } from '../../services/cases';

const NAME_HEADERS = /^(case|cases|caso|casos|participant|participants|participante|participantes|name|nome|nombre|id|code|código|codigo|pseudonym|pseudónimo|seudónimo|interviewee|entrevistado|entrevistada|respondent)\b/;

/**
 * The column most likely to hold case names: the one matching most existing case names, else
 * one whose header says so ("Participant", "Caso"…), else the first.
 */
export function guessNameColumn(headers: readonly string[], rows: readonly (readonly string[])[], caseNames: readonly string[]): number {
  const names = new Set(caseNames.map(fold));
  if (names.size) {
    let best = -1;
    let bestHits = 0;
    headers.forEach((_, i) => {
      const hits = rows.reduce((n, r) => n + (names.has(fold(r[i] ?? '')) ? 1 : 0), 0);
      if (hits > bestHits) [best, bestHits] = [i, hits];
    });
    if (best >= 0) return best;
  }
  const byHeader = headers.findIndex((h) => NAME_HEADERS.test(fold(h)));
  return byHeader >= 0 ? byHeader : 0;
}

export type ColumnPlan = { index: number; header: string } & ({ kind: 'existing'; attr: Attribute } | { kind: 'new'; type: AttributeType });

/** What each column would fill: an existing attribute (same name) or a new one of an inferred type. */
export function planColumns(headers: readonly string[], rows: readonly (readonly string[])[], nameColumn: number, attrs: readonly Attribute[]): ColumnPlan[] {
  const byName = new Map(attrs.map((a) => [fold(a.name), a]));
  const out: ColumnPlan[] = [];
  headers.forEach((header, index) => {
    if (index === nameColumn || !header.trim()) return;
    const attr = byName.get(fold(header));
    if (attr) out.push({ index, header, kind: 'existing', attr });
    else out.push({ index, header, kind: 'new', type: inferAttributeType(rows.map((r) => r[index] ?? '')).type });
  });
  return out;
}

/** The table to import: a header row, then the rows, keeping the name column and the chosen ones. */
export function tableToImport(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  nameColumn: number,
  columns: readonly number[],
): { rows: string[][]; nameColumn: number } {
  const keep = [nameColumn, ...columns.filter((c) => c !== nameColumn)];
  return { rows: [keep.map((i) => headers[i] ?? ''), ...rows.map((r) => keep.map((i) => r[i] ?? ''))], nameColumn: 0 };
}

/** Rows whose case name matches an existing case, and how many would be new. */
export function countMatches(rows: readonly (readonly string[])[], nameColumn: number, caseNames: readonly string[]): { matched: number; missing: number } {
  const names = new Set(caseNames.map(fold));
  const seen = new Set<string>();
  let matched = 0;
  let missing = 0;
  for (const r of rows) {
    const k = fold(r[nameColumn] ?? '');
    if (!k || seen.has(k)) continue;
    seen.add(k);
    if (names.has(k)) matched++;
    else missing++;
  }
  return { matched, missing };
}

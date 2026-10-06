// Code × document totals for the 'presence' measure in the cells' unit.
//
// core/qda/matrix.ts gives, for presence, column totals that count the *codes* present in a
// column while the cells and the row totals count *documents*; shown under one "Total"
// label, the bottom row read as a number of documents and was neither. Here every total
// counts documents: a column's total is its documents with any of the codes.

import type { Coding } from '../../../core/model/types';
import type { CodeMatrix } from '../../../core/qda/matrix';

export function presenceTotals(m: CodeMatrix, codings: readonly Coding[]): CodeMatrix {
  if (m.measure !== 'presence') return m;
  const rows = new Set(m.rows);
  const coded = new Set<string>();
  for (const c of codings) if (!c.deleted && rows.has(c.code_id)) coded.add(c.document_id);
  const count = (ids: Iterable<string>) => {
    let n = 0;
    for (const id of ids) if (coded.has(id)) n++;
    return n;
  };
  return {
    ...m,
    colTotals: m.cols.map((c) => count(new Set(c.documentIds))),
    grandTotal: count(new Set(m.cols.flatMap((c) => c.documentIds))),
  };
}

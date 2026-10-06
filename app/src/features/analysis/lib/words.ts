// Word frequencies: which documents each side of a comparison holds, and the keyness table.

import type { KeywordRow } from '../../../core/qda/wordfreq';
import type { Cell } from './format';

interface GroupedDoc {
  id: string;
  group_ids: readonly string[];
}

/**
 * The two corpora of a keyness comparison: group A against group B, or against every other
 * document. Log-likelihood assumes the two corpora are independent, so a document in both
 * groups (groups often overlap: "Women" and "Over 60") belongs to neither side; `shared`
 * says how many were left out.
 */
export function compareCorpora<D extends GroupedDoc>(documents: readonly D[], groupA: string, groupB: string): { a: D[]; b: D[]; shared: number } {
  const inA = (d: D) => d.group_ids.includes(groupA);
  if (!groupB || groupB === groupA) return { a: documents.filter(inA), b: documents.filter((d) => !inA(d)), shared: 0 };
  const inB = (d: D) => d.group_ids.includes(groupB);
  let shared = 0;
  const a: D[] = [];
  const b: D[] = [];
  for (const d of documents) {
    const x = inA(d);
    const y = inB(d);
    if (x && y) shared++;
    else if (x) a.push(d);
    else if (y) b.push(d);
  }
  return { a, b, shared };
}

const round = (v: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/** The keyness table for CSV/XLSX: numbers stay numbers, so spreadsheets can sort and compute. */
export function keynessRows(rows: readonly KeywordRow[], head: readonly string[], nameA: string, nameB: string): Cell[][] {
  const out: Cell[][] = [[...head]];
  for (const r of rows) {
    out.push([
      r.word,
      r.countA,
      r.countB,
      round(r.perTenThousandA, 2),
      round(r.perTenThousandB, 2),
      round(r.logLikelihood, 2),
      Number(r.p.toPrecision(3)),
      Number.isFinite(r.logRatio) ? round(r.logRatio, 2) : null,
      r.overused === 'A' ? nameA : r.overused === 'B' ? nameB : '',
    ]);
  }
  return out;
}

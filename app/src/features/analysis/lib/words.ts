// Word frequencies: which documents each side of a comparison holds, and the keyness table.

import type { Coding } from '../../../core/model/types';
import type { SearchHit } from '../../../core/qda/search';
import type { Span } from '../../../core/qda/util';
import { codedTexts, type KeywordRow, maskMarkup, type TextInput, type WordFrequencyOptions, wordHits } from '../../../core/qda/wordfreq';
import type { Cell } from './format';
import { countPerDocument, hitsWithin } from './kwic';

interface KindedDoc {
  id: string;
  /** 'transcript', 'text'…: speaker labels are recognised by the document's kind, not guessed. */
  kind?: string;
}

/** Documents as word counting reads them: their text with their kind. */
export function documentInputs(docs: readonly KindedDoc[], texts: ReadonlyMap<string, string>): { id: string; text: string; kind?: string }[] {
  return docs.map((d) => ({ id: d.id, text: texts.get(d.id) ?? '', ...(d.kind !== undefined ? { kind: d.kind } : {}) }));
}

// Coded pieces are counted as plain text: any kind but 'transcript' (no label guessing on pieces).
const PIECES = 'coded';

/**
 * The coded text of the codes, for word counts. Markup is taken out of each whole document
 * first (unless `includeMarkup`), so a speaker label inside a coded segment goes whatever the
 * segments look like: a whole coded turn is one piece with one label, too few to be guessed.
 */
export function codedInputs(codings: readonly Coding[], codeIds: readonly string[], docs: readonly KindedDoc[], texts: ReadonlyMap<string, string>, includeMarkup = false): TextInput[] {
  let source = texts;
  if (!includeMarkup) {
    const ids = new Set(codeIds);
    const kinds = new Map(docs.map((d) => [d.id, d.kind]));
    const masked = new Map<string, string>();
    for (const c of codings) {
      if (!ids.has(c.code_id) || masked.has(c.document_id)) continue;
      const text = texts.get(c.document_id);
      if (text !== undefined) masked.set(c.document_id, maskMarkup(text, kinds.get(c.document_id)));
    }
    source = masked;
  }
  return codedTexts(codings, codeIds, { texts: source }).map((x) => ({ ...x, kind: PIECES }));
}

/** Where the given codes were applied, per document. */
export function codeSpans(codings: readonly Coding[], codeIds: readonly string[]): Map<string, Span[]> {
  const ids = new Set(codeIds);
  const spans = new Map<string, Span[]>();
  for (const c of codings) {
    if (c.deleted || !ids.has(c.code_id)) continue;
    const l = spans.get(c.document_id);
    if (l) l.push({ start: c.start, end: c.end });
    else spans.set(c.document_id, [{ start: c.start, end: c.end }]);
  }
  return spans;
}

/**
 * The places a word of the word list occurs, counted exactly as the list counts it (same tokens,
 * stop-word language, markup rule): the sheet's total always equals the word's count. `within`
 * keeps only hits inside those spans (a code's segments).
 */
export function wordSheet(
  word: string,
  docs: readonly KindedDoc[],
  texts: ReadonlyMap<string, string>,
  opts: WordFrequencyOptions,
  within: ReadonlyMap<string, readonly Span[]> | null,
  limit = 2000,
): { hits: SearchHit[]; perDocument: Map<string, number>; total: number } {
  const r = wordHits(documentInputs(docs, texts), word, { ...opts, limit: within ? Number.MAX_SAFE_INTEGER : limit, context: 90 });
  if (!within) return { hits: r.hits, perDocument: r.perDocument, total: r.total };
  const inside = hitsWithin(r.hits, within);
  return { hits: inside.slice(0, limit), perDocument: countPerDocument(inside), total: inside.length };
}

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

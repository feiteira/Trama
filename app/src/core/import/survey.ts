import { canonicalize, docName } from './text';
import type { ImportedDoc, ImportedTable } from './types';

// Survey table → documents. One per respondent (each open question as a heading line with the
// answer below it) or one per question (each respondent's answer under their id). The spans
// let the importer auto-code each answer with a code per question, and cases carry the
// respondents' attributes (age, group, site…).

export type SurveyLayout = 'one-per-respondent' | 'one-per-question';

export interface SurveyOptions {
  /** Column holding the respondent id (null/undefined: rows are numbered). */
  idColumn?: number | null;
  /** Columns with open answers, in the order they should appear. */
  textColumns: number[];
  /** Columns that describe the respondent (become case attributes). */
  attributeColumns: number[];
  layout?: SurveyLayout;
}

/** Where one answer sits in a document. `question` is the column header. */
export interface SurveySpan {
  question: string;
  column: number;
  respondent: string;
  /** Row index in table.rows. */
  row: number;
  start: number;
  end: number;
}

export interface SurveyCase {
  name: string;
  /** Header → value, for the attribute columns. */
  values: Record<string, string>;
}

export interface SurveyResult {
  documents: ImportedDoc[];
  /** One per respondent (row), in row order. */
  cases: SurveyCase[];
  /** Parallel to documents: the answers in each one. */
  questionSpans: SurveySpan[][];
  /** Parallel to documents: the case a document belongs to (one-per-respondent), else null. */
  caseNames: (string | null)[];
}

const oneLine = (s: string) => canonicalize(s).replace(/\s+/g, ' ').trim();
/** Answers keep their paragraphs; blank lines and trailing spaces go. */
const answerText = (s: string) =>
  canonicalize(s)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');

export function surveyToDocuments(table: ImportedTable, opts: SurveyOptions): SurveyResult {
  const width = table.headers.length;
  const valid = (c: number) => Number.isInteger(c) && c >= 0 && c < width;
  const textColumns = [...new Set(opts.textColumns)].filter(valid);
  const attributeColumns = [...new Set(opts.attributeColumns)].filter(valid);
  const idColumn = opts.idColumn !== null && opts.idColumn !== undefined && valid(opts.idColumn) ? opts.idColumn : null;
  const layout = opts.layout ?? 'one-per-respondent';
  const source = { filename: table.source?.filename ?? table.name, format: table.source?.format ?? 'csv' } as const;

  // Respondent names: the id when there is one, else "<table> <row number>"; unique.
  const used = new Map<string, number>();
  const names = table.rows.map((row, i) => {
    let name = (idColumn !== null ? oneLine(row[idColumn] ?? '') : '') || `${oneLine(table.name) || '#'} ${i + 1}`;
    const key = name.toLocaleLowerCase();
    const n = (used.get(key) ?? 0) + 1;
    used.set(key, n);
    if (n > 1) name = `${name} (${n})`;
    return name;
  });

  const cases: SurveyCase[] = table.rows.map((row, i) => ({
    name: names[i]!,
    values: Object.fromEntries(attributeColumns.map((c) => [table.headers[c]!, oneLine(row[c] ?? '')])),
  }));

  const documents: ImportedDoc[] = [];
  const questionSpans: SurveySpan[][] = [];
  const caseNames: (string | null)[] = [];
  const doc = (name: string, text: string): ImportedDoc => ({ name, kind: 'survey', text, sync: [], speakers: [], source, warnings: [] });

  if (layout === 'one-per-respondent') {
    table.rows.forEach((row, i) => {
      const parts: string[] = [];
      const spans: SurveySpan[] = [];
      let pos = 0;
      for (const c of textColumns) {
        const answer = answerText(row[c] ?? '');
        if (!answer) continue;
        const heading = oneLine(table.headers[c]!);
        if (parts.length) pos += 1;
        parts.push(heading);
        pos += heading.length + 1;
        spans.push({ question: table.headers[c]!, column: c, respondent: names[i]!, row: i, start: pos, end: pos + answer.length });
        parts.push(answer);
        pos += answer.length;
      }
      if (!parts.length) return;
      documents.push(doc(docName(names[i]!), parts.join('\n')));
      questionSpans.push(spans);
      caseNames.push(names[i]!);
    });
  } else {
    for (const c of textColumns) {
      const parts: string[] = [];
      const spans: SurveySpan[] = [];
      let pos = 0;
      table.rows.forEach((row, i) => {
        const answer = answerText(row[c] ?? '');
        if (!answer) return;
        if (parts.length) pos += 1;
        parts.push(names[i]!);
        pos += names[i]!.length + 1;
        spans.push({ question: table.headers[c]!, column: c, respondent: names[i]!, row: i, start: pos, end: pos + answer.length });
        parts.push(answer);
        pos += answer.length;
      });
      if (!parts.length) continue;
      documents.push(doc(docName(table.headers[c]!), parts.join('\n')));
      questionSpans.push(spans);
      caseNames.push(null);
    }
  }
  return { documents, cases, questionSpans, caseNames };
}

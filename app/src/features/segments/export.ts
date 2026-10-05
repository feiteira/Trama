// Coded segments leaving the screen: the clipboard (text with sources), CSV, XLSX and a
// report grouped by code (Word / HTML). Pure: the screen resolves names and positions, and
// passes the labels in the reader's language.

import type { Block, CsvCell, Inline, ReportDocument, Run, XlsxSheet } from '../../core/export/office';
import { chip } from '../../core/export/office';
import type { Coding } from '../../core/model/types';
import type { ShownText } from './view';
import { oneLine } from './view';

/** One segment with everything an export needs to say about it. */
export interface SegmentRow {
  coding: Coding;
  codeName: string;
  /** Names from the root down to the code ("Wellbeing / Calm"). */
  codePath: string[];
  codeColor: string;
  documentName: string;
  /** Paragraph number (from 1), null when unknown. */
  paragraph: number | null;
  coderName: string;
  /** The text with context, when context is shown on screen. */
  shown?: ShownText;
}

export interface ExportLabels {
  code: string;
  codePath: string;
  document: string;
  paragraph: string;
  start: string;
  end: string;
  coder: string;
  text: string;
  context: string;
  comment: string;
  created: string;
  /** "¶ {n}" */
  paragraphShort: (n: number) => string;
  /** "128 coded segments" */
  segmentCount: (n: number) => string;
  /** Sheet name of the per-code summary. */
  summary: string;
  segments: string;
  documents: string;
}

/** "Interview 3, ¶ 12" */
export function sourceOf(r: SegmentRow, labels: Pick<ExportLabels, 'paragraphShort'>): string {
  return r.paragraph === null ? r.documentName : `${r.documentName}, ${labels.paragraphShort(r.paragraph)}`;
}

const contextText = (r: SegmentRow): string => (r.shown ? `${r.shown.cutBefore ? '…' : ''}${r.shown.before}${r.shown.coded}${r.shown.after}${r.shown.cutAfter ? '…' : ''}` : '');

/**
 * Segments as plain text for pasting into a document or an email: each quote, then its source,
 * code and coder, and its comment; blank lines between.
 */
export function clipboardText(rows: readonly SegmentRow[], labels: ExportLabels): string {
  return rows
    .map((r) => {
      const quote = `“${oneLine(r.coding.text)}”`;
      const lines = [quote, `— ${sourceOf(r, labels)} · ${r.codePath.join(' / ')} · ${r.coderName}`];
      if (r.coding.comment.trim()) lines.push(`${labels.comment}: ${oneLine(r.coding.comment)}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

/** Rows for CSV and the XLSX segments sheet (header first). */
export function tableRows(rows: readonly SegmentRow[], labels: ExportLabels): CsvCell[][] {
  const withContext = rows.some((r) => r.shown);
  const header: CsvCell[] = [labels.code, labels.codePath, labels.document, labels.paragraph, labels.start, labels.end, labels.coder, labels.text];
  if (withContext) header.push(labels.context);
  header.push(labels.comment, labels.created);
  const body = rows.map((r) => {
    const row: CsvCell[] = [r.codeName, r.codePath.join(' / '), r.documentName, r.paragraph, r.coding.start, r.coding.end, r.coderName, r.coding.text];
    if (withContext) row.push(contextText(r));
    row.push(r.coding.comment, r.coding.created_at);
    return row;
  });
  return [header, ...body];
}

/** Per code: segments and documents, in the order codes first appear in `codeOrder`. */
export function perCode(rows: readonly SegmentRow[], codeOrder: readonly string[]): { codeId: string; rows: SegmentRow[] }[] {
  const by = new Map<string, SegmentRow[]>();
  for (const r of rows) {
    const list = by.get(r.coding.code_id);
    if (list) list.push(r);
    else by.set(r.coding.code_id, [r]);
  }
  const rank = new Map(codeOrder.map((id, i) => [id, i]));
  return [...by.entries()]
    .sort(([a], [b]) => (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER) || (a < b ? -1 : a > b ? 1 : 0))
    .map(([codeId, list]) => ({ codeId, rows: list }));
}

export function xlsxSheets(rows: readonly SegmentRow[], codeOrder: readonly string[], labels: ExportLabels): XlsxSheet[] {
  const summary = perCode(rows, codeOrder).map(({ rows: list }) => {
    const first = list[0]!;
    return [first.codePath.join(' / '), list.length, new Set(list.map((r) => r.coding.document_id)).size];
  });
  return [
    { name: labels.segments, rows: tableRows(rows, labels) },
    { name: labels.summary, rows: [[labels.code, labels.segments, labels.documents], ...summary] },
  ];
}

export interface ReportMeta {
  title: string;
  /** Project name and date. */
  subtitle: string;
  /** What was retrieved (filters), one line each. */
  description?: string[];
  lang?: string;
  generator?: string;
}

/**
 * A report grouped by code (codebook order): a heading per code with its colour and count, then
 * each quote with its document and position, coder and comment.
 */
export function segmentReport(rows: readonly SegmentRow[], codeOrder: readonly string[], labels: ExportLabels, meta: ReportMeta): ReportDocument {
  const blocks: Block[] = [];
  if (meta.description?.length) blocks.push({ type: 'paragraph', text: meta.description.join('\n'), style: 'small' });
  blocks.push({ type: 'paragraph', text: labels.segmentCount(rows.length), style: 'small' });
  for (const { rows: list } of perCode(rows, codeOrder)) {
    const first = list[0]!;
    const docs = new Set(list.map((r) => r.coding.document_id)).size;
    blocks.push({
      type: 'heading',
      level: 2,
      text: [chip(first.codeColor), ` ${first.codePath.join(' / ')}`] as Run[],
    });
    blocks.push({ type: 'paragraph', text: `${labels.segmentCount(list.length)} · ${labels.documents}: ${docs}`, style: 'small' });
    for (const r of list) {
      let quote: Inline;
      if (r.shown && (r.shown.before || r.shown.after)) {
        quote = [
          ...(r.shown.cutBefore || r.shown.before ? [{ text: `${r.shown.cutBefore ? '…' : ''}${r.shown.before}`, color: '#6b6f7a' }] : []),
          { text: r.shown.coded, bold: true },
          ...(r.shown.cutAfter || r.shown.after ? [{ text: `${r.shown.after}${r.shown.cutAfter ? '…' : ''}`, color: '#6b6f7a' }] : []),
        ];
      } else {
        quote = r.coding.text;
      }
      blocks.push({ type: 'paragraph', text: quote, style: 'quote' });
      const source: Run[] = [{ text: sourceOf(r, labels), bold: true, small: true }, { text: ` · ${r.coderName}`, small: true }];
      if (r.coding.comment.trim()) source.push({ text: `\n${labels.comment}: ${r.coding.comment.trim()}`, italic: true, small: true });
      blocks.push({ type: 'paragraph', text: source, style: 'small' });
    }
  }
  return { title: meta.title, subtitle: meta.subtitle, lang: meta.lang, generator: meta.generator, blocks };
}

/** A file name from a title: no characters file systems refuse, at most 120 characters. */
export function safeFileName(name: string, ext: string): string {
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Trama';
  return `${base}.${ext}`;
}

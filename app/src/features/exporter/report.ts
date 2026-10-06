import { DateTime } from 'luxon';
import type { Attribute, AttributeValue, Case, Code, Coder, Document, Memo, MemoTargetKind } from '../../core/model/types';
import { type Block, chip, type CsvCell, type Inline, type ReportDocument, type Run, type TableCell } from '../../core/export/office';
import { parseMarkdown, type Inline as MdInline } from '../../core/text/markdown';
import type { ProjectContext } from '../../services/context';
import { listCodesWithCounts, projectSummary, type ProjectSummary } from '../../services/queries';
import type { I18n } from '../../ui/i18n';

// The codebook and project report the Export section writes: data gathered from the store,
// then laid out as rows (CSV) or a ReportDocument (Word, HTML). Labels come translated from
// the caller's I18n, so the report is in the interface language.

export interface ReportCode {
  code: Pick<Code, 'id' | 'name' | 'color' | 'codable' | 'description' | 'inclusion' | 'exclusion' | 'example'>;
  depth: number;
  /** Names from the top level down to the code itself. */
  path: string[];
  /** Coded segments of this code and the codes below it. */
  total: number;
  own: number;
  /** Documents where this code or one below it is applied. */
  documents: number;
}

export interface ReportMemo {
  title: string;
  body: string;
  target: MemoTargetKind;
  /** Name of what the memo is on (document, code, case, the coded segment's document). */
  targetName: string | null;
  author: string | null;
  created_at: string;
}

export interface ReportCase {
  name: string;
  description: string;
  values: Record<string, AttributeValue>;
  documents: number;
}

export interface ReportData {
  project: { name: string; description: string; created_at: string };
  summary: ProjectSummary;
  codes: ReportCode[];
  memos: ReportMemo[];
  attributes: Pick<Attribute, 'id' | 'name' | 'type'>[];
  cases: ReportCase[];
  coders: string[];
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** Everything the codebook and the project report need, read from the open project. */
export async function loadReportData(ctx: ProjectContext, project: ReportData['project']): Promise<ReportData> {
  const { store } = ctx;
  const [summary, rows, memos, documents, cases, attributes, coders] = await Promise.all([
    projectSummary(ctx),
    listCodesWithCounts(ctx),
    store.list('memo'),
    store.list('document', { order: 'sort, id' }),
    store.list('case'),
    store.list('attribute'),
    store.list('coder'),
  ]);
  const codeName = new Map(rows.map((r) => [r.code.id, r.code.name]));
  const docName = new Map(documents.map((d: Document) => [d.id, d.name]));
  const caseName = new Map(cases.map((c) => [c.id, c.name]));
  const coderName = new Map(coders.map((c: Coder) => [c.id, c.name]));

  // Paths down the tree: rows come in tree order, so a parent's path is known before its children's.
  const pathOf = new Map<string, string[]>();
  const codes: ReportCode[] = rows.map((r) => {
    const parent = r.code.parent_id ? pathOf.get(r.code.parent_id) : undefined;
    const path = [...(parent ?? []), r.code.name];
    pathOf.set(r.code.id, path);
    return { code: r.code, depth: r.depth, path, total: r.total, own: r.own, documents: r.documentsTotal };
  });

  // A memo on a coded segment names the segment's document.
  const codingIds = memos.flatMap((m) => (m.target.kind === 'coding' ? [m.target.id] : []));
  const codingDoc = new Map<string, string>();
  for (const id of codingIds) {
    const c = await store.get('coding', id);
    if (c && !c.deleted) codingDoc.set(id, c.document_id);
  }
  const targetName = (m: Memo): string | null => {
    const t = m.target;
    if (t.kind === 'project') return null;
    if (t.kind === 'document') return docName.get(t.id) ?? null;
    if (t.kind === 'code') return codeName.get(t.id) ?? null;
    if (t.kind === 'case') return caseName.get(t.id) ?? null;
    const d = codingDoc.get(t.id);
    return d ? docName.get(d) ?? null : null;
  };
  const kindRank: Record<MemoTargetKind, number> = { project: 0, code: 1, document: 2, case: 3, coding: 4 };
  const reportMemos: ReportMemo[] = memos
    .map((m) => ({ title: m.title, body: m.body, target: m.target.kind, targetName: targetName(m), author: m.coder_id ? coderName.get(m.coder_id) ?? null : null, created_at: m.created_at }))
    .sort((a, b) => kindRank[a.target] - kindRank[b.target] || (a.targetName ?? '').localeCompare(b.targetName ?? '') || a.created_at.localeCompare(b.created_at));

  const docsPerCase = new Map<string, number>();
  for (const d of documents) if (d.case_id) docsPerCase.set(d.case_id, (docsPerCase.get(d.case_id) ?? 0) + 1);

  return {
    project,
    summary,
    codes,
    memos: reportMemos,
    attributes: [...attributes].sort((a, b) => a.order - b.order || byName(a, b)).map((a) => ({ id: a.id, name: a.name, type: a.type })),
    cases: [...cases].sort(byName).map((c: Case) => ({ name: c.name, description: c.description, values: c.values, documents: docsPerCase.get(c.id) ?? 0 })),
    coders: coders.map((c) => c.name).sort((a, b) => a.localeCompare(b)),
  };
}

// ── Codebook ─────────────────────────────────────────────────────────────────────────

export const PATH_SEPARATOR = ' > ';

/** The codebook as table rows (header first), for CSV. */
export function codebookRows(codes: readonly ReportCode[], i18n: Pick<I18n, 't'>): CsvCell[][] {
  const { t } = i18n;
  const header = [
    t('exporter.report.code'),
    t('exporter.report.path'),
    t('exporter.report.colour'),
    t('exporter.report.definition'),
    t('exporter.report.inclusion'),
    t('exporter.report.exclusion'),
    t('exporter.report.example'),
    t('exporter.report.segments'),
    t('exporter.report.documents'),
  ];
  return [
    header,
    ...codes.map((c) => [c.code.name, c.path.join(PATH_SEPARATOR), c.code.color, c.code.description, c.code.inclusion, c.code.exclusion, c.code.example, c.total, c.documents]),
  ];
}

const EM_SPACE = ' ';

function codebookBlocks(codes: readonly ReportCode[], i18n: Pick<I18n, 't' | 'meta'>, opts: { details: boolean }): Block[] {
  const { t } = i18n;
  const nf = new Intl.NumberFormat(i18n.meta.bcp47);
  if (!codes.length) return [{ type: 'paragraph', text: t('exporter.report.noCodes'), style: 'small' }];
  const blocks: Block[] = [
    {
      type: 'table',
      header: [t('exporter.report.code'), t('exporter.report.definition'), t('exporter.report.segments'), t('exporter.report.documents')],
      widths: [30, 50, 10, 10],
      rows: codes.map((c): TableCell[] => [
        [EM_SPACE.repeat(c.depth), chip(c.code.color), ' ', c.code.codable ? { text: c.code.name, bold: c.depth === 0 } : { text: c.code.name, italic: true }],
        c.code.description,
        nf.format(c.total),
        nf.format(c.documents),
      ]),
    },
  ];
  if (opts.details) {
    // The criteria and examples, for the codes that have them: a table cell is too narrow.
    const detailed = codes.filter((c) => c.code.inclusion || c.code.exclusion || c.code.example);
    for (const c of detailed) {
      blocks.push({ type: 'heading', level: 3, text: [chip(c.code.color), ' ', c.path.join(PATH_SEPARATOR)] });
      if (c.code.description) blocks.push({ type: 'paragraph', text: c.code.description });
      const line = (label: string, value: string) => blocks.push({ type: 'paragraph', text: [{ text: `${label}: `, bold: true }, value] });
      if (c.code.inclusion) line(t('exporter.report.inclusion'), c.code.inclusion);
      if (c.code.exclusion) line(t('exporter.report.exclusion'), c.code.exclusion);
      if (c.code.example) blocks.push({ type: 'paragraph', text: c.code.example, style: 'quote' });
    }
  }
  return blocks;
}

/** The codebook alone, as a report (Word). */
export function codebookReport(data: Pick<ReportData, 'project' | 'codes'>, i18n: Pick<I18n, 't' | 'meta' | 'date'>, opts: { generator: string; now: Date }): ReportDocument {
  const { t } = i18n;
  return {
    title: t('exporter.report.codebookTitle', { name: data.project.name }),
    subtitle: t('exporter.report.codebookSubtitle', { n: new Intl.NumberFormat(i18n.meta.bcp47).format(data.codes.length), date: i18n.date(DateTime.fromJSDate(opts.now), 'long') }),
    lang: i18n.meta.bcp47,
    generator: opts.generator,
    blocks: codebookBlocks(data.codes, i18n, { details: true }),
  };
}

// ── Project report ──────────────────────────────────────────────────────────────────

function mdRuns(c: readonly MdInline[], style: { bold?: boolean; italic?: boolean } = {}): Run[] {
  return c.flatMap((n): Run[] => {
    if (n.t === 'text') return [{ text: n.v, ...style }];
    if (n.t === 'code') return [{ text: n.v, mono: true, ...style }];
    if (n.t === 'bold') return mdRuns(n.c, { ...style, bold: true });
    if (n.t === 'italic') return mdRuns(n.c, { ...style, italic: true });
    return mdRuns(n.c, style);
  });
}

/** A memo's light Markdown as report blocks. */
export function memoBlocks(body: string): Block[] {
  const out: Block[] = [];
  for (const b of parseMarkdown(body)) {
    if (b.t === 'heading') out.push({ type: 'paragraph', text: mdRuns(b.c, { bold: true }) });
    else if (b.t === 'para') out.push({ type: 'paragraph', text: mdRuns(b.c) });
    else if (b.t === 'quote') out.push({ type: 'paragraph', text: mdRuns(b.c), style: 'quote' });
    else if (b.t === 'list') out.push({ type: 'list', ordered: b.ordered, items: b.items.map((i): Inline => mdRuns(i.c)) });
    else if (b.t === 'code') out.push({ type: 'paragraph', text: [{ text: b.v, mono: true }] });
    else if (b.t === 'table') out.push({ type: 'table', header: b.head.map((h) => mdRuns(h)), rows: b.rows.map((r) => r.map((c) => mdRuns(c))) });
  }
  return out;
}

export function formatValue(v: AttributeValue | undefined, i18n: Pick<I18n, 't' | 'meta'>): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean') return v ? i18n.t('common.yes') : i18n.t('common.no');
  if (typeof v === 'number') return new Intl.NumberFormat(i18n.meta.bcp47).format(v);
  return v;
}

function memoHeading(m: ReportMemo, t: I18n['t']): string {
  const on = m.target === 'project' || !m.targetName
    ? t('exporter.report.memoOn.project')
    : t(`exporter.report.memoOn.${m.target}`, { name: m.targetName });
  return m.author ? `${on} · ${t('exporter.report.by', { name: m.author })}` : on;
}

/** The full project report: overview, codebook with definitions and counts, memos, cases. */
export function projectReport(data: ReportData, i18n: Pick<I18n, 't' | 'tp' | 'meta' | 'date'>, opts: { generator: string; now: Date }): ReportDocument {
  const { t } = i18n;
  const nf = new Intl.NumberFormat(i18n.meta.bcp47);
  const s = data.summary;
  const created = DateTime.fromISO(data.project.created_at);
  const blocks: Block[] = [];

  // Overview
  blocks.push({ type: 'heading', level: 1, text: t('exporter.report.overview') });
  if (data.project.description) blocks.push({ type: 'paragraph', text: data.project.description });
  blocks.push({
    type: 'table',
    widths: [40, 60],
    rows: [
      [t('exporter.report.created'), created.isValid ? i18n.date(created, 'long') : ''],
      [t('exporter.report.exported'), i18n.date(DateTime.fromJSDate(opts.now), 'long')],
      [t('exporter.report.documentsRow'), nf.format(s.documents)],
      [t('exporter.report.codesRow'), nf.format(s.codes)],
      [t('exporter.report.segmentsRow'), nf.format(s.codings)],
      [t('exporter.report.codedDocumentsRow'), `${nf.format(s.codedDocuments)} / ${nf.format(s.documents)}`],
      [t('exporter.report.memosRow'), nf.format(s.memos)],
      [t('exporter.report.casesRow'), nf.format(s.cases)],
      [t('exporter.report.codersRow'), data.coders.join(', ')],
    ],
  });

  // Codebook
  blocks.push({ type: 'pageBreak' }, { type: 'heading', level: 1, text: t('exporter.report.codebook') });
  for (const b of codebookBlocks(data.codes, i18n, { details: true })) blocks.push(b);

  // Memos
  blocks.push({ type: 'pageBreak' }, { type: 'heading', level: 1, text: t('exporter.report.memos') });
  if (!data.memos.length) blocks.push({ type: 'paragraph', text: t('exporter.report.noMemos'), style: 'small' });
  for (const m of data.memos) {
    blocks.push({ type: 'heading', level: 2, text: m.title.trim() || t('common.untitled') });
    blocks.push({ type: 'paragraph', text: [{ text: memoHeading(m, t), small: true, italic: true }] });
    for (const b of memoBlocks(m.body)) blocks.push(b);
  }

  // Cases
  blocks.push({ type: 'pageBreak' }, { type: 'heading', level: 1, text: t('exporter.report.cases') });
  if (!data.cases.length) blocks.push({ type: 'paragraph', text: t('exporter.report.noCases'), style: 'small' });
  else {
    blocks.push({
      type: 'table',
      header: [t('exporter.report.caseName'), ...data.attributes.map((a) => a.name), t('exporter.report.documents')],
      rows: data.cases.map((c) => [c.name, ...data.attributes.map((a) => formatValue(c.values[a.id], i18n)), nf.format(c.documents)]),
    });
    const described = data.cases.filter((c) => c.description.trim());
    if (described.length) {
      blocks.push({ type: 'heading', level: 2, text: t('exporter.report.caseDescriptions') });
      for (const c of described) blocks.push({ type: 'paragraph', text: [{ text: `${c.name}: `, bold: true }, c.description] });
    }
  }

  return {
    title: data.project.name,
    subtitle: t('exporter.report.subtitle', { date: i18n.date(DateTime.fromJSDate(opts.now), 'long') }),
    lang: i18n.meta.bcp47,
    generator: opts.generator,
    blocks,
  };
}

// ── Files ───────────────────────────────────────────────────────────────────────────

/** Bytes as "820 KB", "12.4 MB" in the reader's number format. */
export function formatBytes(n: number, bcp47: string): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Math.max(0, n);
  let u = 0;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
  }
  const digits = u === 0 || v >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(bcp47, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v)} ${units[u]}`;
}

/** Total size of the original files and recordings kept with the documents. */
export function attachedBytes(docs: readonly Pick<Document, 'original' | 'media'>[]): number {
  const seen = new Set<string>();
  let n = 0;
  for (const d of docs) {
    for (const ref of [d.original, d.media]) {
      if (!ref || seen.has(ref.blob_id)) continue;
      seen.add(ref.blob_id);
      n += ref.size;
    }
  }
  return n;
}

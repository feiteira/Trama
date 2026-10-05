// The agreement report as data: a Word/HTML report (core/export/office blocks) and the tables
// for Excel and CSV. Built once from the screen's results so every format says the same.

import type { Block, ReportDocument, TableCell } from '../../core/export/office/blocks';
import { chip } from '../../core/export/office/blocks';
import type { XlsxCell, XlsxSheet } from '../../core/export/office/xlsx';
import type { BinaryStats } from '../../core/qda/agreement';
import type { MessageKey, PluralKey } from '../../ui/i18n';
import { type AgreementResult, alphaBand, type CodeRow, type DisagreementItem, fmtCoef, fmtInt, fmtPercent, kappaBand } from './model';

type Vars = Record<string, string | number>;

export interface ReportInput {
  t: (key: MessageKey, vars?: Vars) => string;
  tp: (key: PluralKey, n: number, vars?: Vars) => string;
  bcp47: string;
  projectName: string;
  coderA: { name: string; color: string };
  coderB: { name: string; color: string };
  /** The date shown in the subtitle, already formatted. */
  date: string;
  version: string;
  result: AgreementResult;
  rows: readonly CodeRow[];
  documentNames: ReadonlyMap<string, string>;
  codeNames: ReadonlyMap<string, { name: string; color: string }>;
  threshold: number;
  disagreements: readonly DisagreementItem[];
  /** Coded text by coding id, for the disagreement list. */
  codingText: ReadonlyMap<string, string>;
}

/** Disagreements listed in a report at most (the spreadsheet has them all). */
export const REPORT_MAX_DISAGREEMENTS = 300;

const round = (x: number | null, digits: number): number | null => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10 ** digits) / 10 ** digits);

function kappaText(i: ReportInput, k: number | null): string {
  const b = kappaBand(k);
  return b ? i.t('agreement.cards.landisKoch', { band: i.t(`agreement.bands.${b}`) }) : i.t('agreement.cards.undefinedHint');
}

function alphaText(i: ReportInput, a: number | null): string {
  const b = alphaBand(a);
  return b ? i.t(`agreement.alphaBands.${b}`) : i.t('agreement.cards.undefinedHint');
}

export interface SummaryStat {
  level: string;
  statistic: string;
  value: number | null;
  kind: 'coef' | 'pct';
  interpretation: string;
}

/** The headline statistics of every level, with how to read them. */
export function summaryStats(i: ReportInput): SummaryStat[] {
  const { t, bcp47, result: r } = i;
  const c = r.character.overall;
  const d = r.document.overall;
  const s = r.segment;
  const th = fmtPercent(i.threshold * 100, bcp47, 0);
  const ch = t('agreement.report.character');
  const sg = t('agreement.report.segment');
  const dc = t('agreement.report.document');
  return [
    { level: ch, statistic: t('agreement.table.kappaFull'), value: c.kappa, kind: 'coef', interpretation: kappaText(i, c.kappa) },
    { level: ch, statistic: t('agreement.table.alphaFull'), value: c.alpha, kind: 'coef', interpretation: alphaText(i, c.alpha) },
    { level: ch, statistic: t('agreement.table.percentFull'), value: c.percentAgreement, kind: 'pct', interpretation: '' },
    { level: ch, statistic: t('agreement.table.percentCodedFull'), value: c.percentAmongCoded, kind: 'pct', interpretation: '' },
    {
      level: sg,
      statistic: t('agreement.cards.segments'),
      value: s.percent,
      kind: 'pct',
      interpretation: t('agreement.cards.segmentsSub', { agree: fmtInt(s.agree, bcp47), total: fmtInt(s.agree + s.disagree, bcp47), threshold: th }),
    },
    { level: sg, statistic: t('agreement.cards.kappaBP'), value: s.kappa, kind: 'coef', interpretation: kappaText(i, s.kappa) },
    { level: dc, statistic: t('agreement.table.kappaFull'), value: d.kappa, kind: 'coef', interpretation: kappaText(i, d.kappa) },
    { level: dc, statistic: t('agreement.table.alphaFull'), value: d.alpha, kind: 'coef', interpretation: alphaText(i, d.alpha) },
    { level: dc, statistic: t('agreement.table.percentFull'), value: d.percentAgreement, kind: 'pct', interpretation: '' },
  ];
}

/** Summary lines as text: level, statistic, value, interpretation. */
export function summaryLines(i: ReportInput): [string, string, string, string][] {
  return summaryStats(i).map((s) => [s.level, s.statistic, s.kind === 'coef' ? fmtCoef(s.value, i.bcp47, 3) : fmtPercent(s.value, i.bcp47), s.interpretation]);
}

/** The per-code table, header first, numbers as numbers (percentages 0–100). */
export function codeTable(i: ReportInput): (string | number | null)[][] {
  const { t } = i;
  const header = [
    t('agreement.report.colCode'),
    t('agreement.report.colCharPercent'),
    t('agreement.report.colCharPercentCoded'),
    t('agreement.report.colCharKappa'),
    t('agreement.report.colCharAlpha'),
    t('agreement.report.colCharBoth'),
    t('agreement.report.colCharAOnly'),
    t('agreement.report.colCharBOnly'),
    t('agreement.report.colSegAgree'),
    t('agreement.report.colSegDisagree'),
    t('agreement.report.colSegPercent'),
    t('agreement.report.colDocPercent'),
    t('agreement.report.colDocKappa'),
  ];
  const line = (name: string, c: BinaryStats, seg: { agree: number; disagree: number; percent: number | null }, d: BinaryStats) => [
    name,
    round(c.percentAgreement, 2),
    round(c.percentAmongCoded, 2),
    round(c.kappa, 4),
    round(c.alpha, 4),
    c.both,
    c.aOnly,
    c.bOnly,
    seg.agree,
    seg.disagree,
    round(seg.percent, 2),
    round(d.percentAgreement, 2),
    round(d.kappa, 4),
  ];
  const r = i.result;
  return [
    header,
    ...i.rows.map((row) => line(row.name, row.character, row.segment, row.document)),
    line(t('agreement.report.totalRow'), r.character.overall, r.segment, r.document.overall),
  ];
}

/** The per-document table, header first. */
export function documentTable(i: ReportInput): (string | number | null)[][] {
  const { t } = i;
  const header = [
    t('agreement.report.colDocument'),
    t('agreement.report.colCharPercent'),
    t('agreement.report.colCharPercentCoded'),
    t('agreement.report.colCharKappa'),
    t('agreement.report.colCharAlpha'),
    t('agreement.report.colSegAgree'),
    t('agreement.report.colSegDisagree'),
    t('agreement.report.colSegPercent'),
    t('agreement.report.colDocPercent'),
    t('agreement.report.colDocKappa'),
  ];
  return [
    header,
    ...i.result.perDocument.map((p) => [
      i.documentNames.get(p.documentId) ?? '?',
      round(p.character.percentAgreement, 2),
      round(p.character.percentAmongCoded, 2),
      round(p.character.kappa, 4),
      round(p.character.alpha, 4),
      p.segment.agree,
      p.segment.disagree,
      round(p.segment.percent, 2),
      round(p.presence.percentAgreement, 2),
      round(p.presence.kappa, 4),
    ]),
  ];
}

function kindLabel(i: ReportInput, d: DisagreementItem): string {
  if (d.kind === 'boundary') return i.t('agreement.dis.boundary');
  return i.t('agreement.dis.onlyA', { name: d.kind === 'onlyA' ? i.coderA.name : i.coderB.name });
}

/** Every disagreement, one line per coding (a boundary pair gives two lines). */
export function disagreementTable(i: ReportInput, max = Infinity): (string | number | null)[][] {
  const { t } = i;
  const out: (string | number | null)[][] = [
    [
      t('agreement.report.colDocument'),
      t('agreement.report.colCode'),
      t('agreement.report.colKind'),
      t('agreement.report.colCoder'),
      t('agreement.report.colStart'),
      t('agreement.report.colEnd'),
      t('agreement.report.colOverlap'),
      t('agreement.report.colText'),
    ],
  ];
  for (const d of i.disagreements.slice(0, max)) {
    const doc = i.documentNames.get(d.documentId) ?? '?';
    const code = i.codeNames.get(d.codeId)?.name ?? '?';
    for (const [side, who] of [
      [d.a, i.coderA.name],
      [d.b, i.coderB.name],
    ] as const) {
      if (!side) continue;
      out.push([doc, code, kindLabel(i, d), who, side.start, side.end, round(d.overlap * 100, 1), i.codingText.get(side.codingId) ?? '']);
    }
  }
  return out;
}

const cell = (v: string | number | null, bcp47: string, kind: 'coef' | 'pct' | 'int' | 'text'): TableCell => {
  if (v === null) return '—';
  if (typeof v === 'string') return v;
  if (kind === 'coef') return fmtCoef(v, bcp47, 2);
  if (kind === 'pct') return fmtPercent(v, bcp47);
  return fmtInt(v, bcp47);
};

/** The report for Word and the web page. */
export function buildReport(i: ReportInput): ReportDocument {
  const { t, tp, bcp47 } = i;
  const th = fmtPercent(i.threshold * 100, bcp47, 0);
  const blocks: Block[] = [];

  blocks.push({ type: 'heading', level: 1, text: t('agreement.report.compared') });
  const docNames = i.result.documentIds.map((id) => i.documentNames.get(id) ?? '?');
  const codeNames = i.result.codeIds.map((id) => i.codeNames.get(id)?.name ?? '?');
  blocks.push({
    type: 'table',
    rows: [
      [t('agreement.report.coders'), [chip(i.coderA.color), ` A: ${i.coderA.name}     `, chip(i.coderB.color), ` B: ${i.coderB.name}`]],
      [t('agreement.report.documents'), `${tp('agreement.setup.docsCount', docNames.length)}: ${docNames.join(', ')}`],
      [t('agreement.report.codes'), `${tp('agreement.setup.codesCount', codeNames.length)}: ${codeNames.join(', ')}`],
      [t('agreement.report.threshold'), th],
    ],
    widths: [1, 3],
  });

  blocks.push({ type: 'heading', level: 1, text: t('agreement.report.summary') });
  blocks.push({
    type: 'table',
    header: [t('agreement.report.level'), t('agreement.report.statistic'), t('agreement.report.value'), t('agreement.report.interpretation')],
    rows: summaryLines(i),
    widths: [1.2, 2.4, 1, 3.4],
  });
  blocks.push({ type: 'paragraph', text: t('agreement.cards.caution'), style: 'small' });

  blocks.push({ type: 'heading', level: 1, text: t('agreement.table.byCode') });
  const codes = codeTable(i);
  const codeKinds: ('text' | 'pct' | 'coef' | 'int')[] = ['text', 'pct', 'pct', 'coef', 'coef', 'int', 'int', 'int', 'int', 'int', 'pct', 'pct', 'coef'];
  // The report keeps the columns a reader needs; the spreadsheet has every count.
  const pick = [0, 3, 4, 1, 2, 8, 9, 10, 12];
  blocks.push({
    type: 'table',
    header: [
      t('agreement.table.code'),
      `κ (${t('agreement.report.character')})`,
      `α (${t('agreement.report.character')})`,
      t('agreement.table.percent'),
      t('agreement.table.percentCoded'),
      t('agreement.table.agree'),
      t('agreement.table.disagree'),
      `% (${t('agreement.report.segment')})`,
      `κ (${t('agreement.report.document')})`,
    ],
    rows: codes.slice(1).map((r, n) =>
      pick.map((col) => {
        if (col === 0) {
          const row = i.rows[n];
          return row ? [chip(row.color), ` ${row.name}`] : [{ text: String(r[0]), bold: true }];
        }
        return cell(r[col] ?? null, bcp47, codeKinds[col]!);
      }),
    ),
    widths: [3, 1, 1, 1.2, 1.2, 1, 1, 1.2, 1],
  });

  blocks.push({ type: 'heading', level: 1, text: t('agreement.table.byDocument') });
  const docs = documentTable(i);
  const docKinds: ('text' | 'pct' | 'coef' | 'int')[] = ['text', 'pct', 'pct', 'coef', 'coef', 'int', 'int', 'pct', 'pct', 'coef'];
  blocks.push({
    type: 'table',
    header: [
      t('agreement.table.document'),
      `κ (${t('agreement.report.character')})`,
      `α (${t('agreement.report.character')})`,
      t('agreement.table.percent'),
      t('agreement.table.percentCoded'),
      t('agreement.table.agree'),
      t('agreement.table.disagree'),
      `% (${t('agreement.report.segment')})`,
      `κ (${t('agreement.report.document')})`,
    ],
    rows: docs.slice(1).map((r) => [0, 3, 4, 1, 2, 5, 6, 7, 9].map((col) => cell(r[col] ?? null, bcp47, docKinds[col]!))),
    widths: [3, 1, 1, 1.2, 1.2, 1, 1, 1.2, 1],
  });

  blocks.push({ type: 'heading', level: 1, text: t('agreement.report.disagreements') });
  blocks.push({
    type: 'paragraph',
    text: t('agreement.report.disagreementsNote', { threshold: th, max: fmtInt(REPORT_MAX_DISAGREEMENTS, bcp47) }),
    style: 'small',
  });
  let lastDoc = '';
  for (const d of i.disagreements.slice(0, REPORT_MAX_DISAGREEMENTS)) {
    if (d.documentId !== lastDoc) {
      lastDoc = d.documentId;
      blocks.push({ type: 'heading', level: 3, text: i.documentNames.get(d.documentId) ?? '?' });
    }
    const code = i.codeNames.get(d.codeId);
    const head = [chip(code?.color ?? '#7a7f87'), { text: ` ${code?.name ?? '?'}`, bold: true }, { text: ` · ${kindLabel(i, d)}`, small: true }] as const;
    blocks.push({ type: 'paragraph', text: [...head] });
    for (const [side, who] of [
      [d.a, i.coderA],
      [d.b, i.coderB],
    ] as const) {
      if (!side) continue;
      blocks.push({
        type: 'paragraph',
        text: [{ text: `${t('agreement.report.passageA', { name: who.name })} (${side.start}–${side.end})`, small: true, color: who.color }],
      });
      blocks.push({ type: 'paragraph', text: i.codingText.get(side.codingId) ?? '', style: 'quote' });
    }
  }

  blocks.push({ type: 'heading', level: 1, text: t('agreement.report.method') });
  const how: [MessageKey, MessageKey, MessageKey | null][] = [
    ['agreement.how.pooledTitle', 'agreement.how.pooled', null],
    ['agreement.how.percentTitle', 'agreement.how.percent', 'agreement.how.percentFormula'],
    ['agreement.how.kappaTitle', 'agreement.how.kappa', 'agreement.how.kappaFormula'],
    ['agreement.how.alphaTitle', 'agreement.how.alpha', 'agreement.how.alphaFormula'],
    ['agreement.how.undefinedTitle', 'agreement.how.undefined', null],
    ['agreement.how.segmentTitle', 'agreement.how.segment', 'agreement.how.segmentFormula'],
    ['agreement.how.bpTitle', 'agreement.how.bp', 'agreement.how.bpFormula'],
    ['agreement.how.documentTitle', 'agreement.how.document', null],
  ];
  for (const [title, body, formula] of how) {
    blocks.push({ type: 'heading', level: 3, text: t(title) });
    blocks.push({ type: 'paragraph', text: t(body, { threshold: th }) });
    if (formula) blocks.push({ type: 'paragraph', text: [{ text: t(formula), mono: true, small: true }] });
  }
  blocks.push({ type: 'paragraph', text: t('agreement.report.generator', { version: i.version }), style: 'small' });

  return {
    title: t('agreement.report.title'),
    lang: bcp47,
    subtitle: t('agreement.report.subtitle', { project: i.projectName, a: i.coderA.name, b: i.coderB.name, date: i.date }),
    generator: `Trama ${i.version}`,
    blocks,
  };
}

/** The workbook: summary, per code, per document, every disagreement. */
export function buildWorkbook(i: ReportInput): XlsxSheet[] {
  const { t } = i;
  const bold = (s: string): XlsxCell => ({ value: s, bold: true });
  const summary: XlsxCell[][] = [
    [t('agreement.report.level'), t('agreement.report.statistic'), t('agreement.report.value'), t('agreement.report.interpretation')],
    ...summaryStats(i).map((x) => [x.level, x.statistic, round(x.value, x.kind === 'coef' ? 4 : 2), x.interpretation]),
  ];
  const codes = codeTable(i);
  const last = codes[codes.length - 1]!;
  return [
    { name: t('agreement.report.sheetSummary'), rows: summary },
    { name: t('agreement.report.sheetCodes'), rows: [...codes.slice(0, -1), [bold(String(last[0])), ...last.slice(1)]] },
    { name: t('agreement.report.sheetDocuments'), rows: documentTable(i) },
    { name: t('agreement.report.sheetDisagreements'), rows: disagreementTable(i) },
  ];
}

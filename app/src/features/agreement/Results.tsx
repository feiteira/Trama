import React, { memo, useMemo, useState } from 'react';
import { ChevronRight, ListFilter } from 'lucide-react';
import type { BinaryStats } from '../../core/qda/agreement';
import { IconButton } from '../../ui/components/Button';
import { type SortDir, Table, TBody, TD, TH, THead, TR } from '../../ui/components/Table';
import { cx } from '../../ui/cx';
import { type MessageKey, useI18n } from '../../ui/i18n';
import {
  type AgreementResult,
  alphaBand,
  alphaTone,
  type CodeRow,
  codeValue,
  fmtCoef,
  fmtInt,
  fmtPercent,
  kappaBand,
  kappaTone,
  type Level,
  percentTone,
  sortCodeRows,
  type SortDirection,
  type SortKey,
  type Tone,
} from './model';

// ── Summary cards ────────────────────────────────────────────────────────────────────────────

/** A 0–1 track with the convention's cut points and a marker at the value. */
function Scale({ value, cuts, min = 0 }: { value: number | null; cuts: readonly number[]; min?: number }) {
  const pos = (x: number) => `${Math.max(0, Math.min(1, (x - min) / (1 - min))) * 100}%`;
  return (
    <div className="agr-scale" aria-hidden>
      <div className="agr-scale__track">
        {value !== null && Number.isFinite(value) ? <div className="agr-scale__fill" style={{ width: pos(value) }} /> : null}
      </div>
      {cuts.map((c) => (
        <span key={c} className="agr-scale__cut" style={{ left: pos(c) }} />
      ))}
      {value !== null && Number.isFinite(value) ? <span className="agr-scale__marker" style={{ left: pos(value) }} /> : null}
    </div>
  );
}

function ToneDot({ tone }: { tone: Tone }) {
  return <span className={cx('agr-tone-dot', `agr-tone-dot--${tone}`)} aria-hidden />;
}

function KappaCard({ label, sub, k, testId }: { label: string; sub: string; k: number | null; testId: string }) {
  const { t, meta } = useI18n();
  const band = kappaBand(k);
  return (
    <div className="agr-card" data-testid={testId}>
      <div className="agr-card__label">{label}</div>
      <div className={cx('agr-card__value t-tabular', k === null && 'agr-card__value--none')}>
        {k === null ? t('agreement.cards.undefined') : fmtCoef(k, meta.bcp47, 2)}
      </div>
      <Scale value={k} cuts={[0.2, 0.4, 0.6, 0.8]} />
      <div className="agr-card__band">
        <ToneDot tone={kappaTone(k)} />
        {band ? t('agreement.cards.landisKoch', { band: t(`agreement.bands.${band}`) }) : t('agreement.cards.undefinedHint')}
      </div>
      <div className="agr-card__sub">{sub}</div>
    </div>
  );
}

function AlphaCard({ a, testId }: { a: number | null; testId: string }) {
  const { t, meta } = useI18n();
  const band = alphaBand(a);
  return (
    <div className="agr-card" data-testid={testId}>
      <div className="agr-card__label">{t('agreement.cards.alpha')}</div>
      <div className={cx('agr-card__value t-tabular', a === null && 'agr-card__value--none')}>
        {a === null ? t('agreement.cards.undefined') : fmtCoef(a, meta.bcp47, 3)}
      </div>
      <Scale value={a} cuts={[0.667, 0.8]} />
      <div className="agr-card__band">
        <ToneDot tone={alphaTone(a)} />
        {band ? t(`agreement.alphaBands.${band}`) : t('agreement.cards.undefinedHint')}
      </div>
    </div>
  );
}

function PercentCard({
  label,
  main,
  mainSub,
  second,
  secondSub,
  testId,
}: {
  label: string;
  main: number | null;
  mainSub: string;
  second?: number | null;
  secondSub?: string;
  testId: string;
}) {
  const { meta } = useI18n();
  return (
    <div className="agr-card" data-testid={testId}>
      <div className="agr-card__label">{label}</div>
      <div className="agr-card__pair">
        <div>
          <div className="agr-card__value t-tabular">{fmtPercent(main, meta.bcp47)}</div>
          <div className="agr-card__sub">{mainSub}</div>
        </div>
        {second !== undefined ? (
          <div>
            <div className="agr-card__value agr-card__value--second t-tabular">{fmtPercent(second, meta.bcp47)}</div>
            <div className="agr-card__sub">{secondSub}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function SummaryCards({
  level,
  result,
  threshold,
  names,
}: {
  level: Level;
  result: AgreementResult;
  threshold: number;
  names: { a: string; b: string };
}) {
  const { t, meta } = useI18n();
  const th = fmtPercent(threshold * 100, meta.bcp47, 0);
  let cards: React.ReactNode;
  if (level === 'character') {
    const o = result.character.overall;
    cards = (
      <>
        <KappaCard label={t('agreement.cards.kappaPooled')} sub={t('agreement.cards.kappaPooledSub')} k={o.kappa} testId="agreement-card-kappa" />
        <AlphaCard a={o.alpha} testId="agreement-card-alpha" />
        <PercentCard
          label={t('agreement.cards.percent')}
          main={o.percentAgreement}
          mainSub={t('agreement.cards.percentAll')}
          second={o.percentAmongCoded}
          secondSub={t('agreement.cards.percentCoded')}
          testId="agreement-card-percent"
        />
      </>
    );
  } else if (level === 'segment') {
    const s = result.segment;
    const aTotal = s.codes.reduce((n, c) => n + c.aAgree + c.aDisagree, 0);
    const aOk = s.codes.reduce((n, c) => n + c.aAgree, 0);
    const bTotal = s.codes.reduce((n, c) => n + c.bAgree + c.bDisagree, 0);
    const bOk = s.codes.reduce((n, c) => n + c.bAgree, 0);
    cards = (
      <>
        <PercentCard
          label={t('agreement.cards.segments')}
          main={s.percent}
          mainSub={t('agreement.cards.segmentsSub', { agree: fmtInt(s.agree, meta.bcp47), total: fmtInt(s.agree + s.disagree, meta.bcp47), threshold: th })}
          testId="agreement-card-percent"
        />
        <KappaCard label={t('agreement.cards.kappaBP')} sub={s.codes.length === 1 ? t('agreement.cards.kappaBPSubOne') : t('agreement.cards.kappaBPSub', { k: s.categories })} k={s.kappa} testId="agreement-card-kappa" />
        <PercentCard
          label={t('agreement.cards.byCoder')}
          main={aTotal ? (aOk / aTotal) * 100 : null}
          mainSub={t('agreement.cards.matchedOf', { name: names.a, agree: fmtInt(aOk, meta.bcp47), total: fmtInt(aTotal, meta.bcp47) })}
          second={bTotal ? (bOk / bTotal) * 100 : null}
          secondSub={t('agreement.cards.matchedOf', { name: names.b, agree: fmtInt(bOk, meta.bcp47), total: fmtInt(bTotal, meta.bcp47) })}
          testId="agreement-card-coders"
        />
      </>
    );
  } else {
    const o = result.document.overall;
    cards = (
      <>
        <KappaCard label={t('agreement.cards.kappaDocs')} sub={t('agreement.cards.kappaDocsSub')} k={o.kappa} testId="agreement-card-kappa" />
        <AlphaCard a={o.alpha} testId="agreement-card-alpha" />
        <PercentCard
          label={t('agreement.cards.percent')}
          main={o.percentAgreement}
          mainSub={t('agreement.cards.percentDocs')}
          testId="agreement-card-percent"
        />
      </>
    );
  }
  return (
    <section className="agr-summary" aria-label={t('agreement.cards.label')}>
      <div className="agr-cards">{cards}</div>
      <p className="agr-caution">{t('agreement.cards.caution')}</p>
    </section>
  );
}

// ── How this is calculated ───────────────────────────────────────────────────────────────────

const HOW: Record<Level, [MessageKey, MessageKey, MessageKey | null][]> = {
  character: [
    ['agreement.how.pooledTitle', 'agreement.how.pooled', null],
    ['agreement.how.percentTitle', 'agreement.how.percent', 'agreement.how.percentFormula'],
    ['agreement.how.kappaTitle', 'agreement.how.kappa', 'agreement.how.kappaFormula'],
    ['agreement.how.alphaTitle', 'agreement.how.alpha', 'agreement.how.alphaFormula'],
    ['agreement.how.undefinedTitle', 'agreement.how.undefined', null],
  ],
  segment: [
    ['agreement.how.segmentTitle', 'agreement.how.segment', 'agreement.how.segmentFormula'],
    ['agreement.how.bpTitle', 'agreement.how.bp', 'agreement.how.bpFormula'],
  ],
  document: [
    ['agreement.how.documentTitle', 'agreement.how.document', null],
    ['agreement.how.kappaTitle', 'agreement.how.kappa', 'agreement.how.kappaFormula'],
    ['agreement.how.alphaTitle', 'agreement.how.alpha', 'agreement.how.alphaFormula'],
    ['agreement.how.undefinedTitle', 'agreement.how.undefined', null],
  ],
};

export function HowCalculated({ level, threshold, open, onToggle }: { level: Level; threshold: number; open: boolean; onToggle: (open: boolean) => void }) {
  const { t, meta } = useI18n();
  const th = fmtPercent(threshold * 100, meta.bcp47, 0);
  return (
    <details className="agr-how" open={open} onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)} data-testid="agreement-how">
      <summary className="agr-how__summary">
        <ChevronRight size={16} aria-hidden className="agr-how__chevron" />
        {t('agreement.how.title')}
      </summary>
      <div className="agr-how__body">
        {HOW[level].map(([title, body, formula]) => (
          <div key={title} className="agr-how__item">
            <h3 className="agr-how__title">{t(title)}</h3>
            <p className="agr-how__text">{t(body, { threshold: th })}</p>
            {formula ? <p className="agr-how__formula">{t(formula)}</p> : null}
          </div>
        ))}
      </div>
    </details>
  );
}

// ── Cells ────────────────────────────────────────────────────────────────────────────────────

function Val({ text, tone }: { text: string; tone: Tone }) {
  return <span className={cx('agr-val', `agr-val--${tone}`)}>{text}</span>;
}

/** Agreement in each document as a row of thin bars (a dot where there was nothing to compare). */
export const Sparkline = memo(function Sparkline({ values, labels }: { values: readonly (number | null)[]; labels: readonly string[] }) {
  const { t, meta } = useI18n();
  const n = values.length;
  const H = 20;
  const gap = n > 24 ? 1 : 2;
  const bw = Math.max(2, Math.min(6, Math.floor((96 - (n - 1) * gap) / Math.max(1, n))));
  const W = n * bw + (n - 1) * gap;
  const desc = values.map((v, i) => `${labels[i] ?? ''} ${v === null ? t('agreement.table.sparkNone') : fmtPercent(v * 100, meta.bcp47, 0)}`).join('; ');
  // Many documents: one path per row instead of a rect per bar (300 codes × 100 documents).
  if (n > 24) {
    let bars = '';
    let none = '';
    values.forEach((v, i) => {
      const x = i * (bw + gap);
      if (v === null) none += `M${x} ${H - 2}h${bw}v2h${-bw}z`;
      else {
        const h = Math.max(2, v * H);
        bars += `M${x} ${H - h}h${bw}v${h}h${-bw}z`;
      }
    });
    return (
      <svg
        className="agr-spark"
        width={Math.max(W, 1)}
        height={H}
        viewBox={`0 0 ${Math.max(W, 1)} ${H}`}
        role="img"
        aria-label={t('agreement.table.spark', { values: desc })}
      >
        <title>{desc}</title>
        {none ? <path d={none} className="agr-spark__none" /> : null}
        {bars ? <path d={bars} className="agr-spark__bar" /> : null}
      </svg>
    );
  }
  return (
    <svg
      className="agr-spark"
      width={Math.max(W, 1)}
      height={H}
      viewBox={`0 0 ${Math.max(W, 1)} ${H}`}
      role="img"
      aria-label={t('agreement.table.spark', { values: desc })}
    >
      {values.map((v, i) => {
        const x = i * (bw + gap);
        if (v === null) return <rect key={i} x={x} y={H - 2} width={bw} height={2} rx={1} className="agr-spark__none" />;
        const h = Math.max(2, v * H);
        return (
          <rect key={i} x={x} y={H - h} width={bw} height={h} rx={Math.min(2, bw / 2)} className="agr-spark__bar">
            <title>{`${labels[i] ?? ''}: ${fmtPercent(v * 100, meta.bcp47, 0)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
});

// ── By code ──────────────────────────────────────────────────────────────────────────────────

interface Column {
  key: SortKey;
  label: string;
  title?: string;
  render: (r: CodeRow) => React.ReactNode;
  total: () => React.ReactNode;
}

export function CodeTable({
  level,
  rows,
  result,
  docLabels,
  names,
}: {
  level: Level;
  rows: readonly CodeRow[];
  result: AgreementResult;
  docLabels: readonly string[];
  names: { a: string; b: string };
}) {
  const { t, meta } = useI18n();
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDirection } | null>(null);
  const collator = useMemo(() => new Intl.Collator(meta.bcp47, { sensitivity: 'base', numeric: true }), [meta.bcp47]);
  const shown = useMemo(() => (sort ? sortCodeRows(rows, sort.key, sort.dir, level, collator) : rows), [rows, sort, level, collator]);
  const b = meta.bcp47;
  const coef = (key: 'kappa' | 'alpha') => (r: CodeRow) => {
    const v = codeValue(r, key, level);
    return <Val text={fmtCoef(v, b)} tone={key === 'kappa' ? kappaTone(v) : alphaTone(v)} />;
  };
  const pct = (key: 'percent' | 'percentCoded') => (r: CodeRow) => {
    const v = codeValue(r, key, level);
    return <Val text={fmtPercent(v, b)} tone={percentTone(v)} />;
  };
  const int = (key: 'agree' | 'disagree') => (r: CodeRow) => fmtInt(codeValue(r, key, level) ?? 0, b);
  const stats: BinaryStats = level === 'document' ? result.document.overall : result.character.overall;
  const s = result.segment;

  const columns: Column[] =
    level === 'segment'
      ? [
          { key: 'agree', label: t('agreement.table.agree'), render: int('agree'), total: () => fmtInt(s.agree, b) },
          { key: 'disagree', label: t('agreement.table.disagree'), render: int('disagree'), total: () => fmtInt(s.disagree, b) },
          {
            key: 'percent',
            label: t('agreement.table.percent'),
            render: pct('percent'),
            total: () => <Val text={fmtPercent(s.percent, b)} tone={percentTone(s.percent)} />,
          },
        ]
      : level === 'character'
        ? [
            {
              key: 'kappa',
              label: t('agreement.table.kappa'),
              title: t('agreement.table.kappaFull'),
              render: coef('kappa'),
              total: () => <Val text={fmtCoef(stats.kappa, b)} tone={kappaTone(stats.kappa)} />,
            },
            {
              key: 'alpha',
              label: t('agreement.table.alpha'),
              title: t('agreement.table.alphaFull'),
              render: coef('alpha'),
              total: () => <Val text={fmtCoef(stats.alpha, b)} tone={alphaTone(stats.alpha)} />,
            },
            {
              key: 'percent',
              label: t('agreement.table.percent'),
              title: t('agreement.table.percentFull'),
              render: pct('percent'),
              total: () => <Val text={fmtPercent(stats.percentAgreement, b)} tone={percentTone(stats.percentAgreement)} />,
            },
            {
              key: 'percentCoded',
              label: t('agreement.table.percentCoded'),
              title: t('agreement.table.percentCodedFull'),
              render: pct('percentCoded'),
              total: () => <Val text={fmtPercent(stats.percentAmongCoded, b)} tone={percentTone(stats.percentAmongCoded)} />,
            },
          ]
        : [
            {
              key: 'kappa',
              label: t('agreement.table.kappa'),
              title: t('agreement.table.kappaFull'),
              render: coef('kappa'),
              total: () => <Val text={fmtCoef(stats.kappa, b)} tone={kappaTone(stats.kappa)} />,
            },
            { key: 'agree', label: t('agreement.table.both'), render: (r) => fmtInt(r.document.both, b), total: () => fmtInt(stats.both, b) },
            {
              key: 'aOnly',
              label: t('agreement.table.only', { name: names.a }),
              render: (r) => fmtInt(r.document.aOnly, b),
              total: () => fmtInt(stats.aOnly, b),
            },
            {
              key: 'bOnly',
              label: t('agreement.table.only', { name: names.b }),
              render: (r) => fmtInt(r.document.bOnly, b),
              total: () => fmtInt(stats.bOnly, b),
            },
            {
              key: 'percent',
              label: t('agreement.table.percent'),
              title: t('agreement.table.percentFull'),
              render: pct('percent'),
              total: () => <Val text={fmtPercent(stats.percentAgreement, b)} tone={percentTone(stats.percentAgreement)} />,
            },
          ];

  const dirOf = (key: SortKey): SortDir => (sort?.key === key ? sort.dir : null);
  const toggle = (key: SortKey) =>
    setSort((cur) => (cur?.key === key ? (cur.dir === 'desc' ? { key, dir: 'asc' } : null) : { key, dir: key === 'name' ? 'asc' : 'desc' }));

  return (
    <section className="agr-section" aria-labelledby="agr-by-code">
      <h2 className="agr-section__title" id="agr-by-code">
        {t('agreement.table.byCode')}
      </h2>
      <div className="agr-table">
        <Table label={t('agreement.table.byCode')} dense data-testid="agreement-code-table">
          <THead>
            <tr>
              <TH sort={dirOf('name')} onSort={() => toggle('name')} className="agr-table__name">
                {t('agreement.table.code')}
              </TH>
              {columns.map((c) => (
                <TH key={c.key} numeric sort={dirOf(c.key)} onSort={() => toggle(c.key)} title={c.title}>
                  {c.label}
                </TH>
              ))}
              <TH className="agr-table__spark">{t('agreement.table.perDocument')}</TH>
            </tr>
          </THead>
          <TBody>
            {shown.map((r) => (
              <TR key={r.codeId} data-testid="agreement-code-row">
                <TD className="agr-table__name">
                  <span className="agr-code">
                    <span className="agr-chip" style={{ background: r.color }} aria-hidden />
                    <span className="agr-code__name">{r.name}</span>
                  </span>
                </TD>
                {columns.map((c) => (
                  <TD key={c.key} numeric>
                    {c.render(r)}
                  </TD>
                ))}
                <TD className="agr-table__spark">
                  <Sparkline values={r.spark[level]} labels={docLabels} />
                </TD>
              </TR>
            ))}
            <TR className="agr-table__total">
              <TD className="agr-table__name">{t('agreement.table.total')}</TD>
              {columns.map((c) => (
                <TD key={c.key} numeric>
                  {c.total()}
                </TD>
              ))}
              <TD />
            </TR>
          </TBody>
        </Table>
      </div>
    </section>
  );
}

// ── By document ──────────────────────────────────────────────────────────────────────────────

export function DocTable({
  level,
  result,
  docNames,
  names,
  onShowDisagreements,
  filterDoc,
}: {
  level: Level;
  result: AgreementResult;
  docNames: ReadonlyMap<string, string>;
  names: { a: string; b: string };
  onShowDisagreements: (docId: string) => void;
  filterDoc: string | null;
}) {
  const { t, meta } = useI18n();
  const b = meta.bcp47;
  const headers: { label: string; title?: string }[] =
    level === 'character'
      ? [
          { label: t('agreement.table.kappa'), title: t('agreement.table.kappaFull') },
          { label: t('agreement.table.alpha'), title: t('agreement.table.alphaFull') },
          { label: t('agreement.table.percent'), title: t('agreement.table.percentFull') },
          { label: t('agreement.table.percentCoded'), title: t('agreement.table.percentCodedFull') },
        ]
      : level === 'segment'
        ? [{ label: t('agreement.table.agree') }, { label: t('agreement.table.disagree') }, { label: t('agreement.table.percent') }]
        : [
            { label: t('agreement.table.both') },
            { label: t('agreement.table.only', { name: names.a }) },
            { label: t('agreement.table.only', { name: names.b }) },
            { label: t('agreement.table.percent'), title: t('agreement.table.percentFull') },
          ];
  const cells = (p: AgreementResult['perDocument'][number]): React.ReactNode[] => {
    if (level === 'character') {
      const c = p.character;
      return [
        <Val key="k" text={fmtCoef(c.kappa, b)} tone={kappaTone(c.kappa)} />,
        <Val key="a" text={fmtCoef(c.alpha, b)} tone={alphaTone(c.alpha)} />,
        <Val key="p" text={fmtPercent(c.percentAgreement, b)} tone={percentTone(c.percentAgreement)} />,
        <Val key="c" text={fmtPercent(c.percentAmongCoded, b)} tone={percentTone(c.percentAmongCoded)} />,
      ];
    }
    if (level === 'segment') {
      const s = p.segment;
      return [fmtInt(s.agree, b), fmtInt(s.disagree, b), <Val key="p" text={fmtPercent(s.percent, b)} tone={percentTone(s.percent)} />];
    }
    const d = p.presence;
    return [
      fmtInt(d.both, b),
      fmtInt(d.aOnly, b),
      fmtInt(d.bOnly, b),
      <Val key="p" text={fmtPercent(d.percentAgreement, b)} tone={percentTone(d.percentAgreement)} />,
    ];
  };
  return (
    <section className="agr-section" aria-labelledby="agr-by-doc">
      <h2 className="agr-section__title" id="agr-by-doc">
        {t('agreement.table.byDocument')}
      </h2>
      <div className="agr-table">
        <Table label={t('agreement.table.byDocument')} dense data-testid="agreement-doc-table">
          <THead>
            <tr>
              <TH className="agr-table__name">{t('agreement.table.document')}</TH>
              {headers.map((h) => (
                <TH key={h.label} numeric title={h.title}>
                  {h.label}
                </TH>
              ))}
              <TH className="agr-table__act">
                <span className="visually-hidden">{t('agreement.dis.title')}</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {result.perDocument.map((p) => {
              const name = docNames.get(p.documentId) ?? '?';
              return (
                <TR key={p.documentId} selected={filterDoc === p.documentId} data-testid="agreement-doc-row">
                  <TD className="agr-table__name">
                    <span className="agr-code__name">{name}</span>
                  </TD>
                  {cells(p).map((c, i) => (
                    <TD key={i} numeric>
                      {c}
                    </TD>
                  ))}
                  <TD className="agr-table__act">
                    <IconButton
                      icon={ListFilter}
                      size="sm"
                      label={t('agreement.table.showDisagreements', { name })}
                      onClick={() => onShowDisagreements(p.documentId)}
                      data-testid="agreement-doc-disagreements"
                    />
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </div>
    </section>
  );
}

import React, { useMemo, useRef } from 'react';
import { BarChart3, ChartColumnStacked, GalleryVertical, Image as ImageIcon, Table as TableIcon } from 'lucide-react';
import { codeFrequencyBars, documentPortrait } from '../../../core/qda/charts';
import { codeDocumentMatrix } from '../../../core/qda/matrix';
import { groupBy } from '../../../core/qda/util';
import { useRouter } from '../../../shell/router';
import { Checkbox, RadioGroup } from '../../../ui/components/Choice';
import { Spinner } from '../../../ui/components/Feedback';
import { Select } from '../../../ui/components/Field';
import { useI18n } from '../../../ui/i18n';
import { BarPanels } from '../charts/BarPanels';
import { TipRow } from '../charts/ChartTip';
import { Portraits } from '../charts/Portraits';
import { StackedBars } from '../charts/StackedBars';
import { inCodebookOrder } from '../lib/codeLines';
import { formatPercent, formatValue, pathLabel } from '../lib/format';
import { SERIES } from '../lib/heat';
import { useAnalysisData, useDeferredCompute, useTheme } from '../parts/data';
import { useExporter } from '../parts/exporting';
import { ExportMenu, PanelSection, PickList, ResultsHead, ResultsMessage, ToolLayout } from '../parts/ui';
import { useToolSettings } from '../parts/useToolSettings';

type Chart = 'frequency' | 'portraits' | 'distribution';
type Top = '10' | '20' | '30' | 'all';
const MAX_SERIES = 8;
const SLICES = 120;

const DEFAULTS = {
  chart: 'frequency' as Chart,
  view: 'chart' as 'chart' | 'table',
  top: '20' as Top,
  level: 'all' as 'all' | 'top',
  portraitPicked: false,
  portraitCodes: [] as string[],
  portraitGroup: '',
  distBy: 'group' as 'group' | 'case',
  distPicked: false,
  distCodes: [] as string[],
  distSubcodes: true,
  normalised: false,
};

export function ChartsTool() {
  const { t, tp, locale } = useI18n();
  const { go } = useRouter();
  const data = useAnalysisData();
  const { lines, codings, documents, groups, cases, segments, codeById } = data;
  const theme = useTheme();
  const exporter = useExporter();
  const svg = useRef<SVGSVGElement>(null);
  const [s, set] = useToolSettings('charts', DEFAULTS, {
    chart: ['frequency', 'portraits', 'distribution'],
    view: ['chart', 'table'],
    top: ['10', '20', '30', 'all'],
    level: ['all', 'top'],
    distBy: ['group', 'case'],
  });
  const fmt = (v: number) => formatValue(v, locale);
  const lineById = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines]);
  const lineIndex = useMemo(() => new Map(lines.map((l, i) => [l.id, i])), [lines]);
  const ordered = useMemo(() => lines.map((l) => codeById.get(l.id)!).filter(Boolean), [lines, codeById]);

  // ── Code frequencies ────────────────────────────────────────────────────────────────
  const freq = useDeferredCompute(() => {
    if (s.chart !== 'frequency') return null;
    const list = s.level === 'top' ? ordered.filter((c) => lineById.get(c.id)?.depth === 0) : ordered.filter((c) => c.codable);
    const opts = { includeChildren: s.level === 'top', descendants: data.descendants };
    const bySeg = codeFrequencyBars(codings, list, { ...opts, measure: 'segments', sort: 'value', hideZero: true, limit: s.top === 'all' ? undefined : Number(s.top) });
    const docs = new Map(codeFrequencyBars(codings, list, { ...opts, measure: 'documents' }).map((b) => [b.codeId, b.value]));
    return bySeg.map((b) => ({ ...b, documents: docs.get(b.codeId) ?? 0 }));
  }, [s.chart, s.level, s.top, ordered, codings, lineById]);

  // ── Portraits ───────────────────────────────────────────────────────────────────────
  const portraitDefault = useMemo(() => lines.filter((l) => l.codable && (segments.get(l.id) ?? 0) > 0).map((l) => l.id), [lines, segments]);
  const portraitIds = useMemo(() => (s.portraitPicked ? inCodebookOrder(lines, s.portraitCodes) : portraitDefault), [s.portraitPicked, s.portraitCodes, lines, portraitDefault]);
  const portraits = useDeferredCompute(() => {
    if (s.chart !== 'portraits') return null;
    const chosen = portraitIds.map((id) => codeById.get(id)!).filter(Boolean);
    const want = new Set(portraitIds);
    const byDoc = groupBy(
      codings.filter((c) => want.has(c.code_id)),
      (c) => c.document_id,
    );
    const docs = s.portraitGroup ? documents.filter((d) => d.group_ids.includes(s.portraitGroup)) : documents;
    return docs.map((d) => ({ id: d.id, label: d.name, slices: documentPortrait(byDoc.get(d.id) ?? [], chosen, d.chars, { slices: SLICES }) }));
  }, [s.chart, portraitIds, s.portraitGroup, codings, documents, codeById]);

  // ── Distribution ────────────────────────────────────────────────────────────────────
  const distDefault = useMemo(() => {
    const roots = lines.filter((l) => l.depth === 0);
    const agg = data.tree.aggregate(segments);
    return [...roots]
      .map((l, i) => ({ l, i, n: agg.get(l.id)?.total ?? 0 }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n || a.i - b.i)
      .slice(0, 6)
      .sort((a, b) => a.i - b.i)
      .map((x) => x.l.id);
  }, [lines, segments, data.tree]);
  const distIds = useMemo(() => (s.distPicked ? inCodebookOrder(lines, s.distCodes).slice(0, MAX_SERIES) : distDefault), [s.distPicked, s.distCodes, lines, distDefault]);
  const distBy = s.distBy === 'group' && !groups.length ? 'case' : s.distBy;
  const dist = useDeferredCompute(() => {
    if (s.chart !== 'distribution' || !distIds.length) return null;
    const m = codeDocumentMatrix(codings, distIds, documents, {
      measure: 'segments',
      includeChildren: s.distSubcodes,
      descendants: data.descendants,
      groupBy: distBy === 'group' ? { by: 'group', groups } : { by: 'case', cases },
    });
    const cats = m.cols.map((c) => (c.kind === 'nocase' ? t('analysis.matrix.noCase') : c.label));
    const values = m.cols.map((_, j) => distIds.map((_, i) => m.cells[i]![j]!));
    return { cats, values };
  }, [s.chart, distIds, codings, documents, s.distSubcodes, distBy, groups, cases, t]);

  const series = useMemo(() => distIds.map((id) => ({ id, label: codeById.get(id)?.name ?? id, color: codeById.get(id)?.color ?? '#7a7f87' })), [distIds, codeById]);

  // ── Export ──────────────────────────────────────────────────────────────────────────
  const name = t(`analysis.charts.kinds.${s.chart}`);
  const doTable = (format: 'csv' | 'xlsx') => {
    if (s.chart === 'frequency' && freq.value) {
      const rows: (string | number)[][] = [[t('analysis.col.code'), t('analysis.charts.segments'), t('analysis.charts.documents')]];
      for (const b of freq.value) rows.push([pathLabel(lineById.get(b.codeId)?.path ?? [b.name]), b.value, b.documents]);
      void exporter.table(name, format, rows);
    } else if (s.chart === 'distribution' && dist.value) {
      const rows: (string | number)[][] = [[distBy === 'group' ? t('analysis.charts.group') : t('analysis.charts.case'), ...series.map((x) => x.label), t('analysis.total')]];
      dist.value.cats.forEach((cat, r) => rows.push([cat, ...dist.value!.values[r]!, dist.value!.values[r]!.reduce((a, b) => a + b, 0)]));
      void exporter.table(name, format, rows);
    } else if (s.chart === 'portraits' && portraits.value) {
      const rows: (string | number)[][] = [[t('analysis.charts.document'), t('analysis.charts.slice'), t('analysis.charts.from'), t('analysis.charts.to'), t('analysis.col.code'), t('analysis.charts.share')]];
      for (const p of portraits.value) p.slices.forEach((sl, k) => rows.push([p.label, k + 1, sl.start, sl.end, sl.codeId ? codeById.get(sl.codeId)?.name ?? '' : '', Math.round(sl.share * 1000) / 10]));
      void exporter.table(name, format, rows);
    }
  };

  // ── Panel ───────────────────────────────────────────────────────────────────────────
  const codeItems = (ids?: ReadonlySet<string>) =>
    lines.filter((l) => !ids || ids.has(l.id)).map((l) => ({ id: l.id, label: l.name, depth: l.depth, color: l.color, count: segments.get(l.id) ?? 0, search: pathLabel(l.path) }));
  const allItems = useMemo(() => codeItems(), [lines, segments]); // eslint-disable-line react-hooks/exhaustive-deps

  const panel = (
    <div className="an-form">
      <PanelSection title={t('analysis.charts.chart')}>
        <RadioGroup<Chart>
          label={t('analysis.charts.chart')}
          hideLabel
          value={s.chart}
          onChange={(chart) => set({ chart })}
          options={(['frequency', 'portraits', 'distribution'] as const).map((v) => ({ value: v, label: t(`analysis.charts.kinds.${v}`), description: t(`analysis.charts.hints.${v}`) }))}
          data-testid="charts-kind"
        />
      </PanelSection>
      {s.chart === 'frequency' ? (
        <PanelSection title={t('analysis.charts.options')}>
          <Select<Top>
            label={t('analysis.charts.top')}
            value={s.top}
            onChange={(top) => set({ top })}
            size="sm"
            options={[
              { value: '10', label: t('analysis.charts.topN', { n: 10 }) },
              { value: '20', label: t('analysis.charts.topN', { n: 20 }) },
              { value: '30', label: t('analysis.charts.topN', { n: 30 }) },
              { value: 'all', label: t('analysis.charts.allCodes') },
            ]}
            data-testid="charts-top"
          />
          <RadioGroup<'all' | 'top'>
            label={t('analysis.charts.level')}
            value={s.level}
            onChange={(level) => set({ level })}
            options={[
              { value: 'all', label: t('analysis.charts.levelAll') },
              { value: 'top', label: t('analysis.charts.levelTop'), description: t('analysis.charts.levelTopHint') },
            ]}
            data-testid="charts-level"
          />
        </PanelSection>
      ) : null}
      {s.chart === 'portraits' ? (
        <>
          <PanelSection title={t('analysis.charts.documents')}>
            <Select<string>
              value={s.portraitGroup}
              onChange={(portraitGroup) => set({ portraitGroup })}
              size="sm"
              aria-label={t('analysis.charts.documents')}
              options={[{ value: '', label: t('analysis.charts.allDocuments') }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
              data-testid="charts-portrait-group"
            />
          </PanelSection>
          <PanelSection title={t('analysis.charts.codes')}>
            <PickList
              label={t('analysis.charts.codes')}
              items={allItems}
              selected={new Set(portraitIds)}
              onChange={(ids) => set({ portraitPicked: true, portraitCodes: [...ids] })}
              presets={[{ label: t('analysis.pick.used'), ids: () => portraitDefault }]}
              testId="charts-portrait-codes"
            />
            <p className="an-hint">{t('analysis.charts.portraitHint')}</p>
          </PanelSection>
        </>
      ) : null}
      {s.chart === 'distribution' ? (
        <>
          <PanelSection title={t('analysis.charts.across')}>
            <RadioGroup<'group' | 'case'>
              label={t('analysis.charts.across')}
              hideLabel
              variant="segmented"
              value={distBy}
              onChange={(v) => set({ distBy: v })}
              options={[
                { value: 'group', label: t('analysis.charts.groups'), disabled: !groups.length },
                { value: 'case', label: t('analysis.charts.cases'), disabled: !cases.length },
              ]}
              data-testid="charts-dist-by"
            />
            <Checkbox label={t('analysis.charts.normalised')} checked={s.normalised} onChange={(normalised) => set({ normalised })} data-testid="charts-normalised" />
          </PanelSection>
          <PanelSection title={t('analysis.charts.codes')}>
            <PickList
              label={t('analysis.charts.codes')}
              items={allItems}
              selected={new Set(distIds)}
              onChange={(ids) => set({ distPicked: true, distCodes: [...ids] })}
              max={MAX_SERIES}
              presets={[{ label: t('analysis.pick.suggested'), ids: () => distDefault }]}
              testId="charts-dist-codes"
            />
            <Checkbox label={t('analysis.includeSubcodes')} checked={s.distSubcodes} onChange={(distSubcodes) => set({ distSubcodes })} />
          </PanelSection>
        </>
      ) : null}
    </div>
  );

  // ── Body ────────────────────────────────────────────────────────────────────────────
  const spinner = (
    <div className="an__center">
      <Spinner size={20} label={t('analysis.computing')} />
    </div>
  );
  let body: React.ReactNode = spinner;
  let meta: React.ReactNode = null;
  const col = SERIES[theme];
  if (s.chart === 'frequency') {
    const v = freq.value;
    if (v && !v.length) body = <ResultsMessage icon={BarChart3} title={t('analysis.nothingYet')}>{t('analysis.nothingYetBody')}</ResultsMessage>;
    else if (v) {
      meta = tp('common.count.codes', v.length);
      body =
        s.view === 'table' ? (
          <SimpleTable
            head={[t('analysis.col.code'), t('analysis.charts.segments'), t('analysis.charts.documents')]}
            rows={v.map((b) => [b.name, fmt(b.value), fmt(b.documents)])}
            colors={v.map((b) => b.color)}
            testId="charts-freq-table"
          />
        ) : (
          <div className="an-chartwrap">
            <BarPanels
              ref={svg}
              rows={v.map((b) => ({ id: b.codeId, label: b.name, color: b.color }))}
              panels={[
                { title: t('analysis.charts.segments'), values: v.map((b) => b.value), color: col.a },
                { title: t('analysis.charts.documents'), values: v.map((b) => b.documents), color: col.a },
              ]}
              theme={theme}
              format={fmt}
              label={t('analysis.charts.freqLabel', { n: v.length })}
              onRow={(r) => go({ name: 'segments', codeIds: [v[r]!.codeId] })}
              tip={(r) => (
                <>
                  <div className="an-tip__title">{pathLabel(lineById.get(v[r]!.codeId)?.path ?? [v[r]!.name])}</div>
                  <TipRow value={fmt(v[r]!.value)} label={t('analysis.charts.segments')} />
                  <TipRow value={fmt(v[r]!.documents)} label={t('analysis.charts.documents')} />
                  <div className="an-tip__hint">{t('analysis.charts.openSegments')}</div>
                </>
              )}
            />
            <p className="an-caption">{s.level === 'top' ? t('analysis.charts.freqCaptionTop') : t('analysis.charts.freqCaption')}</p>
          </div>
        );
    }
  } else if (s.chart === 'portraits') {
    const v = portraits.value;
    if (!documents.length) body = <ResultsMessage icon={GalleryVertical} title={t('analysis.nothingYet')}>{t('analysis.nothingYetBody')}</ResultsMessage>;
    else if (v) {
      meta = tp('common.count.documents', v.length);
      const used = new Set<string>();
      for (const p of v) for (const sl of p.slices) if (sl.codeId) used.add(sl.codeId);
      body = (
        <div className="an-chartwrap">
          <Portraits
            ref={svg}
            rows={v}
            theme={theme}
            label={t('analysis.charts.portraitLabel', { n: v.length })}
            startLabel={t('analysis.charts.start')}
            endLabel={t('analysis.charts.end')}
            onSlice={(r, k) => {
              const sl = v[r]!.slices[k]!;
              go({ name: 'workbench', docId: v[r]!.id, select: { start: sl.start, end: sl.start } });
            }}
            tip={(r, k) => {
              const p = v[r]!;
              const sl = p.slices[k]!;
              const n = p.slices.length || 1;
              return (
                <>
                  <div className="an-tip__title">{p.label}</div>
                  <div className="an-tip__sub">{t('analysis.charts.position', { from: Math.round((k / n) * 100), to: Math.round(((k + 1) / n) * 100) })}</div>
                  {sl.mix.length ? (
                    sl.mix.slice(0, 4).map((m) => <TipRow key={m.codeId} color={m.color} value={formatPercent(m.share * 100, locale, 0)} label={codeById.get(m.codeId)?.name ?? ''} />)
                  ) : (
                    <div className="an-tip__sub">{t('analysis.charts.uncoded')}</div>
                  )}
                  <div className="an-tip__hint">{t('analysis.charts.openAt')}</div>
                </>
              );
            }}
          />
          <div className="an-legend an-legend--wrap" aria-label={t('analysis.charts.legend')}>
            {[...used]
              .sort((a, b) => (lineIndex.get(a) ?? 0) - (lineIndex.get(b) ?? 0))
              .map((id) => (
                <span key={id} className="an-legend__item">
                  <span className="an-legend__swatch" style={{ background: codeById.get(id)?.color }} />
                  {codeById.get(id)?.name}
                </span>
              ))}
            <span className="an-legend__item">
              <span className="an-legend__swatch an-legend__swatch--diag" />
              {t('analysis.charts.uncoded')}
            </span>
          </div>
          <p className="an-caption">{t('analysis.charts.portraitCaption', { n: SLICES })}</p>
        </div>
      );
    }
  } else {
    const v = dist.value;
    if (!distIds.length) body = <ResultsMessage icon={ChartColumnStacked} title={t('analysis.charts.pickCodes')} />;
    else if (!groups.length && !cases.length) body = <ResultsMessage icon={ChartColumnStacked} title={t('analysis.charts.noGroupsOrCases')} />;
    else if (v) {
      meta = distBy === 'group' ? tp('analysis.count.groups', v.cats.length) : tp('common.count.cases', v.cats.length);
      body =
        s.view === 'table' ? (
          <SimpleTable
            head={[distBy === 'group' ? t('analysis.charts.group') : t('analysis.charts.case'), ...series.map((x) => x.label), t('analysis.total')]}
            rows={v.cats.map((cat, r) => [cat, ...v.values[r]!.map(fmt), fmt(v.values[r]!.reduce((a, b) => a + b, 0))])}
            headColors={[undefined, ...series.map((x) => x.color)]}
            testId="charts-dist-table"
          />
        ) : (
          <div className="an-chartwrap">
            <StackedBars
              ref={svg}
              categories={v.cats}
              series={series}
              values={v.values}
              normalised={s.normalised}
              theme={theme}
              format={fmt}
              label={t('analysis.charts.distLabel')}
              tip={(r, k) => {
                const total = v.values[r]!.reduce((a, b) => a + b, 0);
                const val = v.values[r]![k]!;
                return (
                  <>
                    <div className="an-tip__title">
                      {series[k]!.label} · {v.cats[r]}
                    </div>
                    <TipRow color={series[k]!.color} value={fmt(val)} label={t('analysis.charts.segments')} />
                    <TipRow value={formatPercent(total ? (val / total) * 100 : 0, locale)} label={t('analysis.charts.ofBar', { name: v.cats[r]! })} />
                  </>
                );
              }}
            />
            <p className="an-caption">{t('analysis.charts.distCaption')}</p>
          </div>
        );
    }
  }

  const busy = s.chart === 'frequency' ? freq.busy : s.chart === 'portraits' ? portraits.busy : dist.busy;
  const canTable = s.chart !== 'portraits';
  return (
    <ToolLayout label={t('analysis.tools.charts')} panel={panel} testId="tool-charts">
      <ResultsHead
        title={name}
        meta={
          <>
            {meta}
            {busy ? <span className="an-inline-spin"><Spinner size={12} /></span> : null}
          </>
        }
      >
        {canTable ? (
          <RadioGroup<'chart' | 'table'>
            label={t('analysis.view')}
            hideLabel
            variant="segmented"
            value={s.view}
            onChange={(view) => set({ view })}
            options={[
              { value: 'chart', label: <span className="an-seg-opt"><ImageIcon size={13} aria-hidden />{t('analysis.charts.chartView')}</span> },
              { value: 'table', label: <span className="an-seg-opt"><TableIcon size={13} aria-hidden />{t('analysis.charts.tableView')}</span> },
            ]}
            data-testid="charts-view"
          />
        ) : null}
        <ExportMenu
          tables={doTable}
          images={s.view === 'chart' || !canTable ? (f) => void exporter.image(name, f, svg.current, theme) : undefined}
          disabled={s.chart === 'frequency' ? !freq.value?.length : s.chart === 'portraits' ? !portraits.value?.length : !dist.value}
          testId="charts-export"
        />
      </ResultsHead>
      <div className="an-results__body an-results__body--scroll">{body}</div>
    </ToolLayout>
  );
}

function SimpleTable({ head, rows, colors, headColors, testId }: { head: string[]; rows: string[][]; colors?: (string | undefined)[]; headColors?: (string | undefined)[]; testId?: string }) {
  return (
    <div className="an-wtable-wrap">
      <table className="an-wtable" data-testid={testId}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className={i > 0 ? 'an-num' : undefined}>
                {headColors?.[i] ? <span className="an-dot" style={{ background: headColors[i] }} aria-hidden /> : null}
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, k) => (
            <tr key={k}>
              {r.map((cell, i) => (
                <td key={i} className={i > 0 ? 'an-num' : undefined}>
                  {i === 0 && colors?.[k] ? <span className="an-dot" style={{ background: colors[k] }} aria-hidden /> : null}
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

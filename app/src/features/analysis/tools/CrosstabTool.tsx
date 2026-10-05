import React, { useMemo, useState } from 'react';
import { Table2 } from 'lucide-react';
import type { Attribute, Case, Document } from '../../../core/model/types';
import { attributeBuckets, attributeValue, type BinSpec } from '../../../core/qda/attributes';
import { codeAttributeCrosstab, type CrosstabMeasure, type PercentMode } from '../../../core/qda/crosstab';
import { Checkbox, RadioGroup } from '../../../ui/components/Choice';
import { Notice, Spinner } from '../../../ui/components/Feedback';
import { Select } from '../../../ui/components/Field';
import { useI18n } from '../../../ui/i18n';
import { TipRow } from '../charts/ChartTip';
import { HeatTable, type HeatRow } from '../charts/HeatTable';
import { visibleLines } from '../lib/codeLines';
import { type Cell, formatP, formatPercent, formatValue, pathLabel } from '../lib/format';
import { heatScale } from '../lib/heat';
import { useAnalysisData, useDeferredCompute, useTheme } from '../parts/data';
import { useExporter } from '../parts/exporting';
import { HeatLegend } from '../parts/HeatLegend';
import { SegmentList } from '../parts/SegmentList';
import { ExportMenu, PanelSection, ResultsHead, ResultsMessage, Sheet, ToolLayout } from '../parts/ui';
import { useToolSettings } from '../parts/useToolSettings';

type Bins = 'auto' | 'distinct' | 'q2' | 'q3' | 'q4' | 'q5';
const BINS: Bins[] = ['auto', 'distinct', 'q2', 'q3', 'q4', 'q5'];

const DEFAULTS = {
  attributeId: '',
  measure: 'documents' as CrosstabMeasure,
  percent: 'none' as PercentMode,
  bins: 'auto' as Bins,
  subcodes: true,
  hideEmpty: true,
  collapsed: [] as string[],
};

function binSpec(b: Bins): BinSpec | undefined {
  if (b === 'auto') return undefined;
  if (b === 'distinct') return { kind: 'distinct' };
  return { kind: 'quantile', count: Number(b.slice(1)) };
}

export function CrosstabTool() {
  const { t, tp, locale } = useI18n();
  const data = useAnalysisData();
  const { lines, codings, documents, cases, attributes, codeById } = data;
  const theme = useTheme();
  const exporter = useExporter();
  const [s, set] = useToolSettings('crosstab', DEFAULTS, { measure: ['segments', 'documents', 'cases'], percent: ['none', 'row', 'column'], bins: BINS });
  const [cell, setCell] = useState<{ r: number; c: number } | null>(null);
  const attribute = attributes.find((a) => a.id === s.attributeId) ?? attributes[0];

  const result = useDeferredCompute(() => {
    if (!attribute) return null;
    return codeAttributeCrosstab(codings, lines.map((l) => l.id), documents, cases, attribute, {
      measure: s.measure,
      percent: s.percent,
      bins: attribute.type === 'number' ? binSpec(s.bins) : undefined,
      includeChildren: s.subcodes,
      descendants: data.descendants,
    });
  }, [attribute, codings, lines, documents, cases, s.measure, s.percent, s.bins, s.subcodes]);
  const x = result.value;

  const rowIndex = useMemo(() => new Map(lines.map((l, i) => [l.id, i])), [lines]);
  const collapsed = useMemo(() => new Set(s.collapsed), [s.collapsed]);
  const shownLines = useMemo(() => {
    let v = visibleLines(lines, collapsed);
    if (s.hideEmpty && x) v = v.filter((l) => (x.rowTotals[rowIndex.get(l.id)!] ?? 0) > 0);
    return v;
  }, [lines, collapsed, s.hideEmpty, x, rowIndex]);

  const bucketLabel = (b: { kind: string; label: string; value?: unknown }) =>
    b.kind === 'empty' ? t('analysis.crosstab.noValue') : b.kind === 'other' ? t('analysis.crosstab.other') : b.value === true ? t('common.yes') : b.value === false ? t('common.no') : b.label;
  const unitCount = (n: number) => (s.measure === 'cases' ? tp('common.count.cases', n) : tp('common.count.documents', n));
  const cols = useMemo(
    () => (x?.buckets ?? []).map((b, j) => ({ key: b.key, label: bucketLabel(b), sub: `n = ${x!.bases[j]}`, muted: b.kind === 'empty' || b.kind === 'other' })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [x, t],
  );
  const rows = useMemo<HeatRow[]>(
    () => shownLines.map((l) => ({ id: l.id, label: l.name, depth: l.depth, color: l.color, hasChildren: l.hasChildren, collapsed: collapsed.has(l.id), title: pathLabel(l.path) })),
    [shownLines, collapsed],
  );
  const pct = s.percent !== 'none';
  const valueOf = (r: number, c: number): number => {
    if (!x) return 0;
    const i = rowIndex.get(shownLines[r]!.id)!;
    return pct ? x.percents?.[i]?.[c] ?? 0 : x.counts[i]?.[c] ?? 0;
  };
  const fmt = (v: number) => (pct ? formatPercent(v, locale, v >= 10 ? 0 : 1) : formatValue(v, locale));
  const scale = useMemo(() => heatScale(shownLines.map((_, r) => cols.map((__, c) => valueOf(r, c))), { theme }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [x, shownLines, cols, theme, pct]);

  const testOf = (r: number) => (x ? x.tests[rowIndex.get(shownLines[r]!.id)!] ?? null : null);
  const tested = s.measure !== 'segments';
  const anyLow = useMemo(() => (x ? shownLines.some((l) => (x.tests[rowIndex.get(l.id)!]?.lowExpectedShare ?? 0) > 0.2) : false), [x, shownLines, rowIndex]);

  const measureLabel = t(`analysis.crosstab.measures.${s.measure}`);
  const tooltip = (r: number, c: number) => {
    if (!x) return null;
    const i = rowIndex.get(shownLines[r]!.id)!;
    const count = x.counts[i]?.[c] ?? 0;
    const p = x.percents?.[i]?.[c];
    return (
      <>
        <div className="an-tip__title">
          {shownLines[r]!.name} · {cols[c]!.label}
        </div>
        <TipRow value={formatValue(count, locale)} label={measureLabel} />
        {p !== undefined && p !== null ? <TipRow value={formatPercent(p, locale)} label={s.percent === 'row' ? t('analysis.crosstab.ofRow') : t('analysis.crosstab.ofColumn')} /> : null}
        <TipRow value={formatValue(x.bases[c] ?? 0, locale)} label={s.measure === 'cases' ? t('analysis.crosstab.casesInColumn') : t('analysis.crosstab.docsInColumn')} />
        {count > 0 ? <div className="an-tip__hint">{t('analysis.clickForSegments')}</div> : null}
      </>
    );
  };

  const toggle = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ collapsed: [...next] });
  };

  const doTable = (format: 'csv' | 'xlsx') => {
    if (!x || !attribute) return;
    const list = s.hideEmpty ? lines.filter((l) => (x.rowTotals[rowIndex.get(l.id)!] ?? 0) > 0) : lines;
    const header: Cell[] = [t('analysis.col.code'), ...cols.flatMap((c) => (pct ? [c.label, `${c.label} %`] : [c.label])), t('analysis.total')];
    if (tested) header.push('χ²', 'df', 'p', "Cramér's V");
    const out: Cell[][] = [header];
    out.push([t('analysis.crosstab.base'), ...cols.flatMap((_, j) => (pct ? [x.bases[j] ?? 0, null] : [x.bases[j] ?? 0])), null]);
    for (const l of list) {
      const i = rowIndex.get(l.id)!;
      const row: Cell[] = [pathLabel(l.path)];
      cols.forEach((_, j) => {
        row.push(x.counts[i]?.[j] ?? 0);
        if (pct) {
          const p = x.percents?.[i]?.[j];
          row.push(p === null || p === undefined ? null : Math.round(p * 10) / 10);
        }
      });
      row.push(x.rowTotals[i] ?? 0);
      if (tested) {
        const tr = x.tests[i];
        row.push(tr ? Math.round(tr.chi2 * 1000) / 1000 : null, tr?.df ?? null, tr ? Number(tr.p.toPrecision(3)) : null, tr ? Math.round(tr.cramersV * 1000) / 1000 : null);
      }
      out.push(row);
    }
    void exporter.table(`${t('analysis.crosstab.exportName')} – ${attribute.name}`, format, out, t('analysis.tools.crosstab'));
  };

  const sheetCodings = useMemo(() => {
    if (!cell || !x || !attribute) return [];
    const line = shownLines[cell.r];
    const bucket = x.buckets[cell.c];
    if (!line || !bucket) return [];
    const ids = new Set([line.id, ...(s.subcodes ? data.descendants(line.id).map((c) => c.id) : [])]);
    const docsIn = docsInBucket(x.buckets.map((b) => b.key), cell.c, documents, cases, attribute, s.bins);
    return codings.filter((c) => ids.has(c.code_id) && docsIn.has(c.document_id));
  }, [cell, x, shownLines, s.subcodes, s.bins, codings, documents, cases, attribute, data]);

  const panel = (
    <div className="an-form">
      <PanelSection title={t('analysis.crosstab.attribute')}>
        {attributes.length ? (
          <Select<string>
            value={attribute?.id ?? ''}
            onChange={(attributeId) => set({ attributeId })}
            options={attributes.map((a) => ({ value: a.id, label: a.name }))}
            aria-label={t('analysis.crosstab.attribute')}
            size="sm"
            data-testid="crosstab-attribute"
          />
        ) : (
          <p className="an-hint">{t('analysis.crosstab.noAttributes')}</p>
        )}
        {attribute?.type === 'number' ? (
          <Select<Bins>
            label={t('analysis.crosstab.bins')}
            value={s.bins}
            onChange={(bins) => set({ bins })}
            options={BINS.map((b) => ({ value: b, label: t(`analysis.crosstab.binOptions.${b}`) }))}
            size="sm"
            data-testid="crosstab-bins"
          />
        ) : null}
      </PanelSection>
      <PanelSection title={t('analysis.crosstab.measure')}>
        <RadioGroup<CrosstabMeasure>
          label={t('analysis.crosstab.measure')}
          hideLabel
          value={s.measure}
          onChange={(measure) => set({ measure })}
          options={(['segments', 'documents', 'cases'] as const).map((v) => ({ value: v, label: t(`analysis.crosstab.measures.${v}`), description: t(`analysis.crosstab.measureHints.${v}`) }))}
          data-testid="crosstab-measure"
        />
      </PanelSection>
      <PanelSection title={t('analysis.crosstab.percent')}>
        <RadioGroup<PercentMode>
          label={t('analysis.crosstab.percent')}
          hideLabel
          variant="segmented"
          value={s.percent}
          onChange={(percent) => set({ percent })}
          options={[
            { value: 'none', label: t('analysis.crosstab.percents.none') },
            { value: 'row', label: t('analysis.crosstab.percents.row') },
            { value: 'column', label: t('analysis.crosstab.percents.column') },
          ]}
          data-testid="crosstab-percent"
        />
      </PanelSection>
      <PanelSection title={t('analysis.rows')}>
        <div className="an-checks">
          <Checkbox label={t('analysis.includeSubcodes')} checked={s.subcodes} onChange={(subcodes) => set({ subcodes })} />
          <Checkbox label={t('analysis.hideEmpty')} checked={s.hideEmpty} onChange={(hideEmpty) => set({ hideEmpty })} data-testid="crosstab-hide-empty" />
        </div>
      </PanelSection>
    </div>
  );

  let body: React.ReactNode;
  if (!attribute) {
    body = <ResultsMessage icon={Table2} title={t('analysis.crosstab.noAttributes')}>{t('analysis.crosstab.noAttributesBody')}</ResultsMessage>;
  } else if (result.error) {
    body = (
      <div className="an-pad">
        <Notice tone="danger">{String(result.error)}</Notice>
      </div>
    );
  } else if (!x) {
    body = (
      <div className="an__center">
        <Spinner size={20} label={t('analysis.computing')} />
      </div>
    );
  } else if (!shownLines.length) {
    body = <ResultsMessage icon={Table2} title={t('analysis.nothingYet')}>{t('analysis.nothingYetBody')}</ResultsMessage>;
  } else {
    body = (
      <div className="an-tablewrap">
        <HeatTable
          rows={rows}
          cols={cols}
          value={valueOf}
          text={(r, c) => fmt(valueOf(r, c))}
          scale={scale}
          rowTotal={pct ? undefined : (r) => formatValue(x.rowTotals[rowIndex.get(shownLines[r]!.id)!] ?? 0, locale)}
          colTotals={pct ? undefined : x.colTotals.map((v) => formatValue(v, locale))}
          grandTotal={formatValue(x.grandTotal, locale)}
          totalLabel={t('analysis.total')}
          corner={t('analysis.crosstab.corner', { measure: measureLabel, attribute: attribute.name })}
          onCell={(r, c) => setCell({ r, c })}
          onToggle={toggle}
          toggleLabel={(row) => (row.collapsed ? t('analysis.expandCode', { name: row.label }) : t('analysis.collapseCode', { name: row.label }))}
          tooltip={tooltip}
          label={t('analysis.tools.crosstab')}
          vertical={cols.length > 7}
          extra={
            tested
              ? [
                  {
                    key: 'chi',
                    label: t('analysis.crosstab.test'),
                    width: 100,
                    render: (r) => {
                      const tr = testOf(r);
                      if (!tr) return <span className="t-muted">–</span>;
                      const low = tr.lowExpectedShare > 0.2;
                      return (
                        <span className={tr.p < 0.05 ? 'an-p an-p--strong' : 'an-p'} title={t('analysis.crosstab.testTitle', { chi: tr.chi2.toFixed(2), df: tr.df, v: tr.cramersV.toFixed(2) })}>
                          p {formatP(tr.p, locale)}
                          {low ? '*' : ''}
                        </span>
                      );
                    },
                  },
                ]
              : []
          }
          testId="crosstab-table"
        />
        <HeatLegend theme={theme} max={scale.max} format={fmt} />
        <div className="an-note" data-testid="crosstab-caveat">
          {tested ? (
            <>
              <p>{t('analysis.crosstab.chiExplain', { attribute: attribute.name, unit: s.measure === 'cases' ? t('analysis.crosstab.unitCases') : t('analysis.crosstab.unitDocs') })}</p>
              <p className="an-note__caveat">{t('analysis.crosstab.chiCaveat')}</p>
              {anyLow ? <p className="an-note__caveat">{t('analysis.crosstab.lowExpected')}</p> : null}
            </>
          ) : (
            <p>{t('analysis.crosstab.noTestForSegments')}</p>
          )}
        </div>
      </div>
    );
  }

  const sheetRow = cell ? shownLines[cell.r] : undefined;
  const sheetCol = cell ? cols[cell.c] : undefined;

  return (
    <ToolLayout
      label={t('analysis.tools.crosstab')}
      panel={panel}
      testId="tool-crosstab"
      sheet={
        cell && sheetRow && sheetCol ? (
          <Sheet open onClose={() => setCell(null)} title={`${codeById.get(sheetRow.id)?.name ?? ''} · ${sheetCol.label}`} subtitle={tp('common.count.codings', sheetCodings.length)} testId="crosstab-sheet">
            <SegmentList codings={sheetCodings} />
          </Sheet>
        ) : null
      }
    >
      <ResultsHead
        title={attribute ? t('analysis.crosstab.title', { attribute: attribute.name }) : t('analysis.tools.crosstab')}
        meta={
          x ? (
            <>
              {unitCount(x.bases.reduce((a, b) => a + b, 0))}
              {result.busy ? <span className="an-inline-spin"><Spinner size={12} /></span> : null}
            </>
          ) : null
        }
      >
        <ExportMenu tables={doTable} disabled={!x} testId="crosstab-export" />
      </ResultsHead>
      <div className={`an-results__body an-results__body--scroll${result.busy && x ? ' an-results__body--stale' : ''}`}>{body}</div>
    </ToolLayout>
  );
}


/** Ids of the documents whose case falls in bucket `index` (same bucketing as the crosstab). */
function docsInBucket(keys: readonly string[], index: number, documents: readonly Document[], cases: readonly Case[], attribute: Attribute, bins: Bins): Set<string> {
  const live = cases.filter((c) => !c.deleted);
  const byId = new Map(live.map((c) => [c.id, c]));
  const b = attributeBuckets(live, attribute, attribute.type === 'number' ? binSpec(bins) : undefined);
  const want = keys[index];
  const out = new Set<string>();
  for (const d of documents) {
    const c = d.case_id !== null ? byId.get(d.case_id) : undefined;
    if (b.keyOf(attributeValue(c, attribute.id)) === want) out.add(d.id);
  }
  return out;
}

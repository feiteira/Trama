import React, { useMemo, useRef, useState } from 'react';
import { Grid3x3, Network as NetworkIcon } from 'lucide-react';
import { cooccurrence, type CooccurrenceMode, pairsOf } from '../../../core/qda/cooccurrence';
import { Checkbox, RadioGroup } from '../../../ui/components/Choice';
import { Notice, Spinner } from '../../../ui/components/Feedback';
import { TextField } from '../../../ui/components/Field';
import { useI18n } from '../../../ui/i18n';
import { TipRow } from '../charts/ChartTip';
import { Heatmap } from '../charts/Heatmap';
import { Network } from '../charts/Network';
import { defaultCodeSelection, inCodebookOrder } from '../lib/codeLines';
import { formatValue, matrixRows, pathLabel } from '../lib/format';
import { heatScale } from '../lib/heat';
import { edgesOf } from '../lib/network';
import { useAnalysisData, useDeferredCompute, useTexts, useTheme } from '../parts/data';
import { useExporter } from '../parts/exporting';
import { HeatLegend } from '../parts/HeatLegend';
import { PairList, SegmentList } from '../parts/SegmentList';
import { ExportMenu, PanelSection, PickList, ResultsHead, ResultsMessage, Sheet, ToolLayout } from '../parts/ui';
import { useToolSettings } from '../parts/useToolSettings';

const MAX_CODES = 40;
const MODES: CooccurrenceMode[] = ['overlap', 'paragraph', 'proximity'];

const DEFAULTS = {
  picked: false,
  codeIds: [] as string[],
  mode: 'overlap' as CooccurrenceMode,
  distance: 200,
  measure: 'count' as 'count' | 'jaccard',
  view: 'matrix' as 'matrix' | 'network',
  subcodes: false,
};

export function CooccurrenceTool() {
  const { t, tp, locale } = useI18n();
  const data = useAnalysisData();
  const { lines, codings, segments, codeById } = data;
  const theme = useTheme();
  const [s, set] = useToolSettings('cooccurrence', DEFAULTS, { mode: MODES, measure: ['count', 'jaccard'], view: ['matrix', 'network'] });
  const [distanceText, setDistanceText] = useState(String(s.distance));
  const [cell, setCell] = useState<{ a: string; b: string } | null>(null);
  const texts = useTexts(s.mode === 'paragraph');
  const exporter = useExporter();
  const svg = useRef<SVGSVGElement>(null);

  const defaults = useMemo(() => defaultCodeSelection(lines, segments, MAX_CODES), [lines, segments]);
  const codeIds = useMemo(() => (s.picked ? inCodebookOrder(lines, s.codeIds) : defaults), [s.picked, s.codeIds, lines, defaults]);

  const waitingTexts = s.mode === 'paragraph' && !texts;
  const result = useDeferredCompute(() => {
    if (codeIds.length < 2 || waitingTexts) return null;
    return cooccurrence(codings, codeIds, {
      mode: s.mode,
      distance: s.distance,
      texts: s.mode === 'paragraph' ? texts ?? undefined : undefined,
      includeChildren: s.subcodes,
      descendants: data.descendants,
      details: true,
    });
  }, [codings, codeIds, s.mode, s.distance, s.subcodes, texts, waitingTexts]);
  const r = result.value;

  const values = useMemo(() => (r ? (s.measure === 'jaccard' ? r.jaccard : r.matrix) : []), [r, s.measure]);
  const scale = useMemo(() => heatScale(values, { theme, skipDiagonal: true }), [values, theme, s.measure]);
  const labels = useMemo(() => (r ? r.codes.map((id) => ({ id, label: codeById.get(id)?.name ?? id, color: codeById.get(id)?.color })) : []), [r, codeById]);
  const pathOf = (id: string) => pathLabel(lines.find((l) => l.id === id)?.path ?? [codeById.get(id)?.name ?? id]);
  const fmt = (v: number, i: number, j: number) => {
    if (i === j) return formatValue(r?.segmentCounts[i] ?? 0, locale);
    if (s.measure === 'jaccard') return v === 0 ? '' : v.toFixed(2).replace(/^0/, '');
    return formatValue(v, locale);
  };
  const totalPairs = useMemo(() => {
    if (!r) return 0;
    let n = 0;
    for (let i = 0; i < r.matrix.length; i++) for (let j = i + 1; j < r.matrix.length; j++) n += r.matrix[i]![j]!;
    return n;
  }, [r]);

  const tooltip = (i: number, j: number) => {
    if (!r) return null;
    const a = labels[i]!;
    const b = labels[j]!;
    if (i === j)
      return (
        <>
          <div className="an-tip__title">{a.label}</div>
          <TipRow value={formatValue(r.segmentCounts[i] ?? 0, locale)} label={t('analysis.cooc.ownSegments')} />
        </>
      );
    return (
      <>
        <div className="an-tip__title">
          {a.label} × {b.label}
        </div>
        <TipRow value={formatValue(r.matrix[i]![j]!, locale)} label={t('analysis.cooc.pairs')} />
        <TipRow value={r.jaccard[i]![j]!.toFixed(2)} label={t('analysis.cooc.jaccard')} />
        <TipRow value={t('analysis.cooc.nOfM', { n: r.segmentsWith[i]![j]!, m: r.segmentCounts[i] ?? 0 })} label={t('analysis.cooc.segmentsOfWith', { a: a.label })} />
        {r.matrix[i]![j]! > 0 ? <div className="an-tip__hint">{t('analysis.clickForPassages')}</div> : null}
      </>
    );
  };

  const nodes = useMemo(() => labels.map((l, i) => ({ id: l.id, label: l.label, color: l.color ?? '#7a7f87', weight: r?.segmentCounts[i] ?? 0 })), [labels, r]);
  const edges = useMemo(() => (r ? edgesOf(r.matrix) : []), [r]);
  const layoutKey = `${codeIds.join(',')}|${s.mode}|${s.distance}|${s.subcodes}|${edges.length}`;

  const doTable = (format: 'csv' | 'xlsx') => {
    if (!r) return;
    const rows = matrixRows(
      t('analysis.col.code'),
      r.codes.map(pathOf),
      r.codes.map(pathOf),
      values.map((row, i) => row.map((v, j) => (i === j ? r.segmentCounts[i]! : s.measure === 'jaccard' ? Math.round(v * 1000) / 1000 : v))),
    );
    void exporter.table(t('analysis.cooc.exportName'), format, rows, t('analysis.tools.cooccurrence'));
  };

  const codeItems = useMemo(
    () => lines.map((l) => ({ id: l.id, label: l.name, depth: l.depth, color: l.color, count: segments.get(l.id) ?? 0, search: pathLabel(l.path) })),
    [lines, segments],
  );

  const panel = (
    <div className="an-form">
      <PanelSection title={t('analysis.cooc.codes')}>
        <PickList
          label={t('analysis.cooc.codes')}
          items={codeItems}
          selected={new Set(codeIds)}
          onChange={(ids) => set({ picked: true, codeIds: [...ids] })}
          max={MAX_CODES}
          presets={[{ label: t('analysis.pick.used'), ids: () => defaults }]}
          testId="cooc-codes"
        />
        <Checkbox label={t('analysis.includeSubcodes')} description={t('analysis.includeSubcodesHint')} checked={s.subcodes} onChange={(subcodes) => set({ subcodes })} data-testid="cooc-subcodes" />
      </PanelSection>
      <PanelSection title={t('analysis.cooc.mode')}>
        <RadioGroup<CooccurrenceMode>
          label={t('analysis.cooc.mode')}
          hideLabel
          value={s.mode}
          onChange={(mode) => set({ mode })}
          options={[
            { value: 'overlap', label: t('analysis.cooc.modes.overlap'), description: t('analysis.cooc.modes.overlapHint') },
            { value: 'paragraph', label: t('analysis.cooc.modes.paragraph'), description: t('analysis.cooc.modes.paragraphHint') },
            { value: 'proximity', label: t('analysis.cooc.modes.proximity'), description: t('analysis.cooc.modes.proximityHint') },
          ]}
          data-testid="cooc-mode"
        />
        {s.mode === 'proximity' ? (
          <TextField
            label={t('analysis.cooc.distance')}
            type="number"
            min={0}
            max={100000}
            step={50}
            size="sm"
            value={distanceText}
            onChange={(v) => {
              setDistanceText(v);
              const n = Math.round(Number(v));
              if (v.trim() !== '' && Number.isFinite(n) && n >= 0) set({ distance: Math.min(100000, n) });
            }}
            data-testid="cooc-distance"
          />
        ) : null}
      </PanelSection>
      <PanelSection title={t('analysis.cooc.values')}>
        <RadioGroup<'count' | 'jaccard'>
          label={t('analysis.cooc.values')}
          hideLabel
          variant="segmented"
          value={s.measure}
          onChange={(measure) => set({ measure })}
          options={[
            { value: 'count', label: t('analysis.cooc.count') },
            { value: 'jaccard', label: t('analysis.cooc.jaccardShort') },
          ]}
          data-testid="cooc-measure"
        />
        <p className="an-hint">{s.measure === 'jaccard' ? t('analysis.cooc.jaccardHint') : t('analysis.cooc.countHint')}</p>
      </PanelSection>
    </div>
  );

  let body: React.ReactNode;
  if (codeIds.length < 2) {
    body = (
      <ResultsMessage icon={Grid3x3} title={t('analysis.cooc.needTwo')} testId="cooc-empty">
        {t('analysis.cooc.needTwoBody')}
      </ResultsMessage>
    );
  } else if (result.error) {
    body = (
      <div className="an-pad">
        <Notice tone="danger">{String(result.error)}</Notice>
      </div>
    );
  } else if (!r) {
    body = (
      <div className="an__center">
        <Spinner size={20} label={t('analysis.computing')} />
      </div>
    );
  } else if (s.view === 'network') {
    body = (
      <div className="an-chartwrap">
        {edges.length === 0 ? <Notice tone="info">{t('analysis.cooc.noEdges')}</Notice> : null}
        <Network
          ref={svg}
          nodes={nodes}
          edges={edges}
          theme={theme}
          label={t('analysis.cooc.networkLabel', { n: nodes.length })}
          layoutKey={layoutKey}
          nodeTip={(i) => (
            <>
              <div className="an-tip__title">{nodes[i]!.label}</div>
              <TipRow value={formatValue(nodes[i]!.weight, locale)} label={t('analysis.cooc.ownSegments')} />
              <TipRow value={formatValue(edges.filter((e) => e.a === i || e.b === i).length, locale)} label={t('analysis.cooc.linkedCodes')} />
            </>
          )}
          edgeTip={(e) => tooltip(e.a, e.b)}
          onEdge={(e) => setCell({ a: r.codes[e.a]!, b: r.codes[e.b]! })}
        />
        <p className="an-caption">{t('analysis.cooc.networkCaption')}</p>
      </div>
    );
  } else {
    body = (
      <div className="an-chartwrap">
        <Heatmap
          ref={svg}
          rows={labels}
          cols={labels}
          values={values}
          scale={scale}
          diagonal
          format={fmt}
          tooltip={tooltip}
          onCell={(i, j) => setCell({ a: r.codes[i]!, b: r.codes[j]! })}
          label={t('analysis.cooc.matrixLabel', { n: labels.length })}
          roleDescription={t('analysis.cooc.matrixRole')}
          theme={theme}
          testId="cooc-heatmap"
        />
        <HeatLegend theme={theme} max={scale.max} low={s.measure === 'jaccard' ? 0 : undefined} format={(v) => (s.measure === 'jaccard' ? v.toFixed(2) : formatValue(v, locale))} diagonal={t('analysis.cooc.diagonal')} />
      </div>
    );
  }

  const codingsOf = (id: string) => {
    const ids = new Set([id, ...(s.subcodes ? data.descendants(id).map((d) => d.id) : [])]);
    return codings.filter((c) => ids.has(c.code_id));
  };

  const sheet =
    cell && r ? (
      <Sheet
        open
        onClose={() => setCell(null)}
        title={cell.a === cell.b ? codeById.get(cell.a)?.name : `${codeById.get(cell.a)?.name ?? ''} × ${codeById.get(cell.b)?.name ?? ''}`}
        subtitle={cell.a === cell.b ? tp('common.count.codings', r.segmentCounts[r.codes.indexOf(cell.a)] ?? 0) : tp('analysis.cooc.pairCount', pairsOf(r, cell.a, cell.b).length)}
        testId="cooc-sheet"
      >
        {cell.a === cell.b ? (
          <SegmentList codings={codingsOf(cell.a)} />
        ) : (
          <PairList pairs={pairsOf(r, cell.a, cell.b)} codeA={cell.a} codeB={cell.b} />
        )}
      </Sheet>
    ) : null;

  return (
    <ToolLayout label={t('analysis.tools.cooccurrence')} panel={panel} sheet={sheet} testId="tool-cooccurrence">
      <ResultsHead
        title={t('analysis.cooc.title', { n: codeIds.length })}
        meta={
          r ? (
            <>
              {tp('analysis.cooc.pairCount', totalPairs)}
              {result.busy ? <Spinner size={12} className="an-inline-spin" /> : null}
            </>
          ) : null
        }
      >
        <RadioGroup<'matrix' | 'network'>
          label={t('analysis.view')}
          hideLabel
          variant="segmented"
          value={s.view}
          onChange={(view) => set({ view })}
          options={[
            { value: 'matrix', label: <span className="an-seg-opt"><Grid3x3 size={13} aria-hidden />{t('analysis.cooc.matrix')}</span> },
            { value: 'network', label: <span className="an-seg-opt"><NetworkIcon size={13} aria-hidden />{t('analysis.cooc.network')}</span> },
          ]}
          data-testid="cooc-view"
        />
        <ExportMenu tables={doTable} images={(f) => void exporter.image(t('analysis.cooc.exportName'), f, svg.current, theme)} disabled={!r} testId="cooc-export" />
      </ResultsHead>
      <div className={`an-results__body an-results__body--scroll${result.busy && r ? ' an-results__body--stale' : ''}`}>{body}</div>
    </ToolLayout>
  );
}

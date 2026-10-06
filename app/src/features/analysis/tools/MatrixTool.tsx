import React, { useMemo, useState } from 'react';
import { Grid3x3 } from 'lucide-react';
import { codeDocumentMatrix, type DocumentGrouping, type MatrixMeasure } from '../../../core/qda/matrix';
import { Checkbox, RadioGroup } from '../../../ui/components/Choice';
import { Notice, Spinner } from '../../../ui/components/Feedback';
import { useI18n } from '../../../ui/i18n';
import { TipRow } from '../charts/ChartTip';
import { HeatTable, type HeatRow } from '../charts/HeatTable';
import { visibleLines } from '../lib/codeLines';
import { formatPercent, formatValue, matrixRows, pathLabel } from '../lib/format';
import { heatScale } from '../lib/heat';
import { presenceTotals } from '../lib/matrixTotals';
import { useAnalysisData, useDeferredCompute, useTheme } from '../parts/data';
import { useExporter } from '../parts/exporting';
import { HeatLegend } from '../parts/HeatLegend';
import { SegmentList } from '../parts/SegmentList';
import { ExportMenu, PanelSection, ResultsHead, ResultsMessage, Sheet, ToolLayout } from '../parts/ui';
import { useToolSettings } from '../parts/useToolSettings';

type Columns = 'document' | 'group' | 'case';
const MEASURES: MatrixMeasure[] = ['segments', 'characters', 'presence', 'percentOfDoc'];

const DEFAULTS = {
  columns: 'document' as Columns,
  measure: 'segments' as MatrixMeasure,
  subcodes: true,
  hideEmpty: false,
  collapsed: [] as string[],
};

export function MatrixTool() {
  const { t, tp, locale } = useI18n();
  const data = useAnalysisData();
  const { lines, codings, documents, groups, cases, codeById } = data;
  const theme = useTheme();
  const exporter = useExporter();
  const [s, set] = useToolSettings('matrix', DEFAULTS, { columns: ['document', 'group', 'case'], measure: MEASURES });
  const [cell, setCell] = useState<{ r: number; c: number } | null>(null);

  const grouping = useMemo<DocumentGrouping>(
    () => (s.columns === 'group' ? { by: 'group', groups } : s.columns === 'case' ? { by: 'case', cases } : { by: 'document' }),
    [s.columns, groups, cases],
  );

  const result = useDeferredCompute(
    () => codeDocumentMatrix(codings, lines.map((l) => l.id), documents, { measure: s.measure, includeChildren: s.subcodes, descendants: data.descendants, groupBy: grouping }),
    [codings, lines, documents, s.measure, s.subcodes, grouping],
  );
  // Presence: every total counts documents, like the cells (lib/matrixTotals.ts).
  const m = useMemo(() => (result.value ? presenceTotals(result.value, codings) : undefined), [result.value, codings]);

  const rowIndex = useMemo(() => new Map(lines.map((l, i) => [l.id, i])), [lines]);
  const collapsed = useMemo(() => new Set(s.collapsed), [s.collapsed]);
  const shownLines = useMemo(() => {
    let v = visibleLines(lines, collapsed);
    if (s.hideEmpty && m) v = v.filter((l) => (m.rowTotals[rowIndex.get(l.id)!] ?? 0) > 0);
    return v;
  }, [lines, collapsed, s.hideEmpty, m, rowIndex]);

  const rows = useMemo<HeatRow[]>(
    () => shownLines.map((l) => ({ id: l.id, label: l.name, depth: l.depth, color: l.color, hasChildren: l.hasChildren, collapsed: collapsed.has(l.id), title: pathLabel(l.path) })),
    [shownLines, collapsed],
  );
  const cols = useMemo(
    () =>
      (m?.cols ?? []).map((c) => ({
        key: c.key,
        label: c.kind === 'nocase' ? t('analysis.matrix.noCase') : c.label,
        sub: s.columns === 'document' ? undefined : tp('common.count.documents', c.documentIds.length),
        muted: c.kind === 'nocase',
      })),
    [m, s.columns, t, tp],
  );
  const scale = useMemo(() => {
    if (!m) return heatScale([], { theme });
    const vis = shownLines.map((l) => m.cells[rowIndex.get(l.id)!] ?? []);
    return heatScale(vis, { theme });
  }, [m, shownLines, rowIndex, theme]);

  const fmt = (v: number) => (s.measure === 'percentOfDoc' ? formatPercent(v, locale, v >= 10 ? 0 : 1) : s.measure === 'characters' ? compact(v, locale) : formatValue(v, locale));
  const valueOf = (r: number, c: number) => m?.cells[rowIndex.get(shownLines[r]!.id)!]?.[c] ?? 0;

  const measureLabel = t(`analysis.matrix.measures.${s.measure}`);
  const tooltip = (r: number, c: number) => {
    const line = shownLines[r]!;
    const col = cols[c]!;
    const v = valueOf(r, c);
    return (
      <>
        <div className="an-tip__title">
          {line.name} · {col.label}
        </div>
        <TipRow value={fmt(v)} label={measureLabel} />
        {v > 0 ? <div className="an-tip__hint">{t('analysis.clickForSegments')}</div> : null}
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
    if (!m) return;
    const list = s.hideEmpty ? lines.filter((l) => (m.rowTotals[rowIndex.get(l.id)!] ?? 0) > 0) : lines;
    const rowsOut = matrixRows(
      t('analysis.col.code'),
      list.map((l) => pathLabel(l.path)),
      cols.map((c) => c.label),
      list.map((l) => m.cells[rowIndex.get(l.id)!] ?? []),
      { label: t('analysis.total'), rows: list.map((l) => m.rowTotals[rowIndex.get(l.id)!] ?? 0), cols: m.colTotals, grand: m.grandTotal },
    );
    void exporter.table(`${t('analysis.matrix.exportName')} (${measureLabel})`, format, rowsOut, t('analysis.tools.matrix'));
  };

  const sheetCodings = useMemo(() => {
    if (!cell || !m) return [];
    const line = shownLines[cell.r];
    const col = m.cols[cell.c];
    if (!line || !col) return [];
    const ids = new Set([line.id, ...(s.subcodes ? data.descendants(line.id).map((c) => c.id) : [])]);
    const docs = new Set(col.documentIds);
    return codings.filter((c) => ids.has(c.code_id) && docs.has(c.document_id));
  }, [cell, m, shownLines, s.subcodes, codings, data]);

  const panel = (
    <div className="an-form">
      <PanelSection title={t('analysis.matrix.columns')}>
        <RadioGroup<Columns>
          label={t('analysis.matrix.columns')}
          hideLabel
          value={s.columns}
          onChange={(columns) => set({ columns })}
          options={[
            { value: 'document', label: t('analysis.matrix.byDocument') },
            { value: 'group', label: t('analysis.matrix.byGroup'), disabled: !groups.length },
            { value: 'case', label: t('analysis.matrix.byCase'), disabled: !cases.length },
          ]}
          data-testid="matrix-columns"
        />
      </PanelSection>
      <PanelSection title={t('analysis.matrix.measure')}>
        <RadioGroup<MatrixMeasure>
          label={t('analysis.matrix.measure')}
          hideLabel
          value={s.measure}
          onChange={(measure) => set({ measure })}
          options={MEASURES.map((v) => ({ value: v, label: t(`analysis.matrix.measures.${v}`), description: t(`analysis.matrix.measureHints.${v}`) }))}
          data-testid="matrix-measure"
        />
      </PanelSection>
      <PanelSection title={t('analysis.rows')}>
        <div className="an-checks">
          <Checkbox label={t('analysis.includeSubcodes')} description={t('analysis.matrix.subcodesHint')} checked={s.subcodes} onChange={(subcodes) => set({ subcodes })} data-testid="matrix-subcodes" />
          <Checkbox label={t('analysis.hideEmpty')} checked={s.hideEmpty} onChange={(hideEmpty) => set({ hideEmpty })} data-testid="matrix-hide-empty" />
        </div>
        <div className="an-inline-actions">
          <button type="button" className="an-link" onClick={() => set({ collapsed: [] })}>
            {t('analysis.expandAll')}
          </button>
          <button type="button" className="an-link" onClick={() => set({ collapsed: lines.filter((l) => l.hasChildren).map((l) => l.id) })}>
            {t('analysis.collapseAll')}
          </button>
        </div>
      </PanelSection>
    </div>
  );

  let body: React.ReactNode;
  if (!lines.length || !documents.length) {
    body = <ResultsMessage icon={Grid3x3} title={t('analysis.nothingYet')}>{t('analysis.nothingYetBody')}</ResultsMessage>;
  } else if (result.error) {
    body = (
      <div className="an-pad">
        <Notice tone="danger">{String(result.error)}</Notice>
      </div>
    );
  } else if (!m) {
    body = (
      <div className="an__center">
        <Spinner size={20} label={t('analysis.computing')} />
      </div>
    );
  } else if (!cols.length) {
    body = <ResultsMessage icon={Grid3x3} title={t('analysis.matrix.noColumns')} />;
  } else {
    body = (
      <div className="an-tablewrap">
        <HeatTable
          rows={rows}
          cols={cols}
          value={valueOf}
          text={(r, c) => fmt(valueOf(r, c))}
          scale={scale}
          rowTotal={(r) => fmt(m.rowTotals[rowIndex.get(shownLines[r]!.id)!] ?? 0)}
          colTotals={m.colTotals.map(fmt)}
          grandTotal={fmt(m.grandTotal)}
          totalLabel={t('analysis.total')}
          corner={t('analysis.matrix.corner', { measure: measureLabel })}
          onCell={(r, c) => setCell({ r, c })}
          onToggle={toggle}
          toggleLabel={(row) => (row.collapsed ? t('analysis.expandCode', { name: row.label }) : t('analysis.collapseCode', { name: row.label }))}
          tooltip={tooltip}
          label={t('analysis.tools.matrix')}
          vertical={s.columns === 'document' || cols.length > 8}
          testId="matrix-table"
        />
        <HeatLegend theme={theme} max={scale.max} format={fmt} />
      </div>
    );
  }

  const sheetRow = cell ? shownLines[cell.r] : undefined;
  const sheetCol = cell ? cols[cell.c] : undefined;

  return (
    <ToolLayout
      label={t('analysis.tools.matrix')}
      panel={panel}
      testId="tool-matrix"
      sheet={
        cell && sheetRow && sheetCol ? (
          <Sheet open onClose={() => setCell(null)} title={`${codeById.get(sheetRow.id)?.name ?? ''} · ${sheetCol.label}`} subtitle={tp('common.count.codings', sheetCodings.length)} testId="matrix-sheet">
            <SegmentList codings={sheetCodings} />
          </Sheet>
        ) : null
      }
    >
      <ResultsHead
        title={t('analysis.matrix.title')}
        meta={
          m ? (
            <>
              {tp('common.count.codes', shownLines.length)} · {s.columns === 'document' ? tp('common.count.documents', cols.length) : s.columns === 'group' ? tp('analysis.count.groups', cols.length) : tp('common.count.cases', cols.length)}
              {result.busy ? <span className="an-inline-spin"><Spinner size={12} /></span> : null}
            </>
          ) : null
        }
      >
        <ExportMenu tables={doTable} disabled={!m} testId="matrix-export" />
      </ResultsHead>
      <div className={`an-results__body${result.busy && m ? ' an-results__body--stale' : ''}`}>{body}</div>
    </ToolLayout>
  );
}

function compact(v: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: v >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(v);
}

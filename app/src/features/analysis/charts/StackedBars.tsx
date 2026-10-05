import React, { forwardRef, useMemo, useState, type ReactNode } from 'react';
import { CHROME, type Theme } from '../lib/heat';
import { niceTicks, stackSegments } from '../lib/scale';
import { ChartTip } from './ChartTip';
import { fitText, textWidth } from './measure';
import { useSize } from './useSize';

export interface StackSeries {
  id: string;
  label: string;
  color: string;
}

const ROW = 34;
const BAR = 18;
const FS = 12;

/**
 * Horizontal stacked bars: one bar per group or case, one segment per code (in the code's
 * colour), a 2 px surface gap between segments. `normalised` shows shares of each bar (100 %).
 * The legend names every colour; hovering a segment gives its value.
 */
export const StackedBars = forwardRef<
  SVGSVGElement,
  { categories: readonly string[]; series: readonly StackSeries[]; values: readonly (readonly number[])[]; normalised: boolean; theme: Theme; label: string; format: (v: number) => string; tip: (r: number, s: number) => ReactNode }
>(function StackedBars({ categories, series, values, normalised, theme, label, format, tip }, ref) {
  const [frame, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ r: number; s: number } | null>(null);
  const c = CHROME[theme];
  const width = Math.max(480, size.width || 800);
  const labelW = Math.min(200, Math.max(70, ...categories.map((l) => textWidth(l, FS) + 16)));
  const plotW = width - labelW - 56;
  const totals = useMemo(() => values.map((row) => row.reduce((a, b) => a + b, 0)), [values]);
  const max = normalised ? 100 : Math.max(0, ...totals);
  const ticks = normalised ? [0, 25, 50, 75, 100] : niceTicks(max, 4, true);
  const axisTop = ticks[ticks.length - 1]! || 1;
  // Legend: wrap swatches into lines that fit the width.
  const legend = useMemo(() => {
    const lines: { s: number; x: number }[][] = [[]];
    let x = 0;
    series.forEach((se, s) => {
      const w = 20 + textWidth(se.label, 11.5) + 18;
      if (x + w > width - labelW && lines[lines.length - 1]!.length) {
        lines.push([]);
        x = 0;
      }
      lines[lines.length - 1]!.push({ s, x });
      x += w;
    });
    return lines;
  }, [series, width, labelW]);
  const legendH = legend.length * 20 + 8;
  const top = legendH + 26;
  const height = top + categories.length * ROW + 6;

  return (
    <div className="an-chart an-stack" ref={frame} data-testid="stacked-bars">
      <svg ref={ref} viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label} fontSize={FS} onPointerLeave={() => setHover(null)}>
        {legend.map((line, li) =>
          line.map(({ s, x }) => (
            <g key={series[s]!.id} transform={`translate(${labelW + x},${10 + li * 20})`} opacity={hover === null || hover.s === s ? 1 : 0.45}>
              <rect x={0} y={-5} width={12} height={10} rx={2} fill={series[s]!.color} />
              <text x={18} y={0} dominantBaseline="central" fill={c.ink2} fontSize={11.5}>
                {series[s]!.label}
              </text>
            </g>
          )),
        )}
        {ticks.map((tv) => {
          const x = labelW + (tv / axisTop) * plotW;
          return (
            <g key={tv}>
              <line x1={x} x2={x} y1={top - 6} y2={height - 6} stroke={tv === 0 ? c.axis : c.grid} />
              <text x={x} y={top - 12} textAnchor="middle" fill={c.muted} fontSize={10.5} style={{ fontVariantNumeric: 'tabular-nums' }}>
                {normalised ? `${tv}%` : format(tv)}
              </text>
            </g>
          );
        })}
        {categories.map((cat, r) => {
          const y = top + r * ROW + (ROW - BAR) / 2;
          const row = values[r] ?? [];
          const total = totals[r] ?? 0;
          const barW = normalised ? (total > 0 ? plotW : 0) : (total / axisTop) * plotW;
          const segs = stackSegments(row, total, barW);
          return (
            <g key={`${cat}-${r}`}>
              <text x={labelW - 10} y={y + BAR / 2} textAnchor="end" dominantBaseline="central" fill={hover?.r === r ? c.ink : c.ink2} fontWeight={hover?.r === r ? 600 : 450}>
                {fitText(cat, labelW - 14, FS)}
              </text>
              {segs.map((sg, s) =>
                sg.w > 0 ? (
                  <rect
                    key={series[s]!.id}
                    x={labelW + sg.x}
                    y={y}
                    width={sg.w}
                    height={BAR}
                    rx={s === segs.length - 1 || segs.slice(s + 1).every((q) => q.w === 0) ? 3 : 1}
                    fill={series[s]!.color}
                    opacity={hover === null || (hover.r === r && hover.s === s) || (hover.r !== r && hover.s === s) ? 1 : 0.4}
                    onPointerEnter={() => setHover({ r, s })}
                    data-testid="stack-seg"
                  />
                ) : null,
              )}
              {!normalised ? (
                <text x={labelW + barW + 6} y={y + BAR / 2} dominantBaseline="central" fill={c.ink2} fontSize={11} style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {format(total)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {hover ? (
        <ChartTip x={labelW + (stackSegments(values[hover.r] ?? [], totals[hover.r] ?? 0, normalised ? plotW : ((totals[hover.r] ?? 0) / axisTop) * plotW)[hover.s]?.x ?? 0) + 10} y={top + hover.r * ROW + 6} bounds={size}>
          {tip(hover.r, hover.s)}
        </ChartTip>
      ) : null}
    </div>
  );
});

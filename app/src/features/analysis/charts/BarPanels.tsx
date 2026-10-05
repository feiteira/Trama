import React, { forwardRef, useMemo, useState, type ReactNode } from 'react';
import { CHROME, type Theme } from '../lib/heat';
import { barPath, niceTicks } from '../lib/scale';
import { ChartTip } from './ChartTip';
import { fitText, textWidth } from './measure';
import { useSize } from './useSize';

export interface BarRow {
  id: string;
  label: string;
  color: string;
  depth?: number;
}

export interface BarPanel {
  title: string;
  values: readonly number[];
  color: string;
}

const ROW = 26;
const BAR = 14;
const FS = 12;

/**
 * Horizontal bars as small multiples: one row per code, one panel per measure (segments,
 * documents…), each panel on its own axis, never two scales on one. The code's own colour is a
 * dot beside its name; the bars of a panel share one hue. Values sit at the bar tips.
 */
export const BarPanels = forwardRef<SVGSVGElement, { rows: readonly BarRow[]; panels: readonly BarPanel[]; theme: Theme; label: string; format: (v: number) => string; tip: (r: number) => ReactNode; onRow?: (r: number) => void }>(function BarPanels(
  { rows, panels, theme, label, format, tip, onRow },
  ref,
) {
  const [frame, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const c = CHROME[theme];
  const width = Math.max(480, size.width || 800);
  const labelW = Math.min(220, Math.max(90, ...rows.map((r) => textWidth(r.label, FS) + 26 + (r.depth ?? 0) * 10)));
  const gapX = 28;
  const panelW = (width - labelW - gapX * panels.length) / Math.max(1, panels.length);
  const top = 46;
  const height = top + rows.length * ROW + 10;
  const axes = useMemo(
    () =>
      panels.map((p) => {
        const max = Math.max(0, ...p.values);
        const ticks = niceTicks(max, panelW > 280 ? 4 : panelW > 180 ? 3 : 2, true);
        return { ticks, top: ticks[ticks.length - 1]! || 1 };
      }),
    [panels, panelW],
  );
  return (
    <div className="an-chart an-bars" ref={frame} data-testid="bar-panels">
      <svg ref={ref} viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label} fontSize={FS} onPointerLeave={() => setHover(null)}>
        {panels.map((p, k) => {
          const x0 = labelW + gapX / 2 + k * (panelW + gapX);
          const ax = axes[k]!;
          const plotW = panelW - 44; // room for the value at the longest bar's tip
          return (
            <g key={p.title}>
              <text x={x0} y={16} fill={c.ink} fontWeight={600} fontSize={12.5}>
                {p.title}
              </text>
              {ax.ticks.map((tv) => {
                const x = x0 + (tv / ax.top) * plotW;
                return (
                  <g key={tv}>
                    <line x1={x} x2={x} y1={top - 6} y2={height - 10} stroke={tv === 0 ? c.axis : c.grid} strokeWidth={1} />
                    <text x={x} y={top - 12} textAnchor="middle" fill={c.muted} fontSize={10.5} style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {format(tv)}
                    </text>
                  </g>
                );
              })}
              {rows.map((row, r) => {
                const v = p.values[r] ?? 0;
                const y = top + r * ROW + (ROW - BAR) / 2;
                const w = (v / ax.top) * plotW;
                return (
                  <g key={row.id} opacity={hover === null || hover === r ? 1 : 0.45}>
                    <path d={barPath(x0, y, w, BAR)} fill={p.color} />
                    <text x={x0 + w + 6} y={y + BAR / 2} dominantBaseline="central" fill={c.ink2} fontSize={11} style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {format(v)}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
        {rows.map((row, r) => {
          const y = top + r * ROW + ROW / 2;
          const indent = (row.depth ?? 0) * 10;
          return (
            <g key={row.id}>
              <circle cx={8 + indent} cy={y} r={4} fill={row.color} />
              <text x={18 + indent} y={y} dominantBaseline="central" fill={hover === r ? c.ink : c.ink2} fontWeight={hover === r ? 600 : 450}>
                {fitText(row.label, labelW - 24 - indent, FS)}
              </text>
              {/* The whole row is the hit target. */}
              <rect
                data-export="skip"
                x={0}
                y={top + r * ROW}
                width={width}
                height={ROW}
                fill="transparent"
                onPointerEnter={() => setHover(r)}
                onClick={() => onRow?.(r)}
                style={{ cursor: onRow ? 'pointer' : undefined }}
                data-testid="bar-row"
              />
            </g>
          );
        })}
      </svg>
      {hover !== null ? (
        <ChartTip x={labelW + 40} y={top + hover * ROW + ROW / 2} bounds={size}>
          {tip(hover)}
        </ChartTip>
      ) : null}
    </div>
  );
});

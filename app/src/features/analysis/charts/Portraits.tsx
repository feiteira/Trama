import React, { forwardRef, useState, type ReactNode } from 'react';
import type { PortraitSlice } from '../../../core/qda/charts';
import { CHROME, type Theme } from '../lib/heat';
import { ChartTip } from './ChartTip';
import { fitText, textWidth } from './measure';
import { useSize } from './useSize';

export interface PortraitRow {
  id: string;
  label: string;
  slices: readonly PortraitSlice[];
}

const STRIP = 18;
const ROW = 30;
const FS = 12;

/**
 * Document portraits: each document a strip from beginning to end, each slice in the colour of
 * the code that covers most of it (uncoded slices stay paper). Shows where in a document the
 * talk turns to what, and which documents look alike. Click a slice to read it.
 */
export const Portraits = forwardRef<SVGSVGElement, { rows: readonly PortraitRow[]; theme: Theme; label: string; tip: (r: number, k: number) => ReactNode; onSlice: (r: number, k: number) => void; startLabel: string; endLabel: string }>(function Portraits(
  { rows, theme, label, tip, onSlice, startLabel, endLabel },
  ref,
) {
  const [frame, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ r: number; k: number } | null>(null);
  const c = CHROME[theme];
  const width = Math.max(480, size.width || 800);
  const labelW = Math.min(200, Math.max(80, ...rows.map((r) => textWidth(r.label, FS) + 16)));
  const plotW = width - labelW - 12;
  const top = 24;
  const height = top + rows.length * ROW + 6;
  return (
    <div className="an-chart an-portraits" ref={frame} data-testid="portraits">
      <svg ref={ref} viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label} fontSize={FS} onPointerLeave={() => setHover(null)}>
        <text x={labelW} y={12} fill={c.muted} fontSize={10.5}>
          {startLabel}
        </text>
        <text x={labelW + plotW} y={12} fill={c.muted} fontSize={10.5} textAnchor="end">
          {endLabel}
        </text>
        {rows.map((row, r) => {
          const y = top + r * ROW + (ROW - STRIP) / 2;
          const n = row.slices.length || 1;
          const sw = plotW / n;
          return (
            <g key={row.id}>
              <text x={labelW - 10} y={y + STRIP / 2} textAnchor="end" dominantBaseline="central" fill={hover?.r === r ? c.ink : c.ink2} fontWeight={hover?.r === r ? 600 : 450}>
                {fitText(row.label, labelW - 14, FS)}
              </text>
              <rect x={labelW} y={y} width={plotW} height={STRIP} rx={3} fill={c.diagonal} />
              {row.slices.map((sl, k) =>
                sl.color ? (
                  <rect key={k} x={labelW + k * sw} y={y} width={Math.max(0.6, sw + 0.4)} height={STRIP} fill={sl.color} opacity={0.35 + 0.65 * Math.min(1, sl.share * 1.4)} />
                ) : null,
              )}
              <rect
                data-export="skip"
                x={labelW}
                y={top + r * ROW}
                width={plotW}
                height={ROW}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onPointerMove={(e) => {
                  const box = (e.currentTarget as SVGRectElement).getBoundingClientRect();
                  const k = Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - box.left) / box.width) * n)));
                  setHover((h) => (h && h.r === r && h.k === k ? h : { r, k }));
                }}
                onClick={() => hover && onSlice(hover.r, hover.k)}
                data-testid="portrait-strip"
              />
              {hover?.r === r ? (
                <rect data-export="skip" x={labelW + hover.k * sw - 0.5} y={y - 2} width={Math.max(2, sw) + 1} height={STRIP + 4} rx={1.5} fill="none" stroke={c.ink} strokeWidth={1.25} pointerEvents="none" />
              ) : null}
            </g>
          );
        })}
      </svg>
      {hover && rows[hover.r] ? (
        <ChartTip x={labelW + ((hover.k + 0.5) / (rows[hover.r]!.slices.length || 1)) * plotW} y={top + hover.r * ROW + 4} bounds={size}>
          {tip(hover.r, hover.k)}
        </ChartTip>
      ) : null}
    </div>
  );
});

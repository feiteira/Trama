import React, { forwardRef, useMemo, useState, type ReactNode } from 'react';
import { CHROME, type HeatScale, type Theme } from '../lib/heat';
import { ChartTip } from './ChartTip';
import { fitText, textWidth } from './measure';
import { useSize } from './useSize';

export interface HeatLabel {
  id: string;
  label: string;
  color?: string;
}

export interface HeatmapProps {
  rows: readonly HeatLabel[];
  cols: readonly HeatLabel[];
  values: readonly (readonly number[])[];
  scale: HeatScale;
  format: (v: number, i: number, j: number) => string;
  /** Square matrix whose diagonal means something else (a code's own segments). */
  diagonal?: boolean;
  tooltip: (i: number, j: number) => ReactNode;
  onCell?: (i: number, j: number) => void;
  /** Accessible name of the chart; the cells are announced by the tooltip. */
  label: string;
  theme: Theme;
  testId?: string;
  /** How a screen reader announces the chart ("matrix: use the arrow keys…"). */
  roleDescription?: string;
}

const LABEL_MAX = 168;
const SIN60 = Math.sqrt(3) / 2;
const FS = 11.5;

/**
 * A heat matrix drawn in SVG (so it can be exported): sequential fills, the value printed in
 * every cell large enough to hold it, a neutral diagonal, hover and keyboard readouts.
 * One Tab stop: arrows move between cells, Enter opens the cell.
 */
export const Heatmap = forwardRef<SVGSVGElement, HeatmapProps>(function Heatmap({ rows, cols, values, scale, format, diagonal, tooltip, onCell, label, theme, testId = 'heatmap', roleDescription }, svgRef) {
  const [frame, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ i: number; j: number } | null>(null);
  const [active, setActive] = useState<{ i: number; j: number } | null>(null);
  const [focused, setFocused] = useState(false);
  const c = CHROME[theme];

  const layout = useMemo(() => {
    const rowW = Math.min(LABEL_MAX, Math.max(40, ...rows.map((r) => textWidth(r.label, FS) + 18)));
    const colW = Math.min(LABEL_MAX, Math.max(40, ...cols.map((r) => textWidth(r.label, FS) + 18)));
    // Column labels rise at 60°: they overhang the last column by colW·cos 60° = colW / 2.
    const avail = Math.max(200, (size.width || 800) - rowW - colW / 2 - 16);
    const cell = Math.max(24, Math.min(46, Math.floor(avail / Math.max(1, cols.length))));
    const top = Math.ceil(colW * SIN60 + 14);
    const width = rowW + cols.length * cell + Math.ceil(colW / 2) + 8;
    const height = top + rows.length * cell + 8;
    return { rowW, colW, cell, top, width, height };
  }, [rows, cols, size.width]);

  const { rowW, colW, cell, top, width, height } = layout;
  const showValues = cell >= 24;
  const shown = hover ?? (focused ? active : null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const cur = active ?? { i: 0, j: 0 };
    let { i, j } = cur;
    if (e.key === 'ArrowDown') i++;
    else if (e.key === 'ArrowUp') i--;
    else if (e.key === 'ArrowRight') j++;
    else if (e.key === 'ArrowLeft') j--;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = cols.length - 1;
    else if ((e.key === 'Enter' || e.key === ' ') && active) {
      e.preventDefault();
      onCell?.(active.i, active.j);
      return;
    } else return;
    e.preventDefault();
    setActive({ i: Math.max(0, Math.min(rows.length - 1, i)), j: Math.max(0, Math.min(cols.length - 1, j)) });
  };

  return (
    <div className="an-chart an-heat" ref={frame} data-testid={testId}>
      <div className="an-chart__scroll">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="group"
          aria-roledescription={roleDescription}
          aria-label={label}
          tabIndex={0}
          className="an-heat__svg"
          onKeyDown={onKeyDown}
          onFocus={() => {
            setFocused(true);
            if (!active) setActive({ i: 0, j: 0 });
          }}
          onBlur={() => setFocused(false)}
          onPointerLeave={() => setHover(null)}
          fontSize={FS}
        >
          {/* Column labels, slanted so long code names fit over narrow cells. */}
          <g>
            {cols.map((col, j) => {
              const x = rowW + j * cell + cell / 2;
              return (
                <g key={col.id} transform={`translate(${x},${top - 6}) rotate(-60)`}>
                  {col.color ? <circle cx={4} cy={0} r={3.5} fill={col.color} /> : null}
                  <text x={col.color ? 12 : 2} y={0} dominantBaseline="central" fill={shown?.j === j ? c.ink : c.ink2} fontWeight={shown?.j === j ? 600 : 450}>
                    {fitText(col.label, colW - 16, FS)}
                  </text>
                </g>
              );
            })}
          </g>
          {/* Row labels. */}
          <g>
            {rows.map((row, i) => (
              <g key={row.id} transform={`translate(0,${top + i * cell + cell / 2})`}>
                {row.color ? <circle cx={6} cy={0} r={3.5} fill={row.color} /> : null}
                <text x={rowW - 8} y={0} textAnchor="end" dominantBaseline="central" fill={shown?.i === i ? c.ink : c.ink2} fontWeight={shown?.i === i ? 600 : 450}>
                  {fitText(row.label, rowW - (row.color ? 24 : 12), FS)}
                </text>
              </g>
            ))}
          </g>
          {/* Cells: a 2 px surface gap between fills. */}
          <g>
            {rows.map((row, i) =>
              cols.map((col, j) => {
                const v = values[i]?.[j] ?? 0;
                const diag = diagonal && i === j;
                const fill = diag ? c.diagonal : scale.fill(v);
                const x = rowW + j * cell;
                const y = top + i * cell;
                return (
                  <g
                    key={`${row.id}|${col.id}`}
                    onPointerEnter={() => setHover({ i, j })}
                    onClick={() => {
                      setActive({ i, j });
                      onCell?.(i, j);
                    }}
                    style={{ cursor: onCell ? 'pointer' : undefined }}
                    data-testid={`${testId}-cell`}
                    data-i={i}
                    data-j={j}
                  >
                    <rect x={x + 1} y={y + 1} width={cell - 2} height={cell - 2} rx={3} fill={fill ?? 'transparent'} stroke={fill ? 'none' : c.grid} strokeWidth={fill ? 0 : 1} />
                    {showValues && (v !== 0 || diag) ? (
                      <text
                        x={x + cell / 2}
                        y={y + cell / 2}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={cell < 30 ? 10 : FS}
                        fill={diag ? c.muted : scale.ink(v)}
                        fontStyle={diag ? 'italic' : undefined}
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                        pointerEvents="none"
                      >
                        {format(v, i, j)}
                      </text>
                    ) : null}
                  </g>
                );
              }),
            )}
          </g>
          {shown ? (
            <rect
              data-export="skip"
              x={rowW + shown.j * cell + 0.5}
              y={top + shown.i * cell + 0.5}
              width={cell - 1}
              height={cell - 1}
              rx={3.5}
              fill="none"
              stroke={focused && !hover ? 'var(--focus)' : c.ink}
              strokeWidth={focused && !hover ? 2 : 1.5}
              pointerEvents="none"
            />
          ) : null}
        </svg>
      </div>
      {shown ? (
        <ChartTip x={rowW + shown.j * cell + cell / 2 - (frame.current?.querySelector('.an-chart__scroll')?.scrollLeft ?? 0)} y={top + shown.i * cell + cell / 2 - (frame.current?.querySelector('.an-chart__scroll')?.scrollTop ?? 0)} bounds={size}>
          {tooltip(shown.i, shown.j)}
        </ChartTip>
      ) : null}
    </div>
  );
});

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cx } from '../../../ui/cx';
import type { HeatScale } from '../lib/heat';
import { visibleRange } from '../lib/virtual';
import { ChartTip } from './ChartTip';
import { fitText } from './measure';

export interface HeatRow {
  id: string;
  label: string;
  depth: number;
  color?: string;
  hasChildren?: boolean;
  collapsed?: boolean;
  /** Path for the tooltip and screen readers ("Wellbeing › Belonging"). */
  title?: string;
}

export interface HeatCol {
  key: string;
  label: string;
  /** A second line under the label (n = 12). */
  sub?: string;
  /** Muted (the "no value" bucket). */
  muted?: boolean;
}

export interface ExtraCol {
  key: string;
  label: string;
  width: number;
  render: (r: number) => ReactNode;
}

export interface HeatTableProps {
  rows: readonly HeatRow[];
  cols: readonly HeatCol[];
  value: (r: number, c: number) => number;
  text: (r: number, c: number) => string;
  scale: HeatScale;
  rowTotal?: (r: number) => string;
  colTotals?: readonly string[];
  grandTotal?: string;
  totalLabel: string;
  extra?: readonly ExtraCol[];
  corner: string;
  onCell?: (r: number, c: number) => void;
  onToggle?: (rowId: string) => void;
  tooltip: (r: number, c: number) => ReactNode;
  label: string;
  testId?: string;
  /** Column labels written upwards (many narrow columns) or across (few wide ones). */
  vertical?: boolean;
  cellWidth?: number;
  toggleLabel: (row: HeatRow) => string;
}

const ROW_H = 30;

/**
 * A code × column table of heat cells, for codebooks of hundreds of codes: the header and the
 * code column stay in place while scrolling, only the rows in view are rendered, and branches
 * of the code tree fold. One Tab stop: arrows move between cells (the code column too), Enter
 * opens a cell or folds a branch.
 */
export function HeatTable(p: HeatTableProps) {
  const { rows, cols, scale, extra = [], vertical = true } = p;
  const headH = vertical ? 132 : 52;
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState({ w: 800, h: 500 });
  // The code column gives way in narrow windows so the numbers stay in view.
  const labelW = Math.round(Math.max(170, Math.min(264, viewport.w * 0.3)));
  const fixedW = labelW + (p.rowTotal ? 72 : 0) + extra.reduce((s, e) => s + e.width, 0) + 4;
  // Columns share the width that is left, within limits; past that the table scrolls sideways.
  const cellW = p.cellWidth ?? Math.max(vertical ? 40 : 54, Math.min(vertical ? 52 : 112, Math.floor((viewport.w - fixedW) / Math.max(1, cols.length))));
  const [active, setActive] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const [hover, setHover] = useState<{ r: number; c: number; x: number; y: number } | null>(null);
  const [focused, setFocused] = useState(false);
  const totalW = p.rowTotal ? 72 : 0;
  const extraW = extra.reduce((s, e) => s + e.width, 0);
  const width = labelW + cols.length * cellW + totalW + extraW;
  const hasTotals = !!p.colTotals;
  const bodyRows = rows.length;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setViewport({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    setActive((a) => ({ r: Math.min(a.r, Math.max(0, bodyRows - 1)), c: Math.min(a.c, cols.length - 1) }));
  }, [bodyRows, cols.length]);

  const offsets = useMemo(() => {
    const o = new Float64Array(bodyRows + 1);
    for (let i = 0; i <= bodyRows; i++) o[i] = i * ROW_H;
    return o;
  }, [bodyRows]);
  const [start, end] = visibleRange(offsets, Math.max(0, scrollTop - headH), viewport.h, 10);

  const show = (r: number, c: number) => {
    const el = scroller.current;
    if (!el) return;
    const top = headH + r * ROW_H;
    if (top - headH < el.scrollTop) el.scrollTop = top - headH;
    else if (top + ROW_H > el.scrollTop + el.clientHeight - (hasTotals ? ROW_H : 0)) el.scrollTop = top + ROW_H - el.clientHeight + (hasTotals ? ROW_H : 0);
    if (c >= 0) {
      const left = labelW + c * cellW;
      if (left - labelW < el.scrollLeft) el.scrollLeft = left - labelW;
      else if (left + cellW > el.scrollLeft + el.clientWidth) el.scrollLeft = left + cellW - el.clientWidth;
    } else el.scrollLeft = 0;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    let { r, c } = active;
    const row = rows[r];
    switch (e.key) {
      case 'ArrowDown':
        r++;
        break;
      case 'ArrowUp':
        r--;
        break;
      case 'ArrowRight':
        if (c === -1 && row?.hasChildren && row.collapsed) {
          p.onToggle?.(row.id);
          e.preventDefault();
          return;
        }
        c++;
        break;
      case 'ArrowLeft':
        if (c === -1 && row?.hasChildren && !row.collapsed) {
          p.onToggle?.(row.id);
          e.preventDefault();
          return;
        }
        c--;
        break;
      case 'Home':
        c = -1;
        break;
      case 'End':
        c = cols.length - 1;
        break;
      case 'PageDown':
        r += Math.max(1, Math.floor(viewport.h / ROW_H) - 3);
        break;
      case 'PageUp':
        r -= Math.max(1, Math.floor(viewport.h / ROW_H) - 3);
        break;
      case 'Enter':
      case ' ':
        if (!row) return;
        e.preventDefault();
        if (c === -1) {
          if (row.hasChildren) p.onToggle?.(row.id);
        } else p.onCell?.(r, c);
        return;
      default:
        return;
    }
    e.preventDefault();
    r = Math.max(0, Math.min(bodyRows - 1, r));
    c = Math.max(-1, Math.min(cols.length - 1, c));
    setActive({ r, c });
    show(r, c);
  };

  const tipFor = hover ?? (focused && active.c >= 0 && rows[active.r] ? { ...active, x: labelW + active.c * cellW + cellW / 2 - (scroller.current?.scrollLeft ?? 0), y: headH + active.r * ROW_H - (scroller.current?.scrollTop ?? 0) + ROW_H / 2 } : null);

  return (
    <div className="an-htable-frame" data-testid={p.testId}>
      <div
        className="an-htable"
        ref={scroller}
        role="grid"
        aria-label={p.label}
        aria-rowcount={bodyRows + 1}
        aria-colcount={cols.length + 1}
        tabIndex={0}
        onScroll={(e) => {
          setScrollTop(e.currentTarget.scrollTop);
          setHover(null);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPointerLeave={() => setHover(null)}
      >
        <div className="an-htable__inner" style={{ width, height: headH + bodyRows * ROW_H + (hasTotals ? ROW_H : 0) }}>
          {/* Header */}
          <div className="an-htable__head" role="row" style={{ height: headH, width }}>
            <div className="an-htable__corner" role="columnheader" style={{ width: labelW, height: headH }}>
              {p.corner}
            </div>
            {cols.map((col, c) => (
              <div
                key={col.key}
                role="columnheader"
                className={cx('an-htable__colhead', vertical && 'an-htable__colhead--v', col.muted && 'an-htable__colhead--muted', (hover?.c ?? (focused ? active.c : -2)) === c && 'an-htable__colhead--on')}
                style={{ width: cellW, height: headH }}
                title={col.label}
              >
                <span className="an-htable__collabel">{vertical ? fitText(col.label, headH - 22, 12.5, 520) : col.label}</span>
                {col.sub ? <span className="an-htable__colsub">{col.sub}</span> : null}
              </div>
            ))}
            {p.rowTotal ? (
              <div role="columnheader" className={cx('an-htable__colhead an-htable__colhead--total', vertical && 'an-htable__colhead--v')} style={{ width: totalW, height: headH }}>
                <span className="an-htable__collabel">{p.totalLabel}</span>
              </div>
            ) : null}
            {extra.map((x) => (
              <div key={x.key} role="columnheader" className="an-htable__colhead an-htable__colhead--extra" style={{ width: x.width, height: headH }}>
                <span className="an-htable__collabel">{x.label}</span>
              </div>
            ))}
          </div>
          {/* Body: only the rows in view. */}
          <div className="an-htable__body" style={{ height: bodyRows * ROW_H }}>
            {rows.slice(start, end).map((row, k) => {
              const r = start + k;
              const Chevron = row.collapsed ? ChevronRight : ChevronDown;
              return (
                <div key={row.id} role="row" aria-rowindex={r + 2} className={cx('an-htable__row', focused && active.r === r && 'an-htable__row--active')} style={{ top: r * ROW_H, height: ROW_H, width }}>
                  <div
                    role="rowheader"
                    className={cx('an-htable__label', focused && active.r === r && active.c === -1 && 'an-htable__cell--focus')}
                    style={{ width: labelW, paddingLeft: 10 + row.depth * 16 }}
                    title={row.title ?? row.label}
                    aria-expanded={row.hasChildren ? !row.collapsed : undefined}
                  >
                    {row.hasChildren ? (
                      <button
                        type="button"
                        tabIndex={-1}
                        className="an-htable__toggle"
                        aria-label={p.toggleLabel(row)}
                        onClick={() => {
                          setActive({ r, c: -1 });
                          p.onToggle?.(row.id);
                        }}
                        data-testid={p.testId ? `${p.testId}-toggle` : undefined}
                      >
                        <Chevron size={13} aria-hidden />
                      </button>
                    ) : (
                      <span className="an-htable__toggle-space" />
                    )}
                    {row.color ? <span className="an-dot" style={{ background: row.color }} aria-hidden /> : null}
                    <span className="an-htable__name">{row.label}</span>
                  </div>
                  {cols.map((col, c) => {
                    const v = p.value(r, c);
                    const fill = scale.fill(v);
                    const isFocus = focused && active.r === r && active.c === c;
                    return (
                      <div
                        key={col.key}
                        role="gridcell"
                        className={cx('an-htable__cell', isFocus && 'an-htable__cell--focus', !!p.onCell && v > 0 && 'an-htable__cell--click')}
                        style={{ width: cellW }}
                        onPointerEnter={(e) => {
                          const box = scroller.current!.getBoundingClientRect();
                          const cb = e.currentTarget.getBoundingClientRect();
                          setHover({ r, c, x: cb.left - box.left + cb.width / 2, y: cb.top - box.top + cb.height / 2 });
                        }}
                        onClick={() => {
                          setActive({ r, c });
                          if (v > 0) p.onCell?.(r, c);
                        }}
                        data-testid={p.testId ? `${p.testId}-cell` : undefined}
                      >
                        <span className="an-htable__fill" style={{ background: fill ?? undefined, color: fill ? scale.ink(v) : undefined }}>
                          {v !== 0 ? p.text(r, c) : ''}
                        </span>
                      </div>
                    );
                  })}
                  {p.rowTotal ? (
                    <div role="gridcell" className="an-htable__cell an-htable__cell--total" style={{ width: totalW }}>
                      {p.rowTotal(r)}
                    </div>
                  ) : null}
                  {extra.map((x) => (
                    <div key={x.key} role="gridcell" className="an-htable__cell an-htable__cell--extra" style={{ width: x.width }}>
                      {x.render(r)}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          {hasTotals ? (
            <div className="an-htable__totals" role="row" style={{ width, height: ROW_H }}>
              <div role="rowheader" className="an-htable__label an-htable__label--total" style={{ width: labelW }}>
                {p.totalLabel}
              </div>
              {cols.map((col, c) => (
                <div key={col.key} role="gridcell" className="an-htable__cell an-htable__cell--total" style={{ width: cellW }}>
                  {p.colTotals![c]}
                </div>
              ))}
              {p.rowTotal ? (
                <div role="gridcell" className="an-htable__cell an-htable__cell--total an-htable__cell--grand" style={{ width: totalW }}>
                  {p.grandTotal}
                </div>
              ) : null}
              {extra.map((x) => (
                <div key={x.key} role="gridcell" className="an-htable__cell an-htable__cell--total" style={{ width: x.width }} />
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {tipFor && rows[tipFor.r] && cols[tipFor.c] ? (
        <ChartTip x={tipFor.x} y={tipFor.y} bounds={{ width: viewport.w, height: viewport.h }}>
          {p.tooltip(tipFor.r, tipFor.c)}
        </ChartTip>
      ) : null}
    </div>
  );
}

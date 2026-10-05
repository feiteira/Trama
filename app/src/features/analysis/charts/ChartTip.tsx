import React, { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The hover/focus readout of a chart, placed beside the point inside the chart's frame and kept
 * within it. It only echoes what the table view and the cells already show.
 */
export function ChartTip({ x, y, bounds, children }: { x: number; y: number; bounds: { width: number; height: number }; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (el) setSize({ w: el.offsetWidth, h: el.offsetHeight });
  }, [children]);
  const gap = 14;
  let left = x + gap;
  if (left + size.w > bounds.width - 4) left = x - gap - size.w;
  left = Math.max(4, left);
  let top = y - size.h - gap;
  if (top < 4) top = y + gap;
  top = Math.min(top, Math.max(4, bounds.height - size.h - 4));
  return (
    <div className="an-tip" ref={box} style={{ left, top, visibility: size.w ? 'visible' : 'hidden' }} role="status" aria-live="polite">
      {children}
    </div>
  );
}

/** One line of a tooltip: the value strong, its label after. */
export function TipRow({ value, label, color }: { value: ReactNode; label: ReactNode; color?: string }) {
  return (
    <div className="an-tip__row">
      {color ? <span className="an-tip__key" style={{ background: color }} aria-hidden /> : null}
      <strong className="an-tip__value">{value}</strong>
      <span className="an-tip__label">{label}</span>
    </div>
  );
}

import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '../cx';
import { clampSplit, loadSplit, saveSplit } from '../splitSize';
import './splitpane.css';

export interface SplitPaneProps {
  /** The first pane (left, or top when vertical). Its size is the one controlled. */
  first: ReactNode;
  second: ReactNode;
  direction?: 'horizontal' | 'vertical';
  /** Default size of the first pane in px. */
  initial: number;
  min?: number;
  max?: number;
  /** Space the second pane always keeps. */
  minRest?: number;
  /** Remembers the size under this key (per device). */
  storageKey?: string;
  /** Accessible name of the divider, e.g. "Resize the code list". */
  label: string;
  className?: string;
  'data-testid'?: string;
}

const STEP = 16;

/**
 * Two panes with a draggable divider. The divider is a focusable separator: arrow keys resize
 * in steps (Shift for larger), Home/End go to the limits, double-click resets.
 */
export function SplitPane({ first, second, direction = 'horizontal', initial, min = 160, max = 800, minRest = 240, storageKey, label, className, ...rest }: SplitPaneProps) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(() => (storageKey ? loadSplit(storageKey, initial) : initial));
  const [total, setTotal] = useState<number | undefined>(undefined);
  const horizontal = direction === 'horizontal';
  const limits = { min, max, total, minRest };
  const shown = clampSplit(size, limits);

  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setTotal(horizontal ? el.clientWidth : el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [horizontal]);

  const commit = useCallback(
    (next: number) => {
      const v = clampSplit(next, { min, max, total, minRest });
      setSize(v);
      if (storageKey) saveSplit(storageKey, v);
    },
    [min, max, total, minRest, storageKey],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = root.current;
    if (!el) return;
    const start = el.getBoundingClientRect();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add(horizontal ? 'is-resizing-x' : 'is-resizing-y');
    const move = (ev: PointerEvent) => setSize(clampSplit(horizontal ? ev.clientX - start.left : ev.clientY - start.top, { min, max, total: horizontal ? start.width : start.height, minRest }));
    const up = (ev: PointerEvent) => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      document.body.classList.remove('is-resizing-x', 'is-resizing-y');
      commit(horizontal ? ev.clientX - start.left : ev.clientY - start.top);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? STEP * 4 : STEP;
    const back = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const fwd = horizontal ? 'ArrowRight' : 'ArrowDown';
    if (e.key === back) commit(shown - step);
    else if (e.key === fwd) commit(shown + step);
    else if (e.key === 'Home') commit(min);
    else if (e.key === 'End') commit(max);
    else return;
    e.preventDefault();
  };

  return (
    <div ref={root} className={cx('split', `split--${direction}`, className)} data-testid={rest['data-testid']}>
      <div className="split__pane split__pane--first" style={horizontal ? { width: shown } : { height: shown }}>
        {first}
      </div>
      <div
        role="separator"
        tabIndex={0}
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        aria-label={label}
        aria-valuenow={shown}
        aria-valuemin={min}
        aria-valuemax={clampSplit(max, limits)}
        className="split__handle"
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onDoubleClick={() => commit(initial)}
      />
      <div className="split__pane split__pane--second">{second}</div>
    </div>
  );
}

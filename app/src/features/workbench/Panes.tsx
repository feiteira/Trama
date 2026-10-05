import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { SplitPane } from '../../ui/components/SplitPane';
import { clampSplit, loadSplit, saveSplit } from '../../ui/splitSize';

// The workbench's three panes: documents | viewer | codebook. The left divider is the design
// system's SplitPane; the right one needs the *second* pane's width kept (the codebook stays
// put while the window grows), which SplitPane does not offer, so it is drawn here with the
// same classes, keyboard and limits.

const STEP = 16;

interface EndSplitProps {
  main: ReactNode;
  side: ReactNode;
  initial: number;
  min: number;
  max: number;
  minRest: number;
  storageKey: string;
  label: string;
}

function EndSplit({ main, side, initial, min, max, minRest, storageKey, label }: EndSplitProps) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(() => loadSplit(storageKey, initial));
  const [total, setTotal] = useState<number | undefined>(undefined);
  const shown = clampSplit(size, { min, max, total, minRest });

  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setTotal(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const commit = useCallback(
    (next: number) => {
      const v = clampSplit(next, { min, max, total, minRest });
      setSize(v);
      saveSplit(storageKey, v);
    },
    [min, max, total, minRest, storageKey],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = root.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('is-resizing-x');
    const width = (ev: PointerEvent) => box.right - ev.clientX;
    const move = (ev: PointerEvent) => setSize(clampSplit(width(ev), { min, max, total: box.width, minRest }));
    const up = (ev: PointerEvent) => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      document.body.classList.remove('is-resizing-x');
      commit(width(ev));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? STEP * 4 : STEP;
    // The divider sits left of the pane it sizes: moving it left widens the pane.
    if (e.key === 'ArrowLeft') commit(shown + step);
    else if (e.key === 'ArrowRight') commit(shown - step);
    else if (e.key === 'Home') commit(max);
    else if (e.key === 'End') commit(min);
    else return;
    e.preventDefault();
  };

  return (
    <div ref={root} className="split split--horizontal">
      <div className="split__pane split__pane--second wb-panes__main">{main}</div>
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={shown}
        aria-valuemin={min}
        aria-valuemax={clampSplit(max, { min, max, total, minRest })}
        className="split__handle"
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onDoubleClick={() => commit(initial)}
        data-testid="workbench-right-divider"
      />
      <div className="split__pane wb-panes__side" style={{ width: shown, flex: 'none' }}>
        {side}
      </div>
    </div>
  );
}

export interface WorkbenchPanesProps {
  left: ReactNode;
  centre: ReactNode;
  right: ReactNode;
  leftOpen: boolean;
  rightOpen: boolean;
  leftLabel: string;
  rightLabel: string;
}

export function WorkbenchPanes({ left, centre, right, leftOpen, rightOpen, leftLabel, rightLabel }: WorkbenchPanesProps) {
  const inner = rightOpen ? (
    <EndSplit main={centre} side={right} initial={264} min={200} max={460} minRest={380} storageKey="workbench.right" label={rightLabel} />
  ) : (
    centre
  );
  if (!leftOpen) return <div className="wb-panes">{inner}</div>;
  return (
    <div className="wb-panes">
      <SplitPane
        first={left}
        second={inner}
        initial={240}
        min={180}
        max={440}
        minRest={rightOpen ? 600 : 380}
        storageKey="workbench.left"
        label={leftLabel}
        className="wb-panes__split"
        data-testid="workbench-panes"
      />
    </div>
  );
}

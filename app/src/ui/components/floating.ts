import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import { type Align, place, type Placement, type Rect, type Side } from '../position';

/**
 * Positions `floating` next to `anchor` (an element or a fixed rectangle such as a right-click
 * point) while `open`, and again when the window resizes or anything scrolls. Before the first
 * measurement the box is placed off-screen, so it never flashes at 0,0.
 */
export function useFloating(
  open: boolean,
  anchor: RefObject<HTMLElement | null> | Rect | null,
  floating: RefObject<HTMLElement | null>,
  side: Side = 'bottom',
  align: Align = 'start',
  gap = 6,
): Placement | null {
  const [pos, setPos] = useState<Placement | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const update = () => {
      const el = floating.current;
      const a = anchor && 'current' in anchor ? anchor.current?.getBoundingClientRect() : anchor;
      if (!el || !a) return;
      // Measure at natural size: a previous maxHeight must not shrink what we measure.
      const prevMax = el.style.maxHeight;
      el.style.maxHeight = '';
      const size = { width: el.offsetWidth, height: el.offsetHeight };
      el.style.maxHeight = prevMax;
      const next = place(
        { top: a.top, left: a.left, width: a.width, height: a.height },
        size,
        { width: window.innerWidth, height: window.innerHeight },
        side,
        align,
        gap,
      );
      setPos((cur) => (cur && cur.top === next.top && cur.left === next.left && cur.side === next.side && cur.maxHeight === next.maxHeight ? cur : next));
    };
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (floating.current) ro?.observe(floating.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
    // A rectangle anchor is compared by value, so a new object for the same point does not loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, anchor && 'current' in anchor ? anchor : JSON.stringify(anchor), floating, side, align, gap]);
  return pos;
}

/** Styles for a floating box from its placement. */
export function floatingStyle(pos: Placement | null): CSSProperties {
  return pos
    ? { position: 'fixed', top: pos.top, left: pos.left, maxHeight: pos.maxHeight }
    : { position: 'fixed', top: -9999, left: -9999, visibility: 'hidden' };
}

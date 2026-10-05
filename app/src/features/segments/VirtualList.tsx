import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { firstVisible, offsetsOf } from './virtual';

export interface VirtualListHandle {
  /** Scrolls just enough to show item `index`. */
  scrollToIndex(index: number): void;
  element(): HTMLDivElement | null;
}

export interface VirtualListProps<T> extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  items: readonly T[];
  getKey: (item: T) => string;
  /** Expected height of an item before it is measured, px. */
  estimate: number;
  renderItem: (item: T, index: number) => ReactNode;
  /** Gap between items, px. */
  gap?: number;
  /** Space above the first and below the last item, px. */
  padding?: number;
  /** Changing it scrolls back to the top (a new query). */
  resetKey?: string;
  /** Called with the range of indexes on screen (for loading what they need). */
  onRange?: (from: number, to: number) => void;
  'data-testid'?: string;
}

const OVERSCAN = 600;

/**
 * A list that renders only what is near the viewport, for thousands of items of varying
 * height. Heights are measured as items appear (ResizeObserver); while heights above the
 * viewport settle, the first visible item stays where it was on screen.
 */
function VirtualListInner<T>(
  { items, getKey, estimate, renderItem, gap = 0, padding = 0, resetKey, onRange, style, ...rest }: VirtualListProps<T>,
  ref: React.ForwardedRef<VirtualListHandle>,
) {
  const scroller = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const [version, setVersion] = useState(0);
  const [view, setView] = useState({ top: 0, height: 800 });
  const pending = useRef(false);
  const anchor = useRef<{ key: string; within: number } | null>(null);

  const keys = useMemo(() => items.map(getKey), [items, getKey]);
  const offsets = useMemo(
    () => offsetsOf(keys, (k) => heights.current.get(k) ?? estimate, gap, padding),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keys, estimate, gap, padding, version],
  );
  const total = offsets[offsets.length - 1] ?? 0;
  const indexOfKey = useMemo(() => new Map(keys.map((k, i) => [k, i])), [keys]);

  const from = Math.max(0, firstVisible(offsets, view.top - OVERSCAN, keys.length));
  let to = from;
  while (to < keys.length && offsets[to]! < view.top + view.height + OVERSCAN) to++;

  const rememberAnchor = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const i = firstVisible(offsets, el.scrollTop, keys.length);
    const key = keys[i];
    anchor.current = key === undefined ? null : { key, within: el.scrollTop - offsets[i]! };
  }, [offsets, keys]);

  // After heights change, put the anchor item back where it was.
  useLayoutEffect(() => {
    const el = scroller.current;
    const a = anchor.current;
    if (!el || !a) return;
    const i = indexOfKey.get(a.key);
    if (i === undefined) return;
    const want = Math.max(0, offsets[i]! + a.within);
    if (Math.abs(el.scrollTop - want) > 1) el.scrollTop = want;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offsets]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = 0;
    anchor.current = null;
    setView((v) => ({ ...v, top: 0 }));
  }, [resetKey]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setView({ top: el.scrollTop, height: el.clientHeight });
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  useEffect(() => {
    onRange?.(from, to);
  }, [from, to, onRange]);

  const observer = useMemo(
    () =>
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            let changed = false;
            for (const e of entries) {
              const key = (e.target as HTMLElement).dataset.vkey;
              if (!key) continue;
              const h = Math.round((e.target as HTMLElement).offsetHeight);
              if (h > 0 && heights.current.get(key) !== h) {
                heights.current.set(key, h);
                changed = true;
              }
            }
            if (changed && !pending.current) {
              pending.current = true;
              requestAnimationFrame(() => {
                pending.current = false;
                setVersion((v) => v + 1);
              });
            }
          }),
    [],
  );
  useEffect(() => () => observer?.disconnect(), [observer]);


  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex(index: number) {
        const el = scroller.current;
        if (!el || index < 0 || index >= keys.length) return;
        const top = offsets[index]!;
        const h = heights.current.get(keys[index]!) ?? estimate;
        if (top < el.scrollTop + padding) el.scrollTop = Math.max(0, top - padding);
        else if (top + h > el.scrollTop + el.clientHeight - padding) el.scrollTop = top + h - el.clientHeight + padding;
      },
      element: () => scroller.current,
    }),
    [offsets, keys, estimate, padding],
  );

  const children: ReactNode[] = [];
  for (let i = from; i < to; i++) {
    const key = keys[i]!;
    children.push(
      <Measured key={key} vkey={key} top={offsets[i]!} observer={observer}>
        {renderItem(items[i]!, i)}
      </Measured>,
    );
  }

  return (
    <div
      ref={scroller}
      {...rest}
      style={{ ...style, overflowY: 'auto', position: 'relative' }}
      onScroll={(e) => {
        rest.onScroll?.(e);
        const el = e.currentTarget;
        setView({ top: el.scrollTop, height: el.clientHeight });
        rememberAnchor();
      }}
    >
      <div style={{ position: 'relative', height: total }}>{children}</div>
    </div>
  );
}

/** One positioned item, observed for its height while it is on screen. */
function Measured({ vkey, top, observer, children }: { vkey: string; top: number; observer: ResizeObserver | null; children: ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = el.current;
    if (!node || !observer) return;
    observer.observe(node);
    return () => observer.unobserve(node);
  }, [observer]);
  return (
    <div ref={el} data-vkey={vkey} className="vlist__item" style={{ position: 'absolute', left: 0, right: 0, top }}>
      {children}
    </div>
  );
}

export const VirtualList = forwardRef(VirtualListInner) as <T>(
  props: VirtualListProps<T> & { ref?: React.Ref<VirtualListHandle> },
) => ReturnType<typeof VirtualListInner>;

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { KwicRow } from '../../../core/qda/search';
import { useRouter } from '../../../shell/router';
import { cx } from '../../../ui/cx';
import { useI18n } from '../../../ui/i18n';
import { flattenKwic, type KwicGroup } from '../lib/kwic';
import { prefixOffsets, scrollToShow, visibleRange } from '../lib/virtual';

const DOC_H = 40;
const HIT_H = 34;

/**
 * Keyword in context, grouped by document: the keyword column is aligned down the list so the
 * eye can run along the left and right contexts. Only the rows in view are rendered (a search
 * can return thousands of hits). One Tab stop: arrows move, Enter opens the passage in the
 * workbench, Left/Right fold a document.
 */
export function KwicList({ groups, testId = 'analysis-kwic', label, dense }: { groups: readonly KwicGroup[]; testId?: string; label: string; dense?: boolean }) {
  const { t, tp } = useI18n();
  const { go } = useRouter();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const items = useMemo(() => flattenKwic(groups, collapsed), [groups, collapsed]);
  const offsets = useMemo(() => prefixOffsets(items.map((i) => (i.kind === 'doc' ? DOC_H : HIT_H))), [items]);
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const [active, setActive] = useState(0);
  const base = useId();

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport(el.clientHeight));
    ro.observe(el);
    setViewport(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, items.length - 1)));
  }, [items.length]);
  useEffect(() => {
    // New results start at the top.
    setCollapsed(new Set());
    setActive(0);
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [groups]);

  const [start, end] = visibleRange(offsets, scrollTop, viewport, 8);

  const toggle = useCallback((docId: string, open?: boolean) => {
    setCollapsed((cur) => {
      const next = new Set(cur);
      const isOpen = !next.has(docId);
      if (open === undefined ? isOpen : !open) next.add(docId);
      else next.delete(docId);
      return next;
    });
  }, []);

  const openRow = useCallback((row: KwicRow) => go({ name: 'workbench', docId: row.documentId, select: { start: row.start, end: row.end } }), [go]);

  const moveTo = (i: number) => {
    const n = Math.max(0, Math.min(items.length - 1, i));
    setActive(n);
    const el = scroller.current;
    if (el) el.scrollTop = scrollToShow(offsets, n, el.scrollTop, el.clientHeight);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const item = items[active];
    const page = Math.max(1, Math.floor(viewport / HIT_H) - 1);
    switch (e.key) {
      case 'ArrowDown':
        moveTo(active + 1);
        break;
      case 'ArrowUp':
        moveTo(active - 1);
        break;
      case 'PageDown':
        moveTo(active + page);
        break;
      case 'PageUp':
        moveTo(active - page);
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(items.length - 1);
        break;
      case 'ArrowLeft':
        if (!item) return;
        if (item.kind === 'doc') toggle(item.group.documentId, false);
        else moveTo(items.findIndex((x) => x.kind === 'doc' && x.group.documentId === item.group.documentId));
        break;
      case 'ArrowRight':
        if (item?.kind === 'doc') toggle(item.group.documentId, true);
        else return;
        break;
      case 'Enter':
      case ' ':
        if (!item) return;
        if (item.kind === 'doc') toggle(item.group.documentId);
        else openRow(item.row);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const activeItem = items[active];
  return (
    <div
      className={cx('an-kwic', dense && 'an-kwic--dense')}
      ref={scroller}
      role="listbox"
      tabIndex={0}
      aria-label={label}
      aria-activedescendant={activeItem ? `${base}-${active}` : undefined}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onKeyDown={onKeyDown}
      data-testid={testId}
    >
      <div className="an-kwic__inner" style={{ height: offsets[items.length] }}>
        {items.slice(start, end).map((item, k) => {
          const i = start + k;
          const top = offsets[i]!;
          const isActive = i === active;
          if (item.kind === 'doc') {
            const g = item.group;
            const Chevron = item.collapsed ? ChevronRight : ChevronDown;
            return (
              <div
                key={item.key}
                id={`${base}-${i}`}
                role="option"
                aria-selected={isActive}
                aria-expanded={!item.collapsed}
                className={cx('an-kwic__doc', isActive && 'an-kwic__row--active')}
                style={{ top, height: DOC_H }}
                onClick={() => {
                  setActive(i);
                  toggle(g.documentId);
                }}
                data-testid={`${testId}-doc`}
              >
                <Chevron size={14} aria-hidden className="an-kwic__chev" />
                <span className="an-kwic__docname">{g.name}</span>
                <span className="an-kwic__doccount">{tp('analysis.search.hits', g.total)}</span>
                {g.total > g.rows.length ? <span className="an-kwic__docmore">{t('analysis.search.shownOf', { n: g.rows.length })}</span> : null}
              </div>
            );
          }
          const r = item.row;
          return (
            <div
              key={item.key}
              id={`${base}-${i}`}
              role="option"
              aria-selected={isActive}
              aria-label={`${r.left} ${r.keyword} ${r.right}`}
              className={cx('an-kwic__hit', isActive && 'an-kwic__row--active')}
              style={{ top, height: HIT_H }}
              onClick={() => {
                setActive(i);
                openRow(r);
              }}
              title={t('analysis.search.openHint')}
              data-testid={`${testId}-hit`}
            >
              <span className="an-kwic__left">
                <span>{r.left}</span>
              </span>
              <mark className="an-kwic__key">{r.keyword}</mark>
              <span className="an-kwic__right">{r.right}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

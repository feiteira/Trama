import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, Minus } from 'lucide-react';
import { fold } from '../../core/text/normalize';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import { SearchField } from '../../ui/components/Field';
import { visibleRows, type ChecklistItem } from './checklistModel';

export type { ChecklistItem } from './checklistModel';

export interface ChecklistProps {
  items: readonly ChecklistItem[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  /** Accessible name of the list. */
  label: string;
  /** Shows a search box above the list. */
  searchPlaceholder?: string;
  noMatch?: (q: string) => string;
  /** Height of the scrolling list, px (it shrinks to fit fewer rows). */
  maxHeight?: number;
  'data-testid'?: string;
}

const ROW_H = 28;

/**
 * A compact multi-select list: optional search, tree indentation with collapsible branches,
 * a colour dot and a count per row. One Tab stop; arrow keys move, Space ticks, Right/Left
 * open and close a branch (listbox with aria-activedescendant).
 */
export function Checklist({ items, selected, onChange, label, searchPlaceholder, noMatch, maxHeight = 240, ...rest }: ChecklistProps) {
  const { t } = useI18n();
  const base = useId();
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const chosen = useMemo(() => new Set(selected), [selected]);
  const rows = useMemo(() => visibleRows(items, fold(query), collapsed), [items, query, collapsed]);
  const testId = rest['data-testid'];

  useEffect(() => {
    if (active >= rows.length) setActive(Math.max(0, rows.length - 1));
  }, [rows.length, active]);

  // Keep the active row in view while moving with the keyboard.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const top = active * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  }, [active]);

  const toggle = (id: string) => onChange(chosen.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const setBranch = (id: string, open: boolean) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (open) next.delete(id);
      else next.add(id);
      return next;
    });

  const onKeyDown = (e: React.KeyboardEvent) => {
    const row = rows[active];
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((a) => Math.min(rows.length - 1, a + 1));
        return;
      case 'ArrowUp':
        e.preventDefault();
        setActive((a) => Math.max(0, a - 1));
        return;
      case 'Home':
        e.preventDefault();
        setActive(0);
        return;
      case 'End':
        e.preventDefault();
        setActive(rows.length - 1);
        return;
      case 'PageDown':
        e.preventDefault();
        setActive((a) => Math.min(rows.length - 1, a + Math.floor(maxHeight / ROW_H)));
        return;
      case 'PageUp':
        e.preventDefault();
        setActive((a) => Math.max(0, a - Math.floor(maxHeight / ROW_H)));
        return;
      case ' ':
      case 'Enter':
        if (row) {
          e.preventDefault();
          toggle(row.item.id);
        }
        return;
      case 'ArrowRight':
        if (row?.hasChildren && row.collapsed) {
          e.preventDefault();
          setBranch(row.item.id, true);
        }
        return;
      case 'ArrowLeft':
        if (row?.hasChildren && !row.collapsed && !query) {
          e.preventDefault();
          setBranch(row.item.id, false);
        } else if (row && row.parentIndex >= 0) {
          e.preventDefault();
          setActive(row.parentIndex);
        }
        return;
    }
  };

  const height = Math.min(maxHeight, Math.max(1, rows.length) * ROW_H + 2);

  return (
    <div className="checklist" data-testid={testId}>
      {searchPlaceholder ? (
        <SearchField
          size="sm"
          value={query}
          onChange={(q) => {
            setQuery(q);
            setActive(0);
          }}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && rows.length) {
              e.preventDefault();
              listRef.current?.focus();
            }
          }}
          data-testid={testId ? `${testId}-search` : undefined}
        />
      ) : null}
      {rows.length === 0 ? (
        <p className="checklist__empty">{query && noMatch ? noMatch(query.trim()) : t('common.none')}</p>
      ) : (
        <div
          ref={listRef}
          role="listbox"
          aria-multiselectable="true"
          aria-label={label}
          aria-activedescendant={rows[active] ? `${base}-${active}` : undefined}
          tabIndex={0}
          className="checklist__list"
          style={{ height }}
          onKeyDown={onKeyDown}
        >
          {rows.map((r, i) => {
            const on = chosen.has(r.item.id);
            const partial = !on && r.hasChildren && r.descendantIds.some((d) => chosen.has(d));
            return (
              <div
                key={r.item.id}
                id={`${base}-${i}`}
                role="option"
                aria-selected={on}
                aria-level={r.item.depth !== undefined ? r.item.depth + 1 : undefined}
                aria-expanded={r.hasChildren && !query ? !r.collapsed : undefined}
                className={cx('checklist__row', i === active && 'checklist__row--active', on && 'checklist__row--on')}
                style={{ paddingLeft: 4 + (r.item.depth ?? 0) * 14 }}
                onPointerDown={(e) => {
                  // Keep the focus on the list (one Tab stop), and the row active.
                  e.preventDefault();
                  listRef.current?.focus({ preventScroll: true });
                  setActive(i);
                }}
                onClick={() => toggle(r.item.id)}
                data-testid={testId ? `${testId}-row-${r.item.id}` : undefined}
              >
                {r.hasChildren && !query ? (
                  <span
                    className={cx('checklist__twisty', !r.collapsed && 'checklist__twisty--open')}
                    aria-hidden
                    title={r.collapsed ? t('segments.codes.expand', { name: r.item.label }) : t('segments.codes.collapse', { name: r.item.label })}
                    onClick={(e) => {
                      e.stopPropagation();
                      setBranch(r.item.id, r.collapsed);
                    }}
                  >
                    <ChevronRight size={13} strokeWidth={2} />
                  </span>
                ) : (
                  <span className="checklist__twisty checklist__twisty--leaf" aria-hidden />
                )}
                <span className={cx('checklist__box', on && 'checklist__box--on', partial && 'checklist__box--partial')} aria-hidden>
                  {on ? <Check size={11} strokeWidth={3} /> : partial ? <Minus size={11} strokeWidth={3} /> : null}
                </span>
                {r.item.color ? <span className="checklist__dot" style={{ background: r.item.color }} aria-hidden /> : null}
                <span className={cx('checklist__label', r.dim && 'checklist__label--dim')}>{r.item.label}</span>
                {r.item.count !== undefined ? <span className="checklist__count">{r.item.count}</span> : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

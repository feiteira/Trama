import React, { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Download, FileImage, FileSpreadsheet, FileText, type LucideIcon, X } from 'lucide-react';
import { fold } from '../../../core/text/normalize';
import { cx } from '../../../ui/cx';
import { focusBackTo, pushLayer } from '../../../ui/focus';
import { IconButton } from '../../../ui/components/Button';
import { SearchField } from '../../../ui/components/Field';
import { MenuButton, type MenuEntry } from '../../../ui/components/Menu';
import { useI18n } from '../../../ui/i18n';
import type { ImageFormat, TableFormat } from './exporting';

/** A tool: its settings on the left, its results on the right, an optional sheet over them. */
export function ToolLayout({ panel, children, sheet, label, testId }: { panel: ReactNode; children: ReactNode; sheet?: ReactNode; label: string; testId?: string }) {
  return (
    <div className="an-tool" data-testid={testId}>
      <aside className="an-panel" aria-label={label}>
        {panel}
      </aside>
      <section className="an-results" aria-label={label}>
        {children}
        {sheet}
      </section>
    </div>
  );
}

/** A labelled group of settings in the panel. */
export function PanelSection({ title, children, aside, id }: { title: ReactNode; children: ReactNode; aside?: ReactNode; id?: string }) {
  const auto = useId();
  const hid = id ?? auto;
  return (
    <section className="an-section" aria-labelledby={hid}>
      <div className="an-section__head">
        <h3 className="an-section__title" id={hid}>
          {title}
        </h3>
        {aside}
      </div>
      <div className="an-section__body">{children}</div>
    </section>
  );
}

/** The bar above results: what they are, and what can be done with them. */
export function ResultsHead({ title, meta, children }: { title: ReactNode; meta?: ReactNode; children?: ReactNode }) {
  return (
    <div className="an-results__head">
      <div className="an-results__titles">
        <h2 className="an-results__title">{title}</h2>
        {meta ? <span className="an-results__meta">{meta}</span> : null}
      </div>
      {children ? <div className="an-results__actions">{children}</div> : null}
    </div>
  );
}

export interface ExportChoice {
  tables?: (format: TableFormat) => void;
  images?: (format: ImageFormat) => void;
  disabled?: boolean;
  testId?: string;
}

/** Export menu: table formats, chart formats, or both. */
export function ExportMenu({ tables, images, disabled, testId = 'analysis-export' }: ExportChoice) {
  const { t } = useI18n();
  const items: MenuEntry[] = [];
  if (tables) {
    items.push({ id: 'csv', label: t('analysis.export.csv'), icon: FileText, onSelect: () => tables('csv'), testId: `${testId}-csv`, disabled });
    items.push({ id: 'xlsx', label: t('analysis.export.xlsx'), icon: FileSpreadsheet, onSelect: () => tables('xlsx'), testId: `${testId}-xlsx`, disabled });
  }
  if (tables && images) items.push({ kind: 'separator' });
  if (images) {
    items.push({ id: 'svg', label: t('analysis.export.svg'), icon: FileImage, onSelect: () => images('svg'), testId: `${testId}-svg`, disabled });
    items.push({ id: 'png', label: t('analysis.export.png'), icon: FileImage, onSelect: () => images('png'), testId: `${testId}-png`, disabled });
  }
  return <MenuButton items={items} label={t('analysis.export.label')} icon={Download} variant="secondary" size="sm" align="end" disabled={disabled} data-testid={testId} />;
}

export interface PickItem {
  id: string;
  label: string;
  depth?: number;
  color?: string | null;
  /** A count shown at the right (segments, documents). */
  count?: number;
  disabled?: boolean;
  /** Text searched besides the label (a code's path). */
  search?: string;
}

/**
 * A checklist for the panel: search, All / None (and optional presets), a scrolling list.
 * Long codebooks stay usable: the list scrolls inside the panel and the filter folds accents.
 */
export function PickList({
  items,
  selected,
  onChange,
  label,
  max,
  presets,
  testId,
  height = 232,
}: {
  items: readonly PickItem[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  label: string;
  max?: number;
  presets?: { label: string; ids: () => string[] }[];
  testId: string;
  height?: number;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const f = fold(q.trim());
    if (!f) return items;
    return items.filter((i) => fold(`${i.label} ${i.search ?? ''}`).includes(f));
  }, [items, q]);
  const full = max !== undefined && selected.size >= max;
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) {
      if (full) return;
      next.add(id);
    } else next.delete(id);
    onChange(next);
  };
  const selectable = items.filter((i) => !i.disabled);
  return (
    <div className="an-pick" data-testid={testId}>
      <div className="an-pick__bar">
        <span className="an-pick__count" aria-live="polite">
          {max !== undefined ? t('analysis.pick.countMax', { n: selected.size, max }) : t('analysis.pick.count', { n: selected.size, total: selectable.length })}
        </span>
        <span className="an-pick__presets">
          {presets?.map((p) => (
            <button key={p.label} type="button" className="an-link" onClick={() => onChange(new Set(max !== undefined ? p.ids().slice(0, max) : p.ids()))}>
              {p.label}
            </button>
          ))}
          {max === undefined ? (
            <button type="button" className="an-link" onClick={() => onChange(new Set(selectable.map((i) => i.id)))} data-testid={`${testId}-all`}>
              {t('analysis.pick.all')}
            </button>
          ) : null}
          <button type="button" className="an-link" onClick={() => onChange(new Set())} data-testid={`${testId}-none`}>
            {t('analysis.pick.none')}
          </button>
        </span>
      </div>
      {items.length > 8 ? <SearchField size="sm" value={q} onChange={setQ} aria-label={t('analysis.pick.filter', { what: label })} placeholder={t('analysis.pick.filterPlaceholder')} /> : null}
      <div className="an-pick__list" role="group" aria-label={label} style={{ maxHeight: height }}>
        {shown.length === 0 ? <p className="an-pick__empty">{t('analysis.pick.noMatch')}</p> : null}
        {shown.map((i) => {
          const on = selected.has(i.id);
          const disabled = i.disabled || (!on && full);
          return (
            <label key={i.id} className={cx('an-pick__row', disabled && 'an-pick__row--disabled')} style={{ paddingLeft: 6 + (q ? 0 : (i.depth ?? 0) * 14) }} title={i.search || undefined}>
              <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => toggle(i.id, e.target.checked)} data-testid={`${testId}-item`} data-id={i.id} />
              {i.color ? <span className="an-dot" style={{ background: i.color }} aria-hidden /> : null}
              <span className="an-pick__label">{i.label}</span>
              {i.count !== undefined ? <span className="an-pick__n">{i.count}</span> : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A sheet that slides over the results from the right (segments of a cell, hits of a word).
 * Focus moves in, Escape and the close button leave, and focus goes back where it was.
 */
export function Sheet({ open, onClose, title, subtitle, children, testId }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; testId?: string }) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    const layer = pushLayer();
    box.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (!layer.isTop()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      layer.pop();
      focusBackTo(opener);
    };
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="an-sheet"
      ref={box}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid={testId}
    >
      <div className="an-sheet__head">
        <div className="an-sheet__titles">
          <h2 className="an-sheet__title" id={titleId}>
            {title}
          </h2>
          {subtitle ? <div className="an-sheet__subtitle">{subtitle}</div> : null}
        </div>
        <IconButton icon={X} label={t('common.close')} onClick={onClose} data-testid={testId ? `${testId}-close` : undefined} />
      </div>
      <div className="an-sheet__body">{children}</div>
    </div>
  );
}

/** A centred message in the results area (no data yet, nothing selected…). */
export function ResultsMessage({ icon: Icon, title, children, testId }: { icon?: LucideIcon; title: ReactNode; children?: ReactNode; testId?: string }) {
  return (
    <div className="an-msg" data-testid={testId}>
      {Icon ? (
        <div className="an-msg__icon" aria-hidden>
          <Icon size={20} strokeWidth={1.5} />
        </div>
      ) : null}
      <p className="an-msg__title">{title}</p>
      {children ? <div className="an-msg__body">{children}</div> : null}
    </div>
  );
}

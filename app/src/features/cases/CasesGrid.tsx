import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Calendar, Check, Hash, List, type LucideIcon, PanelRightOpen, Plus, SquareCheck, Trash2, Type } from 'lucide-react';
import type { Attribute, AttributeType } from '../../core/model/types';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import { Checkbox } from '../../ui/components/Choice';
import { ContextMenu, type MenuEntry } from '../../ui/components/Menu';
import { clampPos, moveCell, NAV_KEYS, type Pos, startsTyping } from './grid';
import { type CaseRow, editText, formatValue, type Sort, type SortKey, sortKeyId, type ValueFormat } from './values';

export type Col = { kind: 'name' } | { kind: 'documents' } | { kind: 'attr'; attr: Attribute } | { kind: 'codings' };

const TYPE_ICON: Record<AttributeType, LucideIcon> = { text: Type, number: Hash, date: Calendar, boolean: SquareCheck, choice: List };

export const colKey = (c: Col): SortKey => (c.kind === 'attr' ? { kind: 'attr', id: c.attr.id } : { kind: c.kind });
const colId = (c: Col) => sortKeyId(colKey(c));

export interface CasesGridProps {
  rows: CaseRow[];
  cols: Col[];
  fmt: ValueFormat;
  sort: Sort | null;
  onSort: (key: SortKey) => void;
  selected: ReadonlySet<string>;
  onSelect: (ids: string[], on: boolean) => void;
  onSelectOnly: (ids: string[]) => void;
  /** The case shown in the side panel. */
  openId: string | null;
  onOpen: (caseId: string) => void;
  onDelete: (caseIds: string[]) => void;
  /** Saves a typed value; resolves to an error message when it does not fit, else null. */
  onSetValue: (caseId: string, attr: Attribute, value: string | boolean | null) => Promise<string | null>;
  onRename: (caseId: string, name: string) => Promise<string | null>;
  onAdd: (name: string) => Promise<boolean>;
  addRef: React.RefObject<HTMLInputElement>;
}

interface Editing {
  row: number;
  col: number;
  initial: string;
}

/**
 * The cases as a spreadsheet: one row per case, one column per attribute. One cell is active
 * (a single Tab stop); arrows move it, Enter or typing edits, Escape cancels, Tab moves on.
 */
export function CasesGrid(props: CasesGridProps) {
  const { rows, cols, fmt, sort, onSort, selected, onSelect, onSelectOnly, openId, onOpen, onSetValue, onRename, onDelete, onAdd, addRef } = props;
  const { t, tp } = useI18n();
  const [active, setActive] = useState<Pos>({ row: 0, col: 0 });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<{ row: number; col: number; message: string } | null>(null);
  const table = useRef<HTMLTableElement>(null);
  const focusWanted = useRef(false);
  const anchorRow = useRef<number | null>(null);
  const size = { rows: rows.length, cols: cols.length };
  const pos = clampPos(active, size);

  // Keep the active cell on the same case when rows are re-sorted or filtered.
  const activeCase = useRef<string | null>(null);
  activeCase.current = rows[pos.row]?.case.id ?? activeCase.current;
  const rowIds = rows.map((r) => r.case.id).join('|');
  useLayoutEffect(() => {
    const id = activeCase.current;
    if (!id) return;
    const i = rows.findIndex((r) => r.case.id === id);
    if (i >= 0 && i !== active.row) setActive((a) => ({ ...a, row: i }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowIds]);

  const cellEl = useCallback((p: Pos) => table.current?.querySelector<HTMLElement>(`[data-pos="${p.row}:${p.col}"]`) ?? null, []);

  useEffect(() => {
    if (!focusWanted.current || editing) return;
    focusWanted.current = false;
    cellEl(pos)?.focus({ preventScroll: false });
  });

  const go = (p: Pos, focus = true) => {
    focusWanted.current = focus;
    setActive(p);
    setError(null);
  };

  const startEdit = (p: Pos, initial?: string) => {
    const row = rows[p.row];
    const col = cols[p.col];
    if (!row || !col) return;
    if (col.kind === 'name') setEditing({ ...p, initial: initial ?? row.case.name });
    else if (col.kind === 'attr') {
      if (col.attr.type === 'boolean') return void toggleBool(p);
      setEditing({ ...p, initial: initial ?? editText(col.attr.type, row.case.values[col.attr.id], fmt.bcp47) });
    }
  };

  const toggleBool = (p: Pos) => {
    const row = rows[p.row];
    const col = cols[p.col];
    if (!row || col?.kind !== 'attr' || col.attr.type !== 'boolean') return;
    void onSetValue(row.case.id, col.attr, row.case.values[col.attr.id] !== true);
  };

  /** Saves the editor's text. Resolves true when the editor may close. */
  const commit = async (e: Editing, text: string): Promise<boolean> => {
    const row = rows[e.row];
    const col = cols[e.col];
    if (!row || !col) return true;
    const err =
      col.kind === 'name'
        ? text.trim() && text.trim() !== row.case.name
          ? await onRename(row.case.id, text)
          : null
        : col.kind === 'attr'
          ? text === editText(col.attr.type, row.case.values[col.attr.id], fmt.bcp47)
            ? null
            : await onSetValue(row.case.id, col.attr, text)
          : null;
    if (err) {
      setError({ row: e.row, col: e.col, message: err });
      return false;
    }
    setError(null);
    return true;
  };

  const finishEdit = async (text: string, then: 'down' | 'right' | 'left' | 'stay' | 'none') => {
    const e = editing;
    if (!e) return;
    const ok = await commit(e, text);
    if (!ok) return;
    setEditing(null);
    if (then === 'none') return;
    const next = then === 'down' ? moveCell(e, 'ArrowDown', size) : then === 'right' ? moveCell(e, 'Tab', size) : then === 'left' ? moveCell(e, 'Tab', size, { shift: true }) : e;
    go(next ?? e);
  };

  const cancelEdit = () => {
    const e = editing;
    setEditing(null);
    setError(null);
    if (e) go(e);
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (editing || ev.defaultPrevented) return;
    // Only keys pressed on a cell (not on the header buttons or a checkbox).
    const target = ev.target as HTMLElement;
    if (!target.matches('[data-pos]')) return;
    const mods = { ctrl: ev.ctrlKey || ev.metaKey, shift: ev.shiftKey };
    const row = rows[pos.row];
    const col = cols[pos.col];
    if (NAV_KEYS.has(ev.key)) {
      const next = moveCell(pos, ev.key, size, mods, 12);
      if (!next) return; // Tab out of the grid
      ev.preventDefault();
      go(next);
      return;
    }
    if (!row || !col) return;
    switch (ev.key) {
      case 'Enter':
        ev.preventDefault();
        if (col.kind === 'attr') startEdit(pos);
        else onOpen(row.case.id);
        return;
      case 'F2':
        ev.preventDefault();
        startEdit(pos);
        return;
      case ' ':
        ev.preventDefault();
        if (!mods.shift && col.kind === 'attr' && col.attr.type === 'boolean') toggleBool(pos);
        else onSelect([row.case.id], !selected.has(row.case.id));
        return;
      case 'Delete':
      case 'Backspace':
        if (col.kind === 'attr' && row.case.values[col.attr.id] !== undefined) {
          ev.preventDefault();
          void onSetValue(row.case.id, col.attr, null);
        } else if (ev.key === 'Delete' && col.kind === 'name') {
          ev.preventDefault();
          onDelete(selected.size && selected.has(row.case.id) ? [...selected] : [row.case.id]);
        }
        return;
      case 'Escape':
        if (selected.size) {
          ev.preventDefault();
          onSelectOnly([]);
        }
        return;
      default:
        if (mods.ctrl && ev.key.toLowerCase() === 'a') {
          ev.preventDefault();
          onSelectOnly(rows.map((r) => r.case.id));
          return;
        }
        if (startsTyping(ev.key, { ...mods, alt: ev.altKey, meta: ev.metaKey }) && (col.kind === 'name' || (col.kind === 'attr' && col.attr.type !== 'boolean' && col.attr.type !== 'choice'))) {
          ev.preventDefault();
          startEdit(pos, ev.key);
        }
    }
  };

  const clickSelect = (index: number, ev: React.MouseEvent | null, on: boolean) => {
    const id = rows[index]!.case.id;
    if (ev?.shiftKey && anchorRow.current !== null) {
      const lo = Math.min(anchorRow.current, index);
      const hi = Math.max(anchorRow.current, index);
      onSelect(rows.slice(lo, hi + 1).map((r) => r.case.id), true);
    } else onSelect([id], on);
    anchorRow.current = index;
  };

  // Rows are memoised: they get one stable object of handlers that reach the latest state.
  const latest = useRef<RowHandlers>(null as unknown as RowHandlers);
  latest.current = {
    cellClick: (ri, ci, ev) => {
      if (editing && (editing.row !== ri || editing.col !== ci)) return;
      go({ row: ri, col: ci }, true);
      if (ev.detail === 2) startEdit({ row: ri, col: ci });
    },
    select: (ri, on, ev) => clickSelect(ri, ev, on),
    open: (ri) => {
      const r = rows[ri];
      if (r) onOpen(r.case.id);
    },
    finish: (text, then) => void finishEdit(text, then),
    cancel: cancelEdit,
    toggle: (ri, ci) => toggleBool({ row: ri, col: ci }),
    menu: (ri) => {
      const r = rows[ri];
      if (!r) return [];
      const ids = selected.has(r.case.id) && selected.size > 1 ? [...selected] : [r.case.id];
      return [
        { id: 'open', label: t('cases.grid.openDetails'), icon: PanelRightOpen, onSelect: () => onOpen(r.case.id), testId: 'case-menu-open' },
        { id: 'select', label: selected.has(r.case.id) ? t('cases.grid.deselect') : t('cases.grid.select'), icon: Check, onSelect: () => onSelect([r.case.id], !selected.has(r.case.id)) },
        { kind: 'separator' },
        { id: 'delete', label: ids.length > 1 ? tp('cases.deleteN', ids.length) : t('cases.deleteOne'), icon: Trash2, danger: true, onSelect: () => onDelete(ids), testId: 'case-menu-delete' },
      ];
    },
  };
  const stable = useMemo<RowHandlers>(
    () => ({
      cellClick: (...a) => latest.current.cellClick(...a),
      select: (...a) => latest.current.select(...a),
      open: (...a) => latest.current.open(...a),
      finish: (...a) => latest.current.finish(...a),
      cancel: () => latest.current.cancel(),
      toggle: (...a) => latest.current.toggle(...a),
      menu: (...a) => latest.current.menu(...a),
    }),
    [],
  );

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.case.id));
  const someSelected = !allSelected && rows.some((r) => selected.has(r.case.id));

  return (
    <div className="cgrid" data-testid="cases-grid">
      <table ref={table} role="grid" className="cgrid__table" aria-label={t('cases.grid.label')} aria-rowcount={rows.length + 1} aria-colcount={cols.length + 1} onKeyDown={onKeyDown}>
        <thead>
          <tr>
            <th className="cgrid__th cgrid__sel" scope="col">
              <Checkbox
                checked={allSelected}
                indeterminate={someSelected}
                onChange={(on) => onSelectOnly(on ? rows.map((r) => r.case.id) : [])}
                label={<span className="visually-hidden">{t('cases.grid.selectAll')}</span>}
                data-testid="cases-select-all"
              />
            </th>
            {cols.map((c, i) => {
              const id = colId(c);
              const dir = sort && sortKeyId(sort.key) === id ? sort.dir : null;
              const label = headerLabel(c, t);
              return (
                <th
                  key={id}
                  scope="col"
                  className={cx('cgrid__th', c.kind === 'name' && 'cgrid__namecol', (c.kind === 'codings' || (c.kind === 'attr' && c.attr.type === 'number')) && 'cgrid__th--num', c.kind === 'attr' && `cgrid__th--${c.attr.type}`)}
                  aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
                  aria-colindex={i + 2}
                >
                  <button type="button" className="cgrid__sort" onClick={() => onSort(colKey(c))} title={c.kind === 'attr' && c.attr.description ? c.attr.description : undefined} data-testid={`cases-sort-${id}`}>
                    {c.kind === 'attr' ? <TypeIcon type={c.attr.type} label={t(`cases.types.${c.attr.type}`)} /> : null}
                    <span className="cgrid__th-label">{label}</span>
                    {dir === 'asc' ? <ArrowUp size={12} aria-hidden /> : dir === 'desc' ? <ArrowDown size={12} aria-hidden /> : null}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <GridRow
              key={r.case.id}
              row={r}
              ri={ri}
              cols={cols}
              fmt={fmt}
              activeCol={pos.row === ri ? pos.col : -1}
              editingCol={editing && editing.row === ri ? editing.col : -1}
              editInitial={editing && editing.row === ri ? editing.initial : ''}
              error={error && error.row === ri ? error : null}
              selected={selected.has(r.case.id)}
              open={openId === r.case.id}
              h={stable}
            />
          ))}
          <AddRow span={cols.length} onAdd={onAdd} inputRef={addRef} />
        </tbody>
      </table>
    </div>
  );
}

function TypeIcon({ type, label }: { type: AttributeType; label: string }) {
  const Icon = TYPE_ICON[type];
  return (
    <span className="cgrid__type" title={label}>
      <Icon size={12} aria-hidden strokeWidth={2} />
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

function headerLabel(c: Col, t: ReturnType<typeof useI18n>['t']): string {
  switch (c.kind) {
    case 'name':
      return t('cases.grid.case');
    case 'documents':
      return t('cases.grid.documents');
    case 'codings':
      return t('cases.grid.codings');
    case 'attr':
      return c.attr.name;
  }
}

type Then = 'down' | 'right' | 'left' | 'stay' | 'none';

interface RowHandlers {
  cellClick: (ri: number, ci: number, ev: React.MouseEvent) => void;
  select: (ri: number, on: boolean, ev: React.MouseEvent | null) => void;
  open: (ri: number) => void;
  finish: (text: string, then: Then) => void;
  cancel: () => void;
  toggle: (ri: number, ci: number) => void;
  menu: (ri: number) => MenuEntry[];
}

interface RowProps {
  row: CaseRow;
  ri: number;
  cols: Col[];
  fmt: ValueFormat;
  activeCol: number;
  editingCol: number;
  editInitial: string;
  error: { col: number; message: string } | null;
  selected: boolean;
  open: boolean;
  h: RowHandlers;
}

const GridRow = memo(
  function GridRow({ row, ri, cols, fmt, activeCol, editingCol, editInitial, error, selected, open, h }: RowProps) {
    const { t, tp } = useI18n();
    const c = row.case;
    return (
      <ContextMenu items={() => h.menu(ri)} label={c.name}>
        <tr className={cx('cgrid__row', selected && 'cgrid__row--selected', open && 'cgrid__row--open')} aria-selected={selected} aria-rowindex={ri + 2} data-testid={`case-row-${c.id}`}>
          <td className="cgrid__td cgrid__sel">
            <span
              onClickCapture={(e) => {
                if (e.shiftKey) {
                  e.preventDefault();
                  h.select(ri, true, e);
                }
              }}
            >
              <Checkbox checked={selected} onChange={(on) => h.select(ri, on, null)} label={<span className="visually-hidden">{t('cases.grid.selectCase', { name: c.name })}</span>} data-testid={`case-select-${c.id}`} />
            </span>
          </td>
          {cols.map((col, ci) => {
            const isActive = ci === activeCol;
            const isEditing = ci === editingCol;
            const err = error && error.col === ci ? error.message : null;
            const common = {
              role: 'gridcell',
              tabIndex: isActive && !isEditing ? 0 : -1,
              'data-pos': `${ri}:${ci}`,
              'aria-colindex': ci + 2,
              onMouseDown: (e: React.MouseEvent) => {
                if (e.button === 0 && !isEditing) h.cellClick(ri, ci, e);
              },
            } as const;
            if (col.kind === 'name') {
              return (
                <td key="name" {...common} className={cx('cgrid__td cgrid__namecol', isActive && 'cgrid__td--active', isEditing && 'cgrid__td--editing')} aria-label={undefined} data-testid={`case-name-${c.id}`}>
                  {isEditing ? (
                    <CellEditor kind="text" initial={editInitial} label={t('cases.grid.case')} error={err} onFinish={h.finish} onCancel={h.cancel} />
                  ) : (
                    <div className="cgrid__name">
                      <span className="cgrid__swatch" style={c.color ? { background: c.color } : undefined} aria-hidden />
                      <span className="cgrid__name-text">{c.name}</span>
                      <button
                        type="button"
                        tabIndex={-1}
                        className="cgrid__open"
                        aria-label={t('cases.grid.openDetailsOf', { name: c.name })}
                        title={t('cases.grid.openDetails')}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => h.open(ri)}
                        data-testid={`case-open-${c.id}`}
                      >
                        <PanelRightOpen size={14} aria-hidden strokeWidth={1.75} />
                      </button>
                    </div>
                  )}
                </td>
              );
            }
            if (col.kind === 'documents') {
              const names = row.documents.map((d) => d.name).join('\n');
              return (
                <td key="documents" {...common} className={cx('cgrid__td cgrid__docs', isActive && 'cgrid__td--active')} title={names || undefined} aria-label={row.documents.length ? `${tp('common.count.documents', row.documents.length)}: ${row.documents.map((d) => d.name).join(', ')}` : t('cases.grid.noDocuments')}>
                  {row.documents.length ? (
                    <span className="cgrid__docs-inner">
                      <span className="cgrid__count">{row.documents.length}</span>
                      <span className="cgrid__docnames">{row.documents.map((d) => d.name).join(', ')}</span>
                    </span>
                  ) : (
                    <span className="cgrid__empty">—</span>
                  )}
                </td>
              );
            }
            if (col.kind === 'codings') {
              return (
                <td key="codings" {...common} className={cx('cgrid__td cgrid__num', isActive && 'cgrid__td--active')}>
                  {row.codings ? row.codings.toLocaleString(fmt.bcp47) : <span className="cgrid__empty">0</span>}
                </td>
              );
            }
            const a = col.attr;
            const v = c.values[a.id];
            if (a.type === 'boolean') {
              return (
                <td key={a.id} {...common} className={cx('cgrid__td cgrid__bool', isActive && 'cgrid__td--active')} aria-checked={v === true ? true : v === false ? false : undefined} data-testid={`case-cell-${c.id}-${a.id}`}>
                  <button
                    type="button"
                    tabIndex={-1}
                    role="checkbox"
                    aria-checked={v === true}
                    aria-label={`${a.name}: ${v === true ? fmt.yes : v === false ? fmt.no : '—'}`}
                    className={cx('cgrid__check', v === true && 'cgrid__check--on', v === false && 'cgrid__check--off')}
                    onClick={() => h.toggle(ri, ci)}
                  >
                    {v === true ? <Check size={12} strokeWidth={3} aria-hidden /> : null}
                  </button>
                </td>
              );
            }
            const shown = formatValue(a.type, v, fmt);
            return (
              <td
                key={a.id}
                {...common}
                className={cx('cgrid__td', a.type === 'number' && 'cgrid__num', isActive && 'cgrid__td--active', isEditing && 'cgrid__td--editing')}
                data-testid={`case-cell-${c.id}-${a.id}`}
              >
                {isEditing ? (
                  <CellEditor kind={a.type} options={a.options} initial={editInitial} label={a.name} error={err} onFinish={h.finish} onCancel={h.cancel} />
                ) : shown ? (
                  <span className={cx('cgrid__value', a.type === 'choice' && 'cgrid__choice')}>{shown}</span>
                ) : (
                  <span className="cgrid__empty" aria-hidden />
                )}
              </td>
            );
          })}
        </tr>
      </ContextMenu>
    );
  },
  (a, b) =>
    a.row === b.row &&
    a.ri === b.ri &&
    a.cols === b.cols &&
    a.fmt === b.fmt &&
    a.activeCol === b.activeCol &&
    a.editingCol === b.editingCol &&
    a.editInitial === b.editInitial &&
    a.error?.message === b.error?.message &&
    a.selected === b.selected &&
    a.open === b.open,
);

function CellEditor({
  kind,
  options = [],
  initial,
  label,
  error,
  onFinish,
  onCancel,
}: {
  kind: Attribute['type'];
  options?: string[];
  initial: string;
  label: string;
  error: string | null;
  onFinish: (text: string, then: Then) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const setRef = (el: HTMLInputElement | HTMLSelectElement | null) => {
    ref.current = el;
  };
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Typing over a cell puts the caret after the typed character; F2/Enter selects all.
    if (el instanceof HTMLInputElement && el.type === 'text') {
      if (initial.length === 1) el.setSelectionRange(1, 1);
      else el.select();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (error) done.current = false;
  }, [error]);
  const finish = (then: 'down' | 'right' | 'left' | 'stay' | 'none') => {
    if (done.current && then === 'none') return;
    done.current = true;
    onFinish(text, then);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      finish('down');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      finish(e.shiftKey ? 'left' : 'right');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      done.current = true;
      onCancel();
    }
  };
  const errId = error ? 'cgrid-editor-error' : undefined;
  return (
    <div className="cgrid__editor">
      {kind === 'choice' ? (
        <select
          ref={setRef}
          className="cgrid__input cgrid__select"
          value={text}
          aria-label={label}
          aria-invalid={!!error || undefined}
          aria-describedby={errId}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => finish('none')}
          data-testid="cell-editor"
        >
          <option value="">{t('cases.grid.noValue')}</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          {text && !options.includes(text) ? <option value={text}>{text}</option> : null}
        </select>
      ) : (
        <input
          ref={setRef}
          className={cx('cgrid__input', kind === 'number' && 'cgrid__input--num')}
          type={kind === 'date' ? 'date' : 'text'}
          inputMode={kind === 'number' ? 'decimal' : undefined}
          value={text}
          aria-label={label}
          aria-invalid={!!error || undefined}
          aria-describedby={errId}
          spellCheck={kind === 'text'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => finish('none')}
          data-testid="cell-editor"
        />
      )}
      {error ? (
        <div className="cgrid__error" id={errId} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function AddRow({ span, onAdd, inputRef }: { span: number; onAdd: (name: string) => Promise<boolean>; inputRef: React.RefObject<HTMLInputElement> }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      if (await onAdd(name)) setName('');
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };
  return (
    <tr className="cgrid__add">
      <td className="cgrid__td cgrid__sel">
        <Plus size={14} aria-hidden className="cgrid__add-icon" />
      </td>
      <td className="cgrid__td cgrid__namecol">
        <input
          ref={inputRef}
          className="cgrid__add-input"
          value={name}
          placeholder={t('cases.grid.addPlaceholder')}
          aria-label={t('cases.add')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            } else if (e.key === 'Escape' && name) {
              e.preventDefault();
              e.stopPropagation();
              setName('');
            }
          }}
          disabled={busy}
          data-testid="case-add-input"
        />
      </td>
      <td className="cgrid__td cgrid__add-rest" colSpan={Math.max(1, span - 1)}>
        {name.trim() ? <span className="cgrid__add-hint">{t('cases.grid.addHint')}</span> : null}
      </td>
    </tr>
  );
}

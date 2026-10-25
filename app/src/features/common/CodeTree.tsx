import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpToLine,
  ChevronRight,
  Combine,
  Folder,
  FolderOpen,
  FolderPlus,
  Keyboard,
  NotebookText,
  Palette,
  Pencil,
  Trash2,
} from 'lucide-react';
import { pointRect, type Rect } from '../../ui/position';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import { ColorPicker } from '../../ui/components/ColorPicker';
import { Menu, type MenuEntry } from '../../ui/components/Menu';
import { Popover } from '../../ui/components/Popover';
import { useToast } from '../../ui/components/Toast';
import type { CodeActions, CodeData } from './CodeTreeActions';
import {
  countOf,
  dropZone,
  filterTree,
  matchRanges,
  parentsOf,
  resolveDrop,
  treeKeyMove,
  typeAhead,
  visibleRows,
  type CountMode,
  type DropZone,
  type TreeItem,
} from './codeTreeModel';
import './CodeTree.css';

/** Text dragged out of a document (the Workbench sets it): dropping it on a code applies the code. */
export const SELECTION_MIME = 'application/x-trama-selection';
/** A code dragged inside the tree. */
export const CODE_MIME = 'application/x-trama-code';

export interface CodeTreeHandle {
  focus: () => void;
  /** Starts renaming a code in place (once it is on screen). */
  rename: (id: string) => void;
  /** Creates a code under `parentId` (null: top level) and starts renaming it. */
  /** Creates a code and starts naming it; resolves its id (null when it failed). */
  createAndRename: (parentId: string | null) => Promise<string | null>;
}

export interface CodeTreeProps {
  data: CodeData | undefined;
  actions: CodeActions;
  /** The highlighted code (the active one in the Workbench, the open one on the Codes screen). */
  selectedId: string | null;
  /** A click, Enter or Space on a code. */
  onSelect: (id: string) => void;
  filter?: string;
  countMode?: CountMode;
  collapsed: ReadonlySet<string>;
  onCollapsedChange: (next: Set<string>) => void;
  /** Text from a document dropped on a codable code. */
  onTextDrop?: (codeId: string) => void;
  /** Clicking applies codes: categories are shown as not applicable. */
  applyMode?: boolean;
  /** Extra entries at the top of a code's context menu. */
  extraMenu?: (id: string) => MenuEntry[];
  /** Accessible name of the tree. */
  label: string;
  /** Shown when the codebook is empty. */
  empty?: ReactNode;
  /** Shown when the filter matches nothing (default: a short note). */
  noMatch?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

type DropState = { id: string; zone: DropZone | 'apply'; invalid?: boolean } | null;

/**
 * The codebook as a tree (WAI-ARIA tree pattern): arrows move and fold, Home/End jump, typing
 * finds a code, F2 renames, Delete deletes, Shift+F10 opens the menu. Codes can be dragged to
 * a new place; text dragged from a document can be dropped on a code to apply it.
 */
export const CodeTree = forwardRef<CodeTreeHandle, CodeTreeProps>(function CodeTree(
  { data, actions, selectedId, onSelect, filter = '', countMode = 'total', collapsed, onCollapsedChange, onTextDrop, applyMode = false, extraMenu, label, empty, noMatch, className, ...rest },
  ref,
) {
  const { t } = useI18n();
  const toast = useToast();
  const items = data?.items;
  const tree = useRef<HTMLDivElement>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropState>(null);
  const dropRef = useRef<DropState>(null);
  const dragId = useRef<string | null>(null);
  // The last place the dragged code hovered was refused: said once the drag ends there.
  const refused = useRef(false);
  const [menu, setMenu] = useState<{ id: string; at: Rect } | null>(null);
  const [shortcutMenu, setShortcutMenu] = useState<{ id: string; at: Rect } | null>(null);
  const [colour, setColour] = useState<{ id: string; at: Rect } | null>(null);
  const typed = useRef({ text: '', at: 0 });
  const expandTimer = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  // The actions object is rebuilt on every render of its owner: read the latest through a ref
  // so the row callbacks keep their identity (and memoised rows stay put).
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const filterResult = useMemo(() => (items ? filterTree(items, filter) : null), [items, filter]);
  const rows = useMemo(() => (items ? visibleRows(items, collapsed, filterResult) : []), [items, collapsed, filterResult]);
  const indexOf = useMemo(() => new Map(rows.map((r, i) => [r.item.id, i])), [rows]);
  const parents = useMemo(() => (items ? parentsOf(items) : new Map<string, string | null>()), [items]);

  // The row that holds the Tab stop: the focused one, else the selected one, else the first.
  const tabId = (focusedId && indexOf.has(focusedId) ? focusedId : null) ?? (selectedId && indexOf.has(selectedId) ? selectedId : null) ?? rows[0]?.item.id ?? null;

  const rowEl = (id: string) => tree.current?.querySelector<HTMLElement>(`[data-code-id="${CSS.escape(id)}"]`) ?? null;

  const focusRow = useCallback((id: string) => {
    setFocusedId(id);
    // At once when the row is there (fast key repeats must land on it), else after render
    // (a code just created, a branch just opened).
    const go = () => {
      const el = tree.current?.querySelector<HTMLElement>(`[data-code-id="${CSS.escape(id)}"]`);
      if (!el || el.querySelector('input')) return false;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'nearest' });
      return true;
    };
    if (!go()) requestAnimationFrame(go);
  }, []);

  // A code chosen elsewhere (the route, the Workbench) inside a folded branch: unfold its path.
  useEffect(() => {
    if (!selectedId || !items) return;
    const fold = new Set(collapsedRef.current);
    let changed = false;
    for (let p = parents.get(selectedId) ?? null; p; p = parents.get(p) ?? null) {
      if (fold.delete(p)) changed = true;
    }
    if (changed) onCollapsedChange(fold);
    requestAnimationFrame(() => rowEl(selectedId)?.scrollIntoView({ block: 'nearest' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, items === undefined]);

  const setExpanded = useCallback(
    (id: string, open: boolean) => {
      const next = new Set(collapsedRef.current);
      if (open) next.delete(id);
      else next.add(id);
      onCollapsedChange(next);
    },
    [onCollapsedChange],
  );

  const startRename = useCallback((id: string) => {
    setRenamingId(id);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        const id = tabId;
        if (id) focusRow(id);
        else tree.current?.focus();
      },
      rename: startRename,
      createAndRename: async (parentId) => {
        // What started it ('New code'), for Escape to give the focus back to.
        const opener = document.activeElement;
        if (parentId) setExpanded(parentId, true);
        const code = await actionsRef.current.create(parentId);
        if (!code) return null;
        setFocusedId(code.id);
        setRenamingId(code.id);
        creatingId.current = code.id;
        creating.current = { opener: opener instanceof HTMLElement ? opener : null, parentId };
        return code.id;
      },
    }),
    [tabId, focusRow, startRename, setExpanded],
  );

  // A code just created and being named for the first time: Escape takes it back.
  const creatingId = useRef<string | null>(null);
  const creating = useRef<{ opener: HTMLElement | null; parentId: string | null } | null>(null);
  const commitRename = useCallback(
    (id: string, name: string) => {
      if (creatingId.current === id) creatingId.current = null;
      setRenamingId(null);
      void actionsRef.current.rename(id, name);
      focusRow(id);
    },
    [focusRow],
  );
  const cancelRename = useCallback(
    (id: string) => {
      setRenamingId(null);
      if (creatingId.current === id) {
        creatingId.current = null;
        const from = creating.current;
        creating.current = null;
        void actionsRef.current.discardNew(id).then((gone) => {
          if (!gone) return focusRow(id);
          // The row is gone with the focus in it: back to what started the creation, else the
          // parent row, else the tree's Tab stop.
          requestAnimationFrame(() => {
            if (from?.opener?.isConnected && from.opener !== document.body && !from.opener.closest('[data-code-id]')) from.opener.focus({ preventScroll: true });
            else if (from?.parentId) focusRow(from.parentId);
            else tree.current?.querySelector<HTMLElement>('[data-code-id][tabindex="0"], [data-code-id]')?.focus({ preventScroll: true });
          });
        });
        return;
      }
      focusRow(id);
    },
    [focusRow],
  );

  // ── Menu ──────────────────────────────────────────────────────────────────────────────────
  const menuItems = (id: string): MenuEntry[] => {
    const item = data?.rowById.get(id);
    if (!item) return [];
    const at = menu?.at ?? null;
    const isTop = (parents.get(id) ?? null) === null;
    return [
      ...(extraMenu ? extraMenu(id) : []),
      ...(extraMenu ? [{ kind: 'separator' as const }] : []),
      {
        id: 'child',
        label: t('codes.menu.newChild'),
        icon: FolderPlus,
        onSelect: async () => {
          setExpanded(id, true);
          const code = await actions.create(id);
          if (code) {
            setFocusedId(code.id);
            setRenamingId(code.id);
          }
        },
        testId: 'code-menu-child',
      },
      { id: 'rename', label: t('codes.menu.rename'), icon: Pencil, hint: 'F2', onSelect: () => startRename(id), testId: 'code-menu-rename' },
      { id: 'colour', label: t('codes.menu.colour'), icon: Palette, onSelect: () => at && setColour({ id, at }), testId: 'code-menu-colour' },
      {
        id: 'shortcut',
        label: t('codes.menu.shortcut'),
        icon: Keyboard,
        hint: item.code.shortcut ? String(item.code.shortcut) : undefined,
        disabled: !item.code.codable,
        onSelect: () => at && setShortcutMenu({ id, at }),
        testId: 'code-menu-shortcut',
      },
      { id: 'definition', label: t('codes.menu.definition'), icon: NotebookText, onSelect: () => actions.editDefinition(id), testId: 'code-menu-definition' },
      { kind: 'separator' },
      { id: 'merge', label: t('codes.menu.merge'), icon: Combine, disabled: (items?.length ?? 0) < 2, onSelect: () => actions.mergeInto(id), testId: 'code-menu-merge' },
      { id: 'top', label: t('codes.menu.toTop'), icon: ArrowUpToLine, disabled: isTop, onSelect: () => void actions.move(id, null, null), testId: 'code-menu-top' },
      { kind: 'separator' },
      { id: 'delete', label: t('codes.menu.delete'), icon: Trash2, danger: true, hint: t('codes.menu.deleteKey'), onSelect: () => actions.remove(id), testId: 'code-menu-delete' },
    ];
  };

  const shortcutItems = (id: string): MenuEntry[] => {
    const holder = new Map<number, string>();
    for (const r of data?.rows ?? []) if (r.code.shortcut) holder.set(r.code.shortcut, r.code.id === id ? '' : r.code.name);
    const current = data?.rowById.get(id)?.code.shortcut ?? null;
    return [
      { kind: 'heading', label: t('codes.shortcut.heading') },
      ...Array.from({ length: 9 }, (_, i) => i + 1).map((n) => ({
        id: `k${n}`,
        label: t('codes.shortcut.key', { n }),
        hint: holder.get(n) || undefined,
        checked: current === n,
        onSelect: () => void actions.setShortcut(id, n),
        testId: `code-shortcut-${n}`,
      })),
      { kind: 'separator' },
      { id: 'none', label: t('codes.shortcut.none'), checked: current === null, onSelect: () => void actions.setShortcut(id, null), testId: 'code-shortcut-none' },
    ];
  };

  const openMenuAt = (id: string, at: Rect) => {
    setFocusedId(id);
    setMenu({ id, at });
  };

  // ── Events (delegated: one handler for every row) ────────────────────────────────────────
  const idFrom = (target: EventTarget | null): string | null => (target instanceof Element ? target.closest<HTMLElement>('[data-code-id]')?.dataset.codeId ?? null : null);

  const onClick = (e: React.MouseEvent) => {
    const id = idFrom(e.target);
    if (!id || renamingId === id) return;
    const row = rows[indexOf.get(id) ?? -1];
    if ((e.target as Element).closest('[data-twisty]') && row?.hasChildren) {
      setExpanded(id, !row.expanded);
      setFocusedId(id);
      return;
    }
    setFocusedId(id);
    // In apply mode a category only folds: it cannot be applied.
    if (applyMode && row && !row.item.codable) {
      if (row.hasChildren) setExpanded(id, !row.expanded);
      return;
    }
    onSelect(id);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const id = idFrom(e.target);
    if (!id || applyMode) return;
    const row = rows[indexOf.get(id) ?? -1];
    if ((e.target as Element).closest('[data-twisty]')) return;
    if ((e.target as Element).closest('.codetree__name')) startRename(id);
    else if (row?.hasChildren) setExpanded(id, !row.expanded);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    const id = idFrom(e.target);
    if (!id || renamingId) return;
    e.preventDefault();
    openMenuAt(id, pointRect(e.clientX, e.clientY));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (renamingId || e.defaultPrevented) return;
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    const id = idFrom(e.target) ?? tabId;
    if (!id) return;
    const index = indexOf.get(id) ?? -1;
    const row = rows[index];
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const r = rowEl(id)?.getBoundingClientRect();
      if (r) openMenuAt(id, { top: r.top, left: r.left + 24, width: 0, height: r.height });
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (applyMode && row && !row.item.codable) {
          if (row.hasChildren) setExpanded(id, !row.expanded);
        } else onSelect(id);
        return;
      case 'F2':
        e.preventDefault();
        startRename(id);
        return;
      case 'Delete':
        e.preventDefault();
        actions.remove(id);
        return;
      case '*': {
        // Expand every sibling of this code (WAI-ARIA).
        e.preventDefault();
        const next = new Set(collapsedRef.current);
        for (const r of rows) if (r.parentId === row?.parentId && r.hasChildren) next.delete(r.item.id);
        onCollapsedChange(next);
        return;
      }
    }
    const move = treeKeyMove(e.key, rows, index);
    if (move.kind !== 'none' || ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) e.preventDefault();
    if (move.kind === 'focus') {
      const target = rows[move.index];
      if (target) focusRow(target.item.id);
      return;
    }
    if (move.kind === 'expand') return setExpanded(move.id, true);
    if (move.kind === 'collapse') return setExpanded(move.id, false);
    // Type-ahead.
    if (e.key.length === 1 && e.key !== ' ') {
      const now = Date.now();
      const text = now - typed.current.at > 700 ? e.key : typed.current.text + e.key;
      typed.current = { text, at: now };
      const hit = typeAhead(rows, index, text);
      if (hit >= 0) {
        e.preventDefault();
        focusRow(rows[hit]!.item.id);
      }
    }
  };

  // ── Drag and drop ─────────────────────────────────────────────────────────────────────────
  const showDrop = (next: DropState) => {
    const cur = dropRef.current;
    if (cur?.id === next?.id && cur?.zone === next?.zone && cur?.invalid === next?.invalid) return;
    dropRef.current = next;
    setDrop(next);
  };

  const clearExpandTimer = () => {
    if (expandTimer.current) clearTimeout(expandTimer.current.timer);
    expandTimer.current = null;
  };

  const onDragStart = (e: React.DragEvent) => {
    const id = idFrom(e.target);
    if (!id || renamingId) {
      e.preventDefault();
      return;
    }
    dragId.current = id;
    refused.current = false;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(CODE_MIME, id);
    e.dataTransfer.setData('text/plain', data?.byId.get(id)?.name ?? '');
  };

  const onDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types;
    const id = idFrom(e.target);
    const isCode = types.includes(CODE_MIME) && dragId.current !== null;
    const isText = types.includes(SELECTION_MIME);
    if (!isCode && !isText) return;
    if (!id) {
      // The empty space under the last code: the end of the top level.
      if (isCode && (e.target as Element).closest('[data-tree-end]')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        showDrop({ id: '', zone: 'after' });
      } else showDrop(null);
      return;
    }
    const row = rows[indexOf.get(id) ?? -1];
    if (!row || !items) return;
    if (isText) {
      if (!onTextDrop || !row.item.codable) {
        showDrop({ id, zone: 'apply', invalid: true });
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      showDrop({ id, zone: 'apply' });
      return;
    }
    const el = e.currentTarget.ownerDocument.querySelector<HTMLElement>(`[data-code-id="${CSS.escape(id)}"]`);
    const rect = el?.getBoundingClientRect();
    const zone = rect ? dropZone(e.clientY - rect.top, rect.height) : 'inside';
    const res = resolveDrop(rows, items, dragId.current!, id, zone);
    if (!res.ok && res.reason !== 'noop') {
      refused.current = true;
      showDrop({ id, zone, invalid: true });
      return;
    }
    refused.current = false;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    showDrop({ id, zone });
    // Hovering the middle of a folded branch opens it.
    if (zone === 'inside' && row.hasChildren && !row.expanded) {
      if (expandTimer.current?.id !== id) {
        clearExpandTimer();
        expandTimer.current = { id, timer: setTimeout(() => setExpanded(id, true), 650) };
      }
    } else if (expandTimer.current?.id !== id) clearExpandTimer();
  };

  const onDragLeave = (e: React.DragEvent) => {
    // A refused drop also ends with a dragleave, with no element entered: keep `refused` then.
    if (e.relatedTarget && !tree.current?.contains(e.relatedTarget as Node)) refused.current = false;
    if (!tree.current?.contains(e.relatedTarget as Node | null)) {
      showDrop(null);
      clearExpandTimer();
    }
  };

  const onDrop = (e: React.DragEvent) => {
    const state = dropRef.current;
    refused.current = false;
    showDrop(null);
    clearExpandTimer();
    if (!state || state.invalid) return;
    e.preventDefault();
    if (state.zone === 'apply') {
      onTextDrop?.(state.id);
      return;
    }
    const moving = dragId.current;
    dragId.current = null;
    if (!moving || !items) return;
    if (state.id === '') {
      void actions.move(moving, null, null);
      return;
    }
    const res = resolveDrop(rows, items, moving, state.id, state.zone);
    if (res.ok) {
      if (res.parentId) setExpanded(res.parentId, true);
      void actions.move(moving, res.parentId, res.beforeId).then((ok) => ok && focusRow(moving));
    }
  };

  const onDragEnd = (e: React.DragEvent) => {
    if (refused.current && e.dataTransfer.dropEffect === 'none' && dragId.current) {
      toast.show({ message: t('codes.tree.dropCycle'), tone: 'danger' });
    }
    refused.current = false;
    dragId.current = null;
    showDrop(null);
    clearExpandTimer();
  };

  if (!data) {
    return <div className={cx('codetree', 'codetree--loading', className)} aria-busy="true" />;
  }

  const menuCode = menu ? data.rowById.get(menu.id) : undefined;
  const colourCode = colour ? data.byId.get(colour.id) : undefined;

  return (
    <div className={cx('codetree', applyMode && 'codetree--apply', filterResult && 'codetree--filtering', className)}>
      {rows.length === 0 ? (
        items && items.length > 0 ? (
          <>
            <p className="codetree__nomatch" data-testid="codetree-nomatch">
              {t('codes.tree.noMatch', { q: filter.trim() })}
            </p>
            {noMatch}
          </>
        ) : (
          (empty ?? null)
        )
      ) : null}
      <div
        ref={tree}
        role="tree"
        aria-label={label}
        className="codetree__rows"
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        data-testid={rest['data-testid'] ?? 'codetree'}
        hidden={rows.length === 0}
      >
        {rows.map((r) => (
          <CodeRowView
            key={r.item.id}
            item={r.item}
            hasChildren={r.hasChildren}
            expanded={r.expanded}
            setSize={r.setSize}
            posInSet={r.posInSet}
            match={r.match}
            selected={r.item.id === selectedId}
            tabbable={r.item.id === tabId}
            renaming={r.item.id === renamingId}
            drop={drop?.id === r.item.id ? drop : null}
            countMode={countMode}
            applyMode={applyMode}
            query={r.match ? filter : ''}
            context={filterResult !== null && !r.match}
            onCommit={commitRename}
            onCancel={cancelRename}
            onFocus={setFocusedId}
          />
        ))}
        <div className={cx('codetree__end', drop?.id === '' && 'codetree__end--drop')} data-tree-end aria-hidden />
      </div>

      <Menu open={menu !== null && menuCode !== undefined} onClose={() => setMenu(null)} anchor={menu?.at ?? null} items={menu ? menuItems(menu.id) : []} label={menuCode ? t('codes.menu.label', { name: menuCode.code.name }) : undefined} data-testid="code-menu" />
      <Menu open={shortcutMenu !== null} onClose={() => setShortcutMenu(null)} anchor={shortcutMenu?.at ?? null} items={shortcutMenu ? shortcutItems(shortcutMenu.id) : []} label={t('codes.menu.shortcut')} data-testid="code-shortcut-menu" />
      <Popover open={colour !== null && colourCode !== undefined} onClose={() => setColour(null)} anchor={colour?.at ?? null} padded aria-label={t('codes.menu.colour')} data-testid="code-colour-popover">
        {colourCode ? (
          <ColorPicker
            label={t('codes.colourOf', { name: colourCode.name })}
            value={colourCode.color}
            onChange={(c) => void actions.setColor(colourCode.id, c)}
            data-testid="code-colour"
          />
        ) : null}
      </Popover>
    </div>
  );
});

interface RowProps {
  item: TreeItem;
  hasChildren: boolean;
  expanded: boolean;
  setSize: number;
  posInSet: number;
  match: boolean;
  selected: boolean;
  tabbable: boolean;
  renaming: boolean;
  drop: DropState;
  countMode: CountMode;
  applyMode: boolean;
  /** The filter, for a matching row (its name is highlighted). */
  query: string;
  /** Shown only as the ancestor of a match. */
  context: boolean;
  onCommit: (id: string, name: string) => void;
  onCancel: (id: string) => void;
  onFocus: (id: string) => void;
}

const INDENT = 16;

const CodeRowView = memo(function CodeRowView({ item, hasChildren, expanded, setSize, posInSet, match, selected, tabbable, renaming, drop, countMode, applyMode, query, context, onCommit, onCancel, onFocus }: RowProps) {
  const { t, tp } = useI18n();
  const count = countOf(item, countMode);
  const notApplicable = applyMode && !item.codable;
  const Icon = expanded ? FolderOpen : Folder;
  return (
    <div
      role="treeitem"
      aria-level={item.depth + 1}
      aria-setsize={setSize}
      aria-posinset={posInSet}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={selected}
      aria-disabled={notApplicable || undefined}
      aria-label={item.name}
      tabIndex={tabbable ? 0 : -1}
      draggable={!renaming}
      data-code-id={item.id}
      data-testid={`code-${item.id}`}
      className={cx(
        'codetree__row',
        selected && 'codetree__row--selected',
        !item.codable && 'codetree__row--category',
        notApplicable && 'codetree__row--na',
        context && 'codetree__row--context',
        drop && !drop.invalid && `codetree__row--drop-${drop.zone}`,
        drop?.invalid && 'codetree__row--drop-invalid',
      )}
      style={{ paddingLeft: 6 + item.depth * INDENT, ['--code' as string]: item.color }}
      onFocus={(e) => e.target === e.currentTarget && onFocus(item.id)}
      title={notApplicable ? t('codes.tree.categoryHint') : undefined}
    >
      {item.depth > 0 ? <span className="codetree__guides" style={{ width: item.depth * INDENT }} aria-hidden /> : null}
      <span className={cx('codetree__twisty', expanded && 'codetree__twisty--open', !hasChildren && 'codetree__twisty--leaf')} data-twisty aria-hidden>
        {hasChildren ? <ChevronRight size={13} strokeWidth={2} /> : null}
      </span>
      {item.codable ? <span className="codetree__dot" aria-hidden /> : <Icon size={15} strokeWidth={1.75} className="codetree__folder" aria-hidden />}
      {renaming ? (
        <RenameInput name={item.name} onCommit={(n) => onCommit(item.id, n)} onCancel={() => onCancel(item.id)} />
      ) : (
        <span className="codetree__name">
          <Highlighted text={item.name} query={query} />
        </span>
      )}
      {item.shortcut ? (
        <kbd className="codetree__key" title={t('codes.tree.shortcut', { n: item.shortcut })}>
          {item.shortcut}
        </kbd>
      ) : null}
      {count !== null ? (
        <span className={cx('codetree__count', count === 0 && 'codetree__count--zero')} title={tp(countMode === 'own' ? 'codes.tree.countOwn' : 'codes.tree.countTotal', count)}>
          {count}
        </span>
      ) : null}
      {drop?.invalid && drop.zone !== 'apply' ? <span className="codetree__refuse">{t('codes.tree.dropRefused')}</span> : null}
    </div>
  );
});

function Highlighted({ text, query }: { text: string; query: string }) {
  const ranges = useMemo(() => (query.trim() ? matchRanges(text, query) : []), [text, query]);
  if (!ranges.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([s, e], i) => {
    if (s > at) parts.push(text.slice(at, s));
    parts.push(<mark key={i}>{text.slice(s, e)}</mark>);
    at = e;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

function RenameInput({ name, onCommit, onCancel }: { name: string; onCommit: (name: string) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(name);
  const done = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit && value.trim()) onCommit(value);
    else onCancel();
  };
  return (
    <input
      ref={input}
      className="codetree__rename"
      value={value}
      maxLength={120}
      aria-label={t('codes.tree.renameLabel')}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      data-testid="code-rename"
    />
  );
}

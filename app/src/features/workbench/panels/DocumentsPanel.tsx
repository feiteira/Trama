import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  CheckCheck,
  ChevronRight,
  ClipboardList,
  Ellipsis,
  FileText,
  FileType,
  FileUp,
  FolderInput,
  FolderPlus,
  Layers,
  MessagesSquare,
  NotebookPen,
  Palette,
  Pencil,
  SlidersHorizontal,
  StickyNote,
  Trash2,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Case, DocGroup, DocKind, Document } from '../../../core/model/types';
import * as casesService from '../../../services/cases';
import * as docsService from '../../../services/documents';
import * as groupsService from '../../../services/groups';
import * as memosService from '../../../services/memos';
import { listDocuments, type DocumentRow } from '../../../services/queries';
import { combineUndo, commit, Plan, q, type Undoable } from '../../../services/undo';
import { useProject } from '../../../shell/AppState';
import { useRouter } from '../../../shell/router';
import { useUndo } from '../../../shell/undo';
import { useLive } from '../../../shell/useLive';
import { cx } from '../../../ui/cx';
import { useI18n } from '../../../ui/i18n';
import { pointRect, type Rect } from '../../../ui/position';
import { Button, IconButton } from '../../../ui/components/Button';
import { useConfirm } from '../../../ui/components/Confirm';
import { EmptyState } from '../../../ui/components/Feedback';
import { SearchField } from '../../../ui/components/Field';
import { Menu, MenuButton, type MenuEntry } from '../../../ui/components/Menu';
import { useToast } from '../../../ui/components/Toast';
import { useFail, useUndoToast } from '../../common/CodeTreeActions';
import { CasePicker, ColourPopover, DocumentMemoDialog, DocumentPropertiesDialog, NamePrompt, type DocumentChanges } from './DocumentDialogs';
import { DocumentGroups } from './DocumentGroups';
import { DOCS_MIME, displayOrder, filterDocs, rangeIds, reorderPlan, sectionDocs, sortDocs, type DocGrouping, type DocItem, type DocSort, type Section } from './documentList';
import './panels.css';

export interface DocumentsPanelProps {
  activeDocId: string | null;
  onOpen(docId: string): void;
}

export { DOCS_MIME };

export const KIND_ICON: Record<DocKind, LucideIcon> = {
  text: FileText,
  transcript: MessagesSquare,
  pdf: FileType,
  survey: ClipboardList,
  note: StickyNote,
};

const VIEW_KEY = 'trama.documents.view';

interface View {
  sort: DocSort;
  grouping: DocGrouping;
  collapsed: string[];
  groupsOpen: boolean;
}

function readView(projectId: string): View {
  const fallback: View = { sort: 'manual', grouping: 'all', collapsed: [], groupsOpen: true };
  try {
    const raw = JSON.parse(localStorage.getItem(`${VIEW_KEY}.${projectId}`) ?? 'null') as Partial<View> | null;
    if (!raw) return fallback;
    return {
      sort: (['manual', 'name', 'coded', 'recent'] as const).includes(raw.sort as DocSort) ? (raw.sort as DocSort) : 'manual',
      grouping: (['all', 'group', 'case'] as const).includes(raw.grouping as DocGrouping) ? (raw.grouping as DocGrouping) : 'all',
      collapsed: Array.isArray(raw.collapsed) ? raw.collapsed.filter((x): x is string => typeof x === 'string') : [],
      groupsOpen: raw.groupsOpen !== false,
    };
  } catch {
    return fallback;
  }
}

const toItem = (r: DocumentRow): DocItem => ({
  id: r.document.id,
  name: r.document.name,
  kind: r.document.kind,
  codings: r.codings,
  caseId: r.document.case_id,
  caseName: r.caseName,
  groupIds: r.document.group_ids,
  groupNames: r.groupNames,
  color: r.document.color,
  order: r.document.order,
  addedAt: r.document.source?.imported_at || r.document.created_at,
  filename: r.document.source?.filename ?? '',
});

type MenuState = { ids: string[]; at: Rect } | null;

/**
 * The Workbench's document list: grouped by document group or case, filtered, sorted, dragged
 * into a manual order; several documents can be selected (Shift/Ctrl+click) for bulk changes.
 * Keyboard: ↑/↓ move, Shift+↑/↓ extend, Enter opens, F2 renames, Delete deletes.
 */
export function DocumentsPanel({ activeDocId, onOpen }: DocumentsPanelProps) {
  const { t, tp, meta } = useI18n();
  const project = useProject();
  const { go } = useRouter();
  const { record } = useUndo();
  const toast = useToast();
  const confirm = useConfirm();
  const undoToast = useUndoToast();
  const fail = useFail();

  const { data } = useLive(
    async () => {
      const [rows, groups, cases] = await Promise.all([listDocuments(project), groupsService.listGroups(project), project.store.list('case')]);
      return { rows, groups, cases };
    },
    [project],
    ['document', 'coding', 'case', 'docgroup'],
  );

  const [view, setViewState] = useState<View>(() => readView(project.id));
  const setView = (patch: Partial<View>) =>
    setViewState((v) => {
      const next = { ...v, ...patch };
      try {
        localStorage.setItem(`${VIEW_KEY}.${project.id}`, JSON.stringify(next));
      } catch {
        // Not remembered; it still applies now.
      }
      return next;
    });
  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [groupMenu, setGroupMenu] = useState<MenuState>(null);
  const [casePicker, setCasePicker] = useState<{ ids: string[]; at: Rect | React.RefObject<HTMLElement | null> } | null>(null);
  const [colour, setColour] = useState<{ ids: string[]; at: Rect } | null>(null);
  const [memoDoc, setMemoDoc] = useState<string | null>(null);
  const [propsDoc, setPropsDoc] = useState<string | null>(null);
  const [newGroupFor, setNewGroupFor] = useState<string[] | null>(null);
  const [drop, setDrop] = useState<{ id: string; below: boolean } | null>(null);
  const dragIds = useRef<string[] | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const caseButton = useRef<HTMLButtonElement>(null);

  const rows = data?.rows;
  const groups = useMemo(() => data?.groups ?? [], [data]);
  const cases = useMemo(() => data?.cases ?? [], [data]);
  const docById = useMemo(() => new Map((rows ?? []).map((r) => [r.document.id, r.document])), [rows]);
  const items = useMemo(() => (rows ?? []).map(toItem), [rows]);
  const manualOrder = useMemo(() => items.map((d) => d.id), [items]);

  const shownItems = useMemo(() => {
    const inGroup = groupFilter ? items.filter((d) => d.groupIds.includes(groupFilter)) : items;
    return sortDocs(filterDocs(inGroup, query), view.sort, meta.bcp47);
  }, [items, query, groupFilter, view.sort, meta.bcp47]);
  const sections = useMemo(
    () => sectionDocs(shownItems, view.grouping, groups, cases, view.grouping === 'case' ? t('documents.sections.noCase') : t('documents.sections.noGroup'), meta.bcp47),
    [shownItems, view.grouping, groups, cases, t, meta.bcp47],
  );
  const collapsedSections = useMemo(() => new Set(view.collapsed), [view.collapsed]);
  const order = useMemo(() => displayOrder(sections, collapsedSections), [sections, collapsedSections]);
  // A document listed in two groups takes the Tab stop only in the first.
  const firstSection = useMemo(() => {
    const m = new Map<string, string>();
    for (const sec of sections) for (const d of sec.items) if (!m.has(d.id)) m.set(d.id, sec.key);
    return m;
  }, [sections]);
  const canReorder = view.sort === 'manual' && view.grouping === 'all' && !query.trim() && !groupFilter;

  // Forget selected documents that are gone.
  useEffect(() => {
    if (!rows) return;
    setSelected((s) => {
      const next = new Set([...s].filter((id) => docById.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [rows, docById]);

  const tabId = (focusedId && order.includes(focusedId) ? focusedId : null) ?? (activeDocId && order.includes(activeDocId) ? activeDocId : null) ?? order[0] ?? null;

  const focusDoc = useCallback((id: string) => {
    setFocusedId(id);
    // At once when the row is there (fast key repeats must land on it), else after render.
    const go = () => {
      const el = list.current?.querySelector<HTMLElement>(`[data-doc-id="${CSS.escape(id)}"]`);
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: 'nearest' });
      return !!el;
    };
    if (!go()) requestAnimationFrame(go);
  }, []);

  // ── Operations ────────────────────────────────────────────────────────────────────────────
  const targets = (id: string) => (selected.has(id) && selected.size > 1 ? order.filter((x) => selected.has(x)) : [id]);
  const nameOf = (id: string) => docById.get(id)?.name ?? '';

  const rename = async (id: string, name: string) => {
    setRenamingId(null);
    focusDoc(id);
    if (!name.trim() || name.trim() === nameOf(id)) return;
    try {
      record((await docsService.renameDocument(project, id, name)).undo);
    } catch (e) {
      fail(e);
    }
  };

  const setCase = async (ids: string[], caseId: string | null) => {
    try {
      const parts: Undoable[] = [];
      for (const id of ids) parts.push((await docsService.setDocumentCase(project, id, caseId)).undo);
      record(parts.length === 1 ? parts[0]! : combineUndo('document.edit', `×${parts.length}`, parts));
    } catch (e) {
      fail(e);
    }
  };

  const createCase = async (ids: string[], name: string) => {
    try {
      const { case: c, undo } = await casesService.createCase(project, { name });
      const parts: Undoable[] = [undo];
      for (const id of ids) parts.push((await docsService.setDocumentCase(project, id, c.id)).undo);
      record(combineUndo('case.create', q(c.name), parts));
      toast.show({ message: t('documents.toast.caseCreated', { name: c.name }), tone: 'success' });
    } catch (e) {
      fail(e);
    }
  };

  const toggleGroup = async (ids: string[], groupId: string, add: boolean) => {
    try {
      const res = add ? await groupsService.addToGroup(project, groupId, ids) : await groupsService.removeFromGroup(project, groupId, ids);
      record(res.undo);
    } catch (e) {
      fail(e);
    }
  };

  const createGroupWith = async (ids: string[], name: string) => {
    try {
      const { group, undo } = await groupsService.createGroup(project, { name });
      const parts: Undoable[] = [undo];
      if (ids.length) parts.push((await groupsService.addToGroup(project, group.id, ids)).undo);
      record(combineUndo('group.create', q(group.name), parts));
      setNewGroupFor(null);
    } catch (e) {
      fail(e);
    }
  };

  const setColor = async (ids: string[], color: string | null) => {
    try {
      const parts: Undoable[] = [];
      for (const id of ids) parts.push((await docsService.setDocumentColor(project, id, color)).undo);
      record(parts.length === 1 ? parts[0]! : combineUndo('document.edit', `×${parts.length}`, parts));
    } catch (e) {
      fail(e);
    }
  };

  const remove = async (ids: string[]) => {
    if (!ids.length) return;
    const codings = ids.reduce((n, id) => n + (items.find((d) => d.id === id)?.codings ?? 0), 0);
    const ok = await confirm({
      title: ids.length === 1 ? t('documents.delete.titleOne', { name: nameOf(ids[0]!) }) : tp('documents.delete.titleMany', ids.length),
      body: (
        <>
          {codings > 0 ? tp('documents.delete.codings', codings) : t('documents.delete.noCodings')} {t('documents.delete.undoHint')}
        </>
      ),
      confirmLabel: tp('documents.delete.confirm', ids.length),
      danger: true,
      'data-testid': 'delete-docs-dialog',
    });
    if (!ok) return;
    try {
      const res = await docsService.deleteDocuments(project, ids);
      setSelected(new Set());
      undoToast(res.documents === 1 ? t('documents.toast.deletedOne', { name: nameOf(ids[0]!) }) : tp('documents.toast.deletedMany', res.documents), res.undo);
    } catch (e) {
      fail(e);
    }
  };

  const saveMemo = async (docId: string, memo: { id: string } | null, title: string, body: string) => {
    try {
      if (memo) record((await memosService.updateMemo(project, memo.id, { title, body })).undo);
      else record((await memosService.createMemo(project, { title, body, target: { kind: 'document', id: docId } })).undo);
      setMemoDoc(null);
      toast.show({ message: t('documents.toast.memoSaved'), tone: 'success' });
    } catch (e) {
      fail(e);
    }
  };

  const saveProperties = async (doc: Document, ch: DocumentChanges) => {
    try {
      const parts: Undoable[] = [];
      if (ch.name.trim() !== doc.name) parts.push((await docsService.renameDocument(project, doc.id, ch.name)).undo);
      if (ch.caseId !== doc.case_id) parts.push((await docsService.setDocumentCase(project, doc.id, ch.caseId)).undo);
      const sameGroups = ch.groupIds.length === doc.group_ids.length && ch.groupIds.every((g) => doc.group_ids.includes(g));
      if (!sameGroups) parts.push((await docsService.setDocumentGroups(project, doc.id, ch.groupIds)).undo);
      if (ch.color !== doc.color) parts.push((await docsService.setDocumentColor(project, doc.id, ch.color)).undo);
      if (ch.kind !== doc.kind) {
        // There is no service for the kind alone: a one-field change, through the same plumbing.
        const current = await project.store.get('document', doc.id);
        if (current && !current.deleted) {
          const plan = new Plan();
          plan.change('document', current, { kind: ch.kind });
          const summary = `${q(doc.name)}: ${doc.kind} → ${ch.kind}`;
          parts.push((await commit(project, plan, { label: 'document.edit', detail: summary, logs: [{ action: 'document.edit', summary, target: { kind: 'document', id: doc.id } }] })).undo);
        }
      }
      if (parts.length) record(parts.length === 1 ? parts[0]! : combineUndo('document.edit', q(doc.name), parts));
      setPropsDoc(null);
    } catch (e) {
      fail(e);
    }
  };

  // ── Selection ─────────────────────────────────────────────────────────────────────────────
  const selectOnly = (id: string) => {
    setSelected(new Set([id]));
    anchor.current = id;
  };

  const onRowClick = (e: React.MouseEvent, id: string) => {
    setFocusedId(id);
    if (e.shiftKey) {
      setSelected(new Set(rangeIds(order, anchor.current ?? activeDocId, id)));
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((s) => {
        const next = new Set(s.size ? s : activeDocId ? [activeDocId] : []);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      anchor.current = id;
      return;
    }
    selectOnly(id);
    onOpen(id);
  };

  const menuItems = (ids: string[], at: Rect): MenuEntry[] => {
    const one = ids.length === 1 ? ids[0]! : null;
    const docs = ids.map((id) => docById.get(id)).filter((d): d is Document => !!d);
    return [
      ...(one
        ? [
            { id: 'open', label: t('documents.menu.open'), icon: FileText, hint: '↵', onSelect: () => onOpen(one), testId: 'doc-menu-open' },
            { id: 'rename', label: t('documents.menu.rename'), icon: Pencil, hint: 'F2', onSelect: () => setRenamingId(one), testId: 'doc-menu-rename' },
            { kind: 'separator' as const },
          ]
        : [{ kind: 'heading' as const, label: tp('documents.selection.count', ids.length) }]),
      { id: 'case', label: t('documents.menu.setCase'), icon: UserRound, onSelect: () => setCasePicker({ ids, at }), testId: 'doc-menu-case' },
      { id: 'groups', label: t('documents.menu.groups'), icon: FolderInput, onSelect: () => setGroupMenu({ ids, at }), testId: 'doc-menu-groups' },
      { id: 'colour', label: t('documents.menu.colour'), icon: Palette, onSelect: () => setColour({ ids, at }), testId: 'doc-menu-colour' },
      ...(one
        ? [
            { kind: 'separator' as const },
            { id: 'memo', label: t('documents.menu.memo'), icon: NotebookPen, onSelect: () => setMemoDoc(one), testId: 'doc-menu-memo' },
            { id: 'props', label: t('documents.menu.properties'), icon: SlidersHorizontal, onSelect: () => setPropsDoc(one), testId: 'doc-menu-properties' },
          ]
        : []),
      { kind: 'separator' as const },
      {
        id: 'delete',
        label: docs.length > 1 ? tp('documents.menu.deleteMany', docs.length) : t('documents.menu.delete'),
        icon: Trash2,
        danger: true,
        hint: t('documents.menu.deleteKey'),
        onSelect: () => void remove(ids),
        testId: 'doc-menu-delete',
      },
    ];
  };

  const groupItems = (ids: string[]): MenuEntry[] => {
    const docs = ids.map((id) => docById.get(id)).filter((d): d is Document => !!d);
    return [
      { kind: 'heading', label: t('documents.menu.groupsHeading') },
      ...groups.map((g) => {
        const inAll = docs.length > 0 && docs.every((d) => d.group_ids.includes(g.id));
        return {
          id: g.id,
          label: g.name,
          checked: inAll,
          onSelect: () => void toggleGroup(ids, g.id, !inAll),
          testId: `doc-group-${g.id}`,
        };
      }),
      ...(groups.length ? [{ kind: 'separator' as const }] : []),
      { id: 'new', label: t('documents.menu.newGroup'), icon: FolderPlus, onSelect: () => setNewGroupFor(ids), testId: 'doc-group-new' },
    ];
  };

  const openMenu = (id: string, at: Rect) => {
    if (!selected.has(id)) selectOnly(id);
    setFocusedId(id);
    setMenu({ ids: selected.has(id) && selected.size > 1 ? targets(id) : [id], at });
  };

  // ── Keyboard ──────────────────────────────────────────────────────────────────────────────
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (renamingId || e.defaultPrevented) return;
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-doc-id]')?.dataset.docId ?? tabId;
    if (!id) return;
    const i = order.indexOf(id);
    const moveTo = (j: number) => {
      const next = order[Math.max(0, Math.min(order.length - 1, j))];
      if (!next) return;
      e.preventDefault();
      if (e.shiftKey) setSelected(new Set(rangeIds(order, anchor.current ?? id, next)));
      else selectOnly(next);
      focusDoc(next);
    };
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const r = list.current?.querySelector(`[data-doc-id="${CSS.escape(id)}"]`)?.getBoundingClientRect();
      if (r) openMenu(id, { top: r.top, left: r.left + 24, width: 0, height: r.height });
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSelected(new Set(order));
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case 'ArrowDown':
        return moveTo(i + 1);
      case 'ArrowUp':
        return moveTo(i - 1);
      case 'Home':
        return moveTo(0);
      case 'End':
        return moveTo(order.length - 1);
      case 'Enter':
        e.preventDefault();
        selectOnly(id);
        onOpen(id);
        return;
      case ' ':
        e.preventDefault();
        setSelected((s) => {
          const next = new Set(s);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        anchor.current = id;
        return;
      case 'F2':
        e.preventDefault();
        setRenamingId(id);
        return;
      case 'Delete':
        e.preventDefault();
        void remove(targets(id));
        return;
      case 'Escape':
        if (selected.size > 1) {
          e.preventDefault();
          selectOnly(id);
        }
        return;
    }
  };

  // ── Drag ──────────────────────────────────────────────────────────────────────────────────
  const onDragStart = (e: React.DragEvent, id: string) => {
    if (renamingId) return e.preventDefault();
    const ids = targets(id);
    dragIds.current = ids;
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData(DOCS_MIME, JSON.stringify(ids));
    e.dataTransfer.setData('text/plain', ids.map(nameOf).join('\n'));
  };
  const onDragOver = (e: React.DragEvent, id: string) => {
    if (!canReorder || !dragIds.current || !e.dataTransfer.types.includes(DOCS_MIME)) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const below = e.clientY - rect.top > rect.height / 2;
    if (!reorderPlan(manualOrder, dragIds.current, id, below)) {
      if (drop) setDrop(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (drop?.id !== id || drop.below !== below) setDrop({ id, below });
  };
  const onDrop = async (e: React.DragEvent) => {
    const d = drop;
    setDrop(null);
    const ids = dragIds.current;
    dragIds.current = null;
    if (!d || !ids) return;
    e.preventDefault();
    const plan = reorderPlan(manualOrder, ids, d.id, d.below);
    if (!plan) return;
    try {
      const parts: Undoable[] = [];
      for (const id of plan.ids) parts.push(await docsService.reorderDocument(project, id, plan.beforeId));
      record(parts.length === 1 ? parts[0]! : combineUndo('document.order', `×${parts.length}`, parts));
    } catch (err) {
      fail(err);
    }
  };

  // Row handlers that never change identity, so a row re-renders only when its own data does.
  const live = useRef({ onRowClick, openMenu, rename, onDragStart, onDragOver, focusDoc });
  live.current = { onRowClick, openMenu, rename, onDragStart, onDragOver, focusDoc };
  const rowHandlers = useMemo(
    () => ({
      onClick: (e: React.MouseEvent, id: string) => live.current.onRowClick(e, id),
      onContextMenu: (e: React.MouseEvent, id: string) => {
        e.preventDefault();
        live.current.openMenu(id, pointRect(e.clientX, e.clientY));
      },
      onMore: (id: string, r: Rect) => live.current.openMenu(id, r),
      onFocus: (id: string) => setFocusedId(id),
      onRename: (id: string, name: string) => void live.current.rename(id, name),
      onCancelRename: (id: string) => {
        setRenamingId(null);
        live.current.focusDoc(id);
      },
      onDragStart: (e: React.DragEvent, id: string) => live.current.onDragStart(e, id),
      onDragOver: (e: React.DragEvent, id: string) => live.current.onDragOver(e, id),
      onDragEnd: () => {
        dragIds.current = null;
        setDrop(null);
      },
    }),
    [],
  );

  // ── Render ────────────────────────────────────────────────────────────────────────────────
  const selCount = selected.size;
  const selIds = order.filter((id) => selected.has(id));
  const casesOf = (ids: string[]) => {
    const set = new Set(ids.map((id) => docById.get(id)?.case_id ?? null));
    return set.size === 1 ? [...set][0]! : undefined;
  };
  const viewItems: MenuEntry[] = [
    { kind: 'heading', label: t('documents.view.sortHeading') },
    ...(['manual', 'name', 'coded', 'recent'] as const).map((s) => ({ id: `sort-${s}`, label: t(`documents.view.sort.${s}`), checked: view.sort === s, onSelect: () => setView({ sort: s }), testId: `doc-sort-${s}` })),
    { kind: 'separator' },
    { kind: 'heading', label: t('documents.view.groupHeading') },
    ...(['all', 'group', 'case'] as const).map((g) => ({ id: `group-${g}`, label: t(`documents.view.group.${g}`), checked: view.grouping === g, onSelect: () => setView({ grouping: g }), testId: `doc-grouping-${g}` })),
  ];
  const filterGroup = groupFilter ? groups.find((g) => g.id === groupFilter) : undefined;
  const memoTarget = memoDoc ? docById.get(memoDoc) : undefined;
  const propsTarget = propsDoc ? docById.get(propsDoc) : undefined;
  const colourValue = colour && colour.ids.length === 1 ? docById.get(colour.ids[0]!)?.color ?? null : null;

  return (
    <section className="dpanel" aria-label={t('documents.panel.title')} data-testid="documents-panel">
      <header className="wpanel__head">
        <h2 className="wpanel__title">
          <span className="wpanel__name">{t('documents.panel.title')}</span>
          {rows ? <span className="wpanel__count">{rows.length}</span> : null}
        </h2>
        <div className="wpanel__tools">
          <MenuButton items={viewItems} label={t('documents.view.label')} icon={ArrowUpDown} iconOnly size="sm" variant="ghost" align="end" data-testid="doc-view" />
          <IconButton icon={FileUp} label={t('documents.panel.import')} size="sm" variant="secondary" onClick={() => go({ name: 'import' })} data-testid="doc-import" />
        </div>
      </header>
      <div className="dpanel__filter">
        <SearchField value={query} onChange={setQuery} size="sm" placeholder={t('documents.panel.filter')} aria-label={t('documents.panel.filter')}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && tabId) {
              e.preventDefault();
              focusDoc(tabId);
            }
          }}
          data-testid="doc-filter" />
        {filterGroup ? (
          <button type="button" className="dpanel__chip" onClick={() => setGroupFilter(null)} aria-label={t('documents.panel.clearGroupFilter', { name: filterGroup.name })} data-testid="doc-group-filter">
            <span className="dpicker__dot" style={{ background: filterGroup.color }} aria-hidden />
            {filterGroup.name}
            <X size={12} aria-hidden />
          </button>
        ) : null}
      </div>

      {selCount > 1 ? (
        <div className="dpanel__bulk" role="toolbar" aria-label={tp('documents.selection.count', selCount)} data-testid="doc-bulk">
          <span className="dpanel__bulk-count" title={tp('documents.selection.count', selCount)}>
            <span className="dpanel__bulk-full">{tp('documents.selection.count', selCount)}</span>
            <span className="dpanel__bulk-short" aria-hidden>
              <CheckCheck size={13} />
              {selCount}
            </span>
          </span>
          <IconButton ref={caseButton} icon={UserRound} label={t('documents.menu.setCase')} size="sm" onClick={() => setCasePicker({ ids: selIds, at: caseButton })} data-testid="doc-bulk-case" />
          <IconButton
            icon={FolderInput}
            label={t('documents.menu.groups')}
            size="sm"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setGroupMenu({ ids: selIds, at: { top: r.top, left: r.left, width: r.width, height: r.height } });
            }}
            data-testid="doc-bulk-groups"
          />
          <IconButton icon={Trash2} label={tp('documents.menu.deleteMany', selCount)} size="sm" onClick={() => void remove(selIds)} data-testid="doc-bulk-delete" />
          <IconButton icon={X} label={t('documents.selection.clear')} size="sm" onClick={() => setSelected(new Set(activeDocId ? [activeDocId] : []))} data-testid="doc-bulk-clear" />
        </div>
      ) : null}

      <div className="wpanel__scroll" onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDrop(null)}>
        {rows && rows.length === 0 ? (
          <EmptyState icon={FileText} title={t('documents.panel.emptyTitle')} className="wpanel__empty" data-testid="documents-empty"
            actions={<Button size="sm" variant="primary" icon={FileUp} onClick={() => go({ name: 'import' })}>{t('documents.panel.import')}</Button>}>
            {t('documents.panel.emptyBody')}
          </EmptyState>
        ) : rows && shownItems.length === 0 ? (
          <p className="dpanel__nomatch" data-testid="doc-nomatch">{t('documents.panel.noMatch')}</p>
        ) : null}
        <div
          ref={list}
          role="listbox"
          aria-label={t('documents.panel.title')}
          aria-multiselectable
          className="dpanel__list"
          onKeyDown={onKeyDown}
          onDrop={(e) => void onDrop(e)}
          data-testid="doc-list"
        >
          {sections.map((s) => (
            <SectionView
              key={s.key}
              section={s}
              collapsed={collapsedSections.has(s.key)}
              onToggle={() => setView({ collapsed: collapsedSections.has(s.key) ? view.collapsed.filter((k) => k !== s.key) : [...view.collapsed, s.key] })}
            >
              {s.items.map((d) => (
                <DocRow
                  key={`${s.key}:${d.id}`}
                  item={d}
                  active={d.id === activeDocId}
                  selected={selected.has(d.id) && (selCount > 1 || d.id !== activeDocId)}
                  tabbable={d.id === tabId && firstSection.get(d.id) === s.key}
                  renaming={renamingId === d.id}
                  draggable={!renamingId}
                  drop={drop?.id === d.id ? (drop.below ? 'below' : 'above') : null}
                  showCase={view.grouping !== 'case'}
                  {...rowHandlers}
                />
              ))}
            </SectionView>
          ))}
        </div>
      </div>

      <DocumentGroups
        groups={groups}
        items={items}
        open={view.groupsOpen}
        onOpenChange={(groupsOpen) => setView({ groupsOpen })}
        filterId={groupFilter}
        onFilter={(id) => setGroupFilter((cur) => (cur === id ? null : id))}
        onDropDocs={(groupId, ids) => void toggleGroup(ids, groupId, true)}
        onDeleted={(id) => groupFilter === id && setGroupFilter(null)}
      />

      <Menu open={menu !== null} onClose={() => setMenu(null)} anchor={menu?.at ?? null} items={menu ? menuItems(menu.ids, menu.at) : []} label={t('documents.menu.label')} data-testid="doc-menu" />
      <Menu open={groupMenu !== null} onClose={() => setGroupMenu(null)} anchor={groupMenu?.at ?? null} items={groupMenu ? groupItems(groupMenu.ids) : []} label={t('documents.menu.groups')} data-testid="doc-groups-menu" />
      {casePicker ? (
        <CasePicker
          at={casePicker.at}
          cases={cases as Case[]}
          current={casesOf(casePicker.ids)}
          onClose={() => setCasePicker(null)}
          onPick={(caseId) => void setCase(casePicker.ids, caseId)}
          onCreate={(name) => void createCase(casePicker.ids, name)}
        />
      ) : null}
      <ColourPopover at={colour?.at ?? null} value={colourValue} label={t('documents.menu.colour')} onClose={() => setColour(null)} onChange={(c) => colour && void setColor(colour.ids, c)} />
      <NamePrompt
        open={newGroupFor !== null}
        title={t('documents.groups.newTitle')}
        label={t('documents.groups.name')}
        confirm={t('documents.groups.create')}
        onCancel={() => setNewGroupFor(null)}
        onSubmit={(name) => createGroupWith(newGroupFor ?? [], name)}
      />
      {memoTarget ? (
        <DocumentMemoDialog
          doc={memoTarget}
          onClose={() => setMemoDoc(null)}
          onSave={(m, title, body) => saveMemo(memoTarget.id, m, title, body)}
          onOpenMemos={(memoId) => {
            setMemoDoc(null);
            go({ name: 'memos', memoId: memoId ?? undefined });
          }}
        />
      ) : null}
      {propsTarget ? <DocumentPropertiesDialog doc={propsTarget} cases={cases as Case[]} groups={groups as DocGroup[]} onClose={() => setPropsDoc(null)} onSave={(ch) => saveProperties(propsTarget, ch)} /> : null}
    </section>
  );
}

function SectionView({ section, collapsed, onToggle, children }: { section: Section; collapsed: boolean; onToggle: () => void; children: React.ReactNode }) {
  const { t, tp } = useI18n();
  if (section.kind === 'all') return <>{children}</>;
  return (
    <div role="group" aria-label={section.title ?? undefined} className="dpanel__section" data-testid={`doc-section-${section.key}`}>
      <button type="button" className="dpanel__section-head" aria-expanded={!collapsed} onClick={onToggle} data-testid={`doc-section-toggle-${section.key}`}>
        <ChevronRight size={13} className={cx('dpanel__section-chevron', !collapsed && 'dpanel__section-chevron--open')} aria-hidden />
        {section.kind === 'case' ? (
          <UserRound size={13} aria-hidden className="dpanel__section-icon" style={section.color ? { color: section.color } : undefined} />
        ) : section.kind === 'group' ? (
          <span className="dpicker__dot" style={{ background: section.color ?? 'var(--ink-4)' }} aria-hidden />
        ) : (
          <Layers size={13} aria-hidden className="dpanel__section-icon" />
        )}
        <span className="dpanel__section-title">{section.title}</span>
        <span className="dpanel__section-count" title={tp('common.count.documents', section.items.length)}>
          {section.items.length}
        </span>
        <span className="visually-hidden">{collapsed ? t('documents.sections.collapsed') : ''}</span>
      </button>
      {collapsed ? null : children}
    </div>
  );
}

interface DocRowProps {
  item: DocItem;
  active: boolean;
  selected: boolean;
  tabbable: boolean;
  renaming: boolean;
  draggable: boolean;
  drop: 'above' | 'below' | null;
  showCase: boolean;
  onClick: (e: React.MouseEvent, id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onMore: (id: string, at: Rect) => void;
  onFocus: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onCancelRename: (id: string) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
}

const DocRow = memo(function DocRow(p: DocRowProps) {
  const { t, tp } = useI18n();
  const { item } = p;
  const Icon = KIND_ICON[item.kind] ?? FileText;
  return (
    <div
      role="option"
      aria-selected={p.selected || p.active}
      aria-current={p.active ? 'true' : undefined}
      tabIndex={p.tabbable ? 0 : -1}
      data-doc-id={item.id}
      data-testid={`doc-${item.id}`}
      draggable={p.draggable && !p.renaming}
      className={cx('drow', p.active && 'drow--active', p.selected && 'drow--selected', p.drop && `drow--drop-${p.drop}`)}
      onClick={(e) => !p.renaming && p.onClick(e, item.id)}
      onContextMenu={(e) => p.onContextMenu(e, item.id)}
      onFocus={(e) => e.target === e.currentTarget && p.onFocus(item.id)}
      onDragStart={(e) => p.onDragStart(e, item.id)}
      onDragOver={(e) => p.onDragOver(e, item.id)}
      onDragEnd={p.onDragEnd}
      title={item.filename && item.filename !== item.name ? item.filename : undefined}
    >
      {item.color ? <span className="drow__spine" style={{ background: item.color }} aria-hidden /> : null}
      <Icon size={15} strokeWidth={1.6} className="drow__icon" aria-label={t(`documents.kinds.${item.kind}`)} />
      {p.renaming ? (
        <RenameField name={item.name} onCommit={(n) => p.onRename(item.id, n)} onCancel={() => p.onCancelRename(item.id)} />
      ) : (
        <span className="drow__main">
          <span className="drow__name">{item.name}</span>
          {p.showCase && item.caseName ? (
            <span className="drow__case">
              <UserRound size={11} aria-hidden />
              {item.caseName}
            </span>
          ) : null}
        </span>
      )}
      {item.codings > 0 ? (
        <span className="drow__count" title={tp('common.count.codings', item.codings)}>
          {item.codings}
        </span>
      ) : null}
      <button
        type="button"
        className="drow__more"
        tabIndex={-1}
        aria-label={t('documents.menu.labelFor', { name: item.name })}
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          p.onMore(item.id, { top: r.top, left: r.left, width: r.width, height: r.height });
        }}
        data-testid="doc-more"
      >
        <Ellipsis size={14} aria-hidden />
      </button>
    </div>
  );
});

function RenameField({ name, onCommit, onCancel }: { name: string; onCommit: (n: string) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(name);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (ok: boolean) => {
    if (done.current) return;
    done.current = true;
    if (ok && value.trim()) onCommit(value);
    else onCancel();
  };
  return (
    <input
      ref={ref}
      className="drow__rename"
      value={value}
      maxLength={200}
      aria-label={t('documents.panel.renameLabel')}
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
      data-testid="doc-rename"
    />
  );
}

export default DocumentsPanel;

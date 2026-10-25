import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Code } from '../../core/model/types';
import * as codesService from '../../services/codes';
import { uniqueName } from '../../services/documents';
import { listCodesWithCounts, type CodeRow } from '../../services/queries';
import { ServiceError, type Undoable } from '../../services/undo';
import { useProject } from '../../shell/AppState';
import { useUndo } from '../../shell/undo';
import { useLive } from '../../shell/useLive';
import type { MessageKey } from '../../ui/i18n';
import { useI18n } from '../../ui/i18n';
import { useToast } from '../../ui/components/Toast';
import { subtreeIds, type TreeItem } from './codeTreeModel';
import { CodeDefinitionDialog, DeleteCodeDialog, MergeIntoDialog } from './CodeTreeDialogs';

// Shared plumbing of the code tree: the codebook as live data, which branches are folded
// (remembered per project on this computer), and the operations every place that shows codes
// offers (the Workbench's codebook panel, the Codes screen), each recorded for Undo.

export interface CodeData {
  rows: CodeRow[];
  items: TreeItem[];
  byId: Map<string, Code>;
  rowById: Map<string, CodeRow>;
}

const toItem = (r: CodeRow): TreeItem => ({
  id: r.code.id,
  name: r.code.name,
  depth: r.depth,
  color: r.code.color,
  codable: r.code.codable,
  shortcut: r.code.shortcut,
  own: r.own,
  total: r.total,
  childCount: r.childCount,
});

/** The codebook in tree order with counts, refreshed whenever codes or codings change. */
export function useCodeData(): { data: CodeData | undefined; error: unknown } {
  const project = useProject();
  const { data: rows, error } = useLive(() => listCodesWithCounts(project), [project], ['code', 'coding']);
  const data = useMemo<CodeData | undefined>(() => {
    if (!rows) return undefined;
    return {
      rows,
      items: rows.map(toItem),
      byId: new Map(rows.map((r) => [r.code.id, r.code])),
      rowById: new Map(rows.map((r) => [r.code.id, r])),
    };
  }, [rows]);
  return { data, error };
}

/** Folded branches, remembered per project and place (`scope`) in this browser profile. */
export function useCollapsed(scope: string): [Set<string>, (next: Set<string>) => void] {
  const project = useProject();
  const key = `trama.codetree.${project.id}.${scope}`;
  const [collapsed, setState] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(key);
      const list = raw ? (JSON.parse(raw) as unknown) : [];
      return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
    } catch {
      return new Set();
    }
  });
  const set = useCallback(
    (next: Set<string>) => {
      setState(next);
      try {
        localStorage.setItem(key, JSON.stringify([...next]));
      } catch {
        // Not remembered (private window); it still applies now.
      }
    },
    [key],
  );
  return [collapsed, set];
}

/** Records an operation for Undo and says what happened, with an Undo button on the toast. */
export function useUndoToast(): (message: string, undo: Undoable) => void {
  const { record, undo } = useUndo();
  const toast = useToast();
  const { t } = useI18n();
  return useCallback(
    (message: string, entry: Undoable) => {
      record(entry);
      toast.show({ message, action: { label: t('common.undo'), run: () => undo(), testId: 'toast-undo' } });
    },
    [record, undo, toast, t],
  );
}

const ERROR_KEYS: Partial<Record<ServiceError['code'], MessageKey>> = {
  cycle: 'codes.errors.cycle',
  not_found: 'codes.errors.notFound',
  invalid_argument: 'codes.errors.invalid',
  not_codable: 'codes.errors.notCodable',
};

/** A failed operation as a toast in the reader's language. */
export function useFail(): (e: unknown) => void {
  const toast = useToast();
  const { t } = useI18n();
  return useCallback(
    (e: unknown) => {
      const key = e instanceof ServiceError ? ERROR_KEYS[e.code] : undefined;
      if (key) toast.show({ message: t(key), tone: 'danger' });
      else toast.error(e);
    },
    [toast, t],
  );
}

export interface CodeActions {
  /** Creates a code (under `parentId`, or at the top level) and returns it. */
  create: (parentId: string | null, name?: string, opts?: { beforeId?: string | null }) => Promise<Code | null>;
  rename: (id: string, name: string) => Promise<void>;
  /**
   * Takes back a code just made by `create` (Escape on its first name), as Undo would: only
   * while its creation is still the newest entry on the undo stack. Resolves whether it did.
   */
  discardNew: (id: string) => Promise<boolean>;
  setColor: (id: string, color: string) => Promise<void>;
  setCodable: (id: string, codable: boolean) => Promise<void>;
  setShortcut: (id: string, n: number | null) => Promise<void>;
  move: (id: string, parentId: string | null, beforeId: string | null) => Promise<boolean>;
  /** Asks how (with children: delete or lift), then deletes. */
  remove: (id: string) => void;
  /** Asks for the code to keep, then merges `id` into it. */
  mergeInto: (id: string) => void;
  editDefinition: (id: string) => void;
  /** The dialogs these actions open: render once, anywhere. */
  dialogs: ReactNode;
}

/** The code operations, wired to Undo, toasts and the dialogs they need. */
export function useCodeActions(data: CodeData | undefined, opts: { onDeleted?: (ids: Set<string>) => void } = {}): CodeActions {
  const project = useProject();
  const { t, tp } = useI18n();
  const { record, manager } = useUndo();
  const undoToast = useUndoToast();
  // The code `create` just made, while its creation is the newest entry on the undo stack.
  const fresh = useRef<{ id: string; recording: boolean } | null>(null);
  useEffect(
    () =>
      manager.subscribe(() => {
        if (fresh.current && !fresh.current.recording) fresh.current = null;
      }),
    [manager],
  );
  const fail = useFail();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [merging, setMerging] = useState<string | null>(null);
  const [defining, setDefining] = useState<string | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const onDeleted = useRef(opts.onDeleted);
  onDeleted.current = opts.onDeleted;

  const nameOf = (id: string) => dataRef.current?.byId.get(id)?.name ?? '';

  const create = useCallback(
    async (parentId: string | null, name?: string, o: { beforeId?: string | null } = {}) => {
      try {
        const taken = dataRef.current?.items.map((i) => i.name) ?? [];
        const finalName = name?.trim() ? name.trim() : uniqueName(t('codes.newCodeName'), taken);
        const { code, undo } = await codesService.createCode(project, { name: finalName, parent_id: parentId, beforeId: o.beforeId ?? null });
        fresh.current = { id: code.id, recording: true };
        record(undo);
        fresh.current = { id: code.id, recording: false };
        return code;
      } catch (e) {
        fail(e);
        return null;
      }
    },
    [project, record, fail, t],
  );

  const discardNew = useCallback(
    async (id: string) => {
      if (fresh.current?.id !== id) return false;
      fresh.current = null;
      try {
        return (await manager.undo()) !== null;
      } catch (e) {
        fail(e);
        return false;
      }
    },
    [manager, fail],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      if (!name.trim() || name.trim() === nameOf(id)) return;
      try {
        record((await codesService.updateCode(project, id, { name })).undo);
      } catch (e) {
        fail(e);
      }
    },
    [project, record, fail],
  );

  const setColor = useCallback(
    async (id: string, color: string) => {
      try {
        record((await codesService.updateCode(project, id, { color })).undo);
      } catch (e) {
        fail(e);
      }
    },
    [project, record, fail],
  );

  const setCodable = useCallback(
    async (id: string, codable: boolean) => {
      try {
        record((await codesService.updateCode(project, id, { codable })).undo);
      } catch (e) {
        fail(e);
      }
    },
    [project, record, fail],
  );

  const setShortcut = useCallback(
    async (id: string, n: number | null) => {
      try {
        record((await codesService.setShortcut(project, id, n)).undo);
      } catch (e) {
        fail(e);
      }
    },
    [project, record, fail],
  );

  const move = useCallback(
    async (id: string, parentId: string | null, beforeId: string | null) => {
      try {
        const { undo } = await codesService.moveCode(project, id, parentId, beforeId);
        record(undo);
        return true;
      } catch (e) {
        fail(e);
        return false;
      }
    },
    [project, record, fail],
  );

  const deletingItem = deleting ? data?.items.find((i) => i.id === deleting) : undefined;
  const branch = useMemo(() => (deleting && data ? subtreeIds(data.items, deleting) : new Set<string>()), [deleting, data]);

  const confirmDelete = async (mode: 'delete' | 'lift') => {
    const id = deleting;
    if (!id) return;
    const name = nameOf(id);
    const ids = mode === 'delete' ? branch : new Set([id]);
    try {
      const res = await codesService.deleteCode(project, id, { withChildren: mode });
      setDeleting(null);
      onDeleted.current?.(ids);
      undoToast(tp('codes.toast.deleted', res.codings, { name }), res.undo);
    } catch (e) {
      setDeleting(null);
      fail(e);
    }
  };

  const confirmMerge = async (targetId: string) => {
    const id = merging;
    if (!id) return;
    const name = nameOf(id);
    try {
      const res = await codesService.mergeCodes(project, [id], targetId);
      setMerging(null);
      onDeleted.current?.(new Set([id]));
      undoToast(tp('codes.toast.merged', res.moved, { name, target: nameOf(targetId) }), res.undo);
    } catch (e) {
      setMerging(null);
      fail(e);
    }
  };

  const saveDefinition = async (patch: codesService.CodePatch) => {
    const id = defining;
    if (!id) return;
    try {
      record((await codesService.updateCode(project, id, patch)).undo);
      setDefining(null);
    } catch (e) {
      fail(e);
    }
  };

  useEffect(() => {
    // The code went away under an open dialog (undo, a teammate's merge): close it.
    if (!data) return;
    if (deleting && !data.byId.has(deleting)) setDeleting(null);
    if (merging && !data.byId.has(merging)) setMerging(null);
    if (defining && !data.byId.has(defining)) setDefining(null);
  }, [data, deleting, merging, defining]);

  const dialogs = (
    <>
      {deletingItem && data ? (
        <DeleteCodeDialog
          item={deletingItem}
          descendants={branch.size - 1}
          onCancel={() => setDeleting(null)}
          onConfirm={(mode) => confirmDelete(mode)}
        />
      ) : null}
      {merging && data ? (
        <MergeIntoDialog source={data.items.find((i) => i.id === merging)!} items={data.items} onCancel={() => setMerging(null)} onConfirm={(target) => confirmMerge(target)} />
      ) : null}
      {defining && data?.byId.get(defining) ? (
        <CodeDefinitionDialog code={data.byId.get(defining)!} onCancel={() => setDefining(null)} onSave={saveDefinition} />
      ) : null}
    </>
  );

  return {
    create,
    rename,
    discardNew,
    setColor,
    setCodable,
    setShortcut,
    move,
    remove: setDeleting,
    mergeInto: setMerging,
    editDefinition: setDefining,
    dialogs,
  };
}

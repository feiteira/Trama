import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { type Undoable, UndoManager, type UndoState } from '../services/undo';
import { isTextEntry, modalOpen } from '../ui/focus';
import { useToast } from '../ui/components/Toast';

// The open project's undo/redo stack (services/undo.ts), shared by every screen. Screens
// record what a domain operation returns:
//   const { code, undo } = await createCode(project, {...});
//   record(undo);
// Ctrl/⌘+Z and Shift+Ctrl/⌘+Z (or Ctrl+Y) undo and redo outside text fields, where the field's
// own undo applies, and never while a dialog is open over the screen.

export interface UndoValue {
  manager: UndoManager;
  state: UndoState;
  record: (entry: Undoable) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const Ctx = createContext<UndoValue | null>(null);

export function useUndo(): UndoValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUndo outside an open project');
  return v;
}

/** One stack per open project: mount it keyed on the project id. */
export function UndoProvider({ children }: { children: ReactNode }) {
  const [manager] = useState(() => new UndoManager());
  const toast = useToast();
  useEffect(() => () => manager.clear(), [manager]);
  const state = useSyncExternalStore(
    useCallback((fn: () => void) => manager.subscribe(fn), [manager]),
    // `labels` builds a new object each call: cache by the values it holds.
    useMemo(() => {
      let last: UndoState | null = null;
      return () => {
        const next = manager.labels;
        if (last && JSON.stringify(last) === JSON.stringify(next)) return last;
        last = next;
        return next;
      };
    }, [manager]),
  );

  const undo = useCallback(async () => {
    try {
      await manager.undo();
    } catch (e) {
      toast.error(e);
    }
  }, [manager, toast]);
  const redo = useCallback(async () => {
    try {
      await manager.redo();
    } catch (e) {
      toast.error(e);
    }
  }, [manager, toast]);
  const record = useCallback((entry: Undoable) => manager.record(entry), [manager]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.defaultPrevented) return;
      const key = e.key.toLowerCase();
      const isUndo = key === 'z' && !e.shiftKey;
      const isRedo = (key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey && !e.metaKey);
      if (!isUndo && !isRedo) return;
      if (isTextEntry(e.target) || modalOpen()) return;
      e.preventDefault();
      void (isUndo ? undo() : redo());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const value = useMemo(() => ({ manager, state, record, undo, redo }), [manager, state, record, undo, redo]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

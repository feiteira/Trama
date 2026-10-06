// Memo text saves on the undo stack.
//
// The memo editor saves by itself while the researcher types (a moment after typing stops, on
// blur). Those saves must be on the project's undo stack too: otherwise an earlier entry for
// the same memo (its creation, a colour change) holds a snapshot of the memo *before* the
// typing, and undoing then redoing it writes that stale snapshot back over the text (undo
// "create memo", redo it: the memo returns empty). Recording every autosave would flood the
// stack, so consecutive saves of one memo become one entry, until anything else touches the
// stack (another operation recorded, an undo, a redo).

import type { UndoManager, Undoable } from '../../services/undo';

export class MemoSaveUndo {
  private open: { memoId: string; first: Undoable; last: Undoable } | null = null;
  private recording = false;
  /** Only while watching the stack can it know nothing else was recorded in between. */
  private watching = 0;

  constructor(private readonly manager: UndoManager) {}

  /** Starts watching the stack; returns how to stop (an effect's cleanup). */
  attach(): () => void {
    const off = this.manager.subscribe(() => {
      if (!this.recording) this.open = null;
    });
    this.watching++;
    return () => {
      off();
      this.watching--;
      this.open = null;
    };
  }

  /** Records what one save of `memoId` returned, merged with the previous save when it can be. */
  saved(memoId: string, undo: Undoable): void {
    // A save that changed nothing (noopUndo) holds nothing to undo.
    if (undo.weight === 0) return;
    if (this.open && this.open.memoId === memoId) {
      this.open.last = undo;
      return;
    }
    const held = { memoId, first: undo, last: undo };
    const entry: Undoable = {
      label: undo.label,
      get detail() {
        return held.last.detail;
      },
      get weight() {
        return held.first.weight + (held.last === held.first ? 0 : held.last.weight);
      },
      // The first save's "before" is the text before this run of typing; the last save's
      // "after" is the text as it ended.
      undo: () => held.first.undo(),
      redo: () => held.last.redo(),
    };
    this.recording = true;
    try {
      this.manager.record(entry);
    } finally {
      this.recording = false;
    }
    this.open = this.watching > 0 ? held : null;
  }

  /** Later saves start a new entry. */
  break(): void {
    this.open = null;
  }
}

/**
 * An edit of a document's text in progress. `base` is the text the edit started from, so
 * whether it holds changes does not depend on what the viewer currently shows (on a switch to
 * another document the viewer's text is already the next one's, or empty while it loads).
 */
export interface EditDraft {
  docId: string;
  name: string;
  base: string;
  text: string;
  busy: boolean;
}

export function startDraft(docId: string, name: string, text: string): EditDraft {
  return { docId, name, base: text, text, busy: false };
}

/** True when the draft holds changes not yet saved (and no save of it is running). */
export function isDirty(d: EditDraft | null | undefined): d is EditDraft {
  return !!d && !d.busy && d.text !== d.base;
}

/**
 * Hands out each dirty draft once. Several paths may want to save the same draft when the
 * viewer goes away (the lock saver, then the unmount that follows the lock; a document switch),
 * and saving it twice would record two undo steps or write to a closed project.
 */
export class DraftClaims {
  private claimed: EditDraft | null = null;

  claim(d: EditDraft | null | undefined): EditDraft | null {
    const c = this.claimed;
    // The same edit may come back as a copy (a failed save clears `busy`): compare what it holds.
    if (!isDirty(d) || (c && c.docId === d.docId && c.base === d.base && c.text === d.text)) return null;
    this.claimed = d;
    return d;
  }
}

/**
 * The save of a draft that is running (the Save button, Ctrl+S). Locking or closing the window
 * must wait for it before the project's database closes, and save the draft itself if it failed.
 */
export class SaveInFlight {
  private current: { draft: EditDraft; done: Promise<boolean> } | null = null;

  /** Follows `work`, the save of `draft`; returns `work`. */
  track<T>(draft: EditDraft, work: Promise<T>): Promise<T> {
    const entry = {
      draft: { ...draft, busy: false },
      done: work.then(
        () => true,
        () => false,
      ),
    };
    this.current = entry;
    void entry.done.then(() => {
      if (this.current === entry) this.current = null;
    });
    return work;
  }

  /** Waits for the running save, if any. Resolves to its draft when it failed (still unsaved), else null. */
  async settle(): Promise<EditDraft | null> {
    const c = this.current;
    if (!c) return null;
    return (await c.done) ? null : c.draft;
  }
}

/** True when a save failed only because the project closed under it (locked, window closing). */
export function closedUnder(e: unknown, projectOpen: boolean): boolean {
  if (!projectOpen) return true;
  const code = (e as { code?: unknown } | null)?.code;
  return code === 'LOCKED' || code === 'NOT_OPEN' || code === 'DB_NOT_OPEN';
}

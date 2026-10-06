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
    if (!isDirty(d) || d === this.claimed) return null;
    this.claimed = d;
    return d;
  }
}

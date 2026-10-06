import type { Coder, Draft, LogAction, MediaRef } from '../core/model/types';
import type { Store } from '../core/store/store';

/**
 * What domain services need from an open project. `Project` (services/project.ts) implements
 * it; tests build one over an in-memory store (see services/testing.ts).
 */
export interface ProjectContext {
  readonly id: string;
  readonly store: Store;
  /** The coder working on this computer. */
  readonly me: Coder;
  /** Encrypts and stores a file (an original document, a recording); returns its reference. */
  addBlob(bytes: Uint8Array, filename: string, mime: string): Promise<MediaRef>;
  readBlob(ref: MediaRef): Promise<Uint8Array>;
  removeBlob(ref: MediaRef): Promise<void>;
  /**
   * Re-reads the cached `me` after its record changed (a rename, a new colour, an undo of
   * either). Optional: test contexts read `me` from the store each time.
   */
  reloadMe?(): Promise<void>;
  /** Appends an entry to the audit trail. */
  log(action: LogAction, summary: string, target?: { kind: string; id: string }): Promise<void>;
  /**
   * The audit-trail record `log` would write, for an operation to write it in the same
   * transaction as its changes. Optional: without it, entries are written after.
   */
  logRecord?(action: LogAction, summary: string, target?: { kind: string; id: string }): Draft<'log'>;
}

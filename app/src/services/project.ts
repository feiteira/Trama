import { toHex, wipe } from '../core/bytes';
import { open, openFrame, seal, sealFrame } from '../core/crypto/frames';
import { type Keyring, subkey } from '../core/crypto/keyring';
import { uuid } from '../core/ids';
import type { Coder, Draft, LogAction, MediaRef } from '../core/model/types';
import { LIMITS, PALETTE } from '../core/model/types';
import type { Store } from '../core/store/store';
import { type Platform, PlatformError } from '../platform/types';
import type { ProjectContext } from './context';

/** One entry of the library's project list (library.json). */
export interface ProjectInfo {
  id: string;
  name: string;
  description: string;
  color: string;
  created_at: string;
  /** null until the project is first opened on this computer. */
  opened_at: string | null;
  /**
   * The project was found on disk but not in the list (the list was lost or damaged). Its name
   * is a placeholder until it is opened, when the name saved inside the project is adopted.
   */
  recovered?: boolean;
}

/** Copies of the library's keys, for work that must outlive a lock (backups). Call `wipe()`. */
export interface LibraryKeys {
  libraryKey: Uint8Array;
  keyring: Keyring;
  wipe(): void;
}

/** What a project needs from its library. */
export interface KeySource {
  copyKeys(): LibraryKeys;
}

/** Key copies one backup needs, plus a blob reader that keeps working after a lock. */
export interface ProjectKeyCopy extends LibraryKeys {
  readBlob(ref: Pick<MediaRef, 'blob_id'>): Promise<Uint8Array>;
}

/** The coder `me` points at is missing on this computer (a teammate's copy, a restore). */
export class NeedsCoderError extends Error {
  constructor() {
    super('choose who codes on this computer first (project.needsCoder)');
  }
}

/** Meta key: the id of the project this one is a restored copy of (see `Project.copyId`). */
export const LINEAGE_META = 'project.lineage';

/** Blob ids become file names: the desktop shell accepts these and nothing else. */
export const BLOB_ID = /^[a-z0-9][a-z0-9._-]*$/;

/** ISO 8601 UTC without milliseconds, as log entries carry it: 2026-10-05T12:00:00Z. */
export const isoSeconds = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** The raw SQLCipher key of a project. */
export function projectKeyOf(libraryKey: Uint8Array, projectId: string): Uint8Array {
  return subkey(libraryKey, 'trama.project.v1', new TextEncoder().encode(projectId));
}

/** The tag in this project's backup file names: the first six hex digits of a subkey. */
export function backupTagOf(projectKey: Uint8Array): string {
  const k = subkey(projectKey, 'trama.backup.tag');
  const tag = toHex(k).slice(0, 6);
  wipe(k);
  return tag;
}

/** True for the error a project's file operations throw once it has closed (Trama locked). */
export function isLocked(e: unknown): boolean {
  return e instanceof PlatformError && e.code === 'LOCKED';
}

const blobContext = (blobId: string) => `blob:${blobId}`;

export interface ProjectParts {
  platform: Platform;
  id: string;
  store: Store;
  /** Taken over by the project, which wipes it on close. */
  projectKey: Uint8Array;
  keys: KeySource;
  info: () => ProjectInfo;
  now?: () => Date;
  onClose?: (project: Project) => void;
}

/**
 * An open project: its store, its file key while open, and who codes on this computer. Opened
 * and created by `Library`; domain services see it as a `ProjectContext`.
 */
export class Project implements ProjectContext {
  readonly platform: Platform;
  readonly id: string;
  readonly store: Store;
  /**
   * Six hex digits that name this project's backup files, so projects (and computers) sharing
   * one backup folder never prune each other's.
   */
  readonly backupTag: string;
  private projectKey: Uint8Array;
  private fileKey: Uint8Array;
  private readonly keys: KeySource;
  private readonly infoOf: () => ProjectInfo;
  private readonly now: () => Date;
  private readonly onClose?: (project: Project) => void;
  private closed = false;
  private meCoder: Coder | null = null;
  private lineage: string | null = null;

  private constructor(parts: ProjectParts) {
    this.platform = parts.platform;
    this.id = parts.id;
    this.store = parts.store;
    this.projectKey = parts.projectKey;
    this.fileKey = subkey(parts.projectKey, 'trama.files.v1');
    this.backupTag = backupTagOf(parts.projectKey);
    this.keys = parts.keys;
    this.infoOf = parts.info;
    this.now = parts.now ?? (() => new Date());
    this.onClose = parts.onClose;
  }

  /** Wraps an opened store and reads who `me` is (meta `me`). */
  static async attach(parts: ProjectParts): Promise<Project> {
    const project = new Project(parts);
    const meId = await parts.store.getMeta('me');
    const coder = meId ? await parts.store.get('coder', meId) : null;
    project.meCoder = coder && !coder.deleted ? coder : null;
    project.lineage = await parts.store.getMeta(LINEAGE_META);
    return project;
  }

  /**
   * The project id copies of this project carry, and that a teammate's copy must carry to be
   * merged here: its own id, or, for a backup restored while the original was still in the
   * library (it got a new id), the original's, so the team can go on exchanging copies.
   */
  get copyId(): string {
    return this.lineage ?? this.id;
  }

  get info(): ProjectInfo {
    return this.infoOf();
  }

  /** The coder working on this computer. Throws NeedsCoderError while `needsCoder`. */
  get me(): Coder {
    if (!this.meCoder) throw new NeedsCoderError();
    return this.meCoder;
  }

  /** True until `setMe` names a coder: the screens ask "who are you?" first. */
  get needsCoder(): boolean {
    return this.meCoder === null;
  }

  /** False once `close()` has started: the store is closing and the keys are wiped. */
  get isOpen(): boolean {
    return !this.closed;
  }

  // ── Coders ─────────────────────────────────────────────────────────────────────────────

  /** Live coders, by name. */
  async coders(): Promise<Coder[]> {
    const list = await this.store.list('coder');
    return list.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  /** A new coder, coloured from the palette unless a colour is given. */
  async addCoder(name: string, color?: string): Promise<Coder> {
    const count = await this.store.count('coder');
    return this.store.put('coder', { name, color: color ?? PALETTE[count % PALETTE.length]! });
  }

  /** Says who codes on this computer (device-local: store meta `me`, never exported). */
  async setMe(coderId: string): Promise<Coder> {
    const coder = await this.store.get('coder', coderId);
    if (!coder || coder.deleted) throw new Error(`coder ${coderId} not found`);
    await this.store.setMeta('me', coder.id);
    this.meCoder = coder;
    return coder;
  }

  /** Refreshes the cached `me` after its record changed (a rename, a merge). */
  async reloadMe(): Promise<void> {
    if (!this.meCoder) return;
    const coder = await this.store.get('coder', this.meCoder.id);
    this.meCoder = coder && !coder.deleted ? coder : null;
  }

  // ── Audit trail ────────────────────────────────────────────────────────────────────────

  async log(action: LogAction, summary: string, target?: { kind: string; id: string }): Promise<void> {
    await this.store.put('log', this.logRecord(action, summary, target));
  }

  logRecord(action: LogAction, summary: string, target?: { kind: string; id: string }): Draft<'log'> {
    return {
      at: isoSeconds(this.now()),
      coder_id: this.meCoder?.id ?? null,
      action,
      summary,
      target_kind: target?.kind ?? null,
      target_id: target?.id ?? null,
    };
  }

  // ── Files ──────────────────────────────────────────────────────────────────────────────

  // Closing wipes the file key in place. Each use of it checks first, with no await between
  // the check and the use, so nothing is ever sealed or opened with a wiped key: once the
  // project closes, these throw PlatformError('LOCKED') instead (see `isLocked`).

  private ensureOpen(): void {
    if (this.closed) throw new PlatformError('LOCKED', 'the project is closed');
  }

  private sealBlob(blobId: string, bytes: Uint8Array): Uint8Array {
    this.ensureOpen();
    return seal(this.fileKey, bytes, blobContext(blobId));
  }

  /** Seals one frame of a blob written piece by piece (a recording, see services/recording). */
  sealBlobFrame(blobId: string, chunk: Uint8Array, index: number, last: boolean): Uint8Array {
    this.ensureOpen();
    return sealFrame(this.fileKey, chunk, blobContext(blobId), index, last);
  }

  /** Opens one frame of a blob (recovering a recording a crash cut short). */
  openBlobFrame(blobId: string, frame: Uint8Array, index: number, last: boolean): Uint8Array {
    this.ensureOpen();
    return openFrame(this.fileKey, frame, blobContext(blobId), index, last);
  }

  async addBlob(bytes: Uint8Array, filename: string, mime: string): Promise<MediaRef> {
    if (bytes.length > LIMITS.mediaMaxBytes) throw new Error('file too large');
    const blob_id = uuid();
    try {
      await this.platform.blobs.write(this.id, blob_id, this.sealBlob(blob_id, bytes));
    } catch (e) {
      // A write cut short (a full disk) may have left part of a file: nothing points at it.
      await this.platform.blobs.remove(this.id, blob_id).catch(() => undefined);
      throw e;
    }
    return { blob_id, filename, mime, size: bytes.length };
  }

  /**
   * Stores the bytes of a blob that already has an id (an import, a teammate's copy, a
   * restore), so the records pointing at it stay valid.
   */
  async restoreBlob(blobId: string, bytes: Uint8Array): Promise<void> {
    if (!BLOB_ID.test(blobId)) throw new Error(`invalid blob id: ${blobId}`);
    try {
      await this.platform.blobs.write(this.id, blobId, this.sealBlob(blobId, bytes));
    } catch (e) {
      await this.platform.blobs.remove(this.id, blobId).catch(() => undefined);
      throw e;
    }
  }

  async readBlob(ref: Pick<MediaRef, 'blob_id'>): Promise<Uint8Array> {
    this.ensureOpen();
    const sealed = await this.platform.blobs.read(this.id, ref.blob_id);
    this.ensureOpen();
    return open(this.fileKey, sealed, blobContext(ref.blob_id));
  }

  /** True when the blob is stored here and opens (it is authenticated, so it is intact). */
  async hasBlob(blobId: string): Promise<boolean> {
    try {
      await this.readBlob({ blob_id: blobId });
      return true;
    } catch (e) {
      if (isLocked(e)) throw e;
      return false;
    }
  }

  /**
   * Removes a stored file. Needs no key, so it works after the project closed too: a batch of
   * files stored by an import that a lock then stopped is removed again (see `createDocuments`).
   */
  async removeBlob(ref: Pick<MediaRef, 'blob_id'>): Promise<void> {
    if (!BLOB_ID.test(ref.blob_id)) throw new Error(`invalid blob id: ${ref.blob_id}`);
    try {
      await this.platform.blobs.remove(this.id, ref.blob_id);
    } catch (e) {
      // Already gone is what was asked for.
      if (!(e instanceof PlatformError && e.code === 'NOT_FOUND')) throw e;
    }
  }

  // ── Keys and closing ───────────────────────────────────────────────────────────────────

  /** Copies of the keys, for work that must outlive a lock that starts meanwhile (a backup). */
  copyKeys(): ProjectKeyCopy {
    this.ensureOpen();
    const lib = this.keys.copyKeys();
    const fileKey = this.fileKey.slice();
    const { platform, id } = this;
    return {
      libraryKey: lib.libraryKey,
      keyring: lib.keyring,
      readBlob: async (ref) => open(fileKey, await platform.blobs.read(id, ref.blob_id), blobContext(ref.blob_id)),
      wipe: () => {
        lib.wipe();
        wipe(fileKey);
      },
    };
  }

  /** Closes the database and forgets the keys. Safe to call more than once. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.store.close();
    } finally {
      wipe(this.projectKey);
      wipe(this.fileKey);
      this.onClose?.(this);
    }
  }
}

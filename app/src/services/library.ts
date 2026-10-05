import { gcm } from '@noble/ciphers/aes.js';
import { fromBase64, fromUtf8, randomBytes, toBase64, utf8, wipe } from '../core/bytes';
import type { KdfParams } from '../core/crypto/kdf';
import {
  createKeyring, isValidRecoveryPhrase, type Keyring, newLibraryKey, parseKeyring, replaceSlot, type SlotKind, subkey,
  unlockKeyring,
} from '../core/crypto/keyring';
import type { BundleRecord, ProjectBundle } from '../core/export/bundle';
import { parseHlc } from '../core/hlc';
import { uuid } from '../core/ids';
import type { Document, Draft, Entity, Kind, MediaRef } from '../core/model/types';
import { HEX_COLOR, KINDS, LIMITS, PALETTE, SETTING_KEYS } from '../core/model/types';
import { validate } from '../core/model/validate';
import type { Db, SqlParam } from '../core/store/db';
import { TABLES } from '../core/store/schema';
import { Store } from '../core/store/store';
import { type Platform, PlatformError } from '../platform/types';
import { BLOB_ID, type LibraryKeys, Project, type ProjectInfo, projectKeyOf } from './project';

export type { ProjectInfo } from './project';

// The library: the keyring (the library key wrapped by passphrase and recovery phrase), the
// encrypted project list (library.json) and the one project open at a time. Every project's
// database key is derived from the library key, so one passphrase opens them all, and the
// library key never changes: a new passphrase rewraps one slot of the keyring.

export type LibraryState = 'none' | 'ready' | 'noKeyring';

export type LibraryErrorCode =
  /** A library (or leftovers of one) is already on this computer / a project with that id exists. */
  | 'EXISTS'
  /** No keyring on this computer. */
  | 'NO_LIBRARY'
  | 'NOT_FOUND'
  /** The library is locked: its keys are gone. */
  | 'LOCKED'
  | 'INVALID';

export class LibraryError extends Error {
  constructor(
    readonly code: LibraryErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface LibraryOptions {
  /** Argon2id parameters for new keyring slots (tests use fast ones). */
  params?: KdfParams;
  now?: () => Date;
}

export interface NewProject {
  name: string;
  description?: string;
  color?: string;
  /** The first coder: the person creating the project. */
  coderName: string;
}

export interface ImportOptions {
  /** Defaults to the bundle's name. */
  name?: string;
  /**
   * Keep the bundle's project id: the new project is a copy of the same project (a teammate's
   * copy, a restore), so it can later be merged with the other copies.
   */
  keepId?: boolean;
  /** Creates this coder and makes them `me`. Without it (or `me`) the project `needsCoder`. */
  coderName?: string;
  /** An existing coder of the bundle to make `me` (a restore knows who made the backup). */
  me?: string | null;
  color?: string;
}

// ── library.json ───────────────────────────────────────────────────────────────────────

interface LibraryFile {
  format: 'trama-library';
  v: 1;
  nonce: string;
  ct: string;
}

interface Registry {
  projects: ProjectInfo[];
}

const LIBRARY_AAD = utf8('trama.library.v1');
const registryKeyOf = (libraryKey: Uint8Array) => subkey(libraryKey, 'trama.library.v1');

function sealRegistry(key: Uint8Array, registry: Registry): string {
  const nonce = randomBytes(12);
  const ct = gcm(key, nonce, LIBRARY_AAD).encrypt(utf8(JSON.stringify(registry)));
  const file: LibraryFile = { format: 'trama-library', v: 1, nonce: toBase64(nonce), ct: toBase64(ct) };
  return JSON.stringify(file);
}

function openRegistry(key: Uint8Array, text: string): Registry {
  const file = JSON.parse(text) as LibraryFile;
  if (file.format !== 'trama-library' || file.v !== 1) throw new Error('not a Trama library file');
  const registry = JSON.parse(fromUtf8(gcm(key, fromBase64(file.nonce), LIBRARY_AAD).decrypt(fromBase64(file.ct)))) as Registry;
  if (!Array.isArray(registry.projects)) throw new Error('library file without projects');
  return {
    projects: registry.projects.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string').map((p) => ({
      id: p.id,
      name: p.name,
      description: typeof p.description === 'string' ? p.description : '',
      color: typeof p.color === 'string' && HEX_COLOR.test(p.color) ? p.color : PALETTE[0],
      created_at: typeof p.created_at === 'string' ? p.created_at : new Date(0).toISOString(),
      opened_at: typeof p.opened_at === 'string' ? p.opened_at : null,
      ...(p.recovered ? { recovered: true } : {}),
    })),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────────────

function cleanName(v: string | undefined, field: string): string {
  const s = (v ?? '').replace(/\s+/g, ' ').trim();
  if (!s || s.length > LIMITS.nameMax) throw new LibraryError('INVALID', `${field}: required, up to ${LIMITS.nameMax} characters`);
  return s;
}

function cleanColor(v: string | undefined, fallback: string): string {
  if (v === undefined) return fallback;
  const c = v.toLowerCase();
  if (!HEX_COLOR.test(c)) throw new LibraryError('INVALID', 'color: #rrggbb');
  return c;
}

function settingWrites(pairs: [string, string][]): { kind: Kind; draft: Draft<Kind> }[] {
  return pairs.map(([id, value]) => ({ kind: 'setting', draft: { id, value } as Draft<'setting'> }));
}

/** A new project's database: the project id is written first, so the store takes it over. */
async function initProjectDb(db: Db, id: string, now: Date): Promise<void> {
  await db.script('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  const sql = 'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value';
  await db.batch([
    { sql, params: ['project_id', id] },
    { sql, params: ['created_at', now.toISOString()] },
  ]);
}

/**
 * Checks records that came from a file before they are stored: base fields present and a valid
 * write stamp; live records pass the same validation as any write (and are tidied by it);
 * deleted ones need only what the database indexes. Records that fail are left out and counted.
 * The `content_omitted` marker of an export (see services/datafile.ts) is dropped here: the
 * record is stored as it came, deleted and scrubbed.
 */
export function sanitizeRecords(records: readonly BundleRecord[]): { records: BundleRecord[]; rejected: number } {
  const out = new Map<string, BundleRecord>();
  let rejected = 0;
  for (const { kind, record } of records) {
    if (!KINDS.includes(kind)) {
      rejected++;
      continue;
    }
    const r = record as Entity<Kind> & { content_omitted?: boolean };
    const baseOk =
      typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 200 && typeof r.created_at === 'string' &&
      typeof r.deleted === 'boolean' && typeof r.updated_at_hlc === 'string';
    if (!baseOk) {
      rejected++;
      continue;
    }
    try {
      parseHlc(r.updated_at_hlc);
    } catch {
      rejected++;
      continue;
    }
    const { content_omitted: _o, ...rest } = r;
    let clean = rest as Entity<Kind>;
    try {
      const { id, created_at, updated_at_hlc, deleted, ...draft } = clean;
      const tidy = validate(kind, { ...draft, id } as never) as object;
      clean = { ...clean, ...tidy, id, created_at, updated_at_hlc, deleted } as Entity<Kind>;
    } catch {
      if (!clean.deleted || !indexable(kind, clean)) {
        rejected++;
        continue;
      }
    }
    const key = `${kind}\u0000${clean.id}`;
    const prev = out.get(key);
    if (!prev || prev.record.updated_at_hlc < clean.updated_at_hlc) out.set(key, { kind, record: clean } as BundleRecord);
  }
  return { records: [...out.values()], rejected };
}

/** True when every indexed column of the record can be computed (a tombstone of an odd shape). */
function indexable(kind: Kind, record: Entity<Kind>): boolean {
  const spec = TABLES[kind] as unknown as { columns: Record<string, { from: (r: Entity<Kind>) => SqlParam | undefined }> };
  try {
    return Object.values(spec.columns).every((c) => {
      const v = c.from(record);
      return v === null || typeof v === 'string' || typeof v === 'number';
    });
  } catch {
    return false;
  }
}

/**
 * Blob ids become file names. One from another program that does not fit gets a new id, and
 * the documents pointing at it follow; blobs no record points at are left out.
 */
function prepareBlobs(records: BundleRecord[], blobs: Map<string, Uint8Array>): { records: BundleRecord[]; blobs: Map<string, Uint8Array> } {
  const rename = new Map<string, string>();
  const referenced = new Set<string>();
  for (const { kind, record } of records) {
    if (kind !== 'document') continue;
    for (const ref of [record.original, record.media]) {
      if (!ref) continue;
      referenced.add(ref.blob_id);
      if (!BLOB_ID.test(ref.blob_id) && !rename.has(ref.blob_id)) rename.set(ref.blob_id, uuid());
    }
  }
  const outBlobs = new Map<string, Uint8Array>();
  for (const [id, bytes] of blobs) {
    if (referenced.has(id)) outBlobs.set(rename.get(id) ?? id, bytes);
  }
  if (!rename.size) return { records, blobs: outBlobs };
  const fix = (ref: MediaRef | null) => (ref && rename.has(ref.blob_id) ? { ...ref, blob_id: rename.get(ref.blob_id)! } : ref);
  return {
    records: records.map((r) => {
      if (r.kind !== 'document') return r;
      const d = r.record as Document;
      return { kind: 'document', record: { ...d, original: fix(d.original), media: fix(d.media) } };
    }),
    blobs: outBlobs,
  };
}

// ── The library ────────────────────────────────────────────────────────────────────────

export class Library {
  /** Unlocked with the recovery phrase: the screens make the researcher choose a new passphrase. */
  mustChangePassphrase = false;
  /**
   * library.json was there but could not be read: projects are listed from disk with
   * placeholder names, and the file is only rewritten by the next change to the list.
   */
  registryDamaged = false;

  private list: ProjectInfo[];
  private openProject_: Project | null = null;
  private closed = false;
  private lockPromise: Promise<void> | null = null;
  private registryKey: Uint8Array;
  private readonly now: () => Date;
  private readonly params?: KdfParams;
  /** One project operation at a time (open, create, import, delete): one database is open. */
  private opQueue: Promise<unknown> = Promise.resolve();
  /** Writes of library.json, in order. Each one is sealed when it is asked for. */
  private saveQueue: Promise<void> = Promise.resolve();
  /** The secret change running now, if any: the next one waits for it (see `changeSecret`). */
  private secretQueue: Promise<void> = Promise.resolve();

  private constructor(
    readonly platform: Platform,
    private key: Uint8Array,
    private keyring: Keyring,
    projects: ProjectInfo[],
    opts: LibraryOptions,
  ) {
    this.list = projects;
    this.registryKey = registryKeyOf(key);
    this.now = opts.now ?? (() => new Date());
    this.params = opts.params;
  }

  /**
   * What is on this computer: no library, one that can be unlocked, or projects / a project
   * list without the keyring (a first setup cut short, or a keyring file lost). Without the
   * keyring nothing can open them; Trama never removes them on its own: the screen says what
   * happened and the researcher chooses to remove them (`platform.eraseAll()`).
   */
  static async state(platform: Platform): Promise<LibraryState> {
    try {
      if ((await platform.keyring.read()) !== null) return 'ready';
    } catch (e) {
      // The keyring could not be read: Unlock says what is wrong.
      console.error('checking the library on this computer failed', e);
      return 'ready';
    }
    const [file, projects] = await Promise.all([
      platform.libraryFile.read().catch(() => null),
      platform.projects.list().catch(() => [] as string[]),
    ]);
    return file !== null || projects.length > 0 ? 'noKeyring' : 'none';
  }

  /**
   * First run: a new library key, protected by the passphrase and the recovery phrase. The
   * empty project list is written first and the keyring last, so a setup cut short leaves no
   * keyring for something half made. If anything fails, what was written is removed again.
   */
  static async create(platform: Platform, secrets: { passphrase: string; recoveryPhrase: string }, opts: LibraryOptions = {}): Promise<Library> {
    if (!secrets.passphrase) throw new LibraryError('INVALID', 'passphrase required');
    if (!isValidRecoveryPhrase(secrets.recoveryPhrase)) throw new LibraryError('INVALID', 'not a valid recovery phrase');
    if ((await Library.state(platform)) !== 'none') throw new LibraryError('EXISTS', 'a library already exists on this computer');
    const key = newLibraryKey();
    const now = opts.now ?? (() => new Date());
    let keyring: Keyring;
    try {
      keyring = await createKeyring(key, secrets, platform.kdf, { params: opts.params, now: now() });
      const registryKey = registryKeyOf(key);
      try {
        await platform.libraryFile.write(sealRegistry(registryKey, { projects: [] }));
      } finally {
        wipe(registryKey);
      }
      await platform.keyring.write(JSON.stringify(keyring, null, 2));
    } catch (e) {
      wipe(key);
      // Nothing was here before (state 'none'), so nothing else can be lost.
      await platform.eraseAll().catch((err: unknown) => console.error('removing a library that was not set up failed', err));
      throw e;
    }
    return new Library(platform, key, keyring, [], opts);
  }

  /** Throws WrongSecretError for a wrong passphrase or recovery phrase. */
  static async unlock(platform: Platform, slot: SlotKind, secret: string, opts: LibraryOptions = {}): Promise<Library> {
    const raw = await platform.keyring.read();
    if (raw === null) throw new LibraryError('NO_LIBRARY', 'no library on this computer');
    const keyring = parseKeyring(raw);
    const key = await unlockKeyring(keyring, slot, secret, platform.kdf);
    const library = new Library(platform, key, keyring, [], opts);
    library.mustChangePassphrase = slot === 'recovery_phrase';
    try {
      const text = await platform.libraryFile.read();
      if (text !== null) {
        try {
          library.list = openRegistry(library.registryKey, text).projects;
        } catch (e) {
          console.error('the project list could not be read', e);
          library.registryDamaged = true;
        }
      }
      await library.reconcile();
    } catch (e) {
      await library.lock();
      throw e;
    }
    return library;
  }

  /**
   * Makes the list match the disk: a project folder missing from the list (the list was lost,
   * or a crash came between creating a project and saving the list) is listed under a
   * placeholder name, so data is never invisible; an entry whose folder is gone is dropped.
   */
  private async reconcile(): Promise<void> {
    let onDisk: string[];
    try {
      onDisk = await this.platform.projects.list();
    } catch (e) {
      console.error('listing the projects on disk failed', e);
      return;
    }
    const present = new Set(onDisk);
    const known = new Set(this.list.map((p) => p.id));
    const kept = this.list.filter((p) => present.has(p.id));
    const recovered = onDisk.filter((id) => !known.has(id)).map((id): ProjectInfo => ({
      id,
      name: `Recovered project ${id.slice(0, 8)}`,
      description: '',
      color: '#7a7f87', // the palette's grey: a placeholder until opened
      created_at: this.now().toISOString(),
      opened_at: null,
      recovered: true,
    }));
    if (kept.length === this.list.length && !recovered.length) return;
    this.list = [...kept, ...recovered];
    if (!this.registryDamaged) await this.saveRegistry();
  }

  // ── State ──────────────────────────────────────────────────────────────────────────────

  /** False once `lock()` has started. */
  get isOpen(): boolean {
    return !this.closed;
  }

  /** The projects in this library (copies). */
  get projects(): ProjectInfo[] {
    return this.list.map((p) => ({ ...p }));
  }

  /** The open project, if any. */
  get current(): Project | null {
    return this.openProject_?.isOpen ? this.openProject_ : null;
  }

  get currentKeyring(): Keyring {
    return this.keyring;
  }

  private ensureOpen(): void {
    if (this.closed) throw new LibraryError('LOCKED', 'the library is locked');
  }

  private info(id: string): ProjectInfo | undefined {
    return this.list.find((p) => p.id === id);
  }

  /** Copies of the keys, for work that must outlive a lock that starts meanwhile (a backup). */
  copyKeys(): LibraryKeys {
    this.ensureOpen();
    const libraryKey = this.key.slice();
    const keyring = JSON.parse(JSON.stringify(this.keyring)) as Keyring;
    return { libraryKey, keyring, wipe: () => wipe(libraryKey) };
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.opQueue.then(fn, fn);
    this.opQueue = p.catch(() => undefined);
    return p;
  }

  /** Seals the list now (with the keys still here) and writes it after earlier writes. */
  private saveRegistry(): Promise<void> {
    this.ensureOpen();
    const text = sealRegistry(this.registryKey, { projects: this.list });
    const p = this.saveQueue.then(() => this.platform.libraryFile.write(text));
    this.saveQueue = p.then(
      () => void (this.registryDamaged = false),
      () => undefined,
    );
    return p;
  }

  private async closeCurrent(): Promise<void> {
    const p = this.openProject_;
    this.openProject_ = null;
    if (p) await p.close();
  }

  /** Opens a project database with a key derived now, while the library key is known to be intact. */
  private async openStore(id: string, create: boolean, init?: (db: Db) => Promise<void>): Promise<{ store: Store; key: Uint8Array }> {
    this.ensureOpen();
    const key = projectKeyOf(this.key, id);
    let db: Db | null = null;
    try {
      db = await this.platform.projects.open(id, key, create);
      if (init) await init(db);
      const store = await Store.open(db, { now: this.now });
      if (this.closed) {
        // Locked while the database opened: it must not stay open with nobody holding it.
        await store.close().catch(() => undefined);
        throw new LibraryError('LOCKED', 'the library is locked');
      }
      return { store, key };
    } catch (e) {
      if (db && !(e instanceof LibraryError)) await db.close().catch(() => undefined);
      wipe(key);
      throw e;
    }
  }

  private attach(id: string, store: Store, key: Uint8Array): Promise<Project> {
    return Project.attach({
      platform: this.platform,
      id,
      store,
      projectKey: key,
      keys: this,
      now: this.now,
      // The list entry, or what it was when the project was removed from the list.
      info: (() => {
        let last = this.info(id)!;
        return () => (last = this.info(id) ?? last);
      })(),
      onClose: (p) => {
        if (this.openProject_ === p) this.openProject_ = null;
      },
    });
  }

  // ── Projects ───────────────────────────────────────────────────────────────────────────

  /** Creates a project with its first coder (who becomes `me`) and opens it. */
  createProject(input: NewProject): Promise<Project> {
    return this.serial(async () => {
      this.ensureOpen();
      const name = cleanName(input.name, 'name');
      const coderName = cleanName(input.coderName, 'coderName');
      const description = (input.description ?? '').trim();
      const color = cleanColor(input.color, PALETTE[this.list.length % PALETTE.length]!);
      await this.closeCurrent();
      const id = uuid();
      const now = this.now();
      const info: ProjectInfo = { id, name, description, color, created_at: now.toISOString(), opened_at: now.toISOString() };
      const { store, key } = await this.openStore(id, true, (db) => initProjectDb(db, id, now));
      this.list.push(info);
      let project: Project | null = null;
      try {
        project = await this.attach(id, store, key);
        const coder = await project.addCoder(coderName);
        await project.setMe(coder.id);
        await store.putMany(settingWrites([[SETTING_KEYS.projectName, name], [SETTING_KEYS.projectDescription, description]]));
        await project.log('project.create', name);
        await this.saveRegistry();
      } catch (e) {
        await this.discard(id, project, store);
        throw e;
      }
      this.openProject_ = project;
      return project;
    });
  }

  /** Undoes a project that was being made: closes it, removes its folder and its list entry. */
  private async discard(id: string, project: Project | null, store: Store): Promise<void> {
    await (project ? project.close() : store.close()).catch(() => undefined);
    await this.platform.projects.erase(id).catch((err: unknown) => console.error('removing a project that was not finished failed', err));
    this.list = this.list.filter((p) => p.id !== id);
  }

  /** Opens a project (closing the one open now). Opening the open one returns it. */
  openProject(id: string): Promise<Project> {
    return this.serial(async () => {
      this.ensureOpen();
      const current = this.current;
      if (current?.id === id) return current;
      const info = this.info(id);
      if (!info) throw new LibraryError('NOT_FOUND', `project ${id} not found`);
      await this.closeCurrent();
      const { store, key } = await this.openStore(id, false);
      let project: Project | null = null;
      try {
        project = await this.attach(id, store, key);
        const patch: Partial<ProjectInfo> = { opened_at: this.now().toISOString() };
        if (info.recovered) {
          // Found on disk without a list entry: take the name saved inside the project.
          const saved = await store.get('setting', SETTING_KEYS.projectName);
          const desc = await store.get('setting', SETTING_KEYS.projectDescription);
          if (saved && !saved.deleted && typeof saved.value === 'string' && saved.value.trim()) {
            patch.name = saved.value.trim().slice(0, LIMITS.nameMax);
            patch.description = desc && !desc.deleted && typeof desc.value === 'string' ? desc.value : '';
          }
        }
        this.list = this.list.map((p) => {
          if (p.id !== id) return p;
          const { recovered: _r, ...rest } = { ...p, ...patch };
          return rest;
        });
        await this.saveRegistry();
      } catch (e) {
        await (project ? project.close() : store.close()).catch(() => undefined);
        wipe(key);
        throw e;
      }
      this.openProject_ = project;
      return project;
    });
  }

  /** Closes the open project, if any (keys of the library stay). */
  closeProject(): Promise<void> {
    return this.serial(() => this.closeCurrent());
  }

  /** Renames, re-describes or recolours a project. The name and description travel inside it too. */
  async updateProject(id: string, patch: Partial<Pick<ProjectInfo, 'name' | 'description' | 'color'>>): Promise<ProjectInfo> {
    this.ensureOpen();
    const info = this.info(id);
    if (!info) throw new LibraryError('NOT_FOUND', `project ${id} not found`);
    const next: ProjectInfo = {
      ...info,
      ...(patch.name !== undefined ? { name: cleanName(patch.name, 'name') } : {}),
      ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
      ...(patch.color !== undefined ? { color: cleanColor(patch.color, info.color) } : {}),
    };
    delete next.recovered;
    this.list = this.list.map((p) => (p.id === id ? next : p));
    await this.saveRegistry();
    const open = this.current;
    if (open?.id === id) {
      const writes: [string, string][] = [];
      if (next.name !== info.name || info.recovered) writes.push([SETTING_KEYS.projectName, next.name]);
      if (next.description !== info.description) writes.push([SETTING_KEYS.projectDescription, next.description]);
      if (writes.length) await open.store.putMany(settingWrites(writes));
    }
    return { ...next };
  }

  /** Removes a project for good: its database and files. */
  deleteProject(id: string): Promise<void> {
    return this.serial(async () => {
      this.ensureOpen();
      if (!this.info(id) && !(await this.platform.projects.exists(id))) throw new LibraryError('NOT_FOUND', `project ${id} not found`);
      if (this.openProject_?.id === id) await this.closeCurrent();
      // The folder goes first: a crash before the list is saved only leaves an entry that the
      // next unlock drops, never a project nobody can see.
      await this.platform.projects.erase(id);
      this.list = this.list.filter((p) => p.id !== id);
      await this.saveRegistry();
    });
  }

  /**
   * Turns a bundle (a .trama file, a REFI-QDA project, a restore) into a new project and opens
   * it. Records keep their ids and write stamps. Anything failing part-way removes the project
   * again: there is never a half-imported project. Records that fail validation are left out
   * and counted in the log entry.
   */
  importBundle(bundle: ProjectBundle, opts: ImportOptions = {}): Promise<Project> {
    return this.serial(async () => {
      this.ensureOpen();
      const keep = !!opts.keepId && !!bundle.project.id;
      const id = keep ? bundle.project.id! : uuid();
      if (!BLOB_ID.test(id)) throw new LibraryError('INVALID', `invalid project id: ${id}`);
      if (this.info(id) || (await this.platform.projects.exists(id))) throw new LibraryError('EXISTS', `project ${id} is already in this library`);
      const fallbackName = `Project ${id.slice(0, 8)}`;
      const name = cleanName(opts.name ?? (bundle.project.name.trim() || fallbackName), 'name');
      const description = (bundle.project.description ?? '').trim();
      const color = cleanColor(opts.color, PALETTE[this.list.length % PALETTE.length]!);
      const coderName = opts.coderName !== undefined ? cleanName(opts.coderName, 'coderName') : null;
      const sane = sanitizeRecords(bundle.records);
      const { records, blobs } = prepareBlobs(sane.records, bundle.blobs);

      await this.closeCurrent();
      const now = this.now();
      const info: ProjectInfo = { id, name, description, color, created_at: now.toISOString(), opened_at: now.toISOString() };
      const { store, key } = await this.openStore(id, true, (db) => initProjectDb(db, id, now));
      this.list.push(info);
      let project: Project | null = null;
      try {
        project = await this.attach(id, store, key);
        await store.merge(records);
        for (const [blobId, bytes] of blobs) {
          this.ensureOpen();
          await project.restoreBlob(blobId, bytes);
        }
        // Written only when the file does not already say so: a copy of the same project keeps
        // the stamps it came with, and merging it back changes nothing.
        const settings: [string, string][] = [];
        const has = (k: string, v: string) => records.some((r) => r.kind === 'setting' && r.record.id === k && !r.record.deleted && r.record.value === v);
        if (!has(SETTING_KEYS.projectName, name)) settings.push([SETTING_KEYS.projectName, name]);
        if (!has(SETTING_KEYS.projectDescription, description)) settings.push([SETTING_KEYS.projectDescription, description]);
        if (settings.length) await store.putMany(settingWrites(settings));
        const meCoder = opts.me ? await store.get('coder', opts.me) : null;
        if (meCoder && !meCoder.deleted) await project.setMe(meCoder.id);
        else if (coderName) await project.setMe((await project.addCoder(coderName)).id);
        const origin = bundle.project.origin ? `${bundle.project.origin}: ` : '';
        await project.log('project.import', `${origin}${records.length} records${sane.rejected ? `, ${sane.rejected} left out` : ''}`);
        await this.saveRegistry();
      } catch (e) {
        await this.discard(id, project, store);
        throw e;
      }
      this.openProject_ = project;
      return project;
    });
  }

  // ── Secrets ────────────────────────────────────────────────────────────────────────────

  /**
   * Rewraps one slot of the keyring for a new passphrase or recovery phrase. It works on a copy
   * of the library key, taken at the call: a lock that lands while the key derivation runs (or
   * while this change waits for another) wipes the library's own key in place, and the new slot
   * must still wrap the real key, never a wiped one. Changes run one after the other, each on
   * the keyring the previous one wrote, so a new passphrase and a new recovery phrase saved
   * close together both end up in it.
   */
  changeSecret(slot: SlotKind, secret: string, opts: { params?: KdfParams } = {}): Promise<void> {
    if (slot === 'recovery_phrase' && !isValidRecoveryPhrase(secret)) return Promise.reject(new LibraryError('INVALID', 'not a valid recovery phrase'));
    if (slot === 'passphrase' && !secret) return Promise.reject(new LibraryError('INVALID', 'passphrase required'));
    return this.rewrap(slot, secret, opts);
  }

  /**
   * A new passphrase, once `current` is checked against the passphrase slot (WrongSecretError
   * if it does not open it). The key is copied before the check, as in `changeSecret`, so a lock
   * that lands while the check runs does not stop a change that has started.
   */
  changePassphrase(current: string, next: string, opts: { params?: KdfParams } = {}): Promise<void> {
    if (!next) return Promise.reject(new LibraryError('INVALID', 'passphrase required'));
    return this.rewrap('passphrase', next, opts, current);
  }

  private rewrap(slot: SlotKind, secret: string, opts: { params?: KdfParams }, current?: string): Promise<void> {
    try {
      this.ensureOpen();
    } catch (e) {
      return Promise.reject(e);
    }
    const key = this.key.slice();
    const params = opts.params ?? this.params;
    const run = async () => {
      try {
        if (current !== undefined) wipe(await unlockKeyring(this.keyring, 'passphrase', current, this.platform.kdf));
        const next = await replaceSlot(this.keyring, slot, secret, key, this.platform.kdf, { params, now: this.now() });
        await this.platform.keyring.write(JSON.stringify(next, null, 2));
        this.keyring = next;
        if (slot === 'passphrase') this.mustChangePassphrase = false;
      } finally {
        wipe(key);
      }
    };
    const p = this.secretQueue.then(run, run);
    this.secretQueue = p.catch(() => undefined);
    return p;
  }

  // ── Locking ────────────────────────────────────────────────────────────────────────────

  /** Closes the open project and forgets the keys. Safe to call more than once. */
  lock(): Promise<void> {
    this.lockPromise ??= (async () => {
      this.closed = true;
      try {
        await this.closeCurrent();
      } catch (e) {
        console.error('closing the project while locking failed', e);
      } finally {
        wipe(this.key);
        wipe(this.registryKey);
      }
      // Writes asked for before the lock were sealed then; let them land.
      await this.saveQueue;
    })();
    return this.lockPromise;
  }
}

/** True for a platform error saying the database key is wrong (a project of another library). */
export function isWrongKey(e: unknown): boolean {
  return e instanceof PlatformError && e.code === 'WRONG_KEY';
}

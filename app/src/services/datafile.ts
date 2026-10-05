import { wipe } from '../core/bytes';
import type { BundleRecord, ProjectBundle } from '../core/export/bundle';
import {
  buildTramaZip, decryptTrama, encryptWithPassword, type Protection, readTramaZip, type TramaBundle, type Unlock,
} from '../core/export/trama';
import type { Keyring } from '../core/crypto/keyring';
import { compareHlc } from '../core/hlc';
import type { Document, Entity, Kind, MediaRef } from '../core/model/types';
import type { Store, Tombstone, TombstoneInfo } from '../core/store/store';
import type { Platform } from '../platform/types';
import { JobStopped, stopper } from './jobs';
import { type Library, sanitizeRecords } from './library';
import { BLOB_ID, isLocked, type Project } from './project';

// .trama files: exporting the open project, opening and importing a file as a new project,
// and merging a teammate's copy of the same project into this one.

export type DataFileErrorCode = 'DIFFERENT_PROJECT';

export class DataFileError extends Error {
  constructor(
    readonly code: DataFileErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * How an export carries a deleted record: only that it was deleted, never its content. Marked
 * `scrubbed` (there is nothing in it to restore) and `content_omitted` (the content still exists
 * where the file came from, so a merge keeps a copy it already has, as deleted).
 */
export interface OmittedInfo extends TombstoneInfo {
  content_omitted?: boolean;
}

/** The record with its content blanked; ids, positions and links stay so it can be indexed. */
function blankContent(kind: Kind, r: Entity<Kind>): Entity<Kind> {
  const x = r as unknown as Record<string, unknown>;
  const blank: Record<Kind, Record<string, unknown>> = {
    coder: { name: '' },
    document: { name: '', source: null, original: null, media: null, chars: 0 },
    doctext: { text: '', sync: [] },
    code: { name: '', description: '', inclusion: '', exclusion: '', example: '' },
    coding: { text: '', comment: '' },
    docgroup: { name: '' },
    attribute: { name: '', options: [], description: '' },
    case: { name: '', description: '', values: {} },
    memo: { title: '', body: '' },
    pseudonym: { original: '', replacement: '', note: '' },
    log: {},
    setting: { value: null },
  };
  return { ...x, ...blank[kind] } as unknown as Entity<Kind>;
}

/** A deleted record as an export writes it. */
export function withoutContent(kind: Kind, r: Entity<Kind>): Entity<Kind> {
  const { deleted_batch } = r as Tombstone<Kind>;
  const info: OmittedInfo = { scrubbed: true, content_omitted: true, ...(deleted_batch ? { deleted_batch } : {}) };
  const { deleted_batch: _b, ...rest } = blankContent(kind, r) as Tombstone<Kind>;
  return { ...rest, ...info, id: r.id, created_at: r.created_at, updated_at_hlc: r.updated_at_hlc, deleted: true } as Entity<Kind>;
}

const mediaRefs = (d: Document): MediaRef[] => [d.original, d.media].filter((m): m is MediaRef => !!m);

export interface BundleOptions {
  /** Deleted records too (as tombstones): a merge needs to know what was deleted. */
  includeDeleted: boolean;
  includePseudonyms: boolean;
  /** Deleted records without their content (exports; backups keep it). */
  omitDeletedContent?: boolean;
  /** Reads a blob; the project's own reader by default (backups pass a copy-key reader). */
  readBlob?: (ref: MediaRef) => Promise<Uint8Array>;
  /** Asked before each file is read; once it says yes, the build throws `JobStopped`. */
  shouldStop?: () => boolean;
}

/**
 * The open project as a bundle. A file that is missing or damaged is left out with a warning;
 * a lock meanwhile stops the build instead (the bundle would lack every file after that point).
 */
export async function projectToBundle(project: Project, opts: BundleOptions): Promise<ProjectBundle> {
  const check = stopper(opts.shouldStop);
  const read = opts.readBlob ?? ((ref: MediaRef) => project.readBlob(ref));
  const records: BundleRecord[] = [];
  for await (const r of project.store.all()) {
    if (r.kind === 'pseudonym' && !opts.includePseudonyms) continue;
    if (r.record.deleted && !opts.includeDeleted) continue;
    const omit = r.record.deleted && opts.omitDeletedContent && !(r.record as Tombstone<Kind>).scrubbed;
    records.push((omit ? { kind: r.kind, record: withoutContent(r.kind, r.record) } : r) as BundleRecord);
  }
  const blobs = new Map<string, Uint8Array>();
  const warnings: string[] = [];
  for (const r of records) {
    if (r.kind !== 'document') continue;
    for (const ref of mediaRefs(r.record)) {
      if (blobs.has(ref.blob_id)) continue;
      check();
      try {
        blobs.set(ref.blob_id, await read(ref));
      } catch (e) {
        if (isLocked(e)) throw new JobStopped();
        check();
        console.error('file left out', ref.blob_id, e);
        warnings.push(`${r.record.name || r.record.id}: ${ref.filename}`);
      }
    }
  }
  const info = project.info;
  return {
    project: { id: project.id, name: info.name, description: info.description, origin: `Trama ${(await project.platform.info()).version}` },
    records,
    blobs,
    warnings,
  };
}

export interface ExportOptions {
  /** Protects the file with this password (Argon2id). */
  password?: string;
  includePseudonyms: boolean;
  now?: Date;
  readme?: string;
  shouldStop?: () => boolean;
}

/**
 * The project as .trama bytes, to save where the researcher chooses or hand to a teammate.
 * Deleted records travel without their content, and the pseudonymisation key only when asked.
 */
export async function exportProjectFile(project: Project, opts: ExportOptions): Promise<Uint8Array> {
  const bundle = await projectToBundle(project, {
    includeDeleted: true,
    includePseudonyms: opts.includePseudonyms,
    omitDeletedContent: true,
    shouldStop: opts.shouldStop,
  });
  const info = await project.platform.info();
  const zip = buildTramaZip(bundle, { appVersion: info.version, includePseudonyms: opts.includePseudonyms, now: opts.now, readme: opts.readme });
  const bytes = opts.password ? await encryptWithPassword(zip, opts.password, project.platform.kdf) : zip;
  stopper(opts.shouldStop)();
  if (!project.isOpen) throw new JobStopped();
  await project.log('export', `.trama${opts.password ? ' (password)' : ''}${opts.includePseudonyms ? ' + pseudonyms' : ''}`);
  return bytes;
}

export interface OpenedFile {
  bundle: TramaBundle;
  protection: Protection;
  /** The keyring a backup carries. */
  keyring?: Keyring;
}

/**
 * Opens a .trama file. Throws NotTramaFileError, UnlockRequiredError (it needs a password or
 * passphrase), DecryptError (wrong password or damaged) or WrongSecretError.
 */
export async function openProjectFile(platform: Platform, bytes: Uint8Array, unlock: Unlock): Promise<OpenedFile> {
  const { zip, protection, keyring, libraryKey } = await decryptTrama(bytes, unlock, platform.kdf);
  // The library key a backup was unwrapped with is not needed past this point.
  if (libraryKey) wipe(libraryKey);
  return { bundle: readTramaZip(zip), protection, ...(keyring ? { keyring } : {}) };
}

export interface ImportFileOptions {
  /** Keep the project id: the file is a copy of a project, to merge with later. */
  asCopyOfSameProject?: boolean;
  name?: string;
  coderName?: string;
}

/** Imports a .trama file as a new project of the library and opens it. */
export async function importProjectFile(library: Library, bytes: Uint8Array, unlock: Unlock, opts: ImportFileOptions = {}): Promise<Project> {
  const { bundle } = await openProjectFile(library.platform, bytes, unlock);
  return library.importBundle(bundle, {
    keepId: !!opts.asCopyOfSameProject,
    ...(opts.name !== undefined ? { name: opts.name } : {}),
    ...(opts.coderName !== undefined ? { coderName: opts.coderName } : {}),
  });
}

/**
 * Readies a file's records for merging, so that a merge never erases what the file left out:
 * a deleted record the file carries without its content keeps the content of the copy here,
 * deleted, so it can still be restored.
 */
async function readyToMerge(store: Store, records: readonly BundleRecord[]): Promise<BundleRecord[]> {
  const out: BundleRecord[] = [];
  for (const r of records) {
    if (!(r.record as OmittedInfo).content_omitted) {
      out.push(r);
      continue;
    }
    const local = (await store.get(r.kind, r.record.id)) as Tombstone<Kind> | null;
    const newer = !local || compareHlc(local.updated_at_hlc, r.record.updated_at_hlc) < 0;
    if (!newer || !local || local.scrubbed) {
      out.push(r);
      continue;
    }
    const incoming = r.record as Tombstone<Kind>;
    const { deleted_batch: _b, ...kept } = local;
    const batch = incoming.deleted_batch ? { deleted_batch: incoming.deleted_batch } : {};
    out.push({ kind: r.kind, record: { ...kept, ...batch, deleted: true, updated_at_hlc: incoming.updated_at_hlc } } as BundleRecord);
  }
  return out;
}

export interface MergeResult {
  /** Records that were not here. */
  added: number;
  /** Records the copy holds a newer version of. */
  updated: number;
  /** Records where this project's version is the same or newer. */
  unchanged: number;
  /** Files stored from the copy. */
  blobs: number;
  /** Records of the copy left out because they were invalid. */
  rejected: number;
}

/**
 * Merges a teammate's copy of this same project: the newer version of each record wins, so
 * both sides can merge each other's copies in any order and end up alike. The teammate's coder
 * and codings arrive as records (that is how agreement between coders can be measured).
 */
export async function mergeTeammateCopy(project: Project, bundle: ProjectBundle, opts: { shouldStop?: () => boolean } = {}): Promise<MergeResult> {
  if (!bundle.project.id || bundle.project.id !== project.id) {
    throw new DataFileError('DIFFERENT_PROJECT', 'this file is a different project');
  }
  const check = stopper(opts.shouldStop);
  check();
  const { store } = project;
  const sane = sanitizeRecords(await readyToMerge(store, bundle.records));
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const { kind, record } of sane.records) {
    const local = await store.get(kind, record.id);
    if (!local) added++;
    else if (compareHlc(local.updated_at_hlc, record.updated_at_hlc) < 0) updated++;
    else unchanged++;
  }
  await store.merge(sane.records);
  // The newest write stamp may not move (a teammate's older work): the next backup is made anyway.
  await store.deleteMeta('backup.last_hlc');

  let blobs = 0;
  const done = new Set<string>();
  for (const r of sane.records) {
    if (r.kind !== 'document') continue;
    for (const ref of mediaRefs(r.record)) {
      const bytes = bundle.blobs.get(ref.blob_id);
      if (!bytes || done.has(ref.blob_id) || !BLOB_ID.test(ref.blob_id)) continue;
      done.add(ref.blob_id);
      check();
      if (await project.hasBlob(ref.blob_id)) continue;
      await project.restoreBlob(ref.blob_id, bytes);
      blobs++;
    }
  }
  await project.reloadMe();
  await project.log('project.merge', `"${bundle.project.name}" +${added} ~${updated} =${unchanged}${sane.rejected ? ` !${sane.rejected}` : ''}`);
  return { added, updated, unchanged, blobs, rejected: sane.rejected };
}

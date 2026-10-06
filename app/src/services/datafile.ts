import { wipe } from '../core/bytes';
import type { BundleRecord, ProjectBundle } from '../core/export/bundle';
import {
  buildTramaZip, decryptTrama, encryptWithPassword, type Protection, readTramaZip, type TramaBundle, type Unlock,
} from '../core/export/trama';
import type { Keyring } from '../core/crypto/keyring';
import { compareHlc } from '../core/hlc';
import type { Document, Entity, Kind, MediaRef } from '../core/model/types';
import { KINDS } from '../core/model/types';
import { TABLES } from '../core/store/schema';
import type { Store, Tombstone, TombstoneInfo } from '../core/store/store';
import type { Platform } from '../platform/types';
import { JobStopped, stopper } from './jobs';
import { type Library, sanitizeRecords } from './library';
import { BLOB_ID, isLocked, type Project } from './project';
import { textSha256 } from './documents';
import { findMatches } from './pseudonyms';
import { mergeTouches, reconcile, textConflicts, type TextConflict } from './reconcile';

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

/**
 * How an export marks a document it left something out of: the original file of a document
 * whose text was edited since import (it would hold the text from before: names replaced by
 * pseudonymisation, say), and a source file name that holds an original of the
 * pseudonymisation key. A merge back keeps what the project it came from still has.
 */
export interface ExportOmitted {
  original_omitted?: boolean;
  filename_omitted?: boolean;
}

/** Spaces for the separators file names use instead ("Maria_Silva-interview.pdf"). */
const fileWords = (name: string) => name.replace(/[_.+-]+/g, ' ');

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
  /**
   * Leaves out the original file (PDF, Word…) of every document whose text no longer matches
   * it (edited after import: typo fixes, pseudonymisation), and source file names holding an
   * original of the pseudonymisation key (exports; backups keep everything).
   */
  omitEditedOriginals?: boolean;
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
  if (opts.omitEditedOriginals) await omitEditedOriginals(project, records);
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

/**
 * Applies `omitEditedOriginals` to bundle records in place: the REFI-QDA export's rule (an
 * original whose text no longer matches the document is left out) for .trama files too.
 */
async function omitEditedOriginals(project: Project, records: BundleRecord[]): Promise<void> {
  const texts = new Map<string, string>();
  for (const r of records) if (r.kind === 'doctext' && !r.record.deleted) texts.set(r.record.id, r.record.text);
  const key = (await project.store.list('pseudonym')).map((p) => ({ ...p, whole_word: false, case_sensitive: false }));
  const named = (filename: string) => !!filename && key.some((p) => findMatches(fileWords(filename), { ...p, original: fileWords(p.original) }).length > 0);
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    if (r.kind !== 'document' || r.record.deleted) continue;
    const d = r.record;
    const text = texts.get(d.id);
    const edited = !!d.original && (!d.source || text === undefined || d.source.text_sha256 !== textSha256(text));
    const leak = !!d.source && named(d.source.filename);
    if (!edited && !leak) continue;
    const out: Document & ExportOmitted = { ...d };
    if (edited) {
      out.original = null;
      out.original_omitted = true;
    }
    if (leak && d.source) {
      out.source = { ...d.source, filename: '' };
      out.filename_omitted = true;
    }
    records[i] = { kind: 'document', record: out };
  }
}

export interface ExportOptions {
  /** Protects the file with this password (Argon2id). */
  password?: string;
  includePseudonyms: boolean;
  /**
   * Keeps the original files (PDF, Word…) of documents edited since import. Off by default: such
   * a file still holds the text from before the edits — names replaced by pseudonymisation too.
   */
  includeEditedOriginals?: boolean;
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
    omitEditedOriginals: !opts.includeEditedOriginals,
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
  const docs = records.filter((r) => r.kind === 'document' && ((r.record as ExportOmitted).original_omitted || (r.record as ExportOmitted).filename_omitted));
  const localDocs = docs.length ? await store.getMany('document', docs.map((r) => r.record.id)) : new Map<string, Document>();
  for (const r of records) {
    const omitted = r.record as Document & ExportOmitted;
    if (r.kind === 'document' && (omitted.original_omitted || omitted.filename_omitted)) {
      // What an export left out of a document is still here: a newer version from the copy keeps it.
      const local = localDocs.get(r.record.id);
      if (local) {
        const kept: Document & ExportOmitted = { ...omitted };
        if (omitted.original_omitted && !omitted.original && local.original) kept.original = local.original;
        if (omitted.filename_omitted && kept.source && local.source) kept.source = { ...kept.source, filename: local.source.filename };
        if (local.original && kept.original === local.original) delete kept.original_omitted;
        if (kept.source?.filename) delete kept.filename_omitted;
        out.push({ kind: 'document', record: kept });
        continue;
      }
    }
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
  /**
   * Documents whose text was changed both here and in the copy: this project's text is kept,
   * the copy's changes to it are not merged (reported so they can be brought over by hand).
   */
  textConflicts: TextConflict[];
  /** Codings moved back onto their words because they were made against another version of the text. */
  reanchored: number;
  /** Codings removed: their words are gone from the merged text, or their code or document is deleted. */
  removedCodings: number;
  /**
   * Documents changed by the merge whose text holds an original of this project's applied
   * pseudonymisation key (a teammate's text from before it was applied, say).
   */
  originalsFound: { documentId: string; name: string }[];
}

export interface KindCounts {
  /** Records that will appear: new here, and not deleted in the copy. */
  added: number;
  /** Records the copy holds a newer version of. */
  updated: number;
}

/** What merging a copy would do, worked out without writing anything (`previewMerge`). */
export interface MergePreview extends Omit<MergeResult, 'blobs' | 'reanchored' | 'removedCodings' | 'originalsFound'> {
  /** The project name the copy carries. */
  projectName: string;
  /** By kind; kinds the copy changes nothing of are left out. */
  byKind: Partial<Record<Kind, KindCounts>>;
  /** Coders the copy brings that this project does not have yet. */
  newCoders: { id: string; name: string; color: string }[];
}

/** Write stamps of the records here (deleted ones too), by kind and id. */
export type LocalStamps = ReadonlyMap<Kind, ReadonlyMap<string, string>>;

/** Reads only ids and stamps (no record data), so a large project is compared quickly. */
export async function localStamps(store: Store): Promise<LocalStamps> {
  const out = new Map<Kind, Map<string, string>>();
  for (const kind of KINDS) {
    const rows = await store.db.query<{ id: string; hlc: string }>(`SELECT id, hlc FROM ${TABLES[kind].table}`);
    out.set(kind, new Map(rows.map((r) => [r.id, r.hlc])));
  }
  return out;
}

/**
 * How records readied for a merge compare with the ones here: the merge rule (the newer
 * version of each record wins) applied to the stamps alone. Pure.
 */
export function classifyMerge(projectName: string, records: readonly BundleRecord[], local: LocalStamps, rejected = 0): MergePreview {
  const byKind: MergePreview['byKind'] = {};
  const newCoders: MergePreview['newCoders'] = [];
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const r of records) {
    const mine = local.get(r.kind)?.get(r.record.id);
    const bucket = (byKind[r.kind] ??= { added: 0, updated: 0 });
    if (mine === undefined) {
      added++;
      // A record that arrives already deleted changes nothing anyone sees.
      if (!r.record.deleted) bucket.added++;
      if (r.kind === 'coder' && !r.record.deleted) newCoders.push({ id: r.record.id, name: r.record.name, color: r.record.color });
    } else if (compareHlc(mine, r.record.updated_at_hlc) < 0) {
      updated++;
      bucket.updated++;
    } else unchanged++;
  }
  for (const k of Object.keys(byKind) as Kind[]) if (!byKind[k]!.added && !byKind[k]!.updated) delete byKind[k];
  return { projectName, added, updated, unchanged, rejected, byKind, newCoders, textConflicts: [] };
}

function checkSameProject(project: Pick<Project, 'id'>, bundle: ProjectBundle): void {
  if (!bundle.project.id || bundle.project.id !== project.id) {
    throw new DataFileError('DIFFERENT_PROJECT', 'this file is a different project');
  }
}

/**
 * A copy's records as a merge would store them: readied (see `readyToMerge`) and checked, less
 * the copy's texts that would overwrite a text changed here too (see `textConflicts`).
 */
async function mergeable(store: Store, bundle: ProjectBundle): Promise<{ records: BundleRecord[]; all: BundleRecord[]; rejected: number; conflicts: TextConflict[] }> {
  const sane = sanitizeRecords(await readyToMerge(store, bundle.records));
  const { conflicts, drop } = await textConflicts(store, sane.records);
  const records = drop.size ? sane.records.filter((r) => !(r.kind === 'doctext' && drop.has(r.record.id))) : sane.records;
  return { records, all: sane.records, rejected: sane.rejected, conflicts };
}

/**
 * What merging a teammate's copy would add and update, without writing anything: the same
 * records, checks and counts as `mergeTeammateCopy`. Throws DataFileError('DIFFERENT_PROJECT')
 * for a copy of another project.
 */
export async function previewMerge(project: Pick<Project, 'id' | 'store'>, bundle: ProjectBundle): Promise<MergePreview> {
  checkSameProject(project, bundle);
  const sane = await mergeable(project.store, bundle);
  return { ...classifyMerge(bundle.project.name, sane.records, await localStamps(project.store), sane.rejected), textConflicts: sane.conflicts };
}

/**
 * Merges a teammate's copy of this same project: the newer version of each record wins, so
 * both sides can merge each other's copies in any order and end up alike. The teammate's coder
 * and codings arrive as records (that is how agreement between coders can be measured).
 */
export async function mergeTeammateCopy(project: Project, bundle: ProjectBundle, opts: { shouldStop?: () => boolean } = {}): Promise<MergeResult> {
  checkSameProject(project, bundle);
  const check = stopper(opts.shouldStop);
  check();
  const { store } = project;
  const sane = await mergeable(store, bundle);
  const { added, updated, unchanged } = classifyMerge(bundle.project.name, sane.records, await localStamps(store), sane.rejected);
  // Read before writing: which texts and codings the merge changes, and the texts as they were.
  const touched = await mergeTouches(store, sane.records);
  // The copy's own text versions help place its codings, also where its text lost.
  for (const r of sane.all) if (r.kind === 'doctext' && !r.record.deleted) touched.theirs.set(r.record.id, r.record.text);
  await store.merge(sane.records);
  const fixed = await reconcile(store, touched);
  const originalsFound = await originalsIn(store, touched.docs, touched.before);
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
  const extra = [
    sane.rejected ? ` !${sane.rejected}` : '',
    sane.conflicts.length ? ` ⚠${sane.conflicts.length}` : '',
    fixed.reanchored ? ` ↦${fixed.reanchored}` : '',
    fixed.removedCodings ? ` −${fixed.removedCodings}` : '',
  ].join('');
  await project.log('project.merge', `"${bundle.project.name}" +${added} ~${updated} =${unchanged}${extra}`);
  return {
    added, updated, unchanged, blobs, rejected: sane.rejected,
    textConflicts: sane.conflicts, reanchored: fixed.reanchored, removedCodings: fixed.removedCodings, originalsFound,
  };
}

/**
 * Documents among `candidates` whose text the merge changed (from `before`) and that now hold an
 * original of an applied pseudonymisation key entry.
 */
async function originalsIn(store: Store, candidates: ReadonlySet<string>, before: ReadonlyMap<string, string>): Promise<{ documentId: string; name: string }[]> {
  const ids = [...candidates].filter((id) => before.has(id));
  if (!ids.length) return [];
  const key = (await store.list('pseudonym')).filter((p) => p.applied_at !== null);
  if (!key.length) return [];
  const texts = await store.getMany('doctext', ids);
  const docs = await store.getMany('document', ids);
  const out: { documentId: string; name: string }[] = [];
  for (const id of ids) {
    const t = texts.get(id);
    const d = docs.get(id);
    if (!t || t.deleted || !d || d.deleted || t.text === before.get(id)) continue;
    if (key.some((p) => findMatches(t.text, p).length > 0)) out.push({ documentId: id, name: d.name });
  }
  return out;
}

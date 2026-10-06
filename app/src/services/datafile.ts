import { wipe } from '../core/bytes';
import type { BundleRecord, ProjectBundle } from '../core/export/bundle';
import {
  buildTramaZip, decryptTrama, encryptWithPassword, type Protection, readTramaZip, type TramaBundle, type Unlock,
} from '../core/export/trama';
import type { Keyring } from '../core/crypto/keyring';
import type { Document, Entity, Kind, MediaRef } from '../core/model/types';
import { KINDS } from '../core/model/types';
import { TABLES } from '../core/store/schema';
import { compareVersions, type Store, type Tombstone, type TombstoneInfo, type Versioned } from '../core/store/store';
import type { Platform } from '../platform/types';
import { JobStopped, stopper } from './jobs';
import { type Library, sanitizeRecords } from './library';
import { BLOB_ID, isLocked, type Project } from './project';
import { textSha256 } from './documents';
import { FILE_MENTIONS, logRedactor, mentionIds, preview, reapplyKey, type ReappliedHit } from './pseudonyms';
import {
  MERGE_PENDING, type MergeTouches, mergeTouches, reconcile, repairImported, textConflicts, type TextConflict, touchesFromJson, touchesToJson,
} from './reconcile';
import type { ProjectContext } from './context';
import { fileNameHolds } from '../core/qda/pseudonymise';

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
  // An export (not a backup): audit-trail entries never name what the key replaced.
  if (opts.omitEditedOriginals || opts.omitDeletedContent) {
    const redact = await logRedactor(project);
    for (let i = 0; i < records.length; i++) {
      const r = records[i]!;
      if (r.kind !== 'log') continue;
      const summary = redact(r.record);
      if (summary !== r.record.summary) records[i] = { kind: 'log', record: { ...r.record, summary } };
    }
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
    project: { id: project.copyId, name: info.name, description: info.description, origin: `Trama ${(await project.platform.info()).version}` },
    records,
    blobs,
    warnings,
  };
}

/**
 * Applies `omitEditedOriginals` to bundle records in place: the REFI-QDA export's rule (an
 * original whose text no longer matches the document is left out) for .trama files too. File
 * names (of the source file, the original and the recording) are blanked when they hold an
 * original of the key, and, once pseudonymisation was applied in this project (an entry applied,
 * or erased since), for every document whose text was edited, and for the documents noted in
 * `FILE_MENTIONS` (a name inside a word that apply left): a name erased from the key can no
 * longer be looked for.
 */
async function omitEditedOriginals(project: Project, records: BundleRecord[]): Promise<void> {
  const texts = new Map<string, string>();
  for (const r of records) if (r.kind === 'doctext' && !r.record.deleted) texts.set(r.record.id, r.record.text);
  const all = (await project.store.list('pseudonym', { includeDeleted: true })) as Tombstone<'pseudonym'>[];
  const key = all.filter((p) => !p.deleted);
  const used = all.some((p) => p.applied_at !== null || p.scrubbed);
  // Documents whose file names held an original apply could not rewrite (noted when it ran).
  const noted = await mentionIds(project, FILE_MENTIONS);
  const named = (filename: string | undefined) => !!filename && fileNameHolds(filename, key);
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    if (r.kind !== 'document' || r.record.deleted) continue;
    const d = r.record;
    const text = texts.get(d.id);
    const textEdited = !d.source || text === undefined || d.source.text_sha256 !== textSha256(text);
    const edited = !!d.original && textEdited;
    const blankNames = (used && textEdited) || noted.has(d.id);
    const leak = {
      source: !!d.source?.filename && (blankNames || named(d.source.filename)),
      original: !edited && !!d.original?.filename && (blankNames || named(d.original.filename)),
      media: !!d.media?.filename && (blankNames || named(d.media.filename)),
    };
    if (!edited && !leak.source && !leak.original && !leak.media) continue;
    const out: Document & ExportOmitted = { ...d };
    if (edited) {
      out.original = null;
      out.original_omitted = true;
    }
    if (leak.source && d.source) out.source = { ...d.source, filename: '' };
    if (leak.original && d.original) out.original = { ...d.original, filename: '' };
    if (leak.media && d.media) out.media = { ...d.media, filename: '' };
    if (leak.source || leak.original || leak.media) out.filename_omitted = true;
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
  /**
   * Writes the audit-trail entry now (default). A caller that saves the bytes itself passes false
   * and calls `logProjectExport` once the file is written, so a failed write is not logged as done.
   */
  log?: boolean;
}

/** The audit-trail entry of a .trama export (see `ExportOptions.log`). */
export async function logProjectExport(project: Project, opts: Pick<ExportOptions, 'password' | 'includePseudonyms'>): Promise<void> {
  await project.log('export', `.trama${opts.password ? ' (password)' : ''}${opts.includePseudonyms ? ' + pseudonyms' : ''}`);
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
  if (opts.log !== false) await logProjectExport(project, opts);
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
        if (omitted.filename_omitted) {
          if (kept.source && !kept.source.filename && local.source) kept.source = { ...kept.source, filename: local.source.filename };
          for (const slot of ['original', 'media'] as const) {
            const ref = kept[slot];
            const mine = local[slot];
            if (ref && !ref.filename && mine && mine.blob_id === ref.blob_id) kept[slot] = { ...ref, filename: mine.filename };
          }
        }
        if (local.original && kept.original === local.original) delete kept.original_omitted;
        if (!(kept.source && !kept.source.filename) && !(kept.original && !kept.original.filename) && !(kept.media && !kept.media.filename)) delete kept.filename_omitted;
        out.push({ kind: 'document', record: kept });
        continue;
      }
    }
    if (!(r.record as OmittedInfo).content_omitted) {
      out.push(r);
      continue;
    }
    const local = (await store.get(r.kind, r.record.id)) as Tombstone<Kind> | null;
    const newer = !local || compareVersions(local as Versioned, r.record as Versioned) < 0;
    if (!newer || !local || local.scrubbed) {
      out.push(r);
      continue;
    }
    const incoming = r.record as Tombstone<Kind>;
    const { deleted_batch: _b, sem: _m, ...kept } = local as Tombstone<Kind> & Versioned;
    const batch = incoming.deleted_batch ? { deleted_batch: incoming.deleted_batch } : {};
    const sem = (incoming as Versioned).sem ? { sem: (incoming as Versioned).sem } : {};
    out.push({ kind: r.kind, record: { ...kept, ...batch, ...sem, deleted: true, updated_at_hlc: incoming.updated_at_hlc } } as BundleRecord);
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
   * Records the merge wrote or brought back that still hold an original of this project's
   * applied pseudonymisation key after it was applied to them again (see `repseudonymised`):
   * normally none.
   */
  originalsFound: { documentId: string; name: string; kind?: string; field?: string }[];
  /**
   * Where the merge brought originals of the applied key back (a teammate's copy from before it
   * was applied: a name, a memo, a text, a deleted document brought back) and they were replaced
   * again, as part of the merge (logged). Never what was replaced.
   */
  repseudonymised: ReappliedHit[];
  /**
   * Documents whose text here was replaced by the copy's, because the teammate already kept
   * their text over this one in a conflict (this project's changes to it did not come in).
   */
  textsReplaced: TextConflict[];
  /**
   * Codes and documents deleted on one side that the merge kept, because there is newer work in
   * them (codings made after the delete, or that the side which deleted never had).
   */
  revived: { kind: 'code' | 'document'; id: string; name: string }[];
}

export interface KindCounts {
  /** Records that will appear: new here, and not deleted in the copy. */
  added: number;
  /** Records the copy holds a newer version of. */
  updated: number;
}

/** What merging a copy would do, worked out without writing anything (`previewMerge`). */
export interface MergePreview extends Omit<MergeResult, 'blobs' | 'reanchored' | 'removedCodings' | 'originalsFound' | 'repseudonymised' | 'revived'> {
  /** The project name the copy carries. */
  projectName: string;
  /** By kind; kinds the copy changes nothing of are left out. */
  byKind: Partial<Record<Kind, KindCounts>>;
  /** Coders the copy brings that this project does not have yet. */
  newCoders: { id: string; name: string; color: string }[];
}

/**
 * Stamps of the records here (deleted ones too), by kind and id: the write stamp and the stamp of
 * the last meaningful change (`Versioned`), or the write stamp alone.
 */
export type LocalStamps = ReadonlyMap<Kind, ReadonlyMap<string, string | Versioned>>;

/** Reads only ids and stamps (no record content), so a large project is compared quickly. */
export async function localStamps(store: Store): Promise<LocalStamps> {
  const out = new Map<Kind, Map<string, Versioned>>();
  for (const kind of KINDS) {
    const rows = await store.db.query<{ id: string; hlc: string; sem: string | null }>(`SELECT id, hlc, json_extract(data, '$.sem') AS sem FROM ${TABLES[kind].table}`);
    out.set(kind, new Map(rows.map((r) => [r.id, { updated_at_hlc: r.hlc, ...(r.sem ? { sem: r.sem } : {}) }])));
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
    } else if (compareVersions(typeof mine === 'string' ? { updated_at_hlc: mine } : mine, r.record as Versioned) < 0) {
      updated++;
      bucket.updated++;
    } else unchanged++;
  }
  for (const k of Object.keys(byKind) as Kind[]) if (!byKind[k]!.added && !byKind[k]!.updated) delete byKind[k];
  return { projectName, added, updated, unchanged, rejected, byKind, newCoders, textConflicts: [], textsReplaced: [] };
}

function checkSameProject(project: Pick<Project, 'id'> & Partial<Pick<Project, 'copyId'>>, bundle: ProjectBundle): void {
  const id = bundle.project.id;
  if (!id || (id !== project.id && id !== project.copyId)) {
    throw new DataFileError('DIFFERENT_PROJECT', 'this file is a different project');
  }
}

/**
 * A copy's records as a merge would store them: readied (see `readyToMerge`) and checked, less
 * the copy's texts that would overwrite a text changed here too (see `textConflicts`).
 */
async function mergeable(store: Store, bundle: ProjectBundle): Promise<{
  records: BundleRecord[];
  all: BundleRecord[];
  rejected: number;
  conflicts: TextConflict[];
  replaced: TextConflict[];
  seen: Map<string, string>;
}> {
  const sane = sanitizeRecords(await readyToMerge(store, bundle.records));
  const { conflicts, drop, seen, replaced } = await textConflicts(store, sane.records);
  const records = drop.size ? sane.records.filter((r) => !(r.kind === 'doctext' && drop.has(r.record.id))) : sane.records;
  return { records, all: sane.records, rejected: sane.rejected, conflicts, replaced, seen };
}

/**
 * What merging a teammate's copy would add and update, without writing anything: the same
 * records, checks and counts as `mergeTeammateCopy`. Throws DataFileError('DIFFERENT_PROJECT')
 * for a copy of another project.
 */
export async function previewMerge(project: Pick<Project, 'id' | 'store'> & Partial<Pick<Project, 'copyId'>>, bundle: ProjectBundle): Promise<MergePreview> {
  checkSameProject(project, bundle);
  const sane = await mergeable(project.store, bundle);
  return {
    ...classifyMerge(bundle.project.name, sane.records, await localStamps(project.store), sane.rejected),
    textConflicts: sane.conflicts,
    textsReplaced: sane.replaced,
  };
}

/**
 * Merges a teammate's copy of this same project: the newer version of each record wins, so
 * both sides can merge each other's copies in any order and end up alike. The teammate's coder
 * and codings arrive as records (that is how agreement between coders can be measured).
 *
 * The records are written first and put back in step after (`reconcile`); a meta key
 * (`MERGE_PENDING`) holds what is needed for that in between, so a merge cut short by a lock or
 * a crash is finished when the project next opens (`finishPendingMerge`).
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
  touched.seen = sane.seen;
  // The copy's own text versions help place its codings, also where its text lost.
  for (const r of sane.all) {
    const id = r.record.id;
    if (r.kind === 'doctext' && !r.record.deleted && (touched.docs.has(id) || touched.before.has(id))) touched.theirs.set(id, r.record.text);
  }
  const summary = mergeSummary(bundle.project.name, added, updated, unchanged, sane.rejected, sane.conflicts.length);
  await store.setMeta(MERGE_PENDING, JSON.stringify({ touched: touchesToJson(touched), summary }));
  await store.merge(sane.records);
  const done = await completeMerge(project, touched);
  // The newest write stamp may not move (a teammate's older work): the next backup is made anyway.
  await store.deleteMeta('backup.last_hlc');

  let blobs = 0;
  const seenBlobs = new Set<string>();
  for (const r of sane.records) {
    if (r.kind !== 'document') continue;
    for (const ref of mediaRefs(r.record)) {
      const bytes = bundle.blobs.get(ref.blob_id);
      if (!bytes || seenBlobs.has(ref.blob_id) || !BLOB_ID.test(ref.blob_id)) continue;
      seenBlobs.add(ref.blob_id);
      check();
      if (await project.hasBlob(ref.blob_id)) continue;
      await project.restoreBlob(ref.blob_id, bytes);
      blobs++;
    }
  }
  await project.reloadMe();
  // The audit-trail entry and the end of the pending note, in one write.
  const extra = [
    done.fixed.reanchored ? ` ↦${done.fixed.reanchored}` : '',
    done.fixed.removedCodings ? ` −${done.fixed.removedCodings}` : '',
    done.fixed.revived.length ? ` ↺${done.fixed.revived.length}` : '',
    done.repseudonymised.length ? ` ↻${done.repseudonymised.length}` : '',
  ].join('');
  await finishLog(project, `${summary}${extra}`);
  return {
    added, updated, unchanged, blobs, rejected: sane.rejected,
    textConflicts: sane.conflicts, reanchored: done.fixed.reanchored, removedCodings: done.fixed.removedCodings,
    originalsFound: done.originalsFound, repseudonymised: done.repseudonymised, textsReplaced: sane.replaced, revived: done.fixed.revived,
  };
}

function mergeSummary(name: string, added: number, updated: number, unchanged: number, rejected: number, conflicts: number): string {
  return `"${name}" +${added} ~${updated} =${unchanged}${rejected ? ` !${rejected}` : ''}${conflicts ? ` ⚠${conflicts}` : ''}`;
}

/** Writes the merge's log entry and clears the pending note together. */
async function finishLog(project: Project, summary: string): Promise<void> {
  await project.store.write({ puts: [{ kind: 'log', draft: project.logRecord('project.merge', summary) }], meta: [{ key: MERGE_PENDING, value: null }] });
}

/** After the records are written: put them in step, apply the key again where needed, check. */
async function completeMerge(project: Project, touched: MergeTouches) {
  const fixed = await reconcile(project.store, touched);
  // Everything the merge wrote or brought back: a teammate's version from before the key was
  // applied must not bring names back (a document name, a memo, a deleted document's text).
  const scope = new Set<string>();
  for (const k of [...touched.written, ...fixed.restored]) scope.add(k.startsWith('doctext:') ? `document:${k.slice(8)}` : k);
  const re = await reapplyKey(project, scope, 'merge');
  const originalsFound = await originalsIn(project, scope);
  return { fixed, repseudonymised: re.hits, originalsFound };
}

/**
 * Finishes a merge that a lock or a crash cut short after its records were written (meta
 * `MERGE_PENDING`): puts them in step and logs it. Called when a project opens. Returns whether
 * there was one. Merging the same file again afterwards brings in anything not yet written.
 */
export async function finishPendingMerge(project: Project): Promise<boolean> {
  const raw = await project.store.getMeta(MERGE_PENDING);
  if (!raw) return false;
  let summary = '?';
  try {
    const o = JSON.parse(raw) as { touched: string; summary?: string };
    summary = o.summary ?? summary;
    const done = await completeMerge(project, touchesFromJson(o.touched));
    summary += done.fixed.reanchored ? ` ↦${done.fixed.reanchored}` : '';
  } catch (e) {
    // Put right what can be from the texts alone.
    console.error('finishing an interrupted merge failed; checking every coding instead', e);
    await repairImported(project.store);
  }
  await project.store.deleteMeta('backup.last_hlc');
  await finishLog(project, `${summary} (interrupted)`);
  return true;
}

/**
 * Where an original of an applied pseudonymisation key entry remains among `scope` (`kind:id`):
 * document texts and the fields `apply` replaces in.
 */
async function originalsIn(ctx: ProjectContext, scope: ReadonlySet<string>): Promise<{ documentId: string; name: string; kind?: string; field?: string }[]> {
  if (!scope.size) return [];
  const p = await preview(ctx, undefined, { appliedOnly: true, only: scope, protect: true });
  return [
    ...p.documents.map((d) => ({ documentId: d.documentId, name: d.name })),
    ...p.fields.map((f) => ({ documentId: f.id, name: f.label, kind: f.kind, field: f.field })),
  ];
}

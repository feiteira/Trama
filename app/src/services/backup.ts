import { sha256 } from '@noble/hashes/sha2.js';
import { DateTime } from 'luxon';
import { toHex, utf8, wipe } from '../core/bytes';
import { DecryptError } from '../core/crypto/frames';
import type { SlotKind } from '../core/crypto/keyring';
import {
  buildTramaZip, decryptTrama, encryptWithLibraryKey, readTramaZip, type TramaBundle, UnlockRequiredError,
} from '../core/export/trama';
import { LIMITS } from '../core/model/types';
import type { Store } from '../core/store/store';
import { type FileEntry, type Platform, PlatformError } from '../platform/types';
import { projectToBundle } from './datafile';
import type { Library } from './library';
import type { Project, ProjectInfo } from './project';

// Automatic encrypted backups of the open project to a folder the researcher chooses (a USB
// drive, a synced folder). Each backup is a .trama file encrypted under the library key with
// the keyring inside, so it restores on another computer with the passphrase or the recovery
// phrase. Settings live in the project's store meta: they belong to this computer.

export const BACKUP_PREFIX = 'Trama backup ';
export const META = {
  folder: 'backup.folder',
  /** How far back backups go, in days (HISTORY_DAYS). */
  historyDays: 'backup.history_days',
  lastOk: 'backup.last_ok_at',
  /** `<ISO time> <BackupErrorCode>` of the last failed backup; '' after a good one. */
  lastError: 'backup.last_error',
  /** The project's newest write stamp when the last backup was made. */
  lastHlc: 'backup.last_hlc',
  /** The last backup's file name, so an unchanged project is skipped only while it exists. */
  lastFile: 'backup.last_file',
  /** A fingerprint of the keyring in the last backup: a new passphrase means a new backup. */
  lastKeyring: 'backup.last_keyring',
} as const;

export const BACKUP_INTERVAL_HOURS = 24;
/** Screens warn when the last good backup is older than this. */
export const BACKUP_STALE_DAYS = 3;

export const HISTORY_DAYS = [30, 90, 365] as const;
export type HistoryDays = (typeof HISTORY_DAYS)[number];
export const DEFAULT_HISTORY_DAYS: HistoryDays = 90;

export async function backupHistoryDays(store: Store): Promise<HistoryDays> {
  const days = Number(await store.getMeta(META.historyDays));
  return (HISTORY_DAYS as readonly number[]).includes(days) ? (days as HistoryDays) : DEFAULT_HISTORY_DAYS;
}

export async function setBackupHistoryDays(project: Project, days: HistoryDays): Promise<void> {
  if (!(HISTORY_DAYS as readonly number[]).includes(days)) throw new Error(`history must be one of ${HISTORY_DAYS.join(', ')}`);
  await project.store.setMeta(META.historyDays, String(days));
}

/** Chooses (or with null, forgets) the backup folder. A new folder gets a backup on the next run. */
export async function setBackupFolder(project: Project, folder: string | null): Promise<void> {
  if (folder) {
    await project.store.setMeta(META.folder, folder);
    await project.store.deleteMeta(META.lastFile);
  } else {
    await project.store.deleteMeta(META.folder);
  }
  await project.store.setMeta(META.lastError, '');
}

// ── Backup file names ────────────────────────────────────────────────────────────────

const NAME = /^Trama backup ([0-9a-f]{6}) (\d{4}-\d{2}-\d{2} \d{6})\.trama$/;

/** `Trama backup <tag> 2026-10-05 093015.trama`, in the computer's local time. */
export function backupFileName(tag: string, now: Date): string {
  return `${BACKUP_PREFIX}${tag} ${DateTime.fromJSDate(now).toFormat('yyyy-MM-dd HHmmss')}.trama`;
}

export interface BackupName {
  tag: string;
  at: DateTime;
}

export function parseBackupName(name: string): BackupName | null {
  const m = NAME.exec(name);
  if (!m) return null;
  const at = DateTime.fromFormat(m[2]!, 'yyyy-MM-dd HHmmss');
  return at.isValid ? { tag: m[1]!, at } : null;
}

// ── Which backups to keep ────────────────────────────────────────────────────────────

/** Backups always kept, however old: a wrong clock must never empty the folder. */
const KEEP_NEWEST = 3;
/** Everything from the last day is kept, up to this many. */
const KEEP_RECENT = 10;

export interface PruneOptions {
  tag: string;
  historyDays: number;
  now: Date;
  /** Never removed (the backup just written). */
  keep?: string;
}

/**
 * The backup files to delete, by name. This project's backups thin out with age: everything
 * from the last 24 hours (at most 10), one a day for 14 days, one a week for 8 weeks, one a
 * month for 12 months, never older than the history length — and the newest three always.
 * Files with another tag (other projects, other computers) are never touched.
 */
export function backupsToPrune(names: string[], opts: PruneOptions): string[] {
  const now = DateTime.fromJSDate(opts.now);
  const ours = names
    .flatMap((name) => {
      const p = parseBackupName(name);
      return p && p.tag === opts.tag ? [{ name, ...p }] : [];
    })
    .sort((a, b) => b.at.toMillis() - a.at.toMillis() || b.name.localeCompare(a.name));
  const remove: string[] = [];
  const seen = new Set<string>();
  let recent = 0;
  ours.forEach((b, i) => {
    const ageDays = now.diff(b.at, 'days').days;
    const day = `d${b.at.toISODate()}`;
    const week = `w${b.at.toFormat("kkkk-'W'WW")}`;
    const month = `m${b.at.toFormat('yyyy-MM')}`;
    let keep = false;
    if (i < KEEP_NEWEST || b.name === opts.keep) keep = true;
    else if (ageDays < 1 && recent < KEEP_RECENT) keep = true;
    else if (ageDays >= opts.historyDays) keep = false;
    else if (ageDays < 14) keep = !seen.has(day);
    else if (ageDays < 56) keep = !seen.has(week);
    else if (ageDays < 365) keep = !seen.has(month);
    if (!keep) {
      remove.push(b.name);
      return;
    }
    if (ageDays < 1) recent++;
    seen.add(day).add(week).add(month);
  });
  return remove;
}

// ── Errors ───────────────────────────────────────────────────────────────────────────

/** Reasons a backup failed that are remembered (META.lastError) and shown. */
export const BACKUP_ERRORS = ['FOLDER_MISSING', 'PERMISSION', 'DISK_FULL', 'ERROR'] as const;
export type BackupErrorCode = (typeof BACKUP_ERRORS)[number];

/** Why a backup did not happen. `code` is what the screens translate. */
export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode | 'NO_FOLDER' | 'LOCKED' | 'EXAMPLE',
    message: string,
  ) {
    super(message);
  }
}

/** Sorts any failure into one of the reasons the researcher is told. */
export function backupErrorCode(e: unknown): BackupErrorCode {
  if (e instanceof BackupError && (BACKUP_ERRORS as readonly string[]).includes(e.code)) return e.code as BackupErrorCode;
  if (e instanceof PlatformError) {
    if (e.code === 'NOT_FOUND') return 'FOLDER_MISSING';
    if (e.code === 'PERMISSION_DENIED') return 'PERMISSION';
    // The shell reports the operating system's text: ENOSPC is error 28, Windows says 112 or 39.
    if (/os error (28|39|112)\b|no space left|not enough space|disk (is )?full/i.test(e.message)) return 'DISK_FULL';
    if (/os error (13|5)\b|permission denied|access is denied/i.test(e.message)) return 'PERMISSION';
  }
  return 'ERROR';
}

// ── Status ───────────────────────────────────────────────────────────────────────────

export interface BackupStatus {
  folder: string | null;
  lastOk: string | null;
  lastError: { at: string; code: BackupErrorCode } | null;
  /** A folder is chosen and a day has passed since the last good backup, or the last one failed. */
  due: boolean;
}

function parseLastError(raw: string | null): BackupStatus['lastError'] {
  if (!raw) return null;
  const [at = '', code = ''] = raw.split(' ');
  return { at, code: (BACKUP_ERRORS as readonly string[]).includes(code) ? (code as BackupErrorCode) : 'ERROR' };
}

export async function backupStatus(project: Project, now = new Date()): Promise<BackupStatus> {
  const { store } = project;
  const folder = await store.getMeta(META.folder);
  const lastOk = await store.getMeta(META.lastOk);
  const lastError = parseLastError(await store.getMeta(META.lastError));
  const age = lastOk ? DateTime.fromJSDate(now).diff(DateTime.fromISO(lastOk), 'hours').hours : Infinity;
  // A last backup "in the future" (the clock was moved back) counts as old: better one too many.
  const old = !(age >= 0 && age < BACKUP_INTERVAL_HOURS);
  return { folder: folder || null, lastOk, lastError, due: !!folder && (old || !!lastError) };
}

/** True when the last good backup is older than BACKUP_STALE_DAYS (or there never was one). */
export function backupIsStale(status: BackupStatus, now = new Date()): boolean {
  if (!status.lastOk) return true;
  return DateTime.fromJSDate(now).diff(DateTime.fromISO(status.lastOk), 'days').days > BACKUP_STALE_DAYS;
}

// ── Backing up ───────────────────────────────────────────────────────────────────────

export interface BackupOptions {
  now?: Date;
  /** Back up even when nothing changed since the last backup (Back up now). */
  force?: boolean;
}

export type BackupResult = { written: true; path: string; name: string } | { written: false; reason: 'unchanged' };

const keyringPrint = (keyring: unknown) => toHex(sha256(utf8(JSON.stringify(keyring)))).slice(0, 16);

/**
 * Writes an encrypted backup of the open project to its backup folder, reads it back to check
 * that it opens, then thins out older backups. Without `force`, does nothing when the project
 * has not changed since the last backup and that backup is still in the folder.
 *
 * Works on copies of the keys, so a lock that starts meanwhile cannot spoil the file. Never
 * runs in the example library.
 */
export async function runBackup(project: Project, opts: BackupOptions = {}): Promise<BackupResult> {
  const now = opts.now ?? new Date();
  const { store, platform } = project;
  const { files } = platform;
  const info = await platform.info();
  if (info.example) throw new BackupError('EXAMPLE', 'the example library is never backed up');
  if (!project.isOpen) throw new BackupError('LOCKED', 'the project is closed');
  const folder = await store.getMeta(META.folder);
  if (!folder) throw new BackupError('NO_FOLDER', 'no backup folder chosen');

  // Everything the backup needs from the keys, copied before any slow step.
  let keys: ReturnType<Project['copyKeys']>;
  try {
    keys = project.copyKeys();
  } catch {
    throw new BackupError('LOCKED', 'the project is closed');
  }
  try {
    const [latestHlc, lastHlc, lastFile, lastKeyring, historyDays, me] = await Promise.all([
      store.latestHlc(),
      store.getMeta(META.lastHlc),
      store.getMeta(META.lastFile),
      store.getMeta(META.lastKeyring),
      backupHistoryDays(store),
      store.getMeta('me'),
    ]);
    const latest = latestHlc ?? '';
    const keyring = keyringPrint(keys.keyring);
    try {
      // An unplugged drive or a moved folder fails here, at once.
      if (!(await files.exists(folder))) throw new BackupError('FOLDER_MISSING', 'backup folder not found');
      const listed = await files.list(folder, false);

      const unchanged = latest === lastHlc && keyring === lastKeyring && !!lastFile && listed.some((e) => e.name === lastFile);
      if (unchanged && !opts.force) {
        await markGood(store, now);
        return { written: false, reason: 'unchanged' };
      }

      // Large projects hold many recordings: let go of each copy as soon as it is not needed.
      let bundle: Awaited<ReturnType<typeof projectToBundle>> | null = await projectToBundle(project, {
        includeDeleted: true,
        includePseudonyms: true,
        readBlob: keys.readBlob,
      });
      let zip: Uint8Array | null = buildTramaZip(bundle, { appVersion: info.version, includePseudonyms: true, now, me });
      bundle = null;
      const zipHash = toHex(sha256(zip));
      let bytes: Uint8Array | null = encryptWithLibraryKey(zip, keys.libraryKey, keys.keyring);
      zip = null;
      let name = backupFileName(project.backupTag, now);
      for (let s = 1; listed.some((e) => e.name === name) && s < 60; s++) {
        name = backupFileName(project.backupTag, new Date(now.getTime() + s * 1000));
      }
      const path = files.join(folder, name);
      await files.write(path, bytes);
      bytes = null;

      // Read it back: a file that does not open must never replace good ones. Opening checks
      // every byte (the encryption is authenticated).
      const back = await files
        .read(path)
        .then((b) => decryptTrama(b, { kind: 'library-key', libraryKey: keys.libraryKey }, platform.kdf))
        .catch(() => null);
      // The hash proves the bytes; parsing proves the file is a project Trama can restore.
      const readable = back && toHex(sha256(back.zip)) === zipHash && (() => {
        try {
          readTramaZip(back.zip);
          return true;
        } catch {
          return false;
        }
      })();
      if (!readable) {
        await files.remove(path).catch(() => undefined);
        throw new BackupError('ERROR', 'the backup did not read back');
      }

      await prune(files, listed, name, { tag: project.backupTag, historyDays, now });

      await store.setMeta(META.lastHlc, latest);
      await store.setMeta(META.lastFile, name);
      await store.setMeta(META.lastKeyring, keyring);
      await markGood(store, now);
      return { written: true, path, name };
    } catch (e) {
      const code = backupErrorCode(e);
      await store.setMeta(META.lastError, `${now.toISOString()} ${code}`).catch(() => undefined);
      throw e instanceof BackupError ? e : new BackupError(code, (e as Error).message);
    }
  } finally {
    keys.wipe();
  }
}

async function markGood(store: Store, now: Date): Promise<void> {
  await store.setMeta(META.lastOk, now.toISOString());
  await store.setMeta(META.lastError, '');
}

async function prune(files: Platform['files'], listed: FileEntry[], written: string, opts: Omit<PruneOptions, 'keep'>): Promise<void> {
  const byName = new Map(listed.filter((e) => !e.is_dir).map((e) => [e.name, e]));
  for (const name of backupsToPrune([...byName.keys(), written], { ...opts, keep: written })) {
    const entry = byName.get(name);
    if (entry) await files.remove(entry.path).catch((e) => console.warn('could not remove an old backup', e));
  }
  // Half-written files a crash or an unplugged drive left behind are hidden temporary files of
  // the shell's atomic write (`.<name>.<pid>-<n>.tmp`, which listings skip): the shell removes
  // them itself once they are an hour old, on its next write to the folder (files.rs).
}

// ── Listing and restoring ────────────────────────────────────────────────────────────

export interface BackupFile {
  name: string;
  path: string;
  tag: string;
  /** When it was made (local time of the computer that made it), as epoch milliseconds. */
  at: number;
  size: number;
}

/** The backups in a folder, newest first; only those of one tag when given. */
export async function listBackups(platform: Platform, folder: string, tag?: string): Promise<BackupFile[]> {
  const entries = await platform.files.list(folder, false);
  return entries
    .flatMap((e) => {
      const p = e.is_dir ? null : parseBackupName(e.name);
      if (!p || (tag !== undefined && p.tag !== tag)) return [];
      return [{ name: e.name, path: e.path, tag: p.tag, at: p.at.toMillis(), size: e.size }];
    })
    .sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
}

/**
 * Restores a backup as a NEW project of this library and opens it; nothing here is ever
 * overwritten. A backup made by this library opens with its key; one from elsewhere needs the
 * passphrase or recovery phrase of the library that made it (the backup carries that keyring).
 * The restored project keeps the original id when this library does not hold it already, so
 * teammates' copies still merge with it.
 */
export interface RestoreOptions {
  now?: Date;
  /**
   * The restored project's name from the backup's and the day, in the reader's language
   * ("Gardens (restored 2026-10-05)" by default). Long names are shortened to fit.
   */
  restoredName?: (name: string, date: Date) => string;
  /** false: add the restored project to the library without opening it (see `Library.importBundle`). */
  open?: boolean;
}

const defaultRestoredName = (name: string, date: Date) => `${name} (restored ${DateTime.fromJSDate(date).toFormat('yyyy-MM-dd')})`;

/** `restoredName(name, date)`, with the backup's name shortened until the whole fits `max`. */
export function restoredProjectName(name: string, date: Date, restoredName = defaultRestoredName, max: number = LIMITS.nameMax): string {
  let base = name.replace(/\s+/g, ' ').trim() || 'Project';
  let out = restoredName(base, date).replace(/\s+/g, ' ').trim();
  while (out.length > max && base.length > 1) {
    base = base.slice(0, Math.max(1, base.length - (out.length - max))).trimEnd();
    out = restoredName(base, date).replace(/\s+/g, ' ').trim();
  }
  return out.slice(0, max).trim();
}

export async function restoreBackup(library: Library, bytes: Uint8Array, slot: SlotKind | undefined, secret: string | undefined, opts: RestoreOptions & { open: false }): Promise<ProjectInfo>;
export async function restoreBackup(library: Library, bytes: Uint8Array, slot?: SlotKind, secret?: string, opts?: RestoreOptions & { open?: true }): Promise<Project>;
export async function restoreBackup(library: Library, bytes: Uint8Array, slot?: SlotKind, secret?: string, opts: RestoreOptions = {}): Promise<Project | ProjectInfo> {
  let bundle: TramaBundle;
  const own = library.copyKeys();
  try {
    let zip: Uint8Array;
    try {
      ({ zip } = await decryptTrama(bytes, { kind: 'library-key', libraryKey: own.libraryKey }, library.platform.kdf));
    } catch (e) {
      if (!(e instanceof DecryptError)) throw e;
      // Another library's backup: the screens ask for that library's passphrase.
      if (!slot || secret === undefined) throw new UnlockRequiredError('library-key');
      const opened = await decryptTrama(bytes, { kind: 'secret', slot, secret }, library.platform.kdf);
      if (opened.libraryKey) wipe(opened.libraryKey);
      zip = opened.zip;
    }
    bundle = readTramaZip(zip);
  } finally {
    own.wipe();
  }
  const name = restoredProjectName(bundle.project.name, opts.now ?? new Date(), opts.restoredName);
  const id = bundle.project.id;
  const free = !!id && !library.projects.some((p) => p.id === id) && !(await library.platform.projects.exists(id));
  const options = { name, keepId: free, me: bundle.manifest.me ?? null };
  return opts.open === false ? library.importBundle(bundle, { ...options, open: false }) : library.importBundle(bundle, options);
}

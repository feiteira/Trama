import { DateTime } from 'luxon';
import { BACKUP_INTERVAL_HOURS, BACKUP_STALE_DAYS, type BackupErrorCode, type BackupFile, type BackupStatus } from '../../services/backup';

// What the Backups section says about the state of automatic backups, worked out from the
// stored status. Pure, so every case is tested; the screen only translates it.

/** How often the scheduler looks whether a backup is due (BackupScheduler). */
export const CHECK_EVERY_MS = 60 * 60 * 1000;

export type BackupTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export type BackupView =
  /** The example library: never backed up. */
  | { state: 'example'; tone: 'neutral' }
  /** No folder chosen. */
  | { state: 'off'; tone: 'warning' }
  | { state: 'running'; tone: 'info'; folder: string; lastOk: string | null }
  /** A folder is chosen, but no backup was ever made. */
  | { state: 'never'; tone: 'info'; folder: string; nextDue: 'soon' }
  | { state: 'ok'; tone: 'success'; folder: string; lastOk: string; nextDue: string | 'soon' }
  /** The last good backup is older than BACKUP_STALE_DAYS (without a recorded failure). */
  | { state: 'stale'; tone: 'warning'; folder: string; lastOk: string; nextDue: 'soon'; days: number }
  | { state: 'failed'; tone: 'danger'; folder: string; lastOk: string | null; failedAt: string; code: BackupErrorCode; nextDue: 'soon' };

/**
 * When the next automatic backup is due: a day after the last good one, as an ISO time, or
 * 'soon' (at the next hourly check) when it is due already, failed last time, or never ran.
 */
export function nextBackupDue(status: Pick<BackupStatus, 'lastOk' | 'lastError'>, now: Date): string | 'soon' {
  if (!status.lastOk || status.lastError) return 'soon';
  const last = DateTime.fromISO(status.lastOk);
  if (!last.isValid) return 'soon';
  const due = last.plus({ hours: BACKUP_INTERVAL_HOURS });
  // A last backup "in the future" (the clock moved back) is due now, as backupStatus says.
  if (due.toMillis() <= now.getTime() || last.toMillis() > now.getTime()) return 'soon';
  return due.toUTC().toISO()!;
}

export function backupView(status: BackupStatus, opts: { now: Date; example: boolean; running: boolean }): BackupView {
  if (opts.example) return { state: 'example', tone: 'neutral' };
  const { folder, lastOk, lastError } = status;
  if (!folder) return { state: 'off', tone: 'warning' };
  if (opts.running) return { state: 'running', tone: 'info', folder, lastOk };
  if (lastError) return { state: 'failed', tone: 'danger', folder, lastOk, failedAt: lastError.at, code: lastError.code, nextDue: 'soon' };
  if (!lastOk) return { state: 'never', tone: 'info', folder, nextDue: 'soon' };
  const days = Math.floor(DateTime.fromJSDate(opts.now).diff(DateTime.fromISO(lastOk), 'days').days);
  if (days > BACKUP_STALE_DAYS) return { state: 'stale', tone: 'warning', folder, lastOk, nextDue: 'soon', days };
  return { state: 'ok', tone: 'success', folder, lastOk, nextDue: nextBackupDue(status, opts.now) };
}

/** Message keys for a failure, in plain language: what happened and what to do. */
export const BACKUP_ERROR_MESSAGE = {
  FOLDER_MISSING: 'exporter.backups.errors.FOLDER_MISSING',
  PERMISSION: 'exporter.backups.errors.PERMISSION',
  DISK_FULL: 'exporter.backups.errors.DISK_FULL',
  ERROR: 'exporter.backups.errors.ERROR',
} as const satisfies Record<BackupErrorCode, string>;

export interface BackupGroups {
  /** This project's backups, newest first. */
  mine: BackupFile[];
  /** Backups of other projects or other computers sharing the folder. */
  others: BackupFile[];
}

/** Splits a folder's backups into this project's and the rest (both stay newest first). */
export function groupBackups(files: readonly BackupFile[], tag: string): BackupGroups {
  const mine: BackupFile[] = [];
  const others: BackupFile[] = [];
  for (const f of files) (f.tag === tag ? mine : others).push(f);
  return { mine, others };
}

/** The last part of a folder path, for a compact label (the full path goes in a tooltip). */
export function folderLabel(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const last = trimmed.split(/[\\/]/).pop();
  return last || path;
}

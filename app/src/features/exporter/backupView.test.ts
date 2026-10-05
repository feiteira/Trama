import { describe, expect, it } from 'vitest';
import type { BackupFile, BackupStatus } from '../../services/backup';
import { backupView, folderLabel, groupBackups, nextBackupDue } from './backupView';

const now = new Date('2026-10-05T10:00:00Z');
const status = (s: Partial<BackupStatus>): BackupStatus => ({ folder: '/usb/Trama', lastOk: null, lastError: null, due: false, ...s });

describe('backupView', () => {
  it('says nothing is backed up in the example, whatever is stored', () => {
    expect(backupView(status({}), { now, example: true, running: false }).state).toBe('example');
  });

  it('is off without a folder', () => {
    expect(backupView(status({ folder: null, lastOk: '2026-10-05T09:00:00Z' }), { now, example: false, running: false })).toEqual({ state: 'off', tone: 'warning' });
  });

  it('shows a running backup before anything else', () => {
    const v = backupView(status({ lastError: { at: '2026-10-05T09:00:00Z', code: 'DISK_FULL' } }), { now, example: false, running: true });
    expect(v.state).toBe('running');
  });

  it('reports a failure with its code and time, and retries soon', () => {
    const v = backupView(status({ lastOk: '2026-10-01T09:00:00Z', lastError: { at: '2026-10-05T09:00:00Z', code: 'FOLDER_MISSING' } }), { now, example: false, running: false });
    expect(v).toMatchObject({ state: 'failed', tone: 'danger', code: 'FOLDER_MISSING', failedAt: '2026-10-05T09:00:00Z', lastOk: '2026-10-01T09:00:00Z', nextDue: 'soon' });
  });

  it('says no backup yet when a folder is new', () => {
    expect(backupView(status({}), { now, example: false, running: false })).toMatchObject({ state: 'never', nextDue: 'soon' });
  });

  it('is fine within the interval, with the next one a day after the last', () => {
    const v = backupView(status({ lastOk: '2026-10-05T08:30:00Z' }), { now, example: false, running: false });
    expect(v).toMatchObject({ state: 'ok', tone: 'success', nextDue: '2026-10-06T08:30:00.000Z' });
  });

  it('warns when the last good backup is older than three days', () => {
    const v = backupView(status({ lastOk: '2026-09-30T09:00:00Z' }), { now, example: false, running: false });
    expect(v).toMatchObject({ state: 'stale', days: 5 });
  });
});

describe('nextBackupDue', () => {
  it('is soon when overdue, never made, failed, or stamped in the future', () => {
    expect(nextBackupDue({ lastOk: '2026-10-04T09:00:00Z', lastError: null }, now)).toBe('soon');
    expect(nextBackupDue({ lastOk: null, lastError: null }, now)).toBe('soon');
    expect(nextBackupDue({ lastOk: '2026-10-05T09:00:00Z', lastError: { at: 'x', code: 'ERROR' } }, now)).toBe('soon');
    expect(nextBackupDue({ lastOk: '2026-10-07T09:00:00Z', lastError: null }, now)).toBe('soon');
    expect(nextBackupDue({ lastOk: 'garbage', lastError: null }, now)).toBe('soon');
  });
});

describe('groupBackups', () => {
  it('splits by tag and keeps the order', () => {
    const f = (name: string, tag: string, at: number): BackupFile => ({ name, path: `/usb/${name}`, tag, at, size: 1 });
    const files = [f('a', 'aaaaaa', 3), f('b', 'bbbbbb', 2), f('c', 'aaaaaa', 1)];
    const g = groupBackups(files, 'aaaaaa');
    expect(g.mine.map((x) => x.name)).toEqual(['a', 'c']);
    expect(g.others.map((x) => x.name)).toEqual(['b']);
  });
});

describe('folderLabel', () => {
  it('takes the last part of POSIX and Windows paths', () => {
    expect(folderLabel('/media/ana/USB/Trama backups/')).toBe('Trama backups');
    expect(folderLabel('D:\\Backups\\Trama')).toBe('Trama');
    expect(folderLabel('/')).toBe('/');
  });
});

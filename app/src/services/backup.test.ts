import { describe, expect, it } from 'vitest';
import { fromUtf8, utf8 } from '../core/bytes';
import { newRecoveryPhrase, WrongSecretError } from '../core/crypto/keyring';
import { protectionOf, UnlockRequiredError } from '../core/export/trama';
import { createMemoryPlatform } from '../platform/memory';
import { type Platform, PlatformError } from '../platform/types';
import {
  BackupError, backupErrorCode, backupFileName, backupIsStale, backupStatus, backupsToPrune, listBackups, META,
  parseBackupName, restoreBackup, runBackup, setBackupFolder, setBackupHistoryDays,
} from './backup';
import { Library } from './library';
import { FAST_KDF } from './testing';

async function seeded(opts: { example?: boolean } = {}) {
  const platform = createMemoryPlatform({ example: opts.example });
  const phrase = newRecoveryPhrase();
  const library = await Library.create(platform, { passphrase: 'pass word', recoveryPhrase: phrase }, { params: FAST_KDF });
  const project = await library.createProject({ name: 'Estudo piloto', coderName: 'Ana' });
  const original = await project.addBlob(utf8('%PDF-1.7 scan'), 'scan.pdf', 'application/pdf');
  const doc = await project.store.put('document', {
    name: 'Entrevista 1', kind: 'text', group_ids: [], case_id: null, source: null, original, media: null, chars: 9, order: 1, color: null,
  });
  await project.store.put('doctext', { id: doc.id, text: 'Olá Maria', sync: [] });
  await project.store.put('pseudonym', { original: 'Maria', replacement: 'P1', note: '', whole_word: true, case_sensitive: false, applied_at: null, applied_count: 0 });
  return { platform, phrase, library, project, doc };
}

async function withFolder(opts: { example?: boolean } = {}) {
  const s = await seeded(opts);
  s.platform.addDir('/usb');
  await setBackupFolder(s.project, '/usb');
  return s;
}

const names = async (platform: Platform, dir = '/usb') => (await platform.files.list(dir, false)).map((e) => e.name);

describe('running backups', () => {
  it('writes an encrypted backup, reports it, and restores it on a new computer with the recovery phrase', async () => {
    const { platform, project, phrase, doc } = await withFolder();
    const t0 = new Date('2026-10-05T08:00:00Z');
    expect((await backupStatus(project, t0)).due).toBe(true);
    const r = await runBackup(project, { now: t0 });
    expect(r.written).toBe(true);
    const [name] = await names(platform);
    expect(name).toMatch(new RegExp(`^Trama backup ${project.backupTag} 2026-10-05 \\d{6}\\.trama$`));
    const status = await backupStatus(project, new Date(t0.getTime() + 3600_000));
    expect(status).toMatchObject({ folder: '/usb', lastOk: t0.toISOString(), lastError: null, due: false });
    expect((await backupStatus(project, new Date(t0.getTime() + 25 * 3600_000))).due).toBe(true);

    const bytes = await platform.files.read(`/usb/${name}`);
    expect(protectionOf(bytes)).toBe('library-key');
    expect(fromUtf8(bytes)).not.toContain('Maria');
    expect(fromUtf8(bytes)).not.toContain('Estudo');

    // A new computer: a new, different library.
    const other = createMemoryPlatform();
    const library2 = await Library.create(other, { passphrase: 'other pass', recoveryPhrase: newRecoveryPhrase() }, { params: FAST_KDF });
    await expect(restoreBackup(library2, bytes)).rejects.toBeInstanceOf(UnlockRequiredError);
    await expect(restoreBackup(library2, bytes, 'passphrase', 'wrong')).rejects.toBeInstanceOf(WrongSecretError);
    const restored = await restoreBackup(library2, bytes, 'recovery_phrase', phrase, { now: new Date('2026-10-06T10:00:00') });
    expect(restored.id).toBe(project.id); // free here: the same project, for later merges
    expect(restored.info.name).toBe('Estudo piloto (restored 2026-10-06)');
    expect(restored.me.name).toBe('Ana'); // the backup says who made it
    expect((await restored.store.get('doctext', doc.id))!.text).toBe('Olá Maria');
    expect(await restored.store.count('pseudonym')).toBe(1); // backups keep everything
    expect(fromUtf8(await restored.readBlob(doc.original!))).toBe('%PDF-1.7 scan');
  });

  it('restores its own backup as a new project with a new id, never over the original', async () => {
    const { platform, library, project, doc } = await withFolder();
    await runBackup(project, { now: new Date('2026-10-05T08:00:00Z') });
    await project.store.update('doctext', doc.id, { text: 'Changed after the backup' });
    const [name] = await names(platform);
    const restored = await restoreBackup(library, await platform.files.read(`/usb/${name}`)); // no passphrase needed
    expect(restored.id).not.toBe(project.id);
    expect(library.projects).toHaveLength(2);
    expect((await restored.store.get('doctext', doc.id))!.text).toBe('Olá Maria');
    const original = await library.openProject(project.id);
    expect((await original.store.get('doctext', doc.id))!.text).toBe('Changed after the backup');
  });

  it('skips a project that has not changed, unless asked', async () => {
    const { platform, project } = await withFolder();
    const t0 = new Date('2026-10-05T08:00:00Z');
    await runBackup(project, { now: t0 });
    const t1 = new Date(t0.getTime() + 25 * 3600_000);
    expect(await runBackup(project, { now: t1 })).toEqual({ written: false, reason: 'unchanged' });
    expect((await backupStatus(project, t1)).lastOk).toBe(t1.toISOString());
    expect(await names(platform)).toHaveLength(1);
    expect((await runBackup(project, { now: new Date(t1.getTime() + 1000), force: true })).written).toBe(true);
    expect(await names(platform)).toHaveLength(2);
  });

  it('backs up again after a change, when the last file is gone, or after a new passphrase', async () => {
    const { platform, library, project } = await withFolder();
    let t = new Date('2026-10-05T08:00:00Z').getTime();
    const next = () => new Date((t += 60_000));
    await runBackup(project, { now: next() });
    await project.store.put('code', { name: 'Novo', parent_id: null, color: '#e4572e', description: '', inclusion: '', exclusion: '', example: '', order: 1, codable: true, shortcut: null });
    expect((await runBackup(project, { now: next() })).written).toBe(true);
    for (const n of await names(platform)) await platform.files.remove(`/usb/${n}`);
    expect((await runBackup(project, { now: next() })).written).toBe(true);
    await library.changeSecret('passphrase', 'new pass', { params: FAST_KDF });
    expect((await runBackup(project, { now: next() })).written).toBe(true);
  });

  it('never runs in the example library, nor without a folder, nor once closed', async () => {
    const ex = await withFolder({ example: true });
    await expect(runBackup(ex.project)).rejects.toMatchObject({ code: 'EXAMPLE' });
    const s = await seeded();
    await expect(runBackup(s.project)).rejects.toMatchObject({ code: 'NO_FOLDER' });
    expect((await backupStatus(s.project)).due).toBe(false);
    await setBackupFolder(s.project, '/usb');
    await s.library.lock();
    await expect(runBackup(s.project)).rejects.toMatchObject({ code: 'LOCKED' });
  });

  it('fails fast when the folder is not there, and keeps the reason', async () => {
    const { project } = await seeded();
    await setBackupFolder(project, '/media/unplugged');
    const now = new Date('2026-10-05T08:00:00Z');
    await expect(runBackup(project, { now })).rejects.toMatchObject({ code: 'FOLDER_MISSING' });
    const status = await backupStatus(project, now);
    expect(status.lastError).toEqual({ at: now.toISOString(), code: 'FOLDER_MISSING' });
    expect(status.due).toBe(true);
  });

  it('a lock in the middle of a backup still leaves a file that opens', async () => {
    const { platform, library, project, phrase } = await withFolder();
    const write = platform.files.write;
    let locked: Promise<void> | null = null;
    platform.files.write = async (path, bytes) => {
      locked = library.lock(); // Lock pressed while the file is being written
      await write(path, bytes);
    };
    // The project closes mid-way: the bookkeeping after the write may fail, the file must not.
    await runBackup(project, { now: new Date('2026-10-05T08:00:00Z') }).catch(() => undefined);
    await locked;
    platform.files.write = write;
    const [name] = await names(platform);
    const other = createMemoryPlatform();
    const lib2 = await Library.create(other, { passphrase: 'x', recoveryPhrase: newRecoveryPhrase() }, { params: FAST_KDF });
    const restored = await restoreBackup(lib2, await platform.files.read(`/usb/${name!}`), 'recovery_phrase', phrase);
    expect(await restored.store.count('doctext')).toBe(1);
  });

  it('does not prune good backups when the new one does not read back', async () => {
    const { platform, project } = await withFolder();
    await runBackup(project, { now: new Date('2026-10-05T08:00:00Z') });
    const before = await names(platform);
    const write = platform.files.write;
    platform.files.write = async (path, bytes) => {
      const bad = bytes.slice();
      bad[bad.length - 5] = bad[bad.length - 5]! ^ 1; // a flaky drive
      await write(path, bad);
    };
    await expect(runBackup(project, { now: new Date('2026-10-05T09:00:00Z'), force: true })).rejects.toMatchObject({ code: 'ERROR' });
    platform.files.write = write;
    expect(await names(platform)).toEqual(before);
    expect((await backupStatus(project)).lastError?.code).toBe('ERROR');
  });

  it('turns a full disk into DISK_FULL', async () => {
    const { platform, project } = await withFolder();
    platform.files.write = async () => {
      throw new PlatformError('IO', 'No space left on device (os error 28)');
    };
    await expect(runBackup(project)).rejects.toMatchObject({ code: 'DISK_FULL' });
  });

  it('removes half-written files older than an hour, and never touches other projects\' backups', async () => {
    const { platform, project } = await withFolder();
    const theirs = [1, 2, 3, 4].map((d) => `Trama backup ffffff 2020-01-0${d} 080000.trama`);
    for (const n of theirs) await platform.files.write(`/usb/${n}`, utf8('x'));
    await platform.files.write('/usb/notes.txt', utf8('mine'));
    await platform.files.write('/usb/Trama backup abc 2026.trama.tmp', utf8('half'));
    await platform.files.write('/usb/Trama backup def 2026.trama.tmp', utf8('being written'));
    // The memory platform stamps files with the real clock: run the backup two hours "later",
    // after making one temporary file look fresh again.
    const later = Date.now() + 2 * 3600_000;
    const realNow = Date.now;
    Date.now = () => later;
    await platform.files.write('/usb/Trama backup def 2026.trama.tmp', utf8('being written'));
    Date.now = realNow;
    await runBackup(project, { now: new Date(later) });
    const left = await names(platform);
    for (const n of theirs) expect(left).toContain(n);
    expect(left).toContain('notes.txt');
    expect(left).not.toContain('Trama backup abc 2026.trama.tmp');
    expect(left).toContain('Trama backup def 2026.trama.tmp');
  });

  it('lists backups newest first, by tag', async () => {
    const { platform, project } = await withFolder();
    await runBackup(project, { now: new Date(2026, 9, 5, 8, 0, 0) });
    await runBackup(project, { now: new Date(2026, 9, 5, 9, 0, 0), force: true });
    await platform.files.write('/usb/Trama backup ffffff 2026-10-05 100000.trama', utf8('x'));
    const all = await listBackups(platform, '/usb');
    expect(all.map((b) => b.tag)).toEqual(['ffffff', project.backupTag, project.backupTag]);
    const ours = await listBackups(platform, '/usb', project.backupTag);
    expect(ours).toHaveLength(2);
    expect(ours[0]!.at).toBe(new Date(2026, 9, 5, 9, 0, 0).getTime());
    expect(ours[0]!.size).toBeGreaterThan(0);
  });

  it('keeps settings: history length, folder change', async () => {
    const { project } = await withFolder();
    await setBackupHistoryDays(project, 365);
    expect(await project.store.getMeta(META.historyDays)).toBe('365');
    await expect(setBackupHistoryDays(project, 7 as never)).rejects.toThrow();
    await setBackupFolder(project, null);
    expect((await backupStatus(project)).folder).toBeNull();
  });
});

describe('errors and staleness', () => {
  it('turns platform errors into reasons a researcher can act on', () => {
    expect(backupErrorCode(new PlatformError('NOT_FOUND', 'x'))).toBe('FOLDER_MISSING');
    expect(backupErrorCode(new PlatformError('PERMISSION_DENIED', 'x'))).toBe('PERMISSION');
    expect(backupErrorCode(new PlatformError('IO', 'Access is denied. (os error 5)'))).toBe('PERMISSION');
    expect(backupErrorCode(new PlatformError('IO', 'There is not enough space on the disk. (os error 112)'))).toBe('DISK_FULL');
    expect(backupErrorCode(new BackupError('FOLDER_MISSING', 'x'))).toBe('FOLDER_MISSING');
    expect(backupErrorCode(new Error('boom'))).toBe('ERROR');
  });

  it('calls a backup stale after three days', () => {
    const now = new Date('2026-10-05T12:00:00Z');
    expect(backupIsStale({ folder: '/x', lastOk: null, lastError: null, due: true }, now)).toBe(true);
    expect(backupIsStale({ folder: '/x', lastOk: '2026-10-03T12:00:00Z', lastError: null, due: false }, now)).toBe(false);
    expect(backupIsStale({ folder: '/x', lastOk: '2026-10-01T11:00:00Z', lastError: null, due: true }, now)).toBe(true);
  });
});

describe('backup history', () => {
  const tag = 'a1b2c3';
  const at = (d: Date) => backupFileName(tag, d);
  const now = new Date('2026-10-05T12:00:00');

  it('names files with the project tag and seconds, and reads them back', () => {
    expect(backupFileName(tag, new Date(2026, 9, 5, 9, 5, 7))).toBe('Trama backup a1b2c3 2026-10-05 090507.trama');
    expect(parseBackupName('Trama backup a1b2c3 2026-10-05 090507.trama')).toMatchObject({ tag });
    expect(parseBackupName('Trama backup a1b2c3 2026-13-45 090507.trama')).toBeNull();
    expect(parseBackupName('Trama backup notes.trama')).toBeNull();
    expect(parseBackupName('Sala backup a1b2c3 2026-10-05 090507.sala')).toBeNull();
    expect(parseBackupName('')).toBeNull();
  });

  it('keeps everything from the last day, then one a day, a week and a month', () => {
    const files: string[] = [];
    for (let h = 0; h < 400 * 24; h += 2) files.push(at(new Date(now.getTime() - h * 3600_000)));
    const removed = new Set(backupsToPrune(files, { tag, historyDays: 365, now }));
    const kept = files.filter((f) => !removed.has(f)).map((f) => parseBackupName(f)!.at);
    const ages = kept.map((d) => (now.getTime() - d.toMillis()) / 86400_000);
    expect(ages.filter((a) => a < 1)).toHaveLength(10);
    const days = new Set(kept.filter((_, i) => ages[i]! < 14).map((d) => d.toISODate()));
    expect(days.size).toBeGreaterThanOrEqual(14);
    expect(kept.filter((_, i) => ages[i]! >= 1 && ages[i]! < 14).length).toBeLessThanOrEqual(14);
    expect(kept.filter((_, i) => ages[i]! >= 14 && ages[i]! < 56).length).toBeGreaterThanOrEqual(5);
    expect(kept.filter((_, i) => ages[i]! >= 14 && ages[i]! < 56).length).toBeLessThanOrEqual(7);
    expect(kept.filter((_, i) => ages[i]! >= 56).length).toBeGreaterThanOrEqual(9);
    expect(kept.filter((_, i) => ages[i]! >= 56).length).toBeLessThanOrEqual(11);
    expect(Math.max(...ages)).toBeLessThan(365);
    expect(kept.length).toBeLessThan(50);
  });

  it('keeps no more than the chosen history, but always the newest three', () => {
    const files = [1, 5, 20, 40, 100, 200].map((d) => at(new Date(now.getTime() - d * 86400_000)));
    const removed = backupsToPrune(files, { tag, historyDays: 30, now });
    expect(removed.map((n) => parseBackupName(n)!.at.toISODate())).toEqual(['2026-08-26', '2026-06-27', '2026-03-19']);
    const later = new Date('2030-01-01T00:00:00');
    expect(backupsToPrune(files, { tag, historyDays: 30, now: later })).toHaveLength(3);
  });

  it('never removes the file just written, files of other tags, or other files', () => {
    const files = Array.from({ length: 30 }, (_, i) => at(new Date(now.getTime() - i * 60_000)));
    const others = ['Trama backup ffffff 2020-01-01 080000.trama', 'notes.txt', 'Trama backup copy.trama'];
    const keep = files[29]!;
    const removed = backupsToPrune([...files, ...others], { tag, historyDays: 30, now, keep });
    expect(removed).not.toContain(keep);
    for (const o of others) expect(removed).not.toContain(o);
    expect(removed).toHaveLength(30 - 10 - 1); // ten from the last day, plus the one just written
    expect(backupsToPrune([], { tag, historyDays: 30, now })).toEqual([]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { BackupError, type BackupResult, type BackupStatus } from '../../services/backup';
import { PlatformError } from '../../platform/types';
import { BackupRunner } from './backupRunner';

interface Fake {
  isOpen: boolean;
}

function setup(over: { status?: Partial<BackupStatus>; run?: (opts: { force: boolean }) => Promise<BackupResult> } = {}) {
  const project: Fake = { isOpen: true };
  const status = vi.fn(async (): Promise<BackupStatus> => ({ folder: '/usb', lastOk: null, lastError: null, due: true, ...over.status }));
  const run = vi.fn(over.run ?? (async () => ({ written: true as const, path: '/usb/x.trama', name: 'x.trama' })));
  const runner = new BackupRunner<Fake>({ status, run: (_p, opts) => run(opts) });
  return { project, status, run, runner };
}

const deferred = () => {
  let resolve!: (r: BackupResult) => void;
  const promise = new Promise<BackupResult>((r) => (resolve = r));
  return { promise, resolve };
};

describe('BackupRunner', () => {
  it('runs a scheduled backup only when a folder is set and one is due', async () => {
    let s = setup({ status: { due: false } });
    expect(await s.runner.request(s.project, 'hourly')).toEqual({ kind: 'skipped', reason: 'notDue' });
    expect(s.run).not.toHaveBeenCalled();

    s = setup({ status: { folder: null, due: false } });
    expect(await s.runner.request(s.project, 'open')).toEqual({ kind: 'skipped', reason: 'noFolder' });

    s = setup();
    expect(await s.runner.request(s.project, 'open')).toEqual({ kind: 'written', name: 'x.trama' });
    expect(s.run).toHaveBeenCalledWith({ force: false });
    expect(s.runner.last).toEqual({ kind: 'written', name: 'x.trama' });
  });

  it('makes a final backup even when not due, without forcing (unchanged projects are skipped)', async () => {
    const s = setup({ status: { due: false }, run: async () => ({ written: false, reason: 'unchanged' }) });
    expect(await s.runner.request(s.project, 'ifChanged')).toEqual({ kind: 'unchanged' });
    expect(s.run).toHaveBeenCalledWith({ force: false });
  });

  it('forces Back up now and does not look at the schedule', async () => {
    const s = setup({ status: { due: false } });
    await s.runner.request(s.project, 'manual');
    expect(s.status).not.toHaveBeenCalled();
    expect(s.run).toHaveBeenCalledWith({ force: true });
  });

  it('never runs two at once: scheduled requests share the running one, manual waits then runs', async () => {
    const first = deferred();
    const s = setup();
    s.run.mockImplementationOnce(() => first.promise);
    const events: boolean[] = [];
    s.runner.subscribe(() => events.push(s.runner.running));
    const a = s.runner.request(s.project, 'open');
    const b = s.runner.request(s.project, 'ifChanged');
    expect(b).toBe(a);
    const c = s.runner.request(s.project, 'manual');
    await Promise.resolve();
    await Promise.resolve();
    expect(s.run).toHaveBeenCalledTimes(1);
    expect(s.runner.running).toBe(true);
    first.resolve({ written: true, path: '/usb/1.trama', name: '1.trama' });
    expect(await a).toEqual({ kind: 'written', name: '1.trama' });
    expect(await c).toEqual({ kind: 'written', name: 'x.trama' });
    expect(s.run).toHaveBeenCalledTimes(2);
    expect(s.run.mock.calls[1]![0]).toEqual({ force: true });
    expect(s.runner.running).toBe(false);
    expect(events).toEqual([true, false, true, false]);
  });

  it('turns failures into a code the screen can explain', async () => {
    const s = setup({ run: async () => Promise.reject(new BackupError('FOLDER_MISSING', 'gone')) });
    expect(await s.runner.request(s.project, 'hourly')).toMatchObject({ kind: 'failed', code: 'FOLDER_MISSING' });
    const d = setup({ run: async () => Promise.reject(new PlatformError('IO', 'No space left on device (os error 28)')) });
    expect(await d.runner.request(d.project, 'manual')).toMatchObject({ kind: 'failed', code: 'DISK_FULL' });
    expect(d.runner.last).toMatchObject({ kind: 'failed', code: 'DISK_FULL' });
  });

  it('stays quiet when the project closed, or in the example', async () => {
    const s = setup({ run: async () => Promise.reject(new BackupError('EXAMPLE', 'no')) });
    expect(await s.runner.request(s.project, 'manual')).toEqual({ kind: 'skipped', reason: 'example' });
    const c = setup();
    c.project.isOpen = false;
    expect(await c.runner.request(c.project, 'ifChanged')).toEqual({ kind: 'skipped', reason: 'closed' });
    const l = setup({ run: async () => Promise.reject(new BackupError('LOCKED', 'closed')) });
    expect(await l.runner.request(l.project, 'ifChanged')).toEqual({ kind: 'skipped', reason: 'closed' });
    const sk = setup();
    sk.runner.skip(sk.project);
    expect(await sk.runner.request(sk.project, 'manual')).toEqual({ kind: 'skipped', reason: 'closed' });
    const st = setup();
    st.status.mockRejectedValueOnce(new Error('db closed'));
    expect(await st.runner.request(st.project, 'hourly')).toEqual({ kind: 'skipped', reason: 'closed' });
  });
});

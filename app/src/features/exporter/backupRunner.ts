import { BackupError, type BackupErrorCode, backupErrorCode, type BackupResult, type BackupStatus, backupStatus, runBackup } from '../../services/backup';
import type { Project } from '../../services/project';

// One place that runs backups of the open project, so that the scheduler (on open, hourly, on
// lock) and "Back up now" never write two at once, and the Project screen hears when one starts
// and ends. Backups themselves are services/backup.ts; this decides when, and serialises.

/** Why a backup was asked for. */
export type BackupTrigger = 'open' | 'hourly' | 'ifChanged' | 'manual';

export type BackupOutcome =
  | { kind: 'written'; name: string }
  | { kind: 'unchanged' }
  | { kind: 'skipped'; reason: 'notDue' | 'noFolder' | 'example' | 'closed' }
  | { kind: 'failed'; code: BackupErrorCode; message: string };

interface RunnableProject {
  readonly isOpen: boolean;
}

export interface RunnerDeps<P extends RunnableProject> {
  status: (project: P) => Promise<BackupStatus>;
  run: (project: P, opts: { force: boolean }) => Promise<BackupResult>;
}

export class BackupRunner<P extends RunnableProject> {
  private current: Promise<BackupOutcome> | null = null;
  private active = 0;
  private listeners = new Set<() => void>();
  private version = 0;
  private skipped = new WeakSet<P>();
  /** The outcome of the last run that did something (wrote, or failed). */
  last: BackupOutcome | null = null;

  constructor(private readonly deps: RunnerDeps<P>) {}

  /** No more backups of this project (it is about to be deleted). */
  skip(project: P): void {
    this.skipped.add(project);
  }

  /** True while a backup is being written. */
  get running(): boolean {
    return this.active > 0;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  /** Changes whenever a run starts or ends (for useSyncExternalStore). */
  getVersion = (): number => this.version;

  private emit(): void {
    this.version++;
    for (const fn of [...this.listeners]) fn();
  }

  /**
   * Runs a backup when the trigger calls for one. Scheduled and final requests made while one
   * is running share it; "Back up now" waits for it, then makes its own (forced) backup.
   *
   * - open / hourly: only when a folder is set and a backup is due (a day old, or the last failed);
   * - ifChanged (lock, close, a new folder): when a folder is set and anything changed since
   *   the last backup (or that backup is not in the folder);
   * - manual: always, even when nothing changed.
   */
  request(project: P, trigger: BackupTrigger): Promise<BackupOutcome> {
    if (this.current && trigger !== 'manual') return this.current;
    const before = this.current;
    const run = (before ? before.then(noop, noop) : Promise.resolve()).then(() => this.runOnce(project, trigger));
    this.current = run;
    const settle = () => {
      if (this.current === run) this.current = null;
    };
    void run.then(settle, settle);
    return run;
  }

  private async runOnce(project: P, trigger: BackupTrigger): Promise<BackupOutcome> {
    if (!project.isOpen || this.skipped.has(project)) return { kind: 'skipped', reason: 'closed' };
    try {
      if (trigger !== 'manual') {
        const status = await this.deps.status(project);
        if (!status.folder) return { kind: 'skipped', reason: 'noFolder' };
        if (trigger !== 'ifChanged' && !status.due) return { kind: 'skipped', reason: 'notDue' };
      }
    } catch {
      // The store closed under us (a lock): nothing to do.
      return { kind: 'skipped', reason: 'closed' };
    }
    this.active++;
    this.emit();
    let outcome: BackupOutcome;
    try {
      const result = await this.deps.run(project, { force: trigger === 'manual' });
      outcome = result.written ? { kind: 'written', name: result.name } : { kind: 'unchanged' };
    } catch (e) {
      outcome = classify(e, project);
    } finally {
      this.active--;
    }
    if (outcome.kind === 'written' || outcome.kind === 'failed') this.last = outcome;
    this.emit();
    return outcome;
  }
}

function classify(e: unknown, project: RunnableProject): BackupOutcome {
  if (e instanceof BackupError) {
    if (e.code === 'NO_FOLDER') return { kind: 'skipped', reason: 'noFolder' };
    if (e.code === 'EXAMPLE') return { kind: 'skipped', reason: 'example' };
    if (e.code === 'LOCKED') return { kind: 'skipped', reason: 'closed' };
  }
  if (!project.isOpen) return { kind: 'skipped', reason: 'closed' };
  return { kind: 'failed', code: backupErrorCode(e), message: e instanceof Error ? e.message : String(e) };
}

const noop = () => undefined;

/** The app's runner: one project is open at a time. */
export const backupRunner = new BackupRunner<Project>({
  status: (project) => backupStatus(project),
  run: (project, opts) => runBackup(project, opts),
});

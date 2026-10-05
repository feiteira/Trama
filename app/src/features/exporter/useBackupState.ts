import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { type BackupStatus, backupStatus } from '../../services/backup';
import { useAppState, useProject } from '../../shell/AppState';
import { backupRunner } from './backupRunner';
import { backupView, type BackupView } from './backupView';

/**
 * The open project's backup status, kept current: re-read whenever a backup starts or ends
 * (scheduled or not) and every minute, so "an hour ago" and "next backup" stay true.
 */
export function useBackupState(): { status: BackupStatus | null; view: BackupView | null; running: boolean; reload: () => void } {
  const project = useProject();
  const { example } = useAppState();
  const version = useSyncExternalStore(backupRunner.subscribe, backupRunner.getVersion);
  const running = backupRunner.running;
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let live = true;
    if (!project.isOpen) return;
    backupStatus(project)
      .then((s) => live && setStatus(s))
      .catch((e: unknown) => {
        if (project.isOpen) console.error('reading the backup status failed', e);
      });
    return () => {
      live = false;
    };
  }, [project, version, tick]);

  const view = status ? backupView(status, { now: new Date(), example, running }) : null;
  return { status, view, running, reload };
}

import { useEffect, useRef } from 'react';
import { type BackupOutcome, backupRunner, type BackupTrigger } from '../features/exporter/backupRunner';
import { BACKUP_ERROR_MESSAGE, CHECK_EVERY_MS } from '../features/exporter/backupView';
import { useToast } from '../ui/components/Toast';
import { useI18n } from '../ui/i18n';
import { SAVE_STAGE, useAppState, useProject, useRegisterSaver } from './AppState';
import { useRouter } from './router';

/** Opening a project should feel instant: the first check waits a moment. */
const FIRST_CHECK_MS = 4000;
/** A final backup of a large project with recordings can take a while. */
const FINAL_LIMIT_MS = 120_000;

/**
 * Automatic backups of the open project (renders nothing). Looks whether a backup is due when
 * the project opens and every hour, and makes a last one when the project is locked or closed
 * if anything changed. Only once a backup folder is chosen; never in the example. Runs go
 * through `backupRunner`, so two never overlap and the Project screen follows along.
 */
export function BackupScheduler() {
  const project = useProject();
  const { example } = useAppState();
  const { t } = useI18n();
  const toast = useToast();
  const { go } = useRouter();
  // One toast per kind of failure: an hourly retry that fails the same way stays quiet.
  const lastToasted = useRef<string | null>(null);
  const latest = useRef({ t, toast, go });
  latest.current = { t, toast, go };

  const run = useRef<(trigger: BackupTrigger) => Promise<BackupOutcome | null>>(async () => null);
  run.current = async (trigger) => {
    if (example) return null;
    const outcome = await backupRunner.request(project, trigger);
    if (outcome.kind === 'written' || outcome.kind === 'unchanged') lastToasted.current = null;
    if (outcome.kind === 'failed' && trigger !== 'ifChanged' && lastToasted.current !== outcome.code) {
      lastToasted.current = outcome.code;
      const { t: tr, toast: show, go: navigate } = latest.current;
      show.show({
        message: tr('exporter.backups.toastFailed', { reason: tr(BACKUP_ERROR_MESSAGE[outcome.code]) }),
        durationMs: 10_000,
        action: { label: tr('exporter.backups.toastDetails'), run: () => navigate({ name: 'project' }), testId: 'backup-failed-details' },
      });
    }
    return outcome;
  };

  useEffect(() => {
    if (example) return;
    const first = setTimeout(() => void run.current('open'), FIRST_CHECK_MS);
    const hourly = setInterval(() => void run.current('hourly'), CHECK_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(hourly);
    };
  }, [project, example]);

  useRegisterSaver(
    async () => {
      await run.current('ifChanged');
    },
    { stage: SAVE_STAGE.backup, limitMs: FINAL_LIMIT_MS },
  );

  return null;
}

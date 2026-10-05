import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { ArchiveRestore, CircleAlert, CircleCheck, Clock3, FileUp, FolderOpen, HardDrive, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { DecryptError } from '../../core/crypto/frames';
import { type SlotKind, WrongSecretError } from '../../core/crypto/keyring';
import { protectionOf, UnlockRequiredError } from '../../core/export/trama';
import {
  type BackupFile, backupHistoryDays, HISTORY_DAYS, type HistoryDays, listBackups, restoreBackup, setBackupFolder, setBackupHistoryDays,
} from '../../services/backup';
import { useAppState, useHold, useLibrary, useProject } from '../../shell/AppState';
import { useRouter } from '../../shell/router';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import { Button, IconButton } from '../../ui/components/Button';
import { useConfirm } from '../../ui/components/Confirm';
import { Badge, Notice, Spinner } from '../../ui/components/Feedback';
import { Select } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { backupRunner } from './backupRunner';
import { BACKUP_ERROR_MESSAGE, type BackupView, folderLabel, groupBackups } from './backupView';
import { formatBytes } from './report';
import { RestoreUnlockDialog } from './RestoreUnlockDialog';
import { useBackupState } from './useBackupState';

const STATE_ICON = { example: HardDrive, off: TriangleAlert, running: Clock3, never: Clock3, ok: CircleCheck, stale: TriangleAlert, failed: CircleAlert } as const;

interface Listing {
  folder: string;
  files: BackupFile[] | null;
  error: string | null;
}

export function Backups() {
  const { t, tp, relative, date, time, meta } = useI18n();
  const project = useProject();
  const library = useLibrary();
  const { platform, example, runSavers, enterProject } = useAppState();
  const { go } = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { status, view, running, reload } = useBackupState();
  const [history, setHistory] = useState<HistoryDays | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const [showOthers, setShowOthers] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [unlock, setUnlock] = useState<{ bytes: Uint8Array; label: string } | null>(null);
  useHold(restoring);

  const folder = status?.folder ?? null;
  const lastOk = status?.lastOk ?? null;

  useEffect(() => {
    void backupHistoryDays(project.store).then(setHistory, () => undefined);
  }, [project]);

  // The folder's backups, re-read when the folder changes, after each backup, and on Refresh.
  useEffect(() => {
    if (!folder || example) {
      setListing(null);
      return;
    }
    let live = true;
    setListing((cur) => (cur?.folder === folder ? cur : { folder, files: null, error: null }));
    listBackups(platform, folder)
      .then((files) => live && setListing({ folder, files, error: null }))
      .catch((e: unknown) => live && setListing({ folder, files: [], error: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [platform, folder, example, lastOk, running, listVersion]);

  const groups = useMemo(() => groupBackups(listing?.files ?? [], project.backupTag), [listing, project.backupTag]);

  async function chooseFolder() {
    const picked = await platform.dialogs.pickFolder(t('exporter.backups.pickTitle'));
    if (!picked) return;
    await setBackupFolder(project, picked);
    reload();
    toast.show({ message: t('exporter.backups.folderSet', { name: folderLabel(picked) }), tone: 'success' });
    // A new folder gets its first backup now, not a day later.
    const outcome = await backupRunner.request(project, 'ifChanged');
    if (outcome.kind === 'failed') reload();
  }

  async function stopBackups() {
    const ok = await confirm({ title: t('exporter.backups.stopTitle'), body: t('exporter.backups.stopBody'), confirmLabel: t('exporter.backups.stopConfirm'), 'data-testid': 'stop-backups-dialog' });
    if (!ok) return;
    await setBackupFolder(project, null);
    reload();
    toast.show(t('exporter.backups.stopped'));
  }

  async function backUpNow() {
    const outcome = await backupRunner.request(project, 'manual');
    if (outcome.kind === 'written') toast.show({ message: t('exporter.backups.done'), tone: 'success' });
    else if (outcome.kind === 'failed') toast.show({ message: t('exporter.backups.toastFailed', { reason: t(BACKUP_ERROR_MESSAGE[outcome.code]) }), tone: 'danger' });
  }

  async function changeHistory(days: HistoryDays) {
    setHistory(days);
    await setBackupHistoryDays(project, days).catch((e: unknown) => toast.error(e));
  }

  const whenOf = (ms: number) => {
    const dt = DateTime.fromMillis(ms);
    return `${date(dt, 'medium')}, ${time(dt)}`;
  };

  /** Restores bytes as a new project of the library; this one stays open. Offers to open the new one. */
  const restoreBytes = useCallback(
    async (bytes: Uint8Array, slot?: SlotKind, secret?: string): Promise<'done' | 'unlock' | 'wrong'> => {
      setRestoring(true);
      try {
        await runSavers();
        const restored = await restoreBackup(library, bytes, slot, secret, {
          open: false,
          // A plain date (yyyy-mm-dd): it ends up in a project name, read in any language.
          restoredName: (name, at) => t('exporter.backups.restore.restoredName', { name, date: DateTime.fromJSDate(at).toISODate() ?? '' }),
        });
        toast.show({
          message: t('exporter.backups.restore.done', { name: restored.name }),
          tone: 'success',
          durationMs: 10_000,
          action: {
            label: t('exporter.backups.restore.openNow'),
            testId: 'restore-open-now',
            run: async () => {
              try {
                await runSavers();
                enterProject(await library.openProject(restored.id), { name: 'project' });
              } catch (e) {
                toast.error(e);
              }
            },
          },
        });
        return 'done';
      } catch (e) {
        if (e instanceof UnlockRequiredError) return 'unlock';
        if (slot && (e instanceof WrongSecretError || e instanceof DecryptError)) return 'wrong';
        console.error('restoring a backup failed', e);
        toast.show({ message: t('exporter.backups.restore.failed', { message: e instanceof Error ? e.message : String(e) }), tone: 'danger' });
        return 'done';
      } finally {
        setRestoring(false);
      }
    },
    [library, runSavers, enterProject, toast, t],
  );

  async function startRestore(bytes: Uint8Array, body: string) {
    let kind: ReturnType<typeof protectionOf>;
    try {
      kind = protectionOf(bytes);
    } catch {
      toast.show({ message: t('exporter.backups.restore.notTrama'), tone: 'danger' });
      return;
    }
    if (kind !== 'library-key') {
      toast.show({ message: t('exporter.backups.restore.notBackup'), action: { label: t('exporter.backups.restore.goImport'), run: () => go({ name: 'import' }) }, durationMs: 10_000 });
      return;
    }
    const ok = await confirm({ title: t('exporter.backups.restore.confirmTitle'), body, confirmLabel: t('exporter.backups.restore.confirm'), 'data-testid': 'restore-dialog' });
    if (!ok) return;
    const result = await restoreBytes(bytes);
    if (result === 'unlock') setUnlock({ bytes, label: body });
  }

  async function restoreFile(f: BackupFile) {
    try {
      const bytes = await platform.files.read(f.path);
      await startRestore(bytes, t('exporter.backups.restore.confirmBody', { when: whenOf(f.at) }));
    } catch (e) {
      toast.error(e);
    }
  }

  async function restoreFromFile() {
    const [path] = await platform.dialogs.pickFiles(t('exporter.backups.restore.pickTitle'), [{ name: t('exporter.backups.restore.fileType'), extensions: ['trama'] }], false);
    if (!path) return;
    try {
      const bytes = await platform.files.read(path);
      await startRestore(bytes, t('exporter.backups.restore.confirmFileBody', { file: path.split(/[\\/]/).pop() || path }));
    } catch (e) {
      toast.error(e);
    }
  }

  if (!view) {
    return (
      <div className="proj__loading">
        <Spinner size={18} label={t('common.loading')} />
      </div>
    );
  }

  const rows = showOthers ? [...groups.mine, ...groups.others] : groups.mine;

  return (
    <div className="bk">
      <p className="proj__lead">
        <ShieldCheck size={15} aria-hidden strokeWidth={1.75} className="proj__lead-icon" />
        <span>{t('exporter.backups.intro')}</span>
      </p>

      <StatusCard view={view} onBackUp={() => void backUpNow()} onChoose={() => void chooseFolder()} />

      {view.state !== 'example' ? (
        <section className="bk__settings" aria-label={t('exporter.backups.title')}>
          <div className="bk__row">
            <div className="bk__row-text">
              <span className="bk__label">{t('exporter.backups.folder')}</span>
              {folder ? (
                <span className="bk__folder" title={folder} data-testid="backup-folder">
                  <FolderOpen size={14} aria-hidden strokeWidth={1.75} />
                  <span className="bk__folder-path">
                    <span dir="ltr">{folder}</span>
                  </span>
                </span>
              ) : (
                <span className="bk__muted">{t('exporter.backups.noFolder')}</span>
              )}
            </div>
            <div className="bk__row-actions">
              {folder ? (
                <Button variant="ghost" size="sm" onClick={() => void stopBackups()} data-testid="backup-stop">
                  {t('exporter.backups.stop')}
                </Button>
              ) : null}
              {folder ? (
                <Button variant="secondary" size="sm" icon={FolderOpen} onClick={() => void chooseFolder()} data-testid="backup-choose">
                  {t('exporter.backups.change')}
                </Button>
              ) : null}
            </div>
          </div>
          <div className="bk__row">
            <div className="bk__row-text">
              <span className="bk__label" id="bk-history">
                {t('exporter.backups.history')}
              </span>
              <span className="bk__muted">{t('exporter.backups.historyHint')}</span>
            </div>
            <div className="bk__row-actions">
              <Select<string>
                aria-labelledby="bk-history"
                value={String(history ?? 90)}
                onChange={(v) => void changeHistory(Number(v) as HistoryDays)}
                options={HISTORY_DAYS.map((d) => ({ value: String(d), label: t(`exporter.backups.historyOption.d${d}`) }))}
                size="sm"
                data-testid="backup-history"
              />
            </div>
          </div>
        </section>
      ) : null}

      {folder && view.state !== 'example' ? (
        <section className="bk__list" aria-labelledby="bk-list-title">
          <div className="bk__list-head">
            <h2 className="proj__h2" id="bk-list-title">
              {t('exporter.backups.list.title')}
            </h2>
            <IconButton icon={RefreshCw} label={t('exporter.backups.list.refresh')} size="sm" onClick={() => setListVersion((n) => n + 1)} data-testid="backup-list-refresh" />
          </div>
          {listing?.error ? (
            <Notice tone="warning">{t('exporter.backups.list.unreadable', { reason: listing.error })}</Notice>
          ) : !listing?.files ? (
            <div className="proj__loading">
              <Spinner size={16} label={t('common.loading')} />
            </div>
          ) : rows.length === 0 && groups.others.length === 0 ? (
            <p className="bk__empty">{t('exporter.backups.list.empty')}</p>
          ) : (
            <div className="bk__table-wrap">
              <table className="bk__table" aria-labelledby="bk-list-title" data-testid="backup-list">
                <thead>
                  <tr>
                    <th>{t('exporter.backups.list.made')}</th>
                    <th>{t('exporter.backups.list.project')}</th>
                    <th className="bk__num">{t('exporter.backups.list.size')}</th>
                    <th className="bk__act">
                      <span className="visually-hidden">{t('exporter.backups.list.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="bk__muted">
                        {t('exporter.backups.list.empty')}
                      </td>
                    </tr>
                  ) : null}
                  {rows.map((f) => {
                    const mine = f.tag === project.backupTag;
                    return (
                      <tr key={f.path} data-testid="backup-row">
                        <td>
                          <span className="bk__when">{whenOf(f.at)}</span>
                          <span className="bk__ago">{relative(DateTime.fromMillis(f.at).toISO())}</span>
                        </td>
                        <td>{mine ? <Badge tone="success">{t('exporter.backups.list.thisProject')}</Badge> : <span className="bk__muted">{t('exporter.backups.list.other')}</span>}</td>
                        <td className="bk__num">{formatBytes(f.size, meta.bcp47)}</td>
                        <td className="bk__act">
                          <Button size="sm" variant="ghost" icon={ArchiveRestore} onClick={() => void restoreFile(f)} disabled={restoring} aria-label={t('exporter.backups.list.restoreLabel', { when: whenOf(f.at) })} data-testid="backup-restore">
                            {t('exporter.backups.list.restore')}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {groups.others.length ? (
            <button type="button" className="xp__link bk__others" onClick={() => setShowOthers((s) => !s)} aria-expanded={showOthers} data-testid="backup-show-others">
              {showOthers ? t('exporter.backups.list.hideOthers') : tp('exporter.backups.list.showOthers', groups.others.length)}
            </button>
          ) : null}
        </section>
      ) : null}

      <div className="bk__restore">
        <Button variant="ghost" icon={FileUp} onClick={() => void restoreFromFile()} busy={restoring} data-testid="restore-from-file">
          {restoring ? t('exporter.backups.restore.restoring') : t('exporter.backups.restore.fromFile')}
        </Button>
      </div>

      <RestoreUnlockDialog
        open={unlock !== null}
        onClose={() => setUnlock(null)}
        onSubmit={async (slot, secret) => {
          if (!unlock) return 'done';
          const r = await restoreBytes(unlock.bytes, slot, secret);
          if (r !== 'wrong') setUnlock(null);
          return r;
        }}
      />
    </div>
  );
}

function StatusCard({ view, onBackUp, onChoose }: { view: BackupView; onBackUp: () => void; onChoose: () => void }) {
  const { t, relative, date, time } = useI18n();
  const Icon = STATE_ICON[view.state];
  const when = (iso: string) => {
    const dt = DateTime.fromISO(iso);
    return `${date(dt, 'weekday')}, ${time(dt)}`;
  };

  let title: string;
  let body: string;
  switch (view.state) {
    case 'ok':
      title = t('exporter.backups.status.ok', { when: relative(view.lastOk) });
      body = t('exporter.backups.status.okBody');
      break;
    case 'stale':
      title = t('exporter.backups.status.stale', { when: relative(view.lastOk) });
      body = t('exporter.backups.status.staleBody', { n: view.days });
      break;
    case 'failed':
      title = t('exporter.backups.status.failed');
      body = `${t(BACKUP_ERROR_MESSAGE[view.code])} ${t('exporter.backups.status.failedAt', { when: relative(view.failedAt) })}`;
      break;
    default:
      title = t(`exporter.backups.status.${view.state}`);
      body = t(`exporter.backups.status.${view.state}Body`);
  }

  const lastOk = 'lastOk' in view ? view.lastOk : null;
  const nextDue = 'nextDue' in view ? view.nextDue : null;
  const canBackUp = view.state !== 'example' && view.state !== 'off';

  return (
    <section className={cx('bk__status', `bk__status--${view.tone}`)} aria-live="polite" data-testid="backup-status" data-state={view.state}>
      <div className="bk__status-main">
        <span className="bk__status-icon" aria-hidden>
          {view.state === 'running' ? <Spinner size={18} /> : <Icon size={19} strokeWidth={1.75} />}
        </span>
        <div className="bk__status-text">
          <h2 className="bk__status-title">{title}</h2>
          <p className="bk__status-body">{body}</p>
        </div>
        <div className="bk__status-action">
          {canBackUp ? (
            <Button variant={view.state === 'failed' || view.state === 'stale' ? 'primary' : 'secondary'} onClick={onBackUp} busy={view.state === 'running'} data-testid="backup-now">
              {view.state === 'running' ? t('exporter.backups.running') : t('exporter.backups.now')}
            </Button>
          ) : view.state === 'off' ? (
            <Button variant="primary" icon={FolderOpen} onClick={onChoose} data-testid="backup-choose-main">
              {t('exporter.backups.choose')}
            </Button>
          ) : null}
        </div>
      </div>
      {canBackUp ? (
        <dl className="bk__facts">
          <div>
            <dt>{t('exporter.backups.last')}</dt>
            <dd>{lastOk ? when(lastOk) : t('exporter.backups.never')}</dd>
          </div>
          <div>
            <dt>{t('exporter.backups.next')}</dt>
            <dd>{nextDue === null ? '—' : nextDue === 'soon' ? t('exporter.backups.soon') : when(nextDue)}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}

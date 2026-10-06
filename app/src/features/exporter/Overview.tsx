import React, { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { ChevronRight, CircleAlert, CircleCheck, Clock3, HardDrive, Trash2, TriangleAlert } from 'lucide-react';
import { LIMITS } from '../../core/model/types';
import { projectSummary, type ProjectSummary } from '../../services/queries';
import { useAppState, useLibrary, useProject } from '../../shell/AppState';
import { initial } from '../../shell/initial';
import { useLive } from '../../shell/useLive';
import { inkOn } from '../../ui/color';
import { cx } from '../../ui/cx';
import { useI18n, type PluralKey } from '../../ui/i18n';
import { Button } from '../../ui/components/Button';
import { useConfirm } from '../../ui/components/Confirm';
import { Spinner } from '../../ui/components/Feedback';
import { TextArea, TextField } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { backupRunner } from './backupRunner';
import { useBackupState } from './useBackupState';
import { attachedBytes, formatBytes } from './report';
import { forgetProjectPrefs } from '../common/localPrefs';

interface OverviewData {
  summary: ProjectSummary;
  files: number;
}

const STATS: { key: keyof ProjectSummary; label: PluralKey }[] = [
  { key: 'documents', label: 'exporter.overview.stat.documents' },
  { key: 'codes', label: 'exporter.overview.stat.codes' },
  { key: 'codings', label: 'exporter.overview.stat.codings' },
  { key: 'memos', label: 'exporter.overview.stat.memos' },
  { key: 'cases', label: 'exporter.overview.stat.cases' },
  { key: 'coders', label: 'exporter.overview.stat.coders' },
];

export function Overview({ onOpenBackups }: { onOpenBackups: () => void }) {
  const { t, tp, meta, date, relative } = useI18n();
  const project = useProject();
  const { data } = useLive<OverviewData>(
    async (store) => {
      const [summary, docs] = await Promise.all([projectSummary(project), store.list('document')]);
      return { summary, files: attachedBytes(docs) };
    },
    [],
    ['document', 'code', 'coding', 'memo', 'case', 'coder', 'log'],
  );
  const nf = useMemo(() => new Intl.NumberFormat(meta.bcp47), [meta.bcp47]);
  const created = DateTime.fromISO(project.info.created_at);

  return (
    <div className="ov">
      <Details />

      <section className="ov__contents" aria-labelledby="ov-contents">
        <h2 className="proj__h2" id="ov-contents">
          {t('exporter.overview.contents')}
        </h2>
        {!data ? (
          <div className="proj__loading">
            <Spinner size={18} label={t('common.loading')} />
          </div>
        ) : (
          <>
            <ul className="ov__stats" data-testid="project-stats">
              {STATS.map((s) => {
                const n = data.summary[s.key] as number;
                return (
                  <li key={s.key} className="ov__stat" data-testid={`stat-${s.key}`}>
                    <span className="ov__stat-n">{nf.format(n)}</span>
                    <span className="ov__stat-label">{tp(s.label, n)}</span>
                  </li>
                );
              })}
            </ul>
            <ul className="ov__facts">
              <li>
                <span className="ov__bar" aria-hidden>
                  <span style={{ width: `${data.summary.documents ? Math.round((data.summary.codedDocuments / data.summary.documents) * 100) : 0}%` }} />
                </span>
                {t('exporter.overview.coded', { coded: nf.format(data.summary.codedDocuments), total: nf.format(data.summary.documents) })}
              </li>
              <li>{t('exporter.overview.text', { n: nf.format(data.summary.chars) })}</li>
              <li>{data.files ? t('exporter.overview.files', { size: formatBytes(data.files, meta.bcp47) }) : t('exporter.overview.noFiles')}</li>
            </ul>
            <p className="ov__dates">
              <span>{t('exporter.overview.created', { date: created.isValid ? date(created, 'long') : '—' })}</span>
              <span aria-hidden>·</span>
              <span>{data.summary.lastActivity ? t('exporter.overview.lastChange', { when: relative(data.summary.lastActivity) }) : t('exporter.overview.noChange')}</span>
            </p>
          </>
        )}
      </section>

      <BackupSummary onOpen={onOpenBackups} />
      <DangerZone />
    </div>
  );
}

/** Name and description, edited in place and saved together. */
function Details() {
  const { t } = useI18n();
  const project = useProject();
  const library = useLibrary();
  const toast = useToast();
  const [saved, setSaved] = useState({ name: project.info.name, description: project.info.description });
  const [name, setName] = useState(saved.name);
  const [description, setDescription] = useState(saved.description);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = name !== saved.name || description !== saved.description;
  const color = project.info.color;

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return setError(t('exporter.overview.nameRequired'));
    if (trimmed.length > LIMITS.nameMax) return setError(t('exporter.overview.nameTooLong', { n: LIMITS.nameMax }));
    setBusy(true);
    try {
      const next = await library.updateProject(project.id, { name: trimmed, description });
      setSaved({ name: next.name, description: next.description });
      setName(next.name);
      setDescription(next.description);
      setError(null);
      // The rail and window title follow through Library.subscribe ('update').
      toast.show({ message: t('exporter.overview.saved'), tone: 'success' });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  const discard = () => {
    setName(saved.name);
    setDescription(saved.description);
    setError(null);
  };

  return (
    <form
      className="ov__details"
      aria-labelledby="ov-details"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) void save();
      }}
      data-testid="project-details"
    >
      <div className="ov__mark" style={{ background: color, color: inkOn(color) }} aria-hidden>
        {initial(name || saved.name)}
      </div>
      <div className="ov__fields">
        <h2 className="visually-hidden" id="ov-details">
          {t('exporter.overview.details')}
        </h2>
        <TextField
          label={t('exporter.overview.name')}
          value={name}
          onChange={(v) => {
            setName(v);
            setError(null);
          }}
          error={error ?? undefined}
          maxLength={LIMITS.nameMax + 20}
          size="lg"
          fieldClassName="ov__name"
          data-testid="project-name"
        />
        <TextArea
          label={t('exporter.overview.description')}
          value={description}
          onChange={setDescription}
          placeholder={t('exporter.overview.descriptionPlaceholder')}
          hint={t('exporter.overview.descriptionHint')}
          autoGrow
          minHeight={64}
          maxHeight={240}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && dirty) {
              e.preventDefault();
              void save();
            }
          }}
          data-testid="project-description"
        />
        <div className={cx('ov__actions', dirty && 'ov__actions--shown')} aria-hidden={!dirty}>
          <Button variant="ghost" onClick={discard} disabled={!dirty || busy} tabIndex={dirty ? 0 : -1} data-testid="project-details-discard">
            {t('exporter.overview.discard')}
          </Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!dirty} tabIndex={dirty ? 0 : -1} data-testid="project-details-save">
            {t('exporter.overview.save')}
          </Button>
        </div>
      </div>
    </form>
  );
}

const STATE_ICON = { example: HardDrive, off: TriangleAlert, running: Clock3, never: Clock3, ok: CircleCheck, stale: TriangleAlert, failed: CircleAlert } as const;

/** One line about backups, leading to the Backups section. */
function BackupSummary({ onOpen }: { onOpen: () => void }) {
  const { t, relative } = useI18n();
  const { view } = useBackupState();
  if (!view) return null;
  const Icon = STATE_ICON[view.state];
  const title =
    view.state === 'ok'
      ? t('exporter.backups.status.ok', { when: relative(view.lastOk) })
      : view.state === 'stale'
        ? t('exporter.backups.status.stale', { when: relative(view.lastOk) })
        : t(`exporter.backups.status.${view.state}`);
  return (
    <button type="button" className={cx('ov__backup', `ov__backup--${view.tone}`)} onClick={onOpen} data-testid="overview-backup">
      <span className="ov__backup-icon" aria-hidden>
        {view.state === 'running' ? <Spinner size={16} /> : <Icon size={17} strokeWidth={1.75} />}
      </span>
      <span className="ov__backup-text">
        <span className="ov__backup-label">{t('exporter.overview.backup')}</span>
        <span className="ov__backup-title">{title}</span>
      </span>
      <span className="ov__backup-go">
        {t('exporter.overview.backupOpen')}
        <ChevronRight size={15} aria-hidden />
      </span>
    </button>
  );
}

function DangerZone() {
  const { t } = useI18n();
  const project = useProject();
  const library = useLibrary();
  const { example, runSavers, closeProject } = useAppState();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function remove() {
    const name = project.info.name;
    const ok = await confirm({
      title: t('exporter.danger.confirmTitle', { name }),
      body: t('exporter.danger.confirmBody'),
      confirmLabel: t('exporter.danger.confirm'),
      danger: true,
      typeToConfirm: name,
      typePrompt: t('exporter.danger.confirmType', { name }),
      'data-testid': 'delete-project-dialog',
    });
    if (!ok) return;
    setBusy(true);
    try {
      // Pending edits are written first (a project about to go needs no last backup); then the
      // project goes and the list of projects shows, already without it.
      backupRunner.skip(project);
      await runSavers();
      await library.deleteProject(project.id);
      forgetProjectPrefs(project.id);
      await closeProject();
      toast.show({ message: t('exporter.danger.deleted', { name }) });
    } catch (e) {
      setBusy(false);
      toast.error(e);
    }
  }

  return (
    <section className="danger" aria-labelledby="danger-title" data-testid="danger-zone">
      <div className="danger__text">
        <h2 className="danger__title" id="danger-title">
          <Trash2 size={15} aria-hidden strokeWidth={1.75} />
          {t('exporter.danger.title')}
        </h2>
        <p className="danger__body">{example ? t('exporter.danger.exampleNote') : t('exporter.danger.body')}</p>
      </div>
      {example ? null : (
        <Button variant="danger" onClick={() => void remove()} busy={busy} data-testid="delete-project">
          {t('exporter.danger.button')}
        </Button>
      )}
    </section>
  );
}


import React from 'react';
import { ArrowRight, ListChecks, CircleAlert, CircleCheck, Circle, FileText, FolderOpen, Plus, Sheet, AudioLines, FileType2, NotebookPen } from 'lucide-react';
import type { DocKind } from '../../core/model/types';
import { useI18n } from '../../ui/i18n';
import { useKeyLabel } from '../../shell/keys';
import { Button } from '../../ui/components/Button';
import { Notice, ProgressBar, Spinner } from '../../ui/components/Feedback';
import type { ReviewRow } from './model';
import type { CreatedDoc } from './run';

export interface RunState {
  index: number;
  total: number;
  name: string;
  /** Inside a survey: document n of total. */
  sub: { n: number; total: number } | null;
  statuses: Record<string, 'pending' | 'running' | 'done' | 'failed'>;
  stopping: boolean;
}

export interface DoneState {
  created: CreatedDoc[];
  failures: { name: string; message: string }[];
  stopped: null | 'user' | 'lock';
}

const KIND_ICON: Record<DocKind, typeof FileText> = { text: FileText, transcript: AudioLines, pdf: FileType2, survey: Sheet, note: NotebookPen };

/** Progress while importing: per file, stoppable between files. */
export function RunPanel({ run, rows, onStop }: { run: RunState; rows: ReviewRow[]; onStop: () => void }) {
  const { t } = useI18n();
  const value = run.index + (run.sub ? run.sub.n / Math.max(1, run.sub.total) : 0);
  const items = rows.filter((r) => run.statuses[r.id]);
  return (
    <div className="imp-run" data-testid="import-running">
      <section className="imp-run__card" aria-labelledby="imp-run-title" aria-busy>
        <h2 id="imp-run-title" className="imp-run__title">
          {run.stopping ? t('importer.run.stopping') : t('importer.run.title')}
        </h2>
        <ProgressBar value={value} max={run.total} label={t('importer.run.label')} data-testid="import-progress" />
        <p className="imp-run__now" aria-live="polite">
          {run.sub ? t('importer.run.survey', { name: run.name, n: run.sub.n, total: run.sub.total }) : t('importer.run.progress', { n: run.index + 1, total: run.total, name: run.name })}
        </p>
        <ul className="imp-run__list">
          {items.map((r) => {
            const s = run.statuses[r.id]!;
            return (
              <li key={r.id} className={`imp-run__item imp-run__item--${s}`}>
                {s === 'running' ? <Spinner size={14} /> : s === 'done' ? <CircleCheck size={14} aria-hidden /> : s === 'failed' ? <CircleAlert size={14} aria-hidden /> : <Circle size={14} aria-hidden />}
                <span className="imp-run__name">{r.name}</span>
                <span className="visually-hidden">{t(`importer.run.${s === 'running' ? 'title' : s}`)}</span>
              </li>
            );
          })}
        </ul>
        <div className="imp-run__actions">
          <Button variant="secondary" onClick={onStop} disabled={run.stopping} data-testid="import-stop">
            {t('importer.run.stop')}
          </Button>
        </div>
      </section>
    </div>
  );
}

/** After importing: what is new (with links), what failed, and what next. */
export function DonePanel({
  done,
  remaining,
  onOpen,
  onMore,
  onDocuments,
}: {
  done: DoneState;
  remaining: number;
  onOpen: (id: string) => void;
  onMore: () => void;
  onDocuments: () => void;
}) {
  const { t, tp } = useI18n();
  const key = useKeyLabel();
  const n = done.created.length;
  const shown = done.created.slice(0, 200);
  return (
    <div className="imp-run" data-testid="import-done">
      <section className="imp-run__card imp-run__card--done" aria-labelledby="imp-done-title">
        <div className={`imp-done__icon${n ? '' : ' imp-done__icon--none'}`} aria-hidden>
          {n ? <CircleCheck size={26} strokeWidth={1.75} /> : <CircleAlert size={26} strokeWidth={1.75} />}
        </div>
        <h2 id="imp-done-title" className="imp-run__title" tabIndex={-1} data-autofocus>
          {n ? tp('importer.done.title', n) : t('importer.done.none')}
        </h2>
        {n ? <p className="imp-run__now">{t('importer.done.undoHint')} <kbd className="kbd">{key('Z')}</kbd></p> : null}
        {done.stopped ? <Notice tone="warning">{done.stopped === 'lock' ? t('importer.done.stoppedLock') : t('importer.done.stopped')}</Notice> : null}

        {shown.length ? (
          <div className="imp-done__section">
            <h3 className="imp-label">{t('importer.done.created')}</h3>
            <ul className="imp-done__docs" data-testid="import-created">
              {shown.map((d) => {
                const Icon = KIND_ICON[d.kind] ?? FileText;
                return (
                  <li key={d.id}>
                    <button type="button" className="imp-done__doc" onClick={() => onOpen(d.id)} aria-label={t('importer.done.open', { name: d.name })} data-testid="import-created-doc">
                      <Icon size={15} aria-hidden />
                      <span className="imp-done__name">{d.name}</span>
                      <ArrowRight size={14} aria-hidden className="imp-done__go" />
                    </button>
                  </li>
                );
              })}
            </ul>
            {done.created.length > shown.length ? <p className="imp-hint">{t('importer.survey.more', { n: done.created.length - shown.length })}</p> : null}
          </div>
        ) : null}

        {done.failures.length ? (
          <div className="imp-done__section">
            <h3 className="imp-label imp-label--danger">{tp('importer.done.failures', done.failures.length)}</h3>
            <ul className="imp-done__failures" data-testid="import-failures">
              {done.failures.map((f, i) => (
                <li key={i}>
                  <strong>{f.name}</strong>
                  <span>{f.message}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="imp-run__actions">
          <Button variant="secondary" icon={remaining ? ListChecks : Plus} onClick={onMore} data-testid="import-more-files">
            {remaining ? tp('importer.done.remaining', remaining) : t('importer.done.more')}
          </Button>
          {n ? (
            <Button variant="primary" icon={FolderOpen} onClick={onDocuments} data-testid="import-open-documents">
              {t('importer.done.openFirst')}
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

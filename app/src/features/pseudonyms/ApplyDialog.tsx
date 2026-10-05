import React, { useState } from 'react';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { apply, type ApplyResult, type Preview } from '../../services/pseudonyms';
import { useHold, useProject } from '../../shell/AppState';
import { useUndo } from '../../shell/undo';
import { useI18n } from '../../ui/i18n';
import { Button } from '../../ui/components/Button';
import { Checkbox } from '../../ui/components/Choice';
import { Dialog } from '../../ui/components/Dialog';
import { Notice, ProgressBar } from '../../ui/components/Feedback';
import { useToast } from '../../ui/components/Toast';

type Stage = 'confirm' | 'running' | 'done';

/**
 * Applying the key: a strong confirmation (the documents' text changes), the work, and what
 * it did. Undo is offered right away, because later edits build on the changed text.
 */
export function ApplyDialog({ preview, ids, entryCount, onClose }: { preview: Preview; ids: string[] | undefined; entryCount: number; onClose: () => void }) {
  const { t, tp, meta } = useI18n();
  const fmtN = (n: number) => n.toLocaleString(meta.bcp47);
  const project = useProject();
  const { record, undo: undoLast } = useUndo();
  const toast = useToast();
  const [stage, setStage] = useState<Stage>('confirm');
  const [understood, setUnderstood] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [undone, setUndone] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  useHold(stage === 'running');

  const run = async () => {
    setStage('running');
    setProgress(null);
    try {
      const r = await apply(project, ids, {
        onProgress: async (done, total) => {
          setProgress({ done, total });
          // Let the bar move: a fast store never yields on its own.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        },
      });
      record(r.undo);
      setResult(r);
      setStage('done');
    } catch (e) {
      toast.error(e);
      setStage('confirm');
    }
  };

  if (stage === 'done' && result) {
    return (
      <Dialog
        open
        onClose={onClose}
        size="sm"
        title={undone ? t('pseudonyms.apply.undoneTitle') : t('pseudonyms.apply.doneTitle')}
        data-testid="apply-done"
        footer={
          <>
            {!undone ? (
              <Button
                variant="ghost"
                onClick={async () => {
                  await undoLast();
                  setUndone(true);
                }}
                data-testid="apply-undo"
              >
                {t('common.undo')}
              </Button>
            ) : null}
            <Button variant="primary" onClick={onClose} data-autofocus data-testid="apply-close">
              {t('common.done')}
            </Button>
          </>
        }
      >
        {undone ? (
          <p className="t-secondary">{t('pseudonyms.apply.undoneBody')}</p>
        ) : (
          <div className="papply__done">
            <CircleCheck size={20} aria-hidden strokeWidth={1.75} className="papply__done-icon" />
            <div>
              <p data-testid="apply-summary">{t('pseudonyms.apply.doneBody', { replacements: tp('pseudonyms.apply.replacements', result.replacements), documents: tp('common.count.documents', result.documents) })}</p>
              {result.removedCodings ? <p className="t-muted t-small">{tp('pseudonyms.apply.removedCodings', result.removedCodings)}</p> : null}
              <p className="t-muted t-small papply__undo-note">{t('pseudonyms.apply.undoNote')}</p>
            </div>
          </div>
        )}
      </Dialog>
    );
  }

  const running = stage === 'running';
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!running}
      size="md"
      title={t('pseudonyms.apply.title')}
      data-testid="apply-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={running} data-autofocus data-testid="apply-cancel">
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={() => void run()} disabled={!understood || running} busy={running} data-testid="apply-run">
            {t('pseudonyms.apply.run', { n: preview.total })}
          </Button>
        </>
      }
    >
      <div className="papply">
        <p>
          {t('pseudonyms.apply.body', {
            replacements: tp('pseudonyms.apply.replacements', preview.total),
            documents: tp('common.count.documents', preview.documents.length),
            entries: tp('pseudonyms.count', entryCount),
          })}
        </p>
        <Notice tone="warning" icon={TriangleAlert} title={t('pseudonyms.apply.warningTitle')}>
          <ul className="papply__points">
            <li>{t('pseudonyms.apply.point1')}</li>
            <li>{t('pseudonyms.apply.point2')}</li>
            <li>{t('pseudonyms.apply.point3')}</li>
          </ul>
        </Notice>
        {running ? (
          <div className="papply__progress">
            <ProgressBar value={progress ? progress.done : null} max={progress?.total || 1} label={t('pseudonyms.apply.running')} data-testid="apply-progress" />
            <span className="t-muted t-small" aria-live="polite">
              {progress && progress.total > 1 ? t('pseudonyms.apply.runningN', { n: fmtN(Math.min(progress.done + 1, progress.total)), total: fmtN(progress.total) }) : t('pseudonyms.apply.running')}
            </span>
          </div>
        ) : (
          <Checkbox checked={understood} onChange={setUnderstood} label={t('pseudonyms.apply.understand')} data-testid="apply-understand" />
        )}
      </div>
    </Dialog>
  );
}

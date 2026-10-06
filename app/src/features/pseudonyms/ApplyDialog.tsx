import React, { useRef, useState } from 'react';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { apply, type ApplyResult, type Preview } from '../../services/pseudonyms';
import { useHold, useProject, useRegisterSaver } from '../../shell/AppState';
import { waitForRunning } from '../../shell/savers';
import { useUndo } from '../../shell/undo';
import { useI18n } from '../../ui/i18n';
import { Button } from '../../ui/components/Button';
import { Checkbox } from '../../ui/components/Choice';
import { Dialog } from '../../ui/components/Dialog';
import { Notice, ProgressBar } from '../../ui/components/Feedback';
import { useToast } from '../../ui/components/Toast';

type Stage = 'confirm' | 'running' | 'done';

/** A large project takes a while; past this, locking goes on (the next open notes the cut). */
const APPLY_LIMIT_MS = 120_000;

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
  const running = useRef<Promise<unknown> | null>(null);
  useHold(stage === 'running');
  // Locking or closing the window waits for the apply to finish: cut short, it would leave the
  // project half pseudonymised (some documents changed, names and the rest not).
  useRegisterSaver(
    waitForRunning(() => running.current),
    { limitMs: APPLY_LIMIT_MS },
  );

  const run = async () => {
    setStage('running');
    setProgress(null);
    try {
      const work = apply(project, ids, {
        onProgress: async (done, total) => {
          setProgress({ done, total });
          // Let the bar move: a fast store never yields on its own.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        },
      });
      running.current = work;
      const r = await work;
      record(r.undo);
      setResult(r);
      setStage('done');
    } catch (e) {
      toast.error(e);
      setStage('confirm');
    } finally {
      running.current = null;
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
                  // A refused or failed undo says why on a toast; the text stays as applied.
                  if (await undoLast()) setUndone(true);
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
              <p data-testid="apply-summary">
                {t('pseudonyms.apply.doneBody', { replacements: tp('pseudonyms.apply.replacements', result.replacements - result.fieldReplacements), documents: tp('common.count.documents', result.documents) })}
                {result.fieldReplacements ? ` ${tp('pseudonyms.apply.doneFields', result.fieldReplacements)}` : ''}
              </p>
              {result.removedCodings ? <p className="t-muted t-small">{tp('pseudonyms.apply.removedCodings', result.removedCodings)}</p> : null}
              <p className="t-muted t-small papply__undo-note">{t('pseudonyms.apply.undoNote')}</p>
            </div>
          </div>
        )}
      </Dialog>
    );
  }

  const busy = stage === 'running';
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      size="md"
      title={t('pseudonyms.apply.title')}
      data-testid="apply-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy} data-autofocus data-testid="apply-cancel">
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={() => void run()} disabled={!understood || busy} busy={busy} data-testid="apply-run">
            {t('pseudonyms.apply.run', { n: preview.total })}
          </Button>
        </>
      }
    >
      <div className="papply">
        <p data-testid="apply-body">
          {preview.textTotal === 0 ? tp('pseudonyms.apply.bodyFields', preview.total) : t('pseudonyms.apply.body', {
            replacements: tp('pseudonyms.apply.replacements', preview.textTotal),
            documents: tp('common.count.documents', preview.documents.length),
            entries: tp('pseudonyms.count', entryCount),
          })}
          {preview.textTotal > 0 && preview.total > preview.textTotal ? ` ${tp('pseudonyms.apply.bodyFields', preview.total - preview.textTotal)}` : ''}
        </p>
        <Notice tone="warning" icon={TriangleAlert} title={t('pseudonyms.apply.warningTitle')}>
          <ul className="papply__points">
            <li>{t('pseudonyms.apply.point1')}</li>
            <li>{t('pseudonyms.apply.point2')}</li>
            <li>{t('pseudonyms.apply.point3')}</li>
          </ul>
        </Notice>
        <Notice tone="info" data-testid="apply-not-covered">
          <p>{t('pseudonyms.apply.point4')}</p>
          {preview.logEntries ? <p>{tp('pseudonyms.preview.logTitle', preview.logEntries)}. {t('pseudonyms.preview.logBody')}</p> : null}
        </Notice>
        {busy ? (
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

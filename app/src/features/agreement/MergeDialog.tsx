import React, { useEffect, useState } from 'react';
import { CircleCheck, FileUp } from 'lucide-react';
import type { TramaBundle } from '../../core/export/trama';
import { UnlockRequiredError, type Unlock } from '../../core/export/trama';
import { DataFileError, mergeTeammateCopy, type MergePreview, type MergeResult, openProjectFile, previewMerge } from '../../services/datafile';
import { useHold, useProject } from '../../shell/AppState';
import { useRouter } from '../../shell/router';
import { useUndo } from '../../shell/undo';
import { takeTeammateText } from '../../services/documents';
import type { TextConflict } from '../../services/reconcile';
import { useToast } from '../../ui/components/Toast';
import { inkOn } from '../../ui/color';
import { initial } from '../../shell/initial';
import { Button } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { Notice, Spinner } from '../../ui/components/Feedback';
import { TextField } from '../../ui/components/Field';
import { type MessageKey, useI18n } from '../../ui/i18n';
import { problemKey } from '../../ui/problems';
import { fmtInt } from './model';
import { baseName } from './files';
import { fileProblem, type FileProblem, PREVIEW_KINDS, previewRows, sameProject } from './teamModel';
import { MergeReport } from './MergeReport';

type Stage =
  | { name: 'pick' }
  | { name: 'reading' }
  | { name: 'password'; bytes: Uint8Array; file: string; wrong: boolean }
  | { name: 'preview'; bundle: TramaBundle; preview: MergePreview }
  | { name: 'merging'; preview: MergePreview }
  | { name: 'done'; result: MergeResult }
  | { name: 'error'; problem: FileProblem; message: string; known: MessageKey | null; fileProject?: string };

/** Pick a teammate's .trama copy, see what it brings, merge it. */
export function MergeDialog({ open, onClose, onCompare }: { open: boolean; onClose: () => void; onCompare: () => void }) {
  const { t, tp, meta } = useI18n();
  const project = useProject();
  const { go } = useRouter();
  const { record } = useUndo();
  const toast = useToast();
  // Conflicts resolved in the done stage with the teammate's text.
  const [taken, setTaken] = useState<ReadonlySet<string>>(new Set());
  const takeTheirs = async (c: TextConflict) => {
    if (c.theirText === undefined || taken.has(c.documentId)) return;
    try {
      const r = await takeTeammateText(project, c.documentId, c.theirText, c.theirRevs ?? []);
      record(r.undo);
      setTaken((cur) => new Set([...cur, c.documentId]));
    } catch (e) {
      toast.error(e);
    }
  };
  const [stage, setStage] = useState<Stage>({ name: 'pick' });
  const [password, setPassword] = useState('');
  const busy = stage.name === 'reading' || stage.name === 'merging';
  useHold(busy);

  useEffect(() => {
    if (open) {
      setStage({ name: 'pick' });
      setPassword('');
      setTaken(new Set());
    }
  }, [open]);

  const fail = (e: unknown, fileProject?: string) => {
    const problem = fileProblem(e);
    if (problem === 'unknown') console.error('reading a teammate copy failed', e);
    setStage({ name: 'error', problem, message: e instanceof Error ? e.message : String(e), known: problemKey(e), ...(fileProject ? { fileProject } : {}) });
  };

  async function openBytes(bytes: Uint8Array, file: string, unlock: Unlock) {
    setStage({ name: 'reading' });
    try {
      const { bundle } = await openProjectFile(project.platform, bytes, unlock);
      if (!sameProject(bundle, project.id)) {
        fail(new DataFileError('DIFFERENT_PROJECT', 'different project'), bundle.project.name);
        return;
      }
      setStage({ name: 'preview', bundle, preview: await previewMerge(project, bundle) });
    } catch (e) {
      if (e instanceof UnlockRequiredError && e.protection === 'password') {
        setStage({ name: 'password', bytes, file, wrong: false });
      } else if (unlock.kind === 'password' && fileProblem(e) === 'wrongPassword') {
        setStage({ name: 'password', bytes, file, wrong: true });
      } else fail(e);
    }
  }

  async function pick() {
    try {
      const [path] = await project.platform.dialogs.pickFiles(
        t('agreement.merge.dialogTitle'),
        [{ name: t('agreement.copy.fileType'), extensions: ['trama'] }],
        false,
      );
      if (!path) return;
      setStage({ name: 'reading' });
      const bytes = await project.platform.files.read(path);
      await openBytes(bytes, baseName(path), { kind: 'none' });
    } catch (e) {
      fail(e);
    }
  }

  async function merge(bundle: TramaBundle, preview: MergePreview) {
    setStage({ name: 'merging', preview });
    try {
      const result = await mergeTeammateCopy(project, bundle);
      setStage({ name: 'done', result });
    } catch (e) {
      fail(e, bundle.project.name);
    }
  }

  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;
  const close = (
    <Button variant="ghost" onClick={onClose} disabled={busy}>
      {stage.name === 'done' ? t('common.close') : t('common.cancel')}
    </Button>
  );

  switch (stage.name) {
    case 'pick':
      body = (
        <div className="agr-merge__pick">
          <FileUp size={22} strokeWidth={1.5} aria-hidden className="agr-merge__icon" />
          <p>{t('agreement.merge.intro')}</p>
        </div>
      );
      footer = (
        <>
          {close}
          <Button variant="primary" onClick={() => void pick()} data-testid="agreement-merge-choose">
            {t('agreement.merge.choose')}
          </Button>
        </>
      );
      break;
    case 'reading':
    case 'merging':
      body = (
        <div className="agr-merge__busy" role="status">
          <Spinner size={20} />
          <span>{stage.name === 'reading' ? t('agreement.merge.reading') : t('agreement.merge.merging')}</span>
        </div>
      );
      footer = close;
      break;
    case 'password':
      body = (
        <div className="agr-form">
          <p className="agr-merge__file">{stage.file}</p>
          <TextField
            type="password"
            label={t('agreement.merge.passwordTitle')}
            value={password}
            onChange={setPassword}
            error={stage.wrong ? t('agreement.merge.wrongPassword') : undefined}
            autoFocus
            data-testid="agreement-merge-password"
          />
        </div>
      );
      footer = (
        <>
          {close}
          <Button type="submit" variant="primary" disabled={!password} data-testid="agreement-merge-open">
            {t('agreement.merge.open')}
          </Button>
        </>
      );
      break;
    case 'preview': {
      const p = stage.preview;
      const rows = previewRows(p);
      const nothing = p.added === 0 && p.updated === 0;
      body = (
        <div className="agr-merge__preview" data-testid="agreement-merge-preview">
          <h3 className="agr-merge__title">{t('agreement.merge.previewTitle', { name: p.projectName })}</h3>
          {nothing ? (
            <Notice tone="info">{t('agreement.merge.nothing')}</Notice>
          ) : (
            <table className="agr-merge__table">
              <thead>
                <tr>
                  <th scope="col">{t('agreement.merge.kind')}</th>
                  <th scope="col" className="agr-num">
                    {t('agreement.merge.added')}
                  </th>
                  <th scope="col" className="agr-num">
                    {t('agreement.merge.updated')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...PREVIEW_KINDS, 'other' as const].map((k) => {
                  const c = rows[k];
                  return (
                    <tr key={k} className={c.added + c.updated === 0 ? 'agr-merge__zero' : undefined}>
                      <th scope="row">{t(`agreement.merge.kinds.${k}`)}</th>
                      <td className="agr-num t-tabular">{c.added ? `+${fmtInt(c.added, meta.bcp47)}` : '—'}</td>
                      <td className="agr-num t-tabular">{c.updated ? fmtInt(c.updated, meta.bcp47) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <MergeReport findings={p} stage="preview" />
          {p.rejected ? <Notice tone="warning">{tp('agreement.merge.previewRejected', p.rejected)}</Notice> : null}
          {p.newCoders.length ? (
            <div className="agr-merge__coders">
              <span className="field__label">{t('agreement.merge.newCoders')}</span>
              <div className="agr-merge__coder-list">
                {p.newCoders.map((c) => (
                  <span key={c.id} className="agr-merge__coder">
                    <span className="agr-avatar agr-avatar--sm" style={{ background: c.color, color: inkOn(c.color) }} aria-hidden>
                      {initial(c.name)}
                    </span>
                    {c.name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <p className="agr-form__note">{t('agreement.merge.rule')}</p>
        </div>
      );
      footer = (
        <>
          {close}
          <Button variant="primary" onClick={() => void merge(stage.bundle, p)} disabled={nothing} data-testid="agreement-merge-confirm">
            {t('agreement.merge.mergeButton')}
          </Button>
        </>
      );
      break;
    }
    case 'done': {
      const r = stage.result;
      body = (
        <div className="agr-merge__done" data-testid="agreement-merge-done">
          <CircleCheck size={24} strokeWidth={1.5} aria-hidden className="agr-merge__ok" />
          <h3 className="agr-merge__title">{t('agreement.merge.doneTitle')}</h3>
          <p>{t('agreement.merge.done', { added: fmtInt(r.added, meta.bcp47), updated: fmtInt(r.updated, meta.bcp47) })}</p>
          {r.blobs ? <p className="t-secondary">{tp('agreement.merge.doneFiles', r.blobs)}</p> : null}
          {r.rejected ? <Notice tone="warning">{tp('agreement.merge.doneRejected', r.rejected)}</Notice> : null}
          <MergeReport
            findings={r}
            stage="done"
            onOpenDocument={(docId) => {
              onClose();
              go({ name: 'workbench', docId });
            }}
            onPseudonymise={() => {
              onClose();
              go({ name: 'pseudonyms' });
            }}
            onTakeTheirs={(c) => void takeTheirs(c)}
            taken={taken}
          />
        </div>
      );
      footer = (
        <>
          {close}
          <Button variant="primary" onClick={onCompare} data-testid="agreement-merge-compare">
            {t('agreement.merge.compare')}
          </Button>
        </>
      );
      break;
    }
    case 'error': {
      const msg: Record<FileProblem, React.ReactNode> = {
        differentProject: t('agreement.merge.different', { project: project.info.name, name: stage.fileProject ?? '' }),
        newer: t('common.problems.newerFile'),
        notTrama: t('agreement.merge.notTrama'),
        wrongPassword: t('agreement.merge.wrongPassword'),
        backup: t('agreement.merge.backup'),
        unknown: t('agreement.merge.unknown', { message: stage.known ? t(stage.known) : stage.message }),
      };
      body = (
        <Notice
          tone="danger"
          title={stage.problem === 'differentProject' ? t('agreement.merge.differentTitle') : undefined}
          data-testid={`agreement-merge-error-${stage.problem}`}
        >
          {msg[stage.problem]}
        </Notice>
      );
      footer = (
        <>
          {close}
          <Button variant="secondary" onClick={() => void pick()} data-testid="agreement-merge-retry">
            {t('agreement.merge.tryAgain')}
          </Button>
        </>
      );
      break;
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title={t('agreement.merge.title')}
      onSubmit={stage.name === 'password' ? () => void openBytes(stage.bytes, stage.file, { kind: 'password', password }) : undefined}
      footer={footer}
      data-testid="agreement-merge-dialog"
    >
      {body}
    </Dialog>
  );
}

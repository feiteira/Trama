import React, { useEffect, useRef, useState } from 'react';
import { CircleCheck, FileArchive, FolderOpen, FolderSync, GitMerge, KeyRound, Users } from 'lucide-react';
import { importQdpx, type QdpxWarning } from '../../core/export/refi';
import type { ProjectBundle } from '../../core/export/bundle';
import type { TramaBundle, Unlock } from '../../core/export/trama';
import { LIMITS } from '../../core/model/types';
import { mergeTeammateCopy, type MergeResult } from '../../services/datafile';
import type { ProjectInfo } from '../../services/project';
import { useAppState, useHold, useLibrary } from '../../shell/AppState';
import type { Route } from '../../shell/router';
import { MergeReport } from '../agreement/MergeReport';
import { useI18n } from '../../ui/i18n';
import { Button } from '../../ui/components/Button';
import { RadioGroup } from '../../ui/components/Choice';
import { Dialog } from '../../ui/components/Dialog';
import { Notice, Spinner } from '../../ui/components/Feedback';
import { TextArea, TextField } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { type IncomingFile, pickFiles } from './files';
import { say } from './messages';
import { importName, detectProjectFile, meForImport, openTrama, projectFileError, sameProjectIn, summariseBundle, type BundleSummary } from './projectFile';
import { groupQdpxWarnings, type QdpxNote } from './qdpxWarnings';
import './importer.css';

type Step =
  | { name: 'idle' }
  | { name: 'reading'; file: string }
  | { name: 'unlock'; file: string; bytes: Uint8Array; protection: 'password' | 'library-key' }
  | {
      name: 'summary';
      file: string;
      type: 'trama' | 'qdpx';
      bundle: ProjectBundle;
      summary: BundleSummary;
      same: ProjectInfo | null;
      /** A backup of this library: its `me` is right here too. */
      ownMe: string | null;
      /** What a REFI-QDA project could not carry over. */
      issues: QdpxWarning[];
    }
  | { name: 'imported'; info: ProjectInfo }
  /** A teammate's copy merged into a project of this library: what came in, and what to check. */
  | { name: 'merged'; info: ProjectInfo; result: MergeResult }
  | { name: 'error'; file: string; message: string };

/**
 * Importing a whole project file from the project list: a .trama (asks for its password, or for
 * another library's passphrase) or a REFI-QDA .qdpx (shows what cannot be carried over). A
 * teammate's copy of a project already here can be merged into it instead.
 */
export function ImportProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, tp } = useI18n();
  const library = useLibrary();
  const { platform, prefs, enterProject, openProject } = useAppState();
  const toast = useToast();
  const [step, setStep] = useState<Step>({ name: 'idle' });
  const [secret, setSecret] = useState('');
  const [slot, setSlot] = useState<'passphrase' | 'recovery_phrase'>('passphrase');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'merge' | 'separate'>('merge');
  const [working, setWorking] = useState<null | 'unlock' | 'import'>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useHold(working !== null);

  const toSummary = (file: string, type: 'trama' | 'qdpx', bundle: ProjectBundle, ownMe: string | null, issues: QdpxWarning[] = []) => {
    const summary = summariseBundle(bundle);
    const same = sameProjectIn(bundle, library.projects);
    setName(importName(summary.name, file, library.projects.map((p) => p.name)));
    setMode('merge');
    setError(null);
    setStep({ name: 'summary', file, type, bundle, summary, same, ownMe, issues });
  };

  const read = async (file: IncomingFile) => {
    setStep({ name: 'reading', file: file.name });
    try {
      const bytes = await file.read();
      const type = detectProjectFile(file.name, bytes);
      if (!type) {
        setStep({ name: 'error', file: file.name, message: t('importer.project.errors.notProject') });
        return;
      }
      if (type === 'qdpx') {
        const bundle = await importQdpx(bytes, { defaultCoderName: prefs.coderName.trim() || t('importer.project.defaultCoder') });
        toSummary(file.name, 'qdpx', bundle, null, bundle.issues);
        return;
      }
      const opened = await openTrama(bytes, null, () => library.copyKeys(), platform.kdf);
      if (opened.status === 'locked') {
        setSecret('');
        setUnlockError(null);
        setSlot('passphrase');
        setStep({ name: 'unlock', file: file.name, bytes, protection: opened.protection });
        return;
      }
      toSummary(file.name, 'trama', opened.bundle, opened.ownLibrary ? (opened.bundle as TramaBundle).manifest.me ?? null : null);
    } catch (e) {
      console.error('reading a project file failed', e);
      setStep({ name: 'error', file: file.name, message: say(projectFileError(e), t, tp) });
    }
  };

  const choose = async () => {
    try {
      const [file] = await pickFiles(platform, t('importer.project.pickTitle'), [{ name: t('importer.project.filter'), extensions: ['trama', 'qdpx'] }], false);
      if (!file) {
        if (step.name === 'idle') closeRef.current();
        return;
      }
      await read(file);
    } catch (e) {
      toast.error(e);
      closeRef.current();
    }
  };

  useEffect(() => {
    if (!open) {
      started.current = false;
      setStep({ name: 'idle' });
      setWorking(null);
      return;
    }
    if (started.current) return;
    started.current = true;
    void choose();
    // Only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const unlock = async () => {
    if (step.name !== 'unlock' || working || !secret.trim()) return;
    setWorking('unlock');
    setUnlockError(null);
    const how: Unlock = step.protection === 'password' ? { kind: 'password', password: secret } : { kind: 'secret', slot, secret: slot === 'recovery_phrase' ? secret.trim().toLowerCase().split(/\s+/).join(' ') : secret };
    try {
      const opened = await openTrama(step.bytes, how, () => library.copyKeys(), platform.kdf);
      if (opened.status === 'opened') toSummary(step.file, 'trama', opened.bundle, null);
    } catch (e) {
      setUnlockError(say(projectFileError(e, step.protection), t, tp));
    } finally {
      setWorking(null);
    }
  };

  const finish = async () => {
    if (step.name !== 'summary' || working) return;
    const merging = step.same !== null && mode === 'merge';
    const clean = name.replace(/\s+/g, ' ').trim();
    if (!merging && !clean) return;
    setWorking('import');
    setError(null);
    try {
      if (merging && step.same) {
        const project = await library.openProject(step.same.id);
        let result: MergeResult;
        try {
          result = await mergeTeammateCopy(project, step.bundle);
        } finally {
          // Closed while the researcher reads what the merge did; opening it is one click.
          await library.closeProject().catch(() => undefined);
        }
        setWorking(null);
        setStep({ name: 'merged', info: step.same, result });
      } else {
        const id = step.bundle.project.id;
        const keepId = !!id && !step.same && !(await platform.projects.exists(id));
        const me = meForImport(step.type, step.ownMe, step.summary.coders, prefs.coderName);
        // Added to the library without leaving the screen: the researcher chooses to open it.
        const info = await library.importBundle(step.bundle, { name: clean, keepId, me, open: false });
        setWorking(null);
        setStep({ name: 'imported', info });
      }
    } catch (e) {
      console.error('importing a project file failed', e);
      setError(say(projectFileError(e), t, tp));
      setWorking(null);
    }
  };

  const dismissible = working === null;
  const cancel = (
    <Button variant="ghost" onClick={onClose} disabled={!dismissible}>
      {t('common.cancel')}
    </Button>
  );

  if (step.name === 'idle') return null;

  if (step.name === 'reading') {
    return (
      <Dialog open={open} onClose={onClose} title={t('importer.project.pickTitle')} size="sm" data-testid="import-project-dialog">
        <div className="imp-proj__reading" role="status">
          <Spinner size={18} />
          <span>{t('importer.project.reading', { file: step.file })}</span>
        </div>
      </Dialog>
    );
  }

  if (step.name === 'error') {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        title={t('importer.project.errorTitle')}
        description={step.file}
        size="sm"
        data-testid="import-project-dialog"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('common.close')}
            </Button>
            <Button variant="primary" onClick={() => void choose()} data-testid="import-project-choose-again">
              {t('importer.project.chooseAnother')}
            </Button>
          </>
        }
      >
        <Notice tone="danger" data-testid="import-project-error">
          {step.message}
        </Notice>
      </Dialog>
    );
  }

  if (step.name === 'imported') {
    const { info } = step;
    const openNow = async () => {
      setWorking('import');
      try {
        enterProject(await library.openProject(info.id));
      } catch (e) {
        setWorking(null);
        toast.error(e);
      }
    };
    return (
      <Dialog
        open={open}
        onClose={onClose}
        dismissible={dismissible}
        title={t('importer.project.importedTitle', { name: info.name })}
        size="sm"
        onSubmit={() => void openNow()}
        data-testid="import-project-dialog"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={!dismissible} data-testid="import-project-later">
              {t('importer.project.later')}
            </Button>
            <Button type="submit" variant="primary" icon={FolderOpen} busy={working === 'import'} data-autofocus data-testid="import-project-open">
              {t('importer.project.openNow')}
            </Button>
          </>
        }
      >
        <div className="imp-proj__done" data-testid="import-project-done">
          <CircleCheck size={20} strokeWidth={1.75} aria-hidden className="imp-proj__done-icon" />
          <p>{t('importer.project.importedBody')}</p>
        </div>
      </Dialog>
    );
  }

  if (step.name === 'merged') {
    const { info, result: r } = step;
    const go = async (route?: Route) => {
      setWorking('import');
      try {
        await openProject(info.id, route);
      } catch (e) {
        setWorking(null);
        toast.error(e);
      }
    };
    return (
      <Dialog
        open={open}
        onClose={onClose}
        dismissible={dismissible}
        title={t('importer.project.mergedTitle', { name: info.name })}
        size="md"
        onSubmit={() => void go()}
        data-testid="import-project-dialog"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={!dismissible} data-testid="import-project-later">
              {t('importer.project.later')}
            </Button>
            <Button type="submit" variant="primary" icon={FolderOpen} busy={working === 'import'} data-autofocus data-testid="import-project-open">
              {t('importer.project.openNow')}
            </Button>
          </>
        }
      >
        <div className="imp-proj__merged" data-testid="import-project-merged">
          <div className="imp-proj__done">
            <CircleCheck size={20} strokeWidth={1.75} aria-hidden className="imp-proj__done-icon" />
            <p>
              {r.added || r.updated
                ? t('agreement.merge.done', { added: r.added, updated: r.updated })
                : t('importer.project.mergedNothing', { name: info.name })}
            </p>
          </div>
          {r.rejected ? <Notice tone="warning">{tp('agreement.merge.doneRejected', r.rejected)}</Notice> : null}
          <MergeReport
            findings={r}
            stage="done"
            onOpenDocument={(docId) => void go({ name: 'workbench', docId })}
            onPseudonymise={() => void go({ name: 'pseudonyms' })}
          />
        </div>
      </Dialog>
    );
  }

  if (step.name === 'unlock') {
    const password = step.protection === 'password';
    return (
      <Dialog
        open={open}
        onClose={onClose}
        dismissible={dismissible}
        title={password ? t('importer.project.passwordTitle') : t('importer.project.secretTitle')}
        description={password ? t('importer.project.passwordBody', { file: step.file }) : t('importer.project.secretBody')}
        size="md"
        onSubmit={() => void unlock()}
        data-testid="import-project-dialog"
        footer={
          <>
            {cancel}
            <Button type="submit" variant="primary" icon={KeyRound} busy={working === 'unlock'} disabled={!secret.trim()} data-testid="import-project-unlock">
              {working === 'unlock' ? t('importer.project.opening') : t('importer.project.open')}
            </Button>
          </>
        }
      >
        {!password ? (
          <RadioGroup<'passphrase' | 'recovery_phrase'>
            label={t('importer.project.secretKind')}
            variant="segmented"
            value={slot}
            onChange={(s) => {
              setSlot(s);
              setSecret('');
              setUnlockError(null);
            }}
            options={[
              { value: 'passphrase', label: t('importer.project.passphrase') },
              { value: 'recovery_phrase', label: t('importer.project.recoveryPhrase') },
            ]}
            data-testid="import-project-slot"
          />
        ) : null}
        {password || slot === 'passphrase' ? (
          <TextField
            type="password"
            label={password ? t('importer.project.password') : t('importer.project.passphrase')}
            value={secret}
            onChange={setSecret}
            error={unlockError ?? undefined}
            autoComplete="off"
            data-autofocus
            data-testid="import-project-secret"
          />
        ) : (
          <TextArea
            label={t('importer.project.recoveryPhrase')}
            value={secret}
            onChange={setSecret}
            error={unlockError ?? undefined}
            minHeight={72}
            spellCheck={false}
            autoComplete="off"
            data-testid="import-project-phrase"
          />
        )}
      </Dialog>
    );
  }

  const s = step.summary;
  const merging = step.same !== null && mode === 'merge';
  const groups = step.type === 'qdpx' ? groupQdpxWarnings(step.issues) : [];
  // Documents always; the rest when the file has any.
  const counts = [
    tp('importer.project.counts.documents', s.counts.document),
    ...(s.counts.code ? [tp('importer.project.counts.codes', s.counts.code)] : []),
    ...(s.counts.coding ? [tp('importer.project.counts.codings', s.counts.coding)] : []),
    ...(s.counts.memo ? [tp('importer.project.counts.memos', s.counts.memo)] : []),
    ...(s.counts.case ? [tp('importer.project.counts.cases', s.counts.case)] : []),
  ];
  const noteText = (n: QdpxNote) => ('plural' in n ? tp(n.plural, n.n) : 'key' in n ? t(n.key, n.vars) : n.raw);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={dismissible}
      title={t('importer.project.summaryTitle', { name: s.name || step.file })}
      description={[s.origin ? t('importer.project.madeWith', { origin: s.origin }) : null, t('importer.project.fileName', { file: step.file })].filter(Boolean).join(' · ')}
      size="lg"
      onSubmit={() => void finish()}
      data-testid="import-project-dialog"
      footer={
        <>
          {cancel}
          <Button
            type="submit"
            variant="primary"
            icon={merging ? GitMerge : FileArchive}
            busy={working === 'import'}
            disabled={!merging && !name.trim()}
            data-testid="import-project-confirm"
          >
            {working === 'import' ? (merging ? t('importer.project.merging') : t('importer.project.importing')) : merging ? t('importer.project.mergeAction') : t('importer.project.import')}
          </Button>
        </>
      }
    >
      <div className="imp-proj__contents" data-testid="import-project-summary">
        <span className="imp-label">{t('importer.project.contents')}</span>
        <ul className="imp-proj__counts">
          {counts.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        {s.coders.length ? (
          <p className="imp-proj__coders">
            <Users size={14} aria-hidden />
            {tp('importer.project.coders', s.coders.length, { names: s.coders.map((c) => c.name).join(', ') })}
          </p>
        ) : null}
      </div>

      {step.same ? (
        <div className="imp-proj__same">
          <Notice tone="info" icon={FolderSync} title={t('importer.project.sameTitle')}>
            {t('importer.project.sameBody', { name: step.same.name })}
          </Notice>
          <RadioGroup<'merge' | 'separate'>
            label={t('importer.project.sameTitle')}
            hideLabel
            value={mode}
            onChange={setMode}
            options={[
              { value: 'merge', label: t('importer.project.merge', { name: step.same.name }), description: t('importer.project.mergeHint') },
              { value: 'separate', label: t('importer.project.separate'), description: t('importer.project.separateHint') },
            ]}
            data-testid="import-project-mode"
          />
        </div>
      ) : null}

      {!merging ? (
        <TextField
          label={t('importer.project.name')}
          value={name}
          onChange={setName}
          maxLength={LIMITS.nameMax}
          error={!name.trim() ? t('importer.project.nameRequired') : undefined}
          data-testid="import-project-name"
        />
      ) : null}

      {step.type === 'qdpx' ? (
        groups.length ? (
          <section className="imp-proj__lost" aria-labelledby="imp-proj-lost" data-testid="import-project-warnings">
            <h3 id="imp-proj-lost" className="imp-proj__lost-title">
              {t('importer.project.lostTitle')}
              <span className="imp-proj__lost-count">{tp('importer.project.lostCount', step.issues.length)}</span>
            </h3>
            {groups.map((g) => (
              <div key={g.group} className="imp-proj__group">
                <h4 className="imp-label">{t(`importer.project.groups.${g.group}`)}</h4>
                <ul>
                  {g.notes.map((n, i) => (
                    <li key={i} title={n.raw}>
                      {noteText(n)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ) : (
          <Notice tone="success">{t('importer.project.nothingLost')}</Notice>
        )
      ) : null}

      {error ? (
        <Notice tone="danger" data-testid="import-project-error">
          {error}
        </Notice>
      ) : null}
    </Dialog>
  );
}

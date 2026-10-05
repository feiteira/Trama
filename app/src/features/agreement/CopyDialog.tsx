import React, { useEffect, useState } from 'react';
import { exportProjectFile } from '../../services/datafile';
import { JobStopped } from '../../services/jobs';
import { useHold, useProject } from '../../shell/AppState';
import { Button } from '../../ui/components/Button';
import { Checkbox, Switch } from '../../ui/components/Choice';
import { Dialog } from '../../ui/components/Dialog';
import { Notice } from '../../ui/components/Feedback';
import { TextField } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import { saveBytes } from './files';

/** Saves the project as a .trama file for a teammate (optionally with a password). */
export function CopyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const project = useProject();
  const toast = useToast();
  const [protect, setProtect] = useState(true);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [pseudonyms, setPseudonyms] = useState(false);
  const [hasPseudonyms, setHasPseudonyms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useHold(busy);

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setRepeat('');
    setPseudonyms(false);
    setError(null);
    void project.store.count('pseudonym').then((n) => setHasPseudonyms(n > 0));
  }, [open, project]);

  async function save() {
    if (busy) return;
    if (protect && !password) return setError(t('agreement.copy.passwordRequired'));
    if (protect && password !== repeat) return setError(t('agreement.copy.mismatch'));
    setBusy(true);
    setError(null);
    try {
      const bytes = await exportProjectFile(project, { includePseudonyms: pseudonyms, ...(protect ? { password } : {}) });
      const name = await saveBytes(
        project.platform,
        t('agreement.copy.dialogTitle'),
        `${project.info.name}.trama`,
        { name: t('agreement.copy.fileType'), extensions: ['trama'] },
        bytes,
      );
      if (!name) return;
      toast.show({ message: t('agreement.copy.saved', { name }), tone: 'success', durationMs: 8000 });
      onClose();
    } catch (e) {
      if (e instanceof JobStopped) return;
      console.error('copy for a teammate failed', e);
      setError(t('agreement.copy.failed', { message: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title={t('agreement.copy.title')}
      description={t('agreement.copy.description')}
      onSubmit={() => void save()}
      data-testid="agreement-copy-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" busy={busy} data-testid="agreement-copy-save">
            {t('agreement.copy.save')}
          </Button>
        </>
      }
    >
      <div className="agr-form">
        <Switch
          checked={protect}
          onChange={setProtect}
          label={t('agreement.copy.protect')}
          description={t('agreement.copy.protectHint')}
          data-testid="agreement-copy-protect"
        />
        {protect ? (
          <div className="agr-form__pair">
            <TextField
              type="password"
              label={t('agreement.copy.password')}
              value={password}
              onChange={(v) => {
                setPassword(v);
                setError(null);
              }}
              autoComplete="new-password"
              data-testid="agreement-copy-password"
            />
            <TextField
              type="password"
              label={t('agreement.copy.repeat')}
              value={repeat}
              onChange={(v) => {
                setRepeat(v);
                setError(null);
              }}
              autoComplete="new-password"
              data-testid="agreement-copy-repeat"
            />
          </div>
        ) : null}
        {hasPseudonyms ? (
          <Checkbox
            checked={pseudonyms}
            onChange={setPseudonyms}
            label={t('agreement.copy.pseudonyms')}
            description={t('agreement.copy.pseudonymsHint')}
            data-testid="agreement-copy-pseudonyms"
          />
        ) : null}
        <p className="agr-form__note">{t('agreement.copy.next')}</p>
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </div>
    </Dialog>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { Copy, KeyRound } from 'lucide-react';
import { wipe } from '../../core/bytes';
import { newRecoveryPhrase, unlockKeyring, WrongSecretError } from '../../core/crypto/keyring';
import { useLibrary, usePlatform } from '../../shell/AppState';
import { useI18n } from '../../ui/i18n';
import { Button } from '../../ui/components/Button';
import { Checkbox } from '../../ui/components/Choice';
import { Dialog } from '../../ui/components/Dialog';
import { Notice } from '../../ui/components/Feedback';
import { TextField } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { passphraseProblem, pickCheckPositions, wordMatches } from '../onboarding/passphrase';
import { PassphraseFields } from '../onboarding/PassphraseFields';
import { SecretField } from '../onboarding/SecretField';

/** Current passphrase, then the new one twice (with the strength meter from setup). */
export function ChangePassphraseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const library = useLibrary();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [shownCurrent, setShownCurrent] = useState(false);
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<'wrong' | 'same' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCurrent('');
    setNext('');
    setConfirm('');
    setShowErrors(false);
    setError(null);
  }, [open]);

  async function submit() {
    if (busy) return;
    if (!current || passphraseProblem(next, confirm)) {
      setShowErrors(true);
      return;
    }
    if (next.normalize('NFC') === current.normalize('NFC')) {
      setError('same');
      return;
    }
    setBusy(true);
    try {
      await library.changePassphrase(current, next);
      toast.show({ message: t('settings.passphrase.done'), tone: 'success', durationMs: 8000 });
      onClose();
    } catch (e) {
      if (e instanceof WrongSecretError) setError('wrong');
      else toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('settings.passphrase.title')}
      description={t('settings.passphrase.body')}
      dismissible={!busy}
      onSubmit={() => void submit()}
      data-testid="change-passphrase-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" busy={busy} data-testid="change-passphrase-submit">
            {busy ? t('settings.passphrase.working') : t('settings.passphrase.submit')}
          </Button>
        </>
      }
    >
      <div className="set-dialog">
        <SecretField
          label={t('settings.passphrase.current')}
          value={current}
          onChange={(v) => {
            setCurrent(v);
            setError(null);
          }}
          shown={shownCurrent}
          onToggle={() => setShownCurrent((s) => !s)}
          error={error === 'wrong' ? t('settings.passphrase.wrong') : showErrors && !current ? t('settings.passphrase.currentRequired') : undefined}
          autoFocus
          data-testid="current-passphrase"
        />
        <PassphraseFields
          label={t('settings.passphrase.next')}
          value={next}
          confirm={confirm}
          onChange={(v) => {
            setNext(v);
            if (error === 'same') setError(null);
          }}
          onConfirm={setConfirm}
          showErrors={showErrors}
        />
        {error === 'same' ? <Notice tone="warning">{t('settings.passphrase.same')}</Notice> : null}
        <Notice tone="info">{t('settings.passphrase.backupNote')}</Notice>
      </div>
    </Dialog>
  );
}

type Step = 'confirm' | 'show' | 'check';

/**
 * A new recovery phrase: the passphrase proves it is the researcher, the new words are shown
 * and checked, and only then is the old phrase replaced.
 */
export function NewRecoveryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const library = useLibrary();
  const platform = usePlatform();
  const toast = useToast();
  const [step, setStep] = useState<Step>('confirm');
  const [pass, setPass] = useState('');
  const [shown, setShown] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [written, setWritten] = useState(false);
  const [copied, setCopied] = useState(false);
  const [checks, setChecks] = useState<Record<number, string>>({});
  const [checkError, setCheckError] = useState(false);
  const [busy, setBusy] = useState(false);
  const words = useMemo(() => phrase.split(' ').filter(Boolean), [phrase]);
  const positions = useMemo(() => (phrase ? pickCheckPositions() : []), [phrase]);

  useEffect(() => {
    if (!open) return;
    setStep('confirm');
    setPass('');
    setWrong(false);
    setPhrase('');
    setWritten(false);
    setCopied(false);
    setChecks({});
    setCheckError(false);
  }, [open]);

  async function verify() {
    if (!pass || busy) return;
    setBusy(true);
    try {
      wipe(await unlockKeyring(library.currentKeyring, 'passphrase', pass, platform.kdf));
      setPass('');
      setPhrase(newRecoveryPhrase());
      setStep('show');
    } catch (e) {
      if (e instanceof WrongSecretError) setWrong(true);
      else toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function replace() {
    if (busy) return;
    if (!positions.every((p) => wordMatches(checks[p] ?? '', words[p - 1] ?? ''))) {
      setCheckError(true);
      return;
    }
    setBusy(true);
    try {
      await library.changeSecret('recovery_phrase', phrase);
      toast.show({ message: t('settings.recovery.done'), tone: 'success', durationMs: 8000 });
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  const footer =
    step === 'confirm' ? (
      <>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" busy={busy} disabled={!pass} data-testid="recovery-verify">
          {busy ? t('settings.recovery.checking') : t('settings.recovery.show')}
        </Button>
      </>
    ) : step === 'show' ? (
      <>
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={!written} data-testid="recovery-next">
          {t('common.next')}
        </Button>
      </>
    ) : (
      <>
        <Button variant="ghost" onClick={() => setStep('show')} disabled={busy}>
          {t('common.back')}
        </Button>
        <Button type="submit" variant="primary" busy={busy} data-testid="recovery-replace">
          {busy ? t('settings.recovery.working') : t('settings.recovery.replace')}
        </Button>
      </>
    );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('settings.recovery.title')}
      size={step === 'show' ? 'lg' : 'md'}
      dismissible={!busy}
      onSubmit={() => {
        if (step === 'confirm') void verify();
        else if (step === 'show') {
          if (written) setStep('check');
        } else void replace();
      }}
      data-testid="new-recovery-dialog"
      footer={footer}
    >
      {step === 'confirm' ? (
        <div className="set-dialog">
          <p className="set-dialog__text">{t('settings.recovery.explain')}</p>
          <Notice tone="info">{t('settings.recovery.explainBackups')}</Notice>
          <SecretField
            label={t('settings.recovery.passphrase')}
            value={pass}
            onChange={(v) => {
              setPass(v);
              setWrong(false);
            }}
            shown={shown}
            onToggle={() => setShown((s) => !s)}
            error={wrong ? t('settings.recovery.wrong') : undefined}
            autoFocus
            data-testid="recovery-passphrase"
          />
        </div>
      ) : step === 'show' ? (
        <div className="set-dialog">
          <p className="set-dialog__text">{t('settings.recovery.phraseBody')}</p>
          <div className="phrase">
            <ol className="phrase__grid" aria-label={t('settings.recovery.phraseLabel')} data-testid="new-recovery-phrase">
              {words.map((w, i) => (
                <li key={i} className="phrase__word">
                  <span className="phrase__n" aria-hidden>
                    {i + 1}
                  </span>
                  <span className="phrase__w" translate="no">
                    {w}
                  </span>
                </li>
              ))}
            </ol>
            <div className="phrase__tools">
              <p className="phrase__paper">
                <KeyRound size={15} aria-hidden strokeWidth={1.75} />
                <span>{copied ? t('settings.recovery.copied') : t('settings.recovery.paper')}</span>
              </p>
              <div className="phrase__buttons">
                <Button size="sm" variant="ghost" icon={Copy} onClick={() => void navigator.clipboard?.writeText(phrase).then(() => setCopied(true), () => undefined)} data-testid="new-recovery-copy">
                  {t('settings.recovery.copy')}
                </Button>
              </div>
            </div>
          </div>
          <Checkbox checked={written} onChange={setWritten} label={t('settings.recovery.written')} data-testid="new-recovery-written" />
        </div>
      ) : (
        <div className="set-dialog">
          <p className="set-dialog__text">{t('settings.recovery.checkBody')}</p>
          <div className="check-words">
            {positions.map((p, i) => (
              <TextField
                key={p}
                label={t('settings.recovery.word', { n: p })}
                value={checks[p] ?? ''}
                onChange={(v) => {
                  setChecks((c) => ({ ...c, [p]: v }));
                  setCheckError(false);
                }}
                autoFocus={i === 0}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                data-testid={`new-recovery-check-${p}`}
              />
            ))}
          </div>
          {checkError ? <Notice tone="danger">{t('settings.recovery.checkWrong')}</Notice> : null}
        </div>
      )}
    </Dialog>
  );
}

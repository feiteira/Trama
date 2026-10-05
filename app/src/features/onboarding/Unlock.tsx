import React, { useRef, useState } from 'react';
import { ArrowLeft, Lock, Trash2 } from 'lucide-react';
import { isValidRecoveryPhrase, WrongSecretError } from '../../core/crypto/keyring';
import { EXAMPLE_PASSPHRASE } from '../../demo/exampleConstants';
import { Library } from '../../services/library';
import { type LockedReason, useAppState } from '../../shell/AppState';
import { useI18n } from '../../ui/i18n';
import { Button } from '../../ui/components/Button';
import { useConfirm } from '../../ui/components/Confirm';
import { Notice } from '../../ui/components/Feedback';
import { TextArea } from '../../ui/components/Field';
import { Frame, LanguagePicker } from './Frame';
import { PassphraseFields } from './PassphraseFields';
import { passphraseProblem } from './passphrase';
import { SecretField } from './SecretField';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The locked library: passphrase, or the recovery phrase and a new passphrase. */
export function Unlock({ reason }: { reason?: LockedReason }) {
  const { platform, example, canLeaveExample, leaveExample, unlocked, prefs, libraryOptions, erased } = useAppState();
  const { t } = useI18n();
  const confirm = useConfirm();
  const [mode, setMode] = useState<'pass' | 'phrase'>('pass');
  const [pass, setPass] = useState('');
  const [shown, setShown] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newConfirm, setNewConfirm] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passRef = useRef<HTMLInputElement>(null);
  // Enter pressed again while the library opens must not open it twice: a second Library
  // would hold the keys where locking never wipes them. A ref, since state lags a render.
  const busyRef = useRef(false);

  async function openWithPass() {
    if (!pass || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const library = await Library.unlock(platform, 'passphrase', pass, libraryOptions);
      await unlocked(library);
    } catch (e) {
      if (!(e instanceof WrongSecretError)) console.error('unlocking failed', e);
      setError(e instanceof WrongSecretError ? t('onboarding.unlock.wrong') : t('onboarding.unlock.failed', { message: message(e) }));
      setPass('');
      requestAnimationFrame(() => passRef.current?.focus());
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function openWithPhrase() {
    if (busyRef.current) return;
    if (!isValidRecoveryPhrase(phrase)) {
      setError(t('onboarding.unlock.phraseInvalid'));
      return;
    }
    if (passphraseProblem(newPass, newConfirm)) {
      setShowErrors(true);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    let library: Library | null = null;
    try {
      library = await Library.unlock(platform, 'recovery_phrase', phrase, libraryOptions);
      await library.changeSecret('passphrase', newPass);
      await unlocked(library);
    } catch (e) {
      // Not opened: lock it again, so its keys do not stay in memory.
      await library?.lock().catch(() => undefined);
      if (!(e instanceof WrongSecretError)) console.error('unlocking with the recovery phrase failed', e);
      setError(e instanceof WrongSecretError ? t('onboarding.unlock.phraseWrong') : t('onboarding.unlock.failed', { message: message(e) }));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function eraseAll() {
    const ok = await confirm({
      title: t('onboarding.unlock.eraseTitle'),
      body: t('onboarding.unlock.eraseBody'),
      confirmLabel: t('onboarding.unlock.erase'),
      danger: true,
      typeToConfirm: t('onboarding.unlock.eraseWord'),
    });
    if (!ok) return;
    try {
      await platform.eraseAll();
      erased();
    } catch (e) {
      setError(t('onboarding.unlock.eraseFailed', { message: message(e) }));
    }
  }

  const footer = (
    <>
      <LanguagePicker />
      {canLeaveExample ? (
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => void leaveExample()} data-testid="leave-example">
          {t('app.example.leave')}
        </Button>
      ) : null}
    </>
  );

  if (reason === 'noKeyring') {
    return (
      <Frame testId="unlock-no-keyring" footer={footer}>
        <Notice tone="danger" title={t('onboarding.unlock.noKeyringTitle')}>
          {t('onboarding.unlock.noKeyring')}
        </Notice>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div>
          <Button variant="danger" icon={Trash2} onClick={() => void eraseAll()} data-testid="erase-all">
            {t('onboarding.unlock.erase')}
          </Button>
        </div>
      </Frame>
    );
  }

  return (
    <Frame testId="unlock" footer={footer}>
      {example ? <Notice tone="warning">{t('onboarding.unlock.exampleHint', { pass: EXAMPLE_PASSPHRASE })}</Notice> : null}
      {reason === 'idle' ? (
        <Notice tone="neutral" icon={Lock}>
          {t('onboarding.unlock.idle', { n: prefs.autoLockMinutes })}
        </Notice>
      ) : null}
      {mode === 'pass' ? (
        <form
          className="onb__form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void openWithPass();
          }}
        >
          <h1 className="onb__title">{t('onboarding.unlock.title')}</h1>
          <p className="onb__body">{t('onboarding.unlock.body')}</p>
          <SecretField
            ref={passRef}
            label={t('onboarding.unlock.passphrase')}
            value={pass}
            onChange={(v) => {
              setPass(v);
              setError(null);
            }}
            shown={shown}
            onToggle={() => setShown(!shown)}
            autoFocus
            size="lg"
            error={error ?? undefined}
            data-testid="unlock-passphrase"
            toggleTestId="unlock-show"
          />
          <Button type="submit" variant="primary" size="lg" busy={busy} disabled={!pass} data-testid="unlock-submit" className="onb__submit">
            {busy ? t('onboarding.unlock.opening') : t('onboarding.unlock.submit')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="onb__alt"
            onClick={() => {
              setMode('phrase');
              setError(null);
            }}
            data-testid="unlock-use-phrase"
          >
            {t('onboarding.unlock.usePhrase')}
          </Button>
        </form>
      ) : (
        <form
          className="onb__form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void openWithPhrase();
          }}
        >
          <h1 className="onb__title">{t('onboarding.unlock.phraseTitle')}</h1>
          <p className="onb__body">{t('onboarding.unlock.phraseBody')}</p>
          <TextArea
            label={t('onboarding.unlock.phraseLabel')}
            value={phrase}
            onChange={(v) => {
              setPhrase(v);
              setError(null);
            }}
            autoGrow
            minHeight={76}
            maxHeight={160}
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="phrase-input"
            data-testid="unlock-phrase"
          />
          {/* No autoFocus here: the cursor stays in the recovery phrase above. */}
          <PassphraseFields value={newPass} confirm={newConfirm} onChange={setNewPass} onConfirm={setNewConfirm} label={t('onboarding.unlock.newPassphrase')} showErrors={showErrors} />
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button type="submit" variant="primary" size="lg" busy={busy} data-testid="unlock-with-phrase" className="onb__submit">
            {busy ? t('onboarding.unlock.opening') : t('onboarding.unlock.submit')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="onb__alt"
            onClick={() => {
              setMode('pass');
              setError(null);
            }}
          >
            {t('onboarding.unlock.usePassphrase')}
          </Button>
        </form>
      )}
    </Frame>
  );
}

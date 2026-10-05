import React, { useMemo, useRef, useState } from 'react';
import { ArrowLeft, Copy, KeyRound, Printer, ShieldCheck, Sparkles, UserRoundX, WifiOff } from 'lucide-react';
import { newRecoveryPhrase } from '../../core/crypto/keyring';
import { Library } from '../../services/library';
import { useAppState } from '../../shell/AppState';
import { useI18n } from '../../ui/i18n';
import { Button } from '../../ui/components/Button';
import { Checkbox } from '../../ui/components/Choice';
import { Notice } from '../../ui/components/Feedback';
import { TextField } from '../../ui/components/Field';
import { Brand, Frame, LanguagePicker, Steps } from './Frame';
import { PassphraseFields } from './PassphraseFields';
import { passphraseProblem, pickCheckPositions, wordMatches } from './passphrase';
import { Specimen } from './Specimen';

type Step = 'welcome' | 'name' | 'passphrase' | 'phrase' | 'check';
const TOTAL = 4;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** First run: what Trama is, then creating the library in four steps. */
export function Welcome() {
  const { platform, prefs, setPrefs, unlocked, startExample, libraryOptions } = useAppState();
  const { t } = useI18n();
  const [step, setStep] = useState<Step>('welcome');
  const [name, setName] = useState(prefs.coderName);
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  // Made once per visit: going back and forth between steps keeps the same phrase.
  const phrase = useMemo(() => newRecoveryPhrase(), []);
  const words = phrase.split(' ');
  const positions = useMemo(() => pickCheckPositions(), []);
  const [written, setWritten] = useState(false);
  const [copied, setCopied] = useState(false);
  const [checks, setChecks] = useState<Record<number, string>>({});
  const [checkError, setCheckError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Enter pressed again while the library is being made must not make a second one.
  const busyRef = useRef(false);

  async function tryExample() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await startExample();
    } catch (e) {
      console.error(e);
      setError(t('onboarding.welcome.exampleFailed', { message: message(e) }));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function create() {
    if (busyRef.current) return;
    if (!positions.every((p) => wordMatches(checks[p] ?? '', words[p - 1] ?? ''))) {
      setCheckError(true);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const library = await Library.create(platform, { passphrase: pass, recoveryPhrase: phrase }, libraryOptions);
      await setPrefs({ coderName: name.trim() }).catch((e: unknown) => console.error('saving the name failed', e));
      await unlocked(library);
    } catch (e) {
      console.error('creating the library failed', e);
      setError(t('onboarding.check.failed', { message: message(e) }));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (step === 'welcome') {
    return (
      <div className="welcome" data-testid="welcome">
        <div className="welcome__intro">
          <Brand />
          <div className="welcome__text">
            <h1 className="welcome__title">{t('onboarding.welcome.title')}</h1>
            <p className="welcome__body">{t('onboarding.welcome.body')}</p>
          </div>
          <div className="welcome__actions">
            <Button variant="primary" size="lg" onClick={() => setStep('name')} data-testid="start-create">
              {t('onboarding.welcome.create')}
            </Button>
            <Button variant="secondary" size="lg" icon={Sparkles} busy={busy} onClick={() => void tryExample()} data-testid="start-example">
              {t('onboarding.welcome.tryExample')}
            </Button>
          </div>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <section className="promise" aria-label={t('onboarding.welcome.promise')}>
            <div className="promise__item">
              <UserRoundX size={18} aria-hidden strokeWidth={1.6} />
              <div>
                <div className="promise__title">{t('onboarding.welcome.noAccount')}</div>
                <div className="promise__body">{t('onboarding.welcome.noAccountBody')}</div>
              </div>
            </div>
            <div className="promise__item">
              <WifiOff size={18} aria-hidden strokeWidth={1.6} />
              <div>
                <div className="promise__title">{t('onboarding.welcome.noInternet')}</div>
                <div className="promise__body">{t('onboarding.welcome.noInternetBody')}</div>
              </div>
            </div>
            <div className="promise__item">
              <ShieldCheck size={18} aria-hidden strokeWidth={1.6} />
              <div>
                <div className="promise__title">{t('onboarding.welcome.encrypted')}</div>
                <div className="promise__body">{t('onboarding.welcome.encryptedBody')}</div>
              </div>
            </div>
          </section>
          <LanguagePicker />
        </div>
        <div className="welcome__picture">
          <Specimen />
        </div>
      </div>
    );
  }

  const nav = (back: Step, nextLabel: string, opts: { disabled?: boolean; testId?: string } = {}) => (
    <div className="onb__nav">
      <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep(back)} disabled={busy} data-testid="step-back">
        {t('common.back')}
      </Button>
      <Button type="submit" variant="primary" busy={busy} disabled={opts.disabled} data-testid={opts.testId ?? 'step-next'}>
        {nextLabel}
      </Button>
    </div>
  );

  const form = (onSubmit: () => void, children: React.ReactNode) => (
    <form
      className="onb__form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );

  if (step === 'name') {
    const next = () => (name.trim() ? setStep('passphrase') : setShowErrors(true));
    return (
      <Frame testId="create-name" footer={<LanguagePicker />}>
        {form(
          next,
          <>
            <Steps n={1} total={TOTAL} />
            <h1 className="onb__title">{t('onboarding.name.title')}</h1>
            <p className="onb__body">{t('onboarding.name.body')}</p>
            <TextField
              label={t('onboarding.name.label')}
              placeholder={t('onboarding.name.placeholder')}
              value={name}
              onChange={(v) => {
                setName(v);
                setShowErrors(false);
              }}
              autoFocus
              autoComplete="name"
              maxLength={200}
              size="lg"
              error={showErrors && !name.trim() ? t('onboarding.name.required') : undefined}
              data-testid="coder-name"
            />
            {nav('welcome', t('common.next'))}
          </>,
        )}
      </Frame>
    );
  }

  if (step === 'passphrase') {
    const next = () => {
      if (passphraseProblem(pass, confirm)) setShowErrors(true);
      else {
        setShowErrors(false);
        setStep('phrase');
      }
    };
    return (
      <Frame testId="create-passphrase">
        {form(
          next,
          <>
            <Steps n={2} total={TOTAL} />
            <h1 className="onb__title">{t('onboarding.passphrase.title')}</h1>
            <p className="onb__body">{t('onboarding.passphrase.body')}</p>
            <PassphraseFields value={pass} confirm={confirm} onChange={setPass} onConfirm={setConfirm} showErrors={showErrors} autoFocus />
            {nav('name', t('common.next'))}
          </>,
        )}
      </Frame>
    );
  }

  if (step === 'phrase') {
    return (
      <Frame wide testId="create-phrase">
        {form(
          () => written && setStep('check'),
          <>
            <Steps n={3} total={TOTAL} />
            <h1 className="onb__title">{t('onboarding.phrase.title')}</h1>
            <p className="onb__body">{t('onboarding.phrase.body')}</p>
            <div className="phrase">
              <ol className="phrase__grid" aria-label={t('onboarding.phrase.label')} data-testid="recovery-phrase">
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
                  <span>{copied ? t('onboarding.phrase.copied') : t('onboarding.phrase.paper')}</span>
                </p>
                <div className="phrase__buttons">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Copy}
                    onClick={() => void navigator.clipboard?.writeText(phrase).then(() => setCopied(true), () => undefined)}
                    data-testid="phrase-copy"
                  >
                    {t('onboarding.phrase.copy')}
                  </Button>
                  <Button size="sm" variant="ghost" icon={Printer} onClick={() => window.print()}>
                    {t('onboarding.phrase.print')}
                  </Button>
                </div>
              </div>
            </div>
            <Checkbox checked={written} onChange={setWritten} label={t('onboarding.phrase.written')} data-testid="phrase-written" />
            {nav('passphrase', t('common.next'), { disabled: !written })}
          </>,
        )}
      </Frame>
    );
  }

  // step === 'check'
  return (
    <Frame testId="create-check">
      {form(
        () => void create(),
        <>
          <Steps n={4} total={TOTAL} />
          <h1 className="onb__title">{t('onboarding.check.title')}</h1>
          <p className="onb__body">{t('onboarding.check.body')}</p>
          <div className="check-words">
            {positions.map((p, i) => (
              <TextField
                key={p}
                label={t('onboarding.check.word', { n: p })}
                value={checks[p] ?? ''}
                onChange={(v) => {
                  setChecks((c) => ({ ...c, [p]: v }));
                  setCheckError(false);
                }}
                autoFocus={i === 0}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                data-testid={`check-word-${p}`}
              />
            ))}
          </div>
          {checkError ? <Notice tone="danger">{t('onboarding.check.wrong')}</Notice> : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {nav('phrase', busy ? t('onboarding.check.creating') : t('onboarding.check.create'), { testId: 'create-library' })}
        </>,
      )}
    </Frame>
  );
}

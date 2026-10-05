import React, { useState } from 'react';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import { MIN_PASSPHRASE, passphraseProblem, strength } from './passphrase';
import { SecretField } from './SecretField';

/**
 * A new passphrase, typed twice, with a strength meter and Show/Hide for both. Takes the focus
 * only when asked: below another field (the recovery phrase) it must not pull the cursor away.
 */
export function PassphraseFields({
  value, confirm, onChange, onConfirm, label, showErrors, autoFocus = false,
}: {
  value: string;
  confirm: string;
  onChange: (v: string) => void;
  onConfirm: (v: string) => void;
  label?: string;
  showErrors: boolean;
  autoFocus?: boolean;
}) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  const s = strength(value);
  const names = [t('onboarding.passphrase.strength.weak'), t('onboarding.passphrase.strength.fair'), t('onboarding.passphrase.strength.good'), t('onboarding.passphrase.strength.strong')];
  const problem = showErrors ? passphraseProblem(value, confirm) : null;
  return (
    <div className="passphrase-fields">
      <div className="passphrase-fields__first">
        <SecretField
          label={label ?? t('onboarding.passphrase.label')}
          value={value}
          onChange={onChange}
          shown={shown}
          onToggle={() => setShown(!shown)}
          autoFocus={autoFocus}
          hint={problem === 'tooShort' ? undefined : t('onboarding.passphrase.hint', { n: MIN_PASSPHRASE })}
          error={problem === 'tooShort' ? t('onboarding.passphrase.tooShort', { n: MIN_PASSPHRASE }) : undefined}
          data-testid="passphrase"
          toggleTestId="passphrase-show"
        />
        <div className={cx('meter', value ? `meter--${s}` : 'meter--empty')} aria-live="polite">
          <div className="meter__bars" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={cx('meter__bar', value && i <= s && 'meter__bar--on')} />
            ))}
          </div>
          {value ? <span className="meter__text">{t('onboarding.passphrase.strength.label', { value: names[s]! })}</span> : null}
        </div>
      </div>
      <SecretField
        label={t('onboarding.passphrase.confirm')}
        value={confirm}
        onChange={onConfirm}
        shown={shown}
        error={problem === 'mismatch' ? t('onboarding.passphrase.mismatch') : undefined}
        data-testid="passphrase-confirm"
      />
    </div>
  );
}

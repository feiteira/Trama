import React, { forwardRef } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useI18n } from '../../ui/i18n';
import { TextField, type TextFieldProps } from '../../ui/components/Field';

/** "Show" / "Hide" beside a passphrase field's label: typing a long passphrase blind is error-prone. */
export function ShowSecret({ shown, onToggle, testId }: { shown: boolean; onToggle: () => void; testId?: string }) {
  const { t } = useI18n();
  const Icon = shown ? EyeOff : Eye;
  return (
    <button type="button" className="show-secret" onClick={onToggle} aria-pressed={shown} aria-label={shown ? t('onboarding.passphrase.hideLabel') : t('onboarding.passphrase.showLabel')} data-testid={testId}>
      <Icon size={14} aria-hidden strokeWidth={1.75} />
      <span aria-hidden>{shown ? t('onboarding.passphrase.hide') : t('onboarding.passphrase.show')}</span>
    </button>
  );
}

/** A passphrase field whose text can be shown while typing. */
export const SecretField = forwardRef<HTMLInputElement, Omit<TextFieldProps, 'type'> & { shown: boolean; onToggle?: () => void; toggleTestId?: string }>(function SecretField(
  { shown, onToggle, toggleTestId, ...rest },
  ref,
) {
  return (
    <TextField
      ref={ref}
      type={shown ? 'text' : 'password'}
      autoComplete="off"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      labelAside={onToggle ? <ShowSecret shown={shown} onToggle={onToggle} testId={toggleTestId} /> : undefined}
      {...rest}
    />
  );
});

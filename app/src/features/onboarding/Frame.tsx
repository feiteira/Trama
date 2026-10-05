import React, { type ReactNode } from 'react';
import { UI_LOCALE_META, UI_LOCALES, type UiLocale } from '../../core/i18n/languages';
import { usePrefs } from '../../shell/AppState';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import { RadioGroup } from '../../ui/components/Choice';
import './onboarding.css';

/** Trama's mark: a few weft threads crossing the warp, drawn in ink. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden className="brand-mark">
      <rect x="0.5" y="0.5" width="27" height="27" rx="7" className="brand-mark__ground" />
      {/* Two warp threads and three weft threads, each passing over and under in turn: the
          gaps in a thread are where the other one crosses over it. */}
      <path d="M10 5v.6M10 10.4v7.2M10 22.4v.6M18 5v6.6M18 16.4V23" className="brand-mark__warp" />
      <path d="M5 8h10.6M20.4 8H23M5 14h2.6M12.4 14H23M5 20h10.6M20.4 20H23" className="brand-mark__weft" />
    </svg>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <BrandMark />
      <span className="brand__name" translate="no">
        Trama
      </span>
    </div>
  );
}

/** The interface language, as a segmented choice (applies at once). */
export function LanguagePicker({ className }: { className?: string }) {
  const { prefs, setPrefs } = usePrefs();
  const { t } = useI18n();
  return (
    <RadioGroup<UiLocale>
      className={cx('language-picker', className)}
      label={t('onboarding.language')}
      variant="segmented"
      value={prefs.locale}
      onChange={(locale) => void setPrefs({ locale })}
      options={UI_LOCALES.map((l) => ({ value: l, label: <span lang={UI_LOCALE_META[l].bcp47}>{UI_LOCALE_META[l].nativeName.replace(/ \(.*\)$/, '')}</span> }))}
      data-testid="language"
    />
  );
}

/** The page around the setup steps and the unlock screen: the brand, then one column. */
export function Frame({ children, footer, wide, testId }: { children: ReactNode; footer?: ReactNode; wide?: boolean; testId?: string }) {
  return (
    <div className="onb" data-testid={testId}>
      <div className={cx('onb__column', wide && 'onb__column--wide')}>
        <Brand />
        <main className="onb__main">{children}</main>
        {footer ? <footer className="onb__footer">{footer}</footer> : null}
      </div>
    </div>
  );
}

/** Step n of total, as a progress line and text. */
export function Steps({ n, total }: { n: number; total: number }) {
  const { t } = useI18n();
  return (
    <div className="steps">
      <div className="steps__bar" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cx('steps__seg', i < n && 'steps__seg--done')} />
        ))}
      </div>
      <span className="steps__text">{t('onboarding.stepOf', { n, total })}</span>
    </div>
  );
}

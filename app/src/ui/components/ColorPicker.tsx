import React, { useEffect, useId, useState } from 'react';
import { Check } from 'lucide-react';
import { PALETTE } from '../../core/model/types';
import { inkOn, normalizeHex } from '../color';
import { cx } from '../cx';
import { useI18n } from '../i18n';
import './colorpicker.css';

export interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  label: string;
  /** Offer a custom colour beside the palette (default true). */
  custom?: boolean;
  className?: string;
  'data-testid'?: string;
}

/**
 * The palette as a radio group of swatches (arrow keys move between them), plus a custom
 * #rrggbb typed or picked with the system picker. Always reports lower-case #rrggbb.
 */
export function ColorPicker({ value, onChange, label, custom = true, className, ...rest }: ColorPickerProps) {
  const { t } = useI18n();
  const name = useId();
  const current = normalizeHex(value) ?? PALETTE[0];
  const inPalette = (PALETTE as readonly string[]).includes(current);
  const [text, setText] = useState(current);
  useEffect(() => setText(current), [current]);
  const testId = rest['data-testid'];

  return (
    <fieldset className={cx('colorpicker', className)} data-testid={testId}>
      <legend className="field__label">{label}</legend>
      <div className="colorpicker__swatches" role="radiogroup" aria-label={label}>
        {PALETTE.map((c, i) => (
          <label key={c} className="colorpicker__swatch" style={{ background: c }} title={c}>
            <input
              type="radio"
              name={name}
              value={c}
              checked={current === c}
              onChange={() => onChange(c)}
              className="choice__input"
              aria-label={t('common.colourN', { n: i + 1, hex: c })}
              data-testid={testId ? `${testId}-${i}` : undefined}
            />
            {current === c ? <Check size={14} strokeWidth={3} color={inkOn(c)} aria-hidden /> : null}
          </label>
        ))}
      </div>
      {custom ? (
        <div className="colorpicker__custom">
          <label className={cx('colorpicker__native', !inPalette && 'colorpicker__native--on')} style={{ background: current }} title={t('common.customColour')}>
            <input type="color" value={current} onChange={(e) => onChange(e.target.value.toLowerCase())} aria-label={t('common.customColour')} />
          </label>
          <input
            className="colorpicker__hex"
            value={text}
            spellCheck={false}
            maxLength={7}
            aria-label={t('common.hexColour')}
            aria-invalid={normalizeHex(text) === null || undefined}
            onChange={(e) => {
              setText(e.target.value);
              const n = normalizeHex(e.target.value);
              // Only complete colours apply: "#3a6" while typing "#3a6ea5" would flash a wrong one.
              if (n && e.target.value.replace('#', '').length === 6) onChange(n);
            }}
            onBlur={() => {
              const n = normalizeHex(text);
              if (n) onChange(n);
              else setText(current);
            }}
            data-testid={testId ? `${testId}-hex` : undefined}
          />
        </div>
      ) : null}
    </fieldset>
  );
}

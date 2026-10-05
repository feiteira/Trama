import React from 'react';
import { useI18n } from '../../../ui/i18n';
import { rampGradient, type Theme } from '../lib/heat';

/** The colour scale of a heat matrix: empty, low → high, and the diagonal when it has one. */
export function HeatLegend({ theme, max, low, format, diagonal, unit }: { theme: Theme; max: number; low?: number; format: (v: number) => string; diagonal?: string; unit?: string }) {
  const { t } = useI18n();
  return (
    <div className="an-legend" aria-hidden>
      <span className="an-legend__item">
        <span className="an-legend__swatch an-legend__swatch--empty" />
        {t('analysis.legend.none')}
      </span>
      <span className="an-legend__item">
        <span className="an-legend__low">{format(low ?? Math.min(1, max))}</span>
        <span className="an-legend__ramp" style={{ background: rampGradient(theme) }} />
        <span>{format(max)}</span>
        {unit ? <span className="an-legend__unit">{unit}</span> : null}
      </span>
      {diagonal ? (
        <span className="an-legend__item">
          <span className="an-legend__swatch an-legend__swatch--diag" />
          {diagonal}
        </span>
      ) : null}
    </div>
  );
}

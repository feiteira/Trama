import React from 'react';
import { useI18n, type MessageKey } from '../../ui/i18n';
import { withAlpha } from '../../ui/color';
import { codesIn, parseMarks } from './marks';

// The welcome screen's picture of what Trama is for: a page of transcript with passages coded,
// and the coding stripes in the margin, as researchers know them from paper and from other
// QDA tools. The colours of codes are the only saturated colour on the screen.

const CODES: Record<string, { color: string; label: MessageKey }> = {
  a: { color: '#3a6ea5', label: 'onboarding.specimen.codeA' },
  b: { color: '#f3a712', label: 'onboarding.specimen.codeB' },
  c: { color: '#29a37a', label: 'onboarding.specimen.codeC' },
  d: { color: '#b5179e', label: 'onboarding.specimen.codeD' },
};

function Turn({ speaker, text, interviewer }: { speaker: string; text: string; interviewer?: boolean }) {
  const { t } = useI18n();
  const codes = codesIn(text);
  return (
    <div className="specimen__turn">
      <p className={interviewer ? 'specimen__text specimen__text--q' : 'specimen__text'}>
        <span className="specimen__speaker">{speaker}: </span>
        {parseMarks(text).map((p, i) => {
          const code = p.code ? CODES[p.code] : undefined;
          return code ? (
            <mark key={i} className="specimen__coded" style={{ background: withAlpha(code.color, 0.16), boxShadow: `inset 0 -2px 0 ${withAlpha(code.color, 0.75)}` }}>
              {p.text}
            </mark>
          ) : (
            <React.Fragment key={i}>{p.text}</React.Fragment>
          );
        })}
      </p>
      <div className="specimen__margin">
        {codes.map((c) => {
          const code = CODES[c];
          if (!code) return null;
          return (
            <span key={c} className="specimen__stripe">
              <span className="specimen__bar" style={{ background: code.color }} />
              <span className="specimen__code">{t(code.label)}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function Specimen() {
  const { t } = useI18n();
  return (
    <figure className="specimen" aria-label={t('onboarding.specimen.label')}>
      <figcaption className="specimen__head">
        <span className="specimen__title">{t('onboarding.specimen.title')}</span>
        <span className="specimen__meta">{t('onboarding.specimen.meta')}</span>
      </figcaption>
      <div className="specimen__body">
        <Turn interviewer speaker={t('onboarding.specimen.interviewer')} text={t('onboarding.specimen.q1')} />
        <Turn speaker={t('onboarding.specimen.participant')} text={t('onboarding.specimen.a1')} />
        <Turn interviewer speaker={t('onboarding.specimen.interviewer')} text={t('onboarding.specimen.q2')} />
        <Turn speaker={t('onboarding.specimen.participant')} text={t('onboarding.specimen.a2')} />
      </div>
    </figure>
  );
}

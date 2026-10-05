import React, { Fragment } from 'react';
import type { I18n } from '../../ui/i18n';
import { useI18n } from '../../ui/i18n';
import { Kbd } from '../../ui/components/Feedback';
import type { Section } from './manualModel';
import { formatKeys, SHORTCUTS } from './shortcuts';

/** The shortcuts reference's sections, for the contents and the scroll position. */
export function shortcutSections(t: I18n['t']): Section[] {
  return SHORTCUTS.map((g) => ({ level: 2, title: t(`help.keys.groups.${g.group}`), anchor: `keys-${g.group}` }));
}

/** Every keyboard shortcut, grouped by where it works, the way this computer writes them. */
export function ShortcutsView({ mac, idOf }: { mac: boolean; idOf: (anchor: string) => string }) {
  const { t } = useI18n();
  return (
    <div className="shortcuts" data-testid="help-shortcuts">
      <h1 className="manual__h1">{t('help.keys.title')}</h1>
      <p className="manual__p manual__lead">{t('help.keys.lead')}</p>
      {mac ? <p className="manual__p">{t('help.keys.mac')}</p> : null}
      {SHORTCUTS.map((g) => (
        <section key={g.group} className="shortcuts__group">
          <h2 className="manual__h2" id={idOf(`keys-${g.group}`)} tabIndex={-1}>
            {t(`help.keys.groups.${g.group}`)}
          </h2>
          <dl className="shortcuts__list">
            {g.items.map((s) => (
              <div className="shortcuts__row" key={s.label}>
                <dt className="shortcuts__label">{t(`help.keys.labels.${s.label}`)}</dt>
                <dd className="shortcuts__keys">
                  {s.keys.map((k, i) => (
                    <Fragment key={i}>
                      {i > 0 ? <span className="shortcuts__or">{s.keys.length > 2 ? '' : t('help.keys.or')}</span> : null}
                      <Kbd>{formatKeys(k, mac)}</Kbd>
                    </Fragment>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <p className="manual__p manual__aside">{t('help.keys.hint')}</p>
    </div>
  );
}

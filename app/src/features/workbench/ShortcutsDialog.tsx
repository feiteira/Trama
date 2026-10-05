import React from 'react';
import { Dialog } from '../../ui/components/Dialog';
import { Kbd } from '../../ui/components/Feedback';
import { useKeyLabel } from '../../shell/keys';
import { type MessageKey, useI18n } from '../../ui/i18n';

// The workbench's keyboard map (the ? key).

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const key = useKeyLabel();
  const groups: { title: MessageKey; rows: [string[], MessageKey][] }[] = [
    {
      title: 'workbench.keys.groupReading',
      rows: [
        [['↑', '↓', '←', '→'], 'workbench.keys.move'],
        [['Shift+←', 'Shift+→', 'Shift+↑', 'Shift+↓'], 'workbench.keys.select'],
        [[key('F')], 'workbench.keys.find'],
        [['Enter'], 'workbench.keys.openHere'],
        [['?'], 'workbench.keys.help'],
      ],
    },
    {
      title: 'workbench.keys.groupCoding',
      rows: [
        [['1 – 9'], 'workbench.keys.favourite'],
        [['Enter'], 'workbench.keys.searchCode'],
        [[key('I')], 'workbench.keys.inVivo'],
        [['Esc'], 'workbench.keys.clear'],
        [['Delete'], 'workbench.keys.remove'],
        [[key('Z'), key('Z', { shift: true })], 'workbench.keys.undo'],
      ],
    },
    {
      title: 'workbench.keys.groupMedia',
      rows: [
        [[key('Space')], 'workbench.keys.playPause'],
        [['Alt+Shift+←', 'Alt+Shift+→'], 'workbench.keys.skip'],
        [['Alt+Enter'], 'workbench.keys.playHere'],
      ],
    },
  ];
  return (
    <Dialog open={open} onClose={onClose} title={t('workbench.keys.title')} size="md" data-testid="shortcuts-dialog">
      <div className="wb-keys">
        {groups.map((g) => (
          <section key={g.title} className="wb-keys__group">
            <h3 className="wb-keys__title">{t(g.title)}</h3>
            <dl className="wb-keys__list">
              {g.rows.map(([keys, label]) => (
                <div key={label} className="wb-keys__row">
                  <dt className="wb-keys__label">{t(label)}</dt>
                  <dd className="wb-keys__keys">
                    {keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

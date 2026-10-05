import React, { useLayoutEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { MenuButton, type MenuEntry } from '../../ui/components/Menu';
import type { ScreenProps } from '../../shell/router';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { Tabs } from '../../ui/components/Tabs';
import { useI18n } from '../../ui/i18n';
import { Compare } from './Compare';
import { Team } from './Team';
import './agreement.css';

export type AgreementTab = 'compare' | 'team';

/** Inter-coder agreement (compare two coders) and team work (coders, copies, merging). */
export default function AgreementScreen(_props: ScreenProps<'agreement'>) {
  const { t } = useI18n();
  const [tab, setTab] = useState<AgreementTab>('compare');
  const [exportItems, setExportItems] = useState<MenuEntry[] | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Both tabs share one scrolling panel: each starts at its top.
  useLayoutEffect(() => {
    panel.current?.parentElement?.scrollTo({ top: 0 });
  }, [tab]);
  return (
    <div className="agr" data-testid="screen-agreement">
      <ScreenHeader
        title={t('agreement.title')}
        actions={
          tab === 'compare' && exportItems ? (
            <MenuButton items={exportItems} label={t('agreement.export.menu')} icon={Download} align="end" data-testid="agreement-export" />
          ) : null
        }
      />
      <Tabs<AgreementTab>
        value={tab}
        onChange={setTab}
        label={t('agreement.tabs.label')}
        items={[
          { value: 'compare', label: t('agreement.tabs.compare') },
          { value: 'team', label: t('agreement.tabs.team') },
        ]}
        className="agr-tabs"
        data-testid="agreement-tabs"
      >
        <div className="agr-panel" ref={panel} data-testid={`screen-agreement-${tab}`}>
          {tab === 'compare' ? <Compare onTeam={() => setTab('team')} onExportItems={setExportItems} /> : <Team onCompare={() => setTab('compare')} />}
        </div>
      </Tabs>
    </div>
  );
}

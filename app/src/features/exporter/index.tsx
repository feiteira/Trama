import React, { useState } from 'react';
import { ArchiveRestore, FileText, Network, Package } from 'lucide-react';
import type { ScreenProps } from '../../shell/router';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { useAppState, useProject } from '../../shell/AppState';
import { useCommands } from '../../shell/useCommands';
import { useI18n } from '../../ui/i18n';
import { Tabs } from '../../ui/components/Tabs';
import { useToast } from '../../ui/components/Toast';
import { backupRunner } from './backupRunner';
import { BACKUP_ERROR_MESSAGE } from './backupView';
import { Backups } from './Backups';
import { ExportPanel } from './ExportPanel';
import { Overview } from './Overview';
import './exporter.css';

export type ProjectTab = 'overview' | 'export' | 'backups';
const TABS: readonly ProjectTab[] = ['overview', 'export', 'backups'];
const TAB_KEY = 'trama.project.tab';

function readTab(): ProjectTab {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return (TABS as readonly string[]).includes(v ?? '') ? (v as ProjectTab) : 'overview';
  } catch {
    return 'overview';
  }
}

/** The project itself: its details and contents, exports, automatic backups, deleting it. */
export default function ProjectScreen(_props: ScreenProps<'project'>) {
  const { t } = useI18n();
  const project = useProject();
  const { example } = useAppState();
  const toast = useToast();
  const [tab, setTabState] = useState<ProjectTab>(readTab);
  const setTab = (next: ProjectTab) => {
    setTabState(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // Not remembered; it still switches.
    }
  };

  /** Shows the Export section with the focus on one export's button. */
  const toExport = (kind: 'trama' | 'qdpx' | 'report') => {
    setTab('export');
    setTimeout(() => {
      const button = document.querySelector<HTMLElement>(`[data-testid="export-${kind}"]`);
      button?.scrollIntoView({ block: 'center' });
      button?.focus();
    }, 50);
  };

  useCommands(
    () => [
      ...(example
        ? []
        : [
            {
              id: 'project.backupNow',
              label: t('exporter.commands.backupNow'),
              group: t('exporter.commands.group'),
              icon: ArchiveRestore,
              run: async () => {
                setTab('backups');
                const outcome = await backupRunner.request(project, 'manual');
                if (outcome.kind === 'written') toast.show({ message: t('exporter.backups.done'), tone: 'success' });
                else if (outcome.kind === 'failed') toast.show({ message: t('exporter.backups.toastFailed', { reason: t(BACKUP_ERROR_MESSAGE[outcome.code]) }), tone: 'danger' });
                else if (outcome.kind === 'skipped' && outcome.reason === 'noFolder') toast.show(t('exporter.backups.status.offBody'));
              },
            },
          ]),
      { id: 'project.exportTrama', label: t('exporter.commands.exportTrama'), group: t('exporter.commands.group'), icon: Package, run: () => toExport('trama') },
      { id: 'project.exportQdpx', label: t('exporter.commands.exportQdpx'), group: t('exporter.commands.group'), icon: Network, run: () => toExport('qdpx') },
      { id: 'project.exportReport', label: t('exporter.commands.exportReport'), group: t('exporter.commands.group'), icon: FileText, run: () => toExport('report') },
    ],
    [t, project, example],
  );

  return (
    <>
      <ScreenHeader title={t('app.nav.project')} subtitle={project.info.name} undo={false} />
      <div className="proj" data-testid="screen-project">
        <div className="proj__column">
          <Tabs<ProjectTab>
            value={tab}
            onChange={setTab}
            label={t('exporter.tabs.label')}
            items={TABS.map((v) => ({ value: v, label: t(`exporter.tabs.${v}`) }))}
            className="proj__tabs"
            data-testid="project-tabs"
          >
            {tab === 'overview' ? <Overview onOpenBackups={() => setTab('backups')} /> : tab === 'export' ? <ExportPanel /> : <Backups />}
          </Tabs>
        </div>
      </div>
    </>
  );
}

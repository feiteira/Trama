import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileSearch, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useProject } from '../../shell/AppState';
import { type ScreenProps, useRouter } from '../../shell/router';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { useCommands } from '../../shell/useCommands';
import { useLive } from '../../shell/useLive';
import { IconButton } from '../../ui/components/Button';
import { useI18n } from '../../ui/i18n';
import { DocPicker } from './DocPicker';
import { HeaderSlot, WorkbenchHeader } from './header';
import { Overview } from './Overview';
import { WorkbenchPanes } from './Panes';
import { CodebookPanel } from './panels/CodebookPanel';
import { DocumentsPanel } from './panels/DocumentsPanel';
import { isBool, isStrArray, usePref } from './prefs';
import { Viewer, type ViewerHandle } from './Viewer';
import './workbench.css';

// The workbench: the documents on the left, the document being read in the middle, the
// codebook on the right. Reading and coding happen here.

export default function WorkbenchScreen({ route }: ScreenProps<'workbench'>) {
  const { t } = useI18n();
  const project = useProject();
  const { go, replace, routeKey } = useRouter();
  const docId = route.docId ?? null;
  const [activeCodeId, setActiveCodeId] = useState<string | null>(route.codeId ?? null);
  const [leftOpen, setLeftOpen] = usePref('leftPanel', true, isBool);
  const [rightOpen, setRightOpen] = usePref('rightPanel', true, isBool);
  const [recentDocs, setRecentDocs] = usePref<string[]>(`recentDocs.${project.id}`, [], isStrArray);
  const [canApply, setCanApply] = useState(false);
  const [picker, setPicker] = useState(false);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const viewer = useRef<ViewerHandle>(null);
  const { data: docs } = useLive((s) => s.list('document', { order: 'sort, id' }), [], ['document']);

  useEffect(() => {
    if (route.codeId) setActiveCodeId(route.codeId);
  }, [route.codeId, routeKey]);

  useEffect(() => {
    if (docId) setRecentDocs((cur) => [docId, ...cur.filter((d) => d !== docId)].slice(0, 12));
  }, [docId, setRecentDocs]);

  const open = useCallback((id: string) => go({ name: 'workbench', docId: id, codeId: activeCodeId ?? undefined }), [go, activeCodeId]);

  const activate = useCallback(
    (id: string | null) => {
      setActiveCodeId(id);
      // Recorded in the place, so Back returns to the same document with the same code active.
      replace({ name: 'workbench', docId: route.docId, codeId: id ?? undefined });
    },
    [replace, route.docId],
  );

  const apply = useCallback((codeId: string) => {
    viewer.current?.apply(codeId);
  }, []);

  useCommands(
    () => [
      { id: 'workbench.goto', label: t('workbench.commands.goto'), group: t('workbench.commands.group'), icon: FileSearch, priority: 1, run: () => setPicker(true) },
      {
        id: 'workbench.leftPanel',
        label: leftOpen ? t('workbench.panels.hideDocuments') : t('workbench.panels.showDocuments'),
        group: t('workbench.commands.group'),
        icon: leftOpen ? PanelLeftClose : PanelLeftOpen,
        run: () => setLeftOpen((v) => !v),
      },
      {
        id: 'workbench.rightPanel',
        label: rightOpen ? t('workbench.panels.hideCodebook') : t('workbench.panels.showCodebook'),
        group: t('workbench.commands.group'),
        icon: rightOpen ? PanelRightClose : PanelRightOpen,
        run: () => setRightOpen((v) => !v),
      },
    ],
    [t, leftOpen, rightOpen],
  );

  const panelActions = (
    <>
      <span className="wb-tools__sep" aria-hidden />
      <div className="wb-tools" role="group" aria-label={t('workbench.panels.group')}>
        <IconButton
          icon={leftOpen ? PanelLeftClose : PanelLeftOpen}
          label={leftOpen ? t('workbench.panels.hideDocuments') : t('workbench.panels.showDocuments')}
          onClick={() => setLeftOpen((v) => !v)}
          data-testid="toggle-left-panel"
        />
        <IconButton
          icon={rightOpen ? PanelRightClose : PanelRightOpen}
          label={rightOpen ? t('workbench.panels.hideCodebook') : t('workbench.panels.showCodebook')}
          onClick={() => setRightOpen((v) => !v)}
          data-testid="toggle-right-panel"
        />
      </div>
    </>
  );

  const centre = docId ? (
    <Viewer ref={viewer} docId={docId} activeCodeId={activeCodeId} select={route.select} routeKey={routeKey} onCanApply={setCanApply} panelActions={panelActions} />
  ) : (
    <>
      <WorkbenchHeader>
        <ScreenHeader title={t('workbench.title')} actions={panelActions} />
      </WorkbenchHeader>
      <Overview recent={recentDocs} onOpen={open} onImport={() => go({ name: 'import' })} />
    </>
  );

  return (
    <div className="wb" data-testid="screen-workbench">
      <div ref={setSlot} className="wb__header" />
      <HeaderSlot.Provider value={slot}>
      <WorkbenchPanes
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        leftLabel={t('workbench.panels.resizeDocuments')}
        rightLabel={t('workbench.panels.resizeCodebook')}
        left={<DocumentsPanel activeDocId={docId} onOpen={open} />}
        centre={<div className="wb-centre">{centre}</div>}
        right={<CodebookPanel activeCodeId={activeCodeId} onActivate={activate} onApply={apply} canApply={canApply} />}
      />
      </HeaderSlot.Provider>
      <DocPicker open={picker} docs={docs ?? []} onPick={open} onClose={() => setPicker(false)} />
    </div>
  );
}

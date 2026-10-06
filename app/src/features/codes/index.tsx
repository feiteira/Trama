import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown, Combine, Download, FileUp, ListTree, Plus, Sigma, Tags } from 'lucide-react';
import * as codesService from '../../services/codes';
import type { ScreenProps } from '../../shell/router';
import { useRouter } from '../../shell/router';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { useCommands } from '../../shell/useCommands';
import { useI18n } from '../../ui/i18n';
import { Button, IconButton } from '../../ui/components/Button';
import { EmptyState, Spinner } from '../../ui/components/Feedback';
import { SearchField } from '../../ui/components/Field';
import { MenuButton } from '../../ui/components/Menu';
import { SplitPane } from '../../ui/components/SplitPane';
import { CodeTree, type CodeTreeHandle } from '../common/CodeTree';
import { useCodeActions, useCodeData, useCollapsed, useFail, useUndoToast } from '../common/CodeTreeActions';
import { branchIds } from '../common/codeTree';
import { CodeDetail } from './CodeDetail';
import { MergeCodesDialog } from './CodesDialogs';
import { useCodebookFiles, type ExportFormat } from './useCodebookFiles';
import { useProject } from '../../shell/AppState';
import './codes.css';

/** The codebook: the code tree on the left, the chosen code's definition and use on the right. */
export default function CodesScreen({ route }: ScreenProps<'codes'>) {
  const { t, tp } = useI18n();
  const project = useProject();
  const { replace } = useRouter();
  const { data, error } = useCodeData();
  const [selectedId, setSelectedId] = useState<string | null>(route.codeId ?? null);
  const actions = useCodeActions(data, { onDeleted: (ids) => selectedId && ids.has(selectedId) && select(null) });
  const [collapsed, setCollapsed] = useCollapsed('codes');
  const [filter, setFilter] = useState('');
  const [ownCounts, setOwnCounts] = useState(false);
  const [mergeSources, setMergeSources] = useState<string[] | null>(null);
  const treeRef = useRef<CodeTreeHandle>(null);
  const files = useCodebookFiles(data);
  const undoToast = useUndoToast();
  const fail = useFail();

  // Whether the researcher chose the open code (a click, a link, a new code) rather than the
  // screen picking the first one: only a chosen code is pre-ticked when merging.
  const chosen = useRef(!!route.codeId);
  // The code open before "New code": back to it if the new code is taken back (Escape).
  const beforeNew = useRef<string | null>(null);
  // A code just created, chosen before the codebook shown here has caught up with it.
  const arriving = useRef<string | null>(null);
  const select = (id: string | null, byUser = true) => {
    chosen.current = byUser && id !== null;
    beforeNew.current = null;
    setSelectedId(id);
    replace(id ? { name: 'codes', codeId: id } : { name: 'codes' });
  };

  // Arriving with a code (from the Workbench, a link).
  useEffect(() => {
    if (route.codeId && route.codeId !== selectedId) {
      chosen.current = true;
      setSelectedId(route.codeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.codeId]);

  // Nothing chosen: the first code, so the page is never blank.
  useEffect(() => {
    if (!data) return;
    if (selectedId && data.byId.has(selectedId)) {
      if (arriving.current === selectedId) arriving.current = null;
      return;
    }
    if (selectedId && arriving.current === selectedId) return;
    const back = beforeNew.current;
    if (back && data.byId.has(back)) {
      select(back);
      return;
    }
    const first = data.items[0]?.id ?? null;
    if (first !== selectedId) select(first, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectedId]);

  const branches = useMemo(() => (data ? branchIds(data.items) : []), [data]);
  const allCollapsed = branches.length > 0 && branches.every((id) => collapsed.has(id));
  const code = selectedId ? data?.byId.get(selectedId) : undefined;

  const newCode = async (under: string | null) => {
    const before = selectedId;
    const id = await treeRef.current?.createAndRename(under);
    // The new code opens on the right, so its definition is the one being edited.
    if (id) {
      select(id);
      arriving.current = id;
      beforeNew.current = before;
    }
  };

  /** The codes pre-ticked in the merge dialog: the open code, if the researcher chose it and it is not a category. */
  const mergePreset = (): string[] => {
    const c = selectedId ? data?.byId.get(selectedId) : undefined;
    return c && chosen.current && c.codable ? [c.id] : [];
  };

  const merge = async (sources: string[], target: string) => {
    const names = sources.map((id) => data?.byId.get(id)?.name ?? '').join(', ');
    try {
      const res = await codesService.mergeCodes(project, sources, target);
      setMergeSources(null);
      if (selectedId && sources.includes(selectedId)) select(target);
      undoToast(tp('codes.toast.merged', res.moved, { name: names, target: data?.byId.get(target)?.name ?? '' }), res.undo);
    } catch (e) {
      fail(e);
    }
  };

  useCommands(
    () => [
      { id: 'codes.new', label: t('codes.screen.newCode'), group: t('codes.screen.title'), icon: Plus, run: () => void newCode(null) },
      { id: 'codes.merge', label: t('codes.merge.title'), group: t('codes.screen.title'), icon: Combine, run: () => setMergeSources(mergePreset()) },
      { id: 'codes.import', label: t('codes.screen.import'), group: t('codes.screen.title'), icon: FileUp, run: () => void files.importFile() },
      ...(['qdc', 'docx', 'csv', 'xlsx', 'md'] as const).map((f) => ({
        id: `codes.export.${f}`,
        label: t('codes.screen.exportAs', { format: t(`codes.io.formats.${f}`) }),
        group: t('codes.screen.title'),
        icon: Download,
        run: () => void files.exportAs(f),
      })),
    ],
    [t, selectedId, data],
  );

  const exportItems = (['qdc', 'docx', 'csv', 'xlsx', 'md'] as ExportFormat[]).map((f) => ({
    id: f,
    label: t(`codes.io.formats.${f}`),
    hint: `.${f}`,
    onSelect: () => void files.exportAs(f),
    testId: `codes-export-${f}`,
  }));

  const subtitle = data ? tp('common.count.codes', data.items.length) : undefined;

  const tree = (
    <div className="codes__left">
      <div className="codes__tools">
        <SearchField value={filter} onChange={setFilter} size="sm" placeholder={t('codes.screen.filter')} aria-label={t('codes.screen.filter')} fieldClassName="codes__filter"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              treeRef.current?.focus();
            }
          }}
          data-testid="codes-filter" />
        <IconButton icon={ownCounts ? ListTree : Sigma} label={ownCounts ? t('codes.panel.countsOwn') : t('codes.panel.countsTotal')} size="sm" pressed={!ownCounts} onClick={() => setOwnCounts((v) => !v)} data-testid="codes-counts" />
        <IconButton
          icon={allCollapsed ? ChevronsUpDown : ChevronsDownUp}
          label={allCollapsed ? t('codes.panel.expandAll') : t('codes.panel.collapseAll')}
          size="sm"
          disabled={!branches.length}
          onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(branches))}
          data-testid="codes-collapse"
        />
      </div>
      <div className="codes__scroll">
        <CodeTree
          ref={treeRef}
          data={data}
          actions={actions}
          selectedId={selectedId}
          onSelect={(id) => select(id)}
          filter={filter}
          countMode={ownCounts ? 'own' : 'total'}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          label={t('codes.screen.treeLabel')}
          data-testid="codes-tree"
        />
      </div>
    </div>
  );

  return (
    <>
      <ScreenHeader
        title={t('codes.screen.title')}
        subtitle={subtitle}
        actions={
          <>
            <IconButton icon={Combine} label={t('codes.merge.title')} disabled={!data || data.items.length < 2} onClick={() => setMergeSources(mergePreset())} data-testid="codes-merge" />
            <IconButton icon={FileUp} label={t('codes.screen.importLong')} disabled={files.busy} onClick={() => void files.importFile()} data-testid="codes-import" />
            <MenuButton items={exportItems} label={t('common.export')} icon={Download} size="sm" variant="ghost" align="end" data-testid="codes-export" />
            <Button variant="primary" size="sm" icon={Plus} onClick={() => void newCode(null)} data-testid="codes-new">
              {t('codes.screen.newCode')}
            </Button>
          </>
        }
      />
      <div className="codes" data-testid="screen-codes">
        {error ? (
          <EmptyState icon={Tags} title={t('codes.screen.loadFailed')}>
            {String(error instanceof Error ? error.message : error)}
          </EmptyState>
        ) : !data ? (
          <div className="codes__loading">
            <Spinner label={t('common.loading')} />
          </div>
        ) : data.items.length === 0 ? (
          <EmptyState
            icon={Tags}
            title={t('codes.screen.emptyTitle')}
            className="codes__empty"
            data-testid="codes-empty"
            actions={
              <>
                <Button variant="primary" icon={Plus} onClick={() => void actions.create(null).then((c) => c && select(c.id))}>
                  {t('codes.screen.newCode')}
                </Button>
                <Button variant="secondary" icon={FileUp} onClick={() => void files.importFile()}>
                  {t('codes.screen.import')}
                </Button>
              </>
            }
          >
            {t('codes.screen.emptyBody')}
          </EmptyState>
        ) : (
          <SplitPane
            initial={320}
            min={240}
            max={520}
            minRest={420}
            storageKey="trama.codes.split"
            label={t('codes.screen.resize')}
            first={tree}
            second={
              <div className="codes__right">
                {code ? <CodeDetail key={code.id} code={code} data={data} actions={actions} onSelect={select} onMergeMany={(ids) => setMergeSources(ids)} /> : null}
              </div>
            }
          />
        )}
      </div>
      {actions.dialogs}
      {files.dialog}
      {mergeSources && data ? <MergeCodesDialog items={data.items} initialSources={mergeSources} onCancel={() => setMergeSources(null)} onConfirm={merge} /> : null}
    </>
  );
}

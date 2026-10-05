import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Ellipsis, FileSpreadsheet, FileText, Files, Plus, SlidersHorizontal, Table2, Trash2, Upload, Users, X } from 'lucide-react';
import type { Attribute } from '../../core/model/types';
import { csvBytes } from '../../core/export/office/csv';
import { buildXlsx, safeSheetName } from '../../core/export/office/xlsx';
import { createCase, deleteCase, listAttributes, setCaseValue, updateCase } from '../../services/cases';
import { listDocuments } from '../../services/queries';
import { combineUndo, ServiceError, type Undoable } from '../../services/undo';
import { usePlatform, useProject } from '../../shell/AppState';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { type ScreenProps, useRouter } from '../../shell/router';
import { useUndo } from '../../shell/undo';
import { useCommands } from '../../shell/useCommands';
import { useLive } from '../../shell/useLive';
import { useI18n } from '../../ui/i18n';
import { Button } from '../../ui/components/Button';
import { useConfirm } from '../../ui/components/Confirm';
import { EmptyState, Spinner } from '../../ui/components/Feedback';
import { SearchField } from '../../ui/components/Field';
import { MenuButton, type MenuEntry } from '../../ui/components/Menu';
import { useToast } from '../../ui/components/Toast';
import { csvDelimiter, saveExport, stamp } from '../log/exportFile';
import { AttributeManager } from './AttributeManager';
import { CaseDetail } from './CaseDetail';
import { CasesFromDocuments } from './CasesFromDocuments';
import { type Col, CasesGrid } from './CasesGrid';
import { ImportAttributes } from './ImportAttributes';
import { buildRows, type CaseRow, exportTable, filterRows, nextSort, safeFileName, type Sort, type SortKey, sortRows, stabilise, type ValueFormat } from './values';
import './cases.css';

type DialogName = 'attributes' | 'fromDocs' | 'import' | null;

/** Cases (participants, sites…) and their attributes, as a spreadsheet with a detail panel. */
export default function CasesScreen({ route }: ScreenProps<'cases'>) {
  const { t, tp, meta, locale } = useI18n();
  const project = useProject();
  const platform = usePlatform();
  const { record } = useUndo();
  const { replace } = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<DialogName>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const { data } = useLive(
    async () => {
      const [cases, attrs, docs] = await Promise.all([project.store.list('case'), listAttributes(project), listDocuments(project)]);
      return { cases, attrs, docs };
    },
    [],
    ['case', 'attribute', 'document', 'coding'],
  );

  const fmt = useMemo<ValueFormat>(() => ({ bcp47: meta.bcp47, yes: t('common.yes'), no: t('common.no') }), [meta.bcp47, t]);
  const attrs = data?.attrs ?? [];
  const prevRows = useRef(new Map<string, CaseRow>());
  const allRows = useMemo(() => {
    if (!data) return [];
    const next = stabilise(
      prevRows.current,
      buildRows(
        data.cases,
        data.docs.map((d) => ({ id: d.document.id, name: d.document.name, case_id: d.document.case_id, codings: d.codings })),
      ),
    );
    prevRows.current = new Map(next.map((r) => [r.case.id, r]));
    return next;
  }, [data]);
  const rows = useMemo(() => sortRows(filterRows(allRows, query, attrs, fmt), sort, attrs, meta.bcp47), [allRows, query, attrs, fmt, sort, meta.bcp47]);
  const cols = useMemo<Col[]>(() => [{ kind: 'name' }, { kind: 'documents' }, ...attrs.map((attr) => ({ kind: 'attr' as const, attr })), { kind: 'codings' }], [attrs]);

  const openId = route.caseId && data?.cases.some((c) => c.id === route.caseId) ? route.caseId : null;
  const open = useCallback((caseId: string | null) => replace(caseId ? { name: 'cases', caseId } : { name: 'cases' }), [replace]);

  const select = useCallback(
    (ids: string[], on: boolean) =>
      setSelected((cur) => {
        const next = new Set(cur);
        for (const id of ids) on ? next.add(id) : next.delete(id);
        return next;
      }),
    [],
  );
  // Selection survives filtering, but not the deletion of the case.
  const liveSelected = useMemo(() => {
    const ids = new Set(allRows.map((r) => r.case.id));
    return new Set([...selected].filter((id) => ids.has(id)));
  }, [selected, allRows]);

  const valueError = (e: unknown, attr?: Attribute): string => {
    if (e instanceof ServiceError && e.code === 'invalid_value' && attr) return t(`cases.errors.${attr.type}`);
    if (e instanceof ServiceError && e.code === 'invalid_argument') return t('cases.errors.name');
    return e instanceof Error ? e.message : String(e);
  };

  const onSetValue = async (caseId: string, attr: Attribute, value: string | boolean | null): Promise<string | null> => {
    try {
      const { undo } = await setCaseValue(project, caseId, attr.id, value);
      record(undo);
      return null;
    } catch (e) {
      if (e instanceof ServiceError) return valueError(e, attr);
      toast.error(e);
      return null;
    }
  };

  const onRename = async (caseId: string, name: string): Promise<string | null> => {
    try {
      const { undo } = await updateCase(project, caseId, { name });
      record(undo);
      return null;
    } catch (e) {
      if (e instanceof ServiceError) return valueError(e);
      toast.error(e);
      return null;
    }
  };

  const onAdd = async (name: string): Promise<boolean> => {
    try {
      const { undo } = await createCase(project, { name });
      record(undo);
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    }
  };

  const onDelete = async (ids: string[]) => {
    if (!ids.length) return;
    const names = ids.map((id) => allRows.find((r) => r.case.id === id)?.case.name ?? '').filter(Boolean);
    const docCount = ids.reduce((n, id) => n + (allRows.find((r) => r.case.id === id)?.documents.length ?? 0), 0);
    const ok = await confirm({
      title: ids.length === 1 ? t('cases.deleteTitleOne', { name: names[0] ?? '' }) : tp('cases.deleteTitleN', ids.length),
      body: (
        <>
          <p>{docCount ? tp('cases.deleteDocs', docCount) : t('cases.deleteNoDocs')}</p>
          <p className="cases__confirm-note">{t('cases.deleteMemos')}</p>
        </>
      ),
      confirmLabel: ids.length === 1 ? t('cases.deleteOne') : tp('cases.deleteN', ids.length),
      danger: true,
      'data-testid': 'delete-cases-dialog',
    });
    if (!ok) return;
    try {
      const parts: Undoable[] = [];
      for (const id of ids) parts.push((await deleteCase(project, id)).undo);
      const undo = parts.length === 1 ? parts[0]! : combineUndo('case.delete', `×${parts.length}`, parts);
      record(undo);
      setSelected(new Set());
      if (openId && ids.includes(openId)) open(null);
      toast.show({
        message: ids.length === 1 ? t('cases.deleted', { name: names[0] ?? '' }) : tp('cases.deletedN', ids.length),
        action: { label: t('common.undo'), run: () => undo.undo(), testId: 'cases-undo-delete' },
      });
    } catch (e) {
      toast.error(e);
    }
  };

  async function exportCases(kind: 'csv' | 'xlsx') {
    try {
      const table = exportTable(rows, attrs, { case: t('cases.grid.case'), description: t('common.description'), documents: t('cases.grid.documents'), codings: t('cases.grid.codings') });
      const base = `${safeFileName(project.info.name, 'Trama')} – ${t('app.nav.cases')} ${stamp()}`;
      const file = await saveExport(platform, {
        title: t('cases.export.title'),
        defaultName: `${base}.${kind}`,
        filter: kind === 'csv' ? { name: 'CSV', extensions: ['csv'] } : { name: 'Excel', extensions: ['xlsx'] },
        bytes: () =>
          kind === 'csv'
            ? csvBytes(table, { delimiter: csvDelimiter(locale) })
            : buildXlsx([{ name: safeSheetName(t('app.nav.cases'), new Set()), rows: table }], { title: `${project.info.name} – ${t('app.nav.cases')}`, creator: 'Trama' }),
      });
      if (file) {
        await project.log('export', `"${file}"`);
        toast.show({ message: t('cases.export.done', { file }), tone: 'success' });
      }
    } catch (e) {
      toast.error(e);
    }
  }

  const unassigned = (data?.docs ?? []).filter((d) => !d.document.case_id).length;
  const moreItems: MenuEntry[] = [
    { id: 'fromDocs', label: t('cases.fromDocs.menu'), icon: Files, onSelect: () => setDialog('fromDocs'), hint: unassigned ? String(unassigned) : undefined, testId: 'cases-from-docs' },
    { id: 'import', label: t('cases.import.menu'), icon: Upload, onSelect: () => setDialog('import'), testId: 'cases-import' },
    { kind: 'separator' },
    { id: 'csv', label: t('cases.export.csv'), icon: FileText, onSelect: () => void exportCases('csv'), disabled: !rows.length, testId: 'cases-export-csv' },
    { id: 'xlsx', label: t('cases.export.xlsx'), icon: FileSpreadsheet, onSelect: () => void exportCases('xlsx'), disabled: !rows.length, testId: 'cases-export-xlsx' },
  ];

  // The add row is always rendered (filtered or not), so the focus can move at once.
  const focusAdd = () => {
    setQuery('');
    addRef.current?.focus();
    addRef.current?.scrollIntoView({ block: 'nearest' });
  };

  useCommands(
    () => [
      { id: 'cases.add', label: t('cases.add'), group: t('app.nav.cases'), icon: Plus, run: focusAdd },
      { id: 'cases.attributes', label: t('cases.attributes.title'), group: t('app.nav.cases'), icon: SlidersHorizontal, run: () => setDialog('attributes') },
      { id: 'cases.fromDocs', label: t('cases.fromDocs.menu'), group: t('app.nav.cases'), icon: Files, run: () => setDialog('fromDocs') },
      { id: 'cases.import', label: t('cases.import.menu'), group: t('app.nav.cases'), icon: Upload, run: () => setDialog('import') },
      { id: 'cases.csv', label: t('cases.export.csv'), group: t('app.nav.cases'), icon: FileText, run: () => void exportCases('csv') },
      { id: 'cases.xlsx', label: t('cases.export.xlsx'), group: t('app.nav.cases'), icon: FileSpreadsheet, run: () => void exportCases('xlsx') },
      { id: 'cases.search', label: t('cases.search'), group: t('app.nav.cases'), icon: Table2, run: () => searchRef.current?.focus() },
    ],
    [t, rows, attrs],
  );

  const empty = data && data.cases.length === 0;
  const subtitle = data ? (query.trim() ? t('cases.shownOf', { shown: rows.length, total: allRows.length }) : tp('common.count.cases', allRows.length)) : undefined;

  return (
    <>
      <ScreenHeader
        title={t('app.nav.cases')}
        subtitle={subtitle}
        actions={
          <>
            {liveSelected.size ? (
              <div className="cases__selection" role="group" aria-label={t('cases.selection')}>
                <span className="cases__selection-count">{tp('cases.selected', liveSelected.size)}</span>
                <Button size="sm" variant="ghost" icon={X} onClick={() => setSelected(new Set())} data-testid="cases-clear-selection">
                  {t('common.clear')}
                </Button>
                <Button size="sm" variant="danger" icon={Trash2} onClick={() => void onDelete([...liveSelected])} data-testid="cases-delete-selected">
                  {t('common.delete')}
                </Button>
              </div>
            ) : null}
            {!empty ? (
              <SearchField ref={searchRef} value={query} onChange={setQuery} placeholder={t('cases.search')} aria-label={t('cases.search')} size="sm" fieldClassName="cases__search" data-testid="cases-search" />
            ) : null}
            <Button icon={SlidersHorizontal} onClick={() => setDialog('attributes')} data-testid="cases-attributes">
              {t('cases.attributes.button')}
            </Button>
            <MenuButton items={moreItems} label={t('common.more')} icon={Ellipsis} iconOnly variant="ghost" align="end" data-testid="cases-more" />
            <Button variant="primary" icon={Plus} onClick={focusAdd} data-testid="cases-add">
              {t('cases.add')}
            </Button>
          </>
        }
      />
      <div className="cases" data-testid="screen-cases">
        {!data ? (
          <div className="cases__loading">
            <Spinner size={18} label={t('common.loading')} />
          </div>
        ) : (
          <>
            <div className="cases__main">
              <CasesGrid
                rows={rows}
                cols={cols}
                fmt={fmt}
                sort={sort}
                onSort={(k: SortKey) => setSort((s) => nextSort(s, k))}
                selected={liveSelected}
                onSelect={select}
                onSelectOnly={(ids) => setSelected(new Set(ids))}
                openId={openId}
                onOpen={(id) => open(openId === id ? null : id)}
                onDelete={(ids) => void onDelete(ids)}
                onSetValue={onSetValue}
                onRename={onRename}
                onAdd={onAdd}
                addRef={addRef}
              />
              {empty ? (
                <EmptyState
                  icon={Users}
                  title={t('cases.empty.title')}
                  className="cases__empty"
                  data-testid="cases-empty"
                  actions={
                    <>
                      {unassigned ? (
                        <Button variant="primary" icon={Files} onClick={() => setDialog('fromDocs')} data-testid="cases-empty-from-docs">
                          {t('cases.fromDocs.menu')}
                        </Button>
                      ) : null}
                      <Button icon={Upload} onClick={() => setDialog('import')}>
                        {t('cases.import.menu')}
                      </Button>
                    </>
                  }
                >
                  {t('cases.empty.body')}
                </EmptyState>
              ) : rows.length === 0 && query.trim() ? (
                <p className="cases__nomatch" data-testid="cases-nomatch">
                  {t('cases.noMatch', { q: query.trim() })}
                </p>
              ) : attrs.length === 0 ? (
                <div className="cases__hint">
                  <span>{t('cases.noAttributes')}</span>
                  <Button size="sm" variant="ghost" icon={SlidersHorizontal} onClick={() => setDialog('attributes')}>
                    {t('cases.attributes.add')}
                  </Button>
                </div>
              ) : null}
            </div>
            {openId ? <CaseDetail key={openId} caseId={openId} attrs={attrs} fmt={fmt} onClose={() => open(null)} /> : null}
          </>
        )}
      </div>
      {dialog === 'attributes' ? <AttributeManager attrs={attrs} cases={data?.cases ?? []} onClose={() => setDialog(null)} /> : null}
      {dialog === 'fromDocs' ? <CasesFromDocuments docs={data?.docs ?? []} onClose={() => setDialog(null)} /> : null}
      {dialog === 'import' ? <ImportAttributes onClose={() => setDialog(null)} /> : null}
    </>
  );
}

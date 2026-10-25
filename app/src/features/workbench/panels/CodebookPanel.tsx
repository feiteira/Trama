import React, { useMemo, useRef, useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown, CornerDownLeft, ExternalLink, ListTree, MousePointerClick, Plus, Rows3, Sigma, Tags } from 'lucide-react';
import { fold } from '../../../core/text/normalize';
import { useRouter } from '../../../shell/router';
import { cx } from '../../../ui/cx';
import { useI18n } from '../../../ui/i18n';
import { Button, IconButton } from '../../../ui/components/Button';
import { EmptyState } from '../../../ui/components/Feedback';
import { SearchField } from '../../../ui/components/Field';
import type { MenuEntry } from '../../../ui/components/Menu';
import { CodeTree, type CodeTreeHandle } from '../../common/CodeTree';
import { useCodeActions, useCodeData, useCollapsed } from '../../common/CodeTreeActions';
import { branchIds, filterTree, type CountMode } from '../../common/codeTreeModel';
import { definitionSummary } from './panelText';
import './panels.css';

export interface CodebookPanelProps {
  activeCodeId: string | null;
  onActivate(codeId: string | null): void;
  onApply?(codeId: string): void;
  canApply: boolean;
}

const COUNT_KEY = 'trama.codebook.counts';

function readCountMode(): CountMode {
  try {
    const v = localStorage.getItem(COUNT_KEY);
    return v === 'own' || v === 'none' ? v : 'total';
  } catch {
    return 'total';
  }
}

/**
 * The Workbench's codebook: the code tree with a filter that doubles as "new code" (type a
 * name, Enter), and the active code's definition at the foot. With text selected, a click on a
 * code applies it; otherwise a click makes it the active code (click again to let go).
 */
export function CodebookPanel({ activeCodeId, onActivate, onApply, canApply }: CodebookPanelProps) {
  const { t, tp } = useI18n();
  const { go } = useRouter();
  const { data } = useCodeData();
  const actions = useCodeActions(data, { onDeleted: (ids) => activeCodeId && ids.has(activeCodeId) && onActivate(null) });
  const [collapsed, setCollapsed] = useCollapsed('workbench');
  const [filter, setFilter] = useState('');
  const [countMode, setCountModeState] = useState<CountMode>(readCountMode);
  const treeRef = useRef<CodeTreeHandle>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const applyMode = canApply && !!onApply;

  const setCountMode = (m: CountMode) => {
    setCountModeState(m);
    try {
      localStorage.setItem(COUNT_KEY, m);
    } catch {
      // Not remembered; it still applies now.
    }
  };

  const branches = useMemo(() => (data ? branchIds(data.items) : []), [data]);
  const allCollapsed = branches.length > 0 && branches.every((id) => collapsed.has(id));
  const active = activeCodeId ? data?.byId.get(activeCodeId) : undefined;

  const typed = filter.trim();
  const exact = useMemo(() => {
    if (!typed || !data) return undefined;
    const k = fold(typed);
    return data.items.find((i) => fold(i.name) === k);
  }, [typed, data]);
  const anyMatch = useMemo(() => (typed && data ? (filterTree(data.items, typed)?.matches.size ?? 0) > 0 : true), [typed, data]);
  // A new code typed in the filter goes under the active code (when it is not being applied).
  const newParent = active ? active.id : null;

  const choose = (id: string) => {
    if (applyMode) {
      const item = data?.byId.get(id);
      if (item?.codable) onApply!(id);
      return;
    }
    onActivate(id === activeCodeId ? null : id);
  };

  const createFromFilter = async () => {
    if (!typed) return;
    if (exact) {
      if (exact.codable) choose(exact.id);
      setFilter('');
      return;
    }
    const code = await actions.create(newParent, typed);
    if (!code) return;
    setFilter('');
    if (applyMode) onApply!(code.id);
    else onActivate(code.id);
  };

  const newCode = () => void treeRef.current?.createAndRename(activeCodeId && data?.byId.has(activeCodeId) ? activeCodeId : null);

  const extraMenu = (id: string): MenuEntry[] => [
    { id: 'open', label: t('codes.menu.openInCodes'), icon: ExternalLink, onSelect: () => go({ name: 'codes', codeId: id }), testId: 'code-menu-open' },
    { id: 'segments', label: t('codes.menu.showSegments'), icon: Rows3, onSelect: () => go({ name: 'segments', codeIds: [id] }), testId: 'code-menu-segments' },
  ];

  const nextCount: Record<CountMode, CountMode> = { total: 'own', own: 'none', none: 'total' };
  const countLabel = countMode === 'total' ? t('codes.panel.countsTotal') : countMode === 'own' ? t('codes.panel.countsOwn') : t('codes.panel.countsNone');

  return (
    <section className="cbpanel" aria-label={t('codes.panel.title')} data-testid="codebook-panel">
      <header className="wpanel__head">
        <h2 className="wpanel__title">
          <span className="wpanel__name">{t('codes.panel.title')}</span>
          {data ? <span className="wpanel__count">{data.items.length}</span> : null}
        </h2>
        <div className="wpanel__tools">
          <IconButton
            icon={countMode === 'own' ? ListTree : countMode === 'total' ? Sigma : Tags}
            label={countLabel}
            size="sm"
            pressed={countMode !== 'none'}
            onClick={() => setCountMode(nextCount[countMode])}
            data-testid="codebook-counts"
          />
          <IconButton
            icon={allCollapsed ? ChevronsUpDown : ChevronsDownUp}
            label={allCollapsed ? t('codes.panel.expandAll') : t('codes.panel.collapseAll')}
            size="sm"
            disabled={!branches.length}
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(branches))}
            data-testid="codebook-collapse"
          />
          <IconButton icon={Plus} label={active ? t('codes.panel.newChild', { name: active.name }) : t('codes.panel.newCode')} size="sm" variant="secondary" onClick={newCode} data-testid="codebook-new" />
        </div>
      </header>
      <div className="cbpanel__filter">
        <SearchField
          ref={filterRef}
          value={filter}
          onChange={setFilter}
          size="sm"
          placeholder={t('codes.panel.filter')}
          aria-label={t('codes.panel.filterLabel')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void createFromFilter();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              treeRef.current?.focus();
            }
          }}
          data-testid="codebook-filter"
        />
        {typed && anyMatch ? (
          <p className="cbpanel__enter" data-testid="codebook-enter-hint">
            <CornerDownLeft size={12} aria-hidden />
            {exact
              ? exact.codable
                ? applyMode
                  ? t('codes.panel.enterApply', { name: exact.name })
                  : t('codes.panel.enterActivate', { name: exact.name })
                : t('codes.panel.enterCategory', { name: exact.name })
              : newParent && active
                ? t('codes.panel.enterCreateUnder', { name: typed, parent: active.name })
                : t('codes.panel.enterCreate', { name: typed })}
          </p>
        ) : null}
      </div>
      {applyMode ? (
        <p className="cbpanel__hint" role="status" data-testid="codebook-apply-hint">
          <MousePointerClick size={14} aria-hidden />
          {t('codes.panel.applyHint')}
        </p>
      ) : null}
      <div className="wpanel__scroll">
        <CodeTree
          ref={treeRef}
          data={data}
          actions={actions}
          selectedId={activeCodeId}
          onSelect={choose}
          filter={filter}
          countMode={countMode}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          onTextDrop={onApply ? (id) => onApply(id) : undefined}
          applyMode={applyMode}
          extraMenu={extraMenu}
          label={t('codes.panel.title')}
          data-testid="codebook-tree"
          noMatch={
            typed ? (
              <button type="button" className="cbpanel__create" onClick={() => void createFromFilter()} data-testid="codebook-create">
                <Plus size={15} aria-hidden />
                <span>{newParent && active ? t('codes.panel.createUnder', { name: typed, parent: active.name }) : t('codes.panel.create', { name: typed })}</span>
              </button>
            ) : null
          }
          empty={
            <EmptyState icon={Tags} title={t('codes.panel.emptyTitle')} className="wpanel__empty" data-testid="codebook-empty"
              actions={<Button size="sm" icon={Plus} onClick={newCode}>{t('codes.panel.newCode')}</Button>}>
              {t('codes.panel.emptyBody')}
            </EmptyState>
          }
        />
      </div>
      <footer className={cx('cbpanel__foot', active && 'cbpanel__foot--active')} data-testid="codebook-active" aria-live="polite">
        {active ? (
          <>
            <div className="cbpanel__active">
              <span className="cbpanel__active-dot" style={{ background: active.color }} aria-hidden />
              <span className="cbpanel__active-name">{active.name}</span>
              <IconButton icon={ExternalLink} label={t('codes.menu.openInCodes')} size="sm" onClick={() => go({ name: 'codes', codeId: active.id })} data-testid="codebook-active-open" />
            </div>
            <p className={cx('cbpanel__definition', !active.description.trim() && 'cbpanel__definition--empty')}>
              {definitionSummary(active.description) || t('codes.panel.noDefinition')}
            </p>
          </>
        ) : (
          <p className="cbpanel__definition cbpanel__definition--empty">{t('codes.panel.noActive')}</p>
        )}
      </footer>
      {actions.dialogs}
    </section>
  );
}

export default CodebookPanel;

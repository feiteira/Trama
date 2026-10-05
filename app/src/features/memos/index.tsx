import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { ChevronDown, Download, FileCode2, FileText, FolderKanban, NotebookPen, Plus, Tag, User } from 'lucide-react';
import { buildDocx } from '../../core/export/office';
import { utf8 } from '../../core/bytes';
import type { Coding, Memo, MemoTarget, MemoTargetKind } from '../../core/model/types';
import { createMemo } from '../../services/memos';
import { buildTree } from '../../core/qda/tree';
import { listIn } from '../../services/undo';
import { usePlatform, useProject } from '../../shell/AppState';
import { useCommands } from '../../shell/useCommands';
import { useLive } from '../../shell/useLive';
import { type ScreenProps, useRouter } from '../../shell/router';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { useUndo } from '../../shell/undo';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import { Button, IconButton } from '../../ui/components/Button';
import { EmptyState, Spinner } from '../../ui/components/Feedback';
import { SearchField, Select } from '../../ui/components/Field';
import { Menu, MenuButton, type MenuEntry } from '../../ui/components/Menu';
import { SplitPane } from '../../ui/components/SplitPane';
import { useToast } from '../../ui/components/Toast';
import { MemoEditor, TARGET_ICON } from '../common/MemoEditor';
import { safeFileName } from '../segments/export';
import { saveBytes } from '../segments/saveFile';
import {
  countByKind, filterMemos, hlcMs, KIND_ORDER, type MemoExportItem, type MemoExportLabels, type MemoKindFilter, memosMarkdown, memosReport, memoTitle,
  plainExcerpt, resolveTarget, type TargetInfo, type TargetLookup,
} from './memoModel';
import { TargetPicker, type PickKind } from './TargetPicker';
import './memos.css';

interface Loaded {
  memos: Memo[];
  look: TargetLookup;
  coders: Map<string, string>;
  /** For the "new memo about…" picker. */
  choices: Record<PickKind, { id: string; label: string; color: string | null; depth?: number }[]>;
}

const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';
const KIND_KEY = 'trama.memos.kind';

function readKind(): MemoKindFilter {
  try {
    const v = localStorage.getItem(KIND_KEY);
    return v === 'all' || (KIND_ORDER as readonly string[]).includes(v ?? '') ? (v as MemoKindFilter) : 'all';
  } catch {
    return 'all';
  }
}

/** Memos: every memo of the project in one place, and the editor for the one chosen. */
export default function MemosScreen({ route }: ScreenProps<'memos'>) {
  const { t, tp, date, meta } = useI18n();
  const project = useProject();
  const platform = usePlatform();
  const { replace } = useRouter();
  const { record } = useUndo();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [kind, setKindState] = useState<MemoKindFilter>(readKind);
  const [picking, setPicking] = useState<PickKind | null>(null);
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const setKind = (k: MemoKindFilter) => {
    setKindState(k);
    try {
      localStorage.setItem(KIND_KEY, k);
    } catch {
      // Not remembered; it still filters.
    }
  };

  const { data } = useLive<Loaded>(
    async (store) => {
      const [memos, documents, codes, cases, coders] = await Promise.all([
        store.list('memo'),
        store.list('document', { order: 'sort, id' }),
        store.list('code', { order: 'sort, id' }),
        store.list('case'),
        store.list('coder'),
      ]);
      const codingIds = memos.filter((m) => m.target.kind === 'coding').map((m) => m.target.id as string);
      const codings: Coding[] = codingIds.length ? await listIn(store, 'coding', 'id', codingIds) : [];
      const docs = new Map(documents.map((d) => [d.id, d]));
      const codeMap = new Map(codes.map((c) => [c.id, c]));
      const caseMap = new Map(cases.map((c) => [c.id, c]));
      const codingMap = new Map(codings.map((c) => [c.id, c]));
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      return {
        memos,
        look: {
          document: (id) => docs.get(id),
          code: (id) => codeMap.get(id),
          case: (id) => caseMap.get(id),
          coding: (id) => codingMap.get(id),
        },
        coders: new Map(coders.map((c) => [c.id, c.name])),
        choices: {
          document: documents.map((d) => ({ id: d.id, label: d.name, color: d.color })),
          code: buildTree(codes)
            .flatten()
            .map(({ code, depth }) => ({ id: code.id, label: code.name, color: code.color, depth })),
          case: [...cases].sort((a, b) => collator.compare(a.name, b.name)).map((c) => ({ id: c.id, label: c.name, color: c.color })),
        },
      };
    },
    [],
    ['memo', 'document', 'code', 'case', 'coding', 'coder'],
  );

  const targets = useMemo(() => {
    const m = new Map<string, TargetInfo>();
    if (data) for (const memo of data.memos) m.set(memo.id, resolveTarget(memo.target, data.look));
    return m;
  }, [data]);

  const shown = useMemo(
    () => (data ? filterMemos(data.memos, { kind, query, targetLabel: (m) => targets.get(m.id)?.label ?? '' }) : []),
    [data, kind, query, targets],
  );
  const counts = useMemo(() => countByKind(data?.memos ?? []), [data]);

  // The memo on the right: the route's, else the first shown.
  const selectedId = route.memoId ?? shown[0]?.id ?? null;
  // A memo asked for by another screen shows in the list too, whatever the list was filtered to.
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (!data || !route.memoId || revealed.current === route.memoId) return;
    revealed.current = route.memoId;
    if (shown.some((m) => m.id === route.memoId) || !data.memos.some((m) => m.id === route.memoId)) return;
    setQuery('');
    setKindState('all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.memoId, data]);
  const select = useCallback((id: string | null) => replace(id ? { name: 'memos', memoId: id } : { name: 'memos' }), [replace]);

  const create = async (target: MemoTarget) => {
    try {
      const { memo, undo } = await createMemo(project, { target });
      record(undo);
      setQuery('');
      if (kind !== 'all' && kind !== target.kind) setKind('all');
      setJustCreated(memo.id);
      select(memo.id);
    } catch (e) {
      toast.error(e);
    }
  };

  const afterDelete = (id: string) => {
    const i = shown.findIndex((m) => m.id === id);
    const next = shown[i + 1] ?? shown[i - 1];
    select(next && next.id !== id ? next.id : null);
  };

  const exportAs = async (format: 'docx' | 'md') => {
    if (!data || busy) return;
    if (!data.memos.length) {
      toast.show(t('memos.export.nothing'));
      return;
    }
    setBusy(true);
    try {
      const now = DateTime.now();
      const items: MemoExportItem[] = data.memos.map((m) => ({
        memo: m,
        target: targets.get(m.id) ?? resolveTarget(m.target, data.look),
        coderName: (m.coder_id && data.coders.get(m.coder_id)) || t('memos.export.unknownCoder'),
        updated: date(DateTime.fromMillis(hlcMs(m.updated_at_hlc) || Date.parse(m.created_at))),
      }));
      const labels: MemoExportLabels = {
        title: t('memos.export.reportTitle'),
        subtitle: t('memos.export.subtitle', { project: project.info.name, date: date(now, 'long') }),
        group: {
          project: t('memos.export.groups.project'),
          document: t('memos.export.groups.document'),
          code: t('memos.export.groups.code'),
          coding: t('memos.export.groups.coding'),
          case: t('memos.export.groups.case'),
        },
        about: (tg) =>
          tg.kind === 'project'
            ? ''
            : t('memos.export.about', { kind: t(`memos.kind.${tg.kind}`), name: tg.missing ? t('memos.export.deleted') : tg.kind === 'coding' ? `“${tg.label}”` : tg.label }),
        byline: (i) => t('memos.export.byline', { coder: i.coderName, date: i.updated }),
        untitled: t('memos.list.untitled'),
        lang: meta.bcp47,
        generator: `Trama ${VERSION}`.trim(),
      };
      const title = t('memos.export.fileName', { project: project.info.name });
      const name = await saveBytes(platform, {
        title: t('memos.export.title'),
        defaultName: safeFileName(title, format),
        filter: format === 'docx' ? { name: t('memos.export.filterDocx'), extensions: ['docx'] } : { name: t('memos.export.filterMarkdown'), extensions: ['md'] },
        bytes: () => (format === 'docx' ? buildDocx(memosReport(items, labels)) : utf8(memosMarkdown(items, labels))),
      });
      if (!name) return;
      await project.log('export', `memos ×${items.length} → ${name}`).catch((e: unknown) => console.error(e));
      toast.show({ message: t('memos.export.done', { name }), tone: 'success' });
    } catch (e) {
      toast.show({ message: t('memos.export.failed', { message: e instanceof Error ? e.message : String(e) }), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  useCommands(
    () => [
      { id: 'memos.new', label: t('memos.commands.new'), group: t('memos.title'), icon: Plus, run: () => void create({ kind: 'project', id: null }) },
      { id: 'memos.export', label: t('memos.commands.export'), group: t('memos.title'), icon: Download, run: () => void exportAs('docx'), disabled: !data?.memos.length },
    ],
    [t, data?.memos.length],
  );

  // Keyboard: arrows move through the list (and open the memo), "/" finds.
  const onListKey = (e: React.KeyboardEvent) => {
    const i = shown.findIndex((m) => m.id === selectedId);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = Math.min(shown.length - 1, i + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, i - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = shown.length - 1;
    if (next === null || !shown[next]) return;
    e.preventDefault();
    select(shown[next]!.id);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-memo="${shown[next!]!.id}"]`)?.focus());
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const newItems: MenuEntry[] = [
    { kind: 'heading', label: t('memos.newAbout') },
    { id: 'project', label: t('memos.about.project'), icon: FolderKanban, onSelect: () => void create({ kind: 'project', id: null }), testId: 'new-memo-project' },
    { id: 'document', label: t('memos.about.document'), icon: FileText, onSelect: () => setPicking('document'), disabled: !data?.choices.document.length, testId: 'new-memo-document' },
    { id: 'code', label: t('memos.about.code'), icon: Tag, onSelect: () => setPicking('code'), disabled: !data?.choices.code.length, testId: 'new-memo-code' },
    { id: 'case', label: t('memos.about.case'), icon: User, onSelect: () => setPicking('case'), disabled: !data?.choices.case.length, testId: 'new-memo-case' },
  ];
  const exportItems: MenuEntry[] = [
    { id: 'docx', label: t('memos.export.docx'), icon: FileText, onSelect: () => void exportAs('docx'), testId: 'export-memos-docx' },
    { id: 'md', label: t('memos.export.markdown'), icon: FileCode2, onSelect: () => void exportAs('md'), testId: 'export-memos-md' },
  ];

  const actions = (
    <>
      {data?.memos.length ? <MenuButton items={exportItems} label={t('memos.export.label')} icon={Download} variant="ghost" align="end" data-testid="export-memos" /> : null}
      <NewMemoButton onNew={() => void create({ kind: 'project', id: null })} items={newItems} />
    </>
  );

  let body: React.ReactNode;
  if (!data) {
    body = (
      <div className="memos-center">
        <Spinner size={20} label={t('common.loading')} />
      </div>
    );
  } else if (!data.memos.length) {
    body = (
      <div className="memos-center">
        <EmptyState
          icon={NotebookPen}
          title={t('memos.empty.title')}
          actions={
            <Button variant="primary" icon={Plus} onClick={() => void create({ kind: 'project', id: null })} data-testid="empty-new-memo">
              {t('memos.new')}
            </Button>
          }
          data-testid="memos-empty"
        >
          {t('memos.empty.body')}
        </EmptyState>
      </div>
    );
  } else {
    const kindOptions = (['all', ...KIND_ORDER] as MemoKindFilter[]).map((k) => ({ value: k, label: `${t(`memos.kinds.${k}`)} (${counts[k]})` }));
    const list = (
      <div className="memos-list">
        <div className="memos-list__tools">
          <SearchField ref={searchRef} size="sm" value={query} onChange={setQuery} placeholder={t('memos.search')} aria-label={t('memos.search')} fieldClassName="memos-list__search" data-testid="memo-search" />
          <Select<MemoKindFilter> size="sm" aria-label={t('memos.show')} value={kind} onChange={setKind} options={kindOptions} data-testid="memo-kind" />
        </div>
        {shown.length === 0 ? (
          <p className="memos-list__none" data-testid="memos-nomatch">
            {query.trim() ? t('memos.empty.noMatch', { q: query.trim() }) : t('memos.empty.noKind')}
          </p>
        ) : (
          <div ref={listRef} className="memos-list__items" role="listbox" aria-label={t('memos.list.label')} onKeyDown={onListKey} data-testid="memo-list">
            {shown.map((m, i) => (
              <MemoRow
                key={m.id}
                memo={m}
                target={targets.get(m.id)}
                selected={m.id === selectedId}
                tabbable={m.id === selectedId || (i === 0 && !shown.some((x) => x.id === selectedId))}
                onSelect={() => select(m.id)}
              />
            ))}
          </div>
        )}
      </div>
    );
    const editor = selectedId ? (
      <MemoEditor key={selectedId} memoId={selectedId} onDeleted={() => afterDelete(selectedId)} autoFocusTitle={justCreated === selectedId} />
    ) : (
      <div className="memos-center">
        <p className="memos-center__hint">{t('memos.empty.select')}</p>
      </div>
    );
    body = (
      <SplitPane
        first={list}
        second={<div className="memos-editor-pane">{editor}</div>}
        initial={330}
        min={250}
        max={520}
        minRest={420}
        storageKey="trama.memos.split"
        label={t('memos.resize')}
        className="memos__split"
        data-testid="memos-split"
      />
    );
  }

  return (
    <div className="memos" data-testid="memos">
      <ScreenHeader title={t('memos.title')} subtitle={data ? tp('memos.count', data.memos.length) : undefined} actions={actions} />
      {body}
      {data && picking ? (
        <TargetPicker
          kind={picking}
          items={data.choices[picking]}
          onClose={() => setPicking(null)}
          onPick={(id) => {
            const k = picking;
            setPicking(null);
            void create({ kind: k, id });
          }}
        />
      ) : null}
    </div>
  );
}

function NewMemoButton({ onNew, items }: { onNew: () => void; items: MenuEntry[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="memos-new" ref={ref}>
      <Button variant="primary" icon={Plus} onClick={onNew} className="memos-new__main" data-testid="new-memo">
        {t('memos.new')}
      </Button>
      <IconButton
        icon={ChevronDown}
        label={t('memos.newMenu')}
        variant="secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="memos-new__more"
        data-testid="new-memo-menu"
      />
      <Menu open={open} onClose={() => setOpen(false)} anchor={ref} items={items} align="end" label={t('memos.newMenu')} />
    </div>
  );
}

const MemoRow = React.memo(function MemoRow({
  memo, target, selected, tabbable, onSelect,
}: { memo: Memo; target: TargetInfo | undefined; selected: boolean; tabbable: boolean; onSelect: () => void }) {
  const { t, relative } = useI18n();
  const title = memoTitle(memo);
  const excerpt = plainExcerpt(memo.body, 180);
  const kind: MemoTargetKind = memo.target.kind;
  const Icon = TARGET_ICON[kind];
  const ms = hlcMs(memo.updated_at_hlc);
  const targetText =
    kind === 'project' ? t('memos.kind.project') : target?.missing ? t('memos.editor.missing', { kind: t(`memos.kind.${kind}`).toLocaleLowerCase() }) : kind === 'coding' ? `“${target?.label ?? ''}”` : target?.label ?? '';
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={tabbable ? 0 : -1}
      className={cx('memo-row', selected && 'memo-row--selected')}
      onClick={onSelect}
      data-memo={memo.id}
      data-testid="memo-row"
    >
      <span className="memo-row__stripe" style={memo.color ? { background: memo.color } : undefined} aria-hidden />
      <span className="memo-row__top">
        <span className={cx('memo-row__title', !memo.title.trim() && 'memo-row__title--untitled')}>{memo.title.trim() || title || t('memos.list.untitled')}</span>
        {ms ? <span className="memo-row__when">{relative(DateTime.fromMillis(ms).toISO())}</span> : null}
      </span>
      <span className={cx('memo-row__target', target?.missing && 'memo-row__target--missing')}>
        {target?.color && kind !== 'project' ? <span className="memo-row__dot" style={{ background: target.color }} aria-hidden /> : <Icon size={12} strokeWidth={1.75} aria-hidden />}
        <span className="memo-row__target-text">{targetText}</span>
      </span>
      {memo.title.trim() ? <span className="memo-row__excerpt">{excerpt || <em>{t('memos.list.noBody')}</em>}</span> : null}
    </button>
  );
});

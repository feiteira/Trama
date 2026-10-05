import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { ClipboardCopy, Download, FileSpreadsheet, FileText, FileType, Globe, Highlighter, X } from 'lucide-react';
import { buildDocx, buildHtml, buildXlsx, csvBytes, type CsvCell } from '../../core/export/office';
import type { Attribute, Case, Code, Coder, Coding, DocGroup, Document } from '../../core/model/types';
import { filterCodings, sortSegments } from '../../core/qda/segments';
import { buildTree } from '../../core/qda/tree';
import { utf8 } from '../../core/bytes';
import { fold } from '../../core/text/normalize';
import { useHold, usePlatform, useProject } from '../../shell/AppState';
import { useCommands } from '../../shell/useCommands';
import { useLive } from '../../shell/useLive';
import { type ScreenProps, useRouter } from '../../shell/router';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { useI18n } from '../../ui/i18n';
import { Button } from '../../ui/components/Button';
import { RadioGroup } from '../../ui/components/Choice';
import { EmptyState, Notice, Spinner } from '../../ui/components/Feedback';
import { Select } from '../../ui/components/Field';
import { MenuButton, type MenuEntry } from '../../ui/components/Menu';
import { SplitPane } from '../../ui/components/SplitPane';
import { useToast } from '../../ui/components/Toast';
import { clipboardText, type ExportLabels, safeFileName, type SegmentRow, segmentReport, tableRows, xlsxSheets } from './export';
import {
  activeFilterCount, clearedFilter, type ContextMode, CONTEXT_MODES, coreSort, describeFilter, type FilterState, filterForCodes, filterStorageKey,
  type KnownIds, matchText, parseFilter, serializeFilter, SORT_MODES, type SortMode, toSegmentFilter,
} from './filter';
import { FilterPanel, type FilterData } from './FilterPanel';
import type { ChecklistItem } from './Checklist';
import { SegmentCard } from './SegmentCard';
import { saveBytes } from './saveFile';
import { useDocTexts } from './useDocTexts';
import { docTextInfo, documentCount, paragraphNumber, shownText } from './view';
import { VirtualList, type VirtualListHandle } from './VirtualList';
import './segments.css';

interface Loaded {
  codings: Coding[];
  codes: Code[];
  documents: Document[];
  groups: DocGroup[];
  cases: Case[];
  attributes: Attribute[];
  coders: Coder[];
  /** Coding id → id of a memo about it. */
  codingMemos: Map<string, string>;
}

function readSaved(key: string): FilterState {
  try {
    return parseFilter(localStorage.getItem(key));
  } catch {
    return parseFilter(null);
  }
}

type ExportKind = 'csv' | 'xlsx' | 'docx' | 'html';

const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';

/** Coded segments: retrieve what was coded, across documents, by code, case, coder or text. */
export default function SegmentsScreen({ route }: ScreenProps<'segments'>) {
  const { t, tp, locale, meta, date } = useI18n();
  const project = useProject();
  const platform = usePlatform();
  const { go } = useRouter();
  const toast = useToast();
  const storageKey = filterStorageKey(project.id);

  const [filter, setFilter] = useState<FilterState>(() => {
    const saved = readSaved(storageKey);
    return route.codeIds?.length ? filterForCodes(route.codeIds, saved) : saved;
  });
  // A later visit with other codes (from the codebook) while this screen is showing.
  const routeCodes = route.codeIds?.join('\u0000') ?? '';
  const firstRoute = useRef(true);
  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    if (route.codeIds?.length) setFilter((f) => filterForCodes(route.codeIds!, f));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeCodes]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, serializeFilter(filter));
    } catch {
      // Not remembered (private window); it still applies.
    }
  }, [storageKey, filter]);

  const { data, error } = useLive<Loaded>(
    async (store) => {
      const [codings, codes, documents, groups, cases, attributes, coders, memos] = await Promise.all([
        store.list('coding'),
        store.list('code'),
        store.list('document', { order: 'sort, id' }),
        store.list('docgroup', { order: 'sort, id' }),
        store.list('case'),
        store.list('attribute', { order: 'sort, id' }),
        store.list('coder'),
        store.list('memo', { where: "target_kind = 'coding'" }),
      ]);
      const codingMemos = new Map<string, string>();
      for (const m of memos) if (m.target.id && !codingMemos.has(m.target.id)) codingMemos.set(m.target.id, m.id);
      return { codings, codes, documents, groups, cases, attributes, coders, codingMemos };
    },
    [],
    ['coding', 'code', 'document', 'docgroup', 'case', 'attribute', 'coder', 'memo'],
  );

  // Everything derived from the project alone (not the filter).
  const model = useMemo(() => {
    if (!data) return null;
    const collator = new Intl.Collator(meta.bcp47, { numeric: true, sensitivity: 'base' });
    const tree = buildTree(data.codes);
    const flat = tree.flatten();
    const codeById = new Map(data.codes.map((c) => [c.id, c]));
    const docById = new Map(data.documents.map((d) => [d.id, d]));
    const coderById = new Map(data.coders.map((c) => [c.id, c]));
    const own = new Map<string, number>();
    const docCounts = new Map<string, number>();
    const coderCounts = new Map<string, number>();
    for (const c of data.codings) {
      own.set(c.code_id, (own.get(c.code_id) ?? 0) + 1);
      docCounts.set(c.document_id, (docCounts.get(c.document_id) ?? 0) + 1);
      coderCounts.set(c.coder_id, (coderCounts.get(c.coder_id) ?? 0) + 1);
    }
    const totals = tree.aggregate(own);
    const known: KnownIds = {
      codes: new Set(codeById.keys()),
      documents: new Set(docById.keys()),
      groups: new Set(data.groups.map((g) => g.id)),
      cases: new Set(data.cases.map((c) => c.id)),
      coders: new Set(coderById.keys()),
      attributes: new Set(data.attributes.map((a) => a.id)),
    };
    const parents = new Map<string, string[]>();
    const parentsOf = (id: string) => {
      let p = parents.get(id);
      if (!p) {
        p = tree.ancestors(id).reverse().map((c) => c.name);
        parents.set(id, p);
      }
      return p;
    };
    const coders = [...data.coders].sort((a, b) => Number(b.id === project.me.id) - Number(a.id === project.me.id) || collator.compare(a.name, b.name));
    const cases = [...data.cases].sort((a, b) => collator.compare(a.name, b.name));
    // Folded texts, built once per load, so typing in "text contains" stays quick.
    const foldedCache = new Map<string, string>();
    const folded = (c: Coding) => {
      let f = foldedCache.get(c.id);
      if (f === undefined) {
        f = fold(c.text);
        foldedCache.set(c.id, f);
      }
      return f;
    };
    return { tree, flat, codeById, docById, coderById, own, totals, docCounts, coderCounts, known, parentsOf, coders, cases, folded };
  }, [data, meta.bcp47, project.me.id]);

  const filterData = useMemo<FilterData | null>(() => {
    if (!model || !data) return null;
    const codeItems: ChecklistItem[] = model.flat.map(({ code, depth }) => ({
      id: code.id,
      label: code.name,
      depth,
      color: code.color,
      count: filter.includeChildren ? model.totals.get(code.id)?.total ?? 0 : model.own.get(code.id) ?? 0,
    }));
    return {
      codeItems,
      documents: data.documents,
      documentCounts: model.docCounts,
      groups: data.groups,
      cases: model.cases,
      attributes: data.attributes,
      coders: model.coders,
      coderCounts: model.coderCounts,
      meId: project.me.id,
      known: model.known,
    };
  }, [model, data, filter.includeChildren, project.me.id]);

  // Results follow the filter a moment behind typing, so the list never blocks the keyboard.
  const shownFilter = useDeferredValue(filter);
  const results = useMemo(() => {
    if (!model || !data) return [];
    const core = toSegmentFilter(shownFilter, model.known, data.attributes);
    const kept = filterCodings(data.codings, core, {
      documents: data.documents,
      cases: data.cases,
      attributes: data.attributes,
      descendants: (id) => model.tree.descendants(id),
    });
    const texted = matchText(kept, shownFilter.text, model.folded);
    const { by, descending } = coreSort(shownFilter.sort);
    return sortSegments(texted, by, { documents: data.documents, codes: model.flat.map((f) => f.code) }, descending);
    // Context does not change which segments show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, data, shownFilter.codeIds, shownFilter.includeChildren, shownFilter.documentIds, shownFilter.groupIds, shownFilter.caseIds, shownFilter.conditions, shownFilter.attributeMatch, shownFilter.coderIds, shownFilter.text, shownFilter.overlap, shownFilter.sort]);

  // Co-location: the codes each segment relates to, looked up per card on screen.
  const relatedIndex = useMemo(() => {
    if (!model || !data || !shownFilter.overlap.on) return null;
    const core = toSegmentFilter(shownFilter, model.known, data.attributes).overlapWith;
    if (!core) return null;
    const ids = new Set(core.codeIds);
    if (core.includeChildren) for (const id of core.codeIds) for (const d of model.tree.descendants(id)) ids.add(d.id);
    const byDoc = new Map<string, Coding[]>();
    for (const c of data.codings) {
      if (!ids.has(c.code_id)) continue;
      const list = byDoc.get(c.document_id);
      if (list) list.push(c);
      else byDoc.set(c.document_id, [c]);
    }
    return { byDoc, mode: core.mode };
  }, [model, data, shownFilter]);
  const relatedFor = useCallback(
    (a: Coding): Code[] => {
      if (!relatedIndex || !model) return [];
      const out = new Map<string, Code>();
      for (const b of relatedIndex.byDoc.get(a.document_id) ?? []) {
        if (b.id === a.id || out.has(b.code_id)) continue;
        const ok =
          relatedIndex.mode === 'overlap' ? a.start < b.end && b.start < a.end : relatedIndex.mode === 'within' ? b.start <= a.start && a.end <= b.end : a.start <= b.start && b.end <= a.end;
        const code = model.codeById.get(b.code_id);
        if (ok && code) out.set(b.code_id, code);
      }
      return [...out.values()];
    },
    [relatedIndex, model],
  );

  const docTexts = useDocTexts();
  const onRange = useCallback(
    (from: number, to: number) => {
      const ids = new Set<string>();
      for (let i = from; i < to && i < results.length; i++) ids.add(results[i]!.document_id);
      docTexts.request([...ids]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [results, docTexts.request],
  );

  // ── Selection and keyboard ─────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [active, setActive] = useState(0);
  const anchorIndex = useRef<number | null>(null);
  const list = useRef<VirtualListHandle>(null);
  const focusPending = useRef(false);
  const selectedShown = useMemo(() => results.filter((c) => selected.has(c.id)), [results, selected]);
  const resultsKey = useMemo(() => JSON.stringify([shownFilter.codeIds, shownFilter.includeChildren, shownFilter.documentIds, shownFilter.groupIds, shownFilter.caseIds, shownFilter.conditions, shownFilter.attributeMatch, shownFilter.coderIds, shownFilter.text, shownFilter.overlap, shownFilter.sort]), [shownFilter]);

  useEffect(() => {
    setActive(0);
    anchorIndex.current = null;
  }, [resultsKey]);
  useEffect(() => {
    if (active >= results.length && results.length) setActive(results.length - 1);
  }, [results.length, active]);

  const onToggle = useCallback(
    (c: Coding, index: number, range: boolean) => {
      setSelected((cur) => {
        const next = new Set(cur);
        if (range && anchorIndex.current !== null) {
          const [a, b] = [Math.min(anchorIndex.current, index), Math.max(anchorIndex.current, index)];
          for (let i = a; i <= b; i++) next.add(results[i]!.id);
        } else if (next.has(c.id)) next.delete(c.id);
        else next.add(c.id);
        return next;
      });
      anchorIndex.current = index;
      setActive(index);
    },
    [results],
  );
  const onOpen = useCallback((c: Coding) => go({ name: 'workbench', docId: c.document_id, select: { start: c.start, end: c.end } }), [go]);
  const onMemo = useCallback((memoId: string) => go({ name: 'memos', memoId }), [go]);
  const onFocusCard = useCallback((i: number) => setActive(i), []);

  const moveTo = (i: number) => {
    const next = Math.max(0, Math.min(results.length - 1, i));
    setActive(next);
    focusPending.current = true;
    list.current?.scrollToIndex(next);
  };
  // Focus the active card once it is rendered (it may have needed a scroll first).
  useEffect(() => {
    if (!focusPending.current) return;
    const el = list.current?.element()?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (el) {
      focusPending.current = false;
      el.focus({ preventScroll: true });
    }
  });

  const onListKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).getAttribute('data-testid') !== 'segment-card') return;
    const c = results[active];
    const page = Math.max(1, Math.floor((list.current?.element()?.clientHeight ?? 600) / 140));
    switch (e.key) {
      case 'ArrowDown':
      case 'j':
        e.preventDefault();
        if (e.shiftKey && c) onToggleRange(active + 1);
        moveTo(active + 1);
        return;
      case 'ArrowUp':
      case 'k':
        e.preventDefault();
        if (e.shiftKey && c) onToggleRange(active - 1);
        moveTo(active - 1);
        return;
      case 'PageDown':
        e.preventDefault();
        moveTo(active + page);
        return;
      case 'PageUp':
        e.preventDefault();
        moveTo(active - page);
        return;
      case 'Home':
        e.preventDefault();
        moveTo(0);
        return;
      case 'End':
        e.preventDefault();
        moveTo(results.length - 1);
        return;
      case 'Enter':
        if (c) {
          e.preventDefault();
          onOpen(c);
        }
        return;
      case ' ':
        if (c) {
          e.preventDefault();
          onToggle(c, active, e.shiftKey);
        }
        return;
      case 'm':
        if (c && data?.codingMemos.get(c.id)) {
          e.preventDefault();
          onMemo(data.codingMemos.get(c.id)!);
        }
        return;
      case 'a':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          setSelected(new Set(results.map((r) => r.id)));
        }
        return;
      case 'Escape':
        if (selected.size) {
          e.preventDefault();
          setSelected(new Set());
        }
        return;
    }
  };
  const onToggleRange = (to: number) => {
    const target = results[Math.max(0, Math.min(results.length - 1, to))];
    const cur = results[active];
    if (!target || !cur) return;
    setSelected((s) => new Set([...s, cur.id, target.id]));
  };

  // ── Copy and export ───────────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState<ExportKind | 'copy' | null>(null);
  useHold(busy !== null);

  const labels = useMemo<ExportLabels>(
    () => ({
      code: t('segments.columns.code'),
      codePath: t('segments.columns.codePath'),
      document: t('segments.columns.document'),
      paragraph: t('segments.columns.paragraph'),
      start: t('segments.columns.start'),
      end: t('segments.columns.end'),
      coder: t('segments.columns.coder'),
      text: t('segments.columns.text'),
      context: t('segments.columns.context'),
      comment: t('segments.columns.comment'),
      created: t('segments.columns.created'),
      paragraphShort: (n) => t('segments.card.paragraph', { n }),
      segmentCount: (n) => tp('segments.count', n),
      summary: t('segments.columns.summary'),
      segments: t('segments.columns.segments'),
      documents: t('segments.columns.documents'),
    }),
    [t, tp],
  );

  /** Rows with paragraph numbers (and context), reading one document's text at a time. */
  const buildRows = useCallback(
    async (codings: readonly Coding[], context: ContextMode): Promise<SegmentRow[]> => {
      if (!model) return [];
      const byDoc = new Map<string, Coding[]>();
      for (const c of codings) {
        const l = byDoc.get(c.document_id);
        if (l) l.push(c);
        else byDoc.set(c.document_id, [c]);
      }
      const rows = new Map<string, SegmentRow>();
      for (const [docId, list] of byDoc) {
        let info = docTexts.get(docId);
        if (!info) {
          const dt = await project.store.get('doctext', docId);
          if (dt && !dt.deleted) info = docTextInfo(dt.text);
        }
        for (const c of list) {
          const code = model.codeById.get(c.code_id);
          rows.set(c.id, {
            coding: c,
            codeName: code?.name ?? '?',
            codePath: [...model.parentsOf(c.code_id), code?.name ?? '?'],
            codeColor: code?.color ?? '#7a7f87',
            documentName: model.docById.get(docId)?.name ?? '?',
            paragraph: info ? paragraphNumber(info, c.start) : null,
            coderName: model.coderById.get(c.coder_id)?.name ?? '?',
            shown: context === 'none' ? undefined : shownText(c, context, info?.text ?? null),
          });
        }
      }
      return codings.map((c) => rows.get(c.id)!);
    },
    [model, docTexts, project],
  );

  const copy = async (which: 'selected' | 'all') => {
    const list = which === 'selected' ? selectedShown : results;
    if (!list.length || busy) return;
    setBusy('copy');
    try {
      const text = clipboardText(await buildRows(list, 'none'), labels);
      await writeClipboard(text);
      toast.show({ message: tp('segments.actions.copied', list.length), tone: 'success' });
    } catch (e) {
      toast.show({ message: t('segments.actions.copyFailed', { message: e instanceof Error ? e.message : String(e) }), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  const describe = useCallback(
    (f: FilterState) => {
      if (!model || !data) return [];
      const name = <T extends { id: string; name: string }>(list: readonly T[]) => {
        const m = new Map(list.map((x) => [x.id, x.name]));
        return (id: string) => m.get(id);
      };
      return describeFilter(
        f,
        {
          code: (id) => model.codeById.get(id)?.name,
          document: (id) => model.docById.get(id)?.name,
          group: name(data.groups),
          case: name(data.cases),
          coder: (id) => model.coderById.get(id)?.name,
          attribute: name(data.attributes),
        },
        {
          all: t('segments.report.all'),
          codes: (list) => t('segments.report.codes', { list }),
          codesWithChildren: (list) => t('segments.report.codesWithChildren', { list }),
          documents: (list) => t('segments.report.documents', { list }),
          groups: (list) => t('segments.report.groups', { list }),
          cases: (list) => t('segments.report.cases', { list }),
          conditions: (match, list) => t('segments.report.conditions', { match: t(`segments.cases.match.${match}`), list }),
          coders: (list) => t('segments.report.coders', { list }),
          text: (q) => t('segments.report.text', { q }),
          colocation: (mode, list) => t('segments.report.colocation', { mode: t(`segments.colocation.modes.${mode}`), list }),
          condition: (a, op, v) => `${a} ${t(`segments.cases.ops.${op}`)}${v ? ` ${v}` : ''}`,
        },
      );
    },
    [model, data, t],
  );

  const exportAs = async (kind: ExportKind) => {
    if (busy) return;
    const list = selectedShown.length ? selectedShown : results;
    if (!list.length) {
      toast.show(t('segments.actions.nothing'));
      return;
    }
    setBusy(kind);
    try {
      const rows = await buildRows(list, filter.context);
      const codeOrder = model?.flat.map((f) => f.code.id) ?? [];
      const title = t('segments.file.name', { project: project.info.name });
      const now = DateTime.now();
      const report = () =>
        segmentReport(rows, codeOrder, labels, {
          title: t('segments.report.title'),
          subtitle: t('segments.report.subtitle', { project: project.info.name, date: date(now, 'long') }),
          description: describe(shownFilter),
          lang: meta.bcp47,
          generator: `Trama ${VERSION}`.trim(),
        });
      const spec = {
        csv: { ext: 'csv', filter: t('segments.file.filterCsv'), bytes: () => csvBytes(tableRows(rows, labels) as CsvCell[][], { delimiter: locale === 'en' ? ',' : ';' }) },
        xlsx: { ext: 'xlsx', filter: t('segments.file.filterXlsx'), bytes: () => buildXlsx(xlsxSheets(rows, codeOrder, labels), { title, creator: project.me.name }) },
        docx: { ext: 'docx', filter: t('segments.file.filterDocx'), bytes: () => buildDocx(report()) },
        html: { ext: 'html', filter: t('segments.file.filterHtml'), bytes: () => utf8(buildHtml(report())) },
      }[kind];
      const name = await saveBytes(platform, {
        title: t('segments.actions.exportTitle'),
        defaultName: safeFileName(title, spec.ext),
        filter: { name: spec.filter, extensions: [spec.ext] },
        bytes: spec.bytes,
      });
      if (!name) return;
      await project.log('export', `segments ×${rows.length} → ${name}`).catch((e: unknown) => console.error(e));
      toast.show({ message: t('segments.actions.exported', { name }), tone: 'success' });
    } catch (e) {
      toast.show({ message: t('segments.actions.exportFailed', { message: e instanceof Error ? e.message : String(e) }), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  useCommands(
    () => [
      { id: 'segments.copy', label: t('segments.actions.commandCopy'), group: t('segments.title'), icon: ClipboardCopy, run: () => void copy(selectedShown.length ? 'selected' : 'all'), disabled: !results.length },
      { id: 'segments.export', label: t('segments.actions.commandExport'), group: t('segments.title'), icon: FileText, run: () => void exportAs('docx'), disabled: !results.length },
      { id: 'segments.clear', label: t('segments.actions.commandClear'), group: t('segments.title'), icon: X, run: () => setFilter((f) => clearedFilter(f)) },
    ],
    [t, results.length, selectedShown.length],
  );

  // ── Render ────────────────────────────────────────────────────────────────────────────
  const docs = useMemo(() => documentCount(results), [results]);
  const subtitle = data ? `${tp('segments.count', results.length)} ${tp('segments.inDocuments', docs)}` : undefined;
  const stale = shownFilter !== filter;

  const copyItems: MenuEntry[] = [
    { id: 'selected', label: tp('segments.actions.copySelected', selectedShown.length), icon: ClipboardCopy, disabled: !selectedShown.length, onSelect: () => void copy('selected'), testId: 'copy-selected' },
    { id: 'all', label: tp('segments.actions.copyAll', results.length), icon: ClipboardCopy, disabled: !results.length, onSelect: () => void copy('all'), testId: 'copy-all' },
  ];
  const exportItems: MenuEntry[] = [
    { id: 'docx', label: t('segments.actions.docx'), icon: FileText, onSelect: () => void exportAs('docx'), testId: 'export-docx' },
    { id: 'html', label: t('segments.actions.html'), icon: Globe, onSelect: () => void exportAs('html'), testId: 'export-html' },
    { kind: 'separator' },
    { id: 'xlsx', label: t('segments.actions.xlsx'), icon: FileSpreadsheet, onSelect: () => void exportAs('xlsx'), testId: 'export-xlsx' },
    { id: 'csv', label: t('segments.actions.csv'), icon: FileType, onSelect: () => void exportAs('csv'), testId: 'export-csv' },
  ];

  const actions = data?.codings.length ? (
    <>
      <MenuButton items={copyItems} label={t('segments.actions.copy')} icon={ClipboardCopy} variant="ghost" align="end" data-testid="copy-menu" />
      <MenuButton items={exportItems} label={t('segments.actions.export')} icon={busy && busy !== 'copy' ? undefined : Download} variant="secondary" align="end" data-testid="export-menu" />
    </>
  ) : null;

  let body: React.ReactNode;
  if (error) {
    body = (
      <div className="seg-center">
        <Notice tone="danger">{t('common.unknownError', { message: error instanceof Error ? error.message : String(error) })}</Notice>
      </div>
    );
  } else if (!data || !filterData || !model) {
    body = (
      <div className="seg-center">
        <Spinner size={20} label={t('segments.loading')} />
      </div>
    );
  } else if (!data.codings.length) {
    body = (
      <div className="seg-center">
        <EmptyState
          icon={Highlighter}
          title={t('segments.empty.noneTitle')}
          actions={
            <Button variant="primary" onClick={() => go({ name: 'workbench' })} data-testid="to-workbench">
              {t('segments.empty.toWorkbench')}
            </Button>
          }
          data-testid="segments-empty"
        >
          {t('segments.empty.noneBody')}
        </EmptyState>
      </div>
    );
  } else {
    const allSelected = results.length > 0 && selectedShown.length === results.length;
    const results_ = (
      <div className="seg-results">
        <div className="seg-toolbar">
          <label className="seg-toolbar__all">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = selectedShown.length > 0 && !allSelected;
              }}
              disabled={!results.length}
              onChange={(e) => setSelected(e.target.checked ? new Set(results.map((r) => r.id)) : new Set())}
              data-testid="select-all"
            />
            <span className={selectedShown.length ? 'visually-hidden' : 'seg-toolbar__all-label'}>{t('segments.list.selectAll')}</span>
          </label>
          <div className="seg-toolbar__count" aria-live="polite">
            {selectedShown.length ? (
              <>
                <span className="seg-toolbar__selected" data-testid="selection-count">
                  {tp('segments.list.selected', selectedShown.length)}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} data-testid="clear-selection">
                  {t('segments.list.clearSelection')}
                </Button>
              </>
            ) : null}
          </div>
          <div className="seg-toolbar__view">
            <RadioGroup<ContextMode>
              label={t('segments.context.label')}
              variant="segmented"
              value={filter.context}
              onChange={(context) => setFilter((f) => ({ ...f, context }))}
              options={CONTEXT_MODES.map((m) => ({ value: m, label: t(`segments.context.${m}`) }))}
              className="seg-toolbar__context"
              data-testid="context"
            />
            <Select<SortMode>
              size="sm"
              aria-label={t('segments.sort.label')}
              value={filter.sort}
              onChange={(sort) => setFilter((f) => ({ ...f, sort }))}
              options={SORT_MODES.map((s) => ({ value: s, label: t(`segments.sort.${s}`) }))}
              data-testid="sort"
            />
          </div>
        </div>
        {results.length === 0 ? (
          <div className="seg-center">
            <EmptyState
              title={t('segments.empty.noMatchTitle')}
              actions={
                activeFilterCount(filter, model.known) > 0 ? (
                  <Button variant="secondary" onClick={() => setFilter((f) => clearedFilter(f))} data-testid="empty-clear-filters">
                    {t('segments.filters.clear')}
                  </Button>
                ) : undefined
              }
              data-testid="segments-nomatch"
            >
              {t('segments.empty.noMatchBody')}
            </EmptyState>
          </div>
        ) : (
          <VirtualList
            ref={list}
            items={results}
            getKey={getKey}
            estimate={filter.context === 'none' ? 118 : 170}
            gap={10}
            padding={16}
            resetKey={resultsKey}
            onRange={onRange}
            className={stale ? 'seg-list seg-list--stale' : 'seg-list'}
            role="feed"
            aria-label={t('segments.list.label')}
            aria-busy={stale || undefined}
            aria-describedby="seg-list-hint"
            onKeyDown={onListKey}
            data-testid="segment-list"
            renderItem={(c, i) => {
              const info = docTexts.get(c.document_id);
              return (
                <SegmentCard
                  coding={c}
                  index={i}
                  setSize={results.length}
                  code={model.codeById.get(c.code_id)}
                  codeParents={model.parentsOf(c.code_id)}
                  documentName={model.docById.get(c.document_id)?.name ?? '?'}
                  paragraph={info ? paragraphNumber(info, c.start) : null}
                  coder={model.coderById.get(c.coder_id)}
                  shown={shownText(c, filter.context, info?.text ?? null)}
                  query={shownFilter.text}
                  related={relatedIndex ? relatedFor(c) : NONE}
                  selected={selected.has(c.id)}
                  current={i === active}
                  memoId={data.codingMemos.get(c.id)}
                  onOpen={onOpen}
                  onToggle={onToggle}
                  onMemo={onMemo}
                  onFocusCard={onFocusCard}
                />
              );
            }}
          />
        )}
        <p id="seg-list-hint" className="visually-hidden">
          {t('segments.list.keyboardHint')}
        </p>
      </div>
    );
    body = (
      <SplitPane
        first={<FilterPanel filter={filter} onChange={setFilter} data={filterData} />}
        second={results_}
        initial={276}
        min={236}
        max={460}
        minRest={420}
        storageKey="trama.segments.split"
        label={t('segments.resize')}
        className="segments__split"
        data-testid="segments-split"
      />
    );
  }

  return (
    <div className="segments" data-testid="segments">
      <ScreenHeader title={t('segments.title')} subtitle={subtitle} actions={actions} />
      {body}
    </div>
  );
}

const NONE: readonly Code[] = [];
const getKey = (c: Coding) => c.id;

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (e) {
      // Fall through to the older way (some webviews refuse the async API).
      if (!document.queryCommandSupported?.('copy')) throw e;
    }
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('clipboard unavailable');
}

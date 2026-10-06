import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Highlighter, Search, TextSearch } from 'lucide-react';
import { kwic, type SearchMode, type SearchQuery, SearchError, searchTexts, validateQuery } from '../../../core/qda/search';
import type { Span } from '../../../core/qda/util';
import { Button } from '../../../ui/components/Button';
import { Checkbox, RadioGroup } from '../../../ui/components/Choice';
import { Notice, Spinner } from '../../../ui/components/Feedback';
import { Select, TextField } from '../../../ui/components/Field';
import { useI18n } from '../../../ui/i18n';
import { countPerDocument, groupKwic, hitsWithin, kwicExportRows } from '../lib/kwic';
import { describeSyntaxError } from '../lib/searchErrors';
import { useAnalysisData, useDeferredCompute, useTexts } from '../parts/data';
import { useExporter } from '../parts/exporting';
import { KwicList } from '../parts/KwicList';
import { ExportMenu, PanelSection, PickList, ResultsHead, ResultsMessage, ToolLayout } from '../parts/ui';
import { useToolSettings } from '../parts/useToolSettings';
import { AutocodeDialog } from './AutocodeDialog';

type Scope = 'all' | 'documents' | 'groups' | 'code';
const MODES: SearchMode[] = ['words', 'phrase', 'regex'];
const SCOPES: Scope[] = ['all', 'documents', 'groups', 'code'];
const SHOW_LIMIT = 5000;

const DEFAULTS = {
  mode: 'words' as SearchMode,
  wholeWord: false,
  caseSensitive: false,
  accentSensitive: false,
  scope: 'all' as Scope,
  docIds: [] as string[],
  groupIds: [] as string[],
  codeId: '',
  subcodes: true,
};

interface Run {
  q: SearchQuery;
  n: number;
}

export function SearchTool({ initialQuery }: { initialQuery?: string }) {
  const { t, tp, locale } = useI18n();
  const data = useAnalysisData();
  const { documents, groups, lines, codings, segments } = data;
  const [s, set] = useToolSettings('search', DEFAULTS, { mode: MODES, scope: SCOPES });
  const [text, setText] = useState(initialQuery ?? '');
  const [run, setRun] = useState<Run | null>(() => (initialQuery?.trim() ? { q: { query: initialQuery, mode: DEFAULTS.mode }, n: 0 } : null));
  const [problem, setProblem] = useState<string | null>(null);
  const [coding, setCoding] = useState(false);
  const texts = useTexts(true);
  const exporter = useExporter();
  const field = useRef<HTMLInputElement>(null);

  const scopeDocs = useMemo(() => {
    if (s.scope === 'documents') {
      const want = new Set(s.docIds);
      return documents.filter((d) => want.has(d.id));
    }
    if (s.scope === 'groups') {
      const want = new Set(s.groupIds);
      return documents.filter((d) => d.group_ids.some((g) => want.has(g)));
    }
    return documents;
  }, [documents, s.scope, s.docIds, s.groupIds]);

  const codeSpans = useMemo(() => {
    if (s.scope !== 'code' || !s.codeId) return null;
    const ids = new Set([s.codeId, ...(s.subcodes ? data.descendants(s.codeId).map((c) => c.id) : [])]);
    const m = new Map<string, Span[]>();
    for (const c of codings) {
      if (!ids.has(c.code_id)) continue;
      const l = m.get(c.document_id);
      if (l) l.push({ start: c.start, end: c.end });
      else m.set(c.document_id, [{ start: c.start, end: c.end }]);
    }
    return m;
  }, [s.scope, s.codeId, s.subcodes, codings, data]);

  const query = useCallback(
    (q: string): SearchQuery => ({ query: q, mode: s.mode, wholeWord: s.wholeWord, caseSensitive: s.caseSensitive, accentSensitive: s.accentSensitive }),
    [s.mode, s.wholeWord, s.caseSensitive, s.accentSensitive],
  );

  const message = useCallback(
    (e: SearchError, typed: string) => {
      switch (e.code) {
        case 'empty':
          return t('analysis.search.errors.empty');
        case 'invalid-regex':
          return t('analysis.search.errors.regex', { detail: e.detail });
        case 'negative-only':
          return t('analysis.search.errors.negativeOnly');
        default: {
          // The parser names the token it stopped at; say what is wrong in words, and where.
          const { what, near } = describeSyntaxError(e, typed);
          const detail = t(`analysis.search.errors.problems.${what}`, { op: e.detail.toUpperCase() });
          return near ? t('analysis.search.errors.syntaxNear', { detail, near }) : t('analysis.search.errors.syntax', { detail });
        }
      }
    },
    [t],
  );

  const submit = () => {
    const q = query(text);
    const err = validateQuery(q);
    if (err) {
      setProblem(message(err, q.query));
      return;
    }
    setProblem(null);
    setRun((r) => ({ q, n: (r?.n ?? 0) + 1 }));
  };

  // Options changed after a search: search again with them (the query stays what was run).
  const live = run ? query(run.q.query) : null;
  const liveKey = live ? JSON.stringify(live) : '';

  const scopeReady = s.scope === 'all' || (s.scope === 'documents' && s.docIds.length > 0) || (s.scope === 'groups' && s.groupIds.length > 0) || (s.scope === 'code' && !!s.codeId);

  const searchAll = useCallback(
    (limit: number) => {
      if (!live || !texts) return null;
      const docs = scopeDocs.map((d) => ({ id: d.id, text: texts.get(d.id) ?? '' }));
      const r = searchTexts(docs, live, { limit: codeSpans ? Number.MAX_SAFE_INTEGER : limit, context: 90 });
      if (!codeSpans) return { hits: r.hits, total: r.total, perDocument: r.perDocument };
      const within = hitsWithin(r.hits, codeSpans);
      return { hits: within.slice(0, limit), total: within.length, perDocument: countPerDocument(within) };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveKey, texts, scopeDocs, codeSpans],
  );

  const result = useDeferredCompute(() => {
    if (!run || !scopeReady) return null;
    const r = searchAll(SHOW_LIMIT);
    if (!r) return null;
    const groupsOut = groupKwic(kwic(r.hits, 70), scopeDocs, r.perDocument);
    return { groups: groupsOut, total: r.total, shown: r.hits.length, documents: r.perDocument.size };
  }, [searchAll, run?.n, scopeReady]);

  const loadAll = useCallback(() => {
    const r = searchAll(Number.MAX_SAFE_INTEGER);
    return { hits: r?.hits ?? [], documents: r?.perDocument.size ?? 0 };
  }, [searchAll]);

  const errorText = result.error instanceof SearchError ? message(result.error, run?.q.query ?? '') : result.error ? String(result.error) : null;
  const value = result.value;

  const exportName = `${t('analysis.search.exportName')} – ${run?.q.query ?? ''}`;
  const doExport = (format: 'csv' | 'xlsx') => {
    if (!value) return;
    const header = [t('analysis.search.col.document'), t('analysis.search.col.start'), t('analysis.search.col.end'), t('analysis.search.col.left'), t('analysis.search.col.hit'), t('analysis.search.col.right')];
    void exporter.table(exportName, format, kwicExportRows(value.groups, header), t('analysis.search.exportName'));
  };

  const codeOptions = useMemo(
    () => [{ value: '', label: t('analysis.search.pickCode') }, ...lines.map((l) => ({ value: l.id, label: `${' '.repeat(l.depth)}${l.name}${segments.get(l.id) ? ` (${segments.get(l.id)})` : ''}` }))],
    [lines, segments, t],
  );

  const panel = (
    <form
      className="an-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <PanelSection title={t('analysis.search.query')}>
        <TextField
          ref={field}
          value={text}
          onChange={(v) => {
            setText(v);
            if (problem) setProblem(null);
          }}
          placeholder={s.mode === 'regex' ? t('analysis.search.placeholderRegex') : s.mode === 'phrase' ? t('analysis.search.placeholderPhrase') : t('analysis.search.placeholder')}
          aria-label={t('analysis.search.query')}
          error={problem ?? undefined}
          spellCheck={false}
          autoComplete="off"
          className="an-query"
          data-testid="search-query"
          autoFocus={!initialQuery}
        />
        <RadioGroup<SearchMode>
          label={t('analysis.search.mode')}
          hideLabel
          variant="segmented"
          value={s.mode}
          onChange={(mode) => set({ mode })}
          options={MODES.map((m) => ({ value: m, label: t(`analysis.search.modes.${m}`) }))}
          data-testid="search-mode"
        />
        {s.mode === 'words' ? (
          <details className="an-syntax">
            <summary>{t('analysis.search.syntaxTitle')}</summary>
            <dl>
              {(['and', 'or', 'not', 'phrase', 'wildcard'] as const).map((k) => (
                <React.Fragment key={k}>
                  <dt>{t(`analysis.search.syntax.${k}Ex`)}</dt>
                  <dd>{t(`analysis.search.syntax.${k}`)}</dd>
                </React.Fragment>
              ))}
            </dl>
          </details>
        ) : null}
        <div className="an-checks">
          <Checkbox label={t('analysis.search.wholeWord')} checked={s.wholeWord} onChange={(wholeWord) => set({ wholeWord })} disabled={s.mode === 'regex'} data-testid="search-whole" />
          <Checkbox label={t('analysis.search.caseSensitive')} checked={s.caseSensitive} onChange={(caseSensitive) => set({ caseSensitive })} data-testid="search-case" />
          <Checkbox label={t('analysis.search.accentSensitive')} checked={s.accentSensitive} onChange={(accentSensitive) => set({ accentSensitive })} data-testid="search-accent" />
        </div>
      </PanelSection>
      <PanelSection title={t('analysis.search.scope')}>
        <Select<Scope>
          value={s.scope}
          onChange={(scope) => set({ scope })}
          aria-label={t('analysis.search.scope')}
          size="sm"
          options={SCOPES.map((v) => ({ value: v, label: t(`analysis.search.scopes.${v}`) }))}
          data-testid="search-scope"
        />
        {s.scope === 'documents' ? (
          <PickList
            label={t('analysis.search.scopes.documents')}
            items={documents.map((d) => ({ id: d.id, label: d.name, color: d.color }))}
            selected={new Set(s.docIds)}
            onChange={(ids) => set({ docIds: [...ids] })}
            testId="search-docs"
          />
        ) : null}
        {s.scope === 'groups' ? (
          groups.length ? (
            <PickList
              label={t('analysis.search.scopes.groups')}
              items={groups.map((g) => ({ id: g.id, label: g.name, color: g.color, count: documents.filter((d) => d.group_ids.includes(g.id)).length }))}
              selected={new Set(s.groupIds)}
              onChange={(ids) => set({ groupIds: [...ids] })}
              testId="search-groups"
            />
          ) : (
            <p className="an-hint">{t('analysis.noGroups')}</p>
          )
        ) : null}
        {s.scope === 'code' ? (
          <>
            <Select<string> value={s.codeId} onChange={(codeId) => set({ codeId })} options={codeOptions} size="sm" aria-label={t('analysis.search.scopes.code')} data-testid="search-code" />
            <Checkbox label={t('analysis.includeSubcodes')} checked={s.subcodes} onChange={(subcodes) => set({ subcodes })} />
          </>
        ) : null}
      </PanelSection>
      <div className="an-form__actions">
        <Button type="submit" variant="primary" icon={Search} disabled={!texts} data-testid="search-run">
          {t('analysis.search.run')}
        </Button>
      </div>
    </form>
  );

  let body: React.ReactNode;
  if (!run) {
    body = (
      <ResultsMessage icon={TextSearch} title={t('analysis.search.emptyTitle')} testId="search-empty">
        {t('analysis.search.emptyBody')}
      </ResultsMessage>
    );
  } else if (!scopeReady) {
    body = <ResultsMessage icon={TextSearch} title={t('analysis.search.scopeEmpty')} />;
  } else if (errorText) {
    body = (
      <div className="an-pad">
        <Notice tone="danger">{errorText}</Notice>
      </div>
    );
  } else if (!value) {
    body = (
      <div className="an__center">
        <Spinner size={20} label={t('analysis.computing')} />
      </div>
    );
  } else if (value.total === 0) {
    body = (
      <ResultsMessage icon={TextSearch} title={t('analysis.search.noHits')} testId="search-nohits">
        {t('analysis.search.noHitsBody')}
      </ResultsMessage>
    );
  } else {
    body = <KwicList groups={value.groups} label={t('analysis.search.resultsLabel')} />;
  }

  return (
    <ToolLayout label={t('analysis.tools.search')} panel={panel} testId="tool-search">
      <ResultsHead
        title={value && run ? tp('analysis.search.hits', value.total) : t('analysis.results')}
        meta={
          value && run && value.total > 0 ? (
            <>
              {tp('analysis.search.inDocuments', value.documents)}
              {value.shown < value.total ? ` · ${t('analysis.search.truncated', { n: value.shown.toLocaleString(locale) })}` : ''}
              {result.busy ? <Spinner size={12} className="an-inline-spin" /> : null}
            </>
          ) : null
        }
      >
        <Button size="sm" variant="secondary" icon={Highlighter} disabled={!value?.total} onClick={() => setCoding(true)} data-testid="search-autocode">
          {t('analysis.search.codeAll')}
        </Button>
        <ExportMenu tables={doExport} disabled={!value?.total} testId="search-export" />
      </ResultsHead>
      <div className={`an-results__body${result.busy && value ? ' an-results__body--stale' : ''}`}>{body}</div>
      <AutocodeDialog open={coding} onClose={() => setCoding(false)} load={loadAll} query={run?.q.query ?? ''} />
    </ToolLayout>
  );
}


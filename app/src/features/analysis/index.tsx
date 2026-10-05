import React, { Suspense, useCallback, useEffect, useMemo } from 'react';
import { BarChart3, Grid3x3, Network, Table2, TextSearch, WholeWord } from 'lucide-react';
import type { ScreenProps, AnalysisTool } from '../../shell/router';
import { useRouter } from '../../shell/router';
import { useProject } from '../../shell/AppState';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { useCommands } from '../../shell/useCommands';
import { Notice, Spinner } from '../../ui/components/Feedback';
import { useI18n } from '../../ui/i18n';
import { readSettings, settingsKey, writeSettings } from './lib/settings';
import { AnalysisDataProvider, useLoadAnalysisData } from './parts/data';
import { SearchTool } from './tools/SearchTool';
import { CooccurrenceTool } from './tools/CooccurrenceTool';
import { MatrixTool } from './tools/MatrixTool';
import { CrosstabTool } from './tools/CrosstabTool';
import { WordsTool } from './tools/WordsTool';
import { ChartsTool } from './tools/ChartsTool';
import './analysis.css';

export const TOOLS: readonly AnalysisTool[] = ['search', 'cooccurrence', 'matrix', 'crosstab', 'words', 'charts'];

const ICONS = { search: TextSearch, cooccurrence: Network, matrix: Grid3x3, crosstab: Table2, words: WholeWord, charts: BarChart3 } as const;

/** Queries and visualisations: text search, co-occurrence, matrices, word frequencies, charts. */
export default function AnalysisScreen({ route }: ScreenProps<'analysis'>) {
  const { t } = useI18n();
  const project = useProject();
  const { replace } = useRouter();
  const { data, error } = useLoadAnalysisData();
  const lastKey = settingsKey(project.id, 'tool');
  const remembered = useMemo(() => readSettings(lastKey, { tool: 'search' as AnalysisTool }, { tool: TOOLS }).tool, [lastKey]);
  const tool: AnalysisTool = route.tool && TOOLS.includes(route.tool) ? route.tool : remembered;

  const choose = useCallback(
    (next: AnalysisTool) => {
      writeSettings(lastKey, { tool: next });
      replace({ name: 'analysis', tool: next });
    },
    [lastKey, replace],
  );
  useEffect(() => {
    if (route.tool) writeSettings(lastKey, { tool: route.tool });
  }, [route.tool, lastKey]);

  useCommands(
    () =>
      TOOLS.map((id) => ({
        id: `analysis.tool.${id}`,
        label: t(`analysis.tools.${id}`),
        group: t('analysis.title'),
        icon: ICONS[id],
        run: () => choose(id),
      })),
    [t, choose],
  );

  return (
    <div className="an" data-testid="analysis">
      <ScreenHeader title={t('analysis.title')} subtitle={t(`analysis.toolHints.${tool}`)} />
      <nav className="an-tools" aria-label={t('analysis.tools.label')}>
        <div className="an-tools__list" role="tablist" aria-label={t('analysis.tools.label')} onKeyDown={(e) => onTabKey(e, tool, choose)}>
          {TOOLS.map((id) => {
            const Icon = ICONS[id];
            const selected = id === tool;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="an-panel"
                id={`an-tab-${id}`}
                tabIndex={selected ? 0 : -1}
                data-tool={id}
                className={`an-tools__tab${selected ? ' an-tools__tab--on' : ''}`}
                onClick={() => choose(id)}
                data-testid={`analysis-tool-${id}`}
              >
                <Icon size={15} strokeWidth={1.75} aria-hidden />
                <span>{t(`analysis.tools.${id}`)}</span>
              </button>
            );
          })}
        </div>
      </nav>
      <div className="an__body" role="tabpanel" id="an-panel" aria-labelledby={`an-tab-${tool}`}>
        {error ? (
          <div className="an__center">
            <Notice tone="danger" title={t('analysis.loadFailed')}>
              {error instanceof Error ? error.message : String(error)}
            </Notice>
          </div>
        ) : !data ? (
          <div className="an__center">
            <Spinner size={22} label={t('common.loading')} />
          </div>
        ) : (
          <AnalysisDataProvider value={data}>
            <Suspense fallback={<div className="an__center"><Spinner size={22} label={t('common.loading')} /></div>}>
              <ToolView key={tool} tool={tool} query={route.query} />
            </Suspense>
          </AnalysisDataProvider>
        )}
      </div>
    </div>
  );
}

function ToolView({ tool, query }: { tool: AnalysisTool; query?: string }) {
  switch (tool) {
    case 'search':
      return <SearchTool initialQuery={query} />;
    case 'cooccurrence':
      return <CooccurrenceTool />;
    case 'matrix':
      return <MatrixTool />;
    case 'crosstab':
      return <CrosstabTool />;
    case 'words':
      return <WordsTool />;
    case 'charts':
      return <ChartsTool />;
  }
}

function onTabKey(e: React.KeyboardEvent<HTMLDivElement>, tool: AnalysisTool, choose: (t: AnalysisTool) => void) {
  const i = TOOLS.indexOf(tool);
  let next: AnalysisTool | undefined;
  if (e.key === 'ArrowRight') next = TOOLS[(i + 1) % TOOLS.length];
  else if (e.key === 'ArrowLeft') next = TOOLS[(i - 1 + TOOLS.length) % TOOLS.length];
  else if (e.key === 'Home') next = TOOLS[0];
  else if (e.key === 'End') next = TOOLS[TOOLS.length - 1];
  if (!next) return;
  e.preventDefault();
  choose(next);
  const target = next;
  const list = e.currentTarget;
  requestAnimationFrame(() => list.querySelector<HTMLElement>(`[data-tool="${target}"]`)?.focus());
}

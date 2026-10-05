import React, { useMemo } from 'react';
import { FileAudio, FileText, FileUp, ListChecks, NotebookPen, StickyNote } from 'lucide-react';
import type { DocKind } from '../../core/model/types';
import { listDocuments, projectSummary, type DocumentRow } from '../../services/queries';
import { useProject } from '../../shell/AppState';
import { useLive } from '../../shell/useLive';
import { Button } from '../../ui/components/Button';
import { EmptyState } from '../../ui/components/Feedback';
import { useI18n } from '../../ui/i18n';

// The centre pane when no document is open: a calm summary of the project and the documents
// read most recently, or — in a project without documents — the way to import some.

const KIND_ICON: Record<DocKind, typeof FileText> = { text: FileText, transcript: FileAudio, pdf: FileText, survey: ListChecks, note: NotebookPen };

export function Overview({ recent, onOpen, onImport }: { recent: readonly string[]; onOpen: (id: string) => void; onImport: () => void }) {
  const { t, tp, meta } = useI18n();
  const project = useProject();
  const { data: summary } = useLive(() => projectSummary(project), [project], ['document', 'code', 'coding', 'memo', 'case']);
  const { data: rows } = useLive(() => listDocuments(project), [project], ['document', 'coding', 'case', 'docgroup']);
  const nf = useMemo(() => new Intl.NumberFormat(meta.bcp47), [meta.bcp47]);

  const shown = useMemo(() => {
    if (!rows) return [];
    const byId = new Map(rows.map((r) => [r.document.id, r]));
    const picked: DocumentRow[] = [];
    for (const id of recent) {
      const r = byId.get(id);
      if (r) picked.push(r);
      if (picked.length >= 6) break;
    }
    for (const r of rows) {
      if (picked.length >= 6) break;
      if (!picked.includes(r)) picked.push(r);
    }
    return picked;
  }, [rows, recent]);

  if (!summary || !rows) return <div className="wb-overview" />;
  if (!rows.length) {
    return (
      <div className="wb-overview wb-overview--empty" data-testid="workbench-empty">
        <EmptyState
          icon={FileUp}
          title={t('workbench.empty.title')}
          actions={
            <Button variant="primary" icon={FileUp} onClick={onImport} data-testid="workbench-import">
              {t('workbench.empty.import')}
            </Button>
          }
        >
          {t('workbench.empty.body')}
        </EmptyState>
      </div>
    );
  }

  const stats: { label: string; value: number; icon: typeof FileText }[] = [
    { label: t('workbench.overview.documents'), value: summary.documents, icon: FileText },
    { label: t('workbench.overview.codings'), value: summary.codings, icon: ListChecks },
    { label: t('workbench.overview.codes'), value: summary.codes, icon: NotebookPen },
    { label: t('workbench.overview.memos'), value: summary.memos, icon: StickyNote },
  ];
  const pct = summary.documents ? Math.round((summary.codedDocuments / summary.documents) * 100) : 0;

  return (
    <div className="wb-overview" data-testid="workbench-overview">
      <div className="wb-overview__inner">
        <p className="wb-overview__eyebrow">{project.info.name}</p>
        <h2 className="wb-overview__title">{t('workbench.overview.title')}</h2>
        <p className="wb-overview__lead">{t('workbench.overview.lead')}</p>

        <dl className="wb-stats">
          {stats.map((s) => (
            <div key={s.label} className="wb-stat">
              <dt className="wb-stat__label">{s.label}</dt>
              <dd className="wb-stat__value t-tabular">{nf.format(s.value)}</dd>
            </div>
          ))}
        </dl>

        <div className="wb-progress" aria-label={t('workbench.overview.coded', { n: summary.codedDocuments, total: summary.documents })}>
          <div className="wb-progress__bar">
            <span style={{ width: `${pct}%` }} />
          </div>
          <span className="wb-progress__text">{t('workbench.overview.coded', { n: summary.codedDocuments, total: summary.documents })}</span>
        </div>

        <h3 className="wb-overview__heading">{recent.length ? t('workbench.overview.recent') : t('workbench.overview.start')}</h3>
        <ul className="wb-recent">
          {shown.map((r) => {
            const Icon = KIND_ICON[r.document.kind];
            return (
              <li key={r.document.id}>
                <button type="button" className="wb-recent__item" onClick={() => onOpen(r.document.id)} data-testid="overview-doc">
                  <span className="wb-recent__icon" aria-hidden>
                    <Icon size={16} strokeWidth={1.6} />
                  </span>
                  <span className="wb-recent__main">
                    <span className="wb-recent__name">{r.document.name}</span>
                    <span className="wb-recent__meta">
                      {[t(`workbench.kind.${r.document.kind}`), r.caseName, tp('common.count.codings', r.codings)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

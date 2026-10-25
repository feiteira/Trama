import React, { useRef } from 'react';
import { CircleAlert, Copy, KeyRound, Plus, TriangleAlert } from 'lucide-react';
import { useI18n } from '../../ui/i18n';
import { Checkbox } from '../../ui/components/Choice';
import { Spinner } from '../../ui/components/Feedback';
import { cx } from '../../ui/cx';
import { failureMessage, say } from './messages';
import type { Duplicate, ReviewRow } from './model';
import type { SurveyCount } from './survey';

const FORMAT_LABEL: Record<string, string> = { docx: 'DOCX', odt: 'ODT', pdf: 'PDF', rtf: 'RTF', txt: 'TXT', md: 'MD', html: 'HTML', vtt: 'VTT', srt: 'SRT', csv: 'CSV', xlsx: 'XLSX' };

const extLabel = (filename: string) => (/\.([a-z0-9]{1,5})$/i.exec(filename)?.[1] ?? '').toUpperCase() || '—';

/** The incoming documents: include or leave out, and pick one to review. */
export function ReviewList({
  rows,
  selected,
  duplicates,
  onSelect,
  onToggle,
  onToggleAll,
  onAdd,
  surveyCount,
}: {
  rows: ReviewRow[];
  selected: string | null;
  duplicates: Map<string, Duplicate>;
  onSelect: (id: string) => void;
  onToggle: (id: string, include: boolean) => void;
  onToggleAll: (include: boolean) => void;
  onAdd: () => void;
  surveyCount: (row: ReviewRow) => SurveyCount;
}) {
  const { t, tp, meta } = useI18n();
  const list = useRef<HTMLUListElement>(null);
  const eligible = rows.filter((r) => r.status === 'ready' || r.status === 'password');
  const included = eligible.filter((r) => r.include).length;
  const fmt = new Intl.NumberFormat(meta.bcp47);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    if (!(e.target instanceof HTMLElement) || !e.target.classList.contains('imp-item__main')) return;
    e.preventDefault();
    const i = rows.findIndex((r) => r.id === selected);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    const row = rows[next];
    if (!row) return;
    onSelect(row.id);
    list.current?.querySelector<HTMLElement>(`[data-row="${row.id}"] .imp-item__main`)?.focus();
  };

  return (
    <div className="imp-list">
      <div className="imp-list__head">
        <Checkbox
          checked={included > 0 && included === eligible.length}
          indeterminate={included > 0 && included < eligible.length}
          disabled={!eligible.length}
          onChange={onToggleAll}
          label={t('importer.list.selectAll')}
          className="imp-list__all"
          data-testid="import-include-all"
        />
        <span className="imp-list__count">{t('importer.list.included', { n: included, total: rows.length })}</span>
      </div>
      <ul ref={list} className="imp-list__items" aria-label={t('importer.list.label')} onKeyDown={onKeyDown} data-testid="import-rows">
        {rows.map((r) => {
          const dup = duplicates.get(r.id);
          let meta2: React.ReactNode;
          let tone: 'danger' | 'warning' | null = null;
          if (r.status === 'reading') meta2 = t('importer.list.reading');
          else if (r.status === 'error') {
            tone = 'danger';
            meta2 = (
              <>
                <CircleAlert size={12} aria-hidden /> {r.failure ? say(failureMessage(r.failure), t, tp) : t('importer.list.failed')}
              </>
            );
          } else if (r.status === 'password') {
            tone = 'warning';
            meta2 = (
              <>
                <KeyRound size={12} aria-hidden /> {t('importer.list.needsPassword')}
              </>
            );
          } else {
            const parts: string[] = [t(`importer.kinds.${r.kind}`)];
            if (r.table) parts.push(tp('importer.list.respondents', r.table.table.rows.length), tp('importer.survey.documents', surveyCount(r).documents));
            else if (r.transcribe) parts.push(t('importer.recording.list'));
            else parts.push(tp('importer.detail.words', r.words, { n: fmt.format(r.words) }));
            meta2 = parts.join(' · ');
          }
          const warnings = r.doc?.warnings.length ?? r.table?.table.warnings?.length ?? 0;
          return (
            <li key={r.id} data-row={r.id} className={cx('imp-item', r.id === selected && 'imp-item--selected', !r.include && 'imp-item--out', r.status === 'error' && 'imp-item--error')} data-testid="import-row">
              <Checkbox
                checked={r.include && r.status !== 'error'}
                disabled={r.status === 'error' || r.status === 'reading'}
                onChange={(v) => onToggle(r.id, v)}
                label={<span className="visually-hidden">{t('importer.list.include', { name: r.name || r.filename })}</span>}
                className="imp-item__check"
                data-testid="import-row-include"
              />
              <button type="button" className="imp-item__main" aria-current={r.id === selected ? 'true' : undefined} onClick={() => onSelect(r.id)} data-testid="import-row-select">
                <span className="imp-item__fmt" aria-hidden>
                  {r.status === 'reading' ? <Spinner size={13} /> : (r.format && FORMAT_LABEL[r.format]) || (r.origin === 'paste' ? 'TXT' : extLabel(r.filename))}
                </span>
                <span className="imp-item__text">
                  <span className="imp-item__name">{r.name || r.filename}</span>
                  <span className={cx('imp-item__meta', tone && `imp-item__meta--${tone}`)}>{meta2}</span>
                </span>
                <span className="imp-item__flags">
                  {dup ? (
                    <span className="imp-flag imp-flag--warning" title={dup.kind === 'project' ? t('importer.list.duplicate') : t('importer.list.duplicateBatch')}>
                      <Copy size={12} aria-hidden />
                      <span className="visually-hidden">{dup.kind === 'project' ? t('importer.list.duplicate') : t('importer.list.duplicateBatch')}</span>
                    </span>
                  ) : null}
                  {warnings && r.status === 'ready' ? (
                    <span className="imp-flag imp-flag--warning" title={tp('importer.list.warnings', warnings)}>
                      <TriangleAlert size={12} aria-hidden />
                      <span className="visually-hidden">{tp('importer.list.warnings', warnings)}</span>
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="imp-list__add" onClick={onAdd} data-testid="import-list-add">
        <Plus size={14} aria-hidden />
        {t('importer.actions.addFiles')}
      </button>
    </div>
  );
}

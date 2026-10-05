import React, { useMemo } from 'react';
import { surveyToDocuments, type ImportedTableResult } from '../../core/import';
import { useI18n } from '../../ui/i18n';
import { RadioGroup, Switch } from '../../ui/components/Choice';
import { Notice } from '../../ui/components/Feedback';
import { Select } from '../../ui/components/Field';
import { type ColumnRole, makesCases, mappingProblem, setRole, type SurveyCount, type SurveyMapping as Mapping, toSurveyOptions } from './survey';

const ROLES: ColumnRole[] = ['text', 'attribute', 'id', 'ignore'];
const PREVIEW_ROWS = 25;

/** The survey mapping step: what each column holds, how documents are laid out, and a preview. */
export function SurveyMapping({
  table,
  mapping,
  count,
  onChange,
  onSheet,
}: {
  table: ImportedTableResult;
  mapping: Mapping;
  count: SurveyCount;
  onChange: (m: Mapping) => void;
  onSheet: (sheet: number) => void;
}) {
  const { t, tp } = useI18n();
  const tbl = table.table;
  const problem = mappingProblem(tbl, mapping);

  const samples = useMemo(
    () =>
      tbl.headers.map((_, c) => {
        const out: string[] = [];
        for (const r of tbl.rows) {
          const v = (r[c] ?? '').replace(/\s+/g, ' ').trim();
          if (v && !out.includes(v)) out.push(v);
          if (out.length >= 2) break;
        }
        return out;
      }),
    [tbl],
  );

  // The first document, from the first rows only (a big table need not be laid out twice).
  const preview = useMemo(() => {
    if (problem) return null;
    const r = surveyToDocuments({ ...tbl, rows: tbl.rows.slice(0, PREVIEW_ROWS) }, toSurveyOptions(mapping));
    const doc = r.documents[0];
    if (!doc) return null;
    const spans = r.questionSpans[0] ?? [];
    let pos = 0;
    const lines = doc.text.split('\n').map((line) => {
      const start = pos;
      pos += line.length + 1;
      return { line, answer: spans.some((s) => start >= s.start && start < s.end) };
    });
    return { name: doc.name, lines: lines.slice(0, 40), more: lines.length > 40 };
  }, [tbl, mapping, problem]);

  const idExample = `${tbl.name.replace(/\s+/g, ' ').trim() || '#'} 1`;
  const counts = {
    documents: tp('importer.survey.documents', count.documents),
    cases: tp('importer.survey.caseCount', count.cases),
    answers: mapping.autoCode ? tp('importer.survey.answers', count.answers) : t('importer.survey.answersNone'),
  };

  return (
    <section className="imp-card imp-survey" aria-labelledby="imp-survey-title" data-testid="import-survey">
      <header className="imp-card__head">
        <h3 id="imp-survey-title" className="imp-card__title">
          {t('importer.survey.title')}
        </h3>
        {table.sheets.length > 1 ? (
          <Select<string>
            aria-label={t('importer.survey.sheet')}
            size="sm"
            value={String(table.sheet)}
            onChange={(v) => onSheet(Number(v))}
            options={table.sheets.map((s, i) => ({ value: String(i), label: s.name }))}
            data-testid="import-survey-sheet"
          />
        ) : null}
      </header>
      <p className="imp-card__intro">{t('importer.survey.intro')}</p>

      <div className="imp-columns" role="table" aria-label={t('importer.survey.title')}>
        <div className="imp-columns__row imp-columns__row--head" role="row">
          <span role="columnheader">{t('importer.survey.column')}</span>
          <span role="columnheader">{t('importer.survey.sample')}</span>
          <span role="columnheader">{t('importer.survey.role')}</span>
        </div>
        {tbl.headers.map((h, c) => (
          <div key={c} className={`imp-columns__row imp-columns__row--${mapping.roles[c]}`} role="row" data-testid="import-survey-column">
            <span role="cell" className="imp-columns__name" title={h}>
              {h}
            </span>
            <span role="cell" className="imp-columns__sample" title={samples[c]!.join(' · ')}>
              {samples[c]!.length ? samples[c]!.join(' · ') : <em>{t('importer.survey.empty')}</em>}
            </span>
            <span role="cell">
              <Select<ColumnRole>
                aria-label={t('importer.survey.roleOf', { name: h })}
                size="sm"
                value={mapping.roles[c] ?? 'ignore'}
                onChange={(role) => onChange({ ...mapping, roles: setRole(mapping.roles, c, role) })}
                options={ROLES.map((r) => ({ value: r, label: t(`importer.survey.roles.${r}`) }))}
                data-testid="import-survey-role"
              />
            </span>
          </div>
        ))}
      </div>
      {!mapping.roles.includes('id') ? <p className="imp-hint">{t('importer.survey.noId', { example: idExample })}</p> : null}

      <div className="imp-survey__options">
        <RadioGroup
          label={t('importer.survey.layout')}
          value={mapping.layout}
          onChange={(layout) => onChange({ ...mapping, layout })}
          options={[
            { value: 'one-per-respondent', label: t('importer.survey.perRespondent'), description: t('importer.survey.perRespondentHint') },
            { value: 'one-per-question', label: t('importer.survey.perQuestion'), description: t('importer.survey.perQuestionHint') },
          ]}
          data-testid="import-survey-layout"
        />
        <div className="imp-survey__switches">
          <Switch
            checked={mapping.autoCode}
            onChange={(autoCode) => onChange({ ...mapping, autoCode })}
            label={t('importer.survey.autoCode')}
            description={t('importer.survey.autoCodeHint', { category: t('importer.autocode.questions') })}
            data-testid="import-survey-autocode"
          />
          <Switch
            checked={makesCases(mapping)}
            disabled={mapping.layout !== 'one-per-respondent'}
            onChange={(createCases) => onChange({ ...mapping, createCases })}
            label={t('importer.survey.cases')}
            description={mapping.layout === 'one-per-respondent' ? t('importer.survey.casesHint') : t('importer.survey.casesPerQuestion')}
            data-testid="import-survey-cases"
          />
        </div>
      </div>

      {problem ? (
        <Notice tone="warning" data-testid="import-survey-problem">
          {t(problem === 'noText' ? 'importer.survey.noText' : 'importer.survey.noRows')}
        </Notice>
      ) : (
        <p className="imp-survey__creates" data-testid="import-survey-creates">
          {count.cases ? t('importer.survey.creates', counts) : t('importer.survey.createsNoCases', counts)}
        </p>
      )}

      {preview ? (
        <div className="imp-preview" data-testid="import-survey-preview">
          <div className="imp-preview__head">
            <h4 className="imp-preview__title">{t('importer.survey.previewOf', { name: preview.name })}</h4>
          </div>
          <div className="imp-preview__page" tabIndex={0} aria-label={t('importer.preview.label', { name: preview.name })}>
            {preview.lines.map((l, i) => (
              <p key={i} className={l.answer ? 'imp-preview__p' : 'imp-preview__q'}>
                {l.line}
              </p>
            ))}
            {preview.more ? <p className="imp-preview__more">{t('importer.preview.more')}</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

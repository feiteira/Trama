import React, { useId, useState, type ReactNode } from 'react';
import { ChevronRight, Plus, X } from 'lucide-react';
import type { Attribute, Case, Coder, DocGroup, Document } from '../../core/model/types';
import type { ConditionOp } from '../../core/qda/attributes';
import type { OverlapMode } from '../../core/qda/segments';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import { Button, IconButton } from '../../ui/components/Button';
import { Checkbox, Switch } from '../../ui/components/Choice';
import { SearchField, Select, TextField } from '../../ui/components/Field';
import { Checklist, type ChecklistItem } from './Checklist';
import {
  activeFilterCount, clearedFilter, CONDITION_OPS, type ConditionRow, type FilterState, isCompleteCondition, type KnownIds, OVERLAP_MODES, opNeedsValue, toggleId,
} from './filter';

export interface FilterData {
  codeItems: ChecklistItem[];
  documents: readonly Document[];
  documentCounts: ReadonlyMap<string, number>;
  groups: readonly DocGroup[];
  cases: readonly Case[];
  attributes: readonly Attribute[];
  coders: readonly Coder[];
  coderCounts: ReadonlyMap<string, number>;
  meId: string;
  known: KnownIds;
}

type SectionId = 'codes' | 'documents' | 'cases' | 'coders' | 'text' | 'colocation';

const OPEN_KEY = 'trama.segments.sections';

function readOpen(): Set<SectionId> {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? 'null') as unknown;
    if (Array.isArray(v)) return new Set(v.filter((x): x is SectionId => typeof x === 'string') as SectionId[]);
  } catch {
    // The defaults below.
  }
  return new Set<SectionId>(['codes', 'text']);
}

let seq = 0;
const newKey = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

/** The filter sidebar of the Coded segments screen. */
export function FilterPanel({ filter, onChange, data }: { filter: FilterState; onChange: (f: FilterState) => void; data: FilterData }) {
  const { t, tp } = useI18n();
  const [open, setOpen] = useState<Set<SectionId>>(readOpen);
  const set = (patch: Partial<FilterState>) => onChange({ ...filter, ...patch });
  const toggleSection = (id: SectionId) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
      } catch {
        // Not remembered; it still opens.
      }
      return next;
    });
  const k = data.known;
  const live = (ids: readonly string[], known: ReadonlySet<string>) => ids.filter((id) => known.has(id)).length;
  const summary = (n: number) => (n ? tp('segments.filters.selected', n) : t('segments.filters.any'));
  const activeSummary = (n: number) => (n ? tp('segments.filters.active', n) : t('segments.filters.any'));

  const docItems: ChecklistItem[] = data.documents.map((d) => ({ id: d.id, label: d.name, color: d.color, count: data.documentCounts.get(d.id) ?? 0 }));
  const caseItems: ChecklistItem[] = data.cases.map((c) => ({ id: c.id, label: c.name, color: c.color }));
  const nCodes = live(filter.codeIds, k.codes);
  const nDocs = live(filter.documentIds, k.documents) + live(filter.groupIds, k.groups);
  const nCases = live(filter.caseIds, k.cases) + filter.conditions.filter((c) => isCompleteCondition(c, k.attributes)).length;
  const nCoders = live(filter.coderIds, k.coders);
  const nOverlap = filter.overlap.on ? live(filter.overlap.codeIds, k.codes) : 0;

  return (
    <div className="seg-filters" role="search" aria-label={t('segments.filters.label')} data-testid="segment-filters">
      <div className="seg-filters__head">
        <h2 className="seg-filters__title">{t('segments.filters.title')}</h2>
        {activeFilterCount(filter, k) > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => onChange(clearedFilter(filter))} data-testid="clear-filters">
            {t('segments.filters.clear')}
          </Button>
        ) : null}
      </div>
      <div className="seg-filters__scroll">
        <Section id="codes" title={t('segments.codes.title')} summary={summary(nCodes)} active={nCodes > 0} open={open.has('codes')} onToggle={toggleSection} onClear={() => set({ codeIds: [] })}>
          {data.codeItems.length ? (
            <>
              <Checklist
                items={data.codeItems}
                selected={filter.codeIds}
                onChange={(codeIds) => set({ codeIds })}
                label={t('segments.codes.title')}
                searchPlaceholder={t('segments.codes.search')}
                noMatch={(q) => t('segments.codes.noMatch', { q })}
                maxHeight={260}
                data-testid="filter-codes"
              />
              <Checkbox checked={filter.includeChildren} onChange={(includeChildren) => set({ includeChildren })} label={t('segments.codes.includeChildren')} className="seg-filters__check" data-testid="include-children" />
            </>
          ) : (
            <p className="seg-filters__note">{t('segments.codes.none')}</p>
          )}
        </Section>

        <Section id="documents" title={t('segments.documents.title')} summary={summary(nDocs)} active={nDocs > 0} open={open.has('documents')} onToggle={toggleSection} onClear={() => set({ documentIds: [], groupIds: [] })}>
          {data.groups.length ? (
            <div className="seg-filters__group">
              <span className="seg-filters__label" id="seg-groups-label">{t('segments.documents.groups')}</span>
              <div className="seg-chips" role="group" aria-labelledby="seg-groups-label">
                {data.groups.map((g) => {
                  const on = filter.groupIds.includes(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      className={cx('seg-chip', on && 'seg-chip--on')}
                      aria-pressed={on}
                      onClick={() => set({ groupIds: toggleId(filter.groupIds, g.id) })}
                      data-testid={`filter-group-${g.id}`}
                    >
                      <span className="seg-chip__dot" style={{ background: g.color }} aria-hidden />
                      {g.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="seg-filters__group">
            {data.groups.length ? <span className="seg-filters__label">{t('segments.documents.list')}</span> : null}
            <Checklist
              items={docItems}
              selected={filter.documentIds}
              onChange={(documentIds) => set({ documentIds })}
              label={t('segments.documents.list')}
              searchPlaceholder={docItems.length > 8 ? t('segments.documents.search') : undefined}
              noMatch={(q) => t('segments.documents.noMatch', { q })}
              maxHeight={220}
              data-testid="filter-documents"
            />
          </div>
        </Section>

        <Section id="cases" title={t('segments.cases.title')} summary={activeSummary(nCases)} active={nCases > 0} open={open.has('cases')} onToggle={toggleSection} onClear={() => set({ caseIds: [], conditions: [] })}>
          {caseItems.length ? (
            <div className="seg-filters__group">
              <span className="seg-filters__label">{t('segments.cases.list')}</span>
              <Checklist
                items={caseItems}
                selected={filter.caseIds}
                onChange={(caseIds) => set({ caseIds })}
                label={t('segments.cases.list')}
                searchPlaceholder={caseItems.length > 8 ? t('segments.cases.search') : undefined}
                maxHeight={180}
                data-testid="filter-cases"
              />
            </div>
          ) : (
            <p className="seg-filters__note">{t('segments.cases.none')}</p>
          )}
          <Conditions filter={filter} onChange={onChange} attributes={data.attributes} cases={data.cases} />
        </Section>

        {data.coders.length > 1 || nCoders > 0 ? (
          <Section id="coders" title={t('segments.coders.title')} summary={summary(nCoders)} active={nCoders > 0} open={open.has('coders')} onToggle={toggleSection} onClear={() => set({ coderIds: [] })}>
            <div className="seg-filters__checks">
              {data.coders.map((c) => (
                <Checkbox
                  key={c.id}
                  checked={filter.coderIds.includes(c.id)}
                  onChange={(on) => set({ coderIds: toggleId(filter.coderIds, c.id, on) })}
                  label={
                    <span className="seg-coder">
                      <span className="seg-coder__dot" style={{ background: c.color }} aria-hidden />
                      <span className="seg-coder__name">{c.id === data.meId ? t('segments.coders.me', { name: c.name }) : c.name}</span>
                      <span className="seg-coder__count">{data.coderCounts.get(c.id) ?? 0}</span>
                    </span>
                  }
                  data-testid={`filter-coder-${c.id}`}
                />
              ))}
            </div>
          </Section>
        ) : null}

        <Section id="text" title={t('segments.text.title')} summary={filter.text.trim() ? `“${filter.text.trim()}”` : t('segments.filters.any')} active={!!filter.text.trim()} open={open.has('text')} onToggle={toggleSection} onClear={() => set({ text: '' })}>
          <SearchField size="sm" value={filter.text} onChange={(text) => set({ text })} placeholder={t('segments.text.placeholder')} aria-label={t('segments.text.title')} data-testid="filter-text" />
        </Section>

        <Section id="colocation" title={t('segments.colocation.title')} summary={nOverlap ? t(`segments.colocation.modeLabels.${filter.overlap.mode}`) : t('segments.filters.any')} active={nOverlap > 0} open={open.has('colocation')} onToggle={toggleSection} onClear={() => set({ overlap: { ...filter.overlap, on: false, codeIds: [] } })}>
          <Switch checked={filter.overlap.on} onChange={(on) => set({ overlap: { ...filter.overlap, on } })} label={t('segments.colocation.enable')} data-testid="colocation-on" />
          {filter.overlap.on ? (
            <>
              <Select<OverlapMode>
                size="sm"
                label={t('segments.colocation.mode')}
                value={filter.overlap.mode}
                onChange={(mode) => set({ overlap: { ...filter.overlap, mode } })}
                options={OVERLAP_MODES.map((m) => ({ value: m, label: t(`segments.colocation.modeLabels.${m}`) }))}
                data-testid="colocation-mode"
              />
              <div className="seg-filters__group">
                <span className="seg-filters__label">{t('segments.colocation.codes')}</span>
                <Checklist
                  items={data.codeItems}
                  selected={filter.overlap.codeIds}
                  onChange={(codeIds) => set({ overlap: { ...filter.overlap, codeIds } })}
                  label={t('segments.colocation.codes')}
                  searchPlaceholder={t('segments.codes.search')}
                  noMatch={(q) => t('segments.codes.noMatch', { q })}
                  maxHeight={200}
                  data-testid="colocation-codes"
                />
              </div>
              <Checkbox
                checked={filter.overlap.includeChildren}
                onChange={(includeChildren) => set({ overlap: { ...filter.overlap, includeChildren } })}
                label={t('segments.colocation.includeChildren')}
                className="seg-filters__check"
              />
              <p className="seg-filters__note">{t('segments.colocation.hint', { mode: t(`segments.colocation.modes.${filter.overlap.mode}`) })}</p>
            </>
          ) : null}
        </Section>
      </div>
    </div>
  );
}

function Section({
  id, title, summary, active, open, onToggle, onClear, children,
}: { id: SectionId; title: string; summary: string; active: boolean; open: boolean; onToggle: (id: SectionId) => void; onClear: () => void; children: ReactNode }) {
  const { t } = useI18n();
  const bodyId = useId();
  return (
    <section className={cx('seg-section', open && 'seg-section--open')} data-testid={`filter-section-${id}`}>
      <div className="seg-section__head">
        <button type="button" className="seg-section__toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => onToggle(id)} data-testid={`filter-toggle-${id}`}>
          <ChevronRight size={14} strokeWidth={2} className="seg-section__chevron" aria-hidden />
          <span className="seg-section__title">{title}</span>
          <span className={cx('seg-section__summary', active && 'seg-section__summary--active')}>{summary}</span>
        </button>
        {active ? (
          <IconButton icon={X} size="sm" label={`${t('segments.filters.clearSection')}: ${title}`} onClick={onClear} className="seg-section__clear" data-testid={`filter-clear-${id}`} />
        ) : null}
      </div>
      {open ? (
        <div className="seg-section__body" id={bodyId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

function Conditions({ filter, onChange, attributes, cases }: { filter: FilterState; onChange: (f: FilterState) => void; attributes: readonly Attribute[]; cases: readonly Case[] }) {
  const { t } = useI18n();
  const rows = filter.conditions;
  const setRows = (conditions: ConditionRow[]) => onChange({ ...filter, conditions });
  const update = (key: string, patch: Partial<ConditionRow>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  if (!attributes.length) return <p className="seg-filters__note">{t('segments.cases.noAttributes')}</p>;
  return (
    <div className="seg-filters__group">
      <span className="seg-filters__label">{t('segments.cases.conditions')}</span>
      {rows.length > 1 ? (
        <Select<'all' | 'any'>
          size="sm"
          aria-label={t('segments.cases.matchLabel')}
          label={t('segments.cases.matchLabel')}
          value={filter.attributeMatch}
          onChange={(attributeMatch) => onChange({ ...filter, attributeMatch })}
          options={[
            { value: 'all', label: t('segments.cases.match.all') },
            { value: 'any', label: t('segments.cases.match.any') },
          ]}
          data-testid="condition-match"
        />
      ) : null}
      {rows.map((r, i) => {
        const attr = attributes.find((a) => a.id === r.attributeId);
        return (
          <div key={r.key} className="seg-cond" data-testid={`condition-${i}`}>
            <div className="seg-cond__line">
              <Select<string>
                size="sm"
                aria-label={t('segments.cases.attribute')}
                value={r.attributeId}
                onChange={(attributeId) => update(r.key, { attributeId, value: '' })}
                options={[{ value: '', label: t('segments.cases.chooseAttribute'), disabled: true }, ...attributes.map((a) => ({ value: a.id, label: a.name }))]}
                fieldClassName="seg-cond__attr"
                data-testid="condition-attribute"
              />
              <IconButton icon={X} size="sm" label={t('segments.cases.removeCondition')} onClick={() => setRows(rows.filter((x) => x.key !== r.key))} data-testid="condition-remove" />
            </div>
            <div className="seg-cond__line">
              <Select<ConditionOp>
                size="sm"
                aria-label={t('segments.cases.operator')}
                value={r.op}
                onChange={(op) => update(r.key, { op })}
                options={CONDITION_OPS.map((op) => ({ value: op, label: t(`segments.cases.ops.${op}`) }))}
                fieldClassName="seg-cond__op"
                data-testid="condition-op"
              />
              {opNeedsValue(r.op) ? <ValueInput attr={attr} cases={cases} value={r.value} onChange={(value) => update(r.key, { value })} /> : null}
            </div>
          </div>
        );
      })}
      <Button
        size="sm"
        variant="ghost"
        icon={Plus}
        className="seg-filters__add"
        onClick={() => setRows([...rows, { key: newKey(), attributeId: attributes[0]?.id ?? '', op: 'eq', value: '' }])}
        data-testid="condition-add"
      >
        {t('segments.cases.addCondition')}
      </Button>
    </div>
  );
}

function ValueInput({ attr, cases, value, onChange }: { attr: Attribute | undefined; cases: readonly Case[]; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const label = t('segments.cases.value');
  if (attr?.type === 'boolean') {
    return (
      <Select<string>
        size="sm"
        aria-label={label}
        value={value}
        onChange={onChange}
        options={[
          { value: '', label: t('segments.cases.chooseValue'), disabled: true },
          { value: 'true', label: t('common.yes') },
          { value: 'false', label: t('common.no') },
        ]}
        fieldClassName="seg-cond__value"
        data-testid="condition-value"
      />
    );
  }
  if (attr && (attr.type === 'choice' || attr.type === 'text')) {
    // Choices offer their options; text attributes offer the values cases actually have.
    const values = attr.type === 'choice' ? attr.options : [...new Set(cases.map((c) => c.values[attr.id]).filter((v): v is string => typeof v === 'string' && v.trim() !== ''))].sort();
    if (values.length && values.length <= 40) {
      return (
        <Select<string>
          size="sm"
          aria-label={label}
          value={value}
          onChange={onChange}
          options={[{ value: '', label: t('segments.cases.chooseValue'), disabled: true }, ...values.map((v) => ({ value: v, label: v }))]}
          fieldClassName="seg-cond__value"
          data-testid="condition-value"
        />
      );
    }
  }
  return (
    <TextField
      size="sm"
      aria-label={label}
      value={value}
      onChange={onChange}
      placeholder={label}
      type={attr?.type === 'number' ? 'number' : attr?.type === 'date' ? 'date' : 'text'}
      fieldClassName="seg-cond__value"
      data-testid="condition-value"
    />
  );
}

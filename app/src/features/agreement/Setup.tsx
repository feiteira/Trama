import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, ChevronDown, FileText, Tags } from 'lucide-react';
import type { Coder } from '../../core/model/types';
import { Button, IconButton } from '../../ui/components/Button';
import { Checkbox, RadioGroup } from '../../ui/components/Choice';
import { Dialog } from '../../ui/components/Dialog';
import { SearchField, Select } from '../../ui/components/Field';
import { fold } from '../../core/text/normalize';
import { useI18n } from '../../ui/i18n';
import { fmtPercent, type Level, LEVELS } from './model';

export interface PickItem {
  id: string;
  label: string;
  color?: string;
  /** Indent (code depth). */
  depth?: number;
  hint?: string;
  /** A group label (a category code that cannot be applied): shown, not selectable. */
  heading?: boolean;
}

export interface Preset {
  id: string;
  label: string;
  ids: readonly string[];
}

/** Choose some of many (documents or codes): filter, presets, checkboxes. */
export function PickerDialog({
  open,
  onClose,
  title,
  items,
  selected,
  presets,
  onApply,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  items: readonly PickItem[];
  selected: readonly string[];
  presets: readonly Preset[];
  onApply: (ids: string[]) => void;
  testId: string;
}) {
  const { t } = useI18n();
  const [sel, setSel] = useState<Set<string>>(() => new Set(selected));
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (open) {
      setSel(new Set(selected));
      setQuery('');
    }
    // Only when opening: later changes of `selected` must not wipe what is being chosen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const shown = useMemo(() => {
    const q = fold(query.trim());
    return q ? items.filter((i) => fold(i.label).includes(q)) : items;
  }, [items, query]);
  const toggle = (id: string, on: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const apply = () => onApply(items.filter((i) => !i.heading && sel.has(i.id)).map((i) => i.id));
  const selectable = items.filter((i) => !i.heading).length;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="md"
      onSubmit={apply}
      data-testid={testId}
      footer={
        <>
          <span className="agr-picker__count t-tabular">{t('agreement.picker.selected', { n: sel.size, total: selectable })}</span>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" data-testid={`${testId}-apply`}>
            {t('agreement.picker.apply')}
          </Button>
        </>
      }
    >
      <div className="agr-picker">
        <div className="agr-picker__tools">
          <SearchField
            value={query}
            onChange={setQuery}
            aria-label={t('agreement.picker.filter')}
            placeholder={t('agreement.picker.filter')}
            size="sm"
            fieldClassName="agr-picker__search"
            data-testid={`${testId}-filter`}
          />
          <div className="agr-picker__presets" role="group" aria-label={title}>
            {presets.map((p) => (
              <Button key={p.id} size="sm" variant="ghost" onClick={() => setSel(new Set(p.ids))} data-testid={`${testId}-preset-${p.id}`}>
                {p.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="agr-picker__list" role="group" aria-label={title}>
          {shown.length === 0 ? <p className="agr-picker__empty">{t('agreement.picker.noMatch', { query })}</p> : null}
          {shown.map((i) =>
            i.heading ? (
              <div key={i.id} className="agr-picker__row agr-picker__heading" style={i.depth ? { paddingLeft: `${i.depth * 18}px` } : undefined}>
                <span className="agr-picker__label">
                  {i.color ? <span className="agr-chip" style={{ background: i.color }} aria-hidden /> : null}
                  <span className="agr-picker__name">{i.label}</span>
                </span>
              </div>
            ) : (
              <div key={i.id} className="agr-picker__row" style={i.depth ? { paddingLeft: `${i.depth * 18}px` } : undefined}>
                <Checkbox
                  checked={sel.has(i.id)}
                  onChange={(on) => toggle(i.id, on)}
                  label={
                    <span className="agr-picker__label">
                      {i.color ? <span className="agr-chip" style={{ background: i.color }} aria-hidden /> : null}
                      <span className="agr-picker__name">{i.label}</span>
                      {i.hint ? <span className="agr-picker__hint t-tabular">{i.hint}</span> : null}
                    </span>
                  }
                  data-testid={`${testId}-item`}
                />
              </div>
            ),
          )}
        </div>
      </div>
    </Dialog>
  );
}

export interface SetupProps {
  coders: readonly Coder[];
  a: string | null;
  b: string | null;
  onCoders: (a: string | null, b: string | null) => void;
  docSummary: string;
  codeSummary: string;
  onChooseDocs: () => void;
  onChooseCodes: () => void;
  level: Level;
  onLevel: (l: Level) => void;
  threshold: number;
  onThreshold: (x: number) => void;
  oneOnly: number;
  onIncludeOneOnly: () => void;
}

function CoderSelect({
  label,
  coders,
  value,
  other,
  onChange,
  testId,
}: {
  label: string;
  coders: readonly Coder[];
  value: string | null;
  other: string | null;
  onChange: (id: string) => void;
  testId: string;
}) {
  const color = coders.find((c) => c.id === value)?.color;
  return (
    <div className="agr-coder">
      <span className="agr-coder__dot" style={color ? { background: color } : undefined} aria-hidden />
      <Select<string>
        label={label}
        value={value ?? ''}
        onChange={onChange}
        options={coders.map((c) => ({ value: c.id, label: c.name, disabled: c.id === other }))}
        data-testid={testId}
      />
    </div>
  );
}

/** What to compare: two coders, documents, codes and the method. */
export function Setup(p: SetupProps) {
  const { t, tp, meta } = useI18n();
  return (
    <section className="agr-setup" aria-label={t('agreement.setup.label')}>
      <div className="agr-setup__main">
        <div className="agr-setup__coders">
          <CoderSelect
            label={t('agreement.setup.coderA')}
            coders={p.coders}
            value={p.a}
            other={p.b}
            onChange={(id) => p.onCoders(id, p.b)}
            testId="agreement-coder-a"
          />
          <IconButton
            icon={ArrowLeftRight}
            label={t('agreement.setup.swap')}
            onClick={() => p.onCoders(p.b, p.a)}
            className="agr-setup__swap"
            data-testid="agreement-swap"
          />
          <CoderSelect
            label={t('agreement.setup.coderB')}
            coders={p.coders}
            value={p.b}
            other={p.a}
            onChange={(id) => p.onCoders(p.a, id)}
            testId="agreement-coder-b"
          />
        </div>
        <div className="agr-setup__field">
          <span className="field__label" id="agr-docs-label">
            {t('agreement.setup.documents')}
          </span>
          <Button
            variant="secondary"
            icon={FileText}
            iconEnd={ChevronDown}
            onClick={p.onChooseDocs}
            aria-describedby="agr-docs-label"
            className="agr-setup__choose"
            data-testid="agreement-choose-docs"
          >
            {p.docSummary}
          </Button>
        </div>
        <div className="agr-setup__field">
          <span className="field__label" id="agr-codes-label">
            {t('agreement.setup.codes')}
          </span>
          <Button
            variant="secondary"
            icon={Tags}
            iconEnd={ChevronDown}
            onClick={p.onChooseCodes}
            aria-describedby="agr-codes-label"
            className="agr-setup__choose"
            data-testid="agreement-choose-codes"
          >
            {p.codeSummary}
          </Button>
        </div>
      </div>
      <div className="agr-setup__row agr-setup__row--method">
        <RadioGroup<Level>
          label={t('agreement.setup.method')}
          variant="segmented"
          value={p.level}
          onChange={p.onLevel}
          options={LEVELS.map((l) => ({ value: l, label: t(`agreement.methods.${l}`) }))}
          data-testid="agreement-method"
        />
        <p className="agr-setup__method-hint">{t(`agreement.methods.${p.level}Hint`)}</p>
        {p.level === 'segment' ? (
          <label className="agr-threshold" title={t('agreement.setup.thresholdHint')}>
            <span className="field__label">{t('agreement.setup.threshold')}</span>
            <input
              type="range"
              min={50}
              max={100}
              step={5}
              value={Math.round(p.threshold * 100)}
              onChange={(e) => p.onThreshold(Number(e.target.value) / 100)}
              aria-valuetext={fmtPercent(p.threshold * 100, meta.bcp47, 0)}
              className="agr-threshold__range"
              style={{ '--agr-fill': `${((p.threshold - 0.5) / 0.5) * 100}%` } as React.CSSProperties}
              data-testid="agreement-threshold"
            />
            <output className="agr-threshold__value t-tabular">{fmtPercent(p.threshold * 100, meta.bcp47, 0)}</output>
          </label>
        ) : null}
      </div>
      {p.oneOnly > 0 ? (
        <p className="agr-setup__note" data-testid="agreement-one-only">
          {tp('agreement.setup.oneOnly', p.oneOnly)}{' '}
          <button type="button" className="agr-link" onClick={p.onIncludeOneOnly} data-testid="agreement-include-one-only">
            {t('agreement.setup.includeOneOnly')}
          </button>
        </p>
      ) : null}
    </section>
  );
}

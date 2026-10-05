import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { Pseudonym } from '../../core/model/types';
import { type Candidate, createPseudonym, suggestCandidates } from '../../services/pseudonyms';
import { combineUndo, type Undoable } from '../../services/undo';
import { useHold, useProject } from '../../shell/AppState';
import { useUndo } from '../../shell/undo';
import { useI18n } from '../../ui/i18n';
import { Button } from '../../ui/components/Button';
import { Checkbox } from '../../ui/components/Choice';
import { Dialog } from '../../ui/components/Dialog';
import { EmptyState, Spinner } from '../../ui/components/Feedback';
import { SearchField, Select, TextField } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { fillPattern, filterCandidates, nextNumber } from './key';

interface Row extends Candidate {
  on: boolean;
  /** Typed by the researcher; null follows the pattern. */
  custom: string | null;
}

const PRESETS = ['participant', 'person', 'place', 'organisation'] as const;

/**
 * Likely names in the documents, for the researcher to review: tick the ones to replace, adjust
 * each replacement, and add them to the key. Nothing in the documents changes yet.
 */
export function SuggestDialog({ entries, onClose }: { entries: Pseudonym[]; onClose: () => void }) {
  const { t, tp } = useI18n();
  const project = useProject();
  const { record } = useUndo();
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [preset, setPreset] = useState<(typeof PRESETS)[number] | 'custom'>('participant');
  const [pattern, setPattern] = useState(t('pseudonyms.suggest.patterns.participant'));
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  useHold(busy || rows === null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const texts = (await project.store.list('doctext')).map((d) => d.text);
        const found = suggestCandidates(texts, { exclude: entries.map((e) => e.original), limit: 300 });
        if (live) setRows(found.map((c) => ({ ...c, on: false, custom: null })));
      } catch (e) {
        toast.error(e);
        if (live) setRows([]);
      }
    })();
    return () => {
      live = false;
    };
    // Suggestions are computed once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ticked rows following the pattern are numbered in list order, after the key's own numbers.
  const start = useMemo(() => nextNumber(pattern, entries.map((e) => e.replacement)), [pattern, entries]);
  const replacementOf = useMemo(() => {
    const map = new Map<string, string>();
    let n = start;
    for (const r of rows ?? []) {
      if (!r.on) continue;
      map.set(r.text, r.custom ?? fillPattern(pattern, n++));
    }
    return map;
  }, [rows, pattern, start]);

  const shown = useMemo(() => filterCandidates(rows ?? [], query), [rows, query]);
  const chosen = (rows ?? []).filter((r) => r.on);
  const update = (text: string, patch: Partial<Row>) => setRows((cur) => (cur ?? []).map((r) => (r.text === text ? { ...r, ...patch } : r)));

  const add = async () => {
    if (!chosen.length) return;
    setBusy(true);
    const parts: Undoable[] = [];
    try {
      for (const r of chosen) {
        const replacement = (replacementOf.get(r.text) ?? '').trim() || fillPattern(pattern, start);
        parts.push((await createPseudonym(project, { original: r.text, replacement, whole_word: true, case_sensitive: true })).undo);
      }
      toast.show({ message: tp('pseudonyms.suggest.added', parts.length), tone: 'success' });
      onClose();
    } catch (e) {
      toast.error(e);
      setBusy(false);
    } finally {
      if (parts.length) record(parts.length === 1 ? parts[0]! : combineUndo('pseudonym.edit', `×${parts.length}`, parts));
    }
  };

  const all = shown.length > 0 && shown.every((r) => r.on);
  const some = !all && shown.some((r) => r.on);

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      size="lg"
      title={t('pseudonyms.suggest.title')}
      description={t('pseudonyms.suggest.intro')}
      data-testid="suggest-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void add()} disabled={!chosen.length} busy={busy} data-testid="suggest-add">
            {chosen.length ? tp('pseudonyms.suggest.add', chosen.length) : t('pseudonyms.suggest.addNone')}
          </Button>
        </>
      }
    >
      {rows === null ? (
        <div className="psug__loading">
          <Spinner size={18} />
          <span>{t('pseudonyms.suggest.reading')}</span>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Sparkles} title={t('pseudonyms.suggest.noneTitle')}>
          {t('pseudonyms.suggest.noneBody')}
        </EmptyState>
      ) : (
        <div className="psug">
          <div className="psug__controls">
            <Select<string>
              label={t('pseudonyms.suggest.pattern')}
              size="sm"
              value={preset}
              onChange={(v) => {
                const k = v as (typeof PRESETS)[number] | 'custom';
                setPreset(k);
                if (k !== 'custom') setPattern(t(`pseudonyms.suggest.patterns.${k}`));
              }}
              options={[...PRESETS.map((k) => ({ value: k, label: t(`pseudonyms.suggest.patterns.${k}`).replace('{n}', 'N') })), { value: 'custom', label: t('pseudonyms.suggest.custom') }]}
              data-testid="suggest-preset"
            />
            <TextField
              label={t('pseudonyms.suggest.patternText')}
              size="sm"
              value={pattern}
              onChange={(v) => {
                setPattern(v);
                setPreset('custom');
              }}
              hint={t('pseudonyms.suggest.patternHint')}
              fieldClassName="psug__pattern"
              data-testid="suggest-pattern"
            />
            <SearchField value={query} onChange={setQuery} placeholder={t('pseudonyms.suggest.filter')} aria-label={t('pseudonyms.suggest.filter')} size="sm" fieldClassName="psug__filter" data-testid="suggest-filter" />
          </div>
          <div className="psug__table" role="group" aria-label={t('pseudonyms.suggest.title')}>
            <div className="psug__head">
              <Checkbox
                checked={all}
                indeterminate={some}
                onChange={(on) => {
                  const keys = new Set(shown.map((r) => r.text));
                  setRows((cur) => (cur ?? []).map((r) => (keys.has(r.text) ? { ...r, on } : r)));
                }}
                label={t('pseudonyms.suggest.candidate')}
                data-testid="suggest-all"
              />
              <span className="psug__head-count">{t('pseudonyms.suggest.count')}</span>
              <span className="psug__head-repl">{t('pseudonyms.cols.replacement')}</span>
            </div>
            <ul className="psug__list">
              {shown.map((r) => (
                <li key={r.text} className="psug__row">
                  <Checkbox checked={r.on} onChange={(on) => update(r.text, { on })} label={<span className="psug__text">{r.text}</span>} data-testid={`suggest-row-${r.text}`} />
                  <span className="psug__count">{r.count}</span>
                  <input
                    className="psug__repl"
                    value={r.on ? replacementOf.get(r.text) ?? '' : ''}
                    placeholder={r.on ? '' : '—'}
                    disabled={!r.on}
                    aria-label={t('pseudonyms.suggest.replacementFor', { name: r.text })}
                    onChange={(e) => update(r.text, { custom: e.target.value })}
                    data-testid={`suggest-repl-${r.text}`}
                  />
                </li>
              ))}
            </ul>
          </div>
          <p className="psug__note">{t('pseudonyms.suggest.note')}</p>
        </div>
      )}
    </Dialog>
  );
}

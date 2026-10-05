import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { Check, ExternalLink, Plus, UserRound } from 'lucide-react';
import { DOC_KINDS, PALETTE, type Case, type DocGroup, type DocKind, type Document, type Memo } from '../../../core/model/types';
import { fold } from '../../../core/text/normalize';
import { documentStats, type DocumentStats } from '../../../services/documents';
import { memosFor } from '../../../services/memos';
import { useProject } from '../../../shell/AppState';
import { inkOn } from '../../../ui/color';
import { cx } from '../../../ui/cx';
import { useI18n } from '../../../ui/i18n';
import type { Rect } from '../../../ui/position';
import { Button } from '../../../ui/components/Button';
import { Checkbox } from '../../../ui/components/Choice';
import { Dialog } from '../../../ui/components/Dialog';
import { SearchField, Select, TextArea, TextField } from '../../../ui/components/Field';
import { Popover } from '../../../ui/components/Popover';
import { Spinner } from '../../../ui/components/Feedback';
import './panels.css';

// ---------------------------------------------------------------------------------------------
// Case picker: choose a case, none, or create one from the typed name

export function CasePicker({
  at,
  cases,
  current,
  onClose,
  onPick,
  onCreate,
}: {
  at: Rect | React.RefObject<HTMLElement | null> | null;
  cases: readonly Case[];
  /** The case all the documents share (undefined: they differ). */
  current: string | null | undefined;
  onClose: () => void;
  onPick: (caseId: string | null) => void;
  onCreate: (name: string) => void;
}) {
  const { t, meta } = useI18n();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const list = useRef<HTMLDivElement>(null);
  const sorted = useMemo(() => {
    const c = new Intl.Collator(meta.bcp47, { numeric: true, sensitivity: 'base' });
    return [...cases].sort((a, b) => c.compare(a.name, b.name));
  }, [cases, meta.bcp47]);
  const q = fold(query);
  const shown = q ? sorted.filter((c) => fold(c.name).includes(q)) : sorted;
  const exact = q ? sorted.find((c) => fold(c.name) === q) : undefined;
  type Opt = { kind: 'none' } | { kind: 'case'; c: Case } | { kind: 'create'; name: string };
  const options: Opt[] = [
    ...(q ? [] : [{ kind: 'none' as const }]),
    ...shown.map((c) => ({ kind: 'case' as const, c })),
    ...(query.trim() && !exact ? [{ kind: 'create' as const, name: query.trim() }] : []),
  ];
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const choose = (o: Opt | undefined) => {
    if (!o) return;
    onClose();
    if (o.kind === 'none') onPick(null);
    else if (o.kind === 'case') onPick(o.c.id);
    else onCreate(o.name);
  };
  return (
    <Popover open={at !== null} onClose={onClose} anchor={at} padded className="dpicker" aria-label={t('documents.casePicker.title')} data-testid="case-picker">
      <SearchField
        value={query}
        onChange={setQuery}
        size="sm"
        placeholder={t('documents.casePicker.search')}
        aria-label={t('documents.casePicker.search')}
        aria-controls={listId}
        aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
        data-autofocus
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, Math.min(options.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1))));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(options[active]);
          }
        }}
        data-testid="case-picker-search"
      />
      <div ref={list} id={listId} role="listbox" aria-label={t('documents.casePicker.title')} className="dpicker__list">
        {options.map((o, i) => {
          const selected = o.kind === 'none' ? current === null : o.kind === 'case' ? current === o.c.id : false;
          return (
            <div
              key={o.kind === 'case' ? o.c.id : o.kind}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={selected}
              data-index={i}
              data-active={i === active || undefined}
              className={cx('dpicker__option', o.kind === 'create' && 'dpicker__option--create')}
              onPointerDown={(e) => e.preventDefault()}
              onPointerMove={() => setActive(i)}
              onClick={() => choose(o)}
              data-testid={o.kind === 'case' ? `case-option-${o.c.id}` : `case-option-${o.kind}`}
            >
              {o.kind === 'create' ? <Plus size={14} aria-hidden /> : o.kind === 'case' ? <span className="dpicker__dot" style={{ background: o.c.color ?? 'var(--ink-4)' }} aria-hidden /> : <span className="dpicker__dot dpicker__dot--none" aria-hidden />}
              <span className="dpicker__label">
                {o.kind === 'none' ? t('documents.casePicker.none') : o.kind === 'case' ? o.c.name : t('documents.casePicker.create', { name: o.name })}
              </span>
              {selected ? <Check size={14} aria-hidden className="dpicker__tick" /> : null}
            </div>
          );
        })}
        {!options.length ? <p className="dpicker__empty">{t('documents.casePicker.empty')}</p> : null}
      </div>
    </Popover>
  );
}

// ---------------------------------------------------------------------------------------------
// Colour

export function ColourPopover({
  at,
  value,
  onClose,
  onChange,
  label,
}: {
  at: Rect | null;
  value: string | null;
  onClose: () => void;
  onChange: (c: string | null) => void;
  label: string;
}) {
  const { t } = useI18n();
  return (
    <Popover open={at !== null} onClose={onClose} anchor={at} padded aria-label={label} data-testid="doc-colour-popover">
      <div className="dcolour">
        <DocColourChoice label={label} value={value} onChange={onChange} data-testid="doc-colour" />
      </div>
    </Popover>
  );
}

// ---------------------------------------------------------------------------------------------
// A document's colour: none, or one of the palette (radio swatches, arrow keys move)

export function DocColourChoice({ value, onChange, label, ...rest }: { value: string | null; onChange: (c: string | null) => void; label: string; 'data-testid'?: string }) {
  const { t } = useI18n();
  const name = useId();
  const testId = rest['data-testid'];
  return (
    <fieldset className="colorpicker dcolourchoice" data-testid={testId}>
      <legend className="field__label">{label}</legend>
      <div className="colorpicker__swatches dcolourchoice__swatches" role="radiogroup" aria-label={label}>
        <label className="colorpicker__swatch dcolourchoice__none" title={t('documents.colour.none')}>
          <input type="radio" name={name} checked={value === null} onChange={() => onChange(null)} className="choice__input" aria-label={t('documents.colour.none')} data-testid={testId ? `${testId}-none` : undefined} />
          {value === null ? <Check size={14} strokeWidth={3} aria-hidden /> : null}
        </label>
        {PALETTE.map((c, i) => (
          <label key={c} className="colorpicker__swatch" style={{ background: c }} title={c}>
            <input type="radio" name={name} checked={value === c} onChange={() => onChange(c)} className="choice__input" aria-label={t('common.colourN', { n: i + 1, hex: c })} data-testid={testId ? `${testId}-${i}` : undefined} />
            {value === c ? <Check size={14} strokeWidth={3} color={inkOn(c)} aria-hidden /> : null}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------------------------
// Small name prompt (new group)

export function NamePrompt({ open, title, label, initial = '', confirm, onCancel, onSubmit }: { open: boolean; title: string; label: string; initial?: string; confirm: string; onCancel: () => void; onSubmit: (name: string) => Promise<void> | void }) {
  const { t } = useI18n();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setName(initial);
  }, [open, initial]);
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(name.trim());
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      onSubmit={() => void submit()}
      data-testid="name-prompt"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim()} busy={busy} data-testid="name-prompt-ok">
            {confirm}
          </Button>
        </>
      }
    >
      <TextField label={label} value={name} onChange={setName} maxLength={200} data-autofocus data-testid="name-prompt-input" />
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Memo

export function DocumentMemoDialog({
  doc,
  onClose,
  onSave,
  onOpenMemos,
}: {
  doc: Document;
  onClose: () => void;
  onSave: (memo: Memo | null, title: string, body: string) => Promise<void>;
  onOpenMemos: (memoId: string | null) => void;
}) {
  const { t, tp, relative } = useI18n();
  const project = useProject();
  const [memos, setMemos] = useState<Memo[] | null>(null);
  const [editing, setEditing] = useState<Memo | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void memosFor(project, { kind: 'document', id: doc.id }).then((list) => {
      if (!live) return;
      setMemos(list);
      const first = list[0] ?? null;
      setEditing(first);
      setTitle(first?.title ?? '');
      setBody(first?.body ?? '');
    });
    return () => {
      live = false;
    };
  }, [project, doc.id]);

  const pick = (m: Memo | null) => {
    setEditing(m);
    setTitle(m?.title ?? '');
    setBody(m?.body ?? '');
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onSave(editing, title, body);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={t('documents.memo.title', { name: doc.name })}
      dismissible={!busy}
      data-testid="doc-memo-dialog"
      footer={
        <>
          {editing ? (
            <Button variant="ghost" icon={ExternalLink} onClick={() => onOpenMemos(editing.id)} className="dmemo__open">
              {t('documents.memo.openInMemos')}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" busy={busy} disabled={memos === null || (!title.trim() && !body.trim())} onClick={() => void submit()} data-testid="doc-memo-save">
            {t('common.save')}
          </Button>
        </>
      }
    >
      {memos === null ? (
        <div className="dmemo__loading">
          <Spinner label={t('common.loading')} />
        </div>
      ) : (
        <div className="dmemo">
          {memos.length > 0 ? (
            <div className="dmemo__tabs" role="group" aria-label={tp('common.count.memos', memos.length)}>
              {memos.map((m) => (
                <button key={m.id} type="button" className={cx('dmemo__tab', editing?.id === m.id && 'dmemo__tab--on')} aria-pressed={editing?.id === m.id} onClick={() => pick(m)}>
                  <span className="dmemo__tab-title">{m.title || t('common.untitled')}</span>
                  <span className="dmemo__tab-date">{relative(m.created_at)}</span>
                </button>
              ))}
              <button type="button" className={cx('dmemo__tab', editing === null && 'dmemo__tab--on')} aria-pressed={editing === null} onClick={() => pick(null)} data-testid="doc-memo-new">
                <Plus size={13} aria-hidden />
                <span className="dmemo__tab-title">{t('documents.memo.new')}</span>
              </button>
            </div>
          ) : null}
          <TextField label={t('documents.memo.titleLabel')} value={title} onChange={setTitle} maxLength={200} placeholder={t('documents.memo.titlePlaceholder')} data-testid="doc-memo-title" />
          <TextArea label={t('documents.memo.body')} value={body} onChange={setBody} autoGrow minHeight={160} maxHeight={420} reading data-autofocus data-testid="doc-memo-body" />
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Properties

export interface DocumentChanges {
  name: string;
  kind: DocKind;
  caseId: string | null;
  groupIds: string[];
  color: string | null;
}

export function DocumentPropertiesDialog({
  doc,
  cases,
  groups,
  onClose,
  onSave,
}: {
  doc: Document;
  cases: readonly Case[];
  groups: readonly DocGroup[];
  onClose: () => void;
  onSave: (changes: DocumentChanges) => Promise<void>;
}) {
  const { t, tp, date, meta } = useI18n();
  const project = useProject();
  const [draft, setDraft] = useState<DocumentChanges>({ name: doc.name, kind: doc.kind, caseId: doc.case_id, groupIds: doc.group_ids, color: doc.color });
  const [stats, setStats] = useState<DocumentStats | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void documentStats(project, doc.id)
      .then((s) => live && setStats(s))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [project, doc.id]);
  const nf = new Intl.NumberFormat(meta.bcp47);
  const submit = async () => {
    if (busy || !draft.name.trim()) return;
    setBusy(true);
    try {
      await onSave(draft);
    } finally {
      setBusy(false);
    }
  };
  const sortedCases = useMemo(() => [...cases].sort((a, b) => a.name.localeCompare(b.name, meta.bcp47, { numeric: true })), [cases, meta.bcp47]);
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={t('documents.properties.title')}
      description={doc.name}
      dismissible={!busy}
      onSubmit={() => void submit()}
      data-testid="doc-properties-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!draft.name.trim()} data-testid="doc-properties-save">
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="dprops">
        <div className="dprops__form">
          <TextField label={t('documents.properties.name')} value={draft.name} onChange={(name) => setDraft((d) => ({ ...d, name }))} maxLength={200} data-autofocus data-testid="doc-properties-name" />
          <div className="dprops__row">
            <Select<DocKind>
              label={t('documents.properties.kind')}
              value={draft.kind}
              onChange={(kind) => setDraft((d) => ({ ...d, kind }))}
              options={DOC_KINDS.map((k) => ({ value: k, label: t(`documents.kinds.${k}`) }))}
              data-testid="doc-properties-kind"
            />
            <Select<string>
              label={t('documents.properties.case')}
              value={draft.caseId ?? ''}
              onChange={(v) => setDraft((d) => ({ ...d, caseId: v || null }))}
              options={[{ value: '', label: t('documents.casePicker.none') }, ...sortedCases.map((c) => ({ value: c.id, label: c.name }))]}
              data-testid="doc-properties-case"
            />
          </div>
          {groups.length ? (
            <fieldset className="dprops__groups">
              <legend className="field__label">{t('documents.properties.groups')}</legend>
              {groups.map((g) => (
                <Checkbox
                  key={g.id}
                  checked={draft.groupIds.includes(g.id)}
                  onChange={(on) => setDraft((d) => ({ ...d, groupIds: on ? [...d.groupIds, g.id] : d.groupIds.filter((x) => x !== g.id) }))}
                  label={
                    <span className="dprops__group">
                      <span className="dpicker__dot" style={{ background: g.color }} aria-hidden />
                      {g.name}
                    </span>
                  }
                  data-testid={`doc-properties-group-${g.id}`}
                />
              ))}
            </fieldset>
          ) : null}
          <DocColourChoice label={t('documents.properties.colour')} value={draft.color} onChange={(color) => setDraft((d) => ({ ...d, color }))} data-testid="doc-properties-colour" />
        </div>
        <aside className="dprops__facts" aria-label={t('documents.properties.facts')}>
          <h3 className="dprops__facts-title">{t('documents.properties.facts')}</h3>
          <dl>
            {doc.source?.filename ? (
              <>
                <dt className="dprops__wide">{t('documents.properties.file')}</dt>
                <dd className="dprops__wide dprops__file">{doc.source.filename}</dd>
              </>
            ) : null}
            {doc.source ? (
              <>
                <dt>{t('documents.properties.added')}</dt>
                <dd>{date(DateTime.fromISO(doc.source.imported_at || doc.created_at))}</dd>
              </>
            ) : null}
            <dt>{t('documents.properties.length')}</dt>
            <dd>{stats ? tp('common.count.words', stats.words, { n: nf.format(stats.words) }) : '…'}</dd>
            <dt>{t('documents.properties.paragraphs')}</dt>
            <dd>{stats ? nf.format(stats.paragraphs) : '…'}</dd>
            <dt>{t('documents.properties.codings')}</dt>
            <dd>{stats ? nf.format(stats.codings) : '…'}</dd>
            <dt>{t('documents.properties.coverage')}</dt>
            <dd>{stats ? `${Math.round(stats.coverage * 100)}%` : '…'}</dd>
            {doc.media ? (
              <>
                <dt className="dprops__wide">{t('documents.properties.media')}</dt>
                <dd className="dprops__wide dprops__file">{doc.media.filename}</dd>
              </>
            ) : null}
          </dl>
          {doc.case_id ? (
            <p className="dprops__case">
              <UserRound size={13} aria-hidden /> {cases.find((c) => c.id === doc.case_id)?.name}
            </p>
          ) : null}
        </aside>
      </div>
    </Dialog>
  );
}

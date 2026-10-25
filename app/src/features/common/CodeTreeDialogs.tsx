import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, Folder } from 'lucide-react';
import type { Code } from '../../core/model/types';
import type { CodePatch } from '../../services/codes';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import { Button } from '../../ui/components/Button';
import { RadioGroup } from '../../ui/components/Choice';
import { Dialog } from '../../ui/components/Dialog';
import { SearchField, TextArea, TextField } from '../../ui/components/Field';
import { codeChoices, filterChoices, type CodeChoice, type TreeItem } from './codeTreeModel';
import './CodeTree.css';

// ---------------------------------------------------------------------------------------------
// A searchable list of codes (merge target, merge sources, a new parent)

export interface CodePickListProps {
  choices: readonly CodeChoice[];
  /** Single choice: the chosen id. */
  value?: string | null;
  onChange?: (id: string) => void;
  /** Several: the chosen ids (checkboxes). */
  values?: ReadonlySet<string>;
  onToggle?: (id: string) => void;
  /** Enter on a choice (single mode): choose and confirm. */
  onPick?: (id: string) => void;
  label: string;
  /** Codes that cannot be chosen (shown, greyed). */
  disabledIds?: ReadonlySet<string>;
  /** Right-hand detail per code (a count). */
  aside?: (c: CodeChoice) => React.ReactNode;
  height?: number;
  autoFocus?: boolean;
  'data-testid'?: string;
}

/** Search box over a list of codes in tree order; ↑/↓ in the box move through the list. */
export function CodePickList({ choices, value, onChange, values, onToggle, onPick, label, disabledIds, aside, height = 260, autoFocus, ...rest }: CodePickListProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const listId = useId();
  const shown = useMemo(() => filterChoices(choices, query), [choices, query]);
  const multiple = values !== undefined;
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const filtering = query.trim() !== '';

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (c: CodeChoice | undefined, confirm = false) => {
    if (!c || disabledIds?.has(c.id)) return;
    if (multiple) onToggle?.(c.id);
    else {
      onChange?.(c.id);
      if (confirm) onPick?.(c.id);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = shown.length;
      if (!n) return;
      setActive((a) => (e.key === 'ArrowDown' ? Math.min(n - 1, a + 1) : Math.max(0, a - 1)));
    } else if (e.key === 'Enter' && shown[active]) {
      e.preventDefault();
      choose(shown[active], true);
    }
  };

  const activeId = shown[active] ? `${listId}-${active}` : undefined;
  return (
    <div className="codepick" data-testid={rest['data-testid']}>
      <SearchField
        value={query}
        onChange={setQuery}
        size="sm"
        placeholder={t('codes.pick.search')}
        aria-label={t('codes.pick.search')}
        aria-controls={listId}
        aria-activedescendant={activeId}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        data-autofocus={autoFocus || undefined}
        data-testid="codepick-search"
      />
      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label={label}
        aria-multiselectable={multiple || undefined}
        className="codepick__list"
        style={{ maxHeight: height }}
      >
        {shown.length === 0 ? <p className="codepick__empty">{t('codes.pick.none')}</p> : null}
        {shown.map((c, i) => {
          const selected = multiple ? values!.has(c.id) : value === c.id;
          const disabled = disabledIds?.has(c.id) ?? false;
          return (
            <div
              key={c.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={selected}
              aria-disabled={disabled || undefined}
              data-index={i}
              data-active={i === active || undefined}
              className={cx('codepick__option', selected && 'codepick__option--selected', disabled && 'codepick__option--disabled')}
              style={{ paddingLeft: 8 + (filtering ? 0 : c.depth * 14) }}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                setActive(i);
                choose(c);
              }}
              onDoubleClick={() => choose(c, true)}
              data-testid={`codepick-${c.id}`}
            >
              {multiple ? (
                <span className={cx('codepick__check', selected && 'codepick__check--on')} aria-hidden>
                  {selected ? <Check size={11} strokeWidth={3} /> : null}
                </span>
              ) : null}
              {c.codable ? (
                <span className="codepick__dot" style={{ background: c.color }} aria-hidden />
              ) : (
                <Folder size={14} strokeWidth={1.75} style={{ color: c.color }} aria-hidden className="codepick__folder" />
              )}
              <span className="codepick__name" title={c.path}>
                {filtering && c.depth > 0 ? <span className="codepick__path">{c.path.slice(0, c.path.length - c.name.length)}</span> : null}
                {c.name}
              </span>
              {aside ? <span className="codepick__aside">{aside(c)}</span> : null}
              {!multiple && selected ? <Check size={14} className="codepick__tick" aria-hidden /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Delete

export function DeleteCodeDialog({
  item,
  descendants,
  onCancel,
  onConfirm,
}: {
  item: TreeItem;
  /** How many codes are below it. */
  descendants: number;
  onCancel: () => void;
  onConfirm: (mode: 'delete' | 'lift') => Promise<void>;
}) {
  const { t, tp } = useI18n();
  const [mode, setMode] = useState<'delete' | 'lift'>('lift');
  const [busy, setBusy] = useState(false);
  const hasChildren = descendants > 0;
  const removed = hasChildren && mode === 'delete' ? item.total : item.own;
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm(hasChildren ? mode : 'delete');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onCancel}
      size="sm"
      title={t('codes.delete.title', { name: item.name })}
      dismissible={!busy}
      onSubmit={() => void submit()}
      data-testid="delete-code-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy} data-autofocus data-testid="delete-code-cancel">
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="danger" busy={busy} data-testid="delete-code-confirm">
            {t('codes.delete.confirm')}
          </Button>
        </>
      }
    >
      <div className="codedialog__stack">
        {hasChildren ? (
          <RadioGroup<'delete' | 'lift'>
            label={tp('codes.delete.children', descendants)}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'lift', label: t('codes.delete.lift'), description: t('codes.delete.liftHint') },
              { value: 'delete', label: t('codes.delete.withChildren'), description: tp('codes.delete.withChildrenHint', item.total - item.own) },
            ]}
            data-testid="delete-code-mode"
          />
        ) : null}
        <p className={cx('codedialog__consequence', removed > 0 && 'codedialog__consequence--warn')} data-testid="delete-code-count">
          {removed > 0 ? tp('codes.delete.removes', removed) : t('codes.delete.removesNone')}
        </p>
        <p className="t-muted t-small">{t('codes.delete.undoHint')}</p>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Merge into…

export function MergeIntoDialog({
  source,
  items,
  onCancel,
  onConfirm,
}: {
  source: TreeItem;
  items: readonly TreeItem[];
  onCancel: () => void;
  onConfirm: (targetId: string) => Promise<void>;
}) {
  const { t, tp } = useI18n();
  const choices = useMemo(() => codeChoices(items, [source.id]), [items, source.id]);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const targetName = choices.find((c) => c.id === target)?.name ?? '';
  const submit = async (id = target) => {
    if (!id || busy) return;
    setBusy(true);
    try {
      await onConfirm(id);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onCancel}
      size="md"
      title={t('codes.mergeInto.title', { name: source.name })}
      description={t('codes.mergeInto.description')}
      dismissible={!busy}
      data-testid="merge-into-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!target} busy={busy} onClick={() => void submit()} data-testid="merge-into-confirm">
            {t('codes.mergeInto.confirm')}
          </Button>
        </>
      }
    >
      <div className="codedialog__stack">
        <CodePickList choices={choices} value={target} onChange={setTarget} onPick={(id) => void submit(id)} label={t('codes.mergeInto.target')} autoFocus data-testid="merge-into-list" />
        <p className="codedialog__consequence" aria-live="polite" data-testid="merge-into-preview">
          {target ? tp('codes.mergeInto.preview', source.own, { name: source.name, target: targetName }) : t('codes.mergeInto.choose')}
        </p>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Definition

export function CodeDefinitionDialog({ code, onCancel, onSave }: { code: Code; onCancel: () => void; onSave: (patch: CodePatch) => Promise<void> }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState({ name: code.name, description: code.description, inclusion: code.inclusion, exclusion: code.exclusion, example: code.example });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof draft) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const submit = async () => {
    if (busy || !draft.name.trim()) return;
    setBusy(true);
    try {
      await onSave(draft);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onCancel}
      size="lg"
      title={t('codes.definitionDialog.title')}
      dismissible={!busy}
      data-testid="code-definition-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" busy={busy} disabled={!draft.name.trim()} onClick={() => void submit()} data-testid="code-definition-save">
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="codedialog__stack">
        <TextField label={t('codes.fields.name')} value={draft.name} onChange={set('name')} maxLength={120} data-testid="code-definition-name" />
        <TextArea label={t('codes.fields.description')} hint={t('codes.fields.descriptionHint')} value={draft.description} onChange={set('description')} autoGrow minHeight={72} maxHeight={220} data-autofocus data-testid="code-definition-description" />
        <div className="codedialog__pair">
          <TextArea label={t('codes.fields.inclusion')} value={draft.inclusion} onChange={set('inclusion')} autoGrow minHeight={60} maxHeight={180} data-testid="code-definition-inclusion" />
          <TextArea label={t('codes.fields.exclusion')} value={draft.exclusion} onChange={set('exclusion')} autoGrow minHeight={60} maxHeight={180} data-testid="code-definition-exclusion" />
        </div>
        <TextArea label={t('codes.fields.example')} value={draft.example} onChange={set('example')} autoGrow reading minHeight={60} maxHeight={180} data-testid="code-definition-example" />
      </div>
    </Dialog>
  );
}

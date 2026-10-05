import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { ATTRIBUTE_TYPES, type Attribute, type AttributeType, type Case } from '../../core/model/types';
import { countLostOnTypeChange, createAttribute, deleteAttribute, reorderAttribute, updateAttribute } from '../../services/cases';
import { ServiceError } from '../../services/undo';
import { useProject } from '../../shell/AppState';
import { useUndo } from '../../shell/undo';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import { Button, IconButton } from '../../ui/components/Button';
import { useConfirm } from '../../ui/components/Confirm';
import { Dialog } from '../../ui/components/Dialog';
import { Select, TextArea, TextField } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { parseOptions } from './values';

interface Props {
  attrs: Attribute[];
  cases: Case[];
  onClose: () => void;
}

/** Adding, renaming, retyping, reordering and deleting the attributes cases are described by. */
export function AttributeManager({ attrs, cases, onClose }: Props) {
  const { t, tp } = useI18n();
  const project = useProject();
  const { record } = useUndo();
  const toast = useToast();
  const confirm = useConfirm();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<AttributeType>('text');
  const [addError, setAddError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const typeOptions = ATTRIBUTE_TYPES.map((v) => ({ value: v, label: t(`cases.types.${v}`) }));
  const usage = (a: Attribute) => cases.reduce((n, c) => n + (c.values[a.id] !== undefined && c.values[a.id] !== null ? 1 : 0), 0);

  const add = async () => {
    if (!name.trim()) return setAddError(t('cases.attributes.nameRequired'));
    if (attrs.some((a) => a.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase())) return setAddError(t('cases.attributes.duplicate'));
    try {
      const { attribute, undo } = await createAttribute(project, { name, type });
      record(undo);
      setName('');
      setAddError(null);
      if (type === 'choice') setExpanded(attribute.id);
      nameRef.current?.focus();
    } catch (e) {
      toast.error(e);
    }
  };

  const patch = async (a: Attribute, p: Partial<Pick<Attribute, 'name' | 'type' | 'options' | 'description'>>) => {
    try {
      const { undo, cleared } = await updateAttribute(project, a.id, p);
      record(undo);
      if (cleared) toast.show(tp('cases.attributes.cleared', cleared));
    } catch (e) {
      if (e instanceof ServiceError && e.code === 'invalid_argument') toast.show({ message: t('cases.attributes.nameRequired'), tone: 'danger' });
      else toast.error(e);
    }
  };

  const changeType = async (a: Attribute, next: AttributeType) => {
    if (next === a.type) return;
    let lost: number;
    try {
      lost = await countLostOnTypeChange(project, a.id, next);
    } catch (e) {
      toast.error(e);
      return;
    }
    if (lost > 0) {
      const ok = await confirm({
        title: t('cases.attributes.retypeTitle', { name: a.name, type: t(`cases.types.${next}`) }),
        body: tp('cases.attributes.retypeBody', lost, { type: t(`cases.types.${next}`) }),
        confirmLabel: t('cases.attributes.retypeConfirm'),
        danger: true,
        'data-testid': 'retype-dialog',
      });
      if (!ok) return;
    }
    await patch(a, { type: next });
    if (next === 'choice') setExpanded(a.id);
  };

  const remove = async (a: Attribute) => {
    const n = usage(a);
    const ok = await confirm({
      title: t('cases.attributes.deleteTitle', { name: a.name }),
      body: n ? tp('cases.attributes.deleteBody', n) : t('cases.attributes.deleteUnused'),
      confirmLabel: t('common.delete'),
      danger: true,
      'data-testid': 'delete-attribute-dialog',
    });
    if (!ok) return;
    try {
      const { undo } = await deleteAttribute(project, a.id);
      record(undo);
    } catch (e) {
      toast.error(e);
    }
  };

  const move = async (i: number, dir: -1 | 1) => {
    const a = attrs[i]!;
    // Before the previous one, or before the one after the next (null: to the end).
    const beforeId = dir < 0 ? attrs[i - 1]?.id ?? null : attrs[i + 2]?.id ?? null;
    if (dir < 0 && i === 0) return;
    if (dir > 0 && i === attrs.length - 1) return;
    try {
      record(await reorderAttribute(project, a.id, beforeId));
      // Keep the focus on the same arrow of the moved row.
      setTimeout(() => document.querySelector<HTMLElement>(`[data-testid="attr-${dir < 0 ? 'up' : 'down'}-${a.id}"]:not(:disabled)`)?.focus(), 50);
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={t('cases.attributes.title')}
      description={t('cases.attributes.intro')}
      data-testid="attribute-manager"
      footer={
        <Button variant="primary" onClick={onClose} data-testid="attributes-done">
          {t('common.done')}
        </Button>
      }
    >
      {attrs.length ? (
        <ol className="attrs" aria-label={t('cases.attributes.title')}>
          {attrs.map((a, i) => (
            <AttributeRow
              key={a.id}
              attr={a}
              first={i === 0}
              last={i === attrs.length - 1}
              used={usage(a)}
              expanded={expanded === a.id}
              onToggle={() => setExpanded((x) => (x === a.id ? null : a.id))}
              typeOptions={typeOptions}
              onRename={(n) => void patch(a, { name: n })}
              onType={(ty) => void changeType(a, ty)}
              onOptions={(o) => void patch(a, { options: o })}
              onDescription={(d) => void patch(a, { description: d })}
              onUp={() => void move(i, -1)}
              onDown={() => void move(i, 1)}
              onDelete={() => void remove(a)}
            />
          ))}
        </ol>
      ) : (
        <p className="attrs__none">{t('cases.attributes.none')}</p>
      )}

      <form
        className="attrs__add"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <TextField
          ref={nameRef}
          label={t('cases.attributes.newName')}
          value={name}
          onChange={(v) => {
            setName(v);
            setAddError(null);
          }}
          placeholder={t('cases.attributes.newPlaceholder')}
          error={addError}
          fieldClassName="attrs__add-name"
          data-testid="attr-new-name"
        />
        <Select<AttributeType> label={t('cases.attributes.type')} value={type} onChange={setType} options={typeOptions} fieldClassName="attrs__add-type" data-testid="attr-new-type" />
        <Button type="submit" icon={Plus} className="attrs__add-btn" data-testid="attr-add">
          {t('cases.attributes.add')}
        </Button>
      </form>
    </Dialog>
  );
}

function AttributeRow({
  attr,
  first,
  last,
  used,
  expanded,
  onToggle,
  typeOptions,
  onRename,
  onType,
  onOptions,
  onDescription,
  onUp,
  onDown,
  onDelete,
}: {
  attr: Attribute;
  first: boolean;
  last: boolean;
  used: number;
  expanded: boolean;
  onToggle: () => void;
  typeOptions: { value: AttributeType; label: string }[];
  onRename: (name: string) => void;
  onType: (type: AttributeType) => void;
  onOptions: (options: string[]) => void;
  onDescription: (d: string) => void;
  onUp: () => void;
  onDown: () => void;
  onDelete: () => void;
}) {
  const { t, tp } = useI18n();
  const [name, setName] = useState(attr.name);
  const [options, setOptions] = useState(attr.options.join('\n'));
  const [description, setDescription] = useState(attr.description);
  useEffect(() => setName(attr.name), [attr.name]);
  useEffect(() => setOptions(attr.options.join('\n')), [attr.options]);
  useEffect(() => setDescription(attr.description), [attr.description]);
  const detailsId = `attr-details-${attr.id}`;
  return (
    <li className={cx('attrs__row', expanded && 'attrs__row--open')} data-testid={`attr-row-${attr.id}`}>
      <div className="attrs__line">
        <div className="attrs__move">
          <IconButton icon={ArrowUp} size="sm" label={t('cases.attributes.up', { name: attr.name })} disabled={first} onClick={onUp} data-testid={`attr-up-${attr.id}`} />
          <IconButton icon={ArrowDown} size="sm" label={t('cases.attributes.down', { name: attr.name })} disabled={last} onClick={onDown} data-testid={`attr-down-${attr.id}`} />
        </div>
        <TextField
          aria-label={t('common.name')}
          value={name}
          onChange={setName}
          size="sm"
          fieldClassName="attrs__name"
          onBlur={() => name.trim() && name !== attr.name && onRename(name)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape' && name !== attr.name) {
              e.stopPropagation();
              setName(attr.name);
            }
          }}
          data-testid={`attr-name-${attr.id}`}
        />
        <Select<AttributeType> aria-label={t('cases.attributes.type')} value={attr.type} onChange={onType} options={typeOptions} size="sm" fieldClassName="attrs__type" data-testid={`attr-type-${attr.id}`} />
        <span className="attrs__used">{tp('cases.attributes.used', used)}</span>
        <Button
          size="sm"
          variant="ghost"
          icon={expanded ? ChevronDown : ChevronRight}
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={onToggle}
          className="attrs__more"
          data-testid={`attr-more-${attr.id}`}
        >
          {attr.type === 'choice' ? tp('cases.attributes.optionsN', attr.options.length) : t('cases.attributes.details')}
        </Button>
        <IconButton icon={Trash2} size="sm" variant="ghost" label={t('cases.attributes.delete', { name: attr.name })} onClick={onDelete} data-testid={`attr-delete-${attr.id}`} />
      </div>
      {expanded ? (
        <div className="attrs__details" id={detailsId}>
          {attr.type === 'choice' ? (
            <TextArea
              label={t('cases.attributes.options')}
              hint={t('cases.attributes.optionsHint')}
              value={options}
              onChange={setOptions}
              rows={Math.min(8, Math.max(3, attr.options.length + 1))}
              onBlur={() => {
                const next = parseOptions(options);
                if (next.join('\n') !== attr.options.join('\n')) onOptions(next);
              }}
              data-testid={`attr-options-${attr.id}`}
            />
          ) : null}
          <TextField
            label={t('common.description')}
            optional={t('common.optional')}
            value={description}
            onChange={setDescription}
            size="sm"
            placeholder={t('cases.attributes.descriptionPlaceholder')}
            onBlur={() => description !== attr.description && onDescription(description)}
            data-testid={`attr-description-${attr.id}`}
          />
        </div>
      ) : null}
    </li>
  );
}

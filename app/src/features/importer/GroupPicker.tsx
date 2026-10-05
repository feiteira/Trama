import React, { useRef, useState } from 'react';
import { FolderPlus, Plus, X } from 'lucide-react';
import type { DocGroup } from '../../core/model/types';
import { PALETTE } from '../../core/model/types';
import { useI18n } from '../../ui/i18n';
import { Button } from '../../ui/components/Button';
import { Checkbox } from '../../ui/components/Choice';
import { TextField } from '../../ui/components/Field';
import { Popover } from '../../ui/components/Popover';
import { type GroupRef, nameKey, sameGroup, toggleGroup } from './model';

/** The document groups an incoming document joins: existing ones, or new ones by name. */
export function GroupPicker({ value, groups, onChange }: { value: GroupRef[]; groups: readonly DocGroup[]; onChange: (v: GroupRef[]) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const anchor = useRef<HTMLButtonElement>(null);
  const byId = new Map(groups.map((g) => [g.id, g]));
  const pending = value.filter((g): g is { name: string } => 'name' in g);

  const addNew = () => {
    const n = name.replace(/\s+/g, ' ').trim();
    if (!n) return;
    const existing = groups.find((g) => nameKey(g.name) === nameKey(n));
    const ref: GroupRef = existing ? { id: existing.id } : { name: n };
    if (!value.some((v) => sameGroup(v, ref))) onChange([...value, ref]);
    setName('');
  };

  return (
    <div className="imp-groups">
      <span className="imp-label" id="imp-groups-label">
        {t('importer.detail.groups')}
      </span>
      <div className="imp-groups__chips" role="group" aria-labelledby="imp-groups-label">
        {value.length === 0 ? <span className="imp-groups__none">{t('importer.detail.groupsNone')}</span> : null}
        {value.map((ref) => {
          const g = 'id' in ref ? byId.get(ref.id) : null;
          const label = g ? g.name : 'name' in ref ? ref.name : '';
          if (!label) return null;
          const color = g?.color ?? PALETTE[(groups.length + pending.findIndex((x) => 'name' in ref && x.name === ref.name)) % PALETTE.length];
          return (
            <span key={'id' in ref ? ref.id : `new:${label}`} className="imp-chip" data-testid="import-group-chip">
              <span className="imp-chip__dot" style={{ background: color }} aria-hidden />
              {label}
              {'name' in ref ? <span className="imp-chip__new">{t('importer.detail.newBadge')}</span> : null}
              <button type="button" className="imp-chip__remove" aria-label={t('importer.detail.removeGroup', { name: label })} onClick={() => onChange(value.filter((v) => !sameGroup(v, ref)))}>
                <X size={12} aria-hidden />
              </button>
            </span>
          );
        })}
        <Button ref={anchor} variant="ghost" size="sm" icon={Plus} onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} data-testid="import-group-add">
          {t('importer.detail.addGroup')}
        </Button>
      </div>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} padded aria-label={t('importer.detail.addGroup')} className="imp-groups__pop">
        {groups.length ? (
          <div className="imp-groups__list">
            {groups.map((g) => (
              <Checkbox
                key={g.id}
                checked={value.some((v) => 'id' in v && v.id === g.id)}
                onChange={() => onChange(toggleGroup(value, { id: g.id }))}
                label={
                  <span className="imp-groups__option">
                    <span className="imp-chip__dot" style={{ background: g.color }} aria-hidden />
                    {g.name}
                  </span>
                }
                data-testid="import-group-option"
              />
            ))}
            {pending.map((p, i) => (
              <Checkbox
                key={`new:${p.name}`}
                checked
                onChange={() => onChange(toggleGroup(value, p))}
                label={
                  <span className="imp-groups__option">
                    <span className="imp-chip__dot" style={{ background: PALETTE[(groups.length + i) % PALETTE.length] }} aria-hidden />
                    {p.name}
                    <span className="imp-chip__new">{t('importer.detail.newBadge')}</span>
                  </span>
                }
              />
            ))}
          </div>
        ) : null}
        <form
          className="imp-groups__new"
          onSubmit={(e) => {
            e.preventDefault();
            addNew();
          }}
        >
          <TextField
            value={name}
            onChange={setName}
            size="sm"
            placeholder={t('importer.detail.newGroup')}
            aria-label={t('importer.detail.newGroupName')}
            leading={<FolderPlus size={14} aria-hidden />}
            data-testid="import-group-new"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={!name.trim()}>
            {t('importer.detail.newGroupAdd')}
          </Button>
        </form>
      </Popover>
    </div>
  );
}

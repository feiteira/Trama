import React, { useMemo, useRef, useState } from 'react';
import { ChevronRight, Ellipsis, Palette, Pencil, Plus, Trash2 } from 'lucide-react';
import type { DocGroup } from '../../../core/model/types';
import * as groupsService from '../../../services/groups';
import { useProject } from '../../../shell/AppState';
import { useUndo } from '../../../shell/undo';
import { cx } from '../../../ui/cx';
import { useI18n } from '../../../ui/i18n';
import { pointRect, type Rect } from '../../../ui/position';
import { IconButton } from '../../../ui/components/Button';
import { ColorPicker } from '../../../ui/components/ColorPicker';
import { useConfirm } from '../../../ui/components/Confirm';
import { Menu, type MenuEntry } from '../../../ui/components/Menu';
import { Popover } from '../../../ui/components/Popover';
import { useFail, useUndoToast } from '../../common/CodeTreeActions';
import { DOCS_MIME, type DocItem } from './documentList';
import './panels.css';

/**
 * The document groups at the foot of the documents panel: create, rename, recolour, delete;
 * a click shows only that group's documents; documents dragged onto a group join it.
 */
export function DocumentGroups({
  groups,
  items,
  open,
  onOpenChange,
  filterId,
  onFilter,
  onDropDocs,
  onDeleted,
}: {
  groups: readonly DocGroup[];
  items: readonly DocItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filterId: string | null;
  onFilter: (id: string) => void;
  onDropDocs: (groupId: string, docIds: string[]) => void;
  onDeleted: (id: string) => void;
}) {
  const { t, tp } = useI18n();
  const project = useProject();
  const { record } = useUndo();
  const confirm = useConfirm();
  const undoToast = useUndoToast();
  const fail = useFail();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [menu, setMenu] = useState<{ id: string; at: Rect } | null>(null);
  const [colour, setColour] = useState<{ id: string; at: Rect } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of items) for (const g of d.groupIds) m.set(g, (m.get(g) ?? 0) + 1);
    return m;
  }, [items]);

  const create = async (name: string) => {
    setEditing(null);
    if (!name.trim()) return;
    try {
      record((await groupsService.createGroup(project, { name })).undo);
    } catch (e) {
      fail(e);
    }
  };
  const rename = async (id: string, name: string) => {
    setEditing(null);
    const g = groups.find((x) => x.id === id);
    if (!g || !name.trim() || name.trim() === g.name) return;
    try {
      record((await groupsService.renameGroup(project, id, name)).undo);
    } catch (e) {
      fail(e);
    }
  };
  const recolour = async (id: string, color: string) => {
    try {
      record((await groupsService.recolourGroup(project, id, color)).undo);
    } catch (e) {
      fail(e);
    }
  };
  const remove = async (g: DocGroup) => {
    const n = counts.get(g.id) ?? 0;
    const ok = await confirm({
      title: t('documents.groups.deleteTitle', { name: g.name }),
      body: n ? tp('documents.groups.deleteBody', n) : t('documents.groups.deleteEmpty'),
      confirmLabel: t('documents.groups.deleteConfirm'),
      danger: true,
      'data-testid': 'delete-group-dialog',
    });
    if (!ok) return;
    try {
      const res = await groupsService.deleteGroup(project, g.id);
      onDeleted(g.id);
      undoToast(t('documents.groups.deleted', { name: g.name }), res.undo);
    } catch (e) {
      fail(e);
    }
  };

  const items_ = (id: string, at: Rect): MenuEntry[] => {
    const g = groups.find((x) => x.id === id);
    if (!g) return [];
    return [
      { id: 'rename', label: t('documents.groups.rename'), icon: Pencil, onSelect: () => setEditing(id), testId: 'group-menu-rename' },
      { id: 'colour', label: t('documents.groups.colour'), icon: Palette, onSelect: () => setColour({ id, at }), testId: 'group-menu-colour' },
      { kind: 'separator' },
      { id: 'delete', label: t('documents.groups.delete'), icon: Trash2, danger: true, onSelect: () => void remove(g), testId: 'group-menu-delete' },
    ];
  };

  const colourGroup = colour ? groups.find((g) => g.id === colour.id) : undefined;

  return (
    <div className={cx('dgroups', open && 'dgroups--open')} data-testid="doc-groups">
      <div className="dgroups__head">
        <button type="button" className="dgroups__toggle" aria-expanded={open} onClick={() => onOpenChange(!open)} data-testid="doc-groups-toggle">
          <ChevronRight size={13} className={cx('dpanel__section-chevron', open && 'dpanel__section-chevron--open')} aria-hidden />
          <span>{t('documents.groups.title')}</span>
          <span className="dpanel__section-count">{groups.length}</span>
        </button>
        <IconButton
          icon={Plus}
          label={t('documents.groups.new')}
          size="sm"
          onClick={() => {
            onOpenChange(true);
            setEditing('new');
          }}
          data-testid="doc-groups-new"
        />
      </div>
      {open ? (
        <ul className="dgroups__list" aria-label={t('documents.groups.title')}>
          {groups.map((g) => (
            <li
              key={g.id}
              className={cx('dgroup', filterId === g.id && 'dgroup--on', dropOn === g.id && 'dgroup--drop')}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DOCS_MIME)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                if (dropOn !== g.id) setDropOn(g.id);
              }}
              onDragLeave={() => setDropOn((cur) => (cur === g.id ? null : cur))}
              onDrop={(e) => {
                setDropOn(null);
                const raw = e.dataTransfer.getData(DOCS_MIME);
                if (!raw) return;
                e.preventDefault();
                try {
                  const ids = JSON.parse(raw) as unknown;
                  if (Array.isArray(ids)) onDropDocs(g.id, ids.filter((x): x is string => typeof x === 'string'));
                } catch {
                  // Not ours.
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ id: g.id, at: pointRect(e.clientX, e.clientY) });
              }}
              data-testid={`group-${g.id}`}
            >
              {editing === g.id ? (
                <InlineName initial={g.name} label={t('documents.groups.name')} onDone={(n) => void rename(g.id, n)} onCancel={() => setEditing(null)} />
              ) : (
                <button
                  type="button"
                  className="dgroup__main"
                  aria-pressed={filterId === g.id}
                  onClick={() => onFilter(g.id)}
                  onDoubleClick={() => setEditing(g.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'F2') {
                      e.preventDefault();
                      setEditing(g.id);
                    } else if (e.key === 'Delete') {
                      e.preventDefault();
                      void remove(g);
                    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
                      e.preventDefault();
                      const r = e.currentTarget.getBoundingClientRect();
                      setMenu({ id: g.id, at: { top: r.top, left: r.left + 24, width: 0, height: r.height } });
                    }
                  }}
                  title={t('documents.groups.filterHint')}
                  data-testid="group-filter"
                >
                  <span className="dpicker__dot" style={{ background: g.color }} aria-hidden />
                  <span className="dgroup__name">{g.name}</span>
                  <span className="dgroup__count">{counts.get(g.id) ?? 0}</span>
                </button>
              )}
              <button
                type="button"
                className="drow__more dgroup__more"
                tabIndex={-1}
                aria-label={t('documents.groups.actions', { name: g.name })}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setMenu({ id: g.id, at: { top: r.top, left: r.left, width: r.width, height: r.height } });
                }}
                data-testid="group-more"
              >
                <Ellipsis size={14} aria-hidden />
              </button>
            </li>
          ))}
          {editing === 'new' ? (
            <li className="dgroup">
              <InlineName initial="" placeholder={t('documents.groups.namePlaceholder')} label={t('documents.groups.name')} onDone={(n) => void create(n)} onCancel={() => setEditing(null)} />
            </li>
          ) : null}
          {!groups.length && editing !== 'new' ? <li className="dgroups__empty">{t('documents.groups.empty')}</li> : null}
        </ul>
      ) : null}
      <Menu open={menu !== null} onClose={() => setMenu(null)} anchor={menu?.at ?? null} items={menu ? items_(menu.id, menu.at) : []} label={t('documents.groups.title')} data-testid="group-menu" />
      <Popover open={colourGroup !== undefined} onClose={() => setColour(null)} anchor={colour?.at ?? null} padded aria-label={t('documents.groups.colour')}>
        {colourGroup ? <ColorPicker label={t('documents.groups.colourOf', { name: colourGroup.name })} value={colourGroup.color} onChange={(c) => void recolour(colourGroup.id, c)} data-testid="group-colour" /> : null}
      </Popover>
    </div>
  );
}

function InlineName({ initial, label, placeholder, onDone, onCancel }: { initial: string; label: string; placeholder?: string; onDone: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (ok: boolean) => {
    if (done.current) return;
    done.current = true;
    if (ok && value.trim()) onDone(value);
    else onCancel();
  };
  return (
    <input
      autoFocus
      className="drow__rename dgroup__input"
      value={value}
      placeholder={placeholder}
      maxLength={200}
      aria-label={label}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
      data-testid="group-name-input"
    />
  );
}

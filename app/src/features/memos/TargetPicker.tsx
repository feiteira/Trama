import React, { useMemo, useState } from 'react';
import { fold } from '../../core/text/normalize';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import { Dialog } from '../../ui/components/Dialog';
import { SearchField } from '../../ui/components/Field';

export type PickKind = 'document' | 'code' | 'case';

export interface PickItem {
  id: string;
  label: string;
  color: string | null;
  depth?: number;
}

/** Chooses the document, code or case a new memo is about. Type to narrow, arrows and Enter to pick. */
export function TargetPicker({ kind, items, onPick, onClose }: { kind: PickKind; items: readonly PickItem[]; onPick: (id: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const shown = useMemo(() => {
    const words = fold(query).split(' ').filter(Boolean);
    return words.length ? items.filter((i) => words.every((w) => fold(i.label).includes(w))) : items;
  }, [items, query]);
  const current = shown[Math.min(active, shown.length - 1)];

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.max(0, Math.min(shown.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
      setActive(next);
      document.getElementById(`pick-${shown[next]?.id}`)?.scrollIntoView({ block: 'nearest' });
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(`memos.pick.title.${kind}`)}
      size="sm"
      onSubmit={() => current && onPick(current.id)}
      data-testid="memo-target-picker"
    >
      <div className="pick" onKeyDown={onKeyDown}>
        <SearchField
          value={query}
          onChange={(q) => {
            setQuery(q);
            setActive(0);
          }}
          placeholder={t('memos.pick.search')}
          aria-label={t('memos.pick.search')}
          aria-controls="pick-list"
          aria-activedescendant={current ? `pick-${current.id}` : undefined}
          data-autofocus
          data-testid="memo-target-search"
        />
        {shown.length ? (
          <div id="pick-list" role="listbox" aria-label={t(`memos.pick.title.${kind}`)} className="pick__list">
            {shown.map((i, n) => (
              <div
                key={i.id}
                id={`pick-${i.id}`}
                role="option"
                aria-selected={current?.id === i.id}
                className={cx('pick__row', current?.id === i.id && 'pick__row--active')}
                style={{ paddingLeft: 10 + (query ? 0 : (i.depth ?? 0) * 14) }}
                onPointerMove={() => setActive(n)}
                onClick={() => onPick(i.id)}
                data-testid="memo-target-option"
              >
                {i.color ? <span className="pick__dot" style={{ background: i.color }} aria-hidden /> : <span className="pick__dot pick__dot--none" aria-hidden />}
                <span className="pick__label">{i.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="pick__none">{query ? t('memos.pick.noMatch', { q: query.trim() }) : t('memos.pick.empty')}</p>
        )}
      </div>
    </Dialog>
  );
}

import React, { forwardRef, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import { type CodeOption, exactCode, searchCodes } from './model/codeSearch';

// Find a code by typing: a search box over a list of matching codes. ↑/↓ move, Enter picks the
// highlighted code — or creates one with the typed name when nothing matches it exactly.

export interface CodePickerProps {
  options: readonly CodeOption[];
  query: string;
  onQuery: (q: string) => void;
  onPick: (codeId: string) => void;
  /** Offers "Create code “…”" for a name no code has. */
  onCreate?: (name: string) => void;
  /** Where a created code goes, shown in the create row ("under Feelings"). */
  createHint?: string;
  placeholder: string;
  /** Shown instead of the list while nothing is typed (recent and favourite codes). */
  idle?: ReactNode;
  /** List every code while nothing is typed (when there is no `idle`). */
  listWhenEmpty?: boolean;
  exclude?: string;
  testId?: string;
}

export const CodePicker = forwardRef<HTMLInputElement, CodePickerProps>(function CodePicker(
  { options, query, onQuery, onPick, onCreate, createHint, placeholder, idle, listWhenEmpty, exclude, testId = 'code-picker' },
  ref,
) {
  const { t } = useI18n();
  const listId = useId();
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const typed = query.trim();
  const results = useMemo(
    () => (typed || listWhenEmpty ? searchCodes(options, typed, 60).filter((o) => o.id !== exclude) : []),
    [options, typed, listWhenEmpty, exclude],
  );
  const canCreate = !!onCreate && typed.length > 0 && !exactCode(options, typed);
  const rows = results.length + (canCreate ? 1 : 0);

  useEffect(() => setActive(0), [typed]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (i: number) => {
    const o = results[i];
    if (o) onPick(o.id);
    else if (canCreate && i === results.length) onCreate!(typed);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && rows) {
      e.preventDefault();
      setActive((a) => (a + 1) % rows);
    } else if (e.key === 'ArrowUp' && rows) {
      e.preventDefault();
      setActive((a) => (a - 1 + rows) % rows);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rows) choose(Math.min(active, rows - 1));
    }
  };

  const showList = typed.length > 0 || (!idle && listWhenEmpty);
  return (
    <div className="wb-picker" data-testid={testId}>
      <div className="wb-picker__search">
        <input
          ref={ref}
          className="wb-picker__input"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={placeholder}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && rows ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          data-testid={`${testId}-input`}
        />
      </div>
      {showList ? (
        <div ref={list} className="wb-picker__list" role="listbox" id={listId} aria-label={placeholder}>
          {results.map((o, i) => (
            <div
              key={o.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              data-row={i}
              className={cx('wb-picker__row', i === active && 'is-active')}
              onPointerMove={() => i !== active && setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
              data-testid={`${testId}-option`}
            >
              <span className="wb-dot" style={{ background: o.color }} aria-hidden />
              <span className="wb-picker__name">{o.name}</span>
              {o.path.length ? <span className="wb-picker__path">{o.path.join(' › ')}</span> : null}
              {o.shortcut ? <kbd className="wb-picker__key">{o.shortcut}</kbd> : null}
            </div>
          ))}
          {canCreate ? (
            <div
              id={`${listId}-${results.length}`}
              role="option"
              aria-selected={active === results.length}
              data-row={results.length}
              className={cx('wb-picker__row wb-picker__row--create', active === results.length && 'is-active')}
              onPointerMove={() => active !== results.length && setActive(results.length)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(results.length)}
              data-testid={`${testId}-create`}
            >
              <Plus size={14} aria-hidden strokeWidth={2} className="wb-picker__plus" />
              <span className="wb-picker__name">{t('workbench.picker.create', { name: typed })}</span>
              {createHint ? <span className="wb-picker__path">{createHint}</span> : null}
            </div>
          ) : null}
          {!rows ? <div className="wb-picker__empty">{t('workbench.picker.none')}</div> : null}
        </div>
      ) : (
        idle ?? null
      )}
    </div>
  );
});

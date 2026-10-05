import React, { forwardRef, useMemo } from 'react';
import { MessageSquarePlus, Quote } from 'lucide-react';
import { useI18n } from '../../ui/i18n';
import { CodePicker } from './CodePicker';
import { type CodeOption, favourites, recentCodes } from './model/codeSearch';

// What shows next to selected text: find (or create) a code and apply it, favourites on 1–9,
// recently used codes, an in-vivo code from the words themselves, and a memo on the passage.

export interface SelectionPopoverProps {
  options: readonly CodeOption[];
  recent: readonly string[];
  excerpt: string;
  chars: number;
  query: string;
  onQuery: (q: string) => void;
  onApply: (codeId: string) => void;
  onCreate: (name: string) => void;
  createHint?: string;
  onInVivo: () => void;
  onMemo: () => void;
  inVivoKey: string;
}

export const SelectionPopover = forwardRef<HTMLInputElement, SelectionPopoverProps>(function SelectionPopover(
  { options, recent, excerpt, chars, query, onQuery, onApply, onCreate, createHint, onInVivo, onMemo, inVivoKey },
  ref,
) {
  const { t, tp } = useI18n();
  const favs = useMemo(() => favourites(options), [options]);
  const recents = useMemo(() => recentCodes(options, recent, 5), [options, recent]);

  const idle = (
    <div className="wb-selpop__idle">
      {favs.length ? (
        <div className="wb-selpop__group">
          <div className="wb-selpop__heading">{t('workbench.select.favourites')}</div>
          <div className="wb-selpop__favs">
            {favs.map((o) => (
              <button
                key={o.id}
                type="button"
                className="wb-fav"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onApply(o.id)}
                title={t('workbench.select.applyNamed', { name: o.name })}
                data-testid={`fav-${o.shortcut}`}
              >
                <kbd className="wb-fav__key">{o.shortcut}</kbd>
                <span className="wb-dot" style={{ background: o.color }} aria-hidden />
                <span className="wb-fav__name">{o.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {recents.length ? (
        <div className="wb-selpop__group">
          <div className="wb-selpop__heading">{t('workbench.select.recent')}</div>
          <div className="wb-selpop__recent">
            {recents.map((o) => (
              <button
                key={o.id}
                type="button"
                className="wb-picker__row wb-picker__row--button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onApply(o.id)}
                data-testid="recent-code"
              >
                <span className="wb-dot" style={{ background: o.color }} aria-hidden />
                <span className="wb-picker__name">{o.name}</span>
                {o.path.length ? <span className="wb-picker__path">{o.path.join(' › ')}</span> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {!favs.length && !recents.length ? <p className="wb-selpop__hint">{t('workbench.select.hint')}</p> : null}
    </div>
  );

  return (
    <div className="wb-selpop" data-testid="selection-popover">
      <div className="wb-selpop__quote" aria-hidden>
        <span className="wb-selpop__excerpt">{excerpt}</span>
        <span className="wb-selpop__chars">{tp('workbench.select.chars', chars)}</span>
      </div>
      <CodePicker
        ref={ref}
        options={options}
        query={query}
        onQuery={onQuery}
        onPick={onApply}
        onCreate={onCreate}
        createHint={createHint}
        placeholder={t('workbench.select.search')}
        idle={idle}
        testId="select-picker"
      />
      <div className="wb-selpop__actions">
        <button type="button" className="wb-selpop__action" onMouseDown={(e) => e.preventDefault()} onClick={onInVivo} data-testid="in-vivo">
          <Quote size={14} aria-hidden strokeWidth={1.75} />
          <span>{t('workbench.select.inVivo')}</span>
          <kbd className="wb-selpop__kbd">{inVivoKey}</kbd>
        </button>
        <button type="button" className="wb-selpop__action" onMouseDown={(e) => e.preventDefault()} onClick={onMemo} data-testid="memo-passage">
          <MessageSquarePlus size={14} aria-hidden strokeWidth={1.75} />
          <span>{t('workbench.select.memo')}</span>
        </button>
      </div>
    </div>
  );
});

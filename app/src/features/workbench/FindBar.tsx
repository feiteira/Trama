import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Highlighter, Search, X } from 'lucide-react';
import { Button, IconButton } from '../../ui/components/Button';
import { Popover } from '../../ui/components/Popover';
import { useI18n } from '../../ui/i18n';
import { CodePicker } from './CodePicker';
import type { CodeOption } from './model/codeSearch';

// Find in document: a slim bar over the text. Enter / Shift+Enter step through the matches,
// Escape closes; "Code all matches with…" applies one code to every match at once.

export interface FindBarProps {
  query: string;
  onQuery: (q: string) => void;
  count: number;
  index: number;
  onStep: (delta: number) => void;
  onClose: () => void;
  options: readonly CodeOption[];
  onCodeAll: (codeId: string) => void;
  focusKey: number;
  shortcut: string;
}

export function FindBar({ query, onQuery, count, index, onStep, onClose, options, onCodeAll, focusKey, shortcut }: FindBarProps) {
  const { t, tp } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const codeAllRef = useRef<HTMLButtonElement>(null);
  const [picking, setPicking] = useState(false);
  const [pickQuery, setPickQuery] = useState('');

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusKey]);

  return (
    <div className="wb-find" role="search" data-testid="find-bar">
      <div className="wb-find__field">
        <Search size={14} aria-hidden strokeWidth={1.75} className="wb-find__icon" />
        <input
          ref={input}
          className="wb-find__input"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t('workbench.find.placeholder')}
          aria-label={t('workbench.find.label')}
          title={shortcut}
          spellCheck={false}
          autoComplete="off"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onStep(e.shiftKey ? -1 : 1);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
          data-testid="find-input"
        />
        <span className="wb-find__count" aria-live="polite" data-testid="find-count">
          {query.trim() ? (count ? t('workbench.find.position', { i: index + 1, n: count }) : t('workbench.find.none')) : ''}
        </span>
      </div>
      <IconButton size="sm" icon={ChevronUp} label={t('workbench.find.prev')} shortcut="Shift+Enter" disabled={!count} onClick={() => onStep(-1)} data-testid="find-prev" />
      <IconButton size="sm" icon={ChevronDown} label={t('workbench.find.next')} shortcut="Enter" disabled={!count} onClick={() => onStep(1)} data-testid="find-next" />
      <Button ref={codeAllRef} size="sm" variant="ghost" icon={Highlighter} disabled={!count} onClick={() => setPicking((p) => !p)} aria-haspopup="dialog" aria-expanded={picking} data-testid="find-code-all">
        {tp('workbench.find.codeAll', count)}
      </Button>
      <IconButton size="sm" icon={X} label={t('workbench.find.close')} shortcut="Esc" onClick={onClose} data-testid="find-close" />
      <Popover open={picking} onClose={() => setPicking(false)} anchor={codeAllRef} align="end" aria-label={t('workbench.find.codeAllTitle')} className="wb-pop wb-pop--picker">
        <div className="wb-pop__title">{tp('workbench.find.codeAllTitleN', count)}</div>
        <CodePicker
          options={options}
          query={pickQuery}
          onQuery={setPickQuery}
          onPick={(id) => {
            setPicking(false);
            setPickQuery('');
            onCodeAll(id);
          }}
          placeholder={t('workbench.select.search')}
          listWhenEmpty
          testId="find-picker"
        />
      </Popover>
    </div>
  );
}

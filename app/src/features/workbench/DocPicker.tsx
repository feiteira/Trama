import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import type { Document } from '../../core/model/types';
import { fold } from '../../core/text/normalize';
import { Dialog } from '../../ui/components/Dialog';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';

// "Go to document…" from the command palette: type part of a name, Enter opens it.

export function DocPicker({ open, docs, onPick, onClose }: { open: boolean; docs: readonly Document[]; onPick: (id: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    const q = fold(query);
    return q ? docs.filter((d) => fold(d.name).includes(q)) : docs;
  }, [docs, query]);
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const choose = (i: number) => {
    const d = shown[i];
    if (d) {
      onClose();
      onPick(d.id);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={t('workbench.goto.title')} size="sm" data-testid="doc-picker">
      <input
        className="wb-goto__input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('workbench.goto.placeholder')}
        aria-label={t('workbench.goto.placeholder')}
        data-autofocus
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(shown.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(active);
          }
        }}
        data-testid="doc-picker-input"
      />
      <div ref={list} className="wb-goto__list" role="listbox" aria-label={t('workbench.goto.title')}>
        {shown.map((d, i) => (
          <div
            key={d.id}
            role="option"
            aria-selected={i === active}
            data-row={i}
            className={cx('wb-goto__row', i === active && 'is-active')}
            onPointerMove={() => i !== active && setActive(i)}
            onClick={() => choose(i)}
          >
            <FileText size={15} aria-hidden strokeWidth={1.75} />
            <span className="wb-goto__name">{d.name}</span>
            <span className="wb-goto__kind">{t(`workbench.kind.${d.kind}`)}</span>
          </div>
        ))}
        {!shown.length ? <div className="wb-goto__empty">{t('workbench.goto.none')}</div> : null}
      </div>
    </Dialog>
  );
}

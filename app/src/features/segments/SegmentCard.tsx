import React, { memo, useMemo } from 'react';
import { MessageSquareText, NotebookPen } from 'lucide-react';
import type { Code, Coder, Coding } from '../../core/model/types';
import { withAlpha } from '../../ui/color';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import { matchSpans, type ShownText, splitBySpans } from './view';

export interface SegmentCardProps {
  coding: Coding;
  index: number;
  setSize: number;
  code: Code | undefined;
  /** Parent codes' names, root first, shown before the code's own name. */
  codeParents: string[];
  documentName: string;
  paragraph: number | null;
  coder: Coder | undefined;
  shown: ShownText;
  /** "Text contains" words to mark in the coded text. */
  query: string;
  /** Codes this segment overlaps with (co-location mode). */
  related: readonly Code[];
  selected: boolean;
  /** The card that takes the Tab stop of the list. */
  current: boolean;
  memoId: string | undefined;
  onOpen: (c: Coding) => void;
  onToggle: (c: Coding, index: number, range: boolean) => void;
  onMemo: (memoId: string) => void;
  onFocusCard: (index: number) => void;
}

const GREY = '#7a7f87';

/** One coded segment: its code, where it is and who coded it, then the text in Literata. */
export const SegmentCard = memo(function SegmentCard(p: SegmentCardProps) {
  const { t } = useI18n();
  const color = p.code?.color ?? GREY;
  const titleId = `seg-${p.coding.id}-title`;
  const hasContext = !!(p.shown.before || p.shown.after || p.shown.cutBefore || p.shown.cutAfter);
  const coded = useMemo(() => {
    const spans = p.query.trim() ? matchSpans(p.shown.coded, p.query) : [];
    if (!spans.length) return p.shown.coded;
    return splitBySpans(p.shown.coded, spans).map((piece, i) => (piece.hit ? <mark key={i} className="seg-card__hit">{piece.text}</mark> : <React.Fragment key={i}>{piece.text}</React.Fragment>));
  }, [p.shown.coded, p.query]);

  const onClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, input, label')) return;
    // A drag that selected text to copy is not a click on the card.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode)) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      p.onToggle(p.coding, p.index, e.shiftKey);
      return;
    }
    p.onOpen(p.coding);
  };

  return (
    <article
      className={cx('seg-card', p.selected && 'seg-card--selected')}
      style={{ '--code': color, '--code-soft': withAlpha(color, 0.22), '--code-faint': withAlpha(color, 0.1) } as React.CSSProperties}
      tabIndex={p.current ? 0 : -1}
      aria-posinset={p.index + 1}
      aria-setsize={p.setSize}
      aria-labelledby={titleId}
      data-index={p.index}
      data-testid="segment-card"
      data-coding={p.coding.id}
      onClick={onClick}
      onFocus={(e) => {
        if (e.target === e.currentTarget) p.onFocusCard(p.index);
      }}
    >
      <div className="seg-card__head">
        <input
          type="checkbox"
          className="seg-card__check"
          checked={p.selected}
          tabIndex={-1}
          aria-label={t('segments.card.select')}
          onChange={() => undefined}
          onClick={(e) => {
            e.stopPropagation();
            p.onToggle(p.coding, p.index, e.shiftKey);
          }}
          data-testid="segment-select"
        />
        <span className="seg-card__codes">
          <span className="seg-code" title={[...p.codeParents, p.code?.name ?? '?'].join(' / ')}>
            <span className="seg-code__dot" aria-hidden />
            {p.codeParents.length ? (
              <>
                <span className="seg-code__path">{p.codeParents[p.codeParents.length - 1]}</span>
                <span className="seg-code__sep" aria-hidden>/</span>
              </>
            ) : null}
            <span className="seg-code__name">{p.code?.name ?? '?'}</span>
          </span>
          {p.related.length ? (
            <span className="seg-card__related">
              <span className="seg-card__with">{t('segments.card.relatesTo')}</span>
              {p.related.map((c) => (
                <span key={c.id} className="seg-code seg-code--outline" style={{ '--code': c.color } as React.CSSProperties}>
                  <span className="seg-code__dot" aria-hidden />
                  <span className="seg-code__name">{c.name}</span>
                </span>
              ))}
            </span>
          ) : null}
        </span>
        <span className="seg-card__meta" id={titleId}>
          <span className="seg-card__doc">{p.documentName}</span>
          {p.paragraph !== null ? (
            <span className="seg-card__para" title={t('segments.card.position', { n: p.paragraph })}>
              {t('segments.card.paragraph', { n: p.paragraph })}
            </span>
          ) : null}
          {p.coder ? (
            <span className="seg-card__coder">
              <span className="seg-card__coder-dot" style={{ background: p.coder.color }} aria-hidden />
              {p.coder.name}
            </span>
          ) : null}
        </span>
        {p.memoId ? (
          <button
            type="button"
            className="seg-card__memo"
            tabIndex={-1}
            aria-label={t('segments.card.memo')}
            title={t('segments.card.memo')}
            onClick={(e) => {
              e.stopPropagation();
              p.onMemo(p.memoId!);
            }}
            data-testid="segment-memo"
          >
            <NotebookPen size={14} strokeWidth={1.75} aria-hidden />
          </button>
        ) : null}
      </div>
      <blockquote className={cx('seg-card__text', hasContext && 'seg-card__text--context')}>
        {p.shown.cutBefore ? <span className="seg-card__ctx">…</span> : null}
        {p.shown.before ? <span className="seg-card__ctx">{p.shown.before}</span> : null}
        <span className="seg-card__coded">{coded}</span>
        {p.shown.after ? <span className="seg-card__ctx">{p.shown.after}</span> : null}
        {p.shown.cutAfter ? <span className="seg-card__ctx">…</span> : null}
      </blockquote>
      {p.coding.comment.trim() ? (
        <p className="seg-card__comment">
          <MessageSquareText size={13} strokeWidth={1.75} aria-hidden />
          <span className="visually-hidden">{t('segments.card.comment')}: </span>
          {p.coding.comment}
        </p>
      ) : null}
    </article>
  );
});

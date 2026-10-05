import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, ExternalLink, MoveHorizontal, StickyNote, Trash2 } from 'lucide-react';
import type { Code, Coder, Coding } from '../../core/model/types';
import { LIMITS } from '../../core/model/types';
import { IconButton } from '../../ui/components/Button';
import { useI18n } from '../../ui/i18n';
import { CodePicker } from './CodePicker';
import type { CodeOption } from './model/codeSearch';

// The coded segments at one point of the text (a click on a highlight or a stripe): which code,
// whose coding, a comment, and what can be done with it. Delete removes the focused one.

export interface CodingPopoverProps {
  codings: readonly Coding[];
  codes: ReadonlyMap<string, Code>;
  coders: ReadonlyMap<string, Coder>;
  meId: string;
  options: readonly CodeOption[];
  memoCounts: ReadonlyMap<string, number>;
  onRemove: (id: string) => void;
  onRecode: (id: string, codeId: string) => void;
  onOpenCode: (codeId: string) => void;
  onMemo: (id: string) => void;
  onAdjust: (id: string) => void;
  onComment: (id: string, comment: string) => void;
}

export function CodingPopover(props: CodingPopoverProps) {
  const { t, tp } = useI18n();
  return (
    <div className="wb-codpop" data-testid="coding-popover">
      <div className="wb-codpop__head">{tp('workbench.coding.here', props.codings.length)}</div>
      <ul className="wb-codpop__list">
        {props.codings.map((c, i) => (
          <CodingItem key={c.id} coding={c} first={i === 0} {...props} />
        ))}
      </ul>
      <div className="wb-codpop__foot">{t('workbench.coding.deleteHint')}</div>
    </div>
  );
}

function CodingItem({ coding, first, codes, coders, meId, options, memoCounts, onRemove, onRecode, onOpenCode, onMemo, onAdjust, onComment }: CodingPopoverProps & { coding: Coding; first: boolean }) {
  const { t } = useI18n();
  const code = codes.get(coding.code_id);
  const coder = coders.get(coding.coder_id);
  const [comment, setComment] = useState(coding.comment);
  const [recoding, setRecoding] = useState(false);
  const [query, setQuery] = useState('');
  const pickerRef = useRef<HTMLInputElement>(null);
  const memos = memoCounts.get(coding.id) ?? 0;

  useEffect(() => setComment(coding.comment), [coding.comment]);
  useEffect(() => {
    if (recoding) requestAnimationFrame(() => pickerRef.current?.focus());
  }, [recoding]);

  const saveComment = () => {
    if (comment !== coding.comment) onComment(coding.id, comment.slice(0, LIMITS.commentMax));
  };

  return (
    <li
      className="wb-codpop__item"
      tabIndex={0}
      data-autofocus={first ? '' : undefined}
      data-testid="coding-item"
      aria-label={t('workbench.coding.itemLabel', { code: code?.name ?? '?', coder: coder?.name ?? '?' })}
      onKeyDown={(e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && e.target === e.currentTarget) {
          e.preventDefault();
          onRemove(coding.id);
        }
      }}
    >
      <div className="wb-codpop__row">
        <span className="wb-codpop__swatch" style={{ background: code?.color ?? 'var(--ink-4)' }} aria-hidden />
        <button type="button" className="wb-codpop__code" onClick={() => onOpenCode(coding.code_id)} title={t('workbench.coding.openCode')}>
          {code?.name ?? t('workbench.coding.unknownCode')}
        </button>
        {coder ? (
          <span className="wb-coder" title={t('workbench.coding.codedBy', { name: coder.name })}>
            <span className="wb-coder__dot" style={{ background: coder.color }} aria-hidden />
            {coder.id === meId ? t('workbench.coders.meShort') : coder.name}
          </span>
        ) : null}
      </div>
      <p className="wb-codpop__text">{coding.text}</p>
      {recoding ? (
        <div className="wb-codpop__recode">
          <CodePicker
            ref={pickerRef}
            options={options}
            query={query}
            onQuery={setQuery}
            onPick={(id) => {
              setRecoding(false);
              onRecode(coding.id, id);
            }}
            placeholder={t('workbench.coding.recodeSearch')}
            listWhenEmpty
            exclude={coding.code_id}
            testId="recode-picker"
          />
        </div>
      ) : (
        <textarea
          className="wb-codpop__comment"
          value={comment}
          rows={comment ? Math.min(5, comment.split('\n').length + 1) : 1}
          placeholder={t('workbench.coding.commentPlaceholder')}
          aria-label={t('workbench.coding.comment')}
          maxLength={LIMITS.commentMax}
          onChange={(e) => setComment(e.target.value)}
          onBlur={saveComment}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              saveComment();
            }
          }}
          data-testid="coding-comment"
        />
      )}
      <div className="wb-codpop__actions">
        <IconButton size="sm" icon={ArrowLeftRight} label={t('workbench.coding.recode')} pressed={recoding} onClick={() => setRecoding((r) => !r)} data-testid="coding-recode" />
        <IconButton size="sm" icon={MoveHorizontal} label={t('workbench.coding.adjust')} onClick={() => onAdjust(coding.id)} data-testid="coding-adjust" />
        <button type="button" className="wb-codpop__memo" onClick={() => onMemo(coding.id)} data-testid="coding-memo">
          <StickyNote size={14} aria-hidden strokeWidth={1.75} />
          {memos ? t('workbench.coding.memos', { n: memos }) : t('workbench.coding.addMemo')}
        </button>
        <span className="wb-codpop__spacer" />
        <IconButton size="sm" icon={ExternalLink} label={t('workbench.coding.openCode')} onClick={() => onOpenCode(coding.code_id)} data-testid="coding-open-code" />
        <IconButton size="sm" icon={Trash2} className="wb-icon-danger" label={t('workbench.coding.remove')} onClick={() => onRemove(coding.id)} data-testid="coding-remove" />
      </div>
    </li>
  );
}

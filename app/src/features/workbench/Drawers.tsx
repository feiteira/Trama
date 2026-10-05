import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, StickyNote, Trash2, X } from 'lucide-react';
import type { Code, Coder, Coding, Memo } from '../../core/model/types';
import { LIMITS } from '../../core/model/types';
import { createMemo, deleteMemo, updateMemo } from '../../services/memos';
import { listIn } from '../../services/undo';
import { useProject } from '../../shell/AppState';
import { useUndo } from '../../shell/undo';
import { useLive } from '../../shell/useLive';
import { Button, IconButton } from '../../ui/components/Button';
import { useToast } from '../../ui/components/Toast';
import { grownHeight } from '../../ui/grow';
import { useI18n } from '../../ui/i18n';

// Side drawers of the viewer: the coded segments of the document in text order, and the memos
// written about the document and about its coded segments.

function DrawerHead({ title, count, onClose, closeLabel }: { title: string; count?: string; onClose: () => void; closeLabel: string }) {
  return (
    <div className="wb-drawer__head">
      <h2 className="wb-drawer__title">{title}</h2>
      {count ? <span className="wb-drawer__count">{count}</span> : null}
      <span className="wb-drawer__spacer" />
      <IconButton size="sm" icon={X} label={closeLabel} onClick={onClose} data-testid="drawer-close" />
    </div>
  );
}

export interface SegmentsDrawerProps {
  codings: readonly Coding[];
  codes: ReadonlyMap<string, Code>;
  coders: ReadonlyMap<string, Coder>;
  meId: string;
  onJump: (c: Coding) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

export function SegmentsDrawer({ codings, codes, coders, meId, onJump, onRemove, onClose }: SegmentsDrawerProps) {
  const { t, tp } = useI18n();
  const many = coders.size > 1;
  return (
    <aside className="wb-drawer" aria-label={t('workbench.segments.title')} data-testid="segments-drawer">
      <DrawerHead title={t('workbench.segments.title')} count={tp('common.count.codings', codings.length)} onClose={onClose} closeLabel={t('common.close')} />
      {codings.length ? (
        <ol className="wb-seglist">
          {codings.map((c) => {
            const code = codes.get(c.code_id);
            const coder = coders.get(c.coder_id);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className="wb-seg"
                  onClick={() => onJump(c)}
                  onKeyDown={(e) => {
                    if (e.key === 'Delete') {
                      e.preventDefault();
                      onRemove(c.id);
                    }
                  }}
                  data-testid="segment-row"
                >
                  <span className="wb-seg__head">
                    <span className="wb-chip" style={{ ['--chip' as string]: code?.color ?? '#7a7f87' }}>
                      <span className="wb-dot" style={{ background: code?.color }} aria-hidden />
                      {code?.name ?? '?'}
                    </span>
                    {many && coder ? (
                      <span className="wb-coder wb-coder--small" title={coder.name}>
                        <span className="wb-coder__dot" style={{ background: coder.color }} aria-hidden />
                        {coder.id === meId ? t('workbench.coders.meShort') : coder.name}
                      </span>
                    ) : null}
                  </span>
                  <span className="wb-seg__text">{c.text}</span>
                  {c.comment ? <span className="wb-seg__comment">{c.comment}</span> : null}
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="wb-drawer__empty">{t('workbench.segments.empty')}</p>
      )}
    </aside>
  );
}

export interface MemosDrawerProps {
  docId: string;
  codings: readonly Coding[];
  codes: ReadonlyMap<string, Code>;
  /** A memo to scroll to and edit (just created). */
  focusId: string | null;
  onJump: (c: Coding) => void;
  onClose: () => void;
}

export function MemosDrawer({ docId, codings, codes, focusId, onJump, onClose }: MemosDrawerProps) {
  const { t, tp } = useI18n();
  const project = useProject();
  const { record } = useUndo();
  const toast = useToast();
  const codingIds = useMemo(() => codings.map((c) => c.id), [codings]);
  const idsKey = codingIds.join(',');
  const { data } = useLive(
    async (s) => {
      const [own, ofCodings] = await Promise.all([
        s.list('memo', { where: "target_kind = 'document' AND target_id = ?", params: [docId] }),
        codingIds.length ? listIn(s, 'memo', 'target_id', codingIds) : Promise.resolve([] as Memo[]),
      ]);
      const byNew = (a: Memo, b: Memo) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1);
      return { own: own.sort(byNew), ofCodings: ofCodings.filter((m) => m.target.kind === 'coding').sort(byNew) };
    },
    [docId, idsKey],
    ['memo'],
  );
  const byCoding = useMemo(() => new Map(codings.map((c) => [c.id, c])), [codings]);

  const add = async () => {
    try {
      const { memo, undo } = await createMemo(project, { target: { kind: 'document', id: docId } });
      record(undo);
      setEditing(memo.id);
    } catch (e) {
      toast.error(e);
    }
  };
  const [editing, setEditing] = useState<string | null>(focusId);
  useEffect(() => {
    if (focusId) setEditing(focusId);
  }, [focusId]);

  const remove = async (m: Memo) => {
    try {
      const { undo } = await deleteMemo(project, m.id);
      record(undo);
      toast.show({ message: t('workbench.memos.deleted'), action: { label: t('common.undo'), run: () => undo.undo() } });
    } catch (e) {
      toast.error(e);
    }
  };

  const total = (data?.own.length ?? 0) + (data?.ofCodings.length ?? 0);
  return (
    <aside className="wb-drawer" aria-label={t('workbench.memos.title')} data-testid="memos-drawer">
      <DrawerHead title={t('workbench.memos.title')} count={tp('common.count.memos', total)} onClose={onClose} closeLabel={t('common.close')} />
      <div className="wb-drawer__tools">
        <Button size="sm" icon={Plus} onClick={() => void add()} data-testid="memo-new">
          {t('workbench.memos.new')}
        </Button>
      </div>
      <div className="wb-memos">
        {data && !total ? (
          <div className="wb-drawer__empty">
            <StickyNote size={18} aria-hidden strokeWidth={1.5} />
            <p>{t('workbench.memos.empty')}</p>
          </div>
        ) : null}
        {data?.own.length ? <h3 className="wb-memos__group">{t('workbench.memos.onDocument')}</h3> : null}
        {data?.own.map((m) => (
          <MemoCard key={m.id} memo={m} editing={editing === m.id} onEdit={() => setEditing(m.id)} onRemove={() => void remove(m)} />
        ))}
        {data?.ofCodings.length ? <h3 className="wb-memos__group">{t('workbench.memos.onSegments')}</h3> : null}
        {data?.ofCodings.map((m) => {
          const c = m.target.kind === 'coding' ? byCoding.get(m.target.id) : undefined;
          const code = c ? codes.get(c.code_id) : undefined;
          return (
            <MemoCard
              key={m.id}
              memo={m}
              editing={editing === m.id}
              onEdit={() => setEditing(m.id)}
              onRemove={() => void remove(m)}
              about={
                c ? (
                  <button type="button" className="wb-memo__about" onClick={() => onJump(c)}>
                    <span className="wb-dot" style={{ background: code?.color }} aria-hidden />
                    <span className="wb-memo__about-code">{code?.name ?? '?'}</span>
                    <span className="wb-memo__about-text">{c.text}</span>
                  </button>
                ) : null
              }
            />
          );
        })}
      </div>
    </aside>
  );
}

function MemoCard({ memo, editing, onEdit, onRemove, about }: { memo: Memo; editing: boolean; onEdit: () => void; onRemove: () => void; about?: React.ReactNode }) {
  const { t } = useI18n();
  const project = useProject();
  const { record } = useUndo();
  const toast = useToast();
  const [title, setTitle] = useState(memo.title);
  const [body, setBody] = useState(memo.body);
  const [height, setHeight] = useState<number | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => setTitle(memo.title), [memo.title]);
  useEffect(() => setBody(memo.body), [memo.body]);
  useEffect(() => {
    if (!editing) return;
    card.current?.scrollIntoView({ block: 'nearest' });
    requestAnimationFrame(() => area.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const prev = el.style.height;
    el.style.height = '60px';
    const content = el.scrollHeight;
    el.style.height = prev;
    setHeight((cur) => grownHeight(cur, content, 60, 360));
  }, [body, editing]);

  const save = async () => {
    if (title === memo.title && body === memo.body) return;
    try {
      const { undo } = await updateMemo(project, memo.id, { title: title.slice(0, LIMITS.nameMax), body });
      record(undo);
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div ref={card} className={editing ? 'wb-memo is-editing' : 'wb-memo'} data-testid="memo-card">
      {about}
      <input
        ref={titleRef}
        className="wb-memo__title"
        value={title}
        placeholder={t('workbench.memos.untitled')}
        aria-label={t('workbench.memos.titleLabel')}
        maxLength={LIMITS.nameMax}
        onChange={(e) => setTitle(e.target.value)}
        onFocus={onEdit}
        onBlur={() => void save()}
        data-testid="memo-title"
      />
      <textarea
        ref={area}
        className="wb-memo__body"
        value={body}
        placeholder={t('workbench.memos.bodyPlaceholder')}
        aria-label={t('workbench.memos.bodyLabel')}
        style={{ height: height ?? 60 }}
        onChange={(e) => setBody(e.target.value)}
        onFocus={onEdit}
        onBlur={() => void save()}
        data-testid="memo-body"
      />
      <div className="wb-memo__foot">
        <span className="wb-memo__hint">{t('workbench.memos.autosave')}</span>
        <IconButton size="sm" icon={Trash2} className="wb-icon-danger" label={t('workbench.memos.delete')} onClick={onRemove} data-testid="memo-delete" />
      </div>
    </div>
  );
}

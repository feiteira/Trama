import React, { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import {
  Bold, FileText, FolderKanban, Heading2, Highlighter, Italic, List, ListOrdered, type LucideIcon, Palette, Tag, Trash2, User,
} from 'lucide-react';
import type { Memo, MemoTargetKind } from '../../core/model/types';
import { LIMITS } from '../../core/model/types';
import { type Inline as MdInline, parseMarkdown } from '../../core/text/markdown';
import { deleteMemo, updateMemo } from '../../services/memos';
import { useProject, useRegisterSaver } from '../../shell/AppState';
import { useKeyLabel } from '../../shell/keys';
import { useLive } from '../../shell/useLive';
import { useRouter } from '../../shell/router';
import { useUndo } from '../../shell/undo';
import { cx } from '../../ui/cx';
import { grownHeight } from '../../ui/grow';
import { useI18n } from '../../ui/i18n';
import { Button, IconButton } from '../../ui/components/Button';
import { RadioGroup } from '../../ui/components/Choice';
import { ColorPicker } from '../../ui/components/ColorPicker';
import { useConfirm } from '../../ui/components/Confirm';
import { Spinner } from '../../ui/components/Feedback';
import { Popover } from '../../ui/components/Popover';
import { useToast } from '../../ui/components/Toast';
import { MemoSaveUndo } from './memoUndo';
import { applyFormat, type Format, hlcMs, resolveTarget, type TargetInfo } from '../memos/memoModel';
import './MemoEditor.css';

export interface MemoEditorProps {
  memoId: string;
  /** Called after the memo was deleted here (the host closes its drawer or picks another memo). */
  onDeleted?(): void;
  /** Tighter layout for drawers and side panels: the text grows with its content. */
  compact?: boolean;
  /** Puts the caret in the title when the memo opens (a memo just created). */
  autoFocusTitle?: boolean;
}

export const TARGET_ICON: Record<MemoTargetKind, LucideIcon> = {
  project: FolderKanban,
  document: FileText,
  code: Tag,
  coding: Highlighter,
  case: User,
};

interface Loaded {
  memo: Memo | null;
  target: TargetInfo | null;
  coderName: string | null;
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const SAVE_DELAY = 700;
const NO_SWATCH = '#000001';

/** A title as the store keeps it (core/model/validate.ts). */
const tidyTitle = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, LIMITS.nameMax);

/**
 * Edits one memo: title, body with light Markdown and a preview, colour, what it is about
 * (with a link there), and deleting it. Saves by itself a moment after typing stops, when a
 * field loses focus, and before the library locks.
 */
export function MemoEditor({ memoId, onDeleted, compact = false, autoFocusTitle = false }: MemoEditorProps) {
  const { t, tp, date, relative } = useI18n();
  const project = useProject();
  const { go } = useRouter();
  const { record, manager } = useUndo();
  // Text saves go on the undo stack too (memoUndo.ts explains why).
  const [saveUndo] = useState(() => new MemoSaveUndo(manager));
  useEffect(() => saveUndo.attach(), [saveUndo]);
  const confirm = useConfirm();
  const toast = useToast();
  const key = useKeyLabel();
  const ids = useId();

  const { data } = useLive<Loaded>(
    async (store) => {
      const memo = await store.get('memo', memoId);
      if (!memo || memo.deleted) return { memo: null, target: null, coderName: null };
      const look = async () => {
        const tg = memo.target;
        const live = <T extends { deleted: boolean }>(r: T | null) => (r && !r.deleted ? r : undefined);
        const doc = tg.kind === 'document' ? live(await store.get('document', tg.id)) : undefined;
        const code = tg.kind === 'code' ? live(await store.get('code', tg.id)) : undefined;
        const kase = tg.kind === 'case' ? live(await store.get('case', tg.id)) : undefined;
        const coding = tg.kind === 'coding' ? live(await store.get('coding', tg.id)) : undefined;
        const codingCode = coding ? live(await store.get('code', coding.code_id)) : undefined;
        const codingDoc = coding ? live(await store.get('document', coding.document_id)) : undefined;
        return resolveTarget(tg, {
          document: (id) => (doc?.id === id ? doc : codingDoc?.id === id ? codingDoc : undefined),
          code: (id) => (code?.id === id ? code : codingCode?.id === id ? codingCode : undefined),
          case: (id) => (kase?.id === id ? kase : undefined),
          coding: (id) => (coding?.id === id ? coding : undefined),
        });
      };
      const [target, coder] = await Promise.all([look(), memo.coder_id ? store.get('coder', memo.coder_id) : Promise.resolve(null)]);
      return { memo, target, coderName: coder?.name ?? null };
    },
    [memoId],
    ['memo', 'document', 'code', 'case', 'coding', 'coder'],
  );

  const memo = data?.memo ?? null;
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [state, setState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [colourOpen, setColourOpen] = useState(false);
  const colourButton = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // What is being edited, read by the saver (which may run after this render).
  const draft = useRef({ memoId, title: '', body: '', dirty: false });
  const loadedFor = useRef<string | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  // Take the stored text when a memo opens, and later changes made elsewhere (undo, a merge)
  // unless there are unsaved edits here.
  useEffect(() => {
    if (!memo) return;
    const fresh = loadedFor.current !== memo.id;
    if (fresh || !draft.current.dirty) {
      // A title being typed keeps its trailing space: the store keeps titles tidied.
      const keepTitle = !fresh && tidyTitle(draft.current.title) === memo.title;
      const nextTitle = keepTitle ? draft.current.title : memo.title;
      draft.current = { memoId: memo.id, title: nextTitle, body: memo.body, dirty: false };
      setTitle(nextTitle);
      setBody(memo.body);
      if (fresh) {
        loadedFor.current = memo.id;
        setState('idle');
        setMode('write');
      }
    }
  }, [memo]);

  const save = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current);
    // Take the text now: by the time an earlier save finishes, another memo may be open.
    const d = draft.current;
    const before = saving.current;
    if (!d.dirty) {
      if (before) await before;
      return;
    }
    const snapshot = { title: d.title, body: d.body, memoId: d.memoId };
    const run = (async () => {
      if (before) await before;
      setState('saving');
      try {
        const { undo } = await updateMemo(project, snapshot.memoId, { title: tidyTitle(snapshot.title), body: snapshot.body });
        saveUndo.saved(snapshot.memoId, undo);
        const cur = draft.current;
        if (cur.memoId === snapshot.memoId && cur.title === snapshot.title && cur.body === snapshot.body) cur.dirty = false;
        if (draft.current.memoId === snapshot.memoId) setState(draft.current.dirty ? 'dirty' : 'saved');
      } catch (e) {
        // Locked or closed under us: the saver ran first, nothing is lost. Anything else shows.
        if (!project.isOpen) return;
        console.error(e);
        setSaveError(e instanceof Error ? e.message : String(e));
        setState('error');
      }
    })();
    saving.current = run;
    try {
      await run;
    } finally {
      if (saving.current === run) saving.current = null;
    }
  }, [project, saveUndo]);

  useRegisterSaver(save);
  // Leaving the memo (another one chosen, the drawer closed) saves what was typed.
  useEffect(() => () => void save(), [memoId, save]);

  const edit = (patch: { title?: string; body?: string }) => {
    if (patch.title !== undefined) setTitle(patch.title);
    if (patch.body !== undefined) setBody(patch.body);
    draft.current = { ...draft.current, ...patch, dirty: true };
    setState('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), SAVE_DELAY);
  };

  useEffect(() => {
    if (autoFocusTitle && memo && loadedFor.current === memo.id) titleRef.current?.focus();
    // Only when the memo first arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocusTitle, memo?.id]);

  const format = (f: Format) => {
    const el = bodyRef.current;
    if (!el) return;
    const r = applyFormat(body, el.selectionStart, el.selectionEnd, f);
    edit({ body: r.text });
    // After React has put the new text in.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.selStart, r.selEnd);
    });
  };

  const setColour = async (color: string | null) => {
    if (!memo) return;
    try {
      await save();
      const { undo } = await updateMemo(project, memo.id, { color });
      record(undo);
    } catch (e) {
      toast.error(e);
    }
  };

  const remove = async () => {
    if (!memo) return;
    const label = title.trim() || t('memos.list.untitled');
    const ok = await confirm({
      title: t('memos.editor.deleteTitle'),
      body: t('memos.editor.deleteBody', { title: label }),
      confirmLabel: t('common.delete'),
      danger: true,
      'data-testid': 'delete-memo-dialog',
    });
    if (!ok) return;
    try {
      await save();
      const { undo } = await deleteMemo(project, memo.id);
      draft.current.dirty = false;
      record(undo);
      toast.show({
        message: t('memos.editor.deleted'),
        action: { label: t('common.undo'), run: () => undo.undo(), testId: 'memo-undo-delete' },
      });
      onDeleted?.();
    } catch (e) {
      toast.error(e);
    }
  };

  const jump = (tg: TargetInfo) => {
    if (tg.missing || !tg.id) return;
    if (tg.kind === 'document') go({ name: 'workbench', docId: tg.id });
    else if (tg.kind === 'code') go({ name: 'codes', codeId: tg.id });
    else if (tg.kind === 'case') go({ name: 'cases', caseId: tg.id });
    else if (tg.kind === 'coding' && tg.docId && tg.span) go({ name: 'workbench', docId: tg.docId, select: tg.span });
  };

  const words = useMemo(() => (body.trim() ? body.trim().split(/\s+/).length : 0), [body]);

  if (!data) {
    return (
      <div className={cx('memo-editor', 'memo-editor--loading', compact && 'memo-editor--compact')}>
        <Spinner size={18} label={t('common.loading')} />
      </div>
    );
  }
  if (!memo) {
    return (
      <div className={cx('memo-editor', 'memo-editor--gone', compact && 'memo-editor--compact')} data-testid="memo-editor-gone">
        <p>{t('memos.editor.notFound')}</p>
      </div>
    );
  }

  const target = data.target;
  const created = DateTime.fromISO(memo.created_at);
  const updatedMs = hlcMs(memo.updated_at_hlc);
  const updated = updatedMs ? relative(DateTime.fromMillis(updatedMs).toISO()) : null;
  const statusText =
    state === 'saving' ? t('memos.editor.saving') : state === 'dirty' ? t('memos.editor.unsaved') : state === 'error' ? t('memos.editor.saveFailed', { message: saveError }) : state === 'saved' ? t('memos.editor.saved') : '';

  const onBodyKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    const k = e.key.toLowerCase();
    if (k === 'b' || k === 'i') {
      e.preventDefault();
      format(k === 'b' ? 'bold' : 'italic');
    } else if (k === 's') {
      e.preventDefault();
      void save();
    }
  };

  return (
    <section
      className={cx('memo-editor', compact && 'memo-editor--compact')}
      aria-label={t('memos.editor.label')}
      style={memo.color ? ({ '--memo-colour': memo.color } as React.CSSProperties) : undefined}
      data-testid="memo-editor"
    >
      <div className="memo-editor__bar">
        {target ? <TargetChip target={target} onJump={() => jump(target)} /> : null}
        <span className="memo-editor__spacer" />
        <IconButton
          ref={colourButton}
          icon={Palette}
          label={t('memos.editor.colour')}
          size="sm"
          aria-haspopup="dialog"
          aria-expanded={colourOpen}
          onClick={() => setColourOpen((o) => !o)}
          className={cx('memo-editor__colour', memo.color && 'memo-editor__colour--set')}
          data-testid="memo-colour"
        />
        <IconButton icon={Trash2} label={t('memos.editor.delete')} size="sm" onClick={() => void remove()} data-testid="memo-delete" />
        <Popover open={colourOpen} onClose={() => setColourOpen(false)} anchor={colourButton} align="end" padded aria-label={t('memos.editor.colour')} className="memo-editor__colours">
          <ColorPicker
            label={t('memos.editor.colour')}
            // No colour yet: a value outside the palette, so no swatch shows as chosen.
            value={memo.color ?? NO_SWATCH}
            custom={false}
            onChange={(c) => {
              setColourOpen(false);
              void setColour(c);
            }}
            data-testid="memo-colour-picker"
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={!memo.color}
            onClick={() => {
              setColourOpen(false);
              void setColour(null);
            }}
            data-testid="memo-colour-none"
          >
            {t('memos.editor.noColour')}
          </Button>
        </Popover>
      </div>

      <label className="visually-hidden" htmlFor={`${ids}-title`}>
        {t('memos.editor.title')}
      </label>
      <TitleField
        ref={titleRef}
        id={`${ids}-title`}
        value={title}
        placeholder={t('memos.editor.titlePlaceholder')}
        onChange={(v) => edit({ title: v })}
        onBlur={() => void save()}
        onEnter={() => {
          if (bodyRef.current) bodyRef.current.focus();
          else {
            setMode('write');
            requestAnimationFrame(() => bodyRef.current?.focus());
          }
        }}
      />

      <div className="memo-editor__meta">
        <span>{data.coderName ? t('memos.editor.createdBy', { date: date(created), coder: data.coderName }) : t('memos.editor.created', { date: date(created) })}</span>
        {updated ? <span>· {t('memos.editor.updated', { when: updated })}</span> : null}
      </div>

      <div className="memo-editor__tools">
        <RadioGroup<'write' | 'preview'>
          label={t('memos.editor.mode')}
          hideLabel
          variant="segmented"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'write', label: t('memos.editor.write') },
            { value: 'preview', label: t('memos.editor.preview') },
          ]}
          data-testid="memo-mode"
        />
        {mode === 'write' ? (
          <div className="memo-editor__format" role="toolbar" aria-label={t('memos.editor.toolbar')}>
            <IconButton icon={Heading2} size="sm" label={t('memos.editor.heading')} onClick={() => format('heading')} data-testid="memo-format-heading" />
            <IconButton icon={Bold} size="sm" label={t('memos.editor.bold')} shortcut={key('B')} onClick={() => format('bold')} data-testid="memo-format-bold" />
            <IconButton icon={Italic} size="sm" label={t('memos.editor.italic')} shortcut={key('I')} onClick={() => format('italic')} data-testid="memo-format-italic" />
            <IconButton icon={List} size="sm" label={t('memos.editor.bullets')} onClick={() => format('bullets')} data-testid="memo-format-bullets" />
            <IconButton icon={ListOrdered} size="sm" label={t('memos.editor.numbers')} onClick={() => format('numbers')} data-testid="memo-format-numbers" />
          </div>
        ) : null}
      </div>

      <div className="memo-editor__sheet">
        {mode === 'write' ? (
          <>
            <label className="visually-hidden" htmlFor={`${ids}-body`}>
              {t('memos.editor.body')}
            </label>
            <BodyField
              ref={bodyRef}
              id={`${ids}-body`}
              value={body}
              compact={compact}
              placeholder={t('memos.editor.bodyPlaceholder')}
              onChange={(v) => edit({ body: v })}
              onBlur={() => void save()}
              onKeyDown={onBodyKey}
            />
          </>
        ) : (
          <div className="memo-editor__preview" data-testid="memo-preview">
            {body.trim() ? <MarkdownView source={body} /> : <p className="memo-editor__empty">{t('memos.editor.emptyPreview')}</p>}
          </div>
        )}
      </div>

      <div className="memo-editor__foot">
        <span className="memo-editor__words">{tp('memos.editor.words', words)}</span>
        <span className={cx('memo-editor__status', `memo-editor__status--${state}`)} role="status" aria-live="polite" data-testid="memo-status">
          {statusText}
          {state === 'error' ? (
            <Button size="sm" variant="ghost" onClick={() => void save()}>
              {t('memos.editor.retry')}
            </Button>
          ) : null}
        </span>
      </div>
    </section>
  );
}

/** Follows the content height of a text area between `min` and `max` px (grow.ts's slack rule). */
function useAutoHeight(el: React.RefObject<HTMLTextAreaElement | null>, value: string, active: boolean, min: number, max: number): number | null {
  const [height, setHeight] = useState<number | null>(null);
  React.useLayoutEffect(() => {
    const node = el.current;
    if (!active || !node) return;
    const prev = node.style.height;
    node.style.height = `${min}px`;
    const content = node.scrollHeight;
    node.style.height = prev;
    setHeight((cur) => grownHeight(cur, content, min, max));
  }, [value, active, min, max, el]);
  return height;
}

function mergeRefs<T>(inner: React.MutableRefObject<T | null>, outer: React.ForwardedRef<T>) {
  return (node: T | null) => {
    inner.current = node;
    if (typeof outer === 'function') outer(node);
    else if (outer) outer.current = node;
  };
}

/** The memo's title: one paragraph that wraps (long titles stay readable); Enter goes to the text. */
const TitleField = React.forwardRef<
  HTMLTextAreaElement,
  { id: string; value: string; placeholder: string; onChange: (v: string) => void; onBlur: () => void; onEnter: () => void }
>(function TitleField({ id, value, placeholder, onChange, onBlur, onEnter }, ref) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const height = useAutoHeight(inner, value, true, 34, 160);
  return (
    <textarea
      ref={mergeRefs(inner, ref)}
      id={id}
      className="memo-editor__title"
      rows={1}
      value={value}
      maxLength={LIMITS.nameMax}
      placeholder={placeholder}
      spellCheck
      onChange={(e) => onChange(e.target.value.replace(/\n/g, ' '))}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onEnter();
        }
      }}
      style={{ height: height ?? undefined }}
      data-testid="memo-title"
    />
  );
});

/** The body text area: fills the editor, or grows with the text when compact. */
const BodyField = React.forwardRef<
  HTMLTextAreaElement,
  { id: string; value: string; compact: boolean; placeholder: string; onChange: (v: string) => void; onBlur: () => void; onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void }
>(function BodyField({ id, value, compact, placeholder, onChange, onBlur, onKeyDown }, ref) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const height = useAutoHeight(inner, value, compact, 160, 480);
  return (
    <textarea
      ref={mergeRefs(inner, ref)}
      id={id}
      className="memo-editor__body"
      value={value}
      maxLength={LIMITS.memoMax}
      placeholder={placeholder}
      spellCheck
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      style={compact ? { height: height ?? 160 } : undefined}
      data-testid="memo-body"
    />
  );
});

function TargetChip({ target, onJump }: { target: TargetInfo; onJump: () => void }) {
  const { t } = useI18n();
  const Icon = TARGET_ICON[target.kind];
  const kind = t(`memos.kind.${target.kind}`);
  if (target.kind === 'project') {
    return (
      <span className="memo-target memo-target--static" data-testid="memo-target">
        <Icon size={14} strokeWidth={1.75} aria-hidden />
        {t('memos.editor.projectTarget')}
      </span>
    );
  }
  if (target.missing) {
    return (
      <span className="memo-target memo-target--missing" data-testid="memo-target">
        <Icon size={14} strokeWidth={1.75} aria-hidden />
        {t('memos.editor.missing', { kind: kind.toLocaleLowerCase() })}
      </span>
    );
  }
  const name = target.kind === 'coding' ? `“${target.label}”` : target.label;
  return (
    <button type="button" className="memo-target" onClick={onJump} title={t('memos.editor.goTo', { name })} aria-label={t('memos.editor.goTo', { name })} data-testid="memo-target">
      {target.color ? <span className="memo-target__dot" style={{ background: target.color }} aria-hidden /> : <Icon size={14} strokeWidth={1.75} aria-hidden />}
      <span className="memo-target__kind">{kind}</span>
      <span className="memo-target__name">{name}</span>
      {target.detail ? <span className="memo-target__detail">{target.detail}</span> : null}
    </button>
  );
}

function inline(nodes: MdInline[], key = ''): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${i}`;
    switch (n.t) {
      case 'text':
        return <React.Fragment key={k}>{n.v}</React.Fragment>;
      case 'bold':
        return <strong key={k}>{inline(n.c, `${k}.`)}</strong>;
      case 'italic':
        return <em key={k}>{inline(n.c, `${k}.`)}</em>;
      case 'strike':
        return <s key={k}>{inline(n.c, `${k}.`)}</s>;
      case 'code':
        return <code key={k}>{n.v}</code>;
      case 'link':
        // Shown, never followed: Trama opens nothing on the network.
        return (
          <span key={k} className="md-link" title={n.href}>
            {inline(n.c, `${k}.`)}
          </span>
        );
    }
  });
}

/** Light Markdown as the memo will read. Images and links are shown as text (no network). */
export function MarkdownView({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source, { breaks: true }), [source]);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'heading': {
            const Tag = (b.level <= 1 ? 'h3' : b.level === 2 ? 'h4' : 'h5') as 'h3' | 'h4' | 'h5';
            return <Tag key={i}>{inline(b.c)}</Tag>;
          }
          case 'para':
            return <p key={i}>{inline(b.c)}</p>;
          case 'quote':
            return <blockquote key={i}>{inline(b.c)}</blockquote>;
          case 'code':
            return <pre key={i}>{b.v}</pre>;
          case 'rule':
            return <hr key={i} />;
          case 'image':
            return b.alt ? (
              <p key={i} className="md-alt">
                {b.alt}
              </p>
            ) : null;
          case 'list': {
            const L = b.ordered ? 'ol' : 'ul';
            return (
              <L key={i}>
                {b.items.map((it, j) => (
                  <li key={j} style={it.depth ? { marginLeft: `${it.depth * 1.2}em` } : undefined}>
                    {inline(it.c)}
                  </li>
                ))}
              </L>
            );
          }
          case 'table':
            return (
              <div key={i} className="md-table">
                <table>
                  <thead>
                    <tr>
                      {b.head.map((c, j) => (
                        <th key={j}>{inline(c)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, k) => (
                          <td key={k}>{inline(c)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { Check, ChevronRight, Combine, Ellipsis, FileText, Folder, NotebookPen, Plus, Rows3, Split, Trash2, Users } from 'lucide-react';
import type { Code, Memo } from '../../core/model/types';
import * as memosService from '../../services/memos';
import * as codesService from '../../services/codes';
import { codingsForCodes } from '../../services/queries';
import { useProject, useRegisterSaver } from '../../shell/AppState';
import { useRouter } from '../../shell/router';
import { useUndo } from '../../shell/undo';
import { useLive } from '../../shell/useLive';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import { Button, IconButton } from '../../ui/components/Button';
import { Checkbox, Switch } from '../../ui/components/Choice';
import { ColorPicker } from '../../ui/components/ColorPicker';
import { Spinner } from '../../ui/components/Feedback';
import { Select, TextArea, TextField } from '../../ui/components/Field';
import { MenuButton } from '../../ui/components/Menu';
import { Popover } from '../../ui/components/Popover';
import { codeChoices, pathsOf } from '../common/codeTreeModel';
import { useFail, useUndoToast, type CodeActions, type CodeData } from '../common/CodeTreeActions';
import { perCoder, perDocument, segmentContext, type SegmentContext } from './codeDetailModel';
import { SplitCodeDialog } from './CodesDialogs';
import './codes.css';

const PREVIEW = 20;
const TEXT_FIELDS = ['description', 'inclusion', 'exclusion', 'example'] as const;
type TextFieldName = (typeof TEXT_FIELDS)[number];

interface Preview {
  id: string;
  documentId: string;
  documentName: string;
  coder: { name: string; color: string } | null;
  start: number;
  end: number;
  context: SegmentContext;
}

/** The selected code on the Codes screen: everything about it, edited in place. */
export function CodeDetail({ code, data, actions, onSelect, onMergeMany }: { code: Code; data: CodeData; actions: CodeActions; onSelect: (id: string) => void; onMergeMany: (ids: string[]) => void }) {
  const { t, tp, meta } = useI18n();
  const project = useProject();
  const { go } = useRouter();
  const { record } = useUndo();
  const undoToast = useUndoToast();
  const fail = useFail();
  const row = data.rowById.get(code.id);
  const paths = useMemo(() => pathsOf(data.items), [data.items]);
  const path = paths.get(code.id) ?? [code.name];
  const parentId = code.parent_id && data.byId.has(code.parent_id) ? code.parent_id : null;
  const ancestors = useMemo(() => {
    const out: Code[] = [];
    for (let p = parentId; p; p = data.byId.get(p)?.parent_id ?? null) {
      const c = data.byId.get(p);
      if (!c || out.includes(c)) break;
      out.unshift(c);
    }
    return out;
  }, [parentId, data.byId]);

  // ── Usage, segments ───────────────────────────────────────────────────────────────────────
  const { data: usage } = useLive(
    async (store) => {
      const [codings, docs, coders] = await Promise.all([codingsForCodes(project, [code.id]), store.list('document', { order: 'sort, id' }), store.list('coder')]);
      const docName = new Map(docs.map((d) => [d.id, d.name]));
      const coderOf = new Map(coders.map((c) => [c.id, { name: c.name, color: c.color }]));
      const first = codings.slice(0, PREVIEW);
      const texts = new Map<string, string>();
      for (const id of new Set(first.map((c) => c.document_id))) {
        const dt = await store.get('doctext', id);
        if (dt && !dt.deleted) texts.set(id, dt.text);
      }
      const previews: Preview[] = first.map((c) => {
        const text = texts.get(c.document_id);
        return {
          id: c.id,
          documentId: c.document_id,
          documentName: docName.get(c.document_id) ?? '',
          coder: coderOf.get(c.coder_id) ?? null,
          start: c.start,
          end: c.end,
          context: text ? segmentContext(text, c.start, c.end) : { before: '', text: c.text, after: '', clippedStart: false, clippedEnd: false },
        };
      });
      return { ids: codings.map((c) => c.id), previews, docs: perDocument(codings, docs), coders: perCoder(codings, coders) };
    },
    [project, code.id],
    ['coding', 'document', 'coder', 'doctext'],
  );
  const { data: memos } = useLive(() => memosService.memosFor(project, { kind: 'code', id: code.id }), [project, code.id], ['memo']);

  // ── Editing ───────────────────────────────────────────────────────────────────────────────
  const [name, setName] = useState(code.name);
  useEffect(() => setName(code.name), [code.name]);
  const commitName = () => {
    if (name.trim() && name.trim() !== code.name) void actions.rename(code.id, name);
    else setName(code.name);
  };

  const save = useCallback(
    async (patch: codesService.CodePatch) => {
      const { undo } = await codesService.updateCode(project, code.id, patch);
      record(undo);
    },
    [project, code.id, record],
  );
  const autosave = useAutosave(code, save, fail);

  const parentOptions = useMemo(
    () => [{ value: '', label: t('codes.detail.topLevel') }, ...codeChoices(data.items, [code.id], { excludeBranches: true }).map((c) => ({ value: c.id, label: c.path }))],
    [data.items, code.id, t],
  );

  const [colourOpen, setColourOpen] = useState(false);
  const swatch = useRef<HTMLButtonElement>(null);

  // Segments chosen for a split.
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const [splitting, setSplitting] = useState(false);
  useEffect(() => {
    if (!usage) return;
    const live = new Set(usage.ids);
    setChosen((s) => {
      const next = new Set([...s].filter((id) => live.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [usage]);

  const split = async (newName: string) => {
    try {
      const res = await codesService.splitCode(project, code.id, { newName, codingIds: [...chosen] });
      setSplitting(false);
      setChosen(new Set());
      undoToast(tp('codes.toast.split', res.moved, { name: res.code.name }), res.undo);
    } catch (e) {
      fail(e);
    }
  };

  const nf = new Intl.NumberFormat(meta.bcp47);
  const own = row?.own ?? 0;
  const total = row?.total ?? 0;
  const maxBar = Math.max(1, ...(usage?.docs.map((d) => d.count) ?? [1]));
  const shownDocs = usage?.docs.slice(0, 12) ?? [];

  return (
    <article className="cdetail" aria-labelledby="code-detail-name" data-testid="code-detail">
      <header className="cdetail__head">
        <button
          ref={swatch}
          type="button"
          className={cx('cdetail__swatch', !code.codable && 'cdetail__swatch--category')}
          style={{ ['--code' as string]: code.color }}
          aria-label={t('codes.colourOf', { name: code.name })}
          aria-haspopup="dialog"
          aria-expanded={colourOpen}
          onClick={() => setColourOpen((o) => !o)}
          data-testid="code-detail-colour"
        >
          {code.codable ? null : <Folder size={18} strokeWidth={1.75} aria-hidden />}
        </button>
        <Popover open={colourOpen} onClose={() => setColourOpen(false)} anchor={swatch} padded aria-label={t('codes.menu.colour')}>
          <ColorPicker label={t('codes.colourOf', { name: code.name })} value={code.color} onChange={(c) => void actions.setColor(code.id, c)} data-testid="code-detail-colour-picker" />
        </Popover>
        <div className="cdetail__titles">
          <div className="cdetail__topline">
          <nav className="cdetail__crumbs" aria-label={t('codes.detail.path')}>
            {ancestors.length ? (
              ancestors.map((a) => (
                <React.Fragment key={a.id}>
                  <button type="button" className="cdetail__crumb" onClick={() => onSelect(a.id)}>
                    {a.name}
                  </button>
                  <ChevronRight size={12} aria-hidden />
                </React.Fragment>
              ))
            ) : (
              <span className="cdetail__crumb cdetail__crumb--static">{code.codable ? t('codes.detail.kindCode') : t('codes.detail.kindCategory')}</span>
            )}
          </nav>
          <div className="cdetail__actions">
            <Button size="sm" icon={Rows3} onClick={() => go({ name: 'segments', codeIds: [code.id] })} data-testid="code-detail-segments">
              {t('codes.detail.showSegments')}
            </Button>
            <MenuButton
              iconOnly
              icon={Ellipsis}
              label={t('codes.detail.more')}
              size="sm"
              variant="ghost"
              align="end"
              items={[
                { id: 'merge', label: t('codes.menu.merge'), icon: Combine, onSelect: () => actions.mergeInto(code.id), testId: 'code-detail-merge-into' },
                { id: 'merge-many', label: t('codes.detail.mergeMany'), icon: Combine, onSelect: () => onMergeMany([code.id]), testId: 'code-detail-merge-many' },
                { id: 'split', label: t('codes.detail.split'), icon: Split, disabled: !chosen.size, hint: chosen.size ? String(chosen.size) : undefined, onSelect: () => setSplitting(true), testId: 'code-detail-split' },
                { kind: 'separator' },
                { id: 'delete', label: t('codes.menu.delete'), icon: Trash2, danger: true, onSelect: () => actions.remove(code.id), testId: 'code-detail-delete' },
              ]}
              data-testid="code-detail-more"
            />
          </div>
          </div>
          <input
            id="code-detail-name"
            className="cdetail__name"
            value={name}
            maxLength={120}
            aria-label={t('codes.fields.name')}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === 'Escape') {
                setName(code.name);
              }
            }}
            data-testid="code-detail-name"
          />
        </div>
      </header>

      <div className="cdetail__grid">
        <div className="cdetail__main">
          <section className="cdetail__props" aria-label={t('codes.detail.properties')}>
            <Select<string>
              label={t('codes.fields.parent')}
              value={parentId ?? ''}
              onChange={(v) => void actions.move(code.id, v || null, null)}
              options={parentOptions}
              size="sm"
              data-testid="code-detail-parent"
            />
            <Select<string>
              label={t('codes.fields.shortcut')}
              value={code.shortcut ? String(code.shortcut) : ''}
              onChange={(v) => void actions.setShortcut(code.id, v ? Number(v) : null)}
              options={[
                { value: '', label: t('codes.shortcut.none') },
                ...Array.from({ length: 9 }, (_, i) => {
                  const holder = data.rows.find((r) => r.code.shortcut === i + 1 && r.code.id !== code.id);
                  return { value: String(i + 1), label: holder ? t('codes.shortcut.keyHeld', { n: i + 1, name: holder.code.name }) : t('codes.shortcut.key', { n: i + 1 }) };
                }),
              ]}
              size="sm"
              disabled={!code.codable}
              data-testid="code-detail-shortcut"
            />
            <Switch
              className="cdetail__category"
              checked={!code.codable}
              onChange={(v) => void actions.setCodable(code.id, !v)}
              label={t('codes.fields.category')}
              description={t('codes.fields.categoryHint')}
              data-testid="code-detail-category"
            />
          </section>

          <section className="cdetail__section" aria-labelledby="code-def-title">
            <div className="cdetail__section-head">
              <h2 id="code-def-title" className="cdetail__section-title">
                {t('codes.detail.definition')}
              </h2>
              <span className="cdetail__saved" aria-live="polite" data-testid="code-detail-saved">
                {autosave.state === 'saving' ? (
                  <>
                    <Spinner size={12} /> {t('common.working')}
                  </>
                ) : autosave.state === 'saved' ? (
                  <>
                    <Check size={13} aria-hidden /> {t('common.saved')}
                  </>
                ) : null}
              </span>
            </div>
            <div className="cdetail__fields">
              <TextArea
                label={t('codes.fields.description')}
                hint={t('codes.fields.descriptionHint')}
                value={autosave.values.description}
                onChange={(v) => autosave.change('description', v)}
                onBlur={() => autosave.flush('description')}
                autoGrow
                minHeight={76}
                maxHeight={360}
                placeholder={t('codes.fields.descriptionPlaceholder')}
                data-testid="code-detail-description"
              />
              <div className="codedialog__pair">
                <TextArea
                  label={t('codes.fields.inclusion')}
                  value={autosave.values.inclusion}
                  onChange={(v) => autosave.change('inclusion', v)}
                  onBlur={() => autosave.flush('inclusion')}
                  autoGrow
                  minHeight={64}
                  maxHeight={300}
                  placeholder={t('codes.fields.inclusionPlaceholder')}
                  data-testid="code-detail-inclusion"
                />
                <TextArea
                  label={t('codes.fields.exclusion')}
                  value={autosave.values.exclusion}
                  onChange={(v) => autosave.change('exclusion', v)}
                  onBlur={() => autosave.flush('exclusion')}
                  autoGrow
                  minHeight={64}
                  maxHeight={300}
                  placeholder={t('codes.fields.exclusionPlaceholder')}
                  data-testid="code-detail-exclusion"
                />
              </div>
              <TextArea
                label={t('codes.fields.example')}
                value={autosave.values.example}
                onChange={(v) => autosave.change('example', v)}
                onBlur={() => autosave.flush('example')}
                autoGrow
                reading
                minHeight={64}
                maxHeight={300}
                placeholder={t('codes.fields.examplePlaceholder')}
                data-testid="code-detail-example"
              />
            </div>
          </section>

          <section className="cdetail__section" aria-labelledby="code-seg-title" data-testid="code-detail-preview">
            <div className="cdetail__section-head">
              <h2 id="code-seg-title" className="cdetail__section-title">
                {t('codes.detail.segments')}
                <span className="cdetail__section-count">{nf.format(own)}</span>
              </h2>
              {usage && usage.ids.length ? (
                <div className="cdetail__seg-tools">
                  {chosen.size ? (
                    <>
                      <span className="t-small t-secondary">{tp('codes.detail.chosen', chosen.size)}</span>
                      <Button size="sm" variant="ghost" onClick={() => setChosen(new Set())}>
                        {t('common.clear')}
                      </Button>
                      <Button size="sm" variant="secondary" icon={Split} onClick={() => setSplitting(true)} data-testid="code-detail-split-button">
                        {t('codes.detail.splitShort')}
                      </Button>
                    </>
                  ) : usage.ids.length > 1 ? (
                    <Button size="sm" variant="ghost" onClick={() => setChosen(new Set(usage.ids))} data-testid="code-detail-choose-all">
                      {tp('codes.detail.chooseAll', usage.ids.length)}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
            {!usage ? (
              <div className="cdetail__loading">
                <Spinner />
              </div>
            ) : usage.previews.length === 0 ? (
              <p className="cdetail__none">{code.codable ? t('codes.detail.noSegments') : t('codes.detail.noSegmentsCategory')}</p>
            ) : (
              <>
                <ol className="cseg">
                  {usage.previews.map((p) => (
                    <li key={p.id} className={cx('cseg__item', chosen.has(p.id) && 'cseg__item--chosen')} style={{ ['--code' as string]: code.color }}>
                      <Checkbox
                        className="cseg__check"
                        checked={chosen.has(p.id)}
                        onChange={(on) =>
                          setChosen((s) => {
                            const next = new Set(s);
                            if (on) next.add(p.id);
                            else next.delete(p.id);
                            return next;
                          })
                        }
                        label={<span className="visually-hidden">{t('codes.detail.chooseSegment', { doc: p.documentName })}</span>}
                        data-testid={`code-segment-check-${p.id}`}
                      />
                      <div className="cseg__body">
                        <div className="cseg__meta">
                        <button type="button" className="cseg__doc" onClick={() => go({ name: 'workbench', docId: p.documentId, codeId: code.id, select: { start: p.start, end: p.end } })} data-testid="code-segment-open">
                          <FileText size={12} aria-hidden />
                          {p.documentName}
                        </button>
                        {usage.coders.length > 1 && p.coder ? (
                          <span className="cseg__coder">
                            <span className="codepick__dot" style={{ background: p.coder.color }} aria-hidden />
                            {p.coder.name}
                          </span>
                        ) : null}
                        </div>
                        <p className="cseg__text">
                          {p.context.clippedStart ? '… ' : ''}
                          <span className="cseg__ctx">{p.context.before}</span>
                          <mark className="cseg__mark">{p.context.text}</mark>
                          <span className="cseg__ctx">{p.context.after}</span>
                          {p.context.clippedEnd ? ' …' : ''}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="cdetail__more">
                  {usage.ids.length > PREVIEW ? <span className="t-muted t-small">{tp('codes.detail.previewOf', usage.ids.length, { shown: PREVIEW })}</span> : <span />}
                  <Button size="sm" variant="ghost" iconEnd={ChevronRight} onClick={() => go({ name: 'segments', codeIds: [code.id] })} data-testid="code-detail-show-all">
                    {t('codes.detail.showAll')}
                  </Button>
                </div>
              </>
            )}
          </section>
        </div>

        <aside className="cdetail__aside">
          <section className="cdetail__card" aria-labelledby="code-usage-title" data-testid="code-detail-usage">
            <h2 id="code-usage-title" className="cdetail__card-title">
              {t('codes.detail.usage')}
            </h2>
            <dl className="cstats">
              <div className="cstats__item">
                <dt>{t('codes.detail.statSegments')}</dt>
                <dd>{nf.format(own)}</dd>
                {total > own ? <span className="cstats__sub">{tp('codes.detail.withChildren', total, { n: nf.format(total) })}</span> : null}
              </div>
              <div className="cstats__item">
                <dt>{t('codes.detail.statDocuments')}</dt>
                <dd>{nf.format(row?.documents ?? 0)}</dd>
                {row && row.documentsTotal > row.documents ? <span className="cstats__sub">{tp('codes.detail.withChildren', row.documentsTotal, { n: nf.format(row.documentsTotal) })}</span> : null}
              </div>
              <div className="cstats__item">
                <dt>{t('codes.detail.statCoders')}</dt>
                <dd>{usage ? nf.format(usage.coders.length) : '…'}</dd>
              </div>
            </dl>
            {usage && usage.docs.length ? (
              <div className="cbars" role="list" aria-label={t('codes.detail.perDocument')}>
                <h3 className="cbars__title">{t('codes.detail.perDocument')}</h3>
                {shownDocs.map((d) => (
                  <div key={d.id} role="listitem" className="cbars__row" title={`${d.name}: ${tp('common.count.codings', d.count)}`}>
                    <span className="cbars__name">{d.name}</span>
                    <span className="cbars__track" aria-hidden>
                      <span className="cbars__bar" style={{ width: `${Math.max(4, (d.count / maxBar) * 100)}%`, background: code.color }} />
                    </span>
                    <span className="cbars__n">{d.count}</span>
                  </div>
                ))}
                {usage.docs.length > shownDocs.length ? <p className="cbars__more">{tp('codes.detail.moreDocuments', usage.docs.length - shownDocs.length)}</p> : null}
              </div>
            ) : null}
            {usage && usage.coders.length > 1 ? (
              <div className="ccoders">
                <Users size={13} aria-hidden />
                {usage.coders.map((c) => (
                  <span key={c.id} className="ccoders__item">
                    <span className="codepick__dot" style={{ background: c.color }} aria-hidden />
                    {c.name} <span className="t-muted">{c.count}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </section>

          <MemoCard codeId={code.id} memos={memos} />
        </aside>
      </div>

      {splitting ? <SplitCodeDialog parentName={code.name} count={chosen.size} onCancel={() => setSplitting(false)} onConfirm={split} /> : null}
    </article>
  );
}

function MemoCard({ codeId, memos }: { codeId: string; memos: Memo[] | undefined }) {
  const { t, relative } = useI18n();
  const project = useProject();
  const { go } = useRouter();
  const { record } = useUndo();
  const fail = useFail();
  const [writing, setWriting] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (busy || (!title.trim() && !body.trim())) return;
    setBusy(true);
    try {
      record((await memosService.createMemo(project, { title, body, target: { kind: 'code', id: codeId } })).undo);
      setWriting(false);
      setTitle('');
      setBody('');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="cdetail__card" aria-labelledby="code-memos-title" data-testid="code-detail-memos">
      <div className="cdetail__card-head">
        <h2 id="code-memos-title" className="cdetail__card-title">
          {t('codes.detail.memos')}
          {memos?.length ? <span className="cdetail__section-count">{memos.length}</span> : null}
        </h2>
        {!writing ? <IconButton icon={Plus} label={t('codes.detail.newMemo')} size="sm" onClick={() => setWriting(true)} data-testid="code-memo-new" /> : null}
      </div>
      {writing ? (
        <div className="cmemo__form">
          <TextField size="sm" value={title} onChange={setTitle} placeholder={t('codes.detail.memoTitle')} aria-label={t('codes.detail.memoTitle')} autoFocus maxLength={200} data-testid="code-memo-title" />
          <TextArea value={body} onChange={setBody} autoGrow minHeight={80} maxHeight={260} placeholder={t('codes.detail.memoBody')} aria-label={t('codes.detail.memoBody')} reading data-testid="code-memo-body" />
          <div className="cmemo__actions">
            <Button size="sm" variant="ghost" onClick={() => setWriting(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" variant="primary" busy={busy} disabled={!title.trim() && !body.trim()} onClick={() => void create()} data-testid="code-memo-save">
              {t('common.save')}
            </Button>
          </div>
        </div>
      ) : null}
      {memos && memos.length ? (
        <ul className="cmemo__list">
          {memos.map((m) => (
            <li key={m.id}>
              <button type="button" className="cmemo__item" onClick={() => go({ name: 'memos', memoId: m.id })} data-testid={`code-memo-${m.id}`}>
                <span className="cmemo__title">
                  <NotebookPen size={13} aria-hidden />
                  {m.title || t('common.untitled')}
                </span>
                {m.body.trim() ? <span className="cmemo__excerpt">{m.body.replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim()}</span> : null}
                <span className="cmemo__date">{relative(m.created_at, DateTime.now())}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : !writing ? (
        <p className="cdetail__none cdetail__none--small">{t('codes.detail.noMemos')}</p>
      ) : null}
    </section>
  );
}

/**
 * Definition fields saved while typing (after a pause) and on leaving the field, each save one
 * Undo step. A change made elsewhere (Undo, a teammate's merge) shows unless the field has
 * unsaved typing of its own.
 */
function useAutosave(code: Code, save: (patch: codesService.CodePatch) => Promise<void>, fail: (e: unknown) => void) {
  const [values, setValues] = useState<Record<TextFieldName, string>>(() => ({ description: code.description, inclusion: code.inclusion, exclusion: code.exclusion, example: code.example }));
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const dirty = useRef(new Set<TextFieldName>());
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    setValues((v) => {
      const next = { ...v };
      for (const f of TEXT_FIELDS) if (!dirty.current.has(f)) next[f] = code[f];
      return next;
    });
  }, [code]);

  const flushAll = useCallback(async () => {
    clearTimeout(timer.current);
    if (!dirty.current.size) return;
    const patch: codesService.CodePatch = {};
    for (const f of dirty.current) patch[f] = valuesRef.current[f];
    dirty.current.clear();
    setState('saving');
    try {
      await saveRef.current(patch);
      setState('saved');
    } catch (e) {
      setState('idle');
      fail(e);
    }
  }, [fail]);

  const change = (f: TextFieldName, v: string) => {
    setValues((cur) => ({ ...cur, [f]: v }));
    dirty.current.add(f);
    setState('idle');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushAll(), 1200);
  };

  // Leaving the code (another one chosen, the screen closed) saves what was typed.
  useEffect(() => () => void flushAll(), [flushAll]);
  useRegisterSaver(flushAll);

  return { values, state, change, flush: (_f: TextFieldName) => void flushAll() };
}

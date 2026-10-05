import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, NotebookPen, Plus, Unlink, X } from 'lucide-react';
import type { Attribute, Case } from '../../core/model/types';
import { MemoEditor } from '../common/MemoEditor';
import { TABLES } from '../../core/store/schema';
import { updateCase } from '../../services/cases';
import { setDocumentCase } from '../../services/documents';
import { createMemo, memosFor } from '../../services/memos';
import { listDocuments } from '../../services/queries';
import { ServiceError } from '../../services/undo';
import { useProject } from '../../shell/AppState';
import { useRouter } from '../../shell/router';
import { useUndo } from '../../shell/undo';
import { useLive } from '../../shell/useLive';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import { Button, IconButton } from '../../ui/components/Button';
import { ColorPicker } from '../../ui/components/ColorPicker';
import { Spinner } from '../../ui/components/Feedback';
import { Select, TextArea, TextField } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { formatValue, type ValueFormat } from './values';

interface Props {
  caseId: string;
  attrs: Attribute[];
  fmt: ValueFormat;
  onClose: () => void;
}

/** One case in depth: its name, description and colour, documents, coding and memos. */
export function CaseDetail({ caseId, attrs, fmt, onClose }: Props) {
  const { t, tp } = useI18n();
  const project = useProject();
  const { record } = useUndo();
  const { go } = useRouter();
  const toast = useToast();

  const { data } = useLive(
    async (store) => {
      const [c, docs, codes] = await Promise.all([store.get('case', caseId), listDocuments(project), store.list('code')]);
      const mine = docs.filter((d) => d.document.case_id === caseId);
      let byCode: { code_id: string; n: number }[] = [];
      if (mine.length) {
        const ids = mine.map((d) => d.document.id);
        byCode = (
          await store.db.query<{ code_id: string; n: number }>(
            `SELECT code_id, count(*) AS n FROM ${TABLES.coding.table} WHERE deleted = 0 AND document_id IN (${ids.map(() => '?').join(', ')}) GROUP BY code_id ORDER BY n DESC`,
            ids,
          )
        ).map((r) => ({ code_id: r.code_id, n: Number(r.n) }));
      }
      return { c, docs, mine, codes, byCode };
    },
    [caseId],
    ['case', 'document', 'coding', 'code'],
  );

  const c = data?.c && !data.c.deleted ? data.c : null;
  const codeById = useMemo(() => new Map((data?.codes ?? []).map((x) => [x.id, x])), [data]);
  const total = (data?.byCode ?? []).reduce((n, r) => n + r.n, 0);
  const top = (data?.byCode ?? []).slice(0, 8);
  const max = top[0]?.n ?? 1;

  const save = async (patch: Partial<Pick<Case, 'name' | 'description' | 'color'>>): Promise<string | null> => {
    try {
      const { undo } = await updateCase(project, caseId, patch);
      record(undo);
      return null;
    } catch (e) {
      if (e instanceof ServiceError && e.code === 'invalid_argument') return t('cases.errors.name');
      toast.error(e);
      return null;
    }
  };

  const link = async (docId: string, to: string | null) => {
    try {
      const { undo } = await setDocumentCase(project, docId, to);
      record(undo);
    } catch (e) {
      toast.error(e);
    }
  };

  const others = (data?.docs ?? []).filter((d) => d.document.case_id !== caseId);

  return (
    <aside className="cdetail" aria-label={c ? t('cases.detail.label', { name: c.name }) : t('cases.detail.title')} data-testid="case-detail">
      <header className="cdetail__head">
        <span className="cdetail__eyebrow">{t('cases.detail.title')}</span>
        <IconButton icon={X} label={t('common.close')} size="sm" onClick={onClose} data-testid="case-detail-close" />
      </header>
      {!data ? (
        <div className="cdetail__loading">
          <Spinner size={16} label={t('common.loading')} />
        </div>
      ) : !c ? null : (
        <div className="cdetail__body">
          <NameField value={c.name} onSave={(name) => save({ name })} />
          <DescriptionField value={c.description} onSave={(description) => void save({ description })} />

          <section className="cdetail__section">
            <div className="cdetail__colour">
              <ColorPicker value={c.color ?? '#7a7f87'} onChange={(color) => void save({ color })} label={t('common.colour')} custom={false} data-testid="case-colour" />
              {c.color ? (
                <Button size="sm" variant="ghost" onClick={() => void save({ color: null })} data-testid="case-colour-none">
                  {t('cases.detail.noColour')}
                </Button>
              ) : null}
            </div>
          </section>

          {attrs.length ? (
            <section className="cdetail__section" aria-labelledby="cdetail-attrs">
              <h3 className="cdetail__h" id="cdetail-attrs">
                {t('cases.detail.attributes')}
              </h3>
              <dl className="cdetail__attrs">
                {attrs.map((a) => {
                  const v = formatValue(a.type, c.values[a.id], fmt);
                  return (
                    <React.Fragment key={a.id}>
                      <dt>{a.name}</dt>
                      <dd className={cx(!v && 't-muted')}>{v || '—'}</dd>
                    </React.Fragment>
                  );
                })}
              </dl>
            </section>
          ) : null}

          <section className="cdetail__section" aria-labelledby="cdetail-docs">
            <h3 className="cdetail__h" id="cdetail-docs">
              {t('cases.grid.documents')}
              <span className="cdetail__count">{data.mine.length}</span>
            </h3>
            {data.mine.length ? (
              <ul className="cdetail__docs">
                {data.mine.map((d) => (
                  <li key={d.document.id} className="cdetail__doc">
                    <FileText size={14} aria-hidden strokeWidth={1.75} className="cdetail__doc-icon" />
                    <button type="button" className="cdetail__doc-name" onClick={() => go({ name: 'workbench', docId: d.document.id })} data-testid={`case-doc-${d.document.id}`}>
                      {d.document.name}
                    </button>
                    <span className="cdetail__doc-n" title={tp('common.count.codings', d.codings)}>
                      {d.codings}
                    </span>
                    <IconButton icon={Unlink} size="sm" label={t('cases.detail.unlink', { name: d.document.name })} onClick={() => void link(d.document.id, null)} data-testid={`case-unlink-${d.document.id}`} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="cdetail__none">{t('cases.detail.noDocuments')}</p>
            )}
            {others.length ? (
              <Select<string>
                aria-label={t('cases.detail.link')}
                size="sm"
                value=""
                onChange={(id) => id && void link(id, caseId)}
                options={[
                  { value: '', label: t('cases.detail.link') },
                  ...others.map((d) => ({
                    value: d.document.id,
                    label: d.caseName ? t('cases.detail.inCase', { name: d.document.name, case: d.caseName }) : d.document.name,
                  })),
                ]}
                data-testid="case-link-doc"
              />
            ) : null}
          </section>

          <section className="cdetail__section" aria-labelledby="cdetail-codes">
            <h3 className="cdetail__h" id="cdetail-codes">
              {t('cases.detail.byCode')}
              <span className="cdetail__count">{total}</span>
            </h3>
            {top.length ? (
              <ol className="cdetail__codes">
                {top.map((r) => {
                  const code = codeById.get(r.code_id);
                  return (
                    <li key={r.code_id} className="cdetail__code">
                      <span className="cdetail__code-name">
                        <span className="cdetail__code-dot" style={{ background: code?.color ?? 'var(--ink-4)' }} aria-hidden />
                        <span className="cdetail__code-text">{code?.name ?? '—'}</span>
                      </span>
                      <span className="cdetail__bar" aria-hidden>
                        <span style={{ width: `${Math.max(4, (r.n / max) * 100)}%`, background: code?.color ?? 'var(--ink-4)' }} />
                      </span>
                      <span className="cdetail__code-n">{r.n}</span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="cdetail__none">{t('cases.detail.noCodings')}</p>
            )}
            {data.byCode.length > top.length ? <p className="cdetail__more">{t('cases.detail.moreCodes', { n: data.byCode.length - top.length })}</p> : null}
          </section>

          <CaseMemos caseId={caseId} />
        </div>
      )}
    </aside>
  );
}

function NameField({ value, onSave }: { value: string; onSave: (name: string) => Promise<string | null> }) {
  const { t } = useI18n();
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  const commit = async () => {
    if (text.trim() === value) return setError(null);
    setError(await onSave(text));
  };
  return (
    <TextField
      label={t('common.name')}
      value={text}
      onChange={setText}
      error={error}
      className="cdetail__name"
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        void commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void commit();
        } else if (e.key === 'Escape') {
          setText(value);
          setError(null);
        }
      }}
      data-testid="case-detail-name"
    />
  );
}

function DescriptionField({ value, onSave }: { value: string; onSave: (s: string) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  return (
    <TextArea
      label={t('common.description')}
      value={text}
      onChange={setText}
      autoGrow
      minHeight={60}
      maxHeight={240}
      placeholder={t('cases.detail.descriptionPlaceholder')}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        if (text !== value) onSave(text);
      }}
      data-testid="case-detail-description"
    />
  );
}

/** The memos about this case: a list, a new one at the top, each editable in place. */
function CaseMemos({ caseId }: { caseId: string }) {
  const { t, relative } = useI18n();
  const project = useProject();
  const { record } = useUndo();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const { data: memos } = useLive(() => memosFor(project, { kind: 'case', id: caseId }), [caseId], ['memo']);

  const add = async () => {
    try {
      const { memo, undo } = await createMemo(project, { target: { kind: 'case', id: caseId }, title: '' });
      record(undo);
      setFresh(memo.id);
      setOpenId(memo.id);
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <section className="cdetail__section" aria-labelledby="cdetail-memos">
      <h3 className="cdetail__h" id="cdetail-memos">
        {t('app.nav.memos')}
        <span className="cdetail__count">{memos?.length ?? 0}</span>
        <Button size="sm" variant="ghost" icon={Plus} className="cdetail__h-action" onClick={() => void add()} data-testid="case-memo-add">
          {t('cases.memos.add')}
        </Button>
      </h3>
      {memos && memos.length === 0 ? <p className="cdetail__none">{t('cases.memos.none')}</p> : null}
      <ul className="cdetail__memos">
        {(memos ?? []).map((m) =>
          openId === m.id ? (
            <li key={m.id} className="cdetail__memo cdetail__memo--open">
              <MemoEditor memoId={m.id} compact autoFocusTitle={fresh === m.id} onDeleted={() => setOpenId(null)} />
              <div className="cdetail__memo-actions">
                <Button size="sm" onClick={() => setOpenId(null)} data-testid="case-memo-done">
                  {t('common.done')}
                </Button>
              </div>
            </li>
          ) : (
            <li key={m.id} className="cdetail__memo">
              <button type="button" className="cdetail__memo-btn" onClick={() => setOpenId(m.id)} data-testid={`case-memo-${m.id}`}>
                <NotebookPen size={14} aria-hidden strokeWidth={1.75} className="cdetail__memo-icon" />
                <span className="cdetail__memo-text">
                  <span className="cdetail__memo-title">{m.title || t('common.untitled')}</span>
                  {m.body ? <span className="cdetail__memo-body">{m.body.slice(0, 160)}</span> : null}
                </span>
                <span className="cdetail__memo-when">{relative(m.created_at)}</span>
              </button>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

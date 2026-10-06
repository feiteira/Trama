import React, { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { ArrowRight, Eye, FileDown, KeyRound, Pencil, Plus, ShieldCheck, Sparkles, Trash2, VenetianMask, Wand2 } from 'lucide-react';
import type { Pseudonym } from '../../core/model/types';
import { csvBytes } from '../../core/export/office/csv';
import { deletePseudonym, listPseudonyms, preview as previewKey, type Preview, type PreviewSample } from '../../services/pseudonyms';
import { usePlatform, useProject } from '../../shell/AppState';
import { ScreenHeader } from '../../shell/ScreenHeader';
import type { ScreenProps } from '../../shell/router';
import { useUndo } from '../../shell/undo';
import { useCommands } from '../../shell/useCommands';
import { useLive } from '../../shell/useLive';
import { cx } from '../../ui/cx';
import { useI18n } from '../../ui/i18n';
import { Button, IconButton } from '../../ui/components/Button';
import { Checkbox } from '../../ui/components/Choice';
import { useConfirm } from '../../ui/components/Confirm';
import { EmptyState, Notice, Spinner } from '../../ui/components/Feedback';
import { useToast } from '../../ui/components/Toast';
import { csvDelimiter, saveExport, stamp } from '../log/exportFile';
import { ApplyDialog } from './ApplyDialog';
import { EntryDialog } from './EntryDialog';
import { fieldName, groupFields, keyRows, trimContext } from './key';
import { SuggestDialog } from './SuggestDialog';
import './pseudonyms.css';

/** Pseudonymisation: the key (original → replacement), suggestions, a preview, and applying it. */
export default function PseudonymsScreen(_props: ScreenProps<'pseudonyms'>) {
  const { t, tp, locale, date, time } = useI18n();
  const project = useProject();
  const platform = usePlatform();
  const { record } = useUndo();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Pseudonym | 'new' | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [preview, setPreview] = useState<{ result: Preview; ids: string[] | undefined } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);

  const { data: entries } = useLive(() => listPseudonyms(project), [], ['pseudonym']);
  const byId = useMemo(() => new Map((entries ?? []).map((p) => [p.id, p])), [entries]);
  const live = useMemo(() => new Set([...checked].filter((id) => byId.has(id))), [checked, byId]);
  // With nothing ticked, preview and apply use the whole key.
  const scope = live.size ? [...live] : undefined;
  const scopeCount = live.size || entries?.length || 0;

  const runPreview = async () => {
    setPreviewing(true);
    try {
      setPreview({ result: await previewKey(project, scope), ids: scope });
    } catch (e) {
      toast.error(e);
    } finally {
      setPreviewing(false);
    }
  };

  const startApply = async () => {
    // The confirmation states what will change, so it always works from a fresh preview.
    setPreviewing(true);
    try {
      const result = await previewKey(project, scope);
      setPreview({ result, ids: scope });
      if (result.total === 0) {
        toast.show(t('pseudonyms.preview.nothing'));
        return;
      }
      setApplying(true);
    } catch (e) {
      toast.error(e);
    } finally {
      setPreviewing(false);
    }
  };

  const remove = async (p: Pseudonym) => {
    const ok = await confirm({
      title: t('pseudonyms.delete.title', { name: p.original }),
      body: t('pseudonyms.delete.body'),
      confirmLabel: t('pseudonyms.delete.confirm'),
      danger: true,
      'data-testid': 'delete-pseudonym-dialog',
    });
    if (!ok) return;
    try {
      record(await deletePseudonym(project, p.id, { erase: true }));
      setPreview(null);
    } catch (e) {
      toast.error(e);
    }
  };

  const exportKey = async () => {
    if (!entries?.length) return;
    const word = t('pseudonyms.export.word');
    const ok = await confirm({
      title: t('pseudonyms.export.title'),
      body: (
        <div className="pkey-export">
          <p>{t('pseudonyms.export.body')}</p>
          <p className="pkey-export__strong">{t('pseudonyms.export.warning')}</p>
        </div>
      ),
      confirmLabel: t('pseudonyms.export.confirm'),
      danger: true,
      typeToConfirm: word,
      typePrompt: t('pseudonyms.export.type', { word }),
      'data-testid': 'export-key-dialog',
    });
    if (!ok) return;
    try {
      const rows = keyRows(
        entries,
        {
          original: t('pseudonyms.cols.original'),
          replacement: t('pseudonyms.cols.replacement'),
          wholeWord: t('pseudonyms.cols.wholeWord'),
          caseSensitive: t('pseudonyms.cols.caseSensitive'),
          note: t('pseudonyms.cols.note'),
          appliedAt: t('pseudonyms.cols.appliedAt'),
          appliedCount: t('pseudonyms.cols.appliedCount'),
        },
        t('common.yes'),
        t('common.no'),
      );
      const file = await saveExport(platform, {
        title: t('pseudonyms.export.title'),
        defaultName: `${t('pseudonyms.export.fileName')} ${stamp()}.csv`,
        filter: { name: 'CSV', extensions: ['csv'] },
        bytes: () => csvBytes(rows, { delimiter: csvDelimiter(locale) }),
      });
      if (file) {
        // The audit trail says the key left the project, never what is in it.
        await project.log('export', `"${file}" (pseudonyms)`);
        toast.show({ message: t('pseudonyms.export.done', { file }), tone: 'success' });
      }
    } catch (e) {
      toast.error(e);
    }
  };

  useCommands(
    () => [
      { id: 'pseudonyms.add', label: t('pseudonyms.add'), group: t('app.nav.pseudonyms'), icon: Plus, run: () => setEditing('new') },
      { id: 'pseudonyms.suggest', label: t('pseudonyms.suggest.button'), group: t('app.nav.pseudonyms'), icon: Sparkles, run: () => setSuggesting(true) },
      { id: 'pseudonyms.preview', label: t('pseudonyms.preview.button'), group: t('app.nav.pseudonyms'), icon: Eye, run: () => void runPreview(), disabled: !entries?.length },
      { id: 'pseudonyms.export', label: t('pseudonyms.export.button'), group: t('app.nav.pseudonyms'), icon: FileDown, run: () => void exportKey(), disabled: !entries?.length },
    ],
    [t, entries, scope?.join(',')],
  );

  const all = !!entries?.length && entries.every((p) => live.has(p.id));
  const some = !all && live.size > 0;
  const replacementOf = (id: string) => byId.get(id)?.replacement ?? '';

  return (
    <>
      <ScreenHeader
        title={t('app.nav.pseudonyms')}
        subtitle={entries ? tp('pseudonyms.count', entries.length) : undefined}
        actions={
          <>
            <Button icon={Sparkles} onClick={() => setSuggesting(true)} data-testid="pseudonyms-suggest">
              {t('pseudonyms.suggest.button')}
            </Button>
            <Button variant="primary" icon={Plus} onClick={() => setEditing('new')} data-testid="pseudonyms-add">
              {t('pseudonyms.add')}
            </Button>
          </>
        }
      />
      <div className="pseudo" data-testid="screen-pseudonyms">
        <div className="pseudo__column">
          <div className="pseudo__intro">
            <div className="pseudo__intro-icon" aria-hidden>
              <VenetianMask size={20} strokeWidth={1.5} />
            </div>
            <div>
              <p className="pseudo__intro-lead">{t('pseudonyms.intro.lead')}</p>
              <p className="pseudo__intro-body">
                <ShieldCheck size={14} aria-hidden strokeWidth={1.75} />
                <span>{t('pseudonyms.intro.key')}</span>
              </p>
            </div>
          </div>

          {!entries ? (
            <div className="pseudo__loading">
              <Spinner size={18} label={t('common.loading')} />
            </div>
          ) : entries.length === 0 ? (
            <EmptyState
              icon={VenetianMask}
              title={t('pseudonyms.empty.title')}
              className="pseudo__empty"
              data-testid="pseudonyms-empty"
              actions={
                <>
                  <Button variant="primary" icon={Sparkles} onClick={() => setSuggesting(true)}>
                    {t('pseudonyms.suggest.button')}
                  </Button>
                  <Button icon={Plus} onClick={() => setEditing('new')}>
                    {t('pseudonyms.add')}
                  </Button>
                </>
              }
            >
              {t('pseudonyms.empty.body')}
            </EmptyState>
          ) : (
            <>
              <section className="pkey" aria-labelledby="pkey-title">
                <div className="pkey__bar">
                  <h2 className="pkey__title" id="pkey-title">
                    {t('pseudonyms.key')}
                  </h2>
                  <span className="pkey__scope">{live.size ? tp('pseudonyms.scopeSome', live.size) : t('pseudonyms.scopeAll')}</span>
                  <div className="pkey__actions">
                    <Button variant="ghost" icon={KeyRound} onClick={() => void exportKey()} data-testid="pseudonyms-export">
                      {t('pseudonyms.export.button')}
                    </Button>
                    <Button icon={Eye} onClick={() => void runPreview()} busy={previewing && !applying} data-testid="pseudonyms-preview">
                      {t('pseudonyms.preview.button')}
                    </Button>
                    <Button variant="danger" icon={Wand2} onClick={() => void startApply()} data-testid="pseudonyms-apply">
                      {live.size ? tp('pseudonyms.apply.buttonSome', live.size) : t('pseudonyms.apply.button')}
                    </Button>
                  </div>
                </div>
                <div className="pkey__wrap">
                  <table className="pkey__table" aria-labelledby="pkey-title">
                    <thead>
                      <tr>
                        <th className="pkey__sel">
                          <Checkbox
                            checked={all}
                            indeterminate={some}
                            onChange={(on) => setChecked(on ? new Set(entries.map((p) => p.id)) : new Set())}
                            label={<span className="visually-hidden">{t('pseudonyms.selectAll')}</span>}
                            data-testid="pseudonyms-select-all"
                          />
                        </th>
                        <th>{t('pseudonyms.cols.original')}</th>
                        <th>{t('pseudonyms.cols.replacement')}</th>
                        <th className="pkey__flag">{t('pseudonyms.cols.wholeWordShort')}</th>
                        <th className="pkey__flag">{t('pseudonyms.cols.caseShort')}</th>
                        <th>{t('pseudonyms.cols.note')}</th>
                        <th>{t('pseudonyms.cols.lastApplied')}</th>
                        <th className="pkey__act">
                          <span className="visually-hidden">{t('pseudonyms.cols.actions')}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((p) => (
                        <tr key={p.id} className={cx(live.has(p.id) && 'pkey__row--on')} data-testid={`pseudonym-row-${p.id}`}>
                          <td className="pkey__sel">
                            <Checkbox
                              checked={live.has(p.id)}
                              onChange={(on) =>
                                setChecked((cur) => {
                                  const next = new Set(cur);
                                  on ? next.add(p.id) : next.delete(p.id);
                                  return next;
                                })
                              }
                              label={<span className="visually-hidden">{t('pseudonyms.select', { name: p.original })}</span>}
                              data-testid={`pseudonym-check-${p.id}`}
                            />
                          </td>
                          <td className="pkey__orig">{p.original}</td>
                          <td>
                            <span className="pkey__to">
                              <ArrowRight size={14} aria-hidden className="pkey__arrow" />
                              <span className="pkey__repl">{p.replacement}</span>
                            </span>
                          </td>
                          <td className="pkey__flag">{p.whole_word ? t('common.yes') : t('common.no')}</td>
                          <td className="pkey__flag">{p.case_sensitive ? t('common.yes') : t('common.no')}</td>
                          <td className="pkey__note">{p.note || <span className="t-muted">—</span>}</td>
                          <td className="pkey__applied">
                            {p.applied_at ? (
                              <>
                                <span>{date(DateTime.fromISO(p.applied_at), 'medium')}, {time(DateTime.fromISO(p.applied_at))}</span>
                                <span className="pkey__applied-n">{tp('pseudonyms.apply.replacements', p.applied_count)}</span>
                              </>
                            ) : (
                              <span className="t-muted">{t('pseudonyms.notApplied')}</span>
                            )}
                          </td>
                          <td className="pkey__act">
                            <IconButton icon={Pencil} size="sm" label={t('pseudonyms.edit', { name: p.original })} onClick={() => setEditing(p)} data-testid={`pseudonym-edit-${p.id}`} />
                            <IconButton icon={Trash2} size="sm" label={t('pseudonyms.delete.label', { name: p.original })} onClick={() => void remove(p)} data-testid={`pseudonym-delete-${p.id}`} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {preview ? <PreviewPanel preview={preview.result} replacementOf={replacementOf} onClose={() => setPreview(null)} /> : null}
            </>
          )}
        </div>
      </div>

      {editing ? <EntryDialog entry={editing === 'new' ? null : editing} entries={entries ?? []} onClose={() => setEditing(null)} /> : null}
      {suggesting ? <SuggestDialog entries={entries ?? []} onClose={() => setSuggesting(false)} /> : null}
      {applying && preview ? (
        <ApplyDialog
          preview={preview.result}
          ids={preview.ids}
          entryCount={scopeCount}
          onClose={() => {
            setApplying(false);
            setPreview(null);
          }}
        />
      ) : null}
    </>
  );
}

export function PreviewPanel({ preview, replacementOf, onClose }: { preview: Preview; replacementOf: (id: string) => string; onClose: () => void }) {
  const { t, tp } = useI18n();
  const elsewhere = preview.total - preview.textTotal;
  const groups = groupFields(preview.fields);
  const words = (s: PreviewSample) => {
    const ctx = trimContext(s.before, s.after);
    return (
      <>
        <span className="pprev__ctx">{ctx.before}</span>
        <del className="pprev__old">{s.match}</del>
        <ins className="pprev__new">{replacementOf(s.pseudonymId)}</ins>
        <span className="pprev__ctx">{ctx.after}</span>
      </>
    );
  };
  const sample = (s: PreviewSample, key: React.Key) => (
    <li key={key} className="pprev__sample">
      {words(s)}
    </li>
  );
  return (
    <section className="pprev" aria-labelledby="pprev-title" data-testid="pseudonyms-preview-panel">
      <div className="pprev__bar">
        <h2 className="pprev__title" id="pprev-title">
          {t('pseudonyms.preview.title')}
        </h2>
        <span className="pprev__total" data-testid="preview-total">
          {preview.total
            ? [
                preview.textTotal ? t('pseudonyms.preview.total', { replacements: tp('pseudonyms.apply.replacements', preview.textTotal), documents: tp('common.count.documents', preview.documents.length) }) : null,
                elsewhere ? (preview.textTotal ? tp('pseudonyms.preview.elsewhere', elsewhere) : tp('pseudonyms.apply.replacements', elsewhere)) : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : t('pseudonyms.preview.nothing')}
        </span>
        <Button size="sm" variant="ghost" onClick={onClose} className="pprev__close" data-testid="preview-close">
          {t('common.close')}
        </Button>
      </div>
      {preview.logEntries ? (
        <Notice tone="warning" title={tp('pseudonyms.preview.logTitle', preview.logEntries)} data-testid="preview-log-warning">
          {t('pseudonyms.preview.logBody')}
        </Notice>
      ) : null}
      {preview.documents.length ? (
        <ul className="pprev__docs">
          {preview.documents.map((d) => (
            <li key={d.documentId} className="pprev__doc">
              <div className="pprev__doc-head">
                <span className="pprev__doc-name">{d.name}</span>
                <span className="pprev__doc-n">{tp('pseudonyms.apply.replacements', d.count)}</span>
              </div>
              <ul className="pprev__samples">
                {d.samples.map((s, i) => sample(s, i))}
                {d.count > d.samples.length ? <li className="pprev__more">{tp('pseudonyms.preview.more', d.count - d.samples.length)}</li> : null}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
      {groups.length ? (
        <div className="pprev__fields" data-testid="preview-fields">
          <h3 className="pprev__subtitle">{t('pseudonyms.preview.elsewhereTitle')}</h3>
          <p className="pprev__hint">{t('pseudonyms.preview.elsewhereHint')}</p>
          <ul className="pprev__docs">
            {groups.map((g) => (
              <li key={g.kind} className="pprev__doc" data-testid={`preview-fields-${g.kind}`}>
                <div className="pprev__doc-head">
                  <span className="pprev__doc-name">{t(`pseudonyms.preview.fieldKinds.${g.kind}`)}</span>
                  <span className="pprev__doc-n">{tp('pseudonyms.apply.replacements', g.count)}</span>
                </div>
                <ul className="pprev__samples">
                  {g.fields.slice(0, FIELDS_SHOWN).map((f) => (
                    <li key={`${f.id}:${f.field}`} className="pprev__field">
                      <span className="pprev__field-where">
                        {f.label ? <span className="pprev__field-label">{f.label}</span> : null}
                        <span className="pprev__field-name">{t(`pseudonyms.preview.fieldNames.${fieldName(f.field)}`)}</span>
                      </span>
                      <div className="pprev__sample">{words(f.sample)}</div>
                    </li>
                  ))}
                  {g.fields.length > FIELDS_SHOWN ? <li className="pprev__more">{tp('pseudonyms.preview.moreFields', g.fields.length - FIELDS_SHOWN)}</li> : null}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

// Places listed per kind of record; the rest are counted.
const FIELDS_SHOWN = 8;

import React, { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useI18n } from '../../ui/i18n';
import { Button } from '../../ui/components/Button';
import { Checkbox } from '../../ui/components/Choice';
import { Dialog } from '../../ui/components/Dialog';
import { Badge, Notice } from '../../ui/components/Feedback';
import { TextField } from '../../ui/components/Field';
import { codeChoices, subtreeIds, type TreeItem } from '../common/codeTree';
import { CodePickList } from '../common/CodeTreeDialogs';
import type { MergeField, MergePlan } from './codebookIO';
import './codes.css';

// ---------------------------------------------------------------------------------------------
// Merge several codes into one

export function MergeCodesDialog({
  items,
  initialSources,
  onCancel,
  onConfirm,
}: {
  items: readonly TreeItem[];
  initialSources: string[];
  onCancel: () => void;
  onConfirm: (sources: string[], target: string) => Promise<void>;
}) {
  const { t, tp } = useI18n();
  const [sources, setSources] = useState<Set<string>>(() => new Set(initialSources));
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const all = useMemo(() => codeChoices(items), [items]);
  const targetChoices = useMemo(() => all.filter((c) => !sources.has(c.id)), [all, sources]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const moving = [...sources].reduce((n, id) => n + (byId.get(id)?.own ?? 0), 0);
  const children = useMemo(() => {
    let n = 0;
    for (const id of sources) for (const x of subtreeIds(items, id)) if (x !== id && !sources.has(x)) n++;
    return n;
  }, [sources, items]);
  const targetItem = target && !sources.has(target) ? byId.get(target) : undefined;
  const ready = sources.size > 0 && targetItem !== undefined;

  const toggle = (id: string) =>
    setSources((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await onConfirm([...sources], targetItem.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onCancel}
      size="xl"
      title={t('codes.merge.title')}
      description={t('codes.merge.description')}
      dismissible={!busy}
      data-testid="merge-codes-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!ready} busy={busy} onClick={() => void submit()} data-testid="merge-codes-confirm">
            {sources.size ? tp('codes.merge.confirm', sources.size) : t('codes.merge.confirmNone')}
          </Button>
        </>
      }
    >
      <div className="cmerge">
        <div className="cmerge__col">
          <h3 className="cmerge__label">
            <span className="cmerge__step">1</span>
            {t('codes.merge.sources')}
            {sources.size ? <Badge tone="info">{sources.size}</Badge> : null}
          </h3>
          <CodePickList choices={all} values={sources} onToggle={toggle} label={t('codes.merge.sources')} aside={(c) => byId.get(c.id)?.own ?? 0} height={300} autoFocus data-testid="merge-sources" />
        </div>
        <ArrowRight size={18} className="cmerge__arrow" aria-hidden />
        <div className="cmerge__col">
          <h3 className="cmerge__label">
            <span className="cmerge__step">2</span>
            {t('codes.merge.target')}
          </h3>
          <CodePickList choices={targetChoices} value={target} onChange={setTarget} label={t('codes.merge.target')} aside={(c) => byId.get(c.id)?.own ?? 0} height={300} data-testid="merge-target" />
        </div>
      </div>
      <p className="codedialog__consequence cmerge__preview" aria-live="polite" data-testid="merge-codes-preview">
        {ready
          ? [tp('codes.merge.previewMove', moving, { target: targetItem.name }), tp('codes.merge.previewDelete', sources.size), children ? tp('codes.merge.previewChildren', children) : '']
              .filter(Boolean)
              .join(' ')
          : t('codes.merge.previewNone')}
      </p>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Split: move chosen coded segments into a new sub-code

export function SplitCodeDialog({ parentName, count, onCancel, onConfirm }: { parentName: string; count: number; onCancel: () => void; onConfirm: (name: string) => Promise<void> }) {
  const { t, tp } = useI18n();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await onConfirm(name.trim());
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onCancel}
      size="sm"
      title={t('codes.split.title', { name: parentName })}
      dismissible={!busy}
      onSubmit={() => void submit()}
      data-testid="split-code-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim()} busy={busy} data-testid="split-code-confirm">
            {t('codes.split.confirm')}
          </Button>
        </>
      }
    >
      <div className="codedialog__stack">
        <TextField label={t('codes.split.name')} value={name} onChange={setName} maxLength={120} data-autofocus data-testid="split-code-name" />
        <p className="codedialog__consequence">{tp('codes.split.preview', count, { name: parentName })}</p>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Import preview

const FIELD_KEY: Record<MergeField, 'codes.fields.colour' | 'codes.fields.category' | 'codes.fields.description' | 'codes.fields.inclusion' | 'codes.fields.exclusion' | 'codes.fields.example'> = {
  color: 'codes.fields.colour',
  codable: 'codes.fields.category',
  description: 'codes.fields.description',
  inclusion: 'codes.fields.inclusion',
  exclusion: 'codes.fields.exclusion',
  example: 'codes.fields.example',
};

export function ImportCodebookDialog({
  fileName,
  plan,
  skipped,
  warnings,
  quotes,
  overwrite,
  onOverwrite,
  onCancel,
  onConfirm,
}: {
  fileName: string;
  plan: MergePlan;
  skipped: number;
  warnings: string[];
  /** Why the file may have lost rows (unbalanced quotes): importing waits for the researcher to confirm. */
  quotes?: string;
  overwrite: boolean;
  onOverwrite: (v: boolean) => void;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t, tp } = useI18n();
  const [busy, setBusy] = useState(false);
  const [quotesChecked, setQuotesChecked] = useState(false);
  const changes = plan.created + plan.updated;
  const blocked = !!quotes && !quotesChecked;
  const shown = plan.items.slice(0, 400);
  const submit = async () => {
    if (busy || !changes || blocked) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onCancel}
      size="lg"
      title={t('codes.import.title')}
      description={fileName}
      dismissible={!busy}
      data-testid="import-codebook-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!changes || blocked} busy={busy} onClick={() => void submit()} data-testid="import-codebook-confirm">
            {t('codes.import.confirm')}
          </Button>
        </>
      }
    >
      <div className="codedialog__stack">
        <div className="cimport__summary" data-testid="import-codebook-summary">
          <span className="cimport__stat cimport__stat--new">
            <strong>{plan.created}</strong> {tp('codes.import.new', plan.created)}
          </span>
          <span className="cimport__stat cimport__stat--update">
            <strong>{plan.updated}</strong> {tp('codes.import.updated', plan.updated)}
          </span>
          <span className="cimport__stat">
            <strong>{plan.unchanged}</strong> {tp('codes.import.unchanged', plan.unchanged)}
          </span>
        </div>
        <Checkbox checked={overwrite} onChange={onOverwrite} label={t('codes.import.overwrite')} description={t('codes.import.overwriteHint')} data-testid="import-codebook-overwrite" />
        {quotes ? (
          <Notice tone="warning" data-testid="import-codebook-quotes">
            <p>{quotes}</p>
            <Checkbox checked={quotesChecked} onChange={setQuotesChecked} label={t('codes.import.quotesConfirm')} data-testid="import-codebook-quotes-confirm" />
          </Notice>
        ) : null}
        {skipped ? <Notice tone="warning">{tp('codes.import.skipped', skipped)}</Notice> : null}
        {warnings.map((w) => (
          <Notice key={w} tone="info">
            {w}
          </Notice>
        ))}
        <div className="cimport__list" role="list" aria-label={t('codes.import.listLabel')}>
          {shown.map((it) => (
            <div key={it.path.join('\u0000')} role="listitem" className="cimport__row">
              <Badge tone={it.status === 'new' ? 'success' : it.status === 'update' ? 'info' : 'neutral'}>{t(`codes.import.status.${it.status}`)}</Badge>
              <span className="cimport__path">
                {it.fields.color ? <span className="codepick__dot" style={{ background: it.fields.color }} aria-hidden /> : null}
                {it.path.length > 1 ? <span className="t-muted">{it.path.slice(0, -1).join(' › ')} › </span> : null}
                {it.path[it.path.length - 1]}
              </span>
              <span className="cimport__fields">
                {it.status === 'update' ? (Object.keys(it.fields) as MergeField[]).map((f) => t(FIELD_KEY[f])).join(', ') : it.implicit ? t('codes.import.implicit') : ''}
              </span>
            </div>
          ))}
          {plan.items.length > shown.length ? <p className="t-muted t-small">{tp('codes.import.more', plan.items.length - shown.length)}</p> : null}
        </div>
      </div>
    </Dialog>
  );
}

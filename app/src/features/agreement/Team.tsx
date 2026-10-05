import React, { useEffect, useRef, useState } from 'react';
import { ArrowRightLeft, FileOutput, GitMerge, Pencil, Plus, Send, UserCheck, Users } from 'lucide-react';
import { addCoder, nextCoderColor, recolourCoder, renameCoder } from '../../services/coders';
import { listCoders } from '../../services/queries';
import { ServiceError } from '../../services/undo';
import { useProject } from '../../shell/AppState';
import { useLive } from '../../shell/useLive';
import { useUndo } from '../../shell/undo';
import { initial } from '../../shell/initial';
import { inkOn } from '../../ui/color';
import { Button, IconButton } from '../../ui/components/Button';
import { ColorPicker } from '../../ui/components/ColorPicker';
import { useConfirm } from '../../ui/components/Confirm';
import { Dialog } from '../../ui/components/Dialog';
import { Badge, Spinner } from '../../ui/components/Feedback';
import { TextField } from '../../ui/components/Field';
import { Popover } from '../../ui/components/Popover';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import { CopyDialog } from './CopyDialog';
import { MergeDialog } from './MergeDialog';
import { fmtInt } from './model';

type Row = Awaited<ReturnType<typeof listCoders>>[number];

const sameName = (x: string, y: string) => x.trim().toLocaleLowerCase() === y.trim().toLocaleLowerCase();

/** Coders of the project, and working as a team with copies instead of a cloud. */
export function Team({ onCompare }: { onCompare: () => void }) {
  const { t } = useI18n();
  const project = useProject();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, reload } = useLive(() => listCoders(project), [], ['coder', 'coding']);
  const [adding, setAdding] = useState(false);
  const [copying, setCopying] = useState(false);
  const [merging, setMerging] = useState(false);
  const rows = data ?? [];

  async function setMe(row: Row) {
    const ok = await confirm({
      title: t('agreement.team.setMeTitle', { name: row.coder.name }),
      body: t('agreement.team.setMeBody', { name: row.coder.name }),
      confirmLabel: t('agreement.team.setMeConfirm', { name: row.coder.name }),
      'data-testid': 'agreement-set-me-dialog',
    });
    if (!ok) return;
    try {
      await project.setMe(row.coder.id);
      reload();
      toast.show({ message: t('agreement.team.setMeDone', { name: row.coder.name }), tone: 'success' });
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <div className="agr-team">
      <section className="agr-team__section" aria-labelledby="agr-coders">
        <div className="agr-team__head">
          <div>
            <h2 className="agr-section__title" id="agr-coders">
              {t('agreement.team.codersTitle')}
            </h2>
            <p className="agr-section__sub agr-team__lede">{t('agreement.team.codersBody')}</p>
          </div>
          <Button variant="secondary" icon={Plus} onClick={() => setAdding(true)} data-testid="agreement-add-coder">
            {t('agreement.team.add')}
          </Button>
        </div>
        {data === undefined ? (
          <div className="agr-loading">
            <Spinner label={t('common.loading')} />
          </div>
        ) : (
          <ul className="agr-coders" data-testid="agreement-coders">
            {rows.map((row) => (
              <CoderRow key={row.coder.id} row={row} rows={rows} onSetMe={() => void setMe(row)} onChanged={reload} />
            ))}
          </ul>
        )}
        <p className="agr-team__note">
          <UserCheck size={14} aria-hidden />
          {t('agreement.team.meExplain')}
        </p>
      </section>

      <section className="agr-team__section" aria-labelledby="agr-teamwork">
        <div>
          <h2 className="agr-section__title" id="agr-teamwork">
            {t('agreement.team.teamTitle')}
          </h2>
          <p className="agr-section__sub agr-team__lede">{t('agreement.team.teamBody')}</p>
        </div>
        <ol className="agr-steps">
          <li className="agr-step">
            <span className="agr-step__icon" aria-hidden>
              <Send size={16} strokeWidth={1.75} />
            </span>
            <h3 className="agr-step__title">{t('agreement.team.step1Title')}</h3>
            <p className="agr-step__body">{t('agreement.team.step1')}</p>
          </li>
          <li className="agr-step">
            <span className="agr-step__icon" aria-hidden>
              <Users size={16} strokeWidth={1.75} />
            </span>
            <h3 className="agr-step__title">{t('agreement.team.step2Title')}</h3>
            <p className="agr-step__body">{t('agreement.team.step2')}</p>
          </li>
          <li className="agr-step">
            <span className="agr-step__icon" aria-hidden>
              <GitMerge size={16} strokeWidth={1.75} />
            </span>
            <h3 className="agr-step__title">{t('agreement.team.step3Title')}</h3>
            <p className="agr-step__body">{t('agreement.team.step3')}</p>
          </li>
        </ol>
        <div className="agr-team__actions">
          <Button variant="primary" icon={FileOutput} onClick={() => setCopying(true)} data-testid="agreement-make-copy">
            {t('agreement.team.makeCopy')}
          </Button>
          <Button variant="secondary" icon={ArrowRightLeft} onClick={() => setMerging(true)} data-testid="agreement-merge">
            {t('agreement.team.merge')}
          </Button>
        </div>
      </section>

      <AddCoderDialog open={adding} onClose={() => setAdding(false)} rows={rows} onAdded={reload} />
      <CopyDialog open={copying} onClose={() => setCopying(false)} />
      <MergeDialog
        open={merging}
        onClose={() => setMerging(false)}
        onCompare={() => {
          setMerging(false);
          onCompare();
        }}
      />
    </div>
  );
}

function CoderRow({ row, rows, onSetMe, onChanged }: { row: Row; rows: readonly Row[]; onSetMe: () => void; onChanged: () => void }) {
  const { t, tp, meta } = useI18n();
  const project = useProject();
  const toast = useToast();
  const { record } = useUndo();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(row.coder.name);
  const [error, setError] = useState<string | null>(null);
  const [colouring, setColouring] = useState(false);
  const swatch = useRef<HTMLButtonElement>(null);
  const { coder } = row;

  async function save() {
    const next = name.trim();
    if (!next) return setError(t('agreement.team.nameRequired'));
    if (rows.some((r) => r.coder.id !== coder.id && sameName(r.coder.name, next))) return setError(t('agreement.team.duplicate', { name: next }));
    try {
      if (next !== coder.name) record((await renameCoder(project, coder.id, next)).undo);
      setEditing(false);
      setError(null);
      onChanged();
    } catch (e) {
      if (e instanceof ServiceError && e.code === 'duplicate') setError(t('agreement.team.duplicate', { name: next }));
      else toast.error(e);
    }
  }

  // A native colour picker reports every step of a drag: show each at once, but save (one undo
  // step, one log entry) only once the colour settles.
  const [preview, setPreview] = useState<string | null>(null);
  const pending = useRef<{ color: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const flush = useRef<() => void>(() => undefined);
  flush.current = () => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    recolourCoder(project, coder.id, p.color)
      .then((r) => record(r.undo))
      .catch((e: unknown) => toast.error(e))
      .finally(() => setPreview((c) => (c === p.color ? null : c)));
  };
  useEffect(() => () => flush.current(), []);
  function recolour(color: string) {
    setPreview(color);
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = { color, timer: setTimeout(() => flush.current(), 400) };
  }
  const shown = preview ?? coder.color;

  return (
    <li className="agr-coders__item" data-testid="agreement-coder-row">
      <button
        ref={swatch}
        type="button"
        className="agr-avatar"
        style={{ background: shown, color: inkOn(shown) }}
        onClick={() => setColouring((o) => !o)}
        aria-label={t('agreement.team.recolour', { name: coder.name })}
        aria-haspopup="dialog"
        aria-expanded={colouring}
        title={t('agreement.team.recolour', { name: coder.name })}
        data-testid="agreement-coder-colour"
      >
        {initial(coder.name)}
      </button>
      <Popover
        open={colouring}
        onClose={() => {
          setColouring(false);
          flush.current();
        }}
        anchor={swatch}
        padded
        aria-label={t('agreement.team.recolour', { name: coder.name })}
      >
        <ColorPicker
          value={shown}
          onChange={recolour}
          label={t('agreement.team.recolour', { name: coder.name })}
          data-testid="agreement-coder-colour-picker"
        />
      </Popover>
      <div className="agr-coders__main">
        {editing ? (
          <form
            className="agr-coders__rename"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <TextField
              aria-label={t('agreement.team.nameLabel')}
              value={name}
              onChange={(v) => {
                setName(v);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditing(false);
                  setName(coder.name);
                  setError(null);
                }
              }}
              onBlur={() => void save()}
              error={error ?? undefined}
              maxLength={200}
              size="sm"
              autoFocus
              data-testid="agreement-coder-name"
            />
          </form>
        ) : (
          <div className="agr-coders__name">
            {coder.name}
            {row.isMe ? (
              <Badge tone="info" className="agr-coders__me">
                {t('agreement.team.me')}
              </Badge>
            ) : null}
          </div>
        )}
        <div className="agr-coders__count t-tabular">{tp('agreement.team.segments', row.codings, { n: fmtInt(row.codings, meta.bcp47) })}</div>
      </div>
      <div className="agr-coders__actions">
        {!editing ? (
          <IconButton
            icon={Pencil}
            size="sm"
            label={t('agreement.team.rename', { name: coder.name })}
            onClick={() => {
              setName(coder.name);
              setEditing(true);
            }}
            data-testid="agreement-coder-rename"
          />
        ) : null}
        {!row.isMe ? (
          <Button size="sm" variant="ghost" icon={UserCheck} onClick={onSetMe} data-testid="agreement-coder-set-me">
            {t('agreement.team.setMe')}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function AddCoderDialog({ open, onClose, rows, onAdded }: { open: boolean; onClose: () => void; rows: readonly Row[]; onAdded: () => void }) {
  const { t } = useI18n();
  const project = useProject();
  const toast = useToast();
  const { record } = useUndo();
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(() => nextCoderColor([]));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName('');
    setError(null);
    setColor(nextCoderColor(rows.map((r) => r.coder)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function add() {
    const next = name.trim();
    if (!next) return setError(t('agreement.team.nameRequired'));
    if (rows.some((r) => sameName(r.coder.name, next))) return setError(t('agreement.team.duplicate', { name: next }));
    setBusy(true);
    try {
      record((await addCoder(project, { name: next, color })).undo);
      toast.show({ message: t('agreement.team.added', { name: next }), tone: 'success' });
      onAdded();
      onClose();
    } catch (e) {
      if (e instanceof ServiceError && e.code === 'duplicate') setError(t('agreement.team.duplicate', { name: next }));
      else toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('agreement.team.addTitle')}
      description={t('agreement.team.addBody')}
      size="sm"
      onSubmit={() => void add()}
      data-testid="agreement-add-coder-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" busy={busy} data-testid="agreement-add-coder-save">
            {t('agreement.team.add')}
          </Button>
        </>
      }
    >
      <div className="agr-form">
        <TextField
          label={t('agreement.team.nameLabel')}
          value={name}
          onChange={(v) => {
            setName(v);
            setError(null);
          }}
          error={error ?? undefined}
          maxLength={200}
          data-testid="agreement-add-coder-name"
        />
        <ColorPicker value={color} onChange={setColor} label={t('common.colour')} custom={false} />
      </div>
    </Dialog>
  );
}

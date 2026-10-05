import React, { useEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { Folder, Tag } from 'lucide-react';
import { importQdc, RefiError, type QdcImport } from '../../core/export/refi';
import { LIMITS } from '../../core/model/types';
import { type CodeDraft, createCodes } from '../../services/codes';
import { createDocument } from '../../services/documents';
import { combineUndo, type Undoable } from '../../services/undo';
import { usePlatform, useProject } from '../../shell/AppState';
import { useUndo } from '../../shell/undo';
import { useI18n } from '../../ui/i18n';
import { Button } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { Notice } from '../../ui/components/Feedback';
import { TextArea, TextField } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { freshCount, planQdc, type QdcPlanItem } from './codebook';
import { pickFiles } from './files';
import { classifyQdpxWarning } from './qdpxWarnings';

/** Text pasted from another program, added to the review list like a file. */
export function PasteDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (name: string, text: string) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(t('importer.pasteDialog.defaultName'));
    setText('');
    setTried(false);
  }, [open, t]);
  const submit = () => {
    if (!text.trim() || !name.trim()) {
      setTried(true);
      return;
    }
    onAdd(name.replace(/\s+/g, ' ').trim(), text);
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('importer.pasteDialog.title')}
      size="lg"
      onSubmit={submit}
      data-testid="import-paste-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" data-testid="import-paste-add">
            {t('importer.pasteDialog.add')}
          </Button>
        </>
      }
    >
      <TextField label={t('importer.pasteDialog.name')} value={name} onChange={setName} maxLength={LIMITS.nameMax} error={tried && !name.trim() ? t('importer.detail.nameRequired') : undefined} data-testid="import-paste-name" />
      <TextArea
        label={t('importer.pasteDialog.text')}
        value={text}
        onChange={setText}
        placeholder={t('importer.pasteDialog.placeholder')}
        hint={t('importer.pasteDialog.hint')}
        error={tried && !text.trim() ? t('importer.pasteDialog.required') : undefined}
        minHeight={260}
        className="imp-paste__text"
        data-autofocus
        data-testid="import-paste-text"
      />
    </Dialog>
  );
}

/** A new document written in Trama (field notes): created at once and opened. */
export function NewDocumentDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string, name: string) => void }) {
  const { t, date } = useI18n();
  const project = useProject();
  const { record } = useUndo();
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(t('importer.newDialog.defaultName', { date: date(DateTime.now(), 'medium') }));
    setText('');
    setError(null);
    setTried(false);
  }, [open, t, date]);
  const submit = async () => {
    if (busy) return;
    if (!name.trim()) {
      setTried(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { document, undo } = await createDocument(project, { name, kind: 'note', text, source: { filename: '', format: 'new' } });
      record(undo);
      onCreated(document.id, document.name);
    } catch (e) {
      setError(t('common.unknownError', { message: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title={t('importer.newDialog.title')}
      size="lg"
      onSubmit={() => void submit()}
      data-testid="import-new-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" busy={busy} data-testid="import-new-create">
            {t('importer.newDialog.create')}
          </Button>
        </>
      }
    >
      <TextField label={t('importer.newDialog.name')} value={name} onChange={setName} maxLength={LIMITS.nameMax} error={tried && !name.trim() ? t('importer.detail.nameRequired') : undefined} data-autofocus data-testid="import-new-name" />
      <TextArea
        label={t('importer.newDialog.text')}
        optional={t('common.optional')}
        value={text}
        onChange={setText}
        placeholder={t('importer.newDialog.placeholder')}
        hint={t('importer.newDialog.hint')}
        minHeight={220}
        reading
        data-testid="import-new-text"
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Dialog>
  );
}

interface Pending {
  file: string;
  imported: QdcImport;
  plan: QdcPlanItem[];
}

/** "Import a codebook (.qdc)": pick the file, see what is new, add it to the codebook. */
export function CodebookDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, tp } = useI18n();
  const platform = usePlatform();
  const project = useProject();
  const { record } = useUndo();
  const toast = useToast();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const picking = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) {
      setPending(null);
      return;
    }
    if (picking.current) return;
    picking.current = true;
    void (async () => {
      try {
        const [file] = await pickFiles(platform, t('importer.codebook.pickTitle'), [{ name: t('importer.codebook.filter'), extensions: ['qdc', 'xml'] }], false);
        if (!file) {
          closeRef.current();
          return;
        }
        const bytes = await file.read();
        const imported = importQdc(bytes);
        const codes = await project.store.list('code');
        setPending({ file: file.name, imported, plan: planQdc(imported, codes) });
      } catch (e) {
        toast.show({ message: e instanceof RefiError ? t('importer.codebook.notCodebook', { message: e.message }) : t('common.unknownError', { message: e instanceof Error ? e.message : String(e) }), tone: 'danger' });
        closeRef.current();
      } finally {
        picking.current = false;
      }
    })();
  }, [open, platform, project, t, toast]);

  const fresh = pending ? freshCount(pending.plan) : 0;

  // Every new code in one write: one undo step, one audit-trail entry.
  const apply = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const existing = new Map<string, string>();
      const drafts: CodeDraft[] = [];
      for (const item of pending.plan) {
        if (item.existingId) {
          existing.set(item.fileId, item.existingId);
          continue;
        }
        const d = item.draft;
        const parentId = item.parentFileId ? existing.get(item.parentFileId) : undefined;
        drafts.push({
          ref: item.fileId,
          parent: parentId ? { id: parentId } : item.parentFileId ? { ref: item.parentFileId } : null,
          name: d.name,
          color: d.color,
          description: d.description,
          inclusion: d.inclusion,
          exclusion: d.exclusion,
          example: d.example,
          codable: d.codable,
        });
      }
      const { codes, undo } = await createCodes(project, drafts, { source: pending.file });
      if (codes.length) record(undo);
      toast.show({ message: tp('importer.codebook.added', codes.length), tone: 'success' });
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open && pending !== null}
      onClose={onClose}
      dismissible={!busy}
      title={t('importer.codebook.title')}
      description={pending ? t('importer.codebook.from', { file: pending.file }) + (pending.imported.origin ? ` · ${t('importer.codebook.origin', { origin: pending.imported.origin })}` : '') : undefined}
      size="md"
      onSubmit={() => void apply()}
      data-testid="import-codebook-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!fresh} data-testid="import-codebook-add">
            {fresh ? tp('importer.codebook.add', fresh) : t('common.close')}
          </Button>
        </>
      }
    >
      {pending ? (
        <>
          <p className="imp-codebook__summary">
            {fresh
              ? t('importer.codebook.summary', {
                  total: tp('importer.codebook.total', pending.plan.length),
                  fresh: tp('importer.codebook.fresh', fresh),
                  existing: tp('importer.codebook.existing', pending.plan.length - fresh),
                })
              : t('importer.codebook.nothingNew')}
          </p>
          <ul className="imp-codebook__list" aria-label={t('importer.codebook.listLabel')} data-testid="import-codebook-list">
            {pending.plan.map((p) => (
              <li key={p.fileId} className={p.existingId ? 'imp-codebook__item imp-codebook__item--old' : 'imp-codebook__item'} style={{ paddingLeft: 8 + p.depth * 18 }}>
                {p.codable ? <span className="imp-chip__dot" style={{ background: p.color }} aria-hidden /> : <Folder size={14} aria-hidden style={{ color: p.color }} />}
                <span className="imp-codebook__name">{p.name}</span>
                {p.existingId ? <span className="imp-codebook__tag">{t('importer.codebook.already')}</span> : null}
              </li>
            ))}
          </ul>
          {pending.imported.issues.map((w) => {
            const n = classifyQdpxWarning(w);
            return (
              <Notice key={w.code} tone="info" icon={Tag}>
                {'plural' in n ? tp(n.plural, n.n) : 'key' in n ? t(n.key, n.vars) : n.raw}
              </Notice>
            );
          })}
        </>
      ) : null}
    </Dialog>
  );
}

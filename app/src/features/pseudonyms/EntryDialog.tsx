import React, { useState } from 'react';
import type { Pseudonym } from '../../core/model/types';
import { createPseudonym, updatePseudonym } from '../../services/pseudonyms';
import { useProject } from '../../shell/AppState';
import { useUndo } from '../../shell/undo';
import { useI18n } from '../../ui/i18n';
import { Button } from '../../ui/components/Button';
import { Switch } from '../../ui/components/Choice';
import { Dialog } from '../../ui/components/Dialog';
import { TextField } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { inKey } from './key';

/** Adding or editing one entry of the key. */
export function EntryDialog({ entry, entries, onClose }: { entry: Pseudonym | null; entries: Pseudonym[]; onClose: () => void }) {
  const { t } = useI18n();
  const project = useProject();
  const { record } = useUndo();
  const toast = useToast();
  const [original, setOriginal] = useState(entry?.original ?? '');
  const [replacement, setReplacement] = useState(entry?.replacement ?? '');
  const [note, setNote] = useState(entry?.note ?? '');
  const [wholeWord, setWholeWord] = useState(entry?.whole_word ?? true);
  const [caseSensitive, setCaseSensitive] = useState(entry?.case_sensitive ?? true);
  const [errors, setErrors] = useState<{ original?: string; replacement?: string }>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const next: typeof errors = {};
    if (!original.trim()) next.original = t('pseudonyms.entry.originalRequired');
    else if (inKey(original, entries, entry?.id)) next.original = t('pseudonyms.entry.duplicate');
    if (!replacement.trim()) next.replacement = t('pseudonyms.entry.replacementRequired');
    setErrors(next);
    if (next.original || next.replacement) return;
    setBusy(true);
    try {
      const input = { original, replacement, note, whole_word: wholeWord, case_sensitive: caseSensitive };
      const { undo } = entry ? await updatePseudonym(project, entry.id, input) : await createPseudonym(project, input);
      record(undo);
      onClose();
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      size="sm"
      title={entry ? t('pseudonyms.entry.editTitle') : t('pseudonyms.entry.addTitle')}
      onSubmit={() => void submit()}
      data-testid="pseudonym-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" busy={busy} data-testid="pseudonym-save">
            {entry ? t('common.save') : t('pseudonyms.entry.add')}
          </Button>
        </>
      }
    >
      <div className="pentry">
        <TextField label={t('pseudonyms.cols.original')} value={original} onChange={setOriginal} error={errors.original} hint={t('pseudonyms.entry.originalHint')} autoComplete="off" spellCheck={false} data-testid="pseudonym-original" />
        <TextField label={t('pseudonyms.cols.replacement')} value={replacement} onChange={setReplacement} error={errors.replacement} placeholder={t('pseudonyms.suggest.defaultPattern').replace('{n}', '1')} autoComplete="off" data-testid="pseudonym-replacement" />
        <TextField label={t('pseudonyms.cols.note')} optional={t('common.optional')} value={note} onChange={setNote} placeholder={t('pseudonyms.entry.notePlaceholder')} data-testid="pseudonym-note" />
        <div className="pentry__switches">
          <Switch checked={wholeWord} onChange={setWholeWord} label={t('pseudonyms.cols.wholeWord')} description={t('pseudonyms.entry.wholeWordHint')} data-testid="pseudonym-whole-word" />
          <Switch checked={caseSensitive} onChange={setCaseSensitive} label={t('pseudonyms.cols.caseSensitive')} description={t('pseudonyms.entry.caseSensitiveHint')} data-testid="pseudonym-case-sensitive" />
        </div>
      </div>
    </Dialog>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { LIMITS, PALETTE } from '../../core/model/types';
import { useI18n } from '../../ui/i18n';
import { Button } from '../../ui/components/Button';
import { ColorPicker } from '../../ui/components/ColorPicker';
import { Dialog } from '../../ui/components/Dialog';
import { Notice } from '../../ui/components/Feedback';
import { TextArea, TextField } from '../../ui/components/Field';

export interface ProjectDraft {
  name: string;
  description: string;
  color: string;
  /** Only asked when creating and no name is remembered yet. */
  coderName?: string;
}

/**
 * Creating or editing a project's details. `onSave` may throw: the message shows in the
 * dialog, which stays open with what was typed.
 */
export function ProjectDialog({
  open, mode, initial, askCoder, onClose, onSave,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: Partial<ProjectDraft>;
  /** Asks for the researcher's name too (creating, with none remembered). */
  askCoder?: boolean;
  onClose: () => void;
  onSave: (draft: ProjectDraft) => Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<string>(PALETTE[0]);
  const [coderName, setCoderName] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setDescription(initial?.description ?? '');
    setColor(initial?.color ?? PALETTE[0]);
    setCoderName(initial?.coderName ?? '');
    setShowErrors(false);
    setError(null);
    // Only on opening: later changes to `initial` must not overwrite what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmed = name.replace(/\s+/g, ' ').trim();
  const nameError = !trimmed ? t('projects.dialog.nameRequired') : trimmed.length > LIMITS.nameMax ? t('projects.dialog.nameTooLong', { n: LIMITS.nameMax }) : null;
  const coderError = askCoder && !coderName.trim() ? t('app.coder.nameRequired') : null;

  async function save() {
    if (busyRef.current) return;
    if (nameError || coderError) {
      setShowErrors(true);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSave({ name: trimmed, description: description.trim(), color, ...(askCoder ? { coderName: coderName.trim() } : {}) });
    } catch (e) {
      setError(t('common.unknownError', { message: e instanceof Error ? e.message : String(e) }));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title={mode === 'create' ? t('projects.dialog.createTitle') : t('projects.dialog.editTitle')}
      size="md"
      onSubmit={() => void save()}
      data-testid="project-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" busy={busy} data-testid="project-dialog-save">
            {mode === 'create' ? (busy ? t('projects.dialog.creating') : t('projects.dialog.create')) : t('projects.dialog.save')}
          </Button>
        </>
      }
    >
      <TextField
        label={t('projects.dialog.name')}
        placeholder={t('projects.dialog.namePlaceholder')}
        value={name}
        onChange={setName}
        error={showErrors ? nameError ?? undefined : undefined}
        maxLength={LIMITS.nameMax + 20}
        data-autofocus
        data-testid="project-name"
      />
      <TextArea
        label={t('projects.dialog.description')}
        optional={t('common.optional')}
        hint={t('projects.dialog.descriptionHint')}
        value={description}
        onChange={setDescription}
        autoGrow
        minHeight={64}
        maxHeight={200}
        data-testid="project-description"
      />
      <ColorPicker label={t('projects.dialog.colour')} value={color} onChange={setColor} data-testid="project-colour" />
      {askCoder ? (
        <TextField
          label={t('projects.dialog.coderName')}
          hint={t('projects.dialog.coderHint')}
          value={coderName}
          onChange={setCoderName}
          error={showErrors ? coderError ?? undefined : undefined}
          autoComplete="name"
          maxLength={LIMITS.nameMax}
          data-testid="project-coder"
        />
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Dialog>
  );
}

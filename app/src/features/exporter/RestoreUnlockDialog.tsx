import React, { useEffect, useState } from 'react';
import type { SlotKind } from '../../core/crypto/keyring';
import { useI18n } from '../../ui/i18n';
import { Button } from '../../ui/components/Button';
import { RadioGroup } from '../../ui/components/Choice';
import { Dialog } from '../../ui/components/Dialog';
import { TextArea, TextField } from '../../ui/components/Field';

/** Asks for the passphrase or recovery phrase of the library that made a backup. */
export function RestoreUnlockDialog({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (slot: SlotKind, secret: string) => Promise<'done' | 'unlock' | 'wrong'> }) {
  const { t } = useI18n();
  const [slot, setSlot] = useState<SlotKind>('passphrase');
  const [secret, setSecret] = useState('');
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setSecret('');
      setWrong(false);
    }
  }, [open]);

  async function submit() {
    if (!secret.trim() || busy) return;
    setBusy(true);
    try {
      const r = await onSubmit(slot, secret);
      if (r === 'wrong') setWrong(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('exporter.backups.restore.otherTitle')}
      description={t('exporter.backups.restore.otherBody')}
      size="sm"
      dismissible={!busy}
      onSubmit={() => void submit()}
      data-testid="restore-unlock-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!secret.trim()} data-testid="restore-unlock-submit">
            {busy ? t('exporter.backups.restore.restoring') : t('exporter.backups.restore.submit')}
          </Button>
        </>
      }
    >
      <div className="proj-dialog-stack">
        <RadioGroup<SlotKind>
          label={t('exporter.backups.restore.unlockWith')}
          variant="segmented"
          value={slot}
          onChange={(s) => {
            setSlot(s);
            setSecret('');
            setWrong(false);
          }}
          options={[
            { value: 'passphrase', label: t('exporter.backups.restore.passphrase') },
            { value: 'recovery_phrase', label: t('exporter.backups.restore.phrase') },
          ]}
          data-testid="restore-unlock-slot"
        />
        {slot === 'passphrase' ? (
          <TextField
            type="password"
            label={t('exporter.backups.restore.passphrase')}
            value={secret}
            onChange={(v) => {
              setSecret(v);
              setWrong(false);
            }}
            autoComplete="off"
            error={wrong ? t('exporter.backups.restore.wrong') : undefined}
            data-testid="restore-unlock-secret"
          />
        ) : (
          <TextArea
            label={t('exporter.backups.restore.phrase')}
            value={secret}
            onChange={(v) => {
              setSecret(v);
              setWrong(false);
            }}
            autoComplete="off"
            spellCheck={false}
            minHeight={72}
            error={wrong ? t('exporter.backups.restore.wrong') : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            data-testid="restore-unlock-secret"
          />
        )}
      </div>
    </Dialog>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { Headphones, Mic } from 'lucide-react';
import { useProject } from '../../shell/AppState';
import { Button } from '../../ui/components/Button';
import { Checkbox } from '../../ui/components/Choice';
import { Dialog } from '../../ui/components/Dialog';
import { Notice } from '../../ui/components/Feedback';
import { Select, TextField } from '../../ui/components/Field';
import { useI18n } from '../../ui/i18n';
import { languageOptions } from './languages';
import { useSpeech } from './SpeechProvider';

/** Starting a recording: what it will be called, who speaks, and consent. */
export function RecordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, meta } = useI18n();
  const project = useProject();
  const { controller, state } = useSpeech();
  const canTranscribe = !!state.info?.transcribe;
  const [name, setName] = useState('');
  const [you, setYou] = useState('');
  const [others, setOthers] = useState('');
  const [language, setLanguage] = useState('');
  const [transcribe, setTranscribe] = useState(true);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const date = new Intl.DateTimeFormat(meta.bcp47, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
    setName(t('speech.record.defaultName', { date }));
    setYou(project.me.name);
    setOthers(t('speech.record.othersDefault'));
    setTranscribe(true);
    setConsent(false);
    setError(null);
  }, [open, meta.bcp47, t, project]);

  const languages = useMemo(() => languageOptions(meta.bcp47, t('speech.transcribe.auto')), [meta.bcp47, t]);

  const start = async () => {
    if (!controller || !consent || !name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await controller.startRecording({
        name: name.trim(),
        speakers: [you.trim() || null, others.trim() || null],
        language: language || null,
        transcribe: transcribe && canTranscribe,
      });
      onClose();
    } catch (e) {
      const code = (e as { code?: unknown } | null)?.code;
      setError(code === 'NO_AUDIO_DEVICE' ? t('speech.record.noDevice') : code === 'BUSY' ? t('speech.record.busy') : t('speech.record.failed', { message: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('speech.record.title')}
      description={t('speech.record.intro')}
      size="md"
      onSubmit={() => void start()}
      dismissible={!busy}
      data-testid="record-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" icon={Mic} disabled={!consent || !name.trim()} busy={busy} data-testid="record-start">
            {t('speech.record.start')}
          </Button>
        </>
      }
    >
      <div className="speech-form">
        <TextField label={t('speech.record.name')} value={name} onChange={setName} maxLength={200} data-autofocus data-testid="record-name" />
        <div className="speech-form__pair">
          <TextField label={t('speech.record.you')} value={you} onChange={setYou} maxLength={80} data-testid="record-you" />
          <TextField label={t('speech.record.others')} value={others} onChange={setOthers} maxLength={80} data-testid="record-others" />
        </div>
        <Select label={t('speech.record.language')} value={language} onChange={setLanguage} options={languages} data-testid="record-language" />
        <Checkbox
          checked={transcribe && canTranscribe}
          onChange={setTranscribe}
          disabled={!canTranscribe}
          label={t('speech.record.transcribe')}
          description={canTranscribe ? t('speech.record.transcribeHint') : state.info?.reason ? t(`speech.transcribe.unavailable.${state.info.reason}`) : undefined}
          data-testid="record-transcribe"
        />
        <Notice tone="info" icon={Headphones}>
          {t('speech.record.headphones')}
        </Notice>
        <Checkbox checked={consent} onChange={setConsent} label={t('speech.record.consent')} description={t('speech.record.consentHint')} data-testid="record-consent" />
        {error ? (
          <Notice tone="danger" data-testid="record-error">
            {error}
          </Notice>
        ) : null}
      </div>
    </Dialog>
  );
}

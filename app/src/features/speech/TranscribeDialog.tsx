import React, { useEffect, useMemo, useState } from 'react';
import { AudioLines } from 'lucide-react';
import type { Document } from '../../core/model/types';
import { useProject } from '../../shell/AppState';
import { Button } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { Hint } from '../../ui/components/Field';
import { Select, TextField } from '../../ui/components/Field';
import { useI18n } from '../../ui/i18n';
import { languageOptions } from './languages';
import { useSpeech } from './SpeechProvider';

/** A recording made in Trama keeps the two sides of the call apart. */
export const isTramaRecording = (doc: Pick<Document, 'source'>): boolean => doc.source?.format === 'recording';

/** Asking for a recording to be transcribed: the language, and the speakers' names for a call. */
export function TranscribeDialog({ doc, onClose }: { doc: Document | null; onClose: () => void }) {
  const { t, meta } = useI18n();
  const project = useProject();
  const { controller } = useSpeech();
  const [language, setLanguage] = useState('');
  const [you, setYou] = useState('');
  const [others, setOthers] = useState('');
  const [busy, setBusy] = useState(false);
  const split = !!doc && isTramaRecording(doc);

  useEffect(() => {
    if (!doc) return;
    setLanguage('');
    setYou(project.me.name);
    setOthers(t('speech.record.othersDefault'));
  }, [doc, project, t]);

  const languages = useMemo(() => languageOptions(meta.bcp47, t('speech.transcribe.auto')), [meta.bcp47, t]);

  const start = async () => {
    if (!controller || !doc || busy) return;
    setBusy(true);
    try {
      await controller.request({
        document_id: doc.id,
        language: language || null,
        channels: split ? 'split' : 'mix',
        speakers: split ? [you.trim() || null, others.trim() || null] : [null],
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!doc}
      onClose={onClose}
      title={t('speech.transcribe.title', { name: doc?.name ?? '' })}
      description={t('speech.transcribe.intro')}
      size="md"
      onSubmit={() => void start()}
      data-testid="transcribe-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" icon={AudioLines} busy={busy} data-testid="transcribe-start">
            {t('speech.transcribe.start')}
          </Button>
        </>
      }
    >
      <div className="speech-form">
        <Select label={t('speech.transcribe.language')} value={language} onChange={setLanguage} options={languages} data-autofocus data-testid="transcribe-language" />
        {split ? (
          <>
            <div className="speech-form__pair">
              <TextField label={t('speech.transcribe.you')} value={you} onChange={setYou} maxLength={80} data-testid="transcribe-you" />
              <TextField label={t('speech.transcribe.others')} value={others} onChange={setOthers} maxLength={80} data-testid="transcribe-others" />
            </div>
            <Hint>{t('speech.transcribe.splitHint')}</Hint>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

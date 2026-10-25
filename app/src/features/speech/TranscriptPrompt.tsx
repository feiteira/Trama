import React from 'react';
import { AudioLines, X } from 'lucide-react';
import type { Document } from '../../core/model/types';
import { useAppState } from '../../shell/AppState';
import { Button } from '../../ui/components/Button';
import { ProgressBar } from '../../ui/components/Feedback';
import { useI18n } from '../../ui/i18n';
import { useSpeech } from './SpeechProvider';

/**
 * Over the empty page of a recording that has no transcript yet: the way to have it written
 * out here, how far that has got, or why this copy of Trama cannot.
 */
export function TranscriptPrompt({ doc }: { doc: Document }) {
  const { t } = useI18n();
  const { platform } = useAppState();
  const { controller, state, openTranscribe } = useSpeech();
  const running = state.current?.documentId === doc.id ? state.current : null;
  const queued = state.queue.some((q) => q.document_id === doc.id);
  const reason = !platform.speech ? 'web' : state.info && !state.info.transcribe ? state.info.reason : null;

  return (
    <div className="speech-prompt" data-testid="transcript-prompt">
      <AudioLines size={22} aria-hidden className="speech-prompt__icon" />
      <div className="speech-prompt__main">
        <p className="speech-prompt__title">{t('speech.transcribe.none')}</p>
        {running ? (
          <>
            <ProgressBar
              value={running.status?.state === 'transcribing' ? running.status.percent / 100 : null}
              label={running.status?.state === 'transcribing' ? t('speech.transcribe.running', { percent: running.status.percent }) : t('speech.transcribe.decoding')}
              data-testid="transcript-progress"
            />
            <p className="speech-prompt__hint" aria-live="polite">
              {running.status?.state === 'transcribing' ? t('speech.transcribe.running', { percent: running.status.percent }) : t('speech.transcribe.decoding')}
            </p>
          </>
        ) : queued ? (
          <p className="speech-prompt__hint">{t('speech.transcribe.queued')}</p>
        ) : reason ? (
          <p className="speech-prompt__hint">{t(`speech.transcribe.unavailable.${reason}`)}</p>
        ) : (
          <p className="speech-prompt__hint">{t('speech.transcribe.noneHint')}</p>
        )}
      </div>
      {controller && (running || queued) ? (
        <Button size="sm" variant="ghost" icon={X} onClick={() => void controller.cancel(doc.id)} data-testid="transcript-cancel">
          {t('speech.transcribe.cancel')}
        </Button>
      ) : controller && !reason && state.info ? (
        <Button size="sm" variant="primary" icon={AudioLines} onClick={() => openTranscribe(doc)} data-testid="transcript-start">
          {t('speech.transcribe.action')}
        </Button>
      ) : null}
    </div>
  );
}

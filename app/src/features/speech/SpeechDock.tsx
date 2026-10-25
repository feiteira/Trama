import React, { useMemo } from 'react';
import { AlertTriangle, AudioLines, Square, X } from 'lucide-react';
import { useLive } from '../../shell/useLive';
import { Button, IconButton } from '../../ui/components/Button';
import { ProgressBar, Spinner } from '../../ui/components/Feedback';
import { Tooltip } from '../../ui/components/Tooltip';
import { useI18n } from '../../ui/i18n';
import type { RecorderTrackStatus } from '../../platform/types';
import { formatTime } from '../workbench/model/paragraphs';
import { useSpeech } from './SpeechProvider';

// The strip at the foot of every screen while a call is recorded or a recording transcribed:
// how long it has run, whether both sides are heard, and the way to stop.

function Meter({ label, track, warn }: { label: string; track: RecorderTrackStatus | undefined; warn: string | null }) {
  const { t } = useI18n();
  const level = track?.open ? Math.min(1, Math.sqrt(track.level)) : 0;
  return (
    <span className="speech-meter" title={track?.device ?? undefined}>
      <span className="speech-meter__label">{label}</span>
      <span className="speech-meter__bar" role="meter" aria-label={t('speech.bar.levelOf', { track: label })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
        <span style={{ width: `${level * 100}%` }} />
      </span>
      {warn ? (
        <Tooltip label={warn}>
          <span className="speech-meter__warn" tabIndex={0} aria-label={warn} data-testid="speech-track-warning">
            <AlertTriangle size={14} aria-hidden />
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}

export function SpeechDock() {
  const { t, tp } = useI18n();
  const { controller, state } = useSpeech();
  const { recording, current, queue } = state;
  const { data: names } = useLive(
    async (store) => {
      const ids = [...new Set(queue.map((q) => q.document_id))];
      const out = new Map<string, string>();
      for (const id of ids) {
        const d = await store.get('document', id);
        if (d && !d.deleted) out.set(id, d.name);
      }
      return out;
    },
    [queue.map((q) => q.document_id).join('|')],
    ['document'],
  );
  const waiting = useMemo(() => queue.filter((q) => q.document_id !== current?.documentId).length, [queue, current]);
  if (!controller || (!recording && !current)) return null;

  const status = recording?.status;
  const micWarn = status && !status.mic.open ? t('speech.bar.micOff', { reason: status.mic.error ?? '' }) : null;
  const sysWarn = status && !status.system.open ? t('speech.bar.systemOff', { reason: status.system.error ?? '' }) : null;
  const percent = current?.status?.percent ?? 0;
  const currentName = current ? (names?.get(current.documentId) ?? '') : '';

  return (
    <section className="speech-dock" aria-label={t('speech.bar.label')} data-testid="speech-dock">
      {recording ? (
        <div className="speech-dock__row" data-testid="speech-recording" data-phase={recording.phase}>
          <span className={recording.phase === 'recording' ? 'speech-dot speech-dot--live' : 'speech-dot'} aria-hidden />
          <span className="speech-dock__title">
            {recording.phase === 'stopping' ? t('speech.bar.saving') : recording.phase === 'starting' ? t('speech.bar.starting') : t('speech.bar.recording')}
          </span>
          <span className="speech-dock__name">{recording.rec.name}</span>
          <span className="speech-dock__time t-tabular" aria-live="off" data-testid="speech-elapsed">
            {formatTime(status?.ms ?? 0)}
          </span>
          <Meter label={t('speech.bar.you')} track={status?.mic} warn={micWarn} />
          <Meter label={t('speech.bar.call')} track={status?.system} warn={sysWarn} />
          <span className="speech-dock__spacer" />
          {recording.phase === 'stopping' ? (
            <Spinner size={16} label={t('speech.bar.saving')} />
          ) : (
            <Button size="sm" variant="danger" icon={Square} onClick={() => void controller.stopRecording().catch(() => undefined)} disabled={recording.phase !== 'recording'} data-testid="speech-stop">
              {t('speech.bar.stop')}
            </Button>
          )}
        </div>
      ) : null}
      {current ? (
        <div className="speech-dock__row" data-testid="speech-transcribing">
          <AudioLines size={16} aria-hidden className="speech-dock__icon" />
          <span className="speech-dock__title">{t('speech.transcribe.runningName', { name: currentName })}</span>
          <ProgressBar
            className="speech-dock__progress"
            value={current.status?.state === 'transcribing' ? percent / 100 : null}
            label={current.status?.state === 'transcribing' ? t('speech.transcribe.running', { percent }) : t('speech.transcribe.decoding')}
            data-testid="speech-progress"
          />
          <span className="speech-dock__meta t-tabular">{current.status?.state === 'transcribing' ? `${percent}%` : t('speech.transcribe.decoding')}</span>
          {waiting ? <span className="speech-dock__meta">{tp('speech.transcribe.more', waiting)}</span> : null}
          <span className="speech-dock__spacer" />
          <IconButton icon={X} size="sm" label={t('speech.transcribe.cancel')} onClick={() => void controller.cancel(current.documentId)} data-testid="speech-cancel" />
        </div>
      ) : null}
    </section>
  );
}

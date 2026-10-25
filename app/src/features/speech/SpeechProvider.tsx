import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Mic } from 'lucide-react';
import type { Document } from '../../core/model/types';
import { useAppState, useHold, useProject, useRegisterSaver } from '../../shell/AppState';
import { useRouter } from '../../shell/router';
import { useCommands } from '../../shell/useCommands';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import { SpeechController, type SpeechState } from './controller';
import { RecordDialog } from './RecordDialog';
import { TranscribeDialog } from './TranscribeDialog';
import './speech.css';

// On-device speech for the open project: one controller (controller.ts) for the call being
// recorded and the transcription queue, the dialogs that start them, and what tells the
// researcher how they went. Desktop only: without platform.speech nothing here shows.

interface SpeechContext {
  controller: SpeechController | null;
  state: SpeechState;
  openRecord: () => void;
  openTranscribe: (doc: Document) => void;
}

const EMPTY: SpeechState = { info: null, recording: null, queue: [], current: null };
const Ctx = createContext<SpeechContext>({ controller: null, state: EMPTY, openRecord: () => undefined, openTranscribe: () => undefined });

export function useSpeech(): SpeechContext {
  return useContext(Ctx);
}

/** Saving a long recording and stopping the engine can take a while when Trama locks. */
const SHUTDOWN_LIMIT_MS = 60_000;

export function SpeechProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const project = useProject();
  const { platform } = useAppState();
  const toast = useToast();
  const { go } = useRouter();
  const speech = platform.speech;
  const controller = useMemo(() => (speech ? new SpeechController(project, speech) : null), [project, speech]);
  const [recordOpen, setRecordOpen] = useState(false);
  const [transcribeDoc, setTranscribeDoc] = useState<Document | null>(null);

  useEffect(() => {
    if (!controller) return;
    void controller.init();
    return () => controller.dispose();
  }, [controller]);

  const state = useSyncExternalStore(
    useCallback((fn: () => void) => (controller ? controller.subscribe(fn) : () => undefined), [controller]),
    () => controller?.snapshot ?? EMPTY,
  );

  // A call can last an hour without a key being pressed: no auto-lock while recording, nor
  // while a transcription runs (as during an import).
  useHold(!!state.recording || !!state.current);
  useRegisterSaver(() => controller?.shutdown(), { limitMs: SHUTDOWN_LIMIT_MS });

  useEffect(() => {
    if (!controller) return;
    return controller.onEvent((e) => {
      switch (e.type) {
        case 'recorded':
          toast.show({ message: t(controller.snapshot.queue.some((q) => q.document_id === e.document.id) ? 'speech.recordedTranscribing' : 'speech.recorded', { name: e.document.name }), tone: 'success' });
          go({ name: 'workbench', docId: e.document.id });
          break;
        case 'recordingFailed':
          toast.show({ message: t('speech.recordingFailed', { message: e.error instanceof Error ? e.error.message : String(e.error) }), tone: 'danger', durationMs: 15_000 });
          break;
        case 'transcribed':
          toast.show({
            message: t('speech.transcribe.done', { name: e.document.name }),
            tone: 'success',
            durationMs: 12_000,
            action: { label: t('speech.transcribe.open'), run: () => go({ name: 'workbench', docId: e.document.id }), testId: 'transcribed-open' },
          });
          break;
        case 'transcribeFailed': {
          const known = ['NO_SPEECH', 'UNSUPPORTED_AUDIO', 'HAS_TEXT', 'NO_RECORDING'] as const;
          const key = (known as readonly string[]).includes(e.code) ? (`speech.transcribe.errors.${e.code}` as `speech.transcribe.errors.${(typeof known)[number]}`) : 'speech.transcribe.errors.other';
          toast.show({ message: t(key, { name: e.name, code: e.code }), tone: 'danger', durationMs: 12_000 });
          break;
        }
      }
    });
  }, [controller, toast, t, go]);

  const openRecord = useCallback(() => {
    if (controller) setRecordOpen(true);
  }, [controller]);
  const openTranscribe = useCallback((doc: Document) => setTranscribeDoc(doc), []);

  useCommands(
    () => (controller && !state.recording ? [{ id: 'speech.record', label: t('speech.record.action'), group: t('app.commands.groupApp'), icon: Mic, run: openRecord }] : []),
    [controller, !!state.recording, t, openRecord],
  );

  const value = useMemo(() => ({ controller, state, openRecord, openTranscribe }), [controller, state, openRecord, openTranscribe]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {controller ? (
        <>
          <RecordDialog open={recordOpen} onClose={() => setRecordOpen(false)} />
          <TranscribeDialog doc={transcribeDoc} onClose={() => setTranscribeDoc(null)} />
        </>
      ) : null}
    </Ctx.Provider>
  );
}

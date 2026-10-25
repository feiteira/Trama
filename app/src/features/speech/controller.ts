// On-device speech for the open project, outside React: the call being recorded and the queue
// of recordings being transcribed. The screens follow it with `useSpeech` (SpeechProvider.tsx);
// the shell stops it before the project closes (a lock, another project, the window closing).

import type { Document } from '../../core/model/types';
import type { Platform, RecorderStatus, SpeechInfo, TranscribeStatus } from '../../platform/types';
import { JobStopped } from '../../services/jobs';
import type { Project } from '../../services/project';
import { isLocked } from '../../services/project';
import {
  type OpenRecording,
  RECORDING_META,
  recordingDocument,
  recordingFilename,
  RecordingWriter,
} from '../../services/recording';
import {
  dequeueTranscription,
  enqueueTranscription,
  transcribable,
  transcribeDocument,
  TranscriptionError,
  transcriptionQueue,
  type TranscribeRequest,
} from '../../services/transcription';

type Speech = NonNullable<Platform['speech']>;

export interface RecordingState {
  phase: 'starting' | 'recording' | 'stopping';
  rec: OpenRecording;
  status: RecorderStatus | null;
}

export interface SpeechState {
  /** Null until known; `transcribe` false where the model is missing or cannot run. */
  info: SpeechInfo | null;
  recording: RecordingState | null;
  /** Waiting requests, the running one first. */
  queue: TranscribeRequest[];
  /** The one being transcribed now, and how far it is. */
  current: { documentId: string; status: TranscribeStatus | null } | null;
}

export type SpeechEvent =
  | { type: 'recorded'; document: Document }
  | { type: 'recordingFailed'; error: unknown }
  | { type: 'transcribed'; document: Document; language: string | null }
  | { type: 'transcribeFailed'; documentId: string; name: string; code: string };

export interface StartOptions {
  name: string;
  speakers: [string | null, string | null];
  language: string | null;
  transcribe: boolean;
  caseId?: string | null;
}

/** How often the recorded audio is taken from the shell and stored. */
const TICK_MS = 400;

export class SpeechController {
  private state: SpeechState = { info: null, recording: null, queue: [], current: null };
  private readonly listeners = new Set<() => void>();
  private readonly eventListeners = new Set<(e: SpeechEvent) => void>();
  private writer: RecordingWriter | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking: Promise<void> = Promise.resolve();
  private running: Promise<void> | null = null;
  private stopping = false;
  private disposed = false;
  /** The stop under way (later calls wait for it). */
  private stopped: Promise<Document | null> | null = null;

  constructor(
    private readonly project: Project,
    private readonly speech: Speech,
    private readonly opts: { pollMs?: number; tickMs?: number } = {},
  ) {}

  // ── Following along ──────────────────────────────────────────────────────────────────

  get snapshot(): SpeechState {
    return this.state;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  onEvent(fn: (e: SpeechEvent) => void): () => void {
    this.eventListeners.add(fn);
    return () => void this.eventListeners.delete(fn);
  }

  private set(patch: Partial<SpeechState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  private emit(e: SpeechEvent) {
    for (const fn of this.eventListeners) fn(e);
  }

  /** Learns what speech can do here and carries on with a queue left from before. */
  async init(): Promise<void> {
    const info = await this.speech.info().catch((): SpeechInfo => ({ transcribe: false, reason: 'NO_MODEL', engine: '' }));
    if (this.disposed) return;
    this.set({ info, queue: await transcriptionQueue(this.project.store) });
    this.kick();
  }

  /** Busy: the idle auto-lock waits. */
  get busy(): boolean {
    return !!this.state.recording || !!this.state.current;
  }

  // ── Recording ────────────────────────────────────────────────────────────────────────

  async startRecording(o: StartOptions): Promise<void> {
    if (this.state.recording || this.disposed) return;
    const startedAt = new Date().toISOString();
    const writer = await RecordingWriter.create(this.project);
    const rec: OpenRecording = {
      blob_id: writer.blobId,
      started_at: startedAt,
      name: o.name,
      speakers: o.speakers,
      language: o.language,
      case_id: o.caseId ?? null,
      transcribe: o.transcribe,
    };
    this.set({ recording: { phase: 'starting', rec, status: null } });
    try {
      // Noted first: a crash from here on leaves a recording the next opening recovers.
      await this.project.store.setMeta(RECORDING_META, JSON.stringify(rec));
      const status = await this.speech.recorder.start();
      this.writer = writer;
      this.set({ recording: { phase: 'recording', rec, status } });
      this.timer = setInterval(() => {
        this.ticking = this.ticking.then(() => this.tick());
      }, this.opts.tickMs ?? TICK_MS);
    } catch (e) {
      await this.project.store.deleteMeta(RECORDING_META).catch(() => undefined);
      await this.project.removeBlob({ blob_id: writer.blobId }).catch(() => undefined);
      this.set({ recording: null });
      throw e;
    }
  }

  private async tick(): Promise<void> {
    const cur = this.state.recording;
    if (!cur || cur.phase !== 'recording' || !this.writer) return;
    try {
      const pcm = await this.speech.recorder.take();
      if (pcm.length) await this.writer.write(pcm);
      const status = await this.speech.recorder.status();
      if (this.state.recording?.phase === 'recording') this.set({ recording: { ...this.state.recording, status } });
    } catch (e) {
      // A full disk, the project closing under it: stop here; what was stored is kept.
      console.error('recording failed', e);
      void this.stopRecording().catch(() => undefined);
    }
  }

  /**
   * Stops recording and saves it as a document (queued for transcription if asked). Safe to
   * call more than once: later calls wait for the first.
   */
  stopRecording(): Promise<Document | null> {
    if (!this.state.recording) return Promise.resolve(null);
    this.stopped ??= this.finishRecording().finally(() => {
      this.stopped = null;
    });
    return this.stopped;
  }

  private async finishRecording(): Promise<Document | null> {
    const cur = this.state.recording;
    if (!cur) return null;
    this.set({ recording: { ...cur, phase: 'stopping' } });
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.ticking.catch(() => undefined);
    const writer = this.writer;
    this.writer = null;
    try {
      const rest = await this.speech.recorder.stop();
      if (!writer) return null;
      if (rest.length) await writer.write(rest);
      const media = await writer.finish(recordingFilename(cur.rec.started_at));
      const document = await recordingDocument(this.project, cur.rec, media);
      this.emit({ type: 'recorded', document });
      if (cur.rec.transcribe) {
        this.set({ queue: await transcriptionQueue(this.project.store) });
        this.kick();
      }
      return document;
    } catch (e) {
      // The meta key stays: opening the project again saves what can be saved.
      if (!isLocked(e)) this.emit({ type: 'recordingFailed', error: e });
      throw e;
    } finally {
      this.set({ recording: null });
    }
  }

  // ── Transcription ────────────────────────────────────────────────────────────────────

  /** Queues a recording to be transcribed. */
  async request(req: TranscribeRequest): Promise<void> {
    await enqueueTranscription(this.project.store, req);
    this.set({ queue: await transcriptionQueue(this.project.store) });
    this.kick();
  }

  /** Takes a request off the queue, stopping it if it runs. */
  async cancel(documentId: string): Promise<void> {
    await dequeueTranscription(this.project.store, documentId);
    if (this.state.current?.documentId === documentId) await this.speech.transcribe.cancel().catch(() => undefined);
    this.set({ queue: await transcriptionQueue(this.project.store) });
  }

  private kick() {
    if (this.running || this.disposed || !this.state.info?.transcribe) return;
    this.running = this.drain().finally(() => {
      this.running = null;
      this.set({ current: null });
    });
  }

  private async drain(): Promise<void> {
    for (;;) {
      if (this.stopping || this.disposed || !this.project.isOpen) return;
      const [next] = await transcriptionQueue(this.project.store);
      if (!next) return;
      const doc = await transcribable(this.project, next.document_id);
      if (!doc) {
        await dequeueTranscription(this.project.store, next.document_id);
        this.set({ queue: await transcriptionQueue(this.project.store) });
        continue;
      }
      this.set({ current: { documentId: doc.id, status: null } });
      try {
        const r = await transcribeDocument(this.project, this.speech, next, {
          pollMs: this.opts.pollMs,
          shouldStop: () => this.stopping || this.disposed || !this.project.isOpen || !this.state.queue.some((q) => q.document_id === doc.id),
          onProgress: (status) => this.state.current?.documentId === doc.id && this.set({ current: { documentId: doc.id, status } }),
        });
        await dequeueTranscription(this.project.store, doc.id);
        this.emit({ type: 'transcribed', document: r.document, language: r.language });
      } catch (e) {
        if (e instanceof JobStopped || isLocked(e) || !this.project.isOpen) {
          // Locked or closing: it stays queued for next time. Cancelled: already off the queue.
          if (this.stopping || this.disposed || !this.project.isOpen) return;
          continue;
        }
        console.error('transcription failed', e);
        await dequeueTranscription(this.project.store, doc.id).catch(() => undefined);
        this.emit({ type: 'transcribeFailed', documentId: doc.id, name: doc.name, code: e instanceof TranscriptionError ? e.code : 'ERROR' });
      } finally {
        if (this.project.isOpen) this.set({ queue: await transcriptionQueue(this.project.store).catch(() => this.state.queue) });
      }
    }
  }

  // ── Closing ──────────────────────────────────────────────────────────────────────────

  /** Before the project closes: the recording is saved, a transcription stops (it stays queued). */
  async shutdown(): Promise<void> {
    this.stopping = true;
    try {
      await this.stopRecording().catch((e: unknown) => console.error('saving the recording failed', e));
      if (this.state.current) await this.speech.transcribe.cancel().catch(() => undefined);
      await this.running?.catch(() => undefined);
    } finally {
      this.stopping = false;
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.listeners.clear();
    this.eventListeners.clear();
  }
}

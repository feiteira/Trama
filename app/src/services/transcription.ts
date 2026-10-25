// Transcribing a document's recording on this computer, with the speech model that ships with
// the desktop app (platform.speech). The recording is decrypted in memory and handed to the
// engine; the transcript comes back as timed text, is laid out as turns and written into the
// document (which must have no text yet), with an audit-trail entry naming the engine.
//
// Requests wait in a queue kept in the project's store meta (device-local, never exported): one
// runs at a time, and a queue a lock or the end of the day interrupted carries on when the
// project opens again.

import type { Document } from '../core/model/types';
import { spokenLanguage, transcriptFromSpeech } from '../core/speech/transcript';
import type { Store } from '../core/store/store';
import type { Platform, TranscribeStatus } from '../platform/types';
import { fillTranscript } from './documents';
import { JobStopped } from './jobs';
import type { Project } from './project';
import { ServiceError, type Undoable } from './undo';

/** Store meta key: the transcriptions waiting on this computer (JSON `TranscribeRequest[]`). */
export const TRANSCRIBE_QUEUE_META = 'speech.queue';

export interface TranscribeRequest {
  document_id: string;
  /** ISO 639-1, or null to let the model tell. */
  language: string | null;
  /** 'split': a call recorded by Trama, the microphone and the computer's sound apart. */
  channels: 'mix' | 'split';
  /** A name for each track's speaker (null: no label). */
  speakers: (string | null)[];
}

function parseQueue(raw: string | null): TranscribeRequest[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const name = (x: unknown) => (typeof x === 'string' ? x : null);
    return v
      .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null && typeof (r as { document_id?: unknown }).document_id === 'string')
      .map((r) => ({
        document_id: r.document_id as string,
        language: name(r.language),
        channels: r.channels === 'split' ? 'split' : 'mix',
        speakers: Array.isArray(r.speakers) ? r.speakers.map(name) : [],
      }));
  } catch {
    return [];
  }
}

export async function transcriptionQueue(store: Store): Promise<TranscribeRequest[]> {
  return parseQueue(await store.getMeta(TRANSCRIBE_QUEUE_META));
}

async function saveQueue(store: Store, queue: TranscribeRequest[]): Promise<void> {
  if (queue.length) await store.setMeta(TRANSCRIBE_QUEUE_META, JSON.stringify(queue));
  else await store.deleteMeta(TRANSCRIBE_QUEUE_META);
}

/** Adds a request at the end of the queue (replacing one for the same document). */
export async function enqueueTranscription(store: Store, req: TranscribeRequest): Promise<void> {
  const queue = (await transcriptionQueue(store)).filter((r) => r.document_id !== req.document_id);
  await saveQueue(store, [...queue, req]);
}

export async function dequeueTranscription(store: Store, documentId: string): Promise<void> {
  const queue = await transcriptionQueue(store);
  if (queue.some((r) => r.document_id === documentId)) await saveQueue(store, queue.filter((r) => r.document_id !== documentId));
}

/** Why a transcription did not produce a transcript; `code` is for the UI to explain. */
export class TranscriptionError extends Error {
  constructor(
    /** UNAVAILABLE, UNSUPPORTED_AUDIO, NO_SPEECH, NO_RECORDING, HAS_TEXT, MODEL_UNREADABLE, BUSY, ERROR */
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

/** A document the queue can work on: live, with a recording, and still without text. */
export async function transcribable(project: Project, documentId: string): Promise<Document | null> {
  const doc = await project.store.get('document', documentId);
  if (!doc || doc.deleted || !doc.media) return null;
  const dt = await project.store.get('doctext', documentId);
  return dt && !dt.text.trim() ? doc : null;
}

const extOf = (filename: string) => /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase() ?? '';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Waits until the engine is not working on anything (a cancelled transcription finishes its
 * current step first), so the next one is not refused as busy.
 */
async function settle(speech: NonNullable<Platform['speech']>, pollMs: number): Promise<void> {
  for (let i = 0; i < 600; i++) {
    const s = await speech.transcribe.status();
    if (s.state !== 'decoding' && s.state !== 'transcribing') return;
    await sleep(pollMs);
  }
}

export interface TranscribeOptions {
  onProgress?: (status: TranscribeStatus) => void;
  /** Asked while the engine works; yes cancels it and throws `JobStopped`. */
  shouldStop?: () => boolean;
  /** How often to ask the engine how far it is (tests make it short). */
  pollMs?: number;
}

export interface TranscribeResult {
  document: Document;
  undo: Undoable;
  /** The language the model heard, when it was left to tell. */
  language: string | null;
}

/** Transcribes one request into its document. */
export async function transcribeDocument(
  project: Project,
  speech: NonNullable<Platform['speech']>,
  req: TranscribeRequest,
  opts: TranscribeOptions = {},
): Promise<TranscribeResult> {
  const doc = await project.store.get('document', req.document_id);
  if (!doc || doc.deleted || !doc.media) throw new TranscriptionError('NO_RECORDING', 'the document has no recording');
  if (!(await transcribable(project, doc.id))) throw new TranscriptionError('HAS_TEXT', 'the document already has text');
  const stop = () => {
    if (opts.shouldStop?.()) throw new JobStopped();
  };
  stop();
  const poll = opts.pollMs ?? 500;
  await settle(speech, poll);
  const bytes = await project.readBlob(doc.media);
  stop();
  try {
    await speech.transcribe.start(bytes, { ext: extOf(doc.media.filename), language: req.language, channels: req.channels });
  } catch (e) {
    throw asTranscriptionError(e);
  }
  for (;;) {
    await sleep(poll);
    if (opts.shouldStop?.()) {
      await speech.transcribe.cancel().catch(() => undefined);
      await settle(speech, poll).catch(() => undefined);
      throw new JobStopped();
    }
    const status = await speech.transcribe.status();
    opts.onProgress?.(status);
    if (status.state === 'done') break;
    if (status.state === 'cancelled') throw new JobStopped();
    if (status.state === 'failed') throw new TranscriptionError(status.error?.code ?? 'ERROR', status.error?.message ?? 'transcription failed');
    if (status.state === 'idle') throw new TranscriptionError('ERROR', 'the transcription was lost');
  }
  const t = await speech.transcribe.take();
  if (!t) throw new TranscriptionError('ERROR', 'the transcription was lost');
  const layout = transcriptFromSpeech(t, req.speakers);
  if (!layout.text.trim()) throw new TranscriptionError('NO_SPEECH', 'no speech was heard');
  stop();
  try {
    const { document, undo } = await fillTranscript(project, doc.id, { text: layout.text, sync: layout.sync, engine: t.engine });
    return { document, undo, language: spokenLanguage(t) };
  } catch (e) {
    // Someone typed into the document meanwhile: their text stays.
    if (e instanceof ServiceError && e.code === 'invalid_argument') throw new TranscriptionError('HAS_TEXT', e.message);
    throw e;
  }
}

function asTranscriptionError(e: unknown): unknown {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && ['UNAVAILABLE', 'BUSY', 'UNSUPPORTED_AUDIO', 'MODEL_UNREADABLE'].includes(code)) {
    return new TranscriptionError(code, e instanceof Error ? e.message : code);
  }
  return e;
}

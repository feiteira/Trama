// A call recorded in Trama, stored as it is made: a WAV file (16-bit stereo, 16 kHz: the
// researcher's microphone on the left, what the computer played on the right) sealed frame by
// frame into a project blob, like every other file, so unencrypted audio never touches the disk
// and a crash loses only the last few seconds.
//
// The WAV header at the start of the first frame holds the length, known only at the end: the
// first frame is written with a zero length and rewritten (same size) when the recording stops.
// Frames are sealed as "not last"; the last frame, sealed as last, is written at the stop, so
// the finished blob opens like any other. The store meta key RECORDING_META names a recording
// in progress: when a project opens with it set, the recording was cut short (a crash, the
// power), and `recoverRecording` finishes the blob and makes its document.

import { frameStep, SEALED_HEADER, sealedHeader } from '../core/crypto/frames';
import { uuid } from '../core/ids';
import type { Document, MediaRef } from '../core/model/types';
import { wavHeader, WAV_HEADER_BYTES } from '../core/speech/wav';
import { PlatformError, RECORDING_RATE } from '../platform/types';
import { createDocument } from './documents';
import type { Project } from './project';
import { enqueueTranscription } from './transcription';
import { q } from './undo';

/** Store meta key: the recording in progress on this computer (JSON `OpenRecording`). */
export const RECORDING_META = 'recording.open';
/** About four seconds of a call: what a crash can lose at most. */
export const RECORDING_FRAME = 256 * 1024;
export const RECORDING_MIME = 'audio/wav';
const CHANNELS = 2;

/** What a recording will become, kept while it runs (and for recovery after a crash). */
export interface OpenRecording {
  blob_id: string;
  started_at: string;
  /** The document's name. */
  name: string;
  /** Names for the microphone's and the computer's track, for the transcript. */
  speakers: [string | null, string | null];
  /** ISO 639-1, or null to let the model tell. */
  language: string | null;
  case_id: string | null;
  /** Transcribe once it stops. */
  transcribe: boolean;
}

export function parseOpenRecording(raw: string | null): OpenRecording | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<OpenRecording>;
    if (typeof v.blob_id !== 'string' || typeof v.name !== 'string') return null;
    const name = (x: unknown) => (typeof x === 'string' ? x : null);
    return {
      blob_id: v.blob_id,
      started_at: typeof v.started_at === 'string' ? v.started_at : new Date().toISOString(),
      name: v.name,
      speakers: [name(v.speakers?.[0]), name(v.speakers?.[1])],
      language: name(v.language),
      case_id: name(v.case_id),
      transcribe: v.transcribe === true,
    };
  } catch {
    return null;
  }
}

/** The file name a recording's document keeps: the time it started, nothing identifying. */
export const recordingFilename = (startedAt: string): string => `recording-${startedAt.slice(0, 19).replace(/[:T]/g, '-')}.wav`;

/** Writes a recording into its blob as the audio arrives. */
export class RecordingWriter {
  private buffer: Uint8Array;
  private filled: number;
  private index = 0;
  /** The first frame's plaintext, rewritten with the real length at the end. */
  private head: Uint8Array | null = null;
  private data = 0;
  private queue: Promise<void> = Promise.resolve();
  private failed: unknown = null;

  private constructor(
    private readonly project: Project,
    readonly blobId: string,
  ) {
    this.buffer = new Uint8Array(RECORDING_FRAME);
    // The header's place; its length fields are filled in at the end.
    this.filled = WAV_HEADER_BYTES;
  }

  static async create(project: Project, blobId: string = uuid()): Promise<RecordingWriter> {
    await project.platform.blobs.append(project.id, blobId, sealedHeader(RECORDING_FRAME));
    return new RecordingWriter(project, blobId);
  }

  /** Bytes of audio received so far. */
  get bytes(): number {
    return this.data;
  }

  /** Takes audio (16-bit stereo PCM); full frames are sealed and stored in order. */
  write(pcm: Uint8Array): Promise<void> {
    this.data += pcm.length;
    const run = this.queue.then(async () => {
      if (this.failed) throw this.failed;
      let at = 0;
      while (at < pcm.length) {
        const n = Math.min(pcm.length - at, RECORDING_FRAME - this.filled);
        this.buffer.set(pcm.subarray(at, at + n), this.filled);
        this.filled += n;
        at += n;
        if (this.filled === RECORDING_FRAME) await this.flushFrame();
      }
    });
    this.queue = run.catch((e: unknown) => {
      this.failed ??= e;
    });
    return run;
  }

  private async flushFrame(): Promise<void> {
    const chunk = this.buffer.slice(0, this.filled);
    if (this.index === 0) this.head = chunk;
    const sealed = this.project.sealBlobFrame(this.blobId, chunk, this.index, false);
    await this.project.platform.blobs.append(this.project.id, this.blobId, sealed);
    this.index++;
    this.filled = 0;
  }

  /** Writes what is left and makes the blob a complete WAV file. */
  async finish(filename: string): Promise<MediaRef> {
    await this.queue;
    if (this.failed) throw this.failed;
    const { platform, id } = this.project;
    const header = wavHeader(this.data, RECORDING_RATE, CHANNELS);
    if (this.index === 0) {
      // Shorter than one frame: everything is still here.
      this.buffer.set(header, 0);
      const sealed = this.project.sealBlobFrame(this.blobId, this.buffer.slice(0, this.filled), 0, true);
      await platform.blobs.append(id, this.blobId, sealed);
    } else {
      // The length first, then the end: a crash in between leaves a recording `recoverRecording`
      // finishes.
      const head = this.head!;
      head.set(header, 0);
      await platform.blobs.writeAt(id, this.blobId, SEALED_HEADER, this.project.sealBlobFrame(this.blobId, head, 0, false));
      await platform.blobs.append(id, this.blobId, this.project.sealBlobFrame(this.blobId, this.buffer.slice(0, this.filled), this.index, true));
    }
    return { blob_id: this.blobId, filename, mime: RECORDING_MIME, size: WAV_HEADER_BYTES + this.data };
  }
}

/**
 * Makes the document of a finished recording, queues its transcription when that was asked
 * for, and forgets the recording in progress.
 */
export async function recordingDocument(project: Project, rec: OpenRecording, media: MediaRef): Promise<Document> {
  const { document } = await createDocument(project, {
    name: rec.name,
    kind: 'transcript',
    text: '',
    mediaRef: media,
    source: { filename: media.filename, format: 'recording', imported_at: rec.started_at },
    case_id: rec.case_id,
  });
  if (rec.transcribe) {
    await enqueueTranscription(project.store, { document_id: document.id, language: rec.language, channels: 'split', speakers: rec.speakers });
  }
  await project.store.deleteMeta(RECORDING_META);
  return document;
}

/**
 * Finishes a recording that a crash cut short (RECORDING_META still set when the project
 * opened): the frames that were stored are kept, a torn last one is cut off, the WAV length is
 * written and the blob closed; then its document is made. Returns it with what was recorded, or
 * null when there was nothing to keep. A recording still running here is not touched.
 */
export async function recoverRecording(project: Project, isRunning: (blobId: string) => boolean = () => false): Promise<{ document: Document; rec: OpenRecording } | null> {
  const rec = parseOpenRecording(await project.store.getMeta(RECORDING_META));
  if (!rec) {
    await project.store.deleteMeta(RECORDING_META);
    return null;
  }
  if (isRunning(rec.blob_id)) return null;
  const { platform, id } = project;
  const step = frameStep(RECORDING_FRAME);
  let size: number;
  try {
    size = await platform.blobs.size(id, rec.blob_id);
  } catch (e) {
    if (!(e instanceof PlatformError && e.code === 'NOT_FOUND')) throw e;
    size = 0;
  }
  const frames = Math.floor(Math.max(0, size - SEALED_HEADER) / step);
  const rest = Math.max(0, size - SEALED_HEADER) % step;
  const frameAt = (i: number, len = step) => platform.blobs.readRange(id, rec.blob_id, SEALED_HEADER + i * step, len);
  const opens = async (i: number, len: number, last: boolean) => {
    try {
      project.openBlobFrame(rec.blob_id, await frameAt(i, len), i, last);
      return true;
    } catch (e) {
      if (e instanceof PlatformError && e.code === 'LOCKED') throw e;
      return false;
    }
  };
  // Finished after all (the stop was cut short after the blob was closed)?
  let complete = false;
  let plain = 0;
  if (rest > 0 && (await opens(frames, rest, true))) {
    complete = true;
    plain = frames * RECORDING_FRAME + rest - 40;
  } else if (rest === 0 && frames > 0 && (await opens(frames - 1, step, true))) {
    complete = true;
    plain = frames * RECORDING_FRAME;
  }
  if (!complete) {
    if (frames === 0) {
      // Not even the first few seconds were stored.
      await platform.blobs.remove(id, rec.blob_id).catch(() => undefined);
      await project.store.deleteMeta(RECORDING_META);
      return null;
    }
    plain = frames * RECORDING_FRAME;
    const head = project.openBlobFrame(rec.blob_id, await frameAt(0), 0, false);
    head.set(wavHeader(plain - WAV_HEADER_BYTES, RECORDING_RATE, CHANNELS), 0);
    await platform.blobs.writeAt(id, rec.blob_id, SEALED_HEADER, project.sealBlobFrame(rec.blob_id, head, 0, false));
    // A torn frame after the last whole one is cut off; an empty last frame closes the blob.
    await platform.blobs.writeAt(id, rec.blob_id, SEALED_HEADER + frames * step, project.sealBlobFrame(rec.blob_id, new Uint8Array(0), frames, true), true);
  }
  const media: MediaRef = { blob_id: rec.blob_id, filename: recordingFilename(rec.started_at), mime: RECORDING_MIME, size: plain };
  const document = await recordingDocument(project, rec, media);
  await project.log('document.edit', `${q(document.name)} ← recovered recording`, { kind: 'document', id: document.id });
  return { document, rec };
}

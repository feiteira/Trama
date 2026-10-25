import { describe, expect, it } from 'vitest';
import { frameStep, SEALED_HEADER } from '../core/crypto/frames';
import { newRecoveryPhrase } from '../core/crypto/keyring';
import { WAV_HEADER_BYTES } from '../core/speech/wav';
import { fakePcm } from '../platform/fakeSpeech';
import { createMemoryPlatform } from '../platform/memory';
import { Library } from './library';
import { sweepBlobs } from './opening';
import {
  parseOpenRecording,
  RECORDING_FRAME,
  RECORDING_META,
  recordingDocument,
  recordingFilename,
  RecordingWriter,
  recoverRecording,
  type OpenRecording,
} from './recording';
import { FAST_KDF } from './testing';
import { transcriptionQueue } from './transcription';

async function setup() {
  const platform = createMemoryPlatform();
  const library = await Library.create(platform, { passphrase: 'pass word', recoveryPhrase: newRecoveryPhrase() }, { params: FAST_KDF });
  const project = await library.createProject({ name: 'Estudo', coderName: 'Ana' });
  return { platform, library, project };
}

const rec = (blob_id: string, transcribe = true): OpenRecording => ({
  blob_id,
  started_at: '2026-10-25T14:30:00.000Z',
  name: 'Call with P3',
  speakers: ['Ana', 'Participant'],
  language: 'pt',
  case_id: null,
  transcribe,
});

function wavFacts(wav: Uint8Array) {
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  return {
    riff: String.fromCharCode(...wav.subarray(0, 4)),
    channels: v.getUint16(22, true),
    rate: v.getUint32(24, true),
    dataBytes: v.getUint32(40, true),
  };
}

/** Writes `ms` of audio in uneven pieces, as the recorder delivers it. */
async function record(w: RecordingWriter, ms: number) {
  const pcm = fakePcm(ms);
  for (let at = 0, i = 0; at < pcm.length; i++) {
    const n = Math.min(pcm.length - at, 4 * (3001 + (i % 7) * 977));
    await w.write(pcm.subarray(at, at + n));
    at += n;
  }
  return pcm;
}

describe('a recording stored as it is made', () => {
  it('becomes a sealed WAV file that opens like any other, the length filled in at the end', async () => {
    const { platform, project } = await setup();
    const w = await RecordingWriter.create(project);
    const pcm = await record(w, 12_000); // three frames and a bit
    // Sealed as it goes: whole frames are on disk already, nothing readable.
    const stored = platform.blobStore(project.id).get(w.blobId)!;
    expect(stored.length).toBe(SEALED_HEADER + Math.floor((WAV_HEADER_BYTES + pcm.length) / RECORDING_FRAME) * frameStep(RECORDING_FRAME));
    const ref = await w.finish('recording.wav');
    expect(ref).toMatchObject({ blob_id: w.blobId, mime: 'audio/wav', size: WAV_HEADER_BYTES + pcm.length });
    const wav = await project.readBlob(ref);
    expect(wavFacts(wav)).toEqual({ riff: 'RIFF', channels: 2, rate: 16_000, dataBytes: pcm.length });
    expect(Buffer.compare(wav.subarray(WAV_HEADER_BYTES), pcm)).toBe(0);
  });

  it('handles a recording shorter than one frame, and one that ends on a frame boundary', async () => {
    const { project } = await setup();
    const short = await RecordingWriter.create(project);
    await record(short, 300);
    expect(wavFacts(await project.readBlob(await short.finish('a.wav'))).dataBytes).toBe(fakePcm(300).length);

    const exact = await RecordingWriter.create(project);
    await exact.write(new Uint8Array(2 * RECORDING_FRAME - WAV_HEADER_BYTES));
    const wav = await project.readBlob(await exact.finish('b.wav'));
    expect(wav.length).toBe(2 * RECORDING_FRAME);
  });

  it('is kept by the sweep while it has no document, and becomes a transcript document', async () => {
    const { platform, project } = await setup();
    const w = await RecordingWriter.create(project);
    await project.store.setMeta(RECORDING_META, JSON.stringify(rec(w.blobId)));
    await record(w, 5000);
    expect(await sweepBlobs(project)).toBe(0);
    const doc = await recordingDocument(project, rec(w.blobId), await w.finish(recordingFilename('2026-10-25T14:30:00.000Z')));
    expect(doc).toMatchObject({ name: 'Call with P3', kind: 'transcript', chars: 0, source: { format: 'recording', filename: 'recording-2026-10-25-14-30-00.wav' } });
    expect(doc.media?.blob_id).toBe(w.blobId);
    expect(await project.store.getMeta(RECORDING_META)).toBeNull();
    expect(await transcriptionQueue(project.store)).toEqual([{ document_id: doc.id, language: 'pt', channels: 'split', speakers: ['Ana', 'Participant'] }]);
    expect(platform.blobStore(project.id).has(w.blobId)).toBe(true);
  });
});

describe('a recording a crash cut short', () => {
  it('is finished when the project opens: whole frames kept, a torn one cut off', async () => {
    const { platform, library, project } = await setup();
    const w = await RecordingWriter.create(project);
    await project.store.setMeta(RECORDING_META, JSON.stringify(rec(w.blobId)));
    const pcm = await record(w, 13_000);
    // The crash: half a frame written, no stop.
    const blobs = platform.blobStore(project.id);
    const torn = blobs.get(w.blobId)!;
    const withTorn = new Uint8Array(torn.length + 1000);
    withTorn.set(torn);
    blobs.set(w.blobId, withTorn);
    const id = project.id;
    await library.closeProject();

    const again = await library.openProject(id);
    expect(await again.store.getMeta(RECORDING_META)).toBeNull();
    const docs = await again.store.list('document');
    expect(docs).toHaveLength(1);
    const wav = await again.readBlob(docs[0]!.media!);
    const kept = Math.floor((WAV_HEADER_BYTES + pcm.length) / RECORDING_FRAME) * RECORDING_FRAME - WAV_HEADER_BYTES;
    expect(wavFacts(wav).dataBytes).toBe(kept);
    expect(Buffer.compare(wav.subarray(WAV_HEADER_BYTES), pcm.subarray(0, kept))).toBe(0);
    expect(docs[0]!.media!.size).toBe(wav.length);
    // Queued to be transcribed, as asked when it started.
    expect((await transcriptionQueue(again.store)).map((r) => r.document_id)).toEqual([docs[0]!.id]);
  });

  it('is only made into a document when the stop already closed the blob', async () => {
    const { project } = await setup();
    const w = await RecordingWriter.create(project);
    await project.store.setMeta(RECORDING_META, JSON.stringify(rec(w.blobId, false)));
    const pcm = await record(w, 6000);
    await w.finish('x.wav');
    const r = await recoverRecording(project);
    expect(r?.document.media?.size).toBe(WAV_HEADER_BYTES + pcm.length);
    expect(wavFacts(await project.readBlob(r!.document.media!)).dataBytes).toBe(pcm.length);
    expect(await transcriptionQueue(project.store)).toEqual([]);
  });

  it('leaves nothing when not even the first seconds were stored', async () => {
    const { platform, project } = await setup();
    const w = await RecordingWriter.create(project);
    await project.store.setMeta(RECORDING_META, JSON.stringify(rec(w.blobId)));
    await record(w, 1000);
    expect(await recoverRecording(project)).toBeNull();
    expect(platform.blobStore(project.id).has(w.blobId)).toBe(false);
    expect(await project.store.getMeta(RECORDING_META)).toBeNull();
    expect(await project.store.list('document')).toEqual([]);
  });

  it('reads what it needs from the meta key, and ignores a damaged one', () => {
    expect(parseOpenRecording('{nope')).toBeNull();
    expect(parseOpenRecording(JSON.stringify({ blob_id: 'b', name: 'n' }))).toMatchObject({ blob_id: 'b', speakers: [null, null], transcribe: false });
  });
});

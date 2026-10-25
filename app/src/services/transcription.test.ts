import { describe, expect, it } from 'vitest';
import { newRecoveryPhrase } from '../core/crypto/keyring';
import { utf8 } from '../core/bytes';
import { createFakeSpeech } from '../platform/fakeSpeech';
import { createMemoryPlatform } from '../platform/memory';
import { createDocument, editDocumentText } from './documents';
import { JobStopped } from './jobs';
import { Library } from './library';
import { FAST_KDF } from './testing';
import {
  dequeueTranscription,
  enqueueTranscription,
  transcribable,
  transcribeDocument,
  TranscriptionError,
  transcriptionQueue,
  type TranscribeRequest,
} from './transcription';

async function setup() {
  const speech = createFakeSpeech();
  const platform = createMemoryPlatform({ speech });
  const library = await Library.create(platform, { passphrase: 'pass word', recoveryPhrase: newRecoveryPhrase() }, { params: FAST_KDF });
  const project = await library.createProject({ name: 'Estudo', coderName: 'Ana' });
  const { document } = await createDocument(project, {
    name: 'Entrevista 1',
    kind: 'transcript',
    text: '',
    media: { bytes: utf8('pretend audio'), filename: 'entrevista-1.M4A', mime: 'audio/mp4' },
  });
  return { speech, platform, project, doc: document };
}

const call: TranscribeRequest['speakers'] = ['Ana', 'P1'];

describe('transcribing a recording', () => {
  it('hands the decrypted recording to the engine and writes the turns into the document', async () => {
    const { speech, project, doc } = await setup();
    speech.answer = {
      tracks: [
        { segments: [{ start: 1000, end: 4000, text: 'Como começou?' }], language: 'pt' },
        { segments: [{ start: 5000, end: 9000, text: 'Há três anos, na horta.' }], language: 'pt' },
      ],
      duration: 10_000,
      engine: 'whisper.cpp test',
    };
    const seen: string[] = [];
    const r = await transcribeDocument(project, speech, { document_id: doc.id, language: null, channels: 'split', speakers: call }, { pollMs: 1, onProgress: (s) => seen.push(s.state) });
    expect(speech.last?.opts).toEqual({ ext: 'm4a', language: null, channels: 'split' });
    expect(new TextDecoder().decode(speech.last!.bytes)).toBe('pretend audio');
    expect(seen).toEqual(['transcribing', 'transcribing', 'done']);
    expect(r.language).toBe('pt');
    const dt = await project.store.get('doctext', doc.id);
    expect(dt?.text).toBe('Ana: Como começou?\nP1: Há três anos, na horta.');
    expect(dt?.sync).toEqual([
      { pos: 0, ms: 1000 },
      { pos: 19, ms: 5000 },
    ]);
    expect(r.document.chars).toBe(dt!.text.length);
    const log = (await project.store.list('log')).find((l) => l.summary.includes('whisper.cpp test'));
    expect(log).toMatchObject({ action: 'document.edit', target_id: doc.id, summary: '"Entrevista 1" ← whisper.cpp test' });
    // One undo step back to the empty document.
    await r.undo.undo();
    expect((await project.store.get('doctext', doc.id))?.text).toBe('');
  });

  it('refuses a document with text, and leaves text typed in meanwhile alone', async () => {
    const { speech, project, doc } = await setup();
    await editDocumentText(project, doc.id, 'Notas.');
    await expect(transcribeDocument(project, speech, { document_id: doc.id, language: null, channels: 'mix', speakers: [null] }, { pollMs: 1 })).rejects.toMatchObject({ code: 'HAS_TEXT' });
    expect(await transcribable(project, doc.id)).toBeNull();
  });

  it('tells apart nothing heard, an unreadable recording and a stop', async () => {
    const { speech, project, doc } = await setup();
    const req = { document_id: doc.id, language: 'pt', channels: 'mix', speakers: [null] } as const;
    await expect(transcribeDocument(project, speech, { ...req, speakers: [...req.speakers] }, { pollMs: 1 })).rejects.toMatchObject({ code: 'NO_SPEECH' });
    speech.failNext = 'UNSUPPORTED_AUDIO';
    const failed = transcribeDocument(project, speech, { ...req, speakers: [null] }, { pollMs: 1 });
    await expect(failed).rejects.toBeInstanceOf(TranscriptionError);
    await expect(failed).rejects.toMatchObject({ code: 'UNSUPPORTED_AUDIO' });
    let stop = false;
    const stopped = transcribeDocument(project, speech, { ...req, speakers: [null] }, { pollMs: 1, onProgress: () => (stop = true), shouldStop: () => stop });
    await expect(stopped).rejects.toBeInstanceOf(JobStopped);
    expect((await project.store.get('doctext', doc.id))?.text).toBe('');
  });
});

describe('the queue', () => {
  it('keeps one request per document, in order, on this computer', async () => {
    const { project } = await setup();
    const req = (id: string): TranscribeRequest => ({ document_id: id, language: null, channels: 'mix', speakers: [null] });
    await enqueueTranscription(project.store, req('a'));
    await enqueueTranscription(project.store, req('b'));
    await enqueueTranscription(project.store, { ...req('a'), language: 'es' });
    expect((await transcriptionQueue(project.store)).map((r) => [r.document_id, r.language])).toEqual([
      ['b', null],
      ['a', 'es'],
    ]);
    await dequeueTranscription(project.store, 'b');
    await dequeueTranscription(project.store, 'a');
    expect(await transcriptionQueue(project.store)).toEqual([]);
    expect(await project.store.getMeta('speech.queue')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { newRecoveryPhrase } from '../../core/crypto/keyring';
import { utf8 } from '../../core/bytes';
import { WAV_HEADER_BYTES } from '../../core/speech/wav';
import { createFakeSpeech } from '../../platform/fakeSpeech';
import { createMemoryPlatform } from '../../platform/memory';
import { createDocument } from '../../services/documents';
import { Library } from '../../services/library';
import { RECORDING_META } from '../../services/recording';
import { FAST_KDF } from '../../services/testing';
import { transcriptionQueue } from '../../services/transcription';
import { SpeechController, type SpeechEvent } from './controller';

async function setup() {
  const speech = createFakeSpeech();
  const platform = createMemoryPlatform({ speech });
  const library = await Library.create(platform, { passphrase: 'pass word', recoveryPhrase: newRecoveryPhrase() }, { params: FAST_KDF });
  const project = await library.createProject({ name: 'Estudo', coderName: 'Ana' });
  const controller = new SpeechController(project, speech, { pollMs: 1, tickMs: 5 });
  const events: SpeechEvent[] = [];
  controller.onEvent((e) => events.push(e));
  await controller.init();
  return { speech, platform, library, project, controller, events };
}

const until = async (cond: () => boolean | Promise<boolean>, ms = 3000) => {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 2));
  }
};

const start = { name: 'Call with P3', speakers: ['Ana', 'P3'] as [string, string], language: null, transcribe: true };

describe('recording a call', () => {
  it('stores the audio while it runs, saves a document at the stop and transcribes it', async () => {
    const { speech, project, controller, events } = await setup();
    speech.answer = {
      tracks: [
        { segments: [{ start: 0, end: 900, text: 'Can you hear me?' }], language: 'en' },
        { segments: [{ start: 1200, end: 2000, text: 'Yes, clearly.' }], language: 'en' },
      ],
      duration: 3000,
      engine: 'fake engine',
    };
    await controller.startRecording(start);
    expect(controller.snapshot.recording?.phase).toBe('recording');
    expect(controller.busy).toBe(true);
    expect(JSON.parse((await project.store.getMeta(RECORDING_META))!)).toMatchObject({ name: 'Call with P3', transcribe: true });
    await until(() => (controller.snapshot.recording?.status?.ms ?? 0) >= 6000);
    const doc = await controller.stopRecording();
    expect(controller.snapshot.recording).toBeNull();
    expect(doc).toMatchObject({ name: 'Call with P3', kind: 'transcript', source: { format: 'recording' } });
    const wav = await project.readBlob(doc!.media!);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
    expect(wav.length - WAV_HEADER_BYTES).toBe(new DataView(wav.buffer, wav.byteOffset).getUint32(40, true));
    expect(events[0]).toMatchObject({ type: 'recorded' });

    await until(() => events.some((e) => e.type === 'transcribed'));
    expect(speech.last?.opts.channels).toBe('split');
    expect((await project.store.get('doctext', doc!.id))?.text).toBe('Ana: Can you hear me?\nP3: Yes, clearly.');
    await until(() => controller.snapshot.current === null);
    expect(controller.snapshot.queue).toEqual([]);
    expect(controller.busy).toBe(false);
  });

  it('saves the recording when the project closes, and leaves its transcription queued', async () => {
    const { project, controller } = await setup();
    await controller.startRecording({ ...start, transcribe: true });
    await until(() => (controller.snapshot.recording?.status?.ms ?? 0) >= 5000);
    await controller.shutdown();
    const docs = await project.store.list('document');
    expect(docs.map((d) => d.name)).toEqual(['Call with P3']);
    expect(await project.store.getMeta(RECORDING_META)).toBeNull();
    // The speech model never ran: queued for when the project opens again.
    expect((await transcriptionQueue(project.store)).map((r) => r.document_id)).toEqual([docs[0]!.id]);
  });

  it('leaves nothing behind when no device can be opened', async () => {
    const { speech, platform, project, controller } = await setup();
    speech.noDevices = true;
    await expect(controller.startRecording(start)).rejects.toMatchObject({ code: 'NO_AUDIO_DEVICE' });
    expect(controller.snapshot.recording).toBeNull();
    expect(await project.store.getMeta(RECORDING_META)).toBeNull();
    expect(platform.blobStore(project.id).size).toBe(0);
  });
});

describe('the transcription queue', () => {
  it('works through requests one at a time, drops one that cannot be done, and can be cancelled', async () => {
    const { speech, project, controller, events } = await setup();
    speech.steps = 50;
    const media = { bytes: utf8('audio'), filename: 'a.mp3', mime: 'audio/mpeg' };
    const a = (await createDocument(project, { name: 'A', kind: 'transcript', text: '', media })).document;
    const b = (await createDocument(project, { name: 'B', kind: 'transcript', text: 'Has text already.', media })).document;
    await controller.request({ document_id: a.id, language: 'pt', channels: 'mix', speakers: [null] });
    await controller.request({ document_id: b.id, language: null, channels: 'mix', speakers: [null] });
    await until(() => controller.snapshot.current?.documentId === a.id);
    await controller.cancel(a.id);
    await until(() => controller.snapshot.current === null);
    expect(controller.snapshot.queue).toEqual([]);
    expect(events.filter((e) => e.type === 'transcribed')).toEqual([]);
    expect((await project.store.get('doctext', a.id))?.text).toBe('');
  });
});

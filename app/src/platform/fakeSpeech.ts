import type { Platform, RecorderStatus, TranscribeOptions, TranscribeStatus, Transcription } from './types';
import { PlatformError, RECORDING_RATE } from './types';

// A stand-in for the desktop's on-device speech, for tests: transcriptions are scripted, and the
// recorder hands out a quiet tone on the left (the researcher) and silence on the right as fast
// as it is asked. Not used by the app.

export interface FakeSpeech extends NonNullable<Platform['speech']> {
  /** What the next transcriptions return (computed from what was handed in, if a function). */
  answer: Transcription | ((bytes: Uint8Array, opts: TranscribeOptions) => Transcription);
  /** The next transcription fails with this code. */
  failNext: string | null;
  /** What the last transcription was handed. */
  last: { bytes: Uint8Array; opts: TranscribeOptions } | null;
  /** Status polls a transcription takes before it is done. */
  steps: number;
  /** Recorded milliseconds each recorder take hands out. */
  takeMs: number;
  /** The recorder cannot open any device. */
  noDevices: boolean;
}

/** `ms` of recorded audio: 16-bit stereo, a 300 Hz tone on the left. */
export function fakePcm(ms: number, startFrame = 0): Uint8Array {
  const frames = Math.round((ms * RECORDING_RATE) / 1000);
  const out = new Uint8Array(frames * 4);
  const v = new DataView(out.buffer);
  for (let i = 0; i < frames; i++) {
    v.setInt16(i * 4, Math.round(Math.sin((2 * Math.PI * 300 * (startFrame + i)) / RECORDING_RATE) * 3000), true);
  }
  return out;
}

export function createFakeSpeech(): FakeSpeech {
  let job: { left: number; result: Transcription | null; error: string | null; cancelled: boolean } | null = null;
  let recording: { frames: number; stopped: boolean } | null = null;
  const status = (): RecorderStatus => ({
    recording: !!recording && !recording.stopped,
    ms: recording ? Math.round((recording.frames * 1000) / RECORDING_RATE) : 0,
    mic: { open: true, level: 0.1, device: 'Test microphone', error: null },
    system: { open: true, level: 0, device: 'Test speakers', error: null },
  });
  const take = (): Uint8Array => {
    if (!recording || recording.stopped) return new Uint8Array(0);
    const pcm = fakePcm(fake.takeMs, recording.frames);
    recording.frames += pcm.length / 4;
    return pcm;
  };
  const fake: FakeSpeech = {
    answer: { tracks: [{ segments: [], language: null }], duration: 0, engine: 'fake engine' },
    failNext: null,
    last: null,
    steps: 2,
    takeMs: 1000,
    noDevices: false,
    info: async () => ({ transcribe: true, reason: null, engine: 'fake engine' }),
    transcribe: {
      async start(bytes, opts) {
        if (job && job.left > 0 && !job.cancelled) throw new PlatformError('BUSY', 'a transcription is running');
        fake.last = { bytes: bytes.slice(), opts };
        const error = fake.failNext;
        fake.failNext = null;
        job = { left: fake.steps, result: error ? null : typeof fake.answer === 'function' ? fake.answer(bytes, opts) : fake.answer, error, cancelled: false };
      },
      async status(): Promise<TranscribeStatus> {
        if (!job) return { state: 'idle', percent: 0, error: null };
        if (job.cancelled) return { state: 'cancelled', percent: 0, error: null };
        if (job.left > 0) {
          job.left--;
          return { state: 'transcribing', percent: Math.round(100 / (job.left + 1)), error: null };
        }
        if (job.error) return { state: 'failed', percent: 0, error: { code: job.error, message: job.error } };
        return { state: 'done', percent: 100, error: null };
      },
      async take() {
        if (!job || job.left > 0 || job.cancelled || job.error) return null;
        const r = job.result;
        job = null;
        return r;
      },
      async cancel() {
        if (job) job.cancelled = true;
      },
    },
    recorder: {
      async start() {
        if (fake.noDevices) throw new PlatformError('NO_AUDIO_DEVICE', 'no microphone');
        if (recording && !recording.stopped) throw new PlatformError('BUSY', 'already recording');
        recording = { frames: 0, stopped: false };
        return status();
      },
      status: async () => (recording && !recording.stopped ? status() : null),
      take: async () => take(),
      async stop() {
        const rest = take();
        if (recording) recording.stopped = true;
        return rest;
      },
    },
  };
  return fake;
}

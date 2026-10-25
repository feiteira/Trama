#!/usr/bin/env node
// Puts the speech model files in desktop/src-tauri/resources/speech, where release builds bundle
// them (tauri.speech.conf.json) and debug builds find them. Run before `tauri build`; the npm
// scripts and CI do. This is the only download in Trama's build, and the app itself never
// downloads anything: the files ship inside the installers.
//
// Each file is checked against its SHA-256 below; a file already in place with the right hash is
// kept. TRAMA_SPEECH_MODELS_FROM=<folder> copies the files from a local folder instead (offline
// builds, a CI cache).
//
// The files are whisper.cpp's large-v3-turbo model quantised to 5 bits and the Silero
// voice-activity model, as published by the whisper.cpp project (both MIT-licensed).

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'desktop', 'src-tauri', 'resources', 'speech');

export const FILES = [
  {
    name: 'ggml-large-v3-turbo-q5_0.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
    size: 574_041_195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
  },
  {
    name: 'ggml-silero-v5.1.2.bin',
    url: 'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin',
    size: 885_098,
    sha256: '29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf',
  },
];

async function sha256(path) {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
}

async function good(path, f) {
  return existsSync(path) && statSync(path).size === f.size && (await sha256(path)) === f.sha256;
}

async function download(f, part) {
  const res = await fetch(f.url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`${f.name}: HTTP ${res.status}`);
  let received = 0;
  let shown = -1;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    received += chunk.length;
    const pct = Math.floor((received / f.size) * 100);
    if (process.stdout.isTTY && pct !== shown && pct % 5 === 0) {
      shown = pct;
      process.stdout.write(`\r  ${f.name}: ${pct}%`);
    }
  });
  await pipeline(body, createWriteStream(part));
  if (process.stdout.isTTY) process.stdout.write('\n');
}

async function main() {
  mkdirSync(target, { recursive: true });
  const from = process.env.TRAMA_SPEECH_MODELS_FROM;
  for (const f of FILES) {
    const dest = join(target, f.name);
    if (await good(dest, f)) {
      console.log(`speech model: ${f.name} ok`);
      continue;
    }
    const part = `${dest}.part`;
    rmSync(part, { force: true });
    if (from) {
      console.log(`speech model: copying ${f.name} from ${from}`);
      copyFileSync(join(from, f.name), part);
    } else {
      console.log(`speech model: downloading ${f.name} (${Math.round(f.size / 1e6)} MB)`);
      await download(f, part);
    }
    if (!(await good(part, f))) {
      rmSync(part, { force: true });
      throw new Error(`${f.name}: wrong size or SHA-256; nothing was kept`);
    }
    renameSync(part, dest);
    console.log(`speech model: ${f.name} ok`);
  }
}

main().catch((e) => {
  console.error(`fetch-speech-models: ${e.message}`);
  process.exit(1);
});

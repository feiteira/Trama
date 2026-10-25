import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { concatBytes, randomBytes, readU32be, u32be, utf8 } from '../bytes';

// Chunked authenticated encryption for attachments, backups and exports.
// Layout: magic "TRAMF1" | u32 frame size | frames…
// Each frame: 24-byte random nonce | XChaCha20-Poly1305 ciphertext (+16-byte tag).
// The AAD binds each frame to its purpose, its position and whether it is the last one,
// so frames cannot be reordered, swapped between files or truncated unnoticed.

const MAGIC = utf8('TRAMF1');
export const FRAME_SIZE = 1 << 20;
/** The magic and the frame size, before the first frame. */
export const SEALED_HEADER = 10;
/** Bytes a sealed frame of `frameSize` plaintext bytes takes: nonce, ciphertext, tag. */
export const frameStep = (frameSize: number): number => 24 + frameSize + 16;

function aad(context: Uint8Array, index: number, last: boolean): Uint8Array {
  return concatBytes(context, u32be(index), new Uint8Array([last ? 1 : 0]));
}

/** What a sealed file starts with. */
export function sealedHeader(frameSize = FRAME_SIZE): Uint8Array {
  return concatBytes(MAGIC, u32be(frameSize));
}

/**
 * One frame, for a file written piece by piece (a recording): every frame but the last holds
 * exactly `frameSize` bytes; the last holds the rest, possibly nothing.
 */
export function sealFrame(key: Uint8Array, chunk: Uint8Array, context: string, index: number, last: boolean): Uint8Array {
  const nonce = randomBytes(24);
  return concatBytes(nonce, xchacha20poly1305(key, nonce, aad(utf8(context), index, last)).encrypt(chunk));
}

/** Opens one frame sealed by `sealFrame` (or `seal`); throws DecryptError. */
export function openFrame(key: Uint8Array, frame: Uint8Array, context: string, index: number, last: boolean): Uint8Array {
  try {
    return xchacha20poly1305(key, frame.subarray(0, 24), aad(utf8(context), index, last)).decrypt(frame.subarray(24));
  } catch {
    throw new DecryptError();
  }
}

export function seal(key: Uint8Array, plaintext: Uint8Array, context: string, frameSize = FRAME_SIZE): Uint8Array {
  const parts: Uint8Array[] = [sealedHeader(frameSize)];
  const count = Math.max(1, Math.ceil(plaintext.length / frameSize));
  for (let i = 0; i < count; i++) {
    parts.push(sealFrame(key, plaintext.subarray(i * frameSize, (i + 1) * frameSize), context, i, i === count - 1));
  }
  return concatBytes(...parts);
}

export class DecryptError extends Error {
  constructor() {
    super('The file could not be decrypted: wrong key, or the file is damaged.');
  }
}

export function isSealed(bytes: Uint8Array): boolean {
  return bytes.length >= 10 && MAGIC.every((b, i) => bytes[i] === b);
}

export function open(key: Uint8Array, sealed: Uint8Array, context: string): Uint8Array {
  if (!isSealed(sealed)) throw new DecryptError();
  const ctx = utf8(context);
  const frameSize = readU32be(sealed, 6);
  const step = 24 + frameSize + 16;
  const parts: Uint8Array[] = [];
  let offset = 10;
  let index = 0;
  if (offset >= sealed.length) throw new DecryptError();
  while (offset < sealed.length) {
    const end = Math.min(offset + step, sealed.length);
    const last = end === sealed.length;
    const nonce = sealed.subarray(offset, offset + 24);
    try {
      parts.push(xchacha20poly1305(key, nonce, aad(ctx, index, last)).decrypt(sealed.subarray(offset + 24, end)));
    } catch {
      throw new DecryptError();
    }
    offset = end;
    index++;
  }
  return concatBytes(...parts);
}

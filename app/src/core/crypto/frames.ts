import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { concatBytes, randomBytes, readU32be, u32be, utf8 } from '../bytes';

// Chunked authenticated encryption for attachments, backups and exports.
// Layout: magic "TRAMF1" | u32 frame size | frames…
// Each frame: 24-byte random nonce | XChaCha20-Poly1305 ciphertext (+16-byte tag).
// The AAD binds each frame to its purpose, its position and whether it is the last one,
// so frames cannot be reordered, swapped between files or truncated unnoticed.

const MAGIC = utf8('TRAMF1');
export const FRAME_SIZE = 1 << 20;

function aad(context: Uint8Array, index: number, last: boolean): Uint8Array {
  return concatBytes(context, u32be(index), new Uint8Array([last ? 1 : 0]));
}

export function seal(key: Uint8Array, plaintext: Uint8Array, context: string, frameSize = FRAME_SIZE): Uint8Array {
  const ctx = utf8(context);
  const parts: Uint8Array[] = [MAGIC, u32be(frameSize)];
  const count = Math.max(1, Math.ceil(plaintext.length / frameSize));
  for (let i = 0; i < count; i++) {
    const chunk = plaintext.subarray(i * frameSize, (i + 1) * frameSize);
    const nonce = randomBytes(24);
    parts.push(nonce, xchacha20poly1305(key, nonce, aad(ctx, i, i === count - 1)).encrypt(chunk));
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

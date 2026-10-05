import { argon2idAsync } from '@noble/hashes/argon2.js';

export interface KdfParams {
  algo: 'argon2id';
  m: number; // memory, KiB
  t: number; // iterations
  p: number; // parallelism
  key_len: number;
}

/** Trama's frozen Argon2id parameters (64 MiB, 3 passes, 4 lanes, 32-byte key). */
export const ARGON2_PARAMS: KdfParams = { algo: 'argon2id', m: 65536, t: 3, p: 4, key_len: 32 };

/** Derives a key from a secret. Platforms supply a native implementation when they have one. */
export type Kdf = (secret: Uint8Array, salt: Uint8Array, params: KdfParams) => Promise<Uint8Array>;

/** Pure-JS Argon2id: slow but everywhere. Used in tests and the browser demo. */
export const jsKdf: Kdf = (secret, salt, params) =>
  argon2idAsync(secret, salt, { m: params.m, t: params.t, p: params.p, dkLen: params.key_len });

/** Passphrases are compared as Unicode NFC, so "Inês" typed on any keyboard unlocks the same way. */
export const normalizePassphrase = (s: string): string => s.normalize('NFC');

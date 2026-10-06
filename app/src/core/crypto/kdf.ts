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

/**
 * The Argon2id parameters Trama accepts from a file (a .trama header, a keyring slot): at most
 * 256 MiB, 10 passes, 8 lanes, a 32-byte key. Trama only ever writes ARGON2_PARAMS (and tests the
 * fast test parameters); anything larger in a file is crafted, and would cost minutes of CPU and
 * gigabytes of memory on every unlock attempt.
 */
export const KDF_LIMITS = { mMax: 262_144, tMax: 10, pMax: 8 } as const;

/** Thrown for Argon2id parameters outside KDF_LIMITS. */
export class KdfParamsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KdfParamsError';
  }
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

/** Throws KdfParamsError unless the parameters are ones Trama would use (see KDF_LIMITS). */
export function checkKdfParams(params: KdfParams): void {
  const { algo, m, t, p, key_len } = params as Partial<Record<keyof KdfParams, unknown>>;
  if (algo !== 'argon2id') throw new KdfParamsError(`unsupported KDF ${String(algo)}`);
  if (key_len !== 32) throw new KdfParamsError('argon2id key length must be 32');
  if (!isInt(p) || p < 1 || p > KDF_LIMITS.pMax) throw new KdfParamsError('argon2id parallelism out of range');
  if (!isInt(t) || t < 1 || t > KDF_LIMITS.tMax) throw new KdfParamsError('argon2id passes out of range');
  if (!isInt(m) || m < 8 * p || m > KDF_LIMITS.mMax) throw new KdfParamsError('argon2id memory out of range');
}

/** Derives a key from a secret. Platforms supply a native implementation when they have one. */
export type Kdf = (secret: Uint8Array, salt: Uint8Array, params: KdfParams) => Promise<Uint8Array>;

/** Pure-JS Argon2id: slow but everywhere. Used in tests and the browser demo. */
export const jsKdf: Kdf = async (secret, salt, params) => {
  checkKdfParams(params);
  return argon2idAsync(secret, salt, { m: params.m, t: params.t, p: params.p, dkLen: params.key_len });
};

/** Passphrases are compared as Unicode NFC, so "Inês" typed on any keyboard unlocks the same way. */
export const normalizePassphrase = (s: string): string => s.normalize('NFC');

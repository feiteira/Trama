import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { fromBase64, randomBytes, toBase64, utf8, wipe } from '../bytes';
import { ARGON2_PARAMS, checkKdfParams, type Kdf, type KdfParams, normalizePassphrase } from './kdf';

// The keyring protects the library key (the random key the local database and attachments
// are encrypted with). It holds that key wrapped twice: once under the passphrase and once
// under the 12-word recovery phrase. Either unlocks the library. The keyring file itself
// contains no readable secret, so it can live next to the database and inside backups.

export type SlotKind = 'passphrase' | 'recovery_phrase';

export interface KeySlot {
  kind: SlotKind;
  kdf: KdfParams & { salt: string };
  nonce: string;
  ct: string; // AES-256-GCM(KEK, library key), base64
  created_at: string;
}

export interface Keyring {
  format: 'trama-keyring';
  v: 1;
  slots: KeySlot[];
}

export class WrongSecretError extends Error {
  constructor() {
    super('That passphrase or recovery phrase does not unlock this library.');
  }
}

const AAD = utf8('trama.keyring.v1');

export function newLibraryKey(): Uint8Array {
  return randomBytes(32);
}

export function newRecoveryPhrase(): string {
  return generateMnemonic(wordlist, 128);
}

export function normalizeRecoveryPhrase(s: string): string {
  return s.trim().toLowerCase().split(/\s+/).join(' ');
}

export function isValidRecoveryPhrase(s: string): boolean {
  return validateMnemonic(normalizeRecoveryPhrase(s), wordlist);
}

function secretBytes(kind: SlotKind, secret: string): Uint8Array {
  return utf8(kind === 'passphrase' ? normalizePassphrase(secret) : normalizeRecoveryPhrase(secret));
}

async function makeSlot(kind: SlotKind, secret: string, libraryKey: Uint8Array, kdf: Kdf, params: KdfParams, now: Date): Promise<KeySlot> {
  const salt = randomBytes(32);
  const kek = await kdf(secretBytes(kind, secret), salt, params);
  try {
    const nonce = randomBytes(12);
    const ct = gcm(kek, nonce, AAD).encrypt(libraryKey);
    return { kind, kdf: { ...params, salt: toBase64(salt) }, nonce: toBase64(nonce), ct: toBase64(ct), created_at: now.toISOString() };
  } finally {
    wipe(kek);
  }
}

export async function createKeyring(
  libraryKey: Uint8Array,
  secrets: { passphrase: string; recoveryPhrase: string },
  kdf: Kdf,
  opts: { params?: KdfParams; now?: Date } = {},
): Promise<Keyring> {
  const params = opts.params ?? ARGON2_PARAMS;
  const now = opts.now ?? new Date();
  return {
    format: 'trama-keyring',
    v: 1,
    slots: [
      await makeSlot('passphrase', secrets.passphrase, libraryKey, kdf, params, now),
      await makeSlot('recovery_phrase', secrets.recoveryPhrase, libraryKey, kdf, params, now),
    ],
  };
}

/** Unwraps the library key with the passphrase or the recovery phrase. */
export async function unlockKeyring(keyring: Keyring, kind: SlotKind, secret: string, kdf: Kdf): Promise<Uint8Array> {
  const slot = keyring.slots.find((s) => s.kind === kind);
  if (!slot) throw new WrongSecretError();
  const { salt, ...params } = slot.kdf;
  // A keyring can come from a file (a backup's header): never run crafted, ruinous parameters.
  checkKdfParams(params);
  const kek = await kdf(secretBytes(kind, secret), fromBase64(salt), params);
  try {
    return gcm(kek, fromBase64(slot.nonce), AAD).decrypt(fromBase64(slot.ct));
  } catch {
    throw new WrongSecretError();
  } finally {
    wipe(kek);
  }
}

/** Replaces one slot (a new passphrase, or a new recovery phrase) without changing the library key. */
export async function replaceSlot(
  keyring: Keyring,
  kind: SlotKind,
  secret: string,
  libraryKey: Uint8Array,
  kdf: Kdf,
  opts: { params?: KdfParams; now?: Date } = {},
): Promise<Keyring> {
  const slot = await makeSlot(kind, secret, libraryKey, kdf, opts.params ?? ARGON2_PARAMS, opts.now ?? new Date());
  return { ...keyring, slots: [...keyring.slots.filter((s) => s.kind !== kind), slot] };
}

export function parseKeyring(json: string): Keyring {
  const k = JSON.parse(json) as Keyring;
  if (k.format !== 'trama-keyring' || k.v !== 1 || !Array.isArray(k.slots)) throw new Error('not a Trama keyring');
  return k;
}

/** Derives a purpose-specific key from the library key (attachments, backups…). */
export function subkey(libraryKey: Uint8Array, info: string, salt: Uint8Array = new Uint8Array(0)): Uint8Array {
  return hkdf(sha256, libraryKey, salt, utf8(info), 32);
}

import { describe, expect, it } from 'vitest';
import vectors from '../../../../test-vectors/argon2id.json';
import { fromHex, randomBytes, toHex, utf8 } from '../bytes';
import { DecryptError, open, seal } from './frames';
import { jsKdf, type KdfParams } from './kdf';
import {
  createKeyring, isValidRecoveryPhrase, newLibraryKey, newRecoveryPhrase, parseKeyring,
  replaceSlot, unlockKeyring, WrongSecretError,
} from './keyring';

const FAST: KdfParams = { algo: 'argon2id', m: 64, t: 1, p: 1, key_len: 32 };

describe('argon2id shared vectors', () => {
  for (const v of vectors.vectors) {
    it(v.name, async () => {
      const out = await jsKdf(utf8(v.secret_utf8), fromHex(v.salt_hex), { algo: 'argon2id', m: v.m, t: v.t, p: v.p, key_len: v.len });
      expect(toHex(out)).toBe(v.out_hex);
    });
  }
});

describe('keyring', () => {
  it('unlocks with the passphrase or the recovery phrase, and not otherwise', async () => {
    const key = newLibraryKey();
    const phrase = newRecoveryPhrase();
    expect(isValidRecoveryPhrase(phrase)).toBe(true);
    const ring = parseKeyring(JSON.stringify(await createKeyring(key, { passphrase: 'Inês é ótima', recoveryPhrase: phrase }, jsKdf, { params: FAST })));
    expect(await unlockKeyring(ring, 'passphrase', 'Inês é ótima', jsKdf)).toEqual(key);
    // NFD input (as some keyboards produce) unlocks too.
    expect(await unlockKeyring(ring, 'passphrase', 'Inês é ótima'.normalize('NFD'), jsKdf)).toEqual(key);
    expect(await unlockKeyring(ring, 'recovery_phrase', `  ${phrase.toUpperCase()} `, jsKdf)).toEqual(key);
    await expect(unlockKeyring(ring, 'passphrase', 'wrong', jsKdf)).rejects.toBeInstanceOf(WrongSecretError);
  });

  it('changes the passphrase without changing the practice key', async () => {
    const key = newLibraryKey();
    const ring = await createKeyring(key, { passphrase: 'old one', recoveryPhrase: newRecoveryPhrase() }, jsKdf, { params: FAST });
    const next = await replaceSlot(ring, 'passphrase', 'new one', key, jsKdf, { params: FAST });
    expect(await unlockKeyring(next, 'passphrase', 'new one', jsKdf)).toEqual(key);
    await expect(unlockKeyring(next, 'passphrase', 'old one', jsKdf)).rejects.toBeInstanceOf(WrongSecretError);
    expect(next.slots).toHaveLength(2);
  });
});

describe('frames', () => {
  const key = randomBytes(32);

  it('round-trips empty, small and multi-frame data', () => {
    for (const size of [0, 1, 99, 100, 101, 1000]) {
      const data = randomBytes(size);
      expect(open(key, seal(key, data, 'test', 100), 'test')).toEqual(data);
    }
  });

  it('rejects a wrong key, a wrong context, tampering and truncation', () => {
    const data = randomBytes(350);
    const sealed = seal(key, data, 'attachment', 100);
    expect(() => open(randomBytes(32), sealed, 'attachment')).toThrow(DecryptError);
    expect(() => open(key, sealed, 'backup')).toThrow(DecryptError);
    const tampered = sealed.slice();
    tampered[50] = tampered[50]! ^ 1;
    expect(() => open(key, tampered, 'attachment')).toThrow(DecryptError);
    const frame = 24 + 100 + 16;
    expect(() => open(key, sealed.subarray(0, 10 + frame * 2), 'attachment')).toThrow(DecryptError);
  });
});

import { describe, expect, it, vi } from 'vitest';
import vectors from '../../../../test-vectors/argon2id.json';
import { fromHex, fromUtf8, randomBytes, toHex, utf8 } from '../bytes';
import { DecryptError, frameStep, isSealed, open, openFrame, seal, sealedHeader, sealFrame, SEALED_HEADER } from './frames';
import { jsKdf, type KdfParams } from './kdf';
import {
  createKeyring, isValidRecoveryPhrase, newLibraryKey, newRecoveryPhrase, parseKeyring,
  replaceSlot, subkey, unlockKeyring, WrongSecretError,
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

  it('changes the passphrase without changing the library key', async () => {
    const key = newLibraryKey();
    const ring = await createKeyring(key, { passphrase: 'old one', recoveryPhrase: newRecoveryPhrase() }, jsKdf, { params: FAST });
    const next = await replaceSlot(ring, 'passphrase', 'new one', key, jsKdf, { params: FAST });
    expect(await unlockKeyring(next, 'passphrase', 'new one', jsKdf)).toEqual(key);
    await expect(unlockKeyring(next, 'passphrase', 'old one', jsKdf)).rejects.toBeInstanceOf(WrongSecretError);
    expect(next.slots).toHaveLength(2);
  });

  it('is a Trama keyring and refuses anything else', async () => {
    const ring = await createKeyring(newLibraryKey(), { passphrase: 'p', recoveryPhrase: newRecoveryPhrase() }, jsKdf, { params: FAST });
    expect(ring.format).toBe('trama-keyring');
    expect(parseKeyring(JSON.stringify(ring)).slots).toHaveLength(2);
    expect(() => parseKeyring(JSON.stringify({ ...ring, format: 'sala-keyring' }))).toThrow();
    expect(() => parseKeyring(JSON.stringify({ ...ring, v: 2 }))).toThrow();
  });

  it('derives independent subkeys per purpose and salt', () => {
    const key = newLibraryKey();
    const a = toHex(subkey(key, 'trama.project.v1', utf8('a')));
    expect(toHex(subkey(key, 'trama.project.v1', utf8('a')))).toBe(a);
    expect(toHex(subkey(key, 'trama.project.v1', utf8('b')))).not.toBe(a);
    expect(toHex(subkey(key, 'trama.library.v1'))).not.toBe(a);
  });
});

describe('frames', () => {
  const key = randomBytes(32);

  it('starts with the TRAMF1 magic', () => {
    const sealed = seal(key, utf8('x'), 'test');
    expect(fromUtf8(sealed.subarray(0, 6))).toBe('TRAMF1');
    expect(isSealed(sealed)).toBe(true);
    expect(isSealed(utf8('SALAF1xxxxxxxxxx'))).toBe(false);
  });

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

  it('opens a file sealed frame by frame, with an empty last frame, like one sealed at once', () => {
    const data = randomBytes(300);
    const parts = [sealedHeader(100)];
    for (let i = 0; i < 3; i++) parts.push(sealFrame(key, data.subarray(i * 100, (i + 1) * 100), 'rec', i, false));
    parts.push(sealFrame(key, new Uint8Array(0), 'rec', 3, true));
    const file = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      file.set(p, at);
      at += p.length;
    }
    expect(open(key, file, 'rec')).toEqual(data);
    // A frame rewritten in place (same length) opens too; one not sealed as last cannot end a file.
    file.set(sealFrame(key, new Uint8Array(100).fill(7), 'rec', 0, false), SEALED_HEADER);
    expect(open(key, file, 'rec').subarray(0, 100)).toEqual(new Uint8Array(100).fill(7));
    const unfinished = file.subarray(0, SEALED_HEADER + 3 * frameStep(100));
    expect(() => open(key, unfinished, 'rec')).toThrow(DecryptError);
    expect(openFrame(key, unfinished.subarray(SEALED_HEADER + frameStep(100), SEALED_HEADER + 2 * frameStep(100)), 'rec', 1, false)).toEqual(data.subarray(100, 200));
    expect(() => openFrame(key, unfinished.subarray(SEALED_HEADER, SEALED_HEADER + frameStep(100)), 'rec', 0, true)).toThrow(DecryptError);
  });
});

describe('Argon2id parameters from files are bounded', () => {
  it('refuses crafted parameters before running them, in the JS KDF and when unlocking a keyring', async () => {
    const { checkKdfParams, ARGON2_PARAMS, KdfParamsError } = await import('./kdf');
    expect(() => checkKdfParams(ARGON2_PARAMS)).not.toThrow();
    expect(() => checkKdfParams({ algo: 'argon2id', m: 64, t: 1, p: 1, key_len: 32 })).not.toThrow();
    for (const bad of [
      { m: 4_194_304, t: 1000, p: 255 },
      { m: 262_145, t: 3, p: 4 },
      { m: 65536, t: 11, p: 4 },
      { m: 65536, t: 3, p: 9 },
      { m: 16, t: 3, p: 4 },
      { m: 65536, t: 3, p: 4, key_len: 64 },
    ]) {
      const params = { algo: 'argon2id' as const, key_len: 32, ...bad };
      expect(() => checkKdfParams(params)).toThrow(KdfParamsError);
      await expect(jsKdf(new Uint8Array(4), new Uint8Array(16), params)).rejects.toBeInstanceOf(KdfParamsError);
    }
    const fast = { algo: 'argon2id' as const, m: 64, t: 1, p: 1, key_len: 32 };
    const spy = vi.fn(jsKdf);
    const keyring = await createKeyring(newLibraryKey(), { passphrase: 'pass word', recoveryPhrase: newRecoveryPhrase() }, jsKdf, { params: fast });
    const crafted = { ...keyring, slots: keyring.slots.map((s) => ({ ...s, kdf: { ...s.kdf, m: 2_097_152, t: 10, p: 16 } })) };
    await expect(unlockKeyring(crafted, 'passphrase', 'pass word', spy)).rejects.toBeInstanceOf(KdfParamsError);
    expect(spy).not.toHaveBeenCalled();
  });
});

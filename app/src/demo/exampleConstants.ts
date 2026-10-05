import type { KdfParams } from '../core/crypto/kdf';

// The example library's well-known secrets, apart from its content so that screens (the unlock
// screen's hint) can name them without pulling the example study into the main bundle.

export const EXAMPLE_PASSPHRASE = 'trama';
/** A valid BIP-39 phrase that is obviously not a secret. */
export const EXAMPLE_RECOVERY_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
/** Fast key derivation: the example protects nothing. */
export const EXAMPLE_KDF: KdfParams = { algo: 'argon2id', m: 1024, t: 1, p: 1, key_len: 32 };

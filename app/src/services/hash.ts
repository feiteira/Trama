import { sha256 } from '@noble/hashes/sha2.js';
import { toHex } from '../core/bytes';

/** SHA-256 of a text (UTF-8), in hex. */
export const textSha256 = (text: string): string => toHex(sha256(new TextEncoder().encode(text)));

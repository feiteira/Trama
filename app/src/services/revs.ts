// Revision ids of document texts (`DocText.revs`): how a merge tells a teammate's text made
// after this one (it lists this text's latest revision) from one edited on both sides.
//
// Every write of a text gets a fresh random id: an edit, pseudonymisation, an undo or redo, a
// conflict resolved. Content hashes would not do: an undo back to an earlier text would look
// like that earlier revision and let an older copy pass for a newer one.

import { randomBytes, toHex } from '../core/bytes';
import type { DocText } from '../core/model/types';
import { REVS_MAX } from '../core/model/types';
import { textSha256 } from './hash';

/** A new revision id: 16 hex digits. */
export const newRevId = (): string => toHex(randomBytes(8));

/** The content hash older versions of Trama used as revision id (a text without `revs`). */
export const textRev = (text: string): string => textSha256(text).slice(0, 16);

/** Marks a teammate's revision that a conflict saw and kept this text over (see `seenRev`). */
const SEEN = '~';

/** The id of a teammate's revision that this text was kept over in a conflict. */
export const seenRev = (rev: string): string => (rev.startsWith(SEEN) ? rev : SEEN + rev);

/** A text's revisions, oldest first: `revs`, or for a text from an older Trama, its hash. */
export function revsOf(t: Pick<DocText, 'text' | 'revs'>): string[] {
  return t.revs?.length ? t.revs : [textRev(t.text)];
}

/** The text's latest revision. */
export const latestRev = (t: Pick<DocText, 'text' | 'revs'>): string => revsOf(t)[revsOf(t).length - 1]!;

/** Keeps the newest REVS_MAX ids. */
export const capRevs = (revs: readonly string[]): string[] => revs.slice(-REVS_MAX);

/** The revisions after the text changed again (a new id appended). */
export function appendRev(t: Pick<DocText, 'text' | 'revs'>): string[] {
  return capRevs([...revsOf(t), newRevId()]);
}

/**
 * How `t` relates to the revision `rev` of another copy: 'listed' when `t` was made from it,
 * 'seen' when `t` was kept over it in a conflict (the other side's changes did not come in),
 * or null.
 */
export function knows(t: Pick<DocText, 'text' | 'revs'>, rev: string): 'listed' | 'seen' | null {
  const list = revsOf(t);
  const plain = rev.startsWith(SEEN) ? rev.slice(1) : rev;
  if (list.includes(rev)) return 'listed';
  if (rev.startsWith(SEEN) && list.includes(plain)) return 'listed';
  if (list.includes(SEEN + plain)) return 'seen';
  return null;
}

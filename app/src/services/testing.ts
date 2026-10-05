// Test helpers shared by service and feature tests. Not imported by the app itself.
import { toHex } from '../core/bytes';
import { sha256 } from '@noble/hashes/sha2.js';
import { uuid } from '../core/ids';
import type { Coder, LogAction, MediaRef } from '../core/model/types';
import { Store } from '../core/store/store';
import { SqlJsDb } from '../platform/sqljs';
import type { ProjectContext } from './context';

export const FAST_KDF = { algo: 'argon2id', m: 64, t: 1, p: 1, key_len: 32 } as const;

export interface TestProject extends ProjectContext {
  /** Blob bytes by blob id (unencrypted here). */
  blobs: Map<string, Uint8Array>;
  /** Switches who "me" is, to simulate a second coder. */
  actAs(coder: Coder): void;
}

/** A project over an in-memory database, with one coder ("Ana"), for service tests. */
export async function makeTestProject(opts: { now?: () => Date; coderName?: string } = {}): Promise<TestProject> {
  const store = await Store.open(await SqlJsDb.create(), { now: opts.now });
  let me = await store.put('coder', { name: opts.coderName ?? 'Ana', color: '#3a6ea5' });
  await store.setMeta('me', me.id);
  const blobs = new Map<string, Uint8Array>();
  const now = opts.now ?? (() => new Date());
  return {
    id: store.projectId,
    store,
    blobs,
    get me() {
      return me;
    },
    actAs(coder) {
      me = coder;
    },
    async reloadMe() {
      const fresh = await store.get('coder', me.id);
      if (fresh && !fresh.deleted) me = fresh;
    },
    async addBlob(bytes, filename, mime): Promise<MediaRef> {
      const blob_id = uuid();
      blobs.set(blob_id, bytes.slice());
      return { blob_id, filename, mime, size: bytes.length };
    },
    async readBlob(ref) {
      const b = blobs.get(ref.blob_id);
      if (!b) throw new Error(`no blob ${ref.blob_id}`);
      return b.slice();
    },
    async removeBlob(ref) {
      blobs.delete(ref.blob_id);
    },
    async log(action: LogAction, summary: string, target?: { kind: string; id: string }) {
      await store.put('log', {
        at: now().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        coder_id: me.id,
        action,
        summary,
        target_kind: target?.kind ?? null,
        target_id: target?.id ?? null,
      });
    },
  };
}

export const sha256hex = (s: string) => toHex(sha256(new TextEncoder().encode(s)));

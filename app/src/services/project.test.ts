import { describe, expect, it } from 'vitest';
import { fromUtf8, randomBytes, utf8 } from '../core/bytes';
import { DecryptError } from '../core/crypto/frames';
import { newRecoveryPhrase } from '../core/crypto/keyring';
import { createMemoryPlatform } from '../platform/memory';
import { PlatformError } from '../platform/types';
import { Library } from './library';
import { backupTagOf, isoSeconds, isLocked } from './project';
import { FAST_KDF } from './testing';

/** Large test data (getRandomValues gives at most 64 KiB at a time). */
function big(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 2654435761) >>> 24;
  return out;
}

async function setup(now?: () => Date) {
  const platform = createMemoryPlatform();
  const library = await Library.create(platform, { passphrase: 'pass word', recoveryPhrase: newRecoveryPhrase() }, { params: FAST_KDF, now });
  const project = await library.createProject({ name: 'Estudo', coderName: 'Ana' });
  return { platform, library, project };
}

describe('blobs', () => {
  it('are stored sealed and read back, empty, Unicode-named and multi-frame ones too', async () => {
    const { platform, project } = await setup();
    for (const bytes of [new Uint8Array(0), utf8('áudio 🎙️'), big(3 * 1024 * 1024 + 7)]) {
      const ref = await project.addBlob(bytes, 'Entrevista nº 1 — Inês.mp3', 'audio/mpeg');
      expect(ref).toMatchObject({ filename: 'Entrevista nº 1 — Inês.mp3', mime: 'audio/mpeg', size: bytes.length });
      expect(ref.blob_id).toMatch(/^[0-9a-f-]{36}$/);
      const stored = platform.blobStore(project.id).get(ref.blob_id)!;
      expect(fromUtf8(stored.subarray(0, 6))).toBe('TRAMF1');
      if (bytes.length > 16) expect(stored.length).toBeGreaterThan(bytes.length);
      // toEqual walks megabytes element by element: compare as buffers.
      expect(Buffer.compare(await project.readBlob(ref), bytes)).toBe(0);
    }
    const secret = utf8('Maria Silva disse que…');
    const ref = await project.addBlob(secret, 'notes.txt', 'text/plain');
    expect(fromUtf8(platform.blobStore(project.id).get(ref.blob_id)!)).not.toContain('Maria');
  });

  it('are bound to their id: a blob copied under another id does not open', async () => {
    const { platform, project } = await setup();
    const a = await project.addBlob(utf8('first'), 'a.txt', 'text/plain');
    const b = await project.addBlob(utf8('second'), 'b.txt', 'text/plain');
    const store = platform.blobStore(project.id);
    store.set(b.blob_id, store.get(a.blob_id)!);
    await expect(project.readBlob(b)).rejects.toBeInstanceOf(DecryptError);
    expect(await project.hasBlob(b.blob_id)).toBe(false);
    expect(await project.hasBlob(a.blob_id)).toBe(true);
    expect(await project.hasBlob('missing')).toBe(false);
  });

  it('do not open in another project of the same library', async () => {
    const { platform, library, project } = await setup();
    const ref = await project.addBlob(utf8('x'), 'a.txt', 'text/plain');
    const sealed = platform.blobStore(project.id).get(ref.blob_id)!;
    const other = await library.createProject({ name: 'Outro', coderName: 'Ana' });
    platform.blobStore(other.id).set(ref.blob_id, sealed);
    await expect(other.readBlob(ref)).rejects.toBeInstanceOf(DecryptError);
  });

  it('are removed, and removing a missing one is fine', async () => {
    const { project } = await setup();
    const ref = await project.addBlob(utf8('x'), 'a.txt', 'text/plain');
    await project.removeBlob(ref);
    await expect(project.readBlob(ref)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(project.removeBlob(ref)).resolves.toBeUndefined();
  });

  it('leave nothing behind when the write fails', async () => {
    const { platform, project } = await setup();
    const write = platform.blobs.write;
    platform.blobs.write = async (p, id, bytes) => {
      await write(p, id, bytes.subarray(0, 5)); // half a file, then the disk is full
      throw new PlatformError('ERROR', 'os error 28');
    };
    await expect(project.addBlob(utf8('hello'), 'a.txt', 'text/plain')).rejects.toThrow(/os error 28/);
    expect(platform.blobStore(project.id).size).toBe(0);
  });

  it('restore under a given id, and refuse ids that are not file names', async () => {
    const { project } = await setup();
    await project.restoreBlob('abc-123', utf8('back'));
    expect(fromUtf8(await project.readBlob({ blob_id: 'abc-123' }))).toBe('back');
    await expect(project.restoreBlob('../evil', utf8('x'))).rejects.toThrow(/invalid blob id/);
    await expect(project.restoreBlob('', utf8('x'))).rejects.toThrow(/invalid blob id/);
  });

  it('are refused once the project is closed, while a key copy keeps reading', async () => {
    const { project } = await setup();
    const ref = await project.addBlob(utf8('kept'), 'a.txt', 'text/plain');
    const keys = project.copyKeys();
    await project.close();
    await project.close(); // twice is fine
    const err = await project.readBlob(ref).catch((e: unknown) => e);
    expect(isLocked(err)).toBe(true);
    await expect(project.addBlob(utf8('x'), 'b.txt', 'text/plain')).rejects.toMatchObject({ code: 'LOCKED' });
    expect(fromUtf8(await keys.readBlob(ref))).toBe('kept');
    keys.wipe();
    await expect(keys.readBlob(ref)).rejects.toBeInstanceOf(DecryptError);
  });
});

describe('coders and me', () => {
  it('lists coders by name, adds coders with palette colours and switches me', async () => {
    const { project } = await setup();
    const rui = await project.addCoder('Rui');
    const bea = await project.addCoder('Beatriz', '#b5179e');
    expect((await project.coders()).map((c) => c.name)).toEqual(['Ana', 'Beatriz', 'Rui']);
    expect(rui.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(bea.color).toBe('#b5179e');
    await project.setMe(rui.id);
    expect(project.me.id).toBe(rui.id);
    expect(await project.store.getMeta('me')).toBe(rui.id);
    await expect(project.setMe('nobody')).rejects.toThrow(/not found/);
    await project.store.remove('coder', [bea.id]);
    await expect(project.setMe(bea.id)).rejects.toThrow(/not found/);
  });

  it('asks for a coder when me points at one that is missing', async () => {
    const { library, project } = await setup();
    await project.store.setMeta('me', 'deleted-coder');
    const id = project.id;
    await library.closeProject();
    const again = await library.openProject(id);
    expect(again.needsCoder).toBe(true);
    const ana = (await again.coders())[0]!;
    await again.setMe(ana.id);
    expect(again.needsCoder).toBe(false);
  });

  it('follows a rename of me after reloading', async () => {
    const { project } = await setup();
    await project.store.update('coder', project.me.id, { name: 'Ana S.' });
    await project.reloadMe();
    expect(project.me.name).toBe('Ana S.');
  });
});

describe('audit trail', () => {
  it('logs in ISO UTC without milliseconds, by me', async () => {
    const { project } = await setup(() => new Date('2026-10-05T12:00:00.987Z'));
    await project.log('code.create', '"Trust"', { kind: 'code', id: 'c1' });
    const entry = (await project.store.list('log')).find((l) => l.action === 'code.create')!;
    expect(entry).toMatchObject({ at: '2026-10-05T12:00:00Z', coder_id: project.me.id, summary: '"Trust"', target_kind: 'code', target_id: 'c1' });
    expect(isoSeconds(new Date('2026-01-02T03:04:05.000Z'))).toBe('2026-01-02T03:04:05Z');
  });
});

describe('backup tag', () => {
  it('is six hex digits, stable per project key and different between projects', () => {
    const a = randomBytes(32);
    expect(backupTagOf(a)).toMatch(/^[0-9a-f]{6}$/);
    expect(backupTagOf(a)).toBe(backupTagOf(a.slice()));
    expect(backupTagOf(randomBytes(32))).not.toBe(backupTagOf(a));
  });
});

import { describe, expect, it } from 'vitest';
import { DecryptError } from '../../core/crypto/frames';
import { jsKdf } from '../../core/crypto/kdf';
import { newRecoveryPhrase, WrongSecretError } from '../../core/crypto/keyring';
import { exportQdpx, RefiError } from '../../core/export/refi';
import { buildTramaZip, encryptWithLibraryKey, encryptWithPassword, NotTramaFileError } from '../../core/export/trama';
import { createMemoryPlatform } from '../../platform/memory';
import { projectToBundle } from '../../services/datafile';
import { Library, LibraryError } from '../../services/library';
import { FAST_KDF } from '../../services/testing';
import { copyName, detectProjectFile, importName, meIn, openTrama, projectFileError, sameProjectIn, summariseBundle } from './projectFile';

async function setup() {
  const platform = createMemoryPlatform();
  const phrase = newRecoveryPhrase();
  const library = await Library.create(platform, { passphrase: 'pass word', recoveryPhrase: phrase }, { params: FAST_KDF });
  const project = await library.createProject({ name: 'Garden study', coderName: 'Ana' });
  const doc = await project.store.put('document', { name: 'Interview', kind: 'text', group_ids: [], case_id: null, source: null, original: null, media: null, chars: 5, order: 1, color: null });
  await project.store.put('doctext', { id: doc.id, text: 'Hello', sync: [] });
  await project.store.put('code', { name: 'Trust', parent_id: null, color: '#e4572e', description: '', inclusion: '', exclusion: '', example: '', order: 1, codable: true, shortcut: null });
  const bundle = await projectToBundle(project, { includeDeleted: true, includePseudonyms: false });
  const zip = buildTramaZip(bundle, { appVersion: '0.1.0' });
  return { platform, library, project, bundle, zip, phrase };
}

describe('project files', () => {
  it('tells .trama from .qdpx by content', async () => {
    const { zip, bundle } = await setup();
    expect(detectProjectFile('copy.trama', zip)).toBe('trama');
    expect(detectProjectFile('renamed.zip', zip)).toBe('trama');
    const qdpx = exportQdpx(bundle, { origin: 'Trama test' }).bytes;
    expect(detectProjectFile('project.qdpx', qdpx)).toBe('qdpx');
    const enc = await encryptWithPassword(zip, 'secret', jsKdf, FAST_KDF);
    expect(detectProjectFile('x.trama', enc)).toBe('trama');
    expect(detectProjectFile('notes.txt', new TextEncoder().encode('hello'))).toBeNull();
  });

  it('opens a plain file, and asks for the password of a protected one', async () => {
    const { library, zip, platform } = await setup();
    const keys = () => library.copyKeys();
    const plain = await openTrama(zip, null, keys, platform.kdf);
    expect(plain).toMatchObject({ status: 'opened', protection: 'none' });
    const enc = await encryptWithPassword(zip, 'secret', jsKdf, FAST_KDF);
    expect(await openTrama(enc, null, keys, platform.kdf)).toEqual({ status: 'locked', protection: 'password' });
    await expect(openTrama(enc, { kind: 'password', password: 'nope' }, keys, platform.kdf)).rejects.toBeInstanceOf(DecryptError);
    const ok = await openTrama(enc, { kind: 'password', password: 'secret' }, keys, platform.kdf);
    expect(ok.status === 'opened' && summariseBundle(ok.bundle).counts).toMatchObject({ document: 1, code: 1, coder: 1 });
  });

  it("opens this library's backups with its own key, and another library's with that one's passphrase", async () => {
    const mine = await setup();
    const own = mine.library.copyKeys();
    const backup = encryptWithLibraryKey(mine.zip, own.libraryKey, own.keyring);
    own.wipe();
    expect(await openTrama(backup, null, () => mine.library.copyKeys(), mine.platform.kdf)).toMatchObject({ status: 'opened', ownLibrary: true });

    const other = await setup();
    expect(await openTrama(backup, null, () => other.library.copyKeys(), other.platform.kdf)).toEqual({ status: 'locked', protection: 'library-key' });
    await expect(openTrama(backup, { kind: 'secret', slot: 'passphrase', secret: 'wrong' }, () => other.library.copyKeys(), other.platform.kdf)).rejects.toBeInstanceOf(WrongSecretError);
    const viaPhrase = await openTrama(backup, { kind: 'secret', slot: 'recovery_phrase', secret: mine.phrase }, () => other.library.copyKeys(), other.platform.kdf);
    expect(viaPhrase).toMatchObject({ status: 'opened', protection: 'library-key', ownLibrary: false });
  });

  it('finds the same project in the library, me among the coders, and a free name for a copy', async () => {
    const { library, bundle } = await setup();
    expect(sameProjectIn(bundle, library.projects)?.name).toBe('Garden study');
    expect(sameProjectIn({ ...bundle, project: { ...bundle.project, id: null } }, library.projects)).toBeNull();
    const coders = summariseBundle(bundle).coders;
    expect(meIn(coders, ' ana ')).toBe(coders[0]!.id);
    expect(meIn(coders, 'Rui')).toBeNull();
    expect(meIn(coders, '')).toBeNull();
    expect(copyName('Garden study', ['Garden study'])).toBe('Garden study (2)');
    // An import never takes the name of a project already in the library, copy or not.
    expect(importName('Allotment gardens study', 'x.qdpx', ['Allotment gardens study'])).toBe('Allotment gardens study (2)');
    expect(importName('', 'Field notes.qdpx', [])).toBe('Field notes');
    expect(importName('New one', 'x.trama', ['Other'])).toBe('New one');
  });

  it('explains what went wrong', () => {
    expect(projectFileError(new NotTramaFileError('newer-version'))).toEqual({ key: 'importer.project.errors.newer' });
    expect(projectFileError(new NotTramaFileError('unknown-type'))).toEqual({ key: 'importer.project.errors.notProject' });
    expect(projectFileError(new NotTramaFileError('checksum'))).toEqual({ key: 'importer.project.errors.damaged' });
    expect(projectFileError(new DecryptError(), 'password')).toEqual({ key: 'importer.project.errors.wrongPassword' });
    expect(projectFileError(new WrongSecretError())).toEqual({ key: 'importer.project.errors.wrongSecret' });
    expect(projectFileError(new RefiError('bad'))).toEqual({ key: 'importer.project.errors.notQdpx', vars: { message: 'bad' } });
    expect(projectFileError(new LibraryError('EXISTS', 'x'))).toEqual({ key: 'importer.project.errors.exists' });
  });
});

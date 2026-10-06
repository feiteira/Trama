// Pseudonymisation reaches file names, and an apply cut short is known and logged.
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { utf8 } from '../core/bytes';
import { newRecoveryPhrase } from '../core/crypto/keyring';
import { createMemoryPlatform } from '../platform/memory';
import { exportProjectFile } from './datafile';
import { createDocument, getText } from './documents';
import { Library } from './library';
import { apply, APPLY_PENDING, createPseudonym, deletePseudonym, interruptedApply } from './pseudonyms';
import { FAST_KDF } from './testing';

const newLibrary = () => Library.create(createMemoryPlatform(), { passphrase: 'pass word', recoveryPhrase: newRecoveryPhrase() }, { params: FAST_KDF });

function exported(bytes: Uint8Array): string {
  return Object.values(unzipSync(bytes)).map((b) => strFromU8(b)).join('\n');
}

describe('file names', () => {
  it('apply replaces names in file names, and exports carry none, before or after the key entry is erased', async () => {
    const lib = await newLibrary();
    const p = await lib.createProject({ name: 'Study', coderName: 'Ana' });
    const { document: t } = await createDocument(p, {
      name: 'Transcript', kind: 'transcript', text: 'Maria Silva: I was afraid.',
      media: { bytes: utf8('ID3fake'), filename: 'Maria_Silva_audio.mp3', mime: 'audio/mpeg' },
    });
    const { document: c } = await createDocument(p, {
      name: 'Consent', kind: 'pdf', text: 'I agree to take part.',
      source: { filename: 'Maria_Silva_consent.docx', format: 'docx' },
      original: { bytes: utf8('PK fake docx'), filename: 'Maria_Silva_consent.docx', mime: 'application/octet-stream' },
    });
    const { pseudonym } = await createPseudonym(p, { original: 'Maria Silva', replacement: 'P1' });
    const r = await apply(p);
    expect(r.fieldReplacements).toBe(3);
    expect((await p.store.get('document', t.id))!.media!.filename).toBe('P1_audio.mp3');
    const consent = (await p.store.get('document', c.id))!;
    expect([consent.source!.filename, consent.original!.filename]).toEqual(['P1_consent.docx', 'P1_consent.docx']);
    expect(exported(await exportProjectFile(p, { includePseudonyms: false }))).not.toMatch(/Maria/);
    await deletePseudonym(p, pseudonym.id, { erase: true });
    expect(exported(await exportProjectFile(p, { includePseudonyms: false }))).not.toMatch(/Maria/);
  });

  it('an export blanks file names of edited documents once a key entry was erased, even ones apply never saw', async () => {
    const lib = await newLibrary();
    const p = await lib.createProject({ name: 'Study', coderName: 'Ana' });
    // Written as an older Trama left it: the text pseudonymised, the file names not.
    const { document: t } = await createDocument(p, {
      name: 'Transcript', kind: 'transcript', text: 'Maria Silva: I was afraid.',
      media: { bytes: utf8('ID3fake'), filename: 'Maria_Silva_audio.mp3', mime: 'audio/mpeg' },
    });
    const { pseudonym } = await createPseudonym(p, { original: 'Maria Silva', replacement: 'P1' });
    await apply(p);
    await p.store.update('document', t.id, { media: { ...(await p.store.get('document', t.id))!.media!, filename: 'Maria_Silva_audio.mp3' } });
    await deletePseudonym(p, pseudonym.id, { erase: true });
    expect(exported(await exportProjectFile(p, { includePseudonyms: false }))).not.toMatch(/Maria/);
  });
});

describe('an interrupted apply', () => {
  it('is recorded as it goes, logged when the project opens again, and cleared by a full apply', async () => {
    const platform = createMemoryPlatform();
    const lib = await Library.create(platform, { passphrase: 'pass word', recoveryPhrase: newRecoveryPhrase() }, { params: FAST_KDF });
    const p = await lib.createProject({ name: 'Study', coderName: 'Ana' });
    for (let i = 1; i <= 4; i++) await createDocument(p, { name: `Interview ${i}`, kind: 'text', text: `Rui told me about Porto (${i}).` });
    await createPseudonym(p, { original: 'Rui', replacement: 'P7' });
    let n = 0;
    await expect(apply(p, undefined, { onProgress: async () => { if (++n === 3) await lib.lock(); } })).rejects.toBeTruthy();
    const again = await Library.unlock(platform, 'passphrase', 'pass word', { params: FAST_KDF });
    const p2 = await again.openProject(p.id);
    expect(await interruptedApply(p2)).toMatchObject({ documents: 2, logged: true });
    const logs = await p2.store.list('log', { where: "json_extract(data, '$.action') = 'pseudonym.apply'" });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.summary).toContain('interrupted');
    expect(logs[0]!.summary).not.toContain('Rui');
    await apply(p2);
    expect(await p2.store.getMeta(APPLY_PENDING)).toBeNull();
    expect(await interruptedApply(p2)).toBeNull();
    for (const d of await p2.store.list('document')) expect((await getText(p2, d.id)).text).not.toContain('Rui');
  });
});

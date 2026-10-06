// Pseudonymisation reaches file names, an apply cut short is known and logged, and nothing that
// leaves the project names what the key replaced, also once its entry is erased.
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { utf8 } from '../core/bytes';
import { newRecoveryPhrase } from '../core/crypto/keyring';
import { createMemoryPlatform } from '../platform/memory';
import { exportProjectFile } from './datafile';
import { createDocument, getText } from './documents';
import { Library } from './library';
import type { Pseudonym } from '../core/model/types';
import { apply, APPLY_PENDING, createPseudonym, deletePseudonym, FILE_MENTIONS, interruptedApply, LOG_MENTIONS, logRedactor, mentionIds, NAMES_LEFT_OUT } from './pseudonyms';
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

describe('what keeps a name after the key entry is erased', () => {
  it('exports and copies leave names out of the audit trail, before and after the erase; the stored trail is untouched', async () => {
    const lib = await newLibrary();
    const p = await lib.createProject({ name: 'Study', coderName: 'Ana' });
    await createDocument(p, { name: 'Interview — Maria Silva', kind: 'text', text: 'Maria Silva: I was afraid.' });
    const { pseudonym } = await createPseudonym(p, { original: 'Maria Silva', replacement: 'P1' });
    await apply(p);
    const logOf = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['data/log.jsonl']!);
    expect(logOf(await exportProjectFile(p, { includePseudonyms: false }))).not.toMatch(/Maria/);
    await deletePseudonym(p, pseudonym.id, { erase: true });
    const after = logOf(await exportProjectFile(p, { includePseudonyms: false }));
    expect(after).not.toMatch(/Maria/);
    expect(after).toContain(NAMES_LEFT_OUT.replace(/"/g, '\\"'));
    // The project's own trail is never edited.
    const stored = await p.store.list('log', { where: "json_extract(data, '$.action') = 'document.add'" });
    expect(stored.map((l) => l.summary)).toEqual(['"Interview — Maria Silva"']);
    expect((await mentionIds(p, LOG_MENTIONS)).has(stored[0]!.id)).toBe(true);
    // The audit trail's own CSV export reads it the same way.
    const redact = await logRedactor(p);
    expect(redact(stored[0]!)).toBe(NAMES_LEFT_OUT);
  });

  it('a name later entries carry is left out too, while the applied entry exists', async () => {
    const lib = await newLibrary();
    const p = await lib.createProject({ name: 'Study', coderName: 'Ana' });
    await createDocument(p, { name: 'Interview', kind: 'text', text: 'Maria Silva: I was afraid.' });
    await createPseudonym(p, { original: 'Maria Silva', replacement: 'P1' });
    await apply(p);
    await p.log('document.add', '"Notes on Maria Silva"');
    expect(strFromU8(unzipSync(await exportProjectFile(p, { includePseudonyms: false }))['data/log.jsonl']!)).toContain('Notes on P1');
  });

  it('a file name holding the name inside a word is rewritten when it can be, and blanked in exports after the erase when not', async () => {
    const lib = await newLibrary();
    const p = await lib.createProject({ name: 'Study', coderName: 'Ana' });
    const { document: c } = await createDocument(p, {
      name: 'Consent', kind: 'pdf', text: 'I agree to take part.',
      source: { filename: 'Consent_MartaSousa.docx', format: 'docx' },
      original: { bytes: utf8('PK fake docx'), filename: 'Consent_MartaSousa.docx', mime: 'application/octet-stream' },
    });
    const { document: low } = await createDocument(p, {
      name: 'Form', kind: 'pdf', text: 'Signed.',
      source: { filename: 'form_martasousa.pdf', format: 'pdf' },
    });
    await createDocument(p, { name: 'Interview', kind: 'text', text: 'Marta Sousa: hello.' });
    const { pseudonym } = await createPseudonym(p, { original: 'Marta', replacement: 'P1' });
    const r = await apply(p);
    expect(r.fieldReplacements).toBe(2);
    expect((await p.store.get('document', c.id))!.source!.filename).toBe('Consent_P1Sousa.docx');
    // Inside a word: apply leaves it (it would also hit "Martalina"), and notes the document.
    expect((await p.store.get('document', low.id))!.source!.filename).toBe('form_martasousa.pdf');
    expect((await mentionIds(p, FILE_MENTIONS)).has(low.id)).toBe(true);
    await deletePseudonym(p, pseudonym.id, { erase: true });
    expect(exported(await exportProjectFile(p, { includePseudonyms: false }))).not.toMatch(/marta/i);
  });
});

describe('erasing a key entry', () => {
  it('deletes and wipes it in one write, so a lock between two writes cannot leave a tombstone with the name', async () => {
    const lib = await newLibrary();
    const p = await lib.createProject({ name: 'Study', coderName: 'Ana' });
    const { pseudonym } = await createPseudonym(p, { original: 'Maria Silva', replacement: 'P1' });
    const db = p.store['db'];
    const batch = db.batch.bind(db);
    // Every write after the first fails, as it does once a lock has closed the project.
    let writes = 0;
    db.batch = async (statements) => {
      if (++writes > 1) throw new Error('the project is closed');
      return batch(statements);
    };
    await deletePseudonym(p, pseudonym.id, { erase: true });
    db.batch = batch;
    expect(writes).toBe(1);
    expect((await p.store.list('pseudonym', { includeDeleted: true })).map((x) => [x.original, x.deleted])).toEqual([['∅', true]]);
  });

  it('a failed erase leaves the entry as it was, never half deleted', async () => {
    const lib = await newLibrary();
    const p = await lib.createProject({ name: 'Study', coderName: 'Ana' });
    const { pseudonym } = await createPseudonym(p, { original: 'Maria Silva', replacement: 'P1' });
    const db = p.store['db'];
    const batch = db.batch.bind(db);
    db.batch = async () => {
      throw new Error('the project is closed');
    };
    await expect(deletePseudonym(p, pseudonym.id, { erase: true })).rejects.toThrow('the project is closed');
    db.batch = batch;
    expect((await p.store.list('pseudonym', { includeDeleted: true })).map((x) => [x.original, x.deleted])).toEqual([['Maria Silva', false]]);
  });

  it('a deleted entry that kept its name (from before, or a delete without erase) is wiped when the project opens', async () => {
    const platform = createMemoryPlatform();
    const lib = await Library.create(platform, { passphrase: 'pass word', recoveryPhrase: newRecoveryPhrase() }, { params: FAST_KDF });
    const p = await lib.createProject({ name: 'Study', coderName: 'Ana' });
    await createDocument(p, { name: 'Interview — Maria Silva', kind: 'text', text: 'Maria Silva: hello.' });
    const { pseudonym } = await createPseudonym(p, { original: 'Maria Silva', replacement: 'P1' });
    await deletePseudonym(p, pseudonym.id);
    expect((await p.store.list('pseudonym', { includeDeleted: true }))[0]!.original).toBe('Maria Silva');
    await lib.lock();
    const again = await Library.unlock(platform, 'passphrase', 'pass word', { params: FAST_KDF });
    const p2 = await again.openProject(p.id);
    const [entry] = (await p2.store.list('pseudonym', { includeDeleted: true })) as (Pseudonym & { scrubbed?: boolean })[];
    expect([entry!.original, entry!.deleted, entry!.scrubbed]).toEqual(['∅', true, true]);
    // The audit-trail entry naming it is noted as it goes.
    expect((await mentionIds(p2, LOG_MENTIONS)).size).toBe(1);
  });
});

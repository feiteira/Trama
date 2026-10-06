import { strFromU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { fromUtf8, readU32be, toHex, utf8 } from '../bytes';
import { DecryptError } from '../crypto/frames';
import { jsKdf, type KdfParams } from '../crypto/kdf';
import { createKeyring, newLibraryKey, newRecoveryPhrase, WrongSecretError } from '../crypto/keyring';
import { formatHlc } from '../hlc';
import type { Entity, Kind } from '../model/types';
import type { BundleRecord, ProjectBundle } from './bundle';
import { forgeName, forgeSize } from './forgeZip.testutil';
import {
  buildTramaZip, decryptTrama, encryptWithLibraryKey, encryptWithPassword, isSafePath, keyringOf, NotTramaFileError,
  protectionOf, readTramaZip, safeName, UnlockRequiredError,
} from './trama';

const FAST: KdfParams = { algo: 'argon2id', m: 64, t: 1, p: 1, key_len: 32 };
let tick = 0;
const base = (id: string, deleted = false) => ({
  id,
  created_at: '2026-10-05T12:00:00.000Z',
  updated_at_hlc: formatHlc({ ms: 1_790_000_000_000, counter: tick++, device: 'abc1' }),
  deleted,
});
const rec = <K extends Kind>(kind: K, record: Omit<Entity<K>, 'id' | 'created_at' | 'updated_at_hlc' | 'deleted'>, id: string, deleted = false) =>
  ({ kind, record: { ...base(id, deleted), ...record } }) as unknown as BundleRecord;

const PDF = utf8('%PDF-1.7 not really a pdf but it starts like one');

function sample(): ProjectBundle {
  const docFields = { kind: 'text' as const, group_ids: [], case_id: null, source: null, media: null, chars: 13, color: null };
  return {
    project: { id: 'p-1', name: 'Estudo — Saúde mental 🌱', description: 'Entrevistas em Lisboa', origin: null },
    records: [
      rec('coder', { name: 'Inês', color: '#3a6ea5' }, 'coder-1'),
      rec('document', { ...docFields, name: 'Entrevista: Ana/Rui?', original: { blob_id: 'blob-1', filename: 'e1.pdf', mime: 'application/pdf', size: PDF.length }, order: 1 }, 'doc-1'),
      rec('document', { ...docFields, name: 'Entrevista: Ana/Rui?', original: null, order: 2 }, 'doc-2'),
      rec('document', { ...docFields, name: 'Apagado', original: null, order: 3 }, 'doc-3', true),
      rec('doctext', { text: 'Olá 👋🏽 mundo', sync: [] }, 'doc-1'),
      rec('doctext', { text: 'Segundo\ntexto', sync: [] }, 'doc-2'),
      rec('code', { name: 'Confiança', parent_id: null, color: '#e4572e', description: 'Trust in others', inclusion: 'Explicit', exclusion: '', example: '"I trust her"', order: 1, codable: false, shortcut: null }, 'code-1'),
      rec('code', { name: 'Família', parent_id: 'code-1', color: '#e4572e', description: '', inclusion: '', exclusion: '', example: '', order: 1, codable: true, shortcut: 1 }, 'code-2'),
      rec('coding', { document_id: 'doc-1', code_id: 'code-2', coder_id: 'coder-1', start: 0, end: 3, text: 'Olá', comment: '' }, 'cod-1'),
      rec('memo', { title: 'Ideias / próximas', body: '**Bold** idea', target: { kind: 'project', id: null }, coder_id: 'coder-1', color: null }, 'memo-1'),
      rec('pseudonym', { original: 'Maria Silva', replacement: 'P1', note: '', whole_word: true, case_sensitive: false, applied_at: null, applied_count: 0 }, 'ps-1'),
      rec('setting', { value: 'pt' }, 'project.text_language'),
    ],
    blobs: new Map([['blob-1', PDF]]),
    warnings: [],
  };
}

const opts = { appVersion: '0.1.0', now: new Date('2026-10-05T12:00:00Z') };
const byId = (rs: BundleRecord[]) => [...rs].sort((a, b) => `${a.kind}${a.record.id}`.localeCompare(`${b.kind}${b.record.id}`));

/** Rebuilds a ZIP after changing its files (as someone tampering with it would). */
function rezip(zip: Uint8Array, change: (files: Record<string, Uint8Array>) => void): Uint8Array {
  const files = unzipSync(zip);
  change(files);
  return zipSync(files as Zippable);
}

/** The compression method (0 stored, 8 deflate) of one entry, read from its local header. */
function methodOf(zip: Uint8Array, path: string): number {
  const name = utf8(path);
  for (let i = 0; i + 30 < zip.length; i++) {
    if (zip[i] !== 0x50 || zip[i + 1] !== 0x4b || zip[i + 2] !== 3 || zip[i + 3] !== 4) continue;
    const nameLen = zip[i + 26]! | (zip[i + 27]! << 8);
    if (nameLen === name.length && name.every((b, k) => zip[i + 30 + k] === b)) return zip[i + 8]! | (zip[i + 9]! << 8);
  }
  throw new Error(`no entry ${path}`);
}

describe('the .trama ZIP', () => {
  it('round-trips records (tombstones included), blobs and the project, with Unicode intact', () => {
    const bundle = sample();
    const zip = buildTramaZip(bundle, { ...opts, includePseudonyms: true });
    const back = readTramaZip(zip);
    expect(back.project).toEqual({ id: 'p-1', name: 'Estudo — Saúde mental 🌱', description: 'Entrevistas em Lisboa', origin: 'Trama 0.1.0' });
    expect(byId(back.records)).toEqual(byId(bundle.records));
    expect(back.blobs.get('blob-1')).toEqual(PDF);
    expect(back.manifest).toMatchObject({ format: 'trama-project', version: 1, app_version: '0.1.0', created_at: '2026-10-05T12:00:00Z', include_pseudonyms: true });
    expect(back.manifest.counts).toMatchObject({ document: 2, doctext: 2, code: 2, pseudonym: 1, log: 0 });
    expect(back.manifest.me).toBeUndefined();
  });

  it('leaves the pseudonymisation key out unless asked', () => {
    const zip = buildTramaZip(sample(), opts);
    const back = readTramaZip(zip);
    expect(back.manifest.include_pseudonyms).toBe(false);
    expect(back.records.some((r) => r.kind === 'pseudonym')).toBe(false);
    const all = Object.values(unzipSync(zip)).map((f) => strFromU8(f)).join('\n');
    expect(all).not.toContain('Maria Silva');
  });

  it('writes readable copies with safe, unique file names, which the reader ignores', () => {
    const files = unzipSync(buildTramaZip(sample(), opts));
    expect(strFromU8(files['readable/documents/Entrevista_ Ana_Rui_.txt']!)).toBe('Olá 👋🏽 mundo');
    expect(strFromU8(files['readable/documents/Entrevista_ Ana_Rui_ (2).txt']!)).toBe('Segundo\ntexto');
    expect(Object.keys(files).some((p) => p.includes('Apagado'))).toBe(false); // deleted: data only
    const codebook = strFromU8(files['readable/codebook.md']!);
    expect(codebook).toContain('# Codebook — Estudo — Saúde mental 🌱');
    expect(codebook).toContain('## Confiança (category)');
    expect(codebook).toContain('### Família');
    expect(codebook).toContain('**Definition:** Trust in others');
    expect(codebook.indexOf('Confiança')).toBeLessThan(codebook.indexOf('Família'));
    expect(strFromU8(files['readable/memos/Ideias _ próximas.md']!)).toContain('**Bold** idea');
    expect(strFromU8(files['readable/README.txt']!)).toContain('data/<kind>.jsonl');
    expect(strFromU8(files['data/document.jsonl']!).trim().split('\n')).toHaveLength(3);
  });

  it('stores already-compressed media without compressing it again', () => {
    const bundle = sample();
    const text = utf8('plain text '.repeat(200));
    bundle.blobs.set('blob-2', text);
    const zip = buildTramaZip(bundle, opts);
    expect(methodOf(zip, 'blobs/blob-1')).toBe(0);
    expect(methodOf(zip, 'blobs/blob-2')).toBe(8);
  });

  it('round-trips an empty project', () => {
    const empty: ProjectBundle = { project: { id: null, name: '', description: '', origin: null }, records: [], blobs: new Map(), warnings: [] };
    const back = readTramaZip(buildTramaZip(empty, opts));
    expect(back.records).toEqual([]);
    expect(back.blobs.size).toBe(0);
    expect(back.project.id).toBeNull();
  });

  it('handles a large project', () => {
    const bundle = sample();
    for (let i = 0; i < 20_000; i++) {
      bundle.records.push(rec('coding', { document_id: 'doc-1', code_id: 'code-2', coder_id: 'coder-1', start: i, end: i + 1, text: 'é', comment: '' }, `c${i}`));
    }
    const back = readTramaZip(buildTramaZip(bundle, opts));
    expect(back.records.filter((r) => r.kind === 'coding')).toHaveLength(20_001);
  });

  it('keeps the newest version when a record appears twice', () => {
    const zip = rezip(buildTramaZip(sample(), opts), (files) => {
      const line = JSON.stringify({ ...base('coder-1'), name: 'Inês (newer)', color: '#3a6ea5' });
      files['data/coder.jsonl'] = utf8(fromUtf8(files['data/coder.jsonl']!) + line + '\n');
    });
    // The checksum no longer matches: fix the manifest as a careful writer would.
    const fixed = rezip(zip, (files) => {
      const m = JSON.parse(strFromU8(files['manifest.json']!)) as { files: Record<string, string> };
      m.files['data/coder.jsonl'] = toHex(sha256(files['data/coder.jsonl']!));
      files['manifest.json'] = utf8(JSON.stringify(m));
    });
    const coders = readTramaZip(fixed).records.filter((r) => r.kind === 'coder');
    expect(coders).toHaveLength(1);
    expect(coders[0]!.record).toMatchObject({ name: 'Inês (newer)' });
  });
});

describe('reading refuses damaged or forged files', () => {
  const good = () => buildTramaZip(sample(), opts);
  const reason = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      if (e instanceof NotTramaFileError) return e.reason;
      throw e;
    }
    return 'accepted';
  };

  it('detects tampering with any listed file', () => {
    for (const path of ['data/code.jsonl', 'blobs/blob-1']) {
      const zip = rezip(good(), (f) => {
        const b = f[path]!.slice();
        b[0] = b[0]! ^ 1;
        f[path] = b;
      });
      expect(reason(() => readTramaZip(zip))).toBe('checksum');
    }
    expect(reason(() => readTramaZip(rezip(good(), (f) => delete f['data/coder.jsonl'])))).toBe('checksum');
  });

  it('refuses a zip bomb from the declared sizes, before inflating anything', () => {
    const t0 = Date.now();
    // One blob claiming 3.75 GiB (over the 2 GiB a file may have), a record file claiming
    // 600 MiB, and blobs adding up to more than the archive could hold for its size.
    expect(reason(() => readTramaZip(forgeSize(good(), 'blobs/blob-1', 0xf0000000)))).toBe('too-large');
    expect(reason(() => readTramaZip(forgeSize(good(), 'data/code.jsonl', 600 * 1024 * 1024)))).toBe('too-large');
    const many = rezip(good(), (f) => {
      for (let i = 0; i < 8; i++) f[`blobs/b${i}`] = new Uint8Array(16);
    });
    expect(reason(() => readTramaZip(forgeSize(many, /^blobs\/b\d$/, 512 * 1024 * 1024)))).toBe('too-large');
    // A large readable copy costs nothing: it is never inflated.
    expect(reason(() => readTramaZip(forgeSize(good(), 'readable/codebook.md', 0xf0000000)))).toBe('accepted');
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('refuses an archive repeating an entry name: each copy would be inflated, each counted once', () => {
    const t0 = Date.now();
    // Eight records named manifest.json, each declaring 500 MiB: 4 GiB of inflation from one name.
    const files: Zippable = { 'manifest.json': utf8('{}') };
    for (let i = 1; i < 8; i++) files[`manifest.jso${i}`] = utf8('{}');
    let zip: Uint8Array = zipSync(files);
    for (let i = 1; i < 8; i++) zip = forgeName(zip, `manifest.jso${i}`, 'manifest.json');
    expect(reason(() => readTramaZip(forgeSize(zip, 'manifest.json', 500 * 1024 * 1024)))).toBe('duplicate-entry');
    // Even a well-sized duplicate is refused: a reader could take either copy.
    const two = forgeName(rezip(good(), (f) => (f['data/code.jsonX'] = f['data/code.jsonl']!)), 'data/code.jsonX', 'data/code.jsonl');
    expect(reason(() => readTramaZip(two))).toBe('duplicate-entry');
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('checks the manifest before inflating the files it lists', () => {
    // A forged manifest is refused without inflating the (huge) blobs next to it.
    const zip = zipSync({ 'manifest.json': utf8('{}'), 'blobs/b1': new Uint8Array(16) });
    expect(reason(() => readTramaZip(forgeSize(zip, 'blobs/b1', 400 * 1024 * 1024)))).toBe('format');
  });

  it('ignores the readable copies, which Trama never reads: a damaged one cannot lock the project away', () => {
    const changed = rezip(good(), (f) => {
      const b = f['readable/codebook.md']!.slice();
      b[0] = b[0]! ^ 1;
      f['readable/codebook.md'] = b;
      f['readable/notes.txt'] = utf8('added by hand');
      delete f['readable/README.txt'];
    });
    expect(reason(() => readTramaZip(changed))).toBe('accepted');
  });

  it('refuses files slipped in without a checksum', () => {
    expect(reason(() => readTramaZip(rezip(good(), (f) => (f['data/extra.jsonl'] = utf8('{}')))))).toBe('unlisted-file');
    expect(reason(() => readTramaZip(rezip(good(), (f) => (f['blobs/evil'] = utf8('x')))))).toBe('unlisted-file');
  });

  it('refuses a newer format version, another format, no manifest and non-ZIP bytes', () => {
    const withManifest = (m: object) =>
      rezip(good(), (f) => (f['manifest.json'] = utf8(JSON.stringify({ ...JSON.parse(strFromU8(f['manifest.json']!)), ...m }))));
    expect(reason(() => readTramaZip(withManifest({ version: 2 })))).toBe('newer-version');
    expect(reason(() => readTramaZip(withManifest({ format: 'sala-export' })))).toBe('format');
    expect(reason(() => readTramaZip(rezip(good(), (f) => delete f['manifest.json'])))).toBe('no-manifest');
    expect(reason(() => readTramaZip(rezip(good(), (f) => (f['manifest.json'] = utf8('{not json')))))).toBe('no-manifest');
    expect(reason(() => readTramaZip(utf8('hello')))).toBe('not-zip');
    expect(reason(() => readTramaZip(new Uint8Array(0)))).toBe('not-zip');
  });

  it('refuses paths that could escape a folder (zip-slip)', () => {
    for (const evil of ['../evil.txt', 'blobs/../../etc/passwd', '/etc/passwd', 'C:/Windows/x', 'a\\..\\b', 'data//x', './x']) {
      const zip = zipSync({ 'manifest.json': utf8('{}'), [evil]: utf8('x') });
      expect(reason(() => readTramaZip(zip)), evil).toBe('unsafe-path');
    }
    expect(isSafePath('blobs/abc')).toBe(true);
    expect(isSafePath('readable/documents/Ünïcödé 🌍.txt')).toBe(true);
    expect(isSafePath('')).toBe(false);
  });

  it('refuses a record without its base fields or with a bad stamp', () => {
    const withLine = (line: string) =>
      rezip(good(), (f) => {
        f['data/coder.jsonl'] = utf8(line + '\n');
        const m = JSON.parse(strFromU8(f['manifest.json']!)) as { files: Record<string, string> };
        m.files['data/coder.jsonl'] = toHex(sha256(f['data/coder.jsonl']!));
        f['manifest.json'] = utf8(JSON.stringify(m));
      });
    expect(reason(() => readTramaZip(withLine('{"id":"x"}')))).toBe('bad-record');
    expect(reason(() => readTramaZip(withLine('not json')))).toBe('bad-record');
    expect(reason(() => readTramaZip(withLine(JSON.stringify({ ...base('x'), updated_at_hlc: 'yesterday' }))))).toBe('bad-record');
    expect(reason(() => readTramaZip(withLine('[]')))).toBe('bad-record');
  });
});

/** No unpaired surrogate (String#isWellFormed is ES2024, past this project's lib). */
const wellFormed = (s: string) => !/[\u{d800}-\u{dfff}]/u.test(s);

describe('names with emoji in the readable copies', () => {
  // A memo title whose emoji starts at UTF-16 index 79: cutting at 80 units left half of it.
  const title = 'Ideias sobre a relação entre as hortas comunitárias e o sentimento de pertença 🌱 no bairro';

  it('never cuts a character in half', () => {
    expect(title.indexOf('🌱')).toBe(79);
    const name = safeName(title);
    expect(wellFormed(name)).toBe(true);
    expect(name.endsWith('pertença 🌱')).toBe(true);
    expect([...name].length).toBeLessThanOrEqual(80);
    // A lone surrogate in a name (from anywhere) cannot reach a UTF-8 entry name either.
    expect(wellFormed(safeName('a\ud83c b'))).toBe(true);
  });

  it('round-trips a project whose memo title and document name hold an astral character at the cut', () => {
    const bundle = sample();
    const at80 = 'x'.repeat(79) + '😀 resto';
    bundle.records.push(
      rec('memo', { title, body: 'b', target: { kind: 'project', id: null }, coder_id: 'coder-1', color: null }, 'memo-2'),
      rec('document', { kind: 'text', group_ids: [], case_id: null, source: null, media: null, chars: 1, color: null, name: at80, original: null, order: 4 }, 'doc-4'),
      rec('doctext', { text: 'x', sync: [] }, 'doc-4'),
    );
    const back = readTramaZip(buildTramaZip(bundle, opts));
    expect(back.records.some((r) => r.kind === 'memo' && r.record.id === 'memo-2')).toBe(true);
    const names = Object.keys(unzipSync(buildTramaZip(bundle, opts)));
    expect(names.every((n) => !n.includes('\ufffd'))).toBe(true);
  });
});

describe('safeName', () => {
  it('makes names valid everywhere', () => {
    expect(safeName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
    expect(safeName('  ')).toBe('untitled');
    expect(safeName('CON')).toBe('_CON');
    expect(safeName('notes...')).toBe('notes');
    expect(safeName('x'.repeat(200))).toHaveLength(80);
    expect(safeName('E\u0301')).toBe('É');
  });
});

describe('the encrypted container', () => {
  const zip = () => buildTramaZip(sample(), opts);

  it('protects with a password (NFC-normalised), and needs it to open', async () => {
    const plain = zip();
    const bytes = await encryptWithPassword(plain, 'Inês é ótima', jsKdf, FAST);
    expect(fromUtf8(bytes.subarray(0, 8))).toBe('TRAMAENC');
    const headerLen = readU32be(bytes, 8);
    const header = JSON.parse(fromUtf8(bytes.subarray(12, 12 + headerLen))) as { mode: string; format: string; kdf: { m: number } };
    expect(header).toMatchObject({ format: 'trama-encrypted', mode: 'password', kdf: { m: 64 } });
    expect(fromUtf8(bytes.subarray(12 + headerLen, 12 + headerLen + 6))).toBe('TRAMF1');
    expect(protectionOf(bytes)).toBe('password');
    expect(protectionOf(plain)).toBe('none');

    const opened = await decryptTrama(bytes, { kind: 'password', password: 'Inês é ótima'.normalize('NFD') }, jsKdf);
    expect(opened.zip).toEqual(plain);
    expect(readTramaZip(opened.zip).project.name).toBe('Estudo — Saúde mental 🌱');
    await expect(decryptTrama(bytes, { kind: 'password', password: 'wrong' }, jsKdf)).rejects.toBeInstanceOf(DecryptError);
    await expect(decryptTrama(bytes, { kind: 'none' }, jsKdf)).rejects.toBeInstanceOf(UnlockRequiredError);
    await expect(encryptWithPassword(plain, '', jsKdf, FAST)).rejects.toThrow();
  });

  it('binds the sealed data to its header and detects truncation', async () => {
    const bytes = await encryptWithPassword(zip(), 'pw', jsKdf, FAST);
    const headerLen = readU32be(bytes, 8);
    // Same JSON length, different meaning: the context (a hash of the header) no longer matches.
    const text = fromUtf8(bytes.subarray(12, 12 + headerLen)).replace('"t":1', '"t":2');
    const swapped = bytes.slice();
    swapped.set(utf8(text), 12);
    await expect(decryptTrama(swapped, { kind: 'password', password: 'pw' }, jsKdf)).rejects.toBeInstanceOf(DecryptError);
    await expect(decryptTrama(bytes.subarray(0, bytes.length - 10), { kind: 'password', password: 'pw' }, jsKdf)).rejects.toBeInstanceOf(DecryptError);
    expect(() => protectionOf(bytes.subarray(0, 11))).toThrow(NotTramaFileError);
    const badLen = bytes.slice();
    badLen.set([0x7f, 0xff, 0xff, 0xff], 8);
    expect(() => protectionOf(badLen)).toThrow(NotTramaFileError);
  });

  it('protects backups with the library key, restorable elsewhere with the passphrase or recovery phrase', async () => {
    const key = newLibraryKey();
    const phrase = newRecoveryPhrase();
    const keyring = await createKeyring(key, { passphrase: 'pass word', recoveryPhrase: phrase }, jsKdf, { params: FAST });
    const plain = zip();
    const bytes = encryptWithLibraryKey(plain, key, keyring);
    expect(protectionOf(bytes)).toBe('library-key');
    expect(keyringOf(bytes)).toEqual(keyring);
    expect(keyringOf(plain)).toBeNull();

    const own = await decryptTrama(bytes, { kind: 'library-key', libraryKey: key }, jsKdf);
    expect(own.zip).toEqual(plain);
    expect(own.libraryKey).toBeUndefined(); // the caller's own key is never handed back
    const viaPass = await decryptTrama(bytes, { kind: 'secret', slot: 'passphrase', secret: 'pass word' }, jsKdf);
    expect(viaPass.zip).toEqual(plain);
    expect(viaPass.libraryKey).toEqual(key);
    expect(viaPass.keyring).toEqual(keyring);
    expect((await decryptTrama(bytes, { kind: 'secret', slot: 'recovery_phrase', secret: phrase }, jsKdf)).zip).toEqual(plain);
    await expect(decryptTrama(bytes, { kind: 'secret', slot: 'passphrase', secret: 'nope' }, jsKdf)).rejects.toBeInstanceOf(WrongSecretError);
    await expect(decryptTrama(bytes, { kind: 'library-key', libraryKey: newLibraryKey() }, jsKdf)).rejects.toBeInstanceOf(DecryptError);
    await expect(decryptTrama(bytes, { kind: 'password', password: 'x' }, jsKdf)).rejects.toBeInstanceOf(UnlockRequiredError);
  });

  it('says what is not a Trama file', () => {
    for (const bytes of [new Uint8Array(0), utf8('SALAENC1xxxxxxxx'), utf8('TRAMAEN'), utf8('%PDF-1.7')]) {
      expect(() => protectionOf(bytes)).toThrow(NotTramaFileError);
    }
    const junkHeader = new Uint8Array([...utf8('TRAMAENC'), 0, 0, 0, 4, ...utf8('nope')]);
    expect(() => protectionOf(junkHeader)).toThrow(NotTramaFileError);
    const otherFormat = utf8(JSON.stringify({ format: 'x', v: 1, mode: 'password' }));
    const other = new Uint8Array([...utf8('TRAMAENC'), 0, 0, 0, otherFormat.length, ...otherFormat]);
    expect(() => protectionOf(other)).toThrow(NotTramaFileError);
  });
});

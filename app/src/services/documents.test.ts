import { describe, expect, it } from 'vitest';
import { applyCode } from './codings';
import { createCode } from './codes';
import {
  attachMedia,
  canonicalise,
  canonicalText,
  createDocument,
  createDocuments,
  deleteDocuments,
  DocumentSlots,
  detachMedia,
  documentStats,
  editDocumentText,
  getText,
  renameDocument,
  reorderDocument,
  restoreDocuments,
  setDocumentCase,
  setDocumentGroups,
  setDocumentKind,
  uniqueName,
} from './documents';
import { createMemo } from './memos';
import { createCase } from './cases';
import { createGroup } from './groups';
import { listLog } from './log';
import { makeTestProject, sha256hex } from './testing';
import { JobStopped } from './jobs';
import { ServiceError } from './undo';

const TEXT = 'Interviewer: How did you start?\nAna: I started in Porto, with Rui.\nInterviewer: And then?';

async function setup() {
  const ctx = await makeTestProject();
  const { document } = await createDocument(ctx, { name: 'Interview 1', kind: 'transcript', text: TEXT });
  const { code } = await createCode(ctx, { name: 'Origins' });
  return { ctx, doc: document, code };
}

describe('canonical text', () => {
  it('strips BOMs, normalises line endings and removes control characters', () => {
    expect(canonicalText('\uFEFFa\r\nb\rc\u0000d\u0007e\tf\u000Bg\u0085h')).toBe('a\nb\ncde\tfgh');
    expect(canonicalText('one\u2028two\u2029three')).toBe('one\ntwo\nthree');
    expect(canonicalText('')).toBe('');
  });

  it('composes to NFC and replaces unpaired surrogates', () => {
    expect(canonicalText('café')).toBe('café');
    expect(canonicalText('a\uD800b')).toBe('a\uFFFDb');
    expect(canonicalText('😀')).toBe('😀');
  });

  it('maps raw offsets onto the canonical text', () => {
    const raw = '\uFEFFline one\r\nline two\r\nmaçã̃ end';
    const c = canonicalise(raw);
    expect(c.text.includes('\r')).toBe(false);
    const rawPos = raw.indexOf('line two');
    expect(c.text.slice(c.mapOffset(rawPos))).toMatch(/^line two/);
    const endPos = raw.indexOf('end');
    expect(c.text.slice(c.mapOffset(endPos))).toBe('end');
  });

  it('is fast on a large decomposed text', () => {
    const raw = 'São João e a Conceição\r\n'.normalize('NFD').repeat(40_000);
    const t0 = performance.now();
    const c = canonicalise(raw);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(c.text).toBe(raw.replace(/\r\n/g, '\n').normalize('NFC'));
  });
});

describe('uniqueName', () => {
  it('numbers duplicates', () => {
    expect(uniqueName('Interview 3', [])).toBe('Interview 3');
    expect(uniqueName('Interview 3', ['interview 3'])).toBe('Interview 3 (2)');
    expect(uniqueName('Interview 3', ['Interview 3', 'Interview 3 (2)'])).toBe('Interview 3 (3)');
    expect(uniqueName('Interview 3 (2)', ['Interview 3', 'Interview 3 (2)'])).toBe('Interview 3 (3)');
    expect(uniqueName('  Entrevista   á ', ['Entrevista á'])).toBe('Entrevista á (2)');
  });

  it('stays within the length limit', () => {
    const long = 'x'.repeat(200);
    const n = uniqueName(long, [long]);
    expect(n.length).toBeLessThanOrEqual(200);
    expect(n.endsWith(' (2)')).toBe(true);
  });
});

describe('createDocument', () => {
  it('writes the document and its text, canonicalised, in order', async () => {
    const ctx = await makeTestProject();
    const a = await createDocument(ctx, { name: 'Interview 3', kind: 'text', text: '\uFEFFOne\r\nTwo' });
    const b = await createDocument(ctx, { name: 'Interview 3', kind: 'text', text: 'Other', source: { filename: 'i3.docx', format: 'DOCX' } });
    expect(a.document.name).toBe('Interview 3');
    expect(b.document.name).toBe('Interview 3 (2)');
    expect(b.document.order).toBeGreaterThan(a.document.order);
    const t = await getText(ctx, a.document.id);
    expect(t.text).toBe('One\nTwo');
    expect(a.document.chars).toBe(7);
    expect(a.document.source!.text_sha256).toBe(sha256hex('One\nTwo'));
    expect(b.document.source!.format).toBe('docx');
    const log = await listLog(ctx, { action: 'document.add' });
    expect(log.map((l) => l.summary).sort()).toEqual(['"Interview 3 (2)"', '"Interview 3"']);
  });

  it('keeps sync points in step with the canonical text', async () => {
    const ctx = await makeTestProject();
    const raw = 'A: hello\r\nB: there\r\nA: bye';
    const { document } = await createDocument(ctx, {
      name: 'T',
      kind: 'transcript',
      text: raw,
      sync: [{ pos: raw.indexOf('B:'), ms: 1000 }, { pos: raw.indexOf('A: bye'), ms: 2000 }],
    });
    const t = await getText(ctx, document.id);
    expect(t.sync.map((s) => t.text.slice(s.pos, s.pos + 2))).toEqual(['B:', 'A:']);
  });

  it('stores files and removes them when the write fails', async () => {
    const ctx = await makeTestProject();
    const { document } = await createDocument(ctx, {
      name: 'Scan',
      kind: 'pdf',
      text: 'x',
      original: { bytes: new Uint8Array([1, 2, 3]), filename: 'scan.pdf', mime: 'application/pdf' },
    });
    expect(document.original?.size).toBe(3);
    expect(ctx.blobs.size).toBe(1);
    await expect(
      createDocument(ctx, { name: 'Bad', kind: 'pdf', text: 'x', color: 'red', media: { bytes: new Uint8Array(2), filename: 'a.mp3', mime: 'audio/mpeg' } }),
    ).rejects.toThrow();
    expect(ctx.blobs.size).toBe(1);
  });

  it('rejects an empty name and unknown case or groups', async () => {
    const ctx = await makeTestProject();
    await expect(createDocument(ctx, { name: '  ', kind: 'text', text: '' })).rejects.toBeInstanceOf(ServiceError);
    await expect(createDocument(ctx, { name: 'x', kind: 'text', text: '', case_id: 'nope' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('undo and redo a creation', async () => {
    const ctx = await makeTestProject();
    const { document, undo } = await createDocument(ctx, { name: 'Notes', kind: 'note', text: 'Olá 🌍' });
    await undo.undo();
    expect((await ctx.store.get('document', document.id))!.deleted).toBe(true);
    expect((await ctx.store.get('doctext', document.id))!.deleted).toBe(true);
    await undo.redo();
    expect((await getText(ctx, document.id)).text).toBe('Olá 🌍');
  });
});

describe('createDocuments', () => {
  it('creates a batch in one write: unique names, positions in order, one undo step, one log entry each', async () => {
    const ctx = await makeTestProject();
    await createDocument(ctx, { name: 'Answer', kind: 'survey', text: 'x' });
    const progress: number[] = [];
    const { documents, undo } = await createDocuments(
      ctx,
      [
        { name: 'Answer', kind: 'survey', text: 'one', original: { bytes: new Uint8Array([1]), filename: 'a.txt', mime: 'text/plain' } },
        { name: 'answer', kind: 'survey', text: 'two' },
        { name: 'Other', kind: 'survey', text: 'three\r\n' },
      ],
      { onProgress: (d) => void progress.push(d) },
    );
    expect(documents.map((d) => d.name)).toEqual(['Answer (2)', 'answer (3)', 'Other']);
    expect(documents[0]!.order).toBeLessThan(documents[1]!.order);
    expect(documents[1]!.order).toBeLessThan(documents[2]!.order);
    expect((await getText(ctx, documents[2]!.id)).text).toBe('three\n');
    expect(progress).toEqual([1, 2, 3]);
    expect(undo.detail).toBe('×3');
    expect(await listLog(ctx, { action: 'document.add' })).toHaveLength(4);
    await undo.undo();
    expect((await ctx.store.list('document')).map((d) => d.name)).toEqual(['Answer']);
  });

  it('writes nothing, and removes stored files, when one input is invalid or the batch stops', async () => {
    const ctx = await makeTestProject();
    await expect(createDocuments(ctx, [{ name: 'A', kind: 'text', text: 'a' }, { name: ' ', kind: 'text', text: 'b' }])).rejects.toMatchObject({ code: 'invalid_argument' });
    await expect(createDocuments(ctx, [{ name: 'A', kind: 'text', text: 'a', case_id: 'nope' }])).rejects.toMatchObject({ code: 'not_found' });
    let asked = 0;
    const file = { bytes: new Uint8Array([1, 2]), filename: 'a.pdf', mime: 'application/pdf' };
    await expect(
      createDocuments(ctx, [{ name: 'A', kind: 'pdf', text: 'a', original: file }, { name: 'B', kind: 'pdf', text: 'b', original: file }], { shouldStop: () => ++asked > 1 }),
    ).rejects.toBeInstanceOf(JobStopped);
    expect(await ctx.store.list('document')).toHaveLength(0);
    expect(ctx.blobs.size).toBe(0);
  });

  it('shares names and positions across calls through DocumentSlots, reading the documents once', async () => {
    const ctx = await makeTestProject();
    await createDocument(ctx, { name: 'Interview', kind: 'text', text: 'x' });
    const slots = await DocumentSlots.load(ctx);
    const list = ctx.store.list.bind(ctx.store);
    let listed = 0;
    ctx.store.list = ((kind: Parameters<typeof list>[0], o?: Parameters<typeof list>[1]) => {
      if (kind === 'document') listed++;
      return list(kind, o);
    }) as typeof list;
    const a = await createDocument(ctx, { name: 'Interview', kind: 'text', text: 'a' }, { slots });
    const b = await createDocument(ctx, { name: 'Interview', kind: 'text', text: 'b' }, { slots });
    expect([a.document.name, b.document.name]).toEqual(['Interview (2)', 'Interview (3)']);
    expect(b.document.order).toBeGreaterThan(a.document.order);
    expect(listed).toBe(0);
    // A name given back is free again.
    expect(slots.take('Fresh').name).toBe('Fresh');
    slots.release('Fresh');
    expect(slots.take('fresh').name).toBe('fresh');
  });
});

describe('document properties', () => {
  it('changes the kind of a document, logged and undoable', async () => {
    const { ctx, doc } = await setup();
    const same = await setDocumentKind(ctx, doc.id, doc.kind);
    expect(same.undo.weight).toBe(0);
    const r = await setDocumentKind(ctx, doc.id, 'note');
    expect(r.document.kind).toBe('note');
    expect((await listLog(ctx, { action: 'document.edit' }))[0]!.summary).toBe(`"${doc.name}": ${doc.kind} → note`);
    await r.undo.undo();
    expect((await ctx.store.get('document', doc.id))!.kind).toBe(doc.kind);
    await expect(setDocumentKind(ctx, doc.id, 'video' as never)).rejects.toMatchObject({ code: 'invalid_argument' });
  });

  it('renames, unique-ifying and logging', async () => {
    const { ctx, doc } = await setup();
    await createDocument(ctx, { name: 'Interview 2', kind: 'text', text: '' });
    const r = await renameDocument(ctx, doc.id, 'Interview 2');
    expect(r.document.name).toBe('Interview 2 (2)');
    const [entry] = await listLog(ctx, { action: 'document.rename' });
    expect(entry!.summary).toBe('"Interview 1" → "Interview 2 (2)"');
    await r.undo.undo();
    expect((await ctx.store.get('document', doc.id))!.name).toBe('Interview 1');
  });

  it('sets the case and groups', async () => {
    const { ctx, doc } = await setup();
    const { case: c } = await createCase(ctx, { name: 'P01' });
    const { group: g1 } = await createGroup(ctx, { name: 'Wave 1' });
    const { group: g2 } = await createGroup(ctx, { name: 'Porto' });
    expect((await setDocumentCase(ctx, doc.id, c.id)).document.case_id).toBe(c.id);
    const r = await setDocumentGroups(ctx, doc.id, [g1.id, g2.id, g1.id]);
    expect(r.document.group_ids).toEqual([g1.id, g2.id]);
    await r.undo.undo();
    expect((await ctx.store.get('document', doc.id))!.group_ids).toEqual([]);
    await expect(setDocumentGroups(ctx, doc.id, ['missing'])).rejects.toMatchObject({ code: 'not_found' });
  });

  it('reorders with fractional order', async () => {
    const ctx = await makeTestProject();
    const ids: string[] = [];
    for (const n of ['A', 'B', 'C']) ids.push((await createDocument(ctx, { name: n, kind: 'text', text: '' })).document.id);
    await reorderDocument(ctx, ids[2]!, ids[0]!);
    const names = async () => (await ctx.store.list('document', { order: 'sort' })).map((d) => d.name);
    expect(await names()).toEqual(['C', 'A', 'B']);
    const u = await reorderDocument(ctx, ids[2]!, null);
    expect(await names()).toEqual(['A', 'B', 'C']);
    await u.undo();
    expect(await names()).toEqual(['C', 'A', 'B']);
  });
});

describe('deleteDocuments / restoreDocuments', () => {
  it('tombstones the document, its text, codings and memos in one batch', async () => {
    const { ctx, doc, code } = await setup();
    const { coding } = await applyCode(ctx, { documentId: doc.id, start: 37, end: 51, codeId: code.id });
    await createMemo(ctx, { title: 'About doc', target: { kind: 'document', id: doc.id } });
    await createMemo(ctx, { title: 'About segment', target: { kind: 'coding', id: coding.id } });
    const keep = await createMemo(ctx, { title: 'Project', target: { kind: 'project', id: null } });
    const r = await deleteDocuments(ctx, [doc.id, doc.id, 'missing']);
    expect([r.documents, r.codings, r.memos]).toEqual([1, 1, 2]);
    expect(await ctx.store.count('coding')).toBe(0);
    expect(await ctx.store.count('memo')).toBe(1);
    expect((await ctx.store.get('memo', keep.memo.id))!.deleted).toBe(false);
    const tomb = (await ctx.store.get('coding', coding.id)) as unknown as { deleted_batch: string };
    expect(tomb.deleted_batch).toBe(r.batch);

    const restored = await restoreDocuments(ctx, r.batch);
    expect(restored).toEqual({ documents: 1, codings: 1, memos: 2 });
    expect((await getText(ctx, doc.id)).text).toBe(TEXT);
    expect((await listLog(ctx, { action: 'document.restore' })).length).toBe(1);
  });

  it('undo restores everything, redo deletes again', async () => {
    const { ctx, doc, code } = await setup();
    await applyCode(ctx, { documentId: doc.id, start: 0, end: 11, codeId: code.id });
    const r = await deleteDocuments(ctx, [doc.id]);
    await r.undo.undo();
    expect(await ctx.store.count('coding')).toBe(1);
    expect(await ctx.store.count('document')).toBe(1);
    await r.undo.redo();
    expect(await ctx.store.count('coding')).toBe(0);
    expect(await ctx.store.count('doctext')).toBe(0);
  });
});

describe('editDocumentText', () => {
  it('remaps codings and refreshes their text', async () => {
    const { ctx, doc, code } = await setup();
    const porto = TEXT.indexOf('Porto');
    const { coding } = await applyCode(ctx, { documentId: doc.id, start: porto, end: porto + 'Porto, with Rui'.length, codeId: code.id });
    const { coding: first } = await applyCode(ctx, { documentId: doc.id, start: 0, end: 11, codeId: code.id });
    const next = TEXT.replace('I started in', 'Well, I first started working in').replace('Rui', 'Rúben').replace('Porto', 'Porto city');
    const r = await editDocumentText(ctx, doc.id, next);
    expect(r.removedCodings).toBe(0);
    const c = (await ctx.store.get('coding', coding.id))!;
    // A replaced word inside the coding is part of it; text inserted at its edge is not.
    expect(c.text).toBe('Porto city, with Rúben');
    expect(next.slice(c.start, c.end)).toBe(c.text);
    expect((await ctx.store.get('coding', first.id))!.text).toBe('Interviewer');
    expect((await ctx.store.get('document', doc.id))!.chars).toBe(next.length);
    const log = await listLog(ctx, { action: 'document.edit' });
    expect(log[0]!.summary).toMatch(/^"Interview 1" ×\d+$/);
  });

  it('removes codings whose text is deleted, with their memos, and undo brings them back', async () => {
    const { ctx, doc, code } = await setup();
    const at = TEXT.indexOf('with Rui');
    const { coding } = await applyCode(ctx, { documentId: doc.id, start: at, end: at + 8, codeId: code.id });
    await createMemo(ctx, { title: 'm', target: { kind: 'coding', id: coding.id } });
    const r = await editDocumentText(ctx, doc.id, TEXT.replace(', with Rui', ''));
    expect(r.removedCodings).toBe(1);
    expect(await ctx.store.count('coding')).toBe(0);
    expect(await ctx.store.count('memo')).toBe(0);
    expect((await listLog(ctx, { action: 'coding.remove' })).length).toBe(1);
    await r.undo.undo();
    expect((await getText(ctx, doc.id)).text).toBe(TEXT);
    expect((await ctx.store.get('coding', coding.id))!.deleted).toBe(false);
    expect(await ctx.store.count('memo')).toBe(1);
    await r.undo.redo();
    expect(await ctx.store.count('coding')).toBe(0);
  });

  it('moves sync points and canonicalises the new text', async () => {
    const ctx = await makeTestProject();
    const text = 'A: one\nB: two\nA: three';
    const { document } = await createDocument(ctx, { name: 'T', kind: 'transcript', text, sync: [{ pos: 7, ms: 500 }, { pos: 14, ms: 900 }] });
    await editDocumentText(ctx, document.id, 'A: one more\r\nB: two\r\nA: three');
    const t = await getText(ctx, document.id);
    expect(t.text).toBe('A: one more\nB: two\nA: three');
    expect(t.sync.map((s) => t.text.slice(s.pos, s.pos + 2))).toEqual(['B:', 'A:']);
  });

  it('does nothing for identical text', async () => {
    const { ctx, doc } = await setup();
    const before = await ctx.store.count('log');
    const r = await editDocumentText(ctx, doc.id, TEXT.replace(/\n/g, '\r\n'));
    expect(r.edits).toEqual([]);
    expect(await ctx.store.count('log')).toBe(before);
  });

  it('keeps emoji and accents intact through edits', async () => {
    const ctx = await makeTestProject();
    const text = 'Ela disse 😀 que São Tomé é lindo 🌴.';
    const { document } = await createDocument(ctx, { name: 'U', kind: 'text', text });
    const { code } = await createCode(ctx, { name: 'Lugar' });
    const s = text.indexOf('😀');
    const { coding } = await applyCode(ctx, { documentId: document.id, start: s, end: text.indexOf(' é'), codeId: code.id });
    const next = text.replace('São Tomé', 'Lisboa');
    await editDocumentText(ctx, document.id, next);
    const c = (await ctx.store.get('coding', coding.id))!;
    expect(c.text).toBe('😀 que Lisboa');
  });
});

describe('media and stats', () => {
  it('attaches, replaces and detaches media', async () => {
    const { ctx, doc } = await setup();
    const a = await attachMedia(ctx, doc.id, { bytes: new Uint8Array(10), filename: 'a.mp3', mime: 'audio/mpeg' });
    const b = await attachMedia(ctx, doc.id, { bytes: new Uint8Array(5), filename: 'b.mp3', mime: 'audio/mpeg' });
    expect(ctx.blobs.has(a.blob_id)).toBe(false);
    expect(ctx.blobs.has(b.blob_id)).toBe(true);
    expect((await ctx.store.get('document', doc.id))!.media?.blob_id).toBe(b.blob_id);
    await detachMedia(ctx, doc.id);
    expect(ctx.blobs.size).toBe(0);
    expect((await ctx.store.get('document', doc.id))!.media).toBeNull();
    const log = await listLog(ctx, { action: 'document.edit' });
    expect(log.every((l) => !l.summary.includes('.mp3'))).toBe(true);
  });

  it('computes statistics', async () => {
    const { ctx, doc, code } = await setup();
    await applyCode(ctx, { documentId: doc.id, start: 0, end: 11, codeId: code.id });
    await applyCode(ctx, { documentId: doc.id, start: 5, end: 20, codeId: (await createCode(ctx, { name: 'B' })).code.id });
    const s = await documentStats(ctx, doc.id);
    expect(s.paragraphs).toBe(3);
    expect(s.codings).toBe(2);
    expect(s.codes).toBe(2);
    expect(s.coders).toBe(1);
    expect(s.codedChars).toBe(20);
    expect(s.coverage).toBeCloseTo(20 / TEXT.length);
    expect(s.words).toBe(15);
  });
});

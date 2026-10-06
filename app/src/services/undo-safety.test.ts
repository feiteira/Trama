// Undo never writes over a newer change, never leaves a step half applied, and every operation
// is written whole or not at all (undo.ts, Store.write).
import { describe, expect, it } from 'vitest';
import { createDocument, attachMedia, deleteDocuments, editDocumentText, getText, restoreDocuments } from './documents';
import { createCode } from './codes';
import { applyCode } from './codings';
import { createMemo } from './memos';
import { apply, createPseudonym, deletePseudonym } from './pseudonyms';
import { makeTestProject } from './testing';
import { UndoManager } from './undo';
import type { Db } from '../core/store/db';

describe('undo after a key entry is erased', () => {
  it('an older step cannot write the real names back, and is dropped with everything older', async () => {
    const ctx = await makeTestProject();
    const m = new UndoManager();
    const { document: d } = await createDocument(ctx, { name: 'Interview 1', kind: 'text', text: 'Maria Silva said she was afraid. Typo teh.' });
    m.record((await editDocumentText(ctx, d.id, 'Maria Silva said she was afraid. Typo the.')).undo);
    const { pseudonym, undo: cu } = await createPseudonym(ctx, { original: 'Maria Silva', replacement: '[P1]' });
    m.record(cu);
    m.record((await apply(ctx)).undo);
    m.record(await deletePseudonym(ctx, pseudonym.id, { erase: true }));
    expect(m.canUndo).toBe(false);
    expect(m.canRedo).toBe(false);
    expect((await getText(ctx, d.id)).text).toBe('[P1] said she was afraid. Typo the.');
  });

  it('a step undone out of order (a toast, an old Undoable) refuses instead of writing over newer text', async () => {
    const ctx = await makeTestProject();
    const { document: d } = await createDocument(ctx, { name: 'Interview with Maria Silva', kind: 'text', text: 'Maria Silva said she was afraid. Typo teh.' });
    const edit = await editDocumentText(ctx, d.id, 'Maria Silva said she was afraid. Typo the.');
    await createPseudonym(ctx, { original: 'Maria Silva', replacement: '[P1]' });
    await apply(ctx);
    await expect(edit.undo.undo()).rejects.toMatchObject({ code: 'changed_since' });
    expect((await getText(ctx, d.id)).text).toBe('[P1] said she was afraid. Typo the.');
    expect((await ctx.store.get('document', d.id))!.name).toBe('Interview with [P1]');
  });
});

describe('a combined step is undone whole or not at all', () => {
  it('pseudonymisation undo refused by one document changes nothing at all', async () => {
    const ctx = await makeTestProject();
    const m = new UndoManager();
    const { document: a } = await createDocument(ctx, { name: 'A', kind: 'transcript', text: 'Maria Silva: hello.' });
    const { document: b } = await createDocument(ctx, { name: 'B', kind: 'text', text: 'Rui: I met Maria Silva.' });
    const { memo } = await createMemo(ctx, { title: 'About Maria Silva', target: { kind: 'project', id: null } });
    await createPseudonym(ctx, { original: 'Maria Silva', replacement: '[P1]' });
    m.record((await apply(ctx)).undo);
    await attachMedia(ctx, a.id, { bytes: new Uint8Array([1, 2, 3]), filename: 'a.mp3', mime: 'audio/mpeg' });
    await expect(m.undo()).rejects.toMatchObject({ code: 'changed_since' });
    expect((await getText(ctx, a.id)).text).toBe('[P1]: hello.');
    expect((await getText(ctx, b.id)).text).toBe('Rui: I met [P1].');
    expect((await ctx.store.get('memo', memo.id))!.title).toBe('About [P1]');
  });

  it('an undo that fails for another reason (a lock) writes nothing and can be tried again', async () => {
    const ctx = await makeTestProject();
    const m = new UndoManager();
    const { document: a } = await createDocument(ctx, { name: 'A', kind: 'text', text: 'Maria Silva: hello.' });
    await createDocument(ctx, { name: 'B', kind: 'text', text: 'Rui: I met Maria Silva.' });
    await createPseudonym(ctx, { original: 'Maria Silva', replacement: '[P1]' });
    m.record((await apply(ctx)).undo);
    const db = ctx.store.db as Db;
    const batch = db.batch.bind(db);
    db.batch = async () => {
      throw new Error('the project is closed');
    };
    await expect(m.undo()).rejects.toThrow('closed');
    db.batch = batch;
    expect((await getText(ctx, a.id)).text).toBe('[P1]: hello.');
    expect(m.canUndo).toBe(true);
    await m.undo();
    expect((await getText(ctx, a.id)).text).toBe('Maria Silva: hello.');
  });
});

describe('an operation is one transaction', () => {
  /** Fails the n-th write transaction; returns how many there were. */
  function failAt(db: Db, n: number) {
    const batch = db.batch.bind(db);
    let calls = 0;
    db.batch = async (s) => {
      if (++calls === n) throw new Error('locked');
      return batch(s);
    };
    return { restore: () => void (db.batch = batch), calls: () => calls };
  }

  it('a text edit that removes codings, and deleting and restoring documents, are written in one go', async () => {
    const ctx = await makeTestProject();
    const text = 'It was cold.\nWe stayed in.';
    const { document: d } = await createDocument(ctx, { name: 'I1', kind: 'text', text });
    const { code } = await createCode(ctx, { name: 'Weather' });
    await applyCode(ctx, { documentId: d.id, start: 7, end: 11, codeId: code.id });
    const db = ctx.store.db as Db;
    let f = failAt(db, 1);
    await expect(editDocumentText(ctx, d.id, 'We stayed in.')).rejects.toThrow('locked');
    f.restore();
    expect((await getText(ctx, d.id)).text).toBe(text);
    expect((await ctx.store.list('coding')).map((c) => c.text)).toEqual(['cold']);

    f = failAt(db, 1);
    await expect(deleteDocuments(ctx, [d.id])).rejects.toThrow('locked');
    f.restore();
    expect((await ctx.store.get('document', d.id))!.deleted).toBe(false);
    expect((await ctx.store.get('doctext', d.id))!.deleted).toBe(false);

    const del = await deleteDocuments(ctx, [d.id]);
    f = failAt(db, 1);
    await expect(restoreDocuments(ctx, del.batch)).rejects.toThrow('locked');
    f.restore();
    expect((await ctx.store.get('document', d.id))!.deleted).toBe(true);
    expect((await ctx.store.get('doctext', d.id))!.deleted).toBe(true);
  });
});

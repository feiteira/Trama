// Restoring from the trash puts codings back on their own words and never brings back names the
// pseudonymisation key replaced since the delete.
import { describe, expect, it } from 'vitest';
import { createCode, deleteCode, restoreCodes } from './codes';
import { applyCode, setComment } from './codings';
import { createDocument, deleteDocuments, editDocumentText, getText, restoreDocuments } from './documents';
import { createMemo, deleteMemo, restoreMemos } from './memos';
import { apply, createPseudonym, deletePseudonym } from './pseudonyms';
import { allCodings } from './queries';
import { makeTestProject } from './testing';

describe('restored codings sit on their own words', () => {
  it('a code restored after text was inserted before its coding lands on the same passage, not an earlier one with the same words', async () => {
    const ctx = await makeTestProject();
    const text = 'A: I trust my neighbours.\nB: Not much.\nA: I trust the council too.';
    const { document: doc } = await createDocument(ctx, { name: 'D', kind: 'transcript', text });
    const { code } = await createCode(ctx, { name: 'Trust' });
    const s = text.lastIndexOf('I trust');
    await applyCode(ctx, { documentId: doc.id, start: s, end: s + 7, codeId: code.id });
    const del = await deleteCode(ctx, code.id, { withChildren: 'delete' });
    const intro = 'Interviewer introduces the project at length here, before anything.\n';
    await editDocumentText(ctx, doc.id, intro + text);
    await restoreCodes(ctx, del.batch);
    const [c] = await allCodings(ctx);
    expect(c!.start).toBe((intro + text).lastIndexOf('I trust'));
    expect((await getText(ctx, doc.id)).text.slice(c!.start, c!.end)).toBe('I trust');
  });

  it('a coding whose words the edit removed stays deleted on restore', async () => {
    const ctx = await makeTestProject();
    const text = 'It was cold.\nIt was cold again.';
    const { document: doc } = await createDocument(ctx, { name: 'D', kind: 'text', text });
    const { code } = await createCode(ctx, { name: 'Weather' });
    await applyCode(ctx, { documentId: doc.id, start: 7, end: 11, codeId: code.id });
    const del = await deleteCode(ctx, code.id, { withChildren: 'delete' });
    await editDocumentText(ctx, doc.id, 'It was\nIt was cold again.');
    const r = await restoreCodes(ctx, del.batch);
    expect(r.codings).toBe(0);
    expect(await allCodings(ctx)).toEqual([]);
  });
});

describe('restoring after pseudonymisation', () => {
  it('a document deleted before the key was applied comes back with it applied', async () => {
    const ctx = await makeTestProject();
    const { document: a } = await createDocument(ctx, { name: 'Interview Maria Silva', kind: 'text', text: 'Maria Silva: hello.' });
    const { code } = await createCode(ctx, { name: 'Greeting' });
    const { coding } = await applyCode(ctx, { documentId: a.id, start: 0, end: 18, codeId: code.id });
    await setComment(ctx, coding.id, 'Maria Silva is polite');
    const del = await deleteDocuments(ctx, [a.id]);
    await createPseudonym(ctx, { original: 'Maria Silva', replacement: '[P1]' });
    await apply(ctx);
    // Apply reached the trash: the document is pseudonymised there already.
    expect((await ctx.store.get('document', a.id))!.name).toBe('Interview [P1]');
    const r = await restoreDocuments(ctx, del.batch);
    expect(r.pseudonymised).toBe(0);
    expect((await getText(ctx, a.id)).text).toBe('[P1]: hello.');
    expect((await ctx.store.get('document', a.id))!.name).toBe('Interview [P1]');
    const [c] = await allCodings(ctx);
    expect(c!.text).toBe('[P1]: hello');
    expect(c!.comment).toBe('[P1] is polite');
  });

  it('codes and memos deleted before the key was applied come back with it applied', async () => {
    const ctx = await makeTestProject();
    const { code } = await createCode(ctx, { name: 'What Maria Silva wants' });
    const delCode = await deleteCode(ctx, code.id, { withChildren: 'delete' });
    const { memo } = await createMemo(ctx, { title: 'Maria Silva', body: 'Call Maria Silva back.', target: { kind: 'project', id: null } });
    const delMemo = await deleteMemo(ctx, memo.id);
    await createPseudonym(ctx, { original: 'Maria Silva', replacement: '[P1]' });
    await apply(ctx);
    // Apply reached the trash: nothing is left for the restore to replace.
    expect((await restoreCodes(ctx, delCode.batch)).pseudonymised).toBe(0);
    expect((await ctx.store.get('code', code.id))!.name).toBe('What [P1] wants');
    await restoreMemos(ctx, delMemo.batch);
    expect(await ctx.store.get('memo', memo.id)).toMatchObject({ title: '[P1]', body: 'Call [P1] back.' });
  });
});

describe('restoring never names what the key replaced', () => {
  it('restore entries in the audit trail read as the records do afterwards', async () => {
    const ctx = await makeTestProject();
    const { document: a } = await createDocument(ctx, { name: 'Interview with Maria Silva', kind: 'text', text: 'Hello.' });
    const delDoc = await deleteDocuments(ctx, [a.id]);
    const { memo } = await createMemo(ctx, { title: 'About Maria Silva', body: 'x', target: { kind: 'project', id: null } });
    const delMemo = await deleteMemo(ctx, memo.id);
    const { code } = await createCode(ctx, { name: 'Maria Silva stuff' });
    const delCode = await deleteCode(ctx, code.id, { withChildren: 'delete' });
    await createPseudonym(ctx, { original: 'Maria Silva', replacement: 'P1' });
    await apply(ctx);
    const before = new Set((await ctx.store.list('log')).map((l) => l.id));
    await restoreDocuments(ctx, delDoc.batch);
    await restoreMemos(ctx, delMemo.batch);
    await restoreCodes(ctx, delCode.batch);
    const fresh = (await ctx.store.list('log')).filter((l) => !before.has(l.id)).map((l) => `${l.action} ${l.summary}`);
    expect(fresh).toEqual(expect.arrayContaining(['document.restore "Interview with P1"', 'memo.create ↶ "About P1"', 'code.restore "P1 stuff"']));
    expect(fresh.join('\n')).not.toContain('Maria');
  });

  it('apply reaches the trash, so a restore after the key entry is erased brings no name back', async () => {
    const ctx = await makeTestProject();
    const { document: d } = await createDocument(ctx, { name: 'Other Maria Silva', kind: 'text', text: 'Maria Silva was here.' });
    const { code } = await createCode(ctx, { name: 'Calm' });
    await applyCode(ctx, { documentId: d.id, start: 0, end: 11, codeId: code.id });
    const del = await deleteDocuments(ctx, [d.id]);
    const { memo } = await createMemo(ctx, { title: 'Maria Silva', body: 'Call Maria Silva.', target: { kind: 'project', id: null } });
    const delMemo = await deleteMemo(ctx, memo.id);
    const { pseudonym } = await createPseudonym(ctx, { original: 'Maria Silva', replacement: 'P1' });
    await apply(ctx);
    await deletePseudonym(ctx, pseudonym.id, { erase: true });
    const r = await restoreDocuments(ctx, del.batch);
    expect(r.pseudonymised).toBe(0);
    expect((await ctx.store.get('document', d.id))!.name).toBe('Other P1');
    expect((await getText(ctx, d.id)).text).toBe('P1 was here.');
    const [c] = await allCodings(ctx);
    expect([c!.start, c!.end, c!.text]).toEqual([0, 2, 'P1']);
    await restoreMemos(ctx, delMemo.batch);
    expect(await ctx.store.get('memo', memo.id)).toMatchObject({ title: 'P1', body: 'Call P1.' });
  });

  it('undoing the apply puts the trash back as it was, and redoing it again', async () => {
    const ctx = await makeTestProject();
    const { document: d } = await createDocument(ctx, { name: 'Maria Silva notes', kind: 'text', text: 'Maria Silva was here.' });
    await deleteDocuments(ctx, [d.id]);
    await createPseudonym(ctx, { original: 'Maria Silva', replacement: 'P1' });
    const r = await apply(ctx);
    const read = async () => [(await ctx.store.get('document', d.id))!.name, (await ctx.store.get('doctext', d.id))!.text, (await ctx.store.get('document', d.id))!.deleted];
    expect(await read()).toEqual(['P1 notes', 'P1 was here.', true]);
    await r.undo.undo();
    expect(await read()).toEqual(['Maria Silva notes', 'Maria Silva was here.', true]);
    await r.undo.redo();
    expect(await read()).toEqual(['P1 notes', 'P1 was here.', true]);
  });
});

import { describe, expect, it } from 'vitest';
import { createCode, updateCode } from './codes';
import {
  applyCode,
  autocode,
  codingsForDocument,
  inVivo,
  inVivoName,
  recode,
  removeCodeAt,
  removeCoding,
  resizeCoding,
  setComment,
} from './codings';
import { createDocument } from './documents';
import { createMemo } from './memos';
import { listLog } from './log';
import { makeTestProject } from './testing';

const TEXT = [
  'Interviewer: Tell me about the market.',
  'Rui: The market is busy. Prices went up! We still go every week.',
  'Interviewer: Why?',
  'Rui: Because we trust the sellers. They know us.',
].join('\n');

async function setup() {
  const ctx = await makeTestProject();
  const { document: doc } = await createDocument(ctx, { name: 'Market', kind: 'transcript', text: TEXT });
  const { code } = await createCode(ctx, { name: 'Market life' });
  return { ctx, doc, code };
}

const at = (s: string, from = 0) => {
  const i = TEXT.indexOf(s, from);
  if (i < 0) throw new Error(s);
  return { start: i, end: i + s.length };
};

describe('applyCode', () => {
  it('creates a coding with trimmed span and its text', async () => {
    const { ctx, doc, code } = await setup();
    const s = at(' The market is busy. ');
    const r = await applyCode(ctx, { documentId: doc.id, ...s, codeId: code.id });
    expect(r.created).toBe(true);
    expect(r.coding.text).toBe('The market is busy.');
    expect(r.coding.start).toBe(s.start + 1);
    expect(r.coding.coder_id).toBe(ctx.me.id);
    const [entry] = await listLog(ctx, { action: 'coding.add' });
    expect(entry!.summary).toBe('"Market life" → "Market"');
    await r.undo.undo();
    expect(await ctx.store.count('coding')).toBe(0);
    await r.undo.redo();
    expect(await ctx.store.count('coding')).toBe(1);
  });

  it('refuses categories and empty spans', async () => {
    const { ctx, doc, code } = await setup();
    await updateCode(ctx, code.id, { codable: false });
    await expect(applyCode(ctx, { documentId: doc.id, ...at('market'), codeId: code.id })).rejects.toMatchObject({ code: 'not_codable' });
    const { code: c2 } = await createCode(ctx, { name: 'X' });
    const nl = TEXT.indexOf('\n');
    await expect(applyCode(ctx, { documentId: doc.id, start: nl, end: nl + 1, codeId: c2.id })).rejects.toMatchObject({ code: 'empty_span' });
    await expect(applyCode(ctx, { documentId: doc.id, start: 3, end: 3, codeId: c2.id })).rejects.toMatchObject({ code: 'empty_span' });
    await expect(applyCode(ctx, { documentId: 'nope', start: 0, end: 3, codeId: c2.id })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('extends my overlapping or touching coding instead of adding one (the merge rule)', async () => {
    const { ctx, doc, code } = await setup();
    const first = await applyCode(ctx, { documentId: doc.id, ...at('The market is busy.'), codeId: code.id });
    const over = await applyCode(ctx, { documentId: doc.id, ...at('busy. Prices went up'), codeId: code.id });
    expect(over.created).toBe(false);
    expect(over.coding.id).toBe(first.coding.id);
    expect(over.coding.text).toBe('The market is busy. Prices went up');
    // Touching: starts exactly where it ends ("up" | "! We").
    const touch = await applyCode(ctx, { documentId: doc.id, ...at('! We still'), codeId: code.id });
    expect(touch.coding.id).toBe(first.coding.id);
    expect(touch.coding.text).toBe('The market is busy. Prices went up! We still');
    // A gap of a space is not touching: a separate coding.
    const apart = await applyCode(ctx, { documentId: doc.id, ...at('go every'), codeId: code.id });
    expect(apart.created).toBe(true);
    await removeCoding(ctx, [apart.coding.id]);
    expect(await ctx.store.count('coding')).toBe(1);
    // Inside: nothing changes.
    const inside = await applyCode(ctx, { documentId: doc.id, ...at('market is'), codeId: code.id });
    expect(inside.created).toBe(false);
    expect(await ctx.store.count('log', "json_extract(data, '$.action') = 'coding.add'")).toBe(4);
  });

  it('bridges two codings into one, keeping comments and memos', async () => {
    const { ctx, doc, code } = await setup();
    const a = await applyCode(ctx, { documentId: doc.id, ...at('The market'), codeId: code.id });
    const b = await applyCode(ctx, { documentId: doc.id, ...at('Prices went up!'), codeId: code.id });
    await setComment(ctx, b.coding.id, 'inflation');
    await createMemo(ctx, { title: 'on b', target: { kind: 'coding', id: b.coding.id } });
    const r = await applyCode(ctx, { documentId: doc.id, ...at('market is busy. Prices'), codeId: code.id });
    expect(r.absorbed).toBe(1);
    expect(r.coding.id).toBe(a.coding.id);
    expect(r.coding.text).toBe('The market is busy. Prices went up!');
    expect(r.coding.comment).toBe('inflation');
    expect((await ctx.store.get('coding', b.coding.id))!.deleted).toBe(true);
    expect((await ctx.store.list('memo'))[0]!.target).toEqual({ kind: 'coding', id: a.coding.id });
    await r.undo.undo();
    expect((await ctx.store.get('coding', b.coding.id))!.deleted).toBe(false);
    expect((await ctx.store.get('coding', a.coding.id))!.text).toBe('The market');
    expect((await ctx.store.list('memo'))[0]!.target).toEqual({ kind: 'coding', id: b.coding.id });
  });

  it("does not merge with another coder's coding or another code", async () => {
    const { ctx, doc, code } = await setup();
    await applyCode(ctx, { documentId: doc.id, ...at('The market is busy.'), codeId: code.id });
    const other = await ctx.store.put('coder', { name: 'Marta', color: '#e4572e' });
    ctx.actAs(other);
    const r = await applyCode(ctx, { documentId: doc.id, ...at('market is busy. Prices'), codeId: code.id });
    expect(r.created).toBe(true);
    const { code: c2 } = await createCode(ctx, { name: 'Prices' });
    expect((await applyCode(ctx, { documentId: doc.id, ...at('busy'), codeId: c2.id })).created).toBe(true);
    expect(await ctx.store.count('coding')).toBe(3);
  });

  it('never splits surrogate pairs', async () => {
    const ctx = await makeTestProject();
    const text = 'Gosto 😀 muito';
    const { document } = await createDocument(ctx, { name: 'E', kind: 'text', text });
    const { code } = await createCode(ctx, { name: 'Emoção' });
    const i = text.indexOf('😀');
    const r = await applyCode(ctx, { documentId: document.id, start: i + 1, end: i + 2, codeId: code.id });
    expect(r.coding.text).toBe('😀');
  });
});

describe('removing and changing codings', () => {
  it('removes codings with their memos and logs', async () => {
    const { ctx, doc, code } = await setup();
    const a = await applyCode(ctx, { documentId: doc.id, ...at('The market is busy.'), codeId: code.id });
    await createMemo(ctx, { title: 'm', target: { kind: 'coding', id: a.coding.id } });
    const r = await removeCoding(ctx, [a.coding.id]);
    expect(r.removed).toBe(1);
    expect(await ctx.store.count('memo')).toBe(0);
    expect((await listLog(ctx, { action: 'coding.remove' }))[0]!.summary).toBe('"Market life" → "Market"');
    await r.undo.undo();
    expect(await ctx.store.count('coding')).toBe(1);
    expect(await ctx.store.count('memo')).toBe(1);
    expect((await removeCoding(ctx, ['nope'])).removed).toBe(0);
  });

  it('removes a code at the caret, only mine by default', async () => {
    const { ctx, doc, code } = await setup();
    const s = at('The market is busy.');
    await applyCode(ctx, { documentId: doc.id, ...s, codeId: code.id });
    const me = ctx.me;
    ctx.actAs(await ctx.store.put('coder', { name: 'Marta', color: '#e4572e' }));
    await applyCode(ctx, { documentId: doc.id, ...s, codeId: code.id });
    ctx.actAs(me);
    expect((await removeCodeAt(ctx, doc.id, s.start + 3, code.id)).removed).toBe(1);
    expect((await removeCodeAt(ctx, doc.id, s.start + 3, code.id)).removed).toBe(0);
    expect((await removeCodeAt(ctx, doc.id, s.end, code.id, { anyCoder: true })).removed).toBe(1);
  });

  it('sets comments within the limit', async () => {
    const { ctx, doc, code } = await setup();
    const a = await applyCode(ctx, { documentId: doc.id, ...at('busy'), codeId: code.id });
    const r = await setComment(ctx, a.coding.id, 'Comentário ✓');
    expect(r.coding.comment).toBe('Comentário ✓');
    await expect(setComment(ctx, a.coding.id, 'x'.repeat(5000))).rejects.toMatchObject({ code: 'too_large' });
    await r.undo.undo();
    expect((await ctx.store.get('coding', a.coding.id))!.comment).toBe('');
  });

  it('recodes, merging with an existing coding of the new code', async () => {
    const { ctx, doc, code } = await setup();
    const { code: trust } = await createCode(ctx, { name: 'Trust' });
    const a = await applyCode(ctx, { documentId: doc.id, ...at('we trust the sellers.'), codeId: code.id });
    const r1 = await recode(ctx, a.coding.id, trust.id);
    expect(r1.coding.code_id).toBe(trust.id);
    expect(r1.coding.id).toBe(a.coding.id);
    // Recoding a touching coding of mine into Trust folds it in.
    const b = await applyCode(ctx, { documentId: doc.id, ...at('sellers. They know us.'), codeId: code.id });
    await setComment(ctx, b.coding.id, 'reciprocity');
    const r2 = await recode(ctx, b.coding.id, trust.id);
    expect(r2.coding.id).toBe(a.coding.id);
    expect(r2.coding.text).toBe('we trust the sellers. They know us.');
    expect(r2.coding.comment).toBe('reciprocity');
    expect((await ctx.store.get('coding', b.coding.id))!.deleted).toBe(true);
    await r2.undo.undo();
    expect((await ctx.store.get('coding', b.coding.id))!.code_id).toBe(code.id);
    expect((await ctx.store.get('coding', a.coding.id))!.text).toBe('we trust the sellers.');
    const { code: cat } = await createCode(ctx, { name: 'Cat', codable: false });
    await expect(recode(ctx, a.coding.id, cat.id)).rejects.toMatchObject({ code: 'not_codable' });
  });

  it('resizes, trimming and absorbing what it now touches', async () => {
    const { ctx, doc, code } = await setup();
    const a = await applyCode(ctx, { documentId: doc.id, ...at('The market'), codeId: code.id });
    const b = await applyCode(ctx, { documentId: doc.id, ...at('Prices'), codeId: code.id });
    const c = await applyCode(ctx, { documentId: doc.id, ...at('still go'), codeId: code.id });
    const s = at('The market is busy. ');
    const r = await resizeCoding(ctx, a.coding.id, s.start, s.end + 2);
    expect(r.coding.text).toBe('The market is busy. Prices');
    expect((await ctx.store.get('coding', b.coding.id))!.deleted).toBe(true);
    expect((await ctx.store.get('coding', c.coding.id))!.deleted).toBe(false);
    await r.undo.undo();
    expect((await ctx.store.get('coding', a.coding.id))!.text).toBe('The market');
    expect((await ctx.store.get('coding', b.coding.id))!.deleted).toBe(false);
    await expect(resizeCoding(ctx, a.coding.id, s.end - 1, s.end)).rejects.toMatchObject({ code: 'empty_span' });
  });

  it('lists codings of a document in text order', async () => {
    const { ctx, doc, code } = await setup();
    await applyCode(ctx, { documentId: doc.id, ...at('They know us.'), codeId: code.id });
    await applyCode(ctx, { documentId: doc.id, ...at('Tell me'), codeId: code.id });
    expect((await codingsForDocument(ctx, doc.id)).map((c) => c.text)).toEqual(['Tell me', 'They know us.']);
  });
});

describe('autocode', () => {
  it('codes hits widened to sentences, skipping covered ones, in one batch', async () => {
    const { ctx, doc, code } = await setup();
    const { document: doc2 } = await createDocument(ctx, { name: 'Second', kind: 'text', text: 'At the market. Nothing else.' });
    await applyCode(ctx, { documentId: doc.id, ...at('Rui: The market is busy.'), codeId: code.id });
    const hits = [
      { documentId: doc.id, ...at('market', TEXT.indexOf('Rui')) }, // already covered
      { documentId: doc.id, ...at('market') }, // first line
      { documentId: doc.id, ...at('sellers') },
      { documentId: doc2.id, start: 7, end: 13 },
      { documentId: 'deleted-doc', start: 0, end: 3 },
    ];
    const r = await autocode(ctx, { codeId: code.id, hits, expand: 'sentence' });
    expect(r.skipped).toBe(1);
    expect(r.created).toBe(3);
    expect(r.count).toBe(3);
    const texts = (await ctx.store.list('coding')).map((c) => c.text).sort();
    expect(texts).toEqual(['At the market.', 'Interviewer: Tell me about the market.', 'Rui: Because we trust the sellers.', 'Rui: The market is busy.']);
    const [entry] = await listLog(ctx, { action: 'coding.autocode' });
    expect(entry!.summary).toBe('"Market life" ×3');
    await r.undo.undo();
    expect(await ctx.store.count('coding')).toBe(1);
    await r.undo.redo();
    expect(await ctx.store.count('coding')).toBe(4);
  });

  it('extends existing codings and merges hits in the same paragraph', async () => {
    const { ctx, doc, code } = await setup();
    await applyCode(ctx, { documentId: doc.id, ...at('Prices went up!'), codeId: code.id });
    const r = await autocode(ctx, {
      codeId: code.id,
      hits: [{ documentId: doc.id, ...at('busy') }, { documentId: doc.id, ...at('every week') }],
      expand: 'paragraph',
    });
    expect(r.extended).toBe(1);
    expect(r.created).toBe(0);
    const all = await ctx.store.list('coding');
    expect(all.length).toBe(1);
    expect(all[0]!.text).toBe('Rui: The market is busy. Prices went up! We still go every week.');
  });

  it('codes the exact hit and handles no hits', async () => {
    const { ctx, doc, code } = await setup();
    const r = await autocode(ctx, { codeId: code.id, hits: [{ documentId: doc.id, ...at('busy') }], expand: 'hit' });
    expect(r.created).toBe(1);
    expect((await ctx.store.list('coding'))[0]!.text).toBe('busy');
    const none = await autocode(ctx, { codeId: code.id, hits: [], expand: 'hit' });
    expect(none.count).toBe(0);
  });
});

describe('inVivo', () => {
  it('names codes from the words', () => {
    expect(inVivoName('  “we trust the sellers.” ')).toBe('we trust the sellers');
    const long = inVivoName('a'.repeat(10) + ' ' + 'word '.repeat(30));
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith('…')).toBe(true);
    expect(inVivoName('...')).toBe('...');
    expect(inVivoName('😀'.repeat(40)).length).toBeLessThanOrEqual(60);
  });

  it('creates a code and applies it; undo removes both', async () => {
    const { ctx, doc, code } = await setup();
    const r = await inVivo(ctx, { documentId: doc.id, ...at(' "we trust the sellers"'.trim().replace(/"/g, '') ), parent_id: code.id });
    expect(r.code.name).toBe('we trust the sellers');
    expect(r.code.parent_id).toBe(code.id);
    expect(r.coding.code_id).toBe(r.code.id);
    await r.undo.undo();
    expect((await ctx.store.get('code', r.code.id))!.deleted).toBe(true);
    expect(await ctx.store.count('coding')).toBe(0);
    await r.undo.redo();
    expect(await ctx.store.count('coding')).toBe(1);
  });
});

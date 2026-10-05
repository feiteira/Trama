import { describe, expect, it } from 'vitest';
import {
  casesFromDocuments,
  coerceValue,
  createAttribute,
  createCase,
  deleteAttribute,
  deleteCase,
  importAttributeTable,
  inferAttributeType,
  listAttributes,
  parseBoolean,
  parseDate,
  parseNumber,
  reorderAttribute,
  setCaseValue,
  updateAttribute,
  updateCase,
} from './cases';
import { createDocument, setDocumentCase } from './documents';
import { createMemo } from './memos';
import { listLog } from './log';
import { makeTestProject } from './testing';

describe('value parsing', () => {
  it('parses numbers with comma or dot decimals', () => {
    expect(parseNumber('42')).toBe(42);
    expect(parseNumber('-3,5')).toBe(-3.5);
    expect(parseNumber('3.5')).toBe(3.5);
    expect(parseNumber('1 234,5')).toBe(1234.5);
    expect(parseNumber('1.234,5')).toBe(1234.5);
    expect(parseNumber('1,234.5')).toBe(1234.5);
    expect(parseNumber('1.234.567')).toBe(1234567);
    expect(parseNumber('1\u00A0000')).toBe(1000);
    expect(parseNumber('.5')).toBe(0.5);
    for (const bad of ['', 'abc', '1,2,3.4.5', '12a', '1e5', '--1', '1.2.3,4,5']) expect(parseNumber(bad)).toBeNull();
  });

  it('parses ISO dates only, and real ones', () => {
    expect(parseDate('2024-02-29')).toBe('2024-02-29');
    expect(parseDate(' 2024-03-05T10:00:00Z ')).toBe('2024-03-05');
    expect(parseDate('2023-02-29')).toBeNull();
    expect(parseDate('05/03/2024')).toBeNull();
    expect(parseDate('2024-13-01')).toBeNull();
  });

  it('parses yes/no in three languages', () => {
    for (const t of ['yes', 'Sim', 'SÍ', 'si', 'true', '1', 'Verdadeiro']) expect(parseBoolean(t)).toBe(true);
    for (const f of ['no', 'Não', 'nao', 'false', '0', 'NO']) expect(parseBoolean(f)).toBe(false);
    expect(parseBoolean('maybe')).toBeNull();
  });

  it('coerces values by type', () => {
    expect(coerceValue('number', '3,5')).toEqual({ ok: true, value: 3.5 });
    expect(coerceValue('number', 'x')).toEqual({ ok: false });
    expect(coerceValue('number', true)).toEqual({ ok: false });
    expect(coerceValue('boolean', 1)).toEqual({ ok: true, value: true });
    expect(coerceValue('boolean', 2)).toEqual({ ok: false });
    expect(coerceValue('text', 34)).toEqual({ ok: true, value: '34' });
    expect(coerceValue('text', '  a  b ')).toEqual({ ok: true, value: 'a b' });
    expect(coerceValue('date', '  ')).toEqual({ ok: true, value: null });
    expect(coerceValue('date', 20240101)).toEqual({ ok: false });
    expect(coerceValue('choice', null)).toEqual({ ok: true, value: null });
  });

  it('infers column types', () => {
    expect(inferAttributeType(['34', '1,5', ''])).toEqual({ type: 'number', options: [] });
    expect(inferAttributeType(['2024-01-01', '2023-12-31'])).toEqual({ type: 'date', options: [] });
    expect(inferAttributeType(['Porto', 'Lisboa', 'porto'])).toEqual({ type: 'choice', options: ['porto', 'Lisboa'] });
    expect(inferAttributeType(Array.from({ length: 13 }, (_, i) => `v${i}`)).type).toBe('text');
    expect(inferAttributeType(['a'.repeat(61)]).type).toBe('text');
    expect(inferAttributeType([]).type).toBe('text');
  });
});

describe('cases', () => {
  it('creates, edits and sets values with coercion', async () => {
    const ctx = await makeTestProject();
    const { case: c } = await createCase(ctx, { name: 'P01' });
    const { attribute: age } = await createAttribute(ctx, { name: 'Idade', type: 'number' });
    const { attribute: site } = await createAttribute(ctx, { name: 'Local', type: 'choice', options: ['Porto'] });
    const { attribute: joined } = await createAttribute(ctx, { name: 'Entrada', type: 'date' });
    const { attribute: consent } = await createAttribute(ctx, { name: 'Consentimento', type: 'boolean' });
    expect((await setCaseValue(ctx, c.id, age.id, '34,5')).case.values[age.id]).toBe(34.5);
    expect((await setCaseValue(ctx, c.id, joined.id, '2024-05-01')).case.values[joined.id]).toBe('2024-05-01');
    expect((await setCaseValue(ctx, c.id, consent.id, 'sim')).case.values[consent.id]).toBe(true);
    // A choice value that matches an option case-insensitively takes its spelling; a new one becomes an option.
    expect((await setCaseValue(ctx, c.id, site.id, 'porto')).case.values[site.id]).toBe('Porto');
    await setCaseValue(ctx, c.id, site.id, 'Braga');
    expect((await ctx.store.get('attribute', site.id))!.options).toEqual(['Porto', 'Braga']);
    await expect(setCaseValue(ctx, c.id, age.id, 'trinta')).rejects.toMatchObject({ code: 'invalid_value' });
    const cleared = await setCaseValue(ctx, c.id, age.id, '');
    expect(age.id in cleared.case.values).toBe(false);
    await cleared.undo.undo();
    expect((await ctx.store.get('case', c.id))!.values[age.id]).toBe(34.5);
    const logs = await listLog(ctx, { action: 'case.edit' });
    expect(logs.every((l) => !l.summary.includes('34'))).toBe(true);
    expect((await updateCase(ctx, c.id, { name: 'P02' })).case.name).toBe('P02');
  });

  it('deletes a case, unlinking documents and removing its memos', async () => {
    const ctx = await makeTestProject();
    const { case: c } = await createCase(ctx, { name: 'P01' });
    const { document } = await createDocument(ctx, { name: 'Entrevista', kind: 'text', text: 'x', case_id: c.id });
    await createMemo(ctx, { title: 'm', target: { kind: 'case', id: c.id } });
    const r = await deleteCase(ctx, c.id);
    expect(r.documents).toBe(1);
    expect((await ctx.store.get('document', document.id))!.case_id).toBeNull();
    expect(await ctx.store.count('memo')).toBe(0);
    await r.undo.undo();
    expect((await ctx.store.get('document', document.id))!.case_id).toBe(c.id);
    expect(await ctx.store.count('memo')).toBe(1);
  });

  it('makes one case per document', async () => {
    const ctx = await makeTestProject();
    const d1 = (await createDocument(ctx, { name: 'Ana', kind: 'text', text: '' })).document;
    const d2 = (await createDocument(ctx, { name: 'Rui', kind: 'text', text: '' })).document;
    const d3 = (await createDocument(ctx, { name: 'Marta', kind: 'text', text: '' })).document;
    const { case: existing } = await createCase(ctx, { name: 'rui' });
    const { case: other } = await createCase(ctx, { name: 'Other' });
    await setDocumentCase(ctx, d3.id, other.id);
    const r = await casesFromDocuments(ctx, [d1.id, d2.id, d3.id]);
    expect(r).toMatchObject({ created: 1, linked: 2, skipped: 1 });
    expect((await ctx.store.get('document', d2.id))!.case_id).toBe(existing.id);
    const anaCase = (await ctx.store.list('case')).find((c) => c.name === 'Ana')!;
    expect((await ctx.store.get('document', d1.id))!.case_id).toBe(anaCase.id);
    await r.undo.undo();
    expect((await ctx.store.get('document', d1.id))!.case_id).toBeNull();
    expect(await ctx.store.count('case')).toBe(2);
  });
});

describe('attributes', () => {
  it('changes type, converting values and clearing the rest', async () => {
    const ctx = await makeTestProject();
    const { attribute: a } = await createAttribute(ctx, { name: 'Idade', type: 'text' });
    const c1 = (await createCase(ctx, { name: 'P1' })).case;
    const c2 = (await createCase(ctx, { name: 'P2' })).case;
    await setCaseValue(ctx, c1.id, a.id, '34');
    await setCaseValue(ctx, c2.id, a.id, 'trinta');
    const r = await updateAttribute(ctx, a.id, { type: 'number' });
    expect(r.cleared).toBe(1);
    expect((await ctx.store.get('case', c1.id))!.values[a.id]).toBe(34);
    expect(a.id in (await ctx.store.get('case', c2.id))!.values).toBe(false);
    await r.undo.undo();
    expect((await ctx.store.get('case', c2.id))!.values[a.id]).toBe('trinta');
    // To choice: values become options.
    const r2 = await updateAttribute(ctx, a.id, { type: 'choice' });
    expect(r2.attribute.options).toEqual(['34', 'trinta']);
    expect(r2.cleared).toBe(0);
    // Dropping an option clears the values using it.
    const r3 = await updateAttribute(ctx, a.id, { options: ['34'] });
    expect(r3.cleared).toBe(1);
    expect((await listLog(ctx, { action: 'attribute.edit' })).some((l) => l.summary.includes('text → choice'))).toBe(true);
  });

  it('deletes an attribute with its values and reorders', async () => {
    const ctx = await makeTestProject();
    const { attribute: a } = await createAttribute(ctx, { name: 'A', type: 'text' });
    const { attribute: b } = await createAttribute(ctx, { name: 'B', type: 'text' });
    const c = (await createCase(ctx, { name: 'P1' })).case;
    await setCaseValue(ctx, c.id, a.id, 'x');
    await reorderAttribute(ctx, b.id, a.id);
    expect((await listAttributes(ctx)).map((x) => x.name)).toEqual(['B', 'A']);
    const r = await deleteAttribute(ctx, a.id);
    expect((await ctx.store.get('case', c.id))!.values).toEqual({});
    await r.undo.undo();
    expect((await ctx.store.get('case', c.id))!.values).toEqual({ [a.id]: 'x' });
  });
});

describe('importAttributeTable', () => {
  const rows = [
    ['Participante', 'Idade', 'Cidade', 'Entrada', 'Notas', ''],
    ['P01', '34', 'Porto', '2024-01-10', 'Gosta de café', 'ignored'],
    ['p02', '41,5', 'Lisboa', '2024-02-01', 'Fala devagar', ''],
    ['P03', '', 'porto', '2024-03-15', 'Muito ocupada', ''],
    ['Zé Ninguém', '29', 'Braga', '2024-04-01', 'Nova', ''],
    ['', '', '', '', '', ''],
  ];

  it('matches cases, creates attributes with inferred types and reports unmatched rows', async () => {
    const ctx = await makeTestProject();
    await createCase(ctx, { name: 'P01' });
    await createCase(ctx, { name: 'P02' });
    await createCase(ctx, { name: 'P03' });
    const r = await importAttributeTable(ctx, rows, { header: true, nameColumn: 0, createMissing: false });
    expect(r).toMatchObject({ matched: 3, created: 0, unmatched: ['Zé Ninguém'], attributesCreated: 4, invalid: 0 });
    const attrs = await listAttributes(ctx);
    const byName = new Map(attrs.map((a) => [a.name, a]));
    expect(byName.get('Idade')!.type).toBe('number');
    expect(byName.get('Cidade')!.type).toBe('choice');
    expect(byName.get('Cidade')!.options).toEqual(['porto', 'Lisboa', 'Braga']);
    expect(byName.get('Entrada')!.type).toBe('date');
    expect(byName.get('Notas')!.type).toBe('choice');
    const p2 = (await ctx.store.list('case')).find((c) => c.name === 'P02')!;
    expect(p2.values[byName.get('Idade')!.id]).toBe(41.5);
    expect(p2.values[byName.get('Cidade')!.id]).toBe('Lisboa');
    const p3 = (await ctx.store.list('case')).find((c) => c.name === 'P03')!;
    expect(byName.get('Idade')!.id in p3.values).toBe(false);
    await r.undo.undo();
    expect(await ctx.store.count('attribute')).toBe(0);
    expect((await ctx.store.list('case')).every((c) => Object.keys(c.values).length === 0)).toBe(true);
  });

  it('creates missing cases and fills existing attributes, counting invalid cells', async () => {
    const ctx = await makeTestProject();
    const { attribute: age } = await createAttribute(ctx, { name: 'idade', type: 'number' });
    const r = await importAttributeTable(
      ctx,
      [['Nome', 'Idade'], ['Ana', '30'], ['Rui', 'trinta'], ['Ana', '31']],
      { header: true, nameColumn: 0, createMissing: true },
    );
    expect(r).toMatchObject({ matched: 0, created: 2, attributesCreated: 0, invalid: 1, unmatched: [] });
    const ana = (await ctx.store.list('case')).find((c) => c.name === 'Ana')!;
    expect(ana.values[age.id]).toBe(31);
    expect((await listLog(ctx, { action: 'attribute.edit' })).length).toBeGreaterThan(0);
  });

  it('handles tables without a header and empty input', async () => {
    const ctx = await makeTestProject();
    const r = await importAttributeTable(ctx, [['Ana', '30']], { header: false, nameColumn: 0, createMissing: true });
    expect(r.created).toBe(1);
    expect((await listAttributes(ctx))[0]!.name).toBe('#2');
    const empty = await importAttributeTable(ctx, [], { header: true, nameColumn: 0, createMissing: true });
    expect(empty).toMatchObject({ matched: 0, created: 0, attributesCreated: 0 });
    await expect(importAttributeTable(ctx, [['a']], { header: true, nameColumn: 3, createMissing: true })).rejects.toMatchObject({ code: 'invalid_argument' });
  });
});

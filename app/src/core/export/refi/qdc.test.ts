import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { utf8 } from '../../bytes';
import type { Code, Draft } from '../../model/types';
import { validate } from '../../model/validate';
import { RefiError } from './common';
import { CODEBOOK_XSD, validateXsd, xsdPython } from './fixtures/xsd';
import { exportQdc, importQdc } from './qdc';

let n = 0;
function code(name: string, parent: Code | null, extra: Partial<Code> = {}): Code {
  n++;
  return {
    id: `0000000${n}-aaaa-4bbb-8ccc-${String(n).padStart(12, '0')}`.slice(-36),
    created_at: '2026-10-05T12:00:00.000Z',
    updated_at_hlc: `000000000000001-0000${n}-test`,
    deleted: false,
    name,
    parent_id: parent?.id ?? null,
    color: '#29a37a',
    description: '',
    inclusion: '',
    exclusion: '',
    example: '',
    order: n,
    codable: true,
    shortcut: null,
    ...extra,
  };
}

function tree(codes: Draft<'code'>[]): string[] {
  const byId = new Map(codes.map((c) => [c.id!, c]));
  const path = (c: Draft<'code'>): string => (c.parent_id ? `${path(byId.get(c.parent_id)!)}/${c.name}` : c.name);
  return codes.map(path);
}

describe('qdc', () => {
  const emocoes = code('Emoções', null, { codable: false, color: '#6c4ab6', description: 'Pasta' });
  const alegria = code('Alegria & "felicidade" 😀', emocoes, { description: 'Def.', inclusion: 'Quando…', exclusion: 'Ironia', example: '"Yay"', color: '#f3a712' });
  const medo = code('Medo', emocoes);
  const subMedo = code('Medo <noturno>', medo);
  const trabalho = code('Trabalho', null);
  const apagado = code('Apagado', null, { deleted: true });
  const codes = [trabalho, subMedo, alegria, medo, emocoes, apagado];

  it('round-trips the tree, colours, codability and definitions', () => {
    const xml = exportQdc(codes, { origin: 'Trama 0.1.0' });
    const back = importQdc(xml);
    expect(back.origin).toBe('Trama 0.1.0');
    expect(back.warnings).toEqual([]);
    expect(tree(back.codes)).toEqual(['Emoções', 'Emoções/Alegria & "felicidade" 😀', 'Emoções/Medo', 'Emoções/Medo/Medo <noturno>', 'Trabalho']);
    const a = back.codes.find((c) => c.name.startsWith('Alegria'))!;
    expect(a).toMatchObject({ description: 'Def.', inclusion: 'Quando…', exclusion: 'Ironia', example: '"Yay"', color: '#f3a712', codable: true, shortcut: null });
    expect(back.codes[0]).toMatchObject({ codable: false, color: '#6c4ab6', description: 'Pasta' });
    for (const c of back.codes) expect(() => validate('code', c)).not.toThrow();
    expect(xml).not.toContain('Apagado');
  });

  it('parents come before children and orders are per sibling list', () => {
    const back = importQdc(exportQdc(codes, { origin: 'Trama' }));
    const seen = new Set<string | null>([null]);
    for (const c of back.codes) {
      expect(seen.has(c.parent_id)).toBe(true);
      seen.add(c.id);
    }
    expect(back.codes.filter((c) => c.parent_id === back.codes[0]!.id).map((c) => c.order)).toEqual([1, 2]);
  });

  it.skipIf(!xsdPython)('validates against Codebook.xsd, also when empty', () => {
    expect(validateXsd(CODEBOOK_XSD, exportQdc(codes, { origin: 'Trama 0.1.0' }))).toBe('ok');
    expect(validateXsd(CODEBOOK_XSD, exportQdc([], { origin: 'Trama 0.1.0' }))).toBe('ok');
  });

  it('reads the reference example, including code sets (guid= members)', () => {
    const xml = readFileSync(new URL('./fixtures/example-codebook.qdc', import.meta.url), 'utf8');
    const back = importQdc(utf8(xml));
    expect(tree(back.codes)).toEqual(['Emotions', 'Emotions/Joy', 'Work']);
    expect(back.codes[1]).toMatchObject({ color: '#f5a623', description: 'Expressions of happiness' });
    expect(back.warnings).toEqual(['1 set(s) of codes were not imported (Trama has no code sets).']);
  });

  it('keeps other producers\' descriptions whole', () => {
    const xml = `<CodeBook xmlns="urn:QDA-XML:codebook:1.0" origin="MAXQDA"><Codes><Code guid="{A0000000-0000-4000-8000-000000000001}" name="X" isCodable="true"><Description>Def.\n\nExample:\nnot a section</Description></Code></Codes></CodeBook>`;
    expect(importQdc(xml).codes[0]).toMatchObject({ description: 'Def.\n\nExample:\nnot a section', example: '' });
  });

  it('accepts a BOM, a pre-1.0 namespace, missing isCodable and duplicate GUIDs', () => {
    const xml = `﻿<?xml version="1.0"?><CodeBook xmlns="urn:QDA-XML:codebook:0:4"><Codes>
      <Code guid="a0000000-0000-4000-8000-000000000001" name="A"><Code guid="a0000000-0000-4000-8000-000000000001" name="dup"><Code guid="a0000000-0000-4000-8000-000000000002" name="B" color="#abc"/></Code></Code>
    </Codes></CodeBook>`;
    const back = importQdc(utf8(xml));
    expect(tree(back.codes)).toEqual(['A', 'A/B']);
    expect(back.codes[0]!.codable).toBe(true);
    expect(back.codes[1]!.color).toBe('#aabbcc');
  });

  it('reads the codebook of a project file too', () => {
    const xml = `<Project xmlns="urn:QDA-XML:project:1.0" name="P"><CodeBook><Codes><Code guid="a0000000-0000-4000-8000-000000000001" name="Só" isCodable="false"/></Codes></CodeBook></Project>`;
    expect(importQdc(xml).codes.map((c) => c.name)).toEqual(['Só']);
  });

  it('rejects other files', () => {
    expect(() => importQdc('not xml')).toThrow(RefiError);
    expect(() => importQdc('<Something/>')).toThrow(RefiError);
  });

  it('survives parent cycles and missing parents in the input records', () => {
    const a = code('Ciclo A', null);
    const b = code('Ciclo B', a);
    a.parent_id = b.id;
    const orphan = code('Órfão', null, { parent_id: 'missing' });
    const back = importQdc(exportQdc([a, b, orphan], { origin: 'Trama' }));
    expect(back.codes.map((c) => c.name).sort()).toEqual(['Ciclo A', 'Ciclo B', 'Órfão']);
  });
});

describe('code definitions with labels in their own text', () => {
  const roundTrip = (extra: Partial<Code>) => {
    const c = code('Pertença', null, extra);
    const back = importQdc(exportQdc([c], { origin: 'Trama 0.1.0' })).codes[0]!;
    return { description: back.description, inclusion: back.inclusion, exclusion: back.exclusion, example: back.example };
  };

  it('keeps an "Example:" line inside the definition, and the real example in its field', () => {
    const description = 'Feeling part of the garden group.\nExample: "we are a family here" (Interview 3).\nAlso covers neighbours.';
    expect(roundTrip({ description, inclusion: 'Statements of attachment.', example: '"I feel at home"' })).toEqual({
      description,
      inclusion: 'Statements of attachment.',
      exclusion: '',
      example: '"I feel at home"',
    });
  });

  it('keeps a definition whose line reads exactly like a label, with no example of its own', () => {
    const description = 'Feeling part of the group.\n\nExample:\n"we are a family here"\n\nInclusion criteria:\nwritten by hand';
    expect(roundTrip({ description })).toEqual({ description, inclusion: '', exclusion: '', example: '' });
    const inclusion = 'Use when…\n\nExclusion criteria:\nnot this';
    expect(roundTrip({ inclusion, exclusion: 'Irony.' })).toEqual({ description: '', inclusion, exclusion: 'Irony.', example: '' });
  });

  it('reads files from older versions, which wrote labels without escaping', () => {
    const qdc = (desc: string) =>
      `<?xml version="1.0" encoding="utf-8"?><CodeBook xmlns="urn:QDA-XML:codebook:1.0" origin="Trama 0.1.0"><Codes><Code guid="a0000000-0000-4000-8000-000000000001" name="X" isCodable="true"><Description>${desc}</Description></Code></Codes></CodeBook>`;
    const read = (desc: string) => importQdc(qdc(desc)).codes[0]!;
    expect(read('Def.\n\nInclusion criteria:\nIn.\n\nExample:\nEx.')).toMatchObject({ description: 'Def.', inclusion: 'In.', exclusion: '', example: 'Ex.' });
    // A heading out of order cannot be one of Trama's: it stays in the text before the block.
    expect(read('Def.\n\nExample:\nmine\n\nInclusion criteria:\nIn.')).toMatchObject({ description: 'Def.\n\nExample:\nmine', inclusion: 'In.', example: '' });
    // "Example: …" on one line is the researcher's text.
    expect(read('Def.\nExample: one.\nExample: two.')).toMatchObject({ description: 'Def.\nExample: one.\nExample: two.', example: '' });
  });
});

import { sha256 } from '@noble/hashes/sha2.js';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { toHex, utf8 } from '../../bytes';
import type { Draft, Entity, Kind, MediaRef } from '../../model/types';
import { validate } from '../../model/validate';
import type { ProjectBundle } from '../bundle';
import { PROJECT_XSD, validateXsd, xsdPython } from './fixtures/xsd';
import { importQdpx } from './qdpx-import';
import { exportQdpx } from './qdpx-export';
import { RecordFactory } from './records';

const NOW = () => new Date('2026-10-05T12:00:00Z');

const TEXT1 = [
  'Entrevistadora: Olá! Como correu o seu primeiro ano? 😀',
  'Participante: Gosto muito do meu trabalho, a equipa é fantástica 👩‍💻.',
  'Entrevistadora: E a família?',
  'Participante: A família é tudo — mas o horário é difícil. 𝄞 Música ajuda.',
].join('\n');
const TEXT_PDF = 'Relatório anual sobre bem-estar.\nSecção 2: resultados — satisfação elevada.';
const TEXT_EDITED = 'Relatório da [ESCOLA] com nomes removidos.';
const TEXT_TRANSCRIPT = 'Ana: Bom dia.\nBruno: Bom dia, vamos começar 🎙️.\nAna: Sim.';

const PDF_BYTES = utf8('%PDF-1.4\n% fictional test pdf\n%%EOF\n');
const AUDIO_BYTES = new Uint8Array(4096).map((_, i) => (i * 7) & 255);

interface Built {
  bundle: ProjectBundle;
  ids: Record<string, string>;
}

/** A small fictional project exercising every record kind the exporter writes. */
function buildBundle(): Built {
  const f = new RecordFactory(NOW);
  const ids: Record<string, string> = {};
  const blobs = new Map<string, Uint8Array>();
  const put = <K extends Kind>(key: string, kind: K, draft: Record<string, unknown>): Entity<K> => {
    const r = f.make(kind, draft as unknown as Draft<K>);
    ids[key] = r.id;
    return r;
  };
  const sha = (t: string) => toHex(sha256(utf8(t)));
  const media = (id: string, bytes: Uint8Array, filename: string, mime: string): MediaRef => {
    blobs.set(id, bytes);
    return { blob_id: id, filename, mime, size: bytes.length };
  };

  put('ana', 'coder', { name: 'Ana Sousa', color: '#3a6ea5' });
  put('bruno', 'coder', { name: 'Bruno Díaz', color: '#e4572e' });
  const code = (key: string, name: string, parent: string | null, order: number, extra: Record<string, unknown> = {}) =>
    put(key, 'code', {
      name,
      parent_id: parent ? ids[parent]! : null,
      color: '#29a37a',
      description: '',
      inclusion: '',
      exclusion: '',
      example: '',
      order,
      codable: true,
      shortcut: null,
      ...extra,
    });
  code('emocoes', 'Emoções', null, 1, { codable: false, color: '#6c4ab6' });
  code('alegria', 'Alegria 😀', 'emocoes', 1, {
    description: 'Expressões de felicidade.',
    inclusion: 'Quando a pessoa diz que está feliz.',
    exclusion: 'Ironia.',
    example: '"Gosto muito"',
    color: '#f3a712',
  });
  code('stress', 'Stress', 'emocoes', 2);
  code('horario', 'Horário', 'stress', 1);
  code('trabalho', 'Trabalho', null, 2);
  code('familia', 'Família', null, 3);
  const gone = code('apagado', 'Código apagado', null, 4);

  put('idade', 'attribute', { name: 'Idade', type: 'number', options: [], description: 'Em anos', order: 1 });
  put('peso', 'attribute', { name: 'Peso', type: 'number', options: [], description: '', order: 2 });
  put('genero', 'attribute', { name: 'Género', type: 'choice', options: ['feminino', 'masculino'], description: '', order: 3 });
  put('data', 'attribute', { name: 'Entrevistada em', type: 'date', options: [], description: '', order: 4 });
  put('consent', 'attribute', { name: 'Consentiu', type: 'boolean', options: [], description: '', order: 5 });
  put('notas', 'attribute', { name: 'Notas', type: 'text', options: [], description: '', order: 6 });

  put('p1', 'case', {
    name: 'Participante 1',
    description: 'Professora',
    values: { [ids.idade!]: 34, [ids.peso!]: 61.5, [ids.genero!]: 'feminino', [ids.data!]: '2026-03-14', [ids.consent!]: true, [ids.notas!]: 'Fala "rápido" & bem <sempre>' },
    color: null,
  });
  put('p2', 'case', { name: 'Participante 2', description: '', values: { [ids.idade!]: 41, [ids.consent!]: false }, color: null });

  put('entrevistas', 'docgroup', { name: 'Entrevistas', color: '#2b9eb3', order: 1 });
  put('relatorios', 'docgroup', { name: 'Relatórios', color: '#a8c256', order: 2 });

  const doc = (key: string, name: string, kind: Entity<'document'>['kind'], text: string, order: number, extra: Record<string, unknown> = {}) => {
    put(key, 'document', {
      name,
      kind,
      group_ids: [],
      case_id: null,
      source: { filename: name, format: 'txt', imported_at: NOW().toISOString(), text_sha256: sha(text) },
      original: null,
      media: null,
      chars: text.length,
      order,
      color: null,
      ...extra,
    });
    put(`${key}-text`, 'doctext', { id: ids[key]!, text, sync: (extra.sync as never) ?? [] });
  };
  doc('d1', 'Entrevista 1', 'text', TEXT1, 1);
  // patch group and case after creation is not possible through the factory: build with them
  const records = f.records;
  const d1 = records.find((r) => r.record.id === ids.d1 && r.kind === 'document')!.record as Entity<'document'>;
  d1.group_ids = [ids.entrevistas!];
  d1.case_id = ids.p1!;
  doc('d2', 'Relatório.pdf', 'pdf', TEXT_PDF, 2, {
    original: media('pdf1', PDF_BYTES, 'Relatório.pdf', 'application/pdf'),
    group_ids: [ids.relatorios!],
  });
  doc('d3', 'Entrevista 2 (áudio)', 'transcript', TEXT_TRANSCRIPT, 3, {
    media: media('audio1', AUDIO_BYTES, 'entrevista2.m4a', 'audio/mp4'),
    group_ids: [ids.entrevistas!],
    case_id: ids.p2!,
  });
  const d3text = records.find((r) => r.record.id === ids.d3 && r.kind === 'doctext')!.record as Entity<'doctext'>;
  d3text.sync = [
    { pos: 0, ms: 0 },
    { pos: TEXT_TRANSCRIPT.indexOf('Bruno'), ms: 2500 },
    { pos: TEXT_TRANSCRIPT.lastIndexOf('Ana'), ms: 7250 },
  ];
  doc('d4', 'Relatório editado.pdf', 'pdf', TEXT_EDITED, 4, {
    original: media('pdf2', PDF_BYTES, 'editado.pdf', 'application/pdf'),
    source: { filename: 'editado.pdf', format: 'pdf', imported_at: NOW().toISOString(), text_sha256: sha('Relatório da Escola Fictícia com nomes.') },
  });
  doc('d5', 'Nota de campo', 'note', '', 5);

  const coding = (key: string, d: string, text: string, c: string, coder: string, needle: string, comment = '', nth = 0) => {
    let start = -1;
    for (let i = 0; i <= nth; i++) start = text.indexOf(needle, start + 1);
    if (start < 0) throw new Error(`needle ${needle}`);
    put(key, 'coding', {
      document_id: ids[d]!,
      code_id: ids[c]!,
      coder_id: ids[coder]!,
      start,
      end: start + needle.length,
      text: needle,
      comment,
    });
  };
  coding('c1', 'd1', TEXT1, 'alegria', 'ana', 'Gosto muito do meu trabalho, a equipa é fantástica 👩‍💻');
  coding('c2', 'd1', TEXT1, 'trabalho', 'ana', 'Gosto muito do meu trabalho, a equipa é fantástica 👩‍💻');
  coding('c3', 'd1', TEXT1, 'trabalho', 'bruno', 'Gosto muito do meu trabalho, a equipa é fantástica 👩‍💻', 'Concordo, mas é geral.');
  coding('c4', 'd1', TEXT1, 'horario', 'ana', 'o horário é difícil', 'Tensão trabalho-família');
  coding('c5', 'd1', TEXT1, 'familia', 'bruno', 'A família é tudo — mas o horário é difícil. 𝄞 Música ajuda.');
  coding('c6', 'd2', TEXT_PDF, 'alegria', 'ana', 'satisfação elevada');
  coding('c7', 'd3', TEXT_TRANSCRIPT, 'trabalho', 'bruno', 'vamos começar 🎙️');
  coding('c8', 'd4', TEXT_EDITED, 'trabalho', 'ana', '[ESCOLA]');
  coding('c9', 'd1', TEXT1, 'familia', 'ana', 'família', '', 0);
  const deletedCoding = f.make('coding', { document_id: ids.d1!, code_id: gone.id, coder_id: ids.ana!, start: 0, end: 5, text: 'Entre', comment: '' });
  deletedCoding.deleted = true;
  gone.deleted = true;

  const memo = (key: string, title: string, body: string, target: Entity<'memo'>['target'], coder: string | null = 'ana') =>
    put(key, 'memo', { title, body, target, coder_id: coder ? ids[coder]! : null, color: null });
  memo('m-project', 'Diário do projeto', 'Primeira semana de análise.\n\n- ponto 1\n- ponto 2', { kind: 'project', id: null });
  memo('m-doc', 'Sobre a entrevista 1', 'A participante estava à vontade. 😀', { kind: 'document', id: ids.d1! });
  memo('m-code', 'Definição de Alegria', 'Inclui satisfação.', { kind: 'code', id: ids.alegria! }, 'bruno');
  memo('m-coding', 'Citação-chave', 'Usar no capítulo 3.', { kind: 'coding', id: ids.c4! });
  memo('m-case', 'Perfil P1', 'Professora há 10 anos.', { kind: 'case', id: ids.p1! }, null);
  memo('m-pdf', 'Sobre o relatório', 'Fonte secundária.', { kind: 'document', id: ids.d2! });

  const pseudo = f.make('pseudonym', { original: 'Maria Silva', replacement: 'P1', note: '', whole_word: true, case_sensitive: false, applied_at: null, applied_count: 0 });
  void pseudo;
  return { bundle: { project: { id: null, name: 'Projeto Bem-estar', description: 'Estudo fictício.', origin: null }, records: f.records, blobs, warnings: [] }, ids };
}

function byKind<K extends Kind>(b: ProjectBundle, kind: K): Entity<K>[] {
  return b.records.filter((r) => r.kind === kind && !r.record.deleted).map((r) => r.record as Entity<K>);
}

describe('qdpx export', () => {
  const { bundle } = buildBundle();
  const out = exportQdpx(bundle, { origin: 'Trama 0.1.0', now: NOW });
  const files = unzipSync(out.bytes);
  const qde = strFromU8(files['project.qde']!);

  it('writes project.qde and lower-case sources/ only', () => {
    for (const name of Object.keys(files)) expect(name === 'project.qde' || /^sources\/[0-9a-f-]{36}\.(txt|pdf|m4a)$/.test(name)).toBe(true);
    expect(qde.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(files['project.qde']![0]).toBe(0x3c); // no BOM
  });

  it('writes text files as UTF-8 without BOM, LF only', () => {
    const txts = Object.entries(files).filter(([n]) => n.endsWith('.txt'));
    expect(txts.length).toBeGreaterThanOrEqual(4);
    for (const [, b] of txts) {
      expect(b[0]).not.toBe(0xef);
      expect(strFromU8(b)).not.toContain('\r');
    }
    expect(txts.map(([, b]) => strFromU8(b))).toContain(TEXT1);
  });

  it('leaves out tombstones, the pseudonymisation key and edited originals', () => {
    expect(qde).not.toContain('Código apagado');
    expect(qde).not.toContain('Maria Silva');
    expect(Object.keys(files).filter((n) => n.endsWith('.pdf'))).toHaveLength(1);
    expect(out.warnings.join('\n')).toMatch(/original PDF.*edited/);
    expect(out.warnings.join('\n')).toMatch(/choice attribute/);
  });

  it('uses code-point positions', () => {
    const start = Array.from(TEXT1.slice(0, TEXT1.indexOf('o horário'))).length;
    expect(qde).toContain(`startPosition="${start}" endPosition="${start + 'o horário é difícil'.length}"`);
  });

  it('groups codes on one span by one coder into one selection', () => {
    const sel = qde.match(/<PlainTextSelection [^>]*name="Gosto muito[^"]*"/g) ?? [];
    expect(sel).toHaveLength(2); // Ana (2 codes) and Bruno (1 code, own comment)
  });

  it.skipIf(!xsdPython)('validates against Project.xsd', () => {
    expect(validateXsd(PROJECT_XSD, qde)).toBe('ok');
  });

  it.skipIf(!xsdPython)('validates with CRLF option and without memos', () => {
    const crlf = exportQdpx(bundle, { origin: 'Trama 0.1.0', crlfForMaxqda: true, includeMemos: false, includeMedia: false, now: NOW });
    const f2 = unzipSync(crlf.bytes);
    expect(validateXsd(PROJECT_XSD, strFromU8(f2['project.qde']!))).toBe('ok');
    expect(strFromU8(f2['project.qde']!)).not.toContain('<Note ');
    expect(Object.values(f2).some((b) => strFromU8(b).includes('\r\n'))).toBe(true);
  });

  it.skipIf(!xsdPython)('validates an empty project', () => {
    const empty = exportQdpx({ project: { id: null, name: 'Vazio', description: '', origin: null }, records: [], blobs: new Map(), warnings: [] }, { origin: 'Trama 0.1.0' });
    expect(validateXsd(PROJECT_XSD, strFromU8(unzipSync(empty.bytes)['project.qde']!))).toBe('ok');
  });
});

describe('qdpx round trip', async () => {
  const { bundle } = buildBundle();
  const out = exportQdpx(bundle, { origin: 'Trama 0.1.0', now: NOW });
  const back = await importQdpx(out.bytes, { defaultCoderName: 'Eu', now: NOW });

  const names = (b: ProjectBundle) => {
    const docs = new Map(byKind(b, 'document').map((d) => [d.id, d.name]));
    const codes = new Map(byKind(b, 'code').map((c) => [c.id, c]));
    const coders = new Map(byKind(b, 'coder').map((c) => [c.id, c.name]));
    const cases = new Map(byKind(b, 'case').map((c) => [c.id, c.name]));
    const codings = new Map(byKind(b, 'coding').map((c) => [c.id, c]));
    const path = (id: string | null): string => {
      const c = id ? codes.get(id) : undefined;
      return c ? (c.parent_id ? `${path(c.parent_id)}/${c.name}` : c.name) : '';
    };
    return { docs, codes, coders, cases, codings, path };
  };
  const a = names(bundle);
  const b = names(back);

  it('produces valid records with base fields and increasing HLCs', () => {
    const hlcs = back.records.map((r) => r.record.updated_at_hlc);
    expect(new Set(hlcs).size).toBe(hlcs.length);
    expect([...hlcs].sort()).toEqual(hlcs);
    for (const r of back.records) {
      expect(() => validate(r.kind, r.record as never)).not.toThrow();
      expect(r.record.deleted).toBe(false);
      expect(r.record.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
    expect(back.project).toEqual({ id: null, name: 'Projeto Bem-estar', description: 'Estudo fictício.', origin: 'Trama 0.1.0' });
  });

  it('keeps texts', () => {
    const texts = (x: ProjectBundle) => {
      const docs = new Map(byKind(x, 'document').map((d) => [d.id, d]));
      return Object.fromEntries(byKind(x, 'doctext').map((t) => [docs.get(t.id)!.name, t.text]));
    };
    expect(texts(back)).toEqual(texts(bundle));
  });

  it('keeps the code tree, colours, codability and definitions', () => {
    const tree = (x: ReturnType<typeof names>) =>
      [...x.codes.values()].filter((c) => !c.deleted).map((c) => ({ path: x.path(c.id), codable: c.codable, color: c.color, description: c.description, inclusion: c.inclusion, exclusion: c.exclusion, example: c.example, order: c.order })).sort((p, q) => p.path.localeCompare(q.path));
    expect(tree(b)).toEqual(tree(a));
  });

  it('keeps codings: spans, codes, coders, comments', () => {
    const list = (x: ReturnType<typeof names>, bb: ProjectBundle) =>
      byKind(bb, 'coding')
        .map((c) => [x.docs.get(c.document_id), x.path(c.code_id), x.coders.get(c.coder_id), c.start, c.end, c.text, c.comment].join('|'))
        .sort();
    const expected = list(a, bundle).filter((l) => !l.includes('Relatório editado') || true);
    expect(list(b, back)).toEqual(expected);
  });

  it('keeps cases, attribute values and case assignments', () => {
    const attrs = (x: ProjectBundle) => new Map(byKind(x, 'attribute').map((t) => [t.id, t]));
    const cases = (x: ProjectBundle) =>
      byKind(x, 'case')
        .map((c) => ({ name: c.name, description: c.description, values: Object.fromEntries(Object.entries(c.values).map(([k, v]) => [attrs(x).get(k)!.name, v])) }))
        .sort((p, q) => p.name.localeCompare(q.name));
    expect(cases(back)).toEqual(cases(bundle));
    const types = Object.fromEntries(byKind(back, 'attribute').map((t) => [t.name, t.type]));
    expect(types).toEqual({ Idade: 'number', Peso: 'number', Género: 'text', 'Entrevistada em': 'date', Consentiu: 'boolean', Notas: 'text' });
    const assigned = (x: ReturnType<typeof names>, bb: ProjectBundle) => Object.fromEntries(byKind(bb, 'document').map((d) => [d.name, d.case_id ? x.cases.get(d.case_id) : null]));
    expect(assigned(b, back)).toEqual(assigned(a, bundle));
  });

  it('keeps memos and their targets', () => {
    const memos = (x: ReturnType<typeof names>, bb: ProjectBundle) =>
      byKind(bb, 'memo')
        .map((m) => {
          const t = m.target;
          const target =
            t.kind === 'project' ? 'project' :
            t.kind === 'document' ? `document:${x.docs.get(t.id)}` :
            t.kind === 'code' ? `code:${x.path(t.id)}` :
            t.kind === 'case' ? `case:${x.cases.get(t.id)}` :
            `coding:${x.codings.get(t.id)?.text}`;
          return `${target}|${m.title}|${m.body}|${m.coder_id ? x.coders.get(m.coder_id) : ''}`;
        })
        .sort();
    expect(memos(b, back)).toEqual(memos(a, bundle));
  });

  it('keeps document groups, kinds, sync points and files', () => {
    const groups = (bb: ProjectBundle) => {
      const g = new Map(byKind(bb, 'docgroup').map((x) => [x.id, x.name]));
      return Object.fromEntries(byKind(bb, 'document').map((d) => [d.name, d.group_ids.map((id) => g.get(id)).sort()]));
    };
    expect(groups(back)).toEqual(groups(bundle));
    const kinds = Object.fromEntries(byKind(back, 'document').map((d) => [d.name, d.kind]));
    // The edited PDF lost its original, so it comes back as text; notes become text.
    expect(kinds).toEqual({ 'Entrevista 1': 'text', 'Relatório.pdf': 'pdf', 'Entrevista 2 (áudio)': 'transcript', 'Relatório editado.pdf': 'text', 'Nota de campo': 'text' });
    const d3 = byKind(back, 'document').find((d) => d.kind === 'transcript')!;
    expect(byKind(back, 'doctext').find((t) => t.id === d3.id)!.sync).toEqual([
      { pos: 0, ms: 0 },
      { pos: TEXT_TRANSCRIPT.indexOf('Bruno'), ms: 2500 },
      { pos: TEXT_TRANSCRIPT.lastIndexOf('Ana'), ms: 7250 },
    ]);
    expect(back.blobs.get(d3.media!.blob_id)).toEqual(AUDIO_BYTES);
    expect(d3.media!.mime).toBe('audio/mp4');
    const pdf = byKind(back, 'document').find((d) => d.kind === 'pdf')!;
    expect(back.blobs.get(pdf.original!.blob_id)).toEqual(PDF_BYTES);
    expect(pdf.original!.mime).toBe('application/pdf');
  });

  it('round-trips the CRLF (MAXQDA) variant to the same texts and spans', async () => {
    const crlf = exportQdpx(bundle, { origin: 'Trama 0.1.0', crlfForMaxqda: true, now: NOW });
    const again = await importQdpx(crlf.bytes, { defaultCoderName: 'Eu', now: NOW });
    const spans = (bb: ProjectBundle) => byKind(bb, 'coding').map((c) => `${c.text}|${c.start}|${c.end}`).sort();
    expect(spans(again)).toEqual(spans(back));
    expect(byKind(again, 'doctext').every((t) => !t.text.includes('\r'))).toBe(true);
  });

  it('import is deterministic up to ids', async () => {
    const twice = await importQdpx(out.bytes, { defaultCoderName: 'Eu', now: NOW });
    expect(twice.records.length).toBe(back.records.length);
    expect(twice.warnings).toEqual(back.warnings);
  });
});

describe('export warnings and Word originals', () => {
  const DOCX = utf8('PK\u0003\u0004 fictional docx');
  const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const withDocx = (edited: boolean) => {
    const { bundle, ids } = buildBundle();
    const d1 = bundle.records.find((r) => r.kind === 'document' && r.record.id === ids.d1)!.record as Entity<'document'>;
    d1.original = { blob_id: 'docx1', filename: 'Entrevista 1.docx', mime: DOCX_MIME, size: DOCX.length };
    if (edited) d1.source = { ...d1.source!, text_sha256: toHex(sha256(utf8('the text before pseudonymisation'))) };
    bundle.blobs.set('docx1', DOCX);
    return bundle;
  };

  it('reports what was left out as coded issues the screen can translate', () => {
    const out = exportQdpx(buildBundle().bundle, { origin: 'Trama 0.1.0', now: NOW });
    expect(out.issues.map((i) => i.code).sort()).toEqual(['choiceAsText', 'editedPdf']);
    expect(out.issues.every((i) => i.count > 0 && out.warnings.includes(i.message))).toBe(true);
  });

  it('writes a Word original as richTextPath and brings it back on import', async () => {
    const out = exportQdpx(withDocx(false), { origin: 'Trama 0.1.0', now: NOW });
    const files = unzipSync(out.bytes);
    const docx = Object.keys(files).filter((n) => n.endsWith('.docx'));
    expect(docx).toHaveLength(1);
    expect(strFromU8(files['project.qde']!)).toContain(`richTextPath="internal://${docx[0]!.slice('sources/'.length)}"`);
    const back = await importQdpx(out.bytes, { defaultCoderName: 'Eu', now: NOW });
    const d1 = byKind(back, 'document').find((d) => d.name === 'Entrevista 1')!;
    expect(d1.original?.mime).toBe(DOCX_MIME);
    expect(back.blobs.get(d1.original!.blob_id)).toEqual(DOCX);
  });

  it('never ships the Word original of an edited (for example pseudonymised) document', () => {
    const out = exportQdpx(withDocx(true), { origin: 'Trama 0.1.0', now: NOW });
    expect(Object.keys(unzipSync(out.bytes)).some((n) => n.endsWith('.docx'))).toBe(false);
    expect(strFromU8(unzipSync(out.bytes)['project.qde']!)).not.toContain('richTextPath');
    expect(out.issues.find((i) => i.code === 'editedDocx')?.count).toBe(1);
  });
});

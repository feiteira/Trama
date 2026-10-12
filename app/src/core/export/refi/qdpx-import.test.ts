import { readFileSync } from 'node:fs';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { utf8 } from '../../bytes';
import type { Entity, Kind } from '../../model/types';
import { validate } from '../../model/validate';
import type { ProjectBundle } from '../bundle';
import { forgeName, forgeSize } from '../forgeZip.testutil';
import { buildDocx } from '../office/docx';
import { RefiError } from './common';
import { importQdpx, QDPX_WARNING_CODES, type QdpxBundle, type QdpxImportOptions } from './qdpx-import';

const NOW = () => new Date('2026-10-05T12:00:00Z');
const OPTS: QdpxImportOptions = { defaultCoderName: 'Eu', now: NOW };

function zip(files: Record<string, string | Uint8Array>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? utf8(v) : v])));
}

function project(body: string, attrs = ''): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<Project xmlns="urn:QDA-XML:project:1.0" name="Teste" ${attrs}>${body}</Project>`;
}

function all<K extends Kind>(b: ProjectBundle, kind: K): Entity<K>[] {
  return b.records.filter((r) => r.kind === kind).map((r) => r.record as Entity<K>);
}

/** Codings as "document|code|coder|text" for readable assertions. */
function codingsOf(b: ProjectBundle): string[] {
  const docs = new Map(all(b, 'document').map((d) => [d.id, d.name]));
  const codes = new Map(all(b, 'code').map((c) => [c.id, c.name]));
  const coders = new Map(all(b, 'coder').map((c) => [c.id, c.name]));
  return all(b, 'coding')
    .map((c) => `${docs.get(c.document_id)}|${codes.get(c.code_id)}|${coders.get(c.coder_id)}|${c.text}`)
    .sort();
}

function expectValid(b: ProjectBundle): void {
  for (const r of b.records) expect(() => validate(r.kind, r.record as never)).not.toThrow();
  const ids = new Set(b.records.map((r) => `${r.kind}:${r.record.id}`));
  expect(ids.size).toBe(b.records.length);
  // every reference points to a record in the bundle
  const has = (kind: Kind, id: string) => ids.has(`${kind}:${id}`);
  for (const c of all(b, 'coding')) {
    expect(has('document', c.document_id) && has('code', c.code_id) && has('coder', c.coder_id)).toBe(true);
  }
  for (const d of all(b, 'document')) {
    expect(has('doctext', d.id)).toBe(true);
    if (d.case_id) expect(has('case', d.case_id)).toBe(true);
    for (const g of d.group_ids) expect(has('docgroup', g)).toBe(true);
    for (const m of [d.original, d.media]) if (m) expect(b.blobs.get(m.blob_id)?.length).toBe(m.size);
  }
  for (const c of all(b, 'code')) if (c.parent_id) expect(has('code', c.parent_id)).toBe(true);
  for (const m of all(b, 'memo')) if (m.target.kind !== 'project') expect(has(m.target.kind, m.target.id)).toBe(true);
}

describe('the reference example project', async () => {
  const xml = readFileSync(new URL('./fixtures/example-project.qde', import.meta.url), 'utf8');
  const files = {
    'project.qde': xml,
    'sources/b0000000-0000-4000-8000-000000000001.txt': 'Ana says: I love my job and my team, honestly.',
    'sources/b0000000-0000-4000-8000-000000000003.pdf': '%PDF-1.4 fictional',
    'sources/b0000000-0000-4000-8000-000000000004.txt': 'Annual report on wellbeing at work.',
    'sources/b0000000-0000-4000-8000-000000000005.jpg': new Uint8Array([0xff, 0xd8, 0xff]),
    'sources/b0000000-0000-4000-8000-000000000006.m4a': new Uint8Array([1, 2, 3, 4]),
    'sources/b0000000-0000-4000-8000-000000000007.txt': 'Interviewer: Hello and welcome to the study. Participant: Thanks.',
    'sources/d0000000-0000-4000-8000-000000000002.txt': '\uFEFFJoy covers happiness and delight.\r\n',
  };
  const b = await importQdpx(zip(files), OPTS);
  const docs = Object.fromEntries(all(b, 'document').map((d) => [d.name, d]));
  const texts = new Map(all(b, 'doctext').map((t) => [t.id, t]));

  it('produces a consistent, valid bundle', () => {
    expectValid(b);
    expect(b.project).toEqual({ id: null, name: 'Demo project', description: 'Project-level description', origin: 'Example 0.1' });
  });

  it('reads users, the code tree and variables', () => {
    expect(all(b, 'coder').map((c) => c.name)).toEqual(['Ana']);
    const codes = all(b, 'code');
    const emotions = codes.find((c) => c.name === 'Emotions')!;
    expect(emotions).toMatchObject({ codable: false, parent_id: null });
    expect(codes.find((c) => c.name === 'Joy')).toMatchObject({ parent_id: emotions.id, color: '#f5a623', description: 'Expressions of happiness', codable: true });
    expect(codes.find((c) => c.name === 'Work')).toMatchObject({ parent_id: null, color: '#4a90e2' });
    expect(all(b, 'attribute').map((a) => [a.name, a.type, a.description])).toEqual([
      ['Age', 'number', 'Age in years'],
      ['Gender', 'text', ''],
    ]);
  });

  it('reads cases and assigns documents', () => {
    const [p1] = all(b, 'case');
    const attrs = Object.fromEntries(all(b, 'attribute').map((a) => [a.name, a.id]));
    expect(p1).toMatchObject({ name: 'Participant 1', description: 'First interviewee', values: { [attrs.Age!]: 34, [attrs.Gender!]: 'female' } });
    expect(docs['Interview 1.txt']!.case_id).toBe(p1!.id);
    expect(all(b, 'case')).toHaveLength(1); // the source's own Gender value agrees with its case
  });

  it('reads text, PDF and transcript sources', () => {
    expect(Object.keys(docs).sort()).toEqual(['Inline note-like text', 'Interview 1.m4a', 'Interview 1.txt', 'Report.pdf']);
    expect(texts.get(docs['Inline note-like text']!.id)!.text).toBe('Short text stored inline.');
    const pdf = docs['Report.pdf']!;
    expect(pdf.kind).toBe('pdf');
    expect(texts.get(pdf.id)!.text).toBe('Annual report on wellbeing at work.');
    expect(new TextDecoder().decode(b.blobs.get(pdf.original!.blob_id))).toBe('%PDF-1.4 fictional');
    const tr = docs['Interview 1.m4a']!;
    expect(tr.kind).toBe('transcript');
    expect(tr.media).toMatchObject({ mime: 'audio/mp4', size: 4 });
    expect(texts.get(tr.id)!.sync).toEqual([
      { pos: 0, ms: 0 },
      { pos: 42, ms: 5300 },
    ]);
  });

  it('reads codings from selections, whole sources, representations and transcripts', () => {
    expect(codingsOf(b)).toEqual([
      'Interview 1.m4a|Work|Ana|Interviewer: Hello and welcome to the stud', // positions 0–42
      'Interview 1.txt|Joy|Ana|I love my job',
      'Interview 1.txt|Work|Ana|Ana says: I love my job and my team, honestly.',
      'Interview 1.txt|Work|Ana|I love my job',
      'Report.pdf|Joy|Ana|Annual repor',
    ]);
    const love = all(b, 'coding').filter((c) => c.text === 'I love my job');
    expect(love.map((c) => c.comment)).toEqual(['Strong positive statement', 'Strong positive statement']);
    expect(love[0]!.created_at).toBe('2026-10-05T12:10:00.000Z');
  });

  it('attaches notes where they are referenced', () => {
    const memos = all(b, 'memo');
    const joyCoding = all(b, 'coding').find((c) => c.text === 'I love my job')!;
    const targets = memos.map((m) => `${m.title}→${m.target.kind}`).sort();
    expect(targets).toEqual([
      'Code memo: Joy→code',
      'Comment→coding',
      'Description→document',
      'Interviews→project', // the document group's Description
      'Memo on interview 1→coding', // the Link from the note to the selection
      'Memo on interview 1→document',
      'Memo on interview 1→project',
    ]);
    expect(memos.find((m) => m.title === 'Comment')!.target).toEqual({ kind: 'coding', id: joyCoding.id });
    expect(memos.find((m) => m.title === 'Code memo: Joy')!.body).toBe('Joy covers happiness and delight.');
    expect(memos.find((m) => m.title === 'Memo on interview 1')!.coder_id).toBe(all(b, 'coder')[0]!.id);
  });

  it('makes document groups of sets with sources', () => {
    const [g] = all(b, 'docgroup');
    expect(g!.name).toBe('Interviews');
    expect(docs['Interview 1.txt']!.group_ids).toEqual([g!.id]);
    expect(docs['Interview 1.m4a']!.group_ids).toEqual([g!.id]);
  });

  it('warns about everything left behind', () => {
    const w = b.warnings.join('\n');
    expect(w).toMatch(/1 area selection\(s\) on PDF pages/);
    expect(w).toMatch(/1 picture source/);
    expect(w).toMatch(/1 coded area\(s\) on pictures/);
    expect(w).toMatch(/2 coded audio\/video time range/);
    expect(w).toMatch(/1 audio\/video file\(s\) stored outside/);
    expect(w).toMatch(/video "Clip.mp4" was skipped/);
    expect(w).toMatch(/1 graph/);
    expect(w).toMatch(/1 code reference\(s\) on cases/);
    expect(w).toMatch(/1 memo\(s\) listed in sets/);
  });

  it('gives the same warnings as data: a code, a count and the item named', () => {
    const issues = (b as QdpxBundle).issues;
    expect(issues.map((i) => i.message)).toEqual(b.warnings);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'mediaSelection', count: 2 }));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'videoSkipped', count: 1, detail: 'Clip.mp4' }));
    expect(issues.every((i) => (QDPX_WARNING_CODES as readonly string[]).includes(i.code) && i.count > 0)).toBe(true);
  });
});

describe('line endings and position units', () => {
  const crlfText = 'Line one about school.\r\nOh, that was great. See you tomorrow? Eleven thirty. Mm.\r\nLast line here.';
  const quote = 'Oh, that was great. See you tomorrow? Eleven thirty. Mm.';
  const source = (start: number, end: number, name: string, guid = 'B0000000-0000-4000-8000-000000000001') => `
    <CodeBook><Codes><Code guid="A0000000-0000-4000-8000-000000000001" name="Quote" isCodable="true"/></Codes></CodeBook>
    <Sources><TextSource guid="${guid}" name="Doc" plainTextPath="internal://${guid}.txt">
      <PlainTextSelection guid="F0000000-0000-4000-8000-000000000001" name="${name}" startPosition="${start}" endPosition="${end}">
        <Coding guid="10000000-0000-4000-8000-000000000001"><CodeRef targetGUID="{a0000000-0000-4000-8000-000000000001}"/></Coding>
      </PlainTextSelection>
    </TextSource></Sources>`;

  it('ATLAS.ti: CRLF counts as one, upper-case GUIDs, capital Sources/ and file name case', async () => {
    const b = await importQdpx(
      zip({ 'project.qde': project(source(23, 79, ''), 'origin="ATLAS.ti 9.1.0"'), 'Sources/B0000000-0000-4000-8000-000000000001.TXT': crlfText }),
      OPTS,
    );
    expect(all(b, 'coding').map((c) => c.text)).toEqual([quote]);
    expect(all(b, 'doctext')[0]!.text).toBe(crlfText.replace(/\r\n/g, '\n'));
  });

  it('NVivo: CRLF counts as two by default', async () => {
    const b = await importQdpx(zip({ 'project.qde': project(source(24, 80, ''), 'origin="NVivo 14"'), 'Sources/b0000000-0000-4000-8000-000000000001.txt': crlfText }), OPTS);
    expect(all(b, 'coding').map((c) => c.text)).toEqual([quote]);
  });

  it('selection names override the origin when they disagree', async () => {
    const b = await importQdpx(zip({ 'project.qde': project(source(23, 79, quote), 'origin="SomeTool 1"'), 'sources/b0000000-0000-4000-8000-000000000001.txt': crlfText }), OPTS);
    expect(all(b, 'coding').map((c) => c.text)).toEqual([quote]);
    const b2 = await importQdpx(zip({ 'project.qde': project(source(24, 80, `${quote.slice(0, 20)}…`), 'origin="ATLAS.ti 22"'), 'sources/b0000000-0000-4000-8000-000000000001.txt': crlfText }), OPTS);
    expect(all(b2, 'coding').map((c) => c.text)).toEqual([quote]);
  });

  it('code points vs UTF-16 units, detected from names', async () => {
    const text = 'Emoji 😀😀 first. 👨‍👩‍👧 Família feliz e unida.';
    const target = 'Família feliz';
    const u16 = text.indexOf(target);
    const cp = Array.from(text.slice(0, u16)).length;
    const len = target.length;
    const asCp = await importQdpx(zip({ 'project.qde': project(source(cp, cp + len, target)), 'sources/b0000000-0000-4000-8000-000000000001.txt': text }), OPTS);
    expect(all(asCp, 'coding').map((c) => [c.text, c.start])).toEqual([[target, u16]]);
    const asU16 = await importQdpx(zip({ 'project.qde': project(source(u16, u16 + len, target)), 'sources/b0000000-0000-4000-8000-000000000001.txt': text }), OPTS);
    expect(all(asU16, 'coding').map((c) => c.text)).toEqual([target]);
    // without a name the spec's code points are assumed
    const noName = await importQdpx(zip({ 'project.qde': project(source(cp, cp + len, '')), 'sources/b0000000-0000-4000-8000-000000000001.txt': text }), OPTS);
    expect(all(noName, 'coding').map((c) => c.text)).toEqual([target]);
  });

  it('QualCoder: a BOM in the text file is not counted; decomposed text becomes NFC', async () => {
    const text = '\uFEFFA Joa\u0303o disse: gosto disto.';
    const b = await importQdpx(zip({ 'project.qde': project(source(15, 26, ''), 'origin="QualCoder 3.5"'), 'sources/b0000000-0000-4000-8000-000000000001.txt': text }), OPTS);
    expect(all(b, 'doctext')[0]!.text).toBe('A João disse: gosto disto.');
    expect(all(b, 'coding').map((c) => c.text)).toEqual(['gosto disto']);
  });

  it('spans a large CRLF document with emoji quickly', async () => {
    const lines = Array.from({ length: 20_000 }, (_, i) => `Linha ${i}: texto de exemplo ${i % 7 === 0 ? '😀 ' : ''}com algumas palavras.`);
    const text = lines.join('\r\n');
    const sels: string[] = [];
    let cp = 0;
    for (const [i, line] of lines.entries()) {
      if (i % 10 === 0) {
        const n = Array.from(line).length;
        sels.push(`<PlainTextSelection guid="f0000000-0000-4000-8000-${String(i).padStart(12, '0')}" name="${line.slice(0, 30)}" startPosition="${cp}" endPosition="${cp + n}"><Coding guid="10000000-0000-4000-8000-${String(i).padStart(12, '0')}"><CodeRef targetGUID="a0000000-0000-4000-8000-000000000001"/></Coding></PlainTextSelection>`);
      }
      cp += Array.from(line).length + 2;
    }
    const xml = project(`<CodeBook><Codes><Code guid="a0000000-0000-4000-8000-000000000001" name="L" isCodable="true"/></Codes></CodeBook>
      <Sources><TextSource guid="b0000000-0000-4000-8000-000000000001" name="Big" plainTextPath="internal://big.txt">${sels.join('')}</TextSource></Sources>`);
    const t0 = Date.now();
    const b = await importQdpx(zip({ 'project.qde': xml, 'sources/big.txt': text }), OPTS);
    expect(Date.now() - t0).toBeLessThan(5000);
    const codings = all(b, 'coding');
    expect(codings).toHaveLength(2000);
    expect(codings.every((c) => c.text.startsWith('Linha ') && c.text.endsWith('palavras.'))).toBe(true);
  });
});

describe('vendor quirks', () => {
  it('NVivo: cases as codes, annotations as Note + Link, nameless transcript', async () => {
    const xml = project(
      `<Users><User guid="00000000-0000-4000-8000-0000000000AA" name="Rita"/></Users>
      <CodeBook><Codes>
        <Code guid="A0000000-0000-4000-8000-000000000001" name="Theme" isCodable="true"/>
        <Code guid="C0000000-0000-4000-8000-000000000001" name="Participant A" isCodable="true"><NoteRef targetGUID="D0000000-0000-4000-8000-000000000002"/></Code>
      </Codes></CodeBook>
      <Cases><Case guid="C0000000-0000-4000-8000-000000000001" name="Participant A"/></Cases>
      <Sources>
        <TextSource guid="B0000000-0000-4000-8000-000000000001" name="Interview A" plainTextPath="internal://B0000000-0000-4000-8000-000000000001.txt">
          <PlainTextSelection guid="F0000000-0000-4000-8000-000000000001" startPosition="0" endPosition="5" creatingUser="00000000-0000-4000-8000-0000000000AA">
            <Coding guid="10000000-0000-4000-8000-000000000001"><CodeRef targetGUID="C0000000-0000-4000-8000-000000000001"/></Coding>
            <Coding guid="10000000-0000-4000-8000-000000000002"><CodeRef targetGUID="A0000000-0000-4000-8000-000000000001"/></Coding>
          </PlainTextSelection>
          <PlainTextSelection guid="F0000000-0000-4000-8000-000000000002" startPosition="7" endPosition="12"/>
        </TextSource>
        <AudioSource guid="B0000000-0000-4000-8000-000000000002" name="Audio A" path="internal://B0000000-0000-4000-8000-000000000002.mp3">
          <Transcript guid="B0000000-0000-4000-8000-000000000003" plainTextPath="internal://B0000000-0000-4000-8000-000000000003.txt"/>
        </AudioSource>
      </Sources>
      <Notes>
        <Note guid="D0000000-0000-4000-8000-000000000001" name="Annotation" plainTextPath="internal://D0000000-0000-4000-8000-000000000001.txt"/>
        <Note guid="D0000000-0000-4000-8000-000000000002" name="About A"><PlainTextContent>Case memo</PlainTextContent></Note>
      </Notes>
      <Links>
        <Link guid="30000000-0000-4000-8000-000000000001" originGUID="D0000000-0000-4000-8000-000000000001" targetGUID="F0000000-0000-4000-8000-000000000002"/>
        <Link guid="30000000-0000-4000-8000-000000000002" originGUID="A0000000-0000-4000-8000-000000000001" targetGUID="B0000000-0000-4000-8000-000000000001"/>
      </Links>`,
      'origin="NVivo 14"',
    );
    const b = await importQdpx(
      zip({
        'project.qde': xml,
        'Sources/B0000000-0000-4000-8000-000000000001.txt': 'Hello, world.\r\nSecond line.',
        'Sources/B0000000-0000-4000-8000-000000000002.mp3': new Uint8Array([9, 9]),
        'Sources/B0000000-0000-4000-8000-000000000003.txt': 'Speaker: hi.',
        'Sources/D0000000-0000-4000-8000-000000000001.txt': 'Note the irony.',
      }),
      OPTS,
    );
    expectValid(b);
    expect(all(b, 'code').map((c) => c.name)).toEqual(['Theme']);
    const [caseA] = all(b, 'case');
    const docA = all(b, 'document').find((d) => d.name === 'Interview A')!;
    expect(docA.case_id).toBe(caseA!.id);
    expect(codingsOf(b)).toEqual(['Interview A|Theme|Rita|Hello']);
    const memos = all(b, 'memo');
    const annotation = memos.find((m) => m.title === 'Annotation')!;
    expect(annotation.target).toEqual({ kind: 'document', id: docA.id });
    expect(annotation.body).toBe('> world\n\nNote the irony.');
    expect(memos.find((m) => m.title === 'About A')!.target).toEqual({ kind: 'case', id: caseA!.id });
    const audio = all(b, 'document').find((d) => d.kind === 'transcript')!;
    expect(audio.name).toBe('Audio A');
    expect(audio.media!.mime).toBe('audio/mpeg');
    expect(b.warnings.join('\n')).toMatch(/1 coding\(s\) to cases/);
    expect(b.warnings.join('\n')).toMatch(/1 link\(s\) between objects/);
  });

  it('MAXQDA: nameless cases, variables on sources, segment comments and memos', async () => {
    const long = 'x'.repeat(5000);
    const xml = project(
      `<CodeBook><Codes><Code guid="a0000000-0000-4000-8000-000000000001" name="Tema" isCodable="true"/></Codes></CodeBook>
      <Variables>
        <Variable guid="e0000000-0000-4000-8000-000000000001" name="Idade" typeOfVariable="Float"/>
        <Variable guid="e0000000-0000-4000-8000-000000000002" name="Ativo" typeOfVariable="Boolean"/>
        <Variable guid="e0000000-0000-4000-8000-000000000003" name="Quando" typeOfVariable="DateTime"/>
      </Variables>
      <Cases><Case guid="c0000000-0000-4000-8000-000000000001">
        <VariableValue><VariableRef targetGUID="e0000000-0000-4000-8000-000000000001"/><FloatValue>33.5</FloatValue></VariableValue>
        <SourceRef targetGUID="b0000000-0000-4000-8000-000000000001"/>
      </Case></Cases>
      <Sources>
        <TextSource guid="b0000000-0000-4000-8000-000000000001" name="Entrevista" plainTextPath="internal://one.txt">
          <PlainTextSelection guid="f0000000-0000-4000-8000-000000000001" startPosition="0" endPosition="3"><Description>Só uma nota</Description></PlainTextSelection>
          <PlainTextSelection guid="f0000000-0000-4000-8000-000000000002" startPosition="4" endPosition="9"><Description>Comentário</Description>
            <Coding guid="10000000-0000-4000-8000-000000000001"><CodeRef targetGUID="a0000000-0000-4000-8000-000000000001"/></Coding></PlainTextSelection>
          <PlainTextSelection guid="f0000000-0000-4000-8000-000000000003" startPosition="10" endPosition="14"><Description>${long}</Description>
            <Coding guid="10000000-0000-4000-8000-000000000002"><CodeRef targetGUID="a0000000-0000-4000-8000-000000000001"/></Coding></PlainTextSelection>
        </TextSource>
        <TextSource guid="b0000000-0000-4000-8000-000000000002" name="Entrevista" plainTextPath="internal://two.txt">
          <VariableValue><VariableRef targetGUID="e0000000-0000-4000-8000-000000000002"/><BooleanValue>1</BooleanValue></VariableValue>
          <VariableValue><VariableRef targetGUID="e0000000-0000-4000-8000-000000000003"/><DateTimeValue>2026-02-01T10:30:00</DateTimeValue></VariableValue>
          <VariableValue><VariableRef targetGUID="e0000000-0000-4000-8000-000000000001"/><FloatValue>abc</FloatValue></VariableValue>
        </TextSource>
      </Sources>
      <Sets>
        <Set guid="40000000-0000-4000-8000-000000000001" name="Grupo A"><MemberSource targetGUID="b0000000-0000-4000-8000-000000000002"/></Set>
        <Set guid="40000000-0000-4000-8000-000000000002" name="Códigos"><MemberCode targetGUID="a0000000-0000-4000-8000-000000000001"/></Set>
      </Sets>`,
      'origin="MAXQDA 2022"',
    );
    const b = await importQdpx(zip({ 'project.qde': xml, 'sources/one.txt': 'Uma frase bem curta.', 'sources/two.txt': 'Outro documento.' }), OPTS);
    expectValid(b);
    const docs = all(b, 'document');
    expect(docs.map((d) => d.name)).toEqual(['Entrevista', 'Entrevista']);
    const cases = all(b, 'case');
    const attrs = Object.fromEntries(all(b, 'attribute').map((a) => [a.name, a]));
    expect(attrs.Quando!.type).toBe('date');
    expect(cases.map((c) => c.name)).toEqual(['Entrevista', 'Entrevista']);
    expect(cases[0]!.values).toEqual({ [attrs.Idade!.id]: 33.5 });
    expect(cases[1]!.values).toEqual({ [attrs.Ativo!.id]: true, [attrs.Quando!.id]: '2026-02-01' });
    expect(docs[1]!.case_id).toBe(cases[1]!.id);
    const codings = all(b, 'coding');
    expect(codings.map((c) => [c.text, c.comment.length])).toEqual([
      ['frase', 'Comentário'.length],
      ['bem ', 4000],
    ]);
    const memos = all(b, 'memo');
    expect(memos.find((m) => m.target.kind === 'document')!.body).toBe('> Uma\n\nSó uma nota');
    expect(memos.find((m) => m.target.kind === 'coding')!.body).toBe(long);
    expect(all(b, 'docgroup').map((g) => g.name)).toEqual(['Grupo A']);
    const w = b.warnings.join('\n');
    expect(w).toMatch(/1 set\(s\) of codes/);
    expect(w).toMatch(/1 long segment comment/);
    expect(w).toMatch(/1 date-time value/);
    expect(w).toMatch(/1 attribute value\(s\) did not match/);
  });

  it('QualCoder: annotation notes with their own selection, empty descriptions', async () => {
    const xml = project(
      `<CodeBook><Codes><Code guid="a0000000-0000-4000-8000-000000000001" name="Cat" isCodable="false"><Description/></Code></Codes></CodeBook>
      <Sources><TextSource guid="b0000000-0000-4000-8000-000000000001" name="T" plainTextPath="internal://t.txt"><Description/>
        <NoteRef targetGUID="d0000000-0000-4000-8000-000000000001"/></TextSource></Sources>
      <Notes><Note guid="d0000000-0000-4000-8000-000000000001" name="Annotation"><PlainTextContent>Ironic.</PlainTextContent>
        <PlainTextSelection guid="f0000000-0000-4000-8000-000000000001" startPosition="6" endPosition="11"/></Note></Notes>`,
      'origin="QualCoder 3.6"',
    );
    const b = await importQdpx(zip({ 'project.qde': xml, 'sources/t.txt': '\uFEFFIt is great.' }), OPTS);
    expectValid(b);
    expect(all(b, 'memo').map((m) => m.body)).toEqual(['> great\n\nIronic.']);
    expect(all(b, 'code')[0]).toMatchObject({ description: '', codable: false });
  });

  it('pre-1.0 and prefixed namespaces, braces, any .qde name', async () => {
    const body = `<q:CodeBook><q:Codes><q:Code guid="{A0000000-0000-4000-8000-000000000001}" name="Old" isCodable="1"/></q:Codes></q:CodeBook>`;
    const xml = `<?xml version="1.0"?><q:Project xmlns:q="urn:QDA-XML:project:0:10" name="Antigo" creationDateTime="2018-10-04T22:56:11">${body}</q:Project>`;
    const b = await importQdpx(zip({ 'Antigo.QDE': xml }), OPTS);
    expect(all(b, 'code').map((c) => c.name)).toEqual(['Old']);
    expect(b.project.name).toBe('Antigo');
  });

  it('reads text from a Word file when no plain text is included', async () => {
    const docx = buildDocx({ title: 'Diário de campo', blocks: [{ type: 'paragraph', text: 'Visitei a escola às 9h.' }] });
    const xml = project(`<Sources><TextSource guid="b0000000-0000-4000-8000-000000000001" name="Diário" richTextPath="internal://d.docx"/></Sources>
      <Notes><Note guid="d0000000-0000-4000-8000-000000000001" name="Nota" richTextPath="internal://d.docx"/></Notes>`);
    const b = await importQdpx(zip({ 'project.qde': xml, 'sources/d.docx': docx }), OPTS);
    expectValid(b);
    expect(all(b, 'doctext')[0]!.text).toBe('Diário de campo\n\nVisitei a escola às 9h.');
    expect(all(b, 'document')[0]!.original!.mime).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(all(b, 'memo')[0]!.body).toBe('Diário de campo\n\nVisitei a escola às 9h.');
    expect(b.warnings.join('\n')).toMatch(/read from Word files/);
  });

  it('a project zipped inside a folder', async () => {
    const xml = project(`<Sources><TextSource guid="b0000000-0000-4000-8000-000000000001" name="T" plainTextPath="internal://t.txt"/></Sources>`);
    const b = await importQdpx(zip({ 'Meu projeto/project.qde': xml, 'Meu projeto/sources/t.txt': 'Texto.' }), OPTS);
    expect(all(b, 'doctext').map((t) => t.text)).toEqual(['Texto.']);
  });

  it('splits ATLAS.ti "A::B" names when asked', async () => {
    const xml = project(`<CodeBook><Codes>
      <Code guid="a0000000-0000-4000-8000-000000000001" name="Coke" isCodable="true"/>
      <Code guid="a0000000-0000-4000-8000-000000000002" name="Coke::diet Coke" isCodable="true"/>
      <Code guid="a0000000-0000-4000-8000-000000000003" name="Fanta :: Orange :: Zero" isCodable="true"/>
    </Codes></CodeBook>`);
    const flat = await importQdpx(zip({ 'project.qde': xml }), OPTS);
    expect(all(flat, 'code').map((c) => c.name)).toEqual(['Coke', 'Coke::diet Coke', 'Fanta :: Orange :: Zero']);
    const b = await importQdpx(zip({ 'project.qde': xml }), { ...OPTS, splitColonNames: true });
    expectValid(b);
    const codes = all(b, 'code');
    const byId = new Map(codes.map((c) => [c.id, c]));
    const path = (c: Entity<'code'>): string => (c.parent_id ? `${path(byId.get(c.parent_id)!)}/${c.name}` : c.name);
    expect(codes.map(path).sort()).toEqual(['Coke', 'Coke/diet Coke', 'Fanta', 'Fanta/Orange', 'Fanta/Orange/Zero']);
    expect(codes.find((c) => c.name === 'Fanta')!.codable).toBe(false);
  });
});

describe('robustness', () => {
  it('skips missing references with warnings, never throws', async () => {
    const xml = project(
      `<CodeBook><Codes><Code guid="a0000000-0000-4000-8000-000000000001" name="Pasta" isCodable="false"/></Codes></CodeBook>
      <Sources>
        <TextSource guid="b0000000-0000-4000-8000-000000000001" name="T" plainTextPath="internal://t.txt">
          <PlainTextSelection guid="f0000000-0000-4000-8000-000000000001" startPosition="0" endPosition="4">
            <Coding guid="10000000-0000-4000-8000-000000000001" creatingUser="99999999-0000-4000-8000-000000000000"><CodeRef targetGUID="a0000000-0000-4000-8000-000000000001"/><NoteRef targetGUID="d9999999-0000-4000-8000-000000000000"/></Coding>
            <Coding guid="10000000-0000-4000-8000-000000000002"><CodeRef targetGUID="a9999999-0000-4000-8000-000000000000"/></Coding>
            <Coding guid="10000000-0000-4000-8000-000000000003"><CodeRef targetGUID="a0000000-0000-4000-8000-000000000001"/></Coding>
            <Coding guid="10000000-0000-4000-8000-000000000006"><CodeRef targetGUID="a0000000-0000-4000-8000-000000000001"/></Coding>
          </PlainTextSelection>
          <PlainTextSelection guid="f0000000-0000-4000-8000-000000000002" startPosition="50" endPosition="60"><Coding guid="10000000-0000-4000-8000-000000000004"><CodeRef targetGUID="a0000000-0000-4000-8000-000000000001"/></Coding></PlainTextSelection>
          <PlainTextSelection guid="f0000000-0000-4000-8000-000000000003" startPosition="5" endPosition="60"><Coding guid="10000000-0000-4000-8000-000000000005"><CodeRef targetGUID="a0000000-0000-4000-8000-000000000001"/></Coding></PlainTextSelection>
          <PlainTextSelection guid="f0000000-0000-4000-8000-000000000004" startPosition="x" endPosition="3"/>
        </TextSource>
        <TextSource guid="b0000000-0000-4000-8000-000000000002" name="Sem ficheiro" plainTextPath="internal://missing.txt"/>
        <TextSource guid="b0000000-0000-4000-8000-000000000003" name="Externo" plainTextPath="absolute:///C:/x.txt"/>
      </Sources>
      <Sets><Set guid="40000000-0000-4000-8000-000000000001" name="S"><MemberSource targetGUID="b9999999-0000-4000-8000-000000000000"/></Set></Sets>
      <NoteRef targetGUID="d9999999-0000-4000-8000-000000000000"/>`,
    );
    const b = await importQdpx(zip({ 'project.qde': xml, 'sources/t.txt': 'Duas palavras.' }), OPTS);
    expectValid(b);
    // A user missing from <Users> is still a person of their own, not the importing researcher.
    expect(codingsOf(b)).toEqual(['T|Pasta|Eu|Duas', 'T|Pasta|Eu|palavras.', 'T|Pasta|User 99999999|Duas']);
    expect(all(b, 'code')[0]!.codable).toBe(true);
    expect(all(b, 'document').map((d) => d.name)).toEqual(['T', 'Sem ficheiro']);
    const w = b.warnings.join('\n');
    for (const re of [/1 coding\(s\) pointing to a code that does not exist/, /2 coded segment\(s\) with positions outside/, /1 coded segment\(s\) ran past the end/, /1 duplicate coding/, /1 file\(s\) referenced by the project were missing/, /1 source\(s\) whose text file is stored outside/, /1 code\(s\) marked as folders/, /1 document\(s\) had no text/, /1 coder\(s\) were not listed/]) {
      expect(w).toMatch(re);
    }
  });

  it('refuses zip-slip entries and reports them', async () => {
    const xml = project(`<Sources><TextSource guid="b0000000-0000-4000-8000-000000000001" name="T" plainTextPath="internal://../evil.txt"/></Sources>`);
    const b = await importQdpx(zip({ 'project.qde': xml, '../evil.txt': 'evil', '/abs/evil.txt': 'evil' }), OPTS);
    expect(all(b, 'doctext').map((t) => t.text)).toEqual(['']);
    expect(b.warnings.filter((w) => w.includes('unsafe path'))).toHaveLength(2);
  });

  it('throws RefiError for files that are not REFI-QDA projects', async () => {
    await expect(importQdpx(utf8('not a zip'), OPTS)).rejects.toThrow(RefiError);
    await expect(importQdpx(new Uint8Array(), OPTS)).rejects.toThrow(RefiError);
    await expect(importQdpx(zip({ 'readme.txt': 'hi' }), OPTS)).rejects.toThrow(/No project.qde/);
    await expect(importQdpx(zip({ 'project.qde': '<Project><broken></Project>' }), OPTS)).rejects.toThrow(/not valid XML/);
    await expect(importQdpx(zip({ 'project.qde': '<CodeBook/>' }), OPTS)).rejects.toThrow(/not a REFI-QDA project/);
  });

  it('an empty project gives an empty bundle', async () => {
    const b = await importQdpx(zip({ 'project.qde': project('') }), OPTS);
    expect(b.records).toEqual([]);
    expect(b.warnings).toEqual([]);
    expect(b.project.name).toBe('Teste');
  });

  it('cleans names: too long, blank, multi-line', async () => {
    const ordered = project(`<Users><User guid="00000000-0000-4000-8000-000000000001"/></Users><CodeBook><Codes><Code guid="a0000000-0000-4000-8000-000000000001" name="${'n'.repeat(300)}" isCodable="true"/><Code guid="a0000000-0000-4000-8000-000000000002" name="  " isCodable="true"/></Codes></CodeBook>`);
    const b2 = await importQdpx(zip({ 'project.qde': ordered }), OPTS);
    expectValid(b2);
    expect(all(b2, 'code').map((c) => c.name.length)).toEqual([120, 'Code 2'.length]);
    expect(all(b2, 'coder').map((c) => c.name)).toEqual(['User 1']);
  });
});

describe('decoding and data that must not be lost or misattributed', () => {
  const CODE = `<CodeBook><Codes><Code guid="a0000000-0000-4000-8000-000000000001" name="Calm" isCodable="true"/></Codes></CodeBook>`;
  const sel = (start: number, end: number, name: string, user = '') =>
    `<PlainTextSelection guid="${uuidLike()}" name="${name}" startPosition="${start}" endPosition="${end}"${user ? ` creatingUser="${user}"` : ''}>
      <Coding guid="${uuidLike()}"${user ? ` creatingUser="${user}"` : ''}><CodeRef targetGUID="a0000000-0000-4000-8000-000000000001"/></Coding>
    </PlainTextSelection>`;
  let n = 0;
  function uuidLike(): string {
    return `c0000000-0000-4000-8000-${(n++).toString(16).padStart(12, '0')}`;
  }
  const textSource = (body: string) => `<Sources><TextSource guid="b0000000-0000-4000-8000-000000000001" name="T" plainTextPath="internal://t.txt">${body}</TextSource></Sources>`;
  const cpIndex = (text: string, part: string) => Array.from(text.slice(0, text.indexOf(part))).length;

  it('QualCoder double BOM: only the file BOM comes off, the counted U+FEFF keeps every coding in place', async () => {
    // QualCoder keeps the BOM of a file it imported as U+FEFF in its text (and counts it), then
    // writes the file with a BOM of its own in front.
    const stored = '﻿Interviewer: How is the garden?\nP1: It keeps me sane.\n';
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(stored)]);
    const xml = project(CODE + textSource(sel(37, 54, 'It keeps me sane.')), 'origin="QualCoder 3.6"');
    const b = await importQdpx(zip({ 'project.qde': xml, 't.txt': bytes }), OPTS);
    expectValid(b);
    expect(all(b, 'doctext')[0]!.text).toBe('Interviewer: How is the garden?\nP1: It keeps me sane.\n');
    expect(all(b, 'coding').map((c) => c.text)).toEqual(['It keeps me sane.']);
  });

  it('a stray invalid byte becomes one U+FFFD instead of turning the whole text into mojibake', async () => {
    const text = 'Entrevistadora: Como é a horta?\nParticipante: É ótima, ação coletiva e união.';
    const bytes = new Uint8Array([...utf8(text), 0x96, 0x0a]);
    const s = cpIndex(text, 'ação coletiva');
    const xml = project(CODE + textSource(sel(s, s + 13, 'ação coletiva')), 'origin="MAXQDA 2022"');
    const b = await importQdpx(zip({ 'project.qde': xml, 't.txt': bytes }), OPTS);
    expect(all(b, 'doctext')[0]!.text).toBe(`${text}\uFFFD\n`);
    expect(all(b, 'coding').map((c) => c.text)).toEqual(['ação coletiva']);
    expect(b.issues.find((i) => i.code === 'badEncoding')?.count).toBe(1);
  });

  it('a text that is not UTF-8 at all is still read as Windows-1252, with a warning', async () => {
    const latin1 = new Uint8Array([...'Ação é ótima.'].map((c) => c.charCodeAt(0)));
    const xml = project(CODE + textSource(sel(0, 4, 'Ação')));
    const b = await importQdpx(zip({ 'project.qde': xml, 't.txt': latin1 }), OPTS);
    expect(all(b, 'doctext')[0]!.text).toBe('Ação é ótima.');
    expect(all(b, 'coding').map((c) => c.text)).toEqual(['Ação']);
    expect(b.issues.map((i) => i.code)).toContain('badEncoding');
  });

  it('codings by users missing from <Users> keep one coder per user and are not merged as duplicates', async () => {
    const text = 'Interviewer: How are you?\nP1: I feel calm in the garden.';
    const s = cpIndex(text, 'I feel calm');
    const AA = 'A0000000-0000-4000-8000-0000000000AA';
    const BB = 'A0000000-0000-4000-8000-0000000000BB';
    const xml = project(CODE + textSource(sel(s, s + 19, 'I feel calm in the', AA) + sel(s, s + 19, 'I feel calm in the', BB) + sel(s, s + 19, 'I feel calm in the', AA)));
    const b = await importQdpx(zip({ 'project.qde': xml, 't.txt': text }), OPTS);
    expectValid(b);
    expect(all(b, 'coder').map((c) => c.name).sort()).toEqual(['User a0000000', 'User a0000000 (2)']);
    expect(all(b, 'coding')).toHaveLength(2);
    expect(new Set(all(b, 'coding').map((c) => c.coder_id)).size).toBe(2);
    expect(b.issues.find((i) => i.code === 'unknownUser')?.count).toBe(2);
    expect(b.issues.find((i) => i.code === 'duplicateCoding')?.count).toBe(1); // AA twice is a real duplicate
    // No GUID at all still goes to the researcher's own coder.
    const none = await importQdpx(zip({ 'project.qde': project(CODE + textSource(sel(s, s + 19, ''))), 't.txt': text }), OPTS);
    expect(all(none, 'coder').map((c) => c.name)).toEqual(['Eu']);
  });

  it('a known project creator never takes over the codings of an unlisted second coder', async () => {
    const text = 'Interviewer: How are you?\nP1: I feel calm in the garden.';
    const s = cpIndex(text, 'I feel calm');
    const AA = 'a0000000-0000-4000-8000-0000000000aa';
    const BB = 'b0000000-0000-4000-8000-0000000000bb';
    const users = `<Users><User guid="${AA}" name="Ana"/></Users>`;
    const xml = project(users + CODE + textSource(sel(s, s + 19, 'x', AA) + sel(s, s + 19, 'x', BB)), `creatingUserGUID="${AA}"`);
    const b = await importQdpx(zip({ 'project.qde': xml, 't.txt': text }), OPTS);
    expectValid(b);
    expect(all(b, 'coder').map((c) => c.name).sort()).toEqual(['Ana', 'User b0000000']);
    expect(codingsOf(b)).toEqual(['T|Calm|Ana|I feel calm in the ', 'T|Calm|User b0000000|I feel calm in the ']);
    expect(b.issues.find((i) => i.code === 'unknownUser')?.count).toBe(1);
    expect(b.issues.find((i) => i.code === 'duplicateCoding')).toBeUndefined();
    // A known selection user does not take over a Coding whose own (unlisted) creatingUser differs.
    const mixed = `<PlainTextSelection guid="${uuidLike()}" startPosition="${s}" endPosition="${s + 19}" creatingUser="${AA}"><Coding guid="${uuidLike()}" creatingUser="${BB}"><CodeRef targetGUID="a0000000-0000-4000-8000-000000000001"/></Coding></PlainTextSelection>`;
    const m = await importQdpx(zip({ 'project.qde': project(users + CODE + textSource(mixed), `creatingUserGUID="${AA}"`), 't.txt': text }), OPTS);
    expect(codingsOf(m)).toEqual(['T|Calm|User b0000000|I feel calm in the ']);
    // No user on the coding or selection: the project creator is the coder.
    const anon = await importQdpx(zip({ 'project.qde': project(users + CODE + textSource(sel(s, s + 19, 'x')), `creatingUserGUID="${AA}"`), 't.txt': text }), OPTS);
    expect(codingsOf(anon)).toEqual(['T|Calm|Ana|I feel calm in the ']);
  });

  it('keeps the descriptions of document groups and transcripts as memos', async () => {
    const xml = project(
      `<Sources>
        <TextSource guid="b0000000-0000-4000-8000-000000000001" name="T1" plainTextPath="internal://t.txt"/>
        <AudioSource guid="b0000000-0000-4000-8000-000000000002" name="Rec">
          <Transcript guid="b0000000-0000-4000-8000-000000000003" name="Rec" plainTextPath="internal://r.txt">
            <Description>Transcribed by Rita, verbatim, pauses marked</Description>
          </Transcript>
        </AudioSource>
      </Sources>
      <Sets><Set guid="40000000-0000-4000-8000-000000000001" name="Document group 1">
        <Description>Rural participants interviewed in March; recruitment via the parish</Description>
        <MemberSource targetGUID="b0000000-0000-4000-8000-000000000001"/><MemberSource targetGUID="b0000000-0000-4000-8000-000000000002"/>
      </Set></Sets>`,
      'origin="ATLAS.ti 23.1.0"',
    );
    const b = await importQdpx(zip({ 'project.qde': xml, 't.txt': 'Texto.', 'r.txt': 'A: Olá.' }), OPTS);
    expectValid(b);
    const memos = all(b, 'memo').map((m) => `${m.title}|${m.target.kind}|${m.body}`).sort();
    expect(memos).toEqual([
      'Description|document|Transcribed by Rita, verbatim, pauses marked',
      'Document group 1|project|Rural participants interviewed in March; recruitment via the parish',
    ]);
  });

  it('imports a source with more selections than a spread call can take', async () => {
    const count = 200_000;
    const parts: string[] = [];
    for (let i = 0; i < count; i++) parts.push(`<PlainTextSelection guid="c0000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}" startPosition="0" endPosition="1"/>`);
    const xml = project(textSource(parts.join('')));
    const b = await importQdpx(zip({ 'project.qde': xml, 't.txt': 'abc' }), OPTS);
    expect(all(b, 'document')).toHaveLength(1);
  }, 60_000);

  it('refuses a zip bomb before inflating it', async () => {
    const qde = project(textSource(''));
    const bomb = forgeSize(zip({ 'project.qde': qde, 't.txt': 'abc' }), 'project.qde', 400 * 1024 * 1024);
    await expect(importQdpx(bomb, OPTS)).rejects.toThrow(/too large/);
    const bigSource = forgeSize(zip({ 'project.qde': qde, 't.txt': 'abc' }), 't.txt', 0xf0000000);
    await expect(importQdpx(bigSource, OPTS)).rejects.toThrow(RefiError);
  });

  it('refuses an archive holding one entry name twice (also differing only in case or path spelling)', async () => {
    const qde = project(textSource(''));
    // Each duplicate of project.qde would be inflated, while the budget counted the name once.
    let bomb = zip({ 'project.qde': qde, 'project.qdX': qde, 'project.qdY': qde, 't.txt': 'abc' });
    bomb = forgeName(forgeName(bomb, 'project.qdX', 'project.qde'), 'project.qdY', 'project.qde');
    const t0 = Date.now();
    await expect(importQdpx(forgeSize(bomb, 'project.qde', 250 * 1024 * 1024), OPTS)).rejects.toThrow(/more than once/);
    expect(Date.now() - t0).toBeLessThan(2000);
    // Lookups ignore case and "./": two spellings of one path are as ambiguous.
    await expect(importQdpx(zip({ 'project.qde': qde, 'T.TXT': 'abc', './t.txt': 'abd' }), OPTS)).rejects.toThrow(/more than once/);
  });
});

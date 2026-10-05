import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { buildDocx, buildHtml } from '../../core/export/office';
import { createAttribute, createCase } from '../../services/cases';
import { createCode } from '../../services/codes';
import { applyCode } from '../../services/codings';
import { createDocument } from '../../services/documents';
import { createMemo } from '../../services/memos';
import { makeTestProject } from '../../services/testing';
import { makeI18n } from '../../ui/i18n';
import { attachedBytes, codebookReport, codebookRows, formatBytes, formatValue, loadReportData, memoBlocks, projectReport } from './report';

const en = makeI18n('en');
const pt = makeI18n('pt');
const now = new Date('2026-10-05T10:00:00Z');
const info = { name: 'Community gardens', description: 'How gardens shape wellbeing.', created_at: '2026-09-01T09:00:00Z' };

async function seeded() {
  const ctx = await makeTestProject();
  const { code: parent } = await createCode(ctx, { name: 'Belonging', description: 'Feeling part of a group.', inclusion: 'Talk of “we”.', example: 'We all look after it.' });
  const { code: child } = await createCode(ctx, { name: 'Neighbours', parent_id: parent.id });
  const { attribute: age } = await createAttribute(ctx, { name: 'Age', type: 'number' });
  const { attribute: urban } = await createAttribute(ctx, { name: 'Urban', type: 'boolean' });
  const { case: c1 } = await createCase(ctx, { name: 'P01', description: 'Retired teacher', values: { [age.id]: 67, [urban.id]: true } });
  const { document: doc } = await createDocument(ctx, { name: 'Interview 1', kind: 'text', text: 'We all look after the garden together.', case_id: c1.id });
  const { coding } = await applyCode(ctx, { documentId: doc.id, start: 0, end: 6, codeId: child.id });
  await createMemo(ctx, { title: 'First thoughts', body: '# Idea\n\nGardens are **social**.\n\n- one\n- two', target: { kind: 'project', id: null } });
  await createMemo(ctx, { title: 'On neighbours', body: 'Check P01.', target: { kind: 'code', id: child.id } });
  await createMemo(ctx, { title: 'Segment', body: 'Telling.', target: { kind: 'coding', id: coding.id } });
  return { ctx, parent, child, doc };
}

describe('loadReportData', () => {
  it('gathers counts, the code tree with paths, memos with their targets, and cases', async () => {
    const { ctx } = await seeded();
    const data = await loadReportData(ctx, info);
    expect(data.summary).toMatchObject({ documents: 1, codes: 2, codings: 1, memos: 3, cases: 1 });
    expect(data.codes.map((c) => [c.path.join('/'), c.depth, c.total, c.documents])).toEqual([
      ['Belonging', 0, 1, 1],
      ['Belonging/Neighbours', 1, 1, 1],
    ]);
    expect(data.memos.map((m) => [m.target, m.targetName, m.author])).toEqual([
      ['project', null, 'Ana'],
      ['code', 'Neighbours', 'Ana'],
      ['coding', 'Interview 1', 'Ana'],
    ]);
    expect(data.cases).toEqual([expect.objectContaining({ name: 'P01', documents: 1 })]);
    expect(data.attributes.map((a) => a.name)).toEqual(['Age', 'Urban']);
    expect(data.coders).toEqual(['Ana']);
  });
});

describe('codebook exports', () => {
  it('writes table rows with a translated header and the path of each code', async () => {
    const { ctx } = await seeded();
    const data = await loadReportData(ctx, info);
    const rows = codebookRows(data.codes, pt);
    expect(rows[0]![0]).toBe('Código');
    expect(rows[2]!.slice(0, 2)).toEqual(['Neighbours', 'Belonging > Neighbours']);
    expect(rows[1]![7]).toBe(1);
  });

  it('makes a Word codebook with criteria and examples', async () => {
    const { ctx } = await seeded();
    const data = await loadReportData(ctx, info);
    const doc = codebookReport(data, en, { generator: 'Trama test', now });
    expect(doc.title).toBe('Codebook — Community gardens');
    const xml = new TextDecoder().decode(unzipSync(buildDocx(doc))['word/document.xml']!);
    expect(xml).toContain('Talk of “we”.');
    expect(xml).toContain('We all look after it.');
  });
});

describe('projectReport', () => {
  it('holds the overview, codebook, memos and the case table, in the reader’s language', async () => {
    const { ctx } = await seeded();
    const data = await loadReportData(ctx, info);
    const doc = projectReport(data, en, { generator: 'Trama test', now });
    const headings = doc.blocks.filter((b) => b.type === 'heading' && b.level === 1).map((b) => (b as { text: string }).text);
    expect(headings).toEqual(['Overview', 'Codebook', 'Memos', 'Cases']);
    const html = buildHtml(doc);
    expect(html).toContain('How gardens shape wellbeing.');
    expect(html).toContain('On the code “Neighbours”');
    expect(html).toContain('On a coded segment of “Interview 1”');
    expect(html).toContain('<strong>social</strong>');
    expect(html).toContain('Retired teacher');
    expect(html).toContain('>67<');
    expect(html).toContain('>Yes<');
    const ptDoc = projectReport(data, pt, { generator: 'Trama test', now });
    expect(ptDoc.blocks.some((b) => b.type === 'heading' && b.text === 'Memorandos')).toBe(true);
  });

  it('says so when a project is empty', async () => {
    const ctx = await makeTestProject();
    const data = await loadReportData(ctx, info);
    const html = buildHtml(projectReport(data, en, { generator: 'g', now }));
    expect(html).toContain('No codes yet.');
    expect(html).toContain('No memos yet.');
    expect(html).toContain('No cases yet.');
  });
});

describe('helpers', () => {
  it('turns memo Markdown into report blocks', () => {
    const b = memoBlocks('## Head\n\nText with *it*.\n\n> quote\n\n1. a\n2. b');
    expect(b.map((x) => x.type)).toEqual(['paragraph', 'paragraph', 'paragraph', 'list']);
    expect(b[2]).toMatchObject({ style: 'quote' });
    expect(b[3]).toMatchObject({ ordered: true });
  });

  it('formats attribute values', () => {
    expect(formatValue(true, pt)).toBe('Sim');
    expect(formatValue(1234.5, pt)).toBe('1234,5');
    expect(formatValue(null, en)).toBe('');
    expect(formatValue('2026-01-02', en)).toBe('2026-01-02');
  });

  it('formats sizes', () => {
    expect(formatBytes(0, 'en-GB')).toBe('0 B');
    expect(formatBytes(820_000, 'en-GB')).toBe('820 KB');
    expect(formatBytes(12_400_000, 'pt-PT')).toBe('12,4 MB');
    expect(formatBytes(3_000_000_000, 'en-GB')).toBe('3 GB');
  });

  it('counts each attached file once', () => {
    const ref = (id: string, size: number) => ({ blob_id: id, filename: 'f', mime: 'audio/mpeg', size });
    expect(attachedBytes([{ original: ref('a', 10), media: ref('b', 5) }, { original: ref('a', 10), media: null }, { original: null, media: null }])).toBe(15);
  });
});

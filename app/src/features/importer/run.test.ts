import { describe, expect, it } from 'vitest';
import { cuesToTranscript, type ImportedTable } from '../../core/import';
import { makeTestProject } from '../../services/testing';
import { JobStopped } from '../../services/jobs';
import { combineUndo } from '../../services/undo';
import { newRow, type ReviewRow, withDoc, withTable } from './model';
import { ImportSession, type RunLabels } from './run';
import { defaultMapping } from './survey';

const labels: RunLabels = { speakers: 'Speakers', questions: 'Questions', surveyDoc: (t, n) => `${t} — ${n}` };

function transcriptRow(id: string, auto: boolean): ReviewRow {
  const t = cuesToTranscript([
    { start: 0, end: 1000, speaker: 'Ana', text: 'How did you start?' },
    { start: 1000, end: 2000, speaker: 'Rui', text: 'By chance, really.' },
    { start: 2000, end: 3000, speaker: 'Ana', text: 'And now?' },
  ]);
  const row = withDoc(newRow(id, 'file', `${id}.vtt`), {
    name: id,
    kind: 'transcript',
    text: t.text,
    sync: t.sync,
    speakers: t.speakers,
    source: { filename: `${id}.vtt`, format: 'vtt' },
    warnings: [],
  });
  return { ...row, autoCodeSpeakers: auto };
}

describe('ImportSession', () => {
  it('creates a document with case, groups and recording, and auto-codes speakers once per speaker', async () => {
    const ctx = await makeTestProject();
    const s = new ImportSession(ctx, labels);
    const row: ReviewRow = {
      ...transcriptRow('Interview 1', true),
      caseChoice: { mode: 'new', name: 'Rui' },
      groups: [{ name: 'Wave 1' }],
      media: { filename: 'i1.mp3', mime: 'audio/mpeg', bytes: new Uint8Array([1, 2, 3]) },
    };
    const [made] = await s.import(row);
    const doc = (await ctx.store.get('document', made!.id))!;
    expect(doc).toMatchObject({ name: 'Interview 1', kind: 'transcript' });
    expect(doc.media).toMatchObject({ filename: 'i1.mp3', size: 3 });
    expect(doc.source?.format).toBe('vtt');
    const cases = await ctx.store.list('case');
    expect(cases.map((c) => c.name)).toEqual(['Rui']);
    expect(doc.case_id).toBe(cases[0]!.id);
    const groups = await ctx.store.list('docgroup');
    expect(groups.map((g) => g.name)).toEqual(['Wave 1']);
    expect(doc.group_ids).toEqual([groups[0]!.id]);

    const codes = await ctx.store.list('code');
    const cat = codes.find((c) => c.name === 'Speakers')!;
    expect(cat.codable).toBe(false);
    expect(codes.filter((c) => c.parent_id === cat.id).map((c) => c.name).sort()).toEqual(['Ana', 'Rui']);
    const codings = await ctx.store.list('coding');
    expect(codings.map((c) => c.text).sort()).toEqual(['And now?', 'By chance, really.', 'How did you start?']);

    // A second transcript with the same speakers and case reuses them.
    await s.import({ ...transcriptRow('Interview 2', true), caseChoice: { mode: 'new', name: 'rui' }, groups: [{ name: 'wave 1' }] });
    expect((await ctx.store.list('case')).length).toBe(1);
    expect((await ctx.store.list('docgroup')).length).toBe(1);
    expect((await ctx.store.list('code')).length).toBe(3);
    expect((await ctx.store.list('coding')).length).toBe(6);

    // One undo takes the whole batch away.
    await combineUndo('document.add', '×2', s.undos).undo();
    expect(await ctx.store.list('document')).toHaveLength(0);
    expect(await ctx.store.list('coding')).toHaveLength(0);
    expect(await ctx.store.list('code')).toHaveLength(0);
    expect(await ctx.store.list('case')).toHaveLength(0);
  });

  it('reuses an existing Speakers category and its codes', async () => {
    const ctx = await makeTestProject();
    const first = new ImportSession(ctx, labels);
    await first.import(transcriptRow('A', true));
    const second = new ImportSession(ctx, labels);
    await second.import(transcriptRow('B', true));
    expect((await ctx.store.list('code')).length).toBe(3);
  });

  it('keeps the original file of a PDF and records pasted text as such', async () => {
    const ctx = await makeTestProject();
    const s = new ImportSession(ctx, labels);
    const pdf = withDoc(newRow('p', 'file', 'r.pdf'), {
      name: 'Report', kind: 'pdf', text: 'Text', sync: [], speakers: [], source: { filename: 'r.pdf', format: 'pdf' }, warnings: [],
      original: { bytes: new Uint8Array([37, 80, 68, 70]), mime: 'application/pdf' },
    });
    const pasted = withDoc(newRow('q', 'paste', 'Pasted'), { name: 'Notes', kind: 'text', text: 'Field notes', sync: [], speakers: [], source: { filename: 'Notes', format: 'txt' }, warnings: [] });
    const [a] = await s.import(pdf);
    const [b] = await s.import(pasted);
    expect((await ctx.store.get('document', a!.id))!.original).toMatchObject({ filename: 'r.pdf', mime: 'application/pdf' });
    expect((await ctx.store.get('document', b!.id))!.source).toMatchObject({ format: 'paste', filename: '' });
  });

  it('imports a survey: cases with attributes, a document per respondent, answers coded by question', async () => {
    const ctx = await makeTestProject();
    const table: ImportedTable = {
      name: 'Garden survey',
      headers: ['ID', 'Age', 'What does the garden mean to you?', 'What would you change?'],
      rows: [
        ['R01', '34', 'A place to meet people and slow down after work.', 'More shade near the benches, please.'],
        ['R02', '61', 'Somewhere I feel useful since I retired from teaching.', ''],
        ['R03', '45', '', ''],
      ],
      source: { filename: 'survey.csv', format: 'csv' },
    };
    const row = withTable(newRow('s', 'file', 'survey.csv'), { table, format: 'csv', sheets: [], sheet: 0 }, defaultMapping(table));
    expect(row.survey!.roles).toEqual(['id', 'attribute', 'text', 'text']);
    const progress: number[] = [];
    const s = new ImportSession(ctx, labels);
    const made = await s.import(row, (d) => void progress.push(d));
    expect(made.map((d) => d.name)).toEqual(['Garden survey — R01', 'Garden survey — R02']);
    expect(progress).toEqual([1, 2]);
    const cases = await ctx.store.list('case');
    expect(cases.map((c) => c.name).sort()).toEqual(['R01', 'R02']);
    const [age] = await ctx.store.list('attribute');
    expect(age).toMatchObject({ name: 'Age', type: 'number' });
    expect(cases.find((c) => c.name === 'R02')!.values[age!.id]).toBe(61);
    const docs = await ctx.store.list('document');
    expect(docs.every((d) => d.kind === 'survey' && d.case_id)).toBe(true);
    const codes = await ctx.store.list('code');
    expect(codes.map((c) => c.name).sort()).toEqual(['Questions', 'What does the garden mean to you?', 'What would you change?']);
    const codings = await ctx.store.list('coding');
    expect(codings.map((c) => c.text).sort()).toEqual([
      'A place to meet people and slow down after work.',
      'More shade near the benches, please.',
      'Somewhere I feel useful since I retired from teaching.',
    ]);
  });

  it('stops before the next step when asked', async () => {
    const ctx = await makeTestProject();
    const s = new ImportSession(ctx, labels, () => true);
    await expect(s.import(transcriptRow('A', false))).rejects.toBeInstanceOf(JobStopped);
    expect(await ctx.store.list('document')).toHaveLength(0);
  });
});

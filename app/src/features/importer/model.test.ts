import { describe, expect, it } from 'vitest';
import { cuesToTranscript, parseTextTranscript } from '../../core/import';
import type { ImportedDoc } from '../../core/import';
import {
  batchTotals,
  coalesce,
  findDuplicates,
  formatMs,
  importable,
  isMediaFile,
  kindOptions,
  matchMedia,
  mediaMime,
  newRow,
  previewOf,
  speakerPlan,
  speakerSummary,
  textSha256,
  toggleGroup,
  transcriptModeFor,
  withDoc,
  withFailure,
} from './model';

const doc = (over: Partial<ImportedDoc> = {}): ImportedDoc => ({
  name: 'Interview 1',
  kind: 'text',
  text: 'Hello there.\nSecond paragraph.',
  sync: [],
  speakers: [],
  source: { filename: 'Interview 1.docx', format: 'docx' },
  warnings: [],
  ...over,
});

describe('rows', () => {
  it('takes name, kind, format and hash from the document, keeping a name already typed', () => {
    const r = withDoc(newRow('a', 'file', 'Interview 1.docx'), doc());
    expect(r).toMatchObject({ status: 'ready', name: 'Interview 1', kind: 'text', format: 'docx', include: true });
    expect(r.sha).toBe(textSha256('Hello there.\nSecond paragraph.'));
    const renamed = withDoc({ ...r, name: 'Ana' }, doc({ kind: 'transcript' }));
    expect(renamed.name).toBe('Ana');
    expect(renamed.kind).toBe('transcript');
  });

  it('hashes the canonical text, so CRLF and decomposed accents match', () => {
    expect(textSha256('Cafe\u0301\r\nx')).toBe(textSha256('Café\nx'));
  });

  it('turns off failed rows, but keeps a password-protected PDF waiting for its password', () => {
    expect(withFailure(newRow('a', 'file', 'x.doc'), { code: 'UNSUPPORTED', detail: 'doc' })).toMatchObject({ status: 'error', include: false });
    expect(withFailure(newRow('a', 'file', 'x.pdf'), { code: 'ENCRYPTED_PDF', detail: 'password' })).toMatchObject({ status: 'password', include: true });
  });

  it('offers the kinds a format can become', () => {
    expect(kindOptions({ format: 'docx', kind: 'text' })).toEqual(['text', 'transcript']);
    expect(kindOptions({ format: 'vtt', kind: 'transcript' })).toEqual(['transcript']);
    expect(kindOptions({ format: 'pdf', kind: 'pdf' })).toEqual(['pdf', 'transcript']);
    expect(kindOptions({ format: 'xlsx', kind: 'survey' })).toEqual(['survey']);
    expect(transcriptModeFor('docx', 'transcript')).toBe('always');
    expect(transcriptModeFor('txt', 'text')).toBe('never');
    expect(transcriptModeFor('vtt', 'transcript')).toBeNull();
  });

  it('imports only ready, included, named rows', () => {
    const r = withDoc(newRow('a', 'file', 'a.txt'), doc());
    expect(importable(r)).toBe(true);
    expect(importable({ ...r, include: false })).toBe(false);
    expect(importable({ ...r, name: '  ' })).toBe(false);
    expect(importable(newRow('b', 'file', 'b.txt'))).toBe(false);
  });

  it('counts documents and survey cases', () => {
    const a = withDoc(newRow('a', 'file', 'a.txt'), doc());
    const s = { ...newRow('s', 'file', 's.csv'), status: 'ready' as const, table: { table: { name: 's', headers: ['x'], rows: [['1']] }, format: 'csv' as const, sheets: [], sheet: 0 }, survey: { roles: ['text' as const], layout: 'one-per-respondent' as const, autoCode: true, createCases: true }, name: 's' };
    expect(batchTotals([a, s, { ...a, id: 'c', include: false }], () => ({ documents: 4, cases: 4 }))).toEqual({ documents: 5, cases: 4 });
  });
});

describe('findDuplicates', () => {
  it('finds texts already in the project and repeats within the batch', () => {
    const rows = [
      { id: 'a', sha: 'h1', name: 'One', filename: 'one.txt' },
      { id: 'b', sha: 'h2', name: 'Two', filename: 'two.txt' },
      { id: 'c', sha: 'h2', name: '', filename: 'two copy.txt' },
      { id: 'd', sha: null, name: 'Survey', filename: 's.csv' },
    ];
    const d = findDuplicates(rows, new Map([['h1', 'Interview 1']]));
    expect(d.get('a')).toEqual({ kind: 'project', name: 'Interview 1' });
    expect(d.has('b')).toBe(false);
    expect(d.get('c')).toEqual({ kind: 'batch', rowId: 'b', name: 'Two' });
    expect(d.has('d')).toBe(false);
  });
});

describe('previewOf', () => {
  it('splits speaker labels off transcript turns and shows timestamps', () => {
    const t = cuesToTranscript([
      { start: 1000, end: 2000, speaker: 'Ana', text: 'Good morning.' },
      { start: 65_000, end: 66_000, speaker: 'Rui', text: 'Hello!' },
    ]);
    const p = previewOf({ text: t.text, speakers: t.speakers, sync: t.sync });
    expect(p.truncated).toBe(false);
    expect(p.paragraphs).toEqual([
      { speaker: 'Ana', text: 'Good morning.', ms: 1000 },
      { speaker: 'Rui', text: 'Hello!', ms: 65_000 },
    ]);
  });

  it('reads plain text transcripts too, and truncates long texts', () => {
    const t = parseTextTranscript('Interviewer: How long have you gardened?\nMaria: Ten years, more or less.\nInterviewer: And before?', { force: true })!;
    const p = previewOf({ text: t.text, speakers: t.speakers, sync: t.sync });
    expect(p.paragraphs.map((x) => x.speaker)).toEqual(['Interviewer', 'Maria', 'Interviewer']);
    expect(p.paragraphs[1]!.text).toBe('Ten years, more or less.');
    const long = previewOf({ text: 'x'.repeat(5000), speakers: [], sync: [] }, 100);
    expect(long.truncated).toBe(true);
    expect(long.paragraphs[0]!.text.length).toBe(100);
  });

  it('keeps plain paragraphs without speakers and drops trailing blank lines', () => {
    expect(previewOf({ text: 'One\n\nTwo\n\n', speakers: [], sync: [] }).paragraphs.map((p) => p.text)).toEqual(['One', '', 'Two']);
  });

  it('formats media times', () => {
    expect(formatMs(42_000)).toBe('0:42');
    expect(formatMs(725_400)).toBe('12:05');
    expect(formatMs(3_729_000)).toBe('1:02:09');
  });
});

describe('speakers', () => {
  it('joins spellings of one speaker, coalesces touching spans and orders by first turn', () => {
    const plans = speakerPlan([
      { name: 'Maria ', spans: [{ start: 30, end: 40 }] },
      { name: 'Interviewer', spans: [{ start: 0, end: 10 }, { start: 50, end: 60 }] },
      { name: 'maria', spans: [{ start: 40, end: 45 }, { start: 70, end: 80 }] },
      { name: '', spans: [{ start: 90, end: 95 }] },
      { name: 'Nobody', spans: [] },
    ]);
    expect(plans).toEqual([
      { name: 'Interviewer', spans: [{ start: 0, end: 10 }, { start: 50, end: 60 }] },
      { name: 'Maria', spans: [{ start: 30, end: 45 }, { start: 70, end: 80 }] },
    ]);
    expect(speakerSummary([{ name: 'A', spans: [{ start: 0, end: 1 }, { start: 5, end: 6 }] }])).toEqual([{ name: 'A', turns: 2 }]);
  });

  it('coalesce drops empty spans', () => {
    expect(coalesce([{ start: 5, end: 5 }, { start: 3, end: 4 }, { start: 1, end: 3 }])).toEqual([{ start: 1, end: 4 }]);
  });
});

describe('cases and groups', () => {
  it('toggles group membership', () => {
    expect(toggleGroup([{ id: 'g' }], { id: 'g' })).toEqual([]);
    expect(toggleGroup([{ name: 'A' }], { name: 'a' })).toEqual([]);
    expect(toggleGroup([], { name: 'A' })).toEqual([{ name: 'A' }]);
  });
});

describe('media', () => {
  it('recognises recordings and matches them to the transcript with the same name', () => {
    expect(isMediaFile('Interview 3.MP3')).toBe(true);
    expect(isMediaFile('notes.txt')).toBe(false);
    expect(mediaMime('a.m4a')).toBe('audio/mp4');
    const rows = [
      { id: 'a', filename: '/x/Interview 3.vtt', kind: 'transcript' as const, media: null, status: 'ready' as const },
      { id: 'b', filename: 'Interview 4.vtt', kind: 'transcript' as const, media: null, status: 'ready' as const },
      { id: 'c', filename: 'Interview 5.docx', kind: 'text' as const, media: null, status: 'ready' as const },
    ];
    expect(matchMedia('C:\\rec\\interview 3.mp3', rows)).toBe('a');
    expect(matchMedia('Interview 5.mp3', rows)).toBeNull();
    expect(matchMedia('Other.mp3', rows)).toBeNull();
  });
});

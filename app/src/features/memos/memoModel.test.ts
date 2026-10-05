import { describe, expect, it } from 'vitest';
import { buildDocx, buildHtml } from '../../core/export/office';
import type { Memo, MemoTarget } from '../../core/model/types';
import {
  applyFormat, countByKind, filterMemos, groupForExport, hlcMs, markdownBlocks, memosMarkdown, memosReport, memoTitle, type MemoExportItem,
  type MemoExportLabels, plainExcerpt, resolveTarget, shorten, sortByUpdated, type TargetLookup,
} from './memoModel';

const hlc = (ms: number) => `${String(ms).padStart(15, '0')}-00000-dev`;
const memo = (id: string, title: string, body: string, target: MemoTarget, ms: number): Memo => ({
  id, title, body, target, coder_id: 'me', color: null, created_at: '2026-10-01T10:00:00.000Z', updated_at_hlc: hlc(ms), deleted: false,
});

const look: TargetLookup = {
  document: (id) => (id === 'd1' ? { name: 'Interview 1', color: null } : undefined),
  code: (id) => (id === 'c1' ? { name: 'Belonging', color: '#29a37a' } : undefined),
  coding: (id) => (id === 's1' ? { text: 'Nobody   needs\nmy papers', code_id: 'c1', document_id: 'd1', start: 5, end: 30 } : undefined),
  case: (id) => (id === 'k1' ? { name: 'Amina', color: '#e4572e' } : undefined),
};

describe('targets', () => {
  it('resolves each kind, marking deleted ones', () => {
    expect(resolveTarget({ kind: 'project', id: null }, look)).toEqual({ kind: 'project', id: null, label: '', missing: false });
    expect(resolveTarget({ kind: 'document', id: 'd1' }, look)).toMatchObject({ label: 'Interview 1', missing: false, docId: 'd1' });
    expect(resolveTarget({ kind: 'code', id: 'c1' }, look)).toMatchObject({ label: 'Belonging', color: '#29a37a' });
    expect(resolveTarget({ kind: 'case', id: 'k1' }, look)).toMatchObject({ label: 'Amina' });
    expect(resolveTarget({ kind: 'coding', id: 's1' }, look)).toMatchObject({
      label: 'Nobody needs my papers', detail: 'Belonging · Interview 1', docId: 'd1', span: { start: 5, end: 30 }, color: '#29a37a',
    });
    expect(resolveTarget({ kind: 'code', id: 'gone' }, look).missing).toBe(true);
    expect(resolveTarget({ kind: 'coding', id: 'gone' }, look).missing).toBe(true);
  });

  it('shorten cuts at a word', () => {
    expect(shorten('short', 10)).toBe('short');
    expect(shorten('the quick brown fox jumps', 15)).toBe('the quick…');
  });
});

describe('listing', () => {
  const memos = [
    memo('a', 'Research questions', 'How do **gardens** shape belonging?', { kind: 'project', id: null }, 100),
    memo('b', 'Belonging without questions', 'Not being *asked* things.', { kind: 'code', id: 'c1' }, 300),
    memo('c', '', 'Coordinator view of the garden', { kind: 'document', id: 'd1' }, 200),
  ];

  it('sorts by last change', () => {
    expect(sortByUpdated(memos).map((m) => m.id)).toEqual(['b', 'c', 'a']);
    expect(hlcMs(hlc(1234))).toBe(1234);
    expect(hlcMs('garbage')).toBe(0);
  });

  it('filters by kind and by words in title, body or target', () => {
    expect(filterMemos(memos, { kind: 'all', query: '' }).map((m) => m.id)).toEqual(['b', 'c', 'a']);
    expect(filterMemos(memos, { kind: 'code', query: '' }).map((m) => m.id)).toEqual(['b']);
    expect(filterMemos(memos, { kind: 'all', query: 'GARDEN' }).map((m) => m.id)).toEqual(['c', 'a']);
    expect(filterMemos(memos, { kind: 'all', query: 'questions asked' }).map((m) => m.id)).toEqual(['b']);
    expect(filterMemos(memos, { kind: 'all', query: 'interview', targetLabel: (m) => (m.id === 'c' ? 'Interview 1' : '') }).map((m) => m.id)).toEqual(['c']);
  });

  it('counts by kind', () => {
    expect(countByKind(memos)).toEqual({ all: 3, project: 1, document: 1, code: 1, coding: 0, case: 0 });
  });

  it('plain excerpts and titles', () => {
    expect(plainExcerpt('## Research\n\n1. How do **gardens** shape *belonging*?\n- [link](x) `code`')).toBe('Research How do gardens shape belonging? link code');
    expect(memoTitle({ title: '  ', body: '## Notes on the day' })).toBe('Notes on the day');
    expect(memoTitle({ title: 'T', body: 'x' })).toBe('T');
  });
});

describe('applyFormat', () => {
  it('wraps and unwraps bold and italic', () => {
    expect(applyFormat('a word b', 2, 6, 'bold')).toEqual({ text: 'a **word** b', selStart: 4, selEnd: 8 });
    expect(applyFormat('a **word** b', 4, 8, 'bold')).toEqual({ text: 'a word b', selStart: 2, selEnd: 6 });
    expect(applyFormat('a **word** b', 2, 10, 'bold')).toEqual({ text: 'a word b', selStart: 2, selEnd: 6 });
    expect(applyFormat('a word b', 2, 6, 'italic')).toEqual({ text: 'a *word* b', selStart: 3, selEnd: 7 });
    expect(applyFormat('a *word* b', 3, 7, 'italic')).toEqual({ text: 'a word b', selStart: 2, selEnd: 6 });
    // Italic inside bold adds a mark instead of eating the bold.
    expect(applyFormat('a **word** b', 4, 8, 'italic').text).toBe('a ***word*** b');
    expect(applyFormat('ab', 1, 1, 'bold')).toEqual({ text: 'a****b', selStart: 3, selEnd: 3 });
  });

  it('toggles headings and lists on every selected line', () => {
    expect(applyFormat('one\ntwo', 0, 0, 'heading')).toEqual({ text: '## one\ntwo', selStart: 3, selEnd: 3 });
    expect(applyFormat('## one\ntwo', 4, 4, 'heading').text).toBe('one\ntwo');
    expect(applyFormat('one\n\ntwo', 0, 8, 'bullets')).toEqual({ text: '- one\n\n- two', selStart: 0, selEnd: 12 });
    expect(applyFormat('- one\n- two', 0, 11, 'bullets').text).toBe('one\ntwo');
    expect(applyFormat('- one\ntwo', 0, 9, 'numbers').text).toBe('1. one\n2. two');
  });
});

describe('export', () => {
  const labels: MemoExportLabels = {
    title: 'Memos',
    subtitle: 'Growing together · 5 Oct 2026',
    group: { project: 'Project memos', document: 'Document memos', code: 'Code memos', coding: 'Segment memos', case: 'Case memos' },
    about: (t) => (t.kind === 'project' ? '' : `About: ${t.label}`),
    byline: (i) => `${i.coderName} · ${i.updated}`,
    untitled: 'Untitled',
  };
  const item = (m: Memo): MemoExportItem => ({ memo: m, target: resolveTarget(m.target, look), coderName: 'Ana', updated: '5 Oct 2026' });
  const items = [
    item(memo('b', 'On belonging', '## Notes\n- one\n- **two**', { kind: 'code', id: 'c1' }, 300)),
    item(memo('a', 'Research questions', 'Body *text*', { kind: 'project', id: null }, 100)),
    item(memo('c', '', 'Doc memo', { kind: 'document', id: 'd1' }, 200)),
  ];

  it('groups by target kind in a fixed order', () => {
    expect(groupForExport(items).map((g) => [g.kind, g.items.map((i) => i.memo.id)])).toEqual([['project', ['a']], ['document', ['c']], ['code', ['b']]]);
  });

  it('markdown: one file, memo headings below group headings', () => {
    const md = memosMarkdown(items, labels);
    expect(md.startsWith('# Memos\n\nGrowing together · 5 Oct 2026\n\n## Project memos\n\n### Research questions\n\n*Ana · 5 Oct 2026*\n\nBody *text*')).toBe(true);
    expect(md).toContain('### Untitled');
    expect(md).toContain('*About: Belonging · Ana · 5 Oct 2026*');
    expect(md).toContain('##### Notes');
    expect(md.endsWith('\n')).toBe(true);
  });

  it('markdown bodies become report blocks', () => {
    expect(markdownBlocks('## H\n\nA **b** *c*\n\n1. x\n2. y')).toEqual([
      { type: 'heading', level: 3, text: [{ text: 'H' }] },
      { type: 'paragraph', text: [{ text: 'A ' }, { text: 'b', bold: true }, { text: ' ' }, { text: 'c', italic: true }] },
      { type: 'list', ordered: true, items: [[{ text: 'x' }], [{ text: 'y' }]] },
    ]);
  });

  it('report writes as docx and html', () => {
    const doc = memosReport(items, labels);
    const html = buildHtml(doc);
    expect(html).toContain('Code memos');
    expect(html).toContain('<strong>two</strong>');
    expect(html.indexOf('Project memos')).toBeLessThan(html.indexOf('Code memos'));
    expect(buildDocx(doc).length).toBeGreaterThan(1000);
  });
});

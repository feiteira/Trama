import { describe, expect, it } from 'vitest';
import {
  anchorFromTitle, buildChapters, chapterFrom, currentSection, foldWithMap, makeExcerpt, queryWords, resolveLink, resolveTopic, searchChapters, topicOf,
} from './manualModel';
import { formatKeys } from './shortcuts';
import { groupBlocks, isKeyLabel, listTree, macKeys } from './render';
import { parseMarkdown } from '../../core/text/markdown';

const coding = chapterFrom(
  '03-coding.md',
  [
    '# Coding',
    '',
    'Coding is marking a passage.',
    '',
    '<a id="select"></a>',
    '',
    '## Select and code a passage',
    '',
    'Select the passage with the mouse. Type to **find a code** and press `Enter`.',
    '',
    '<a id="in-vivo"></a>',
    '',
    '## In-vivo codes',
    '',
    '- An in-vivo code takes its name from the participant’s own words.',
    '- Press `Ctrl+I`.',
    '',
    '### Renaming them',
    '',
    'Rename like any code.',
    '',
    '### Renaming them',
    '',
    'Twice, to check unique anchors.',
  ].join('\n'),
);

const getting = chapterFrom('01-getting-started.md', '# Getting started\n\n<a id="passphrase"></a>\n\n## Choose a passphrase\n\nAt least ten characters. Médica.\n');
const index = chapterFrom('index.md', '# The manual\n\nWelcome.\n');
const all = [index, getting, coding];

describe('chapterFrom', () => {
  it('reads the title, number, slug and sections with their anchors', () => {
    expect(coding.title).toBe('Coding');
    expect(coding.slug).toBe('03-coding');
    expect(coding.number).toBe(3);
    expect(index.number).toBeNull();
    expect(coding.sections.map((s) => [s.level, s.anchor])).toEqual([
      [2, 'select'],
      [2, 'in-vivo'],
      [3, 'renaming-them'],
      [3, 'renaming-them-2'],
    ]);
  });

  it('writes the made-up anchors into the heading blocks', () => {
    const h3 = coding.blocks.filter((b) => b.t === 'heading' && b.level === 3);
    expect(h3.map((b) => (b.t === 'heading' ? b.anchor : null))).toEqual(['renaming-them', 'renaming-them-2']);
  });

  it('makes anchors without accents or punctuation', () => {
    expect(anchorFromTitle('Códigos e hierarquia: o básico!')).toBe('codigos-e-hierarquia-o-basico');
    expect(anchorFromTitle('¿?')).toBe('section');
  });
});

describe('buildChapters', () => {
  it('keeps the reading order and falls back to English chapter by chapter', () => {
    const chs = buildChapters({ 'en/index.md': '# Manual', 'en/03-coding.md': '# Coding', 'pt/03-coding.md': '# Codificação', 'pt/glossary.md': '# Glossário' }, 'pt');
    expect(chs.map((c) => c.title)).toEqual(['Manual', 'Codificação', 'Glossário']);
  });
});

describe('resolveTopic', () => {
  it('opens a chapter and an anchor', () => {
    expect(resolveTopic('03-coding#in-vivo', all)).toEqual({ slug: '03-coding', anchor: 'in-vivo' });
    expect(resolveTopic('03-coding', all)).toEqual({ slug: '03-coding', anchor: null });
  });

  it('accepts a chapter without its number, or with .md', () => {
    expect(resolveTopic('coding#select', all)).toEqual({ slug: '03-coding', anchor: 'select' });
    expect(resolveTopic('getting-started.md', all)).toEqual({ slug: '01-getting-started', anchor: null });
  });

  it('finds a bare anchor in any chapter', () => {
    expect(resolveTopic('#passphrase', all)).toEqual({ slug: '01-getting-started', anchor: 'passphrase' });
    expect(resolveTopic('in-vivo', all)).toEqual({ slug: '03-coding', anchor: 'in-vivo' });
  });

  it('opens the chapter at the top for an unknown anchor, and nothing for an unknown chapter', () => {
    expect(resolveTopic('03-coding#nope', all)).toEqual({ slug: '03-coding', anchor: null });
    expect(resolveTopic('nowhere#select', all)).toBeNull();
    expect(resolveTopic('nowhere', all)).toBeNull();
    expect(resolveTopic('', all)).toBeNull();
    expect(resolveTopic(undefined, all)).toBeNull();
  });

  it('knows the shortcuts page', () => {
    expect(resolveTopic('shortcuts', all)).toEqual({ slug: 'shortcuts', anchor: null });
    expect(resolveTopic('shortcuts#keys-coding', all)).toEqual({ slug: 'shortcuts', anchor: 'keys-coding' });
  });

  it('round-trips through topicOf', () => {
    expect(topicOf({ slug: '03-coding', anchor: 'select' })).toBe('03-coding#select');
    expect(topicOf({ slug: 'index', anchor: null })).toBe('index');
  });
});

describe('resolveLink', () => {
  it('resolves links between chapters and within one', () => {
    expect(resolveLink('03-coding.md#in-vivo', 'index', all)).toEqual({ slug: '03-coding', anchor: 'in-vivo' });
    expect(resolveLink('./01-getting-started.md', 'index', all)).toEqual({ slug: '01-getting-started', anchor: null });
    expect(resolveLink('#select', '03-coding', all)).toEqual({ slug: '03-coding', anchor: 'select' });
  });

  it('leaves web addresses and unknown files alone', () => {
    expect(resolveLink('https://www.qdasoftware.org/', 'index', all)).toBeNull();
    expect(resolveLink('mailto:someone@example.org', 'index', all)).toBeNull();
    expect(resolveLink('99-missing.md', 'index', all)).toBeNull();
    expect(resolveLink('../img/en/x.png', 'index', all)).toBeNull();
  });
});

describe('search', () => {
  it('folds accents and case and maps back to the original text', () => {
    const { folded, map } = foldWithMap('Médica Ⅻ');
    expect(folded.startsWith('medica')).toBe(true);
    expect(map[1]).toBe(1);
    expect(map[map.length - 1]).toBe('Médica Ⅻ'.length);
    expect(queryWords('  "In-Vivo"  códigos ')).toEqual(['in', 'vivo', 'codigos']);
  });

  it('finds sections holding every word at word starts, headings first', () => {
    const hits = searchChapters(all, 'vivo own');
    expect(hits.map((h) => [h.slug, h.anchor])).toEqual([['03-coding', 'in-vivo']]);
    expect(hits[0]!.heading).toBe('In-vivo codes');
    expect(hits[0]!.excerpt.text).toContain('own words');
  });

  it('needs every word in the same section, and two letters', () => {
    expect(searchChapters(all, 'mouse vivo')).toEqual([]);
    expect(searchChapters(all, 'a')).toEqual([]);
    expect(searchChapters(all, 'ouse')).toEqual([]);
  });

  it('matches whatever the accents', () => {
    expect(searchChapters(all, 'MEDICA').map((h) => h.anchor)).toEqual(['passphrase']);
    expect(searchChapters(all, 'médica').map((h) => h.anchor)).toEqual(['passphrase']);
  });

  it('ranks sections whose heading holds the words first', () => {
    const hits = searchChapters(all, 'code');
    expect(hits[0]!.anchor).toBe('select');
    expect(hits.length).toBeGreaterThan(1);
  });

  it('marks the words found in the excerpt', () => {
    const e = makeExcerpt('Coding is marking a passage, code by code.', ['cod']);
    expect(e.marks.map(([s, x]) => e.text.slice(s, x))).toEqual(['Cod', 'cod', 'cod']);
    expect(e.cutStart).toBe(false);
  });

  it('cuts long paragraphs around the first hit, at spaces', () => {
    const text = `${'lorem ipsum '.repeat(40)}the needle is here ${'dolor sit '.repeat(40)}`;
    const e = makeExcerpt(text, ['needle'], 80);
    expect(e.cutStart).toBe(true);
    expect(e.cutEnd).toBe(true);
    expect(e.text.length).toBeLessThanOrEqual(80);
    expect(e.text).toContain('needle');
    expect(e.text.startsWith(' ')).toBe(false);
    const [s, x] = e.marks[0]!;
    expect(e.text.slice(s, x)).toBe('needle');
  });
});

describe('currentSection', () => {
  it('is the last heading above the reading line', () => {
    const tops = [
      { anchor: 'a', top: -400 },
      { anchor: 'b', top: 50 },
      { anchor: 'c', top: 600 },
    ];
    expect(currentSection(tops, 100)).toBe('b');
    expect(currentSection(tops, 10)).toBe('a');
    expect(currentSection([{ anchor: 'a', top: 300 }], 100)).toBeNull();
  });
});

describe('rendering helpers', () => {
  it('nests list items by depth', () => {
    const blocks = parseMarkdown('1. One\n2. Two\n   - nested\n   - nested 2\n3. Three');
    const list = blocks[0]!;
    if (list.t !== 'list') throw new Error('not a list');
    const tree = listTree(list.items);
    expect(tree).toHaveLength(3);
    expect(tree[1]!.children).toHaveLength(2);
    expect(tree[2]!.children).toHaveLength(0);
  });

  it('joins consecutive quote lines into one note', () => {
    const groups = groupBlocks(parseMarkdown('Para\n\n> one\n> two\n\nAfter\n\n> three'));
    expect(groups.map((g) => (g.t === 'quotes' ? g.items.length : g.b.t))).toEqual(['para', 2, 'para', 1]);
  });

  it('recognises keys written as code', () => {
    for (const k of ['Ctrl+K', 'Ctrl+Shift+Z', 'Shift+F10', 'F2', 'Enter', 'Esc', '1', '?', 'Alt+←', '⌘', 'Ctrl+Space', '1–9']) expect(isKeyLabel(k), k).toBe(true);
    for (const k of ['## heading', '**bold**', '.trama', 'Barriers/Time', 'garden*', 'Ctrl+', 'docs/spec/refi-qda.md', 'trust family']) expect(isKeyLabel(k), k).toBe(false);
    expect(macKeys('Ctrl+Shift+Z')).toBe('⇧⌘Z');
    expect(macKeys('Alt+Enter')).toBe('⌥Enter');
  });

  it('writes shortcuts for each system', () => {
    expect(formatKeys({ mod: true, shift: true, key: 'Z' }, false)).toBe('Ctrl+Shift+Z');
    expect(formatKeys({ mod: true, shift: true, key: 'Z' }, true)).toBe('⇧⌘Z');
    expect(formatKeys({ alt: true, shift: true, key: '←' }, false)).toBe('Alt+Shift+←');
    expect(formatKeys({ key: 'Enter' }, true)).toBe('↩');
  });
});

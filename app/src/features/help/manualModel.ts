import { type Block, type Inline, inlineText, parseMarkdown } from '../../core/text/markdown';

// The manual as Help shows it: chapters parsed from docs/manual/<lang>/*.md, their sections,
// search across them, and the topics other screens link to. Pure: the bundling of the files
// lives in manual.ts, so this runs in Vitest with any text.

/** Chapter files in reading order. A chapter's slug is its file name without `.md`. */
export const CHAPTER_FILES = [
  'index.md',
  '01-getting-started.md',
  '02-documents.md',
  '03-coding.md',
  '04-codebook.md',
  '05-retrieval-and-memos.md',
  '06-cases-and-attributes.md',
  '07-analysis.md',
  '08-teamwork-and-agreement.md',
  '09-exchange.md',
  '10-privacy-and-security.md',
  'glossary.md',
] as const;

/** The keyboard shortcuts reference: not a Markdown chapter but a view of its own. */
export const SHORTCUTS_SLUG = 'shortcuts';

export interface Section {
  level: number;
  title: string;
  /** The heading's anchor (`<a id>` before it), or one made from its title. */
  anchor: string;
}

export interface Chapter {
  slug: string;
  file: string;
  /** 1 for 01-…; null for the index and the glossary. */
  number: number | null;
  title: string;
  blocks: Block[];
  /** Level-2 and level-3 headings, in order. */
  sections: Section[];
}

export const slugOfFile = (file: string): string => file.replace(/\.md$/i, '');

/** "03-coding" → "coding": topics may leave out the number. */
const bareSlug = (slug: string): string => slug.replace(/^\d+-/, '');

/** An anchor made from a heading: lower case, accents dropped, words joined by hyphens. */
export function anchorFromTitle(title: string): string {
  return (
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

/**
 * Parses one chapter. Headings without an `<a id>` get an anchor from their title (unique
 * within the chapter), written back into the blocks so the rendered heading carries it too.
 */
export function chapterFrom(file: string, src: string): Chapter {
  const parsed = parseMarkdown(src);
  const used = new Set<string>();
  for (const b of parsed) if (b.t === 'heading' && b.anchor) used.add(b.anchor);
  const blocks: Block[] = parsed.map((b) => {
    if (b.t !== 'heading' || b.anchor || b.level === 1) return b;
    const base = anchorFromTitle(inlineText(b.c));
    let anchor = base;
    for (let n = 2; used.has(anchor); n++) anchor = `${base}-${n}`;
    used.add(anchor);
    return { ...b, anchor };
  });
  const h1 = blocks.find((b): b is Extract<Block, { t: 'heading' }> => b.t === 'heading' && b.level === 1);
  const slug = slugOfFile(file);
  const num = /^(\d+)-/.exec(slug);
  const sections: Section[] = [];
  for (const b of blocks) {
    if (b.t === 'heading' && (b.level === 2 || b.level === 3) && b.anchor) sections.push({ level: b.level, title: inlineText(b.c), anchor: b.anchor });
  }
  return { slug, file, number: num ? Number(num[1]) : null, title: h1 ? inlineText(h1.c) : slug, blocks, sections };
}

/**
 * Builds a language's chapters from the sources, falling back to English chapter by chapter.
 * `sources` maps "<lang>/<file>" to Markdown.
 */
export function buildChapters(sources: Readonly<Record<string, string>>, locale: string): Chapter[] {
  const out: Chapter[] = [];
  for (const file of CHAPTER_FILES) {
    const src = sources[`${locale}/${file}`] ?? sources[`en/${file}`];
    if (src !== undefined) out.push(chapterFrom(file, src));
  }
  return out;
}

// ── Topics ───────────────────────────────────────────────────────────────────────────

export interface Place {
  slug: string;
  anchor: string | null;
}

/**
 * Where a topic opens. A topic is "<chapter>#<anchor>", "<chapter>" or "#<anchor>"; the
 * chapter may leave out its number ("coding#in-vivo" = "03-coding#in-vivo"), and a bare word
 * that names no chapter is tried as an anchor anywhere. Unknown anchors open the chapter at the
 * top; unknown chapters give null.
 */
export function resolveTopic(topic: string | null | undefined, chapters: readonly Chapter[]): Place | null {
  const raw = (topic ?? '').trim();
  if (!raw) return null;
  const hash = raw.indexOf('#');
  const head = (hash >= 0 ? raw.slice(0, hash) : raw).replace(/\.md$/i, '').toLowerCase();
  const anchor = hash >= 0 ? raw.slice(hash + 1) || null : null;
  if (head === SHORTCUTS_SLUG) return { slug: SHORTCUTS_SLUG, anchor };
  const hasAnchor = (ch: Chapter, a: string) => ch.sections.some((s) => s.anchor === a);
  if (head) {
    const ch = chapters.find((c) => c.slug === head) ?? chapters.find((c) => bareSlug(c.slug) === head);
    if (ch) return { slug: ch.slug, anchor: anchor && hasAnchor(ch, anchor) ? anchor : null };
    if (anchor) return null;
  }
  const wanted = anchor ?? head;
  const ch = chapters.find((c) => hasAnchor(c, wanted));
  return ch ? { slug: ch.slug, anchor: wanted } : null;
}

export const topicOf = (p: Place): string => (p.anchor ? `${p.slug}#${p.anchor}` : p.slug);

/**
 * Resolves a link written in the manual relative to the chapter it is in: "03-coding.md#x",
 * "#x", "glossary.md". Null for anything else (a web address, an image).
 */
export function resolveLink(href: string, from: string, chapters: readonly Chapter[]): Place | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  const hash = href.indexOf('#');
  const path = hash >= 0 ? href.slice(0, hash) : href;
  const anchor = hash >= 0 ? href.slice(hash + 1) || null : null;
  if (!path) return anchor ? { slug: from, anchor } : null;
  const file = path.replace(/^\.\//, '');
  if (!/^[\w-]+\.md$/i.test(file)) return null;
  const ch = chapters.find((c) => c.file === file);
  return ch ? { slug: ch.slug, anchor } : null;
}

/**
 * The topics other screens link to (a "?" button, F1). Values are topics for
 * `{ name: 'help', topic }`; the manual test checks every one resolves in every language.
 */
export const HELP_TOPICS = {
  start: '01-getting-started',
  welcome: '01-getting-started#first-run',
  passphrase: '01-getting-started#passphrase',
  recoveryPhrase: '01-getting-started#recovery-phrase',
  unlock: '01-getting-started#lock',
  projects: '01-getting-started#projects',
  example: '01-getting-started#example',
  settings: '01-getting-started#settings',
  shortcuts: SHORTCUTS_SLUG,
  documents: '02-documents#documents',
  import: '02-documents#import',
  transcripts: '02-documents#transcripts',
  surveys: '02-documents#surveys',
  groups: '02-documents#groups',
  coding: '03-coding#select',
  codesPanel: '03-coding#codes-panel',
  inVivo: '03-coding#in-vivo',
  stripes: '03-coding#stripes',
  editText: '03-coding#edit-text',
  recording: '03-coding#recording',
  codebook: '04-codebook#hierarchy',
  definitions: '04-codebook#definitions',
  mergeCodes: '04-codebook#merge-split',
  codebookFiles: '04-codebook#codebook-files',
  segments: '05-retrieval-and-memos#segments',
  memos: '05-retrieval-and-memos#memos',
  cases: '06-cases-and-attributes#cases',
  attributes: '06-cases-and-attributes#attributes',
  importAttributes: '06-cases-and-attributes#import-attributes',
  search: '07-analysis#search',
  cooccurrence: '07-analysis#cooccurrence',
  matrix: '07-analysis#matrix',
  crosstab: '07-analysis#crosstab',
  words: '07-analysis#words',
  charts: '07-analysis#charts',
  team: '08-teamwork-and-agreement#copies',
  merge: '08-teamwork-and-agreement#merge',
  agreement: '08-teamwork-and-agreement#compare',
  statistics: '08-teamwork-and-agreement#statistics',
  exchange: '09-exchange',
  qdpxImport: '09-exchange#import-qdpx',
  qdpxExport: '09-exchange#export-qdpx',
  tramaFile: '09-exchange#trama-file',
  privacy: '10-privacy-and-security',
  encryption: '10-privacy-and-security#encryption',
  backups: '10-privacy-and-security#backups',
  pseudonymisation: '10-privacy-and-security#pseudonymisation',
  auditTrail: '10-privacy-and-security#audit-trail',
  ethics: '10-privacy-and-security#ethics',
  glossary: 'glossary',
} as const;

export type HelpTopic = keyof typeof HELP_TOPICS;

/** The manual's section for each screen of an open project (for a "?" or F1 on that screen). */
export const ROUTE_TOPICS = {
  workbench: HELP_TOPICS.coding,
  codes: HELP_TOPICS.codebook,
  segments: HELP_TOPICS.segments,
  memos: HELP_TOPICS.memos,
  cases: HELP_TOPICS.cases,
  analysis: '07-analysis',
  agreement: HELP_TOPICS.agreement,
  import: HELP_TOPICS.import,
  project: HELP_TOPICS.backups,
  pseudonyms: HELP_TOPICS.pseudonymisation,
  log: HELP_TOPICS.auditTrail,
  settings: HELP_TOPICS.settings,
  help: 'index',
} as const;

// ── Search ───────────────────────────────────────────────────────────────────────────

/** Text with the stretches to highlight, as [start, end) offsets into `text`. */
export interface Excerpt {
  text: string;
  marks: [number, number][];
  /** The excerpt starts or ends inside the paragraph (show an ellipsis). */
  cutStart: boolean;
  cutEnd: boolean;
}

export interface SearchHit {
  slug: string;
  chapter: string;
  heading: string;
  /** Where to open: the section's anchor (null: the top of the chapter). */
  anchor: string | null;
  excerpt: Excerpt;
}

/**
 * Lower case without accents, keeping a map back to the original: `map[i]` is the offset in
 * `s` of the folded character `i` (with one extra entry for the end).
 */
export function foldWithMap(s: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const f = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (let k = 0; k < f.length; k++) map.push(i);
    folded += f;
    i += ch.length;
  }
  map.push(s.length);
  return { folded, map };
}

/** The words of a query, folded; quotes and punctuation are ignored. */
export function queryWords(q: string): string[] {
  return foldWithMap(q)
    .folded.split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const letter = /[\p{L}\p{N}]/u;

/** Offsets in `folded` where `word` starts a word. */
function wordStarts(folded: string, word: string): number[] {
  const out: number[] = [];
  for (let at = folded.indexOf(word); at !== -1; at = folded.indexOf(word, at + 1)) {
    if (at === 0 || !letter.test(folded[at - 1]!)) out.push(at);
  }
  return out;
}

const hasWord = (folded: string, word: string) => wordStarts(folded, word).length > 0;

/**
 * A window of about `width` characters of `text` around the first query word found, cut at
 * spaces, with every occurrence of every word (at a word start) marked.
 */
export function makeExcerpt(text: string, words: readonly string[], width = 160): Excerpt {
  const { folded, map } = foldWithMap(text);
  const marks: [number, number][] = [];
  for (const w of words) {
    for (const at of wordStarts(folded, w)) marks.push([map[at]!, map[at + w.length]!]);
  }
  marks.sort((a, b) => a[0] - b[0]);
  const first = marks[0]?.[0] ?? 0;
  let start = 0;
  let end = text.length;
  if (text.length > width) {
    start = Math.max(0, first - Math.floor(width / 3));
    end = Math.min(text.length, start + width);
    start = Math.max(0, end - width);
    if (start > 0) {
      const sp = text.indexOf(' ', start);
      if (sp !== -1 && sp < first) start = sp + 1;
    }
    if (end < text.length) {
      const sp = text.lastIndexOf(' ', end);
      if (sp > first) end = sp;
    }
  }
  const kept = marks
    .filter(([s, e]) => s >= start && e <= end)
    .map(([s, e]) => [s - start, e - start] as [number, number])
    // Overlapping marks (a word that is a prefix of another) join into one.
    .reduce<[number, number][]>((acc, m) => {
      const last = acc[acc.length - 1];
      if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]);
      else acc.push([m[0], m[1]]);
      return acc;
    }, []);
  return { text: text.slice(start, end), marks: kept, cutStart: start > 0, cutEnd: end < text.length };
}

export function blockText(b: Block): string {
  switch (b.t) {
    case 'heading':
    case 'para':
    case 'quote':
      return inlineText(b.c);
    case 'list':
      return b.items.map((i) => inlineText(i.c)).join(' · ');
    case 'table':
      return [b.head, ...b.rows].map((row) => row.map((c: Inline[]) => inlineText(c)).join(' · ')).join(' · ');
    case 'code':
      return b.v;
    case 'image':
      return b.alt;
    default:
      return '';
  }
}

export const MIN_QUERY = 2;
export const MAX_HITS = 40;

/**
 * Sections (a heading and what follows, up to the next heading) holding every word of `q` at
 * the start of a word, accents and case ignored. Sections whose heading holds more of the words
 * come first, then reading order. The excerpt is the paragraph holding most of the words.
 */
export function searchChapters(chapters: readonly Chapter[], q: string): SearchHit[] {
  const words = queryWords(q);
  if (words.join('').length < MIN_QUERY) return [];
  const hits: (SearchHit & { score: number; order: number })[] = [];
  for (const ch of chapters) {
    let heading = ch.title;
    let anchor: string | null = null;
    let texts: string[] = [];
    const close = () => {
      const body = texts.filter(Boolean);
      const all = foldWithMap([heading, ...body].join('\n')).folded;
      if (!words.every((w) => hasWord(all, w))) return;
      const count = (s: string) => {
        const f = foldWithMap(s).folded;
        return words.filter((w) => hasWord(f, w)).length;
      };
      let best = body[0] ?? '';
      let bestN = -1;
      for (const t of body) {
        const n = count(t);
        if (n > bestN) {
          best = t;
          bestN = n;
        }
      }
      const headScore = count(heading);
      hits.push({
        slug: ch.slug,
        chapter: ch.title,
        heading,
        anchor,
        excerpt: makeExcerpt(best, words),
        score: headScore * 10 + (headScore === words.length ? 5 : 0),
        order: hits.length,
      });
    };
    for (const b of ch.blocks) {
      if (b.t === 'heading' && b.level >= 2) {
        close();
        heading = inlineText(b.c);
        anchor = b.anchor;
        texts = [];
      } else if (b.t !== 'heading') {
        texts.push(blockText(b));
      }
    }
    close();
  }
  hits.sort((a, b) => b.score - a.score || a.order - b.order);
  return hits.slice(0, MAX_HITS).map(({ score: _s, order: _o, ...h }) => h);
}

/** The section a reader is in: the last heading at or above `offset` among `tops` (anchor → y). */
export function currentSection(tops: readonly { anchor: string; top: number }[], offset: number): string | null {
  let cur: string | null = null;
  for (const t of tops) {
    if (t.top <= offset) cur = t.anchor;
    else break;
  }
  return cur;
}

// Memos as the Memos screen and the memo editor see them: what each is about, finding and
// sorting them, a plain excerpt of the body, light Markdown formatting while writing, and the
// export of all memos (Markdown, Word) grouped by what they are about.

import type { Block, ReportDocument, Run } from '../../core/export/office';
import { parseHlc } from '../../core/hlc';
import type { Memo, MemoTarget, MemoTargetKind } from '../../core/model/types';
import { type Inline as MdInline, parseMarkdown } from '../../core/text/markdown';
import { fold } from '../../core/text/normalize';

// ---------------------------------------------------------------------------------------------
// Targets

/** What a memo is about, resolved to a name. `missing`: the record was deleted. */
export interface TargetInfo {
  kind: MemoTargetKind;
  id: string | null;
  /** Document, code or case name; for a coded segment its quoted text; '' for the project. */
  label: string;
  /** For a coded segment: its code and document, so the chip can say where it is. */
  detail?: string;
  color?: string | null;
  missing: boolean;
  /** Where the jump link goes, when there is one. */
  docId?: string;
  span?: { start: number; end: number };
}

export interface TargetLookup {
  document(id: string): { name: string; color: string | null } | undefined;
  code(id: string): { name: string; color: string } | undefined;
  coding(id: string): { text: string; code_id: string; document_id: string; start: number; end: number } | undefined;
  case(id: string): { name: string; color: string | null } | undefined;
}

export function resolveTarget(target: MemoTarget, look: TargetLookup): TargetInfo {
  switch (target.kind) {
    case 'project':
      return { kind: 'project', id: null, label: '', missing: false };
    case 'document': {
      const d = look.document(target.id);
      return { kind: 'document', id: target.id, label: d?.name ?? '', color: d?.color ?? null, missing: !d, docId: target.id };
    }
    case 'code': {
      const c = look.code(target.id);
      return { kind: 'code', id: target.id, label: c?.name ?? '', color: c?.color ?? null, missing: !c };
    }
    case 'case': {
      const c = look.case(target.id);
      return { kind: 'case', id: target.id, label: c?.name ?? '', color: c?.color ?? null, missing: !c };
    }
    case 'coding': {
      const c = look.coding(target.id);
      if (!c) return { kind: 'coding', id: target.id, label: '', missing: true };
      const code = look.code(c.code_id);
      const doc = look.document(c.document_id);
      return {
        kind: 'coding',
        id: target.id,
        label: shorten(c.text.replace(/\s+/g, ' ').trim(), 80),
        detail: [code?.name, doc?.name].filter(Boolean).join(' · '),
        color: code?.color ?? null,
        missing: false,
        docId: c.document_id,
        span: { start: c.start, end: c.end },
      };
    }
  }
}

/** At most `max` characters, cut at a word when one is near, with an ellipsis. */
export function shorten(s: string, max: number): string {
  if (s.length <= max) return s;
  let cut = max - 1;
  const space = s.lastIndexOf(' ', cut);
  if (space > max * 0.5) cut = space;
  return `${s.slice(0, cut).trimEnd()}…`;
}

// ---------------------------------------------------------------------------------------------
// Listing

export type MemoKindFilter = 'all' | MemoTargetKind;

/** Milliseconds of a record's last change (0 when the stamp cannot be read). */
export function hlcMs(hlc: string): number {
  try {
    return parseHlc(hlc).ms;
  } catch {
    return 0;
  }
}

/** Most recently updated first; ties by id so the order is stable. */
export function sortByUpdated<T extends Pick<Memo, 'id' | 'updated_at_hlc'>>(memos: readonly T[]): T[] {
  return [...memos].sort((a, b) => (a.updated_at_hlc < b.updated_at_hlc ? 1 : a.updated_at_hlc > b.updated_at_hlc ? -1 : a.id < b.id ? -1 : 1));
}

/**
 * Memos of one kind (or all) whose title, body or target name holds every word of the query
 * (case and accents ignored), most recently updated first.
 */
export function filterMemos<T extends Pick<Memo, 'id' | 'title' | 'body' | 'target' | 'updated_at_hlc'>>(
  memos: readonly T[],
  opts: { kind: MemoKindFilter; query: string; targetLabel?: (m: T) => string },
): T[] {
  const words = fold(opts.query).split(' ').filter(Boolean);
  const out = memos.filter((m) => {
    if (opts.kind !== 'all' && m.target.kind !== opts.kind) return false;
    if (!words.length) return true;
    const hay = fold(`${m.title}\n${m.body}\n${opts.targetLabel?.(m) ?? ''}`);
    return words.every((w) => hay.includes(w));
  });
  return sortByUpdated(out);
}

/** Counts per target kind, for the filter's options. */
export function countByKind(memos: readonly Pick<Memo, 'target'>[]): Record<MemoKindFilter, number> {
  const out: Record<MemoKindFilter, number> = { all: memos.length, project: 0, document: 0, code: 0, coding: 0, case: 0 };
  for (const m of memos) out[m.target.kind]++;
  return out;
}

/** The body as plain text (Markdown marks removed), on one line, for list excerpts. */
export function plainExcerpt(body: string, max = 160): string {
  const text = body
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
        .replace(/^\s*>\s?/, ''),
    )
    .join(' ')
    .replace(/(\*\*|__|\*|_|~~|`)(?=\S)([^]*?\S)\1/g, '$2')
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return shorten(text, max);
}

/** A memo's title for display: its own, else the start of its body, else ''. */
export function memoTitle(m: Pick<Memo, 'title' | 'body'>): string {
  return m.title.trim() || plainExcerpt(m.body, 60);
}

// ---------------------------------------------------------------------------------------------
// Formatting while writing

export type Format = 'bold' | 'italic' | 'heading' | 'bullets' | 'numbers';

export interface Edit {
  text: string;
  selStart: number;
  selEnd: number;
}

/**
 * Applies light Markdown to the selection: **bold** / *italic* around it (or removed when
 * already there), or a heading / list mark at the start of each selected line (toggled).
 */
export function applyFormat(text: string, selStart: number, selEnd: number, format: Format): Edit {
  const s = Math.max(0, Math.min(selStart, selEnd, text.length));
  const e = Math.min(text.length, Math.max(selStart, selEnd));
  if (format === 'bold' || format === 'italic') {
    const mark = format === 'bold' ? '**' : '*';
    const n = mark.length;
    const outer = text.slice(s - n, s) === mark && text.slice(e, e + n) === mark;
    // For italic, "**x**" around is bold, not italic.
    const boldAround = format === 'italic' && text.slice(s - 2, s) === '**' && text.slice(e, e + 2) === '**' && text.slice(s - 3, s) !== '***';
    if (outer && !boldAround) {
      return { text: text.slice(0, s - n) + text.slice(s, e) + text.slice(e + n), selStart: s - n, selEnd: e - n };
    }
    const inner = text.slice(s, e);
    if (inner.length > 2 * n && inner.startsWith(mark) && inner.endsWith(mark) && !(format === 'italic' && inner.startsWith('**'))) {
      const stripped = inner.slice(n, -n);
      return { text: text.slice(0, s) + stripped + text.slice(e), selStart: s, selEnd: s + stripped.length };
    }
    return { text: `${text.slice(0, s)}${mark}${inner}${mark}${text.slice(e)}`, selStart: s + n, selEnd: e + n };
  }
  // Line formats: every line the selection touches.
  const lineStart = text.lastIndexOf('\n', s - 1) + 1;
  let lineEnd = text.indexOf('\n', e > s && text[e - 1] === '\n' ? e - 1 : e);
  if (lineEnd < 0) lineEnd = text.length;
  const lines = text.slice(lineStart, lineEnd).split('\n');
  const pattern = format === 'heading' ? /^#{1,6}\s+/ : format === 'bullets' ? /^\s*[-*+]\s+/ : /^\s*\d+[.)]\s+/;
  const content = lines.filter((l) => l.trim());
  const allHave = content.length > 0 && content.every((l) => pattern.test(l));
  let k = 0;
  const next = lines.map((l) => {
    if (!l.trim() && lines.length > 1) return l;
    if (allHave) return l.replace(pattern, '');
    const bare = l.replace(/^#{1,6}\s+|^\s*[-*+]\s+|^\s*\d+[.)]\s+/, '');
    k++;
    return format === 'heading' ? `## ${bare}` : format === 'bullets' ? `- ${bare}` : `${k}. ${bare}`;
  });
  const replaced = next.join('\n');
  const out = text.slice(0, lineStart) + replaced + text.slice(lineEnd);
  const delta = replaced.length - (lineEnd - lineStart);
  return lines.length === 1 && s === e
    ? { text: out, selStart: Math.max(lineStart, s + delta), selEnd: Math.max(lineStart, s + delta) }
    : { text: out, selStart: lineStart, selEnd: lineEnd + delta };
}

// ---------------------------------------------------------------------------------------------
// Export

export const KIND_ORDER: readonly MemoTargetKind[] = ['project', 'document', 'code', 'coding', 'case'];

export interface MemoExportItem {
  memo: Pick<Memo, 'id' | 'title' | 'body' | 'target' | 'created_at' | 'updated_at_hlc'>;
  target: TargetInfo;
  coderName: string;
  /** Last change, already formatted for the reader. */
  updated: string;
}

export interface MemoExportLabels {
  title: string;
  subtitle: string;
  /** Heading of each target kind ("Project memos", "Document memos"…). */
  group: Record<MemoTargetKind, string>;
  /** "About: {name}" line under a memo's title. */
  about: (t: TargetInfo) => string;
  /** "Ana · updated 5 Oct 2026" */
  byline: (item: MemoExportItem) => string;
  untitled: string;
  lang?: string;
  generator?: string;
}

/** Memos grouped by target kind (in KIND_ORDER), each group by target name, then most recent first. */
export function groupForExport(items: readonly MemoExportItem[]): { kind: MemoTargetKind; items: MemoExportItem[] }[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return KIND_ORDER.map((kind) => ({
    kind,
    items: items
      .filter((i) => i.memo.target.kind === kind)
      .sort(
        (a, b) =>
          collator.compare(a.target.label, b.target.label) ||
          (a.memo.updated_at_hlc < b.memo.updated_at_hlc ? 1 : a.memo.updated_at_hlc > b.memo.updated_at_hlc ? -1 : 0),
      ),
  })).filter((g) => g.items.length > 0);
}

/** One Markdown file: a heading per target kind, then each memo with its title, target and body. */
export function memosMarkdown(items: readonly MemoExportItem[], labels: MemoExportLabels): string {
  const out: string[] = [`# ${labels.title}`, '', labels.subtitle, ''];
  for (const g of groupForExport(items)) {
    out.push(`## ${labels.group[g.kind]}`, '');
    for (const i of g.items) {
      out.push(`### ${i.memo.title.trim() || labels.untitled}`, '');
      const about = labels.about(i.target);
      out.push(`*${[about, labels.byline(i)].filter(Boolean).join(' · ')}*`, '');
      // The memo's own headings sit below the memo's title.
      const body = i.memo.body.replace(/\r\n?/g, '\n').replace(/^(#{1,6})(\s)/gm, (_m, h: string, sp: string) => `${'#'.repeat(Math.min(6, h.length + 3))}${sp}`);
      if (body.trim()) out.push(body.trim(), '');
    }
  }
  return `${out.join('\n').trimEnd()}\n`;
}

function runsOf(nodes: MdInline[], style: { bold?: boolean; italic?: boolean } = {}): Run[] {
  const out: Run[] = [];
  for (const n of nodes) {
    switch (n.t) {
      case 'text':
      case 'code':
        out.push({ text: n.v, ...style, ...(n.t === 'code' ? { mono: true } : {}) });
        break;
      case 'bold':
        out.push(...runsOf(n.c, { ...style, bold: true }));
        break;
      case 'italic':
        out.push(...runsOf(n.c, { ...style, italic: true }));
        break;
      case 'strike':
      case 'link':
        out.push(...runsOf(n.c, style));
        break;
    }
  }
  return out;
}

/** A memo body (light Markdown) as report blocks. Headings become level 3. */
export function markdownBlocks(body: string): Block[] {
  const out: Block[] = [];
  for (const b of parseMarkdown(body, { breaks: true })) {
    switch (b.t) {
      case 'heading':
        out.push({ type: 'heading', level: 3, text: runsOf(b.c) });
        break;
      case 'para':
        out.push({ type: 'paragraph', text: runsOf(b.c) });
        break;
      case 'quote':
        out.push({ type: 'paragraph', text: runsOf(b.c), style: 'quote' });
        break;
      case 'list':
        out.push({ type: 'list', ordered: b.ordered, items: b.items.map((i) => runsOf(i.c)) });
        break;
      case 'code':
        out.push({ type: 'paragraph', text: [{ text: b.v, mono: true }] });
        break;
      case 'table':
        out.push({ type: 'table', header: b.head.map((c) => runsOf(c)), rows: b.rows.map((r) => r.map((c) => runsOf(c))) });
        break;
      case 'image':
        if (b.alt) out.push({ type: 'paragraph', text: [{ text: b.alt, italic: true }] });
        break;
      case 'rule':
        break;
    }
  }
  return out;
}

/** The Word report of all memos: one heading per target kind, one per memo. */
export function memosReport(items: readonly MemoExportItem[], labels: MemoExportLabels): ReportDocument {
  const blocks: Block[] = [];
  for (const g of groupForExport(items)) {
    blocks.push({ type: 'heading', level: 1, text: labels.group[g.kind] });
    for (const i of g.items) {
      blocks.push({ type: 'heading', level: 2, text: i.memo.title.trim() || labels.untitled });
      blocks.push({ type: 'paragraph', text: [labels.about(i.target), labels.byline(i)].filter(Boolean).join(' · '), style: 'small' });
      blocks.push(...markdownBlocks(i.memo.body));
    }
  }
  return { title: labels.title, subtitle: labels.subtitle, lang: labels.lang, generator: labels.generator, blocks };
}

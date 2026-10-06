// Matching the originals of a pseudonymisation key in a text, and planning their replacement.
// Pure: services/pseudonyms.ts applies the plan to documents and other fields.

import type { Pseudonym } from '../model/types';
import type { TextEdit } from './ranges';

const tidy = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

export type Rule = Pick<Pseudonym, 'original' | 'whole_word' | 'case_sensitive'>;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
const WORD_CHAR = '[\\p{L}\\p{N}\\p{M}_]';

/**
 * Where `rule.original` occurs in `text`. Spaces inside the original match any run of spaces or
 * tabs (not line breaks), so "Ana  Lima" is found too; `whole_word` keeps "Ana" out of "Anabela".
 */
export function findMatches(text: string, rule: Rule): { start: number; end: number }[] {
  const original = tidy(rule.original);
  if (!original) return [];
  let src = original.split(' ').map(escapeRe).join('[ \\t\\u00A0]+');
  if (rule.whole_word) src = `(?<!${WORD_CHAR})${src}(?!${WORD_CHAR})`;
  const re = new RegExp(src, rule.case_sensitive ? 'gu' : 'giu');
  const out: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

export interface Planned {
  edits: TextEdit[];
  /** Matches per pseudonym id. */
  counts: Map<string, number>;
  matches: { start: number; end: number; pseudonymId: string }[];
}

/**
 * The replacements for one text: longer originals first, so "Ana Lima" wins over "Ana", and no
 * two replacements overlap. With `protect`, text that already reads as one of the replacements
 * is left alone: applying a key again to text that was pseudonymised already never replaces an
 * original inside its own replacement ("Rui" → "Rui P." must not become "Rui P. P.").
 */
export function planText(text: string, rules: readonly Pseudonym[], opts: { protect?: boolean } = {}): Planned {
  const taken = new Uint8Array(text.length);
  if (opts.protect) {
    for (const r of rules) {
      const rep = r.replacement;
      if (!rep) continue;
      for (let i = text.indexOf(rep); i >= 0; i = text.indexOf(rep, i + 1)) taken.fill(1, i, i + rep.length);
    }
  }
  const counts = new Map<string, number>();
  const matches: Planned['matches'] = [];
  const ordered = [...rules].sort((a, b) => tidy(b.original).length - tidy(a.original).length || (a.created_at < b.created_at ? -1 : 1));
  for (const p of ordered) {
    for (const m of findMatches(text, p)) {
      let free = true;
      for (let i = m.start; i < m.end && free; i++) if (taken[i]) free = false;
      if (!free) continue;
      taken.fill(1, m.start, m.end);
      matches.push({ ...m, pseudonymId: p.id });
      counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
    }
  }
  matches.sort((a, b) => a.start - b.start);
  const byId = new Map(rules.map((r) => [r.id, r]));
  return { edits: matches.map((m) => ({ start: m.start, end: m.end, insert: byId.get(m.pseudonymId)!.replacement })), counts, matches };
}


/** `text` with the rules' originals replaced (longest first, never overlapping). */
export function pseudonymiseText(text: string, rules: readonly Pseudonym[], opts: { protect?: boolean } = {}): string {
  if (!rules.length || !text) return text;
  const { edits } = planText(text, rules, opts);
  if (!edits.length) return text;
  let out = '';
  let at = 0;
  for (const e of edits) {
    out += text.slice(at, e.start) + e.insert;
    at = e.end;
  }
  return out + text.slice(at);
}

/** File names write words apart with separators instead ("Maria_Silva-interview.pdf"): one space each, so positions stay. */
export const fileWords = (name: string): string => name.replace(/[_.+-]/g, ' ');

/** A rule as it matches inside file names: any case, inside words too, separators as spaces. */
const fileRule = <R extends Rule>(p: R): R => ({ ...p, original: fileWords(p.original), whole_word: false, case_sensitive: false });

/** Where the rules' originals occur in a file name (see `fileWords`). */
export function planFileName(name: string, rules: readonly Pseudonym[]): Planned {
  const words = fileWords(name);
  // Whole words as the rule says ("Ana" stays out of "Analysis.docx"), in any case.
  const planned = planText(words, rules.map((p) => ({ ...p, original: fileWords(p.original), case_sensitive: false })));
  const byId = new Map(rules.map((r) => [r.id, r]));
  // A replacement as file-name words: spaces become underscores, characters file systems refuse go.
  const asFile = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, '_');
  return { ...planned, edits: planned.matches.map((m) => ({ start: m.start, end: m.end, insert: asFile(byId.get(m.pseudonymId)!.replacement) })) };
}

/** True when an original of the rules occurs in the file name (see `planFileName`). */
export const fileNameHolds = (name: string, rules: readonly Rule[]): boolean =>
  !!name && rules.some((p) => findMatches(fileWords(name), fileRule(p)).length > 0);

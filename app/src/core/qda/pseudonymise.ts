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
  return planWith(text, rules, findMatches, opts);
}

function planWith(text: string, rules: readonly Pseudonym[], find: (text: string, rule: Rule) => { start: number; end: number }[], opts: { protect?: boolean } = {}): Planned {
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
    for (const m of find(text, p)) {
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

const RE_WORD_CHAR = new RegExp(`^${WORD_CHAR}$`, 'u');
const RE_LOWER = /^\p{Ll}$/u;
const RE_UPPER = /^[\p{Lu}\p{Lt}]$/u;
const RE_DIGIT = /^\p{N}$/u;
const RE_LETTER = /^\p{L}$/u;

/**
 * Whether a word of a file name (as `fileWords` writes it) may start or end at `i`: beside a
 * separator or the ends, and where file names join words without one — "MartaSousa" (a capital
 * after a small letter) and "Marta2" (letters beside digits).
 */
function fileBoundary(words: string, i: number): boolean {
  if (i <= 0 || i >= words.length) return true;
  const a = words[i - 1]!;
  const b = words[i]!;
  if (!RE_WORD_CHAR.test(a) || !RE_WORD_CHAR.test(b)) return true;
  if (RE_LOWER.test(a) && RE_UPPER.test(b)) return true;
  return (RE_LETTER.test(a) && RE_DIGIT.test(b)) || (RE_DIGIT.test(a) && RE_LETTER.test(b));
}

/**
 * Where `rule.original` occurs in a file name, in any case. A space in the original matches any
 * run of separators or none ("Marta Sousa" finds "Marta_Sousa" and "MartaSousa"). With
 * `whole_word`, a match must start and end on a word boundary of the file name (`fileBoundary`),
 * so "Ana" stays out of "Analysis.docx" but is found in "AnaLima.docx".
 */
function fileMatches(name: string, rule: Rule): { start: number; end: number }[] {
  const original = fileWords(tidy(rule.original)).replace(/\s+/g, ' ').trim();
  if (!original) return [];
  const words = fileWords(name);
  const re = new RegExp(original.split(' ').map(escapeRe).join('[ \\t\\u00A0]*'), 'giu');
  const out: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(words))) {
    const start = m.index;
    const end = start + m[0].length;
    if (end === start) {
      re.lastIndex++;
      continue;
    }
    if (rule.whole_word && !(fileBoundary(words, start) && fileBoundary(words, end))) {
      // The next try starts one character on: a later, overlapping match may sit on boundaries.
      re.lastIndex = start + 1;
      continue;
    }
    out.push({ start, end });
  }
  return out;
}

/** Where the rules' originals occur in a file name (see `fileMatches`). */
export function planFileName(name: string, rules: readonly Pseudonym[]): Planned {
  const planned = planWith(name, rules, fileMatches);
  const byId = new Map(rules.map((r) => [r.id, r]));
  // A replacement as file-name words: spaces become underscores, characters file systems refuse go.
  const asFile = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, '_');
  return { ...planned, edits: planned.matches.map((m) => ({ start: m.start, end: m.end, insert: asFile(byId.get(m.pseudonymId)!.replacement) })) };
}

/**
 * True when an original of the rules occurs in the file name, inside words too ("marta" in
 * "consent_martasousa.docx"): exports blank such names, even where `planFileName` leaves them.
 */
export const fileNameHolds = (name: string, rules: readonly Rule[]): boolean =>
  !!name && rules.some((p) => fileMatches(name, { ...p, whole_word: false }).length > 0);

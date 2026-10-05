// Pseudonymisation: the key (original → replacement), suggestions of names to review, a preview
// of what would change, and applying it across every document with codings remapped.
//
// The key is personal data. It never goes into the audit log (which is exported): logs say how
// many replacements were made in which documents, never what was replaced.

import type { Pseudonym } from '../core/model/types';
import { replaceAll, type TextEdit } from '../core/qda/ranges';
import type { ProjectContext } from './context';
import { applyTextEdits } from './documents';
import { combineUndo, commit, need, noopUndo, Plan, q, ServiceError, type Undoable } from './undo';

// ---------------------------------------------------------------------------------------------
// The key

export interface NewPseudonym {
  original: string;
  replacement: string;
  note?: string;
  whole_word?: boolean;
  case_sensitive?: boolean;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const tidy = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

async function checkUnique(ctx: ProjectContext, original: string, exceptId?: string): Promise<void> {
  const o = tidy(original);
  if (!o) throw new ServiceError('invalid_argument', 'the original is required');
  for (const p of await ctx.store.list('pseudonym')) {
    if (p.id !== exceptId && tidy(p.original) === o) throw new ServiceError('invalid_argument', 'this original is already in the key');
  }
}

export async function createPseudonym(ctx: ProjectContext, input: NewPseudonym): Promise<{ pseudonym: Pseudonym; undo: Undoable }> {
  await checkUnique(ctx, input.original);
  const plan = new Plan();
  const id = plan.create('pseudonym', {
    original: tidy(input.original),
    replacement: tidy(input.replacement),
    note: input.note ?? '',
    whole_word: input.whole_word ?? true,
    case_sensitive: input.case_sensitive ?? true,
    applied_at: null,
    applied_count: 0,
  });
  const { saved, undo } = await commit(ctx, plan, { label: 'pseudonym.edit', detail: '', logs: [] });
  return { pseudonym: saved.get('pseudonym', id), undo };
}

export async function updatePseudonym(
  ctx: ProjectContext,
  id: string,
  patch: Partial<Pick<Pseudonym, 'original' | 'replacement' | 'note' | 'whole_word' | 'case_sensitive'>>,
): Promise<{ pseudonym: Pseudonym; undo: Undoable }> {
  const p = await need(ctx, 'pseudonym', id);
  if (patch.original !== undefined) await checkUnique(ctx, patch.original, id);
  const clean = { ...patch };
  if (clean.original !== undefined) clean.original = tidy(clean.original);
  if (clean.replacement !== undefined) clean.replacement = tidy(clean.replacement);
  const plan = new Plan();
  plan.change('pseudonym', p, clean);
  const { saved, undo } = await commit(ctx, plan, { label: 'pseudonym.edit', detail: '', logs: [] });
  return { pseudonym: saved.get('pseudonym', id), undo };
}

/**
 * Deletes an entry of the key. With `erase`, its content is wiped from the database at once
 * (not undoable): a deleted key entry would otherwise keep the original name in its tombstone.
 */
export async function deletePseudonym(ctx: ProjectContext, id: string, opts: { erase?: boolean } = {}): Promise<Undoable> {
  const p = await need(ctx, 'pseudonym', id);
  const plan = new Plan();
  plan.remove('pseudonym', p);
  const { undo } = await commit(ctx, plan, { label: 'pseudonym.edit', detail: '', logs: [] });
  if (!opts.erase) return undo;
  await ctx.store.scrub('pseudonym', [id], (r) => ({
    original: '∅',
    replacement: '∅',
    note: '',
    whole_word: r.whole_word,
    case_sensitive: r.case_sensitive,
    applied_at: null,
    applied_count: 0,
  }));
  return noopUndo('pseudonym.edit');
}

/** The key, sorted by original. */
export async function listPseudonyms(ctx: ProjectContext): Promise<Pseudonym[]> {
  return (await ctx.store.list('pseudonym')).sort((a, b) => collator.compare(a.original, b.original));
}

// ---------------------------------------------------------------------------------------------
// Matching

type Rule = Pick<Pseudonym, 'original' | 'whole_word' | 'case_sensitive'>;

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

interface Planned {
  edits: TextEdit[];
  /** Matches per pseudonym id. */
  counts: Map<string, number>;
  matches: { start: number; end: number; pseudonymId: string }[];
}

/**
 * The replacements for one text: longer originals first, so "Ana Lima" wins over "Ana", and no
 * two replacements overlap.
 */
function planText(text: string, rules: readonly Pseudonym[]): Planned {
  const taken = new Uint8Array(text.length);
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

async function selected(ctx: ProjectContext, ids?: string[]): Promise<Pseudonym[]> {
  const all = await ctx.store.list('pseudonym');
  if (!ids) return all;
  const want = new Set(ids);
  return all.filter((p) => want.has(p.id));
}

export interface PreviewSample {
  pseudonymId: string;
  before: string;
  match: string;
  after: string;
}

export interface PreviewDocument {
  documentId: string;
  name: string;
  count: number;
  /** Up to 3 places with some context, for the researcher to check. */
  samples: PreviewSample[];
}

export interface Preview {
  documents: PreviewDocument[];
  /** Replacements per pseudonym id. */
  counts: Map<string, number>;
  total: number;
}

const CONTEXT = 40;

/** What applying the key (or some entries of it) would replace, per document. Changes nothing. */
export async function preview(ctx: ProjectContext, pseudonymIds?: string[]): Promise<Preview> {
  const rules = await selected(ctx, pseudonymIds);
  const counts = new Map<string, number>();
  const documents: PreviewDocument[] = [];
  let total = 0;
  if (!rules.length) return { documents, counts, total };
  for (const doc of await ctx.store.list('document', { order: 'sort, id' })) {
    const dt = await ctx.store.get('doctext', doc.id);
    if (!dt || dt.deleted) continue;
    const plan = planText(dt.text, rules);
    if (!plan.matches.length) continue;
    for (const [id, n] of plan.counts) counts.set(id, (counts.get(id) ?? 0) + n);
    total += plan.matches.length;
    documents.push({
      documentId: doc.id,
      name: doc.name,
      count: plan.matches.length,
      samples: plan.matches.slice(0, 3).map((m) => ({
        pseudonymId: m.pseudonymId,
        before: dt.text.slice(Math.max(0, m.start - CONTEXT), m.start),
        match: dt.text.slice(m.start, m.end),
        after: dt.text.slice(m.end, m.end + CONTEXT),
      })),
    });
  }
  return { documents, counts, total };
}

export interface ApplyResult {
  replacements: number;
  documents: number;
  /** Codings removed because their whole text was replaced by nothing (never with a non-empty replacement). */
  removedCodings: number;
  undo: Undoable;
}

/**
 * Replaces the originals by their replacements across every document. Each document is edited
 * through `applyTextEdits`, so codings stay on their words (and their text shows the
 * replacement) and transcript timestamps move along.
 */
export interface ApplyOptions {
  /** Called with how many documents are done out of how many, before the first and after each; awaited. */
  onProgress?: (done: number, total: number) => void | Promise<void>;
}

export async function apply(ctx: ProjectContext, pseudonymIds?: string[], opts: ApplyOptions = {}): Promise<ApplyResult> {
  const rules = await selected(ctx, pseudonymIds);
  if (!rules.length) return { replacements: 0, documents: 0, removedCodings: 0, undo: noopUndo('pseudonym.apply') };
  const counts = new Map<string, number>();
  const parts: Undoable[] = [];
  const docNames: string[] = [];
  let replacements = 0;
  let removedCodings = 0;
  const docs = await ctx.store.list('document', { order: 'sort, id' });
  await opts.onProgress?.(0, docs.length);
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i]!;
    const dt = await ctx.store.get('doctext', doc.id);
    const planned = dt && !dt.deleted ? planText(dt.text, rules) : null;
    if (dt && planned?.matches.length) {
      const { edits } = replaceAll(dt.text, planned.edits);
      for (const [id, n] of planned.counts) counts.set(id, (counts.get(id) ?? 0) + n);
      replacements += planned.matches.length;
      if (edits.length) {
        const r = await applyTextEdits(ctx, doc.id, edits, { log: false, current: dt });
        parts.push(r.undo);
        removedCodings += r.removedCodings;
      }
      docNames.push(doc.name);
    }
    // The last step reports once the key's entries are marked applied too.
    if (i + 1 < docs.length) await opts.onProgress?.(i + 1, docs.length);
  }
  const now = new Date().toISOString();
  const plan = new Plan();
  for (const p of rules) plan.change('pseudonym', p, { applied_at: now, applied_count: counts.get(p.id) ?? 0 });
  const shown = docNames.slice(0, 5).map(q).join(', ') + (docNames.length > 5 ? ', …' : '');
  const summary = `×${replacements} → ${shown || '∅'}`;
  const { undo } = await commit(ctx, plan, { label: 'pseudonym.apply', detail: summary, logs: [{ action: 'pseudonym.apply', summary }] });
  parts.push(undo);
  await opts.onProgress?.(docs.length, docs.length);
  return { replacements, documents: docNames.length, removedCodings, undo: combineUndo('pseudonym.apply', summary, parts) };
}

// ---------------------------------------------------------------------------------------------
// Suggestions

// Capitalised words that are rarely names, in the languages of the interface: function words,
// the words people start spoken sentences with ("Now…", "Well…", "Então…", "Bueno…"), fillers,
// days and months. A short list on purpose: suggestions are a starting point the researcher
// reviews, not a detector, and a word that is also a name (Rosa, Will, Grace) stays out of it.
const COMMON = new Set(
  [
    // en
    'i', 'the', 'a', 'an', 'and', 'but', 'or', 'so', 'then', 'this', 'that', 'these', 'those', 'it', 'he', 'she', 'we',
    'they', 'you', 'my', 'our', 'your', 'his', 'her', 'their', 'yes', 'no', 'ok', 'okay', 'well', 'oh', 'mr', 'mrs', 'ms',
    'dr', 'what', 'when', 'where', 'why', 'how', 'who', 'if', 'in', 'on', 'at', 'of', 'for', 'with', 'to', 'is', 'was',
    'not', 'also', 'there', 'here', 'just', 'like', 'yeah', 'um', 'uh', 'god', 'monday', 'tuesday', 'wednesday',
    'thursday', 'friday', 'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
    'september', 'october', 'november', 'december', 'mondays', 'tuesdays', 'wednesdays', 'thursdays', 'fridays', 'saturdays',
    'sundays', 'english', 'portuguese', 'spanish', 'interviewer', 'interviewee',
    'respondent', 'participant', 'speaker', 'facilitator', 'moderator',
    'now', 'maybe', 'actually', 'anyway', 'anyways', 'still', 'sure', 'right', 'alright', 'really', 'because', 'although',
    'though', 'basically', 'honestly', 'obviously', 'perhaps', 'sometimes', 'usually', 'exactly', 'absolutely',
    'definitely', 'probably', 'certainly', 'indeed', 'let', 'after', 'before', 'even', 'only', 'first', 'finally', 'yep',
    'nope', 'nah', 'hmm', 'hm', 'mm', 'mhm', 'mm-hmm', 'uh-huh', 'ah', 'er', 'erm', 'eh', 'hi', 'hello', 'hey', 'thanks',
    'please', 'sorry', 'nothing', 'everything', 'something', 'someone', 'everyone', 'nobody', 'all', 'some', 'every',
    'do', 'did', 'does', 'are', 'were', 'be', 'have', 'had', 'can', 'could', 'would', 'should', 'ma’am', 'y’all',
    // pt
    'o', 'os', 'as', 'um', 'uma', 'e', 'mas', 'então', 'eu', 'ele', 'ela', 'nós', 'eles', 'elas', 'você', 'sim', 'não',
    'isso', 'isto', 'esse', 'essa', 'este', 'esta', 'aqui', 'ali', 'quando', 'onde', 'porque', 'como', 'que', 'se',
    'também', 'já', 'bem', 'pois', 'entrevistador', 'entrevistadora', 'entrevistado', 'entrevistada', 'participante',
    'sr', 'sra', 'dra', 'deus', 'pronto', 'olha', 'portanto', 'agora', 'talvez', 'claro', 'depois', 'antes', 'bom',
    'exato', 'exatamente', 'enfim', 'aliás', 'hum', 'nada', 'mesmo', 'realmente', 'obrigado', 'obrigada', 'acho', 'ora',
    'tipo', 'lá', 'cá', 'só', 'nem', 'ou', 'mais', 'muito', 'tudo', 'todos', 'ninguém', 'alguém', 'sempre', 'nunca',
    'ainda', 'assim', 'primeiro', 'desculpe', 'olá', 'hoje', 'ontem', 'amanhã', 'pá', 'epá', 'quer', 'na', 'no', 'nas', 'nos',
    'em', 'ao', 'aos', 'à', 'pelo', 'pela', 'meu', 'minha', 'seu', 'sua', 'foi', 'era', 'há', 'é', 'são', 'está', 'estava',
    'tem', 'tinha', 'qual', 'quem', 'senhor', 'senhora', 'dona', 'moderador', 'moderadora', 'inglês', 'espanhol', 'português',
    // es
    'el', 'la', 'los', 'las', 'una', 'y', 'pero', 'entonces', 'yo', 'él', 'nosotros', 'ellos', 'ellas', 'usted', 'sí',
    'eso', 'esto', 'ese', 'aquí', 'allí', 'cuando', 'donde', 'si', 'ya', 'bueno', 'pues', 'dios', 'vale', 'mira',
    'ahora', 'quizás', 'quizá', 'oye', 'vamos', 'bien', 'después', 'luego', 'además', 'también', 'hombre', 'venga',
    'exacto', 'exactamente', 'vaya', 'gracias', 'hola', 'total', 'sea', 'digamos', 'igual', 'todo', 'todos', 'nadie',
    'alguien', 'siempre', 'nunca', 'primero', 'todavía', 'aún', 'así', 'perdón', 'perdone', 'hoy', 'ayer', 'mañana',
    'muy', 'más', 'ni', 'em', 'ehm', 'mi', 'mis', 'tu', 'su', 'sus', 'en', 'es', 'al', 'lo', 'le', 'les', 'por', 'para',
    'con', 'sin', 'un', 'unos', 'unas', 'me', 'te', 'nos', 'fue', 'hay', 'ha', 'he', 'son', 'está', 'estaba', 'tan', 'qué',
    'cómo', 'dónde', 'cuándo', 'quién', 'señor', 'señora', 'don', 'doña', 'inglés', 'español', 'portugués',
  ].map((w) => w.normalize('NFC')),
);
// Lower-case particles inside names: "Maria da Silva", "Juan de la Cruz", "Ludwig van Beethoven".
const PARTICLES = new Set(['da', 'de', 'do', 'das', 'dos', 'del', 'di', 'du', 'van', 'von', 'der', 'den', 'la', 'le']);

const RE_WORD = /[\p{L}\p{M}][\p{L}\p{M}'’-]*/gu;
const RE_CAPITALISED = /^[\p{Lu}\p{Lt}][\p{Ll}\p{M}'’-]/u;
// English contractions are never names: I’m, I'll, We're, I've, She'd, Don't, Can't…
const RE_CONTRACTION = /['’](?:m|ll|re|ve|d|t)$/iu;
// A possessive (or "it's") counts as the word without it: Ana's → Ana, It's → It.
const RE_POSSESSIVE = /^(.+?)['’]s$/iu;
const isCommon = (w: string) => COMMON.has(w.normalize('NFC').replace(/'/g, '’').toLocaleLowerCase());

/** A word as matched by RE_WORD: trailing marks dropped, a possessive taken off; null for a contraction. */
function wordOf(raw: string): string | null {
  const w = raw.replace(/['’-]+$/, '');
  if (RE_CONTRACTION.test(w)) return null;
  return RE_POSSESSIVE.exec(w)?.[1] ?? w;
}

export interface Candidate {
  text: string;
  count: number;
}

/**
 * Likely names in the texts, for the researcher to review: capitalised words and runs of them
 * ("Ana Lima", "Maria da Silva") that are not just the first word of a sentence, with how often
 * each occurs. A word seen only at the start of sentences is left out; one also seen elsewhere
 * counts every occurrence. Speaker labels ("Rui: …") count as names.
 */
export function suggestCandidates(texts: readonly string[], opts: { exclude?: readonly string[]; limit?: number } = {}): Candidate[] {
  const qualified = new Map<string, number>();
  const atStart = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const text of texts) {
    for (const para of text.split('\n')) {
      const words: { w: string; name: boolean; start: number; end: number }[] = [];
      let m: RegExpExecArray | null;
      const re = new RegExp(RE_WORD.source, 'gu');
      while ((m = re.exec(para))) {
        const w = wordOf(m[0]);
        words.push({ w: w ?? m[0], name: w !== null, start: m.index, end: m.index + m[0].length });
      }
      const sentenceStart = (i: number): boolean => {
        let j = words[i]!.start - 1;
        for (;;) {
          while (j >= 0 && /[\s"'“”‘’«»„(\[¿¡—–-]/.test(para[j]!)) j--;
          // A transcriber's note ("[laughs]", "(pausa)") does not end a sentence: look past it.
          const close = para[j];
          if (close !== ']' && close !== ')') break;
          const open = para.lastIndexOf(close === ']' ? '[' : '(', j);
          if (open < 0) break;
          j = open - 1;
        }
        return j < 0 || /[.!?…:;]/.test(para[j]!);
      };
      const cap = (i: number) => !!words[i] && words[i]!.name && RE_CAPITALISED.test(words[i]!.w);
      const gapOk = (i: number) => /^[ \u00A0]$/.test(para.slice(words[i - 1]!.end, words[i]!.start));
      for (let i = 0; i < words.length; ) {
        if (!cap(i)) {
          i++;
          continue;
        }
        // Grow a run of capitalised words, allowing particles between them.
        const run = [i];
        let j = i + 1;
        while (j < words.length && gapOk(j)) {
          if (cap(j)) {
            run.push(j++);
            continue;
          }
          let k = j;
          while (k < words.length && gapOk(k) && PARTICLES.has(words[k]!.w.toLowerCase())) k++;
          if (k > j && cap(k) && gapOk(k)) {
            for (let x = j; x <= k; x++) run.push(x);
            j = k + 1;
          } else break;
        }
        let first = 0;
        let start = sentenceStart(run[0]!);
        while (first < run.length && isCommon(words[run[first]!]!.w)) {
          first++;
          start = false;
        }
        const kept = run.slice(first);
        // Nor start on one, once a leading common word is gone ("E das Amoreiras").
        while (kept.length && PARTICLES.has(words[kept[0]!]!.w.toLowerCase())) kept.shift();
        // A run cannot end on a particle.
        while (kept.length && PARTICLES.has(words[kept[kept.length - 1]!]!.w.toLowerCase())) kept.pop();
        if (kept.length) {
          const phrase = kept.map((x) => words[x]!.w).join(' ').normalize('NFC');
          const lastEnd = words[kept[kept.length - 1]!]!.end;
          const label = run[0] === 0 && para.slice(lastEnd).startsWith(':');
          const single = kept.length === 1;
          if (single && isCommon(phrase)) {
            // nothing
          } else if (label || !start || !single) bump(qualified, phrase);
          else bump(atStart, phrase);
        }
        i = j;
      }
    }
  }
  for (const [k, n] of atStart) if (qualified.has(k)) qualified.set(k, qualified.get(k)! + n);
  const excluded = new Set((opts.exclude ?? []).map((e) => tidy(e).toLocaleLowerCase()));
  return [...qualified]
    .filter(([k]) => !excluded.has(k.toLocaleLowerCase()))
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count || collator.compare(a.text, b.text))
    .slice(0, opts.limit ?? 200);
}

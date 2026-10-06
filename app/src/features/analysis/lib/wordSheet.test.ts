// The word list's sheet (KWIC) for a word lists exactly the occurrences the list counted: same
// tokens, same speaker-label rule, in every scope. Checked over the whole example project.
import { describe, expect, it } from 'vitest';
import { paragraphSpans } from '../../../core/qda/ranges';
import { compareFrequencies, wordFrequencies, type WordFrequencyOptions } from '../../../core/qda/wordfreq';
import { createExampleLibrary } from '../../../demo/exampleLibrary';
import { createMemoryPlatform } from '../../../platform/memory';
import { FAST_KDF } from '../../../services/testing';
import { codedInputs, codeSpans, compareCorpora, documentInputs, sheetScope, wordSheet } from './words';

async function example(locale: 'en' | 'pt' | 'es') {
  const { library, project } = await createExampleLibrary(createMemoryPlatform(), { locale, params: FAST_KDF });
  const documents = await project.store.list('document');
  const texts = new Map((await project.store.list('doctext')).map((t) => [t.id, t.text]));
  const codings = await project.store.list('coding');
  const codes = await project.store.list('code');
  return { library, project, documents, texts, codings, codes };
}

describe('word list sheet', () => {
  it.each(['en', 'pt', 'es'] as const)('%s: every counted word’s sheet total equals its count (all documents)', async (locale) => {
    const { library, documents, texts } = await example(locale);
    for (const includeMarkup of [false, true]) {
      const opts: WordFrequencyOptions = { language: locale, minLength: 3, includeMarkup };
      const f = wordFrequencies(documentInputs(documents, texts), opts);
      expect(f.words.length).toBeGreaterThan(500);
      const off = f.words.filter((w) => wordSheet(w.word, documents, texts, opts, null, 5).total !== w.count).map((w) => w.word);
      expect(off).toEqual([]);
    }
    // Speaker labels are left out by default: the researcher's own name as a turn label is not a word of the material.
    const named = wordFrequencies(documentInputs(documents, texts), { language: locale, includeMarkup: true });
    const plain = wordFrequencies(documentInputs(documents, texts), { language: locale });
    expect(plain.countedTokens).toBeLessThan(named.countedTokens);
    await library.lock();
  });

  it('a coded whole turn does not count its speaker label, and the code scope sheet matches the counts', async () => {
    const { library, documents, texts, codings, codes } = await example('en');
    const transcript = documents.find((d) => d.kind === 'transcript' && /^\S[^:\n]{0,30}: /m.test(texts.get(d.id) ?? ''))!;
    const text = texts.get(transcript.id)!;
    const turn = paragraphSpans(text).find((s) => /^[^:\n]{1,30}: /.test(text.slice(s.start, s.end)) && !text.slice(s.start, s.end).startsWith('Interviewer'))!;
    const label = text.slice(turn.start, text.indexOf(':', turn.start)).toLowerCase();
    const code = codes.find((c) => c.codable)!;
    const extra = { ...codings[0]!, id: 'whole-turn', code_id: code.id, document_id: transcript.id, start: turn.start, end: turn.end, deleted: false };
    const all = [...codings, extra];
    const opts: WordFrequencyOptions = { language: 'en', minLength: 1 };
    const f = wordFrequencies(codedInputs(all, [code.id], documents, texts, { language: 'en' }), opts);
    expect(f.words.find((w) => w.word === label)).toBeUndefined();
    const withLabels = wordFrequencies(codedInputs(all, [code.id], documents, texts, { includeMarkup: true, language: 'en' }), { ...opts, includeMarkup: true });
    expect(withLabels.words.find((w) => w.word === label)?.count).toBeGreaterThan(0);
    const within = codeSpans(all, [code.id]);
    const off = f.words.filter((w) => wordSheet(w.word, documents, texts, opts, within, 5).total !== w.count).map((w) => `${w.word}:${w.count}`);
    expect(off).toEqual([]);
    await library.lock();
  });

  it.each(['en', 'pt'] as const)('%s: segments that start or end inside a word count what the sheet lists', async (locale) => {
    const { library, documents, texts, codings, codes } = await example(locale);
    const code = codes.find((c) => c.codable)!;
    // Imported .qdpx files and text edits leave such segments: a few letters into a word, to a few letters into another.
    const odd = documents.slice(0, 6).map((d, n) => {
      const text = texts.get(d.id)!;
      const i = text.search(/\p{L}{8,}/u) + 3;
      return { ...codings[0]!, id: `odd-${n}`, code_id: code.id, document_id: d.id, start: i, end: Math.min(text.length, i + 57 + n), deleted: false };
    });
    const all = [...codings, ...odd];
    for (const includeMarkup of [false, true]) {
      const opts: WordFrequencyOptions = { language: locale, minLength: 3, includeMarkup };
      const f = wordFrequencies(codedInputs(all, [code.id], documents, texts, opts), opts);
      const within = codeSpans(all, [code.id]);
      const off = f.words.filter((w) => wordSheet(w.word, documents, texts, opts, within, 5).total !== w.count).map((w) => `${w.word}:${w.count}`);
      expect(off).toEqual([]);
      // And every word the sheet finds inside the segments is counted.
      const counted = new Set(f.words.map((w) => w.word));
      const sample = wordFrequencies(documentInputs(documents, texts), opts).words.slice(0, 300);
      const missed = sample.filter((w) => !counted.has(w.word) && wordSheet(w.word, documents, texts, opts, within, 1).total > 0).map((w) => w.word);
      expect(missed).toEqual([]);
    }
    await library.lock();
  });

  it('the compare view’s sheet looks only in the two compared sides', async () => {
    const { library, documents, texts, codings } = await example('en');
    const ids = [...new Set(documents.flatMap((d) => d.group_ids))];
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const opts: WordFrequencyOptions = { language: 'en', minLength: 3 };
    for (const [groupA, groupB] of [[ids[0]!, ids[1]!], [ids[0]!, '']] as [string, string][]) {
      const s = { view: 'compare', scope: 'all', groupId: '', groupA, groupB };
      const { a, b } = compareCorpora(documents, groupA, groupB);
      const res = compareFrequencies(documentInputs(a, texts), documentInputs(b, texts), { ...opts, limit: 200, minCount: 3 });
      expect(res.rows.length).toBeGreaterThan(0);
      const { docs, within } = sheetScope(s, documents, codings, []);
      // Two groups leave documents out of both sides: the sheet must not look in them.
      if (groupB) expect(docs.length).toBeLessThan(documents.length);
      const off = res.rows.filter((r) => wordSheet(r.word, docs, texts, opts, within, 5).total !== r.countA + r.countB).map((r) => r.word);
      expect(off).toEqual([]);
    }
    await library.lock();
  });
});

import { describe, expect, it } from 'vitest';
import { coding } from './fixtures';
import { logLikelihood } from './stats';
import { STOPWORD_LANGUAGES, stopwordsFor } from './stopwords';
import { codedTexts, compareFrequencies, wordFrequencies, wordKwic, wordsByCode } from './wordfreq';

const top = (r: ReturnType<typeof wordFrequencies>) => r.words.map((w) => [w.word, w.count, w.documents]);

describe('wordFrequencies', () => {
  it('counts case-folded words per text, without stop words', () => {
    const r = wordFrequencies(['The doctor listens. The DOCTOR cares.', 'A good doctor, a good nurse.'], { language: 'en' });
    expect(top(r)).toEqual([
      ['doctor', 3, 2],
      ['good', 2, 1],
      ['cares', 1, 1],
      ['listens', 1, 1],
      ['nurse', 1, 1],
    ]);
    expect(r.totalTokens).toBe(12);
    expect(r.countedTokens).toBe(8);
    expect(r.distinctWords).toBe(5);
    expect(r.words[0]!.percent).toBeCloseTo(37.5, 12);
  });

  it('keeps accents (Portuguese "é" is not "e") and joins curly and straight apostrophes', () => {
    const r = wordFrequencies(['Ela é médica e é boa médica. Médica!'], { language: 'pt', minLength: 1 });
    expect(top(r)).toEqual([['médica', 3, 1], ['boa', 1, 1]]);
    const en = wordFrequencies(["I don’t know, I don't care"], { language: 'en', useStopwords: false, minLength: 1 });
    expect(en.words.find((w) => w.word === "don't")?.count).toBe(2);
  });

  it('drops elided articles and English possessives', () => {
    expect(top(wordFrequencies(["L'école et l’école, d'accord"], { language: 'fr' }))).toEqual([['école', 2, 1], ['accord', 1, 1]]);
    expect(top(wordFrequencies(["dell'anno, l'anno"], { language: 'it' }))).toEqual([['anno', 2, 1]]);
    expect(top(wordFrequencies(["the children's school and the children"], { language: 'en' }))).toEqual([['children', 2, 1], ['school', 1, 1]]);
    // Elisions are still recognised when stop words are kept.
    expect(top(wordFrequencies(["l'école"], { language: 'fr', useStopwords: false }))).toEqual([['école', 1, 1]]);
  });

  it('applies minimum length (in characters), numbers and extra stop words', () => {
    const t = ['In 2023 we saw 12 GPs; ok, the GP saw 𝒜𝒜 too. Ação ação'];
    // "GP" and "𝒜𝒜" are two characters long; "ok" and "too" are stop words.
    expect(top(wordFrequencies(t, { language: 'en' }))).toEqual([['ação', 2, 1], ['saw', 2, 1], ['gps', 1, 1]]);
    const nums = wordFrequencies(t, { language: 'en', includeNumbers: true, minLength: 2 });
    expect(nums.words.map((w) => w.word)).toEqual(expect.arrayContaining(['2023', '12', 'gp', '𝒜𝒜']));
    const extra = wordFrequencies(t, { language: 'en', extraStopwords: ['SAW', ' Ação '] });
    expect(extra.words.map((w) => w.word)).toEqual(['gps']);
  });

  it('limits results and breaks ties alphabetically by code unit', () => {
    const r = wordFrequencies(['zeta alpha beta alpha'], { limit: 2 });
    expect(r.words.map((w) => w.word)).toEqual(['alpha', 'beta']);
    expect(r.distinctWords).toBe(3);
    expect(wordFrequencies(['zeta'], { limit: 0 }).words).toEqual([]);
  });

  it('accepts text records and handles empty input', () => {
    expect(wordFrequencies([{ id: 'a', text: 'garden garden' }, { text: '' }]).words).toEqual([{ word: 'garden', count: 2, documents: 1, percent: 100 }]);
    expect(wordFrequencies([])).toEqual({ words: [], totalTokens: 0, countedTokens: 0, distinctWords: 0 });
    expect(wordFrequencies(['... — !!']).totalTokens).toBe(0);
  });

  it('copes with a large text', () => {
    const big = 'saúde família confiança médico '.repeat(50_000);
    const r = wordFrequencies([big, big], { language: 'pt' });
    expect(top(r)).toEqual([['confiança', 100_000, 2], ['família', 100_000, 2], ['médico', 100_000, 2], ['saúde', 100_000, 2]]);
  });
});

describe('stop words', () => {
  it('has a reasonable, clean list for every language', () => {
    for (const lang of STOPWORD_LANGUAGES) {
      const s = stopwordsFor(lang);
      expect(s.size, lang).toBeGreaterThanOrEqual(140);
      expect(s.size, lang).toBeLessThanOrEqual(350);
      for (const w of s) {
        expect(w, lang).toBe(w.toLowerCase().normalize('NFC'));
        expect(w, lang).not.toMatch(/\s|’/);
      }
    }
    expect(stopwordsFor('pt-PT').has('não')).toBe(true);
    expect(stopwordsFor('es_ES').has('usted')).toBe(true);
    expect(stopwordsFor('en').has('the')).toBe(true);
    expect(stopwordsFor('de').has('und')).toBe(true);
    expect(stopwordsFor('xx').size).toBe(0);
    expect(stopwordsFor(null).size).toBe(0);
  });

  it('leaves out content words researchers care about', () => {
    for (const w of ['trust', 'family', 'doctor', 'money', 'health']) expect(stopwordsFor('en').has(w)).toBe(false);
    for (const w of ['confiança', 'família', 'saúde', 'trabalho']) expect(stopwordsFor('pt').has(w)).toBe(false);
    for (const w of ['confianza', 'familia', 'salud', 'sentido']) expect(stopwordsFor('es').has(w)).toBe(false);
  });
});

describe('wordsByCode', () => {
  const text = 'I trust my doctor. Money worries me. I trust the nurse too.';
  const cs = [
    coding('d', 'trust', 0, 18, { text: text.slice(0, 18) }),
    coding('d', 'trust', 7, 18, { text: text.slice(7, 18) }), // overlaps the first
    coding('d', 'trust', 37, 59, { text: text.slice(37, 59) }),
    coding('d', 'money', 19, 36, { text: text.slice(19, 36) }),
    coding('d', 'trust', 37, 59, { text: text.slice(37, 59), deleted: true }),
  ];

  it('merges overlapping segments when the text is available', () => {
    const r = wordsByCode(cs, ['trust'], { language: 'en', texts: { d: text } });
    expect(top(r)).toEqual([['trust', 2, 1], ['doctor', 1, 1], ['nurse', 1, 1]]);
  });

  it('falls back to the segments’ own text, counting identical spans once', () => {
    const r = wordsByCode(cs, ['trust'], { language: 'en' });
    expect(r.words.find((w) => w.word === 'doctor')!.count).toBe(2); // partial overlap counted twice
    expect(codedTexts(cs, ['money']).map((t) => t.text)).toEqual(['Money worries me.']);
    expect(codedTexts(cs, ['money'], { texts: new Map([['d', text]]) })).toEqual([{ id: 'd', text: 'Money worries me.' }]);
  });
});

describe('compareFrequencies', () => {
  it('ranks words by log-likelihood keyness', () => {
    const a = ['money money money money work work family'];
    const b = ['family family family family work work money'];
    const { rows, totalA, totalB } = compareFrequencies(a, b, { language: 'en' });
    expect(totalA).toBe(7);
    expect(totalB).toBe(7);
    expect(rows.map((r) => [r.word, r.countA, r.countB, r.overused])).toEqual([
      ['family', 1, 4, 'B'],
      ['money', 4, 1, 'A'],
      ['work', 2, 2, null],
    ]);
    expect(rows[1]!.logLikelihood).toBeCloseTo(logLikelihood(4, 1, 7, 7), 12);
    expect(rows[1]!.logRatio).toBeCloseTo(2, 12);
    expect(rows[2]!.logLikelihood).toBe(0);
    expect(rows[2]!.p).toBe(1);
    expect(rows[1]!.perTenThousandA).toBeCloseTo((4 / 7) * 10_000, 9);
  });

  it('drops rare words and handles an empty side', () => {
    const { rows } = compareFrequencies(['alpha beta beta'], [], { minCount: 2 });
    expect(rows.map((r) => r.word)).toEqual(['beta']);
    expect(rows[0]!.overused).toBe('A');
    expect(compareFrequencies([], []).rows).toEqual([]);
  });
});

describe('wordKwic', () => {
  it('finds a counted word as a whole word in any case, accents as written', () => {
    const docs = [{ id: 'd', text: 'A médica disse. Medica? MÉDICA! médicas' }];
    const r = wordKwic(docs, 'médica');
    expect(r.rows.map((x) => x.keyword)).toEqual(['médica', 'MÉDICA']);
    expect(r.total).toBe(2);
    expect(wordKwic(docs, '  ').rows).toEqual([]);
    expect(wordKwic([{ id: 'x', text: "l'école" }], 'école').rows.map((x) => x.left)).toEqual(["l'"]);
  });
});

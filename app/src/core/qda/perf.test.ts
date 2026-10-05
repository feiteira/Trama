// Speed check on a large fictional project: 50 documents × 20,000 words, 10,000 codings by two
// coders. Every analysis should take well under 300 ms in Node; the assertion is generous so a
// slow CI machine does not fail, but a quadratic regression still does.
import { describe, expect, it } from 'vitest';
import type { Coding } from '../model/types';
import { characterAgreement, documentAgreement, segmentAgreement } from './agreement';
import { codeFrequencyBars, documentPortrait } from './charts';
import { cooccurrence } from './cooccurrence';
import { codeAttributeCrosstab } from './crosstab';
import { attribute, code, coding, doc, kase, rng } from './fixtures';
import { codeDocumentMatrix } from './matrix';
import { searchTexts } from './search';
import { filterCodings, sortSegments } from './segments';
import { compareFrequencies, wordFrequencies, wordsByCode } from './wordfreq';

const LIMIT_MS = 1500;
const rand = rng(42);
const syllables = ['ma', 'ção', 'tra', 'é', 'con', 'fi', 'an', 'ça', 'do', 'lu', 'pe', 'ri', 'go', 'sa', 'ú', 'de', 'fa', 'mí', 'lia', 'nho'];
const vocab = Array.from({ length: 5000 }, () => {
  let w = '';
  const n = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) w += syllables[Math.floor(rand() * syllables.length)];
  return w;
});
vocab.push('trust', 'family', 'confiança', 'garden', 'gardening', 'doctor', 'the', 'and', 'que', 'de');

const texts: { id: string; text: string }[] = [];
for (let d = 0; d < 50; d++) {
  const parts: string[] = [];
  for (let i = 0; i < 20_000; i++) {
    const w = vocab[Math.floor(rand() ** 2 * vocab.length)]!;
    parts.push(i % 60 === 59 ? `${w}.\n` : i % 12 === 11 ? `${w}. ` : `${w} `);
  }
  texts.push({ id: `d${d}`, text: parts.join('') });
}
const documents = texts.map((t, i) => doc(t.id, t.text.length, { case_id: `c${i % 20}`, group_ids: [`g${i % 4}`] }));
const cases = Array.from({ length: 20 }, (_, i) => kase(`c${i}`, { age: 20 + ((i * 7) % 60), site: ['Porto', 'Lisboa', 'Faro'][i % 3]! }));
const codeIds = Array.from({ length: 40 }, (_, i) => `k${i}`);
const codes = codeIds.map((id) => code(id));
const descendants = (id: string) => (id === 'k0' ? ['k1', 'k2', 'k3'] : []);
const codings: Coding[] = [];
for (let i = 0; i < 10_000; i++) {
  const t = texts[Math.floor(rand() * texts.length)]!;
  const start = Math.floor(rand() * (t.text.length - 600));
  codings.push(
    coding(t.id, codeIds[Math.floor(rand() * codeIds.length)]!, start, start + 20 + Math.floor(rand() * 500), {
      coder_id: i % 2 ? 'A' : 'B',
      id: `cg${i}`,
    }),
  );
}
const textMap = new Map(texts.map((t) => [t.id, t.text]));
const timings: Record<string, number> = {};

function time<T>(name: string, f: () => T): T {
  const t0 = performance.now();
  const r = f();
  timings[name] = Math.round(performance.now() - t0);
  expect(timings[name], name).toBeLessThan(LIMIT_MS);
  return r;
}

describe('performance (50 documents × 20,000 words, 10,000 codings)', () => {
  it('runs every analysis quickly', () => {
    expect(texts.reduce((s, t) => s + t.text.length, 0)).toBeGreaterThan(5_000_000);
    const a = codings.filter((c) => c.coder_id === 'A');
    const b = codings.filter((c) => c.coder_id === 'B');

    expect(time('search word', () => searchTexts(texts, { query: 'confianca', mode: 'words' })).total).toBeGreaterThan(0);
    time('search boolean', () => searchTexts(texts, { query: '(trust OR confiança) AND famil* NOT doctor', mode: 'words' }));
    time('search phrase', () => searchTexts(texts, { query: 'the family', mode: 'phrase', wholeWord: true }));
    time('search regex', () => searchTexts(texts, { query: 'gard\\w+', mode: 'regex' }));
    time('filter overlap', () => filterCodings(codings, { codeIds: ['k0'], includeChildren: true, overlapWith: { codeIds: ['k5', 'k6'], mode: 'overlap' }, groupIds: ['g1', 'g2'] }, { documents, descendants }));
    time('sort', () => sortSegments(codings, 'code', { documents, codes }));
    time('cooccurrence overlap', () => cooccurrence(codings, codeIds, { mode: 'overlap' }));
    time('cooccurrence paragraph', () => cooccurrence(codings, codeIds, { mode: 'paragraph', texts: textMap }));
    time('cooccurrence proximity', () => cooccurrence(codings, codeIds, { mode: 'proximity', distance: 200 }));
    time('matrix characters', () => codeDocumentMatrix(codings, codes, documents, { measure: 'characters', includeChildren: true, descendants }));
    time('crosstab', () => codeAttributeCrosstab(codings, codes, documents, cases, attribute('age', 'number'), { measure: 'cases', percent: 'column' }));
    time('agreement characters', () => characterAgreement(a, b, documents.map((d) => ({ id: d.id, length: d.chars })), codeIds));
    time('agreement segments', () => segmentAgreement(a, b, codeIds, { threshold: 'any' }));
    time('agreement documents', () => documentAgreement(a, b, documents.map((d) => d.id), codeIds));
    expect(time('word frequencies', () => wordFrequencies(texts, { language: 'pt', limit: 200 })).totalTokens).toBe(1_000_000);
    time('words by code', () => wordsByCode(codings, ['k0'], { includeChildren: true, descendants, texts: textMap, language: 'pt' }));
    time('keyness', () => compareFrequencies(texts.slice(0, 25), texts.slice(25), { language: 'pt' }));
    time('portraits', () => documents.map((d) => documentPortrait(codings, codes, d.chars, { slices: 200, documentId: d.id })));
    time('bars', () => codeFrequencyBars(codings, codes, { measure: 'characters' }));
    console.info('qda timings (ms):', JSON.stringify(timings));
  }, 120_000);
});

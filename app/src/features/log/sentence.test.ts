import { describe, expect, it } from 'vitest';
import { Settings } from 'luxon';
import { LOG_ACTIONS, type LogAction } from '../../core/model/types';
import { log } from '../../core/i18n/locales/en/log';
import { lookup } from '../../core/i18n/translate';
import {
  actionsOf, type DetailWords, afterBound, beforeBound, buildSentence, groupByDay, groupOf, matchesText, onOrAfter, parseSummary, sentenceText, splitTemplate, TEMPLATES, templateKey,
} from './sentence';

const en = { log };
const render = (action: (typeof LOG_ACTIONS)[number], summary: string) => {
  const s = buildSentence({ action, summary }, 'none');
  const template = lookup(en, s.key) as string;
  return sentenceText(template, s);
};

describe('parseSummary', () => {
  it('reads names, arrows, counts and undo marks', () => {
    expect(parseSummary('"Trust"')).toMatchObject({ a: ['Trust'], b: [], n: null, undo: null, rest: '' });
    expect(parseSummary('"Trust" → "Interview 3"')).toMatchObject({ a: ['Trust'], b: ['Interview 3'] });
    expect(parseSummary('"A", "B" → "C" ×12')).toMatchObject({ a: ['A', 'B'], b: ['C'], n: 12 });
    expect(parseSummary('↶ "Trust"')).toMatchObject({ undo: 'undo', a: ['Trust'] });
    expect(parseSummary('↷ ×3')).toMatchObject({ undo: 'redo', n: 3 });
    expect(parseSummary('×3 (5)')).toMatchObject({ n: 3, a: [] });
    expect(parseSummary('"Doc" → ∅')).toMatchObject({ a: ['Doc'], none: true });
    expect(parseSummary('+ "Age": number')).toMatchObject({ op: 'add', a: ['Age'], rest: ': number' });
    expect(parseSummary('− "Age"')).toMatchObject({ op: 'remove', a: ['Age'] });
    expect(parseSummary('×12 → "Interview 1", "Interview 2"')).toMatchObject({ n: 12, b: ['Interview 1', 'Interview 2'] });
    expect(parseSummary('.trama (password)')).toMatchObject({ a: [], rest: '.trama (password)' });
  });
});

describe('buildSentence', () => {
  it('fills the template that fits the summary', () => {
    expect(render('code.create', '"Trust"')).toBe('Created the code “Trust”');
    expect(render('code.rename', '"Trust" → "Confidence"')).toBe('Renamed the code “Trust” to “Confidence”');
    expect(render('code.merge', '"A", "B" → "C" ×12')).toBe('Merged “A”, “B” into “C” (12 coded segments)');
    expect(render('coding.add', '"Trust" → "Interview 3"')).toBe('Coded a passage of “Interview 3” with “Trust”');
    expect(render('coding.remove', '×4')).toBe('Removed 4 coded segments');
    expect(render('case.create', '×3 (3)')).toBe('Created cases for 3 documents');
    expect(render('attribute.edit', '+ "Age": number')).toBe('Added the attribute “Age” number');
    expect(render('attribute.edit', '− "Age"')).toBe('Deleted the attribute “Age”');
    expect(render('pseudonym.apply', '×12 → "Interview 1", "Interview 2"')).toBe('Pseudonymised “Interview 1”, “Interview 2” (12 replacements)');
  });

  it('keeps what the template cannot say as a detail', () => {
    expect(render('code.edit', '"Trust": description, color')).toBe('Edited the code “Trust” description, color');
    expect(render('export', '.trama (password)')).toBe('Exported the project .trama (password)');
    expect(render('document.edit', '"Doc" → ∅')).toBe('Edited the document “Doc” → none');
    expect(render('code.delete', '"Trust" ×3')).toBe('Deleted the code “Trust” with 3 coded segments');
    expect(render('memo.create', '"Note" ×2')).toBe('Wrote the memo “Note” ×2');
    // Names on both sides of a ← are not guessed at.
    expect(render('group.edit', '"D1", "D2" ← "Group"')).toBe('Changed a document group “D1”, “D2” ← “Group”');
  });

  it('marks undo and redo', () => {
    const s = buildSentence({ action: 'code.delete', summary: '↶ "Trust"' });
    expect(s.undo).toBe('undo');
    expect(s.shape).toBe('one');
  });

  it('has every template it may pick in the English catalog, and no other', () => {
    for (const action of LOG_ACTIONS) {
      for (const shape of TEMPLATES[action]) expect(typeof lookup(en, templateKey(action, shape)), `${action}.${shape}`).toBe('string');
      const [head, verb] = action.includes('.') ? action.split('.') : ['project', action];
      const entry = (log.actions as Record<string, Record<string, Record<string, string>>>)[head!]![verb!]!;
      expect(Object.keys(entry).sort()).toEqual([...TEMPLATES[action]].sort());
    }
  });
});

describe('splitTemplate', () => {
  it('splits on slots', () => {
    expect(splitTemplate('Merged {a} into {b}')).toEqual([{ text: 'Merged ' }, { slot: 'a' }, { text: ' into ' }, { slot: 'b' }]);
    expect(splitTemplate('{n} x')).toEqual([{ slot: 'n' }, { text: ' x' }]);
  });
});

describe('groups and filters', () => {
  it('groups actions', () => {
    expect(groupOf('attribute.edit')).toBe('cases');
    expect(groupOf('export')).toBe('project');
    expect(groupOf('coding.autocode')).toBe('coding');
    expect(actionsOf(['memos'])).toEqual(['memo.create', 'memo.edit', 'memo.delete']);
    expect(actionsOf([])).toHaveLength(LOG_ACTIONS.length);
  });

  it('groups entries by local day and bounds date ranges', () => {
    const zone = Settings.defaultZone;
    Settings.defaultZone = 'Europe/Lisbon';
    try {
      const days = groupByDay([{ at: '2026-10-05T09:00:00Z' }, { at: '2026-10-04T23:30:00Z' }, { at: '2026-10-04T22:30:00Z' }]);
      // 23:30Z on the 4th is already the 5th in Lisbon (summer time).
      expect(days.map((d) => [d.day, d.items.length])).toEqual([
        ['2026-10-05', 2],
        ['2026-10-04', 1],
      ]);
      expect(beforeBound('2026-10-04')).toEqual({ at: '2026-10-04T23:00:00Z', updated_at_hlc: '' });
      expect(beforeBound(null)).toBeUndefined();
      expect(afterBound('2026-10-05')).toEqual({ at: '2026-10-04T23:00:00Z', updated_at_hlc: '' });
      expect(afterBound(null)).toBeUndefined();
      expect(afterBound('not a date')).toBeUndefined();
      expect(onOrAfter('2026-10-04T23:30:00Z', '2026-10-05')).toBe(true);
      expect(onOrAfter('2026-10-04T22:30:00Z', '2026-10-05')).toBe(false);
    } finally {
      Settings.defaultZone = zone;
    }
  });

  it('matches text without accents or case', () => {
    expect(matchesText('Criou o código “Confiança”', 'confianca codigo')).toBe(true);
    expect(matchesText('Created', 'deleted')).toBe(false);
  });
});

describe('batches of codes', () => {
  it('reads a codebook import and a batch of edits', () => {
    expect(render('code.create', '×5 → "book.qdc" ~1')).toBe('Created 5 codes from “book.qdc” ~1');
    expect(render('code.create', '~1 ×2')).toBe('Created 2 codes ~1');
    expect(render('code.edit', '×3 → "book.csv"')).toBe('Edited 3 codes from “book.csv”');
    expect(render('coder.edit', '"Rui" → "Rui Lopes"')).toBe('Renamed the coder “Rui” to “Rui Lopes”');
    expect(render('coder.add', '"Rui"')).toBe('Added the coder “Rui”');
  });
});

describe('project names', () => {
  it('reads the bare name logged when a project is created', () => {
    expect(render('project.create', 'Hortas')).toBe('Created the project “Hortas”');
  });
});

describe('quotes', () => {
  it('uses the reader’s quotation marks', async () => {
    const { quotesFor } = await import('./sentence');
    const q = quotesFor('pt');
    const s = buildSentence({ action: 'code.edit', summary: '"Trust": "x" ∅' }, 'nenhum', q);
    expect(s.detail).toContain('«');
    expect(sentenceText('Editou o código {a}', buildSentence({ action: 'code.edit', summary: '"Confiança"' }, 'nenhum', q), String, q)).toBe('Editou o código «Confiança»');
  });
});

describe('details in the reader’s language', () => {
  const words: DetailWords = {
    field: (id) => ({ codable: 'Categoria', color: 'Cor' })[id] ?? null,
    attrType: (id) => ({ choice: 'Escolha', number: 'Número', text: 'Texto' })[id] ?? null,
    phrase: (id) => `<${id}>`,
    count: (id, n) => `${n} <${id}>`,
  };
  const detail = (action: LogAction, summary: string) => buildSentence({ action, summary }, '∅', ['«', '»'], words).detail;

  it('translates code fields, attribute types, exports and imports', () => {
    expect(detail('code.edit', '"Pertença": codable')).toBe('Categoria');
    expect(detail('code.edit', '"Pertença": codable, color')).toBe('Categoria, Cor');
    expect(detail('attribute.edit', '+ "Gender": choice')).toBe('Escolha');
    expect(detail('attribute.edit', '"Age": text → number')).toBe('Texto → Número');
    expect(detail('export', '.qdpx (MAXQDA line endings)')).toBe('.qdpx (<crlf>)');
    expect(detail('export', '.trama (password) + pseudonyms')).toBe('.trama (<password>) + <pseudonyms>');
    expect(detail('export', 'segments ×12 → Trust.docx')).toBe('12 <segments> → Trust.docx');
    expect(detail('export', 'memos ×3 → Memos.md')).toBe('3 <memos> → Memos.md');
    expect(detail('export', 'codebook .qdc')).toBe('<codebook> .qdc');
    expect(detail('export', 'project report .docx')).toBe('<report> .docx');
    expect(detail('export', 'agreement .xlsx (Ana / Rui)')).toBe('<agreement> .xlsx (Ana / Rui)');
    expect(detail('export', 'analysis: Matrix.csv')).toBe('<analysis>: Matrix.csv');
    expect(detail('export', '"key.csv" (pseudonyms)')).toBe('(<pseudonyms>)');
    expect(detail('project.import', 'Trama 0.1.0: 71 records, 2 left out')).toBe('Trama 0.1.0: 71 <records>, 2 <leftOut>');
  });

  it('keeps what it does not know as it is', () => {
    expect(detail('code.edit', '"Trust": 3')).toBe('3');
    expect(detail('code.edit', '"Trust": codable, weird')).toBe('codable, weird');
    expect(buildSentence({ action: 'code.edit', summary: '"Pertença": codable' }).detail).toBe('codable');
  });
});

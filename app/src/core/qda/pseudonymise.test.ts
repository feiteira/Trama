// File names: apply rewrites every name an export would otherwise blank, words joined without a
// separator ("MartaSousa") included.
import { describe, expect, it } from 'vitest';
import type { Pseudonym } from '../model/types';
import { fileNameHolds, planFileName } from './pseudonymise';

const rule = (original: string, replacement: string, id = original): Pseudonym =>
  ({ id, original, replacement, note: '', whole_word: true, case_sensitive: true, applied_at: null, applied_count: 0, created_at: '2026-01-01T00:00:00Z', updated_at_hlc: '', deleted: false }) as Pseudonym;

function rewrite(name: string, rules: Pseudonym[]): string {
  const { edits } = planFileName(name, rules);
  let out = '';
  let at = 0;
  for (const e of edits) {
    out += name.slice(at, e.start) + e.insert;
    at = e.end;
  }
  return out + name.slice(at);
}

describe('file names', () => {
  it('finds names joined to other words by case or digits, never inside a word', () => {
    const marta = [rule('Marta', 'P1')];
    expect(rewrite('Consent_MartaSousa.docx', marta)).toBe('Consent_P1Sousa.docx');
    expect(rewrite('consentMarta.pdf', marta)).toBe('consentP1.pdf');
    expect(rewrite('Marta2_interview.mp3', marta)).toBe('P12_interview.mp3');
    expect(rewrite('marta_notes.txt', marta)).toBe('P1_notes.txt');
    // Not a word boundary: left to the export's stricter check.
    expect(rewrite('Martalina.docx', marta)).toBe('Martalina.docx');
    expect(rewrite('Analysis.docx', [rule('Ana', 'P2')])).toBe('Analysis.docx');
    expect(rewrite('AnaLima.docx', [rule('Ana', 'P2')])).toBe('P2Lima.docx');
  });

  it('matches a name of several words written with separators or none', () => {
    const r = [rule('Marta Sousa', 'Participant 1')];
    expect(rewrite('Consent_MartaSousa.docx', r)).toBe('Consent_Participant_1.docx');
    expect(rewrite('Marta-Sousa interview.docx', r)).toBe('Participant_1 interview.docx');
    expect(rewrite('marta.sousa.pdf', r)).toBe('Participant_1.pdf');
  });

  it('every name apply rewrites is one an export would blank', () => {
    const rules = [rule('Marta', 'P1'), rule('Rui Lopes', 'P2')];
    for (const name of ['Consent_MartaSousa.docx', 'RuiLopes.mp3', 'rui_lopes_2.vtt', 'Marta2.pdf', 'Notes.txt', 'Martalina.docx']) {
      const rewritten = planFileName(name, rules).matches.length > 0;
      if (rewritten) expect(fileNameHolds(name, rules)).toBe(true);
      expect(fileNameHolds(rewrite(name, rules), rules)).toBe(name === 'Martalina.docx');
    }
  });
});

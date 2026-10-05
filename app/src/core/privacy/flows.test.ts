import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UI_LOCALES } from '../i18n/languages';
import { FLOW_IDS, FLOWS, headingAnchor, NO_NETWORK, PRIVACY_HEAD, privacyMarkdown } from './flows';

describe('privacy flows', () => {
  it('lists every flow once, in every language, with no empty text', () => {
    expect(FLOWS.map((f) => f.id)).toEqual([...FLOW_IDS]);
    for (const f of FLOWS) {
      for (const l of UI_LOCALES) {
        const t = f.text[l];
        for (const v of [t.title, t.when, t.what, t.who]) expect(v.trim().length, `${f.id} ${l}`).toBeGreaterThan(3);
      }
    }
    for (const l of UI_LOCALES) {
      expect(NO_NETWORK[l]).toBeTruthy();
      expect(PRIVACY_HEAD[l].title).toBeTruthy();
    }
  });

  it('says backups are encrypted and the pseudonymisation key never leaves in a REFI-QDA file', () => {
    expect(FLOWS.find((f) => f.id === 'backup')!.encrypted).toBe('always');
    expect(FLOWS.find((f) => f.id === 'qdpx')!.text.en.what).toMatch(/Never the pseudonymisation key/);
  });

  it('names every way data leaves, with the formats each one writes', () => {
    const title = (id: string) => FLOWS.find((f) => f.id === id)?.text.en.title ?? '';
    const formats: Record<string, string[]> = {
      backup: [],
      trama: ['.trama'],
      teammate: [],
      qdpx: ['.qdpx'],
      codebook: ['.qdc', 'Word', 'CSV', 'Excel', 'Markdown'],
      segments: ['CSV', 'Excel', 'Word', 'HTML'],
      memos: ['Word', 'Markdown'],
      analysis: ['CSV', 'Excel', 'SVG', 'PNG'],
      cases: ['CSV', 'Excel'],
      audit: ['CSV'],
      agreement: ['Word', 'HTML', 'Excel', 'CSV'],
      report: ['Word', 'HTML'],
      pseudonyms: [],
      clipboard: [],
    };
    expect(Object.keys(formats).sort()).toEqual([...FLOW_IDS].sort());
    for (const [id, list] of Object.entries(formats)) for (const f of list) expect(title(id), id).toContain(f);
    // Only backups happen on their own; everything else is something you do.
    expect(FLOWS.filter((f) => f.trigger === 'setting').map((f) => f.id)).toEqual(['backup']);
  });

  it('makes GitHub-style anchors', () => {
    expect(headingAnchor('What leaves this computer')).toBe('what-leaves-this-computer');
    expect(headingAnchor('Qué sale de este ordenador')).toBe('qué-sale-de-este-ordenador');
  });

  it('writes one table row per flow per language, with pipes escaped', () => {
    const md = privacyMarkdown();
    const rows = md.split('\n').filter((l) => l.startsWith('| **'));
    expect(rows).toHaveLength(FLOWS.length * UI_LOCALES.length);
    for (const r of rows) expect(r.split(/(?<!\\)\|/).length).toBe(6);
  });

  it('matches PRIVACY.md (run npm run gen:privacy after changing flows.ts)', () => {
    const file = readFileSync(resolve(__dirname, '../../../../PRIVACY.md'), 'utf8');
    expect(file).toBe(privacyMarkdown());
  });
});

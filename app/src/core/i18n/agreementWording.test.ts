import { describe, expect, it } from 'vitest';
import { catalogs } from './catalogs';
import { UI_LOCALES } from './languages';
import { translate } from './translate';

describe('agreement wording', () => {
  // "revista(s)" on its own reads as "magazine(s)" in Portuguese; the disagreement
  // review labels must say "resolvida(s)" instead.
  it('Portuguese disagreement labels never say "revista"', () => {
    const dis = catalogs.pt.agreement.dis as Record<string, unknown>;
    for (const [k, v] of Object.entries(dis)) {
      if (typeof v === 'string') expect(v, k).not.toMatch(/\brevistas?\b/i);
    }
  });

  // agreement.merge.done carries two counts in one plain string, so it must not
  // put a count in front of a plural noun ("1 registos novos").
  it.each(UI_LOCALES)('%s merge summary reads correctly for a count of 1', (locale) => {
    const msg = translate(catalogs[locale], catalogs.en, 'agreement.merge.done', { added: 1, updated: 1 });
    expect(msg).not.toMatch(/\{\w+\}/);
    expect(msg).not.toMatch(/\b1 (records|registos|registros|new|newer|novos|nuevos|mais|más)\b/i);
  });
});

import { describe, expect, it } from 'vitest';
import { catalogs } from './catalogs';
import { UI_LOCALES } from './languages';

type Tree = { [k: string]: string | Tree };

function leaves(t: Tree, prefix = ''): [string, string][] {
  return Object.entries(t).flatMap(([k, v]) => (typeof v === 'string' ? [[`${prefix}${k}`, v] as [string, string]] : leaves(v, `${prefix}${k}.`)));
}

const en = new Map(leaves(catalogs.en as unknown as Tree));
// Strings that are legitimately identical across languages (names, format codes).
const SAME_OK = /^(app\.name|common\.ok)$/;

describe.each(UI_LOCALES.filter((l) => l !== 'en'))('%s catalog', (locale) => {
  const other = new Map(leaves(catalogs[locale] as unknown as Tree));

  it('is a real translation, not a copy of English', () => {
    const same = [...en].filter(([k, v]) => other.get(k) === v && v.length > 3 && !SAME_OK.test(k));
    expect(same.length / en.size).toBeLessThan(0.05);
  });

  it('keeps every {placeholder}', () => {
    for (const [k, v] of en) {
      const want = [...new Set(v.match(/\{\w+\}/g) ?? [])].sort().join(',');
      const got = [...new Set(other.get(k)?.match(/\{\w+\}/g) ?? [])].sort().join(',');
      expect(got, k).toBe(want);
    }
  });

});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast } from './color';

// Text tokens must read at WCAG AA (4.5:1) on every surface they are set on, in both themes:
// the papers (window, cards, rail, hover, the current row) and the soft tints.

const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');

function block(start: string): Map<string, string> {
  const at = css.indexOf(start);
  expect(at).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('}', at);
  const out = new Map<string, string>();
  for (const m of css.slice(at, end).matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)) out.set(m[1]!, m[2]!.toLowerCase());
  return out;
}

const themes = {
  light: block(':root {'),
  darkSystem: block(":root:not([data-theme='light']) {"),
  dark: block(":root[data-theme='dark'] {"),
};

describe('text tokens', () => {
  it('both dark blocks agree', () => {
    expect([...themes.darkSystem]).toEqual([...themes.dark]);
  });

  for (const [name, t] of Object.entries(themes)) {
    it(`ink, ink-2 and ink-3 reach 4.5:1 on every paper and soft tint (${name})`, () => {
      const surfaces = [...t].filter(([k]) => k.startsWith('--paper') || k === '--accent-soft' || /^--(danger|warning|success|info)-soft$/.test(k));
      expect(surfaces.length).toBeGreaterThanOrEqual(10);
      const low: string[] = [];
      for (const ink of ['--ink', '--ink-2', '--ink-3']) {
        for (const [k, bg] of surfaces) {
          const r = contrast(t.get(ink)!, bg);
          if (r < 4.5) low.push(`${ink} on ${k}: ${r.toFixed(2)}`);
        }
      }
      expect(low).toEqual([]);
    });
  }
});

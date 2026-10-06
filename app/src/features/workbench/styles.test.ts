import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The viewer's stylesheet must keep coding, focus and the arrival mark visible for readers with
// Windows High Contrast (forced colours) or reduced motion. The tests run in Node, with no
// browser to evaluate media queries, so these check the rules themselves.

const css = readFileSync(resolve(__dirname, 'workbench.css'), 'utf8');

function mediaBlock(query: string): string {
  const at = css.indexOf(`@media ${query}`);
  expect(at, query).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(at, i);
  }
  throw new Error('unclosed');
}
const rule = (block: string, selector: string) => {
  const m = block.match(new RegExp(`${selector.replace(/[.$]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  return m?.[1] ?? '';
};

describe('workbench.css', () => {
  it('forced colours: coded text, margin bars, the caret and focus stay visible', () => {
    const fc = mediaBlock('(forced-colors: active)');
    expect(rule(fc, '.wb-r--coded')).toMatch(/text-decoration:\s*underline/);
    expect(rule(fc, '.wb-stripe__bar')).toMatch(/forced-color-adjust:\s*none/);
    expect(rule(fc, '.wb-caret')).toMatch(/forced-color-adjust:\s*none/);
    expect(rule(fc, '.wb-caret')).toMatch(/background:\s*CanvasText/);
    expect(rule(fc, '.wb-text:focus-visible')).toMatch(/outline:\s*2px solid Highlight/);
    expect(rule(fc, '.wb-flash')).toMatch(/outline:/);
    expect(rule(fc, '.wb-sel')).toMatch(/outline:/);
  });

  it('reduced motion: the arrival mark shows (the global rule would leave it at opacity 0)', () => {
    const rm = mediaBlock('(prefers-reduced-motion: reduce)');
    expect(rule(rm, '.wb-flash')).toMatch(/animation:\s*none/);
    expect(rule(rm, '.wb-flash')).toMatch(/opacity:\s*1/);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NARROW_RAIL } from '../ui/media';

// At narrow widths shell.css hides the rail's labels; ProjectShell then names the icon-only
// items and gives them tooltips, following NARROW_RAIL. Both must use the same width, or the
// items lose their names between the two.

describe('icon-only rail', () => {
  it('shell.css hides the labels at exactly the width ProjectShell watches', () => {
    const css = readFileSync(resolve(__dirname, 'shell.css'), 'utf8');
    const queries = [...css.matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{[^@]*?\.rail__label/g)].map((m) => `(max-width: ${m[1]}px)`);
    expect(queries).toEqual([NARROW_RAIL]);
  });

  it('ProjectShell names the items and shows tooltips whenever the rail is icon-only', () => {
    const src = readFileSync(resolve(__dirname, 'ProjectShell.tsx'), 'utf8');
    expect(src).toMatch(/const iconOnly = collapsed \|\| narrow/);
    expect(src).toMatch(/aria-label=\{iconOnly \? label : undefined\}/);
    expect(src).toMatch(/\{iconOnly \? \(\s*<Tooltip/);
  });
});

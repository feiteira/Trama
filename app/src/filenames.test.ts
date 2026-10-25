import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Windows and macOS file systems ignore letter case: there `import './Team'` can open team.ts
// instead of Team.tsx, and the build breaks while Linux (and these tests) see no problem.

function modules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return modules(p);
    return /\.(tsx?|css)$/.test(e.name) ? [p] : [];
  });
}

describe('source file names', () => {
  it('never differ only in letter case (an import resolves to one file on every system)', () => {
    const root = import.meta.dirname;
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const file of modules(root)) {
      const path = relative(root, file);
      // What an import names: the path without its extension (and without .test).
      const key = path.replace(/(\.test)?\.(tsx?|css)$/, '').toLowerCase() + (path.endsWith('.css') ? '.css' : '');
      const other = seen.get(key);
      if (other && other.replace(/(\.test)?\.tsx?$/, '') !== path.replace(/(\.test)?\.tsx?$/, '')) clashes.push(`${other} ↔ ${path}`);
      else seen.set(key, path);
    }
    expect(clashes).toEqual([]);
  });
});

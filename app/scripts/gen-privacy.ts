// Writes PRIVACY.md from the single list of ways data leaves the computer
// (app/src/core/privacy/flows.ts). With --check it writes nothing and fails when PRIVACY.md is
// out of date (CI).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privacyMarkdown } from '../src/core/privacy/flows';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../PRIVACY.md');
const md = privacyMarkdown();

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(out, 'utf8');
  } catch {
    // Missing counts as out of date.
  }
  if (current !== md) {
    console.error('PRIVACY.md is out of date. Run: npm run gen:privacy');
    process.exit(1);
  }
  console.log('PRIVACY.md is up to date.');
} else {
  writeFileSync(out, md);
  console.log(`Wrote ${out}`);
}

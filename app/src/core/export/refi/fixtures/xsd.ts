// Test helper: XSD validation through Python lxml, when available (no project dependency).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
export const PROJECT_XSD = join(here, 'Project.xsd');
export const CODEBOOK_XSD = join(here, 'Codebook.xsd');

function findPython(): string | null {
  for (const py of [process.env.REFI_XSD_PYTHON, 'python3', 'python'].filter((p): p is string => !!p)) {
    const r = spawnSync(py, ['-c', 'import lxml'], { encoding: 'utf8' });
    if (r.status === 0) return py;
  }
  return null;
}

export const xsdPython = findPython();

/** Validates XML text against a schema; returns 'ok' or the errors. */
export function validateXsd(xsd: string, xml: string): string {
  if (!xsdPython) throw new Error('no python with lxml');
  const dir = mkdtempSync(join(tmpdir(), 'trama-xsd-'));
  try {
    const file = join(dir, 'doc.xml');
    writeFileSync(file, xml, 'utf8');
    const r = spawnSync(xsdPython, [join(here, 'validate-xsd.py'), xsd, file], { encoding: 'utf8' });
    return (r.stdout + r.stderr).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

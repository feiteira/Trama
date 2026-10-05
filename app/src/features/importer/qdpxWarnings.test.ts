import { describe, expect, it } from 'vitest';
import type { QdpxWarning } from '../../core/export/refi';
import { QDPX_WARNING_CODES } from '../../core/export/refi';
import { catalogs } from '../../core/i18n/catalogs';
import { lookup } from '../../core/i18n/translate';
import { classifyQdpxWarning, groupQdpxWarnings, QDPX_KEYS } from './qdpxWarnings';

const w = (code: QdpxWarning['code'], count = 1, detail?: string): QdpxWarning => ({ code, count, message: `message of ${code}`, ...(detail !== undefined ? { detail } : {}) });

describe('qdpx warnings', () => {
  it('maps counted and named warnings to their sentences by code', () => {
    expect(classifyQdpxWarning(w('mediaSelection', 3))).toEqual({ group: 'coding', plural: 'importer.qdpx.counted.mediaSelection', n: 3, raw: 'message of mediaSelection' });
    expect(classifyQdpxWarning(w('pdfNoText', 1, 'Report'))).toEqual({ group: 'sources', key: 'importer.qdpx.named.pdfNoText', vars: { name: 'Report' }, raw: 'message of pdfNoText' });
    // A code from a newer reader is shown as it was worded.
    expect(classifyQdpxWarning({ code: 'somethingNew' as QdpxWarning['code'], count: 1, message: 'Something new happened.' })).toEqual({ group: 'other', raw: 'Something new happened.' });
  });

  it('groups in display order', () => {
    const g = groupQdpxWarnings([w('link', 2), w('picture'), w('badValue', 4), w('duplicateCoding', 5)]);
    expect(g.map((x) => x.group)).toEqual(['sources', 'coding', 'cases', 'other']);
    expect(g[0]!.notes).toHaveLength(1);
  });

  it('has a sentence for every code the reader gives, in every language', () => {
    expect(QDPX_KEYS).toHaveLength(QDPX_WARNING_CODES.length);
    for (const lang of ['en', 'pt', 'es'] as const) for (const k of QDPX_KEYS) expect(lookup(catalogs[lang], k), `${lang} ${k}`).toBeTruthy();
  });
});

import { describe, expect, it } from 'vitest';
import { catalogs } from '../../core/i18n/catalogs';
import { lookup } from '../../core/i18n/translate';
import { classifyQdpxWarning, groupQdpxWarnings, QDPX_KEYS } from './qdpxWarnings';

describe('qdpx warnings', () => {
  it('recognises counted and named warnings', () => {
    expect(classifyQdpxWarning('3 coded audio/video time range(s) were not imported (Trama codes transcript text).')).toMatchObject({
      group: 'coding',
      plural: 'importer.qdpx.counted.mediaSelection',
      n: 3,
    });
    expect(classifyQdpxWarning('The PDF "Report" was imported without text: the file had no text representation.')).toMatchObject({
      group: 'sources',
      key: 'importer.qdpx.named.pdfNoText',
      vars: { name: 'Report' },
    });
    expect(classifyQdpxWarning('Something new happened.')).toEqual({ group: 'other', raw: 'Something new happened.' });
  });

  it('groups in display order', () => {
    const g = groupQdpxWarnings([
      '2 link(s) between objects were not imported (Trama has no relations yet).',
      '1 picture source(s) were not imported (pictures are not supported yet).',
      '4 attribute value(s) did not match their type and were left empty.',
      '5 duplicate coding(s) (same code, coder and text) were merged.',
    ]);
    expect(g.map((x) => x.group)).toEqual(['sources', 'coding', 'cases', 'other']);
    expect(g[0]!.notes).toHaveLength(1);
  });

  it('uses keys that exist in every language', () => {
    for (const lang of ['en', 'pt', 'es'] as const) for (const k of QDPX_KEYS) expect(lookup(catalogs[lang], k), `${lang} ${k}`).toBeTruthy();
  });
});

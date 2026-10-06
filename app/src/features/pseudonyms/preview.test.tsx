// The preview shows every replacement apply will make (names, memos and comments too, not only
// document texts) and warns that the audit trail keeps the names.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { newRecoveryPhrase } from '../../core/crypto/keyring';
import { createMemoryPlatform } from '../../platform/memory';
import { createDocument } from '../../services/documents';
import { Library } from '../../services/library';
import { createMemo } from '../../services/memos';
import { createPseudonym, preview } from '../../services/pseudonyms';
import { FAST_KDF } from '../../services/testing';
import { I18nProvider } from '../../ui/i18n';
import { PreviewPanel } from './index';
import { fieldName, groupFields } from './key';

describe('pseudonymisation preview', () => {
  it('lists replacements outside the texts by kind, and the audit-trail entries that keep the name', async () => {
    const library = await Library.create(createMemoryPlatform(), { passphrase: 'pass word', recoveryPhrase: newRecoveryPhrase() }, { params: FAST_KDF });
    const project = await library.createProject({ name: 'Study', coderName: 'Ana' });
    const { document: doc } = await createDocument(project, { name: 'Interview — Maria Silva', kind: 'transcript', text: 'Maria Silva: I was afraid.\nInterviewer: Of what, Maria Silva?' });
    await createMemo(project, { title: 'About Maria Silva', body: 'Maria Silva was nervous.', target: { kind: 'document', id: doc.id } });
    const { pseudonym } = await createPseudonym(project, { original: 'Maria Silva', replacement: 'P1' });
    const p = await preview(project);
    expect(p.textTotal).toBe(2);
    expect(p.total).toBeGreaterThan(p.textTotal);
    expect(p.logEntries).toBeGreaterThan(0);
    const replacementOf = (id: string) => (id === pseudonym.id ? 'P1' : '');

    const en = renderToStaticMarkup(
      <I18nProvider locale="en">
        <PreviewPanel preview={p} replacementOf={replacementOf} onClose={() => undefined} />
      </I18nProvider>,
    );
    // The header counts the texts in the documents line, the rest apart, so the lists below add up.
    expect(en).toContain('2 replacements in 1 document');
    expect(en).toContain(`${p.total - p.textTotal} more elsewhere`);
    expect(en).toContain('data-testid="preview-fields-document"');
    expect(en).toContain('data-testid="preview-fields-memo"');
    expect(en).toContain('Document names and file names');
    expect(en).toContain('data-testid="preview-log-warning"');
    expect(en).toMatch(/The audit trail keeps \d+ entr(y|ies) with these names/);

    const pt = renderToStaticMarkup(
      <I18nProvider locale="pt">
        <PreviewPanel preview={p} replacementOf={replacementOf} onClose={() => undefined} />
      </I18nProvider>,
    );
    expect(pt).toContain('Noutros sítios do projeto');
    expect(pt).toContain('Memorandos');
    expect(pt).not.toMatch(/pseudonyms\.|\{\w+\}/);
    await library.lock();
  });

  it('names fields and groups them in a fixed order', () => {
    expect(fieldName('values.abc')).toBe('value');
    expect(fieldName('source.filename')).toBe('filename');
    expect(fieldName('body')).toBe('body');
    expect(fieldName('weird')).toBe('other');
    const g = groupFields([
      { kind: 'memo', count: 2 },
      { kind: 'document', count: 1 },
      { kind: 'memo', count: 1 },
    ]);
    expect(g.map((x) => [x.kind, x.count, x.fields.length])).toEqual([
      ['document', 1, 1],
      ['memo', 3, 2],
    ]);
  });
});

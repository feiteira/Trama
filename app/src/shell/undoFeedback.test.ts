import { describe, expect, it } from 'vitest';
import { makeI18n } from '../ui/i18n';
import { describeStep, stepDoneMessage, stepRefusedMessage } from './undoFeedback';

describe('undo feedback', () => {
  const en = makeI18n('en');

  it('names the step the way the audit trail does', () => {
    const merge = { label: 'code.merge' as const, detail: '"Confidence" → "Trust" ×2' };
    expect(describeStep(merge, en)).toBe('Merged “Confidence” into “Trust” (2 coded segments)');
    expect(stepDoneMessage('undo', merge, en)).toBe('Undone: Merged “Confidence” into “Trust” (2 coded segments)');
    expect(stepDoneMessage('redo', merge, en)).toBe('Redone: Merged “Confidence” into “Trust” (2 coded segments)');
  });

  it('speaks the reader’s language, with their quotation marks', () => {
    const msg = stepDoneMessage('undo', { label: 'code.delete', detail: '"Trust"' }, makeI18n('pt'));
    expect(msg.startsWith('Anulado: ')).toBe(true);
    expect(msg).toContain('«Trust»');
    expect(stepDoneMessage('undo', { label: 'code.delete', detail: '"Trust"' }, makeI18n('es'))).toContain('Deshecho: ');
  });

  it('falls back to the detail for steps outside the audit trail, or says just that it happened', () => {
    expect(describeStep({ label: 'document.order', detail: '"Interview 1"' }, en)).toBe('“Interview 1”');
    expect(stepDoneMessage('undo', { label: 'document.order', detail: '' }, en)).toBe('Undone.');
    expect(stepDoneMessage('redo', { label: 'document.order', detail: '' }, en)).toBe('Redone.');
  });
});

describe('refused undo feedback', () => {
  it('names the refused step in the reader’s language, with no technical message', () => {
    const step = { label: 'pseudonym.apply' as const, detail: '' };
    for (const lang of ['en', 'pt', 'es'] as const) {
      const i18n = makeI18n(lang);
      const merge = { label: 'code.merge' as const, detail: '"Confidence" → "Trust" ×2' };
      const msg = stepRefusedMessage('undo', merge, i18n);
      expect(msg).toContain(describeStep(merge, i18n));
      expect(msg).not.toMatch(/changed since|[0-9a-f]{8}-[0-9a-f]{4}/);
      expect(stepRefusedMessage('redo', null, i18n)).not.toContain('{what}');
      expect(stepRefusedMessage('undo', step, i18n)).not.toContain('{');
    }
    expect(stepRefusedMessage('undo', { label: 'code.merge', detail: '"A" → "B" ×2' }, makeI18n('en'))).toBe(
      'Can’t undo: Merged “A” into “B” (2 coded segments). Part of it was changed afterwards (a recording attached, a teammate’s copy merged…), so this step has been taken off the undo list.',
    );
    expect(stepRefusedMessage('undo', null, makeI18n('pt')).startsWith('Não é possível anular')).toBe(true);
    expect(stepRefusedMessage('redo', null, makeI18n('es')).startsWith('No se puede rehacer')).toBe(true);
  });
});

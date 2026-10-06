import { describe, expect, it } from 'vitest';
import { makeI18n } from '../ui/i18n';
import { describeStep, stepDoneMessage } from './undoFeedback';

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

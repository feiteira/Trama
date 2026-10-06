import { LOG_ACTIONS, type LogAction } from '../core/model/types';
import { buildSentence, quotesFor, sentenceText, tidyDetail } from '../features/log/sentence';
import type { Undoable } from '../services/undo';
import type { I18n, MessageKey } from '../ui/i18n';

// What an undo or redo step says to the researcher. A step can come from another screen (Ctrl+Z
// on Memos undoes a merge made in the Codebook), so it is named the way the audit trail names
// it, in the reader's language: "Undone: Merged “Confidence” into “Trust” (2 coded segments)".

type Step = Pick<Undoable, 'label' | 'detail'>;
type Lang = Pick<I18n, 't' | 'locale' | 'meta'>;

/** The step as a sentence ("Merged “A” into “B” (2 coded segments)"), or '' when it says nothing. */
export function describeStep(step: Step, i18n: Lang): string {
  const quotes = quotesFor(i18n.locale);
  const none = i18n.t('log.none');
  if ((LOG_ACTIONS as readonly string[]).includes(step.label)) {
    const s = buildSentence({ action: step.label as LogAction, summary: step.detail }, none, quotes);
    return sentenceText(i18n.t(s.key as MessageKey), s, (n) => n.toLocaleString(i18n.meta.bcp47), quotes);
  }
  return tidyDetail(step.detail, none, quotes);
}

/** The toast after an undo or a redo went through. */
export function stepDoneMessage(kind: 'undo' | 'redo', step: Step, i18n: Lang): string {
  const what = describeStep(step, i18n);
  if (kind === 'undo') return what ? i18n.t('app.undo.undone', { what }) : i18n.t('app.undo.undoneBare');
  return what ? i18n.t('app.undo.redone', { what }) : i18n.t('app.undo.redoneBare');
}

/**
 * The toast when an undo or a redo was refused because a record it would write back changed
 * since (ServiceError 'changed_since'): which step, why, and that it left the stack.
 */
export function stepRefusedMessage(kind: 'undo' | 'redo', step: Step | null, i18n: Lang): string {
  const what = step ? describeStep(step, i18n) : '';
  if (kind === 'undo') return what ? i18n.t('app.undo.refusedUndo', { what }) : i18n.t('app.undo.refusedUndoBare');
  return what ? i18n.t('app.undo.refusedRedo', { what }) : i18n.t('app.undo.refusedRedoBare');
}

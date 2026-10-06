import React from 'react';
import { CircleCheck, FileText, VenetianMask } from 'lucide-react';
import type { MergeResult } from '../../services/datafile';
import type { TextConflict } from '../../services/reconcile';
import { Button } from '../../ui/components/Button';
import { Notice } from '../../ui/components/Feedback';
import { useI18n } from '../../ui/i18n';
import './MergeReport.css';

/** What a merge (or its preview) found that the record counts do not tell. */
export type MergeFindings = Pick<MergeResult, 'textConflicts'> &
  Partial<Pick<MergeResult, 'reanchored' | 'removedCodings' | 'originalsFound' | 'repseudonymised' | 'textsReplaced' | 'revived'>>;

/** True when there is something to report beyond the counts. */
export const hasFindings = (f: MergeFindings): boolean =>
  f.textConflicts.length > 0 ||
  !!f.reanchored ||
  !!f.removedCodings ||
  !!f.originalsFound?.length ||
  !!f.repseudonymised?.length ||
  !!f.textsReplaced?.length ||
  !!f.revived?.length;

interface Named {
  documentId: string;
  name: string;
  /** Set for a record that is not a document (a memo, a code…): listed, not opened. */
  kind?: string;
}

/**
 * The parts of a merge a researcher has to know about: texts changed on both sides (this
 * project's text was kept, the teammate's changes did not come in, unless they take the
 * teammate's text), texts the teammate's replaced, codings that moved or went, deleted items
 * kept because of newer work, and names from before pseudonymisation the copy brought back.
 */
export function MergeReport({
  findings,
  stage,
  onOpenDocument,
  onPseudonymise,
  onTakeTheirs,
  taken,
}: {
  findings: MergeFindings;
  stage: 'preview' | 'done';
  onOpenDocument?: (documentId: string) => void;
  onPseudonymise?: () => void;
  /** Resolves a conflict with the teammate's text (offered when the conflict carries it). */
  onTakeTheirs?: (conflict: TextConflict) => void;
  /** Conflicts already resolved with the teammate's text. */
  taken?: ReadonlySet<string>;
}) {
  const { t, tp } = useI18n();
  const { textConflicts, reanchored = 0, removedCodings = 0, originalsFound = [], repseudonymised = [], textsReplaced = [], revived = [] } = findings;
  if (!hasFindings(findings)) return null;
  const name = (d: Named) =>
    onOpenDocument && !d.kind ? (
      <button type="button" className="merge-report__doc-link" onClick={() => onOpenDocument(d.documentId)} aria-label={t('agreement.merge.openDocument', { name: d.name })}>
        {d.name}
      </button>
    ) : (
      <span className="merge-report__doc-name">{d.name}</span>
    );
  const list = (docs: readonly Named[], testid: string, extra?: (d: Named) => React.ReactNode) => (
    <ul className="merge-report__docs" data-testid={testid}>
      {docs.map((d, i) => (
        <li key={`${d.documentId}:${i}`}>
          <FileText size={14} aria-hidden className="merge-report__doc-icon" />
          {name(d)}
          {extra?.(d)}
        </li>
      ))}
    </ul>
  );
  const takeAction = (d: Named) => {
    const c = textConflicts.find((x) => x.documentId === d.documentId);
    if (!c) return null;
    if (taken?.has(c.documentId)) {
      return (
        <span className="merge-report__taken" data-testid="merge-report-taken">
          <CircleCheck size={13} aria-hidden /> {t('agreement.merge.tookTheirs')}
        </span>
      );
    }
    if (!onTakeTheirs || c.theirText === undefined) return null;
    return (
      <Button size="sm" variant="ghost" className="merge-report__take" onClick={() => onTakeTheirs(c)} data-testid="merge-report-take-theirs">
        {t('agreement.merge.takeTheirs')}
      </Button>
    );
  };
  return (
    <div className="merge-report" data-testid="merge-report">
      {originalsFound.length ? (
        <Notice tone="danger" icon={VenetianMask} title={tp('agreement.merge.originalsTitle', originalsFound.length)} data-testid="merge-report-originals">
          <p>{t('agreement.merge.originalsBody')}</p>
          {list(
            originalsFound.map((o) => ({ documentId: o.documentId, name: o.name, ...(o.kind && o.kind !== 'document' ? { kind: o.kind } : {}) })),
            'merge-report-originals-list',
          )}
          {onPseudonymise ? (
            <div className="merge-report__action">
              <Button size="sm" variant="secondary" icon={VenetianMask} onClick={onPseudonymise} data-testid="merge-report-pseudonymise">
                {t('agreement.merge.pseudonymiseAgain')}
              </Button>
            </div>
          ) : null}
        </Notice>
      ) : null}
      {textConflicts.length ? (
        <Notice tone="warning" title={tp('agreement.merge.conflictsTitle', textConflicts.length)} data-testid="merge-report-conflicts">
          <p>{stage === 'preview' ? t('agreement.merge.conflictsPreview') : onTakeTheirs ? t('agreement.merge.conflictsDoneTake') : t('agreement.merge.conflictsDone')}</p>
          {list(textConflicts, 'merge-report-conflicts-list', stage === 'done' ? takeAction : undefined)}
        </Notice>
      ) : null}
      {textsReplaced.length ? (
        <Notice tone="warning" title={tp('agreement.merge.replacedTitle', textsReplaced.length)} data-testid="merge-report-replaced">
          <p>{stage === 'preview' ? t('agreement.merge.replacedPreview') : t('agreement.merge.replacedDone')}</p>
          {list(textsReplaced, 'merge-report-replaced-list')}
        </Notice>
      ) : null}
      {repseudonymised.length ? (
        <Notice tone="info" icon={VenetianMask} data-testid="merge-report-repseudonymised">
          {tp('agreement.merge.repseudonymised', repseudonymised.length)}
        </Notice>
      ) : null}
      {revived.length ? (
        <Notice tone="info" title={tp('agreement.merge.revivedTitle', revived.length)} data-testid="merge-report-revived">
          <p>{t('agreement.merge.revivedBody')}</p>
          {list(
            revived.map((r) => ({ documentId: r.id, name: r.name, ...(r.kind === 'code' ? { kind: 'code' } : {}) })),
            'merge-report-revived-list',
          )}
        </Notice>
      ) : null}
      {reanchored || removedCodings ? (
        <ul className="merge-report__notes t-secondary" data-testid="merge-report-codings">
          {reanchored ? <li>{tp('agreement.merge.reanchored', reanchored)}</li> : null}
          {removedCodings ? <li>{tp('agreement.merge.removedCodings', removedCodings)}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

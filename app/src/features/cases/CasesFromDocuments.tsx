import React, { useMemo, useState } from 'react';
import { Files } from 'lucide-react';
import { casesFromDocuments } from '../../services/cases';
import type { DocumentRow } from '../../services/queries';
import { useProject } from '../../shell/AppState';
import { useUndo } from '../../shell/undo';
import { useI18n } from '../../ui/i18n';
import { Button } from '../../ui/components/Button';
import { Checkbox } from '../../ui/components/Choice';
import { Dialog } from '../../ui/components/Dialog';
import { EmptyState } from '../../ui/components/Feedback';
import { useToast } from '../../ui/components/Toast';

/**
 * One case per document, named after it: the usual start when each interview is one
 * participant. Documents that already belong to a case are not offered.
 */
export function CasesFromDocuments({ docs, onClose }: { docs: DocumentRow[]; onClose: () => void }) {
  const { t, tp } = useI18n();
  const project = useProject();
  const { record } = useUndo();
  const toast = useToast();
  const free = useMemo(() => docs.filter((d) => !d.document.case_id), [docs]);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(free.map((d) => d.document.id)));
  const [busy, setBusy] = useState(false);
  const chosen = free.filter((d) => picked.has(d.document.id));
  const all = chosen.length === free.length && free.length > 0;

  const run = async () => {
    if (!chosen.length) return;
    setBusy(true);
    try {
      const r = await casesFromDocuments(
        project,
        chosen.map((d) => d.document.id),
      );
      record(r.undo);
      toast.show({ message: t('cases.fromDocs.done', { created: tp('common.count.cases', r.created), linked: tp('common.count.documents', r.linked) }), tone: 'success' });
      onClose();
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      dismissible={!busy}
      title={t('cases.fromDocs.title')}
      description={t('cases.fromDocs.intro')}
      data-testid="cases-from-docs-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void run()} disabled={!chosen.length} busy={busy} data-testid="cases-from-docs-run">
            {chosen.length ? tp('cases.fromDocs.run', chosen.length) : t('cases.fromDocs.runNone')}
          </Button>
        </>
      }
    >
      {free.length === 0 ? (
        <EmptyState icon={Files} title={t('cases.fromDocs.noneTitle')}>
          {t('cases.fromDocs.noneBody')}
        </EmptyState>
      ) : (
        <div className="pick">
          <div className="pick__head">
            <Checkbox
              checked={all}
              indeterminate={!all && chosen.length > 0}
              onChange={(on) => setPicked(on ? new Set(free.map((d) => d.document.id)) : new Set())}
              label={t('cases.fromDocs.all', { n: free.length })}
              data-testid="cases-from-docs-all"
            />
          </div>
          <ul className="pick__list">
            {free.map((d) => (
              <li key={d.document.id}>
                <Checkbox
                  checked={picked.has(d.document.id)}
                  onChange={(on) =>
                    setPicked((cur) => {
                      const next = new Set(cur);
                      on ? next.add(d.document.id) : next.delete(d.document.id);
                      return next;
                    })
                  }
                  label={d.document.name}
                  description={d.groupNames.length ? d.groupNames.join(', ') : undefined}
                  data-testid={`cases-from-docs-${d.document.id}`}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

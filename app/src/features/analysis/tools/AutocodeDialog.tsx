import React, { useEffect, useMemo, useState } from 'react';
import { autocode, type AutocodeExpand } from '../../../services/codings';
import { createCode } from '../../../services/codes';
import { combineUndo } from '../../../services/undo';
import { useProject } from '../../../shell/AppState';
import { useUndo } from '../../../shell/undo';
import { Button } from '../../../ui/components/Button';
import { RadioGroup } from '../../../ui/components/Choice';
import { Dialog } from '../../../ui/components/Dialog';
import { Notice } from '../../../ui/components/Feedback';
import { Select, TextField } from '../../../ui/components/Field';
import { useToast } from '../../../ui/components/Toast';
import { useI18n } from '../../../ui/i18n';
import { useAnalysisData } from '../parts/data';

export interface AutocodeHits {
  hits: { documentId: string; start: number; end: number }[];
  documents: number;
}

const NEW = '__new__';

/**
 * "Code all hits…": applies an existing code, or a new one, to every hit of a search, widened
 * to the sentence or paragraph if asked. One step of Undo takes it all back.
 */
export function AutocodeDialog({ open, onClose, load, query }: { open: boolean; onClose: () => void; load: () => AutocodeHits; query: string }) {
  const { t, tp } = useI18n();
  const project = useProject();
  const { record } = useUndo();
  const toast = useToast();
  const { lines } = useAnalysisData();
  const codable = useMemo(() => lines.filter((l) => l.codable), [lines]);
  const [codeId, setCodeId] = useState<string>(NEW);
  const [name, setName] = useState('');
  const [expand, setExpand] = useState<AutocodeExpand>('hit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hits = useMemo(() => (open ? load() : { hits: [], documents: 0 }), [open, load]);

  useEffect(() => {
    if (!open) return;
    setName(query.replace(/["*()]/g, '').replace(/\s+(AND|OR|NOT)\s+/g, ' ').trim().slice(0, 60));
    setError(null);
    setBusy(false);
  }, [open, query]);

  const submit = async () => {
    if (busy) return;
    if (codeId === NEW && !name.trim()) {
      setError(t('analysis.autocode.nameRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let target = codeId;
      let made: Awaited<ReturnType<typeof createCode>> | null = null;
      if (codeId === NEW) {
        made = await createCode(project, { name: name.trim() });
        target = made.code.id;
      }
      try {
        const res = await autocode(project, { codeId: target, hits: hits.hits, expand });
        const codeName = made?.code.name ?? codable.find((l) => l.id === target)?.name ?? '';
        record(made ? combineUndo('coding.autocode', `“${codeName}”`, [made.undo, res.undo]) : res.undo);
        toast.show({
          message: res.count ? tp('analysis.autocode.done', res.count, { code: codeName }) : t('analysis.autocode.nothing', { code: codeName }),
          tone: res.count ? 'success' : 'neutral',
        });
        onClose();
      } catch (e) {
        if (made) await made.undo.undo().catch(() => undefined);
        throw e;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const options = [{ value: NEW, label: t('analysis.autocode.newCode') }, ...codable.map((l) => ({ value: l.id, label: `${' '.repeat(l.depth)}${l.name}` }))];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('analysis.autocode.title')}
      description={tp('analysis.autocode.summary', hits.hits.length, { docs: tp('common.count.documents', hits.documents) })}
      onSubmit={() => void submit()}
      dismissible={!busy}
      data-testid="autocode-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" busy={busy} disabled={!hits.hits.length} data-testid="autocode-apply">
            {t('analysis.autocode.apply')}
          </Button>
        </>
      }
    >
      <div className="an-dialog">
        <Select<string> label={t('analysis.autocode.code')} value={codeId} onChange={setCodeId} options={options} data-testid="autocode-code" />
        {codeId === NEW ? <TextField label={t('analysis.autocode.newName')} value={name} onChange={setName} maxLength={120} data-testid="autocode-name" data-autofocus /> : null}
        <RadioGroup<AutocodeExpand>
          label={t('analysis.autocode.expand')}
          value={expand}
          onChange={setExpand}
          options={[
            { value: 'hit', label: t('analysis.autocode.expandHit'), description: t('analysis.autocode.expandHitHint') },
            { value: 'sentence', label: t('analysis.autocode.expandSentence'), description: t('analysis.autocode.expandSentenceHint') },
            { value: 'paragraph', label: t('analysis.autocode.expandParagraph'), description: t('analysis.autocode.expandParagraphHint') },
          ]}
          data-testid="autocode-expand"
        />
        <p className="an-dialog__note">{t('analysis.autocode.note')}</p>
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </div>
    </Dialog>
  );
}

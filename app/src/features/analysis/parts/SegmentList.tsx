import React, { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { Coding } from '../../../core/model/types';
import type { CooccurrencePair } from '../../../core/qda/cooccurrence';
import { useRouter } from '../../../shell/router';
import { Button } from '../../../ui/components/Button';
import { useI18n } from '../../../ui/i18n';
import { useAnalysisData } from './data';

const PAGE = 100;

function excerpt(text: string, max = 320): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function useShowMore(total: number) {
  const [shown, setShown] = useState(PAGE);
  return { shown: Math.min(shown, total), more: () => setShown((n) => n + PAGE), hasMore: total > shown };
}

/** Coded segments with their document and code, each opening the workbench at the passage. */
export function SegmentList({ codings, testId = 'analysis-segments' }: { codings: readonly Coding[]; testId?: string }) {
  const { t, tp } = useI18n();
  const { go } = useRouter();
  const { docById, codeById } = useAnalysisData();
  const { shown, more, hasMore } = useShowMore(codings.length);
  if (!codings.length) return <p className="an-seg__none">{t('analysis.segments.none')}</p>;
  return (
    <div className="an-seg" data-testid={testId}>
      <ol className="an-seg__list">
        {codings.slice(0, shown).map((c) => {
          const code = codeById.get(c.code_id);
          return (
            <li key={c.id} className="an-seg__item">
              <button
                type="button"
                className="an-seg__open"
                onClick={() => go({ name: 'workbench', docId: c.document_id, select: { start: c.start, end: c.end } })}
                data-testid={`${testId}-open`}
              >
                <span className="an-seg__meta">
                  <span className="an-seg__doc">{docById.get(c.document_id)?.name ?? '—'}</span>
                  {code ? (
                    <span className="an-seg__code">
                      <span className="an-dot" style={{ background: code.color }} aria-hidden />
                      {code.name}
                    </span>
                  ) : null}
                  <ArrowUpRight size={14} aria-hidden className="an-seg__go" />
                </span>
                <span className="an-seg__text reading-snippet">{excerpt(c.text)}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {hasMore ? (
        <div className="an-seg__more">
          <Button size="sm" variant="ghost" onClick={more}>
            {tp('analysis.segments.more', codings.length - shown)}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Co-occurring pairs: both segments, opening the workbench on the span they cover together. */
export function PairList({ pairs, codeA, codeB }: { pairs: readonly CooccurrencePair[]; codeA: string; codeB: string }) {
  const { t, tp } = useI18n();
  const { go } = useRouter();
  const { docById, codeById, codingById } = useAnalysisData();
  const { shown, more, hasMore } = useShowMore(pairs.length);
  const a = codeById.get(codeA);
  const b = codeById.get(codeB);
  if (!pairs.length) return <p className="an-seg__none">{t('analysis.cooc.noPairs')}</p>;
  return (
    <div className="an-seg" data-testid="analysis-pairs">
      <ol className="an-seg__list">
        {pairs.slice(0, shown).map((p, i) => {
          const ca = codingById.get(p.aId);
          const cb = codingById.get(p.bId);
          const start = Math.min(p.aStart, p.bStart);
          const end = Math.max(p.aEnd, p.bEnd);
          return (
            <li key={`${p.aId}:${p.bId}:${i}`} className="an-seg__item">
              <button type="button" className="an-seg__open" onClick={() => go({ name: 'workbench', docId: p.documentId, select: { start, end } })} data-testid="analysis-pairs-open">
                <span className="an-seg__meta">
                  <span className="an-seg__doc">{docById.get(p.documentId)?.name ?? '—'}</span>
                  <ArrowUpRight size={14} aria-hidden className="an-seg__go" />
                </span>
                <span className="an-seg__pair">
                  <span className="an-seg__code">
                    <span className="an-dot" style={{ background: a?.color }} aria-hidden />
                    {a?.name}
                  </span>
                  <span className="an-seg__text reading-snippet">{excerpt(ca?.text ?? '', 220)}</span>
                </span>
                <span className="an-seg__pair">
                  <span className="an-seg__code">
                    <span className="an-dot" style={{ background: b?.color }} aria-hidden />
                    {b?.name}
                  </span>
                  <span className="an-seg__text reading-snippet">{excerpt(cb?.text ?? '', 220)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {hasMore ? (
        <div className="an-seg__more">
          <Button size="sm" variant="ghost" onClick={more}>
            {tp('analysis.segments.more', pairs.length - shown)}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

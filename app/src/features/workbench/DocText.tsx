import React, { memo, type CSSProperties } from 'react';
import { Play } from 'lucide-react';
import { type MarkStyle, runPaint } from './model/highlight';
import { formatTime, type Para } from './model/paragraphs';
import { buildRuns, type FindMark, type Mark } from './model/runs';

// The document text: one memoised <p> per line of the text, cut into runs (see model/runs.ts).
// A paragraph re-renders only when what it shows changes — its key covers its runs and their
// paint — so applying a code redraws one paragraph, not a thousand.

export interface RunView {
  start: number;
  end: number;
  text: string;
  label: boolean;
  ids: string;
  find: number;
  style?: CSSProperties;
}

export interface ParaView {
  para: Para;
  runs: RunView[];
  key: string;
}

export interface ViewCache {
  text: string;
  byIndex: Map<number, ParaView>;
}

/**
 * Builds every paragraph's view, reusing the previous object for a paragraph whose key did not
 * change (so React.memo skips it).
 */
export function buildViews(
  text: string,
  paras: readonly Para[],
  marks: readonly (Mark[] | undefined)[],
  finds: readonly (FindMark[] | undefined)[],
  styles: ReadonlyMap<string, MarkStyle>,
  dark: boolean,
  cache: ViewCache,
): ParaView[] {
  if (cache.text !== text) {
    cache.text = text;
    cache.byIndex.clear();
  }
  const paintCache = new Map<string, CSSProperties | undefined>();
  const out: ParaView[] = new Array(paras.length);
  for (const p of paras) {
    const runs = p.blank ? [] : buildRuns(p, marks[p.index] ?? [], finds[p.index] ?? []);
    let key = `${p.start}:${p.end}:${p.labelEnd}:${p.ms}`;
    const rv: RunView[] = runs.map((r) => {
      const ids = r.ids.join(' ');
      let style = paintCache.get(ids);
      if (!paintCache.has(ids)) {
        const paint = runPaint(r.ids, styles, dark);
        style = paint.background ? { background: paint.background } : undefined;
        paintCache.set(ids, style);
      }
      key += `|${r.start}-${r.end}-${ids}-${r.find}-${style?.background ?? ''}`;
      return { start: r.start, end: r.end, text: text.slice(r.start, r.end), label: r.label, ids, find: r.find, style };
    });
    const prev = cache.byIndex.get(p.index);
    if (prev && prev.key === key) out[p.index] = prev;
    else {
      const v = { para: p, runs: rv, key };
      cache.byIndex.set(p.index, v);
      out[p.index] = v;
    }
  }
  return out;
}

const Paragraph = memo(function Paragraph({ view, seekLabel }: { view: ParaView; seekLabel: string | null }) {
  const p = view.para;
  if (p.blank) return <p className="wb-p wb-p--blank" data-pi={p.index} data-ps={p.start} data-pe={p.end} />;
  return (
    <p className={p.labelEnd > p.start ? 'wb-p wb-p--turn' : 'wb-p'} data-pi={p.index} data-ps={p.start} data-pe={p.end}>
      {p.ms !== null && seekLabel !== null ? (
        <span className="wb-ts" data-chrome="" contentEditable={false} suppressContentEditableWarning>
          <button type="button" tabIndex={-1} className="wb-ts__btn" data-seek={p.ms} aria-label={`${seekLabel} ${formatTime(p.ms)}`}>
            <Play size={10} aria-hidden className="wb-ts__play" strokeWidth={2.25} />
            <span className="wb-ts__time">{formatTime(p.ms)}</span>
          </button>
        </span>
      ) : null}
      {view.runs.map((r) => (
        <span
          key={r.start}
          className={`wb-r${r.label ? ' wb-r--label' : ''}${r.ids ? ' wb-r--coded' : ''}${r.find >= 0 ? ' wb-r--find' : ''}`}
          data-s={r.start}
          data-e={r.end}
          data-c={r.ids || undefined}
          data-f={r.find >= 0 ? r.find : undefined}
          style={r.style}
        >
          {r.text}
        </span>
      ))}
    </p>
  );
});

export interface DocTextProps {
  views: readonly ParaView[];
  /** Accessible name prefix of timestamp buttons ("Play from"), or null to hide timestamps. */
  seekLabel: string | null;
}

/** All paragraphs. Memoised on the views array, which keeps its identity when nothing changed. */
export const DocTextBody = memo(function DocTextBody({ views, seekLabel }: DocTextProps) {
  return (
    <>
      {views.map((v) => (
        <Paragraph key={v.para.index} view={v} seekLabel={seekLabel} />
      ))}
    </>
  );
});

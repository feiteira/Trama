import React, { forwardRef, useMemo, useState } from 'react';
import type { WordCount } from '../../../core/qda/wordfreq';
import { CHROME, rampColor, type Theme } from '../lib/heat';
import { layoutCloud } from '../lib/wordcloud';
import { ChartTip } from './ChartTip';
import { textWidth } from './measure';
import { useSize } from './useSize';

/**
 * The most frequent words, sized by count (area) and placed along a spiral, most frequent at
 * the centre. Deterministic. Each word is a button (Tab, Enter) that shows it in context; the
 * table beside it is the accessible equivalent with every count.
 */
export const WordCloud = forwardRef<SVGSVGElement, { words: readonly WordCount[]; theme: Theme; label: string; onWord: (w: string) => void; tip: (w: WordCount) => React.ReactNode }>(function WordCloud(
  { words, theme, label, onWord, tip },
  ref,
) {
  const [frame, size] = useSize<HTMLDivElement>();
  const W = Math.max(320, size.width || 720);
  const H = Math.max(260, Math.min(560, Math.round(W * 0.56)));
  const placed = useMemo(
    () => layoutCloud(words, { width: W, height: H, minSize: 12, maxSize: Math.min(60, H / 5.5), measure: (w, s) => textWidth(w, s, 560) + 2, gap: 4 }),
    [words, W, H],
  );
  const [hover, setHover] = useState<number | null>(null);
  const c = CHROME[theme];
  const byWord = useMemo(() => new Map(words.map((w) => [w.word, w])), [words]);
  const h = hover !== null ? placed[hover] : undefined;
  return (
    <div className="an-chart an-cloud" ref={frame} data-testid="wordcloud">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="group" aria-label={label} className="an-cloud__svg">
        {placed.map((p, i) => (
          <text
            key={p.word}
            x={p.x}
            y={p.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={p.size}
            fontWeight={560}
            // Darker (light paper) or lighter (dark paper) with frequency: one hue, as the heat scales.
            fill={p.weight > 0.18 ? rampColor(0.45 + 0.55 * p.weight, theme) : c.ink2}
            opacity={hover !== null && hover !== i ? 0.35 : 1}
            tabIndex={0}
            role="button"
            aria-label={`${p.word}: ${p.count}`}
            className="an-cloud__word"
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            onClick={() => onWord(p.word)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onWord(p.word);
              }
            }}
            data-testid="wordcloud-word"
          >
            {p.word}
          </text>
        ))}
      </svg>
      {h && byWord.get(h.word) ? (
        <ChartTip x={h.x} y={h.y - h.height / 2} bounds={size}>
          {tip(byWord.get(h.word)!)}
        </ChartTip>
      ) : null}
    </div>
  );
});

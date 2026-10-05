import React, { memo } from 'react';
import type { MarkState } from './model/highlight';

// Coding stripes in the right margin, as on a printed transcript: one bar per coded segment
// spanning its lines, side by side where segments overlap, with the code's name written along
// the bar when it is tall enough. Positions are measured by the viewer (see Viewer.tsx).

export interface StripeGeo {
  id: string;
  name: string;
  color: string;
  top: number;
  height: number;
  lane: number;
  /** Width of each lane in this stripe's cluster; names show only at full width. */
  laneWidth: number;
  state: MarkState;
}

export interface StripesProps {
  items: readonly StripeGeo[];
  label: (name: string) => string;
  onOpen: (id: string, el: HTMLElement) => void;
  onHover: (id: string | null) => void;
}

/** A label needs this much height before any of it shows (px). */
const LABEL_MIN = 34;
const FULL_LANE = 20;

export const Stripes = memo(function Stripes({ items, label, onOpen, onHover }: StripesProps) {
  return (
    <>
      {items.map((s) => {
        const showLabel = s.laneWidth >= FULL_LANE && s.height >= LABEL_MIN;
        return (
          <button
            key={s.id}
            type="button"
            tabIndex={-1}
            className={`wb-stripe wb-stripe--${s.state}`}
            style={{ top: s.top, height: Math.max(6, s.height), left: s.lane * s.laneWidth, width: s.laneWidth - 2 }}
            title={s.name}
            aria-label={label(s.name)}
            data-testid="stripe"
            data-coding={s.id}
            onClick={(e) => onOpen(s.id, e.currentTarget)}
            onPointerEnter={() => onHover(s.id)}
            onPointerLeave={() => onHover(null)}
          >
            <span className="wb-stripe__bar" style={{ background: s.color }} />
            {showLabel ? (
              <span className="wb-stripe__label" style={{ maxHeight: s.height }}>
                {s.name}
              </span>
            ) : null}
          </button>
        );
      })}
    </>
  );
});

import type { Coding } from '../../../core/model/types';
import { withAlpha } from '../../../ui/color';
import { assignLanes } from './lanes';

// How codings look inside the text. Each coding tints its passage with its code's colour at a
// low alpha (overlaps stack, so a passage two codes share reads darker) and draws a thin band
// under the text. Overlapping codings take different band levels (lanes over text offsets),
// so each stays distinguishable even where three codes meet.

export type CoderFilter = { kind: 'all' } | { kind: 'me' } | { kind: 'coder'; id: string };

export function parseCoderFilter(raw: string | null | undefined): CoderFilter {
  if (raw === 'me') return { kind: 'me' };
  if (raw && raw.startsWith('coder:')) return { kind: 'coder', id: raw.slice(6) };
  return { kind: 'all' };
}

export function coderFilterKey(f: CoderFilter): string {
  return f.kind === 'coder' ? `coder:${f.id}` : f.kind;
}

export function filterByCoder<C extends Pick<Coding, 'coder_id'>>(codings: readonly C[], f: CoderFilter, meId: string): C[] {
  if (f.kind === 'all') return codings.slice();
  const id = f.kind === 'me' ? meId : f.id;
  return codings.filter((c) => c.coder_id === id);
}

export type MarkState = 'normal' | 'active' | 'dim';

export interface MarkStyle {
  color: string;
  /** Underline level, 0 nearest the text's bottom edge. */
  band: number;
  state: MarkState;
}

/** Bands drawn at most; deeper overlaps still tint the text. */
export const MAX_BANDS = 4;

export function markStyles(
  codings: readonly Pick<Coding, 'id' | 'code_id' | 'start' | 'end'>[],
  colorOf: (codeId: string) => string,
  /** The active code and the codes below it; `activeOnly` dims every other coding. */
  opts: { activeCodeIds: ReadonlySet<string> | null; activeOnly: boolean },
): Map<string, MarkStyle> {
  const lanes = assignLanes(codings.map((c) => ({ id: c.id, lo: c.start, hi: c.end })));
  const out = new Map<string, MarkStyle>();
  for (const c of codings) {
    const active = !!opts.activeCodeIds?.has(c.code_id);
    const state: MarkState = active ? 'active' : opts.activeOnly && opts.activeCodeIds?.size ? 'dim' : 'normal';
    out.set(c.id, { color: colorOf(c.code_id), band: lanes.lane.get(c.id) ?? 0, state });
  }
  return out;
}

export interface RunPaint {
  /** CSS `background` layers: bands on top, then the tints. */
  background?: string;
}

const FILL: Record<MarkState, number> = { normal: 0.15, active: 0.3, dim: 0.035 };
const FILL_DARK: Record<MarkState, number> = { normal: 0.22, active: 0.4, dim: 0.06 };
const BAND: Record<MarkState, number> = { normal: 0.75, active: 1, dim: 0.22 };
export const BAND_PX = 2;

/** The paint of a run covered by `ids` (empty object for plain text). */
export function runPaint(ids: readonly string[], styles: ReadonlyMap<string, MarkStyle>, dark = false): RunPaint {
  if (!ids.length) return {};
  const fills: string[] = [];
  const bands: { band: number; css: string }[] = [];
  const fill = dark ? FILL_DARK : FILL;
  // Several translucent layers multiply: soften each so a triple overlap is not opaque.
  const damp = ids.length > 1 ? 0.8 : 1;
  for (const id of ids) {
    const s = styles.get(id);
    if (!s) continue;
    const c = withAlpha(s.color, fill[s.state] * damp);
    fills.push(`linear-gradient(${c}, ${c})`);
    if (s.band < MAX_BANDS) bands.push({ band: s.band, css: withAlpha(s.color, BAND[s.state]) });
  }
  if (!fills.length) return {};
  bands.sort((a, b) => a.band - b.band);
  // A band is a 2px strip at its level above the bottom edge; levels never cover each other.
  const layers = bands.map((b) => `linear-gradient(${b.css}, ${b.css}) 0 calc(100% - ${b.band * BAND_PX}px) / 100% ${BAND_PX}px no-repeat`);
  return { background: [...layers, ...fills].join(', ') };
}

// A small document model shared by the Word (docx.ts) and HTML (html.ts) report writers, so a
// report (codebook, coded segments, agreement) is built once and written in either format.
import { HEX_COLOR } from '../../model/types';

export interface RunStyle {
  bold?: boolean;
  italic?: boolean;
  /** Text colour, #rrggbb. */
  color?: string;
  /** Background shading, #rrggbb (code colour chips, highlighted segments). */
  shade?: string;
  /** Monospaced (identifiers, positions). */
  mono?: boolean;
  /** Smaller text (sources, metadata lines). */
  small?: boolean;
}

export type Run = string | ({ text: string } & RunStyle);
/** Inline content: plain text, or styled runs. `\n` is a line break, `\t` a tab. */
export type Inline = string | readonly Run[];
export type TableCell = Inline | number | null | undefined;

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: Inline }
  | { type: 'paragraph'; text: Inline; style?: 'normal' | 'quote' | 'small' }
  | { type: 'list'; items: readonly Inline[]; ordered?: boolean }
  | {
      type: 'table';
      header?: readonly TableCell[];
      rows: readonly (readonly TableCell[])[];
      /** Relative column widths (any unit); equal when omitted. */
      widths?: readonly number[];
    }
  | { type: 'pageBreak' };

export interface ReportDocument {
  title: string;
  /** BCP 47 language of the report text (en-GB, pt-PT, es-ES). */
  lang?: string;
  /** Shown under the title (project name, date). */
  subtitle?: string;
  /** Producer for the file's metadata, e.g. "Trama 0.1.0". */
  generator?: string;
  blocks: readonly Block[];
}

/** A small coloured square, for a code's colour next to its name. */
export function chip(color: string): Run {
  return { text: '   ', shade: color };
}

/** The runs of inline content. */
export function runsOf(inline: Inline | number | null | undefined): Exclude<Run, string>[] {
  if (inline === null || inline === undefined) return [];
  if (typeof inline === 'number') return [{ text: Number.isFinite(inline) ? String(inline) : '' }];
  if (typeof inline === 'string') return [{ text: inline }];
  return inline.map((r) => (typeof r === 'string' ? { text: r } : r));
}

/** A colour safe to put in markup, or null: only #rrggbb gets through. */
export function safeColor(c: string | undefined): string | null {
  if (!c) return null;
  const v = c.trim().toLowerCase();
  return HEX_COLOR.test(v) ? v : null;
}

/** Black or white, whichever reads better on the given background. */
export function contrastText(bg: string): '#000000' | '#ffffff' {
  const n = parseInt(bg.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.179 ? '#000000' : '#ffffff';
}

/** Columns of a table: its widest row (at least one). */
export function columnCount(header: readonly unknown[] | undefined, rows: readonly (readonly unknown[])[]): number {
  let n = Math.max(1, header?.length ?? 0);
  for (const r of rows) if (r.length > n) n = r.length;
  return n;
}

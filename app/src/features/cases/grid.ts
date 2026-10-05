// Keyboard movement in the cases grid, spreadsheet-style. Pure, so it is tested without a DOM.

export interface Pos {
  row: number;
  col: number;
}

export interface GridSize {
  rows: number;
  cols: number;
}

export interface Mods {
  ctrl?: boolean;
  shift?: boolean;
}

/** Keys that move the active cell. */
export const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Tab']);

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** A position inside the grid (the grid shrank: a case was deleted or filtered out). */
export function clampPos(pos: Pos, size: GridSize): Pos {
  if (size.rows <= 0 || size.cols <= 0) return { row: 0, col: 0 };
  return { row: clamp(pos.row, 0, size.rows - 1), col: clamp(pos.col, 0, size.cols - 1) };
}

/**
 * Where a key moves the active cell, or null when the key leaves the grid (Tab past the last
 * cell, Shift+Tab before the first) so the browser moves the focus on. Ctrl+arrows and
 * Ctrl+Home/End jump to the edges; Tab wraps to the next row like a spreadsheet.
 */
export function moveCell(pos: Pos, key: string, size: GridSize, mods: Mods = {}, page = 10): Pos | null {
  if (size.rows <= 0 || size.cols <= 0) return null;
  const { row, col } = clampPos(pos, size);
  const lastRow = size.rows - 1;
  const lastCol = size.cols - 1;
  switch (key) {
    case 'ArrowUp':
      return { row: mods.ctrl ? 0 : Math.max(0, row - 1), col };
    case 'ArrowDown':
      return { row: mods.ctrl ? lastRow : Math.min(lastRow, row + 1), col };
    case 'ArrowLeft':
      return { row, col: mods.ctrl ? 0 : Math.max(0, col - 1) };
    case 'ArrowRight':
      return { row, col: mods.ctrl ? lastCol : Math.min(lastCol, col + 1) };
    case 'Home':
      return mods.ctrl ? { row: 0, col: 0 } : { row, col: 0 };
    case 'End':
      return mods.ctrl ? { row: lastRow, col: lastCol } : { row, col: lastCol };
    case 'PageUp':
      return { row: Math.max(0, row - page), col };
    case 'PageDown':
      return { row: Math.min(lastRow, row + page), col };
    case 'Tab': {
      const index = row * size.cols + col + (mods.shift ? -1 : 1);
      if (index < 0 || index >= size.rows * size.cols) return null;
      return { row: Math.floor(index / size.cols), col: index % size.cols };
    }
    default:
      return { row, col };
  }
}

/** Whether a key press should start editing the cell with that character (typing over it). */
export function startsTyping(key: string, mods: Mods & { alt?: boolean; meta?: boolean }): boolean {
  return key.length === 1 && key !== ' ' && !mods.ctrl && !mods.alt && !mods.meta;
}

/** Rows between two positions (inclusive), for Shift+click range selection. */
export function rowRange(a: number, b: number): number[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

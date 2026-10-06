// Keeping a keyboard-focused cell of a scrolled chart in view.

export interface View {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The scroll position that brings `box` (in content coordinates) into a view of `view`'s size,
 * moving as little as possible. When the view moves back towards the start, it keeps `lead`
 * pixels before the box in sight too (a row's label to the left of its cells), when it can.
 */
export function revealScroll(view: View, box: Box, lead: { x?: number; y?: number } = {}): { left: number; top: number } {
  const axis = (pos: number, size: number, start: number, len: number, before: number): number => {
    if (start < pos) return Math.max(0, start - Math.min(before, Math.max(0, size - len)));
    if (start + len > pos + size) return start + len - size;
    return pos;
  };
  return {
    left: axis(view.left, view.width, box.x, box.w, lead.x ?? 0),
    top: axis(view.top, view.height, box.y, box.h, lead.y ?? 0),
  };
}

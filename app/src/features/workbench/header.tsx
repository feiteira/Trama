import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// The screen header runs across all three panes of the workbench; whichever centre view shows
// (the viewer or the overview) fills it through this slot.

export const HeaderSlot = createContext<HTMLElement | null>(null);

/** Renders `children` (a ScreenHeader) in the workbench's header row. */
export function WorkbenchHeader({ children }: { children: ReactNode }) {
  const slot = useContext(HeaderSlot);
  return slot ? createPortal(children, slot) : null;
}

/** Width of the header row (0 until measured), for toolbars that fold into a menu when narrow. */
export function useHeaderWidth(): number {
  const slot = useContext(HeaderSlot);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!slot || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(slot.clientWidth));
    ro.observe(slot);
    setW(slot.clientWidth);
    return () => ro.disconnect();
  }, [slot]);
  return w;
}

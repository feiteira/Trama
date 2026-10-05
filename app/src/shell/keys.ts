import { useCallback, useEffect, useState } from 'react';
import { useAppState } from './AppState';

/** How a Ctrl shortcut is written on this computer: "Ctrl+K", or "⌘K" on a Mac. */
export function useKeyLabel(): (key: string) => string {
  const { platform } = useAppState();
  const [mac, setMac] = useState(false);
  useEffect(() => {
    let live = true;
    platform
      .info()
      .then((i) => live && setMac(i.os === 'macos'))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [platform]);
  return useCallback((key: string) => (mac ? `⌘${key}` : `Ctrl+${key}`), [mac]);
}

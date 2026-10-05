import { useCallback, useEffect, useRef, useState } from 'react';
import { useProject } from '../../../shell/AppState';
import { type Allowed, readSettings, settingsKey, writeSettings } from '../lib/settings';

/** A tool's settings, remembered per project on this computer (see lib/settings.ts). */
export function useToolSettings<T extends object>(tool: string, defaults: T, allowed: Allowed<T> = {}): [T, (patch: Partial<T>) => void] {
  const project = useProject();
  const key = settingsKey(project.id, tool);
  const [value, setValue] = useState<T>(() => readSettings(key, defaults, allowed));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    writeSettings(key, value);
  }, [key, value]);
  const patch = useCallback((p: Partial<T>) => setValue((cur) => ({ ...cur, ...p })), []);
  return [value, patch];
}

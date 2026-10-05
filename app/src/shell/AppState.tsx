import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { UiLocale } from '../core/i18n/languages';
import { EXAMPLE_KDF } from '../demo/exampleConstants';
import type { Platform } from '../platform/types';
import { Library, type LibraryOptions } from '../services/library';
import type { Project } from '../services/project';
import { type DevicePrefs, readPrefs, writePrefs } from '../services/prefs';
import type { Route } from './router';
import { oneAtATime, type Saver, type SaverOptions, Savers } from './savers';
import { watchActivity, watchShortcuts } from './activity.web';

export { SAVE_STAGE, type Saver, type SaverOptions } from './savers';

// Top-level state: the platform, device preferences, and how far in the researcher is —
// nothing on this computer yet (welcome), a locked library, the library's project list, or a
// project open. Everything inside the library lives encrypted; this state holds only the
// unlocked Library and the open Project, both of which forget their keys on lock.

/** Why the unlock screen shows: Trama locked itself (`idle`), or projects without a keyring. */
export type LockedReason = 'idle' | 'noKeyring';

export type Phase =
  | { name: 'loading' }
  | { name: 'welcome' }
  | { name: 'locked'; reason?: LockedReason }
  | { name: 'library'; library: Library }
  | { name: 'project'; library: Library; project: Project; initialRoute?: Route };

export interface Prefs extends DevicePrefs {
  /** The researcher's name: the first coder of the projects they create. Device-local. */
  coderName: string;
}

/** prefs.json key of the coder name (see the report on services/prefs.ts). */
const CODER_NAME_KEY = 'coder_name';

export interface AppStateValue {
  platform: Platform;
  /** The example library (fictional; in memory, or the desktop `--example` folder). */
  example: boolean;
  phase: Phase;
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => Promise<void>;
  /** Options for Library.create/unlock (fast key derivation in the demo). */
  libraryOptions: LibraryOptions;
  /** After create or unlock: opens the project used last, else shows the project list. */
  unlocked: (library: Library) => Promise<void>;
  /** Opens a project of the unlocked library (savers of the open one run first). */
  openProject: (id: string, route?: Route) => Promise<void>;
  /** Shows a project the library has just opened (created, imported). */
  enterProject: (project: Project, route?: Route) => void;
  /** Closes the open project and shows the project list. */
  closeProject: () => Promise<void>;
  /** Runs every saver, then locks the library. Calls made while locking share one run. */
  lock: (reason?: 'idle') => Promise<void>;
  /** True while `lock` waits for savers; the shell shows an opaque "Locking…" screen. */
  locking: boolean;
  /** The library was removed from this computer: back to the welcome screen. */
  erased: () => void;
  /** Opens the example project in memory (from the welcome screen). */
  startExample: () => Promise<void>;
  /** Leaves the in-memory example and returns to this computer's own library. */
  leaveExample: () => Promise<void>;
  /** True when the example runs in memory beside the real platform (it can be left). */
  canLeaveExample: boolean;
  registerSaver: (fn: Saver, opts?: SaverOptions) => () => void;
  runSavers: () => Promise<void>;
  /** Keeps the idle auto-lock away until the returned release is called. Prefer `useHold`. */
  hold: () => () => void;
  /**
   * Changes whenever the unlocked library reports a change (a project renamed, created,
   * deleted…), so whatever shows its list or a project's name re-renders.
   */
  libraryRevision: number;
}

const Ctx = createContext<AppStateValue | null>(null);

const systemLocale = (): string | null => (typeof navigator !== 'undefined' ? navigator.language : null);

async function loadPrefs(platform: Platform): Promise<Prefs> {
  const base = await readPrefs(platform, systemLocale());
  let coderName = '';
  try {
    coderName = (await platform.prefs.get())[CODER_NAME_KEY] ?? '';
  } catch {
    // readPrefs already logged it; no name is a fine default.
  }
  return { ...base, coderName };
}

export interface AppStateProviderProps {
  platform: Platform;
  children: ReactNode;
  /** Skip discovery and start here (the demo boots with its project open). */
  initialPhase?: Phase;
  libraryOptions?: LibraryOptions;
}

export function AppStateProvider({ platform: basePlatform, children, initialPhase, libraryOptions: baseOptions }: AppStateProviderProps) {
  const [phase, setPhase] = useState<Phase>(initialPhase ?? { name: 'loading' });
  const [prefs, setPrefsState] = useState<Prefs>({ locale: 'en', theme: 'system', autoLockMinutes: 10, lastProjectId: null, coderName: '' });
  const [prefsReady, setPrefsReady] = useState(false);
  // The in-memory example, when the researcher chose to try it from the welcome screen.
  const [examplePlatform, setExamplePlatform] = useState<Platform | null>(null);
  const [exampleFlag, setExampleFlag] = useState(false);
  const platform = examplePlatform ?? basePlatform;
  const libraryOptions = useMemo<LibraryOptions>(
    () => (examplePlatform ? { ...baseOptions, params: EXAMPLE_KDF } : baseOptions ?? {}),
    [examplePlatform, baseOptions],
  );
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  // Discovery: preferences, then what is on this computer.
  useEffect(() => {
    let live = true;
    void (async () => {
      const p = await loadPrefs(basePlatform);
      if (!live) return;
      setPrefsState(p);
      setPrefsReady(true);
      if (initialPhase) return;
      try {
        const info = await basePlatform.info();
        let state = await Library.state(basePlatform);
        if (info.example) {
          setExampleFlag(true);
          // The example folder is fictional and made afresh at every start: leftovers go.
          if (state === 'noKeyring') await basePlatform.eraseAll();
          if (state !== 'ready') {
            const { createExampleLibrary } = await import('../demo/exampleLibrary');
            const { library, project } = await createExampleLibrary(basePlatform, { locale: p.locale, coderName: p.coderName });
            if (live) setPhase({ name: 'project', library, project });
            return;
          }
          state = 'ready';
        }
        if (!live) return;
        setPhase(state === 'none' ? { name: 'welcome' } : state === 'noKeyring' ? { name: 'locked', reason: 'noKeyring' } : { name: 'locked' });
      } catch (e) {
        console.error('finding the library on this computer failed', e);
        if (live) setPhase({ name: 'locked' });
      }
    })();
    return () => {
      live = false;
    };
  }, [basePlatform, initialPhase]);

  const setPrefs = useCallback(
    async (patch: Partial<Prefs>) => {
      setPrefsState((cur) => ({ ...cur, ...patch }));
      const { coderName, ...device } = patch;
      // Saved on this computer's platform even while the in-memory example runs. A failure
      // to save is logged, not thrown: the choice still applies for this session.
      try {
        await writePrefs(basePlatform, device);
        if (coderName !== undefined) await basePlatform.prefs.set({ [CODER_NAME_KEY]: coderName.trim() });
      } catch (e) {
        console.error('saving preferences failed', e);
      }
    },
    [basePlatform],
  );

  const [savers] = useState(() => new Savers());
  const registerSaver = useCallback((fn: Saver, opts?: SaverOptions) => savers.register(fn, opts), [savers]);
  const runSavers = useCallback(() => savers.run(), [savers]);

  const holds = useRef(0);
  const hold = useCallback(() => {
    holds.current++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      holds.current--;
    };
  }, []);

  const rememberProject = useCallback(
    (id: string | null) => {
      if (examplePlatform) return;
      setPrefsState((cur) => ({ ...cur, lastProjectId: id }));
      void writePrefs(basePlatform, { lastProjectId: id }).catch((e: unknown) => console.error('saving the last project failed', e));
    },
    [basePlatform, examplePlatform],
  );

  const enterProject = useCallback(
    (project: Project, route?: Route) => {
      const cur = phaseRef.current;
      const library = cur.name === 'library' || cur.name === 'project' ? cur.library : null;
      if (!library) throw new Error('no unlocked library');
      rememberProject(project.id);
      setPhase({ name: 'project', library, project, initialRoute: route });
    },
    [rememberProject],
  );

  const openProject = useCallback(
    async (id: string, route?: Route) => {
      const cur = phaseRef.current;
      if (cur.name !== 'library' && cur.name !== 'project') throw new Error('the library is locked');
      if (cur.name === 'project') {
        if (cur.project.id === id) return;
        await runSavers();
      }
      const project = await cur.library.openProject(id);
      rememberProject(project.id);
      setPhase({ name: 'project', library: cur.library, project, initialRoute: route });
    },
    [runSavers, rememberProject],
  );

  const closeProject = useCallback(async () => {
    const cur = phaseRef.current;
    if (cur.name !== 'project') return;
    await runSavers();
    await cur.library.closeProject();
    rememberProject(null);
    setPhase({ name: 'library', library: cur.library });
  }, [runSavers, rememberProject]);

  const unlocked = useCallback(
    async (library: Library) => {
      const last = prefsRef.current.lastProjectId;
      if (last && library.projects.some((p) => p.id === last)) {
        try {
          const project = await library.openProject(last);
          setPhase({ name: 'project', library, project });
          return;
        } catch (e) {
          // The list still opens: the project screen can say what is wrong with that one.
          console.error('reopening the last project failed', e);
        }
      }
      setPhase({ name: 'library', library });
    },
    [],
  );

  // Locking keeps the screens mounted behind an opaque curtain until every saver has run, so
  // nothing writes to a closed database; only then are the project and keys let go.
  const [locking, setLocking] = useState(false);
  const lock = useMemo(
    () =>
      oneAtATime(async (reason?: 'idle') => {
        const cur = phaseRef.current;
        if (cur.name !== 'library' && cur.name !== 'project') return;
        try {
          if (cur.name === 'project') {
            setLocking(true);
            await runSavers();
          }
        } finally {
          await cur.library.lock().catch((e: unknown) => console.error('locking failed', e));
          setLocking(false);
          setPhase({ name: 'locked', reason });
        }
      }),
    [runSavers],
  );
  const lockRef = useRef(lock);
  lockRef.current = lock;

  const erased = useCallback(() => setPhase({ name: 'welcome' }), []);

  const startExample = useCallback(async () => {
    const { createExampleSession } = await import('../demo/exampleSession');
    const p = prefsRef.current;
    const session = await createExampleSession(p.locale, p.coderName);
    setExamplePlatform(session.platform);
    setPhase({ name: 'project', library: session.library, project: session.project });
  }, []);

  const leaveExample = useCallback(async () => {
    const cur = phaseRef.current;
    if (cur.name === 'library' || cur.name === 'project') await cur.library.lock().catch(() => undefined);
    setExamplePlatform(null);
    let state: Awaited<ReturnType<typeof Library.state>> = 'none';
    try {
      state = await Library.state(basePlatform);
    } catch (e) {
      console.error(e);
    }
    setPhase(state === 'none' ? { name: 'welcome' } : state === 'noKeyring' ? { name: 'locked', reason: 'noKeyring' } : { name: 'locked' });
  }, [basePlatform]);

  // The library's project list and names, followed live: a rename shows in the rail and the
  // window title at once.
  const unlockedLibrary = phase.name === 'library' || phase.name === 'project' ? phase.library : null;
  const subscribeLibrary = useCallback((fn: () => void) => (unlockedLibrary ? unlockedLibrary.subscribe(() => fn()) : () => undefined), [unlockedLibrary]);
  const libraryRevision = useSyncExternalStore(subscribeLibrary, () => unlockedLibrary?.revision ?? 0);

  // Auto-lock after the chosen minutes without keyboard, mouse or touch, unless held (an
  // import running). Checked often, so waking from sleep locks promptly.
  const unlockedPhase = phase.name === 'library' || phase.name === 'project';
  const lastActivity = useRef(Date.now());
  useEffect(() => {
    if (!unlockedPhase) return;
    lastActivity.current = Date.now();
    const stop = watchActivity(() => (lastActivity.current = Date.now()));
    const timer = setInterval(() => {
      const idleMs = Date.now() - lastActivity.current;
      if (holds.current === 0 && idleMs >= prefsRef.current.autoLockMinutes * 60_000) void lockRef.current('idle');
    }, 15_000);
    return () => {
      stop();
      clearInterval(timer);
    };
  }, [unlockedPhase]);

  // Ctrl/⌘+L locks, even over a dialog: locking is always allowed.
  useEffect(() => {
    if (!unlockedPhase) return;
    return watchShortcuts({ l: () => void lockRef.current() }, ['l']);
  }, [unlockedPhase]);

  // Closing the window: final save, then lock (keys wiped) before the process ends.
  useEffect(() => platform.onBeforeExit(() => lockRef.current()), [platform]);

  const value = useMemo<AppStateValue>(
    () => ({
      platform,
      example: examplePlatform !== null || exampleFlag,
      canLeaveExample: examplePlatform !== null,
      phase,
      prefs,
      setPrefs,
      libraryOptions,
      unlocked,
      openProject,
      enterProject,
      closeProject,
      lock,
      locking,
      erased,
      startExample,
      leaveExample,
      registerSaver,
      runSavers,
      hold,
      libraryRevision,
    }),
    [platform, examplePlatform, exampleFlag, phase, prefs, setPrefs, libraryOptions, unlocked, openProject, enterProject, closeProject, lock, locking, erased, startExample, leaveExample, registerSaver, runSavers, hold, libraryRevision],
  );
  // Nothing renders until the language is known, so no screen flashes in the wrong one.
  if (!prefsReady) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppStateValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppState outside AppStateProvider');
  return v;
}

export const usePlatform = (): Platform => useAppState().platform;

/** The unlocked library. Throws while locked. */
export function useLibrary(): Library {
  const { phase } = useAppState();
  if (phase.name !== 'library' && phase.name !== 'project') throw new Error('the library is locked');
  return phase.library;
}

/** The open project. Throws outside one (only screens inside ProjectShell may call it). */
export function useProject(): Project {
  const { phase } = useAppState();
  if (phase.name !== 'project') throw new Error('no open project');
  return phase.project;
}

export function usePrefs(): { prefs: Prefs; setPrefs: (patch: Partial<Prefs>) => Promise<void>; locale: UiLocale } {
  const { prefs, setPrefs } = useAppState();
  return { prefs, setPrefs, locale: prefs.locale };
}

/**
 * Registers `fn` as a saver for as long as the calling component is mounted. The latest `fn`
 * is the one called, so it may close over fresh state.
 */
export function useRegisterSaver(fn: Saver, opts: SaverOptions = {}): void {
  const { registerSaver } = useAppState();
  const latest = useRef(fn);
  latest.current = fn;
  const { stage, limitMs } = opts;
  useEffect(() => registerSaver(() => latest.current(), { stage, limitMs }), [registerSaver, stage, limitMs]);
}

/** Holds the idle auto-lock off while `active` is true (a long import, an export). */
export function useHold(active: boolean): void {
  const { hold } = useAppState();
  useEffect(() => (active ? hold() : undefined), [hold, active]);
}

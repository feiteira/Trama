import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronsUpDown, CircleHelp, FolderOpen, Keyboard, Library as LibraryIcon, Lock, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun } from 'lucide-react';
import { HELP_TOPICS } from '../features/help/manualModel';
import { ScreenView } from '../features/registry';
import { inkOn } from '../ui/color';
import { cx } from '../ui/cx';
import { useI18n } from '../ui/i18n';
import { NARROW_RAIL, useMediaQuery } from '../ui/media';
import { Button, IconButton } from '../ui/components/Button';
import { Spinner } from '../ui/components/Feedback';
import { Menu, type MenuEntry } from '../ui/components/Menu';
import { Tooltip } from '../ui/components/Tooltip';
import { useToast } from '../ui/components/Toast';
import { watchBack, watchShortcuts } from './activity.web';
import { arriveFocus } from './arrival';
import { BackupScheduler } from './BackupScheduler';
import { useAppState, useLibrary, useProject } from './AppState';
import { CoderGate } from './CoderGate';
import { currentHelpTopic } from './helpTopic';
import { CommandPalette } from './CommandPalette';
import { useKeyLabel } from './keys';
import { LockingScreen } from './LockingScreen';
import { initial } from './initial';
import { NAV, type NavGroup, navItem } from './nav';
import { type Route, RouterProvider, useRouter } from './router';
import { UndoProvider } from './undo';
import { useCommands } from './useCommands';
import './shell.css';

const RAIL_KEY = 'trama.rail.collapsed';

const splitKeywords = (s: string): string[] => s.split(',').map((w) => w.trim()).filter(Boolean);

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === '1';
  } catch {
    return false;
  }
}

/** The open project: navigation rail on the left, the current screen on the right. */
export function ProjectShell({ initialRoute }: { initialRoute?: Route }) {
  const project = useProject();
  const [, refresh] = useState(0);
  if (project.needsCoder) return <CoderGate onDone={() => refresh((n) => n + 1)} />;
  return (
    // A fresh history and undo stack for each project opened.
    <RouterProvider key={project.id} initial={initialRoute ?? { name: 'workbench' }}>
      <UndoProvider key={project.id}>
        <Layout />
      </UndoProvider>
    </RouterProvider>
  );
}

function Layout() {
  const { t } = useI18n();
  const key = useKeyLabel();
  const { route, routeKey, go, back, takeReturnFocus } = useRouter();
  const { lock, platform, example, canLeaveExample, leaveExample, closeProject, openProject, prefs, setPrefs } = useAppState();
  const project = useProject();
  const library = useLibrary();
  const toast = useToast();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  // Narrow windows show the rail as icons too (shell.css): the items then need the same
  // accessible names and tooltips as a rail the researcher collapsed.
  const narrow = useMediaQuery(NARROW_RAIL);
  const iconOnly = collapsed || narrow;
  const [palette, setPalette] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const switcherRef = useRef<HTMLButtonElement>(null);
  const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';

  const toggleRail = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(RAIL_KEY, c ? '0' : '1');
      } catch {
        // Not remembered (private window); it still toggles.
      }
      return !c;
    });

  useEffect(() => watchBack(back), [back]);
  // A new screen (or the project just opened): if the focus fell to the page with the old one,
  // give it to the new screen's heading, or back to what had it here before (going Back).
  useEffect(() => arriveFocus({ scope: '.shell__screen', restore: takeReturnFocus(routeKey) }), [routeKey, takeReturnFocus]);
  useEffect(() => watchShortcuts({ k: () => setPalette((p) => !p) }), []);
  // F1: the manual at this screen's topic. Not over a dialog, which would be left behind.
  const routeName = route.name;
  const helpHere = () => {
    const topic = currentHelpTopic(routeName);
    if (topic) go({ name: 'help', topic });
  };
  const helpRef = useRef(helpHere);
  helpRef.current = helpHere;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F1' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
      e.preventDefault();
      if (!document.querySelector('[aria-modal="true"]')) helpRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const projectName = project.info.name;
  useEffect(() => {
    void platform.setTitle(example ? `${projectName} · ${t('app.example.badge')} · Trama` : `${projectName} · Trama`);
  }, [platform, projectName, example, t]);
  useEffect(() => () => void platform.setTitle('Trama'), [platform]);

  const toAllProjects = () => void closeProject().catch((e: unknown) => toast.error(e));
  const open = (id: string) => void openProject(id).catch((e: unknown) => toast.error(e));
  const others = library.projects.filter((p) => p.id !== project.id).sort((a, b) => (b.opened_at ?? '').localeCompare(a.opened_at ?? ''));

  useCommands(
    () => [
      ...NAV.map((n) => ({
        id: `nav.${n.name}`,
        label: t('app.commands.goTo', { screen: t(n.label) }),
        keywords: [t(n.label), ...(n.keywords ? splitKeywords(t(n.keywords)) : [])],
        group: t('app.commands.groupGo'),
        icon: n.icon,
        run: () => go({ name: n.name } as Route),
      })),
      // Help registers its own while it shows.
      ...(routeName !== 'help'
        ? [
            { id: 'app.helpHere', label: t('app.help.button'), group: t('app.commands.groupApp'), icon: CircleHelp, shortcut: 'F1', run: () => helpRef.current() },
            {
              id: 'app.shortcuts',
              label: t('app.commands.shortcuts'),
              keywords: splitKeywords(t('app.commands.shortcutsKeywords')),
              group: t('app.commands.groupApp'),
              icon: Keyboard,
              run: () => go({ name: 'help', topic: HELP_TOPICS.shortcuts }),
            },
          ]
        : []),
      { id: 'app.allProjects', label: t('app.switcher.allProjects'), group: t('app.commands.groupApp'), icon: LibraryIcon, run: toAllProjects },
      ...others.map((p) => ({ id: `app.open.${p.id}`, label: t('app.commands.openProject', { name: p.name }), group: t('app.commands.groupApp'), icon: FolderOpen, run: () => open(p.id) })),
      { id: 'app.toggleRail', label: collapsed ? t('app.nav.expand') : t('app.nav.collapse'), group: t('app.commands.groupApp'), icon: collapsed ? PanelLeftOpen : PanelLeftClose, run: toggleRail },
      { id: 'app.theme.light', label: t('app.commands.themeLight'), group: t('app.commands.groupApp'), icon: Sun, run: () => void setPrefs({ theme: 'light' }) },
      { id: 'app.theme.dark', label: t('app.commands.themeDark'), group: t('app.commands.groupApp'), icon: Moon, run: () => void setPrefs({ theme: 'dark' }) },
      { id: 'app.theme.system', label: t('app.commands.themeSystem'), group: t('app.commands.groupApp'), icon: Monitor, run: () => void setPrefs({ theme: 'system' }) },
      { id: 'app.lock', label: t('common.lock'), group: t('app.commands.groupApp'), icon: Lock, shortcut: key('L'), run: () => void lock() },
    ],
    [t, key, go, collapsed, others.map((p) => p.id + p.name).join('|'), prefs.theme, routeName],
  );

  const switcherItems: MenuEntry[] = useMemo(
    () => [
      ...(others.length ? [{ kind: 'heading' as const, label: t('app.switcher.recent') }] : []),
      ...others.slice(0, 8).map((p) => ({ id: p.id, label: p.name, icon: FolderOpen, onSelect: () => open(p.id), testId: `switch-${p.id}` })),
      ...(others.length ? [{ kind: 'separator' as const }] : []),
      { id: 'all', label: t('app.switcher.allProjects'), icon: LibraryIcon, onSelect: toAllProjects, testId: 'switch-all' },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [others.map((p) => p.id + p.name).join('|'), t],
  );

  const groups: { group: NavGroup; label: string | null }[] = [
    { group: 'work', label: null },
    { group: 'analyse', label: t('app.nav.groupAnalyse') },
    { group: 'project', label: t('app.nav.groupProject') },
  ];

  const navButton = (name: Route['name']) => {
    const item = navItem(name);
    const Icon = item.icon;
    const current = route.name === name;
    const label = t(item.label);
    const button = (
      <button
        type="button"
        className={cx('rail__item', current && 'rail__item--current')}
        aria-current={current ? 'page' : undefined}
        aria-label={iconOnly ? label : undefined}
        onClick={() => go({ name } as Route)}
        data-testid={`nav-${name}`}
      >
        <Icon size={17} aria-hidden strokeWidth={1.75} />
        <span className="rail__label">{label}</span>
      </button>
    );
    // The tooltip names an icon-only item; the label is visible otherwise.
    return (
      <li key={name}>
        {iconOnly ? (
          <Tooltip label={label} side="right">
            {button}
          </Tooltip>
        ) : (
          <span className="rail__tip">{button}</span>
        )}
      </li>
    );
  };

  return (
    <div className={cx('shell', collapsed && 'shell--collapsed')} data-testid="project-shell">
      <nav className="rail" aria-label={t('app.nav.label')}>
        <div className="rail__top">
          <button
            ref={switcherRef}
            type="button"
            className="rail__project"
            aria-haspopup="menu"
            aria-expanded={switcher}
            aria-label={t('app.switcher.label', { name: project.info.name })}
            onClick={() => setSwitcher((s) => !s)}
            data-testid="project-switcher"
          >
            <span className="rail__project-mark" style={{ background: project.info.color, color: inkOn(project.info.color) }} aria-hidden>
              {initial(project.info.name)}
            </span>
            <span className="rail__project-name">{project.info.name}</span>
            <ChevronsUpDown size={14} aria-hidden className="rail__project-chevron" />
          </button>
          <Menu open={switcher} onClose={() => setSwitcher(false)} anchor={switcherRef} items={switcherItems} label={t('app.switcher.menu')} side="bottom" matchAnchorWidth />
          <button type="button" className="rail__search" onClick={() => setPalette(true)} aria-label={t('app.commands.open')} data-testid="open-palette">
            <Search size={15} aria-hidden strokeWidth={1.75} />
            <span className="rail__label">{t('app.commands.short')}</span>
            <kbd className="rail__kbd">{key('K')}</kbd>
          </button>
        </div>

        <div className="rail__scroll">
          {groups.map(({ group, label }) => (
            <div key={group} className="rail__group">
              {label ? <div className="rail__group-label">{label}</div> : null}
              <ul className="rail__list">{NAV.filter((n) => n.group === group).map((n) => navButton(n.name))}</ul>
            </div>
          ))}
        </div>

        <div className="rail__foot">
          <ul className="rail__list">{NAV.filter((n) => n.group === 'foot').map((n) => navButton(n.name))}</ul>
          <div className="rail__actions">
            <IconButton icon={Lock} label={t('common.lock')} shortcut={key('L')} onClick={() => void lock()} tooltipSide="top" data-testid="lock" />
            <IconButton
              icon={collapsed ? PanelLeftOpen : PanelLeftClose}
              label={collapsed ? t('app.nav.expand') : t('app.nav.collapse')}
              onClick={toggleRail}
              tooltipSide="top"
              className="rail__collapse"
              data-testid="toggle-rail"
            />
            <span className="rail__version" translate="no">
              Trama {version}
            </span>
          </div>
        </div>
      </nav>

      <main className="shell__main" id="main">
        {example ? (
          <div className="example-ribbon" role="note" data-testid="example-ribbon">
            <span>
              <strong>{t('app.example.badge')}</strong> {t('app.example.ribbon')}
            </span>
            {canLeaveExample ? (
              <Button size="sm" variant="ghost" onClick={() => void leaveExample()} data-testid="leave-example">
                {t('app.example.leave')}
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="shell__screen">
          <Suspense
            fallback={
              <div className="shell__loading">
                <Spinner size={20} label={t('common.loading')} />
              </div>
            }
          >
            <ScreenView route={route} />
          </Suspense>
        </div>
      </main>

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <LockingScreen />
      <BackupScheduler />
    </div>
  );
}

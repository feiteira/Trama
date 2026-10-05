import React, { lazy, Suspense, useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { DateTime } from 'luxon';
import { Ellipsis, FileUp, FolderOpen, Lock, Pencil, Plus, Settings2, Sparkles, Trash2 } from 'lucide-react';
import { AUTO_LOCK_MINUTES, type AutoLockMinutes, type ThemePref } from '../../services/prefs';
import type { ProjectInfo } from '../../services/project';
import { useAppState, useLibrary } from '../../shell/AppState';
import { useKeyLabel } from '../../shell/keys';
import { initial } from '../../shell/initial';
import { inkOn } from '../../ui/color';
import { useI18n } from '../../ui/i18n';
import { Button, IconButton } from '../../ui/components/Button';
import { RadioGroup } from '../../ui/components/Choice';
import { useConfirm } from '../../ui/components/Confirm';
import { Badge, EmptyState } from '../../ui/components/Feedback';
import { SearchField, Select } from '../../ui/components/Field';
import { Menu, type MenuEntry } from '../../ui/components/Menu';
import { Popover } from '../../ui/components/Popover';
import { useToast } from '../../ui/components/Toast';
import { PALETTE } from '../../core/model/types';
import { Brand, LanguagePicker } from '../onboarding/Frame';
import { ProjectDialog, type ProjectDraft } from './ProjectDialog';
import { filterProjects, type ProjectSort, sortProjects } from './projectList';
import './projects.css';

const SORT_KEY = 'trama.projects.sort';

// Loaded on first use: it brings the .trama and REFI-QDA readers with it.
const ImportProjectDialog = lazy(() => import('../importer/ImportProjectDialog').then((m) => ({ default: m.ImportProjectDialog })));

function readSort(): ProjectSort {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return v === 'name' || v === 'created' ? v : 'recent';
  } catch {
    return 'recent';
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The library after unlocking: every project, and making, editing and removing them. */
export function ProjectsScreen() {
  const { t, tp, meta } = useI18n();
  const library = useLibrary();
  const { prefs, setPrefs, enterProject, openProject, lock } = useAppState();
  const toast = useToast();
  const confirm = useConfirm();
  const key = useKeyLabel();
  // Re-read after every change to the list, wherever it was made.
  const revision = useSyncExternalStore(
    useCallback((onChange: () => void) => library.subscribe(onChange), [library]),
    () => library.revision,
  );
  const projects = useMemo(() => library.projects, [library, revision]);
  const [query, setQuery] = useState('');
  const [sort, setSortState] = useState<ProjectSort>(readSort);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ProjectInfo | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [addingExample, setAddingExample] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const prefsButton = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);

  const setSort = (s: ProjectSort) => {
    setSortState(s);
    try {
      localStorage.setItem(SORT_KEY, s);
    } catch {
      // Not remembered; it still applies now.
    }
  };

  const shown = useMemo(() => sortProjects(filterProjects(projects, query), sort, meta.bcp47), [projects, query, sort, meta.bcp47]);

  async function open(p: ProjectInfo) {
    if (busy.current) return;
    busy.current = true;
    setOpening(p.id);
    try {
      await openProject(p.id);
    } catch (e) {
      console.error('opening a project failed', e);
      toast.show({ message: t('projects.openFailed', { name: p.name, message: message(e) }), tone: 'danger' });
    } finally {
      busy.current = false;
      setOpening(null);
    }
  }

  async function create(d: ProjectDraft) {
    const coderName = d.coderName ?? prefs.coderName;
    const project = await library.createProject({ name: d.name, description: d.description, color: d.color, coderName });
    if (d.coderName) await setPrefs({ coderName: d.coderName }).catch((e: unknown) => console.error(e));
    setCreating(false);
    enterProject(project);
  }

  async function save(p: ProjectInfo, d: ProjectDraft) {
    await library.updateProject(p.id, { name: d.name, description: d.description, color: d.color });
    setEditing(null);
    toast.show({ message: t('projects.saved'), tone: 'success' });
  }

  async function remove(p: ProjectInfo) {
    const ok = await confirm({
      title: t('projects.deleteTitle', { name: p.name }),
      body: t('projects.deleteBody'),
      confirmLabel: t('projects.deleteConfirm'),
      danger: true,
      typeToConfirm: p.name,
      typePrompt: t('projects.deleteType', { name: p.name }),
      'data-testid': 'delete-project-dialog',
    });
    if (!ok) return;
    try {
      await library.deleteProject(p.id);
      if (prefs.lastProjectId === p.id) await setPrefs({ lastProjectId: null }).catch(() => undefined);
      toast.show({ message: t('projects.deleted', { name: p.name }) });
    } catch (e) {
      toast.error(e);
    }
  }

  async function addExample() {
    if (busy.current) return;
    busy.current = true;
    setAddingExample(true);
    try {
      const { addExampleProject } = await import('../../demo/exampleLibrary');
      const project = await addExampleProject(library, prefs.locale, prefs.coderName);
      enterProject(project);
    } catch (e) {
      toast.error(e);
    } finally {
      busy.current = false;
      setAddingExample(false);
    }
  }

  function importFile() {
    // The importer feature's dialog: pick a .trama or .qdpx, unlock it, review, import or merge.
    setImporting(true);
  }

  const menuFor = (p: ProjectInfo): MenuEntry[] => [
    { id: 'open', label: t('projects.open'), icon: FolderOpen, onSelect: () => void open(p), testId: 'project-menu-open' },
    { id: 'edit', label: t('projects.edit'), icon: Pencil, onSelect: () => setEditing(p), testId: 'project-menu-edit' },
    { kind: 'separator' },
    { id: 'delete', label: t('projects.delete'), icon: Trash2, danger: true, onSelect: () => void remove(p), testId: 'project-menu-delete' },
  ];

  const empty = projects.length === 0;

  return (
    <div className="library" data-testid="projects">
      <header className="library__bar">
        <Brand />
        <div className="library__bar-actions">
          <IconButton ref={prefsButton} icon={Settings2} label={t('projects.preferences')} onClick={() => setPrefsOpen((o) => !o)} aria-expanded={prefsOpen} aria-haspopup="dialog" data-testid="library-prefs" />
          <Button variant="ghost" icon={Lock} onClick={() => void lock()} title={key('L')} data-testid="lock">
            {t('common.lock')}
          </Button>
        </div>
        <Popover open={prefsOpen} onClose={() => setPrefsOpen(false)} anchor={prefsButton} align="end" padded aria-label={t('projects.preferences')} className="library__prefs">
          <LanguagePicker />
          <RadioGroup<ThemePref>
            label={t('projects.theme.label')}
            variant="segmented"
            value={prefs.theme}
            onChange={(theme) => void setPrefs({ theme })}
            options={[
              { value: 'system', label: t('projects.theme.system') },
              { value: 'light', label: t('projects.theme.light') },
              { value: 'dark', label: t('projects.theme.dark') },
            ]}
            className="language-picker"
            data-testid="theme"
          />
          <Select<string>
            label={t('projects.autoLock.label')}
            value={String(prefs.autoLockMinutes)}
            onChange={(v) => void setPrefs({ autoLockMinutes: Number(v) as AutoLockMinutes })}
            options={AUTO_LOCK_MINUTES.map((n) => ({ value: String(n), label: tp('projects.autoLock.minutes', n) }))}
            size="sm"
            data-testid="auto-lock"
          />
        </Popover>
      </header>

      <main className="library__main">
        <div className="library__head">
          <div>
            <h1 className="library__title">{t('projects.title')}</h1>
            <p className="library__count">{tp('projects.count', projects.length)}</p>
          </div>
          <div className="library__head-actions">
            <Button variant="ghost" icon={FileUp} onClick={importFile} data-testid="import-project">
              {t('projects.import')}
            </Button>
            <Button variant="primary" icon={Plus} onClick={() => setCreating(true)} data-testid="new-project">
              {t('projects.new')}
            </Button>
          </div>
        </div>

        {empty ? (
          <EmptyState
            icon={FolderOpen}
            title={t('projects.empty.title')}
            className="library__empty"
            data-testid="projects-empty"
            actions={
              <>
                <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
                  {t('projects.new')}
                </Button>
                <Button variant="secondary" icon={Sparkles} busy={addingExample} onClick={() => void addExample()} data-testid="add-example">
                  {t('projects.addExample')}
                </Button>
              </>
            }
          >
            {t('projects.empty.body')}
          </EmptyState>
        ) : (
          <>
            <div className="library__tools">
              <SearchField value={query} onChange={setQuery} placeholder={t('projects.search')} aria-label={t('projects.search')} fieldClassName="library__search" data-testid="project-search" />
              <Select<ProjectSort>
                aria-label={t('projects.sort.label')}
                value={sort}
                onChange={setSort}
                options={[
                  { value: 'recent', label: t('projects.sort.recent') },
                  { value: 'name', label: t('projects.sort.name') },
                  { value: 'created', label: t('projects.sort.created') },
                ]}
                data-testid="project-sort"
              />
            </div>
            {shown.length === 0 ? (
              <p className="library__nomatch">{t('projects.noMatch', { q: query.trim() })}</p>
            ) : (
              <ul className="shelf" aria-label={t('projects.title')}>
                {shown.map((p) => (
                  <ProjectRow key={p.id} project={p} busy={opening === p.id} onOpen={() => void open(p)} menu={menuFor(p)} />
                ))}
              </ul>
            )}
            <div className="library__foot">
              <Button variant="ghost" size="sm" icon={Sparkles} busy={addingExample} onClick={() => void addExample()} data-testid="add-example">
                {addingExample ? t('projects.addingExample') : t('projects.addExample')}
              </Button>
            </div>
          </>
        )}
      </main>

      <ProjectDialog
        open={creating}
        mode="create"
        askCoder={!prefs.coderName.trim()}
        initial={{ color: PALETTE[projects.length % PALETTE.length] }}
        onClose={() => setCreating(false)}
        onSave={create}
      />
      <ProjectDialog
        open={editing !== null}
        mode="edit"
        initial={editing ?? undefined}
        onClose={() => setEditing(null)}
        onSave={(d) => (editing ? save(editing, d) : Promise.resolve())}
      />
      {importing ? (
        <Suspense fallback={null}>
          <ImportProjectDialog
            open
            onClose={() => {
              setImporting(false);
                    }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

function ProjectRow({ project: p, busy, onOpen, menu }: { project: ProjectInfo; busy: boolean; onOpen: () => void; menu: MenuEntry[] }) {
  const { t, relative, date } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  return (
    <li className="shelf__item" data-testid={`project-${p.id}`} onContextMenu={(e) => {
      e.preventDefault();
      setMenuOpen(true);
    }}>
      <span className="shelf__spine" style={{ background: p.color }} aria-hidden />
      <button type="button" className="shelf__main" onClick={onOpen} aria-busy={busy || undefined} data-testid="project-open">
        <span className="shelf__mark" style={{ background: p.color, color: inkOn(p.color) }} aria-hidden>
          {initial(p.name)}
        </span>
        <span className="shelf__text">
          <span className="shelf__name">
            {p.name}
            {p.recovered ? <Badge tone="warning">{t('projects.card.recovered')}</Badge> : null}
          </span>
          {p.description ? <span className="shelf__desc">{p.description}</span> : null}
        </span>
        <span className="shelf__dates">
          <span>{p.opened_at ? t('projects.card.opened', { when: relative(p.opened_at) }) : t('projects.card.neverOpened')}</span>
          <span className="shelf__created">{t('projects.card.created', { date: date(DateTime.fromISO(p.created_at)) })}</span>
        </span>
      </button>
      <IconButton
        ref={menuButton}
        icon={Ellipsis}
        label={t('projects.card.actions', { name: p.name })}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((o) => !o)}
        className="shelf__menu"
        data-testid="project-menu"
      />
      <Menu open={menuOpen} onClose={() => setMenuOpen(false)} anchor={menuButton} items={menu} align="end" label={t('projects.card.actions', { name: p.name })} />
    </li>
  );
}

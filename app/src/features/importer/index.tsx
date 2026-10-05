import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ClipboardPaste, Ellipsis, FilePen, FilePlus2, Upload } from 'lucide-react';
import { utf8 } from '../../core/bytes';
import { uuid } from '../../core/ids';
import type { DocKind } from '../../core/model/types';
import { importFile, isTableResult, sniffFormat, supportedExtensions, type ImportFormat } from '../../core/import';
import { isTauri } from '../../platform/tauri';
import { isLocked } from '../../services/project';
import { JobStopped } from '../../services/jobs';
import { combineUndo } from '../../services/undo';
import { useAppState, useHold, usePlatform, useProject, useRegisterSaver } from '../../shell/AppState';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { type ScreenProps, useRouter } from '../../shell/router';
import { useUndo } from '../../shell/undo';
import { useCommands } from '../../shell/useCommands';
import { useLive } from '../../shell/useLive';
import { useI18n } from '../../ui/i18n';
import { Button } from '../../ui/components/Button';
import { useConfirm } from '../../ui/components/Confirm';
import { MenuButton, type MenuEntry } from '../../ui/components/Menu';
import { useToast } from '../../ui/components/Toast';
import { CodebookDialog, NewDocumentDialog, PasteDialog } from './Dialogs';
import { fromBrowserFile, fromPath, type IncomingFile, loadPdfJs, pickFiles } from './files';
import { failureOf } from './messages';
import {
  batchTotals,
  findDuplicates,
  importable,
  isMediaFile,
  matchMedia,
  mediaMime,
  nameKey,
  newRow,
  type ReviewRow,
  transcriptModeFor,
  withDoc,
  withFailure,
  withTable,
} from './model';
import { ReviewList } from './ReviewList';
import { RowDetail, type ProjectLists } from './RowDetail';
import { DonePanel, RunPanel, type DoneState, type RunState } from './RunPanel';
import { ImportSession, type CreatedDoc } from './run';
import { StartPanel } from './StartPanel';
import { defaultMapping, surveyCount, type SurveyCount, type SurveyMapping } from './survey';
import './importer.css';

type Phase = 'edit' | 'running' | 'done';

interface Source {
  file: IncomingFile;
  bytes: Uint8Array | null;
  transcript?: 'always' | 'never';
  password?: string;
  sheet?: number;
  format?: ImportFormat;
  /** Speaker renames, original name → new name. */
  renames?: Record<string, string>;
}

const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const countCache = new WeakMap<SurveyMapping, SurveyCount>();
function cachedCount(row: ReviewRow): SurveyCount {
  if (!row.survey || !row.table) return { documents: 0, cases: 0, answers: 0 };
  let c = countCache.get(row.survey);
  if (!c) {
    c = surveyCount(row.table.table, row.survey);
    countCache.set(row.survey, c);
  }
  return c;
}

/** Bringing material into the project: files, pasted text, surveys, recordings, codebooks. */
export default function ImporterScreen(_props: ScreenProps<'import'>) {
  const { t, tp } = useI18n();
  const project = useProject();
  const platform = usePlatform();
  const { locking } = useAppState();
  const { go } = useRouter();
  const { record } = useUndo();
  const toast = useToast();
  const confirm = useConfirm();

  const [phase, setPhase] = useState<Phase>('edit');
  const [rows, setRowsState] = useState<ReviewRow[]>([]);
  const rowsRef = useRef<ReviewRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'paste' | 'new' | 'codebook' | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [done, setDone] = useState<DoneState | null>(null);
  const [dragging, setDragging] = useState(false);
  const sources = useRef(new Map<string, Source>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const stopRef = useRef<null | 'user' | 'lock'>(null);
  const job = useRef<Promise<void> | null>(null);
  const lockingRef = useRef(locking);
  lockingRef.current = locking;

  // Rows live in a ref too, so jobs that run one after another see each other's results at once.
  const setRows = useCallback((f: (rows: ReviewRow[]) => ReviewRow[]) => {
    rowsRef.current = f(rowsRef.current);
    setRowsState(rowsRef.current);
  }, []);
  const patch = useCallback((id: string, f: (r: ReviewRow) => ReviewRow) => setRows((rs) => rs.map((r) => (r.id === id ? f(r) : r))), [setRows]);

  const { data: lists } = useLive<ProjectLists>(
    async (store) => {
      const [docs, cases, groups] = await Promise.all([store.list('document'), store.list('case'), store.list('docgroup')]);
      const hashes = new Map<string, string>();
      for (const d of docs) if (d.source?.text_sha256) hashes.set(d.source.text_sha256, d.name);
      const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      return { hashes, cases: cases.sort(byName), groups: groups.sort((a, b) => a.order - b.order) };
    },
    [phase === 'running'],
    // Not while importing: every new document would reload the lists for nothing.
    phase === 'running' ? [] : ['document', 'case', 'docgroup'],
  );
  const hashesRef = useRef<Map<string, string>>(new Map());
  hashesRef.current = lists?.hashes ?? hashesRef.current;

  const busy = phase === 'running';
  useHold(busy);

  // ── Reading files ───────────────────────────────────────────────────────────────────────

  const enqueue = useCallback((fn: () => Promise<void>) => {
    queue.current = queue.current.then(fn, fn);
    return queue.current;
  }, []);

  const parseRow = useCallback(
    async (id: string) => {
      const src = sources.current.get(id);
      if (!src || !rowsRef.current.some((r) => r.id === id)) return;
      patch(id, (r) => ({ ...r, status: 'reading' }));
      try {
        src.bytes ??= await src.file.read();
      } catch (e) {
        patch(id, (r) => withFailure(r, { code: 'READ', detail: null, message: e instanceof Error ? e.message : String(e) }));
        return;
      }
      try {
        const sniffed = src.format ? { format: src.format, hint: null } : sniffFormat(src.file.name, src.bytes);
        if (sniffed.format) patch(id, (r) => ({ ...r, format: sniffed.format }));
        const pdfjs = sniffed.format === 'pdf' ? await loadPdfJs() : undefined;
        const result = await importFile(src.file.name, src.bytes, {
          ...(pdfjs ? { pdfjs } : {}),
          ...(src.transcript ? { transcript: src.transcript } : {}),
          ...(src.password !== undefined ? { password: src.password } : {}),
          ...(src.sheet !== undefined ? { sheet: src.sheet } : {}),
          ...(src.format ? { format: src.format } : {}),
          ...(src.renames ? { speakers: { rename: src.renames } } : {}),
        });
        if (!rowsRef.current.some((r) => r.id === id)) return;
        if (isTableResult(result)) {
          patch(id, (r) => withTable(r, result, r.survey && r.table?.sheet === result.sheet ? r.survey : defaultMapping(result.table)));
        } else {
          const doc = result[0]!;
          patch(id, (r) => {
            const first = r.doc === null;
            const next = withDoc(r, doc);
            if (!first) return next;
            // A text already in the project (or earlier in this list) starts left out.
            const dup = hashesRef.current.has(next.sha!) || rowsRef.current.some((o) => o.id !== id && o.sha === next.sha);
            return dup ? { ...next, include: false } : next;
          });
        }
      } catch (e) {
        patch(id, (r) => withFailure(r, failureOf(e)));
      }
    },
    [patch],
  );

  const attachDropped = useCallback(
    async (file: IncomingFile) => {
      const target = matchMedia(file.name, rowsRef.current);
      if (!target) {
        const id = uuid();
        setRows((rs) => [...rs, withFailure(newRow(id, 'file', file.name), { code: 'NO_MEDIA_MATCH', detail: null })]);
        return;
      }
      try {
        const bytes = await file.read();
        patch(target, (r) => ({ ...r, media: { filename: file.name, mime: mediaMime(file.name), bytes } }));
      } catch (e) {
        toast.error(e);
      }
    },
    [patch, setRows, toast],
  );

  const addFiles = useCallback(
    (files: IncomingFile[]) => {
      if (!files.length || phase === 'running') return;
      const media = files.filter((f) => isMediaFile(f.name));
      const docs = files.filter((f) => !isMediaFile(f.name));
      const fresh = docs.map((f) => {
        const id = uuid();
        sources.current.set(id, { file: f, bytes: null });
        return newRow(id, 'file', f.name);
      });
      if (phase === 'done') {
        setDone(null);
        setPhase('edit');
      }
      setRows((rs) => [...rs, ...fresh]);
      if (fresh[0]) setSelected((s) => (s && rowsRef.current.some((r) => r.id === s) && rowsRef.current.length > fresh.length ? s : fresh[0]!.id));
      for (const r of fresh) void enqueue(() => parseRow(r.id));
      // Recordings last, so the transcripts they belong to are already in the list.
      for (const m of media) void enqueue(() => attachDropped(m));
    },
    [phase, enqueue, parseRow, attachDropped, setRows],
  );

  const choose = useCallback(async () => {
    try {
      const files = await pickFiles(platform, t('importer.start.chooseTitle'), [{ name: t('importer.start.filterAll'), extensions: supportedExtensions() }], true);
      addFiles(files);
    } catch (e) {
      toast.error(e);
    }
  }, [platform, t, addFiles, toast]);

  const addPasted = useCallback(
    (name: string, text: string) => {
      const id = uuid();
      const bytes = utf8(text);
      sources.current.set(id, { file: { name: `${name}.txt`, path: '', read: async () => bytes }, bytes, format: 'txt' });
      setRows((rs) => [...rs, { ...newRow(id, 'paste', t('importer.list.pasted')), name }]);
      setSelected(id);
      if (phase === 'done') {
        setDone(null);
        setPhase('edit');
      }
      void enqueue(() => parseRow(id));
    },
    [setRows, t, enqueue, parseRow, phase],
  );

  // ── Editing rows ────────────────────────────────────────────────────────────────────────

  const remove = useCallback(
    (id: string) => {
      const list = rowsRef.current;
      const i = list.findIndex((r) => r.id === id);
      sources.current.delete(id);
      setRows((rs) => rs.filter((r) => r.id !== id));
      setSelected((s) => (s === id ? (list[i + 1] ?? list[i - 1])?.id ?? null : s));
    },
    [setRows],
  );

  const setKind = useCallback(
    (id: string, kind: DocKind) => {
      const row = rowsRef.current.find((r) => r.id === id);
      const src = sources.current.get(id);
      if (!row || !src) return;
      const mode = transcriptModeFor(row.format, kind);
      if (mode && row.doc && row.doc.kind !== kind) {
        src.transcript = mode;
        patch(id, (r) => ({ ...r, kind }));
        void enqueue(() => parseRow(id));
      } else patch(id, (r) => ({ ...r, kind }));
    },
    [patch, enqueue, parseRow],
  );

  const retry = useCallback(
    (id: string, opts: { password?: string; sheet?: number }) => {
      const src = sources.current.get(id);
      if (!src) return;
      if (opts.password !== undefined) src.password = opts.password;
      if (opts.sheet !== undefined) src.sheet = opts.sheet;
      void enqueue(() => parseRow(id));
    },
    [enqueue, parseRow],
  );

  const renameSpeaker = useCallback(
    (id: string, from: string, to: string) => {
      const src = sources.current.get(id);
      if (!src) return;
      const renames = { ...(src.renames ?? {}) };
      // The importer renames original names: find the one now shown as `from`.
      const original = Object.keys(renames).find((k) => nameKey(renames[k]!) === nameKey(from)) ?? from;
      renames[original] = to;
      src.renames = renames;
      void enqueue(() => parseRow(id));
    },
    [enqueue, parseRow],
  );

  const attachMedia = useCallback(
    async (id: string) => {
      try {
        const exts = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'mp4', 'm4v', 'mov', 'webm', 'mkv'];
        const [file] = await pickFiles(platform, t('importer.transcript.attachTitle'), [{ name: t('importer.transcript.attachFilter'), extensions: exts }], false);
        if (!file) return;
        const bytes = await file.read();
        patch(id, (r) => ({ ...r, media: { filename: file.name, mime: mediaMime(file.name), bytes } }));
      } catch (e) {
        toast.error(e);
      }
    },
    [platform, t, patch, toast],
  );

  const clearAll = useCallback(async () => {
    if (rowsRef.current.length) {
      const ok = await confirm({ title: t('importer.actions.clearConfirmTitle'), body: t('importer.actions.clearConfirmBody'), confirmLabel: t('importer.actions.clear'), 'data-testid': 'import-clear-dialog' });
      if (!ok) return;
    }
    sources.current.clear();
    setRows(() => []);
    setSelected(null);
  }, [confirm, t, setRows]);

  // ── Importing ───────────────────────────────────────────────────────────────────────────

  const duplicates = useMemo(() => findDuplicates(rows, lists?.hashes ?? new Map()), [rows, lists]);
  const totals = useMemo(() => batchTotals(rows, cachedCount), [rows]);
  const reading = rows.some((r) => r.status === 'reading');
  const leftOut = rows.filter((r) => !importable(r)).length;

  const start = useCallback(async () => {
    const todo = rowsRef.current.filter(importable);
    if (!todo.length || job.current) return;
    stopRef.current = null;
    const statuses: RunState['statuses'] = Object.fromEntries(todo.map((r) => [r.id, 'pending' as const]));
    setRun({ index: 0, total: todo.length, name: todo[0]!.name, sub: null, statuses, stopping: false });
    setPhase('running');
    const session = new ImportSession(
      project,
      { speakers: t('importer.autocode.speakers'), questions: t('importer.autocode.questions'), surveyDoc: (table, name) => t('importer.surveyDoc', { table, name }) },
      () => stopRef.current !== null || lockingRef.current || !project.isOpen,
    );
    const created: CreatedDoc[] = [];
    const failures: DoneState['failures'] = [];
    const importedIds: string[] = [];
    let stopped: DoneState['stopped'] = null;
    const work = (async () => {
      for (let i = 0; i < todo.length; i++) {
        const row = todo[i]!;
        if (stopRef.current || lockingRef.current || !project.isOpen) {
          stopped = stopRef.current === 'user' ? 'user' : 'lock';
          break;
        }
        setRun((r) => (r ? { ...r, index: i, name: row.name, sub: null, statuses: { ...r.statuses, [row.id]: 'running' } } : r));
        // Let the progress show (and Stop be clicked): a fast store never yields on its own.
        await nextFrame();
        try {
          const docs = await session.import(row, async (n, total) => {
            setRun((r) => (r ? { ...r, sub: { n, total } } : r));
            if (n % 10 === 0) await nextFrame();
          });
          created.push(...docs);
          importedIds.push(row.id);
          setRun((r) => (r ? { ...r, statuses: { ...r.statuses, [row.id]: 'done' } } : r));
        } catch (e) {
          if (e instanceof JobStopped || isLocked(e) || !project.isOpen) {
            stopped = stopRef.current === 'user' ? 'user' : 'lock';
            setRun((r) => (r ? { ...r, statuses: { ...r.statuses, [row.id]: 'failed' } } : r));
            break;
          }
          console.error('import failed', e);
          failures.push({ name: row.name, message: t('importer.errors.importFailed', { message: e instanceof Error ? e.message : String(e) }) });
          setRun((r) => (r ? { ...r, statuses: { ...r.statuses, [row.id]: 'failed' } } : r));
        }
      }
    })();
    job.current = work;
    try {
      await work;
    } finally {
      job.current = null;
    }
    if (session.undos.length) record(combineUndo('document.add', `×${created.length}`, session.undos));
    // What was imported leaves the list; failures and what was not reached stay for another try.
    const gone = new Set(importedIds);
    for (const id of gone) sources.current.delete(id);
    setRows((rs) => rs.filter((r) => !gone.has(r.id)));
    setSelected(null);
    setDone({ created, failures, stopped });
    setPhase('done');
    setRun(null);
  }, [project, t, record, setRows]);

  // Locking (or opening another project) waits for the current file, then the job stops.
  useRegisterSaver(async () => {
    if (!job.current) return;
    stopRef.current ??= 'lock';
    await job.current;
  });
  useEffect(
    () => () => {
      if (job.current) stopRef.current ??= 'user';
    },
    [],
  );

  const stop = useCallback(() => {
    stopRef.current = 'user';
    setRun((r) => (r ? { ...r, stopping: true } : r));
  }, []);

  // ── Drag and drop ───────────────────────────────────────────────────────────────────────

  const depth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const dropHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!hasFiles(e) || busy) return;
      e.preventDefault();
      depth.current++;
      setDragging(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!hasFiles(e) || busy) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      addFiles(Array.from(e.dataTransfer.files).map(fromBrowserFile));
    },
  };

  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    let live = true;
    void import('@tauri-apps/api/webview')
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
          const p = event.payload;
          if (p.type === 'enter') setDragging(!busyRef.current);
          else if (p.type === 'leave') setDragging(false);
          else if (p.type === 'drop') {
            setDragging(false);
            if (!busyRef.current) addFilesRef.current(p.paths.map((path) => fromPath(platform, path)));
          }
        }),
      )
      .then((un) => {
        if (live) unlisten = un;
        else un();
      })
      .catch((e: unknown) => console.error('listening for dropped files failed', e));
    return () => {
      live = false;
      unlisten?.();
    };
  }, [platform]);

  // ── Commands ────────────────────────────────────────────────────────────────────────────

  useCommands(
    () => [
      { id: 'import.choose', label: t('importer.start.choose'), group: t('importer.title'), run: () => void choose() },
      { id: 'import.paste', label: t('importer.start.paste'), group: t('importer.title'), run: () => setDialog('paste') },
      { id: 'import.new', label: t('importer.start.newDoc'), group: t('importer.title'), run: () => setDialog('new') },
      { id: 'import.codebook', label: t('importer.start.codebook'), group: t('importer.title'), run: () => setDialog('codebook') },
    ],
    [t, choose],
  );

  const moreItems: MenuEntry[] = [
    { id: 'paste', label: t('importer.start.paste'), icon: ClipboardPaste, onSelect: () => setDialog('paste'), testId: 'import-menu-paste' },
    { id: 'new', label: t('importer.start.newDoc'), icon: FilePen, onSelect: () => setDialog('new'), testId: 'import-menu-new' },
    { kind: 'separator' },
    { id: 'codebook', label: t('importer.start.codebook'), icon: BookOpen, onSelect: () => setDialog('codebook'), testId: 'import-menu-codebook' },
  ];

  const current = rows.find((r) => r.id === selected) ?? null;
  useEffect(() => {
    if (phase === 'edit' && !current && rows.length) setSelected(rows[0]!.id);
  }, [phase, current, rows]);

  const openDoc = useCallback((docId: string) => go({ name: 'workbench', docId }), [go]);
  const reviewing = phase === 'edit' && rows.length > 0;

  return (
    <div className="importer" data-testid="importer" {...dropHandlers}>
      <ScreenHeader
        title={t('importer.title')}
        subtitle={reviewing ? tp('importer.subtitle', rows.length) : undefined}
        actions={
          phase === 'edit' ? (
            reviewing ? (
              <>
                <Button variant="secondary" icon={FilePlus2} onClick={() => void choose()} data-testid="import-add-files">
                  {t('importer.actions.addFiles')}
                </Button>
                <MenuButton items={moreItems} label={t('importer.actions.more')} icon={Ellipsis} iconOnly variant="ghost" align="end" data-testid="import-more" />
              </>
            ) : null
          ) : null
        }
      />

      {phase === 'edit' && !rows.length ? (
        <StartPanel onChoose={() => void choose()} onPaste={() => setDialog('paste')} onNew={() => setDialog('new')} onCodebook={() => setDialog('codebook')} />
      ) : null}

      {reviewing ? (
        <div className="imp-review">
          <ReviewList
            rows={rows}
            selected={selected}
            duplicates={duplicates}
            onSelect={setSelected}
            onToggle={(id, include) => patch(id, (r) => ({ ...r, include }))}
            onToggleAll={(include) => setRows((rs) => rs.map((r) => (r.status === 'ready' || r.status === 'password' ? { ...r, include } : r)))}
            onAdd={() => void choose()}
            surveyCount={cachedCount}
          />
          <div className="imp-review__detail">
            {current ? (
              <RowDetail
                key={current.id}
                row={current}
                lists={lists}
                duplicate={duplicates.get(current.id) ?? null}
                surveyCount={cachedCount(current)}
                onPatch={(f) => patch(current.id, f)}
                onKind={(k) => setKind(current.id, k)}
                onPassword={(password) => retry(current.id, { password })}
                onSheet={(sheet) => retry(current.id, { sheet })}
                onAttach={() => void attachMedia(current.id)}
                onRemove={() => remove(current.id)}
                onRenameSpeaker={(from, to) => renameSpeaker(current.id, from, to)}
              />
            ) : null}
          </div>
          <footer className="imp-review__footer">
            <div className="imp-review__totals" aria-live="polite" data-testid="import-totals">
              <strong>{tp('importer.survey.documents', totals.documents)}</strong>
              {totals.cases ? <span> · {tp('importer.survey.caseCount', totals.cases)}</span> : null}
              {leftOut ? <span className="imp-review__left"> · {tp('importer.footer.left', leftOut)}</span> : null}
            </div>
            <Button variant="ghost" onClick={() => void clearAll()} data-testid="import-clear">
              {t('importer.actions.clear')}
            </Button>
            <Button variant="primary" icon={Upload} disabled={!totals.documents || reading} busy={reading} onClick={() => void start()} data-testid="import-start">
              {reading ? t('importer.list.reading') : totals.documents ? tp('importer.actions.import', totals.documents) : t('importer.actions.importNothing')}
            </Button>
          </footer>
        </div>
      ) : null}

      {phase === 'running' && run ? <RunPanel run={run} rows={rows} onStop={stop} /> : null}
      {phase === 'done' && done ? (
        <DonePanel
          done={done}
          remaining={rows.length}
          onOpen={openDoc}
          onMore={() => {
            setDone(null);
            setPhase('edit');
          }}
          onDocuments={() => go(done.created[0] ? { name: 'workbench', docId: done.created[0].id } : { name: 'workbench' })}
        />
      ) : null}

      {dragging ? (
        <div className="imp-drop" aria-hidden data-testid="import-drop-overlay">
          <div className="imp-drop__card">
            <Upload size={28} strokeWidth={1.5} />
            <strong>{t('importer.drop.overlay')}</strong>
            <span>{t('importer.drop.overlayHint')}</span>
          </div>
        </div>
      ) : null}

      <PasteDialog open={dialog === 'paste'} onClose={() => setDialog(null)} onAdd={(name, text) => {
        setDialog(null);
        addPasted(name, text);
      }} />
      <NewDocumentDialog open={dialog === 'new'} onClose={() => setDialog(null)} onCreated={(id, name) => {
        setDialog(null);
        toast.show({ message: t('importer.newDialog.created', { name }), tone: 'success' });
        openDoc(id);
      }} />
      <CodebookDialog open={dialog === 'codebook'} onClose={() => setDialog(null)} />
    </div>
  );
}

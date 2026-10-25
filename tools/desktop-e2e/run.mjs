// End-to-end test of the real Trama desktop app (Linux), through WebDriver.
//
// Needs: a release build (`npm run build:desktop`), WebKitWebDriver (package webkit2gtk-driver)
// and `cargo install tauri-driver`. Run under a display:
//
//     xvfb-run -a node tools/desktop-e2e/run.mjs
//
// Everything happens in a throwaway library (TRAMA_DATA_DIR in a temporary folder), never the
// researcher's own. The example-project part runs at a 125% text scale (GDK_DPI_SCALE), where
// WebKit rounds sizes differently. See README.md for what is checked and the environment knobs.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');
const APP = process.env.TRAMA_BIN ?? join(ROOT, 'desktop/src-tauri/target/release/trama-desktop');
const ARTIFACTS = process.env.TRAMA_E2E_ARTIFACTS ?? mkdtempSync(join(tmpdir(), 'trama-e2e-artifacts-'));
const KEEP = process.env.TRAMA_E2E_KEEP === '1';
const SHOTS = process.env.TRAMA_E2E_SHOTS === '1'; // screenshots of every screen, not only on failure
const PRIVATE_BUS = process.env.TRAMA_E2E_PRIVATE_BUS !== '0' && spawnSync('dbus-run-session', ['--version']).status === 0;
const DEADLINE_MS = Number(process.env.TRAMA_E2E_TIMEOUT_MS ?? 15 * 60_000);

const WORK = mkdtempSync(join(tmpdir(), 'trama-e2e-'));
const DATA = join(WORK, 'library');
const INBOX = join(WORK, 'files');
mkdirSync(DATA);
mkdirSync(INBOX);
mkdirSync(ARTIFACTS, { recursive: true });

// Made-up words, unique to this run, so a hit in a file can only come from this test.
const tag = randomBytes(3).toString('hex');
const MARKER = `Quorvantelix${tag}`; // a word of the imported document
const CODE = `Brimbleworth${tag}`; // the code applied to it
const PROJECT = `Ostrander study ${tag}`; // the project's name (encrypted in library.json)
const EXAMPLE_CODE = `Fennimorel${tag}`; // a change made to the example project
const PASS = 'violet river morning tea lamp';
const DOC_FILE = join(INBOX, `Entrevista São Brás ${tag}.txt`); // non-ASCII path on purpose
const PASSAGE = `the ${MARKER} committee met every Thursday`;
// On-device transcription: the model files (tools/fetch-speech-models.mjs) and a spoken sample,
// synthesised with ffmpeg's flite voice (fictional words, nothing recorded). Skipped without them.
const SPEECH_DIR = process.env.TRAMA_SPEECH_DIR ?? join(ROOT, 'desktop/src-tauri/resources/speech');
// TRAMA_E2E_BUNDLED_SPEECH=1: test an installed bundle (an extracted AppImage, an installed .deb),
// which must find the model it carries; TRAMA_SPEECH_DIR is not passed then.
const BUNDLED_SPEECH = process.env.TRAMA_E2E_BUNDLED_SPEECH === '1';
// Named without the run's tag: openDocument(tag) means the text document.
const SPEECH_SAMPLE = join(INBOX, 'Gravação da horta.wav');
const SPEECH_WORDS = 'We planted tomatoes in the community garden every spring.';
const hasSpeech =
  (BUNDLED_SPEECH || existsSync(join(SPEECH_DIR, 'ggml-large-v3-turbo-q5_0.bin'))) &&
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `flite=text='${SPEECH_WORDS}':voice=slt`, '-ar', '16000', '-ac', '1', SPEECH_SAMPLE]).status === 0;
writeFileSync(
  DOC_FILE,
  [
    'Interviewer: How did the neighbourhood association start?',
    '',
    `Participant: It started small. Back then ${PASSAGE} in the old library, and people brought soup.`,
    '',
    'Interviewer: Who came to those meetings?',
    '',
    'Participant: Mostly retired teachers at first, then the younger families joined.',
    '',
  ].join('\n'),
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const since = (t) => `${((Date.now() - t) / 1000).toFixed(1)}s`;

// ── Driver and WebDriver plumbing ────────────────────────────────────────────────────────────

/** A free local TCP port (tauri-driver's own and the one it gives WebKitWebDriver). */
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

let driver = null;
let port = 0;
let session = null;
let scale = 1;

async function startDriver(env = {}) {
  await stopDriver();
  port = await freePort();
  const nativePort = await freePort();
  const log = [];
  const cmd = ['tauri-driver', '--port', String(port), '--native-port', String(nativePort)];
  // A private D-Bus session: the app then never talks to the desktop's portals and services (with
  // the desktop's bus, under Xvfb, each start waits ~30 s for a portal that cannot answer).
  if (PRIVATE_BUS) cmd.unshift('dbus-run-session', '--');
  driver = spawn(cmd[0], cmd.slice(1), {
    env: { ...process.env, TRAMA_DATA_DIR: DATA, ...(hasSpeech && !BUNDLED_SPEECH ? { TRAMA_SPEECH_DIR: SPEECH_DIR } : {}), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // its own process group, ended as a whole
  });
  driver.log = log;
  const keep = (d) => {
    log.push(String(d));
    if (log.length > 200) log.shift();
  };
  driver.stdout.on('data', keep);
  driver.stderr.on('data', keep);
  const end = Date.now() + 20_000;
  for (;;) {
    if (driver.exitCode !== null) throw new Error(`tauri-driver exited (${driver.exitCode}): ${log.join('').slice(-800)}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > end) throw new Error('tauri-driver did not start listening within 20 s');
    await sleep(200);
  }
}

async function stopDriver() {
  if (!driver) return;
  const d = driver;
  driver = null;
  const group = (sig) => {
    try {
      process.kill(-d.pid, sig);
    } catch {}
  };
  if (d.exitCode === null) {
    group('SIGTERM');
    await Promise.race([new Promise((r) => d.once('exit', r)), sleep(5000)]);
  }
  group('SIGKILL'); // whatever is left of the group (WebKitWebDriver, the bus)
}

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

async function wd(method, path, body, timeout = 90_000) {
  const url = `http://127.0.0.1:${port}/session${session ? `/${session}` : ''}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    throw new Error(`${method} ${path}: ${e.name === 'TimeoutError' ? `no answer in ${timeout / 1000} s` : e.message}`);
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${method} ${path}: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  if (json.value?.error) throw new Error(`${method} ${path}: ${json.value.error} ${json.value.message ?? ''}`.trim());
  return json.value;
}

const js = (script, ...args) => wd('POST', '/execute/sync', { script, args });
/** Runs an async function body in the page; its resolved value comes back (errors as {error}). */
const run = (body, ...args) =>
  wd('POST', '/execute/async', {
    script: `const done = arguments[arguments.length - 1];
      (async (...args) => { ${body} })(...Array.prototype.slice.call(arguments, 0, -1))
        .then((v) => done(v === undefined ? null : v), (e) => done({ error: String(e && e.stack || e) }));`,
    args,
  });
const invoke = (cmd, args = {}) =>
  run(`try { return { ok: await window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1]) }; } catch (e) { return { denied: typeof e === 'string' ? e : JSON.stringify(e) }; }`, cmd, args);

const sel = (testId) => `[data-testid="${testId}"]`;
const windowTitle = async () => {
  const r = await invoke('plugin:window|title', { label: 'main' });
  if (typeof r.ok !== 'string') throw new Error(`reading the window title failed: ${JSON.stringify(r)}`);
  return r.ok;
};
/** The app sets the title asynchronously as screens change: waits a little for it. */
async function titleBecomes(want, when = '') {
  const end = Date.now() + 5000;
  for (;;) {
    const title = await windowTitle();
    if (typeof want === 'string' ? title === want : want.test(title)) return title;
    if (Date.now() > end) throw new Error(`window title ${when}: "${title}", expected ${typeof want === 'string' ? `"${want}"` : want}`.replace('  ', ' '));
    await sleep(200);
  }
}

/** The crash screen (error boundary) ends the test at once, with its text. */
async function crashText() {
  return js(`const d = document.querySelector('[data-testid="crash-details"]'); return d ? (d.value || d.textContent || 'crashed').slice(0, 2000) : null;`).catch(() => null);
}

/** Waits until a page script returns something truthy; returns it. */
async function until(what, script, args = [], timeout = 30_000) {
  const end = Date.now() + timeout;
  let last;
  for (let i = 0; ; i++) {
    try {
      const v = await js(script, ...args);
      if (v) return v;
    } catch (e) {
      last = e;
    }
    if (i % 8 === 7) {
      const crash = await crashText();
      if (crash) throw new Error(`the app crashed while waiting for ${what}:\n${crash}`);
    }
    if (Date.now() > end) throw new Error(`timed out after ${timeout / 1000} s waiting for ${what}${last ? ` (${last.message})` : ''}`);
    await sleep(200);
  }
}

const present = (testId, timeout) => until(testId, 'return !!document.querySelector(arguments[0])', [sel(testId)], timeout);
const exists = (testId) => js('return !!document.querySelector(arguments[0])', sel(testId));

async function find(testId, timeout = 30_000, selector = sel(testId)) {
  await until(testId, 'return !!document.querySelector(arguments[0])', [selector], timeout);
  return (await wd('POST', '/element', { using: 'css selector', value: selector }))[ELEMENT];
}

// At a fractional display scale WebKitWebDriver aims its pointer at the wrong place, so the part
// of the test that runs scaled clicks through the DOM instead.
let domClicks = false;
async function click(testId, selector = sel(testId)) {
  const el = await find(testId, 30_000, selector);
  await until(`${testId} to be enabled`, 'const e = document.querySelector(arguments[0]); return e && !e.disabled && e.getAttribute("aria-busy") !== "true"', [selector], 30_000);
  if (domClicks) await js('document.querySelector(arguments[0]).click()', selector);
  else await wd('POST', `/element/${el}/click`, {});
}
async function type(testId, text, { clear = false } = {}) {
  const el = await find(testId);
  if (clear) await wd('POST', `/element/${el}/clear`, {});
  await wd('POST', `/element/${el}/value`, { text });
}
async function keys(...seq) {
  // W3C key actions: every key down in order, then up in reverse.
  const actions = [...seq.map((value) => ({ type: 'keyDown', value })), ...seq.reverse().map((value) => ({ type: 'keyUp', value }))];
  await wd('POST', '/actions', { actions: [{ type: 'key', id: 'keyboard', actions }] });
  await wd('DELETE', '/actions').catch(() => {});
}
const CTRL = '\uE009'; // WebDriver's Control key
const bodyText = () => js('return document.body.innerText');

async function screenshot(name) {
  try {
    const png = await wd('GET', '/screenshot', undefined, 30_000);
    const file = join(ARTIFACTS, `${name.replace(/[^\w.-]+/g, '-')}.png`);
    writeFileSync(file, Buffer.from(png, 'base64'));
    return file;
  } catch {
    return null;
  }
}

// ── Sessions ─────────────────────────────────────────────────────────────────────────────────

async function startApp(args = []) {
  session = null;
  const started = Date.now();
  const s = await wd('POST', '', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args } } } }, 120_000);
  session = s.sessionId;
  console.log(`    (app ${args.join(' ') || 'started'}: session in ${since(started)})`);
  // Uncaught errors are kept in the page, to be shown when a step fails.
  await js(`if (!window.__e2eErrors) {
      window.__e2eErrors = [];
      const keep = (m) => { window.__e2eErrors.push(String(m).slice(0, 500)); if (window.__e2eErrors.length > 30) window.__e2eErrors.shift(); };
      window.addEventListener('error', (e) => keep('error: ' + (e.message || e)));
      window.addEventListener('unhandledrejection', (e) => keep('unhandled: ' + (e.reason && e.reason.stack || e.reason)));
      const ce = console.error.bind(console);
      console.error = (...a) => { keep('console.error: ' + a.map((x) => x && x.stack || x).join(' ')); ce(...a); };
    }`);
}

// Asks a program's windows to close, as a window manager's close button does: an X11
// WM_DELETE_WINDOW message (Xvfb has no window manager to send it). WebDriver's own "close window"
// ends the process at once, which would skip the app's exit handlers (saving, example clean-up).
const CLOSE_WINDOWS_PY = String.raw`
import ctypes as C, sys
pid = int(sys.argv[1])
x = C.cdll.LoadLibrary('libX11.so.6')
x.XOpenDisplay.restype = C.c_void_p; x.XOpenDisplay.argtypes = [C.c_char_p]
x.XDefaultRootWindow.restype = C.c_ulong; x.XDefaultRootWindow.argtypes = [C.c_void_p]
x.XInternAtom.restype = C.c_ulong; x.XInternAtom.argtypes = [C.c_void_p, C.c_char_p, C.c_int]
x.XQueryTree.argtypes = [C.c_void_p, C.c_ulong, C.POINTER(C.c_ulong), C.POINTER(C.c_ulong), C.POINTER(C.POINTER(C.c_ulong)), C.POINTER(C.c_uint)]
x.XGetWindowProperty.argtypes = [C.c_void_p, C.c_ulong, C.c_ulong, C.c_long, C.c_long, C.c_int, C.c_ulong, C.POINTER(C.c_ulong), C.POINTER(C.c_int), C.POINTER(C.c_ulong), C.POINTER(C.c_ulong), C.POINTER(C.c_void_p)]
x.XSendEvent.argtypes = [C.c_void_p, C.c_ulong, C.c_int, C.c_long, C.c_void_p]
x.XFlush.argtypes = [C.c_void_p]
x.XFree.argtypes = [C.c_void_p]
class Attrs(C.Structure):
    _fields_ = [('x', C.c_int), ('y', C.c_int), ('w', C.c_int), ('h', C.c_int), ('bw', C.c_int), ('depth', C.c_int), ('visual', C.c_void_p), ('root', C.c_ulong), ('cls', C.c_int), ('bit_gravity', C.c_int), ('win_gravity', C.c_int), ('backing_store', C.c_int), ('planes', C.c_ulong), ('pixel', C.c_ulong), ('save_under', C.c_int), ('colormap', C.c_ulong), ('map_installed', C.c_int), ('map_state', C.c_int), ('all_masks', C.c_long), ('your_mask', C.c_long), ('dnp', C.c_long), ('override', C.c_int), ('screen', C.c_void_p)]
x.XGetWindowAttributes.argtypes = [C.c_void_p, C.c_ulong, C.POINTER(Attrs)]
class Msg(C.Structure):
    _fields_ = [('type', C.c_int), ('serial', C.c_ulong), ('send_event', C.c_int), ('display', C.c_void_p), ('window', C.c_ulong), ('message_type', C.c_ulong), ('format', C.c_int), ('l', C.c_long * 5)]
class Event(C.Union):
    _fields_ = [('xclient', Msg), ('pad', C.c_long * 24)]
d = x.XOpenDisplay(None)
if not d: sys.exit('cannot open the X display')
NET_WM_PID = x.XInternAtom(d, b'_NET_WM_PID', 0)
PROTOCOLS = x.XInternAtom(d, b'WM_PROTOCOLS', 0)
DELETE = x.XInternAtom(d, b'WM_DELETE_WINDOW', 0)
def prop_pid(w):
    t, f, n, a, p = C.c_ulong(), C.c_int(), C.c_ulong(), C.c_ulong(), C.c_void_p()
    if x.XGetWindowProperty(d, w, NET_WM_PID, 0, 1, 0, 6, C.byref(t), C.byref(f), C.byref(n), C.byref(a), C.byref(p)) != 0 or not p.value: return None
    v = C.cast(p, C.POINTER(C.c_ulong))[0] if n.value else None
    x.XFree(p)
    return v
def walk(w):
    r, par, ch, n = C.c_ulong(), C.c_ulong(), C.POINTER(C.c_ulong)(), C.c_uint()
    if not x.XQueryTree(d, w, C.byref(r), C.byref(par), C.byref(ch), C.byref(n)): return
    kids = [ch[i] for i in range(n.value)]
    if ch: x.XFree(ch)
    for k in kids:
        yield k
        yield from walk(k)
sent = 0
for w in walk(x.XDefaultRootWindow(d)):
    a = Attrs()
    if prop_pid(w) != pid or not x.XGetWindowAttributes(d, w, C.byref(a)) or a.map_state != 2: continue
    e = Event(); e.xclient.type = 33; e.xclient.window = w; e.xclient.message_type = PROTOCOLS; e.xclient.format = 32
    e.xclient.l[0] = DELETE
    x.XSendEvent(d, w, 0, 0, C.byref(e)); sent += 1
x.XFlush(d)
print(sent)
`;

/** Closes the window the way a person does (the app saves, cleans up and exits), then ends the session. */
async function quitApp() {
  if (!session) return;
  const pids = appPids();
  assert(pids.length === 1, `expected one running app, found ${pids.length}`);
  const r = spawnSync('python3', ['-c', CLOSE_WINDOWS_PY, String(pids[0])], { encoding: 'utf8', timeout: 20_000 });
  assert(r.status === 0 && Number(r.stdout) > 0, `could not ask the window to close (python3 and libX11 are needed): ${r.error?.message ?? ''}${r.stderr}${r.stdout}`);
  // The app holds the close back while it saves, then exits by itself.
  await waitForExit(20_000, 'the app did not exit after its window was asked to close');
  await wd('DELETE', '', undefined, 30_000).catch(() => {});
  session = null;
}

/** No trama-desktop process from this run remains (a second one would share the library). */
async function waitForExit(timeout = 15_000, message = 'the app did not exit') {
  const end = Date.now() + timeout;
  while (appPids().length) {
    if (Date.now() > end) {
      for (const pid of appPids()) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {}
      }
      throw new Error(message);
    }
    await sleep(200);
  }
}

function appPids() {
  const out = [];
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      if (readlinkSync(`/proc/${d}/exe`) === APP) out.push(Number(d));
    } catch {}
  }
  return out;
}

// ── Steps ────────────────────────────────────────────────────────────────────────────────────

const timings = [];
async function step(name, fn) {
  const t = Date.now();
  process.stdout.write(`• ${name}\n`);
  try {
    const note = await fn();
    if (note) console.log(`    ${note}`);
    timings.push([name, Date.now() - t]);
    console.log(`    ok (${since(t)})`);
  } catch (e) {
    console.error(`    ✗ ${e.message}`);
    if (session) {
      const shot = await screenshot(`FAILED ${name}`);
      if (shot) console.error(`    screenshot: ${shot}`);
      const crash = await crashText();
      if (crash) console.error(`    crash screen:\n${crash}`);
      const errors = await js('return window.__e2eErrors || []').catch(() => []);
      if (errors.length) console.error(`    page errors:\n      ${errors.join('\n      ')}`);
      const text = await bodyText().catch(() => '');
      if (text) console.error(`    page text: ${text.replace(/\s+/g, ' ').slice(0, 600)}`);
    }
    if (driver?.log?.length) console.error(`    driver log (tail): ${driver.log.join('').slice(-600)}`);
    throw e;
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

// ── Pieces of the flow ───────────────────────────────────────────────────────────────────────

async function unlock(passphrase = PASS) {
  await type('unlock-passphrase', passphrase, { clear: true });
  await click('unlock-submit');
}

/** After unlocking: the library's project list, or straight into the last open project. */
async function openOurProject() {
  const where = (also) =>
    until(
      also ? 'the projects or the project' : 'the project',
      `return document.querySelector('[data-testid="project-shell"]') ? 'shell'
        : document.querySelector('[data-testid="coder-continue"]') ? 'coder'
        : arguments[0] && document.querySelector('[data-testid="projects"]') ? 'projects' : null`,
      [also],
      60_000,
    );
  let at = await where(true);
  if (at === 'projects') {
    await click('project-open', '[data-testid="projects"] [data-testid="project-open"]');
    at = await where(false);
  }
  // "Who is coding on this computer?" when the project does not know this computer's coder.
  if (at === 'coder') await click('coder-continue');
  await present('project-shell', 60_000);
}

/**
 * Opens a document in the workbench: the one whose name contains `name` (null: the first one),
 * from the overview, or as it is when the workbench reopens it. Waits for `expect` in its text.
 */
async function openDocument(name, expect = '') {
  await click('nav-workbench');
  const state = await until(
    'the workbench',
    `return document.querySelector('[data-testid="doc-text"]') ? 'doc' : document.querySelector('[data-testid="overview-doc"]') ? 'overview' : null`,
    [],
    30_000,
  );
  if (state === 'overview') {
    const opened = await js(
      `const b = [...document.querySelectorAll('[data-testid="overview-doc"]')].find((e) => arguments[0] === null || e.textContent.includes(arguments[0]));
       if (b) b.click(); return !!b;`,
      name,
    );
    assert(opened, `no document "${name}" in the workbench overview`);
  }
  await until('the document text', `const t = document.querySelector('[data-testid="doc-text"]'); return t && t.textContent.length > 0 && t.textContent.includes(arguments[0])`, [expect], 30_000);
}

/** Selects a passage of the open document through the DOM Selection API, as a mouse drag would. */
async function selectPassage(text) {
  const ok = await js(
    `const root = document.querySelector('[data-testid="doc-text"]');
     const want = arguments[0];
     const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
     // The passage may cross several runs (spans): map the text content to its nodes.
     const nodes = []; let all = '';
     for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push([n, all.length]); all += n.data; }
     const at = all.indexOf(want);
     if (at < 0) return false;
     const pos = (i) => { for (let k = nodes.length - 1; k >= 0; k--) if (nodes[k][1] <= i) return [nodes[k][0], i - nodes[k][1]]; };
     const [sn, so] = pos(at), [en, eo] = pos(at + want.length);
     const r = document.createRange(); r.setStart(sn, so); r.setEnd(en, eo);
     root.focus({ preventScroll: true });
     const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
     return s.toString() === want;`,
    text,
  );
  assert(ok, `could not select "${text}" in the document`);
}

/** Codes the selected passage with a new code, through the selection popover. */
async function codeSelection(passage, codeName) {
  await selectPassage(passage);
  await present('selection-popover', 15_000);
  await type('select-picker-input', codeName);
  await click('select-picker-create');
}

/** The passage shows as coded: a coded run, with its computed paint (the code's colour is an inline style). */
async function codedRun(word, timeout = 20_000) {
  return until(
    `"${word}" to show as coded`,
    `const runs = [...document.querySelectorAll('[data-testid="doc-text"] .wb-r--coded')].filter((r) => r.textContent.includes(arguments[0]));
     if (!runs.length) return null;
     const cs = getComputedStyle(runs[0]);
     return { inline: runs[0].getAttribute('style'), bg: cs.backgroundColor, bgImage: cs.backgroundImage };`,
    [word],
    timeout,
  );
}

/** Every page's width at the current window size: nothing may scroll sideways. */
async function overflowTour(label) {
  const screens = await js(`return [...document.querySelectorAll('[data-testid^="nav-"]')].map((e) => e.dataset.testid)`);
  assert(screens.length >= 10, `expected the navigation rail's destinations, found ${screens.length}`);
  const problems = [];
  for (const nav of screens) {
    await click(nav);
    await until(`${nav} to open`, `const m = document.querySelector('.shell__screen'); return m && !m.querySelector('.shell__loading') && m.children.length > 0`, [], 30_000);
    await sleep(600);
    const fit = await js(`const de = document.documentElement, main = document.querySelector('.shell__main'), screen = document.querySelector('.shell__screen');
      return { inner: innerWidth, doc: de.scrollWidth, body: document.body.scrollWidth, main: [main.scrollWidth, main.clientWidth], screen: [screen.scrollWidth, screen.clientWidth] };`);
    if (fit.doc > fit.inner + 1 || fit.body > fit.inner + 1) problems.push(`${nav}: page ${Math.max(fit.doc, fit.body)} px in a ${fit.inner} px window`);
    if (fit.main[0] > fit.main[1] + 1) problems.push(`${nav}: main area ${fit.main[0]} px wide in ${fit.main[1]} px`);
    if (fit.screen[0] > fit.screen[1] + 1) problems.push(`${nav}: screen ${fit.screen[0]} px wide in ${fit.screen[1]} px`);
    if (SHOTS) await screenshot(`${label} ${nav}`);
  }
  assert(!problems.length, `sideways overflow:\n      ${problems.join('\n      ')}`);
  return screens.length;
}

/** Sockets of the app and its WebKit helper processes that reach beyond this computer. */
function externalSockets() {
  const pids = new Set(appPids());
  // WebKit's web and network processes are children (or grandchildren) of the app.
  for (let grew = true; grew; ) {
    grew = false;
    for (const d of readdirSync('/proc')) {
      if (!/^\d+$/.test(d) || pids.has(Number(d))) continue;
      try {
        const ppid = Number(readFileSync(`/proc/${d}/stat`, 'utf8').replace(/^.*\) /s, '').split(' ')[1]);
        if (pids.has(ppid)) {
          pids.add(Number(d));
          grew = true;
        }
      } catch {}
    }
  }
  const inodes = new Set();
  for (const pid of pids) {
    try {
      for (const fd of readdirSync(`/proc/${pid}/fd`)) {
        try {
          const m = /^socket:\[(\d+)\]$/.exec(readlinkSync(`/proc/${pid}/fd/${fd}`));
          if (m) inodes.add(m[1]);
        } catch {}
      }
    } catch {}
  }
  const loopback = (hex) => (hex.length === 8 ? hex.endsWith('7F') || hex === '00000000' : /^0{24}01000000$|^0{20}FFFF0000[0-9A-F]{6}7F$|^0{32}$/.test(hex));
  const out = [];
  for (const proto of ['tcp', 'tcp6', 'udp', 'udp6']) {
    let lines = [];
    try {
      lines = readFileSync(`/proc/net/${proto}`, 'utf8').trim().split('\n').slice(1);
    } catch {}
    for (const line of lines) {
      const f = line.trim().split(/\s+/);
      if (!inodes.has(f[9])) continue;
      const [local, remote] = [f[1].split(':')[0], f[2].split(':')[0]];
      // The WebDriver automation link is on 127.0.0.1; anything else would be the network.
      if (!loopback(local) || !loopback(remote)) out.push(`${proto} ${f[1]} → ${f[2]}`);
    }
  }
  return { processes: pids.size, sockets: inodes.size, external: out };
}

/** Every file under a folder, recursively. */
function filesUnder(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function checkDisk() {
  const files = filesUnder(DATA).filter((f) => !relative(DATA, f).startsWith('example'));
  const needles = [MARKER, CODE, PROJECT, 'committee met every Thursday', ...(hasSpeech ? ['WAVEfmt', 'community garden'] : [])];
  const found = [];
  for (const f of files) {
    const bytes = readFileSync(f);
    for (const n of needles) {
      // UTF-8 and UTF-16 (SQLite can store text as either).
      if (bytes.includes(Buffer.from(n, 'utf8')) || bytes.includes(Buffer.from(n, 'utf16le'))) found.push(`"${n}" in ${relative(DATA, f)}`);
    }
  }
  assert(!found.length, `plaintext on disk: ${found.join(', ')}`);
  const projects = readdirSync(join(DATA, 'projects'));
  assert(projects.length === 1, `expected one project folder, found ${projects.length}`);
  const db = join(DATA, 'projects', projects[0], 'project.db');
  assert(existsSync(db) && statSync(db).size > 0, 'project.db is missing or empty');
  assert(readFileSync(db).subarray(0, 16).toString('latin1') !== 'SQLite format 3\0', 'project.db is a plain SQLite file');
  const keyring = JSON.parse(readFileSync(join(DATA, 'keyring.json'), 'utf8'));
  assert(Array.isArray(keyring.slots) && keyring.slots.length === 2, `keyring.json should have 2 slots, has ${keyring.slots?.length}`);
  const kinds = keyring.slots.map((s) => s.kind ?? s.type ?? s.method ?? '?').sort().join(',');
  const library = readFileSync(join(DATA, 'library.json'), 'utf8');
  assert(!library.includes(PROJECT) && !library.includes(tag), 'library.json shows the project name');
  return `${files.length} files checked (${files.map((f) => relative(DATA, f)).join(', ')}); keyring slots: ${kinds}`;
}

const digest = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

// ── The test ─────────────────────────────────────────────────────────────────────────────────

const watchdog = setTimeout(() => {
  console.error(`✗ the whole run took longer than ${DEADLINE_MS / 60000} min`);
  cleanup().finally(() => process.exit(1));
}, DEADLINE_MS);

let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (session) await wd('DELETE', '', undefined, 10_000).catch(() => {});
  session = null;
  await stopDriver();
  for (const pid of appPids()) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
  if (KEEP) console.log(`  kept: ${WORK}`);
  else rmSync(WORK, { recursive: true, force: true });
  // A default artifacts folder with nothing in it (a passing run) is not left behind.
  if (!process.env.TRAMA_E2E_ARTIFACTS && !readdirSync(ARTIFACTS).length) rmSync(ARTIFACTS, { recursive: true, force: true });
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => cleanup().finally(() => process.exit(130)));

let ok = false;
try {
  assert(existsSync(APP), `no release build at ${APP} (run npm run build:desktop, or set TRAMA_BIN)`);
  assert(!appPids().length, `${APP} is already running: close it first (the test would share its library)`);
  console.log(`Trama desktop e2e — ${APP}`);
  console.log(`  library: ${DATA}\n  artifacts: ${ARTIFACTS}\n  D-Bus: ${PRIVATE_BUS ? 'private session (dbus-run-session)' : 'inherited'}`);
  await startDriver();

  // 1 ── First run ───────────────────────────────────────────────────────────────────────────
  await step('start the app: the welcome screen, window title "Trama"', async () => {
    await startApp();
    await present('welcome', 60_000);
    const title = await windowTitle();
    assert(title === 'Trama', `window title: ${title}`);
  });

  await step('real-app styles: stylesheet, <style> elements and inline styles apply (CSP style-src)', async () => {
    // Tauri adds a nonce to style-src unless told not to; WebKit then drops inline styles while
    // the browser demo still looks right. Each kind of style is checked in the real webview.
    const r = await js(`const welcome = document.querySelector('[data-testid="welcome"]');
      const probe = document.createElement('div');
      probe.style.width = '123px';            // CSSOM, as React sets style={{}}
      probe.setAttribute('data-e2e', '');
      document.body.appendChild(probe);
      const attr = document.createElement('div');
      attr.setAttribute('style', 'width: 77px');
      document.body.appendChild(attr);
      const tag = document.createElement('style');
      tag.textContent = '[data-e2e] { height: 31px; }';
      document.head.appendChild(tag);
      const out = { welcomeDisplay: getComputedStyle(welcome).display, cssom: probe.getBoundingClientRect().width,
        attribute: attr.getBoundingClientRect().width, styleTag: probe.getBoundingClientRect().height,
        htmlBg: getComputedStyle(document.documentElement).backgroundColor, sheets: document.styleSheets.length };
      probe.remove(); attr.remove(); tag.remove();
      return out;`);
    assert(r.welcomeDisplay !== 'block' && r.welcomeDisplay !== 'inline', `the welcome screen has no layout (display ${r.welcomeDisplay}): stylesheets not applied`);
    assert(r.cssom === 123, `inline style (CSSOM) dropped: ${r.cssom}`);
    assert(r.attribute === 77, `style attribute dropped: ${r.attribute}`);
    assert(r.styleTag === 31, `<style> element ignored: ${r.styleTag}`);
    return `welcome display ${r.welcomeDisplay}; ${r.sheets} stylesheets; html background ${r.htmlBg}`;
  });

  await step('fonts: Instrument Sans and Literata load from the app', async () => {
    const r = await run(`await document.fonts.ready;
      await Promise.all([document.fonts.load('16px "Instrument Sans Variable"'), document.fonts.load('16px "Literata Variable"')]);
      const loaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, ''));
      return { loaded: [...new Set(loaded)], ui: getComputedStyle(document.body).fontFamily,
        title: getComputedStyle(document.querySelector('.welcome__title') || document.body).fontFamily };`);
    assert(!r.error, r.error);
    for (const f of ['Instrument Sans Variable', 'Literata Variable']) assert(r.loaded.includes(f), `${f} did not load (loaded: ${r.loaded.join(', ') || 'none'})`);
    assert(/^"?Instrument Sans Variable/.test(r.ui), `the interface font is ${r.ui}`);
    return `loaded: ${r.loaded.join(', ')}`;
  });

  await step('no network: no http/opener plugin, fetch and sockets blocked by the CSP', async () => {
    const http = await invoke('plugin:http|fetch', { clientConfig: { method: 'GET', url: 'https://example.com/', headers: [], data: null } });
    assert(http.denied && /not allowed|not found|unknown|plugin/i.test(http.denied), `plugin:http|fetch was not refused: ${JSON.stringify(http)}`);
    const opener = await invoke('plugin:opener|open_url', { url: 'https://example.com/' });
    assert(opener.denied, `plugin:opener|open_url was not refused: ${JSON.stringify(opener)}`);
    const shell = await invoke('plugin:shell|open', { path: 'https://example.com/' });
    assert(shell.denied, `plugin:shell|open was not refused: ${JSON.stringify(shell)}`);
    const r = await run(`const violations = [];
      const onV = (e) => violations.push(e.violatedDirective + ' ' + e.blockedURI);
      document.addEventListener('securitypolicyviolation', onV);
      const outcome = {};
      try { await fetch('https://example.com/?trama-e2e'); outcome.fetch = 'allowed'; } catch (e) { outcome.fetch = 'blocked: ' + e.message; }
      try { const x = new XMLHttpRequest(); x.open('GET', 'https://example.com/xhr'); await new Promise((res) => { x.onloadend = res; x.send(); }); outcome.xhr = x.status ? 'allowed' : 'blocked'; } catch (e) { outcome.xhr = 'blocked: ' + e.message; }
      try { const ws = new WebSocket('wss://example.com/'); outcome.ws = await new Promise((res) => { ws.onopen = () => res('allowed'); ws.onerror = () => res('blocked'); setTimeout(() => res('blocked (timeout)'), 4000); }); } catch (e) { outcome.ws = 'blocked: ' + e.message; }
      const img = new Image(); img.src = 'https://example.com/pixel.png?trama-e2e';
      outcome.img = await new Promise((res) => { img.onload = () => res('allowed'); img.onerror = () => res('blocked'); setTimeout(() => res('blocked (timeout)'), 4000); });
      await new Promise((res) => setTimeout(res, 300));
      document.removeEventListener('securitypolicyviolation', onV);
      return { outcome, violations };`);
    assert(!r.error, r.error);
    for (const [k, v] of Object.entries(r.outcome)) assert(v.startsWith('blocked'), `${k} to example.com was ${v}`);
    const connect = r.violations.filter((v) => /^connect-src .*example\.com/.test(v));
    assert(connect.length >= 2, `fetch/XHR were not blocked by the CSP (violations: ${r.violations.join('; ') || 'none'})`);
    assert(r.violations.some((v) => /^img-src .*example\.com/.test(v)), `the image was not blocked by the CSP (violations: ${r.violations.join('; ')})`);
    const sockets = externalSockets();
    assert(!sockets.external.length, `the app has network sockets: ${sockets.external.join(', ')}`);
    return `http: ${http.denied.slice(0, 70)}; CSP violations: ${r.violations.length}; ${sockets.processes} processes, ${sockets.sockets} sockets, none external`;
  });

  let words = [];
  await step('create a library: name, passphrase, recovery phrase and its check', async () => {
    await click('start-create');
    await type('coder-name', 'Ana E2E', { clear: true });
    await click('step-next');
    await type('passphrase', PASS);
    await type('passphrase-confirm', PASS);
    await click('step-next');
    await present('recovery-phrase');
    words = await js(`return [...document.querySelectorAll('[data-testid="recovery-phrase"] .phrase__w')].map((e) => e.textContent.trim())`);
    assert(words.length === 12, `the recovery phrase has ${words.length} words`);
    await click('phrase-written');
    await click('step-next');
    await present('create-check');
    const positions = await js(`return [...document.querySelectorAll('[data-testid^="check-word-"]')].map((e) => Number(e.dataset.testid.slice(11)))`);
    assert(positions.length === 3, `expected 3 words to confirm, found ${positions.length}`);
    // A wrong word first: the library must not be created.
    await type(`check-word-${positions[0]}`, 'zzzz');
    for (const p of positions.slice(1)) await type(`check-word-${p}`, words[p - 1]);
    await click('create-library');
    await sleep(500);
    assert(await exists('create-check'), 'a wrong check word was accepted');
    await type(`check-word-${positions[0]}`, words[positions[0] - 1], { clear: true });
    await click('create-library');
    await present('projects', 90_000);
  });

  await step('layout of the library screen and the project shell', async () => {
    const lib = await js(`const bar = document.querySelector('.library__bar');
      return { display: getComputedStyle(bar).display, height: bar.getBoundingClientRect().height };`);
    assert(lib.display === 'flex' || lib.display === 'grid', `library header not laid out: ${JSON.stringify(lib)}`);
    await click('new-project');
    await type('project-name', PROJECT);
    await click('project-dialog-save');
    await present('project-shell', 60_000);
    await present('workbench-empty', 30_000);
    await titleBecomes(`${PROJECT} · Trama`);
    const shell = await js(`const rail = document.querySelector('.rail'), main = document.querySelector('.shell__main');
      const r = rail.getBoundingClientRect(), m = main.getBoundingClientRect();
      const avatar = document.querySelector('[data-testid="project-switcher"] [style]');
      return { display: getComputedStyle(rail).display, dir: getComputedStyle(rail).flexDirection, railRight: r.right, mainLeft: m.left,
        railWidth: r.width, mainWidth: m.width, shellDisplay: getComputedStyle(document.querySelector('.shell')).display,
        inline: avatar ? [avatar.getAttribute('style'), getComputedStyle(avatar).backgroundColor] : null };`);
    assert(shell.shellDisplay === 'grid', `the project shell is not a grid: ${shell.shellDisplay}`);
    assert(shell.display === 'flex' && shell.dir === 'column', `the navigation rail is not laid out: ${JSON.stringify(shell)}`);
    assert(shell.railWidth > 40 && shell.railWidth < 400 && shell.mainLeft >= shell.railRight - 1, `rail and screen overlap: ${JSON.stringify(shell)}`);
    if (shell.inline) assert(!/rgba\(0, 0, 0, 0\)|transparent/.test(shell.inline[1]), `the project colour (inline style) is not painted: ${shell.inline.join(' → ')}`);
    return `rail ${Math.round(shell.railWidth)} px, screen ${Math.round(shell.mainWidth)} px${shell.inline ? `; inline ${shell.inline[0]} → ${shell.inline[1]}` : ''}`;
  });

  await step('import a text document through the (queued) file dialog', async () => {
    await click('nav-import');
    await present('import-start-panel');
    await js('window.__TRAMA_E2E_DIALOGS__ = [arguments[0]]', DOC_FILE);
    await click('import-choose');
    await present('import-row', 30_000);
    await click('import-start');
    await present('import-done', 60_000);
    const created = await js(`return [...document.querySelectorAll('[data-testid="import-created-doc"]')].map((e) => e.textContent.trim())`);
    assert(created.length === 1 && created[0].includes(tag), `imported: ${JSON.stringify(created)}`);
    await click('import-created-doc');
    await until('the document text', `const t = document.querySelector('[data-testid="doc-text"]'); return t && t.textContent.includes(arguments[0])`, [MARKER], 30_000);
    return `"${created[0]}"`;
  });

  await step('code a passage: select it, create and apply a code in the popover', async () => {
    await codeSelection(PASSAGE, CODE);
    const style = await codedRun(MARKER);
    // The viewer paints a coding's colour with an inline style: dropped styles would leave it bare.
    const painted = !/rgba\(0, 0, 0, 0\)|transparent/.test(style.bg) || style.bgImage !== 'none';
    assert(style.inline && painted, `the coded passage is not painted: ${JSON.stringify(style)}`);
    await present('stripe', 10_000);
    return `coded run painted: ${style.bgImage !== 'none' ? style.bgImage.slice(0, 80) : style.bg}`;
  });

  await step('transcribe a recording on this computer with the bundled speech model', async () => {
    if (!hasSpeech) return 'skipped: no speech model files, or no ffmpeg with flite for a sample';
    await click('nav-import');
    await present('import-start-panel');
    await js('window.__TRAMA_E2E_DIALOGS__ = [arguments[0]]', SPEECH_SAMPLE);
    await click('import-choose');
    // A recording without a transcript of the same name: transcribed after the import.
    await present('import-to-transcribe', 30_000);
    if (SHOTS) await screenshot('import recording');
    await click('import-start');
    await present('import-done', 60_000);
    await click('import-created-doc');
    await present('transcript-prompt', 30_000);
    await present('speech-transcribing', 30_000);
    if (SHOTS) await screenshot('transcribing');
    const started = Date.now();
    await until('the transcript', `const t = document.querySelector('[data-testid="doc-text"]'); return t && /community garden/i.test(t.textContent)`, [], 5 * 60_000);
    const text = await js(`return document.querySelector('[data-testid="doc-text"]').textContent.trim()`);
    assert(!(await exists('transcript-prompt')), 'the transcription prompt stayed after the transcript arrived');
    if (SHOTS) await screenshot('transcribed');
    return `"${text}" in ${since(started)}`;
  });

  await step('record a call: consent first; without a sound device it says so', async () => {
    if (!(await exists('doc-record'))) return 'skipped: no on-device speech in this build';
    await click('doc-record');
    await present('record-dialog');
    if (SHOTS) await screenshot('record dialog');
    assert(await js(`return document.querySelector('[data-testid="record-start"]').disabled`), 'recording could start without consent');
    await click('record-consent');
    await click('record-start');
    const outcome = await until(
      'the recording to start or be refused',
      // "Starting…" shows first; then the recording runs, or the dialog says why it cannot.
      `return document.querySelector('[data-testid="speech-recording"][data-phase="recording"]') ? 'recording' : document.querySelector('[data-testid="record-error"]') ? 'refused' : null`,
      [],
      30_000,
    );
    if (outcome === 'recording') {
      await sleep(5000);
      await click('speech-stop');
      await until('the recording to be saved', `return !document.querySelector('[data-testid="speech-recording"]')`, [], 60_000);
      return "recorded 5 s from this computer's devices";
    }
    const why = await js(`return document.querySelector('[data-testid="record-error"]').textContent.trim()`);
    if (SHOTS) await screenshot('record refused');
    await keys('\uE00C'); // Escape
    await until('the dialog to close', `return !document.querySelector('[data-testid="record-dialog"]')`, [], 10_000);
    return `no sound device here: "${why}"`;
  });

  // The steps after this one expect the text document to be the open one.
  await step('back to the text document', async () => {
    await click('nav-workbench');
    const opened = await js(
      `const o = [...document.querySelectorAll('[data-testid="doc-list"] [role="option"]')].find((e) => e.textContent.includes(arguments[0]));
       if (o) o.click(); return !!o;`,
      tag,
    );
    assert(opened, 'the text document is not in the list');
    await until('its text', `const t = document.querySelector('[data-testid="doc-text"]'); return t && t.textContent.includes(arguments[0])`, [MARKER], 30_000);
  });

  await step('lock with Ctrl+L; a wrong passphrase is refused; unlock; the coding is still there', async () => {
    await js('document.activeElement && document.activeElement.blur && document.activeElement.blur(); document.getSelection().removeAllRanges()');
    await keys(CTRL, 'l');
    await present('unlock-passphrase', 30_000);
    const leftovers = await js(`return document.body.innerText.includes(arguments[0]) || document.body.innerText.includes(arguments[1])`, MARKER, CODE);
    assert(!leftovers, 'the locked screen still shows project content');
    // The title is visible to other programs (taskbar, screen sharing): no project name while locked.
    await titleBecomes('Trama', 'while locked');
    await unlock('wrong passphrase entirely');
    await until('the wrong passphrase to be refused', `const i = document.querySelector('[data-testid="unlock-passphrase"]'); return i && i.getAttribute('aria-invalid') === 'true' && i.value === '' && !document.querySelector('[data-testid="unlock-submit"][aria-busy="true"]')`, [], 60_000);
    assert(!(await exists('project-shell')), 'a wrong passphrase opened the library');
    await unlock();
    await openOurProject();
    await openDocument(tag, MARKER);
    await codedRun(MARKER);
  });

  await step('quit (close the window)', async () => {
    await quitApp();
  });

  await step('files on disk are encrypted (no plaintext; SQLCipher; 2 keyring slots)', async () => checkDisk());

  // 2 ── Restart ─────────────────────────────────────────────────────────────────────────────
  await step('restart: unlock; the document, its coding and the code persist', async () => {
    await startApp();
    await present('unlock-passphrase', 60_000);
    await unlock();
    await openOurProject();
    await openDocument(tag, MARKER);
    await codedRun(MARKER);
    await click('nav-codes');
    await until('the code in the codebook', `const t = document.querySelector('[data-testid="codes-tree"]'); return t && t.textContent.includes(arguments[0])`, [CODE], 30_000);
  });

  await step('smallest window (1000×660): every screen fits without sideways scrolling', async () => {
    await wd('POST', '/window/rect', { width: 800, height: 500 });
    await sleep(800);
    const size = await js('return [innerWidth, innerHeight]');
    assert(size[0] >= 1000 && size[1] >= 660 && size[0] <= 1010, `the window went below its minimum size: ${size.join('×')}`);
    const n = await overflowTour('min');
    await openDocument(tag, MARKER);
    const fit = await js('return [document.documentElement.scrollWidth, innerWidth]');
    assert(fit[0] <= fit[1] + 1, `the open document scrolls sideways: ${fit.join(' > ')}`);
    if (SHOTS) await screenshot('min-size workbench');
    return `${size.join('×')}; ${n} screens`;
  });

  await step('quit, and the files are still encrypted', async () => {
    await quitApp();
    return checkDisk();
  });

  // 3 ── The example project, at a 125% text scale ───────────────────────────────────────────
  const keyringBefore = digest(join(DATA, 'keyring.json'));
  const libraryBefore = digest(join(DATA, 'library.json'));
  await step('restart the driver with GDK_DPI_SCALE=1.25', async () => {
    await startDriver({ GDK_DPI_SCALE: '1.25' });
    domClicks = true;
  });

  await step('--example: opens straight into the fictional example project, titled as the example', async () => {
    await startApp(['--example']);
    await present('project-shell', 90_000);
    await present('example-ribbon');
    const title = await titleBecomes(/ · (Example|Exemplo|Ejemplo) · Trama$/, 'of the example');
    const info = await invoke('app_info');
    assert(info.ok?.example === true && info.ok.data_dir.startsWith(join(DATA, 'example')), `app_info: ${JSON.stringify(info)}`);
    scale = await js('return devicePixelRatio');
    const textScale = await js(`const p = document.createElement('span'); p.style.fontSize = '100px'; p.textContent = 'x'; document.body.appendChild(p);
      const h = p.getBoundingClientRect().height; p.remove(); return h;`);
    return `title "${title}"; devicePixelRatio ${scale}; 100px text box ${Math.round(textScale)} px`;
  });

  await step('example at 125%: every screen opens, fits, and settles', async () => {
    const n = await overflowTour('example125');
    // Fields that grow with their text must settle at a fractional scale (no render loop).
    await openDocument(null);
    const heights = [];
    for (let i = 0; i < 3; i++) {
      heights.push(await js('return document.documentElement.scrollHeight + ":" + document.querySelectorAll("*").length'));
      await sleep(500);
    }
    assert(new Set(heights).size === 1, `the workbench keeps changing at this scale: ${heights.join(', ')}`);
    if (SHOTS) await screenshot('example125 workbench');
    return `${n} screens`;
  });

  await step('example: make a change (a new code on a passage)', async () => {
    const passage = await js(`const t = document.querySelector('[data-testid="doc-text"]').textContent; const m = /[A-Za-zÀ-ÿ]{4,}( [A-Za-zÀ-ÿ]{3,}){3}/.exec(t); return m && m[0];`);
    assert(passage, 'no passage to select in the example document');
    await codeSelection(passage, EXAMPLE_CODE);
    await until('the selection popover to close', 'return !document.querySelector(\'[data-testid="selection-popover"]\')', [], 15_000);
    await click('nav-codes');
    await until('the new code', `const t = document.querySelector('[data-testid="codes-tree"]'); return t && t.textContent.includes(arguments[0])`, [EXAMPLE_CODE], 30_000);
    await quitApp();
  });

  await step('example: restarted afresh, without the change', async () => {
    await startApp(['--example']);
    await present('project-shell', 90_000);
    await click('nav-codes');
    await until('the example codebook', `const t = document.querySelector('[data-testid="codes-tree"]'); return t && t.textContent.trim().length > 0`, [], 30_000);
    const kept = await js(`return document.body.innerText.includes(arguments[0])`, EXAMPLE_CODE);
    assert(!kept, 'the example project kept a change after a restart');
    await quitApp();
  });

  await step('the example never touched the real library, and its folder went on exit', async () => {
    assert(digest(join(DATA, 'keyring.json')) === keyringBefore, 'keyring.json changed');
    assert(digest(join(DATA, 'library.json')) === libraryBefore, 'library.json changed');
    assert(readdirSync(join(DATA, 'projects')).length === 1, 'the real library gained a project');
    assert(!existsSync(join(DATA, 'example')), 'the example folder was not removed when the app exited');
  });

  await step('the real library at 125%: unlock, the coded passage is there', async () => {
    await startApp();
    await present('unlock-passphrase', 60_000);
    await unlock();
    await openOurProject();
    await openDocument(tag, MARKER);
    await codedRun(MARKER);
    const fit = await js('return [document.documentElement.scrollWidth, innerWidth]');
    assert(fit[0] <= fit[1] + 1, `the workbench scrolls sideways at 125%: ${fit.join(' > ')}`);
    const sockets = externalSockets();
    assert(!sockets.external.length, `the app has network sockets: ${sockets.external.join(', ')}`);
    await quitApp();
    return checkDisk();
  });

  ok = true;
} catch {
  // Reported by the step that failed.
} finally {
  clearTimeout(watchdog);
  await cleanup();
  console.log('');
  for (const [name, ms] of timings) console.log(`  ${(ms / 1000).toFixed(1).padStart(6)}s  ${name}`);
  console.log(ok ? `✓ desktop end-to-end test passed in ${since(t0)}` : `✗ desktop end-to-end test FAILED after ${since(t0)} (screenshots: ${ARTIFACTS})`);
  process.exit(ok ? 0 : 1);
}

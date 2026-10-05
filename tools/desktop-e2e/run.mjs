// End-to-end test of the real desktop app (Linux), through WebDriver.
// Needs: a release build, WebKitWebDriver (package webkit2gtk-driver) and `cargo install tauri-driver`.
// Run under a display, e.g.: xvfb-run -a node tools/desktop-e2e/run.mjs
// Uses a throwaway data folder (SALA_DATA_DIR), never your real practice. The example practice
// part runs at a 125% display scale (GDK_DPI_SCALE), where sizes round differently.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP = process.env.SALA_BIN ?? join(import.meta.dirname, '../../desktop/src-tauri/target/release/sala-desktop');
const DATA = mkdtempSync(join(tmpdir(), 'sala-e2e-'));
const PASS = 'violet river morning tea';
const MARKER = 'E2E-PLAINTEXT-MARKER-4711';
const LAST_WORDS = 'E2E-TYPED-BEFORE-LOCK-0815';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const spawnDriver = (env = {}) => spawn('tauri-driver', [], { env: { ...process.env, SALA_DATA_DIR: DATA, ...env }, stdio: 'ignore' });
let driver = spawnDriver();
await sleep(1500);

let session;
async function wd(method, path, body) {
  const res = await fetch(`http://127.0.0.1:4444/session${session ? `/${session}` : ''}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (json.value?.error) throw new Error(`${method} ${path}: ${json.value.error} ${json.value.message ?? ''}`);
  return json.value;
}
const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';
async function find(testId, timeout = 30000, selector = `[data-testid="${testId}"]`) {
  const end = Date.now() + timeout;
  for (;;) {
    try {
      const el = await wd('POST', '/element', { using: 'css selector', value: selector });
      return el[ELEMENT];
    } catch (e) {
      if (Date.now() > end) throw new Error(`not found: ${testId}`);
      await sleep(250);
    }
  }
}
const exists = async (testId) =>
  wd('POST', '/execute/sync', { script: `return !!document.querySelector('[data-testid="${testId}"]')`, args: [] });
/** Every textarea's text, for checks on what a page holds. */
const fieldText = async () => wd('POST', '/execute/sync', { script: 'return [...document.querySelectorAll("textarea, input")].map((t) => t.value).join(" ")', args: [] });
// At a fractional display scale WebKitWebDriver aims its clicks at the wrong place, so the part
// of the test that runs at 125% clicks through the page instead.
let domClicks = false;
const click = async (id) =>
  domClicks
    ? wd('POST', '/execute/sync', { script: 'document.querySelector(arguments[0]).click()', args: [`[data-testid="${(await find(id), id)}"]`] })
    : wd('POST', `/element/${await find(id)}/click`, {});
const type = async (id, text) => wd('POST', `/element/${await find(id)}/value`, { text });
const attr = async (id, name) => wd('GET', `/element/${await find(id)}/attribute/${name}`);
const bodyText = async () => wd('POST', '/execute/sync', { script: 'return document.body.innerText', args: [] });
async function start(args = []) {
  session = undefined;
  const s = await wd('POST', '', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args } } } });
  session = s.sessionId;
}
const stop = async () => {
  await wd('DELETE', '').catch(() => {});
  session = undefined;
};

let ok = false;
try {
  await start();
  console.log('• first run');
  await click('start-new');
  await type('passphrase', PASS);
  await type('passphrase-confirm', PASS);
  await click('next');
  const words = (await attr('recovery-phrase', 'aria-label')).split(' ');
  await click('phrase-written');
  await click('next');
  for (let n = 1; n <= 12; n++) {
    try {
      const el = await wd('POST', '/element', { using: 'css selector', value: `[data-testid="check-word-${n}"]` });
      await wd('POST', `/element/${el[ELEMENT]}/value`, { text: words[n - 1] });
    } catch {}
  }
  await click('next');
  await click('backup-later'); // native folder dialogs cannot be driven; choose later
  await find('screen-shelf', 60000);

  console.log('• layout: sidebar beside the screen, rows laid out as rows');
  // Guards against styles being dropped by the webview's content security policy.
  const layout = await wd('POST', '/execute/sync', {
    script: `const r = (s) => document.querySelector(s).getBoundingClientRect();
      const nav = r('[data-testid="nav-today"]'), screen = r('[data-testid="screen-shelf"]'), btn = r('[data-testid="new-folder"]');
      return [screen.left >= nav.right, btn.top < 120, getComputedStyle(document.querySelector('[data-testid="new-folder"]')).flexDirection].join(',');`,
    args: [],
  });
  if (layout !== 'true,true,row') throw new Error(`layout broken in the real app: ${layout}`);

  console.log('• brand type loads from the app; the BETA ribbon sits in the bottom-left corner');
  const brand = await wd('POST', '/execute/async', {
    script: `const done = arguments[arguments.length - 1];
      document.fonts.ready.then(() => {
        const loaded = [...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'Alegreya Sans' && f.status === 'loaded');
        const label = [...document.querySelectorAll('[data-testid="nav-today"] div[dir]')].find((e) => e.textContent);
        const ribbon = document.querySelector('[data-testid="beta-ribbon"]').getBoundingClientRect();
        done([loaded, getComputedStyle(label).fontFamily.startsWith('"Alegreya Sans"'), ribbon.left === 0 && Math.round(ribbon.bottom) === innerHeight].join(','));
      });`,
    args: [],
  });
  if (brand !== 'true,true,true') throw new Error(`brand font or BETA ribbon missing in the real app: ${brand}`);

  console.log('• The Human Loop: off until joined; network scoped to its hosts');
  const scoped = await wd('POST', '/execute/async', {
    script: `const done = arguments[arguments.length - 1];
      window.__TAURI_INTERNALS__.invoke('plugin:http|fetch', { clientConfig: { method: 'GET', url: 'https://example.com/', headers: [], data: null } })
        .then(() => done('allowed'), (e) => done('denied: ' + String(e).slice(0, 140)));`,
    args: [],
  });
  if (!/denied: .*(not allowed|scope|forbidden)/i.test(scoped)) throw new Error(`HTTP to other hosts was not blocked by the scope: ${scoped}`);
  console.log('  ', scoped);

  console.log('• update check: only the manifest on Sala\'s website; links open only Sala\'s website');
  const invoke = (cmd, argsJson) =>
    wd('POST', '/execute/async', {
      script: `const done = arguments[arguments.length - 1];
        window.__TAURI_INTERNALS__.invoke('${cmd}', ${argsJson}).then(() => done('allowed'), (e) => done('denied: ' + String(e).slice(0, 140)));`,
      args: [],
    });
  const fetchArgs = (url) => JSON.stringify({ clientConfig: { method: 'GET', url, headers: [], data: null } });
  const manifest = await invoke('plugin:http|fetch', fetchArgs('https://sala.thehumanloop.eu/downloads/manifest.json'));
  // Offline machines fail with a network error; what matters is that the scope lets it through.
  if (/not allowed|scope|forbidden/i.test(manifest)) throw new Error(`the update manifest was blocked by the scope: ${manifest}`);
  const elsewhere = await invoke('plugin:http|fetch', fetchArgs('https://sala.thehumanloop.eu/downloads/'));
  if (!/denied: .*(not allowed|scope|forbidden)/i.test(elsewhere)) throw new Error(`other paths on Sala's website were not blocked: ${elsewhere}`);
  const link = await invoke('plugin:opener|open_url', JSON.stringify({ url: 'https://example.com/' }));
  if (!/denied: .*(not allowed|scope|forbidden)/i.test(link)) throw new Error(`opening other websites was not blocked: ${link}`);
  console.log('  ', `manifest ${manifest}; other paths ${elsewhere.slice(0, 60)}; other sites ${link.slice(0, 60)}`);
  await click('nav-loop');
  await find('screen-loop-home');
  await click('join-loop');
  await find('loop-email');
  await click('nav-shelf');

  console.log('• folder and page');
  await click('new-folder');
  await type('folder-label', 'Test Patient');
  await click('save-folder');
  await find('screen-folder');
  await click('new-page');
  // A folder's first page is an intake page: write in its first section, whatever it is.
  const firstSection = await find('first page section', 30000, '[data-testid^="page-section-"]');
  await wd('POST', `/element/${firstSection}/value`, { text: `Session notes ${MARKER}` });
  await sleep(1500);

  console.log('• lock right after typing keeps the last words');
  await wd('POST', `/element/${firstSection}/value`, { text: ` ${LAST_WORDS}` });
  await click('nav-lock');
  await type('unlock-passphrase', 'wrong passphrase');
  await click('unlock');
  await sleep(1500);
  if (!/does not open/.test(await bodyText())) throw new Error('wrong passphrase was not rejected');
  await wd('POST', `/element/${await find('unlock-passphrase')}/clear`, {});
  await type('unlock-passphrase', PASS);
  await click('unlock');
  await find('screen-today', 60000);
  await stop();

  console.log('• files on disk are encrypted');
  for (const f of readdirSync(DATA)) {
    if (!f.startsWith('practice.db')) continue;
    const bytes = readFileSync(join(DATA, f));
    if (bytes.includes(Buffer.from(MARKER))) throw new Error(`plaintext found in ${f}`);
    if (f === 'practice.db' && bytes.subarray(0, 15).toString() === 'SQLite format 3') throw new Error('database is not encrypted');
  }
  const keyring = JSON.parse(readFileSync(join(DATA, 'keyring.json'), 'utf8'));
  if (keyring.slots.length !== 2) throw new Error('keyring should have two slots');

  console.log('• the offline OCR engine and language data load inside the app');
  await start();
  const probe = await wd('POST', '/execute/async', {
    script: `const done = arguments[arguments.length - 1];
      (async () => {
        const base = new URL('ocr/', document.baseURI).href;
        const lang = await fetch(base + 'lang/por.traineddata.gz');
        const core = await fetch(base + 'core/tesseract-core-simd-lstm.wasm');
        const mod = await WebAssembly.compile(await core.arrayBuffer());
        const w = new Worker(base + 'worker.min.js');
        w.terminate();
        return [lang.ok, (await lang.arrayBuffer()).byteLength > 500000, mod instanceof WebAssembly.Module].join(',');
      })().then(done, (e) => done('error: ' + e));`,
    args: [],
  });
  if (probe !== 'true,true,true') throw new Error(`OCR assets did not load: ${probe}`);
  await stop();

  console.log('• restart keeps the practice');
  await start();
  await type('unlock-passphrase', PASS);
  await click('unlock');
  await find('screen-today', 60000);
  await click('nav-shelf');
  await click('folder-card-Test Patient');
  await find('page-editor');
  const saved = await fieldText();
  if (!saved.includes(MARKER)) throw new Error('page text not found after restart');
  if (!saved.includes(LAST_WORDS)) throw new Error('the words typed just before locking were lost');
  await stop();

  console.log('• the smallest window still lays out without sideways scrolling');
  await start();
  await type('unlock-passphrase', PASS);
  await click('unlock');
  await find('screen-today', 60000);
  await wd('POST', '/window/rect', { width: 960, height: 640 }).catch(() => {});
  await sleep(800);
  for (const [nav, screen] of [['nav-today', 'screen-today'], ['nav-shelf', 'screen-shelf'], ['nav-calendar', 'screen-calendar']]) {
    await click(nav);
    await find(screen);
    await sleep(500);
    const fit = await wd('POST', '/execute/sync', { script: 'return [innerWidth, document.documentElement.scrollWidth]', args: [] });
    if (fit[1] > fit[0] + 1) throw new Error(`${screen} is wider than a ${fit[0]} px window (${fit[1]} px)`);
  }
  await stop();

  console.log('• the example practice: fictional, passphrase "sala", reset at every start; at 125% scale');
  driver.kill();
  await sleep(1000);
  driver = spawnDriver({ GDK_DPI_SCALE: '1.25' });
  domClicks = true;
  await sleep(1500);
  await start(['--example']);
  await type('unlock-passphrase', 'sala');
  await click('unlock');
  await find('screen-today', 60000);
  await find('example-badge');
  await sleep(1500);
  if (await exists('backup-notice')) throw new Error('the example practice asks for a backup folder');
  const title = await wd('POST', '/execute/async', {
    script: `const done = arguments[arguments.length - 1];
      window.__TAURI_INTERNALS__.invoke('plugin:window|title', { label: 'main' }).then(done, (e) => done('error: ' + e));`,
    args: [],
  });
  if (!/^Sala \((example|exemplo|ejemplo)\)$/.test(title)) throw new Error(`example window title: ${title}`);
  const scale = await wd('POST', '/execute/sync', { script: 'return devicePixelRatio', args: [] });
  if (scale !== 1.25) console.log(`   (display scale ${scale}, not 1.25: the scale check is weaker)`);
  // Pages and dialogs whose text boxes grow with their text: they must settle at this scale.
  await click('nav-shelf');
  await click('folder-card-Inês Salgado');
  await find('page-editor');
  await sleep(1500);
  if (!(await exists('screen-folder'))) throw new Error(`a folder with pages does not open at display scale ${scale}`);
  await click('nav-calendar');
  await click('new-appointment');
  await find('appointment-dialog');
  await sleep(1500);
  if (!(await exists('appointment-dialog'))) throw new Error(`the appointment dialog does not open at display scale ${scale}`);
  await stop();
  await start(['--example']);
  await type('unlock-passphrase', 'sala');
  await click('unlock');
  await find('screen-today', 60000);
  await click('nav-shelf');
  await find('folder-card-Beatriz Nunes');
  await click('new-folder');
  await type('folder-label', 'Example Change');
  await click('save-folder');
  await find('screen-folder');
  await stop();
  await start(['--example']);
  await type('unlock-passphrase', 'sala');
  await click('unlock');
  await find('screen-today', 60000);
  await click('nav-shelf');
  await find('folder-card-Beatriz Nunes');
  if ((await bodyText()).includes('Example Change')) throw new Error('the example practice kept a change after a restart');
  await stop();
  if (!readdirSync(DATA).includes('practice.db')) throw new Error('the example touched the real practice');

  ok = true;
  console.log('✓ desktop end-to-end test passed');
} catch (e) {
  console.error('✗', e.message);
} finally {
  await stop();
  driver.kill();
  rmSync(DATA, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
}

// The manual's screenshots. Each is taken from the browser demo (the fictional example project,
// app/src/demo) in en, pt and es, with a fixed clock and seeded randomness, so the same code
// gives the same pictures. The names are pinned by app/src/features/help/manual.test.ts.
//
// A shot is { name, query, ready?, steps?, keepFocus?, theme?, langs? }:
//   query      demo URL parameters (app/src/demo/boot.ts) besides lang, theme and clock
//   ready      a data-testid that must be visible before the steps run
//   steps      drives the screen into the state shown; it must wait for what it needs, so a
//              screen that changes makes the run fail instead of producing a wrong picture
//   keepFocus  leave the focused element alone (a popover that closes on blur)
//   theme      'light' (default) or 'dark'; langs limits the languages (default: all)

/** Fictional projects added beside the example on the projects screen. */
const OTHER_PROJECTS = {
  en: [
    { name: 'Caring at a distance', description: 'Interviews with adult children who care for a parent from another country.' },
    { name: 'Teachers’ workload — focus groups', description: 'Six focus groups with secondary-school teachers, spring term.' },
  ],
  pt: [
    { name: 'Cuidar à distância', description: 'Entrevistas a filhos adultos que cuidam de um dos pais a partir de outro país.' },
    { name: 'Carga de trabalho docente — grupos focais', description: 'Seis grupos focais com professores do ensino secundário, 2.º período.' },
  ],
  es: [
    { name: 'Cuidar a distancia', description: 'Entrevistas a hijos adultos que cuidan de su padre o su madre desde otro país.' },
    { name: 'Carga de trabajo docente — grupos focales', description: 'Seis grupos focales con profesorado de secundaria, segundo trimestre.' },
  ],
};

/** Speaker labels and transcription marks: the words a researcher leaves out of a word count. */
const LEAVE_OUT = {
  en: 'interviewer, moderator, laughs, laughter',
  pt: 'entrevistadora, moderadora, ri-se, risos',
  es: 'entrevistadora, moderadora, ríe, risas',
};

/**
 * Files queued on the import screen, in this order: fictional material in the picture's own
 * language (tools/screenshots/fixtures/<lang>), in three formats Trama reads differently.
 */
const IMPORT_FILES = {
  en: ['Field notes — harvest day.md', 'Focus group — Kiln Hill.vtt', 'Interview 7 — Teresa.txt'],
  pt: ['Notas de campo — dia da colheita.md', 'Grupo focal — Alto do Moinho.vtt', 'Entrevista 7 — Teresa.txt'],
  es: ['Notas de campo — día de la cosecha.md', 'Grupo focal — Cerro del Molino.vtt', 'Entrevista 7 — Teresa.txt'],
};

/** Clicks the first document of the list and waits for its text. */
async function openFirstDocument(page) {
  await page.getByTestId('doc-list').locator('[data-testid^="doc-"]:not([data-testid="doc-more"])').first().click();
  await page.getByTestId('doc-text').locator('.wb-r--coded').first().waitFor();
  await page.getByTestId('stripe').first().waitFor();
}

/**
 * Selects one uncoded sentence of a participant's turn in the visible part of the open
 * document, the way a mouse would, so the selection popover opens beside it. Works in every
 * language: it looks at the layout, not the words.
 */
async function selectSentence(page) {
  const picked = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="doc-text"]');
    const scroller = document.querySelector('[data-testid="viewer-scroll"]') ?? root;
    const view = scroller.getBoundingClientRect();
    for (const p of root.querySelectorAll('p.wb-p')) {
      const box = p.getBoundingClientRect();
      // Low enough to leave room above, high enough for the popover to open below.
      if (box.top < view.top + 220 || box.bottom > view.top + 560) continue;
      for (const run of p.querySelectorAll('.wb-r:not(.wb-r--label):not(.wb-r--coded)')) {
        const node = run.firstChild;
        if (!node || node.nodeType !== Node.TEXT_NODE) continue;
        for (const m of node.data.matchAll(/[^.!?…]+[.!?…]+/g)) {
          const lead = m[0].length - m[0].trimStart().length;
          const start = m.index + lead;
          const end = m.index + m[0].length;
          if (end - start < 45 || end - start > 120) continue;
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, end);
          root.focus({ preventScroll: true });
          const sel = document.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          return range.toString();
        }
      }
    }
    return null;
  });
  if (!picked) throw new Error('no uncoded sentence in view to select');
  await page.getByTestId('selection-popover').waitFor();
}

async function cooccurrence(page) {
  await page.getByTestId('analysis-tool-cooccurrence').click();
  await page.getByTestId('cooc-mode-paragraph').click();
  await page.getByTestId('cooc-heatmap-cell').first().waitFor();
}

export const SHOTS = [
  { name: 'welcome', query: 'demo=empty', ready: 'welcome' },
  {
    name: 'projects',
    query: 'route=library',
    ready: 'projects',
    steps: async (page, lang) => {
      for (const p of OTHER_PROJECTS[lang]) {
        await page.getByTestId('new-project').click();
        await page.getByTestId('project-dialog').waitFor();
        await page.getByTestId('project-name').fill(p.name);
        await page.getByTestId('project-description').fill(p.description);
        await page.getByTestId('project-dialog-save').click();
        // Creating a project opens it; go back to the list.
        await page.getByTestId('project-switcher').click();
        await page.getByTestId('switch-all').click();
        await page.getByTestId('projects').waitFor();
      }
      await page.getByTestId('project-open').nth(OTHER_PROJECTS[lang].length).waitFor();
    },
  },
  { name: 'workbench', query: 'route=workbench', ready: 'doc-list', steps: openFirstDocument },
  {
    name: 'coding',
    query: 'route=workbench',
    ready: 'doc-list',
    keepFocus: true,
    steps: async (page) => {
      await openFirstDocument(page);
      await selectSentence(page);
    },
  },
  {
    // A code (not a category) chosen: its definition, use and memos.
    name: 'codebook',
    query: 'route=codes',
    ready: 'codes-tree',
    steps: async (page) => {
      // The first code under the first category (the tree opens on the category).
      const row = page.getByTestId('codes-tree').locator('[data-testid^="code-"][aria-selected]').nth(1);
      await row.click();
      await row.and(page.locator('[aria-selected="true"]')).waitFor();
      await page.getByTestId('code-detail-inclusion').waitFor();
      await page.locator('[data-testid^="code-segment-check-"]').first().waitFor();
    },
  },
  {
    // Filtered by one code, read with the surrounding sentence.
    name: 'segments',
    query: 'route=segments',
    ready: 'segment-list',
    steps: async (page) => {
      await page.getByTestId('filter-codes').locator('[data-testid^="filter-codes-row-"]').nth(1).click();
      await page.getByTestId('filter-codes').locator('.checklist__row--on').first().waitFor();
      await page.getByTestId('context-sentence').click();
      await page.getByTestId('segment-card').first().waitFor();
    },
  },
  { name: 'memos', query: 'route=memos', ready: 'memo-editor' },
  { name: 'cases', query: 'route=cases', ready: 'cases-grid' },
  { name: 'analysis-cooccurrence', query: 'route=analysis', ready: 'analysis', steps: cooccurrence },
  {
    name: 'analysis-words',
    query: 'route=analysis',
    ready: 'analysis',
    steps: async (page, lang) => {
      await page.getByTestId('analysis-tool-words').click();
      await page.getByTestId('wordcloud-word').first().waitFor();
      await page.getByTestId('words-stopwords').fill(LEAVE_OUT[lang]);
      await page.getByTestId('words-stopwords-save').click();
      const first = LEAVE_OUT[lang].split(',')[0];
      await page.waitForFunction((w) => {
        const words = [...document.querySelectorAll('[data-testid="wordcloud-word"]')].map((e) => e.textContent);
        return words.length > 20 && !words.includes(w);
      }, first);
    },
  },
  { name: 'agreement', query: 'route=agreement', ready: 'agreement-code-table' },
  {
    // The review step: three files read, the focus group selected to show what was found.
    name: 'import',
    query: 'route=import',
    ready: 'import-choose',
    steps: async (page, lang, { addFiles }) => {
      const files = IMPORT_FILES[lang];
      const paths = await addFiles('/home/demo/Documents/Fieldwork', files.map((f) => `${lang}/${f}`));
      await page.evaluate((p) => window.__tramaDemo.queueAnswer(p), paths);
      await page.getByTestId('import-choose').click();
      await page.getByTestId('import-row').nth(files.length - 1).waitFor();
      await page.locator('[data-testid="import-start"]:not([disabled])').waitFor({ timeout: 30000 });
      await page.getByTestId('import-row-select').nth(1).click();
      await page.getByTestId('import-row').nth(1).and(page.locator('.imp-item--selected')).waitFor();
    },
  },
  {
    // Backups switched on: the folder, the schedule and the first backup.
    name: 'project',
    query: 'route=project',
    ready: 'project-tabs',
    steps: async (page) => {
      await page.getByTestId('project-tabs-backups').click();
      await page.evaluate(() => window.__tramaDemo.queueAnswer('/home/demo/Backups'));
      await page.getByTestId('backup-choose-main').click();
      await page.getByTestId('backup-row').first().waitFor({ timeout: 30000 });
    },
  },

  // README heroes (English only).
  { name: 'workbench-dark', query: 'route=workbench', ready: 'doc-list', theme: 'dark', langs: ['en'], steps: openFirstDocument },
  { name: 'analysis-dark', query: 'route=analysis', ready: 'analysis', theme: 'dark', langs: ['en'], steps: cooccurrence },
];

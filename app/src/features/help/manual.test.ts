import { describe, expect, it } from 'vitest';
import { catalogs } from '../../core/i18n/catalogs';
import { UI_LOCALES } from '../../core/i18n/languages';
import type { Block, Inline } from '../../core/text/markdown';
import { MANUAL_SOURCES, manualChapters } from './manual';
import { CHAPTER_FILES, type Chapter, HELP_TOPICS, resolveLink, resolveTopic, ROUTE_TOPICS, SHORTCUTS_SLUG } from './manualModel';
import { isKeyLabel } from './render';
import { formatKeys, SHORTCUTS } from './shortcuts';

// The real manual in docs/manual: every chapter in every language, links that land, topics
// other screens use, and screenshot names the screenshot pipeline knows.

const SCREENSHOTS = ['welcome', 'projects', 'workbench', 'coding', 'codebook', 'segments', 'memos', 'cases', 'analysis-cooccurrence', 'analysis-words', 'agreement', 'import', 'project'];

function links(blocks: Block[]): string[] {
  const out: string[] = [];
  const walk = (c: Inline[]) => {
    for (const n of c) {
      if (n.t === 'link') out.push(n.href);
      if ('c' in n) walk(n.c);
    }
  };
  for (const b of blocks) {
    if (b.t === 'heading' || b.t === 'para' || b.t === 'quote') walk(b.c);
    else if (b.t === 'list') b.items.forEach((i) => walk(i.c));
    else if (b.t === 'table') [b.head, ...b.rows].forEach((r) => r.forEach(walk));
  }
  return out;
}

const anchors = (ch: Chapter) => ch.blocks.flatMap((b) => (b.t === 'heading' && b.level === 2 ? [b.anchor] : []));

describe('the manual', () => {
  it('has every chapter in every language', () => {
    for (const lang of UI_LOCALES) {
      for (const file of CHAPTER_FILES) expect(MANUAL_SOURCES[`${lang}/${file}`], `${lang}/${file}`).toBeTruthy();
    }
  });

  it('gives every chapter a title and its sections explicit anchors, the same in every language', () => {
    const en = manualChapters('en');
    for (const lang of UI_LOCALES) {
      const chs = manualChapters(lang);
      expect(chs.map((c) => c.file)).toEqual([...CHAPTER_FILES]);
      for (const ch of chs) {
        expect(ch.title, `${lang} ${ch.file}`).not.toBe(ch.slug);
        const src = MANUAL_SOURCES[`${lang}/${ch.file}`] ?? '';
        expect(src.match(/^# /gm)?.length ?? 0, `${lang} ${ch.file} has one title`).toBe(1);
        const explicit = [...src.matchAll(/^<a id="([^"]+)"><\/a>$/gm)].map((m) => m[1]);
        expect(new Set(explicit).size, `${lang} ${ch.file}: anchors are unique`).toBe(explicit.length);
        if (ch.file !== 'glossary.md' && ch.file !== 'index.md') {
          expect(anchors(ch).every((a) => explicit.includes(a!)), `${lang} ${ch.file}: every section has an <a id>`).toBe(true);
        }
        const enCh = en.find((c) => c.file === ch.file)!;
        expect(anchors(ch), `${lang} ${ch.file}: same sections as English`).toEqual(anchors(enCh));
      }
    }
  });

  it('links only to chapters and sections that exist', () => {
    for (const lang of UI_LOCALES) {
      const chs = manualChapters(lang);
      for (const ch of chs) {
        for (const href of links(ch.blocks)) {
          if (/^https?:/.test(href)) continue;
          const p = resolveLink(href, ch.slug, chs);
          expect(p, `${lang} ${ch.file}: ${href}`).not.toBeNull();
          if (p?.anchor) expect(chs.find((c) => c.slug === p.slug)!.sections.some((s) => s.anchor === p.anchor), `${lang} ${ch.file}: ${href}`).toBe(true);
        }
      }
    }
  });

  it('opens every help topic and screen topic at a section that exists, in every language', () => {
    for (const lang of UI_LOCALES) {
      const chs = manualChapters(lang);
      for (const [name, topic] of [...Object.entries(HELP_TOPICS), ...Object.entries(ROUTE_TOPICS)]) {
        const p = resolveTopic(topic, chs);
        expect(p, `${lang} ${name}`).not.toBeNull();
        const hash = topic.indexOf('#');
        if (hash >= 0 && p!.slug !== SHORTCUTS_SLUG) expect(p!.anchor, `${lang} ${name}: ${topic}`).toBe(topic.slice(hash + 1));
      }
    }
  });

  it('uses the screenshot names the pipeline generates, in the chapter’s own language', () => {
    for (const lang of UI_LOCALES) {
      for (const ch of manualChapters(lang)) {
        for (const b of ch.blocks) {
          if (b.t !== 'image') continue;
          const m = /^\.\.\/img\/([a-z]{2})\/([\w-]+)\.png$/.exec(b.src);
          expect(m, `${lang} ${ch.file}: ${b.src}`).not.toBeNull();
          expect(m![1], `${lang} ${ch.file}: ${b.src}`).toBe(lang);
          expect(SCREENSHOTS, `${lang} ${ch.file}: ${b.src}`).toContain(m![2]);
          expect(b.alt.length, `${lang} ${ch.file}: alt text`).toBeGreaterThan(3);
        }
      }
    }
  });

  it('writes keys the way Help can show them', () => {
    // Keys go in code spans (`Ctrl+K`), so Help shows them as keys, the Mac way on a Mac.
    for (const lang of UI_LOCALES) {
      for (const [k, src] of Object.entries(MANUAL_SOURCES)) {
        if (!k.startsWith(`${lang}/`)) continue;
        for (const m of src.matchAll(/`((?:Ctrl|Alt|Shift)\+[^`]+)`/g)) expect(isKeyLabel(m[1]!), `${k}: ${m[1]}`).toBe(true);
      }
    }
  });

  it('names screens and controls the way the interface does', () => {
    // The screen once called "Export & backup" is now Project, with Overview/Export/Backups tabs;
    // the manual and the merge dialog must not send readers to a screen that does not exist.
    const STALE = ['Export & backup', 'Exportar e cópias', 'Exportar y copias'];
    for (const lang of UI_LOCALES) {
      const m = catalogs[lang];
      const src = (file: string) => MANUAL_SOURCES[`${lang}/${file}`] ?? '';
      for (const [k, text] of Object.entries(MANUAL_SOURCES)) {
        if (k.startsWith(`${lang}/`)) for (const s of STALE) expect(text.includes(s), `${k}: ${s}`).toBe(false);
      }
      expect(STALE.some((s) => m.agreement.merge.backup.includes(s)), `${lang} agreement.merge.backup`).toBe(false);
      expect(m.agreement.merge.backup, `${lang} agreement.merge.backup`).toContain(`${m.app.nav.project} › ${m.exporter.tabs.backups}`);

      // Every screen in the navigation table is a real navigation item.
      const nav = Object.values(m.app.nav);
      const table = src('01-getting-started.md').split('\n').filter((l) => /^\| \*\*[^*]+\*\* \|/.test(l));
      expect(table.length, `${lang} navigation table`).toBeGreaterThan(8);
      for (const row of table) expect(nav, `${lang}: ${row.slice(0, 40)}`).toContain(/^\| \*\*([^*]+)\*\*/.exec(row)![1]);

      // The REFI-QDA export has one switch; restoring keeps the current project open.
      const exchange = src('09-exchange.md');
      expect(exchange, `${lang} 09-exchange`).toContain(`**${m.exporter.export.qdpx.maxqda}**`);
      expect(exchange, `${lang} 09-exchange`).toContain(`**${m.exporter.tabs.export}**`);
      const privacy = src('10-privacy-and-security.md');
      for (const label of [m.exporter.tabs.backups, m.exporter.backups.list.restore, m.exporter.backups.restore.fromFile, m.exporter.backups.restore.openNow]) {
        expect(privacy, `${lang} 10-privacy: ${label}`).toContain(`**${label}**`);
      }
      // The example restored name follows the app's pattern.
      const pattern = m.exporter.backups.restore.restoredName.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace('{name}', '.+').replace('{date}', '\\d{4}-\\d{2}-\\d{2}');
      expect(new RegExp(pattern).test(privacy), `${lang} 10-privacy: restored name like ${m.exporter.backups.restore.restoredName}`).toBe(true);
    }
  });

  it('documents both ways to skip through a recording', () => {
    // Alt+←/→ skip while the recording plays (Viewer.tsx); Alt+Shift+←/→ at any time.
    const recording = SHORTCUTS.find((g) => g.group === 'recording')!.items.flatMap((s) => s.keys.map((k) => formatKeys(k, false)));
    for (const k of ['Alt+←', 'Alt+→', 'Alt+Shift+←', 'Alt+Shift+→']) expect(recording, k).toContain(k);
    for (const lang of UI_LOCALES) {
      const docs = MANUAL_SOURCES[`${lang}/02-documents.md`] ?? '';
      for (const k of ['Alt+←', 'Alt+→', 'Alt+Shift+←', 'Alt+Shift+→']) expect(docs, `${lang} 02-documents: ${k}`).toContain(`\`${k}\``);
      expect(catalogs[lang].help.keys.labels.skip, lang).not.toBe(catalogs[lang].help.keys.labels.skipAlways);
    }
  });
});

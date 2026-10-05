// Getting files in: the system dialog (desktop), drag and drop, and in the browser demo an
// ordinary file input. Each incoming file is read only when its turn comes, so a hundred
// transcripts never sit in memory twice.

import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PdfJsLike } from '../../core/import';
import type { FileFilter, Platform } from '../../platform/types';

export interface IncomingFile {
  /** File name (no folders). */
  name: string;
  /** Where it came from: an absolute path, or the name for browser files. */
  path: string;
  read: () => Promise<Uint8Array>;
}

const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

export const fromPath = (platform: Platform, path: string): IncomingFile => ({ name: baseName(path), path, read: () => platform.files.read(path) });

export const fromBrowserFile = (file: File): IncomingFile => ({
  name: file.name,
  path: file.name,
  read: async () => new Uint8Array(await file.arrayBuffer()),
});

/** An <input type=file> for the browser demo, where there is no system dialog. */
function browserPick(filters: FileFilter[], multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',');
    input.style.display = 'none';
    let done = false;
    const finish = (files: File[]) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish([...(input.files ?? [])]));
    input.addEventListener('cancel', () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Asks for files. On the desktop: the system dialog. In the demo: the dialog's queued answers
 * (end-to-end tests), else the browser's own file chooser.
 */
export async function pickFiles(platform: Platform, title: string, filters: FileFilter[], multiple: boolean): Promise<IncomingFile[]> {
  const paths = await platform.dialogs.pickFiles(title, filters, multiple);
  if (paths.length || platform.kind === 'desktop') return paths.map((p) => fromPath(platform, p));
  return (await browserPick(filters, multiple)).map(fromBrowserFile);
}

let pdfjs: Promise<PdfJsLike> | null = null;

/** pdf.js with its worker from a bundled file; loaded on the first PDF only. */
export function loadPdfJs(): Promise<PdfJsLike> {
  pdfjs ??= import('pdfjs-dist').then((m) => {
    m.GlobalWorkerOptions.workerSrc = workerUrl;
    return m as unknown as PdfJsLike;
  });
  pdfjs.catch(() => (pdfjs = null));
  return pdfjs;
}

import { htmlToParagraphs } from './html';
import { canonicalize, tidy } from './text';
import { ImportError, WARNING, warning } from './types';

// Word (.docx) → text through mammoth's HTML (headings, paragraphs, lists, tables, footnotes),
// then our HTML reader. mammoth reads { buffer } in Node and { arrayBuffer } in the browser
// build; we pass both so the same call works in Vitest and in the webview.

/** The part of mammoth we use (structural, so the Node and browser builds both fit). */
export interface MammothLike {
  convertToHtml(
    input: { arrayBuffer: ArrayBuffer },
    options?: { convertImage?: unknown; ignoreEmptyParagraphs?: boolean; styleMap?: string | string[] },
  ): Promise<{ value: string; messages: unknown[] }>;
  images: { imgElement(f: (image: unknown) => Promise<{ src: string }>): unknown };
}

let loaded: Promise<MammothLike> | null = null;

/** mammoth, loaded on first use (it is large and only needed for Word files). */
export function loadMammoth(): Promise<MammothLike> {
  loaded ??= import('mammoth').then((m) => {
    const mod = m as unknown as { default?: MammothLike } & Partial<MammothLike>;
    return mod.default ?? (mod as MammothLike);
  });
  return loaded;
}

export interface DocxResult {
  text: string;
  warnings: string[];
}

export async function docxToText(bytes: Uint8Array, mammoth?: MammothLike): Promise<DocxResult> {
  const m = mammoth ?? (await loadMammoth());
  let images = 0;
  const ab = bytes.slice().buffer as ArrayBuffer;
  let html: string;
  try {
    const result = await m.convertToHtml({ arrayBuffer: ab, buffer: ab } as { arrayBuffer: ArrayBuffer }, {
      // Images would arrive as huge data: URIs; count them instead.
      convertImage: m.images.imgElement(() => {
        images++;
        return Promise.resolve({ src: '' });
      }),
    });
    html = result.value;
  } catch (e) {
    throw new ImportError('DAMAGED', 'docx', e instanceof Error ? e.message : String(e));
  }
  const warnings = images ? [warning(WARNING.imagesSkipped, images)] : [];
  return { text: tidy(canonicalize(htmlToParagraphs(html, { literal: true }).join('\n'))), warnings };
}

import { useCallback } from 'react';
import { buildXlsx, csvBytes } from '../../../core/export/office';
import { useProject, usePlatform } from '../../../shell/AppState';
import { useToast } from '../../../ui/components/Toast';
import { useI18n } from '../../../ui/i18n';
import { type Cell, safeFileName } from '../lib/format';
import { CHROME, type Theme } from '../lib/heat';

// Saving analysis results: tables as CSV or XLSX, charts as SVG or PNG. Files go where the
// researcher points the save dialog; each export is noted in the audit trail.

export type TableFormat = 'csv' | 'xlsx';
export type ImageFormat = 'svg' | 'png';

const FONT_STACK = "'Instrument Sans Variable', 'Instrument Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";

/**
 * A standalone SVG document from a chart on screen: namespaces, explicit size, a background in
 * the surface colour (an exported chart is read outside the app), and the interface font
 * named with fallbacks. Hover outlines and focus rings are left out.
 */
export function serializeSvg(svg: SVGSVGElement, theme: Theme): { text: string; width: number; height: number } {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const vb = svg.viewBox.baseVal;
  const width = Math.round(vb && vb.width ? vb.width : svg.clientWidth);
  const height = Math.round(vb && vb.height ? vb.height : svg.clientHeight);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.removeAttribute('class');
  clone.removeAttribute('style');
  clone.setAttribute('font-family', FONT_STACK);
  clone.querySelectorAll('[data-export="skip"]').forEach((n) => n.remove());
  clone.querySelectorAll('[tabindex]').forEach((n) => n.removeAttribute('tabindex'));
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('x', String(vb?.x ?? 0));
  bg.setAttribute('y', String(vb?.y ?? 0));
  bg.setAttribute('width', String(width));
  bg.setAttribute('height', String(height));
  bg.setAttribute('fill', CHROME[theme].surface);
  clone.insertBefore(bg, clone.firstChild);
  const text = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
  return { text, width, height };
}

/** PNG bytes of an SVG document, drawn at `scale` × its size through a canvas. */
export async function svgToPng(svgText: string, width: number, height: number, scale = 2): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('the chart could not be drawn as an image'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('the chart could not be encoded as PNG');
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface Exporter {
  /** Saves a table; `name` is the file name without extension. Resolves false when cancelled. */
  table: (name: string, format: TableFormat, rows: readonly (readonly Cell[])[], sheet?: string) => Promise<boolean>;
  /** Saves the chart drawn in `svg`. */
  image: (name: string, format: ImageFormat, svg: SVGSVGElement | null, theme: Theme) => Promise<boolean>;
}

export function useExporter(): Exporter {
  const platform = usePlatform();
  const project = useProject();
  const toast = useToast();
  const { t, locale } = useI18n();

  const save = useCallback(
    async (fileName: string, ext: string, filterName: string, bytes: () => Promise<Uint8Array> | Uint8Array): Promise<boolean> => {
      try {
        const path = await platform.dialogs.saveFile(t('analysis.export.dialogTitle'), fileName, [{ name: filterName, extensions: [ext] }]);
        if (!path) return false;
        await platform.files.write(path, await bytes());
        await project.log('export', `analysis: ${fileName}`).catch(() => undefined);
        toast.show({ message: t('analysis.export.saved', { name: fileName }), tone: 'success' });
        return true;
      } catch (e) {
        toast.error(e);
        return false;
      }
    },
    [platform, project, toast, t],
  );

  const table = useCallback<Exporter['table']>(
    (name, format, rows, sheet) => {
      const file = safeFileName(name, format);
      // Spreadsheets set to Portuguese or Spanish expect ';' (the comma is their decimal mark).
      if (format === 'csv') return save(file, 'csv', 'CSV', () => csvBytes(rows, { bom: true, delimiter: locale === 'en' ? ',' : ';' }));
      return save(file, 'xlsx', 'Excel', () => buildXlsx([{ name: (sheet ?? name).slice(0, 31) || 'Trama', rows }], { title: name }));
    },
    [save, locale],
  );

  const image = useCallback<Exporter['image']>(
    async (name, format, svg, theme) => {
      if (!svg) return false;
      const s = serializeSvg(svg, theme);
      const file = safeFileName(name, format);
      if (format === 'svg') return save(file, 'svg', 'SVG', () => new TextEncoder().encode(s.text));
      return save(file, 'png', 'PNG', () => svgToPng(s.text, s.width, s.height));
    },
    [save],
  );

  return { table, image };
}


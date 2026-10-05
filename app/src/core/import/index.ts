import { LIMITS } from '../model/types';
import { parseCsv } from './csv';
import { mimeOf, sniffFormat } from './detect';
import { type MammothLike, docxToText } from './docx';
import { decodeHtml, htmlToText } from './html';
import { markdownToText } from './md';
import { odtToText } from './odt';
import { type PdfJsLike, extractPdfText } from './pdf';
import { decodeRtfBytes, isRtf, rtfToText } from './rtf';
import { parseSrt } from './srt';
import { baseName, canonicalize, decodeTextWithInfo, tidyPlain } from './text';
import { type SpeakerOptions, cuesToTranscript, parseTextTranscript } from './transcript';
import { ImportError, type ImportFormat, type ImportedDoc, type ImportedTable, WARNING } from './types';
import { parseVtt } from './vtt';
import { type XlsxSheet, readXlsx } from './xlsx';

// One entry point for the importer screen: bytes and a file name in, canonical documents (or a
// table to map into survey documents) out. Errors are ImportError with a code the screen can
// explain; anything unexpected from a parser is reported as DAMAGED, never thrown raw.

export * from './types';
export { SUPPORTED, supportedExtensions, formatOf, sniffFormat, mimeOf, type SupportedFormat, type FormatGroup } from './detect';
export { canonicalize, decodeText, decodeTextWithInfo, baseName, docName } from './text';
export { surveyToDocuments, type SurveyOptions, type SurveyResult, type SurveySpan, type SurveyCase, type SurveyLayout } from './survey';
export { listXlsxSheets, type XlsxSheet } from './xlsx';
export { parseTextTranscript, cuesToTranscript, looksLikeTranscript, parseTimestamp, cleanSpeakerName, type Cue, type SpeakerOptions, type TranscriptResult } from './transcript';
export { extractPdfText, type PdfJsLike, type PdfText } from './pdf';
export { loadMammoth, type MammothLike } from './docx';
// The individual readers, for callers that already hold decoded text or want one format only.
export { htmlToText } from './html';
export { markdownToText } from './md';
export { rtfToText } from './rtf';
export { odtToText } from './odt';
export { docxToText } from './docx';
export { parseVtt } from './vtt';
export { parseSrt } from './srt';
export { parseCsv } from './csv';
export { readXlsx, type XlsxResult } from './xlsx';

export type TranscriptMode = 'auto' | 'always' | 'never';

export interface ImportOptions {
  /** pdf.js module, required for PDF files (the app passes its worker-backed build). */
  pdfjs?: PdfJsLike;
  /** mammoth module; loaded on demand when absent. */
  mammoth?: MammothLike;
  /** Password for an encrypted PDF (after an ENCRYPTED_PDF error). */
  password?: string;
  /** Text, Word, OpenDocument, RTF and Markdown files: read speaker turns? Default 'auto'. */
  transcript?: TranscriptMode;
  speakers?: SpeakerOptions;
  /** Subtitle files: a sync point at every cue (default) or only at each turn. */
  syncEveryCue?: boolean;
  /** Spreadsheets: sheet index or name (default: the first visible sheet). */
  sheet?: number | string;
  /** Keep the original PDF/Word file in the document (default true). */
  keepOriginal?: boolean;
  /** Skip detection and read the file as this format. */
  format?: ImportFormat;
}

export interface ImportedTableResult {
  table: ImportedTable;
  format: 'csv' | 'xlsx';
  /** Spreadsheet sheets (empty for CSV), for a sheet chooser. */
  sheets: XlsxSheet[];
  /** Index of the sheet read. */
  sheet: number;
}

export type ImportResult = ImportedDoc[] | ImportedTableResult;

export function isTableResult(r: ImportResult): r is ImportedTableResult {
  return !Array.isArray(r);
}

interface Parsed {
  text: string;
  warnings: string[];
  /** May be read as a transcript (formats without timing of their own). */
  transcriptable: boolean;
  kind?: ImportedDoc['kind'];
  sync?: ImportedDoc['sync'];
  speakers?: ImportedDoc['speakers'];
}

// Older Teams exports in Word, and subtitles pasted into documents: "0:0:0.0 --> 0:0:3.410"
// lines followed by the speaker and the words. Read them as subtitles.
const CUE_TIMING = /^\s*\d{1,3}:\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?\s*-+>\s*\d{1,3}:\d{1,2}:\d{1,2}/gm;

function textTranscript(text: string, opts: ImportOptions, force: boolean) {
  const timings = text.match(CUE_TIMING)?.length ?? 0;
  if (timings >= 2) {
    const { cues } = parseSrt(text);
    if (cues.length >= 2) {
      return cuesToTranscript(cues, { ...(opts.speakers ? { speakers: opts.speakers } : {}), ...(opts.syncEveryCue !== undefined ? { syncEveryCue: opts.syncEveryCue } : {}) });
    }
  }
  return parseTextTranscript(text, { force, ...(opts.speakers ? { speakers: opts.speakers } : {}) });
}

function decoded(bytes: Uint8Array): { text: string; warnings: string[] } {
  const d = decodeTextWithInfo(bytes);
  return { text: d.text, warnings: d.encoding === 'windows-1252' ? [WARNING.legacyEncoding] : [] };
}

async function parse(format: ImportFormat, bytes: Uint8Array, opts: ImportOptions): Promise<Parsed> {
  switch (format) {
    case 'txt': {
      const d = decoded(bytes);
      return { text: tidyPlain(canonicalize(d.text)), warnings: d.warnings, transcriptable: true };
    }
    case 'md': {
      const d = decoded(bytes);
      return { text: markdownToText(d.text), warnings: d.warnings, transcriptable: true };
    }
    case 'html': {
      const d = decodeHtml(bytes);
      return { text: htmlToText(d.text), warnings: d.legacy ? [WARNING.legacyEncoding] : [], transcriptable: true };
    }
    case 'rtf': {
      const src = decodeRtfBytes(bytes);
      if (!isRtf(src)) throw new ImportError('DAMAGED', 'rtf', 'no RTF header');
      const r = rtfToText(src);
      return { text: r.text, warnings: r.warnings, transcriptable: true };
    }
    case 'odt': {
      const r = odtToText(bytes);
      return { text: r.text, warnings: r.warnings, transcriptable: true };
    }
    case 'docx': {
      const r = await docxToText(bytes, opts.mammoth);
      return { text: r.text, warnings: r.warnings, transcriptable: true };
    }
    case 'pdf': {
      if (!opts.pdfjs) throw new Error('importFile: PDF files need the pdfjs option');
      const r = await extractPdfText(bytes, opts.pdfjs, opts.password !== undefined ? { password: opts.password } : {});
      // A PDF's lines are rebuilt from positions, so its layout is only read as a transcript
      // when the researcher says it is one.
      return { text: r.text, warnings: r.warnings, transcriptable: opts.transcript === 'always', kind: 'pdf' };
    }
    case 'vtt':
    case 'srt': {
      const d = decoded(bytes);
      const { cues, warnings } = format === 'vtt' ? parseVtt(d.text) : parseSrt(d.text);
      const t = cuesToTranscript(cues, { ...(opts.speakers ? { speakers: opts.speakers } : {}), ...(opts.syncEveryCue !== undefined ? { syncEveryCue: opts.syncEveryCue } : {}) });
      return { text: t.text, warnings: [...d.warnings, ...warnings], transcriptable: false, kind: 'transcript', sync: t.sync, speakers: t.speakers };
    }
    case 'csv':
    case 'xlsx':
      throw new Error('tables are handled by importFile');
  }
}

/**
 * Imports one file. Documents come back as ImportedDoc[] (one document per file today);
 * CSV and XLSX come back as a table for the survey mapping step (see surveyToDocuments).
 */
export async function importFile(filename: string, bytes: Uint8Array, opts: ImportOptions = {}): Promise<ImportResult> {
  const sniffed = opts.format ? { format: opts.format, hint: null } : sniffFormat(filename, bytes);
  const format = sniffed.format;
  if (!format) throw new ImportError('UNSUPPORTED', sniffed.hint);
  if (bytes.length === 0) throw new ImportError('EMPTY');
  const name = baseName(filename);

  try {
    if (format === 'csv' || format === 'xlsx') {
      let result: ImportedTableResult;
      if (format === 'csv') {
        const d = decoded(bytes);
        const table = parseCsv(d.text, name, filename.toLowerCase().endsWith('.tsv') ? { delimiter: '\t' } : {});
        table.warnings = [...d.warnings, ...(table.warnings ?? [])];
        result = { table, format, sheets: [], sheet: 0 };
      } else {
        const x = readXlsx(bytes, name, opts.sheet !== undefined ? { sheet: opts.sheet } : {});
        result = { table: x.table, format, sheets: x.sheets, sheet: x.sheet };
      }
      result.table.source = { filename, format };
      if (!result.table.headers.length) throw new ImportError('EMPTY');
      return result;
    }

    const p = await parse(format, bytes, opts);
    let { text, kind = 'text', sync = [], speakers = [] } = p;
    const mode = opts.transcript ?? 'auto';
    if (p.transcriptable && mode !== 'never') {
      const t = textTranscript(text, opts, mode === 'always');
      if (t) {
        ({ text, sync, speakers } = t);
        kind = 'transcript';
      }
    }
    if (!text.trim() && kind !== 'pdf') throw new ImportError('EMPTY');
    if (text.length > LIMITS.textMax) throw new ImportError('TOO_LARGE', String(text.length));
    const keep = (opts.keepOriginal ?? true) && (format === 'pdf' || format === 'docx');
    const doc: ImportedDoc = {
      name,
      kind,
      text,
      sync,
      speakers,
      source: { filename, format },
      warnings: [...new Set(p.warnings)],
      ...(keep ? { original: { bytes: bytes.slice(), mime: mimeOf(format) } } : {}),
    };
    return [doc];
  } catch (e) {
    if (e instanceof ImportError) throw e;
    if (e instanceof Error && e.message.startsWith('importFile:')) throw e;
    throw new ImportError('DAMAGED', format, e instanceof Error ? e.message : String(e));
  }
}

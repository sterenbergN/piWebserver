import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { FileKind } from './formats';

// Layout choices for Office files turned into PDFs on the Pi. LibreOffice's PDF export
// takes a page range and, for slides, speaker notes pages; a spreadsheet's orientation,
// paper and scaling live in the workbook itself, so for .xlsx files those are written
// into each sheet's page setup before LibreOffice opens it.

export type OfficeOptions = {
  /** Pages to keep, like "1-3, 5" (empty is all). */
  pages?: string;
  /** Slides: add a page per slide with its speaker notes. */
  notes?: boolean;
  orientation?: 'keep' | 'portrait' | 'landscape';
  /** Spreadsheets: as the file says, all columns across one page width, everything on one page, or a set scale. */
  fit?: 'keep' | 'width' | 'page' | 'scale';
  /** Percent, when fit is 'scale'. */
  scale?: number;
  paper?: 'keep' | 'letter' | 'a4' | 'legal';
  gridlines?: boolean;
};

const PAPER_SIZE = { letter: 1, legal: 5, a4: 9 } as const;
const PAGE_RANGE = /^\s*\d+(\s*-\s*\d*)?(\s*,\s*\d+(\s*-\s*\d*)?)*\s*$/;

/** Only what's understood, within sensible bounds. */
export function cleanOfficeOptions(raw: unknown): OfficeOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: OfficeOptions = {};
  if (typeof r.pages === 'string' && r.pages.trim() && r.pages.length <= 80 && PAGE_RANGE.test(r.pages)) out.pages = r.pages.replace(/\s+/g, '');
  if (r.notes === true) out.notes = true;
  if (r.orientation === 'portrait' || r.orientation === 'landscape') out.orientation = r.orientation;
  if (r.fit === 'width' || r.fit === 'page') out.fit = r.fit;
  if (r.fit === 'scale' && typeof r.scale === 'number' && Number.isFinite(r.scale)) {
    out.fit = 'scale';
    out.scale = Math.round(Math.min(400, Math.max(10, r.scale)));
  }
  if (r.paper === 'letter' || r.paper === 'a4' || r.paper === 'legal') out.paper = r.paper;
  if (r.gridlines === true) out.gridlines = true;
  return out;
}

const FILTER_FOR: Partial<Record<FileKind, string>> = { doc: 'writer_pdf_Export', slides: 'impress_pdf_Export', sheet: 'calc_pdf_Export' };

/**
 * LibreOffice's --convert-to value for a PDF, with the export settings as JSON
 * (LibreOffice 7.4 and later): `pdf:impress_pdf_Export:{"ExportNotesPages":…}`.
 */
export function pdfFilter(kind: FileKind, options: OfficeOptions): string {
  const props: Record<string, { type: string; value: string }> = {};
  if (options.pages) props.PageRange = { type: 'string', value: options.pages };
  if (kind === 'slides' && options.notes) props.ExportNotesPages = { type: 'boolean', value: 'true' };
  const filter = FILTER_FOR[kind];
  if (!filter || !Object.keys(props).length) return 'pdf';
  return `pdf:${filter}:${JSON.stringify(props)}`;
}

/** Whether these choices change a spreadsheet's own page setup. */
export const changesSheetLayout = (o: OfficeOptions) => !!(o.orientation || o.fit || o.paper || o.gridlines);

// Children of <worksheet> that come after <printOptions> / <pageSetup>, in the order OOXML requires.
const AFTER_PRINT_OPTIONS = ['pageMargins', 'pageSetup', 'headerFooter', 'rowBreaks', 'colBreaks', 'customProperties', 'cellWatches', 'ignoredErrors', 'smartTags', 'drawing', 'legacyDrawing', 'legacyDrawingHF', 'drawingHF', 'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst'];
const AFTER_PAGE_SETUP = AFTER_PRINT_OPTIONS.slice(2);

/** Put `element` before the first of `later` that the sheet has, or at the end. */
function insertBefore(xml: string, element: string, later: string[]) {
  let at = -1;
  for (const name of later) {
    const m = xml.match(new RegExp(`<(?:\\w+:)?${name}[\\s/>]`));
    if (m && m.index !== undefined && (at < 0 || m.index < at)) at = m.index;
  }
  if (at < 0) at = xml.lastIndexOf('</');
  return xml.slice(0, at) + element + xml.slice(at);
}

/** Set (or add) attributes on the first <tag …> or <tag …/> found. */
function setAttrs(tag: string, attrs: Record<string, string | null>) {
  let out = tag;
  for (const [name, value] of Object.entries(attrs)) {
    const re = new RegExp(`\\s${name}="[^"]*"`);
    out = out.replace(re, '');
    if (value !== null) out = out.replace(/\s*(\/?>)$/, ` ${name}="${value}"$1`);
  }
  return out;
}

/** One worksheet's XML with the chosen orientation, paper, scaling and gridlines. */
export function patchSheetXml(xml: string, o: OfficeOptions): string {
  let out = xml;
  const fitToPage = o.fit === 'width' || o.fit === 'page' ? '1' : o.fit === 'scale' ? '0' : null;

  // <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr> switches between fitting and scaling.
  if (fitToPage !== null) {
    const pr = `<pageSetUpPr fitToPage="${fitToPage}"/>`;
    if (/<pageSetUpPr\b[^>]*\/>/.test(out)) out = out.replace(/<pageSetUpPr\b[^>]*\/>/, (t) => setAttrs(t, { fitToPage }));
    else if (/<sheetPr\b[^>]*\/>/.test(out)) out = out.replace(/<sheetPr\b([^>]*)\/>/, `<sheetPr$1>${pr}</sheetPr>`);
    else if (/<sheetPr\b[^>]*>/.test(out)) out = out.replace(/<\/sheetPr>/, `${pr}</sheetPr>`);
    else out = out.replace(/(<worksheet\b[^>]*>)/, `$1<sheetPr>${pr}</sheetPr>`);
  }

  const setup: Record<string, string | null> = {};
  if (o.orientation) setup.orientation = o.orientation;
  if (o.paper && o.paper !== 'keep') setup.paperSize = String(PAPER_SIZE[o.paper]);
  if (o.fit === 'width') Object.assign(setup, { fitToWidth: '1', fitToHeight: '0' });
  if (o.fit === 'page') Object.assign(setup, { fitToWidth: '1', fitToHeight: '1' });
  if (o.fit === 'scale') Object.assign(setup, { scale: String(o.scale ?? 100) });
  if (Object.keys(setup).length) {
    if (/<pageSetup\b[^>]*\/?>/.test(out)) out = out.replace(/<pageSetup\b[^>]*?\/?>/, (t) => setAttrs(t, setup));
    else out = insertBefore(out, setAttrs('<pageSetup/>', setup), AFTER_PAGE_SETUP);
  }

  if (o.gridlines) {
    if (/<printOptions\b[^>]*\/?>/.test(out)) out = out.replace(/<printOptions\b[^>]*?\/?>/, (t) => setAttrs(t, { gridLines: '1' }));
    else out = insertBefore(out, '<printOptions gridLines="1"/>', AFTER_PRINT_OPTIONS);
  }
  return out;
}

/** An .xlsx with every sheet's page setup changed; anything that isn't a readable .xlsx comes back as it was. */
export function patchXlsx(bytes: Uint8Array, o: OfficeOptions): Uint8Array {
  if (!changesSheetLayout(o)) return bytes;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    return bytes;
  }
  const sheets = Object.keys(files).filter((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  if (!sheets.length) return bytes;
  for (const name of sheets) files[name] = strToU8(patchSheetXml(strFromU8(files[name]), o));
  return zipSync(files, { level: 6 });
}

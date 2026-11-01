import type { Anchor } from '@/lib/reader/items';

// What the page-turning code needs from a book, whatever kind of file it came from.

export type TocEntry = { label: string; depth: number; section: number; fragment?: string; page?: number };

/** Text that flows to fit the screen: EPUB, plain text, Markdown, HTML. */
export type FlowSource = {
  toc: TocEntry[];
  /** `length` is roughly how many characters the section holds. */
  sections: { length: number; load: () => Promise<string> }[];
  /** Where a link inside section `from` goes, if it stays in the book. */
  resolve: (from: number, href: string) => { section: number; fragment?: string } | null;
  destroy: () => void;
};

/** Real pages: PDF and comics. */
export type FixedSource = {
  pageCount: number;
  toc: TocEntry[];
  /** Whether night mode should invert it: fine for a document, wrong for artwork. */
  invertable: boolean;
  size: (index: number) => Promise<{ width: number; height: number }>;
  /** Draw a page `pixelWidth` wide onto a canvas. */
  render: (index: number, canvas: HTMLCanvasElement, pixelWidth: number) => { promise: Promise<void>; cancel: () => void };
  destroy: () => void;
};

export type ReaderTheme = 'paper' | 'sepia' | 'night';
export type ReaderFont = 'book' | 'serif' | 'sans';
export type ReaderSettings = { theme: ReaderTheme; font: ReaderFont; fontSize: number; lineHeight: number };

export const THEME_COLORS: Record<ReaderTheme, { bg: string; fg: string; link: string }> = {
  paper: { bg: '#fbfaf6', fg: '#20222a', link: '#2c5e9e' },
  sepia: { bg: '#f3e8d2', fg: '#3b2f22', link: '#7c4a13' },
  night: { bg: '#14161c', fg: '#d9d6cd', link: '#8fb6d9' },
};

/** Where to draw a pen mark: its origin on screen, and how many pixels its units are. */
export type InkOrigin = { ox: number; oy: number; scale: number };

/** One open book on screen. Positions are in pixels from the top left of the stage. */
export interface Engine {
  readonly kind: 'flow' | 'fixed';
  readonly toc: TocEntry[];
  readonly totalPages: number;
  open(at: Anchor | null): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  goTo(anchor: Anchor): Promise<void>;
  goToToc(entry: TocEntry): Promise<void>;
  goToFraction(fraction: number): Promise<void>;
  /** Where you are now, which notes and reading progress are saved against. */
  here(): Anchor;
  fraction(): number;
  /** On the very last screen of the book. */
  atEnd(): boolean;
  /** Fit to a new screen size or new settings. */
  layout(settings: ReaderSettings): Promise<void>;
  onScreen(anchor: Anchor): boolean;
  project(anchor: Anchor): InkOrigin | null;
  /** What a pen mark starting at this point should hold on to. */
  anchorAt(x: number, y: number): { anchor: Anchor; origin: InkOrigin };
  /** A tap landed here. True if it followed a link. */
  tap(x: number, y: number): boolean;
  zoomed(): boolean;
  zoomBy(factor: number, cx: number, cy: number): void;
  panBy(dx: number, dy: number): void;
  /** A pinch or drag has ended, so it's time for the sharp version. */
  settle(): void;
  destroy(): void;
}

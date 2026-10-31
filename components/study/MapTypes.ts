import type { ClassEntry, CoverageMap, DeckRow, Match } from '@/lib/study/coverage';

/** What /api/study/map answers with. */
export type MapResponse = {
  coverage: CoverageMap;
  classes: ClassEntry[];
  courses: string[];
  anki: null | {
    importedAt: string;
    fileName: string;
    hasHistory: boolean;
    cards: number;
    reviewed: number;
    decks: DeckRow[];
    unmatched: { cards: number; tags: { tag: string; cards: number }[] };
    leeches: { deck: string; front: string; back: string; lapses: number }[];
    leechCount: number;
  };
};

export type { Match };

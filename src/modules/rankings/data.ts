import { CONTENT_URL } from "../../utils/paths";

/** One venue in a ranking list, as written by scripts/update_rankings.py. */
export interface RankingEntry {
  title: string;
  acronym: string;
  rank: string;
  type: "conference" | "journal";
  /** CORE only: the venue's page is https://portal.core.edu.au/conf-ranks/<coreId>/ */
  coreId?: number;
  /** CCF only: a key of `RankingIndex.ccfFields`. */
  field?: string;
  /** CCF only. */
  publisher?: string;
  /** CCF only: one or more DBLP URLs, separated by spaces. */
  dblp?: string;
  /**
   * Other names of the venue, matched like its title: names it had before
   * (from CCF's 2026 renames and CORE's "(was ...)" notes), and a few that
   * scripts/update_rankings.py adds, such as CORE's old name for AAAI.
   */
  formerTitles?: string[];
  formerAcronyms?: string[];
}

/** One choice in the edition drop-down. */
export interface EditionInfo {
  id: string;
  system: "CORE" | "CCF";
  label: string;
  year: number;
  types: Array<"conference" | "journal">;
  count: number;
  file: string;
}

export interface RankingIndex {
  /** When the script downloaded the lists, as YYYY-MM-DD. */
  retrieved: string;
  sources: Record<string, string>;
  ccfFields: Record<string, { en: string; zh: string }>;
  /** Newest first; the first is the default. */
  editions: EditionInfo[];
}

// The data ships in addon/content/data/rankings/. bootstrap.js registers
// addon/content/ under a chrome URL, which also works from the test plugin.
const DATA_URL = `${CONTENT_URL}data/rankings/`;

let indexPromise: Promise<RankingIndex> | undefined;

async function readJSON<T>(file: string): Promise<T> {
  return JSON.parse(await Zotero.File.getResourceAsync(DATA_URL + file)) as T;
}

/** Read index.json once; later calls reuse the result. */
export function loadIndex(): Promise<RankingIndex> {
  indexPromise ??= readJSON<RankingIndex>("index.json");
  return indexPromise;
}

/** Read one edition's entries. (item.ts keeps the one in use.) */
export async function loadEdition(id: string): Promise<RankingEntry[]> {
  const edition = (await loadIndex()).editions.find((e) => e.id === id);
  if (!edition) throw new Error(`Unknown ranking edition: ${id}`);
  return (await readJSON<{ entries: RankingEntry[] }>(edition.file)).entries;
}

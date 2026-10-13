import { loadIndex } from "./data";
import type { EditionInfo } from "./data";
import { loadCatalog, venueFromItem } from "./item";
import { matchVenue } from "./matcher";
import type { Match } from "./matcher";
import { getPref } from "../../utils/prefs";

export type RankSystem = EditionInfo["system"];

/** The rank of a "CORE: None (manual)" line, which says the venue has no rank. */
export const NO_RANK = "None";

/** Ranks offered in the Venue Rank menu, best first. */
export const MAIN_RANKS: Record<RankSystem, string[]> = {
  CORE: ["A*", "A", "B", "C"],
  CCF: ["A", "B", "C"],
};

const SYSTEMS = Object.keys(MAIN_RANKS) as RankSystem[];

/** A main rank's position in MAIN_RANKS (0 is best), or -1 for any other rank. */
export function rankTier(system: RankSystem, rank: string): number {
  return MAIN_RANKS[system].indexOf(rank);
}

// Each system's rank is one line of the item's Extra field, together with the
// venue it belongs to, so the two always come from the same match:
// "CORE: A* | NeurIPS" when detected, "CORE: B | FSE (manual)" once the rank
// or the venue has been set by hand. Detection never changes a manual line.
const MANUAL_MARK = " (manual)";
const LINE = /^(CORE|CCF): (.+?)(?: \| (.+?))?( \(manual\))?$/;

/** How a rank is written: "A*", or "National (USA)" for CORE's "National: USA". */
function rankText(rank: string): string {
  const [kind, ...detail] = rank.split(": ");
  return detail.length ? `${kind} (${detail.join(": ")})` : rank;
}

/** A venue name as it can stand in a line: "|" separates the parts. */
function venueText(venue: string): string {
  return venue.replace(/\s*\|\s*/g, "/").trim();
}

/** The Extra line for a rank: "CORE: A* | NeurIPS", "CORE: B | FSE (manual)". */
export function rankLine(
  system: RankSystem,
  rank: string,
  manual = false,
  venue?: string,
): string {
  const name = venue ? venueText(venue) : "";
  return `${system}: ${rankText(rank)}${name ? ` | ${name}` : ""}${manual ? MANUAL_MARK : ""}`;
}

export interface ItemRank {
  system: RankSystem;
  rank: string;
  /** The venue's acronym, or its name if it has none. */
  venue?: string;
  /** The rank or the venue was set by hand rather than detected. */
  manual: boolean;
}

/** Read a line written by `rankLine`. */
export function parseRankLine(line: string): ItemRank | null {
  const match = LINE.exec(line.trim());
  if (!match) return null;
  const parsed: ItemRank = {
    system: match[1] as RankSystem,
    rank: match[2],
    manual: !!match[4],
  };
  if (match[3]) parsed.venue = match[3];
  return parsed;
}

function lines(item: Zotero.Item): string[] {
  const extra = item.getField("extra");
  return extra ? extra.split(/\r?\n/) : [];
}

/** The item's rank in a system, with its venue, from its Extra field. */
export function itemRank(
  item: Zotero.Item,
  system: RankSystem,
): ItemRank | null {
  for (const line of lines(item)) {
    const parsed = parseRankLine(line);
    if (parsed?.system === system) return parsed;
  }
  return null;
}

/**
 * Replace the Extra line that `isOld` picks with `line`, in the same place,
 * or remove it with null; add `line` at the end if there was none. Doesn't save.
 */
function replaceLine(
  item: Zotero.Item,
  isOld: (line: string) => boolean,
  line: string | null,
) {
  const next: string[] = [];
  let placed = false;
  for (const l of lines(item)) {
    if (!isOld(l)) {
      next.push(l);
    } else if (!placed) {
      placed = true;
      if (line) next.push(line);
    }
  }
  if (line && !placed) next.push(line);
  item.setField("extra", next.join("\n").trim());
}

function writeRank(item: Zotero.Item, system: RankSystem, line: string | null) {
  replaceLine(item, (l) => parseRankLine(l)?.system === system, line);
}

/**
 * The line detection writes for a match. The venue goes by its acronym, or by
 * its title if it has none.
 */
export function detectedLine(system: RankSystem, match: Match): string {
  const { rank, acronym, title } = match.entry;
  return rankLine(system, rank, false, acronym || title);
}

/** The edition chosen in the settings, or the newest if that isn't one. */
export async function currentEdition(): Promise<EditionInfo> {
  const { editions } = await loadIndex();
  return editions.find((e) => e.id === getPref("edition")) ?? editions[0];
}

/**
 * How detection treats the rank line the item already has in a system:
 * "fill" keeps it. "redetect" redoes a detected line from the item's venue
 * fields (as when they change) but keeps a manual one. "reset" redoes both.
 * Rank and venue are always written, kept or replaced together.
 */
export type Mode = "fill" | "redetect" | "reset";

/** Whether detection leaves an existing line as it is (see `Mode`). */
function keeps(existing: ItemRank | null, mode: Mode): boolean {
  if (!existing) return false;
  if (mode === "fill") return existing.manual || !!existing.venue;
  return mode === "redetect" && existing.manual;
}

/** Apply a detected match to the item's Extra field, without saving. */
function applyMatch(
  item: Zotero.Item,
  system: RankSystem,
  existing: ItemRank | null,
  match: Match | null,
  mode: Mode,
) {
  const detected = match ? detectedLine(system, match) : null;
  if (existing && mode === "fill") {
    // A line from before venues were kept: add the venue, but only if the
    // match gives the same rank, so that the two belong together.
    if (match && rankText(match.entry.rank) === existing.rank) {
      writeRank(item, system, detected);
    }
    return;
  }
  if (detected || existing) writeRank(item, system, detected);
}

function editable(items: Zotero.Item[]): Zotero.Item[] {
  return items.filter(
    (item) =>
      item.isRegularItem() &&
      !item.deleted &&
      Zotero.Libraries.isEditable(item.libraryID),
  );
}

async function regularItemsOf(
  libraryID: number,
  dataTypes = ["itemData"],
): Promise<Zotero.Item[]> {
  const items = (await Zotero.Items.getAll(libraryID, true)).filter((item) =>
    item.isRegularItem(),
  );
  await Zotero.Items.loadDataTypes(items, dataTypes);
  return items;
}

// Items saved per database transaction.
const CHUNK = 100;

/**
 * Run `change` on items in batches, saving those it changed. Returns how many.
 * Each batch changes and saves its items in one transaction, so that nothing
 * else can change them in between.
 */
async function changeItems(
  items: Zotero.Item[],
  change: (item: Zotero.Item) => void,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  let changed = 0;
  for (let start = 0; start < items.length; start += CHUNK) {
    const chunk = items.slice(start, start + CHUNK);
    await Zotero.DB.executeTransaction(async () => {
      for (const item of chunk) {
        change(item);
        if (!item.hasChanged()) continue;
        // Ranking isn't an edit by the user, so keep Date Modified as it was.
        await item.save({ skipDateModifiedUpdate: true });
        changed++;
      }
    });
    onProgress?.(Math.min(start + CHUNK, items.length), items.length);
  }
  return changed;
}

/**
 * Detect the rank of items in the current edition and write it to their
 * Extra field (see `Mode`). Returns how many items changed.
 */
export async function rankItems(
  items: Zotero.Item[],
  mode: Mode,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const { id, system } = await currentEdition();
  const catalog = await loadCatalog(id);
  // Lines detection would keep need no transaction; this is most of what a
  // change notification brings back, such as the plugin's own saves.
  const todo = editable(items).filter(
    (item) => !keeps(itemRank(item, system), mode),
  );
  return changeItems(
    todo,
    (item) => {
      const existing = itemRank(item, system);
      if (keeps(existing, mode)) return;
      const venue = venueFromItem(item);
      const match = venue && matchVenue(catalog, venue);
      applyMatch(item, system, existing, match, mode);
    },
    onProgress,
  );
}

/** Rank every regular item in a library (see `Mode`). */
export async function rankLibrary(
  libraryID: number,
  mode: Mode,
  onProgress?: (done: number, total: number) => void,
): Promise<{ changed: number; total: number }> {
  const items = await regularItemsOf(libraryID);
  return {
    changed: await rankItems(items, mode, onProgress),
    total: items.length,
  };
}

/**
 * Set the rank of items by hand: a rank from MAIN_RANKS, or NO_RANK for none.
 * The venue on the line stays; the line becomes manual, so detection never
 * changes it.
 */
export async function setRank(items: Zotero.Item[], rank: string) {
  const { system } = await currentEdition();
  await changeItems(editable(items), (item) =>
    writeRank(
      item,
      system,
      rankLine(system, rank, true, itemRank(item, system)?.venue),
    ),
  );
}

/**
 * Set the venue acronym of items by hand. The rank on the line stays (no
 * rank, if there was none); the line becomes manual.
 */
export async function setVenue(items: Zotero.Item[], acronym: string) {
  const text = venueText(acronym);
  if (!text) return;
  const { system } = await currentEdition();
  await changeItems(editable(items), (item) =>
    writeRank(
      item,
      system,
      rankLine(system, itemRank(item, system)?.rank ?? NO_RANK, true, text),
    ),
  );
}

/**
 * Versions 0.4 and 0.5 kept the acronym on a line of its own, "Venue: NeurIPS"
 * or "Venue: FSE (manual)". Move it onto the rank lines that have no venue,
 * then remove it. Returns how many items changed.
 */
export async function mergeVenueLines(libraryID: number): Promise<number> {
  const VENUE_LINE = /^Venue: (.+?)( \(manual\))?$/;
  const { system } = await currentEdition();
  const items = (await regularItemsOf(libraryID)).filter((item) =>
    lines(item).some((l) => VENUE_LINE.test(l.trim())),
  );
  return changeItems(editable(items), (item) => {
    const old = lines(item)
      .map((l) => VENUE_LINE.exec(l.trim()))
      .find(Boolean)!;
    const [venue, manual] = [old[1], !!old[2]];
    replaceLine(item, (l) => VENUE_LINE.test(l.trim()), null);
    let merged = false;
    for (const sys of SYSTEMS) {
      const rank = itemRank(item, sys);
      if (!rank) continue;
      merged = true;
      if (rank.venue) continue;
      writeRank(
        item,
        sys,
        rankLine(sys, rank.rank, rank.manual || manual, venue),
      );
    }
    // An acronym typed by hand on an item without a rank: keep it.
    if (!merged && manual) {
      writeRank(item, system, rankLine(system, NO_RANK, true, venue));
    }
  });
}

/**
 * Version 0.1 kept ranks as tags such as "CORE: A*" (automatic tags when
 * detected, normal tags when set by hand) and colored them. Move them into
 * the Extra field, then remove the tags and their colors.
 * Returns how many items changed.
 */
export async function migrateRankTags(libraryID: number): Promise<number> {
  const isRankTag = (tag: string) => parseRankLine(tag) !== null;
  const items = (await regularItemsOf(libraryID, ["itemData", "tags"])).filter(
    (item) => item.getTags().some((t) => isRankTag(t.tag)),
  );
  const changed = await changeItems(editable(items), (item) => {
    const tags = item.getTags();
    for (const { tag, type } of tags) {
      const old = parseRankLine(tag);
      if (old && !itemRank(item, old.system)) {
        // Automatic tags (type 1) were detected; any other was set by hand.
        writeRank(item, old.system, rankLine(old.system, old.rank, type !== 1));
      }
    }
    item.setTags(
      tags.filter((t) => !isRankTag(t.tag)) as Array<{
        tag: string;
        type: number;
      }>,
    );
  });
  for (const name of [...Zotero.Tags.getColors(libraryID).keys()]) {
    if (isRankTag(name)) await Zotero.Tags.setColor(libraryID, name, "", 0);
  }
  return changed;
}

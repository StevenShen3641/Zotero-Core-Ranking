import { loadEdition } from "./data";
import { buildCatalog, VENUE_FIELDS } from "./matcher";
import type { Catalog, Venue, VenueKind } from "./matcher";

const KIND_BY_ITEM_TYPE: Record<string, VenueKind> = {
  conferencePaper: "conference",
  journalArticle: "journal",
};

/**
 * The venue fields of an item. Null for items that can't have a ranked venue:
 * notes, attachments, and preprints, which aren't published at a venue yet.
 */
export function venueFromItem(item: Zotero.Item): Venue | null {
  if (!item.isRegularItem() || item.itemType === "preprint") return null;
  const fields: Venue["fields"] = {};
  for (const field of VENUE_FIELDS) {
    // getField returns "" for fields the item type doesn't have.
    const value = item.getField(field).trim();
    if (value) fields[field] = value;
  }
  if (Object.keys(fields).length === 0) return null;
  return { kind: KIND_BY_ITEM_TYPE[item.itemType], fields };
}

// The catalog of the edition in use. Switching editions replaces it, so at
// most one edition's index is kept in memory.
let current: { editionId: string; catalog: Promise<Catalog> } | undefined;

/** One edition's catalog, built once and then reused while it is in use. */
export function loadCatalog(editionId: string): Promise<Catalog> {
  if (current?.editionId !== editionId) {
    const catalog = loadEdition(editionId).then(buildCatalog);
    // Don't keep a failed load around, so the next call tries again.
    catalog.catch(() => {
      if (current?.catalog === catalog) current = undefined;
    });
    current = { editionId, catalog };
  }
  return current.catalog;
}

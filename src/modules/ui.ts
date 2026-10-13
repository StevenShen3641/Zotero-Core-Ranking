import { config } from "../../package.json";
import { attempt, report } from "../utils/errors";
import { getLocaleID, getString } from "../utils/locale";
import { CONTENT_URL } from "../utils/paths";
import { getPref, setPref } from "../utils/prefs";
import { createPill } from "./pill";
import { updateVenuePanels } from "./venuePanel";
import { loadCatalog, venueFromItem } from "./rankings/item";
import { matchVenue, VENUE_FIELDS } from "./rankings/matcher";
import {
  currentEdition,
  detectedLine,
  itemRank,
  MAIN_RANKS,
  mergeVenueLines,
  migrateRankTags,
  NO_RANK,
  rankItems,
  rankLibrary,
  rankLine,
  rankTier,
  setRank,
} from "./rankings/ranks";
import type { Mode, RankSystem } from "./rankings/ranks";

const ICON = `${CONTENT_URL}icons/rank.svg`;

// The column draws synchronously, so it reads the system of the current
// edition from here. Kept up to date by `refreshSystem`.
let system: RankSystem = "CORE";

let notifierID: string | undefined;
let prefObserver: symbol | undefined;

async function refreshSystem() {
  system = (await currentEdition()).system;
  refreshViews();
}

// Open Venue Rank sections, by their body element: how to redraw each, and
// the item it shows. Zotero only redraws a plugin's section when another item
// is selected, so the plugin redraws it when the shown item changes.
const sections = new Map<
  HTMLElement,
  { refresh: () => Promise<void>; itemID?: number }
>();

/**
 * Redraw what shows ranks: after items changed, only what shows one of `ids`
 * (the items list redraws changed rows itself); without `ids`, as after the
 * edition changed, everything.
 */
export function refreshViews(ids?: Array<string | number>) {
  if (!ids) Zotero.ItemTreeManager.refreshColumns();
  updateVenuePanels(ids);
  for (const { refresh, itemID } of sections.values()) {
    if (!ids || (itemID !== undefined && ids.includes(itemID))) {
      report(refresh());
    }
  }
}

/** Libraries the user can change: My Library and editable groups. */
export function editableLibraries(): number[] {
  return Zotero.Libraries.getAll()
    .filter((l) => l.editable && l.libraryType !== "feed")
    .map((l) => l.libraryID);
}

/** Rank the items of some libraries, showing progress in a popup. */
export async function rankLibraries(libraryIDs: number[], mode: Mode) {
  const edition = await currentEdition();
  const popup = new ztoolkit.ProgressWindow(config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: getString("progress-ranking", { args: { edition: edition.label } }),
      type: "default",
      progress: 0,
    })
    .show();
  let changed = 0;
  let total = 0;
  for (const libraryID of libraryIDs) {
    const result = await rankLibrary(libraryID, mode, (done, all) =>
      popup.changeLine({ progress: Math.round((100 * done) / (all || 1)) }),
    );
    changed += result.changed;
    total += result.total;
  }
  popup.changeLine({
    text: getString("progress-done", {
      args: { changed, total, edition: edition.label },
    }),
    type: "success",
    progress: 100,
  });
  popup.startCloseTimer(4000);
}

function registerPrefsPane() {
  return Zotero.PreferencePanes.register({
    pluginID: config.addonID,
    src: rootURI + "content/preferences.xhtml",
    label: getString("prefs-title"),
    image: `${CONTENT_URL}icons/favicon.svg`,
  });
}

/** Sort order of a rank in the column: main ranks best first, then others, then "None". */
function sortKey(rank: string): number {
  const tier = rankTier(system, rank);
  if (tier >= 0) return tier;
  return rank === NO_RANK ? 9 : 5;
}

function registerColumn() {
  return Zotero.ItemTreeManager.registerColumns({
    pluginID: config.addonID,
    dataKey: "venueRank",
    label: getString("column-rank"),
    // The value sorts the column ("0\tA*" before "1\tA"); the cell draws the
    // rank as a pill, with the line as saved in Extra as its hover text.
    dataProvider: (item: Zotero.Item) => {
      if (!item.isRegularItem()) return "";
      const rank = itemRank(item, system);
      if (!rank) return "";
      const line = rankLine(system, rank.rank, rank.manual, rank.venue);
      return [sortKey(rank.rank), rank.rank, line].join("\t");
    },
    renderCell: (index, data, column, isFirstColumn, doc) => {
      const cell = doc.createElement("span");
      cell.className = `cell ${column.className}`;
      const [, rank, ...line] = data.split("\t");
      if (rank) {
        // On the cell, not the pill: the items list removes the title of any
        // cell text it doesn't see as cut off.
        cell.title = line.join("\t");
        cell.append(createPill(doc, system, rank));
      }
      return cell;
    },
  });
}

/** What the item pane says about an item's rank, one line per entry. */
async function describe(
  item: Zotero.Item,
): Promise<{ lines: string[]; summary: string }> {
  const edition = await currentEdition();
  const rank = itemRank(item, edition.system);
  const venue = venueFromItem(item);
  const match = venue && matchVenue(await loadCatalog(edition.id), venue);
  const shown = rank
    ? rankLine(edition.system, rank.rank, false, rank.venue)
    : "";
  const lines: string[] = [];
  if (rank) {
    lines.push(
      getString(rank.manual ? "section-rank-manual" : "section-rank-auto", {
        args: { rank: shown },
      }),
    );
  } else if (match) {
    lines.push(getString("section-unranked"));
  }
  if (!venue) {
    lines.push(getString("section-no-venue"));
  } else if (!match) {
    lines.push(
      getString("section-no-match", { args: { edition: edition.label } }),
    );
  } else {
    const { title, acronym } = match.entry;
    lines.push(
      acronym
        ? getString("section-venue-acronym", { args: { title, acronym } })
        : getString("section-venue", { args: { title } }),
    );
    lines.push(
      getString(
        match.by === "title" ? "section-by-title" : "section-by-acronym",
        { args: { field: Zotero.ItemFields.getLocalizedString(match.field) } },
      ),
    );
    const detected = detectedLine(edition.system, match);
    if (rank && shown !== detected) {
      lines.push(
        getString("section-would-be", {
          args: { edition: edition.label, rank: detected },
        }),
      );
    }
  }
  lines.push(getString("section-help"));
  return { lines, summary: shown };
}

function registerSection() {
  return Zotero.ItemPaneManager.registerSection({
    paneID: "venue-rank",
    pluginID: config.addonID,
    header: { l10nID: getLocaleID("section-header"), icon: ICON },
    sidenav: { l10nID: getLocaleID("section-sidenav"), icon: ICON },
    onInit: ({ body, refresh }) => {
      sections.set(body, { refresh });
    },
    onDestroy: ({ body }) => {
      sections.delete(body);
    },
    onItemChange: ({ body, item, setEnabled }) => {
      const section = sections.get(body);
      if (section) section.itemID = item?.id;
      setEnabled(!!item?.isRegularItem());
      return true;
    },
    onRender: () => {},
    onAsyncRender: async ({ body, item, setSectionSummary }) => {
      if (!item?.isRegularItem()) return;
      const { lines, summary } = await describe(item);
      const doc = body.ownerDocument;
      if (!doc) return;
      body.replaceChildren(
        ...lines.map((line) => {
          const div = doc.createElement("div");
          div.textContent = line;
          return div;
        }),
      );
      setSectionSummary(summary);
    },
  });
}

function registerItemMenu() {
  const setTo = MAIN_RANKS.CORE.map((rank) => ({
    menuType: "menuitem" as const,
    l10nID: getLocaleID("menu-set-rank"),
    onShowing: (
      _: Event,
      context: _ZoteroTypes.MenuManager.BaseMenuContext,
    ) => {
      context.setVisible(MAIN_RANKS[system].includes(rank));
      // The menu manager hands this string to data-l10n-args as it is.
      context.setL10nArgs(
        JSON.stringify({ rank: rankLine(system, rank) }) as unknown as object,
      );
    },
    onCommand: (
      _: Event,
      context: _ZoteroTypes.MenuManager.LibraryMenuContext,
    ) => report(setRank(context.items ?? [], rank)),
  }));
  return Zotero.MenuManager.registerMenu({
    menuID: `${config.addonRef}-item`,
    pluginID: config.addonID,
    target: "main/library/item",
    menus: [
      {
        menuType: "submenu",
        l10nID: getLocaleID("menu-rank"),
        icon: ICON,
        onShowing: (_, context) =>
          context.setVisible(
            (context.items ?? []).some((item) => item.isRegularItem()),
          ),
        menus: [
          ...setTo,
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-set-none"),
            onCommand: (_, context) =>
              report(setRank(context.items ?? [], NO_RANK)),
          },
          { menuType: "separator" },
          {
            menuType: "menuitem",
            l10nID: getLocaleID("menu-detect-again"),
            onCommand: (_, context) =>
              report(rankItems(context.items ?? [], "reset")),
          },
        ],
      },
    ],
  });
}

function registerToolsMenu() {
  return Zotero.MenuManager.registerMenu({
    menuID: `${config.addonRef}-tools`,
    pluginID: config.addonID,
    target: "main/menubar/tools",
    menus: [
      {
        menuType: "menuitem",
        l10nID: getLocaleID("menu-fill-library"),
        onCommand: () =>
          report(
            rankLibraries(
              [Zotero.getActiveZoteroPane().getSelectedLibraryID()],
              "fill",
            ),
          ),
      },
    ],
  });
}

/** Pass changes to items on to the hooks (see onNotify in hooks.ts). */
function registerNotifier() {
  return (notifierID = Zotero.Notifier.registerObserver(
    {
      notify: (
        event: string,
        type: string,
        ids: Array<string | number>,
        extraData: Record<string, any>,
      ) => {
        if (!addon?.data.alive) return;
        addon.hooks.onNotify(event, type, ids, extraData);
      },
    },
    ["item"],
  ));
}

/** Redraw everything when the edition changes. */
function registerEditionObserver() {
  return (prefObserver = Zotero.Prefs.registerObserver(
    `${config.prefsPrefix}.edition`,
    () => report(refreshSystem()),
    true,
  ));
}

// Changes to these make an item's venue different, so its rank is detected again.
const VENUE_CHANGES = new Set<string>([...VENUE_FIELDS, "itemType"]);

/**
 * Rank items that were added or changed. An item whose venue fields (or item
 * type) changed is detected again, apart from what was set by hand; any other
 * item only gets a rank if it has none. Saving the rank changes only Extra,
 * so it doesn't set this off again, and neither does it when it syncs.
 */
export async function onItemsChanged(
  event: string,
  ids: Array<string | number>,
  extraData: Record<string, any> = {},
) {
  if (!getPref("autoRank")) return;
  const items = await Zotero.Items.getAsync(ids as number[]);
  const venueChanged = (item: Zotero.Item) =>
    event === "modify" &&
    Object.keys(extraData[item.id]?.changed ?? {}).some((field) =>
      VENUE_CHANGES.has(field),
    );
  await rankItems(items.filter(venueChanged), "redetect");
  await rankItems(
    items.filter((item) => !venueChanged(item)),
    "fill",
  );
}

/** Run `task` once per installation; the pref `done` remembers it ran. */
async function once(
  done: "tagsMigrated" | "venueLinesMerged" | "libraryRanked",
  task: () => Promise<unknown>,
) {
  if (getPref(done)) return;
  await task();
  setPref(done, true);
}

async function eachLibrary(step: (libraryID: number) => Promise<unknown>) {
  for (const libraryID of editableLibraries()) await step(libraryID);
}

/**
 * Once per installation: bring ranks saved by earlier versions up to date,
 * then rank every item that has no rank yet, in all editable libraries.
 */
async function setUpOnce() {
  await once("tagsMigrated", () => eachLibrary(migrateRankTags));
  await once("venueLinesMerged", () => eachLibrary(mergeVenueLines));
  await once("libraryRanked", () => rankLibraries(editableLibraries(), "fill"));
}

/**
 * What the plugin registered with Zotero, and how the item pane describes an
 * item. Reachable as Zotero.CoreRanking.api, which the tests use.
 */
export interface PluginAPI {
  registered: Record<string, unknown>;
  describeItem: typeof describe;
}

/** Register one part with Zotero, which returns false when it refuses it. */
function register<T>(name: string, step: () => T | Promise<T>) {
  return attempt(`registering the ${name}`, async () => {
    const id = await step();
    if (!id) throw new Error("Zotero refused it");
    return id;
  });
}

export async function registerUI(): Promise<PluginAPI> {
  // Each part registers on its own, so that one failing leaves the rest working.
  await attempt("reading the edition", refreshSystem);
  const registered = {
    prefsPane: await register("settings pane", registerPrefsPane),
    column: await register("column", registerColumn),
    section: await register("item pane section", registerSection),
    itemMenu: await register("item menu", registerItemMenu),
    toolsMenu: await register("Tools menu", registerToolsMenu),
  };
  await register("notifier", registerNotifier);
  await register("edition observer", registerEditionObserver);
  report(setUpOnce());
  return { registered, describeItem: describe };
}

export function unregisterUI() {
  // The column, section, menus and settings pane are removed by Zotero.
  if (notifierID) Zotero.Notifier.unregisterObserver(notifierID);
  if (prefObserver) Zotero.Prefs.unregisterObserver(prefObserver);
  sections.clear();
}

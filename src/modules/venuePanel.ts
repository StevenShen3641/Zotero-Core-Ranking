import { config } from "../../package.json";
import { createPill } from "./pill";
import { currentEdition, itemRank, rankLine, setVenue } from "./rankings/ranks";
import { report } from "../utils/errors";
import { getString } from "../utils/locale";

// A strip at the bottom of the left pane, under the tag selector, showing the
// selected paper's venue acronym and rank. Zotero has no API for adding to the
// left pane, so this adds an element to the window itself.

export const PANEL_ID = `${config.addonRef}-venue-panel`;

// Zotero has no selection event for plugins either. The items list calls
// ZoteroPane.itemSelected() whenever the selection changes, so each window's
// copy is wrapped to also update the panel. The original is kept to undo it.
const wrapped = new WeakMap<
  Window,
  { original: () => unknown; wrapper: () => unknown }
>();

// Updates are asynchronous; only the latest one per window may draw.
const latest = new WeakMap<Window, number>();

export function addVenuePanel(win: _ZoteroTypes.MainWindow) {
  const doc = win.document;
  const pane = doc.getElementById("zotero-collections-pane");
  if (!pane || doc.getElementById(PANEL_ID)) return;
  const panel = doc.createElement("div");
  panel.id = PANEL_ID;
  Object.assign(panel.style, {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    minHeight: "28px",
    padding: "0 8px",
    borderTop: "var(--material-panedivider)",
    overflow: "hidden",
  });
  pane.append(panel);

  const zoteroPane = win.ZoteroPane;
  const original = zoteroPane.itemSelected;
  const wrapper = function (this: unknown, ...args: unknown[]) {
    const result = original.apply(this, args as []);
    showVenue(win);
    return result;
  };
  wrapped.set(win, { original, wrapper });
  zoteroPane.itemSelected = wrapper as typeof zoteroPane.itemSelected;
  showVenue(win);
}

export function removeVenuePanel(win: _ZoteroTypes.MainWindow) {
  win.document.getElementById(PANEL_ID)?.remove();
  const saved = wrapped.get(win);
  // Put the original back, unless something else has wrapped it since.
  if (saved && win.ZoteroPane.itemSelected === saved.wrapper) {
    win.ZoteroPane.itemSelected =
      saved.original as typeof win.ZoteroPane.itemSelected;
  }
  wrapped.delete(win);
}

// While an acronym is being edited, redrawing would throw the input away.
const editing = new WeakSet<Window>();

/** The selected item, if exactly one regular item is selected. */
function selectedItem(win: _ZoteroTypes.MainWindow): Zotero.Item | null {
  const items = win.ZoteroPane.getSelectedItems();
  return items.length === 1 && items[0].isRegularItem() ? items[0] : null;
}

/**
 * Show the selected paper's acronym and rank; nothing for other selections.
 * Once the panel is removed, this does nothing.
 */
async function updateVenuePanel(win: _ZoteroTypes.MainWindow) {
  const panel = win.document.getElementById(PANEL_ID);
  if (!panel || editing.has(win)) return;
  const update = (latest.get(win) ?? 0) + 1;
  latest.set(win, update);

  const item = selectedItem(win);
  const children: Node[] = [];
  if (item) {
    const edition = await currentEdition();
    // Only what is saved in Extra, like the Rank column: the acronym and the
    // rank of the same line.
    const rank = itemRank(item, edition.system);
    children.push(acronymLabel(win, item, rank?.venue));
    if (rank) {
      const pill = createPill(win.document, edition.system, rank.rank);
      pill.title = rankLine(rank.system, rank.rank, rank.manual, rank.venue);
      children.push(pill);
    }
  }
  if (latest.get(win) === update && !editing.has(win)) {
    panel.replaceChildren(...children);
  }
}

/** The acronym, or "Add acronym" when there is none. Click it to edit. */
function acronymLabel(
  win: _ZoteroTypes.MainWindow,
  item: Zotero.Item,
  acronym: string | undefined,
): HTMLElement {
  const label = win.document.createElement("span");
  label.className = `${config.addonRef}-acronym`;
  label.textContent = acronym ?? getString("panel-add-acronym");
  label.title = getString("panel-edit-hint");
  Object.assign(label.style, {
    fontWeight: acronym ? "600" : "normal",
    color: acronym ? "" : "var(--fill-secondary)",
    cursor: "text",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  });
  label.addEventListener("click", () =>
    editAcronym(win, item, label, acronym ?? ""),
  );
  return label;
}

/** Replace the label with a text box. Enter or leaving it saves; Esc cancels. */
function editAcronym(
  win: _ZoteroTypes.MainWindow,
  item: Zotero.Item,
  label: HTMLElement,
  current: string,
) {
  const input = win.document.createElement("input");
  input.className = `${config.addonRef}-acronym-input`;
  input.value = current;
  input.size = Math.max(current.length + 2, 10);
  Object.assign(input.style, { font: "inherit", fontWeight: "600" });
  editing.add(win);
  let finished = false;
  const finish = (save: boolean) => {
    if (finished) return;
    finished = true;
    editing.delete(win);
    const value = input.value.trim();
    if (save && value && value !== current) {
      // Saving changes the item, and the notifier then redraws the panel.
      report(setVenue([item], value));
    } else {
      showVenue(win);
    }
  };
  input.addEventListener("keydown", (event: KeyboardEvent) => {
    // Keep Zotero's own shortcuts from seeing what is typed here.
    event.stopPropagation();
    if (event.key === "Enter") finish(true);
    else if (event.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
  label.replaceWith(input);
  input.focus();
  input.select();
}

function showVenue(win: _ZoteroTypes.MainWindow) {
  report(updateVenuePanel(win));
}

/** Update the panels, or only those showing one of `ids`. */
export function updateVenuePanels(ids?: Array<string | number>) {
  for (const win of Zotero.getMainWindows()) {
    const shown = selectedItem(win)?.id;
    if (!ids || (shown !== undefined && ids.includes(shown))) showVenue(win);
  }
}

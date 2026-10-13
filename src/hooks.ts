import { registerPrefsScripts } from "./modules/preferenceScript";
import {
  onItemsChanged,
  refreshViews,
  registerUI,
  unregisterUI,
} from "./modules/ui";
import { addVenuePanel, removeVenuePanel } from "./modules/venuePanel";
import { attempt, report } from "./utils/errors";
import { initLocale } from "./utils/locale";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  addon.api = await registerUI();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Mark initialized as true to confirm plugin loading status
  // outside of the plugin (e.g. scaffold testing process)
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  // Menu labels and the item pane section header come from this file.
  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  addVenuePanel(win);
}

async function onMainWindowUnload(win: Window): Promise<void> {
  removeVenuePanel(win as _ZoteroTypes.MainWindow);
}

async function onShutdown(): Promise<void> {
  // Each step runs even if an earlier one fails, so that updating or removing
  // the plugin always leaves Zotero clean.
  await attempt("cleanup", unregisterUI);
  for (const win of Zotero.getMainWindows()) {
    await attempt("removing the venue panel", () => removeVenuePanel(win));
  }
  // Remove addon object
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: Record<string, any>,
) {
  if (type !== "item") return;
  if (event === "add" || event === "modify") {
    report(onItemsChanged(event, ids, extraData));
  }
  // A changed item may be the one whose rank the panel or the item pane shows.
  if (event === "modify") refreshViews(ids);
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  if (type === "load") {
    report(registerPrefsScripts(data.window));
  }
}

// Hooks only dispatch; the work is done in src/modules.
export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
};

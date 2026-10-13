import { config } from "../../package.json";
import { report } from "../utils/errors";
import { getString } from "../utils/locale";
import { setPref } from "../utils/prefs";
import { loadIndex } from "./rankings/data";
import { currentEdition } from "./rankings/ranks";
import { editableLibraries, rankLibraries } from "./ui";

/** Fill in and wire up the settings pane (addon/content/preferences.xhtml). */
export async function registerPrefsScripts(win: Window) {
  const doc = win.document;
  const element = <T extends Element>(name: string) =>
    doc.getElementById(`zotero-prefpane-${config.addonRef}-${name}`) as T;

  const index = await loadIndex();
  const menulist = element<XUL.MenuList>("edition");
  for (const edition of index.editions) {
    menulist.appendItem(edition.label, edition.id);
  }
  menulist.value = (await currentEdition()).id;
  menulist.addEventListener("command", () =>
    setPref("edition", menulist.value),
  );

  element("fill").addEventListener("command", () =>
    report(rankLibraries(editableLibraries(), "fill")),
  );
  element("redetect").addEventListener("command", () =>
    report(rankLibraries(editableLibraries(), "redetect")),
  );

  element("sources").textContent = getString("sources", {
    args: { date: index.retrieved },
  });
}

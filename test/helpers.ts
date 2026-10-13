import { assert } from "chai";
import { getPref, setPref } from "../src/utils/prefs";

type Prefs = _ZoteroTypes.Prefs["PluginPrefsMap"];

/** A CORE A* and CCF A conference, as Zotero imports its proceedings title. */
export const CVPR =
  "2023 IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR)";

/** A conference paper in My Library, saved. */
export async function conferencePaper(proceedingsTitle: string, extra = "") {
  const item = new Zotero.Item("conferencePaper");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", "A paper");
  item.setField("proceedingsTitle", proceedingsTitle);
  if (extra) item.setField("extra", extra);
  await item.saveTx();
  return item;
}

/**
 * Wait until `get()` returns `expected`, as the plugin works in the
 * background, then check it (so a timeout shows what it returned instead).
 */
export async function waitFor<T>(get: () => T, expected: T, timeout = 5000) {
  const until = Date.now() + timeout;
  while (get() !== expected && Date.now() < until) {
    await Zotero.Promise.delay(20);
  }
  assert.deepEqual(get(), expected);
}

/** Set some of the plugin's prefs; returns a function that puts them back. */
export function setPrefs(prefs: Partial<Prefs>): () => void {
  const saved = new Map<keyof Prefs, Prefs[keyof Prefs]>();
  for (const [key, value] of Object.entries(prefs) as Array<
    [keyof Prefs, Prefs[keyof Prefs]]
  >) {
    saved.set(key, getPref(key));
    setPref(key, value as never);
  }
  return () => {
    for (const [key, value] of saved) setPref(key, value as never);
  };
}

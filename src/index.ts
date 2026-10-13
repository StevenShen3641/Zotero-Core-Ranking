import Addon from "./addon";
import { config } from "../package.json";
import { createZToolkit } from "./utils/ztoolkit";

// One plugin instance, reachable from bootstrap.js as Zotero.CoreRanking.
// @ts-expect-error - Plugin instance is not typed
if (!Zotero[config.addonInstance]) {
  _globalThis.addon = new Addon();
  _globalThis.ztoolkit = createZToolkit();
  // @ts-expect-error - Plugin instance is not typed
  Zotero[config.addonInstance] = addon;
}

import {
  BasicTool,
  makeHelperTool,
  ProgressWindowHelper,
} from "zotero-plugin-toolkit";
import { CONTENT_URL } from "./paths";

export { createZToolkit };

/**
 * Only the parts of zotero-plugin-toolkit this plugin uses: getGlobal and the
 * progress popup. The full ZoteroToolkit also wraps Zotero.Item's getField,
 * setField and isFieldOfBase (wrappers that stay in place after the plugin
 * is updated or removed), adds a command palette to every window, and sets up
 * state shared with other plugins built on the toolkit.
 */
class Toolkit extends BasicTool {
  ProgressWindow = makeHelperTool(ProgressWindowHelper, this);
}

function createZToolkit() {
  const toolkit = new Toolkit();
  toolkit.ProgressWindow.setIconURI(
    "default",
    `${CONTENT_URL}icons/favicon.svg`,
  );
  return toolkit;
}

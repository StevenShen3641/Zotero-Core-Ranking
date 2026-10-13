import { config } from "../../package.json";

/** Where the plugin's addon/content folder is served from. */
export const CONTENT_URL = `chrome://${config.addonRef}/content/`;

import { config } from "../package.json";
import hooks from "./hooks";
import type { PluginAPI } from "./modules/ui";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    initialized: boolean;
  };
  // Lifecycle hooks
  public hooks: typeof hooks;
  // What the tests read from the running plugin
  public api: Partial<PluginAPI>;

  constructor() {
    this.data = { alive: true, config, initialized: false };
    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;

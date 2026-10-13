import { config } from "../../package.json";

/** Log what goes wrong in a background task, instead of losing it. */
export function report(task: Promise<unknown>) {
  task.catch((error) => Zotero.logError(error));
}

/**
 * Run one step of starting or stopping the plugin, logging rather than
 * stopping at an error, so that the other steps still run.
 * Returns the step's result, or undefined if it failed.
 */
export async function attempt<T>(
  name: string,
  step: () => T | Promise<T>,
): Promise<T | undefined> {
  try {
    return await step();
  } catch (error) {
    Zotero.logError(new Error(`${config.addonName}: ${name} failed: ${error}`));
    return undefined;
  }
}

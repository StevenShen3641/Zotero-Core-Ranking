import { config } from "../../package.json";
import type { FluentMessageId } from "../../typings/i10n";

let l10n: Localization | undefined;

/** Load the strings in addon/locale/<language>/addon.ftl. */
export function initLocale() {
  const Localization =
    typeof globalThis.Localization === "undefined"
      ? ztoolkit.getGlobal("Localization")
      : globalThis.Localization;
  l10n = new Localization([`${config.addonRef}-addon.ftl`], true);
}

/** A string from addon.ftl, or its ID if it is missing. */
export function getString(
  id: FluentMessageId,
  options: { args?: Record<string, string | number> } = {},
): string {
  const [message] =
    l10n?.formatMessagesSync([{ id: getLocaleID(id), args: options.args }]) ??
    [];
  return message?.value || getLocaleID(id);
}

/** The full ID of a string, as .ftl files and data-l10n-id use it. */
export function getLocaleID(id: FluentMessageId) {
  return `${config.addonRef}-${id}`;
}

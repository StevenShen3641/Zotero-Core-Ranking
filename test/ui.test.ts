import { assert } from "chai";
import { config } from "../package.json";
import type { PluginAPI } from "../src/modules/ui";
import { PANEL_ID } from "../src/modules/venuePanel";
import { rankItems, setRank } from "../src/modules/rankings/ranks";
import { getLocaleID } from "../src/utils/locale";
import { setPref } from "../src/utils/prefs";
import { conferencePaper, CVPR, setPrefs, waitFor } from "./helpers";

/** The running plugin, rather than the copy of its modules bundled into the tests. */
function plugin(): PluginAPI {
  // @ts-expect-error - Plugin instance is not typed
  return Zotero[config.addonInstance].api;
}

const cvprPaper = () => conferencePaper(CVPR);

/** Strings missing from the .ftl files show up as their prefixed id. */
function assertLocalized(lines: string[]) {
  for (const line of lines) {
    assert.notMatch(line, new RegExp(`^${config.addonRef}-`), "missing string");
  }
}

describe("the plugin in Zotero's window", function () {
  let restore: () => void;

  before(function () {
    restore = setPrefs({ autoRank: false, edition: "icore2026" });
  });

  after(function () {
    restore();
  });

  it("registered its settings pane, column, item pane section and menus", function () {
    const { registered } = plugin();
    assert.hasAllKeys(registered, [
      "prefsPane",
      "column",
      "section",
      "itemMenu",
      "toolsMenu",
    ]);
    for (const [name, result] of Object.entries(registered)) {
      assert.isOk(result, name);
    }
  });

  it("has labels for its menus and item pane section", async function () {
    const ids = [
      "menu-rank",
      "menu-set-rank",
      "menu-set-none",
      "menu-detect-again",
      "menu-fill-library",
      "section-header",
      "section-sidenav",
    ].map((id) => getLocaleID(id as Parameters<typeof getLocaleID>[0]));
    const l10n = Zotero.getMainWindow().document.l10n as unknown as {
      formatMessages(
        keys: Array<{ id: string; args?: object }>,
      ): Promise<Array<{ attributes?: Array<{ value: string }> } | null>>;
    };
    const messages = await l10n.formatMessages(
      ids.map((id) => ({ id, args: { rank: "CORE: A*" } })),
    );
    messages.forEach((message, i) => {
      assert.isNotEmpty(message?.attributes?.[0]?.value ?? "", ids[i]);
    });
  });

  it("shows the rank in the Rank column, sorting best first", async function () {
    const item = await cvprPaper();
    await rankItems([item], "fill");
    const column = plugin().registered.column as string;
    assert.equal(
      Zotero.ItemTreeManager.getCustomCellData(item, column),
      "0\tA*\tCORE: A* | CVPR",
    );
  });

  it("shows nothing for an item with no saved rank", async function () {
    const item = await cvprPaper();
    const column = plugin().registered.column as string;
    assert.equal(item.getField("extra"), "");
    assert.equal(Zotero.ItemTreeManager.getCustomCellData(item, column), "");
  });

  describe("the Rank column's pills", function () {
    /** Draw a cell the way the item list does. */
    function cell(data: string): HTMLElement {
      const [column] = Zotero.ItemTreeManager.getCustomColumns(undefined, {
        pluginID: config.addonID,
      }) as unknown as Array<{
        renderCell(
          index: number,
          data: string,
          column: { className: string },
          isFirstColumn: boolean,
          doc: Document,
        ): HTMLElement;
      }>;
      const doc = Zotero.getMainWindow().document;
      const cell = column.renderCell(
        0,
        data,
        { className: "rank" },
        false,
        doc,
      );
      return cell;
    }

    const pill = (data: string) => cell(data).firstElementChild as HTMLElement;

    /** Switch the edition and wait until the column has noticed. */
    async function useEdition(edition: string, prefix: string) {
      setPref("edition", edition);
      await waitFor(() => pill("0\tA").textContent!.startsWith(prefix), true);
    }

    after(async function () {
      await useEdition("icore2026", "CORE");
    });

    it("put the hover text on the cell, where the items list keeps it", async function () {
      await useEdition("icore2026", "CORE");
      // The items list removes the title of the element under the mouse
      // when its text isn't cut off, which here is the pill.
      const line = "CORE: A* | NeurIPS (manual)";
      assert.equal(cell(`0\tA*\t${line}`).title, line);
      assert.equal(pill(`0\tA*\t${line}`).title, "");
    });

    it("label CORE ranks with the word CORE, in their colors", async function () {
      await useEdition("icore2026", "CORE");
      const best = pill("0\tA*");
      assert.equal(best.textContent, "CORE A*");
      assert.equal(best.style.backgroundColor, "rgb(207, 0, 0)");
      assert.equal(pill("1\tA").style.backgroundColor, "rgb(215, 0, 175)");
      assert.equal(pill("2\tB").style.backgroundColor, "rgb(95, 47, 175)");
      assert.equal(pill("3\tC").style.backgroundColor, "rgb(0, 0, 0)");
      assert.equal(pill("5\tUnranked").textContent, "CORE Unranked");
    });

    it("label CCF ranks as CCF-A, colored by tier", async function () {
      await useEdition("ccf2026", "CCF");
      const best = pill("0\tA");
      assert.equal(best.textContent, "CCF-A");
      assert.equal(best.style.backgroundColor, "rgb(207, 0, 0)");
      assert.equal(pill("2\tC").textContent, "CCF-C");
    });
  });

  describe("the venue panel under the tag selector", function () {
    const panel = () =>
      Zotero.getMainWindow().document.getElementById(PANEL_ID)!;

    /** Wait until the panel shows `text` (the panel updates asynchronously). */
    const waitForPanel = (text: string) =>
      waitFor(() => panel().textContent, text);

    it("sits below the tag selector", function () {
      assert.equal(
        panel().previousElementSibling?.id,
        "zotero-tag-selector-container",
      );
    });

    it("shows the selected paper's acronym and rank", async function () {
      const item = await cvprPaper();
      await rankItems([item], "fill");
      await Zotero.getMainWindow().ZoteroPane.selectItem(item.id);
      await waitForPanel("CVPRCORE A*");
      const [acronym, pill] = [...panel().children] as HTMLElement[];
      assert.equal(acronym.textContent, "CVPR");
      assert.equal(pill.textContent, "CORE A*");
    });

    it("shows only what is saved, like the Rank column", async function () {
      const item = await cvprPaper();
      await Zotero.getMainWindow().ZoteroPane.selectItem(item.id);
      await waitForPanel("Add acronym");
    });

    it("follows a rank changed by hand", async function () {
      const item = await cvprPaper();
      await rankItems([item], "fill");
      await Zotero.getMainWindow().ZoteroPane.selectItem(item.id);
      await waitForPanel("CVPRCORE A*");
      await setRank([item], "C");
      await waitForPanel("CVPRCORE C");
    });

    it("lets you correct the acronym by clicking it", async function () {
      const item = await cvprPaper();
      await rankItems([item], "fill");
      await Zotero.getMainWindow().ZoteroPane.selectItem(item.id);
      await waitForPanel("CVPRCORE A*");
      (panel().firstElementChild as HTMLElement).click();
      const input = panel().querySelector("input")!;
      assert.equal(input.value, "CVPR");
      input.value = "CVPR 2023";
      input.dispatchEvent(
        new (Zotero.getMainWindow().KeyboardEvent)("keydown", { key: "Enter" }),
      );
      await waitForPanel("CVPR 2023CORE A*");
      assert.equal(item.getField("extra"), "CORE: A* | CVPR 2023 (manual)");
    });

    it("leaves the acronym alone when editing is cancelled", async function () {
      const item = await cvprPaper();
      await rankItems([item], "fill");
      await Zotero.getMainWindow().ZoteroPane.selectItem(item.id);
      await waitForPanel("CVPRCORE A*");
      (panel().firstElementChild as HTMLElement).click();
      const input = panel().querySelector("input")!;
      input.value = "Something else";
      input.dispatchEvent(
        new (Zotero.getMainWindow().KeyboardEvent)("keydown", {
          key: "Escape",
        }),
      );
      await waitForPanel("CVPRCORE A*");
      assert.equal(item.getField("extra"), "CORE: A* | CVPR");
    });

    it("is empty when several items are selected", async function () {
      const [a, b] = [await cvprPaper(), await cvprPaper()];
      await Zotero.getMainWindow().ZoteroPane.selectItems([a.id, b.id]);
      await waitForPanel("");
    });
  });

  it("explains a detected rank in the item pane", async function () {
    const item = await cvprPaper();
    await rankItems([item], "fill");
    const { lines, summary } = await plugin().describeItem(item);
    assert.equal(summary, "CORE: A* | CVPR");
    assert.isTrue(lines.some((l) => l.includes("CVPR")));
    assertLocalized(lines);
  });

  it("explains a rank the user set, and what detection would give", async function () {
    const item = await cvprPaper();
    await setRank([item], "C");
    const { lines, summary } = await plugin().describeItem(item);
    assert.equal(summary, "CORE: C");
    assert.isTrue(lines.some((l) => l.includes("CORE: A*")));
    assertLocalized(lines);
  });

  it("updates the item pane when the shown item's rank changes", async function () {
    const item = await cvprPaper();
    const win = Zotero.getMainWindow();
    await win.ZoteroPane.selectItem(item.id);
    const paneID = plugin().registered.section as string;
    // The pane ID contains backslashes ("\\@"), so match it rather than
    // putting it in a selector.
    const body = () =>
      [...win.document.querySelectorAll("item-pane-custom-section")]
        .find((e) => (e as HTMLElement).dataset.pane === paneID)
        ?.querySelector('[data-type="body"]') as HTMLElement | null;
    /** Wait until the section's text contains `text`. */
    const waitForSection = (text: string) =>
      waitFor(() => !!body()?.textContent?.includes(text), true);
    // Zotero draws a section once it is scrolled into view.
    const details = win.document.querySelector("item-details") as unknown as {
      scrollToPane(paneID: string, behavior: string): Promise<void>;
    };
    await details.scrollToPane(paneID, "instant");
    await waitForSection("Not ranked yet");
    await rankItems([item], "reset");
    await waitForSection("CORE: A* | CVPR");
    await setRank([item], "C");
    await waitForSection("CORE: C | CVPR");
  });

  it("explains why a preprint has no rank", async function () {
    const item = new Zotero.Item("preprint");
    item.setField("title", "A preprint");
    const { lines, summary } = await plugin().describeItem(item);
    assert.equal(summary, "");
    assert.isAbove(lines.length, 0);
    assertLocalized(lines);
  });
});

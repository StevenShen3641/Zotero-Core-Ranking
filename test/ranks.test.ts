import { assert } from "chai";
import {
  mergeVenueLines,
  migrateRankTags,
  NO_RANK,
  parseRankLine,
  rankItems,
  rankLine,
  setRank,
  setVenue,
} from "../src/modules/rankings/ranks";
import { setPref } from "../src/utils/prefs";
import { conferencePaper, CVPR, setPrefs, waitFor } from "./helpers";

const IJCNN = "2022 International Joint Conference on Neural Networks (IJCNN)"; // CORE B

async function setProceedingsTitle(
  item: Zotero.Item,
  proceedingsTitle: string,
) {
  item.setField("proceedingsTitle", proceedingsTitle);
  await item.saveTx();
}

const extra = (item: Zotero.Item) => item.getField("extra");
const tags = (item: Zotero.Item) => item.getTags().map((t) => t.tag);

describe("ranks", function () {
  describe("rank lines", function () {
    it("write a rank as a line of Extra and read it back", function () {
      assert.equal(rankLine("CORE", "A*"), "CORE: A*");
      assert.equal(rankLine("CORE", "National: USA"), "CORE: National (USA)");
      assert.equal(rankLine("CCF", "B", true), "CCF: B (manual)");
      assert.deepEqual(parseRankLine("CCF: B (manual)"), {
        system: "CCF",
        rank: "B",
        manual: true,
      });
    });

    it("keep the venue on the same line as the rank", function () {
      assert.equal(
        rankLine("CORE", "A*", false, "NeurIPS"),
        "CORE: A* | NeurIPS",
      );
      const line = rankLine("CORE", "National: USA", true, "ACSW");
      assert.equal(line, "CORE: National (USA) | ACSW (manual)");
      assert.deepEqual(parseRankLine(line), {
        system: "CORE",
        rank: "National (USA)",
        venue: "ACSW",
        manual: true,
      });
      assert.isNull(parseRankLine("original-date: 2020"));
    });
  });

  describe("ranking items", function () {
    let restore: () => void;

    before(function () {
      // Rank only when the tests ask, not when they create items.
      restore = setPrefs({ autoRank: false, edition: "icore2026" });
    });

    after(function () {
      restore();
    });

    afterEach(function () {
      setPref("edition", "icore2026");
    });

    it("writes the detected rank to the Extra field, not to the tags", async function () {
      const item = await conferencePaper(CVPR);
      assert.equal(await rankItems([item], "fill"), 1);
      assert.equal(extra(item), "CORE: A* | CVPR");
      assert.deepEqual(tags(item), []);
    });

    it("keeps the other lines of the Extra field", async function () {
      const item = await conferencePaper(
        CVPR,
        "original-date: 2020\nRead later",
      );
      await rankItems([item], "fill");
      assert.equal(
        extra(item),
        "original-date: 2020\nRead later\nCORE: A* | CVPR",
      );
    });

    it("keeps a filled rank when the venue changes later", async function () {
      const item = await conferencePaper(CVPR);
      await rankItems([item], "fill");
      await setProceedingsTitle(item, IJCNN);
      assert.equal(await rankItems([item], "fill"), 0);
      assert.equal(extra(item), "CORE: A* | CVPR");
    });

    it("re-detects detected ranks on request", async function () {
      const item = await conferencePaper(CVPR);
      await rankItems([item], "fill");
      await setProceedingsTitle(item, IJCNN);
      await rankItems([item], "redetect");
      assert.equal(extra(item), "CORE: B | IJCNN");
    });

    it("removes a detected rank that no longer matches when re-detecting", async function () {
      const item = await conferencePaper(CVPR);
      await rankItems([item], "fill");
      await setProceedingsTitle(item, "Proceedings of Nothing in Particular");
      await rankItems([item], "redetect");
      assert.equal(extra(item), "");
    });

    it("never re-detects a rank set by hand", async function () {
      const item = await conferencePaper(CVPR);
      await setRank([item], "B");
      assert.equal(extra(item), "CORE: B (manual)");
      await rankItems([item], "fill");
      await rankItems([item], "redetect");
      assert.equal(extra(item), "CORE: B (manual)");
    });

    it("replaces a detected rank with one set by hand", async function () {
      const item = await conferencePaper(CVPR);
      await rankItems([item], "fill");
      await setRank([item], "C");
      assert.equal(extra(item), "CORE: C | CVPR (manual)");
    });

    it("lets the user say the venue has no rank", async function () {
      const item = await conferencePaper(CVPR);
      await setRank([item], NO_RANK);
      await rankItems([item], "fill");
      assert.equal(extra(item), "CORE: None (manual)");
    });

    it("detects again from scratch with Detect Again", async function () {
      const item = await conferencePaper(CVPR);
      await setRank([item], "C");
      await rankItems([item], "reset");
      assert.equal(extra(item), "CORE: A* | CVPR");
    });

    it("adds the other system's rank after switching to a CCF edition", async function () {
      const item = await conferencePaper(CVPR);
      await rankItems([item], "fill");
      setPref("edition", "ccf2026");
      await rankItems([item], "fill");
      // Each system's line has the venue of its own match.
      assert.equal(extra(item), "CORE: A* | CVPR\nCCF: A | CVPR");
    });

    it("keeps an acronym typed by hand, with its rank, when re-detecting", async function () {
      const item = await conferencePaper(CVPR);
      await rankItems([item], "fill");
      await setVenue([item], "CVPR'23");
      assert.equal(extra(item), "CORE: A* | CVPR'23 (manual)");
      await setProceedingsTitle(item, IJCNN);
      await rankItems([item], "redetect");
      assert.equal(extra(item), "CORE: A* | CVPR'23 (manual)");
    });

    it("lets the user type an acronym for an item without a rank", async function () {
      const item = await conferencePaper(
        "Proceedings of Nothing in Particular",
      );
      await setVenue([item], "PNP");
      assert.equal(extra(item), "CORE: None | PNP (manual)");
    });

    it("adds the venue to a line saved without one, when the ranks agree", async function () {
      const agrees = await conferencePaper(CVPR, "CORE: A*");
      const differs = await conferencePaper(CVPR, "CORE: B");
      await rankItems([agrees, differs], "fill");
      assert.equal(extra(agrees), "CORE: A* | CVPR");
      assert.equal(extra(differs), "CORE: B");
    });

    it("doesn't add a detected acronym next to a rank set by hand", async function () {
      const item = await conferencePaper(CVPR);
      await setRank([item], "B");
      await rankItems([item], "fill");
      assert.equal(extra(item), "CORE: B (manual)");
    });

    it("leaves items without a ranked venue unranked", async function () {
      const preprint = new Zotero.Item("preprint");
      preprint.libraryID = Zotero.Libraries.userLibraryID;
      preprint.setField("title", "A preprint");
      preprint.setField("repository", "arXiv");
      await preprint.saveTx();
      const unknown = await conferencePaper(
        "Proceedings of Nothing in Particular",
      );
      assert.equal(await rankItems([preprint, unknown], "fill"), 0);
      assert.equal(extra(preprint), "");
      assert.equal(extra(unknown), "");
    });
  });

  describe("moving version 0.1's rank tags into Extra", function () {
    let restore: () => void;

    before(function () {
      restore = setPrefs({ autoRank: false });
    });

    after(function () {
      restore();
    });

    it("moves detected and hand-set rank tags, and removes them and their colors", async function () {
      const detected = await conferencePaper(CVPR);
      detected.addTag("CORE: A*", 1);
      detected.addTag("to read");
      await detected.saveTx();
      const manual = await conferencePaper(IJCNN);
      manual.addTag("CORE: A", 0);
      await manual.saveTx();
      const libraryID = detected.libraryID;
      await Zotero.Tags.setColor(libraryID, "CORE: A*", "#FF6666", 0);

      await migrateRankTags(libraryID);

      assert.equal(extra(detected), "CORE: A*");
      assert.deepEqual(tags(detected), ["to read"]);
      assert.equal(extra(manual), "CORE: A (manual)");
      assert.deepEqual(tags(manual), []);
      assert.isFalse(Zotero.Tags.getColor(libraryID, "CORE: A*"));
    });
  });

  describe("moving version 0.4's Venue lines onto the rank lines", function () {
    let restore: () => void;

    before(function () {
      restore = setPrefs({ autoRank: false, edition: "icore2026" });
    });

    after(function () {
      restore();
    });

    it("keeps each acronym with its rank, manual if either was", async function () {
      const detected = await conferencePaper(CVPR, "CORE: A*\nVenue: CVPR");
      const typed = await conferencePaper(CVPR, "CORE: A*\nVenue: X (manual)");
      const setRankByHand = await conferencePaper(
        CVPR,
        "Read later\nCORE: B (manual)\nVenue: FSE",
      );
      const onlyTyped = await conferencePaper("", "Venue: Y (manual)");
      await mergeVenueLines(detected.libraryID);
      assert.equal(extra(detected), "CORE: A* | CVPR");
      assert.equal(extra(typed), "CORE: A* | X (manual)");
      assert.equal(extra(setRankByHand), "Read later\nCORE: B | FSE (manual)");
      assert.equal(extra(onlyTyped), "CORE: None | Y (manual)");
    });
  });

  describe("ranking new and changed items automatically", function () {
    let restore: () => void;

    before(function () {
      restore = setPrefs({ autoRank: true, edition: "icore2026" });
    });

    after(function () {
      restore();
    });

    it("ranks an item once it is added", async function () {
      const item = await conferencePaper(CVPR);
      await waitFor(() => extra(item), "CORE: A* | CVPR");
    });

    it("ranks an item once a venue field makes it detectable", async function () {
      const item = await conferencePaper(
        "Proceedings of Nothing in Particular",
      );
      await Zotero.Promise.delay(300);
      assert.equal(extra(item), "");
      await setProceedingsTitle(item, CVPR);
      await waitFor(() => extra(item), "CORE: A* | CVPR");
    });

    /** Wait until the background ranking has written `expected`. */
    const waitForExtra = (item: Zotero.Item, expected: string) =>
      waitFor(() => extra(item), expected);

    it("re-detects rank and acronym together when a venue field changes", async function () {
      const item = await conferencePaper(CVPR);
      await waitForExtra(item, "CORE: A* | CVPR");
      await setProceedingsTitle(item, IJCNN);
      await waitForExtra(item, "CORE: B | IJCNN");
      await setProceedingsTitle(item, "Proceedings of Nothing in Particular");
      await waitForExtra(item, "");
    });

    it("keeps what was set by hand when a venue field changes", async function () {
      const item = await conferencePaper(CVPR);
      await waitForExtra(item, "CORE: A* | CVPR");
      await setRank([item], "C");
      await setProceedingsTitle(item, IJCNN);
      await Zotero.Promise.delay(500);
      assert.equal(extra(item), "CORE: C | CVPR (manual)");
    });

    it("doesn't re-detect when other fields change", async function () {
      // A detected line that doesn't match the venue, as from another edition.
      const item = await conferencePaper(CVPR, "CORE: B | CVPR");
      await Zotero.Promise.delay(300);
      item.setField("title", "A renamed paper");
      await item.saveTx();
      await Zotero.Promise.delay(500);
      assert.equal(extra(item), "CORE: B | CVPR");
    });
  });
});

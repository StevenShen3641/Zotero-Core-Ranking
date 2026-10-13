import { assert } from "chai";
import { loadEdition, loadIndex } from "../src/modules/rankings/data";

describe("ranking data", function () {
  it("lists the editions, newest (the default) first", async function () {
    const index = await loadIndex();
    assert.equal(index.editions[0].id, "icore2026");
    assert.includeMembers(
      index.editions.map((e) => e.id),
      ["icore2026", "core2023", "core2008", "ccf2026"],
    );
  });

  it("loads every edition with as many entries as the index says", async function () {
    const index = await loadIndex();
    for (const edition of index.editions) {
      const entries = await loadEdition(edition.id);
      assert.lengthOf(entries, edition.count, edition.id);
    }
  });

  it("has CORE conference ranks", async function () {
    const entries = await loadEdition("icore2026");
    assert.equal(entries.find((e) => e.acronym === "NeurIPS")?.rank, "A*");
    assert.isTrue(entries.every((e) => e.type === "conference"));
  });

  it("names AAAI by its current name, keeping CORE's old one", async function () {
    const aaai = (await loadEdition("icore2026")).find(
      (e) => e.acronym === "AAAI",
    );
    assert.equal(aaai?.title, "AAAI Conference on Artificial Intelligence");
    assert.include(
      aaai?.formerTitles ?? [],
      "National Conference of the American Association for Artificial Intelligence",
    );
  });

  it("has CCF conferences and journals, with Chinese text intact", async function () {
    const index = await loadIndex();
    const entries = await loadEdition("ccf2026");
    assert.equal(entries.find((e) => e.acronym === "TPAMI")?.type, "journal");
    assert.equal(
      entries.find((e) => e.acronym === "AAAI" && e.type === "conference")
        ?.rank,
      "A",
    );
    assert.equal(index.ccfFields.ai.zh, "人工智能");
  });

  it("rejects an edition that doesn't exist", async function () {
    let error: unknown;
    try {
      await loadEdition("core1999");
    } catch (e) {
      error = e;
    }
    assert.instanceOf(error, Error);
  });
});

import { assert } from "chai";
import { loadCatalog, venueFromItem } from "../src/modules/rankings/item";
import { matchVenue } from "../src/modules/rankings/matcher";
import type { Catalog, Venue } from "../src/modules/rankings/matcher";

const C = "conference" as const;
const J = "journal" as const;

// [what the item's fields say, expected acronym and rank, or null for no match]
type Case = [Venue, [string, string] | null];

// Venue fields as Zotero imports them from IEEE Xplore, the ACM DL, Springer,
// the ACL Anthology, DBLP and Google Scholar.
const CORE_CASES: Case[] = [
  [
    {
      kind: C,
      fields: {
        proceedingsTitle:
          "2023 IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR)",
      },
    },
    ["CVPR", "A*"],
  ],
  [
    {
      kind: C,
      fields: {
        proceedingsTitle:
          "2023 IEEE/CVF International Conference on Computer Vision Workshops (ICCVW)",
      },
    },
    null,
  ],
  [
    {
      kind: C,
      fields: {
        proceedingsTitle: "Advances in Neural Information Processing Systems",
      },
    },
    ["NeurIPS", "A*"],
  ],
  [
    // Saved as a journal article, but it is the conference's proceedings.
    {
      kind: J,
      fields: {
        publicationTitle: "Advances in Neural Information Processing Systems",
      },
    },
    ["NeurIPS", "A*"],
  ],
  [{ kind: C, fields: { conferenceName: "NeurIPS 2023" } }, ["NeurIPS", "A*"]],
  [
    // CORE still lists AAAI under its old name; the data adds this one.
    {
      kind: C,
      fields: {
        proceedingsTitle:
          "Proceedings of the AAAI Conference on Artificial Intelligence",
      },
    },
    ["AAAI", "A*"],
  ],
  [
    // CORE lists WWW as "International World Wide Web Conference".
    {
      kind: C,
      fields: {
        proceedingsTitle: "Proceedings of the ACM Web Conference 2023",
      },
    },
    ["WWW", "A*"],
  ],
  [
    // The journal that publishes VLDB's papers.
    {
      kind: J,
      fields: { publicationTitle: "Proceedings of the VLDB Endowment" },
    },
    ["VLDB", "A*"],
  ],
  [
    // CORE's note "(was NIPS)".
    { kind: C, fields: { conferenceName: "NIPS 2017" } },
    ["NeurIPS", "A*"],
  ],
  [
    // Here AAAI is only the organiser.
    {
      kind: C,
      fields: {
        proceedingsTitle:
          "Proceedings of the AAAI Conference on Human Computation and Crowdsourcing",
      },
    },
    ["HCOMP", "B"],
  ],
  [
    {
      kind: C,
      fields: {
        proceedingsTitle:
          "Proceedings of the 61st Annual Meeting of the Association for Computational Linguistics (Volume 1: Long Papers)",
      },
    },
    ["ACL", "A*"],
  ],
  [
    {
      kind: C,
      fields: {
        proceedingsTitle:
          "Findings of the Association for Computational Linguistics: EMNLP 2023",
      },
    },
    null,
  ],
  [
    {
      kind: C,
      fields: {
        proceedingsTitle:
          "Proceedings of the 2024 Conference of the North American Chapter of the Association for Computational Linguistics: Human Language Technologies (Volume 1: Long Papers)",
      },
    },
    ["NAACL", "A"],
  ],
  [
    {
      kind: C,
      fields: {
        proceedingsTitle:
          "Extended Abstracts of the 2023 CHI Conference on Human Factors in Computing Systems",
      },
    },
    null,
  ],
  [
    // A Springer book section: "International Conference on Computer Vision"
    // is contained in the title, but the acronym says ECCV.
    { fields: { bookTitle: "Computer Vision – ECCV 2022" } },
    ["ECCV", "A*"],
  ],
  [
    // COMAD's CORE title is "International Conference on Management of Data".
    {
      kind: C,
      fields: {
        proceedingsTitle:
          "Proceedings of the 2022 International Conference on Management of Data",
        conferenceName:
          "SIGMOD/PODS '22: International Conference on Management of Data",
      },
    },
    ["SIGMOD", "A*"],
  ],
  [
    {
      kind: C,
      fields: {
        proceedingsTitle:
          "Proceedings of the 2021 USENIX Annual Technical Conference",
        conferenceName: "USENIX ATC '21",
      },
    },
    ["USENIX", "A"],
  ],
  [
    // CORE still calls the Winter Conference a Workshop.
    {
      kind: C,
      fields: {
        proceedingsTitle:
          "2023 IEEE/CVF Winter Conference on Applications of Computer Vision (WACV)",
      },
    },
    ["WACV", "A"],
  ],
  [
    { kind: C, fields: { proceedingsTitle: "Interspeech 2023" } },
    ["Interspeech", "A"],
  ],
  [
    {
      kind: J,
      fields: {
        publicationTitle:
          "IEEE Transactions on Pattern Analysis and Machine Intelligence",
      },
    },
    null,
  ],
  [
    // Not "International Conference on Artificial Intelligence".
    { kind: J, fields: { publicationTitle: "Artificial Intelligence" } },
    null,
  ],
  [
    {
      kind: J,
      fields: { publicationTitle: "arXiv preprint arXiv:2303.08774" },
    },
    null,
  ],
  [
    // A track of NeurIPS, published in its proceedings.
    {
      kind: C,
      fields: {
        proceedingsTitle:
          "The Thirty-ninth Annual Conference on Neural Information Processing Systems Datasets and Benchmarks Track",
      },
    },
    ["NeurIPS", "A*"],
  ],
  [
    // Saved as a journal article, but its Publication names a conference.
    {
      kind: J,
      fields: {
        publicationTitle:
          "The Thirty-ninth Annual Conference on Neural Information Processing Systems Datasets and Benchmarks Track",
      },
    },
    ["NeurIPS", "A*"],
  ],
  [
    // ESEC/FSE, a joint event that CORE lists as FSE.
    {
      kind: C,
      fields: {
        proceedingsTitle:
          "Proceedings of the 30th ACM Joint European Software Engineering Conference and Symposium on the Foundations of Software Engineering",
      },
    },
    ["FSE", "A*"],
  ],
  [
    {
      kind: C,
      fields: {
        proceedingsTitle:
          "Proceedings of the 2017 11th Joint Meeting on Foundations of Software Engineering",
      },
    },
    ["FSE", "A*"],
  ],
  [
    // Not ICSE: here "Advances" is part of the name.
    {
      kind: C,
      fields: {
        proceedingsTitle:
          "International Conference on Software Engineering Advances",
      },
    },
    ["ICSEA", "C"],
  ],
];

const CCF_CASES: Case[] = [
  [
    {
      kind: C,
      fields: {
        proceedingsTitle:
          "Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition",
      },
    },
    ["CVPR", "A"],
  ],
  [
    {
      kind: C,
      fields: {
        proceedingsTitle:
          "Proceedings of the AAAI Conference on Artificial Intelligence",
      },
    },
    ["AAAI", "A"],
  ],
  [
    {
      kind: C,
      fields: {
        proceedingsTitle:
          "Proceedings of the Thirty-Second International Joint Conference on Artificial Intelligence",
      },
    },
    ["IJCAI", "B"],
  ],
  [
    {
      kind: J,
      fields: {
        publicationTitle:
          "IEEE Transactions on Pattern Analysis and Machine Intelligence",
        journalAbbreviation: "IEEE Trans. Pattern Anal. Mach. Intell.",
      },
    },
    ["TPAMI", "A"],
  ],
  [
    // The journal WWW, not the conference WWW.
    { kind: J, fields: { publicationTitle: "World Wide Web" } },
    ["WWW", "B"],
  ],
  [
    {
      kind: C,
      fields: {
        proceedingsTitle: "Proceedings of the ACM Web Conference 2023",
      },
    },
    ["WWW", "A"],
  ],
  [
    // Renamed in 2026; found through its former acronym.
    {
      kind: C,
      fields: {
        proceedingsTitle:
          "Proceedings of the 2021 USENIX Annual Technical Conference",
        conferenceName: "USENIX ATC '21",
      },
    },
    ["ACM SIGOPS ATC", "A"],
  ],
  [
    // Run by SIGGRAPH, but not the SIGGRAPH conference.
    {
      kind: C,
      fields: {
        proceedingsTitle:
          "Proceedings of the 2023 ACM SIGGRAPH Symposium on Interactive 3D Graphics and Games",
      },
    },
    ["I3D", "B"],
  ],
  [
    {
      kind: C,
      fields: {
        proceedingsTitle:
          "Proceedings of the 2023 Conference on Empirical Methods in Natural Language Processing: System Demonstrations",
      },
    },
    null,
  ],
  [
    {
      kind: C,
      fields: {
        proceedingsTitle:
          "Companion Proceedings of the ACM Web Conference 2023",
      },
    },
    null,
  ],
  [
    { kind: J, fields: { publicationTitle: "Journal of the ACM" } },
    ["JACM", "A"],
  ],
  [{ kind: J, fields: { publicationTitle: "IEEE Access" } }, null],
  [
    {
      kind: C,
      fields: {
        proceedingsTitle:
          "The Thirty-ninth Annual Conference on Neural Information Processing Systems Datasets and Benchmarks Track",
      },
    },
    ["NeurIPS", "A"],
  ],
  [
    {
      kind: C,
      fields: {
        proceedingsTitle:
          "Proceedings of the 30th ACM Joint European Software Engineering Conference and Symposium on the Foundations of Software Engineering",
      },
    },
    ["FSE", "A"],
  ],
];

function describeCases(editionId: string, cases: Case[]) {
  const tests = cases.map(([venue, expected]) => ({
    venue,
    expected,
    name: `${expected ? expected.join(" ") : "no match"} for "${Object.values(venue.fields)[0]}"`,
  }));

  describe(`matching venues in ${editionId}`, function () {
    let catalog: Catalog;

    before(async function () {
      catalog = await loadCatalog(editionId);
    });

    for (const test of tests) {
      const { venue, expected, name } = test;

      it(name, function () {
        const match = matchVenue(catalog, venue);
        if (expected) {
          assert.deepEqual(
            match && [match.entry.acronym, match.entry.rank],
            expected,
          );
        } else {
          assert.isNull(match);
        }
      });
    }

    it("stays fast on a huge field, as a synced item could have", function () {
      const started = Date.now();
      matchVenue(catalog, {
        kind: "conference",
        fields: { conferenceName: "(ICML ".repeat(40000) },
      });
      assert.isBelow(Date.now() - started, 500);
    });
  });
}

describeCases("icore2026", CORE_CASES);
describeCases("ccf2026", CCF_CASES);

describe("reading the venue of an item", function () {
  it("reads Proceedings Title and Conference Name of a conference paper", function () {
    const item = new Zotero.Item("conferencePaper");
    item.setField(
      "proceedingsTitle",
      "Proceedings of the 40th International Conference on Machine Learning",
    );
    item.setField("conferenceName", "ICML 2023");
    assert.deepEqual(venueFromItem(item), {
      kind: "conference",
      fields: {
        proceedingsTitle:
          "Proceedings of the 40th International Conference on Machine Learning",
        conferenceName: "ICML 2023",
      },
    });
  });

  it("reads Publication and Journal Abbr of a journal article", function () {
    const item = new Zotero.Item("journalArticle");
    item.setField("publicationTitle", "Journal of Machine Learning Research");
    item.setField("journalAbbreviation", "JMLR");
    assert.deepEqual(venueFromItem(item), {
      kind: "journal",
      fields: {
        publicationTitle: "Journal of Machine Learning Research",
        journalAbbreviation: "JMLR",
      },
    });
  });

  it("reads Book Title of a book section, without assuming a kind", function () {
    const item = new Zotero.Item("bookSection");
    item.setField("bookTitle", "Computer Vision – ECCV 2022");
    assert.deepEqual(venueFromItem(item), {
      kind: undefined,
      fields: { bookTitle: "Computer Vision – ECCV 2022" },
    });
  });

  it("gives no venue for a preprint", function () {
    const item = new Zotero.Item("preprint");
    item.setField("repository", "arXiv");
    assert.isNull(venueFromItem(item));
  });

  it("gives no venue when the venue fields are empty", function () {
    assert.isNull(venueFromItem(new Zotero.Item("conferencePaper")));
  });
});

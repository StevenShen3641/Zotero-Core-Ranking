import type { RankingEntry } from "./data";

/**
 * The Zotero fields that can name a venue, in the order they are tried.
 * Info pane labels: Proceedings Title, Conference Name, Publication,
 * Book Title, Journal Abbr.
 */
export const VENUE_FIELDS = [
  "proceedingsTitle",
  "conferenceName",
  "publicationTitle",
  "bookTitle",
  "journalAbbreviation",
] as const;

export type VenueField = (typeof VENUE_FIELDS)[number];
export type VenueKind = RankingEntry["type"];

/** What the matcher knows about one item. */
export interface Venue {
  /** Set when the item type says whether this is a conference paper or a journal article. */
  kind?: VenueKind;
  fields: Partial<Record<VenueField, string>>;
}

export interface Match {
  entry: RankingEntry;
  /** "title": a field matched the venue's full name. "acronym": only its acronym matched. */
  by: "title" | "acronym";
  /** The field that matched. */
  field: VenueField;
}

// Words that never identify a venue: function words, spelled-out ordinals
// ("Proceedings of the Thirty-Second International Joint Conference") and
// parts of a proceedings ("Volume 2", "Part III", "Research Track").
const NOISE = new Set(
  (
    "a an and at by for from in of on the to with proceeding proc " +
    "first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth " +
    "thirteenth fourteenth fifteenth sixteenth seventeenth eighteenth nineteenth twentieth " +
    "thirtieth fortieth fiftieth twenty thirty forty fifty sixty seventy eighty ninety " +
    "volume vol part track paper long short full main research industry " +
    "i ii iii iv v vi vii viii ix x"
  ).split(" "),
);

// Also ignored when comparing names of the same kind of venue. They still
// count when a journal article is compared with a conference, so the journal
// "Artificial Intelligence" doesn't match "International Conference on
// Artificial Intelligence".
const FILLER = new Set([
  ...NOISE,
  ..."conference conf international intl annual edition".split(" "),
]);

// Organisers often appear on one side only ("IEEE/CVF Conference on ..." against
// "Conference on ..."), so a name can match without them.
const ORGANIZERS = new Set(["acm", "cvf", "ieee", "ifip", "siam", "usenix"]);

// Words that mark a side event. A paper in "ICCV Workshops" or "Findings of ACL"
// is not a paper of the main conference, so it only matches a venue whose own
// name has the same word. (Words are compared after `stem`.)
const SATELLITE = new Set([
  "abstract",
  "adjunct",
  "companion",
  "consortium",
  "demo",
  "demonstration",
  "doctoral",
  "finding",
  "poster",
  "tutorial",
  "workshop",
]);

// A regional venue is not the international one with the same subject:
// "Chinese Conference on Pattern Recognition and Computer Vision" is not CVPR.
// Adjectives are mapped to the place, so "Asian" and "Asia" compare equal.
const REGION_FORMS: Record<string, string> = {
  african: "africa",
  american: "america",
  asian: "asia",
  australasian: "australasia",
  chinese: "china",
  european: "europe",
  indian: "india",
  japanese: "japan",
  korean: "korea",
};
const REGIONS = new Set([
  ...Object.values(REGION_FORMS),
  ..."arab australian baltic brazilian british canadian french german iberian italian latin mediterranean mexican nordic pacific polish russian scandinavian spanish turkish".split(
    " ",
  ),
]);

// Kinds of event or publication. A field and a venue that both name one must
// agree: "ACM SIGGRAPH Symposium on Interactive 3D Graphics" is not the
// SIGGRAPH conference.
const VENUE_TYPES = new Set([
  "colloquium",
  "conference",
  "congres",
  "forum",
  "journal",
  "letter",
  "magazine",
  "meeting",
  "summit",
  "symposium",
  "transaction",
  "workshop",
]);

// Kinds of venue that count as the same kind: a "Joint Meeting" or a
// "Congress" is a conference.
const SAME_TYPE: Record<string, string> = {
  congres: "conference",
  meeting: "conference",
};

// Organisers as acronyms. Catalog acronyms such as "ACM MM" and "USENIX ATC"
// are also found without them, and on their own they don't name a venue
// ("USENIX" is CORE's acronym for ATC, but papers write it for every USENIX venue).
const ACRONYM_PREFIXES = new Set([...ORGANIZERS].map((w) => w.toUpperCase()));

interface Name {
  /** Words that identify the venue, organisers included. */
  all: Set<string>;
  /** `all` without organisers. */
  required: Set<string>;
  key: string;
  requiredKey: string;
  /** All words except `NOISE`, for comparing a journal article with a conference. */
  strictKey: string;
  regions: Set<string>;
  types: Set<string>;
  /** Words naming a track: "Datasets and Benchmarks" in "... Datasets and Benchmarks Track". */
  trackWords: Set<string>;
}

interface CatalogName {
  entry: number;
  name: Name;
}

/** One edition's entries, indexed for matching. Build it once per edition. */
export interface Catalog {
  entries: RankingEntry[];
  /** By entry: the name of its current title, and all of that title's words. */
  titles: Name[];
  titleWords: Set<string>[];
  names: CatalogName[];
  byKey: Map<string, number[]>;
  byWord: Map<string, number[]>;
  byAcronym: Map<string, number[]>;
  cache: Map<string, Match | null>;
}

function stem(word: string): string {
  // "Systems" and "System" should compare equal; "access" keeps its s.
  return word.length > 3 && word.endsWith("s") && !word.endsWith("ss")
    ? word.slice(0, -1)
    : word;
}

/** Lower-case words of a venue name, without parenthetical notes and numbers. */
function words(text: string): string[] {
  return (
    text
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ") // "(CVPR)", "(Volume 1: Long Papers)", "(was NIPS)"
      .replace(/&/g, " and ")
      .split(/[^a-z0-9]+/)
      .filter((w) => w && !/^\d+(st|nd|rd|th)?$/.test(w))
      .map((w) => REGION_FORMS[w] ?? stem(w))
      // "Advances in Neural Information Processing Systems" is NeurIPS, but the
      // "Advances" of "Software Engineering Advances" is part of the name.
      .filter((w, i, list) => !(w === "advance" && list[i + 1] === "in"))
  );
}

function toName(text: string): Name {
  const list = words(text);
  const all = new Set(list.filter((w) => !FILLER.has(w)));
  const required = new Set([...all].filter((w) => !ORGANIZERS.has(w)));
  const trackWords = new Set<string>();
  list.forEach((word, i) => {
    if (word !== "track") return;
    // Up to four words before "Track" name it.
    const before = list.slice(0, i).filter((w) => !NOISE.has(w));
    for (const w of before.slice(-4)) trackWords.add(w);
  });
  return {
    trackWords,
    all,
    required,
    key: [...all].sort().join(" "),
    requiredKey: [...required].sort().join(" "),
    strictKey: [...new Set(list.filter((w) => !NOISE.has(w)))].sort().join(" "),
    regions: new Set(list.filter((w) => REGIONS.has(w))),
    types: new Set(
      list.filter((w) => VENUE_TYPES.has(w)).map((w) => SAME_TYPE[w] ?? w),
    ),
  };
}

/** False when both name a kind of venue and the kinds differ ("Symposium" vs "Conference"). */
function sameType(a: Name, b: Name): boolean {
  if (a.types.size === 0 || b.types.size === 0) return true;
  return [...a.types].some((t) => b.types.has(t));
}

function acronymKey(acronym: string): string {
  return acronym.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function push(map: Map<string, number[]>, key: string, value: number) {
  if (!key) return;
  const list = map.get(key);
  if (!list) map.set(key, [value]);
  else if (!list.includes(value)) list.push(value);
}

export function buildCatalog(entries: RankingEntry[]): Catalog {
  const catalog: Catalog = {
    entries,
    titles: [],
    titleWords: [],
    names: [],
    byKey: new Map(),
    byWord: new Map(),
    byAcronym: new Map(),
    cache: new Map(),
  };
  entries.forEach((entry, index) => {
    catalog.titles.push(toName(entry.title));
    catalog.titleWords.push(new Set(words(entry.title)));
    for (const title of [entry.title, ...(entry.formerTitles ?? [])]) {
      const name =
        title === entry.title ? catalog.titles[index] : toName(title);
      const n = catalog.names.push({ entry: index, name }) - 1;
      push(catalog.byKey, name.key, n);
      if (name.required.size > 0) push(catalog.byKey, name.requiredKey, n);
      for (const word of name.required) push(catalog.byWord, word, n);
    }
    for (const acronym of [entry.acronym, ...(entry.formerAcronyms ?? [])]) {
      push(catalog.byAcronym, acronymKey(acronym), index);
      const [first, ...rest] = acronym.split(/\s+/);
      if (rest.length && ACRONYM_PREFIXES.has(first.toUpperCase())) {
        push(catalog.byAcronym, acronymKey(rest.join("")), index);
      }
    }
  });
  return catalog;
}

/**
 * How well a field's text matches a venue name, from 0 (not at all) to 1 (same name).
 * `otherKind` is set when a journal article is compared with a conference or
 * the other way round; then only the very same name counts. `acronyms` holds
 * the acronyms found in the fields, in lower case.
 */
function similarity(
  field: Name,
  name: Name,
  otherKind: boolean,
  acronyms: Set<string>,
): number {
  if (otherKind)
    return field.strictKey && field.strictKey === name.strictKey ? 1 : 0;
  if (field.key === name.key) return 1;
  if (name.required.size > 0 && field.requiredKey === name.requiredKey)
    return 1;
  // Short names such as "IEEE Access" or "Conference on Cloud Computing" are
  // part of too many other names to match loosely.
  if (name.required.size < 3) return 0;
  if (!sameType(field, name)) return 0;
  for (const region of field.regions) if (!name.all.has(region)) return 0;
  let overlap = 0;
  for (const word of name.required) if (field.required.has(word)) overlap++;
  if (overlap === name.required.size) {
    // The field contains the whole name, plus some extra words:
    // "Annual Meeting of the Association for Computational Linguistics".
    // Extras around a short name must be acronyms, SIG names, venue words or
    // the name of a track ("CHI", "SIGKDD", "Joint Meeting", "Datasets and
    // Benchmarks Track"): "Mathematical Foundations of Computer Science" is
    // not "Foundations of Computer Science".
    if (name.required.size < 5) {
      for (const word of field.required) {
        const explained =
          name.required.has(word) ||
          acronyms.has(word) ||
          word.startsWith("sig") ||
          word === "joint" ||
          field.trackWords.has(word) ||
          VENUE_TYPES.has(word);
        if (!explained) return 0;
      }
    }
    const coverage = overlap / field.required.size;
    return coverage >= 0.5 ? 0.5 + 0.5 * coverage : 0;
  }
  if (
    overlap === field.required.size &&
    overlap >= 4 &&
    name.required.size === overlap + 1
  ) {
    // The field is the name minus one word, such as a SIG name it leaves out.
    return (2 * overlap) / (field.required.size + name.required.size);
  }
  return 0;
}

/** Words such as "workshop" that appear in any of the venue's fields. */
function satelliteWords(fields: Field[]): string[] {
  const found = fields.flatMap((f) => words(f.text));
  return [...new Set(found.filter((w) => SATELLITE.has(w)))];
}

/** Whether an entry's title has every satellite word the fields have. */
function allowed(query: Query, entry: number): boolean {
  const own = query.catalog.titleWords[entry];
  return query.satellite.every((w) => own.has(w));
}

interface Candidate {
  entry: number;
  score: number;
  field: VenueField;
  /** Tie-breaker: how many words the matched name has. */
  specificity: number;
}

/** Pick one candidate; null when the best ones disagree about the rank. */
function pick(query: Query, candidates: Candidate[]): Candidate | null {
  if (candidates.length === 0) return null;
  const { catalog, venue } = query;
  const top = Math.max(...candidates.map((c) => c.score));
  const sameKind = (c: Candidate) =>
    catalog.entries[c.entry].type === venue.kind ? 1 : 0;
  // The venue's kind first, then the more specific name.
  const order = (a: Candidate, b: Candidate) =>
    sameKind(b) - sameKind(a) || b.specificity - a.specificity;
  const best = candidates.filter((c) => top - c.score < 1e-9).sort(order);
  const ranks = new Set(
    best
      .filter((c) => order(c, best[0]) === 0)
      .map((c) => catalog.entries[c.entry].rank),
  );
  return ranks.size === 1 ? best[0] : null;
}

interface AcronymCandidate {
  key: string;
  raw: string;
  /** Strong candidates match case-insensitively; weak ones only the exact spelling. */
  strong: boolean;
  /** In parentheses, as in "(WACV)": the field naming its venue outright. */
  explicit: boolean;
}

/**
 * Acronym candidates in a field: "(CVPR)", "ICML 2023", "NeurIPS", "ECML PKDD",
 * and a field that is a single word ("Interspeech 2023"). Mixed-case words such
 * as "EuroSys" might just be capitalised words, so they are weak.
 */
function acronymCandidates(text: string): AcronymCandidate[] {
  const out: AcronymCandidate[] = [];
  const singleWord = words(text).filter((w) => !FILLER.has(w)).length === 1;
  const inParentheses = new Set(
    (text.match(/\([^)]*\)/g) ?? []).flatMap((p) =>
      p.split(/[^A-Za-z0-9+&-]+/),
    ),
  );
  let previous: AcronymCandidate | undefined;
  for (const token of text.split(/[^A-Za-z0-9+&-]+/)) {
    const raw = token.replace(/^[-+&]+|[-+&]+$/g, "");
    // "ICLR2024" and "ICML'23" lose their year.
    const key = acronymKey(raw).replace(/(?<=[A-Z].*)(?:19|20)?\d{2}$/, "");
    const upper = (raw.match(/[A-Z]/g) ?? []).length;
    const letters = (raw.match(/[A-Za-z]/g) ?? []).length;
    if (key.length < 2 || !/[A-Z]/.test(key) || (upper < 2 && !singleWord)) {
      previous = undefined;
      continue;
    }
    const candidate = {
      key,
      raw,
      strong: singleWord || upper / letters >= 0.5,
      explicit: inParentheses.has(token),
    };
    out.push(candidate);
    if (previous) {
      // Acronyms written as two words: "ECML PKDD", "USENIX ATC".
      out.push({
        key: previous.key + key,
        raw: `${previous.raw} ${raw}`,
        strong: true,
        explicit: previous.explicit && candidate.explicit,
      });
    }
    previous = candidate;
  }
  return out;
}

/** The fields' acronyms as words, also stemmed ("NeurIPS" is the word "neurip"). */
function acronymWordsOf(fields: Field[]): Set<string> {
  const out = new Set<string>();
  for (const { acronyms } of fields) {
    for (const { key } of acronyms) {
      out.add(key.toLowerCase());
      out.add(stem(key.toLowerCase()));
    }
  }
  return out;
}

/** Catalog entries named by an acronym in the venue's fields. */
function acronymHits(query: Query): Candidate[] {
  const { catalog, venue, fields, acronymWords } = query;
  const hits: Candidate[] = [];
  // What a name is about: its words without acronyms and venue words.
  const subject = (name: Name) =>
    [...name.required].filter(
      (w) => !acronymWords.has(w) && !VENUE_TYPES.has(w),
    );
  for (const { field, name: fieldName, acronyms } of fields) {
    for (const { key, raw, strong, explicit } of acronyms) {
      if (ACRONYM_PREFIXES.has(key)) continue;
      for (const entry of catalog.byAcronym.get(key) ?? []) {
        const found = catalog.entries[entry];
        if (venue.kind !== undefined && venue.kind !== found.type) continue;
        if (!allowed(query, entry)) continue;
        if (
          !strong &&
          ![found.acronym, ...(found.formerAcronyms ?? [])].includes(raw)
        ) {
          continue;
        }
        const title = catalog.titles[entry];
        // "(WACV)" names the venue even though CORE still calls the Winter
        // Conference a Workshop; otherwise the kinds of venue must agree.
        if (!explicit && !sameType(fieldName, title)) continue;
        // How close the venue's subject is to the fields' subject. When both
        // have one, they must overlap: in "AAAI Conference on Human Computation
        // and Crowdsourcing" the AAAI is the organiser, not the venue. When an
        // acronym names several venues ("FSE"), the closest one wins.
        const own = subject(title);
        let closeness = 0;
        let unrelated = false;
        for (const { name } of fields) {
          const theirs = subject(name);
          if (own.length === 0 || theirs.length === 0) continue;
          const overlap = own.filter((w) => theirs.includes(w)).length;
          const dice = (2 * overlap) / (own.length + theirs.length);
          closeness = Math.max(closeness, dice);
          unrelated = unrelated || dice < 0.3;
        }
        if (unrelated && closeness < 0.3) continue;
        hits.push({ entry, score: closeness, field, specificity: 0 });
      }
    }
  }
  return hits;
}

/**
 * The two venues of a joint event, each also tried on its own: "Joint European
 * Software Engineering Conference and Symposium on the Foundations of Software
 * Engineering" is ESEC/FSE, which CORE and CCF list as FSE.
 */
function jointParts(text: string): string[] {
  if (!/\bjoint\b/i.test(text)) return [];
  const parts = text.split(
    /\s+and\s+(?=(?:the\s+)?(?:\S+\s+){0,3}?(?:symposium|conference|workshop|meeting)\b)/i,
  );
  return parts.length > 1 ? parts : [];
}

function matchByTitle(query: Query): Match | null {
  const candidates: Candidate[] = [];
  for (const { field, text, name: whole } of query.fields) {
    // A part of a joint event is still the whole event's kind of venue.
    const parts = jointParts(text).map((part) => ({
      ...toName(part),
      types: whole.types,
    }));
    for (const name of [whole, ...parts]) {
      matchName(query, field, name, candidates);
    }
  }
  const best = pick(query, candidates);
  return (
    best && {
      entry: query.catalog.entries[best.entry],
      by: "title",
      field: best.field,
    }
  );
}

/** Add the catalog names that match one name from a field to `candidates`. */
function matchName(
  query: Query,
  field: VenueField,
  name: Name,
  candidates: Candidate[],
) {
  const { catalog, venue, named, acronymWords } = query;
  if (name.all.size === 0) return;
  // Names with the same words, then every name sharing at least two words.
  const tried = new Set([
    ...(catalog.byKey.get(name.key) ?? []),
    ...(catalog.byKey.get(name.requiredKey) ?? []),
  ]);
  const shared = new Map<number, number>();
  for (const word of name.required) {
    for (const n of catalog.byWord.get(word) ?? []) {
      shared.set(n, (shared.get(n) ?? 0) + 1);
    }
  }
  for (const [n, count] of shared) if (count >= 2) tried.add(n);
  for (const n of tried) {
    const { entry, name: entryName } = catalog.names[n];
    // If the fields name a venue by acronym ("Computer Vision – ECCV 2022"),
    // a title match must be that venue, not another one with a similar
    // name ("International Conference on Computer Vision").
    if (named.size > 0 && !named.has(entry)) continue;
    if (!allowed(query, entry)) continue;
    const otherKind =
      venue.kind !== undefined && venue.kind !== catalog.entries[entry].type;
    const score = similarity(name, entryName, otherKind, acronymWords);
    if (score > 0) {
      candidates.push({
        entry,
        score,
        field,
        specificity: entryName.required.size,
      });
    }
  }
}

// Words for events rather than publications. "Proceedings" isn't one:
// "Proceedings of the IEEE" is a journal.
const EVENT_TYPES = new Set(["conference", "symposium", "workshop"]);

/** Whether a field names a conference, symposium, workshop or meeting. */
function namesAnEvent(fields: Field[]): boolean {
  return fields.some(({ name }) =>
    [...name.types].some((t) => EVENT_TYPES.has(t)),
  );
}

/** One of the item's venue fields, parsed once per query. */
interface Field {
  field: VenueField;
  text: string;
  name: Name;
  acronyms: AcronymCandidate[];
}

/** What one call of `matchVenue` works with. */
interface Query {
  catalog: Catalog;
  venue: Venue;
  fields: Field[];
  /** Words such as "workshop" in the fields; see `SATELLITE`. */
  satellite: string[];
  /** The fields' acronyms as words; see `acronymWordsOf`. */
  acronymWords: Set<string>;
  /** Entries the fields name by acronym; see `matchVenue`. */
  named: Set<number>;
}

// The longest venue name in the data is under 200 characters. Matching only
// looks at this much of a field, so that a huge one (as a synced item could
// have) can't make the text patterns slow.
const MAX_FIELD_LENGTH = 1000;

/**
 * Find the venue of an item in one edition: by full name first, then by acronym.
 * Returns null when nothing matches, or when the best matches disagree on the rank.
 */
export function matchVenue(catalog: Catalog, venue: Venue): Match | null {
  const present = VENUE_FIELDS.filter((f) => venue.fields[f]?.trim()).map(
    (field) => ({
      field,
      text: venue.fields[field]!.slice(0, MAX_FIELD_LENGTH),
    }),
  );
  const cacheKey = JSON.stringify([
    venue.kind ?? "",
    ...present.map(({ field, text }) => [field, text]),
  ]);
  const cached = catalog.cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const fields = present.map(({ field, text }) => {
    return {
      field,
      text,
      name: toName(text),
      acronyms: acronymCandidates(text),
    };
  });
  // A "journal article" published in "... Annual Conference on Neural
  // Information Processing Systems" is a conference paper saved under the
  // wrong item type, so don't hold it to the journal rules.
  if (venue.kind === "journal" && namesAnEvent(fields)) {
    venue = { ...venue, kind: "conference" };
  }

  const query: Query = {
    catalog,
    venue,
    fields,
    satellite: satelliteWords(fields),
    acronymWords: acronymWordsOf(fields),
    named: new Set(),
  };
  const hits = acronymHits(query);
  // Venues the fields name by acronym, counting only those whose full name
  // shares a word with the fields: in "USENIX ATC '21" the "ATC" isn't the
  // International Conference on Advanced and Trusted Computing.
  query.named = new Set(hits.filter((h) => h.score > 0).map((h) => h.entry));
  let match = matchByTitle(query);
  if (!match) {
    const best = pick(query, hits);
    match = best && {
      entry: catalog.entries[best.entry],
      by: "acronym",
      field: best.field,
    };
  }
  catalog.cache.set(cacheKey, match);
  return match;
}

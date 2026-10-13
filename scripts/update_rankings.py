"""Download the CORE and CCF ranking lists and write them as JSON for the plugin.

Run inside the Nix dev shell, which provides Python with pdfplumber:

    npm run data:update

Sources:
  - CORE conference rankings, every edition: https://portal.core.edu.au/conf-ranks/
    (CSV export, one file per edition).
  - CCF recommended conferences and journals, 7th edition (2026): the official PDF
    linked from https://www.ccf.org.cn/Academic_Evaluation/By_category/. The web pages
    there still show the 2022 edition, so the PDF is the only source for 2026.

Output goes to addon/content/data/rankings/: one JSON file per edition plus
index.json, which lists the editions for the plugin's settings.
"""

import collections
import csv
import datetime
import io
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

try:
    import pdfplumber
except ImportError:
    sys.exit("pdfplumber is missing. Run this inside the dev shell: nix develop -c npm run data:update")

OUT_DIR = Path(__file__).resolve().parent.parent / "addon" / "content" / "data" / "rankings"
USER_AGENT = "Mozilla/5.0 (compatible; zotero-core-ranking data script)"

CORE_PAGE = "https://portal.core.edu.au/conf-ranks/"
CORE_EXPORT_URL = CORE_PAGE + "?search=&by=all&source={edition}&sort=atitle&page=1&do=Export"
# Newest first; this is the order the settings drop-down shows, and the first
# is the default.
CORE_EDITIONS = [
    "ICORE2026",
    "CORE2023",
    "CORE2021",
    "CORE2020",
    "CORE2018",
    "CORE2017",
    "CORE2014",
    "CORE2013",
    "ERA2010",
    "CORE2008",
]
CORE_MAIN_RANKS = ("A*", "A", "B", "C")

CCF_EDITION = {
    "id": "ccf2026",
    "label": "CCF 2026 (7th edition)",
    "year": 2026,
    "pdf": "https://www.ccf.org.cn/ccf/contentcore/resource/download?ID=112CF3BF7E1140ACEB271ADAED12A67ADFABB8FF099E40C2759502A85C8A281F",
    "page": "https://www.ccf.org.cn/Academic_Evaluation/By_category/",
}
# CCF's ten fields, in the order the PDF lists them: (key, Chinese name, English name).
CCF_FIELDS = [
    ("architecture", "计算机体系结构/并行与分布计算/存储系统",
     "Computer Architecture / Parallel and Distributed Computing / Storage Systems"),
    ("network", "计算机网络", "Computer Networks"),
    ("security", "网络与信息安全", "Network and Information Security"),
    ("software", "软件工程/系统软件/程序设计语言",
     "Software Engineering / System Software / Programming Languages"),
    ("database", "数据库/数据挖掘/内容检索", "Databases / Data Mining / Content Retrieval"),
    ("theory", "计算机科学理论", "Theoretical Computer Science"),
    ("graphics", "计算机图形学与多媒体", "Computer Graphics and Multimedia"),
    ("ai", "人工智能", "Artificial Intelligence"),
    ("hci", "人机交互与普适计算", "Human-Computer Interaction and Pervasive Computing"),
    ("interdisciplinary", "交叉/综合/新兴", "Interdisciplinary / Comprehensive / Emerging"),
]


def fetch(url: str, attempts: int = 5) -> bytes:
    """Download a URL, retrying because connections on this network sometimes drop."""
    for attempt in range(1, attempts + 1):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except OSError as error:
            if attempt == attempts:
                raise
            print(f"  retrying after error ({error})", file=sys.stderr)
            time.sleep(2 * attempt)
    raise AssertionError("unreachable")


def with_former_names(entry: dict, titles: list[str], acronyms: list[str]) -> dict:
    """Add the venue's other names to an entry, leaving the keys out when there are none."""
    if titles:
        entry["formerTitles"] = titles
    if acronyms:
        entry["formerAcronyms"] = acronyms
    return entry


# --- CORE -------------------------------------------------------------------

COUNTRY_FIXES = {"indian": "India", "spanish": "Spain", "italian": "Italy", "usa": "USA", "uk": "UK"}


def normalize_core_rank(raw: str) -> str:
    """Map CORE's inconsistent rank spellings onto one spelling each.

    For example "National:USA", "National: usa" and "National: USA" all become
    "National: USA".
    """
    rank = " ".join(raw.split())
    low = rank.lower()
    if rank in CORE_MAIN_RANKS:
        return rank
    # "NEW" (added but not yet ranked) and "TBR" (to be reviewed, CORE2023 only)
    if low in ("", "new", "tbr") or low.startswith("unranked"):
        return "Unranked"
    if low.startswith("b (needs review)"):
        return "B"
    if low == "l":
        return "Local"
    if low.startswith("austral"):
        letter = re.search(r"\b([ABC])$", rank)
        return f"Australasian {letter.group(1)}" if letter else "Australasian"
    if low.startswith("journal published"):
        return "Journal Published"
    if low.replace("-", "") == "multiconference":
        return "Multiconference"
    if low.startswith("national/regional"):
        return "National/Regional"
    national = re.match(r"nationa[il]\s*[:(\-]?\s*(.*?)\)?$", rank, re.IGNORECASE)
    if national:
        country = national.group(1).strip()
        if not country:
            return "National"
        country = COUNTRY_FIXES.get(country.lower(), country[0].upper() + country[1:])
        return f"National: {country}"
    regional = re.match(r"regional\s*[:\-]?\s*(.*)$", rank, re.IGNORECASE)
    if regional:
        area = regional.group(1).strip()
        return f"Regional: {area}" if area else "Regional"
    print(f"  warning: unknown CORE rank {raw!r}, kept as is", file=sys.stderr)
    return rank


# Names CORE doesn't have, by CORE acronym. Where CORE lists a venue under an
# old name, the current name becomes its title and CORE's name a former one.
CORE_CURRENT_NAMES = {
    "AAAI": "AAAI Conference on Artificial Intelligence",
    "WWW": "The Web Conference",
}
# Other names papers give a venue, such as the journal that publishes its papers.
CORE_OTHER_NAMES = {
    "VLDB": ["International Conference on Very Large Data Bases", "Proceedings of the VLDB Endowment"],
    "CSCW": ["ACM Conference on Computer-Supported Cooperative Work and Social Computing"],
}
WAS_NOTE = re.compile(r"\(was ([^)]*)\)", re.IGNORECASE)


def core_former_names(title: str) -> tuple[list[str], list[str]]:
    """Former names from CORE's own notes, such as "(was NIPS)" or "(was European Semantic Web Conference)".

    Returns (titles, acronyms). Only the part of a note before "," or ";" counts:
    "(was ESEC/FSE, changed 2024; ...)" is the acronym ESEC/FSE.
    """
    titles: list[str] = []
    acronyms: list[str] = []
    for note in WAS_NOTE.findall(title):
        head = re.split(r"[;,]", note)[0].strip()
        if not head or "..." in head:
            continue
        parts = re.split(r"\s+and\s+", head)
        if all(re.fullmatch(r"[A-Za-z0-9/&+-]+", p) and sum(c.isupper() for c in p) >= 2 for p in parts):
            acronyms += parts
        else:
            titles.append(head)
    return titles, acronyms


def build_core_edition(edition: str) -> list[dict]:
    text = fetch(CORE_EXPORT_URL.format(edition=edition)).decode("utf-8")
    entries = []
    # Columns: id, title, acronym, edition, rank, a Yes/No flag, up to three field-of-research codes.
    for row in csv.reader(io.StringIO(text)):
        if len(row) < 5 or not row[1].strip():
            continue
        if row[3].strip() != edition:
            raise ValueError(f"{edition}: row for another edition {row[3]!r}")
        title = " ".join(row[1].split())
        acronym = row[2].strip()
        former_titles, former_acronyms = core_former_names(title)
        if acronym in CORE_CURRENT_NAMES:
            former_titles.insert(0, title)
            title = CORE_CURRENT_NAMES[acronym]
        former_titles += CORE_OTHER_NAMES.get(acronym, [])
        entries.append(with_former_names({
            "title": title,
            "acronym": acronym,
            "rank": normalize_core_rank(row[4]),
            "type": "conference",
            "coreId": int(row[0]),
        }, former_titles, former_acronyms))
    entries.sort(key=lambda e: (e["title"].casefold(), e["acronym"].casefold(), e["coreId"]))
    return entries


# --- CCF --------------------------------------------------------------------

TABLE_SETTINGS = {"text_x_tolerance": 1, "text_y_tolerance": 3}
FORMER = re.compile(r"[（(]\s*原\s*([^）)]*)[）)]")
RANK_HEADING = re.compile(r"^[一二三]、\s*([ABC])\s*类")
# The PDF mostly uses full-width parentheses around field names, but not everywhere.
FIELD_HEADING = re.compile(r"^[（(]\s*(.+?)\s*[）)]$")
FIELD_BY_ZH = {zh: key for key, zh, _ in CCF_FIELDS}


# Acronyms that the PDF wraps across lines, where joining the pieces directly is
# wrong. Checked against CCF's web pages, which show them unwrapped.
ACRONYM_FIXES = {"SIG-METRICS": "SIGMETRICS", "INTER-SPEECH": "INTERSPEECH", "HOTCHIPS": "HOT CHIPS"}
# Mistakes in the PDF itself.
TITLE_FIXES = {
    "European Conference on Parallel and Distributed Computing Springer":
        "European Conference on Parallel and Distributed Computing",
}


def join_cell(text: str | None, column: str) -> str:
    """Join a table cell's wrapped lines back into one line.

    Acronyms and URLs are joined directly ("CODES+" + "ISSS"); a cell with two
    URLs keeps them apart with a space. In other columns a line ending in "-"
    or "/" joins directly ("Human-" + "Computer", "IEEE/" + "ACM"), and
    anything else joins with a space.
    """
    lines = [line.strip() for line in (text or "").split("\n") if line.strip()]
    if column == "url":
        return re.sub(r"(?<=.)(?=https?://)", " ", re.sub(r"\s+", "", "".join(lines)))
    if column == "acronym":
        # Keep the "(原 …)" note on its own line separate from the acronym.
        names = [line for line in lines if not FORMER.search(line)]
        notes = [line for line in lines if FORMER.search(line)]
        joined = "".join(names)
        if len(names) > 1:
            joined = ACRONYM_FIXES.get(joined, joined)
            print(f"  note: wrapped acronym {names} joined as {joined!r}", file=sys.stderr)
        return " ".join([joined, *notes])
    out = ""
    for line in lines:
        if not out:
            out = line
        elif out.endswith(("-", "/")) or line.startswith("/"):
            out += line
        else:
            out += " " + line
    # The PDF sometimes has a stray space after a hyphen ("Human- Computer").
    out = re.sub(r"(\w)- (\w)", r"\1-\2", out)
    return TITLE_FIXES.get(out, out) if column == "title" else out


def split_former(text: str) -> tuple[str, list[str]]:
    """Separate "(原 Old Name)" notes, which CCF adds to renamed venues, from the current name."""
    former = [" ".join(f.split()) for f in FORMER.findall(text)]
    return " ".join(FORMER.sub(" ", text).split()), [f for f in former if f]


def build_ccf_edition() -> list[dict]:
    pdf_bytes = fetch(CCF_EDITION["pdf"])
    entries: list[dict] = []
    numbers: dict[tuple, list[int]] = {}
    kind = field = rank = None
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            tables = page.find_tables(TABLE_SETTINGS)
            # Headings sit outside the tables. Walk headings and tables top to bottom
            # so that each table row gets the field, type and rank above it.
            events = []
            for line in page.extract_text_lines(x_tolerance=1, return_chars=False):
                inside = any(line["top"] >= t.bbox[1] - 1 and line["bottom"] <= t.bbox[3] + 1 for t in tables)
                if not inside:
                    events.append((line["top"], "heading", line["text"].strip()))
            events += [(t.bbox[1], "table", t) for t in tables]
            for _, what, value in sorted(events, key=lambda e: e[0]):
                if what == "heading":
                    if "推荐国际学术期刊" in value or "推荐国际学术会议" in value:
                        # A new section: forget the old field and rank, so a missed
                        # heading raises an error instead of mislabelling rows.
                        kind = "journal" if "期刊" in value else "conference"
                        field = rank = None
                    elif (match := FIELD_HEADING.match(value)) and match.group(1) in FIELD_BY_ZH:
                        field = FIELD_BY_ZH[match.group(1)]
                        rank = None
                    elif match := RANK_HEADING.match(value):
                        rank = match.group(1)
                    continue
                for row in value.extract(x_tolerance=1):
                    number = (row[0] or "").strip()
                    if number == "序号":
                        continue
                    if not number.isdigit():
                        raise ValueError(f"page {page.page_number}: row without a number: {row}")
                    if not (kind and field and rank):
                        raise ValueError(f"page {page.page_number}: table before its headings")
                    acronym, former_acronyms = split_former(join_cell(row[1], "acronym"))
                    title, former_titles = split_former(join_cell(row[2], "title"))
                    publisher, _ = split_former(join_cell(row[3], "publisher"))
                    entries.append(with_former_names({
                        "title": title,
                        "acronym": acronym,
                        "rank": rank,
                        "type": kind,
                        "field": field,
                        "publisher": publisher,
                        "dblp": join_cell(row[4], "url"),
                    }, former_titles, former_acronyms))
                    numbers.setdefault((field, kind, rank), []).append(int(number))
    # Each section is numbered 1, 2, 3, ...; a gap means a row was misread.
    for section, seen in numbers.items():
        if seen != list(range(1, len(seen) + 1)):
            raise ValueError(f"CCF section {section} is not numbered 1..{len(seen)}: {seen}")
    for entry in entries:
        if re.search(r"[A-Za-z]{30,}", entry["title"]):
            print(f"  warning: CCF title may have lost its spaces: {entry['title']!r}", file=sys.stderr)
    return entries


# --- Output -----------------------------------------------------------------

def write_edition(edition_id: str, entries: list[dict]) -> None:
    """Write one entry per line, so that git diffs show exactly which venues changed."""
    lines = ",\n".join("    " + json.dumps(e, ensure_ascii=False) for e in entries)
    path = OUT_DIR / f"{edition_id}.json"
    path.write_text(f'{{\n  "id": "{edition_id}",\n  "entries": [\n{lines}\n  ]\n}}\n', encoding="utf-8")
    print(f"  wrote {path.relative_to(OUT_DIR.parents[3])} ({len(entries)} entries)")


def summarize(entries: list[dict]) -> str:
    counts = collections.Counter(entry["rank"] for entry in entries)
    main = [f"{r}: {counts.pop(r)}" for r in CORE_MAIN_RANKS if r in counts]
    return ", ".join(main + [f"other: {sum(counts.values())}"])


def edition_info(edition_id: str, system: str, label: str, year: int,
                 types: list[str], entries: list[dict]) -> dict:
    """An edition's entry in index.json, after writing its file."""
    print(f"  {summarize(entries)}")
    write_edition(edition_id, entries)
    return {
        "id": edition_id,
        "system": system,
        "label": label,
        "year": year,
        "types": types,
        "count": len(entries),
        "file": f"{edition_id}.json",
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    editions = []
    for edition in CORE_EDITIONS:
        print(f"CORE {edition}")
        editions.append(edition_info(
            edition.lower(), "CORE", f"CORE {edition}", int(edition[-4:]),
            ["conference"], build_core_edition(edition)))

    print(f"CCF {CCF_EDITION['label']}")
    editions.append(edition_info(
        CCF_EDITION["id"], "CCF", CCF_EDITION["label"], CCF_EDITION["year"],
        ["conference", "journal"], build_ccf_edition()))

    index = {
        "retrieved": datetime.date.today().isoformat(),
        "sources": {
            "CORE": CORE_PAGE,
            "CCF": CCF_EDITION["page"],
        },
        "ccfFields": {key: {"en": en, "zh": zh} for key, zh, en in CCF_FIELDS},
        "editions": editions,
    }
    (OUT_DIR / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote index.json ({len(editions)} editions)")


if __name__ == "__main__":
    main()

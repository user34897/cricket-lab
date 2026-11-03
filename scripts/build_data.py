#!/usr/bin/env python3
"""
Cricket Lab data builder
========================

What this does, in plain English:
  1. Downloads Cricsheet's ball-by-ball data (a zip of one JSON file per match).
  2. Reads every ball of every match and adds up the numbers we care about.
  3. Writes small, ready-made summary files into  site/data/<format>/  so the
     website only has to load the little file it needs (e.g. one player).

Run it from the project folder:
    python3 scripts/build_data.py

Useful options:
    --raw-dir PATH   use an already-unzipped Cricsheet folder instead of downloading
                     (with --formats naming one competition)
    --raw-root PATH  folder holding one unzipped folder per download, named like the
                     zip (e.g. odis_male_json/), instead of downloading
    --out PATH       where to write the data (default: site/data)
    --formats LIST   which competitions to build, e.g. tests,ipl (default: all)

It only uses Python's built-in tools, so there is nothing to install.

Every competition is built completely separately, from its own download, into its
own folder. No figure ever mixes competitions. To add a competition, add an entry
to FORMATS below.
"""

import argparse
import datetime
import glob
import json
import os
import re
import shutil
import sys
import tempfile
import urllib.parse
import urllib.request
import zipfile
from collections import Counter, defaultdict

# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

# Each competition is built separately into site/data/<key>/.
#   kind:          "test", "odi" or "t20": picks the thresholds in KIND_SETTINGS
#   coverage:      how we find missing matches (see analyse_coverage)
#   missing_list:  the section of Cricsheet's "Missing" page for this competition
FORMATS = {
    "tests": {
        "label": "Tests",
        "kind": "test",
        "match_type": "Test",
        "team_type": "international",
        "coverage": "numbers",
        "url": "https://cricsheet.org/downloads/tests_male_json.zip",
        # When the format's numbering starts (the first ever Test), so we know
        # everything before Cricsheet's first match is missing.
        "format_start": "1877-03-15",
        # Cricsheet withholds matches involving Afghanistan's men, who played their
        # first Test in June 2018. Gaps in the Test numbering after this date are
        # put down to that (if the count matches Cricsheet's own README), not to
        # patchy coverage.
        "withheld_since": "2018-06-01",
    },
    "odis": {
        "label": "ODIs",
        "kind": "odi",
        "match_type": "ODI",
        "team_type": "international",
        "coverage": "numbers+missing",
        "missing_list": "Odi Matches",
        "url": "https://cricsheet.org/downloads/odis_male_json.zip",
        "format_start": "1971-01-05",
        "withheld_since": "2009-04-19",     # Afghanistan's first ODI
    },
    # T20 internationals are built twice from the same download: full-member
    # nations only (the default view) and every team.
    "t20is": {
        "label": "T20Is",
        "kind": "t20",
        "match_type": "T20",
        "team_type": "international",
        "full_members_only": True,
        "coverage": "numbers+associates",
        "url": "https://cricsheet.org/downloads/t20s_male_json.zip",
        "format_start": "2005-02-17",
        "withheld_since": "2010-02-01",     # Afghanistan's first T20I
    },
    "t20is_all": {
        "label": "T20Is (all teams)",
        "kind": "t20",
        "match_type": "T20",
        "team_type": "international",
        "full_members_only": False,
        "coverage": "numbers+associates",
        "url": "https://cricsheet.org/downloads/t20s_male_json.zip",
        "format_start": "2005-02-17",
        "withheld_since": "2010-02-01",
    },
    "bbl": {
        "label": "BBL",
        "kind": "t20",
        "league": True,
        "match_type": "T20",
        "team_type": "club",
        "coverage": "missing",
        "missing_list": "Big bash league Matches",
        "season": "split",                  # seasons like 2023/24 (December to February)
        "url": "https://cricsheet.org/downloads/bbl_male_json.zip",
    },
    "ipl": {
        "label": "IPL",
        "kind": "t20",
        "league": True,
        "match_type": "T20",
        "team_type": "club",
        "coverage": "missing",
        "missing_list": "Indian premier league Matches",
        # Renamed franchises are shown under their current names.
        "team_aliases": {"Royal Challengers Bangalore": "Royal Challengers Bengaluru", "Delhi Daredevils": "Delhi Capitals",
                         "Kings XI Punjab": "Punjab Kings", "Rising Pune Supergiants": "Rising Pune Supergiant"},
        "url": "https://cricsheet.org/downloads/ipl_male_json.zip",
    },
}

# International teams with full ICC membership (for the T20I "full members only" view).
FULL_MEMBERS = {"Afghanistan", "Australia", "Bangladesh", "England", "India", "Ireland", "New Zealand",
                "Pakistan", "South Africa", "Sri Lanka", "West Indies", "Zimbabwe"}

# Thresholds that suit each kind of cricket. The Test values are the ones used since stage 1-2.
KIND_SETTINGS = {
    "test": {
        "nemesis_min_balls": 120,          # balls against each other before we rank a matchup
        "danger_zones": [(1, 10), (11, 25), (26, 50), (51, 100), (101, None)],
        "dot_runs": [3, 5, 8],             # pressure test: "after N or more dots in a row"
        "top_order": 6,                    # era comparison: batting positions counted as top order
        "matchup_small": 120, "matchup_tiny": 30,
        "phases": None,
        "otd": {"bat": 100, "bowl": 5, "big_chase": 250, "big_win_runs": 250},
    },
    "odi": {
        "nemesis_min_balls": 60,
        "danger_zones": [(1, 10), (11, 25), (26, 50), (51, 80), (81, None)],
        "dot_runs": [3, 5, 8],
        "top_order": 6,
        "matchup_small": 60, "matchup_tiny": 18,
        "phases": [["Powerplay", 1, 10], ["Middle overs", 11, 40], ["Death overs", 41, 50]],
        "otd": {"bat": 100, "bowl": 5, "big_chase": 300, "big_win_runs": 150},
    },
    "t20": {
        "nemesis_min_balls": 30,
        "danger_zones": [(1, 5), (6, 10), (11, 20), (21, 35), (36, None)],
        "dot_runs": [2, 3, 4],
        "top_order": 4,
        "matchup_small": 30, "matchup_tiny": 12,
        "phases": [["Powerplay", 1, 6], ["Middle overs", 7, 15], ["Death overs", 16, 20]],
        "otd": {"bat": 75, "bowl": 4, "big_chase": 200, "big_win_runs": 75},
    },
}

# Cricsheet's list of matches it doesn't have, by competition (with dates and teams).
MISSING_URL = "https://cricsheet.org/missing/"

# Afghanistan's international matches are withheld by Cricsheet. This file lists
# Afghanistan international players by ESPNcricinfo ID (from ESPNcricinfo's
# Afghanistan caps lists and Wikidata); the build also asks Wikidata for any new ones.
AFGHANISTAN_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "afghanistan_players.csv")
WIKIDATA_URL = "https://query.wikidata.org/sparql"
WIKIDATA_AFGHANISTAN_QUERY = """
SELECT DISTINCT ?cid WHERE {
  { ?p wdt:P54 wd:Q86477 . } UNION { ?p wdt:P1532 wd:Q889 ; wdt:P106 wd:Q12299841 . }
  ?p wdt:P2697 ?cid .
}"""

# Cricsheet's player register: links each player to their ESPNcricinfo ID.
REGISTER_URL = "https://cricsheet.org/register/people.csv"

# Dismissals that the bowler gets credit for.
BOWLER_WICKETS = {"bowled", "caught", "caught and bowled", "lbw", "stumped", "hit wicket"}
# "Dismissals" that don't count as the batter being out.
NOT_OUT_KINDS = {"retired hurt", "retired not out"}

# Cricsheet sometimes spells the same ground differently, or the ground has
# been renamed. After cutting off anything after the first comma, these map
# to one name.
VENUE_ALIASES = {
    "Darren Sammy National Cricket Stadium": "Daren Sammy National Cricket Stadium",
    "Feroz Shah Kotla": "Arun Jaitley Stadium",
    "M.Chinnaswamy Stadium": "M Chinnaswamy Stadium",
    "Chittagong Divisional Stadium": "Zahur Ahmed Chowdhury Stadium",
    "Zohur Ahmed Chowdhury Stadium": "Zahur Ahmed Chowdhury Stadium",
    "Marrara Cricket Ground": "Marrara Stadium",
    "New Wanderers Stadium": "The Wanderers Stadium",
    "P Saravanamuttu Stadium": "P Sara Oval",
    "R.Premadasa Stadium": "R Premadasa Stadium",
    "Sardar Patel Stadium": "Narendra Modi Stadium",
    "Punjab Cricket Association Stadium": "Punjab Cricket Association IS Bindra Stadium",
    "W.A.C.A. Ground": "Western Australia Cricket Association Ground",
    "OUTsurance Oval": "Mangaung Oval",
    # White-ball grounds (stage 3)
    "Simonds Stadium": "GMHBA Stadium",
    "Aurora Stadium": "University of Tasmania Stadium",
    "Zayed Cricket Stadium": "Sheikh Zayed Stadium",
    "Subrata Roy Sahara Stadium": "Maharashtra Cricket Association Stadium",
}

# Everyday names people search for. Shown under the ground name.
VENUE_NICKNAMES = {
    "Melbourne Cricket Ground": "MCG",
    "Sydney Cricket Ground": "SCG",
    "Brisbane Cricket Ground": "The Gabba",
    "Western Australia Cricket Association Ground": "WACA",
    "Kennington Oval": "The Oval",
    "Shere Bangla National Stadium": "Mirpur",
    "Sinhalese Sports Club Ground": "SSC",
    "MA Chidambaram Stadium": "Chepauk",
    "Narendra Modi Stadium": "Motera",
    "Punjab Cricket Association IS Bindra Stadium": "Mohali",
    "The Rose Bowl": "Hampshire Bowl",
    "Riverside Ground": "Chester-le-Street",
    "Sophia Gardens": "Cardiff",
    "Arun Jaitley Stadium": "Feroz Shah Kotla",
    "Zahur Ahmed Chowdhury Stadium": "Chattogram",
    "Vidarbha Cricket Association Stadium": "Jamtha, Nagpur",
    "Docklands Stadium": "Marvel Stadium",
    "GMHBA Stadium": "Kardinia Park",
    "University of Tasmania Stadium": "York Park",
    "Carrara Oval": "Gold Coast",
    "Bharat Ratna Shri Atal Bihari Vajpayee Ekana Cricket Stadium": "Ekana Stadium, Lucknow",
}

CITY_FIXES = {"Bangalore": "Bengaluru", "Chittagong": "Chattogram", "Port Elizabeth": "Gqeberha"}

# Cricsheet gives a city but not a country, so this maps each city to its country
# (the West Indies is treated as one, as it is in Test cricket).
COUNTRY_CITIES = {
    "Australia": ["Adelaide", "Brisbane", "Canberra", "Darwin", "Hobart", "Mackay", "Melbourne", "Perth", "Sydney"],
    "Bangladesh": ["Bogra", "Chattogram", "Dhaka", "Fatullah", "Khulna", "Sylhet"],
    "England": ["Birmingham", "Cardiff", "Chester-le-Street", "Leeds", "London", "Manchester", "Nottingham", "Southampton"],
    "India": ["Ahmedabad", "Bengaluru", "Chandigarh", "Chennai", "Delhi", "Dharamsala", "Guwahati", "Hyderabad", "Indore",
              "Kanpur", "Kolkata", "Mumbai", "Nagpur", "Pune", "Rajkot", "Ranchi", "Visakhapatnam"],
    "Ireland": ["Belfast", "Dublin"],
    "New Zealand": ["Auckland", "Christchurch", "Dunedin", "Hamilton", "Mount Maunganui", "Napier", "Wellington"],
    "Pakistan": ["Faisalabad", "Karachi", "Lahore", "Multan", "Rawalpindi"],
    "South Africa": ["Bloemfontein", "Cape Town", "Centurion", "Durban", "Gqeberha", "Johannesburg", "Potchefstroom"],
    "Sri Lanka": ["Colombo", "Galle", "Kandy", "Pallekele"],
    "United Arab Emirates": ["Abu Dhabi", "Dubai", "Sharjah"],
    "West Indies": ["Barbados", "Dominica", "Grenada", "Gros Islet", "Guyana", "Jamaica", "North Sound", "St John's",
                    "St Kitts", "St Lucia", "St Vincent", "Tarouba", "Trinidad"],
    "Zimbabwe": ["Bulawayo", "Harare"],
}
CITY_COUNTRY = {c: country for country, cities in COUNTRY_CITIES.items() for c in cities}
# Grounds where Cricsheet has no city.
VENUE_COUNTRY = {"Dubai International Cricket Stadium": "United Arab Emirates",
                 "Sharjah Cricket Stadium": "United Arab Emirates"}

COMPACT = {"separators": (",", ":"), "ensure_ascii": False}


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def canonical_venue(raw):
    name = raw.split(",")[0].strip()
    return VENUE_ALIASES.get(name, name)


def ratio(a, b, digits=2):
    """a / b rounded, or None when b is zero (shown as '–' on the site)."""
    return round(a / b, digits) if b else None


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, **COMPACT)


def download_and_unzip(url, dest):
    print("Downloading", url)
    zip_path = os.path.join(dest, "data.zip")
    req = urllib.request.Request(url, headers={"User-Agent": "cricket-lab-builder"})
    with urllib.request.urlopen(req) as resp, open(zip_path, "wb") as out:
        shutil.copyfileobj(resp, out)
    raw_dir = os.path.join(dest, "unzipped")
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(raw_dir)
    return raw_dir


def rename_teams(data, aliases):
    """Apply team renames everywhere a team name appears in one match."""
    if not aliases:
        return
    fix = lambda t: aliases.get(t, t)  # noqa: E731
    info = data["info"]
    info["teams"] = [fix(t) for t in info["teams"]]
    info["players"] = {fix(t): v for t, v in info.get("players", {}).items()}
    for k in ("outcome", "toss"):
        if info.get(k, {}).get("winner"):
            info[k]["winner"] = fix(info[k]["winner"])
    for inn in data.get("innings", []):
        inn["team"] = fix(inn["team"])


def load_matches(raw_dir, match_type, team_type=None):
    matches = []
    for path in glob.glob(os.path.join(raw_dir, "*.json")):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        info = data.get("info", {})
        # Men's matches of the right type only (never women's cricket).
        if info.get("gender") != "male" or info.get("match_type") != match_type:
            continue
        if team_type and info.get("team_type", team_type) != team_type:
            continue
        data["_id"] = os.path.splitext(os.path.basename(path))[0]
        matches.append(data)
    # Oldest first, so "recent form" is simply the end of each list.
    matches.sort(key=lambda m: (m["info"]["dates"][0], m["_id"]))
    return matches


def load_register(path=None):
    """Cricsheet person ID -> ESPNcricinfo ID. Returns {} if it can't be fetched,
    so a register problem never stops the site from building."""
    import csv
    import io
    try:
        if path:
            with open(path, encoding="utf-8") as f:
                text = f.read()
        else:
            print("Downloading", REGISTER_URL)
            req = urllib.request.Request(REGISTER_URL, headers={"User-Agent": "cricket-lab-builder"})
            with urllib.request.urlopen(req) as resp:
                text = resp.read().decode("utf-8")
        return {row["identifier"]: row["key_cricinfo"]
                for row in csv.DictReader(io.StringIO(text)) if row.get("key_cricinfo")}
    except Exception as e:  # noqa: BLE001 - any failure just means no links
        print("WARNING: couldn't load the player register (%s); ESPNcricinfo links will be missing." % e)
        return {}


# ---------------------------------------------------------------------------
# Coverage: which periods are missing matches?
#
# Every Test ever played has an official number (Test #1 was in 1877). Cricsheet
# records that number, so if we sort its matches by number, any number that's
# skipped is a Test Cricsheet doesn't have. We know roughly when each missing
# Test was played because it sits between the two Tests either side of it.
# ---------------------------------------------------------------------------

def days_between(a, b):
    return (datetime.date.fromisoformat(b) - datetime.date.fromisoformat(a)).days


def withheld_count(raw_dir):
    try:
        with open(os.path.join(raw_dir, "README.txt"), encoding="utf-8") as f:
            m = re.search(r"further (\d+) matches have been\s+withheld", f.read())
        return int(m.group(1)) if m else 0
    except OSError:
        return 0


def analyse_numbering(matches, raw_dir, cfg):
    """The Test method (stage 1): gaps in the official match numbering."""
    numbered = sorted((m["info"]["match_type_number"], m["info"]["dates"][0])
                      for m in matches if m["info"].get("match_type_number"))
    if not numbered:
        return {"windows": [], "complete_from": None, "years": [], "missing": 0, "withheld": 0}
    gaps = []  # [date before, date after, how many Tests missing]
    for (n1, d1), (n2, d2) in zip(numbered, numbered[1:]):
        if n2 - n1 > 1:
            gaps.append([d1, d2, n2 - n1 - 1])

    # Gaps after Afghanistan started playing are the withheld matches, as long
    # as there aren't more of them than Cricsheet says it withheld.
    since = cfg.get("withheld_since")
    late = [g for g in gaps if since and g[0] >= since]
    withheld = withheld_count(raw_dir)
    if late and sum(g[2] for g in late) <= withheld:
        withheld_gaps = late
        genuine = [g for g in gaps if g not in late]
    else:
        withheld_gaps, genuine = [], gaps

    # Incomplete periods ("windows"). Everything before Cricsheet's first numbered
    # Test is missing. Gaps less than a year apart are merged, so the patchy early
    # years become one continuous period.
    first_date = numbered[0][1]
    windows = [[cfg.get("format_start", "1800-01-01"), first_date]] if numbered[0][0] > 1 else []
    for lo, hi, _ in genuine:
        if windows and days_between(windows[-1][1], lo) < 365:
            windows[-1][1] = max(windows[-1][1], hi)
        else:
            windows.append([lo, hi])
    # "Complete from" is the end of the last incomplete period: every Test after it is in the data.
    complete_from = windows[-1][1] if windows else first_date

    # Year-by-year table for the About page. A missing Test is counted in the year
    # of the Test before it, unless the gap is long (over a month), in which case
    # it's counted in the year of the Test after it.
    in_data = Counter(m["info"]["dates"][0][:4] for m in matches)
    missing, held = Counter(), Counter()
    for bucket, gap_list in ((missing, genuine), (held, withheld_gaps)):
        for lo, hi, n in gap_list:
            bucket[(hi if days_between(lo, hi) > 31 else lo)[:4]] += n
    years = []
    for y in range(int(first_date[:4]), int(numbered[-1][1][:4]) + 1):
        y = str(y)
        years.append({"year": int(y), "in_data": in_data[y], "missing": missing[y], "withheld": held[y]})

    return {
        "windows": windows, "complete_from": complete_from, "years": years,
        "before_first": numbered[0][0] - 1,
        "missing": sum(g[2] for g in genuine), "withheld": sum(g[2] for g in withheld_gaps),
    }


def result_text(info):
    """e.g. "Australia won by an innings and 52 runs", "Draw"."""
    outcome = info.get("outcome", {})
    winner = outcome.get("winner")
    if not winner:
        return (outcome.get("result") or "draw").capitalize()
    margin = outcome.get("by", {})
    if "innings" in margin:
        how = "an innings and %d runs" % margin.get("runs", 0)
    elif "runs" in margin:
        how = "%d runs" % margin["runs"]
    elif "wickets" in margin:
        how = "%d wickets" % margin["wickets"]
    else:
        how = ""
    return winner + " won" + (" by " + how if how else "")


def overlaps_incomplete(first, last, windows):
    """True if a career (or a ground's history) from first to last touches a period with missing matches."""
    return any(first < hi and last > lo for lo, hi in windows)


# ---------------------------------------------------------------------------
# Coverage for the other competitions.
#
# We start with the same numbering method as Tests (ODIs and T20Is have official
# numbers too). But a numbering gap can be a match Cricsheet doesn't have, a match
# abandoned without a ball bowled (these still get a number), or a withheld
# Afghanistan match. So we cross-check with Cricsheet's own "Missing" page, which
# lists each men's match it doesn't have, with the date and teams. Knowing the
# teams means only players from those teams get flagged. The leagues have no
# official numbers, so for them we use the Missing page alone.
# ---------------------------------------------------------------------------

def fetch_missing_lists():
    """{section name: [(date, [team, team]), ...]} for men's matches on Cricsheet's Missing page.
    Returns None if the page can't be read (the build then carries on without it)."""
    try:
        print("Downloading", MISSING_URL)
        req = urllib.request.Request(MISSING_URL, headers={"User-Agent": "cricket-lab-builder"})
        with urllib.request.urlopen(req) as resp:
            page = resp.read().decode("utf-8")
    except Exception as e:  # noqa: BLE001
        print("WARNING: couldn't read Cricsheet's Missing page (%s); coverage checks will rely on numbering only." % e)
        return None
    lists, section, gender, date = defaultdict(list), None, None, None
    for m in re.finditer(r"<(h5|h6|dt|dd)[^>]*>(.*?)</\1>", page, re.S):
        tag, text = m.group(1), re.sub(r"<[^>]+>", "", m.group(2)).strip()
        if tag == "h5":
            section = text
        elif tag == "h6":
            gender = text
        elif tag == "dt":
            date = text
        elif gender == "Male matches" and date:
            lists[section].append((date, [t.strip() for t in text.split(" vs ")]))
    return dict(lists)


def season_of(cfg, date, season=None):
    """The label we group a match under: the calendar year, or for leagues the season."""
    style = cfg.get("season")
    if style == "split":            # e.g. the BBL's 2023/24 season runs from December to February
        if season and "/" in str(season):
            return str(season)
        y, mth = int(date[:4]), int(date[5:7])
        start = y if mth >= 7 else y - 1
        return "%d/%02d" % (start, (start + 1) % 100)
    return int(date[:4])


def analyse_coverage(matches, raw_dir, cfg, missing_lists):
    """Returns how complete Cricsheet's data is for one competition. Keys:
       windows       periods where every team's figures may be incomplete (as for Tests)
       team_missing  [(date, teams)]: individual missing matches, so only those teams are flagged
       assoc_years   (T20Is) years where matches between smaller nations are missing
       complete_from the date from which (almost) every match is in the data
       years         the year-by-year (or season-by-season) table for the About page"""
    method = cfg.get("coverage", "numbers")
    if method == "numbers":
        cov = analyse_numbering(matches, raw_dir, cfg)
        cov.update({"method": method, "team_missing": [], "assoc_years": []})
        return cov

    first_date = matches[0]["info"]["dates"][0] if matches else None
    in_data = Counter(season_of(cfg, m["info"]["dates"][0], m["info"].get("season")) for m in matches)
    listed = (missing_lists or {}).get(cfg.get("missing_list"), [])
    listed_by = Counter(season_of(cfg, d) for d, _ in listed)

    # Numbering gaps (internationals): split into withheld and "other" (abandoned or not covered).
    gaps_by, withheld_total = Counter(), withheld_count(raw_dir)
    numbered = sorted((m["info"]["match_type_number"], m["info"]["dates"][0])
                      for m in matches if m["info"].get("match_type_number"))
    for (n1, d1), (n2, d2) in zip(numbered, numbered[1:]):
        if n2 - n1 > 1:
            gaps_by[season_of(cfg, d2 if days_between(d1, d2) > 31 else d1)] += n2 - n1 - 1

    periods = sorted(set(in_data) | set(listed_by), key=str)
    years = []
    for y in periods:
        row = {"year": y, "in_data": in_data[y], "missing": listed_by[y]}
        if numbered:
            row["other"] = max(0, gaps_by[y] - listed_by[y])   # withheld, abandoned or not covered
        years.append(row)

    windows, team_missing, assoc_years = [], [], []
    complete_from = first_date
    if method == "numbers+missing":
        # Before the first year where 90% of matches are in the data (and stay that way),
        # treat every team as possibly incomplete, like the early Test years.
        good = [r["in_data"] / float(r["in_data"] + r["missing"]) >= 0.9 if r["in_data"] + r["missing"] else True
                for r in years]
        start = next((i for i in range(len(years)) if all(good[i:i + 2])), len(years) - 1)
        complete_from = "%s-01-01" % years[start]["year"]
        windows = [[cfg.get("format_start", "1800-01-01"), complete_from]]
        team_missing = [(d, t) for d, t in listed if d >= complete_from]
    elif method == "numbers+associates":
        # Full-member T20Is look complete (the gaps between them are abandoned or withheld
        # matches), so the unexplained gaps are matches between smaller nations.
        for r in years:
            total = r["in_data"] + r.get("other", 0)
            if total and r.get("other", 0) / float(total) >= 0.05:
                assoc_years.append(r["year"])
    elif method == "missing":
        team_missing = list(listed)
        if listed:
            last = max(d for d, _ in listed)
            later = [m["info"]["dates"][0] for m in matches if m["info"]["dates"][0] > last]
            complete_from = later[0] if later else None

    return {"method": method, "windows": windows, "team_missing": team_missing, "assoc_years": assoc_years,
            "complete_from": complete_from, "years": years, "missing": len(listed),
            "withheld": withheld_total if numbered else 0,
            "other": sum(r.get("other", 0) for r in years), "missing_list_ok": missing_lists is not None}


def load_afghanistan_ids(register_rows):
    """Cricsheet ids of Afghanistan international players. Uses the list kept in
    scripts/afghanistan_players.csv plus any extra players Wikidata knows about."""
    import csv
    import io
    cricinfo_ids = set()
    try:
        with open(AFGHANISTAN_FILE, encoding="utf-8") as f:
            cricinfo_ids = {row["cricinfo_id"] for row in csv.DictReader(f) if row.get("cricinfo_id")}
    except OSError as e:
        print("WARNING: couldn't read %s (%s)" % (AFGHANISTAN_FILE, e))
    try:
        url = WIKIDATA_URL + "?" + urllib.parse.urlencode({"query": WIKIDATA_AFGHANISTAN_QUERY, "format": "json"})
        req = urllib.request.Request(url, headers={"User-Agent": "cricket-lab-builder/1.0 (personal stats site)"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            extra = {b["cid"]["value"] for b in json.load(io.TextIOWrapper(resp, "utf-8"))["results"]["bindings"]}
        new = extra - cricinfo_ids
        if new:
            print("  Wikidata lists %d more Afghanistan players (consider adding them to %s)"
                  % (len(new), os.path.basename(AFGHANISTAN_FILE)))
        cricinfo_ids |= extra
    except Exception as e:  # noqa: BLE001
        print("  (Wikidata not reachable: %s; using the saved list only)" % e)
    by_cricinfo = defaultdict(set)
    for pid, cid in register_rows.items():
        by_cricinfo[cid].add(pid)
    return {pid for cid in cricinfo_ids for pid in by_cricinfo.get(cid, ())}


# ---------------------------------------------------------------------------
# The main number-crunching
# ---------------------------------------------------------------------------

class Builder(object):
    def __init__(self, key, cfg, coverage, cricinfo, afghans):
        self.key, self.cfg = key, cfg
        self.s = KIND_SETTINGS[cfg.get("kind", "test")]   # thresholds for this kind of cricket
        self.coverage = coverage              # from analyse_coverage()
        self.cricinfo = cricinfo              # Cricsheet id -> ESPNcricinfo id
        self.afghans = afghans                # Cricsheet ids of Afghanistan international players
        self.people = {}                      # id -> {name, teams, matches, first, last}
        self.bat_inns = defaultdict(list)     # id -> list of batting innings
        self.bowl_inns = defaultdict(list)    # id -> list of bowling innings
        # (batter id, bowler id) -> [balls, runs, outs, dots, fours, sixes]
        self.matchups = defaultdict(lambda: [0, 0, 0, 0, 0, 0])
        self.venues = {}
        # Danger zone: id -> [[balls faced in zone, dismissals in zone] for each zone]
        self.danger = defaultdict(lambda: [[0, 0] for _ in self.s["danger_zones"]])
        # Pressure test: id -> {"all": [balls, outs], 3: [balls faced after 3+ dots, outs on them], ...}
        self.pressure = defaultdict(lambda: dict([("all", [0, 0])] + [(n, [0, 0]) for n in self.s["dot_runs"]]))
        # Phase stats (white-ball): id -> [[runs, balls, outs] per phase] and [[balls, runs, wickets] per phase]
        n_phases = len(self.s["phases"] or [])
        self.phase_bat = defaultdict(lambda: [[0, 0, 0] for _ in range(n_phases)])
        self.phase_bowl = defaultdict(lambda: [[0, 0, 0] for _ in range(n_phases)])
        # White-ball chase calculator: matches and the position at the start of every over of each chase
        self.chase_matches = []               # [date, chasing team, opponent, ground, target, runs, wkts, result, season]
        self.chase_states = defaultdict(list)  # wickets in hand -> [[match index, runs needed, balls left], ...]
        # Partnerships: (id, id) sorted -> running totals
        self.partners = {}
        self.chases = []                      # every fourth-innings chase
        self.on_this_day = []                 # every match, with the days it was played on
        # Era comparison: year (or season) -> [runs, outs, balls, innings] for all top-order batters
        self.year_top = defaultdict(lambda: [0, 0, 0, 0])
        self.deliveries = 0
        self.first_date = None
        self.last_date = None

    def zone_of(self, balls_faced):
        """Which danger zone a batter is in after facing this many balls."""
        zones = self.s["danger_zones"]
        for i, (lo, hi) in enumerate(zones):
            if hi is None or balls_faced <= hi:
                return i
        return len(zones) - 1

    def phase_of(self, over_index):
        """Which phase (powerplay, middle, death) an over is in; None for Tests."""
        for i, (_, lo, hi) in enumerate(self.s["phases"] or []):
            if lo <= over_index + 1 <= hi:
                return i
        return None

    # -- people ------------------------------------------------------------
    def person(self, pid, name, team, match_id, date):
        p = self.people.get(pid)
        if p is None:
            p = self.people[pid] = {"name": name, "teams": Counter(), "matches": set(),
                                    "first": date, "last": date}
        p["name"] = name  # keep the most recent spelling
        p["teams"][team] += 0 if match_id in p["matches"] else 1
        p["matches"].add(match_id)
        p["last"] = date

    # -- one match ---------------------------------------------------------
    def add_match(self, m):
        info = m["info"]
        mid = m["_id"]
        date = info["dates"][0]
        period = season_of(self.cfg, date, info.get("season"))
        teams = info["teams"]
        registry = info.get("registry", {}).get("people", {})
        venue = canonical_venue(info.get("venue", "Unknown"))
        city = CITY_FIXES.get(info.get("city"), info.get("city"))
        self.first_date = self.first_date or date
        self.last_date = date

        def pid_of(name):
            return registry.get(name) or ("x-" + slugify(name))

        def opponent(team):
            return teams[1] if team == teams[0] else teams[0]

        # Everyone named in the starting XIs (plus anyone who turns up later).
        for team, names in info.get("players", {}).items():
            for name in names:
                self.person(pid_of(name), name, team, mid, date)

        match_bowling = defaultdict(lambda: [0, 0])  # bowler -> [wickets, runs] across the match
        innings_totals = []
        standouts = []  # hundreds and five-wicket hauls, for "On this day"

        for inn_no, inn in enumerate(m.get("innings", []), start=1):
            if inn.get("super_over"):
                continue
            team = inn["team"]
            opp = opponent(team)
            batters = {}     # id -> running totals for this innings
            order = []
            bowlers = {}
            overs_seen = defaultdict(lambda: [0, 0])  # (over, bowler) -> [legal balls, runs conceded]
            total = 0
            wickets = 0
            legal_balls = 0

            # White-ball chase calculator: record the position at the start of each over of the chase.
            chase_idx = None
            if self.s["phases"] and inn_no == 2 and innings_totals and self.chase_ok(info, inn):
                target = inn.get("target", {}).get("runs") or innings_totals[0]["runs"] + 1
                full_balls = info.get("overs", 20) * 6
                chase_idx = len(self.chase_matches)
                self.chase_matches.append([date, team, opp, venue, target, 0, 0, None, period])

            def batter(pid, name):
                if pid not in batters:
                    batters[pid] = {"r": 0, "b": 0, "4": 0, "6": 0, "out": False, "how": None, "by": None,
                                    "streak": 0, "pos": len(order) + 1}
                    order.append(pid)
                    self.person(pid, name, team, mid, date)
                return batters[pid]

            def bowler(pid, name):
                if pid not in bowlers:
                    bowlers[pid] = {"b": 0, "r": 0, "w": 0, "m": 0}
                    self.person(pid, name, opp, mid, date)
                return bowlers[pid]

            # Partnership currently at the crease
            stand = {"pair": None}

            def close_stand(unbroken):
                if stand["pair"] is None:
                    return
                self.add_partnership(stand, unbroken, team, opp, date, venue)
                stand["pair"] = None

            for over in inn.get("overs", []):
                phase = self.phase_of(over["over"])
                if chase_idx is not None and total < target and wickets < 10:
                    self.chase_states[10 - wickets].append([chase_idx, target - total, full_balls - legal_balls])
                for d in over["deliveries"]:
                    self.deliveries += 1
                    bat_id, bowl_id = pid_of(d["batter"]), pid_of(d["bowler"])
                    ns_id = pid_of(d["non_striker"])
                    bs = batter(bat_id, d["batter"])
                    batter(ns_id, d["non_striker"])
                    bw = bowler(bowl_id, d["bowler"])

                    pair = tuple(sorted((bat_id, ns_id)))
                    if pair != stand["pair"]:
                        close_stand(unbroken=True)  # a pair that ended without a wicket (e.g. retired hurt)
                        stand.update({"pair": pair, "runs": 0, "balls": 0, "wkt": wickets + 1})

                    extras = d.get("extras", {})
                    wide = "wides" in extras
                    noball = "noballs" in extras
                    runs_bat = d["runs"]["batter"]
                    total += d["runs"]["total"]
                    four = runs_bat == 4 and not d["runs"].get("non_boundary")
                    six = runs_bat == 6 and not d["runs"].get("non_boundary")

                    # Batter: wides don't count as balls faced; no-balls do.
                    bs["r"] += runs_bat
                    if not wide:
                        bs["b"] += 1
                    bs["4"] += four
                    bs["6"] += six

                    stand["runs"] += d["runs"]["total"]
                    stand["balls"] += not wide
                    legal_balls += not wide and not noball

                    # Did the striker get out on this ball? (for danger zone & pressure test)
                    striker_out = any(pid_of(w["player_out"]) == bat_id and w["kind"] not in NOT_OUT_KINDS
                                      for w in d.get("wickets", []))
                    if phase is not None:
                        pb = self.phase_bat[bat_id][phase]
                        pb[0] += runs_bat
                        pb[1] += not wide
                        pb[2] += striker_out
                    if not wide:
                        zone = self.zone_of(bs["b"])
                        self.danger[bat_id][zone][0] += 1
                        pr = self.pressure[bat_id]
                        pr["all"][0] += 1
                        pr["all"][1] += striker_out
                        for n in self.s["dot_runs"]:
                            if bs["streak"] >= n:
                                pr[n][0] += 1
                                pr[n][1] += striker_out
                        if runs_bat > 0:
                            bs["streak"] = 0
                        elif not noball:
                            bs["streak"] += 1
                    elif runs_bat > 0:
                        bs["streak"] = 0

                    # Bowler: byes and leg byes aren't charged to the bowler.
                    conceded = runs_bat + extras.get("wides", 0) + extras.get("noballs", 0)
                    bw["r"] += conceded
                    legal = not wide and not noball
                    if legal:
                        bw["b"] += 1
                    ov = overs_seen[(over["over"], bowl_id)]
                    ov[0] += legal
                    ov[1] += conceded
                    if phase is not None:
                        pw = self.phase_bowl[bowl_id][phase]
                        pw[0] += legal
                        pw[1] += conceded
                        pw[2] += sum(1 for w in d.get("wickets", []) if w["kind"] in BOWLER_WICKETS)

                    # Head-to-head
                    mu = self.matchups[(bat_id, bowl_id)]
                    if not wide:
                        mu[0] += 1
                        if runs_bat == 0 and not noball:
                            mu[3] += 1
                    mu[1] += runs_bat
                    mu[4] += four
                    mu[5] += six

                    for w in d.get("wickets", []):
                        kind = w["kind"]
                        out_id = pid_of(w["player_out"])
                        out_bs = batter(out_id, w["player_out"])
                        if kind in NOT_OUT_KINDS:
                            continue
                        wickets += 1
                        out_bs["out"] = True
                        out_bs["how"] = kind
                        # Danger zone: out at the stage they'd reached (the ball they were facing).
                        faced = out_bs["b"] if (out_id == bat_id and not wide) else out_bs["b"] + 1
                        self.danger[out_id][self.zone_of(faced)][1] += 1
                        if out_id in pair:
                            close_stand(unbroken=False)
                        if kind in BOWLER_WICKETS:
                            out_bs["by"] = bowl_id
                            bw["w"] += 1
                            self.matchups[(out_id, bowl_id)][2] += 1

            close_stand(unbroken=True)
            pen = inn.get("penalty_runs", {})
            total += pen.get("pre", 0) + pen.get("post", 0)

            for (_, b_id), (legal_balls, runs) in overs_seen.items():
                if legal_balls == 6 and runs == 0:
                    bowlers[b_id]["m"] += 1

            for pid in order:
                s = batters[pid]
                if s["r"] >= self.s["otd"]["bat"]:
                    standouts.append(["100", pid, self.people[pid]["name"], s["r"], int(not s["out"]), team])
                self.bat_inns[pid].append({
                    "mid": mid, "date": date, "opp": opp, "venue": venue, "inn": inn_no,
                    "r": s["r"], "b": s["b"], "4": s["4"], "6": s["6"],
                    "out": s["out"], "how": s["how"], "by": s["by"], "pos": s["pos"], "per": period,
                })
                if s["pos"] <= self.s["top_order"]:
                    yt = self.year_top[period]
                    yt[0] += s["r"]
                    yt[1] += s["out"]
                    yt[2] += s["b"]
                    yt[3] += 1
            for pid, s in bowlers.items():
                if s["w"] >= self.s["otd"]["bowl"]:
                    standouts.append(["5w", pid, self.people[pid]["name"], s["w"], s["r"], opp])
                self.bowl_inns[pid].append({
                    "mid": mid, "date": date, "opp": team, "venue": venue, "inn": inn_no,
                    "b": s["b"], "r": s["r"], "w": s["w"], "m": s["m"], "per": period,
                })
                match_bowling[pid][0] += s["w"]
                match_bowling[pid][1] += s["r"]

            innings_totals.append({"team": team, "runs": total, "wkts": wickets,
                                   "dec": bool(inn.get("declared"))})
            if chase_idx is not None:
                cm = self.chase_matches[chase_idx]
                cm[5], cm[6] = total, wickets

        # Remember each bowler's match figures (for "best in a match" and 10-wicket matches).
        for pid, (w, r) in match_bowling.items():
            for rec in reversed(self.bowl_inns[pid]):
                if rec["mid"] != mid:
                    break
                rec["mw"], rec["mr"] = w, r

        self.add_venue(venue, city, date, info, innings_totals)
        chase = None
        if self.cfg.get("kind", "test") == "test":
            chase = self.add_chase(info, venue, city, date, innings_totals)
        elif self.chase_matches and self.chase_matches[-1][0] == date and self.chase_matches[-1][7] is None:
            cm = self.chase_matches[-1]
            outcome = info.get("outcome", {})
            cm[7] = "W" if outcome.get("winner") == cm[1] else "L" if outcome.get("winner") else "T"
            # same shape as a Test chase row where On this day looks: [.., team at 3, target at 5, result at 8]
            chase = [cm[0], cm[3], None, cm[1], cm[2], cm[4], cm[5], cm[6], cm[7]]

        # Ten wickets in the match replaces that bowler's separate five-fors (each innings'
        # figures are kept on the end, e.g. "6/65 & 4/43").
        for pid, (w, r) in match_bowling.items():
            if w >= 10 and self.cfg.get("kind", "test") == "test":
                standouts = [x for x in standouts if not (x[0] == "5w" and x[1] == pid)]
                figs = [i for i in self.bowl_inns[pid] if i["mid"] == mid and i["b"]]
                team_of = [t for t in teams if t in self.people[pid]["teams"]]
                standouts.append(["10w", pid, self.people[pid]["name"], w, r, team_of[0] if team_of else "",
                                  " & ".join("%d/%d" % (i["w"], i["r"]) for i in figs)])
        self.add_on_this_day(info, venue, standouts, chase)

    # -- On this day ---------------------------------------------------------
    def add_on_this_day(self, info, venue, standouts, chase):
        """One entry per match, listing the calendar days it was played on.
        h (highlights): ["100", id, name, runs, not out, team] / ["5w", id, name, wickets, runs, team]
                        ["10w", id, name, wickets, runs, team, innings figures]
                        ["chase", team, target] (a successful chase of 250+) / ["big", "won by ..."] / ["tie"]"""
        outcome = info.get("outcome", {})
        margin = outcome.get("by", {})
        h = sorted(standouts, key=lambda x: (x[0] != "10w", x[0] != "100", -x[3]))
        if chase and chase[8] == "W" and chase[5] >= self.s["otd"]["big_chase"]:
            h.insert(0, ["chase", chase[3], chase[5]])
        if outcome.get("winner") and ("innings" in margin or margin.get("runs", 0) >= self.s["otd"]["big_win_runs"]
                                      or margin.get("wickets", 0) == 10):
            h.insert(0, ["big", result_text(info)])
        if outcome.get("result") == "tie":
            h.insert(0, ["tie"])
        self.on_this_day.append({"y": int(info["dates"][0][:4]), "d": [d[5:] for d in info["dates"]],
                                 "t": info["teams"], "v": VENUE_NICKNAMES.get(venue) or venue,
                                 "r": result_text(info), "h": h})

    def chase_ok(self, info, inn):
        """Only use chases that weren't changed by rain (no Duckworth-Lewis, no reduced target)."""
        outcome = info.get("outcome", {})
        if outcome.get("method") or outcome.get("result") == "no result":
            return False
        t = inn.get("target", {})
        return not (t.get("overs") and t["overs"] < info.get("overs", t["overs"]))

    # -- partnerships --------------------------------------------------------
    def add_partnership(self, stand, unbroken, team, opp, date, venue):
        a = self.partners.get(stand["pair"])
        if a is None:
            a = self.partners[stand["pair"]] = {"n": 0, "runs": 0, "balls": 0, "broken": 0,
                                                "50": 0, "100": 0, "best": None, "team": team}
        a["n"] += 1
        a["runs"] += stand["runs"]
        a["balls"] += stand["balls"]
        a["broken"] += not unbroken
        a["50"] += 50 <= stand["runs"] < 100
        a["100"] += stand["runs"] >= 100
        best = [stand["runs"], int(unbroken), date, opp, stand["wkt"], venue]
        if a["best"] is None or (best[0], best[1]) > (a["best"][0], a["best"][1]):
            a["best"] = best

    # -- fourth-innings chases ----------------------------------------------
    def add_chase(self, info, venue, city, date, innings_totals):
        if len(innings_totals) < 4:
            return
        chaser = innings_totals[3]["team"]
        mine = sum(t["runs"] for t in innings_totals[:3] if t["team"] == chaser)
        theirs = sum(t["runs"] for t in innings_totals[:3] if t["team"] != chaser)
        target = theirs - mine + 1
        if target <= 0:
            return
        outcome = info.get("outcome", {})
        winner, result = outcome.get("winner"), outcome.get("result")
        res = "W" if winner == chaser else "L" if winner else "T" if result == "tie" else "D"
        last = innings_totals[3]
        opp = [t for t in info["teams"] if t != chaser][0]
        country = VENUE_COUNTRY.get(venue) or CITY_COUNTRY.get(city)
        # [date, ground, country, chasing team, opponent, target, runs made, wickets lost, result]
        row = [date, venue, country, chaser, opp, target, last["runs"], last["wkts"], res]
        self.chases.append(row)
        return row

    # -- venues ------------------------------------------------------------
    def add_venue(self, venue, city, date, info, innings_totals):
        v = self.venues.get(venue)
        if v is None:
            v = self.venues[venue] = {"cities": Counter(), "first": date, "last": date,
                                      "games": [], "recent": []}
        if city:
            v["cities"][city] += 1
        v["last"] = date
        outcome = info.get("outcome", {})
        winner = outcome.get("winner")
        result = outcome.get("result")  # "draw", "tie" or "no result"
        v["games"].append({"date": date, "innings": innings_totals, "winner": winner,
                           "result": result, "toss": info.get("toss", {})})

        v["recent"].append({"date": date, "teams": info["teams"], "result": result_text(info)})

    @staticmethod
    def venue_stats(games):
        """Average scores, results and toss figures for a list of matches at one ground."""
        inns = defaultdict(list)
        res, toss = Counter(), Counter()
        for g in games:
            for i, t in enumerate(g["innings"], start=1):
                inns[i].append(t)
            winner, result = g["winner"], g["result"]
            if g["innings"]:
                bat_first = g["innings"][0]["team"]
                if winner:
                    res["bat_first_won" if winner == bat_first else "field_first_won"] += 1
                else:
                    res[result or "draw"] += 1
            if g["toss"].get("winner"):
                choice = g["toss"].get("decision", "unknown")
                toss["chose_" + choice] += 1
                if winner:
                    key = "won" if winner == g["toss"]["winner"] else "lost"
                else:
                    key = "draw" if result != "tie" else "tie"
                toss[key] += 1
                toss[choice + "_" + key] += 1
        innings = []
        for n in sorted(inns):
            totals = inns[n]
            runs = [t["runs"] for t in totals]
            completed = [t for t in totals if t["wkts"] >= 10]
            innings.append({
                "n": n, "count": len(totals),
                "avg": round(sum(runs) / len(runs)),
                "avg_all_out": round(sum(t["runs"] for t in completed) / len(completed)) if completed else None,
                "high": max(runs), "low": min(runs),
            })
        return {"matches": len(games), "innings": innings, "results": dict(res), "toss": dict(toss)}

    # -- output ------------------------------------------------------------
    def player_summary(self, pid):
        p = self.people[pid]
        inns = self.bat_inns.get(pid, [])
        bowl = self.bowl_inns.get(pid, [])

        # Batting
        runs = sum(i["r"] for i in inns)
        outs = sum(1 for i in inns if i["out"])
        balls = sum(i["b"] for i in inns)
        hundreds = sum(1 for i in inns if i["r"] >= 100)
        fifties = sum(1 for i in inns if 50 <= i["r"] < 100)
        hs = max(inns, key=lambda i: (i["r"], not i["out"])) if inns else None
        batting = {
            "inns": len(inns), "no": len(inns) - outs, "runs": runs, "balls": balls,
            "hs": hs["r"] if hs else None, "hs_no": bool(hs and not hs["out"]),
            "avg": ratio(runs, outs), "sr": ratio(runs * 100, balls),
            "100": hundreds, "50": fifties,
            "0": sum(1 for i in inns if i["r"] == 0 and i["out"]),
            "4": sum(i["4"] for i in inns), "6": sum(i["6"] for i in inns),
        }

        # How they get out
        how_out = Counter(i["how"] for i in inns if i["out"])
        dismissed_by = Counter(i["by"] for i in inns if i["by"])

        # Nervous nineties & conversion
        reached_90 = [i for i in inns if i["r"] >= 90]
        out_90s = sum(1 for i in reached_90 if i["r"] < 100 and i["out"])
        nineties = {
            "reached": len(reached_90),
            "out": out_90s,
            "not_out": sum(1 for i in reached_90 if i["r"] < 100 and not i["out"]),
            "rate": ratio(out_90s * 100, len(reached_90), 1),
        }
        conversion = {"fifties": fifties, "hundreds": hundreds,
                      "rate": ratio(hundreds * 100, fifties + hundreds, 1)}

        # Bowling
        b_balls = sum(i["b"] for i in bowl)
        b_runs = sum(i["r"] for i in bowl)
        b_wkts = sum(i["w"] for i in bowl)
        best_inn = max(bowl, key=lambda i: (i["w"], -i["r"])) if bowl else None
        match_figs = {i["mid"]: (i.get("mw", 0), i.get("mr", 0)) for i in bowl}
        best_match = max(match_figs.values(), key=lambda f: (f[0], -f[1])) if match_figs else None
        bowling = {
            "inns": sum(1 for i in bowl if i["b"] > 0), "balls": b_balls, "runs": b_runs,
            "wkts": b_wkts, "maidens": sum(i["m"] for i in bowl),
            "avg": ratio(b_runs, b_wkts), "econ": ratio(b_runs * 6, b_balls),
            "sr": ratio(b_balls, b_wkts, 1),
            "bbi": [best_inn["w"], best_inn["r"]] if best_inn and b_balls else None,
            "bbm": list(best_match) if best_match and b_balls else None,
            "5w": sum(1 for i in bowl if i["w"] >= 5),
            "10w": sum(1 for f in match_figs.values() if f[0] >= 10),
        }
        return batting, how_out, dismissed_by, nineties, conversion, bowling

    def nemesis(self, pid, faced, bowled_to, flagged):
        """Toughest/favourite opponents, from head-to-heads of at least the minimum number of balls.
        Each row: [id, name, balls, runs, dismissals, dots, pair may be incomplete]."""
        def rows(vs):
            out = []
            for other, (balls, runs, outs, dots, _, _) in vs.items():
                if balls >= self.s["nemesis_min_balls"]:
                    out.append([other, self.people[other]["name"], balls, runs, outs, dots,
                                int(pid in flagged and other in flagged)])
            return out

        # Lower batting average = tougher. With no dismissals the average is "infinite".
        def avg_key(r):
            return (r[3] / r[4] if r[4] else float("inf"), r[3] / r[2])

        def split(lst):
            """Lowest and highest averages, up to 3 each. With few opponents each list takes at most
            half of them, so nobody appears as both "toughest" and "favourite"."""
            if len(lst) == 1:
                return lst, []
            k = min(3, len(lst) // 2)
            low = sorted(lst, key=avg_key)[:k]
            taken = {r[0] for r in low}
            high = [r for r in sorted(lst, key=lambda r: (avg_key(r)[0], r[3]), reverse=True) if r[0] not in taken][:k]
            return low, high

        res = {"min_balls": self.s["nemesis_min_balls"]}
        bat = rows(faced)
        if bat:
            res["toughest"], res["favourite"] = split(bat)
            res["bat_count"] = len(bat)
        bowl = rows(bowled_to)
        if bowl:
            # easiest = batters who average least against this bowler; hardest = most
            res["easiest"], res["hardest"] = split(bowl)
            res["bowl_count"] = len(bowl)
        return res

    def era(self, pid):
        """Compare a batter's average and strike rate with all top-order batters in the same years.
        The player's own top-order innings are left out of the comparison figure."""
        inns = self.bat_inns.get(pid)
        if not inns:
            return None
        years = defaultdict(lambda: [0, 0, 0, 0, 0, 0, 0])  # inns, runs, outs, balls, top runs, top outs, top balls
        for i in inns:
            y = years[i["per"]]
            y[0] += 1
            y[1] += i["r"]
            y[2] += i["out"]
            y[3] += i["b"]
            if i["pos"] <= self.s["top_order"]:
                y[4] += i["r"]
                y[5] += i["out"]
                y[6] += i["b"]
        rows = []
        w_avg = w_sr = weight = 0
        for yr in sorted(years):
            y = years[yr]
            t = self.year_top[yr]
            others_runs, others_outs, others_balls = t[0] - y[4], t[1] - y[5], t[2] - y[6]
            b_avg = others_runs / others_outs if others_outs else None
            b_sr = others_runs * 100 / others_balls if others_balls else None
            if b_avg and b_sr:
                w_avg += b_avg * y[0]
                w_sr += b_sr * y[0]
                weight += y[0]
            # [year (or season), innings, runs, outs, balls, era average, era strike rate]
            rows.append([yr, y[0], y[1], y[2], y[3],
                         round(b_avg, 2) if b_avg else None, round(b_sr, 1) if b_sr else None])
        return {"years": rows,
                "era_avg": round(w_avg / weight, 2) if weight else None,
                "era_sr": round(w_sr / weight, 1) if weight else None,
                "top_order_share": round(sum(1 for i in inns if i["pos"] <= self.s["top_order"]) / len(inns), 2)}

    def write(self, out_dir, fmt_key, fmt_cfg):
        base = os.path.join(out_dir, fmt_key)
        if os.path.isdir(base):
            shutil.rmtree(base)

        # Who each bowler dismissed most (from the head-to-head totals).
        victims = defaultdict(Counter)
        bat_vs = defaultdict(dict)
        bowl_vs = defaultdict(dict)
        for (bat, bowl), v in self.matchups.items():
            if v[2]:
                victims[bowl][bat] = v[2]
            bat_vs[bat][bowl] = v
            bowl_vs[bowl][bat] = v

        def named(counter, n=5):
            return [[pid, self.people[pid]["name"], c] for pid, c in counter.most_common(n)]

        windows = self.coverage["windows"]
        flagged = {pid for pid in self.people if self.is_incomplete(pid)}
        intl = fmt_cfg.get("team_type") == "international"

        # Partnerships grouped by player
        by_player = defaultdict(list)
        for (a, b), agg in self.partners.items():
            pair_gap = int(a in flagged and b in flagged)
            for me, other in ((a, b), (b, a)):
                # [partner id, name, stands, runs, times broken, balls, 50s, 100s, best stand, pair may be incomplete]
                by_player[me].append([other, self.people[other]["name"], agg["n"], agg["runs"], agg["broken"],
                                      agg["balls"], agg["50"], agg["100"], agg["best"], pair_gap])
        for pid, rows in by_player.items():
            rows.sort(key=lambda r: -r[3])
            write_json(os.path.join(base, "partnerships", pid + ".json"), rows)

        index = []
        for pid, p in self.people.items():
            batting, how_out, dismissed_by, nineties, conversion, bowling = self.player_summary(pid)
            teams = [t for t, _ in p["teams"].most_common()]
            mat = len(p["matches"])

            def form_bat(i):
                return {"date": i["date"], "opp": i["opp"], "venue": i["venue"], "inn": i["inn"],
                        "r": i["r"], "b": i["b"], "out": i["out"], "how": i["how"],
                        "by": self.people[i["by"]]["name"] if i["by"] else None}

            def form_bowl(i):
                return {"date": i["date"], "opp": i["opp"], "venue": i["venue"], "inn": i["inn"],
                        "o": "%d.%d" % divmod(i["b"], 6), "r": i["r"], "w": i["w"]}

            bowled = [i for i in self.bowl_inns.get(pid, []) if i["b"] > 0]
            incomplete = pid in flagged
            write_json(os.path.join(base, "players", pid + ".json"), {
                "id": pid, "name": p["name"], "teams": teams, "matches": mat,
                "first": p["first"], "last": p["last"],
                "incomplete": incomplete, "cricinfo": self.cricinfo.get(pid),
                "batting": batting, "bowling": bowling,
                "how_out": dict(how_out), "dismissed_by": named(dismissed_by),
                "victims": named(victims[pid]),
                "nineties": nineties, "conversion": conversion,
                "form_bat": [form_bat(i) for i in self.bat_inns.get(pid, [])[-10:]][::-1],
                "form_bowl": [form_bowl(i) for i in bowled[-10:]][::-1],
                "nemesis": self.nemesis(pid, bat_vs.get(pid, {}), bowl_vs.get(pid, {}), flagged),
                "danger": self.danger[pid] if pid in self.danger else None,
                "pressure": self.pressure[pid] if pid in self.pressure else None,
                "partners": [r for r in by_player.get(pid, []) if r[2] >= 3][:5] or by_player.get(pid, [])[:5],
                "era": self.era(pid),
                "by_period": self.by_period(pid),
                "phases": self.phases(pid),
                "afghanistan": intl and pid in self.afghans,
            })
            # Compact search index:
            # [id, name, teams, first year, last year, matches, runs, wickets, balls faced, balls bowled,
            #  1 if their record may be incomplete else 0, 1 if an Afghanistan player (internationals only)]
            index.append([pid, p["name"], "/".join(teams), int(p["first"][:4]), int(p["last"][:4]),
                          mat, batting["runs"], bowling["wkts"], batting["balls"], bowling["balls"],
                          int(incomplete), int(intl and pid in self.afghans)])

            if pid in bat_vs:
                write_json(os.path.join(base, "matchups", "bat", pid + ".json"), bat_vs[pid])
            if pid in bowl_vs:
                write_json(os.path.join(base, "matchups", "bowl", pid + ".json"), bowl_vs[pid])

        index.sort(key=lambda r: (-r[5], r[1]))
        write_json(os.path.join(base, "players.json"), index)

        # Best partnerships overall (pairs with at least 5 stands), for the partnerships page
        top = []
        for (a, b), agg in self.partners.items():
            if agg["n"] >= 5:
                top.append([a, self.people[a]["name"], b, self.people[b]["name"], agg["team"], agg["n"], agg["runs"],
                            agg["broken"], agg["50"], agg["100"], agg["best"], int(a in flagged and b in flagged)])
        top.sort(key=lambda r: -r[6])
        write_json(os.path.join(base, "partnerships", "_top.json"), top[:200])

        # Fill in the country for chases where that match had no city recorded,
        # using the cities recorded for the same ground in other matches.
        for c in self.chases:
            if not c[2]:
                cities = self.venues.get(c[1], {}).get("cities", {})
                c[2] = VENUE_COUNTRY.get(c[1]) or next((CITY_COUNTRY[x] for x in cities if x in CITY_COUNTRY), None)
        missing = sorted({c[1] for c in self.chases if not c[2]})
        if missing:
            print("WARNING: no country known for these grounds (add them to COUNTRY_CITIES):", missing)
        if fmt_cfg.get("kind", "test") == "test":
            write_json(os.path.join(base, "chases.json"), self.chases)
        else:
            # White-ball chase calculator: the chases, plus every start-of-over position,
            # split by wickets in hand so the page only loads the file it needs.
            cutoff_c = self.coverage.get("complete_from")
            done = [m[7] is not None for m in self.chase_matches]
            rows = [m + [int(bool(cutoff_c) and m[0] < cutoff_c)] for m in self.chase_matches]
            write_json(os.path.join(base, "chase", "matches.json"), rows)
            for w in range(1, 11):
                write_json(os.path.join(base, "chase", "w%d.json" % w),
                           [st for st in self.chase_states.get(w, []) if done[st[0]]])

        # On this day: one small file per month (onthisday/01.json ... 12.json), newest first.
        # A match that runs across two months goes in both.
        months = defaultdict(list)
        for m in sorted(self.on_this_day, key=lambda m: -m["y"]):
            for mon in sorted({d[:2] for d in m["d"]}):
                months[mon].append(m)
        for mon in ["%02d" % i for i in range(1, 13)]:
            write_json(os.path.join(base, "onthisday", mon + ".json"), months.get(mon, []))

        # Top-order batting by year, for the era page
        write_json(os.path.join(base, "era.json"), [
            [y, v[0], v[1], v[2], v[3]] for y, v in sorted(self.year_top.items())])

        # Venues
        venues = []
        cutoff = self.coverage["complete_from"]
        for name, v in self.venues.items():
            city = v["cities"].most_common(1)[0][0] if v["cities"] else None
            entry = {
                "slug": slugify(name), "name": name, "nick": VENUE_NICKNAMES.get(name),
                "city": city, "first": v["first"], "last": v["last"],
                "incomplete": self.span_incomplete(v["first"], v["last"]),
                "recent": v["recent"][-5:][::-1],
            }
            # "all": every match in the data. "complete": only matches from the
            # years Cricsheet covers fully (null if there are none).
            entry.update(self.venue_stats(v["games"]))
            later = [g for g in v["games"] if cutoff and g["date"] >= cutoff]
            entry["complete"] = self.venue_stats(later) if entry["incomplete"] and later else None
            venues.append(entry)
        venues.sort(key=lambda x: (-x["matches"], x["name"]))
        write_json(os.path.join(base, "venues.json"), venues)

        meta = {
            "format": fmt_key, "label": fmt_cfg["label"], "matches": sum(v["matches"] for v in venues),
            "first": self.first_date, "last": self.last_date, "players": len(self.people),
            "venues": len(venues), "deliveries": self.deliveries,
            "built": datetime.datetime.utcnow().strftime("%Y-%m-%d"),
            "coverage": {k: self.coverage[k] for k in
                         ("complete_from", "windows", "years", "before_first", "missing", "withheld",
                          "method", "assoc_years", "other", "missing_list_ok")
                         if k in self.coverage},
        }
        if fmt_cfg.get("kind", "test") != "test":
            # Settings the pages need to explain themselves (Tests keep their stage 1-2 meta unchanged).
            meta["kind"] = fmt_cfg["kind"]
            meta["league"] = bool(fmt_cfg.get("league"))
            meta["period"] = "season" if fmt_cfg.get("league") else "year"
            meta["international"] = intl
            meta["coverage"]["team_missing"] = len(self.coverage.get("team_missing", []))
            meta["settings"] = {k: self.s[k] for k in ("nemesis_min_balls", "danger_zones", "dot_runs", "top_order",
                                                        "matchup_small", "matchup_tiny", "phases", "otd")}
        write_json(os.path.join(base, "meta.json"), meta)
        return meta, index, flagged

    # -- incomplete records --------------------------------------------------
    def span_incomplete(self, first, last, teams=None):
        """Could figures from first to last (for these teams, if known) be missing matches?"""
        cov = self.coverage
        if overlaps_incomplete(first, last, cov["windows"]):
            return True
        for d, mteams in cov.get("team_missing", []):
            if first <= d <= last and (teams is None or set(mteams) & teams):
                return True
        if cov.get("assoc_years") and not self.cfg.get("full_members_only"):
            if teams is None or teams - FULL_MEMBERS:
                if any(int(first[:4]) <= int(str(y)[:4]) <= int(last[:4]) for y in cov["assoc_years"]):
                    return True
        return False

    def is_incomplete(self, pid):
        p = self.people[pid]
        return self.span_incomplete(p["first"], p["last"], set(p["teams"]))

    def by_period(self, pid):
        """Year-by-year (or season-by-season) summary:
        [period, inns, runs, outs, balls, 4s, 6s, 50s, 100s, balls bowled, runs conceded, wickets]"""
        rows = defaultdict(lambda: [0] * 11)
        for i in self.bat_inns.get(pid, []):
            r = rows[i["per"]]
            r[0] += 1
            r[1] += i["r"]
            r[2] += i["out"]
            r[3] += i["b"]
            r[4] += i["4"]
            r[5] += i["6"]
            r[6] += 50 <= i["r"] < 100
            r[7] += i["r"] >= 100
        for i in self.bowl_inns.get(pid, []):
            r = rows[i["per"]]
            r[8] += i["b"]
            r[9] += i["r"]
            r[10] += i["w"]
        return [[per] + rows[per] for per in sorted(rows, key=str)]

    def phases(self, pid):
        """Powerplay / middle / death figures (white-ball only)."""
        if not self.s["phases"]:
            return None
        bat = self.phase_bat.get(pid)
        bowl = self.phase_bowl.get(pid)
        if not bat and not bowl:
            return None
        return {"bat": bat, "bowl": bowl}


# ---------------------------------------------------------------------------

def folder_size(path):
    total, biggest = 0, (0, "")
    for root, _, files in os.walk(path):
        for f in files:
            size = os.path.getsize(os.path.join(root, f))
            total += size
            biggest = max(biggest, (size, os.path.join(root, f)))
    return total, biggest


def main():
    parser = argparse.ArgumentParser(description="Build Cricket Lab data files from Cricsheet.")
    parser.add_argument("--raw-dir", help="already-unzipped Cricsheet folder for the one competition in --formats")
    parser.add_argument("--raw-root", help="folder with one unzipped folder per download (e.g. odis_male_json/)")
    parser.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "site", "data"))
    parser.add_argument("--formats", default=",".join(FORMATS), help="comma-separated, e.g. tests,ipl")
    parser.add_argument("--register", help="local copy of Cricsheet's people.csv (skips download)")
    args = parser.parse_args()
    cricinfo = load_register(args.register)
    afghans = load_afghanistan_ids(cricinfo)
    print("Afghanistan international players matched in Cricsheet's register: %d" % len(afghans))
    missing_lists = fetch_missing_lists()

    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)
    keys = args.formats.split(",")
    built, people = [], {}
    raw_dirs, tmp = {}, tempfile.mkdtemp(prefix="cricsheet-")
    try:
        for key in keys:
            cfg = FORMATS[key]
            # Raw downloads go in a temporary folder that is deleted afterwards, so they can
            # never end up in the repository. Competitions sharing a download reuse it.
            url = cfg["url"]
            if args.raw_dir:
                raw_dir = args.raw_dir
            elif args.raw_root:
                raw_dir = os.path.join(args.raw_root, os.path.basename(url)[:-4])
            elif url in raw_dirs:
                raw_dir = raw_dirs[url]
            else:
                raw_dir = raw_dirs[url] = download_and_unzip(url, tempfile.mkdtemp(dir=tmp))

            matches = load_matches(raw_dir, cfg["match_type"], cfg.get("team_type"))
            for m in matches:
                rename_teams(m, cfg.get("team_aliases"))
            # Coverage is worked out from every match in the download (for T20Is this
            # includes non-full-member matches, so the numbering can be checked).
            coverage = analyse_coverage(matches, raw_dir, cfg, missing_lists)
            if cfg.get("full_members_only"):
                matches = [m for m in matches if set(m["info"]["teams"]) <= FULL_MEMBERS]
            print("%s: %d matches; complete from %s; %d listed missing by Cricsheet, %d withheld"
                  % (cfg["label"], len(matches), coverage["complete_from"], coverage["missing"], coverage["withheld"]))
            b = Builder(key, cfg, coverage, cricinfo, afghans)
            for m in matches:
                b.add_match(m)
            meta, index, flagged = b.write(out_dir, key, cfg)
            built.append({"key": key, "label": cfg["label"], "kind": cfg.get("kind", "test"),
                          "league": bool(cfg.get("league"))})
            print("  ", json.dumps({k: v for k, v in meta.items() if k not in ("coverage", "settings")}))
            # Cross-competition search index (each competition's numbers stay separate).
            for row in index:
                pid, name, teams, y1, y2, mat = row[:6]
                p = people.setdefault(pid, {"name": name, "afg": pid in afghans, "fmt": {}, "y1": y1, "y2": y2,
                                            "team": None, "best": 0})
                p["name"] = name
                p["fmt"][key] = mat
                p["y1"], p["y2"] = min(p["y1"], y1), max(p["y2"], y2)
                if mat > p["best"]:
                    p["best"], p["team"] = mat, teams.split("/")[0]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    if set(keys) != set(FORMATS):
        # A partial rebuild (e.g. --formats ipl) leaves the shared files alone, so the
        # cross-competition search keeps every competition.
        print("Built only %s: formats.json and people.json left unchanged." % ",".join(keys))
        return
    write_json(os.path.join(out_dir, "formats.json"), built)
    # people.json: [id, name, Afghanistan player (1/0), main team, first year, last year,
    #               [matches in each competition, in the order of formats.json]]
    write_json(os.path.join(out_dir, "people.json"), sorted(
        ([pid, p["name"], int(p["afg"]), p["team"], p["y1"], p["y2"], [p["fmt"].get(k, 0) for k in keys]]
         for pid, p in people.items()), key=lambda r: -sum(r[6])))

    total, (big_size, big_file) = folder_size(out_dir)
    print("Data folder size: %.1f MB (largest file %.2f MB: %s)"
          % (total / 1e6, big_size / 1e6, os.path.relpath(big_file, out_dir)))
    if big_size > 25e6 or total > 100e6:
        sys.exit("Data is bigger than the limits we set (25 MB per file, 100 MB total).")


if __name__ == "__main__":
    main()

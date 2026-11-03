# Cricket Lab

A personal cricket stats website built from [Cricsheet](https://cricsheet.org/) ball-by-ball data
(used under the [ODC-By 1.0](https://opendatacommons.org/licenses/by/1-0/) licence).

**Stage 1:** men's Test matches, with player search, player pages, batter v bowler matchups and a venue guide.
**Stage 2:** nemesis finder, danger zone and pressure test on player pages; partnership finder; fourth-innings chase odds; era-adjusted comparison.
**Stage 3:** men's ODIs, T20 internationals (full members only / all teams), the BBL and the IPL, each kept completely separate; white-ball chase calculator; powerplay/middle/death phase stats; season filters; Afghanistan notes.

## How it works

1. A GitHub Actions workflow (`.github/workflows/build.yml`) runs every Monday, on every push, and when you press **Run workflow**.
2. It runs `scripts/build_data.py`, which downloads each competition's Cricsheet data to a temporary folder, crunches it, and writes small JSON files into `site/data/<competition>/` (tests, odis, t20is, t20is_all, bbl, ipl). It also reads Cricsheet's player register and its list of missing matches, and Wikidata for Afghanistan players.
3. The `site/` folder (plain HTML, CSS and JavaScript) is published with GitHub Pages.

The raw downloads and `site/data/` are never committed; they're rebuilt every run.

## Folder layout

```
.github/workflows/build.yml   the weekly robot
scripts/build_data.py         turns Cricsheet data into summary files
scripts/afghanistan_players.csv  Afghanistan international players (ESPNcricinfo IDs), see About page
site/                         the website
  index.html                  player search (home)
  player.html                 player page
  matchups.html               batter v bowler
  partnerships.html           partnership finder
  chases.html                 fourth-innings chase odds (Tests) / chase calculator (white-ball)
  era.html                    era-adjusted comparison
  venues.html                 venue guide
  about.html                  data source, coverage, definitions
  css/style.css               all the styling (light and dark mode)
  js/                         page code (common.js is shared by every page)
  data/<format>/              generated: players.json, players/<id>.json,
                              matchups/bat|bowl/<id>.json, partnerships/<id>.json,
                              venues.json, chases.json, era.json, meta.json,
                              onthisday/01.json … 12.json (home page "On this day"),
                              chase/matches.json + chase/w1..w10.json (white-ball only)
  data/people.json            every player in every competition, for search
```

## Preview on your computer

```bash
python3 scripts/build_data.py
python3 -m http.server 8000 --directory site
```

Then open http://localhost:8000. (Don't upload the `site/data` folder this creates; GitHub builds its own.)

## Adding a competition later

Add an entry to `FORMATS` at the top of `scripts/build_data.py` (its Cricsheet download, match type and kind),
and to `FORMATS` at the top of `site/js/common.js` (its label and which tab it sits under).

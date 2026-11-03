/* Cricket Lab: shared code used by every page.
   - builds the header (navigation, competition switcher, light/dark button) and footer
   - loads data files for the chosen competition (every competition has its own data folder,
     so figures never mix competitions)
   - player search that understands Cricsheet names like "SPD Smith"
*/
(function () {
  "use strict";

  // The competitions. "group" is the top-level tab (Tests | ODIs | T20); T20 has sub-tabs.
  // t20is and t20is_all are the same competition: full-member nations only, or every team.
  var FORMATS = {
    tests: { label: "Tests", group: "tests", kind: "test", intl: true, noun: "Test", nouns: "Tests" },
    odis: { label: "ODIs", group: "odis", kind: "odi", intl: true, noun: "ODI", nouns: "ODIs" },
    t20is: { label: "T20Is", group: "t20", kind: "t20", intl: true, full: true, noun: "T20I", nouns: "T20Is" },
    t20is_all: { label: "T20Is", group: "t20", kind: "t20", intl: true, full: false, noun: "T20I", nouns: "T20Is" },
    bbl: { label: "BBL", group: "t20", kind: "t20", league: true, noun: "BBL match", nouns: "BBL matches" },
    ipl: { label: "IPL", group: "t20", kind: "t20", league: true, noun: "IPL match", nouns: "IPL matches" }
  };
  var ORDER = ["tests", "odis", "t20is", "t20is_all", "bbl", "ipl"];

  var params = new URLSearchParams(location.search);
  var CL = (window.CL = {});
  CL.FORMATS = FORMATS;
  CL.ORDER = ORDER;

  // The chosen competition comes from the address (?f=ipl), or the last one you chose.
  function saved(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (e) { return null; }
  }
  CL.format = FORMATS[params.get("f")] ? params.get("f") : (FORMATS[saved("cl-format")] ? saved("cl-format") : "tests");
  saved("cl-format", CL.format);
  CL.F = FORMATS[CL.format];
  CL.params = params;
  // "season" for the BBL and IPL, "year" for internationals
  CL.periodWord = CL.F.league ? "season" : "year";

  // Thresholds and settings for this kind of cricket (Tests use the stage 1-2 values).
  var TEST_SETTINGS = {
    nemesis_min_balls: 120, danger_zones: [[1, 10], [11, 25], [26, 50], [51, 100], [101, null]], dot_runs: [3, 5, 8],
    top_order: 6, matchup_small: 120, matchup_tiny: 30, phases: null,
    otd: { bat: 100, bowl: 5, big_chase: 250, big_win_runs: 250 }
  };

  // ---------- small helpers ----------
  CL.$ = function (sel, root) { return (root || document).querySelector(sel); };
  CL.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  // Show a number, or a dash when there isn't one (e.g. average with no dismissals).
  CL.n = function (v, digits) {
    if (v == null || isNaN(v)) return "–";
    if (digits != null) return Number(v).toFixed(digits);
    return Number(v).toLocaleString("en-GB");
  };
  CL.pct = function (a, b, digits) {
    if (!b) return "–";
    return (a * 100 / b).toFixed(digits == null ? 0 : digits) + "%";
  };
  CL.date = function (iso) {
    var d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  };
  // Partnerships: average stand (runs per partnership ended by a wicket) and best stand (* = unbroken).
  CL.standAvg = function (runs, broken) { return broken ? (runs / broken).toFixed(1) : "–"; };
  CL.bestStand = function (b) { return b ? b[0] + (b[1] ? "*" : "") : "–"; };
  // How we describe when matches are missing: Tests have one early patchy period;
  // other competitions can be missing the odd match at any time.
  CL.gapWhen = function (completeFrom) {
    return CL.F.kind === "test" && completeFrom ? "before " + CL.date(completeFrom) + ", when Cricsheet is missing some Tests"
      : "at times when Cricsheet is missing some " + CL.F.nouns;
  };
  // "1 Test", "12 IPL matches" (short form used in lists)
  CL.matchWord = function (n) { return CL.F.league ? (n === 1 ? "match" : "matches") : (n === 1 ? CL.F.noun : CL.F.nouns); };
  CL.overs = function (balls) { return Math.floor(balls / 6) + (balls % 6 ? "." + (balls % 6) : ""); };

  // Build a link that keeps the current competition.
  CL.link = function (page, extra, fmt) {
    var p = new URLSearchParams();
    p.set("f", fmt || CL.format);
    Object.keys(extra || {}).forEach(function (k) { if (extra[k] != null) p.set(k, extra[k]); });
    var q = p.toString();
    return page + (q ? "?" + q : "");
  };

  // ---------- data loading ----------
  var cache = {};
  CL.load = function (path, fmt) {
    var url = "data/" + (fmt || CL.format) + "/" + path;
    if (!cache[url]) {
      cache[url] = fetch(url).then(function (r) {
        if (!r.ok) throw new Error("Not found: " + url);
        return r.json();
      });
    }
    return cache[url];
  };

  // The player list is an array of arrays to keep it small; turn each into an object.
  CL.players = function () {
    if (!CL._players) {
      CL._players = CL.load("players.json").then(function (rows) {
        var byId = {};
        var list = rows.map(function (r) {
          var p = {
            id: r[0], name: r[1], teams: r[2], from: r[3], to: r[4],
            matches: r[5], runs: r[6], wkts: r[7], batBalls: r[8], bowlBalls: r[9], incomplete: !!r[10], afg: !!r[11]
          };
          p.words = prepareName(p.name);
          byId[p.id] = p;
          return p;
        });
        list.byId = byId;
        return list;
      });
    }
    return CL._players;
  };

  // Every player in every competition, for the search on the home page.
  // people.json rows: [id, name, Afghanistan player, main team, first year, last year, [matches per competition]]
  CL.people = function () {
    if (!CL._people) {
      CL._people = Promise.all([
        fetch("data/people.json").then(function (r) { return r.json(); }),
        fetch("data/formats.json").then(function (r) { return r.json(); })
      ]).then(function (res) {
        var keys = res[1].map(function (f) { return f.key; });
        var byId = {};
        var list = res[0].map(function (r) {
          var m = {};
          keys.forEach(function (k, i) { if (r[6][i]) m[k] = r[6][i]; });
          var p = { id: r[0], name: r[1], afg: !!r[2], teams: r[3] || "", from: r[4], to: r[5], counts: m };
          p.matches = m[CL.format] || 0;
          p.total = r[6].reduce(function (a, b) { return a + b; }, 0);
          p.words = prepareName(p.name);
          byId[p.id] = p;
          return p;
        });
        list.byId = byId;
        return list;
      });
    }
    return CL._people;
  };

  // Which competitions a player (from CL.people) has played, as small links.
  // The T20I "all teams" count stands in for T20Is, so each competition shows once.
  CL.competitionLinks = function (p, page, extra) {
    return ORDER.filter(function (k) { return k !== "t20is_all" && (p.counts[k] || (k === "t20is" && p.counts.t20is_all)); })
      .map(function (k) {
        var key = k === "t20is" && !p.counts.t20is ? "t20is_all" : k;
        // T20I count: full members only when that's the view, otherwise all teams.
        var n = k === "t20is" ? (CL.format === "t20is" && p.counts.t20is ? p.counts.t20is : p.counts.t20is_all || p.counts.t20is) : p.counts[k];
        var here = key === CL.format || (k === "t20is" && FORMATS[CL.format].group === "t20" && !FORMATS[CL.format].league);
        return '<a class="chip' + (here ? " chip-on" : "") + '" href="' + CL.link(page, extra, key) + '">' +
          FORMATS[k].label + ' <span class="muted">' + n + "</span></a>";
      }).join("");
  };

  // ---------- player search ----------
  // Cricsheet stores names as initials + surname ("SPD Smith", "V Kohli").
  // We match each word you type against the name's words. If you type a first
  // name ("Steve"), we also accept a matching initial ("S"), as long as another
  // word (like the surname) matched properly.
  function plain(s) {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.'’-]/g, "").toLowerCase();
  }
  function prepareName(name) {
    var parts = name.split(/\s+/);
    var initials = "";
    if (parts.length > 1 && /^[A-Z]{1,4}$/.test(parts[0])) initials = parts[0].toLowerCase();
    return { words: parts.map(plain), full: plain(name).replace(/\s+/g, ""), initials: initials };
  }

  CL.search = function (query, list, limit) {
    var tokens = plain(query).split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    var out = [];
    list.forEach(function (p) {
      var w = p.words, score = 0, strict = 0, ok = true;
      for (var i = 0; i < tokens.length && ok; i++) {
        var t = tokens[i], s = 0;
        for (var j = 0; j < w.words.length; j++) {
          if (w.words[j] === t) s = Math.max(s, 3);
          else if (w.words[j].indexOf(t) === 0) s = Math.max(s, 2);
        }
        if (!s && t.length >= 3 && w.full.indexOf(t) >= 0) s = 1;
        if (s) strict++;
        if (!s && w.initials) {
          if (w.initials[0] === t[0]) s = 0.8;               // first name -> first initial
          else if (w.initials.indexOf(t[0]) > 0) s = 0.4;    // middle name -> other initial
        }
        if (!s) ok = false;
        score += s;
      }
      if (ok && strict > 0) out.push({ p: p, score: score });
    });
    out.sort(function (a, b) { return b.score - a.score || b.p.matches - a.p.matches || (b.p.total || 0) - (a.p.total || 0); });
    return out.slice(0, limit || 20).map(function (x) { return x.p; });
  };

  CL.playerMeta = function (p) {
    return CL.esc(p.teams) + " · " + (p.from === p.to ? p.from : p.from + "–" + p.to);
  };

  // ---------- coverage markers ----------
  // Players, matchups and grounds whose figures include periods where Cricsheet
  // is missing matches get an "Incomplete record" badge and † markers.
  CL.GAP_TIP = "Some of this player’s " + CL.F.nouns + " aren’t in Cricsheet, so totals may be lower than official figures.";
  // Afghanistan's men's internationals are withheld by Cricsheet (their league matches are included).
  CL.AFG_TIP = "Afghanistan’s international matches aren’t available in Cricsheet, so these figures are missing or incomplete.";
  CL.afgBadge = function () { return CL.badge(CL.AFG_TIP, "Afghanistan: internationals missing"); };
  // A badge you can hover (computer) or tap (phone) to read the explanation.
  CL.badge = function (tip, label) {
    return '<span class="gap-badge" tabindex="0" role="note" aria-label="' + CL.esc((label || "Incomplete record") + ": " + (tip || CL.GAP_TIP)) +
      '" data-tip="' + CL.esc(tip || CL.GAP_TIP) + '">' + CL.esc(label || "Incomplete record") + "</span>";
  };
  // Small † after a number that may be understated.
  CL.mark = function (on, tip) {
    if (!on) return "";
    return '<sup class="gap-mark" title="' + CL.esc(tip || "May be lower than the official figure: some matches aren’t in Cricsheet") + '">†</sup>';
  };
  // Tapping a badge inside a link shows its explanation instead of following the link.
  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest(".gap-badge") && e.target.closest("a")) e.preventDefault();
  });

  // A search box that shows a dropdown of players and calls onPick(player).
  // filter(p) can hide players (e.g. only bowlers).
  CL.playerPicker = function (input, list, onPick, filter) {
    var box = document.createElement("ul");
    box.className = "results dropdown";
    box.hidden = true;
    input.parentNode.appendChild(box);
    var current = [], active = -1;

    function render() {
      var q = input.value.trim();
      current = q ? CL.search(q, filter ? list.filter(filter) : list, 12) : [];
      active = current.length ? 0 : -1;
      if (!q) { box.hidden = true; return; }
      box.innerHTML = current.length ? current.map(function (p, i) {
        return '<li><button type="button" data-i="' + i + '" class="' + (i === active ? "active" : "") + '">' +
          '<span><span class="name">' + CL.esc(p.name) + "</span>" + (p.incomplete ? " " + CL.badge() : "") +
          (p.afg ? " " + CL.afgBadge() : "") + '<br><span class="meta">' + CL.playerMeta(p) + '</span></span>' +
          '<span class="figs">' + p.matches + " " + CL.matchWord(p.matches) + "</span></button></li>";
      }).join("") : '<li class="empty small">No matching players</li>';
      box.hidden = false;
    }
    function pick(i) {
      if (!current[i]) return;
      box.hidden = true;
      onPick(current[i]);
    }
    input.addEventListener("input", render);
    input.addEventListener("focus", render);
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!current.length) return;
        active = (active + (e.key === "ArrowDown" ? 1 : -1) + current.length) % current.length;
        Array.prototype.forEach.call(box.querySelectorAll("button"), function (b, i) { b.classList.toggle("active", i === active); });
      } else if (e.key === "Enter") {
        e.preventDefault();
        pick(active);
      } else if (e.key === "Escape") {
        box.hidden = true;
      }
    });
    box.addEventListener("mousedown", function (e) {
      var b = e.target.closest("button");
      if (b) { e.preventDefault(); pick(+b.dataset.i); }
    });
    input.addEventListener("blur", function () { setTimeout(function () { box.hidden = true; }, 150); });
  };

  // ---------- light / dark ----------
  function savedTheme() { try { return localStorage.getItem("cl-theme"); } catch (e) { return null; } }
  function applyTheme(t) {
    if (t) document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
  }
  applyTheme(savedTheme());
  function isDark() {
    var t = document.documentElement.getAttribute("data-theme");
    if (t) return t === "dark";
    return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
  }

  // ---------- header & footer ----------
  function header(active) {
    var nav = [
      ["index.html", "Players"], ["matchups.html", "Matchups"], ["partnerships.html", "Partnerships"],
      ["venues.html", "Venues"], ["chases.html", "Chase odds"], ["era.html", "Eras"], ["about.html", "About"]
    ].map(function (n) {
      return '<a href="' + CL.link(n[0]) + '"' + (n[0] === active ? ' aria-current="page"' : "") + ">" + n[1] + "</a>";
    }).join("");
    return '<div class="wrap">' +
      '<a class="brand" href="' + CL.link("index.html") + '"><span class="brand-mark">CL</span>Cricket Lab</a>' +
      '<nav class="nav" aria-label="Main">' + nav + "</nav>" +
      '<div class="tools"><div class="formats" id="formats" role="tablist" aria-label="Competition"></div>' +
      '<button class="icon-btn" id="theme-btn" type="button" aria-label="Switch light or dark mode"></button></div>' +
      '<div class="subformats" id="subformats"></div>' +
      "</div>";
  }

  // Same page, different competition (keeping the rest of the address, e.g. the player).
  function switchHref(key) {
    var p = new URLSearchParams(location.search);
    p.set("f", key);
    p.delete("day");
    return location.pathname.split("/").pop() + "?" + p.toString();
  }

  function fillFormats(available) {
    var has = {};
    available.forEach(function (f) { has[f.key] = true; });
    var cur = CL.F;
    function tab(key, label, on) {
      if (!has[key]) return '<span class="soon">' + label + "</span>";
      return '<a href="' + switchHref(key) + '"' + (on ? ' class="active" aria-current="true"' : "") + ">" + label + "</a>";
    }
    // Top row: Tests | ODIs | T20 (T20 opens on T20Is, full members).
    var t20Default = has.t20is ? "t20is" : has.bbl ? "bbl" : "ipl";
    CL.$("#formats").innerHTML = '<span class="label">Format</span>' + tab("tests", "Tests", cur.group === "tests") +
      tab("odis", "ODIs", cur.group === "odis") + tab(t20Default, "T20", cur.group === "t20");
    var sub = "";
    if (cur.group === "t20") {
      sub = '<div class="formats small-tabs" aria-label="T20 competition">' +
        tab(CL.format === "t20is_all" ? "t20is_all" : "t20is", "T20Is", !cur.league) + tab("bbl", "BBL", CL.format === "bbl") +
        tab("ipl", "IPL", CL.format === "ipl") + "</div>";
      if (!cur.league) {
        sub += '<div class="formats small-tabs" aria-label="Which teams">' + tab("t20is", "Full member nations only", CL.format === "t20is") +
          tab("t20is_all", "All teams", CL.format === "t20is_all") + "</div>";
      }
    }
    CL.$("#subformats").innerHTML = sub;
    CL.$("#subformats").hidden = !sub;
  }

  function footer(meta) {
    var complete = meta && meta.coverage && meta.coverage.complete_from;
    var patchy = complete && meta.first && complete > meta.first;
    var coverage = meta
      ? "You’re viewing men’s " + CL.esc(meta.label) + ": " + CL.n(meta.matches) + " matches from " + CL.date(meta.first) +
        " to " + CL.date(meta.last) + (patchy ? "; coverage is patchy before " + CL.date(complete) : "") +
        ". Figures that may be missing matches are marked “Incomplete record” or †. Data last refreshed " + CL.date(meta.built) + "."
      : "";
    if (CL.F.intl) {
      coverage += " Cricsheet withholds Afghanistan’s international matches, so matches against Afghanistan aren’t included.";
    }
    return '<div class="wrap">' +
      '<p><strong>Data:</strong> ball-by-ball data from <a href="https://cricsheet.org/" rel="noopener">Cricsheet</a>, ' +
      'made available under the <a href="https://opendatacommons.org/licenses/by/1-0/" rel="noopener">Open Data Commons Attribution License (ODC-By 1.0)</a>. ' +
      "Cricket Lab has processed it into summaries and is not affiliated with Cricsheet.</p>" +
      "<p><strong>Coverage:</strong> Cricsheet's ball-by-ball records only go back so far (and some matches are missing or withheld), " +
      "so career figures here only count matches Cricsheet has and can differ from official records. " + coverage +
      ' <a href="' + CL.link("about.html") + '">More about the data</a>.</p>' +
      "</div>";
  }

  CL.init = function (active) {
    var h = document.createElement("header");
    h.className = "site-header";
    h.innerHTML = header(active);
    document.body.insertBefore(h, document.body.firstChild);
    var f = document.createElement("footer");
    f.className = "site-footer";
    f.innerHTML = footer(null);
    document.body.appendChild(f);

    var btn = CL.$("#theme-btn");
    function setIcon() { btn.textContent = isDark() ? "☀︎" : "☾"; }
    setIcon();
    btn.addEventListener("click", function () {
      var next = isDark() ? "light" : "dark";
      applyTheme(next);
      try { localStorage.setItem("cl-theme", next); } catch (e) { /* private mode: just don't remember */ }
      setIcon();
    });
    if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener("change", setIcon);

    fetch("data/formats.json").then(function (r) { return r.json(); })
      .then(fillFormats)
      .catch(function () { fillFormats([{ key: "tests", label: "Tests" }]); });

    CL.meta = CL.load("meta.json").then(function (meta) {
      f.innerHTML = footer(meta);
      return meta;
    }).catch(function () {
      return null;
    });
    CL.settings = CL.meta.then(function (meta) { return (meta && meta.settings) || TEST_SETTINGS; });
  };

  CL.fail = function (el, err) {
    el.innerHTML = '<div class="notice">Sorry, that data couldn’t be loaded. ' + CL.esc(err && err.message) + "</div>";
  };
})();

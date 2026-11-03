/* Player page: career summary, recent form, dismissals, nineties and conversion. */
(function () {
  "use strict";
  CL.init("index.html");
  var page = CL.$("#page");
  var id = CL.params.get("id");
  if (!id) {
    page.innerHTML = '<p class="empty">No player chosen. <a href="' + CL.link("index.html") + '">Search for one</a>.</p>';
    return;
  }

  var esc = CL.esc, n = CL.n;
  var white = CL.F.kind !== "test";   // white-ball: strike rate and economy matter most
  var gap = false;          // true when this player's record may be incomplete
  var completeFrom = null;  // date from which Cricsheet has (almost) every match

  // † after totals that may be understated.
  function m() { return CL.mark(gap); }
  var KEY = '<p class="gap-key"><sup class="gap-mark">†</sup> May be lower than the official figure, because some of this player’s ' + CL.F.nouns + ' aren’t in Cricsheet. ' +
    "Averages and rates only use the matches here, so they may differ from official figures too.</p>";

  function stat(label, value, cls) {
    return '<div class="stat ' + (cls || "") + '"><div class="v">' + value + '</div><div class="k">' + label + "</div></div>";
  }

  // Group Cricsheet's dismissal types into everyday names.
  var HOW = [
    ["Caught", ["caught"]],
    ["Caught & bowled", ["caught and bowled"]],
    ["Bowled", ["bowled"]],
    ["LBW", ["lbw"]],
    ["Run out", ["run out"]],
    ["Stumped", ["stumped"]],
    ["Hit wicket", ["hit wicket"]]
  ];
  function howOut(counts) {
    var known = {}, rows = [];
    HOW.forEach(function (h) {
      var c = 0;
      h[1].forEach(function (k) { c += counts[k] || 0; known[k] = 1; });
      rows.push([h[0], c]);
    });
    var other = 0;
    Object.keys(counts).forEach(function (k) { if (!known[k]) other += counts[k]; });
    if (other) rows.push(["Other", other]);
    return rows.filter(function (r) { return r[1] > 0; }).sort(function (a, b) { return b[1] - a[1]; });
  }

  function bars(rows, total) {
    var max = Math.max.apply(null, rows.map(function (r) { return r[1]; }).concat([1]));
    return '<div class="bars">' + rows.map(function (r) {
      return '<div class="bar-row"><span>' + esc(r[0]) + '</span><div class="bar-track"><div class="bar-fill" style="width:' +
        (r[1] * 100 / max) + '%"></div></div><span class="val">' + r[1] + " · " + CL.pct(r[1], total) + "</span></div>";
    }).join("") + "</div>";
  }

  function battingSection(p) {
    var b = p.batting;
    if (!b.inns) return "";
    var hs = b.hs == null ? "–" : b.hs + (b.hs_no ? "*" : "");
    return '<section class="card section"><h2>Batting</h2>' +
      '<p class="explain">Average = runs ÷ times out. Strike rate = runs per 100 balls faced. * means not out.' +
      (white ? " In " + CL.F.label + " scoring speed matters as much as the average, so strike rate is shown up front." : "") + "</p>" +
      '<div class="stats">' +
      stat("Innings", b.inns + m()) + stat("Not outs", b.no + m()) + stat("Runs", n(b.runs) + m(), "big") +
      (white ? stat("Strike rate", n(b.sr, 1), "big") + stat("Average", n(b.avg, 2), "big")
        : stat("Average", n(b.avg, 2), "big") + stat("Strike rate", n(b.sr, 1))) + stat("Highest", hs + m()) +
      stat("100s", b["100"] + m()) + stat("50s", b["50"] + m()) + stat("Ducks", b["0"] + m()) +
      stat("4s", n(b["4"]) + m()) + stat("6s", n(b["6"]) + m()) + stat("Balls faced", n(b.balls) + m()) +
      "</div>" + (gap ? KEY : "") + "</section>";
  }

  function bowlingSection(p) {
    var w = p.bowling;
    if (!w.balls) return "";
    var best = function (f) { return f ? f[0] + "/" + f[1] : "–"; };
    return '<section class="card section"><h2>Bowling</h2>' +
      '<p class="explain">Average = runs conceded per wicket. Economy = runs per over. Strike rate = balls per wicket. ' +
      'Best innings and best match are shown as wickets/runs.</p>' +
      '<div class="stats">' +
      stat("Innings", w.inns + m()) + stat("Overs", CL.overs(w.balls) + m()) + stat("Wickets", n(w.wkts) + m(), "big") +
      (white ? stat("Economy", n(w.econ, 2), "big") + stat("Average", n(w.avg, 2)) : stat("Average", n(w.avg, 2), "big") + stat("Economy", n(w.econ, 2))) +
      stat("Strike rate", n(w.sr, 1)) +
      stat("Best innings", best(w.bbi) + m()) + (white ? "" : stat("Best match", best(w.bbm) + m())) + stat("5 wkts in inns", w["5w"] + m()) +
      (white ? "" : stat("10 wkts in match", w["10w"] + m())) + stat("Maidens", n(w.maidens) + m()) + stat("Runs conceded", n(w.runs) + m()) +
      "</div>" + (gap ? KEY : "") + "</section>";
  }

  // These innings include the years where Cricsheet is missing Tests, so there may be gaps between them.
  function patchyNote(f) {
    var old = completeFrom && f.some(function (i) { return i.date < completeFrom; });
    return old ? '<div class="notice">Some of these innings are from before ' + CL.date(completeFrom) +
      ", when Cricsheet is missing some " + CL.F.nouns + ", so a few of this player’s innings from that time may not appear.</div>" : "";
  }

  function formBatting(p) {
    var f = p.form_bat;
    if (!f.length) return "";
    var chron = f.slice().reverse();
    var max = Math.max.apply(null, chron.map(function (i) { return i.r; }).concat([50]));
    var total = 0, outs = 0;
    f.forEach(function (i) { total += i.r; outs += i.out ? 1 : 0; });
    var chart = '<div class="cols" aria-hidden="true">' + chron.map(function (i) {
      return '<div class="col" title="' + esc(i.r + (i.out ? "" : "*") + " v " + i.opp + ", " + CL.date(i.date)) + '">' +
        '<span class="lbl">' + i.r + (i.out ? "" : "*") + '</span><div class="bar' + (i.out ? "" : " no") +
        '" style="height:' + (i.r * 100 / max) + '%"></div></div>';
    }).join("") + "</div>";
    var rows = f.map(function (i) {
      var how = i.out ? esc(i.how) + (i.by ? " · " + esc(i.by) : "") : "not out";
      return "<tr><td>" + CL.date(i.date) + "</td><td>v " + esc(i.opp) + '</td><td class="r"><strong>' + i.r + (i.out ? "" : "*") +
        '</strong></td><td class="r">' + i.b + "</td><td>" + how + '</td><td class="muted">' + esc(i.venue) + "</td></tr>";
    }).join("");
    return '<section class="card section"><h2>Recent form: last ' + f.length + " innings</h2>" + patchyNote(f) +
      '<p class="explain">Oldest on the left, newest on the right. Orange bars were not out. ' +
      n(total) + " runs in these innings, average " + (outs ? (total / outs).toFixed(1) : "–") + ".</p>" + chart +
      '<div class="table-wrap section"><table><thead><tr><th>Date</th><th>Opponent</th><th class="r">Runs</th><th class="r">Balls</th><th>How out</th><th>Ground</th></tr></thead><tbody>' +
      rows + "</tbody></table></div></section>";
  }

  function formBowling(p) {
    var f = p.form_bowl;
    if (!f.length) return "";
    var rows = f.map(function (i) {
      return "<tr><td>" + CL.date(i.date) + "</td><td>v " + esc(i.opp) + '</td><td class="r">' + i.o + '</td><td class="r">' + i.r +
        '</td><td class="r"><strong>' + i.w + '</strong></td><td class="muted">' + esc(i.venue) + "</td></tr>";
    }).join("");
    return '<section class="card section"><h2>Recent bowling: last ' + f.length + " innings</h2>" + patchyNote(f) +
      '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Opponent</th><th class="r">Overs</th><th class="r">Runs</th><th class="r">Wkts</th><th>Ground</th></tr></thead><tbody>' +
      rows + "</tbody></table></div></section>";
  }

  function dismissalSection(p) {
    var rows = howOut(p.how_out);
    var outs = rows.reduce(function (s, r) { return s + r[1]; }, 0);
    if (!outs) return "";
    var by = p.dismissed_by.length ? '<h3 class="section">Dismissed most often by</h3><div class="chips">' +
      p.dismissed_by.map(function (d) {
        return '<a class="chip" href="' + CL.link("matchups.html", { bat: p.id, bowl: d[0] }) + '">' + esc(d[1]) +
          ' <span class="muted">' + d[2] + "×" + m() + "</span></a>";
      }).join("") + "</div>" : "";
    return '<section class="card"><h2>How they get out</h2>' +
      '<p class="explain">All ' + outs + m() + " times they were out in the data, by type of dismissal." +
      (gap ? " Counts may be lower than official figures, but the mix is usually a fair guide." : "") + "</p>" +
      bars(rows, outs) + by + "</section>";
  }

  function milestoneSection(p) {
    var nn = p.nineties, c = p.conversion;
    if (!p.batting.inns) return "";
    var ninety = nn.reached
      ? "Reached 90 in " + nn.reached + m() + " innings and was out in the 90s " + nn.out + " time" + (nn.out === 1 ? "" : "s") +
        (nn.not_out ? " (plus " + nn.not_out + " not out in the 90s)" : "") + "."
      : "Never reached 90 in the data.";
    var conv = c.fifties + c.hundreds
      ? "Of " + (c.fifties + c.hundreds) + m() + " innings of 50 or more, " + c.hundreds + m() + " went on to 100."
      : "No scores of 50 or more yet.";
    return '<section class="card"><h2>Milestones</h2>' +
      '<div class="grid grid-2" style="gap:10px">' +
      '<div><div class="stats">' + stat("Nervous nineties", nn.rate == null ? "–" : nn.rate + "%", "big") + "</div>" +
      '<p class="explain" style="margin-top:8px">How often they were out between 90 and 99, out of all innings where they reached 90. ' + ninety + "</p></div>" +
      '<div><div class="stats">' + stat("50 → 100 conversion", c.rate == null ? "–" : c.rate + "%", "big") + "</div>" +
      '<p class="explain" style="margin-top:8px">The share of half-centuries that became centuries. ' + conv + "</p></div>" +
      "</div>" + (gap ? '<p class="gap-key">Based only on the innings in the data, so these rates may differ from official figures.</p>' : "") +
      "</section>";
  }

  function victimsSection(p) {
    if (!p.victims.length) return "";
    return '<section class="card section"><h2>Favourite victims</h2><p class="explain">Batters this bowler has dismissed most often. Tap one to see the full head-to-head.</p><div class="chips">' +
      p.victims.map(function (d) {
        return '<a class="chip" href="' + CL.link("matchups.html", { bat: d[0], bowl: p.id }) + '">' + esc(d[1]) +
          ' <span class="muted">' + d[2] + "×" + m() + "</span></a>";
      }).join("") + "</div></section>";
  }

  // Header for this player across competitions: which ones they've played (each shown separately).
  function competitions(person) {
    if (!person) return "";
    return '<div class="chips" style="margin-top:0">' + CL.competitionLinks(person, "player.html", { id: id }) + "</div>";
  }
  function afghanNote(person) {
    return person && person.afg && CL.F.intl ? '<div class="notice"><strong>Afghanistan player.</strong> ' + CL.AFG_TIP +
      " Their IPL and BBL records (where they’ve played) are complete as normal.</div>" : "";
  }

  // A player with no matches in this competition: say so, and link to the ones they have played.
  function notHere(person) {
    if (!person) {
      page.innerHTML = '<p class="empty">Player not found. <a href="' + CL.link("index.html") + '">Search for one</a>.</p>';
      return;
    }
    document.title = person.name + " – Cricket Lab";
    page.innerHTML = '<section class="hero"><p class="muted small" style="margin:0"><a href="' + CL.link("index.html") + '">← Players</a></p>' +
      "<h1>" + esc(person.name) + (person.afg && CL.F.intl ? CL.afgBadge() : "") + "</h1>" + competitions(person) +
      '<div class="card section"><p style="margin:0">' + esc(person.name) + " has no men’s " + esc(CL.F.label) +
      (CL.format === "t20is" && person.counts.t20is_all ? " between full-member nations" : "") +
      " in the data. Choose one of their competitions above.</p></div>" + afghanNote(person) + "</section>";
  }

  Promise.all([
    CL.load("players/" + encodeURIComponent(id) + ".json").catch(function () { return null; }),
    CL.meta, CL.settings, CL.people().catch(function () { return null; })
  ]).then(function (res) {
    var p = res[0], meta = res[1], settings = res[2], person = res[3] && res[3].byId[id];
    if (!p) return notHere(person);
    gap = !!p.incomplete;
    completeFrom = meta && meta.coverage ? meta.coverage.complete_from : null;
    document.title = p.name + " – Cricket Lab";
    // Mostly a bowler? Show bowling first.
    var bowlerFirst = p.bowling.wkts * 20 > p.batting.runs;
    var years = p.first.slice(0, 4) === p.last.slice(0, 4) ? p.first.slice(0, 4) : p.first.slice(0, 4) + "–" + p.last.slice(0, 4);
    var html = '<section class="hero"><p class="muted small" style="margin:0"><a href="' + CL.link("index.html") + '">← Players</a></p>' +
      "<h1>" + esc(p.name) + (gap ? CL.badge() : "") + (p.afghanistan ? CL.afgBadge() : "") + "</h1>" + competitions(person) +
      '<p class="lede" style="margin-bottom:6px">' + esc(p.teams.join(" / ")) + " · " + p.matches + m() + " " + CL.matchWord(p.matches) +
      " in the data (" + years + ")</p>" +
      '<p class="muted small">First match here: ' + CL.date(p.first) + " · Latest: " + CL.date(p.last) +
      '. <a href="' + CL.link("matchups.html", p.batting.inns ? { bat: p.id } : { bowl: p.id }) + '">See their matchups →</a>' +
      (p.cricinfo ? ' · <a class="ext-link" href="https://www.espncricinfo.com/cricketers/player-' + encodeURIComponent(p.cricinfo) +
        '" target="_blank" rel="noopener">Official ESPNcricinfo profile ↗</a>' : "") + "</p>" +
      (gap ? '<div class="notice"><strong>Incomplete record.</strong> This player played during ' +
        (CL.F.kind === "test" ? (completeFrom ? "the years before " + CL.date(completeFrom) : "years") + ", when Cricsheet is missing some Tests " +
        "(and its records start in December 2001)" : "a period when Cricsheet is missing some " + CL.F.nouns + " their team played") +
        ", so the totals below may be lower than their official figures. Numbers that may be understated are marked †." +
        (p.cricinfo ? " Their full official record is on ESPNcricinfo." : "") + "</div>" : "") +
      (p.afghanistan ? afghanNote({ afg: true }) : "") + "</section>";
    var bat = battingSection(p), bowl = bowlingSection(p);
    html += bowlerFirst ? bowl + bat : bat + bowl;
    html += '<div class="grid grid-2 section">' + dismissalSection(p) + milestoneSection(p) + "</div>";
    var ctx = { gap: gap, completeFrom: completeFrom, bowlerFirst: bowlerFirst, settings: settings };
    html += CL.insights.seasons(p, ctx);
    html += CL.insights.phases(p, ctx);
    var zones = CL.insights.danger(p, ctx) + CL.insights.pressure(p, ctx);
    zones = zones ? '<div class="grid grid-2 section">' + zones + "</div>" : "";
    html += bowlerFirst ? CL.insights.nemesis(p, ctx) + zones : zones + CL.insights.nemesis(p, ctx);
    html += CL.insights.partners(p, ctx);
    html += bowlerFirst ? formBowling(p) + formBatting(p) : formBatting(p) + formBowling(p);
    html += victimsSection(p);
    page.innerHTML = html;
    CL.insights.wire(page, p, ctx);
  }).catch(function (e) { CL.fail(page, e); });
})();

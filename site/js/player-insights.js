/* Player page, stage 2: nemesis finder, danger zone, pressure test and best partners.
   Each function takes the player file and returns HTML ("" if there's nothing to show).
   ctx = { gap: record may be incomplete, completeFrom: date coverage becomes complete } */
(function () {
  "use strict";
  var esc = CL.esc, n = CL.n;

  function perOut(balls, outs) { return outs ? Math.round(balls / outs) : null; }
  function avg(r) { return r[4] ? (r[3] / r[4]).toFixed(1) : "–"; }
  function sr(r) { return r[2] ? (r[3] * 100 / r[2]).toFixed(1) : "–"; }
  var PAIR_TIP = "May be lower than the true figure: some of their meetings may be in " + CL.F.nouns + " Cricsheet doesn’t have";

  // ---------- Nemesis finder ----------
  function nemesisTable(rows, p, role) {
    return '<div class="table-wrap"><table><thead><tr><th>' + (role === "bat" ? "Bowler" : "Batter") +
      '</th><th class="r">Avg</th><th class="r">Outs</th><th class="r">Balls</th><th class="r">Runs</th><th class="r">SR</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var q = role === "bat" ? { bat: p.id, bowl: r[0] } : { bat: r[0], bowl: p.id };
        var mk = CL.mark(r[6], PAIR_TIP);
        return '<tr><td><a href="' + CL.link("matchups.html", q) + '">' + esc(r[1]) + '</a></td><td class="r"><strong>' + avg(r) +
          '</strong></td><td class="r">' + r[4] + mk + '</td><td class="r">' + r[2] + mk + '</td><td class="r">' + r[3] + mk +
          '</td><td class="r">' + sr(r) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  function nemesis(p, ctx) {
    var ne = p.nemesis || {}, batOut = "", bowlOut = "";
    var min = ne.min_balls || 120;
    var single = function (role, rows) {
      return '<div class="section"><h3>' + (role === "bat" ? "Batting: the only bowler faced" : "Bowling: the only batter bowled to") + " for " + min + "+ balls</h3>" +
        '<p class="explain">Just one opponent so far, so there’s nothing to rank yet.</p>' + nemesisTable(rows, p, role) + "</div>";
    };
    if (ne.toughest && ne.toughest.length && !ne.favourite.length) {
      batOut = single("bat", ne.toughest);
    } else if (ne.toughest && ne.toughest.length) {
      var t = ne.toughest[0];
      var lower = t[4] && p.batting.avg && t[3] / t[4] < p.batting.avg;
      batOut += '<div class="section"><h3>Batting: toughest bowlers to face</h3>' +
        '<p class="explain">Lowest batting average against them.' + (lower ? " " + esc(p.name) + " averages " + n(p.batting.avg, 1) +
        " overall, but just " + avg(t) + " against " + esc(t[1]) + "." : "") + "</p>" + nemesisTable(ne.toughest, p, "bat") + "</div>" +
        (ne.favourite.length ? '<div class="section"><h3>Batting: favourite bowlers to face</h3>' +
          '<p class="explain">Highest average against them. An average of “–” means never dismissed by that bowler.</p>' +
          nemesisTable(ne.favourite, p, "bat") + "</div>" : "");
    }
    if (ne.easiest && ne.easiest.length && !ne.hardest.length) {
      bowlOut = single("bowl", ne.easiest);
    } else if (ne.easiest && ne.easiest.length) {
      bowlOut += '<div class="section"><h3>Bowling: easiest batters to bowl to</h3>' +
        '<p class="explain">Batters who average least against ' + esc(p.name) + ".</p>" + nemesisTable(ne.easiest, p, "bowl") + "</div>" +
        (ne.hardest.length ? '<div class="section"><h3>Bowling: hardest batters to bowl to</h3>' +
          '<p class="explain">Batters who average most against ' + esc(p.name) + " (“–” means never dismissed them).</p>" +
          nemesisTable(ne.hardest, p, "bowl") + "</div>" : "");
    }
    var out = ctx.bowlerFirst ? bowlOut + batOut : batOut + bowlOut;
    if (!out) {
      if (!p.batting.balls && !p.bowling.balls) return "";
      out = '<p class="empty">No opponent faced for ' + min + "+ balls yet, so there isn’t enough to rank.</p>";
    }
    return '<section class="card section"><h2>Nemesis finder</h2>' +
      '<p class="explain">Only opponents faced for at least ' + min + " balls (" + (min / 6) + " overs) count, so one bad day doesn’t decide it" +
      (CL.F.kind === "test" ? "" : " (fewer than in Tests, because players face each other far less in " + CL.F.label + ")") + ". " +
      "Average = runs per dismissal; SR = runs per 100 balls. Tap a name for the full head-to-head.</p>" + out +
      (ctx.gap ? '<p class="gap-key"><sup class="gap-mark">†</sup> Both players were around ' + CL.gapWhen(ctx.completeFrom) +
        ", so some of their meetings may be missing.</p>" : "") + "</section>";
  }

  // ---------- Danger zone ----------
  // Zones come from the competition's settings, e.g. balls 1-10, 11-25... for Tests, 1-5, 6-10... for T20.
  var ZONES, ZONE_TEXT;
  function setZones(zones) {
    ZONES = zones.map(function (z) { return z[1] == null ? "Balls " + z[0] + "+" : "Balls " + z[0] + "–" + z[1]; });
    ZONE_TEXT = zones.map(function (z, i) {
      if (i === 0) return "early (in the first " + z[1] + " balls)";
      if (i === 1) return "while settling in (balls " + z[0] + "–" + z[1] + ")";
      if (z[1] == null) return "after " + (z[0] - 1) + " balls";
      return "between balls " + z[0] + " and " + z[1];
    });
  }

  function dangerSummary(rel, outs) {
    var ok = rel.map(function (r, i) { return r != null && outs[i] >= 3 ? i : -1; }).filter(function (i) { return i >= 0; });
    if (ok.length < 2) return "";
    var worst = ok.reduce(function (a, b) { return rel[b] > rel[a] ? b : a; });
    var best = ok.reduce(function (a, b) { return rel[b] < rel[a] ? b : a; });
    if (rel[worst] < 1.15 && rel[best] > 0.85) return "About equally hard to dismiss at every stage of an innings.";
    var bestText, zones = ZONE_ZONES;
    if (best >= 3 && rel[3] != null && rel[4] != null && rel[3] < 0.85 && rel[4] < 0.85) bestText = "once past " + (zones[3][0] - 1) + " balls";
    else bestText = best === 4 ? "once past " + (zones[4][0] - 1) + " balls" : ZONE_TEXT[best];
    return "Most vulnerable " + ZONE_TEXT[worst] + "; " + (rel[best] < 0.7 ? "very hard to dismiss " : "hardest to dismiss ") + bestText + ".";
  }

  var ZONE_ZONES;
  function danger(p, ctx) {
    ZONE_ZONES = ctx.settings.danger_zones;
    setZones(ZONE_ZONES);
    var d = p.danger;
    if (!d || !p.batting.inns) return "";
    var balls = 0, outs = 0;
    d.forEach(function (z) { balls += z[0]; outs += z[1]; });
    if (!outs) return "";
    var overall = outs / balls;
    var rel = d.map(function (z) { return z[0] ? (z[1] / z[0]) / overall : null; });
    var max = Math.max.apply(null, rel.filter(function (r) { return r != null; }).concat([1.5]));
    var mk = CL.mark(ctx.gap);
    var rows = d.map(function (z, i) {
      if (!z[0]) return "";
      var every = perOut(z[0], z[1]);
      var hot = rel[i] > 1.15;
      return '<div class="bar-row wide"><span>' + ZONES[i] + '</span><div class="bar-track"><div class="bar-fill' + (hot ? " hot" : "") +
        '" style="width:' + (rel[i] * 100 / max) + '%"></div><span class="bar-mid" style="left:' + (100 / max) + '%"></span></div>' +
        '<span class="val">' + (every ? "1 in " + every : "never out") + "</span></div>" +
        '<div class="bar-sub small muted">' + z[1] + mk + " outs in " + n(z[0]) + mk + " balls · " +
        (rel[i] == null ? "" : rel[i].toFixed(1) + "× their usual rate") + "</div>";
    }).join("");
    var summary = dangerSummary(rel, d.map(function (z) { return z[1]; }));
    return '<section class="card"><h2>Danger zone</h2>' +
      '<p class="explain">How likely they are to get out at each stage of an innings, counted by balls they’ve faced so far. ' +
      "“1 in 40” means out once every 40 balls at that stage. Overall they’re out once every " + perOut(balls, outs) +
      " balls. The line marks their usual rate; orange bars are riskier than usual.</p>" +
      (summary ? '<p><strong>' + esc(summary) + "</strong></p>" : "") +
      (outs < 20 ? '<div class="notice"><strong>Small sample:</strong> only ' + outs + " dismissals, so these patterns could easily be chance.</div>" : "") +
      '<div class="bars">' + rows + "</div></section>";
  }

  // ---------- Pressure test ----------
  function pressure(p, ctx) {
    var pr = p.pressure;
    if (!pr || !pr.all[1]) return "";
    var base = pr.all[0] / pr.all[1];
    var mk = CL.mark(ctx.gap);
    var small = false;
    var dots = ctx.settings.dot_runs;
    var rows = [["Any ball", pr.all]].concat(dots.map(function (k) { return ["After " + k + "+ dots in a row", pr[k]]; }))
      .map(function (row, i) {
        var b = row[1][0], o = row[1][1];
        var every = perOut(b, o);
        var rel = o ? base / (b / o) : 0;
        var thin = i > 0 && (o < 10 || b < 200);
        small = small || thin;
        return "<tr><td>" + row[0] + '</td><td class="r">' + n(b) + mk + '</td><td class="r">' + o + mk + '</td><td class="r"><strong>' +
          (every ? "1 in " + every : "never out") + '</strong></td><td class="r">' + (i ? (o ? rel.toFixed(1) + "×" : "–") : "1.0×") +
          (thin ? ' <span class="muted small">(small)</span>' : "") + "</td></tr>";
      }).join("");
    var mid = pr[dots[1]];
    var r5 = mid[1] ? base / (mid[0] / mid[1]) : null;
    var verdict = r5 == null || mid[1] < 10 ? "" :
      r5 > 1.2 ? "Dot-ball pressure gets to them: more likely to get out after a quiet spell." :
      r5 < 0.85 ? "Unflustered by dot balls: actually less likely to get out after a quiet spell." :
      "Dot balls make little difference to their chance of getting out.";
    return '<section class="card"><h2>Pressure test</h2>' +
      '<p class="explain">How often they get out on the next ball after facing several scoreless balls in a row, compared with any ball. ' +
      "“Out” = how often they get out in that situation. “Risk” compares it with any ball: above 1.0× means more likely to get out than usual.</p>" +
      (verdict ? "<p><strong>" + verdict + "</strong></p>" : "") +
      (small ? '<div class="notice"><strong>Small sample</strong> on rows marked “small” (fewer than 10 dismissals or 200 balls), so read those with care.</div>' : "") +
      '<div class="table-wrap"><table><thead><tr><th>Situation</th><th class="r">Balls</th><th class="r">Outs</th><th class="r">Out</th><th class="r">Risk</th></tr></thead><tbody>' +
      rows + "</tbody></table></div></section>";
  }

  // ---------- Best partners ----------
  function partners(p, ctx) {
    var rows = p.partners || [];
    if (!rows.length) return "";
    return '<section class="card section"><h2>Best batting partners</h2>' +
      '<p class="explain">The batters they’ve added most runs with. Average stand = runs ÷ partnerships that ended with a wicket. * = unbroken.</p>' +
      '<div class="table-wrap"><table><thead><tr><th>Partner</th><th class="r">Stands</th><th class="r">Runs</th><th class="r">Avg stand</th><th class="r">Best</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var mk = CL.mark(r[9], "May be lower than the true figure: some of their partnerships may be in " + CL.F.nouns + " Cricsheet doesn’t have");
        return '<tr><td><a href="' + CL.link("player.html", { id: r[0] }) + '">' + esc(r[1]) + '</a></td><td class="r">' + r[2] + mk +
          '</td><td class="r"><strong>' + n(r[3]) + mk + '</strong></td><td class="r">' + CL.standAvg(r[3], r[4]) +
          '</td><td class="r">' + CL.bestStand(r[8]) + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<p class="small"><a href="' + CL.link("partnerships.html", { p: p.id }) + '">See all their partnerships →</a></p></section>';
  }

  // ---------- Season (or year) by year ----------
  // by_period rows: [period, inns, runs, outs, balls, 4s, 6s, 50s, 100s, balls bowled, runs conceded, wickets]
  function seasonCards(r) {
    var stat = function (label, value, cls) {
      return '<div class="stat ' + (cls || "") + '"><div class="v">' + value + '</div><div class="k">' + label + "</div></div>";
    };
    var bat = r[1] ? stat("Runs", n(r[2]), "big") + stat("Strike rate", r[4] ? (r[2] * 100 / r[4]).toFixed(1) : "–", CL.F.kind === "test" ? "" : "big") +
      stat("Average", r[3] ? (r[2] / r[3]).toFixed(1) : "–") + stat("Innings", r[1]) + stat("50s / 100s", r[7] + " / " + r[8]) + stat("4s / 6s", r[5] + " / " + r[6]) : "";
    var bowl = r[9] ? stat("Wickets", r[11], "big") + stat("Economy", (r[10] * 6 / r[9]).toFixed(2), CL.F.kind === "test" ? "" : "big") +
      stat("Bowling avg", r[11] ? (r[10] / r[11]).toFixed(1) : "–") + stat("Overs", CL.overs(r[9])) : "";
    return '<div class="stats">' + bat + bowl + "</div>";
  }
  function seasons(p, ctx) {
    var rows = p.by_period || [];
    if (rows.length < 2) return "";
    var word = CL.periodWord, Word = word[0].toUpperCase() + word.slice(1);
    var opts = rows.slice().reverse().map(function (r) { return '<option value="' + esc(r[0]) + '">' + esc(r[0]) + "</option>"; }).join("");
    var mk = CL.mark(ctx.gap);
    var table = '<div class="table-wrap section"><table><thead><tr><th>' + Word + '</th><th class="r">Inns</th><th class="r">Runs</th><th class="r">Avg</th><th class="r">SR</th>' +
      '<th class="r">Wkts</th><th class="r">Econ</th></tr></thead><tbody>' +
      rows.slice().reverse().map(function (r) {
        return "<tr><td>" + esc(r[0]) + '</td><td class="r">' + (r[1] || "–") + '</td><td class="r"><strong>' + (r[1] ? n(r[2]) : "–") + "</strong>" + (r[1] ? mk : "") +
          '</td><td class="r">' + (r[3] ? (r[2] / r[3]).toFixed(1) : "–") + '</td><td class="r">' + (r[4] ? (r[2] * 100 / r[4]).toFixed(1) : "–") +
          '</td><td class="r">' + (r[9] ? r[11] : "–") + '</td><td class="r">' + (r[9] ? (r[10] * 6 / r[9]).toFixed(2) : "–") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    return '<section class="card section" id="seasons"><h2>' + Word + " by " + word + "</h2>" +
      '<p class="explain">Pick a ' + word + " to see just that " + word + "’s figures, or see every " + word + " in the table." +
      (CL.F.league ? " Seasons are grouped the way the competition runs them" + (CL.format === "bbl" ? " (a BBL season spans December to February)." : ".") : "") + "</p>" +
      '<label class="check" style="gap:10px">' + Word + ' <select id="season-pick" style="width:auto;padding:6px 10px"><option value="">All ' + word + "s</option>" + opts + "</select></label>" +
      '<div id="season-view">' + table + "</div></section>";
  }

  // ---------- Phase stats (white-ball) ----------
  function phases(p, ctx) {
    var ph = p.phases, names = ctx.settings.phases;
    if (!ph || !names) return "";
    var mk = CL.mark(ctx.gap);
    var overs = function (x) { return "overs " + x[1] + "–" + x[2]; };
    var label = function (x) { return x[0] + '<br><span class="muted small" style="font-weight:400">' + overs(x) + "</span>"; };
    var bat = ph.bat && ph.bat.some(function (r) { return r[1]; }) ? '<h3>Batting</h3><div class="table-wrap"><table class="phase-table"><thead><tr><th>Phase</th>' +
      '<th class="r">SR</th><th class="r">Runs</th><th class="r">Balls</th><th class="r">Outs</th><th class="r">Balls per out</th></tr></thead><tbody>' +
      ph.bat.map(function (r, i) {
        return "<tr><td>" + label(names[i]) + '</td><td class="r"><strong>' + (r[1] ? (r[0] * 100 / r[1]).toFixed(1) : "–") + '</strong></td><td class="r">' +
          n(r[0]) + mk + '</td><td class="r">' + n(r[1]) + mk + '</td><td class="r">' + r[2] + mk +
          '</td><td class="r">' + (r[2] ? Math.round(r[1] / r[2]) : "–") + "</td></tr>";
      }).join("") + "</tbody></table></div>" : "";
    var bowl = ph.bowl && ph.bowl.some(function (r) { return r[0]; }) ? '<h3 class="section">Bowling</h3><div class="table-wrap"><table class="phase-table"><thead><tr><th>Phase</th>' +
      '<th class="r">Econ</th><th class="r">Wkts</th><th class="r">Overs</th><th class="r">Runs</th></tr></thead><tbody>' +
      ph.bowl.map(function (r, i) {
        return "<tr><td>" + label(names[i]) + '</td><td class="r"><strong>' + (r[0] ? (r[1] * 6 / r[0]).toFixed(2) : "–") + '</strong></td><td class="r">' + r[2] + mk +
          '</td><td class="r">' + CL.overs(r[0]) + mk + '</td><td class="r">' + n(r[1]) + mk + "</td></tr>";
      }).join("") + "</tbody></table></div>" : "";
    if (!bat && !bowl) return "";
    var order = ctx.bowlerFirst ? bowl.replace(' class="section"', "") + bat.replace("<h3>", '<h3 class="section">') : bat + bowl;
    return '<section class="card section"><h2>Powerplay, middle and death overs</h2>' +
      '<p class="explain">How they do in each part of an innings. The powerplay is when fielding restrictions apply; the death overs are the last few, ' +
      "when batters attack. SR = runs per 100 balls; economy = runs per over. Wickets here only count ones credited to the bowler.</p>" + order + "</section>";
  }

  // Hook up anything interactive after the page is drawn (the season picker).
  function wire(root, p, ctx) {
    var pick = root.querySelector("#season-pick");
    if (!pick) return;
    var view = root.querySelector("#season-view"), table = view.innerHTML;
    pick.addEventListener("change", function () {
      var r = (p.by_period || []).filter(function (x) { return String(x[0]) === pick.value; })[0];
      view.innerHTML = r ? '<div class="section">' + seasonCards(r) + "</div>" : table;
    });
  }

  CL.insights = { nemesis: nemesis, danger: danger, pressure: pressure, partners: partners,
    seasons: seasons, phases: phases, wire: wire };
})();

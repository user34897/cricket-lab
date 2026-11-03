/* Era-adjusted comparison of up to three batters.
   Each player file has era = { years: [[year, inns, runs, outs, balls, era avg, era SR]], era_avg, era_sr, top_order_share }
   where the "era" figures are all OTHER top-order batters in the same years (or seasons for the leagues);
   "top order" is positions 1-6 in Tests and ODIs, 1-4 in T20s (from the competition's settings),
   weighted by how many innings the player batted each year.
   data/<format>/era.json -> [[year, runs, outs, balls, innings]] for all top-order batters. */
(function () {
  "use strict";
  CL.init("era.html");
  var esc = CL.esc, n = CL.n;
  var result = CL.$("#result");
  var SLOTS = 3;
  var ids = (CL.params.get("ids") || "").split(",").filter(Boolean).slice(0, SLOTS);
  var players, eraRows, completeFrom = null, patchy = false, overallAvg = null, overallSr = null;
  var TOP = 6;                       // top-order positions (from settings)
  var white = CL.F.kind !== "test";  // white-ball: scoring speed gets equal billing
  var word = CL.periodWord;          // "year" or "season"
  var EXAMPLE = CL.F.kind === "test" ? ["SPD Smith", "V Kohli", "JE Root"] : CL.format === "bbl" ? ["CA Lynn", "GJ Maxwell", "MW Short"]
    : ["V Kohli", "DA Warner", "JC Buttler"];
  // Is this year/season in a period when Cricsheet is missing matches for everyone?
  function isPatchy(period) { return patchy && String(period).slice(0, 4) < completeFrom.slice(0, 4); }
  var COLOURS = ["--accent", "--bar-2", "--bar-3"];

  function saveUrl() {
    history.replaceState(null, "", CL.link("era.html", { ids: ids.filter(Boolean).join(",") || null }));
  }

  function renderPickers() {
    var box = CL.$("#pickers");
    box.innerHTML = "";
    for (var i = 0; i < SLOTS; i++) {
      (function (i) {
        var card = document.createElement("div");
        card.className = "card field";
        var p = ids[i] && players.byId[ids[i]];
        card.innerHTML = '<label for="era-' + i + '">Player ' + (i + 1) + (i ? " (optional)" : "") + "</label>";
        if (p) {
          card.innerHTML += '<div class="picked" style="border-left:4px solid var(' + COLOURS[i] + ')"><span><strong>' + esc(p.name) + "</strong>" +
            (p.incomplete ? " " + CL.badge() : "") + '<br><span class="muted small">' + CL.playerMeta(p) +
            '</span></span><button type="button">Remove</button></div>';
          card.querySelector("button").addEventListener("click", function () { ids.splice(i, 1); update(); });
        } else {
          card.innerHTML += '<div class="search"><input id="era-' + i + '" type="search" autocomplete="off" placeholder="Search for a batter…"></div>';
        }
        box.appendChild(card);
        if (!p) {
          CL.playerPicker(card.querySelector("input"), players, function (picked) {
            if (ids.indexOf(picked.id) < 0) ids[Math.min(i, ids.length)] = picked.id;
            update();
          }, function (q) { return q.batBalls > 0; });
        }
      })(i);
      if (!ids[i]) break; // only show one empty box at a time
    }
  }

  function update() {
    ids = ids.filter(Boolean);
    saveUrl();
    renderPickers();
    render();
  }

  function row(label, cells, explain) {
    return "<tr><th scope=\"row\" style=\"white-space:normal\">" + label + (explain ? '<br><span class="muted small" style="text-transform:none;letter-spacing:0;font-weight:400">' + explain + "</span>" : "") +
      "</th>" + cells.map(function (c) { return '<td class="r">' + c + "</td>"; }).join("") + "</tr>";
  }

  function render() {
    if (!ids.length) {
      result.innerHTML = '<p class="empty">Pick a batter to start, e.g. <a href="#" id="eg">' +
        EXAMPLE.map(function (nm) { return nm.split(" ").pop(); }).join(", ").replace(/, ([^,]*)$/, " and $1") + "</a>.</p>";
      CL.$("#eg").addEventListener("click", function (e) {
        e.preventDefault();
        ids = EXAMPLE.map(function (nm) { var f = CL.search(nm, players, 1)[0]; return f && f.id; }).filter(Boolean);
        update();
      });
      return;
    }
    result.innerHTML = '<p class="empty">Loading…</p>';
    Promise.all(ids.map(function (id) { return CL.load("players/" + id + ".json"); })).then(function (list) {
      var stats = list.map(function (p) {
        var e = p.era || {};
        var idx = p.batting.avg && e.era_avg ? p.batting.avg / e.era_avg * 100 : null;
        var sIdx = p.batting.sr && e.era_sr ? p.batting.sr / e.era_sr * 100 : null;
        return { p: p, e: e, idx: idx, sIdx: sIdx, adj: idx && overallAvg ? idx / 100 * overallAvg : null };
      });
      var head = "<tr><th></th>" + stats.map(function (s, i) {
        return '<th class="r" style="color:var(' + COLOURS[i] + ')">' + esc(s.p.name) + "</th>";
      }).join("") + "</tr>";
      var mk = function (s) { return CL.mark(s.p.incomplete); };
      var table = '<div class="table-wrap"><table><thead>' + head + "</thead><tbody>" +
        row((word === "season" ? "Seasons" : "Years") + " in data", stats.map(function (s) { return s.p.first.slice(0, 4) + "–" + s.p.last.slice(0, 4); })) +
        row("Innings", stats.map(function (s) { return s.p.batting.inns + mk(s); })) +
        row("Batting average", stats.map(function (s) { return "<strong>" + n(s.p.batting.avg, 2) + "</strong>"; })) +
        row("Era average", stats.map(function (s) { return n(s.e.era_avg, 2); }), "What other top-order batters averaged in the same " + word + "s") +
        row("Era-adjusted index", stats.map(function (s) { return "<strong>" + (s.idx ? Math.round(s.idx) : "–") + "</strong>"; }),
          "100 = a typical top-order batter of their time; 130 = 30% better") +
        row("Adjusted average", stats.map(function (s) { return s.adj ? s.adj.toFixed(1) : "–"; }),
          "Their average in a typical " + word + " of this data (" + (overallAvg ? overallAvg.toFixed(1) : "–") + " for the average top-order batter)") +
        row("Strike rate", stats.map(function (s) { return n(s.p.batting.sr, 1); })) +
        row("Era strike rate", stats.map(function (s) { return n(s.e.era_sr, 1); })) +
        row("Scoring-speed index", stats.map(function (s) { return (white ? "<strong>" : "") + (s.sIdx ? Math.round(s.sIdx) : "–") + (white ? "</strong>" : ""); }),
          "100 = scored as fast as a typical top-order batter of their time") +
        (white ? row("Adjusted strike rate", stats.map(function (s) { return s.sIdx && overallSr ? (s.sIdx / 100 * overallSr).toFixed(1) : "–"; }),
          "Their strike rate in a typical " + word + " of this data (" + (overallSr ? overallSr.toFixed(1) : "–") + " for the average top-order batter)") : "") +
        "</tbody></table></div>";

      var barSet = function (key, title) {
      var maxIdx = Math.max.apply(null, stats.map(function (s) { return s[key] || 0; }).concat([150]));
      return (title ? '<h3 class="section">' + title + "</h3>" : "") + '<div class="bars section">' + stats.map(function (s, i) {
        return '<div class="bar-row wide"><span>' + esc(s.p.name) + '</span><div class="bar-track"><div class="bar-fill" style="background:var(' + COLOURS[i] +
          ");width:" + ((s[key] || 0) * 100 / maxIdx) + '%"></div><span class="bar-mid" style="left:' + (10000 / maxIdx) + '%"></span></div><span class="val"><strong>' +
          (s[key] ? Math.round(s[key]) : "–") + "</strong></span></div>";
      }).join("") + '<p class="small muted" style="margin:0">The line marks 100: a typical top-order batter of the same ' + word + "s.</p></div>";
      };
      // In white-ball cricket, show scoring speed alongside the average.
      var bars = white ? barSet("idx", "Average, adjusted for era") + barSet("sIdx", "Strike rate, adjusted for era") : barSet("idx");

      var notes = stats.map(function (s) {
        var w = [];
        if (s.p.batting.inns < 20) w.push("only " + s.p.batting.inns + " innings in the data, so this is a small sample");
        if (s.e.top_order_share != null && s.e.top_order_share < 0.5) w.push("usually batted lower than number " + TOP + ", so comparing them with top-order batters isn’t really fair");
        if (s.p.incomplete) w.push("played " + CL.gapWhen(completeFrom) + ", so their figures (and their era’s) are partly incomplete");
        return w.length ? "<li><strong>" + esc(s.p.name) + ":</strong> " + w.join("; ") + ".</li>" : "";
      }).join("");

      var yearly = stats.map(function (s) {
        return '<details class="section"><summary>' + esc(s.p.name) + ": year by year</summary>" +
          '<div class="table-wrap"><table><thead><tr><th>Year</th><th class="r">Inns</th><th class="r">Runs</th><th class="r">Average</th><th class="r">Era avg</th></tr></thead><tbody>' +
          (s.e.years || []).map(function (y) {
            return "<tr><td>" + y[0] + CL.mark(isPatchy(y[0])) + '</td><td class="r">' + y[1] + '</td><td class="r">' + y[2] +
              '</td><td class="r">' + (y[3] ? (y[2] / y[3]).toFixed(1) : "–") + '</td><td class="r">' + n(y[5], 1) + "</td></tr>";
          }).join("") + "</tbody></table></div></details>";
      }).join("");

      result.innerHTML = '<section class="card"><h2>Compared with their era</h2>' +
        '<p class="explain">For each ' + word + " they played, we take the batting average" + (white ? " and strike rate" : "") +
        " of every <em>other</em> top-order batter (batting 1–" + TOP + ") that " + word + ", and weight the " + word + "s by how many innings they played. " +
        "Dividing their figure by that “era” figure gives the index." + (white ? " In " + CL.F.label + ", the strike-rate index matters at least as much as the average." : "") + "</p>" +
        bars + table + (notes ? '<div class="notice"><ul style="margin:0;padding-left:18px">' + notes + "</ul></div>" : "") +
        (stats.some(function (s) { return s.p.incomplete; }) ? '<p class="gap-key"><sup class="gap-mark">†</sup> May be lower than the official figure: some of this player’s ' + CL.F.nouns + ' aren’t in Cricsheet.</p>' : "") +
        yearly + "</section>";
    }).catch(function (e) { CL.fail(result, e); });
  }

  // How hard was batting each year? (top-order average by year)
  function eraChart() {
    var rows = eraRows.filter(function (r) { return r[4] >= 30; }); // skip years with hardly any data
    var max = Math.max.apply(null, rows.map(function (r) { return r[1] / r[2]; }));

    var byAvg = rows.slice().sort(function (a, b) { return a[1] / a[2] - b[1] / b[2]; });
    var lo = byAvg[0], hi = byAvg[byAvg.length - 1];
    var fmt = function (r) { return r[0] + (isPatchy(r[0]) ? "†" : "") + " (" + (r[1] / r[2]).toFixed(1) + ")"; };
    CL.$("#era-chart").innerHTML = "<h2>How hard was batting each year?</h2>" +
      '<p class="explain">The average of all top-order batters (positions 1–' + TOP + ") in each " + word + " of the data. Higher = an easier time to bat. " +
      (patchy ? word[0].toUpperCase() + word.slice(1) + "s marked † are missing some " + CL.F.nouns + " in Cricsheet. " : "") +
      word[0].toUpperCase() + word.slice(1) + "s with very few matches in the data are left out.</p>" +
      "<p><strong>Toughest " + word + " to bat: " + fmt(lo) + ". Easiest: " + fmt(hi) + ".</strong></p>" +
      '<div class="cols dense" style="height:170px" aria-label="Top-order average by year">' + rows.map(function (r) {
        var a = r[1] / r[2];
        return '<div class="col" title="' + r[0] + ": " + a.toFixed(1) + '"><span class="lbl">' + Math.round(a) + '</span><div class="bar' + (isPatchy(r[0]) ? " no" : "") +
          '" style="height:' + (a * 100 / max) + '%"></div></div>';
      }).join("") + "</div>" +
      '<div style="display:flex;justify-content:space-between" class="small muted"><span>' + rows[0][0] + (isPatchy(rows[0][0]) ? "†" : "") + "</span><span>" +
      rows[rows.length - 1][0] + "</span></div>" +
      (patchy ? '<p class="small muted">Orange bars: ' + word + "s with missing " + CL.F.nouns + " (†).</p>" : "");
  }

  Promise.all([CL.players(), CL.load("era.json"), CL.meta, CL.settings]).then(function (res) {
    players = res[0];
    eraRows = res[1];
    completeFrom = res[2] && res[2].coverage ? res[2].coverage.complete_from : null;
    patchy = !!(completeFrom && res[2].first && completeFrom > res[2].first);
    TOP = res[3].top_order;
    CL.$("#era-intro").innerHTML = "<strong>Only Cricsheet’s " + word + "s.</strong> Both the players’ figures and the “era” they’re compared with only use " +
      CL.esc(CL.F.nouns) + " in Cricsheet’s data (from " + CL.date(res[2].first) + (patchy ? ", with gaps before " + CL.date(completeFrom) : "") +
      "). Careers that started earlier are only partly counted, and figures never mix competitions.";
    var R = 0, O = 0, B = 0;
    eraRows.forEach(function (r) { R += r[1]; O += r[2]; B += r[3]; });
    overallAvg = O ? R / O : null;
    overallSr = B ? R * 100 / B : null;
    ids = ids.filter(function (id) { return players.byId[id]; });
    renderPickers();
    render();
    eraChart();
  }).catch(function (e) { CL.fail(result, e); });
})();

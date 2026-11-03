/* Venue guide: one file (data/<format>/venues.json) holds every ground. */
(function () {
  "use strict";
  CL.init("venues.html");
  var esc = CL.esc;
  var list = CL.$("#venue-list"), detail = CL.$("#detail"), filter = CL.$("#vq");
  var venues = [], current = CL.params.get("v");
  // "all" = every match in the data; "complete" = only years Cricsheet covers fully.
  var period = "all", completeFrom = null;

  var ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th"];
  // In white-ball cricket there are no draws: matches without a winner are ties or washed out.
  var DRAWN = CL.F.kind === "test" ? "Drawn" : "No result/tie";
  var COLOURS = { c1: "--accent", c2: "--bar-2", c3: "--bar-3" };

  function renderList() {
    var q = filter.value.trim().toLowerCase();
    var shown = venues.filter(function (v) {
      return !q || (v.name + " " + (v.nick || "") + " " + (v.city || "")).toLowerCase().indexOf(q) >= 0;
    });
    list.innerHTML = shown.length ? shown.map(function (v) {
      return '<li><a href="' + CL.link("venues.html", { v: v.slug }) + '" data-slug="' + v.slug + '" class="' + (v.slug === current ? "active" : "") + '">' +
        '<span><span class="name">' + esc(v.nick || v.name) + "</span>" + CL.mark(v.incomplete, "Some " + CL.F.nouns + " here may be missing from Cricsheet") +
        '<br><span class="meta">' +
        esc(v.nick ? v.name : v.city || "") + "</span></span>" +
        '<span class="figs">' + v.matches + "</span></a></li>";
    }).join("") : '<li class="empty small">No grounds match</li>';
  }

  function stat(label, value, cls) {
    return '<div class="stat ' + (cls || "") + '"><div class="v">' + value + '</div><div class="k">' + label + "</div></div>";
  }

  function stack(parts) {
    var total = parts.reduce(function (s, p) { return s + p[1]; }, 0);
    if (!total) return '<p class="muted">No results yet.</p>';
    return '<div class="stack">' + parts.filter(function (p) { return p[1]; }).map(function (p) {
      return '<div class="' + p[2] + '" style="flex:' + p[1] + '">' + Math.round(p[1] * 100 / total) + "%</div>";
    }).join("") + '</div><div class="legend">' + parts.map(function (p) {
      return '<span style="--c:var(' + COLOURS[p[2]] + ')">' +
        esc(p[0]) + ": <strong>" + p[1] + "</strong></span>";
    }).join("") + "</div>";
  }

  function inningsChart(inns, mk) {
    var max = Math.max.apply(null, inns.map(function (i) { return i.avg; }).concat([1]));
    return '<div class="bars">' + inns.filter(function (i) { return i.n <= 4; }).map(function (i) {
      return '<div class="bar-row"><span>' + ORDINAL[i.n] + ' innings</span><div class="bar-track"><div class="bar-fill" style="width:' +
        (i.avg * 100 / max) + '%"></div></div><span class="val"><strong>' + i.avg + "</strong></span></div>";
    }).join("") + "</div>" +
      '<div class="table-wrap section"><table><thead><tr><th>Innings</th><th class="r">Times</th><th class="r">Average</th><th class="r">Avg when all out</th><th class="r">Highest</th><th class="r">Lowest</th></tr></thead><tbody>' +
      inns.filter(function (i) { return i.n <= 4; }).map(function (i) {
        return "<tr><td>" + ORDINAL[i.n] + '</td><td class="r">' + i.count + mk() + '</td><td class="r"><strong>' + i.avg + '</strong></td><td class="r">' +
          (i.avg_all_out == null ? "–" : i.avg_all_out) + '</td><td class="r">' + i.high + '</td><td class="r">' + i.low + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  function tossSection(t, mk) {
    var decided = (t.won || 0) + (t.lost || 0) + (t.draw || 0) + (t.tie || 0);
    if (!decided) return "";
    var choiceRow = function (label, key) {
      var c = t["chose_" + key] || 0;
      if (!c) return "";
      return "<tr><td>" + label + '</td><td class="r">' + c + mk() + '</td><td class="r">' + (t[key + "_won"] || 0) + mk() + '</td><td class="r">' +
        (t[key + "_lost"] || 0) + mk() + '</td><td class="r">' + (t[key + "_draw"] || 0) + mk() + '</td><td class="r"><strong>' +
        CL.pct(t[key + "_won"] || 0, c) + "</strong></td></tr>";
    };
    var bat = t.chose_bat || 0, field = t.chose_field || 0;
    var pref = bat === field ? "Captains are split evenly" : "Captains who win the toss usually choose to " + (bat > field ? "bat" : "bowl") +
      " (" + CL.pct(Math.max(bat, field), bat + field) + " of the time)";
    return '<section class="card section"><h2>Toss impact</h2>' +
      '<p class="explain">Does winning the toss help? ' + pref + ". The toss winner went on to win " + CL.pct(t.won || 0, decided) +
      " of matches here.</p>" +
      stack([["Toss winner won", t.won || 0, "c1"], ["Toss winner lost", t.lost || 0, "c2"], [DRAWN, (t.draw || 0) + (t.tie || 0), "c3"]]) +
      '<div class="table-wrap section"><table><thead><tr><th>Toss winner chose to</th><th class="r">Times</th><th class="r">Won</th><th class="r">Lost</th><th class="r">' + DRAWN + '</th><th class="r">Win %</th></tr></thead><tbody>' +
      choiceRow("Bat first", "bat") + choiceRow("Bowl first", "field") + "</tbody></table></div></section>";
  }

  function show(slug) {
    var v = venues.filter(function (x) { return x.slug === slug; })[0];
    if (!v) { detail.innerHTML = '<p class="empty">Pick a ground from the list.</p>'; return; }
    if (slug !== current) period = "all";
    current = slug;
    document.title = (v.nick || v.name) + " – Cricket Lab";
    var since = completeFrom ? CL.date(completeFrom) : "2009";
    var canSplit = !!(v.incomplete && v.complete && completeFrom);
    var useComplete = canSplit && period === "complete";
    var d = useComplete ? v.complete : v;              // the figures being shown
    var gap = v.incomplete && !useComplete;            // could these figures be missing matches?
    var mk = function () { return CL.mark(gap, "Some " + CL.F.nouns + " here aren’t in Cricsheet, so this may be lower than the real number"); };
    var r = d.results;
    var batWon = r.bat_first_won || 0, fieldWon = r.field_first_won || 0, draws = (r.draw || 0) + (r.tie || 0) + (r["no result"] || 0);
    var decided = batWon + fieldWon;
    var lean = !decided ? "" : batWon === fieldWon ? "Results are evenly split between teams batting first and second." :
      (batWon > fieldWon ? "Batting first" : "Batting second") + " has won more often here: " +
      Math.max(batWon, fieldWon) + " of " + decided + " results.";

    var toggle = canSplit ? '<div class="toggle" role="group" aria-label="Which matches">' +
      '<button type="button" data-period="all" aria-pressed="' + !useComplete + '">All matches in the data (' + v.matches + ")</button>" +
      '<button type="button" data-period="complete" aria-pressed="' + useComplete + '">' + completeFrom.slice(0, 4) + " onwards: complete (" + v.complete.matches + ")</button></div>" : "";
    var gapNote = gap ? '<div class="notice"><strong>Incomplete record.</strong> Some ' + CL.F.nouns + " played here" + (CL.F.kind === "test" ? " before " + since : "") +
      " aren’t in Cricsheet, so counts marked † may be lower than the real numbers and averages may be a little off." +
      (canSplit ? " Choose “" + completeFrom.slice(0, 4) + " onwards” to see only the years Cricsheet covers (almost) completely." : "") + "</div>" : "";
    var small = d.matches < 5 ? '<div class="notice"><strong>Only ' + d.matches + " match" + (d.matches === 1 ? "" : "es") +
      " here in the data,</strong> so these patterns could easily be chance.</div>" : "";

    detail.innerHTML =
      '<section class="card"><h2 style="font-size:1.5rem">' + esc(v.name) + (gap ? " " + CL.badge("Some " + CL.F.nouns + " played here" + (CL.F.kind === "test" ? " before " + since : "") +
        " aren’t in Cricsheet, so match counts and results may be lower than the real numbers.") : "") + "</h2>" +
      '<p class="muted" style="margin-top:0">' + esc([v.nick, v.city].filter(Boolean).join(" · ")) + " · " +
      v.matches + mk() + " " + CL.matchWord(v.matches) + " in the data, " + v.first.slice(0, 4) + "–" + v.last.slice(0, 4) + "</p>" + toggle + gapNote + small +
      '<div class="stats">' + stat("Matches", d.matches + mk(), "big") + stat("Bat 1st won", batWon + mk()) + stat("Bat 2nd won", fieldWon + mk()) +
      stat(CL.F.kind === "test" ? "Draws" : "No result/tie", draws + mk()) + "</div></section>" +

      '<section class="card section"><h2>Average score by innings</h2>' +
      '<p class="explain">' + (CL.F.kind === "test" ? "The average team total in each innings of the match. Later innings are often shorter because the match ends " +
      "(a successful chase, a declaration or a draw), so “average when all out” shows totals only when all 10 wickets fell."
        : "The average total batting first and batting second. Chasing totals are often lower because the innings stops as soon as the target is reached. " +
      "Rain-shortened matches are included, which pulls averages down a little.") + "</p>" +
      inningsChart(d.innings, mk) + "</section>" +

      '<section class="card section"><h2>Batting first or second?</h2>' +
      '<p class="explain">Who won: the team that batted first, the team that batted second, or neither. ' + lean + "</p>" +
      stack([["Batting first won", batWon, "c1"], ["Batting second won", fieldWon, "c2"], [DRAWN, draws, "c3"]]) + "</section>" +

      tossSection(d.toss, mk) +

      '<section class="card section"><h2>Most recent ' + CL.F.nouns + ' here</h2><div class="table-wrap"><table><tbody>' +
      v.recent.map(function (m) {
        return "<tr><td>" + CL.date(m.date) + "</td><td>" + esc(m.teams.join(" v ")) + "</td><td>" + esc(m.result) + "</td></tr>";
      }).join("") + "</tbody></table></div></section>";
    Array.prototype.forEach.call(detail.querySelectorAll(".toggle button"), function (b) {
      b.addEventListener("click", function () { period = b.dataset.period; show(current); });
    });
    renderList();
  }

  Promise.all([CL.load("venues.json"), CL.meta]).then(function (res) {
    venues = res[0];
    completeFrom = res[1] && res[1].coverage ? res[1].coverage.complete_from : null;
    renderList();
    show(current || venues[0].slug);
    filter.addEventListener("input", renderList);
    list.addEventListener("click", function (e) {
      var a = e.target.closest("a[data-slug]");
      if (!a) return;
      e.preventDefault();
      history.replaceState(null, "", a.href);
      show(a.dataset.slug);
      if (window.innerWidth < 820) detail.scrollIntoView({ behavior: "smooth" });
    });
  }).catch(function (e) { CL.fail(detail, e); });
})();

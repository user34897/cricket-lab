/* White-ball chase calculator (ODIs, T20Is, BBL, IPL).
   data/<format>/chase/matches.json -> every chase not affected by rain:
     [date, chasing team, opponent, ground, target, runs made, wickets lost, result W/L/T, season, before complete coverage (1/0)]
   data/<format>/chase/w<N>.json -> positions with N wickets in hand, taken at the start of every over:
     [chase index, runs needed, balls left]
   Only the file for the chosen number of wickets is loaded. */
(function () {
  "use strict";
  if (CL.F.kind === "test") return;
  var esc = CL.esc;
  var odi = CL.F.kind === "odi";
  var MAX_BALLS = odi ? 300 : 120;

  // "Similar position": runs needed and balls left within these margins (or 10%, if bigger),
  // with exactly the same wickets in hand. Each match counts once, at its closest moment.
  var RUN_MARGIN = odi ? 6 : 4, BALL_MARGIN = odi ? 9 : 4;

  CL.$("#test-hero").hidden = true;
  CL.$("#form").hidden = true;
  var main = CL.$("main");
  var box = document.createElement("div");
  box.innerHTML =
    '<section class="hero"><h1>Chase calculator</h1><p class="lede">How often do teams actually win from here? Enter the runs needed, balls left and wickets in hand ' +
    "to see how real " + esc(CL.F.label) + " chases from a similar position ended.</p></section>" +
    '<form class="card" onsubmit="return false"><div class="form-row">' +
    '<div class="field"><label for="need">Runs needed</label><input id="need" type="number" inputmode="numeric" min="1" max="600" placeholder="e.g. ' + (odi ? 80 : 40) + '"></div>' +
    '<div class="field"><label for="balls">Balls left</label><input id="balls" type="number" inputmode="numeric" min="1" max="' + MAX_BALLS + '" placeholder="e.g. ' + (odi ? 60 : 24) + '"></div>' +
    '<div class="field"><label for="wkts">Wickets in hand</label><select id="wkts">' +
    [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(function (w) { return '<option value="' + w + '"' + (w === 6 ? " selected" : "") + ">" + w + "</option>"; }).join("") + "</select></div>" +
    '<div class="field"><label for="period">' + (CL.F.league ? "Season" : "Years") + '</label><select id="period"><option value="">All ' + CL.periodWord + "s</option></select></div>" +
    '</div><label class="check section" id="c-complete-row" hidden><input type="checkbox" id="c-complete"> <span id="c-complete-label"></span></label>' +
    '<p class="small muted" style="margin:10px 0 0">Rain-affected matches (Duckworth–Lewis or reduced overs) are left out, because their targets were changed.</p></form>' +
    '<div id="calc-result" class="section"></div>';
  main.insertBefore(box, CL.$("#result"));
  var need = CL.$("#need"), balls = CL.$("#balls"), wkts = CL.$("#wkts"), period = CL.$("#period"), complete = CL.$("#c-complete");
  var out = CL.$("#calc-result");
  var matches = [], completeFrom = null, patchy = false;
  var WORD = { W: "Won", L: "Lost", T: "Tied" };

  function stat(label, value, cls) {
    return '<div class="stat ' + (cls || "") + '"><div class="v">' + value + '</div><div class="k">' + label + "</div></div>";
  }
  function stack(parts) {
    var total = parts.reduce(function (s, p) { return s + p[1]; }, 0);
    var colours = { c1: "--accent", c2: "--bar-2", c3: "--bar-3" };
    return '<div class="stack">' + parts.filter(function (p) { return p[1]; }).map(function (p) {
      return '<div class="' + p[2] + '" style="flex:' + p[1] + '">' + Math.round(p[1] * 100 / total) + "%</div>";
    }).join("") + '</div><div class="legend">' + parts.map(function (p) {
      return '<span style="--c:var(' + colours[p[2]] + ')">' + esc(p[0]) + ": <strong>" + p[1] + "</strong></span>";
    }).join("") + "</div>";
  }
  function oversText(b) { return Math.floor(b / 6) + (b % 6 ? "." + (b % 6) : "") + " overs"; }

  function saveUrl() {
    history.replaceState(null, "", CL.link("chases.html", {
      need: need.value || null, balls: balls.value || null, w: wkts.value, s: period.value || null, full: complete.checked ? 1 : null
    }));
  }

  function render() {
    saveUrl();
    var r = parseInt(need.value, 10), b = parseInt(balls.value, 10), w = parseInt(wkts.value, 10);
    if (!r || !b || r < 1 || b < 1) {
      out.innerHTML = '<div class="card"><p class="empty">Enter runs needed and balls left, e.g. <a href="#" id="eg">' +
        (odi ? "80 off 60 balls with 6 wickets" : "40 off 24 balls with 6 wickets") + "</a>.</p></div>";
      CL.$("#eg").addEventListener("click", function (e) {
        e.preventDefault();
        need.value = odi ? 80 : 40; balls.value = odi ? 60 : 24; wkts.value = 6; render();
      });
      return;
    }
    b = Math.min(b, MAX_BALLS);
    out.innerHTML = '<p class="empty">Looking up chases…</p>';
    CL.load("chase/w" + w + ".json").then(function (states) {
      var rm = Math.max(RUN_MARGIN, Math.round(r * 0.1)), bm = Math.max(BALL_MARGIN, Math.round(b * 0.1));
      var best = {};
      states.forEach(function (st) {
        var m = matches[st[0]];
        if (!m) return;
        if (period.value && String(m[8]) !== period.value) return;
        if (complete.checked && m[9]) return;
        var dr = Math.abs(st[1] - r), db = Math.abs(st[2] - b);
        if (dr > rm || db > bm) return;
        var dist = dr / rm + db / bm;
        if (!best[st[0]] || dist < best[st[0]].dist) best[st[0]] = { dist: dist, st: st, m: m };
      });
      var found = Object.keys(best).map(function (k) { return best[k]; });
      var counts = { W: 0, L: 0, T: 0 };
      found.forEach(function (f) { counts[f.m[7]]++; });
      var total = found.length;
      var gap = found.some(function (f) { return f.m[9]; });
      var mk = function () { return CL.mark(gap, "Some " + CL.F.nouns + " from these years aren’t in Cricsheet, so this may be lower than the real number"); };
      var rate = (r * 6 / b).toFixed(2);
      var html = '<section class="card"><h2>Needing ' + r + " off " + b + " balls, " + w + " wicket" + (w === 1 ? "" : "s") + " in hand</h2>" +
        '<p class="explain">Required rate: ' + rate + " an over. Similar positions: " + (r - rm) + "–" + (r + rm) + " runs needed with " +
        Math.max(1, b - bm) + "–" + (b + bm) + " balls left and exactly " + w + " wicket" + (w === 1 ? "" : "s") + " in hand, at the start of an over" +
        (period.value ? ", in " + esc(period.value) : "") + ".</p>";
      if (!total) {
        out.innerHTML = html + '<p class="empty">No real chases reached a position like this. Try different numbers' +
          (period.value ? " or all " + CL.periodWord + "s" : "") + ".</p></section>";
        return;
      }
      var winPct = Math.round(counts.W * 100 / total);
      html += "<p><strong>" + (winPct >= 70 ? "The chasing side usually gets there" : winPct >= 45 ? "Too close to call" : winPct >= 20 ? "Odds favour the fielding side" : "History says this one’s nearly gone") +
        ": " + counts.W + " of " + total + " won (" + winPct + "%).</strong></p>";
      if (total < 15) html += '<div class="notice"><strong>Small sample:</strong> only ' + total + " similar chase" + (total === 1 ? "" : "s") + ", so treat this as a rough guide.</div>";
      if (gap) html += '<div class="notice"><strong>Incomplete record.</strong> Some of these chases come from years when Cricsheet is missing some ' + CL.F.nouns +
        ", so counts marked † may be lower than the real numbers." + (patchy ? " Tick the box above for complete years only." : "") + "</div>";
      html += '<div class="stats">' + stat("Won", counts.W + mk(), "big") + stat("Lost", counts.L + mk()) + stat("Tied", counts.T + mk()) + stat("Win chance", winPct + "%") + "</div>" +
        '<div class="section">' + stack([["Chasing side won", counts.W, "c1"], ["Tied", counts.T, "c3"], ["Chasing side lost", counts.L, "c2"]]) + "</div></section>";
      found.sort(function (a, b2) { return a.dist - b2.dist || (b2.m[0] > a.m[0] ? 1 : -1); });
      html += '<section class="card section"><h2>Closest real examples</h2><p class="explain">The chases that were nearest to this position.</p>' +
        '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Chasing</th><th>Position</th><th>Result</th><th>Ground</th></tr></thead><tbody>' +
        found.slice(0, 12).map(function (f) {
          var m = f.m, st = f.st, score = m[5] + "/" + m[6];
          return "<tr><td>" + CL.date(m[0]) + CL.mark(m[9], "From a year when Cricsheet is missing some matches") + "</td><td>" + esc(m[1]) +
            ' <span class="muted">v ' + esc(m[2]) + "</span></td><td>" + st[1] + " off " + st[2] + '</td><td><strong>' + WORD[m[7]] +
            '</strong> <span class="muted small">(' + score + ", target " + m[4] + ")</span></td><td>" + esc(m[3]) + "</td></tr>";
        }).join("") + "</tbody></table></div>" +
        '<p class="small muted">Position = runs needed off balls left at the start of that over. Ties include matches then decided by a super over.</p></section>';
      out.innerHTML = html;
    }).catch(function (e) { CL.fail(out, e); });
  }

  Promise.all([CL.load("chase/matches.json"), CL.meta]).then(function (res) {
    matches = res[0];
    var meta = res[1];
    completeFrom = meta && meta.coverage ? meta.coverage.complete_from : null;
    patchy = matches.some(function (m) { return m[9]; });
    if (patchy) {
      CL.$("#c-complete-row").hidden = false;
      CL.$("#c-complete-label").textContent = "Only chases from " + CL.date(completeFrom) + " onwards (when Cricsheet has (almost) every match)";
    }
    var periods = matches.map(function (m) { return String(m[8]); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort().reverse();
    periods.forEach(function (v) { var o = document.createElement("option"); o.value = o.textContent = v; period.appendChild(o); });
    need.value = CL.params.get("need") || "";
    balls.value = CL.params.get("balls") || "";
    if (CL.params.get("w")) wkts.value = CL.params.get("w");
    period.value = CL.params.get("s") || "";
    complete.checked = CL.params.get("full") === "1";
    [need, balls, wkts, period, complete].forEach(function (el) { el.addEventListener("input", render); el.addEventListener("change", render); });
    render();
  }).catch(function (e) { CL.fail(out, e); });
})();

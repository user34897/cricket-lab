/* Fourth-innings chase odds.
   data/<format>/chases.json -> rows of
     [date, ground, country, chasing team, opponent, target, runs made, wickets lost, result W/L/D/T] */
(function () {
  "use strict";
  CL.init("chases.html");
  if (CL.F.kind !== "test") return;   // white-ball competitions use the chase calculator (chase-calc.js)
  var esc = CL.esc;
  var result = CL.$("#result");
  var target = CL.$("#target"), ground = CL.$("#ground"), country = CL.$("#country"), complete = CL.$("#complete");
  var chases = [], completeFrom = null;

  // "Similar size": within 10% of the target, but never narrower than ±20 runs.
  function band(t) { return Math.max(20, Math.round(t * 0.1)); }

  var WORD = { W: "Won", L: "Lost", D: "Drawn", T: "Tied" };

  function options(el, values) {
    values.forEach(function (v) {
      var o = document.createElement("option");
      o.value = o.textContent = v;
      el.appendChild(o);
    });
  }

  function saveUrl() {
    history.replaceState(null, "", CL.link("chases.html", {
      t: target.value || null, g: ground.value || null, c: country.value || null, full: complete.checked ? 1 : null
    }));
  }

  function render() {
    saveUrl();
    var t = parseInt(target.value, 10);
    if (!t || t < 1) {
      result.innerHTML = overview();
      return;
    }
    var pool = chases.filter(function (c) {
      return (!ground.value || c[1] === ground.value) && (!country.value || c[2] === country.value) &&
        (!complete.checked || !completeFrom || c[0] >= completeFrom);
    });
    var w = band(t);
    var similar = pool.filter(function (c) { return Math.abs(c[5] - t) <= w; });
    var counts = { W: 0, D: 0, L: 0, T: 0 };
    similar.forEach(function (c) { counts[c[8]]++; });
    var total = similar.length;
    // Could any of these figures be missing matches?
    var gap = !complete.checked && completeFrom && pool.some(function (c) { return c[0] < completeFrom; });
    var mk = function () { return CL.mark(gap, "Some Tests before " + CL.date(completeFrom) + " aren’t in Cricsheet, so this may be lower than the real number"); };
    var where = (ground.value ? " at " + esc(ground.value) : "") + (country.value ? " in " + esc(country.value) : "");

    var html = '<section class="card"><h2>Targets of ' + (t - w) + "–" + (t + w) + where + "</h2>";
    if (!total) {
      html += '<p class="empty">No chases of this size' + where + " in the data. Try a different target or remove a filter.</p></section>";
      result.innerHTML = html + closest(pool, t);
      return;
    }
    var winPct = Math.round(counts.W * 100 / total);
    html += '<p class="explain">' + total + mk() + " Test chase" + (total === 1 ? "" : "s") + " with a target within " + w + " runs of " + t +
      where + ". The chasing team won " + counts.W + " (" + winPct + "%), drew " + (counts.D + counts.T) + " and lost " + counts.L + ".</p>";
    if (total < 10) {
      html += '<div class="notice"><strong>Small sample:</strong> only ' + total + " similar chase" + (total === 1 ? "" : "s") +
        ", so treat these odds as a rough guide at best.</div>";
    }
    if (gap) {
      html += '<div class="notice"><strong>Incomplete record.</strong> Some Tests before ' + CL.date(completeFrom) +
        " aren’t in Cricsheet, so counts marked † may be lower than the real numbers. Tick “only years where every Test is included” for complete years only.</div>";
    }
    html += '<div class="stats">' +
      stat("Won", counts.W + mk(), "big") + stat("Drawn", (counts.D + counts.T) + mk()) + stat("Lost", counts.L + mk()) + stat("Win chance", winPct + "%") +
      "</div>" + '<div class="section">' + stack([["Chasing side won", counts.W, "c1"], ["Drawn", counts.D + counts.T, "c3"], ["Chasing side lost", counts.L, "c2"]]) + "</div>" +
      '<p class="small muted section">Draws are common in Tests: many chases end with time running out rather than a result. ' +
      "Only chases where the fourth innings actually started are counted.</p></section>";
    result.innerHTML = html + closest(pool, t);
  }

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

  function closest(pool, t) {
    var list = pool.slice().sort(function (a, b) { return Math.abs(a[5] - t) - Math.abs(b[5] - t) || (b[0] > a[0] ? 1 : -1); }).slice(0, 12);
    if (!list.length) return "";
    return '<section class="card section"><h2>Closest real examples</h2>' +
      '<p class="explain">The chases with targets nearest ' + t + ", closest first.</p>" +
      '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Chasing</th><th class="r">Target</th><th>Result</th><th>Ground</th></tr></thead><tbody>' +
      list.map(function (c) {
        var score = c[6] + (c[7] >= 10 ? " all out" : "/" + c[7]);
        return "<tr><td>" + CL.date(c[0]) + CL.mark(completeFrom && c[0] < completeFrom, "From a year when Cricsheet is missing some Tests") +
          "</td><td>" + esc(c[3]) + ' <span class="muted">v ' + esc(c[4]) + '</span></td><td class="r"><strong>' + c[5] +
          "</strong></td><td>" + WORD[c[8]] + ' <span class="muted small">(' + score + ")</span></td><td>" + esc(c[1]) + "</td></tr>";
      }).join("") + "</tbody></table></div></section>";
  }

  // Shown before a target is entered.
  function overview() {
    var won = chases.filter(function (c) { return c[8] === "W"; });
    var best = won.slice().sort(function (a, b) { return b[5] - a[5]; })[0];
    var bands = [[1, 150], [151, 250], [251, 350], [351, 999]];
    return '<section class="card"><h2>How chases go, by size</h2>' +
      '<p class="explain">Every fourth-innings chase in the data (' + chases.length + " of them). Enter a target above for a closer look.</p>" +
      '<div class="table-wrap"><table><thead><tr><th>Target</th><th class="r">Chases</th><th class="r">Won</th><th class="r">Drawn</th><th class="r">Lost</th></tr></thead><tbody>' +
      bands.map(function (b) {
        var g = chases.filter(function (c) { return c[5] >= b[0] && c[5] <= b[1]; });
        var cnt = function (r) { return g.filter(function (c) { return c[8] === r || (r === "D" && c[8] === "T"); }).length; };
        return "<tr><td>" + (b[1] === 999 ? b[0] + "+" : b[0] + "–" + b[1]) + '</td><td class="r">' + g.length + CL.mark(!!completeFrom) +
          '</td><td class="r">' + CL.pct(cnt("W"), g.length) + '</td><td class="r">' + CL.pct(cnt("D"), g.length) + '</td><td class="r">' + CL.pct(cnt("L"), g.length) + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      (best ? '<p class="small muted">Highest successful chase in the data: <strong>' + best[5] + "</strong> by " + esc(best[3]) + " v " + esc(best[4]) +
        " at " + esc(best[1]) + " (" + best[0].slice(0, 4) + ").</p>" : "") +
      (completeFrom ? '<p class="gap-key"><sup class="gap-mark">†</sup> Some Tests before ' + CL.date(completeFrom) + " aren’t in Cricsheet, so these counts may be lower than the real numbers.</p>" : "") +
      "</section>";
  }

  Promise.all([CL.load("chases.json"), CL.meta]).then(function (res) {
    chases = res[0];
    completeFrom = res[1] && res[1].coverage ? res[1].coverage.complete_from : null;
    if (completeFrom) CL.$("#complete-label").textContent = "Only chases from " + CL.date(completeFrom) + " onwards (every Test included)";
    var uniq = function (i) { return chases.map(function (c) { return c[i]; }).filter(function (v, k, a) { return v && a.indexOf(v) === k; }).sort(); };
    options(ground, uniq(1));
    options(country, uniq(2));
    target.value = CL.params.get("t") || "";
    ground.value = CL.params.get("g") || "";
    country.value = CL.params.get("c") || "";
    complete.checked = CL.params.get("full") === "1";
    [target, ground, country, complete].forEach(function (el) { el.addEventListener("input", render); el.addEventListener("change", render); });
    render();
  }).catch(function (e) { CL.fail(result, e); });
})();

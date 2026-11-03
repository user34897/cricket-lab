/* Partnership finder.
   data/<format>/partnerships/<player id>.json -> rows of
     [partner id, name, stands, runs, times broken, balls, 50+ stands, 100+ stands, best, pair may be incomplete]
   data/<format>/partnerships/_top.json -> best pairs overall:
     [id, name, id, name, team, stands, runs, broken, 50s, 100s, best, pair may be incomplete]
   best = [runs, unbroken (1/0), date, opponent, wicket, ground] */
(function () {
  "use strict";
  CL.init("partnerships.html");
  var esc = CL.esc, n = CL.n;
  var result = CL.$("#result"), slot = CL.$("#p-slot");
  var players, chosen = CL.params.get("p");
  var TIP = "May be lower than the true figure: some of their partnerships may be in " + CL.F.nouns + " Cricsheet doesn’t have";

  function bestCell(b) {
    if (!b) return "–";
    return "<strong>" + CL.bestStand(b) + '</strong> <span class="muted small">v ' + esc(b[3]) + ", " + b[2].slice(0, 4) + "</span>";
  }
  function key(gap) {
    return gap ? '<p class="gap-key"><sup class="gap-mark">†</sup> Both batters played ' + (CL.F.kind === "test" ? "before Cricsheet’s coverage becomes complete" : "at times when Cricsheet is missing some " + CL.F.nouns) + ', so some of their partnerships may be missing.</p>' : "";
  }

  function renderSlot() {
    var p = chosen && players.byId[chosen];
    if (p) {
      slot.innerHTML = '<div class="picked"><span><strong><a href="' + CL.link("player.html", { id: p.id }) + '">' + esc(p.name) + "</a></strong>" +
        (p.incomplete ? " " + CL.badge() : "") + '<br><span class="muted small">' + CL.playerMeta(p) + '</span></span><button type="button">Change</button></div>';
      slot.querySelector("button").addEventListener("click", function () { chosen = null; update(); CL.$("#p-input").focus(); });
    } else {
      slot.innerHTML = '<div class="search"><input id="p-input" type="search" autocomplete="off" placeholder="Search for a batter…"></div>';
      CL.playerPicker(CL.$("#p-input"), players, function (picked) { chosen = picked.id; update(); },
        function (p) { return p.batBalls > 0; });
    }
  }

  function update() {
    history.replaceState(null, "", CL.link("partnerships.html", { p: chosen }));
    renderSlot();
    render();
  }

  function showTop() {
    CL.load("partnerships/_top.json").then(function (rows) {
      var anyGap = false;
      result.innerHTML = '<section class="card section"><h2>Most productive pairs</h2>' +
        '<p class="explain">Pairs with at least 5 partnerships, by total runs together.</p>' +
        '<div class="table-wrap"><table><thead><tr><th>Pair</th><th class="r">Stands</th><th class="r">Runs</th><th class="r">Avg stand</th><th class="r">100+</th><th>Best</th></tr></thead><tbody>' +
        rows.slice(0, 50).map(function (r) {
          var mk = CL.mark(r[11], TIP);
          anyGap = anyGap || !!r[11];
          return '<tr><td><a href="' + CL.link("partnerships.html", { p: r[0] }) + '">' + esc(r[1]) + '</a> &amp; <a href="' +
            CL.link("partnerships.html", { p: r[2] }) + '">' + esc(r[3]) + '</a><br><span class="muted small">' + esc(r[4]) + '</span></td><td class="r">' +
            r[5] + mk + '</td><td class="r"><strong>' + n(r[6]) + mk + '</strong></td><td class="r">' + CL.standAvg(r[6], r[7]) +
            '</td><td class="r">' + r[9] + mk + "</td><td>" + bestCell(r[10]) + "</td></tr>";
        }).join("") + "</tbody></table></div>" + key(anyGap) + "</section>";
    }).catch(function (e) { CL.fail(result, e); });
  }

  function showPlayer(p) {
    result.innerHTML = '<p class="empty">Loading…</p>';
    CL.load("partnerships/" + p.id + ".json").then(function (rows) {
      var regular = rows.filter(function (r) { return r[2] >= 3; });
      var total = rows.reduce(function (s, r) { return s + r[3]; }, 0);
      var anyGap = rows.some(function (r) { return r[9]; });
      var bestOne = rows.slice().sort(function (a, b) { return b[8][0] - a[8][0]; })[0];
      var table = function (list) {
        return '<div class="table-wrap"><table><thead><tr><th>Partner</th><th class="r">Stands</th><th class="r">Runs</th><th class="r">Avg stand</th><th class="r">50+</th><th class="r">100+</th><th>Best</th></tr></thead><tbody>' +
          list.map(function (r) {
            var mk = CL.mark(r[9], TIP);
            return '<tr><td><a href="' + CL.link("partnerships.html", { p: r[0] }) + '">' + esc(r[1]) + '</a></td><td class="r">' + r[2] + mk +
              '</td><td class="r"><strong>' + n(r[3]) + mk + '</strong></td><td class="r">' + CL.standAvg(r[3], r[4]) + '</td><td class="r">' + r[6] + mk +
              '</td><td class="r">' + r[7] + mk + "</td><td>" + bestCell(r[8]) + "</td></tr>";
          }).join("") + "</tbody></table></div>";
      };
      var others = rows.length - regular.length;
      result.innerHTML = '<section class="card section"><h2>' + esc(p.name) + "’s partners</h2>" +
        '<p class="explain">' + rows.length + " different partners, " + n(total) + CL.mark(p.incomplete) + " runs in partnerships." +
        (bestOne ? " Biggest stand: " + CL.bestStand(bestOne[8]) + " with " + esc(bestOne[1]) + " v " + esc(bestOne[8][3]) + " (" + bestOne[8][2].slice(0, 4) + ")." : "") +
        "</p>" + (regular.length ? "<h3>Regular partners (3+ stands)</h3>" + table(regular) : "") +
        (others ? '<details class="section"><summary>Show ' + others + " occasional partners (1–2 stands)</summary>" +
          table(rows.filter(function (r) { return r[2] < 3; })) + "</details>" : "") +
        '<p class="small muted section">With only a handful of stands, an “average stand” can swing a lot with one big or small partnership.</p>' +
        key(anyGap) + "</section>";
    }).catch(function () {
      result.innerHTML = '<div class="card"><p class="empty">No partnerships for this player in the data.</p></div>';
    });
  }

  function render() {
    var p = chosen && players.byId[chosen];
    if (p) showPlayer(p); else showTop();
  }

  CL.players().then(function (list) {
    players = list;
    if (chosen && !players.byId[chosen]) chosen = null;
    renderSlot();
    render();
  }).catch(function (e) { CL.fail(result, e); });
})();

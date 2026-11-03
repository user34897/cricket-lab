/* Matchups page: head-to-head between one batter and one bowler.
   Data: data/<format>/matchups/bat/<batter id>.json  -> { bowlerId: [balls, runs, outs, dots, 4s, 6s] }
         data/<format>/matchups/bowl/<bowler id>.json -> { batterId: [...same...] } */
(function () {
  "use strict";
  CL.init("matchups.html");
  var esc = CL.esc, n = CL.n;
  var result = CL.$("#result");
  var state = { bat: CL.params.get("bat"), bowl: CL.params.get("bowl") };
  var players;
  var completeFrom = null;

  // Below these numbers of balls, a head-to-head doesn't tell you much.
  // Below these numbers of balls, a head-to-head doesn't tell you much. They depend on the
  // competition (set from the data's settings): Tests 30/120, ODIs 18/60, T20s 12/30.
  var TINY = 30, SMALL = 120;
  // "Who's had the better of it": a wicket more often than every LOW balls favours the bowler,
  // less often than every HIGH balls favours the batter.
  var VERDICT = { test: [60, 150], odi: [30, 80], t20: [15, 40] }[CL.F.kind];

  var ROLES = {
    bat: { label: "batter", filter: function (p) { return p.batBalls > 0; } },
    bowl: { label: "bowler", filter: function (p) { return p.bowlBalls > 0; } }
  };

  function updateUrl() {
    history.replaceState(null, "", CL.link("matchups.html", { bat: state.bat, bowl: state.bowl }));
  }

  function renderSlot(role) {
    var slot = CL.$("#" + role + "-slot");
    var p = state[role] && players.byId[state[role]];
    if (p) {
      slot.innerHTML = '<div class="picked"><span><strong><a href="' + CL.link("player.html", { id: p.id }) + '">' + esc(p.name) +
        "</a></strong>" + (p.incomplete ? " " + CL.badge() : "") + '<br><span class="muted small">' + CL.playerMeta(p) + '</span></span><button type="button">Change</button></div>';
      slot.querySelector("button").addEventListener("click", function () {
        state[role] = null;
        renderSlot(role);
        updateUrl();
        render();
        CL.$("#" + role + "-input").focus();
      });
    } else {
      slot.innerHTML = '<div class="search"><input id="' + role + '-input" type="search" autocomplete="off" placeholder="Search for a ' +
        ROLES[role].label + '…"></div>';
      CL.playerPicker(CL.$("#" + role + "-input"), players, function (picked) {
        state[role] = picked.id;
        renderSlot(role);
        updateUrl();
        render();
      }, ROLES[role].filter);
    }
  }

  function stat(label, value, cls) {
    return '<div class="stat ' + (cls || "") + '"><div class="v">' + value + '</div><div class="k">' + label + "</div></div>";
  }

  // When only one side is picked, suggest opponents they've met most.
  function suggestions(role, data) {
    var other = role === "bat" ? "bowl" : "bat";
    var me = players.byId[state[role]];
    var rows = Object.keys(data).map(function (k) { return [k, data[k]]; })
      .filter(function (r) { return players.byId[r[0]]; })
      .sort(function (a, b) { return b[1][0] - a[1][0]; }).slice(0, 15);
    var title = role === "bat" ? "Bowlers " + esc(me.name) + " has faced most" : "Batters " + esc(me.name) + " has bowled to most";
    return '<div class="card"><h2>' + title + '</h2><p class="explain">Pick one, or search above. Numbers show balls · dismissals.' +
      (me.incomplete ? " † means some of their meetings may be missing, because both players were around before " +
        CL.gapWhen(completeFrom) + "." : "") +
      '</p><div class="chips">' +
      rows.map(function (r) {
        var o = {}; o[role] = state[role]; o[other] = r[0];
        return '<a class="chip" data-id="' + r[0] + '" href="' + CL.link("matchups.html", o) + '">' + esc(players.byId[r[0]].name) +
          ' <span class="muted">' + r[1][0] + " · " + r[1][2] + CL.mark(me.incomplete && players.byId[r[0]].incomplete) + "</span></a>";
      }).join("") + "</div></div>";
  }

  function headToHead(bat, bowl, m) {
    var balls = m[0], runs = m[1], outs = m[2], dots = m[3], fours = m[4], sixes = m[5];
    var warn = "";
    if (balls < TINY) {
      warn = '<div class="notice"><strong>Very small sample.</strong> Only ' + balls + " ball" + (balls === 1 ? "" : "s") +
        ", so these numbers say almost nothing about who has the upper hand.</div>";
    } else if (balls < SMALL) {
      warn = '<div class="notice"><strong>Small sample.</strong> ' + balls + " balls is under " + (SMALL / 6) + " overs, so treat these numbers with caution.</div>";
    }
    // If both players were around in the years Cricsheet is missing Tests, some of
    // their meetings may be missing too.
    var gap = bat.incomplete && bowl.incomplete;
    var mk = function () { return CL.mark(gap, "May be lower than the true figure: some of their meetings may be in " + CL.F.nouns + " Cricsheet doesn’t have"); };
    if (gap) {
      warn += '<div class="notice"><strong>Incomplete record.</strong> Both players were playing ' +
        CL.gapWhen(completeFrom) + ", so some of their contests may not be counted. " +
        "Numbers marked † may be lower than the real head-to-head.</div>";
    }
    var avg = outs ? (runs / outs).toFixed(1) : "–";
    var verdict;
    if (balls >= SMALL) {
      var bpw = outs ? balls / outs : Infinity;
      if (outs && bpw < VERDICT[0]) verdict = esc(bowl.name) + " has had the better of it: a wicket every " + Math.round(bpw) + " balls.";
      else if (!outs || bpw > VERDICT[1]) verdict = esc(bat.name) + " has had the better of it: " + (outs ? "out only once every " + Math.round(bpw) + " balls." : "never dismissed by " + esc(bowl.name) + ".");
      else verdict = "Fairly even: a wicket every " + Math.round(bpw) + " balls.";
    }
    return '<div class="card"><h2>' + esc(bat.name) + ' <span class="muted">v</span> ' + esc(bowl.name) +
      (gap ? " " + CL.badge("Some of their meetings may be in " + CL.F.nouns + " that aren’t in Cricsheet, so these totals may be lower than the real head-to-head.") : "") + "</h2>" +
      '<p class="explain">Every ball ' + esc(bowl.name) + " has bowled to " + esc(bat.name) + " in men’s " + CL.F.nouns + " that Cricsheet covers." +
      (verdict ? " " + verdict : "") + "</p>" + warn +
      '<div class="stats">' +
      stat("Balls", n(balls) + mk(), "big") + stat("Runs", n(runs) + mk(), "big") + stat("Dismissals", outs + mk(), "big") +
      stat("Average", avg) + stat("Strike rate", balls ? (runs * 100 / balls).toFixed(1) : "–") +
      stat("Dot ball %", CL.pct(dots, balls, 1)) + stat("4s", fours + mk()) + stat("6s", sixes + mk()) +
      "</div>" +
      '<p class="explain section">Average = runs per dismissal. Strike rate = runs per 100 balls. Dot ball % = share of balls the batter scored nothing off. ' +
      "Balls include no-balls but not wides. Dismissals only count ones credited to the bowler (so not run outs).</p></div>";
  }

  function render() {
    var bat = state.bat && players.byId[state.bat];
    var bowl = state.bowl && players.byId[state.bowl];
    if (bat && bowl) {
      if (bat.id === bowl.id) { result.innerHTML = '<p class="empty">Pick two different players.</p>'; return; }
      result.innerHTML = '<p class="empty">Loading…</p>';
      CL.load("matchups/bat/" + bat.id + ".json").then(function (data) {
        var m = data[bowl.id];
        result.innerHTML = m ? headToHead(bat, bowl, m)
          : '<div class="card"><p class="empty">' + esc(bowl.name) + " never bowled to " + esc(bat.name) +
            " in the matches Cricsheet covers.</p></div>";
      }).catch(function (e) { CL.fail(result, e); });
    } else if (bat || bowl) {
      var role = bat ? "bat" : "bowl";
      result.innerHTML = '<p class="empty">Loading…</p>';
      CL.load("matchups/" + role + "/" + state[role] + ".json").then(function (data) {
        result.innerHTML = suggestions(role, data);
        Array.prototype.forEach.call(result.querySelectorAll(".chip"), function (a) {
          a.addEventListener("click", function (e) {
            e.preventDefault();
            state[role === "bat" ? "bowl" : "bat"] = a.dataset.id;
            renderSlot(role === "bat" ? "bowl" : "bat");
            updateUrl();
            render();
          });
        });
      }).catch(function () {
        result.innerHTML = '<div class="card"><p class="empty">No ' + (role === "bat" ? "balls faced" : "balls bowled") + " for this player in the data.</p></div>";
      });
    } else {
      result.innerHTML = '<p class="empty">Choose a batter and a bowler to begin, or try <a href="#" id="example">an example</a>.</p>';
      CL.$("#example").addEventListener("click", function (e) {
        e.preventDefault();
        var smith = CL.search("SPD Smith", players, 1)[0], jimmy = CL.search("JM Anderson", players, 1)[0];
        if (!smith || !jimmy) return;
        state.bat = smith.id; state.bowl = jimmy.id;
        renderSlot("bat"); renderSlot("bowl"); updateUrl(); render();
      });
    }
  }

  Promise.all([CL.players(), CL.meta, CL.settings]).then(function (res) {
    TINY = res[2].matchup_tiny;
    SMALL = res[2].matchup_small;
    players = res[0];
    completeFrom = res[1] && res[1].coverage ? res[1].coverage.complete_from : null;
    if (state.bat && !players.byId[state.bat]) state.bat = null;
    if (state.bowl && !players.byId[state.bowl]) state.bowl = null;
    renderSlot("bat");
    renderSlot("bowl");
    render();
  }).catch(function (e) { CL.fail(result, e); });
})();

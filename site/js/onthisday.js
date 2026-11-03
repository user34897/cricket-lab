/* "On this day" on the home page.
   data/<format>/onthisday/MM.json -> matches played in that month, newest first:
     { y: year, d: ["12-26", "12-27", ...] days played, t: [team, team], v: ground, r: result,
       h: highlights, e.g. ["100", id, name, runs, not out, team], ["5w", id, name, wkts, runs, team],
          ["10w", id, name, wkts, runs, team, "5/48 & 5/49"], ["chase", team, target], ["big", text], ["tie"] }
   Uses today's date in Melbourne. ?day=MM-DD shows another day. */
(function () {
  "use strict";
  var box = document.getElementById("otd");
  if (!box) return;
  var esc = CL.esc;
  var SHOW = 4;          // items shown before "Show more"
  var WEEK = 3;          // "This week": up to 3 days either side
  var MAX_HL = 5;        // highlights shown per match
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function melbourneToday() {
    var parts = {};
    new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date()).forEach(function (p) { parts[p.type] = p.value; });
    return parts.month + "-" + parts.day;
  }
  // Days are handled in a leap year (2024) so 29 February exists.
  function toDate(md) { return new Date(Date.UTC(2024, +md.slice(0, 2) - 1, +md.slice(3))); }
  function toMd(d) { return ("0" + (d.getUTCMonth() + 1)).slice(-2) + "-" + ("0" + d.getUTCDate()).slice(-2); }
  function shift(md, days) { var d = toDate(md); d.setUTCDate(d.getUTCDate() + days); return toMd(d); }
  function label(md) { return +md.slice(3) + " " + MONTHS[+md.slice(0, 2) - 1]; }
  // How many days apart two calendar days are, going round the year (e.g. 31 Dec and 1 Jan = 1).
  function apart(a, b) { var diff = Math.abs(toDate(a) - toDate(b)) / 864e5; return Math.min(diff, 366 - diff); }

  var today = melbourneToday();
  var day = /^\d\d-\d\d$/.test(CL.params.get("day") || "") ? CL.params.get("day") : today;
  var expanded = false;

  function month(md) { return CL.load("onthisday/" + md.slice(0, 2) + ".json").catch(function () { return []; }); }

  function player(id, name) { return '<a href="' + CL.link("player.html", { id: id }) + '">' + esc(name) + "</a>"; }

  // Tag labels follow the competition: "100" and "5 wkts" for Tests and ODIs, "75+" and "4 wkts" in T20s.
  var BAT_TAG = "100", BOWL_TAG = "5 wkts";
  function highlight(h) {
    switch (h[0]) {
      case "100": return '<span class="otd-hl"><span class="tag">' + (h[3] >= 100 ? "100" : BAT_TAG) + "</span>" + player(h[1], h[2]) + " " + h[3] + (h[4] ? "*" : "") + "</span>";
      case "5w": return '<span class="otd-hl"><span class="tag">' + (h[3] >= 5 ? h[3] + " wkts" : BOWL_TAG) + "</span>" + player(h[1], h[2]) + " " + h[3] + "/" + h[4] + "</span>";
      case "10w": return '<span class="otd-hl"><span class="tag">10 wkts</span>' + player(h[1], h[2]) + " " + h[3] + "/" + h[4] +
        (h[6] ? ' <span class="muted">(' + esc(h[6]) + ")</span>" : "") + "</span>";
      case "chase": return '<span class="otd-hl"><span class="tag tag-alt">Big chase</span>' + esc(h[1]) + " chased " + h[2] + "</span>";
      default: return "";
    }
  }

  function item(m, when) {
    var big = m.h.some(function (h) { return h[0] === "big"; });
    var tie = m.h.some(function (h) { return h[0] === "tie"; });
    var hls = m.h.map(highlight).filter(Boolean);
    var more = hls.length > MAX_HL ? '<span class="muted small">+' + (hls.length - MAX_HL) + " more</span>" : "";
    return '<li class="otd-item"><div class="otd-year">' + m.y + "</div><div>" +
      '<div class="otd-title"><strong>' + esc(m.t.join(" v ")) + '</strong> <span class="muted small">' + esc(m.v) + (when ? " · " + when : "") + "</span></div>" +
      '<div class="small">' + (big ? '<span class="tag tag-alt">Big win</span>' : "") + (tie ? '<span class="tag tag-alt">Tie</span>' : "") + esc(m.r) + "</div>" +
      (hls.length ? '<div class="otd-hls">' + hls.slice(0, MAX_HL).join("") + more + "</div>" : "") + "</div></li>";
  }

  function list(items) {
    var shown = expanded ? items : items.slice(0, SHOW);
    return '<ul class="otd-list">' + shown.join("") + "</ul>" +
      (items.length > SHOW ? '<button type="button" class="link-btn" id="otd-more">' +
        (expanded ? "Show fewer" : "Show " + (items.length - SHOW) + " more") + "</button>" : "");
  }

  function header(title, sub) {
    return '<div class="otd-head"><div><h2 style="margin:0">' + title + '</h2><p class="explain" style="margin:2px 0 0">' + sub + "</p></div>" +
      '<div class="otd-nav"><button type="button" class="icon-btn" data-step="-1" aria-label="Previous day">‹</button>' +
      '<button type="button" class="icon-btn" data-step="1" aria-label="Next day">›</button></div></div>' +
      (day !== today ? '<p class="small" style="margin:6px 0 0"><a href="#" id="otd-today">Back to today (' + label(today) + ")</a></p>" : "");
  }

  // render(matches for this day, matches for nearby days) is also handy for testing.
  function render(onDay, nearby) {
    var html;
    if (onDay.length) {
      html = header("On this day", "Men’s " + CL.F.nouns + " played on " + label(day) + " in past " + CL.periodWord + "s.") +
        list(onDay.map(function (m) { return item(m, m.d.length > 1 ? "Day " + (m.d.indexOf(day) + 1) : ""); }));
    } else if (nearby.length) {
      html = header("This week in " + (CL.F.league ? CL.F.label : CL.F.noun) + " history", "No " + CL.F.nouns + " in the data were played on " + label(day) + ", so here are the nearest days.") +
        list(nearby.map(function (x) { return item(x.m, label(x.md)); }));
    } else {
      html = header("On this day", "No " + CL.F.nouns + " in the data within a few days of " + label(day) + ".");
    }
    box.innerHTML = html;
    box.querySelectorAll("[data-step]").forEach(function (b) {
      b.addEventListener("click", function () { go(shift(day, +b.dataset.step)); });
    });
    var more = CL.$("#otd-more", box);
    if (more) more.addEventListener("click", function () { expanded = !expanded; render(onDay, nearby); });
    var back = CL.$("#otd-today", box);
    if (back) back.addEventListener("click", function (e) { e.preventDefault(); go(today); });
  }

  function go(md) {
    day = md;
    expanded = false;
    history.replaceState(null, "", CL.link("index.html", { day: day === today ? null : day, q: CL.params.get("q") }));
    load();
  }

  function load() {
    month(day).then(function (ms) {
      var onDay = ms.filter(function (m) { return m.d.indexOf(day) >= 0; });
      if (onDay.length) return render(onDay, []);
      // Nothing today: look up to WEEK days either side (which may be in the next or previous month).
      var mons = [shift(day, -WEEK), day, shift(day, WEEK)];
      return Promise.all(mons.map(month)).then(function (lists) {
        var seen = {}, nearby = [];
        lists.forEach(function (l) {
          l.forEach(function (m) {
            var key = m.y + m.t.join() + m.d[0];
            if (seen[key]) return;
            var best = null;
            m.d.forEach(function (md) { var gap = apart(md, day); if (gap <= WEEK && (!best || gap < best.gap)) best = { gap: gap, md: md }; });
            if (best) { seen[key] = 1; nearby.push({ m: m, md: best.md, gap: best.gap }); }
          });
        });
        nearby.sort(function (a, b) { return a.gap - b.gap || b.m.y - a.m.y; });
        render([], nearby);
      });
    }).catch(function (e) { CL.fail(box, e); });
  }

  CL.onThisDay = { render: render, go: go };
  CL.settings.then(function (st) {
    BAT_TAG = st.otd.bat >= 100 ? "100" : st.otd.bat + "+";
    BOWL_TAG = st.otd.bowl + " wkts";
  }).then(load, load);
})();

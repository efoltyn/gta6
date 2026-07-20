/* =============================================================================
 *  familypanel.js — W12: THE FAMILY PANEL.
 * -----------------------------------------------------------------------------
 *  THE WHY: W6-W11 built a real, persistent family tree (familytree.js),
 *  households (housing.js), inheritance (inheritance.js) and births
 *  (births.js) — but none of it is VISIBLE. Marriages, kids, dynasties and
 *  who-inherits-what all happen silently in a flat edge array. This file is
 *  the read-only window onto that state — captives.js's exact template
 *  (self-styled DOM, guard-built once, a single toggle key, a cheap poll
 *  while open). It invents nothing: every number here is derived from
 *  CBZ.cityFamilyTree's edges + CBZ.cityLedgerEntry/cityLedgerLive names.
 *
 *  TOGGLE KEY AUDIT (see the header of the build step for the full grep):
 *  captives.js already claims [U]; the "obvious" picks the build step named
 *  ([F] then [V]) are BOTH real, live conflicts — not just "also mapped
 *  somewhere":
 *    - [F] is the FPS fire-control key (systems/fpsmode.js, fires whenever
 *      fps.active || shoulderActive() and a weapon's armed — i.e. any time
 *      you're mid-gunfight), systems/capture.js's panic-fire, and
 *      net/networld.js's guest car-request — three separate, frequently-hit
 *      bindings, one of them core combat. Rejected outright.
 *    - [V] is city/view.js's first/third-person toggle, live and UNGATED
 *      any time you're on foot in the city with no menu open — i.e. exactly
 *      the ordinary walking-around state this panel would be opened from.
 *      Also rejected.
 *  Every other single letter turned out to be bound to SOMETHING too (a
 *  city-wide grep turns up all 26), but most are narrowly gated to a
 *  specific submenu already being open (empire's [L] launder / wealth's [L]
 *  launder only fire while THEIR OWN panel is open; interactions.js's
 *  i/j/k/l contextual slots only fire when a nearby ped/prop is actually
 *  offering that slot's verb) — i.e. dormant during ordinary play, the same
 *  bar [U] clears for captives.js. [L] is the pick: FAMILY reads to
 *  "Lineage" well enough, and it's the most narrowly-gated letter available.
 *
 *  DATA (all read-only, all optional-chained — no-ops if a dependency
 *  hasn't loaded):
 *    - CBZ.cityFamilyTree.serialize() : {edges, dead} — the entire tree.
 *      Dynasties = connected components over the edge graph (union-find);
 *      cheap at current scale (the tree is a marriage/birth roster, not the
 *      whole city).
 *    - CBZ.cityLedgerEntry(sid)/cityLedgerLive(sid) : name/arch lookups.
 *    - g.citySpouseSid / g.citySpouse / g.cityPartner (social.js, W7) : the
 *      player's own marriage state. NOTE: the player has no sid in the tree
 *      yet (family.js's castFamilies explicitly skips wiring "mine" —
 *      there's no ped-with-a-sid to be the head) — so kidsOf(player) can
 *      never resolve. We say so plainly rather than fake a result, and fall
 *      back to CBZ.cityFamilies' "mine" record (your yard-bound wife/kids)
 *      for whatever IS known.
 * ========================================================================== */
(function () {
  "use strict";
  if (typeof window === "undefined" || !window.CBZ) return;
  var CBZ = window.CBZ;

  var KEY = "l";             // see the audit above — F and V are both live conflicts
  var KEY_LABEL = "L";

  // ---- small safe accessors -------------------------------------------------
  function game() { return CBZ.game || {}; }
  function inCity() { return game().mode === "city"; }
  function num(v, d) { return (typeof v === "number" && isFinite(v)) ? v : d; }

  function nameOf(sid) {
    if (!sid) return null;
    var live = CBZ.cityLedgerLive && CBZ.cityLedgerLive(sid);
    if (live && live.name) return live.name;
    var e = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(sid);
    if (e && e.name) return e.name;
    return "Someone";
  }
  function archOf(sid) {
    var live = CBZ.cityLedgerLive && CBZ.cityLedgerLive(sid);
    if (live && live.archetype) return live.archetype;
    var e = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(sid);
    return (e && e.arch) || null;
  }
  function surnameOf(fullName) {
    if (!fullName) return null;
    var parts = String(fullName).trim().split(/\s+/);
    return parts.length > 1 ? parts[parts.length - 1] : null;
  }

  // "notable" flavor — the same archetype strings peds.js/social.js mint for
  // bosses/VIPs and the spouses weaveFamilies gives them.
  var NOTABLE = { boss: "Boss", billionaire: "Billionaire", tycoon: "Tycoon",
    socialite: "Socialite", mobwife: "Mob Wife", tycoonwife: "Tycoon's Wife" };
  var NOTABLE_PRIORITY = ["boss", "billionaire", "tycoon", "mobwife", "tycoonwife", "socialite"];

  // ===========================================================================
  //  DYNASTIES — connected components over the family tree's edge graph.
  //  Cheap union-find; the tree is a marriage/birth roster, not the whole city.
  // ===========================================================================
  function computeDynasties(edges, deadSet) {
    var parent = new Map();
    function find(x) {
      if (!parent.has(x)) parent.set(x, x);
      var root = x;
      while (parent.get(root) !== root) root = parent.get(root);
      // path compression
      while (parent.get(x) !== root) { var next = parent.get(x); parent.set(x, root); x = next; }
      return root;
    }
    function union(a, b) {
      var ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    }
    for (var i = 0; i < edges.length; i++) union(edges[i].a, edges[i].b);

    var groups = new Map(); // root -> sid[]
    parent.forEach(function (_v, sid) {
      var r = find(sid);
      var arr = groups.get(r);
      if (!arr) { arr = []; groups.set(r, arr); }
      arr.push(sid);
    });

    var out = [];
    groups.forEach(function (members) {
      var surnameCount = new Map(), notable = [], bestSid = null, bestPri = 99;
      var alive = 0;
      for (var j = 0; j < members.length; j++) {
        var sid = members[j];
        if (!deadSet.has(sid)) alive++;
        var nm = nameOf(sid);
        var sur = surnameOf(nm);
        if (sur) surnameCount.set(sur, (surnameCount.get(sur) || 0) + 1);
        var arch = archOf(sid);
        if (arch && NOTABLE[arch]) {
          notable.push(nm + " (" + NOTABLE[arch] + ")");
          var pri = NOTABLE_PRIORITY.indexOf(arch); if (pri < 0) pri = 90;
          if (pri < bestPri) { bestPri = pri; bestSid = sid; }
        }
      }
      var surname = "Unknown";
      var bestCount = 0;
      surnameCount.forEach(function (c, s) { if (c > bestCount) { bestCount = c; surname = s; } });
      out.push({
        members: members, size: members.length, alive: alive,
        surname: surname, notable: notable.slice(0, 3),
        head: bestSid || members[0],
      });
    });
    out.sort(function (a, b) { return b.size - a.size; });
    return out;
  }

  function heirChain(head, maxLen) {
    var FT = CBZ.cityFamilyTree;
    var chain = [head], cur = head, seen = { };
    seen[head] = true;
    for (var i = 0; i < (maxLen || 3) - 1; i++) {
      var h = FT.heirOf(cur);
      if (!h || seen[h]) break;
      chain.push(h); seen[h] = true; cur = h;
    }
    return chain.map(nameOf);
  }

  // ===========================================================================
  //  RECENT — last ~8 family events, newest first. Derived from since/end
  //  stamps already on the edges (no separate event log exists).
  // ===========================================================================
  function recentEvents(edges, deadSet, limit) {
    var out = [], seenBirth = {};
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      var an = nameOf(e.a), bn = nameOf(e.b);
      if (e.k === "pc") {
        if (seenBirth[e.b]) continue;   // bearChild() writes one pc edge per
        seenBirth[e.b] = true;          // parent — collapse to one birth line
        out.push({ t: e.since, text: "" + bn + " born to " + an });
      } else if (e.k === "sp") {
        if (e.end == null) {
          out.push({ t: e.since, text: "" + an + " married " + bn });
        } else if (e.why === "death") {
          var dead = deadSet.has(e.a) ? e.a : (deadSet.has(e.b) ? e.b : null);
          var live = dead === e.a ? e.b : e.a;
          out.push({ t: e.end, text: "" + (dead ? nameOf(dead) : an) + " passed — " + (dead ? nameOf(live) : bn) + " mourns" });
        } else {
          out.push({ t: e.end, text: "" + an + " and " + bn + " divorced" });
        }
      }
    }
    out.sort(function (a, b) { return b.t - a.t; });
    return out.slice(0, limit || 8);
  }

  // ===========================================================================
  //  DOM — self-styled overlay, built once (captives.js's own convention).
  // ===========================================================================
  var panel = null, panelBody = null, built = false, openState = false;

  function el(tag, css, text) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }
  function sectionTitle(text, accent) {
    return el("div",
      "font:700 12px system-ui;letter-spacing:1px;text-transform:uppercase;" +
      "color:" + (accent || "#9fb6da") + ";margin:10px 0 8px;", text);
  }
  function row(text, css) {
    return el("div", "font:13px system-ui;color:#dfe6f5;padding:3px 0;" + (css || ""), text);
  }
  function card() {
    return el("div",
      "background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);" +
      "border-radius:9px;padding:9px 11px;margin-bottom:8px;");
  }

  function build() {
    if (built || typeof document === "undefined" || !document.body) return;
    built = true;

    panel = el("div",
      "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);" +
      "z-index:9001;width:min(500px,92vw);max-height:82vh;overflow:auto;" +
      "font:14px/1.45 system-ui,Segoe UI,Roboto,sans-serif;color:#eef;" +
      "background:rgba(14,16,22,0.94);border:1px solid rgba(120,150,200,0.35);" +
      "border-radius:14px;padding:0;display:none;backdrop-filter:blur(6px);" +
      "box-shadow:0 18px 60px rgba(0,0,0,0.7);");

    var head = el("div",
      "display:flex;align-items:center;justify-content:space-between;" +
      "padding:13px 16px;border-bottom:1px solid rgba(120,150,200,0.22);");
    head.appendChild(el("div", "font:700 15px system-ui;letter-spacing:0.3px;color:#fff;", "Family"));
    var close = el("div", "cursor:pointer;font:700 18px system-ui;color:#9aa6bd;padding:0 4px;", "✕");
    close.addEventListener("click", function () { hide(); });
    head.appendChild(close);
    panel.appendChild(head);

    panelBody = el("div", "padding:12px 16px 16px;");
    panel.appendChild(panelBody);

    panel.appendChild(el("div",
      "padding:9px 16px 13px;color:#7e8aa3;font:12px system-ui;" +
      "border-top:1px solid rgba(120,150,200,0.15);",
      "Press [" + KEY_LABEL + "] or ✕ to close"));

    document.body.appendChild(panel);
  }

  // ---- gather + render -------------------------------------------------------
  function renderYourFamily(deadSet) {
    var g = game(), out = [];
    var c1 = card();
    if (g.citySpouse && g.citySpouseSid) {
      var alive = !deadSet.has(g.citySpouseSid);
      c1.appendChild(row("Married to " + nameOf(g.citySpouseSid) + (alive ? "" : " (deceased)")));
    } else if (g.cityPartner && g.cityPartner.name) {
      c1.appendChild(row("Seeing " + g.cityPartner.name + (g.cityPartner.dead ? " (deceased)" : "")));
    } else {
      c1.appendChild(row("No partner yet.", "color:#8a93a8;"));
    }
    c1.appendChild(row("Kids: player-in-tree pending — you have no sid on the family tree yet, so kidsOf() can't resolve. Showing your household record instead:", "color:#8a93a8;font:12px system-ui;margin-top:4px;"));
    out.push(c1);

    var fam = (CBZ.cityFamilies || []).find(function (f) { return f && f.mine; });
    var c2 = card();
    if (fam && fam.members && fam.members.length) {
      for (var i = 0; i < fam.members.length; i++) {
        var m = fam.members[i];
        if (!m) continue;
        c2.appendChild(row((m._role === "kid" ? "" : "") + (m.name || "Someone") + " — " + (m.famRole || m._role || "") + (m.dead ? " (deceased)" : "")));
      }
    } else {
      c2.appendChild(row("No household record yet.", "color:#8a93a8;"));
    }
    out.push(c2);
    return out;
  }

  function renderDynasties(dynasties) {
    var out = [];
    if (!dynasties.length) { out.push(row("No dynasties formed yet.", "color:#8a93a8;")); return out; }
    var top = dynasties.slice(0, 5);
    for (var i = 0; i < top.length; i++) {
      var d = top[i];
      var c = card();
      c.appendChild(row("House " + d.surname, "font:600 14px system-ui;color:#ffd;"));
      c.appendChild(row(d.size + " members · " + d.alive + " alive", "color:#9aa6bd;font:12px system-ui;"));
      if (d.notable.length) c.appendChild(row("★ " + d.notable.join(", "), "color:#e8c84a;font:12px system-ui;"));
      if (i === 0) {
        var chain = heirChain(d.head, 3);
        if (chain.length > 1) c.appendChild(row("Heir chain: " + chain.join(" → "), "color:#9fd6a0;font:12px system-ui;margin-top:3px;"));
      }
      out.push(c);
    }
    return out;
  }

  function renderRecent(events) {
    var out = [];
    if (!events.length) { out.push(row("Nothing yet.", "color:#8a93a8;")); return out; }
    for (var i = 0; i < events.length; i++) out.push(row(events[i].text));
    return out;
  }

  function refresh() {
    if (!openState) return;
    if (!built) build();
    if (!panelBody) return;
    var FT = CBZ.cityFamilyTree;
    if (!FT) { panelBody.innerHTML = ""; panelBody.appendChild(row("Family tree unavailable.", "color:#8a93a8;")); return; }
    var snap = FT.serialize();
    var edges = snap.edges || [];
    var deadSet = new Set(snap.dead || []);

    panelBody.innerHTML = "";
    panelBody.appendChild(sectionTitle("Your family", "#9fd6a0"));
    var yf = renderYourFamily(deadSet);
    for (var i = 0; i < yf.length; i++) panelBody.appendChild(yf[i]);

    panelBody.appendChild(sectionTitle("Dynasties", "#e8c84a"));
    var dynasties = computeDynasties(edges, deadSet);
    var dy = renderDynasties(dynasties);
    for (var j = 0; j < dy.length; j++) panelBody.appendChild(dy[j]);

    panelBody.appendChild(sectionTitle("Recent", "#9fb6da"));
    var events = recentEvents(edges, deadSet, 8);
    var re = renderRecent(events);
    for (var k = 0; k < re.length; k++) panelBody.appendChild(re[k]);
  }

  // ===========================================================================
  //  OPEN/CLOSE + REFRESH CADENCE — refresh on open, then every ~2s while open.
  // ===========================================================================
  function open() {
    if (!inCity()) return;
    build();
    if (!panel) return;
    openState = true;
    panel.style.display = "block";
    refresh();
  }
  function hide() {
    openState = false;
    if (panel) panel.style.display = "none";
  }
  function toggle() { if (openState) hide(); else open(); }

  var _acc = 0;
  if (typeof CBZ.onUpdate === "function") {
    CBZ.onUpdate(39.1, function (dt) {
      if (!openState) return;
      if (!inCity()) { hide(); return; }
      _acc += (typeof dt === "number" ? dt : 0.016);
      if (_acc < 2.0) return;
      _acc = 0;
      refresh();
    });
  } else {
    setInterval(function () { if (openState) refresh(); }, 2000);
  }

  // ---- key toggle -------------------------------------------------------------
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("keydown", function (e) {
      if (!e || e.repeat) return;
      var tgt = e.target;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable)) return;
      if ((e.key || "").toLowerCase() !== KEY) return;
      if (!inCity()) return;
      // COLLISION GUARD: city/interactions.js's contextual slots (e/i/j/k/l)
      // fire on the SAME raw "l" keydown whenever a nearby ped/prop is
      // actually offering that slot's verb (charpanel.js's own [I] guard uses
      // this identical feature-detected pattern — see its cityInteractHasSlot
      // call). Defer to a live world interaction instead of double-firing:
      // if something is offering an "l" verb right now, let it win and don't
      // open/close the family panel this press.
      if (CBZ.cityInteractHasSlot && CBZ.cityInteractHasSlot("l")) return;
      e.preventDefault();
      e.stopPropagation();
      toggle();
    }, true);
  }

  CBZ.cityFamilyPanel = { open: open, hide: hide, toggle: toggle, refresh: refresh, key: KEY };
})();

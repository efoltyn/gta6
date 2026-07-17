/* =============================================================================
 *  captives.js — "WHO DO I HAVE, AND WHO DID THEY TAKE FROM ME?"
 * -----------------------------------------------------------------------------
 *  THE WHY (owner's complaint, verbatim): "WHEN SOMEONE IS KIDNAPPED I DONT
 *  EVEN SEE THEM." You grab/cuff someone and stuff them in a trunk, or an enemy
 *  crew snatches your family — and the game shows you nothing. A captive in a
 *  car is visible=false (restrain.js hides them off-board), so the single most
 *  consequential thing you're doing (holding a person, or losing one) is the
 *  ONLY thing with no UI. This file makes captives VISIBLE — nothing more.
 *
 *  It does NOT invent a stat or a minigame. It reads state other systems
 *  already own and surfaces it:
 *    - PEOPLE YOU'RE HOLDING: scan CBZ.cityPeds for `.restraint` (restrain.js
 *      sets ped.restraint = {state:'cuffed'|'escorted'|'in_vehicle'|'grappled',
 *      by, t, vehicle}). The internal `restrained` array isn't exported, so we
 *      scan peds — same source of truth, no coupling. Bounty via
 *      CBZ.cityRestrain.bountyFor / isWanted when present.
 *    - YOUR FAMILY TAKEN: family.js flags the snatched ped `m._kidnapped =
 *      gangId` on a member of CBZ.cityFamilies (the player family is gangId 0).
 *      A romance partner path also exists: g.cityPartner.kidnapped (social.js).
 *      Both are read defensively. Ransom/time-left live in family.js's private
 *      `kidnap` record; if a getter is exposed later we read it, else we show
 *      what the ped + waypoint give us.
 *
 *  Surfacing, three layers (progressive disclosure — contextual HUD pattern):
 *    1) persistent mini badge (top-left) — appears ONLY when you hold someone
 *       or family is taken: "🔒 2 held · 1 taken". Click it to open the panel.
 *    2) full panel toggled by [U] (verified free: c/e/f/h/n/r/t/v/y/g are
 *       taken; U is unused) — the two lists, distance, bounty, ransom, clock,
 *       and a "Locate" that drops a fullmap waypoint.
 *    3) toasts on the moments that matter — first stuff-in-trunk, and a family
 *       snatch — so it's never missed.
 *
 *  Self-contained DOM. Touches no other file. No-ops outside city mode and
 *  whenever an export it needs is absent.
 *
 *  ---------------------------------------------------------------------
 *  KEY OWNERSHIP — [U] is a CONTEXTUAL, three-way-shared key (origins.js's
 *  character wheel / wealth.js's business-upgrade both also bind it):
 *    - This module registers its keydown listener in the CAPTURE phase (see
 *      below), so without a guard it would swallow EVERY press of U in city
 *      mode before origins.js's wheel (bubble phase) ever saw the event —
 *      the wheel would never open. FIXED: we only claim the key (preventDefault
 *      + stopPropagation + toggle) when there is something of ours to show
 *      (an active hold/taken — hasAnyCustody()) OR our own panel is already
 *      open (so U can close it). Any other press falls through untouched to
 *      origins.js's wheel handler.
 *    - wealth.js's U (upgrade-business) is gated inside its OWN open-panel
 *      check (`if (open_) { ... if (k==='u') ... }`) — verified panel-gated,
 *      left as-is.
 *    - origins.js's wheel additionally checks CBZ.cityCaptivesHudOpen()
 *      before opening (defense in depth, in case ownership here ever changes).
 *  ---------------------------------------------------------------------
 * ========================================================================== */
(function () {
  "use strict";
  if (typeof window === "undefined" || !window.CBZ) return;
  var CBZ = window.CBZ;

  var KEY = "u";            // the toggle key (verified free)
  var KEY_LABEL = "U";

  // ---- small safe accessors -------------------------------------------------
  function game() { return CBZ.game || {}; }
  function inCity() { return game().mode === "city"; }
  function player() { return CBZ.player || (CBZ.city && CBZ.city.player) || null; }
  function ppos() {
    var p = player();
    return (p && p.pos) ? p.pos : { x: 0, y: 0, z: 0 };
  }
  function num(v, d) { return (typeof v === "number" && isFinite(v)) ? v : d; }
  function nm(p, fb) { return (p && (p.name || p.desc)) || fb || "Someone"; }

  function dist2D(a, bx, bz) {
    if (!a) return Infinity;
    var ax = num(a.x, 0), az = num(a.z, 0);
    return Math.hypot(ax - bx, az - bz);
  }
  function fmtDist(d) {
    if (!isFinite(d)) return "—";
    if (d < 1) return "here";
    return Math.round(d) + "m";
  }
  function fmtMoney(n) {
    n = Math.round(num(n, 0));
    try { return "$" + n.toLocaleString(); } catch (e) { return "$" + n; }
  }
  function fmtClock(secs) {
    secs = Math.max(0, Math.round(num(secs, 0)));
    var m = Math.floor(secs / 60), s = secs % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function setWaypoint(x, z, label) {
    if (CBZ.fullMap && typeof CBZ.fullMap.setWaypoint === "function") {
      CBZ.fullMap.setWaypoint(x, z, label);
      return true;
    }
    return false;
  }
  function toast(text, secs) {
    if (CBZ.city && typeof CBZ.city.note === "function") CBZ.city.note(text, secs || 4);
  }

  // ===========================================================================
  //  DATA — gather the two lists from already-owned state.
  // ===========================================================================
  var R = function () { return CBZ.cityRestrain || null; };

  // state -> human label
  function holdStatus(state) {
    switch (state) {
      case "cuffed": return "Cuffed";
      case "escorted": return "Marching";
      case "in_vehicle": return "In the trunk";
      case "grappled": return "In a clinch";
      default: return "Held";
    }
  }
  function holdIcon(state) {
    switch (state) {
      case "in_vehicle": return "🚗";
      case "escorted": return "🚶";
      case "grappled": return "🤼";
      default: return "🔒";
    }
  }

  // PEOPLE YOU'RE HOLDING — scan peds for a restraint record placed by you.
  function gatherHeld() {
    var out = [];
    var peds = CBZ.cityPeds;
    if (!peds || !peds.length) return out;
    var pos = ppos();
    var rx = R();
    for (var i = 0; i < peds.length; i++) {
      var p = peds[i];
      if (!p || p.dead || !p.restraint) continue;
      var r = p.restraint;
      // only the ones YOU hold (restrain.js stamps by:"player")
      if (r.by && r.by !== "player") continue;
      var pp = p.pos || (r.vehicle && r.vehicle.pos) || pos;
      var bounty = 0, wanted = false;
      if (rx) {
        try { if (typeof rx.isWanted === "function") wanted = !!rx.isWanted(p); } catch (e) {}
        try { if (wanted && typeof rx.bountyFor === "function") bounty = rx.bountyFor(p) | 0; } catch (e2) {}
      }
      out.push({
        ped: p,
        name: nm(p, "Captive"),
        state: r.state,
        status: holdStatus(r.state),
        icon: holdIcon(r.state),
        dist: dist2D(pp, pos.x, pos.z),
        x: num(pp.x, pos.x), z: num(pp.z, pos.z),
        bounty: bounty, wanted: wanted
      });
    }
    out.sort(function (a, b) { return a.dist - b.dist; });
    return out;
  }

  // YOUR FAMILY TAKEN — family member with _kidnapped set, or a kidnapped
  // romance partner. family.js keeps ransom/time in a private record; read a
  // getter if one ever appears, else fall back to the ped + its waypoint.
  function kidnapRecord() {
    // future-proof: if family.js exposes the live record, prefer it.
    var k = CBZ.cityKidnap || CBZ.activeKidnap || null;
    if (k && typeof k === "function") { try { k = k(); } catch (e) { k = null; } }
    return (k && k.ped) ? k : null;
  }
  function gatherTaken() {
    var out = [];
    var seen = [];
    var pos = ppos();
    var rec = kidnapRecord();

    function add(ped, info) {
      if (!ped || seen.indexOf(ped) >= 0) return;
      seen.push(ped);
      var pp = ped.pos || (info && info.coords) || null;
      // captor coords: live ped pos > record x/z > nothing
      var cx = pp ? num(pp.x, NaN) : NaN, cz = pp ? num(pp.z, NaN) : NaN;
      if (!isFinite(cx) && info) { cx = num(info.x, NaN); cz = num(info.z, NaN); }
      out.push({
        ped: ped,
        name: nm(ped, "Family"),
        crew: (info && info.crew) || crewName(ped, info),
        ransom: info ? num(info.ransom, 0) : 0,
        timeLeft: info ? num(info.t, NaN) : NaN,
        x: cx, z: cz,
        hasCoords: isFinite(cx) && isFinite(cz)
      });
    }

    // 1) the family.js kidnap (record gives ransom/time/coords)
    if (rec) {
      add(rec.ped, {
        ransom: rec.ransom, t: rec.t, x: rec.x, z: rec.z,
        crew: rec.gangName || gangNameById(rec.gangId)
      });
    }
    // 2) scan family members flagged _kidnapped (works even with no record)
    var fams = CBZ.cityFamilies;
    if (fams && fams.length) {
      for (var i = 0; i < fams.length; i++) {
        var f = fams[i];
        if (!f || f.gangId || !f.members) continue;   // gangId 0/falsy = the player's
        for (var j = 0; j < f.members.length; j++) {
          var m = f.members[j];
          if (m && (m.kidnapped || m._kidnapped)) {
            add(m, { crew: gangNameById(m.captiveOf || m._kidnapped) });
          }
        }
      }
    }
    // 3) romance partner path (social.js: g.cityPartner.kidnapped)
    var g = game();
    if (g.cityPartner && g.cityPartner.kidnapped) {
      add(g.cityPartner, { crew: g.cityPartner.captorCrew || "" });
    }
    return out;
  }

  function gangNameById(id) {
    if (!id) return "";
    var gs = CBZ.cityGangs;
    if (gs && gs.length) {
      for (var i = 0; i < gs.length; i++) {
        if (gs[i] && gs[i].id === id) return gs[i].name || "";
      }
    }
    return "";
  }
  function crewName(ped, info) {
    if (info && info.crew) return info.crew;
    if (ped && (ped.kidnapped || ped._kidnapped)) {
      return gangNameById(ped.captiveOf || ped._kidnapped);
    }
    return "";
  }

  // ===========================================================================
  //  DOM — a mini badge + a full panel, both built once, styled inline.
  // ===========================================================================
  var badge = null, panel = null, panelBody = null, built = false;

  function el(tag, css, text) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }

  function build() {
    if (built || typeof document === "undefined" || !document.body) return;
    built = true;

    // ---- persistent mini badge (top-left, below where minimap usually sits)
    badge = el("div",
      "position:fixed;left:12px;top:96px;z-index:9000;" +
      "font:600 13px/1.2 system-ui,Segoe UI,Roboto,sans-serif;color:#ffe;" +
      "background:rgba(18,10,12,0.82);border:1px solid rgba(255,120,120,0.55);" +
      "border-left:4px solid #ff5a5a;border-radius:8px;padding:6px 10px;" +
      "cursor:pointer;display:none;backdrop-filter:blur(3px);" +
      "box-shadow:0 3px 12px rgba(0,0,0,0.5);user-select:none;");
    badge.addEventListener("click", function () { open(); });
    document.body.appendChild(badge);

    // ---- full panel (centered card, hidden by default)
    panel = el("div",
      "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);" +
      "z-index:9001;width:min(460px,92vw);max-height:80vh;overflow:auto;" +
      "font:14px/1.45 system-ui,Segoe UI,Roboto,sans-serif;color:#eef;" +
      "background:rgba(14,16,22,0.94);border:1px solid rgba(120,150,200,0.35);" +
      "border-radius:14px;padding:0;display:none;backdrop-filter:blur(6px);" +
      "box-shadow:0 18px 60px rgba(0,0,0,0.7);");

    var head = el("div",
      "display:flex;align-items:center;justify-content:space-between;" +
      "padding:13px 16px;border-bottom:1px solid rgba(120,150,200,0.22);");
    head.appendChild(el("div",
      "font:700 15px system-ui;letter-spacing:0.3px;color:#fff;",
      "🔒 Custody"));
    var close = el("div",
      "cursor:pointer;font:700 18px system-ui;color:#9aa6bd;padding:0 4px;",
      "✕");
    close.addEventListener("click", function () { hide(); });
    head.appendChild(close);
    panel.appendChild(head);

    panelBody = el("div", "padding:12px 16px 16px;");
    panel.appendChild(panelBody);

    var foot = el("div",
      "padding:9px 16px 13px;color:#7e8aa3;font:12px system-ui;" +
      "border-top:1px solid rgba(120,150,200,0.15);",
      "Press [" + KEY_LABEL + "] or ✕ to close · Locate drops a map waypoint");
    panel.appendChild(foot);

    document.body.appendChild(panel);
  }

  // ---- row builders ---------------------------------------------------------
  function sectionTitle(text, accent) {
    return el("div",
      "font:700 12px system-ui;letter-spacing:1px;text-transform:uppercase;" +
      "color:" + (accent || "#9fb6da") + ";margin:6px 0 8px;", text);
  }
  function locateBtn(x, z, label) {
    var b = el("button",
      "margin-left:auto;cursor:pointer;font:600 12px system-ui;color:#cfe;" +
      "background:rgba(80,140,220,0.22);border:1px solid rgba(120,170,230,0.5);" +
      "border-radius:6px;padding:4px 9px;white-space:nowrap;", "📍 Locate");
    b.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (!isFinite(x) || !isFinite(z)) { toast("No fix on their location yet.", 2.5); return; }
      if (setWaypoint(x, z, label)) toast("📍 Waypoint set: " + label, 3);
      else toast("Map waypoints unavailable.", 2.5);
    });
    return b;
  }
  function card(inner) {
    var c = el("div",
      "display:flex;align-items:center;gap:10px;" +
      "background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);" +
      "border-radius:9px;padding:9px 11px;margin-bottom:8px;");
    return c;
  }

  function renderPanel(held, taken) {
    if (!panelBody) return;
    panelBody.innerHTML = "";

    if (!held.length && !taken.length) {
      panelBody.appendChild(el("div",
        "color:#8a93a8;text-align:center;padding:18px 6px;font:14px system-ui;",
        "No one in custody.\nNobody held, nobody taken."));
      return;
    }

    // FAMILY TAKEN first — it's the higher-stakes, time-critical list.
    if (taken.length) {
      panelBody.appendChild(sectionTitle("🕯 Your people taken", "#ff8a8a"));
      for (var i = 0; i < taken.length; i++) {
        var t = taken[i];
        var c = card();
        c.style.borderColor = "rgba(255,90,90,0.4)";
        var info = el("div", "min-width:0;");
        info.appendChild(el("div", "font:600 14px system-ui;color:#ffd;", t.name));
        var sub = [];
        if (t.crew) sub.push("by the " + t.crew);
        if (t.ransom > 0) sub.push("ransom " + fmtMoney(t.ransom));
        if (isFinite(t.timeLeft)) sub.push("⏱ " + fmtClock(t.timeLeft) + " left");
        info.appendChild(el("div", "font:12px system-ui;color:#d99;", sub.join(" · ") || "Snatched off the street"));
        c.appendChild(info);
        c.appendChild(locateBtn(t.x, t.z, "GET " + (t.name || "FAMILY").toUpperCase() + " BACK"));
        panelBody.appendChild(c);
      }
    }

    // PEOPLE YOU'RE HOLDING.
    if (held.length) {
      panelBody.appendChild(sectionTitle("🔒 People you're holding", "#9fd6a0"));
      for (var j = 0; j < held.length; j++) {
        var h = held[j];
        var hc = card();
        var hi = el("div", "min-width:0;");
        hi.appendChild(el("div", "font:600 14px system-ui;color:#eef;",
          h.icon + " " + h.name));
        var hsub = [h.status, fmtDist(h.dist) + " away"];
        if (h.wanted && h.bounty > 0) hsub.push("bounty " + fmtMoney(h.bounty));
        else if (!h.wanted) hsub.push("clean — no paper");
        hi.appendChild(el("div", "font:12px system-ui;color:#9aa6bd;", hsub.join(" · ")));
        hc.appendChild(hi);
        hc.appendChild(locateBtn(h.x, h.z, h.name));
        panelBody.appendChild(hc);
      }
    }
  }

  // ===========================================================================
  //  REFRESH LOOP — badge + panel kept live, throttled, contextual.
  // ===========================================================================
  var openState = false;
  var lastHeldCount = 0;     // for the "first stuffed in trunk" toast
  var lastInVehicle = 0;
  var lastTakenCount = 0;    // for the "family taken" toast
  var prevNames = {};        // remember held names so we don't re-toast

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
  function toggle() {
    if (openState) hide(); else open();
  }

  function refresh() {
    if (!built) build();
    if (!inCity()) {
      if (badge) badge.style.display = "none";
      if (openState) hide();
      return;
    }
    var held = gatherHeld();
    var taken = gatherTaken();

    // ---- transition toasts ------------------------------------------------
    var inVehNow = 0;
    for (var i = 0; i < held.length; i++) if (held[i].state === "in_vehicle") inVehNow++;
    if (inVehNow > lastInVehicle) {
      toast("📦 Captive in the trunk — press [" + KEY_LABEL + "] to track them.", 4.5);
    }
    lastInVehicle = inVehNow;
    lastHeldCount = held.length;

    if (taken.length > lastTakenCount) {
      // family.js already fires its own line on snatch; we add the "press U"
      // affordance so the player learns the panel exists at the exact moment.
      toast("⚠ Family taken — press [" + KEY_LABEL + "] to see who & where.", 5);
    }
    lastTakenCount = taken.length;

    // ---- persistent badge -------------------------------------------------
    if (badge) {
      if (taken.length) {
        // A captive count looked exactly like a failed vehicle-lock counter.
        // Ordinary custody remains in its panel; only the urgent family-
        // abduction state earns persistent HUD space.
        badge.textContent = "⚠ " + taken.length;
        badge.style.display = "block";
        badge.style.borderLeftColor = "#ff3030";
      } else {
        badge.style.display = "none";
      }
    }

    // ---- open panel contents ---------------------------------------------
    if (openState) renderPanel(held, taken);
  }

  // ~4 Hz refresh via the engine update bus when available; else setInterval.
  if (typeof CBZ.onUpdate === "function") {
    var acc = 0;
    CBZ.onUpdate(39.0, function (dt) {
      acc += (typeof dt === "number" ? dt : 0.016);
      if (acc < 0.25) return;
      acc = 0;
      refresh();
    });
  } else {
    setInterval(refresh, 250);
  }

  // does this module have any reason at all to claim [U] right now?
  function hasAnyCustody() {
    return gatherHeld().length > 0 || gatherTaken().length > 0;
  }

  // ---- key toggle -----------------------------------------------------------
  // CAPTURE-phase listener (see KEY OWNERSHIP note up top): only claims the
  // key when there's a held/taken captive to show, or our panel is already
  // open (so U closes it) — otherwise it does NOT preventDefault/stopPropagation
  // and the press falls through to origins.js's character wheel (bubble phase).
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("keydown", function (e) {
      if (!e || e.repeat) return;
      // don't steal the key while typing into an input/textarea.
      var tgt = e.target;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable)) return;
      if ((e.key || "").toLowerCase() !== KEY) return;
      if (!inCity()) return;
      if (!openState && !hasAnyCustody()) return;   // nothing of ours — let it fall through
      e.preventDefault();
      e.stopPropagation();
      toggle();
    }, true);
  }

  // small handle for debugging / other systems.
  CBZ.cityCaptives = {
    open: open, hide: hide, toggle: toggle, refresh: refresh,
    held: gatherHeld, taken: gatherTaken, key: KEY,
    hudOpen: function () { return openState; }
  };
  // origins.js reads this to skip opening the character wheel while the
  // captives panel is open (defense in depth alongside the capture-phase guard above).
  CBZ.cityCaptivesHudOpen = function () { return openState; };
})();

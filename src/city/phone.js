/* ============================================================
   city/phone.js — "📱 PHONE": a read-only status / info hub for city mode.

   Press [P] in city mode to open a modal full of "apps" (cards) that mirror
   real game systems so every stat answers a "why":
     • WANTED   — stars, heat, crime label, body count, mask, heat-to-next-star
     • TERRITORY— per-gang district control, takeover leader, your share of 9
     • EMPIRE   — cash, bank, respect, home, car business notoriety
     • CREW     — your founded gang: name, live members, turf held
     • VITALS   — HP, hunger, tiredness, injuries

   Pure display: every CBZ.* read is feature-detected so the panel can never
   throw if a system isn't loaded. Follows the documented city modal pattern.

   Exposes: CBZ.cityOpenPhone.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // ---- palette --------------------------------------------------------------
  const GREEN = "#7ed957", GOLD = "#ffd451", RED = "#ff5b5b", CYAN = "#7fd0ff", DIM = "#8a93a3";

  let panel = null, body = null, open_ = false, lastRender = 0;

  // ---- small helpers --------------------------------------------------------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function num(n, d) { return (typeof n === "number" && isFinite(n)) ? n : (d || 0); }
  function money(n) { return "$" + Math.round(num(n)).toLocaleString(); }
  function hex6(c) { return "#" + (num(c) >>> 0).toString(16).padStart(6, "0"); }
  function pct(v) { return Math.max(0, Math.min(100, Math.round(num(v)))) + "%"; }

  // a label / value row
  function row(label, value, color) {
    return "<div style='display:flex;justify-content:space-between;gap:10px;align-items:baseline;padding:2px 0'>" +
      "<span style='color:" + DIM + ";font-size:12px'>" + esc(label) + "</span>" +
      "<span style='color:" + (color || "#e8eef7") + ";font-weight:600;font-size:13px;text-align:right'>" + value + "</span>" +
      "</div>";
  }
  // a labelled progress bar
  function bar(frac, color, note) {
    frac = Math.max(0, Math.min(1, num(frac)));
    return "<div style='margin:6px 0 2px'>" +
      "<div style='height:8px;background:rgba(255,255,255,.08);border-radius:5px;overflow:hidden'>" +
      "<div style='height:100%;width:" + (frac * 100) + "%;background:" + (color || CYAN) + "'></div></div>" +
      (note ? "<div style='font-size:11px;color:" + DIM + ";margin-top:3px'>" + esc(note) + "</div>" : "") +
      "</div>";
  }
  // a card wrapper with a cyan header
  function card(header, inner) {
    return "<div style='background:rgba(255,255,255,.04);border-radius:10px;padding:10px 12px;margin-bottom:8px'>" +
      "<div style='color:" + CYAN + ";font-weight:700;font-size:13px;letter-spacing:.4px;margin-bottom:6px'>" + esc(header) + "</div>" +
      inner + "</div>";
  }
  function stars(n) {
    n = Math.max(0, Math.min(5, Math.round(num(n))));
    return "<span style='color:" + GOLD + "'>" + "★".repeat(n) + "</span>" +
      "<span style='color:" + DIM + "'>" + "☆".repeat(5 - n) + "</span>";
  }

  // ---- the apps -------------------------------------------------------------
  function wantedApp() {
    const w = num(g.wanted), heat = num(g.heat);
    const T = (CBZ.CITY && CBZ.CITY.starHeat) || [0, 140, 420, 1100, 3200, 12000];
    let inner = row("Wanted level", stars(w));
    inner += row("Heat", Math.round(heat).toLocaleString(), GOLD);
    if (g.cityCrimeLabel) inner += row("Last crime", esc(g.cityCrimeLabel), RED);
    inner += row("Murders", num(g.cityMurders), RED);
    inner += row("Cop kills", num(g.cityCopKills), RED);
    inner += row("Identity", g.cityMasked ? "🎭 Masked (no ID)" : "Face showing", g.cityMasked ? GREEN : DIM);

    // heat progress to the next star
    if (w < 5) {
      const lo = num(T[w]), hi = num(T[w + 1], lo + 1);
      const frac = hi > lo ? (heat - lo) / (hi - lo) : 1;
      inner += bar(frac, RED, "Heat to " + (w + 1) + "★: " + Math.round(heat).toLocaleString() + " / " + hi.toLocaleString());
    } else {
      inner += "<div style='font-size:11px;color:" + RED + ";margin-top:4px'>MAXED OUT — the whole city is hunting you.</div>";
    }
    // flavor answering "why is 5★ hard?" (BUG FIX: the old "helicopter circling"
    // line was assigned first and then ALWAYS overwritten by this if/else —
    // a dead branch. Folded into the 4★ arm so the chopper actually shows.)
    let flavor = "";
    if (w >= 5) flavor = "✈️ AIRSTRIKE inbound — 5★ takes relentless carnage to hold.";
    else if (w === 4) flavor = "🚁 Helicopter circling overhead — one more spree and they call in an airstrike (5★).";
    if (flavor) inner += "<div style='font-size:11px;color:" + DIM + ";margin-top:4px'>" + esc(flavor) + "</div>";
    return card("🚨 WANTED", inner);
  }

  function territoryApp() {
    const ctrl = (typeof CBZ.cityZoneControl === "function") ? CBZ.cityZoneControl() : null;
    const total = ctrl ? num(ctrl.total, 9) : 9;
    const byGang = (ctrl && ctrl.byGang) || {};
    const mine = num(byGang["player"]);
    let inner = row("Districts held", mine + " / " + total, mine > 0 ? GREEN : DIM);
    inner += row("Neutral", ctrl ? num(ctrl.neutral) : "—", DIM);

    const leader = (typeof CBZ.cityTakeoverLeader === "function") ? CBZ.cityTakeoverLeader() : null;
    if (leader) {
      const isYou = leader.id === "player";
      inner += row("Takeover leader",
        esc(leader.name || leader.id) + " (" + num(leader.zones) + "/" + num(leader.total, total) + ")",
        isYou ? GREEN : GOLD);
    }

    const gangs = (CBZ.cityGangs || []).filter(function (x) { return x && !x.absorbed; });
    if (gangs.length) {
      inner += "<div style='margin-top:6px;border-top:1px solid rgba(255,255,255,.06);padding-top:6px'></div>";
      gangs.forEach(function (gn) {
        const held = num(byGang[gn.id], (gn.turf && gn.turf.length) || 0);
        const chip = "<span style='display:inline-block;width:10px;height:10px;border-radius:3px;background:" +
          hex6(gn.color) + ";margin-right:6px;vertical-align:middle'></span>";
        inner += "<div style='display:flex;justify-content:space-between;align-items:center;padding:2px 0;font-size:13px'>" +
          "<span>" + chip + esc(gn.name || gn.id) + (gn.isPlayer ? " <span style='color:" + GREEN + "'>(you)</span>" : "") + "</span>" +
          "<span style='color:" + DIM + ";font-weight:600'>" + held + "</span></div>";
      });
    }
    return card("🗺️ TERRITORY", inner);
  }

  function empireApp() {
    let inner = row("Cash", money(g.cash), GREEN);
    inner += row("Bank", money(g.cityBank), GREEN);
    inner += row("Respect", num(g.respect), "#c792ea");
    if (typeof CBZ.cityNetWorth === "function") {
      try { inner += row("Net worth", money(CBZ.cityNetWorth()), GOLD); } catch (e) {}
    }
    const home = g.cityHome;
    if (home) {
      let h = esc(home.name || "Home");
      if (home.tier != null) h += " · T" + esc(home.tier);
      if (home.sqft) h += " · " + esc(home.sqft) + " sqft";
      inner += row("Home", h, CYAN);
    } else {
      inner += row("Home", "None (rent/buy with [Z])", DIM);
    }
    const biz = g.cityCarBiz;
    if (biz && (biz.owned || (biz.cars && biz.cars.length) || biz.notoriety)) {
      inner += row("Car yard", (biz.owned ? "Owned" : "Rented") +
        " · " + ((biz.cars && biz.cars.length) || 0) + " cars", CYAN);
      if (biz.notoriety) inner += row("Yard heat", num(biz.notoriety), RED);
    } else {
      inner += row("Car yard", "Not running", DIM);
    }
    return card("🏙️ EMPIRE", inner);
  }

  function crewApp() {
    const pg = g.playerGang;
    if (pg && pg.founded) {
      let members = (pg.members && pg.members.length) || 0;
      if (typeof CBZ.cityPlayerGangMembers === "function") {
        try { members = CBZ.cityPlayerGangMembers().length; } catch (e) {}
      }
      const chip = "<span style='display:inline-block;width:10px;height:10px;border-radius:3px;background:" +
        hex6(pg.color) + ";margin-right:6px;vertical-align:middle'></span>";
      let inner = row("Name", chip + esc(pg.name || "Your crew"), GREEN);
      inner += row("Members", members, members > 0 ? GREEN : DIM);
      inner += row("Turf held", (pg.turf && pg.turf.length) || 0);
      if (pg.treasury != null) inner += row("Treasury", money(pg.treasury), GOLD);
      return card("👥 CREW", inner);
    }
    return card("👥 CREW",
      "<div style='font-size:13px;color:" + DIM + "'>No crew yet — found one with <b style='color:" + CYAN + "'>[O]</b>.</div>");
  }

  // ---- SERVICES: the phone's first ACTION app. Everything here is a real verb
  //      unlocked by what you OWN — the reason the property ladder matters. The
  //      Spire turns its roof into a helipad and its deck into a hangar, lighting
  //      up "Call Chopper" (aerial fast-travel / getaway) and "Call Airstrike"
  //      (your jet levels a target). Locked rows say WHY so the goal is legible.
  function svcBtn(svc, label, enabled, sub) {
    const bg = enabled ? "rgba(89,194,255,.16)" : "rgba(255,255,255,.04)";
    const bd = enabled ? "#3a7ab0" : "#2c3140";
    const col = enabled ? "#cfeaff" : DIM;
    const cursor = enabled ? "pointer" : "default";
    return "<div data-svc='" + svc + "' data-on='" + (enabled ? 1 : 0) + "' " +
      "style='background:" + bg + ";border:1px solid " + bd + ";border-radius:9px;padding:8px 11px;margin:4px 0;cursor:" + cursor + ";'>" +
      "<div style='color:" + col + ";font-weight:700;font-size:13px'>" + esc(label) + "</div>" +
      (sub ? "<div style='color:" + DIM + ";font-size:11px;margin-top:2px'>" + esc(sub) + "</div>" : "") +
      "</div>";
  }
  function servicesApp() {
    const s = (typeof CBZ.cityAirServices === "function") ? CBZ.cityAirServices() : null;
    let inner = "";
    if (s && s.riding) {
      inner += "<div style='font-size:12px;color:" + GREEN + ";margin-bottom:4px'>🚁 In the air — enjoy the ride.</div>";
    }
    // CHOPPER — comes free with the penthouse
    if (!s || !s.helipad) {
      inner += svcBtn("", "🚁 Call Chopper", false, "Locked — own the APEX PENTHOUSE; a chopper comes parked on its rooftop pad.");
    } else if (s.chopperActive) {
      inner += svcBtn("", "🚁 Chopper inbound…", false, "Walk under it to board. It flies you to your waypoint (or home).");
    } else if (s.chopperCD > 0) {
      inner += svcBtn("", "🚁 Chopper refueling", false, "Ready in " + s.chopperCD + "s.");
    } else {
      inner += svcBtn("chopper", "🚁 Call Chopper", true, "Aerial pickup → flies you to your map waypoint, else home.");
    }
    // HANGAR — the home a stolen F-22 needs. Two ways to own one: the penthouse
    //   deck hangar (bought at home [H]) OR the standalone airport Private Hangar
    //   (bought right here / [G] near the apron). Surface the airport one so the
    //   player can always find a way to buy a hangar without owning the tower.
    const ownsAirportHangar = !!(CBZ.cityStorage && CBZ.cityStorage.owns && (function () { try { return CBZ.cityStorage.owns("hangar"); } catch (e) { return false; } })());
    const hangarProp = (CBZ.cityStorage && CBZ.cityStorage.PROPERTIES) ? CBZ.cityStorage.PROPERTIES.find(function (p) { return p.id === "hangar"; }) : null;
    if (!s || !s.hangar) {
      if (ownsAirportHangar) {
        inner += svcBtn("", "🛩 Private Hangar — owned", false, "Empty hangar at the airport apron. STEAL the F-22 from the military base, then land it inside to keep it.");
      } else if (CBZ.cityStorage && CBZ.cityStorage.buy) {
        inner += svcBtn("buyhangar", "🛩 Buy Private Hangar — " + money(hangarProp ? hangarProp.cost : 1200000), true, "An airport apron hangar — the home a stolen F-22 needs. (Or buy the penthouse deck hangar at home [H].)");
      }
    }
    // AIRSTRIKE — needs a based F-22 (own a hangar, then steal & land the jet)
    if (!s || !s.hangar) {
      inner += svcBtn("", "🎯 Call Airstrike", false,
        "Locked — buy a hangar (above, or penthouse deck [H]), STEAL the F-22, and land it inside to base it.");
    } else if (s.strikeCD > 0) {
      inner += svcBtn("", "🎯 Jet rearming", false, "Ready in " + s.strikeCD + "s.");
    } else {
      inner += svcBtn("strike", "🎯 Call Airstrike", true, "Bombs your waypoint (else your aim). " + money(s.strikeCost) + " · draws police heat.");
    }
    return card("📡 SERVICES", inner);
  }

  // ---- GIG WORK: the phone's honest-money app. The WHY: not every dollar has
  //      to come from a body — you can clock in. CBZ.cityGig (gigs.js, parallel
  //      build) owns the loop; this card is the dispatcher: it lists the gig
  //      lines you can pick up (Delivery / Rideshare / Smuggle), offers fresh
  //      jobs, and lets you ACCEPT one. Fully feature-detected: if cityGig isn't
  //      loaded the card simply says so — nothing else in the phone breaks.
  //
  //      Contract used (all optional, each guarded):
  //        CBZ.cityGig.active()        → the in-progress gig (or null/false)
  //        CBZ.cityGig.offer(kind)     → fresh offer(s) for a line; array or one def
  //        CBZ.cityGig.accept(def)     → take a specific offered def
  //        CBZ.cityGig.lines()         → [{kind,label,sub,pay?}] available gig lines
  //        CBZ.cityGig.cancel()        → drop the active gig
  const GIG_LINES = [
    { kind: "delivery", label: "📦 Delivery", sub: "grab a package · run it across town" },
    { kind: "taxi", label: "🚕 Rideshare", sub: "pick up a fare · drop them at their stop" },
    { kind: "smuggling", label: "🕶️ Smuggle run", sub: "off-book cargo · hot money, hotter heat" },
  ];
  // a clickable gig row. mode "offer" lists a line to fetch work for; mode
  // "accept" is a concrete offered def the player can take right now.
  function gigBtn(mode, key, label, enabled, sub) {
    const bg = enabled ? "rgba(126,217,87,.14)" : "rgba(255,255,255,.04)";
    const bd = enabled ? "#4a8a3a" : "#2c3140";
    const col = enabled ? "#dff5d0" : DIM;
    const cursor = enabled ? "pointer" : "default";
    return "<div data-gig='" + esc(mode) + "' data-gigkey='" + esc(key) + "' data-on='" + (enabled ? 1 : 0) + "' " +
      "style='background:" + bg + ";border:1px solid " + bd + ";border-radius:9px;padding:8px 11px;margin:4px 0;cursor:" + cursor + ";'>" +
      "<div style='color:" + col + ";font-weight:700;font-size:13px'>" + esc(label) + "</div>" +
      (sub ? "<div style='color:" + DIM + ";font-size:11px;margin-top:2px'>" + esc(sub) + "</div>" : "") +
      "</div>";
  }
  // the stage/phase of an active gig, read defensively across plausible field names.
  function gigStage(a) {
    if (!a) return "";
    return String(a.stage || a.phase || a.step || a.state || "active");
  }
  function gigStageHint(a) {
    const s = gigStage(a).toLowerCase();
    if (s.indexOf("pickup") >= 0 || s.indexOf("hail") >= 0 || s.indexOf("offered") >= 0) return "Head to the pickup — the spot's on your map.";
    if (s.indexOf("carry") >= 0 || s.indexOf("ride") >= 0 || s.indexOf("transit") >= 0 || s.indexOf("enroute") >= 0) return "Cargo aboard — get to the drop-off.";
    if (s.indexOf("drop") >= 0 || s.indexOf("deliver") >= 0) return "At the drop — hand it over.";
    return "Job in progress.";
  }
  // cache the last batch of offers we showed, keyed by index, so a click can
  // resolve to the exact def we listed (offers may be objects, not just kinds).
  let gigOffers = [];
  function gigApp() {
    const G = CBZ.cityGig;
    if (!G || typeof G !== "object") {
      return card("💼 GIG WORK",
        "<div style='font-size:13px;color:" + DIM + "'>No gig dispatch available right now.</div>");
    }
    let inner = "";
    // 1) ACTIVE JOB — if one's running, show it + a cancel.
    let active = null;
    try { active = (typeof G.active === "function") ? G.active() : null; } catch (e) { active = null; }
    if (active) {
      const k = String(active.kind || active.line || "gig");
      const line = GIG_LINES.find(function (l) { return l.kind === k; });
      const title = (line ? line.label : "💼 " + k) + (active.pay ? " · " + money(active.pay) : "");
      inner += "<div style='font-size:13px;color:" + GREEN + ";font-weight:700;margin-bottom:2px'>" + esc(title) + "</div>";
      inner += "<div style='font-size:11px;color:" + DIM + ";margin-bottom:6px'>" + esc(gigStageHint(active)) + "</div>";
      if (typeof G.cancel === "function") inner += gigBtn("cancel", k, "✖ Drop this gig", true, "Forfeit the run — no pay.");
      return card("💼 GIG WORK", inner);
    }
    // 2) FRESH OFFERS — if the player has fetched offers for a line, list them.
    if (gigOffers.length) {
      inner += "<div style='font-size:11px;color:" + DIM + ";margin-bottom:4px'>Available jobs — tap to accept:</div>";
      gigOffers.forEach(function (def, i) {
        const lbl = (def && (def.label || def.title)) || "Job #" + (i + 1);
        const sub = (def && (def.sub || def.desc)) || (def && def.pay ? money(def.pay) : "");
        inner += gigBtn("accept", String(i), "✔ " + lbl, true, sub);
      });
      inner += gigBtn("clear", "", "↩ Back to gig lines", true, "");
      return card("💼 GIG WORK", inner);
    }
    // 3) DEFAULT — the menu of gig lines to fetch work for.
    inner += "<div style='font-size:11px;color:" + DIM + ";margin-bottom:4px'>Clock in — pick a line of work:</div>";
    let lines = GIG_LINES;
    if (typeof G.lines === "function") {
      try {
        const ll = G.lines();
        if (Array.isArray(ll) && ll.length) lines = ll.map(function (l) {
          const base = GIG_LINES.find(function (b) { return b.kind === l.kind; });
          return { kind: l.kind, label: l.label || (base && base.label) || l.kind, sub: l.sub || (base && base.sub) || "" };
        });
      } catch (e) {}
    }
    lines.forEach(function (l) {
      inner += gigBtn("offer", l.kind, l.label, typeof G.offer === "function", l.sub);
    });
    return card("💼 GIG WORK", inner);
  }

  function vitalsApp() {
    const p = CBZ.player || {};
    const hp = num(p.hp, 0), maxHp = num(p.maxHp, 100);
    let inner = row("Health", Math.round(hp) + " / " + Math.round(maxHp), hp < maxHp * 0.35 ? RED : GREEN);
    inner += bar(maxHp ? hp / maxHp : 0, hp < maxHp * 0.35 ? RED : GREEN);
    if (g.hunger != null) {
      inner += row("Hunger", pct(g.hunger), num(g.hunger) < 25 ? RED : GREEN);
    }
    if (g.tired != null) {
      inner += row("Tiredness", pct(g.tired), num(g.tired) > 70 ? RED : DIM);
    }
    const injuries = [];
    if (p._legWound) injuries.push("🦵 Leg wound");
    if (p._bleeding) injuries.push("🩸 Bleeding");
    if (injuries.length) inner += row("Injuries", injuries.join(", "), RED);
    return card("❤️ VITALS", inner);
  }

  // ---- render ---------------------------------------------------------------
  function render() {
    if (!body) return;
    let html = "";
    try { html += servicesApp(); } catch (e) {}
    try { html += wantedApp(); } catch (e) {}
    try { html += territoryApp(); } catch (e) {}
    try { html += empireApp(); } catch (e) {}
    try { html += gigApp(); } catch (e) {}
    try { html += crewApp(); } catch (e) {}
    try { html += vitalsApp(); } catch (e) {}
    body.innerHTML = html;
  }

  // ---- DOM ------------------------------------------------------------------
  function el() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "cityPhone";
    panel.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);" +
      "z-index:48;display:none;width:min(560px,92vw);max-height:88vh;overflow-y:auto;" +
      "background:rgba(16,18,24,.94);border:2px solid #2c3140;border-radius:16px;" +
      "padding:16px 18px;box-sizing:border-box;color:#e8eef7;" +
      "font-family:Fredoka,system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.5);pointer-events:auto";

    const head = document.createElement("div");
    head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:12px";
    head.innerHTML = "<div style='font-size:20px;font-weight:800;letter-spacing:.5px'>📱 PHONE</div>" +
      "<div style='font-size:12px;color:" + DIM + "'>Close <b style='color:" + CYAN + "'>[P]</b></div>";
    panel.appendChild(head);

    body = document.createElement("div");
    panel.appendChild(body);

    // SERVICES buttons fire real verbs. Each closes the phone so you watch the
    // chopper/jet do its thing. Feature-detected so a missing module is inert.
    panel.addEventListener("click", function (e) {
      const t = e.target && e.target.closest ? e.target.closest("[data-svc]") : null;
      if (t && t.getAttribute("data-on") === "1") {
        const svc = t.getAttribute("data-svc");
        if (svc === "chopper" && typeof CBZ.cityCallChopper === "function") { if (CBZ.cityCallChopper()) close(); }
        else if (svc === "strike" && typeof CBZ.cityCallAirstrike === "function") { if (CBZ.cityCallAirstrike()) close(); }
        else if (svc === "buyhangar" && CBZ.cityStorage && typeof CBZ.cityStorage.buy === "function") {
          try {
            const hp = (CBZ.cityStorage.PROPERTIES || []).find(function (p) { return p.id === "hangar"; });
            if (hp) CBZ.cityStorage.buy(hp);
          } catch (e) {}
          render();
        }
        else render();
        return;
      }
      // ---- GIG WORK clicks ----
      const gt = e.target && e.target.closest ? e.target.closest("[data-gig]") : null;
      if (gt && gt.getAttribute("data-on") === "1") {
        const G = CBZ.cityGig;
        const mode = gt.getAttribute("data-gig");
        const key = gt.getAttribute("data-gigkey");
        if (!G) { render(); return; }
        try {
          if (mode === "offer" && typeof G.offer === "function") {
            const res = G.offer(key);
            // offer() may return one def or an array of defs. If it returns
            // nothing truthy, assume it accepted/posted directly — just re-render.
            if (Array.isArray(res)) gigOffers = res.filter(Boolean);
            else if (res) gigOffers = [res];
            else gigOffers = [];
          } else if (mode === "accept" && typeof G.accept === "function") {
            const idx = parseInt(key, 10) || 0;
            const def = gigOffers[idx];
            if (def) { G.accept(def); }
            gigOffers = [];
            close();   // job's on — close the phone, go work it
            return;
          } else if (mode === "clear") {
            gigOffers = [];
          } else if (mode === "cancel" && typeof G.cancel === "function") {
            G.cancel();
            gigOffers = [];
          }
        } catch (err) { gigOffers = []; }
        render();
        return;
      }
    });

    document.body.appendChild(panel);
    return panel;
  }

  // ---- open / close ---------------------------------------------------------
  function open() {
    if (CBZ.cityMenuOpen) return;
    open_ = true; CBZ.cityMenuOpen = true;
    el().style.display = "block";
    render();
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
  }
  function close() {
    open_ = false;
    if (panel) panel.style.display = "none";
    CBZ.cityMenuOpen = false;
    if (CBZ.requestLock && g.state === "playing") CBZ.requestLock();
  }
  CBZ.cityOpenPhone = open;

  // ---- live re-render while open (~3/sec) -----------------------------------
  CBZ.onUpdate(50.5, function (dt) {
    if (g.mode !== "city" || !open_) return;
    lastRender += num(dt);
    if (lastRender < 0.33) return;
    lastRender = 0;
    render();
  });

  // ---- key: [P] toggles ------------------------------------------------------
  addEventListener("keydown", function (e) {
    if (g.mode !== "city" || g.state !== "playing") return;
    const k = (e.key || "").toLowerCase();
    if (open_) {
      if (k === "escape" || k === "p") { e.preventDefault(); close(); }
      return;
    }
    if (k === "p" && !e.repeat && !CBZ.cityMenuOpen && !(CBZ.player && CBZ.player.driving)) {
      e.preventDefault(); open();
    }
  });
})();

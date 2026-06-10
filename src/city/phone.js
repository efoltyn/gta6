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
    // flavor answering "why is 5★ hard?"
    let flavor = "";
    if (w >= 4) flavor = "🚁 Helicopter circling overhead.";
    if (w >= 5) flavor = "✈️ AIRSTRIKE inbound — 5★ takes relentless carnage to hold.";
    else if (w === 4) flavor = "🚁 One more spree and they call in an airstrike (5★).";
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
    // AIRSTRIKE — the paid hangar add-on (F-22)
    if (!s || !s.hangar) {
      inner += svcBtn("", "🎯 Call Airstrike", false, s && s.penthouse
        ? "Locked — buy the HANGAR add-on at your home [H] to base a jet."
        : "Locked — own the APEX PENTHOUSE, then buy its deck hangar.");
    } else if (s.strikeCD > 0) {
      inner += svcBtn("", "🎯 Jet rearming", false, "Ready in " + s.strikeCD + "s.");
    } else {
      inner += svcBtn("strike", "🎯 Call Airstrike", true, "Bombs your waypoint (else your aim). " + money(s.strikeCost) + " · draws police heat.");
    }
    return card("📡 SERVICES", inner);
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
      if (!t || t.getAttribute("data-on") !== "1") return;
      const svc = t.getAttribute("data-svc");
      if (svc === "chopper" && typeof CBZ.cityCallChopper === "function") { if (CBZ.cityCallChopper()) close(); }
      else if (svc === "strike" && typeof CBZ.cityCallAirstrike === "function") { if (CBZ.cityCallAirstrike()) close(); }
      else render();
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

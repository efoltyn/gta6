/* ============================================================
   city/phone.js — the city PHONE ([P], outside the story campaign, which
   carries its own handset in campaign_ui.js).

   HUD PURGE 2026-09-27 (owner: "the phone and its many tabs"): it used to
   be fifteen stacked cards, WANTED / TERRITORY / EMPIRE / MARKETS /
   CURRENCY EXCHANGE / CENTRAL BANKS / INFLATION / SOVEREIGN BONDS / CREW /
   VITALS and more, a status dump of every simulation in the build. Cut to
   what a player actually does with a phone:
     • MESSAGES   the inbox (CBZ.cityPhoneNotify is the city's one text sink)
     • CONTACTS   answer a follow-up offer yes / no
     • GIG WORK   take a delivery / taxi / smuggling job
     • SERVICES   call the chopper / the airstrike, buy the hangar
     • DEMOLITION the detonator
   Empty apps render nothing. Your wanted level, health, turf and money are
   in the world, not on a card.

   Exposes: CBZ.cityOpenPhone, CBZ.cityClosePhone, CBZ.cityPhoneNotify.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // ---- palette --------------------------------------------------------------
  const GREEN = "#7ed957", GOLD = "#ffd451", RED = "#ff5b5b", CYAN = "#7fd0ff", DIM = "#8a93a3";

  let panel = null, body = null, noticeBadge = null, open_ = false, lastRender = 0;
  const noticeLog = [];
  let noticeUnread = 0;
  const NOTICE_CAP = 40;
  const CONTROL_COPY_RE = /\[[A-Za-z0-9/\- ]{1,8}\]|\b(?:press|click|hold|tap)\b|\bLMB\b|\bRMB\b|Shift\+|\bWASD\b/i;
  const META_COPY_RE = /\b(?:NPC|HUD|UI|reticle|crosshair|respawn(?:ing)?|game over|tutorial|keybind|hotbar|controller|keyboard|mouse|frame ?rate|FPS|first[- ]person|third[- ]person)\b/i;

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
  function clockLabel() {
    try { return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
    catch (e) { return "now"; }
  }
  function phoneSender(from, app) {
    const s = String(from || "").trim();
    if (!s || /^(status|alert|system)$/i.test(s)) return app === "news" ? "City Desk" : "Messages";
    if (/^objective$/i.test(s)) return "Dispatch";
    return s;
  }
  function updateNoticeBadge() {
    if (!noticeBadge) return;
    noticeBadge.textContent = noticeUnread > 0 ? String(Math.min(99, noticeUnread)) : "";
    noticeBadge.style.display = noticeUnread > 0 ? "inline-flex" : "none";
  }

  // Canonical non-campaign notification sink. It only writes into the handset;
  // it never creates a banner, toast, floating caption or world-space label.
  CBZ.cityPhoneNotify = function (payload) {
    if (typeof payload === "string") payload = { text: payload };
    payload = payload || {};
    const text = String(payload.text != null ? payload.text : (payload.body != null ? payload.body : "")).trim();
    if (!text || CONTROL_COPY_RE.test(text) || META_COPY_RE.test(text)) return null;
    if (typeof CBZ.cityPhoneWorthy === "function" && !CBZ.cityPhoneWorthy(text, payload, false)) return null;
    const app = String(payload.app || "messages").toLowerCase();
    const from = phoneSender(payload.from, app);
    const now = Date.now();
    const last = noticeLog.length ? noticeLog[noticeLog.length - 1] : null;
    if (last && last.text === text && last.from === from && now - last.born < 5000) {
      last.born = now; last.time = clockLabel();
      if (open_) render();
      return last;
    }
    // the City Desk's news is also the TV's (city/newsroom.js); tv:false opts out
    if (app === "news" && payload.tv !== false && CBZ.news && CBZ.news.wire) { try { CBZ.news.wire(text, from); } catch (e) {} }
    const item = { app: app, from: from, text: text, time: clockLabel(), born: now };
    noticeLog.push(item);
    if (noticeLog.length > NOTICE_CAP) noticeLog.splice(0, noticeLog.length - NOTICE_CAP);
    if (!open_) noticeUnread++;
    updateNoticeBadge();
    if (open_) render();
    return item;
  };
  // Read-only seam for tests and other phone surfaces that want the same news.
  CBZ.cityPhoneNews = noticeLog;

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
  function noticesApp() {
    if (!noticeLog.length) return "";
    let inner = "";
    const recent = noticeLog.slice(-14).reverse();
    for (let i = 0; i < recent.length; i++) {
      const n = recent[i];
      inner += "<div style='padding:7px 0;border-top:" + (i ? "1px solid rgba(255,255,255,.06)" : "0") + "'>" +
        "<div style='display:flex;justify-content:space-between;gap:10px;font-size:11px;color:" + DIM + "'>" +
        "<b style='color:" + (n.app === "news" ? CYAN : "#c9d2df") + "'>" + esc(n.from) + "</b><span>" + esc(n.time) + "</span></div>" +
        "<div style='font-size:13px;color:#e8eef7;line-height:1.3;margin-top:2px'>" + esc(n.text) + "</div></div>";
    }
    return card("NEWS & MESSAGES", inner);
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
  /* ---- DEMOLITION — THE DETONATOR IS AN APP ------------------------------
     OWNER (2026-08-06): "Detonator not in hand. It should be on your phone.
     We already have a phone code, and it's good."

     He is right and the first attempt was wrong: a clacker box modelled into
     the off-hand is a second UI competing with the one this file already is.
     The phone is the surface the game already carries for "things you own,
     read at a glance, act on" — it has the modal, the card grammar, the
     click delegation and the [P] key. A remote detonator is a PHONE APP in
     every crime story since about 2005, so the fiction is free too.

     What it shows is the whole point of systems/breach.js being a shared
     table rather than a constant: how many pounds you have OUT, and what the
     nearest thing you could open COSTS. A bank reserve vault says 10 lb, the
     prison's yard door says 5, and the card does the subtraction for you —
     so "go back for another brick" is information, not trial and error. */
  function demoApp() {
    const outN = (typeof CBZ.cityC4Planted === "function") ? CBZ.cityC4Planted() : 0;
    const carried = (typeof CBZ.cityC4Count === "function") ? CBZ.cityC4Count() : 0;
    if (!outN && !carried) return "";                 // no charges, no app — nothing to say
    const LB = 5;                                     // one brick, the doctrinal one-man row
    const outLb = outN * LB;
    let inner = "";
    inner += row("Charges out", outN ? (outN + "  (" + outLb + " lb)") : "none", outN ? RED : DIM);
    inner += row("In your bag", carried + (carried === 1 ? " brick" : " bricks"), carried ? GREEN : DIM);

    // WHAT IS IN FRONT OF YOU, PRICED. Reads the shared registry, so this line
    // is written by whatever declared the target — this file knows about
    // neither vaults nor prison doors.
    let tgt = null;
    try {
      const P = CBZ.player;
      if (P && P.pos && typeof CBZ.breachTargetAt === "function") {
        tgt = CBZ.breachTargetAt(P.pos.x, (P.pos.y || 0) + 1.2, P.pos.z, 6);
      }
    } catch (e) { tgt = null; }
    if (tgt) {
      const need = tgt.lb || LB;
      const short = Math.max(0, Math.ceil((need - outLb) / LB));
      const label = String(tgt.id || "target").replace(/[-_]/g, " ");
      inner += row(label, need + " lb", GOLD);
      inner += short
        ? "<div style='font-size:11px;color:" + RED + ";margin:2px 0 4px'>Short " + (need - outLb) +
          " lb, set " + short + " more brick" + (short === 1 ? "" : "s") + " on it.</div>"
        : "<div style='font-size:11px;color:" + GREEN + ";margin:2px 0 4px'>Enough on it. Send it.</div>";
    }

    const armed = outN > 0;
    inner += "<div data-demo='fire' data-on='" + (armed ? "1" : "0") + "' style=\"margin-top:6px;padding:9px 10px;border-radius:8px;text-align:center;font-weight:700;letter-spacing:.08em;" +
      (armed ? "background:#5a1512;border:1px solid #ff5b5b;color:#ffd9d6;cursor:pointer"
             : "background:#1b1f26;border:1px solid #2c333d;color:" + DIM) + "\">" +
      (armed ? "DETONATE" : "NOTHING PLANTED") + "</div>";
    if (armed) inner += "<div style='font-size:10px;color:" + DIM + ";margin-top:4px'>Everything within 2.5 m of another charge fires together, and the masses add.</div>";
    return card("DEMOLITION", inner);
  }

  function servicesApp() {
    const s = (typeof CBZ.cityAirServices === "function") ? CBZ.cityAirServices() : null;
    let inner = "";
    if (s && s.riding) {
      inner += "<div style='font-size:12px;color:" + GREEN + ";margin-bottom:4px'>In the air, enjoy the ride.</div>";
    }
    // CHOPPER — comes free with the penthouse
    if (!s || !s.helipad) {
      inner += svcBtn("", "Call Chopper", false, "Locked, own the APEX PENTHOUSE; a chopper comes parked on its rooftop pad.");
    } else if (s.chopperActive) {
      inner += svcBtn("", "Chopper inbound…", false, "Walk under it to board. It flies you to your waypoint (or home).");
    } else if (s.chopperCD > 0) {
      inner += svcBtn("", "Chopper refueling", false, "Ready in " + s.chopperCD + "s.");
    } else {
      inner += svcBtn("chopper", "Call Chopper", true, "Aerial pickup → flies you to your map waypoint, else home.");
    }
    // HANGAR — the home a stolen F-22 needs. Two ways to own one: the penthouse
    //   deck hangar (bought at home [H]) OR the standalone airport Private Hangar
    //   (bought right here / [G] near the apron). Surface the airport one so the
    //   player can always find a way to buy a hangar without owning the tower.
    const ownsAirportHangar = !!(CBZ.cityStorage && CBZ.cityStorage.owns && (function () { try { return CBZ.cityStorage.owns("hangar"); } catch (e) { return false; } })());
    const hangarProp = (CBZ.cityStorage && CBZ.cityStorage.PROPERTIES) ? CBZ.cityStorage.PROPERTIES.find(function (p) { return p.id === "hangar"; }) : null;
    if (!s || !s.hangar) {
      if (ownsAirportHangar) {
        inner += svcBtn("", "Private Hangar, owned", false, "Empty hangar at the airport apron. STEAL the F-22 from the military base, then land it inside to keep it.");
      } else if (CBZ.cityStorage && CBZ.cityStorage.buy) {
        inner += svcBtn("buyhangar", "Buy Private Hangar, " + money(hangarProp ? hangarProp.cost : 1200000), true, "An airport apron hangar, the home a stolen F-22 needs. The penthouse also offers a deck hangar.");
      }
    }
    // AIRSTRIKE — needs a based F-22 (own a hangar, then steal & land the jet)
    if (!s || !s.hangar) {
      inner += svcBtn("", "Call Airstrike", false,
        "Locked, buy a private or penthouse hangar, steal the F-22, and land it inside to base it.");
    } else if (s.strikeCD > 0) {
      inner += svcBtn("", "Jet rearming", false, "Ready in " + s.strikeCD + "s.");
    } else {
      inner += svcBtn("strike", "Call Airstrike", true, "Bombs your waypoint (else your aim). " + money(s.strikeCost) + ". Draws police heat.");
    }
    return card("SERVICES", inner);
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
    { kind: "delivery", label: "Delivery", sub: "grab a package, run it across town" },
    { kind: "taxi", label: "Rideshare", sub: "pick up a fare, drop them at their stop" },
    { kind: "smuggling", label: "Smuggle run", sub: "off-book cargo, hot money, hotter heat" },
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
    if (s.indexOf("pickup") >= 0 || s.indexOf("hail") >= 0 || s.indexOf("offered") >= 0) return "Head to the pickup, the spot's on your map.";
    if (s.indexOf("carry") >= 0 || s.indexOf("ride") >= 0 || s.indexOf("transit") >= 0 || s.indexOf("enroute") >= 0) return "Cargo aboard, get to the drop-off.";
    if (s.indexOf("drop") >= 0 || s.indexOf("deliver") >= 0) return "At the drop, hand it over.";
    return "Job in progress.";
  }
  // cache the last batch of offers we showed, keyed by index, so a click can
  // resolve to the exact def we listed (offers may be objects, not just kinds).
  let gigOffers = [];
  function gigApp() {
    const G = CBZ.cityGig;
    if (!G || typeof G !== "object") {
      return card("GIG WORK",
        "<div style='font-size:13px;color:" + DIM + "'>No gig dispatch available right now.</div>");
    }
    let inner = "";
    // 1) ACTIVE JOB — if one's running, show it + a cancel.
    let active = null;
    try { active = (typeof G.active === "function") ? G.active() : null; } catch (e) { active = null; }
    if (active) {
      const k = String(active.kind || active.line || "gig");
      const line = GIG_LINES.find(function (l) { return l.kind === k; });
      const title = (line ? line.label : "" + k) + (active.pay ? ", " + money(active.pay) : "");
      inner += "<div style='font-size:13px;color:" + GREEN + ";font-weight:700;margin-bottom:2px'>" + esc(title) + "</div>";
      inner += "<div style='font-size:11px;color:" + DIM + ";margin-bottom:6px'>" + esc(gigStageHint(active)) + "</div>";
      if (typeof G.cancel === "function") inner += gigBtn("cancel", k, "Drop this gig", true, "Forfeit the run, no pay.");
      return card("GIG WORK", inner);
    }
    // 2) FRESH OFFERS — if the player has fetched offers for a line, list them.
    if (gigOffers.length) {
      inner += "<div style='font-size:11px;color:" + DIM + ";margin-bottom:4px'>Available jobs:</div>";
      gigOffers.forEach(function (def, i) {
        const lbl = (def && (def.label || def.title)) || "Job #" + (i + 1);
        const sub = (def && (def.sub || def.desc)) || (def && def.pay ? money(def.pay) : "");
        inner += gigBtn("accept", String(i), "" + lbl, true, sub);
      });
      inner += gigBtn("clear", "", "↩ Back to gig lines", true, "");
      return card("GIG WORK", inner);
    }
    // 3) DEFAULT — the menu of gig lines to fetch work for.
    inner += "<div style='font-size:11px;color:" + DIM + ";margin-bottom:4px'>Clock in, pick a line of work:</div>";
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
    return card("GIG WORK", inner);
  }

  // ---- CONTACTS: people you MET (city/dialogue.js). Strangers never appear
  //      here — a contact exists only because you walked up and talked, took
  //      their work, or became their friend (owner law: "you don't get a
  //      mission from a character you never met"). When one of them texts or
  //      calls with a follow-up, the offer lands here as TWO buttons — accept
  //      or pass — because everything in this game is two choices. Pure
  //      render + click-forward: dialogue.js owns every outcome; this card is
  //      feature-detected and vanishes whole when that module is absent.
  function contactBtn(id, yes, label) {
    const green = yes ? "rgba(126,217,87,.14)" : "rgba(255,255,255,.05)";
    const bd = yes ? "#4a8a3a" : "#3a4152";
    const col = yes ? "#dff5d0" : "#c9d2df";
    return "<div data-dlgcontact='" + esc(id) + "' data-dlgyes='" + (yes ? 1 : 0) + "' " +
      "style='background:" + green + ";border:1px solid " + bd + ";border-radius:8px;padding:6px 10px;" +
      "font-size:12px;font-weight:700;color:" + col + ";cursor:pointer;display:inline-block;margin:2px 6px 2px 0'>" + esc(label) + "</div>";
  }
  function contactsApp() {
    const D = CBZ.cityDialogue;
    if (!D || typeof D.contacts !== "function") return "";
    let list = [];
    try { list = D.contacts() || []; } catch (e) { list = []; }
    if (!list.length) return "";
    let inner = "";
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const tag = c.friend ? "friend" : (c.org ? String(c.org) : (c.why || "met"));
      inner += "<div style='padding:6px 0;border-top:" + (i ? "1px solid rgba(255,255,255,.06)" : "0") + "'>" +
        "<div style='display:flex;justify-content:space-between;gap:10px;font-size:13px'>" +
        "<b style='color:#e8eef7'>" + esc(c.name) + "</b>" +
        "<span style='color:" + DIM + ";font-size:11px'>" + esc(tag) + "</span></div>";
      if (c.pending) {
        const p = c.pending;
        const line = p.kind === "job"
          ? esc(p.title) + ", " + money(p.pay)
          : "Meet at " + esc(p.place || "the spot");
        inner += "<div style='font-size:12px;color:" + GOLD + ";margin:3px 0'>" + line + "</div>" +
          "<div>" + contactBtn(c.id, true, p.kind === "job" ? "I'M IN" : "I'LL BE THERE") +
          contactBtn(c.id, false, p.kind === "job" ? "NOT MY THING" : "CAN'T MAKE IT") + "</div>";
      }
      inner += "</div>";
    }
    return card("CONTACTS", inner);
  }

  // ---- render ---------------------------------------------------------------
  function render() {
    if (!body) return;
    let html = noticesApp();
    try { html += contactsApp(); } catch (e) {}
    try { html += gigApp(); } catch (e) {}
    try { html += servicesApp(); } catch (e) {}
    try { html += demoApp(); } catch (e) {}
    if (!html) html = "<div style='font-size:13px;color:" + DIM + ";padding:18px 4px;text-align:center'>No messages.</div>";
    body.innerHTML = html;
  }

  // ---- DOM ------------------------------------------------------------------
  function el() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "cityPhone";
    // z-index 40: the legacy-modal band — below the full map (60) and far below
    // the campaign handset (130), so a stale open can never cover either.
    panel.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);" +
      "z-index:40;display:none;width:min(560px,92vw);max-height:88vh;overflow-y:auto;" +
      "background:rgba(16,18,24,.94);border:2px solid #2c3140;border-radius:16px;" +
      "padding:16px 18px;box-sizing:border-box;color:#e8eef7;" +
      "font-family:Fredoka,system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.5);pointer-events:auto";

    const head = document.createElement("div");
    head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:12px";
    head.innerHTML = "<div style='display:flex;align-items:center;gap:8px;font-size:20px;font-weight:800;letter-spacing:.5px'>PHONE" +
      "<span id='cityPhoneUnread' style='display:none;align-items:center;justify-content:center;min-width:19px;height:19px;padding:0 5px;box-sizing:border-box;border-radius:10px;background:#d64545;color:white;font-size:10px'>0</span></div>" +
      "<div style='font-size:12px;color:" + DIM + "'>" + esc(clockLabel()) + "</div>";
    panel.appendChild(head);
    noticeBadge = head.querySelector("#cityPhoneUnread");
    updateNoticeBadge();

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
      // ---- DEMOLITION: the detonator lives here now, not in your hand.
      // Closes the phone on a live send — you want to be LOOKING at it.
      const dt2 = e.target && e.target.closest ? e.target.closest("[data-demo]") : null;
      if (dt2) {
        if (dt2.getAttribute("data-on") === "1" && typeof CBZ.cityC4Detonate === "function") {
          let sent = false;
          try { sent = CBZ.cityC4Detonate(); } catch (err) {}
          if (sent) { close(); return; }
        }
        render();
        return;
      }
      // ---- CONTACTS clicks — the two-choice answer to a follow-up offer.
      // dialogue.js owns the outcome (mission.take / the meet mission / the
      // remembered decline); this forwards the tap and re-renders.
      const ct = e.target && e.target.closest ? e.target.closest("[data-dlgcontact]") : null;
      if (ct) {
        const D = CBZ.cityDialogue;
        if (D && typeof D.phoneAnswer === "function") {
          const yes = ct.getAttribute("data-dlgyes") === "1";
          let took = false;
          try { took = D.phoneAnswer(ct.getAttribute("data-dlgcontact"), yes); } catch (err) {}
          if (yes && took) { close(); return; }   // job's on — go work it (gig idiom)
        }
        render();
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
    // MUTUAL EXCLUSION with the full map: taking the phone out puts the map
    // away first — the two overlays never stack (fullmap.open() reciprocates
    // via CBZ.cityClosePhone).
    if (CBZ.fullMap && CBZ.fullMap.active && CBZ.fullMap.close) {
      try { CBZ.fullMap.close(false); } catch (e) {}
    }
    if (CBZ.cityMenuOpen) return;
    open_ = true; CBZ.cityMenuOpen = true;
    el().style.display = "block";
    noticeUnread = 0;
    updateNoticeBadge();
    render();
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
  }
  function close() {
    if (!open_) return;   // no-op unless we own the menu lock (callers may probe)
    open_ = false;
    if (panel) panel.style.display = "none";
    CBZ.cityMenuOpen = false;
    // skip the relock while the full map owns the cursor (it opened over us)
    if (CBZ.requestLock && g.state === "playing" && !(CBZ.fullMap && CBZ.fullMap.active)) CBZ.requestLock();
  }
  CBZ.cityOpenPhone = open;
  CBZ.cityClosePhone = close;   // fullmap.js calls this when the map opens

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
    // The story campaign owns a physical, cross-mode phone (missions/messages/
    // news). Do not open the legacy city-dashboard modal on the same [P] press.
    if (CBZ.cityCampaignActive && CBZ.cityCampaignActive()) return;
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

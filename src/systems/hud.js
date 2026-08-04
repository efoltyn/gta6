/* ============================================================
   systems/hud.js — DOM HUD references + small display helpers
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;

  const el = {
    objText: document.getElementById("objText"),
    cigText: document.getElementById("cigText"),
    timer: document.getElementById("timer"),
    keycard: document.getElementById("keycard"),
    detectLabel: document.querySelector("#detectWrap .lab span:first-child"),
    bar: document.getElementById("detectBar"),
    dstate: document.getElementById("detectState"),
    gangHud: document.getElementById("gangHud"),
    hint: document.getElementById("hint"),
    toast: document.getElementById("toast"),
    vignette: document.getElementById("vignette"),
    flash: document.getElementById("flash"),
    invList: document.getElementById("invList"),
    interact: document.getElementById("interact"),
    interactName: document.getElementById("interactName"),
    interactNote: document.getElementById("interactNote"),
    interactOpts: document.getElementById("interactOpts"),
  };

  // City prose belongs on the handset, not over the world. Control legends are
  // not notifications at all, so they are simply suppressed here. Campaign
  // mode installs its own phone wrapper later; the legacy city phone exposes
  // cityPhoneNotify for the non-campaign world.
  const CITY_CONTROL_RE = /\[[A-Za-z0-9/\- ]{1,8}\]|\b(?:press|click|hold|tap)\b|\bLMB\b|\bRMB\b|Shift\+|\bWASD\b/i;
  function routeCityText(t, app, from) {
    if (!CBZ.game || CBZ.game.mode !== "city") return false;
    const text = String(t == null ? "" : t).trim();
    if (!text || CITY_CONTROL_RE.test(text)) return true;
    // mode.js owns the importance/diegesis policy once it has loaded. Direct
    // legacy flashToast/flashHint callers must pass that same gate instead of
    // filling the handset with every old combat/status toast.
    if (typeof CBZ.cityPhoneWorthy === "function" && !CBZ.cityPhoneWorthy(text, null, app === "news")) return true;
    if (typeof CBZ.cityPhoneNotify === "function") {
      CBZ.cityPhoneNotify({ app: app || "messages", from: from || "City Desk", text: text });
    } else if (CBZ.cityCampaignActive && CBZ.cityCampaignActive() && typeof CBZ.phoneNotify === "function") {
      CBZ.phoneNotify({ app: app || "messages", from: from || "City Desk", text: text });
    }
    return true;
  }

  function setObjective(t) {
    if (routeCityText(t, "missions", "Dispatch")) {
      if (el.objText) el.objText.textContent = "";
      if (objEl) objEl.style.display = "none";
      return;
    }
    // a normal objective string also exits kill-feed mode (e.g. starting an
    // escape match after a survival one) so the panel reads correctly again
    if (objEl && objEl.classList.contains("killfeed")) { objEl.classList.remove("killfeed"); if (objTag) objTag.textContent = "Objective"; }
    el.objText.textContent = t;
  }
  // TOUCH_HINT_SUBTITLE — on touch the hint drops its .panel box and speaks in
  // the world-subtitle grammar (css/hud.css #hint.hint-sub). The boxed centre
  // cell is the last legacy mid-screen popup ("TASED — you hit the floor!"),
  // and on iPad it landed inside the docked interaction rail's column. Same
  // text, same timing, same element — only the skin and floor move, so every
  // flashHint caller is covered without being touched. Toggled per show, not
  // at boot, because CBZ.touchMode latches on the first touch, after this file
  // has loaded. Flag false = the boxed panel, byte-identical.
  if (CBZ.CONFIG && CBZ.CONFIG.TOUCH_HINT_SUBTITLE == null) CBZ.CONFIG.TOUCH_HINT_SUBTITLE = true;
  function showHint(t) {
    if (routeCityText(t, "messages", "City Desk")) { hideHint(); return; }
    el.hint.classList.toggle("hint-sub",
      !!(CBZ.touchMode && (!CBZ.CONFIG || CBZ.CONFIG.TOUCH_HINT_SUBTITLE !== false)));
    el.hint.textContent = t; el.hint.classList.add("show");
  }
  function hideHint() { el.hint.classList.remove("show"); }

  // ---- survival KILL FEED: the objective panel becomes a running list of
  //      who just died and how ("Nova47 — struck by lightning"). Lines age
  //      out; the panel is relabelled. Escape mode never calls these. ----
  const objEl = document.getElementById("objective");
  const objTag = objEl ? objEl.querySelector(".tag") : null;
  let feed = [];
  // RESET MEANS EMPTY, NOT "OPEN AN EMPTY PANEL". This used to stamp the
  // .killfeed class on at survival start, which is the ONLY thing that made
  // the objective panel visible in that mode (hud.css fades #objective
  // :not(.killfeed) whenever the minimap is up) — so a match began with a
  // titled, permanently-empty "Casualties" box in the corner. Survival's
  // deaths go to city/killfeed.js's corner feed now; this whole panel is a
  // degrade-safe fallback and only opens when something is actually pushed.
  function killFeedReset() {
    feed = [];
    if (el.objText) el.objText.innerHTML = "";
    if (objEl) objEl.classList.remove("killfeed");
  }
  function pushKill(text, color, big) {
    // City deaths are recorded by city/killfeed.js and delivered to News. The
    // prison/survival objective panel must never leak a second kill line into
    // the city HUD.
    if (CBZ.game && CBZ.game.mode === "city") return;
    if (!el.objText) return;
    if (objTag) objTag.textContent = "Casualties";
    if (objEl) objEl.classList.add("killfeed");
    const line = document.createElement("div");
    line.className = "kfeed" + (big ? " kfeed-you" : "");
    line.textContent = text;
    if (color) line.style.color = color;
    el.objText.appendChild(line);
    void line.offsetWidth;            // reflow so the slide-in plays
    line.classList.add("in");
    feed.push({ el: line, t: 0 });
    while (feed.length > 6) { const old = feed.shift(); if (old.el.parentNode) old.el.parentNode.removeChild(old.el); }
  }
  // exported as survKillFeedReset: city/killfeed.js (loaded later) claims the
  // plain CBZ.killFeedReset name for ITS feed, which silently shadowed this
  // one — survival's reset was clearing the city array instead of this DOM.
  CBZ.survKillFeedReset = killFeedReset;
  CBZ.pushKill = pushKill;
  // age the feed: fade each line after ~7s, drop it after ~9s
  CBZ.onAlways(94, function (dt) {
    if (!feed.length) return;
    for (let i = feed.length - 1; i >= 0; i--) {
      const f = feed[i]; f.t += dt;
      if (f.t > 7 && !f.fading) { f.fading = true; f.el.classList.add("out"); }
      if (f.t > 9) { if (f.el.parentNode) f.el.parentNode.removeChild(f.el); feed.splice(i, 1); }
    }
  });

  // auto-hiding hint: shows for `secs` seconds, ticked in the always loop
  let _hintT = 0;
  function flashHint(t, secs) { showHint(t); _hintT = secs || 1.6; }
  CBZ.onAlways(95, function (dt) {
    if (_hintT > 0) { _hintT -= dt; if (_hintT <= 0) hideHint(); }
  });

  // ============================================================
  //  A PICKUP IS A FEED LINE, NOT A SHOUT.
  //
  //  OWNER (2026-07-30, playing on an iPad), verbatim: "I just got a popup on
  //  screen luxury watch in red huge in screen that's dumb af". He is right
  //  twice over. #toast is a 64px white-on-RED comic-book slam in the middle of
  //  the screen (44px on a narrow one — css/mobile.css:323) with a rotate-pop,
  //  and systems/economy.js fired it for an INVENTORY PICKUP: the moment a
  //  frisk turned up a rare/epic item it called
  //  `flashToast(rare.toUpperCase() + "!")`. A found watch is close to the
  //  smallest event this game has and it was shouting louder than a lockdown.
  //
  //  CLAUDE.md's HUD doctrine settles what replaces it: the ONE sanctioned
  //  popup is the corner killfeed, and rich info lives in quiet feeds, never
  //  floating centre cards. So a pickup gets the killfeed's own grammar — a
  //  small dark pill on the left edge, the item name in ink, stacked newest at
  //  the bottom, gone in 2.5 s. That is deliberately the SAME shape as the
  //  survival `.kfeed` rows above it in this file and as city/killfeed.js's
  //  corner strips: three feeds that read as one HUD language rather than
  //  three notification systems.
  //
  //  WHERE IT SITS is derived, not chosen — see the `--pickup-floor` block in
  //  css/hud.css, which measures the bottom-left cluster it has to clear in
  //  each mode (jail #gangHud / city radar stack / the touch joystick).
  // ============================================================
  const PICK_MAX = 4;      // four lines is a feed; more is wallpaper
  const PICK_LIFE = 2.5;   // seconds a row is on screen
  const PICK_FADE = 0.45;  // the tail of that life spent fading out
  let pickEl = null;
  const picks = [];
  // Same lazy-attach shape systems/killstreaks.js:22 uses for #streakHud: mount
  // on the HUD root, style it in css/hud.css. Re-checks parentNode so a mode
  // teardown that wipes the root can never leave us writing into an orphan.
  function pickRoot() {
    if (pickEl && pickEl.parentNode) return pickEl;
    if (typeof document === "undefined") return null;
    const host = document.getElementById("hud") || document.body;
    if (!host) return null;
    pickEl = document.createElement("div");
    pickEl.id = "pickupFeed";
    pickEl.setAttribute("aria-live", "polite");
    host.appendChild(pickEl);
    return pickEl;
  }
  // ×N shows only once there IS an N; the spans are always present and the
  // sheet hides the empty ones, so a bump costs one textContent write.
  function pickCount(rec) { if (rec.xEl) rec.xEl.textContent = rec.n > 1 ? "×" + rec.n : ""; }

  // CBZ.pickupNote(text, opts) — one quiet line in the bottom-left feed.
  //   text        the thing picked up, in its own casing ("Luxury Watch").
  //   opts.rare   truthy → gold name + gold edge. SUBTLE, and gold because
  //               city/killfeed.js already spends gold on "this line is about
  //               you" — never red, and never anywhere near screen centre.
  //   opts.count  >1 → a dim "×N" after the name.
  //   opts.note   short tag rendered small/dim on the right ("EPIC", "$70").
  //   opts.life   seconds on screen (default 2.5).
  // Callers guard (`CBZ.pickupNote && CBZ.pickupNote(...)`), so this may be
  // absent; it must never throw when present.
  function pickupNote(text, opts) {
    const name = String(text == null ? "" : text).trim();
    if (!name) return;
    opts = opts || {};
    const root = pickRoot();
    if (!root) return;
    const rare = !!opts.rare;
    const add = Math.max(1, (+opts.count || 1) | 0);
    // REPEATS COLLAPSE. Three planks out of one crate is one line counting to
    // three, not three lines — city/hud.js's feed collapses on the same
    // principle (its " (xN)" suffix). Only the NEWEST row can absorb a repeat
    // and only while it is still fully lit: a row that has begun fading has
    // already said its piece.
    const last = picks.length ? picks[picks.length - 1] : null;
    if (last && !last.fading && last.name === name && last.rare === rare) {
      last.n += add; last.t = 0; pickCount(last);
      return;
    }
    const row = document.createElement("div");
    row.className = "pnRow" + (rare ? " rare" : "");
    const nameEl = document.createElement("span");
    nameEl.className = "pnName";
    nameEl.textContent = name;          // textContent, so a loot name can never carry markup
    const xEl = document.createElement("span");
    xEl.className = "pnX";
    const tagEl = document.createElement("span");
    tagEl.className = "pnTag";
    tagEl.textContent = opts.note ? String(opts.note) : "";
    row.appendChild(nameEl); row.appendChild(xEl); row.appendChild(tagEl);
    root.appendChild(row);
    void row.offsetWidth;               // reflow so the slide-in plays (same as pushKill)
    row.classList.add("in");
    const rec = { el: row, xEl: xEl, name: name, rare: rare, n: add, t: 0, life: Math.max(0.6, +opts.life || PICK_LIFE), fading: false };
    pickCount(rec);
    picks.push(rec);
    // oldest is at the TOP of the column (newest is appended at the bottom,
    // nearest the anchor), so overflow sheds from the front.
    while (picks.length > PICK_MAX) { const old = picks.shift(); if (old.el.parentNode) old.el.parentNode.removeChild(old.el); }
  }
  // aged on the always chain like the survival feed above — game time, so a
  // paused game does not silently burn the line you were reading.
  CBZ.onAlways(93, function (dt) {
    if (!picks.length) return;
    for (let i = picks.length - 1; i >= 0; i--) {
      const p = picks[i]; p.t += dt;
      if (!p.fading && p.t > p.life - PICK_FADE) { p.fading = true; p.el.classList.add("out"); }
      if (p.t > p.life) { if (p.el.parentNode) p.el.parentNode.removeChild(p.el); picks.splice(i, 1); }
    }
  });

  // ---- QUIET TOASTS -------------------------------------------------------
  // One flag covers both halves of the fix, so it is one line back to the old
  // screen: the JS below stops routing pickups into #toast, and the body class
  // it stamps is what css/hud.css hangs the civilised banner skin off (a
  // stylesheet cannot read CBZ.CONFIG, and a revert that only half-applies is
  // not a revert). Declared HERE, in the owning file, per CLAUDE.md — never in
  // config.js, which is an Edit-race file.
  const CFG = CBZ.CONFIG || (CBZ.CONFIG = {});
  if (CFG.PRISON_QUIET_TOASTS == null) CFG.PRISON_QUIET_TOASTS = true;
  function armQuietToasts() {
    if (!CFG.PRISON_QUIET_TOASTS || typeof document === "undefined" || !document.body) return;
    document.body.classList.add("quiet-toasts");
  }
  armQuietToasts();

  // AN ITEM SHOUT IS PROVED AGAINST THE ITEM TABLE, NEVER GUESSED AT.
  // "LUXURY WATCH!" is a pickup and "CUFFED — BACK TO YOUR CELL" is a state
  // banner, and no regex over shouty text separates those two reliably.
  // systems/economy.js already owns the ONE list of things a body can be
  // carrying, so the test is a lookup in it: strip the "!", match a key,
  // inherit that key's own casing and rarity. Anything the table has never
  // heard of stays a toast, which means a missing or late CBZ.econ costs us
  // only the routing — never the message.
  //
  // The jail keycard is the one pickup with no ITEMS row (it lives on
  // game.hasKeycard and already lights the #keycard chip), so it is NAMED here
  // rather than pattern-guessed — systems/interactions.js:30.
  const EXTRA_PICKUPS = { KEYCARD: "rare" };
  let itemIdx = null, itemIdxSrc = null;
  function itemIndex() {
    const tbl = CBZ.econ && CBZ.econ.ITEMS;
    if (!tbl) return null;
    if (itemIdx && itemIdxSrc === tbl) return itemIdx;   // rebuilt only if econ re-declares the table
    itemIdxSrc = tbl; itemIdx = Object.create(null);
    for (const k in tbl) itemIdx[k.toUpperCase()] = { name: k, rarity: (tbl[k] && tbl[k].rarity) || "common" };
    return itemIdx;
  }
  function itemShout(t) {
    const s = String(t == null ? "" : t).trim();
    if (s.length < 3 || s.length > 26 || s.charAt(s.length - 1) !== "!") return null;
    const shout = s.slice(0, -1).trim();
    // an em-dash or a comma means a SENTENCE, which is the grammar every mode
    // banner uses ("STRIKE 2 — FINAL WARNING"). A plain hyphen is allowed —
    // "Gun-Room Key" is a real item.
    if (!shout || /[—,;:]/.test(shout)) return null;
    const idx = itemIndex();
    const hit = (idx && idx[shout.toUpperCase()]) || null;
    if (hit) return hit;
    const extra = EXTRA_PICKUPS[shout.toUpperCase()];
    return extra ? { name: shout.charAt(0) + shout.slice(1).toLowerCase(), rarity: extra } : null;
  }

  // Mode banners keep a red-tinted EDGE so danger still reads as danger — a
  // border and a faint bloom, not the old four-layer red text ladder. Built
  // from the real caller list (capture.js / lockdown.js / disasters.js /
  // killstreaks.js / reinforcements.js / interactions.js); "ALL CLEAR",
  // "POWER RESTORED" and "TIME SERVED — GATE'S OPEN" are deliberately not in it.
  const TOAST_ALARM_RE = /\b(?:LOCKDOWN|STRIKE|CUFFED|BACK TO|BUSTED|ALARM|MANHUNT|INCOMING|BRACE|SWEPT|NUKE|POWER OUT|REINFORCEMENTS)\b/i;

  function flashToast(t) {
    // A pure item shout leaves the centre of the screen entirely, in EVERY
    // mode — this runs ahead of routeCityText because "LUXURY WATCH!" pushed
    // to the handset as a City Desk news item would be just as wrong as
    // slamming it over the crosshair. The real fix for the loot path lands in
    // its own file (economy.js calls CBZ.pickupNote directly); this gate is
    // what catches the callers that still shout, and the flag turns it off.
    if (CFG.PRISON_QUIET_TOASTS) {
      const it = itemShout(t);
      if (it) {
        pickupNote(it.name, { rare: it.rarity === "rare" || it.rarity === "epic", note: it.rarity === "common" ? "" : it.rarity });
        return;
      }
    }
    if (routeCityText(t, "news", "City Desk")) {
      if (el.toast) { el.toast.classList.remove("pop", "toast-alarm"); el.toast.textContent = ""; }
      return;
    }
    if (!el.toast) return;
    armQuietToasts();          // idempotent; a rare path, and it makes the skin unmissable
    el.toast.textContent = t;
    el.toast.classList.toggle("toast-alarm", TOAST_ALARM_RE.test(String(t == null ? "" : t)));
    el.toast.classList.remove("pop");
    void el.toast.offsetWidth; // reflow to restart the animation
    el.toast.classList.add("pop");
  }
  function fmtTime(s) {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
  }

  // redraw the small inventory strip from game.inventory
  function refreshInventory() {
    const inv = CBZ.game.inventory;
    const parts = Object.keys(inv).filter((k) => inv[k] > 0)
      .map((k) => `${k}${inv[k] > 1 ? " ×" + inv[k] : ""}`);
    el.invList.textContent = parts.length ? parts.join("  ·  ") : "—";
  }

  /* ==========================================================================
     THE PANEL IS GONE (JAIL_GANG_HUD, default FALSE).

     OWNER (2026-08-04, second pass): "Don't clear up the logic behind the HUD
     space wasters. Improve that logic, connect it all, and make it real logic,
     but remove it from the HUD."

     The first pass made this strip CONDITIONAL — a cell only drew while it
     carried news. That was the wrong half of the answer, because a chip that
     appears when something happens is still a chip reporting an event you are
     standing next to. The event has a mouth now: entities/ai.js's narrations
     run through CBZ.prisonSay (systems/interact.js), so the collector TELLS you
     the number, the man you stiffed TELLS you the cover is off, and the rat
     TELLS the screw where you were — which is also how you learn it was him.

     NOT ONE NUMBER IS DELETED. gangStanding, gangProtection, gangDebt, gangJob,
     the racket ledger, the case file and the block buzz all still run and still
     drive the AI exactly as before (entities/ai.js reads gangStanding in 61
     places and not one of them was this panel). What changes is that they are
     read off the WORLD, and off the Ranks board's STANDING page when you want
     the ledger — never off a strip welded to the corner of the screen.

     The whole build is skipped rather than hidden: this ran an innerHTML
     rebuild plus three full CBZ.npcs scans EVERY frame, so switching it off is
     also the cheapest change in this file. Flag true = the panel returns, live
     rules and all.
     ========================================================================== */
  if (CFG.JAIL_GANG_HUD == null) CFG.JAIL_GANG_HUD = false;
  // see the JAIL_GANG_HUD_LIVE block at the foot of refreshGangHud
  if (CFG.JAIL_GANG_HUD_LIVE == null) CFG.JAIL_GANG_HUD_LIVE = true;
  let gangSig = "";
  function gangHide() {
    if (gangSig === " ") return;
    gangSig = " ";                    // never equal to any real markup
    el.gangHud.style.display = "none";
  }
  function refreshGangHud() {
    if (!el.gangHud) return;
    if (!CFG.JAIL_GANG_HUD) { gangHide(); return; }
    const g = CBZ.game || {};
    // CITY: #gangHud is display:none!important (css/city.css) — this is the
    // prison-gang panel. Skip the whole innerHTML rebuild + npc scans there
    // (measured: a full string build + 3 .find()/.filter() passes EVERY frame
    // for an invisible element).
    if (g.mode === "city") return;
    if (g.role === "cop" || g.state !== "playing") { gangHide(); return; }
    const standing = g.gangStanding || [0, 0];
    const cover = g.gangProtection || [0, 0];
    const debt = g.gangDebt || [0, 0];
    const job = g.gangJob;
    const crew = CBZ.player && CBZ.player.gang != null && CBZ.GANG_NAMES ? CBZ.GANG_NAMES[CBZ.player.gang].replace(/^the /, "") : "None";
    const coverBits = [];
    const debtBits = [];
    const pressureBits = [];
    const buzz = CBZ.topBlockBuzz ? CBZ.topBlockBuzz() : null;
    const csum = CBZ.caseSummary && CBZ.caseSummary();
    const trace = CBZ.wantedBreakdown && CBZ.wantedBreakdown();
    const knownReporter = (CBZ.npcs || []).find((n) => n && n.data && (n.reportedPlayerT || 0) > 0 && !n.dead && !(n.ko > 0));
    const crewHunter = (CBZ.npcs || []).find((n) => n && n.gang >= 0 && (n.huntPlayer || 0) > 0 && !n.dead && !(n.ko > 0));
    const watcher = (CBZ.npcs || []).find((n) => n && n.data && n.aiState === "tailPlayer" && !n.dead && !(n.ko > 0));
    const crewPress = (CBZ.npcs || []).filter((n) => n && n.aiState === "pressurePlayer" && !n.dead && !(n.ko > 0));
    const jobText = job && job.t > 0
      ? `${job.label || "Job"} ${job.need ? Math.floor(job.progress || 0) + "/" + Math.ceil(job.need) : Math.ceil(job.t) + "s"}`
      : "";
    const nameOf = (a) => a && a.data ? a.data.name.replace(/^the |^a |^an /, "") : "";
    const shortSource = (s) => String(s || "lead").replace(/^the |^a |^an /, "").slice(0, 12);
    const credWord = (r) => r.weak ? "weak" : ((r.credibility || 0) > 0.76 ? "solid" : "lead");
    const chip = (cls, text) => `<span class="${cls}">${text}</span>`;
    if ((cover[0] || 0) > 0) coverBits.push(`R ${Math.ceil(cover[0])}s`);
    if ((cover[1] || 0) > 0) coverBits.push(`B ${Math.ceil(cover[1])}s`);
    if ((debt[0] || 0) > 0) debtBits.push(`R ${Math.ceil(debt[0])}`);
    if ((debt[1] || 0) > 0) debtBits.push(`B ${Math.ceil(debt[1])}`);
    for (let i = 0; i < 2; i++) {
      const tag = i === 0 ? "R" : "B";
      if ((debt[i] || 0) >= 18) pressureBits.push(chip("hot", `${tag} collecting`));
      else if ((standing[i] || 0) <= -42) pressureBits.push(chip("hot", `${tag} hostile`));
      else if ((standing[i] || 0) >= 48) pressureBits.push(chip("good", `${tag} loyal`));
    }
    if ((g.racketProtectionT || 0) > 0) pressureBits.push(chip("good", `Bent cover ${Math.ceil(g.racketProtectionT)}s`));
    else if ((g.racketDebt || 0) >= 26 || (g.racketStanding || 0) <= -34) pressureBits.push(chip("hot", `Bent leak ${Math.ceil(g.racketDebt || 0)}`));
    else if ((g.racketDebt || 0) >= 18 || (g.racketStanding || 0) <= -24) pressureBits.push(chip("hot", `Bent squeeze ${Math.ceil(g.racketDebt || 0)}`));
    else if ((g.racketDebt || 0) > 0) pressureBits.push(chip("hot", `Bent debt ${Math.ceil(g.racketDebt)}`));
    if (Math.abs(g.racketStanding || 0) >= 8) {
      pressureBits.push(chip((g.racketStanding || 0) > 0 ? "good" : "warn", `${(g.racketStanding || 0) > 0 ? "Bent trust" : "Bent heat"} ${Math.round(Math.abs(g.racketStanding || 0))}`));
    }
    if ((g.lowProfileT || 0) > 0) pressureBits.push(chip("good", `Cash quiet ${Math.ceil(g.lowProfileT)}s`));
    else if ((g.cigs || 0) >= 18) pressureBits.push(chip("hot", "Cash loud"));
    else if ((g.cigs || 0) >= 10) pressureBits.push(chip("warn", "Cash noticed"));
    let traceShown = false;
    if (trace && trace.mode && trace.mode !== "clear" && trace.mode !== "badge") {
      const cls = trace.mode === "corrupt" ? "hot" : ((trace.strength || 0) > 35 ? "hot" : "warn");
      pressureBits.push(chip(cls, trace.chip || trace.label));
      traceShown = true;
    }
    if (!traceShown && knownReporter) pressureBits.push(chip("hot", `Snitch ${nameOf(knownReporter)}`));
    else if (!traceShown && g.lastKnown && g.lastKnown.t > 0) pressureBits.push(chip("warn", `Search ${g.lastKnown.source || "lead"}`));
    if (crewHunter) {
      const crewName = CBZ.GANG_NAMES && CBZ.GANG_NAMES[crewHunter.gang] ? CBZ.GANG_NAMES[crewHunter.gang].replace(/^the /, "") : "Crew";
      pressureBits.push(chip("hot", `${crewName} angry`));
    }
    if (crewPress.length) {
      const tactics = Array.from(new Set(crewPress.map((n) => n.pressureTactic).filter(Boolean))).slice(0, 2).join("/");
      pressureBits.push(chip("warn", `Crew press ${crewPress.length}${tactics ? " " + tactics : ""}`));
    }
    if (watcher) pressureBits.push(chip(watcher.tailKind === "cover" ? "good" : "warn", `Watched ${nameOf(watcher)}`));
    if (csum && csum.heat > 10) {
      const sources = (csum.reports && csum.reports.length ? csum.reports : (CBZ.caseSources ? CBZ.caseSources(3) : [])).slice(0, 3);
      if (sources.length > 1) pressureBits.push(chip("warn", `Case ${sources.length} src`));
      if (sources[0] && !traceShown) {
        const r = sources[0];
        const age = r.ttl ? ` ${Math.ceil(r.ttl)}s` : "";
        pressureBits.push(chip((r.weak || csum.heat < 28) ? "warn" : "hot", `Lead ${shortSource(r.source)} ${credWord(r)}${age}`));
      } else if (!traceShown) {
        const strength = csum.weak ? "Weak tip" : "Case";
        const age = csum.ttl ? ` ${Math.ceil(csum.ttl)}s` : "";
        pressureBits.push(chip(csum.heat > 28 && !csum.weak ? "hot" : "warn", `${strength} ${csum.source || csum.type || "open"}${age}`));
      }
      if (sources[1]) pressureBits.push(chip(sources[1].weak ? "warn" : "hot", `Src ${shortSource(sources[1].source)} ${credWord(sources[1])}`));
    }
    // (JAIL_GANG_HUD revert path only.) Reads the real fact now — how many
    // reporters the player has actually MADE — instead of the deleted
    // g.snitchIntelT countdown, which was this chip and nothing else.
    const rats = CBZ.snitchKnowledgeAudit ? CBZ.snitchKnowledgeAudit().known : 0;
    if (rats > 0) pressureBits.push(chip("good", rats === 1 ? "Rat made" : `${rats} rats made`));
    if (buzz && buzz.score > 24) pressureBits.push(chip(buzz.score > 45 ? "hot" : "warn", `Buzz ${buzz.kind}`));
    pressureBits.length = Math.min(pressureBits.length, 6);

    // ============================================================
    //  A ZERO IS NOT NEWS (JAIL_GANG_HUD_LIVE).
    //
    //  OWNER (2026-08-04, phone screenshot): "the respect reds 0 blues 0 that
    //  whole thing in bottom of hud — look at what that is, don't kill the
    //  logic but kill the hud space waste."
    //
    //  What it was: a two-line block reading RESPECT · REDS 0 · BLUES 0 · CREW
    //  NONE · BUZZ FEAR. Four of those five cells said the same thing every
    //  frame of a fresh run — "nothing has happened yet" — in 33 characters,
    //  and they wrapped the one cell that WAS live onto a second line. The
    //  label "RESPECT" is the panel's own name printed inside the panel; the
    //  words "REDS"/"BLUES" repeat what the red and blue INK already says.
    //
    //  Not one number below is dropped and not one branch above is touched.
    //  What changes is that a cell only exists while it carries news:
    //    · standing  — drawn as coloured `R 42` / `B -18`, and only once the
    //                  gang has an opinion at all (|standing| >= 1).
    //    · crew      — only when you are IN one. "Crew None" is the absence of
    //                  a fact, and the absence of a fact is not a HUD row.
    //    · cover/debt/pressure/job — unchanged; they were already conditional,
    //                  which is exactly why they are the ones worth the space.
    //  Nothing live at all → the panel is not on screen. The bottom-left of a
    //  quiet prison is now empty, which is what a quiet prison looks like.
    //
    //  Also fixes a real cost: this ran innerHTML EVERY frame with identical
    //  markup. It now writes only when the string changes (the same rule
    //  systems/gungamehud.js and city/hud.js's bar already follow).
    //  Flag false = the old five-cell block, byte for byte.
    // ============================================================
    const live = CFG.JAIL_GANG_HUD_LIVE !== false;
    let html;
    if (!live) {
      html = '<span class="tag">Respect</span>' +
        `<span class="red">Reds ${Math.round(standing[0] || 0)}</span>` +
        `<span class="blue">Blues ${Math.round(standing[1] || 0)}</span>` +
        `<span class="crew">Crew ${crew}</span>` +
        (coverBits.length ? chip("good", `Cover ${coverBits.join(" ")}`) : "") +
        (debtBits.length ? chip("hot", `Debt ${debtBits.join(" ")}`) : "") +
        (pressureBits.length ? pressureBits.join("") : "") +
        (jobText ? chip("good", `Job ${jobText}`) : "");
    } else {
      const rN = Math.round(standing[0] || 0), bN = Math.round(standing[1] || 0);
      html =
        (Math.abs(rN) >= 1 ? `<span class="red">R ${rN}</span>` : "") +
        (Math.abs(bN) >= 1 ? `<span class="blue">B ${bN}</span>` : "") +
        (CBZ.player && CBZ.player.gang != null && CBZ.player.gang >= 0
          ? `<span class="crew">${crew}</span>` : "") +
        (coverBits.length ? chip("good", `Cover ${coverBits.join(" ")}`) : "") +
        (debtBits.length ? chip("hot", `Debt ${debtBits.join(" ")}`) : "") +
        (pressureBits.length ? pressureBits.join("") : "") +
        (jobText ? chip("good", jobText) : "");
      if (!html) { gangHide(); return; }
    }
    if (html === gangSig) return;                 // identical markup: no DOM work
    gangSig = html;
    el.gangHud.style.display = "flex";
    el.gangHud.innerHTML = html;
  }

  CBZ.onAlways(91, refreshGangHud);

  CBZ.el = el;
  CBZ.setObjective = setObjective;
  CBZ.showHint = showHint;
  CBZ.hideHint = hideHint;
  CBZ.flashHint = flashHint;
  CBZ.flashToast = flashToast;
  // the quiet pickup feed — callers guard it (`CBZ.pickupNote && ...`) so the
  // whole surface degrades to nothing if this file is ever pulled.
  CBZ.pickupNote = pickupNote;
  CBZ.fmtTime = fmtTime;
  CBZ.refreshInventory = refreshInventory;
  CBZ.refreshGangHud = refreshGangHud;
})();

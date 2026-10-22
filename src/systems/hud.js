/* ============================================================
   systems/hud.js — DOM HUD references + the text renderers every mode
   shares (flashHint / showHint / flashToast / pickupNote / setObjective).

   THE PRISON IS BARE (owner, 2026-09-27: "every HUD, the overlapping tabs,
   everything should be considered for removal, including the minimap, the
   timer, pills that mean nothing. SHOW DON'T TELL." and "all the text...
   there's just too much bullshit in the way").

   In escape mode this file stamps `body.prison-bare`, and css/hud.css hides
   every always-on panel under it (objective, clock, cigs, keycard chip,
   stash strip, wanted meter, compass, minimap, Ranks button, run stats,
   pickup feed, crate chip...). What is left is the world, the verb pinned
   on the thing (systems/interactions.js prisonPrompt), the hotbar, the
   crosshair, and the escape plan behind one key / one
   small button (systems/escapeplan.js), which is also where the clock, the
   cigs, the map and the rankings live now.

   THE RENDERERS ENFORCE IT, so the ~70 leftover flashHint/flashToast call
   sites in other files cannot flood the screen. In escape mode:
     - hints and toasts share ONE line (the no-box subtitle skin);
     - one visible at a time, a minimum gap between lines, duplicates
       inside a window suppressed;
     - anything over LINE_MAX characters is cut to its first sentence or
       first clause, or dropped; em dashes / middle dots never reach the
       screen;
     - an item pickup is dropped (the hotbar shows the item).
   Every drop is counted: CBZ.prisonHudAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;

  const el = {
    cigText: document.getElementById("cigText"),
    timer: document.getElementById("timer"),
    detectLabel: document.querySelector("#detectWrap .lab span:first-child"),
    bar: document.getElementById("detectBar"),
    dstate: document.getElementById("detectState"),
    hint: document.getElementById("hint"),
    toast: document.getElementById("toast"),
    flash: document.getElementById("flash"),
    interact: document.getElementById("interact"),
    interactName: document.getElementById("interactName"),
    interactNote: document.getElementById("interactNote"),
    interactOpts: document.getElementById("interactOpts"),
  };

  function prison() { return !!(CBZ.game && CBZ.game.mode === "escape"); }

  // ---- THE BARE PRISON: one body class, css/hud.css does the hiding ----
  let bareOn = null;
  function syncBare() {
    const on = prison();
    if (on === bareOn || !document.body) return;
    bareOn = on;
    document.body.classList.toggle("prison-bare", on);
  }
  syncBare();
  CBZ.onAlways(70, syncBare);

  // ---- THE ESCAPE-MODE LINE POLICY ----------------------------------------
  const LINE_MAX = 60;       // longer than this is cut to a clause or dropped
  const LINE_GAP = 2.5;      // seconds between two lines
  const DUP_WINDOW = 12;     // the same words inside this window are dropped
  const audit = {
    toastsShown: 0, toastsDropped: 0, hintsShown: 0, hintsDropped: 0, pickupsDropped: 0,
  };
  const recent = new Map();  // normalized text -> wall seconds shown
  let lastShownAt = -1e9;

  function wall() { return (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000; }
  function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim(); }

  /* One line of plain words. Dashes and dots become sentence breaks, a long
     line keeps its first sentence, then its first clause, else it is gone. */
  function trimLine(t) {
    let s = String(t == null ? "" : t).replace(/\s+/g, " ").trim();
    if (!s) return "";
    s = s.replace(/\s*[—–·•]\s*/g, ". ").replace(/\s+-\s+/g, ". ").replace(/\.\s*\./g, ".").trim();
    s = s.replace(/^[.\s]+|[\s]+$/g, "");
    if (s.length <= LINE_MAX) return s;
    // whole sentences, as many as fit
    const sents = s.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || [];
    let out = "";
    for (let i = 0; i < sents.length; i++) {
      const next = (out ? out + " " : "") + sents[i].trim();
      if (next.length > LINE_MAX) break;
      out = next;
    }
    if (out) return out;
    const clause = s.split(/[,;:]\s/)[0].trim();
    if (clause.length <= LINE_MAX && clause.length >= 3) return clause;
    return "";
  }

  // returns the words to show, or "" (dropped). Only ever called in escape.
  function admit(t, kind) {
    const s = trimLine(t);
    const drop = function () { if (kind === "toast") audit.toastsDropped++; else audit.hintsDropped++; return ""; };
    if (!s) return drop();
    const now = wall(), key = norm(s);
    for (const [k, at] of recent) if (now - at > DUP_WINDOW) recent.delete(k);
    if (recent.has(key)) return drop();
    if (_hintT > 0 || now - lastShownAt < LINE_GAP) return drop();
    recent.set(key, now);
    lastShownAt = now;
    if (kind === "toast") audit.toastsShown++; else audit.hintsShown++;
    return s;
  }

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

  /* NO OBJECTIVE ON SCREEN, IN ANY MODE (owner, 2026-10-22: "the 'find a
     keycard and escape' pop-up is in the top left ... that shouldn't even be
     in the jail game either"). Nobody tells you the way out, the keycard or
     the gun room. The objective is a STRING the game's own logic can still
     set (a guard's job, the lockdown, the sentence clock) — it is never
     painted. In the city a mission line still goes to the phone. */
  let objective = "";
  function setObjective(t) {
    if (routeCityText(t, "missions", "Dispatch")) return;
    objective = String(t == null ? "" : t);
  }

  /* THE HINT. On touch, and always in the prison, it wears the no-box
     subtitle skin (#hint.hint-sub). `_hintT` is declared before showHint
     because hideHint zeroes it during boot. */
  let _hintT = 0;
  /* SPEECH NEVER REACHES THE HUD (owner, 2026-09-27: "you don't need to see
     the dialogue in the HUD"). A person's words go over his head through
     CBZ.speech.say; a quoted line arriving here has lost its speaker, so it is
     not shown at all. Shapes: `Name: "words"`, `"words"`, `Name says "words"`. */
  const SPOKEN_RE = /^\s*(?:[^:"“]{1,40}:\s*)?[“"‘][^"”]{2,}["”’]?[.!?]?\s*$|“[^”]*\s[^”]*”|^\s*[A-Z][\w .'#-]{0,30}\s(?:says|said|asks|yells|shouts|mutters|whispers|calls)[,:]?\s*[“"]/;
  let spokenDropped = 0;
  function spoken(t) {
    if (!SPOKEN_RE.test(String(t == null ? "" : t))) return false;
    spokenDropped++;
    return true;
  }
  CBZ.hudIsSpoken = function (t) { return SPOKEN_RE.test(String(t == null ? "" : t)); };
  CBZ.hudSpokenDropped = function () { return spokenDropped; };
  function paintHint(t) {
    el.hint.classList.toggle("hint-sub", !!(CBZ.touchMode || prison()));
    el.hint.textContent = t; el.hint.classList.add("show");
  }
  function showHint(t, secs) {
    if (spoken(t)) return;
    if (routeCityText(t, "messages", "City Desk")) { hideHint(); return; }
    if (prison()) {
      // no line in the prison is permanent: a persistent showHint is a
      // short line like any other
      const s = admit(t, "hint");
      if (!s) return;
      paintHint(s);
      _hintT = Math.min(2.6, Math.max(1.4, secs || 2));
      return;
    }
    paintHint(t);
  }
  function hideHint() {
    el.hint.classList.remove("show");
    _hintT = 0;
  }
  function flashHint(t, secs) {
    if (prison()) { showHint(t, secs); return; }
    showHint(t, secs || 1.6); _hintT = secs || 1.6;
  }
  CBZ.onAlways(95, function (dt) {
    if (_hintT > 0) { _hintT -= dt; if (_hintT <= 0) hideHint(); }
  });

  // ============================================================
  //  A PICKUP IS A FEED LINE, NOT A SHOUT (owner, 2026-07-30: "luxury watch
  //  in red huge in screen that's dumb af"). Small dark pill bottom-left,
  //  gone in 2.5 s. In the prison it is not drawn at all: the item arrives
  //  in the hotbar, which is the receipt.
  // ============================================================
  const PICK_MAX = 4, PICK_LIFE = 2.5, PICK_FADE = 0.45;
  let pickEl = null;
  const picks = [];
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
  function pickCount(rec) { if (rec.xEl) rec.xEl.textContent = rec.n > 1 ? "x" + rec.n : ""; }

  // CBZ.pickupNote(text, {rare, count, note, life}) — one quiet feed line.
  function pickupNote(text, opts) {
    const name = String(text == null ? "" : text).trim();
    if (!name) return;
    // CITY: no pickup text (HUD purge 2026-09-27). What you took shows in the
    // world: it leaves the ground, the hotbar surfaces with it, cash pops.
    if (CBZ.game && CBZ.game.mode === "city") return;
    if (prison()) { audit.pickupsDropped++; return; }
    opts = opts || {};
    const root = pickRoot();
    if (!root) return;
    const rare = !!opts.rare;
    const add = Math.max(1, (+opts.count || 1) | 0);
    const last = picks.length ? picks[picks.length - 1] : null;
    if (last && !last.fading && last.name === name && last.rare === rare) {
      last.n += add; last.t = 0; pickCount(last);
      return;
    }
    const row = document.createElement("div");
    row.className = "pnRow" + (rare ? " rare" : "");
    const nameEl = document.createElement("span");
    nameEl.className = "pnName";
    nameEl.textContent = name;
    const xEl = document.createElement("span");
    xEl.className = "pnX";
    const tagEl = document.createElement("span");
    tagEl.className = "pnTag";
    tagEl.textContent = opts.note ? String(opts.note) : "";
    row.appendChild(nameEl); row.appendChild(xEl); row.appendChild(tagEl);
    root.appendChild(row);
    void row.offsetWidth;
    row.classList.add("in");
    const rec = { el: row, xEl: xEl, name: name, rare: rare, n: add, t: 0, life: Math.max(0.6, +opts.life || PICK_LIFE), fading: false };
    pickCount(rec);
    picks.push(rec);
    while (picks.length > PICK_MAX) { const old = picks.shift(); if (old.el.parentNode) old.el.parentNode.removeChild(old.el); }
  }
  CBZ.onAlways(93, function (dt) {
    if (!picks.length) return;
    for (let i = picks.length - 1; i >= 0; i--) {
      const p = picks[i]; p.t += dt;
      if (!p.fading && p.t > p.life - PICK_FADE) { p.fading = true; p.el.classList.add("out"); }
      if (p.t > p.life) { if (p.el.parentNode) p.el.parentNode.removeChild(p.el); picks.splice(i, 1); }
    }
  });

  // ---- THE TOAST: a state banner (body.quiet-toasts skin in css/hud.css) ----
  if (document.body) document.body.classList.add("quiet-toasts");

  // An item shout ("LUXURY WATCH!") is proved against economy.js's item
  // table and goes to the pickup feed instead of the banner.
  const EXTRA_PICKUPS = { KEYCARD: "rare" };
  let itemIdx = null, itemIdxSrc = null;
  function itemIndex() {
    const tbl = CBZ.econ && CBZ.econ.ITEMS;
    if (!tbl) return null;
    if (itemIdx && itemIdxSrc === tbl) return itemIdx;
    itemIdxSrc = tbl; itemIdx = Object.create(null);
    for (const k in tbl) itemIdx[k.toUpperCase()] = { name: k, rarity: (tbl[k] && tbl[k].rarity) || "common" };
    return itemIdx;
  }
  function itemShout(t) {
    const s = String(t == null ? "" : t).trim();
    if (s.length < 3 || s.length > 26 || s.charAt(s.length - 1) !== "!") return null;
    const shout = s.slice(0, -1).trim();
    if (!shout || /[—,;:]/.test(shout)) return null;
    const idx = itemIndex();
    const hit = (idx && idx[shout.toUpperCase()]) || null;
    if (hit) return hit;
    const extra = EXTRA_PICKUPS[shout.toUpperCase()];
    return extra ? { name: shout.charAt(0) + shout.slice(1).toLowerCase(), rarity: extra } : null;
  }
  const TOAST_ALARM_RE = /\b(?:LOCKDOWN|STRIKE|CUFFED|BACK TO|BUSTED|ALARM|MANHUNT|INCOMING|BRACE|SWEPT|NUKE|POWER OUT|REINFORCEMENTS)\b/i;

  function flashToast(t) {
    if (spoken(t)) return;
    const it = itemShout(t);
    if (it) {
      pickupNote(it.name, { rare: it.rarity === "rare" || it.rarity === "epic", note: it.rarity === "common" ? "" : it.rarity });
      return;
    }
    if (routeCityText(t, "news", "City Desk")) {
      if (el.toast) { el.toast.classList.remove("pop", "toast-alarm"); el.toast.textContent = ""; }
      return;
    }
    // THE PRISON HAS NO BANNER. A toast there is the same one small line as
    // a hint, through the same policy, in sentence case.
    if (prison()) {
      const raw = String(t == null ? "" : t).trim();
      const cased = raw === raw.toUpperCase()
        ? raw.toLowerCase().replace(/(^|[.!?]\s+|[—–]\s*)([a-z])/g, function (m, p, c) { return p + c.toUpperCase(); })
        : raw;
      const s = admit(cased, "toast");
      if (!s) return;
      paintHint(s);
      _hintT = 2.2;
      return;
    }
    if (!el.toast) return;
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

  // The text "Stash" strip is gone (2026-09-28): the hotbar is the whole
  // inventory (systems/inventory.js). Callers still poke this after every
  // trade, so it stays as a seam that draws nothing.
  function refreshInventory() {}


  /* CBZ.prisonHudAudit() — the live numbers behind the bare prison.
     panelsVisible counts the always-on HUD panels that are actually painted
     right now (display/visibility/opacity), so a CSS regression shows up as
     a number rather than a screenshot. */
  const PANEL_IDS = ["topright", "timer", "cigs", "keycard", "inventory", "detectWrap", "gangHud",
    "compass", "minimap", "simHud", "runStats", "pickupFeed", "crateChip", "streakHud", "streakMeter",
    "waypointGuide", "escapePlan", "weaponStrip", "ammo", "hitfx", "toast"];
  function painted(e) {
    if (!e || !e.isConnected) return false;
    const cs = getComputedStyle(e);
    if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity < 0.05) return false;
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (ps.display === "none" || +ps.opacity < 0.05) return false;
    }
    const r = e.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }
  CBZ.prisonHudAudit = function () {
    const visible = [];
    for (let i = 0; i < PANEL_IDS.length; i++) if (painted(document.getElementById(PANEL_IDS[i]))) visible.push(PANEL_IDS[i]);
    const nar = CBZ.aiNarrationAudit ? CBZ.aiNarrationAudit() : null;
    const say = CBZ.prisonSayAudit ? CBZ.prisonSayAudit() : null;
    const plan = CBZ.escapePlan && CBZ.escapePlan.isOpen ? CBZ.escapePlan.isOpen() : false;
    return {
      bare: !!(document.body && document.body.classList.contains("prison-bare")),
      toastsShown: audit.toastsShown, toastsDropped: audit.toastsDropped,
      hintsShown: audit.hintsShown, hintsDropped: audit.hintsDropped,
      pickupsDropped: audit.pickupsDropped,
      narDropped: nar ? Math.max(0, (nar.dropped || 0) - (nar.spoken || 0)) : null,
      speechShown: say ? say.said : null, speechLive: say ? say.live : null,
      panelsVisible: visible.length, panels: visible,
      planOpen: !!plan,
    };
  };

  CBZ.el = el;
  CBZ.setObjective = setObjective;
  CBZ.objectiveText = function () { return objective; };
  CBZ.showHint = showHint;
  CBZ.hideHint = hideHint;
  CBZ.flashHint = flashHint;
  CBZ.flashToast = flashToast;
  CBZ.pickupNote = pickupNote;
  CBZ.fmtTime = fmtTime;
  CBZ.refreshInventory = refreshInventory;
  CBZ.hudLineText = trimLine;   // the one line-shortener (interact.js speech uses it)
})();

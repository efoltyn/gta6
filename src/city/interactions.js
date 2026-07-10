/* ============================================================
   city/interactions.js — THE INTERACTION REGISTRY (the keystone).

   The owner's doctrine: the only controls are movement, shoot, jump,
   inventory, map — and ONE context-sensitive interaction system. No
   dedicated special keys. Everything you can do to a ped / car /
   counter / door is an OPTION RECORD registered here; walk up (or aim)
   and the panel shows exactly what each key will do BEFORE you press it.

   WHY a registry instead of key checks scattered across files:
     • New systems (cuffs, grapple, jobs — next wave) REGISTER options
       instead of adding keydown listeners, so verbs never collide and
       the player always sees them in the one panel.
     • Option gates take a ctx describing the ACTING player (role, items,
       gun drawn) — never window globals — so the same registry serves a
       net player later without rework.

   The pieces:
     • OPTION RECORDS — { id, label|fn(t,ctx), slot "e|i|j|k|l", prio,
       bad, hold, distance, needsGunDrawn, needsItem, role,
       canShow(t,ctx), onSelect(t,ctx) }. canShow is the load-bearing
       dynamic gate, re-evaluated against LIVE target state every refresh.
     • LAYERS — options live on a layer ("ped", "ped:cop", "ped:vendor",
       "corpse", "vehicle", "self"); a candidate carries the layers that
       apply to it ("ped:cop" peds also match plain "ped"), plus
       per-entity options (registerFor) and zone options (registerZone).
     • SLOT EXCLUSIVITY — per key slot the highest-prio passing option
       wins. That's how branch menus (your soldier vs a stranger) stay
       mutually exclusive WITHOUT every gate re-checking its siblings.
     • TAP vs HOLD — one key can carry a tap verb AND a hold verb
       (tap E = get in the car, hold E = drag the driver out).
     • TARGETING — facing-weighted proximity scoring (the camera ray in
       this engine IS the yaw cone) with HYSTERESIS: the current target
       keeps the panel unless a rival scores meaningfully better, so the
       card never flickers between two close peds.
     • GUNPOINT MODE — aim a drawn gun at someone and the panel flips to
       the needsGunDrawn options only (the hostage demands).

   interact.js registers every street verb into this; vehicles.js's old
   F binding is gone — cars surface here like everything else.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;

  const REACH = 3.8;          // baseline interaction reach (same as the old system)
  const HOLD_T = 0.38;        // seconds a key is down before the HOLD verb fires
  const HYSTERESIS = 0.75;    // a rival candidate must beat the current one by this
  const KEYS = ["e", "i", "j", "k", "l"];   // E = primary, IJKL = the established slots

  // ---- storage -------------------------------------------------------------
  const layers = Object.create(null);   // layer name -> [option, ...]
  const sources = [];                    // candidate finders (peds, cars, zones…)
  const zones = [];                      // point+radius interaction spots
  const descs = Object.create(null);     // kind -> fn(t,ctx) -> {label, note}
  let seq = 0;
  let dirty = false;                     // force a panel rebuild next pass

  function prep(o) {
    if (!o.id) o.id = "opt" + (++seq);
    if (o.prio == null) o.prio = 0;
    return o;
  }
  function register(layer, opt) {
    prep(opt); opt.layer = layer;
    (layers[layer] || (layers[layer] = [])).push(opt);
    dirty = true;
    return opt.id;
  }
  // entity-specific options ride on the entity itself (cheap, GC-safe: dies with it)
  function registerFor(entity, opt) {
    if (!entity) return null;
    prep(opt);
    (entity._iopts || (entity._iopts = [])).push(opt);
    dirty = true;
    return opt.id;
  }
  // a ZONE is an interaction spot with no entity (a counter, a rope, a door):
  // { id, kind, find(px,pz,ctx)->target|null, radius?, options:[...], prio? }
  // find returns the thing the options act on (or a truthy token); position for
  // scoring comes from target.pos / target.x,z when present.
  function registerZone(z) {
    prep(z);
    if (z.options) z.options.forEach(prep);
    zones.push(z);
    dirty = true;
    return z.id;
  }
  // a SOURCE feeds candidates: { id, kind, layers:[...], prio, gunpoint?, find(px,pz,ctx,push) }
  // push(target, dist, extra) — extra may carry {layers, kind, zone} overrides.
  function registerSource(s) { prep(s); sources.push(s); return s.id; }
  function describe(kind, fn) { descs[kind] = fn; }
  function unregister(id) {
    for (const k in layers) { const a = layers[k], i = a.findIndex((o) => o.id === id); if (i >= 0) { a.splice(i, 1); dirty = true; return true; } }
    let i = zones.findIndex((z) => z.id === id); if (i >= 0) { zones.splice(i, 1); dirty = true; return true; }
    i = sources.findIndex((s) => s.id === id); if (i >= 0) { sources.splice(i, 1); dirty = true; return true; }
    return false;
  }

  // ---- ctx: the ACTING player, packaged. Gates read THIS, never globals -----
  // (multiplayer-shaped: a net layer can hand a remote player's ctx in later)
  function buildCtx() {
    const P = CBZ.player;
    const it = CBZ.cityCurrentWeapon && CBZ.cityCurrentWeapon();
    // A gun is only "drawn" if it's actually a FIREARM the player is holding —
    // not melee and NOT holstered. cityCurrentWeapon() ignores the holster flag,
    // so we gate on cityHasGun() (the single source of truth: not melee, not
    // holstered, a real equipped gun). Without this, holstering to FISTS still
    // read as gunDrawn — surfacing the "src-gunpoint" target and throwing meek
    // peds' hands up the moment you APPROACHED them unarmed.
    const drawn = !!(it && it.gun) && !!(CBZ.cityHasGun && CBZ.cityHasGun());
    return {
      actor: P, pos: P.pos, driving: !!P.driving, vehicle: P._vehicle || null,
      gun: drawn ? it : null, gunDrawn: drawn,
      items: g.cityInv || {}, role: g.career || "", wanted: g.wanted | 0,
      cash: g.cash | 0, local: true,
    };
  }
  function hasItem(ctx, need) {
    if (typeof need === "function") return !!need(ctx);
    return ((ctx.items && ctx.items[need]) | 0) > 0;
  }

  // The authored hitman campaign owns progression while it is active. Keep the
  // physical interaction fabric (vehicles, aircraft, doors, loot, counters,
  // food, etc.) live, but do not let a hidden legacy prompt silently start a
  // second job/fight/activity or a free-roam pedestrian branch underneath the
  // current contract. Explicit campaignSafe/campaignBlocked flags give future
  // registrations a feature-detected override without coupling them here.
  const CAMPAIGN_ACTIVITY_ID = /(^|[-_])(activity|arena|bet|bout|boxing|career|challenge|club|crew|fare|fight|gala|gig|heist|job|mma|paintball|payroll|prospect|race|racer|raceway|recruit|speedway)([-_]|$)/i;
  const CAMPAIGN_ACTIVITY_VENDOR = {
    bar: 1, gym: 1, security: 1, casino: 1, raceway: 1,
    arena: 1, paintball: 1, cityhall: 1, airfield: 1, racepark: 1,
  };
  function campaignOwnsMission() {
    try { return !!(CBZ.cityCampaignOwnsMission && CBZ.cityCampaignOwnsMission()); }
    catch (e) { return false; }
  }
  function campaignAllows(o, t, cand) {
    if (!campaignOwnsMission()) return true;
    if (o.campaignSafe === true) return true;
    if (o.campaignBlocked === true) return false;

    const ls = (cand && cand.layers) || [];
    const vendor = ls.indexOf("ped:vendor") >= 0;
    // All ordinary city-ped/city-cop branches are free-roam side content. A
    // future authored character verb can opt back in with campaignSafe:true.
    if (!vendor && (ls.indexOf("ped") >= 0 || ls.indexOf("ped:civ") >= 0 || ls.indexOf("ped:cop") >= 0)) return false;

    const id = String(o.id || "");
    if (id === "vendor-shop") {
      const kind = t && t.vendor && t.vendor.kind;
      if (kind && CAMPAIGN_ACTIVITY_VENDOR[kind]) return false;
    }
    if (id === "rs-turn-in") return false;
    return !CAMPAIGN_ACTIVITY_ID.test(id);
  }

  // ---- option gating ---------------------------------------------------------
  // gunpoint=true → ONLY needsGunDrawn options (the demands replace street verbs)
  function passes(o, t, ctx, gunpoint, d, cand) {
    if (!campaignAllows(o, t, cand)) return false;
    if (gunpoint !== !!o.needsGunDrawn) return false;
    if (o.needsGunDrawn && !ctx.gunDrawn) return false;
    if (o.role && ctx.role !== o.role) return false;
    if (o.needsItem && !hasItem(ctx, o.needsItem)) return false;
    if (o.distance != null && d != null && d > o.distance) return false;
    if (o.canShow && !o.canShow(t, ctx)) return false;
    return true;
  }
  function labelOf(o, t, ctx) { return typeof o.label === "function" ? o.label(t, ctx) : o.label; }

  // resolve the visible rows for a candidate: slot winners + tap/hold pairs.
  // Returns [{key, hold, label, bad, opt}, ...] or null when nothing applies.
  function resolveRows(cand, ctx) {
    const t = cand.t, gp = !!cand.gunpoint;
    let pool = [];
    for (const ln of cand.layers) { const a = layers[ln]; if (a) pool = pool.concat(a); }
    if (t && t._iopts) pool = pool.concat(t._iopts);
    if (cand.zone && cand.zone.options) pool = pool.concat(cand.zone.options);
    const pass = [];
    for (const o of pool) if (passes(o, t, ctx, gp, cand.d, cand)) pass.push(o);
    if (!pass.length) return null;
    // slot winners: per (slot, tap/hold) keep the highest prio
    const win = Object.create(null);      // "e0"/"e1"… -> option
    const free = [];                       // unslotted, placed afterwards by prio
    for (const o of pass) {
      if (!o.slot) { free.push(o); continue; }
      const k = o.slot + (o.hold ? 1 : 0);
      if (!win[k] || o.prio > win[k].prio) win[k] = o;
    }
    free.sort((a, b) => b.prio - a.prio);
    const rows = [];
    const usedTap = Object.create(null);
    for (const key of KEYS) {
      if (win[key + 0]) { rows.push(row(win[key + 0], key)); usedTap[key] = true; }
      if (win[key + 1]) rows.push(row(win[key + 1], key));
    }
    for (const o of free) {       // pour leftovers into untaken tap slots, in key order
      const key = KEYS.find((k) => !usedTap[k]);
      if (!key) break;
      usedTap[key] = true; rows.push(row(o, key));
    }
    // keep E first, then I J K L, hold after tap on the same key
    rows.sort((a, b) => KEYS.indexOf(a.key) - KEYS.indexOf(b.key) || (a.hold ? 1 : 0) - (b.hold ? 1 : 0));
    return rows.length ? rows : null;
    function row(o, key) { return { key, hold: !!o.hold, label: labelOf(o, t, ctx), bad: !!o.bad, opt: o }; }
  }

  // ---- the shared panel (same DOM + look as the jail card — keep it) ---------
  let panel, nameEl, noteEl, optsEl;
  let current = null;          // the live candidate {t, kind, layers, ...}
  let currentRows = [];
  let currentScore = -1;
  let fingerprint = "";
  let detAcc = 0;

  function dom() {
    if (panel) return;
    panel = document.getElementById("interact");
    nameEl = document.getElementById("interactName");
    noteEl = document.getElementById("interactNote");
    optsEl = document.getElementById("interactOpts");
    // tap/click rows (mobile + mouse) — a click always fires, hold rows included
    if (optsEl) optsEl.addEventListener("click", function (e) {
      if (g.mode !== "city") return;
      const rowEl = e.target.closest && e.target.closest(".iopt");
      if (!rowEl || rowEl.dataset.i == null) return;
      const r = currentRows[+rowEl.dataset.i];
      if (r && current) fire(r);
    });
  }
  // NOTE: #interact's base style is opacity:0; only `.show` lifts it to 1.
  function hidePanel() { dom(); if (panel) { panel.style.display = "none"; panel.classList.remove("show"); } current = null; currentRows = []; fingerprint = ""; currentScore = -1; }
  function showPanel() { dom(); if (panel) { panel.style.display = "block"; panel.classList.add("show"); } }
  function releasePanel() { dom(); if (panel) { panel.style.display = ""; panel.classList.remove("show"); } current = null; currentRows = []; fingerprint = ""; currentScore = -1; }

  function fire(r) {
    if (!r || !r.opt || !current) return;
    const ctx = buildCtx();
    // Re-check ownership at dispatch too. This closes the sub-100ms window in
    // which a row resolved before a campaign/state change could otherwise fire
    // from the cached panel or a held key.
    if (!campaignAllows(r.opt, current.t, current)) { dirty = true; return; }
    r.opt.onSelect(current.t, ctx);
    dirty = true;              // verbs change state → re-resolve next pass
  }

  // ---- targeting --------------------------------------------------------------
  function scoreOf(c, fx, fz, px, pz) {
    let s = (c.base || 0) + (REACH - Math.min(REACH, c.d)) * 0.6;
    const t = c.t;
    const tx = t && t.pos ? t.pos.x : (t && t.x != null ? t.x : null);
    const tz = t && t.pos ? t.pos.z : (t && t.z != null ? t.z : null);
    if (tx != null && c.d > 0.3) {
      const dx = tx - px, dz = tz - pz, d = Math.hypot(dx, dz) || 1;
      s += Math.max(0, (dx / d) * fx + (dz / d) * fz) * 1.5;   // looking at it = priority
    }
    if (c.gunpoint) s += 100;   // a drawn gun on someone overrides everything
    return s;
  }
  function sameTarget(a, b) { return a && b && a.t === b.t && !!a.gunpoint === !!b.gunpoint; }

  const cands = [];   // reused each pass (zero-alloc steady state)
  CBZ.onUpdate(39, function (dt) {
    if (g.mode !== "city") { if (current || (panel && panel.style.display)) releasePanel(); return; }
    if (g.state !== "playing" || CBZ.cityMenuOpen || CBZ.player.dead) { if (current) hidePanel(); holdKey = ""; return; }
    pumpHold(dt);
    detAcc += dt; if (detAcc < 1 / 12) return; detAcc = 0;   // ~12 Hz is plenty for a prompt
    const ctx = buildCtx();
    const px = ctx.pos.x, pz = ctx.pos.z;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);

    // gather candidates
    cands.length = 0;
    const push = (src) => (t, d, extra) => {
      if (!t) return;
      cands.push({
        t, d: d == null ? 0 : d, kind: (extra && extra.kind) || src.kind,
        layers: (extra && extra.layers) || src.layers || [], base: src.prio || 0,
        gunpoint: !!src.gunpoint, zone: (extra && extra.zone) || null, src,
      });
    };
    for (const s of sources) {
      if (s.driving !== undefined && !!s.driving !== ctx.driving) continue;
      s.find(px, pz, ctx, push(s));
    }
    for (const z of zones) {
      if (z.driving !== undefined && !!z.driving !== ctx.driving) continue;
      const t = z.find(px, pz, ctx);
      if (!t) continue;
      const tx = t.pos ? t.pos.x : (t.x != null ? t.x : px), tz = t.pos ? t.pos.z : (t.z != null ? t.z : pz);
      const d = Math.hypot(px - tx, pz - tz);
      if (z.radius != null && d > z.radius) continue;
      cands.push({ t, d, kind: z.kind || "zone", layers: z.layers || [], base: z.prio || 0, gunpoint: false, zone: z, src: z });
    }

    if (!cands.length) { if (current) hidePanel(); return; }

    // score + sort; HYSTERESIS keeps the current target unless clearly beaten
    for (const c of cands) c.score = scoreOf(c, fx, fz, px, pz);
    cands.sort((a, b) => b.score - a.score);
    let pick = null, rows = null;
    const cur = current && cands.find((c) => sameTarget(c, current));
    for (const c of cands) {
      if (cur && c !== cur && c.score < cur.score + HYSTERESIS) {
        const r = resolveRows(cur, ctx);
        if (r) { pick = cur; rows = r; break; }
      }
      const r = resolveRows(c, ctx);
      if (r) { pick = c; rows = r; break; }
    }
    if (!pick) { if (current) hidePanel(); return; }

    // whoever the panel is offering interactions on turns to LOOK at you
    const t = pick.t;
    if (t && t.group && !t.dead && (t.kind || t.vendor)) t._faceT = 0.45;
    // hands-up ONLY under a genuinely DRAWN firearm (ctx.gunDrawn already gates
    // on cityHasGun: not melee, not holstered, a real gun) — never on an unarmed
    // / holstered approach, even if some gunpoint-flagged source slips through.
    if (pick.gunpoint && ctx.gunDrawn && CBZ.cityMarkGunpoint) CBZ.cityMarkGunpoint(t, 0.55);

    const desc = (descs[pick.kind] && descs[pick.kind](t, ctx)) || { label: "—", note: "" };
    // fingerprint = target + the resolved rows; rebuild DOM only on a real change
    let fp = pick.kind + ":" + (pick.gunpoint ? "G" : "") + (t && t.name || "") + "|";
    for (const r of rows) fp += r.key + (r.hold ? "H" : "") + r.label + (r.bad ? "!" : "") + ";";
    current = pick; currentRows = rows; currentScore = pick.score;
    dom();
    if (noteEl) noteEl.textContent = desc.note;    // the note refreshes every pass
    if (fp !== fingerprint || dirty) {
      fingerprint = fp; dirty = false;
      if (nameEl) nameEl.textContent = desc.label;
      // same row style as the jail panel: a key chip + a clean line; hold verbs
      // say so on the chip; malicious options tint red.
      if (optsEl) optsEl.innerHTML = rows.map((r, i) =>
        `<div class="iopt" data-i="${i}"><span class="ikey">${r.hold ? "HOLD " : ""}${r.key.toUpperCase()}</span>` +
        `<span class="ilab"${r.bad ? " style=\"color:#ff9a9a\"" : ""}>${r.label}</span></div>`
      ).join("");
      showPanel();
    }
  });

  // ---- keys: E + IJKL. A key with a hold verb arms a timer; the hold fires the
  //      moment the threshold passes (no release needed), a quick release fires
  //      the tap. A key with only a tap fires instantly on keydown (snappy). ----
  let holdKey = "", holdT = 0, holdFired = false;
  function rowsFor(key) {
    let tap = null, hold = null;
    for (const r of currentRows) if (r.key === key) { if (r.hold) hold = r; else tap = r; }
    return { tap, hold };
  }
  function pumpHold(dt) {
    if (!holdKey || holdFired) return;
    holdT += dt;
    if (holdT >= HOLD_T) {
      const { hold } = rowsFor(holdKey);
      holdFired = true;
      if (hold) fire(hold);
    }
  }
  addEventListener("keydown", function (e) {
    if (g.mode !== "city" || g.state !== "playing") return;
    if (CBZ.cityMenuOpen || CBZ.player.dead) return;
    const k = e.key.toLowerCase();
    if (KEYS.indexOf(k) < 0 || !current || !currentRows.length) return;
    if (e.repeat) { if (k === holdKey) e.preventDefault(); return; }
    const { tap, hold } = rowsFor(k);
    if (!tap && !hold) return;
    e.preventDefault();
    if (hold) { holdKey = k; holdT = 0; holdFired = false; }   // arm; tap decided on keyup
    else fire(tap);
  });
  addEventListener("keyup", function (e) {
    const k = e.key.toLowerCase();
    if (k !== holdKey) return;
    const wasFired = holdFired;
    holdKey = ""; holdT = 0; holdFired = false;
    if (wasFired || g.mode !== "city" || g.state !== "playing" || CBZ.cityMenuOpen) return;
    const { tap } = rowsFor(k);
    if (tap) fire(tap);   // released before the threshold → the tap verb
  });

  // Is a live prompt currently offering an action on a given key slot? The
  // panel only shows rows the player can actually fire RIGHT NOW (current
  // candidate + resolved currentRows), so this answers "would pressing <key>
  // run a world interaction this instant?". charpanel.js consults this so the
  // [I] inventory key DEFERS to a live "i" interaction (take-clothes, mug,
  // rob-stash, surrender…) instead of double-firing alongside it.
  function hasSlot(key) {
    if (!current || !currentRows || !currentRows.length) return false;
    if (g.mode !== "city" || g.state !== "playing" || CBZ.cityMenuOpen || (CBZ.player && CBZ.player.dead)) return false;
    key = String(key || "").toLowerCase();
    for (const r of currentRows) if (r.key === key) return true;
    return false;
  }

  // ---- public API ---------------------------------------------------------------
  CBZ.interactions = {
    REACH,
    register, registerFor, registerZone, registerSource, describe, unregister,
    ctx: buildCtx,
    current: function () { return current ? { target: current.t, kind: current.kind, gunpoint: !!current.gunpoint } : null; },
    hasSlot: hasSlot,
    refresh: function () { dirty = true; },
    hide: hidePanel,
  };
  // tiny standalone query for cross-module use (charpanel's [I] guard)
  CBZ.cityInteractHasSlot = hasSlot;
  CBZ.cityInteractActive = function () { return !!(current && currentRows && currentRows.length); };
})();

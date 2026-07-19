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

  // OWNER DIRECTION: a RIDE never gets a popup. "AIRLINER — HIJACKABLE / Board
  // the cabin? / YES / NO" is noise — the player already knows pressing E (or
  // tapping it) takes it. These single-action vehicle/aircraft kinds are boarded
  // by cityTryNearestRide (the E router) and by touch tap, both independent of
  // this card, so we simply never SHOW it for them. Peds/vendors/animals keep
  // their genuine choice menus. Flip CITY_RIDE_SILENT=false to restore the card.
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.CITY_RIDE_SILENT == null) CBZ.CONFIG.CITY_RIDE_SILENT = true;
  const SILENT_RIDE = { vehicle: 1, "vehicle:inside": 1, milvehicle: 1 };
  // THE ONE RIDE EXCEPTION (owner spec): a parked CIVIL AIRLINER genuinely
  // offers two verbs — walk-in cabin boarding (island_airport.js
  // "airliner_board") and the hijack/fly-it theft (militaryvehicles.js
  // "milveh-take"), both riding the same "milvehicle" candidate. That single
  // case keeps a card, but it is a VERB card: exactly two rows, BOARD and
  // HIJACK — never YES/NO, never a "Board the cabin?" question line, never a
  // "— HIJACKABLE" name suffix. Every single-verb ride (cars, helis, fighters,
  // private jets) stays fully silent: press E / tap it and you take it.
  // Flip CITY_AIRLINER_DUAL_CARD=false to fold the airliner back into the
  // silent set (E hijacks via the router, walk-in boarding unoffered — the
  // exact pre-card behaviour).
  if (CBZ.CONFIG.CITY_AIRLINER_DUAL_CARD == null) CBZ.CONFIG.CITY_AIRLINER_DUAL_CARD = true;

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

  // ---- social weight: does this person consider the player worth hearing? ---
  // Level is the loudest signal (a Lv.1 nobody cannot walk up to a Lv.80 boss
  // and issue meaningful requests), but an existing relationship and permanent
  // named-identity history can earn a hearing.  This is one shared read so the
  // prompt, the dossier and future dialogue all agree about who matters.
  function interactionStanding(t) {
    const pl = CBZ.cityPlayerLevel ? CBZ.cityPlayerLevel() : 1;
    const tl = CBZ.cityLevel ? CBZ.cityLevel(t) : 1;
    const r = t && (t.relPlayer || (CBZ.cityRel && CBZ.cityRel(t)));
    let score = 50 + (pl - tl) * 2.25;
    if (r) score += (r.respect || 0) * 0.28 + (r.loyalty || 0) * 0.22 +
      (r.affection || 0) * 0.10 + (r.fear || 0) * 0.06 - (r.grudge || 0) * 0.25;
    let ident = null;
    if (t && t._identityId && CBZ.cityIdentities && CBZ.cityIdentities.get) ident = CBZ.cityIdentities.get(t._identityId);
    if (ident && ident.history) score += Math.min(12, ident.history.length * 2);
    score = Math.max(0, Math.min(100, Math.round(score)));
    const gap = tl - pl;
    let tier = "commands attention";
    if (score < 15) tier = "ignored";
    else if (score < 32) tier = "unlikely to listen";
    else if (score < 55) tier = "heard";
    else if (score < 75) tier = "matters";
    return { playerLevel: pl, targetLevel: tl, gap, score, tier, canInfluence: score >= 25 || (r && (r.loyalty >= 55 || r.affection >= 65)) };
  }
  CBZ.cityInteractionStanding = interactionStanding;

  // Only consensual/social asks are standing-gated.  Getting in a vehicle,
  // buying an item, surrendering, arresting, looting or committing violence is
  // a physical action and must never become impossible because of a level gap.
  const SOCIAL_ID = /(talk|chat|flirt|propose|recruit|hire|directions|compliment|fan|favor|prospect|claim-crew|patch-in|payroll|promote|roll|lead|smoke|alibi|license|range|meet|ask)/i;
  function isHuman(t) { return !!(t && !t.animal && (t.kind === "cop" || t.kind === "security" || t.char || t.vendor || t.relPlayer)); }
  function standingGates(o, t) { return isHuman(t) && !o.bad && SOCIAL_ID.test(String(o.id || "") + " " + String(o.label || "")); }
  function rememberChoice(t, verb, yes) {
    if (!t || !t._identityId || !CBZ.cityIdentities || !CBZ.cityIdentities.get) return;
    const rec = CBZ.cityIdentities.get(t._identityId);
    if (!rec || !Array.isArray(rec.history)) return;
    rec.history.push({ t: yes ? "interaction-yes" : "interaction-no", at: Date.now ? Date.now() : 0, verb: String(verb || "") });
    // Identity history is durable, not an unbounded telemetry log.
    if (rec.history.length > 40) rec.history.splice(0, rec.history.length - 40);
  }

  // Resolve ONE context proposal.  Every interaction in the city now has the
  // same grammar: E = YES, I = NO.  Authored registries may still contribute
  // many possible verbs; priority/context chooses the one that makes sense now
  // instead of dumping a five-key action list on the player.
  function resolveRows(cand, ctx) {
    const t = cand.t, gp = !!cand.gunpoint;
    let pool = [];
    for (const ln of cand.layers) { const a = layers[ln]; if (a) pool = pool.concat(a); }
    if (t && t._iopts) pool = pool.concat(t._iopts);
    if (cand.zone && cand.zone.options) pool = pool.concat(cand.zone.options);
    const pass = [];
    for (const o of pool) if (passes(o, t, ctx, gp, cand.d, cand)) pass.push(o);
    if (!pass.length) return null;
    function choiceScore(o, i) {
      let s = (o.prio || 0) * 10 - i * 0.001;
      if (o.slot === "e") s += 18;                 // authored primary remains primary
      if (!gp && o.bad) s -= 240;                   // conversation before random assault
      if (gp) {
        if (o.id === "gp-rob") s += 500;           // least-destructive demand first
        if (/execute|kill/i.test(o.id || "")) s -= 500;
      }
      return s;
    }
    let chosen = pass[0], best = choiceScore(chosen, 0);
    for (let i = 1; i < pass.length; i++) {
      const s = choiceScore(pass[i], i);
      if (s > best) { best = s; chosen = pass[i]; }
    }
    const proposal = String(labelOf(chosen, t, ctx) || "Continue").replace(/[?.!]+$/, "");
    const standing = standingGates(chosen, t) ? interactionStanding(t) : null;
    const rows = [
      { key: "e", hold: false, label: "YES", bad: false, opt: chosen, decision: "yes", proposal, standing },
      { key: "i", hold: false, label: "NO", bad: false, opt: chosen, decision: "no", proposal, standing },
    ];
    rows._pass = pass;   // the full gated pool — the airliner verb card picks from it
    return rows;
  }

  // A civil airliner with a live walk-in cabin is the one ride with TWO verbs.
  // Rebuild the card rows from the candidate's already-gated option pool:
  //   [E] BOARD  — island_airport.js "airliner_board" (door slides, step in)
  //   [I] HIJACK — militaryvehicles.js "milveh-take" (fly it; loud, 4★)
  // Both rows are decision:"yes" — fire() runs each option's own onSelect, so
  // the two existing trigger paths are reused verbatim. Returns null when the
  // target isn't a civil airliner or the cabin verb isn't live right now
  // (inside/pending/taken) — the ride then stays silent like every other.
  function dualRideRows(pick, rows) {
    if (CBZ.CONFIG.CITY_AIRLINER_DUAL_CARD === false) return null;
    const t = pick.t, pass = rows && rows._pass;
    if (!pass || pick.kind !== "milvehicle" || !t || !t.civilian || t.flightKind !== "airliner") return null;
    let board = null, take = null;
    for (const o of pass) {
      if (o.id === "airliner_board") board = o;
      else if (o.id === "milveh-take") take = o;
    }
    if (!board || !take) return null;
    const out = [
      { key: "e", hold: false, label: "BOARD", bad: false, opt: board, decision: "yes", proposal: "Board", standing: null },
      { key: "i", hold: false, label: "HIJACK", bad: true, opt: take, decision: "yes", proposal: "Hijack", standing: null },
    ];
    out.dualRide = true;   // render as a verb card; E-router yields to the E row
    return out;
  }

  // ---- the shared panel (same DOM + look as the jail card — keep it) ---------
  let panel, nameEl, noteEl, optsEl;
  let current = null;          // the live candidate {t, kind, layers, ...}
  let currentRows = [];
  let currentScore = -1;
  let fingerprint = "";
  let detAcc = 0;
  let dismissedTarget = null, dismissT = 0;

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
  // The verb a touch pill wears: the proposal text itself, uppercased, cut at
  // a word boundary when a long authored line would burst the card.
  function verbText(r) {
    let v = String(r.proposal || r.label || "Continue").trim();
    if (v.length > 40) {
      v = v.slice(0, 39);
      const sp = v.lastIndexOf(" ");
      if (sp > 18) v = v.slice(0, sp);
      v += "…";
    }
    return v.toUpperCase();
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
    const t = current.t, verb = r.proposal || labelOf(r.opt, t, ctx);
    if (r.decision === "no") {
      rememberChoice(t, verb, false);
      if (isHuman(t) && CBZ.cityRelShift) CBZ.cityRelShift(t, current.gunpoint ? "spared" : "snubbed", current.gunpoint ? 0.35 : 0.12);
      if (r.opt.onDecline) r.opt.onDecline(t, ctx);
      dismissedTarget = t; dismissT = 1.35;
      hidePanel();
      dirty = true;
      return;
    }
    const standing = standingGates(r.opt, t) ? interactionStanding(t) : null;
    // Force / violence / deal-taking options always land (punch is separate;
    // tribute/tax/handouts are economic, not "please listen to my speech").
    const forceYes = !!(r.opt && (r.opt.bad || r.opt.forceYes || /street-offer|gp-|mug|rob|shake|pick/i.test(String(r.opt.id || ""))));
    if (standing && !standing.canInfluence && !forceYes) {
      rememberChoice(t, verb, true);
      if (CBZ.cityRelShift) CBZ.cityRelShift(t, "snubbed", 0.35);
      if (CBZ.city && CBZ.city.note) CBZ.city.note((t.name || "They") + " ignores you · Lv." + standing.playerLevel + " vs Lv." + standing.targetLevel, 2.0);
      dismissedTarget = t; dismissT = 2.2;
      hidePanel(); dirty = true;
      return;
    }
    rememberChoice(t, verb, true);
    if (standing && CBZ.cityRelShift && /talk|chat|compliment|meet|directions/i.test(String(r.opt.id || ""))) CBZ.cityRelShift(t, "greeted", 0.4);
    r.opt.onSelect(t, ctx);
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
    if (dismissT > 0) { dismissT -= dt; if (dismissT <= 0) dismissedTarget = null; }
    pumpHold(dt);
    detAcc += dt; if (detAcc < 1 / 12) return; detAcc = 0;   // ~12 Hz is plenty for a prompt
    const ctx = buildCtx();
    const px = ctx.pos.x, pz = ctx.pos.z;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);

    // gather candidates
    cands.length = 0;
    const push = (src) => (t, d, extra) => {
      if (!t) return;
      if (dismissT > 0 && t === dismissedTarget) return;
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

    // RIDES: no card. You just press E / tap to take it (cityTryNearestRide and
    // touch-tap both fire the board verb without this panel). Keeps the HUD from
    // announcing "you may now board" like a tutorial. Sole exception: the civil
    // airliner's two-verb BOARD/HIJACK card (dualRideRows above).
    if (SILENT_RIDE[pick.kind] && CBZ.CONFIG.CITY_RIDE_SILENT !== false) {
      rows = dualRideRows(pick, rows);
      if (!rows) { if (current) hidePanel(); return; }
    }

    // whoever the panel is offering interactions on turns to LOOK at you
    const t = pick.t;
    if (t && t.group && !t.dead && (t.kind || t.vendor)) t._faceT = 0.45;
    // hands-up ONLY under a genuinely DRAWN firearm (ctx.gunDrawn already gates
    // on cityHasGun: not melee, not holstered, a real gun) — never on an unarmed
    // / holstered approach, even if some gunpoint-flagged source slips through.
    if (pick.gunpoint && ctx.gunDrawn && CBZ.cityMarkGunpoint) CBZ.cityMarkGunpoint(t, 0.55);

    const desc = (descs[pick.kind] && descs[pick.kind](t, ctx)) || { label: "—", note: "" };
    // fingerprint = target + the resolved rows; rebuild DOM only on a real change
    let fp = pick.kind + ":" + (pick.gunpoint ? "G" : "") + (t && t.name || "") + "|" +
      (rows[0] && rows[0].proposal || "") + ":" + (rows[0] && rows[0].standing ? rows[0].standing.score : "") + "|";
    for (const r of rows) fp += r.key + (r.hold ? "H" : "") + r.label + (r.bad ? "!" : "") + ";";
    current = pick; currentRows = rows; currentScore = pick.score;
    dom();
    if (noteEl) {
      // Just the proposition. The old "· Lv.6→3 · heard" stat suffix was HUD
      // clutter that read like a debug overlay; level now floats over the head
      // (aim_dossier), and the standing still gates the verb underneath.
      // A verb card (airliner BOARD/HIJACK) carries NO question line at all —
      // the rows ARE the proposition. Same on TOUCH (owner: the card read
      // "Zip tie them?" with a ZIP TIE pill right under it — say it ONCE):
      // verb pills carry the proposal themselves, so the question line only
      // exists for the keyboard's YES/NO rows.
      const touchVerbsNote = CBZ.touchMode && (!CBZ.CONFIG || CBZ.CONFIG.TOUCH_VERB_PROMPTS !== false);
      noteEl.textContent = (rows.dualRide || touchVerbsNote) ? "" : (rows[0].proposal || "Continue") + "?";
      noteEl.style.display = (rows.dualRide || touchVerbsNote) ? "none" : "";
    }
    if (fp !== fingerprint || dirty) {
      fingerprint = fp; dirty = false;
      // The verb card drops describe()'s "— HIJACKABLE" advertisement suffix:
      // the HIJACK row already says it, and the suffix broke the fourth wall.
      if (nameEl) nameEl.textContent = rows.dualRide
        ? String(desc.label || "").replace(/\s*—\s*HIJACKABLE\s*$/i, "")
        : desc.label;
      // Exactly two decisions everywhere.  The proposition lives in the note;
      // these rows never mutate into a hidden action wheel.
      // TOUCH (TOUCH_VERB_PROMPTS): no keyboard letters — the YES row becomes
      // ONE big pill carrying the VERB ITSELF ("HIJACK THE AIRLINER"), the NO
      // row a small dismiss pill. Same .iopt/data-i contract, so the existing
      // click dispatch above fires them; targeting/verb logic is untouched.
      const touchVerbs = CBZ.touchMode && (!CBZ.CONFIG || CBZ.CONFIG.TOUCH_VERB_PROMPTS !== false);
      if (optsEl) optsEl.innerHTML = touchVerbs
        ? rows.map((r, i) => {
            const yes = r.decision !== "no";
            return `<div class="iopt tverb ${yes ? "tyes" : "tno"}" data-i="${i}">` +
              `<span class="ilab"${r.bad ? " style=\"color:#ff9a9a\"" : ""}>${yes ? verbText(r) : "NO"}</span></div>`;
          }).join("")
        : rows.map((r, i) =>
          `<div class="iopt" data-i="${i}"><span class="ikey">${r.key.toUpperCase()}</span>` +
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
    // E/Y is the physical "use this ride" button. Do this before consulting
    // the prompt candidate: a pedestrian standing beside an aircraft used to
    // steal the interaction and could even cuff them while the player was
    // plainly trying to board the plane. The router also owns vehicle exits.
    // EXCEPTION: while the airliner's BOARD/HIJACK verb card is live, its E
    // row (BOARD, the innocent walk-in) must win — the router would hijack.
    // The card only exists on foot beside a parked civil airliner, so no exit
    // or other-ride press can be shadowed by this yield.
    if (k === "e" && !(currentRows && currentRows.dualRide) &&
        CBZ.cityTryNearestRide && CBZ.cityTryNearestRide()) {
      e.preventDefault();
      holdKey = ""; holdT = 0; holdFired = false;
      return;
    }
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
    current: function () { return current ? { target: current.t, kind: current.kind, gunpoint: !!current.gunpoint, proposal: currentRows[0] && currentRows[0].proposal } : null; },
    hasSlot: hasSlot,
    refresh: function () { dirty = true; },
    hide: hidePanel,
  };
  // tiny standalone query for cross-module use (charpanel's [I] guard)
  CBZ.cityInteractHasSlot = hasSlot;
  CBZ.cityInteractActive = function () { return !!(current && currentRows && currentRows.length); };
})();

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
     • THE KEY MAP (owner 2026-09-29: "E does too many things... it's very
       stupid"). One key, one meaning, like GTA and RDR:
         E       the ONE obvious verb on the thing you are LOOKING at
         hold E  that thing's heavier verb, only where one is authored
                 (option `hold:true`, e.g. feed-and-tame a horse)
         F       get in / get out. Every option flagged `ride:true` (a car,
                 a horse, a plane, the state car) and the ride router; the
                 way out of any seat is systems/seat_exit.js's, also on F
         Q       the wheel: EVERYTHING you can do to this thing, laid round
                 it (city/verbwheel.js). Orders about a third person start
                 there (an option with `pick:"person"`).
       Touch collapses all four into "tap the thing" (systems/touch.js).
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

  CBZ.CONFIG = CBZ.CONFIG || {};
  /* ---- INTERACT_REACH_V2 — DISCOVERABILITY -------------------------------
     OWNER: "SHOW INTERACTION OPTION POPUPS MORE OFTEN."

     The card was rare for two separate, unrelated reasons, and only one of
     them was the distance.

     (1) THE REACH. 3.8 m is the ONE number the whole fabric hangs off — it is
     not local to this file. `interact.js:27` and `roleverbs.js:65` both read
     `I.REACH` at load and hand it to every source they own: the ped scan, the
     nearest car, the stash, the bin, the mailbox, the seat, the bed, the
     wanted poster, the street object. So a person is 1.9 m of body plus arms
     from their own centre and the anchor of a counter or a hydrant sits inside
     its collider — 3.8 m centre-to-centre is barely past touching distance,
     and the card only ever appeared when you had already walked THROUGH the
     thing. 5.2 m is a stride and a half of standoff and it moves every one of
     those sources in one assignment, because they all read this constant.

     (2) THE CONE, which is the more interesting half. See `scoreOf` below —
     a facing test is the right way to disambiguate PEOPLE, who walk into your
     view, and the wrong way to pick a PLACE, which cannot.

     Flag default ON; set CBZ.CONFIG.INTERACT_REACH_V2 = false for the exact
     previous behaviour (3.8 m, hard cone), which is a one-line revert of both
     halves at once. Nothing downstream needs telling either way: they read
     CBZ.interactions.REACH. */
  if (CBZ.CONFIG.INTERACT_REACH_V2 == null) CBZ.CONFIG.INTERACT_REACH_V2 = true;
  const REACH_V2 = CBZ.CONFIG.INTERACT_REACH_V2 !== false;
  const REACH = REACH_V2 ? 5.2 : 3.8;   // baseline interaction reach, shared by every source
  const HOLD_T = 0.38;        // seconds a key is down before the HOLD verb fires
  const HYSTERESIS = 0.9;     // a rival candidate must beat the current one by this (~5 degrees of look)
  // How much of the facing bonus a STATIONARY candidate (a zone) is granted
  // without having to be looked at. See scoreOf. 0 = the old hard cone.
  const ZONE_CONE_FLOOR = REACH_V2 ? 0.5 : 0;

  // RIDES AND SEATS SHOW NO CARD. A car, a plane, a tank: the verb is F and
  // it is pinned on the door (city/boarding.js), so a card would only say it a
  // second time. A chair: E sits, and on touch the chair itself is the button.
  // The candidate stays LIVE either way, so E / F / Q still reach it.
  const SILENT_RIDE = { vehicle: 1, "vehicle:inside": 1, milvehicle: 1 };

  /* ---- THE PILOT OWNS THE KEYBOARD (CBZ.CONFIG.FLIGHT_KEYS_OWNED) ---------
     OWNER, verbatim: "e doesnt work to turn planes because it jumps out."
     At the controls of an aircraft Q/E are the rudder (playeraircraft.js) and
     F is the one exit (systems/seat_exit.js). So in a cockpit the interact
     fabric stands DOWN ENTIRELY: no detection pass, no card, no wheel, no
     touch verbs. Nothing can shadow a flight control and nothing ADVERTISES a
     key the pilot must not press. Ground vehicles are untouched: the gate is
     the aircraft handle itself, not ctx.driving. */
  function pilotingAircraft() {
    if (CBZ.CONFIG.FLIGHT_KEYS_OWNED === false) return false;
    const P = CBZ.player;
    return !!(P && P._aircraft);
  }

  const layers = Object.create(null);   // layer name -> [option, ...]
  const sources = [];                    // candidate finders (peds, cars, zones…)
  const zones = [];                      // point+radius interaction spots
  const descs = Object.create(null);     // kind -> fn(t,ctx) -> {label, note}
  const verbCards = [];                  // multi-verb card providers (see below)
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
  // is an option with this id registered on any layer? An AUDIT probe (the
  // dialogue ratchet's legacy-talk census reads this instead of guessing at
  // registrations from file contents) — never a gameplay gate.
  function hasOption(id) {
    for (const k in layers) { const a = layers[k]; for (let i = 0; i < a.length; i++) if (a[i].id === id) return true; }
    return false;
  }
  // A VERB-CARD PROVIDER: fn(pick, rows, ctx) may return REPLACEMENT rows
  // built from the same gated pool (rows._pass), e.g. city/dialogue.js's two
  // answers. Only rows keyed "e" or "f" stay keys; any other row (a second
  // answer) is moved into the Q wheel, first in line. First provider wins.
  function registerVerbCard(fn) { if (typeof fn === "function") verbCards.push(fn); return verbCards.length; }

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
      // hands behind the back (CBZ.arrest.playerCuffed): only a cuffOk option
      // (the booking desk you are walked to) survives the gate below
      cuffed: !!(CBZ.cuffedPlayer && CBZ.cuffedPlayer.on()),
    };
  }
  function hasItem(ctx, need) {
    if (typeof need === "function") return !!need(ctx);
    return ((ctx.items && ctx.items[need]) | 0) > 0;
  }

  /* ---- GATHER: every source and zone, asked about ONE point --------------
     The detection pass asks about the player's feet. A TAP asks the same
     finders about points along the finger's ray (tapPick below), so anything
     that can be reached with E can be reached with a finger, from across the
     room, with no second registry. `far` = a tap scan: gunpoint sources (an
     aimed gun is not a tap) and your own car are left out. */
  function gatherAt(qx, qz, ctx, out, far) {
    const push = (src) => (t, d, extra) => {
      if (!t) return;
      if (dismissT > 0 && t === dismissedTarget) return;
      out.push({
        t, d: d == null ? 0 : d, kind: (extra && extra.kind) || src.kind,
        layers: (extra && extra.layers) || src.layers || [], base: src.prio || 0,
        gunpoint: !!src.gunpoint, zone: (extra && extra.zone) || null, src, qx, qz,
      });
    };
    for (const s of sources) {
      if (s.driving !== undefined && !!s.driving !== ctx.driving) continue;
      if (far && (s.gunpoint || s.kind === "vehicle:inside")) continue;
      try { s.find(qx, qz, ctx, push(s)); } catch (e) { if (!far) throw e; }
    }
    for (const z of zones) {
      if (z.driving !== undefined && !!z.driving !== ctx.driving) continue;
      let t = null;
      try { t = z.find(qx, qz, ctx); } catch (e) { if (!far) throw e; }
      if (!t) continue;
      const tx = t.pos ? t.pos.x : (t.x != null ? t.x : qx), tz = t.pos ? t.pos.z : (t.z != null ? t.z : qz);
      const d = Math.hypot(qx - tx, qz - tz);
      if (z.radius != null && d > z.radius) continue;
      out.push({ t, d, kind: z.kind || "zone", layers: z.layers || [], base: z.prio || 0, gunpoint: false, zone: z, src: z, qx, qz });
    }
  }

  /* ---- AIMED: the keyboard's look gate, in one place ----------------------
     A wall of guns, a row of display cases, three bank windows: on a keyboard
     you choose one by LOOKING at it, so a fixture only offers itself inside
     a cone. A finger chooses by touching it, so on touch (and for a tap scan)
     the cone is off and every fixture in reach is a candidate. */
  function aimed(ctx, x, z, minDot) {
    if (ctx && ctx.tap) return true;
    if (CBZ.touchMode) return true;
    const P = (ctx && ctx.pos) || (CBZ.player && CBZ.player.pos);
    if (!P) return false;
    const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return true;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0;
    return (dx / d) * -Math.sin(yaw) + (dz / d) * -Math.cos(yaw) >= (minDot == null ? 0.55 : minDot);
  }

  /* ---- FIXTURES: the things in a room you choose between -----------------
     The store counters (the gun wall, the racks, the cases, the bank windows,
     the pawn desks, the shelves) each used to run a PRIVATE copy of the same
     loop: a look-pick, a prompt div in the middle of the screen and a
     capture-phase E listener that fought the card for the key. On touch they
     had nothing but that div. They are candidates here now, like a person:
       registerFixtures({ id, kind, prio, list(ctx, qx, qz) -> [fixture] | null,
         reach(f)?, dot(f)?, name(f) -> card title, verbs: [option...] })
     `list` returns the room's fixtures only while the room is live (built,
     the point asked about is inside it); each fixture needs x, z. Verbs are ordinary options
     on the layer `kind`: E is the best one, Q / a tap shows them all. */
  function registerFixtures(spec) {
    const kind = spec.kind || spec.id;
    const reach = spec.reach || function () { return 3; };
    const dot = spec.dot || function () { return 0.55; };
    registerSource({
      id: spec.id, kind: kind, layers: [kind], prio: spec.prio || 8, driving: spec.driving != null ? spec.driving : false,
      find: function (px, pz, ctx, push) {
        const list = spec.list(ctx, px, pz);
        if (!list) return;
        for (let i = 0; i < list.length; i++) {
          const f = list[i];
          if (!f || f.x == null) continue;
          const d = Math.hypot(f.x - px, f.z - pz);
          if (d > reach(f) || !aimed(ctx, f.x, f.z, dot(f))) continue;
          push(f, d);
        }
      },
    });
    for (const o of spec.verbs || []) { if (o.campaignSafe == null) o.campaignSafe = true; register(kind, o); }
    if (spec.name) describe(kind, function (t, ctx) { return { label: spec.name(t, ctx) || "" }; });
    return spec.id;
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
    if (ctx.cuffed && !o.cuffOk) return false;
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
  const SOCIAL_ID = /(recruit|hire|favor|prospect|claim-crew|promote|roll|lead|alibi|license|range|meet|petition|endorse|lobby)/i;
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

  // GRAMMAR LAW (owner): the target's NAME appears exactly ONCE — as the card
  // title. An option label is a BUTTON: a bare verb phrase, never a sentence,
  // never a question, and NEVER the name again ("Zip Marcus's wrists" → "Zip
  // wrists"). This is the SHARED seam: every registered label — street verbs,
  // restrain, packages, aircraft crew — passes through here, so a caller that
  // still interpolates a name is corrected at display time. Possessives drop
  // clean ("Marcus's wrists" → "wrists"); a bare name drops with its orphaned
  // trailing preposition ("Talk to Marcus" → "Talk"), keeping any emoji tail.
  function stripTargetName(text, t) {
    let s = String(text || "");
    const n = t && t.name ? String(t.name).trim() : "";
    if (n) {
      const parts = [n].concat(n.indexOf(" ") >= 0 ? n.split(/\s+/).filter((w) => w.length >= 3) : []);
      for (const w of parts) {
        const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        s = s.replace(new RegExp("\\b" + esc + "['’]s\\s*", "gi"), "");
        s = s.replace(new RegExp("\\s*\\b" + esc + "\\b", "gi"), "");
      }
      s = s.replace(/\s{2,}/g, " ").trim();
      s = s.replace(/\s+(?:to|on|with|of|at|for|from)\s*([^\w\s]*)$/i, (m, tail) => (tail ? " " + tail : ""));
    }
    return s.trim() || String(text || "");
  }

  // Resolve a candidate into its KEY ROWS. OWNER DOCTRINE: a card lists ONLY
  // doable actions; declining is walking away, never a "NO" row. The whole
  // gated pool is sorted once by authored priority and split by KEY:
  //   E tap   the best ordinary verb      (at most one)
  //   E hold  the best `hold:true` verb   (at most one)
  //   F       the best `ride:true` verb   (at most one)
  // Everything else in the pool is still reachable: it is the Q wheel's
  // (rows._pass, in this same order). Nothing is discarded any more; the old
  // one-row funnel threw ~40 registered person verbs away a line before the
  // screen, which is how "talk, then hire" became the only flow there was.
  function isRide(o) { return !!(o && o.ride); }
  function choiceScore(o, i, gp) {
    let s = (o.prio || 0) * 10 - i * 0.001;
    if (o.slot === "e") s += 18;                 // authored primary remains primary
    if (!gp && o.bad) s -= 240;                   // conversation before random assault
    if (gp) {
      if (o.id === "gp-rob") s += 500;           // least-destructive demand first
      if (/execute|kill/i.test(o.id || "")) s -= 500;
    }
    return s;
  }
  function gatedPool(cand, ctx) {
    const t = cand.t, gp = !!cand.gunpoint;
    let pool = [];
    // `_iOnly`: a person who is his job (the President's staff, an agent of
    // the detail) offers only his own verbs, never the street's. An option
    // flagged `anyone` still reaches him: the President's orders about a man
    // (city/orders.js "Take him down") work on literally anyone.
    const only = !!(t && t._iOnly);
    // WHAT A PERSON OFFERS IS WHAT HE IS: city/roles.js's table (role ->
    // verbs). A guard is bribed and robbed of his card, a keeper sells and is
    // robbed, a stranger is punched, mugged, dipped. The street layer's
    // options pass through it; his own per-entity options never do.
    const R = (!only && t && cand.layers.indexOf("ped") >= 0 && CBZ.cityRoles) ? CBZ.cityRoles : null;
    const role = R ? R.roleOf(t) : null;
    for (const ln of cand.layers) {
      const a = layers[ln];
      if (!a) continue;
      if (only) { for (let i = 0; i < a.length; i++) if (a[i].anyone) pool.push(a[i]); }
      else if (R) { for (let i = 0; i < a.length; i++) if (R.allows(role, a[i])) pool.push(a[i]); }
      else pool = pool.concat(a);
    }
    if (t && t._iopts) pool = pool.concat(t._iopts);
    if (cand.zone && cand.zone.options) pool = pool.concat(cand.zone.options);
    const pass = [];
    for (let i = 0; i < pool.length; i++) {
      const o = pool[i];
      if (passes(o, t, ctx, gp, cand.d, cand)) pass.push({ o: o, s: choiceScore(o, i, gp) });
    }
    pass.sort((x, y) => y.s - x.s);
    return pass.map((x) => x.o);
  }
  function proposalOf(o, t, ctx) {
    return stripTargetName(String(labelOf(o, t, ctx) || "Continue").replace(/[?.!]+$/, ""), t);
  }
  function keyRow(key, hold, o, t, ctx) {
    const proposal = proposalOf(o, t, ctx);
    const standing = standingGates(o, t) ? interactionStanding(t) : null;
    return { key: key, hold: hold, label: verbHead(proposal), bad: !!o.bad, opt: o, decision: "yes", proposal: proposal, standing: standing };
  }
  function resolveRows(cand, ctx) {
    const t = cand.t;
    const all = gatedPool(cand, ctx);
    // A `speak` option is not a verb: it is what the person SAYS when you
    // come up to him (approach() below). It never becomes a row.
    let speak = null;
    const pass = [];
    for (let i = 0; i < all.length; i++) { if (all[i].speak) { if (!speak) speak = all[i]; } else pass.push(all[i]); }
    if (!pass.length && !speak) return null;
    let tap = null, hold = null, ride = null;
    for (const o of pass) {
      if (o.pick || o.wheel) continue;      // an order about someone else (or `wheel`) is a wheel verb, never a key
      if (isRide(o)) { if (!ride) ride = o; }
      else if (o.hold) { if (!hold) hold = o; }
      else if (!tap) tap = o;
    }
    const rows = [];
    if (tap) rows.push(keyRow("e", false, tap, t, ctx));
    if (hold) rows.push(keyRow("e", true, hold, t, ctx));
    if (ride) rows.push(keyRow("f", false, ride, t, ctx));
    rows._pass = pass;   // the full gated pool, best first: the Q wheel reads it
    rows._speak = speak; // what he says as you come up (never a row)
    return rows;
  }

  /* ---- HE SPEAKS AS YOU COME UP. THERE IS NO TALK VERB. ------------------
     OWNER (2026-10-09): "You shouldn't have to press Talk. When you press
     someone to see the interaction options, they should talk if they have
     something to say." An option registered with `speak: true` is that
     line: it fires by itself the moment the person becomes the one you are
     looking at (or tap), once per approach. A man with no speak option says
     nothing and shows only his verbs. No repeat chatter: the same man is not
     re-asked until you have looked away, and then not inside his hold
     (option `speakCD` seconds, default 40). What he says is the line; his
     replies are verbs (E / hold E / the wheel, or the campaign card's pinned
     replies on him). */
  let approachT = null;
  function nowS() { return (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now()) / 1000; }
  function approach(cand, rows) {
    const t = cand && cand.t;
    if (!t || cand.gunpoint) { approachT = null; return false; }
    if (t === approachT) return false;           // same approach: he has had his say
    approachT = t;
    const o = rows && rows._speak;
    if (!o || (t._spokeUntil || 0) > nowS()) return false;
    t._spokeUntil = nowS() + (o.speakCD || 40);
    return fireOn(cand, o);
  }

  // ---- the shared panel (same DOM + look as the jail card — keep it) ---------
  let panel, nameEl, noteEl, optsEl;
  let current = null;          // the live candidate {t, kind, layers, ...}
  let currentRows = [];
  let shownRows = [];          // the rows the card actually draws (click index)
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
      const r = shownRows[+rowEl.dataset.i];
      if (r && current) fire(r);
    });
  }
  /* ---- THE WORD ON THE BUTTON (css/city.css "GANG CITY VERBS" styles it) --
     One rule for every surface that prints a verb: the desktop card row, the
     phone pill, the docked iPad button and the touch cluster. The word is
     the VERB only (city/verbword.js CBZ.cityVerbWord): the thing it acts on
     is the noun, and it is right there under your hand (owner, 2026-09-05:
     "sabotage power should just be sabotage"). A price rides along because
     "$40" is what the thumb is deciding on. Case is left as authored
     ("Tell to follow"); CSS never shouts it in capitals. */
  function vw(text) {
    const f = CBZ.cityVerbWord;
    const s = f ? f(text) : String(text || "").split(/\s+[—–-]\s+/)[0].trim();
    return s || "Use";
  }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function verbText(r) { return vw(r.proposal || r.label); }
  function verbHead(text) { return vw(text); }

  /* ---- THE ONE ROW RENDERER --------------------------------------------
     Every #interact card in city mode speaks this grammar (this file's own
     card, dialogue.js's line-plus-verb card, police.js's gun-stop stand-off):
       desktop  [E] Rob            a key chip and the verb, nothing else
       phone    one verb pill per row, thumb-sized
       iPad     the same pill, docked on the right rail
     A hostile verb (bad) wears the warm rim, never red text in a paragraph.
     Row records need { key, proposal } and may carry { label, bad }. */
  function rowsHTML(rows) {
    const touchVerbs = CBZ.touchMode && (!CBZ.CONFIG || CBZ.CONFIG.TOUCH_VERB_PROMPTS !== false);
    const docked = touchVerbs && CBZ.touchInteractionDocked && CBZ.touchInteractionDocked();
    return rows.map((r, i) => {
      const word = esc(verbText(r));
      const bad = r.bad ? " ibad" : "";
      if (!touchVerbs) {
        return `<div class="iopt${bad}" data-i="${i}"><span class="ikey">${esc(String(r.key || "e").toUpperCase())}</span>` +
          `<span class="ilab">${word}</span></div>`;
      }
      if (!docked) return `<div class="iopt tverb tyes${bad}" data-i="${i}"><span class="ilab">${word}</span></div>`;
      return `<div class="iopt tverb tyes${bad}" data-i="${i}">` +
        `<button type="button" class="itouch-act${bad}" aria-label="${word}">${word}</button></div>`;
    }).join("");
  }
  CBZ.cityInteractRowsHTML = rowsHTML;

  /* ---- THE CLUSTER (for the tap-a-person surface) -----------------------
     CBZ.cityVerbCluster(rows, { placed }) -> HTML for the verbs a person or
     thing offers: `.vcluster` holding `.vpill` buttons, the first row (the
     likely one) as `.vpill.lead`, a row with { more: true } as `.vpill.more`.
     With placed:true every pill is absolutely positioned by the caller
     (city/verbwheel.js measures the pills and lays them out through
     systems/touch_layout.js); without it the pills stack in a column.
     Styling lives entirely in css/city.css. */
  CBZ.cityVerbCluster = function (rows, opts) {
    rows = rows || [];
    const placed = !!(opts && opts.placed);
    const pills = rows.map((r, i) => {
      const word = r.more ? "More" : esc(verbText(r));
      const cls = "vpill" + (i === 0 && !r.more ? " lead" : "") + (r.bad ? " bad" : "") + (r.more ? " more" : "");
      const key = r.key ? `<span class="vkey">${esc(String(r.key).toUpperCase())}</span>` : "";
      return `<button type="button" class="${cls}" data-i="${i}" aria-label="${word}">${key}<span class="vword">${word}</span></button>`;
    }).join("");
    return `<div class="vcluster${placed ? " placed" : ""}">${pills}</div>`;
  };

  // NOTE: #interact's base style is opacity:0; only `.show` lifts it to 1.
  function hidePanel() { dom(); if (panel) { panel.style.display = "none"; panel.classList.remove("show"); } current = null; currentRows = []; shownRows = []; fingerprint = ""; currentScore = -1; }
  // the card goes away but the TARGET stays live: E / F / Q still reach it
  function quietPanel(tag) { dom(); if (panel) { panel.style.display = "none"; panel.classList.remove("show"); } shownRows = []; fingerprint = "quiet:" + tag; }
  function showPanel() { dom(); if (panel) { panel.style.display = "block"; panel.classList.add("show"); } }
  function releasePanel() { dom(); if (panel) { panel.style.display = ""; panel.classList.remove("show"); } current = null; currentRows = []; shownRows = []; fingerprint = ""; currentScore = -1; }

  // ONE dispatch for every input: the E / F keys (a row), the Q wheel and a
  // touch tap (an option on a candidate), and an ORDER about a third person
  // (`arg` = the person picked as the target, handed to onSelect's 3rd param).
  function fireOn(cand, opt, arg) {
    if (!cand || !opt || typeof opt.onSelect !== "function") return false;
    const ctx = buildCtx();
    // Re-check ownership at dispatch too. This closes the sub-100ms window in
    // which a row resolved before a campaign/state change could otherwise fire
    // from the cached panel or a held key.
    if (!campaignAllows(opt, cand.t, cand)) { dirty = true; return false; }
    const t = cand.t, verb = labelOf(opt, t, ctx);
    const standing = standingGates(opt, t) ? interactionStanding(t) : null;
    // Force / violence / deal-taking options always land (punch is separate;
    // tribute/tax/handouts are economic, not "please listen to my speech").
    const forceYes = !!(opt.bad || opt.forceYes || opt.speak || /gp-|mug|rob|shake|pick/i.test(String(opt.id || "")));
    if (standing && !standing.canInfluence && !forceYes) {
      rememberChoice(t, verb, true);
      if (CBZ.cityRelShift) CBZ.cityRelShift(t, "snubbed", 0.35);
      dismissedTarget = t; dismissT = 2.2;
      hidePanel(); dirty = true;
      return false;
    }
    rememberChoice(t, verb, true);
    opt.onSelect(t, ctx, arg);
    dirty = true;              // verbs change state → re-resolve next pass
    return true;
  }
  function fire(r) { if (r && r.opt && current) fireOn(current, r.opt); }

  // ---- targeting --------------------------------------------------------------
  // THE CONE IS A TEST FOR PEOPLE, NOT FOR PLACES (INTERACT_REACH_V2).
  // A ped can walk into your view, so which one you MEAN is genuinely ambiguous
  // and the camera ray is how you say it — that is why the facing weight exists
  // and it stays exactly as it was for anything with a body. A ZONE cannot walk
  // anywhere: a counter, a rope, a pump, a fishing spot, a betting window is
  // where it has always been, and you selected it by WALKING TO IT. Scoring it
  // as if it had to earn your gaze meant the shop counter you were standing at
  // silently lost its card the moment you turned your head to look down the
  // aisle — which is a large share of "the popup feels rare".
  // So a zone keeps the cone as a PREFERENCE, not a gate: half the weight is
  // granted for being where you are standing, half is still earned by looking.
  // Facing a zone dead-on still scores exactly what it scored before, so this
  // can only ever ADD cards, never re-order two things you are looking at.
  // LOOKING AT IT WINS (owner: priority when two things are in range is the
  // thing you are looking at). Facing is now the dominant term: a dead-on look
  // is worth 10, the full proximity range 2.6, and an option source's authored
  // `prio` only breaks ties (a vendor at prio 12 used to out-shout a car you
  // were staring at by 5x the whole facing bonus). A zone keeps its floor.
  function faceOf(tx, tz, fx, fz, px, pz) {
    const dx = tx - px, dz = tz - pz, d = Math.hypot(dx, dz);
    if (d < 0.3) return 1;
    return Math.max(0, (dx / d) * fx + (dz / d) * fz);
  }
  function scoreOf(c, fx, fz, px, pz) {
    let s = (c.base || 0) * 0.05 + (REACH - Math.min(REACH, c.d)) * 0.5;
    const t = c.t;
    const tx = t && t.pos ? t.pos.x : (t && t.x != null ? t.x : null);
    const tz = t && t.pos ? t.pos.z : (t && t.z != null ? t.z : null);
    if (tx != null) {
      let face = faceOf(tx, tz, fx, fz, px, pz);
      // A DOOR YOU ARE SQUARELY FACING IS WHAT E MEANS. The Oval Office's
      // job applicants waited by its door, and E on the door hired the man
      // beside it instead of opening it (tools/president-walkout.mjs, desktop:
      // card "Hire" at the door, the President shut in). A zone that says
      // faceWins beats a person when you look straight at it.
      if (c.zone && c.zone.faceWins && face > 0.8) s += 14;
      if (c.zone && ZONE_CONE_FLOOR > 0) face = ZONE_CONE_FLOOR + (1 - ZONE_CONE_FLOOR) * face;
      s += face * 10;
    }
    if (c.gunpoint) s += 100;   // a drawn gun on someone overrides everything
    return s;
  }
  function sameTarget(a, b) { return a && b && a.t === b.t && !!a.gunpoint === !!b.gunpoint; }

  const cands = [];   // reused each pass (zero-alloc steady state)
  let insideCand = null;   // the car you are driving, as a wheel target
  CBZ.onUpdate(39, function (dt) {
    if (g.mode !== "city") { if (current || (panel && panel.style.display)) releasePanel(); return; }
    if (g.state !== "playing" || CBZ.cityMenuOpen || CBZ.player.dead) { if (current) hidePanel(); holdKey = ""; return; }
    // FLIGHT: nothing on the ground is in reach of a cockpit, so the card is
    // both useless and dangerous up here — every row it draws is a key the
    // pilot is flying with. Hiding it is what stops the HUD advertising an [E]
    // the rudder owns, and it takes the touch verb pills (which are these same
    // rows) down with it. See pilotingAircraft() above.
    if (pilotingAircraft()) { if (current) hidePanel(); holdKey = ""; return; }
    if (dismissT > 0) { dismissT -= dt; if (dismissT <= 0) dismissedTarget = null; }
    pumpHold(dt);
    detAcc += dt; if (detAcc < 1 / 12) return; detAcc = 0;   // ~12 Hz is plenty for a prompt
    const ctx = buildCtx();
    const px = ctx.pos.x, pz = ctx.pos.z;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);

    // gather candidates
    cands.length = 0;
    insideCand = null;
    gatherAt(px, pz, ctx, cands, false);

    if (!cands.length) { approachT = null; if (current) hidePanel(); return; }

    // score + sort; HYSTERESIS keeps the current target unless clearly beaten
    for (const c of cands) c.score = scoreOf(c, fx, fz, px, pz);
    cands.sort((a, b) => b.score - a.score);
    let pick = null, rows = null;
    // YOUR OWN CAR is never the E target (you cannot look at it from the seat,
    // and it would shadow the pump you pulled up to). Its verbs - let them out,
    // drop anchor, hand over the helm - are the Q wheel's: wheel() falls back
    // to it while you drive.
    for (const c of cands) if (c.kind === "vehicle:inside") { insideCand = c; break; }
    const cur = current && cands.find((c) => sameTarget(c, current));
    for (const c of cands) {
      if (c.kind === "vehicle:inside") continue;
      if (cur && c !== cur && c.score < cur.score + HYSTERESIS) {
        const r = resolveRows(cur, ctx);
        if (r) { pick = cur; rows = r; break; }
      }
      const r = resolveRows(c, ctx);
      if (r) { pick = c; rows = r; break; }
    }
    if (!pick) { approachT = null; if (current) hidePanel(); return; }

    // he says his piece as you come up (before the providers: a line that
    // opens a conversation turns this very card into its replies)
    approach(pick, rows);

    rows = finishRows(pick, rows, ctx);
    current = pick; currentRows = rows; currentScore = pick.score;
    detectTail(pick, rows, ctx);
  });
  // EXTENDED VERB CARDS + the E/F-only key split, shared by the detection
  // pass and the wheel (so a conversation the tap just opened shows its
  // replies on the wheel at once)
  function finishRows(pick, rows, ctx) {
    // EXTENDED VERB CARDS — the airliner two-verb grammar, opened to other
    // systems through registerVerbCard (city/dialogue.js's two-answer card is
    // the second consumer). Runs BEFORE the silent-ride fold so a provider
    // sees every candidate; providers self-gate on pick.t/kind.
    for (let vi = 0; vi < verbCards.length; vi++) {
      let vr = null;
      try { vr = verbCards[vi](pick, rows, ctx); } catch (e) {}
      if (vr && vr.length) { if (!vr._pass) vr._pass = rows._pass; vr._speak = rows._speak; rows = vr; break; }
    }

    // ONLY E AND F ARE KEYS. A provider row on any other letter (dialogue's
    // second answer) moves into the Q wheel, first in line, never a key.
    let extra = null;
    for (let i = 0; i < rows.length; i++) if (rows[i].key !== "e" && rows[i].key !== "f") { extra = extra || []; extra.push(rows[i]); }
    if (extra) {
      const pass = rows._pass, sp = rows._speak, dual = rows.dualRide;
      rows = rows.filter((r) => r.key === "e" || r.key === "f");
      rows._pass = pass; rows._extra = extra; rows._speak = sp; rows.dualRide = dual;
    }
    return rows;
  }
  function detectTail(pick, rows, ctx) {

    // WHAT THE CARD SHOWS. The target is live either way (E / F / Q reach it);
    // the card is only drawn when it says something the world does not:
    //   • a ride's F is pinned on its door (city/boarding.js) - no card row
    //   • a lone "Sit down" is the chair itself - no card
    //   • a pinned verb that owns E right now (a lift button, a ladder) is the
    //     one E on screen, so the card steps back (cityUseOwner below)
    //   • TOUCH: the world is the button. Tapping the thing opens its wheel
    //     (systems/touch.js -> city/verbwheel.js), so no floating pills.
    // a hold row's chip reads "HOLD E", so the card never shows two bare E's
    const shown = (SILENT_RIDE[pick.kind] ? rows.filter((r) => r.key !== "f") : rows)
      .map((r) => (r.hold ? Object.assign({}, r, { key: "hold " + r.key }) : r));
    const loneSeat = pick.kind === "seat" && rows._pass && rows._pass.length === 1;
    if (!shown.length || loneSeat || CBZ.touchMode || (CBZ.verbWheel && (CBZ.verbWheel.isOpen() || CBZ.verbWheel.ordering())) || useOwner("e") === "pill") {
      quietPanel(pick.kind);
      return;
    }
    shownRows = shown;

    // whoever the panel is offering interactions on turns to LOOK at you
    const t = pick.t;
    if (t && t.group && !t.dead && (t.kind || t.vendor)) t._faceT = 0.45;
    // hands-up ONLY under a genuinely DRAWN firearm (ctx.gunDrawn already gates
    // on cityHasGun: not melee, not holstered, a real gun) — never on an unarmed
    // / holstered approach, even if some gunpoint-flagged source slips through.
    if (pick.gunpoint && ctx.gunDrawn && CBZ.cityMarkGunpoint) CBZ.cityMarkGunpoint(t, 0.55);

    const desc = (descs[pick.kind] && descs[pick.kind](t, ctx)) || { label: "", note: "" };
    // fingerprint = target + the resolved rows; rebuild DOM only on a real change
    let fp = pick.kind + ":" + (pick.gunpoint ? "G" : "") + (t && t.name || "") + "/" + (desc.label || "") + "/" + (desc.role || "") + "|" +
      (rows[0] && rows[0].proposal || "") + ":" + (rows[0] && rows[0].standing ? rows[0].standing.score : "") + "|";
    for (const r of shown) fp += r.key + (r.hold ? "H" : "") + r.label + (r.bad ? "!" : "") + ";";
    dom();
    if (noteEl) {
      // NO LINE ON THE CARD (owner, 2026-08-04 + 2026-09-27). No restated
      // question, and no spoken line either: what a person says floats over his
      // head (CBZ.speech via citySay). The card is buttons only.
      noteEl.textContent = "";
      noteEl.style.display = "none";
    }
    if (fp !== fingerprint || dirty) {
      fingerprint = fp; dirty = false;
      // The verb card drops describe()'s "— HIJACKABLE" advertisement suffix:
      // the HIJACK row already says it, and the suffix broke the fourth wall.
      // The header is WHO or WHAT you are facing: a person's name, then in
      // muted type what he is (desc.role: a gang, "Officer", "Security").
      if (nameEl) {
        nameEl.textContent = rows.dualRide
          ? String(desc.label || "").replace(/\s*, \s*HIJACKABLE\s*$/i, "")
          : (desc.label || "");
        if (desc.role && nameEl.textContent) {
          const rs = document.createElement("span");
          rs.className = "iname-role";
          rs.textContent = String(desc.role);
          nameEl.appendChild(rs);
        }
      }
      // At most E, hold E and F. Everything else is the Q wheel's.
      if (optsEl) optsEl.innerHTML = rowsHTML(shown);
      showPanel();
    }
  }

  /* ---- WHO OWNS E RIGHT NOW: the card, or a verb pinned on a thing --------
     Two surfaces can offer E at once: this card's target (a person, a counter)
     and a BOUND pin from systems/interactions.js (a lift's Call button, a
     ladder, a ransom). The one you are LOOKING at more squarely owns the key;
     the loser is not drawn and does not fire. systems/interactions.js's
     capture-phase binder asks this before it consumes a press. */
  function useOwner(key) {
    key = String(key || "e").toLowerCase();
    if (key === "e" && CBZ.verbWheel && CBZ.verbWheel.ordering()) return "pill";   // "who?": the order's pin owns E
    const pin = CBZ.prisonPromptShownFor ? CBZ.prisonPromptShownFor(key) : null;
    let mine = false;
    for (let i = 0; i < currentRows.length; i++) if (currentRows[i].key === key) { mine = true; break; }
    if (!pin) return mine ? "card" : null;
    if (!mine || !current || !pin.at) return "pill";
    const P = CBZ.player, t = current.t;
    const tx = t && t.pos ? t.pos.x : (t && t.x != null ? t.x : null);
    const tz = t && t.pos ? t.pos.z : (t && t.z != null ? t.z : null);
    if (!P || !P.pos || tx == null) return "pill";
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const fc = faceOf(tx, tz, fx, fz, P.pos.x, P.pos.z);
    const fp = faceOf(pin.at.x, pin.at.z, fx, fz, P.pos.x, P.pos.z);
    return fc > fp + 0.05 ? "card" : "pill";
  }
  CBZ.cityUseOwner = useOwner;

  /* ---- THE KEYS. One key, one meaning (see THE KEY MAP at the top).
     E: tap fires the E verb on keydown; if the target also has a HOLD verb,
     the press arms a timer instead - past HOLD_T the hold verb fires, a quick
     release fires the tap. F: the ride verb of the thing you are looking at,
     else the ride router (the nearest car / plane / hull). Q is the wheel's
     (city/verbwheel.js). I, J, K and L are no longer interaction keys. */
  let holdKey = "", holdT = 0, holdFired = false;
  function rowFor(key, hold) {
    for (const r of currentRows) if (r.key === key && !!r.hold === !!hold) return r;
    return null;
  }
  function pumpHold(dt) {
    if (!holdKey || holdFired) return;
    holdT += dt;
    if (holdT >= HOLD_T) {
      const hold = rowFor(holdKey, true);
      holdFired = true;
      if (hold) fire(hold);
    }
  }
  function cuffed() { return !!(CBZ.cuffedPlayer && CBZ.cuffedPlayer.on()); }
  addEventListener("keydown", function (e) {
    if (g.mode !== "city" || g.state !== "playing") return;
    if (CBZ.cityMenuOpen || CBZ.player.dead) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // a panel that just used this press (shops.js closes on E) spent it
    if (e.defaultPrevented) return;
    // FLIGHT STAND-DOWN — the pilot owns the keyboard. Q/E are the rudder, F
    // is the exit (seat_exit.js). Nothing here may shadow a flight control.
    if (pilotingAircraft()) { holdKey = ""; holdT = 0; holdFired = false; return; }
    const k = String(e.key || "").toLowerCase();
    if (k === "f") {
      if (e.repeat || cuffed()) return;                       // no hands for a door
      if (CBZ.verbWheel && CBZ.verbWheel.isOpen()) return;    // the wheel is modal
      // a mode's own rides first (the President's column and helicopter)
      if (CBZ.cityRideIntercept && CBZ.cityRideIntercept()) { e.preventDefault(); return; }
      const fr = rowFor("f", false);
      if (fr) { e.preventDefault(); fire(fr); return; }
      if (CBZ.cityTryNearestRide && CBZ.cityTryNearestRide()) e.preventDefault();
      return;
    }
    if (k !== "e" || !current || !currentRows.length) return;
    // the wheel is modal, and an order waiting for its "who" owns E (its pin)
    if (CBZ.verbWheel && (CBZ.verbWheel.isOpen() || CBZ.verbWheel.ordering())) return;
    if (e.repeat) { if (k === holdKey) e.preventDefault(); return; }
    const tap = rowFor("e", false), hold = rowFor("e", true);
    if (!tap && !hold) return;
    e.preventDefault();
    if (hold) { holdKey = k; holdT = 0; holdFired = false; }   // arm; tap decided on keyup
    else fire(tap);
  });
  addEventListener("keyup", function (e) {
    const k = String(e.key || "").toLowerCase();
    if (k !== holdKey) return;
    const wasFired = holdFired;
    holdKey = ""; holdT = 0; holdFired = false;
    // ...and never on the release of a key that was armed on the ground and let
    // go in the air (hold E on a horse, [F] into the aircraft beside it, release).
    if (wasFired || g.mode !== "city" || g.state !== "playing" || CBZ.cityMenuOpen || pilotingAircraft()) return;
    const tap = rowFor(k, false);
    if (tap) fire(tap);   // released before the threshold → the tap verb
  });

  // Is a live prompt offering an action on this key right now? charpanel.js
  // and familypanel.js ask before claiming a letter. Only E and F are
  // interaction keys now, so their I / L are always theirs.
  function hasSlot(key) {
    if (!current || !currentRows || !currentRows.length) return false;
    if (g.mode !== "city" || g.state !== "playing" || CBZ.cityMenuOpen || (CBZ.player && CBZ.player.dead)) return false;
    key = String(key || "").toLowerCase();
    for (const r of currentRows) if (r.key === key) return true;
    return false;
  }

  /* ---- THE WHEEL'S FEED (city/verbwheel.js) -------------------------------
     wheelOf(cand) lists EVERYTHING doable to one candidate, best first: a
     provider's extra rows (dialogue's second answer), then the whole gated
     pool. Each item says which key would also fire it, so the wheel can show
     the one-key shortcut beside the verb. */
  function wheelOf(cand) {
    if (!cand) return [];
    const ctx = buildCtx();
    const r0 = resolveRows(cand, ctx);
    const rows = r0 ? finishRows(cand, r0, ctx) : null;
    if (!rows) return [];
    const pass = rows._pass || [];
    const out = [], seen = new Set();
    const keyOf = function (o) {
      for (const r of rows) if (r.opt === o) return r.hold ? "hold e" : r.key;
      return "";
    };
    const add = function (o, label, bad) {
      if (!o || seen.has(o)) return;
      seen.add(o);
      out.push({ opt: o, label: label, bad: !!bad, key: keyOf(o), pick: o.pick || null });
    };
    // what E / hold E / F would do comes first (the obvious verb is the lead,
    // and a provider's answers are not pool options), then everything else
    for (const r of rows) if (r.opt) add(r.opt, r.proposal || r.label, r.bad);
    if (rows._extra) for (const r of rows._extra) add(r.opt, r.proposal || r.label, r.bad);
    for (const o of pass) add(o, proposalOf(o, cand.t, ctx), o.bad);
    return out;
  }
  /* ---- THE ONE TAP PIPELINE (touch) ---------------------------------------
     OWNER (2026-09-29): "in touch you can't interact with enough things ...
     When I touch something, I should see interaction options with it."

     A tap is a question to the SAME registry the keys use. systems/touch.js
     casts the finger's ray (and says which body, if any, it hit: a person, a
     car, an animal); tapPick then
       1. takes every live candidate (what is in reach right now), and
       2. asks every source and zone about points ALONG the finger's ray, so
          a counter across the shop, an ATM across the street or a dog down
          the pavement is found exactly as E would find it standing there,
     projects each one's anchor onto the glass and picks the one under the
     finger: the body the ray hit wins outright, otherwise the nearest anchor
     inside a thumb-sized radius (closer things break ties). The answer says
     whether it is in reach now (live: open its verbs) or not (walk there,
     then open them: touch.js). No module keeps a private tap path. */
  const _pp = window.THREE ? new THREE.Vector3() : null;
  function anchorOf(c) {
    const t = c && c.t;
    if (!t) return null;
    let p = t.pos || (t.group && t.group.position) || (t.x != null ? t : null);
    // a zone that answers with a bare token has no place of its own: it is
    // where it was found (the point it was asked about)
    if (!p && c.qx != null) p = { x: c.qx, y: null, z: c.qz };
    if (!p) return null;
    /* A SMALL THING SAYS WHERE IT IS. The +0.9 below is "a counter / a body's
       middle over the floor it stands on": a target that answers with its own
       floor y. A phone or a folder on a desk answered with ITS height, so its
       anchor floated 0.9 m over the desk, above a seated President's eye
       line, and a finger on the phone itself was never within TAP_RADIUS of
       it (owner on iPad: "you press it and can't interact with it"). A target
       with `ay` (world height of the thing itself) is anchored exactly there;
       `ar` is its rough radius, for the verb column beside it. */
    if (t.ay != null && isFinite(t.ay)) return { x: p.x, y: t.ay, z: p.z, small: t.ar || 0.12 };
    const y = (p.y != null ? p.y : (CBZ.player && CBZ.player.pos ? CBZ.player.pos.y : 0));
    return { x: p.x, y: y + (c.layers && c.layers.indexOf("ped") >= 0 ? 1.2 : 0.9), z: p.z };
  }
  const TAP_RADIUS = 72;          // css px: a thumb, not a cursor
  const TAP_STEPS = [2, 5, 9, 14, 20, 27, 35, 44];   // m along the ground under the finger's ray
  const _tapPool = [], _tapTmp = [];
  function rayPoints(ray, under) {
    const pts = [];
    if (under) pts.push({ x: under.x, z: under.z });
    if (!ray || !ray.origin || !ray.direction) return pts;
    const o = ray.origin, dv = ray.direction, P = CBZ.player && CBZ.player.pos;
    const hz = Math.hypot(dv.x, dv.z);
    if (hz < 1e-4) { pts.push({ x: o.x, z: o.z }); return pts; }
    // the finger's ray stops at the floor you stand on (nothing past it is seen)
    let tMax = Infinity;
    if (P && dv.y < -1e-3) tMax = (P.y + 0.05 - o.y) / dv.y;
    for (const h of TAP_STEPS) {
      const t = h / hz;
      if (t > tMax + 2 / hz) { pts.push({ x: o.x + dv.x * tMax, z: o.z + dv.z * tMax }); break; }
      pts.push({ x: o.x + dv.x * t, z: o.z + dv.z * t });
    }
    return pts;
  }
  function tapPick(sx, sy, o) {
    o = o || {};
    const cam = CBZ.camera, P = CBZ.player;
    if (!cam || !_pp || !P || !P.pos) return null;
    if (g.mode !== "city" || pilotingAircraft()) return null;
    cam.updateMatrixWorld();
    const ctx = buildCtx(); ctx.tap = true;
    const pool = _tapPool; pool.length = 0;
    const seen = new Set();
    const add = function (c, live) {
      if (!c || !c.t || seen.has(c.t)) return;
      // a far token with no place of its own would sit exactly under the
      // finger (it is anchored where it was asked about): only a live one,
      // anchored on you, can be tapped
      if (!live && !(c.t.pos || (c.t.group && c.t.group.position) || c.t.x != null)) return;
      seen.add(c.t); pool.push({ c: c, live: live });
    };
    for (let i = 0; i < cands.length; i++) if (cands[i].kind !== "vehicle:inside") add(cands[i], true);
    const pts = rayPoints(o.ray, o.underPoint);
    for (let k = 0; k < pts.length; k++) {
      _tapTmp.length = 0;
      gatherAt(pts[k].x, pts[k].z, ctx, _tapTmp, true);
      for (let i = 0; i < _tapTmp.length; i++) add(_tapTmp[i], false);
    }
    const w = window.innerWidth || 800, h = window.innerHeight || 600;
    const R = o.radius || TAP_RADIUS;
    let best = null, bs = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const e = pool[i], c = e.c;
      let s;
      if (o.under && c.t === o.under) s = -1000;              // the body under the finger
      else {
        const a = anchorOf(c);
        if (!a) continue;
        _pp.set(a.x, a.y, a.z).project(cam);
        if (_pp.z > 1) continue;
        const x = (_pp.x * 0.5 + 0.5) * w, y = (-_pp.y * 0.5 + 0.5) * h;
        const dpx = Math.hypot(x - sx, y - sy);
        if (dpx > R) continue;
        s = dpx;
      }
      const tp = c.t.pos || (c.t.group && c.t.group.position) || (c.t.x != null ? c.t : { x: c.qx, z: c.qz });
      const dm = Math.hypot(tp.x - P.pos.x, tp.z - P.pos.z);
      s += dm * 0.6;                                          // the nearer of two close pills
      if (s >= bs) continue;
      // it must have something to do (the same gate E reads)
      if (!resolveRows(c, ctx)) continue;
      bs = s; best = { cand: c, live: e.live, dist: dm };
    }
    pool.length = 0;
    return best;
  }
  // the live candidate for a tapped one now that you are there: the same
  // thing, or (a zone's fresh token) the same finder answering at the same spot
  function liveLike(c) {
    if (!c) return null;
    for (let i = 0; i < cands.length; i++) if (cands[i].t === c.t) return cands[i];
    const a = anchorOf(c);
    if (!a) return null;
    for (let i = 0; i < cands.length; i++) {
      const x = cands[i];
      if (x.src !== c.src) continue;
      const b = anchorOf(x);
      if (b && Math.hypot(a.x - b.x, a.z - b.z) < 1.5) return x;
    }
    return null;
  }
  // the live candidate for a known world object (a ped / car / animal record)
  function candidateFor(obj) {
    if (!obj) return null;
    if (current && current.t === obj) return current;
    for (let i = 0; i < cands.length; i++) if (cands[i].t === obj) return cands[i];
    return null;
  }

  // ---- public API ---------------------------------------------------------------
  CBZ.interactions = {
    REACH,
    register, registerFor, registerZone, registerSource, describe, unregister,
    registerVerbCard, hasOption,
    ctx: buildCtx,
    current: function () { return current ? { target: current.t, kind: current.kind, gunpoint: !!current.gunpoint, proposal: currentRows[0] && currentRows[0].proposal } : null; },
    currentCand: function () { return current; },
    // what the Q wheel opens on: the looked-at thing, else (driving) your car
    wheelCand: function () { return current || insideCand; },
    hasSlot: hasSlot,
    wheelOf: wheelOf, fireOn: fireOn,
    // the card title of a candidate (who he is: city/roles.js titles a person)
    titleOf: function (cand) {
      if (!cand || !descs[cand.kind]) return "";
      let d = null; try { d = descs[cand.kind](cand.t, buildCtx()); } catch (e) { d = null; }
      return d ? String(d.label || "").replace(/\s*, \s*HIJACKABLE\s*$/i, "") : "";
    },
    // a tap on a person: he says his piece first (once per approach)
    approach: function (cand) { if (!cand) return false; const r = resolveRows(cand, buildCtx()); return r ? approach(cand, r) : false; }, tapPick: tapPick, liveLike: liveLike, candidateFor: candidateFor, anchorOf: anchorOf,
    registerFixtures: registerFixtures, aimed: aimed,
    useOwner: useOwner,
    rowsFor: function () { return currentRows.map((r) => ({ key: r.key, hold: !!r.hold, id: r.opt && r.opt.id, label: r.label })); },
    refresh: function () { dirty = true; },
    hide: hidePanel,
  };
  // tiny standalone query for cross-module use (charpanel's [I] guard)
  CBZ.cityInteractHasSlot = hasSlot;
  CBZ.cityInteractActive = function () { return !!(current && currentRows && currentRows.length); };

  // ---- ratchet / probe surface --------------------------------------------
  // The owner's ask ("show interaction option popups MORE OFTEN") is a
  // measurable claim, so publish the numbers that decide it rather than
  // leaving them locked in a closure. `candidates` is what the last detection
  // pass actually found in reach — walk up to a shop counter, a parked car, a
  // bench, a hydrant and it should be non-zero well before you are touching
  // the thing; `showing` is whether a card is up right now. `reach` and
  // `coneFloor` prove which side of the flag the build is on.
  CBZ.interactAudit = function () {
    let zoneCands = 0;
    for (let i = 0; i < cands.length; i++) if (cands[i] && cands[i].zone) zoneCands++;
    return {
      v2: REACH_V2, reach: REACH, coneFloor: ZONE_CONE_FLOOR, hysteresis: HYSTERESIS,
      sources: sources.length, zones: zones.length,
      candidates: cands.length, zoneCandidates: zoneCands,
      showing: !!(current && currentRows && currentRows.length),
      kind: current ? current.kind : null,
    };
  };
})();

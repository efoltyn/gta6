/* ===========================================================================
   city/fortresponse.js — A BASE THAT ANSWERS FOR ITSELF.

   OWNER (2026-08-09, verbatim): "Military base in Gang City. Right now, the
   soldiers there are dumb. Dumb. Dumb. … I'd see them run towards fire like a
   real NPC."

   ---------------------------------------------------------------------------
   MEASURED BEFORE (seed 90210, live headless world, 5 stars pinned):

     44 soldiers on Fort Brandt   32 on the parade ground, 2 on the gate,
                                  10 on the patrol ring
     20 machines parked           5 fighters · 1 B-2 · 1 lifter · 4 helis
                                  5 tanks · 4 armoured trucks
     nearest soldier to the city  1332 m   (base centre -1520,-1180;
                                            arena centre 0,-700)

     after 20 s at 5 stars:  9 responders · nearest still 1086 m from the
                             player · 0 on the causeway · 3 grinding against
                             the east wire · one had moved 1.1 m
     after 80 s:             the gunship had flown out, orbited and come home
                             and both fighters were on final approach, and NOT
                             ONE rifleman had left the island.

   THREE FAULTS, ALL OF THEM THE SAME FAULT — nothing on that base was ever
   told anything.

   (1) NOTHING RUNS TOWARD GUNFIRE. `cityAlarm` (peds.js:2527) sets `alarmed`
       and `fear`, which are a jumpiness-and-report gate; `cityPostAlert`
       (garrison.js) widens a sentry's senses by 35%. Neither MOVES anybody.
       The one primitive in the repo that does the right thing — `rallyGang`
       (peds.js:5376): 25 m, up to six bodies, rage + target — is filtered on
       `o.gang !== ped.gang`, and a soldier has an `organization`, not a gang.
       So shooting one man on a parade ground of thirty-two rallied nobody,
       and `sizeup.js`'s own `backupLevels` (also gang-keyed) read him as a man
       standing alone — which could make him FOLD.

   (2) THE BASE DID NOT DEFEND ITS OWN HARDWARE. Stealing a tank forces 3★ and
       a jet 4★ (militaryvehicles.js:434); the garrison's only escalation floor
       is 5★. `cityCrime` never rings `cityAlarm`. You could fly a fighter off
       Fort Brandt and the parade ground kept saluting.

   (3) THE 5-STAR ORDER WAS IMPOSSIBLE TO OBEY. island_military.js handed eight
       riflemen `rage = playerActor` against a target 1.3 km away, and
       `combat_iq.posture` — which is LOCAL tactical positioning and explicitly
       nulls `ped.path` — was the only thing steering them. There is no route
       across the sea, so `clampToCity` held them on the wire and they ground
       against a fence for the whole manhunt. An order nobody can obey is worse
       than no order: it looks exactly like stupidity, because it is.

   ---------------------------------------------------------------------------
   WHAT THIS FILE ADDS, AND WHAT IT REFUSES TO ADD.

   ONE BUS. `CBZ.fortAlert(x, z, opts)` — something happened here. It is rung
   from the two hooks the whole game already funnels through (`cityAlarm` for a
   body dropping / a blast / a robbery, `cityCrime` for the loud-and-military
   lane), by the sanctioned WRAP precedent that wildlife.js and social.js
   already use on those exact two names. No call site in the game is edited to
   make a base hear a gunshot.

   ONE ANSWER. Roused soldiers CONVERGE on the mark using the only steering
   contract peds.js exposes — `target` / `state` / `pause` — and fight through
   `combat_iq.posture` and `cityShapeSquad` when there is somebody to fight.
   Not one line of locomotion or combat is written here.

   AND ONE ORDER IS WITHDRAWN. The 5-star beeline is DELETED, not replaced with
   a better beeline. When the trouble is on the reservation the garrison
   answers it; when the trouble is across a kilometre of sea the garrison
   STANDS TO — weapons out, on the wire and the gate — and the air response
   (aircraft.js, which now makes its crews RUN to the airframes) is what
   actually prosecutes a manhunt in the city. That is the honest shape of what
   this world can currently do, and it is strictly better than men walking into
   a fence for eighty seconds.

   THE NEXT WAVE IS NAMED, NOT IMPLIED: `CBZ.fortAudit().convoy` is `false`
   here. Getting infantry off the island needs a ROAD CONVOY — the causeway is
   already a real road record (island_military.js:2060, in `arena.roads`), and
   police.js:2560-2640 already ships the entire arc: a vehicle spawned at its
   home station, `ai:true` on the lane AI, `destX/destZ` retargeted at 1.2 Hz,
   brake at 28 m, `deploySwatTeam` dismounts. That arc is cop-shaped (makeCop /
   cityCops / forcePool / SWAT_FRAC) and generalising it is a change to
   police.js, which this wave does not own. Declaring the gap beats shipping a
   half-driven truck.

   FLAGS: FORT_RESPONSE (master) · FORT_ALERT (the bus) · FORT_RALLY (an
          organisation rallies like a set) · FORT_STANDTO (the off-island
          posture) · FORT_CONVOY (declared, default OFF, not implemented).
   RATCHET: CBZ.fortAudit().impossibleOrders — soldiers holding a rage target
            they have no route to. PINNED AT 0.
   =========================================================================== */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  if (!CBZ) return;
  const C = (CBZ.CONFIG = CBZ.CONFIG || {});

  // ---- flags, declared in the OWNING file (never config.js) ---------------
  if (C.FORT_RESPONSE == null) C.FORT_RESPONSE = true;
  if (C.FORT_ALERT == null) C.FORT_ALERT = true;
  if (C.FORT_RALLY == null) C.FORT_RALLY = true;
  if (C.FORT_STANDTO == null) C.FORT_STANDTO = true;
  if (C.FORT_CONVOY == null) C.FORT_CONVOY = false;   // declared; see the header
  // A ceiling on bodies this file drives at once. The base has 44 and every one
  // of them converging would be a mob, not a response — and a mob is the thing
  // squadai.js was written to stop shipping.
  if (C.FORT_MAX_RESPOND == null) C.FORT_MAX_RESPOND = 12;

  function on() { return C.FORT_RESPONSE !== false; }
  function alertOn() { return on() && C.FORT_ALERT !== false; }
  function standOn() { return on() && C.FORT_STANDTO !== false; }
  function playing() { return CBZ.game && CBZ.game.mode === "city" && CBZ.game.state === "playing"; }
  function now() {
    return CBZ.now != null ? CBZ.now
      : (typeof performance !== "undefined" ? performance.now() : Date.now());
  }

  const ALERT_HOLD = 26;        // s a site stays roused after the last event
  const ENGAGE_R = 38;          // m at which a converging soldier takes a target
  const CONVERGE_SPREAD = 7;    // m of lateral fan across the arriving line
  const LEASH_PAD = 40;         // m past the wire a responder may be pulled back from

  /* =========================================================================
     §1  THE ROSTER — CBZ.militaryPersonnel().

     THREE ROSTERS THAT HAD NEVER MET. `CBZ.cityMilitaryPersonnel` is
     island_military.js's own 44 bodies and is the ONLY list aircraft.js's
     `militaryPilot` and strategic.js's `sortieCrew` have ever read — so a
     garrison sentry standing at the gate under city/garrison.js, or any other
     body in the world stamped `organization:"military"`, could never be
     aircrew and could never be counted. One question, one answer, and the
     island list stays exactly what it is: a source, not the definition.

     Cached for the frame because the two consumers that matter call it inside
     loops, and `CBZ.now` is stamped once per frame by core/loop.js — the same
     guard garrison.js uses to stop its order tick running twice.
     ========================================================================= */
  let _rosterF = -1, _roster = [];
  CBZ.militaryPersonnel = function () {
    const f = now();
    if (f === _rosterF) return _roster;
    _rosterF = f;
    const out = [];
    const seen = (typeof Set === "function") ? new Set() : null;
    const push = function (p) {
      if (!p || p.dead) return;
      if (seen) { if (seen.has(p)) return; seen.add(p); }
      else if (out.indexOf(p) >= 0) return;
      out.push(p);
    };
    const island = CBZ.cityMilitaryPersonnel || [];
    for (let i = 0; i < island.length; i++) push(island[i]);
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (p && (p.organization === "military" || p.milRank)) push(p);
    }
    _roster = out;
    return out;
  };

  // Is this body one the base may order about? Never a cop (police.js drives
  // its own), never a body somebody else already owns for the frame.
  function ownable(p) {
    if (!p || !p.pos || p.dead || (p.ko || 0) > 0) return false;
    if (p.inCar || p._npcAttached || p._milPilot || p._airPilot) return false;
    if (p.surrender || p.state === "surrender" || (p.surrenderT || 0) > 0 || p._covered) return false;
    if (p.controlled || p.companion || p.recruited || p.vendor || p.staffPost) return false;
    if (CBZ.boardingHolds && CBZ.boardingHolds(p)) return false;
    if (CBZ.body && CBZ.body.busy && CBZ.body.busy(p)) return false;
    // A GARRISON POST IS ALREADY A BRAIN. garrison.js's cityPostTick owns the
    // scare/return/leash/order arc on those bodies every frame; a second brain
    // writing `target` at the same body would fight it, which is the exact bug
    // island_military.js's own loop documents at its `_post` branch.
    if (p._post) return false;
    return true;
  }

  /* =========================================================================
     §2  THE SITES — a place that can be roused.

     Nothing here invents a place. Fort Brandt publishes its own bounds and
     anchors (`CBZ._militaryBase`, island_military.js:2088 — the gate it
     fenced, the barracks it named), and govcomplex.js publishes the Defence
     Headquarters rect. If the world built neither, there is no site and this
     file does nothing at all.
     ========================================================================= */
  const SITES = [];
  let sitesArena = null;

  function buildSites() {
    SITES.length = 0;
    const B = CBZ._militaryBase;
    if (B && B.center && B.minX != null) {
      SITES.push({
        id: "fort-brandt", name: "Fort Brandt",
        x: B.center.x, z: B.center.z,
        minX: B.minX, maxX: B.maxX, minZ: B.minZ, maxZ: B.maxZ,
        gate: B.gate || { x: B.minX, z: B.center.z },
        wire: wireRing(B),
        level: 0, t: 0, mark: null, by: null, rings: 0, roused: 0, peak: 0,
      });
    }
    const gc = CBZ.govComplexes;
    if (gc && gc.length) {
      for (let i = 0; i < gc.length; i++) {
        const s = gc[i];
        if (!s || !s.def || s.def.id !== "defence" || !s.rect) continue;
        SITES.push({
          id: "defence-hq", name: "Defence Headquarters",
          x: s.cx, z: s.cz,
          minX: s.rect.minX, maxX: s.rect.maxX, minZ: s.rect.minZ, maxZ: s.rect.maxZ,
          gate: s.gate || { x: s.cx, z: s.rect.minZ },
          wire: wireRing({ center: { x: s.cx, z: s.cz }, minX: s.rect.minX, maxX: s.rect.maxX, minZ: s.rect.minZ, maxZ: s.rect.maxZ }),
          level: 0, t: 0, mark: null, by: null, rings: 0, roused: 0, peak: 0,
        });
        break;
      }
    }
    return SITES.length;
  }

  // THE STAND-TO LINE. Eight slots facing out — the four corners of the wire
  // and the four side midpoints — inset so a man stands ON his own ground and
  // not in the fence. These are the positions the roster takes when the
  // trouble is somewhere it cannot walk to.
  function wireRing(B) {
    const inset = 18;
    const x0 = B.minX + inset, x1 = B.maxX - inset;
    const z0 = B.minZ + inset, z1 = B.maxZ - inset;
    const cx = B.center.x, cz = B.center.z;
    const pts = [
      { x: x0, z: z0 }, { x: x1, z: z0 }, { x: x0, z: z1 }, { x: x1, z: z1 },
      { x: (x0 + x1) / 2, z: z0 }, { x: (x0 + x1) / 2, z: z1 },
      { x: x0, z: (z0 + z1) / 2 }, { x: x1, z: (z0 + z1) / 2 },
    ];
    for (let i = 0; i < pts.length; i++) pts[i].face = Math.atan2(pts[i].x - cx, pts[i].z - cz);
    return pts;
  }

  function siteHit(s, x, z, pad) {
    pad = pad || 0;
    return x >= s.minX - pad && x <= s.maxX + pad && z >= s.minZ - pad && z <= s.maxZ + pad;
  }
  function siteAt(x, z, pad) {
    for (let i = 0; i < SITES.length; i++) if (siteHit(SITES[i], x, z, pad == null ? 90 : pad)) return SITES[i];
    return null;
  }
  CBZ.fortSites = function () { return SITES; };

  /* =========================================================================
     §3  THE BUS — CBZ.fortAlert(x, z, opts).

     A NOTICE WITH A PLACE ON IT, which is the one thing cityAlarm never
     carried far enough to be. `opts.by` is the offender if anybody knows who
     it was; `opts.level` is how loud (a robbery 0.6, a gunshot 1, a blast 1.8)
     and only raises, never lowers, a live alert.

     Returns the site it rang, or null — so a caller can tell the difference
     between "nowhere near a base" and "the base heard you".
     ========================================================================= */
  CBZ.fortAlert = function (x, z, opts) {
    if (!alertOn() || !isFinite(x) || !isFinite(z)) return null;
    const s = siteAt(x, z, 110);
    if (!s) return null;
    opts = opts || {};
    const lv = opts.level != null ? +opts.level : 1;
    s.level = Math.max(s.level, lv);
    s.t = Math.max(s.t, ALERT_HOLD * Math.min(2, Math.max(0.5, lv)));
    s.mark = { x: x, z: z };
    s.rings++;
    // WHO, only when we actually know. An explosion has no author standing in
    // it; handing the garrison a target it did not see is the same lie as the
    // impossible order this file deleted.
    if (opts.by && opts.by.pos && !opts.by.dead) s.by = opts.by;
    // AND THE POSTS HEAR IT TOO. garrison.js owns the sentries; ringing its
    // bus from here means the wire and the converging body get the same notice
    // from the same event instead of discovering it three seconds apart.
    if (CBZ.cityPostAlert) { try { CBZ.cityPostAlert(x, z, 120, opts.by || null); } catch (e) {} }
    return s;
  };

  /* =========================================================================
     §4  THE HOOKS — two wraps, no call sites edited.

     `cityAlarm` and `cityCrime` are the two names every loud thing in this
     game already goes through, and both are already wrapped elsewhere by
     files that needed the same thing (wildlife.js:3141 and wildnature.js:978
     on cityAlarm; social.js:1462 on cityCrime, with its own `_relWrapped`
     latch). This is that precedent, with the same latch so a double-load or a
     wildlife wrap installed later can never stack us twice.
     ========================================================================= */
  const LOUD = {
    "shots-fired": 1.2, "grand-theft-military": 1.6, "aircraft-hijacking": 1.6,
    "murder": 1.4, "cop-killing": 1.4, "trespass": 0.5,
  };
  // ONCE PER NAME, EVER — and tracked HERE, not on the function.
  //
  // Two bugs are being avoided at the same time and they pull in opposite
  // directions. (1) The two names are assigned by DIFFERENT files (peds.js owns
  // cityAlarm, wanted.js owns cityCrime), so a single `hooked` early-return
  // would leave the second one permanently unwrapped whenever only the first
  // existed at parse — hence a per-name latch and no early exit. (2) Reading
  // that latch off the FUNCTION is not enough either: social.js wraps cityCrime
  // too, from inside an init call rather than at parse, and its wrapper carries
  // its own `_relWrapped` and not ours — so a function-only test would see an
  // "unwrapped" cityCrime and wrap a second time, ringing the base twice for
  // one crime. Every wrap in this repo delegates to the one it replaced, so
  // once we are anywhere in that chain our hook fires; installing again is
  // never the fix.
  let wroteAlarm = false, wroteCrime = false, hooked = false;
  function installHooks() {
    if (!alertOn()) return;
    if (!wroteAlarm && typeof CBZ.cityAlarm === "function" && !CBZ.cityAlarm._fortWrapped) {
      const prev = CBZ.cityAlarm;
      const wrap = function (x, z, radius, intensity, offender) {
        try { CBZ.fortAlert(x, z, { level: 0.7 + (intensity || 1) * 0.5, by: offender }); } catch (e) {}
        return prev.apply(this, arguments);
      };
      wrap._fortWrapped = true; wrap._fortOrig = prev;
      CBZ.cityAlarm = wrap; wroteAlarm = true;
    }
    if (!wroteCrime && typeof CBZ.cityCrime === "function" && !CBZ.cityCrime._fortWrapped) {
      const prevC = CBZ.cityCrime;
      const wrapC = function (amount, opts) {
        try {
          const o = opts || {};
          const lv = LOUD[o.type];
          if (lv) {
            const P = CBZ.player;
            const x = o.x != null ? o.x : (P && P.pos ? P.pos.x : null);
            const z = o.z != null ? o.z : (P && P.pos ? P.pos.z : null);
            // THE OFFENDER IS THE PLAYER. cityCrime is the PLAYER's crime bus —
            // an NPC's offence goes through cityNpcOffense — so the body the
            // base is looking for is the one the city is charging.
            if (x != null) CBZ.fortAlert(x, z, { level: lv, by: CBZ.city && CBZ.city.playerActor });
          }
        } catch (e) {}
        return prevC.apply(this, arguments);
      };
      wrapC._fortWrapped = true; wrapC._fortOrig = prevC;
      CBZ.cityCrime = wrapC; wroteCrime = true;
    }
    hooked = wroteAlarm && wroteCrime;
  }

  /* =========================================================================
     §5  THE ANSWER — converge, or stand to.

     Runs at 38.72: after island_military.js's own troop tick (38.7) so the
     transform we write is the one that survives the frame, and after peds.js's
     think/move (34) so we are steering a body that has already been walked.
     ========================================================================= */
  const STATS = { converged: 0, engaged: 0, stoodTo: 0, impossible: 0, alerts: 0, released: 0 };

  function distXZ(a, x, z) { const dx = a.pos.x - x, dz = a.pos.z - z; return Math.sqrt(dx * dx + dz * dz); }

  function releaseBody(p) {
    if (!p || !p._fortResp) return;
    p._fortResp = null;
    if (p.dead) return;
    p.rage = null; p.targetActor = null;
    p.path = null; p.finalGoal = null;
    // Hand him back to whoever had him. island_military.js's own tick yields
    // to us while `_fortResp` is set and reclaims a `_stationed` body the frame
    // after we drop it (walking him to his parade anchor); anybody else just
    // rejoins the ordinary crowd. Either way we leave him WALKING, never
    // frozen mid-order.
    p.state = "walk";
    p.pause = 0;
    p.activityState = null;
    STATS.released++;
  }

  // The mark, fanned so an arriving section is a line and not a stack.
  function convergePoint(s, i, n) {
    const m = s.mark || { x: s.x, z: s.z };
    if (n <= 1) return { x: m.x, z: m.z };
    const dx = m.x - s.x, dz = m.z - s.z;
    const d = Math.hypot(dx, dz) || 1;
    const lx = -dz / d, lz = dx / d;                    // perpendicular to the approach
    const t = (i / (n - 1) - 0.5) * 2;                  // -1..1
    return { x: m.x + lx * t * CONVERGE_SPREAD, z: m.z + lz * t * CONVERGE_SPREAD };
  }

  function tickSite(s, dt) {
    const roster = CBZ.militaryPersonnel();
    const P = CBZ.player;
    const playerOnSite = !!(P && P.pos && siteHit(s, P.pos.x, P.pos.z, 60));
    const stars = (CBZ.game && CBZ.game.wanted) | 0;

    // THE MARK CAN WALK. If we know who it was and he is still on our ground,
    // the alert follows him — otherwise it stays where the noise was, which is
    // what a section sweeping a report actually does.
    if (s.by && !s.by.dead && s.by.pos && siteHit(s, s.by.pos.x, s.by.pos.z, 120)) {
      s.mark = { x: s.by.pos.x, z: s.by.pos.z };
      s.t = Math.max(s.t, 6);
    } else if (s.by && (s.by.dead || !s.by.pos || !siteHit(s, s.by.pos.x, s.by.pos.z, 220))) {
      s.by = null;                                       // dead, gone, or a body with no position left
    }

    // A WANTED MAN STANDING ON A DEFENCE RESERVATION *IS* THE ALARM.
    //
    // Two things depend on this and both were broken before it. (a) The base
    // could not defend its own hardware: stealing a tank forces 3 stars and a
    // jet 4 (militaryvehicles.js:434), the garrison's only floor was 5, and
    // `cityCrime` never rang `cityAlarm` — so you could fly a fighter off the
    // strip and the parade ground kept saluting. (b) Deleting the 5-star
    // beeline would otherwise have taken away the ONE case it got right: a
    // player standing in the middle of the base, where the men are close
    // enough that posture actually works.
    //
    // TWO STARS is garrison.js's own bar for a rifleman on a defence compound
    // (`minStars: 2`, "a soldier does not open up on a shoplifter"), reused
    // rather than re-chosen so the wire and the roster answer to one number.
    if (P && !P.dead && playerOnSite && stars >= 2) {
      s.level = Math.max(s.level, 1 + stars * 0.2);
      s.t = Math.max(s.t, 8);
      s.mark = { x: P.pos.x, z: P.pos.z };
      const pa = CBZ.city && CBZ.city.playerActor;
      if (pa && !pa.dead) s.by = pa;
    }

    const hot = s.t > 0;
    // STAND-TO: the manhunt is real but it is not HERE. The base does not send
    // men on a walk they cannot finish (see the header); it mans its own wire.
    const stand = standOn() && stars >= 5 && !playerOnSite && !hot;

    if (!hot && !stand) {
      for (let i = 0; i < roster.length; i++) {
        const p = roster[i];
        if (p && p._fortResp && p._fortResp.site === s) releaseBody(p);
      }
      s.roused = 0;
      return;
    }

    // ---- pick the section -------------------------------------------------
    const mark = s.mark || { x: s.x, z: s.z };
    const cap = C.FORT_MAX_RESPOND | 0;
    const pool = [];
    for (let i = 0; i < roster.length; i++) {
      const p = roster[i];
      if (!ownable(p)) { if (p && p._fortResp) p._fortResp = null; continue; }
      if (!siteHit(s, p.pos.x, p.pos.z, LEASH_PAD + 60)) continue;
      pool.push(p);
    }
    // NEAREST FIRST, deterministically — the men who can actually get there
    // are the men who go, and a sort on a measured distance is the same order
    // every replay.
    const ref = stand ? { x: s.gate.x, z: s.gate.z } : mark;
    pool.sort(function (a, b) { return distXZ(a, ref.x, ref.z) - distXZ(b, ref.x, ref.z); });
    const n = Math.min(pool.length, cap);
    s.roused = n;
    s.peak = Math.max(s.peak, n);

    // ---- drive them -------------------------------------------------------
    const foe = (s.by && !s.by.dead) ? s.by : null;
    const shaped = [];
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      if (i >= n) { if (p._fortResp && p._fortResp.site === s) releaseBody(p); continue; }
      // COUNT ROUSALS, NOT FRAMES. These are session counters read by the math
      // gate; incrementing one per body per frame would make "the base answered
      // once" and "the base answered for a minute" the same unreadable number.
      if (!p._fortResp) { p._fortResp = { site: s, since: 0 }; if (stand) STATS.stoodTo++; else STATS.converged++; }
      p._fortResp.site = s;
      p._fortResp.since += dt;
      p.alarmed = Math.max(p.alarmed || 0, 8);

      if (stand) {
        // ON THE WIRE. A slot each, facing out, and no target — the difference
        // between a perimeter and martial law, and the same distinction
        // garrison.js draws for a post that may not stand to.
        const w = s.wire[i % s.wire.length];
        p.rage = null; p.targetActor = null;
        const d = distXZ(p, w.x, w.z);
        if (d > 2.4) {
          p.path = null; p.finalGoal = null;
          if (p.target && p.target.set) p.target.set(w.x, 0, w.z);
          p.state = "walk"; p.pause = 0;
        } else {
          p.state = "idle"; p.speed = 0;
          p.pause = Math.max(p.pause || 0, 2);
          if (p.group) {
            p.group.rotation.y = CBZ.lerpAngle
              ? CBZ.lerpAngle(p.group.rotation.y, w.face, 1 - Math.pow(0.02, dt || 0.016))
              : w.face;
          }
        }
        p.activityState = "stand-to";
        continue;
      }

      // CONVERGE. He goes to the noise; he only takes a TARGET when the target
      // is close enough that the order is one he can obey. That distinction is
      // the whole of the impossible-order bug, and it is why `impossible` is
      // the ratchet this file is pinned on.
      const dFoe = foe ? distXZ(p, foe.pos.x, foe.pos.z) : Infinity;
      if (foe && dFoe < ENGAGE_R) {
        if (p.rage !== foe) STATS.engaged++;
        p.rage = foe; p.state = "fight"; p.pause = 0;
        p.targetActor = foe;
        shaped.push(p);
      } else {
        if (p.rage && !siteHit(s, p.rage.pos ? p.rage.pos.x : s.x, p.rage.pos ? p.rage.pos.z : s.z, 400)) {
          p.rage = null; p.targetActor = null;               // never hold a target off the map
        }
        const cp = convergePoint(s, i, n);
        p.path = null; p.finalGoal = null;
        if (p.target && p.target.set) p.target.set(cp.x, 0, cp.z);
        if (p.state !== "fight") { p.state = "walk"; p.pause = 0; }
        p.activityState = "converge";
      }

      // THE LEASH. A base's men defend the base. Past the wire plus a margin
      // the site wins over the fight — the same law garrison.js applies to a
      // post, for the same reason: a perimeter that empties itself down the
      // first road is not a perimeter.
      if (!siteHit(s, p.pos.x, p.pos.z, LEASH_PAD)) {
        p.rage = null; p.targetActor = null;
        p.path = null; p.finalGoal = null;
        if (p.target && p.target.set) p.target.set(s.gate.x, 0, s.gate.z);
        p.state = "walk"; p.pause = 0;
        p.activityState = "return-to-wire";
      }
    }

    // SHAPE, don't blob. squadai.js already owns "a group of armed people is
    // a firing arc with a focus-fire mark, not a scrum" — it is the same call
    // gang wars and VIP details make, and it needed no edit to take soldiers.
    if (shaped.length > 1 && foe && CBZ.cityShapeSquad) {
      try { CBZ.cityShapeSquad(shaped[0], shaped, foe); } catch (e) {}
    }

    s.t -= dt;
    if (s.t <= 0) { s.t = 0; s.level = 0; s.mark = null; s.by = null; }
  }

  /* HE GIVES UP THE CHASE.

     garrison.js gives a SENTRY this rule ("beyond twice his senses the problem
     has left the perimeter") and an ordinary ped has never had it: `rage` is
     sticky until the target dies. That was survivable while nothing rallied a
     soldier, and it is not survivable now that one does — CITY_ORG_RALLY means
     a man whose mate is shot takes the offender as his target, and if the
     offender then leaves he keeps it FOREVER, walking at a mark he can never
     reach. MEASURED, and it is what caught this: one soldier in state "fight"
     holding a player 3816 m away.

     GIVE_UP is past every weapon in the game (the sniper reaches 240 m) and
     past any honest pursuit, so nothing that was working stops working. The
     sweep is over the whole military roster rather than only the bodies this
     file drives, because the order can be authored anywhere — which is exactly
     the scope `fortAudit().impossibleOrders` measures, and a ratchet you can
     only satisfy by fixing the thing is the point of having one. */
  const GIVE_UP = 300;
  let giveUpT = 0;
  function sweepGiveUp(dt) {
    giveUpT -= dt;
    if (giveUpT > 0) return;
    giveUpT = 1.0;                                   // 1 Hz; a stale target is not an emergency
    const roster = CBZ.militaryPersonnel();
    for (let i = 0; i < roster.length; i++) {
      const p = roster[i];
      if (!p || p.dead || !p.pos) continue;
      // a man being CARRIED is not walking anywhere — the aircraft covers the
      // distance for him, and his target is his aircraft's business
      if (p._milPilot || p._airPilot || p.inCar || p._npcAttached) continue;
      const r = p.rage;
      if (!r || !r.pos) continue;
      const dx = p.pos.x - r.pos.x, dz = p.pos.z - r.pos.z;
      if (dx * dx + dz * dz < GIVE_UP * GIVE_UP) continue;
      p.rage = null; p.targetActor = null;
      if (p.state === "fight") { p.state = "walk"; p.pause = 0; }
    }
  }

  if (CBZ.onUpdate) CBZ.onUpdate(38.72, function (dt) {
    if (!on() || !playing()) return;
    installHooks();
    sweepGiveUp(dt || 0.016);
    const A = CBZ.city && CBZ.city.arena;
    // A NEW WORLD IS NEW GROUND. Same arena-identity test garrison.js and
    // citystaff.js already use; without it the second world you load would
    // rouse coordinates that no longer mean anything.
    if (A && A !== sitesArena) { sitesArena = A; buildSites(); }
    if (!SITES.length) { if (A) buildSites(); if (!SITES.length) return; }
    dt = dt || 0.016;
    let live = 0;
    for (let i = 0; i < SITES.length; i++) {
      const s = SITES[i];
      if (s.t > 0) live++;
      tickSite(s, dt);
    }
    STATS.alerts = live;
  });

  /* =========================================================================
     §6  THE RATCHET.

     CBZ.fortAudit() — the owner's complaint, measured.

       impossibleOrders — soldiers holding a `rage` target that is not on their
                          own ground and that they have no route to. This is
                          the bug in one number, and it is PINNED AT 0 in
                          tools/math-gate.mjs. It counts the WHOLE military
                          roster, not just bodies this file drives, so a future
                          file that re-introduces the beeline trips it.
       soldiers/roster  — the merged roster this file publishes.
       rousable         — how many of them the base could actually order.
       converged/engaged/stoodTo — session counters; a "fix" that stops
                          responding cannot pass, because these must climb.
       convoy           — FALSE, and named in the header. Infantry cannot yet
                          leave the island.
     ========================================================================= */
  CBZ.fortAudit = function () {
    const roster = CBZ.militaryPersonnel();
    let impossible = 0, rousable = 0, responding = 0, ranked = 0;
    for (let i = 0; i < roster.length; i++) {
      const p = roster[i];
      if (!p || p.dead || !p.pos) continue;
      if (p.milRank) ranked++;
      if (ownable(p)) rousable++;
      if (p._fortResp) responding++;
      const r = p.rage;
      if (!r || r.dead || !r.pos) continue;
      // A MAN IN A SEAT IS NOT A MAN ON FOOT. This ratchet is about an order
      // somebody has to WALK to obey; a pilot at 200 knots, a crewman in a
      // cabin or anyone otherwise carried is having the distance covered for
      // him, and counting him tripped the gate the first time a scrambled
      // fighter came home with the player still marked (MEASURED: 1).
      if (p._milPilot || p._airPilot || p.inCar || p._npcAttached) continue;
      // AN ORDER HE CAN OBEY is one whose target is CLOSE (inside the longest
      // sight line in the game — the sniper's 240 m — so any ordinary fight,
      // pursuit or standoff passes), or one that is on his own ground. Anything
      // else is the 1.3 km beeline this file exists to delete, and it is caught
      // wherever it is authored: the check runs over the whole military roster
      // and does not require the body to be standing on a base.
      if (distXZ(p, r.pos.x, r.pos.z) < 240) continue;
      const s = siteAt(p.pos.x, p.pos.z, 120);
      if (s && siteHit(s, r.pos.x, r.pos.z, LEASH_PAD + 120)) continue;
      impossible++;
    }
    const sites = [];
    for (let i = 0; i < SITES.length; i++) {
      const s = SITES[i];
      sites.push({ id: s.id, name: s.name, hot: s.t > 0, level: +s.level.toFixed(2), rings: s.rings, roused: s.roused, peak: s.peak });
    }
    return {
      impossibleOrders: impossible,
      soldiers: roster.length, ranked: ranked, rousable: rousable, responding: responding,
      sites: sites, hooked: hooked,
      converged: STATS.converged, engaged: STATS.engaged, stoodTo: STATS.stoodTo,
      released: STATS.released,
      convoy: C.FORT_CONVOY === true,
      enabled: on(),
      flags: { master: on(), alert: alertOn(), rally: C.FORT_RALLY !== false, standTo: standOn() },
    };
  };

  // INSTALL AT PARSE IF THE NAMES ARE ALREADY THERE. index.html loads this
  // file after peds.js (which assigns cityAlarm) and wanted.js (cityCrime), so
  // in the shipping build both exist right now and the base can hear the very
  // first gunshot of a session rather than the first one after a city tick.
  // The tick still retries, which is what covers a load order that changes and
  // the games/ pages that assemble their own.
  installHooks();

  // A CITY REBUILD DROPS EVERY BODY — forget the ground with them.
  CBZ.fortResponseReset = function () {
    for (let i = 0; i < SITES.length; i++) { SITES[i].t = 0; SITES[i].level = 0; SITES[i].mark = null; SITES[i].by = null; }
    SITES.length = 0; sitesArena = null;
  };
})();

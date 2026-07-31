/* ============================================================
   city/aircraft_doors.js — ELEVATOR-GRAMMAR BOARDING for every flyable
   aircraft (owner ask: "look how elevators handle doors — the door opens,
   you see in, you walk in, it closes behind you; opening planes should
   work like that").

   The gold standard is city/elevators.js (real leaves, you WALK through
   the opening) and the airport airliner's walk-in cabin (island_airport.js
   panel + pending window). This module generalises that arc to the THEFT/
   BOARD paths that used to hard-teleport you into the pilot seat:

     militaryvehicles.js boardVehicle (hijack airliner / private jet /
     base jet / heli)  and  playeraircraft.js [F] board of the owned
     heli / Raptor.

   THE ARC (board):  walk → the player is guided to the door point while
   the door VISIBLY opens (airliner slide panel via island_airport's own
   easing, private-jet AIRSTAIR via its doorRig, fighter/heli CANOPY via a
   lift-and-slide on the tagged canopy mesh) and the lit interior shows
   through the opening → step: the player visibly steps IN through it →
   handover: only NOW does the flight controller take the craft (the same
   spawn/enter calls as before, same return semantics — the arc is internal
   choreography BEHIND the public APIs, which commit synchronously) → the
   door eases closed behind you.  Exit plays the reverse beats: door opens
   FIRST while you're still seated, you see out, then the normal exit puts
   you on the ground and the door closes once you clear it.

   SAFETY: the arc cancels cleanly (door shut, theft reverted via onFail)
   if the player dies, the mode changes, the craft is destroyed, or the
   player ends up in some other vehicle mid-walk. Everything is feature-
   detected; with CBZ.CONFIG.AIRCRAFT_DOOR_ARC=false every caller falls
   back to the exact old instant behaviour (one-line revert).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  if (CBZ.CONFIG && CBZ.CONFIG.AIRCRAFT_DOOR_ARC == null) CBZ.CONFIG.AIRCRAFT_DOOR_ARC = true;
  // A hijack fired from INSIDE the aircraft runs a short flight-deck beat
  // instead of replaying the whole walk-up (see alreadyAboard below). false =
  // the old unconditional arc, which marched the player back out of the plane.
  if (CBZ.CONFIG && CBZ.CONFIG.AIRCRAFT_DOOR_SKIP_WHEN_ABOARD == null) CBZ.CONFIG.AIRCRAFT_DOOR_SKIP_WHEN_ABOARD = true;

  function enabled() { return !CBZ.CONFIG || CBZ.CONFIG.AIRCRAFT_DOOR_ARC !== false; }
  function inCity() { return CBZ.game && CBZ.game.mode === "city"; }

  let arc = null;          // the one live arc, or null

  // local (x,z) on a yaw-rotated group → world (matches island_airport math)
  function toWorld(grp, lx, lz) {
    const th = grp.rotation.y || 0, c = Math.cos(th), s = Math.sin(th);
    return { x: grp.position.x + lx * c + lz * s, z: grp.position.z - lx * s + lz * c };
  }

  // ---- door hardware discovery -------------------------------------------
  // Returns {kind, open(t), doorLocal:{x,z}, outLocal, inLocal, inY} for a
  // group. kind: "panel" (airliner slide — island_airport eases it off
  // rec._doorArcOpen), "stair" (private-jet airstair rig — same flag),
  // "canopy" (we animate the tagged canopy mesh), "hatch" (no mesh — a
  // walk-up beat only).
  function doorSpec(rec, grp) {
    const ud = grp && grp.userData;
    if (ud && ud.cabin && ud.cabin.panel) {
      const cab = ud.cabin;
      // the airliner walk-in offsets track the up-scaled cabin (cab.scale,
      // stashed by island_airport.js); doorX/doorZ/floorTop are already scaled.
      const sc = cab.scale || 1;
      return {
        kind: "panel",
        doorLocal: { x: cab.doorX, z: cab.doorZ },
        outLocal: { x: cab.doorX, z: cab.doorZ - 1.6 * sc },
        inLocal: { x: cab.doorX - 1.1 * sc, z: -0.6 * sc },
        inY: (grp.position.y || 0) + (cab.floorTop || 0),
      };
    }
    if (ud && ud.doorRig && ud.doorRig.panel) {
      const rig = ud.doorRig;
      return {
        kind: "stair",
        doorLocal: { x: rig.doorX, z: rig.doorZ },
        outLocal: { x: rig.doorX, z: rig.doorZ - 1.5 },
        inLocal: { x: rig.doorX - 0.6, z: 0 },
        inY: null,                                  // jets aren't walk-in decks; step ends at the hull
      };
    }
    if (ud && ud.canopy) {
      const cz = ud.canopy.position ? ud.canopy.position.z : 0.9;
      return {
        kind: "canopy",
        doorLocal: { x: -1.3, z: cz },
        outLocal: { x: -2.1, z: cz },
        inLocal: { x: 0, z: cz },
        inY: null,
      };
    }
    return {
      kind: "hatch",
      doorLocal: { x: -2.0, z: 0 },
      outLocal: { x: -2.6, z: 0 },
      inLocal: { x: -0.6, z: 0 },
      inY: null,
    };
  }

  // canopy pose: t 0 closed → 1 open (lift + slide aft, reads as a popped hood)
  // ======================================================================
  //  THE AIRSTAIR (owner: "a whole animation for entering a plane, like for
  //  private planes the stairs coming down — we already have some animation
  //  for entering a plane but it looks glitchy").
  //
  //  BOTH halves of that are the same defect. The "step" beat eased the
  //  player's Y toward the cabin floor with an exponential, so you rose into
  //  the fuselage THROUGH THIN AIR — no stair, no ladder, nothing under your
  //  feet, and an ease that never quite arrives. It looked glitchy because it
  //  WAS: a body levitating up the side of an aeroplane.
  //
  //  A stair fixes the look and the bug in one move. Once there is a real ramp
  //  the climb stops being an ease toward a height and becomes a walk ALONG a
  //  surface — Y is a function of how far up the ramp you are, which lands
  //  exactly on the deck by construction and cannot float.
  //
  //  Built lazily, once per aircraft, parented to the door group so it rides
  //  every heading and taxi movement for free. Deploys by rotating about its
  //  top hinge, exactly the way a real integrated airstair unfolds.
  // ======================================================================
  const STAIR_STEPS = 7;
  function buildStair(grp, spec) {
    if (!window.THREE || !grp) return null;
    const THREE = window.THREE;
    const cmat = CBZ.cmat || CBZ.mat;
    const drop = Math.max(0.9, (spec.inY != null ? spec.inY - (grp.position.y || 0) : 1.6));
    const run = drop * 1.25;                       // ~38 degrees, a real airstair rake
    const W = 0.92;
    const g = new THREE.Group();
    // hinge at the door sill so the whole flight swings down from the doorway
    g.position.set(spec.doorLocal.x, drop, spec.doorLocal.z);
    const rail = cmat(0x9aa3ad), tread = cmat(0xb6bec7);
    for (let i = 0; i < STAIR_STEPS; i++) {
      const t = (i + 0.5) / STAIR_STEPS;
      const st = new THREE.Mesh(new THREE.BoxGeometry(W, 0.05, run / STAIR_STEPS * 0.92), tread);
      st.position.set(0, -drop * t, -run * t);
      st.castShadow = false; st.receiveShadow = true;
      g.add(st);
    }
    // two stringers so it reads as a flight of stairs rather than floating slats
    for (let sdir = -1; sdir <= 1; sdir += 2) {
      const len = Math.hypot(drop, run);
      const sr = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, len), rail);
      sr.position.set(sdir * (W / 2 + 0.03), -drop / 2, -run / 2);
      sr.rotation.x = -Math.atan2(drop, run);
      g.add(sr);
      // handrail above it, the detail that makes an airstair an AIRSTAIR
      const hr = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, len), rail);
      hr.position.set(sdir * (W / 2 + 0.03), -drop / 2 + 0.86, -run / 2);
      hr.rotation.x = -Math.atan2(drop, run);
      g.add(hr);
      for (let k = 0; k < 3; k++) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.86, 0.04), rail);
        const tt = 0.18 + k * 0.34;
        post.position.set(sdir * (W / 2 + 0.03), -drop * tt + 0.43, -run * tt);
        g.add(post);
      }
    }
    g.userData.stair = { drop: drop, run: run };
    g.visible = false;
    grp.add(g);
    return g;
  }
  // t 0 = stowed flush against the hull, 1 = fully deployed on the apron
  function poseStair(g, t) {
    if (!g) return;
    g.visible = t > 0.001;
    // swings down about the sill hinge; stowed it lies flat up the fuselage
    g.rotation.x = (1 - t) * 1.32;
  }

  function poseCanopy(grp, t) {
    const c = grp.userData.canopy;
    if (!c) return;
    if (!c.userData._doorBase) c.userData._doorBase = { y: c.position.y, z: c.position.z, rx: c.rotation.x };
    const b = c.userData._doorBase;
    c.position.y = b.y + 0.55 * t;
    c.position.z = b.z - 0.4 * t;
    c.rotation.x = b.rx - 0.35 * t;
  }

  function setDoorFlag(rec, on) {
    if (rec) rec._doorArcOpen = !!on;
  }
  function soundArcDoor(a, open) {
    // A bare "hatch" has no moving mesh. Giving that fallback a door recording
    // would be exactly the fourth-wall sound this pass is removing.
    if (!a || !a.spec || a.spec.kind === "hatch") return;
    if (open ? a._doorAudioOpen : !a._doorAudioOpen) return;
    a._doorAudioOpen = !!open;
    if (CBZ.sfx) {
      try { CBZ.sfx(open ? "door_open" : "door_close"); } catch (e) {}
    }
  }

  function guide(P, tx, tz, dt, speed) {
    const dx = tx - P.pos.x, dz = tz - P.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.22) return true;
    const step = Math.min(d, (speed || 4.4) * dt);
    P.pos.x += (dx / d) * step;
    P.pos.z += (dz / d) * step;
    if (CBZ.playerChar && CBZ.playerChar.group) {
      CBZ.playerChar.group.position.x = P.pos.x;
      CBZ.playerChar.group.position.z = P.pos.z;
      CBZ.playerChar.group.rotation.y = Math.atan2(dx, dz);
    }
    return false;
  }

  function endArc(fail) {
    if (!arc) return;
    const a = arc;
    // A cancelled walk/exit still returns its visible panel/canopy to closed.
    // Close the audio cycle with that same physical transition, once.
    soundArcDoor(a, false);
    arc = null;
    setDoorFlag(a.rec, false);
    if (a.spec && a.spec.kind === "canopy" && a.group && a.group.parent) poseCanopy(a.group, 0);
    if (a.P) a.P._doorArc = false;
    if (fail && a.onFail) { try { a.onFail(); } catch (e) {} }
  }
  // arcs never survive a mode flip / death — clean cancel, theft reverted
  function cancelIfInvalid() {
    if (!arc) return false;
    const P = CBZ.player;
    if (!inCity() || !P || P.dead) { endArc(true); return true; }
    // a BOARD arc dies if some other controller grabbed the player mid-walk
    // (the "close" beat runs AFTER handover, when P._aircraft is expected)
    if (!arc.exit && arc.phase !== "close" && (P._aircraft || P.driving)) { endArc(true); return true; }
    if (arc.rec && (arc.rec.destroyed || (arc.group && !arc.group.parent))) { endArc(true); return true; }
    return false;
  }

  // ---- BOARD: door opens → player walks/steps IN → handover → door closes --
  // Returns true when the arc STARTED (the caller treats the boarding as
  // committed — same success semantics as the old instant call). handover()
  // runs at the step's end and must return truthy; a falsy handover triggers
  // onFail() so the caller's theft state can revert.
  /* ---- ALREADY PAST THIS DOOR ------------------------------------------
     OWNER BUG (2026-07-27, verbatim): "when i go to steal an airplane i board
     the plane and then the cockpit door opens, and when i press E again to
     hijack it, instead of throwing the pilot out and sitting in the seat, the
     door and steps open as if I'm hijacking from outside the plane — but i
     already boarded and opened the cockpit door."

     Exactly right, and the cause is that this arc was UNCONDITIONAL. begin()
     always started at phase "walk", whose first act is to guide the player to
     `outLocal` — a point 1.6 hull-scales OUTSIDE the fuselage door — while the
     airstairs deploy and the fuselage panel slides. Fired from the flight deck
     that means the player is marched back out through the aeroplane he is
     standing in and the whole boarding beat is replayed.

     The fix is an ENTRY into this grammar, not a bypass of it (elevators.js's
     rule: the door beats are the door beats). A player who is already inside
     starts at a "deck" phase: no stairs, no fuselage panel, no door flag — the
     flight-deck door he already opened is the only door in play, so the beat is
     the short one the owner described — walk to the seats, pilots out, take
     the controls. Everything else about the arc (cancel-on-death, theft revert
     via onFail, the one-arc-at-a-time rule) is unchanged and shared. */
  function alreadyAboard(rec) {
    if (!rec) return false;
    if (CBZ.CONFIG && CBZ.CONFIG.AIRCRAFT_DOOR_SKIP_WHEN_ABOARD === false) return false;
    return !!(CBZ.cityCabinAboard && CBZ.cityCabinAboard(rec));
  }

  function begin(opts) {
    if (!enabled() || arc || !inCity()) return false;
    const P = CBZ.player;
    if (!P || P.dead || P.driving || P._aircraft) return false;
    const grp = opts.group;
    if (!grp || !grp.parent) return false;
    const spec = doorSpec(opts.rec, grp);
    const aboard = alreadyAboard(opts.rec);
    arc = {
      P, rec: opts.rec || null, group: grp, spec,
      handover: opts.handover, onFail: opts.onFail || null,
      phase: aboard ? "deck" : "walk", t: 0, walkT: 0, exit: false,
      stair: null, aboard: aboard,
      deck: aboard && CBZ.cityCabinFlightDeck ? CBZ.cityCabinFlightDeck(opts.rec) : null,
    };
    if (aboard) {
      // The fuselage door and the stairs stay OUT of this: the player never
      // passes through them. _doorArcOpen is deliberately not set, which is
      // what stops island_airport.js force-opening the panel and the airstair.
      P._doorArc = true;
      return true;
    }
    // a walk-in door gets a real flight of stairs; a fighter canopy and a
    // bare hatch do not (nothing to climb to — spec.inY is null).
    if (arc && arc.spec && arc.spec.inY != null) {
      try { arc.stair = grp.userData._cbzStair || (grp.userData._cbzStair = buildStair(grp, arc.spec)); } catch (e) { arc.stair = null; }
      poseStair(arc.stair, 0);
    }
    P._doorArc = true;
    setDoorFlag(arc.rec, true);                    // island_airport eases panel/stair open
    soundArcDoor(arc, true);
    return true;
  }

  // ---- EXIT: door opens FIRST (you see out), then the real exit runs and the
  // door closes behind you. realExit is the caller's untouched instant exit.
  function beginExit(craft, realExit) {
    if (arc) return true;                          // an arc is already playing — swallow the re-press
    if (!enabled() || !inCity()) { realExit(); return true; }
    const P = CBZ.player;
    // "grounded enough for a door beat": explicit onGround, or settled + slow
    // (the heli doesn't always stamp onGround while sitting on its skids)
    const grounded = craft && (craft.onGround ||
      (Math.abs(craft.vy || 0) < 0.6 && Math.abs(craft.speed || 0) < 2.5));
    if (!P || P.dead || !craft || !craft.group || !craft.group.parent || !grounded) { realExit(); return true; }
    const rec = craft.sourceRec || null;
    arc = {
      P, rec, group: craft.group, spec: doorSpec(rec, craft.group),
      handover: null, onFail: null, realExit, craft, baseY: craft.pos ? craft.pos.y : 0,
      phase: "exitOpen", t: 0, exit: true,
    };
    P._doorArc = true;
    setDoorFlag(rec, true);
    soundArcDoor(arc, true);
    return true;
  }

  CBZ.onUpdate && CBZ.onUpdate(55.4, function (dt) {
    if (!arc) return;
    if (cancelIfInvalid()) return;
    const a = arc, P = a.P, spec = a.spec;
    a.t += dt;

    // ---- ALREADY ABOARD: the short flight-deck beat ------------------------
    // No stairs, no fuselage panel, no walk-up. Step up to the chairs, put the
    // crew out of them, take the controls. Bounded by the same 2.2 s the walk
    // beat uses so a blocked path can never wedge the arc.
    if (a.phase === "deck") {
      a.walkT += dt;
      let there = true;
      if (a.deck) there = guide(P, a.deck.x, a.deck.z, dt, 3.2);
      if (there || a.walkT > 2.2) {
        a.phase = "close"; a.t = 0;
        // The crew coming OUT of the seats is not staged here: it belongs to
        // the handover itself (playeraircraft.js citySpawnFlyableFromProp calls
        // CBZ.cityVacateFlightDeck), so every route to the controls ejects them
        // — this arc, the flag-off instant path, and cityAirborneStart alike —
        // instead of only the one that happens to run a door beat.
        let ok = false;
        try { ok = !!(a.handover && a.handover()); } catch (e) { ok = false; }
        if (!ok) { endArc(true); return; }
      }
      return;
    }
    if (a.phase === "walk") {
      // guided approach to the door point while the door eases open
      a.walkT += dt;
      const out = toWorld(a.group, spec.outLocal.x, spec.outLocal.z);
      const arrived = guide(P, out.x, out.z, dt, 4.4);
      if (spec.kind === "canopy") poseCanopy(a.group, Math.min(1, a.walkT / 0.55));
      // THE STAIRS COME DOWN while you walk up to the aircraft — the beat the
      // owner asked for, and it is timed to be finished before you arrive so
      // you never wait on it.
      if (a.stair) poseStair(a.stair, Math.min(1, a.walkT / 0.9));
      if (arrived || a.walkT > 2.2) { a.phase = "open"; a.t = 0; }
      return;
    }
    if (a.phase === "open") {
      // hold a beat with the opening visible (interior lit, passengers seated)
      if (spec.kind === "canopy") poseCanopy(a.group, 1);
      if (a.t >= (spec.kind === "hatch" ? 0.3 : 0.55)) { a.phase = "step"; a.t = 0; }
      return;
    }
    if (a.phase === "step") {
      // the player visibly steps IN through the opening (rising to the deck
      // when the door has one — reads as climbing aboard)
      const inn = toWorld(a.group, spec.inLocal.x, spec.inLocal.z);
      const out = toWorld(a.group, spec.outLocal.x, spec.outLocal.z);
      const done = guide(P, inn.x, inn.z, dt, 3.6);
      if (spec.inY != null) {
        // WALK UP THE RAMP, do not levitate. Height is now a function of how
        // far along the door-ward leg you are, so the body arrives exactly on
        // the deck instead of chasing it with an ease that never lands. That
        // ease is what made the old boarding look glitchy.
        const total = Math.hypot(inn.x - out.x, inn.z - out.z) || 1;
        const left = Math.hypot(inn.x - P.pos.x, inn.z - P.pos.z);
        const up = Math.max(0, Math.min(1, 1 - left / total));
        const baseY = a.baseY != null ? a.baseY : 0;
        P.pos.y = baseY + (spec.inY - baseY) * (up * up * (3 - 2 * up));
        if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.y = P.pos.y;
      }
      if (done || a.t > 1.2) {
        a.phase = "close"; a.t = 0;
        let ok = false;
        try { ok = !!(a.handover && a.handover()); } catch (e) { ok = false; }
        if (!ok) { endArc(true); return; }
        setDoorFlag(a.rec, false);                 // island easing slides it shut behind you
        soundArcDoor(a, false);
      }
      return;
    }
    if (a.phase === "close") {
      if (spec.kind === "canopy" && a.group.parent) poseCanopy(a.group, Math.max(0, 1 - a.t / 0.45));
      if (a.stair) poseStair(a.stair, Math.max(0, 1 - a.t / 0.5));   // folds up behind you
      if (a.t >= 0.5) endArc(false);
      return;
    }

    // ---- exit beats ----
    if (a.phase === "exitOpen") {
      if (spec.kind === "canopy") poseCanopy(a.group, Math.min(1, a.t / 0.45));
      // abort (stay flying, door shut) if the craft lifts off mid-beat
      if (a.craft && a.craft.pos && a.craft.pos.y > a.baseY + 1.2) { endArc(false); return; }
      if (a.t >= 0.5) {
        a.phase = "exitStep"; a.t = 0;
        try { a.realExit(); } catch (e) {}
      }
      return;
    }
    if (a.phase === "exitStep") {
      // player is outside (real exit placed them); hold the door a beat, then
      // ease it shut (island proximity easing keeps a panel open while you
      // stand at it — the flag release just stops FORCING it).
      if (a.t >= 0.7) {
        setDoorFlag(a.rec, false);
        if (spec.kind === "canopy" && a.group.parent) poseCanopy(a.group, 0);
        soundArcDoor(a, false);
        endArc(false);
      }
      return;
    }
  });

  CBZ.aircraftDoorArc = {
    get active() { return !!arc; },
    // milvehicle/airport prop boarding (militaryvehicles.js boardVehicle)
    boardProp: function (rec, handover, onFail) {
      if (!rec || !rec.group) return false;
      return begin({ rec, group: rec.group, handover, onFail });
    },
    // owned heli/Raptor boarding (playeraircraft.js [F])
    boardCraft: function (craft, enter) {
      if (!craft || !craft.group) return false;
      return begin({ rec: null, group: craft.group, handover: function () { return enter(craft); } });
    },
    exitCraft: beginExit,
    cancel: function () { endArc(true); },
  };
})();

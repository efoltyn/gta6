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
  function begin(opts) {
    if (!enabled() || arc || !inCity()) return false;
    const P = CBZ.player;
    if (!P || P.dead || P.driving || P._aircraft) return false;
    const grp = opts.group;
    if (!grp || !grp.parent) return false;
    const spec = doorSpec(opts.rec, grp);
    arc = {
      P, rec: opts.rec || null, group: grp, spec,
      handover: opts.handover, onFail: opts.onFail || null,
      phase: "walk", t: 0, walkT: 0, exit: false,
    };
    P._doorArc = true;
    setDoorFlag(arc.rec, true);                    // island_airport eases panel/stair open
    if (CBZ.sfx) { try { CBZ.sfx("door"); } catch (e) {} }
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
    if (CBZ.sfx) { try { CBZ.sfx("door"); } catch (e) {} }
    return true;
  }

  CBZ.onUpdate && CBZ.onUpdate(55.4, function (dt) {
    if (!arc) return;
    if (cancelIfInvalid()) return;
    const a = arc, P = a.P, spec = a.spec;
    a.t += dt;

    if (a.phase === "walk") {
      // guided approach to the door point while the door eases open
      a.walkT += dt;
      const out = toWorld(a.group, spec.outLocal.x, spec.outLocal.z);
      const arrived = guide(P, out.x, out.z, dt, 4.4);
      if (spec.kind === "canopy") poseCanopy(a.group, Math.min(1, a.walkT / 0.55));
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
      const done = guide(P, inn.x, inn.z, dt, 3.6);
      if (spec.inY != null) {
        P.pos.y += (spec.inY - P.pos.y) * Math.min(1, dt * 6);
        if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.y = P.pos.y;
      }
      if (done || a.t > 1.2) {
        a.phase = "close"; a.t = 0;
        let ok = false;
        try { ok = !!(a.handover && a.handover()); } catch (e) { ok = false; }
        if (!ok) { endArc(true); return; }
        setDoorFlag(a.rec, false);                 // island easing slides it shut behind you
        if (CBZ.sfx) { try { CBZ.sfx("door"); } catch (e) {} }
      }
      return;
    }
    if (a.phase === "close") {
      if (spec.kind === "canopy" && a.group.parent) poseCanopy(a.group, Math.max(0, 1 - a.t / 0.45));
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
        if (CBZ.sfx) { try { CBZ.sfx("door"); } catch (e) {} }
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

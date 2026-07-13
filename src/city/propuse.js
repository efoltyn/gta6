/* ============================================================
   city/propuse.js — PROPS WITH PURPOSE: every chair/bench/couch is
   SITTABLE and every bed is SLEEPABLE (owner order: "no other props
   exist without purpose").

   The design is an ANCHORS-ONLY registry: furniture builders
   (buildings.js furniture sets, props.js patio/shelter/camps) register
   a seat/bed ANCHOR (world position + facing yaw) as they place each
   piece. The mesh itself is never touched — it stays batch-folded
   (core/batch.js) and costs nothing; sitting is a pose + a position
   pin, not a mesh mutation. city/interact.js surfaces the verbs
   ("Sit down" / "Sleep til morning" / "Stand up") through the ONE
   interaction registry.

   Poses: SIT rides the rig's existing `ch.sitting` flag (the exact
   office-worker mechanism, entities/character.js animChar). LIE has no
   rig pose — it's the KO/death precedent: the char GROUP rolls
   rotation.z → π/2 while a per-frame hold pins the body on the
   mattress (systems/physics.js:464 does the same for a downed player).

   NPC API (for the schedules agent): CBZ.propSit(ped, seat) sets the
   ped up so peds.js's OWN `state==="sit"` branch holds it seated (it
   re-pins from ped._deskAnchor every frame — the office-desk idiom,
   peds.js ~3984); CBZ.propStand(ped) releases. Seats are single-
   occupancy with stale-claim tolerance (a dead/recycled occupant frees
   the seat lazily — correctness never depends on a release call).

   Revert: CBZ.CONFIG.PROPS_PURPOSE = false (everything no-ops).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PROPS_PURPOSE == null) CBZ.CONFIG.PROPS_PURPOSE = true;
  // wake-up time as a dayPhase fraction: sun y = sin(t·2π)·95, noon = 0.25,
  // so 0.08 ≈ climbing morning sun (~7:50am), clearly lit.
  if (CBZ.CONFIG.PROPS_MORNING_PHASE == null) CBZ.CONFIG.PROPS_MORNING_PHASE = 0.08;

  function on() { return CBZ.CONFIG.PROPS_PURPOSE !== false; }

  // ---- registries -----------------------------------------------------------
  // Seat rec: { x,y,z, face, kind, lot, occupant }  (y = FLOOR level the sitter
  //   stands on — the pose fakes the seat height, exactly like the desk anchors)
  // Bed rec:  { x,y,z, face, len, lieY, kind, lot, occupant }  (lieY = pinned
  //   body height when lying = mattressTop + 0.3, the KO-lie offset)
  // Poster rec: { mesh, x,y,z, entry }  (entry = props.js's dynAds record; its
  //   lastKey tells whether the board is CURRENTLY showing a wanted ad)
  const seats = CBZ.propSeats = CBZ.propSeats || [];
  const beds = CBZ.propBeds = CBZ.propBeds || [];
  const posters = CBZ.propWantedPosters = CBZ.propWantedPosters || [];

  // fresh-world reset — called at the top of CBZ.cityBuildings (the whole-city
  // build entry, world.js runs it before cityProps) so anchors rebuild in
  // lockstep with the furniture that owns them.
  const seatKeys = new Set(), bedKeys = new Set();
  CBZ.propPurposeReset = function () {
    seats.length = 0; beds.length = 0; posters.length = 0;
    seatKeys.clear(); bedKeys.clear();
  };

  // ---- registration (build-time, deterministic: piggybacks placement) -------
  // O(1) coordinate-keyed dedupe (a re-run furnisher must not double-register).
  function dedupe(keys, x, y, z) {
    const k = Math.round(x * 10) + "," + Math.round(y * 10) + "," + Math.round(z * 10);
    if (keys.has(k)) return true;
    keys.add(k);
    return false;
  }
  // face = yaw the seated body faces (ped convention: body looks along
  // (sin face, cos face) — same as peds' _deskAnchor.face).
  CBZ.propRegisterSeat = function (x, y, z, face, kind, lot) {
    if (!on()) return null;
    if (dedupe(seatKeys, x, y || 0, z)) return null;
    const rec = { x, y: y || 0, z, face: face || 0, kind: kind || "chair", lot: lot || null, occupant: null };
    seats.push(rec);
    return rec;
  };
  // (hx,hz) = direction from mattress CENTER toward the pillow/head end.
  // The lying roll is group.rotation.z = π/2 with rotation.y = face; under
  // three.js 'XYZ' euler that maps the body's up-axis (head) to world
  // (-cos face, 0, sin face), so face = atan2(hz, -hx) puts the head on the
  // pillow. topY = the mattress TOP surface (world y).
  CBZ.propRegisterBed = function (x, y, z, hx, hz, len, topY, kind, lot) {
    if (!on()) return null;
    if (dedupe(bedKeys, x, y || 0, z)) return null;
    const rec = {
      x, y: y || 0, z,
      face: Math.atan2(hz || 0, -(hx || 0) || 0),
      len: len || 2.0, lieY: (topY || 0.6) + 0.3,
      kind: kind || "bed", lot: lot || null, occupant: null,
    };
    beds.push(rec);
    return rec;
  };
  // called by props.js's regDynAd for every board that can carry the live
  // WANTED poster. entry.lastKey (the props.js dynAds record) is the live
  // "is a wanted ad actually up right now" signal.
  CBZ.propRegisterWantedPoster = function (mesh, x, y, z, entry) {
    if (!on()) return null;
    const rec = { mesh, x, y: y || 0, z, entry: entry || null, kind: "wanted" };
    posters.push(rec);
    return rec;
  };

  // ---- occupancy -------------------------------------------------------------
  function isStale(a) {
    if (!a) return true;
    if (a.dead || a._recycled || a._despawned) return true;
    if (a !== CBZ.player && !a.group) return true;
    return false;
  }
  function isFree(rec) { return !rec.occupant || isStale(rec.occupant); }

  // lazily resolve the lot an interior anchor sits in (so demolished buildings
  // stop offering their furniture — mirrors officejobs' demolished-desk skip).
  function lotsList() {
    const c = CBZ.city;
    if (!c) return null;
    if (c.arena && c.arena.lots) return c.arena.lots;
    return c.lots || null;
  }
  function lotOf(rec) {
    if (rec.lot !== null || rec._lotR) return rec.lot;
    const lots = lotsList();
    if (!lots) return null;               // city not up yet — retry next query
    rec._lotR = true;
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      const hw = l.w / 2 + 0.5, hd = (l.d != null ? l.d : l.w) / 2 + 0.5;
      if (Math.abs(rec.x - l.cx) <= hw && Math.abs(rec.z - l.cz) <= hd) { rec.lot = l; break; }
    }
    return rec.lot;
  }
  function usable(rec, py) {
    if (!isFree(rec)) return false;
    if (py != null && Math.abs(rec.y - py) > 2.0) return false;   // wrong floor
    const l = lotOf(rec);
    if (l && l.demolished) return false;
    return true;
  }

  // ---- queries (also the NPC-schedules agent's API) --------------------------
  function nearestIn(list, px, pz, r, py) {
    if (!on() || !list.length) return null;
    let best = null, bd = (r || 3.8) * (r || 3.8);
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      const dx = rec.x - px, dz = rec.z - pz, d = dx * dx + dz * dz;
      if (d >= bd) continue;
      if (!usable(rec, py)) continue;
      bd = d; best = rec;
    }
    return best;
  }
  CBZ.propNearestSeat = function (px, pz, r, py) { return nearestIn(seats, px, pz, r, py); };
  CBZ.propNearestBed = function (px, pz, r, py) { return nearestIn(beds, px, pz, r, py); };
  // nearest board CURRENTLY displaying the live WANTED poster. Returns the
  // (stable-identity) rec, refreshed with a live wanted/bounty snapshot —
  // the object handed to CBZ.bountyFromPoster.
  CBZ.propNearestWantedPoster = function (px, pz, r) {
    if (!on() || !posters.length) return null;
    const g = CBZ.game;
    let best = null, bd = (r || 3.8) * (r || 3.8);
    for (let i = 0; i < posters.length; i++) {
      const rec = posters[i];
      // showing a wanted ad right now? (adKey embeds "|wanted|" for that kind)
      if (rec.entry && String(rec.entry.lastKey || "").indexOf("|wanted|") < 0) continue;
      const dx = rec.x - px, dz = rec.z - pz, d = dx * dx + dz * dz;
      if (d >= bd) continue;
      bd = d; best = rec;
    }
    if (best && g) {
      best.wanted = g.wanted | 0;
      best.bounty = (g.wanted | 0) * 2500 + (g.cityKills | 0) * 250;
    }
    return best;
  };

  // ---- claim / release --------------------------------------------------------
  function releaseFrom(list, actor) {
    for (let i = 0; i < list.length; i++) if (list[i].occupant === actor) list[i].occupant = null;
  }
  CBZ.propSeatRelease = function (actor) {
    if (!actor) return;
    releaseFrom(seats, actor); releaseFrom(beds, actor);
    actor._propSeat = null; actor._propBed = null;
  };

  // ---- SIT / STAND ------------------------------------------------------------
  // actor = CBZ.player or a peds.js ped (anything with .char + .pos + .group).
  CBZ.propSit = function (actor, seat) {
    if (!on() || !actor || !seat || !isFree(seat)) return false;
    if (actor.dead || (actor.ko | 0) > 0 || actor.driving) return false;
    CBZ.propSeatRelease(actor);            // moving off a previous seat/bed
    seat.occupant = actor;
    actor._propSeat = seat;
    if (actor === CBZ.player) {
      const P = CBZ.player, ch = CBZ.playerChar;
      P.pos.set(seat.x, seat.y, seat.z);
      P.vy = 0; P.grounded = true;
      if (ch) { ch.sitting = true; ch.group.rotation.y = seat.face; }
      return true;                         // the onUpdate(42) hold does the rest
    }
    // NPC: the exact office-worker sit mechanism — peds.js's state==="sit"
    // branch re-pins from _deskAnchor every frame and zeroes speed.
    actor._deskAnchor = { x: seat.x, y: seat.y, z: seat.z, face: seat.face, lot: seat.lot };
    actor.state = "sit";
    actor.speed = 0; actor.path = null;
    if (actor.pos && actor.pos.set) actor.pos.set(seat.x, seat.y, seat.z);
    if (actor.group) { actor.group.position.set(seat.x, seat.y, seat.z); actor.group.rotation.y = seat.face; }
    if (actor.char) actor.char.sitting = true;
    return true;
  };
  CBZ.propStand = function (actor) {
    if (!actor) return;
    const had = actor._propSeat || actor._propBed;
    CBZ.propSeatRelease(actor);
    if (actor === CBZ.player) {
      const ch = CBZ.playerChar;
      if (ch) { ch.sitting = false; ch.group.rotation.z = 0; ch.group.rotation.x = 0; }
      CBZ.player.stun = 0;
      return;
    }
    if (had) actor._deskAnchor = null;     // only clear OUR anchor, never an office desk claim
    if (actor.state === "sit") actor.state = "walk";
    if (actor.char) { actor.char.sitting = false; if (actor.group) { actor.group.rotation.z = 0; } }
  };

  // ---- SLEEP / WAKE -----------------------------------------------------------
  function skipToMorning() {
    // guests never write the shared world clock (host owns it — netpersist).
    if (CBZ.net && CBZ.net.active && CBZ.net.guest && CBZ.net.guest()) return false;
    if (!CBZ.dayPhase || !CBZ.dayCount) return false;
    const MORNING = CBZ.CONFIG.PROPS_MORNING_PHASE;
    const cur = CBZ.dayPhase();
    if (MORNING <= cur) CBZ.dayCount(CBZ.dayCount() + 1);   // wrapped past midnight
    CBZ.dayPhase(MORNING);
    return true;
  }
  CBZ.propSleep = function (actor, bed) {
    if (!on() || !actor || !bed || !isFree(bed)) return false;
    if (actor.dead || (actor.ko | 0) > 0 || actor.driving) return false;
    CBZ.propSeatRelease(actor);
    bed.occupant = actor;
    actor._propBed = bed;
    if (actor === CBZ.player) {
      const P = CBZ.player, ch = CBZ.playerChar;
      P.pos.set(bed.x, bed.lieY, bed.z);
      P.vy = 0; P.grounded = true;
      if (ch) { ch.sitting = false; ch.group.rotation.y = bed.face; }
      // the time-skip fires ONCE at lie-down (not per-frame). No heal, no heat
      // change — the owned-safehouse sleepHeal stays the special full reset.
      const skipped = skipToMorning();
      const g = CBZ.game;
      if (g && g.tired != null) g.tired = 0;                 // rested
      if (CBZ.city && CBZ.city.note) CBZ.city.note(skipped ? "😴 Slept until morning." : "😴 Resting…", 2.4);
      return true;
    }
    // NPC lie-down: sit-state pin at mattress height + the roll flag; the
    // per-frame roll is applied by the hold below (peds' sit branch owns x/z).
    actor._deskAnchor = { x: bed.x, y: bed.lieY, z: bed.z, face: bed.face, lot: bed.lot };
    actor.state = "sit";
    actor.speed = 0; actor.path = null;
    actor._propLie = true;
    if (actor.pos && actor.pos.set) actor.pos.set(bed.x, bed.lieY, bed.z);
    if (actor.group) { actor.group.position.set(bed.x, bed.lieY, bed.z); actor.group.rotation.y = bed.face; }
    if (actor.char) actor.char.sitting = false;
    return true;
  };
  CBZ.propWake = function (actor) {
    if (!actor) return;
    CBZ.propSeatRelease(actor);
    if (actor === CBZ.player) {
      const ch = CBZ.playerChar;
      if (ch) { ch.sitting = false; ch.group.rotation.z = 0; ch.group.rotation.x = 0; }
      CBZ.player.stun = 0;
      return;
    }
    actor._propLie = false;
    actor._deskAnchor = null;
    if (actor.state === "sit") actor.state = "walk";
    if (actor.group) actor.group.rotation.z = 0;
  };

  // ---- the per-frame HOLD -----------------------------------------------------
  // onUpdate(42): AFTER physics (10, writes player.pos/group) and the
  // interaction scan (39), BEFORE the camera reads the group (onAlways 50) —
  // so the pin wins the frame. Runs only while g.state === "playing".
  if (CBZ.onUpdate) CBZ.onUpdate(42, function (dt) {
    if (!on()) return;
    const P = CBZ.player, ch = CBZ.playerChar, g = CBZ.game;
    if (!P || !ch) return;
    const seat = P._propSeat, bed = P._propBed;

    // NPC lie-hold: peds' own sit branch pins x/z + yaw but forces y=0 and
    // char.sitting=true every frame — re-pin the height onto the mattress and
    // apply the roll AFTER peds ran (this updater is later in the order).
    for (let i = 0; i < beds.length; i++) {
      const rec = beds[i], o = rec.occupant;
      if (o && o !== P && o._propLie && o.group && !isStale(o)) {
        if (o.pos) o.pos.y = rec.lieY;
        o.group.position.y = rec.lieY;
        o.group.rotation.z = Math.PI / 2;
        if (o.char) o.char.sitting = false;
      }
    }
    if (!seat && !bed) return;

    // force-exit: anything else claiming the body wins (shot, KO'd, died,
    // thrown, entered a car, a cutscene grabbed the camera, mode change).
    if (!g || g.mode !== "city" || g.state !== "playing"
        || P.dead || (P.ko | 0) > 0 || P.driving || P._death
        || (P._phys && (P._phys.air || (P._phys.down | 0) > 0))
        || (CBZ.cineActive && CBZ.cineActive())) {
      if (seat) CBZ.propStand(P); else CBZ.propWake(P);
      return;
    }
    const a = seat || bed;
    const l = a.lot || (a._lotR ? null : lotOf(a));
    if (l && l.demolished) {               // the building came down around you
      if (seat) CBZ.propStand(P); else CBZ.propWake(P);
      return;
    }
    const y = seat ? a.y : a.lieY;
    P.pos.set(a.x, y, a.z);
    P.vy = 0; P.grounded = true;
    ch.group.position.set(a.x, y, a.z);
    ch.group.rotation.y = a.face;
    if (seat) {
      ch.sitting = true;
    } else {
      ch.sitting = false;
      // damp the roll toward the lie (the KO-lie look) — matches physics.js's
      // own rotation.z ease so waking/KO transitions never pop.
      const k = 1 - Math.exp(-10 * (dt || 0.016));
      ch.group.rotation.z += (Math.PI / 2 - ch.group.rotation.z) * k;
      ch.group.rotation.x = 0;
    }
    // stun top-up: physics zeroes WASD + blocks jump while stun > 0 (the
    // drinking.js piggyback idiom) — no new freeze flag. The interact panel
    // ignores stun, so "Stand up" stays live.
    P.stun = Math.max(P.stun || 0, 0.15);
  });
})();

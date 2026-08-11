/* ============================================================
   systems/rest.js — GIVE A BODY A PLACE, SEND IT THERE, PUT IT IN THE POSE.

   OWNER, of a room full of NPCs and a room full of beds: they "don't sit or
   lie on beds — they stand overlapping them."

   Every game with people and furniture in it needs the same six verbs and
   nobody has ever had them: claim a place, walk to it, hand the body to the
   pose, hold it there, get it up, and step it CLEAR. This file is those verbs
   and nothing else. WHO sleeps, WHEN, and how many places there are is the
   game's business — a ward, a dormitory, a barracks and a cell wing differ in
   every one of those and in none of these.

   ------------------------------------------------------------------
   THE THREE LOAD-ORDER FAULTS THIS LAYER EXISTS TO OUTLIVE. All three were
   measured live, all three were SILENT, and all three will happen again to
   the next game that furnishes a room:

   1. THE REGISTRY PARSES AFTER ITS CALLERS. A world builder that registers a
      bed at parse time runs hundreds of script tags before whatever owns the
      anchor registry. Every call takes the silent degrade branch and the
      whole "props with purpose" layer is documentation. Measured: 21 fittings
      registered, 0 seats, 0 beds. `CBZ.rest.bed()/seat()` QUEUE when the
      registry is absent and drain on the first tick, so a builder may
      register whenever it likes.

   2. SOMETHING ELSE RESETS THE REGISTRY AFTER YOUR FLUSH. A shared purpose
      registry is cleared whenever the world that owns it rebuilds — which
      happens after a one-shot `load` flush, and that listener has already
      fired. Measured: a chow hall reporting 0 seats with 75 anchors sitting
      in a queue nobody would ever drain again. `CBZ.rest.ready()` re-flushes,
      is idempotent by construction (registration dedupes on a decimetre
      coordinate key) and costs nothing when the anchors are already live.
      CALL IT LATE, from whatever first needs a chair.

   3. THE DEDUPE KEY IS (x, y, z), SO A STACK LOSES ITS UPPER RACK. Two bunks
      of one stack share x and z; the upper one is discarded unless it passes
      its OWN anchor height, and it is discarded SILENTLY — half a dormitory's
      capacity, gone, with no error anywhere. `CBZ.rest.bed()` counts every
      refused registration on `audit().dupes`, so the next stack that loses a
      rack says so out loud.

   ------------------------------------------------------------------
   HOW IT HOLDS A BODY. Actors in this engine come in two shapes: a ped with
   `pos`/`path`/`finalGoal` that something re-pins every frame, and a plain
   actor with `group`/`target`/`pause` and no path at all. The peds-shaped
   verbs (`propGoSit`, `propSeatNpc`, `propBedNpc`) read `ped.pos` and are
   useless for the second kind, so this file never calls them: it walks a body
   with whatever mover already owns it — write `target`, clear `pause` — and
   hands over to `CBZ.propSleep` / `CBZ.propSit` only at ARM'S LENGTH, where
   the pose's own arc and its late-order hold take the transform. A leash that
   yields to that hold co-operates; two systems writing one Vector3 is a body
   vibrating in a doorway.

   ONE SHARED-BEHAVIOUR HAZARD, HANDLED HERE: the pose verbs write
   `actor.speed = 0`. For a ped that is the CURRENT speed, recomputed next
   frame. For a plain actor `speed` is the constant walk RATE it was spawned
   with, so letting the pose zero it leaves a body frozen at 0 m/s for the
   rest of the run. Every hand-off below saves the rate and restores it on
   wake — `CBZ.rest.up()` is the only correct way to end a pose.

   ------------------------------------------------------------------
   AND THE FOURTH FAULT, WHICH IS THE OWNER'S SENTENCE ITSELF. `propWake`
   clears a pose and NEVER MOVES THE BODY — right for a ped, because the rise
   ARC walks him off the mattress first; wrong the instant that arc is
   skipped, i.e. on a RESET, when a whole wing gets up on one frame. Measured:
   25 bodies standing INSIDE the beds they had been asleep in — the original
   complaint, restored by a restart. So `CBZ.rest.box` is one footprint used
   by BOTH the sweep that prevents it and the count that measures it: when the
   invariant and the thing enforcing it are the same test, a ratchet cannot
   pass by luck.

   NO WORLD REQUIRED. Every call feature-detects: with no anchor registry
   loaded the verbs degrade to "walk there and stand", which is exactly what a
   page with no furniture should do.

   Flag REST_V1. Ratchet CBZ.restAudit().standers pinned at 0 — bodies whose
   feet are inside a mattress rectangle while they are not lying on it.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.REST_V1 == null) CFG.REST_V1 = true;
  if (CBZ.rest) return;                        // idempotent (family guard idiom)

  /* ==========================================================
     1. REGISTRATION THAT SURVIVES LOAD ORDER
     ========================================================== */
  const queued = [];
  let flushed = false, dupes = 0, made = 0;

  function haveReg() { return !!(CBZ.propRegisterBed || CBZ.propRegisterSeat); }

  function doBed(a) {
    if (!CBZ.propRegisterBed) return null;
    let rec = null;
    try { rec = CBZ.propRegisterBed.apply(null, a); } catch (e) { rec = null; }
    if (rec) made++; else dupes++;      // refused = a coordinate key already taken
    return rec;
  }
  function doSeat(a) {
    if (!CBZ.propRegisterSeat) return null;
    let rec = null;
    try { rec = CBZ.propRegisterSeat.apply(null, a); } catch (e) { rec = null; }
    if (rec) made++; else dupes++;
    return rec;
  }

  /* A bed registration whose anchor y is the rack's OWN height. Two bunks of a
     stack share x and z; the key includes y, so the upper rack MUST pass its
     own — pass 0 twice and the second call is refused and counted. */
  function bed(x, y, z, hx, hz, len, topY, kind, lot) {
    const args = [x, y, z, hx, hz, len, topY, kind, lot];
    if (!CBZ.propRegisterBed) { queued.push({ bed: 1, a: args }); return null; }
    return doBed(args);
  }
  function seat(x, y, z, face, kind, lot, geom) {
    const args = [x, y, z, face, kind, lot, geom];
    if (!CBZ.propRegisterSeat) { queued.push({ bed: 0, a: args }); return null; }
    return doSeat(args);
  }
  function defer(fn) {
    if (typeof fn !== "function") return;
    if (haveReg() && flushed) { try { fn(); } catch (e) {} return; }
    queued.push({ fn: fn });
  }

  /* CALL THIS LATE, FROM WHATEVER FIRST NEEDS A CHAIR. Idempotent: the shared
     registration dedupes on a coordinate key, so a re-flush after somebody
     else wiped the registry costs nothing when the anchors are already live
     and restores them when they are not. */
  function ready() {
    if (CBZ.roomAnchorsFlush) { try { CBZ.roomAnchorsFlush(); } catch (e) {} }
    if (!haveReg()) return false;
    flushed = true;
    const out = [];
    for (let i = 0; i < queued.length; i++) {
      const j = queued[i];
      if (j.fn) { try { j.fn(); } catch (e) {} continue; }
      const rec = j.bed ? doBed(j.a) : doSeat(j.a);
      if (rec) out.push(rec);
    }
    queued.length = 0;
    return true;
  }

  /* ==========================================================
     2. QUERIES — every one of them safe to call with nothing loaded
     ========================================================== */
  function entry(rec) {
    if (!rec) return null;
    let e = null;
    try { e = CBZ.propEntryPoint ? CBZ.propEntryPoint(rec) : null; } catch (err) { e = null; }
    return (e && e.ok) ? e : null;
  }
  // where a body should STAND to use this piece: the solved walkable side, or
  // the piece itself when nothing has solved one
  function approach(rec) {
    const e = entry(rec);
    return e ? { x: e.x, z: e.z } : (rec ? { x: rec.x, z: rec.z } : null);
  }
  function seatsIn(x0, x1, z0, z1, y, out) {
    out = out || [];
    if (!CBZ.propSeatsIn) return out;
    try { CBZ.propSeatsIn(x0, x1, z0, z1, y || 0, out); } catch (e) {}
    return out;
  }
  function nearestBed(x, z, r, y) {
    try { return (CBZ.propNearestBed && CBZ.propNearestBed(x, z, r, y || 0)) || null; } catch (e) { return null; }
  }
  function nearestSeat(x, z, r, y) {
    try { return (CBZ.propNearestSeat && CBZ.propNearestSeat(x, z, r, y || 0)) || null; } catch (e) { return null; }
  }
  // the nearest record in a pool that nobody is using
  function nearestFree(pool, x, z, maxD) {
    let best = null, bd = (maxD || 3.4) * (maxD || 3.4);
    for (let i = 0; i < (pool || []).length; i++) {
      const s = pool[i];
      if (!s || s.occupant) continue;
      const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /* ==========================================================
     3. PRECEDENCE. A REAL BRAIN STATE OUTRANKS THE FURNITURE.

        NOTE what is deliberately NOT in `busy`: a live transition arc. An arc
        is this layer's OWN hand-off in progress, and treating it as "busy" is
        how a first draft woke every body on the sweep after it put them to
        bed — the settle beat had not finished, so the next tick read the arc,
        called it a brain state and stood the man back up. An arc is asked
        about separately, and the answer there is "leave him alone", never
        "get him up".
     ========================================================== */
  function busy(a) {
    return !a || a.dead || a.escaped || (a.ko | 0) > 0 || a._npcAttached || a.intimidMode
      || (a.huntPlayer || 0) > 0 || a.aiState === "fight" || a.aiState === "flee";
  }
  function inTransition(a) { return !!(CBZ.propArcActive && CBZ.propArcActive(a)); }

  /* ---- the walk-rate hazard (see the header) — AND THE OTHER HALF OF THE
       SAME STATEMENT. city/propuse.js:1170 and :1302 both read

           actor.speed = 0; actor.path = null;

       and this file repaired only the first clause. For a peds.js ped that is
       right twice: `speed` is recomputed and `path` is a route its own brain
       rebuilds. For a PLAIN actor with its own mover — which is the entire
       case this layer exists to serve — the second clause destroys a field the
       caller owns and typed. Measured in games/night-watch.html: a body sat
       down during `closing`, and the first frame of `night` its game touched
       `actor.path.length` and threw. Three consecutive throws and microboot
       RETIRES the updater, so the museum's staff and its thieves both stopped
       existing, with no error anywhere and no dead hook to find.

       Put back what we found, in the SHAPE we found it: an actor whose path
       was an array gets an empty array, never a null. Every read of `path` in
       city/peds.js is `!ped.path || !ped.path.length`, so a ped is unaffected. */
  function keepRate(a) {
    if (a._restRate == null && a.speed > 0) a._restRate = a.speed;
    if (a._restPath == null) a._restPath = Array.isArray(a.path) ? 1 : 0;
  }
  function giveRate(a) {
    if (a._restRate != null) { a.speed = a._restRate; a._restRate = null; }
    if (a._restPath) { if (!Array.isArray(a.path)) a.path = []; a._restPath = null; }
    else if (a._restPath === 0) a._restPath = null;
  }

  /* ==========================================================
     4. THE VERBS
     ========================================================== */
  // write the destination the body's OWN mover already reads; true on arrival
  function send(a, x, z, near) {
    if (!a || !a.target || !a.group) return false;
    a.target.set(x, 0, z);
    a.pause = 0;
    const g = a.group.position;
    const r = near || 2.6;
    return (g.x - x) * (g.x - x) + (g.z - z) * (g.z - z) < r * r;
  }

  /* A STABLE PLACE FOR THE WHOLE RUN. Re-picking every night is a game of
     musical chairs; the first caller wins the claim and every later caller
     gets the same record back, which is what lets two systems (the one that
     HERDS a body and the one that BEDS it) aim at one spot instead of two. */
  function claim(a, list, opts) {
    opts = opts || {};
    const key = opts.key || "_restPlace";
    const held = a[key];
    if (held && (!held.occupant || held.occupant === a)) return held;
    if (!a.group) return null;
    const g = a.group.position;
    let best = null, bd = Infinity;
    for (let i = 0; i < (list || []).length; i++) {
      const b = list[i];
      if (!b || b.occupant || b._claim) continue;
      if (opts.reserved && opts.reserved(b, a)) continue;
      const d = (b.x - g.x) * (b.x - g.x) + (b.z - g.z) * (b.z - g.z);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) { best._claim = a; a[key] = best; }
    return best;
  }
  function unclaim(a, key) {
    const k = key || "_restPlace";
    const held = a[k];
    if (held && held._claim === a) held._claim = null;
    a[k] = null;
  }
  // every claim on an unoccupied record goes back in the pool
  function dropClaims(list) {
    for (let i = 0; i < (list || []).length; i++) if (list[i] && !list[i].occupant) list[i]._claim = null;
  }

  // walk him to it, then let the pose's own arc take the last two metres
  function sleep(a, bedRec) {
    if (busy(a) || inTransition(a) || !bedRec || bedRec.occupant || !CBZ.propSleep) return false;
    const p = approach(bedRec);
    if (!send(a, p.x, p.z)) return false;
    keepRate(a);
    let ok = false;
    try { ok = !!CBZ.propSleep(a, bedRec); } catch (err) { ok = false; }
    if (!ok) giveRate(a);
    return ok;
  }
  function sit(a, seatRec) {
    if (busy(a) || inTransition(a) || !seatRec || seatRec.occupant || !CBZ.propSit) return false;
    const p = approach(seatRec);
    if (!send(a, p.x, p.z)) return false;
    keepRate(a);
    let ok = false;
    try { ok = !!CBZ.propSit(a, seatRec); } catch (err) { ok = false; }
    if (!ok) giveRate(a);
    return ok;
  }

  /* ---- THE FOOTPRINT. One box, read by the sweep that PREVENTS a body
       standing in a bed and by the count that MEASURES it, so the number
       defining the fault and the number fixing it can never drift apart. A
       game with bigger mattresses writes CBZ.rest.box once. ---- */
  const box = { hx: 0.52, hz: 1.18 };
  function inside(g, rec) {
    return Math.abs(g.x - rec.x) < box.hx && Math.abs(g.z - rec.z) < box.hz;
  }

  /* A MAN WHO GETS UP STANDS BESIDE THE BED, NOT IN IT. If the rise arc owns
     him it will move him and we keep our hands off; if it does not — and it
     does not on a reset, when everybody gets up on one frame — he is put on
     the bed's own entry point, the walkable side already solved for getting
     IN. Never invents a spot: with no solved entry it leaves him alone rather
     than pushing a body into a wall. */
  function stepOff(a, rec, skip) {
    if (!rec || !a || !a.group) return false;
    if (skip && skip(rec)) return false;
    if (inTransition(a)) return false;
    const g = a.group.position;
    if (!inside(g, rec)) return false;                 // already clear
    const e = entry(rec);
    if (!e) return false;
    g.x = e.x; g.z = e.z;
    if (a.target) a.target.set(e.x, 0, e.z);
    return true;
  }

  /* THE ONLY CORRECT WAY TO END A POSE: the pose verb, the walk rate back, the
     pause cleared and the body stepped clear of the bedding. */
  function up(a, instant, opts) {
    if (!a || (!a._propBed && !a._propSeat && !a._propLie)) return false;
    opts = opts || {};
    const rec = a._propBed;
    try {
      if (a._propBed) { if (CBZ.propWake) CBZ.propWake(a, instant ? { instant: true } : null); }
      else if (CBZ.propStand) CBZ.propStand(a, instant ? { instant: true } : null);
    } catch (e) {}
    giveRate(a);
    a.pause = 0;
    stepOff(a, rec, opts.skip);
    return true;
  }

  /* ---- THE SWEEP AND THE COUNT, ASKING THE SAME QUESTION ----------------
     Stepping each body off as it wakes is not enough: a body can be left
     inside a mattress it was never assigned — one it merely walked into, or
     the other rack of a stack it did not sleep on. Rather than enumerate those
     cases, the sweep asks exactly the question the ratchet asks. */
  function scan(list, actors, opts, move) {
    opts = opts || {};
    let n = 0;
    for (let i = 0; i < (actors || []).length; i++) {
      const a = actors[i];
      if (!a || a.dead || a._propLie || !a.group) continue;
      if (opts.eligible && !opts.eligible(a)) continue;
      const g = a.group.position;
      for (let k = 0; k < (list || []).length; k++) {
        const b = list[k];
        if (!b || (opts.skip && opts.skip(b))) continue;
        if (!inside(g, b)) continue;
        n++;
        if (move) {
          const e = entry(b);
          if (e) { g.x = e.x; g.z = e.z; if (a.target) a.target.set(e.x, 0, e.z); }
        }
        break;
      }
    }
    return n;
  }
  function sweep(list, actors, opts) { return scan(list, actors, opts, true); }
  function standers(list, actors, opts) { return scan(list, actors, opts, false); }

  /* ==========================================================
     5. THE CONTRACT
     ========================================================== */
  CBZ.rest = {
    // registration that survives load order
    ready: ready, defer: defer, bed: bed, seat: seat,
    // queries
    entry: entry, approach: approach, seatsIn: seatsIn,
    nearestBed: nearestBed, nearestSeat: nearestSeat, nearestFree: nearestFree,
    // precedence
    busy: busy, inTransition: inTransition, keepRate: keepRate, giveRate: giveRate,
    // verbs
    send: send, claim: claim, unclaim: unclaim, dropClaims: dropClaims,
    sleep: sleep, sit: sit, up: up,
    // the invariant
    box: box, inside: inside, stepOff: stepOff, sweep: sweep, standers: standers,
    audit: function () { return CBZ.restAudit(); },
  };

  // whatever else has not drained by the first tick drains here, so a page
  // that never calls ready() still gets its fittings
  if (CBZ.onUpdate) CBZ.onUpdate(23.9, function () { if (queued.length && haveReg()) ready(); });

  /* THE RATCHET. `standers` is the owner's sentence as a number, and it is
     reported per registered pool: a caller hands the audit its own beds and
     bodies through `CBZ.restWatch`, so this file needs to know nothing about
     any game to answer for all of them. */
  const watched = [];
  CBZ.restWatch = function (id, listFn, actorFn, opts) {
    watched.push({ id: id, list: listFn, actors: actorFn, opts: opts || null });
  };
  CBZ.restAudit = function () {
    let total = 0;
    const each = [];
    for (let i = 0; i < watched.length; i++) {
      const w = watched[i];
      let n = 0, places = 0, bodies = 0;
      try {
        const L = w.list() || [], A = w.actors() || [];
        places = L.length; bodies = A.length;
        n = standers(L, A, w.opts);
      } catch (e) { n = 0; }
      total += n;
      each.push({ id: w.id, places: places, bodies: bodies, standers: n });
    }
    return {
      on: CFG.REST_V1 !== false,
      registered: made, dupes: dupes, pending: queued.length, flushed: flushed,
      box: { hx: box.hx, hz: box.hz },
      watched: watched.length, standers: total, each: each,
    };
  };
})();

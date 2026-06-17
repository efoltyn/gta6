/* ============================================================
   city/fracture.js — STRUCTURAL WALL DAMAGE that PERSISTS. buildings.js owns
   the carve primitive (CBZ.cityCarveWall: hide the storey wall box, rebuild
   flank/sill/header remnants with real colliders + LOS, dress an interior
   inset + fractured rim); this file owns the POLICY:
     • blastAt(pt, r): explosions punch real holes (wired through the
       cityExplosion wrap in buildings.js) — debris pours through the wave-21
       facade avalanche, never a duplicate system;
     • chewWall(x,y,z): >25 rifle-class rounds inside one 1.2u wall cell
       quietly grind open a 1.1u murder hole — cover you MAKE, then shoot
       through (fpsmode's wall-hit branch feeds it);
     • caps: 24 live holes — overflow plywoods the OLDEST over
       (CBZ.cityBoardHole restores its colliders/LOS, frees the slot);
     • persistence: serialize()/apply()/applyOne() re-carve silently from a
       stable address {b: building key, face, u, v, r} — coordinate-keyed, so
       the ledger survives rng-draw-order drift across code versions;
     • onHole(hole) fires on every NEW local carve so the net layer can
       broadcast ({e:"frx", hole}); guests land them via applyOne.
   WHY: an RPG that permanently remodels a bank facade is money ON the wall,
   and holes the whole server keeps are the flex that outlives the fight.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const MAX_HOLES = 24;     // overflow: the oldest wound gets boarded over
  const CHEW_N = 25;        // heavy rounds into one cell to open a murder hole
  const CHEW_CELL = 1.2;    // wall-cell quantum (metres)
  const live = [];          // [{h:addr, rec}] un-boarded holes, oldest first
  const pending = [];       // ledger holes waiting for their wall to exist
  const chew = new Map();   // cellKey -> {n, t} heavy-round accumulation
  let lastX = 0, lastZ = 0, lastT = -1e9;   // last LOCAL carve (dedupes the legacy ground-breach pass)
  let applying = false;     // replaying a ledger — never re-broadcast

  // ---- DEFERRED LOCAL CARVE (the rocket-frame de-spike) ---------------------
  // The carve primitive (buildings.js carveHole) is a MONOLITH: it builds the
  // remnant colliders + markCollidersDirty AND the whole cosmetic remodel
  // (room shell, glass/roomDeco sweeps, fractured rim merge) inline in ONE call.
  // We can't split colliders from cosmetics without editing buildings.js (the
  // other session owns it), so we defer the ENTIRE carve by ONE frame for the
  // LOCAL player/C4 blast — at ~200ms/frame on the weak Mac that 1-frame slip
  // is inside the ~100-200ms audio-visual binding window (Nature srep05098), and
  // the boom + dust + scorch + shake + sound all already fire SYNCHRONOUSLY at
  // the call sites (cityExplosion/cityBreach), so the eye/ear bind the event NOW
  // and the geometry catches up next frame — exactly the BF/UE5 mesh-swap-masked
  // -by-particles pattern. KNOWN, accepted: a ≤1-frame COVER/LOS gap — the wall
  // is still solid for that one frame, which on a 5 FPS Mac is the same ~200ms a
  // player needs to even register the hole. recent() is still armed THIS frame
  // (below) so the legacy ground-breach pass never double-carves.
  // Flag-gated (CBZ.carveDefer, default true); off → the old inline carve.
  if (CBZ.carveDefer === undefined) CBZ.carveDefer = true;
  const deferQ = [];        // [{x,y,z,r,power,search}] one-shot local carves
  const DEFER_CELL = 1.4;   // collapse near-coincident blasts (anti double-carve)

  function nowS() { return performance.now() / 1000; }

  // ---- stable hole address -------------------------------------------------
  // b = rounded building-group origin (the lot centre — island lots included),
  // face = 0:-z 1:+z 2:-x 3:+x (the door-side convention), u = opening centre
  // along the face axis RELATIVE to the building origin, v = world height of
  // the opening centre, r = the carve radius. Coordinates, not rng order: the
  // city is seeded, but any code change reshuffles the draw stream — addresses
  // built from world positions replay correctly either way.
  function addrOf(rec, r) {
    const g = rec.gap;
    const uc = (g.u0 + g.u1) / 2, vc = (g.v0 + g.v1) / 2;
    return {
      b: Math.round(g.px) + "," + Math.round(g.pz),
      face: g.horiz ? (g.outS < 0 ? 0 : 1) : (g.outS < 0 ? 2 : 3),
      u: Math.round((uc - (g.horiz ? g.px : g.pz)) * 10) / 10,
      v: Math.round(vc * 10) / 10,
      r: Math.round(r * 100) / 100,
    };
  }

  // ledger a fresh carve: cap-evict (board the oldest), broadcast if local
  function adopt(rec, r, quiet) {
    const h = addrOf(rec, r);
    rec.addr = h;
    live.push({ h: h, rec: rec });
    if (live.length > MAX_HOLES) {
      const old = live.shift();
      if (CBZ.cityBoardHole) CBZ.cityBoardHole(old.rec);   // plywood: colliders/LOS back, slot freed
    }
    if (!quiet && !applying && CBZ.cityFracture.onHole) {
      try { CBZ.cityFracture.onHole(h); } catch (e) {}
    }
    return h;
  }

  // hole debris = the wave-22 facade RUIN (pooled chunks + dust sheeting down the
  // wall + a PERSISTENT rubble heap at the base + dangling rebar + a soot ring),
  // poured from the opening along its outward normal. The opening WIDTH drives
  // the rubble-pile size so a big carve drops a big heap.
  function debris(rec, power) {
    const g = rec.gap;
    const uc = (g.u0 + g.u1) / 2, vc = (g.v0 + g.v1) / 2;
    const x = g.horiz ? uc : g.fixed, z = g.horiz ? g.fixed : uc;
    const nx = g.horiz ? 0 : g.outS, nz = g.horiz ? g.outS : 0;
    const width = Math.max(1.0, g.u1 - g.u0);
    // cityWallRuin (crashfx.js) composes the whole REAL-blast read at once:
    // avalanche + rubble heap + rebar + soot ring + dust/smoke. Falls back to
    // the older avalanche, then the bare chunk burst, if a system is missing.
    if (CBZ.cityWallRuin) {
      CBZ.cityWallRuin(x + nx * 0.3, vc, z + nz * 0.3, nx, nz, { power: power, width: width, top: g.v1, bottom: g.v0 });
    } else if (CBZ.cityFacadeAvalanche) {
      CBZ.cityFacadeAvalanche(x + nx * 0.3, vc, z + nz * 0.3, nx, nz, Math.min(2.2, power));
    } else if (CBZ.cityChunk) {
      CBZ.cityChunk(x + nx * 0.4, vc, z + nz * 0.4, { count: 6, force: 4, dirx: nx, dirz: nz });
    }
  }

  // ---- blastAt: an explosion against a wall face carves a persistent hole --
  // pt = {x,y,z} (or a raycast hit w/ .point), radius scaled UP so a direct
  // rocket blows a ROOM-EXPOSING chunk out of the facade (owner-filmed: the old
  // hole read as a dimple). Composes with the scar/avalanche/breach flow — the
  // hole is the part that STAYS.
  //
  // REAL-DESTRUCTION SCALE-UP (carve gap width = r*2, vertical opening = ±r, so
  // the visible hole is a 2r square): an RPG/airstrike (power ≳1.3) now carves
  // r≈3.4–4.6 → a 7–9u-wide hole you read as a blown-open apartment; a grenade /
  // car-burst (power <1.3) carves r≈2.2 → a ~4.4u hole. The caller in
  // buildings.js still hands us a smaller r, so we floor it HERE (this file owns
  // the policy; buildings.js owns only the carve primitive).
  function blastAt(pt, radius, opts) {
    opts = opts || {};
    if (pt && pt.point) pt = pt.point;
    if (!pt || !CBZ.cityCarveWall || !CBZ.game || CBZ.game.mode !== "city") return null;
    const power = opts.power || 1.2;
    let r = Math.max(0.5, radius || 2.6);
    // floor the hole to a dramatic, room-exposing size by ordnance class
    const floor = power >= 1.3 ? Math.min(4.6, 3.4 + (power - 1.3) * 0.9) : 2.2;
    r = Math.max(r, floor);
    const py = pt.y == null ? 1.4 : pt.y;
    // SEARCH SCALES WITH THE BLAST. A blast rarely detonates exactly ON the wall
    // plane — a thrown grenade, a C4 on the kerb, an airstrike, or a rocket that
    // crosses the street a few units shy of a facade all sit OFF the wall. A flat
    // 3.2u search missed every one of those, so a blast clearly inside a building's
    // radius left the facade untouched (owner-filmed "building unaffected"). We now
    // reach out ~ the hole radius + a margin (capped so a huge airstrike can't grab
    // a wall half a block away and carve the WRONG building). cityCarveWall takes
    // the NEAREST wall within `search` at this height, so the closest facade wins.
    const search = opts.search != null ? opts.search : Math.min(8, Math.max(3.6, r + 1.4));
    // CORRECTNESS-CRITICAL, ALWAYS SYNCHRONOUS: arm recent() THIS frame so the
    // legacy ground-breach pass (buildings.js cityBreach → recent(x,z)) sees the
    // blast and never opens a SECOND hole in the same wall. This is independent
    // of whether the carve itself defers — the dedup must hold on the impact
    // frame either way. (It also primes the within-window double-carve guard.)
    lastX = pt.x; lastZ = pt.z; lastT = nowS();
    // DEFERRED PATH: enqueue the heavy carve to drain next frame. We can't return
    // the real hole-addr yet (no rec until the carve runs), so callers that need
    // it synchronously must keep the flag off — but the only caller is
    // structuralBlast, which ignores the return value (it just wants the hole to
    // appear). The net broadcast (onHole) still fires, just one frame later, off
    // the real rec, so guests land the SAME hole.
    if (CBZ.carveDefer && !opts.quiet) {
      enqueueDefer(pt.x, py, pt.z, r, power, search);
      return null;
    }
    // INLINE PATH (flag off, or a quiet/replay carve that must land NOW): exactly
    // the old behaviour.
    return carveNow(pt.x, py, pt.z, r, power, search, !!opts.quiet);
  }

  // the actual carve+ledger+debris — shared by the inline path and the deferred
  // drain. Re-resolves the wall from LIVE colliders every call, so if the
  // wall/arena changed (already breached, mode swapped, building gone) carveHole
  // returns null and we bail cleanly — a deferred carve self-cancels when stale.
  function carveNow(x, y, z, r, power, search, quiet) {
    // a wider collider search so a rocket landing a hair off the wall plane (or
    // exactly point-blank) still finds the wall and carves, instead of missing.
    const rec = CBZ.cityCarveWall(x, y, z, r, { search: search != null ? search : 3.2 });
    if (!rec) return null;
    const h = adopt(rec, r, quiet);
    if (!quiet) debris(rec, power);
    return h;
  }

  // queue a one-shot LOCAL carve, collapsing a near-coincident pending blast into
  // it (anti double-carve inside the 1-frame window: two rockets into the same
  // wall cell before the drain would otherwise carve twice — the wall isn't
  // _breached yet so carveHole wouldn't reject the second). Keep the bigger blast.
  function enqueueDefer(x, y, z, r, power, search) {
    for (let i = 0; i < deferQ.length; i++) {
      const d = deferQ[i];
      if (Math.abs(d.x - x) < DEFER_CELL && Math.abs(d.y - y) < DEFER_CELL && Math.abs(d.z - z) < DEFER_CELL) {
        if (r > d.r) { d.r = r; d.power = Math.max(d.power, power); }   // upgrade to the larger hole
        return;
      }
    }
    deferQ.push({ x: x, y: y, z: z, r: r, power: power, search: search });
  }

  // drain the deferred local carves — runs every frame (the rocket-frame de-spike
  // relies on this landing the carve on the VERY NEXT frame, not 0.5s later like
  // the networked replay drain). Early-outs instantly when the queue is empty, so
  // it costs nothing in the steady state. Guards mode + colliders so a carve that
  // outlived its arena (mode exit / run reset mid-window) self-cancels.
  function drainDefer() {
    if (!deferQ.length) return;
    if (!CBZ.cityCarveWall || !CBZ.game || CBZ.game.mode !== "city" || !CBZ.colliders || !CBZ.colliders.length) {
      deferQ.length = 0; return;        // arena gone — drop the stale carves
    }
    const todo = deferQ.splice(0, deferQ.length);
    for (let i = 0; i < todo.length; i++) {
      const d = todo[i];
      // adopt() stays un-quiet → onHole still broadcasts this LOCAL hole to
      // guests (one frame late, off the real rec, same address) — net-correct.
      try { carveNow(d.x, d.y, d.z, d.r, d.power, d.search, false); } catch (e) {}
    }
  }

  // did a fracture carve just land here? (buildings.js cityBreach asks, so the
  // SAME rocket doesn't open a second hole through the legacy ground pass)
  function recent(x, z) {
    if (nowS() - lastT > 0.6) return false;
    const dx = x - lastX, dz = z - lastZ;
    return dx * dx + dz * dz < 64;
  }

  // ---- murder holes: sustained heavy fire grinds through concrete ----------
  function prune(t) { chew.forEach(function (c, k) { if (t - c.t > 14) chew.delete(k); }); }
  function chewWall(x, y, z) {
    if (!CBZ.cityCarveWall || !CBZ.game || CBZ.game.mode !== "city") return null;
    const k = Math.round(x / CHEW_CELL) + "," + Math.round(y / CHEW_CELL) + "," + Math.round(z / CHEW_CELL);
    const t = nowS();
    let c = chew.get(k);
    if (!c) { if (chew.size > 64) prune(t); c = { n: 0, t: t }; chew.set(k, c); }
    if (t - c.t > 14) c.n = 0;          // sustained fire only — cold cells reset
    c.t = t; c.n++;
    if (c.n < CHEW_N) return null;
    chew.delete(k);
    const rec = CBZ.cityCarveWall(x, Math.max(0.6, y), z, 0.55, { search: 1.2 });
    if (!rec) return null;
    lastX = x; lastZ = z; lastT = t;
    const h = adopt(rec, 0.55, false);
    // ground out, not blown out: a quiet crumble of chunks, no boom
    const g = rec.gap, nx = g.horiz ? 0 : g.outS, nz = g.horiz ? g.outS : 0;
    if (CBZ.cityChunk) CBZ.cityChunk(x + nx * 0.3, y, z + nz * 0.3, { count: 3, force: 2, dirx: nx, dirz: nz });
    return h;
  }

  // ---- persistence ----------------------------------------------------------
  function serialize() {
    const h = [];
    for (let i = 0; i < live.length; i++) h.push(live[i].h);
    return { v: 1, h: h };
  }
  function has(h) {
    for (let i = 0; i < live.length; i++) {
      const o = live[i].h;
      if (o.b === h.b && o.face === h.face && Math.abs(o.u - h.u) < 0.6 && Math.abs(o.v - h.v) < 0.8) return true;
    }
    for (let i = 0; i < pending.length; i++) { // a dupe can land while the original still queues
      const o = pending[i];
      if (o.b === h.b && o.face === h.face && Math.abs(o.u - h.u) < 0.6 && Math.abs(o.v - h.v) < 0.8) return true;
    }
    return false;
  }
  // resolve an address back to a world point on a CURRENT wall box (remnants
  // of earlier replayed holes included, so stacked holes re-carve in order)
  function resolve(h) {
    const cols = CBZ.colliders;
    if (!cols || !cols.length) return null;
    let best = null, bs = 1e9;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.y1 == null || !c.ref) continue;
      if (h.v < c.y0 - 0.4 || h.v > c.y1 + 0.4) continue;
      if (c.y1 - c.y0 < 1.0) continue;
      const ex = c.maxX - c.minX, ez = c.maxZ - c.minZ;
      if (Math.min(ex, ez) > 0.9) continue;                 // walls only
      const mt = c.ref.material; if (mt && mt.transparent) continue;
      const p = c.ref.parent;
      const px = p ? p.position.x : 0, pz = p ? p.position.z : 0;
      if (Math.round(px) + "," + Math.round(pz) !== h.b) continue;
      const horiz = ex >= ez;
      const fixed = horiz ? (c.minZ + c.maxZ) / 2 : (c.minX + c.maxX) / 2;
      const cOff = horiz ? fixed - pz : fixed - px;
      const face = horiz ? (cOff < 0 ? 0 : 1) : (cOff < 0 ? 2 : 3);
      if (face !== h.face) continue;
      const u = (horiz ? px : pz) + h.u;
      const minU = horiz ? c.minX : c.minZ, maxU = horiz ? c.maxX : c.maxZ;
      const s = u < minU ? minU - u : (u > maxU ? u - maxU : 0);   // distance outside the box extent
      if (s < bs) {
        bs = s;
        best = { x: horiz ? u : fixed, z: horiz ? fixed : u, y: Math.max(c.y0 + 0.3, Math.min(c.y1 - 0.3, h.v)) };
      }
    }
    return bs <= 0.5 ? best : null;
  }
  function drain() {
    if (!pending.length || !CBZ.cityCarveWall || !CBZ.colliders || !CBZ.colliders.length) return;
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    const todo = pending.splice(0, pending.length);
    for (let i = 0; i < todo.length; i++) {
      const h = todo[i];
      const pt = resolve(h);
      if (!pt) {
        h._tr = (h._tr || 0) + 1;
        if (h._tr < 40) pending.push(h);    // city still building — retry on the tick
        continue;
      }
      applying = true;
      try {
        const rec = CBZ.cityCarveWall(pt.x, pt.y, pt.z, h.r || 1.2, { search: 1.6 });
        if (rec) adopt(rec, h.r || 1.2, true);
      } catch (e) {}
      applying = false;
    }
  }
  // re-carve one hole silently (guests get these over the wire; loads replay them)
  function applyOne(h) {
    if (!h || h.b == null || has(h)) return;
    pending.push({ b: h.b, face: h.face, u: h.u, v: h.v, r: h.r });
    drain();
  }
  function apply(led) {
    if (!led) return;
    const arr = led.h || led;
    if (!arr || !arr.length) return;
    for (let i = 0; i < arr.length; i++) applyOne(arr[i]);
  }

  // run-reset hook (buildings.js resetBreaches restored every wall already).
  // Also drop any in-flight deferred carves — their target walls just got reset,
  // so draining them next frame would carve into a fresh arena (stale).
  function cleared() { live.length = 0; pending.length = 0; chew.clear(); deferQ.length = 0; lastT = -1e9; }

  // pending replays retry at 2Hz until their walls exist (drain early-outs
  // when the queue is empty, so this costs nothing in the steady state)
  let acc = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(8.6, function (dt) {
    if (!pending.length || CBZ.game.mode !== "city") return;
    acc += dt; if (acc < 0.5) return; acc = 0;
    drain();
  });

  // DEFERRED LOCAL CARVE drain — EVERY frame (the de-spike depends on the carve
  // landing on the very next frame, not the 0.5s replay cadence above). The work
  // that ballooned the rocket frame (~200→350ms) now runs on the frame AFTER the
  // boom, off the impact frame's critical path. Early-outs when the queue is
  // empty (steady-state cost ≈ one length check), and self-cancels if the arena
  // vanished mid-window. Kept SEPARATE from the networked `pending`/drain() path
  // so neither can corrupt the other. Order 8.55 → runs just before the replay
  // drain, deterministically, within the same frame batch.
  if (CBZ.onUpdate) CBZ.onUpdate(8.55, function () {
    if (!deferQ.length) return;
    drainDefer();
  });

  CBZ.cityFracture = {
    blastAt: blastAt,
    chewWall: chewWall,
    serialize: serialize,
    apply: apply,
    applyOne: applyOne,
    onHole: null,            // net layer assigns: fn(hole) on every NEW local carve
    recent: recent,
    _adopt: function (rec, r) { return adopt(rec, r || (rec.gap ? (rec.gap.u1 - rec.gap.u0) / 2 : 1.6), false); },
    _cleared: cleared,
  };
})();

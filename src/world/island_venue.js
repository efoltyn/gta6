/* ============================================================
   world/island_venue.js — WHAT AN ISLAND BUILDING IS FOR, MADE REAL.

   Every lot of an archipelago island has a use (world/island_plan.js
   assignUses: "guns", "pawn", "jewelry", "bank", "police", "motel", ...),
   carried on its building record as b.use. This file is the one seam the
   venue code (the gun store, the pawn shop, the bank ...) builds on:

     CBZ.islandVenue.on(use, fn(b, lot, job) -> dispose?)
         a fit-out for every building of that use. It runs when an island
         that has one is built (after its walls joined the world, before it
         is shown: nothing pops in view), and its dispose runs when the
         island is taken down. Registered late, it also runs on the islands
         already standing. Everything the fit-out pushes onto a shared CBZ
         list (colliders, platforms, sight blockers, frame hooks) leaves with
         the island by itself; build meshes under b.group (lot.building.lbox
         does) or the island's root.
     CBZ.islandVenue.list(use?)   the live buildings of that use (all
         islands standing now), or every one with a use
     CBZ.islandVenue.lotFor(b)    a Gang-City-shaped lot for building b:
         { x, z, w, d, use, name, island, b,
           building: { door:{x,z,nx,nz} (nx/nz INWARD, the city's way),
                       floorTops (local), lbox, w, d, wt,
                       ox, oz, gy, group, rotY, interior } }
         lbox(lx, ly, lz, w, h, d, colour, {solid, los, plat, cast, outside})
         draws a box in the building's own frame (door on local -z) and
         registers it like city/buildings.js's does.
     CBZ.islandVenue.floor(b, k)  storey k: { y (world floor top), local
         {x0,x1,z0,z1}, bounds (world AABB), keepOut (local rects: the stair
         strip, the door band on the ground floor), keepOutWorld,
         toWorld(lx, lz) -> {x, z}, toLocal(x, z), yaw }
     CBZ.islandVenue.clear(b, k)  takes storey k's default furniture out
         (the house's sofa, table, rug, bookcase, the lamps and the pendant
         over the table; a tower lobby's seats): its triangles, its colliders
         and its drop-cover-hold-on covers. A shop fit-out calls it first: no
         sofa in a gun store. On the ground floor it also walls the stair
         off (stairwell below): the shop is one room, the flats upstairs keep
         their stair.
     CBZ.islandVenue.stairwell(b) -> { face, door } | null   the house stair
         behind a wall: a full-height partition along the stair strip's room
         edge, painted like the room, with the residents' doorway at the foot
         of the stair (the front end, by the street door) and its door
         standing open inside. Its room-side face (building-local x) is
         where a shop's room starts. Once per building; a narrow building
         whose stair strip runs into the street door's band keeps it open.
     CBZ.islandVenue.claim(b, k, rect)   a venue's floor space (building-
         local), so the dressing (world/island_fitkit.js dress) keeps off it
     CBZ.islandVenue.island(b)    the island record (CBZ.island shape) b is on
     CBZ.islandVenue.staff(b, lx, lz, face, opts)   a worker posted on b's
         ground floor (the clerk behind a counter); see THE PEOPLE WHO WORK
         THERE below
     CBZ.islandVenue.on("*", fn)  a pass for EVERY building that has a use,
         run after that building's own fit-outs (city/islandmoney.js puts a
         safe in each one this way, so no venue has to ask for one)
     CBZ.islandVenue.has(use)     does that use have a fit-out of its own

   Disaster mode never reaches this file: its island has no uses.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};

  const fits = new Map();          // use -> [fn]
  const live = new Set();          // the jobs whose venues are fitted

  function IB() { return CBZ.islandBuilding || { FH: 3.2, WT: 0.25, DOORW: 1.4 }; }
  function islandOf(job) { return job && job.arena ? (job.arena.island || null) : null; }
  function recordsOf(job) {
    const I = islandOf(job);
    if (!I) return [];
    return (I.buildings || []).concat(I.sites || []);
  }
  function jobOf(b) {
    for (const j of live) { const I = islandOf(j); if (I && ((I.buildings || []).indexOf(b) >= 0 || (I.sites || []).indexOf(b) >= 0)) return j; }
    return null;
  }

  /* ---- THE BUILDING'S FRAME: rotation.y = yaw sends local -z to
     (-sin yaw, -cos yaw); quarter turns only, so boxes stay boxes. ---- */
  function frame(b) {
    const y = b.rotY || 0, co = Math.cos(y), si = Math.sin(y);
    return {
      yaw: y,
      toWorld: function (lx, lz) { return { x: b.ox + lx * co + lz * si, z: b.oz - lx * si + lz * co }; },
      toLocal: function (x, z) { const dx = x - b.ox, dz = z - b.oz; return { x: dx * co - dz * si, z: dx * si + dz * co }; },
      rect: function (r) {
        const a = this.toWorld(r.x0, r.z0), c = this.toWorld(r.x1, r.z1);
        return { x0: Math.min(a.x, c.x), x1: Math.max(a.x, c.x), z0: Math.min(a.z, c.z), z1: Math.max(a.z, c.z) };
      },
    };
  }
  // storey k's floor top, building-local (see the interior record's fyOf:
  // [ground, floor-to-floor, offset on the upper floors])
  function floorLocal(b, k) {
    const I = b.interior || {}, f = I.fyOf;
    k = k | 0;
    if (!f) return k === 0 ? (b.floorTop != null ? b.floorTop - b.gy : 0.08) : k * IB().FH;
    if (k === 0) return f[0];
    return k * (f[1] || IB().FH) + (f[2] || 0);
  }

  /* ---- lbox: one box in the building's frame ------------------------------ */
  const mats = new Map();
  function matOf(col) {
    let m = mats.get(col);
    if (m) return m;
    m = new THREE.MeshLambertMaterial({ color: col });
    m.name = "island-venue";
    m._shared = true;          // one per colour for the session: an island leaving keeps it
    mats.set(col, m);
    return m;
  }
  const boxGeo = { g: null };
  function unitBox() {
    if (!boxGeo.g) { boxGeo.g = new THREE.BoxGeometry(1, 1, 1); boxGeo.g._shared = true; }
    return boxGeo.g;
  }
  function makeLbox(b) {
    const F = frame(b);
    return function (lx, ly, lz, w, h, d, col, o) {
      o = o || {};
      const m = new THREE.Mesh(unitBox(), matOf(col == null ? 0x8a8f95 : col));
      m.scale.set(w, h, d);
      m.position.set(lx, ly, lz);
      m.castShadow = o.cast !== false; m.receiveShadow = true;
      m.name = "island-venue-box";
      b.group.add(m);
      // inside things sleep with the rooms (disaster_arena's 4 Hz LOD pass)
      if (!o.outside) {
        const ud = b.group.userData;
        (ud.rooms || (ud.rooms = [])).push(m);
        if (ud.roomsOn === false) m.visible = false;
      }
      const quarter = Math.abs(Math.round(Math.sin(F.yaw))) === 1;
      const c = F.toWorld(lx, lz), hw = (quarter ? d : w) / 2, hd = (quarter ? w : d) / 2;
      if (o.solid) {
        const rec = { minX: c.x - hw, maxX: c.x + hw, minZ: c.z - hd, maxZ: c.z + hd, ref: m, y0: b.gy + ly - h / 2, y1: b.gy + ly + h / 2 };
        if (CBZ.colliderAddMany) CBZ.colliderAddMany([rec]); else (CBZ.colliders || (CBZ.colliders = [])).push(rec);
        if (b.colliders) b.colliders.push(rec);
      }
      if (o.plat) {
        const p = { minX: c.x - hw, maxX: c.x + hw, minZ: c.z - hd, maxZ: c.z + hd, top: b.gy + ly + h / 2 };
        if (CBZ.platformAddMany) CBZ.platformAddMany([p]); else (CBZ.platforms || (CBZ.platforms = [])).push(p);
        if (!CBZ.platformAddMany && CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
      }
      if (o.los) (CBZ.losBlockers || (CBZ.losBlockers = [])).push(m);
      return m;
    };
  }

  function lotFor(b) {
    if (!b) return null;
    if (b._venueLot) return b._venueLot;
    const ib = IB(), F = frame(b);
    const lw = b.lw || b.w, ld = b.ld || b.d;
    const door = F.toWorld(0, -ld / 2);
    const tops = [];
    for (let k = 0; k < Math.max(1, b.storeys || 1); k++) tops.push(floorLocal(b, k));
    const job = jobOf(b);
    const lot = {
      x: b.x, z: b.z, w: b.w, d: b.d, use: b.use || null, name: b.name || null, b: b,
      island: job ? islandOf(job) : null,
      building: {
        // the INWARD normal (from the street into the room), Gang City's
        // convention (city/buildings.js lot.building.door)
        door: { x: door.x, z: door.z, nx: Math.sin(F.yaw), nz: Math.cos(F.yaw) },
        floorTops: tops, lbox: makeLbox(b), w: lw, d: ld, wt: ib.WT,
        ox: b.ox, oz: b.oz, gy: b.gy, group: b.group, rotY: F.yaw, interior: b.interior || null,
        storeys: b.storeys || 1, name: b.name || null, use: b.use || null,
      },
    };
    b._venueLot = lot;
    return lot;
  }

  function floor(b, k) {
    k = k | 0;
    const F = frame(b), I = b.interior || {};
    const ib = IB();
    const local = { x0: I.x0 != null ? I.x0 : -(b.lw || b.w) / 2 + ib.WT, x1: I.x1 != null ? I.x1 : (b.lw || b.w) / 2 - ib.WT,
      z0: I.z0 != null ? I.z0 : -(b.ld || b.d) / 2 + ib.WT, z1: I.z1 != null ? I.z1 : (b.ld || b.d) / 2 - ib.WT };
    // the ground floor's plan is the record's; up the house the stair strip
    // stays, the door band does not
    let keep = (I.keepOut || []).slice();
    if (k > 0) keep = keep.filter(function (r) { return r.why === "stairs" || r.why === "lift"; });
    return {
      k: k, y: b.gy + floorLocal(b, k), yLocal: floorLocal(b, k), local: local, bounds: F.rect(local),
      keepOut: keep, keepOutWorld: keep.map(function (r) { return Object.assign(F.rect(r), { why: r.why }); }),
      toWorld: F.toWorld, toLocal: F.toLocal, yaw: F.yaw,
    };
  }

  /* ---- THE STAIRWELL: the house stair behind a wall ---------------------- */
  function stairwell(b) {
    if (!b || b._stairwell !== undefined) return b ? b._stairwell : null;
    b._stairwell = null;
    const I = b.interior, S = I && I.stair;
    if (!S || I.kind !== "house" || !b.group) return null;
    const ib = IB(), T = 0.12;
    const xw = S.sEdge + 0.2, face = xw + T / 2;
    // the street door's band (and its leaves hooked back inside) stays clear
    if (face > -((ib.DOORW || 1.8) / 2) - 0.3) return null;
    const fy = floorLocal(b, 0), top = S.ceil != null ? S.ceil : ib.FH - 0.2;
    const z0 = S.izMin, z1 = S.izMax;
    const dz0 = z0 + 0.2, dz1 = dz0 + 1.0, DH = 2.12;     // the doorway, at the foot of the stair
    const paint = I.paint != null ? I.paint : 0xe4ded2, trim = 0xf1eee6, leaf = 0x6b5a48;
    const FIT = CBZ.islandFit;
    const K = FIT && FIT.kit ? FIT.kit(b, { name: "stairwell", los: true }) : null;
    const box = K ? function (lx, ly, lz, w, h, d, col, o) { return K.lbox(lx, ly, lz, w, h, d, col, o); }
      : (function () { const lb = lotFor(b).building.lbox; return function (lx, ly, lz, w, h, d, col, o) { return lb(lx, ly, lz, w, h, d, col, o); }; })();
    const H = top - fy;
    // the wall either side of the doorway, and over it
    box(xw, fy + H / 2, (z0 + dz0) / 2, T, H, dz0 - z0, paint, { solid: true });
    box(xw, fy + H / 2, (dz1 + z1) / 2, T, H, z1 - dz1, paint, { solid: true });
    box(xw, fy + DH + (H - DH) / 2, (dz0 + dz1) / 2, T, H - DH, dz1 - dz0, paint);
    // skirting along the room side, the casing round the doorway
    box(face + 0.006, fy + 0.05, (dz1 + z1) / 2, 0.012, 0.1, z1 - dz1, 0xcfc8ba);
    for (const z of [dz0 - 0.035, dz1 + 0.035]) box(face + 0.01, fy + DH / 2, z, 0.02, DH, 0.07, trim);
    box(face + 0.01, fy + DH + 0.035, (dz0 + dz1) / 2, 0.02, 0.07, dz1 - dz0 + 0.14, trim);
    box(xw, fy - 0.002, (dz0 + dz1) / 2, T + 0.04, 0.012, dz1 - dz0, 0x8a8478);          // the threshold
    // the door, open: swung back inside against the wall (the stair side)
    box(xw - T / 2 - 0.025, fy + 0.03 + 1.02, dz1 + 0.49, 0.04, 2.04, 0.92, leaf);
    box(xw - T / 2 - 0.05, fy + 1.0, dz1 + 0.88, 0.02, 0.03, 0.12, 0xc8ccd2);
    if (K) K.flush();
    b._stairwell = { face: face, x: xw, door: { z0: dz0, z1: dz1 } };
    return b._stairwell;
  }

  // a venue's floor space, kept clear by the dressing and the money pass
  function claim(b, k, r) {
    if (!b || !r) return;
    (b._claims || (b._claims = [])).push({ k: k | 0, x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1 });
  }

  // fold storey k's furniture away (see disaster_arena.js furnEnd)
  function clear(b, k) {
    k = k | 0;
    const I = b && b.interior;
    if (k === 0 && I && I.stair) { try { stairwell(b); } catch (e) { console.error("[island stairwell]", e); } }
    if (!I || !I.furn) return false;
    const recs = I.furn.filter(function (r) { return r.L === k && !r.cleared; });
    if (!recs.length) return true;
    const meshes = {};
    for (const o of b.group.children) {
      if (o.isMesh && o.name && o.name.indexOf("island-interior-") === 0) meshes[o.name.slice(16)] = o;
    }
    const dropCols = [];
    for (const r of recs) {
      for (const key in r.runs) {
        const m = meshes[key];
        const idx = m && m.geometry && m.geometry.index;
        if (!idx) continue;
        const a = r.runs[key][0], z = Math.min(r.runs[key][1], idx.count), arr = idx.array;
        if (z <= a) continue;
        // degenerate: every triangle of the run collapses onto one vertex
        const v = arr[a];
        for (let i = a; i < z; i++) arr[i] = v;
        idx.needsUpdate = true;
      }
      for (const c of r.cols) dropCols.push(c);
      if (I.covers) for (const cv of r.covers) { const i = I.covers.indexOf(cv); if (i >= 0) I.covers.splice(i, 1); }
      r.cleared = true;
    }
    if (dropCols.length) {
      if (CBZ.colliderRemoveMany) CBZ.colliderRemoveMany(dropCols);
      else for (const c of dropCols) { const i = CBZ.colliders.indexOf(c); if (i >= 0) CBZ.colliders.splice(i, 1); }
      if (b.colliders) { const s = new Set(dropCols); let w = 0; for (const c of b.colliders) if (!s.has(c)) b.colliders[w++] = c; b.colliders.length = w; }
      // (colliderRemoveMany keeps the grid; a dirty mark was a full rebuild)
      if (!CBZ.colliderRemoveMany && CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    return true;
  }

  /* ---- THE LIFECYCLE ------------------------------------------------------
     One fit-out at a time under a census of the shared CBZ lists (the same
     measure disaster_arena.js's islandBuild takes of a build slice): what a
     fit-out appended is the island's, and its dispose takes it back. */
  // (CBZ.listMarks / listGained, world/disaster_arena.js: a fit-out that
  // clears a room's furniture out of CBZ.colliders before it stands its own
  // is still measured right)
  function census() { return CBZ.listMarks(); }
  function settle(job, marks) {
    for (const m of marks) {
      const got = CBZ.listGained(m);
      if (!got) continue;
      let L = job.buses.get(m.arr);
      if (!L) job.buses.set(m.arr, (L = []));
      for (let i = 0; i < got.length; i++) L.push(got[i]);
    }
    // a list the fit-out CREATED is all the island's
    for (const v of CBZ.listNew(marks)) {
      let L = job.buses.get(v);
      if (!L) job.buses.set(v, (L = []));
      for (let i = 0; i < v.length; i++) L.push(v[i]);
    }
  }
  /* A FIT-OUT MAY BE A GENERATOR (function*): it yields between its
     fixtures (a floor of desks, a shelf of goods) and returns its dispose.
     fitSteps runs it a step at a time, one census a step (nothing else runs
     inside a step, so what the lists gained is the fit-out's); run anywhere
     else (a fit-out registered while islands stand) it runs to the end. */
  function isIter(x) { return !!x && typeof x.next === "function" && typeof x[Symbol.iterator] === "function"; }
  function* runOneSteps(job, b, fn) {
    let marks = job.buses ? census() : null;
    let undo = null, it = null;
    try { undo = fn(b, lotFor(b), job); if (isIter(undo)) { it = undo; undo = null; } }
    catch (e) { console.error("[island venue " + (b.use || "?") + "]", e); }
    finally { if (marks) settle(job, marks); }
    while (it) {
      yield 0;
      if (job.disposed) { try { it.return(); } catch (e) {} break; }
      marks = job.buses ? census() : null;
      let r = null;
      try { r = it.next(); }
      catch (e) { console.error("[island venue " + (b.use || "?") + "]", e); it = null; }
      finally { if (marks) settle(job, marks); }
      if (r && r.done) { undo = r.value; it = null; }
    }
    if (typeof undo === "function") (job._venueUndo || (job._venueUndo = [])).push(undo);
  }
  function runOne(job, b, fn) {
    const go = function () { const it = runOneSteps(job, b, fn); for (let r = it.next(); !r.done; r = it.next()) {} };
    if (CBZ.sliceSync) CBZ.sliceSync(go); else go();
  }
  function* fitSteps(job) {
    if (!job || !job.arena || job.disposed || live.has(job)) return;
    live.add(job);
    for (const b of recordsOf(job)) {
      const fns = b && b.use ? fits.get(b.use) : null;
      const all = b && b.use ? fits.get("*") : null;
      if ((!fns || !fns.length) && (!all || !all.length)) continue;
      if (fns) for (const fn of fns.slice()) { yield* runOneSteps(job, b, fn); if (CBZ.sliceLate && CBZ.sliceLate()) yield 0; }
      if (all) for (const fn of all.slice()) { yield* runOneSteps(job, b, fn); if (CBZ.sliceLate && CBZ.sliceLate()) yield 0; }
      if (job.disposed) return;
    }
    // (no blanket markCollidersDirty: every fit-out files its records
    // through colliderAddMany / colliderRemoveMany, which keep the grid as a
    // rebuild would make it; a dirty mark here rebuilt every wall on the sea
    // in one frame, just as the island arrived)
  }
  function drop(job) {
    const it = dropSteps(job);
    for (let r = it.next(); !r.done; r = it.next()) {}
  }
  // the same, on the slice clock (world/disaster_arena.js islandDisposeSteps)
  function* dropSteps(job) {
    if (!job || !live.has(job)) return;
    live.delete(job);
    const U = job._venueUndo || [];
    job._venueUndo = null;
    for (let i = U.length - 1; i >= 0; i--) {
      try { U[i](); } catch (e) { console.error("[island venue dispose]", e); }
      if (CBZ.sliceLate && CBZ.sliceLate()) yield 0;
    }
    for (const b of recordsOf(job)) if (b) { b._venueLot = null; b._stairwell = undefined; b._claims = null; b._posts = null; }
  }
  function on(use, fn) {
    if (!use || typeof fn !== "function") return;
    const l = fits.get(use) || [];
    l.push(fn);
    fits.set(use, l);
    // the islands already standing get it now
    for (const job of live) for (const b of recordsOf(job)) if (b && b.use && (use === "*" || b.use === use)) runOne(job, b, fn);
  }
  function has(use) { const l = fits.get(use); return !!(l && l.length); }
  function list(use) {
    const out = [];
    for (const job of live) for (const b of recordsOf(job)) if (b && b.use && (!use || b.use === use)) out.push(b);
    return out;
  }
  function island(b) { const j = jobOf(b); return j ? islandOf(j) : null; }

  /* ---- THE PEOPLE WHO WORK THERE ------------------------------------------
     staff(b, lx, lz, face, opts) -> post
         a worker posted at (lx, lz) on b's ground floor (building frame),
         facing local yaw `face` (0 = local +z, into the room from the door):
         the clerk behind a shop counter. He is one of the island's people,
         Gang City's street crowd (world/island_people.js post: a city ped
         held on his spot): a gun drawn on him puts his hands up, he can be
         robbed, threatened, grabbed and killed like anybody, and he speaks
         over his head. He is stood where nobody is looking while his shop is
         open and you are near, walks out of his door and home at closing,
         and one who was KILLED stays dead (post.lost) until the island is
         built again. He leaves with the island.
           opts: { job ("clerk"), look: fn(post, ped, dt) -> {x, z} | null
                   (who he faces), armed (default: the trades that keep a
                   gun under the counter) }
           post.body() -> the living body or null; post.x/z/face (world)  */
  function staff(b, lx, lz, face, opts) {
    const PP = CBZ.islandPeople;
    if (!b || !PP || !PP.post) return null;
    const post = PP.post(b, { lx: lx, lz: lz, face: face || 0 }, opts || {});
    // where he stands is his: nothing is dressed over his spot
    (b._posts || (b._posts = [])).push({ k: (opts && opts.k) | 0, lx: lx, lz: lz });
    const job = jobOf(b);
    if (post && job) (job._venueUndo || (job._venueUndo = [])).push(function () { PP.unpost(post); });
    return post;
  }

  CBZ.islandVenue = { on: on, list: list, lotFor: lotFor, floor: floor, clear: clear, island: island,
    staff: staff, fitSteps: fitSteps, drop: drop, dropSteps: dropSteps, has: has, stairwell: stairwell, claim: claim };
})();

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
           building: { door:{x,z,nx,nz}, floorTops (local), lbox, w, d, wt,
                       ox, oz, gy, group, rotY, interior } }
         lbox(lx, ly, lz, w, h, d, colour, {solid, los, plat, cast, outside})
         draws a box in the building's own frame (door on local -z) and
         registers it like city/buildings.js's does.
     CBZ.islandVenue.floor(b, k)  storey k: { y (world floor top), local
         {x0,x1,z0,z1}, bounds (world AABB), keepOut (local rects: the stair
         strip, the door band on the ground floor), keepOutWorld,
         toWorld(lx, lz) -> {x, z}, toLocal(x, z), yaw }
     CBZ.islandVenue.clear(b, k)  takes storey k's default furniture out
         (the house's sofa, table and bookcase, a tower lobby's seats): its
         triangles, its colliders and its drop-cover-hold-on covers. A shop
         fit-out calls it first: no sofa in a gun store.
     CBZ.islandVenue.island(b)    the island record (CBZ.island shape) b is on
     CBZ.islandVenue.staff(b, lx, lz, face, opts)   a worker posted on b's
         ground floor (the clerk behind a counter); see THE PEOPLE WHO WORK
         THERE below

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
        if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
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
        door: { x: door.x, z: door.z, nx: -Math.sin(F.yaw), nz: -Math.cos(F.yaw) },
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

  // fold storey k's furniture away (see disaster_arena.js furnEnd)
  function clear(b, k) {
    k = k | 0;
    const I = b && b.interior;
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
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    return true;
  }

  /* ---- THE LIFECYCLE ------------------------------------------------------
     One fit-out at a time under a census of the shared CBZ lists (the same
     measure disaster_arena.js's islandBuild takes of a build slice): what a
     fit-out appended is the island's, and its dispose takes it back. */
  function census() {
    const marks = [], seen = new Set();
    for (const k in CBZ) { const v = CBZ[k]; if (Array.isArray(v) && !seen.has(v)) { seen.add(v); marks.push({ arr: v, n: v.length }); } }
    return marks;
  }
  function settle(job, marks) {
    for (const m of marks) {
      if (m.arr.length <= m.n) continue;
      let L = job.buses.get(m.arr);
      if (!L) job.buses.set(m.arr, (L = []));
      for (let i = m.n; i < m.arr.length; i++) L.push(m.arr[i]);
    }
  }
  function runOne(job, b, fn) {
    const marks = job.buses ? census() : null;
    let undo = null;
    try { undo = fn(b, lotFor(b), job); }
    catch (e) { console.error("[island venue " + (b.use || "?") + "]", e); }
    finally { if (marks) settle(job, marks); }
    if (typeof undo === "function") (job._venueUndo || (job._venueUndo = [])).push(undo);
  }
  function* fitSteps(job) {
    if (!job || !job.arena || job.disposed || live.has(job)) return;
    live.add(job);
    for (const b of recordsOf(job)) {
      const fns = b && b.use ? fits.get(b.use) : null;
      if (!fns || !fns.length) continue;
      for (const fn of fns.slice()) runOne(job, b, fn);
      yield 0;
    }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  function drop(job) {
    if (!job || !live.has(job)) return;
    live.delete(job);
    const U = job._venueUndo || [];
    job._venueUndo = null;
    for (let i = U.length - 1; i >= 0; i--) { try { U[i](); } catch (e) { console.error("[island venue dispose]", e); } }
    for (const b of recordsOf(job)) if (b) b._venueLot = null;
  }
  function on(use, fn) {
    if (!use || typeof fn !== "function") return;
    const l = fits.get(use) || [];
    l.push(fn);
    fits.set(use, l);
    // the islands already standing get it now
    for (const job of live) for (const b of recordsOf(job)) if (b && b.use === use) runOne(job, b, fn);
  }
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
         the clerk behind a shop counter. He is one of the island's own
         people (entities/survivorbot.js) holding his spot (bot.post), so a
         gun fired in the shop hits him, a killing sends him running, and he
         speaks over his head like anybody. He is stood where nobody is
         looking (systems/leave.js unseen) while his island is the one in
         force; the crowd swept by an island change is stood again the same
         way; one who was KILLED stays dead (post.lost) until the island is
         built again. He leaves with the island.
           opts: { job ("clerk"), look: fn() -> {x, z} | null (who he faces) }
           post.body() -> the living body or null; post.x/z/face (world)  */
  const posts = new Set();
  function staff(b, lx, lz, face, opts) {
    if (!b) return null;
    opts = opts || {};
    const F = frame(b), w = F.toWorld(lx, lz);
    const post = {
      b: b, x: w.x, z: w.z, y: b.gy + floorLocal(b, 0), face: (face || 0) + F.yaw,
      job: opts.job || "clerk", look: opts.look || null, ped: null, lost: false,
      body: function () { const p = post.ped; return p && !p.dead ? p : null; },
    };
    posts.add(post);
    const job = jobOf(b);
    if (job) (job._venueUndo || (job._venueUndo = [])).push(function () { unstaff(post); });
    return post;
  }
  function unstaff(post) {
    posts.delete(post);
    const p = post.ped;
    post.ped = null;
    if (p && !p.dead && CBZ.removeSurvivorBot) CBZ.removeSurvivorBot(p);
  }
  function staffMint(post, A) {
    if (!CBZ.spawnSurvivorBotAt) return;
    if (CBZ.leave && CBZ.leave.unseen && !CBZ.leave.unseen({ x: post.x, y: post.y, z: post.z })) return;
    let p = null;
    try { p = CBZ.spawnSurvivorBotAt(post.x, post.z); } catch (e) { p = null; }
    if (!p) return;
    p.post = { x: post.x, z: post.z, face: post.face, look: null };
    p.job = post.job;
    p._venueStaff = post.b.use || true;
    if (p.group) { p.group.rotation.y = post.face; if (A.root && p.group.parent !== A.root) A.root.add(p.group); }
    post.ped = p;
  }
  let staffAcc = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(41.9, function (dt) {
    if (!posts.size) return;
    staffAcc += dt || 0;
    if (staffAcc < 0.25) return;
    const step = staffAcc; staffAcc = 0;
    const A = CBZ.surv && CBZ.surv.arena;
    for (const post of posts) {
      const p = post.ped;
      if (p) {
        if (p.dead) { post.lost = true; post.ped = null; continue; }
        if ((CBZ.bots || []).indexOf(p) < 0) { post.ped = null; continue; }     // swept with the crowd
        let at = null;
        if (post.look) { try { at = post.look(post, p, step); } catch (e) { at = null; } }
        p.post.look = at || null;
        continue;
      }
      if (post.lost || !A || !CBZ.game || CBZ.game.mode !== "archipelago") continue;
      const j = jobOf(post.b);
      if (!j || j.arena !== A) continue;               // only the island in force has people
      staffMint(post, A);
    }
  });

  CBZ.islandVenue = { on: on, list: list, lotFor: lotFor, floor: floor, clear: clear, island: island,
    staff: staff, fitSteps: fitSteps, drop: drop };
})();

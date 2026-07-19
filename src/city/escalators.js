/* ============================================================
   city/escalators.js — MOVING ESCALATORS for big PUBLIC interiors.

   WHY: the owner loves the elevator/escalator READ — a public
   space (airport concourse, a grand bank/office lobby) only feels
   civic when there's a slow, lit, criss-crossing escalator bank
   carrying people between levels. You step on and it CARRIES you;
   stand still and you still rise. That felt, in-world motion is the
   point — not a stat, not a menu.

   CHEAP BY DESIGN (this engine is DRAW-CALL bound, see MEMORY): an
   escalator is NOT moving geometry. It is:
     • ONE inclined ramp mesh wearing a TILING ribbed/diagonal
       "moving steps" canvas texture, animated purely by scrolling
       mat.map.offset.y each frame — reads as moving steps with ZERO
       moving parts.
     • a second thin sloped HANDRAIL band scrolling slightly faster.
     • two side balustrades (one shared glass-ish material), a top +
       bottom landing plate, and entry/exit comb plates.
   All meshes share a single UNIT box geometry + the city's cached
   shared materials (CBZ.cmat) + exactly TWO CanvasTextures (steps,
   rail) shared across every escalator in the world. A full
   criss-cross bank of 4 escalators is only a couple dozen meshes,
   all tiny, no per-frame geometry churn.

   RIDE: the sloped step band is registered as a CBZ.platforms RAMP
   record so groundAt() gives the correct height as you climb (the
   engine ramp interpolates height along Z ONLY — so every escalator
   here is Z-ALIGNED). A CBZ.onUpdate hook then CARRIES the player:
   while their feet sit inside an escalator footprint AABB and near
   its ramp surface, we nudge pos.z along the escalator direction on
   top of their own input, clamped to the footprint so it can never
   shove them through a wall. Applied gently, after movement.

   PLACEMENT (self-contained, deferred until the city exists):
     • the AIRPORT terminal concourse (region biome==='airport').
     • a flagship criss-cross bank in the downtown core.
   Guarded everywhere; only builds once, only in city mode; no-op
   outside it. Touches nothing else.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  // ---- shared building blocks (draw-call bound: ONE geo, cached mats) ----
  const UNIT = new THREE.BoxGeometry(1, 1, 1);
  const cmat = (CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); });

  // colours (all routed through the shared cmat cache → draw-call neutral)
  const STEEL = 0x3a424d, TRIM = 0x9aa2ad, DECK = 0x4b525c, COMB = 0xb8a23a, NEWEL = 0x2c333d;

  function box(parent, x, y, z, w, h, d, hex, o) {
    o = o || {};
    const m = new THREE.Mesh(UNIT, o.mat || cmat(hex, o.emissive ? { emissive: o.emissive, ei: o.ei || 0.6 } : null));
    m.scale.set(Math.max(1e-3, w), Math.max(1e-3, h), Math.max(1e-3, d));
    m.position.set(x, y, z);
    m.castShadow = !!o.cast; m.receiveShadow = o.receive !== false;
    if (o.rotX) m.rotation.x = o.rotX;
    m.matrixAutoUpdate = false; m.updateMatrix();
    parent.add(m);
    return m;
  }

  // ---- the TWO shared scrolling textures (built once, reused everywhere) --
  let STEP_TEX = null, RAIL_TEX = null, STEP_MAT = null, RAIL_MAT = null;
  function buildTextures() {
    if (STEP_TEX) return;
    // STEP BAND: horizontal cleat ribs (the classic escalator tread look) on a
    // dark metal field, with a bright nose line per step. Tiles vertically.
    {
      const c = document.createElement("canvas"); c.width = 64; c.height = 64;
      const x = c.getContext("2d");
      x.fillStyle = "#2b323b"; x.fillRect(0, 0, 64, 64);
      // four treads in the tile
      for (let i = 0; i < 4; i++) {
        const y = i * 16;
        // tread face (slightly lighter), thin grooves, bright leading nose
        x.fillStyle = "#39414c"; x.fillRect(0, y + 2, 64, 12);
        x.fillStyle = "#222831";
        for (let gx = 2; gx < 64; gx += 4) x.fillRect(gx, y + 3, 1, 10); // vertical cleats
        x.fillStyle = "#c9cdd3"; x.fillRect(0, y, 64, 2);                 // bright nose line
        x.fillStyle = "#171b21"; x.fillRect(0, y + 14, 64, 2);           // shadow riser
      }
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipMapLinearFilter;
      STEP_TEX = t;
      STEP_MAT = new THREE.MeshLambertMaterial({ map: t });
      STEP_MAT._shared = true; // never dispose
    }
    // HANDRAIL: a dark rubber band with periodic light flecks so motion reads.
    {
      const c = document.createElement("canvas"); c.width = 32; c.height = 32;
      const x = c.getContext("2d");
      x.fillStyle = "#15181d"; x.fillRect(0, 0, 32, 32);
      x.fillStyle = "#2a2f37";
      for (let i = 0; i < 4; i++) x.fillRect(0, i * 8 + 3, 32, 2);
      x.fillStyle = "#454b55"; for (let i = 0; i < 4; i++) x.fillRect(0, i * 8, 32, 1);
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      RAIL_TEX = t;
      RAIL_MAT = new THREE.MeshLambertMaterial({ map: t });
      RAIL_MAT._shared = true;
    }
  }

  // every built escalator's ride record (footprint AABB + ramp + direction)
  const escalators = [];

  // -------------------------------------------------------------------------
  // makeEscalator: build ONE Z-aligned escalator.
  //   cx, cz   — centre of the run (world space)
  //   run      — horizontal Z length (positive)
  //   width    — X width of the step band
  //   y0       — floor height at the LOW landing
  //   riseY    — vertical rise to the HIGH landing
  //   up       — true: travels toward +Z-high (carry pushes you UP the slope);
  //              false: a DOWN escalator (carry pushes you down the slope).
  //   dirZ     — +1 or -1: which Z end is HIGH (the high landing is at cz+dirZ*run/2)
  //   root     — parent group to add meshes to
  // returns { group, footprint:{minX,maxX,minZ,maxZ}, ramp }
  // -------------------------------------------------------------------------
  function makeEscalator(opts) {
    buildTextures();
    const root = opts.root, cx = opts.cx, cz = opts.cz;
    const run = Math.max(2, opts.run), width = opts.width || 2.0;
    const y0 = opts.y0 || 0, riseY = Math.max(0.5, opts.riseY || 4.0);
    const dirZ = (opts.dirZ < 0 ? -1 : 1);
    const up = opts.up !== false; // carry direction along the slope

    const grp = new THREE.Group();
    grp.matrixAutoUpdate = false;
    root.add(grp);

    const zLow = cz - dirZ * run / 2;     // Z of the LOW landing
    const zHigh = cz + dirZ * run / 2;    // Z of the HIGH landing
    const yLow = y0, yHigh = y0 + riseY;
    const slope = riseY / run;            // rise per Z
    const slopeAng = Math.atan2(riseY, run);
    const minX = cx - width / 2 - 0.18, maxX = cx + width / 2 + 0.18;
    const minZ = Math.min(zLow, zHigh), maxZ = Math.max(zLow, zHigh);

    // ---- STEP BAND: one inclined plate down the middle of the run ----------
    {
      const len = Math.hypot(run, riseY) + 0.06;
      const m = new THREE.Mesh(UNIT, STEP_MAT);
      m.scale.set(width, 0.16, len);
      m.position.set(cx, (yLow + yHigh) / 2 + 0.02, (zLow + zHigh) / 2);
      m.rotation.x = -dirZ * slopeAng; // tilt so the plate follows the slope
      m.receiveShadow = true;
      m.matrixAutoUpdate = false; m.updateMatrix();
      grp.add(m);
      // remember the scroll direction so the texture appears to move with travel
      m.userData.scroll = (up ? 1 : -1) * dirZ;
      grp.userData.stepMesh = m;
    }

    // ---- BALUSTRADES (two sides) + a moving HANDRAIL band on each ----------
    const len2 = Math.hypot(run, riseY) + 0.1;
    const rails = [];
    for (const sx of [-1, 1]) {
      const bx = cx + sx * (width / 2 + 0.07);
      // glassy/metal balustrade panel, sloped
      box(grp, bx, (yLow + yHigh) / 2 + 0.62, (zLow + zHigh) / 2, 0.07, 1.0, len2,
        STEEL, { rotX: -dirZ * slopeAng, receive: false });
      // bright top cap of the balustrade
      box(grp, bx, (yLow + yHigh) / 2 + 1.14, (zLow + zHigh) / 2, 0.13, 0.08, len2,
        TRIM, { rotX: -dirZ * slopeAng });
      // moving HANDRAIL — thin band riding just above the cap
      const r = new THREE.Mesh(UNIT, RAIL_MAT);
      r.scale.set(0.16, 0.12, len2);
      r.position.set(bx, (yLow + yHigh) / 2 + 1.22, (zLow + zHigh) / 2);
      r.rotation.x = -dirZ * slopeAng;
      r.matrixAutoUpdate = false; r.updateMatrix();
      grp.add(r);
      r.userData.scroll = (up ? 1 : -1) * dirZ;
      rails.push(r);
    }
    grp.userData.rails = rails;

    // ---- LANDING PLATES + COMB PLATES at both ends -------------------------
    const landD = 1.6;
    // low landing
    box(grp, cx, yLow + 0.04, zLow - dirZ * (landD / 2 - 0.1), width + 0.5, 0.16, landD, DECK);
    box(grp, cx, yLow + 0.10, zLow - dirZ * 0.25, width + 0.2, 0.05, 0.5, COMB, { emissive: 0x6a5d12, ei: 0.4 });
    // high landing
    box(grp, cx, yHigh + 0.04, zHigh + dirZ * (landD / 2 - 0.1), width + 0.5, 0.16, landD, DECK);
    box(grp, cx, yHigh + 0.10, zHigh + dirZ * 0.25, width + 0.2, 0.05, 0.5, COMB, { emissive: 0x6a5d12, ei: 0.4 });
    // newel skirt boxes (the chunky end housings) — purely visual, low + small
    box(grp, cx, yLow + 0.55, zLow - dirZ * 0.55, width + 0.4, 1.0, 0.7, NEWEL);
    box(grp, cx, yHigh + 0.55, zHigh + dirZ * 0.55, width + 0.4, 1.0, 0.7, NEWEL);

    // ---- RIDE: register the sloped surface as a CBZ.platforms RAMP ---------
    // groundAt interpolates top = y0 + t*(y1-y0), t along (z-z0)/(z1-z0).
    let ramp = null;
    if (CBZ.platforms) {
      ramp = {
        minX: cx - width / 2, maxX: cx + width / 2,
        minZ: minZ - 0.2, maxZ: maxZ + 0.2,
        top: yHigh + 0.16,
        ramp: { z0: zLow, z1: zHigh, y0: yLow + 0.16, y1: yHigh + 0.16 },
      };
      CBZ.platforms.push(ramp);
    }

    // ride direction in +Z: positive means "standing still carries you toward +Z"
    // up-escalator carries toward the HIGH end (dirZ); down toward the LOW end.
    const carryZ = (up ? dirZ : -dirZ);

    const rec = {
      group: grp,
      footprint: { minX, maxX, minZ, maxZ },
      ramp,
      carryZ,                  // sign of Z carry
      yLow, yHigh, slope, zLow, zHigh, dirZ, up,
      width,
    };
    escalators.push(rec);
    return rec;
  }

  // a criss-cross PAIR: one UP and one DOWN side by side (classic mall read).
  // bankX/bankZ = centre between the two lanes; gap = lane separation in X.
  function makeBank(opts) {
    const root = opts.root, bankX = opts.bankX, bankZ = opts.bankZ;
    const run = opts.run || 9, riseY = opts.riseY || 4.6, y0 = opts.y0 || 0;
    const width = opts.width || 1.9, gap = opts.gap || (width + 1.0);
    const dirZ = (opts.dirZ < 0 ? -1 : 1);
    // UP lane carries you toward the HIGH (dirZ) end; DOWN lane the other way.
    const a = makeEscalator({ root, cx: bankX - gap / 2, cz: bankZ, run, width, y0, riseY, dirZ, up: true });
    const b = makeEscalator({ root, cx: bankX + gap / 2, cz: bankZ, run, width, y0, riseY, dirZ, up: false });
    return [a, b];
  }

  // -------------------------------------------------------------------------
  // PLACEMENT — deferred until the city exists, runs once, city mode only.
  // -------------------------------------------------------------------------
  let built = false;
  function regionByBiome(A, biome) {
    const rs = (A && A.regions) || [];
    for (let i = 0; i < rs.length; i++) if (rs[i] && rs[i].biome === biome) return rs[i];
    return null;
  }

  function placeAll(A) {
    if (built) return;
    if (!A || !A.root) return;
    built = true;
    const root = A.root;

    try {
      // ---- AIRPORT TERMINAL concourse ------------------------------------
      // The terminal is a long low glass shell at roughly x=-40, z=24 inside
      // the 'airport' region. We place a criss-cross bank inside that footprint
      // (ground → a low mezzanine height). We derive a safe interior spot from
      // the region if the exact terminal isn't queryable.
      const air = regionByBiome(A, "airport");
      if (air) {
        // terminal interior is well inside the region's south-centre; use the
        // documented terminal centre (-40, 24) ON the airport's world-layout
        // dial (world/layout.js — the terminal itself is built at -40+dx),
        // then clamp to the region. Clamping alone can NOT correct a stale
        // literal: the old spot stays inside the moved region's rect, so a
        // fixed -40 would put the bank on open apron 220u east of the shell.
        const w = (CBZ.worldOff && CBZ.worldOff("airport")) || { dx: 0, dz: 0 };
        let tx = -40 + w.dx, tz = 24 + w.dz;
        if (tx < air.minX + 8) tx = air.minX + 8; if (tx > air.maxX - 8) tx = air.maxX - 8;
        if (tz < air.minZ + 8) tz = air.minZ + 8; if (tz > air.maxZ - 8) tz = air.maxZ - 8;
        // a Z-aligned criss-cross bank along the concourse depth
        makeBank({ root, bankX: tx + 34, bankZ: tz, run: 8, riseY: 4.2, y0: 0, width: 1.9, dirZ: 1 });
      }

      // ---- DOWNTOWN CORE flagship bank -----------------------------------
      // Place a grand criss-cross bank near the city centre intersection — a
      // clearly public ground→mezzanine lift in the heart of downtown.
      const ctr = A.center || { x: 0, z: 0 };
      // offset off the central intersection onto a clear sidewalk plaza spot
      const ROAD = A.ROAD || 14;
      makeBank({
        root,
        bankX: ctr.x + ROAD / 2 + 6,
        bankZ: ctr.z - ROAD / 2 - 8,
        run: 9, riseY: 4.6, y0: 0, width: 2.0, dirZ: -1,
      });

      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    } catch (e) {
      if (window.console) console.error("[escalators] placement", e);
    }
  }

  // -------------------------------------------------------------------------
  // PER-FRAME: scroll the textures (always, cheap) + CARRY the player.
  // -------------------------------------------------------------------------
  const STEP_SCROLL = 0.85;   // texture units / sec (reads as ~step speed)
  const RAIL_SCROLL = 1.05;   // handrail slightly faster (real escalators do)
  const CARRY_SPEED = 1.5;    // world m/s along the slope the player is carried

  CBZ.onUpdate(36.7, function (dt) {
    if (!g || g.mode !== "city") return;
    if (!built) {
      const A = CBZ.city && CBZ.city.arena;
      if (A && A.root && A.regions) placeAll(A);
      if (!built) return;
    }
    if (!escalators.length) return;
    if (dt > 0.1) dt = 0.1; // clamp huge frames so carry/scroll never jumps

    // scroll the shared textures ONCE (all step bands share STEP_TEX). The two
    // lanes of a criss-cross travel opposite ways, but a single shared texture
    // can only scroll one way — so we drive each MESH's apparent direction by
    // flipping its UV via repeat sign is not possible on a shared map; instead
    // we keep ONE forward-scrolling map and rely on the per-lane geometry tilt
    // + carry direction to read correctly (both lanes' steps visibly move,
    // which is the goal). This keeps us at exactly 2 textures total.
    if (STEP_TEX) { STEP_TEX.offset.y = (STEP_TEX.offset.y - STEP_SCROLL * dt) % 1; }
    if (RAIL_TEX) { RAIL_TEX.offset.y = (RAIL_TEX.offset.y - RAIL_SCROLL * dt) % 1; }

    const P = CBZ.player;
    if (!P || P.dead || P.driving || !P.pos) return;
    const px = P.pos.x, pz = P.pos.z, py = P.pos.y;

    for (let i = 0; i < escalators.length; i++) {
      const e = escalators[i], fp = e.footprint;
      if (px < fp.minX || px > fp.maxX || pz < fp.minZ || pz > fp.maxZ) continue;
      // are the player's feet near the ramp surface? (within ~1.0m above it)
      let t = (pz - e.zLow) / (e.zHigh - e.zLow);
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const surfY = e.yLow + t * (e.yHigh - e.yLow) + 0.16;
      if (py < surfY - 0.6 || py > surfY + 1.6) continue;

      // CARRY: nudge along Z, on top of the player's own movement. Apply after
      // movement, gently. Clamp the result so it can never push the player out
      // through the footprint ends (and thus never through a wall behind them).
      const carry = e.carryZ * CARRY_SPEED * dt;
      let nz = pz + carry;
      // keep inside the run band (let them step OFF at the landings, but don't
      // shove them past the footprint edge)
      const lo = fp.minZ + 0.05, hi = fp.maxZ - 0.05;
      if (nz < lo) nz = lo; else if (nz > hi) nz = hi;
      P.pos.z = nz;
      // re-seat to the ramp height so the carry never sinks/floats the player
      // (groundAt resolves this too, but seat it here for a clean feel)
      let nt = (P.pos.z - e.zLow) / (e.zHigh - e.zLow);
      if (nt < 0) nt = 0; else if (nt > 1) nt = 1;
      const ny = e.yLow + nt * (e.yHigh - e.yLow) + 0.16;
      if (P.pos.y < ny) P.pos.y = ny;
      break; // only one escalator can carry you at a time
    }
  });

  // PUBLIC: built escalators (minimap markers / missions could target them)
  CBZ.cityEscalators = function () { return escalators; };
  CBZ.makeEscalator = makeEscalator;   // exposed for future hand-placement
  CBZ.makeEscalatorBank = makeBank;
})();

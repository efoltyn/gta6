/* ============================================================
   world/disaster_arena.js — the SURVIVAL battle-royale map.

   A disaster island built FAR from the prison (z≈600) so both worlds
   can coexist with zero refactor: an escape match never sees it, a
   survival match teleports here. Everything lives in one group
   (arena.root) so escape mode just hides it.

   The island has a tall central MOUNTAIN (the tsunami refuge) plus a
   few hills — modelled as cones AND as a CBZ.floorAt() height field so
   the otherwise-flat (Y-agnostic) physics lets you actually walk up to
   high ground. Around it: a bright low-poly town of ENTERABLE buildings
   — every one has a front door, windows, a switchback stair that climbs
   to each floor and the roof, walkable floor slabs, and a roof you can
   stand on. They register their floors/stairs/roof as CBZ.platforms and
   their walls as height-gated CBZ.colliders, so the new vertical physics
   lets you go inside and up. None of them are safe: the earthquake
   topples each one as a single piece (walls, floors AND roof) — there
   is no safe building, only the right KIND of shelter for each hazard,
   high ground, and luck. (No zones — the disasters are the pressure.)

   CBZ.buildDisasterArena() builds once and returns the arena descriptor.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  let arena = null;

  // deterministic-ish RNG so the map is the same each match (learnable)
  let _s = 1337;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  const FH = 3.4;     // floor-to-floor height
  const WT = 0.3;     // wall thickness
  const SW = 3.6;     // broad stairwell strip (two easy lanes along the -x interior wall)
  const DOORW = 1.8;  // front doorway width

  CBZ.buildDisasterArena = function () {
    if (arena) return arena;
    const S = CBZ.SURV.arena;
    const cx = S.cx, cz = S.cz, R = S.radius;
    _s = 20240531;

    const root = new THREE.Group();
    CBZ.scene.add(root);
    const mat = CBZ.mat;

    // pull addBox results into the arena group (keeps world transform; root @ origin)
    function box(x, y, z, w, h, d, color, opts) {
      const m = CBZ.addBox(x, y, z, w, h, d, color, opts);
      root.add(m);
      return m;
    }

    // ---- hills / mountain (the high-ground height field) ----
    const hills = [
      { x: cx, z: cz, r: 36, peak: 26 },          // central refuge mountain
      { x: cx - 52, z: cz - 30, r: 20, peak: 9 },
      { x: cx + 48, z: cz + 40, r: 22, peak: 11 },
      { x: cx + 40, z: cz - 48, r: 16, peak: 7 },
    ];
    function groundHeightAt(x, z) {
      let h = 0;
      for (let i = 0; i < hills.length; i++) {
        const hl = hills[i];
        const d = Math.hypot(x - hl.x, z - hl.z);
        if (d < hl.r) { const t = 1 - d / hl.r; const hh = hl.peak * t; if (hh > h) h = hh; }
      }
      return h;
    }

    // ---- island ground + ocean ----
    // big ocean plane. Exposed on the descriptor (arena.ocean / arena.oceanY)
    // so the tsunami can pull the whole sea OUT during its warning and surge
    // it back in as the flood — reset() always parks it back at OCEAN_Y.
    const OCEAN_Y = -0.8;
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400),
      new THREE.MeshLambertMaterial({ color: 0x2f6f9e }));
    ocean.rotation.x = -Math.PI / 2; ocean.position.set(cx, OCEAN_Y, cz);
    ocean.receiveShadow = false; root.add(ocean);

    // the SEABED shelf under the sea: invisible in normal play (the opaque
    // ocean covers it), revealed as a shocking ring of wet sand when the
    // tsunami recedes the ocean below it — the classic dread beat. Its own
    // rng stream so the island layout stays byte-identical.
    let _s2 = 424243;
    const rng2 = () => { _s2 = (_s2 * 1103515245 + 12345) & 0x7fffffff; return _s2 / 0x7fffffff; };
    const seabed = new THREE.Mesh(new THREE.CircleGeometry(R + 170, 48),
      new THREE.MeshLambertMaterial({ color: 0xcdbb8f }));
    seabed.rotation.x = -Math.PI / 2; seabed.position.set(cx, -1.35, cz);
    seabed.receiveShadow = true; root.add(seabed);
    // darker wet patches + shallow pools scattered across the exposed shelf
    const wetM = new THREE.MeshLambertMaterial({ color: 0xa39572 });
    const poolM = new THREE.MeshLambertMaterial({ color: 0x5e7d86 });
    for (let i = 0; i < 14; i++) {
      const a2 = rng2() * Math.PI * 2, d2 = R + 10 + rng2() * 148;
      const pm = new THREE.Mesh(new THREE.CircleGeometry(3.5 + rng2() * 9, 12), i % 3 === 2 ? poolM : wetM);
      pm.rotation.x = -Math.PI / 2;
      pm.position.set(cx + Math.cos(a2) * d2, -1.15, cz + Math.sin(a2) * d2);
      root.add(pm);
    }

    // the island disc (grass) with a sandy beach ring
    const beach = new THREE.Mesh(new THREE.CircleGeometry(R + 14, 64),
      new THREE.MeshLambertMaterial({ color: 0xe6d49a }));
    beach.rotation.x = -Math.PI / 2; beach.position.set(cx, -0.02, cz);
    beach.receiveShadow = true; root.add(beach);
    // clean solid green — the old two-tone checker tiling read as a debug texture
    const island = new THREE.Mesh(new THREE.CircleGeometry(R, 64),
      new THREE.MeshLambertMaterial({ color: 0x53a84e }));
    island.rotation.x = -Math.PI / 2; island.position.set(cx, 0, cz);
    island.receiveShadow = true; root.add(island);

    // ---- mountains as cones sitting on the floor ----
    hills.forEach((hl, i) => {
      // central refuge = rocky grey-brown peak; smaller ones = grassy hills
      const cone = new THREE.Mesh(new THREE.ConeGeometry(hl.r, hl.peak, i === 0 ? 9 : 6),
        mat(i === 0 ? 0x8a8175 : 0x7faa5e));
      cone.position.set(hl.x, hl.peak / 2, hl.z);
      cone.castShadow = true; cone.receiveShadow = true;
      root.add(cone);
      if (i === 0) {
        // a grassy skirt around the rocky base so it rises out of the island
        const skirt = new THREE.Mesh(new THREE.ConeGeometry(hl.r * 1.04, hl.peak * 0.4, 9), mat(0x6fa552));
        skirt.position.set(hl.x, hl.peak * 0.2, hl.z); skirt.receiveShadow = true; root.add(skirt);
        // snow cap on the refuge peak
        const cap = new THREE.Mesh(new THREE.ConeGeometry(hl.r * 0.32, hl.peak * 0.3, 9), mat(0xf2f6ff));
        cap.position.set(hl.x, hl.peak * 0.86, hl.z); cap.castShadow = true; root.add(cap);
      }
    });

    // ============================================================
    // ENTERABLE BUILDINGS
    // Each is one bgroup (positioned at the building, so collapse can
    // pivot/sink the whole thing). Pieces are placed in LOCAL coords; the
    // matching world-space collider/platform records are pushed globally
    // and tracked on the descriptor so collapse can yank them (and reset
    // can restore them). Walls are height-gated colliders; floors, stair
    // treads and the roof are walkable platforms.
    // ============================================================
    const fragile = [];
    const cars = [];
    const elevators = [];   // moving tower lifts (animated each frame)
    const PALETTE = [0xff7a6b, 0x6bb6ff, 0xffd166, 0x9ad17a, 0xc792ea, 0xff9e6b, 0x66d9c0, 0xf06b9b];
    const GLASS = 0x9fd8ee;

    // ---- SHATTERABLE GLASS -------------------------------------------------
    // Every window pane is registered here so a quake/blast can burst it: the
    // pane hides and a few glass shards rain down. One shared translucent
    // material (cool tinted reflectiony look) keeps it cheap. allGlass holds
    // {mesh,x,y,z,span,shattered}; a building also keeps its own list so its
    // collapse blows out exactly its windows.
    const allGlass = [];
    const glassMat = new THREE.MeshLambertMaterial({ color: 0xbfe9f7, emissive: 0x3f8aa6, emissiveIntensity: 0.55, transparent: true, opacity: 0.5 });
    glassMat._shared = true;
    // add a glass pane into `group` at LOCAL (lx,ly,lz); (ox,oz,gy) maps it to
    // world space for proximity tests. For root-level structures pass 0,0,0 and
    // give world coords as the local position.
    function addGlass(group, lx, ly, lz, pw, ph, pd, ox, oz, gy, list) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pd), glassMat);
      m.position.set(lx, ly, lz); m.castShadow = false; m.receiveShadow = false;
      m.renderOrder = 1;
      group.add(m);
      const rec = { mesh: m, x: ox + lx, y: gy + ly, z: oz + lz, span: Math.max(pw, pd) * 0.5, shattered: false };
      allGlass.push(rec); if (list) list.push(rec);
      return m;
    }
    function burstPane(gp) {
      if (gp.shattered) return;
      gp.shattered = true; gp.mesh.visible = false;
      if (!CBZ.fx || !CBZ.fx.dropDebris) return;
      const shards = 4 + ((rng() * 4) | 0);
      for (let i = 0; i < shards; i++) {
        CBZ.fx.dropDebris({
          x: gp.x + (rng() - 0.5) * gp.span * 2, z: gp.z + (rng() - 0.5) * 0.5,
          fromY: gp.y + (rng() - 0.5) * 1.2, vy: 1 + rng() * 2.6,
          size: 0.15 + rng() * 0.18, color: 0xcdeefb, linger: 1.1,
        });
      }
    }
    // shatter every intact pane within `r` of (x,z) — called by the quake (on
    // collapse) and by every explosion (CBZ.fx.blast). Caps work per call.
    CBZ.shatterGlass = function (x, z, r) {
      const r2 = r * r; let n = 0;
      for (let i = 0; i < allGlass.length; i++) {
        const gp = allGlass[i]; if (gp.shattered) continue;
        const dx = gp.x - x, dz = gp.z - z;
        if (dx * dx + dz * dz <= r2) { burstPane(gp); if (++n > 60) break; }
      }
      if (n > 0 && CBZ.sfx) CBZ.sfx("glass");
      return n;
    };

    // sample the terrain across a footprint so we only drop buildings on flat
    // ground (and learn the high point to sit the foundation on)
    function footprintTerrain(ox, oz, w, d) {
      let mx = -1e9, mn = 1e9;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const h = groundHeightAt(ox + i * w * 0.5, oz + j * d * 0.5);
        if (h > mx) mx = h; if (h < mn) mn = h;
      }
      return { max: mx, min: mn };
    }

    function makeBuilding(ox, oz, w, d, storeys, color, gy) {
      const bgroup = new THREE.Group();
      bgroup.position.set(ox, gy, oz);
      root.add(bgroup);

      const cols = [], plats = [], glassList = [];
      const ixMin = -w / 2 + WT, ixMax = w / 2 - WT;   // interior x span
      const izMin = -d / 2 + WT, izMax = d / 2 - WT;   // interior z span
      const sx = ixMin + SW / 2;                       // stairwell strip centre (x)

      // local box; opts.solid → height-gated collider, opts.plat → walkable top,
      // opts.los → camera/vision blocker. Coords are local to bgroup; the
      // collider/platform records carry the world-space rectangle.
      function lbox(lx, ly, lz, bw, bh, bd, col, opts) {
        opts = opts || {};
        const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat(col, opts.emissive ? { emissive: opts.emissive, ei: 0.5 } : null));
        m.position.set(lx, ly, lz);
        m.castShadow = opts.cast !== false; m.receiveShadow = true;
        bgroup.add(m);
        if (opts.solid) {
          const c = { minX: ox + lx - bw / 2, maxX: ox + lx + bw / 2, minZ: oz + lz - bd / 2, maxZ: oz + lz + bd / 2, ref: m, y0: gy + ly - bh / 2, y1: gy + ly + bh / 2 };
          CBZ.colliders.push(c); cols.push(c);
        }
        if (opts.plat) {
          const p = { minX: ox + lx - bw / 2, maxX: ox + lx + bw / 2, minZ: oz + lz - bd / 2, maxZ: oz + lz + bd / 2, top: gy + ly + bh / 2 };
          CBZ.platforms.push(p); plats.push(p);
        }
        if (opts.los) CBZ.losBlockers.push(m);
        return m;
      }

      // big shatterable glass panes on an exterior wall face (a proper modern
      // window band — taller and wider than the old specks, and registered so
      // it bursts in a quake/blast)
      function windows(face, k) {
        const yc = k * FH + FH * 0.55, wh = FH * 0.64;
        if (face === "z+" || face === "z-") {
          const zz = (face === "z+" ? d / 2 - WT * 0.35 : -d / 2 + WT * 0.35);
          const n = Math.min(4, Math.max(2, Math.round(w / 2.4))), pad = 0.55, span = (w - pad * 2) / n;
          for (let i = 0; i < n; i++) addGlass(bgroup, -w / 2 + pad + (i + 0.5) * span, yc, zz, span * 0.82, wh, 0.05, ox, oz, gy, glassList);
        } else {
          const xx = (face === "x+" ? w / 2 - WT * 0.35 : -w / 2 + WT * 0.35);
          const n = Math.min(4, Math.max(2, Math.round(d / 2.4))), pad = 0.55, span = (d - pad * 2) / n;
          for (let i = 0; i < n; i++) addGlass(bgroup, xx, yc, -d / 2 + pad + (i + 0.5) * span, 0.05, wh, span * 0.82, ox, oz, gy, glassList);
        }
      }

      // ground-floor foundation: a solid walkable slab at the floor reference
      // (gy = the footprint's high point), extending down to bury any gap on
      // the low side. This gives a flat indoor ground floor to walk and the
      // base the stairs climb from, instead of bumpy terrain poking through.
      lbox(0, -0.35, 0, w - WT, 0.7, d - WT, 0x6c7178, { plat: true });

      const wallOpt = { solid: true, los: true };
      for (let k = 0; k < storeys; k++) {
        const ly = k * FH + FH / 2;            // wall centre height (local)
        // back / left / right walls (solid) + their windows
        lbox(0, ly, d / 2 - WT / 2, w, FH, WT, color, wallOpt);          // +z back
        lbox(-w / 2 + WT / 2, ly, 0, WT, FH, d, color, wallOpt);         // -x left
        lbox(w / 2 - WT / 2, ly, 0, WT, FH, d, color, wallOpt);          // +x right
        windows("z+", k); windows("x-", k); windows("x+", k);
        // front (-z) wall: ground floor has the doorway, upper floors are solid
        if (k === 0) {
          const side = (w - DOORW) / 2;
          lbox(-(DOORW / 2 + side / 2), ly, -d / 2 + WT / 2, side, FH, WT, color, wallOpt);
          lbox(DOORW / 2 + side / 2, ly, -d / 2 + WT / 2, side, FH, WT, color, wallOpt);
          // door lintel above the opening (so the facade reads as a doorway)
          lbox(0, FH - 0.35, -d / 2 + WT / 2, DOORW, 0.7, WT, color, { los: true });
        } else {
          lbox(0, ly, -d / 2 + WT / 2, w, FH, WT, color, wallOpt);
          windows("z-", k);
        }
      }

      // floor slabs (levels 1..storeys; the top one is the ROOF). Each slab
      // covers the interior MINUS the open stairwell strip on the -x side.
      const slabW = ixMax - (ixMin + SW), slabCx = (ixMin + SW + ixMax) / 2, slabD = izMax - izMin, slabCz = (izMin + izMax) / 2;
      for (let L = 1; L <= storeys; L++) {
        const isRoof = L === storeys;
        lbox(slabCx, L * FH - 0.1, slabCz, slabW, 0.2, slabD, isRoof ? 0x9fa6ad : 0xb9bec6, { plat: true, los: true, cast: isRoof });
      }
      // a slab over the stairwell strip on the GROUND floor's far side would
      // block the climb, so we leave the strip open all the way up; the roof
      // gets a low parapet on three sides so you don't walk straight off.
      const rTop = storeys * FH;
      lbox(slabCx, rTop + 0.35, d / 2 - WT / 2, slabW, 0.7, WT, 0x8b9097, { los: true });   // +z parapet
      lbox(w / 2 - WT / 2, rTop + 0.35, slabCz, WT, 0.7, slabD, 0x8b9097, { los: true });    // +x parapet
      lbox(slabCx, rTop + 0.35, -d / 2 + WT / 2, slabW, 0.7, WT, 0x8b9097, { los: true });   // -z parapet

      // TWO-LANE switchback stairs. The up-flight and the down-flight must
      // never share an (x,z), or groundAt() (highest surface within step
      // reach) would escalate you onto whichever flight is higher and you
      // could never walk DOWN. So flight k takes the LEFT lane on even
      // storeys and the RIGHT lane on odd ones, reversing its run each time;
      // the only ramps stacked over any point are then two storeys (2·FH)
      // apart — far outside STEP_UP — so support is unambiguous both ways.
      // Each flight's walkable surface is a smooth ramp (you glide, no tread
      // hopping); a flat landing at each level bridges the two lanes.
      const nSteps = 9;
      const LD = 1.1;   // flat landing depth at the top of each flight
      const zA = izMin + 0.3, zB = izMax - 0.3;
      const laneW = SW / 2;
      for (let k = 0; k < storeys; k++) {
        const dir = (k % 2 === 0) ? 1 : -1;
        const startZ = dir > 0 ? zA : zB, endZ = dir > 0 ? zB : zA;
        const rampEndZ = endZ - dir * LD;       // ramp stops where the landing starts…
        const lx0 = (k % 2 === 0) ? ixMin : ixMin + laneW;   // this flight's lane
        const lxc = lx0 + laneW / 2;
        // smooth physics ramp confined to the lane, k·FH (at startZ) → (k+1)·FH
        // (at rampEndZ). It ENDS at the landing's inner edge and meets it at the
        // SAME height, so there's no shelf-edge drop when you step off — that was
        // the descent glitch on short flights.
        const ramp = {
          minX: ox + lx0 + 0.04, maxX: ox + lx0 + laneW - 0.04,
          minZ: oz + Math.min(startZ, rampEndZ), maxZ: oz + Math.max(startZ, rampEndZ),
          top: gy + (k + 1) * FH,
          ramp: { z0: oz + startZ, z1: oz + rampEndZ, y0: gy + k * FH, y1: gy + (k + 1) * FH },
        };
        CBZ.platforms.push(ramp); plats.push(ramp);
        // visible treads riding on the ramp (start → rampEnd)
        const runLen = Math.abs(rampEndZ - startZ), runDepth = runLen / nSteps, rise = FH / nSteps;
        for (let i = 1; i <= nSteps; i++) {
          const vtop = k * FH + (i - 0.5) * rise;
          const cz2 = startZ + dir * (i - 0.5) * runDepth;
          lbox(lxc, vtop - 0.13, cz2, laneW - 0.16, 0.26, runDepth + 0.04, 0xa7adb5, { cast: false });
        }
        // flat landing across BOTH lanes, from the ramp's top edge out to endZ,
        // at exactly (k+1)·FH — bridges the two lanes and meets the next flight
        const lzc = (rampEndZ + endZ) / 2;
        lbox(ixMin + SW / 2, (k + 1) * FH - 0.1, lzc, SW, 0.2, LD + 0.2, 0xb4b9c1, { plat: true, los: true, cast: false });
      }

      const b = {
        group: bgroup, ox, oz, gy, x: ox, z: oz, w, d, h: storeys * FH,
        colliders: cols, platforms: plats, glass: glassList, fallen: false,
      };
      fragile.push(b);
      return b;
    }

    // ---- SKYSCRAPERS: enterable hollow towers with floor landings and a
    // working ELEVATOR up the central shaft. Walk in the ground-floor door,
    // ride the lift up (it auto-cycles), step off at any floor or the roof
    // (high ground for the tsunami). Still one group so the quake topples the
    // whole thing; its walls/floors register as height-gated colliders +
    // walkable platforms (collapse yanks them all). ----
    function makeTower(ox, oz, w, d, h, color) {
      const gy = groundHeightAt(ox, oz);
      const g = new THREE.Group();
      g.position.set(ox, gy, oz);
      root.add(g);

      const cols = [], plats = [], glassT = [];
      const TW = 0.4;                                   // wall thickness
      const storeys = Math.max(4, Math.round(h / FH));
      const realH = storeys * FH;
      const DOORH = 3.0, DW = 2.4;                      // ground doorway
      const iw = w / 2 - TW, id = d / 2 - TW;           // interior half-extents
      const s = Math.min(iw, id) * 0.42;                // elevator-shaft half-size (central hole)

      // local box → mesh on the group; world-space collider/platform records.
      function tbox(lx, ly, lz, bw, bh, bd, col, opts) {
        opts = opts || {};
        const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat(col, opts.emissive ? { emissive: opts.emissive, ei: opts.ei || 0.4 } : null));
        m.position.set(lx, ly, lz); m.castShadow = opts.cast !== false; m.receiveShadow = true;
        g.add(m);
        if (opts.solid) {
          const c = { minX: ox + lx - bw / 2, maxX: ox + lx + bw / 2, minZ: oz + lz - bd / 2, maxZ: oz + lz + bd / 2, ref: m, y0: gy + ly - bh / 2, y1: gy + ly + bh / 2 };
          CBZ.colliders.push(c); cols.push(c);
        }
        if (opts.plat) {
          const p = { minX: ox + lx - bw / 2, maxX: ox + lx + bw / 2, minZ: oz + lz - bd / 2, maxZ: oz + lz + bd / 2, top: gy + ly + bh / 2 };
          CBZ.platforms.push(p); plats.push(p);
        }
        if (opts.los) CBZ.losBlockers.push(m);
        return m;
      }

      // ---- exterior walls (full-height, height-gated colliders + LOS) ----
      tbox(0, realH / 2, d / 2 - TW / 2, w, realH, TW, color, { solid: true, los: true });   // back (+z)
      tbox(-w / 2 + TW / 2, realH / 2, 0, TW, realH, d, color, { solid: true, los: true });    // left
      tbox(w / 2 - TW / 2, realH / 2, 0, TW, realH, d, color, { solid: true, los: true });     // right
      // front (-z) wall: two pillars + a lintel, leaving a ground-floor doorway
      const fz = -d / 2 + TW / 2;
      const pw = (w - DW) / 2;                          // pillar width either side of the door
      tbox(-(DW + pw) / 2, realH / 2, fz, pw, realH, TW, color, { solid: true, los: true });
      tbox((DW + pw) / 2, realH / 2, fz, pw, realH, TW, color, { solid: true, los: true });
      tbox(0, (DOORH + realH) / 2, fz, DW, realH - DOORH, TW, color, { solid: true, los: true });   // lintel above the doorway

      // ---- per-floor landings + roof: a slab frame around the central shaft ----
      function landing(ly) {
        const zN = -(id + s) / 2, zS = (id + s) / 2, wN = id - s;
        tbox(0, ly, zN, 2 * iw, 0.2, wN, 0xb4b9c1, { plat: true, los: true, cast: false });
        tbox(0, ly, zS, 2 * iw, 0.2, wN, 0xb4b9c1, { plat: true, los: true, cast: false });
        tbox(-(iw + s) / 2, ly, 0, iw - s, 0.2, 2 * s, 0xb4b9c1, { plat: true, cast: false });
        tbox((iw + s) / 2, ly, 0, iw - s, 0.2, 2 * s, 0xb4b9c1, { plat: true, cast: false });
      }
      for (let k = 1; k < storeys; k++) landing(k * FH);
      landing(realH);                                   // roof (with the same shaft opening)

      // ---- MASSIVE curtain-wall glass: floor-to-ceiling panes wrapping every
      // storey (a modern glass-skyscraper facade), every pane shatterable ----
      const gi = 0.06, gph = FH * 0.82;
      for (let k = 0; k < storeys; k++) {
        const yc = k * FH + FH * 0.5;
        addGlass(g, 0, yc, d / 2 + gi, w * 0.9, gph, 0.05, ox, oz, gy, glassT);            // +z
        addGlass(g, w / 2 + gi, yc, 0, 0.05, gph, d * 0.9, ox, oz, gy, glassT);            // +x
        addGlass(g, -w / 2 - gi, yc, 0, 0.05, gph, d * 0.9, ox, oz, gy, glassT);           // -x
        if (k > 0) addGlass(g, 0, yc, -d / 2 - gi, w * 0.9, gph, 0.05, ox, oz, gy, glassT); // -z (skip the ground-floor door)
      }
      // rooftop plant box (offset off the shaft so it doesn't block the lift)
      const capm = new THREE.Mesh(new THREE.BoxGeometry(iw * 0.7, 1.2, id * 0.5), mat(0x8b9097));
      capm.position.set(0, realH + 0.6, id * 0.55); capm.castShadow = true; g.add(capm);

      const b = { group: g, ox, oz, gy, x: ox, z: oz, w, d, h: realH, colliders: cols, platforms: plats, glass: glassT, fallen: false };
      fragile.push(b);

      // ---- the elevator car: a slab that rides the central shaft, gy → roof ----
      const carMesh = new THREE.Mesh(new THREE.BoxGeometry(2 * s - 0.1, 0.2, 2 * s - 0.1), mat(0x3a4150, { emissive: 0x10141c, ei: 0.5 }));
      carMesh.position.set(0, 0.12, 0); carMesh.castShadow = true; g.add(carMesh);
      for (let cz2 = -1; cz2 <= 1; cz2 += 2) for (let cx2 = -1; cx2 <= 1; cx2 += 2) {  // corner posts
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 0.12), mat(0x5a626d));
        post.position.set(cx2 * (s - 0.12), 0.9, cz2 * (s - 0.12)); carMesh.add(post);
      }
      const carPlat = { minX: ox - s + 0.05, maxX: ox + s - 0.05, minZ: oz - s + 0.05, maxZ: oz + s - 0.05, top: gy + 0.22 };
      CBZ.platforms.push(carPlat); plats.push(carPlat);
      elevators.push({ b, mesh: carMesh, plat: carPlat, gy, lo: 0.12, hi: realH, t: rng() * 8, slabTop: 0.1 });

      return b;
    }

    // ---- STREETS: dark asphalt running in flat, contiguous runs along grid
    // lines, with a dashed centre line. Hills/mountain break the runs so roads
    // never float. roadSegs feeds the car scatter below. ----
    // SURV_ROAD_LAYERS (round 2 of the flicker fix): the polygonOffset pass
    // did NOT hold on real hardware (iPad) — mobile TBDR GPUs map offset
    // factor/units to depth precision differently than SwiftShader, and the
    // arena laid BOTH road directions at the same y (0.05) with the SAME
    // material, so every avenue/cross-street intersection was two coplanar
    // opaque planes z-fighting. The city never flickers because it separates
    // by GEOMETRY, copying its exact proven constants here:
    //   ground 0 → avenues +0.04 → cross-streets +0.045 → paint +0.057.
    // Roads carry NO polygonOffset (pure y-separation, like city asphalt);
    // only the paint dashes keep the city's decal recipe (offset -2/-2 +
    // renderOrder 1 + userData.roadPaint so a batch pass can never strip the
    // offset — the exact guard city/world.js documents). No two planes that
    // can overlap ever share a y. false = the old 0.05/0.07 offset stack.
    const LAYERS = !CBZ.CONFIG || CBZ.CONFIG.SURV_ROAD_LAYERS !== false;
    const ROAD_Y_AVE = LAYERS ? 0.04 : 0.05;     // avenues (run along z)
    const ROAD_Y_CROSS = LAYERS ? 0.045 : 0.05;  // cross-streets (run along x)
    const ROAD_Y_PAD = LAYERS ? 0.05 : 0.05;     // forecourt/apron pads — ABOVE both road
                                                 // levels (owner: gas-station ground flickered
                                                 // where the pad overlapped an avenue at the
                                                 // same 0.04), below the 0.057 dashes
    const PAINT_Y = LAYERS ? 0.057 : 0.07;       // centre-line dashes
    const roadMat = LAYERS
      ? new THREE.MeshLambertMaterial({ color: 0x33363d })
      : new THREE.MeshLambertMaterial({ color: 0x33363d, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const lineMat = LAYERS
      ? new THREE.MeshBasicMaterial({ color: 0xf2d14a, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
      : new THREE.MeshBasicMaterial({ color: 0xf2d14a, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const roadSegs = [];
    const ROADW = 7;
    function layRoadLine(fixed, vertical) {
      const step = 4, segs = [];
      let runStart = null;
      for (let t = -R; t <= R + step; t += step) {
        const x = vertical ? fixed : cx + t;
        const z = vertical ? cz + t : fixed;
        const ok = Math.hypot(x - cx, z - cz) < R - 5 && groundHeightAt(x, z) < 0.5;
        if (ok && runStart === null) runStart = t;
        if ((!ok || t > R) && runStart !== null) {
          const runEnd = ok ? t : t - step;
          if (runEnd - runStart >= step * 2) segs.push([runStart, runEnd]);
          runStart = null;
        }
      }
      segs.forEach(([a, bb]) => {
        const midT = (a + bb) / 2, len = bb - a;
        const x = vertical ? fixed : cx + midT, z = vertical ? cz + midT : fixed;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(vertical ? ROADW : len, vertical ? len : ROADW), roadMat);
        // avenues and cross-streets on SPLIT y levels (city constants) so the
        // planes overlapping at every intersection can never z-fight
        m.rotation.x = -Math.PI / 2; m.position.set(x, vertical ? ROAD_Y_AVE : ROAD_Y_CROSS, z); m.receiveShadow = true; root.add(m);
        const dashes = Math.max(1, Math.floor(len / 6));
        for (let i = 0; i < dashes; i++) {
          const tt = a + (i + 0.5) * (len / dashes);
          const lx = vertical ? fixed : cx + tt, lz = vertical ? cz + tt : fixed;
          const dm = new THREE.Mesh(new THREE.PlaneGeometry(vertical ? 0.3 : 2.4, vertical ? 2.4 : 0.3), lineMat);
          dm.rotation.x = -Math.PI / 2; dm.position.set(lx, PAINT_Y, lz); root.add(dm);
          if (LAYERS) { dm.renderOrder = 1; dm.userData.roadPaint = true; }
        }
        roadSegs.push({ x, z, len, vertical });
      });
    }

    // ---- CARS: a low-poly body + cabin + 4 wheels, aligned to their street ----
    const CAR_COLORS = [0xe24b4b, 0x3c6fd6, 0xf2c43d, 0x4caf6e, 0xe8e8ee, 0x2a2d33, 0xe88a3c];
    function makeCar(x, z, vertical, color) {
      const gy = groundHeightAt(x, z);
      const g = new THREE.Group();
      g.position.set(x, gy, z); g.rotation.y = vertical ? 0 : Math.PI / 2; root.add(g);
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 4.2), mat(color));
      body.position.y = 0.78; body.castShadow = true; g.add(body);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.72, 2.2), mat(0x223038, { emissive: 0x0c141a, ei: 0.35 }));
      cabin.position.set(0, 1.45, -0.2); g.add(cabin);
      const wgeo = new THREE.CylinderGeometry(0.45, 0.45, 0.42, 10), wmat = mat(0x14161a);
      [[0.98, 1.35], [-0.98, 1.35], [0.98, -1.35], [-0.98, -1.35]].forEach(([wx, wz]) => {
        const wh = new THREE.Mesh(wgeo, wmat); wh.rotation.z = Math.PI / 2; wh.position.set(wx, 0.45, wz); g.add(wh);
      });
      const hw = vertical ? 1.1 : 2.2, hd = vertical ? 2.2 : 1.1;
      const c = { minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd, ref: body, noCam: true };
      CBZ.colliders.push(c);
      const car = { group: g, x, z, oy: gy, rotY: g.rotation.y, collider: c, flung: false };
      cars.push(car);
      return g;
    }

    // ---- GAS STATION (GTA-style): a drive-under canopy on pillars, a row of
    // fuel pumps, a price totem, and a small glass-fronted shop. The canopy
    // roof is a height-gated collider so you drive/walk under it freely. ----
    function makeGasStation(ox, oz) {
      const gy = groundHeightAt(ox, oz);
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(20, 16), LAYERS
        ? new THREE.MeshLambertMaterial({ color: 0x41464d })
        : new THREE.MeshLambertMaterial({ color: 0x41464d, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      // the forecourt apron rides its OWN level above both road planes — it
      // can overlap an avenue, and coplanar overlap is exactly the TBDR
      // z-fight the owner saw (SURV_ROAD_LAYERS)
      pad.rotation.x = -Math.PI / 2; pad.position.set(ox, gy + (LAYERS ? ROAD_Y_PAD : 0.05), oz); pad.receiveShadow = true; root.add(pad);
      if (LAYERS) pad.renderOrder = 1;
      const CH = 5.2;
      [[-6, -3.4], [6, -3.4], [-6, 3.4], [6, 3.4]].forEach(([px, pz]) => box(ox + px, gy + CH / 2, oz + pz, 0.55, CH, 0.55, 0xeef1f4, { solid: true }));
      box(ox, gy + CH + 0.45, oz, 14.5, 0.9, 9.5, 0xfbfcfe, { solid: true, y0: gy + CH, y1: gy + CH + 0.9 });
      box(ox, gy + CH + 0.1, oz - 4.9, 14.6, 0.7, 0.25, 0xe53b3b);   // brand stripe
      box(ox, gy + CH + 0.1, oz + 4.9, 14.6, 0.7, 0.25, 0xe53b3b);
      for (let i = -1; i <= 1; i++) {
        const px = ox + i * 4.0;
        [oz - 1.4, oz + 1.4].forEach((pz) => {
          box(px, gy + 0.75, pz, 0.7, 1.5, 0.5, 0x2a2d33, { solid: true });
          box(px, gy + 1.6, pz, 0.85, 0.55, 0.62, 0xff7a1a);          // pump topper
        });
      }
      box(ox - 9.6, gy + 2.4, oz - 5.6, 0.4, 4.8, 0.4, 0x6a7079, { solid: true });  // price totem
      box(ox - 9.6, gy + 4.6, oz - 5.6, 2.2, 1.6, 0.3, 0xffd451);
      // glass-fronted shop
      const sw = 6, sd = 4.6, sh = 3.4, sxc = ox + 9.6, szc = oz;
      box(sxc, gy + sh / 2, szc + sd / 2, sw, sh, 0.3, 0xe7eaef, { solid: true, y0: gy, y1: gy + sh });
      box(sxc - sw / 2 + 0.15, gy + sh / 2, szc, 0.3, sh, sd, 0xe7eaef, { solid: true, y0: gy, y1: gy + sh });
      box(sxc + sw / 2 - 0.15, gy + sh / 2, szc, 0.3, sh, sd, 0xe7eaef, { solid: true, y0: gy, y1: gy + sh });
      box(sxc, gy + sh + 0.15, szc, sw, 0.3, sd, 0x9aa0a8, { solid: true, y0: gy + sh, y1: gy + sh + 0.3 });
      addGlass(root, sxc - 1.95, gy + sh * 0.55, szc - sd / 2, 1.9, sh * 0.78, 0.06, 0, 0, 0, null);
      addGlass(root, sxc + 1.95, gy + sh * 0.55, szc - sd / 2, 1.9, sh * 0.78, 0.06, 0, 0, 0, null);
      addGlass(root, sxc - sw / 2 + 0.2, gy + sh * 0.55, szc, 0.06, sh * 0.7, sd * 0.7, 0, 0, 0, null);
      addGlass(root, sxc + sw / 2 - 0.2, gy + sh * 0.55, szc, 0.06, sh * 0.7, sd * 0.7, 0, 0, 0, null);
      box(sxc, gy + sh + 0.55, szc - sd / 2 + 0.12, 3, 0.7, 0.2, 0x39c06a);   // STORE sign
    }

    // ---- CAR SHOWROOM (GTA dealership): no normal doors — the whole front is
    // a giant glass showroom with a central roll-up GARAGE-DOOR bay you can
    // drive a car straight into, flanked by full-height display glass, capped
    // by a massive clerestory window and an AUTO SALES sign. Cars on display
    // inside. The glass is shatterable. ----
    function makeShowroom(ox, oz) {
      const gy = groundHeightAt(ox, oz);
      const w = 18, d = 13, SH = 6.0, T = 0.35;
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.4, d - 0.4), new THREE.MeshLambertMaterial({ color: 0xd6dade, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      floor.rotation.x = -Math.PI / 2; floor.position.set(ox, gy + 0.06, oz); floor.receiveShadow = true; root.add(floor);
      // shell: back + sides + roof (solid, height-gated)
      box(ox, gy + SH / 2, oz + d / 2 - T / 2, w, SH, T, 0x586a86, { solid: true, y0: gy, y1: gy + SH, los: true });
      box(ox - w / 2 + T / 2, gy + SH / 2, oz, T, SH, d, 0x586a86, { solid: true, y0: gy, y1: gy + SH, los: true });
      box(ox + w / 2 - T / 2, gy + SH / 2, oz, T, SH, d, 0x586a86, { solid: true, y0: gy, y1: gy + SH, los: true });
      box(ox, gy + SH + 0.2, oz, w, 0.4, d, 0x46566b, { solid: true, y0: gy + SH, y1: gy + SH + 0.4, los: true });
      addGlass(root, ox - w / 2 + 0.18, gy + SH * 0.52, oz + 1.2, 0.05, SH * 0.7, d * 0.5, 0, 0, 0, null);  // side display glass
      addGlass(root, ox + w / 2 - 0.18, gy + SH * 0.52, oz + 1.2, 0.05, SH * 0.7, d * 0.5, 0, 0, 0, null);
      // FRONT (-z): posts/mullions, header + rolled-up garage door over the bay
      const fz = oz - d / 2 + T / 2, BAYW = 5.2, HEADER = 4.2;
      box(ox - w / 2 + 0.35, gy + SH / 2, fz, 0.7, SH, T, 0x44506b, { solid: true, y0: gy, y1: gy + SH });
      box(ox + w / 2 - 0.35, gy + SH / 2, fz, 0.7, SH, T, 0x44506b, { solid: true, y0: gy, y1: gy + SH });
      box(ox - BAYW / 2, gy + SH / 2, fz, 0.4, SH, T, 0x44506b, { solid: true, y0: gy, y1: gy + SH });
      box(ox + BAYW / 2, gy + SH / 2, fz, 0.4, SH, T, 0x44506b, { solid: true, y0: gy, y1: gy + SH });
      box(ox, gy + HEADER + 0.3, fz, BAYW + 0.4, 0.6, T + 0.06, 0x39414f, { solid: true, y0: gy + HEADER, y1: gy + HEADER + 0.6 });
      box(ox, gy + HEADER - 0.45, fz + 0.05, BAYW - 0.5, 0.9, 0.16, 0x8a93a0);   // rolled-up door
      for (let s = 0; s < 4; s++) box(ox, gy + HEADER - 0.2 - s * 0.2, fz + 0.06, BAYW - 0.55, 0.05, 0.18, 0x6b7480);
      // full-height display glass flanking the bay
      const a = -w / 2 + 0.7, bb = -BAYW / 2 - 0.2, cxL = (a + bb) / 2, wL = bb - a;
      addGlass(root, ox + cxL, gy + SH * 0.52, fz, wL * 0.95, SH * 0.82, 0.06, 0, 0, 0, null);
      addGlass(root, ox - cxL, gy + SH * 0.52, fz, wL * 0.95, SH * 0.82, 0.06, 0, 0, 0, null);
      // MASSIVE clerestory glass above the bay header
      addGlass(root, ox, gy + (HEADER + SH) / 2 + 0.3, fz, BAYW + 0.2, SH - HEADER - 0.7, 0.06, 0, 0, 0, null);
      // display cars (for sale) + the sign
      makeCar(ox - 4.6, oz + 1.6, true, 0xe24b4b);
      makeCar(ox + 4.6, oz + 1.6, true, 0x3c6fd6);
      makeCar(ox, oz + 4.2, false, 0xf2c43d);
      box(ox, gy + SH + 1.1, fz + 0.2, 9.5, 1.5, 0.3, 0x12c258);   // AUTO SALES sign
      box(ox, gy + SH + 1.1, fz + 0.36, 8.6, 1.05, 0.1, 0xeafff2);
    }

    // place the town in a loose ring, ONLY on flat ground (off the mountain
    // and hill skirts so terrain never pokes through a floor), no overlaps
    const placed = [];
    let attempts = 0, want = 18;
    while (placed.length < want && attempts < 600) {
      attempts++;
      const a = rng() * Math.PI * 2;
      const dist = 44 + rng() * (R - 60);
      const x = cx + Math.cos(a) * dist, z = cz + Math.sin(a) * dist;
      const w = 6.5 + rng() * 4.5, d = 7 + rng() * 4.5;
      const ter = footprintTerrain(x, z, w, d);
      if (ter.max - ter.min > 0.45 || ter.max > 1.8) continue;   // must be flat-ish
      let clash = false;
      for (const p of placed) { if (Math.abs(p.x - x) < (p.w + w) / 2 + 4 && Math.abs(p.z - z) < (p.d + d) / 2 + 4) { clash = true; break; } }
      if (clash) continue;
      const storeys = 1 + ((rng() * 3) | 0);    // 1..3 (roof is the top level)
      const color = PALETTE[(rng() * PALETTE.length) | 0];
      makeBuilding(x, z, w, d, storeys, color, ter.max);   // sit on the high point
      placed.push({ x, z, w, d });
    }

    // ---- city grid: streets, then a skyline of really tall towers ----
    const GRID = 40;
    for (let k = -2; k <= 2; k++) {
      layRoadLine(cx + k * GRID, true);    // avenues (run along z)
      layRoadLine(cz + k * GRID, false);   // cross-streets (run along x)
    }

    // a downtown cluster of tall towers, plus a few outliers, on flat ground
    const TOWER_PALETTE = [0x5b6b82, 0x6f7e96, 0x8a98ac, 0x49566b, 0x7a6f8c, 0x5e7d86];
    let tAttempts = 0, tWant = 9;
    let towers = 0;
    while (towers < tWant && tAttempts < 500) {
      tAttempts++;
      const a = rng() * Math.PI * 2;
      const dist = 40 + rng() * (R - 56);
      const x = cx + Math.cos(a) * dist, z = cz + Math.sin(a) * dist;
      const w = 7 + rng() * 5, d = 7 + rng() * 5;
      const ter = footprintTerrain(x, z, w, d);
      if (ter.max - ter.min > 0.45 || ter.max > 1.6) continue;   // flat ground only
      let clash = false;
      for (const p of placed) { if (Math.abs(p.x - x) < (p.w + w) / 2 + 5 && Math.abs(p.z - z) < (p.d + d) / 2 + 5) { clash = true; break; } }
      if (clash) continue;
      const h = 18 + rng() * 20;          // ~18–38m (5–11 floors you can climb via the lift)
      makeTower(x, z, w, d, h, TOWER_PALETTE[(rng() * TOWER_PALETTE.length) | 0]);
      placed.push({ x, z, w, d });
      towers++;
    }

    // ---- landmarks: a couple of gas stations + a car showroom, on flat
    // ground clear of everything else (registered in `placed` so the street
    // cars + trees don't spawn on top of them) ----
    function placeFlat(halfW, halfD) {
      for (let a = 0; a < 90; a++) {
        const ang = rng() * Math.PI * 2, dist = 38 + rng() * (R - 56);
        const x = cx + Math.cos(ang) * dist, z = cz + Math.sin(ang) * dist;
        const ter = footprintTerrain(x, z, halfW * 2, halfD * 2);
        if (ter.max - ter.min > 0.4 || ter.max > 1.3) continue;
        let clash = false;
        for (const p of placed) { if (Math.abs(p.x - x) < p.w / 2 + halfW + 5 && Math.abs(p.z - z) < p.d / 2 + halfD + 5) { clash = true; break; } }
        if (clash) continue;
        placed.push({ x, z, w: halfW * 2, d: halfD * 2 });
        return { x, z };
      }
      return null;
    }
    const gs1 = placeFlat(11, 9); if (gs1) makeGasStation(gs1.x, gs1.z);
    const gs2 = placeFlat(11, 9); if (gs2) makeGasStation(gs2.x, gs2.z);
    const dl1 = placeFlat(10, 8); if (dl1) makeShowroom(dl1.x, dl1.z);

    // park cars along the streets (offset to one lane), skipping building spots
    roadSegs.forEach((seg) => {
      const n = 1 + ((rng() * 2) | 0);
      for (let i = 0; i < n; i++) {
        const off = (rng() < 0.5 ? -1 : 1) * (ROADW * 0.24);
        const along = (rng() - 0.5) * seg.len * 0.8;
        const x = seg.x + (seg.vertical ? off : along);
        const z = seg.z + (seg.vertical ? along : off);
        let onBldg = false;
        for (const p of placed) { if (Math.abs(p.x - x) < p.w / 2 + 2 && Math.abs(p.z - z) < p.d / 2 + 2) { onBldg = true; break; } }
        if (onBldg) continue;
        makeCar(x, z, seg.vertical, CAR_COLORS[(rng() * CAR_COLORS.length) | 0]);
      }
    });

    // ---- scattered trees: passable canopy, thin solid trunk (run-around) ----
    const flammable = [];
    for (let i = 0; i < 70; i++) {
      const a = rng() * Math.PI * 2;
      const dist = 16 + rng() * (R - 18);
      const x = cx + Math.cos(a) * dist, z = cz + Math.sin(a) * dist;
      let onBuilding = false;
      for (const p of placed) { if (Math.abs(p.x - x) < p.w / 2 + 2 && Math.abs(p.z - z) < p.d / 2 + 2) { onBuilding = true; break; } }
      if (onBuilding) continue;
      const gy = groundHeightAt(x, z);
      const th = 2 + rng() * 1.5;
      // trunk is a thin SOLID collider you can weave around; foliage is open air
      const trunk = box(x, gy + th / 2, z, 0.5, th, 0.5, 0x6b4a2a, { solid: true });
      // thin trunks must NOT shove the third-person camera around
      if (trunk.userData.collider) trunk.userData.collider.noCam = true;
      const foliage = box(x, gy + th + 1.2, z, 2.4 + rng(), 2.6, 2.4 + rng(), 0x3f9a4f);
      flammable.push({ x, z, trunk, foliage, trunkCol: trunk.userData.collider, burning: 0, burnt: false });
    }

    // ---- rocks / cover ----
    // Boulders, not silver dice: earthy grey-brown, randomly rotated and
    // squashed so they read as rough rock — and kept OFF the hill/mountain
    // slopes (a perfect cube stuck on a cone looked broken). Flat ground only.
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2, dist = 12 + rng() * (R - 14);
      const x = cx + Math.cos(a) * dist, z = cz + Math.sin(a) * dist;
      const gy = groundHeightAt(x, z);
      if (gy > 0.8) continue;                 // skip hillsides — no floating cubes on the mountain
      const s = 1 + rng() * 2.2;
      const m = box(x, gy + s * 0.4, z, s, s, s, 0x6e675e, { solid: true });
      m.rotation.set((rng() - 0.5) * 0.5, rng() * Math.PI, (rng() - 0.5) * 0.5);
      m.scale.set(0.8 + rng() * 0.4, 0.55 + rng() * 0.35, 0.8 + rng() * 0.4);
      m.position.y = gy + s * m.scale.y * 0.5 - 0.06;   // rest on the ground, slightly embedded
    }

    arena = {
      root, center: { x: cx, z: cz }, radius: R,
      ocean, oceanY: OCEAN_Y,
      hills, fragile, flammable, cars, elevators, glass: allGlass, groundHeightAt,
      randomPoint(minD, maxD) {
        const a = rng() * Math.PI * 2;
        const d = (minD || 0) + rng() * ((maxD || R * 0.82) - (minD || 0));
        return { x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d };
      },
      // nearest high ground above height `above` (for tsunami fleeing)
      highGround(above) {
        let best = hills[0], bd = -1;
        for (const h of hills) if (h.peak > bd) { bd = h.peak; best = h; }
        return best;
      },
      // restore the island between matches: un-collapse buildings (re-show the
      // group, re-register its walls/floors/roof), regrow trees, clear craters.
      reset() {
        ocean.position.y = OCEAN_Y;   // a match can end mid-tsunami-warning with the sea pulled out
        for (const b of fragile) {
          if (b.fallen) {
            b.group.visible = true;
            b.group.position.set(b.ox, b.gy, b.oz);
            b.group.rotation.set(0, 0, 0);
            for (const c of b.colliders) if (CBZ.colliders.indexOf(c) === -1) CBZ.colliders.push(c);
            for (const p of b.platforms) if (CBZ.platforms.indexOf(p) === -1) CBZ.platforms.push(p);
            b.fallen = false;
          }
        }
        for (const t of flammable) {
          t.burning = 0; t.burnt = false;
          if (t.foliage && t.foliage.material) t.foliage.material.color.setHex(0x3f9a4f);
          if (t.trunk && t.trunk.material) t.trunk.material.color.setHex(0x6b4a2a);
        }
        // park flung/wrecked cars back where they started
        for (const car of cars) {
          if (car.flung) {
            car.group.position.set(car.x, car.oy, car.z);
            car.group.rotation.set(0, car.rotY, 0);
            if (CBZ.colliders.indexOf(car.collider) === -1) CBZ.colliders.push(car.collider);
            car.flung = false;
          }
        }
        // re-glaze every shattered window for the new match
        for (const gp of allGlass) { if (gp.shattered) { gp.shattered = false; gp.mesh.visible = true; } }
        for (let i = root.children.length - 1; i >= 0; i--) {
          const c = root.children[i];
          if (c.userData && c.userData.transient) {
            root.remove(c);
            if (c.geometry) c.geometry.dispose();
            if (c.material && c.material.dispose) c.material.dispose();
          }
        }
        if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      },
    };

    // ---- ELEVATOR DRIVE: each tower lift auto-cycles ground → roof → ground.
    // The car is a moving CBZ.platform, so the player's vertical physics simply
    // rides it (rise rate stays under the auto-step height). Collapsed towers
    // park their lift. ----
    CBZ.onUpdate(29, function (dt) {
      if (CBZ.game.mode !== "survival") return;
      for (let i = 0; i < elevators.length; i++) {
        const e = elevators[i];
        if (e.b.fallen) { if (e.mesh.visible) e.mesh.visible = false; continue; }
        const span = e.hi - e.lo;
        const upT = span / 4.5;          // ~4.5 m/s — slow enough to ride
        const dwell = 2.2;               // pause at each end
        const cycle = (upT + dwell) * 2;
        e.t = (e.t + dt) % cycle;
        const tt = e.t; let yl;
        if (tt < upT) yl = e.lo + (tt / upT) * span;
        else if (tt < upT + dwell) yl = e.hi;
        else if (tt < upT * 2 + dwell) yl = e.hi - ((tt - upT - dwell) / upT) * span;
        else yl = e.lo;
        e.mesh.position.y = yl;
        e.plat.top = e.gy + yl + e.slabTop;
      }
    });

    root.visible = false; // hidden until survival mode activates
    return arena;
  };
})();

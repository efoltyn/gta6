/* ============================================================
   city/buildings.js — every lot becomes a REAL, walkable place or an
   ABANDONED gang-run derelict. Hooked by world.js via CBZ.cityBuildings.

   REAL buildings:
     • Shops (16 trades + a Realtor + a Chop Shop) — furnished interior,
       a counter and a vendor who runs the business.
     • Residences (apartments / office towers) — furnished rooms, a few
       residents, and many are FOR SALE / FOR RENT homes (city/realestate.js
       reads lot.building.home). One flagship tower carries a ground-floor
       GARAGE zone + an ELEVATOR to a penthouse.
   ABANDONED buildings:
     • Dark, boarded windows, graffiti, trash, and a lootable STASH. Each is
       assigned to a gang by city/gangs.js (gang members spawn to hold it).

   Buildings stay ENTERABLE & climbable (the proven switchback-stair rig).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const mat = CBZ.mat;

  const FH = 4.0;      // floor-to-floor
  const WT = 0.4;      // wall thickness
  const SW = 5.6;      // two generous stair lanes; narrow stairs snag characters at speed
  const DOORW = 2.2;   // doorway width
  const GLASS = 0x9fd8ee;

  // ---- SHATTERABLE GLASS (city-wide) ------------------------------------
  // Every window pane registers here so a crash / blast / gunshot can burst
  // it: the pane hides — and SOLID showroom glass also drops its collider so
  // you can drive straight THROUGH the hole — while a few glass shards rain
  // down. One shared translucent material + shard geometry keep it cheap.
  const cityGlass = [], cityShards = [];
  let _gmat = null, _shardGeo = null;
  function glassMat() { return _gmat || (_gmat = new THREE.MeshLambertMaterial({ color: 0xbfe9f7, emissive: 0x3f8aa6, emissiveIntensity: 0.5, transparent: true, opacity: 0.46 })); }
  function shardGeo() { return _shardGeo || (_shardGeo = new THREE.BoxGeometry(0.22, 0.3, 0.05)); }

  // register a pane; group/local coords mirror lbox, (ox,oz) → world. opts.solid
  // makes it a height-gated collider (showroom walls) tracked so a burst frees it.
  function addCityGlass(group, lx, ly, lz, pw, ph, pd, ox, oz, o, list) {
    o = o || {};
    const m = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pd), glassMat());
    m.position.set(lx, ly, lz); m.castShadow = false; m.receiveShadow = false; m.renderOrder = 1;
    group.add(m);
    const rec = { mesh: m, x: ox + lx, y: ly, z: oz + lz, span: Math.max(pw, pd) * 0.5, hw: pw / 2, hh: ph / 2, hd: pd / 2, shattered: false, col: null };
    if (o.solid) {
      const c = { minX: ox + lx - pw / 2, maxX: ox + lx + pw / 2, minZ: oz + lz - pd / 2, maxZ: oz + lz + pd / 2, ref: m, y0: ly - ph / 2, y1: ly + ph / 2 };
      CBZ.colliders.push(c); rec.col = c;
    }
    cityGlass.push(rec); if (list) list.push(rec);
    return m;
  }
  function burstPane(gp) {
    if (gp.shattered) return;
    gp.shattered = true; gp.mesh.visible = false;
    if (gp.col) { const i = CBZ.colliders.indexOf(gp.col); if (i >= 0) CBZ.colliders.splice(i, 1); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
    if (cityShards.length > 320) return;
    const n = 4 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) {
      const sh = new THREE.Mesh(shardGeo(), glassMat());
      sh.position.set(gp.x + (Math.random() - 0.5) * gp.span * 2, gp.y + (Math.random() - 0.5) * Math.max(0.7, gp.span), gp.z + (Math.random() - 0.5) * 0.4);
      sh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      CBZ.scene.add(sh);
      cityShards.push({ mesh: sh, vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2.6, vz: (Math.random() - 0.5) * 3, spin: (Math.random() - 0.5) * 9, life: 1.3 });
    }
  }
  // burst every intact pane within r of (x,z) — called on car crashes etc.
  CBZ.cityShatter = function (x, z, r) {
    const r2 = r * r; let n = 0;
    for (let i = 0; i < cityGlass.length; i++) {
      const gp = cityGlass[i]; if (gp.shattered) continue;
      const dx = gp.x - x, dz = gp.z - z;
      if (dx * dx + dz * dz <= r2) { burstPane(gp); if (++n > 50) break; }
    }
    if (n > 0 && CBZ.sfx) CBZ.sfx("glass");
    return n;
  };
  // SHOOTING a window: ray-test (origin, dir) against every intact pane and burst
  // the NEAREST one the bullet actually passes through, within maxDist. Glass has
  // no collider in the gun's wall raycast, so the shot passes through it invisibly —
  // this is what makes the pane you fired through actually break. Returns the rec.
  CBZ.cityShatterRay = function (ox, oy, oz, dx, dy, dz, maxDist) {
    const nl = Math.hypot(dx, dy, dz) || 1; dx /= nl; dy /= nl; dz /= nl;
    const lim = maxDist != null ? maxDist : 1e9;
    let best = null, bestT = lim;
    for (let i = 0; i < cityGlass.length; i++) {
      const gp = cityGlass[i]; if (gp.shattered) continue;
      let tmin = -1e9, tmax = 1e9;                     // ray-vs-AABB slab test
      if (Math.abs(dx) < 1e-8) { if (Math.abs(gp.x - ox) > gp.hw) continue; }
      else { let a = ((gp.x - gp.hw) - ox) / dx, b = ((gp.x + gp.hw) - ox) / dx; if (a > b) { const s = a; a = b; b = s; } if (a > tmin) tmin = a; if (b < tmax) tmax = b; }
      if (Math.abs(dy) < 1e-8) { if (Math.abs(gp.y - oy) > gp.hh) continue; }
      else { let a = ((gp.y - gp.hh) - oy) / dy, b = ((gp.y + gp.hh) - oy) / dy; if (a > b) { const s = a; a = b; b = s; } if (a > tmin) tmin = a; if (b < tmax) tmax = b; }
      if (Math.abs(dz) < 1e-8) { if (Math.abs(gp.z - oz) > gp.hd) continue; }
      else { let a = ((gp.z - gp.hd) - oz) / dz, b = ((gp.z + gp.hd) - oz) / dz; if (a > b) { const s = a; a = b; b = s; } if (a > tmin) tmin = a; if (b < tmax) tmax = b; }
      if (tmax < tmin || tmax < 0) continue;            // miss / entirely behind the muzzle
      const t = tmin > 0 ? tmin : 0;                    // entry distance (0 if muzzle inside the pane)
      if (t < bestT) { bestT = t; best = gp; }
    }
    if (best) { burstPane(best); if (CBZ.sfx) CBZ.sfx("glass"); }
    return best;
  };
  // re-glaze the whole city for a new game (restore panes + their colliders)
  CBZ.cityGlassReset = function () {
    for (const gp of cityGlass) {
      if (gp.shattered) {
        gp.shattered = false; gp.mesh.visible = true;
        if (gp.col && CBZ.colliders.indexOf(gp.col) === -1) CBZ.colliders.push(gp.col);
      }
    }
    for (const s of cityShards) CBZ.scene.remove(s.mesh);
    cityShards.length = 0;
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  };
  // shard physics (cheap; only does work while shards exist)
  CBZ.onAlways(9, function (dt) {
    if (!cityShards.length) return;
    const G = (CBZ.TUNE && CBZ.TUNE.gravity) || 22;
    for (let i = cityShards.length - 1; i >= 0; i--) {
      const s = cityShards[i]; s.life -= dt; s.vy -= G * dt;
      const p = s.mesh.position;
      p.x += s.vx * dt; p.y += s.vy * dt; p.z += s.vz * dt;
      s.mesh.rotation.x += s.spin * dt; s.mesh.rotation.z += s.spin * 0.6 * dt;
      const fl = (CBZ.floorAt ? CBZ.floorAt(p.x, p.z) : 0) + 0.04;
      if (p.y <= fl) { p.y = fl; s.vy = 0; s.vx *= 0.3; s.vz *= 0.3; s.spin *= 0.3; }
      if (s.life <= 0) { CBZ.scene.remove(s.mesh); cityShards.splice(i, 1); }
    }
  });

  // Business catalogue. `sign` = awning/sign colour; `name` shown on the
  // door + HUD; `kind` = the shop kind city/shops.js switches on.
  const SHOPS = [
    { kind: "guns",     name: "Ammu-Nation",     sign: 0x394b2e, storeys: 1 },
    { kind: "jewelry",  name: "Bling Jewelers",  sign: 0xf2c43d, storeys: 1 },
    { kind: "pawn",     name: "Pawn & Loan",     sign: 0x8a5a2b, storeys: 1 },
    { kind: "gas",      name: "Gas Station",     sign: 0xe24b4b, storeys: 1, gas: true },
    { kind: "clothing", name: "Threads & Drip",  sign: 0xc792ea, storeys: 1 },
    { kind: "drugs",    name: "The Trap House",  sign: 0x4caf6e, storeys: 1 },
    { kind: "food",     name: "Cluckin' Diner",  sign: 0xff9e6b, storeys: 1 },
    { kind: "bar",      name: "Velvet Club",     sign: 0xe85d8a, storeys: 2 },
    { kind: "bank",     name: "City Bank",       sign: 0x5b8bff, storeys: 2 },
    { kind: "hardware", name: "Hardware Depot",  sign: 0xffd166, storeys: 1 },
    { kind: "gym",      name: "Iron Gym",        sign: 0x66d9c0, storeys: 1 },
    { kind: "security", name: "Sentinel Security", sign: 0x49566b, storeys: 1 },
    { kind: "hospital", name: "City Hospital",   sign: 0xe8e8ee, storeys: 2, hospital: true },
    { kind: "barber",   name: "Fresh Cuts",      sign: 0x6bb6ff, storeys: 1 },
    { kind: "electronics", name: "Volt Electronics", sign: 0x39d0c0, storeys: 1 },
    { kind: "carlot",   name: "Premium Autos",   sign: 0xe88a3c, storeys: 1, carlot: true },
    { kind: "realtor",  name: "Keystone Realty", sign: 0x4fd0a0, storeys: 1, realtor: true },
    { kind: "chop",     name: "Benny's Chop Shop", sign: 0xd0a23c, storeys: 1, chop: true },
    { kind: "casino",   name: "Grand Casino",    sign: 0xc9a227, storeys: 2 },
    { kind: "raceway",  name: "City Speedway",   sign: 0x2f6fed, storeys: 1 },
    { kind: "arena",    name: "Civic Fight Arena", sign: 0xd94f45, storeys: 2 },
    { kind: "paintball", name: "Paintball Yard", sign: 0x7ed957, storeys: 1 },
    { kind: "transit",  name: "Central Transit", sign: 0x39c0d0, storeys: 1 },
    { kind: "cityhall", name: "City Hall",       sign: 0xd8dde8, storeys: 2 },
    { kind: "airfield", name: "Airfield Office", sign: 0x8a93a3, storeys: 1 },
    { kind: "racepark", name: "Race Park",       sign: 0xb98a5a, storeys: 1 },
  ];
  const TOWER_PALETTE = [0x5b6b82, 0x6f7e96, 0x8a98ac, 0x49566b, 0x7a6f8c, 0x5e7d86];
  const ABANDONED_PALETTE = [0x4a4438, 0x3f4640, 0x534a44, 0x46423c, 0x4c4640];
  const BOARD = 0x6b4a2a;

  // cached graffiti texture (a coloured tag splat) so abandoned walls vary cheaply
  const grafCache = new Map();
  function graffitiTex(hex) {
    let t = grafCache.get(hex);
    if (t) return t;
    const c = document.createElement("canvas"); c.width = 128; c.height = 64;
    const x = c.getContext("2d");
    x.clearRect(0, 0, 128, 64);
    const col = "#" + ("000000" + hex.toString(16)).slice(-6);
    x.strokeStyle = col; x.lineWidth = 5; x.lineCap = "round";
    // a few deterministic spray strokes
    const pts = [[14, 44, 40, 18], [40, 18, 64, 46], [64, 46, 92, 16], [92, 16, 116, 44], [22, 30, 104, 34]];
    for (const [a, b, cc, d] of pts) { x.beginPath(); x.moveTo(a, b); x.lineTo(cc, d); x.stroke(); }
    x.globalAlpha = 0.5; x.fillStyle = col;
    for (let i = 0; i < 18; i++) x.fillRect((i * 37) % 120, (i * 53) % 56, 3, 3);
    const tex = new THREE.CanvasTexture(c);
    tex.transparent = true;
    grafCache.set(hex, tex);
    return tex;
  }

  // ---- the enterable building (one group; switchback stairs to the roof) ----
  // opts: { boarded:bool (board windows instead of glass), grime:bool }
  function makeBuilding(root, ox, oz, w, d, storeys, color, doorSide, opts) {
    opts = opts || {};
    const bgroup = new THREE.Group();
    bgroup.position.set(ox, 0, oz);
    root.add(bgroup);
    const cols = [], plats = [], windows = [];
    const ixMin = -w / 2 + WT, ixMax = w / 2 - WT;
    const izMin = -d / 2 + WT, izMax = d / 2 - WT;
    const stairW = Math.min(SW, Math.max(0, ixMax - ixMin - 4.2));
    const hasStairs = opts.stairs !== false && storeys > 1 && stairW >= 4.4 && (izMax - izMin) >= 8.5;
    const localDoor = doorInfo(0, 0, w, d, doorSide);

    // Interior decoration is allowed only outside the entrance aisle and the
    // dedicated stairwell. The aisle reaches from just outside the door into
    // the room so furniture never makes an enterable building feel blocked.
    function clearFloorPoint(lx, lz, pad) {
      pad = pad == null ? 0.8 : pad;
      const dx = lx - localDoor.x, dz = lz - localDoor.z;
      const inward = dx * localDoor.nx + dz * localDoor.nz;
      const cross = Math.abs(dx * localDoor.nz - dz * localDoor.nx);
      if (inward > -0.8 && inward < 4.8 && cross < DOORW / 2 + pad) return false;
      if (hasStairs && lx < ixMin + stairW + pad && lx > ixMin - pad && lz > izMin - pad && lz < izMax + pad) return false;
      return lx > ixMin + pad && lx < ixMax - pad && lz > izMin + pad && lz < izMax - pad;
    }

    function lbox(lx, ly, lz, bw, bh, bd, col, o) {
      o = o || {};
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat(col, o.emissive ? { emissive: o.emissive, ei: o.ei || 0.5 } : null));
      m.position.set(lx, ly, lz);
      m.castShadow = o.cast !== false; m.receiveShadow = true;
      bgroup.add(m);
      if (o.solid) {
        const c = { minX: ox + lx - bw / 2, maxX: ox + lx + bw / 2, minZ: oz + lz - bd / 2, maxZ: oz + lz + bd / 2, ref: m, y0: ly - bh / 2, y1: ly + bh / 2 };
        CBZ.colliders.push(c); cols.push(c);
      }
      if (o.plat) { const p = { minX: ox + lx - bw / 2, maxX: ox + lx + bw / 2, minZ: oz + lz - bd / 2, maxZ: oz + lz + bd / 2, top: ly + bh / 2 }; CBZ.platforms.push(p); plats.push(p); }
      if (o.los) CBZ.losBlockers.push(m);
      return m;
    }

    // foundation floor slab — its TOP must sit ABOVE the lot's grass yard pad
    // (world.js draws a grass plane at y≈0.10 on every lot) or you'd see grass
    // through the ground floor. Top at 0.14 (a tiny doorway step the forgiving
    // auto-climb absorbs) covers the lawn so the interior reads as a real floor.
    lbox(0, -0.21, 0, w - WT, 0.7, d - WT, opts.boarded ? 0x40433f : 0x5c626b, { plat: true });

    // doorSide: 0=-z (front), 1=+z, 2=-x, 3=+x. Door pierces the ground floor.
    const wallOpt = { solid: true, los: true };
    const modern = storeys >= 3;   // tall towers get fuller, near floor-to-ceiling glass

    // SHOWROOM GARAGE FRONT (gas / car lot / chop shop): no plain door — a wide
    // roll-up GARAGE BAY you drive a car straight into, framed by big SOLID
    // showroom glass that shatters into a drive-through hole if you smash it.
    function showroomFront(f) {
      const ly = FH / 2;
      const GW = Math.min(3.6, (f.horiz ? w : d) * 0.42);   // garage opening width
      const HDR = FH - 0.9;                                   // header bottom
      if (f.horiz) {
        const zz = f.z, off = (f.s === 0 ? 0.06 : -0.06);
        lbox(-w / 2 + 0.35, ly, zz, 0.7, FH, WT, color, wallOpt);
        lbox(w / 2 - 0.35, ly, zz, 0.7, FH, WT, color, wallOpt);
        lbox(0, HDR + (FH - HDR) / 2, zz, GW + 0.5, FH - HDR, WT, color, { solid: true, los: true });   // header (drive under)
        lbox(0, HDR - 0.5, zz + off, GW - 0.3, 0.9, 0.14, 0x8a93a0, { cast: false });                   // rolled-up door
        for (let s = 0; s < 4; s++) lbox(0, HDR - 0.2 - s * 0.2, zz + off * 1.2, GW - 0.4, 0.05, 0.18, 0x6b7480, { cast: false });
        const a = -w / 2 + 0.7, bb = -GW / 2 - 0.15, cxL = (a + bb) / 2, wL = bb - a;
        addCityGlass(bgroup, cxL, ly, zz, wL, FH * 0.86, 0.07, ox, oz, { solid: true }, windows);
        addCityGlass(bgroup, -cxL, ly, zz, wL, FH * 0.86, 0.07, ox, oz, { solid: true }, windows);
      } else {
        const xx = f.x, off = (f.s === 2 ? 0.06 : -0.06);
        lbox(xx, ly, -d / 2 + 0.35, WT, FH, 0.7, color, wallOpt);
        lbox(xx, ly, d / 2 - 0.35, WT, FH, 0.7, color, wallOpt);
        lbox(xx, HDR + (FH - HDR) / 2, 0, WT, FH - HDR, GW + 0.5, color, { solid: true, los: true });
        lbox(xx + off, HDR - 0.5, 0, 0.14, 0.9, GW - 0.3, 0x8a93a0, { cast: false });
        for (let s = 0; s < 4; s++) lbox(xx + off * 1.2, HDR - 0.2 - s * 0.2, 0, 0.18, 0.05, GW - 0.4, 0x6b7480, { cast: false });
        const a = -d / 2 + 0.7, bb = -GW / 2 - 0.15, czL = (a + bb) / 2, dL = bb - a;
        addCityGlass(bgroup, xx, ly, czL, 0.07, FH * 0.86, dL, ox, oz, { solid: true }, windows);
        addCityGlass(bgroup, xx, ly, -czL, 0.07, FH * 0.86, dL, ox, oz, { solid: true }, windows);
      }
    }

    for (let k = 0; k < storeys; k++) {
      const ly = k * FH + FH / 2;
      const faces = [
        { s: 0, x: 0, z: -d / 2 + WT / 2, w: w, dd: WT, horiz: true },
        { s: 1, x: 0, z: d / 2 - WT / 2, w: w, dd: WT, horiz: true },
        { s: 2, x: -w / 2 + WT / 2, z: 0, w: WT, dd: d, horiz: false },
        { s: 3, x: w / 2 - WT / 2, z: 0, w: WT, dd: d, horiz: false },
      ];
      for (const f of faces) {
        if (k === 0 && f.s === doorSide) {
          if (opts.showroom) {
            showroomFront(f);
          } else if (f.horiz) {
            const side = (w - DOORW) / 2;
            lbox(-(DOORW / 2 + side / 2), ly, f.z, side, FH, WT, color, wallOpt);
            lbox(DOORW / 2 + side / 2, ly, f.z, side, FH, WT, color, wallOpt);
            lbox(0, FH - 0.35, f.z, DOORW, 0.7, WT, color, { los: true });
          } else {
            const side = (d - DOORW) / 2;
            lbox(f.x, ly, -(DOORW / 2 + side / 2), WT, FH, side, color, wallOpt);
            lbox(f.x, ly, DOORW / 2 + side / 2, WT, FH, side, color, wallOpt);
            lbox(f.x, FH - 0.35, 0, WT, 0.7, DOORW, color, { los: true });
          }
        } else {
          lbox(f.x, ly, f.z, f.w, FH, f.dd, color, wallOpt);
          // window band — glass glow on real buildings, boarded planks on derelicts
          const wy = ly + 0.3;
          if (opts.boarded) {
            const bw2 = f.horiz ? Math.min(w * 0.55, 4.4) : 0.06;
            const bd2 = f.horiz ? 0.06 : Math.min(d * 0.55, 4.4);
            const off = f.horiz ? (f.s === 0 ? 0.21 : -0.21) : (f.s === 2 ? 0.21 : -0.21);
            for (let p = -1; p <= 1; p++) {
              lbox(f.x + (f.horiz ? 0 : off), wy + p * 0.5, f.z + (f.horiz ? off : 0),
                f.horiz ? bw2 : 0.06, 0.22, f.horiz ? 0.06 : bd2, BOARD, { cast: false });
            }
          } else {
            // big shatterable glass — a row of tall panes (a real modern window
            // band; even taller/wider on tall "modern" towers → a glass curtain wall)
            const wy2 = ly + 0.2, ph = FH * (modern ? 0.74 : 0.56), off = 0.22;
            if (f.horiz) {
              const zz = f.z + (f.s === 0 ? off : -off), span = w - 1.1;
              const nn = Math.max(2, Math.min(4, Math.round(w / 2.6))), step = span / nn;
              for (let i = 0; i < nn; i++) addCityGlass(bgroup, -span / 2 + (i + 0.5) * step, wy2, zz, step * 0.84, ph, 0.05, ox, oz, null, windows);
            } else {
              const xx = f.x + (f.s === 2 ? off : -off), span = d - 1.1;
              const nn = Math.max(2, Math.min(4, Math.round(d / 2.6))), step = span / nn;
              for (let i = 0; i < nn; i++) addCityGlass(bgroup, xx, wy2, -span / 2 + (i + 0.5) * step, 0.05, ph, step * 0.84, ox, oz, null, windows);
            }
          }
        }
      }
    }

    // Single-storey shops do not need a giant customer-facing rooftop stair
    // rig. Climbable buildings reserve a dedicated open strip on the -x side.
    const slabMinX = hasStairs ? ixMin + stairW : ixMin;
    const slabW = ixMax - slabMinX, slabCx = (slabMinX + ixMax) / 2, slabD = izMax - izMin, slabCz = (izMin + izMax) / 2;
    for (let L = 1; L <= storeys; L++) {
      const isRoof = L === storeys;
      lbox(slabCx, L * FH - 0.1, slabCz, slabW, 0.2, slabD, isRoof ? 0x9fa6ad : 0xb9bec6, { plat: true, los: true, cast: isRoof });
    }
    const rTop = storeys * FH;
    lbox(slabCx, rTop + 0.35, d / 2 - WT / 2, slabW, 0.7, WT, 0x8b9097, { los: true });
    lbox(w / 2 - WT / 2, rTop + 0.35, slabCz, WT, 0.7, slabD, 0x8b9097, { los: true });
    lbox(slabCx, rTop + 0.35, -d / 2 + WT / 2, slabW, 0.7, WT, 0x8b9097, { los: true });
    lbox(-w / 2 + WT / 2, rTop + 0.35, slabCz, WT, 0.7, slabD, 0x8b9097, { los: true });

    // switchback stairs (two lanes alternating; ported from disaster_arena)
    const nSteps = 9, LD = 1.1, zA = izMin + 0.3, zB = izMax - 0.3, laneW = stairW / 2;
    for (let k = 0; hasStairs && k < storeys; k++) {
      const dir = (k % 2 === 0) ? 1 : -1;
      const startZ = dir > 0 ? zA : zB, endZ = dir > 0 ? zB : zA;
      const rampEndZ = endZ - dir * LD;
      const lx0 = (k % 2 === 0) ? ixMin : ixMin + laneW, lxc = lx0 + laneW / 2;
      const ramp = {
        minX: ox + lx0 + 0.04, maxX: ox + lx0 + laneW - 0.04,
        minZ: oz + Math.min(startZ, rampEndZ), maxZ: oz + Math.max(startZ, rampEndZ),
        top: (k + 1) * FH,
        ramp: { z0: oz + startZ, z1: oz + rampEndZ, y0: k * FH, y1: (k + 1) * FH },
      };
      CBZ.platforms.push(ramp); plats.push(ramp);
      const runLen = Math.abs(rampEndZ - startZ), runDepth = runLen / nSteps, rise = FH / nSteps;
      for (let i = 1; i <= nSteps; i++) {
        const vtop = k * FH + (i - 0.5) * rise, cz2 = startZ + dir * (i - 0.5) * runDepth;
        lbox(lxc, vtop - 0.13, cz2, laneW - 0.16, 0.26, runDepth + 0.04, 0xa7adb5, { cast: false });
      }
      const lzc = (rampEndZ + endZ) / 2;
      lbox(ixMin + stairW / 2, (k + 1) * FH - 0.1, lzc, stairW, 0.2, LD + 0.2, 0xb4b9c1, { plat: true, los: true, cast: false });
    }

    return { group: bgroup, ox, oz, w, d, h: storeys * FH, storeys, colliders: cols, platforms: plats, windows, lbox, FH,
      hasStairs, stairW, clearFloorPoint,
      roofCx: ox + slabCx, roofCz: oz + slabCz };   // world centre of the solid roof slab (clear of the -x stairwell)
  }
  // The connected island district reuses the exact same enterable shell and
  // stair rig, so every added tower behaves like the original city buildings.
  CBZ.cityMakeBuilding = makeBuilding;

  // doorway world position + the inward normal, given the door side
  function doorInfo(ox, oz, w, d, side) {
    if (side === 0) return { x: ox, z: oz - d / 2, nx: 0, nz: 1 };
    if (side === 1) return { x: ox, z: oz + d / 2, nx: 0, nz: -1 };
    if (side === 2) return { x: ox - w / 2, z: oz, nx: 1, nz: 0 };
    return { x: ox + w / 2, z: oz, nx: -1, nz: 0 };
  }

  // ---- interior furnishing (cheap boxes; only the counter is a collider) ----
  function furnishShop(b, lot, door) {
    const cx = -door.nx * (b.w / 2 - 4), cz = -door.nz * (b.d / 2 - 4);   // toward the door area
    // Product shelving hugs both side walls and leaves the reserved entrance
    // aisle open. This makes stores read as rooms instead of empty boxes.
    const dx0 = -door.nx * b.w / 2, dz0 = -door.nz * b.d / 2;
    const cross = (door.nz ? b.w : b.d) / 2 - 1.15;
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
      const depth = 5.5 + i * 2.7;
      const sx = dx0 + door.nx * depth + door.nz * side * cross;
      const sz = dz0 + door.nz * depth - door.nx * side * cross;
      if (!b.clearFloorPoint || b.clearFloorPoint(sx, sz, 0.9)) {
        const sw = door.nz ? 0.65 : 2.0, sd = door.nz ? 2.0 : 0.65;
        b.lbox(sx, 0.7, sz, sw, 1.4, sd, 0x6a7078, { cast: false });
        b.lbox(sx, 1.45, sz, sw, 0.1, sd, 0x8a939c, { cast: false });
      }
    }
    // floor mat at the entrance
    b.lbox(cx * 0.4, -0.0, cz * 0.4, 2.2, 0.04, 2.2, lot.building && lot.building.sign ? 0x3a3f47 : 0x3a3f47, { cast: false });
    // cheap ceiling strip: one mesh gives the otherwise boxy room a focal point
    b.lbox(0, b.FH - 0.35, 0, door.nz ? 3.4 : 0.55, 0.08, door.nz ? 0.55 : 3.4, 0xffe9a8, { emissive: 0xffcf66, ei: 0.38, cast: false });
  }

  function furnishHome(b, rng) {
    // ground-floor living space: a bed, a couch, a table, a kitchen counter
    const W = b.w, D = b.d;
    const cz = D / 2 - 2.0;
    function decor(x, y, z, w, h, d, color, pad) {
      if (!b.clearFloorPoint || b.clearFloorPoint(x, z, pad)) b.lbox(x, y, z, w, h, d, color, { cast: false });
    }
    decor(-W / 2 + 2.0, 0.4, -D / 2 + 2.2, 2.0, 0.5, 1.2, 0x6b7da0, 1.1);   // bed base
    decor(-W / 2 + 2.0, 0.85, -D / 2 + 1.7, 2.0, 0.25, 0.5, 0xe8e8ee, 1.1); // pillow
    decor(W / 2 - 2.4, 0.45, -D / 2 + 2.4, 2.4, 0.6, 1.0, 0x8a5a2b, 1.2);    // couch
    decor(0, 0.4, 0, 1.4, 0.5, 0.9, 0x9aa0a8, 1.0);                          // coffee table
    decor(W / 2 - 1.6, 0.6, cz, 1.0, 1.0, Math.min(D - 3, 4), 0x55606e, 1.0); // kitchen counter
  }

  function abandonDecor(b, rng, gangColor) {
    // graffiti on a couple of interior + exterior walls
    const gtex = graffitiTex(gangColor || 0xb079ea);
    for (let i = 0; i < 3; i++) {
      const gp = new THREE.Mesh(new THREE.PlaneGeometry(2.6 + rng() * 1.5, 1.4 + rng()),
        new THREE.MeshBasicMaterial({ map: gtex, transparent: true, depthWrite: false }));
      const face = (rng() * 4) | 0;
      const inset = 0.25;
      if (face === 0) { gp.position.set((rng() - 0.5) * (b.w - 3), 1.6, -b.d / 2 + inset); }
      else if (face === 1) { gp.position.set((rng() - 0.5) * (b.w - 3), 1.6, b.d / 2 - inset); gp.rotation.y = Math.PI; }
      else if (face === 2) { gp.position.set(-b.w / 2 + inset, 1.6, (rng() - 0.5) * (b.d - 3)); gp.rotation.y = Math.PI / 2; }
      else { gp.position.set(b.w / 2 - inset, 1.6, (rng() - 0.5) * (b.d - 3)); gp.rotation.y = -Math.PI / 2; }
      b.group.add(gp);
    }
    // trash / debris on the floor
    for (let i = 0; i < 6; i++) {
      let x = 0, z = 0, tries = 0;
      do { x = (rng() - 0.5) * (b.w - 3); z = (rng() - 0.5) * (b.d - 3); tries++; }
      while (tries < 8 && b.clearFloorPoint && !b.clearFloorPoint(x, z, 0.7));
      if (b.clearFloorPoint && !b.clearFloorPoint(x, z, 0.7)) continue;
      const s = 0.3 + rng() * 0.6;
      b.lbox(x, s / 2, z, s, s * (0.4 + rng()), s, [0x2f2c28, 0x3a352e, 0x444038][(rng() * 3) | 0], { cast: false });
    }
    // a busted-out couch
    if (!b.clearFloorPoint || b.clearFloorPoint(-b.w / 2 + 2.2, b.d / 2 - 2.4, 1.2)) {
      b.lbox(-b.w / 2 + 2.2, 0.4, b.d / 2 - 2.4, 2.0, 0.5, 0.9, 0x4a423a, { cast: false });
    }
  }

  function makeStash(b, lot, gangColor) {
    // a duffel + crate near the back wall — the gang's cash/drugs/gun cache
    const sx = lot.cx, sz = lot.cz;
    const duffel = b.lbox(0, 0.35, b.d / 2 - 2.6, 1.0, 0.5, 0.5, 0x2a2f26, { emissive: gangColor || 0x4caf6e, ei: 0.18, cast: false });
    duffel.userData.transient = false;
    lot.building.stash = {
      x: sx, z: sz + (b.d / 2 - 2.6) * 0, looted: false,
      // wealth set when the gang takes the building (city/gangs.js may bump it)
      cash: 300 + ((b.storeys || 1) * 150), drugs: 1 + ((b.storeys || 1)), weapon: null,
      mesh: duffel,
    };
    // place the stash world point near the back-centre of the building
    lot.building.stash.x = lot.cx;
    lot.building.stash.z = lot.cz + (b.d / 2 - 2.6);
  }

  CBZ.cityBuildings = function (city) {
    const root = city.root, rng = city.rng;
    const C = CBZ.CITY;
    const placed = [], abandonedLots = [], homeLots = [];
    let chopShop = null, realtor = null, luxury = null;

    // shuffle the shop list, then float the gameplay-critical trades to the
    // front so they ALWAYS get placed; the rest fill in only sometimes, leaving
    // plenty of lots free to become residences (the property ladder).
    const ESSENTIAL = new Set(["guns", "drugs", "bank", "hospital", "food", "pawn", "realtor", "chop", "carlot", "jewelry", "clothing", "gym", "casino", "raceway", "arena", "transit", "cityhall"]);
    let shopQueue = SHOPS.slice();
    for (let i = shopQueue.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = shopQueue[i]; shopQueue[i] = shopQueue[j]; shopQueue[j] = t; }
    shopQueue = shopQueue.filter((s) => ESSENTIAL.has(s.kind)).concat(shopQueue.filter((s) => !ESSENTIAL.has(s.kind)));
    const nEssential = shopQueue.filter((s) => ESSENTIAL.has(s.kind)).length;
    let shopIdx = 0;

    // pick the flagship LUXURY tower lot (a corner, far from centre) up front
    let lux = null, bestD = -1;
    for (const lot of city.lots) {
      const dd = Math.hypot(lot.cx - city.center.x, lot.cz - city.center.z);
      if (dd > bestD) { bestD = dd; lux = lot; }
    }

    const HOME_TIERS = (C.homes || []).filter((h) => h.tier > 0);
    const NONLUX_TIERS = HOME_TIERS.filter((h) => !h.elevator);   // studio / apt / condo
    const PENTHOUSE = HOME_TIERS.find((h) => h.elevator) || HOME_TIERS[HOME_TIERS.length - 1];
    let homeTierIdx = 0;

    for (const lot of city.lots) {
      const isLux = lot === lux;
      const r = rng();
      // parks (open plazas) for breathing room — fewer than before
      if (!isLux && r < (C.parkFrac || 0.08)) { lot.kind = "park"; makePark(root, lot, rng); placed.push(lot); continue; }

      const w = lot.w - 2, d = lot.d - 2;
      const toCx = city.center.x - lot.cx, toCz = city.center.z - lot.cz;
      const side = Math.abs(toCx) > Math.abs(toCz) ? (toCx > 0 ? 3 : 2) : (toCz > 0 ? 1 : 0);
      const door = doorInfo(lot.cx, lot.cz, w, d, side);
      const doorPt = { x: door.x + door.nx * 1.6, z: door.z + door.nz * 1.6, nx: door.nx, nz: door.nz };

      // ---- ABANDONED / gang-run derelict ----
      if (!isLux && r < (C.parkFrac || 0.08) + (C.abandonedFrac || 0.30)) {
        const storeys = 1 + ((rng() * 3) | 0);
        const color = ABANDONED_PALETTE[(rng() * ABANDONED_PALETTE.length) | 0];
        const b = makeBuilding(root, lot.cx, lot.cz, w, d, storeys, color, side, { boarded: true });
        lot.kind = "abandoned";
        lot.building = { ...b, name: "Abandoned Building", sign: color, side, door: doorPt, abandoned: true, gang: null };
        abandonDecor(b, rng, 0xb079ea);
        makeStash(b, lot, 0x4caf6e);
        abandonedLots.push(lot);
        placed.push(lot);
        continue;
      }

      // ---- REAL: a business or a residence (and never a shop on the luxury lot) ----
      // Essentials are placed unconditionally; extras only ~40% of the time, so
      // the remaining real lots become furnished, sellable HOMES.
      let shop = null;
      if (!isLux) {
        if (shopIdx < nEssential) shop = shopQueue[shopIdx++];
        else if (shopIdx < shopQueue.length && rng() < 0.4) shop = shopQueue[shopIdx++];
      }

      if (shop) {
        const color = lightenWall(shop.sign);
        const b = makeBuilding(root, lot.cx, lot.cz, w, d, shop.storeys, color, side, { showroom: !!(shop.gas || shop.carlot || shop.chop) });
        signAwning(b, side, w, d, shop.sign, shop.name);
        // Counter toward the back, vendor behind it. On climbable buildings the
        // counter is shifted onto the solid side of the room so it never crosses
        // the dedicated stair strip.
        let ccx = door.nx * (w / 2 - 2.8), ccz = door.nz * (d / 2 - 2.8);
        let cw = door.nx ? 0.8 : Math.min(w - 2, 4.5);
        const cd = door.nz ? 0.8 : Math.min(d - 2, 4.5);
        if (b.hasStairs) {
          const stairRight = -w / 2 + WT + b.stairW;
          if (cw > 1) {
            const roomRight = w / 2 - WT;
            cw = Math.min(cw, Math.max(1.8, roomRight - stairRight - 1.0));
            ccx = (stairRight + roomRight) / 2;
          } else if (ccx - cw / 2 < stairRight + 0.5) {
            ccx = stairRight + 0.5 + cw / 2;
          }
          // Side-door layouts can point the behind-counter spot back toward the
          // stair strip. Keep the clerk on the solid floor too.
          ccx = Math.max(ccx, stairRight + 0.4 - door.nx * 1.2);
        }
        b.lbox(ccx, 0.6, ccz, cw, 1.2, cd, 0x6b4a2a, { solid: true });
        const vsx = lot.cx + ccx + door.nx * 1.2, vsz = lot.cz + ccz + door.nz * 1.2;
        lot.kind = shop.kind;
        lot.building = {
          ...b, shop, name: shop.name, sign: shop.sign, side, door: doorPt,
          vendorSpot: { x: vsx, z: vsz, face: Math.atan2(-door.nx, -door.nz) },
          gas: !!shop.gas, hospital: !!shop.hospital, carlot: !!shop.carlot,
          realtor: !!shop.realtor, chop: !!shop.chop,
        };
        furnishShop(b, lot, door);
        if (shop.chop) {
          chopShop = lot;
          // a drive-in sell bay just outside the door
          lot.building.chopZone = { x: door.x + door.nx * 5, z: door.z + door.nz * 5, r: 5.5 };
        }
        if (shop.realtor) realtor = lot;
      } else {
        // residence / office tower — enterable, climbable, FURNISHED, a HOME
        const storeys = isLux ? 5 : 2 + ((rng() * 3) | 0);
        const color = TOWER_PALETTE[(rng() * TOWER_PALETTE.length) | 0];
        const b = makeBuilding(root, lot.cx, lot.cz, w, d, storeys, color, side);
        furnishHome(b, rng);
        lot.kind = "tower";
        lot.building = { ...b, name: "Apartments", sign: color, side, door: doorPt };
        // assign a home tier so the realtor can sell/rent it
        let tierDef;
        if (isLux) tierDef = PENTHOUSE;                                         // flagship penthouse
        else { tierDef = NONLUX_TIERS[homeTierIdx % NONLUX_TIERS.length]; homeTierIdx++; }
        lot.building.home = {
          tier: tierDef.tier, id: tierDef.id, name: tierDef.name, price: tierDef.price, rent: tierDef.rent || 0,
          beds: tierDef.beds, garage: tierDef.garage, elevator: !!tierDef.elevator, owned: false,
          floorY: (storeys - 1) * FH,          // penthouse floor height (for the elevator)
          door: doorPt,
        };
        lot.building.name = tierDef.name;
        homeLots.push(lot);
        if (isLux) {
          luxury = lot;
          // ground-floor garage zone beside the door
          lot.building.garage = { x: door.x + door.nx * 4.5, z: door.z + door.nz * 4.5, spots: [] };
          lot.building.elevatorPad = { x: lot.cx - (w / 2 - 2.0), z: lot.cz, floorY: (storeys - 1) * FH };
        }
      }
      placed.push(lot);
    }

    city.shopLots = placed.filter((l) => l.building && l.building.shop);
    city.abandonedLots = abandonedLots;
    city.homeLots = homeLots;
    city.chopShop = chopShop;
    city.realtor = realtor;
    city.luxuryLot = luxury;
  };

  // a real STOREFRONT: lit sign board + canopy awning + display windows flanking
  // the door + a door frame. `along` = the facade runs perpendicular to the door
  // normal, so detail is laid out left/right of the entrance.
  function signAwning(b, side, w, d, color, name) {
    const di = doorInfo(0, 0, w, d, side);
    const along = Math.abs(di.nx) > 0.5;          // door faces ±X → storefront spans Z
    const tx = along ? 0 : 1, tz = along ? 1 : 0; // facade tangent
    const sw = DOORW + 2.4;
    const fx = (lw, h, ld) => (along ? [ld, h, lw] : [lw, h, ld]);   // size helper (swap by facing)
    // CANOPY awning over the door (angled colour band)
    const awn = new THREE.Mesh(new THREE.BoxGeometry(...fx(sw, 0.32, 1.1)), mat(color, { emissive: color, ei: 0.4 }));
    awn.position.set(di.x + di.nx * 0.75, FH - 0.7, di.z + di.nz * 0.75); awn.rotation[along ? "x" : "z"] = -0.22 * (along ? -di.nx || 1 : 1);
    b.group.add(awn);
    // LIT SIGN BOARD across the facade above the awning
    const sign = new THREE.Mesh(new THREE.BoxGeometry(...fx(sw + 0.8, 1.0, 0.18)), mat(color, { emissive: color, ei: 0.85 }));
    sign.position.set(di.x + di.nx * 0.18, FH + 0.35, di.z + di.nz * 0.18);
    b.group.add(sign);
    // DISPLAY WINDOWS flanking the entrance + a dark DOOR FRAME
    const frame = new THREE.Mesh(new THREE.BoxGeometry(...fx(DOORW + 0.5, 3.0, 0.22)), mat(0x20242b));
    frame.position.set(di.x + di.nx * 0.06, 1.5, di.z + di.nz * 0.06); b.group.add(frame);
    for (const s of [-1, 1]) {
      const ox2 = tx * s * (DOORW * 0.5 + 1.5), oz2 = tz * s * (DOORW * 0.5 + 1.5);
      const win = new THREE.Mesh(new THREE.BoxGeometry(...fx(2.2, 2.4, 0.1)), glassMat());
      win.position.set(di.x + ox2 + di.nx * 0.05, 1.7, di.z + oz2 + di.nz * 0.05); b.group.add(win);
      const sill = new THREE.Mesh(new THREE.BoxGeometry(...fx(2.5, 0.18, 0.26)), mat(0x2a2f37));
      sill.position.set(di.x + ox2 + di.nx * 0.04, 0.45, di.z + oz2 + di.nz * 0.04); b.group.add(sill);
    }
    if (CBZ.makeLabelSprite) {
      const s = CBZ.makeLabelSprite(name);
      if (s) { s.position.set(di.x + di.nx * 0.6, FH + 1.5, di.z + di.nz * 0.6); s.scale.set(8, 2.0, 1); b.group.add(s); }
    }
  }

  function makePark(root, lot, rng) {
    for (let i = 0; i < 4; i++) {
      const x = lot.cx + (rng() - 0.5) * lot.w * 0.7, z = lot.cz + (rng() - 0.5) * lot.d * 0.7;
      const th = 2.2 + rng() * 1.2;
      const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.5, th, 0.5), mat(0x6b4a2a));
      trunk.position.set(x, th / 2, z); trunk.castShadow = true; root.add(trunk);
      CBZ.colliders.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3, ref: trunk, noCam: true });
      const fol = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 2.6), mat(0x3f9a4f));
      fol.position.set(x, th + 1.0, z); fol.castShadow = true; root.add(fol);
    }
  }

  function lightenWall(hex) {
    const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    const lr = Math.round(r * 0.4 + 170 * 0.6), lg = Math.round(g * 0.4 + 174 * 0.6), lb = Math.round(b * 0.4 + 180 * 0.6);
    return (lr << 16) | (lg << 8) | lb;
  }
})();

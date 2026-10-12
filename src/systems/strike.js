/* ============================================================
   systems/strike.js — CBZ.strike: THE ONE IMPACT RESOLVER.

   Every round, rocket, missile, bomb and drone warhead that lands, in every
   game, comes through here:

       CBZ.strike(mun, pos, opts)

   `mun` is a weapons/munitiontable.js id ("m795", "gbu31v1", "javelin",
   "fpv_pg7vl"...). Everything the impact does is read off that row and the
   charge law (systems/breach.js), never typed by the caller:

     1. THE FUZE. A penetrating case (BLU-109, GBU-28, GBU-57, SDB, Harpoon)
        that struck a structure keeps going for `conc` metres of reinforced
        concrete before its delay fuze sets it off: it bursts INSIDE, a
        storey or ten down. Everything else bursts where it struck.
     2. THE PICTURE. city/crashfx.js's fireball, smoke and scorch, sized by
        the charge (visPower), drawn as the row's own look; its sound,
        attenuated by distance (the earshot is the charge's).
     3. THE PEOPLE AND HULLS. The mode's own blast verb (systems/modecaps.js
        blastWorldActors -> NPC War's physics.js blastBodies), handed the
        charge W so a hull is answered by munitionTable.blastOn (the blast's
        loading on its plate at that distance), not by a ring.
     4. THE BUILT WORLD. strike.structure: the wall the burst is against is
        carved by the law (buildings.js carveHole through fracture.js), the
        roof and floor slabs it reaches are opened (cityCarveShaft), storeys
        inside the law's gut radius are blown out floor to ceiling
        (collapse.gut), and a building whose banked damage passes its
        capacity, or that a charge guts across its whole plan, comes down
        (collapse.play: its own walls, slabs and glass, falling as pieces of
        themselves). Glass goes out to the law's Z_GLASS radius. In the city
        the city's own ledger (buildings.js blastBuildings -> structural.js)
        does all of this; everywhere else this file does it with the same law
        and the same collapse engine. A burst in the open does NOTHING to
        buildings: no invented rubble on bare sand.
     5. THE HARDWARE. strike.hardware: parked vehicles and aircraft that are
        props, not units (island_military.js placeModel: a collider whose ref
        is a group with userData.milKind). The same blastOn loading against
        that kind's skin; past its hit points it is a wreck: charred, sat
        down on its collapsed gear, burning, shedding its own plate.
     6. THE GROUND, THE CAMERA, THE ROWS. Observers (CBZ.strike.on(fn)) are
        told every burst with its charge: NPC War's arenas/ground.js digs the
        crater and throws the ground's own clods at W's scale, the director
        frames it, the tier sim takes it on its rows.

   CBZ.studio.boom(pos, opts) is this function: the door every page already
   calls (with opts.mun). A caller with no munition (a hull cooking off) may
   pass opts.W (kg TNT-eq), or radius/power, from which W is inverted.

   ALSO HERE, because every flown round needs it:
     CBZ.strike.sweep(ax,ay,az, bx,by,bz, opts) -> hit | null
        THE SWEPT TEST: the first thing a round's path for this step meets,
        exact against every collider's OWN height (a band-less collider is as
        tall as the thing it is: a building record's h, else its mesh's
        bounds), and the ground sampled under the segment and refined. A
        round flying 25 m a step no longer tunnels a wall, and a bomb falling
        past a building's footprint no longer bursts in the air above it.
============================================================ */
(function () {
  "use strict";
  const GW = typeof window !== "undefined" ? window : globalThis;
  const CBZ = GW.CBZ = GW.CBZ || {};
  if (CBZ.strike) return;

  const OBS = [];
  const stats = { strikes: 0, byMun: Object.create(null), walls: 0, roofs: 0, guts: 0, collapses: 0, wrecks: 0, open: 0 };

  function T() { return CBZ.munitionTable || null; }
  function L() { return CBZ.blastLaw || null; }
  function cbrt(x) { return Math.cbrt(Math.max(0, +x || 0)); }
  function groundY(x, z) {
    if (CBZ.floorAt) { try { const g = CBZ.floorAt(x, z); if (isFinite(g)) return g; } catch (e) {} }
    if (CBZ.groundAt) { try { const g = CBZ.groundAt(x, z); if (isFinite(g)) return g; } catch (e) {} }
    return 0;
  }

  /* the numbers of one strike: the row's, else a bare charge's */
  function resolveNumbers(mun, opts) {
    const MT = T();
    const f = mun && MT ? MT.fx(mun) : null;
    let W = opts.W > 0 ? +opts.W : (f ? f.W : 0);
    if (!(W > 0) && !f) {
      // a legacy caller: invert its battle radius (killR = 0.55 R = 4.2 W^(1/3))
      const R0 = opts.radius > 0 ? opts.radius : 18;
      W = Math.pow(0.55 * R0 / 4.2, 3);
    }
    const e = f && f.W === W ? f : (MT ? MT.effects(W, f ? MT.get(mun) : null) : null);
    const R = f ? f.R : (opts.radius > 0 ? opts.radius : (e ? e.R : 18));
    const power = f ? f.power : (opts.power > 0 ? opts.power : (e ? e.power : 1));
    return {
      f: f, W: W, R: R, power: power,
      vis: e ? e.visPower : Math.min(2.2, power), craterR: e ? e.craterR : 0.8 * cbrt(W),
      shaped: f ? f.shaped : !!opts.shaped, jet: f ? f.jet : (opts.jetPen || 0), conc: f ? f.conc : 0,
      look: (f && f.look) || opts.kind || null, id: f ? f.id : null,
    };
  }

  /* ======================================================================
     CBZ.strike — the resolver
     ====================================================================== */
  function strike(mun, pos, opts) {
    opts = opts || {};
    if (!pos) return null;
    // the city has its own front door (the ordnance bus): one call, its own
    // couplings, rows priced off the same table
    if (CBZ.game && CBZ.game.mode === "city" && CBZ.detonate && !opts._noBus) {
      const id = (mun && T() && T().get(mun)) ? T().get(mun).id : null;
      if (id) return CBZ.detonate(pos.x, pos.y || 0, pos.z, id, opts);
    }
    const N = resolveNumbers(mun, opts);
    stats.strikes++;
    if (N.id) stats.byMun[N.id] = (stats.byMun[N.id] || 0) + 1;
    const at = { x: +pos.x, y: +(pos.y || 0), z: +pos.z };

    // 1. THE FUZE: a penetrating case goes on into a structure before it bursts
    let inside = null;
    if (N.conc > 0 && opts.structural !== false) inside = penetrate(at, N, opts);
    // where it actually goes off: in the storey a penetrator stopped in
    const B = inside || at;

    // 2. THE PICTURE
    let drew = false;
    if (CBZ.cityBlastCore && opts.picture !== false) {
      try {
        const fireR = Math.max(1.2, 2.0 * cbrt(N.W));
        CBZ.cityBlastCore(B.x, B.z, {
          power: N.vis, radius: fireR / Math.max(0.2, N.vis), y: B.y || 1, noDamage: true,
          byPlayer: !!opts.byPlayer, kind: N.look || undefined, charge: N.W, shaped: N.shaped, jetPen: N.jet,
          airburst: !!opts.airburst || (opts.struck && opts.struck.kind === "air"),
          dirx: opts.dirx, dirz: opts.dirz,
        });
        drew = true;
      } catch (e) {}
    }
    const S = CBZ.micro && CBZ.micro.sfx;
    if (opts.silent !== true && S && S.boom) {
      let gain = 0.75 * Math.min(1.6, N.vis);
      if (CBZ.camera && S.gainAt) {
        const c = CBZ.camera.position;
        const d = Math.hypot(c.x - B.x, c.y - B.y, c.z - B.z);
        gain *= S.gainAt(d, opts.earshot || Math.max(240, 160 * cbrt(N.W)));
      }
      if (gain > 0.015) { try { S.boom({ gain: gain, dur: 1.2 + N.vis * 0.5, sub: 96 - N.vis * 12, bright: N.R < 12 }); } catch (e) {} }
    }

    // 3. PEOPLE AND HULLS (the mode's own funnel; hulls by blastOn)
    let hit = 0;
    if (CBZ.blastWorldActors && opts.actors !== false) {
      const bo = Object.assign({}, opts, { W: N.W, mun: N.id, shaped: N.shaped });
      try { hit = CBZ.blastWorldActors(B.x, B.y || 1, B.z, N.R, N.power, bo) || 0; } catch (e) {}
    }

    // 4. THE BUILT WORLD, 5. THE HARDWARE
    let struck = null;
    if (opts.structural !== false) {
      try { struck = structure(B, N.W, { shaped: N.shaped, jet: N.jet, contact: !!opts.contact || !!(opts.struck && opts.struck.kind === "collider"),
        dirx: opts.dirx, dirz: opts.dirz, byPlayer: !!opts.byPlayer, inside: !!inside, mun: N.id }); } catch (e) { console.warn("[strike] structure", e); }
    }
    let wrecked = 0;
    try { wrecked = hardware(B, N.W, N, opts); } catch (e) { console.warn("[strike] hardware", e); }

    // 6. OBSERVERS
    const ev = { x: B.x, y: B.y, z: B.z, W: N.W, R: N.R, power: N.power, craterR: N.craterR, mun: N.id,
      shaped: N.shaped, by: opts.by || null, struck: opts.struck || null, inside: inside, airburst: !!opts.airburst };
    for (let i = 0; i < OBS.length; i++) { try { OBS[i](ev, opts); } catch (e) { console.warn("[strike] observer", e); } }
    return { drew: drew, hit: hit, struck: struck, W: N.W, R: N.R, power: N.power, wrecked: wrecked, inside: inside };
  }

  /* ======================================================================
     THE FUZE: where a penetrating case bursts. Each slab it meets costs
     ~0.25 m of reinforced concrete off its `conc`; it bursts in the storey
     it stops in (or on the bottom slab).
     ====================================================================== */
  function penetrate(at, N, opts) {
    const b = buildingAt(at.x, at.y, at.z, 1.5);
    if (!b) return null;
    const gy = b.gy != null ? b.gy : groundY(b.ox, b.oz);
    const FH = b.FH || 3.2, st = Math.max(1, b.storeys || Math.round((b.h || FH) / FH));
    const roofY = gy + st * FH;
    if (at.y < roofY - 1.2) {
      // through a wall: on into the room behind it, a metre per 0.4 m conc
      const dx = opts.dirx || 0, dz = opts.dirz || 0, dl = Math.hypot(dx, dz) || 1;
      const go = Math.min(6, N.conc * 2.5);
      return { x: at.x + dx / dl * go, y: at.y, z: at.z + dz / dl * go, floor: Math.max(0, Math.floor((at.y - gy) / FH)), b: b };
    }
    const slabs = Math.min(st, Math.floor(N.conc / 0.25));
    const floor = Math.max(0, st - 1 - Math.max(0, slabs - 1));
    // the slabs it went through are holed where it went down
    const L0 = L(), r = L0 ? Math.max(0.35, Math.min(1.2, 0.25 * cbrt(N.W))) : 0.5;
    const levels = [];
    for (let i = st - 1; i >= floor + 1; i--) levels.push(i);
    if (CBZ.cityCarveShaft && b.floorSlabs) {
      try { CBZ.cityCarveShaft(b, at.x, at.z, r, r, { roof: true, levels: levels, reserve: false }); stats.roofs++; } catch (e) {}
    }
    return { x: at.x, y: gy + floor * FH + FH * 0.5, z: at.z, floor: floor, b: b };
  }

  /* ======================================================================
     THE BUILT WORLD
     ====================================================================== */
  const _q = [];
  // the building shell (city/buildings.js makeBuilding record) a point is in
  // or against: a wall collider's mesh is one hop from its record
  function buildingAt(x, y, z, reach) {
    const M = CBZ.micro;
    const r = reach > 0 ? reach : 1;
    let list = null;
    // a building is found through its walls, and a point in the middle of a
    // 40 m roof is 20 m from the nearest one: gather wide, then test the plan
    if (M && M.queryColliders) list = M.queryColliders(x, z, r + 32, _q);
    else list = CBZ.colliders || [];
    let best = null, bd = Infinity;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const m = c && c.ref;
      const b = m && m.parent && m.parent.userData && m.parent.userData.bld;
      if (!b || b._down) continue;
      const hw = (b.w || 0) / 2 + r, hd = (b.d || 0) / 2 + r;
      if (Math.abs(x - b.ox) > hw || Math.abs(z - b.oz) > hd) continue;
      const gy = b.gy != null ? b.gy : groundY(b.ox, b.oz);
      if (y != null && (y < gy - 2 || y > gy + (b.h || 10) + r + 2)) continue;
      const d = Math.hypot(x - b.ox, z - b.oz);
      if (d < bd) { bd = d; best = b; }
    }
    if (best && best.gy == null) best.gy = groundY(best.ox, best.oz);
    return best;
  }
  // its capacity in the structural ledger's units (city/structural.js sizes a
  // building at 12 + storeys x 7 + plan / 26)
  function capacityOf(b) { return 12 + (b.storeys || 1) * 7 + (b.w || 10) * (b.d || 10) / 26; }

  function structure(at, W, o) {
    o = o || {};
    const Lw = L();
    if (!Lw || !(W > 0)) return null;
    // THE CITY: its own ledger does the whole job with the same law
    if (CBZ.game && CBZ.game.mode === "city" && CBZ.blastBuildings) {
      return CBZ.blastBuildings(at.x, at.y, at.z, { charge: W, shaped: o.shaped, jetPen: o.jet, contact: o.contact, byPlayer: o.byPlayer });
    }
    const reachR = Math.max(1.5, Lw.breachRadius(W) * 2 + 1, Lw.gutR(W) * 0.5);
    const b = buildingAt(at.x, at.y, at.z, reachR);
    // glass first: it goes out to Z_GLASS whatever else happens
    if (CBZ.shatterGlass) { try { CBZ.shatterGlass(at.x, at.z, Lw.glassR(W)); } catch (e) {} }
    if (!b) { stats.open++; return null; }
    const gy = b.gy;
    const FH = b.FH || 3.2, st = Math.max(1, b.storeys || 1), roofY = gy + st * FH;
    const hw = (b.w || 10) / 2, hd = (b.d || 10) / 2;
    const out = { b: b, wall: false, roof: false, gut: 0, down: false };
    const lx = at.x - b.ox, lz = at.z - b.oz;
    const insideXZ = Math.abs(lx) < hw - 0.2 && Math.abs(lz) < hd - 0.2;
    const onRoof = insideXZ && at.y >= roofY - 0.6;
    // the face the burst is against (outward normal), when it is outside or in a wall
    let nx = 0, nz = 0;
    if (!insideXZ || o.inside) {
      const ex = Math.abs(lx) - hw, ez = Math.abs(lz) - hd;
      if (ex > ez) nx = lx > 0 ? 1 : -1; else nz = lz > 0 ? 1 : -1;
    }

    // THE WALL: the law opens it (or scars it) — the carve sheds the wall's own material
    if (!onRoof) {
      const fr = CBZ.cityFracture;
      const seat = { x: at.x, y: Math.max(gy + 0.6, Math.min(roofY - 0.4, at.y)), z: at.z };
      try {
        if (fr && fr.blastAt) fr.blastAt(seat, { charge: W, contact: !!o.contact, shaped: !!o.shaped, jetPen: o.jet || 0, byPlayer: !!o.byPlayer });
        else if (CBZ.cityCarveWall) {
          CBZ.cityCarveWall(seat.x, seat.y, seat.z, 1, { charge: { W: W, contact: !!o.contact, shaped: !!o.shaped, jetPen: o.jet || 0 },
            search: Math.max(1.2, Math.min(4, Lw.breachRadius(W) * 1.6 + 1)) });
        }
        out.wall = true; stats.walls++;
      } catch (e) {}
    }

    // THE ROOF: a burst on it opens a hole the law's size (shaped: its jet)
    if (onRoof && CBZ.cityCarveShaft && b.roofSlab) {
      const h = Lw.hole(W, { thick: 0.3, hint: "rc", shaped: o.shaped, jetPen: o.jet, standoff: 0 });
      const r = Math.max(h.r, o.shaped ? 0.3 : 0) + (W > 50 ? Lw.breachRadius(W) * 0.6 : 0);
      if (r > 0.15) {
        const rr = Math.min(Math.min(hw, hd) - 0.4, r);
        // a big charge drops the top storey's slab too
        const levels = W >= 20 ? [st - 1].filter(function (l) { return l >= 1; }) : [];
        try { if (CBZ.cityCarveShaft(b, at.x, at.z, rr, rr, { roof: true, levels: levels, reserve: false })) { out.roof = true; stats.roofs++; } } catch (e) {}
      }
    }

    // THE GUT: storeys inside the gut radius are blown out floor to ceiling
    const gutR = Lw.gutR(W);
    if (Lw.guts(W) && CBZ.collapse && CBZ.collapse.gut) {
      const floors = [];
      for (let f = 0; f < st; f++) {
        const dy = Math.abs(gy + f * FH + FH / 2 - at.y);
        if (dy >= gutR) continue;
        floors.push({ f: f, r: Math.sqrt(gutR * gutR - dy * dy) });
      }
      if (floors.length) {
        try {
          const vents = CBZ.collapse.gut(descOf(b), floors, { x: at.x, y: at.y - gy, z: at.z }, { byPlayer: !!o.byPlayer });
          out.gut = vents ? vents.length : 0; if (out.gut) stats.guts++;
          // the gutted storeys burn
          if (vents && CBZ.cityCrashSmoke) for (let i = 0; i < Math.min(4, vents.length); i++) burnAt(vents[i].x, gy + vents[i].y, vents[i].z, 40 + Math.random() * 30);
        } catch (e) {}
      }
    }

    // THE LEDGER: what the frame took, coupled by distance (a burst on the
    // roof or inside is all in; one off the face loses with standoff)
    const dOut = Math.max(0, Math.max(Math.abs(lx) - hw, Math.abs(lz) - hd));
    const couple = o.inside || insideXZ ? 1 : Lw.coupling(W, dOut);
    b._strikeDmg = (b._strikeDmg || 0) + Lw.deposit(W) * couple;
    const gutsPlan = Lw.guts(W) && (o.inside || insideXZ || dOut < 2) && gutR >= 0.5 * Math.hypot(b.w || 10, b.d || 10);
    if (W >= 2 && !(o.shaped && W < 15)) burnAt(at.x, Math.min(at.y, roofY), at.z, 20 + cbrt(W) * 8);
    if ((b._strikeDmg >= capacityOf(b) || gutsPlan) && !b._down) {
      out.down = bringDown(b, at, nx, nz, Math.max(0, Math.min(st - 1, Math.floor((at.y - gy) / FH))));
    }
    if (CBZ.cityDustKick) { try { CBZ.cityDustKick(at.x, Math.max(gy + 1, Math.min(at.y, roofY)), at.z, Math.min(2.6, 0.6 + 0.35 * cbrt(W)), 0xa39a8c); } catch (e) {} }
    return out;
  }

  function descOf(b) {
    return {
      ox: b.ox, oz: b.oz, gy: b.gy || 0, w: b.w, d: b.d, h: b.h || (b.storeys || 1) * (b.FH || 3.2), storeys: b.storeys || 1,
      FH: b.FH || 3.2, group: b.group, panes: b.windows || [], wall: b.wallColor, masonry: b.masonry, style: b.dressStyle || null,
      key: Math.round(b.ox) + "," + Math.round(b.oz),
    };
  }
  // the building comes down: its own shell falls as pieces of itself; the
  // real building is hidden and its colliders and floors pulled at the swap
  function bringDown(b, at, nx, nz, floor) {
    b._down = true;
    stats.collapses++;
    const C = CBZ.collapse;
    const swap = function () {
      // the shell may be merged into the batch's buffers (core/batch.js): its
      // slices go too, as city/structural.js hides a fallen building
      try { if (CBZ.batchHideGroup && b.group) CBZ.batchHideGroup(b.group); } catch (e) {}
      try { if (b.group) b.group.visible = false; } catch (e) {}
      (b.windows || []).forEach(function (gp) {
        if (gp.shattered) return;
        gp.shattered = true;
        try { if (gp.mesh) gp.mesh.visible = false; else if (CBZ._paneShow) CBZ._paneShow(gp, false); } catch (e) {}
        if (gp.col && CBZ.micro && CBZ.micro.removeCollider) CBZ.micro.removeCollider(gp.col);
      });
      (b.losMeshes || []).forEach(function (m) { const i = CBZ.losBlockers ? CBZ.losBlockers.indexOf(m) : -1; if (i >= 0) CBZ.losBlockers.splice(i, 1); });
      (b.doors || []).forEach(function (dr) { dr.demolished = true; if (dr.colIn && CBZ.micro && CBZ.micro.removeCollider) { CBZ.micro.removeCollider(dr.col); dr.colIn = false; } });
      const M = CBZ.micro;
      (b.colliders || []).forEach(function (c) {
        try { if (M && M.removeCollider) M.removeCollider(c); else { const i = CBZ.colliders.indexOf(c); if (i >= 0) CBZ.colliders.splice(i, 1); } } catch (e) {}
      });
      (b.platforms || []).forEach(function (p) { const i = CBZ.platforms ? CBZ.platforms.indexOf(p) : -1; if (i >= 0) CBZ.platforms.splice(i, 1); });
      if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    };
    const desc = descOf(b);
    desc.at = { x: at.x, y: at.y, z: at.z };
    if (C && C.play) {
      try {
        C.play(desc, {
          wound: { nx: nx, nz: nz, floor: floor }, preShudder: 0.5, onSwap: swap,
          onGround: function () {
            // what is left on the ground is the building's own pieces (the
            // shell burst into CBZ.debris); the pall rolls out, the ruin burns
            for (let i = 0; i < 4; i++) burnAt(b.ox + (Math.random() - 0.5) * b.w * 0.6, b.gy + 1, b.oz + (Math.random() - 0.5) * b.d * 0.6, 60 + Math.random() * 60);
          },
        });
        return true;
      } catch (e) { console.warn("[strike] collapse", e); }
    }
    swap();
    return true;
  }

  /* ---- fires that burn on: a short list, ticked here (pooled smoke) ---- */
  const FIRES = [];
  function burnAt(x, y, z, secs) {
    if (!CBZ.cityCrashSmoke) return;
    if (FIRES.length >= 24) FIRES.shift();
    FIRES.push({ x: x, y: y, z: z, t: secs, k: 0 });
  }
  function tickFires(dt) {
    for (let i = FIRES.length - 1; i >= 0; i--) {
      const f = FIRES[i];
      f.t -= dt; f.k -= dt;
      if (f.t <= 0) { FIRES.splice(i, 1); continue; }
      if (f.k <= 0) {
        f.k = 0.6 + Math.random() * 0.4;
        try { CBZ.cityCrashSmoke(f.x, f.y, f.z, { count: 2, scale: 1.1, flame: Math.random() < 0.6 }); } catch (e) {}
      }
    }
  }
  if (CBZ.onUpdate) CBZ.onUpdate(34.5, function (dt) { if (FIRES.length) tickFires(Math.min(0.25, dt || 0.016)); });

  /* ======================================================================
     THE HARDWARE: parked vehicles and aircraft that are props, not units.
     ====================================================================== */
  // the skin and the hit points of a parked machine, by its kind
  const SKIN = {
    plane: { plate: 2, hp: 260 }, heli: { plate: 3, hp: 240 }, ground: { plate: 4, hp: 380 },
    truck: { plate: 2, hp: 300 }, tank: { plate: 70, hp: 1000 }, boat: { plate: 6, hp: 500 }, drone: { plate: 1, hp: 60 },
    patriot: { plate: 4, hp: 400 }, mlrs: { plate: 9, hp: 450 },
  };
  const _hq = [];
  function hardware(at, W, N, opts) {
    const MT = T();
    if (!MT || !(W > 0) && !(N.f && N.f.pen > 0)) return 0;
    const reach = Math.max(N.R, 12 * cbrt(W));
    const M = CBZ.micro;
    const list = M && M.queryColliders ? M.queryColliders(at.x, at.z, reach, _hq) : (CBZ.colliders || []);
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i], g = c && c.ref;
      const ud = g && g.userData;
      const kind = ud && (ud.hwKind || ud.milKind);
      if (!kind || ud.wrecked) continue;
      const sk = SKIN[kind] || SKIN.ground;
      // distance from the burst to the machine's box (3D)
      const qx = Math.max(c.minX, Math.min(c.maxX, at.x)), qz = Math.max(c.minZ, Math.min(c.maxZ, at.z));
      const base = c.y0 != null ? c.y0 : 0, top = c.y1 != null && c.y1 > base ? c.y1 : base + 3;
      const qy = Math.max(base, Math.min(top, at.y));
      const d = Math.hypot(qx - at.x, qy - at.y, qz - at.z);
      let th = null;
      // a direct hit on THIS machine: the round's own penetration
      if (opts.struck && opts.struck.c === c && N.f) th = { pen: N.f.pen, beh: N.f.beh };
      else th = MT.blastOn(W, d);
      if (!th) continue;
      const p = th.pen * (0.85 + Math.random() * 0.3);
      if (p <= sk.plate) continue;
      ud.strikeHp = (ud.strikeHp == null ? sk.hp : ud.strikeHp) - th.beh * (0.75 + Math.random() * 0.5);
      if (ud.strikeHp > 0) {
        // holed, not finished: it smokes
        if (!ud.smoking) { ud.smoking = true; burnAt(qx, top, qz, 30); }
        continue;
      }
      wreck(g, c, ud, th.beh > 1200, at);
      n++;
    }
    return n;
  }
  const BURNT = new Map();
  function burntOf(m, k) {
    let b = BURNT.get(m);
    if (!b) {
      b = m.clone();
      if (b.color) b.color.multiplyScalar(k);
      if (b.emissive) b.emissive.setRGB(0, 0, 0);
      if (b.map) b.map = m.map;
      BURNT.set(m, b);
    }
    return b;
  }
  function wreck(g, c, ud, catastrophic, at) {
    ud.wrecked = true; stats.wrecks++;
    ud.dynamic = false;
    const k = catastrophic ? 0.22 : 0.4;
    try {
      g.traverse(function (o) {
        if (!o.isMesh || !o.material) return;
        o.material = Array.isArray(o.material) ? o.material.map(function (m) { return burntOf(m, k); }) : burntOf(o.material, k);
      });
      // it sits down: the gear or the suspension has gone
      const k0 = ud.hwKind || ud.milKind;
      g.position.y -= k0 === "plane" || k0 === "heli" || k0 === "drone" ? 0.45 : 0.2;
      g.rotation.z += (Math.random() - 0.5) * 0.12;
      g.rotation.x += (Math.random() - 0.5) * 0.06;
    } catch (e) {}
    const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2, top = c.y1 != null ? c.y1 : 3;
    const D = CBZ.debris;
    if (D && D.wreckage) {
      let col = 0x4c5056;
      try { g.traverse(function (o) { if (col === 0x4c5056 && o.isMesh && o.material && o.material.color) col = o.material.color.getHex(); }); } catch (e) {}
      try {
        D.wreckage(cx, top * 0.6, cz, { color: col, plates: catastrophic ? 10 : 4, plateSize: 0.5,
          dir: { x: cx - at.x, y: 1, z: cz - at.z }, power: catastrophic ? 2.6 : 1.4, spread: 1.6, radius: 2,
          burn: 14, burnFrac: 0.5, fires: catastrophic ? 2 : 1, dustColor: 0x3d3833 });
      } catch (e) {}
    }
    if (catastrophic && CBZ.cityBlastCore) {
      // the fuel goes up
      try { CBZ.cityBlastCore(cx, cz, { power: 1.1, radius: 4, y: top * 0.5, noDamage: true, kind: "carcook" }); } catch (e) {}
    }
    burnAt(cx, top * 0.7, cz, catastrophic ? 120 : 60);
  }

  /* ======================================================================
     THE SWEPT TEST
     ====================================================================== */
  const _seg = [];
  // a band-less collider is as tall as the thing it is
  function topOf(c) {
    if (c.y1 != null) return c.y1;
    if (c._sTop != null) return c._sTop;
    let top = null;
    const r = c.ref;
    if (r && r.h > 0) top = (r.gy != null ? r.gy : groundY((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2)) + r.h;
    else if (c.h > 0) top = (c.y0 || 0) + c.h;
    else if (r && r.isObject3D && typeof THREE !== "undefined" && GW.THREE) {
      try { const bb = new GW.THREE.Box3().setFromObject(r); if (!bb.isEmpty()) top = bb.max.y; } catch (e) {}
    }
    if (top == null) top = groundY((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2) + 12;
    c._sTop = top;
    return top;
  }
  function frameOf(c, F) {
    if (c.yaw && c.cx != null && c.hw != null) { F.ox = c.cx; F.oz = c.cz; F.co = Math.cos(c.yaw); F.si = Math.sin(c.yaw); F.hw = c.hw; F.hd = c.hd; }
    else { F.ox = (c.minX + c.maxX) * 0.5; F.oz = (c.minZ + c.maxZ) * 0.5; F.co = 1; F.si = 0; F.hw = (c.maxX - c.minX) * 0.5; F.hd = (c.maxZ - c.minZ) * 0.5; }
    return F;
  }
  const _F = { ox: 0, oz: 0, co: 1, si: 0, hw: 0, hd: 0 };
  // slab test of the segment a->b (t in 0..1) against one collider's own box
  function segBox(c, ax, ay, az, dx, dy, dz) {
    const F = frameOf(c, _F);
    const rx = ax - F.ox, rz = az - F.oz;
    const lox = rx * F.co - rz * F.si, loz = rx * F.si + rz * F.co;
    const ldx = dx * F.co - dz * F.si, ldz = dx * F.si + dz * F.co;
    const y0 = c.y0 != null ? c.y0 : -1e9, y1 = topOf(c);
    let t0 = 0, t1 = 1, ax_ = -1, sg = 0;
    function slab(o, d, lo, hi, axis) {
      if (Math.abs(d) < 1e-12) return o >= lo && o <= hi;
      let a = (lo - o) / d, b = (hi - o) / d, s = d > 0 ? -1 : 1;
      if (a > b) { const q = a; a = b; b = q; }
      if (a > t0) { t0 = a; ax_ = axis; sg = s; }
      if (b < t1) t1 = b;
      return t0 <= t1;
    }
    if (!slab(lox, ldx, -F.hw, F.hw, 0)) return null;
    if (!slab(ay, dy, y0, y1, 1)) return null;
    if (!slab(loz, ldz, -F.hd, F.hd, 2)) return null;
    if (t1 < 0 || t0 > 1) return null;
    const lnx = ax_ === 0 ? sg : 0, lnz = ax_ === 2 ? sg : 0;
    return { t: t0, inside: ax_ < 0, nx: lnx * F.co + lnz * F.si, ny: ax_ === 1 ? sg : 0, nz: -lnx * F.si + lnz * F.co };
  }
  /* sweep(ax,ay,az, bx,by,bz, opts) -> { x,y,z, t, c, nx,ny,nz, ground } | null
       opts.groundAt(x,z)  the ground (default CBZ.floorAt)
       opts.skip(c)        true: ignore this collider (a shooter's own cover)
       opts.pad            widen the gather (default 0.3)
       opts.noGround       colliders only */
  function sweep(ax, ay, az, bx, by, bz, opts) {
    opts = opts || {};
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (!(len > 1e-6)) return null;
    let best = null;
    const M = CBZ.micro;
    const cands = _seg; cands.length = 0;
    if (M && M.segmentHitsCollider) M.segmentHitsCollider(ax, az, bx, bz, opts.pad || 0.3, function (c) { cands.push(c); return false; });
    else if (CBZ.colliders) for (let i = 0; i < CBZ.colliders.length; i++) cands.push(CBZ.colliders[i]);
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (!c || c.noBlock || (opts.skip && opts.skip(c))) continue;
      const h = segBox(c, ax, ay, az, dx, dy, dz);
      if (!h || h.inside) continue;                    // a round that starts inside a box is not stopped by it
      if (!best || h.t < best.t) { best = h; best.c = c; }
    }
    // ROOFS AND FLOORS. A building's walls are its colliders; its roof and
    // its floors are platforms (a slab you stand on). A falling store meets
    // the first slab it comes down through.
    const P = CBZ.platforms;
    if (dy < 0 && P && P.length) {
      const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), z0 = Math.min(az, bz), z1 = Math.max(az, bz);
      for (let i = 0; i < P.length; i++) {
        const p = P[i];
        if (!p || p.top == null || p.maxX < x0 || p.minX > x1 || p.maxZ < z0 || p.minZ > z1) continue;
        if (!(ay >= p.top && by < p.top)) continue;
        const t = (ay - p.top) / (ay - by);
        const hx = ax + dx * t, hz = az + dz * t;
        if (hx < p.minX || hx > p.maxX || hz < p.minZ || hz > p.maxZ) continue;
        if (!best || t < best.t) best = { t: t, nx: 0, ny: 1, nz: 0, c: null, plat: p, ground: false };
      }
    }
    // the ground: sampled every 2 m under the segment, then refined
    if (!opts.noGround) {
      const ga = opts.groundAt || groundY;
      const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 2));
      const tMax = best ? best.t : 1;
      let tp = 0, prevAbove = ay - ga(ax, az);
      for (let i = 1; i <= n; i++) {
        const t = Math.min(tMax, i / n);
        const above = ay + dy * t - ga(ax + dx * t, az + dz * t);
        if (above <= 0) {
          let lo = tp, hi = t;
          for (let k = 0; k < 10; k++) {
            const m = (lo + hi) / 2;
            if (ay + dy * m - ga(ax + dx * m, az + dz * m) <= 0) hi = m; else lo = m;
          }
          if (!best || hi < best.t) best = { t: hi, nx: 0, ny: 1, nz: 0, c: null, ground: true };
          break;
        }
        prevAbove = above; tp = t;
        if (t >= tMax) break;
      }
      void prevAbove;
    }
    if (!best) return null;
    best.x = ax + dx * best.t; best.y = ay + dy * best.t; best.z = az + dz * best.t;
    if (best.ground) best.y = (opts.groundAt || groundY)(best.x, best.z);
    return best;
  }

  /* ---- the public face -------------------------------------------------- */
  strike.on = function (fn) { if (typeof fn === "function" && OBS.indexOf(fn) < 0) OBS.push(fn); return fn; };
  strike.off = function (fn) { const i = OBS.indexOf(fn); if (i >= 0) OBS.splice(i, 1); };
  strike.sweep = sweep;
  strike.structure = structure;
  strike.hardware = hardware;
  strike.buildingAt = buildingAt;
  strike.numbers = function (mun, opts) { return resolveNumbers(mun, opts || {}); };
  strike.stats = function () { return Object.assign({}, stats, { byMun: Object.assign({}, stats.byMun), fires: FIRES.length }); };
  strike.SKIN = SKIN;
  CBZ.strike = strike;

})();

/* ============================================================
   city/island_airport.js — THE AIRPORT ISLAND (archipelago landmass).

   WHY (owner's #1 law — every object earns its place): a real city has
   a way OUT. The mainland's north edge faces open sea, and there was
   nothing on it but water. This island answers "where do you fly from?"
   — a working international airport reached by a single causeway you can
   drive across. The runway is the long flat dragstrip you can floor a
   stolen car down; the terminal is a real enterable concourse (check-in,
   gate seating) full of passengers with luggage worth lifting; the apron
   is parked airliners and private jets (cover, climb-on vantage, a
   pushback in motion); the tower watches it all from a glass cab. The
   perimeter fence is the WHY you can't just drive into the sea — there's
   one road on and off, the causeway, exactly like a real island airfield.

   DRAW-CALL DISCIPLINE (engine is draw-call bound): the runway/taxiway
   edge lights are ONE InstancedMesh; the concourse seat rows are ONE
   InstancedMesh; the perimeter fence posts are ONE InstancedMesh; ground
   markings are merged via BufferGeometryUtils into a handful of meshes;
   every repeated colour comes from the shared CBZ.mat/cmat pool. Parked
   aircraft share materials across the fleet. Deterministic seeded rng so
   the field is identical every run.

   FOOTPRINT: rect centre (-40,-120), half (330,160)
     → minX=-370 maxX=290 minZ=-280 maxZ=40   (region 'airport')
   CAUSEWAY: rect minX=-7 maxX=7 minZ=-566 maxZ=-280  (region 'airport-causeway')
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const mat = CBZ.mat;
  const cmat = CBZ.cmat || CBZ.mat;

  // ---- deterministic LCG: same airfield every run ----
  // seeded from CBZ.WORLD_SEED via the named-stream registry (core/seed.js)
  // — one world-seed knob instead of a per-file magic literal. rng() is
  // re-armed at build entry so a rebuild replays the identical stream.
  let rng = null;
  function armRng() { rng = CBZ.seedStream ? CBZ.seedStream('airport') : (function () { let s = 0x51A1A0; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })(); }
  armRng();

  // ---- boardable capture: the parked airliners + private jets register as
  // STEALABLE aircraft (kind 'plane') so the player can climb in and fly one off
  // the apron (#1 law: a parked jet you can only walk past is a dead prop). The
  // airport loads BEFORE militaryvehicles.js, so we DEFER the hand-off (onUpdate
  // 55.1, after worldgen) and run it ONCE. The mid-pushback airliner is left out —
  // it's scripted by its own loop and boarding it would fight that animation.
  const placed = [];
  let _reg = false;
  function boardablePlane(grp, x, z, heading, footW, footL, name) {
    if (!grp) return grp;
    grp.userData.milKind = "plane";
    grp.userData.milName = name || "Aircraft";
    grp.userData.hijackable = true;
    placed.push({
      group: grp, pos: grp.position, heading: heading || 0,
      kind: "plane", model: { name: name || "Aircraft" },
      // Civil airport aircraft are not military-jet stand-ins. The player-air
      // bridge reuses this exact parked group as the flyable so taking an
      // airliner visibly removes THAT airliner from its gate. Airport models
      // point down local +X while the shared flight model treats local +Z as
      // forward, hence the -90deg visual yaw offset.
      civilian: true,
      flightKind: (name === "Airliner") ? "airliner" : "privatejet",
      modelYawOffset: -Math.PI / 2,
      groundOffset: 0,
      collider: grp.userData.worldCollider || null,
      footW: footW || 18, footL: footL || 18, taken: false, hot: true,
    });
    return grp;
  }

  // ---- region geometry ----
  const A_MINX = -370, A_MAXX = 290, A_MINZ = -280, A_MAXZ = 40;
  // causeway widened to the 24m highway deck (x∈[-12,12])
  const CW_MINX = -12, CW_MAXX = 12, CW_MINZ = -566, CW_MAXZ = -280;

  // ---- shared palette (one bucket per colour → batcher collapses them) ----
  const C_TARMAC = 0x3c3f44;   // apron / taxiway asphalt
  const C_RUNWAY = 0x2c2f33;   // darker runway asphalt
  const C_GRASS  = 0x5d7c46;   // infield grass
  const C_PAINT  = 0xeef1f4;   // white runway paint
  const C_YELLOW = 0xd8b53a;   // taxiway centreline / hold lines
  const C_CONC   = 0x9aa0a6;   // concrete kerb / terminal slab
  const C_METAL  = 0xb9c0c8;   // fuselage aluminium
  const C_DKMET  = 0x6b7178;   // engines / underbelly
  const C_GLASS  = 0x9fc7df;   // tower cab + terminal glass
  const C_FENCE  = 0x8a9099;   // chain-link tone

  CBZ.addLandmass(function (city) {
    const root = city.root;
    armRng();
    // a city rebuild re-runs this builder → fresh plane groups. Clear the capture
    // + one-shot guard so the rebuilt fleet re-registers as boardable.
    placed.length = 0; _reg = false;

    const BGU = THREE.BufferGeometryUtils;

    // ---- helpers --------------------------------------------------------
    // flat box mesh
    function box(x, y, z, w, h, d, color, opts) {
      opts = opts || {};
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
        opts.emissive ? mat(color, { emissive: opts.emissive, ei: opts.ei || 0.5 }) : mat(color));
      m.position.set(x, y, z);
      if (opts.ry) m.rotation.y = opts.ry;
      m.castShadow = !!opts.cast; m.receiveShadow = opts.receive !== false;
      root.add(m);
      return m;
    }
    // a solid collider (and optional y-gating for things you can drive under)
    function solid(x, z, w, d, y0, y1, ref) {
      const c = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, ref: ref || null };
      if (y0 != null) c.y0 = y0;
      if (y1 != null) c.y1 = y1;
      CBZ.colliders.push(c);
      return c;
    }
    // a flat painted quad lying on the ground (collected for merging)
    function quadGeo(x, z, w, d, y) {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      g.translate(x, y == null ? 0.02 : y, z);
      return g;
    }
    function mergePaint(geoms, color, y) {
      if (!geoms.length) return;
      if (BGU && BGU.mergeBufferGeometries) {
        const m = new THREE.Mesh(BGU.mergeBufferGeometries(geoms), mat(color));
        m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false;
        root.add(m);
      } else {
        for (const gm of geoms) { const m = new THREE.Mesh(gm, mat(color)); m.receiveShadow = true; root.add(m); }
      }
    }

    // =====================================================================
    //  1) GROUND — grass infield slab + concrete apron pad. Sits a hair
    //     above the sea plane (y=0 world floor). The runway/taxiways are
    //     darker asphalt strips laid on top.
    // =====================================================================
    (function ground() {
      // grass infield covering the whole footprint
      const gw = A_MAXX - A_MINX, gd = A_MAXZ - A_MINZ;
      const grass = new THREE.Mesh(new THREE.PlaneGeometry(gw, gd), mat(C_GRASS));
      grass.rotation.x = -Math.PI / 2;
      grass.position.set((A_MINX + A_MAXX) / 2, 0.0, (A_MINZ + A_MAXZ) / 2);
      grass.receiveShadow = true; grass.matrixAutoUpdate = false; grass.updateMatrix();
      root.add(grass);
    })();

    // =====================================================================
    //  2) RUNWAY 09/27 — E-W, ~540 long × 30 wide, centred north of mid.
    //     Real markings: solid edge lines, dashed centreline, threshold
    //     "piano keys", runway designator numbers, aiming-point bars.
    // =====================================================================
    const RWY_Z = -90;            // runway centre line (z)
    const RWY_W = 30;             // width
    const RWY_X0 = -340, RWY_X1 = 200, RWY_LEN = RWY_X1 - RWY_X0;  // 540 long
    const RWY_CX = (RWY_X0 + RWY_X1) / 2;
    (function runway() {
      // asphalt strip
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(RWY_LEN, RWY_W), mat(C_RUNWAY));
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(RWY_CX, 0.01, RWY_Z);
      strip.receiveShadow = true; strip.matrixAutoUpdate = false; strip.updateMatrix();
      root.add(strip);

      // --- white paint, all merged into ONE mesh ---
      const paint = [];
      // edge lines (full length, both sides)
      paint.push(quadGeo(RWY_CX, RWY_Z - RWY_W / 2 + 0.6, RWY_LEN - 8, 0.6));
      paint.push(quadGeo(RWY_CX, RWY_Z + RWY_W / 2 - 0.6, RWY_LEN - 8, 0.6));
      // dashed centreline — 6 long dash + 6 gap pattern
      const dashL = 6, gap = 6, step = dashL + gap;
      for (let x = RWY_X0 + 24; x < RWY_X1 - 24; x += step) paint.push(quadGeo(x + dashL / 2, RWY_Z, dashL, 0.5));
      // threshold "piano keys" at each end (8 longitudinal bars)
      for (const endSgn of [-1, 1]) {
        const baseX = endSgn < 0 ? RWY_X0 + 5 : RWY_X1 - 5 - 14;
        for (let k = 0; k < 8; k++) {
          const z = RWY_Z - RWY_W / 2 + 2.2 + k * 3.4;
          paint.push(quadGeo(baseX + 7, z, 14, 1.4));
        }
      }
      // aiming-point bars (two thick bars ~30m in from each threshold)
      for (const ax of [RWY_X0 + 60, RWY_X1 - 60]) {
        paint.push(quadGeo(ax, RWY_Z - 4.5, 18, 2.2));
        paint.push(quadGeo(ax, RWY_Z + 4.5, 18, 2.2));
      }
      mergePaint(paint, C_PAINT);

      // runway designator numbers ("09" west-facing, "27" east-facing) as
      // label sprites laid above the threshold paint — cheap, readable.
      if (CBZ.makeLabelSprite) {
        const mk = (txt, x) => {
          const s = CBZ.makeLabelSprite(txt, { color: "#eef1f4" });
          if (!s) return; s.position.set(x, 0.6, RWY_Z); s.scale.set(10, 6, 1); root.add(s);
        };
        mk("09", RWY_X0 + 22); mk("27", RWY_X1 - 22);
      }
    })();

    // =====================================================================
    //  3) EDGE LIGHTS — ONE InstancedMesh down both runway edges + the
    //     taxiway/apron edge. Emissive amber so they glow at night. This is
    //     the single biggest "repeat" on the field, so it MUST be instanced.
    // =====================================================================
    (function edgeLights() {
      const positions = [];
      // runway edge lights every 18m, both sides
      for (let x = RWY_X0; x <= RWY_X1; x += 18) {
        positions.push([x, RWY_Z - RWY_W / 2 - 0.8]);
        positions.push([x, RWY_Z + RWY_W / 2 + 0.8]);
      }
      // taxiway centreline studs (green-ish but reuse amber pool to stay 1 mesh)
      for (let x = RWY_X0 + 10; x <= RWY_X1 - 10; x += 24) positions.push([x, RWY_Z + RWY_W / 2 + 26]);
      const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
      const m = mat(0xffb648, { emissive: 0xffb648, ei: 0.9 });
      const inst = new THREE.InstancedMesh(geo, m, positions.length);
      inst.castShadow = false; inst.receiveShadow = false;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < positions.length; i++) {
        dummy.position.set(positions[i][0], 0.25, positions[i][1]);
        dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      root.add(inst);
    })();

    // =====================================================================
    //  4) TAXIWAY (parallel to runway, to its south) + APRON pad in front
    //     of the terminal. Asphalt strips with yellow centrelines.
    // =====================================================================
    const TAX_Z = RWY_Z + 50;     // taxiway centre
    const APRON_Z = 0;            // ramp/apron centre (south, by terminal)
    (function taxiAndApron() {
      // taxiway strip
      const tx = new THREE.Mesh(new THREE.PlaneGeometry(RWY_LEN - 20, 18), mat(C_TARMAC));
      tx.rotation.x = -Math.PI / 2; tx.position.set(RWY_CX, 0.008, TAX_Z);
      tx.receiveShadow = true; tx.matrixAutoUpdate = false; tx.updateMatrix(); root.add(tx);

      // big apron / ramp pad in front of the terminal
      const ax = new THREE.Mesh(new THREE.PlaneGeometry(260, 80), mat(C_TARMAC));
      ax.rotation.x = -Math.PI / 2; ax.position.set(-40, 0.006, APRON_Z + 6);
      ax.receiveShadow = true; ax.matrixAutoUpdate = false; ax.updateMatrix(); root.add(ax);

      // two connector taxiways linking apron→taxiway→runway
      for (const cx of [-160, 80]) {
        const c = new THREE.Mesh(new THREE.PlaneGeometry(16, TAX_Z - APRON_Z + 30), mat(C_TARMAC));
        c.rotation.x = -Math.PI / 2; c.position.set(cx, 0.007, (TAX_Z + APRON_Z) / 2 - 10);
        c.receiveShadow = true; c.matrixAutoUpdate = false; c.updateMatrix(); root.add(c);
      }

      // yellow centrelines/hold-bars merged into one mesh
      const yel = [];
      yel.push(quadGeo(RWY_CX, TAX_Z, RWY_LEN - 24, 0.5, 0.03));     // taxiway centreline
      for (const cx of [-160, 80]) {
        yel.push(quadGeo(cx, (TAX_Z + APRON_Z) / 2 - 10, 0.5, TAX_Z - APRON_Z + 24, 0.03)); // connector line
        // runway hold-position bars (two solid + two dashed across connector)
        for (let i = 0; i < 4; i++) yel.push(quadGeo(cx, TAX_Z - 14 - i * 0.9, 14, 0.4, 0.03));
      }
      mergePaint(yel, C_YELLOW);
    })();

    // =====================================================================
    //  5) TERMINAL — enterable concourse via cityMakeBuilding. A long, low
    //     glass shell facing the apron. Inside: seat rows (instanced),
    //     check-in desks, a gate sign. Door faces the causeway (south).
    // =====================================================================
    let terminal = null;
    (function buildTerminal() {
      const tx = -40, tz = 24, tw = 150, td = 26;
      // doorSide 1 = +z (faces causeway/landside). retail glass = clear.
      terminal = CBZ.cityMakeBuilding(root, tx, tz, tw, td, 1, 0x6f8ba0, 1,
        { retail: true, glassKind: "clear", stairs: false });
      if (terminal && terminal.group) {
        const grp = root; // furniture lives in world space for simplicity
        const ix0 = tx - tw / 2 + 4, ix1 = tx + tw / 2 - 4;
        const fz = tz;    // concourse centre z

        // check-in desks along the landside wall (4 desks)
        for (let k = 0; k < 4; k++) {
          const dx = tx - tw / 2 + 20 + k * 30;
          box(dx, 0.55, tz + td / 2 - 3, 8, 1.1, 2.2, 0xc9cfd6, { cast: true });
          box(dx, 1.15, tz + td / 2 - 3, 8, 0.1, 2.4, 0x2b2f34);   // counter top
          solid(dx, tz + td / 2 - 3, 8, 2.4, 0, 1.2);
        }

        // seat rows — ONE InstancedMesh of seat blocks (gate waiting area)
        const seatGeo = new THREE.BoxGeometry(0.6, 0.45, 0.6);
        const seatPos = [];
        for (let r = 0; r < 3; r++) {
          const sz = tz - td / 2 + 5 + r * 4;
          for (let s = 0; s < 24; s++) {
            const sx = ix0 + 2 + s * ((ix1 - ix0 - 4) / 23);
            if (s % 8 === 7) continue; // aisle gaps
            seatPos.push([sx, sz]);
          }
        }
        const seatInst = new THREE.InstancedMesh(seatGeo, mat(0x35506e), seatPos.length);
        seatInst.castShadow = true; seatInst.receiveShadow = true;
        const dm = new THREE.Object3D();
        for (let i = 0; i < seatPos.length; i++) {
          dm.position.set(seatPos[i][0], 0.55, seatPos[i][1]);
          dm.updateMatrix(); seatInst.setMatrixAt(i, dm.matrix);
        }
        seatInst.instanceMatrix.needsUpdate = true; grp.add(seatInst);

        // seat backrests as a second instanced mesh (shared material)
        const backGeo = new THREE.BoxGeometry(0.6, 0.5, 0.12);
        const backInst = new THREE.InstancedMesh(backGeo, mat(0x2a4360), seatPos.length);
        backInst.castShadow = true;
        for (let i = 0; i < seatPos.length; i++) {
          dm.position.set(seatPos[i][0], 0.85, seatPos[i][1] + 0.24);
          dm.updateMatrix(); backInst.setMatrixAt(i, dm.matrix);
        }
        backInst.instanceMatrix.needsUpdate = true; grp.add(backInst);

        if (CBZ.makeLabelSprite) {
          const s = CBZ.makeLabelSprite("INTERNATIONAL TERMINAL", { color: "#dfeaff" });
          if (s) { s.position.set(tx, 5.2, tz + td / 2 + 0.4); s.scale.set(20, 2.4, 1); root.add(s); }
          const g1 = CBZ.makeLabelSprite("GATES A1–A8 →", { color: "#ffd451" });
          if (g1) { g1.position.set(tx + 40, 3.0, fz - td / 2 + 1.5); g1.scale.set(12, 1.6, 1); root.add(g1); }
        }
      }
    })();

    // =====================================================================
    //  6) CONTROL TOWER — a tall shaft with a glass cab on top, set beside
    //     the apron with a clear sightline down the runway. Solid collider.
    // =====================================================================
    (function controlTower() {
      const cxp = -180, czp = 30, base = 4.5, H = 34;
      // shaft
      box(cxp, H / 2, czp, base, H, base, 0xb6bdc4, { cast: true });
      solid(cxp, czp, base, base, 0, H + 6);
      // cab (wider glass box) + roof + dish — OWNER RULE (bda61ab): no gray
      // panes; the cab is the same clear tinted glass as every city facade.
      // mat() is fresh-per-call so mutating is safe; transparent keeps it out
      // of batch.js's opaque merge. cast:false — clear glass throws no shadow.
      const cab = box(cxp, H + 1.6, czp, base + 4, 3.2, base + 4, 0xbfe9f7, { cast: false, emissive: 0x3f8aa6, ei: 0.5 });
      cab.material.transparent = true; cab.material.opacity = 0.6;
      box(cxp, H + 3.6, czp, base + 4.6, 0.6, base + 4.6, 0x3a4046, { cast: true }); // cab roof
      box(cxp, H + 4.6, czp - 1, 0.3, 1.4, 0.3, 0xd24a3a, { emissive: 0xff5a4a, ei: 0.9 }); // beacon
      if (CBZ.makeLabelSprite) {
        const s = CBZ.makeLabelSprite("TWR", { color: "#cfe3ff" });
        if (s) { s.position.set(cxp, H + 1.6, czp + base + 2.2); s.scale.set(5, 2.6, 1); root.add(s); }
      }
    })();

    // =====================================================================
    //  7) AIRCRAFT — airliner + private-jet builders. These are the EXACT
    //     groups the player flies (the civil steal path in playeraircraft.js
    //     attaches the flight state to the parked group), so the airframes
    //     are sculpted properly: position-attribute tapered noses/tailcones
    //     (the aircraft.js taperBox pattern adapted to these +X-nosed
    //     models), real two-tone liveries, nacelles with intake rings,
    //     bogie gear and nav lights. CONTRACT KEPT: group root at ground
    //     level (wheels touch y=0, groundOffset 0), nose down local +X,
    //     same footprint/centreline heights, worldCollider via solid().
    //     Draw discipline: every material's parts merge into ONE child mesh
    //     (~12 draws per plane — fewer than the old loose-box builders).
    // =====================================================================
    // ---- local sculpt helpers (aircraft.js:44 taperBox pattern, r128) ----
    // fuseGeo: box whose Y/Z cross-section lerps from `tail` scale (-X end)
    // to `nose` scale (+X end); noseY/tailY shift those ends vertically
    // (quadratic — droops a cockpit, upsweeps a tailcone).
    function fuseGeo(len, h, d, o) {
      o = o || {};
      const sN = o.nose != null ? o.nose : 1, sT = o.tail != null ? o.tail : 1;
      const yN = o.noseY || 0, yT = o.tailY || 0;
      const geo = new THREE.BoxGeometry(len, h, d, o.seg || 5, 2, 2);
      const pos = geo.attributes.position, hl = len / 2;
      for (let i = 0; i < pos.count; i++) {
        const t = (pos.getX(i) + hl) / len;              // 0 tail end → 1 nose end
        const s = sT + (sN - sT) * t;
        pos.setY(i, pos.getY(i) * s + yN * t * t + yT * (1 - t) * (1 - t));
        pos.setZ(i, pos.getZ(i) * s);
      }
      pos.needsUpdate = true; geo.computeVertexNormals();
      return geo;
    }
    // wingGeo: ONE symmetric wing pair — chord tapers root→tip, tips sweep
    // aft (-X) and rise (dihedral). Also used for tailplanes.
    function wingGeo(span, rootC, tipC, th, sweep, dihedral) {
      const geo = new THREE.BoxGeometry(rootC, th, span, 2, 1, 6);
      const pos = geo.attributes.position, hs = span / 2;
      for (let i = 0; i < pos.count; i++) {
        const t = Math.abs(pos.getZ(i)) / hs;            // 0 root → 1 tip
        pos.setX(i, pos.getX(i) * (1 + (tipC / rootC - 1) * t) - sweep * t);
        pos.setY(i, pos.getY(i) + (dihedral || 0) * t);
      }
      pos.needsUpdate = true; geo.computeVertexNormals();
      return geo;
    }
    // finGeo: vertical stabiliser — chord tapers with height, sweeps aft.
    function finGeo(h, rootC, tipC, th, sweep) {
      const geo = new THREE.BoxGeometry(rootC, h, th, 2, 6, 1);
      const pos = geo.attributes.position, hh = h / 2;
      for (let i = 0; i < pos.count; i++) {
        const t = (pos.getY(i) + hh) / h;                // 0 base → 1 tip
        pos.setX(i, pos.getX(i) * (1 + (tipC / rootC - 1) * t) - sweep * t);
      }
      pos.needsUpdate = true; geo.computeVertexNormals();
      return geo;
    }
    // fleet materials — carfx vehicle roles when available (metal sheen and
    // reflective glass beat flat Lambert on an airframe), pooled mat()
    // fallback. carfx's shared roles are _shared-flagged against disposal;
    // paint roles are per-colour and live as long as the airport root.
    function vmat(role, color, opts) {
      if (CBZ.vehicleMat) { try { return CBZ.vehicleMat(role, color, opts); } catch (e) {} }
      return mat(color != null ? color : C_METAL, opts);
    }
    const FLEET = {
      white:  vmat("paint", 0xf2f4f6, { roughness: 0.5, metalness: 0.3 }),
      navy:   vmat("paint", 0x1b2438, { roughness: 0.55 }),
      glass:  vmat("glass", 0x10161c),
      metal:  vmat("metal", 0xc8ccd2),
      dark:   vmat("plastic", 0x14181d),
      tire:   vmat("tire", 0x1a1d21),
      navR:   mat(0xff3524, { emissive: 0xff3524, ei: 0.95 }),
      navG:   mat(0x2fd45c, { emissive: 0x2fd45c, ei: 0.95 }),
      navW:   mat(0xf4f8ff, { emissive: 0xf4f8ff, ei: 0.9 }),
      beacon: mat(0xff2a2a, { emissive: 0xff2a2a, ei: 1.0 }),
      accents: {},
    };
    function accentMat(c) {
      const k = "a" + c;
      if (!FLEET.accents[k]) FLEET.accents[k] = vmat("paint", c, { roughness: 0.45 });
      return FLEET.accents[k];
    }
    // per-plane part collector: geometries bucket by material and each
    // bucket merges into ONE child mesh (loose meshes without BGU). The
    // children carry no userData/colliders, so the batcher/freezer treat
    // the parent group exactly as before (collider-ref = live group).
    function partKit() {
      const byMat = new Map();
      return {
        put: function (m, geo, x, y, z, rx, ry, rz) {
          if (rz) geo.rotateZ(rz);
          if (rx) geo.rotateX(rx);
          if (ry) geo.rotateY(ry);
          geo.translate(x, y, z);
          let arr = byMat.get(m);
          if (!arr) { arr = []; byMat.set(m, arr); }
          arr.push(geo);
        },
        bake: function (g) {
          byMat.forEach(function (geos, m) {
            if (geos.length > 1 && BGU && BGU.mergeBufferGeometries) {
              const mesh = new THREE.Mesh(BGU.mergeBufferGeometries(geos), m);
              mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh);
            } else {
              for (const gm of geos) {
                const mesh = new THREE.Mesh(gm, m);
                mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh);
              }
            }
          });
        },
      };
    }
    // tiny static emissive marker (nav lights / beacons)
    function navBox(g, m, x, y, z, s) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(s || 0.26, s || 0.26, s || 0.26), m);
      b.position.set(x, y, z); g.add(b);
      return b;
    }

    function buildAirliner(x, z, heading, livery) {
      const g = new THREE.Group();
      g.position.set(x, 0, z); g.rotation.y = heading;
      const acc = accentMat(livery || 0x2d5fb0);
      const K = partKit();
      const L = 30, R = 1.9;      // barrel length / legacy radius (collider height stays R+3)
      const FH = 3.8, FW = 3.4;   // fuselage box cross-section (old barrel's silhouette)
      const CY = R + 1.6;         // fuselage centreline height — UNCHANGED (flight/camera anchors)
      const BELLY = CY - FH / 2;  // 1.6 — struts rise to here, wheels touch y=0

      // fuselage: white barrel + sculpted drooped nose + upswept tailcone
      // (pieces butt-join at full cross-section with a 0.05 overlap — seamless)
      K.put(FLEET.white, new THREE.BoxGeometry(L, FH, FW, 2, 1, 1), 0, CY, 0);
      K.put(FLEET.white, fuseGeo(4.2, FH, FW, { nose: 0.24, noseY: -1.0 }), L / 2 + 2.05, CY, 0);
      K.put(FLEET.white, fuseGeo(5.6, FH, FW, { tail: 0.16, tailY: 1.25 }), -L / 2 - 2.75, CY, 0);
      // dark cockpit glass band wrapping the nose root
      K.put(FLEET.glass, new THREE.BoxGeometry(2.4, 0.95, FW + 0.1), L / 2 + 0.6, CY + 0.8, 0);
      // livery: coloured belly stripe wrapping under the white upper fuselage,
      // and the cabin windows as ONE long inset glass strip per side
      K.put(acc, new THREE.BoxGeometry(L, 0.95, FW + 0.12), 0, BELLY + 0.42, 0);
      for (const sgn of [-1, 1]) {
        K.put(FLEET.glass, new THREE.BoxGeometry(L - 6, 0.42, 0.1), 0.5, CY + 0.7, sgn * (FW / 2 + 0.02));
      }

      // ONE swept tapered wing pair + upturned accent winglets
      K.put(FLEET.white, wingGeo(28, 5.5, 2.2, 0.55, 4.5, 0.9), 0.5, BELLY + 0.55, 0);
      for (const sgn of [-1, 1]) K.put(acc, new THREE.BoxGeometry(1.5, 2.1, 0.32), -4.2, 3.95, sgn * 13.9);

      // underwing engines: sculpted nacelle + accent intake lip ring + dark
      // inlet disc + dark exhaust + pylon up into the wing
      for (const sgn of [-1, 1]) {
        const nz = sgn * 5.6;
        K.put(FLEET.white, fuseGeo(4.0, 1.5, 1.5, { nose: 0.94, tail: 0.66 }), 2.2, 1.4, nz);
        K.put(acc, new THREE.BoxGeometry(0.34, 1.68, 1.68), 4.15, 1.4, nz);
        K.put(FLEET.dark, new THREE.BoxGeometry(0.2, 1.22, 1.22), 4.3, 1.4, nz);
        K.put(FLEET.dark, new THREE.BoxGeometry(0.5, 0.92, 0.92), 0.28, 1.42, nz);
        K.put(FLEET.white, new THREE.BoxGeometry(1.9, 1.0, 0.42), 1.4, 2.25, nz);
      }

      // tail: swept accent fin + two-tone geometric logo block + tailplane
      K.put(acc, finGeo(6.2, 5.2, 2.6, 0.5, 2.6), -16.5, 7.8, 0);
      K.put(FLEET.white, new THREE.BoxGeometry(1.6, 1.6, 0.62), -18.3, 9.2, 0);
      K.put(FLEET.navy, new THREE.BoxGeometry(0.95, 0.95, 0.7), -17.9, 8.8, 0);
      K.put(FLEET.white, wingGeo(11, 3.4, 1.5, 0.4, 1.8, 0.35), -17.6, CY + 1.1, 0);

      // gear: 2-wheel nose leg + two 4-wheel main bogies, chunky struts.
      // Wheel pairs are axle-spanning cylinders; every wheel bottoms at y=0.
      K.put(FLEET.metal, new THREE.BoxGeometry(0.36, 1.4, 0.36), 10, 1.0, 0);
      for (const sgn of [-1, 1]) K.put(FLEET.tire, new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10), 10, 0.42, sgn * 0.34, Math.PI / 2);
      for (const sgn of [-1, 1]) {
        const mz = sgn * 3.1;
        K.put(FLEET.metal, new THREE.BoxGeometry(0.42, 1.2, 0.42), -2.2, 1.15, mz);   // strut into the belly
        K.put(FLEET.metal, new THREE.BoxGeometry(2.6, 0.4, 0.5), -2.2, 0.72, mz);     // bogie beam
        for (const bx of [-3.05, -1.35]) K.put(FLEET.tire, new THREE.CylinderGeometry(0.55, 0.55, 1.34, 10), bx, 0.55, mz, Math.PI / 2);
      }
      K.bake(g);

      // nav lights: port red / starboard green wingtips, white tail, beacon
      navBox(g, FLEET.navR, -4.0, 3.1, -14.05);
      navBox(g, FLEET.navG, -4.0, 3.1, 14.05);
      navBox(g, FLEET.navW, -20.35, 10.5, 0);
      navBox(g, FLEET.beacon, -2, 5.55, 0, 0.3);

      root.add(g);
      // body collider (fuselage footprint), oriented-agnostic AABB approx
      const span = Math.max(L, 18);
      g.userData.worldCollider = solid(x, z, span, span * 0.7, 0, R + 3, g);
      return g;
    }

    function buildPrivateJet(x, z, heading, livery) {
      const g = new THREE.Group();
      g.position.set(x, 0, z); g.rotation.y = heading;
      const acc = accentMat(livery || 0x355c8a);
      const K = partKit();
      const L = 11, R = 1.1;      // barrel length / legacy radius (collider height stays R+3)
      const FH = 2.2, FW = 2.0;   // fuselage box cross-section
      const CY = R + 1.0;         // centreline height — UNCHANGED (2.1)
      const BELLY = CY - FH / 2;  // 1.0

      // fuselage: white barrel + LOW drooped nose taper + upswept tailcone
      K.put(FLEET.white, new THREE.BoxGeometry(L, FH, FW, 2, 1, 1), 0, CY, 0);
      K.put(FLEET.white, fuseGeo(3.6, FH, FW, { nose: 0.22, noseY: -0.62 }), L / 2 + 1.75, CY, 0);
      K.put(FLEET.white, fuseGeo(3.8, FH, FW, { tail: 0.18, tailY: 0.8 }), -L / 2 - 1.85, CY, 0);
      // dark cockpit glass band at the nose root
      K.put(FLEET.glass, new THREE.BoxGeometry(1.5, 0.72, FW + 0.08), L / 2 + 0.55, CY + 0.42, 0);
      // exec livery: angled accent swoosh rising to the nose + thin midnight
      // echo line under it; oval-ish cabin windows as ONE inset strip a side
      for (const sgn of [-1, 1]) {
        const fz = sgn * (FW / 2 + 0.02);
        K.put(acc, new THREE.BoxGeometry(7.5, 0.5, 0.06), 0.8, CY - 0.25, fz, 0, 0, 0.09);
        K.put(FLEET.navy, new THREE.BoxGeometry(6.2, 0.16, 0.05), 0.2, CY - 0.62, fz, 0, 0, 0.09);
        K.put(FLEET.glass, new THREE.BoxGeometry(6.4, 0.3, 0.06), 0.9, CY + 0.55, fz);
      }
      // stair-door hint: inset dark panel on the front-left (port) flank
      K.put(FLEET.dark, new THREE.BoxGeometry(0.95, 1.3, 0.07), 3.5, CY - 0.1, -(FW / 2 + 0.03));

      // low swept wing pair + accent winglets
      K.put(FLEET.white, wingGeo(13.5, 3.0, 1.2, 0.32, 2.4, 0.5), -0.6, BELLY + 0.35, 0);
      for (const sgn of [-1, 1]) K.put(acc, new THREE.BoxGeometry(0.8, 1.05, 0.3), -3.0, 2.2, sgn * 6.65);

      // aft-mounted twin engine pods: sculpted pod + accent intake lip +
      // dark inlet disc + dark exhaust, on a stub pylon off the tail barrel
      for (const sgn of [-1, 1]) {
        const ez = sgn * (FW / 2 + 0.62);
        K.put(FLEET.white, fuseGeo(2.6, 1.0, 1.0, { nose: 0.92, tail: 0.6 }), -5.2, CY + 0.55, ez);
        K.put(acc, new THREE.BoxGeometry(0.26, 1.12, 1.12), -4.0, CY + 0.55, ez);
        K.put(FLEET.dark, new THREE.BoxGeometry(0.16, 0.8, 0.8), -3.9, CY + 0.55, ez);
        K.put(FLEET.dark, new THREE.BoxGeometry(0.4, 0.6, 0.6), -6.4, CY + 0.55, ez);
        K.put(FLEET.white, new THREE.BoxGeometry(1.3, 0.5, 0.5), -5.1, CY + 0.35, sgn * (FW / 2 + 0.18));
      }

      // refined T-tail: swept accent fin, white logo block, tailplane on top
      K.put(acc, finGeo(3.4, 2.6, 1.2, 0.3, 1.4), -8.0, 4.4, 0);
      K.put(FLEET.white, new THREE.BoxGeometry(0.55, 0.55, 0.42), -8.95, 5.25, 0);
      K.put(FLEET.white, wingGeo(4.6, 1.5, 0.9, 0.3, 0.7, 0), -9.0, 6.2, 0);

      // tricycle gear with belly cover plates; wheels bottom at y=0
      K.put(FLEET.metal, new THREE.BoxGeometry(0.24, 0.8, 0.24), 4.4, 0.7, 0);
      K.put(FLEET.tire, new THREE.CylinderGeometry(0.3, 0.3, 0.3, 10), 4.4, 0.3, 0, Math.PI / 2);
      K.put(FLEET.white, new THREE.BoxGeometry(0.8, 0.6, 0.08), 4.4, 0.78, 0.24);      // nose gear door
      for (const sgn of [-1, 1]) {
        K.put(FLEET.metal, new THREE.BoxGeometry(0.28, 0.7, 0.28), -1.7, 0.75, sgn * 1.05);
        K.put(FLEET.tire, new THREE.CylinderGeometry(0.35, 0.35, 0.32, 10), -1.7, 0.35, sgn * 1.05, Math.PI / 2);
        K.put(FLEET.white, new THREE.BoxGeometry(0.85, 0.65, 0.08), -1.7, 0.75, sgn * 1.34); // gear covers
      }
      K.bake(g);

      // nav lights: port red / starboard green wingtips, white tail, beacon
      navBox(g, FLEET.navR, -3.0, 1.95, -6.6, 0.2);
      navBox(g, FLEET.navG, -3.0, 1.95, 6.6, 0.2);
      navBox(g, FLEET.navW, -10.0, 5.9, 0, 0.2);
      navBox(g, FLEET.beacon, 0.4, 3.32, 0, 0.22);

      root.add(g);
      g.userData.worldCollider = solid(x, z, 14, 12, 0, R + 3, g);
      return g;
    }

    // parked airliners at the gates (along the terminal apron edge) — each a
    // STEALABLE aircraft (climb in and fly it off the gate).
    const liveries = [0x2d5fb0, 0xb33636, 0x1f7a4d, 0xc78a1f];
    for (let i = 0; i < 4; i++) {
      const gx = -120 + i * 55;
      const hd = Math.PI / 2 + (rng() - 0.5) * 0.05;
      boardablePlane(buildAirliner(gx, APRON_Z - 14, hd, liveries[i]), gx, APRON_Z - 14, hd, 30, 22, "Airliner");
    }
    // private jets on the far apron — also stealable
    boardablePlane(buildPrivateJet(95, APRON_Z - 6, Math.PI / 2 - 0.2, 0x355c8a), 95, APRON_Z - 6, Math.PI / 2 - 0.2, 14, 12, "Private Jet");
    boardablePlane(buildPrivateJet(118, APRON_Z + 2, Math.PI / 2 + 0.4, 0x6a3a6a), 118, APRON_Z + 2, Math.PI / 2 + 0.4, 14, 12, "Private Jet");

    // =====================================================================
    //  8) ONE AIRLINER MID-PUSHBACK (scripted, purely visual) — a jet on a
    //     connector taxiway being eased back by a tug. It creeps along a
    //     short path then resets, so the field reads ALIVE without any
    //     physics or collision churn. CBZ.onUpdate, alloc-free.
    // =====================================================================
    (function pushback() {
      const jet = buildAirliner(-160, TAX_Z - 6, Math.PI / 2, 0x444b55);
      // a baggage tug shoved up against the nose
      const tug = box(-160 + 16, 0.8, TAX_Z - 6, 3, 1.4, 2, 0xe8c020, { cast: true });
      // the tug ANIMATES (position.z below): tag it so the static batcher /
      // matrix freeze never bake it (an untagged plain mesh gets merged and
      // the pushback would visibly freeze).
      tug.userData.dynamic = true;
      const z0 = TAX_Z - 6, z1 = TAX_Z - 30, speed = 0.7;
      let t = 0, dir = 1;
      CBZ.onUpdate(40, function (dt) {
        if (!jet || !jet.parent) return;
        t += dt * speed * dir;
        if (t > 1) { t = 1; dir = -1; }
        else if (t < 0) { t = 0; dir = 1; }
        const z = z0 + (z1 - z0) * t;
        jet.position.z = z; tug.position.z = z + 16;
      });
    })();

    // =====================================================================
    //  9) GROUND SUPPORT EQUIPMENT — fuel truck, stair trucks, baggage
    //     carts. Static boxes (cheap), with colliders. Stair trucks parked
    //     at the airliner doors complete the "ready to board" read.
    // =====================================================================
    function fuelTruck(x, z, ry) {
      box(x, 1.0, z, 6, 2.0, 2.4, 0xb0b6bc, { cast: true, ry });   // tank body
      box(x + (ry ? 0 : 3.6), 1.2, z + (ry ? 3.6 : 0), 2.4, 2.4, 2.2, 0x394049, { cast: true }); // cab
      solid(x, z, ry ? 2.4 : 8, ry ? 8 : 2.4, 0, 2.2);
      if (CBZ.makeLabelSprite) { const s = CBZ.makeLabelSprite("JET A-1", { color: "#ffd451" }); if (s) { s.position.set(x, 2.8, z); s.scale.set(4, 1.2, 1); root.add(s); } }
    }
    function stairTruck(x, z) {
      box(x, 1.6, z, 2.4, 3.2, 2.2, 0xdfe3e7, { cast: true });    // stair tower
      box(x, 0.6, z + 1.6, 2.4, 1.2, 1.6, 0x394049, { cast: true }); // truck cab
      solid(x, z, 2.6, 4.4, 0, 3.4);
    }
    fuelTruck(-95, APRON_Z - 26, 0);
    fuelTruck(40, APRON_Z + 18, Math.PI / 2);
    stairTruck(-120, APRON_Z - 24);
    stairTruck(-10, APRON_Z - 24);
    // jet-bridge stubs at the two EMPTY gate slots between the parked
    // airliners (occupied gates board by stair truck — the airliners park
    // tail-to-terminal, so a bridge at their gate would skewer the tail).
    // Elevated corridors off the terminal face: constants only, NO colliders
    // (underside 2.1u+, everything walks under), clear of every plane
    // collider (x ±15 around gates) and of the stolen-plane roll-out path.
    function jetBridge(bx) {
      box(bx, 3.4, 4.5, 3.0, 2.2, 13, 0x9fb4c4, { cast: true });     // corridor from the terminal
      box(bx, 3.4, -2.8, 3.6, 2.6, 2.6, 0x7d8894, { cast: true });   // gate-end head block
    }
    jetBridge(-92.5); jetBridge(-37.5);
    // baggage carts: ONE instanced mesh chain near the terminal
    (function baggageCarts() {
      const geo = new THREE.BoxGeometry(2.0, 1.0, 1.4);
      const n = 8, inst = new THREE.InstancedMesh(geo, mat(0x4a5158), n);
      inst.castShadow = true; const dm = new THREE.Object3D();
      for (let i = 0; i < n; i++) { dm.position.set(-30 + i * 2.4, 0.55, APRON_Z + 24); dm.updateMatrix(); inst.setMatrixAt(i, dm.matrix); }
      inst.instanceMatrix.needsUpdate = true; root.add(inst);
    })();

    // =====================================================================
    //  10) PERIMETER FENCE — the WHY you can't drive into the sea except via
    //      the causeway. A thin collider wall around the footprint with a
    //      gap at the causeway mouth, plus ONE InstancedMesh of posts so it
    //      reads as chain-link. Y-gated low so it's a fence, not a building.
    // =====================================================================
    (function fence() {
      const T = 0.4, H = 2.4, gapX0 = CW_MINX - 2, gapX1 = CW_MAXX + 2;
      // PEDESTRIAN water-access gaps on the three SEAWARD edges (N/W/E). ~3m
      // wide — wider than the 0.55 player radius so you can WALK through to the
      // sea (swim.js auto-engages past the shore), narrower than a car so NPC
      // cars (pinned by clampToCity) still can't drive into the ocean. The
      // causeway side (south) keeps its full fence + checkpoint gate.
      const PG = 3;                                  // pedestrian gap half-span ≈1.5m
      const midX = (A_MINX + A_MAXX) / 2, midZ = (A_MINZ + A_MAXZ) / 2;
      // north (z=A_MAXZ): split around a centre gap
      solid((A_MINX + (midX - PG)) / 2, A_MAXZ, (midX - PG) - A_MINX, T, 0, H);
      solid(((midX + PG) + A_MAXX) / 2, A_MAXZ, A_MAXX - (midX + PG), T, 0, H);
      // west (x=A_MINX): split around a centre gap
      solid(A_MINX, (A_MINZ + (midZ - PG)) / 2, T, (midZ - PG) - A_MINZ, 0, H);
      solid(A_MINX, ((midZ + PG) + A_MAXZ) / 2, T, A_MAXZ - (midZ + PG), 0, H);
      // east (x=A_MAXX): split around a centre gap
      solid(A_MAXX, (A_MINZ + (midZ - PG)) / 2, T, (midZ - PG) - A_MINZ, 0, H);
      solid(A_MAXX, ((midZ + PG) + A_MAXZ) / 2, T, A_MAXZ - (midZ + PG), 0, H);
      // south, left of the causeway gate
      solid((A_MINX + gapX0) / 2, A_MINZ, gapX0 - A_MINX, T, 0, H);
      // south, right of the causeway gate
      solid((gapX1 + A_MAXX) / 2, A_MINZ, A_MAXX - gapX1, T, 0, H);

      // decorative sand/ramp APRONS (no collider) at each seaward gap so it
      // reads as a slipway/beach down to the water.
      function apron(x, z, w, d) {
        const a = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(0xcdb88a));
        a.rotation.x = -Math.PI / 2; a.position.set(x, 0.03, z);
        a.receiveShadow = true; a.matrixAutoUpdate = false; a.updateMatrix(); root.add(a);
      }
      apron(midX, A_MAXZ + 4, PG * 2 + 2, 10);       // north slipway
      apron(A_MINX - 4, midZ, 10, PG * 2 + 2);       // west slipway
      apron(A_MAXX + 4, midZ, 10, PG * 2 + 2);       // east slipway

      // posts — one instanced mesh, skipping ALL gate/gap spans
      const postGeo = new THREE.BoxGeometry(0.18, H, 0.18);
      const pts = [];
      const stepP = 8;
      const inGapZ = (z) => (z > midZ - PG && z < midZ + PG);
      const inGapX = (x) => (x > midX - PG && x < midX + PG);
      for (let x = A_MINX; x <= A_MAXX; x += stepP) {
        if (!inGapX(x)) pts.push([x, A_MAXZ]);       // north (skip centre gap)
        if (x < gapX0 || x > gapX1) pts.push([x, A_MINZ]); // south (skip causeway gate)
      }
      for (let z = A_MINZ; z <= A_MAXZ; z += stepP) {
        if (!inGapZ(z)) { pts.push([A_MINX, z]); pts.push([A_MAXX, z]); } // W/E skip centre gaps
      }
      const inst = new THREE.InstancedMesh(postGeo, mat(C_FENCE), pts.length);
      inst.castShadow = false; const dm = new THREE.Object3D();
      for (let i = 0; i < pts.length; i++) { dm.position.set(pts[i][0], H / 2, pts[i][1]); dm.updateMatrix(); inst.setMatrixAt(i, dm.matrix); }
      inst.instanceMatrix.needsUpdate = true; root.add(inst);
      // thin mesh "mesh-fabric" panels (merged) so it isn't just posts
      if (BGU && BGU.mergeBufferGeometries) {
        const panels = [];
        function panelRun(x0, z0, x1, z1) {
          const len = Math.hypot(x1 - x0, z1 - z0);
          if (len < 0.5) return;
          const g = new THREE.BoxGeometry(len, H * 0.85, 0.05);
          g.rotateY(Math.atan2(z1 - z0, x1 - x0));
          g.translate((x0 + x1) / 2, H * 0.5, (z0 + z1) / 2);
          panels.push(g);
        }
        // north split around centre gap
        panelRun(A_MINX, A_MAXZ, midX - PG, A_MAXZ);
        panelRun(midX + PG, A_MAXZ, A_MAXX, A_MAXZ);
        // west split around centre gap
        panelRun(A_MINX, A_MINZ, A_MINX, midZ - PG);
        panelRun(A_MINX, midZ + PG, A_MINX, A_MAXZ);
        // east split around centre gap
        panelRun(A_MAXX, A_MINZ, A_MAXX, midZ - PG);
        panelRun(A_MAXX, midZ + PG, A_MAXX, A_MAXZ);
        // south split around causeway gate
        panelRun(A_MINX, A_MINZ, gapX0, A_MINZ);
        panelRun(gapX1, A_MINZ, A_MAXX, A_MINZ);
        const fm = new THREE.MeshLambertMaterial({ color: C_FENCE, transparent: true, opacity: 0.18, depthWrite: false });
        const fmesh = new THREE.Mesh(BGU.mergeBufferGeometries(panels), fm);
        fmesh.matrixAutoUpdate = false; root.add(fmesh);
      }
    })();

    // =====================================================================
    //  11) CAUSEWAY — the one drivable road on/off the island. Deck plane
    //      from the mainland north edge (z≈-566) to the airport south edge
    //      (z=-280), low concrete kerbs (colliders) so you can't drive off
    //      the side, and a dashed centre line.
    // =====================================================================
    (function causeway() {
      const cx = (CW_MINX + CW_MAXX) / 2, len = CW_MAXZ - CW_MINZ;
      const cz = (CW_MINZ + CW_MAXZ) / 2;
      // REAL HIGHWAY: a wide multi-lane causeway across the water (merged deck +
      // baked lanes + instanced guardrails/lights + continuous curb colliders).
      if (CBZ.buildHighway) {
        CBZ.buildHighway(root, {
          path: [{ x: cx, z: CW_MINZ }, { x: cx, z: CW_MAXZ }],
          width: 24, lanesPerDir: 2, laneW: 3.6, theme: "asphalt",
          guardrail: true, lights: true, elevated: false, rng: rng,
        });
        return;
      }
      // ---- fallback: bespoke narrow deck (only if buildHighway absent) ----
      const deck = new THREE.Mesh(new THREE.PlaneGeometry(CW_MAXX - CW_MINX, len), mat(0x44484d));
      deck.rotation.x = -Math.PI / 2; deck.position.set(cx, 0.02, cz);
      deck.receiveShadow = true; deck.matrixAutoUpdate = false; deck.updateMatrix(); root.add(deck);
      // kerbs — low solid colliders both sides
      solid(CW_MINX - 0.4, cz, 0.8, len, 0, 0.6);
      solid(CW_MAXX + 0.4, cz, 0.8, len, 0, 0.6);
      box(CW_MINX - 0.4, 0.3, cz, 0.8, 0.6, len, C_CONC, { cast: false });
      box(CW_MAXX + 0.4, 0.3, cz, 0.8, 0.6, len, C_CONC, { cast: false });
      // dashed centre line (merged)
      const dl = [];
      for (let z = CW_MINZ + 4; z < CW_MAXZ - 4; z += 8) dl.push(quadGeo(cx, z, 0.4, 4, 0.04));
      mergePaint(dl, 0xe9e9ea);
      // light poles down the causeway — one instanced mesh
      const poleGeo = new THREE.BoxGeometry(0.25, 6, 0.25);
      const n = Math.floor(len / 26), inst = new THREE.InstancedMesh(poleGeo, mat(0x6b7178), n * 2);
      const dm = new THREE.Object3D(); let idx = 0;
      for (let i = 0; i < n; i++) {
        const z = CW_MINZ + 13 + i * 26;
        dm.position.set(CW_MINX - 1.0, 3, z); dm.updateMatrix(); inst.setMatrixAt(idx++, dm.matrix);
        dm.position.set(CW_MAXX + 1.0, 3, z); dm.updateMatrix(); inst.setMatrixAt(idx++, dm.matrix);
      }
      inst.instanceMatrix.needsUpdate = true; root.add(inst);
    })();

    // =====================================================================
    //  12) POPULATE — passengers with luggage in the concourse, ground crew
    //      in hi-vis on the apron, a couple taxis at the landside curb. A
    //      handful of interactive rigs via cityMakePed (rifle-able cash);
    //      the apron crowd is light so the field doesn't tank the budget.
    // =====================================================================
    (function populate() {
      if (!CBZ.cityMakePed) return;
      // passengers in the terminal (carry-on, low aggression travellers)
      for (let i = 0; i < 14; i++) {
        const sx = -40 + (rng() - 0.5) * 130;
        const sz = 24 + (rng() - 0.5) * 18;
        CBZ.cityMakePed(sx, sz, rng, {
          kind: "civilian", archetype: "tourist", job: "traveller",
          wealth: 0.4 + rng() * 0.4, aggr: 0.06 + rng() * 0.08,
        });
      }
      // ground crew in hi-vis on the apron near the jets
      for (let i = 0; i < 6; i++) {
        const sx = -120 + rng() * 220;
        const sz = APRON_Z - 18 + (rng() - 0.5) * 18;
        CBZ.cityMakePed(sx, sz, rng, {
          kind: "worker", archetype: "laborer", job: "ground crew",
          outfit: 0xffc81f, wealth: 0.25, aggr: 0.12 + rng() * 0.06,
        });
      }
    })();

    // taxis at the landside curb (south of the terminal)
    if (CBZ.cityMakeCar && CBZ.cityEcon && CBZ.cityEcon.carByName) {
      const taxiModel = CBZ.cityEcon.carByName("Taxi") || CBZ.cityEcon.carByName("Sedan") || null;
      for (let i = 0; i < 3; i++) {
        try { CBZ.cityMakeCar(-70 + i * 14, 42, Math.PI / 2, false, taxiModel, 0.2); } catch (e) {}
      }
    }

    // =====================================================================
    //  WORK-ANCHOR — the ground crew's apron: turn the planes at the gates.
    //  The aigoals brain routes ground crew through these apron task points on
    //  the schedule. WHY: the field is WORKED — crew marshals/fuels/loads the
    //  jets parked at the gates. The terminal is their base/home. Reuses the
    //  apron + gate coords already built (no new geometry).
    // =====================================================================
    if (CBZ.registerWorkAnchor) {
      CBZ.registerWorkAnchor({
        biome: "airport", kind: "terminal", role: "ground crew",
        x: -40, z: APRON_Z - 16, cap: 6,
        home: { x: -40, z: 24 },                            // the terminal concourse
        spots: [
          { x: -120, z: APRON_Z - 14 },                     // gate 1 airliner
          { x: -10, z: APRON_Z - 14 },                      // mid-apron gate
          { x: 95, z: APRON_Z - 6 },                        // the private-jet apron
          { x: -40, z: APRON_Z + 18 },                      // the baggage / GSE line
        ],
      });
    }

    // =====================================================================
    //  13) REGISTER THE REGIONS — walkable airport footprint + the causeway
    //      deck. world.js/swim.js/fullmap consult these.
    // =====================================================================
    CBZ.registerCityRegion(city, {
      name: "Halloran Field", subtitle: "International Airport", biome: "airport", kind: "rect",
      minX: A_MINX, maxX: A_MAXX, minZ: A_MINZ, maxZ: A_MAXZ, pad: 6,
    });
    CBZ.registerCityRegion(city, {
      name: "Halloran Causeway", subtitle: "International Airport", kind: "rect",
      minX: CW_MINX, maxX: CW_MAXX, minZ: CW_MINZ, maxZ: CW_MAXZ, pad: 1,
    });
    // give traffic a road down the causeway (runs along Z → vertical)
    if (city.roads) {
      city.roads.push({ x: (CW_MINX + CW_MAXX) / 2, z: (CW_MINZ + CW_MAXZ) / 2, vertical: true, len: CW_MAXZ - CW_MINZ, district: "highway" });
    }

    // ---- MAKE THE PARKED FLEET STEALABLE (deferred — militaryvehicles.js loads
    // after this island). Run once after worldgen; feature-detected so a missing
    // module just leaves the jets as solid scenery.
    if (CBZ.onUpdate) {
      CBZ.onUpdate(55.1, function () {
        if (_reg) return;
        if (!CBZ.cityRegisterMilitaryVehicle) return;
        placed.forEach(function (p) { CBZ.cityRegisterMilitaryVehicle(p); });
        _reg = true;
      });
    }
  }, 21);
})();

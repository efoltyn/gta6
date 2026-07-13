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
  // One unit is one metre. The airliner follows the published A320 envelope;
  // business-jet values describe the actual low-poly model below. Keeping the
  // dimensions on the group gives boarding, collision, flight and audit code a
  // single source of truth instead of five unrelated footprint literals.
  const AIRCRAFT_DIMS = Object.freeze({
    airliner: Object.freeze({ family: "A320-class", length: 37.57, span: 35.80, height: 11.76, fuselage: 3.95 }),
    privatejet: Object.freeze({ family: "business-jet", length: 21.50, span: 13.50, height: 6.35, fuselage: 2.00 }),
  });
  CBZ.CITY_AIRCRAFT_DIMS = AIRCRAFT_DIMS;

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
    const dims = grp.userData.aircraftDims || null;
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
      aircraftDims: dims,
      footW: dims ? dims.length : (footW || 18),
      footL: dims ? dims.span : (footL || 18), taken: false, hot: true,
    });
    return grp;
  }

  // ============================================================
  //  CABIN BOARDING — the elevator-grammar door flow for the parked
  //  airliners (owner request): walk to the forward port door → prompt →
  //  the panel SLIDES open → step inside a real cabin (aisle, seat rows,
  //  seated passengers, cockpit door) → exit the same way, or take a seat
  //  (CBZ.propSit, guard-called). While the player is inside we detach the
  //  plane's solid hull AABB (the same rec.collider the theft flow
  //  detaches, same flag) and stand them on a temporary CBZ.platforms deck
  //  record; both are restored/removed on exit, on death, on mode change,
  //  and when the plane is stolen out from under us. All geometry math is
  //  done in PLANE-LOCAL space so it works at any parked heading.
  // ============================================================
  const cabinState = { inside: false, rec: null, platform: null, pending: null, zonesReg: false };

  function cabinLocal(rec, wx, wz) {
    const th = rec.group.rotation.y, c = Math.cos(th), s = Math.sin(th);
    const dx = wx - rec.group.position.x, dz = wz - rec.group.position.z;
    return { x: dx * c - dz * s, z: dx * s + dz * c };
  }
  function cabinWorld(rec, lx, lz) {
    const th = rec.group.rotation.y, c = Math.cos(th), s = Math.sin(th);
    return {
      x: rec.group.position.x + lx * c + lz * s,
      z: rec.group.position.z - lx * s + lz * c,
    };
  }
  function cabinDoorWorld(rec) {
    const cab = rec.group.userData.cabin;
    return cabinWorld(rec, cab.doorX, cab.doorZ);
  }
  function cabinRemovePlatform() {
    if (cabinState.platform && CBZ.platforms) {
      const i = CBZ.platforms.indexOf(cabinState.platform);
      if (i >= 0) CBZ.platforms.splice(i, 1);
    }
    cabinState.platform = null;
  }
  // restoreCollider=true → put the hull AABB back (normal exit). false → the
  // plane was stolen out from under us; the flight system owns the collider
  // lifecycle now (its restorePropCollider reattaches on park).
  function cabinForceClear(restoreCollider) {
    const rec = cabinState.rec;
    cabinRemovePlatform();
    if (rec) {
      if (restoreCollider && rec._cabinDetached && rec.collider && !rec.taken) {
        if (CBZ.colliders && CBZ.colliders.indexOf(rec.collider) < 0) CBZ.colliders.push(rec.collider);
        rec._colliderDetached = false;
        if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      }
      rec._cabinDetached = false;
    }
    cabinState.inside = false; cabinState.rec = null; cabinState.pending = null;
  }
  function cabinReset() { cabinForceClear(false); }

  function cabinCompleteBoard(rec) {
    const P = CBZ.player;
    if (!P || P.dead || P.driving || P._aircraft) return;
    if (!rec || rec.taken || !rec.group || !rec.group.parent) return;
    const cab = rec.group.userData.cabin; if (!cab) return;
    // hull AABB off (same detach the theft flow uses — shared flag, so the
    // two systems can hand the collider to each other without double-work)
    if (rec.collider && !rec._colliderDetached) {
      const i = CBZ.colliders ? CBZ.colliders.indexOf(rec.collider) : -1;
      if (i >= 0) CBZ.colliders.splice(i, 1);
      rec._colliderDetached = true; rec._cabinDetached = true;
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    // standable cabin deck (oriented-extent AABB, same trick as the
    // collider restore in playeraircraft.js)
    const th = rec.group.rotation.y;
    const ca = Math.abs(Math.cos(th)), sa = Math.abs(Math.sin(th));
    const hx = 12.4, hz = 1.6;                            // cabin local half-extents
    const ctr = cabinWorld(rec, -0.2, 0);
    const ex = ca * hx + sa * hz, ez = sa * hx + ca * hz;
    cabinState.platform = {
      minX: ctr.x - ex, maxX: ctr.x + ex, minZ: ctr.z - ez, maxZ: ctr.z + ez,
      top: rec.group.position.y + cab.floorTop,
    };
    if (CBZ.platforms) CBZ.platforms.push(cabinState.platform);
    // step in at the door row
    const inPt = cabinWorld(rec, 9.4, -0.6);
    P.pos.set(inPt.x, cabinState.platform.top, inPt.z);
    P.vy = 0; P.grounded = true;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
    cabinState.inside = true; cabinState.rec = rec;
    if (CBZ.sfx) { try { CBZ.sfx("door"); } catch (e) {} }
  }

  function cabinCompleteExit(rec) {
    const P = CBZ.player;
    if (CBZ.propStand && P && P._propSeat) { try { CBZ.propStand(P); } catch (e) {} }
    if (P && rec && rec.group) {
      const out = cabinWorld(rec, rec.group.userData.cabin.doorX, -4.4);
      const gy = CBZ.floorAt ? CBZ.floorAt(out.x, out.z) : 0;
      P.pos.set(out.x, gy, out.z);
      P.vy = 0; P.grounded = true;
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
    }
    cabinForceClear(true);
    if (CBZ.sfx) { try { CBZ.sfx("door"); } catch (e) {} }
  }

  function cabinSitNearest() {
    const P = CBZ.player, rec = cabinState.rec;
    if (!P || !rec || !CBZ.propSit) return;
    const cab = rec.group.userData.cabin;
    if (!cab || !cab.seats || !cab.seats.length) return;
    const l = cabinLocal(rec, P.pos.x, P.pos.z);
    let best = null, bd = Infinity;
    for (let i = 0; i < cab.seats.length; i++) {
      const s0 = cab.seats[i];
      const d = (s0.x - l.x) * (s0.x - l.x) + (s0.z - l.z) * (s0.z - l.z);
      if (d < bd) { bd = d; best = s0; }
    }
    if (!best) return;
    const w = cabinWorld(rec, best.x, best.z);
    const th = rec.group.rotation.y;
    // seated body faces along (sin f, cos f) — aim it down the nose (+X local)
    try {
      CBZ.propSit(P, {
        x: w.x, y: rec.group.position.y + cab.floorTop + 0.45, z: w.z,
        face: th + Math.PI / 2, kind: "chair", lot: null, occupant: null,
      });
    } catch (e) {}
  }

  function cabinZones() {
    if (cabinState.zonesReg || !CBZ.interactions || !CBZ.interactions.registerZone || !CBZ.interactions.register) return;
    cabinState.zonesReg = true;
    // BOARD THE CABIN — walk-in boarding lives as a SECOND verb on the SAME
    // "milvehicle" candidate the theft flow uses, NOT a separate interaction
    // zone. A zone is its own candidate, and the interaction registry only ever
    // surfaces ONE candidate's options at a time (interactions.js scores a
    // single `current` target) — so a door zone right on the hull was always
    // shadowed by militaryvehicles.js's HIJACK option and never reachable
    // (proved by a CDP probe: pressing E hijacked the plane instead). Riding
    // the milvehicle layer means the airliner card shows BOTH verbs together:
    //   [E] Hijack the airliner  (fly it — militaryvehicles.js, loud, 4★)
    //   [I] Board the cabin       (this — elevator-style walk-in, harmless)
    // Slot I never collides with the E hijack, so both are always offered when
    // you walk up to a parked airliner. The board reach is the milvehicle
    // candidate's own 5.5m footprint reach (militaryvehicles.js) — NOT the door
    // itself: the solid hull AABB spans the whole wing/fuselage footprint, so
    // on foot you're stopped ~17m out at the wingtip and can never actually
    // touch the forward port door. Pressing I arms the board; the per-frame
    // door-ease below force-opens the panel for the 0.55s pending window
    // (wantOpen keys off cabinState.pending), THEN cabinCompleteBoard steps you
    // into the cabin — the same "walk up → door slides → step in" elevator
    // grammar, without demanding a door-touch the collider forbids.
    CBZ.interactions.register("milvehicle", {
      id: "airliner_board", slot: "i", prio: 1,
      canShow: function (v, ctx) {
        if (!v || v.flightKind !== "airliner" || v.taken) return false;
        if (!v.group || !v.group.parent || !v.group.userData || !v.group.userData.cabin) return false;
        if (cabinState.inside || cabinState.pending) return false;
        const P = CBZ.player;
        if (!P || P.dead || P.driving || P._aircraft) return false;
        return true;
      },
      label: "Board the cabin",
      onSelect: function (v) {
        if (!v || v.taken || cabinState.inside || cabinState.pending) return;
        cabinState.pending = { rec: v, t: 0.55, dir: "in" };   // door slides, then you step in
      },
    });
    CBZ.interactions.registerZone({
      id: "airliner_cabin", kind: "airliner_cabin", prio: 6,
      find: function (px, pz) {
        if (!cabinState.inside || cabinState.pending) return null;
        const P = CBZ.player;
        return P ? { x: px, z: pz } : null;
      },
      options: [
        {
          id: "airliner_exit", slot: "e", label: "Exit the airliner",
          onSelect: function () {
            if (!cabinState.inside) return;
            cabinState.pending = { rec: cabinState.rec, t: 0.5, dir: "out" };
          },
        },
        { id: "airliner_sit", slot: "i", label: "Take a seat", onSelect: cabinSitNearest },
      ],
    });
  }

  // per-frame: door easing, delayed board/exit, and inside upkeep (clamp the
  // player to the aisle box in plane-local space; bail out cleanly if the
  // plane is stolen, the player dies, or the mode changes)
  CBZ.onUpdate(55.2, function (dt) {
    if (!CBZ.game || CBZ.game.mode !== "city") {
      if (cabinState.inside || cabinState.pending) cabinForceClear(true);
      return;
    }
    cabinZones();
    const P = CBZ.player;
    // door panels ease toward open near the player / while boarding / inside
    for (let i = 0; i < placed.length; i++) {
      const rec = placed[i];
      const cab = rec.group && rec.group.userData && rec.group.userData.cabin;
      if (!cab || !cab.panel) continue;
      let wantOpen = false;
      if (!rec.taken && rec.group.parent) {
        if ((cabinState.inside && cabinState.rec === rec) ||
            (cabinState.pending && cabinState.pending.rec === rec)) wantOpen = true;
        else if (P && !P.dead && !P.driving && !P._aircraft) {
          const d = cabinDoorWorld(rec);
          wantOpen = Math.hypot(P.pos.x - d.x, P.pos.z - d.z) < 3.4;
        }
      }
      const tgt = wantOpen ? 1 : 0;
      if (Math.abs(cab.doorT - tgt) > 0.001) {
        cab.doorT += (tgt - cab.doorT) * Math.min(1, dt * 3.2);
        cab.panel.position.x = cab.doorX - 1.18 * cab.doorT;   // slide aft along the hull
      }
    }
    // pending board/exit resolves once the door has had time to slide
    if (cabinState.pending) {
      cabinState.pending.t -= dt;
      if (cabinState.pending.t <= 0) {
        const pend = cabinState.pending;
        cabinState.pending = null;
        if (pend.dir === "in") cabinCompleteBoard(pend.rec);
        else cabinCompleteExit(pend.rec);
      }
    }
    // inside upkeep
    if (cabinState.inside) {
      const rec = cabinState.rec;
      if (!P || P.dead || !rec || !rec.group || !rec.group.parent) { cabinForceClear(true); return; }
      if (P._aircraft || P.driving) { cabinForceClear(false); return; }   // stole it from the cockpit
      if (!P._propSeat) {
        const l = cabinLocal(rec, P.pos.x, P.pos.z);
        const lx = Math.max(-12.2, Math.min(11.8, l.x));
        const lz = Math.max(-1.42, Math.min(1.42, l.z));
        if (lx !== l.x || lz !== l.z) {
          const w = cabinWorld(rec, lx, lz);
          P.pos.x = w.x; P.pos.z = w.z;
        }
      }
    }
  });

  // ---- region geometry ----
  // The west side is deliberately the long side of the field: Neon Reef ends
  // at x=-950, leaving a clean 50 m water/terrain seam before this footprint.
  // That unused land lets the airport carry a runway which actually reads at
  // aircraft scale without pushing east into Diamond Speedway.
  const A_MINX = -900, A_MAXX = 290, A_MINZ = -280, A_MAXZ = 40;
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
    // + one-shot guard so the rebuilt fleet re-registers as boardable, and
    // drop any stale cabin-boarding state (platform/collider refs die with
    // the old groups).
    placed.length = 0; _reg = false; cabinReset();

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
    function aircraftSolid(group, dims) {
      const h = group.rotation.y || 0;
      const ca = Math.abs(Math.cos(h)), sa = Math.abs(Math.sin(h));
      const w = ca * dims.length + sa * dims.span;
      const d = sa * dims.length + ca * dims.span;
      return solid(group.position.x, group.position.z, w, d, 0, dims.height, group);
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
    //  2) RUNWAY 09/27 — E-W, 1,090 long × 30 wide, centred north of mid.
    //     Real markings: solid edge lines, dashed centreline, threshold
    //     "piano keys", runway designator numbers, aiming-point bars.
    // =====================================================================
    const RWY_Z = -90;            // runway centre line (z)
    const RWY_W = 30;             // width
    const RWY_X0 = -850, RWY_X1 = 240, RWY_LEN = RWY_X1 - RWY_X0;  // 1,090 long
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

    // =====================================================================
    //  CABIN INTERIOR (owner: "planes should, like elevators, have a door
    //  and a real place inside, and real passengers sitting"). Every
    //  airliner gets a real cabin baked into the same merged part-kit:
    //  BackSide liner shell (visible only from inside), a raised deck over
    //  the wing carry-through, 11 rows of two-across benches, SEATED VOXEL
    //  PASSENGERS (deterministic via the airport rng stream), interior
    //  window strips, ceiling light strips, an aft pressure wall and a
    //  cockpit bulkhead with door + a two-seat cockpit behind it. The
    //  boarding door is a separate SLIDING panel mesh (animated by the
    //  boarding system below — tagged dynamic so the freezer spares it).
    //  Costs a handful of merged draws per plane; zero per-frame work when
    //  nobody is near.
    // =====================================================================
    const CABIN_FLOOR = 2.5;             // deck top (clears the wing box at 2.42)
    const CABIN_DOOR_X = 10.5;           // door local x (forward, port side)
    const paxShirts = [0xb04a3a, 0x3a6fb0, 0x4a8a4f, 0xc7a03a, 0x8a5aa0, 0xd8dde2].map(function (c) { return mat(c); });
    const paxSkins = [0xe8b48c, 0xc98d62, 0x8a5a3a].map(function (c) { return mat(c); });
    const paxHair = mat(0x2a2320);
    const paxLegs = mat(0x2e3644);
    const linerMat = new THREE.MeshLambertMaterial({ color: 0xe8eaee, side: THREE.BackSide });
    const cabinFloorMat = mat(0x33383f);
    const cabinLightMat = mat(0xfff2d8, { emissive: 0xffe9b8, ei: 0.75 });

    // one seated voxel passenger facing the nose (+X), hips on a cushion top
    function paxAt(K, x, z) {
      const shirt = paxShirts[(rng() * paxShirts.length) | 0];
      const skin = paxSkins[(rng() * paxSkins.length) | 0];
      K.put(shirt, new THREE.BoxGeometry(0.34, 0.6, 0.5), x - 0.05, 3.27, z);   // torso
      K.put(skin, new THREE.BoxGeometry(0.26, 0.26, 0.26), x - 0.05, 3.72, z);  // head
      K.put(paxHair, new THREE.BoxGeometry(0.28, 0.09, 0.28), x - 0.05, 3.89, z); // hair cap
      K.put(paxLegs, new THREE.BoxGeometry(0.42, 0.16, 0.44), x + 0.22, 3.0, z);  // lap/thighs
      K.put(paxLegs, new THREE.BoxGeometry(0.16, 0.4, 0.4), x + 0.42, 2.74, z);   // shins
      K.put(shirt, new THREE.BoxGeometry(0.11, 0.46, 0.12), x - 0.02, 3.22, z - 0.3); // arms
      K.put(shirt, new THREE.BoxGeometry(0.11, 0.46, 0.12), x - 0.02, 3.22, z + 0.3);
    }

    function buildCabin(K, g, acc) {
      // liner shell + deck + aisle carpet
      K.put(linerMat, new THREE.BoxGeometry(25.2, 2.9, 3.2), -0.2, 3.9, 0);
      K.put(cabinFloorMat, new THREE.BoxGeometry(25.2, 0.14, 3.1), -0.2, CABIN_FLOOR - 0.07, 0);
      K.put(FLEET.navy, new THREE.BoxGeometry(23.4, 0.03, 0.8), -0.2, CABIN_FLOOR + 0.02, 0);
      // aft pressure wall + cockpit bulkhead with a dark cockpit door
      K.put(cabinFloorMat, new THREE.BoxGeometry(0.14, 2.9, 3.1), -12.7, 3.9, 0);
      K.put(cabinFloorMat, new THREE.BoxGeometry(0.14, 2.9, 3.1), 12.1, 3.9, 0);
      K.put(FLEET.dark, new THREE.BoxGeometry(0.08, 1.78, 0.8), 12.0, 3.42, 0);
      // interior window strips + ceiling light strips
      for (const sgn of [-1, 1]) {
        K.put(FLEET.dark, new THREE.BoxGeometry(21, 0.5, 0.05), -0.7, 4.15, sgn * 1.55);
        K.put(cabinLightMat, new THREE.BoxGeometry(22, 0.05, 0.28), -0.5, 5.24, sgn * 0.5);
      }
      // cockpit behind the bulkhead: console block + two pilot seats
      K.put(FLEET.dark, new THREE.BoxGeometry(1.0, 0.85, 2.4), 14.2, 3.25, 0);
      for (const sgn of [-1, 1]) {
        K.put(FLEET.navy, new THREE.BoxGeometry(0.55, 0.16, 0.55), 13.1, 2.86, sgn * 0.58);
        K.put(FLEET.navy, new THREE.BoxGeometry(0.16, 0.8, 0.55), 12.75, 3.3, sgn * 0.58);
      }
      // seat rows (two-across benches both sides, aisle |z|<0.45 clear) +
      // deterministic seated passengers; empty seats are recorded so the
      // boarding system can offer the player a real "take a seat"
      const seats = [];
      for (let rx = -11.2; rx <= 8.8; rx += 2.0) {
        for (const s of [-1, 1]) {
          const zc = s * 1.0;
          K.put(FLEET.navy, new THREE.BoxGeometry(0.62, 0.16, 1.1), rx, 2.87, zc);       // cushion
          K.put(FLEET.navy, new THREE.BoxGeometry(0.18, 0.85, 1.1), rx - 0.34, 3.32, zc); // back
          K.put(FLEET.dark, new THREE.BoxGeometry(0.5, 0.32, 0.95), rx, 2.66, zc);        // pedestal
          K.put(FLEET.dark, new THREE.BoxGeometry(0.16, 0.2, 0.32), rx - 0.36, 3.85, zc - 0.28); // headrests
          K.put(FLEET.dark, new THREE.BoxGeometry(0.16, 0.2, 0.32), rx - 0.36, 3.85, zc + 0.28);
          // window + aisle seat: passenger or bookable empty seat
          if (rng() < 0.6) paxAt(K, rx, s * 1.28); else seats.push({ x: rx + 0.03, z: s * 1.28 });
          if (rng() < 0.3) paxAt(K, rx, s * 0.72); else seats.push({ x: rx + 0.03, z: s * 0.72 });
        }
      }
      // DOORWAY (port, forward): dark recess in the hull + warm sill light
      K.put(FLEET.dark, new THREE.BoxGeometry(1.14, 1.92, 0.1), CABIN_DOOR_X, 3.46, -1.64);
      K.put(cabinLightMat, new THREE.BoxGeometry(1.0, 0.06, 0.06), CABIN_DOOR_X, 4.48, -1.68);
      // sliding DOOR PANEL — a separate live mesh the boarding system eases
      // aft along the hull; dynamic-tagged so batcher/freezer leave it alone
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.06, 1.86, 0.1), FLEET.white);
      panel.position.set(CABIN_DOOR_X, 3.45, -1.73);
      panel.userData.dynamic = true;
      const panelBand = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.3, 0.04), acc);
      panelBand.position.set(0, -0.35, -0.04);
      panel.add(panelBand);
      g.add(panel);
      g.userData.cabin = {
        floorTop: CABIN_FLOOR,
        doorX: CABIN_DOOR_X, doorZ: -1.7,
        seats, panel, doorT: 0,
      };
    }

    function buildAirliner(x, z, heading, livery) {
      const g = new THREE.Group();
      g.position.set(x, 0, z); g.rotation.y = heading;
      const acc = accentMat(livery || 0x2d5fb0);
      const K = partKit();
      const DIMS = AIRCRAFT_DIMS.airliner;
      // 27.9m centre barrel + 4.2m nose + 5.6m tail = 37.55m end-to-end.
      const L = 27.9, R = 1.9;
      const FH = DIMS.fuselage, FW = DIMS.fuselage;
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
      K.put(FLEET.white, wingGeo(DIMS.span, 5.5, 2.2, 0.55, 4.5, 0.9), 0.5, BELLY + 0.55, 0);
      for (const sgn of [-1, 1]) K.put(acc, new THREE.BoxGeometry(1.5, 2.1, 0.32), -4.2, 3.95, sgn * (DIMS.span / 2 - 0.2));

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
      K.put(acc, finGeo(6.2, 5.2, 2.6, 0.5, 2.6), -16.5, 8.65, 0);
      K.put(FLEET.white, new THREE.BoxGeometry(1.6, 1.6, 0.62), -18.3, 10.05, 0);
      K.put(FLEET.navy, new THREE.BoxGeometry(0.95, 0.95, 0.7), -17.9, 9.65, 0);
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
      buildCabin(K, g, acc);        // real interior + sliding boarding door
      K.bake(g);

      // nav lights: port red / starboard green wingtips, white tail, beacon
      navBox(g, FLEET.navR, -4.0, 3.1, -DIMS.span / 2);
      navBox(g, FLEET.navG, -4.0, 3.1, DIMS.span / 2);
      navBox(g, FLEET.navW, -19.35, 11.55, 0);
      navBox(g, FLEET.beacon, -2, 5.55, 0, 0.3);

      root.add(g);
      g.userData.aircraftDims = DIMS;
      g.userData.worldCollider = aircraftSolid(g, DIMS);
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
      g.userData.aircraftDims = AIRCRAFT_DIMS.privatejet;
      g.userData.worldCollider = aircraftSolid(g, AIRCRAFT_DIMS.privatejet);
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
      const jetCollider = jet.userData.worldCollider;
      let jetSolid = true;
      function setJetSolid(on) {
        if (!jetCollider || jetSolid === on || !CBZ.colliders) return;
        const i = CBZ.colliders.indexOf(jetCollider);
        if (on && i < 0) CBZ.colliders.push(jetCollider);
        else if (!on && i >= 0) CBZ.colliders.splice(i, 1);
        jetSolid = on;
        if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      }
      // a baggage tug shoved up against the nose
      const tug = box(-160 + 16, 0.8, TAX_Z - 6, 3, 1.4, 2, 0xe8c020, { cast: true });
      // the tug ANIMATES (position.z below): tag it so the static batcher /
      // matrix freeze never bake it (an untagged plain mesh gets merged and
      // the pushback would visibly freeze).
      tug.userData.dynamic = true;
      // One-way ground operation: dwell → push once → taxi away → reset only
      // while hidden. The old implementation eventually reversed the visible
      // airliner back into its start pose, even after a long pause.
      const z0 = TAX_Z - 6, z1 = TAX_Z - 30;
      const pushSeconds = 34, taxiSpeed = 3.2;
      let state = "dwell", phase = 0, dwellT = 12;
      CBZ.onUpdate(40, function (dt) {
        if (!jet || !jet.parent) return;
        if (state === "dwell") {
          dwellT -= dt;
          if (dwellT <= 0) { setJetSolid(false); state = "push"; }
          return;
        }
        if (state === "push") {
          phase = Math.min(1, phase + dt / pushSeconds);
          const e = phase * phase * (3 - 2 * phase);
          const z = z0 + (z1 - z0) * e;
          jet.position.z = z; tug.position.z = z + 16;
          if (phase >= 1) { state = "taxi"; tug.visible = false; }
          return;
        }
        if (state === "taxi") {
          jet.position.z -= taxiSpeed * dt;
          // Clear the visible airport before recycling. The next lifecycle
          // begins parked, never driving backward through the player's view.
          if (jet.position.z < A_MINZ - 90) {
            jet.visible = false;
            jet.position.z = z0; tug.position.z = z0 + 16;
            phase = 0; dwellT = 45; state = "hidden";
          }
          return;
        }
        if (state === "hidden") {
          dwellT -= dt;
          if (dwellT <= 0) { jet.visible = true; tug.visible = true; setJetSolid(true); dwellT = 18; state = "dwell"; }
        }
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
          width: 24, lanesPerDir: 3, median: true, medianW: 1.2, laneW: 3.6, theme: "asphalt",
          guardrail: true, elevated: false, rng: rng,
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
    // NO-SPAWN keep-outs (owner: "NPCs spawning all over the runway and
    // inside the airport — they belong in terminal areas/curbs"). Every
    // scatter/relocation path (worldmap.js citySpawnBlocked) refuses these:
    //   • AIRSIDE — everything south of the terminal frontage: the runway
    //     (z≈-90), taxiway (z≈-40) and the open apron/ramp.
    //   • the terminal building's own footprint (tx=-40,tz=24,tw=150,td=26 →
    //     x[-115,35] z[11,37]) so nobody materializes inside the concourse.
    // Hand-placed staff (populate()'s ground crew/passengers) don't route
    // through the scatter paths, so the authored airport life is untouched.
    if (CBZ.registerNoSpawnZone) {
      CBZ.registerNoSpawnZone(city, { minX: A_MINX, maxX: A_MAXX, minZ: A_MINZ, maxZ: 9, label: "airport-airside" });
      CBZ.registerNoSpawnZone(city, { minX: -116, maxX: 36, minZ: 10, maxZ: 38, label: "airport-terminal" });
    }
    city.airportAudit = {
      bounds: { minX: A_MINX, maxX: A_MAXX, minZ: A_MINZ, maxZ: A_MAXZ },
      runway: { minX: RWY_X0, maxX: RWY_X1, minZ: RWY_Z - RWY_W / 2, maxZ: RWY_Z + RWY_W / 2 },
      noSpawn: [
        { minX: A_MINX, maxX: A_MAXX, minZ: A_MINZ, maxZ: 9, label: "airport-airside" },
        { minX: -116, maxX: 36, minZ: 10, maxZ: 38, label: "airport-terminal" },
      ],
      aircraft: AIRCRAFT_DIMS,
    };
    // give traffic a road down the causeway (runs along Z → vertical)
    if (city.roads) {
      city.roads.push({ x: (CW_MINX + CW_MAXX) / 2, z: (CW_MINZ + CW_MAXZ) / 2, vertical: true, len: CW_MAXZ - CW_MINZ, district: "highway", w: 24, lanesPerDir: 3, laneW: 3.6, median: true, medianW: 1.2 });
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

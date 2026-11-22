/* ============================================================
   city/house_yard.js — THE HOUSE LOT: a detached house standing on its land.

   OWNER: "the houses in the game are also dumb." And: "first making all
   assets look great, and you can reuse great ones from Natural Disaster,
   like great stop signs and roads and fences and houses."

   A house reads as a house from the street and from the air because of its
   LAND: it stands back from the street behind a front yard, it has side
   yards, a driveway runs past it to a garage, a walk runs to its door, and
   the lot is bounded by a fence with a gate in it and a mailbox at the kerb.

     CBZ.houseLot.plan(o)    lot + door face + the house the street wants ->
                             where the house stands (centre, size) and where
                             its garage and its driveway go.
     CBZ.houseLot.dress(root, p)   the land round a built house, by WHO LIVES
                             THERE (p.tier, city/house_plan.js: the
                             neighbourhood's own wealth):
        poor   chain link or nothing on the street line, a carport or a bare
               drive, weeds for a border, a washing line and what got left
               out the back
        mid    a white picket fence or a clipped hedge with a gate on the
               walk, shrubs and flowers under the windows, a board fence
               round the back yard, a patio with a table, a shed, a bin
        rich   a rendered wall between piers (or a tall hedge) with iron
               gates, lanterns on the walk, a walled back garden with a
               pool where there is room for one, a double garage

     THE FENCES, GATE POSTS, PATHS, MAILBOX, BIN AND SHRUBS ARE THE NATURAL
     DISASTER ISLAND'S (world/island_dressing.js's own builders, asked for as
     a kit): the pointed pickets, the capped wall, the hedge. What is the
     city's own is laid with the same emitters. One vertex-coloured mesh per
     lot (one draw call), colliders for everything you could walk into.

   THE CAR. dress() says where a car stands on this lot (lot.building.garage:
   on the drive, nose to the garage door) and city/realestate.js keeps the
   owner's car there.

   Reference proportions (US suburban codes and plan guides: friscotexas.gov
   "Single-Family Front Entry Lot Layout Guidelines", ecode360 Town and
   Country MO suburban districts): front setback 6-8 m (20-25 ft), side yards
   1.5 m (5 ft) or more, a 3-6 m driveway (10-20 ft), a 1.2 m front walk, a
   1.0-1.2 m front fence or hedge, a 1.8 m privacy fence round the back yard,
   a single garage 3.6 x 6.5 m, a double 6.2 x 6.5 m.

   DETERMINISM: pure geometry plus position hashes. No rng draw anywhere.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function h01(x, z, s) {
    if (CBZ.hash01) return CBZ.hash01(x, z, s);
    const v = Math.sin(x * 12.9898 + z * 78.233 + s * 0.123) * 43758.5453;
    return v - Math.floor(v);
  }
  function shadeHex(hex, f) {
    const r = Math.max(0, Math.min(255, (((hex >> 16) & 255) * f) | 0));
    const g = Math.max(0, Math.min(255, (((hex >> 8) & 255) * f) | 0));
    const b = Math.max(0, Math.min(255, ((hex & 255) * f) | 0));
    return (r << 16) | (g << 8) | b;
  }

  const HL = {};
  // the standard pieces (m)
  HL.FRONT = 6.5;          // front yard, lot line to the house face
  HL.SIDE = 1.5;           // side yard minimum
  HL.REAR = 3.0;           // back yard minimum
  HL.GARAGE1 = 3.6;        // single garage width
  HL.GARAGE2 = 6.2;        // double
  HL.GARAGE_D = 6.6;       // garage depth
  HL.DRIVE = 5.4;          // city/approach.js DRIVE_W: the driveway the lot gets

  /* ---- THE PLAN --------------------------------------------------------------
     o: { cx, cz, w, d (the lot), nx, nz (OUTWARD unit normal of the street
          face), want: { w, d } the house the street would build (along the
          street, back from it), minW, minD (smallest acceptable house),
          garage: bool (allowed), garageW (a wider garage where the frontage
          holds it), rear (a deeper back yard where the lot holds it), salt }
     Returns { x, z, w, d (the house, world, axis-aligned), garage: { t, w,
     d } | null (t: along the street from the lot centre), front, side,
     t (house centre along the street), a (along the normal, from the lot
     centre), tx, tz (the street tangent) } */
  HL.plan = function (o) {
    const nx = o.nx || 0, nz = o.nz || 0;
    const tx = -nz, tz = nx;                                    // along the street
    const lotT = Math.abs(nx) > 0.5 ? o.d : o.w;               // the lot's frontage
    const lotA = Math.abs(nx) > 0.5 ? o.w : o.d;               // its depth
    const want = o.want || {};
    const minW = o.minW || 8, minD = o.minD || 8;
    const salt = o.salt || 0;
    // the front yard: ~a quarter of a deep lot, never under 3.5 m
    const front = clamp(lotA * 0.24, 3.5, o.front != null ? o.front : HL.FRONT);
    const rear = Math.max(clamp(lotA * 0.12, 1.5, HL.REAR + 2), Math.min(o.rear || 0, lotA - front - minD));
    let hd = clamp(want.d || lotA - front - rear, minD, Math.max(minD, lotA - front - rear));
    let hw = clamp(want.w || lotT - 2 * HL.SIDE, minW, Math.max(minW, lotT - 2 * HL.SIDE));
    // a garage beside the house when the frontage holds both
    let garage = null;
    const gs = h01(o.cx, o.cz, 0x9a7 + salt) < 0.5 ? -1 : 1;  // which side of the drive the house is on
    // the driveway: on the lot's centreline where the kerb is already cut
    // for it (o.driveFixed: the Gang City grid, world.js drops the kerb from
    // city/approach.js's solve before any house exists), else wherever the
    // house wants it, a single 3.2 m drive down one side of the lot
    let driveAt = 0, driveHalf = HL.DRIVE / 2;
    let t = null;
    const room = lotT / 2 - HL.SIDE;                             // centreline to the side yard
    if (o.driveFixed) {
      if (o.garage !== false) {
        // the garage on the centreline, the house beside it
        for (const gw of [HL.GARAGE2, HL.GARAGE1]) {
          const maxHouse = room - gw / 2;                          // the garage's far edge to the side yard
          if (maxHouse >= minW && hd > HL.GARAGE_D * 0.7) {
            hw = Math.min(hw, maxHouse);
            garage = { t: 0, w: gw, d: Math.min(HL.GARAGE_D, hd - 0.5) };
            t = gs * (gw / 2 + hw / 2);
            break;
          }
        }
      }
      if (t == null) {
        const slack = Math.max(0, room - hw / 2);
        t = gs * Math.min(slack, driveHalf + 0.3 + hw / 2);
      }
    } else {
      driveHalf = 1.6;
      // a garage at the end of a side drive, the house against it (a double
      // one where it was asked for and the frontage still holds the house)
      for (const gw of (o.garageW > HL.GARAGE1 ? [o.garageW, HL.GARAGE1] : [HL.GARAGE1])) {
        const gC = lotT / 2 - 0.5 - gw / 2;                        // the garage (and drive) centre, from the lot centre
        const withG = room + gC - gw / 2;                           // the house from the garage edge to the far side yard
        if (o.garage !== false && withG >= Math.max(minW, gw > HL.GARAGE1 ? Math.min(hw, 11.5) : minW) && hd > HL.GARAGE_D * 0.7) {
          hw = Math.min(hw, withG);
          driveAt = -gs * gC;
          driveHalf = gw > HL.GARAGE1 ? 2.7 : 1.6;
          garage = { t: driveAt, w: gw, d: Math.min(HL.GARAGE_D, hd - 0.5) };
          const u0 = gC - gw / 2;                                   // the garage's inner edge, on the house's side
          t = gs * (-u0 + hw / 2);
          break;
        }
      }
      if (!garage) {
        const dC = lotT / 2 - 0.5 - driveHalf;                    // a drive down the side line
        const span = room + (dC - driveHalf - 0.4);               // the house from the drive's edge to the side yard
        if (span >= minW) {
          hw = Math.min(hw, span);
          driveAt = -gs * dC;
          t = gs * (-(dC - driveHalf - 0.4) + hw / 2);
        } else {
          // too narrow for a side drive: the house in the middle, a parking
          // pad in front of it (the drive runs to its face)
          driveAt = 0; driveHalf = HL.DRIVE / 2; t = 0;
        }
      }
    }
    const a = lotA / 2 - front - hd / 2;                        // the house face is `front` behind the lot line
    const x = o.cx + tx * t + nx * a, z = o.cz + tz * t + nz * a;
    const w = Math.abs(nx) > 0.5 ? hd : hw, d = Math.abs(nx) > 0.5 ? hw : hd;
    return { x: x, z: z, w: w, d: d, hw: hw, hd: hd, t: t, a: a, front: front, garage: garage, gs: gs, driveAt: driveAt, driveHalf: driveHalf,
      tx: tx, tz: tz, nx: nx, nz: nz, lotT: lotT, lotA: lotA, cx: o.cx, cz: o.cz };
  };

  /* ---- THE DRESSING ------------------------------------------------------------
     root: the group to add the lot's mesh to. p: HL.plan's result plus
       y      the lot surface's height (the house's floor sits on it)
       doorT  the door's position along the street (default the house centre)
       storeys
       tier   "poor" | "mid" | "rich" (default mid), wealth 0..1
       style  the street line: "chain" | "picket" | "hedge" | "wall" | "open"
              (default: by tier and position)
       pal    { body, trim, roof } (default: the house grammar's, published
              by city/facades/house_parts.js, else neutral)
       ownGarage  the house grammar drew its own garage door (the ranch)
       lot    the lot record: its building learns where its car stands
     Returns { mesh, colliders, garageRect, stand }. */
  /* ---- WHAT MOVES ON A LOT: THE GATE, THE GARAGE DOOR, THE CAR ON THE DRIVE --------
     A lot is one merged mesh, and a merged mesh cannot swing. The leaves that
     move are INSTANCES: one InstancedMesh for every gate of a kind in the
     world and one for every garage door (four draw calls for all of them, not
     one per house), given to the lots within LEAF_R of the player and taken
     back when they fall behind or their lot is streamed out.

       THE GATE on the walk is shut until you walk into it: it swings away
         from you and stays where it is left (the front door's rule). E shuts
         it, or opens it without walking through. It has no collider: a gate
         that is shut is a gate you push.
       THE GARAGE DOOR rolls up for whoever holds the house's key (E, on foot
         or at the wheel). A locked one can be forced: that is loud and it is
         a burglary (the same alarm and charge as a kicked-in front door).
         Shut, it is a wall (its collider); open, the collider is out.
       A RESIDENT'S CAR stands on the drive of seven houses in ten that
         somebody lives in (not one of yours: the drive is then for your own
         cars, city/realestate.js). It is a real parked car, of a make the
         street can afford; drive it away and it is stolen, and gone.
     The lot's record leaves with its stream job (the hook below). */
  const RECS = [];
  let RSEQ = 0;
  const POOLS = Object.create(null);
  const LEAF_R = 90, CAR_R = 75;
  const M4 = new THREE.Matrix4(), QT = new THREE.Quaternion(), V1 = new THREE.Vector3(), V2 = new THREE.Vector3(), CL = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);
  // [x0, x1, y0, y1, z0, z1, shade] boxes -> one geometry (white, shaded per box)
  function boxesGeo(list) {
    const n = list.length, P = new Float32Array(n * 72), N = new Float32Array(n * 72), C = new Float32Array(n * 72), I = new Uint16Array(n * 36);
    let v = 0, ii = 0;
    for (const b of list) {
      const g = new THREE.BoxGeometry(b[1] - b[0], b[3] - b[2], b[5] - b[4]);
      g.translate((b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2);
      P.set(g.attributes.position.array, v * 3); N.set(g.attributes.normal.array, v * 3);
      const sh = b[6] == null ? 1 : b[6];
      for (let k = 0; k < 72; k++) C[v * 3 + k] = sh;
      const ix = g.index.array; for (let k = 0; k < 36; k++) I[ii + k] = ix[k] + v;
      v += 24; ii += 36; g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(P, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(C, 3));
    geo.setIndex(new THREE.BufferAttribute(I, 1));
    geo._shared = true;
    return geo;
  }
  // a leaf is one metre long from its hinge (x 0..1), scaled to its own length
  const LEAF = {
    picket: function () {
      const L = [[0.02, 1, 0.24, 0.31, -0.015, 0.015], [0.02, 1, 0.72, 0.79, -0.015, 0.015]];
      for (let i = 0; i < 7; i++) { const c = (i + 0.5) / 7; L.push([c - 0.035, c + 0.035, 0.07, 0.95, 0.015, 0.033]); }
      return boxesGeo(L);
    },
    chain: function () {
      const L = [[0, 1, 0.06, 0.095, -0.018, 0.018], [0, 1, 1.14, 1.175, -0.018, 0.018], [0, 0.036, 0.06, 1.175, -0.018, 0.018], [0.964, 1, 0.06, 1.175, -0.018, 0.018]];
      for (let u = 0.2; u < 0.9; u += 0.175) L.push([u - 0.005, u + 0.005, 0.09, 1.14, -0.005, 0.005, 0.8]);
      for (const y of [0.4, 0.78]) L.push([0.03, 0.97, y - 0.005, y + 0.005, -0.005, 0.005, 0.8]);
      return boxesGeo(L);
    },
    iron: function () {
      const L = [[0, 1, 0.1, 0.14, -0.02, 0.02], [0, 1, 1.03, 1.07, -0.02, 0.02]];
      for (let u = 0.03; u <= 1; u += 0.125) L.push([u - 0.012, u + 0.012, 0.1, 1.18 + (Math.abs(u - 0.5) < 0.26 ? 0.1 : 0.03), -0.012, 0.012]);
      return boxesGeo(L);
    },
    // a sectional door: x -0.5..0.5, y 0..1 (scaled to the opening), four panels on a darker back
    garage: function () {
      const L = [[-0.5, 0.5, 0, 1, 0, 0.02, 0.72]];
      for (let k = 0; k < 4; k++) L.push([-0.5, 0.5, k / 4 + 0.007, (k + 1) / 4 - 0.007, 0.02, 0.05]);
      for (let k = 0; k < 4; k++) for (const e of [-0.25, 0.25]) L.push([e - 0.19, e + 0.19, k / 4 + 0.05, (k + 1) / 4 - 0.05, 0.05, 0.058, 0.93]);
      return boxesGeo(L);
    },
  };
  let _leafMat = null;
  function leafMat() {
    if (_leafMat) return _leafMat;
    _leafMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    _leafMat._shared = true; _leafMat.name = "house-lot-leaf";
    return _leafMat;
  }
  function poolGrow(pl, cap) {
    const old = pl.mesh;
    const mesh = new THREE.InstancedMesh(old ? old.geometry : LEAF[pl.name](), leafMat(), cap);
    mesh.name = "house-lot-" + pl.name; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.userData.dynamic = true; mesh.matrixAutoUpdate = false;
    M4.makeScale(0, 0, 0); CL.setRGB(1, 1, 1);
    for (let i = 0; i < cap; i++) { mesh.setMatrixAt(i, M4); mesh.setColorAt(i, CL); }
    if (old) {
      mesh.instanceMatrix.array.set(old.instanceMatrix.array);
      mesh.instanceColor.array.set(old.instanceColor.array);
      if (old.parent) old.parent.remove(old);
      old.dispose();
    }
    for (let i = cap - 1; i >= pl.cap; i--) pl.free.push(i);
    pl.cap = cap; pl.mesh = mesh;
    CBZ.scene.add(mesh);
  }
  function poolOf(name) {
    if (!CBZ.scene) return null;
    let pl = POOLS[name];
    if (pl && pl.mesh.parent === CBZ.scene) return pl;
    pl = POOLS[name] = { name: name, cap: 0, mesh: null, free: [] };
    poolGrow(pl, 32);
    return pl;
  }
  function leafTake(name) { const pl = poolOf(name); if (!pl) return -1; if (!pl.free.length) poolGrow(pl, pl.cap * 2); return pl.free.pop(); }
  function leafGive(name, i) {
    const pl = POOLS[name];
    if (!pl || i < 0 || i >= pl.cap) return;
    M4.makeScale(0, 0, 0); pl.mesh.setMatrixAt(i, M4); pl.mesh.instanceMatrix.needsUpdate = true;
    pl.free.push(i);
  }
  function leafPut(name, i, x, y, z, yaw, sx, sy, col) {
    const pl = POOLS[name];
    if (!pl || i < 0) return;
    QT.setFromAxisAngle(UP, yaw); M4.compose(V1.set(x, y, z), QT, V2.set(sx, sy, 1));
    pl.mesh.setMatrixAt(i, M4); pl.mesh.instanceMatrix.needsUpdate = true;
    if (col) { pl.mesh.setColorAt(i, CL.setRGB(col[0], col[1], col[2])); pl.mesh.instanceColor.needsUpdate = true; }
  }
  // is this lot's mesh in the world right now (not parked, not freed)?
  function attached(rec) { let o = rec.mesh, n = 0; while (o && n++ < 8) { if (o === CBZ.scene) return true; o = o.parent; } return false; }
  const GATE_OPEN = 1.32;
  function poseGate(rec) {
    const g = rec.gate;
    for (const lf of g.leaves) {
      if (lf.inst < 0) continue;
      // closed, the leaf lies along the fence from its hinge; open, it has
      // turned by ang toward the house (+) or the street (-)
      const c = Math.cos(g.ang), sn = Math.sin(g.ang);
      const dx = g.tx * lf.dir * c - g.nx * sn, dz = g.tz * lf.dir * c - g.nz * sn;
      leafPut(g.kind, lf.inst, lf.hx, g.y, lf.hz, Math.atan2(-dz, dx), lf.L, 1, g.col);
    }
  }
  function poseDoors(rec) {
    const yaw = Math.atan2(rec.nx, rec.nz), k = 1 - 0.95 * rec.open;
    for (const d of rec.doors) if (d.inst >= 0) leafPut("garage", d.inst, d.x, d.y + d.h * (1 - k), d.z, yaw, d.w, d.h * k, d.col);
  }
  function doorSolid(rec, shut) {
    for (const d of rec.doors) {
      const c = d.solid; if (!c) continue;
      const inIt = CBZ.colliders.indexOf(c) >= 0;
      if (shut && !inIt) { if (CBZ.colliderAdd) CBZ.colliderAdd(c); else CBZ.colliders.push(c); }
      else if (!shut && inIt) { if (CBZ.colliderRemove) CBZ.colliderRemove(c); else CBZ.colliders.splice(CBZ.colliders.indexOf(c), 1); }
    }
  }
  function recOn(rec) {
    rec.on = true;
    if (rec.gate) { for (const lf of rec.gate.leaves) if (lf.inst < 0) lf.inst = leafTake(rec.gate.kind); poseGate(rec); }
    if (rec.doors) { for (const d of rec.doors) if (d.inst < 0) d.inst = leafTake("garage"); poseDoors(rec); doorSolid(rec, rec.open < 0.5); }
  }
  function recOff(rec) {
    rec.on = false;
    if (rec.gate) for (const lf of rec.gate.leaves) if (lf.inst >= 0) { leafGive(rec.gate.kind, lf.inst); lf.inst = -1; }
    if (rec.doors) for (const d of rec.doors) if (d.inst >= 0) { leafGive("garage", d.inst); d.inst = -1; }
  }
  /* ---- the resident's car ---- */
  let CARS_BY_TIER = null;
  function carsFor(tier) {
    const E = CBZ.cityEcon, all = E && E.CARS;
    if (!all || !all.length) return null;
    if (!CARS_BY_TIER) {
      const ok = function (c) { return c && !c.livery && c.value > 0; };
      CARS_BY_TIER = {
        poor: all.filter(function (c) { return ok(c) && c.value <= 9500; }),
        mid: all.filter(function (c) { return ok(c) && c.value >= 4000 && c.value <= 42000; }),
        rich: all.filter(function (c) { return ok(c) && c.value >= 30000; }),
      };
    }
    const L = CARS_BY_TIER[tier];
    return L && L.length ? L : null;
  }
  function lived(rec) {
    const lot = rec.lot, b = lot && lot.building;
    if (!b || !b.home || lot.demolished) return false;
    // (every house nobody has bought carries a FOR SALE sign in this city and
    // has its resident on the sofa all the same: the sign is not the test)
    if (CBZ.cityOwnsLot && CBZ.cityOwnsLot(lot)) return false;
    return true;
  }
  function carAtStand(st, r) {
    for (const c of CBZ.cityCars || []) if (c && !c.dead && c.pos && Math.abs(c.pos.x - st.x) < r && Math.abs(c.pos.z - st.z) < r) return c;
    return null;
  }
  function carTick(rec, d, canAdd) {
    const st = rec.stand;
    if (rec.car) {
      const c = rec.car;
      const gone = c.dead || !CBZ.cityCars || CBZ.cityCars.indexOf(c) < 0;
      const moved = !gone && c.pos && Math.hypot(c.pos.x - st.x, c.pos.z - st.z) > 4;
      if (gone || moved || c.player) { rec.car = null; rec.carDone = true; return false; }      // taken, or wrecked: it does not come back
      if (d > CAR_R + 30 || !lived(rec)) { try { CBZ.cityScrapCar(c); } catch (e) {} rec.car = null; }
      return false;
    }
    if (!canAdd || rec.carDone || d > CAR_R || !st || !CBZ.cityAddParkedCar) return false;
    if (h01(rec.cx, rec.cz, 0x7f6) > 0.7 || !lived(rec)) { rec.carDone = true; return false; }   // out, or nobody's home
    if (carAtStand(st, 3.2)) return false;
    const L = carsFor(rec.tier);
    const m = L ? L[(h01(rec.cx, rec.cz, 0x7f7) * L.length) | 0] : null;
    let c = null;
    try { c = CBZ.cityAddParkedCar(st.x, st.z, st.heading, m ? { modelName: m.name } : {}); } catch (e) { c = null; }
    if (!c) { rec.carDone = true; return false; }
    c._resident = rec.lot || true;
    rec.car = c;
    return true;
  }
  function dropRec(rec) {
    recOff(rec);
    if (rec.car) {
      const c = rec.car, st = rec.stand;
      if (!c.dead && !c.player && c.pos && st && Math.hypot(c.pos.x - st.x, c.pos.z - st.z) < 4) { try { CBZ.cityScrapCar(c); } catch (e) {} }
      rec.car = null;
    }
    const i = RECS.indexOf(rec); if (i >= 0) RECS.splice(i, 1);
  }
  if (CBZ.streamBusHook) CBZ.streamBusHook({
    mark: function () { return RSEQ; },
    since: function (m) { const out = []; for (let i = RECS.length - 1; i >= 0 && RECS[i].seq > m; i--) out.push(RECS[i]); return out; },
    drop: function (items) { for (const it of items) dropRec(it); },
  });
  let scanT = 0, NEAR = [], wired = false;
  function gateOf(px, pz, r) {
    let best = null, bd = r * r;
    for (const rec of NEAR) { const g = rec.gate; if (!g || !rec.on) continue; const q = (g.x - px) * (g.x - px) + (g.z - pz) * (g.z - pz); if (q < bd) { bd = q; best = rec; } }
    return best;
  }
  function garageOf(px, pz, r) {
    let best = null, bd = r * r;
    for (const rec of NEAR) { if (!rec.doors || !rec.on) continue; const q = (rec.gx - px) * (rec.gx - px) + (rec.gz - pz) * (rec.gz - pz); if (q < bd) { bd = q; best = rec; } }
    return best;
  }
  function holdsKey(rec) { return !!(rec.lot && CBZ.cityHomeKey && CBZ.cityHomeKey(rec.lot)); }
  function wire() {
    const I = CBZ.interactions;
    if (wired || !I || !I.registerZone) return;
    wired = true;
    // (ay: where a finger finds it on a touch screen, the middle of the leaf)
    const tgt = function (rec, key, x, z, h) { const t = rec[key] || (rec[key] = { pos: { x: 0, y: rec.y0, z: 0 }, ay: rec.y0 + h, ar: 0.5 }); t.x = t.pos.x = x; t.z = t.pos.z = z; t.rec = rec; return t; };
    I.registerZone({
      id: "house-gate", kind: "housegate", radius: 1.7, prio: 5, driving: false,
      find: function (px, pz) { const rec = gateOf(px, pz, 1.7); return rec ? tgt(rec, "_gateTgt", rec.gate.x, rec.gate.z, 0.6) : null; },
      options: [
        { id: "house-gate-shut", slot: "e", prio: 3, campaignSafe: true, label: "Shut the gate",
          canShow: function (t) { return !!(t && t.rec && t.rec.gate.want !== 0); },
          onSelect: function (t) { const g = t.rec.gate; g.want = 0; g.hold = true; } },
        { id: "house-gate-open", slot: "e", prio: 3, campaignSafe: true, label: "Open the gate",
          canShow: function (t) { return !!(t && t.rec && t.rec.gate.want === 0); },
          onSelect: function (t) {
            const g = t.rec.gate, P = CBZ.player;
            const out = P && P.pos ? (P.pos.x - g.x) * g.nx + (P.pos.z - g.z) * g.nz : 1;
            g.want = out >= 0 ? GATE_OPEN : -GATE_OPEN; g.hold = false;
          } },
      ],
    });
    if (I.describe) I.describe("housegate", function (t) { return { label: "Gate", note: t && t.rec && t.rec.gate.want !== 0 ? "open" : "shut" }; });
    I.registerZone({
      id: "house-garage", kind: "housegarage", radius: 3.4, prio: 5,
      find: function (px, pz) { const rec = garageOf(px, pz, 3.4); return rec ? tgt(rec, "_garTgt", rec.gx, rec.gz, 1.1) : null; },
      options: [
        { id: "house-garage-open", slot: "e", prio: 3, campaignSafe: true, label: "Open the garage",
          canShow: function (t) { return !!(t && t.rec && t.rec.want < 0.5 && (holdsKey(t.rec) || t.rec.forced)); },
          onSelect: function (t) { t.rec.want = 1; if (CBZ.sfx) { try { CBZ.sfx("door_open"); } catch (e) {} } } },
        { id: "house-garage-shut", slot: "e", prio: 3, campaignSafe: true, label: "Shut the garage",
          canShow: function (t) { return !!(t && t.rec && t.rec.want > 0.5); },
          onSelect: function (t) { t.rec.want = 0; if (CBZ.sfx) { try { CBZ.sfx("door_open"); } catch (e) {} } } },
        { id: "house-garage-force", slot: "e", prio: 2, hold: true, bad: true, label: "Force the garage door",
          canShow: function (t) { return !!(t && t.rec && t.rec.want < 0.5 && !t.rec.forced && !holdsKey(t.rec)); },
          onSelect: function (t) {
            const rec = t.rec;
            rec.forced = true; rec.want = 1;
            if (CBZ.sfx) { try { CBZ.sfx("door_open"); } catch (e) {} }
            if (CBZ.cityAlarm) { try { CBZ.cityAlarm(rec.gx, rec.gz, 22, 0.7, CBZ.city && CBZ.city.playerActor); } catch (e) {} }
            if (CBZ.cityCrime) { try { CBZ.cityCrime(40, { x: rec.gx, z: rec.gz, type: "burglary" }); } catch (e) {} }
          } },
      ],
    });
    if (I.describe) I.describe("housegarage", function (t) {
      const rec = t && t.rec;
      return { label: "Garage door", note: !rec ? "" : rec.want > 0.5 ? "open" : (holdsKey(rec) ? "shut" : rec.forced ? "forced" : "locked") };
    });
  }
  function moversTick(dt) {
    if (!RECS.length) return;
    const P = CBZ.player;
    if (!P || !P.pos || !CBZ.scene) return;
    if (!(CBZ.game && CBZ.game.mode === "city")) { if (NEAR.length) { for (const r of RECS) if (r.on) recOff(r); NEAR = []; } return; }
    wire();
    const px = P.pos.x, pz = P.pos.z;
    scanT -= dt;
    if (scanT <= 0) {
      scanT = 0.35;
      NEAR = [];
      let cars = 0, added = false;
      for (const r of RECS) if (r.car) cars++;
      const carCap = CBZ.qScale ? Math.round(CBZ.qScale(5, 16)) : 16;
      for (let i = 0; i < RECS.length; i++) {
        const rec = RECS[i];
        const d = Math.hypot(rec.cx - px, rec.cz - pz);
        const here = d < LEAF_R + (rec.on ? 15 : 0) && attached(rec);
        if (here && !rec.on && (rec.gate || rec.doors)) recOn(rec);
        else if (!here && rec.on) recOff(rec);
        if (rec.stand && (rec.car || (here && !added && cars < carCap))) { if (carTick(rec, here ? d : 1e9, true)) { added = true; cars++; } }
        if (here && d < 26) NEAR.push(rec);
      }
    }
    for (let i = 0; i < NEAR.length; i++) {
      const rec = NEAR[i];
      if (!rec.on) continue;
      const g = rec.gate;
      if (g) {
        const ax = (px - g.x) * g.nx + (pz - g.z) * g.nz, al = (px - g.x) * g.tx + (pz - g.z) * g.tz;
        const at = Math.abs(al) < g.half + 0.15 && Math.abs(ax) < 0.85 && Math.abs((P.pos.y || 0) - g.y) < 2;
        if (g.hold && !at && Math.hypot(px - g.x, pz - g.z) > 1.7) g.hold = false;
        // walk into it and it swings away from you
        if (at && !g.hold && g.want === 0 && !P.driving) g.want = ax >= 0 ? GATE_OPEN : -GATE_OPEN;
        if (g.ang !== g.want) {
          const st = 3.4 * dt;
          g.ang = Math.abs(g.want - g.ang) <= st ? g.want : g.ang + Math.sign(g.want - g.ang) * st;
          poseGate(rec);
        }
      }
      if (rec.doors && rec.open !== rec.want) {
        const st = dt / 1.6;
        const was = rec.open;
        rec.open = Math.abs(rec.want - rec.open) <= st ? rec.want : rec.open + Math.sign(rec.want - rec.open) * st;
        poseDoors(rec);
        if ((was < 0.5) !== (rec.open < 0.5)) doorSolid(rec, rec.open < 0.5);
      }
    }
  }
  if (CBZ.onUpdate) CBZ.onUpdate(40.9, function (dt) { try { moversTick(dt || 0.016); } catch (e) { if (window.console) console.warn("[house lot movers]", e); } });
  HL.movers = function () { return RECS; };

  let _mat = null;
  function yardMat() {
    if (_mat) return _mat;
    _mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    _mat._shared = true;
    _mat.name = "house-lot";
    return _mat;
  }
  const _col = new THREE.Color();
  function lin(hex) { _col.setHex(hex >>> 0); return [_col.r, _col.g, _col.b]; }

  HL.dress = function (root, p) {
    if (!root || !p) return null;
    const ID = CBZ.islandDressing;
    if (!ID || !ID.build) return null;
    const y0 = p.y || 0;
    const nx = p.nx, nz = p.nz, tx = p.tx, tz = p.tz;
    const alongX = Math.abs(nz) > 0.5;                           // the street runs along x
    // (t, a) -> world. t along the street, a out toward it, both from the lot centre.
    const W = function (t, a) { return [p.cx + tx * t + nx * a, p.cz + tz * t + nz * a]; };
    const tier = p.tier === "poor" || p.tier === "rich" ? p.tier : "mid";
    const halfT = p.lotT / 2, halfA = p.lotA / 2;
    const hT0 = p.t - p.hw / 2, hT1 = p.t + p.hw / 2;           // the house along the street
    const hA1 = p.a + p.hd / 2, hA0 = p.a - p.hd / 2;           // its front face, its back
    const doorT = p.doorT != null ? p.doorT : p.t;
    const pal = p.pal || (CBZ.HOUSE_PARTS && CBZ.HOUSE_PARTS.palAt(p.x, p.z)) || { body: 0xb9ae98, trim: 0xe9e5da, roof: 0x4a4a48 };
    const hs = h01(p.cx, p.cz, 0x7d1);
    const driveHalf = p.driveHalf != null ? p.driveHalf : HL.DRIVE / 2;
    const dC = p.driveAt || 0;                                     // the drive's centre along the street
    const ownGarage = !!(p.ownGarage || pal.ownGarage);
    const G = p.garage && !ownGarage ? p.garage : null;

    // ---- THE ISLAND'S YARD KIT, laying at this lot's level -------------------------
    // (its clearance tests know this house and its garage, nothing else)
    const hA = W(hT0, hA0), hB = W(hT1, hA1);
    const own = [{ minX: Math.min(hA[0], hB[0]), maxX: Math.max(hA[0], hB[0]), minZ: Math.min(hA[1], hB[1]), maxZ: Math.max(hA[1], hB[1]), y0: y0 - 1, y1: y0 + 3 }];
    let K = null;
    try { K = ID.build({ kitOnly: true, root: root, cx: p.cx, cz: p.cz, R: Math.max(p.lotT, p.lotA), groundHeightAt: function () { return y0; }, colliders: own }); } catch (e) { K = null; }
    if (!K || !K.A) return null;
    const A = K.A, COL = K.COL;
    const c0 = K.out.colliders.length;
    // a box in the lot's frame
    const bx = function (acc, t0, t1, ya, yb, a0, a1, col, o) {
      if (t1 - t0 < 0.004 || yb - ya < 0.004 || a1 - a0 < 0.004) return;
      const c = W((t0 + t1) / 2, (a0 + a1) / 2);
      // (what stands on the ground has no underside anybody sees)
      if (ya <= y0 + 0.06 && !(o && o.drop)) { o = Object.assign({ drop: 8 }, o || {}); }
      K.box(acc, c[0], (ya + yb) / 2, c[1], alongX ? t1 - t0 : a1 - a0, yb - ya, alongX ? a1 - a0 : t1 - t0, 0, col, o || {});
    };
    // a thin board or wire standing in a fence's plane, from lot point p to q:
    // its two faces and no edges (12 mm end-on is nothing; a box is 36 vertices)
    const leaf2 = function (acc, pt, pa, qt, qa, ya, yb, col) {
      const P = W(pt, pa), Q = W(qt, qa);
      const a = new K.V3(P[0], ya, P[1]), b = new K.V3(Q[0], ya, Q[1]), c = new K.V3(Q[0], yb, Q[1]), d = new K.V3(P[0], yb, P[1]);
      K.quad(acc, a, b, c, d, col, {}); K.quad(acc, b, a, d, c, col, {});
    };
    const solid = function (t0, t1, ya, yb, a0, a1, tag) {
      const P = W(t0, a0), Q = W(t1, a1);
      return K.addCol(Math.min(P[0], Q[0]), Math.max(P[0], Q[0]), Math.min(P[1], Q[1]), Math.max(P[1], Q[1]), ya, yb, tag || "yard");
    };
    // a straight run of the island's fence along the street (constant a) or
    // back from it (constant t), with gaps given in the lot's frame
    const run = function (style, t0, a0, t1, a1, gaps, tone) {
      const P = W(t0, a0), Q = W(t1, a1);
      const axisX = Math.abs(Q[0] - P[0]) >= Math.abs(Q[1] - P[1]);
      const gs2 = (gaps || []).map(function (g) {
        const c = Math.abs(t1 - t0) >= Math.abs(a1 - a0) ? W(g.at, a0) : W(t0, g.at);
        return { at: axisX ? c[0] : c[1], w: g.w };
      });
      return K.drain(K.fenceRun(style, P[0], P[1], Q[0], Q[1], gs2, tone, { b: { x: p.x, z: p.z, w: p.w, d: p.d } }));
    };
    // a clipped hedge, bay by bay (the island's hedge bay; its run-layer reads a
    // hedge's own wide collider as something in the next bay's way and lays
    // every other one)
    const hedge = function (t0, a0, t1, a1, gaps) {
      const along = Math.abs(t1 - t0) >= Math.abs(a1 - a0);
      let segs = [[along ? Math.min(t0, t1) : Math.min(a0, a1), along ? Math.max(t0, t1) : Math.max(a0, a1)]];
      for (const g of (gaps || [])) { const nxt = []; for (const s of segs) { const a = g.at - g.w / 2, b = g.at + g.w / 2; if (b <= s[0] || a >= s[1]) { nxt.push(s); continue; } if (a - s[0] > 0.5) nxt.push([s[0], a]); if (s[1] - b > 0.5) nxt.push([b, s[1]]); } segs = nxt; }
      for (const s of segs) {
        const n = Math.max(1, Math.ceil((s[1] - s[0]) / 2.4));
        for (let i = 0; i < n; i++) {
          const u0 = s[0] + (s[1] - s[0]) * i / n, u1 = s[0] + (s[1] - s[0]) * (i + 1) / n;
          const P = along ? W(u0, a0) : W(t0, u0), Q = along ? W(u1, a0) : W(t0, u1);
          const n0 = K.out.colliders.length;
          K.fenceBay("hedge", P[0], P[1], Q[0], Q[1], null, null);
          // (the island's hedge collider is as long as the bush is round: 0.4 m
          // past each end, which beside a gate left a 0.7 m gap nobody fits)
          for (let q = n0; q < K.out.colliders.length; q++) {
            const c = K.out.colliders[q];
            if (Math.abs(Q[0] - P[0]) >= Math.abs(Q[1] - P[1])) { c.minX = Math.max(c.minX, Math.min(P[0], Q[0])); c.maxX = Math.min(c.maxX, Math.max(P[0], Q[0])); }
            else { c.minZ = Math.max(c.minZ, Math.min(P[1], Q[1])); c.maxZ = Math.min(c.maxZ, Math.max(P[1], Q[1])); }
          }
        }
      }
    };
    // chain link: galvanised posts, a top rail, the mesh as a few wires
    const chain = function (t0, a0, t1, a1, H) {
      const L = Math.hypot(t1 - t0, a1 - a0);
      if (L < 0.6) return;
      const n = Math.max(1, Math.ceil(L / 2.4));
      const P = function (k) { return W(t0 + (t1 - t0) * k, a0 + (a1 - a0) * k); };
      for (let i = 0; i <= n; i++) { const q = P(i / n); K.cylY(A.paint, q[0], y0 - 0.1, q[1], 0.028, 0.028, H + 0.15, 6, COL.galv, { ao: y0, open: true }); }
      const s = P(0), e = P(1);
      K.rod(A.paint, s[0], y0 + H, s[1], e[0], y0 + H, e[1], 0.02, 5, COL.galv, { open: true });
      const WIRE = K.shade(COL.galv, 0.8);
      for (const hh of [0.08, H * 0.35, H * 0.66]) leaf2(A.paint, t0, a0, t1, a1, y0 + hh - 0.007, y0 + hh + 0.007, WIRE);
      const m = Math.max(2, Math.round(L / 0.6)), ut = (t1 - t0) / L * 0.007, ua = (a1 - a0) / L * 0.007;
      for (let i = 1; i < m; i++) { const k = i / m, qt = t0 + (t1 - t0) * k, qa = a0 + (a1 - a0) * k; leaf2(A.paint, qt - ut, qa - ua, qt + ut, qa + ua, y0 + 0.05, y0 + H, WIRE); }
      const c = W(Math.min(t0, t1) - 0.04, Math.min(a0, a1) - 0.04), d = W(Math.max(t0, t1) + 0.04, Math.max(a0, a1) + 0.04);
      K.addCol(Math.min(c[0], d[0]), Math.max(c[0], d[0]), Math.min(c[1], d[1]), Math.max(c[1], d[1]), y0, y0 + H, "fence");
    };
    // a picket fence: posts, two rails, the pickets as leaves (the island's own
    // picket run is boxes all through: 4,000 vertices on a 20 m front)
    const picket = function (t0, a0, t1, a1, gaps) {
      const along = Math.abs(t1 - t0) >= Math.abs(a1 - a0);
      const fix = along ? a0 : t0;
      let segs = [[along ? Math.min(t0, t1) : Math.min(a0, a1), along ? Math.max(t0, t1) : Math.max(a0, a1)]];
      for (const g of (gaps || [])) {
        const nxt = [];
        for (const sg of segs) { const a = g.at - g.w / 2, b = g.at + g.w / 2; if (b <= sg[0] || a >= sg[1]) { nxt.push(sg); continue; } if (a - sg[0] > 0.5) nxt.push([sg[0], a]); if (sg[1] - b > 0.5) nxt.push([b, sg[1]]); }
        segs = nxt;
      }
      const WH = COL.paintWhite;
      const B2 = function (u0, u1, ya, yb, hw) { if (along) bx(A.wood, u0, u1, ya, yb, fix - hw, fix + hw, WH, {}); else bx(A.wood, fix - hw, fix + hw, ya, yb, u0, u1, WH, {}); };
      for (const sg of segs) {
        const L = sg[1] - sg[0], np = Math.max(1, Math.round(L / 2.4));
        for (let i = 0; i <= np; i++) { const u = sg[0] + L * i / np; B2(u - 0.045, u + 0.045, y0 - 0.1, y0 + 1.05, 0.045); }
        for (const ry of [0.24, 0.72]) B2(sg[0], sg[1], y0 + ry, y0 + ry + 0.07, 0.016);
        const n = Math.max(2, Math.round(L / 0.15));
        for (let i = 0; i < n; i++) {
          const u = sg[0] + L * (i + 0.5) / n;
          if (along) leaf2(A.wood, u - 0.037, fix + 0.02, u + 0.037, fix + 0.02, y0 + 0.07, y0 + 0.95, WH);
          else leaf2(A.wood, fix + 0.02, u - 0.037, fix + 0.02, u + 0.037, y0 + 0.07, y0 + 0.95, WH);
        }
        if (along) solid(sg[0], sg[1], y0, y0 + 0.95, fix - 0.06, fix + 0.06, "fence"); else solid(fix - 0.06, fix + 0.06, y0, y0 + 0.95, sg[0], sg[1], "fence");
      }
    };
    // a 1.8 m board fence (timber) or a rendered garden wall, back from the street or along it
    const tall = function (kind, t0, a0, t1, a1) {
      const along = Math.abs(t1 - t0) >= Math.abs(a1 - a0);
      const lo = along ? Math.min(t0, t1) : Math.min(a0, a1), hi = along ? Math.max(t0, t1) : Math.max(a0, a1);
      if (hi - lo < 0.5) return;
      const fix = along ? a0 : t0;
      const B2 = function (acc, u0, u1, ya, yb, hw, col, o) { if (along) bx(acc, u0, u1, ya, yb, fix - hw, fix + hw, col, o); else bx(acc, fix - hw, fix + hw, ya, yb, u0, u1, col, o); };
      if (kind === "wall") {
        const tone = COL.render[(h01(p.cx, p.cz, 0x7e1) * COL.render.length) | 0];
        B2(A.mason, lo, hi, y0 - 0.2, y0 + 1.85, 0.11, tone, { ao: y0, aoK: 0.35, aoH: 0.5 });
        B2(A.mason, lo - 0.02, hi + 0.02, y0 + 1.85, y0 + 1.92, 0.16, COL.capstone, {});
        for (let u = lo; u <= hi + 0.01; u += Math.max(2.4, (hi - lo) / Math.max(1, Math.round((hi - lo) / 3.2)))) B2(A.mason, u - 0.19, u + 0.19, y0 - 0.2, y0 + 2.0, 0.19, tone, { ao: y0 });
      } else {
        const col = K.vary(COL.timber, h01(p.cx, p.cz, 0x7dc), 0.2);
        const n = Math.max(1, Math.round((hi - lo) / 0.6));
        for (let i = 0; i < n; i++) {
          const u = lo + (hi - lo) * (i + 0.5) / n, hwB = (hi - lo) / n * 0.47, top = y0 + 1.8 - 0.03 * h01(u, fix, 0x7de), bc = K.vary(col, h01(u, fix, 0x7dd), 0.12);
          if (along) leaf2(A.wood, u - hwB, fix, u + hwB, fix, y0 + 0.04, top, bc); else leaf2(A.wood, fix, u - hwB, fix, u + hwB, y0 + 0.04, top, bc);
        }
        for (const ry of [0.35, 1.45]) B2(A.wood, lo, hi, y0 + ry, y0 + ry + 0.09, 0.045, K.shade(col, 0.85), {});
        for (let u = lo; u <= hi + 0.01; u += 2.4) B2(A.wood, u - 0.05, u + 0.05, y0 - 0.1, y0 + 1.86, 0.06, K.shade(col, 0.8), { ao: y0 });
      }
      if (along) solid(lo, hi, y0, y0 + 1.85, fix - 0.1, fix + 0.1, "fence"); else solid(fix - 0.1, fix + 0.1, y0, y0 + 1.85, lo, hi, "fence");
    };

    // ---- THE GARAGE WING, or (a poor street) a carport over the drive ---------------
    let garageRect = null, garageDoors = null, gateRec = null;
    let gFront = hA1;                                               // where the drive ends
    if (G) {
      const g0 = G.t - G.w / 2, g1 = G.t + G.w / 2;
      gFront = hA1 - 0.3;
      const gBack = gFront - G.d, gh = 2.9, wl = 0.16, dh = 2.18;
      const body = lin(pal.body), trim = lin(pal.trim), roofHex = pal.roof;
      const wallO = { ao: y0, aoK: 0.2, aoH: 0.6 };
      // A ROOM, not a block: a slab, three walls, a ceiling, and a front wall
      // with an opening for each door (the doors are instances that roll up)
      bx(A.mason, g0, g1, y0 - 0.25, y0 + 0.03, gBack, gFront, K.shade(COL.concrete, 0.9), {});
      bx(A.paint, g0, g1, y0, y0 + gh, gBack, gBack + wl, body, wallO);
      bx(A.paint, g0, g0 + wl, y0, y0 + gh, gBack + wl, gFront, body, wallO);
      bx(A.paint, g1 - wl, g1, y0, y0 + gh, gBack + wl, gFront, body, wallO);
      bx(A.paint, g0 + wl, g1 - wl, y0 + gh - 0.1, y0 + gh, gBack + wl, gFront - wl, K.shade(body, 0.8), {});
      bx(A.mason, g0 - 0.03, g1 + 0.03, y0 - 0.25, y0 + 0.2, gBack - 0.03, gBack + 0.02, lin(shadeHex(pal.body, 0.75)), {});
      const nD = G.w > 5 ? (h01(p.cx, p.cz, 0x7d2) < 0.5 ? 1 : 2) : 1;
      const dw = nD === 1 ? G.w - 0.9 : (G.w - 1.2) / 2;
      const dCol = lin(shadeHex(pal.trim, 0.97));
      const ops = [];
      for (let i = 0; i < nD; i++) { const c = nD === 1 ? G.t : G.t + (i ? 1 : -1) * (dw / 2 + 0.15); ops.push([c - dw / 2, c + dw / 2]); }
      let cur = g0 + wl;
      for (const op of ops.concat([[g1 - wl, g1 - wl]])) {
        if (op[0] - cur > 0.02) { bx(A.paint, cur, op[0], y0, y0 + gh - 0.1, gFront - wl, gFront, body, wallO); solid(cur, op[0], y0, y0 + gh, gFront - wl, gFront, "garage"); }
        cur = op[1];
      }
      garageDoors = [];
      for (const op of ops) {
        bx(A.paint, op[0], op[1], y0 + dh + 0.04, y0 + gh - 0.1, gFront - wl, gFront, body, {});       // over the door
        for (const e of [[op[0] - 0.12, op[0]], [op[1], op[1] + 0.12]]) bx(A.paint, e[0], e[1], y0, y0 + dh + 0.14, gFront, gFront + 0.05, trim, {});
        bx(A.paint, op[0] - 0.12, op[1] + 0.12, y0 + dh + 0.04, y0 + dh + 0.16, gFront, gFront + 0.05, trim, {});
        const c = W((op[0] + op[1]) / 2, gFront - 0.1);
        garageDoors.push({ x: c[0], z: c[1], y: y0 + 0.02, w: op[1] - op[0], h: dh + 0.02, col: dCol, inst: -1,
          solid: solid(op[0], op[1], y0, y0 + dh, gFront - 0.14, gFront - 0.04, "garage-door") });
      }
      // what a garage keeps: a shelf across the back with paint tins and boxes
      // on it, a workbench down one side of a double one
      {
        const TB = lin(0x6a5a44), s0 = g0 + wl + 0.25, s1 = g1 - wl - 0.25;
        bx(A.wood, s0, s1, y0 + 1.35, y0 + 1.39, gBack + wl, gBack + wl + 0.36, TB, {});
        bx(A.wood, s0, s1, y0 + 1.85, y0 + 1.89, gBack + wl, gBack + wl + 0.36, TB, {});
        const TIN = [[0.5, 0.12, 0.1], [0.12, 0.25, 0.42], [0.6, 0.55, 0.42], [0.2, 0.2, 0.2], [0.45, 0.32, 0.16]];
        const nt = Math.max(3, Math.round((s1 - s0) / 0.55));
        for (let i = 0; i < nt; i++) {
          const u = s0 + (s1 - s0) * (i + 0.5) / nt, hh = h01(u, gBack, 0x7f8), up = i & 1;
          bx(A.paint, u - 0.11 - hh * 0.08, u + 0.11 + hh * 0.08, y0 + (up ? 1.89 : 1.39), y0 + (up ? 1.89 : 1.39) + 0.18 + hh * 0.16, gBack + wl + 0.05, gBack + wl + 0.3, TIN[(hh * TIN.length) | 0], {});
        }
        if (G.w > 5) {
          const side = p.gs > 0 ? g1 - wl : g0 + wl, sg = p.gs > 0 ? -1 : 1;
          bx(A.wood, Math.min(side, side + sg * 0.6), Math.max(side, side + sg * 0.6), y0 + 0.86, y0 + 0.92, gBack + 1.2, gBack + 3.4, TB, {});
          bx(A.wood, Math.min(side, side + sg * 0.55), Math.max(side, side + sg * 0.55), y0, y0 + 0.86, gBack + 1.25, gBack + 3.35, K.shade(TB, 0.7), {});
          solid(Math.min(side, side + sg * 0.6), Math.max(side, side + sg * 0.6), y0, y0 + 0.92, gBack + 1.2, gBack + 3.4, "bench");
        }
      }
      // a coach lamp beside the door
      bx(A.paint, g1 + (p.gs > 0 ? -0.6 : 0.1), g1 + (p.gs > 0 ? -0.5 : 0.2), y0 + 1.7, y0 + 2.0, gFront, gFront + 0.06, COL.steelDark, {});
      // the roof: the house's own carpentry, a gable whose end faces the street
      const HP = CBZ.HOUSE_PARTS, F = CBZ.FACADE_F;
      if (HP && F && !pal.flat) {
        const gctx = {
          w: G.w, d: G.d, storeys: 1, FH: gh, rTop: gh, pp: 0, doorSide: 1, noDoor: true, ox: 0, oz: 0,
          hash: function (s) { return h01(p.cx, p.cz, s + 0x7d3); },
          lbox: function (x, y, z, w, h, d, col) {
            // garage-local: x along the street (t), z out toward it (a)
            bx(A.paint, G.t + x - w / 2, G.t + x + w / 2, y0 + y - h / 2, y0 + y + h / 2, (gFront + gBack) / 2 + z - d / 2, (gFront + gBack) / 2 + z + d / 2, lin(col), {});
          },
        };
        gctx.dbox = gctx.lbox;
        try {
          const H = HP.begin(gctx, F);
          H.roof({ kind: h01(p.cx, p.cz, 0x7d4) < 0.6 ? "gable" : "hip", axis: "z", base: gh, pitch: 0.55, step: 0.2, eave: 0.35, rake: 0.25,
            roof: roofHex, roof2: shadeHex(roofHex, 0.9), core: pal.body, coreProj: 0.05, soffit: pal.trim, fascia: pal.trim, ridge: shadeHex(roofHex, 0.8), rakeBoard: true, hipCaps: true });
        } catch (e) {}
      } else {
        // a flat roof: a fascia slab oversailing a little
        bx(A.paint, g0 - 0.3, g1 + 0.3, y0 + gh, y0 + gh + 0.3, gBack - 0.3, gFront + 0.3, lin(pal.flat ? pal.trim : pal.roof), {});
      }
      solid(g0, g1, y0, y0 + gh, gBack, gBack + wl, "garage");
      solid(g0, g0 + wl, y0, y0 + gh, gBack + wl, gFront, "garage");
      solid(g1 - wl, g1, y0, y0 + gh, gBack + wl, gFront, "garage");
      garageRect = (function () { const a = W(g0, gBack), b = W(g1, gFront); return { minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minZ: Math.min(a[1], b[1]), maxZ: Math.max(a[1], b[1]) }; })();
    } else if (!ownGarage && tier === "poor" && h01(p.cx, p.cz, 0x7e2) < 0.55 && Math.abs(dC) > 0.5) {
      // a carport: four posts and a tin roof over the head of the drive
      const c0t = dC - driveHalf + 0.1, c1t = dC + driveHalf - 0.1, ca0 = hA1 - 0.2, ca1 = hA1 + 4.4;
      for (const tt of [c0t, c1t]) for (const aa of [ca0 + 0.1, ca1 - 0.1]) { const q = W(tt, aa); K.cylY(A.paint, q[0], y0, q[1], 0.05, 0.05, 2.3, 6, COL.galv, { ao: y0 }); solid(tt - 0.06, tt + 0.06, y0, y0 + 2.3, aa - 0.06, aa + 0.06, "post"); }
      bx(A.paint, c0t - 0.25, c1t + 0.25, y0 + 2.3, y0 + 2.38, ca0 - 0.2, ca1 + 0.3, COL.roofTin, {});
      bx(A.paint, c0t - 0.25, c1t + 0.25, y0 + 2.2, y0 + 2.3, ca1 + 0.22, ca1 + 0.3, K.shade(COL.roofTin, 0.7), {});
    }

    // ---- THE DRIVE: a poured slab from the street to the garage door ----------------
    // (drawn 2 cm proud of the lot: the street kit's crossing meets it at the lot line)
    {
      const d0 = gFront + 0.02, d1 = halfA - 0.02;
      const n = Math.max(1, Math.round((d1 - d0) / 2.6));
      const base = tier === "poor" ? K.shade(COL.concrete, 0.82) : COL.concrete;
      for (let i = 0; i < n; i++) {
        const a = d0 + (d1 - d0) * i / n, b = d0 + (d1 - d0) * (i + 1) / n - 0.035;
        bx(A.mason, dC - driveHalf, dC + driveHalf, y0 - 0.05, y0 + 0.022, a, b, K.vary(base, h01(p.cx + i, p.cz, 0x7e3), 0.07), {});
      }
      if (tier === "poor") {
        // an oil stain, a crack line
        bx(A.asph, dC - 0.45, dC + 0.25, y0 + 0.022, y0 + 0.026, gFront + 1.5, gFront + 2.4, COL.asphalt, {});
        bx(A.asph, dC - driveHalf + 0.2, dC + driveHalf - 0.5, y0 + 0.022, y0 + 0.025, (d0 + d1) / 2, (d0 + d1) / 2 + 0.03, K.shade(COL.concrete, 0.45), {});
      }
    }

    // ---- THE FRONT WALK: door to the street, in poured bays (the island's path) ------
    const walkHits = Math.abs(doorT - dC) < driveHalf + 0.6;     // the door is on the drive: the drive is the walk
    if (!walkHits && halfA - hA1 > 1.0) {
      const P = W(doorT, hA1 + 0.45), Q = W(doorT, halfA - 0.05);
      K.pathSeg(P[0], P[1], Q[0], Q[1], tier === "rich" ? 1.5 : 1.2);
      // a leg along the house front to the drive, so the drive also reaches the door
      const dEdge = dC + Math.sign(doorT - dC) * (driveHalf - 0.05);
      if (h01(p.cx, p.cz, 0x7d6) < 0.6 && Math.abs(doorT - dEdge) > 1.2) { const R = W(doorT, hA1 + 1.0), S = W(dEdge, hA1 + 1.0); K.pathSeg(R[0], R[1], S[0], S[1], 1.0); }
      if (tier === "rich") {
        // low lanterns either side of the walk
        for (const aa of [hA1 + 1.4, (hA1 + halfA) / 2, halfA - 1.2]) for (const sd of [-1, 1]) {
          const q = W(doorT + sd * 1.0, aa);
          K.cylY(A.paint, q[0], y0, q[1], 0.035, 0.035, 0.55, 6, COL.steelDark, { ao: y0 });
          K.box(A.lens, q[0], y0 + 0.62, q[1], 0.12, 0.14, 0.12, 0, [0.9, 0.82, 0.6], {});
          K.box(A.paint, q[0], y0 + 0.7, q[1], 0.16, 0.03, 0.16, 0, COL.steelDark, {});
        }
      }
    }

    // ---- UNDER THE WINDOWS: a planted bed along the house front ----------------------
    {
      const bands = [[hT0 + 0.3, doorT - 1.25], [doorT + 1.25, hT1 - 0.3]];
      let bi = 0;
      for (const bd of bands) {
        bi++;
        let lo = bd[0], hi = bd[1];
        // keep off the drive
        if (hi > dC - driveHalf - 0.2 && lo < dC + driveHalf + 0.2) { if (dC > (lo + hi) / 2) hi = Math.min(hi, dC - driveHalf - 0.2); else lo = Math.max(lo, dC + driveHalf + 0.2); }
        if (hi - lo < 0.9) continue;
        const c = W((lo + hi) / 2, hA1 + 0.62);
        if (tier === "poor") {
          // what grows by itself: a few weeds against the wall
          K.drain(K.shrubs(c[0], c[1], alongX ? (hi - lo) * 0.6 : 0.4, alongX ? 0.4 : (hi - lo) * 0.6, Math.max(1, Math.round((hi - lo) / 2.6)), 0x7d8 + bi, y0, false));
          continue;
        }
        bx(A.soil, lo, hi, y0 - 0.02, y0 + 0.045, hA1 + 0.16, hA1 + 1.12, COL.mulch, {});
        K.drain(K.shrubs(c[0], c[1], alongX ? (hi - lo) * 0.68 : 0.55, alongX ? 0.55 : (hi - lo) * 0.68, Math.max(2, Math.round((hi - lo) / (tier === "rich" ? 0.75 : 1.0))), 0x7d8 + bi, y0 + 0.03, true));
        if (tier === "rich") for (const tt of [lo + 0.45, hi - 0.45]) { const q = W(tt, hA1 + 0.62); K.blob(A.plant, q[0], y0 + 0.5, q[1], 0.42, 0.5, 0.42, K.shade(COL.hedge, 1.1), 7 + bi, { ao: y0, aoK: 0.5, aoH: 0.7 }); }
      }
    }

    // ---- THE STREET LINE: a fence with a gate on the walk, a gap for the drive ---------
    const style = p.style || (tier === "poor" ? (hs < 0.55 ? "chain" : "open")
      : tier === "rich" ? (hs < 0.6 ? "wall" : "hedge")
      : (hs < 0.5 ? "picket" : hs < 0.8 ? "hedge" : "open"));
    const fa = halfA - 0.35;                                      // just inside the lot line
    const gateW = tier === "rich" ? 1.5 : 1.1;
    const gaps = [{ at: dC, w: 2 * driveHalf + 0.5 }];
    if (!walkHits) gaps.push({ at: doorT, w: gateW });
    const tone = COL.render[(h01(p.cx, p.cz, 0x7e1) * COL.render.length) | 0];
    if (style === "chain") {
      // the runs between the gaps
      let segs = [[-halfT + 0.3, halfT - 0.3]];
      for (const g of gaps) { const nxt = []; for (const s of segs) { const a = g.at - g.w / 2, b = g.at + g.w / 2; if (b <= s[0] || a >= s[1]) { nxt.push(s); continue; } if (a - s[0] > 0.5) nxt.push([s[0], a]); if (s[1] - b > 0.5) nxt.push([b, s[1]]); } segs = nxt; }
      for (const s of segs) chain(s[0], fa, s[1], fa, 1.2);
    } else if (style === "hedge") {
      hedge(-halfT + 0.3, fa, halfT - 0.3, fa, gaps);
    } else if (style === "picket") {
      picket(-halfT + 0.3, fa, halfT - 0.3, fa, gaps);
    } else if (style !== "open") {
      run(style, -halfT + 0.3, fa, halfT - 0.3, fa, gaps, tone);
    }
    // THE GATE on the walk: its posts, and the leaf standing open into the yard
    if (style !== "open" && !walkHits) {
      const gp = W(doorT, fa);
      if (style === "picket" || style === "wall") K.gatePosts(style, gp[0], gp[1], alongX, gateW, tone);
      else for (const sd of [-1, 1]) { const q = W(doorT + sd * (gateW / 2 + 0.06), fa); K.cylY(A.paint, q[0], y0 - 0.1, q[1], 0.04, 0.04, style === "chain" ? 1.4 : 1.25, 8, style === "chain" ? COL.galv : COL.steelDark, { ao: y0 }); }
      // the leaves swing (they are instances, city/house_yard.js's movers): one
      // hinged on a post, or a pair meeting in the middle of a rich walk
      const leaves = tier === "rich" ? [[-1, gateW / 2], [1, gateW / 2]] : [[-1, gateW - 0.06]];
      const gk = style === "picket" ? "picket" : style === "chain" ? "chain" : "iron";
      gateRec = { x: gp[0], z: gp[1], y: y0, nx: nx, nz: nz, tx: tx, tz: tz, half: gateW / 2, kind: gk, leaves: [], ang: 0, want: 0, hold: false,
        col: gk === "picket" ? COL.paintWhite : gk === "chain" ? COL.galv : COL.steelDark };
      for (const lf of leaves) {
        const h = W(doorT + lf[0] * (gateW / 2 - 0.02), fa);
        gateRec.leaves.push({ hx: h[0], hz: h[1], dir: -lf[0], L: lf[1] - 0.04, inst: -1 });
      }
    }
    // A POOR STREET WITH NO FENCE IS STILL SOMEBODY'S YARD: what is left of an
    // old fence, weeds on the line, earth worn bare, things left out the front
    if (style === "open" && tier === "poor") {
      const TW = K.shade(COL.timberGrey, 1.3);
      const side = dC > 0 ? -1 : 1;                               // the side away from the drive
      const f0 = side > 0 ? Math.max(doorT + 1.2, dC + driveHalf + 0.6) : -halfT + 0.4;
      const f1 = side > 0 ? halfT - 0.4 : Math.min(doorT - 1.2, dC - driveHalf - 0.6);
      if (f1 - f0 > 2.4) {
        // the old fence: some posts still standing, a rail hanging off them
        const n = Math.max(2, Math.round((f1 - f0) / 2.2));
        for (let i = 0; i <= n; i++) {
          if (h01(p.cx + i, p.cz, 0x801) < 0.25) continue;       // rotted out
          const u = f0 + (f1 - f0) * i / n, lean = (h01(p.cx, p.cz + i, 0x802) - 0.5) * 0.3;
          const a0 = W(u, fa), a1 = W(u + lean, fa - lean * 0.6);
          K.beam(A.wood, a0[0], y0 - 0.1, a0[1], a1[0], y0 + 0.85, a1[1], 0.045, 0.045, TW, {});
        }
        const r0 = W(f0, fa), r1 = W(f0 + (f1 - f0) * 0.6, fa);
        K.beam(A.wood, r0[0], y0 + 0.62, r0[1], r1[0], y0 + 0.5, r1[1], 0.035, 0.012, TW, {});
      }
      // weeds along the street line
      for (const e of [[-halfT * 0.55, halfT * 0.7], [halfT * 0.5, halfT * 0.6]]) {
        if (Math.abs(e[0] - dC) < driveHalf + 0.8 || Math.abs(e[0] - doorT) < 1.0) continue;
        const c = W(e[0], fa - 0.25);
        K.drain(K.shrubs(c[0], c[1], alongX ? e[1] : 0.55, alongX ? 0.55 : e[1], 3, 0x803 + (e[0] > 0 ? 1 : 0), y0, false));
      }
      // bare earth where feet and tyres go
      const ya = (hA1 + fa) / 2;
      bx(A.soil, doorT + side * 1.4 - 1.3, doorT + side * 1.4 + 1.3, y0 - 0.02, y0 + 0.012, ya - 0.9, ya + 0.8, COL.soil, {});
      bx(A.soil, dC - driveHalf - 0.5, dC + driveHalf + 0.5, y0 - 0.02, y0 + 0.01, hA1 + 0.2, hA1 + 1.4, K.shade(COL.soil, 1.15), {});
      // what lives in the front yard: an old sofa against the house, a tyre in the grass
      const st2 = doorT + side * Math.min(2.8, Math.max(1.9, (hT1 - hT0) / 2 - 1.6)), sa = hA1 + 0.62;
      if (Math.abs(st2 - dC) > driveHalf + 1.2 && Math.abs(st2) < halfT - 1.2 && fa - hA1 > 2.2) {
        const SF = [[0.33, 0.2, 0.16], [0.2, 0.25, 0.2], [0.35, 0.32, 0.3]][(hs * 3) | 0];
        bx(A.paint, st2 - 0.9, st2 + 0.9, y0 + 0.02, y0 + 0.42, sa - 0.4, sa + 0.4, SF, { ao: y0 });
        bx(A.paint, st2 - 0.9, st2 + 0.9, y0 + 0.42, y0 + 0.82, sa - 0.4, sa - 0.2, K.shade(SF, 0.9), {});
        for (const e of [-1, 1]) bx(A.paint, st2 + e * 0.9 - 0.1, st2 + e * 0.9 + 0.1, y0 + 0.02, y0 + 0.6, sa - 0.4, sa + 0.4, K.shade(SF, 0.85), {});
        solid(st2 - 1.0, st2 + 1.0, y0, y0 + 0.8, sa - 0.4, sa + 0.4, "sofa");
      }
      if (Math.abs(doorT - side * 2.4 - dC) > driveHalf + 0.6 && Math.abs(doorT - side * 2.4) < halfT - 0.6) {
        const ty = W(doorT - side * 2.4, ya + 0.6);
        K.cylY(A.paint, ty[0], y0, ty[1], 0.3, 0.3, 0.2, 10, [0.03, 0.03, 0.035], {});
      }
    }
    // the front yard's side line on the far side from the drive, low, in the street's style
    if (style === "picket" || style === "hedge" || style === "wall") {
      const st = -Math.sign(dC || p.gs) * (halfT - 0.3);
      if (hA1 + 0.4 < fa - 0.5) { if (style === "hedge") hedge(st, hA1 + 0.4, st, fa - 0.45, null); else if (style === "picket") picket(st, hA1 + 0.4, st, fa, null); else run(style, st, hA1 + 0.4, st, fa, null, tone); }
    }

    // ---- THE BACK YARD -----------------------------------------------------------------
    // (each shared line is drawn by one lot: the +t side here, the back line
    // only on lots facing +x / +z, so two neighbours never stack two fences;
    // a line nobody shares, a corner lot's street side or the back of a lot
    // with nothing behind it, is this lot's own: p.open says which, else the
    // arena's lots are asked who stands across it)
    const alone = function (side) {                               // "lo" | "back"
      if (p.open) return !!p.open[side];
      const A = CBZ.city && CBZ.city.arena, L = A && A.lots;
      if (!L || !p.lot) return false;
      for (let i = 0; i < L.length; i++) {
        const o = L[i];
        if (!o || o === p.lot || o.demolished) continue;
        const dx = o.cx - p.cx, dz = o.cz - p.cz;
        if (Math.abs(dx) > 60 || Math.abs(dz) > 60) continue;
        const dt = dx * tx + dz * tz, da = dx * nx + dz * nz;
        const pw = o.parcel ? o.parcel.w : (o.w || 0) + 3, pd = o.parcel ? o.parcel.d : (o.d || 0) + 3;
        const hT = (alongX ? pw : pd) / 2, hA = (alongX ? pd : pw) / 2;
        if (side === "lo" && Math.abs(da) < halfA && Math.abs(-dt - halfT - hT) < 2.5) return false;
        if (side === "back" && Math.abs(dt) < halfT && Math.abs(-da - halfA - hA) < 2.5) return false;
      }
      return true;
    };
    const backKind = tier === "poor" ? (h01(p.cx, p.cz, 0x7db) < 0.6 ? "chain" : "none") : tier === "rich" ? "wall" : "board";
    const sideT = halfT - 0.05, backA = -halfA + 0.05;
    const yardA = hA0 + Math.min(1.0, p.hd * 0.2);                // the returns to the house's back corners
    const nearA = G ? Math.min(yardA, gFront - G.d - 0.15) : yardA;
    if (backKind !== "none") {
      const line = function (t0, a0, t1, a1) { if (backKind === "chain") chain(t0, a0, t1, a1, 1.5); else tall(backKind, t0, a0, t1, a1); };
      // the returns: from each back corner of the house (or the garage) out to the side line
      const loEdge = G && G.t < p.t ? G.t - G.w / 2 : hT0, hiEdge = G && G.t > p.t ? G.t + G.w / 2 : hT1;
      const loA = G && G.t < p.t ? nearA : yardA, hiA = G && G.t > p.t ? nearA : yardA;
      // (a side gate's width left open in the return on the side away from the drive)
      const gateSide = dC > 0 ? -1 : 1;
      if (sideT - hiEdge > 0.6) { if (gateSide > 0 && sideT - hiEdge > 1.8) line(hiEdge + 1.05, hiA, sideT, hiA); else line(hiEdge + 0.05, hiA, sideT, hiA); }
      if (loEdge + sideT > 0.6) { if (gateSide < 0 && loEdge + sideT > 1.8) line(-sideT, loA, loEdge - 1.05, loA); else line(-sideT, loA, loEdge - 0.05, loA); }
      line(sideT, backA, sideT, hiA);
      if (alone("lo")) line(-sideT, backA, -sideT, loA);
      if (nx + nz > 0 || alone("back")) line(-sideT + 0.05, backA, sideT - 0.05, backA);
    }
    // what is in it
    {
      const yd0 = backA + 0.5, yd1 = hA0 - 0.4, depth = yd1 - yd0;
      const mid = p.t;
      if (depth >= 2.2 && tier !== "poor") {
        // a patio behind the house: pavers, a table and chairs
        const pw = Math.min(4.2, p.hw - 1.5), pd = Math.min(3.0, depth - 0.4);
        const n = Math.max(2, Math.round(pw / 0.9)), m = Math.max(2, Math.round(pd / 0.9));
        for (let i = 0; i < n; i++) for (let j = 0; j < m; j++)
          bx(A.mason, mid - pw / 2 + pw * i / n + 0.01, mid - pw / 2 + pw * (i + 1) / n - 0.01, y0 - 0.04, y0 + 0.03, yd1 - pd * (j + 1) / m + 0.01, yd1 - pd * j / m - 0.01, K.vary(COL.pavers, h01(p.cx + i, p.cz + j, 0x7f1), 0.1), {});
        if (pd >= 1.9) {
          const ta = yd1 - pd / 2, tt = mid - pw * 0.18;
          const TB = lin(0x5a4632);
          bx(A.wood, tt - 0.6, tt + 0.6, y0 + 0.7, y0 + 0.75, ta - 0.4, ta + 0.4, TB, {});
          for (const e of [-1, 1]) for (const f of [-1, 1]) bx(A.wood, tt + e * 0.52 - 0.03, tt + e * 0.52 + 0.03, y0 + 0.03, y0 + 0.7, ta + f * 0.32 - 0.03, ta + f * 0.32 + 0.03, TB, { ao: y0 });
          for (const e of [-1, 1]) { bx(A.wood, tt + e * 0.95 - 0.22, tt + e * 0.95 + 0.22, y0 + 0.4, y0 + 0.45, ta - 0.22, ta + 0.22, TB, {}); bx(A.wood, tt + e * 1.15 - 0.03, tt + e * 1.15 + 0.03, y0 + 0.03, y0 + 0.9, ta - 0.22, ta + 0.22, TB, { ao: y0 }); for (const f of [-1, 1]) bx(A.wood, tt + e * 0.77 - 0.025, tt + e * 0.77 + 0.025, y0 + 0.03, y0 + 0.4, ta + f * 0.19 - 0.025, ta + f * 0.19 + 0.025, TB, {}); }
          solid(tt - 0.6, tt + 0.6, y0, y0 + 0.75, ta - 0.4, ta + 0.4, "table");
          // a kettle barbecue at the patio's end
          const q = W(mid + pw * 0.34, yd1 - 0.6);
          K.cylY(A.paint, q[0], y0 + 0.55, q[1], 0.26, 0.3, 0.2, 10, COL.steelDark, {});
          K.cylY(A.paint, q[0], y0 + 0.75, q[1], 0.3, 0.12, 0.16, 10, COL.steelDark, {});
          for (const e of [[-0.18, -0.12], [0.18, -0.12], [0, 0.2]]) K.cylY(A.paint, q[0] + e[0], y0, q[1] + e[1], 0.015, 0.015, 0.56, 5, COL.galv, {});
          K.addCol(q[0] - 0.3, q[0] + 0.3, q[1] - 0.3, q[1] + 0.3, y0, y0 + 0.9, "bbq");
        }
      }
      if (tier === "rich" && depth >= 5.2 && p.lotT >= 20) {
        // a pool along the back: stone coping, the water a hand below it
        const pl = Math.min(8, p.lotT - 9), pwd = Math.min(3.6, depth - 3.6), pc = mid * 0.4, pa = yd0 + 0.9 + pwd / 2;
        bx(A.mason, pc - pl / 2 - 0.35, pc + pl / 2 + 0.35, y0 - 0.1, y0 + 0.06, pa - pwd / 2 - 0.35, pa + pwd / 2 + 0.35, COL.capstone, {});
        bx(A.paint, pc - pl / 2, pc + pl / 2, y0 + 0.02, y0 + 0.064, pa - pwd / 2, pa + pwd / 2, [0.05, 0.3, 0.42], {});
        bx(A.paint, pc - pl / 2 + 0.25, pc + pl / 2 - 0.25, y0 + 0.064, y0 + 0.066, pa - pwd / 2 + 0.25, pa + pwd / 2 - 0.25, [0.08, 0.4, 0.52], {});
        // two loungers on the house side
        for (const e of [-1, 1]) { const lt = pc + e * 1.1, la = pa + pwd / 2 + 1.05; bx(A.wood, lt - 0.32, lt + 0.32, y0 + 0.24, y0 + 0.3, la - 0.9, la + 0.9, COL.paintWhite, {}); bx(A.wood, lt - 0.32, lt + 0.32, y0 + 0.3, y0 + 0.36, la + 0.45, la + 0.9, COL.paintCream, {}); for (const f of [-0.7, 0.7]) bx(A.wood, lt - 0.3, lt + 0.3, y0 + 0.02, y0 + 0.24, la + f - 0.03, la + f + 0.03, COL.paintWhite, {}); solid(lt - 0.32, lt + 0.32, y0, y0 + 0.36, la - 0.9, la + 0.9, "lounger"); }
      } else if (tier === "rich" && depth >= 2.6) {
        // a clipped hedge along the back wall
        if (yd0 + 0.5 < yd1 - 2.6) hedge(-sideT + 0.6, yd0 + 0.45, sideT - 0.6, yd0 + 0.45, null);
      }
      if (tier !== "rich" && depth >= 2.0) {
        // a washing line: two posts and the lines between them, shirts on it
        const wa = yd0 + Math.min(0.9, depth * 0.35), w0 = -halfT + 1.6, w1 = Math.min(-halfT + 6.4, hT0 + 3);
        if (w1 - w0 > 2.2) {
          const P = W(w0, wa), Q = W(w1, wa);
          for (const q of [P, Q]) { K.cylY(A.paint, q[0], y0 - 0.1, q[1], 0.03, 0.03, 1.95, 6, COL.galv, { ao: y0 }); K.addCol(q[0] - 0.05, q[0] + 0.05, q[1] - 0.05, q[1] + 0.05, y0, y0 + 1.85, "post"); }
          for (const off of [-0.18, 0.18]) { const o2 = W(0, off), z0 = W(0, 0); K.rod(A.paint, P[0] + o2[0] - z0[0], y0 + 1.8, P[1] + o2[1] - z0[1], Q[0] + o2[0] - z0[0], y0 + 1.8, Q[1] + o2[1] - z0[1], 0.006, 4, [0.6, 0.6, 0.58], {}); }
          const CL = [[0.5, 0.5, 0.48], [0.1, 0.2, 0.42], [0.45, 0.08, 0.08], [0.55, 0.5, 0.2]];
          for (let i = 0; i < 4; i++) { const u = w0 + (w1 - w0) * (0.16 + i * 0.22); bx(A.paint, u - 0.26, u + 0.26, y0 + 1.15 + (i & 1) * 0.12, y0 + 1.8, wa - 0.185, wa - 0.175, CL[(i + ((hs * 4) | 0)) % 4], {}); }
        }
      }
      if (tier === "mid" && depth >= 2.4 && h01(p.cx, p.cz, 0x7f2) < 0.7) {
        // a shed in the back corner on the drive's side
        const sd = dC > 0 ? 1 : -1, s0 = sd * (halfT - 2.6), sa = yd0 + 0.9;
        const SW = lin(0x6a5a44);
        bx(A.wood, s0 - 0.95, s0 + 0.95, y0, y0 + 1.9, sa - 0.75, sa + 0.75, SW, { ao: y0, aoK: 0.3 });
        bx(A.paint, s0 - 1.1, s0 + 1.1, y0 + 1.9, y0 + 2.0, sa - 0.9, sa + 0.9, COL.roofTin, {});
        bx(A.wood, s0 - 0.35, s0 + 0.35, y0 + 0.05, y0 + 1.7, sa + 0.75, sa + 0.78, K.shade(SW, 0.8), {});
        solid(s0 - 0.95, s0 + 0.95, y0, y0 + 2.0, sa - 0.75, sa + 0.75, "shed");
      }
      if (tier === "poor" && depth >= 1.6) {
        // what got left out the back: a stack of tyres, a rusted drum, a pallet
        const jt = (dC > 0 ? -1 : 1) * (halfT - 2.2), ja = yd0 + 0.8;
        const q = W(jt, ja);
        for (let i = 0; i < 3; i++) K.cylY(A.paint, q[0] + (i === 2 ? 0.5 : 0), y0 + (i === 2 ? 0 : i * 0.2), q[1] + (i === 2 ? 0.3 : 0), 0.3, 0.3, 0.2, 10, [0.03, 0.03, 0.035], {});
        const r = W(jt + 1.3, ja + 0.2);
        K.cylY(A.paint, r[0], y0, r[1], 0.29, 0.29, 0.86, 10, [0.3, 0.13, 0.06], { ao: y0 });
        bx(A.wood, jt - 1.7, jt - 0.7, y0, y0 + 0.14, ja - 0.4, ja + 0.4, K.shade(COL.timberGrey, 1.4), {});
        K.addCol(q[0] - 0.35, q[0] + 0.35, q[1] - 0.35, q[1] + 0.35, y0, y0 + 0.4, "junk");
        K.addCol(r[0] - 0.3, r[0] + 0.3, r[1] - 0.3, r[1] + 0.3, y0, y0 + 0.86, "junk");
        // bare earth where the grass gave up
        bx(A.soil, jt - 2.2, jt + 2.0, y0 - 0.02, y0 + 0.012, ja - 0.9, ja + 1.0, COL.soil, {});
      }
    }

    // ---- THE MAILBOX at the kerb beside the drive, the bin in the side yard -----------
    {
      let mt = dC - p.gs * (driveHalf + 0.55);
      if (Math.abs(mt) > halfT - 0.4) mt = dC + p.gs * (driveHalf + 0.55);
      const q = W(mt, halfA - 0.25);
      K.mailbox(q[0], q[1], Math.atan2(nx, nz));
      K.addCol(q[0] - 0.14, q[0] + 0.14, q[1] - 0.14, q[1] + 0.14, y0, y0 + 1.25, "mailbox");
      // the wheelie bin: against the house's side wall, on the drive's side
      const bt = dC > p.t ? hT1 + 0.5 : hT0 - 0.5;
      if (Math.abs(bt) < halfT - 0.6 && !(G && Math.abs(bt - G.t) < G.w / 2 + 0.4)) { const r = W(bt, hA1 - 1.3); K.wheelieBin(r[0], r[1], Math.atan2(tx, tz) * (bt > p.t ? 1 : -1), 0x7e5); }
      else { const r = W(dC + Math.sign(dC - p.t || 1) * (driveHalf + 0.5), gFront + 0.5); if (Math.abs(dC + Math.sign(dC - p.t || 1) * (driveHalf + 0.5)) < halfT - 0.5) K.wheelieBin(r[0], r[1], 0, 0x7e5); }
    }

    // ---- WHERE A CAR STANDS ON THIS LOT (city/realestate.js keeps the owner's there) ----
    // on the drive, its nose to the garage door (or to the house, on a lot with none)
    const standA = Math.min(gFront + 3.1, halfA - 2.5 > gFront + 2.2 ? halfA - 2.5 : gFront + 3.1);
    const heading = Math.atan2(-nx, -nz);
    const stands = [];
    if (driveHalf > 2.4) for (const e of [-1, 1]) { const q = W(dC + e * 1.35, standA); stands.push({ x: q[0], z: q[1], heading: heading }); }
    else { const q = W(dC, standA); stands.push({ x: q[0], z: q[1], heading: heading }); const q2 = W(dC, standA + 5.4); if (standA + 7.4 < halfA) stands.push({ x: q2[0], z: q2[1], heading: heading }); }
    const b = p.lot && p.lot.building;
    if (b && (!b.garage || b.garage.approach || b.garage.house)) b.garage = { x: stands[0].x, z: stands[0].z, heading: heading, stands: stands, spots: [], house: true };

    // ---- ONE MESH ------------------------------------------------------------------------
    let nv = 0;
    for (const k in A) nv += A[k].p.length;
    const cols = K.out.colliders.slice(c0);
    if (!nv) return { mesh: null, colliders: cols, garageRect: garageRect, stand: stands[0] };
    let rec = null;
    const P = new Float32Array(nv), N = new Float32Array(nv), C = new Float32Array(nv);
    let o = 0;
    for (const k in A) { const a = A[k]; P.set(a.p, o); N.set(a.n, o); C.set(a.c, o); o += a.p.length; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(P, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(C, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, yardMat());
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    mesh.name = "house-lot";
    root.add(mesh);
    for (const c of cols) if (c.dressing !== "fence") c.ref = mesh;
    // what moves here: the gate's leaves, the garage doors, a resident's car
    rec = { seq: ++RSEQ, mesh: mesh, lot: p.lot || null, cx: p.cx, cz: p.cz, y0: y0, tier: tier, nx: nx, nz: nz,
      gate: gateRec, doors: garageDoors, open: 0, want: 0, forced: false, on: false,
      stand: stands[0] || null, car: null, carDone: false };
    if (garageDoors) { const a = W(G.t, gFront + 0.6); rec.gx = a[0]; rec.gz = a[1]; }
    RECS.push(rec);
    return { mesh: mesh, colliders: cols, garageRect: garageRect, stand: stands[0], rec: rec };
  };

  CBZ.houseLot = HL;
})();

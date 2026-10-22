/* ============================================================
   world/island_lodging.js — A BED FOR THE NIGHT ON THE ISLES.

   Owner, 2026-10-22: "I like hotels to have a bed for the night, motels to
   have a cheap bed for the night, which means all beds need to be able to go
   up, and there needs to be an interaction option when you get up to bed so
   you can actually sleep for the night."

   EVERY BED. world/disaster_arena.js keeps every bed its houses and towers
   furnish (in the world, through the building's turn) and registers them
   with city/propuse.js when an island joins the world, so they are the same
   records Gang City's beds are: CBZ.moves walks you in and lays you down on
   the mattress. This file is the isles' verbs on them:
     at a bed        [E] Lie down    (CBZ.propSleep, lieOnly: just get in)
     in the bed      [I] Sleep       the decision: a fade, the clock to the
                                     morning (CBZ.propRestNight -> advanceClock),
                                     the rest it buys
                     [E] Get up      (systems/seat_exit.js's verb, shown here)
   Not every bed is yours. Somebody's bed is somebody's house: a person who
   can SEE you there (CBZ.brain.perception, lit by the night's own dark) runs
   the demand ladder's "trespass" case on you (CBZ.brain.demand: "You lost?"
   ... "Get out. Now." ... a shove), and you do not get to sleep through it.
   An empty house at 3am costs nothing. A rough night in a stranger's bed
   patches you part way (propuse's restPayoff); a room that is yours tonight
   heals you all the way and is where you wake up after a death.

   HOTELS AND MOTELS. An island building whose use is "hotel" or "motel"
   (lot.use from world/island_plan.js, published as b.use; the helipad
   tower, kind "hotel", is a hotel either way) gets, fitted by this file:
     - a front desk in its ground floor, where its clerk stands: a real
       person of the island (a survivor bot from entities/survivorbot.js)
       posted behind the counter, stood there only where nobody is looking;
     - [E] Rent $N on the desk while he is at it (hotel $120..250 a night by
       island, motel $40): the room is yours until noon tomorrow (at least
       six hours out), its door opens for you and nobody else;
     - the room: a hotel's is a real guest room built on an upper floor of
       the tower (the floors above the second are fitted and empty): two
       partition walls with a door that opens on your key, a queen bed,
       nightstands with lamps, a TV on its cabinet, a bathroom with its door
       open. A motel's room is the building's own bedroom, upstairs.
   If world/island_venue.js's CBZ.islandVenue.on(use, fn) is up the fit-out
   rides it; either way this file also finds the venues on the islands in
   the world itself, once each, and takes everything back when one leaves.

   API: CBZ.islandLodging = { rooms(), rental(), wakeSpot(arena), rent(room),
        fit(b, arena), state() }   and the prompt verbs CBZ.islandBedLie,
        CBZ.islandBedSleep, CBZ.islandLodgeRent, CBZ.islandLodgeDoor.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const MODE = "archipelago";

  const FH = (CBZ.islandBuilding && CBZ.islandBuilding.FH) || 3.4;
  const PRICE = { hotel: [120, 250], motel: [40, 40] };
  const NOON = 0.25;                   // dayPhase of noon (core/daynight.js: sunrise is 0)
  const BED_REACH = 1.9, DESK_REACH = 2.1, DOOR_REACH = 1.5;
  const SEE = { range: 14 };           // who can see you in a bed

  const S = {
    rooms: [],                 // every fitted venue
    fitted: new WeakSet(),     // buildings already fitted
    rent: null,                // { room, until (CBZ.dayTime), wake }
    sleeping: false,
    tres: null,                // a trespass case in progress
    scanT: 0,
  };

  function live() { return !!(g && g.mode === MODE && g.state === "playing"); }
  function dayNow() { return CBZ.dayTime ? CBZ.dayTime() : 0; }
  function h01(x, z, s) { return CBZ.hash01 ? CBZ.hash01(x, z, s) : (Math.abs(Math.sin(x * 12.99 + z * 78.23 + s) * 43758.5) % 1); }
  function useOf(b) { return b ? (b.use || (b.lot && b.lot.use) || (b.kind === "hotel" ? "hotel" : null)) : null; }
  function playerActor() { return (CBZ.surv && CBZ.surv.playerActor) || CBZ.player; }

  /* ---- A BUILDING'S OWN FRAME (a quarter turn at a time) ---------------- */
  function frame(b) {
    const yaw = b.rotY || 0;
    return { ox: b.ox, oz: b.oz, gy: b.gy, co: Math.round(Math.cos(yaw)), si: Math.round(Math.sin(yaw)) };
  }
  function toW(F, lx, lz, out) { out = out || {}; out.x = F.ox + lx * F.co + lz * F.si; out.z = F.oz - lx * F.si + lz * F.co; return out; }
  function rectW(F, x0, x1, z0, z1) {
    const a = toW(F, x0, z0), b = toW(F, x1, z1);
    return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
  }
  // a local direction (dx, dz) as a world yaw (bodies look along (sin, cos))
  function yawW(F, dx, dz) { const wx = dx * F.co + dz * F.si, wz = -dx * F.si + dz * F.co; return Math.atan2(wx, wz); }

  /* ---- A MERGED KIT OF BOXES (one draw for the solid, one for the glow) - */
  function Kit() { this.p = []; this.n = []; this.c = []; this.i = []; }
  const FACES = [
    [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1], [1, 0, 0]],
    [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1], [-1, 0, 0]],
    [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1], [0, 1, 0]],
    [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1], [0, -1, 0]],
    [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1], [0, 0, 1]],
    [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1], [0, 0, -1]],
  ];
  Kit.prototype.box = function (cx, cy, cz, w, h, d, hex) {
    if (!(w > 0.001 && h > 0.001 && d > 0.001)) return;
    const r = ((hex >> 16) & 255) / 255, gg = ((hex >> 8) & 255) / 255, bb = (hex & 255) / 255;
    for (const f of FACES) {
      const base = this.p.length / 3;
      for (let k = 0; k < 4; k++) {
        const v = f[k];
        this.p.push(cx + v[0] * w / 2, cy + v[1] * h / 2, cz + v[2] * d / 2);
        this.n.push(f[4][0], f[4][1], f[4][2]);
        this.c.push(r, gg, bb);
      }
      this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };
  Kit.prototype.mesh = function (glow, name) {
    if (!this.i.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    geo.setIndex(this.i);
    geo.computeBoundingSphere();
    const mat = glow ? new THREE.MeshBasicMaterial({ vertexColors: true }) : new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.name = name;
    if (CBZ.islandRoomLight) CBZ.islandRoomLight(mat, !!glow);
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = !glow; m.receiveShadow = !glow;
    m.userData.cbzInterior = true;
    return m;
  };

  /* ---- WHAT A FIT-OUT ADDS, AND TAKES BACK ------------------------------ */
  function Own(group) { this.group = group; this.meshes = []; this.cols = []; this.recs = []; this.done = false; }
  Own.prototype.add = function (m) { if (m) { this.group.add(m); this.meshes.push(m); } return m; };
  Own.prototype.col = function (minX, maxX, minZ, maxZ, y0, y1, o) {
    const c = { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ, y0: y0, y1: y1, ref: null, noBreach: true };
    if (o && o.noStep) c.noStep = true;
    this.cols.push(c);
    return c;
  };
  Own.prototype.attach = function () {
    if (CBZ.colliderAddMany) CBZ.colliderAddMany(this.cols); else for (const c of this.cols) CBZ.colliders.push(c);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  };
  Own.prototype.dispose = function () {
    if (this.done) return;
    this.done = true;
    if (CBZ.colliderRemoveMany) CBZ.colliderRemoveMany(this.cols);
    else for (const c of this.cols) { const i = CBZ.colliders.indexOf(c); if (i >= 0) CBZ.colliders.splice(i, 1); }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    if (CBZ.propUnregister) CBZ.propUnregister(this.recs);
    for (const m of this.meshes) {
      if (m.parent) m.parent.remove(m);
      m.traverse(function (o) {
        if (o.geometry && o.geometry.dispose) o.geometry.dispose();
        if (o.material && o.material.dispose) o.material.dispose();
      });
    }
    this.meshes.length = 0;
  };

  /* ---- THE FRONT DESK ---------------------------------------------------- */
  const WOOD = 0x5a3b26, STONE = 0xcfc8bb, PLASTER = 0xe2e0da, TRIM = 0x6e6a64, BRASS = 0xb08d4a;
  function rectHits(r, list) {
    for (const k of list || []) if (r.x1 > k.x0 + 1e-4 && r.x0 < k.x1 - 1e-4 && r.z1 > k.z0 + 1e-4 && r.z0 < k.z1 - 1e-4) return true;
    return false;
  }
  function colHits(W, cols, y0, y1) {
    for (const c of cols || []) {
      if (c.y1 != null && c.y1 < y0) continue;
      if (c.y0 != null && c.y0 > y1) continue;
      if (W.maxX > c.minX + 0.01 && W.minX < c.maxX - 0.01 && W.maxZ > c.minZ + 0.01 && W.minZ < c.maxZ - 0.01) return true;
    }
    return false;
  }
  // where the counter goes: against a side or back wall of the ground floor,
  // clear of the stair, the door walk, the lift and every piece already there
  function deskSite(b) {
    const In = b.interior;
    if (!In) return null;
    const F = frame(b), fy = b.floorTop != null ? b.floorTop : b.gy + 0.1;
    const keep = In.keepOut || [];
    const L = 2.2, DEEP = 2.7;        // along the wall; wall -> clerk -> counter -> customer
    const walls = [
      { n: [1, 0], w: In.x0, a0: In.z0, a1: In.z1 },
      { n: [-1, 0], w: In.x1, a0: In.z0, a1: In.z1 },
      { n: [0, -1], w: In.z1, a0: In.x0, a1: In.x1 },
    ];
    // a third of the way in first (seen from the door and across the lobby),
    // then out from there
    const TS = [];
    for (let t = 0.12; t <= 0.88 + 1e-6; t += 0.08) TS.push(t);
    TS.sort(function (p, q) { return Math.abs(p - 0.36) - Math.abs(q - 0.36); });
    for (const Wl of walls) {
      const span = Wl.a1 - Wl.a0;
      if (span < L + 0.6) continue;
      for (const t of TS) {
        const a = Wl.a0 + 0.3 + L / 2 + (span - 0.6 - L) * t;
        const along = Wl.n[0] !== 0 ? "z" : "x";
        const w0 = Wl.w + (Wl.n[0] || Wl.n[1]) * 0.03, w1 = Wl.w + (Wl.n[0] || Wl.n[1]) * DEEP;
        const r = along === "z"
          ? { x0: Math.min(w0, w1), x1: Math.max(w0, w1), z0: a - L / 2 - 0.2, z1: a + L / 2 + 0.2 }
          : { x0: a - L / 2 - 0.2, x1: a + L / 2 + 0.2, z0: Math.min(w0, w1), z1: Math.max(w0, w1) };
        if (r.x0 < In.x0 - 0.01 || r.x1 > In.x1 + 0.01 || r.z0 < In.z0 - 0.01 || r.z1 > In.z1 + 0.01) continue;
        if (rectHits(r, keep)) continue;
        const RW = rectW(F, r.x0, r.x1, r.z0, r.z1);
        if (colHits(RW, b.colliders, fy + 0.15, fy + 2.0)) continue;
        return { F: F, fy: fy, n: Wl.n, along: along, a: a, wall: Wl.w, L: L };
      }
    }
    return null;
  }
  function buildDesk(room, own) {
    const site = room.site, F = site.F, n = site.n, L = site.L;
    const ly = site.fy - F.gy;                      // the floor in the building's frame
    const kit = new Kit(), glow = new Kit();
    const P = function (off, a) { return site.along === "z" ? [site.wall + n[0] * off, a] : [a, site.wall + n[1] * off]; };
    const bx = function (off, a, y, sOff, sAlong, h, hex, k) {
      const p = P(off, a);
      const w = site.along === "z" ? sOff : sAlong, d = site.along === "z" ? sAlong : sOff;
      (k || kit).box(p[0], ly + y, p[1], w, h, d, hex);
    };
    // the counter: a panelled front, a stone top, a kick
    bx(1.3, site.a, 0.53, 0.55, L, 1.02, WOOD);
    bx(1.3, site.a, 1.06, 0.68, L + 0.08, 0.04, STONE);
    bx(1.58, site.a, 0.05, 0.02, L - 0.1, 0.1, 0x2e2620);
    for (let k = -1; k <= 1; k++) bx(1.585, site.a + k * L / 3, 0.55, 0.012, L / 3 - 0.12, 0.7, 0x4a311f);
    // on the counter: a bell, the register book, a lamp
    bx(1.4, site.a - L * 0.32, 1.1, 0.12, 0.12, 0.05, BRASS);
    bx(1.3, site.a + L * 0.18, 1.095, 0.28, 0.4, 0.03, 0x203048);
    bx(1.16, site.a + L * 0.4, 1.3, 0.16, 0.16, 0.42, 0x2a2a2a);
    bx(1.16, site.a + L * 0.4, 1.56, 0.24, 0.24, 0.16, 0xf3dcae, glow);
    // the key board on the wall behind him, a hook and a fob a room
    bx(0.04, site.a, 1.55, 0.03, 1.1, 0.7, 0x3f2a1b);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
      bx(0.07, site.a - 0.45 + c * 0.18, 1.78 - r * 0.2, 0.05, 0.02, 0.02, BRASS);
      if (h01(c, r, room.seed) < 0.6) bx(0.08, site.a - 0.45 + c * 0.18, 1.71 - r * 0.2, 0.02, 0.05, 0.09, r === 1 ? 0x8a2b20 : 0x1f4a6e);
    }
    own.add(kit.mesh(false, "island-desk"));
    own.add(glow.mesh(true, "island-desk-lamp"));
    // the counter is solid (a step it is not)
    const c0 = P(1.0, site.a - L / 2 - 0.04), c1 = P(1.64, site.a + L / 2 + 0.04);
    const R = rectW(F, Math.min(c0[0], c1[0]), Math.max(c0[0], c1[0]), Math.min(c0[1], c1[1]), Math.max(c0[1], c1[1]));
    own.col(R.minX, R.maxX, R.minZ, R.maxZ, site.fy, site.fy + 1.1, { noStep: true });
    // where he stands, where you stand
    const post = P(0.55, site.a), front = P(2.2, site.a);
    const pw = toW(F, post[0], post[1]), fw = toW(F, front[0], front[1]);
    room.post = { x: pw.x, y: site.fy, z: pw.z, face: yawW(F, n[0], n[1]) };
    room.front = { x: fw.x, y: site.fy, z: fw.z };
    const top = toW(F, P(1.3, site.a)[0], P(1.3, site.a)[1]);
    room.deskTop = { x: top.x, y: site.fy + 1.35, z: top.z };
  }

  /* ---- THE HOTEL ROOM: a guest room on an upper floor of the tower ------ */
  function buildHotelRoom(room, own) {
    const b = room.b, In = b.interior;
    if (!In || In.kind !== "tower" || (b.storeys | 0) < 4) return false;
    const F = frame(b);
    if (F.co !== 1 || F.si !== 0) return false;   // the towers stand square (makeTower)
    const iw = In.x1, id = In.z1;
    const s = Math.min(iw, id) * 0.42, so = s + 0.15;
    const x0 = so, x1 = iw, z0 = so, z1 = id;
    if (x1 - x0 < 4.0 || z1 - z0 < 3.6) return false;
    const span = Math.max(1, (b.storeys | 0) - 4);
    const k = Math.min((b.storeys | 0) - 1, 3 + ((h01(b.ox, b.oz, 0x407e) * span) | 0));
    const fyL = k * FH + 0.1, ceilL = (k + 1) * FH - 0.1, fy = F.gy + fyL;
    room.floor = k; room.number = (k + 1) * 100 + 10 + ((h01(b.oz, b.ox, 0x5e1) * 9) | 0) + 1;
    const kit = new Kit(), glow = new Kit();
    const T = 0.12, H = ceilL - fyL;
    // the partitions: west (x = so) and south (z = so) with the door in it
    kit.box(x0 + T / 2, fyL + H / 2, (z0 + z1) / 2, T, H, z1 - z0, PLASTER);
    const dc = (x0 + x1) / 2, DW = 0.95, DH = 2.1;
    const gx0 = dc - DW / 2, gx1 = dc + DW / 2;
    kit.box((x0 + gx0) / 2, fyL + H / 2, z0 + T / 2, gx0 - x0, H, T, PLASTER);
    kit.box((gx1 + x1) / 2, fyL + H / 2, z0 + T / 2, x1 - gx1, H, T, PLASTER);
    kit.box(dc, fyL + DH + (H - DH) / 2, z0 + T / 2, DW, H - DH, T, PLASTER);
    // the door's casing both sides, the threshold
    for (const sz of [-1, 1]) {
      const zc = z0 + T / 2 + sz * (T / 2 + 0.01);
      kit.box(gx0 - 0.035, fyL + DH / 2, zc, 0.07, DH, 0.02, TRIM);
      kit.box(gx1 + 0.035, fyL + DH / 2, zc, 0.07, DH, 0.02, TRIM);
      kit.box(dc, fyL + DH + 0.035, zc, DW + 0.14, 0.07, 0.02, TRIM);
    }
    // the number beside the door, corridor side
    kit.box(gx1 + 0.3, fyL + 1.55, z0 - 0.01, 0.16, 0.1, 0.01, BRASS);
    own.col(x0 + F.ox, x0 + T + F.ox, z0 + F.oz, z1 + F.oz, fy - 0.1, F.gy + ceilL);
    own.col(x0 + F.ox, gx0 + F.ox, z0 + F.oz, z0 + T + F.oz, fy - 0.1, F.gy + ceilL);
    own.col(gx1 + F.ox, x1 + F.ox, z0 + F.oz, z0 + T + F.oz, fy - 0.1, F.gy + ceilL);
    own.col(gx0 + F.ox, gx1 + F.ox, z0 + F.oz, z0 + T + F.oz, fy + DH, F.gy + ceilL);

    // ---- the furniture (city/furniture.js's kit, through this room's host)
    const FU = CBZ.furnish;
    const host = function (x, y, z, w, h, d, color, o) {
      ((o && o.emissive != null) ? glow : kit).box(x - F.ox, y - F.gy, z - F.oz, w, h, d, color);
      if (o && o.solid) own.col(x - w / 2, x + w / 2, z - d / 2, z + d / 2, o.y0 != null ? o.y0 : y - h / 2, o.y1 != null ? o.y1 : y + h / 2, { noStep: !!o.noStep });
      return true;
    };
    // the bed, its head to the east wall, in the middle of the room's depth
    const BL = 2.1, BW = 1.6;
    const bzc = (z0 + T + z1) / 2 + 0.2, bxc = x1 - BL / 2 - 0.12;
    let bedRec = null;
    if (FU && FU.bed) {
      const r = FU.bed(F.ox + bxc, fy, F.oz + bzc, Math.PI / 2, { box: host, ox: 0, oz: 0, solid: true, len: BL, wide: BW, tone: { cloth: 0x2d3a4f, wood: 0x3a2b1e, frame: 0x2e2620 } });
      bedRec = r && r.beds && r.beds[0] ? r.beds[0] : null;
    }
    if (!bedRec && CBZ.propRegisterBed) {
      kit.box(bxc, fyL + 0.28, bzc, BL, 0.55, BW, 0xe8e4dc);
      own.col(F.ox + bxc - BL / 2, F.ox + bxc + BL / 2, F.oz + bzc - BW / 2, F.oz + bzc + BW / 2, fy, fy + 0.55, { noStep: true });
      bedRec = CBZ.propRegisterBed(F.ox + bxc, fy, F.oz + bzc, 1, 0, BL - 0.1, fy + 0.55, "bed", null);
    }
    // the nightstands and their lamps, either side of the head
    for (const sd of [-1, 1]) {
      const nx = x1 - 0.26, nz = bzc + sd * (BW / 2 + 0.32);
      if (nz - 0.23 < z0 + T || nz + 0.23 > z1) continue;
      kit.box(nx, fyL + 0.27, nz, 0.44, 0.54, 0.4, 0x4a3324);
      kit.box(nx, fyL + 0.56, nz, 0.46, 0.03, 0.42, 0x6f5139);
      kit.box(nx, fyL + 0.6, nz, 0.1, 0.05, 0.1, 0x3a3a3a);
      kit.box(nx, fyL + 0.72, nz, 0.02, 0.2, 0.02, 0x3a3a3a);
      glow.box(nx, fyL + 0.86, nz, 0.22, 0.18, 0.22, 0xf3dcae);
      own.col(F.ox + nx - 0.22, F.ox + nx + 0.22, F.oz + nz - 0.2, F.oz + nz + 0.2, fy, fy + 0.58, { noStep: true });
    }
    // the bathroom: the back-west corner, its door standing open into it
    const BA = { x0: x0 + T, x1: x0 + T + 1.8, z0: z1 - 1.9, z1: z1 };
    const bath = BA.z0 > z0 + 2.2 && BA.x1 < bxc - BL / 2 - 0.6;
    if (bath) {
      const bdc = (BA.x0 + BA.x1) / 2, BDW = 0.8;
      kit.box(BA.x1 + T / 2, fyL + H / 2, (BA.z0 + BA.z1) / 2, T, H, BA.z1 - BA.z0, PLASTER);
      kit.box((BA.x0 + bdc - BDW / 2) / 2, fyL + H / 2, BA.z0 - T / 2, bdc - BDW / 2 - BA.x0, H, T, PLASTER);
      kit.box((bdc + BDW / 2 + BA.x1 + T) / 2, fyL + H / 2, BA.z0 - T / 2, BA.x1 + T - bdc - BDW / 2, H, T, PLASTER);
      kit.box(bdc, fyL + DH + (H - DH) / 2, BA.z0 - T / 2, BDW, H - DH, T, PLASTER);
      // its door, open against the partition inside
      kit.box(bdc + BDW / 2 - 0.03, fyL + 1.02, BA.z0 + BDW / 2, 0.04, 2.0, BDW - 0.04, 0xd9d4ca);
      kit.box(bdc + BDW / 2 - 0.07, fyL + 1.0, BA.z0 + BDW - 0.1, 0.04, 0.03, 0.12, BRASS);
      // tile, a toilet, a basin under a mirror
      kit.box(bdc, fyL + 0.006, (BA.z0 + BA.z1) / 2, BA.x1 - BA.x0, 0.012, BA.z1 - BA.z0, 0xd9dcd8);
      kit.box(BA.x0 + 0.38, fyL + 0.2, BA.z1 - 0.3, 0.38, 0.4, 0.5, 0xf2f2ef);
      kit.box(BA.x0 + 0.38, fyL + 0.62, BA.z1 - 0.1, 0.42, 0.42, 0.16, 0xf2f2ef);
      kit.box(BA.x1 - 0.3, fyL + 0.4, BA.z1 - 0.28, 0.16, 0.8, 0.16, 0xf2f2ef);
      kit.box(BA.x1 - 0.3, fyL + 0.84, BA.z1 - 0.26, 0.5, 0.1, 0.42, 0xf2f2ef);
      kit.box(BA.x1 - 0.3, fyL + 1.45, BA.z1 - 0.02, 0.55, 0.7, 0.02, 0xb9c4c9);
      glow.box(BA.x1 - 0.3, fyL + 1.88, BA.z1 - 0.05, 0.5, 0.05, 0.06, 0xf6efe0);
      own.col(F.ox + BA.x1, F.ox + BA.x1 + T, F.oz + BA.z0, F.oz + BA.z1, fy - 0.1, F.gy + ceilL);
      own.col(F.ox + BA.x0, F.ox + bdc - BDW / 2, F.oz + BA.z0 - T, F.oz + BA.z0, fy - 0.1, F.gy + ceilL);
      own.col(F.ox + bdc + BDW / 2, F.ox + BA.x1 + T, F.oz + BA.z0 - T, F.oz + BA.z0, fy - 0.1, F.gy + ceilL);
      own.col(F.ox + BA.x0 + 0.17, F.ox + BA.x0 + 0.6, F.oz + BA.z1 - 0.56, F.oz + BA.z1, fy, fy + 0.45, { noStep: true });
      own.col(F.ox + BA.x1 - 0.55, F.ox + BA.x1, F.oz + BA.z1 - 0.48, F.oz + BA.z1, fy, fy + 0.9, { noStep: true });
    }
    // the TV on its cabinet, on the west partition, facing the bed
    {
      const tz = Math.max(z0 + T + 0.9, Math.min((bath ? BA.z0 - T : z1) - 0.9, bzc - 0.4));
      const tx = x0 + T + 0.24;
      kit.box(tx, fyL + 0.25, tz, 0.45, 0.5, 1.4, 0x3b2c22);
      kit.box(tx + 0.005, fyL + 0.51, tz, 0.47, 0.03, 1.42, 0x2a1f18);
      kit.box(x0 + T + 0.06, fyL + 1.2, tz, 0.05, 0.66, 1.12, 0x0e1013);
      kit.box(x0 + T + 0.089, fyL + 1.2, tz, 0.005, 0.6, 1.06, 0x050608);
      own.col(F.ox + tx - 0.23, F.ox + tx + 0.23, F.oz + tz - 0.7, F.oz + tz + 0.7, fy, fy + 0.53, { noStep: true });
    }
    // a runner at the foot of the bed
    kit.box(bxc - BL / 2 - 0.45, fyL + 0.006, bzc, 0.8, 0.012, BW + 0.4, 0x6b3a32);
    // the ceiling light in the room (the tower's troffer grid is overhead too)
    glow.box((x0 + x1) / 2, ceilL - 0.03, (z0 + z1) / 2, 0.4, 0.04, 0.4, 0xf6efe0);

    own.add(kit.mesh(false, "island-hotel-room"));
    own.add(glow.mesh(true, "island-hotel-room-glow"));

    // ---- THE DOOR: a leaf on its hinge, shut unless you hold the key ----
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2e });
    leafMat.name = "island-hotel-door";
    if (CBZ.islandRoomLight) CBZ.islandRoomLight(leafMat, false);
    const pivot = new THREE.Group();
    pivot.position.set(gx0, fyL, z0 + T / 2);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(DW - 0.02, DH - 0.02, 0.045), leafMat);
    leaf.position.set((DW - 0.02) / 2, (DH - 0.02) / 2, 0);
    leaf.castShadow = true; leaf.receiveShadow = true;
    pivot.add(leaf);
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.12), new THREE.MeshLambertMaterial({ color: BRASS }));
    knob.position.set(DW - 0.12, 1.0, 0);
    pivot.add(knob);
    own.add(pivot);
    const dcol = own.col(gx0 + F.ox, gx1 + F.ox, z0 + F.oz - 0.02, z0 + T + F.oz + 0.02, fy, fy + DH);
    room.door = { pivot: pivot, col: dcol, y0: dcol.y0, y1: dcol.y1, open: false, t: 0,
      at: { x: F.ox + dc, y: fy + 1.2, z: F.oz + z0 - 0.3 }, inside: { x: F.ox + dc, y: fy + 1.2, z: F.oz + z0 + 0.6 } };
    if (bedRec) { own.recs.push(bedRec); room.beds = [bedRec]; }
    room.box = { minX: F.ox + x0, maxX: F.ox + x1, minZ: F.oz + z0, maxZ: F.oz + z1, y0: fy - 0.2, y1: F.gy + ceilL };
    room.wake = { x: F.ox + bxc - BL / 2 - 0.5, y: fy, z: F.oz + bzc - BW / 2 - 0.35, face: -Math.PI / 2 };
    return true;
  }

  /* ---- A MOTEL'S ROOM: the building's own bedroom, upstairs ------------- */
  function motelRoom(room, A) {
    const I = A && A.island;
    /* A MOTEL BUILT AS ONE (world/island_lots.js: a row of rooms off a
       gallery): the office lets the one room of the row whose door is on
       its hinge; its bed is the bed in that room; the door opens for you. */
    const M = room.b && room.b.motel;
    if (M && M.rooms && M.rooms[M.rent]) {
      const R = M.rooms[M.rent], B = R.box;
      const beds = (I && I.beds || []).filter(function (r) {
        return r.b === room.b && r.rec && r.x > B.minX && r.x < B.maxX && r.z > B.minZ && r.z < B.maxZ && Math.abs(r.y - R.y) < 1;
      });
      if (!beds.length) return false;
      room.beds = beds.map(function (r) { return r.rec; });
      room.floor = R.k; room.number = R.n;
      room.door = R.door || null;
      room.box = B;
      const r0 = beds[0];
      room.wake = { x: r0.x - r0.hz * 1.0, y: r0.y, z: r0.z + r0.hx * 1.0, face: Math.atan2(-r0.hx, -r0.hz) };
      return true;
    }
    const mine = (I && I.beds || []).filter(function (r) { return r.b === room.b && r.rec; });
    if (!mine.length) return false;
    mine.sort(function (a, b2) { return b2.y - a.y; });
    room.beds = mine.map(function (r) { return r.rec; });
    const r0 = mine[0];
    room.floor = Math.max(0, Math.round((r0.y - room.b.gy) / FH));
    room.number = 1 + ((h01(room.b.ox, room.b.oz, 0x3a7) * 14) | 0);
    room.wake = { x: r0.x - r0.hz * 1.0, y: r0.y, z: r0.z + r0.hx * 1.0, face: Math.atan2(-r0.hx, -r0.hz) };
    return true;
  }

  /* ---- FIT A VENUE ------------------------------------------------------- */
  function fit(b, A) {
    const use = useOf(b);
    if (!b || (use !== "hotel" && use !== "motel") || S.fitted.has(b) || b.fallen || !b.group) return null;
    S.fitted.add(b);
    const room = { b: b, A: A || null, use: use, seed: (h01(b.ox, b.oz, 0x1d9) * 997) | 0, beds: [], door: null,
      post: null, front: null, clerk: null, own: new Own(b.group), price: 0, site: null };
    const pr = PRICE[use];
    room.price = pr[0] === pr[1] ? pr[0] : pr[0] + 5 * Math.round(h01(b.oz, b.ox, 0x9e1) * (pr[1] - pr[0]) / 5);
    try {
      room.site = b._lodgeSite || deskSite(b);
      if (room.site) buildDesk(room, room.own);
      if (use === "hotel") buildHotelRoom(room, room.own);
      else if (A) motelRoom(room, A);
    } catch (e) { console.error("[island lodging]", e); }
    room.own.attach();
    for (const r of room.beds) { r.isMine = mineFn(room); r.lodging = room; }
    S.rooms.push(room);
    return room;
  }
  function mineFn(room) { return function () { return rented(room); }; }
  function drop(room) {
    const i = S.rooms.indexOf(room);
    if (i >= 0) S.rooms.splice(i, 1);
    room.own.dispose();
    if (S.rent && S.rent.room === room) S.rent = null;
    if (room.clerk) { room.clerk._lodgeClerk = null; room.clerk = null; }
  }
  // the venue seam, when it is on main (world/island_venue.js)
  let venueHooked = false;
  function hookVenue() {
    if (venueHooked) return;
    const V = CBZ.islandVenue;
    if (!V || typeof V.on !== "function") return;
    venueHooked = true;
    for (const use of ["hotel", "motel"]) {
      try {
        // (the fit itself waits for the island to join the world: scan()
        // below; this hook only gives the room back when the venue goes)
        V.on(use, function (b) {
          // a hotel's lobby is a hotel lobby: furnished here, while the island
          // joins the world (the front desk itself is fit() below, on the
          // spot chosen now and kept clear)
          if (use === "hotel") { try { dressLobby(b); } catch (e) { console.error("[hotel lobby]", e); } }
          return function () { b._lodgeSite = null; for (const room of S.rooms.slice()) if (room.b === b) drop(room); };
        });
      } catch (e) {}
    }
  }

  /* ---- THE HOTEL LOBBY ---------------------------------------------------
     The tower's lobby furniture out (CBZ.islandVenue.clear), the desk's
     spot chosen and kept, and the lobby round it (world/island_fitkit.js
     dress): a stone floor, a runner from the street door to the lifts, the
     sitting group on the far side (a sofa, two armchairs, the low table on
     a rug), palms in the corners, the luggage trolley by the desk, the
     hotel's name on the wall over the desk. */
  function dressLobby(b) {
    const IV = CBZ.islandVenue, FIT = CBZ.islandFit;
    if (!IV || !FIT || !FIT.dress || !b.interior || b._lodgeSite) return;
    IV.clear(b, 0);
    const site = deskSite(b);
    b._lodgeSite = site;
    const In = b.interior, F0 = IV.floor(b, 0), y = F0.yLocal;
    const keep = [];
    let signAt = null;
    if (site) {
      const n = site.n, L = site.L;
      const P = function (off, a) { return site.along === "z" ? [site.wall + n[0] * off, a] : [a, site.wall + n[1] * off]; };
      const c0 = P(0, site.a - L / 2 - 0.5), c1 = P(3.2, site.a + L / 2 + 0.9);
      keep.push({ x0: Math.min(c0[0], c1[0]), x1: Math.max(c0[0], c1[0]), z0: Math.min(c0[1], c1[1]), z1: Math.max(c0[1], c1[1]) });
      const sp = P(0.02, site.a);
      signAt = { lx: sp[0], lz: sp[1], ly: FIT.ceil(b, 0) - 0.5, lyaw: Math.atan2(n[0], n[1]), w: 2.0 };
      // the hotel's office safe behind the desk, at its far end from the trolley
      if (IV.safe && !b._safeDone) {
        const q = P(0.42, site.a - L / 2 - 0.5);
        const inside = q[0] - 0.45 > In.x0 && q[0] + 0.45 < In.x1 && q[1] - 0.45 > In.z0 && q[1] + 0.45 < In.z1;
        if (inside) try { IV.safe(b, { k: 0, lx: q[0], lz: q[1], yaw: Math.atan2(n[0], n[1]), grade: "office", of: 6000 + 9000 * FIT.hash(b.name || "hotel"), name: "office safe" }); } catch (e) {}
        keep.push({ x0: q[0] - 0.6, x1: q[0] + 0.6, z0: q[1] - 0.6, z1: q[1] + 0.6 });
      }
    }
    const lift = (In.keepOut || []).filter(function (r) { return r.why === "lift"; })[0] || null;
    FIT.dress(b, {
      kind: "hotel-lobby", keep: keep, lights: false,
      floor: { col: 0xd8d0c0, border: 0x6b5a48 },
      sign: b.name || null, signAt: signAt, signBg: "#1a120c", signFg: "#e2c98a", signBack: 0x2a1a10,
      extra: function (D) {
        const K = D.K, R = D.R;
        // the runner from the street door to the lifts
        const zr1 = lift ? lift.z0 : R.z0 + 4;
        K.lbox(0, y + 0.011, (R.z0 + zr1) / 2, 1.4, 0.006, zr1 - R.z0 - 0.2, 0x6b1f28);
        K.lbox(0, y + 0.013, (R.z0 + zr1) / 2, 1.2, 0.006, zr1 - R.z0 - 0.4, 0x8a2a32);
        // the sitting group, on the side away from the desk
        const far = site && site.n[0] > 0 ? 1 : -1;     // desk on the -x wall: sit on the +x side
        const sx = far > 0 ? R.x1 : R.x0;
        for (const zc of [(R.z0 + R.z1) / 2, R.z0 + (R.z1 - R.z0) * 0.3, R.z0 + (R.z1 - R.z0) * 0.7]) {
          const r = { x0: far > 0 ? sx - 3.1 : sx, x1: far > 0 ? sx : sx + 3.1, z0: zc - 1.4, z1: zc + 1.4 };
          if (!D.place(r)) continue;
          const fx = -far;                                   // facing into the lobby
          K.lbox(sx + fx * 1.55, y + 0.012, zc, 2.4, 0.006, 2.4, 0x3a4a5a);
          D.furnish("sofa", sx + fx * 0.48, zc, fx > 0 ? Math.PI / 2 : -Math.PI / 2, { len: 2.1, tone: { cloth: 0x6b4a33, wood: 0x2a1a10 } });
          D.furnish("coffee", sx + fx * 1.55, zc, fx > 0 ? Math.PI / 2 : -Math.PI / 2, { len: 1.0, deep: 0.55, tone: { wood: 0x2a1a10 } });
          for (const dz of [-0.6, 0.6]) D.furnish("armchair", sx + fx * 2.6, zc + dz, fx > 0 ? -Math.PI / 2 : Math.PI / 2, { tone: { cloth: 0x3a4a5a, wood: 0x2a1a10, frame: 0x2a1a10 } });
          break;
        }
        // palms in the corners
        for (const c of [[R.x0 + 0.45, R.z0 + 0.45], [R.x1 - 0.45, R.z0 + 0.45], [R.x0 + 0.45, R.z1 - 0.45], [R.x1 - 0.45, R.z1 - 0.45]]) {
          if (D.place({ x0: c[0] - 0.4, x1: c[0] + 0.4, z0: c[1] - 0.4, z1: c[1] + 0.4 })) D.furnish("planter", c[0], c[1], 0, { kind: "tree", s: 1.3 });
        }
        // the luggage trolley by the desk
        if (site) {
          const n = site.n, a = site.a + site.L / 2 + 0.6;
          const p = site.along === "z" ? [site.wall + n[0] * 0.6, a] : [a, site.wall + n[1] * 0.6];
          if (D.place({ x0: p[0] - 0.45, x1: p[0] + 0.45, z0: p[1] - 0.45, z1: p[1] + 0.45 })) {
            K.lbox(p[0], y + 0.12, p[1], 0.9, 0.04, 0.55, 0x8a6a3a, { solid: true, y1: y + 1.9 });
            for (const sx2 of [-0.42, 0.42]) K.lbox(p[0] + (site.along === "z" ? 0 : sx2), y + 1.0, p[1] + (site.along === "z" ? sx2 : 0), 0.04, 1.8, 0.04, 0xc9a44a);
            K.lbox(p[0], y + 1.88, p[1], site.along === "z" ? 0.05 : 0.9, 0.05, site.along === "z" ? 0.9 : 0.05, 0xc9a44a);
            K.lbox(p[0], y + 0.36, p[1], 0.5, 0.44, 0.3, 0x2a3a5a);
            K.lbox(p[0], y + 0.68, p[1], 0.4, 0.2, 0.26, 0x6b2a2a);
          }
        }
      },
    });
  }

  // the islands in the world: fit what is new, drop what has gone
  function scan() {
    hookVenue();
    const AR = CBZ.archipelago;
    const isles = AR && AR.isles ? AR.isles() : [];
    const arenas = new Set();
    for (const I of isles) if (I && I.arena && I.arena.island) arenas.add(I.arena);
    for (let i = S.rooms.length - 1; i >= 0; i--) {
      const room = S.rooms[i];
      if (!room.A) { for (const A of arenas) if ((A.island.buildings || []).indexOf(room.b) >= 0 || (A.island.sites || []).indexOf(room.b) >= 0) { room.A = A; break; } }
      if ((room.A && !arenas.has(room.A)) || room.b.fallen) drop(room);
    }
    arenas.forEach(function (A) {
      if (A._job && !A._job.attached) return;          // not in the world yet
      // (the motel is a venue site: world/island_lots.js builds it as one)
      const L = (A.island.buildings || []).concat(A.island.sites || []);
      for (const b of L) {
        const u = useOf(b);
        if ((u === "hotel" || u === "motel") && !S.fitted.has(b)) fit(b, A);
      }
      // a motel fitted before its beds were in the registry finds them now
      for (const room of S.rooms) if (room.A === A && room.use === "motel" && !room.beds.length && motelRoom(room, A)) {
        for (const r of room.beds) { r.isMine = mineFn(room); r.lodging = room; }
      }
    });
  }

  /* ---- THE RENTAL -------------------------------------------------------- */
  function rented(room) {
    const R = S.rent;
    if (!R || R.room !== room) return false;
    if (dayNow() > R.until) { S.rent = null; return false; }
    return true;
  }
  function checkout() {
    // noon tomorrow, or the day after if tomorrow's noon is under six hours off
    const t = dayNow(), d = Math.floor(t), ph = t - d;
    let until = d + NOON + (ph < NOON ? 0 : 1);
    if (until - t < 0.25) until += 1;
    return until;
  }
  function cash() { return (g && g.cash) || 0; }
  function spend(n) {
    if (CBZ.city && CBZ.city.spend) return CBZ.city.spend(n);
    if (cash() < n) return false;
    g.cash -= n;
    return true;
  }
  function say(who, line) { if (who && CBZ.speech && CBZ.speech.say) { try { CBZ.speech.say(who, line); } catch (e) {} } }
  const ORD = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"];
  function rent(room) {
    if (!room || rented(room)) return false;
    const clerk = clerkReady(room) ? room.clerk : null;
    if (!clerk) return false;
    if (!room.beds.length) { say(clerk, "We're full tonight."); return false; }
    if (!spend(room.price)) { say(clerk, "It's $" + room.price + " a night."); return false; }
    S.rent = { room: room, until: checkout() };
    const fl = (room.floor | 0) + 1;            // the street is the first floor
    if (room.use === "hotel") say(clerk, "Room " + room.number + ", " + (ORD[fl] || (fl + "th")) + " floor. Checkout's noon.");
    else say(clerk, "Upstairs. Checkout's noon.");
    if (CBZ.sfx) { try { CBZ.sfx("coin"); } catch (e) {} }
    if (CBZ.cityHudDirty) { try { CBZ.cityHudDirty(); } catch (e) {} }
    return true;
  }

  /* ---- THE CLERK: a person of the island, at his post -------------------- */
  const _v3 = new THREE.Vector3();
  function unseen(x, y, z) {
    const cam = CBZ.camera;
    if (!cam) return true;
    const d = Math.hypot(cam.position.x - x, cam.position.z - z);
    if (d < 4) return false;
    _v3.set(x, y + 1, z).project(cam);
    const onScreen = _v3.z > -1 && _v3.z < 1 && Math.abs(_v3.x) < 1.2 && Math.abs(_v3.y) < 1.2;
    return !onScreen || d > 70;
  }
  function alive(b) { return !!(b && !b.dead && b.group && b.group.parent && CBZ.bots && CBZ.bots.indexOf(b) >= 0); }
  function scared(b) { return b.state === "panic" || b.state === "flee" || (b.panicT || 0) > 0; }
  function clerkReady(room) {
    const c = room.clerk;
    if (!alive(c) || scared(c) || !room.post) return false;
    return Math.hypot(c.pos.x - room.post.x, c.pos.z - room.post.z) < 1.2;
  }
  function tendClerk(room) {
    if (!room.post) return;
    let c = room.clerk;
    if (c && !alive(c)) { if (c) c._lodgeClerk = null; c = room.clerk = null; }
    if (!c) {
      if (!CBZ.spawnSurvivorBotAt || !unseen(room.post.x, room.post.y, room.post.z)) return;
      try { c = CBZ.spawnSurvivorBotAt(room.post.x, room.post.z); } catch (e) { c = null; }
      if (!c) return;
      c._lodgeClerk = room;
      if (c.pos) c.pos.y = room.post.y;
      if (c.group) c.group.rotation.y = room.post.face;
      room.clerk = c;
    }
    if (S.tres && S.tres.bot === c) return;      // the ladder has him
    if (scared(c) || !c.target) return;          // he runs like anybody; he comes back after
    const d = Math.hypot(c.pos.x - room.post.x, c.pos.z - room.post.z);
    c.target.set(room.post.x, 0, room.post.z);
    c.pause = Math.max(c.pause || 0, 2);
    if (d < 0.5) {
      // at the counter, facing the door side of it
      c.state = "look"; c._lookX = room.front.x; c._lookZ = room.front.z;
    } else if (c.state !== "move") { c.state = "move"; c._arrived = false; }
  }

  /* ---- THE DOOR ---------------------------------------------------------- */
  function doorSet(room, open) {
    const D = room.door;
    if (!D || D.open === open) return;
    D.open = open;
    if (open) { D.col.y0 = -1e4; D.col.y1 = -1e4 + 0.01; }
    else { D.col.y0 = D.y0; D.col.y1 = D.y1; }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    if (CBZ.sfx) { try { CBZ.sfx(open ? "door" : "doorClose"); } catch (e) {} }
  }
  function tickDoor(room, dt) {
    const D = room.door;
    if (!D) return;
    // a door you are not let in by closes when the night you paid for is over
    if (D.open && !rented(room)) {
      const P = CBZ.player;
      const inside = P && P.pos && room.box && P.pos.x > room.box.minX && P.pos.x < room.box.maxX && P.pos.z > room.box.minZ && P.pos.z < room.box.maxZ && P.pos.y > room.box.y0 && P.pos.y < room.box.y1;
      const near = P && P.pos && Math.hypot(P.pos.x - D.at.x, P.pos.z - D.at.z) < 1.6;
      if (!inside && !near) doorSet(room, false);
    }
    const want = D.open ? 1 : 0;
    if (D.t !== want) {
      D.t = want > D.t ? Math.min(1, D.t + dt * 2.4) : Math.max(0, D.t - dt * 2.4);
      const e = D.t * D.t * (3 - 2 * D.t);
      D.pivot.rotation.y = -e * Math.PI * 0.5;
    }
  }

  /* ---- THE VERBS (the prompt pills' acts) -------------------------------- */
  let armBed = null, armRoom = null, armDoor = null;
  CBZ.islandBedLie = function () {
    const P = CBZ.player, bed = armBed;
    if (!live() || !P || !bed || S.sleeping || P._propBed || P.dead || P.driving) return false;
    return !!(CBZ.propSleep && CBZ.propSleep(P, bed, { lieOnly: true }));
  };
  CBZ.islandBedSleep = function () {
    const P = CBZ.player, bed = P && P._propBed;
    if (!live() || !bed || S.sleeping || (CBZ.propArcActive && CBZ.propArcActive(P))) return false;
    const mine = !!(bed.isMine && bed.isMine());
    if (!mine) {
      const w = witness(bed);
      if (w) {
        if (CBZ.propWake) CBZ.propWake(P);
        trespass(w, homeOf(bed));
        return false;
      }
    }
    sleepNight(bed, mine);
    return true;
  };
  CBZ.islandLodgeRent = function () { return live() && armRoom ? rent(armRoom) : false; };
  CBZ.islandLodgeDoor = function () {
    const room = armDoor;
    if (!live() || !room || !room.door) return false;
    if (room.door.open) { doorSet(room, false); return true; }
    if (!rented(room)) return false;
    doorSet(room, true);
    return true;
  };

  /* ---- THE NIGHT ---------------------------------------------------------- */
  function fadeEl() { return document.getElementById("fade"); }
  function sleepNight(bed, mine) {
    S.sleeping = true;
    const el = fadeEl(), was = el ? el.style.transition : "";
    if (el) { el.style.transition = "opacity .6s"; el.style.opacity = "1"; }
    setTimeout(function () {
      const P = CBZ.player;
      let res = null;
      try { res = CBZ.propRestNight ? CBZ.propRestNight(bed) : null; } catch (e) { res = null; }
      if (res && mine && P) {
        // a room that is yours: all the way back
        P.hp = P.maxHp || 100;
        if (CBZ.SURV) P.stamina = CBZ.SURV.staminaMax;
        if (CBZ.vitals && CBZ.vitals.reset) { try { CBZ.vitals.reset(P); } catch (e) {} }
        if (CBZ.trauma && CBZ.trauma.reset && CBZ.surv) { try { CBZ.trauma.reset(CBZ.surv.playerActor); } catch (e) {} }
        // ...and where you get up after a death while the room is yours
        const room = bed.lodging;
        if (room) {
          const e = CBZ.propEntryPoint ? CBZ.propEntryPoint(bed) : null;
          const at = e && e.ok ? { x: e.x, y: bed.y, z: e.z, face: Math.atan2(bed.x - e.x, bed.z - e.z) } : room.wake;
          if (at) S.wake = { room: room, at: at };
        }
      }
      if (CBZ.requestShadowUpdate) { try { CBZ.requestShadowUpdate(true); } catch (e) {} }
      else if (CBZ.renderer && CBZ.renderer.shadowMap) CBZ.renderer.shadowMap.needsUpdate = true;
      setTimeout(function () {
        if (el) el.style.opacity = "0";
        setTimeout(function () { if (el) el.style.transition = was; S.sleeping = false; }, 650);
      }, 800);
    }, 650);
  }

  /* ---- SOMEBODY'S HOUSE: the trespass ladder ----------------------------- */
  function homeOf(bed) {
    if (bed.home) return bed.home;
    if (bed.lodging) return bed.lodging.b;
    return null;
  }
  function witness(bed) {
    const BR = CBZ.brain, P = CBZ.player, bots = CBZ.bots || [];
    if (!P || !P.pos) return null;
    let best = null, bd = 1e9;
    for (const b of bots) {
      if (!b || b.dead || !b.pos || b._aboard) continue;
      const d = Math.hypot(b.pos.x - P.pos.x, b.pos.z - P.pos.z);
      if (d > SEE.range || Math.abs((b.pos.y || 0) - P.pos.y) > 3) continue;
      let sees = true;
      if (BR && BR.perception && BR.perception.seesPoint && b._brain) {
        try { sees = BR.perception.seesPoint(b, P.pos.x, P.pos.y, P.pos.z, SEE); } catch (e) { sees = false; }
      }
      if (sees && d < bd) { bd = d; best = b; }
    }
    return best;
  }
  function insideOf(b) {
    const P = CBZ.player;
    if (!b || !P || !P.pos) return false;
    return Math.abs(P.pos.x - b.x) < b.w / 2 + 0.3 && Math.abs(P.pos.z - b.z) < b.d / 2 + 0.3 &&
      P.pos.y > b.gy - 1 && P.pos.y < b.gy + b.h + 1;
  }
  function trespass(bot, b) {
    const D = CBZ.brain && CBZ.brain.demand;
    if (S.tres) endTrespass();
    if (!D || !bot._brain) { say(bot, "Get out of my house."); return; }
    let c = null;
    try { c = D.begin(bot, playerActor(), "trespass", {}); } catch (e) { c = null; }
    if (!c) { say(bot, "Get out of my house."); return; }
    S.tres = { bot: bot, b: b, t: 0, hitT: 0, said: "", saidT: 0, lastP: null };
  }
  function endTrespass() {
    const T = S.tres;
    S.tres = null;
    if (!T) return;
    const D = CBZ.brain && CBZ.brain.demand;
    if (D && D.cancel) { try { D.cancel(T.bot); } catch (e) {} }
    if (T.bot && T.bot.state === "look") T.bot.state = "wander";
  }
  function tickTrespass(dt) {
    const T = S.tres;
    if (!T) return;
    const D = CBZ.brain && CBZ.brain.demand, b = T.bot, P = CBZ.player;
    if (!D || !alive(b) || !P || !P.pos || P.dead || T.t > 60) { endTrespass(); return; }
    T.t += dt;
    const dist = Math.hypot(P.pos.x - b.pos.x, P.pos.z - b.pos.z);
    let speed = 0;
    if (T.lastP) speed = Math.hypot(P.pos.x - T.lastP.x, P.pos.z - T.lastP.z) / Math.max(1e-3, dt);
    T.lastP = { x: P.pos.x, z: P.pos.z };
    let r = null;
    try {
      r = D.step(b, dt, { dist: dist, speed: speed, armed: false, aiming: false, attacking: false, paid: false,
        inside: T.b ? insideOf(T.b) : dist < 8 });
    } catch (e) { r = null; }
    if (!r) { endTrespass(); return; }
    T.saidT -= dt;
    if (r.say && (r.say !== T.said || T.saidT <= 0)) { say(b, r.say); T.said = r.say; T.saidT = 4; }
    const act = r.act;
    if (act === "approach" || act === "close" || act === "chase") {
      if (b.target) { b.target.set(P.pos.x, 0, P.pos.z); b.pause = 2; b.state = act === "chase" ? "flee" : "move"; b._arrived = false; }
    } else if (act === "hold" || act === "draw" || act === "aim") {
      if (b.target) { b.target.set(b.pos.x, 0, b.pos.z); b.pause = 2; }
      b.state = "look"; b._lookX = P.pos.x; b._lookZ = P.pos.z;
    } else if (act === "beat" || act === "throw" || act === "shove") {
      if (b.target) { b.target.set(P.pos.x, 0, P.pos.z); b.pause = 2; b.state = "move"; }
      T.hitT -= dt;
      if (dist < 1.4 && T.hitT <= 0 && CBZ.verbs && CBZ.verbs.strike) {
        T.hitT = 1.3;
        if (P._propBed && CBZ.propWake) CBZ.propWake(P);
        try { CBZ.verbs.strike(b, playerActor(), {}); } catch (e) {}
      }
    } else if (act === "flee") {
      b._scare = b._scare || { x: 0, z: 0, t: 0, resp: null, hold: 0 };
    }
    if (r.step === "done") endTrespass();
  }

  /* ---- THE FRAME: what is in reach, armed on the thing ------------------- */
  function sameFloor(y, P) { return Math.abs(y - P.pos.y) < 1.4; }
  function arm(dt) {
    armBed = null; armRoom = null; armDoor = null;
    const P = CBZ.player;
    if (!P || !P.pos || P.dead || P.driving || P._aircraft || S.sleeping || !CBZ.prisonPrompt) return;
    if (CBZ.propArcActive && CBZ.propArcActive(P)) return;
    // IN BED: sleep is the decision, getting up the way out
    if (P._propBed) {
      const bd = P._propBed, at = { x: bd.x, y: (bd.top || P.pos.y) + 0.6, z: bd.z };
      CBZ.prisonPrompt("isle-bed-sleep", "@islandBedSleep", "Sleep", { at: at, key: "I", bind: true, d2: -1, group: "isle-bed", row: 0 });
      if (CBZ.seatExit) CBZ.prisonPrompt("isle-bed-up", "@seatExit", "Get up", { at: at, key: "E", bind: true, d2: -1, group: "isle-bed", row: 1 });
      return;
    }
    if (P._propSeat) return;
    const A = CBZ.surv && CBZ.surv.arena;
    // the desk, while its clerk is at it
    for (const room of S.rooms) {
      if (room.A !== A || !room.front) continue;
      if (rented(room) || !sameFloor(room.front.y, P)) continue;
      const d = Math.hypot(P.pos.x - room.front.x, P.pos.z - room.front.z);
      if (d > DESK_REACH || !clerkReady(room)) continue;
      armRoom = room;
      CBZ.prisonPrompt("isle-desk-rent", "@islandLodgeRent", "Rent $" + room.price, { at: room.deskTop, key: "E", bind: true, d2: d * d });
      break;
    }
    // a room's door: yours opens, any open one shuts
    for (const room of S.rooms) {
      const D = room.door;
      if (room.A !== A || !D || !sameFloor(D.at.y - 1.2, P)) continue;
      const d = Math.min(Math.hypot(P.pos.x - D.at.x, P.pos.z - D.at.z), Math.hypot(P.pos.x - D.inside.x, P.pos.z - D.inside.z));
      if (d > DOOR_REACH) continue;
      if (!D.open && !rented(room)) continue;
      armDoor = room;
      const inside = Math.hypot(P.pos.x - D.inside.x, P.pos.z - D.inside.z) < Math.hypot(P.pos.x - D.at.x, P.pos.z - D.at.z);
      CBZ.prisonPrompt("isle-room-door", "@islandLodgeDoor", D.open ? "Close" : "Open", { at: inside ? D.inside : D.at, key: "E", bind: true, d2: d * d });
      break;
    }
    // a bed
    const bed = CBZ.propNearestBed ? CBZ.propNearestBed(P.pos.x, P.pos.z, BED_REACH, P.pos.y) : null;
    if (bed && !bed._gone) {
      const e = CBZ.propEntryPoint ? CBZ.propEntryPoint(bed) : null;
      if (!e || e.ok) {
        armBed = bed;
        const d = Math.hypot(P.pos.x - bed.x, P.pos.z - bed.z);
        CBZ.prisonPrompt("isle-bed-lie", "@islandBedLie", "Lie down", { at: { x: bed.x, y: (bed.top || P.pos.y) + 0.35, z: bed.z }, key: "E", bind: true, d2: d * d });
      }
    }
  }

  if (CBZ.onUpdate) CBZ.onUpdate(22.5, function (dt) {
    if (!g || g.mode !== MODE) {
      if (S.tres) endTrespass();
      return;
    }
    dt = Math.min(0.1, Math.max(0, +dt || 0));
    if ((S.scanT -= dt) <= 0) { S.scanT = 0.5; try { scan(); } catch (e) { console.error("[island lodging scan]", e); } }
    const A = CBZ.surv && CBZ.surv.arena;
    for (const room of S.rooms) {
      tickDoor(room, dt);
      if (room.A === A) tendClerk(room);
    }
    if (S.rent && dayNow() > S.rent.until) S.rent = null;
    // lying in somebody's bed where somebody can see you is the ladder
    const P = CBZ.player, bed = P && P._propBed;
    if (bed && !S.tres && !S.sleeping && !(bed.isMine && bed.isMine()) && (S.seeT = (S.seeT || 0) - dt) <= 0) {
      S.seeT = 0.5;
      const w = witness(bed);
      if (w) { if (CBZ.propWake) CBZ.propWake(P); trespass(w, homeOf(bed)); }
    }
    tickTrespass(dt);
    if (g.state === "playing") arm(dt);
  });

  /* ---- THE ISLES' RESPAWN: where you last slept, while it is yours ------- */
  function wakeSpot(A) {
    const W = S.wake;
    if (!W || !W.room || !rented(W.room) || (A && W.room.A !== A)) return null;
    return { x: W.at.x, y: W.at.y, z: W.at.z, face: W.at.face };
  }

  CBZ.islandLodging = {
    rooms: function () { return S.rooms; },
    rental: function () { return S.rent ? { use: S.rent.room.use, number: S.rent.room.number, floor: S.rent.room.floor, until: S.rent.until } : null; },
    wakeSpot: wakeSpot,
    rent: rent,
    fit: fit,
    state: function () {
      return {
        rooms: S.rooms.map(function (r) {
          return { use: r.use, price: r.price, desk: !!r.site, door: !!r.door, beds: r.beds.length, floor: r.floor,
            number: r.number, clerk: alive(r.clerk), active: !!(CBZ.surv && r.A === CBZ.surv.arena) };
        }),
        rented: !!S.rent, sleeping: S.sleeping, trespass: !!S.tres,
        beds: CBZ.propBeds ? CBZ.propBeds.length : 0,
      };
    },
  };
})();

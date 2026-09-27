/* ============================================================
   city/carseats.js — THE ONE SEAT MODEL.

   OWNER: "if we have multiplayer in the future we can just open any door and
   sit in that seat, with two seats and six seats as well."

   Before this file there were FOUR seat lists and they disagreed:
     • playercars.js dressCabin built two front seats + one bench and
       published seatX / seatZ / rearSeatZ;
     • vehicles.js OCC_SLOTS put the NPC DRIVER at -X (the car's right) while
       the player drove from +X (the car's left) — every ambient driver sat
       in the passenger seat, mirror image of the wheel;
     • boarding.js carSeats derived driver/shotgun/rearL/rearR again;
     • passengerseat.js knew one other seat, "shotgun", as a sign flip.
   A six-seat SUV could not exist, because nobody owned the idea of a seat.

   NOW: a seat is DATA, computed once from the cabin box, and everybody reads
   it. Frame = the car visual's local frame: +Z forward, +X the car's LEFT
   (LHD: the driver sits at +X), y up from the ground.

     CBZ.carSeats.layout(cab, kind) -> { kind, rows, seats[], doors[], drive }
        PURE (no THREE, no CBZ) so node can check it. `cab` is dressCabin's
        own input contract: { cabW, zR, zF, zTR?, zTF?, roofW?, beltY, roofY,
        floorY }. `drive` is the driving position (dash, wheel, eye) that
        dressCabin builds the furniture around — one derivation, not two.

     seat = { id, row, col "L"|"C"|"R", side +1|0|-1, x, z, cushionY, w,
              bench, isDriver, eye{x,y,z}, roofY, doors[ids] }
       ids: driver, shotgun, frontC · rearL, rearR, rearC · thirdL, thirdR,
       thirdC. The first four are the names every older caller already used.

     CBZ.carSeats.of(car)          the resolved model for a live car (seats +
                                   the REAL doors from CBZ.carDoors, or virtual
                                   ones for a body without cut doors), cached
     CBZ.carSeats.seat(car, id)
     CBZ.carSeats.door(car, id)    { id, side, row, z0, z1, x, zc, seats[] }
     CBZ.carSeats.nearestDoor(car, wx, wz, pick?)  door + the seat it serves
     OCCUPANCY (per car, `car.seatOcc = { seatId: occupant }`):
       occupant = { kind: "player"|"npc"|"remote", ref, netId?, ambient? }
       "remote" carries the net id exactly as net/netactors.js keys remote
       players (`CBZ.net.id` / actor.netId). No networking here — the shape
       is what a future seat-sync message would carry.
     CBZ.carSeats.claim / release / releaseRef / occupant / free / seatOf /
       playerSeat / list / playerOccupant / remoteOccupant
     CBZ.carSeatDebug.layout(car) / .sitPlayer(car, seatId) / .audit()
============================================================ */
(function (root) {
  "use strict";

  /* ---- KINDS ---------------------------------------------------------------
     rows: one pattern per row, "LR" two buckets, "LCR" three across.
     bench: row 0 is a bench (the middle seat is real).
     coupe: rear seats are reached through the FRONT door (one door a side).
     minPitch: the tightest row spacing we will accept before dropping a row
     (a real third row is ~0.70 m; 0.56 is knees-to-seatback). */
  const KINDS = {
    coupe2: { rows: ["LR"], coupe: true, minPitch: 0.66 },
    coupe4: { rows: ["LR", "LR"], coupe: true, minPitch: 0.52 },   // a 2+2: knees in the seatback, as real
    sedan5: { rows: ["LR", "LCR"], minPitch: 0.64 },
    suv6:   { rows: ["LR", "LR", "LR"], minPitch: 0.56 },
    suv7:   { rows: ["LR", "LCR", "LR"], minPitch: 0.56 },
    pickup6: { rows: ["LCR", "LCR"], bench: true, minPitch: 0.62 },
    van3:   { rows: ["LCR"], bench: true, minPitch: 0.66 },
    van6:   { rows: ["LCR", "LCR"], bench: true, minPitch: 0.60 },
    cab2:   { rows: ["LR"], minPitch: 0.66 },
  };
  /* Which kind a built STYLE is. playercars.js tells dressCabin the style it
     is building (makeProcedural); a body that passes `seatLayout` explicitly
     wins over this table. */
  const KIND_BY_STYLE = {
    ferrari: "coupe2", enzo: "coupe2", aventador: "coupe2", veyron: "coupe2",
    porsche: "coupe4", muscle: "coupe4", lowrider: "coupe4",
    "tesla-s": "sedan5", "tesla-3": "sedan5", "tesla-y": "sedan5", hatch: "sedan5",
    "tesla-x": "suv6", suv: "suv7",
    cybertruck: "pickup6", van: "van3", semi: "cab2",
  };
  const SEAT_IDS = [
    { L: "driver", R: "shotgun", C: "frontC" },
    { L: "rearL", R: "rearR", C: "rearC" },
    { L: "thirdL", R: "thirdR", C: "thirdC" },
  ];
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  /* A cabin nobody named: read it off the box. Long + tall is an SUV, a tall
     single-row box is a work cab, short and low is a two-seat coupe. */
  function inferKind(c) {
    const cl = Math.abs(c.zF - c.zR), gh = c.roofY - c.beltY;
    if (c.rows === 1) return (c.floorY > 0.55 || c.cabW > 1.75) ? "van3" : "coupe2";
    if (c.rows === 3) return "suv6";
    if (cl > 2.55 && c.roofY > 1.55) return "suv6";
    if (cl < 1.55 || (c.roofY < 1.22 && gh < 0.42)) return "coupe2";
    return "sedan5";
  }

  function layout(c, kindIn) {
    const cabW = c.cabW, halfW = cabW * 0.5;
    const zR = Math.min(c.zR, c.zF), zF = Math.max(c.zR, c.zF);
    const cl = Math.max(0.60, zF - zR), cz = (zR + zF) * 0.5;
    const beltY = c.beltY, roofY = c.roofY;
    const gh = Math.max(0.16, roofY - beltY);
    const zTR = c.zTR != null ? c.zTR : zR + cl * 0.20;
    const zTF = c.zTF != null ? c.zTF : zF - cl * 0.20;
    const floorY = Math.min(c.floorY, beltY - 0.26);
    const wallH = Math.max(0.14, beltY - floorY);
    const kind = KINDS[kindIn] ? kindIn : inferKind(c);
    const K = KINDS[kind];

    // ---- THE DRIVING POSITION (was dressCabin's; lives here so the seat the
    //      rig sits in and the seat the upholstery is built around are one) --
    const dashTopY = beltY + gh * 0.05;
    const dashD = 0.32, dashZ = zF - 0.14, dashFaceZ = dashZ - dashD * 0.5;
    const wheelZ = dashFaceZ - 0.13;
    const cushionY = floorY + Math.max(0.10, wallH * 0.17);
    const eyeY = Math.max(beltY + 0.06,
      Math.min(beltY + Math.max(0.14, Math.min(gh * 0.45, 0.30)), roofY - 0.17));
    // THE HIP POINT BY CLASS. A bench cab and an SUV sit you UPRIGHT (knees
    // down, a short reach), a coupe lays you back: the eye stays the cabin's,
    // the seat slides.
    const reach = kind === "coupe2" ? 0.62 : (K.bench || /^suv|^van/.test(kind)) ? 0.54 : 0.58;
    const seatZ0 = Math.max(zR + 0.34, wheelZ - reach);

    // the roof line over a point (the raked backlight lowers the rear rows)
    function roofAt(z) {
      if (z < zTR) return beltY + gh * clamp((z - zR) / Math.max(0.05, zTR - zR), 0, 1);
      if (z > zTF) return beltY + gh * clamp((zF - z) / Math.max(0.05, zF - zTF), 0, 1);
      return roofY;
    }

    // ---- ROWS: as many of the kind's rows as fit, never tighter than minPitch
    const zMin = zR + 0.30;                     // a seat back must fit behind
    const avail = Math.max(0, seatZ0 - zMin);
    let rows = K.rows.length, pitch = 0;
    while (rows > 1) {
      pitch = Math.min(0.84, avail / (rows - 1));
      if (pitch >= K.minPitch) break;
      rows--;
    }
    if (rows <= 1) pitch = 0;

    const seats = [];
    for (let r = 0; r < rows; r++) {
      const pat = K.rows[r];
      const three = pat.length === 3;
      const z = seatZ0 - pitch * r;
      // three across fills the cabin; two buckets sit on the track a real
      // car puts them; a third row tucks inboard of the wheel arches
      const w = three ? Math.min(0.54, (cabW - 0.14) / 3) : Math.min(0.50, cabW * 0.29);   // a bench's outer edge stays 5 cm off the tub wall
      const xOut = three ? w + 0.01
        : r === 0 ? Math.min(0.42, cabW * 0.24)
        : r === 1 ? Math.min(0.42, cabW * 0.23) : Math.min(0.38, cabW * 0.21);
      const lift = r === 0 ? 0 : r === 1 ? 0.02 : 0.05;          // stadium seating
      const bench = (r === 0 && !!K.bench) || (r > 0 && three);
      for (let k = 0; k < pat.length; k++) {
        const col = pat[k];
        const side = col === "L" ? 1 : col === "R" ? -1 : 0;
        const x = side * xOut;
        const sRoof = roofAt(z - 0.10);
        const cy = cushionY + lift;
        const ey = Math.max(cy + 0.40, Math.min(eyeY + lift, sRoof - 0.14));
        const doorRow = (r === 0 || K.coupe) ? "F" : "R";
        let doors;
        if (side) doors = [doorRow + col];
        else doors = r === 0 ? ["FR", "FL"] : [doorRow + "R", doorRow + "L"];   // kerb side first
        seats.push({
          id: SEAT_IDS[Math.min(r, 2)][col] + (r > 2 ? String(r) : ""),
          row: r, col: col, side: side, x: x, z: z, cushionY: cy, w: w,
          bench: bench, isDriver: r === 0 && col === "L",
          eye: { x: x, y: ey, z: z + 0.06 }, roofY: sRoof,
          doors: doors,
        });
      }
    }

    // ---- VIRTUAL DOORS: what a body without cut doors still has ------------
    // (a real body's doors come from CBZ.carDoors at runtime and replace these)
    const doors = [];
    const fz1 = Math.min(zF - 0.02, seatZ0 + 0.62), fz0 = K.coupe && rows > 1 ? Math.max(zR + 0.05, seatZ0 - pitch - 0.10) : seatZ0 - 0.20;
    ["L", "R"].forEach(function (s) {
      doors.push({ id: "F" + s, side: s === "L" ? 1 : -1, row: 0, z0: fz0, z1: fz1, virtual: true });
      if (rows > 1 && !K.coupe) {
        doors.push({ id: "R" + s, side: s === "L" ? 1 : -1, row: 1,
          z0: Math.max(zR + 0.05, seatZ0 - pitch - 0.36), z1: seatZ0 - 0.24, virtual: true });
      }
    });

    const drv = seats[0];
    return {
      kind: kind, rows: rows, rowsWanted: K.rows.length, pitch: pitch,
      coupe: !!K.coupe, seats: seats, doors: doors,
      drive: {
        cabW: cabW, halfW: halfW, zR: zR, zF: zF, cl: cl, cz: cz,
        beltY: beltY, roofY: roofY, gh: gh, zTR: zTR, zTF: zTF,
        roofW: c.roofW != null ? c.roofW : cabW * 0.86,
        floorY: floorY, wallH: wallH, dashTopY: dashTopY, dashD: dashD,
        dashZ: dashZ, dashFaceZ: dashFaceZ, wheelZ: wheelZ,
        wheelX: drv.x, wheelY: Math.max(cushionY + 0.28, dashTopY - 0.11),
        wheelR: Math.min(0.185, cabW * 0.108),
        cushionY: cushionY, eyeY: eyeY, seatZ: seatZ0, seatX: Math.abs(drv.x),
      },
    };
  }

  const API = { KINDS: KINDS, KIND_BY_STYLE: KIND_BY_STYLE, layout: layout, inferKind: inferKind };
  // node: the pure half is all a check needs
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  const CBZ = root && root.CBZ;
  if (!CBZ) return;

  // ==========================================================================
  //  RUNTIME — the model of a LIVE car
  // ==========================================================================
  function cabinOf(car) {
    if (!CBZ.carCabinInfo) return null;
    try { return CBZ.carCabinInfo(car); } catch (e) { return null; }
  }
  function styleOf(car) {
    const g = car && (car.group || car);
    return (g && g.userData && g.userData.carStyle) || null;
  }
  /* A cabin that did not publish its seats (a derived frame: the box rig, a
     registered custom group) gets them from the same layout, off the frame. */
  function seatsFromCabin(ci, car) {
    if (ci.seatLayout && ci.seatLayout.seats) return ci.seatLayout;
    const kind = KIND_BY_STYLE[styleOf(car)] || null;
    return layout({
      cabW: ci.w || 1.8, zR: ci.zRear, zF: ci.zFront, zTR: ci.zRoofRear,
      beltY: ci.beltY, roofY: ci.roofY, floorY: ci.floorY, rows: ci.rows,
    }, kind);
  }

  function resolve(car) {
    const ci = cabinOf(car);
    if (!ci) return null;
    const L = seatsFromCabin(ci, car);
    const real = CBZ.carDoors ? CBZ.carDoors(car) : null;
    const halfW = ci.doorX || (ci.w || 1.8) * 0.5;
    const doors = [];
    const src = (real && real.length) ? real : L.doors;
    for (let i = 0; i < src.length; i++) {
      const d = src[i];
      doors.push({
        id: d.id, side: d.side, row: d.row || 0, z0: d.z0, z1: d.z1,
        x: d.side * (halfW + 0.02), zc: (d.z0 + d.z1) * 0.5,
        y: ci.beltY - 0.05, virtual: !(real && real.length), seats: [],
      });
    }
    const byDoor = Object.create(null);
    for (let i = 0; i < doors.length; i++) byDoor[doors[i].id] = doors[i];
    const seats = [], byId = Object.create(null);
    for (let i = 0; i < L.seats.length; i++) {
      const s0 = L.seats[i];
      const s = Object.assign({}, s0, { eye: Object.assign({}, s0.eye) });
      // the seat's doors that EXIST on this body; a missing rear door (a
      // coupe body under a sedan layout, a van) falls to that side's front
      let ids = s0.doors.filter(function (id) { return byDoor[id]; });
      if (!ids.length) {
        const sideL = s.side > 0 ? "L" : "R";
        const alt = s.side ? ["R" + sideL, "F" + sideL] : ["RR", "RL", "FR", "FL"];
        ids = alt.filter(function (id) { return byDoor[id]; }).slice(0, s.side ? 1 : 2);
      }
      s.doors = ids;
      s.doorId = ids[0] || null;
      seats.push(s);
      byId[s.id] = s;
    }
    // a door serves its seats in the order you would climb in: this row's
    // outboard seat, this row's middle, then the row behind it
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i];
      for (let k = 0; k < s.doors.length; k++) byDoor[s.doors[k]].seats.push(s.id);
    }
    for (let i = 0; i < doors.length; i++) {
      doors[i].seats.sort(function (a, b) {
        const A = byId[a], B = byId[b];
        if (A.row !== B.row) return A.row - B.row;
        return (A.side === 0 ? 1 : 0) - (B.side === 0 ? 1 : 0);
      });
    }
    return { kind: L.kind, rows: L.rows, seats: seats, byId: byId, doors: doors, byDoor: byDoor, ci: ci };
  }
  function of(car) {
    if (!car) return null;
    const ci = cabinOf(car);
    if (!ci) return null;
    const nd = CBZ.carDoors ? ((CBZ.carDoors(car) || []).length) : 0;
    const m = car._seatModel;
    if (m && m.ci === ci && m._nd === nd) return m;
    const r = resolve(car);
    if (r) { r._nd = nd; car._seatModel = r; }
    return r;
  }
  function seat(car, id) { const m = of(car); return (m && m.byId[id]) || null; }
  function door(car, id) { const m = of(car); return (m && m.byDoor[id]) || null; }

  // ---- OCCUPANCY -----------------------------------------------------------
  function occMap(car) { return car.seatOcc || (car.seatOcc = Object.create(null)); }
  /* Is an occupant record still TRUE? A body that died, and an ambient
     traffic seat whose car is not being driven any more (parked, taken), are
     not in the chair. Cleaned lazily, so no caller has to remember to. */
  function live(car, o) {
    if (!o) return false;
    if (o.kind === "player") {
      const P = CBZ.player;
      return !!(P && !P.dead && P.driving && P._vehicle === car);
    }
    if (o.ambient) {
      const st = o.ambient;
      if (st.gone) return false;
      if (st.ped) return !st.ped.dead;
      return !!((car.ai || car.npcDriver) && !car.player && !car.dead);
    }
    if (o.ref && o.ref.dead) return false;
    return true;
  }
  function occupant(car, id) {
    if (!car || !car.seatOcc) return null;
    const o = car.seatOcc[id];
    if (!o) return null;
    if (!live(car, o)) { delete car.seatOcc[id]; return null; }
    return o;
  }
  function claim(car, id, occ) {
    if (!car || !id || !occ) return false;
    const cur = occupant(car, id);
    if (cur && cur.ref !== occ.ref && !(cur.ambient && occ.ambient && cur.ambient === occ.ambient)) return false;
    occMap(car)[id] = occ;
    return true;
  }
  function release(car, id) {
    if (!car || !car.seatOcc || !id) return false;
    const had = !!car.seatOcc[id];
    delete car.seatOcc[id];
    return had;
  }
  function releaseRef(car, ref) {
    if (!car || !car.seatOcc) return 0;
    let n = 0;
    for (const k in car.seatOcc) {
      const o = car.seatOcc[k];
      if (o && (o.ref === ref || o.ambient === ref)) { delete car.seatOcc[k]; n++; }
    }
    return n;
  }
  function seatOf(car, ref) {
    if (!car || !car.seatOcc) return null;
    for (const k in car.seatOcc) {
      const o = car.seatOcc[k];
      if (o && (o.ref === ref || o.ambient === ref) && live(car, o)) return k;
    }
    return null;
  }
  function free(car, id) { return !!seat(car, id) && !occupant(car, id); }
  function list(car) {
    const m = of(car); if (!m) return [];
    return m.seats.map(function (s) { return { id: s.id, occupant: occupant(car, s.id) }; });
  }
  function playerOccupant() {
    const net = CBZ.net;
    return { kind: "player", ref: CBZ.player || null, netId: (net && net.active && net.id) || null };
  }
  function remoteOccupant(netId, actor) {
    return { kind: "remote", ref: actor || null, netId: netId };
  }
  function playerSeat(car) {
    const P = CBZ.player;
    if (!car || !P) return null;
    const id = seatOf(car, P);
    return id ? seat(car, id) : null;
  }

  /* THE DOOR YOU ARE STANDING AT, and the seat it would put you in.
     `pick(seat, occupant)` decides whether a seat is acceptable (default: it
     is free). Returns { door, seat, d } — seat null when the door's seats are
     all taken — or null for a car with no cabin. World point in, the car's
     own frame used for the maths. */
  const _inv = [];
  function toLocal(car, wx, wz) {
    const h = car.heading || 0;
    const dx = wx - car.pos.x, dz = wz - car.pos.z;
    // local +X = (cos h, -sin h), local +Z = (sin h, cos h)
    _inv[0] = dx * Math.cos(h) - dz * Math.sin(h);
    _inv[1] = dx * Math.sin(h) + dz * Math.cos(h);
    return _inv;
  }
  function doorWorld(car, d, out) {
    const h = car.heading || 0;
    out = out || {};
    const lx = d.x, lz = d.zc;
    out.x = car.pos.x + lx * Math.cos(h) + lz * Math.sin(h);
    out.z = car.pos.z - lx * Math.sin(h) + lz * Math.cos(h);
    const gy = (car.group && car.group.position && car.group.position.y) || 0;
    out.y = gy + (d.y || 1);
    return out;
  }
  function nearestDoor(car, wx, wz, pick) {
    const m = of(car); if (!m || !m.doors.length) return null;
    const p = toLocal(car, wx, wz);
    const ok = pick || function (s, o) { return !o; };
    let best = null;
    for (let i = 0; i < m.doors.length; i++) {
      const d = m.doors[i];
      const dz = p[1] < d.z0 ? d.z0 - p[1] : p[1] > d.z1 ? p[1] - d.z1 : 0;
      const dx = p[0] - d.x;
      const dist = Math.hypot(dx, dz) + ((dx * d.side) < -0.2 ? 2.5 : 0);   // the far flank's door is behind the car
      let s = null;
      for (let k = 0; k < d.seats.length; k++) {
        const st = m.byId[d.seats[k]];
        if (ok(st, occupant(car, st.id))) { s = st; break; }
      }
      if (!best || dist < best.d) best = { door: d, seat: s, d: dist };
    }
    return best;
  }

  CBZ.carSeats = {
    KINDS: KINDS, KIND_BY_STYLE: KIND_BY_STYLE, layout: layout,
    of: of, seat: seat, door: door, nearestDoor: nearestDoor, doorWorld: doorWorld,
    occupant: occupant, claim: claim, release: release, releaseRef: releaseRef,
    free: free, seatOf: seatOf, list: list, playerSeat: playerSeat,
    playerOccupant: playerOccupant, remoteOccupant: remoteOccupant,
    invalidate: function (car) { if (car) car._seatModel = null; },
  };

  // ==========================================================================
  //  DEBUG — the showcase capture seats the player anywhere, instantly.
  // ==========================================================================
  CBZ.carSeatDebug = {
    layout: function (car) {
      const m = of(car); if (!m) return null;
      return {
        kind: m.kind, rows: m.rows,
        seats: m.seats.map(function (s) {
          const o = occupant(car, s.id);
          return { id: s.id, row: s.row, col: s.col, x: +s.x.toFixed(3), z: +s.z.toFixed(3),
            cushionY: +s.cushionY.toFixed(3), eyeY: +s.eye.y.toFixed(3), doors: s.doors.slice(),
            isDriver: s.isDriver, occupant: o ? o.kind + (o.ambient ? ":ambient" : "") : null };
        }),
        doors: m.doors.map(function (d) { return { id: d.id, virtual: d.virtual, seats: d.seats.slice() }; }),
      };
    },
    /* Seat the player in `seatId` NOW: no walk, no door. A driver's seat
       takes the car (a crewed car's people answer the jack first); any other
       seat of a car somebody is driving is a RIDE, and of an empty car is the
       passenger seat with nobody at the wheel. */
    sitPlayer: function (car, seatId) {
      const P = CBZ.player;
      if (!car || !P) return false;
      const s = seat(car, seatId || "driver");
      if (!s) return false;
      if (P.driving && P._vehicle && CBZ.cityExitVehicle) { try { CBZ.cityExitVehicle(); } catch (e) {} }
      if (s.isDriver) return !!(CBZ.cityEnterVehicle && CBZ.cityEnterVehicle(car, { instant: true }));
      if (CBZ.cityRideVehicle && CBZ.carNpcDriven && CBZ.carNpcDriven(car)) return !!CBZ.cityRideVehicle(car, s.id);
      if (!(CBZ.cityEnterVehicle && CBZ.cityEnterVehicle(car, { instant: true }))) return false;
      return !!(CBZ.citySeatShift && CBZ.citySeatShift({ to: s.id, quiet: true }));
    },
    audit: function () {
      const out = { cars: 0, seats: 0, occupied: 0, byKind: {} };
      const cars = CBZ.cityCars || [];
      for (let i = 0; i < cars.length; i++) {
        const m = cars[i] && cars[i].group ? of(cars[i]) : null;
        if (!m) continue;
        out.cars++; out.seats += m.seats.length;
        out.byKind[m.kind] = (out.byKind[m.kind] || 0) + 1;
        for (let k = 0; k < m.seats.length; k++) if (occupant(cars[i], m.seats[k].id)) out.occupied++;
      }
      return out;
    },
  };
})(typeof window !== "undefined" ? window : null);

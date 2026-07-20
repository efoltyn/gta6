/* ============================================================
   city/interior_programs.js — THE INTERIOR ARCHETYPE KIT (intentionality
   doctrine, owner mandate).

   OWNER (verbatim intent): "a lot of interiors should be empty. I love the
   idea of an interior that's just desks and computers — chairs and a bunch
   of AIs sitting there, doing something. Some offices have random walls —
   if that's not what someone designed, things should be intentional. It
   should be empty, or it should be designed, or it should be a dystopian
   feeling — intentionally monotonous design. I don't want things designed
   because they have to be. I want them designed right."

   So every generated interior is ONE of:
     (a) INTENTIONALLY EMPTY — a clean lit shell. Floor, walls, windows,
         light. Nothing else. (Most interiors.)
     (b) A DESIGNED PROGRAM — one legible purpose executed consistently:
         "deskfarm" (ordered rows of identical desks + terminals + chairs,
         with REAL seated peds working them), "meeting" (one room, one
         table, space), "storage" (uniform rack rows), "lobby" (one front
         desk facing the door + a waiting row).
     (c) INTENTIONALLY MONOTONOUS — (b) at scale with ZERO variation:
         identical floors of identical rows. Callers get (c) for free —
         every program is a pure function of (room, host origin), so the
         same program on every storey repeats EXACTLY. Repetition here is
         the point, not a bug: one palette, one pitch, one facing.

   This file is the REUSABLE kit, not the policy. buildings.js decides WHICH
   tower gets WHICH archetype (its per-building hash); bunkers or any other
   structure builder can feed the same programs a minimal host object. No
   HUD, no popups, no colliders — pure room dressing + seat anchors.

   API:
     CBZ.interiorProgram(name, room, ctx) -> { anchors: [...] } | null
       name : "empty" | "deskfarm" | "meeting" | "storage" | "lobby"
       room : { x0, x1, z0, z1, y }  (host-LOCAL rect + floor lift)
       ctx  : { b, opts } — b is ANY host exposing:
                lbox(lx,ly,lz,w,h,d,color,opts)    REQUIRED (batch-safe box)
                clearFloorPoint(lx,lz,pad)->bool   optional aisle/stair gate
                ox, oz (world origin, default 0);  FH (storey height, 3.2)
              opts per program (lobby: {door:{x,z,nx,nz} host-local}).
       Anchors come back in WORLD coords ({x,y,z,face} — the peds facing
       convention) with lx/lz riding along so callers can convert to
       host-local population seats without re-deriving.

     CBZ.interiorStaff(id, root, seats, opts) -> nSeated
       Seat REAL city peds at desks via npclife's population layer (the
       seated-passenger grammar: attached rigs at true floor height,
       char.sitting, incremental fill, recreated after city resets, detach
       on death). seats are ROOT-LOCAL {x,y,z,yaw}. Citywide budget cap:
       CBZ.CONFIG.INTERIOR_STAFF_MAX. Feature-detected — without npclife
       the interiors stay furnished, just unstaffed. Deterministic seat
       LISTS come from the caller; the bodies themselves are runtime sim
       (Math.random identity, the npclife spawn convention).

   DRAW-CALL DISCIPLINE: every piece is an opaque cast:false box with no
   userData and no collider — exactly what core/batch.js folds into its
   per-colour merged buckets, so a whole desk-farm tower adds ≈0 draw
   calls. The palette deliberately REUSES the existing furnisher colour
   buckets (office desk/worktop/bezel/chair hexes) so no new buckets are
   minted. DETERMINISM: no Math.random, no shared rng() streams — geometry
   depends only on the room rect + CBZ.hash01 position hashes.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  // ---- the ONE palette (existing colour buckets; constant everywhere —
  // uniformity across every program floor IS the dystopian read) ----------
  const P = {
    floor: 0x33373f,      // tinted floor covering (apartment-floor bucket)
    light: 0xeef2ff,      // cool office ceiling strip (office bucket)
    desk: 0x55606e,       // desk/rack body (counter bucket)
    worktop: 0xc9ccd2,    // pale worktop (office bucket)
    bezel: 0x14181e,      // monitor/screen bezel (office bucket)
    screen: 0x9fb0c4,     // opaque lit-panel tint (office bucket, batch-safe)
    chair: 0x2a2f37,      // chair/bench (office bucket)
    wall: 0xb9bcc4,       // thin partition (roomKit PCOL bucket)
    table: 0x3a2b1e,      // meeting table (DARKWOOD bucket)
    shelf: 0x8a939c,      // rack shelf lines (shelf-top bucket)
    glow: 0x39516a,       // wall-screen glow (screen bucket)
    planter: 0x2e2620, leaf: 0x3f9a4f,
  };
  const PWT = 0.16;       // thin partition thickness (roomKit idiom)

  // host accessors — a buildings.js `b` satisfies this natively; other
  // builders pass any object with the same three-to-six fields.
  function host(ctx) {
    const b = ctx && ctx.b;
    if (!b || typeof b.lbox !== "function") return null;
    return {
      b: b,
      ox: b.ox != null ? b.ox : 0,
      oz: b.oz != null ? b.oz : 0,
      fh: b.FH != null ? b.FH : 3.2,
      clear: function (x, z, pad) {
        return !b.clearFloorPoint || b.clearFloorPoint(x, z, pad == null ? 0.7 : pad);
      },
    };
  }
  function cx(r) { return (r.x0 + r.x1) / 2; }
  function cz(r) { return (r.z0 + r.z1) / 2; }

  // ---- the SHELL every program starts from: floor + light. This alone IS
  // the "empty" archetype — a clean, finished, lit room with nothing in it.
  // Ground floors (y≈0) lift the covering to clear the 0.14-top foundation
  // slab the building shells pour; upper floors use the standard 0.02 lift.
  function shell(h, r) {
    const w = Math.max(1, r.x1 - r.x0), d = Math.max(1, r.z1 - r.z0);
    const fy = r.y < 0.1 ? r.y + 0.13 : r.y + 0.02;
    h.b.lbox(cx(r), fy, cz(r), w, 0.04, d, P.floor, { cast: false });
    h.b.lbox(cx(r), r.y + h.fh - 0.24, cz(r), Math.min(w * 0.6, 8.0), 0.08, 0.5, P.light,
      { emissive: P.light, ei: 0.32, cast: false });
  }
  // rect containment — programs that place relative to a DOOR (lobby) can
  // aim outside a small plate; hosts without clearFloorPoint get no bounds
  // check for free, so the kit carries its own.
  function inRect(r, x, z, m) { return x > r.x0 + m && x < r.x1 - m && z > r.z0 + m && z < r.z1 - m; }

  // a thin partition along X at fixed z with ONE centred doorway + lintel —
  // the only wall the kit ever draws, and it is always THE design (a room
  // boundary), never scatter. Batch-safe, non-collider (roomKit idiom).
  function wallX(h, y, z, x0, x1, gapX, gapW, wallH) {
    gapW = gapW || 1.8;
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    const segs = (gapX > lo && gapX < hi) ? [[lo, gapX - gapW / 2], [gapX + gapW / 2, hi]] : [[lo, hi]];
    for (let i = 0; i < segs.length; i++) {
      const s0 = segs[i][0], s1 = segs[i][1];
      if (s1 - s0 < 0.2) continue;
      h.b.lbox((s0 + s1) / 2, y + wallH / 2, z, s1 - s0, wallH, PWT, P.wall, { cast: false });
    }
    if (gapX > lo && gapX < hi)
      h.b.lbox(gapX, y + wallH - 0.18, z, gapW, 0.36, PWT, P.wall, { cast: false });
  }
  // the same partition running along Z at fixed x (the ±x-door twin).
  function wallZ(h, y, x, z0, z1, gapZ, gapW, wallH) {
    gapW = gapW || 1.8;
    const lo = Math.min(z0, z1), hi = Math.max(z0, z1);
    const segs = (gapZ > lo && gapZ < hi) ? [[lo, gapZ - gapW / 2], [gapZ + gapW / 2, hi]] : [[lo, hi]];
    for (let i = 0; i < segs.length; i++) {
      const s0 = segs[i][0], s1 = segs[i][1];
      if (s1 - s0 < 0.2) continue;
      h.b.lbox(x, y + wallH / 2, (s0 + s1) / 2, PWT, wallH, s1 - s0, P.wall, { cast: false });
    }
    if (gapZ > lo && gapZ < hi)
      h.b.lbox(x, y + wallH - 0.18, gapZ, PWT, 0.36, gapW, P.wall, { cast: false });
  }

  function seatReg(h, x, y, z, face, kind) {
    if (CBZ.propRegisterSeat) CBZ.propRegisterSeat(h.ox + x, y, h.oz + z, face, kind, null);
  }

  // ========================================================================
  //  (a) EMPTY — floor, walls, windows, light. Nothing else.
  // ========================================================================
  function progEmpty(r, h) { shell(h, r); return { anchors: [] }; }

  // ========================================================================
  //  (b/c) DESK-FARM — the flagship. Ordered rows of IDENTICAL desks +
  //  terminals + chairs on a fixed pitch, grid centred in the room, every
  //  chair on the same side, every worker facing the same way (-z). The
  //  station is byte-for-byte the office furnisher's proven 8-box desk, so
  //  it lands in the exact colour buckets the batcher already merges.
  //  Returns one seat anchor per landed desk (world coords, face=π).
  // ========================================================================
  const PITCH_X = 3.0, PITCH_Z = 2.6;
  function progDeskFarm(r, h) {
    shell(h, r);
    const anchors = [];
    let feedReg = 0;              // CCTV: cap live-feed monitor faces per floor (city/cctv.js)
    const y = r.y;
    const spanX = (r.x1 - r.x0) - 2.0, spanZ = (r.z1 - r.z0) - 2.8;
    if (spanX < 0.5 || spanZ < 0.5) return { anchors: anchors };
    const cols = Math.max(1, 1 + Math.floor(spanX / PITCH_X));
    const rows = Math.max(1, 1 + Math.floor(spanZ / PITCH_Z));
    const gx0 = cx(r) - ((cols - 1) * PITCH_X) / 2;
    const gz0 = cz(r) - ((rows - 1) * PITCH_Z) / 2 - 0.3;   // station reaches +1.15 (chair side)
    for (let c = 0; c < cols; c++) for (let w = 0; w < rows; w++) {
      const dx = gx0 + c * PITCH_X, dz = gz0 + w * PITCH_Z;
      const seatZ = dz + 0.85, monZ = dz - 0.42;
      // gate BOTH the chair and the desk body — the door aisle / stair strip /
      // elevator chase punch clean holes in the grid, nothing else does.
      if (!h.clear(dx, seatZ, 0.6) || !h.clear(dx, dz, 0.7)) continue;
      h.b.lbox(dx, y + 0.36, dz, 1.5, 0.66, 0.85, P.desk, { cast: false });        // desk pedestal
      h.b.lbox(dx, y + 0.72, dz, 1.62, 0.08, 0.95, P.worktop, { cast: false });    // worktop
      h.b.lbox(dx, y + 1.02, monZ, 0.7, 0.46, 0.06, P.bezel, { cast: false });     // monitor
      h.b.lbox(dx, y + 1.04, monZ + 0.04, 0.58, 0.36, 0.02, P.screen, { cast: false }); // lit face
      h.b.lbox(dx, y + 0.74, monZ, 0.12, 0.12, 0.12, P.bezel, { cast: false });    // stand
      h.b.lbox(dx, y + 0.42, seatZ, 0.6, 0.12, 0.6, P.chair, { cast: false });     // seat pad
      h.b.lbox(dx, y + 0.78, seatZ + 0.26, 0.6, 0.7, 0.12, P.chair, { cast: false }); // backrest
      h.b.lbox(dx, y + 0.2, seatZ, 0.1, 0.4, 0.1, P.bezel, { cast: false });       // post
      anchors.push({ x: h.ox + dx, y: y, z: h.oz + seatZ, face: Math.PI, lx: dx, lz: seatZ });
      // CCTV: a bounded few of these terminals show a live camera feed. The lit
      // face sits at world (h.ox+dx, y+1.04, h.oz+monZ+0.04) looking +z at the
      // seat, so the outward screen normal is (0,1). Runtime-visual only.
      if (feedReg < 3 && CBZ.cctvAddScreen) { CBZ.cctvAddScreen(h.ox + dx, y + 1.04, h.oz + monZ + 0.04, 0, 1); feedReg++; }
    }
    return { anchors: anchors };
  }

  // ========================================================================
  //  (b) MEETING — ONE room, one table, chairs, a wall screen, and SPACE.
  //  The room is the half of the plate FURTHEST from the door, behind ONE
  //  full-span divider whose doorway sits on the door's own approach line:
  //  you enter, cross the open half, pass through the portal. The wall IS
  //  the design — one line, one gap, aligned to the way you arrive — and it
  //  can never cut across the walk-in. opts.door orients it ({x,z,nx,nz},
  //  host-local; default: entry from -z); opts.divider:false skips the wall
  //  for hosts whose room is already walled.
  // ========================================================================
  function progMeeting(r, h, opts) {
    shell(h, r);
    const anchors = [];
    const y = r.y, wallH = h.fh - 0.1;
    const din = (opts && opts.door) || { x: cx(r), z: r.z0, nx: 0, nz: 1 };
    const alongX = Math.abs(din.nx) > 0.5;              // door on a ±x wall → depth runs along x
    let room;
    if (!alongX) {
      const zc2 = cz(r);
      room = din.nz > 0 ? { x0: r.x0, x1: r.x1, z0: zc2, z1: r.z1 } : { x0: r.x0, x1: r.x1, z0: r.z0, z1: zc2 };
      if (room.z1 - room.z0 < 3.4) return { anchors: anchors };   // too shallow — stay a shell
      const gapAt = Math.min(Math.max(din.x, r.x0 + 1.2), r.x1 - 1.2);
      if (!opts || opts.divider !== false) wallX(h, y, zc2, r.x0, r.x1, gapAt, 1.8, wallH);
    } else {
      const xc2 = cx(r);
      room = din.nx > 0 ? { x0: xc2, x1: r.x1, z0: r.z0, z1: r.z1 } : { x0: r.x0, x1: xc2, z0: r.z0, z1: r.z1 };
      if (room.x1 - room.x0 < 3.4) return { anchors: anchors };
      const gapAt = Math.min(Math.max(din.z, r.z0 + 1.2), r.z1 - 1.2);
      if (!opts || opts.divider !== false) wallZ(h, y, xc2, r.z0, r.z1, gapAt, 1.8, wallH);
    }
    const mx2 = (room.x0 + room.x1) / 2, mz2 = (room.z0 + room.z1) / 2;
    if (!h.clear(mx2, mz2, 1.0)) return { anchors: anchors };     // core/shaft owns the centre — an empty room is still a room
    // ONE long table, its long axis ACROSS the approach (the exec-suite read)
    const tanSpan = alongX ? (room.z1 - room.z0) : (room.x1 - room.x0);
    const TL = Math.max(2.2, Math.min(4.6, tanSpan - 3.0));
    const tb = function (across, hh, deep, ly, c) {
      h.b.lbox(mx2, y + ly, mz2, alongX ? deep : across, hh, alongX ? across : deep, c, { cast: false });
    };
    tb(TL, 0.1, 1.3, 0.48, P.table);                              // top
    tb(Math.max(0.6, TL - 1.4), 0.42, 0.5, 0.24, P.table);        // spine base
    // chairs: three a side + one at each end, every one facing the table
    for (let i = -1; i <= 1; i++) for (let s = -1; s <= 1; s += 2) {
      const lat = i * (TL / 2 - 0.7), off = s * 1.05;
      const qx = alongX ? mx2 + off : mx2 + lat;
      const qz = alongX ? mz2 + lat : mz2 + off;
      if (!h.clear(qx, qz, 0.5)) continue;
      h.b.lbox(qx, y + 0.42, qz, 0.5, 0.14, 0.5, P.chair, { cast: false });
      h.b.lbox(qx + (alongX ? s * 0.24 : 0), y + 0.8, qz + (alongX ? 0 : s * 0.24),
        alongX ? 0.12 : 0.5, 0.6, alongX ? 0.5 : 0.12, P.chair, { cast: false });
      seatReg(h, qx, y, qz, Math.atan2(mx2 - qx, mz2 - qz), "chair");
    }
    for (let e = -1; e <= 1; e += 2) {
      const lat = e * (TL / 2 + 0.75);
      const qx = alongX ? mx2 : mx2 + lat;
      const qz = alongX ? mz2 + lat : mz2;
      if (!h.clear(qx, qz, 0.5)) continue;
      h.b.lbox(qx, y + 0.42, qz, 0.5, 0.14, 0.5, P.chair, { cast: false });
      h.b.lbox(qx + (alongX ? 0 : e * 0.24), y + 0.8, qz + (alongX ? e * 0.24 : 0),
        alongX ? 0.5 : 0.12, 0.6, alongX ? 0.12 : 0.5, P.chair, { cast: false });
      seatReg(h, qx, y, qz, Math.atan2(mx2 - qx, mz2 - qz), "chair");
    }
    // one wall screen on the FAR wall (glow proud of the bezel, toward the
    // room) + one light line over the table
    const fx = alongX ? (din.nx > 0 ? room.x1 - 0.3 : room.x0 + 0.3) : mx2;
    const fz = alongX ? mz2 : (din.nz > 0 ? room.z1 - 0.3 : room.z0 + 0.3);
    h.b.lbox(fx, y + 1.62, fz, alongX ? 0.08 : 2.3, 1.15, alongX ? 2.3 : 0.08, P.bezel, { cast: false });
    h.b.lbox(alongX ? fx - Math.sign(din.nx) * 0.04 : fx, y + 1.62, alongX ? fz : fz - Math.sign(din.nz) * 0.04,
      alongX ? 0.04 : 2.0, 0.9, alongX ? 2.0 : 0.04, P.glow, { emissive: P.glow, ei: 0.4, cast: false });
    h.b.lbox(mx2, y + h.fh - 0.28, mz2, alongX ? 0.34 : TL * 0.8, 0.06, alongX ? TL * 0.8 : 0.34, P.light,
      { emissive: P.light, ei: 0.3, cast: false });
    return { anchors: anchors };
  }

  // ========================================================================
  //  (b/c) STORAGE — uniform rack rows on a fixed pitch, identical heights,
  //  identical shelf lines. An archive floor: monotony executed cleanly.
  // ========================================================================
  const RACK_PITCH = 2.6, RACK_SEG = 2.2, RACK_GAP = 0.5, RACK_H = 2.2;
  function progStorage(r, h) {
    shell(h, r);
    const y = r.y;
    const spanX = (r.x1 - r.x0) - 2.0;
    if (spanX < 0.5) return { anchors: [] };
    const runs = Math.max(1, 1 + Math.floor(spanX / RACK_PITCH));
    const rx0 = cx(r) - ((runs - 1) * RACK_PITCH) / 2;
    for (let i = 0; i < runs; i++) {
      const x = rx0 + i * RACK_PITCH;
      for (let z = r.z0 + 1.2; z + RACK_SEG <= r.z1 - 1.0; z += RACK_SEG + RACK_GAP) {
        const zc2 = z + RACK_SEG / 2;
        if (!h.clear(x, zc2, 0.8)) continue;                       // aisles/stairs punch clean gaps
        h.b.lbox(x, y + RACK_H / 2, zc2, 0.6, RACK_H, RACK_SEG, P.desk, { cast: false });   // rack body
        h.b.lbox(x, y + 0.8, zc2, 0.66, 0.06, RACK_SEG + 0.06, P.shelf, { cast: false });   // shelf line
        h.b.lbox(x, y + 1.5, zc2, 0.66, 0.06, RACK_SEG + 0.06, P.shelf, { cast: false });   // shelf line
        h.b.lbox(x, y + RACK_H + 0.03, zc2, 0.66, 0.06, RACK_SEG + 0.06, P.shelf, { cast: false }); // cap
      }
    }
    return { anchors: [] };
  }

  // ========================================================================
  //  (b) LOBBY — one front desk squarely facing the door, one waiting row,
  //  two planters, a lit name band. The rest of the arrival floor is open.
  //  opts.door = {x,z,nx,nz} (host-local doorway + INWARD normal). Returns
  //  ONE anchor: the receptionist's chair (facing the door).
  // ========================================================================
  function progLobby(r, h, opts) {
    shell(h, r);
    const anchors = [];
    const din = opts && opts.door;
    if (!din || din.nx == null) return { anchors: anchors };
    const y = r.y, nx = din.nx, nz = din.nz, tx = -nz, tz = nx;
    const along = Math.abs(nx) > 0.5;                 // door faces ±x → depth runs along x
    const at = function (inD, lat) { return { x: din.x + nx * inD + tx * lat, z: din.z + nz * inD + tz * lat }; };
    const obox = function (p, ly, across, hh, deep, c, o) {
      h.b.lbox(p.x, y + ly, p.z, along ? deep : across, hh, along ? across : deep, c, o || { cast: false });
    };
    const depth = along ? (r.x1 - r.x0) : (r.z1 - r.z0);
    const dIn = Math.min(6.0, Math.max(5.2, depth * 0.45));   // desk sits past the door aisle (aisle ends 4.8 in)
    // THE DESK — one long front desk square to the door
    const pd = at(dIn, 0);
    if (inRect(r, pd.x, pd.z, 1.2) && h.clear(pd.x, pd.z, 0.9)) {
      obox(pd, 0.5, 2.6, 0.92, 0.9, P.desk);
      obox(pd, 0.99, 2.8, 0.07, 1.05, P.worktop);
      // the receptionist chair behind the desk, facing the door
      const pc = at(dIn + 0.95, 0);
      obox(pc, 0.42, 0.56, 0.14, 0.56, P.chair);
      obox(at(dIn + 1.2, 0), 0.78, 0.56, 0.62, 0.12, P.chair);
      const yaw = Math.atan2(-nx, -nz);               // look back out the door
      anchors.push({ x: h.ox + pc.x, y: y, z: h.oz + pc.z, face: yaw, lx: pc.x, lz: pc.z });
      // the lit name band floating behind the desk
      const pb = at(dIn + 1.7, 0);
      h.b.lbox(pb.x, y + 2.35, pb.z, along ? 0.07 : 2.8, 0.5, along ? 2.8 : 0.07, P.light,
        { emissive: P.light, ei: 0.35, cast: false });
    }
    // ONE waiting row — three seats, off the walk line, facing it
    const pbn = at(Math.min(dIn - 0.6, 4.6), -3.1);
    if (inRect(r, pbn.x, pbn.z, 1.0) && h.clear(pbn.x, pbn.z, 0.8)) {
      obox(pbn, 0.36, 2.2, 0.16, 0.7, P.chair);                        // bench
      obox(at(Math.min(dIn - 0.6, 4.6), -3.36), 0.72, 2.2, 0.6, 0.14, P.chair);  // backrest
      const fy = Math.atan2(tx, tz);                  // face across the walk (+tangent)
      for (let s = -1; s <= 1; s++) {
        const ps = at(Math.min(dIn - 0.6, 4.6) + s * 0.8, -3.1);
        seatReg(h, ps.x, y, ps.z, fy, "waiting");
      }
    }
    // two planters flanking the walk, just inside the door
    for (let s = -1; s <= 1; s += 2) {
      const pp = at(2.0, s * 2.6);
      if (!inRect(r, pp.x, pp.z, 0.5) || !h.clear(pp.x, pp.z, 0.7)) continue;
      obox(pp, 0.3, 0.6, 0.6, 0.6, P.planter);
      obox(pp, 0.95, 0.7, 0.7, 0.7, P.leaf);
    }
    return { anchors: anchors };
  }

  // ---- dispatch -----------------------------------------------------------
  const PROGRAMS = { empty: progEmpty, deskfarm: progDeskFarm, meeting: progMeeting, storage: progStorage, lobby: progLobby };
  CBZ.interiorProgram = function (name, room, ctx) {
    const h = host(ctx);
    const fn = PROGRAMS[name];
    if (!h || !fn || !room) return null;
    if (!(room.x1 - room.x0 > 2) || !(room.z1 - room.z0 > 2)) return null;   // degenerate plate
    const r = { x0: room.x0, x1: room.x1, z0: room.z0, z1: room.z1, y: room.y || 0 };
    return fn(r, h, (ctx && ctx.opts) || null);
  };
  CBZ.interiorProgramNames = ["empty", "deskfarm", "meeting", "storage", "lobby"];

  // ========================================================================
  //  THE WORKERS — real peds seated at the desks, DOING something.
  //  npclife's population layer is the whole mechanism (the aircraft-cabin /
  //  venue-spectator grammar): each seat is a persistent authored entry;
  //  the layer spawns/claims a REAL city ped, attaches the rig to the
  //  building group at true floor height, holds char.sitting, survives city
  //  resets, and detaches cleanly on death — so every clerk is hittable,
  //  lootable, mournable. char.typing makes the seated pose visibly WORK
  //  (character.js's tap loop). Citywide budget cap keeps the roster honest.
  // ========================================================================
  const ledger = [];        // [{id, root, n}] — live staffing spend per host
  let profiled = false;
  function ensureProfile() {
    if (profiled || !CBZ.npcLife || !CBZ.npcLife.define) return;
    profiled = true;
    CBZ.npcLife.define("interiorClerk", {
      actor: { kind: "worker", archetype: "worker", job: "office worker", aggr: 0.1, armed: false, weapon: null },
      life: { initialState: "sit", stationary: true, workPost: true },
    });
  }
  function clerkConfigure(a) {
    if (!a) return;
    a._interiorStaff = true;
    if (a.char) a.char.typing = true;    // the idle-work loop (character.js)
  }
  // a root only counts against the budget while it is still CONNECTED to the
  // live scene — a torn-down city's building groups keep their local parent
  // chain, so a bare .parent check would let dead towers starve the cap forever.
  function rootLive(o) {
    let hops = 0;
    while (o && hops++ < 64) { if (o === CBZ.scene) return true; o = o.parent; }
    return false;
  }
  CBZ.interiorStaff = function (id, root, seats, opts) {
    if (!id || !root || !seats || !seats.length) return 0;
    const NL = CBZ.npcLife;
    if (!NL || !NL.definePopulation) return 0;
    ensureProfile();
    // budget: drop ledger rows for dead roots (old city) or a re-define of
    // this id (definePopulation replaces the old cast), then spend what's left.
    for (let i = ledger.length - 1; i >= 0; i--) {
      const e = ledger[i];
      if (e.id === id || !e.root || !rootLive(e.root)) ledger.splice(i, 1);
    }
    let used = 0;
    for (let i = 0; i < ledger.length; i++) used += ledger[i].n;
    const MAX = (CBZ.CONFIG && CBZ.CONFIG.INTERIOR_STAFF_MAX != null) ? CBZ.CONFIG.INTERIOR_STAFF_MAX : 48;
    const take = Math.max(0, Math.min(seats.length, MAX - used));
    if (!take) return 0;
    const entries = [];
    for (let i = 0; i < take; i++) {
      const s = seats[i];
      entries.push({
        profile: "interiorClerk",
        placement: { anchor: { x: s.x, y: s.y || 0, z: s.z, yaw: s.yaw || 0, pose: "sit", state: "sit" } },
        overrides: (opts && opts.overrides) || null,
        configure: clerkConfigure,
      });
    }
    NL.definePopulation(id, { root: root, entries: entries });
    ledger.push({ id: id, root: root, n: take });
    return take;
  };
})();

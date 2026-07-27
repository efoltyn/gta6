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
    // --- the OCCUPIED-STRUCTURE additions (checkpoint + boss suite). Every
    // hex below is an EXISTING city bucket (sandbag/crate/rug/upholstery
    // colours already minted by the street clutter + apartment furnishers),
    // so no new batch bucket is created by either new program.
    sack: 0x6b6350,       // sandbag / filled sack (clutter bucket)
    crate: 0x6d5a3c,      // shipping crate (clutter bucket)
    steel: 0x39414c,      // locker / rack steel (elevators STEEL bucket)
    lamp: 0xffd9a0,       // warm domestic lamp (interiorlight warm bucket)
    flood: 0xffe9b8,      // hard white worklight (streetlamp bucket)
    rug: 0x6b2f2c,        // deep red rug (apartment bucket)
    sofa: 0x3d4650,       // upholstery (apartment bucket)
    wood: 0x4a3524,       // warm wood (DARKWOOD lighter step)
    marble: 0xd9d5cc,     // pale stone worktop (civic bucket)
    water: 0x2e6f86,      // aquarium water (waterfield bucket)
    gold: 0xb99347,       // brass trim / picture frames (trim bucket)
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
  // `dark` drops the ceiling strip: an UNLIT storey in a lit tower, which is a
  // deliberate read from the street and the one variant that must be per-FLOOR.
  function shell(h, r, dark) {
    const w = Math.max(1, r.x1 - r.x0), d = Math.max(1, r.z1 - r.z0);
    const fy = r.y < 0.1 ? r.y + 0.13 : r.y + 0.02;
    h.b.lbox(cx(r), fy, cz(r), w, 0.04, d, P.floor, { cast: false });
    if (dark) return;
    const m = h.b.lbox(cx(r), r.y + h.fh - 0.24, cz(r), Math.min(w * 0.6, 8.0), 0.08, 0.5, P.light,
      { emissive: P.light, ei: 0.32, cast: false });
    ceilingStrip(m);
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
  //  THE INTERIOR LIGHT RAMP — INTERIOR_LIGHT_DAY.
  //
  //  Every ceiling strip in this kit is an emissive mesh, and core/batch.js
  //  refuses emissives, so each one is already its own draw call and its own
  //  material (buildings.js's `lbox` mints a fresh `CBZ.mat`, not a cached
  //  `cmat`). That makes them the one interior surface we can drive per-frame
  //  for FREE: the ramp writes `emissiveIntensity` on materials that already
  //  exist and adds no mesh, no material bucket and no draw call.
  //
  //  Shape copied from city/interiorlight.js's window glow (which does the same
  //  job for the OUTSIDE of the same glass), including its quantisation: the
  //  value is rounded to 1/40 so the sweep is a no-op on the overwhelming
  //  majority of frames and only actually writes across dusk and dawn.
  // ========================================================================
  const STRIPS = [];                    // {m: mesh, ei: authored day intensity}
  const STRIP_CAP = 4000;
  let nightApplied = -1;
  function ceilingStrip(m) {
    if (!m || !m.material || CBZ.CONFIG.INTERIOR_LIGHT_DAY === false) return m;
    if (STRIPS.length >= STRIP_CAP) return m;
    const ei = m.material.emissiveIntensity != null ? m.material.emissiveIntensity : 1;
    STRIPS.push({ m: m, ei: ei });
    return m;
  }
  // a strip only counts while it is still CONNECTED to the live scene — a torn
  // down city keeps its local parent chain, so a bare .parent check would hold
  // every dead tower's lights in the registry forever (interiorStaff's own
  // rootLive lesson, same fix).
  function stripLive(o) {
    let hops = 0;
    while (o && hops++ < 64) { if (o === CBZ.scene) return true; o = o.parent; }
    return false;
  }
  if (CBZ.onUpdate) CBZ.onUpdate(0.345, function () {
    if (CBZ.CONFIG.INTERIOR_LIGHT_DAY === false || !STRIPS.length) return;
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    const n = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
    const q = Math.round(n * 40) / 40;
    if (q === nightApplied) return;
    nightApplied = q;
    // 0.72x at noon (daylight through the glass swamps a ceiling strip and a
    // full-strength one reads as a light box) up to 1.28x at midnight.
    const k = 0.72 + 0.56 * q;
    for (let i = STRIPS.length - 1; i >= 0; i--) {
      const s = STRIPS[i];
      if (!s.m || !s.m.material || !stripLive(s.m)) { STRIPS.splice(i, 1); continue; }
      s.m.material.emissiveIntensity = s.ei * k;
    }
  });

  // ========================================================================
  //  (a) EMPTY — INTENTIONALLY empty, and that is owner doctrine ("it should
  //  be empty, OR it should be designed"). What was NOT doctrine was that
  //  every empty floor in the world was the IDENTICAL shell — one slab, one
  //  strip, the same hex, fifty times over — which does not read as a choice,
  //  it reads as nobody having made one.
  //
  //  So `empty` keeps its RATIO (buildings.js still rolls 46% of office towers
  //  into it; nothing here changes that) and gains a VOCABULARY: four dressed
  //  reads picked per BUILDING — so a tower is still ONE thing all the way up,
  //  which is the monotony doctrine — plus a DARK storey, which is the one
  //  variant that must vary per floor because its whole read is an unlit floor
  //  in a lit tower seen from the street.
  //
  //    bare        the clean shell (what every empty used to be)
  //    renovation  tarps, a ladder, paint tins, one wall half-repainted
  //    moveout     stacked cartons and one chair somebody left behind
  //    afterhours  two desks, a tipped chair, one monitor still on
  //
  //  BUDGET: every variant is opaque cast:false boxes from the palette above
  //  (no new hex, no new bucket, no collider, no userData → core/batch.js folds
  //  them), ≤16 boxes, and AT MOST ONE extra emissive accent. The abandoned
  //  chair is a REAL CBZ.furnish.chair so it is sittable — an empty room with a
  //  decoy chair in it would be a worse lie than an empty room.
  // ========================================================================
  // bare stays the plurality: most empty is still just empty. The cumulative
  // band is the table so the ratio is readable in one line and cannot drift
  // from the names beside it.
  const EMPTY_KINDS = ["bare", "renovation", "moveout", "afterhours"];
  const EMPTY_CUM = [0.42, 0.66, 0.85, 1.01];
  function emptyVariant(h) {
    if (CBZ.CONFIG.INTERIOR_EMPTY_VARIETY === false || !CBZ.hash01) return EMPTY_KINDS[0];
    const v = CBZ.hash01(h.ox, h.oz, 0x0E11);
    for (let i = 0; i < EMPTY_CUM.length; i++) if (v < EMPTY_CUM[i]) return EMPTY_KINDS[i];
    return EMPTY_KINDS[0];
  }
  function floorIndexOf(r, h) { return Math.max(0, Math.round((r.y - 0.14) / Math.max(0.5, h.fh))); }

  // the live tally of which empty read each floor actually got — the evidence
  // for CBZ.interiorAudit().emptyVariants. A vocabulary nobody can COUNT is
  // indistinguishable from the one shell repeated (CLAUDE.md: an audit nobody
  // has executed is not a measurement).
  const EMPTY_TALLY = { bare: 0, renovation: 0, moveout: 0, afterhours: 0, dark: 0 };

  function progEmpty(r, h) {
    const kind = emptyVariant(h);
    const k = floorIndexOf(r, h);
    // the DARK storey. Never the ground floor (an unlit lobby reads as broken,
    // not as intentional) and never on a bare building, whose whole read is the
    // clean lit shell repeated.
    const dark = kind !== "bare" && k > 0 && CBZ.hash01
      && CBZ.hash01(h.ox + k * 13.7, h.oz - k * 7.1, 0x0E12) < 0.18;
    shell(h, r, dark);
    EMPTY_TALLY[kind] = (EMPTY_TALLY[kind] | 0) + 1;
    if (dark) EMPTY_TALLY.dark++;
    if (kind === "bare" || CBZ.CONFIG.INTERIOR_EMPTY_VARIETY === false) return { anchors: [] };

    const y = r.y, w = r.x1 - r.x0, d = r.z1 - r.z0;
    if (w < 3.0 || d < 3.0) return { anchors: [] };
    const mx = cx(r), mz = cz(r);
    // one gated box, exactly the roomKit idiom: refused on the door aisle, the
    // stair strip and the lift chase rather than drawn through them.
    function eb(x, z, ly, bw, bh, bd, col, o) {
      if (!inRect(r, x, z, 0.35) || !h.clear(x, z, (o && o.pad) || 0.5)) return false;
      h.b.lbox(x, y + ly + bh / 2, z, bw, bh, bd, col,
        (o && o.emissive) ? { emissive: o.emissive, ei: o.ei || 0.5, cast: false } : { cast: false });
      return true;
    }
    // a real, sittable chair from the ONE furniture vocabulary. Thinned to
    // about a third of the floors so a twelve-storey shell does not file twelve
    // propuse anchors nobody will ever sit in.
    function realChair(x, z, yaw) {
      if (!CBZ.furnish || !CBZ.furnish.chair) return false;
      if (!inRect(r, x, z, 0.6) || !h.clear(x, z, 0.6)) return false;
      if (CBZ.hash01 && CBZ.hash01(h.ox + k, h.oz, 0x0E13) >= 0.34) return false;
      try { CBZ.furnish.chair(x, y, z, yaw, { box: h.b.lbox, ox: h.ox, oz: h.oz }); } catch (e) { return false; }
      return true;
    }
    // a deterministic offset inside the room, so two floors of the same shell
    // are identical (the monotony) while two BUILDINGS are not.
    const j = CBZ.hash01 ? CBZ.hash01(h.ox, h.oz, 0x0E14) : 0.5;
    const sx = mx + (j - 0.5) * Math.min(3.0, w * 0.25);

    if (kind === "renovation") {
      // dust sheets down the middle of the floor, laid in two runs
      for (let i = -1; i <= 1; i += 2)
        eb(sx + i * 1.3, mz, 0.05, 1.15, 0.02, Math.min(d - 1.6, 5.0), P.marble, { pad: 0.4 });
      // the ladder, leaning nowhere — two rails and four rungs
      const lx = sx - 2.2;
      for (let i = -1; i <= 1; i += 2) eb(lx + i * 0.24, mz + 1.1, 0, 0.06, 2.4, 0.06, P.steel, { pad: 0.4 });
      for (let i = 0; i < 4; i++) eb(lx, mz + 1.1, 0.45 + i * 0.55, 0.54, 0.05, 0.05, P.steel, { pad: 0.4 });
      // paint tins and a tray, clustered where somebody was working
      for (let i = 0; i < 3; i++)
        eb(sx + 0.6 + i * 0.42, mz - 1.4, 0, 0.3, 0.34, 0.3, i === 1 ? P.worktop : P.sack, { pad: 0.35 });
      eb(sx + 1.1, mz - 2.0, 0.01, 0.9, 0.05, 0.5, P.sack, { pad: 0.35 });
      // ONE wall half-repainted — the tell that says the job is unfinished
      eb(mx, r.z1 - 0.22, 0, Math.min(w - 1.2, 6.0), 1.55, 0.06, P.marble, { pad: 0.3 });
      // the single emissive accent: a worklight on a short mast
      eb(sx - 2.6, mz - 1.6, 0, 0.1, 1.5, 0.1, P.steel, { pad: 0.4 });
      eb(sx - 2.6, mz - 1.6, 1.5, 0.42, 0.22, 0.3, P.flood, { emissive: P.flood, ei: 0.75, pad: 0.4 });

    } else if (kind === "moveout") {
      // two stacks of cartons and a single third, left where the truck stopped
      const bx = sx + 1.0, bz = mz + Math.min(1.6, d * 0.16);
      eb(bx, bz, 0, 0.72, 0.62, 0.72, P.crate, { pad: 0.45 });
      eb(bx, bz, 0.62, 0.66, 0.54, 0.66, P.crate, { pad: 0.45 });
      eb(bx + 0.86, bz - 0.2, 0, 0.7, 0.6, 0.7, P.crate, { pad: 0.45 });
      eb(bx + 0.86, bz - 0.2, 0.6, 0.6, 0.5, 0.6, P.crate, { pad: 0.45 });
      eb(bx - 1.5, bz + 0.9, 0, 0.68, 0.58, 0.68, P.crate, { pad: 0.45 });
      // the tape gun and a flattened carton on the floor
      eb(bx - 0.3, bz - 1.5, 0.01, 0.9, 0.03, 0.7, P.crate, { pad: 0.35 });
      // one chair nobody came back for, facing the empty room
      realChair(sx - 1.9, mz - 1.2, Math.PI * 0.25);

    } else if (kind === "afterhours") {
      // two desks left standing out of a floor that used to be full of them —
      // the SAME 1.5x0.85 station the desk farm draws, minus its worker.
      for (let i = 0; i < 2; i++) {
        const dx = sx - 1.6 + i * 3.0, dz = mz - 0.4;
        if (!eb(dx, dz, 0.03, 1.5, 0.66, 0.85, P.desk, { pad: 0.6 })) continue;
        eb(dx, dz, 0.69, 1.62, 0.08, 0.95, P.worktop, { pad: 0.6 });
        if (i === 0) {           // ONE monitor still on — the whole read
          eb(dx, dz - 0.42, 0.79, 0.7, 0.46, 0.06, P.bezel, { pad: 0.55 });
          eb(dx, dz - 0.38, 0.81, 0.58, 0.36, 0.02, P.screen, { emissive: P.screen, ei: 0.55, pad: 0.55 });
        }
      }
      // a chair on its side, drawn as what a tipped chair actually is: the pad
      // flat on the deck with the back lying off one edge of it.
      eb(sx + 0.4, mz + 1.5, 0.02, 0.6, 0.1, 0.6, P.chair, { pad: 0.4 });
      eb(sx + 0.4, mz + 2.02, 0.02, 0.6, 0.1, 0.5, P.chair, { pad: 0.4 });
      eb(sx + 0.4, mz + 1.5, 0.12, 0.12, 0.1, 0.5, P.bezel, { pad: 0.4 });
      // ...and one still upright, and real
      realChair(sx + 1.4, mz - 1.5, 0);
    }
    return { anchors: [] };
  }

  // ========================================================================
  //  (b/c) DESK-FARM — the flagship. Ordered rows of IDENTICAL desks +
  //  terminals + chairs on a fixed pitch, grid centred in the room, every
  //  chair on the same side, every worker facing the same way (-z). The
  //  station is byte-for-byte the office furnisher's proven 8-box desk, so
  //  it lands in the exact colour buckets the batcher already merges.
  //  Returns one seat anchor per landed desk (world coords, face=π).
  // ========================================================================
  const PITCH_X = 3.0, PITCH_Z = 2.6;
  // MESH BUDGET, and it is the one cap this kit was missing. A station is 8
  // boxes, so the grid cost is 8·cols·rows and BOTH factors grow with the
  // plate: on a city tower's ~24 m plate that is ~500 boxes and nobody noticed,
  // but a government slab is 118 m across and the same code asks for 624 desks
  // — 5,000 boxes on ONE floor, three floors of it. The pitch and the centring
  // are untouched (the rows still read as rows); only the EXTENT is bounded, so
  // a big floor gets a dense core of desks with open circulation around it,
  // which is what a big floor actually looks like.
  const DESK_CAP = 96, RACK_CAP = 80;
  function gridCap(cols, rows, cap) {
    if (cols * rows <= cap) return [cols, rows];
    const s = Math.sqrt(cap / (cols * rows));
    return [Math.max(1, Math.floor(cols * s)), Math.max(1, Math.floor(rows * s))];
  }
  function progDeskFarm(r, h) {
    shell(h, r);
    const anchors = [];
    let feedReg = 0;              // CCTV: cap live-feed monitor faces per floor (city/cctv.js)
    const y = r.y;
    const spanX = (r.x1 - r.x0) - 2.0, spanZ = (r.z1 - r.z0) - 2.8;
    if (spanX < 0.5 || spanZ < 0.5) return { anchors: anchors };
    const cap = gridCap(Math.max(1, 1 + Math.floor(spanX / PITCH_X)),
                        Math.max(1, 1 + Math.floor(spanZ / PITCH_Z)), DESK_CAP);
    const cols = cap[0], rows = cap[1];
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
    ceilingStrip(h.b.lbox(mx2, y + h.fh - 0.28, mz2, alongX ? 0.34 : TL * 0.8, 0.06, alongX ? TL * 0.8 : 0.34, P.light,
      { emissive: P.light, ei: 0.3, cast: false }));
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
    // same budget law as the desk farm above: 4 boxes a bay, and BOTH the run
    // count and the bays-per-run grow with the plate.
    const segs = Math.max(1, Math.floor(((r.z1 - 1.0) - (r.z0 + 1.2)) / (RACK_SEG + RACK_GAP)) + 1);
    const runs = gridCap(Math.max(1, 1 + Math.floor(spanX / RACK_PITCH)), segs, RACK_CAP)[0];
    const zEnd = r.z0 + 1.2 + Math.min(segs, Math.ceil(RACK_CAP / runs)) * (RACK_SEG + RACK_GAP);
    const rx0 = cx(r) - ((runs - 1) * RACK_PITCH) / 2;
    for (let i = 0; i < runs; i++) {
      const x = rx0 + i * RACK_PITCH;
      for (let z = r.z0 + 1.2; z + RACK_SEG <= Math.min(r.z1 - 1.0, zEnd); z += RACK_SEG + RACK_GAP) {
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

  // ========================================================================
  //  THE APPROACH FRAME — the ONE orientation helper the door-relative
  //  programs share (progLobby had it inline; checkpoint/quarters/bosssuite
  //  all need the identical maths, so it lives here once). Given the room and
  //  the way you ARRIVE (a doorway, or a stairhead — same record shape), it
  //  returns a frame in which "inD" is metres INTO the room from the arrival
  //  and "lat" is metres sideways. Every one of the four rotations a building
  //  can present collapses to one code path, exactly like progMeeting's
  //  `alongX` trick, so a program is authored ONCE and reads correctly from
  //  any door side.
  // ========================================================================
  function approach(r, h, opts) {
    const din = (opts && opts.door && opts.door.nx != null)
      ? opts.door : { x: cx(r), z: r.z0, nx: 0, nz: 1 };
    const nx = din.nx, nz = din.nz, tx = -nz, tz = nx;
    const along = Math.abs(nx) > 0.5;                 // arrival on a ±x wall
    // opts.inset: metres of the plate the ARRIVAL STRUCTURE itself eats (the
    // stair core's footprint). Programs must not try to furnish the stairwell
    // — clearFloorPoint would reject every box and the room would come out
    // half-dressed — so we shift the whole frame past it instead.
    const inset = Math.max(0, (opts && opts.inset) || 0);
    const depth = (along ? (r.x1 - r.x0) : (r.z1 - r.z0)) - inset;
    const span = along ? (r.z1 - r.z0) : (r.x1 - r.x0);
    const y = r.y;
    // ORIGIN: depth 0 is the room edge you arrive through; lateral 0 is the
    // room's CENTRELINE, not the arrival point. This distinction matters — a
    // stairhead sits in a corner, so measuring lateral from IT would push
    // everything at ±span/2 straight through the far wall. The arrival's own
    // offset from the centreline is published as `gapLat` for the one thing
    // that genuinely wants it: lining a doorway up with the way you came in.
    const ctr = { x: cx(r), z: cz(r) };
    const ax = (along ? (nx > 0 ? r.x0 : r.x1) : ctr.x) + nx * inset;
    const az = (along ? ctr.z : (nz > 0 ? r.z0 : r.z1)) + nz * inset;
    const gapLat = (din.x - ctr.x) * tx + (din.z - ctr.z) * tz;
    function at(inD, lat) { return { x: ax + nx * inD + tx * lat, z: az + nz * inD + tz * lat }; }
    // an axis-aligned box in the approach frame: `across` is the sideways
    // extent, `deep` runs along the way you came in.
    function obox(p, ly, across, hh, deep, c, o) {
      if (!inRect(r, p.x, p.z, 0.12) || !h.clear(p.x, p.z, o && o.pad != null ? o.pad : 0.5)) return false;
      h.b.lbox(p.x, y + ly, p.z, along ? deep : across, hh, along ? across : deep, c,
        (o && o.emissive) ? { emissive: o.emissive, ei: o.ei || 0.45, cast: false } : { cast: false });
      return true;
    }
    // face BACK toward the arrival (a guard watching the way in)
    const faceIn = Math.atan2(-nx, -nz);
    // face AWAY from the arrival (someone with their back to the door)
    const faceOut = Math.atan2(nx, nz);
    // a full-span partition at depth inD with ONE doorway at lateral `gap`
    function divider(inD, gap, gapW, wallH) {
      const p = at(inD, 0), g = at(inD, gap);
      if (along) wallZ(h, y, p.x, r.z0, r.z1, g.z, gapW || 1.8, wallH);
      else wallX(h, y, p.z, r.x0, r.x1, g.x, gapW || 1.8, wallH);
    }
    // clamp a lateral offset so anything hung off it stays on the plate
    function lat(v, margin) { const m = span / 2 - (margin == null ? 1.4 : margin); return Math.max(-m, Math.min(m, v)); }
    return { at, obox, divider, lat, gapLat, depth, span, along, y, faceIn, faceOut, nx, nz, tx, tz, r, h };
  }
  // an anchor in the approach frame, tagged with the ROLE the occupier should
  // cast there. Programs describe the room; occupy.js casts the people.
  function anchorAt(A, list, inD, lat, face, kind, pose) {
    const p = A.at(inD, lat);
    if (!inRect(A.r, p.x, p.z, 0.6) || !A.h.clear(p.x, p.z, 0.5)) return null;
    const a = { x: A.h.ox + p.x, y: A.y, z: A.h.oz + p.z, face: face, lx: p.x, lz: p.z, kind: kind || "guard" };
    if (pose) a.pose = pose;
    list.push(a);
    return a;
  }

  // ========================================================================
  //  (b) CHECKPOINT — a floor held by people who expect trouble from the
  //  stairs. A sandbag line ACROSS the way in with ONE gap you must funnel
  //  through (the published chokepoint rule: 3-4 per level, never two covered
  //  from one post), a weapons locker, a duty table with a radio, a worklight
  //  aimed back down the approach, crates stacked in the dead corner. This is
  //  what makes floor 4 read as DEFENDED instead of "the desk floor again".
  //  Returns guard anchors: two behind the barricade covering the gap, one on
  //  the locker, one deep in the corner with the long angle.
  // ========================================================================
  function progCheckpoint(r, h, opts) {
    shell(h, r);
    const A = approach(r, h, opts);
    const anchors = [];
    const dep = A.depth, span = A.span;
    if (dep < 3.6 || span < 3.0) { anchorAt(A, anchors, dep * 0.55, 0, A.faceIn, "guard", "foldarms"); return { anchors: anchors }; }
    // ---- THE BARRICADE: two courses of sacks with one funnel gap ----------
    const bd = Math.min(4.6, Math.max(2.4, dep * 0.34));      // stand-off from the way in
    const half = span / 2 - 0.6;
    // The funnel is deliberately NOT in line with the stair door: the
    // published rule is that no single post may cover two chokepoints, so the
    // gap steps sideways off the way in and you have to cross the room to it.
    const gap = A.lat(A.gapLat + (span > 6.5 ? 1.9 : 0), 1.3);
    // MESH BUDGET: a sandbag line spanning a 25m floorplate would be ~50 boxes
    // AND would read as a wall, not a barricade. Cap the run either side of the
    // funnel — this is a checkpoint you flank, not a fortification.
    const barLo = Math.max(-half, gap - 5.0), barHi = Math.min(half, gap + 5.0);
    for (let lat = barLo; lat <= barHi + 0.01; lat += 1.0) {
      if (Math.abs(lat - gap) < 0.95) continue;                // the funnel
      const p = A.at(bd, lat);
      A.obox(p, 0.18, 0.98, 0.36, 0.6, P.sack, { pad: 0.4 });
      A.obox({ x: p.x, z: p.z }, 0.53, 0.9, 0.32, 0.55, P.sack, { pad: 0.4 });
    }
    // a knocked-over chair and a mug at the gap: someone left in a hurry
    A.obox(A.at(bd - 0.9, gap + 0.7), 0.12, 0.5, 0.22, 0.5, P.chair, { pad: 0.35 });
    // ---- WORKLIGHT on a mast, pointed back down the approach --------------
    { const p = A.at(bd + 1.9, gap);
      A.obox(p, 1.1, 0.12, 2.2, 0.12, P.steel, { pad: 0.4 });
      A.obox(p, 2.3, 0.5, 0.26, 0.34, P.flood, { emissive: P.flood, ei: 0.85, pad: 0.4 }); }
    // ---- WEAPONS LOCKERS against one side wall ----------------------------
    for (let i = 0; i < 2; i++) {
      A.obox(A.at(dep * 0.62 + i * 0.95, half - 0.35), 0.95, 0.9, 1.9, 0.55, P.steel, { pad: 0.45 });
    }
    // ---- DUTY TABLE + radio + two stools on the opposite side -------------
    { const p = A.at(dep * 0.68, -half + 0.9);
      if (A.obox(p, 0.36, 1.5, 0.08, 0.9, P.worktop, { pad: 0.5 })) {
        A.obox(p, 0.18, 1.4, 0.34, 0.8, P.desk, { pad: 0.5 });
        A.obox(A.at(dep * 0.68 + 0.35, -half + 0.9), 0.52, 0.34, 0.24, 0.22, P.bezel, { pad: 0.45 });   // the radio set
        A.obox(A.at(dep * 0.68 + 0.36, -half + 0.9), 0.6, 0.2, 0.06, 0.06, P.glow, { emissive: P.glow, ei: 0.6, pad: 0.45 });
        A.obox(A.at(dep * 0.68 - 1.0, -half + 0.9), 0.22, 0.4, 0.44, 0.4, P.chair, { pad: 0.4 });
      } }
    // ---- CRATES stacked in the dead corner (two down, one on top) ---------
    A.obox(A.at(dep - 1.2, -half + 0.7), 0.42, 0.85, 0.82, 0.85, P.crate, { pad: 0.45 });
    A.obox(A.at(dep - 2.1, -half + 0.7), 0.42, 0.85, 0.82, 0.85, P.crate, { pad: 0.45 });
    A.obox(A.at(dep - 1.2, -half + 0.7), 1.28, 0.8, 0.78, 0.8, P.crate, { pad: 0.45 });
    // ---- THE POSTS --------------------------------------------------------
    // every lateral goes through A.lat() so a wide plate can't push a post
    // through the far wall and silently lose it to the inRect check
    anchorAt(A, anchors, bd + 1.0, A.lat(gap - 1.5, 1.0), A.faceIn, "guard", "foldarms");     // covers the funnel
    anchorAt(A, anchors, bd + 1.0, A.lat(gap + 1.9, 1.0), A.faceIn, "guard", "foldarms");     // second angle on it
    anchorAt(A, anchors, dep * 0.62, A.lat(half - 1.5, 1.0), A.faceIn, "guard", "foldarms");  // on the lockers
    anchorAt(A, anchors, dep - 1.4, A.lat(gap * 0.5, 1.0), A.faceIn, "guard", "foldarms");    // the long angle from the back
    return { anchors: anchors };
  }

  // ========================================================================
  //  (c) QUARTERS — a floor people LIVE on while they hold the building.
  //  Bunk rows against both side walls, footlockers, a mess table down the
  //  middle, one strip light. Monotony on purpose (archetype (c)) — it is the
  //  same eight bunks on every crew floor, which is exactly how a barracks
  //  reads. Doubles as a military-base dormitory with zero changes.
  // ========================================================================
  const BUNK_PITCH = 2.2;
  function progQuarters(r, h, opts) {
    shell(h, r);
    const A = approach(r, h, opts);
    const anchors = [];
    const dep = A.depth, span = A.span;
    if (dep < 4.0 || span < 3.4) return { anchors: anchors };
    const half = span / 2 - 0.55;
    // MESH BUDGET + read: 4 bunks a wall is a barracks; 12 is a warehouse of
    // beds and ~90 boxes on one floor. Cap it.
    const rows = Math.max(1, Math.min(4, Math.floor((dep - 3.0) / BUNK_PITCH)));
    for (let s = -1; s <= 1; s += 2) {
      for (let i = 0; i < rows; i++) {
        const inD = 2.2 + i * BUNK_PITCH;
        const p = A.at(inD, s * half);
        // lower bunk, upper bunk, one footlocker at the foot
        if (!A.obox(p, 0.42, 0.95, 0.16, 1.9, P.sofa, { pad: 0.45 })) continue;
        A.obox(p, 0.30, 0.9, 0.30, 1.85, P.steel, { pad: 0.45 });      // frame under the mattress
        A.obox(p, 1.42, 0.95, 0.16, 1.9, P.sofa, { pad: 0.45 });       // upper mattress
        A.obox(p, 1.30, 0.9, 0.28, 1.85, P.steel, { pad: 0.45 });
        A.obox(A.at(inD, s * (half - 1.05)), 0.79, 0.1, 1.58, 0.1, P.steel, { pad: 0.4 });  // ladder post (foot on the deck, head at the top bunk)
        A.obox(A.at(inD + 1.0, s * (half - 0.2)), 0.2, 0.5, 0.4, 0.7, P.crate, { pad: 0.4 });  // footlocker
      }
    }
    // mess table down the centre + benches
    if (span > 5.2) {
      const mid = A.at(dep * 0.5, 0);
      if (A.obox(mid, 0.74, 0.9, 0.08, Math.min(3.2, dep * 0.4), P.worktop, { pad: 0.6 })) {
        A.obox(mid, 0.36, 0.7, 0.68, Math.min(3.0, dep * 0.38), P.desk, { pad: 0.6 });
        for (let s = -1; s <= 1; s += 2)
          A.obox(A.at(dep * 0.5, s * 0.85), 0.38, 0.4, 0.1, Math.min(2.8, dep * 0.36), P.chair, { pad: 0.5 });
      }
      anchorAt(A, anchors, dep * 0.5 - 1.6, 0, A.faceIn, "guard", "foldarms");
    }
    anchorAt(A, anchors, 1.6, half - 1.2, A.faceIn, "guard", "foldarms");
    return { anchors: anchors };
  }

  // ========================================================================
  //  (b) BOSS SUITE — the top floor, and the ONE room in this kit that is a
  //  PLACE rather than a program. The owner's ask, literally: "the boss
  //  sitting in an office in an apt on the top floor... with family."
  //
  //  So it is two rooms behind one divider: you come off the stairs into
  //  somebody's HOME — a dinner half-eaten on the table, a sofa facing a wall
  //  screen, a rug, a kitchen run, a kid's toy on the floor — and only then,
  //  through the doorway, the OFFICE: one heavy desk with its back to the
  //  glass, two chairs waiting in front of it, a drinks cabinet, a floor safe
  //  and a lit aquarium against the far wall. (Research: the top floor has to
  //  differ in KIND, not difficulty — domestic staging after ten floors of
  //  cover geometry is the whole payoff, and one memorable personal prop is
  //  what people actually remember about a boss room.)
  //
  //  Anchors are tagged so the occupier casts the right person in the right
  //  spot without re-deriving geometry: "boss" behind the desk facing the way
  //  in, "family" at the dinner table and on the sofa, "guard" flanking the
  //  desk and standing on the divider doorway.
  // ========================================================================
  function progBossSuite(r, h, opts) {
    shell(h, r);
    const A = approach(r, h, opts);
    const anchors = [];
    const dep = A.depth, span = A.span, y = r.y, wallH = h.fh - 0.1;
    const half = span / 2 - 0.6;
    // COMPACT fallback: a plate too small for two rooms still gets a desk, a
    // sofa and the aquarium — one room, same reading, no divider.
    const twoRoom = dep >= 9.0 && span >= 5.0;
    const dv = twoRoom ? dep * 0.5 : 0;
    // the inner doorway lines up with the way you arrive, so from the stairs
    // you can see straight through the home into the office
    const dgap = twoRoom ? A.lat(A.gapLat, 1.4) : 0;
    if (twoRoom) A.divider(dv, dgap, 1.9, wallH);

    /* ---------------- THE HOME (near half) ------------------------------- */
    const homeEnd = twoRoom ? dv : dep;
    if (twoRoom) {
      // dinner, mid-meal: table, four chairs, four plates, one chair pushed out
      const tD = Math.min(2.4, (homeEnd - 2.0) * 0.5), td = 2.0;
      const tp = A.at(td, half - 1.5);
      if (A.obox(tp, 0.74, 1.15, 0.08, tD, P.wood, { pad: 0.55 })) {
        A.obox(tp, 0.36, 0.9, 0.68, tD * 0.75, P.wood, { pad: 0.55 });
        for (let i = -1; i <= 1; i += 2) for (let s = -1; s <= 1; s += 2) {
          const cp = A.at(td + i * (tD * 0.28), half - 1.5 + s * 0.85);
          if (!A.obox(cp, 0.42, 0.46, 0.12, 0.46, P.chair, { pad: 0.4 })) continue;
          A.obox(A.at(td + i * (tD * 0.28), half - 1.5 + s * 1.06), 0.78, 0.46, 0.6, 0.1, P.chair, { pad: 0.4 });
          seatReg(h, cp.x, y, cp.z, Math.atan2(tp.x - cp.x, tp.z - cp.z), "chair");
        }
        for (let i = -1; i <= 1; i += 2) for (let s = -1; s <= 1; s += 2)   // the plates
          A.obox(A.at(td + i * (tD * 0.2), half - 1.5 + s * 0.5), 0.8, 0.34, 0.03, 0.34, P.marble, { pad: 0.3 });
        // two of them still at the table, facing across it at each other
        anchorAt(A, anchors, td - tD * 0.28, half - 2.56, A.faceOut, "family", "stand");
        anchorAt(A, anchors, td + tD * 0.28, half - 0.44, A.faceIn, "family", "stand");
      }
      // the living end: rug, sofa facing the divider, low table, wall screen
      const sd = Math.max(td + 2.4, homeEnd - 3.2);
      A.obox(A.at(sd + 0.6, -half + 1.9), 0.02, Math.min(4.0, span * 0.5), 0.03, Math.min(3.2, homeEnd * 0.34), P.rug, { pad: 0.7 });
      const sp = A.at(sd, -half + 1.9);
      if (A.obox(sp, 0.36, 2.5, 0.44, 0.9, P.sofa, { pad: 0.6 })) {
        A.obox(A.at(sd - 0.42, -half + 1.9), 0.72, 2.5, 0.62, 0.16, P.sofa, { pad: 0.6 });   // backrest
        seatReg(h, sp.x, y, sp.z, A.faceOut, "sofa");
        anchorAt(A, anchors, sd + 0.05, -half + 2.75, A.faceOut, "family", "stand");
      }
      A.obox(A.at(sd + 1.5, -half + 1.9), 0.24, 1.3, 0.1, 0.6, P.wood, { pad: 0.5 });        // low table
      // the wall screen on the divider, facing the sofa
      if (twoRoom) {
        A.obox(A.at(dv - 0.14, -half + 1.9), 1.55, 2.0, 1.05, 0.07, P.bezel, { pad: 0.4 });
        A.obox(A.at(dv - 0.2, -half + 1.9), 1.55, 1.75, 0.85, 0.03, P.glow, { emissive: P.glow, ei: 0.5, pad: 0.4 });
      }
      // the kitchen run down one wall + a warm pendant over the table
      for (let i = 0; i < 3; i++) {
        A.obox(A.at(1.4 + i * 1.05, -half + 0.35), 0.46, 1.0, 0.9, 0.62, P.desk, { pad: 0.45 });
        A.obox(A.at(1.4 + i * 1.05, -half + 0.35), 0.94, 1.02, 0.06, 0.66, P.marble, { pad: 0.45 });
      }
      A.obox(A.at(td, half - 1.5), h.fh - 0.75, 0.7, 0.14, 0.7, P.lamp, { emissive: P.lamp, ei: 0.55, pad: 0.5 });
      // a kid's toy left on the rug — the detail that says people live here
      A.obox(A.at(sd + 1.9, -half + 3.0), 0.14, 0.3, 0.28, 0.3, 0x3f9a4f, { pad: 0.3 });
    }

    /* ---------------- THE OFFICE (far half) ------------------------------ */
    const o0 = twoRoom ? dv + 0.9 : 1.6;
    const deskD = dep - 2.4;
    const dp = A.at(deskD, 0);
    let bossPlaced = false;
    if (deskD > o0 + 0.4 && A.obox(dp, 0.4, 2.9, 0.78, 1.15, P.wood, { pad: 0.7 })) {
      A.obox(dp, 0.81, 3.1, 0.08, 1.3, P.marble, { pad: 0.7 });                     // the top
      A.obox(A.at(deskD - 0.35, 0.9), 0.9, 0.55, 0.1, 0.42, P.bezel, { pad: 0.5 }); // papers
      A.obox(A.at(deskD - 0.3, -0.95), 1.02, 0.5, 0.34, 0.06, P.bezel, { pad: 0.5 });
      A.obox(A.at(deskD - 0.32, -0.95), 1.02, 0.42, 0.26, 0.02, P.screen, { pad: 0.5 });
      // the chair, and the man in it — back to the glass, facing the only way in
      const bp = A.at(deskD + 1.05, 0);
      A.obox(bp, 0.44, 0.62, 0.14, 0.62, P.chair, { pad: 0.5 });
      A.obox(A.at(deskD + 1.32, 0), 0.95, 0.66, 0.9, 0.12, P.chair, { pad: 0.5 });
      seatReg(h, bp.x, y, bp.z, A.faceIn, "chair");
      bossPlaced = !!anchorAt(A, anchors, deskD + 1.05, 0, A.faceIn, "boss", "sit");
      // two chairs waiting on the near side of the desk
      for (let s = -1; s <= 1; s += 2) {
        const gp = A.at(deskD - 1.5, s * 0.95);
        if (!A.obox(gp, 0.42, 0.5, 0.12, 0.5, P.chair, { pad: 0.4 })) continue;
        A.obox(A.at(deskD - 1.78, s * 0.95), 0.8, 0.5, 0.62, 0.12, P.chair, { pad: 0.4 });
        seatReg(h, gp.x, y, gp.z, A.faceOut, "chair");
      }
    }
    // THE AQUARIUM — the one prop you remember the room by. Lit water on a
    // dark plinth against the far wall, glowing across the desk at night.
    { const ap = A.at(dep - 0.75, half - 1.4);
      if (A.obox(ap, 0.4, 2.1, 0.8, 0.55, P.wood, { pad: 0.5 })) {
        A.obox(ap, 1.32, 2.0, 1.0, 0.5, P.water, { emissive: P.water, ei: 0.6, pad: 0.5 });
        A.obox(ap, 1.86, 2.1, 0.08, 0.55, P.steel, { pad: 0.5 });
      } }
    // drinks cabinet + a floor safe + framed pictures on the far wall
    A.obox(A.at(dep - 0.8, -half + 1.3), 0.5, 1.6, 1.0, 0.5, P.wood, { pad: 0.5 });
    A.obox(A.at(dep - 0.8, -half + 1.3), 1.08, 1.4, 0.16, 0.4, P.gold, { emissive: P.gold, ei: 0.25, pad: 0.5 });
    A.obox(A.at(dep - 0.7, -half + 2.7), 0.35, 0.8, 0.7, 0.6, P.steel, { pad: 0.45 });     // the safe
    for (let i = -1; i <= 1; i++)
      A.obox(A.at(dep - 0.34, i * 1.5), 2.0, 0.62, 0.46, 0.05, P.gold, { pad: 0.35 });
    // one warm lamp over the desk, one over the aquarium
    A.obox(A.at(deskD, 0), h.fh - 0.7, 1.3, 0.1, 0.5, P.lamp, { emissive: P.lamp, ei: 0.5, pad: 0.6 });

    /* ---------------- the two men who never leave the room --------------- */
    anchorAt(A, anchors, deskD - 0.3, half - 1.9, A.faceIn, "guard", "foldarms");
    anchorAt(A, anchors, deskD - 0.3, -half + 1.9, A.faceIn, "guard", "foldarms");
    if (twoRoom) anchorAt(A, anchors, dv + 0.55, dgap, A.faceIn, "guard", "foldarms");   // on the inner doorway
    if (!bossPlaced) anchorAt(A, anchors, dep * 0.7, 0, A.faceIn, "boss", "stand");      // degenerate plate: still a boss
    return { anchors: anchors };
  }

  // ========================================================================
  //  PER-FLOOR ROOM RECT — the resolver occupy.js and every future per-floor
  //  caller needs, and the one function this kit was missing. It reproduces
  //  buildings.js's own roomKit() usable band EXACTLY (facade thickness, the
  //  0.4m wall standoff, the -x stair strip when a shell has one) and lifts it
  //  onto floor k via the floorTops contract. One answer to "what is the room
  //  on floor 3", instead of four files each re-deriving it.
  //    CBZ.interiorFloorRoom(b, k) -> {x0,x1,z0,z1,y,floor,fh,w,d} | null
  //  Host-LOCAL rect, ready to hand straight to CBZ.interiorProgram.
  // ========================================================================
  CBZ.interiorFloorRoom = function (b, k) {
    if (!b || b.w == null || b.d == null) return null;
    const wt = b.wt != null ? b.wt : 0.4;
    const fh = b.FH != null ? b.FH : 3.2;
    const tops = Array.isArray(b.floorTops) && b.floorTops.length >= 2 ? b.floorTops : null;
    const nInterior = tops ? (tops.length - 1) : Math.max(1, b.storeys || 1);
    k = k | 0;
    if (k < 0 || k >= nInterior) return null;
    const x0 = b.hasStairs ? (-b.w / 2 + wt + (b.stairW || 0) + 0.4) : (-b.w / 2 + wt + 0.4);
    const x1 = b.w / 2 - wt - 0.4;
    const z0 = -b.d / 2 + wt + 0.4;
    const z1 = b.d / 2 - wt - 0.4;
    if (x1 - x0 < 1.4 || z1 - z0 < 1.4) return null;
    const y = tops ? tops[k] : (k <= 0 ? 0.14 : k * fh);
    return { x0: x0, x1: x1, z0: z0, z1: z1, y: y, floor: k, fh: fh, w: x1 - x0, d: z1 - z0 };
  };
  CBZ.interiorFloorCount = function (b) {
    if (!b) return 0;
    const tops = Array.isArray(b.floorTops) && b.floorTops.length >= 2 ? b.floorTops : null;
    return tops ? (tops.length - 1) : Math.max(0, (b.storeys | 0));
  };

  // ---- dispatch -----------------------------------------------------------
  const PROGRAMS = {
    empty: progEmpty, deskfarm: progDeskFarm, meeting: progMeeting, storage: progStorage, lobby: progLobby,
    checkpoint: progCheckpoint, quarters: progQuarters, bosssuite: progBossSuite,
  };
  CBZ.interiorProgram = function (name, room, ctx) {
    armReset();                        // see armReset: propuse.js parses AFTER this file
    const h = host(ctx);
    const fn = PROGRAMS[name];
    if (!h || !fn || !room) return null;
    if (!(room.x1 - room.x0 > 2) || !(room.z1 - room.z0 > 2)) return null;   // degenerate plate
    const r = { x0: room.x0, x1: room.x1, z0: room.z0, z1: room.z1, y: room.y || 0 };
    return fn(r, h, (ctx && ctx.opts) || null);
  };
  CBZ.interiorProgramNames = ["empty", "deskfarm", "meeting", "storage", "lobby", "checkpoint", "quarters", "bosssuite"];
  // THE PARTITION ALONE — one thin full-run wall with ONE doorway and a lintel
  // over it, in the host's local frame. It is the only wall this kit draws and
  // it was private to `meeting` and `bosssuite`; a caller that wants to make a
  // ROOM out of part of a big floorplate needs exactly this and nothing else, so
  // it is the difference between one export and a fifth partition drawer.
  //   spec: { axis:"x"|"z", at, from, to, gap, gapW, h }
  //     axis "x" → the wall RUNS along x at a fixed z (`at`), from..to in x.
  //     axis "z" → the wall RUNS along z at a fixed x (`at`), from..to in z.
  //     `gap` is the doorway's coordinate on the running axis (omit for solid).
  CBZ.interiorPartition = function (room, ctx, spec) {
    const h = host(ctx);
    if (!h || !spec) return false;
    const y = (room && room.y) || 0;
    const wallH = spec.h != null ? spec.h : h.fh - 0.1;
    const gap = spec.gap != null ? spec.gap : (spec.to + 1e6);   // off-run → solid
    if (String(spec.axis) === "x") wallX(h, y, spec.at, spec.from, spec.to, gap, spec.gapW || 1.8, wallH);
    else wallZ(h, y, spec.at, spec.from, spec.to, gap, spec.gapW || 1.8, wallH);
    return true;
  };
  // THE SHELL ALONE — floor covering + ceiling strip, no program. A caller that
  // dresses a floor with world/roombuild.js's LAYOUT planner still needs the
  // finished floor and the light under it, and `interiorProgram("empty", …)` is
  // no longer that (it has a vocabulary of its own now). One export instead of a
  // fourth copy of two lbox calls; the ramp registration comes with it.
  CBZ.interiorShell = function (room, ctx, dark) {
    const h = host(ctx);
    if (!h || !room) return false;
    shell(h, { x0: room.x0, x1: room.x1, z0: room.z0, z1: room.z1, y: room.y || 0 }, !!dark);
    return true;
  };

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

  /* ========================================================================
     THE RATCHET — CBZ.interiorAudit(). OWNER: "interiors of buildings feel very
     unintentional." Every number below is RECOMPUTED from live state on each
     call, never a stored guess, and each answers one half of that sentence:

       govFurnished / govBare  the seats of power. `govBare` is an ENTERABLE
                               shell on a government complex with no room in it
                               at all — the Capitol's two chambers, the Mansion's
                               West Wing, the Bureau's annex. It may only ever go
                               DOWN, and govFurnished/govFloors sit beside it so a
                               "fix" that stops raising the wings cannot pass.
       roomplanCalls           world/roombuild.js invocations. It was ZERO for the
                               planner's entire life — a validated layout engine
                               nobody called. It may only ever go UP.
       emptyVariants           the empty vocabulary, by read. `bare` alone means
                               the variety flag is off or the hash collapsed.
       anchorsRegistered       seats + beds filed by the ONE furniture kit, with
                               `mismatched` beside them (furnitureAudit's own
                               pin, which must stay 0) — the proof that a
                               furnished room is SITTABLE and not scenery.
     ======================================================================== */
  CBZ.interiorAudit = function () {
    const gov = (typeof CBZ.govInteriorCounts === "function") ? CBZ.govInteriorCounts() : null;
    const rp = (typeof CBZ.roomPlanAudit === "function") ? CBZ.roomPlanAudit() : null;
    const fa = (typeof CBZ.furnishAudit === "function") ? CBZ.furnishAudit() : null;
    const ev = {};
    for (const k in EMPTY_TALLY) ev[k] = EMPTY_TALLY[k];
    return {
      govFurnished: gov ? gov.buildings : 0,     // gov shells with at least one designed floor
      govBare: gov ? gov.bare : 0,               // <- PIN. Only ever down.
      govFloors: gov ? gov.floors : 0,
      roomplanCalls: rp ? rp.calls : 0,          // <- only ever UP (was 0 forever)
      roomplanPlaced: rp ? rp.planned : 0,       // ...that produced at least one piece
      roomplanEmpty: rp ? rp.empty : 0,          // ...that planned nothing (a refused rect)
      roomplanBlocked: rp ? rp.blocked : 0,      // pieces dropped as unreachable
      roomplanPrograms: rp ? rp.programs : {},
      emptyVariants: ev,
      lightStrips: STRIPS.length,                // ceiling strips on the day/night ramp
      anchorsRegistered: fa ? (fa.seats + fa.beds) : 0,
      anchorsMismatched: fa ? fa.mismatched : 0, // furnitureAudit's own pin: 0
    };
  };
  // a world rebuild re-runs every furnisher, so the tallies restart in lockstep
  // with the anchor registry they describe — the same wrap furniture.js uses on
  // the same reset, marker-guarded like the explosion wrappers.
  CBZ.interiorAuditReset = function () {
    for (const k in EMPTY_TALLY) EMPTY_TALLY[k] = 0;
    if (CBZ.roomPlanAuditReset) CBZ.roomPlanAuditReset();
  };
  // LAZY RETRY — this file is index.html:530 and city/propuse.js is :667, so
  // CBZ.propPurposeReset does not exist yet at parse time and a wrap written
  // here would be dead on arrival (which is exactly what happened to the
  // identical wrap in city/furniture.js). Re-armed from interiorProgram, which
  // cannot run until the whole script block has parsed.
  function armReset() {
    if (typeof CBZ.propPurposeReset !== "function" || CBZ.propPurposeReset._interiorWrapped) return;
    const prev = CBZ.propPurposeReset;
    const wrapped = function () { CBZ.interiorAuditReset(); return prev.apply(this, arguments); };
    // carry every marker forward — city/furniture.js wraps the same function.
    for (const kk in prev) { try { wrapped[kk] = prev[kk]; } catch (e) {} }
    wrapped._interiorWrapped = true;
    CBZ.propPurposeReset = wrapped;
  }
  armReset();
})();

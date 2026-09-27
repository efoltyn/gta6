/* ============================================================
   systems/quake.js — THE SUBDUCTION-ZONE EARTHQUAKE CORE (CBZ.quake).

   OWNER SCIENCE, and this file is the implementation of it verbatim:

     "The shaking itself rarely kills directly. Primary deaths: CRUSHING and
      BLUNT FORCE TRAUMA from falling debris (glass, masonry, facades, heavy
      furniture) and complete structural collapse ('pancaking'). Secondary
      deaths rapidly from FIRES from ruptured gas lines and ELECTROCUTION from
      severed power lines. Survive — indoors: drop, cover, hold on under heavy
      structurally sound furniture, away from windows, exterior walls, tall
      shelves. Outdoors: open ground far from structures, trees, streetlights,
      power lines that fall OUTWARD."

   Every clause above is a mechanic here, and NONE of them is the shake:

     shed()      buildings SHED. Glass panes and masonry spall off the facade
                 EDGES and fall as real transient bodies under gravity. They
                 strike actors ON THE WAY DOWN, not on landing. Density scales
                 with the structural ledger stage the caller reports, so a
                 building about to pancake sheds hardest — which makes the
                 strip of ground beside a wounded tower the deadliest place on
                 the map and the open square the safest. THAT ASYMMETRY IS THE
                 WHOLE LESSON, and it is produced by geometry, not by a rule.
     cover()     drop, cover, hold on. A registered heavy table/desk is real
                 protection (x0.05); a roof over your head is partial (x0.55);
                 the 1.5 m strip against an exterior wall or window is WORSE
                 than the open street (x1.35), because that is where the
                 facade lands.
     gasFire()   ruptured gas mains light damaged buildings. In the city this
                 is city/structural.js's BURNING state — its floor automaton,
                 its wind-biased spread, its load-path burn-through — so no
                 fire model is written here. Off a city lot (the survival
                 island has no lots) a small local flame stands in and reports
                 its structural damage back through the caller's own hook.
     dropLine()  a pole comes down AWAY from the structure it stands beside,
                 which is exactly why "open ground" is not the same as "open
                 ground under the wires". The conductor lies live, arcing, and
                 touching it electrocutes.

   REUSE, NOT REINVENTION — what this file deliberately does not own:
     · the structural ledger  → CBZ.structure (city) / the caller's ledger
     · fire spread            → CBZ.structure.ignite
     · deaths                 → CBZ.surv.hurt / CBZ.cityKillPed / cityHurtPlayer
                                (the killfeed is the only popup; nothing here
                                 toasts anything)
     · knockdown/ragdoll      → CBZ.body
     · furniture              → the arena's own rooms (b.interior.covers) /
                                CBZ.propSeats in the city
     · the shake              → CBZ.shake
   What it DOES own is one thing nothing else in the game had: a piece of a
   building in the air with mass, on its way to a person.

   WHY ITS OWN DEBRIS TICKER, given CBZ.fx.dropDebris exists: fx.js's debris
   updater is `if (CBZ.game.mode !== "survival") return`, and it only damages
   on LANDING, through a radius. A quake needs debris in the CITY too, and a
   masonry block kills at head height while it is still falling. Both are
   structural differences, not preferences.

   DUAL MODE, the shape systems/tornado.js established: survival actors go
   through CBZ.surv.hurt (which resolves the kill-feed cause); city actors go
   through the kill bus or a knockdown. NO PRIVATE HEALTH LEDGER EXISTS HERE —
   a city ped is either killed by the piece that hit them or knocked down by
   it, so this file adds nothing to the `.hp -=` ratchet.

   DETERMINISM: this is a runtime event, not a generation path, so the debris
   scatter uses Math.random. The one BUILD path here — dressArena(), which
   gives the survival island the day-room tables and utility poles the lesson
   needs — is position-hashed through CBZ.hash01 and never touches an rng
   stream.

   Ratchet: CBZ.quakeAudit().
   Flags: QUAKE_DEBRIS · QUAKE_COVER · QUAKE_UTILITY · QUAKE_ARENA_KIT ·
          CITY_QUAKE (the whole city-side event, default OFF).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  if (CBZ.quake) return;                       // idempotent family guard
  const THREE = window.THREE;

  CBZ.CONFIG = CBZ.CONFIG || {};
  // Buildings shed glass and masonry that can kill you. false = a quake is a
  // camera shake and a collapse again.
  if (CBZ.CONFIG.QUAKE_DEBRIS == null) CBZ.CONFIG.QUAKE_DEBRIS = true;
  // Drop, cover, hold on. false = cover() always answers "open", so every
  // exposure multiplier is 1 and the lesson disappears (but nothing breaks).
  if (CBZ.CONFIG.QUAKE_COVER == null) CBZ.CONFIG.QUAKE_COVER = true;
  // Gas-fed fires + downed conductors after the mainshock.
  if (CBZ.CONFIG.QUAKE_UTILITY == null) CBZ.CONFIG.QUAKE_UTILITY = true;
  // The survival island's day-room tables + street poles (the props the two
  // survival behaviours need to exist at all). false = the island is as it was.
  if (CBZ.CONFIG.QUAKE_ARENA_KIT == null) CBZ.CONFIG.QUAKE_ARENA_KIT = true;
  // THE CITY EVENT. Off by default: a quake in the main world is a big,
  // world-altering thing and it ships dark until the owner asks for it.
  if (CBZ.CONFIG.CITY_QUAKE == null) CBZ.CONFIG.CITY_QUAKE = false;

  const A = {
    debrisSpawned: 0, debrisKills: 0, debrisHits: 0,
    fireKills: 0, lineKills: 0,
    gasFires: 0, gasFiresShared: 0, linesDown: 0, shocks: 0,
    coverAnchors: 0, coverSaves: 0, ducked: 0, kitTables: 0, kitPoles: 0,
    knockdowns: 0, staggers: 0, aftershocks: 0, pgaPeak: 0,
  };

  /* THE DRAW, AND WHO OWNS IT. The header above says a runtime event does not
     need a seed, and for one player that was true. It stops being true the
     moment two machines have to agree on who a quake kills: the facade pieces
     it sheds, the gas fires it lights and the lines it drops are all decided
     here, and all of them kill.

     On the island this draws from the disaster director's own seeded stream
     (systems/disasters.js publishes it), so the quake's decisions sit in the
     same sequence as every other hazard's and two clients running the same
     ticks make the same ones. In the city — a single-player world with no such
     stream — nothing changes. */
  function rnd() {
    return (inSurv() && CBZ.survRnd) ? CBZ.survRnd() : Math.random();
  }
  function now() { return CBZ.now || 0; }
  function inCity() { return CBZ.game && CBZ.game.mode === "city"; }
  function inSurv() { return CBZ.game && CBZ.game.mode === "survival"; }
  function floorAt(x, z) { try { return CBZ.floorAt ? CBZ.floorAt(x, z) : 0; } catch (e) { return 0; } }
  function scene() { return CBZ.scene; }
  function sfxAt(n, x, z, o) { if (CBZ.sfxAt) try { CBZ.sfxAt(n, x, z, o); } catch (e) {} }

  /* ------------------------------------------------------------------
     WHAT A STRUCTURE IS, to this file.
     Two shapes reach it and it refuses to care which: a city LOT (whose
     building carries ox/oz/w/d/storeys) and the survival arena's own
     `fragile` record (x/z/w/d/h). One normaliser, no branch anywhere else.
     ------------------------------------------------------------------ */
  function boxOf(t) {
    if (!t) return null;
    if (t.building) {
      const b = t.building;
      if (!b) return null;
      return { x: b.ox, z: b.oz, w: b.w, d: b.d, h: Math.max(3, (b.storeys || 1) * (b.FH || 3.2)), lot: t, rec: null, group: b.group };
    }
    if (t.w != null && t.h != null && t.x != null) {
      return { x: t.x, z: t.z, w: t.w, d: t.d, h: t.h, lot: null, rec: t, group: t.group };
    }
    return null;
  }

  /* ------------------------------------------------------------------
     ACTORS. One iterator, both modes. The survival roster already answers
     "who is alive and where" through CBZ.surv.forEachActor; the city
     answers it with the player plus CBZ.cityPeds.
     ------------------------------------------------------------------ */
  function eachActorNear(x, z, r, fn) {
    const r2 = r * r;
    if (inSurv() && CBZ.surv && CBZ.surv.forEachActor) {
      CBZ.surv.forEachActor(function (a) {
        if (!a || !a.pos) return;
        const dx = a.pos.x - x, dz = a.pos.z - z;
        if (dx * dx + dz * dz <= r2) fn(a);
      });
      return;
    }
    const P = CBZ.player;
    if (P && !P.dead && P.pos) {
      const dx = P.pos.x - x, dz = P.pos.z - z;
      if (dx * dx + dz * dz <= r2) fn(P);
    }
    const peds = CBZ.cityPeds;
    if (peds) for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || !p.pos) continue;
      const dx = p.pos.x - x, dz = p.pos.z - z;
      if (Math.abs(dx) > r || Math.abs(dz) > r) continue;
      if (dx * dx + dz * dz <= r2) fn(p);
    }
  }
  function isPlayer(a) { return a === CBZ.player || !!a.isPlayer; }

  /* A WOUND IS A DEATH OR A KNOCKDOWN, NEVER A PRIVATE HP FIELD.
     survival: the roster's own graded hurt (it resolves the kill-feed cause).
     city    : the kill bus for a lethal piece, CBZ.body for a survivable one.
     That asymmetry is deliberate — the city has no shared sub-lethal ped
     damage entry, and inventing one here would be the 53rd `.hp -=`. */
  function tally(tag) {
    if (tag === "debris") A.debrisKills++;
    else if (tag === "fire") A.fireKills++;
    else if (tag === "line") A.lineKills++;
  }
  function wound(a, dmg, cause, o) {
    o = o || {};
    if (!a) return;
    if (inSurv() && CBZ.surv && CBZ.surv.hurt) {
      const before = !!a.dead || !!(a.isPlayer && CBZ.player.dead);
      try {
        CBZ.surv.hurt(a, dmg, { cause: cause, fromX: o.x, fromZ: o.z, fling: o.fling || 0 });
      } catch (e) {}
      const after = !!a.dead || !!(a.isPlayer && CBZ.player.dead);
      if (!before && after) tally(o.tag);
      return;
    }
    if (isPlayer(a)) {
      if (CBZ.cityHurtPlayer) { try { CBZ.cityHurtPlayer(dmg, o.x, o.z, cause, false, null, false); } catch (e) {} }
      return;
    }
    if (o.lethal && CBZ.cityKillPed) {
      try { CBZ.cityKillPed(a, { fromX: o.x, fromZ: o.z, force: 7, fling: o.fling || 2, byPlayer: false }, cause); tally(o.tag); } catch (e) {}
      return;
    }
    if (CBZ.body && CBZ.body.knockdown) { try { CBZ.body.knockdown(a, { fromX: o.x, fromZ: o.z, t: 1.1 }); } catch (e) {} }
  }

  /* ============================================================
     DROP, COVER, HOLD ON.

     A cover anchor is a heavy, structurally sound horizontal surface you can
     get UNDER — a solid table or desk. Two sources, and neither of them is a
     new registry the world has to be taught to fill:

       (1) explicit  CBZ.quake.coverAdd(...), used by the arena kit below;
       (2) DERIVED from CBZ.propSeats — the anchor registry city/propuse.js
           already holds. A seat FACES the thing it is drawn up to, and
           city/furniture.js places a table's ring at (D/2 + 0.42) from the
           top's edge, so the worktop centre is a short step along the seat's
           own `face`. No furnisher declares anything and no new field exists.
     ============================================================ */
  const covers = [];
  let seatsDerivedAt = -1;
  const DESK_KINDS = { chair: 1, office: 1, desk: 1, dining: 1, stool: 1, booth: 1, canteen: 1 };

  function coverAdd(x, y, z, r, kind, host) {
    const c = { x: x, y: y || 0, z: z, r: r || 0.95, kind: kind || "table", fp: null, door: null };
    // `host` = the structure this anchor is inside, so a body can be routed to
    // its DOORWAY rather than through its wall. Optional by design: a desk in
    // an open concourse has no host and is simply walked to.
    if (host) {
      c.fp = { x: host.x, z: host.z, w: host.w, d: host.d };
      c.door = { x: host.x, z: host.z - host.d / 2 - 1.1 };   // arena buildings face -z
    }
    covers.push(c); A.coverAnchors = covers.length;
    return c;
  }
  function coverReset() { covers.length = 0; seatsDerivedAt = -1; A.coverAnchors = 0; }

  // Derive the city's tables from the seats already ringed around them. Runs
  // once per world (the seat count is the epoch), costs one pass, and is
  // skipped entirely on a world with no propuse registry.
  function deriveSeatCovers() {
    const seats = CBZ.propSeats;
    if (!seats || seats.length === seatsDerivedAt) return;
    seatsDerivedAt = seats.length;
    // de-dupe on a 0.5 m grid: four chairs round one table are ONE anchor.
    const seen = new Set();
    for (let i = 0; i < covers.length; i++) {
      if (covers[i].kind === "table") seen.add(Math.round(covers[i].x * 2) + "," + Math.round(covers[i].z * 2));
    }
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i];
      if (!s || !DESK_KINDS[s.kind]) continue;
      // ped convention (propuse.js): the body looks along (sin face, cos face)
      const tx = s.x + Math.sin(s.face || 0) * 0.62;
      const tz = s.z + Math.cos(s.face || 0) * 0.62;
      const k = Math.round(tx * 2) + "," + Math.round(tz * 2);
      if (seen.has(k)) continue;
      seen.add(k);
      coverAdd(tx, s.y || 0, tz, 0.85, "table");
    }
  }

  function coverNear(x, z, y, maxD) {
    let best = null, bd = (maxD || 1.4) * (maxD || 1.4);
    for (let i = 0; i < covers.length; i++) {
      const c = covers[i];
      if (y != null && Math.abs((c.y || 0) - y) > 2.6) continue;   // wrong floor
      const dx = c.x - x, dz = c.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = c; }
    }
    return best;
  }

  // A roof over the head — the same platform test the mode's own shelter()
  // uses, re-derived here so this file works in the city too (where there is
  // no CBZ.surv at all) and so nothing in modes/survival.js has to change.
  function underRoof(x, z, y) {
    const plats = CBZ.platforms;
    if (!plats) return false;
    const head = (y || 0) + 2.1;
    for (let i = 0; i < plats.length; i++) {
      const p = plats[i];
      if (p.top > head && p.top < head + 26 && x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) return true;
    }
    return false;
  }

  /* The FACADE STRIP. `structures` is whatever the running event handed us —
     the arena's fragile list or a slice of city lots — so this asks the one
     question that matters: how close is this person to a wall that is
     shedding? Inside 1.5 m of a facade is the worst place to be, and it is
     worse than the open street, which is the counter-intuitive half of the
     real advice. */
  let liveStructures = null;
  function facadeGap(x, z) {
    const S = liveStructures;
    if (!S || !S.length) return 99;
    let best = 99;
    for (let i = 0; i < S.length; i++) {
      const b = S[i];
      if (!b || b.fallen) continue;
      const bx = b.x != null ? b.x : (b.building ? b.building.ox : null);
      if (bx == null) continue;
      const bz = b.z != null ? b.z : b.building.oz;
      const bw = (b.w != null ? b.w : b.building.w) * 0.5;
      const bd = (b.d != null ? b.d : b.building.d) * 0.5;
      const gx = Math.abs(x - bx) - bw, gz = Math.abs(z - bz) - bd;
      const g = (gx < 0 && gz < 0) ? Math.max(gx, gz) : Math.hypot(Math.max(0, gx), Math.max(0, gz));
      if (g < best) best = g;
    }
    return best;
  }

  /* THE ONE ANSWER to "how exposed is this person to falling building".
     Returns {kind, exposure, anchor}. `exposure` multiplies debris damage,
     and it is the only number any caller needs. */
  function cover(a) {
    if (!a || !a.pos) return { kind: "open", exposure: 1, anchor: null };
    if (CBZ.CONFIG.QUAKE_COVER === false) return { kind: "open", exposure: 1, anchor: null };
    if (a._quakeDuck) return { kind: "table", exposure: 0.05, anchor: a._quakeDuck };
    const x = a.pos.x, z = a.pos.z, y = a.pos.y;
    const near = coverNear(x, z, y, 1.5);
    if (near) return { kind: "beside-table", exposure: 0.5, anchor: near };
    const gap = facadeGap(x, z);
    if (underRoof(x, z, y)) {
      // Indoors. Away from the window wall is the good half of "indoors";
      // pressed against the glass is the bad half.
      return { kind: gap > -1.6 ? "window" : "indoors", exposure: gap > -1.6 ? 0.95 : 0.55, anchor: null };
    }
    // The strip against a wall: this is where the facade lands.
    if (gap < 1.5) return { kind: "facade", exposure: 1.35, anchor: null };
    if (gap > 14) return { kind: "open", exposure: 0.35, anchor: null };
    return { kind: "street", exposure: 1, anchor: null };
  }

  /* MAKE A BODY TAKE COVER. The caller (an AI brain) says "go here"; this
     walks them the last few metres and, on arrival, DUCKS them — legs folded,
     arms over the head — and holds the pose. `hold` seconds, then released.
     The pose is written after the mode's own animator (order 23) for the same
     reason systems/disasters.js's swimmers are: absolute writes, last one
     wins, and it restores itself the moment we stop writing. */
  function duckUnder(a, anchor, dt, hold) {
    if (!a || !a.pos || !anchor) return false;
    /* THE WRITE IS ABSOLUTE, and that is not a shortcut — it is the only way
       this can work. A bot's own brain runs at order ~23 and is being steered
       AWAY from buildings by the def's fleeVector at the same moment; a
       relative nudge from order 28 is simply cancelled by it and nobody ever
       reaches a table. So a bot that has committed to cover is OWNED here for
       the duration (the same pattern the flood's swimmers use), and handed
       straight back on standUp(). */
    if (a._qkX == null) { a._qkX = a.pos.x; a._qkZ = a.pos.z; }
    /* AND THE ROUTE GOES THROUGH THE DOOR. An anchor inside a building
       carries its host's footprint and doorway, so a body outside walks to
       the doorway FIRST and only then to the table. Without that leg the
       straight line goes through the wall, which is the one thing that would
       make this read as a cheat instead of as people doing the sensible
       thing. (A city desk anchor has neither field and is beelined — its
       occupant is already indoors.) */
    let tx = anchor.x, tz = anchor.z;
    if (anchor.fp && anchor.door) {
      const inside = Math.abs(a._qkX - anchor.fp.x) < anchor.fp.w * 0.5 - 0.3 &&
                     Math.abs(a._qkZ - anchor.fp.z) < anchor.fp.d * 0.5 - 0.3;
      if (!inside) { tx = anchor.door.x; tz = anchor.door.z; }
    }
    const dx = tx - a._qkX, dz = tz - a._qkZ;
    const d = Math.hypot(dx, dz);
    const arrived = Math.hypot(anchor.x - a._qkX, anchor.z - a._qkZ) <= 0.55;
    if (!arrived) {
      const spd = Math.min(4.8, 2.4 + d * 0.4);
      a._qkX += (dx / (d || 1)) * spd * dt;
      a._qkZ += (dz / (d || 1)) * spd * dt;
      a.pos.x = a._qkX; a.pos.z = a._qkZ;
      if (a.group) a.group.rotation.y = Math.atan2(dx, dz);
      a._quakeDuck = null;
      return false;
    }
    a.pos.x = a._qkX = anchor.x; a.pos.z = a._qkZ = anchor.z;
    if (!a._quakeDuck) A.ducked++;              // counted on the transition only
    a._quakeDuck = anchor;
    a._quakeDuckT = hold || 6;
    // fold: hips down, knees up, forearms over the skull. This IS the
    // telegraph — a player who sees three people dive under a table learns the
    // rule without a line of text.
    const ch = a.char;
    if (ch && ch.parts) {
      const p = ch.parts;
      if (p.ll) p.ll.rotation.x = -1.35;
      if (p.rl) p.rl.rotation.x = -1.35;
      if (p.la) { p.la.rotation.x = -2.5; p.la.rotation.z = 0.5; }
      if (p.ra) { p.ra.rotation.x = -2.5; p.ra.rotation.z = -0.5; }
      if (p.torso) p.torso.rotation.x = 1.3;
      if (p.head) p.head.rotation.x = 0.55;
    }
    // UNDER, not beside. A table top sits at 0.74 and a crouched body is
    // taller than that, so the fold has to be a real fold: hips dropped below
    // the worktop line and the spine nearly horizontal under it. Without the
    // drop the pose reads as somebody kneeling ON the table.
    if (a.group) a.group.position.y = floorAt(a.pos.x, a.pos.z) - 0.44;
    return true;
  }
  function standUp(a) {
    if (!a) return;
    a._quakeDuck = null; a._quakeDuckT = 0;
    a._qkX = null; a._qkZ = null;          // hand locomotion back to the brain
    const ch = a.char;
    if (ch && ch.parts) {
      const p = ch.parts;
      if (p.torso) p.torso.rotation.x = 0;
      if (p.head) p.head.rotation.x = 0;
      if (p.la) p.la.rotation.z = 0;
      if (p.ra) p.ra.rotation.z = 0;
    }
  }

  /* ============================================================
     SHEDDING — the thing that actually kills people.
     ============================================================ */
  const MAX_PIECES = 170;
  const pieces = [];
  const GEO_CACHE = new Map();
  function pieceGeo(kind, s) {
    // quantised so a whole quake's worth of debris shares a handful of buffers
    const q = Math.max(1, Math.round(s * 6));
    const k = kind + q;
    let g = GEO_CACHE.get(k);
    if (!g) {
      const u = q / 6;
      g = kind === "glass"
        ? new THREE.BoxGeometry(u * 1.6, u * 2.1, 0.05)
        : brokenChunk(u, u * (0.55 + (q % 3) * 0.22), u * 0.85, q);
      g._shared = true;
      GEO_CACHE.set(k, g);
    }
    return g;
  }
  /* A LUMP OF BROKEN WALL, not a box. Masonry used to shed as clean cuboids
     in five greys: dice falling off a painted building. A torn-off piece of
     facade is a slab with one or two faces still flat (the wall face, the
     back of the render) and the rest ragged, so the chunk is a box cut into
     a 2x2x2 lattice whose inner and edge vertices are pushed about by a hash
     of the lattice point, then split to flat-shaded triangles so every
     fracture facet catches the light on its own. Quantised and cached, so a
     whole quake still shares a handful of buffers. */
  function brokenChunk(w, h, d, salt) {
    const b = new THREE.BoxGeometry(w, h, d, 2, 2, 2);
    const pa = b.attributes.position;
    const hs = function (x, y, z) {
      const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + salt * 17.3) * 43758.5453;
      return v - Math.floor(v) - 0.5;
    };
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      // the +z face stays the flat wall face; everything else is fracture
      const face = z > d * 0.49 ? 0.25 : 1;
      const k = 0.34 * face;
      pa.setXYZ(i,
        x + hs(x, y, z) * w * k,
        y + hs(y, z, x) * h * k,
        z + hs(z, x, y) * d * k * 0.6);
    }
    const g = b.toNonIndexed();
    b.dispose();
    g.computeVertexNormals();
    return g;
  }
  const MASONRY = [0x8b9097, 0x70757e, 0x9aa0a8, 0xb0aa9c, 0x5c6168];
  /* WHAT THE BUILDING IS MADE OF. A piece off a red-brick house is red
     brick: two in three lumps wear the building's own wall material (the
     biggest opaque coloured mesh in its group, cached on the group), the
     third is the grey concrete core behind the facade. */
  function wallMatOfGroup(grp) {
    if (!grp) return null;
    const ud = grp.userData || (grp.userData = {});
    if (ud._quakeWallMat !== undefined) return ud._quakeWallMat;
    let best = null, bestN = -1;
    grp.traverse(function (o) {
      if (!o.isMesh || !o.material || Array.isArray(o.material) || o.material.transparent || !o.material.color) return;
      // a vertex-coloured merge paints its colour per vertex; a chunk has none
      // and would draw black in it
      if (o.material.vertexColors) return;
      if (o.material.emissive && o.material.emissive.getHex() !== 0 && o.material.emissiveIntensity > 0.2) return;
      const pa = o.geometry && o.geometry.attributes && o.geometry.attributes.position;
      const n = pa ? pa.count : 0;
      if (n > bestN) { bestN = n; best = o.material; }
    });
    ud._quakeWallMat = best;
    return best;
  }
  function pieceMat(kind, i, B) {
    if (kind === "glass") return CBZ.glass ? CBZ.glass({ opacity: 0.55 }) : new THREE.MeshLambertMaterial({ color: 0xcdeefb, transparent: true, opacity: 0.55 });
    if (B && B.group && (i % 3) !== 0) {
      const wm = wallMatOfGroup(B.group);
      if (wm) return wm;
    }
    const c = MASONRY[i % MASONRY.length];
    return CBZ.cmat ? CBZ.cmat(c) : new THREE.MeshLambertMaterial({ color: c });
  }

  /* One piece off one building. `sev` 0..1 is the caller's structural stage:
     it decides SIZE, MASS and whether what comes off is a window or a lump of
     the wall — a lightly cracked block loses glass, a critical one loses its
     facade. Spawns on the footprint PERIMETER, never in the middle of the
     roof, because that is where a facade actually detaches from. */
  function shedOne(B, sev, opts) {
    if (pieces.length >= MAX_PIECES) return null;
    opts = opts || {};
    let glassy = opts.kind ? opts.kind === "glass" : rnd() > 0.25 + sev * 0.55;
    /* WHERE IT COMES FROM. Mostly the facade EDGE, travelling outward — that
       is what makes the strip of pavement beside a building the kill zone.
       But a badly hurt building also fails INWARDS: ceiling slabs, light
       fittings, the tops of shelves. Without that share, debris could never
       reach anybody indoors, the table would never actually save a life, and
       "drop, cover, hold on" would be advice about a hazard that does not
       exist. So above the spalling stage a third of what lets go lets go over
       the floorplate, straight down, with no outward travel. */
    const interior = sev > 0.42 && rnd() < 0.34;
    if (interior) glassy = false;        // a ceiling slab is not a window pane
    const kind = glassy ? "glass" : "masonry";
    const side = (rnd() * 4) | 0;
    const t = rnd() - 0.5;
    let px, pz, nx, nz;
    if (interior) {
      px = B.x + (rnd() - 0.5) * B.w * 0.8;
      pz = B.z + (rnd() - 0.5) * B.d * 0.8;
      nx = 0; nz = 0;
    }
    else if (side === 0) { px = B.x + t * B.w; pz = B.z - B.d / 2; nx = 0; nz = -1; }
    else if (side === 1) { px = B.x + t * B.w; pz = B.z + B.d / 2; nx = 0; nz = 1; }
    else if (side === 2) { px = B.x - B.w / 2; pz = B.z + t * B.d; nx = -1; nz = 0; }
    else { px = B.x + B.w / 2; pz = B.z + t * B.d; nx = 1; nz = 0; }
    const fy = (opts.gy != null ? opts.gy : floorAt(B.x, B.z)) + B.h * (0.25 + rnd() * 0.72);
    // it comes OFF the wall, so it starts just proud of it and travels outward
    const out = 0.35 + rnd() * (glassy ? 1.1 : 2.0) * (0.4 + sev);
    // SIZE IS MASS IS LETHALITY, and it is also whether you can SEE the thing
    // that killed you. A facade panel is a metre-and-a-half slab of cladding,
    // not a pebble: the first pass of this shed at 0.45-1.6 m produced debris
    // that was invisible from across the street and read as grit.
    const size = glassy ? (0.7 + rnd() * 0.9) : (0.95 + rnd() * (1.1 + sev * 1.7));
    const geo = pieceGeo(kind, size);
    const m = new THREE.Mesh(geo, pieceMat(kind, Math.abs((px * 7 + pz * 13) | 0), B));
    m.position.set(px + nx * 0.3, fy, pz + nz * 0.3);
    m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    m.castShadow = !glassy;
    m.renderOrder = glassy ? 2 : 0;
    const host = opts.parent || scene();
    if (!host) return null;
    host.add(m);
    const rec = {
      mesh: m, kind: kind,
      x: m.position.x, y: fy, z: m.position.z,
      vx: nx * out, vy: opts.vy != null ? opts.vy : -0.4 - rnd() * 1.6, vz: nz * out,
      sx: (rnd() - 0.5) * 7, sz: (rnd() - 0.5) * 7,
      r: (glassy ? 0.55 : 0.5 + size * 0.55),
      // BLUNT FORCE, priced by mass: a pane cuts, a lump of wall crushes.
      dmg: glassy ? 16 + sev * 12 : 42 + sev * 46,
      lethal: !glassy,
      cause: glassy ? "cut down by falling glass" : "crushed by falling masonry",
      hit: false, t: 0, landed: 0,
    };
    pieces.push(rec);
    A.debrisSpawned++;
    return rec;
  }

  /* The CONTINUOUS form the caller ticks each frame. `rate` is pieces per
     second at sev 0; the stage multiplier is where the "about to collapse
     sheds hardest" rule lives, and it is a curve, not a threshold, so a
     building visibly gets worse rather than switching states. */
  function shedTick(t, dt, o) {
    if (CBZ.CONFIG.QUAKE_DEBRIS === false) return 0;
    const B = boxOf(t);
    if (!B) return 0;
    o = o || {};
    const sev = Math.max(0, Math.min(1, o.sev != null ? o.sev : 0));
    const face = 2 * (B.w + B.d);                        // facade metres
    const rate = (o.rate != null ? o.rate : 0.11) * face * (0.25 + sev * sev * 2.6) * (o.gain != null ? o.gain : 1);
    let n = 0;
    t._shedAcc = (t._shedAcc || 0) + rate * dt;
    while (t._shedAcc >= 1 && n < 4) {
      t._shedAcc -= 1;
      if (shedOne(B, sev, o)) n++;
    }
    if (n && rnd() < 0.14) sfxAt(sev > 0.5 ? "collapse" : "glass", B.x, B.z, { vol: 0.5 });
    return n;
  }

  /* The BURST form: a facade lets go all at once (a spall event, a pancake
     front reaching a floor). */
  function shed(t, o) {
    if (CBZ.CONFIG.QUAKE_DEBRIS === false) return 0;
    const B = boxOf(t);
    if (!B) return 0;
    o = o || {};
    const sev = Math.max(0, Math.min(1, o.sev != null ? o.sev : 0.5));
    const n = Math.max(1, o.count != null ? o.count : Math.round(4 + sev * 16));
    let k = 0;
    for (let i = 0; i < n; i++) if (shedOne(B, sev, o)) k++;
    if (k) sfxAt(sev > 0.5 ? "collapse" : "glass", B.x, B.z, {});
    return k;
  }

  // ---- the debris integrator (runs in survival AND city) ----------------
  function tickPieces(dt) {
    const g = (CBZ.TUNE && CBZ.TUNE.gravity) || 22;
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i];
      p.t += dt;
      if (!p.landed) {
        p.vy -= g * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.mesh.position.set(p.x, p.y, p.z);
        p.mesh.rotation.x += p.sx * dt;
        p.mesh.rotation.z += p.sz * dt;
        // THE STRIKE. A falling block hits you at head height on its way past,
        // which is the whole difference between this and a landing radius.
        if (!p.hit && p.vy < -2) {
          const self = p;
          eachActorNear(p.x, p.z, p.r + 0.55, function (a) {
            if (self.hit) return;
            const ay = (a.pos && a.pos.y) || 0;
            if (p.y > ay + 2.2 || p.y < ay - 0.4) return;      // passed above / already below
            self.hit = true;
            A.debrisHits++;
            const c = cover(a);
            if (c.exposure < 0.6) A.coverSaves++;   // the hit that cover paid for
            const dmg = self.dmg * c.exposure;
            // Under a solid table a masonry block is survivable — which is the
            // entire point of the advice, expressed as arithmetic.
            wound(a, dmg, self.cause, {
              x: self.x, z: self.z, fling: self.lethal ? 3 : 1, tag: "debris",
              lethal: self.lethal && c.exposure > 0.6,
            });
            // a pane LACERATES and a lump of wall is BLUNT — the two wound
            // vocabularies systems/wounds.js already draws, so a body that has
            // been hit by falling glass looks different from one that was
            // crushed, with no decal written here.
            if (CBZ.bodyWound) { try { CBZ.bodyWound(a, { x: self.x, y: ay + 1.5, z: self.z }, { melee: self.kind === "glass" ? "blade" : "blunt", fromX: self.x, fromZ: self.z }); } catch (e) {} }
          });
        }
        const fl = floorAt(p.x, p.z) + 0.16;
        if (p.y <= fl) {
          p.y = fl; p.mesh.position.y = fl; p.landed = p.t;
          p.mesh.rotation.x = (rnd() - 0.5) * 0.5;
          p.mesh.rotation.z = (rnd() - 0.5) * 0.5;
          if (p.kind === "glass") sfxAt("glass", p.x, p.z, { vol: 0.35 });
        }
      } else if (p.kind === "glass" && p.t - p.landed > 2.6) {
        // panes shatter out; masonry is RUBBLE and rubble stays (the aftermath
        // has to be readable long after the shaking stops)
        drop(p); pieces.splice(i, 1);
      } else if (pieces.length > MAX_PIECES * 0.72 && p.t - p.landed > 12) {
        // RUBBLE STAYS — that is what makes the aftermath readable minutes
        // later — but each landed chunk is a draw call, so once the pool is
        // three-quarters full the oldest settled pieces are recycled. The
        // ceiling on live draws is therefore ~120, not MAX_PIECES.
        drop(p); pieces.splice(i, 1);
      }
    }
  }
  function drop(p) {
    if (p.mesh && p.mesh.parent) p.mesh.parent.remove(p.mesh);
    // geometry + material are pooled/shared — never disposed here
  }
  function clearPieces() {
    for (let i = 0; i < pieces.length; i++) drop(pieces[i]);
    pieces.length = 0;
  }

  /* ============================================================
     RUPTURED GAS — the secondary killer.

     A city lot goes to CBZ.structure, which owns BURNING, the per-floor
     automaton, the wind bias and the load-path burn-through. Nothing about
     fire is modelled here. Off a lot (the island) a compact local flame
     stands in and hands its structural damage BACK to whoever owns that
     building's ledger, through the caller's own hook — so there is still
     exactly one ledger per world, it just isn't always this one's problem.
     ============================================================ */
  const localFires = [];
  const hooks = { structDamage: null };

  function gasFire(t, o) {
    if (CBZ.CONFIG.QUAKE_UTILITY === false) return false;
    const B = boxOf(t);
    if (!B) return false;
    o = o || {};
    // --- the shared road: a real lot, a real BURNING state ---
    if (B.lot && CBZ.structure && CBZ.structure.hit && CBZ.CONFIG.STRUCT_LEDGER !== false) {
      const storeys = Math.max(1, (B.lot.building && B.lot.building.storeys) || 1);
      const fl = Math.min(storeys - 1, o.floor != null ? o.floor : ((rnd() * Math.min(3, storeys)) | 0));
      const FH = (B.lot.building && B.lot.building.FH) || 3.2;
      try {
        // a gas main under a shaken building: a real, fuel-carrying ignition
        CBZ.structure.hit(B.x, fl * FH + 1.2, B.z, o.amount != null ? o.amount : 9, {
          kind: "quake-gas", lot: B.lot, fire: 0.6, sudden: false,
        });
        if (CBZ.structure.ignite) CBZ.structure.ignite(B.lot, fl);
        A.gasFires++; A.gasFiresShared++;
        sfxAt("fire", B.x, B.z, {});
        return true;
      } catch (e) { /* fall through to the local flame */ }
    }
    // --- the degrade road: a compact flame on the damaged facade ---
    if (t._quakeFire) return false;
    const gy = o.gy != null ? o.gy : floorAt(B.x, B.z);
    const side = (rnd() * 4) | 0;
    const fx = B.x + (side === 2 ? -B.w / 2 : side === 3 ? B.w / 2 : 0);
    const fz = B.z + (side === 0 ? -B.d / 2 : side === 1 ? B.d / 2 : 0);
    const fy = gy + Math.min(B.h - 1.2, 1.4 + rnd() * Math.max(1, B.h * 0.4));
    /* THE FLAME IS THE WILDFIRE'S FLAME. This used to be three additive
       cones stacked on the facade (red, orange, yellow, six sides each): a
       traffic cone glowing on the wall for ninety seconds. A gas fire out of
       a broken wall is a ragged sheet of tongues along the break, so it is
       drawn as a handful of the wildfire's own feathered point-sprite flames
       spread along the face, each licking on its own seed. */
    const grp = new THREE.Group();
    const F = [];
    const fmat = CBZ.wildfire && CBZ.wildfire.flameMaterial ? CBZ.wildfire.flameMaterial() : null;
    if (fmat) {
      const N = 7, P = new Float32Array(N * 3), S = new Float32Array(N), A = new Float32Array(N), Sd = new Float32Array(N);
      const along = side < 2 ? 1 : 0;              // the wall runs along x on the -z/+z faces
      for (let i = 0; i < N; i++) {
        const u = (i / (N - 1) - 0.5) * 3.2 + (rnd() - 0.5) * 0.5;
        P[i * 3] = along ? u : (side === 2 ? -0.35 : 0.35);
        P[i * 3 + 1] = 0.2 + rnd() * 0.9;
        P[i * 3 + 2] = along ? (side === 0 ? -0.35 : 0.35) : u;
        S[i] = 1.6 + rnd() * 1.6; A[i] = 0.85; Sd[i] = rnd();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(P, 3));
      g.setAttribute("aSize", new THREE.BufferAttribute(S, 1));
      g.setAttribute("aAlpha", new THREE.BufferAttribute(A, 1).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute("aSeed", new THREE.BufferAttribute(Sd, 1));
      const pts = new THREE.Points(g, fmat);
      pts.frustumCulled = false; pts.renderOrder = 8;
      grp.add(pts); F.push(pts);
    }
    grp.position.set(fx, fy, fz);
    if (scene()) scene().add(grp);
    const smoke = CBZ.fx && CBZ.fx.particleCloud
      ? CBZ.fx.particleCloud({ mode: "rise", color: 0x2b2622, count: 90, radius: 3.2, top: 26, size: 0.6, opacity: 0.38, vMin: 3.5, vMax: 7, drift: 4 })
      : null;
    if (smoke) smoke.setActive(0.75);
    const rec = {
      t: t, grp: grp, F: F, smoke: smoke, x: fx, y: fy, z: fz, age: 0,
      nx: side === 2 ? -1 : side === 3 ? 1 : 0, nz: side === 0 ? -1 : side === 1 ? 1 : 0,
      life: o.life != null ? o.life : 90,
    };
    localFires.push(rec);
    t._quakeFire = rec;
    A.gasFires++;
    sfxAt("fire", fx, fz, {});
    return true;
  }

  function tickFires(dt) {
    for (let i = localFires.length - 1; i >= 0; i--) {
      const f = localFires[i];
      f.age += dt;
      const k = 0.6 + 0.4 * Math.sin(now() * 0.021 + i * 1.7);
      const ps = Math.max(1, ((CBZ.renderer && CBZ.renderer.domElement && CBZ.renderer.domElement.height) || 640) * 0.5);
      // it dies down over its last fifteen seconds instead of blinking out
      const fade = Math.max(0, Math.min(1, (f.life - f.age) / 15));
      for (let j = 0; j < f.F.length; j++) {
        const u = f.F[j].material.uniforms;
        if (u) { u.uTime.value = f.age; u.uScale.value = ps * (0.85 + 0.15 * k); }
        const al = f.F[j].geometry.attributes.aAlpha;
        if (al) { for (let q = 0; q < al.count; q++) al.array[q] = 0.85 * fade; al.needsUpdate = true; }
      }
      if (f.smoke) f.smoke.update(dt, f.x, f.y + 2, f.z);
      // fire is what turns a survivable hit into a fatal one — it eats the
      // building's OWN ledger, through whoever owns it
      if (hooks.structDamage) { try { hooks.structDamage(f.t, 0.028 * dt); } catch (e) {} }
      // and it burns anyone who stands in it
      eachActorNear(f.x, f.z, 3.4, function (a) {
        wound(a, 26 * dt, "burned in a gas fire", { x: f.x, z: f.z, lethal: false, tag: "fire" });
      });
      if (f.age > f.life) { killFire(f); localFires.splice(i, 1); }
    }
  }
  function killFire(f) {
    if (f.grp && f.grp.parent) f.grp.parent.remove(f.grp);
    for (let j = 0; j < f.F.length; j++) { if (f.F[j].geometry) f.F[j].geometry.dispose(); if (f.F[j].material) f.F[j].material.dispose(); }
    if (f.smoke) f.smoke.dispose();
    if (f.t) f.t._quakeFire = null;
  }

  /* ============================================================
     SEVERED POWER — the other secondary killer, and the reason "open ground"
     is not a complete answer.

     A pole falls OUTWARD, away from the structure it stands beside, because
     that is the direction nothing is holding it. The conductor comes down
     with it and lies across the ground still live, arcing at the break. Touch
     it and you are electrocuted.
     ============================================================ */
  const lines = [];
  const POLE_H = 9.4, POLE_RT = 0.135, POLE_RB = 0.205, ARM_Y = 8.45, ARM_SPAN = 2.3;

  /* A pole, drawn to world/utility_lines.js's authored dimensions (that file
     is an InstancedMesh detail-kit pass bound to the city build, so it cannot
     hand us a single toppleable instance — but its numbers are the right
     numbers and a pole that disagreed with the ones down the street would be
     the same "two constants describing one object" fault that file exists to
     cure).

     It was five separate meshes: a grey-brown cylinder, a box crossarm and
     three little glass BOXES on top, i.e. a stick with three sugar cubes, and
     nothing connecting it to anything. Now it is ONE mesh with colour per
     vertex (one shared material, geometry built once and shared by every
     pole): a creosoted tapered shaft, ground-stained at the butt, a weathered
     crossarm on steel braces, three glass pin insulators on steel pins, a
     transformer can with its bushings on the house side, climbing steps, and
     a SERVICE DROP, the sagging pair of wires that runs from the can to a
     weatherhead on the wall of the building the pole stands beside, which is
     the reason the pole is there. The drop lives in its own geometry variant:
     when the pole goes down the mesh swaps to the bare variant (the drop has
     snapped) and dropLine lays the live conductor on the ground. */
  const DROP_LEN = 5.2;               // the arena kit stands its poles 5.2 m off the wall
  let poleMat = null;
  const poleGeos = {};
  function poleMaterial() {
    if (poleMat) return poleMat;
    poleMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    poleMat.name = "quake-utility-pole";
    const maps = CBZ.surfaceMaps ? CBZ.surfaceMaps("wood", { repeat: 1 }) : null;
    if (maps && maps.map) {
      poleMat.map = maps.map;
      const mn = CBZ.surfaceMapMean ? CBZ.surfaceMapMean(maps.map) : [1, 1, 1];
      poleMat.color.setRGB(1 / Math.max(0.02, mn[0]), 1 / Math.max(0.02, mn[1]), 1 / Math.max(0.02, mn[2]));
    }
    return poleMat;
  }
  function poleGeometry(withDrop) {
    const key = withDrop ? "drop" : "bare";
    if (poleGeos[key]) return poleGeos[key];
    const parts = [];
    // colour per vertex (+ a darkening below `ao` m) and box-projected UVs in
    // metres, so the wood map reads at real scale on the shaft and the arm
    function put(g, rgb, ao) {
      const src = g.index ? g.toNonIndexed() : g;
      const P = src.attributes.position, n = P.count;
      const col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3();
      for (let i = 0; i < n; i += 3) {
        a.fromBufferAttribute(P, i); b.fromBufferAttribute(P, i + 1); c.fromBufferAttribute(P, i + 2);
        fn.crossVectors(b.clone().sub(a), c.clone().sub(a));
        const ax = Math.abs(fn.x), ay = Math.abs(fn.y), az = Math.abs(fn.z);
        for (let k = 0; k < 3; k++) {
          const v = k === 0 ? a : k === 1 ? b : c, j = i + k;
          let u, w;
          if (ay >= ax && ay >= az) { u = v.x; w = v.z; } else if (ax >= az) { u = v.z; w = v.y; } else { u = v.x; w = v.y; }
          uv[j * 2] = u / 0.9; uv[j * 2 + 1] = w / 2.4;
          const f = ao != null ? 1 - 0.45 * (1 - Math.max(0, Math.min(1, v.y / ao))) : 1;
          col[j * 3] = rgb[0] * f; col[j * 3 + 1] = rgb[1] * f; col[j * 3 + 2] = rgb[2] * f;
        }
      }
      src.setAttribute("color", new THREE.BufferAttribute(col, 3));
      src.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      parts.push(src);
    }
    const CREOSOTE = [0.075, 0.052, 0.034], ARMWOOD = [0.15, 0.13, 0.105], STEEL = [0.2, 0.21, 0.22];
    const GLASSC = [0.2, 0.33, 0.3], CAN = [0.3, 0.31, 0.32], WIRE = [0.012, 0.012, 0.014];
    // shaft
    put(new THREE.CylinderGeometry(POLE_RT, POLE_RB, POLE_H, 10).translate(0, POLE_H / 2, 0), CREOSOTE, 0.8);
    // crossarm on two steel flat braces
    put(new THREE.BoxGeometry(ARM_SPAN, 0.1, 0.12).translate(0, ARM_Y, 0.19), ARMWOOD);
    for (const s of [-1, 1]) {
      const br = new THREE.BoxGeometry(0.035, 0.95, 0.02);
      br.rotateZ(s * -0.72); br.translate(s * 0.3, ARM_Y - 0.36, 0.14);
      put(br, STEEL);
    }
    // three pin insulators: steel pin, a glass skirt and a glass crown
    for (let i = -1; i <= 1; i++) {
      const ix = i * (ARM_SPAN / 2 - 0.2);
      put(new THREE.CylinderGeometry(0.014, 0.014, 0.16, 5).translate(ix, ARM_Y + 0.12, 0.19), STEEL);
      put(new THREE.CylinderGeometry(0.05, 0.075, 0.08, 10).translate(ix, ARM_Y + 0.2, 0.19), GLASSC);
      put(new THREE.CylinderGeometry(0.035, 0.05, 0.09, 10).translate(ix, ARM_Y + 0.285, 0.19), GLASSC);
    }
    // transformer can on the house side (-z), with a lid and two bushings
    const CY = 6.7;
    put(new THREE.CylinderGeometry(0.25, 0.25, 0.85, 12).translate(0, CY, -0.47), CAN);
    put(new THREE.CylinderGeometry(0.27, 0.27, 0.05, 12).translate(0, CY + 0.45, -0.47), CAN);
    put(new THREE.BoxGeometry(0.1, 0.5, 0.2).translate(0, CY, -0.24), STEEL);          // hanger bracket
    for (const s of [-1, 1]) put(new THREE.CylinderGeometry(0.025, 0.035, 0.14, 6).translate(s * 0.1, CY + 0.54, -0.5), GLASSC);
    // climbing steps, staggered either side
    for (let k = 0; k < 9; k++) {
      const y = 2.6 + k * 0.5, s = k % 2 ? 1 : -1;
      put(new THREE.CylinderGeometry(0.012, 0.012, 0.24, 4).rotateZ(Math.PI / 2).translate(s * (POLE_RB * 0.9), y, 0), STEEL);
    }
    if (withDrop) {
      // the service drop: two conductors sagging from the can's bushings to a
      // weatherhead on the wall DROP_LEN behind the pole
      const WALL_Y = 3.1;
      for (const s of [-1, 1]) {
        const pts = [];
        const x0 = s * 0.1, y0 = CY + 0.58, z0 = -0.5, x1 = s * 0.06, y1 = WALL_Y + 0.35, z1 = -DROP_LEN + 0.08;
        for (let k = 0; k <= 10; k++) {
          const t = k / 10;
          const sag = 0.55 * 4 * t * (1 - t);
          pts.push(new THREE.Vector3(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - sag, z0 + (z1 - z0) * t));
        }
        put(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.012, 4, false), WIRE);
      }
      // weatherhead: a short service mast on the wall with its hood
      put(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6).translate(0, WALL_Y, -DROP_LEN + 0.06), STEEL);
      put(new THREE.CylinderGeometry(0.06, 0.04, 0.1, 6).translate(0, WALL_Y + 0.48, -DROP_LEN + 0.06), STEEL);
    }
    const BGU = THREE.BufferGeometryUtils;
    const g = BGU && BGU.mergeBufferGeometries ? BGU.mergeBufferGeometries(parts.map(function (p) {
      // TubeGeometry / Cylinder carry normals; strip anything else so the merge lines up
      for (const k of Object.keys(p.attributes)) if (k !== "position" && k !== "normal" && k !== "color" && k !== "uv") p.deleteAttribute(k);
      return p;
    }), false) : parts[0];
    g.computeBoundingSphere();
    poleGeos[key] = g;
    return g;
  }
  function poleGroup(x, y, z, yaw) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(poleGeometry(true), poleMaterial());
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    g.userData.poleMesh = m;
    g.position.set(x, y, z); g.rotation.y = yaw || 0;
    return g;
  }

  /* Register a standing pole this file OWNS (the arena kit does; the city's
     instanced poles cannot be owned, and dropLine() handles that case by
     snapping the CONDUCTOR off a pole that stays up — which is what usually
     happens anyway). */
  const poles = [];
  function poleAdd(x, y, z, yaw, fx, fz) {
    const g = poleGroup(x, y, z, yaw);
    if (scene()) scene().add(g);
    const c = { minX: x - 0.24, maxX: x + 0.24, minZ: z - 0.24, maxZ: z + 0.24, ref: g, y0: y, y1: y + POLE_H };
    if (CBZ.colliders) { CBZ.colliders.push(c); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
    const rec = { g: g, x: x, y: y, z: z, fx: fx, fz: fz, collider: c, down: false };
    poles.push(rec); A.kitPoles = poles.length;
    return rec;
  }

  /* The live conductor on the ground: not a straight bar but a wire that
     landed, snaking a little either side of the fall line (deterministic per
     pole), one thin tube, one draw. */
  function groundWireGeo(x, z, tipX, tipZ, gy, len) {
    const pts = [];
    const ux = (tipX - x) / (len || 1), uz = (tipZ - z) / (len || 1);
    const h = CBZ.hash01 ? CBZ.hash01(x, z, 0x51d) : 0.5;
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      const w = Math.sin(t * Math.PI * (2 + h * 2) + h * 6) * 0.35 * Math.sin(t * Math.PI);
      const px = x + (tipX - x) * t - uz * w, pz = z + (tipZ - z) * t + ux * w;
      const lift = k === 0 ? 0.5 : 0.04;               // it leaves the butt of the pole
      pts.push(new THREE.Vector3(px, (floorAt(px, pz) || gy) + lift, pz));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 36, 0.03, 5, false);
  }
  /* The arc: a crackling blue-white star, drawn on a small canvas once and
     shown on three crossed planes so it reads from every side. It was an
     additive SPHERE, which reads as a lamp. */
  let arcTex = null;
  function arcTexture() {
    if (arcTex !== null) return arcTex;
    arcTex = undefined;
    try {
      const S = 128, cv = document.createElement("canvas");
      cv.width = cv.height = S;
      const c2 = cv.getContext("2d");
      const gr = c2.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.12, "rgba(210,235,255,0.95)");
      gr.addColorStop(0.35, "rgba(120,170,255,0.35)"); gr.addColorStop(1, "rgba(60,90,255,0)");
      c2.fillStyle = gr; c2.fillRect(0, 0, S, S);
      c2.strokeStyle = "rgba(235,245,255,0.9)"; c2.lineWidth = 1.6;
      let seed = 7;
      const r = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let k = 0; k < 7; k++) {
        const a0 = r() * Math.PI * 2;
        let px = S / 2, py = S / 2;
        c2.beginPath(); c2.moveTo(px, py);
        for (let s = 0; s < 6; s++) {
          const a = a0 + (r() - 0.5) * 1.2, d = 5 + r() * 6;
          px += Math.cos(a) * d; py += Math.sin(a) * d; c2.lineTo(px, py);
        }
        c2.stroke();
      }
      arcTex = new THREE.CanvasTexture(cv);
    } catch (e) { arcTex = undefined; }
    return arcTex;
  }
  function arcMesh() {
    const planes = [];
    for (let k = 0; k < 3; k++) {
      const p = new THREE.PlaneGeometry(1.4, 1.4);
      if (k === 1) p.rotateY(Math.PI / 2);
      if (k === 2) p.rotateX(Math.PI / 2);
      planes.push(p);
    }
    const BGU = THREE.BufferGeometryUtils;
    const geo = BGU && BGU.mergeBufferGeometries ? BGU.mergeBufferGeometries(planes, false) : planes[0];
    const tex = arcTexture();
    const mat = new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.9, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, map: tex || null, fog: false });
    return new THREE.Mesh(geo, mat);
  }

  /* Bring one down. `pole` may be a record from poleAdd, or null — in which
     case (x,z) is a pole we do not own (a city instance) and only the
     conductor comes down, which is the honest read: the timber stands, the
     crossarm lets go, the line is on the road. */
  function dropLine(o) {
    if (CBZ.CONFIG.QUAKE_UTILITY === false) return null;
    o = o || {};
    const P = o.pole || null;
    const x = P ? P.x : o.x, z = P ? P.z : o.z;
    if (x == null || z == null) return null;
    if (P && P.down) return null;
    const gy = floorAt(x, z);
    // OUTWARD: away from the nearest structure. That is the physics AND the
    // gameplay — the line lands in the open ground people ran to.
    let fx = o.fx, fz = o.fz;
    if (fx == null || fz == null) {
      if (P && P.fx != null) { fx = P.fx; fz = P.fz; }
      else { const a = rnd() * 6.28; fx = Math.cos(a); fz = Math.sin(a); }
    }
    const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    const reach = POLE_H * 0.82;
    const tipX = x + fx * reach, tipZ = z + fz * reach;
    // the conductor on the deck: a wire from the pole base out to the arcing
    // break, lying the way a dropped wire lies, one draw
    const wireLen = Math.hypot(tipX - x, tipZ - z);
    const wire = new THREE.Mesh(groundWireGeo(x, z, tipX, tipZ, gy, wireLen),
      CBZ.cmat ? CBZ.cmat(0x14161a) : new THREE.MeshLambertMaterial({ color: 0x14161a }));
    if (scene()) scene().add(wire);
    // the service drop snapped with it
    if (P && P.g && P.g.userData.poleMesh) P.g.userData.poleMesh.geometry = poleGeometry(false);
    // the arc at the break — additive, and it FLICKERS, because a steady glow
    // reads as a lamp and a stuttering one reads as a fault
    const spark = arcMesh();
    spark.position.set(tipX, gy + 0.3, tipZ);
    spark.renderOrder = 8;
    if (scene()) scene().add(spark);
    const rec = {
      pole: P, x: x, z: z, gy: gy, fx: fx, fz: fz, len: wireLen,
      wire: wire, spark: spark, fall: 0, t: 0,
    };
    if (P) {
      P.down = true;
      // pull its collider: a pole on the ground is not a pole you walk into
      if (CBZ.colliders && P.collider) {
        const i = CBZ.colliders.indexOf(P.collider);
        if (i >= 0) { CBZ.colliders.splice(i, 1); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
      }
    }
    lines.push(rec);
    A.linesDown++;
    sfxAt("collapse", x, z, {});
    return rec;
  }

  function tickLines(dt) {
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      L.t += dt;
      // the pole tips over its base in ~1.1 s, eased so it accelerates
      if (L.pole && L.fall < 1) {
        L.fall = Math.min(1, L.fall + dt / 1.1);
        // 0.98 of a right angle, not 0.94: at 9.4 m the missing 5 deg left the
        // far end of the pole standing 0.88 m off the road, which reads as a
        // pole hovering rather than a pole down.
        const a = (L.fall * L.fall) * (Math.PI / 2) * 0.98;
        const g = L.pole.g;
        g.rotation.y = Math.atan2(L.fx, L.fz);
        g.rotation.x = a;                       // falls along its own local +Z
        if (L.fall >= 1) {
          sfxAt("collapse", L.x, L.z, {});
          if (CBZ.shake) CBZ.shake(0.14);
        }
      }
      // ARC. Irregular on purpose.
      const f = Math.max(0, Math.sin(L.t * 11.3) * Math.sin(L.t * 3.1) + 0.35 * Math.sin(L.t * 27.7));
      L.spark.material.opacity = 0.15 + 0.85 * Math.max(0, f);
      const s = 0.7 + f * 0.9;
      L.spark.scale.set(s, s, s);
      if (f > 0.9 && rnd() < 0.05) sfxAt("thunder", L.spark.position.x, L.spark.position.z, { vol: 0.25 });
      // TOUCHING IT KILLS YOU. Sampled along the conductor, not just at the
      // tip: the whole downed span is live.
      const steps = Math.max(2, Math.round(L.len / 2.4));
      for (let s2 = 0; s2 <= steps; s2++) {
        const u = s2 / steps;
        const px = L.x + L.fx * L.len * u, pz = L.z + L.fz * L.len * u;
        eachActorNear(px, pz, 1.25, function (a) {
          wound(a, 44 * dt, "electrocuted on a downed line", { x: px, z: pz, lethal: false, tag: "line" });
          if (CBZ.body && CBZ.body.flash) { try { CBZ.body.flash(a); } catch (e) {} }
        });
      }
    }
  }
  function clearLines() {
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      if (L.wire && L.wire.parent) L.wire.parent.remove(L.wire);
      if (L.wire && L.wire.geometry) L.wire.geometry.dispose();
      if (L.spark && L.spark.parent) L.spark.parent.remove(L.spark);
      if (L.spark) { L.spark.geometry.dispose(); L.spark.material.dispose(); }
    }
    lines.length = 0;
  }
  function clearPoles() {
    for (let i = 0; i < poles.length; i++) {
      const P = poles[i];
      if (P.g && P.g.parent) P.g.parent.remove(P.g);
      if (CBZ.colliders && P.collider) {
        const k = CBZ.colliders.indexOf(P.collider);
        if (k >= 0) CBZ.colliders.splice(k, 1);
      }
    }
    poles.length = 0; A.kitPoles = 0;
  }
  // The nearest standing pole to a point, so a caller can bring down the one
  // beside the person rather than one across the island.
  function poleNear(x, z, maxD) {
    let best = null, bd = (maxD || 60) * (maxD || 60);
    for (let i = 0; i < poles.length; i++) {
      const P = poles[i];
      if (P.down) continue;
      const dx = P.x - x, dz = P.z - z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = P; }
    }
    return best;
  }

  /* ============================================================
     THE ARENA KIT — the two props the survival lesson needs to exist.

     "Get under a table" and "mind the power line" need a table and a line.
     The TABLES are the island's own now: world/disaster_arena.js furnishes
     every house and tower as it builds it (a dining table by a window, a desk
     upstairs, a table in a tower lobby: arranged rooms, not a table dropped
     wherever it fit) and publishes the sturdy pieces as b.interior.covers.
     This registers those, and lays the utility POLES, deterministically
     (CBZ.hash01 of each building's own position — a build path never touches
     Math.random), once per arena.

     It used to DRAW the tables here, into each building's group, at the first
     survival frame. dressArena() re-runs after every mode change (reset()
     clears `dressedArena`), and the arena is built once and kept, so every
     trip to the menu and back stacked another set of tables and another set
     of colliders into every house on the island.
     ============================================================ */
  let dressedArena = null;
  function h01(x, z, s) { return CBZ.hash01 ? CBZ.hash01(x, z, s) : 0.5; }

  function dressArena(A2) {
    if (!A2 || CBZ.CONFIG.QUAKE_ARENA_KIT === false) return;
    if (dressedArena === A2) return;
    dressedArena = A2;
    coverReset(); clearPoles(); clearPieces();
    dressArenaInner(A2);
  }
  function dressArenaInner(A2) {
    const frag = A2.fragile || [];
    for (let i = 0; i < frag.length; i++) {
      const b = frag[i];
      if (!b || b.fallen || !b.group) continue;
      // the building's own tables and desks, already standing in its rooms
      const cv = b.interior && b.interior.covers;
      if (cv) for (let k = 0; k < cv.length; k++) {
        coverAdd(cv[k].x, cv[k].y, cv[k].z, cv[k].r, "table", b);
        A.kitTables++;
      }
      // ---- A UTILITY POLE beside roughly a third of buildings -----------
      // It stands in the street on the building's OWN outward bearing, so
      // when it comes down it falls AWAY from the wall — across exactly the
      // ground somebody fleeing the facade is standing on.
      if (h01(b.x, b.z, 0x9a21) < 0.34) {
        const which = (h01(b.x, b.z, 0x9a22) * 4) | 0;
        const nx = which === 2 ? -1 : which === 3 ? 1 : 0;
        const nz = which === 0 ? -1 : which === 1 ? 1 : 0;
        const px = b.x + nx * (b.w / 2 + 5.2), pz = b.z + nz * (b.d / 2 + 5.2);
        /* NOT IN THE CARRIAGEWAY, NOT THROUGH A FENCE. The service drop is
           DROP_LEN long, so the pole's spot is fixed 5.2 m off the wall; on
           a street-facing side that was the middle of the road, and on a yard
           side it could stand in the fence line. Such a side gets no pole. */
        if (A2.onRoad && A2.onRoad(px, pz, 0.8, 0.8)) continue;
        const fl = A2.dressing && A2.dressing.fences;
        let inFence = false;
        if (fl) for (let q = 0; q < fl.length && !inFence; q++) {
          const f = fl[q];
          if (px > Math.min(f.x0, f.x1) - 0.6 && px < Math.max(f.x0, f.x1) + 0.6 && pz > Math.min(f.z0, f.z1) - 0.6 && pz < Math.max(f.z0, f.z1) + 0.6) inFence = true;
        }
        if (inFence) continue;
        const py = A2.groundHeightAt ? A2.groundHeightAt(px, pz) : 0;
        poleAdd(px, py, pz, Math.atan2(nx, nz), nx, nz);
      }
    }
  }

  /* ============================================================
     THE CITY EVENT (CITY_QUAKE, default OFF).

     Everything above is mode-agnostic, so the city's quake is a THIN driver
     over it: shake, sweep CBZ.structure so real lots take real staged damage,
     shed off whatever is standing near the player, then the gas and the
     lines. It authors no damage model, no fire and no collapse — those are
     structural.js's, which is exactly the point of keeping the core here
     instead of inside the survival def.
     ============================================================ */
  const city = { on: false, t: 0, dur: 0, mag: 0, x: 0, z: 0, lots: [], phase: "main", after: 0, nextAfter: 0 };

  function cityStart(o) {
    o = o || {};
    if (!CBZ.CONFIG.CITY_QUAKE) return false;
    if (!inCity()) return false;
    const arena = CBZ.city && (CBZ.city.arena || CBZ.city);
    if (!arena || !arena.lots) return false;
    city.on = true; city.t = 0;
    city.mag = o.mag != null ? o.mag : 0.75;
    city.dur = o.secs != null ? o.secs : 22;
    const P = CBZ.player && CBZ.player.pos;
    city.x = o.x != null ? o.x : (P ? P.x : 0);
    city.z = o.z != null ? o.z : (P ? P.z : 0);
    city.phase = "main"; city.after = 0; city.nextAfter = 6;
    // the shakeable set: lots within a working radius of the player, so a
    // continental quake still costs one bounded loop per frame
    city.lots = [];
    const R = o.radius != null ? o.radius : 220;
    for (let i = 0; i < arena.lots.length; i++) {
      const L = arena.lots[i];
      if (!L || !L.building || L.demolished) continue;
      if (Math.hypot(L.building.ox - city.x, L.building.oz - city.z) > R) continue;
      city.lots.push(L);
    }
    liveStructures = city.lots;
    return true;
  }
  function cityStop() {
    city.on = false; city.lots = []; if (liveStructures === city.lots) liveStructures = null;
  }
  function citySeverity(L) {
    if (!CBZ.structure || !CBZ.structure.state) return 0.2;
    try {
      const st = CBZ.structure.state(L);
      return st ? Math.min(1, (st.stage || 0) / 5) : 0;
    } catch (e) { return 0.2; }
  }
  function cityTick(dt) {
    if (!city.on) return;
    city.t += dt;
    const k = city.phase === "main" ? 1 : Math.max(0, 1 - city.after / 3.2);
    if (CBZ.shake) CBZ.shake(0.12 + 0.45 * city.mag * k);
    // load every standing lot, then shed off the ones that took it worst
    for (let i = 0; i < city.lots.length; i++) {
      const L = city.lots[i];
      if (!L || L.demolished) continue;
      if (CBZ.structure && CBZ.structure.hit && k > 0.05) {
        const b = L.building;
        try {
          CBZ.structure.hit(b.ox, 1.5, b.oz, 5.5 * city.mag * k * dt, { kind: "quake", lot: L, sudden: true });
        } catch (e) {}
      }
      const sev = citySeverity(L);
      if (sev > 0.05) shedTick(L, dt, { sev: sev, gain: 0.35 * k });
    }
    if (city.phase === "main" && city.t > city.dur * 0.6) {
      city.phase = "after"; city.after = 0;
      cityAftermath();
    } else if (city.phase === "after") {
      city.after += dt;
      if (city.after > city.nextAfter) { city.after = 0; city.nextAfter *= 1.6; A.shocks++; if (CBZ.shake) CBZ.shake(0.5 * city.mag); }
    }
    if (city.t > city.dur) cityStop();
  }
  function cityAftermath() {
    // 1-3 gas fires at the worst-hit lots, and two poles down.
    const ranked = city.lots.slice().sort(function (a, b) { return citySeverity(b) - citySeverity(a); });
    const n = 1 + ((rnd() * 3) | 0);
    for (let i = 0; i < Math.min(n, ranked.length); i++) gasFire(ranked[i], {});
    const census = CBZ.streetPoleCensus ? CBZ.streetPoleCensus() : null;
    if (census && census.poles && census.poles.length) {
      for (let i = 0; i < 2; i++) {
        const P = census.poles[(rnd() * census.poles.length) | 0];
        if (P) dropLine({ x: P.x, z: P.z });
      }
    }
  }

  /* ============================================================
     GROUND MOTION — THE WAVE TRAIN (magnitude in, felt quake out).

     The old quake fed CBZ.shake a linear ramp that then decayed — a
     machine's envelope, and the same envelope every time. A real quake is
     a WAVE TRAIN, and the ORDER OF ARRIVALS is the experience:

       P     the compressional wave arrives first: a sharp vertical BANG,
             a second or two of "was that a truck?" — small, fast, high
             frequency.
       S     the shear waves arrive sLag seconds later: the violent lateral
             rolling that does all the damage. A rise, sustained strong
             motion for mainDur, then
       coda  an exponential tail as the scattered energy rings out,
             punctured by AFTERSHOCKS — each a miniature train of its own,
             decaying in size and count over the round (Båth's law: the
             biggest aftershock runs ~1.2 magnitudes under the mainshock).

     MAGNITUDE IS THE ONLY INPUT, in real Richter units, and everything is
     derived from it the way the ground actually scales — PGA, duration
     (the big one: it roughly doubles per magnitude unit), frequency
     content (big quakes ROLL at ~1 Hz, small ones BUZZ at ~5), aftershock
     count, and whether liquefaction / surface rupture happen at all:

       M4.2  PGA 0.03 g · ~4 s of 5 Hz rattle    · damages nothing
       M6.0  PGA 0.18 g · ~15 s                  · you stagger, facades crack
       M7.0  PGA 0.45 g · ~28 s                  · knocked down at the peak
       M8.3  PGA 0.92 g · ~60 s of 0.9 Hz rolling you cannot stand through
                          · liquefaction, surface rupture, tsunamigenic

     The synthesizer owns FOOTING too: the live ground acceleration
     staggers every actor through CBZ.body.hit and knocks them down through
     CBZ.body.knockdown — the WORLD's reaction to the ground, not a screen
     effect. A body holding onto a table (_quakeDuck) keeps its feet;
     that is what the "hold on" third of the advice buys.

     Camera: camera.js's CBZ.shake is a white-noise latch with a fast
     real-time decay, so frequency content is carried in the ENVELOPE fed
     to it — a slow |sin| carrier at f0 makes an M8 visibly ROLL where an
     M4 buzzes. No camera code changed.
     ============================================================ */
  function lerpTable(M, tab) {
    // tab = [[M, v], ...] ascending
    if (M <= tab[0][0]) return tab[0][1];
    for (let i = 1; i < tab.length; i++) {
      if (M <= tab[i][0]) {
        const u = (M - tab[i - 1][0]) / (tab[i][0] - tab[i - 1][0]);
        return tab[i - 1][1] + (tab[i][1] - tab[i - 1][1]) * u;
      }
    }
    return tab[tab.length - 1][1];
  }
  /* Everything a magnitude implies, in one record. Pure: same M, same
     numbers, so the def, the synth and any tool all read one derivation. */
  function magParams(M) {
    M = Math.max(4, Math.min(8.6, M));
    // PGA in g, off the felt-report anchors (M4 barely instrumental, M8 ~1 g
    // near-field). This is the number footing and damage both key off.
    const pgaG = lerpTable(M, [[4, 0.02], [5, 0.06], [6, 0.18], [7, 0.45], [8, 0.85], [8.6, 1.15]]);
    const pga01 = Math.min(1, pgaG);
    // camera-shake metres at the peak of the S phase (CBZ.shake units)
    const ampPeak = 0.04 + Math.pow(pga01, 1.25) * 1.35;
    // dominant frequency: source dimension grows with M, corner frequency
    // falls — an M4 rattles the crockery at ~5.5 Hz, an M8.6 rolls at ~0.6
    const f0 = 5.5 * Math.pow(0.62, M - 4);
    // strong-motion duration ~doubles per magnitude unit. THE BIG ONE.
    const mainDur = Math.min(70, 4 * Math.pow(1.9, M - 4));
    const sLag = 1.2 + (M - 4) * 0.6;          // P→S gap: bigger rupture, farther fault
    const pDur = 0.7 + (M - 4) * 0.22;
    const riseT = Math.min(5, 1 + mainDur * 0.1);
    const codaTau = 1.2 + (M - 4) * 1.9;
    const nShocks = Math.max(0, Math.min(8, Math.round((M - 4.6) * 2.2)));
    // damage scaling: below ~M5.2 a quake damages NOTHING — that is what
    // makes a small one genuinely fun instead of a shorter disaster
    const dmgK = M < 5.2 ? 0 : Math.min(1.6, (M - 5.2) / 2.0);
    const collapseFrac = M < 5.6 ? 0 : Math.min(0.5, Math.pow((M - 5.6) / 3, 1.4) * 0.6);
    const shockWindow = nShocks ? 4 + nShocks * 3 : 0;
    const activeSecs = Math.round(Math.max(12, Math.min(110,
      sLag + mainDur + Math.max(codaTau * 3, shockWindow) + 6)));
    return {
      M: M, pgaG: pgaG, pga01: pga01, ampPeak: ampPeak, f0: f0,
      mainDur: mainDur, sLag: sLag, pDur: pDur, riseT: riseT,
      codaTau: codaTau, nShocks: nShocks, dmgK: dmgK,
      collapseFrac: collapseFrac, activeSecs: activeSecs,
      liq: M >= 7.2, rupture: M >= 7.8, tsunamigenic: M >= 7.4,
    };
  }

  // one-shot magnitude override for tools/storyboards (NOT a config flag:
  // consumed by the next roll and gone)
  let forcedMag = null;

  const motion = {
    on: false, t: 0, p: null, cx: 0, cz: 0, R: 120,
    shocks: [], shockFired: 0, phase: "quiet", amp: 0, pgaNow: 0,
  };
  function motionStart(p, o) {
    o = o || {};
    motion.on = true; motion.t = 0; motion.p = p;
    motion.cx = o.cx || 0; motion.cz = o.cz || 0; motion.R = o.R || 120;
    motion.phase = "quiet"; motion.amp = 0; motion.pgaNow = 0; motion.shockFired = 0;
    // the aftershock schedule, drawn now from the shared seeded stream so
    // every client agrees when the ground moves again. Times are seconds
    // into the tail (after mainshock end); sizes fall off Båth-style.
    motion.shocks = [];
    let at = 1.5 + rnd() * 3;
    for (let i = 0; i < p.nShocks; i++) {
      motion.shocks.push({
        at: at,
        k: 0.38 * Math.pow(0.78, i) * (0.8 + rnd() * 0.4),   // fraction of ampPeak
        dur: 1.6 + p.mainDur * 0.04 + rnd() * 1.2,
        fired: false,
      });
      at += 2.2 + rnd() * 4 + i * 0.8;
    }
    A.shocks++;
  }
  function motionStop() {
    motion.on = false; motion.phase = "quiet"; motion.amp = 0; motion.pgaNow = 0; motion.p = null;
  }
  function motionTick(dt) {
    if (!motion.on || !motion.p) return { amp: 0, pga01: 0, phase: "quiet", t: 0, shockFired: 0 };
    const p = motion.p;
    motion.t += dt;
    const t = motion.t;
    let env = 0, phase = "quiet", carF = p.f0;
    // ---- P: the bang -----------------------------------------------------
    const pT = 0.15;
    if (t >= pT && t < pT + p.pDur) {
      const u = (t - pT) / p.pDur;
      // fast attack, exponential ring-down; a quarter of the S amplitude
      env = p.ampPeak * 0.25 * Math.min(1, u * 12) * Math.exp(-u * 3.2);
      carF = p.f0 * 4;                       // P is the high-frequency arrival
      phase = "p";
    } else if (t >= pT + p.pDur && t < p.sLag) {
      env = p.ampPeak * 0.03;                // the uneasy quiet between arrivals
      carF = p.f0 * 3;
      phase = "p";
    }
    // ---- S: the damage ---------------------------------------------------
    let shockFired = 0;
    if (t >= p.sLag) {
      const ts = t - p.sLag;
      if (ts < p.mainDur) {
        const rise = Math.min(1, ts / p.riseT);
        // sustained strong motion breathes a little (two incommensurate sines)
        const breathe = 0.86 + 0.09 * Math.sin(ts * 0.7) + 0.05 * Math.sin(ts * 1.9);
        env = Math.max(env, p.ampPeak * rise * (2 - rise) * breathe);
        phase = "s";
      } else {
        const tail = ts - p.mainDur;
        env = Math.max(env, p.ampPeak * Math.exp(-tail / p.codaTau));
        phase = tail < p.codaTau * 3 ? "coda" : "done";
        for (let i = 0; i < motion.shocks.length; i++) {
          const s = motion.shocks[i];
          const d = tail - s.at;
          if (d >= 0 && d < s.dur) {
            if (!s.fired) { s.fired = true; motion.shockFired++; shockFired = s.k; A.aftershocks++; }
            const a = p.ampPeak * s.k * Math.min(1, d * 6) * Math.exp(-d / (s.dur * 0.45));
            if (a > env) { env = a; phase = "aftershock"; }
          }
        }
      }
    }
    /* THE CARRIER. camera.js turns whatever we feed it into white noise, so
       the frequency lives here: a |sin| at the quake's own dominant frequency
       modulates the envelope. At 5 Hz that is a buzz; at 0.8 Hz the whole
       view visibly rolls and slackens twice a second — the difference you
       feel between a small quake and a great one. */
    const carrier = 0.6 + 0.4 * Math.abs(Math.sin(6.2832 * carF * t));
    motion.amp = env * carrier;
    motion.pgaNow = p.ampPeak > 0 ? (env / p.ampPeak) * p.pga01 : 0;
    motion.phase = phase;
    if (motion.pgaNow > A.pgaPeak) A.pgaPeak = motion.pgaNow;
    footingTick(dt, motion.pgaNow);
    return { amp: motion.amp, pga01: motion.pgaNow, phase: phase, t: t, shockFired: shockFired };
  }

  /* FOOTING. The ground decides whether you keep yours. Live PGA (as a
     fraction of 1 g) staggers, then flattens: above ~0.12 g people lurch,
     above ~0.35 g they start going down, and near 1 g nobody stays up long
     enough to run — which is the real reason you cannot flee an M8, taught
     by the legs and not by a speed debuff. Holding onto a table exempts you. */
  function footingTick(dt, pga) {
    if (pga < 0.12 || !CBZ.body) return;
    eachActorNear(motion.cx, motion.cz, motion.R * 2.5, function (a) {
      if (!a || a.dead || !a.pos || a._quakeDuck) return;
      if (CBZ.body.busy && CBZ.body.busy(a)) return;
      a._qkFoot = (a._qkFoot || 0) - dt;
      if (a._qkFoot > 0) return;
      const ang = rnd() * 6.2832;
      if (pga > 0.35 && rnd() < (pga - 0.3) * 1.8) {
        CBZ.body.knockdown(a, { dir: { x: Math.cos(ang), z: Math.sin(ang) }, t: 0.8 + pga * 1.3, force: 3 + pga * 3 });
        A.knockdowns++;
        a._qkFoot = 1.1 + rnd() * 1.2;
      } else {
        CBZ.body.hit(a, { dir: { x: Math.cos(ang), z: Math.sin(ang) }, force: 1.2 + pga * 3.2 });
        A.staggers++;
        a._qkFoot = 0.5 + rnd() * 0.9;
      }
    });
  }

  /* ============================================================
     LIFECYCLE
     ============================================================ */
  /* begin() is per-EVENT, and it zeroes the per-event counters on purpose:
     CBZ.quakeAudit() should answer "what did THIS quake do", not "what has
     this page done since it loaded". World state (anchors, poles, tables)
     survives, because those belong to the world and not to the event. */
  function begin(structures) {
    liveStructures = structures || null;
    A.debrisSpawned = 0; A.debrisHits = 0; A.debrisKills = 0;
    A.fireKills = 0; A.lineKills = 0;
    A.gasFires = 0; A.gasFiresShared = 0; A.linesDown = 0;
    A.coverSaves = 0; A.ducked = 0;
    A.knockdowns = 0; A.staggers = 0; A.aftershocks = 0; A.pgaPeak = 0;
    A.shocks++;
  }
  function end() {
    liveStructures = null;
    motionStop();
    for (let i = localFires.length - 1; i >= 0; i--) { killFire(localFires[i]); }
    localFires.length = 0;
    clearLines();
  }
  function reset() {
    end(); clearPieces(); clearPoles(); coverReset();
    dressedArena = null; cityStop();
  }

  CBZ.onUpdate(27.6, function (dt) {
    if (!CBZ.game || CBZ.game.mode === "escape") return;
    // The arena kit is laid the first frame an island exists, not at quake
    // time — furniture that pops in when the sirens start is a tell.
    if (inSurv() && CBZ.surv && CBZ.surv.arena) dressArena(CBZ.surv.arena);
    else if (inCity()) deriveSeatCovers();
    tickPieces(dt);
    tickFires(dt);
    tickLines(dt);
    cityTick(dt);
  });
  // Late injection (a probe adding this file after boot) lands unsorted at the
  // end of an already-sorted list; core/loop.js only sorts once.
  if (CBZ.bootComplete && CBZ.updaters && CBZ.updaters.sort) {
    CBZ.updaters.sort(function (a, b) { return a.order - b.order; });
  }

  // leaving the mode puts the world back (the same law systems/disasters.js
  // applies to the sea and the weather — debris and downed lines are global
  // scene objects and a quit-to-menu must not leave them lying in the city)
  let wasMode = null;
  CBZ.onAlways(28.04, function () {
    const m = CBZ.game && CBZ.game.mode;
    if (m === wasMode) return;
    wasMode = m;
    // EVERY mode change is a world change: debris, downed conductors, fires,
    // poles and cover anchors all belong to the world that made them, and one
    // left behind is a lump of masonry lying in the middle of the city.
    reset();
  });

  CBZ.quake = {
    // shedding
    shed: shed, shedTick: shedTick, pieces: function () { return pieces.length; },
    // drop, cover, hold on
    cover: cover, coverAdd: coverAdd, coverNear: coverNear, coverReset: coverReset,
    duckUnder: duckUnder, standUp: standUp, underRoof: underRoof,
    // secondary killers
    gasFire: gasFire, dropLine: dropLine, poleNear: poleNear, poleAdd: poleAdd,
    /* WHERE THE SECONDARY HAZARDS ACTUALLY ARE. The same shape
       CBZ.disasters.hazards() publishes ({x, z, r}), so a minimap, an AI
       avoidance pass or a storyboard camera can all read one answer and
       nothing has to re-derive "is there a live wire here". */
    /* Each hazard also publishes the OUTWARD bearing it faces — the wall face
       a fire is on, the direction a pole fell. That is what a caller needs to
       stand on the open side of it: an AI keeping clear, or a camera that must
       not be inside the building the hazard is attached to. */
    hazards: function () {
      const out = [];
      for (let i = 0; i < localFires.length; i++) {
        const f = localFires[i];
        out.push({ kind: "fire", x: f.x, y: f.y, z: f.z, r: 3.4, nx: f.nx || 0, nz: f.nz || 1 });
      }
      for (let i = 0; i < lines.length; i++) {
        const L = lines[i];
        out.push({
          kind: "line", x: L.x + L.fx * L.len * 0.5, z: L.z + L.fz * L.len * 0.5, r: 1.25,
          nx: L.fx, nz: L.fz, tipX: L.x + L.fx * L.len, tipZ: L.z + L.fz * L.len, baseX: L.x, baseZ: L.z,
        });
      }
      return out;
    },
    // the wave train (magnitude → felt ground motion + footing)
    magParams: magParams, motionStart: motionStart, motionTick: motionTick,
    motionStop: motionStop,
    motionState: function () {
      return { on: motion.on, t: motion.t, phase: motion.phase, amp: motion.amp,
        pga01: motion.pgaNow, M: motion.p ? motion.p.M : 0,
        mainDur: motion.p ? motion.p.mainDur : 0, shocksFired: motion.shockFired };
    },
    // one-shot magnitude override for tools/storyboards — consumed by the
    // def's next roll, never stored, not a flag
    forceMag: function (m) { forcedMag = Number.isFinite(m) ? m : null; },
    takeForcedMag: function () { const m = forcedMag; forcedMag = null; return m; },
    // lifecycle + seams
    begin: begin, end: end, reset: reset, hooks: hooks,
    dressArena: dressArena,
    // the city event
    cityStart: cityStart, cityStop: cityStop, cityActive: function () { return city.on; },
    audit: function () { return CBZ.quakeAudit(); },
  };

  /* THE CITY'S ONE-LINE ENTRY POINT. `CBZ.cityQuake({mag, secs, x, z})` runs
     the whole event over whatever lots are near you.

     HONEST SEAM, stated rather than hidden: NOTHING IN THE WORLD CALLS THIS
     YET, and CITY_QUAKE is false, so it is dark by construction rather than a
     stat fiction — the flag does not claim a quake happens in the city, it
     says the engine can run one when a producer asks. The producer is the
     next owner decision (a scripted story beat, a cityevents.js roll, a
     campaign contract), and it costs one line whenever that lands. */
  CBZ.cityQuake = function (o) { return cityStart(o || {}); };

  /* ============================================================
     CBZ.quakeAudit() — THE RATCHET.

     Measured from live state, not counted in the source. What each field
     proves:
       debrisSpawned  the buildings actually shed (a quake that only shakes
                      reads 0 and cannot pass as this feature)
       debrisHits/Kills  the debris is what kills, not the shake
       coverSaves     somebody's damage was actually divided by cover
       ducked         bots really got under the tables
       gasFires / gasFiresShared  fires lit, and how many went through
                      city/structural.js's BURNING state rather than the local
                      fallback — `gasFiresShared` may only ever go UP relative
                      to `gasFires`, which is the anti-second-fire-model gate
       linesDown      conductors on the deck
     ============================================================ */
  CBZ.quakeAudit = function () {
    return {
      debrisSpawned: A.debrisSpawned,
      debrisLive: pieces.length,
      debrisHits: A.debrisHits,
      debrisKills: A.debrisKills,
      fireKills: A.fireKills,
      lineKills: A.lineKills,
      coverAnchors: covers.length,
      coverSaves: A.coverSaves,
      ducked: A.ducked,
      kitTables: A.kitTables,
      kitPoles: poles.length,
      gasFires: A.gasFires,
      gasFiresShared: A.gasFiresShared,
      localFires: localFires.length,
      linesDown: A.linesDown,
      shocks: A.shocks,
      // the wave train, live: what magnitude this quake IS and what the
      // ground is doing right now — a quake that never moves pgaPeak off 0
      // was a camera effect and cannot pass as this feature
      mag: motion.p ? +motion.p.M.toFixed(1) : 0,
      motionPhase: motion.phase,
      motionAmp: +motion.amp.toFixed(3),
      pgaNow: +motion.pgaNow.toFixed(3),
      pgaPeak: +A.pgaPeak.toFixed(3),
      knockdowns: A.knockdowns,
      staggers: A.staggers,
      aftershocksFired: A.aftershocks,
      cityQuake: !!CBZ.CONFIG.CITY_QUAKE,
      cityActive: city.on,
      // a second fire model would show up here as gasFires > gasFiresShared
      // WHILE in city mode — off a city lot the local flame is legitimate
      mode: CBZ.game ? CBZ.game.mode : null,
    };
  };
})();

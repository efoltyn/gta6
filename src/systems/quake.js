/* ============================================================
   systems/quake.js — THE EARTHQUAKE (CBZ.quake). One event, run the same
   way on the disaster island, in the city and in the lab.

   OWNER SCIENCE, implemented, not paraphrased:

     "The shaking itself rarely kills directly. Primary deaths: CRUSHING and
      BLUNT FORCE TRAUMA from falling debris (glass, masonry, facades, heavy
      furniture) and complete structural collapse ('pancaking'). Secondary
      deaths rapidly from FIRES from ruptured gas lines and ELECTROCUTION from
      severed power lines. Survive — indoors: drop, cover, hold on under heavy
      structurally sound furniture, away from windows, exterior walls, tall
      shelves. Outdoors: open ground far from structures, trees, streetlights,
      power lines that fall OUTWARD."

   WHAT AN EARTHQUAKE IS, HERE (each a section below):

     source + path   magnitude is the SOURCE; what reaches a street is the
                     ground motion attenuated over the distance to the
                     rupture and amplified by the soil under it (published
                     relations: Wells-Coppersmith rupture size, Boore-
                     Atkinson 2008 PGA, Rathje 2004 period, Worden 2012 MMI).
                     The same M7 is a wrecking ball over the fault and a long
                     sway 100 km off.
     wave train      P (the vertical jolt), S (the damaging shaking, at the
                     site's period, for as long as the rupture runs), surface
                     waves (the slow roll of a big distant quake), coda,
                     aftershocks (Gutenberg-Richter under Bath's cap, Omori
                     front-loaded), each with its own distance.
     buildings       by structural system (the facade grammar's `structure:`)
                     and height (period): HAZUS-style fragility in spectral
                     demand, one draw per building per quake. Masonry sheds
                     its facade and drops its parapets and chimney stacks;
                     glass rains off curtain walls; a soft storey racks flat
                     and the floors above come down onto it; complete =
                     the shared collapse engine. All of it ON THE BUILDING'S
                     OWN GEOMETRY through one adapter (BD) to city/collapse.js
                     and city/demolition.js.
     ground          cracks open in the roads, mains break and flood the
                     street, soft ground by the water liquefies (sand boils,
                     settling, leaning buildings, sinking cars), collapses
                     raise dust in the building's own colour.
     cars            a parked car is a sprung mass with its handbrake on: it
                     rocks, heaves, walks along its own axis, and is dented
                     or crushed by what falls on it.
     people          at the first jolt everyone decides once: under a table,
                     out of the door, off the pavement, or crouch in the open.
     what kills      every falling body in systems/debris.js, priced by its
                     own kinetic energy, on the way down (debris.js moves
                     things; it hurts no one: that is this file's job);
                     then gas fires (city/structural.js BURNING where a real
                     lot exists) and downed live conductors.
     cover()         drop, cover, hold on: a table x0.05, a roof x0.55, the
                     1.5 m strip against a facade x1.35 (worse than the open
                     street, because that is where the facade lands).

   REUSE, NOT REINVENTION — what this file does not own:
     · the structural ledger  → the caller's (hooks.damage / hooks.collapse),
                                CBZ.structure in the city
     · debris bodies          → CBZ.debris (fracture, rigid bodies, rubble)
     · collapse               → CBZ.collapse / CBZ.cityDemolition via BD
     · fire spread            → CBZ.structure.ignite
     · deaths                 → CBZ.surv.hurt / CBZ.cityKillPed / cityHurtPlayer
     · knockdown/ragdoll      → CBZ.body
     · the shake              → CBZ.shake

   DETERMINISM: on the island every draw (the source, the aftershock list,
   each building's fragility draw, cracks, who runs where) comes from the
   disaster director's seeded stream (CBZ.survRnd), so two clients agree.
   dressArena() (tables, poles) is position-hashed.

   Lab: node tools/lab/run.mjs --kit quake --params 'M=7&dist=12'.
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
    knockdowns: 0, staggers: 0, aftershocks: 0, pgaPeak: 0, mag: 0,
    panesBroken: 0, wallHits: 0, parapets: 0, chimneys: 0, softStoreys: 0, collapses: 0,
    cracks: 0, mains: 0, boils: 0, liquefied: 0, settled: 0, dustClouds: 0,
    carsHit: 0, carsCrushed: 0, carsRolled: 0, evacuated: 0, crowd: {},
    tickN: 0, tickMs: 0, tickMsMax: 0, jobErrors: 0, jobWaits: 0,
  };
  // the device budget (debris.js sizes its own pools the same way)
  const PHONE = CBZ.deviceClass === "phone";

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
      if (!b || b.fallen || b.collapsed) continue;
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
    // a doorframe (the lift's steel frame in a tower too slim for a table)
    // is the lesser cover: the lintel takes the ceiling, nothing takes the side
    if (a._quakeDuck) {
      return a._quakeDuck.kind === "doorframe"
        ? { kind: "doorframe", exposure: 0.3, anchor: a._quakeDuck }
        : { kind: "table", exposure: 0.05, anchor: a._quakeDuck };
    }
    const x = a.pos.x, z = a.pos.z, y = a.pos.y;
    const near = coverNear(x, z, y, 1.5);
    if (near) return near.kind === "doorframe"
      ? { kind: "doorframe", exposure: 0.45, anchor: near }
      : { kind: "beside-table", exposure: 0.5, anchor: near };
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
    // (in a doorframe there is no worktop to get under: crouch, not flatten)
    if (a.group) a.group.position.y = floorAt(a.pos.x, a.pos.z) - (anchor.kind === "doorframe" ? 0.22 : 0.44);
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
     WHAT FALLS, AND WHO IT HITS.

     This file used to fly its own "pieces": BoxGeometry panes and hashed
     lumps of a box, spawned on the footprint PERIMETER of a building it only
     knew as a box, in a private integrator. Swapped boxes, the exact thing a
     quake must not look like. Now nothing falls that was not part of the
     world:

       glass      the building's own panes, burst through the pane's own
                  owner (city/buildings.js cityShatterRay, or the island's
                  pane contract) into CBZ.debris radial shards
       masonry    the building's own wall, opened through the building
                  adapter below (city: CBZ.cityCarveWall, the carve every
                  rocket uses; island: a slab of the face in its own wall
                  material through CBZ.debris)
       parapets,  the triangles of the building's OWN roof line (crown,
       chimneys   parapet run, chimney stack) peeled out of its merged mesh
                  and handed to CBZ.debris as the rigid bodies they become

     and every one of them is a rigid body in systems/debris.js. What this
     file adds is the one thing debris.js does not do: a falling body that
     reaches a person or a car HITS them, priced by its own kinetic energy
     (mass from its own volume, speed from its own fall), on the way down.
     ============================================================ */
  const MASONRY_GREY = 0x8b9097;
  /* WHAT THE BUILDING IS MADE OF: the biggest opaque coloured mesh in its
     group (cached on the group). A piece off a red-brick house is red brick. */
  function wallMatOfGroup(grp) {
    if (!grp) return null;
    const ud = grp.userData || (grp.userData = {});
    if (ud._quakeWallMat !== undefined) return ud._quakeWallMat;
    let best = null, bestN = -1;
    grp.traverse(function (o) {
      if (!o.isMesh || !o.material || Array.isArray(o.material) || o.material.transparent || !o.material.color) return;
      if (o.material.vertexColors) return;
      if (o.material.emissive && o.material.emissive.getHex() !== 0 && o.material.emissiveIntensity > 0.2) return;
      const pa = o.geometry && o.geometry.attributes && o.geometry.attributes.position;
      const n = pa ? pa.count : 0;
      if (n > bestN) { bestN = n; best = o.material; }
    });
    ud._quakeWallMat = best;
    return best;
  }
  function wallMatOf(S) {
    return wallMatOfGroup(S.group) || (CBZ.cmat ? CBZ.cmat(S.wallCol != null ? S.wallCol : MASONRY_GREY) : null);
  }

  /* THE STRIKE PASS. debris.js's live bodies carry mass, velocity and kind;
     a body travelling down faster than a stumble that passes through a head
     or a car roof is a hit. Each body strikes once per target class. Where
     debris.js publishes no live list (a rebuild of that file), the bodies
     this file itself threw are tracked by position instead. */
  const thrown = [];               // fallback: {mesh, m, kind, lx, ly, lz}
  function liveBodies() {
    const D = CBZ.debris;
    return D && D._internal && Array.isArray(D._internal.live) ? D._internal.live : null;
  }
  function trackThrown(out, mPer, kind) {
    if (liveBodies() || !out || !out.bodies) return;
    for (let i = 0; i < out.bodies.length && thrown.length < 160; i++) {
      const m = out.bodies[i];
      thrown.push({ mesh: m, m: mPer, kind: kind, lx: m.position.x, ly: m.position.y, lz: m.position.z, v: { x: 0, y: 0, z: 0 } });
    }
  }
  function strikePass(dt) {
    const L = liveBodies();
    if (L) {
      for (let i = 0; i < L.length; i++) {
        const b = L[i];
        if (!b || b.asleep || !b.mesh || !b.v) continue;
        strikeOne(b, b.mesh.position, b.v.x, b.v.y, b.v.z, b.mass || 1, b.kind);
      }
      return;
    }
    for (let i = thrown.length - 1; i >= 0; i--) {
      const t = thrown[i], p = t.mesh.position;
      if (!t.mesh.parent) { thrown.splice(i, 1); continue; }
      const id = dt > 0 ? 1 / dt : 60;
      t.v.x = (p.x - t.lx) * id; t.v.y = (p.y - t.ly) * id; t.v.z = (p.z - t.lz) * id;
      t.lx = p.x; t.ly = p.y; t.lz = p.z;
      strikeOne(t, p, t.v.x, t.v.y, t.v.z, t.m, t.kind);
    }
  }
  function strikeOne(rec, p, vx, vy, vz, mass, kind) {
    if (vy > -3) return;                         // falling, not tumbling across the ground
    const ke = 0.5 * mass * (vx * vx + vy * vy + vz * vz);
    if (!rec._qkA && ke > 20) {
      eachActorNear(p.x, p.z, 0.7, function (a) {
        if (rec._qkA) return;
        const ay = (a.pos && a.pos.y) || 0;
        if (p.y > ay + 2.0 || p.y < ay - 0.2) return;   // passed above / already below
        rec._qkA = 1;
        hitActor(a, p, ke, kind);
      });
    }
    if (!rec._qkC && mass > 20 && ev.cars.length) {
      for (let i = 0; i < ev.cars.length; i++) {
        const C = ev.cars[i];
        if (carStrike(C, p, ke)) { rec._qkC = 1; break; }
      }
    }
  }
  /* BLUNT FORCE, priced by energy: a brick off a third storey (~3 kg at
     13 m/s, ~250 J) is a serious head wound; a lump of wall or a parapet
     section (tens of kilos, ~1 kJ) kills. Glass cuts at any size. */
  function hitActor(a, p, ke, kind) {
    A.debrisHits++;
    const c = cover(a);
    if (c.exposure < 0.6) A.coverSaves++;
    const glass = kind === "glass";
    const dmg = Math.max(4, Math.min(140, glass ? 14 + ke / 12 : ke / 8)) * c.exposure;
    wound(a, dmg, glass ? "cut down by falling glass" : "crushed by falling masonry", {
      x: p.x, z: p.z, fling: glass ? 1 : 3, tag: "debris",
      lethal: !glass && ke > 900 && c.exposure > 0.6,
    });
    // a pane LACERATES and a lump of wall is BLUNT: systems/wounds.js draws both
    if (CBZ.bodyWound) { try { CBZ.bodyWound(a, { x: p.x, y: ((a.pos && a.pos.y) || 0) + 1.5, z: p.z }, { melee: glass ? "blade" : "blunt", fromX: p.x, fromZ: p.z }); } catch (e) {} }
  }

  /* ============================================================
     THE BUILDING ADAPTER — the ONE door this file damages a building
     through. city/collapse.js is being rebuilt with CBZ.collapse.damage(
     building, point, radius, energy, dir) and CBZ.collapse.undermine(
     building, region); when those exist they get every call, and the
     fallbacks below are what the game has today:
       hit        city: CBZ.cityCarveWall (a real hole, the wall's own
                  material leaves through CBZ.debris); island (merged shells
                  cannot be carved): a slab of the face in its own wall
                  material through CBZ.debris.shatterBox
       undermine  the building's own group drops / settles / tilts about its
                  base, its colliders and floors go with it
       collapse   the caller's ledger (hooks.collapse), else a city lot to
                  city/demolition.js, else CBZ.collapse.play on its own group
     ============================================================ */
  const BD = {
    hit: function (S, p, r, energy, n, fling) {
      A.wallHits++;
      const C = CBZ.collapse;
      if (C && C.damage) { try { C.damage(S.src, p, r, energy, n); return 1; } catch (e) {} }
      if (S.city && CBZ.cityCarveWall) {
        let carved = null;
        try { carved = CBZ.cityCarveWall(p.x - n.x * 0.1, p.y, p.z - n.z * 0.1, r, { search: 1.6 }); } catch (e) {}
        // a wall failing OUT OF PLANE is more than its hole: the panel above
        // and beside it comes away whole and leaves outward
        if (carved && fling) shedFace(S, p, r * 0.8, energy, n, fling);
        if (carved) return 1;
      }
      return shedFace(S, p, r, energy, n, fling);
    },
    undermine: function (S, region) {
      const C = CBZ.collapse;
      if (C && C.undermine) { try { C.undermine(S.src, region); return true; } catch (e) {} }
      return sinkGroup(S, region);
    },
    collapse: function (S, n) {
      if (S.collapsed) return;
      S.collapsed = true;
      A.collapses++;
      if (S.lot && CBZ.cityDemolition && CBZ.cityDemolition.destroy) { try { CBZ.cityDemolition.destroy(S.lot, { cause: "quake" }); return; } catch (e) {} }
      const yank = function () { pullSolids(S, true); if (S.group) S.group.visible = false; };
      const job = CBZ.collapse && CBZ.collapse.play ? CBZ.collapse.play({
        root: S.group && S.group.parent ? S.group.parent : scene(), ox: S.x, oz: S.z, gy: S.gy, group: S.group,
        w: S.w, d: S.d, h: S.h, storeys: S.storeys, FH: S.FH, wall: S.wallCol != null ? S.wallCol : MASONRY_GREY,
        style: S.style, key: "qk:" + Math.round(S.x) + "," + Math.round(S.z),
      }, { wound: { nx: n.x, nz: n.z, floor: 0 }, preShudder: 0.3, onSwap: yank }) : null;
      if (!job) yank();
    },
  };
  function pullSolids(S, all, below) {
    const cols = CBZ.colliders, plats = CBZ.platforms;
    if (cols && S.colliders) for (const c of S.colliders) {
      if (!all && !(c.y1 != null && c.y1 <= below)) continue;
      const i = cols.indexOf(c); if (i >= 0) cols.splice(i, 1);
    }
    if (plats && S.platforms) for (const p of S.platforms) {
      if (!all && !(p.top <= below)) continue;
      const i = plats.indexOf(p); if (i >= 0) plats.splice(i, 1);
    }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
  }
  /* The island fallback for a wound in a wall: the face lets go a slab of
     itself. The box sits ON the wall plane (half proud), so debris.js
     fractures it in the wall's own material and the pieces leave outward. */
  function shedFace(S, p, r, energy, n, fling) {
    const D = CBZ.debris, mat = wallMatOf(S);
    if (!D || !D.shatterBox || !mat) return 0;
    const along = Math.abs(n.x) > 0.5;           // the face runs along z
    const hw = r, hh = r * 0.7, th = 0.22;
    const box = along
      ? { minX: p.x - th, maxX: p.x + th, minY: p.y - hh, maxY: p.y + hh, minZ: p.z - hw, maxZ: p.z + hw }
      : { minX: p.x - hw, maxX: p.x + hw, minY: p.y - hh, maxY: p.y + hh, minZ: p.z - th, maxZ: p.z + th };
    const out = D.shatterBox(box, mat, {
      kind: S.debrisKind, at: { x: p.x, y: p.y, z: p.z }, dir: { x: n.x, y: -0.15, z: n.z },
      power: fling ? 0.35 : 0.45 + Math.min(1.2, energy), maxPieces: PHONE ? 4 : 7, owner: "quake", dust: 0.7,
      // a wall that fails out of plane rotates off its base and leaves
      // OUTWARD: its top lands as far out as the wall was tall
      velocity: fling ? { x: n.x * fling, y: 0.4, z: n.z * fling } : undefined,
    });
    const k = out ? out.pieces || 0 : 0;
    A.debrisSpawned += k; S.shed += k;
    trackThrown(out, 2400 * (2 * hw) * (2 * hh) * (2 * th) / Math.max(1, k), S.debrisKind);
    return k;
  }

  /* THE ROOF LINE LETS GO. A parapet run, a chimney stack, a cornice crown:
     whatever of the building's OWN geometry stands above its roof within
     `rad` of (cx, cz), cut out of its merged mesh (those triangles collapse
     to nothing in place) and handed to CBZ.debris as the rigid bodies they
     become. A building with nothing up there loses nothing: no stand-in
     chimney is ever invented. The triangle scan is done once per building
     (the crown set), so a second peel costs nothing. */
  const _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _bb = new THREE.Box3();
  function crownOf(S) {
    if (S.crown) return S.crown;
    S.crown = [];
    if (!S.group) return S.crown;
    const yMin = S.gy + S.h - 0.06;
    S.group.updateMatrixWorld(true);
    S.group.traverse(function (o) {
      if (!o.isMesh || o.isInstancedMesh || o.visible === false || !o.geometry || !o.material || Array.isArray(o.material)) return;
      const g = o.geometry, P = g.attributes && g.attributes.position;
      if (!P || g._shared || P.count > 240000 || o.material.transparent) return;
      if (!g.boundingBox) g.computeBoundingBox();
      _bb.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
      if (_bb.max.y < yMin) return;                      // all of it under the roof
      const I = g.index ? g.index.array : null, n = I ? I.length / 3 : P.count / 3;
      const mw = o.matrixWorld, tris = [];
      for (let t = 0; t < n; t++) {
        const a = I ? I[t * 3] : t * 3, b = I ? I[t * 3 + 1] : t * 3 + 1, c = I ? I[t * 3 + 2] : t * 3 + 2;
        _v0.fromBufferAttribute(P, a).applyMatrix4(mw);
        if (_v0.y < yMin) continue;
        _v1.fromBufferAttribute(P, b).applyMatrix4(mw);
        if (_v1.y < yMin) continue;
        _v2.fromBufferAttribute(P, c).applyMatrix4(mw);
        if (_v2.y < yMin) continue;
        const x0 = Math.min(_v0.x, _v1.x, _v2.x), x1 = Math.max(_v0.x, _v1.x, _v2.x);
        const z0 = Math.min(_v0.z, _v1.z, _v2.z), z1 = Math.max(_v0.z, _v1.z, _v2.z);
        const y1 = Math.max(_v0.y, _v1.y, _v2.y), y0 = Math.min(_v0.y, _v1.y, _v2.y);
        tris.push(t, (x0 + x1) / 2, (z0 + z1) / 2, Math.max(x1 - x0, z1 - z0), y1 - y0);
      }
      if (tris.length) S.crown.push({ mesh: o, tris: tris });
    });
    return S.crown;
  }
  function peelTop(S, cx, cz, rad, why) {
    const D = CBZ.debris;
    if (!D || !D.shatter) return 0;
    const crown = crownOf(S);
    let total = 0;
    for (let k = 0; k < crown.length; k++) {
      const cr = crown[k], o = cr.mesh, g = o.geometry, P = g.attributes.position;
      const I = g.index ? g.index.array : null;
      const soup = [];
      const T = cr.tris;
      for (let i = 0; i < T.length; i += 5) {
        if (T[i] < 0) continue;                                  // already gone
        const dx = T[i + 1] - cx, dz = T[i + 2] - cz;
        if (dx * dx + dz * dz > rad * rad) continue;
        // a roof PLANE is big and low-pitched; what topples is small (a stack,
        // a coping, a crown piece) or a thin upstand band (a parapet run)
        if (T[i + 3] > 2.4 && T[i + 4] > 1.7) continue;
        if (T[i + 3] > 2.4 && T[i + 4] < 0.05) continue;         // a flat roof slab
        const t = T[i];
        const a = I ? I[t * 3] : t * 3, b = I ? I[t * 3 + 1] : t * 3 + 1, c = I ? I[t * 3 + 2] : t * 3 + 2;
        for (const vi of [a, b, c]) {
          _v0.fromBufferAttribute(P, vi).applyMatrix4(o.matrixWorld);
          soup.push(_v0.x, _v0.y, _v0.z);
        }
        // the triangle is gone from the building: an indexed mesh shares
        // corners with its neighbours, so the INDEX folds (a,a,a); a soup's
        // corners are its own and fold in place
        if (I) { I[t * 3 + 1] = a; I[t * 3 + 2] = a; }
        else { const ax = P.getX(a), ay = P.getY(a), az = P.getZ(a); P.setXYZ(b, ax, ay, az); P.setXYZ(c, ax, ay, az); }
        T[i] = -1;
      }
      if (!soup.length) continue;
      if (I) g.index.needsUpdate = true; else P.needsUpdate = true;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(soup, 3));
      geo.computeVertexNormals();
      const out = D.shatter({ geometry: geo, material: o.material }, {
        kind: S.debrisKind, at: { x: cx, y: S.gy + S.h, z: cz }, dir: { x: (cx - S.x) / (S.w || 1), y: -0.1, z: (cz - S.z) / (S.d || 1) },
        power: 0.7, maxPieces: PHONE ? 5 : 9, owner: "quake", dust: 0.8,
      });
      geo.dispose();
      const n = out ? out.pieces || 0 : 0;
      total += n;
      trackThrown(out, 60, S.debrisKind);
    }
    if (total) { A.debrisSpawned += total; S.shed += total; if (why === "parapet") S.parapetDown = true; else S.crownDown = true; }
    return total;
  }

  /* A building that loses its footing: the soft storey that racks flat
     under the floors above, or the liquefied ground that lets it settle and
     lean. The building's own group moves about its own base (never swapped):
     `drop` metres down, tilted `tilt` radians about a horizontal axis
     (ax, az), eased in over `secs`. Colliders and floors go with it; a soft
     storey's ground-floor walls are pulled (there is no ground floor left). */
  const sinks = [];
  function sinkGroup(S, region) {
    if (!S.group || S.sunk) return false;
    S.sunk = true;
    const r = region || {};
    sinks.push({ S: S, drop: r.drop || 0.3, tilt: r.tilt || 0, ax: r.ax || 1, az: r.az || 0, secs: r.secs || 0.6,
      t: 0, done: 0, soft: !!r.soft });
    if (r.soft) pullSolids(S, false, S.gy + S.FH * 0.95);
    return true;
  }
  const _axis = new THREE.Vector3(), _piv = new THREE.Vector3();
  function tickSinks(dt) {
    for (let i = sinks.length - 1; i >= 0; i--) {
      const k = sinks[i], S = k.S;
      k.t += dt;
      const u = Math.min(1, k.t / k.secs), e = k.soft ? u * u : u * (2 - u);   // a storey falls; mud yields
      const want = e - k.done;
      if (want <= 0) { if (u >= 1) sinks.splice(i, 1); continue; }
      k.done = e;
      const dy = -k.drop * want, th = k.tilt * want;
      const g = S.group;
      g.position.y += dy;
      if (th) {
        _piv.set(S.x, S.gy, S.z);
        _axis.set(k.ax, 0, k.az).normalize();
        g.position.sub(_piv).applyAxisAngle(_axis, th).add(_piv);
        g.rotateOnWorldAxis(_axis, th);
      }
      if (S.colliders) for (const c of S.colliders) { if (c.y0 != null) c.y0 += dy; if (c.y1 != null) c.y1 += dy; }
      if (S.platforms) for (const p of S.platforms) { if (p.top != null) p.top += dy; }
      if (u >= 1) {
        sinks.splice(i, 1);
        if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
        if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
      }
    }
  }
  function clearPieces() { thrown.length = 0; sinks.length = 0; }

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
    if (B.lot && CBZ.structure && CBZ.structure.hit) {
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
        coverAdd(cv[k].x, cv[k].y, cv[k].z, cv[k].r, cv[k].kind || "table", b);
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
     THE SOURCE AND THE PATH — magnitude is the earthquake, intensity is
     what reaches the street.

     The old model turned a magnitude straight into a ground acceleration at
     the player ("M7 = 0.45 g"), the same everywhere, at any distance. That
     is the felt-report table of a quake directly underneath you, every
     time. Real ground motion is the SOURCE (moment magnitude, depth, where
     the rupture is) attenuated along the PATH and amplified by the SITE:

       rupture   Wells & Coppersmith (1994): length L = 10^(-2.44+0.59M) km,
                 width W = 10^(-1.01+0.32M) km. A great quake is a fault
                 hundreds of km long, so "distance" is to the rupture, not
                 to the epicentre (Joyner-Boore), and the top of a wide
                 rupture comes up towards the surface.
       PGA       Boore & Atkinson (2008) median for firm rock (Vs30 760),
                 near-source saturation included: an M6 at 10 km is ~0.14 g,
                 an M7 over the fault ~0.45 g, an M8 at 80 km ~0.19 g.
       site      soil amplifies weak motion and saturates under strong
                 motion (nonlinear soil): soft fill by the water ~1.8x at
                 0.1 g, ~1.1x at 0.4 g; volcanic rock 1.0x.
       period    Rathje et al. (2004) mean period Tm: an M5 nearby buzzes at
                 ~4 Hz, an M8 far off rolls at ~1.5 Hz, and soft soil
                 lengthens it.
       arrivals  P at 6.0 km/s, S at 3.5 km/s, surface waves at ~3.1 km/s:
                 the S-minus-P gap is 0.119 s per km of hypocentral
                 distance, the warning you actually get.
       duration  strong shaking lasts about as long as the rupture takes to
                 run (L at 2.8 km/s) plus scattering along the path.
       MMI       Worden et al. (2012) from PGA.
     Every one of those is a published relation; the numbers below are their
     coefficients, not tuning.
     ============================================================ */
  const VP = 6.0, VS = 3.5, VR = 3.1;
  function rupture(M) {
    return { L: Math.pow(10, -2.44 + 0.59 * M), W: Math.min(60, Math.pow(10, -1.01 + 0.32 * M)) };
  }
  // distance from a site to the rupture plane (km), with a fault centred on
  // the epicentre and the site off its strike by a quarter of its length
  function rupDistKm(M, epiKm, depthKm) {
    const r = rupture(M);
    const rjb = Math.max(0, epiKm - 0.25 * r.L);
    const ztop = Math.max(0, depthKm - 0.5 * r.W);
    return Math.sqrt(rjb * rjb + 1.35 * 1.35 + ztop * ztop);
  }
  // BA08 median PGA (g) on firm rock
  function pgaRock(M, Rkm) {
    const dm = M - 6.75;
    const FM = M <= 6.75 ? -0.53804 + 0.28805 * dm - 0.10164 * dm * dm : -0.53804 + 0.04 * dm;
    const FD = (-0.6605 + 0.1197 * (M - 4.5)) * Math.log(Math.max(1, Rkm)) - 0.01151 * (Rkm - 1);
    return Math.exp(FM + FD);
  }
  const SOIL = {
    rock: { amp: 1.0, nl: 0, T: 1.0 },
    firm: { amp: 1.3, nl: 0.15, T: 1.12 },
    soft: { amp: 1.8, nl: 0.33, T: 1.35 },
  };
  function siteAmp(soil, pgaR) {
    const s = SOIL[soil] || SOIL.firm;
    return Math.max(0.9, s.amp * (pgaR > 0.1 ? Math.pow(pgaR / 0.1, -s.nl) : 1));
  }
  function meanPeriod(M, Rkm, soil) {
    const Tm = 0.411 + 0.0837 * (Math.min(M, 7.25) - 6) + 0.05 * Math.max(0, M - 7.25) + 0.00208 * Rkm;
    return Math.max(0.12, Tm) * ((SOIL[soil] || SOIL.firm).T);
  }
  function mmiOf(pgaG) {
    const l = Math.log10(Math.max(1e-4, pgaG * 980.665));
    return Math.max(1, Math.min(10, l <= 1.57 ? 1.78 + 1.55 * l : -1.6 + 3.7 * l));
  }

  /* WHERE IT BROKE: drawn per occurrence from the shared seeded stream. On a
     subduction margin the great quakes are the offshore megathrust (tens to
     a hundred km out, 15-35 km down); the rest are crustal faults inland,
     shallower and closer. Bigger quakes are far more often the megathrust. */
  function sourceRoll(M, draw) {
    const r = draw || rnd;
    const pOff = 0.3 + 0.5 * Math.max(0, Math.min(1, (M - 6) / 2));
    const offshore = r() < pOff;
    const epiKm = offshore ? 25 + r() * 85 : 3 * Math.pow(15, r());
    const depthKm = offshore ? 15 + r() * 20 : 5 + r() * 10;
    return { M: M, epiKm: +epiKm.toFixed(1), depthKm: +depthKm.toFixed(1), offshore: offshore, bearing: r() * 6.2832 };
  }

  /* Everything a quake implies, in one record. PURE: the same M and source
     give the same numbers, so the def, the synth, the lab and any tool all
     read one derivation. `src` defaults to a crustal quake 15 km off at 10 km
     depth on firm ground, the reference the tools quote. */
  function magParams(M, src) {
    M = Math.max(4, Math.min(8.6, +M || 6));
    src = src || {};
    const epiKm = src.epiKm != null ? +src.epiKm : 15, depthKm = src.depthKm != null ? +src.depthKm : 10;
    const soil = src.soil || "firm";
    const rup = rupture(M);
    const hypoKm = Math.sqrt(epiKm * epiKm + depthKm * depthKm);
    const Rrup = rupDistKm(M, epiKm, depthKm);
    const pgaR = pgaRock(M, Rrup);
    const pgaG = Math.min(1.6, pgaR * siteAmp(soil, pgaR));
    const pga01 = Math.min(1, pgaG);
    const Tm = meanPeriod(M, Rrup, soil);
    const f0 = 1 / Tm;
    // arrivals, measured from the P arrival at this site
    const sLag = Math.max(0.35, hypoKm * (1 / VS - 1 / VP));
    const rLag = sLag + Math.max(0.6, epiKm * (1 / VR - 1 / VS));
    // strong motion ~ the rupture's own run time plus path scattering
    const ruptureSecs = rup.L / 2.8;
    const realDur = 0.6 * ruptureSecs + 0.05 * hypoKm + 0.6;
    const mainDur = Math.max(0.8, Math.min(36, realDur));
    const riseT = Math.min(4, 0.3 + mainDur * 0.15);
    const codaTau = 1 + 0.3 * mainDur;
    // surface waves: big, shallow and far enough for them to form
    const surfK = depthKm > 45 ? 0 : Math.max(0, Math.min(1, (M - 5.8) / 2)) * Math.max(0, Math.min(1, (epiKm - 1.5 * depthKm) / 50)) * (soil === "soft" ? 1.3 : 1);
    const surfT = 2 + 1.5 * Math.max(0, M - 6);
    // P: the vertical jolt, strongest near the source, high frequency
    const pK = Math.max(0.18, Math.min(0.55, 0.6 - hypoKm * 0.004));
    const fP = Math.max(3, Math.min(10, 9 * Math.exp(-0.01 * hypoKm)));
    // camera metres at the peak of S (CBZ.shake units), as before
    const ampPeak = 0.04 + Math.pow(pga01, 1.25) * 1.35;
    // AFTERSHOCKS (Reasenberg-Jones with an early-time c, Bath's law): the
    // expected count of felt (M>=4) shocks in the minute after the main
    // shaking, the largest ~1.2 under the mainshock
    const shockRate = 0.11 * Math.pow(10, 0.91 * (M - 7));
    const nShocks = Math.max(0, Math.min(8, Math.round(shockRate * 25)));
    const shockWindow = nShocks ? 6 + nShocks * 3 : 0;
    const activeSecs = Math.round(Math.max(12, Math.min(55, sLag + mainDur + Math.max(codaTau * 2.5, shockWindow) + 5)));
    const mmi = mmiOf(pgaG);
    // liquefaction needs soft saturated ground, enough acceleration and
    // enough cycles (Idriss magnitude scaling): an M6 needs ~0.18 g, an M8
    // liquefies at ~0.1 g
    const liqDemand = pgaG * Math.pow(M / 7.5, 2.56);
    return {
      M: M, src: { epiKm: epiKm, depthKm: depthKm, offshore: !!src.offshore, bearing: src.bearing || 0, soil: soil },
      hypoKm: hypoKm, Rrup: Rrup, pgaRock: pgaR, pgaG: pgaG, pga01: pga01, mmi: mmi,
      ampPeak: ampPeak, f0: f0, Tm: Tm, fP: fP, pK: pK, surfK: surfK, surfT: surfT,
      mainDur: mainDur, realDur: realDur, durCapped: realDur > mainDur + 0.01,
      sLag: sLag, rLag: rLag, riseT: riseT, codaTau: codaTau,
      nShocks: nShocks, activeSecs: activeSecs, ruptureKm: rup.L,
      liqDemand: liqDemand, liq: liqDemand >= 0.1,
      rupture: M >= 6.8 && epiKm < rup.L * 0.5 && !src.offshore,
      tsunamigenic: M >= 7.4 && !!src.offshore,
    };
  }

  // one-shot magnitude override for tools/storyboards (NOT a config flag:
  // consumed by the next roll and gone)
  let forcedMag = null;

  /* ============================================================
     THE WAVE TRAIN — three arrivals, one ground.

       P        a sharp VERTICAL jolt at the P arrival: high frequency,
                a third to a half of the S amplitude near the source, then a
                low rumble until the S waves arrive. "Was that a truck?"
       S        the shear waves, sLag later: the violent horizontal shaking
                that does the damage, at the site's own mean period, rising
                over riseT, sustained for the rupture's duration, then a
                scattered coda.
       surface  for a big shallow quake far enough off, the Love/Rayleigh
                train arrives last: small accelerations at a 3-6 s period
                with large displacements. You see the ground ROLL, tall
                buildings sway with it, and it is what makes a distant
                great quake feel nothing like a near small one.
       aftershocks  each a miniature train of its own, drawn Gutenberg-
                Richter (b = 1) under Bath's cap, front-loaded (Omori), at
                its own distance with its own site PGA.

     The synthesizer publishes ENVELOPES (p, s, r: 0..1 of each phase's
     peak) for damage and a ground ACCELERATION and DISPLACEMENT vector for
     what moves (cars, footing, the camera).
     ============================================================ */
  const motion = {
    on: false, t: 0, p: null, cx: 0, cz: 0, R: 120,
    shocks: [], shockFired: 0, phase: "quiet", amp: 0, pgaNow: 0,
    env: { p: 0, s: 0, r: 0, m: 0, a: 0 }, acc: { x: 0, y: 0, z: 0 }, disp: { x: 0, y: 0, z: 0 },
    ph: [0, 0, 0, 0, 0, 0, 0, 0], pol: 0,
  };
  function motionStart(p, o) {
    o = o || {};
    motion.on = true; motion.t = 0; motion.p = p;
    motion.cx = o.cx || 0; motion.cz = o.cz || 0; motion.R = o.R || 120;
    motion.phase = "quiet"; motion.amp = 0; motion.pgaNow = 0; motion.shockFired = 0;
    for (let i = 0; i < 8; i++) motion.ph[i] = rnd() * 6.2832;
    motion.pol = rnd() * 6.2832;
    // the aftershock schedule, drawn now from the shared seeded stream so
    // every client agrees when the ground moves again. Times are seconds
    // into the tail (after the strong motion), front-loaded; sizes are
    // Gutenberg-Richter between M4 and Bath's cap.
    motion.shocks = [];
    const W = p.nShocks ? 6 + p.nShocks * 3 : 0;
    const cap = p.M - 1.2;
    for (let i = 0; i < p.nShocks; i++) {
      const Ma = i === 0 ? cap - 0.3 * rnd()
        : Math.min(cap, 4 - Math.log10(1 - rnd() * (1 - Math.pow(10, -(cap - 4)))));
      if (Ma < 4) continue;
      const src = p.src || {};
      const off = (rnd() - 0.5) * p.ruptureKm * 0.5;
      const epi = Math.max(1, Math.hypot((src.epiKm || 15) + off * Math.cos(src.bearing || 0), off * Math.sin(src.bearing || 0)));
      const sp = magParams(Ma, { epiKm: epi, depthKm: (src.depthKm || 10) * (0.6 + rnd() * 0.6), soil: src.soil });
      motion.shocks.push({
        at: 1.2 + W * Math.pow(rnd(), 1.8), M: +Ma.toFixed(1),
        k: Math.min(1, sp.pgaG / Math.max(1e-3, p.pgaG)),
        sLag: sp.sLag, dur: Math.max(1, sp.mainDur), f: sp.f0, fired: false,
      });
    }
    motion.shocks.sort(function (a, b) { return a.at - b.at; });
    A.shocks++;
  }
  function motionStop() {
    motion.on = false; motion.phase = "quiet"; motion.amp = 0; motion.pgaNow = 0; motion.p = null;
    motion.env.p = motion.env.s = motion.env.r = motion.env.m = motion.env.a = 0;
    motion.acc.x = motion.acc.y = motion.acc.z = 0; motion.disp.x = motion.disp.y = motion.disp.z = 0;
  }
  const TAU = 6.2832;
  function motionTick(dt) {
    if (!motion.on || !motion.p) return { amp: 0, pga01: 0, phase: "quiet", t: 0, shockFired: 0, env: motion.env };
    const p = motion.p, E = motion.env;
    motion.t += dt;
    const t = motion.t;
    let phase = "quiet";
    // ---- P ---------------------------------------------------------------
    let eP = 0;
    if (t < p.sLag + 0.5) {
      const u = t / 0.08;
      eP = Math.min(1, u) * (0.22 + 0.78 * Math.exp(-t / (0.4 + 0.12 * (p.M - 4))));
      phase = "p";
    }
    // ---- S ---------------------------------------------------------------
    let eS = 0;
    const ts = t - p.sLag;
    if (ts >= 0) {
      if (ts < p.mainDur) {
        const rise = Math.min(1, ts / p.riseT);
        const breathe = 0.88 + 0.08 * Math.sin(ts * 0.7 + motion.ph[3]) + 0.04 * Math.sin(ts * 1.9);
        eS = rise * (2 - rise) * breathe;
        phase = "s";
      } else {
        eS = Math.exp(-(ts - p.mainDur) / p.codaTau);
        phase = ts - p.mainDur < p.codaTau * 2.5 ? "coda" : "done";
      }
    }
    // ---- surface ---------------------------------------------------------
    let eR = 0;
    const tr = t - p.rLag;
    if (p.surfK > 0 && tr >= 0) {
      const hold = p.mainDur * 0.7;
      eR = tr < hold ? Math.min(1, tr / 2.5) : Math.exp(-(tr - hold) / (0.5 * p.mainDur + 2));
      if (eR > 0.35 && phase === "coda") phase = "surface";
    }
    // ---- aftershocks -----------------------------------------------------
    let shockFired = 0, eA = 0, fA = p.f0;
    const tail = ts - p.mainDur;
    if (tail >= 0) {
      for (let i = 0; i < motion.shocks.length; i++) {
        const s = motion.shocks[i];
        const d = tail - s.at;
        if (d < 0 || d > s.sLag + s.dur * 3) continue;
        if (!s.fired) { s.fired = true; motion.shockFired++; shockFired = s.k; A.aftershocks++; }
        const dS = d - s.sLag;
        const a = dS < 0 ? s.k * 0.3 * Math.min(1, d * 10) : s.k * Math.min(1, dS * 4) * (dS < s.dur ? 1 : Math.exp(-(dS - s.dur) / (0.4 * s.dur + 0.5)));
        if (a > eA) { eA = a; fA = s.f; }
      }
      if (eA > eS && eA > 0.05) phase = "aftershock";
    }
    // s = what is shaking now (main or aftershock); m = the mainshock's own
    // S train and coda; a = the aftershock trains (damage reads them apart)
    E.p = eP; E.s = Math.max(eS, eA); E.r = eR; E.m = eS; E.a = eA;
    /* THE GROUND ITSELF (m/s^2 and m), at the reference site: the S train
       on two components (a wandering ellipse), the surface roll on its own
       period, the P jolt vertical. */
    const g = 9.81, pga = p.pgaG;
    const fS = eA > eS ? fA : p.f0;
    // two horizontal components of similar size, each a pair of incommensurate
    // sines about the site period: the ground traces a wandering ellipse, as
    // a real two-component record does, never a fixed line
    const swX = Math.cos(TAU * fS * t + motion.ph[0]) * 0.72 + Math.cos(TAU * fS * 1.37 * t + motion.ph[1]) * 0.28;
    const swZ = (Math.cos(TAU * fS * 1.13 * t + motion.ph[5]) * 0.72 + Math.cos(TAU * fS * 0.81 * t + motion.ph[6]) * 0.28) * 0.9;
    const ang = motion.pol;
    const aSx = pga * g * E.s * swX, aSz = pga * g * E.s * swZ;
    const wR = TAU / p.surfT, aRm = pga * g * p.surfK * 0.22 * eR;
    const rw = Math.cos(wR * t + motion.ph[2]);
    const aV = pga * g * (p.pK * eP * Math.sin(TAU * p.fP * t) + 0.5 * E.s * Math.sin(TAU * fS * 1.3 * t + motion.ph[4]));
    motion.acc.x = aSx + aRm * rw * Math.cos(ang);
    motion.acc.z = aSz + aRm * rw * Math.sin(ang);
    motion.acc.y = aV;
    const wS2 = (TAU * fS) * (TAU * fS), dR = aRm * rw / (wR * wR);
    motion.disp.x = aSx / wS2 + dR * Math.cos(ang);
    motion.disp.z = aSz / wS2 + dR * Math.sin(ang);
    // vertical: the S/P part is small and fast; a Rayleigh wave lifts and
    // drops the whole street on its long period (retrograde ellipse)
    const rv = Math.sin(wR * t + motion.ph[2]);
    motion.disp.y = (pga * g * 0.5 * E.s * Math.sin(TAU * fS * 1.3 * t + motion.ph[4])) / ((TAU * fS * 1.3) * (TAU * fS * 1.3)) + 0.7 * aRm * rv / (wR * wR);
    motion.acc.y += -0.7 * aRm * rv;
    // felt PGA (g, 0..1): the envelope peak of everything arriving now
    motion.pgaNow = Math.min(1, pga * Math.max(E.s, p.pK * eP, p.surfK * 0.22 * eR));
    /* THE CAMERA. camera.js's CBZ.shake is white noise with a fast decay,
       so frequency lives in the ENVELOPE fed to it: a |sin| at the arriving
       phase's own frequency (the P jolt buzzes, the S shakes, the surface
       train rolls slow and wide). */
    const felt = Math.max(E.s, p.pK * eP * 1.2, p.surfK * 0.6 * eR);
    const carF = (p.pK * eP * 1.2 >= E.s && eP > 0.05) ? p.fP : (p.surfK * 0.6 * eR > E.s ? 1 / p.surfT : fS);
    const carrier = 0.6 + 0.4 * Math.abs(Math.sin(TAU * carF * t));
    motion.amp = p.ampPeak * felt * carrier;
    motion.phase = phase;
    if (motion.pgaNow > A.pgaPeak) A.pgaPeak = motion.pgaNow;
    footingTick(dt, motion.pgaNow);
    return { amp: motion.amp, pga01: motion.pgaNow, phase: phase, t: t, shockFired: shockFired, env: E };
  }

  /* FOOTING. The ground decides whether you keep yours. Live PGA (as a
     fraction of 1 g) staggers, then flattens: above ~0.12 g people lurch,
     above ~0.35 g they start going down, and near 1 g nobody stays up long
     enough to run. Holding onto a table exempts you. */
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
     HOW A BUILDING ANSWERS THE GROUND — by what it is made of and how tall.

     The old quake loaded every building on the island by the same amount
     and then knocked down a random `collapseFrac` of them: a timber house
     and a 30-storey steel tower were the same coin. Earthquake engineering
     says three things decide it, and all three are read off the building:

       structural system  the facade grammar's own `structure:` field
                 (city/collapse.js profile): unreinforced masonry (brick,
                 stone, adobe) is brittle and heavy; timber light frame is
                 light and forgiving; reinforced concrete and steel frames
                 are engineered.
       period    T = Ct * H^x (ASCE 7 approximate period): a 3-storey walk-
                 up is ~0.25 s, a 12-storey steel tower ~1.4 s. A building
                 takes the ground's SPECTRAL acceleration at its own period,
                 so a near small quake (short period) wrecks low masonry and
                 barely moves towers, while a distant great quake's long
                 period and surface waves find the tall ones.
       weak storey  an open ground floor (shopfronts, a lobby, parking under
                 flats) concentrates all the drift in one storey: it fails
                 first and the floors above come down onto it.

     Damage follows HAZUS-style fragility: four states (slight, moderate,
     extensive, complete), lognormal in spectral demand with dispersion
     beta, and ONE uniform draw per building per quake decides where on the
     curve that building sits (so a stronger building on the same street
     can still lose, as it does). Long strong shaking degrades brittle walls
     cycle by cycle, and a damaged building is weaker for the aftershocks.

     Medians are spectral acceleration (g) at the building's period for a
     low-code town; tall buildings' capacities scale down with period the
     way their design base shear does. `glass` is the share of a building's
     panes lost by each state (glazing mostly survives: a curtain wall at
     extensive damage has lost about a third; at complete the collapse
     engine takes the rest with the building).
     ============================================================ */
  const TYPES = {
    URM: { label: "unreinforced masonry", med: [0.30, 0.48, 0.80, 1.20], beta: 0.6, degrade: 0.25, ct: 0.0488, x: 0.75, glass: [0.02, 0.06, 0.18, 0] },
    W:   { label: "timber frame",         med: [0.50, 0.90, 1.70, 2.60], beta: 0.65, degrade: 0.08, ct: 0.0488, x: 0.75, glass: [0.01, 0.04, 0.12, 0] },
    C:   { label: "reinforced concrete",  med: [0.45, 0.75, 1.40, 2.30], beta: 0.65, degrade: 0.12, ct: 0.0466, x: 0.9, glass: [0.01, 0.05, 0.15, 0] },
    S:   { label: "steel frame",          med: [0.50, 0.90, 1.90, 3.20], beta: 0.65, degrade: 0.06, ct: 0.0724, x: 0.8, glass: [0.02, 0.06, 0.18, 0] },
    CW:  { label: "curtain-wall frame",   med: [0.50, 0.90, 1.90, 3.20], beta: 0.65, degrade: 0.06, ct: 0.0724, x: 0.8, glass: [0.04, 0.12, 0.30, 0] },
  };
  const TYPE_OF = { masonry: "URM", brick: "URM", stone: "URM", adobe: "URM", timber: "W", concrete: "C", steel: "S", glassbox: "CW" };
  const DEBRIS_KIND = { masonry: "brick", brick: "brick", stone: "rock", adobe: "dirt", timber: "wood", concrete: "concrete", steel: "concrete", glassbox: "concrete" };
  const DS_NAME = ["none", "slight", "moderate", "extensive", "complete"];
  // standard normal CDF (Abramowitz & Stegun 7.1.26 erf)
  function Phi(x) {
    const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
    const e = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
    return x >= 0 ? 0.5 * (1 + e) : 0.5 * (1 - e);
  }
  function fragP(D, med, beta) { return D <= 0 ? 0 : Phi(Math.log(D / med) / beta); }
  // design-spectrum shape: Sa/PGA at period T for a ground of mean period Tm
  function spectral(T, Tm) {
    const Tc = Math.max(0.3, 1.6 * Tm);
    if (T < 0.1) return 1 + 15 * T;
    return T <= Tc ? 2.5 : 2.5 * Tc / T;
  }
  // a building's response to the surface train: a damped oscillator near
  // its own period, capped (the train is a few cycles, not a steady state)
  function resonance(T, Ts) {
    const r = T / Ts, z = 0.05;
    return Math.min(5, 1 / Math.sqrt((1 - r * r) * (1 - r * r) + (2 * z * r) * (2 * z * r)));
  }
  function materialOf(t, B) {
    const C = CBZ.collapse;
    const style = t.facadeStyle || (t.building && (t.building.dressStyle || t.building.style)) || t.style || null;
    if (C && C.profile) {
      try { return C.profile({ style: style, storeys: B.storeys, w: B.w, d: B.d, h: B.h, masonry: t.building && t.building.masonry }).material; } catch (e) {}
    }
    return B.storeys >= 10 ? "steel" : B.storeys >= 4 ? "concrete" : "brick";
  }

  /* ONE STRUCTURE RECORD per building per quake, from either shape (a city
     lot / city building record, or the island's fragile record). */
  function structOf(t, p) {
    const B = boxOf(t);
    if (!B) return null;
    const b = t.building || t;
    const storeys = Math.max(1, b.storeys || Math.round(B.h / 3.2));
    const FH = b.FH || B.h / storeys;
    const S = {
      src: t, lot: ev.lots && t.building ? t : null,
      x: B.x, z: B.z, w: B.w, d: B.d, h: B.h, storeys: storeys, FH: FH,
      gy: t.gy != null ? t.gy : (b.gy != null ? b.gy : floorAt(B.x, B.z)),
      group: B.group || b.group || null,
      style: t.facadeStyle || b.dressStyle || null,
      wallCol: t.color != null ? t.color : (b.wallColor != null ? b.wallColor : null),
      colliders: t.colliders || b.colliders || null, platforms: t.platforms || b.platforms || null,
      city: !!(t.building && CBZ.cityCarveWall),
      // u: where on its fragility curves this building sits, the 3rd to the
      // 97th percentile (no building is weaker than one in thirty of its kind)
      ds: 0, peak: 0, cyc: 0, u: 0.03 + 0.94 * rnd(), shed: 0, panes: 0, parapetDown: false, crownDown: false,
      soft: false, collapsed: false, sunk: false, liq: false, shedAcc: 0, holes: 0,
    };
    S.material = materialOf(t, S);
    S.type = TYPE_OF[S.material] || "C";
    S.debrisKind = DEBRIS_KIND[S.material] || "concrete";
    const TY = TYPES[S.type];
    S.T = TY.ct * Math.pow(Math.max(3, S.h), TY.x);
    const hf = S.T > 0.35 ? Math.max(0.4, Math.min(1, Math.pow(0.35 / S.T, 0.4))) : 1;
    S.med = TY.med.map(function (m) { return m * hf * (S.material === "adobe" ? 0.8 : 1); });
    S.beta = TY.beta; S.degrade = TY.degrade;
    /* THE WEAK STOREY. A storefront or lobby ground floor on a mid-rise
       concrete or timber building (a third of the rest of them, which is
       roughly what a pre-code town has). Its extensive and complete
       capacities are the soft storey's, not the frame's. */
    const h01 = CBZ.hash01 ? CBZ.hash01(S.x, S.z, 0x5f7) : 0.5;
    S.soft = (S.type === "C" || S.type === "W") && storeys >= 2 && storeys <= 8 &&
      !!(t.retail || b.retail || t.softStorey || (b.storefront) || h01 < 0.33);
    if (S.soft) { S.med[2] *= 0.7; S.med[3] *= 0.55; }
    /* ALREADY HURT: a building the caller's ledger has damaged (the tsunami
       spalled it, an earlier quake cracked it) starts this one at that state
       and with a weakened frame. */
    const pre = +t._dmg || 0;
    S.ds = pre >= 0.69 ? 3 : pre >= 0.34 ? 2 : pre >= 0.15 ? 1 : 0;
    S.dsStart = S.ds;
    if (S.ds) S.med = S.med.map(function (m) { return m * (1 - 0.08 * S.ds); });
    S.parapet = S.type === "URM" ? (b.parapetH == null || b.parapetH > 0.2) : (b.parapetH > 0.4);
    /* THE SITE. Its own distance to the rupture (game metres are metres:
       across an island a kilometre wide that is a small change, and an
       honest one), its own soil, and a lognormal intra-event scatter so two
       identical buildings a street apart do not shake identically. */
    const src = p.src || {};
    const offKm = Math.hypot(S.x - ev.cx, S.z - ev.cz) / 1000;
    const ux = Math.cos(src.bearing || 0), uz = Math.sin(src.bearing || 0);
    const along = ((S.x - ev.cx) * ux + (S.z - ev.cz) * uz) / 1000;
    const epi = Math.max(0.5, (src.epiKm || 15) - along + offKm * 0.1);
    S.soil = soilAt(S.x, S.z);
    const Rr = rupDistKm(p.M, epi, src.depthKm || 10);
    const pr = pgaRock(p.M, Rr);
    const scatter = Math.exp(0.3 * ((rnd() + rnd() + rnd()) - 1.5) * 1.15);
    S.pga = Math.min(1.6, pr * siteAmp(S.soil, pr) * scatter);
    S.Tm = meanPeriod(p.M, Rr, S.soil);
    S.fS = 1 / S.Tm;
    S.saS = S.pga * spectral(S.T, S.Tm);
    S.saR = S.pga * p.surfK * 0.22 * resonance(S.T, p.surfT);
    S.saP = S.pga * p.pK * 0.6;                  // vertical jolt: mostly felt, rarely structural
    S.n = { x: 0, z: 1 };
    // the street face (the door side) is where the facade drops, and where
    // the people come out
    const door = doorOf(t, S);
    S.door = door;
    S.n = { x: Math.sign(door.x - S.x) * (Math.abs(door.x - S.x) > Math.abs(door.z - S.z) ? 1 : 0), z: Math.sign(door.z - S.z) * (Math.abs(door.z - S.z) >= Math.abs(door.x - S.x) ? 1 : 0) };
    return S;
  }
  function doorOf(t, S) {
    const b = t.building || t;
    // city shells publish their doorway (building-local, inward normal)
    if (b.localDoor && b.localDoor.x != null) {
      const ld = b.localDoor, nx = -(ld.nx || 0), nz = -(ld.nz || 0);
      return { x: S.x + ld.x + nx * 1.2, z: S.z + ld.z + nz * 1.2 };
    }
    if (b.doorSide != null) {
      const s = b.doorSide;
      return s === 0 ? { x: S.x, z: S.z - S.d / 2 - 1.2 } : s === 1 ? { x: S.x, z: S.z + S.d / 2 + 1.2 } : s === 2 ? { x: S.x - S.w / 2 - 1.2, z: S.z } : { x: S.x + S.w / 2 + 1.2, z: S.z };
    }
    // the island's houses and towers all face -z (world/disaster_arena.js)
    return { x: S.x, z: S.z - S.d / 2 - 1.1 };
  }

  // ---- what the building does at each state it reaches -----------------
  /* THE WORK QUEUE. A street failing at once is dozens of fractures,
     carves and peels; they run under a per-frame budget instead of landing
     in one frame. NOTHING IN A JOB DRAWS FROM THE SHARED STREAM (how many
     run per frame depends on the device), so every decision is taken when
     the job is queued and the job only draws the picture. */
  const jobs = [];
  const jobCost = {};
  // two queues: the STRUCTURE (wounds, peels, soft storeys, collapses, in
  // the order they were decided) goes before the GLASS
  const glassJobs = [];
  function job(fn, tag) {
    const q = tag === "pane" ? glassJobs : jobs;
    if (q.length < 400) q.push({ fn: fn, tag: tag || "job" });
  }
  /* THE LIVE-BODY BUDGET. debris.js holds a device-capped number of bodies
     in flight and makes room by FREEZING the oldest where they are, in the
     air. A quake that out-throws the cap would leave slabs hanging over the
     street, so a job that throws bodies waits while the sky is full (the
     ones in flight land in a second or two) and only then goes. */
  let liveCap = 0;
  function skyFull() {
    const D = CBZ.debris, L = liveBodies();
    if (!D || !L) return false;
    if (!liveCap) { try { liveCap = (D.stats().caps || {}).live || 140; } catch (e) { liveCap = 140; } }
    return L.length > liveCap * 0.6;
  }
  const THROWS = { pane: 1, wall: 1, peel: 1, shed: 1, soft: 1, collapse: 1 };
  let stall = 0;
  function runJobs() {
    const t0 = performance.now(), budget = PHONE ? 2.5 : 4;
    let k = 0;
    while ((jobs.length || glassJobs.length) && (k < 1 || performance.now() - t0 < budget) && k < (PHONE ? 2 : 4)) {
      const q = jobs.length ? jobs : glassJobs;
      const j0 = q[0];
      // the queues keep their order (a facade's wounds come before its
      // collapse), so a full sky holds them, a second at a time: after that
      // one job goes every half second whatever the sky holds
      if (THROWS[j0.tag] && skyFull()) {
        if (++stall < 60) { A.jobWaits++; break; }
        stall = 30;
      } else stall = 0;
      const j = q.shift(); k++;
      const t1 = performance.now();
      try { j.fn(); } catch (e) { A.jobErrors++; if (CBZ.quake && CBZ.quake._debug) console.warn("[quake job]", j.tag, e); }
      const ms = performance.now() - t1;
      const c = jobCost[j.tag] || (jobCost[j.tag] = { n: 0, ms: 0, max: 0 });
      c.n++; c.ms += ms; if (ms > c.max) c.max = ms;
    }
  }
  function faceNormals(S) {
    return [{ x: 0, z: -1 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 1, z: 0 }];
  }
  function facePoint(S, n, u, y) {
    // a point on face n, u in -0.5..0.5 along it, at height y
    if (n.z) return { x: S.x + u * S.w * 0.9, y: y, z: S.z + n.z * (S.d / 2 + 0.02) };
    return { x: S.x + n.x * (S.w / 2 + 0.02), y: y, z: S.z + u * S.d * 0.9 };
  }
  function upperY(S, frac) { return S.gy + S.h * (frac != null ? frac : 0.55 + rnd() * 0.4); }

  function panesOf(S) {
    if (S.paneList) return S.paneList;
    let list = [];
    if (S.src.glass && S.src.glass.length) list = S.src.glass.slice();
    else if (CBZ.cityGlassRecs) {
      const x0 = S.x - S.w / 2 - 1.2, x1 = S.x + S.w / 2 + 1.2, z0 = S.z - S.d / 2 - 1.2, z1 = S.z + S.d / 2 + 1.2;
      const G = CBZ.cityGlassRecs;
      for (let i = 0; i < G.length; i++) { const g = G[i]; if (g.x >= x0 && g.x <= x1 && g.z >= z0 && g.z <= z1) list.push(g); }
    }
    // the order they go in: weighted by height (drift whips the upper
    // floors) on a uniform draw, so the top of a tower rains first
    const key = new Map();
    for (const g of list) key.set(g, rnd() * (0.45 + Math.max(0, Math.min(1, ((g.y || 0) - S.gy) / Math.max(1, S.h)))));
    list.sort(function (a, b) { return key.get(b) - key.get(a); });
    S.paneList = list; S.paneAt = 0;
    return list;
  }
  function breakPane(S, gp) {
    if (!gp || gp.shattered) return false;
    if (S.city && CBZ.cityShatterRay && gp.hw != null) {
      const horiz = gp.hd < gp.hw;
      const nx = horiz ? 0 : (gp.x >= S.x ? 1 : -1), nz = horiz ? (gp.z >= S.z ? 1 : -1) : 0;
      // struck from INSIDE: a racked frame throws its glazing out over the
      // street, it does not punch it into the room
      try { CBZ.cityShatterRay(gp.x - nx * 0.6, gp.y, gp.z - nz * 0.6, nx, 0, nz, 1.2, true, {}); } catch (e) {}
      return !!gp.shattered;
    }
    if (CBZ.island && CBZ.island.breakPane) { try { CBZ.island.breakPane(gp); return true; } catch (e) {} }
    // the island's pane contract (world/disaster_arena.js addGlass / the
    // merged facade glass): a real mesh, or a hide() on the merged glass
    // with its material, broken into its own radial shards
    gp.shattered = true;
    const D = CBZ.debris, at = { x: gp.x, y: gp.y, z: gp.z };
    if (gp.mesh && !gp.hide) {
      if (D) D.shatter(gp.mesh, { kind: "glass", at: at, power: 0.9, maxPieces: PHONE ? 4 : 7, owner: "fx" });
      gp.mesh.visible = false;
      return true;
    }
    if (gp.hide) gp.hide(); else if (gp.mesh) gp.mesh.visible = false;
    if (D && gp.mat) {
      const hs = gp.span || 0.6, hh = gp.hh || 0.7, th = 0.012;
      const box = gp.horiz
        ? { minX: gp.x - hs, maxX: gp.x + hs, minY: gp.y - hh, maxY: gp.y + hh, minZ: gp.z - th, maxZ: gp.z + th }
        : { minX: gp.x - th, maxX: gp.x + th, minY: gp.y - hh, maxY: gp.y + hh, minZ: gp.z - hs, maxZ: gp.z + hs };
      D.shatterBox(box, gp.mat, { kind: "glass", at: at, power: 0.9, maxPieces: PHONE ? 4 : 7, owner: "fx" });
    } else if (D) D.chips(at.x, at.y, at.z, { kind: "glass", count: 6, power: 0.8 });
    return true;
  }
  function glassTo(S, frac) {
    const list = panesOf(S);
    const want = Math.round(list.length * Math.min(1, frac));
    while (S.paneAt < want) {
      const gp = list[S.paneAt++];
      // a building that has come down took its glass with it
      job(function () { if (!S.collapsed && breakPane(S, gp)) { S.panes++; A.panesBroken++; } }, "pane");
    }
  }
  function wallHits(S, n, count, r, energy, yLo, yHi, fling) {
    for (let i = 0; i < count; i++) {
      const p = facePoint(S, n, rnd() - 0.5, S.gy + S.h * (yLo + rnd() * (yHi - yLo)));
      // the wall rotates off its base: its middle lands near, its top far
      const fl = fling ? fling * (0.35 + 0.9 * rnd()) : 0;
      job(function () { if (S.holes < 14 && !S.collapsed) { S.holes++; BD.hit(S, p, r, energy, n, fl); } }, "wall");
    }
  }
  function dustBillow(S, power) {
    const D = CBZ.debris;
    const col = S.wallCol != null ? S.wallCol : 0xb6a892;
    if (D && D.dust) for (let i = 0; i < 3; i++) {
      const n = faceNormals(S)[i];
      const p = facePoint(S, n, Math.random() - 0.5, S.gy + 1);
      try { D.dust(p.x, p.y, p.z, { color: col, power: power, radius: Math.min(4, Math.max(S.w, S.d) * 0.3) }); } catch (e) {}
    }
    A.dustClouds++;
    // the collapse cloud: a rolling, rising column the colour of the building
    if (CBZ.fx && CBZ.fx.particleCloud && clouds.length < (PHONE ? 2 : 4)) {
      const c = CBZ.fx.particleCloud({ mode: "rise", color: 0xa69a88, count: PHONE ? 60 : 120, radius: Math.max(S.w, S.d) * 0.8, top: Math.min(30, S.h * 0.7 + 6), size: 0.9, opacity: 0.42, vMin: 1, vMax: 3.2, drift: 2.5 });
      if (c) { c.setActive(Math.min(1, power / 3)); clouds.push({ c: c, x: S.x, y: S.gy, z: S.z, t: 0, life: 14 }); }
    }
  }
  const clouds = [];
  function tickClouds(dt) {
    for (let i = clouds.length - 1; i >= 0; i--) {
      const k = clouds[i];
      k.t += dt;
      k.c.setActive(Math.max(0, 1 - k.t / k.life));
      k.c.update(dt, k.x, k.y, k.z);
      if (k.t > k.life) { k.c.dispose(); clouds.splice(i, 1); }
    }
  }

  function enterState(S, k) {
    const TY = TYPES[S.type];
    const n = S.n;
    if (ev.hooks.damage) { try { ev.hooks.damage(S.src, k, S); } catch (e) {} }
    if (TY.glass[k - 1]) glassTo(S, TY.glass[k - 1]);
    if (k === 1) {
      // the roof line goes first on brittle buildings: parapets over the
      // street, chimney stacks off houses
      if (S.parapet && S.type === "URM") job(function () { if (peelTop(S, S.x + n.x * S.w * 0.45, S.z + n.z * S.d * 0.45, Math.max(S.w, S.d) * 0.4, "parapet")) A.parapets++; }, "peel");
      if ((S.type === "URM" || S.type === "W") && S.storeys <= 4 && rnd() < 0.6) {
        const cx = S.x + (rnd() - 0.5) * S.w * 0.6, cz = S.z + (rnd() - 0.5) * S.d * 0.6;
        job(function () { if (peelTop(S, cx, cz, 1.6, "crown")) A.chimneys++; }, "peel");
      }
    } else if (k === 2) {
      if (S.type === "URM") {
        // the facade starts shedding while the ground keeps moving
        S.shedRate = 0.45;
        if (S.parapet) { const m = faceNormals(S)[(rnd() * 4) | 0]; job(function () { if (peelTop(S, S.x + m.x * S.w * 0.45, S.z + m.z * S.d * 0.45, Math.max(S.w, S.d) * 0.4, "parapet")) A.parapets++; }, "peel"); }
      } else if (S.type === "C") { wallHits(S, n, 2, 0.8, 0.5, 0.15, 0.9); S.shedRate = 0.15; }
      else if (S.type === "S" || S.type === "CW") { wallHits(S, n, 1, 0.9, 0.4, 0.5, 0.95); }
      else if (S.type === "W") { lean(S, 0.012); }
    } else if (k === 3) {
      if (S.type === "URM") {
        // OUT-OF-PLANE FAILURE: the top of one wall comes away whole
        const m = rnd() < 0.6 ? n : faceNormals(S)[(rnd() * 4) | 0];
        wallHits(S, m, PHONE ? 3 : 5, 1.4, 1.1, 0.68, 0.98, Math.sqrt(9.81 * S.h) * 0.3);
        S.shedRate = 1.2;
        lean(S, 0.018);
        job(function () { dustBillow(S, 1.6); }, "dust");
      } else if (S.soft) {
        // THE SOFT STOREY GOES: the ground floor racks flat, the building
        // above comes down a storey and leans over the street
        const tilt = 0.05 + rnd() * 0.05;
        job(function () {
          A.softStoreys++;
          crushFloor(S);
          BD.undermine(S, { drop: S.FH * 0.88, tilt: tilt, ax: n.z, az: -n.x, secs: 0.55, soft: true });
          dustBillow(S, 2.6);
          if (CBZ.shake) CBZ.shake(0.25);
          sfxAt("collapse", S.x, S.z, {});
        }, "soft");
      } else {
        if (S.parapet) job(function () { if (peelTop(S, S.x + n.x * S.w * 0.45, S.z + n.z * S.d * 0.45, Math.max(S.w, S.d) * 0.3, "parapet")) A.parapets++; }, "peel");
        wallHits(S, n, PHONE ? 2 : 3, 1.1, 0.8, 0.1, 0.9);
        lean(S, S.type === "W" ? 0.035 : 0.014);
        job(function () { dustBillow(S, 1.2); }, "dust");
      }
    } else if (k === 4) {
      /* THE LEDGER DECIDES NOW (the caller's collapse draws from the shared
         stream, so it must not wait on a frame budget); the picture of it
         comes down through the queue. */
      if (ev.hooks.collapse) {
        S.collapsed = true; A.collapses++;
        try { ev.hooks.collapse(S.src, n); } catch (e) {}
        job(function () { dustBillow(S, 3); }, "dust");
      } else job(function () { dustBillow(S, 3); BD.collapse(S, n); }, "collapse");
    }
  }
  /* A permanent lean: the building's own group rotates about its base (the
     frame has yielded). */
  function lean(S, ang) {
    if (!S.group || S.collapsed) return;
    const n = S.n;
    _piv.set(S.x, S.gy, S.z);
    _axis.set(n.z, 0, -n.x);
    const g = S.group;
    g.position.sub(_piv).applyAxisAngle(_axis, ang).add(_piv);
    g.rotateOnWorldAxis(_axis, ang);
    S.leanRad = (S.leanRad || 0) + ang;
  }
  // the ground floor of a soft-storey building, crushed: its walls leave
  // through the adapter as pieces of themselves, and whoever is in it is
  // under the building
  function crushFloor(S) {
    // the open front (the shopfront, the lobby) and one flank burst out
    const fs = [S.n, faceNormals(S)[(Math.random() * 4) | 0]];
    for (let i = 0; i < fs.length; i++) {
      const p = facePoint(S, fs[i], Math.random() - 0.5, S.gy + S.FH * 0.5);
      if (S.city) BD.hit(S, p, 1.2, 1.2, fs[i]); else shedFace(S, p, 1.4, 1.4, fs[i]);
    }
    eachActorNear(S.x, S.z, Math.max(S.w, S.d) * 0.6, function (a) {
      if (!a.pos) return;
      if (Math.abs(a.pos.x - S.x) > S.w / 2 || Math.abs(a.pos.z - S.z) > S.d / 2) return;
      if ((a.pos.y || 0) > S.gy + S.FH * 1.2) return;
      const c = cover(a);
      wound(a, 160 * (c.kind === "table" ? 0.4 : 1), "crushed when the ground floor gave way", { x: S.x, z: S.z, lethal: c.kind !== "table", tag: "debris" });
    });
  }

  function respond(S, dt, E) {
    if (S.collapsed) return;
    // the mainshock (P, S, coda, surface train) ...
    const sa = S.saS * E.m + S.saR * E.r + S.saP * E.p;
    if (sa > S.peak) S.peak = sa;
    // cycles of strong motion (above 40% of what this building has felt)
    if (sa > 0.4 * S.peak && sa > 0.05) S.cyc += dt * (E.r > E.m ? 1 / ev.p.surfT : S.fS);
    // ... and the aftershocks, kept apart
    const saA = S.saS * (E.a || 0);
    if (saA > (S.peakA || 0)) {
      if (!S.peakA) S.dsMain = S.ds;
      S.peakA = saA;
    }
    let ds = S.ds;
    const D = S.peak * (1 + S.degrade * Math.log(1 + S.cyc / 8));
    while (ds < 4 && fragP(D, S.med[ds], S.beta) > S.u) ds++;
    /* AFTERSHOCKS find a weakened frame: their own (smaller) demand against
       capacities cut 8% per state the mainshock left it in. */
    if (S.peakA) {
      const capK = 1 - 0.08 * (S.dsMain || 0);
      while (ds < 4 && fragP(S.peakA * (1 + S.degrade), S.med[ds] * capK, S.beta) > S.u) ds++;
    }
    while (S.ds < ds) { S.ds++; enterState(S, S.ds); }
    // the continuous shed: brittle facades let go of bricks while it shakes
    if (S.shedRate && E.s > 0.25 && !S.collapsed) {
      S.shedAcc += S.shedRate * E.s * dt;
      if (S.shedAcc >= 1) {
        S.shedAcc -= 1;
        const m = rnd() < 0.55 ? S.n : faceNormals(S)[(rnd() * 4) | 0];
        // bricks and spalled render off the SURFACE: the wall loses its skin,
        // not a hole (holes are the extensive state's out-of-plane failure)
        const p = facePoint(S, m, rnd() - 0.5, upperY(S)), r = S.type === "URM" ? 0.4 + rnd() * 0.35 : 0.3 + rnd() * 0.2;
        if (S.shed < 160) job(function () { shedFace(S, p, r, 0.5, m); }, "shed");
      }
    }
  }

  /* ============================================================
     THE GROUND — what the shaking does to the ground itself.

       cracks     MMI VII-VIII opens cracks in roads, IX conspicuous ones.
                  Fissures open in the asphalt across (mostly) and along the
                  carriageway, widening while the strong motion lasts, wider
                  still on soft ground; one merged mesh, one draw, its width
                  written per vertex as it opens.
       mains      where a crack opens wide across a road the pipe under it
                  shears: a geyser out of the break and a spreading sheet
                  of water on the asphalt.
       liquefaction  soft saturated ground near the water, once enough
                  cycles have run (magParams.liq): sand boils erupt in the
                  open, buildings on it settle and lean on their own base,
                  parked cars sink and tilt.
     WHERE things are comes from the world, never from coordinates here:
     the event's own `roads` / `onRoad` / `lowGround`, else CBZ.island's
     roads and low ground (world/disaster_arena.js publishes them), else the
     arena's own street test.
     ============================================================ */
  function groundAt(x, z) {
    if (ev.groundAt) { try { const y = ev.groundAt(x, z); if (isFinite(y)) return y; } catch (e) {} }
    return floorAt(x, z);
  }
  function lowGroundAt(x, z) {
    if (ev.lowGround) { try { return !!ev.lowGround(x, z); } catch (e) { return false; } }
    if (ev.soil === "soft") return true;          // the caller said: all of it
    const I = CBZ.island, lg = I && (I.lowGround || I.lowground);
    if (lg) {
      if (typeof lg === "function") { try { return !!lg(x, z); } catch (e) { return false; } }
      if (typeof lg.at === "function") { try { return !!lg.at(x, z); } catch (e) { return false; } }
      const list = Array.isArray(lg) ? lg : (Array.isArray(lg.zones) ? lg.zones : null);
      if (list) {
        for (let i = 0; i < list.length; i++) {
          const r = list[i];
          if (r.r != null && Math.hypot(x - r.x, z - r.z) < r.r) return true;
          if (r.x0 != null && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return true;
        }
        return false;
      }
    }
    // the island without a published map: land within ~2.2 m of sea level
    if (inSurv()) { const y = groundAt(x, z); return y > -0.4 && y < 2.2; }
    return false;
  }
  function soilAt(x, z) {
    if (ev.soil) return ev.soil;
    if (lowGroundAt(x, z)) return "soft";
    return groundAt(x, z) > 18 ? "rock" : "firm";
  }
  function normRoad(r) {
    if (!r) return null;
    if (r.x0 != null) return { x0: Math.min(r.x0, r.x1), x1: Math.max(r.x0, r.x1), z0: Math.min(r.z0, r.z1), z1: Math.max(r.z0, r.z1) };
    if (r.len != null && r.x != null) {
      const hw = (r.w || 7) / 2, hl = r.len / 2;
      return r.vertical ? { x0: r.x - hw, x1: r.x + hw, z0: r.z - hl, z1: r.z + hl } : { x0: r.x - hl, x1: r.x + hl, z0: r.z - hw, z1: r.z + hw };
    }
    if (r.a && r.b) {
      const hw = (r.w || 7) / 2;
      return { x0: Math.min(r.a.x, r.b.x) - hw, x1: Math.max(r.a.x, r.b.x) + hw, z0: Math.min(r.a.z, r.b.z) - hw, z1: Math.max(r.a.z, r.b.z) + hw };
    }
    return null;
  }
  function roadRects() {
    if (ev.roadList) return ev.roadList;
    let out = [];
    const I = CBZ.island;
    const src = ev.roads || (I && Array.isArray(I.roads) ? I.roads : null);
    if (src) out = src.map(normRoad).filter(Boolean);
    else if (ev.onRoad) {
      // no list: walk the arena's own street test on a 6 m grid
      const R = ev.R, STEP = 6;
      for (let x = ev.cx - R; x <= ev.cx + R; x += STEP) {
        for (let z = ev.cz - R; z <= ev.cz + R; z += STEP) {
          let on = false;
          try { on = ev.onRoad(x, z, 0.5, 0.5); } catch (e) {}
          if (on) out.push({ x0: x - STEP / 2, x1: x + STEP / 2, z0: z - STEP / 2, z1: z + STEP / 2 });
        }
      }
    }
    // only the roads that are near this event's structures matter
    ev.roadList = out.filter(function (r) { return Math.hypot((r.x0 + r.x1) / 2 - ev.cx, (r.z0 + r.z1) / 2 - ev.cz) < ev.R * 1.6; });
    return ev.roadList;
  }

  const ground = { cracks: [], mesh: null, base: null, open: 0, planted: false, len: 0, wmax: 0,
    mains: [], boils: null, boilList: [], liqDone: false };
  const CRACK_DARK = [0.035, 0.032, 0.03], CRACK_LIP = [0.36, 0.345, 0.32];
  function plantCracks() {
    ground.planted = true;
    const p = ev.p;
    const soft = (ev.soil || p.src.soil) === "soft" || p.liq;
    const thr = soft ? 0.15 : 0.25;
    if (p.pgaG < thr) return;
    const rects = roadRects();
    if (!rects.length) return;
    const n = Math.min(PHONE ? 6 : 10, Math.round(2 + 14 * (p.pgaG - thr)));
    const pos = [], col = [], side = [], idx = [];
    let vi = 0;
    for (let c = 0; c < n; c++) {
      const r = rects[(rnd() * rects.length) | 0];
      const alongX = (r.x1 - r.x0) >= (r.z1 - r.z0);
      let x = r.x0 + rnd() * (r.x1 - r.x0), z = r.z0 + rnd() * (r.z1 - r.z0);
      // most cracks run ACROSS the carriageway (the slab breaks between its
      // kerbs), some split along it
      let hd = (alongX ? Math.PI / 2 : 0) + (rnd() < 0.3 ? Math.PI / 2 : 0) + (rnd() - 0.5) * 0.8;
      if (rnd() < 0.5) hd += Math.PI;
      const L = 4 + rnd() * 14 * Math.min(1.5, p.pgaG / 0.5);
      const wMax = Math.min(0.35, 0.03 + 0.4 * (p.pgaG - thr) + (soft ? 0.08 : 0)) * (0.6 + 0.4 * rnd());
      const pts = [];
      const pad = 1.5;
      for (let s = 0; s <= L; s += 0.7) {
        pts.push(x, z);
        hd += (rnd() - 0.5) * 0.7;
        x += Math.sin(hd) * 0.7; z += Math.cos(hd) * 0.7;
        if (x < r.x0 - pad || x > r.x1 + pad || z < r.z0 - pad || z > r.z1 + pad) break;
      }
      const m = pts.length / 2;
      if (m < 3) continue;
      ground.cracks.push({ x: pts[0], z: pts[1], mx: pts[(m >> 1) * 2], mz: pts[(m >> 1) * 2 + 1], w: wMax, len: (m - 1) * 0.7 });
      ground.len += (m - 1) * 0.7;
      if (wMax > ground.wmax) ground.wmax = wMax;
      // a ribbon: lip | dark throat | dark throat | lip, tapered at both ends
      for (let k = 0; k < m; k++) {
        const px = pts[k * 2], pz = pts[k * 2 + 1];
        const qx = pts[Math.min(m - 1, k + 1) * 2] - pts[Math.max(0, k - 1) * 2];
        const qz = pts[Math.min(m - 1, k + 1) * 2 + 1] - pts[Math.max(0, k - 1) * 2 + 1];
        const ql = Math.hypot(qx, qz) || 1;
        const sx = -qz / ql, sz = qx / ql;
        const taper = Math.pow(Math.sin(Math.PI * k / (m - 1)), 0.6) * (0.75 + 0.25 * Math.sin(k * 1.7 + c));
        const y = groundAt(px, pz) + 0.018;
        const offs = [-(1.9 * taper * wMax + 0.05), -0.5 * taper * wMax, 0.5 * taper * wMax, 1.9 * taper * wMax + 0.05];
        for (let j = 0; j < 4; j++) {
          pos.push(px, y, pz);
          side.push(sx, sz, offs[j]);
          const cc = (j === 0 || j === 3) ? CRACK_LIP : CRACK_DARK;
          col.push(cc[0], cc[1], cc[2]);
        }
        if (k > 0) {
          const a0 = vi + (k - 1) * 4, b0 = vi + k * 4;
          for (let j = 0; j < 3; j++) idx.push(a0 + j, b0 + j, a0 + j + 1, a0 + j + 1, b0 + j, b0 + j + 1);
        }
      }
      vi += m * 4;
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(new Float32Array(pos.length).map(function (_, i) { return i % 3 === 1 ? 1 : 0; }), 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    m.name = "quake-cracks"; m.receiveShadow = true; m.frustumCulled = false; m.renderOrder = 1;
    if (scene()) scene().add(m);
    ground.mesh = m; ground.base = new Float32Array(pos); ground.side = new Float32Array(side);
    A.cracks = ground.cracks.length;
    // where a wide crack crosses the road, the main under it shears
    const want = PHONE ? 2 : 3;
    for (let i = 0; i < ground.cracks.length && ground.mains.length < want; i++) {
      const c = ground.cracks[i];
      if (c.w > 0.06 && rnd() < 0.45) ground.mains.push({ x: c.mx, z: c.mz, at: 0.45 + rnd() * 0.4, on: false, t: 0, cloud: null, pool: null });
    }
  }
  function openCracks(open) {
    if (!ground.mesh || open <= ground.open + 1e-3) return;
    ground.open = Math.min(1, open);
    const P = ground.mesh.geometry.attributes.position, B = ground.base, Sd = ground.side;
    for (let i = 0, n = B.length / 3; i < n; i++) {
      const o = Sd[i * 3 + 2] * ground.open;
      P.array[i * 3] = B[i * 3] + Sd[i * 3] * o;
      P.array[i * 3 + 2] = B[i * 3 + 2] + Sd[i * 3 + 1] * o;
    }
    P.needsUpdate = true;
  }
  function tickMains(dt) {
    for (let i = 0; i < ground.mains.length; i++) {
      const w = ground.mains[i];
      if (!w.on) {
        if (ground.open < w.at) continue;
        w.on = true; A.mains++;
        const y = groundAt(w.x, w.z);
        w.y = y;
        if (CBZ.fx && CBZ.fx.particleCloud) {
          w.cloud = CBZ.fx.particleCloud({ mode: "rise", color: 0xd6e6ee, count: PHONE ? 40 : 80, radius: 0.45, top: 3 + rnd() * 4, bottom: 0, size: 0.2, opacity: 0.6, vMin: 5, vMax: 9, drift: 0.8 });
          if (w.cloud) w.cloud.setActive(1);
        }
        const pool = new THREE.Mesh(new THREE.CircleGeometry(1, 22).rotateX(-Math.PI / 2),
          new THREE.MeshLambertMaterial({ color: 0x2c343b, transparent: true, opacity: 0.62, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
        pool.position.set(w.x, y + 0.025, w.z); pool.scale.set(0.2, 1, 0.2); pool.renderOrder = 2;
        if (scene()) scene().add(pool);
        w.pool = pool;
        sfxAt("splash", w.x, w.z, { vol: 0.5 });
      }
      w.t += dt;
      if (w.cloud) w.cloud.update(dt, w.x, w.y, w.z);
      const r = Math.min(6, 0.2 + w.t * 0.22);
      if (w.pool) w.pool.scale.set(r, 1, r * 0.8);
    }
  }
  // ---- liquefaction --------------------------------------------------
  function liquefy() {
    ground.liqDone = true;
    // buildings on liquefiable ground settle and lean on their own base
    for (let i = 0; i < ev.S.length; i++) {
      const S = ev.S[i];
      if (S.collapsed || S.soil !== "soft") continue;
      S.liq = true;
      const n = S.n;
      const reg = { drop: 0.15 + rnd() * 0.45, tilt: 0.02 + rnd() * 0.05, ax: rnd() < 0.5 ? n.z : 1, az: rnd() < 0.5 ? -n.x : 0, secs: 4 + rnd() * 3 };
      // settlement is damage: at least moderate, decided now
      while (S.ds < 2) { S.ds++; enterState(S, S.ds); }
      A.settled++;
      job(function () { BD.undermine(S, reg); }, "settle");
    }
    // cars on it sink and tilt
    for (let i = 0; i < ev.cars.length; i++) {
      const C = ev.cars[i];
      if (soilAt(C.x0, C.z0) === "soft") { C.sinkTo = 0.08 + rnd() * 0.18; C.tiltTo = (rnd() - 0.5) * 0.12; }
    }
    // sand boils in the open
    const want = PHONE ? 10 : 22, pts = [];
    for (let k = 0; k < 160 && pts.length < want; k++) {
      const a = rnd() * 6.2832, d = rnd() * ev.R * 1.2;
      const x = ev.cx + Math.cos(a) * d, z = ev.cz + Math.sin(a) * d;
      if (!lowGroundAt(x, z) || insideStructure(x, z, 1.5)) continue;
      pts.push({ x: x, z: z, y: groundAt(x, z), r: 0.4 + rnd() * 1.0, at: rnd() * 6, t: 0 });
    }
    if (A.settled || pts.length) A.liquefied = 1;
    if (!pts.length) return;
    const geo = new THREE.ConeGeometry(1, 0.22, 12, 2, false);
    geo.translate(0, 0.11, 0);
    const P = geo.attributes.position, cc = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      const wet = Math.max(0, Math.min(1, P.getY(i) / 0.22));       // the wet vent darkens to the top
      cc[i * 3] = 0.56 - 0.26 * wet; cc[i * 3 + 1] = 0.5 - 0.24 * wet; cc[i * 3 + 2] = 0.4 - 0.2 * wet;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(cc, 3));
    const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), pts.length);
    im.name = "quake-sand-boils"; im.receiveShadow = true; im.frustumCulled = false;
    const M = new THREE.Matrix4();
    for (let i = 0; i < pts.length; i++) { M.makeScale(0.001, 0.001, 0.001); M.setPosition(pts[i].x, pts[i].y, pts[i].z); im.setMatrixAt(i, M); }
    if (scene()) scene().add(im);
    ground.boils = im; ground.boilList = pts;
    A.boils = pts.length;
  }
  const _bm = new THREE.Matrix4();
  function tickBoils(dt) {
    const im = ground.boils;
    if (!im) return;
    let dirty = false;
    for (let i = 0; i < ground.boilList.length; i++) {
      const b = ground.boilList[i];
      if (b.t >= 3) continue;
      b.at -= dt;
      if (b.at > 0) continue;
      b.t += dt;
      const s = b.r * Math.min(1, b.t / 3);
      _bm.makeScale(s, 0.5 + 0.5 * Math.min(1, b.t / 3), s);
      _bm.setPosition(b.x, b.y, b.z);
      im.setMatrixAt(i, _bm); dirty = true;
    }
    if (dirty) im.instanceMatrix.needsUpdate = true;
  }
  function insideStructure(x, z, pad) {
    for (let i = 0; i < ev.S.length; i++) {
      const S = ev.S[i];
      if (Math.abs(x - S.x) < S.w / 2 + pad && Math.abs(z - S.z) < S.d / 2 + pad) return S;
    }
    return null;
  }
  function clearGround() {
    if (ground.mesh) { if (ground.mesh.parent) ground.mesh.parent.remove(ground.mesh); ground.mesh.geometry.dispose(); ground.mesh.material.dispose(); }
    for (const w of ground.mains) {
      if (w.cloud) w.cloud.dispose();
      if (w.pool) { if (w.pool.parent) w.pool.parent.remove(w.pool); w.pool.geometry.dispose(); w.pool.material.dispose(); }
    }
    if (ground.boils) { if (ground.boils.parent) ground.boils.parent.remove(ground.boils); ground.boils.geometry.dispose(); ground.boils.material.dispose(); }
    ground.cracks = []; ground.mesh = null; ground.base = null; ground.open = 0; ground.planted = false; ground.len = 0; ground.wmax = 0;
    ground.mains = []; ground.boils = null; ground.boilList = []; ground.liqDone = false;
    for (const k of clouds) k.c.dispose();
    clouds.length = 0;
  }

  /* ============================================================
     THE CARS — a parked car is a sprung mass on four tyres with its
     handbrake on the rear axle.
       along     it ROLLS: the tyres turn, only the rear brake resists
                 (~0.33 g), so above that the ground moves out from under
                 it and the car walks back and forth along its own axis
       across    the tyres grip to ~0.8 g, so it rocks on its springs
                 (~1.4 Hz) instead, and only slides beyond that
       vertical  it heaves on its springs; when the ground drops away
                 faster than gravity (vertical PGA over 1 g) it leaves it
     A falling piece that reaches it dents or crushes it by its energy, and
     its own glass goes. A car rolls over only if the ground throws it past
     its tipping angle, which a quake rarely does: that is honest.
     ============================================================ */
  function carOf(c) {
    if (!c || !c.group || c.dead || c.flung) return null;
    const g = c.group;
    let W = 1.9, L = 4.4;
    if (c.dims) { W = c.dims.width || W; L = c.dims.length || L; }
    else if (c.collider) {
      const ex = c.collider.maxX - c.collider.minX, ez = c.collider.maxZ - c.collider.minZ;
      W = Math.min(ex, ez) * 0.9; L = Math.max(ex, ez);
    }
    const x0 = c.pos ? c.pos.x : (c.x != null ? c.x : g.position.x);
    const z0 = c.pos ? c.pos.z : (c.z != null ? c.z : g.position.z);
    return {
      src: c, g: g, city: !!c.pos, x0: x0, z0: z0, y0: g.position.y, yaw: c.pos ? (c.heading || 0) : g.rotation.y,
      order: g.rotation.order, rx0: g.rotation.x, rz0: g.rotation.z,
      W: W, L: L, H: 1.55, k: 1,
      rf: 0, rs: 0, vf: 0, vs: 0, roll: 0, rollV: 0, pitch: 0, pitchV: 0, hv: 0, hvV: 0, air: 0, airV: 0,
      sink: 0, sinkTo: 0, tilt: 0, tiltTo: 0, hit: 0, crushed: false, rolled: 0,
      maxB: 0, maxRoll: 0, walked: 0, colX: 0, colZ: 0,
    };
  }
  function carTick(C, dt) {
    const g = C.g;
    if (C.crushed) return;
    const G = 9.81, k = C.k;
    const ax = motion.acc.x * k, az = motion.acc.z * k, ay = motion.acc.y * k;
    const fx = Math.sin(C.yaw), fz = Math.cos(C.yaw), rxv = Math.cos(C.yaw), rzv = -Math.sin(C.yaw);
    const aF = ax * fx + az * fz, aR = ax * rxv + az * rzv;
    // along: rolling against the rear brake
    C.vf = slip(C.vf, aF, 0.33 * G, dt);
    C.rf += C.vf * dt;
    // across: tyre grip
    C.vs = slip(C.vs, aR, 0.8 * G, dt);
    C.rs += C.vs * dt;
    // the body on its springs
    const wR = 6.3 * 1.4, zR = 0.25;
    C.rollV += (wR * wR * (-C.roll - 0.0061 * aR) - 2 * zR * wR * C.rollV) * dt;
    C.roll += C.rollV * dt;
    C.pitchV += (wR * wR * (-C.pitch + 0.004 * (C.vf === 0 ? aF : 0)) - 2 * zR * wR * C.pitchV) * dt;
    C.pitch += C.pitchV * dt;
    const wH = 6.3 * 1.3;
    C.hvV += (wH * wH * (-C.hv) - 2 * 0.3 * wH * C.hvV - ay * 0.6) * dt;
    C.hv += C.hvV * dt;
    // airborne: the ground falls away faster than gravity
    if (C.air > 0 || ay < -G) {
      if (C.air <= 0 && ay < -G) { C.airV = 0; C.air = 1e-4; }
      C.airV += (-G - ay) * dt;
      C.air += C.airV * dt;
      if (C.air <= 0) { C.air = 0; C.airV = 0; if (rnd() < 0.3) sfxAt("thud", C.x0, C.z0, { vol: 0.3 }); }
    }
    // liquefied ground takes it down by the wheels
    if (C.sinkTo) { C.sink += (C.sinkTo - C.sink) * Math.min(1, dt * 0.4); C.tilt += (C.tiltTo - C.tilt) * Math.min(1, dt * 0.4); }
    // the tipping angle: a car's track over its centre of gravity (~0.9 rad)
    if (!C.rolled && Math.abs(C.roll) > 0.55) { C.rolled = Math.sign(C.roll); A.carsRolled++; }
    if (C.rolled) { C.roll += (C.rolled * 1.57 - C.roll) * Math.min(1, dt * 3); C.rollV = 0; }
    const dx = fx * C.rf + rxv * C.rs, dz = fz * C.rf + rzv * C.rs;
    const px = C.x0 + dx + motion.disp.x * k, pz = C.z0 + dz + motion.disp.z * k;
    const bounce = C.hv + C.air;
    g.position.set(px, C.y0 + motion.disp.y * k + bounce - C.sink, pz);
    g.rotation.order = "YXZ";
    g.rotation.x = C.rx0 + C.pitch;
    g.rotation.z = C.rz0 + C.roll + C.tilt;
    if (C.city) { C.src.pos.x = C.x0 + dx; C.src.pos.z = C.z0 + dz; }
    else if (C.src.collider) {
      const c = C.src.collider, mx = dx - C.colX, mz = dz - C.colZ;
      c.minX += mx; c.maxX += mx; c.minZ += mz; c.maxZ += mz;
      C.colX = dx; C.colZ = dz;
    }
    const b = Math.abs(bounce + motion.disp.y * k);
    if (b > C.maxB) C.maxB = b;
    if (Math.abs(C.roll) > C.maxRoll) C.maxRoll = Math.abs(C.roll);
    C.walked = Math.max(C.walked, Math.hypot(dx, dz));
  }
  // relative velocity of a body on a moving base held by friction `lim`
  function slip(v, aBase, lim, dt) {
    if (v === 0) {
      if (Math.abs(aBase) <= lim) return 0;
      return (-aBase + Math.sign(aBase) * lim) * dt;
    }
    const nv = v + (-aBase - Math.sign(v) * lim) * dt;
    return (nv > 0) !== (v > 0) ? 0 : nv * 0.995;
  }
  function carStrike(C, p, ke) {
    const g = C.g, gx = g.position.x, gz = g.position.z, gy = g.position.y;
    if (p.y > gy + C.H + 0.3 || p.y < gy - 0.2) return false;
    const dx = p.x - gx, dz = p.z - gz;
    const lz = dx * Math.sin(C.yaw) + dz * Math.cos(C.yaw), lx = dx * Math.cos(C.yaw) - dz * Math.sin(C.yaw);
    if (Math.abs(lx) > C.W / 2 + 0.15 || Math.abs(lz) > C.L / 2 + 0.15) return false;
    if (!C.hit) A.carsHit++;
    C.hit++;
    sfxAt("thud", p.x, p.z, { vol: 0.5 });
    if (ke > 6000 && !C.crushed) crushCar(C, lz);
    return true;
  }
  function crushCar(C, lz) {
    C.crushed = true; A.carsCrushed++;
    const g = C.g;
    // the roof goes down onto the sills, the struck end lower
    g.scale.y = 0.66;
    g.rotation.x += Math.sign(lz || 1) * 0.06;
    const D = CBZ.debris;
    if (D) {
      let pane = null;
      g.traverse(function (o) { if (!pane && o.isMesh && o.visible && o.material && !Array.isArray(o.material) && D.kindOf && D.kindOf(o.material, o) === "glass") pane = o; });
      const at = { x: g.position.x, y: g.position.y + 1.1, z: g.position.z };
      if (pane) D.shatter(pane, { kind: "glass", at: at, power: 1, maxPieces: PHONE ? 5 : 9, owner: "fx" });
      else D.chips(at.x, at.y, at.z, { kind: "glass", count: 14, power: 1, spread: 1.2 });
    }
    if (C.src) C.src.quakeCrushed = true;
    sfxAt("collapse", g.position.x, g.position.z, { vol: 0.6 });
  }
  function carsRestoreOrder() {
    for (let i = 0; i < ev.cars.length; i++) { const C = ev.cars[i]; if (C.g && C.order) C.g.rotation.order = C.order; }
  }

  /* ============================================================
     THE PEOPLE. At the first jolt everyone decides, once:
       indoors   drop, cover and hold on under the nearest sturdy table if
                 there is one within reach (the advice) — or, the thing
                 most people actually do, RUN FOR THE DOOR and out into the
                 street, which is how people end up under the facade
       by a wall clear off the pavement into the open, away from the
                 facade (the kill zone)
       in the open stay put and crouch while it is strong
     The ground still takes their feet (footingTick); the debris still
     finds the ones who ran under it (the strike pass). Bodies are OWNED by
     absolute writes for the duration (a brain steering them elsewhere at
     order 23 would cancel a nudge) and handed back afterwards.
     ============================================================ */
  function plan(a) {
    const x = a.pos.x, z = a.pos.z, y = a.pos.y || 0;
    const S = insideStructure(x, z, -0.2);
    if (S && y < S.gy + S.h) {
      const anc = coverNear(x, z, y, 7);
      if (anc && rnd() < 0.6) return { kind: "cover", anchor: anc };
      return { kind: "evac", S: S, leg: 0, tx: S.door.x, tz: S.door.z };
    }
    const near = insideStructure(x, z, 7);
    if (near) {
      // away from the nearest face, out to ~13 m clear of it
      let ox = x - near.x, oz = z - near.z;
      if (Math.abs(ox) / (near.w / 2 + 0.1) > Math.abs(oz) / (near.d / 2 + 0.1)) { oz = 0; ox = Math.sign(ox) || 1; } else { ox = 0; oz = Math.sign(oz) || 1; }
      const tx = ox ? near.x + ox * (near.w / 2 + 13) : x, tz = oz ? near.z + oz * (near.d / 2 + 13) : z;
      return { kind: "clear", tx: tx, tz: tz };
    }
    return { kind: "open" };
  }
  function ownedMove(a, tx, tz, spd, dt) {
    if (a._qkX == null) { a._qkX = a.pos.x; a._qkZ = a.pos.z; }
    const dx = tx - a._qkX, dz = tz - a._qkZ, d = Math.hypot(dx, dz);
    if (d < 0.5) return true;
    const st = Math.min(d, spd * dt);
    a._qkX += dx / d * st; a._qkZ += dz / d * st;
    a.pos.x = a._qkX; a.pos.z = a._qkZ;
    if (a.group) a.group.rotation.y = Math.atan2(dx, dz);
    return false;
  }
  function brace(a, on) {
    const ch = a.char;
    if (!ch || !ch.parts) return;
    const p = ch.parts;
    if (on) {
      if (p.ll) p.ll.rotation.x = -1.1;
      if (p.rl) p.rl.rotation.x = -1.1;
      if (p.torso) p.torso.rotation.x = 0.55;
      if (p.la) p.la.rotation.x = -0.9;
      if (p.ra) p.ra.rotation.x = -0.9;
      if (a.group) a.group.position.y = floorAt(a.pos.x, a.pos.z) - 0.32;
    } else if (p.torso) p.torso.rotation.x = 0;
  }
  function crowdTick(dt, E) {
    const list = ev.actors ? (function () { try { return ev.actors(); } catch (e) { return null; } })() : null;
    if (!list || !list.length) return;
    const p = ev.p;
    const strong = p.pgaG * Math.max(E.s, p.pK * E.p, p.surfK * 0.22 * E.r);
    const late = motion.t > p.sLag + p.mainDur + 4;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || a.dead || !a.pos || isPlayer(a)) continue;
      let r = a._qkPlan;
      if (r === undefined) {
        if (strong < 0.02 || late) continue;
        r = a._qkPlan = plan(a);
        A.crowd[r.kind] = (A.crowd[r.kind] || 0) + 1;
        ev.owned.push(a);
      }
      if (!r) continue;
      if (CBZ.body && CBZ.body.busy && CBZ.body.busy(a)) { a._qkX = null; continue; }   // on the ground
      const spd = 4.2 * (1 - Math.min(0.7, strong * 1.6));
      if (r.kind === "cover") { duckUnder(a, r.anchor, dt, 10); continue; }
      if (late) { if (r.kind !== "done") { standUp(a); r.kind = "done"; } continue; }
      if (r.kind === "evac") {
        if (ownedMove(a, r.tx, r.tz, spd, dt)) {
          if (r.leg === 0) { r.leg = 1; r.tx = r.S.door.x + r.S.n.x * 12; r.tz = r.S.door.z + r.S.n.z * 12; A.evacuated++; }
          else r.kind = "open";
        }
      } else if (r.kind === "clear") {
        if (ownedMove(a, r.tx, r.tz, spd, dt)) r.kind = "open";
      } else if (r.kind === "open") {
        brace(a, strong > 0.12);
      }
    }
  }
  function crowdRelease() {
    for (let i = 0; i < ev.owned.length; i++) {
      const a = ev.owned[i];
      if (!a) continue;
      standUp(a);
      a._qkPlan = undefined;
    }
    ev.owned.length = 0;
  }

  /* ============================================================
     THE EVENT — one earthquake, run the same way everywhere.

       CBZ.quake.eventStart(o) -> params      o: {
           M | src {M, epiKm, depthKm, offshore, bearing}   the source
           soil          force one site class (tools / the lab)
           cx, cz, R     the area it is played over
           structures    buildings: island fragile records, city lots
                         ({building}), or {building, colliders, platforms}
           lots          true when `structures` are real city lots
           cars          island car records or city car records
           actors()      the people to move (bots / peds)
           roads, onRoad, lowGround, groundAt   where the world is
           hooks {damage(src, ds, S), collapse(src, n)}  the caller's ledger
       }
       CBZ.quake.eventTick(dt) -> {amp, pga01, phase, shockFired, env}
       CBZ.quake.eventEnd()      the motion stops; the ground keeps its
                                 cracks and water until reset()
       CBZ.quake.eventReport()   what it did, by building and by car

     The disaster island's round (systems/disasters.js), the city event
     below and the lab kit (src/lab/kits/quake.js) all drive exactly this.
     ============================================================ */
  const ev = {
    on: false, p: null, t: 0, cx: 0, cz: 0, R: 120, soil: null,
    S: [], cars: [], actors: null, owned: [], hooks: {}, lots: false,
    roads: null, roadList: null, onRoad: null, lowGround: null, groundAt: null,
  };
  function eventStart(o) {
    o = o || {};
    if (ev.on) eventEnd();
    clearGround(); clearPieces();
    jobs.length = 0; glassJobs.length = 0;
    ev.cx = o.cx != null ? o.cx : 0; ev.cz = o.cz != null ? o.cz : 0; ev.R = o.R || 120;
    ev.soil = o.soil || null;
    ev.roads = o.roads || null; ev.roadList = null; ev.onRoad = o.onRoad || null;
    ev.lowGround = o.lowGround || null; ev.groundAt = o.groundAt || null;
    ev.hooks = o.hooks || {}; ev.lots = !!o.lots;
    // selfTick: this file's own frame runs the event (a caller with no loop
    // of its own: the lab, a tool); otherwise the caller ticks it
    ev.self = !!o.selfTick; ev.last = null; ev.secs = o.secs || 0;
    ev.actors = typeof o.actors === "function" ? o.actors : (o.actors ? function () { return o.actors; } : null);
    const src = Object.assign({}, o.src || {});
    if (o.epiKm != null) src.epiKm = o.epiKm;
    if (o.depthKm != null) src.depthKm = o.depthKm;
    src.soil = ev.soil || src.soil || soilAt(ev.cx, ev.cz);
    const M = o.M != null ? +o.M : (src.M != null ? src.M : 6.5);
    const p = ev.p = o.params && o.params.M === M ? o.params : magParams(M, src);
    begin(null);
    A.mag = p.M;
    ev.on = true; ev.t = 0;
    motionStart(p, { cx: ev.cx, cz: ev.cz, R: ev.R });
    ev.S = [];
    const list = o.structures || [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t || t.fallen || (t.building && t.demolished)) continue;
      const S = structOf(t, p);
      if (S) ev.S.push(S);
    }
    // the facade-strip cover test reads the same set
    liveStructures = ev.S;
    ev.cars = [];
    const cl = o.cars || [];
    for (let i = 0; i < cl.length; i++) {
      const C = carOf(cl[i]);
      if (!C) continue;
      const pr = p.pgaRock;
      C.k = siteAmp(soilAt(C.x0, C.z0), pr) / siteAmp(p.src.soil, pr);
      ev.cars.push(C);
    }
    ev.owned.length = 0;
    return p;
  }
  function eventTick(dt) {
    if (!ev.on) return { amp: 0, pga01: 0, phase: "quiet", shockFired: 0, env: motion.env };
    ev.t += dt;
    const m = motionTick(dt);
    const E = m.env, p = ev.p;
    for (let i = 0; i < ev.S.length; i++) respond(ev.S[i], dt, E);
    // the ground
    if (!ground.planted && E.s > 0.6) plantCracks();
    if (ground.mesh) {
      const want = Math.min(1, (ground.open || 0) + dt * 0.5 * Math.max(E.s, E.r * 0.5));
      openCracks(want);
    }
    if (p.liq && !ground.liqDone && motion.t > p.sLag + Math.min(p.mainDur * 0.55, 8 / Math.max(0.5, p.f0))) liquefy();
    for (let i = 0; i < ev.cars.length; i++) carTick(ev.cars[i], dt);
    crowdTick(dt, E);
    return m;
  }
  function eventEnd() {
    if (!ev.on) return;
    ev.on = false;
    motionStop();
    crowdRelease();
    carsRestoreOrder();
    liveStructures = null;
  }
  function eventReport() {
    const p = ev.p;
    if (!p) return null;
    const r2 = function (v) { return Math.round(v * 100) / 100; };
    return {
      motion: {
        M: p.M, epiKm: r2(p.src.epiKm), depthKm: r2(p.src.depthKm), hypoKm: r2(p.hypoKm), offshore: p.src.offshore, soil: p.src.soil,
        pgaG: r2(p.pgaG), pgaPeak: r2(A.pgaPeak), mmi: Math.round(p.mmi * 10) / 10, f0: r2(p.f0), sMinusP: r2(p.sLag),
        strongSecs: r2(p.mainDur), realStrongSecs: r2(p.realDur), surfK: r2(p.surfK), liqDemand: r2(p.liqDemand), liquefied: !!A.liquefied,
        aftershocks: motion.shocks.map(function (s) { return s.M; }), aftershocksFired: A.aftershocks,
      },
      buildings: ev.S.map(function (S) {
        return { style: S.style || null, type: S.type, material: S.material, storeys: S.storeys, T: r2(S.T), soil: S.soil,
          pga: r2(S.pga), sa: r2(S.peak), ds: S.ds, dsName: DS_NAME[S.ds], soft: S.soft, u: r2(S.u),
          panes: S.panes, shed: S.shed, holes: S.holes, parapet: S.parapetDown, crown: S.crownDown,
          leanDeg: r2((S.leanRad || 0) * 57.3), settled: S.liq };
      }),
      cars: ev.cars.map(function (C) {
        return { hit: C.hit, crushed: C.crushed, rolled: !!C.rolled, bounceCm: Math.round(C.maxB * 100), rollDeg: r2(C.maxRoll * 57.3), walkedM: r2(C.walked) };
      }),
      ground: { cracks: ground.cracks.length, crackM: Math.round(ground.len), widestCm: Math.round(ground.wmax * 100), boils: ground.boilList.length, mains: A.mains },
      crowd: Object.assign({ evacuated: A.evacuated }, A.crowd),
    };
  }

  /* ============================================================
     THE CITY EVENT (CITY_QUAKE, default OFF).

     The same event over the real lots near the player: the lots' own
     ledger (city/structural.js) hears each damage state through the hook,
     a complete state goes to city/demolition.js, and the aftermath lights
     gas through CBZ.structure and drops real street conductors.
     ============================================================ */
  const city = { on: false, t: 0, dur: 0, after: false };
  function cityStart(o) {
    o = o || {};
    if (!CBZ.CONFIG.CITY_QUAKE) return false;
    if (!inCity()) return false;
    const arena = CBZ.city && (CBZ.city.arena || CBZ.city);
    if (!arena || !arena.lots) return false;
    const P = CBZ.player && CBZ.player.pos;
    const x = o.x != null ? o.x : (P ? P.x : 0), z = o.z != null ? o.z : (P ? P.z : 0);
    const R = o.radius != null ? o.radius : 220;
    const lots = [];
    for (let i = 0; i < arena.lots.length; i++) {
      const L = arena.lots[i];
      if (!L || !L.building || L.demolished) continue;
      if (Math.hypot(L.building.ox - x, L.building.oz - z) > R) continue;
      lots.push(L);
    }
    const cars = (CBZ.cityCars || []).filter(function (c) { return c && c.pos && !c.driver && Math.hypot(c.pos.x - x, c.pos.z - z) < R * 0.6; }).slice(0, PHONE ? 16 : 40);
    // the old event took a 0..1 `mag`; it maps onto the same magnitude scale
    const M = o.M != null ? o.M : (o.mag != null ? 5.4 + 3 * o.mag : 6.9);
    const src = o.src || sourceRoll(M);
    const p = eventStart({
      M: M, src: src, cx: x, cz: z, R: R, structures: lots, lots: true, cars: cars,
      actors: function () { return CBZ.cityPeds; },
      hooks: {
        damage: function (L, ds) {
          if (!CBZ.structure || !CBZ.structure.hit) return;
          const b = L.building;
          try { CBZ.structure.hit(b.ox, 1.5, b.oz, [0, 6, 14, 26, 0][ds] || 0, { kind: "quake", lot: L, sudden: true }); } catch (e) {}
        },
      },
    });
    city.on = true; city.t = 0; city.after = false;
    city.dur = o.secs != null ? o.secs : p.activeSecs;
    if (CBZ.cityEvent) { try { CBZ.cityEvent("quake", { x: x, z: z, mag: M }, { silent: true, noWanted: true }); } catch (e) {} }
    return true;
  }
  function cityStop() { if (city.on) { city.on = false; eventEnd(); } }
  function cityTick(dt) {
    if (!city.on) return;
    city.t += dt;
    const m = eventTick(dt);
    if (CBZ.shake && m.amp > 0.004) CBZ.shake(m.amp);
    if (!city.after && ev.p && motion.t > ev.p.sLag + ev.p.mainDur) { city.after = true; cityAftermath(); }
    if (city.t > city.dur) cityStop();
  }
  function cityAftermath() {
    // gas at the worst-hit lots, and two conductors down
    const ranked = ev.S.filter(function (S) { return S.ds >= 2 && !S.collapsed; }).sort(function (a, b) { return b.ds - a.ds; });
    const n = Math.min(ranked.length, 1 + ((rnd() * 3) | 0));
    for (let i = 0; i < n; i++) gasFire(ranked[i].src, {});
    const census = CBZ.streetPoleCensus ? CBZ.streetPoleCensus() : null;
    if (census && census.poles && census.poles.length && ev.p.mmi >= 7) {
      for (let i = 0; i < 2; i++) {
        const P = census.poles[(rnd() * census.poles.length) | 0];
        if (P) dropLine({ x: P.x, z: P.z });
      }
    }
  }

  /* ============================================================
     LIFECYCLE
     ============================================================ */
  /* begin() is per-EVENT, and it zeroes the per-event counters on purpose:
     CBZ.quakeAudit() should answer "what did THIS quake do", not "what has
     this page done since it loaded". World state (anchors, poles, tables)
     survives, because those belong to the world and not to the event. */
  function begin(structures) {
    if (structures) liveStructures = structures;
    A.debrisSpawned = 0; A.debrisHits = 0; A.debrisKills = 0;
    A.fireKills = 0; A.lineKills = 0;
    A.gasFires = 0; A.gasFiresShared = 0; A.linesDown = 0;
    A.coverSaves = 0; A.ducked = 0;
    A.knockdowns = 0; A.staggers = 0; A.aftershocks = 0; A.pgaPeak = 0;
    A.panesBroken = 0; A.wallHits = 0; A.parapets = 0; A.chimneys = 0; A.softStoreys = 0; A.collapses = 0;
    A.cracks = 0; A.mains = 0; A.boils = 0; A.liquefied = 0; A.settled = 0; A.dustClouds = 0;
    A.carsHit = 0; A.carsCrushed = 0; A.carsRolled = 0; A.evacuated = 0; A.crowd = {};
    A.tickN = 0; A.tickMs = 0; A.tickMsMax = 0; A.jobErrors = 0; A.jobWaits = 0;
    for (const k in jobCost) delete jobCost[k];
  }
  function end() {
    eventEnd();
    liveStructures = null;
    motionStop();
    for (let i = localFires.length - 1; i >= 0; i--) { killFire(localFires[i]); }
    localFires.length = 0;
    clearLines();
  }
  function reset() {
    end(); clearPieces(); clearGround(); clearPoles(); coverReset();
    jobs.length = 0; glassJobs.length = 0;
    dressedArena = null; city.on = false;
    /* THE LAST EVENT'S BUILDINGS GO WITH IT. ev.S outlived the event (the
       report reads it) and every record carried its crown scan: five
       numbers per roof-line triangle of the building's own merged meshes,
       plus the meshes themselves, kept until the NEXT quake started. On the
       disaster island that was ~17 MB of a world the new match had already
       rebuilt (tools/probes/disaster-leak.mjs). */
    for (let i = 0; i < ev.S.length; i++) ev.S[i].crown = null;
    ev.S = []; ev.cars = []; ev.owned.length = 0; ev.actors = null; ev.hooks = {};
  }

  CBZ.onUpdate(27.6, function (dt) {
    if (!CBZ.game || CBZ.game.mode === "escape") return;
    const busy = ev.on || jobs.length + glassJobs.length > 0, t0 = busy ? performance.now() : 0;
    // The arena kit is laid the first frame an island exists, not at quake
    // time — furniture that pops in when the sirens start is a tell.
    if (inSurv() && CBZ.surv && CBZ.surv.arena) dressArena(CBZ.surv.arena);
    else if (inCity()) deriveSeatCovers();
    cityTick(dt);
    if (ev.on && ev.self) {
      ev.last = eventTick(dt);
      if (CBZ.shake && ev.last.amp > 0.004) CBZ.shake(ev.last.amp);
      if (ev.secs && ev.t > ev.secs) eventEnd();
    }
    // the building work the event queued (panes, wall wounds, peels) runs
    // under a per-frame budget so a whole street failing at once is spread
    // over frames instead of landing in one
    if (jobs.length || glassJobs.length) runJobs();
    tickSinks(dt);
    if (ev.on || thrown.length) strikePass(dt);
    tickMains(dt);
    tickBoils(dt);
    tickClouds(dt);
    tickFires(dt);
    tickLines(dt);
    // what the whole earthquake costs this frame (the motion, every
    // building, the queue, the strike pass, the ground, cars and people)
    if (busy) { const ms = performance.now() - t0; A.tickN++; A.tickMs += ms; if (ms > A.tickMsMax) A.tickMsMax = ms; }
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
    reset();
  });

  /* The burst a caller can still ask for by hand (tools, a scripted beat):
     `count` wounds in the facade of one structure at severity `sev`, through
     the building adapter. */
  function shed(t, o) {
    if (CBZ.CONFIG.QUAKE_DEBRIS === false) return 0;
    o = o || {};
    const p = ev.p || magParams(6.5);

    const S = (t && t._qkS) || structOf(t, p);
    if (!S) return 0;
    t._qkS = S;
    const sev = Math.max(0, Math.min(1, o.sev != null ? o.sev : 0.5));
    const n = Math.max(1, o.count != null ? o.count : Math.round(2 + sev * 6));
    for (let i = 0; i < n; i++) {
      const m = faceNormals(S)[(rnd() * 4) | 0];
      if (rnd() < 0.35 && panesOf(S).length) glassTo(S, Math.min(1, (S.paneAt + 1) / Math.max(1, panesOf(S).length)));
      else wallHits(S, m, 1, 0.6 + sev * 0.8, 0.4 + sev, 0.4, 0.95);
    }
    return n;
  }

  CBZ.quake = {
    // the event (the one entry every caller drives)
    eventStart: eventStart, eventTick: eventTick, eventEnd: eventEnd, eventReport: eventReport,
    eventActive: function () { return ev.on; },
    eventSample: function () { return ev.last; },
    // seismology, pure
    magParams: magParams, sourceRoll: sourceRoll, pgaRock: pgaRock, rupDistKm: rupDistKm, siteAmp: siteAmp, mmiOf: mmiOf,
    fragility: function (type) { return TYPES[type] || null; }, TYPES: TYPES,
    // the building adapter (one door to city/collapse.js / demolition)
    damage: BD,
    // a burst by hand
    shed: shed, pieces: function () { const L = liveBodies(); return L ? L.length : thrown.length; },
    // drop, cover, hold on
    cover: cover, coverAdd: coverAdd, coverNear: coverNear, coverReset: coverReset,
    duckUnder: duckUnder, standUp: standUp, underRoof: underRoof,
    // secondary killers
    gasFire: gasFire, dropLine: dropLine, poleNear: poleNear, poleAdd: poleAdd,
    /* WHERE THE SECONDARY HAZARDS ACTUALLY ARE. The same shape
       CBZ.disasters.hazards() publishes ({x, z, r}), each with the OUTWARD
       bearing it faces, so a minimap, an AI or a camera reads one answer. */
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
      for (let i = 0; i < ground.mains.length; i++) {
        const w = ground.mains[i];
        if (w.on) out.push({ kind: "water", x: w.x, z: w.z, r: Math.min(6, 0.2 + w.t * 0.22), nx: 0, nz: 1 });
      }
      return out;
    },
    // the wave train (exposed for tools; the event drives it)
    motionStart: motionStart, motionTick: motionTick, motionStop: motionStop,
    motionState: function () {
      return { on: motion.on, t: motion.t, phase: motion.phase, amp: motion.amp,
        pga01: motion.pgaNow, M: motion.p ? motion.p.M : 0,
        mainDur: motion.p ? motion.p.mainDur : 0, shocksFired: motion.shockFired,
        env: { p: motion.env.p, s: motion.env.s, r: motion.env.r },
        acc: { x: motion.acc.x, y: motion.acc.y, z: motion.acc.z }, disp: { x: motion.disp.x, y: motion.disp.y, z: motion.disp.z } };
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

  /* THE CITY'S ONE-LINE ENTRY POINT. `CBZ.cityQuake({M | mag, secs, x, z})`.
     Nothing in the world calls it yet and CITY_QUAKE is false: dark by
     construction, one line for whichever producer lands first. */
  CBZ.cityQuake = function (o) { return cityStart(o || {}); };

  /* ============================================================
     CBZ.quakeAudit() — THE RATCHET, measured from live state.
       debrisSpawned / panesBroken  the buildings actually shed (a quake
                      that only shakes reads 0 and cannot pass as this)
       debrisHits/Kills  the debris is what kills, not the shake
       coverSaves / ducked  cover worked / people got under it
       gasFires vs gasFiresShared  a second fire model would show here
       softStoreys / parapets / chimneys / collapses  damage BY TYPE happened
       cracks / mains / boils  the ground answered
       carsHit / carsCrushed   the street's cars were in it
       tickMsMean / tickMsMax  what the core costs per frame
     ============================================================ */
  CBZ.quakeAudit = function () {
    const L = liveBodies();
    return {
      debrisSpawned: A.debrisSpawned,
      debrisLive: L ? L.length : thrown.length,
      panesBroken: A.panesBroken,
      wallHits: A.wallHits,
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
      mag: motion.p ? +motion.p.M.toFixed(1) : (A.mag ? +A.mag.toFixed(1) : 0),
      mmi: ev.p ? +ev.p.mmi.toFixed(1) : 0,
      motionPhase: motion.phase,
      motionAmp: +motion.amp.toFixed(3),
      pgaNow: +motion.pgaNow.toFixed(3),
      pgaPeak: +A.pgaPeak.toFixed(3),
      knockdowns: A.knockdowns,
      staggers: A.staggers,
      aftershocksFired: A.aftershocks,
      parapets: A.parapets, chimneys: A.chimneys, softStoreys: A.softStoreys, collapses: A.collapses,
      byState: ev.S.reduce(function (o, S) { o[DS_NAME[S.ds]] = (o[DS_NAME[S.ds]] || 0) + 1; return o; }, {}),
      cracks: A.cracks, mains: A.mains, boils: A.boils, liquefied: A.liquefied, settled: A.settled, dustClouds: A.dustClouds,
      carsHit: A.carsHit, carsCrushed: A.carsCrushed, carsRolled: A.carsRolled,
      evacuated: A.evacuated, crowd: A.crowd,
      tickMsMean: A.tickN ? +(A.tickMs / A.tickN).toFixed(3) : 0, tickMsMax: +A.tickMsMax.toFixed(2),
      jobErrors: A.jobErrors, jobsQueued: jobs.length + glassJobs.length, jobWaits: A.jobWaits,
      jobCost: Object.keys(jobCost).reduce(function (o, k) { const c = jobCost[k]; o[k] = { n: c.n, meanMs: +(c.ms / c.n).toFixed(2), maxMs: +c.max.toFixed(1) }; return o; }, {}),
      cityQuake: !!CBZ.CONFIG.CITY_QUAKE,
      cityActive: city.on,
      mode: CBZ.game ? CBZ.game.mode : null,
    };
  };
})();

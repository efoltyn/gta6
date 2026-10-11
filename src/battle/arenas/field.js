"use strict";
/* src/battle/arenas/field.js — NPC War: THE FIELD. buildMap(id) raises the
   chosen ground (the yard, the erg, the sea, the downtown or a Gang City
   venue) and returns the MAP record the sim stands on: groundAt, bodyY,
   camFloor, the centre, the gap between the armies, terrain sight, and
   spawnAt (out of the geometry, never inside a building).

   This record is the arena half of the battle HOST (battle/core/host.js):
   a Gang City host answers the same questions about the real world.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope. */

/* NOBODY SPAWNS INSIDE A BUILDING. The desert maps could get away without
   this — a dune has nothing in it — but the moment the ground is a real
   downtown, a ranked column drawn on paper puts a third of an army inside
   the Exchange Bank, where nothing can see them and nothing can shoot them.
   A golden-angle spiral, so the search is a spiral and not a ring: the
   first free point is genuinely the nearest one, and it is deterministic. */
const _fs = [];
function blockedAt(x, z) {
  const cols = CBZ.micro.queryColliders(x, z, 0.9, _fs);
  for (let c = 0; c < cols.length; c++) {
    const b = cols[c];
    if (!CBZ.micro.colliderContains(b, x, z, 0.55)) continue;   // exact on a turned box
    if (b.y0 != null && b.y1 != null && (b.y1 < 0.35 || b.y0 > 1.7)) continue;  // a kerb is not a wall
    return true;
  }
  return false;
}
/* AND NOT ON TOP OF EACH OTHER EITHER. The spiral above only ever asked the
   geometry. On an open field that is enough, because the ranked grid never
   puts two men in the same square — but on a DENSE venue (the seat of state
   is walls, planters and steps) many grid points are blocked, several men
   spiral out of their own square and converge on the same first free metre,
   and they start the battle interpenetrating. Measured on `gov`: one
   overlapping pair at t=0, which the sweep counts as a fault and should.
   Claimed points are remembered for the length of one build. */
/* AND THE CLAIM IS THE BODY'S OWN SIZE. A flat 1.15 m is the right answer
   for a man and a fiction for a bull elephant: an army of them spawned
   INSIDE one another and spent the opening seconds of the battle shoving
   itself apart. Each claim carries the radius that took it, so a pair only
   has to clear what the two of them actually occupy. */
/* SPAWN CLAIMS BELONG TO ONE ROSTER. Cleared at buildMap, and again by
   __battle.restage() below — four hundred sardine claims left standing would
   push the next matchup out into open water for no reason anybody could see. */
const _claim = [];
function clearClaims() { _claim.length = 0; }
const CLAIM_R = 0.575;         // a man's half of the old 1.15 m pair
function crowdedAt(x, z, r) {
  for (let i = 0; i < _claim.length; i++) {
    const c = _claim[i];
    const dx = x - c.x, dz = z - c.z, need = r + c.r;
    if (dx * dx + dz * dz < need * need) return true;
  }
  return false;
}
function freeSpot(x, z, r) {
  r = r || CLAIM_R;
  const take = function (px, pz) { _claim.push({ x: px, z: pz, r: r }); return { x: px, z: pz }; };
  if (!blockedAt(x, z) && !crowdedAt(x, z, r)) return take(x, z);
  // the search walks outward in the body's OWN units, so a big animal is
  // not condemned to test forty man-sized rings it can never fit in
  const step = 1.35 * Math.max(1, r / CLAIM_R * 0.72);
  for (let k = 1; k < 40; k++) {
    const a = k * 2.399963229728653, d = k * step;      // golden angle
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    if (!blockedAt(px, pz) && !crowdedAt(px, pz, r)) return take(px, pz);
  }
  return take(x, z);
}

/* SPAWN ON THE STREET, NOT ON A GRID. Given the town's own road records,
   each side forms up in north-south streets on its half and walks in. That
   is one lookup per man and it is the reason an urban fight reads as an
   assault down avenues instead of two blocks of men shuffling through
   masonry.

   AND IT FORMS UP AT THE DECLARED GAP, WHICH IS THE FAULT THIS WAVE FOUND.
   It used to sort the lanes by distance from the centre DESCENDING and take
   the outermost three — so on an eight-block downtown 472 m across, the two
   armies started at opposite edges and `gap` was a number the city map wrote
   down and then ignored. MEASURED, 26 v 26 on `city`: nearest enemy 304 m at
   t=0, first round fired at t=10.9 s, and at t=17 s all 52 men were still in
   slot `march` having managed eleven shots between them. Closure through a
   grid of blocks runs about 5 m/s combined, not the 12 m/s two marching
   columns suggest, so three hundred metres is a full minute of watching
   crowds walk before the war starts. Nobody watches that twice.

   So the lanes are chosen by how near they are to the declared start line
   (cx ± gap/2) instead of by how far out they can possibly be, and the
   number in the table above is finally the number on the ground. */
function streetSpawner(roads, cx, cz, side, gap) {
  const want = cx + side * gap * 0.5;
  const lanes = (roads || []).filter(function (r) {
    return r.vertical && (r.x - cx) * side > 24;
  }).sort(function (a, b) { return Math.abs(a.x - want) - Math.abs(b.x - want); }).slice(0, 3);
  if (!lanes.length) return null;
  return function (i) {
    const L = lanes[i % lanes.length];
    const k = (i / lanes.length) | 0;
    const row = k % 11, rank = (k / 11) | 0;
    const t = (row - 5) * (L.len / 13);
    const off = ((rank % 2) ? 1 : -1) * Math.min(L.w * 0.3, 3.4) + (sWorld() - 0.5) * 1.4;
    const along = ((rank / 2) | 0) * 3.2 * side;         // ranks stack BEHIND
    return { x: L.x + off + along, z: L.z + t + (sWorld() - 0.5) * 1.4 };
  };
}

/* THE KEEP-OUTS: where each side forms up stays open ground, so the ranks
   are not dealt into a hedge or a wood (grid() below: the columns stand
   gap/2 + 8 m out, ten men a column, 3.1 m apart). */
function startClearings(cx, cz, gap) {
  return [
    { x: cx - gap / 2 - 30, z: cz, hx: 34, hz: 24 },
    { x: cx + gap / 2 + 30, z: cz, hx: 34, hz: 24 },
  ];
}
/* THE ERG'S DRESSING, by what the ground is. Banks and drifts go in before
   anything is seated on them; the skin is drawn after, so it shows them.
   In the node sim (tools/npcwar-headless.mjs) the same earthworks and props
   go in as heights, colliders and cover; only the meshes are skipped. */
function ergDress(id, cx, cz, gap, g) {
  const keepOut = startClearings(cx, cz, gap);
  const surface = DUNE.pal.surface;
  const ctx = { id: id, cx: cx, cz: cz, gap: gap, groundAt: g, keepOut: keepOut, seed: 11,
    theme: surface === "sand" ? "desert" : surface === "snow" ? "snow" : surface === "forest" ? "forest" : "field",
    granite: surface !== "sand", tol: surface === "sand" ? 1.6 : 1.2 };
  CBZ.battleDress.begin(ctx);
  try {
    /* FORWARD OUTPOSTS: on the sand and the snow, a bulldozed berm with two
       foxholes behind it, out in front of each side's line and off its axis
       (a position the attackers must take or pass). Not ACROSS the start
       lines: measured, a bank in front of a kneeling line blinds it (its eye
       is under the bank) and the held exchange fell from 30 to 0.7 on the
       fields. Earthworks are ground, so they go in before anything else.
       ?dig=0 leaves them out. */
    if ((surface === "sand" || surface === "snow") && Q.get("dig") !== "0") {
      for (const side of [-1, 1]) {
        const x = cx + side * (gap / 2 - 22), z = cz + (side < 0 ? -40 : 38);
        CBZ.battleGround.berm(x, z - 14, x, z + 14, surface === "sand" ? 1.5 : 1.3, 3.2);
        CBZ.battleGround.pit(x + side * 4, z - 6, 1.1, 1.2);
        CBZ.battleGround.pit(x + side * 4, z + 6, 1.1, 1.2);
      }
    }
    if (surface === "grass") CBZ.battleFields.build(ctx);
    else if (surface === "forest") CBZ.battleWoods.forest(ctx);
    else if (surface === "snow") CBZ.battleWoods.snow(ctx);
    CBZ.battleDress.open(ctx);
  } catch (e) { console.warn("[battle] ground dressing failed:", e); }
}
/* A RAISED VENUE / THE DOWNTOWN: cover where the venue left open ground. */
function venueDress(id, cx, cz, gap, g) {
  if (id === "arena") return;          // the yard is already a yard
  const keepOut = startClearings(cx, cz, gap);
  const blocked = function (x, z, r) {
    if (blockedAt(x, z)) return true;
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2;
      if (blockedAt(x + Math.cos(a) * r * 0.8, z + Math.sin(a) * r * 0.8)) return true;
    }
    return false;
  };
  const ctx = { id: id, cx: cx, cz: cz, gap: gap, groundAt: g, keepOut: keepOut, blocked: blocked, seed: 5, theme: "apron", tol: 0.5 };
  CBZ.battleDress.begin(ctx);
  try {
    if (id === "city" && town && town.roads) { ctx.roads = town.roads; ctx.reach = gap * 0.5 + 110; CBZ.battleDress.city(ctx); }
    else {
      /* the cover WE add to a venue goes in turned pairs about the start
         lines' centre (erg.js FOLD), each pair only where both spots are
         free; the venue's own walls are the real place and stay as built */
      FOLD.cx = cx; FOLD.cz = cz; FOLD.src = -1; FOLD.on = true;
      try { CBZ.battleDress.open(ctx); } finally { FOLD.on = false; }
    }
  } catch (e) { console.warn("[battle] venue dressing failed:", e); }
}

let MEASURED = null;        // what the heightfield found, for the audit
function buildMap(id) {
  /* THE START LINE, and every one of these is a distance a man has to WALK
     before anything happens. The open maps can be wide because a firing line
     across sand is a sightline: dunes at 150 m resolved in 32 s and the kill
     box at 120 m in 51 s, both measured. A city cannot, because a block is
     not a sightline — `city` used to read 300 here and the two armies spent
     the first forty seconds marching (see streetSpawner), so it is a
     three-block approach now that still has to be fought through. */
  const M = MAPS[id] || MAPS.arena;
  _claim.length = 0;          // spawn claims belong to ONE build
  FOLD.ground = false; FOLD.on = false;   // only the erg folds (below)
  /* ...and OPEN WATER is the shortest of them, measured the same way the
     others were. Water has no cover, no walls to path around and no crest to
     climb: closure there is a straight line at the animals' own charge speed
     (an orca's works out at 6.7 m/s, so 110 m of no-man's land is ~8 s of
     swimming before contact) and there is nothing to look at on the way. */
  let gap = { city: 170, island: 175, field: 180, dunes: 150, arena: 120, water: 110 }[id] || 150;
  let gapOverride = 0;      // measured venues size their own no-man's land
  let groundAt = function () { return 0; };
  let cx = 0, cz = 0, spawners = null;

  if (id === "arena") {
    // a walled container yard, 210 x 150 m inside the block wall (THE YARD above)
    buildYard(210, 150, gap);
  } else if (id === "water") {
    /* OPEN WATER. No world() call, no raise(), no town(): a swell function,
       a seabed, a reef, and whatever fleet the roster earns. This branch is
       the map's cost, and it is deliberately the shortest one in the file. */
    SEA.on = true; SEA.t = 0; SEA.boats.length = 0; SEA.under = null; SEA.fogSurface = null;
    /* the fourth shim, same pattern as queryCollidersNear/floorAt/collide up
       top: creature_combat's restY() resolves an aquatic body to
       CBZ.citySeaHeightAt(x,z) minus its own swimDepth, so without these two
       names the shared strike driver would rest a shark at CBZ.SEA_Y and
       fight this page's own depth every frame. Route the name, never fork
       the file. (stepDepth keeps actor.swimDepth in step with actor.swimD.) */
    CBZ.citySeaHeightAt = function (x, z) { return swellAt(x, z); };
    cx = 0; cz = 0;
    seaBuildSwell();
    // the bed first, so the surface blends over something and not over sky
    seabed(SEA.seabed);
    seaSurface(cx, cz);
    if (Q.get("reef") !== "0") seaReef(cx, cz);
    groundAt = function (x, z) { return swellAt(x, z); };
    // a side of MEN is a side that came off boats — see seaFleet
    if (Q.get("fleet") !== "0") {
      if (SET.redU === "men") seaFleet(cx, cz, -1, Math.max(1, Math.min(9, Math.ceil(SET.redN / 8))));
      if (SET.blueU === "men") seaFleet(cx, cz, 1, Math.max(1, Math.min(9, Math.ceil(SET.blueN / 8))));
    }
    /* AND A SHOAL IS NOT A COLUMN. The ranked grid below is right for men
       walking up a street and wrong for four hundred sardines: water has no
       ranks, so each side forms a golden-angle disc around its own start
       point, sized by how many of it there are. Deterministic (sWorld), and
       it feeds the same freeSpot() claim pass everything else uses. */
    spawners = (function () {
      const mk = function (side, n) {
        const r = Math.max(9, Math.sqrt(Math.max(1, n)) * 3.4);
        return function (i) {
          const a = i * 2.399963229728653;
          const d = Math.sqrt((i + 0.5) / Math.max(1, n)) * r;
          return { x: cx + side * gap * 0.5 + Math.cos(a) * d + (sWorld() - 0.5) * 2,
                   z: cz + Math.sin(a) * d * 1.35 + (sWorld() - 0.5) * 2 };
        };
      };
      return { red: mk(-1, SET.redN), blue: mk(1, SET.blueN) };
    })();
  } else if (M.erg) {
    DUNE.pal = ERG_PAL[M.erg] || ERG_PAL.sand;
    world = CBZ.studio.world("desert", { seed: "npcwar" });
    groundAt = (world && world.heightAt) || groundAt;
    /* WALK OUT UNTIL THE GROUND MEASURES AS DUNES. The old centre was a
       constant — rings.city + 650 — and nothing ever asked what the ground
       there looked like. Measured: 7.6 m of relief across the whole field,
       because the dune amplitude ramps up with radius and r=1700 is barely a
       third of the way up the ramp. A map called OPEN DUNES was a flat plate
       with the word "dunes" on the menu row.

       So the venue scans the erg and takes the FIRST centre that passes TWO
       measurements: the battlefield window (±160 m) holds at least 16 m of
       relief, and the dunes STAND BETWEEN the armies — at least two of the
       three central spawn lanes are crest-cut at eye height. Relief alone
       is not enough (measured: the best on-axis window put all of its sand
       on the flanks and the two firing lines still saw each other spawn to
       spawn), and the scan is two-dimensional because the erg is a ring,
       not a bearing — on the shipped terrain the qualifying ground lies off
       the old axis entirely. The terrain derives from WORLD_SEED alone, so
       the same URL lands the same war on the same sand. The fallback is the
       old constant, so a retuned noise field can never strand the map with
       no centre at all. The window found here is then TURNED (below), so
       neither side is dealt the better ground. */
    const rings = (world && world.rings) || { city: 1050, dune: 2700 };
    cx = rings.city + 650; cz = 0;
    scan:
    for (let x = rings.city + 550; x <= rings.dune - 250; x += 50) {
      for (let z = -450; z <= 450; z += 50) {
        if (Math.hypot(x, z) + 170 > rings.dune - 60) continue;
        let lo = 1e9, hi = -1e9;
        for (let sx = -160; sx <= 160; sx += 16) for (let sz = -160; sz <= 160; sz += 16) {
          const y = groundAt(x + sx, z + sz);
          if (y < lo) lo = y; if (y > hi) hi = y;
        }
        if (hi - lo < 16) continue;
        let cut = 0;
        for (let li = -1; li <= 1; li++) {
          const lz = z + li * 12, ax = x - 83, bx = x + 83;
          if (terrainBlocked(ax, groundAt(ax, lz) + 1.52, lz,
                             bx, groundAt(bx, lz) + 1.35, lz, groundAt)) cut++;
        }
        if (cut >= 2) { cx = x; cz = z; break scan; }
      }
    }
    // THE ERG over the chosen window: crests, slip faces, the skin that shows them
    DUNE.on = true; DUNE.cx = cx; DUNE.cz = cz; DUNE.phase = 0;
    /* A FAIR FIELD: THE ERG IS TURNED ABOUT ITS CENTRE (erg.js FOLD).
       The old fix here slid the crest train along the wind until the two
       start lines stood at nearly the same height. It could not work: the
       world's own ground under the window is a slope (red stood 7.2 m over
       blue on the dunes, 7.1 on the fields), a dune is not the same ground
       from its stoss as from its slip face, and the woods, hedges and rocks
       were scattered by hash. Now the far half is the kept half turned 180
       degrees, so the two lines stand on the same ground, behind the same
       crests and cover, with the same sight lines, by construction.

       Which half, and where the crest train sits, is still measured (and
       fixed by WORLD_SEED, so the same URL is the same war): for each half
       and each of twelve phases of the train, the two lines must be hidden
       from each other at the start (a rifleman's eye and a hull's: the
       dunes stand BETWEEN the armies), the ground between them must be ONE
       crossing (walking out from his line, a man first has the far line in
       his sights near the middle, from the crest of no-man's land), and no
       line may stand on a slope steep enough to make a rank a ladder.
       Measured, 60 pro attacking 25 holding: with each line's own crest 36 m
       in front of it (the attackers top it and shoot DOWN into the holders)
       holding traded 0.12-0.19 against 0.19-0.35 for meeting them; with the
       crossing in the middle it trades as well or better. A layout where a
       tank's eye never clears the ground (no crossing at all) left a lone
       Abrams and thirty riflemen staring at a dune for five minutes. */
    const worldGround = groundAt;
    const ergRaw = function (x, z) { return worldGround(x, z) + duneDetail(x, z); };
    FOLD.cx = cx; FOLD.cz = cz; FOLD.ground = true; FOLD.on = false;
    const ergGround = function (x, z) {
      const a = foldA((x - cx) * FOLD.src);
      const tx = 2 * cx - x, tz = 2 * cz - z;
      // out past R0 the turned ground fades back into the world's own (the
      // window's edge is the world's); duneWeight is square about the centre
      const w = duneWeight(x, z);
      if (a >= 1 || w <= 0) return ergRaw(x, z);
      if (a <= 0 && w >= 1) return ergRaw(tx, tz);
      // both halves, the dominant one sampled LAST (the dunes' anatomy, DS,
      // is what the skin colours by)
      const k = a + (1 - a) * (1 - w);                   // the share of (x, z) itself
      if (k >= 0.5) { const q = ergRaw(tx, tz), p = ergRaw(x, z); return k * p + (1 - k) * q; }
      const p = ergRaw(x, z), q = ergRaw(tx, tz);
      return k * p + (1 - k) * q;
    };
    (function choose() {
      const roll = DUNE.pal.form === "roll";
      const slope = function (side) {
        const x = cx + side * (gap / 2 + 12);
        let m = 0;
        for (let z = -15; z <= 15; z += 7.5) {
          const a = ergGround(x - 6, cz + z), b = ergGround(x + 6, cz + z), c = ergGround(x, cz + z - 6), d = ergGround(x, cz + z + 6);
          m = Math.max(m, Math.hypot(b - a, d - c) / 12);
        }
        return m;
      };
      let best = { s: 1e9, src: -1, ph: 0 };
      for (const src of [-1, 1]) {
        FOLD.src = src;
        for (let k = 0; k < (roll ? 1 : 12); k++) {
          DUNE.phase = roll ? 0 : k * DUNE.lam / 12;
          // the lines hidden from each other at spawn, a rifleman's eye and a
          // hull's alike: lanes (of 3 x 3) the far line is seen down
          let seen = 0;
          for (let la = -1; la <= 1; la++) for (let lb = -1; lb <= 1; lb++) {
            const ax = cx - gap / 2 - 8, bx = cx + gap / 2 + 8, az = cz + la * 12, bz = cz + lb * 12;
            if (!terrainBlocked(ax, ergGround(ax, az) + 2.6, az, bx, ergGround(bx, bz) + 1.4, bz, ergGround)) seen++;
          }
          // ...and one crossing between them: walking out from his line, how
          // far a man goes before the far line is in his sights (the crest)
          let walk = -1;
          for (let d = 0; d <= gap / 2 + 20 && walk < 0; d += 4) {
            let v = 0;
            for (let li = -1; li <= 1; li++) {
              const ax = cx - gap / 2 - 8 + d, bx = cx + gap / 2 + 8, lz = cz + li * 10;
              if (!terrainBlocked(ax, ergGround(ax, lz) + 1.6, lz, bx, ergGround(bx, lz) + 1.4, lz, ergGround)) v++;
            }
            if (v >= 2) walk = d;
          }
          const sl = slope(-1);
          const sc = seen * 2 + (walk < 0 ? 12 : Math.abs(walk - (gap / 2 - 8)) / 8) + Math.max(0, sl - 0.3) * 20;
          if (sc < best.s) best = { s: sc, src: src, ph: DUNE.phase };
        }
      }
      FOLD.src = best.src; DUNE.phase = best.ph;
    })();
    // ...and the ground REMEMBERS: berms, banks, drifts and the craters to
    // come are part of the height every man stands on (arenas/ground.js)
    groundAt = CBZ.battleGround.begin({ id: id, surface: DUNE.pal.surface, soft: true, groundAt: ergGround });
    MAP_GROUND = groundAt;
    // the dressing lands in turned pairs on the erg; battle-time
    // placements (a felled tree's log) land where they fall
    FOLD.on = FOLD.ground;
    try { ergDress(id, cx, cz, gap, groundAt); } finally { FOLD.on = false; }
    ergSkin(world);
  } else if (id === "city") {
    // THE REAL FABRIC. Eight blocks square is 490 m of street — big enough
    // that an army has to cross ground it does not own, small enough that
    // the two sides find each other without a search party.
    cx = TOWN_AT.x; cz = TOWN_AT.z;
    town = CBZ.studio.town({
      at: TOWN_AT, seed: "npcwar-" + (Q.get("seed") || "talloran"), name: "Talloran",
      cols: 8, rows: 8, blockW: 44, blockD: 44, roadW: 15,
      // the studio's default downtown palette is authored for the mainland's
      // own light. Under this map's sun the sidewalks and the square came
      // out as paper — a white field with a road painted on it — so the
      // stone comes down to something a camera can still see men against.
      palette: {
        ground: 0x5f636a, sidewalk: 0x6d7278, road: 0x2b2e34,
        plaza: 0x6f747b, wood: 0x4c545d, accent: 0x616a75,
      },
    });
    if (town && town.rect) {
      // a WIDE apron and no water: the downtown is inland, and the sea plate
      // this map used to carry was the thing fighting the road for the depth
      // buffer. Ground that runs out to the fog is the honest answer here.
      apron(town.rect.minX - 900, town.rect.maxX + 900, town.rect.minZ - 900, town.rect.maxZ + 900, 0x555a61);
      spawners = {
        red: streetSpawner(town.roads, cx, cz, -1, gap),
        blue: streetSpawner(town.roads, cx, cz, 1, gap),
      };
    }
  } else if (M.raise) {
    /* A REAL GANG CITY VENUE, MEASURED RATHER THAN DECLARED.

       Every raised venue took the same three hand-written constants before
       this: a centre, an apron rectangle and a flat groundAt. All three were
       guesses that nothing checked, and all three are readable from the
       geometry once it exists. Raise into our OWN group so the heightfield
       casts against the venue and not the skybox, then ask it where it is
       and how high it stands. A venue that is flat measures flat; the
       speedway's banking measures as banking, for free. */
    if (M.sea) seaPlate();
    const venue = new THREE.Group();
    CBZ.scene.add(venue);
    for (let i = 0; i < M.raise.length; i++) {
      const got = CBZ.studio.raise(M.raise[i], { parent: venue });
      if (!base) base = got;
      if (!got) console.error("[battle] nothing raised for pack:", M.raise[i]);
    }
    const H = CBZ.studio.heightfield(venue, { step: 6, pad: 30 });
    if (H) {
      groundAt = H.heightAt;
      cx = H.cx; cz = H.cz;
      // ground out to the fog under the venue's own floor, so its edge is a
      // quay and not the inside of the sky dome
      apron(H.box.min.x - 420, H.box.max.x + 420, H.box.min.z - 420, H.box.max.z + 420,
            M.apronColor || 0x7d7a6c, H.minY);
      // the armies start half the venue apart, clamped to a distance two
      // sides can actually cross before the watcher loses interest
      // ...and 320 m is not that distance. MEASURED on `city` at 304 m: the
      // first round went off at t=10.9 s, forty-five of fifty-two men were
      // still in slot `march` at t=13, and the two sides were not inside
      // 100 m of each other until t=41. Closure through real geometry runs
      // about 5 m/s combined, not the 12 m/s two marching columns suggest,
      // so the old ceiling was a full minute of watching crowds walk. 190 is
      // where the fixed maps measure (Halloran 6.5 s to first contact,
      // island 7.1) and it still leaves a venue-length approach to fight.
      gapOverride = Math.max(90, Math.min(190, Math.min(H.spanX, H.spanZ) * 0.5));
      MEASURED = { cols: H.cols, rows: H.rows, step: +H.step.toFixed(1), miss: H.miss,
                   minY: +H.minY.toFixed(2), maxY: +H.maxY.toFixed(2),
                   spanX: Math.round(H.spanX), spanZ: Math.round(H.spanZ) };
    } else {
      console.error("[battle] heightfield measured nothing for", id, "— falling back to flat");
    }
  }

  if (gapOverride) gap = gapOverride;
  /* EVERY OTHER GROUND (the yard, the downtown, a raised venue) is hard:
     a blast scorches it and breaks what stands on it, it does not dig. The
     dressing goes where the venue left open ground. */
  if (id !== "water" && !M.erg) {
    groundAt = CBZ.battleGround.begin({ id: id, surface: "concrete", soft: false, groundAt: groundAt });
    venueDress(id, cx, cz, gap, groundAt);
  }
  /* HOW MUCH GROUND IS THERE IN THIS GROUND? One number, measured off the
     same groundAt the men will stand on, over the same window they will
     fight in — so the audit can state it and the checker can hold the map
     named OPEN DUNES to actually having dunes. */
  let relief = 0;
  (function () {
    const span = gap * 0.5 + 120;
    let lo = 1e9, hi = -1e9;
    for (let sx = -span; sx <= span; sx += 12) for (let sz = -span; sz <= span; sz += 12) {
      const y = groundAt(cx + sx, cz + sz);
      if (y < lo) lo = y; if (y > hi) hi = y;
    }
    relief = Math.round((hi - lo) * 10) / 10;
  })();
  const grid = function (team, i) {
    const side = team === "red" ? -1 : 1;
    const col = (i / 10) | 0, row = i % 10;
    const x = cx + side * (gap / 2 + 8 + col * 3.1) + (sWorld() - 0.5) * 1.8;
    /* THE RANKS TURN WITH THE SIDE. Man i of blue stands where man i of red
       stands, turned 180 degrees through the centre, the way the ground is
       (erg.js FOLD): row 0 (the first man, the squad's leader) is on each
       side's own LEFT, not at the same world z for both. With one z for
       both, red's leader formed up on red's left and blue's on blue's
       right, and squads that steer off their leader fought different
       ground on a field that was otherwise the same. */
    const z = cz - side * ((row - 4.5) * 3.4 + (col % 2) * 1.7) + (sWorld() - 0.5) * 1.8;
    return { x: x, z: z };
  };
  /* WHERE A BODY ACTUALLY SITS, which on every other map is the ground and
     on OPEN WATER is not. groundAt answers "where is the surface" — the
     camera, the rockets, the bombers and the director all still want that —
     and bodyY answers "where is THIS body", which is the surface minus its
     own swim depth. Two questions that used to be one because on land they
     always had the same answer. */
  const water = id === "water";
  const bodyY = water
    ? function (m, x, z) { return swellAt(x, z) - (m && m.swimD != null ? m.swimD : cruiseDepth(m)); }
    : function (m, x, z) { return groundAt(x, z); };
  /* AND HOW LOW THE CAMERA MAY GO. Everywhere else the lens stops 1.6 m over
     the ground because the ground is opaque. Here the whole point is that you
     can put the lens UNDER the swell and watch a shark come at it, so the
     floor is the seabed instead — the sea is not a wall. */
  const camFloor = (water && !SWIM_OLD)
    ? function () { return SEA.seabed + 2.2; }
    : function (x, z) { return groundAt(x, z) + 1.6; };
  /* THE COVER, ALL OF IT: the props' points are in; add every wall the
     venue registered and every place the ground itself hides a man. */
  if (id !== "water") {
    const C = CBZ.battleCover;
    C.fromColliders(cx, cz, gap * 0.5 + 160);
    if (M.erg) C.scanGround(cx, cz, gap * 0.5 + 60, 150, 6, { min: 0.95, kind: DUNE.pal.form === "dune" ? "crest" : DUNE.pal.form === "drift" ? "drift" : "fold" });
    CBZ.battleDress.flush();
    CBZ.battleGround.arm();
    // sand off the crests, spindrift off the drifts
    if (M.erg && DUNE.pal.form !== "roll") {
      const crests = duneCrests(cx, cz, 330, 330, 7);
      const snowy = DUNE.pal.form === "drift";
      CBZ.battleGround.blowing(crests, { wx: DUNE.wx, wz: DUNE.wz, per: snowy ? 10 : 8, travel: snowy ? 12 : 8,
        color: snowy ? [0.95, 0.97, 1.0] : [0.86, 0.7, 0.48], size: snowy ? 0.06 : 0.045, spread: 5,
        fold: FOLD.ground ? { cx: FOLD.cx, src: FOLD.src } : null });     // the far half's wind is reversed
    }
  }
  return {
    id: id, gap: gap, cx: cx, cz: cz, groundAt: groundAt, relief: relief,
    // THE COVER the battle core may ask for (battle/core/host.js): points
    // that hide a man from a threat, props, walls, crests, crater lips
    coverNear: CBZ.battleCover.near, coverFrom: CBZ.battleCover.from,
    water: water, bodyY: bodyY, camFloor: camFloor,
    /* TERRAIN JOINS THE SIGHT LINE — but only where groundAt is genuinely
       TERRAIN. The dunes map's height function is the desert's own analytic
       surface, so a sample along the eye line is sand and nothing else. A
       RAISED venue's groundAt is a raycast heightfield, and a raycast from
       above cannot tell a roof from a hill — arming terrain sight there
       would wall off every lane that passes beside a building the grid
       touched. The buildings already block sight the honest way, through
       their own colliders. So: dunes only, until a map's ground is measured
       by something that knows the difference. */
    terrainTrue: !!M.erg,
    terrainLos: !!M.erg && relief > 6 && Q.get("tlos") !== "0",
    // team spawn: down the streets where there are streets, ranked columns
    // where there are not, and in both cases OUT of the geometry
    spawnAt: function (team, i, r) {
      const s = spawners && spawners[team];
      const p = (s && s(i)) || grid(team, i);
      return freeSpot(p.x, p.z, r);
    },
  };
}

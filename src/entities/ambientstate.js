/* ============================================================
   entities/ambientstate.js - compact ambient population store.

   Full NPC rigs are scarce render slots. Ambient inhabitants are numeric rows
   in typed arrays. Hidden movement is an analytical route segment and costs
   nothing per frame: position is materialized only when a query needs it.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const total = Math.max(0, CBZ.MASS_CROWD | 0);
  const rigCapacity = Math.max(0, Math.min(total, (CBZ.CROWD_RIG_CAP || 1600) | 0));
  const canShare = !!(self.crossOriginIsolated && typeof SharedArrayBuffer !== "undefined");
  const ZONES = [
    { x0: -27, x1: 27, z0: 5,  z1: 49 },
    { x0: -18, x1: 18, z0: 56, z1: 78 },
    { x0: -18, x1: 18, z0: 82, z1: 123 },
  ];
  const WORLD = CBZ.WORLD, DENSITY_CELL_SIZE = 8;
  const DENSITY_W = Math.ceil((WORLD.maxX - WORLD.minX) / DENSITY_CELL_SIZE);
  const DENSITY_H = Math.ceil((WORLD.maxZ - WORLD.minZ) / DENSITY_CELL_SIZE);
  // a real human range — pale/white → tan → light brown → medium → dark brown.
  // (The "black faces" were a render bug, not the palette; this just adds spread.)
  const SKIN = [
    0xffe0c4, 0xf6cdaa, 0xf0c39a,   // pale / white
    0xe6b98e, 0xd8a177, 0xc99a6a,   // tan / light brown
    0xb5825a, 0xa8744a, 0x8a5a3a,   // medium brown
    0x6f4a30, 0x573b26,             // dark brown
  ];
  const HAIR = [0x2a2018, 0x4a3526, 0x101820, 0xb9b1a6, 0x7a4a2e, 0x222222, 0xdedede, 0x3a1f12];

  // ---- per-agent INVENTORY: every inmate persistently carries something, and
  //      a greedy few wear a VISIBLE valuable you can spot across the yard and
  //      go take. item id 0 = nothing. Names map to the real economy.js ITEMS so
  //      looting a promoted agent grants exactly what you saw. ----
  const ITEM_NAMES = [null, "Gold Chain", "Luxury Watch", "Gold Tooth", "Cash Roll", "Shiv", "Brass Knuckles", "Pruno Hooch", "Lighter", "Stolen Wallet"];
  const ITEM_VISIBLE = { 1: 0xffd451, 2: 0xd6dde8, 3: 0xffe27a, 4: 0x57c264 }; // chain=gold watch=silver tooth=gold cash=green
  // ---- generated NAMES so a spotted inmate has a stable identity to remember ----
  const FIRST = ["Vince", "Mack", "Tank", "Slim", "Rico", "Bones", "Duke", "Cole", "Knox", "Ray",
    "Gus", "Moe", "Dex", "Hank", "Lou", "Sal", "Tre", "Cyrus", "Web", "Jet",
    "Boon", "Cash", "Gunner", "Hex", "Ozzy", "Pike", "Roscoe", "Snake", "Vic", "Wolf"];
  const LAST = ["the Knife", "Two-Time", "Knuckles", "the Wall", "Switchblade", "Sr.", "the Rat", "Goldtooth",
    "the Ghost", "Sticks", "the Bull", "Lefty", "the Snake", "Iron", "the Greek", "Dimes", "the Saint", "Razor"];

  function array(Type, length, shared) {
    if (shared && canShare) return new Type(new SharedArrayBuffer(Type.BYTES_PER_ELEMENT * length));
    return new Type(length);
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  const S = {
    total, rigCapacity, shared: canShare, zones: ZONES,
    // Materialized location. Hidden rows may be stale until materialize().
    posX: array(Float32Array, total, true), posZ: array(Float32Array, total, true),
    prevX: array(Float32Array, total), prevZ: array(Float32Array, total),
    velX: array(Float32Array, total), velZ: array(Float32Array, total),
    heading: array(Float32Array, total), phase: array(Float32Array, total),
    speed: array(Float32Array, total), brainT: array(Float32Array, total),
    panic: array(Float32Array, total), avoidX: array(Float32Array, total), avoidZ: array(Float32Array, total),
    goalX: array(Float32Array, total), goalZ: array(Float32Array, total),
    routeX0: array(Float32Array, total, true), routeZ0: array(Float32Array, total, true),
    routeX1: array(Float32Array, total, true), routeZ1: array(Float32Array, total, true),
    routeStart: array(Float64Array, total, true), routeArrival: array(Float64Array, total, true),
    routeNextZone: array(Uint8Array, total, true),
    zone: array(Uint8Array, total, true), role: array(Uint8Array, total, true),
    faction: array(Int8Array, total, true), nerve: array(Uint8Array, total, true),
    empathy: array(Uint8Array, total, true), greed: array(Uint8Array, total, true),
    mood: array(Uint8Array, total, true), facts: array(Uint32Array, total, true),
    // One compact contact-reaction spectrum, independent from inventory and
    // combat ratings. Grudges persist when an agent demotes back to math-only.
    reactivity: array(Uint8Array, total, true), grudge: array(Uint8Array, total, true),
    downT: array(Float32Array, total), contactCD: array(Float32Array, total),
    item: array(Uint8Array, total, true), cigs: array(Uint8Array, total, true),
    dead: array(Uint8Array, total, true),   // 1 = killed by the player; removed from the live crowd
    // Explicit close-crowd activity. Movement used to be inferred solely from
    // a changing goal, which made the jail read as one perpetual random run.
    // These compact rows let the renderer/sim agree on what a person is doing:
    // 0 walk, 1 stand, 2 socialize, 3 action/workout, 4 fight, 5 flee.
    activity: array(Uint8Array, total, true),
    activityT: array(Float32Array, total),
    activityHeading: array(Float32Array, total),
    partner: array(Int32Array, total),
    strikeT: array(Float32Array, total),
    // NPC_SCHEDULES night lockdown: 1 = "in their cell" — frozen at a per-id
    // bunk spot inside the cell block, skipped by selection/sim (still a dot
    // on the overview map, so the cells READ full at night). Not dead; dawn
    // unparks them back into the yard, staggered — total count never changes.
    parked: array(Uint8Array, total, true),
    skin: array(Uint32Array, total), hair: array(Uint32Array, total),
    // WOMEN IN THE CROWD (W3): per-agent female flag, rolled ~48% off the SAME
    // deterministic per-agent xorshift stream (rnd(id)) as skin/hair below —
    // never Math.random, so a materialized agent's silhouette is stable across
    // demote/promote/save-load like every other rolled trait here. Read by
    // entities/crowd.js's renderRigs() to vary the instanced put() scale args.
    fem: array(Uint8Array, total),
    rng: array(Uint32Array, total), explicit: array(Uint8Array, total),
    densityCellSize: DENSITY_CELL_SIZE, densityWidth: DENSITY_W, densityHeight: DENSITY_H,
    densityCell: array(Uint16Array, total),
    densityPopulation: array(Uint32Array, DENSITY_W * DENSITY_H),
    densityFaction: array(Int32Array, DENSITY_W * DENSITY_H),
    sharedPositionBuffers: canShare ? [
      array(Float32Array, total * 2, true),
      array(Float32Array, total * 2, true),
    ] : null,
    sharedPositionMeta: canShare ? array(Int32Array, 2, true) : null,
  };

  // inventory: a few cigs always, plus a greed-weighted chance of a real item.
  // The greedy/high-roller minority wear a VISIBLE valuable worth crossing the
  // yard for; everyone else carries shivs/booze/wallet flavour.
  function rollInventory(id) {
    S.cigs[id] = 1 + ((rnd(id) * 6) | 0);
    const roll = rnd(id), gw = S.greed[id] / 100;
    S.item[id] =
      roll < 0.030 + gw * 0.04 ? 1 :          // Gold Chain (the trophy)
      roll < 0.060 + gw * 0.03 ? 2 :          // Luxury Watch
      roll < 0.090 ? 3 :                      // Gold Tooth
      roll < 0.150 + gw * 0.05 ? 4 :          // Cash Roll
      roll < 0.300 ? 5 :                      // Shiv
      roll < 0.360 ? 6 :                      // Brass Knuckles
      roll < 0.520 ? (rnd(id) < 0.5 ? 7 : 8) : // Pruno / Lighter
      roll < 0.600 ? 9 : 0;                   // Stolen Wallet / nothing
  }

  function rnd(id) {
    let x = S.rng[id] || ((0x9e3779b9 ^ (id * 2654435761)) >>> 0);
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    S.rng[id] = x >>> 0;
    return (x >>> 0) / 4294967296;
  }
  function densityCellOf(x, z) {
    const cx = Math.max(0, Math.min(DENSITY_W - 1, Math.floor((x - WORLD.minX) / DENSITY_CELL_SIZE)));
    const cz = Math.max(0, Math.min(DENSITY_H - 1, Math.floor((z - WORLD.minZ) / DENSITY_CELL_SIZE)));
    return cz * DENSITY_W + cx;
  }
  function updateDensityCell(id) {
    const cell = densityCellOf(S.posX[id], S.posZ[id]), encoded = cell + 1, old = S.densityCell[id];
    if (old === encoded) return;
    if (old) { S.densityPopulation[old - 1]--; S.densityFaction[old - 1] -= S.faction[id]; }
    S.densityCell[id] = encoded;
    S.densityPopulation[cell]++; S.densityFaction[cell] += S.faction[id];
  }

  function pointClear(x, z, pad) {
    const cols = CBZ.colliders;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) return false;
    }
    return true;
  }

  function randomPoint(id, zoneId, out) {
    const z = ZONES[zoneId];
    for (let i = 0; i < 10; i++) {
      const x = z.x0 + rnd(id) * (z.x1 - z.x0);
      const zz = z.z0 + rnd(id) * (z.z1 - z.z0);
      if (pointClear(x, zz, 0.52)) { out.x = x; out.z = zz; return out; }
    }
    out.x = (z.x0 + z.x1) * 0.5; out.z = (z.z0 + z.z1) * 0.5;
    return out;
  }

  const point = { x: 0, z: 0 };
  function portalPoint(from, to, out) {
    out.x = 0;
    if (from === 0 && to === 1) out.z = 51;
    else if (from === 1 && to === 0) out.z = 53;
    else if (from === 1 && to === 2) out.z = 80;
    else if (from === 2 && to === 1) out.z = 80;
    else out.z = (ZONES[from].z0 + ZONES[from].z1) * 0.5;
    return out;
  }
  function planRoute(id, now, x, z) {
    const zone = S.zone[id];
    let nextZone = zone;
    // Hidden movement is portal-to-portal. Only the current segment matters;
    // intermediate invisible footsteps are never integrated frame by frame.
    if (rnd(id) < 0.11) {
      if (zone === 0) nextZone = 1;
      else if (zone === 2) nextZone = 1;
      else nextZone = rnd(id) < 0.5 ? 0 : 2;
    }
    if (nextZone === zone) randomPoint(id, zone, point);
    else portalPoint(zone, nextZone, point);
    const dx = point.x - x, dz = point.z - z;
    const travel = Math.max(0.75, Math.sqrt(dx * dx + dz * dz) / Math.max(0.25, S.speed[id]));
    S.routeX0[id] = x; S.routeZ0[id] = z;
    S.routeX1[id] = point.x; S.routeZ1[id] = point.z;
    S.routeNextZone[id] = nextZone;
    S.routeStart[id] = now; S.routeArrival[id] = now + travel;
  }

  function materialize(id, now) {
    if (S.parked[id]) return;          // in their cell — frozen at the bunk spot
    if (S.explicit[id]) return;
    let arrival = S.routeArrival[id];
    let loops = 0;
    // Resolve a few completed routes exactly. After a very large time skip,
    // invisible intermediate footsteps are deliberately regenerated lazily.
    while (arrival <= now && loops++ < 3) {
      const x = S.routeX1[id], z = S.routeZ1[id];
      S.zone[id] = S.routeNextZone[id];
      planRoute(id, arrival, x, z);
      arrival = S.routeArrival[id];
    }
    if (arrival <= now) {
      randomPoint(id, S.zone[id], point);
      S.posX[id] = point.x; S.posZ[id] = point.z;
      updateDensityCell(id);
      planRoute(id, now, point.x, point.z);
      return;
    }
    const span = Math.max(0.001, arrival - S.routeStart[id]);
    const t = clamp((now - S.routeStart[id]) / span, 0, 1);
    S.posX[id] = S.routeX0[id] + (S.routeX1[id] - S.routeX0[id]) * t;
    S.posZ[id] = S.routeZ0[id] + (S.routeZ1[id] - S.routeZ0[id]) * t;
    updateDensityCell(id);
  }

  function promote(id, now) {
    materialize(id, now);
    S.explicit[id] = 1;
    S.prevX[id] = S.posX[id]; S.prevZ[id] = S.posZ[id];
    S.velX[id] = S.velZ[id] = S.avoidX[id] = S.avoidZ[id] = 0;
    randomPoint(id, S.zone[id], point);
    S.goalX[id] = point.x; S.goalZ[id] = point.z;
    S.brainT[id] = 1 + rnd(id) * 3;
  }

  function demote(id, now) {
    if (!S.explicit[id]) return;
    S.explicit[id] = 0;
    planRoute(id, now, S.posX[id], S.posZ[id]);
  }

  function snapshot(now, into) {
    const out = into || new Float32Array(total * 2);
    for (let id = 0; id < total; id++) {
      materialize(id, now);
      out[id * 2] = S.posX[id]; out[id * 2 + 1] = S.posZ[id];
    }
    return out;
  }

  for (let id = 0; id < total; id++) {
    S.rng[id] = (0x39d7f21 ^ Math.imul(id + 1, 2654435761)) >>> 0;
    const zone = (rnd(id) * ZONES.length) | 0;
    S.zone[id] = zone;
    S.speed[id] = 1.25 + rnd(id) * 1.35;
    S.role[id] = rnd(id) < 0.10 ? 1 : rnd(id) < 0.18 ? 2 : rnd(id) < 0.27 ? 3 : rnd(id) < 0.36 ? 4 : rnd(id) < 0.44 ? 5 : 0;
    S.faction[id] = rnd(id) < 0.46 ? -1 : (rnd(id) < 0.5 ? 0 : 1);
    S.nerve[id] = (rnd(id) * 101) | 0; S.empathy[id] = (rnd(id) * 101) | 0; S.greed[id] = (rnd(id) * 101) | 0;
    S.reactivity[id] = (rnd(id) * 256) | 0;
    S.mood[id] = 50; S.skin[id] = SKIN[(rnd(id) * SKIN.length) | 0]; S.hair[id] = HAIR[(rnd(id) * HAIR.length) | 0];
    S.fem[id] = rnd(id) < 0.48 ? 1 : 0;
    rollInventory(id);
    S.partner[id] = -1;
    randomPoint(id, zone, point);
    S.posX[id] = point.x; S.posZ[id] = point.z;
    updateDensityCell(id);
    planRoute(id, 0, point.x, point.z);
  }

  // ---- identity + inventory accessors (used by crowd.js render + future loot) ----
  S.itemName = function (id) { return ITEM_NAMES[S.item[id]] || null; };
  S.itemColor = function (id) { return ITEM_VISIBLE[S.item[id]] || 0; };  // 0 = nothing worn
  S.nameOf = function (id) {
    // deterministic from the id so a spotted inmate is the SAME person next time
    return FIRST[(id * 2654435761 >>> 0) % FIRST.length] + " " + LAST[(id * 40503 >>> 0) % LAST.length];
  };
  // grant + clear what an agent carries (a stickup / takedown loots them once)
  S.loot = function (id) {
    const out = { cigs: S.cigs[id], item: S.itemName(id) };
    S.cigs[id] = 0; S.item[id] = 0;
    return out;
  };
  // ---- NPC_SCHEDULES: the jail's daily regime (simple math off the sun) ----
  // Hour off the canonical sun arc (sunrise 6, noon 12 — same derivation as
  // city/schedule.js:58; daynight.js runs onAlways so this is live in escape
  // mode too, which previously kept NO hours at all).
  S.jailHour = function () {
    return CBZ.sunAngle != null ? (((CBZ.sunAngle / (Math.PI * 2)) * 24) + 6) % 24 : 12;
  };
  // activity regime by hour: 0 yard laps, 1 stand-circles, 2 chow line,
  // 3 mixed (circles/wall-sits/wander), 4 wind-down, 5 LOCKDOWN (in cells)
  S.jailAct = function (h) {
    return h < 7 ? 5 : h < 9 ? 0 : h < 12 ? 1 : h < 13 ? 2 : h < 18 ? 3 : h < 21 ? 4 : 5;
  };
  // order-independent per-id hash in [0,1) — CBZ.hashN when loaded (repo
  // convention), else a local avalanche so this file stands alone.
  S.idHash = function (id, salt) {
    if (CBZ.hashN) return CBZ.hashN(id | 0, salt | 0) / 4294967296;
    let x = ((id + 1) * 2654435761 ^ (salt | 0)) >>> 0;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
  S.ACTIVITY = Object.freeze({ WALK: 0, STAND: 1, SOCIAL: 2, ACTION: 3, FIGHT: 4, FLEE: 5 });
  // LOCKDOWN: freeze this agent at a per-id bunk spot inside the cell block
  // (CBZ.WORLD.cellBlock) — off the zone graph, so it must be skipped by the
  // sim/selection while parked (entities/crowd.js guards on S.parked).
  const CELLS = (WORLD && WORLD.cellBlock) || { x0: -16, x1: 16, z0: -44, z1: -8 };
  S.park = function (id) {
    if (S.parked[id]) return;
    S.parked[id] = 1; S.explicit[id] = 0;
    S.posX[id] = CELLS.x0 + 2 + S.idHash(id, 0xCE11) * (CELLS.x1 - CELLS.x0 - 4);
    S.posZ[id] = CELLS.z0 + 2 + S.idHash(id, 0xCE12) * (CELLS.z1 - CELLS.z0 - 4);
    S.velX[id] = S.velZ[id] = S.panic[id] = 0;
    S.activity[id] = 1; S.activityT[id] = 0; S.partner[id] = -1; S.strikeT[id] = 0;
    updateDensityCell(id);
  };
  // dawn: back into the yard. (x,z) optional — the caller pre-checks the seat
  // against the player's view so nobody materializes on camera.
  S.unpark = function (id, now, x, z) {
    if (!S.parked[id]) return;
    S.parked[id] = 0;
    if (x == null) { randomPoint(id, S.zone[id], point); x = point.x; z = point.z; }
    S.posX[id] = x; S.posZ[id] = z;
    S.activity[id] = 0; S.activityT[id] = 0; S.partner[id] = -1; S.strikeT[id] = 0;
    updateDensityCell(id);
    planRoute(id, now, x, z);
  };

  // match restart: revive the killed, re-roll everyone's pockets fresh
  S.respawnAll = function () {
    for (let id = 0; id < total; id++) {
      S.dead[id] = 0; S.grudge[id] = 0; S.downT[id] = 0; S.contactCD[id] = 0;
      S.activity[id] = 0; S.activityT[id] = 0; S.partner[id] = -1; S.strikeT[id] = 0;
      if (S.parked[id]) {                 // lockdown doesn't survive a restart
        S.parked[id] = 0;
        randomPoint(id, S.zone[id], point);
        S.posX[id] = point.x; S.posZ[id] = point.z;
        updateDensityCell(id);
        planRoute(id, 0, point.x, point.z);
      }
      rollInventory(id);
    }
  };

  S.rnd = rnd;
  S.randomPoint = randomPoint;
  S.planRoute = planRoute;
  S.updateDensityCell = updateDensityCell;
  S.materialize = materialize;
  S.promote = promote;
  S.demote = demote;
  S.snapshot = snapshot;
  CBZ.ambient = S;
})();

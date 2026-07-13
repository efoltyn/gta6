/* ============================================================
   systems/humancontact.js - shared person-to-person contact rules.

   All three games use the same physical contract:
     - ordinary contact blocks the player instead of letting bodies phase;
     - ordinary on-foot contact never becomes a free prison knockdown;
     - the victim remembers it and reacts through the abilities their mode has.

   Temperament controls how strongly an NPC reacts. Inventory remains a
   separate capability check: an angry NPC can only draw a gun they carry, and
   only city NPCs can escalate by stealing a nearby car.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.makeGrid) return;

  const CELL = 2.4, PERSON_R = 0.36;
  const grids = Object.create(null);
  const cityList = [];
  const cityPlayer = { _p: true, isPlayer: true, pos: null, r: 0.55 };
  let clock = 0, hardHits = 0, blocks = 0;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function posOf(a) { return a.pos || (a.group && a.group.position); }
  function radiusOf(a) { return a.r != null ? a.r : (a.radius != null ? a.radius : PERSON_R); }
  function isPlayer(a) { return !!(a && (a._p || a.isPlayer)); }
  function realPlayerActor(mode) {
    if (mode === "city" && CBZ.city) return CBZ.city.playerActor;
    if (mode === "survival" && CBZ.surv) return CBZ.surv.playerActor;
    return {
      isPlayer: true,
      pos: CBZ.player.pos,
      group: CBZ.playerChar && CBZ.playerChar.group,
      dead: CBZ.player.dead,
    };
  }

  function reactionLevel(a) {
    if (!a) return 0.35;
    if (a.reactivity != null) return clamp(+a.reactivity || 0, 0, 1);
    if (a.aggr != null) return clamp(+a.aggr || 0, 0, 1);
    const b = CBZ.BEHAVIORS && CBZ.BEHAVIORS[a.behavior];
    if (b) return clamp((b.retaliate * 0.55 + b.guts * 0.30 + b.init * 0.15), 0, 1);
    if (a.kind === "cop" || a.kind === "guard") return 0.82;
    return 0.35;
  }

  function inventoryOf(a) {
    const items = a && a.loadout && a.loadout.items ? a.loadout.items : [];
    return {
      armed: !!(a && (a.armed || a.hasGun)),
      weapon: a && (a.weapon || (a.hasGun ? "concealed weapon" : null)),
      items,
      canCarjack: !!(CBZ.game.mode === "city" && a && !a.inCar && CBZ.cityNpcCarjack),
    };
  }

  function fleeFrom(a, source) {
    const p = posOf(a), s = source && posOf(source);
    if (!p || !s || !a.target || !a.target.set) return;
    const dx = p.x - s.x, dz = p.z - s.z, d = Math.hypot(dx, dz) || 1;
    a.target.set(p.x + dx / d * 18, 0, p.z + dz / d * 18);
  }

  function reactCity(a, source, level, severity) {
    const src = source && isPlayer(source) ? realPlayerActor("city") : source;
    if (a.kind === "cop") {
      if (severity >= 0.7 && source && isPlayer(source)) {
        if (CBZ.cityCrime) CBZ.cityCrime(30, { x: a.pos.x, z: a.pos.z, type: "assault-officer" });
        a.curTarget = realPlayerActor("city"); a.retarget = 0;
      }
      return;
    }
    a.mem = src && src.pos ? src : a.mem;
    a.alarmed = Math.max(a.alarmed || 0, 3 + severity * 5);
    a.fear = Math.min(10, (a.fear || 0) + severity * 3);
    if (severity < 0.55) return;

    const inv = inventoryOf(a);
    if (a.gang && CBZ.cityGangProvoke) CBZ.cityGangProvoke(a.gang, 0.25 + severity * 0.35);
    if (level >= 0.88 && !inv.armed && inv.canCarjack && Math.random() < 0.58) {
      if (CBZ.cityNpcCarjack(a, src)) return;
    }
    if (level >= 0.70 || (inv.armed && level >= 0.46)) {
      if (src && src.pos) { a.rage = src; a.state = "fight"; }
    } else {
      a.state = "flee"; fleeFrom(a, src);
    }
  }

  function reactEscape(a, source, level, severity) {
    const byPlayer = source && isPlayer(source);
    if (a.kind === "guard") {
      if (byPlayer) { a.alert = Math.max(a.alert || 0, 1.1); a.hunt = Math.max(a.hunt || 0, 2 + severity * 2); }
      return;
    }
    if (!byPlayer) return;
    a.playerGrudge = Math.min(14, (a.playerGrudge || 0) + 1 + severity * 2.2);
    if (a._crowd && a._id >= 0 && CBZ.ambient && CBZ.ambient.grudge) {
      CBZ.ambient.grudge[a._id] = Math.min(255, (CBZ.ambient.grudge[a._id] + 28 + severity * 72) | 0);
    }
    if (level >= 0.63) {
      a.huntPlayer = Math.max(a.huntPlayer || 0, 3.5 + level * 5);
      if (CBZ.provokeGang && a.gang >= 0) CBZ.provokeGang(a, 4 + level * 4);
    } else if (level >= 0.35) {
      a.aiState = "flee"; a.fleeT = Math.max(a.fleeT || 0, 1.8 + severity * 2);
    }
  }

  function reactSurvival(a, source, level, severity) {
    if (!source || !isPlayer(source)) return;
    a.grudge = Math.min(10, (a.grudge || 0) + 0.5 + severity * 1.5);
    a.state = level > 0.82 ? "move" : "flee";
    fleeFrom(a, source);
  }

  function react(a, event) {
    if (!a || a.dead) return;
    const severity = clamp(event.severity == null ? 1 : event.severity, 0, 1);
    const level = reactionLevel(a);
    a._contactGrudge = Math.min(20, (a._contactGrudge || 0) + severity * (0.5 + level));
    a._lastContact = { kind: event.kind || "bump", severity, at: clock };
    const mode = event.mode || CBZ.game.mode;
    if (mode === "city") reactCity(a, event.source, level, severity);
    else if (mode === "escape") reactEscape(a, event.source, level, severity);
    else if (mode === "survival") reactSurvival(a, event.source, level, severity);
  }

  function knockdown(a, event) {
    if (!a || a.dead) return;
    const p = posOf(a), source = event.source, sp = source && posOf(source);
    const fx = sp ? sp.x : p.x - (event.nx || 0);
    const fz = sp ? sp.z : p.z - (event.nz || 1);
    const t = 1.7 + (event.severity || 1) * 1.5;
    if (event.mode === "escape") {
      a.ko = Math.max(a.ko || 0, t + 1.1);
      if (CBZ.knockback && a.group) CBZ.knockback(a, fx, fz, 0.8 + (event.severity || 1) * 0.9);
    } else if (CBZ.body && CBZ.body.knockdown) {
      CBZ.body.knockdown(a, { fromX: fx, fromZ: fz, force: 5.5 + (event.severity || 1) * 2.5, t });
      if (a.ko != null) a.ko = Math.max(a.ko || 0, t);
    }
  }

  function playerCanCharge(mode, human) {
    const P = CBZ.player;
    if (!P || P.dead || P.driving || P.speed < 6.2) return false;
    if (mode !== "escape" && !P.sprint) return false;
    const grp = CBZ.playerChar && CBZ.playerChar.group;
    const pp = P.pos, hp = posOf(human);
    if (!grp || !hp) return true;
    const yaw = grp.rotation.y || 0, dx = hp.x - pp.x, dz = hp.z - pp.z;
    const d = Math.hypot(dx, dz) || 1;
    return (dx / d) * Math.sin(yaw) + (dz / d) * Math.cos(yaw) > 0.20;
  }

  function hardPlayerContact(playerEntry, human, mode, nx, nz, overlap) {
    if (!playerCanCharge(mode, human) || (human._contactUntil || 0) > clock) return false;
    // Running is movement, not an attack. In jail, let the normal separation
    // path stop both bodies; knockdowns must come from an explicit punch,
    // grapple, weapon, or other damaging action.
    if (mode === "escape") return false;
    human._contactUntil = clock + 0.75;
    const hp = posOf(human);
    // ON-FOOT GATE (owner: "run through someone and they fall over — in a car
    // it makes sense, walking it's dumb"): in the CITY a sprint charge only
    // ragdolls the frail/elderly slice (~8%, rolled once per ped — the comedy
    // exception); everyone else takes a hard SHOVE — displaced, staggered by
    // the react brain (curse/swing/flee per aggr), but stays on their feet.
    // Vehicle hits never come through here (vehicles.js owns them).
    if (mode === "city") {
      if (human._frail == null) human._frail = Math.random() < 0.08;
      if (!human._frail) {
        hp.x += nx * (overlap + 0.45); hp.z += nz * (overlap + 0.45);
        react(human, { mode, source: playerEntry, kind: "shoved", severity: 0.6 });
        if (CBZ.shake) CBZ.shake(0.05);
        hardHits++;
        return true;
      }
    }
    hp.x += nx * (overlap + 0.15); hp.z += nz * (overlap + 0.15);
    knockdown(human, { mode, source: playerEntry, nx, nz, severity: 1 });
    react(human, { mode, source: playerEntry, kind: "run-over", severity: 1 });
    if (CBZ.sfx) CBZ.sfx("ko");
    if (CBZ.shake) CBZ.shake(0.10);
    hardHits++;
    return true;
  }

  function blockPlayer(playerEntry, human, nx, nz, overlap, mode) {
    const pp = posOf(playerEntry), hp = posOf(human);
    pp.x -= nx * overlap * 0.88; pp.z -= nz * overlap * 0.88;
    hp.x += nx * overlap * 0.12; hp.z += nz * overlap * 0.12;
    CBZ.player.speed = Math.min(CBZ.player.speed || 0, 1.5);
    human._bumpCount = (human._bumpCount || 0) + 1;
    if (human._bumpCount >= 3 && reactionLevel(human) > 0.74 && (human._contactUntil || 0) <= clock) {
      human._bumpCount = 0; human._contactUntil = clock + 1.4;
      react(human, { mode, source: playerEntry, kind: "repeated-shove", severity: 0.34 });
    }
    blocks++;
  }

  function separatePair(A, B, mode) {
    const ap = posOf(A), bp = posOf(B); if (!ap || !bp) return;
    let dx = bp.x - ap.x, dz = bp.z - ap.z;
    const min = radiusOf(A) + radiusOf(B), d2 = dx * dx + dz * dz;
    if (d2 >= min * min) return;
    let d;
    if (d2 <= 1e-8) {
      const s = ((A._contactIndex * 1103515245 + B._contactIndex * 12345) & 1) ? 1 : -1;
      dx = s; dz = 0; d = 1;
    } else d = Math.sqrt(d2);
    const nx = dx / d, nz = dz / d, overlap = min - Math.min(d, min);
    const pa = isPlayer(A), pb = isPlayer(B);
    if (pa !== pb) {
      const P = pa ? A : B, H = pa ? B : A;
      const hx = pa ? nx : -nx, hz = pa ? nz : -nz;
      if (!hardPlayerContact(P, H, mode, hx, hz, overlap)) blockPlayer(P, H, hx, hz, overlap, mode);
      return;
    }
    ap.x -= nx * overlap * 0.5; ap.z -= nz * overlap * 0.5;
    bp.x += nx * overlap * 0.5; bp.z += nz * overlap * 0.5;
  }

  function resolve(list, dt, opts) {
    opts = opts || {};
    const mode = opts.mode || CBZ.game.mode;
    clock += Math.max(0, dt || 0);
    let grid = grids[mode];
    if (!grid) grid = grids[mode] = CBZ.makeGrid(opts.cell || CELL);
    for (let i = 0; i < list.length; i++) list[i]._contactIndex = i;
    grid.rebuild(list, posOf);
    for (let i = 0; i < list.length; i++) {
      const A = list[i], ap = posOf(A); if (!ap) continue;
      const gx = grid.cellIndex(ap.x), gz = grid.cellIndex(ap.z);
      for (let cx = gx - 1; cx <= gx + 1; cx++) for (let cz = gz - 1; cz <= gz + 1; cz++) {
        const bucket = grid.bucket(cx, cz); if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) {
          const B = bucket[k];
          if (B._contactIndex <= i) continue;
          if (Math.abs((posOf(B).y || 0) - (ap.y || 0)) > 1.6) continue;
          separatePair(A, B, mode);
        }
      }
    }
    if (opts.clamp) for (let i = 0; i < list.length; i++) opts.clamp(list[i]);
  }

  // Compact equivalent for the typed-array prison crowd. This performs the
  // player contact only; crowd-to-crowd separation remains in crowd.js.
  function resolveAmbientPlayer(S, id, dt) {
    if (!S || S.dead[id] || S.downT[id] > 0 || CBZ.player.dead) return;
    const P = CBZ.player, dx = S.posX[id] - P.pos.x, dz = S.posZ[id] - P.pos.z;
    const min = (P.radius || 0.55) + PERSON_R, d2 = dx * dx + dz * dz;
    if (d2 >= min * min) return;
    const d = Math.sqrt(d2) || 1, nx = d2 > 1e-8 ? dx / d : 1, nz = d2 > 1e-8 ? dz / d : 0;
    const overlap = min - Math.min(d, min);
    // The typed-array prison crowd follows the same rule as named actors:
    // sprinting into a body blocks movement; it is not a zero-input attack.
    const charge = CBZ.game.mode !== "escape" && P.speed >= 6.2 && P.sprint && S.contactCD[id] <= 0;
    if (charge) {
      S.posX[id] += nx * (overlap + 0.28); S.posZ[id] += nz * (overlap + 0.28);
      S.velX[id] += nx * 5; S.velZ[id] += nz * 5;
      S.downT[id] = 2.5; S.contactCD[id] = 0.9;
      S.grudge[id] = Math.min(255, (S.grudge[id] + 36 + (S.reactivity[id] / 255) * 84) | 0);
      S.panic[id] = Math.max(S.panic[id], 0.9);
      hardHits++;
    } else {
      P.pos.x -= nx * overlap * 0.90; P.pos.z -= nz * overlap * 0.90;
      S.posX[id] += nx * overlap * 0.10; S.posZ[id] += nz * overlap * 0.10;
      P.speed = Math.min(P.speed || 0, 1.5);
      blocks++;
    }
  }

  function clampCity(a) {
    const p = posOf(a); if (!p) return;
    if (CBZ.collide) CBZ.collide(p, radiusOf(a), p.y, (p.y || 0) + 1.7);
    // the PLAYER over open water is SWIMMING (city/swim.js owns them) — the
    // land clamp would teleport them back onto the quay mid-stroke.
    if (p === CBZ.player.pos && CBZ.cityWaterAt && CBZ.cityWaterAt(p.x, p.z)) return;
    if (CBZ.city && CBZ.city.arena) CBZ.city.arena.clampToCity(p, radiusOf(a));
  }

  // City had no actor separation pass. Run after pedestrians, police, and cars.
  // THROTTLED: rebuilding cityList + the spatial grid + the 3×3 neighbour sweep
  // every frame was a steady per-frame cost that buys nothing visible —
  // separation impulses are POSITIONAL pushes, so running the identical code at
  // ~30Hz (tier 4) down to ~12Hz (tier 0) with the SUMMED dt closes the same
  // overlap per second. 30Hz is visually indistinguishable for walking peds;
  // the dt clamp keeps one post-hitch catch-up pass from turning into a pop.
  let cityAcc = 0;
  CBZ.onUpdate(38, function (dt) {
    if (CBZ.game.mode !== "city" || !CBZ.city || CBZ.player.driving) return;
    cityAcc += dt;
    const hz = CBZ.qScale ? CBZ.qScale(12, 30) : 30;  // qScale may not exist yet in some boot orders
    if (cityAcc < 1 / hz) return;
    const step = Math.min(cityAcc, 0.1);              // sane ceiling on the accumulated push
    cityAcc = 0;
    cityList.length = 0;
    for (let i = 0; i < CBZ.cityPeds.length; i++) {
      const p = CBZ.cityPeds[i];
      if (!p.dead && !p.culled && !p.inCar && !(CBZ.body && CBZ.body.busy(p))) cityList.push(p);
    }
    for (let i = 0; i < CBZ.cityCops.length; i++) {
      const c = CBZ.cityCops[i];
      if (!c.dead && !(CBZ.body && CBZ.body.busy(c))) cityList.push(c);
    }
    if (!CBZ.player.dead) { cityPlayer.pos = CBZ.player.pos; cityPlayer.r = CBZ.player.radius || 0.55; cityList.push(cityPlayer); }
    resolve(cityList, step, { mode: "city", clamp: clampCity });
  });

  CBZ.humanContact = {
    resolve,
    react,
    knockdown,
    inventoryOf,
    reactionLevel,
    resolveAmbientPlayer,
    stats() { return { hardHits, blocks }; },
  };
})();

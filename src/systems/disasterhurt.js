/* ============================================================
   systems/disasterhurt.js — THE ONE WAY A DISASTER HURTS THE PLAYER.

   CBZ.disasterHurt(amount, source, point)

     amount  hp the hazard asks for (1e5+ is the old "instakill")
     source  the cause string, or the imp record surv.hurt was handed
             ({cause, fromX, fromY, fromZ, dir, fling, lethal})
     point   optional {x, y, z}: where the hazard IS (else read off the imp)
     returns the hp actually taken

   Every disaster on the island already funnels the player through
   CBZ.surv.hurt (modes/survival.js). surv.hurt now hands the player to this
   file first and only applies what comes back, so every hazard — the ones in
   systems/disasters.js, tornado.js, quake.js, wildfire.js, blizzard.js,
   weather.js, fx.js, swim.js, hunger.js — gets the same fairness law without
   any of them knowing it exists. Bots are untouched: they are the crowd, and
   the director's curve (disasters.js spareBot) already prices them.

   THE LAW: you die from MISTAKES, not from the dice.

   1. A WARNING BEFORE AN INSTANT DEATH. A 1e6 hit from a hazard you were not
      already standing in a moment ago — the lava edge you clipped, the
      tornado core you were dragged to, the bolt that picked you — is the
      warning: a heavy hit (WARN_HIT) and a shove away from the hazard. Stay
      in it past GRACE seconds and it kills, exactly as before. A one-shot
      instakill (a direct lightning strike) is therefore survivable, which is
      also true of real lightning: ~90% of people struck live.
      NOT softened (ABSOLUTE): the places that ARE the mistake — ground zero
      of a meteor or the nuke, the pyroclastic head, the crater vent, the
      bottom of a sinkhole, inside the footprint of a building as it comes
      down (disasters.js now hands the footprint, not a circle — see
      surv.hurtRadius `box`). A caller can also say so with imp.lethal.
   2. I-FRAMES. A hit of BIG_HIT or more buys IFRAME seconds in which every
      further non-absolute hit is cut to IFRAME_MUL. One beat of bad luck is
      one wound, not a combo.
   3. NO CHIP. A source whose rolling rate is under CHIP_DPS and whose single
      hit is small is ambient noise (the faint edge of the ash fall, the
      outermost brush of a field): dropped. What remains is damage you can
      see the reason for.
   4. SHELTER IS PHYSICAL. Inside a car you are in a Faraday cage (no ground
      current, side flash or chain) and out of the ash and the cold (a quarter
      of it). Under a roof the ground current and a building's side flash do
      not reach you (the lightning bolt goes to earth through the structure;
      that is what indoors means). A blast, a flung rock or a pressure front
      behind a solid wall (CBZ.rayColliders, the engine's own collider ray)
      reaches you at WALL_MUL. A hazard whose point is given with a y more
      than VSEP away vertically (a rock landing on the street under your
      third-floor window) does not reach you at all.
   5. ALOFT IS ABOVE THE GROUND. A player in an aircraft (P._aircraft, or any
      seat flagged P.flying) more than AIR_CLEAR above the terrain cannot be
      burned by lava, drowned, swallowed, shocked through the soil, frozen,
      choked, or crushed by a building: only the things that reach the sky
      (tornado, hurricane, meteor, nuke, pyroclastic cloud, a direct bolt) can
      touch the aircraft. Stood on a roof more than ROOF_CLEAR over the
      ground, the ground hazards (lava, lahar, ground current, gas fire,
      downed line, burning trees) pass under you.
   6. REGEN WHEN SAFE. REGEN_DELAY seconds without a scratch and the hp comes
      back at REGEN_RATE a second, to max.

   CBZ.disasterHurt.ledger is the per-source receipt (raw asked, applied,
   hits, first/last t) the lab's damage-fairness kit reads; .reset() clears
   it with the round (survival.js's reset calls it).
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const INSTAKILL = 1e5;
  const GRACE = 0.9;          // s in an instakill hazard before it really kills
  const FRESH = 0.6;          // s out of a hazard before re-entry counts as new
  const WARN_HIT = 38;        // hp the warning costs
  const BIG_HIT = 25;         // a hit this big earns i-frames
  const IFRAME = 1.2;         // s
  const IFRAME_MUL = 0.3;
  const CHIP_DPS = 1.2;       // hp/s: a source slower than this is noise
  const CHIP_HIT = 2;         // a single hit at least this big is never noise
  const REGEN_DELAY = 5;      // s without damage
  const REGEN_RATE = 6;       // hp/s
  const WALL_MUL = 0.2;
  const VSEP = 4;             // m of vertical separation a ground hit cannot cross
  const AIR_CLEAR = 4;        // m above terrain = aloft in an aircraft
  const ROOF_CLEAR = 5;       // m above terrain on a structure = above the ground hazards

  const RX = {
    absolute: /pyroclastic|vaporiz|nuclear|crater|flattened by a meteor|collaps|crushed under|swallowed by a sinkhole/,
    // reaches an aircraft in flight
    sky: /tornado|hurricane|meteor|nuclear|vaporiz|pyroclastic|struck by lightning|crash/,
    // passes under a body stood on a roof
    ground: /lava|lahar|ground current|gas fire|downed line|burned|burning|wildfire|flame/,
    // a car's cabin is a Faraday cage
    current: /ground current|side flash|current jumped|electrocut/,
    // a car's cabin keeps most of it out
    exposure: /ash|frozen|blizzard|cold|hypotherm|smoke|airburst|hurricane debris/,
    // indoors: the bolt goes to earth through the building
    indoorsSafe: /ground current|side flash off a building|current jumped/,
    // a wall between you and it takes it
    blast: /bomb|airburst|debris|kinetic|side flash|current jumped|meteor|explo/,
  };

  let t = 0;                  // sim clock (s), advanced by the update below
  let lastHurtT = -1e9;       // last time any damage was APPLIED
  let iframeUntil = -1e9;
  const sources = Object.create(null);   // key -> {raw, applied, hits, first, last, rate, enterT, warned, lastRaw}
  let passing = false;        // true while we are inside surv.hurt (re-entry guard)

  function P() { return CBZ.player; }
  function now() { return t; }
  function terrainAt(x, z) {
    const S = CBZ.surv;
    if (S && S.arena && S.arena.groundHeightAt) { try { const y = +S.arena.groundHeightAt(x, z); if (Number.isFinite(y)) return y; } catch (e) {} }
    if (CBZ.floorAt) { try { const y = +CBZ.floorAt(x, z); if (Number.isFinite(y)) return y; } catch (e) {} }
    return 0;
  }
  // a walkable platform over head height covering (x,z): the island's own
  // meaning of "indoors" (disasters.js sheltered() asks the same question)
  function underRoof(x, z, y) {
    const plats = CBZ.platforms; if (!plats) return false;
    const head = y + 2.1;
    for (let i = 0; i < plats.length; i++) {
      const p = plats[i];
      if (p.top > head && x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) return true;
    }
    return false;
  }
  function inVehicle() { const p = P(); return !!(p && ((p.driving && p._vehicle) || p._aircraft || p.flying)); }
  function aloft() {
    const p = P(); if (!p || !(p._aircraft || p.flying)) return false;
    return (p.pos.y - terrainAt(p.pos.x, p.pos.z)) > AIR_CLEAR;
  }
  function onHighFloor() {
    const p = P(); if (!p || !p.pos) return false;
    const sw = CBZ.citySwimState && CBZ.citySwimState();
    if (sw && sw.swimming) return false;
    return (p.pos.y - terrainAt(p.pos.x, p.pos.z)) > ROOF_CLEAR;
  }
  const _ray = {};
  function wallBetween(hx, hy, hz) {
    const p = P(); if (!p || !CBZ.rayColliders) return false;
    const ex = p.pos.x, ey = p.pos.y + 1.2, ez = p.pos.z;
    const dx = ex - hx, dy = ey - hy, dz = ez - hz;
    const L = Math.hypot(dx, dy, dz);
    if (!(L > 0.8)) return false;
    try {
      // a collider short of the head is a kerb or a crate, not a wall
      const c = CBZ.rayColliders(hx, hy, hz, dx / L, dy / L, dz / L, L - 0.5, _ray, {
        any: true, filter: function (c) { return c.y1 == null || c.y0 == null || (c.y1 - c.y0) > 1.6; },
      });
      return !!c;
    } catch (e) { return false; }
  }

  function causeOf(src) {
    if (typeof src === "string") return src;
    const S = CBZ.surv;
    return (src && src.cause) || (S && S._cause) || "unknown";
  }
  function sourceRec(key) {
    let s = sources[key];
    if (!s) s = sources[key] = { raw: 0, applied: 0, hits: 0, first: t, last: -1e9, rate: 0, rateT: t, enterT: -1e9, warned: false, kills: 0 };
    return s;
  }

  /* the verdict, without applying it: what this hit is worth to the player
     right now. Exposed for the lab and for anything that wants to preview. */
  function price(amount, src, point) {
    const p = P();
    if (!p || p.dead || !(amount > 0)) return { dmg: 0, why: "none" };
    const imp = (src && typeof src === "object") ? src : null;
    const cause = causeOf(src);
    const hx = point && point.x != null ? point.x : (imp && imp.fromX != null ? imp.fromX : null);
    const hz = point && point.z != null ? point.z : (imp && imp.fromZ != null ? imp.fromZ : null);
    const hyIn = point && point.y != null ? point.y : (imp && imp.fromY != null ? imp.fromY : null);
    const instakill = amount >= INSTAKILL;
    // only an instant death can be ABSOLUTE; a wound from the same disaster
    // still gets every check below
    const absolute = instakill && ((imp && imp.lethal === true) || RX.absolute.test(cause));

    // 5. aloft: only the sky hazards reach an aircraft in flight
    if (aloft() && !RX.sky.test(cause)) return { dmg: 0, why: "aloft" };
    // a ground hazard passes under a body stood high on a structure
    if (RX.ground.test(cause) && onHighFloor()) return { dmg: 0, why: "above the ground" };
    // 4. shelter
    if (inVehicle() && RX.current.test(cause)) return { dmg: 0, why: "faraday cage" };
    if (RX.indoorsSafe.test(cause) && underRoof(p.pos.x, p.pos.z, p.pos.y)) return { dmg: 0, why: "indoors" };
    let dmg = amount, why = "full";
    if (inVehicle() && RX.exposure.test(cause)) { dmg *= 0.25; why = "in a vehicle"; }
    if (!absolute && hyIn != null && Math.abs(p.pos.y - hyIn) > VSEP) return { dmg: 0, why: "different floor" };
    if (!absolute && hx != null && hz != null && dmg >= CHIP_HIT && RX.blast.test(cause)) {
      const hy = hyIn != null ? hyIn : terrainAt(hx, hz) + 1;
      if (wallBetween(hx, hy, hz)) { dmg *= WALL_MUL; why = "behind a wall"; }
    }
    return { dmg: dmg, why: why, absolute: absolute, instakill: instakill, cause: cause, hx: hx, hz: hz };
  }

  function disasterHurt(amount, src, point) {
    const p = P();
    if (!p || p.dead || !(amount > 0)) return 0;
    const g = CBZ.game;
    if (g && g.invuln > 0) return 0;
    const v = price(amount, src, point);
    const cause = v.cause || causeOf(src);
    const s = sourceRec(cause);
    // the rolling rate (1 s window, exponential) of what the source ASKS
    const dtR = Math.max(0, t - s.rateT);
    s.rate = s.rate * Math.exp(-dtR) + amount; s.rateT = t;
    s.raw += Math.min(amount, 1e3); s.hits++;
    const fresh = t - s.last > FRESH;
    if (fresh) { s.enterT = t; s.warned = false; }
    s.last = t;
    let dmg = v.dmg;
    if (dmg <= 0) return 0;
    const imp = (src && typeof src === "object") ? src : { cause: cause };

    if (v.instakill && !v.absolute) {
      // 1. the warning
      if (t - s.enterT < GRACE) {
        if (s.warned) return 0;
        s.warned = true;
        dmg = Math.min(dmg, WARN_HIT);
        shove(imp, v);
      }
    } else if (!v.instakill) {
      // 3. chip: a trickle under the floor is not damage
      if (dmg < CHIP_HIT && s.rate < CHIP_DPS) return 0;
    }
    // 2. i-frames (an absolute death is not softened by them)
    if (!(v.instakill && (v.absolute || t - s.enterT >= GRACE)) && t < iframeUntil) dmg *= IFRAME_MUL;
    if (dmg >= BIG_HIT && !(t < iframeUntil)) iframeUntil = t + IFRAME;
    if (!(dmg > 0)) return 0;
    s.applied += Math.min(dmg, 1e3);
    if (dmg >= INSTAKILL) s.kills++;
    lastHurtT = t;
    apply(dmg, imp);
    return dmg;
  }

  function shove(imp, v) {
    if (!CBZ.body || !CBZ.surv || !CBZ.surv.playerActor) return;
    const a = CBZ.surv.playerActor;
    try {
      if (v.hx != null && v.hz != null) CBZ.body.hit(a, { fromX: v.hx, fromZ: v.hz, force: 10, fling: 2.5 });
      else if (imp && imp.dir) CBZ.body.hit(a, { dir: imp.dir, force: 10, fling: 2.5 });
    } catch (e) {}
    if (CBZ.shake) CBZ.shake(0.7);
  }
  function apply(dmg, imp) {
    const S = CBZ.surv;
    if (S && S.hurt && S.playerActor) {
      passing = true;
      try { S.hurt(S.playerActor, dmg, imp); } finally { passing = false; }
    } else {
      const p = P(); p.hp -= dmg;
    }
  }

  disasterHurt.passing = function () { return passing; };
  disasterHurt.price = price;
  disasterHurt.ledger = sources;
  disasterHurt.safe = function () { return t - lastHurtT >= REGEN_DELAY; };
  disasterHurt.iframes = function () { return Math.max(0, iframeUntil - t); };
  disasterHurt.clock = now;
  disasterHurt.tick = function (dt) { tick(dt); };
  disasterHurt.reset = function () {
    for (const k in sources) delete sources[k];
    lastHurtT = -1e9; iframeUntil = -1e9;
  };
  disasterHurt.stats = function () {
    const out = {};
    for (const k in sources) {
      const s = sources[k];
      const span = Math.max(1e-3, s.last - s.first);
      out[k] = { raw: +s.raw.toFixed(2), applied: +s.applied.toFixed(2), hits: s.hits, kills: s.kills, dps: +(s.applied / Math.max(1, span)).toFixed(2) };
    }
    return out;
  };
  disasterHurt.LAW = { INSTAKILL, GRACE, FRESH, WARN_HIT, BIG_HIT, IFRAME, IFRAME_MUL, CHIP_DPS, CHIP_HIT, REGEN_DELAY, REGEN_RATE, WALL_MUL, VSEP, AIR_CLEAR, ROOF_CLEAR };
  disasterHurt.on = false;    // the lab sets this; the disaster game is on by itself
  CBZ.disasterHurt = disasterHurt;

  function active() {
    const g = CBZ.game;
    // the disaster game only: shark sim shares the island and surv.hurt, but
    // its player is a shark and its balance is its own
    return disasterHurt.on || !!(g && g.mode === "survival");
  }
  disasterHurt.active = active;
  // 6. the clock and the regen
  function tick(dt) {
    if (!active()) return;
    t += dt;
    const p = P();
    if (!p || p.dead) return;
    const max = p.maxHp || 100;
    if (p.hp < max && t - lastHurtT >= REGEN_DELAY && !(CBZ.game && CBZ.game.state && CBZ.game.state !== "playing" && !disasterHurt.on)) {
      p.hp = Math.min(max, p.hp + REGEN_RATE * dt);
    }
  }
  if (CBZ.onUpdate) CBZ.onUpdate(24.5, function (dt) { tick(dt); });
})();

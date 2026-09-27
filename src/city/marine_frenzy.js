/* ============================================================
   city/marine_frenzy.js — WHAT A KILL LOOKS LIKE FROM A MILE AWAY.

   city/marine_predation.js answers WHO EATS WHOM. This file answers the
   question the owner actually has to be able to answer from the deck of a
   boat with no UI on the screen: SOMETHING IS HAPPENING OVER THERE.

   A marine fight is the least legible event in the game. It is small, it is
   under the surface, it is grey on grey, and by the time you are close enough
   to read two animals fighting it is over. So the read has to be the water
   itself: white water, a ball of fish driven up against the surface, blood.
   That is the entire design of this file:

     1. BAIT BALL. A school of small fish under attack does not scatter, it
        BALLS — tight, milling, driven up. The SCHOOL ITSELF does that now
        (city/wildlife.js, the school formation: hr.bunch shrinks and spins the
        real fishes' slots). This file only puts the white water over it.

        (It used to draw its own ball: a second, fake school of up to 130
        instanced BOXES orbiting any sardine or mackerel school with anything
        toothed inside 130 m — which in the shark sim is always — and an
        invisible "health pool" that swallowed every bite on the anchor fish.
        That was the field of pale flat rectangles in the shallows. Deleted:
        one school, made of the fish that are really there, eaten one by one.)

     2. THE BOIL. White water and blood at the surface, on a cadence scaled by
        how many animals are feeding. Reuses waterSplashAt and goreBloom — no
        new particle system.

     3. SCAVENGERS. A carcass in the water draws a crowd. This is not a fourth
        AI loop: a scavenger is ticked by CBZ.predatorHunt with the carcass as
        its quarry (which is why they CIRCLE it, exactly like the real thing)
        and strikes through creature_combat, the same two drivers every other
        hunter in this repo spends. The only thing this file supplies is
        "the quarry is already dead, so a hit eats it instead of hurting it".

   HOW IT COMPOSES WITH THE REST, which is the whole point of building it on
   top rather than beside: marine_predation's §7 makes a dead or wounded thing
   in the water CHUM; the chum draws sharks; the sharks feeding make a boil;
   the boil is what the player sees. Every arrow in that chain already existed
   except the last one.

   NO BIRDS. There were gulls here — two flat triangles per instance, rolled on
   their long axis instead of flapping. At 400 m that reads as a bird; anywhere
   near a frenzy site, which is where they orbited, it reads as a paper plane.
   Removed rather than fixed. If the sea ever wants a long-range read again it
   should be a real winged rig, not a dart.

   NO HUD. Same contract as marine_predation.js, for the same reason: the
   owner said it twice. There is not a toast, a marker, an icon or a feed line
   anywhere in this file. Every signal it produces is a thing in the world.

   ALLOCATION-FREE PER FRAME. No meshes of its own; sites live in a fixed pool.

   DISTANCE-GATED HARD. The poll is 2 Hz, every site does one hypot against the
   camera before it decides to draw anything, and a frenzy 8 km away costs the
   pool scan and nothing else.

   DETERMINISM. Nothing here runs at world build. Sites are opened by gameplay
   events. Per-frame liveliness may use Math.random — the same split
   creature_combat.js and arena_fights.js document.

   FLAGS (one-line reverts):
     CBZ.CONFIG.MARINE_FRENZY     the whole file
     CBZ.CONFIG.MARINE_BAITBALL   the white water over a balled school
     CBZ.CONFIG.MARINE_SCAVENGE   a carcass drawing a crowd

   PUBLIC API
     CBZ.marineFrenzyAt(x, z, opts)   open a site by hand:
                                        {boil:true, seconds, press} white water
                                        over an event; {carcass:actor} a body
     CBZ.marineFrenzySites(out)       the live sites
     CBZ.marineScavengeStep(a, dt)    ONE seam, called by marine_predation's
                                      drive: true when scavenging owns the frame
     CBZ.marineFrenzyAudit()          the probe (no gameplay reads it)
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE || null;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  // ---- FLAGS ---------------------------------------------------------------
  if (CFG.MARINE_FRENZY == null) CFG.MARINE_FRENZY = true;
  if (CFG.MARINE_BAITBALL == null) CFG.MARINE_BAITBALL = true;
  if (CFG.MARINE_SCAVENGE == null) CFG.MARINE_SCAVENGE = true;
  function ON() { return CFG.MARINE_FRENZY !== false && CFG.MARINE_PREDATION !== false; }
  function BALLS() { return ON() && CFG.MARINE_BAITBALL !== false; }
  function SCAV() { return ON() && CFG.MARINE_SCAVENGE !== false; }

  // ---- tuning --------------------------------------------------------------
  const SITE_MAX = 3;          // concurrent frenzies. Three is already a lot of sea.
  const DRAW_R = 700;          // u — beyond this a site draws nothing
  const KEEP_R = 1440;         // u — past this a site is forgotten, not just undrawn
  const POLL_HZ = 0.5;         // s between site scans (2 Hz)
  const BALLED = 0.45;         // a school's hr.bunch past this is a bait ball
  const PRESS_FULL = 3;        // feeders that count as "full pressure"
  const BITE_EVERY = 2.2;      // s between one feeder's mouthfuls
  const CARCASS_FOOD = 26;     // mouthfuls a whole carcass is worth at scale 1
  const SCAV_R = 260;          // u — how far a scavenger smells a carcass
  const BOIL_EVERY = 0.22;     // s between surface splashes at a busy site

  // ---- module-scope temps (never allocated per frame) ----------------------
  let _t0 = 0, _t1 = 0;
  const AUDIT = { sites: 0, baitOpened: 0, carcassOpened: 0, scavengers: 0, hudWrites: 0 };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function actorPos(a) { return a && (a.pos || (a.group && a.group.position)) || null; }
  function camPos() {
    return (CBZ.camera && CBZ.camera.position) || (CBZ.player && CBZ.player.pos) || null;
  }
  function seaY(x, z) {
    if (typeof CBZ.citySeaHeightAt === "function") {
      try { const y = CBZ.citySeaHeightAt(x, z); if (isFinite(y)) return y; } catch (e) {}
    }
    return 0;
  }
  function inWater(x, z) {
    if (typeof CBZ.cityWaterAt === "function") {
      try { return !!CBZ.cityWaterAt(x, z); } catch (e) {}
    }
    return true;
  }

  /* THE HASH. Every per-instance constant in this file comes from here rather
     than from Math.random, so a bait ball is the SAME ball on both sides of a
     before/after pair and in a replay. Integer in, 0..1 out, no state. */
  function h01(i, salt) {
    let n = (i * 374761393 + (salt | 0) * 668265263) | 0;
    n = (n ^ (n >>> 13)) * 1274126177 | 0;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  // ============================================================
  //  §1. THE SITES. A fixed pool. A site is "a place in the sea where
  //  something is being eaten", and it does not care what opened it.
  // ============================================================
  const SITES = [];
  function newSite() {
    return {
      live: false, kind: "boil", ref: null,
      x: 0, y: 0, z: 0, r: 3, r0: 3,
      food: 1, food0: 1, feeders: 0, press: 0, t: 0,
      boilT: 0, depth: 2.5, ttl: -1,
    };
  }
  for (let i = 0; i < SITE_MAX; i++) SITES.push(newSite());

  function siteFor(ref) {
    for (let i = 0; i < SITES.length; i++) if (SITES[i].live && SITES[i].ref === ref) return SITES[i];
    return null;
  }
  /* A FULL POOL SAYS NO. The first cut recycled the site with the least food
     left whenever it was asked, which meant a busy stretch of sea evicted a
     bait ball every single poll and nothing ever got to finish — the pool
     thrashed and the player saw three half-formed events instead of one good
     one. So a slot is only taken from a site that is genuinely SPENT. */
  const SPENT = 0.34;
  function freeSite() {
    for (let i = 0; i < SITES.length; i++) if (!SITES[i].live) return SITES[i];
    let worst = null;
    for (let i = 0; i < SITES.length; i++) {
      const s = SITES[i];
      if (s.food / s.food0 > SPENT) continue;
      if (!worst || s.food / s.food0 < worst.food / worst.food0) worst = s;
    }
    if (worst) closeSite(worst);
    return worst;
  }
  function poolFull() {
    for (let i = 0; i < SITES.length; i++) {
      if (!SITES[i].live || SITES[i].food / SITES[i].food0 <= SPENT) return false;
    }
    return true;
  }
  function closeSite(s) {
    s.live = false; s.ref = null; s.feeders = 0; s.press = 0;
  }

  /* A BALLED SCHOOL. The site follows one live fish of it (any member will
     do; the poll re-anchors when that one is eaten) and closes the moment the
     school loosens. It has no food of its own: the fish are the food, and
     they are eaten by the ordinary bite path, one real fish at a time. */
  function openSchool(ref, x, z) {
    if (!BALLS() || !ref || !ref.herd) return null;
    let s = siteFor(ref);
    if (s) return s;
    for (let i = 0; i < SITES.length; i++) {
      const q = SITES[i];
      if (q.live && q.kind === "school" && q.ref && q.ref.herd === ref.herd) return q;
    }
    s = freeSite();
    if (!s) return null;
    s.live = true; s.kind = "school"; s.ref = ref;
    s.x = x; s.z = z; s.y = seaY(x, z) - 1; s.depth = 1;
    s.r = s.r0 = 3;
    s.food = s.food0 = 1;
    s.feeders = 0; s.press = 0; s.t = 0; s.boilT = 0; s.ttl = -1;
    AUDIT.baitOpened++;
    return s;
  }

  function openCarcass(ref) {
    if (!SCAV() || !ref) return null;
    let s = siteFor(ref);
    if (s) return s;
    const p = actorPos(ref);
    if (!p) return null;
    s = freeSite();
    if (!s) return null;
    const scale = (ref.species && ref.species.scale) || 1;
    s.live = true; s.kind = "carcass"; s.ref = ref;
    s.x = p.x; s.z = p.z; s.y = p.y || 0;
    s.depth = Math.max(0, seaY(p.x, p.z) - s.y);
    s.r = s.r0 = Math.max(2.5, scale * 3.4);
    s.food = s.food0 = Math.max(6, Math.round(CARCASS_FOOD * scale));
    s.feeders = 0; s.press = 0; s.t = 0; s.boilT = 0; s.ttl = -1;
    AUDIT.carcassOpened++;
    return s;
  }

  /* A BOIL WITH NOTHING IN IT YET. The third kind of site, and the one an
     outside caller actually wants: "something big just happened at this point
     in the water". No school, no body — just white water, for as long as it is
     worth looking at. city/marine_predation.js spends it the moment a megalodon
     opens a hull, because a sinking boat with men in the water IS a frenzy site
     and the boil over it is how you find the wreck across the bay. */
  function openBoil(x, z, secs, press) {
    if (!ON()) return null;
    const s = freeSite();
    if (!s) return null;
    s.live = true; s.kind = "boil"; s.ref = null;
    s.x = x; s.z = z; s.y = seaY(x, z) - 0.5; s.depth = 0.5;
    s.r = s.r0 = 7;
    s.food = s.food0 = 1;
    s.feeders = 0; s.t = 0; s.boilT = 0;
    s.press = clamp(press == null ? 0.8 : press, 0, 1);
    s.ttl = secs > 0 ? secs : 25;
    return s;
  }

  function hasTeeth(a) {
    return !!(a && a.species && a.species.aquatic && (a.species.bite || 0) > 0);
  }

  // ============================================================
  //  §2. THE POLL. 2 Hz, one pass over the wildlife list, and it decides
  //  three things: which schools are under attack, which carcasses are in the
  //  water, and how many mouths are at each site.
  // ============================================================
  let pollT = 0;
  function poll(dt) {
    pollT -= dt;
    if (pollT > 0) return;
    pollT = POLL_HZ;
    const list = CBZ.cityWildlife;
    const C = camPos();
    if (!list || !C) return;

    // 1. count the mouths at every live site, and expire the finished ones.
    for (let i = 0; i < SITES.length; i++) {
      const s = SITES[i];
      if (!s.live) continue;
      if (s.ref) {
        const p = actorPos(s.ref);
        if (!p || s.ref._despawned) { closeSite(s); continue; }
        // a bait ball follows its school; a carcass drifts with the body.
        s.x = p.x; s.z = p.z;
        if (s.kind === "carcass") s.y = p.y || 0;
        if (s.kind === "school") {
          // re-anchor on a live member when the anchor is eaten; close when
          // the ball loosens (the school itself decides that, not this file)
          const hr = s.ref.herd;
          if (s.ref.dead && hr) {
            let alt = null;
            for (let k = 0; k < hr.members.length && !alt; k++) if (!hr.members[k].dead) alt = hr.members[k];
            if (alt) s.ref = alt;
          }
          if (s.ref.dead || !hr || (hr.bunch || 0) < BALLED * 0.6) { closeSite(s); continue; }
          s.x = hr.cx; s.z = hr.cz;
        }
      }
      _t0 = s.x - C.x; _t1 = s.z - C.z;
      if (_t0 * _t0 + _t1 * _t1 > KEEP_R * KEEP_R) { closeSite(s); continue; }
      s.feeders = 0;
    }
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || a.dead || !hasTeeth(a)) continue;
      const p = actorPos(a);
      if (!p) continue;
      for (let j = 0; j < SITES.length; j++) {
        const s = SITES[j];
        if (!s.live) continue;
        _t0 = p.x - s.x; _t1 = p.z - s.z;
        const R = s.r * 3 + 8;
        if (_t0 * _t0 + _t1 * _t1 <= R * R) { s.feeders++; break; }
      }
    }

    // 2. open new sites — but not if there is nowhere to put one. This is the
    //    gate that keeps the O(n) scan (and the O(n) hunter check under it)
    //    off the frame budget entirely once the sea is already busy.
    if (poolFull()) { countLive(); return; }
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || !a.species || !a.species.aquatic || a.external) continue;
      const p = actorPos(a);
      if (!p) continue;
      _t0 = p.x - C.x; _t1 = p.z - C.z;
      const d2 = _t0 * _t0 + _t1 * _t1;
      if (d2 > DRAW_R * DRAW_R) continue;
      if (a.dead) {
        if (a.skinned || a._mpEaten) continue;
        if (!inWater(p.x, p.z)) continue;
        openCarcass(a);
        continue;
      }
      // a school that has BALLED (city/wildlife.js: something hung around
      // under it) gets its white water; a relaxed one gets nothing
      const hr = a.herd;
      if (!hr || (hr.bunch || 0) < BALLED || siteFor(a)) continue;
      openSchool(a, hr.cx, hr.cz);
    }
    countLive();
  }
  function countLive() {
    AUDIT.sites = 0;
    for (let i = 0; i < SITES.length; i++) if (SITES[i].live) AUDIT.sites++;
  }

  // ============================================================
  //  §5. THE BOIL, and the eating.
  // ============================================================
  function splash(x, z, power) {
    if (typeof CBZ.waterSplashAt !== "function") return;
    try { CBZ.waterSplashAt(x, seaY(x, z), z, clamp(power, 0.4, 4)); } catch (e) {}
  }

  function stepSites(dt) {
    for (let i = 0; i < SITES.length; i++) {
      const s = SITES[i];
      if (!s.live) continue;
      s.t += dt;
      if (s.ttl > 0) {
        // a BOIL has no mouths to count: it is a fading event, so its pressure
        // is its own remaining life and it closes itself.
        s.ttl -= dt;
        if (s.ttl <= 0) { closeSite(s); continue; }
        s.press = clamp(s.press * (0.55 + 0.45 * clamp(s.ttl / 8, 0, 1)), 0.12, 1);
      } else {
        s.press += (clamp(s.feeders / PRESS_FULL, 0, 1) - s.press) * Math.min(1, dt * 1.6);
      }


      // THE BOIL. White water where mouths are working, scaled by how many.
      if (s.feeders > 0 || s.kind === "boil") {
        s.boilT -= dt;
        if (s.boilT <= 0) {
          s.boilT = BOIL_EVERY / (0.5 + s.press);
          const a = Math.random() * 6.283185307, rr = Math.random() * s.r * 1.3;
          splash(s.x + Math.cos(a) * rr, s.z + Math.sin(a) * rr, 0.7 + s.press * 1.9);
          if (s.kind === "carcass" && CBZ.goreBloom && Math.random() < 0.5) {
            try { CBZ.goreBloom(s.x, s.y + 0.4, s.z, { amount: 0.5 + s.press }); } catch (e) {}
          }
        }
      }
    }
  }

  /* A MOUTHFUL. Called by whatever is feeding — the bait-ball branch below and
     the scavenger seam in §6 both come through here, so "being eaten" has one
     implementation and one place that can decide the site is finished. */
  function takeBite(s, by) {
    if (!s || !s.live || s.kind !== "carcass") return false;
    s.food -= 1;
    splash(s.x + (Math.random() - 0.5) * s.r, s.z + (Math.random() - 0.5) * s.r, 1.1 + s.press);
    if (CBZ.goreBloom) {
      try { CBZ.goreBloom(s.x, s.y + 0.3, s.z, { amount: s.kind === "carcass" ? 1.1 : 0.5 }); } catch (e) {}
    }
    // BLOOD IS THE POINT. Every mouthful chums the water through
    // marine_predation's ONE producer, which is what turns a kill into a
    // crowd — and it is why this file never opens a gore handle itself.
    if (s.ref && typeof CBZ.marineBleed === "function") {
      try { CBZ.marineBleed(s.ref, s.kind === "carcass" ? 0.9 : 0.5); } catch (e) {}
    }
    if (s.kind === "carcass") {
      // eaten away: the body visibly shrinks as the crowd works it.
      const g = s.ref && s.ref.group;
      if (g && g.scale) {
        const k = clamp(0.55 + 0.45 * (s.food / s.food0), 0.5, 1);
        /* OFF THE BODY IT ACTUALLY HAD. Re-deriving species.scale * _sizeMul
           threw away everything the animal had EATEN (_growMul, city/
           wildlife_traits.js), so the first bite out of a well-fed carcass
           snapped it back to the size it was born at. _sizeEff is the resting
           scale wildlife.js publishes and it already carries all three terms. */
        const born = (+s.ref._sizeEff > 0) ? s.ref._sizeEff
          : ((s.ref.species && s.ref.species.scale) || 1) * (s.ref._sizeMul || 1);
        try { g.scale.setScalar(born * k); } catch (e) {}
      }
    }
    if (s.food <= 0) {
      if (s.ref) s.ref._mpEaten = true;
      closeSite(s);
    }
    return true;
  }

  // ============================================================
  //  §6. SCAVENGERS — THE ONE SEAM. marine_predation's drive calls this when
  //  an animal has nothing living to hunt; true means scavenging owns the
  //  frame. It is CBZ.predatorHunt with a corpse as the quarry, which is why
  //  they circle it, and creature_combat lands the bites — no new AI loop, no
  //  private mover, no second combat path.
  // ============================================================
  const _scratch = [];
  function scavOpts(a) {
    let o = a._mfOpts;
    if (o) return o;
    o = a._mfOpts = {};
    if (typeof CBZ.predatorKit === "function") {
      try { const k = CBZ.predatorKit(a); if (k) for (const key in k) o[key] = k[key]; } catch (e) {}
    }
    const sh = a._shark;
    if (sh && sh.opts && typeof sh.opts.move === "function") o.move = sh.opts.move;
    o.seize = false;
    o.canReach = function () { return true; };
    /* A HIT ON A CORPSE FEEDS, IT DOES NOT DAMAGE. The whole difference
       between scavenging and predation is one function, and this is it. */
    o.onHit = function () {
      const s = a._mfSite;
      if (!s || !s.live) return;
      const now = (a._mfBiteT || 0);
      if (now > 0) return;
      a._mfBiteT = BITE_EVERY;
      takeBite(s, a);
    };
    return o;
  }

  function nearestSite(a, p) {
    let best = null, bd = SCAV_R * SCAV_R;
    for (let i = 0; i < SITES.length; i++) {
      const s = SITES[i];
      if (!s.live || s.kind !== "carcass") continue;
      if (s.ref === a) continue;
      _t0 = s.x - p.x; _t1 = s.z - p.z;
      const d2 = _t0 * _t0 + _t1 * _t1;
      if (d2 < bd) { bd = d2; best = s; }
    }
    return best;
  }

  function scavengeStep(a, dt) {
    if (!SCAV() || !a || !(dt > 0) || a.dead || a.tamed || a.ridden || a.external) return false;
    if (!hasTeeth(a)) return false;
    if (a._mfBiteT > 0) a._mfBiteT -= dt;
    const p = actorPos(a);
    if (!p) return false;
    const s = nearestSite(a, p);
    a._mfSite = s;
    if (!s || !s.ref || !s.ref.group) return false;
    let st = "cruise";
    if (typeof CBZ.predatorHunt === "function") {
      try { st = CBZ.predatorHunt(a, s.ref, dt, scavOpts(a)) || "cruise"; } catch (e) { st = "cruise"; }
    }
    // NEVER the player's threat chevron: markers.js reads a.state, and an
    // animal eating a dead fish is not hunting you.
    a.state = "wander";
    if (st === "cruise") return false;
    AUDIT.scavengers++;
    return true;
  }
  CBZ.marineScavengeStep = scavengeStep;

  // ============================================================
  //  PUBLIC — open a site by hand. For a stager, a mission, or a preset that
  //  wants the event without waiting for the sea to produce one.
  // ============================================================
  CBZ.marineFrenzyAt = function (x, z, opts) {
    opts = opts || {};
    if (opts.carcass) return openCarcass(opts.carcass);
    if (opts.school) return openSchool(opts.school, x, z);
    return openBoil(x, z, +opts.seconds || 0, opts.press);
  };
  CBZ.marineFrenzySites = function (out) {
    out = out || _scratch;
    out.length = 0;
    for (let i = 0; i < SITES.length; i++) if (SITES[i].live) out.push(SITES[i]);
    return out;
  };
  CBZ.marineFrenzyAudit = function () {
    let bait = 0, carc = 0, food = 0;
    for (let i = 0; i < SITES.length; i++) {
      const s = SITES[i];
      if (!s.live) continue;
      if (s.kind === "school") bait++; else carc++;
      food += s.food;
    }
    return {
      sites: bait + carc, baitBalls: bait, carcasses: carc, foodLeft: food,
      baitOpened: AUDIT.baitOpened,
      carcassOpened: AUDIT.carcassOpened, scavengerFrames: AUDIT.scavengers,
      hudWrites: AUDIT.hudWrites,
    };
  };
  CBZ.marineFrenzyReset = function () {
    for (let i = 0; i < SITES.length; i++) closeSite(SITES[i]);
    AUDIT.baitOpened = AUDIT.carcassOpened = AUDIT.scavengers = 0;
    AUDIT.sites = 0;
  };

  // ============================================================
  //  THE UPDATER. onUpdate(47.2): after wildlife.js (47.1) and after
  //  marine_predation's own pass (47.15), because a site's position is read
  //  off bodies those two have already moved this frame. Presentation only —
  //  nothing in here decides who wins a fight.
  // ============================================================
  if (CBZ.onUpdate) {
    CBZ.onUpdate(47.2, function (dt) {
      if (!(dt > 0)) return;
      if (!ON()) return;
      poll(dt);
      stepSites(dt);
    });
  }
})();

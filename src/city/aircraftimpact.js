/* ============================================================
   city/aircraftimpact.js — THE PLANE-INTO-BUILDING CATASTROPHE.

   OWNER BRIEF (the single most-wanted feature): "buildings when hit with a
   plane should have much more real reaction."

   The reaction was missing because an airframe strike was drawn as a SURFACE
   POP: one fireball at the contact point, three cityDamageBuilding seats, and
   a tower that went back to being a box. A real strike has a SHAPE:

     PENETRATION -> ENTRY FIREBALL -> EJECTA CONE DOWNRANGE -> CONTENTS AND
     GLASS OUT OVER SEVERAL FLOORS -> FIRE TAKING HOLD -> A BUILDING THAT
     BURNS AND SAGS FOR A WHILE -> COLLAPSE IF THE LOAD PATH FAILS.

   Almost all of that already exists in systems/impactbus.js (the ordnance
   table: pen / fire / wave / struct) and city/structural.js (the per-floor
   ledger, the fire automaton, the load-path check, the pancake). This file is
   deliberately SMALL because its job is to feed those two the RIGHT NUMBERS
   and the RIGHT DIRECTION, and to own only the beats that are genuinely
   missing on the ENTRY side:

     * the DOWNRANGE EJECTA CONE (spall thrown along the travel axis)
     * CONTENTS / PAPER fluttering out of the wound (the signature read)
     * a WOUND THAT KEEPS SMOKING (crashfx's addBlastWound, via cityWallRuin)
     * heavy FALLING DEBRIS off a wounded high floor, as a real hazard
     * the AIRFRAME's own end: deformation + shear + wreck field
       (city/crashdeform.js, extended from cars to aircraft — one deformation
       system, not two)

   ------------------------------------------------------------------
   HOW IT ATTACHES — WRAPPING, NEVER EDITING (CLAUDE.md wrapper rule).

   city/playeraircraft.js, city/aircraft.js, city/airtraffic.js and
   city/island_airport.js are READ-ONLY to this domain. Every one of them ends
   a crash the same way: it fires CBZ.cityExplosion / cityAirstrikeExplosion at
   the contact point. So this file:

     1. TRACKS every live airframe once per frame (order 11.9, BEFORE
        playeraircraft's flight step at 12-14), keeping its pre-impact
        position / velocity / dimensions. crashCraft() zeroes craft.vx/vy/vz
        the instant it runs, so the pre-step sample is the only place the real
        impact velocity exists.
     2. WRAPS cityExplosion + cityAirstrikeExplosion (markers copied forward,
        handler idempotent per airframe) and asks one question per blast: "is
        there a DYING tracked airframe within 18 m of this?" If yes, that
        blast IS a crash, and we run the catastrophe on top of it.

   The legacy blast is left alone — it is a perfectly good entry fireball, and
   suppressing it would risk a crash with no explosion at all if anything here
   threw. We pass `entryDrawn: true` so our own FX composer knows not to draw
   a second one.

   ------------------------------------------------------------------
   THE PHYSICS THAT IS ACTUALLY MODELLED (and what is faked).

   * IMPACT ENERGY. E0 = 1/2 m v^2 with m derived from the airframe's REAL
     authored dimensions (span x length x height x a per-class density), not
     from a hand-typed "heavy?" boolean. A Cessna into a shopfront and an
     A320 into a tower differ by ~3 orders of magnitude in E0, which is why
     they must not share a constant. E0 drives `scale` on the ordnance row.
   * PENETRATION. E(x) = E0 * e^(-x/lambda) — the standard ballistic decay.
     systems/impactbus.js's rows already carry the per-class `pen`, and
     city/structural.js already runs the decay, spreads the damage across the
     floorplates the airframe passed through, and blows the EXIT PLUME out the
     far side. We use the same closed form here for one thing only: where to
     seat the ejecta cone.
   * DEBRIS is CBZ.debris's: real rigid bodies cut from (or adopted as) the
     thing that broke — the struck floor's own wall, the airframe's own wing.
   * EVERYTHING ELSE IS A DRAW. Fire, sag, tilt and collapse are
     city/structural.js's; we never re-implement them.

   PERFORMANCE ENVELOPE (levelling a district must not kill a low-end machine):
   * Every count rides CBZ.qScale(lo, hi). Nothing is a hardcoded particle
     count.
   * NO NEW PARTICLE POOL. Ejecta -> CBZ.cityChunk (chips of the struck
     wall's own material). Paper/contents -> CBZ.cityDebrisAdopt. Falling
     floor edge and airframe sections -> CBZ.debris (the one rigid-body sim),
     cut from / adopted as the real thing. Dust -> cityDustKick. Smoke ->
     cityCrashSmoke. Wound -> cityWallRuin / cityHeavyWallRuin. Glass ->
     cityShatter.
   * The ONE list this file owns is the WRECK TRACKER: burning / hazardous
     pieces in the debris sim, followed until they land (smoke trail, kill
     check). Hard-capped at qScale(4, 16); over the cap the farthest record
     stops being tracked (the piece itself stays).
   * The per-frame cost with nothing crashing is: one Map walk over <= ~8 live
     airframes plus two length checks.

   DETERMINISM: nothing here is a generation path. This is runtime FX and
   runtime damage, so Math.random is legal (CLAUDE.md). Anything that must
   agree across clients (which lot, which stage, the rubble) is owned by
   structural.js / demolition.js, which already serialise.

   FLAGS (every risky beat is a one-line revert):
     CBZ.CONFIG.AIR_IMPACT_V1             master
     CBZ.CONFIG.AIR_IMPACT_DEFORM         airframe deformation + shear
     CBZ.CONFIG.AIR_IMPACT_DEBRIS_HAZARD  falling debris can kill
     CBZ.CONFIG.AIR_IMPACT_TUMBLE         post-impact cartwheel of the hulk
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  if (CBZ.cityAircraftImpact) return;              // idempotent family guard

  CBZ.CONFIG = CBZ.CONFIG || {};
  // MASTER REVERT. false => every crash path in the game behaves exactly as it
  // did before this file existed (the legacy blast still fires; we simply
  // never add to it).
  if (CBZ.CONFIG.AIR_IMPACT_V1 == null) CBZ.CONFIG.AIR_IMPACT_V1 = true;
  // Airframe deformation / wing shear / wreck field (city/crashdeform.js).
  if (CBZ.CONFIG.AIR_IMPACT_DEFORM == null) CBZ.CONFIG.AIR_IMPACT_DEFORM = true;
  // Heavy debris shed off a wounded high floor hurts what is under it.
  if (CBZ.CONFIG.AIR_IMPACT_DEBRIS_HAZARD == null) CBZ.CONFIG.AIR_IMPACT_DEBRIS_HAZARD = true;
  // The hulk cartwheels/tumbles to a stop after a GROUND impact (never after a
  // building impact — a wreck lodged in a facade must stay lodged).
  if (CBZ.CONFIG.AIR_IMPACT_TUMBLE == null) CBZ.CONFIG.AIR_IMPACT_TUMBLE = true;

  const A = (CBZ.cityAircraftImpact = {});

  function qs(lo, hi) { return CBZ.qScale ? CBZ.qScale(lo, hi) : (lo + hi) * 0.5; }
  function qi(lo, hi) { return Math.max(0, Math.round(qs(lo, hi))); }
  function inCity() { return CBZ.game && CBZ.game.mode === "city"; }
  // The Isles / the disaster island: the same airframes crash into the same
  // collapse engine there (no city ledger, no city blast chain)
  function islandOn() { return !!(CBZ.game && CBZ.islandModeOn && CBZ.islandModeOn(CBZ.game.mode)); }
  function inWorld() { return inCity() || islandOn(); }
  function floorAt(x, z) { const v = CBZ.floorAt ? +CBZ.floorAt(x, z) : 0; return isFinite(v) ? v : 0; }
  function camDist(x, z) {
    const c = CBZ.camera && CBZ.camera.position;
    if (!c) return 0;
    return Math.hypot(x - c.x, z - c.z);
  }

  /* ============================================================
     AIRFRAME MASS MODEL

     Mass is derived from the airframe's own authored dimensions so a crash
     scales with what the player actually stole, not with a boolean. The
     "density" numbers are kg per cubic metre of the airframe's BOUNDING BOX
     (not of aluminium) — reverse-solved from real MTOWs so the three classes
     land in the right ratio:

       Cessna 172   11.0 x 8.3 x 2.7 box ~= 246 m^3, MTOW ~1100 kg  -> ~4.5
       F-22         13.6 x 19.0 x 5.1    ~= 1318 m^3, ~24000 kg     -> ~18
       A320         34.1 x 37.6 x 11.8   ~= 15130 m^3, ~73000 kg    -> ~4.8

     A fighter is dense (engines + fuel in a small box); an airliner is a thin
     aluminium tube around air, which is exactly why an airliner's devastation
     comes from SPEED x SIZE x FUEL rather than from being heavy for its
     volume.
     ============================================================ */
  const DENSITY = { small: 4.5, jet: 18, airliner: 4.8 };

  // never let a bad class id reach the arithmetic (a foreign caller may pass
  // anything); an unknown airframe is a fast mover.
  function okCls(c) { return DENSITY[c] ? c : "jet"; }
  function massOf(cls, d) { return DENSITY[okCls(cls)] * d.length * d.span * d.height; }
  A.energy = function (cls, d, v) { return 0.5 * massOf(cls, d || DEF_DIMS[okCls(cls)]) * v * v; };
  A.mass = function (cls, d) { return massOf(cls, d || DEF_DIMS[okCls(cls)]); };

  /* ------------------------------------------------------------------
     THE REFERENCE ENERGIES USED TO LIVE HERE. THEY DON'T ANY MORE.

     This file used to keep its own `REF` speed table, its own `EREF` reference
     energies and its own `energyScale()` — a private sqrt curve clamped to
     [0.4, 2.6] — and hand the ordnance bus a pre-chewed `scale`. That was a
     second, invisible pricing model sitting beside the bus's, and it is
     exactly the parallel-bookkeeping shape THE BLOCK LAW forbids: a bomb
     dropped from altitude, a meteor and a hijacked 767 were priced on three
     different scales that could silently disagree.

     The bus now owns THE KINETIC LAW (systems/impactbus.js): every ordnance
     row may declare `refE` in joules, callers pass `{mass, speed}`, and the
     bus derives an FX multiplier of (E/refE)^(1/3) — Hopkinson-Cranz, a
     radius-like quantity — and a structural multiplier of (E/refE)^(2/3) — an
     area-like one. The crash rows' `refE` values are the very numbers that
     used to be `EREF` here, moved next to the rows they calibrate.

     What this file still owns is the only thing it genuinely knows: an
     airframe's MASS, from its authored dimensions and its class density. We
     hand over mass, speed and frontal width. The bus does the pricing.

     Two things the private curve could never express, which we get for free:
       * an overspeed dive is no longer clamped at 2.6x, so the difference
         between a 95 m/s approach and a 240 m/s dive is real;
       * FRONTAL WIDTH. A 34 m wingspan severs most of a floor's load-bearing
         cross-section; a fighter's 13 m does not. That is the difference
         between gutting a tower and putting a hole in one, and no energy
         number of any shape can say it.
     ------------------------------------------------------------------ */

  // The deformation system (city/crashdeform.js) still wants ONE scalar in the
  // old [0.4, 2.6] band to size a crumple. Derive it from the bus's own
  // multiplier so there is a single source of truth, and fall back to the
  // original closed form only if the bus is absent (rule 2, degrade-safe).
  function energyScale(cls, d, v) {
    cls = okCls(cls);
    if (!d) d = DEF_DIMS[cls];
    if (CBZ.impact && CBZ.impact.kineticMul) {
      const m = CBZ.impact.kineticMul(ROW[cls] || "crashSmall", { mass: massOf(cls, d), speed: v });
      if (m) return Math.max(0.4, Math.min(2.6, m.pow));
    }
    // no bus: a plain cube-root of the energy against the class nominal.
    const nomV = cls === "small" ? 34 : 95;
    const nomE = 0.5 * massOf(cls, DEF_DIMS[cls]) * nomV * nomV;
    return Math.max(0.4, Math.min(2.6, Math.cbrt((0.5 * massOf(cls, d) * v * v) / (nomE || 1))));
  }

  // ORDNANCE ROW BY CLASS. The rows live in systems/impactbus.js's table
  // (crashSmall pen 4 / crashJet pen 12 / crashAirliner pen 26 + a blast
  // wave). NEW ORDNANCE IS A TABLE ROW, NOT A FILE — we only pick one.
  const ROW = { small: "crashSmall", jet: "crashJet", airliner: "crashAirliner" };

  // Speed below which a contact is a TAXI BUMP, not a strike. These mirror
  // playeraircraft.js's own `catastrophic` thresholds exactly (heli 15,
  // airliner 17, else 20) so we can never fire on a contact the flight model
  // itself treated as survivable.
  function minSpeed(s) {
    if (s.heli) return 15;
    if (s.cls === "airliner") return 17;
    if (s.cls === "small") return 18;
    return 20;
  }

  /* ============================================================
     DIMENSIONS
     Authored aircraftDims first (island_airport / militaryvehicles publish
     them and playeraircraft's own airframeDims reads the same field), then a
     ONE-TIME measured bounding box cached on the group, then a class default.
     Never measured per frame — a Box3 over an airliner is not free.
     ============================================================ */
  const DEF_DIMS = {
    small:    { length: 8.3,  span: 11.0, height: 2.7,  fuselage: 1.5 },
    jet:      { length: 19.0, span: 13.6, height: 5.1,  fuselage: 2.0 },
    airliner: { length: 37.6, span: 34.1, height: 11.8, fuselage: 4.0 },
  };
  function normDims(d) {
    return {
      length: Math.max(4, d.length || 8),
      span: Math.max(3, d.span || 7),
      height: Math.max(2, d.height || 3),
      fuselage: Math.max(1.1, d.fuselage || Math.min(4.2, (d.span || 8) * 0.16)),
    };
  }
  function dimsFor(obj, grp) {
    const rec = obj.sourceRec || null;
    const d = (rec && rec.aircraftDims) ||
      (grp && grp.userData && grp.userData.aircraftDims) ||
      obj.aircraftDims;
    if (d) return normDims(d);
    if (grp && grp.userData) {
      if (grp.userData._airImpactDims) return grp.userData._airImpactDims;
      if (window.THREE && THREE.Box3) {
        try {
          const b = new THREE.Box3().setFromObject(grp);
          if (isFinite(b.min.x) && isFinite(b.max.x)) {
            const out = normDims({
              length: b.max.z - b.min.z, span: b.max.x - b.min.x,
              height: b.max.y - b.min.y, fuselage: (b.max.x - b.min.x) * 0.16,
            });
            grp.userData._airImpactDims = out;
            return out;
          }
        } catch (e) {}
      }
    }
    return DEF_DIMS[obj.kind === "heli" ? "small" : "jet"];
  }

  function classOf(obj, dims) {
    const ac = obj.airClass || obj.flightKind || (obj.sourceRec && obj.sourceRec.flightKind);
    if (ac === "airliner") return "airliner";
    if (ac === "prop" || ac === "heli") return "small";
    if (ac === "jet") return "jet";
    if (obj.kind === "heli" || obj.kind === "plane") {
      // airtraffic.js's light GA fleet and any heli are small airframes
      return dims.span >= 22 ? "airliner" : "small";
    }
    if (dims.span >= 22 || dims.length >= 24) return "airliner";
    if (dims.length >= 12) return "jet";
    return "small";
  }

  /* ============================================================
     THE AIRFRAME TRACKER (order 11.9).

     Sampled BEFORE playeraircraft.js's flight step (12 / 13 / 14), so on the
     frame a crash resolves we still hold the velocity the airframe had when
     it hit. crashCraft() sets craft.destroyed = true and then zeroes
     craft.vx/vy/vz within the same call, so there is no other way to get it.

     Sources, all feature-detected (a partial headless load must never throw):
       * CBZ.player._aircraft        the flown craft (jet / heli / hijacked
                                     airliner — the owner's case)
       * CBZ.cityAircraftEnumTargets police gunship + response jets
       * CBZ.cityAirTrafficList      ambient civilian GA fleet
     Parked civil aircraft (island_airport.js) are deliberately NOT tracked:
     they never move, so a blast on one is a shoot-down, not an impact.
     ============================================================ */
  const samples = new Map();          // obj -> sample record
  const MATCH_R = 18;                 // metres between the blast and the airframe
  const SAMPLE_TTL = 4;               // seconds an unrefreshed entry survives

  // ONE IMPACT PER AIRFRAME, FOR THE OBJECT'S WHOLE LIFETIME. The per-sample
  // `handled` flag is not enough on its own: a wreck can legitimately stay
  // referenced by its owner (playeraircraft keeps a destroyed external craft
  // as a persistent hull), so the tracker would re-adopt it on the next frame,
  // see `destroyed`, and detonate the same crash over and over. This is the
  // idempotence guard the wrapper rule demands, keyed on the airframe itself.
  const done = (typeof WeakSet === "function") ? new WeakSet() : null;
  function isDone(o) { return done ? done.has(o) : !!(o && o._airImpactDone); }
  function markDone(o) {
    if (!o) return;
    if (done) { try { done.add(o); return; } catch (e) {} }
    try { o._airImpactDone = true; } catch (e) {}
  }

  function touch(obj, grp, pos, byPlayer) {
    if (!obj || !pos || isDone(obj)) return null;
    let s = samples.get(obj);
    if (!s) {
      const dims = dimsFor(obj, grp);
      s = {
        obj: obj, group: grp || obj.group || obj.grp || null, dims: dims,
        cls: classOf(obj, dims), heli: obj.kind === "heli" || obj.airClass === "heli",
        x: pos.x, y: pos.y, z: pos.z, vx: 0, vy: 0, vz: 0, speed: 0,
        heading: obj.heading || 0, byPlayer: !!byPlayer,
        handled: false, idle: 0, stale: 0, seen: 0,
      };
      samples.set(obj, s);
      return s;
    }
    s.idle = 0;
    if (byPlayer) s.byPlayer = true;
    if (grp) s.group = grp;
    return s;
  }

  function resample(s, dt) {
    const obj = s.obj;
    const pos = obj.pos || (s.group && s.group.position);
    if (!pos) return;
    if (dt > 1e-4 && s.seen > 0) {
      s.vx = (pos.x - s.x) / dt; s.vy = (pos.y - s.y) / dt; s.vz = (pos.z - s.z) / dt;
    }
    s.x = pos.x; s.y = pos.y; s.z = pos.z;
    s.seen++;
    if (isFinite(obj.heading)) s.heading = obj.heading;
    else if (s.group && s.group.rotation) s.heading = s.group.rotation.y - (obj.modelYawOffset || 0);
    // The flight model's own airspeed is authoritative where it exists; the
    // finite difference covers every record that only moves a transform.
    // Same max() the flight model's own impact test uses.
    let v = Math.hypot(s.vx, s.vy, s.vz);
    if (isFinite(obj.speed)) v = Math.max(v, obj.speed);
    if (isFinite(obj.airspeed)) v = Math.max(v, obj.airspeed);
    if (isFinite(obj.crashSpd)) v = Math.max(v, obj.crashSpd);
    // A destroyed craft has already been zeroed by its own crash handler; hold
    // the last real reading briefly so the blast wrapper (which fires later in
    // the SAME frame) still sees it.
    if (v < 0.5 && s.speed > 0.5 && s.stale < 0.75) { s.stale += dt; return; }
    s.stale = 0;
    s.speed = v;
  }

  // A tracked airframe is DYING when its own system has condemned it. Only a
  // dying airframe can claim a blast — a rocket going off beside a healthy
  // gunship must never read as a crash.
  function dying(s) {
    const o = s.obj;
    if (o.destroyed || o.downed) return true;
    const g = s.group;
    if (!g || !g.parent) return true;
    return false;
  }

  function collect() {
    const P = CBZ.player;
    if (P && P._aircraft) {
      const c = P._aircraft;
      touch(c, c.group, c.pos, true);
    }
    if (CBZ.cityAircraftEnumTargets) {
      try { CBZ.cityAircraftEnumTargets(function (c) { if (c) touch(c, c.group, c.pos, false); }); } catch (e) {}
    }
    if (CBZ.cityAirTrafficList) {
      try {
        const fleet = CBZ.cityAirTrafficList() || [];
        for (let i = 0; i < fleet.length; i++) {
          const t = fleet[i];
          if (t && t.grp) touch(t, t.grp, t.grp.position, false);
        }
      } catch (e) {}
    }
  }

  function stepTracker(dt) {
    collect();
    samples.forEach(function (s, k) {
      s.idle += dt;
      resample(s, dt);
      // SAFETY NET for the owner's case: if the player's craft was condemned
      // and no blast ever claimed it (a crash path with no explosion, or a
      // missing crashfx), run the catastrophe from the tracked point anyway
      // rather than silently doing nothing.
      if (!s.handled && s.byPlayer && s.obj.destroyed) {
        s.dead = (s.dead || 0) + dt;
        if (s.dead > 0.2) { try { impactFrom(s, s.x, s.y, s.z, null); } catch (e) {} }
      }
      if (s.handled || s.idle > SAMPLE_TTL) samples.delete(k);
    });
  }
  A.tracked = function () { return samples.size; };

  /* ============================================================
     WHAT DID IT HIT?
     The same façade test playeraircraft.js's crashCraft uses (an AABB that
     contains the point and is more than 2.5 m tall, excluding anything that is
     itself an aircraft). Twelve lines of box arithmetic — not a system worth
     importing, and duplicating the PREDICATE keeps this file from depending on
     a private function in a read-only file.
     ============================================================ */
  function isAircraftCollider(c) {
    let o = c && c.ref;
    while (o) {
      if (o.userData && (o.userData.aircraftDims || o.userData.hijackable || o.userData.craft)) return true;
      o = o.parent;
    }
    return false;
  }
  function facadeAt(x, y, z) {
    const cols = CBZ.colliders || [];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      const y0 = c.y0 != null ? c.y0 : 0, y1 = c.y1 != null ? c.y1 : 18;
      if (y1 - y0 <= 2.5) continue;                    // kerbs / road slabs
      if (y < y0 - 1.2 || y > y1) continue;
      if (isAircraftCollider(c)) continue;
      return c;
    }
    return null;
  }
  A.facadeAt = facadeAt;

  /* ============================================================
     THE FX COMPOSER — registered into the ordnance bus by name.

     systems/impactbus.js exposes exactly two extension points and we use both,
     with ZERO edits to it:
       CBZ.impact.fx("aircrash", fn)     register a composer
       CBZ.impact.define(id, spec)       re-point the three crash rows at it
     Everything else about those rows (power / radius / struct / pen / fire /
     wave / quake) is carried forward untouched, so the numbers the bus was
     tuned with keep their meaning and a future `CBZ.detonate(x,y,z,
     "crashAirliner")` from a mission gets this whole read for free.

     `opts.entryDrawn` is set when the crash path we intercepted has ALREADY
     drawn its own fireball (every one of them does). Then we draw only the
     beats that were missing. Without it — a direct detonate() caller — the
     composer draws the fireball itself.
     ============================================================ */
  // Which composer the row used BEFORE we re-pointed it at ours. Re-pointing
  // `fx` must not silently downgrade crashJet/crashAirliner from the heavy
  // composer to the plain one — the fireball a direct detonate() caller gets
  // has to stay byte-for-byte what the bus's own table asked for.
  const BASE_FX = Object.create(null);
  function drawFireball(x, y, z, row, opts) {
    const want = BASE_FX[row.id] || row.fx;
    const fn = (want === "heavy" && CBZ.cityAirstrikeExplosion)
      ? CBZ.cityAirstrikeExplosion : (CBZ.cityExplosion || CBZ.cityAirstrikeExplosion);
    if (!fn) return;
    try {
      fn(x, z, {
        power: row.power * (opts.scale || 1), radius: row.radius, y: y,
        byPlayer: !!opts.byPlayer, noDamage: !!opts.noDamage,
        ordnance: row.id, _impact: true, _airImpact: true,
      });
    } catch (e) {}
  }

  // ---- the wound that keeps smoking -------------------------------------
  // crashfx's cityWallRuin composes the whole facade-wound read in one call
  // (avalanche + rubble heap + dangling rebar + soot ring + dust sheet) AND
  // registers a blast wound that smokes for 60-90 s. cityHeavyWallRuin is the
  // same thing at heavy-ordnance scale. That "it is still smoking a minute
  // later" is the beat the owner is missing; it is one call.
  function woundBeat(x, y, z, nx, nz, power, width) {
    const fn = (power >= 2 && CBZ.cityHeavyWallRuin) ? CBZ.cityHeavyWallRuin : CBZ.cityWallRuin;
    if (!fn) return;
    try {
      fn(x, y, z, nx, nz, {
        power: Math.min(2.4, power), width: width,
        top: y + width * 0.55, bottom: Math.max(0, y - width * 0.55),
      });
    } catch (e) {}
  }

  /* ---- the EJECTA CONE ---------------------------------------------------
     Spall thrown DOWNRANGE along the travel axis. Seated at three depths
     inside the wound from the penetration curve E(x) = E0 e^(-x/lambda): the
     mouth, one e-fold in, and two. Each seat throws less than the last,
     because that is what the energy left there is. Debris rides
     CBZ.cityChunk (buildings.js, capped at 60) — no new pool.
     lambda 2.4 m is the same e-fold city/structural.js's penetration model
     uses, so the two agree about how deep the airframe got.
  ------------------------------------------------------------------------ */
  const LAMBDA = 2.4;
  function ejectaCone(x, y, z, nx, nz, pen, scale, hot) {
    if (!CBZ.cityChunk) return;
    // chips of the wall that was struck, in its own colour
    const wc = wallNear(x, y, z);
    const wm = wc && wc.ref ? wc.ref.material : null;
    const depth = LAMBDA * Math.log(1 + Math.max(0.2, pen));
    const seats = qi(1, 3);
    for (let i = 0; i < seats; i++) {
      const f = seats <= 1 ? 0.25 : i / (seats - 1);
      const dd = depth * f;
      const carried = Math.exp(-dd / LAMBDA);            // energy still moving at this depth
      const n = qi(3, 9) * Math.min(2, scale) * carried;
      if (n < 1) continue;
      // spread the cone: the deeper seats fan wider (the airframe is breaking up)
      const spread = 0.25 + f * 0.55;
      const a = (Math.random() - 0.5) * spread;
      const ca = Math.cos(a), sa = Math.sin(a);
      try {
        CBZ.cityChunk(x + nx * dd, y + (Math.random() - 0.35) * 1.6, z + nz * dd, {
          count: Math.round(n),
          force: (6 + 9 * carried) * Math.min(1.8, scale),
          dirx: nx * ca - nz * sa, dirz: nx * sa + nz * ca,
          material: wm, color: wm ? undefined : 0x747b82,
        });
      } catch (e) {}
    }
    if (CBZ.cityDustKick) {
      try { CBZ.cityDustKick(x + nx * depth * 0.5, y, z + nz * depth * 0.5, 1.2 + scale); } catch (e) {}
    }
  }

  /* ---- CONTENTS / PAPER ---------------------------------------------------
     The research flags this as THE signature read of a real high-floor strike:
     a slow, wide, long-lived snow of office contents. It is also the cheapest
     thing in this file.

     NO NEW POOL: these are thin sheets on ONE shared geometry and ONE shared
     material (they are the building's contents, not invented rubble), handed
     to CBZ.cityDebrisAdopt, i.e. the shared CBZ.debris rigid-body sim. The
     material is tagged as a light, high-drag kind so a sheet drifts instead
     of dropping like a brick, lands, and lies around the block afterwards.
     Wide + slow is a big lateral kick and almost no vertical one.
  ------------------------------------------------------------------------ */
  let paperGeo = null, paperMat = null;
  function ensurePaper() {
    if (paperGeo) return true;
    if (!window.THREE) return false;
    try {
      paperGeo = new THREE.PlaneGeometry(0.34, 0.44);
      paperGeo._shared = true;
      paperMat = new THREE.MeshLambertMaterial({ color: 0xe6e2d6, side: THREE.DoubleSide });
      paperMat._shared = true;
      // paper has leaf physics (light, all drag), not concrete's
      paperMat.userData.debrisKind = "foliage";
    } catch (e) { paperGeo = null; return false; }
    return true;
  }
  function contentsFlutter(x, y, z, nx, nz, scale) {
    if (!CBZ.cityDebrisAdopt || y < 4) return;         // only reads from a height
    if (!ensurePaper()) return;
    // the live-body budget is shared with the building's own pieces
    const n = qi(2, 10) * Math.min(1.6, scale);
    for (let i = 0; i < n; i++) {
      let m;
      try { m = new THREE.Mesh(paperGeo, paperMat); } catch (e) { return; }
      m.position.set(x + (Math.random() - 0.5) * 3.4, y + (Math.random() - 0.5) * 4.5, z + (Math.random() - 0.5) * 3.4);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      // wide + sideways, barely any lift: a sheet of paper has no ballistics,
      // it just gets pushed out of the hole and then wanders down
      const a = Math.random() * 6.2832, sp = 2.5 + Math.random() * 6;
      const vx = nx * (3 + Math.random() * 7) + Math.cos(a) * sp;
      const vz = nz * (3 + Math.random() * 7) + Math.sin(a) * sp;
      try { CBZ.cityDebrisAdopt(m, vx, 0.4 + Math.random() * 1.6, vz); } catch (e) {}
    }
  }

  function fxAircrash(x, y, z, row, opts) {
    opts = opts || {};
    const scale = opts.scale || 1;
    let nx = opts.dirx || 0, nz = opts.dirz || 0;
    const nl = Math.hypot(nx, nz);
    if (nl > 1e-3) { nx /= nl; nz /= nl; } else { nx = 0; nz = 1; }

    if (!opts.entryDrawn) drawFireball(x, y, z, row, opts);
    if (opts.noDamage) return;
    // a foreign caller (a mission scripting a strike) never passes `building`
    const building = opts.building != null ? !!opts.building : !!facadeAt(x, y, z);

    // Glass out for the floors AROUND the wound, not just at it. cityShatter is
    // an XZ radius over every pane at any height, which is exactly the read we
    // want: a column of blown windows up and down the struck face.
    if (CBZ.cityShatter) {
      try { CBZ.cityShatter(x, z, (row.radius + 6) * Math.min(1.6, scale)); } catch (e) {}
    }
    ejectaCone(x, y, z, nx, nz, row.pen, scale, row.fire > 0.3);
    contentsFlutter(x, y, z, nx, nz, scale);
    if (building) {
      // the wound normal faces BACK out of the hole, toward where the plane
      // came from — that is the face the avalanche/rubble/rebar hangs off
      woundBeat(x, y, z, -nx, -nz, 1.2 + scale * 0.9, 2.6 + scale * 2.6);
    }
    // the fuel plume standing in the hole
    if (CBZ.cityCrashSmoke) {
      const puffs = qi(1, 4);
      for (let i = 0; i < puffs; i++) {
        try { CBZ.cityCrashSmoke(x + (Math.random() - 0.5) * 3, y + Math.random() * 3, z + (Math.random() - 0.5) * 3); } catch (e) {}
      }
    }
  }

  // Register the composer and re-point the three crash rows at it. Lazy +
  // idempotent: systems/impactbus.js may not have run yet in a partial load.
  let rowsWired = false;
  function wireRows() {
    if (rowsWired || !CBZ.impact || !CBZ.impact.fx || !CBZ.impact.define) return;
    try {
      CBZ.impact.fx("aircrash", fxAircrash);
      const ids = ["crashSmall", "crashJet", "crashAirliner"];
      for (let i = 0; i < ids.length; i++) {
        const base = CBZ.impact.row(ids[i]);
        if (!base || base.fx === "aircrash") continue;
        BASE_FX[ids[i]] = base.fx;
        const spec = Object.assign({}, base);
        spec.fx = "aircrash";
        delete spec.id;
        CBZ.impact.define(ids[i], spec);
      }
      rowsWired = true;
    } catch (e) { rowsWired = true; }   // never retry-loop a broken bus
  }

  /* ============================================================
     THE WRECK FIELD — whole airframe SECTIONS, as rigid bodies.

     A sheared wing, a tail, a torn panel: the aircraft's OWN meshes, handed
     whole to CBZ.debris (the one rigid-body sim), so they tumble, land on
     the real ground and on the rubble, and freeze into the wreck field that
     stays on the street. This file used to fly them on its own closed-form
     arcs and pad the field with invented grey boxes; both are gone.

     What stays here is what only this file knows about a falling piece of
     an airliner: it can be BURNING (a fuel smoke trail follows it down) and
     it can be a HAZARD (it kills whoever is under it when it lands). Each
     adopted body is tracked for exactly that, until it comes to rest.
     Tracking is hard-capped at qScale(4, 16); over the cap the FARTHEST
     record simply stops being tracked (the piece itself stays real).
     ============================================================ */
  const hulks = [];
  const TRACK_MAX = 12;                 // seconds a piece can stay "falling" for our purposes
  function hulkCap() { return Math.max(3, qi(4, 16)); }

  function evictHulk() {
    let idx = 0, bd = -1;
    for (let i = 0; i < hulks.length; i++) {
      const d = camDist(hulks[i].x, hulks[i].z);
      if (d > bd) { bd = d; idx = i; }
    }
    hulks.splice(idx, 1);
  }
  // Track one debris body (a mesh CBZ.debris returned) for smoke + hazard.
  function track(body, opts) {
    if (!body) return;
    while (hulks.length >= hulkCap()) evictHulk();
    const p = body.position;
    hulks.push({
      body: body, x: p.x, y: p.y, z: p.z, gy: floorAt(p.x, p.z), t: 0, still: 0,
      burning: !!opts.burning, smokeT: 0,
      hazard: !!opts.hazard && !!CBZ.CONFIG.AIR_IMPACT_DEBRIS_HAZARD,
      dmg: opts.dmg || 0, by: opts.by || null, byPlayer: !!opts.byPlayer, hurtT: 0,
    });
  }

  /* PUBLIC: adopt an airframe section into the wreck field.
     city/crashdeform.js calls this when it shears a wing or a tail off; any
     caller may. The mesh is handed WHOLE to CBZ.debris (its own geometry and
     paint become the rigid body; the original is removed).
       mesh  posed in WORLD space (parent it to the arena root first)
       opts  { spin, burning, hazard, dmg, by, byPlayer, own } */
  CBZ.cityWreckDebris = A.debris = function (mesh, vx, vy, vz, opts) {
    if (!mesh || !inWorld() || !CBZ.debris) return false;
    opts = opts || {};
    const spin = opts.spin || (Math.random() - 0.5) * 5;
    let r = null;
    try {
      mesh.updateWorldMatrix(true, true);
      r = CBZ.debris.adopt(mesh, {
        velocity: new THREE.Vector3(vx || 0, vy || 0, vz || 0),
        angular: new THREE.Vector3(spin, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 3.5),
        owner: "wreck",
      });
    } catch (e) {}
    // the body is a copy of the mesh's own geometry; the original goes
    try {
      if (mesh.parent) mesh.parent.remove(mesh);
      if (opts.own) mesh.traverse(function (o) { if (o.geometry && !o.geometry._shared && o.geometry.dispose) o.geometry.dispose(); });
    } catch (e) {}
    if (!r || !r.bodies || !r.bodies.length) return false;
    for (const b of r.bodies) track(b, opts);
    return true;
  };
  A.wreckCount = function () { return hulks.length; };

  // A heavy piece falling past a person kills them. Cheap because it is only
  // evaluated in the last few metres of the arc — that is the only altitude
  // band where anybody is standing — and only at 10 Hz.
  const HAZ_R = 2.2;
  function hazardSweep(h, dt) {
    if (!h.hazard || h.y - h.gy > 7) return;
    h.hurtT -= dt;
    if (h.hurtT > 0) return;
    h.hurtT = 0.1;
    const cause = "crushed by falling debris";
    if (!inCity()) {
      const SV = CBZ.surv;
      if (SV && SV.forEachActor && SV.hurt) {
        try {
          SV.forEachActor(function (a) {
            if (!a || a.dead || !a.pos) return;
            if (Math.abs(a.pos.x - h.x) > HAZ_R || Math.abs(a.pos.z - h.z) > HAZ_R || Math.abs(a.pos.y - h.y) > 3.5) return;
            SV.hurt(a, Math.max(35, h.dmg), { fromX: h.x, fromZ: h.z, fromY: h.y, force: 9, fling: 4, cause: cause });
          });
        } catch (e) {}
      }
      return;
    }
    try {
      if (CBZ.crowds && CBZ.crowds.crush) CBZ.crowds.crush(h.x, h.z, HAZ_R, { cause: cause, byPlayer: !!h.byPlayer });
    } catch (e) {}
    try {
      const peds = CBZ.cityPeds || [];
      for (let i = 0; i < peds.length; i++) {
        const p = peds[i];
        if (!p || p.dead || !p.pos) continue;
        if (Math.abs(p.pos.x - h.x) > HAZ_R || Math.abs(p.pos.z - h.z) > HAZ_R) continue;
        if (Math.abs(p.pos.y - h.y) > 3.5) continue;
        if (CBZ.cityKillPed) {
          CBZ.cityKillPed(p, { fromX: h.x, fromZ: h.z, force: 9, fling: 4, byPlayer: h.byPlayer }, cause);
        }
      }
    } catch (e) {}
    try {
      const PL = CBZ.player;
      if (PL && !PL.dead && PL.pos && CBZ.cityHurtPlayer &&
          Math.abs(PL.pos.x - h.x) < HAZ_R && Math.abs(PL.pos.z - h.z) < HAZ_R &&
          Math.abs(PL.pos.y - h.y) < 3.5) {
        CBZ.cityHurtPlayer(Math.max(35, h.dmg), h.x, h.z, "crushed by falling debris", false, null, false);
      }
    } catch (e) {}
  }

  // Follow each tracked body until it rests (or the sim froze it into the
  // rubble, which removes the live mesh): smoke while it falls, hazard in the
  // last few metres and once more on landing.
  function stepHulks(dt) {
    for (let i = hulks.length - 1; i >= 0; i--) {
      const h = hulks[i];
      const m = h.body;
      h.t += dt;
      const alive = m && m.parent && m.visible !== false;
      if (alive) {
        const p = m.position;
        const moved = Math.abs(p.x - h.x) + Math.abs(p.y - h.y) + Math.abs(p.z - h.z);
        h.x = p.x; h.y = p.y; h.z = p.z;
        h.gy = floorAt(h.x, h.z);
        h.still = moved < 0.02 ? h.still + dt : 0;
      }
      if (h.burning && alive && CBZ.cityCrashSmoke) {
        h.smokeT -= dt;
        if (h.smokeT <= 0) {
          h.smokeT = 0.1;
          if (camDist(h.x, h.z) < (CBZ.cityCullRadius || 320)) {
            try { CBZ.cityCrashSmoke(h.x, h.y, h.z); } catch (e) {}
          }
        }
      }
      hazardSweep(h, dt);
      if (!alive || h.still > 0.4 || h.t > TRACK_MAX) {
        h.hurtT = 0; hazardSweep(h, 1);                  // the landing itself
        hulks.splice(i, 1);
      }
    }
  }

  /* ============================================================
     THE CARTWHEEL — angular-momentum decay on the hulk after a GROUND impact.
     A wreck that stops dead the frame it lands reads as a prop; a wreck that
     keeps rolling over for two seconds and settles reads as mass. Three
     decaying rates on a transform, nothing else. Never applied to a building
     strike (a hull lodged in a facade must stay lodged) and never to a group
     something else is animating.
     ============================================================ */
  const tumbles = [];
  function addTumble(grp, rx, ry, rz, dur) {
    if (!CBZ.CONFIG.AIR_IMPACT_TUMBLE || !grp) return;
    if (tumbles.length >= 4) tumbles.shift();
    tumbles.push({ grp: grp, rx: rx, ry: ry, rz: rz, t: 0, dur: dur });
  }
  function stepTumbles(dt) {
    for (let i = tumbles.length - 1; i >= 0; i--) {
      const q = tumbles[i];
      q.t += dt;
      if (!q.grp || !q.grp.parent || q.t >= q.dur) { tumbles.splice(i, 1); continue; }
      // exponential angular-momentum decay: k falls off as the hull grinds down
      const k = 1 - q.t / q.dur;
      const d = k * k * dt;
      q.grp.rotation.x += q.rx * d;
      q.grp.rotation.y += q.ry * d;
      q.grp.rotation.z += q.rz * d;
    }
  }

  /* ============================================================
     THE IMPACT ITSELF.
     One call into the ordnance bus does penetration + floorplate spread + exit
     plume + fire + blast wave + the ledger; one call into crashdeform does the
     airframe. Everything else here is bookkeeping.
     ============================================================ */
  function impactFrom(s, x, y, z, blastOpts) {
    if (s.handled || isDone(s.obj)) return null;
    s.handled = true;
    markDone(s.obj);
    if (!CBZ.CONFIG.AIR_IMPACT_V1 || !inWorld()) return null;
    const city = inCity();

    const v = s.speed;
    // travel direction: velocity first (it is what actually hit), heading as
    // the fallback for records that only carry an attitude.
    let dx = s.vx, dz = s.vz;
    let dl = Math.hypot(dx, dz);
    if (dl < 0.5) { dx = Math.sin(s.heading || 0); dz = Math.cos(s.heading || 0); dl = 1; }
    dx /= dl; dz /= dl;

    const grp = s.group;
    // WHAT WAS HIT is known by whoever detected the contact (the airframe
    // sweep in playeraircraft.js, airtraffic.js, systems/airline.js, all via
    // city/airspace.js): a live collider or a far building RECORD, which has
    // no collider at all. Only a caller with no hit falls back to asking the
    // collider set.
    // The detector's own verdict is NOT trusted on its own: a tower is
    // registered as storey-high wall pieces and 1.3 m floor slabs, so a jet
    // that met a slab at the 30th floor was handed over as "not a building"
    // (the slab is under the 2.5 m tall-collider bar) and got the ground
    // crash: no hole, no fire, no ledger. What was hit is decided HERE, from
    // the point, against the buildings themselves (A.buildingAt).
    const hit0 = s.hit || (s.obj && s.obj._airHit) || null;
    const where = A.buildingAt(x, y, z, hit0);
    const building = !!where || !!(hit0 && hit0.building && hit0.collider && tallCollider(hit0.collider));
    const hit = where ? Object.assign({}, hit0 || {}, { lot: where.lot, rec: where.rec, isle: where.isle, building: true }) : hit0;
    // A NaN speed from a half-initialised record must not poison the kinetic
    // arithmetic downstream. (The bus degrades a non-finite energy to
    // multiplier 1 rather than NaN, so this is belt-and-braces — but a NaN
    // reaching CBZ.detonate's position arguments is not recoverable, and the
    // cheapest place to stop it is where it is first read.)
    const vImp = Math.max(isFinite(v) ? v : 0, 8);
    // What actually hit, in kilograms and metres per second. The ordnance bus
    // prices it (THE KINETIC LAW); this file no longer owns a damage curve.
    const mass = massOf(s.cls, s.dims);
    // FRONTAL WIDTH: what the airframe presents to the facade. A shallow dive
    // drives the wings in flat, so the SPAN is the cut; a near-vertical plunge
    // presents the fuselage only. Interpolate on the dive angle rather than
    // always claiming the full wingspan, which would let a nose-first plummet
    // sever a floor it barely touched.
    const dive = Math.min(1, Math.abs(s.vy || 0) / Math.max(1, vImp));
    const frontal = s.dims.span * (1 - dive * 0.8) + s.dims.fuselage * dive * 0.8;
    const scale = energyScale(s.cls, s.dims, vImp);

    // A TAXI BUMP IS NOT A STRIKE. Below the flight model's own catastrophic
    // threshold we do the airframe damage and nothing else — no penetration,
    // no structural hit, no fire. This is the gate that keeps a parking
    // scrape from gutting a shopfront.
    const strike = v >= minSpeed(s);

    if (strike) {
      const kind = ROW[s.cls] || "crashSmall";
      if (!city) {
        // off the city the crash path has already detonated through the
        // mode's own blast route (playeraircraft.js crashCraft); a direct
        // caller with no blast gets that same one here
        if (!blastOpts && CBZ.detonate) { try { CBZ.detonate(x, y, z, "missile", { scale: s.cls === "airliner" ? 1.3 : 0.7 }); } catch (e) {} }
      } else if (CBZ.detonate) {
        try {
          CBZ.detonate(x, y, z, kind, {
            by: s.byPlayer ? CBZ.player : null,
            byPlayer: s.byPlayer,
            // THE KINETIC LAW. No `scale` here any more: mass and speed ARE
            // the scale, and the bus is the one place that turns them into
            // one. `frontal` is what makes this a plane and not a warhead.
            mass: mass, speed: vImp, frontal: frontal,
            dirx: dx, dirz: dz,
            entryDrawn: !!blastOpts,        // the crash path already drew a fireball
            building: building,
            // the struck building, so the ledger books the hit on IT (and
            // never on the nearest downtown lot to a tower it cannot see)
            lot: (hit && hit.lot) || undefined,
            _airImpact: true,
          });
        } catch (e) {}
      } else {
        // DEGRADE-SAFE: no bus loaded => draw the beats we own directly, which
        // is still strictly more than the legacy path did.
        try { fxAircrash(x, y, z, { id: "crashSmall", power: 2, radius: 10, pen: 6, fire: 0.5, fx: "aircrash" }, { scale: scale, dirx: dx, dirz: dz, entryDrawn: !!blastOpts, building: building, byPlayer: s.byPlayer }); } catch (e) {}
      }

      // FALLING DEBRIS off a wounded high floor. Only from a real height —
      // debris off a shopfront is just the ejecta cone, already drawn.
      if (building && y > 12) shedHighDebris(s, x, y, z, dx, dz, scale);

      // THE BUILDING TAKES THE AIRFRAME (see BUILDING STRIKE below): the
      // collapse system carves the hole the fuselage and wings cut, the fuel
      // burns the struck floors, the people on them die.
      if (building) {
        if (hit && hit.isle) { try { isleStrike(s, x, y, z, dx, dz, vImp, mass, hit.isle); } catch (e) {} }
        else if (city) { try { buildingStrike(s, x, y, z, dx, dz, vImp, mass, hit); } catch (e) {} }
      }
      else { try { killZone(x, y, z, Math.max(6, s.dims.span * 0.6), s, "plane crash"); } catch (e) {} }
    }

    // THE AIRFRAME'S OWN END — city/crashdeform.js, extended from cars to
    // aircraft. Feature-detected: if crashdeform is absent (or headless with a
    // stub renderer) the whole beat silently skips.
    if (CBZ.CONFIG.AIR_IMPACT_DEFORM && CBZ.cityAircraftImpactDeform) {
      try {
        CBZ.cityAircraftImpactDeform(s.obj, { x: x, y: y, z: z },
          { x: dx, y: Math.max(-1, Math.min(1, s.vy / Math.max(1, v))), z: dz },
          Math.min(60, v), {
            dims: s.dims, cls: s.cls, scale: scale, building: building,
            byPlayer: s.byPlayer, group: grp,
          });
      } catch (e) {}
    }

    // THE AIRFRAME COMES APART IN THE BUILDING. What the deformation left of
    // the hull (fuselage, engines, the other wing) is handed to the one
    // rigid-body sim as pieces of itself, carrying what is left of the
    // airframe's momentum on into the wound and down the face. A lodged,
    // whole hull hanging off a tower was the "toy plane" read.
    if (strike && building && grp) { try { breakUp(s, grp, dx, dz, vImp); } catch (e) {} }

    // The cartwheel is a GROUND-impact beat only.
    if (strike && !building && grp) {
      const spinK = Math.min(1, v / 60);
      addTumble(grp, (Math.random() - 0.5) * 2.4 * spinK, (Math.random() - 0.5) * 3.2 * spinK,
        (0.8 + Math.random() * 2.2) * spinK, 1.6 + spinK * 1.6);
    }
    // `strike` reports whether the speed gate actually passed, i.e. whether we
    // priced this event through the ordnance bus. onBlast needs it to decide
    // whether to claim the carrying blast (see the _airImpact tag there): a
    // sub-threshold taxi bump was never priced by us and must keep its normal
    // legacy accounting.
    return { x: x, y: y, z: z, cls: s.cls, scale: scale, speed: v, building: building, strike: strike };
  }

  /* THE STRUCK FLOOR'S OWN EDGE. What falls off a wounded high floor is that
     floor: the slab edge and the facade band the airframe tore through, in
     the struck wall's own material (read off the wall collider's mesh), cut
     into pieces by CBZ.debris and thrown out of the hole and down. They are
     real rigid bodies, and while they fall they are tracked as a hazard: a
     slab off the 30th floor kills whoever it lands on. (This used to mint
     1-10 `new THREE.BoxGeometry` lumps in one brown-grey.) */
  function shedHighDebris(s, x, y, z, dx, dz, scale) {
    if (!CBZ.debris) return;
    const c = wallNear(x, y, z);
    let mat = c && c.ref && c.ref.material;
    if (!mat) return;
    // the shell course under a facade skin is never seen: the pieces wear the
    // skin of the struck face (buildings.js CBZ.citySkin)
    const bld = c.ref.parent && c.ref.parent.userData && c.ref.parent.userData.bld;
    if (bld && CBZ.cityIsShellMat && CBZ.citySkin && CBZ.cityIsShellMat(bld, mat)) {
      const sk = CBZ.citySkin(bld, x, z);
      if (sk) mat = sk;
    }
    // a band of that floor, standing just proud of the face it came out of
    const along = 1.6 + Math.min(2.6, scale * 1.4);
    const tx = Math.abs(dz), tz = Math.abs(dx);          // horizontal, across the travel
    const box = {
      minX: x - tx * along - 0.35, maxX: x + tx * along + 0.35,
      minY: y - 0.9, maxY: y + 0.35,
      minZ: z - tz * along - 0.35, maxZ: z + tz * along + 0.35,
    };
    const n = Math.min(14, qi(4, 10) * (scale > 1.4 ? 2 : 1));
    let r = null;
    try {
      r = CBZ.debris.shatterBox(box, mat, {
        at: { x: x, y: y, z: z }, dir: { x: dx, y: -0.25, z: dz },
        power: Math.min(2.2, 1 + scale * 0.5), maxPieces: n, owner: "wreck", solid: true,
        velocity: new THREE.Vector3(dx * 3, 0.5, dz * 3),
      });
    } catch (e) {}
    if (!r || !r.bodies) return;
    for (const body of r.bodies) {
      track(body, { hazard: true, dmg: 55, by: s.byPlayer ? CBZ.player : null, byPlayer: s.byPlayer });
    }
  }
  // The building wall at an impact seat: the facade collider containing the
  // point, else the nearest tall collider face within 3 m that has a mesh.
  function wallNear(x, y, z) {
    const c0 = facadeAt(x, y, z);
    if (c0 && c0.ref && c0.ref.material && !c0.ref.material.transparent) return c0;
    const cols = CBZ.colliders || [];
    let best = null, bd = 9;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (!c.ref || !c.ref.material || c.ref.material.transparent) continue;
      const y0 = c.y0 != null ? c.y0 : 0, y1 = c.y1 != null ? c.y1 : 18;
      if (y1 - y0 <= 1.6 || y < y0 - 1.2 || y > y1 + 1.2) continue;
      if (isAircraftCollider(c)) continue;
      const sx = Math.max(c.minX, Math.min(c.maxX, x)), sz = Math.max(c.minZ, Math.min(c.maxZ, z));
      const d = (x - sx) * (x - sx) + (z - sz) * (z - sz);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  function tallCollider(c) {
    return !!c && ((c.y1 == null ? 18 : c.y1) - (c.y0 || 0)) > 2.5 && !isAircraftCollider(c);
  }

  /* ============================================================
     BUILDING STRIKE — what the building does with an airframe in it.

     The ordnance bus (above) already priced the hit for the structural
     ledger: penetration, the severed floor width, the fire automaton, the
     load path. What it never did was touch the BUILDING ITSELF: the
     ledger's numbers changed, the facade got a wound dressing, and the
     tower stood there with no hole in it until the ledger condemned it.
     This is the rest of the sequence, through the shared systems only:

       THE CARVE   CBZ.collapse.damage — the one structural model — at the
                   seats the airframe actually cut: the fuselage at the
                   face, both wings either side of it, and the deepest point
                   the wreck reached (the penetration e-fold, the same
                   LAMBDA structural.js uses). Chunks inside each seat lose
                   integrity by energy/toughness; the ones that reach zero
                   are blown INTO the building along the travel axis as
                   pieces of themselves (the plane's momentum, carried), and
                   the load path decides what that leaves hanging.
       THE ENERGY  in megajoules, collapse.js's unit: the airframe's kinetic
                   energy plus the share of its fuel's chemical energy that
                   does structural work (most of it is the fireball). An
                   A320-class hull at 130 m/s: ~610 MJ kinetic + ~940 MJ
                   coupled fuel = ~1,550 MJ. A Cessna at 40 m/s: ~15 MJ —
                   less than a car bomb, which is what it is.
       THE FIRE    the struck floor and the floors either side (an airliner
                   two each way) are lit on the structural ledger, whose
                   fire automaton spreads, heats and weakens them; enough
                   of that and the load path fails later. Fuel fireballs
                   roll out of the entry face and, for a big airframe, out
                   of the far side.
       THE PEOPLE  everyone on the struck floors inside the cut dies, through
                   the kill bus (peds, the player if he is standing there,
                   the crowd at street level for a low strike).
     ============================================================ */
  const FUEL_FRAC = { small: 0.18, jet: 0.30, airliner: 0.25 };   // fuel as a share of the airframe's mass
  const FUEL_MJ_KG = 43;                                          // jet A / avgas
  const FUEL_COUPLE = 0.0012;                                     // share of that chemical energy doing structural work
  function strikeMJ(cls, mass, v) {
    return 0.5 * mass * v * v / 1e6 + mass * (FUEL_FRAC[cls] || 0.2) * FUEL_MJ_KG * FUEL_COUPLE;
  }
  A.energyMJ = function (cls, dims, v) {
    cls = okCls(cls);
    return strikeMJ(cls, massOf(cls, dims ? normDims(dims) : DEF_DIMS[cls]), v);
  };
  function strikeLot(x, z, hit) {
    if (hit && hit.lot) return hit.lot;
    if (hit && hit.rec && hit.rec.lot) return hit.rec.lot;
    const S = CBZ.structure;
    return S && S.lotAt ? S.lotAt(x, z, 6) : null;
  }
  function fuelBall(x, y, z, radius, power, byPlayer) {
    const fn = CBZ.cityAirstrikeExplosion || CBZ.cityExplosion;
    if (!fn) return;
    try {
      // noDamage: the strike was priced once, above; this is the fuel burning
      fn(x, z, { power: power, radius: radius, y: y, byPlayer: !!byPlayer, noDamage: true,
                 _impact: true, _airImpact: true, kind: "fuel" });
    } catch (e) {}
  }
  // THE CUT the airframe makes in a building, through the one collapse
  // model: the fuselage at the face, both wings either side of it, and the
  // deepest point the wreck reached — all at the height it actually hit.
  // `bld` is anything CBZ.collapse.damage takes (a Gang City record, an
  // island building record).
  function carveSeats(bld, s, x, y, z, dx, dz, E, depth) {
    if (!bld || !CBZ.collapse || !CBZ.collapse.damage) return 0;
    const d = s.dims;
    let carved = 0;
    const rx = -dz, rz = dx;
    const Rc = Math.max(2.2, d.height * 0.45 + 1);
    const Rw = Math.max(1.6, d.span * 0.14);
    const wing = d.span * 0.32;
    const dir = { x: dx, y: -0.1, z: dz };
    // [depth into the face, offset across it, radius, share of E]
    const seats = [[0.6, 0, Rc, 0.38], [0.6, wing, Rw, 0.16], [0.6, -wing, Rw, 0.16], [Math.max(1.2, depth), 0, Rc * 0.85, 0.30]];
    for (let i = 0; i < seats.length; i++) {
      const q = seats[i];
      if (q[1] && Math.abs(q[1]) < 1.2) continue;           // a light single's wings are the fuselage seat
      const p = { x: x + dx * q[0] + rx * q[1], y: y - (q[1] ? 0.3 : 0), z: z + dz * q[0] + rz * q[1] };
      try { if (CBZ.collapse.damage(bld, p, q[2], E * q[3], dir)) carved++; } catch (e) {}
    }
    return carved;
  }
  function carveAndBurn(lot, s, x, y, z, dx, dz, E, depth) {
    const cls = s.cls;
    const bld = lot && lot.building;
    const carved = carveSeats(bld, s, x, y, z, dx, dz, E, depth);
    // ---- the struck floors burn
    const S = CBZ.structure;
    if (lot && S && S.ignite) {
      const FH = (bld && bld.FH) || 3.2;
      const f0 = Math.max(0, Math.floor((y - 0.2) / FH) || 0);
      const span = cls === "airliner" ? 2 : cls === "jet" ? 1 : 0;
      for (let k = -span; k <= span; k++) { try { S.ignite(lot, f0 + k); } catch (e) {} }
    }
    return carved;
  }
  function buildingStrike(s, x, y, z, dx, dz, v, mass, hit) {
    const d = s.dims, cls = s.cls;
    const E = strikeMJ(cls, mass, v);
    const lot = strikeLot(x, z, hit);
    const bld = lot && lot.building;
    const row = CBZ.impact && CBZ.impact.row ? CBZ.impact.row(ROW[cls] || "crashSmall") : null;
    const pen = row && row.pen > 0 ? row.pen : (cls === "airliner" ? 26 : cls === "jet" ? 12 : 4);
    let depth = LAMBDA * Math.log(1 + pen);
    // how far through the building the travel axis runs (for the exit fire)
    let through = 0;
    if (bld && bld.w > 0 && bld.d > 0) {
      through = Math.abs(dx) * bld.w + Math.abs(dz) * bld.d;
      depth = Math.min(depth, through * 0.6);
    } else if (hit && hit.rec) {
      through = 2 * (Math.abs(dx) * hit.rec.ex + Math.abs(dz) * hit.rec.ez);
      depth = Math.min(depth, through * 0.6);
    }
    // ---- the carve and the fire: on the real building. A metro building
    // drawn inside a merged tile is PROMOTED to one first (city/
    // metro_promote.js: a real shell, cut out of the tile, a lot in the
    // ledger) and takes the same cut a frame or two later.
    let carved = 0;
    if (lot) carved = carveAndBurn(lot, s, x, y, z, dx, dz, E, depth);
    else if (hit && hit.rec && hit.rec.src === "metro" && CBZ.metroPromote && CBZ.metroPromote.request) {
      CBZ.metroPromote.request(hit.rec, function (plot) { if (plot) { try { carveAndBurn(plot, s, x, y, z, dx, dz, E, depth); } catch (e) {} } });
    }
    // ---- the fuel
    const fuelKg = mass * (FUEL_FRAC[cls] || 0.2);
    if (fuelKg > 120) {
      const R = Math.min(30, 4 + Math.cbrt(fuelKg) * 0.9);
      fuelBall(x - dx * 2.5, y + 1.5, z - dz * 2.5, R * 0.6, Math.min(3.2, 1.2 + R / 18), s.byPlayer);
      // a big airframe's fuel goes THROUGH: the far-side fireball
      if (cls !== "small" && through > 0 && through < 70) {
        fuelBall(x + dx * (through + 3), y + 2, z + dz * (through + 3), R * 0.45, Math.min(2.6, 1 + R / 22), s.byPlayer);
      }
    }
    // ---- the people on those floors
    killZone(x + dx * depth * 0.5, y, z + dz * depth * 0.5,
      Math.max(6, d.span * 0.55 + depth * 0.5), s, "killed in the plane strike",
      ((bld && bld.FH) || 3.2) * (cls === "airliner" ? 2.5 : 1.5) + 2);
    return { energyMJ: E, carved: carved, lot: lot };
  }

  // Everyone inside the cut dies. Horizontal radius R, vertical band vb
  // either side of the impact height. The player is spared only from his
  // OWN crash, where playeraircraft.js's crash path decides his fate.
  function killZone(x, y, z, R, s, cause, vb) {
    vb = vb || 6;
    const by = s.byPlayer ? CBZ.player : null;
    let n = 0;
    if (!inCity()) return isleKillZone(x, y, z, R, s, cause, vb);
    try {
      const peds = CBZ.cityPeds || [];
      for (let i = 0; i < peds.length && n < 40; i++) {
        const p = peds[i];
        if (!p || p.dead || !p.pos) continue;
        const ex = p.pos.x - x, ez = p.pos.z - z;
        if (ex * ex + ez * ez > R * R || Math.abs(p.pos.y - y) > vb) continue;
        if (CBZ.cityKillPed) { CBZ.cityKillPed(p, { fromX: x, fromZ: z, force: 14, fling: 6, byPlayer: !!s.byPlayer, by: by }, cause); n++; }
      }
    } catch (e) {}
    try {
      const P = CBZ.player;
      if (!s.byPlayer && P && !P.dead && P.pos && CBZ.cityHurtPlayer &&
          Math.hypot(P.pos.x - x, P.pos.z - z) < R && Math.abs(P.pos.y - y) < vb) {
        CBZ.cityHurtPlayer(9999, x, z, cause, false, null, false);
      }
    } catch (e) {}
    try {
      if (y - floorAt(x, z) < 8 && CBZ.crowds && CBZ.crowds.crush) CBZ.crowds.crush(x, z, R * 0.7, { cause: cause, byPlayer: !!s.byPlayer });
    } catch (e) {}
    return n;
  }

  // The island's people on the struck floors: the mode's own kill bus
  // (CBZ.surv), held to the same vertical band. The player in the cockpit is
  // the crash path's business, as in the city.
  function isleKillZone(x, y, z, R, s, cause, vb) {
    const SV = CBZ.surv;
    if (!SV || !SV.forEachActor || !SV.hurt) return 0;
    let n = 0;
    try {
      SV.forEachActor(function (a) {
        if (!a || a.dead || !a.pos || n >= 40) return;
        if (a.isPlayer && s.byPlayer) return;
        const ex = a.pos.x - x, ez = a.pos.z - z;
        if (ex * ex + ez * ez > R * R || Math.abs(a.pos.y - y) > vb) return;
        SV.hurt(a, 1e6, { fromX: x, fromZ: z, fromY: y, fling: 6, force: 14, cause: cause, lethal: true });
        n++;
      });
    } catch (e) {}
    return n;
  }

  /* ============================================================
     WHAT BUILDING IS AT THIS POINT — A.buildingAt(x, y, z, hit)

     The one answer to "did this airframe hit a building, and which one",
     asked of the buildings themselves rather than of whichever collider
     happened to be first along the sweep:
       Gang City   the struck far/near record (city/airspace.js: every lot,
                   annex tower and metro building, with its lot when it has
                   one), else the ledger's lot whose footprint holds the
                   point below its roof, else a tall facade collider
       the island  the island building whose footprint (in its own yaw)
                   holds the point between its base and its roof
     Returns { lot, rec, isle } (any may be null) or null for open ground.
     ============================================================ */
  const _recs = [];
  function islandBuildings() {
    const I = CBZ.island;
    if (I && Array.isArray(I.buildings)) return I.buildings;
    const a = CBZ.surv && CBZ.surv.arena;
    return (a && (a.buildings || a.fragile)) || null;
  }
  function islandBuildingAt(x, y, z, pad) {
    const L = islandBuildings();
    if (!L) return null;
    let best = null, bd = 1e9;
    for (let i = 0; i < L.length; i++) {
      const b = L[i];
      if (!b || b.fallen || !b.group) continue;
      const bx = b.ox != null ? b.ox : b.x, bz = b.oz != null ? b.oz : b.z;
      if (!isFinite(bx) || !isFinite(bz)) continue;
      const gy = b.gy || 0, h = b.h || (b.storeys || 1) * (b.FH || 3.2);
      if (y < gy - pad || y > gy + h + pad) continue;
      const yaw = (b.group.rotation && b.group.rotation.y) || 0;
      const co = Math.cos(yaw), si = Math.sin(yaw);
      const rx = x - bx, rz = z - bz;
      const lx = rx * co - rz * si, lz = rx * si + rz * co;
      const ex = Math.max(0, Math.abs(lx) - (b.w || 8) / 2), ez = Math.max(0, Math.abs(lz) - (b.d || 8) / 2);
      const d = Math.hypot(ex, ez);
      if (d > pad || d >= bd) continue;
      bd = d; best = b;
    }
    return best;
  }
  A.buildingAt = function (x, y, z, hit) {
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return null;
    if (inCity()) {
      if (hit && hit.lot && hit.lot.building) return { lot: hit.lot, rec: hit.rec || null, isle: null };
      let rec = (hit && hit.rec) || null;
      if (!rec && CBZ.airspace && CBZ.airspace.recordsAt) {
        let rs = null;
        try { rs = CBZ.airspace.recordsAt(x, y, z, 2.5, _recs); } catch (e) { rs = null; }
        // the record that carries a lot (a real shell) wins over a bare plan
        if (rs) for (let i = 0; i < rs.length; i++) { if (!rec || (!rec.lot && rs[i].lot)) rec = rs[i]; }
      }
      if (rec) return { lot: rec.lot || null, rec: rec, isle: null };
      const S = CBZ.structure;
      const lot = S && S.lotAt ? S.lotAt(x, z, 2.5) : null;
      if (lot && lot.building && y <= (lot.building.h || 12) + 2) return { lot: lot, rec: null, isle: null };
      return facadeAt(x, y, z) ? { lot: null, rec: null, isle: null } : null;
    }
    if (islandOn()) {
      const b = (hit && hit.isle) || islandBuildingAt(x, y, z, 2.5);
      return b ? { lot: null, rec: null, isle: b } : null;
    }
    return null;
  };

  /* ISLAND STRIKE — the same building strike on the disaster island's own
     buildings (world/disaster_arena.js records), through the same collapse
     engine the quake, the meteor and the tsunami use. The cut is the city's
     (carveSeats, at the height it hit); the island has no city ledger, so the
     part of the strike the ledger would price is the collapse engine's own
     fraction (the meteor's scale: 1 = it comes down). A building's share is
     its storeys x footprint against the strike's megajoules: a Cessna into a
     cottage wounds it, a jet into a tower guts its struck floors, an airliner
     at speed brings the top down. The struck floors burn on the island's one
     fire (systems/wildfire.js). */
  function isleStrike(s, x, y, z, dx, dz, v, mass, b) {
    const cls = s.cls;
    const E = strikeMJ(cls, mass, v);
    const row = CBZ.impact && CBZ.impact.row ? CBZ.impact.row(ROW[cls] || "crashSmall") : null;
    const pen = row && row.pen > 0 ? row.pen : (cls === "airliner" ? 26 : cls === "jet" ? 12 : 4);
    const through = Math.abs(dx) * (b.w || 8) + Math.abs(dz) * (b.d || 8);
    const depth = Math.min(LAMBDA * Math.log(1 + pen), through * 0.6);
    const carved = carveSeats(b, s, x, y, z, dx, dz, E, depth);
    const FH = b.FH || ((b.h && b.storeys) ? b.h / b.storeys : 3.2);
    const storeys = Math.max(1, b.storeys || Math.round((b.h || 6) / FH));
    const killMJ = Math.max(40, 0.25 * (b.w || 8) * (b.d || 8) * storeys);
    const frac = E / killMJ;
    if (frac >= 0.3 && CBZ.collapse && CBZ.collapse.damage) {
      try {
        CBZ.collapse.damage(b, { x: x + dx * depth * 0.5, y: y, z: z + dz * depth * 0.5 },
          Math.max(2.5, s.dims.span * 0.3), Math.min(1.6, frac), { x: dx, y: -0.1, z: dz }, { frac: true });
      } catch (e) {}
    }
    const W = CBZ.wildfire;
    if (W && W.igniteFloor) {
      const f0 = Math.max(0, Math.floor((y - (b.gy || 0)) / FH));
      const span = cls === "airliner" ? 2 : cls === "jet" ? 1 : 0;
      for (let k = -span; k <= span; k++) { try { W.igniteFloor(b, f0 + k, "impact"); } catch (e) {} }
    }
    isleKillZone(x + dx * depth * 0.5, y, z + dz * depth * 0.5,
      Math.max(6, s.dims.span * 0.55 + depth * 0.5), s, "killed in the plane strike", FH * (cls === "airliner" ? 2.5 : 1.5) + 2);
    return { energyMJ: E, carved: carved, frac: frac };
  }

  /* THE AIRFRAME BREAKS UP. What is left of the hull after the deformation
     (crashdeform.js has already sheared the struck wing and torn the parts
     nearest the contact) becomes pieces of itself in CBZ.debris — the
     fuselage, the engines, the other wing, biggest first, the small
     fittings as grit — and the hull is hidden. Most of the airframe's
     momentum went into the building; the pieces carry the rest on into the
     wound and fall down the face, burning, and kill what they land on.
     Budget: the sim's own per-call and live caps (a phone gets a handful
     of bodies), tracked by this file's capped wreck list. */
  function breakUp(s, grp, dx, dz, v) {
    if (!grp || !grp.parent || grp.visible === false || !CBZ.debris || !CBZ.debris.adopt || !window.THREE) return;
    const carry = 0.14;
    const vx = dx * v * carry, vz = dz * v * carry;
    const vy = Math.max(-12, Math.min(4, (s.vy || 0) * carry)) + 1.2;
    let r = null;
    try {
      grp.updateWorldMatrix(true, true);
      r = CBZ.debris.adopt(grp, {
        velocity: new THREE.Vector3(vx, vy, vz),
        angular: new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3),
        owner: "wreck", maxPieces: qi(4, 10), maxUp: 5, grit: 0.6,
      });
    } catch (e) { r = null; }
    if (!r || !r.bodies) return;
    const by = s.byPlayer ? CBZ.player : null;
    for (let i = 0; i < r.bodies.length; i++) {
      track(r.bodies[i], { burning: i < 3, hazard: true, dmg: 60, by: by, byPlayer: s.byPlayer });
    }
  }

  /* PUBLIC: an airframe has met a building (or the ground) — run the whole
     catastrophe for it. The detector (whoever swept the airframe) hands over
     what it hit; nothing here re-detects.
       obj   the airframe's record (registry key for once-only)
       hit   { x, y, z, nx?, nz?, rec?, collider?, lot?, building? }
       info  { group, cls, dims, vx, vy, vz, speed, byPlayer, heli, entryDrawn } */
  CBZ.cityAircraftStrike = A.strike = function (obj, hit, info) {
    if (!obj || !hit || isDone(obj)) return null;
    info = info || {};
    const grp = info.group || obj.group || obj.grp || null;
    const dims = info.dims ? normDims(info.dims) : dimsFor(obj, grp);
    const cls = info.cls ? okCls(info.cls) : classOf(obj, dims);
    const vx = +info.vx || 0, vy = +info.vy || 0, vz = +info.vz || 0;
    const s = {
      obj: obj, group: grp, dims: dims, cls: cls, heli: !!info.heli,
      x: hit.x, y: hit.y, z: hit.z, vx: vx, vy: vy, vz: vz,
      speed: info.speed != null ? +info.speed : Math.hypot(vx, vy, vz),
      heading: info.heading || 0, byPlayer: !!info.byPlayer,
      handled: false, idle: 0, stale: 0, seen: 1, hit: hit,
    };
    return impactFrom(s, hit.x, hit.y, hit.z, info.entryDrawn ? {} : null);
  };

  /* PUBLIC: run the catastrophe at a point without a tracked airframe (a
     mission scripting a strike, a test probe). info = {cls, speed, dirx, dirz,
     dims, byPlayer}. */
  CBZ.cityAircraftImpactAt = A.at = function (x, y, z, info) {
    info = info || {};
    const cls = okCls(info.cls);
    const dims = info.dims ? normDims(info.dims) : DEF_DIMS[cls];
    const s = {
      obj: info.obj || {}, group: info.group || null, dims: dims, cls: cls,
      heli: cls === "small" && info.heli, x: x, y: y, z: z,
      vx: info.dirx || 0, vy: 0, vz: info.dirz == null ? 1 : info.dirz,
      speed: info.speed == null ? 90 : info.speed,
      heading: info.heading || 0, byPlayer: !!info.byPlayer,
      handled: false, idle: 0, stale: 0, seen: 1,
    };
    return impactFrom(s, x, y, z, info.entryDrawn ? {} : null);
  };

  /* ============================================================
     THE BLAST WRAPPERS.
     Both crash-terminating entry points in the game are wrapped with the
     repo's standard lazy, marker-copying, idempotent pattern (demolition.js's
     wrapBoom is the template). We call through FIRST — the legacy fireball
     must draw exactly as it always did — then ask whether that blast was a
     crash.
     ============================================================ */
  function onBlast(x, z, opts) {
    if (!CBZ.CONFIG.AIR_IMPACT_V1 || !samples.size || !inCity()) return;
    // Anything that came OUT of the ordnance bus is by definition not a crash
    // path (every crash path in the game calls these two functions directly),
    // and skipping them also makes recursion through our own composer
    // structurally impossible.
    if (opts && (opts._airImpact || opts._impact)) return;
    const y = opts && opts.y != null ? opts.y : floorAt(x, z) + 1.2;
    let best = null, bd = 1e9;
    samples.forEach(function (s) {
      if (s.handled || !dying(s)) return;
      // vertical distance is weighted down: a wreck's blast is seated at the
      // surface it struck, which can be a metre or two off the tracked centre.
      const d = Math.hypot(s.x - x, (s.y - y) * 0.6, s.z - z);
      if (d > MATCH_R || d >= bd) return;
      bd = d; best = s;
    });
    if (!best) return;
    const claimed = impactFrom(best, x, y, z, opts || {});
    // CLAIM THE BLAST. If we priced this crash through the ordnance bus, the
    // legacy blast that carried us here must NOT also be priced by
    // city/demolition.js's onBlast delegation — that hook sits OUTSIDE ours in
    // the wrap chain and would bill the same wreck a second time at the flat
    // legacy rate (measured: ~19.7 damage units for a hit the crashJet row
    // prices at 6.1). Tag the SHARED opts object the whole chain sees, exactly
    // the way demolition tags `_demoSeen`.
    // Only when the strike gate actually passed — a sub-threshold taxi bump
    // was never priced by us, so its blast must keep its normal accounting.
    if (claimed && claimed.strike && opts) { try { opts._airImpact = true; } catch (e) {} }
  }

  function wrapBoom(name) {
    const orig = CBZ[name];
    if (typeof orig !== "function" || orig._airCrashWrapped) return;
    const wrapped = function (x, z, opts) {
      const r = orig.call(this, x, z, opts);
      try { onBlast(x, z, opts); } catch (e) {}
      return r;
    };
    // Carry forward EVERY sibling wrap marker (_demoWrapped / _structWrapped /
    // _impactWrapped ...) so their idempotence guards still hold. Dropping one
    // is how this chain has previously ended up re-wrapping itself in layers.
    for (const k in orig) if (k.endsWith("Wrapped")) wrapped[k] = orig[k];
    wrapped._airCrashWrapped = true;
    CBZ[name] = wrapped;
  }

  /* ============================================================
     TICKS.
     11.9  — sample every airframe BEFORE playeraircraft.js's flight step
             (12 / 12.45 / 13 / 14), so a crash resolved in those orders is
             read against pre-impact velocity. Also the lazy wrap installer
             (crashfx defines the blast fns at load; the ordnance bus may load
             after us in a partial load).
     37.85 — the wreck field + cartwheel, immediately before
             city/crashdeform.js's 37.9 so an airframe deformed this frame
             tumbles with the same numbers.
     ============================================================ */
  if (CBZ.onUpdate) {
    CBZ.onUpdate(11.9, function (dt) {
      wrapBoom("cityExplosion");
      wrapBoom("cityAirstrikeExplosion");
      wireRows();
      if (!inWorld()) { if (samples.size) samples.clear(); return; }
      stepTracker(dt > 0.25 ? 0.25 : dt);
    });

    CBZ.onUpdate(37.85, function (dt) {
      if (!hulks.length && !tumbles.length) return;
      const d = dt > 0.25 ? 0.25 : dt;
      if (hulks.length) stepHulks(d);
      if (tumbles.length) stepTumbles(d);
    });
  }

  // A fresh run must not inherit a wreck field. cityGlassReset is the existing
  // run-reset chokepoint demolition.js / structural.js already hang off; wrap
  // it the same lazy, marker-copying way so every reset fires.
  A.reset = function () {
    hulks.length = 0; tumbles.length = 0; samples.clear();
    if (CBZ.debris) { try { CBZ.debris.clear("wreck"); } catch (e) {} }
  };
  if (CBZ.onUpdate) CBZ.onUpdate(0.021, function () {
    const orig = CBZ.cityGlassReset;
    if (typeof orig !== "function" || orig._airImpactResetWrapped) return;
    const wrapped = function () { try { A.reset(); } catch (e) {} return orig.apply(this, arguments); };
    for (const k in orig) if (k.endsWith("Wrapped")) wrapped[k] = orig[k];
    wrapped._airImpactResetWrapped = true;
    CBZ.cityGlassReset = wrapped;
  });

  /* ============================================================
     CBZ.cityAircraftImpactAudit() — THE RATCHET (BLOCK LAW rule 5).

     Counts CRASH-TERMINATING BLAST ENTRY POINTS that are still un-intercepted,
     i.e. paths on which a plane can hit a building and produce nothing but the
     old surface pop. Every crash in the game (playeraircraft's crashCraft,
     aircraft.js's wreckImpact, airtraffic's fallTraffic, island_airport's
     cityDamageCivilAircraft) terminates in exactly one of these two functions,
     so wrapping both is what makes the coverage total without editing a single
     file this domain does not own.

     It must read 0 once the first city frame has ticked, and may only ever go
     DOWN. Pin it in tools/math-gate.mjs's PASS block. (Copying the contract of
     CBZ.treeAudit(), which is pinned at zero.)
     ============================================================ */
  CBZ.cityAircraftImpactAudit = function () {
    let n = 0;
    if (!(CBZ.cityExplosion && CBZ.cityExplosion._airCrashWrapped)) n++;
    if (!(CBZ.cityAirstrikeExplosion && CBZ.cityAirstrikeExplosion._airCrashWrapped)) n++;
    return n;
  };

  /* ============================================================
     DEV/QA — read the whole system's numbers from a CDP probe, no rendering.
     (CLAUDE.md's closed loop is math over live state; these are the numbers.)
     ============================================================ */
  A.debug = function () {
    const out = [];
    samples.forEach(function (s) {
      out.push({ cls: s.cls, v: +s.speed.toFixed(1), dying: dying(s), handled: s.handled,
        x: +s.x.toFixed(1), y: +s.y.toFixed(1), z: +s.z.toFixed(1) });
    });
    return {
      tracked: out, wrecks: hulks.length, wreckCap: hulkCap(), tumbles: tumbles.length,
      rowsWired: rowsWired, audit: CBZ.cityAircraftImpactAudit(),
      flags: {
        v1: !!CBZ.CONFIG.AIR_IMPACT_V1, deform: !!CBZ.CONFIG.AIR_IMPACT_DEFORM,
        hazard: !!CBZ.CONFIG.AIR_IMPACT_DEBRIS_HAZARD, tumble: !!CBZ.CONFIG.AIR_IMPACT_TUMBLE,
      },
    };
  };
})();

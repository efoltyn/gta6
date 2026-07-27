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
   * BALLISTIC DEBRIS. Closed form, solved once at spawn:
     y(t) = y0 + vy t - 1/2 g t^2, landing time from the quadratic. No physics
     engine, no per-frame integration, no drift.
   * EVERYTHING ELSE IS A DRAW. Fire, sag, tilt and collapse are
     city/structural.js's; we never re-implement them.

   PERFORMANCE ENVELOPE (levelling a district must not kill a low-end machine):
   * Every count rides CBZ.qScale(lo, hi). Nothing is a hardcoded particle
     count.
   * NO NEW PARTICLE POOL. Ejecta -> CBZ.cityChunk (buildings.js, capped 60).
     Paper/contents -> CBZ.cityDebrisAdopt (crashfx's shared chunk pool,
     CHUNK_CAP 220, camera-aware recycle). Dust -> cityDustKick. Smoke ->
     cityCrashSmoke. Wound -> cityWallRuin / cityHeavyWallRuin. Glass ->
     cityShatter.
   * The ONE list this file owns is the WRECK FIELD: whole airframe SECTIONS
     (a sheared wing, a tail) that crashfx's debris pool refuses because they
     are over its 3 m donation limit. It is hard-capped at qScale(3, 12)
     concurrent pieces, closed-form (no integration), and degrades over the cap
     by retiring the farthest piece — never by queueing.
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
          color: hot && i === 0 ? 0x6b3a22 : 0x747b82,
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

     NO NEW POOL: these are thin quads on ONE shared geometry and ONE shared
     material, handed straight to CBZ.cityDebrisAdopt — crashfx's existing
     debris pool (CHUNK_CAP 220, camera-aware recycle, gravity, settle, then up
     to ~18 s at rest on the street). So the paper genuinely lands and lies
     around the block afterwards, and it costs the pool it already had.
     Wide + slow is achieved with a big lateral kick and almost no vertical
     one, so the sheets sail rather than drop.
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
    } catch (e) { paperGeo = null; return false; }
    return true;
  }
  function contentsFlutter(x, y, z, nx, nz, scale) {
    if (!CBZ.cityDebrisAdopt || y < 4) return;         // only reads from a height
    if (!ensurePaper()) return;
    const n = qi(3, 20) * Math.min(1.6, scale);
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
     THE WRECK FIELD — whole airframe SECTIONS on closed-form arcs.

     crashfx's debris pool refuses donations over 3 m (it is for car panels and
     fragments), so a sheared 15 m wing has nowhere to go. This is the one list
     this file owns. It is not a particle system:
       * hard-capped at qScale(3, 12) concurrent pieces;
       * motion is the CLOSED FORM p(t) = p0 + v t + 1/2 g t^2 evaluated per
         frame (no integration, no drift, no collision solve);
       * the landing point and landing TIME are solved analytically at spawn,
         so a piece knows where it is going before it leaves;
       * over the cap the FARTHEST piece retires immediately — never a queue.

     Pieces are adopted meshes (a wing torn off by crashdeform.js) or plain
     boxes. We never dispose a `_shared` geometry/material, matching the
     disposeGroup contract the aircraft files use.
     ============================================================ */
  const G = 9.81 * 0.9;                 // the same mildly-damped gravity crashfx's debris uses
  const hulks = [];
  const REST = 14;                      // seconds a landed section lingers
  // Concurrency is the whole performance story here: a wing, a tail, a handful
  // of recognisable fragments and the high-floor debris all land in this list,
  // and a district being levelled must not be able to grow it. 4 at tier 0,
  // 16 at tier 4 — over the cap the FARTHEST piece retires immediately.
  function hulkCap() { return Math.max(3, qi(4, 16)); }

  function solveLandT(y0, vy, gy) {
    const disc = vy * vy + 2 * G * (y0 - gy);
    if (disc <= 0) return 0.15;
    return Math.max(0.08, (vy + Math.sqrt(disc)) / G);
  }

  function evictHulk() {
    let idx = 0, bd = -1;
    for (let i = 0; i < hulks.length; i++) {
      const d = camDist(hulks[i].x, hulks[i].z);
      if (d > bd) { bd = d; idx = i; }
    }
    retireHulk(hulks[idx]);
    hulks.splice(idx, 1);
  }
  function retireHulk(h) {
    if (!h || !h.mesh) return;
    try {
      if (h.mesh.parent) h.mesh.parent.remove(h.mesh);
      if (h.own) {
        h.mesh.traverse(function (o) {
          if (o.geometry && !o.geometry._shared && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) {} }
        });
      }
    } catch (e) {}
    h.mesh = null;
  }

  /* PUBLIC: adopt an oversized airframe section into the wreck field.
     city/crashdeform.js calls this when it shears a wing or a tail off; any
     caller may. Degrade-safe: if this file is absent the caller falls back to
     CBZ.cityDebrisAdopt, which is exactly what it did before.
       mesh  already reparented into the arena root, posed in WORLD space
       opts  { spin, burning, hazard, dmg, by, byPlayer, own } */
  CBZ.cityWreckDebris = A.debris = function (mesh, vx, vy, vz, opts) {
    if (!mesh || !inCity()) return false;
    opts = opts || {};
    while (hulks.length >= hulkCap()) evictHulk();
    const p = mesh.position;
    // analytic landing point: solve once with the ground under the spawn, then
    // re-solve with the ground under the projected landing spot (two passes is
    // plenty — terrain does not change fast enough for a third to matter).
    let gy = floorAt(p.x, p.z);
    let t = solveLandT(p.y, vy, gy);
    gy = floorAt(p.x + vx * t, p.z + vz * t);
    t = solveLandT(p.y, vy, gy);
    const h = {
      mesh: mesh, x: p.x, y: p.y, z: p.z, x0: p.x, y0: p.y, z0: p.z,
      vx: vx || 0, vy: vy || 0, vz: vz || 0,
      t: 0, tLand: t, gy: gy, landed: false, rest: 0,
      spin: opts.spin || (Math.random() - 0.5) * 5,
      spin2: (Math.random() - 0.5) * 3.5,
      burning: !!opts.burning, smokeT: 0,
      hazard: !!opts.hazard && !!CBZ.CONFIG.AIR_IMPACT_DEBRIS_HAZARD,
      dmg: opts.dmg || 0, by: opts.by || null, byPlayer: !!opts.byPlayer,
      hurtT: 0, own: !!opts.own,
    };
    hulks.push(h);
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
    try {
      if (CBZ.cityCrowdCircleKill) {
        CBZ.cityCrowdCircleKill(h.x, h.z, HAZ_R, {
          byCar: true, quiet: true, fromX: h.x, fromZ: h.z, noCrime: !h.byPlayer,
        });
      }
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

  function stepHulks(dt) {
    for (let i = hulks.length - 1; i >= 0; i--) {
      const h = hulks[i];
      if (!h.mesh) { hulks.splice(i, 1); continue; }
      if (h.landed) {
        h.rest += dt;
        if (h.rest > REST) { retireHulk(h); hulks.splice(i, 1); }
        continue;
      }
      h.t += dt;
      const t = h.t;
      // CLOSED FORM — position is a function of t, never an accumulation.
      h.x = h.x0 + h.vx * t;
      h.z = h.z0 + h.vz * t;
      h.y = h.y0 + h.vy * t - 0.5 * G * t * t;
      const m = h.mesh;
      m.position.set(h.x, h.y, h.z);
      m.rotation.x += h.spin * dt;
      m.rotation.z += h.spin2 * dt;
      if (h.burning && CBZ.cityCrashSmoke) {
        h.smokeT -= dt;
        if (h.smokeT <= 0) {
          h.smokeT = 0.1;
          if (camDist(h.x, h.z) < (CBZ.cityCullRadius || 320)) {
            try { CBZ.cityCrashSmoke(h.x, h.y, h.z); } catch (e) {}
          }
        }
      }
      hazardSweep(h, dt);
      if (t >= h.tLand || h.y <= h.gy + 0.3) {
        h.landed = true; h.rest = 0;
        h.y = h.gy + 0.3;
        m.position.y = h.y;
        m.rotation.x = (Math.random() - 0.5) * 0.6;      // lie down, do not freeze mid-tumble
        m.rotation.z = (Math.random() - 0.5) * 0.6;
        try {
          if (CBZ.cityDustKick) CBZ.cityDustKick(h.x, h.gy + 0.4, h.z, 1.4);
          if (CBZ.sfx && camDist(h.x, h.z) < 90) CBZ.sfx("clank", { dist: camDist(h.x, h.z) });
        } catch (e) {}
        hazardSweep(h, 1);                                // the landing itself
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
    if (!CBZ.CONFIG.AIR_IMPACT_V1 || !inCity()) return null;

    const v = s.speed;
    // travel direction: velocity first (it is what actually hit), heading as
    // the fallback for records that only carry an attitude.
    let dx = s.vx, dz = s.vz;
    let dl = Math.hypot(dx, dz);
    if (dl < 0.5) { dx = Math.sin(s.heading || 0); dz = Math.cos(s.heading || 0); dl = 1; }
    dx /= dl; dz /= dl;

    const grp = s.group;
    const building = !!facadeAt(x, y, z);
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
      if (CBZ.detonate) {
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

  // Heavy structural pieces shed from the impacted floors. Closed-form arcs
  // (the wreck field above) with an outward+downrange kick, and they HURT.
  function shedHighDebris(s, x, y, z, dx, dz, scale) {
    if (!window.THREE || !CBZ.city) return;
    const arena = CBZ.city.arena || CBZ.city;
    const root = arena && arena.root;
    if (!root) return;
    const n = Math.min(6, qi(1, 5) * (scale > 1.4 ? 2 : 1));
    for (let i = 0; i < n; i++) {
      let m;
      try {
        const g = new THREE.BoxGeometry(0.7 + Math.random() * 1.3, 0.4 + Math.random() * 0.9, 0.6 + Math.random() * 1.2);
        const mat = CBZ.cmat ? CBZ.cmat(0x6c6358) : new THREE.MeshLambertMaterial({ color: 0x6c6358 });
        m = new THREE.Mesh(g, mat);
      } catch (e) { return; }
      const a = Math.random() * 6.2832;
      m.position.set(x + Math.cos(a) * 2.5, y + (Math.random() - 0.5) * 5, z + Math.sin(a) * 2.5);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      root.add(m);
      CBZ.cityWreckDebris(m,
        dx * (3 + Math.random() * 6) + Math.cos(a) * (2 + Math.random() * 4),
        1 + Math.random() * 3,
        dz * (3 + Math.random() * 6) + Math.sin(a) * (2 + Math.random() * 4),
        { hazard: true, dmg: 55, by: s.byPlayer ? CBZ.player : null, byPlayer: s.byPlayer, own: true });
    }
  }

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
      if (!inCity()) { if (samples.size) samples.clear(); return; }
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
    for (let i = hulks.length - 1; i >= 0; i--) retireHulk(hulks[i]);
    hulks.length = 0; tumbles.length = 0; samples.clear();
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

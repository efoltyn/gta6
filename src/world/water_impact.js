/* ============================================================
   src/world/water_impact.js — THE WATER IMPACT BUS.

   WHAT IT IS
   ----------
   One function — CBZ.waterHit(x, y, z, opts) — that EVERY water-touching
   event in the game routes through, plus the wrappers that retrofit it onto
   the shared FX buses that already exist, so ~15 existing call sites become
   water-aware without a single edit to their files.

   WHY IT EXISTS (the concrete bugs it kills)
   ------------------------------------------
   The engine had no shared notion of "something touched the water", so every
   land assumption leaked straight into the harbour:

     • BULLET HOLES FLOATING ON THE SEA. Every shot in the game routes through
       CBZ.tracer, which stamps a persistent black pock decal + a brown dust
       puff on the *pavement plane* at y = 0.09 whenever the shot line carries
       below it (systems/gunfx.js:288-295). Over open water that plane is ~0.6m
       ABOVE the sea, so firing into the bay left permanent bullet holes and
       kicked-up concrete dust hanging over the swell.
     • BULLETS THAT MISSED EVERYTHING MADE NOTHING AT ALL. Hitscan resolution
       (fpsmode.js resolveShot/gunHit) is an if/else chain with no final else,
       so a round fired into open water produced no impact call whatsoever.
     • A GRENADE IN THE HARBOUR EXPLODED EXACTLY LIKE ONE ON ASPHALT — fireball,
       ground scorch, concrete debris chunks raining into the sea.
     • A CAR CRASHING INTO THE BAY MADE NO SPLASH.

   THE CALIBRATED IMPACT VOCABULARY (research-backed; these are DELIBERATELY
   distinct — using one splash shape for everything is the classic mistake that
   makes gunfire into water read as toylike)
   ----------------------------------------
     bullet   small and QUICK — a handful of droplets in a tight vertical
              spurt and one small short-lived ring. No crown. No column.
     body /   crown + rebound jet + settling ring — a radial burst of droplets
     vehicle  (the crown), a central upward spike whose height scales with
              impact speed, and an expanding fading ring left behind.
     blast    the 3-stage depth-charge beat: (1) an underwater bubble dome at
              the detonation point, (2) a tall foam COLUMN erupting at the
              surface directly above it, height scaling with yield, and (3)
              FALLING SPRAY raining back down, delayed by the column's rise
              time. Staged with timers, never all at once.
     drop     a single dimple ring (rain).
     debris   a compact crown, no jet.

   Effect size comes from MOMENTUM, not raw speed: sqrt(mass) * speed. A body
   dropped at 8 m/s therefore splashes far bigger than a bullet at 380 m/s, and
   the SAME momentum scalar drives the audio gain and pitch — one parameter,
   two consumers.

   PUBLIC API
   ----------
     CBZ.waterHit(x, y, z, opts) -> bool
        opts = { speed, mass, kind, quiet, by, src, power, vx, vz }
        vx/vz: the HORIZONTAL velocity it arrived with (optional). A body that
        was travelling ploughs — the crown shifts downrange, the leading crest
        becomes an arc, the droplets ahead of it are thrown flat and fast, and
        the foam scar drifts along the track instead of being stamped at the
        touch point. Omit it and the event is symmetric, which is right for
        anything that was simply falling.
        kind: "bullet" | "body" | "vehicle" | "debris" | "blast" | "drop"
        Returns FALSE immediately (doing nothing) when (x,z) is not over water
        or y is well clear of the LIVE surface — so callers may call it
        unconditionally, which is what makes it one-line adoptable. Returns
        TRUE when it handled the hit, so a wrapper can suppress the land FX it
        replaced.
     CBZ.onWaterHit(fn) -> unsubscribe()
        Listener registry. fn({x,y,z,kind,strength,momentum,depth,by,src}).
        Every listener is try/catch'd: one bad listener cannot kill the bus.
        This is the SEAM for neighbours — the shark/predator agent can treat a
        body hitting the surface as a dinner bell without touching this file.
     CBZ.waterBlastAt(x, y, z, opts)   the 3-stage depth-charge staging alone
     CBZ.waterImpactStats()            live counters (headless probes)
     CBZ.waterImpactAudit()            ratchet: unwrapped shared-FX seams (0)

   WRAPPERS IT INSTALLS (all lazy-retried, all chain-preserving)
   ------------------------------------------------------------
     CBZ.tracer                  -> the universal bullet hook. Intersects the
                                    shot segment with the LIVE sea surface and
                                    emits the bullet hit at the true crossing.
     CBZ.bulletImpact            -> over water: no dust/sparks, water hit instead
     CBZ.bulletHole              -> over water: no decal (kills the floating hole)
     CBZ.cityExplosion           -> over water: depth-charge staging + a tight,
     CBZ.cityAirstrikeExplosion     reliably lethal radius against submerged
                                    actors, and opts.airburst so no concrete
                                    debris chunks rain into the sea.
   Per the explosion-wrapper law: every existing *Wrapped marker is copied
   forward onto the new function, and the blast handler is idempotent per blast
   via a private opts._waterSeen flag (the demolition.js _demoSeen pattern).

   VISUALS are composed entirely out of world/water_wake.js's primitives —
   CBZ.waterEmit() for airborne spray and surface foam (its `ride` flag chooses
   billboard or real in-plane geometry) and CBZ.waterCrown() for the erupting
   sheet. This file allocates no geometry, no material and no mesh of its own,
   and every burst is sized against the same CBZ.qScale budget the wakes and
   rain already share (CBZ.waterEmitFree / CBZ.waterFoamFree report the
   headroom).

   DETERMINISM: runtime-only presentation, so randomness is permitted here for
   particle jitter exactly as water_wake.js documents — and, exactly as that
   file does, it is drawn from a file-local mulberry32 (fxRand) rather than
   Math.random, so an impact vocabulary can never perturb the simulation's
   shared stream. Nothing in the FX path touches world generation. The one
   gameplay effect — the underwater blast lethality — is a pure function of the
   blast's own arguments.

   FLAGS (declared below, each a one-line revert):
     CBZ.CONFIG.WATER_IMPACT        the bus + the bullet/impact wraps
     CBZ.CONFIG.WATER_IMPACT_BLAST  the depth-charge staging + underwater lethality
     CBZ.CONFIG.WATER_IMPACT_ENTRY  the car/corpse/grenade water-entry detector
   All three stand down when CBZ.CONFIG.WATER_V2 === false (master switch,
   world/water_spec.js), like every sibling water file.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  // WATER_IMPACT: the shared "something touched the water" bus. ON -> bullets,
  // bodies, vehicles, debris and blasts get calibrated splashes and momentum-
  // scaled audio, and the land-based dust/spark/bullet-hole FX are suppressed
  // over water (this is what stops bullet holes floating on the sea).
  // Flip false (or ?cfg_WATER_IMPACT=0) for a one-line revert to the exact
  // prior behaviour: every wrapper falls through to the original untouched.
  if (CFG.WATER_IMPACT == null) CFG.WATER_IMPACT = true;

  // WATER_IMPACT_BLAST: the 3-stage underwater-explosion beat (bubble dome ->
  // surface column -> falling spray) plus a tighter-but-reliably-lethal radius
  // against anything actually submerged, and opts.airburst on water blasts so
  // concrete debris chunks stop raining into the sea.
  // Flip false (or ?cfg_WATER_IMPACT_BLAST=0) -> a blast over water behaves
  // exactly as it did on asphalt.
  if (CFG.WATER_IMPACT_BLAST == null) CFG.WATER_IMPACT_BLAST = true;

  // WATER_IMPACT_ENTRY: the passive entry detector — a car driven off a pier, a
  // corpse dumped in the harbour or a thrown grenade crossing the surface each
  // announce themselves on the bus. Purely observational (it reads positions
  // that vehicles.js / peds.js / combat.js already wrote) and throttled to 20Hz.
  // Flip false (or ?cfg_WATER_IMPACT_ENTRY=0) -> no entry splashes.
  if (CFG.WATER_IMPACT_ENTRY == null) CFG.WATER_IMPACT_ENTRY = true;

  function off() {
    return CFG.WATER_IMPACT === false || CFG.WATER_V2 === false;
  }
  function entryOn() {
    return CFG.WATER_ENTRY_PHYSICS !== false &&
      (!CBZ.waterEntryPhysicsOn || CBZ.waterEntryPhysicsOn());
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ---- THE FX RANDOM STREAM — NOT Math.random ---------------------------
     Every jitter value in this file comes from HERE, and the reason is the
     A/B harness rather than the game. A visual before/after pass seeds ONE
     global Math.random from an LCG so both columns walk the same dice; any
     path that draws a different NUMBER of values between the two builds
     desynchronises everything downstream of it, and presentation is exactly
     the kind of code whose draw count changes when you improve it (a crown
     that now takes a seed, a distance gate that now rolls to thin distant
     spray). FX must never be able to move the simulation's dice.

     So: mulberry32, seeded once, file-local. Same statistical quality, same
     cost, zero coupling — the sim's stream is untouched no matter how much
     water this file decides to throw. (The sibling file uses a different
     seed constant so the two streams cannot march in step.)

     This is still runtime-only presentation and nothing here touches world
     generation, so it is not a determinism requirement — it is an isolation
     one. */
  let _fxSeed = 0x85EBCA6B >>> 0;
  function fxRand() {
    _fxSeed = (_fxSeed + 0x6D2B79F5) >>> 0;
    let t = _fxSeed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function seaY() { return CBZ.waterSeaY ? CBZ.waterSeaY() : (CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48); }
  function surfY(x, z) {
    return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : seaY();
  }
  function overWater(x, z) {
    return CBZ.cityWaterAt ? !!CBZ.cityWaterAt(x, z) : false;
  }
  function emit(o) { return CBZ.waterEmit ? CBZ.waterEmit(o) : false; }
  function free() { return CBZ.waterEmitFree ? CBZ.waterEmitFree() : 0; }

  const GRAV = 9.2;                 // must match water_wake.js's droplet gravity

  // Peak displacement above mean sea level anywhere in the world right now.
  // Degrade-safe: with water_spec.js absent (or WATER_DEEP_SWELL off, where
  // both gains collapse to 1) this is exactly the historical 0.42m.
  function crestCeiling() {
    const sw = +CBZ.WATER_SWELL_ROWS_AMP || 0.355;
    const ch = +CBZ.WATER_CHOP_ROWS_AMP || 0.065;
    const gs = CBZ.waterDeepGain ? (+CBZ.waterDeepGain() || 1) : 1;
    const gc = CBZ.waterChopGain ? (+CBZ.waterChopGain() || 1) : 1;
    const w = CBZ.waterWeatherAmp ? (+CBZ.waterWeatherAmp() || 1) : 1;
    const peak = Math.max(+CBZ.WATER_SWELL_AMP || 0.42, sw * gs + ch * gc) * w;
    return Number.isFinite(peak) && peak > 0 ? peak : 0.42;
  }

  // ============================================================
  //  1. THE KIND TABLE — defaults, gates and the momentum reference
  // ============================================================
  // mass (kg) / speed (m/s): what this class of thing weighs and how fast it
  //   typically arrives, used only when the caller does not say.
  // clear: how far ABOVE the live surface the point may be and still count as
  //   a water hit (below the surface always counts).
  // min/max: the per-kind band `strength` is clamped into, so a freak value can
  //   never make a raindrop the size of a car crash.
  //
  // Scale is ONE ABSOLUTE curve over momentum — never a per-kind normalisation.
  // That is what makes the ordering physical rather than authored: at the same
  // speed a body outsplashes a bullet by ~90x of momentum, and a car outsplashes
  // a body, because sqrt(mass) says so. What differs between kinds is the SHAPE
  // (the vocabulary), not the yardstick.
  //
  // THE CEILINGS USED TO BE THE BUG. body capped at 2.4 and vehicle at 2.8,
  // which were honest numbers when the only caller was a swimmer stepping off
  // a quay — and then shark_sim.js started asking for a breach and
  // wildlife_tame.js for a ridden megalodon's reentry, and both were served the
  // same splash a person makes because the clamp ate the difference. The curve
  // below is unchanged; only the room it is allowed to use grew, so a twenty-
  // tonne animal coming down out of the air scores ~6 where a diver scores ~0.8
  // and the ORDERING is still momentum's, not an author's.
  const KINDS = {
    bullet:  { mass: 0.008, speed: 380, clear: 1.2, min: 0.30, max: 1.0 },
    body:    { mass: 78,    speed: 8,   clear: 2.4, min: 0.30, max: 6.5 },
    vehicle: { mass: 1400,  speed: 14,  clear: 2.8, min: 0.80, max: 5.0 },
    debris:  { mass: 12,    speed: 9,   clear: 1.6, min: 0.25, max: 3.0 },
    drop:    { mass: 0.5,   speed: 5,   clear: 1.0, min: 0.10, max: 1.0 },
    blast:   { mass: 900,   speed: 20,  clear: 6.0, min: 0.20, max: 4.0 },
  };
  // Momentum (kg^0.5 * m/s) that scores strength 1.0 — a 78kg body going in at
  // 8 m/s, i.e. someone thrown off a quay. The 0.55 exponent compresses the
  // enormous dynamic range (a raindrop is 3, a truck at speed is ~1000) into a
  // usable 0.2..3 dial without ever inverting the ordering.
  const MOM_REF = 70, MOM_EXP = 0.55;

  // ============================================================
  //  2. LISTENER REGISTRY — the neighbour seam
  // ============================================================
  const listeners = [];
  // Register a reaction to any water impact. Returns an unsubscribe function.
  // The shark/predator agent, a mission's "something fell in the bay" trigger,
  // a wildlife startle response and a future sonar ping all hang off THIS and
  // never touch this file. Payload:
  //   { x, y, z, kind, strength, momentum, depth, by, src }
  //   depth  metres BELOW the live surface (0 at the surface, >0 submerged)
  //   by     attacker/attribution ref forwarded by the caller
  //   src    the entity that made the impact, when one is known
  // The payload is a FRESH object per event (and is only built when somebody is
  // actually listening), so a neighbour may safely retain it.
  CBZ.onWaterHit = function (fn) {
    if (typeof fn !== "function") return function () {};
    listeners.push(fn);
    return function () {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  };
  function fire(x, y, z, kind, strength, momentum, depth, by, src) {
    if (!listeners.length) return;
    const ev = {
      x: x, y: y, z: z, kind: kind, strength: strength,
      momentum: momentum, depth: depth, by: by || null, src: src || null,
    };
    for (let i = 0; i < listeners.length; i++) {
      // ONE bad listener must never be able to kill the bus for everyone else.
      try { listeners[i](ev); } catch (e) {}
    }
  }

  // ============================================================
  //  3. AUDIO — the existing CBZ.sfx bank, feature-detected
  // ============================================================
  // systems/audio.js publishes its bank as CBZ.audioManifest.effects. Probe it
  // once (never before it exists) and take the best name that is actually
  // mapped; an unmapped name only console.warns, but we would rather not spam.
  let sfxName = null;
  const SFX_WANT = ["splash", "water", "step"];
  function bankName() {
    if (sfxName) return sfxName;
    const m = CBZ.audioManifest && CBZ.audioManifest.effects;
    if (!m) return "water";                       // do not cache: audio.js may load later
    for (let i = 0; i < SFX_WANT.length; i++) if (m[SFX_WANT[i]]) { sfxName = SFX_WANT[i]; break; }
    if (!sfxName) sfxName = "water";
    return sfxName;
  }
  // `loud` is the SAME momentum scalar the VFX is sized from — one parameter,
  // two consumers. Small momentum -> quiet and high-pitched (a bullet tick);
  // big momentum -> loud and deep (a car going in).
  function playHit(x, y, z, loud, kind) {
    if (!CBZ.sfx) return;
    const name = bankName();
    if (!name) return;
    const cam = CBZ.camera;
    let dist = 0;
    if (cam && cam.position) {
      dist = Math.hypot(x - cam.position.x, y - cam.position.y, z - cam.position.z);
      if (dist > 150) return;                     // out of earshot: skip the whole call
    }
    try {
      CBZ.sfx(name, {
        volume: clamp(0.18 + loud * 1.05, 0.05, 1.25) * (kind === "bullet" ? 0.5 : 1),
        pitch: clamp(1.55 - loud * 0.78, 0.74, 1.6),
        dist: dist,
        force: kind === "blast",                  // a detonation always speaks
      });                                         // (everything else respects the
                                                  //  bank cooldown, which is what
                                                  //  keeps a burst of automatic
                                                  //  fire into the bay from
                                                  //  machine-gunning the channel)
    } catch (e) {}
  }

  // ============================================================
  //  4. THE VOCABULARIES — composed out of water_wake.js's ONE pool
  // ============================================================

  // BULLET — small and QUICK. A handful of droplets in a tight, near-vertical
  // spurt plus one small short-lived ring. NO crown, NO column: a bullet
  // wearing the big-splash shape is exactly what makes gunfire into water look
  // toylike, and it is the single most common water impact in the game.
  function fxBullet(x, sy, z, s) {
    const n = Math.min(9, 5 + Math.round(s * 3));
    for (let i = 0; i < n; i++) {
      const a = fxRand() * Math.PI * 2;
      const r = fxRand() * 0.16 * s;         // very tight radius
      emit({
        x: x + Math.cos(a) * r, y: sy + 0.04, z: z + Math.sin(a) * r,
        vx: Math.cos(a) * (0.5 + fxRand() * 0.8),
        vy: 4.2 + fxRand() * 3.4 * s,        // the spurt: fast, straight up
        vz: Math.sin(a) * (0.5 + fxRand() * 0.8),
        size: 0.085 + fxRand() * 0.075 * s, grow: -0.02,
        ttl: 0.34 + fxRand() * 0.26, alpha: 0.95,
      });
    }
    // and the pin-prick of white water it leaves behind
    emit({ x: x, y: sy + 0.03, z: z, size: 0.22 * s, grow: 1.9 * s, ttl: 0.5, ring: true, ride: true, alpha: 0.7 });
  }

  // DROP — a rain dimple. One ring, occasionally a single bead. Gated on foam
  // HEADROOM, because rain arrives at up to 46 Hz and a squall must never be
  // able to spend the pool a splash is about to need.
  function fxDrop(x, sy, z, s) {
    if (CBZ.waterFoamFree && CBZ.waterFoamFree() < 40) return;
    emit({ x: x, y: sy + 0.02, z: z, size: 0.10 * s, grow: 0.85, ttl: 0.7, ring: true, ride: true, alpha: 0.6 });
    if (fxRand() < 0.16 * s) {
      emit({ x: x, y: sy + 0.03, z: z, vy: 1.1 + fxRand() * 0.8, size: 0.05, grow: -0.02, ttl: 0.26, alpha: 0.75 });
    }
  }

  // BODY / VEHICLE / DEBRIS — THE SHEET, then the grain, then the water left
  // behind. In that order, because that is the order the eye reads them.
  //
  //   sheet  the CROWN: a hollow cone of water that erupts, flares, tears at
  //          the rim and falls back. Real geometry (world/water_wake.js's
  //          CBZ.waterCrown), and the reason a big impact now reads as MASS.
  //          It is the silhouette; everything else is detail on it.
  //   crown  a radial burst of ballistic droplets thrown OUT and up at the rim,
  //          giving the sheet its grain and outliving it in the air
  //   jet    a central upward spike; its HEIGHT scales with impact speed (the
  //          rebound jet a real cavity throws when it collapses)
  //   wash   white water standing at the entry point, and the expanding
  //          collapse rings riding away from it across the live swell
  // `jet` 0 suppresses the spike (debris and glancing entries just crown).
  //
  // s runs about 0.3 (a dropped bottle) to 6.5 (a megalodon coming down out of
  // a breach). Every number below is linear in s so the ordering is the
  // momentum curve's and nothing is special-cased for a big animal.
  // `hx, hz` are the horizontal velocity of the thing that went in. They are
  // the difference between a stone DROPPED in the sea and a shark ARRIVING in
  // it: a body carrying speed does not throw a symmetric ring, it ploughs, and
  // the water goes downrange with it. Zero is the old symmetric behaviour and
  // is what a falling object still gets.
  function fxCrown(x, sy, z, s, jet, hx, hz, profile) {
    const entry = entryOn() && profile && typeof profile === "object" ? profile : null;
    const area = entry ? clamp(+entry.area || 0, 0.04, 1) : 0.58;
    const quality = entry ? clamp(+entry.quality || 0, 0, 1) : 0;
    /* The strength says HOW MUCH water was accelerated; projected area says
       WHAT SHAPE that water leaves in.  A spear entry is a narrow cut with a
       long cavity.  A misaligned flank is a broad, high slamming sheet.  Those
       are independent axes — a huge clean shark can still move more total water
       than a small bad diver without inheriting the bad diver's silhouette. */
    const width = entry ? (0.42 + area * 0.98) : 1;
    const rise = entry ? (0.62 + area * 0.88) : 1;
    const hs = Math.hypot(hx || 0, hz || 0);
    const bear = hs > 0.05 ? Math.atan2(hz || 0, hx || 0) : 0;
    // how much of the event is thrown downrange rather than radially. Saturates
    // — past about a body-length per second more speed does not tip it further,
    // it just makes it bigger, which the momentum term already did.
    const lean0 = hs > 0.05 ? clamp(hs / (7 + s * 2.2), 0, 0.85) : 0;
    const lean = entry ? clamp(lean0 * (0.72 + area * 0.62), 0, 0.9) : lean0;
    const bx = Math.cos(bear), bz = Math.sin(bear);
    // ---- the sheet -------------------------------------------------------
    if (s > 0.5 && CBZ.waterCrown) {
      CBZ.waterCrown({
        // shifted downrange: the hole a moving body makes is under its NOSE,
        // not under the point it first touched
        x: x + bx * (0.35 + 0.5 * s) * lean, z: z + bz * (0.35 + 0.5 * s) * lean,
        r: (0.22 + 0.45 * s) * width,        // narrow cut -> broad flank sheet
        grow: (0.5 + 0.55 * s) * width,
        h: (0.8 + 1.55 * s) * rise,
        ttl: 0.5 + 0.10 * s,
        // DELIBERATELY TRANSLUCENT. A sheet of thrown water is mostly air;
        // the first cut ran to 0.92 and photographed as a milk bucket.
        alpha: Math.min(0.72, 0.40 + s * 0.09),
      });
      /* A SECOND SHEET, DOWNRANGE, A BEAT LATER. A body moving across the
         surface tears a TROUGH, not a hole — the water closes behind it while
         it is still opening in front. One cone can only ever be a stone going
         in; two, offset along the track and a tenth of a second apart, is the
         shape of something that arrived travelling. Only when there is real
         speed and real mass to justify a second draw call. */
      if (lean > 0.28 && s > 1.4 && (!entry || area > 0.34)) {
        const d2 = (1.1 + s * 0.7) * lean;
        later(0.085 + 0.02 * s, function () {
          if (!CBZ.waterCrown) return;
          CBZ.waterCrown({
            x: x + bx * d2, z: z + bz * d2,
            r: (0.18 + 0.30 * s) * width, grow: (0.4 + 0.42 * s) * width,
            h: (0.6 + 1.05 * s) * 0.8 * rise, ttl: 0.45 + 0.09 * s,
            alpha: Math.min(0.58, 0.32 + s * 0.07),
          });
        });
      }
    }
    // ---- the grain -------------------------------------------------------
    const slots = free();
    const grain = entry ? (0.58 + area * 0.74) : 1;
    const nCrown = Math.max(5, Math.min(Math.round((8 + s * 13) * grain), Math.round(slots * 0.5)));
    for (let i = 0; i < nCrown; i++) {
      const a = (i / nCrown) * Math.PI * 2 + fxRand() * 0.5;
      const r = (0.28 + fxRand() * 0.55 * s) * width;
      const out = (1.6 + fxRand() * 2.2 * s) * width;
      // downrange droplets are thrown FASTER and FLATTER (they are being pushed
      // by the body); the ones behind it are thrown up and left behind
      const face = Math.cos(a) * bx + Math.sin(a) * bz;     // -1 behind .. +1 ahead
      const push = hs * lean * (0.30 + 0.35 * Math.max(0, face));
      emit({
        x: x + Math.cos(a) * r * 0.55, y: sy + 0.06, z: z + Math.sin(a) * r * 0.55,
        vx: Math.cos(a) * out + bx * push,
        vy: (2.0 + fxRand() * 3.0 * s) * rise * (1 - 0.30 * lean * Math.max(0, face)),
        vz: Math.sin(a) * out + bz * push,
        size: 0.10 + fxRand() * (0.09 + 0.05 * s) * (0.6 + s * 0.22), grow: -0.02,
        ttl: 0.5 + fxRand() * (0.5 + s * 0.16), alpha: 0.95,
      });
    }
    if (jet > 0) {
      /* THE REBOUND SPIKE, AND IT IS *LATE ON PURPOSE*. A cavity does not throw
         its jet at the moment of impact — it opens, it is squeezed shut by the
         water around it, and the collapse fires the spike back up out of the
         hole. Firing it on the same frame as the sheet is what made a big entry
         read as one flat bang instead of a two-beat event, and the delay scales
         with the cavity: a diver ~0.14 s, twenty tonnes of shark ~0.35 s.

         This is the one delay in the file that is supposed to be there, and it
         is the opposite of the bug this pass fixed: it happens AFTER the sheet,
         at a size the eye reads as an answer to it, rather than being the whole
         splash arriving late. */
      const nJet = 3 + Math.round(Math.min(6, s * 1.3));
      const v0 = (4.6 + s * 3.8) * jet;
      const jx = x + bx * (0.5 + 0.6 * s) * lean, jz = z + bz * (0.5 + 0.6 * s) * lean;
      later(0.11 + Math.min(0.24, 0.055 * s), function () {
        for (let i = 0; i < nJet; i++) {
          emit({
            x: jx + (fxRand() - 0.5) * 0.12 * s, y: sy + 0.05, z: jz + (fxRand() - 0.5) * 0.12 * s,
            vx: (fxRand() - 0.5) * 0.6, vy: v0 * (0.72 + fxRand() * 0.42), vz: (fxRand() - 0.5) * 0.6,
            size: 0.13 + fxRand() * (0.10 + s * 0.06), grow: -0.03,
            ttl: 0.65 + fxRand() * (0.55 + s * 0.12), alpha: 1,
          });
        }
        // the collapse itself: a tight ring snapping INWARD-looking at the hole
        emit({ x: jx, y: sy + 0.03, z: jz, size: 0.30 * s + 0.2, grow: 1.1 * s + 0.5,
               ttl: 0.7 + 0.1 * s, ring: true, ride: true, alpha: 0.7 });
      });
    }
    // ---- the water left behind -------------------------------------------
    // A WASH (a filled patch of churned white, ride without ring) where the
    // thing actually went in, and RINGS travelling away from it. The wash is
    // what stops a big entry leaving a clean hole in the sea.
    //
    // THE SCAR OUTLIVES THE SPLASH. A tonne and a half of animal leaves white
    // water on the sea for SECONDS after the noise has stopped — the old flat
    // `0.8 + 0.2*s` meant a megalodon's entry was gone in 1.4 s and the sea
    // was mirror-clean behind it, which is the tell that nothing had really
    // happened there. It now runs with the cube root of the event, so a diver
    // is unchanged and a big body leaves a mark you can still see when you
    // turn round.
    const scar = 0.8 + 1.5 * Math.cbrt(Math.max(0.2, s)) + (entry ? quality * 0.65 : 0);
    emit({ x: x, y: sy + 0.03, z: z, size: (0.9 * s + 0.4) * width,
           grow: 0.9 * s * width, ttl: scar, ride: true, alpha: 0.45 });
    // and it DRIFTS with whatever went in — a wake, not a stamp
    if (lean > 0.2) {
      emit({ x: x + bx * (0.8 + s) * lean, y: sy + 0.03, z: z + bz * (0.8 + s) * lean,
             size: (0.6 * s + 0.3) * width, grow: 0.7 * s * width,
             ttl: scar * 0.8, ride: true, alpha: 0.34 });
    }
    // THE LEADING CREST is an ARC, not a circle, when the thing was moving:
    // water_wake.js's ring primitive already draws a feathered crest over a
    // bearing (it is how the Kelvin bow wave is drawn) and a body arriving at
    // speed throws exactly that ahead of itself.
    emit({ x: x, y: sy + 0.03, z: z, size: 0.5 * s * width, grow: 2.4 * s * width, ttl: 1.1 + 0.14 * s,
           ring: true, ride: true, alpha: 0.85,
           bear: lean > 0.25 ? bear : 0, arc: lean > 0.25 ? 1.5 : 0 });
    emit({ x: x, y: sy + 0.03, z: z, size: 0.24 * s * width,
           grow: 1.3 * s * width, ttl: 0.85, ring: true, ride: true, alpha: 0.68 });

    /* A clean entry hides energy BELOW the surface instead of deleting it.  The
       narrow atmospheric cavity pinches off, pauses, then returns as seething
       aerated water — the signature competitive divers call a rip entry.  These
       are surface-riding foam patches after the sheet, not a second crown. */
    if (entry && quality > 0.52) {
      const delay = 0.42 + Math.min(0.45, s * 0.055);
      later(delay, function () {
        const n = Math.max(4, Math.min(14, Math.round(4 + s * 1.5)));
        const rr = Math.max(0.28, (+entry.span || 2) * (0.035 + 0.055 * quality));
        for (let i = 0; i < n; i++) {
          const a = fxRand() * Math.PI * 2, r = rr * Math.sqrt(fxRand());
          emit({ x: x + Math.cos(a) * r, y: sy + 0.025, z: z + Math.sin(a) * r,
            size: 0.12 + fxRand() * 0.22 * Math.min(2, s),
            grow: 0.26 + fxRand() * 0.42, ttl: 0.65 + fxRand() * 0.85,
            ride: true, alpha: 0.34 + fxRand() * 0.24 });
        }
      });
    }
  }

  // ============================================================
  //  5. THE BLAST STAGING — a scheduler, because the beat is the point
  // ============================================================
  // A depth charge is not one event: it is a dome, then a column, then rain.
  // Firing them together is what makes an underwater detonation read as a
  // firework. These are plain {t, fn} records drained by the tick below.
  const pending = [];
  function later(t, fn) { pending.push({ t: t, fn: fn }); }

  // opts: { power, radius }. `y` is the detonation point, `sy` the live
  // surface directly above it, so `depth` is how deep the charge went off.
  function fxBlast(x, y, z, sy, power, depth) {
    const P = clamp(power, 0.2, 3.2);

    // ---- STAGE 1 (t=0): the UNDERWATER DOME -------------------------------
    // A brief bubble flash at the detonation point. These are ballistic beads
    // launched UPWARD from depth, so they read as gas boiling out of the charge
    // and breaking the surface — which is also why they survive the pool's
    // "kill anything sinking below the surface" rule.
    if (depth > 0.25) {
      const nDome = Math.max(3, Math.min(Math.round(5 + P * 5), Math.round(free() * 0.3)));
      for (let i = 0; i < nDome; i++) {
        const a = fxRand() * Math.PI * 2;
        const r = fxRand() * (0.4 + P * 0.6);
        emit({
          x: x + Math.cos(a) * r, y: y + fxRand() * 0.4, z: z + Math.sin(a) * r,
          vx: Math.cos(a) * (0.8 + fxRand() * 1.2 * P),
          vy: 2.2 + fxRand() * 2.6 + depth * 0.35,
          vz: Math.sin(a) * (0.8 + fxRand() * 1.2 * P),
          size: 0.18 + fxRand() * 0.28 * P, grow: 0.35,
          ttl: 0.5 + fxRand() * 0.5 + depth * 0.05, alpha: 0.5,
        });
      }
    }
    // the flat flash on the surface directly above the charge
    emit({ x: x, y: sy + 0.03, z: z, size: 0.35 * P, grow: 6.5 * P, ttl: 0.45, ring: true, ride: true, alpha: 0.9 });

    // ---- STAGE 2: the COLUMN ----------------------------------------------
    // A tall foam shaft erupting at the surface directly above the charge, its
    // height scaling with yield. Delayed by the shock's travel up through the
    // water, and emitted in three waves so it visibly RISES instead of popping.
    const v0 = 8.5 + P * 6.5;                    // apex ~ v0^2 / 2g
    const t2 = 0.05 + depth * 0.045;
    const waves = 3;
    const nCol = Math.max(4, Math.min(Math.round((CBZ.qScale ? CBZ.qScale(7, 22) : 16) * Math.min(2.2, P)), 34));
    // The shaft itself is real geometry — a TALL, NARROW crown, which is
    // exactly what a depth charge throws and what a body entry does not. Same
    // primitive as the entry sheet, different proportions; there is no second
    // column implementation to keep in step.
    later(t2, function () {
      if (!CBZ.waterCrown) return;
      CBZ.waterCrown({
        x: x, z: z,
        r: 0.5 + P * 0.55, grow: 0.7 + P * 0.6,
        h: 5.0 + P * 6.0, ttl: 1.1 + P * 0.25, alpha: 0.68,
      });
    });
    for (let w = 0; w < waves; w++) {
      later(t2 + w * 0.06, function () {
        const per = Math.max(1, Math.min(Math.round(nCol / waves), Math.round(free() * 0.35)));
        const spread = 0.30 + P * 0.26;
        for (let i = 0; i < per; i++) {
          const a = fxRand() * Math.PI * 2;
          const r = fxRand() * spread;
          emit({
            x: x + Math.cos(a) * r, y: sy + 0.05, z: z + Math.sin(a) * r,
            vx: Math.cos(a) * (0.5 + fxRand() * 0.9),
            vy: v0 * (0.68 + fxRand() * 0.46),
            vz: Math.sin(a) * (0.5 + fxRand() * 0.9),
            size: 0.22 + fxRand() * 0.24 * P, grow: 0.30,
            ttl: 1.5 + fxRand() * 1.1, alpha: 1,
          });
        }
        if (w === 0) {
          // the foam ring the column drives outward across the surface
          emit({ x: x, y: sy + 0.03, z: z, size: 0.6 * P, grow: 4.2 * P, ttl: 1.9, ring: true, ride: true, alpha: 0.9 });
          emit({ x: x, y: sy + 0.03, z: z, size: 0.3 * P, grow: 2.2 * P, ttl: 1.3, ring: true, ride: true, alpha: 0.7 });
        }
      });
    }

    // ---- STAGE 3: FALLING SPRAY -------------------------------------------
    // Delayed by roughly the column's RISE TIME, then rained back down from the
    // apex ring. This is the beat that sells the scale: the water goes up, and
    // a moment later it comes back.
    const rise = v0 / GRAV;
    const apex = sy + (v0 * v0) / (2 * GRAV) * 0.5;
    later(t2 + rise * 0.85, function () {
      const n = Math.max(3, Math.min(Math.round(5 + P * 7), Math.round(free() * 0.35)));
      const rr = 0.7 + P * 1.1;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + fxRand() * 0.6;
        const r = rr * (0.4 + fxRand() * 0.8);
        emit({
          x: x + Math.cos(a) * r,
          y: sy + (apex - sy) * (0.55 + fxRand() * 0.45),
          z: z + Math.sin(a) * r,
          vx: Math.cos(a) * (0.7 + fxRand() * 1.3),
          vy: -0.5 - fxRand() * 1.6,
          vz: Math.sin(a) * (0.7 + fxRand() * 1.3),
          size: 0.12 + fxRand() * 0.18 * P, grow: -0.01,
          ttl: 1.5 + fxRand() * 1.0, alpha: 0.85,
        });
      }
    });
    // ...and the wide settling wash left once the spray has landed.
    later(t2 + rise * 0.85 + 0.55, function () {
      emit({ x: x, y: sy + 0.03, z: z, size: 0.9 * P, grow: 3.0 * P, ttl: 2.1, ring: true, ride: true, alpha: 0.45 });
    });
  }

  // PUBLIC: stage a depth charge directly. Anything that detonates in or on
  // water (a future naval mission, a scuttled hull, a sunk mine) gets the whole
  // three-stage beat in one line without going through cityExplosion.
  CBZ.waterBlastAt = function (x, y, z, opts) {
    if (off() || CFG.WATER_IMPACT_BLAST === false) return false;
    x = +x; z = +z;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    if (!overWater(x, z)) return false;
    opts = opts || {};
    const sy = surfY(x, z);
    const by = Number.isFinite(+y) ? +y : sy;
    const power = clamp(+opts.power || 1, 0.15, 4);
    fxBlast(x, Math.min(by, sy), z, sy, power, Math.max(0, sy - by));
    playHit(x, sy, z, clamp(0.55 + power * 0.18, 0.3, 1), "blast");
    fire(x, sy, z, "blast", power, power * 600, Math.max(0, sy - by), opts.by || null, opts.src || null);
    return true;
  };

  // ============================================================
  //  6. UNDERWATER LETHALITY
  // ============================================================
  // Research and every shipped game agree on the same simplification: a blast
  // underwater does NOT usefully reach far past the charge, but inside that
  // radius it is not survivable — water is incompressible, so the shock couples
  // straight into anything soft. So: a TIGHTER radius than the air blast, but
  // reliably lethal inside it, and only against things ACTUALLY submerged
  // (someone standing on the quay ten metres away is untouched by this path;
  // the normal air-blast damage cityExplosion already applied still governs
  // them). Runs once per blast — opts._waterSeen guards the caller.
  function blastLethal(x, sy, z, R, opts) {
    const LR = clamp(R * 0.75, 3, 14);
    const LR2 = LR * LR;
    const by = (opts && (opts.by || opts.attacker)) || null;
    const byPlayer = !!(opts && opts.byPlayer);

    // --- the player -------------------------------------------------------
    const P = CBZ.player;
    if (P && P.pos && !P.dead) {
      // THE BODY, never the camera. cityCameraSubmerged() used to be OR'd in
      // here, but that is the chase camera's state, not the player's: a
      // third-person camera dips under a crest routinely while you are stood
      // dry on a boat deck, and this branch is an unconditional 999-damage
      // kill. The two tests below are the body's own: swimming, or feet under
      // the live surface over water (a sinking car, a deep wade).
      const submerged = (CBZ.citySwimming && CBZ.citySwimming()) ||
        (P.pos.y < sy - 0.2 && overWater(P.pos.x, P.pos.z));
      if (submerged) {
        const dx = P.pos.x - x, dz = P.pos.z - z;
        if (dx * dx + dz * dz <= LR2 && CBZ.cityHurtPlayer) {
          try { CBZ.cityHurtPlayer(999, x, z, "underwater blast", false, by); } catch (e) {}
        }
      }
    }

    // --- peds and corpses in the water ------------------------------------
    const peds = CBZ.cityPeds;
    if (peds && peds.length && CBZ.cityKillPed) {
      for (let i = 0; i < peds.length; i++) {
        const p = peds[i];
        if (!p || p.dead || !p.pos) continue;
        const dx = p.pos.x - x, dz = p.pos.z - z;
        if (dx * dx + dz * dz > LR2) continue;
        if (p.pos.y > sy + 0.6) continue;                  // standing on a deck/quay
        if (!overWater(p.pos.x, p.pos.z)) continue;        // not actually in the water
        try {
          CBZ.cityKillPed(p, { fromX: x, fromZ: z, attacker: by, byPlayer: byPlayer, force: 7, fling: 3 }, "explosion");
        } catch (e) {}
      }
    }
    // Wildlife, swimmers spawned by other systems and anything else in the bay
    // react through the listener bus (the "blast" event carries the radius via
    // `strength`), so this file never has to know they exist.
  }

  // ============================================================
  //  7. THE BLOCK — CBZ.waterHit
  // ============================================================
  const stats = { bullet: 0, body: 0, vehicle: 0, debris: 0, blast: 0, drop: 0 };
  let lastEntryProfile = null;
  let frameBullets = 0;             // per-frame bullet-splash cap (minigun into the bay)
  const hasKind = function (k) { return Object.prototype.hasOwnProperty.call(KINDS, k); };

  CBZ.waterHit = function (x, y, z, opts) {
    if (off()) return false;
    x = +x; y = +y; z = +z;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    // THE ONE-LINE-ADOPTION CONTRACT: not over water, or well clear above the
    // live surface -> return false immediately, having done nothing. Callers
    // may therefore call this unconditionally on any impact anywhere.
    if (!overWater(x, z)) return false;

    opts = opts || {};
    // hasOwnProperty, not truthiness — an unknown kind string must fall back to
    // "debris", and a prototype key ("constructor") must never resolve.
    const kind = hasKind(opts.kind) ? opts.kind : "debris";
    const K = KINDS[kind];
    const sy = surfY(x, z);
    const above = y - sy;
    if (above > K.clear) return false;

    // ---- MOMENTUM sizes everything ---------------------------------------
    // sqrt(mass) * speed, not raw speed: at the same speed a dropped body has
    // to displace ~100x the water a bullet does, and that is what the eye reads.
    const mass = (+opts.mass > 0) ? +opts.mass : K.mass;
    const speed = (+opts.speed > 0) ? +opts.speed : K.speed;
    const entry = entryOn() && opts.entry && typeof opts.entry === "object" ? opts.entry : null;
    /* Source mass is not automatically added mass.  A ninety-tonne shark
       spearing through its nose does not accelerate ninety tonnes of water on
       the first frame; the same body landing across its flank can.  `coupling`
       is the waterline owner's projected-area/add-mass solve.  Defaults to one,
       so every non-marine caller preserves its historical calibration. */
    const coupling = entry
      ? clamp(Number.isFinite(+opts.coupling) ? +opts.coupling : (+entry.coupling || 1), 0.025, 1.4)
      : 1;
    const mom = Math.sqrt(mass) * speed * coupling;
    const strength = clamp(Math.pow(mom / MOM_REF, MOM_EXP), K.min, K.max);
    // ONE scalar, TWO consumers: the same momentum drives the VFX size above
    // and the audio gain/pitch below.
    const loud = clamp(Math.log10(1 + mom / 6) * 0.5, 0.04, 1);
    const depth = Math.max(0, -above);

    stats[kind]++;

    if (entry) {
      lastEntryProfile = {
        quality: +clamp(+entry.quality || 0, 0, 1).toFixed(3),
        area: +clamp(+entry.area || 0, 0, 1).toFixed(3),
        coupling: +coupling.toFixed(3), mass: Math.round(mass),
        speed: +speed.toFixed(2), momentum: +mom.toFixed(2),
        strength: +strength.toFixed(3), phase: entry.phase || "body",
      };
    }

    /* The impact changes THE SURFACE before any card or droplet is drawn over
       it.  Generic body/vehicle/debris entries get the neutral shape; a marine
       entry supplies its measured projected area and body span. */
    if (entryOn() && typeof CBZ.waterSurfaceImpulse === "function" &&
        (kind === "body" || kind === "vehicle" || kind === "debris")) {
      const area = entry ? clamp(+entry.area || 0, 0.04, 1) : 0.58;
      const span = entry ? Math.max(0.8, +entry.span || 2) : Math.max(1, strength * 1.2);
      try {
        CBZ.waterSurfaceImpulse(x, z, {
          amplitude: clamp(0.025 + strength * (0.055 + area * 0.085), 0.035, 1.25),
          radius: clamp(span * (0.055 + area * 0.19), 0.28, 8.5),
          speed: clamp(2.2 + strength * (0.65 + area * 0.55), 1.5, 13),
          life: clamp(1.15 + strength * 0.34 + span * 0.025, 1.1, 4.8),
        });
      } catch (e) {}
    }

    // ---- the calibrated vocabulary ---------------------------------------
    if (kind === "bullet") {
      // A burst of automatic fire into the bay must not eat the whole pool.
      if (frameBullets < 5) { frameBullets++; fxBullet(x, sy, z, strength); }
    } else if (kind === "drop") {
      fxDrop(x, sy, z, strength);
    } else if (kind === "blast") {
      // A blast is sized by YIELD, not by momentum — opts.power wins when the
      // caller knows it (every ordnance path does).
      fxBlast(x, Math.min(y, sy), z, sy, (+opts.power > 0 ? clamp(+opts.power, 0.15, 4) : strength), depth);
    } else if (kind === "debris") {
      fxCrown(x, sy, z, strength, 0, +opts.vx || 0, +opts.vz || 0, entry);   // compact crown, no jet
    } else {
      // body / vehicle: crown + rebound jet + settling ring. A vehicle lands
      // flatter and wider than a diver, so its jet is damped a little.
      // opts.vx/vz (optional) is the horizontal velocity it arrived with, and
      // it leans the whole event downrange — see fxCrown.
      const jet = (kind === "vehicle" ? 0.75 : 1) *
        (entry ? (0.42 + clamp(+entry.area || 0, 0, 1) * 0.82) : 1);
      fxCrown(x, sy, z, strength, jet, +opts.vx || 0, +opts.vz || 0, entry);
    }

    if (!opts.quiet) playHit(x, sy, z, loud, kind);
    fire(x, sy, z, kind, strength, mom, depth, opts.by || null, opts.src || null);
    return true;
  };

  // ============================================================
  //  8. THE WRAPPERS — every existing caller becomes water-aware for free
  // ============================================================
  // THE EXPLOSION-WRAPPER LAW (CLAUDE.md): copy EVERY *Wrapped marker forward
  // onto the replacement function, or a sibling module's idempotence guard
  // stops working and the chain re-wraps itself in layers. armored.js and
  // wildlife.js are the canonical shapes; this is the same one, factored.
  function chain(orig, wrapped, mark) {
    for (const k in orig) if (/Wrapped$/.test(k)) wrapped[k] = orig[k];
    wrapped[mark] = true;
    return wrapped;
  }

  // Re-entry flag: while the ORIGINAL CBZ.tracer is running, its own pavement-
  // plane stamp (gunfx.js:288-295) calls CBZ.bulletHole + CBZ.bulletImpact — the
  // two functions we also wrap. Over water we still want those suppressed, but
  // we do NOT want two water hits for one round: the tracer wrap emits the one
  // true hit at the real surface crossing afterwards, which is metres from the
  // y=0.09 pavement point on a shallow shot.
  let inTracer = false;

  // Shared test for the bulletImpact/bulletHole wraps.
  // Returns true when the land FX must be suppressed.
  function bulletOverWater(pos, opts) {
    if (off() || !pos) return false;
    if (opts && opts.noWater) return false;
    const x = +pos.x, y = +pos.y, z = +pos.z;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    if (!overWater(x, z)) return false;
    const sy = surfY(x, z);
    if (y - sy > 1.2) return false;               // genuinely clear of the water
    if (inTracer) return true;                    // the tracer wrap owns this round
    return CBZ.waterHit(x, Math.min(y, sy), z, {
      kind: "bullet",
      speed: opts && +opts.speed > 0 ? +opts.speed : undefined,
      by: (opts && (opts.shooter || opts.by)) || null,
    });
  }

  // THE UNIVERSAL BULLET HOOK. Every shot in the game — player, NPC, cop,
  // chopper, turret — draws a tracer, so this segment IS the round's whole
  // path. Intersect it with the LIVE sea surface (not a flat plane: the swell
  // moves +-0.42m and the entry must land on the crest you can see) and emit
  // the hit at the true crossing. This is what catches the very common case
  // where a round hit nothing at all — hitscan resolution has no final else,
  // so those shots previously produced no impact call anywhere.
  function shotWaterEntry(from, to) {
    if (off() || !from || !to) return;
    const g = CBZ.game;
    if (!g || !(CBZ.waterModeOn ? CBZ.waterModeOn() : g.mode === "city")) return;
    const y0 = +from.y, y1 = +to.y;
    if (!Number.isFinite(y0) || !Number.isFinite(y1)) return;
    // The highest crest ANYWHERE right now. This used to be the flat
    // WATER_SWELL_AMP (0.42m, the SHORE amplitude); world/water_spec.js's
    // depth-scaled swell makes the open ocean up to ~2.7x that in calm weather
    // and ~1.6m in a squall, so the old constant rejected genuine hits on a
    // deep-water crest and every round fired into open sea went unsplashed.
    // Derived live from the same two gains the vertex program multiplies by.
    if (y1 > seaY() + crestCeiling()) return;                  // never reached the water
    if (y0 <= y1) return;                                      // rising shot: no entry
    // first pass against the mean sea plane, then refine against the live swell
    // at the resulting XZ — one iteration is plenty for a 0.42m amplitude.
    let t = (y0 - seaY()) / (y0 - y1);
    if (!(t >= 0 && t <= 1)) return;
    let px = from.x + (to.x - from.x) * t;
    let pz = from.z + (to.z - from.z) * t;
    if (!overWater(px, pz)) return;
    const sy = surfY(px, pz);
    t = (y0 - sy) / (y0 - y1);
    if (!(t >= 0 && t <= 1)) return;
    px = from.x + (to.x - from.x) * t;
    pz = from.z + (to.z - from.z) * t;
    if (!overWater(px, pz)) return;
    CBZ.waterHit(px, surfY(px, pz), pz, { kind: "bullet" });
  }

  function wrapTracer() {
    const orig = CBZ.tracer;
    if (typeof orig !== "function") return false;
    if (orig._waterWrapped) return true;
    const wrapped = function (from, to, opts) {
      const prev = inTracer;
      inTracer = true;
      let r;
      try { r = orig.apply(this, arguments); } finally { inTracer = prev; }
      try { shotWaterEntry(from, to); } catch (e) {}
      return r;
    };
    CBZ.tracer = chain(orig, wrapped, "_waterWrapped");
    return true;
  }

  function wrapBulletImpact() {
    const orig = CBZ.bulletImpact;
    if (typeof orig !== "function") return false;
    if (orig._waterWrapped) return true;
    const wrapped = function (pos, normal, opts) {
      let handled = false;
      try { handled = bulletOverWater(pos, opts); } catch (e) {}
      if (handled) return;                        // no dust, no sparks, no chips
      return orig.apply(this, arguments);
    };
    CBZ.bulletImpact = chain(orig, wrapped, "_waterWrapped");
    return true;
  }

  function wrapBulletHole() {
    const orig = CBZ.bulletHole;
    if (typeof orig !== "function") return false;
    if (orig._waterWrapped) return true;
    const wrapped = function (pos, normal, opts) {
      let handled = false;
      try { handled = bulletOverWater(pos, opts); } catch (e) {}
      if (handled) return null;                   // THE floating-bullet-hole fix
      return orig.apply(this, arguments);
    };
    CBZ.bulletHole = chain(orig, wrapped, "_waterWrapped");
    return true;
  }

  // cityExplosion / cityAirstrikeExplosion — the single ordnance chokepoint
  // every RPG, grenade, C4 and airstrike routes through.
  function wrapBoom(name) {
    const orig = CBZ[name];
    if (typeof orig !== "function") return false;
    if (orig._waterWrapped) return true;
    const wrapped = function (x, z, opts) {
      // Normalise opts BEFORE calling through so the whole downstream wrapper
      // chain sees the same object our _waterSeen guard is stamped on.
      opts = opts || {};
      let water = false;
      let hadAirburst, touchedAirburst = false;
      try {
        water = !off() && CFG.WATER_IMPACT_BLAST !== false && overWater(x, z);
        if (water) {
          const sy = surfY(x, z);
          const cy = opts.y != null ? +opts.y : 1.0;
          if (cy - sy > 6) water = false;         // a high airburst is not a water blast
        }
        // IDEMPOTENT PER BLAST (the demolition.js _demoSeen pattern): the wrap
        // chain can end up layered more than once when a sibling re-wraps
        // without carrying our marker forward, and the SAME opts object flows
        // through every layer. One blast, one staging.
        if (water) {
          if (opts._waterSeen) water = false;
          else opts._waterSeen = true;
        }
        // No concrete chunks raining into the sea. crashfx.js already has the
        // right gate for this (opts.airburst skips the solid debris spray) —
        // reuse it rather than inventing a parallel suppression. It is a
        // TRANSIENT instruction for this one call and is restored afterwards,
        // never a permanent edit to a caller's (possibly reused) opts object.
        if (water) {
          hadAirburst = opts.airburst;
          touchedAirburst = true;
          opts.airburst = true;
        }
      } catch (e) { water = false; }

      let r;
      try {
        r = orig.call(this, x, z, opts);
      } finally {
        if (touchedAirburst) {
          if (hadAirburst === undefined) delete opts.airburst;
          else opts.airburst = hadAirburst;
        }
      }

      if (water) {
        try {
          const sy = surfY(x, z);
          const cy = opts.y != null ? +opts.y : 1.0;
          const power = clamp(+opts.power || (name === "cityAirstrikeExplosion" ? 2 : 1), 0.15, 4);
          const R = (+opts.radius || (name === "cityAirstrikeExplosion" ? 12 : 6)) * power;
          fxBlast(x, Math.min(cy, sy), z, sy, power, Math.max(0, sy - cy));
          playHit(x, sy, z, clamp(0.6 + power * 0.16, 0.35, 1), "blast");
          stats.blast++;
          if (!opts.noDamage) blastLethal(x, sy, z, R, opts);
          fire(x, sy, z, "blast", power, power * 600, Math.max(0, sy - cy),
            opts.by || opts.attacker || null, opts.src || null);
        } catch (e) {}
      }
      return r;
    };
    CBZ[name] = chain(orig, wrapped, "_waterWrapped");
    return true;
  }

  // Thrown ordnance (used by the entry detector in section 9): combat.js keeps
  // its grenade records module-private, but it asks CBZ.grenadeMesh for the
  // visual and then writes that mesh's position every frame — so wrapping the
  // FACTORY hands us a read-only handle on every live grenade without touching
  // combat.js. (See the report seam: the grenade itself still RESTS on the city
  // datum y=0, ~0.6m above the sea, because combat.js seats it with
  // CBZ.floorAt; only the splash is ours to give.)
  const grenades = [];
  function wrapGrenadeMesh() {
    const orig = CBZ.grenadeMesh;
    if (typeof orig !== "function") return false;
    if (orig._waterWrapped) return true;
    const wrapped = function () {
      const m = orig.apply(this, arguments);
      if (m && grenades.length < 24) grenades.push({ m: m, t: 0 });
      return m;
    };
    CBZ.grenadeMesh = chain(orig, wrapped, "_waterWrapped");
    return true;
  }

  // ---- lazy install (the killfeed.js retry pattern) -------------------------
  // Some of these do not exist at our parse time depending on load order, and
  // siblings that re-wrap without carrying our marker forward can drop us out
  // of the chain. Retry on a short interval, capped, so re-installs can never
  // stack without bound.
  const WRAPS = [
    { name: "tracer", fn: wrapTracer, n: 0 },
    { name: "bulletImpact", fn: wrapBulletImpact, n: 0 },
    { name: "bulletHole", fn: wrapBulletHole, n: 0 },
    { name: "cityExplosion", fn: function () { return wrapBoom("cityExplosion"); }, n: 0 },
    { name: "cityAirstrikeExplosion", fn: function () { return wrapBoom("cityAirstrikeExplosion"); }, n: 0 },
  ];
  const MAX_INSTALLS = 3;
  function installWraps() {
    let allDone = true;
    for (let i = 0; i < WRAPS.length; i++) {
      const w = WRAPS[i];
      const target = CBZ[w.name];
      if (typeof target !== "function") { allDone = false; continue; }
      if (target._waterWrapped) continue;
      if (w.n >= MAX_INSTALLS) continue;
      try { if (w.fn()) w.n++; } catch (e) {}
      if (!(CBZ[w.name] && CBZ[w.name]._waterWrapped)) allDone = false;
    }
    // the thrown-ordnance observer (see the entry detector below) rides the
    // same retry — it is not an FX seam, so it stays out of WRAPS/the audit.
    try { if (!wrapGrenadeMesh()) allDone = false; } catch (e) { allDone = false; }
    return allDone;
  }
  installWraps();
  // RE-INSTALL FOR THE WHOLE SESSION, not for ten seconds.
  //
  // THE BUG THIS REPLACES: the old form was `if (!installWraps()) setInterval(
  // ..., 250)` capped at 40 tries. Two neighbours re-wrap CBZ.cityExplosion
  // LAZILY from their own updaters — city/wildlife.js:1567 copies every marker
  // forward (harmless), but city/armored.js:434 preserves ONLY _structWrapped
  // and therefore DROPS _waterWrapped every time it installs after us. Its
  // wrap fires from an updater at order 54.3, i.e. only once the game is
  // actually PLAYING, which on a headless boot is well past the 10-second
  // window — and if the first synchronous install had succeeded no interval
  // was started at all. Either way waterImpactAudit() then reported
  // {unwrapped:1} forever, which is exactly the number the gate pins.
  //
  // (The blast itself was never lost — armored wraps OUR wrapper, so we stay
  // in the chain — but the marker is the ratchet's only evidence, and without
  // it the retry cannot tell a live seam from a dead one.)
  //
  // MAX_INSTALLS still caps the total per name, so re-installs can never stack
  // without bound, and opts._waterSeen keeps a doubled layer idempotent.
  let wrapRetryT = 0;
  function retryWraps(dt) {
    wrapRetryT -= dt;
    if (wrapRetryT > 0) return;
    wrapRetryT = 1.0;
    try { installWraps(); } catch (e) {}
  }

  // ============================================================
  //  9. THE ENTRY DETECTOR — cars, corpses and thrown ordnance
  // ============================================================
  // Passive and observational: it reads positions vehicles.js / peds.js /
  // combat.js already wrote this frame and looks for a body crossing the live
  // surface. This is what makes "a car crashing into the bay" splash without
  // touching city/vehicles.js. Throttled to 20Hz, peds walked round-robin, so
  // the cost is a bounded handful of shore queries per pass.
  const ENTRY_DT = 1 / 20;
  let entryAcc = 0, pedCursor = 0;
  const PED_SLICE = 32;

  function checkEntry(obj, px, py, pz, kind, mass, horizSpeed, dt) {
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return;
    const prevY = obj._wiY;
    obj._wiY = py;
    if (prevY == null) { obj._wiWet = 0; return; }
    if (!overWater(px, pz)) { obj._wiWet = 0; return; }
    const sy = surfY(px, pz);
    const wet = py <= sy + 0.25 ? 1 : 0;
    if (wet && !obj._wiWet) {
      const fall = Math.max(0, (prevY - py) / Math.max(1e-3, dt));
      const spd = Math.max(1.4, Math.hypot(horizSpeed || 0, fall));
      CBZ.waterHit(px, sy, pz, { kind: kind, mass: mass, speed: spd, src: obj });
    }
    obj._wiWet = wet;
  }

  function sweepEntries(dt) {
    if (CFG.WATER_IMPACT_ENTRY === false) return;

    // --- vehicles (small array, every pass) --------------------------------
    const cars = CBZ.cityCars;
    if (cars && cars.length) {
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        if (!c || !c.pos) continue;
        const body = (c.model && c.model.body) || "";
        // A boat is SUPPOSED to be on the water — it must never register an
        // entry. Same marine test water_wake.js's wake emitter uses.
        const feel = c._playerCarFeel;
        if (feel ? feel.marine : body === "boat") { c._wiY = c.pos.y; c._wiWet = 1; continue; }
        const mass = (body === "truck" || body === "bus") ? 4200 : 1400;
        // THE HEIGHT IS ON THE GROUP, NOT ON pos. THIS DETECTOR NEVER FIRED.
        // city/vehicles.js writes the ride height straight into
        // car.group.position (seatCar():325 for traffic, :4840 for the driven
        // car) and never touches car.pos.y at all — it stays at whatever the
        // record was constructed with, i.e. 0, forever. So `wet = py <= sy +
        // 0.25` was asking "is 0 below the sea", the sea is at about -0.48,
        // and the answer was no for every car in the game in every frame.
        // A car driven off a quay made no splash, ever, and this is why.
        const cy = (c.group && c.group.position) ? c.group.position.y : c.pos.y;
        checkEntry(c, c.pos.x, cy, c.pos.z, "vehicle", mass, Math.abs(+c.v || 0), dt);
      }
    }

    // --- peds and corpses (round-robin slice) ------------------------------
    // The PLAYER is deliberately excluded: city/swim.js already announces the
    // player's entry through CBZ.waterSplashAt, which now routes to this bus.
    const peds = CBZ.cityPeds;
    if (peds && peds.length) {
      const n = Math.min(PED_SLICE, peds.length);
      for (let k = 0; k < n; k++) {
        if (pedCursor >= peds.length) pedCursor = 0;
        const p = peds[pedCursor++];
        if (p && p.pos) checkEntry(p, p.pos.x, p.pos.y, p.pos.z, "body", 78, 0, dt * (peds.length / Math.max(1, n)));
      }
    }

    // --- thrown ordnance ---------------------------------------------------
    for (let i = grenades.length - 1; i >= 0; i--) {
      const rec = grenades[i];
      rec.t += dt;
      const m = rec.m;
      // detonated / removed from the scene / a static shop prop that will never
      // move: drop it. 14s comfortably outsits the grenade fuse.
      if (!m || rec.t > 14 || (rec.t > 0.5 && !m.parent)) { grenades.splice(i, 1); continue; }
      checkEntry(rec, m.position.x, m.position.y, m.position.z, "debris", 0.45, 0, dt);
    }
  }

  // ============================================================
  //  10. THE TICK — drain the blast scheduler, run the entry sweep
  // ============================================================
  // Order PRESENTATION - 0.02: a hair BEFORE world/water_wake.js integrates and
  // publishes its buffer (PRESENTATION), so anything staged this frame draws
  // this frame instead of one late; and after vehicles/buoyancy/swim have
  // settled every position the entry sweep reads.
  CBZ.onUpdate(CBZ.PRIO ? CBZ.PRIO.PRESENTATION - 0.02 : 59.98, function (dt) {
    frameBullets = 0;
    dt = Math.min(0.1, dt || 0);
    retryWraps(dt);                  // a sibling may have dropped our marker

    // The blast scheduler runs even with the bus flag off mid-stage, so a
    // half-staged detonation always finishes rather than freezing its column.
    if (pending.length) {
      for (let i = pending.length - 1; i >= 0; i--) {
        const p = pending[i];
        p.t -= dt;
        if (p.t <= 0) {
          pending.splice(i, 1);
          try { p.fn(); } catch (e) {}
        }
      }
      if (pending.length > 64) pending.length = 64;      // never unbounded
    }

    if (off()) return;
    const g = CBZ.game;
    // waterSplashAt() delegates HERE first (the body-class entry), so with this
    // gate shut the island lost the splash twice over — once in the impact bus
    // and once in the wake pool it falls through to.
    if (!g || !(CBZ.waterModeOn ? CBZ.waterModeOn() : g.mode === "city")) { entryAcc = 0; return; }

    entryAcc += dt;
    if (entryAcc >= ENTRY_DT) {
      const step = entryAcc;
      entryAcc = 0;
      try { sweepEntries(step); } catch (e) {}
    }
  });

  // ============================================================
  //  11. PROBES
  // ============================================================
  // Live counters for headless probes (CBZ.stepSim bursts): how many hits of
  // each kind the bus has handled, plus how much staging is still in flight.
  CBZ.waterImpactStats = function () {
    return {
      bullet: stats.bullet, body: stats.body, vehicle: stats.vehicle,
      debris: stats.debris, blast: stats.blast, drop: stats.drop,
      pending: pending.length, listeners: listeners.length,
      grenades: grenades.length,
      lastEntry: lastEntryProfile ? Object.assign({}, lastEntryProfile) : null,
    };
  };

  // RATCHET (the block law, item 5). `unwrapped` counts shared FX entry points
  // that EXIST but are not routed through the water bus — i.e. seams where a
  // land effect can still land on the sea. It must only ever go DOWN; pin it at
  // 0 in tools/math-gate.mjs's PASS block, the way CBZ.treeAudit() is pinned.
  // `unbussed` counts water-FX call sites that still bypass CBZ.waterHit.
  CBZ.waterImpactAudit = function () {
    let unwrapped = 0;
    const names = [];
    for (let i = 0; i < WRAPS.length; i++) {
      const w = WRAPS[i];
      const f = CBZ[w.name];
      if (typeof f !== "function") continue;      // not loaded in this build: not a seam
      if (!f._waterWrapped) { unwrapped++; names.push(w.name); }
    }
    return { unwrapped: unwrapped, names: names, listeners: listeners.length };
  };

  CBZ.waterImpactReady = true;
})();

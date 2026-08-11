/* ============================================================
   systems/fixtures.js — A LIGHT IS A RECORD, AND DARKNESS IS A FACT.

   THE QUESTION EVERY GAME WITH A NIGHT IN IT HAS TO ANSWER is not "is the sun
   down" — it is "HOW LIT IS THIS POINT", because that is the number a guard's
   cone, a camera's reach, a plant's growth and a stealth meter all actually
   want. Testing the sun instead is how a sealed windowless room ends up as
   bright as the field outside it, and how a night becomes a colour grade.

   So this file owns three things and nothing else:

     1. A FIXTURE REGISTRY. One record per light — where it is, how far it
        throws, what KIND it is, and (optionally) the mesh whose material is
        its own bulb. A registered mesh is driven for free: colour, emissive,
        emissive intensity, and the opacity of a floor pool or an air beam.
        A fixture that joins never writes an updater.
     2. `level(x, z)` — 0..1 light on a point, region-aware. A LAMP DOES NOT
        SHINE THROUGH A WALL: light crosses a region boundary only as the
        fraction of SKY that region's windows admit, which is the one line
        that stops the mast outside the armoury lighting the armoury.
     3. `scale(sensor, x, z)` — what a sensor's range is worth here. In the
        black it keeps `minSight` of it; a sensor carrying its own light
        (`sensor.flashlightOn`) buys the whole range back inside the beam,
        which is the entire night-stealth trade in one function.

   A REGION IS A RECT WITH TWO NUMBERS. `window` is the share of sky that gets
   in (0.55 = barred openings, 0.35 = small panes, 0 = sealed); `ambient` is
   the region's own baseline while its fittings burn, as a number or a
   function the owner drives. Points in no region are OUTSIDE and get the sky,
   plus whatever `spec.outdoor` wants to add (a sweeping beam, a fire).

       const rig = CBZ.fixtures.rig("clinic", {
         kinds: { ward: { day: 1, out: 0.2 }, lot: { day: 1, out: 1, darkOnly: true } },
         lightsOut: function () { return plan.is("night"); },
         tick: 21.5, nightFloor: 0.34,
       });
       rig.region({ id: "ward", x0: -8, x1: 8, z0: 0, z1: 20, window: 0.35 });
       rig.register({ x: 0, z: 6, r: 9, kind: "ward", mesh: lamp });
       rig.level(3, 5);                    //   0..1
       rig.scale(guard, 3, 5);             //   what he can see from here

   A KIND IS A SCHEDULE, not a shape: `{ day, out, darkOnly }` — what it burns
   at while the lights are on, what survives lights-out, and whether it is a
   dusk-to-dawn fitting that is simply off in daylight. Kinds are LIVE records:
   a difficulty tier turns a regime up by writing `rig.kinds.ward.out`, never
   by re-registering anything.

   NO WORLD REQUIRED. `THREE` is touched only by `pointPool()` and only when a
   caller asks for one; everything else is arithmetic over plain records, so a
   six-tag page gets `level()` and `scale()` with no scene, no sun and no
   materials. `sky()` degrades to full daylight when nothing publishes
   `CBZ.dayness`.

   Flag FIXTURES_V1. Ratchet CBZ.fixtureAudit().unknownKinds pinned at 0 (a
   fixture whose kind has no schedule is a light nothing will ever drive) and
   .sightAtNoon pinned at 1 — whatever the dark costs a sensor, broad daylight
   must cost it nothing, or a rig has quietly nerfed the whole detection game.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.FIXTURES_V1 == null) CFG.FIXTURES_V1 = true;
  if (CBZ.fixtures) return;                      // idempotent (family guard idiom)

  const clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };

  /* THE DEFAULT KINDS. Three behaviours cover every fitting anyone has ever
     hung: one that is on while the place is awake, one that only burns after
     hours, and one that answers to the sun. A caller's own table is merged
     over this, so declaring `{ ward: {...} }` keeps all three below. */
  const BASE_KINDS = {
    interior: { day: 1, out: 0.18, darkOnly: false },   // a room lamp
    night:    { day: 0, out: 0.55, darkOnly: false },   // the low fitting that burns all night
    dusk:     { day: 1, out: 1,    darkOnly: true },    // strikes as the sun goes down
  };

  /* HOW BRIGHT THE SKY IS, as a usable 0..1 rather than sin(sun). `dayness` is
     the sine of the sun's height, so it reads 0.26 at seven in the morning —
     true as geometry, wrong as light: the eye saturates within an hour of
     sunrise. x2.2 plus a slice of dusk is the honest curve. */
  function defaultSky() {
    const d = CBZ.dayness == null ? 1 : CBZ.dayness;
    const k = CBZ.duskness || 0;
    return clamp01(d * 2.2 + k * 0.25);
  }

  const rigs = [];

  function rig(id, spec) {
    spec = spec || {};
    const kinds = {};
    for (const k in BASE_KINDS) kinds[k] = { day: BASE_KINDS[k].day, out: BASE_KINDS[k].out, darkOnly: BASE_KINDS[k].darkOnly };
    if (spec.kinds) for (const k in spec.kinds) kinds[k] = spec.kinds[k];

    const fixtures = [];
    const regions = [];
    const pools = [];
    const fallbackKind = spec.defaultKind && kinds[spec.defaultKind] ? spec.defaultKind : "interior";
    const sky = typeof spec.sky === "function" ? spec.sky : defaultSky;
    const enabled = typeof spec.enabled === "function" ? spec.enabled : function () { return CFG.FIXTURES_V1 !== false; };
    const lightsOut = typeof spec.lightsOut === "function" ? spec.lightsOut : function () { return false; };
    const MIN = spec.minSight != null ? spec.minSight : 0.40;   // range that survives total darkness
    const TORCH = spec.torchThrow != null ? spec.torchThrow : 15;
    const TORCH2 = TORCH * TORCH;
    // how fast a dusk fitting strikes: sky * this reaching 1 means "full day"
    const DUSK_GAIN = spec.duskGain != null ? spec.duskGain : 1.7;

    /* ---- REGIONS -------------------------------------------------------
       First hit wins, so a caller registers the tightest rect first. A region
       pushed by somebody else's builder (a wing that appears on the first
       tick) is honoured the moment it lands, because every cached answer is
       stamped with the array LENGTH and re-asked when that changes. */
    function region(r) {
      if (!r) return null;
      regions.push(r);
      return r;
    }
    function regionAt(x, z) {
      for (let i = 0; i < regions.length; i++) {
        const r = regions[i];
        if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return r;
      }
      return null;
    }
    function regionOf(f) {
      if (f._regN !== regions.length) { f._regN = regions.length; f._reg = regionAt(f.x, f.z); }
      return f._reg;
    }
    /* A REGION MAY BE PUSHED STRAIGHT ONTO `regions` BY SOMEBODY ELSE'S
       BUILDER — a wing that appears on the first tick, a room another file
       owns — so neither `window` nor `ambient` may be normalised at register
       time. Both fall back to the RIG's defaults when the record does not say,
       which is what makes a bare {id, x0, x1, z0, z1} behave as an ordinary
       interior instead of a hole in the arithmetic. */
    const DEF_WINDOW = spec.window != null ? spec.window : 0.35;
    function windowOf(r) { return r.window == null ? DEF_WINDOW : r.window; }
    function ambientOf(r) {
      const a = r.ambient != null ? r.ambient : spec.ambient;
      if (a == null) return 1;
      return typeof a === "function" ? (a(r) || 0) : a;
    }

    /* ---- REGISTRATION --------------------------------------------------
       rec.x/z      where it hangs
       rec.r        metres it usefully throws
       rec.kind     which schedule it answers to
       rec.mesh     a mesh with its OWN material (never a shared one) — driven
       rec.pool     a floor circle whose opacity follows the level
       rec.beam     an air cone, same
       rec.on()     an extra veto (a fitting on a dead circuit, a tier's rota)
       rec.powered  false = hard off, whatever the schedule says            */
    function register(rec) {
      if (!rec) return null;
      rec.kind = kinds[rec.kind] ? rec.kind : fallbackKind;
      rec.r = rec.r > 0 ? rec.r : 8;
      rec.level = 0;
      rec.color = rec.color != null ? rec.color : 0xffe9a8;
      rec.emissive = rec.emissive != null ? rec.emissive : 0xffcf66;
      rec.off = rec.off != null ? rec.off : 0x2b2b2b;
      fixtures.push(rec);
      return rec;
    }

    function driveFixture(rec, dark) {
      const L = kinds[rec.kind];
      let v = lightsOut() ? L.out : L.day;
      if (L.darkOnly) v *= dark;                     // a dusk fitting by day is off
      if (rec.on && !rec.on()) v = 0;
      if (rec.powered === false) v = 0;
      rec.level = v;
      const m = rec.mesh && rec.mesh.material;
      if (!m) return;
      const lit = v > 0.02;
      if (m.color) m.color.setHex(lit ? rec.color : rec.off);
      if (m.emissive) m.emissive.setHex(lit ? rec.emissive : 0x000000);
      if (lit && m.emissiveIntensity != null) m.emissiveIntensity = 0.35 + v * 0.75;
      if (rec.pool) rec.pool.material.opacity = v * (rec.poolPeak || 0.3);
      if (rec.beam) rec.beam.material.opacity = v * (rec.beamPeak || 0.09);
    }

    /* ---- HOW MUCH LIGHT IS ON A POINT ----------------------------------
       The one function every sensor should ask instead of testing the sun. */
    function level(x, z) {
      const s = sky();
      const here = regionAt(x, z);
      let L;
      if (here) L = Math.max(ambientOf(here), s * windowOf(here));
      else {
        L = s;
        if (spec.outdoor && L < 0.9) L = Math.max(L, spec.outdoor(x, z, L) || 0);
      }
      if (L >= 0.98) return 1;
      for (let i = 0; i < fixtures.length; i++) {
        const f = fixtures[i];
        if (f.level <= 0.02) continue;
        /* A LAMP DOES NOT SHINE THROUGH A WALL. Without this the mast four
           metres outside a sealed room lights the sealed room, and every
           sensor inside it gets full range on the strength of that. Light
           crosses a boundary only through a window, and windows are priced
           above. */
        if (regionOf(f) !== here) continue;
        const dx = x - f.x, dz = z - f.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > f.r * f.r) continue;
        const fall = 1 - Math.sqrt(d2) / f.r;
        const v = f.level * (0.35 + fall * 0.65);
        if (v > L) L = v;
        if (L >= 0.98) return 1;
      }
      return L;
    }

    /* ---- WHAT A SENSOR GETS --------------------------------------------
       MIN is the floor: even in true black a man still sees a body at arm's
       length. A carried light is the exception that restores the whole range
       — the beam IS the light, so being in it is being lit. */
    function scale(sensor, x, z) {
      if (!enabled()) return 1;
      let L = level(x, z);
      /* WHERE THE SENSOR IS, whatever shape it came in. This read used to be
         `sensor.group.position` only — the shape a ped or a guard has. The
         engine's own PLAYER is not that shape: systems/physics.js's player
         carries `.pos` and no group, and so does every one-shot page that
         writes its own body. So the one clause that makes a carried light
         WORTH carrying silently did nothing for the only actor who carries
         one. Measured in games/night-watch.html: lamp on, thief at 10.4 m in
         a black gallery, still invisible. */
      const sp = sensor && ((sensor.group && sensor.group.position) || sensor.pos);
      if (L < 0.95 && sensor && sensor.flashlightOn && sp) {
        const dx = x - sp.x, dz = z - sp.z;
        if (dx * dx + dz * dz < TORCH2) L = 0.95;
      }
      if (L >= 0.95) return 1;
      return MIN + (1 - MIN) * clamp01(L * 1.5);
    }

    /* ---- POOLED REAL LIGHTS ---------------------------------------------
       r128 evaluates Lambert per VERTEX, so a light is cheap but not free.
       Rather than one per fixture, keep N and point them at the lit fixtures
       NEAREST THE VIEWER: what you are standing under is the only falloff you
       can actually judge. Costs one sort of the (small) fixture list per
       drive and nothing else. */
    function pointPool(n, opt) {
      opt = opt || {};
      if (typeof THREE === "undefined" || !CBZ.scene) return null;
      const parent = opt.parent || CBZ.scene;   // callers with their own root pass it
      const lamps = [];
      for (let i = 0; i < n; i++) {
        const p = new THREE.PointLight(opt.color != null ? opt.color : 0xfff0c8, 0,
          opt.distance || 26, opt.decay != null ? opt.decay : 1.4);
        p.visible = false;
        parent.add(p);
        lamps.push(p);
      }
      const pool = {
        lamps: lamps,
        filter: opt.filter || function (f) { return f.level > 0.05; },
        radius: opt.radius || 44,
        height: opt.height != null ? opt.height : 6.6,
        gain: opt.intensity != null ? opt.intensity : 1.15,
      };
      pools.push(pool);
      return pool;
    }
    const scratch = [];
    function drivePool(pool) {
      const p = (CBZ.player && CBZ.player.pos) || (CBZ.camera && CBZ.camera.position);
      if (!p) return;
      scratch.length = 0;
      for (let i = 0; i < fixtures.length; i++) {
        const f = fixtures[i];
        if (!pool.filter(f)) continue;
        const dx = f.x - p.x, dz = f.z - p.z;
        scratch.push({ f: f, d: dx * dx + dz * dz });
      }
      scratch.sort(function (a, b) { return a.d - b.d; });
      const R2 = pool.radius * pool.radius;
      for (let i = 0; i < pool.lamps.length; i++) {
        const L = pool.lamps[i], pick = scratch[i];
        if (!pick || pick.d > R2) { L.visible = false; L.intensity = 0; continue; }
        L.visible = true;
        L.position.set(pick.f.x, pool.height, pick.f.z);
        L.intensity = pool.gain * pick.f.level;
      }
    }

    /* ---- THE DRIVE ------------------------------------------------------
       `before` runs first because a region's own ambient is usually computed
       there (a wing's lamps, a breaker). `withPools` is false on the idle
       path: fittings still obey the clock behind a menu — the world behind the
       card is the same world, and lights that pop on at "Start" are a set
       being switched on — but pooled dynamic lights follow a body that is not
       yet playing, so they wait. */
    function drive(withPools) {
      if (spec.before) { try { spec.before(); } catch (e) {} }
      const dark = clamp01(1 - sky() * DUSK_GAIN);
      for (let i = 0; i < fixtures.length; i++) driveFixture(fixtures[i], dark);
      if (withPools !== false) for (let i = 0; i < pools.length; i++) drivePool(pools[i]);
    }

    /* ---- THE NIGHT FLOOR ------------------------------------------------
       The shared light keyframes are a CITY's night — a place with street
       lighting. Somewhere that is meant to be black between sweeps is darker
       than that on purpose, and this is where that opinion is stated: a
       multiply, late enough to be after weather's lightning bump and early
       enough that the tone-map finalize scales our result as it scales
       everyone else's. The colour goes with the intensity, or an ambient that
       stays bright blue while dimming just reads as "everything is teal". */
    function darken(floorSpec, order) {
      if (!CBZ.onAlways) return;
      const get = typeof floorSpec === "function" ? floorSpec : function () { return floorSpec; };
      CBZ.onAlways(order != null ? order : 93.6, function () {
        if (!enabled()) return;
        const night = 1 - sky();
        if (night <= 0.002) return;
        const floor = get();
        if (floor == null || floor >= 1) return;
        const f = 1 - night * (1 - floor);
        if (CBZ.sun) CBZ.sun.intensity *= f;
        if (CBZ.hemi) {
          CBZ.hemi.intensity *= f;
          CBZ.hemi.color.multiplyScalar(0.55 + 0.45 * (1 - night));
          CBZ.hemi.groundColor.multiplyScalar(0.5 + 0.5 * (1 - night));
        }
        if (CBZ.bounce) CBZ.bounce.intensity *= f;
        // fog too, or the horizon glows brighter than the ground under it
        if (CBZ.scene && CBZ.scene.fog) CBZ.scene.fog.color.multiplyScalar(1 - night * 0.5);
      });
    }
    if (spec.nightFloor != null) darken(spec.nightFloor, spec.nightFloorOrder);

    /* A rig may drive itself. Omit `tick` and the owner drives it from inside
       its own update — which is what a caller wants whenever a fitting's own
       ambient has to be computed in a particular order against its neighbours. */
    if (spec.tick != null && CBZ.onUpdate) {
      let acc = 0;
      const every = spec.interval != null ? spec.interval : 0.2;
      CBZ.onUpdate(+spec.tick, function (dt) {
        if (!enabled()) return;
        acc -= dt;
        if (acc <= 0) { acc = every; drive(true); }
        if (spec.after) { try { spec.after(dt); } catch (e) {} }
      });
    }

    const R = {
      id: id || "rig",
      fixtures: fixtures, regions: regions, kinds: kinds, pools: pools,
      enabled: enabled,
      register: register, region: region,
      regionAt: regionAt, regionOf: regionOf,
      level: level, scale: scale, sky: sky, lightsOut: lightsOut,
      drive: drive, pointPool: pointPool, darken: darken,
      torchThrow: TORCH, minSight: MIN,
      // the one spot the audit may sample: outside every region and out of
      // reach of every fixture. Only the caller knows where its world is empty.
      probe: spec.probe || null,
      audit: function () { return auditRig(R); },
    };
    rigs.push(R);
    return R;
  }

  /* ---- THE AUDIT. `sightAtNoon` is measured, not asserted: the sky is pinned
       to full day, a bare point is sampled, and the sky is put back. A caller
       supplies `probe: {x, z}` — a spot outside every region and out of reach
       of every fixture — because only the caller knows where its world is
       empty; without one the audit reports null rather than a number it cannot
       stand behind. */
  function auditRig(R) {
    let unknown = 0, lit = 0, withMesh = 0;
    const byKind = {};
    for (let i = 0; i < R.fixtures.length; i++) {
      const f = R.fixtures[i];
      if (!R.kinds[f.kind]) unknown++;
      if (f.level > 0.02) lit++;
      if (f.mesh) withMesh++;
      byKind[f.kind] = (byKind[f.kind] || 0) + 1;
    }
    let noon = null, midnight = null;
    const p = R.probe;
    if (p) {
      const held = CBZ.dayness, heldK = CBZ.duskness;
      CBZ.dayness = 1; CBZ.duskness = 0;
      noon = Math.round(R.scale(null, p.x, p.z) * 1000) / 1000;
      CBZ.dayness = 0; CBZ.duskness = 0;
      midnight = Math.round(R.scale(null, p.x, p.z) * 1000) / 1000;
      CBZ.dayness = held; CBZ.duskness = heldK;
    }
    return {
      id: R.id, on: R.enabled(),
      fixtures: R.fixtures.length, kinds: byKind, unknownKinds: unknown,
      regions: R.regions.length, lit: lit, withMesh: withMesh,
      pools: R.pools.length,
      sky: Math.round(R.sky() * 1000) / 1000, lightsOut: !!R.lightsOut(),
      sightAtNoon: noon, sightAtMidnight: midnight,
    };
  }

  CBZ.fixtures = {
    rig: rig,
    rigs: rigs,
    get: function (id) { for (let i = 0; i < rigs.length; i++) if (rigs[i].id === id) return rigs[i]; return null; },
    kinds: BASE_KINDS,
  };
  CBZ.fixtureAudit = function () {
    let unknown = 0, n = 0, noon = 1;
    const each = [];
    for (let i = 0; i < rigs.length; i++) {
      const a = rigs[i].audit();
      unknown += a.unknownKinds; n += a.fixtures;
      if (a.sightAtNoon != null) noon = Math.min(noon, a.sightAtNoon);
      each.push(a);
    }
    return { rigs: rigs.length, fixtures: n, unknownKinds: unknown, sightAtNoon: noon, each: each };
  };
})();

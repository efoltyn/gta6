/* ============================================================
   world/eruption.js — THE ERUPTION AS A SEQUENCE (CBZ.eruption).

   world/volcanofx.js owns what each piece of an eruption LOOKS like and how
   it moves (lava, column, umbrella, density current, lahar, bombs, ash
   ledger). This file owns WHEN each one happens, what it does to the
   things standing around the mountain, and nothing about any game mode:
   it is handed a volcano site, a height field, a parent, the buildings /
   trees / cars to act on, and a small set of hooks for the consequences a
   mode prices its own way. systems/disasters.js drives it on the island and
   the lab (src/lab/kits/eruption.js) drives the SAME code on a slope with a
   few houses, so what the lab measures is what ships.

   THE SEQUENCE, in the order a real stratovolcano runs it:

     UNREST     (the warning)  magma rising under the edifice. HARMONIC
                TREMOR — a continuous, rhythmically beating ground hum, not
                discrete quakes — and the summit fumaroles working harder
                and harder until the crater is steaming like a kettle.
     PHREATIC   t = 0. The groundwater above the magma flashes to steam and
                the summit blows: a cold, dirty cock's-tail of black jets, a
                base surge of steam rolling down the cone, and a shower of
                shattered OLD rock (grey lithic blocks, not incandescent).
     PLINIAN    t ~ 1.2 s. Fresh magma reaches the vent: the fountain and
                the white-hot vent apron, and the convective COLUMN starts
                climbing. Juvenile BOMBS — glowing rock on real parabolas.
                When the column's head reaches neutral buoyancy (~5 s later)
                it spreads sideways as the UMBRELLA, and the ash that buries
                the downwind town falls OUT OF THE UMBRELLA, so the fall
                marches across the island as the deck widens. LIGHTNING
                crackles inside the column (charge separation in the ash —
                a dirty thunderstorm), the odd bolt to the flank.
     EFFUSION   t ~ 2.5 s. Lava over the rim, down the barrancos: viscous,
                fast on the steep cone and crawling on the flat, firing the
                trees and houses it reaches and swallowing the cars.
     COLLAPSE   (big eruptions only) the column over-builds, loses buoyancy
                and falls back on the vent — it visibly sags — and the
                collapse pours down the warned VALLEY as a pyroclastic
                density current. It rebuilds and can do it again.
     LAHAR      (big eruptions only) ash and meltwater down a different
                valley, setting like concrete where it stops.
     WANING     the director ends it: the lava quenches black where it
                stands, the column stops being fed and disperses, the
                umbrella drifts off downwind and thins, the bombs cool in
                their craters, the ash stays and erodes.

   The ash LEDGER is the one authority on where ash lies (roof loads, the
   choke, the ground veil, the bot flee field all read it), and the
   UMBRELLA's analytic footprint is the one authority on where the sky is
   dark and the air is full of falling grit.

   FIRE IS NOT THIS FILE'S. Lava, hot bombs and the density current only
   say WHERE heat arrives; the host lights it on the island's one fire
   (systems/wildfire.js as a service: the fuel bed spreads it, the crowns
   torch and char, the houses burn floor by floor into the structural
   ledger, the cars cook off). Nothing here ticks a burning tree.

   Hooks (all optional; the defaults are flag-only so the lab can count):
     shake(k) sound(name,x,z) night()->0..1 wind()->{x,z,speed}
     igniteTree(t, why)->bool  igniteGround(x, z, r, why)->bool
     burnBuilding(b, how)->bool  damageBuilding(b, amount, kind)->stage(0..3)
     carFire(c, why)  bombLand(info)  groundStrike(x,z)
   why/how: "lava" | "bomb" | "pdc"
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  /* THE ASH LADDER, in metres of deposited ash. The three numbers are close
     together on purpose: the SAME accumulation that starts hurting the
     people outside is on its way to killing the people who correctly went
     inside. FULL is when the drifts stop thickening on screen. */
  const ASH = { DOT: 0.006, FULL: 0.16, ROOF_FAIL: 0.055 };

  // phase clock (seconds after the phreatic blast)
  const T_MAG = 1.2;          // magma reaches the vent
  const T_LAVA = 2.5;         // first lava over the rim
  const T_HEAD = 5.0;         // the column's head reaches neutral buoyancy

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function V() { return CBZ.volcanoFx; }

  /* WHERE IS THE VOLCANO. The island is being rebuilt by another hand and
     publishes CBZ.island.volcano; the arena's hill list is the fallback.
     Either way nobody downstream types a coordinate. */
  function site(arena) {
    const I = CBZ.island, v = I && I.volcano;
    if (v && Number.isFinite(+v.x) && Number.isFinite(+v.z)) {
      const peak = [v.peak, v.y, v.top, v.height].find(function (q) { return Number.isFinite(+q); });
      const r = [v.r, v.radius, v.baseR].find(function (q) { return Number.isFinite(+q) && +q > 0; });
      const hill = arena && arena.hills ? (arena.hills.find(function (h) { return h.volcano; }) || arena.hills[0]) : null;
      return {
        x: +v.x, z: +v.z,
        peak: peak != null ? +peak : (hill ? hill.peak : 30),
        r: r != null ? +r : (hill ? hill.r : 36),
        rim: Number.isFinite(+v.rim) ? +v.rim : (hill && hill.rim) || 6.2,
        breach: Number.isFinite(+v.breach) ? +v.breach : (hill ? hill.breach : null),
        src: "island",
      };
    }
    const hs = arena && arena.hills;
    const h = hs ? (hs.find(function (q) { return q.volcano; }) || hs[0]) : null;
    if (!h) return null;
    return { x: h.x, z: h.z, peak: h.peak, r: h.r, rim: h.rim || 6.2, breach: h.breach != null ? h.breach : null, src: "hills" };
  }

  /* THE COLLAPSE LANE. A density current is dense: its basal flow is
     confined by topography and runs DOWN THE VALLEYS (the barrancos), so the
     lane walks the height field valley-seeking (fallLine's channel mode),
     not straight down the face. Built once per eruption, telegraphed during
     the unrest, and handed to the current as its path. */
  function lane(S, bearing, groundAt, R) {
    const VF = V();
    if (!VF || !VF.fallLine || !S) return null;
    return VF.fallLine({
      x: S.x + Math.cos(bearing) * 3, z: S.z + Math.sin(bearing) * 3,
      groundAt: groundAt, bearing: bearing,
      step: 6, count: Math.ceil((S.r + (R || 120) * 0.95) / 6) + 1,
      channel: true, wander: 0.08, salt: 8100,
    });
  }

  function create(o) {
    const VF = V();
    if (!VF || !o || !o.site) return null;
    const S = o.site;
    const groundAt = o.groundAt || function () { return 0; };
    const parent = o.parent || CBZ.scene;
    const rnd = typeof o.rnd === "function" ? o.rnd : Math.random;
    const M = clamp(o.mag != null ? +o.mag : 0.5, 0.02, 1);
    const reg = o.region || { cx: S.x, cz: S.z, R: 120 };
    const W = o.world || {};
    const buildings = W.buildings || [], trees = W.trees || [], cars = W.cars || [];
    const H = Object.assign({
      shake: function (k) { if (CBZ.shake) CBZ.shake(k); },
      sound: function (name, x, z) { if (x != null && CBZ.sfxAt) CBZ.sfxAt(name, x, z); else if (CBZ.sfx) CBZ.sfx(name); },
      night: function () { return 0; },
      wind: function () { return CBZ.weatherWind ? CBZ.weatherWind() : { x: 1, z: 0, speed: 4 }; },
      igniteTree: function (t) { if (t.burnt || t.burning) return false; t.burning = 1; return true; },
      igniteGround: function () { return false; },
      burnBuilding: function (b) { if (b.burning) return false; b.burning = true; return true; },
      damageBuilding: function (b, amount) {
        if (b.fallen) return 3;
        b._dmg = Math.min(1.2, (b._dmg || 0) + amount);
        if (b._dmg >= 1) b.fallen = true;
        return b.fallen ? 3 : (b._dmg >= 0.5 ? 2 : (b._dmg >= 0.2 ? 1 : 0));
      },
      carFire: function (c) { c.burning = true; },
      bombLand: function () {},
      groundStrike: function (x, z) { if (CBZ.lightningStrike) CBZ.lightningStrike(x, z, { y: groundAt(x, z), power: 1.2 }); },
    }, o.hooks || {});

    const stats = {
      mag: +M.toFixed(3), phase: "unrest",
      lithics: 0, bombs: 0, lightningIC: 0, lightningCG: 0,
      pdcRuns: 0, laharRuns: 0, columnCollapses: 0,
      treesLit: 0, buildingsLit: 0, buildingsInLava: 0, buildingsLavaFallen: 0,
      // fires set on the fuel bed, by what set them
      groundFires: { lava: 0, bomb: 0, pdc: 0 }, treesBy: { lava: 0, bomb: 0, pdc: 0 }, pdcBuildingsLit: 0,
      roofsFailed: 0, carsEngulfed: 0, carsBurning: 0,
      bombHits: { roof: 0, car: 0, ground: 0, trees: 0, fires: 0 },
      surgeR: 0, umbrellaR: 0,
      // the most the ledger ever held (the scar erodes after the event)
      ashPeak: 0, roofAshPeak: 0, carAshPeak: 0,
    };

    const E = {
      site: S, mag: M, stats: stats, ASH: ASH,
      phase: "unrest", t: 0, unrestT: 0,
      column: null, umbrella: null, fountain: null, vent: null, phreatic: null,
      lava: null, pyro: null, lahar: null, ash: null, bombs: null,
      lane: o.lane || null, collapseBearing: o.collapseBearing != null ? +o.collapseBearing : rnd() * 6.2832,
      windX: 1, windZ: 0,
      roofs: [], carRoofs: [],
    };
    if (!E.lane) E.lane = lane(S, E.collapseBearing, groundAt, reg.R);

    let steam = null;
    const sinking = [];          // cars the lava is swallowing
    let bombCd = 0, lithicLeft = 0, lithicCd = 0, icCd = 0, cgCd = 0, pyroCd = 0, laharCd = 0, roofT = 0;
    let fieldT = 0;

    // ---------------------------------------------------------------
    // UNREST: steam + harmonic tremor, k = 0..1 through the warning
    // ---------------------------------------------------------------
    E.unrest = function (dt, k) {
      E.unrestT += dt;
      k = clamp(k, 0, 1);
      if (!steam && VF.fumarole) {
        const vents = [];
        for (let i = 0; i < 5; i++) {
          const a = E.collapseBearing + i * 1.257 + 0.4;
          const r = S.rim * (0.55 + 0.4 * ((i * 0.37) % 1));
          const x = S.x + Math.cos(a) * r, z = S.z + Math.sin(a) * r;
          vents.push({ x: x, y: groundAt(x, z), z: z });
        }
        steam = VF.fumarole({ vents: vents, parent: parent, salt: 0x51ea, strength: 1, yieldToColumn: false });
      }
      if (steam) { steam.setStrength(1 + 3.2 * k * k); steam.update(dt); }
      // the lava's texture is painted a slice a frame while the mountain steams
      if (VF.prewarm) VF.prewarm(1.5);
      /* HARMONIC TREMOR: a sustained hum whose amplitude beats slowly (two
         close frequencies) and climbs through the warning — the seismogram
         of magma and gas moving in a conduit, felt rather than seen. */
      const beat = 0.62 + 0.38 * Math.sin(E.unrestT * 2 * Math.PI * 0.45) * Math.sin(E.unrestT * 2 * Math.PI * 0.07 + 1);
      H.shake((0.03 + 0.2 * k * k) * beat);
      return E;
    };

    // ---------------------------------------------------------------
    // THE BLAST
    // ---------------------------------------------------------------
    E.erupt = function () {
      if (E.phase !== "unrest") return E;
      E.phase = stats.phase = "phreatic";
      E.t = 0;
      const w0 = H.wind() || { x: 1, z: 0 };
      const wl = Math.hypot(w0.x || 0, w0.z || 0);
      const wa = wl > 0.01 ? Math.atan2(w0.z, w0.x) : rnd() * 6.2832;
      E.windX = Math.cos(wa); E.windZ = Math.sin(wa);
      E.phreatic = VF.phreatic ? VF.phreatic({
        x: S.x, z: S.z, y: S.peak - 1, r: S.rim, coneR: S.r, mag: M,
        groundAt: groundAt, parent: parent, salt: 0x9a1 + Math.round(S.x),
      }) : null;
      E.bombs = VF.bombs ? VF.bombs({
        parent: parent, groundAt: groundAt, rnd: rnd, max: 44, ventX: S.x, ventZ: S.z,
        solids: solids, onLand: onBomb,
      }) : null;
      E.bombStats = E.bombs ? E.bombs.stats : null;
      // the blast throws the crater's OLD rock: a burst of cold lithics
      lithicLeft = 6 + Math.round(10 * M);
      lithicCd = 0;
      H.shake(0.9 + 0.3 * M);
      H.sound("explosion", S.x, S.z);
      H.sound("rumble");
      // the ash ledger exists from the first second so every roof and car
      // is registered; it is FED only once the umbrella is overhead
      if (VF.ashLoad && o.ash !== false) {
        const AL = VF.ashLoad({
          cx: reg.cx, cz: reg.cz, r: reg.R, groundAt: groundAt, parent: parent,
          roofs: buildings.length + cars.length + 8, salt: 6151, full: ASH.FULL,
        });
        E.ash = E.field = AL;
        for (let i = 0; i < buildings.length; i++) {
          const b = buildings[i]; if (b.fallen) continue;
          E.roofs.push({ b: b, id: AL.addRoof({ x: b.x, z: b.z, y: (b.gy || 0) + b.h + 0.05, w: b.w, d: b.d, ref: b }) });
        }
        // cars wear the fall too: a roof cell sized to the car's own top
        for (let i = 0; i < cars.length; i++) {
          const c = cars[i];
          const g = c.group;
          const along = c.rotY != null ? Math.abs(Math.sin(c.rotY)) > 0.7 : false;
          const y = (c.oy != null ? c.oy : (g ? g.position.y : groundAt(c.x, c.z))) + (c.roofH || 1.45);
          E.carRoofs.push({ c: c, id: AL.addRoof({ x: c.x, z: c.z, y: y, w: along ? 4.2 : 1.8, d: along ? 1.8 : 4.2, ref: c }) });
        }
      }
      pyroCd = T_MAG + 4 + 3 * (1 - M);
      laharCd = 11 - 5 * M;
      bombCd = T_MAG + 0.4;
      icCd = T_MAG + 2.5;
      cgCd = T_MAG + 6;
      return E;
    };

    // what a falling bomb can land ON before it reaches the ground
    function solids(x, y, z) {
      for (let i = 0; i < buildings.length; i++) {
        const b = buildings[i];
        if (b.fallen) continue;
        const top = (b.gy || 0) + b.h;
        if (y > top + 0.2 || y < top - 1.5) continue;
        if (Math.abs(x - b.x) <= b.w * 0.5 && Math.abs(z - b.z) <= b.d * 0.5) return { y: top, kind: "roof", ref: b };
      }
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        const top = (c.oy != null ? c.oy : 0) + (c.roofH || 1.45);
        if (y > top + 0.2 || y < top - 1.2) continue;
        if (Math.abs(x - c.x) <= 1.2 && Math.abs(z - c.z) <= 1.2) return { y: top, kind: "car", ref: c };
      }
      return null;
    }

    function onBomb(info) {
      if (info.hot) stats.bombs++; else stats.lithics++;
      const hit = info.hit;
      if (hit && hit.kind === "roof") {
        stats.bombHits.roof++;
        // a tonne of rock through a roof: the ledger prices it, and a HOT
        // bomb lodged in the rafters sets the house alight
        H.damageBuilding(hit.ref, Math.min(0.5, 0.08 + info.mass * info.speed / 4e5), "bomb");
        if (info.hot && rnd() < 0.45 && H.burnBuilding(hit.ref, "bomb")) { stats.buildingsLit++; stats.bombHits.fires++; }
      } else if (hit && hit.kind === "car") {
        stats.bombHits.car++;
        if (info.hot && !hit.ref._erFire && rnd() < 0.5) { hit.ref._erFire = true; H.carFire(hit.ref, "bomb"); stats.carsBurning++; }
      } else {
        stats.bombHits.ground++;
        // a juvenile bomb lands at ~1000 C: the grass and litter round the
        // crater catch, and the bed carries it from there
        if (info.hot && H.igniteGround(info.x, info.z, 1.2 + info.size * 2.2, "bomb")) stats.groundFires.bomb++;
      }
      // hot rock in dry brush: the trees around the impact catch
      if (info.hot) {
        for (let i = 0; i < trees.length; i++) {
          const t = trees[i];
          if (t.burnt || t.burning) continue;
          const d = Math.hypot(t.x - info.x, t.z - info.z);
          if (d < 2.5 + info.size * 2 && rnd() < 0.7 && lightTree(t, "bomb")) stats.bombHits.trees++;
        }
      }
      try { H.bombLand(info); } catch (e) {}
    }

    function lightTree(t, why) {
      if (t.burnt || t.burning) return false;
      if (!H.igniteTree(t, why)) return false;
      stats.treesLit++; stats.treesBy[why] = (stats.treesBy[why] || 0) + 1;
      return true;
    }

    function throwBomb(hot, big) {
      const ba = rnd() * 6.2832;
      const range = hot
        ? S.r * 0.5 + Math.pow(rnd(), 1.7) * (reg.R * (0.42 + 0.4 * M))
        : S.rim + 4 + Math.pow(rnd(), 1.4) * S.r * (0.6 + 0.6 * M);
      const vx = S.x + Math.cos(ba) * S.rim * 0.4, vz = S.z + Math.sin(ba) * S.rim * 0.4;
      E.bombs.throwTo({
        x: vx, y: S.peak + 1.5, z: vz,
        tx: S.x + Math.cos(ba) * range, tz: S.z + Math.sin(ba) * range,
        elev: 0.75 + rnd() * 0.5,
        size: big ? 0.45 + 0.5 * M + rnd() * 0.2 : 0.16 + rnd() * 0.22,
        hot: hot,
      });
    }

    function startMagma() {
      E.phase = stats.phase = "plinian";
      if (steam) { steam.dispose(); steam = null; }
      E.fountain = VF.fountain({ x: S.x, z: S.z, y: S.peak + 1, r: 1.6 + 2.4 * M, mag: M, groundAt: groundAt, parent: parent });
      E.fountain.setActive(0.6 + 0.4 * M);
      /* MAGNITUDE OWNS THE SILHOUETTE: ~56 m for a burp, ~194 m for the big
         one, stood one metre over the lip so its foot is inside the apron's
         glow. Fogless: the landmark must not dissolve in its own weather. */
      E.column = VF.ashColumn({ x: S.x, z: S.z, y: S.peak + 1, height: 46 + 148 * M, r: 6.5 + 10.5 * M, fogless: true, parent: parent });
      E.vent = VF.ventGlow({ x: S.x, z: S.z, r: 3.8 + 4.6 * M, groundAt: groundAt, parent: parent, salt: 4747 });
      H.shake(0.6);
      H.sound("explosion", S.x, S.z);
    }

    function startLava() {
      /* THE FAN IS THE SIZE OF THE ERUPTION: two tongues for a burp, six
         stems for the big one, born on the rim (the summit is a crater)
         and never straight down the collapse lane — the two hazards take
         separate faces so the mountain reads as having sides. */
      const n = 2 + Math.round(4 * M);
      E.lava = E.flows = [];
      for (let i = 0; i < n; i++) {
        const a = E.collapseBearing + 1.0 + (i / n) * 5.2 + (CBZ.hash01 ? CBZ.hash01(S.x + i, S.z, 91) : 0.5) * 0.34;
        const r = S.rim + 0.2;
        const x = S.x + Math.cos(a) * r, z = S.z + Math.sin(a) * r;
        E.lava.push(VF.lavaFlow({
          x: x, z: z, groundAt: groundAt, parent: parent, bearing: a,
          len: S.r * (1.05 + 0.6 * M) + 24 * M,
          width: 6 + 8 * M,
          // a viscous flood: the nose's real speed is this times the local
          // grade (see lavaFlow) — a walk away on the flat
          speed: 1.2 + 1.5 * M,
          salt: 4700 + i * 137,
          branches: M > 0.3 ? 2 : 1,
          light: i % 2 === 0, haze: i % 2 === 0,
        }));
      }
    }

    function startUmbrella() {
      const C = E.column;
      const Hc = C ? C.height : 100;
      E.umbrella = VF.umbrella({
        x: S.x, z: S.z, y: S.peak + 1 + Hc * 0.86, thick: 10 + 0.2 * Hc,
        r0: (C ? C.r : 10) + 0.2 * Hc,
        rMax: reg.R * (0.45 + 0.8 * M), stretch: reg.R * (0.3 + 0.7 * M),
        spreadSecs: 12 + 12 * M, groundY: Math.min(S.peak * 0.2, groundAt(reg.cx, reg.cz) + 4),
        fogless: true, parent: parent, salt: 0x0b12,
      });
    }

    // ---------------------------------------------------------------
    // THE ASH WEDGE: ONE shape, read by the ledger, the veil and the aftermath
    // ---------------------------------------------------------------
    const _ashW = { srcX: 0, srcZ: 0, windX: 1, windZ: 0, reach: 60, spread: 0.05, lobe: 3.2, rate: 0, amount: 0 };
    E.wedge = function () {
      const U = E.umbrella;
      _ashW.srcX = S.x; _ashW.srcZ = S.z;
      _ashW.windX = E.windX; _ashW.windZ = E.windZ;
      /* THE FALL COMES OUT OF THE UMBRELLA: no deck, no fall. The rate grows
         with how much deck there is, and the wedge's downwind reach IS the
         deck's downwind reach, so the grey marches across the island as the
         umbrella spreads. Magnitude owns the rate: a burp dusts its own cone,
         the big one buries the downwind town and takes its roofs. */
      const grow = U ? clamp(U.age / 4, 0, 1) * U.fade : 0;
      const fed = E.phase === "plinian" ? 1 : 0;
      _ashW.rate = (0.004 + 0.05 * M) * grow * fed;
      /* the reach grows with the deck to the calibrated carry (a burp's fall
         stays on its own cone's shoulder, the big one's reaches the town),
         so the upwind side keeps an outside the whole event */
      const spreadK = U ? clamp(U.age / (12 + 12 * M), 0, 1) : 0;
      _ashW.reach = reg.R * (0.3 + 0.45 * M) * (0.35 + 0.65 * spreadK);
      _ashW.spread = 0.03 + 0.04 * M;
      _ashW.lobe = 3.6 - 1.4 * M;
      _ashW.amount = E.ash ? Math.min(6, E.ash.peakDepth / ASH.FULL) : 0;
      return _ashW;
    };

    /* THE AIR AT (x,z): how much deck is overhead, how hard ash is falling
       through the air here, and how much has landed. The caller turns these
       into the sky's darkness, the fog wall and the grains in the air. */
    const _env = { cover: 0, fall: 0, ashK: 0, dark: 0 };
    E.envAt = function (x, z) {
      const U = E.umbrella;
      const cover = U ? U.coverAt(x, z) : 0;
      const fed = E.phase === "plinian" ? 1 : 0.35;
      const fallStart = U ? clamp((U.age - 4) / 5, 0, 1) : 0;
      _env.cover = cover;
      _env.fall = clamp(cover * fallStart * fed * (0.45 + 0.55 * M), 0, 1);
      _env.ashK = E.ash ? Math.min(1, E.ash.peakDepth / 0.3) : 0;
      _env.dark = clamp(Math.max(0.78 * _env.ashK, 0.86 * cover), 0, 0.92);
      return _env;
    };

    // ---------------------------------------------------------------
    // THE TICK
    // ---------------------------------------------------------------
    E.update = function (dt, prog) {
      if (!(dt > 0) || E.phase === "unrest" || E.phase === "over") return E;
      if (dt > 0.1) dt = 0.1;
      E.t += dt;
      const t = E.t;
      prog = prog || 0;
      const night = H.night ? clamp(+H.night() || 0, 0, 1) : 0;
      const w = H.wind() || null;
      const ws = w && w.speed > 0 ? w.speed : 6;
      if (E.phreatic) {
        E.phreatic.update(dt, { night: night, windX: E.windX, windZ: E.windZ });
        stats.surgeR = Math.max(stats.surgeR, Math.round(E.phreatic.surgeRadius));
        if (E.phreatic.done) { E.phreatic.dispose(); E.phreatic = null; }
      }
      if (!E.lava && VF.prewarm) VF.prewarm(2);
      if (E.phase === "phreatic" && t >= T_MAG) startMagma();
      if (!E.lava && t >= T_LAVA && E.phase === "plinian") startLava();
      if (!E.umbrella && E.column && t >= T_MAG + T_HEAD) startUmbrella();

      if (E.fountain) E.fountain.update(dt, S.x, S.peak, S.z);
      if (E.column) E.column.update(dt, E.windX, E.windZ, { night: night });
      if (E.umbrella) {
        E.umbrella.update(dt, E.windX, E.windZ, { night: night, windSpeed: ws });
        stats.umbrellaR = Math.max(stats.umbrellaR, Math.round(E.umbrella.radius));
      }
      if (E.vent) E.vent.update(dt);
      if (E.lava) for (let i = 0; i < E.lava.length; i++) E.lava[i].update(dt);
      if (E.bombs) E.bombs.update(dt);

      // ---- the blast's cold rock, then the magma's hot rock ----
      if (E.bombs && lithicLeft > 0) {
        lithicCd -= dt;
        while (lithicCd <= 0 && lithicLeft > 0) { throwBomb(false, rnd() < 0.3); lithicLeft--; lithicCd += 0.07; }
      }
      if (E.bombs && E.phase === "plinian") {
        bombCd -= dt;
        if (bombCd <= 0) {
          /* BALLISTICS DECIDES WHERE IT LANDS: bearing uniform, range piled
             up on the cone's own flanks with only the rare one carrying to
             the town — a vent throws most of its mass short. A salvo is one
             real bomb and a few small clots. */
          bombCd = Math.max(0.9, 4.8 - 3.0 * M - 0.8 * prog);
          throwBomb(true, true);
          const extra = Math.round(2 * M + rnd());
          for (let k = 0; k < extra; k++) throwBomb(true, false);
        }
      }

      // ---- lightning in the ash ----
      if (E.column && E.phase === "plinian" && t > icCd) {
        icCd = t + (0.25 + rnd() * 1.6) / (0.5 + 1.5 * M);
        flashInPlume();
      }
      if (E.column && E.phase === "plinian" && M > 0.35 && t > cgCd) {
        cgCd = t + (5 + rnd() * 8) / (0.4 + M);
        const a = rnd() * 6.2832, r = S.rim + rnd() * S.r * 0.7;
        const x = S.x + Math.cos(a) * r, z = S.z + Math.sin(a) * r;
        stats.lightningCG++;
        try { H.groundStrike(x, z); } catch (e) {}
      }

      // ---- collapse -> density current, down the warned valley ----
      if (o.pdc !== false && M > 0.28 && E.column && E.phase === "plinian") {
        pyroCd -= dt;
        if (!E.pyro && pyroCd <= 0 && E.lane) {
          E.column.collapse();
          stats.columnCollapses++;
          E.pyro = VF.pyroclastic({
            path: E.lane, groundAt: groundAt, parent: parent,
            speed: 28 + 26 * M, width: 14 + 24 * M, height: 11 + 17 * M,
            tail: 58, salt: 8100 + stats.pdcRuns * 311,
          });
          E.pyro._erHalfW = (14 + 24 * M) * 0.5;
          stats.pdcRuns++;
          pyroCd = 14 - 6 * M - 2 * prog;
          H.shake(1.15);
          H.sound("explosion", E.lane.pts[0].x, E.lane.pts[0].z);
          H.sound("rumble");
        }
      }
      if (E.pyro) {
        E.pyro.update(dt);
        if (E.pyro.done) { E.pyro.dispose(); E.pyro = null; }
      }

      // ---- lahar down a different valley ----
      if (o.lahar !== false && M > 0.3 && VF.lahar && E.phase === "plinian") {
        laharCd -= dt;
        if (!E.lahar && laharCd <= 0) {
          const a = E.collapseBearing + Math.PI * 0.62;
          const x = S.x + Math.cos(a) * S.r * 0.45, z = S.z + Math.sin(a) * S.r * 0.45;
          E.lahar = VF.lahar({
            x: x, z: z, groundAt: groundAt, parent: parent, bearing: a,
            len: reg.R * (0.5 + 0.4 * M), width: 7 + 9 * M, speed: 7 + 8 * M, salt: 2600 + stats.laharRuns * 197,
          });
          stats.laharRuns++;
          H.sound("water", x, z);
          H.shake(0.45);
        }
      }
      if (E.lahar) E.lahar.update(dt);

      // ---- ash: feed the ledger, load the roofs ----
      if (E.ash) {
        E.ash.update(dt, E.wedge());
        roofT -= dt;
        if (roofT <= 0) {
          roofT = 0.5; roofLoads();
          stats.ashPeak = Math.max(stats.ashPeak, +E.ash.peakDepth.toFixed(3));
          stats.roofAshPeak = Math.max(stats.roofAshPeak, +E.roofAshMax().toFixed(3));
          stats.carAshPeak = Math.max(stats.carAshPeak, +E.carAshMax().toFixed(3));
        }
      }

      // ---- what the lava and the fires do to the world (4 Hz) ----
      fieldT -= dt;
      if (fieldT <= 0) { const step = 0.25 - fieldT; fieldT = 0.25; worldTick(step); }
      tickCars(dt);
      return E;
    };

    /* LIGHTNING INSIDE THE COLUMN. Ash particles colliding in the turbulent
       gas-thrust region separate charge, and the column crackles with short
       bolts — most of them INSIDE the plume, low down, close to the vent.
       Drawn by systems/lightningfx.js's own arc (no second bolt renderer);
       the column and the deck light up from within around it. */
    function flashInPlume() {
      const C = E.column;
      const top = C.topY, base = C.baseY;
      const h = top - base;
      if (h < 12) return;
      const y0 = base + h * (0.18 + rnd() * 0.5);
      const rr = C.r + 0.2 * (y0 - base);
      const a = rnd() * 6.2832;
      const lean = (y0 - base) * 0.27 * Math.pow((y0 - base) / Math.max(1, C.height), 2);
      const ax = S.x + E.windX * lean + Math.cos(a) * rr * 0.6 * rnd(), az = S.z + E.windZ * lean + Math.sin(a) * rr * 0.6 * rnd();
      const span = 8 + rnd() * (14 + 16 * M);
      const b2 = a + (rnd() - 0.5) * 2.4;
      const bx = ax + Math.cos(b2) * span * 0.45, bz = az + Math.sin(b2) * span * 0.45;
      const by = y0 + (rnd() < 0.7 ? -1 : 1) * span * 0.85;
      stats.lightningIC++;
      if (CBZ.lightningArc) {
        try { CBZ.lightningArc(ax, y0, az, bx, by, bz, { w: 0.3 + 0.35 * M, life: 0.09 + rnd() * 0.08 }); } catch (e) {}
      }
      const mx = (ax + bx) * 0.5, my = (y0 + by) * 0.5, mz = (az + bz) * 0.5;
      C.flash(mx, my, mz, 0.8 + 0.2 * rnd(), span * 1.4);
      if (E.umbrella && my > E.umbrella.y - E.umbrella.thick) E.umbrella.flash(mx, my, mz, 0.7, span * 2);
      if (CBZ.weatherStrobe) CBZ.weatherStrobe(0.35 + 0.4 * M, 0.08);
      if (rnd() < 0.3) H.sound("thunder", mx, mz);
    }

    function roofLoads() {
      const AL = E.ash;
      for (let i = 0; i < E.roofs.length; i++) {
        const R = E.roofs[i];
        if (!R.b || R.b.fallen) continue;
        const dep = AL.roofDepth(R.id);
        if (dep < ASH.ROOF_FAIL) continue;
        // wet ash ~1000 kg/m3: past ROOF_FAIL a light frame is carrying more
        // than it was built for, and the ledger accumulates the overload
        const stage = H.damageBuilding(R.b, 0.75 * (dep / ASH.ROOF_FAIL), "ashload");
        if (R.b.fallen) { stats.roofsFailed++; AL.clearCell(R.id); }
        else if (stage >= 2) AL.clearCell(R.id);
      }
    }

    /* THE DENSITY CURRENT IS HOT ASH AT A FEW HUNDRED DEGREES: what its
       front rolls over chars and catches. Trees inside its core torch, the
       grass under the front lights, and a timber house in its path goes up
       from the ground floor (most of them; a dilute edge can pass one by). */
    const _pf = new THREE.Vector3();
    function pdcTick() {
      const P = E.pyro, Ln = E.lane;
      if (!P || !Ln || !VF.pathAt) return;
      const s = Math.min(P.frontS, Ln.total);
      if (!(s > S.rim)) return;
      VF.pathAt(Ln, s, _pf);
      const hw = P._erHalfW || 10;
      if (!P._erIgnS || s - P._erIgnS > hw * 0.6) {
        P._erIgnS = s;
        if (H.igniteGround(_pf.x, _pf.z, hw * 0.55, "pdc")) stats.groundFires.pdc++;
      }
      for (let i = 0; i < trees.length; i++) {
        const t = trees[i];
        if (t.burnt || t.burning || t._erPdc) continue;
        if (Math.hypot(t.x - _pf.x, t.z - _pf.z) > hw * 0.8) continue;
        t._erPdc = true;
        if (rnd() < 0.8) lightTree(t, "pdc");
      }
      for (let i = 0; i < buildings.length; i++) {
        const b = buildings[i];
        if (b.fallen || b._erPdc) continue;
        if (Math.hypot(b.x - _pf.x, b.z - _pf.z) > hw * 0.7 + Math.max(b.w, b.d) * 0.5) continue;
        b._erPdc = true;
        if (rnd() < 0.6 && H.burnBuilding(b, "pdc")) { stats.buildingsLit++; stats.pdcBuildingsLit++; }
      }
    }

    // the lava against everything it reaches: buildings, trees, cars
    function worldTick(step) {
      pdcTick();
      const L = E.lava;
      if (!L) return;
      for (let i = 0; i < buildings.length; i++) {
        const b = buildings[i];
        if (b.fallen) continue;
        let touch = false, near = false;
        const hx = b.w * 0.42, hz = b.d * 0.42;
        for (let k = 0; k < L.length && !touch; k++) {
          const f = L[k];
          if (f.hitTest(b.x, b.z) || f.hitTest(b.x - hx, b.z - hz) || f.hitTest(b.x + hx, b.z - hz) ||
              f.hitTest(b.x - hx, b.z + hz) || f.hitTest(b.x + hx, b.z + hz)) touch = true;
          else if (!near && f.hitTest(b.x, b.z, Math.max(b.w, b.d) * 0.5 + 1.5)) near = true;
        }
        if (touch) {
          if (!b._erLava) { b._erLava = true; stats.buildingsInLava++; }
          // the flow pushes in under the walls and burns the floors out
          if (!b._erLit && H.burnBuilding(b, "lava")) { stats.buildingsLit++; }
          b._erLit = true;
          H.damageBuilding(b, 0.06 * step, "lava");
          if (b.fallen) stats.buildingsLavaFallen++;
        } else if (near && !b._erLit) {
          // radiant heat off the margin: timber a metre from 1100 C rock goes up
          b._erHeat = (b._erHeat || 0) + step;
          if (b._erHeat > 3 && H.burnBuilding(b, "lava")) { b._erLit = true; stats.buildingsLit++; }
        }
      }
      for (let i = 0; i < trees.length; i++) {
        const t = trees[i];
        if (t.burnt || t.burning) continue;
        for (let k = 0; k < L.length; k++) if (L[k].hitTest(t.x, t.z, 2.2)) { lightTree(t, "lava"); break; }
      }
      /* THE MARGIN LIGHTS THE BED: wherever a live front has got to, the
         grass round its nose catches (once per 3 m of advance), and the fuel
         bed carries the fire out across the hillside from there. */
      for (let k = 0; k < L.length; k++) {
        const f = L[k];
        if (f.quenched) continue;
        const tp = f.tip;
        if (f._erIgn && Math.hypot(tp.x - f._erIgn.x, tp.z - f._erIgn.z) < 3) continue;
        f._erIgn = { x: tp.x, z: tp.z };
        if (H.igniteGround(tp.x, tp.z, 4.5, "lava")) stats.groundFires.lava++;
      }
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        if (c._erLava) continue;
        for (let k = 0; k < L.length; k++) {
          if (L[k].hitTest(c.x, c.z, 0.6)) {
            const g = c.group;
            c._erLava = { t: 0, y0: g ? g.position.y : 0, tilt: (rnd() - 0.5) * 0.12, fire: false };
            sinking.push(c);
            stats.carsEngulfed++;
            break;
          }
        }
      }
    }

    function tickCars(dt) {
      /* A CAR IN LAVA: the tyres go first, the body settles into the flow
         by most of a wheel's height and lists, and the fuel goes up. */
      for (let i = sinking.length - 1; i >= 0; i--) {
        const c = sinking[i], s = c._erLava;
        s.t += dt;
        const k = clamp(s.t / 6, 0, 1), e = k * k * (3 - 2 * k);
        if (c.group) {
          c.group.position.y = s.y0 - 0.62 * e;
          c.group.rotation.z = s.tilt * e;
        }
        if (!s.fire && s.t > 1.4) { s.fire = true; if (!c._erFire) { c._erFire = true; H.carFire(c, "lava"); stats.carsBurning++; } }
        if (E.carRoofs.length) for (let j = 0; j < E.carRoofs.length; j++) if (E.carRoofs[j].c === c && E.ash) E.ash.clearCell(E.carRoofs[j].id);
        if (k >= 1) sinking.splice(i, 1);
      }
    }

    // ---------------------------------------------------------------
    // READS for the caller's flee field, map and damage pass
    // ---------------------------------------------------------------
    E.threat = function (x, z) {
      if (E.phase === "unrest" || E.phase === "over") return 0;
      let t = 0.12;
      if (Math.hypot(x - S.x, z - S.z) < S.rim) t = Math.max(t, 0.9);
      if (E.pyro) t = Math.max(t, E.pyro.threatAt(x, z));
      else if (E.lane && M > 0.28 && E.phase === "plinian" && VF.pathCoord) {
        // the warned valley stays a place you do not stand in while it can still collapse
        const c = VF.pathCoord(E.lane, x, z, E.lane.total);
        if (c.perp < 22) t = Math.max(t, 0.6 * (1 - c.perp / 22));
      }
      if (E.lava) for (let i = 0; i < E.lava.length; i++) if (E.lava[i].hitTest(x, z, 1.5)) { t = Math.max(t, 0.97); break; }
      if (E.lahar && E.lahar.hitTest(x, z)) t = Math.max(t, 0.8);
      if (E.phreatic && E.phreatic.surgeAt(x, z) > 0) t = Math.max(t, 0.85);
      // a rock in the air has a landing point: watching it IS the warning
      if (E.bombs) E.bombs.forEachFlying(function (tx, tz, sz, eta) {
        const d = Math.hypot(x - tx, z - tz);
        if (d < 5 + sz * 4 && eta < 3) t = Math.max(t, 0.85 * (1 - d / (5 + sz * 4)));
      });
      if (E.ash) {
        const ad = E.ash.depthAt(x, z);
        if (ad > ASH.DOT) t = Math.max(t, Math.min(0.5, (ad - ASH.DOT) / 0.35));
      }
      return t;
    };

    E.hazards = function (out) {
      const L = E.lane;
      if (L && VF.pathAt) {
        const s = E.pyro ? Math.min(E.pyro.frontS, L.total) : 0;
        const P = new THREE.Vector3();
        VF.pathAt(L, s, P);
        const i = Math.max(0, Math.min(L.pts.length - 2, Math.floor(s / L.seg)));
        const a = L.pts[i], b = L.pts[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z, dl = Math.hypot(dx, dz) || 1;
        out.push({ line: true, x: P.x, z: P.z, dx: dx / dl, dz: dz / dl });
      }
      if (E.lahar && VF.pathAt) {
        const P2 = new THREE.Vector3();
        VF.pathAt(E.lahar.path, E.lahar.length, P2);
        out.push({ x: P2.x, z: P2.z, r: 9, fill: false });
      }
      return out;
    };

    E.carAshMax = function () {
      let m = 0;
      if (E.field) for (let i = 0; i < E.carRoofs.length; i++) m = Math.max(m, E.field.roofDepth(E.carRoofs[i].id));
      return m;
    };
    E.roofAshMax = function () {
      let m = 0;
      if (E.field) for (let i = 0; i < E.roofs.length; i++) m = Math.max(m, E.field.roofDepth(E.roofs[i].id));
      return m;
    };

    /* THE END IS NOT A DELETE. Returns the scars the caller keeps:
       the lava (quenched black where it stands), the set lahar, the ash
       field (eroding), the bomb field (rocks cooling in their craters), and
       the SKY — the column dispersing and the umbrella drifting off — which
       reports done when there is nothing left of it. */
    E.end = function () {
      if (E.phase === "over") return [];
      if (E.phase === "unrest") { if (steam) { steam.dispose(); steam = null; } E.phase = stats.phase = "over"; return []; }
      E.phase = stats.phase = "over";
      const scars = [];
      if (steam) { steam.dispose(); steam = null; }
      if (E.fountain) { E.fountain.dispose(); E.fountain = null; }
      if (E.vent) { E.vent.dispose(); E.vent = null; }
      if (E.pyro) { E.pyro.dispose(); E.pyro = null; }
      if (E.lava) {
        const flows = E.lava;
        flows.forEach(function (f) { f.quench(); });
        scars.push({
          kind: "lava",
          update: function (dt) { for (let i = 0; i < flows.length; i++) flows[i].update(dt); },
          dispose: function () { for (let i = 0; i < flows.length; i++) { try { flows[i].dispose(); } catch (e) {} } },
        });
        E.lava = null;
      }
      if (E.lahar) { scars.push(E.lahar.harden()); E.lahar = null; }
      if (E.ash) { scars.push(E.ash); E.ash = null; }
      if (E.bombs) { const B = E.bombs; scars.push({ kind: "bombs", update: function (dt) { B.update(dt); }, dispose: function () { B.dispose(); } }); E.bombs = null; }
      const col = E.column, umb = E.umbrella, ph = E.phreatic;
      E.column = E.umbrella = E.phreatic = null;
      if (col) col.wane();
      if (umb) umb.starve();
      const sky = {
        kind: "sky", done: false,
        update: function (dt) {
          if (sky.done) return;
          const w = H.wind() || {};
          const night = H.night ? clamp(+H.night() || 0, 0, 1) : 0;
          if (col && !col.done) col.update(dt, E.windX, E.windZ, { night: night });
          if (umb && !umb.done) umb.update(dt, E.windX, E.windZ, { night: night, windSpeed: w.speed > 0 ? w.speed : 6 });
          if (ph && !ph.done) ph.update(dt, { night: night });
          tickCars(dt);
          if ((!col || col.done) && (!umb || umb.done) && (!ph || ph.done) && !sinking.length) sky.done = true;
        },
        dispose: function () { if (col) col.dispose(); if (umb) umb.dispose(); if (ph) ph.dispose(); },
      };
      scars.push(sky);
      return scars;
    };

    E.dispose = function () {
      const s = E.end();
      for (let i = 0; i < s.length; i++) { try { s[i].dispose(); } catch (e) {} }
    };

    return E;
  }

  CBZ.eruption = { create: create, site: site, lane: lane, ASH: ASH, T_MAG: T_MAG, T_LAVA: T_LAVA, T_HEAD: T_HEAD };
})();

/* ============================================================
   systems/hurricane.js — CBZ.hurricane: THE CYCLONE, AND WHAT IT DOES TO A TOWN.

   A hurricane at ground level has NO SILHOUETTE. You don't see it, you feel
   it — a wind room — and you see what it does: palms streaming fronds-first,
   oaks leaning and then going over root plate and all, roof edges lifting and
   peeling, sheet metal and planks flying downwind, windows blowing in, the
   street lights stuttering out one district at a time, boats tearing off
   their moorings and the sea coming up the beach in a surge with the surf
   breaking on top of it. That is this file.

   THE FIELD — a translating cyclone. One storm CENTER tracks in a straight
   seeded line across the island; every local condition is a function of
   your distance r from it:

     wind   v(r): smoothstep up the wall inside the radius of maximum wind
            (RMW), vmax·(RMW/r)^0.55 outside it, near-calm inside the eye —
            times the shared GUST envelope, so the whole room breathes.
            Direction is tangential + a 25° inward spiral + half the storm's
            forward motion, so the right-of-track side blows harder.
     bands  outside ~1.9·RMW the OUTER RAINBANDS: log spirals (2 arms) that
            rotate with the storm. Inside an arm: a squall (rain, and the
            wind up ~25%); between arms: a slot of grey drizzle and slacker
            wind. So the approach is gusty squalls with lulls, not a ramp.
     sky    localWeather(): rain and fog where you stand; inside the eye
            `clear` opens the cloud deck (systems/weather.js eases the
            overcast away FAST for a clearing, slowly for everything else).

   Because the center MOVES, the real sequence falls out of one field with no
   phase scripting: outer bands → front eyewall (the strongest sustained wind
   plus gusts) → the calm of the eye with the sky clearing → the back eyewall
   from the OPPOSITE bearing (geometry: you are now on the other side of the
   vortex) → the tail. cameraPhase() names where the camera is in it.

   MAGNITUDE — SAFFIR-SIMPSON, rolled per occurrence by the def:
     vmax      = 20 + 11·catF   → cat-1 ~31 m/s, cat-3 ~53, cat-5 ~75
     gusts     the def's gustBurst cadence, ~1.25-1.6× sustained
     rmw       = 32 + 5.5·catF
     eye       tightens with category; BELOW CAT 3 THERE IS NO TRUE EYE
     surgeMax  = 0.6 + 0.75·catF  (cat-1 wets the ramps, cat-5 drowns streets)

   THE TOWN (new, 2026-10-14). The storm acts on the world through ONE
   adapter, `begin({world})` — see WORLD CONTRACT below. The disaster def
   builds it from the island (CBZ.island when the island publishes it, else
   the arena record); the lab kit (src/lab/kits/hurricane.js) builds it from a
   tiny coast. Nothing here hard-codes a coordinate or knows which island it
   is standing on. What the wind does, by category, and why:

     trees    every tree is a damped spring leaning DOWNWIND (θ ∝ v², 2-D so
              the eye's reversal swings it back through upright). Broadleaf:
              branches strip above ~30 m/s, the tree WINDTHROWS (uproots and
              falls downwind about its root plate) when the gust at it passes
              its own break speed, 36-50 m/s (field data: trunks fail near
              42 m/s almost regardless of size — Virot et al. 2016). Palms
              bend far further (θ up to ~0.6 rad), the crown streams
              FRONDS-FORWARD, fronds strip from ~33 m/s, and only a cat-4/5
              gust (62-78 m/s) takes the whole crown off.
     roofs    uplift peaks at the windward edge and the two corners beside
              it, so each roof PEELS FROM ITS EDGES: sheets of THIS roof's own
              colour tear off the windward edge and its corners as rigid
              bodies, from wherever the roof is NOW. Peel starts at 30-40 m/s;
              a cat-5 strips roofs.
     windows  a gust over ~46 m/s (or an opened roof, internal pressure)
              blows the WINDWARD face's glass in (world.shatter, the island's
              own panes).
     frame    the building's structural ledger takes wind load ∝ (v/36)³-1
              through ONE adapter (damageBuilding below: CBZ.collapse.damage
              when that API exists, the world's own ledger otherwise),
              capped so wind alone never levels a block.
     debris   the ONE body sim (systems/debris.js), owner "hurricane": roof
              sheets and sign panels are rigid bodies, stripped fronds and
              branches are its bits. The storm registers itself as a FLUID
              (CBZ.debris.medium) while it lives, so the wind is a force on
              them — capped, ceilinged, never a position — and gravity, the
              buildings, the ground, rest and sleep are the shared sim's. They
              STAY until resetWorld() (the aftermath is the evidence).
              The two Points streams (grit/spray low and fast, rag higher)
              stay as the fine material you cannot count.
     signs    lean ∝ v², the panel itself rips off at 30-42 m/s (debris.adopt).
     power    the island splits into DISTRICTS (the world's own, else a grid
              over its radius). A district browns out, FLICKERS for a second
              or two and goes dark when its peak gust passes its grid's
              strength (27-40 m/s, lower again for every tree down in it).
              The dark is drawn in the shader: every powered lamp material
              (street lenses, light pools, lanterns, forecourt pools) gets a
              district mask, nine vec4s — one uniform write per frame, no
              per-lamp objects. Power never comes back during the match.
     boats    moored boats weathervane bow-to-wind and heave on the sea; the
              mooring parts at 28-42 m/s (sooner as the surge lifts them);
              loose, they drift downwind at ~5% of the wind plus the surge
              current, ride the flood inland and are left BEACHED, rolled on
              their bilges, where the water drops them.
     cars     rock on their springs from ~26 m/s, are SHOVED sideways past
              ~42 m/s (the parked car slides), flipped by a cat-4/5 gust (the
              def's flingCar via world.fling), and FLOAT once the surge stands
              0.6 m over their wheels — nose-down, drifting with the water,
              set down wherever it drains.
     sea      surge (one number, the engine's waterSurgeSet), and the state ON
              TOP of it: seaState() → amp/chop/foam rising with the wind
              (whipped white), surf bursting along every stretch of shore
              the wind blows onto, and the harbour (world.harbour points) hit
              hardest. The shoreline moves inland with the surge.

   DETERMINISM. What breaks is decided by each object's own position hash
   against the field (the field is seeded by the def's track and category),
   so every client fells the same trees without spending the shared hazard
   stream. Flight paths, flicker, spray: runtime FX, Math.random.

   COST. All per-frame work is flat arrays and a few hundred quaternion
   writes; the town adds 1 draw call (spray; its pieces draw as the shared
   sim's rubble)
   and a 9-vec4 uniform. Measured: CBZ.hurricaneAudit().tickMs. Built for a
   phone: nothing allocates per frame, nothing is per-lamp or per-pane.

   Ratchet: CBZ.hurricaneAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  // ---- storm state (one storm at a time; the director runs one disaster) --
  let S = null;          // live storm or null
  let lastCat = 0, lastVmax = 0;   // survive end() so the tail beat still reports
  const counts = { debrisStrikes: 0, debrisKills: 0, knockdowns: 0, drownings: 0, gusts: 0, carsFlung: 0 };
  // the town's tally for THIS storm (reset by begin, survives end)
  const town = {
    treesBent: 0, treesDown: 0, palmsTopped: 0, frondsStripped: 0, branchesStripped: 0,
    roofsPeeling: 0, roofsStripped: 0, roofSheets: 0, windowsBlown: 0, facesBlown: 0, frameLoad: 0,
    signsDown: 0, districtsOut: 0, districts: 0, boatsLoose: 0, boatsBeached: 0,
    carsRocking: 0, carsPushed: 0, carsFloated: 0, debrisLaunched: 0, debrisHits: 0,
    surfBursts: 0, harbourBursts: 0,
  };
  // reversal evidence: wind bearing at the island center, sampled once on each
  // side of the eye's passage. dot < 0 is the back wall blowing the other way.
  const evid = { frontX: 0, frontZ: 0, backX: 0, backZ: 0, haveFront: false, haveBack: false,
    camPeak: 0, camCalmMin: 1e9, camInEye: false, eyePassedCam: false, surgePeak: 0,
    phases: [], phaseT: {} };
  const cost = { n: 0, sum: 0, max: 0, last: 0 };

  function resetEvidence() {
    counts.debrisStrikes = counts.debrisKills = counts.knockdowns = counts.drownings = counts.gusts = counts.carsFlung = 0;
    for (const k in town) town[k] = 0;
    evid.haveFront = evid.haveBack = false; evid.frontX = evid.frontZ = evid.backX = evid.backZ = 0;
    evid.camPeak = 0; evid.camCalmMin = 1e9; evid.camInEye = false; evid.eyePassedCam = false; evid.surgePeak = 0;
    evid.phases.length = 0; evid.phaseT = {};
    cost.n = cost.sum = cost.max = cost.last = 0;
  }

  // a stable 0..1 per object (position hash): what breaks is the object's own
  // strength against the field, the same on every client
  function h01(x, z, salt) {
    let h = Math.imul((Math.round(x * 8) | 0) ^ 0x9e3779b1, 0x85ebca6b) ^ Math.imul((Math.round(z * 8) | 0) + (salt | 0), 0xc2b2ae35);
    h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }

  /* ---- the field ---------------------------------------------------------
     windAt(x,z) is THE storm. Everything else — what you feel, what the
     debris rides, which way the rain leans, which tree goes over — reads it.
     Pure function of position + storm state, no allocation. */
  const _w = { x: 1, z: 0, speed: 0, band: 1 };
  // the outer rainbands: 0 (slot) .. 1 (squall core). Two log-spiral arms that
  // turn with the storm; 1 inside ~1.9 RMW where the eyewall is one solid ring.
  function bandAt(dx, dz, r) {
    if (r <= S.rmw * 1.9) return 1;
    const th = Math.atan2(dz, dx);
    const ph = 2 * th - 4.2 * Math.log(r / S.rmw) + S.t * 0.55;
    const b = 0.5 + 0.5 * Math.sin(ph);
    // fade the structure in over 1.9..2.6 RMW so the wall's edge has no seam
    const k = Math.min(1, (r - S.rmw * 1.9) / (S.rmw * 0.7));
    return 1 - k + k * b * b;
  }
  function windAt(x, z) {
    if (!S) { _w.x = 1; _w.z = 0; _w.speed = 0; _w.band = 0; return _w; }
    const dx = x - S.x, dz = z - S.z;
    const r = Math.hypot(dx, dz) || 0.001;
    let m;
    if (r >= S.rmw) m = S.vmax * Math.pow(S.rmw / r, 0.55);
    else if (r <= S.eyeCalmR) m = S.vmax * S.calmK;
    else {
      const u = (r - S.eyeCalmR) / (S.rmw - S.eyeCalmR);
      m = S.vmax * (S.calmK + (1 - S.calmK) * u * u * (3 - 2 * u));  // smoothstep up the wall
    }
    const band = bandAt(dx, dz, r);
    if (r > S.rmw * 1.9) m *= 0.78 + 0.34 * band;    // squalls in the arms, slack in the slots
    m *= S.gustK;                                   // the room breathes as one
    // tangential circulation + inward spiral outside the wall
    const tx = -dz / r, tz = dx / r;
    const inFrac = r > S.rmw ? 0.42 : 0.42 * Math.max(0, (r - S.eyeCalmR) / (S.rmw - S.eyeCalmR)) * 0.4;
    let vx = tx - dx / r * inFrac, vz = tz - dz / r * inFrac;
    const vm = Math.hypot(vx, vz) || 1;
    vx = vx / vm * m; vz = vz / vm * m;
    // the storm's own translation, felt where the storm's winds are felt:
    // the right-of-track side is genuinely stronger
    const carry = 0.5 * Math.min(1, m / S.vmax);
    vx += S.fwdX * S.fwdV * carry; vz += S.fwdZ * S.fwdV * carry;
    _w.speed = Math.hypot(vx, vz);
    _w.x = _w.speed > 0.001 ? vx / _w.speed : 1;
    _w.z = _w.speed > 0.001 ? vz / _w.speed : 0;
    _w.band = band;
    return _w;
  }

  /* localWeather(x,z): what the sky is DOING where you are standing. The def
     feeds the camera's answer to CBZ.weatherDrive every frame, so walking
     into the eye stops the rain because the rain has stopped THERE. */
  const _lw = { rain: 0, wind: 0, windDir: { x: 1, z: 0 }, fog: 0, fogColor: 0x46505a, clear: 0, lightning: 0 };
  function localWeather(x, z) {
    const w = windAt(x, z);
    if (!S) { _lw.rain = 0; _lw.wind = 0; _lw.fog = 0; _lw.clear = 0; return _lw; }
    const r = Math.hypot(x - S.x, z - S.z);
    const k = Math.min(1, w.speed / S.vmax);
    let rain = Math.min(1, k * 1.25);
    // the bands: a squall is a downpour, a slot is drizzle
    if (r > S.rmw * 1.9) rain = Math.min(1, 0.12 + rain * (0.2 + 1.0 * w.band));
    let clear = 0;
    if (r < S.eyeR) {
      // in the eye the rain dies to the eye's QUALITY: a cat-3+ eye goes dry
      // and the deck OPENS overhead; a ragged low-category lull only eases
      const u = Math.max(0, (r - S.eyeCalmR) / Math.max(1, S.eyeR - S.eyeCalmR));
      rain *= S.calmK * 1.6 + u * 0.4;
      clear = Math.max(0, 1 - S.calmK * 2.4) * (1 - u * u);
    }
    _lw.rain = Math.min(1, rain);
    _lw.wind = w.speed;
    _lw.windDir.x = w.x; _lw.windDir.z = w.z;
    _lw.fog = r < S.eyeR ? 0.04 + S.calmK * 0.5 : Math.min(0.8, 0.16 + 0.5 * k + 0.12 * rain);
    _lw.fogColor = 0x46505a;
    _lw.clear = clear;
    // LIGHTNING lives in the OUTER BANDS' squalls (a mature eyewall is
    // lightning-poor); weather.js only strikes by day above 0.2
    _lw.lightning = r > S.rmw * 1.9 ? 0.32 * w.band * Math.min(1, k * 1.6) : 0.1;
    return _lw;
  }

  /* ---- wind-advected fine material (two Points streams) ------------------
     grit — fine spray and grit driving horizontally past the lens, low and
     quick; rag — heavier ragged material higher up, fewer and bigger, each
     tinted so none reads as a repeated sprite. Seeded UPWIND of the camera so
     material is thrown PAST you, never born in a ring around you. */
  let dotTex = null;
  function softDot() {
    if (dotTex) return dotTex;
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(16, 16, 2, 16, 16, 15);
    grad.addColorStop(0, "rgba(255,255,255,0.95)");
    grad.addColorStop(0.55, "rgba(255,255,255,0.5)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
    dotTex = new THREE.CanvasTexture(c);
    return dotTex;
  }
  function groundAt(x, z) {
    if (WD && WD.groundAt) return WD.groundAt(x, z);
    return CBZ.floorAt ? CBZ.floorAt(x, z) : 0;
  }
  function seaRest() { return WD && Number.isFinite(WD.seaRest) ? WD.seaRest : -0.8; }
  // the live sea surface: the world's own (it knows its swell), else rest + surge
  function seaAt(x, z) {
    if (WD && WD.seaAt) return WD.seaAt(x, z);
    return seaRest() + (S ? S.surge : 0);
  }
  function hostRoot() { return (WD && WD.root) || CBZ.scene; }

  function buildCloud(n, size, opacity, baseColor, tintSpread, hLo, hHi) {
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const h0 = new Float32Array(n);
    const ph = new Float32Array(n);
    const age = new Float32Array(n);
    const cr = (baseColor >> 16 & 255) / 255, cg = (baseColor >> 8 & 255) / 255, cb = (baseColor & 255) / 255;
    for (let i = 0; i < n; i++) {
      const t = (Math.random() * 2 - 1) * tintSpread;
      col[i * 3] = Math.min(1, Math.max(0, cr + t));
      col[i * 3 + 1] = Math.min(1, Math.max(0, cg + t * 0.9));
      col[i * 3 + 2] = Math.min(1, Math.max(0, cb + t * 0.75));
    }
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(pos, 3);
    if (attr.setUsage) attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", attr);
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      vertexColors: true, size, transparent: true, opacity,
      map: softDot(), depthWrite: false, fog: true,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false; pts.renderOrder = 6;
    pts.name = "hurricane-fine-debris";
    CBZ.scene.add(pts);
    const d = { pts, geo, attr, mat, pos, h0, ph, age, n, hLo, hHi };
    for (let i = 0; i < n; i++) seedDebris(d, i, S ? S.cx : 0, S ? S.cz : 0, true);
    return d;
  }
  function seedDebris(d, i, cx, cz, anywhere) {
    const o = i * 3;
    let x, z;
    if (anywhere) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 80;
      x = cx + Math.cos(a) * r; z = cz + Math.sin(a) * r;
    } else {
      const w = windAt(cx, cz);
      const base = w.speed > 3 ? Math.atan2(-w.z, -w.x) : Math.random() * Math.PI * 2;
      const a = base + (Math.random() * 2 - 1) * (w.speed > 3 ? 1.15 : Math.PI);
      const r = 35 + Math.random() * 80;
      x = cx + Math.cos(a) * r; z = cz + Math.sin(a) * r;
    }
    d.pos[o] = x; d.pos[o + 2] = z;
    d.h0[i] = d.hLo + Math.random() * (d.hHi - d.hLo);
    d.ph[i] = Math.random() * 6.28;
    d.age[i] = 2.5 + Math.random() * 4;
    d.pos[o + 1] = Math.max(groundAt(x, z), seaAt(x, z)) + d.h0[i];
  }
  function tickCloud(d, dt, camX, camZ) {
    for (let i = 0; i < d.n; i++) {
      const o = i * 3;
      d.age[i] -= dt;
      const w = windAt(d.pos[o], d.pos[o + 2]);
      const ride = Math.min(1, w.speed / 14);
      d.pos[o] += w.x * w.speed * dt * (0.8 + 0.25 * Math.sin(d.ph[i]));
      d.pos[o + 2] += w.z * w.speed * dt * (0.8 + 0.25 * Math.cos(d.ph[i]));
      // ride height follows the wind: strong wind lofts, calm settles it out
      // (over the sea it rides the surface: that is the spindrift)
      const g = Math.max(groundAt(d.pos[o], d.pos[o + 2]), seaRest() + S.surge);
      const want = g + 0.15 + d.h0[i] * ride;
      d.pos[o + 1] += (want + Math.sin(S.t * 6 + d.ph[i]) * 0.6 * ride - d.pos[o + 1]) * Math.min(1, dt * 3);
      const dx = d.pos[o] - camX, dz = d.pos[o + 2] - camZ;
      if (d.age[i] <= 0 || dx * dx + dz * dz > 140 * 140) seedDebris(d, i, camX, camZ, false);
    }
    d.attr.needsUpdate = true;
  }
  function disposeCloud(d) {
    if (!d) return;
    if (d.pts.parent) d.pts.parent.remove(d.pts);
    d.geo.dispose(); d.mat.dispose();
  }

  /* ============================================================
     WORLD CONTRACT — what begin({world}) may carry. Every field optional
     except groundAt; a missing list is simply a town without that thing.

       cx, cz, R            the island's centre and land radius
       groundAt(x,z)        walk-surface height (the arena's groundHeightAt)
       seaRest              the resting sea level (y); seaAt(x,z) the live
                            surface with swell, if the world has one
       root                 where the storm's own meshes live (default scene)
       trees()     [{x, z, trunk, foliage, trunkCol?, palm?, leafHex?, barkHex?}]
                   trunk.position is the trunk's BASE; trunk + foliage share
                   a parent. palm: true/false (else read off the frond material)
       buildings() [{x, z, w, d, h, gy, group, fallen?, roofY?, roofHex?}]
       cars()      [{x, z, group, collider, flung, rotY, oy}] (the arena's car
                   records: car.flung = true hands the car to us, and the
                   arena's own reset() parks it back)
       boats()     [{group, x, z, yaw?, len?, draft?}] moored craft
       signs()     [{x, z, y?, w?, h?, mesh, hex?}] free-standing sign panels
       harbour()   [{x, z}] seawall / pier points the surf hits hardest
       districts() [{x, z, half}] power districts (square); default a grid
       powerMaterials() extra lamp materials to put on the grid
       shatter(x,z,r) -> panes broken   (the island's own CBZ.shatterGlass)
       structure(b, amount, dirx, dirz) the world's structural ledger
       fling(car, dirx, dirz, force, up) the world's own car tumble
       release(collider)    take a collider out of the world
       actors(fn)           visit every body (for real debris hits)
       hit(actor, {dirx, dirz, speed, mass, energy, x, y, z})  a real piece
                            crossed a body's capsule (speed relative, energy J)
       hurtLine(x0,z0,x1,z1, width, cause)    a falling tree's footprint
     ============================================================ */
  let WD = null;
  function list(name) {
    if (!WD || typeof WD[name] !== "function") return EMPTY;
    let a = null;
    try { a = WD[name](); } catch (e) { a = null; }
    return a || EMPTY;
  }
  const EMPTY = [];

  /* ONE ADAPTER FOR BUILDING DAMAGE. The shared collapse system is being
     rebuilt as CBZ.collapse.damage(building, point, radius, energy, dir);
     when that exists the storm calls it, otherwise the world's own ledger
     (the island's structureHit, through world.structure). `amount` is in the
     ledger's units (0.35 glass out, 0.7 spalling, 1 collapse); it is passed
     as the energy, so a caller of the new API reads the same scale. */
  function damageBuilding(b, amount, dirx, dirz, roofY) {
    if (!(amount > 0) || b.fallen) return;
    town.frameLoad += amount;
    const C = CBZ.collapse;
    if (C && typeof C.damage === "function") {
      try {
        C.damage(b, { x: b.x - dirx * b.w * 0.5, y: roofY, z: b.z - dirz * b.d * 0.5 },
          Math.max(b.w, b.d) * 0.6, amount, { x: dirx, y: 0, z: dirz }, { frac: true });
      } catch (e) {}
      return;
    }
    if (WD && WD.structure) { try { WD.structure(b, amount, dirx, dirz); } catch (e) {} }
  }

  /* ============================================================
     WHAT THE WIND TEARS OFF — pieces in the ONE body sim (systems/debris.js).
     This file used to keep a private pool (unit boxes, a private flutter
     lift, states for flying / skittering / afloat / a hinged FLAP) and a
     separate instanced strip of bare decking drawn over every peeled roof
     edge. Neither knew the building: when a later quake, sinkhole or
     collapse dropped or tilted a peeled house, its decking strips and flaps
     stayed at the old roof height — the dark plates hovering over the town.
     Both are gone. A roof sheet is a real rigid body in the roof's colour, a
     frond or a branch is a debris bit, a sign is its own panel adopted; the
     storm is a FLUID (CBZ.debris.medium) that pushes them, and gravity, the
     ground, the buildings and the rest are the shared sim's.
     ============================================================ */
  const OWNER = "hurricane";
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
  const sheetMats = new Map();
  function sheetMat(hex) {
    let m = sheetMats.get(hex);
    if (!m) { m = new THREE.MeshLambertMaterial({ color: hex }); m.name = "hurricane-roof-sheet"; m._shared = true; sheetMats.set(hex, m); }
    return m;
  }
  // a sheet of THIS roof's covering torn off its edge: a rigid body
  function tearSheet(x, y, z, alongX, len, dep, hex, vx, vy, vz) {
    const D = CBZ.debris; if (!D || !D.shatterBox) return 0;
    const hl = len / 2, hd = dep / 2;
    const box = alongX
      ? { minX: x - hl, maxX: x + hl, minY: y, maxY: y + 0.035, minZ: z - hd, maxZ: z + hd }
      : { minX: x - hd, maxX: x + hd, minY: y, maxY: y + 0.035, minZ: z - hl, maxZ: z + hl };
    let out = null;
    try {
      // corrugated roofing is ~6 kg/m2 (not a 35 mm slab of steel), and it
      // catches the wind on its face
      out = D.shatterBox(box, sheetMat(hex), { whole: "one", kind: "metal", owner: OWNER, launch: false, grit: false, dust: false,
        maxLife: 60, mass: Math.max(2, len * dep * 6), area: len * dep * 0.7, cd: 1.2, velocity: { x: vx, y: vy, z: vz }, angular: { x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 6 } });
    } catch (e) { out = null; }
    const n = out ? out.pieces || 0 : 0;
    if (n) town.debrisLaunched += n;
    return n;
  }
  // a frond / a branch: one bit of the shared grit
  function tearBit(shape, x, y, z, size, hex, vx, vy, vz) {
    const D = CBZ.debris; if (!D || !D.bit) return 0;
    let n = 0;
    try { n = D.bit(x, y, z, { shape: shape, kind: shape === "flake" ? "foliage" : "wood", color: hex, size: size, vel: { x: vx, y: vy, z: vz }, owner: OWNER }) || 0; } catch (e) { n = 0; }
    town.debrisLaunched += n;
    return n;
  }
  /* THE STORM IS A FLUID. While it lives, its wind field pushes every live
     piece and bit (not only its own) through the shared sim. */
  function fluid(x, y, z, out) {
    if (!S) return false;
    const w = windAt(x, z);
    if (!(w.speed > 0.5)) return false;
    // the wind is weaker in the ground's own boundary layer
    const g = groundAt(x, z);
    const k = Math.min(1, 0.55 + 0.45 * Math.max(0, y - g) / 10);
    out.vx = w.x * w.speed * k; out.vz = w.z * w.speed * k;
    out.vy = Math.min(4, w.speed * 0.05);
    out.rho = 1.225;
    out.ceil = g + 25;
    return true;
  }
  function fluidOn(on) {
    const D = CBZ.debris; if (!D || !D.medium) return;
    try { D.medium(OWNER, on ? fluid : null); } catch (e) {}
  }
  /* REAL HITS ONLY (owner: "it says I'm getting killed by hurricane debris,
     and I'm not even hit by the debris"). The def used to roll a hidden
     "debris strike" on everyone standing in eyewall wind and bill it to
     debris; that roll is gone (disasters.js). The ONLY debris wound now is a
     piece of the storm's own (a roof sheet, a plank, a sign panel in
     systems/debris.js) whose path this frame actually crosses a body: the
     segment it swept since last frame, tested against the body's capsule
     (feet to crown, shoulder radius plus the piece's own thickness). The
     wound is the piece's kinetic energy at the speed it met you RELATIVE to
     you, so a palm frond stings, a plank hurts and a steel roof sheet at
     eyewall speed kills. Every frame, not 10 Hz: at 30 m/s a piece crosses
     three metres in a tenth of a second, which a point test simply missed
     or, worse, billed from a metre away. */
  const CAP_R = 0.34, CAP_LO = 0.1, CAP_HI = 1.8;
  const _hitO = { dirx: 0, dirz: 0, speed: 0, mass: 0, energy: 0, x: 0, y: 0, z: 0 };
  // squared distance between segment P0-P1 and the vertical segment
  // (ax, y0..y1, az); writes the closest point on P0-P1 as a parameter
  let _segU = 0;
  function segCapsuleD2(x0, y0, z0, x1, y1, z1, ax, ay0, ay1, az) {
    // closest approach in XZ along the swept segment, then the height there
    const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz;
    let u = L2 > 1e-8 ? ((ax - x0) * dx + (az - z0) * dz) / L2 : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    _segU = u;
    const px = x0 + dx * u, pz = z0 + dz * u, py = y0 + (y1 - y0) * u;
    const ex = px - ax, ez = pz - az;
    const ey = py < ay0 ? ay0 - py : py > ay1 ? py - ay1 : 0;
    return ex * ex + ez * ez + ey * ey;
  }
  function debrisHits(dt) {
    const D = CBZ.debris;
    if (!D || !D.forEachLive || !WD || !WD.actors || !WD.hit) return;
    const P = CBZ.player;
    D.forEachLive(function (b) {
      if (b.owner !== OWNER || b.asleep || !b.mesh) return;
      const p = b.mesh.position;
      // where it was when we last looked (a new piece starts here)
      if (b._hx == null) { b._hx = p.x; b._hy = p.y; b._hz = p.z; return; }
      const x0 = b._hx, y0 = b._hy, z0 = b._hz;
      b._hx = p.x; b._hy = p.y; b._hz = p.z;
      if (b._hurHit) return;
      const sp = Math.hypot(b.v.x, b.v.y, b.v.z);
      if (sp < 8) return;                        // a piece sliding along the ground hurts nobody
      const thick = Math.min(0.25, (b.radius || 0.2) * 0.5);
      const R = CAP_R + thick, R2 = R * R;
      const minX = Math.min(x0, p.x) - R - 0.1, maxX = Math.max(x0, p.x) + R + 0.1;
      const minZ = Math.min(z0, p.z) - R - 0.1, maxZ = Math.max(z0, p.z) + R + 0.1;
      WD.actors(function (a) {
        if (b._hurHit || a.dead || !a.pos) return;
        const ax = a.pos.x, az = a.pos.z;
        if (ax < minX || ax > maxX || az < minZ || az > maxZ) return;
        const ay = a.pos.y || 0;
        if (segCapsuleD2(x0, y0, z0, p.x, p.y, p.z, ax, ay + CAP_LO, ay + CAP_HI, az) > R2) return;
        // relative speed: the piece's velocity less the body's own
        let avx = 0, avz = 0;
        if (a.isPlayer && P) { avx = P.moveX || 0; avz = P.moveZ || 0; }
        else if (a.vel) { avx = a.vel.x || 0; avz = a.vel.z || 0; }
        const rvx = b.v.x - avx, rvy = b.v.y, rvz = b.v.z - avz;
        const rel = Math.hypot(rvx, rvy, rvz);
        const mass = Math.max(0.05, b.mass || 1);
        const energy = 0.5 * mass * rel * rel;     // joules
        if (rel < 8 || energy < 25) return;      // it touched you; it did not hurt you
        b._hurHit = 1; town.debrisHits++;
        const hz = Math.hypot(rvx, rvz) || 1;
        _hitO.dirx = rvx / hz; _hitO.dirz = rvz / hz; _hitO.speed = rel; _hitO.mass = mass; _hitO.energy = energy;
        _hitO.x = x0 + (p.x - x0) * _segU; _hitO.y = y0 + (p.y - y0) * _segU; _hitO.z = z0 + (p.z - z0) * _segU;
        try { WD.hit(a, _hitO); } catch (e) {}
        // the piece gave most of its speed to the body it struck
        b.v.multiplyScalar(0.35);
      });
    });
  }

  /* ============================================================
     TREES
     ============================================================ */
  const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _ax = new THREE.Vector3(), _v = new THREE.Vector3();
  /* WHERE A FALLING TREE LANDS: when the point 85% of the way up to its
     crown meets the ground along its fall (it used to stop at a fixed 81
     degrees, short of a downhill slope, its length hanging over the hill). */
  const FALL_MAX = Math.PI / 2 + 0.45;
  const _lv = new THREE.Vector3();
  function treeLands(t, st, a) {
    if (a >= FALL_MAX) return true;
    if (a < 0.35) return false;
    _ax.set(st.fdz, 0, -st.fdx).normalize();
    _lv.set(0, st.H * 0.85, 0).applyAxisAngle(_ax, a).add(st.p0);
    return _lv.y <= groundAt(_lv.x, _lv.z) + 0.3;
  }
  const touchedTrees = [];
  function isPalm(t) {
    if (t.palm != null) return !!t.palm;
    const m = t.foliage && t.foliage.material;
    return !!(m && /palm|frond/i.test(m.name || ""));
  }
  function treeState(t) {
    if (t._hur) return t._hur;
    if (!t.trunk || !t.foliage) return null;
    const tr = t.trunk, fo = t.foliage;
    const H = Math.max(2, fo.position.y - tr.position.y);
    const palm = isPalm(t);
    const st = t._hur = {
      q0: tr.quaternion.clone(), fq0: fo.quaternion.clone(),
      p0: tr.position.clone(), fp0: fo.position.clone(), fs0: fo.scale.clone(),
      palm, H,
      tx: 0, tz: 0, vx: 0, vz: 0,          // the lean, a 2-D vector (rad), and its rate
      down: 0, fall: 0, fallV: 0, fdx: 0, fdz: 0,   // 1 falling, 2 lying
      shed: 0, topped: false, bent: false, district: -1,
      // its own strength against the field. FAILURE IS FATIGUE: `vs` is the
      // wind the tree has felt over its response time (τ≈1.4 s — a gust
      // spike alone does not fell an oak), and `fat` accumulates while vs
      // stands over the break speed, faster the further over it is
      brk: palm ? 74 + 16 * h01(t.x, t.z, 11) : 40 + 18 * h01(t.x, t.z, 11),
      vs: 0, fat: 0,
      shedAt: palm ? 33 + 6 * h01(t.x, t.z, 12) : 30 + 8 * h01(t.x, t.z, 12),
      ph: h01(t.x, t.z, 13) * 6.28,
      // natural frequency: a palm is a whippy pole, an oak a stiff mass
      om: palm ? 2.4 + 0.8 * h01(t.x, t.z, 14) : 3.2 + 1.0 * h01(t.x, t.z, 14),
      peak: 0,
    };
    touchedTrees.push(t);
    return st;
  }
  function applyTree(t, st, tilt, axX, axZ, crownExtra, squash) {
    const tr = t.trunk, fo = t.foliage;
    if (tilt < 1e-4) {
      tr.quaternion.copy(st.q0); fo.quaternion.copy(st.fq0); fo.position.copy(st.fp0);
      fo.scale.copy(st.fs0);
      return;
    }
    _ax.set(axX, 0, axZ).normalize();
    _qa.setFromAxisAngle(_ax, tilt);
    tr.quaternion.copy(_qa).multiply(st.q0);
    // the crown rides the bent top, and streams further than the trunk leans
    _v.copy(st.fp0).sub(st.p0).applyQuaternion(_qa);
    fo.position.copy(st.p0).add(_v);
    if (crownExtra > 0) { _qb.setFromAxisAngle(_ax, crownExtra); _qb.multiply(_qa); fo.quaternion.copy(_qb).multiply(st.fq0); }
    else fo.quaternion.copy(_qa).multiply(st.fq0);
    if (squash !== 1) fo.scale.set(st.fs0.x * (2 - squash) * 0.5 + st.fs0.x * 0.5, st.fs0.y * squash, st.fs0.z * (2 - squash) * 0.5 + st.fs0.z * 0.5);
    else fo.scale.copy(st.fs0);
  }
  function tickTrees(dt) {
    const T = list("trees");
    for (let i = 0; i < T.length; i++) {
      const t = T[i];
      if (t._tsuUproot) continue;               // the wave already took it
      const st = treeState(t); if (!st) continue;
      if (st.down === 2) continue;
      const w = windAt(t.x, t.z);
      const v = w.speed;
      if (v > st.peak) st.peak = v;
      st.vs += (v - st.vs) * Math.min(1, dt * 0.7);
      if (st.down === 1) {
        // WINDTHROW: it goes over about its root plate, accelerating like a
        // falling pole, with the wind still shoving the crown
        st.fallV += (9.8 / Math.max(3, st.H) * 1.5 * Math.sin(Math.max(0.05, st.fall)) + 0.002 * v * v / st.H) * dt;
        st.fall = Math.min(FALL_MAX, st.fall + st.fallV * dt);
        if (treeLands(t, st, st.fall)) {
          st.down = 2;
          if (WD && WD.hurtLine) {
            try { WD.hurtLine(t.x, t.z, t.x + st.fdx * st.H, t.z + st.fdz * st.H, 1.6, "crushed by a falling tree"); } catch (e) {}
          }
          // the crown hits: leaves and twigs burst off it
          for (let k = 0; k < 2; k++) tearBit("plank", t.x + st.fdx * st.H * 0.8, groundAt(t.x, t.z) + 1, t.z + st.fdz * st.H * 0.8,
            0.9 + Math.random(), t.barkHex != null ? t.barkHex : 0x5a4636, w.x * 4, 2 + Math.random() * 2, w.z * 4);
        }
        applyTree(t, st, st.fall, st.fdz, -st.fdx, 0.05, 1);
        continue;
      }
      // the lean the wind wants: θ ∝ v², palms whippy, broadleaf stiff
      let want = st.palm ? Math.min(0.62, 0.42 * Math.pow(v / 45, 1.7)) : Math.min(0.34, 0.26 * (v / 40) * (v / 40));
      // the gust-front flutter on top: a crown is never still in a storm
      const flut = (0.012 + 0.0009 * v) * Math.sin(S.t * (st.palm ? 4.2 : 2.9) + st.ph) * Math.min(1, v / 12);
      const gx = w.x * (want + flut), gz = w.z * (want + flut);
      // damped spring in 2-D (ζ≈0.35): the eye's reversal swings it back through upright
      const om = st.om, om2 = om * om;
      st.vx += (om2 * (gx - st.tx) - 2 * 0.35 * om * st.vx) * dt;
      st.vz += (om2 * (gz - st.tz) - 2 * 0.35 * om * st.vz) * dt;
      st.tx += st.vx * dt; st.tz += st.vz * dt;
      const tilt = Math.hypot(st.tx, st.tz);
      if (!st.bent && tilt > (st.palm ? 0.2 : 0.12)) { st.bent = true; town.treesBent++; }
      // the PALM CROWN streams fronds-forward: it leans past the trunk and
      // folds (squashes) into a streamer as the wind rises
      const crown = st.palm ? Math.min(0.55, tilt * 0.9) : tilt * 0.25;
      const squash = st.palm ? 1 - Math.min(0.22, 0.004 * Math.max(0, v - 15)) : 1;
      if (tilt > 1e-4) applyTree(t, st, tilt, st.tz / tilt, -st.tx / tilt, crown, squash);
      else applyTree(t, st, 0, 1, 0, 0, 1);
      // SHEDDING: fronds and branches strip off downwind
      if (st.vs > st.shedAt && st.shed < (st.palm ? 5 : 3) && !st.topped) {
        if (Math.random() < dt * 0.35 * (st.vs - st.shedAt) / 12) {
          st.shed++;
          const top = t.foliage.position;
          if (st.palm) {
            town.frondsStripped++;
            tearBit("flake", top.x, top.y, top.z, 1.3, t.leafHex != null ? t.leafHex : 0x2a4c14,
              w.x * v * 0.5, 2 + Math.random() * 3, w.z * v * 0.5);
          } else {
            town.branchesStripped++;
            tearBit("plank", top.x, top.y - 0.5, top.z, 1.2 + Math.random() * 0.8, t.barkHex != null ? t.barkHex : 0x5a4636,
              w.x * v * 0.4, 2 + Math.random() * 2, w.z * v * 0.4);
          }
        }
      }
      // FAILURE: the wind THIS tree feels has stood over its own break speed
      // long enough (fatigue reaches 1)
      if (st.vs > st.brk) st.fat += dt * ((st.vs / st.brk) * (st.vs / st.brk) - 1) * (st.palm ? 0.5 : 0.6);
      if (st.fat >= 1) {
        if (st.palm) {
          if (!st.topped) {
            // a palm almost never falls: the CROWN goes, fronds everywhere
            st.topped = true; town.palmsTopped++;
            const top = t.foliage.position;
            t.foliage.visible = false;
            for (let k = 0; k < 5; k++) tearBit("flake", top.x + (Math.random() - 0.5), top.y, top.z + (Math.random() - 0.5),
              1.3, t.leafHex != null ? t.leafHex : 0x2a4c14, w.x * v * 0.5, 1 + Math.random() * 4, w.z * v * 0.5);
          }
        } else {
          st.down = 1; st.fall = tilt; st.fallV = Math.hypot(st.vx, st.vz) * 0.5;
          st.fdx = w.x; st.fdz = w.z;
          town.treesDown++;
          if (st.district >= 0 && PW) PW.treesIn[st.district]++;
          if (t.trunkCol && WD && WD.release) { try { WD.release(t.trunkCol); } catch (e) {} }
        }
      }
    }
  }
  /* THE WIND DROPS (2026-10-19): tickTrees only runs while the storm does,
     so a tree going over when the card ended froze half way down, leaning
     on nothing, for the rest of the match, and every bent tree kept the lean
     of the last gust. On end(): what was falling lands, what was bending
     stands back up. */
  function settleTrees() {
    for (let i = 0; i < touchedTrees.length; i++) {
      const t = touchedTrees[i], st = t._hur;
      if (!st || t._tsuUproot || !t.trunk || !t.foliage) continue;
      if (st.down === 1) {
        let a = st.fall;
        while (!treeLands(t, st, a)) a = Math.min(FALL_MAX, a + 0.04);
        st.fall = a; st.down = 2; st.fallV = 0;
        applyTree(t, st, st.fall, st.fdz, -st.fdx, 0.05, 1);
      } else if (!st.down) {
        st.tx = st.tz = st.vx = st.vz = 0;
        applyTree(t, st, 0, 1, 0, 0, 1);
      }
    }
  }
  function restoreTrees() {
    for (let i = 0; i < touchedTrees.length; i++) {
      const t = touchedTrees[i], st = t._hur;
      if (!st) continue;
      if (t._tsuUproot) { t._hur = null; continue; }   // the wave re-parented it
      t.trunk.quaternion.copy(st.q0); t.trunk.position.copy(st.p0);
      t.foliage.quaternion.copy(st.fq0); t.foliage.position.copy(st.fp0); t.foliage.scale.copy(st.fs0);
      t.foliage.visible = true;
      if (st.down && t.trunkCol && CBZ.colliders && CBZ.colliders.indexOf(t.trunkCol) < 0) {
        CBZ.colliders.push(t.trunkCol);
        if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      }
      t._hur = null;
    }
    touchedTrees.length = 0;
  }

  /* ============================================================
     ROOFS, WINDOWS, FRAME
     Edges: 0 -z, 1 +z, 2 -x, 3 +x. Peel depth per edge in metres; every
     ~0.9 m of edge peeled tears a sheet off as a rigid body. (The instanced
     "bare decking" strips and hinged flaps that used to stand for the peel
     are gone: they were drawn in world space off the building's ORIGINAL
     roof height and hovered there once anything moved the building.)
     ============================================================ */
  const EDGE_N = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  const touchedBldg = [];
  function roofHexOf(b) {
    if (b.roofHex != null) return b.roofHex;
    if (b._hurRoofHex != null) return b._hurRoofHex;
    // the highest wide flat mesh of its group (a roof is what you see on top)
    let best = null, bestY = -1e9;
    if (b.group && b.group.traverse) {
      b.group.updateMatrixWorld(true);
      const bb = new THREE.Box3();
      b.group.traverse(function (o) {
        if (!o.isMesh || !o.geometry || !o.material || Array.isArray(o.material) || !o.material.color || o.material.transparent) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        const wide = (bb.max.x - bb.min.x) > b.w * 0.5 && (bb.max.z - bb.min.z) > b.d * 0.5;
        if (wide && bb.max.y > bestY) { bestY = bb.max.y; best = o.material; }
      });
    }
    b._hurRoofHex = best ? best.color.getHex() : (b.color != null ? b.color : 0x6a6a6a);
    return b._hurRoofHex;
  }
  function bldgState(b) {
    if (b._hur) return b._hur;
    const st = b._hur = {
      roofY: b.roofY != null ? b.roofY : (b.gy || 0) + b.h,
      peel: [0, 0, 0, 0], sheet: [0, 0, 0, 0], gy0: b.group ? b.group.position.y : null,
      thr: 28 + 12 * h01(b.x, b.z, 21), faces: 0, faceK: [0, 0, 0, 0], frame: 0, peak: 0, peeling: false, stripped: false, vs: 0,
      hex: roofHexOf(b),
    };
    touchedBldg.push(b);
    return st;
  }
  let frameClock = 0;
  function tickBuildings(dt) {
    const B = list("buildings");
    frameClock += dt;
    const ledgerTick = frameClock >= 0.25;
    if (ledgerTick) frameClock = 0;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if (b.fallen) continue;
      const st = bldgState(b);
      const w0 = windAt(b.x, b.z);
      // wind at roof height: the log profile, ~+4% per storey up to ~10
      const vg = w0.speed * (1 + 0.04 * Math.min(10, (st.roofY - (b.gy || 0)) / 3.2));
      const wx = w0.x, wz = w0.z;
      if (vg > st.peak) st.peak = vg;
      // roofing and frame answer the wind over ~1.4 s; glass answers the gust
      st.vs += (vg - st.vs) * Math.min(1, dt * 0.7);
      const v = st.vs;
      // ---- the roof peels from its edges ----
      if (v > st.thr && !st.stripped) {
        const k = (v * v - st.thr * st.thr) / (st.thr * st.thr);
        const rate = 0.3 * k * dt;                         // metres of edge per second
        let total = 0;
        for (let e = 0; e < 4; e++) {
          const n = EDGE_N[e];
          // the WINDWARD edge (its normal faces into the wind) takes the most,
          // the two edges beside it take the corner vortices, the lee none
          const facing = -(n[0] * wx + n[1] * wz);
          const share = facing > 0.5 ? 0.6 : facing > -0.5 ? 0.22 : 0;
          if (!share) continue;
          const cap = (n[0] ? b.w : b.d) * 0.5;
          const before = st.peel[e];
          st.peel[e] = Math.min(cap, before + rate * share);
          // a sheet tears off every ~0.9 m of edge peeled
          while (st.peel[e] >= (st.sheet[e] + 1) * 0.9 && st.sheet[e] < 24) {
            st.sheet[e]++;
            {
              const n2 = EDGE_N[e], along = n2[0] ? b.d : b.w;
              const off = (Math.random() - 0.5) * along * 0.8;
              const ex = b.x + n2[0] * (b.w / 2 - st.peel[e] * 0.5) + (n2[0] ? 0 : off);
              const ez = b.z + n2[1] * (b.d / 2 - st.peel[e] * 0.5) + (n2[1] ? 0 : off);
              // the roof's CURRENT top (a building a quake has dropped peels
              // from where its roof is now, not where it was built)
              const ry = curRoofY(b, st);
              if (tearSheet(ex, ry + 0.3, ez, !n2[0], 1.1 + Math.random() * 1.4, 0.9 + Math.random() * 0.6, st.hex,
                wx * v * 0.3, 3 + Math.random() * 4, wz * v * 0.3)) town.roofSheets++;
            }
          }
          total += st.peel[e] / cap;
        }
        if (!st.peeling && total > 0.04) { st.peeling = true; town.roofsPeeling++; }
        if (total >= 2.2 && !st.stripped) { st.stripped = true; town.roofsStripped++; }
      }
      // ---- WINDOWS BLOWN IN on the windward face ----
      // glass answers the GUST, and not every pane at once: the share of a
      // face that goes rises with the gust (and an opened roof pressurises
      // the inside, which blows out panes the gust alone would not)
      const internal = st.peeling && (st.peel[0] + st.peel[1] + st.peel[2] + st.peel[3]) > 2;
      const share = Math.min(1, Math.max(0, (vg - (internal ? 40 : 48)) / 26));
      if (share > 0.1 && WD && WD.shatter) {
        for (let e = 0; e < 4; e++) {
          const n = EDGE_N[e];
          if (-(n[0] * wx + n[1] * wz) < 0.55 || share < st.faceK[e] + 0.12) continue;
          if (!(st.faces & (1 << e))) { st.faces |= 1 << e; town.facesBlown++; }
          // walk the face: a point just outside it every few metres; each
          // point has its own strength (position hash) against the share
          const along = n[0] ? b.d : b.w, steps = Math.max(2, Math.round(along / 2.5));
          let got = 0;
          for (let s2 = 0; s2 < steps; s2++) {
            const u = (s2 + 0.5) / steps - 0.5;
            const px = b.x + n[0] * (b.w / 2 + 0.6) + (n[0] ? 0 : u * b.w);
            const pz = b.z + n[1] * (b.d / 2 + 0.6) + (n[1] ? 0 : u * b.d);
            const hk = h01(px, pz, 91);
            if (hk < st.faceK[e] || hk >= share) continue;
            try { got += WD.shatter(px, pz, Math.min(2.2, along / steps * 0.6)) | 0; } catch (e2) {}
          }
          st.faceK[e] = share;
          town.windowsBlown += got;
        }
      }
      // ---- the frame takes the load, through ONE adapter ----
      if (ledgerTick && v > 36 && st.frame < 0.9) {
        const amt = Math.min(0.9 - st.frame, 0.0035 * Math.max(0, Math.pow(v / 36, 3) - 1) * (st.stripped ? 1.3 : 1));
        if (amt > 0.0005) { st.frame += amt; damageBuilding(b, amt, wx, wz, st.roofY); }
      }
    }
  }
  function restoreBuildings() {
    for (let i = 0; i < touchedBldg.length; i++) touchedBldg[i]._hur = null;
    touchedBldg.length = 0;
  }
  // where the roof is NOW: its built height moved with the group (a quake's
  // settlement or a sinkhole's tilt carries the whole group)
  function curRoofY(b, st) {
    const g = b.group;
    return g && st.gy0 != null ? st.roofY + (g.position.y - st.gy0) : st.roofY;
  }

  /* ============================================================
     SIGNS
     ============================================================ */
  const touchedSigns = [];
  function tickSigns(dt) {
    const L = list("signs");
    for (let i = 0; i < L.length; i++) {
      const s = L[i];
      const m = s.mesh || s.group; if (!m) continue;
      let st = s._hur;
      if (!st) {
        st = s._hur = { q0: m.quaternion.clone(), gone: false, lean: 0, lv: 0, thr: 32 + 14 * h01(s.x, s.z, 51) };
        touchedSigns.push(s);
      }
      if (st.gone) continue;
      const w = windAt(s.x, s.z);
      const want = Math.min(0.5, 0.3 * (w.speed / 40) * (w.speed / 40)) + 0.04 * Math.sin(S.t * 11 + st.thr) * Math.min(1, w.speed / 25);
      st.lv += (36 * (want - st.lean) - 4 * st.lv) * dt;
      st.lean += st.lv * dt;
      _ax.set(w.z, 0, -w.x);
      _qa.setFromAxisAngle(_ax, st.lean);
      m.quaternion.copy(_qa).multiply(st.q0);
      if (w.speed > st.thr) {
        st.gone = true; town.signsDown++;
        // the panel ITSELF rips off into the wind: its own geometry becomes a
        // rigid body (the original hides; restoreSigns shows it again)
        let n = 0;
        if (CBZ.debris && CBZ.debris.adopt) {
          try {
            const out = CBZ.debris.adopt(m, { whole: "all", owner: OWNER, maxLife: 60,
              velocity: { x: w.x * w.speed * 0.4, y: 2 + Math.random() * 3, z: w.z * w.speed * 0.4 },
              angular: { x: (Math.random() - 0.5) * 5, y: (Math.random() - 0.5) * 3, z: (Math.random() - 0.5) * 5 } });
            n = out ? out.pieces || 0 : 0;
          } catch (e) { n = 0; }
        }
        town.debrisLaunched += n;
        m.visible = false;
      }
    }
  }
  function restoreSigns() {
    for (let i = 0; i < touchedSigns.length; i++) {
      const s = touchedSigns[i], m = s.mesh || s.group;
      if (s._hur && m) { m.quaternion.copy(s._hur.q0); m.visible = true; }
      s._hur = null;
    }
    touchedSigns.length = 0;
  }

  /* ============================================================
     BOATS
     ============================================================ */
  const touchedBoats = [];
  function tickBoats(dt) {
    const L = list("boats");
    for (let i = 0; i < L.length; i++) {
      const bt = L[i]; const g = bt.group; if (!g) continue;
      let st = bt._hur;
      if (!st) {
        st = bt._hur = {
          p0: g.position.clone(), q0: g.quaternion.clone(), yaw0: bt.yaw != null ? bt.yaw : g.rotation.y,
          x: g.position.x, z: g.position.z, yaw: bt.yaw != null ? bt.yaw : g.rotation.y,
          loose: false, beached: false, roll: 0, pitch: 0, vx: 0, vz: 0,
          thr: 30 + 14 * h01(g.position.x, g.position.z, 61), vs: 0,
          draft: bt.draft || 0.5, len: bt.len || 5, ph: h01(g.position.x, g.position.z, 62) * 6.28,
        };
        touchedBoats.push(bt);
      }
      const w = windAt(st.x, st.z);
      const surf = seaAt(st.x, st.z), gy = groundAt(st.x, st.z);
      const depth = surf - gy;
      if (!st.loose) {
        // MOORED: weathervanes bow-to-wind, heaves on the swell; the line's
        // load is wind on the topsides plus the surge lifting it against scope
        const wantYaw = Math.atan2(-w.x, -w.z);
        let dy = wantYaw - st.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        st.yaw += dy * Math.min(1, dt * 0.8 * Math.min(1, w.speed / 10));
        st.vs += (w.speed - st.vs) * Math.min(1, dt * 0.7);
        const load = st.vs + (S ? S.surge * 6 : 0);
        if (load > st.thr) { st.loose = true; town.boatsLoose++; }
      } else if (!st.beached) {
        // ADRIFT: ~5% of the wind plus the surge current, beam-on to the wind
        const cur = S ? 0.5 * S.surge : 0;
        st.vx += ((w.x * w.speed * 0.05 + (S ? S.fwdX * cur : 0)) - st.vx) * Math.min(1, dt * 0.6);
        st.vz += ((w.z * w.speed * 0.05 + (S ? S.fwdZ * cur : 0)) - st.vz) * Math.min(1, dt * 0.6);
        st.x += st.vx * dt; st.z += st.vz * dt;
        if (CBZ.collide) {
          _p.set(st.x, surf, st.z);
          try { CBZ.collide(_p, st.len * 0.3); } catch (e) {}
          if (Math.abs(_p.x - st.x) + Math.abs(_p.z - st.z) > 0.01) { st.vx *= -0.3; st.vz *= -0.3; st.x = _p.x; st.z = _p.z; }
        }
        let dy = Math.atan2(-w.z, w.x) - st.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        st.yaw += dy * Math.min(1, dt * 0.3);
        // AGROUND when the water under it is shallower than its draft
        if (depth < st.draft) {
          st.beached = true; town.boatsBeached++;
          st.roll = (h01(st.x, st.z, 63) < 0.5 ? -1 : 1) * (0.7 + 0.4 * h01(st.x, st.z, 64));
        }
      } else if (depth > st.draft + 0.4) {
        st.beached = false;            // refloated by a higher surge
      }
      const heave = st.beached ? 0 : Math.sin(S.t * 1.7 + st.ph) * (0.15 + 0.006 * w.speed);
      const y = st.beached ? gy + 0.1 : surf - st.draft * 0.5 + heave;
      g.position.set(st.x, y, st.z);
      const rollNow = st.beached ? st.roll : Math.sin(S.t * 2.3 + st.ph) * (0.05 + 0.004 * w.speed);
      _e.set(st.beached ? 0.05 : Math.sin(S.t * 1.9 + st.ph * 2) * (0.04 + 0.002 * w.speed), st.yaw, rollNow, "YXZ");
      g.quaternion.setFromEuler(_e);
    }
  }
  function restoreBoats() {
    for (let i = 0; i < touchedBoats.length; i++) {
      const bt = touchedBoats[i], st = bt._hur;
      if (st && bt.group) { bt.group.position.copy(st.p0); bt.group.quaternion.copy(st.q0); }
      bt._hur = null;
    }
    touchedBoats.length = 0;
  }

  /* ============================================================
     CARS — rock, shove, flip (the world's own tumble), float
     ============================================================ */
  const myCars = [];
  function tickCars(dt) {
    const L = list("cars");
    let rocking = 0;
    for (let i = 0; i < L.length; i++) {
      const car = L[i]; const g = car.group; if (!g) continue;
      const st = car._hur;
      if (st && st.mode) { stepMyCar(car, st, dt); continue; }
      if (car.flung) continue;
      const w = windAt(car.x, car.z);
      const sea = seaAt(car.x, car.z), gy = groundAt(car.x, car.z);
      // TWO FEET FLOATS A CAR
      if (sea - gy > 0.6) { takeCar(car, "float"); town.carsFloated++; continue; }
      // a parked car slides when the wind it has felt over ~1.4 s beats its
      // tyres' grip on wet asphalt (a sedan: ~50-62 m/s)
      car._hurVs = (car._hurVs || 0) + (w.speed - (car._hurVs || 0)) * Math.min(1, dt * 0.7);
      if (car._hurVs > carThr(car)) { takeCar(car, "shove"); town.carsPushed++; continue; }
      if (w.speed > 26) {
        // ROCKING on its springs, nose-to-tail and side-to-side (visual only)
        rocking++;
        const k = Math.min(1, (w.speed - 26) / 30);
        car._windRock = 1;
        g.position.x = car.x + w.x * 0.09 * k * Math.sin(S.t * 11 + i * 1.7);
        g.position.z = car.z + w.z * 0.09 * k * Math.sin(S.t * 13 + i * 2.1);
        g.rotation.z = 0.045 * k * Math.sin(S.t * 9 + i);
      } else if (car._windRock) {
        car._windRock = 0;
        g.position.x = car.x; g.position.z = car.z; g.rotation.z = 0;
      }
    }
    town.carsRocking = Math.max(town.carsRocking, rocking);
  }
  function carThr(car) { return 54 + 12 * h01(car.x, car.z, 71); }
  function takeCar(car, mode) {
    car.flung = true;   // the arena's own reset() parks it back
    if (car.collider && WD && WD.release) { try { WD.release(car.collider); } catch (e) {} }
    const g = car.group;
    car._hur = { mode, x: g.position.x, y: g.position.y, z: g.position.z, vx: 0, vz: 0, yaw: g.rotation.y, spin: 0, pitch: 0, roll: 0 };
    car._windRock = 0;
    myCars.push(car);
  }
  function stepMyCar(car, st, dt) {
    const g = car.group;
    const w = windAt(st.x, st.z);
    const sea = seaAt(st.x, st.z), gy = groundAt(st.x, st.z);
    const depth = sea - gy;
    if (st.mode !== "float" && depth > 0.6) { st.mode = "float"; town.carsFloated++; }
    if (st.mode === "float") {
      // AFLOAT: nose-down (the engine is the heavy end), turning slowly,
      // drifting with the water and the wind on its glasshouse
      const cur = S ? 0.6 + 0.4 * S.surge : 0.3;
      st.vx += ((w.x * w.speed * 0.025 + (S ? S.fwdX * cur : 0)) - st.vx) * Math.min(1, dt * 0.5);
      st.vz += ((w.z * w.speed * 0.025 + (S ? S.fwdZ * cur : 0)) - st.vz) * Math.min(1, dt * 0.5);
      st.spin += ((h01(car.x, car.z, 72) - 0.5) * 0.5 - st.spin) * Math.min(1, dt);
      st.pitch += (0.16 - st.pitch) * Math.min(1, dt);
      if (depth < 0.5) { st.mode = "rest"; }
      st.y = depth < 0.5 ? gy : Math.max(gy, sea - 0.75) + Math.sin((S ? S.t : 0) * 1.4 + car.x) * 0.06;
    } else if (st.mode === "shove") {
      // SHOVED: the parked car slides downwind across the wet road, and a
      // cat-4/5 gust rolls it (the world's own tumble, collider and all)
      const thr = carThr(car);
      const push = Math.max(0, w.speed - thr) * 0.09;
      st.vx += (w.x * push - st.vx) * Math.min(1, dt * 2);
      st.vz += (w.z * push - st.vz) * Math.min(1, dt * 2);
      st.roll += ((push > 0.2 ? 0.08 : 0) - st.roll) * Math.min(1, dt * 3);
      st.y = gy;
      if (w.speed > 64 && WD && WD.fling && Math.random() < dt * 0.4) {
        car._hur = null;
        car.flung = false;    // let the world's fling take it from here
        try { WD.fling(car, w.x, w.z, 3.5 + (w.speed - 48) * 0.2, 1.4); } catch (e) {}
        counts.carsFlung++;
        return;
      }
      if (w.speed < thr * 0.8) { st.vx *= 1 - Math.min(1, dt * 3); st.vz *= 1 - Math.min(1, dt * 3); }
    } else {
      st.vx = st.vz = 0; st.y = gy; st.pitch *= 0.9;
    }
    st.x += st.vx * dt; st.z += st.vz * dt;
    if (CBZ.collide && st.mode !== "rest") {
      _p.set(st.x, st.y, st.z);
      try { CBZ.collide(_p, 1.0); } catch (e) {}
      if (Math.abs(_p.x - st.x) + Math.abs(_p.z - st.z) > 0.001) { st.x = _p.x; st.z = _p.z; st.vx *= 0.2; st.vz *= 0.2; }
    }
    st.yaw += st.spin * dt;
    g.position.set(st.x, st.y, st.z);
    _e.set(st.pitch, st.yaw, st.roll, "YXZ");
    g.quaternion.setFromEuler(_e);
  }
  function restoreCars() {
    for (let i = 0; i < myCars.length; i++) myCars[i]._hur = null;
    myCars.length = 0;
  }

  /* ============================================================
     THE SEA ON TOP OF THE SURGE: state + surf on the shore
     ============================================================ */
  const NRAY = 64;
  let COAST = null;     // per ray: profile heights every STEP metres
  const STEP = 2;
  function buildCoast() {
    if (!WD || !WD.groundAt) { COAST = null; return; }
    const R = WD.R || 120, n = Math.ceil(R * 1.7 / STEP);
    const prof = new Float32Array(NRAY * n);
    for (let k = 0; k < NRAY; k++) {
      const a = k / NRAY * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      for (let j = 0; j < n; j++) prof[k * n + j] = WD.groundAt(WD.cx + ca * j * STEP, WD.cz + sa * j * STEP);
    }
    COAST = { prof, n, shore: new Float32Array(NRAY), level: -1e9 };
  }
  // where along each ray the water's edge stands for sea level `lv`
  function shoreline(lv) {
    if (!COAST || Math.abs(lv - COAST.level) < 0.05) return;
    COAST.level = lv;
    for (let k = 0; k < NRAY; k++) {
      let s = -1;
      for (let j = COAST.n - 1; j >= 0; j--) { if (COAST.prof[k * COAST.n + j] >= lv) { s = (j + 0.5) * STEP; break; } }
      COAST.shore[k] = s;
    }
  }
  let SP = null;           // the surf pool (Points)
  const SPMAX = 420;
  function sprayPool() {
    if (SP) return SP;
    const pos = new Float32Array(SPMAX * 3);
    for (let i = 0; i < SPMAX; i++) pos[i * 3 + 1] = -1e4;
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(pos, 3);
    if (attr.setUsage) attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", attr);
    const mat = new THREE.PointsMaterial({ color: 0xeef3f6, size: 1.1, transparent: true, opacity: 0.6, map: softDot(), depthWrite: false, fog: true });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false; pts.renderOrder = 6; pts.name = "hurricane-surf";
    CBZ.scene.add(pts);
    SP = { pts, geo, attr, mat, pos, vel: new Float32Array(SPMAX * 3), life: new Float32Array(SPMAX), next: 0 };
    return SP;
  }
  function burst(x, y, z, n, up, wx, wz, wsp) {
    const P = sprayPool();
    for (let k = 0; k < n; k++) {
      const i = P.next; P.next = (P.next + 1) % SPMAX;
      const o = i * 3;
      P.pos[o] = x + (Math.random() - 0.5) * 3; P.pos[o + 1] = y; P.pos[o + 2] = z + (Math.random() - 0.5) * 3;
      P.vel[o] = wx * wsp * (0.15 + Math.random() * 0.2) + (Math.random() - 0.5) * 3;
      P.vel[o + 1] = up * (0.5 + Math.random() * 0.7);
      P.vel[o + 2] = wz * wsp * (0.15 + Math.random() * 0.2) + (Math.random() - 0.5) * 3;
      P.life[i] = 1.2 + Math.random() * 1.2;
    }
  }
  let surfClock = 0;
  function tickSea(dt) {
    if (!S) return;
    const lv = seaRest() + S.surge;
    shoreline(lv);
    surfClock += dt;
    if (COAST && surfClock > 0.06) {
      surfClock = 0;
      // SURF: pick shore rays where the wind blows ONTO the land; the waves on
      // top of the surge break there, higher with the wind and the surge
      for (let tries = 0; tries < 3; tries++) {
        const k = (Math.random() * NRAY) | 0;
        const s = COAST.shore[k]; if (s < 0) continue;
        const a = k / NRAY * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const x = WD.cx + ca * s, z = WD.cz + sa * s;
        const w = windAt(x, z);
        const onshore = -(w.x * ca + w.z * sa);
        if (onshore < 0.2 || w.speed < 16) continue;
        const up = 3 + 0.12 * w.speed * onshore + 2.5 * S.surge;
        burst(x, lv + 0.2, z, 6 + ((w.speed / 10) | 0), up, w.x, w.z, w.speed);
        town.surfBursts++;
      }
      // THE HARBOUR takes it hardest: the seawall and pier head stand in it
      const H = list("harbour");
      if (H.length && Math.random() < 0.5) {
        const h = H[(Math.random() * H.length) | 0];
        const w = windAt(h.x, h.z);
        if (w.speed > 16) {
          burst(h.x, lv + 0.4, h.z, 12 + ((w.speed / 6) | 0), 5 + 0.2 * w.speed + 3 * S.surge, w.x, w.z, w.speed);
          town.harbourBursts++;
        }
      }
    }
    if (SP) {
      for (let i = 0; i < SPMAX; i++) {
        if (SP.life[i] <= 0) continue;
        const o = i * 3;
        SP.life[i] -= dt;
        if (SP.life[i] <= 0) { SP.pos[o + 1] = -1e4; continue; }
        SP.vel[o + 1] -= 9.8 * dt;
        SP.pos[o] += SP.vel[o] * dt; SP.pos[o + 1] += SP.vel[o + 1] * dt; SP.pos[o + 2] += SP.vel[o + 2] * dt;
        if (SP.pos[o + 1] < lv - 0.5) { SP.life[i] = 0; SP.pos[o + 1] = -1e4; }
      }
      SP.attr.needsUpdate = true;
    }
  }
  /* the swell ON TOP of the surge: amp/chop/foam the world's sea reads. The
     sea you see is the sea near you, so it follows the wind at (x,z). */
  const _ss = { amp: 0.86, chop: 0.72, foam: 0.34 };
  function seaState(x, z) {
    if (!S) { _ss.amp = 0.86; _ss.chop = 0.72; _ss.foam = 0.34; return _ss; }
    const w = windAt(x, z);
    const k = Math.min(1.3, w.speed / 50);
    _ss.amp = 0.86 + k * (0.55 + 0.22 * S.catF) + S.surge * 0.12;
    _ss.chop = 0.72 + 1.5 * Math.min(1, k);
    _ss.foam = Math.min(1, 0.34 + 0.75 * Math.min(1, k));     // whipped white
    return _ss;
  }

  /* ============================================================
     POWER — districts, flicker, dark. The dark is drawn in the shader.
     ============================================================ */
  const NDIST = 9;
  const pwrU = { value: [] };
  for (let i = 0; i < NDIST; i++) pwrU.value.push(new THREE.Vector4(0, 0, 0, 1));
  let PW = null;
  const patched = [];
  const POWER_NAME = /streetlight|dressing-lens|lightpool|lamp-lens|lantern|powered/i;
  function patchPowerMaterial(mat, floor) {
    if (!mat || mat._hurPower || !mat.isMaterial) return;
    mat._hurPower = true;
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      sh.uniforms.uPwr = pwrU;
      sh.uniforms.uPwrFloor = { value: floor };
      sh.vertexShader = "varying vec2 vPwrXZ;\n" + sh.vertexShader.replace("#include <project_vertex>",
        "#include <project_vertex>\n  vPwrXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
      sh.fragmentShader = "uniform vec4 uPwr[" + NDIST + "];\nuniform float uPwrFloor;\nvarying vec2 vPwrXZ;\n" +
        "float pwrAt(vec2 p) { for (int i = 0; i < " + NDIST + "; i++) { vec4 d = uPwr[i]; if (d.z > 0.0 && abs(p.x - d.x) < d.z && abs(p.y - d.y) < d.z) return d.w; } return 1.0; }\n" +
        sh.fragmentShader.replace("#include <fog_fragment>", "gl_FragColor.rgb *= mix(uPwrFloor, 1.0, pwrAt(vPwrXZ));\n#include <fog_fragment>");
    };
    mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(mat) : "") + "|hurPwr" + floor; };
    mat.needsUpdate = true;
    patched.push(mat);
  }
  /* what is on the grid: every lamp the world lights, found by name, plus
     whatever the world hands over. Idempotent; a patched material keeps
     drawing exactly as before until a district is told it has lost power
     (an unwired mask answers 1 everywhere). */
  function patchPowerIn(world) {
    const root = (world && world.root) || CBZ.scene;
    if (root && root.traverse) root.traverse(function (o) {
      if (!o.material || Array.isArray(o.material)) return;
      const nm = (o.name || "") + " " + (o.material.name || "");
      if (POWER_NAME.test(nm) || (o.userData && o.userData.powered)) patchPowerMaterial(o.material, /pool/i.test(nm) ? 0 : 0.3);
    });
    let extra = null;
    try { extra = world && world.powerMaterials ? world.powerMaterials() : null; } catch (e) { extra = null; }
    if (extra) for (let i = 0; i < extra.length; i++) patchPowerMaterial(extra[i], extra[i].userData && extra[i].userData.powerFloor != null ? extra[i].userData.powerFloor : 0.3);
  }
  function wirePower() {
    const R = (WD && WD.R) || 120, cx = WD ? WD.cx : 0, cz = WD ? WD.cz : 0;
    let D = list("districts");
    if (!D.length) {
      // a 3x3 grid over the island and its shore: the feeders of a small town
      const cell = (R * 1.5 * 2) / 3;
      D = [];
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) D.push({ x: cx + a * cell, z: cz + b * cell, half: cell / 2 });
    }
    D = D.slice(0, NDIST);
    PW = { D, st: new Uint8Array(D.length), t: new Float32Array(D.length), val: new Float32Array(D.length).fill(1),
      peak: new Float32Array(D.length), treesIn: new Int32Array(D.length),
      thr: D.map(function (d) { return 27 + 13 * h01(d.x, d.z, 81); }) };
    for (let i = 0; i < NDIST; i++) {
      const d = D[i];
      if (d) pwrU.value[i].set(d.x, d.z, d.half, 1); else pwrU.value[i].set(0, 0, 0, 1);
    }
    town.districts = D.length;
    patchPowerIn(WD);
    // which district each tree is in (lines come down with the trees)
    const T = list("trees");
    for (let i = 0; i < T.length; i++) {
      if (T[i]._tsuUproot) continue;
      const st = treeState(T[i]); if (!st) continue;
      st.district = districtOf(T[i].x, T[i].z);
    }
  }
  function districtOf(x, z) {
    if (!PW) return -1;
    for (let i = 0; i < PW.D.length; i++) { const d = PW.D[i]; if (Math.abs(x - d.x) < d.half && Math.abs(z - d.z) < d.half) return i; }
    return -1;
  }
  function tickPower(dt) {
    if (!PW) return;
    for (let i = 0; i < PW.D.length; i++) {
      const d = PW.D[i];
      const w = windAt(d.x, d.z);
      if (w.speed > PW.peak[i]) PW.peak[i] = w.speed;
      if (PW.st[i] === 0) {
        // brownout as the load climbs, then the trip
        const thr = PW.thr[i] - 3 * Math.min(4, PW.treesIn[i]);
        PW.val[i] = 1 - 0.25 * Math.max(0, Math.min(1, (w.speed - thr * 0.8) / (thr * 0.2)));
        if (w.speed > thr) { PW.st[i] = 1; PW.t[i] = 0.8 + 1.4 * h01(d.x, d.z, 82); }
      } else if (PW.st[i] === 1) {
        // FLICKER: the breakers try to reclose
        PW.t[i] -= dt;
        if (Math.random() < dt * 14) PW.val[i] = Math.random() < 0.45 ? (0.4 + Math.random() * 0.6) : Math.random() * 0.15;
        if (PW.t[i] <= 0) { PW.st[i] = 2; PW.val[i] = 0; town.districtsOut++; }
      }
      pwrU.value[i].w = PW.val[i];
    }
  }
  function restorePower() {
    PW = null;
    for (let i = 0; i < NDIST; i++) pwrU.value[i].w = 1;
  }

  // ---- lifecycle ---------------------------------------------------------
  CBZ.hurricane = {
    /* begin({cx, cz, R, catF, duration, bearing, offset, world})
       catF/bearing/offset come from the def's SEEDED stream — the category
       and the track are rules (they decide who floods, who stands in the
       wall, and whether the roofs survive), not effects. */
    begin(o) {
      this.end();
      resetEvidence();
      WD = o.world || WD || null;
      if (WD && !Number.isFinite(WD.cx)) { WD.cx = o.cx || 0; WD.cz = o.cz || 0; }
      if (WD && !WD.R) WD.R = o.R || 120;
      const R = o.R || 120;
      const catF = Math.max(1, Math.min(5, o.catF != null ? o.catF : 3));
      const rmw = 32 + 5.5 * catF;                    // radius of maximum wind
      const eyeR = rmw * (0.66 - 0.03 * catF);        // intense storms: tight eye
      const fwdX = Math.cos(o.bearing || 0), fwdZ = Math.sin(o.bearing || 0);
      const span = R * 1.45 + rmw;                    // start/end distance along track
      const off = o.offset || 0;                      // perpendicular track offset
      S = {
        cx: o.cx || 0, cz: o.cz || 0, R,
        catF, rmw, eyeR, eyeCalmR: eyeR * 0.6,
        // BELOW CAT 3 THERE IS NO TRUE EYE: the "calm" floors at up to ~35%
        // of vmax and the rain never fully stops — a ragged lull, not a trap
        calmK: catF >= 3 ? 0.03 : 0.03 + (3 - catF) * 0.16,
        vmax: 20 + 11 * catF,
        fwdX, fwdZ, fwdV: (span * 2) / Math.max(8, o.duration || 30),
        s: -span, span, off, t: 0,
        gustK: 1, gustGoal: 1,
        surge: 0, surgeMax: 0.6 + 0.75 * catF,
        x: 0, z: 0,
      };
      lastCat = catF; lastVmax = S.vmax;
      placeCenter();
      S.grit = buildCloud(520, 0.22, 0.5, 0xb6c0c8, 0.10, 0.3, 2.2);
      S.rag = buildCloud(190, 0.62, 0.85, 0x8a7a60, 0.16, 0.6, 7.0);
      if (WD) {
        buildCoast(); wirePower(); sprayPool();
        fluidOn(true);
        // read every roof's colour now, not on the storm's first frame
        const B = list("buildings");
        for (let i = 0; i < B.length; i++) if (!B[i].fallen) bldgState(B[i]);
      }
    },
    end() {
      if (!S) return;
      disposeCloud(S.grit);
      disposeCloud(S.rag);
      S = null;
      settleTrees();
      // the wind drops: what is still in the air comes down on its own
      fluidOn(false);
      // the lights stay out and the debris stays down: the aftermath is the
      // evidence. resetWorld() (a new match) is what puts the town back.
      if (SP) { for (let i = 0; i < SPMAX; i++) { SP.life[i] = 0; SP.pos[i * 3 + 1] = -1e4; } SP.attr.needsUpdate = true; }
    },
    /* a NEW MATCH: every tree stood back up, every flap and sheet gone, the
       grid re-energised. The arena's own reset() parks the cars (car.flung). */
    resetWorld() {
      this.end();
      restoreTrees(); restoreBuildings(); restoreSigns(); restoreBoats(); restoreCars(); restorePower();
      // every sheet, sign panel, frond and branch it tore off: gone
      fluidOn(false);
      if (CBZ.debris && CBZ.debris.clear) { try { CBZ.debris.clear(OWNER); } catch (e) {} }
    },
    /* MATCH START: put the island's lamps on the grid NOW (a one-time shader
       recompile of a handful of lamp materials), so it lands behind the
       match's own start and never as a hitch when the storm arrives. */
    prewire(world) { if (world) patchPowerIn(world); },
    active() { return !!S; },
    tick(dt, camX, camZ) {
      if (!S) return;
      const t0 = performance.now();
      S.t += dt;
      S.s = Math.min(S.span * 1.05, S.s + S.fwdV * dt);
      placeCenter();
      // the gust envelope: fast attack toward the goal, then the goal itself
      // sags back to 1 — a gust is an impulse, not a new constant
      S.gustK += (S.gustGoal - S.gustK) * Math.min(1, dt * 7);
      S.gustGoal += (1 - S.gustGoal) * Math.min(1, dt * 1.1);
      // surge: a gaussian of track progress peaking just past the island
      // center (the onshore right-front quadrant arriving), rate-limited so
      // the sea CLIMBS (≤ 1.1 m/s) and drains slower
      const p = S.s / (S.R + S.rmw);
      const want = S.surgeMax * Math.exp(-((p - 0.12) * (p - 0.12)) / (2 * 0.34 * 0.34));
      const rate = want > S.surge ? 1.1 : 0.55;
      S.surge += Math.max(-rate * dt, Math.min(rate * dt, want - S.surge));
      if (S.surge > evid.surgePeak) evid.surgePeak = S.surge;
      const cx = camX != null ? camX : S.cx, cz = camZ != null ? camZ : S.cz;
      tickCloud(S.grit, dt, cx, cz);
      tickCloud(S.rag, dt, cx, cz);
      // ---- the town ----
      if (WD) {
        tickTrees(dt); tickBuildings(dt); tickSigns(dt); tickBoats(dt); tickCars(dt);
        debrisHits(dt); tickSea(dt); tickPower(dt);
      }
      // ---- evidence for the audit ----
      const wc = windAt(S.cx, S.cz);
      if (!evid.haveFront && S.s > -S.rmw * 1.05 && S.s < -S.eyeR) {
        evid.frontX = wc.x; evid.frontZ = wc.z; evid.haveFront = true;
      }
      if (!evid.haveBack && S.s > S.rmw * 0.6) {
        evid.backX = wc.x; evid.backZ = wc.z; evid.haveBack = true;
      }
      if (camX != null) {
        const w = windAt(camX, camZ);
        if (w.speed > evid.camPeak) evid.camPeak = w.speed;
        const rc = Math.hypot(camX - S.x, camZ - S.z);
        const inEye = rc < S.eyeR;
        if (inEye) {
          if (w.speed < evid.camCalmMin) evid.camCalmMin = w.speed;
          if (evid.camPeak > S.vmax * 0.5) evid.eyePassedCam = true;
        }
        evid.camInEye = inEye;
        const ph = cameraPhase(camX, camZ);
        if (evid.phases[evid.phases.length - 1] !== ph) evid.phases.push(ph);
        evid.phaseT[ph] = (evid.phaseT[ph] || 0) + dt;
      }
      const ms = performance.now() - t0;
      cost.n++; cost.sum += ms; cost.last = ms; if (ms > cost.max) cost.max = ms;
    },
    /* the def fires this on its seeded gust cadence: everything reading the
       field — drag, debris, rain lean, camera shake, the trees — spikes
       together and then lets go. */
    gustBurst(power) {
      if (!S) return;
      S.gustGoal = Math.max(S.gustGoal, 1 + Math.max(0, power || 0.3));
    },
    windAt,
    localWeather,
    seaState,
    cameraPhase,
    damageBuilding,
    world() { return WD; },
    state() {
      if (!S) return null;
      return {
        eyeX: S.x, eyeZ: S.z, eyeR: S.eyeR, rmw: S.rmw, vmax: S.vmax,
        catF: S.catF, calmK: S.calmK, gustK: S.gustK,
        fwdX: S.fwdX, fwdZ: S.fwdZ, fwdV: S.fwdV, s: S.s, span: S.span,
        surge: S.surge, surgeMax: S.surgeMax,
        phase: phase(),
      };
    },
    /* threat is HONEST, which is the trap: the eye reports near-calm, the
       crowd stops running and drifts back into the open, and the back wall
       arrives from the other direction. */
    threat(x, z) {
      if (!S) return 0;
      const w = windAt(x, z);
      const r = Math.hypot(x - S.x, z - S.z);
      if (r < S.eyeCalmR) return 0.08 + S.calmK;
      return Math.max(0.15, Math.min(1, w.speed / (S.vmax * 0.75)));
    },
    // crosswind escape: perpendicular to the TRACK, away from the track line
    safeDir(x, z) {
      if (!S) return null;
      const side = (x - S.cx) * -S.fwdZ + (z - S.cz) * S.fwdX - S.off;
      const sgn = side >= 0 ? 1 : -1;
      return { x: -S.fwdZ * sgn, z: S.fwdX * sgn };
    },
    count(k, n) { if (counts[k] != null) counts[k] += (n == null ? 1 : n); },
    // the lab and tools: the town tally
    town() { return Object.assign({}, town); },
  };

  function placeCenter() {
    S.x = S.cx + S.fwdX * S.s + -S.fwdZ * S.off;
    S.z = S.cz + S.fwdZ * S.s + S.fwdX * S.off;
  }
  function phase() {
    if (!S) return "none";
    const dEye = Math.hypot(S.cx - S.x, S.cz - S.z);
    if (dEye < S.eyeR) return "eye";
    if (S.s < -S.R * 0.75) return "approach";
    if (S.s < 0) return "front-wall";
    if (S.s < S.R * 0.85) return "back-wall";
    return "tail";
  }
  /* where a point stands in the storm's sequence: outer-bands → eyewall →
     eye → back-eyewall → back-bands. "back" = the center has passed it. */
  function cameraPhase(x, z) {
    if (!S) return "none";
    const dx = x - S.x, dz = z - S.z;
    const r = Math.hypot(dx, dz);
    if (r < S.eyeR) return "eye";
    const passed = dx * S.fwdX + dz * S.fwdZ < 0;     // the center is ahead of it
    if (r < S.rmw * 1.9) return passed ? "back-eyewall" : "eyewall";
    return passed ? "back-bands" : "outer-bands";
  }

  /* ---- the ratchet -------------------------------------------------------
     Live-state answers, not claims. category/vmax and the town's tally
     survive end() so the tail beat still reports the storm that just left. */
  CBZ.hurricaneAudit = function () {
    const dot = evid.haveFront && evid.haveBack
      ? evid.frontX * evid.backX + evid.frontZ * evid.backZ : 1;
    let flying = 0, resting = 0;
    // the storm's own pieces, read off the shared sim (bits are not counted)
    if (CBZ.debris && CBZ.debris.forEachLive) CBZ.debris.forEachLive(function (b) { if (b.owner === OWNER) { if (b.asleep) resting++; else flying++; } });
    return {
      on: true,
      live: !!S,
      phase: phase(),
      category: S ? +S.catF.toFixed(2) : lastCat ? +lastCat.toFixed(2) : 0,
      eyeX: S ? +S.x.toFixed(1) : 0, eyeZ: S ? +S.z.toFixed(1) : 0,
      eyeR: S ? +S.eyeR.toFixed(1) : 0, rmw: S ? +S.rmw.toFixed(1) : 0,
      vmax: S ? +S.vmax.toFixed(1) : lastVmax ? +lastVmax.toFixed(1) : 0,
      gustK: S ? +S.gustK.toFixed(2) : 1,
      windAtCam: 0,
      camPeakWind: +evid.camPeak.toFixed(1),
      eyeCalmMin: evid.camCalmMin < 1e8 ? +evid.camCalmMin.toFixed(2) : -1,
      eyePassedCam: evid.eyePassedCam ? 1 : 0,
      camInEye: evid.camInEye ? 1 : 0,
      camPhases: evid.phases.join(">"),
      camPhaseSecs: Object.keys(evid.phaseT).reduce(function (o, k) { o[k] = +evid.phaseT[k].toFixed(1); return o; }, {}),
      windReversed: (evid.haveFront && evid.haveBack && dot < -0.2) ? 1 : 0,
      reversalDot: +dot.toFixed(3),
      surgeNow: S ? +S.surge.toFixed(2) : 0,
      surgePeak: +evid.surgePeak.toFixed(2),
      debrisStrikes: counts.debrisStrikes,
      debrisKills: counts.debrisKills,
      knockdowns: counts.knockdowns,
      drownings: counts.drownings,
      gusts: counts.gusts,
      carsFlung: counts.carsFlung,
      town: Object.assign({}, town, { debrisFlying: flying, debrisResting: resting, frameLoad: +town.frameLoad.toFixed(3) }),
      powerPatched: patched.length,
      tickMs: cost.n ? +(cost.sum / cost.n).toFixed(3) : 0,
      tickMsMax: +cost.max.toFixed(3),
      wallLive: false,          // the mesh eyewall is gone; kept for old probes
    };
  };
})();

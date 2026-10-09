/* ============================================================
   systems/gore.js — cinematic, visceral death gore for BOTH games.

   One call, CBZ.gore(x, y, z, opts), throws a layered blood event:
     • BLOOD IN THE AIR shaped by the cause (see THE AIRBORNE BLOOD): a
       round's entry back-spatter and exit spray of real-size drops drawn as
       motion streaks, a short soft mist down the shot line, a blade's heavy
       drops and stream, an artery's pulsing jet; every drop that lands is a
       spatter mark on the floor or the wall it hit
     • chunky flying GIBS (limbs/torso, gravity + tumble + settle as debris)
     • lingering ground POOLS that spread from the body and stop, then dry
       from deep glossy red to matte red-brown, soaked into the floor — every
       land mark is a stain FILTERING the drawn floor, one instanced draw
       call (see BLOOD ON THE GROUND IS A STAIN IN THE FLOOR)
     • WALL SPLATTER: if a surface sits just behind the victim along the shot
       line, an impact splat with drips running down is stamped on it
   plus a short red jolt + shake (+ optional slow-mo). Headshots and explosions
   get a bigger mist + spray + pool. Self-contained: shared geometry/materials,
   pooled, hard-capped, distance-LOD'd, driven by one always-updater so prison
   shootouts, survival deaths and city murders all end bloody.

   THE KILL TELLS ITS OWN STORY (why: deaths are the game's exclamation
   points — they must land hard, read directional, and leave evidence):
     • a lazy tap on CBZ.cityKillPed reads the CAUSE of every city kill, so
       gore knows HOW someone died without any caller changing a line:
       - HEADSHOT  → a distinct tighter/faster exit spray and an instant wall
         splat behind the head. In CITY, only a muzzle-close SHOTGUN can cause
         a full decapitation — the head mesh comes OFF, a flying head tumbles and
         settles, and the neck STUMP geysers a heavy arterial spurt (the
         restore-on-reuse audit regrows the head on any rig recycle). A
         pistol/SMG headshot never decapitates.
       - BLUNT melee (beaten) → teeth + spit fly, then a DELAYED bleed-out
         pool spreads under the body a couple of seconds later
       - BLADE melee (stabbed/executed) → 2-3 timed ARTERIAL spurts arc out
         of the corpse as the heart dies
       - RUN OVER  → a long tire-smear streak decal drawn along the car's
         travel line (the wheel drags the blood with it)
     • ground pools GROW over a few seconds and linger MUCH longer near the
       player (evidence you walk past), and a corpse lying in a pool slowly
       soaks dark — one cheap shared-material swap, never a per-frame tint.

   THE WATER MEDIUM (CBZ.CONFIG.GORE_WATER, default on): every layer above is
   AIR physics — ballistic droplets under gravity that land on floorAt, wall
   splats found by a collider ray, mist that rises. Fire any of it under the
   sea and it is silently WRONG: the spray sinks to the seabed and stamps
   pools nobody will ever see, and the wall scan paints a decal on the hull of
   a passing boat. So gore() and gore.spray() ask CBZ.goreMedium() where the
   wound happened and branch themselves — a shark attack, a drowned ped, a shot
   swimmer and a boat crash all bleed correctly with ZERO caller changes. See
   the WATER MEDIUM block below for the colour science and the chum seam.

   NOTHING HERE IS A CUBE (CBZ.CONFIG.GORE_REALISM_V2, default on — see the
   block at the top of the IIFE): a gunshot throws no generic chunks in any
   mode and the chunks an explosion DOES throw are torn irregular solids. The
   blood in the air is not a mesh at all any more (THE AIRBORNE BLOOD, one
   draw call, not behind the flag).

   PRESERVED public API: CBZ.gore(x,y,z,opts), CBZ.clearGore().
   ADDED public API: CBZ.goreMedium(x,y,z), CBZ.goreBloom(x,y,z,opts),
   CBZ.goreSlick(x,z,amount), CBZ.goreChum/goreChumStop/goreChumList,
   CBZ.goreAudit().

   opts: { dir:{x,z}, amount:0.5..2, skin, cloth, slowmo:secs,
           player:bool, sfx:bool|string, head:bool, explosion:bool,
           pop:bool (the head ACTUALLY came apart — skull frags + heavy mist;
           city kills decide this themselves from the killing weapon),
           melee:"blunt"|"blade", smear:bool, smearLen:units }
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  // CITY-GATE for the death-realism pass (owner-filmed: a shootout buried the
  // floor in permanent clothing-colored boxes — "not realistic"). A real kill
  // DROPS the person (ragdoll.js already does the intact body); it does not
  // explode them into cubes. So in CITY mode only: a normal gunshot leaves
  // little-to-no flying gib (reserve dismemberment for explosions or an actual
  // close-shotgun sever), and any gib that DOES spawn FADES OUT
  // and despawns over a few seconds so the battlefield clears. Jail/survival
  // gore stays byte-identical (this flag is read live at every spawn site).
  function cityMode() { return !!(CBZ.game && CBZ.game.mode === "city"); }

  // ---- THE BODY IS NOT MADE OF CUBES (CBZ.CONFIG.GORE_REALISM_V2) -----------
  // The city gate above fixed the city's DEBRIS. It never touched the geometry,
  // and it never reached the prison — where the owner filmed the same shootout
  // and said the same thing: "remove the cubes of blood, it looks so
  // unrealistic." He is describing three different meshes, all of them cubes or
  // near-cubes, and only the first one was ever about the mode:
  //   GIB     BoxGeometry(1,1,1) at scale 0.2-0.5 = a 20-50 cm die, tinted with
  //           the victim's shirt colour, 5-7 of them per gunshot.
  //   DROPLET SphereGeometry(1,5,4) — radius ONE. `size` 0.07-0.18 is therefore
  //           a 14-36 cm faceted ball. A real drop is millimetres; even a
  //           stylised one is a few centimetres, and it is not a sphere in
  //           flight, it is a streak pointing where it is going.
  //   MIST    SphereGeometry(1,4,3) is 12 triangles. At opacity 0.5, lit, and
  //           growing 3.2x, an "aerosol" was a cloud of hard-edged lumps.
  // So the fix is two laws, both live-read so ?cfg_GORE_REALISM_V2=0 reverts
  // the whole pass in one line:
  //   realism()  — the LOOK of the solids: torn irregular chunks instead of
  //                boxes. (The droplets and mist it once also covered are THE
  //                AIRBORNE BLOOD now, which has no legacy path to revert to.)
  //   debrisLaw() — the CITY's death-realism rule, promoted to every mode: a
  //                bullet DROPS a person (ragdoll.js already leaves an intact
  //                body), so it throws no generic chunks at all; an explosion
  //                or an actual sever still does; and anything that does fly
  //                settles, fades and clears instead of decorating the yard.
  function realism() { return !CBZ.CONFIG || CBZ.CONFIG.GORE_REALISM_V2 !== false; }
  function debrisLaw() { return cityMode() || realism(); }
  // Body-drain pools have the same unit bug as the droplets: spawnSplat's
  // `grow` is a RADIUS, so the authored 1.87 for an ordinary kill stamped a
  // 3.7 m lake under one man. Measured against the rig it lies next to, a
  // bled-out body owns something closer to a metre and a half.
  const POOL_K = 0.42;
  function survMode() { return !!(CBZ.game && CBZ.islandModeOn(CBZ.game.mode)); }
  const GRAV = 24;
  // What flies is drawn by THE AIRBORNE BLOOD block below (its own colours,
  // authored as the pixel). These three are what callers still hand in as a
  // `color` for gibs and what the pools are nominally stamped with.
  const BLOOD = 0x8a0b10, BLOOD_D = 0x5e070b, BLOOD_BRT = 0xb01218;
  const BONE = 0xe6ddc8, BONE_D = 0xcfc3ad, TOOTH = 0xf2ead8;
  const bits = [];     // flying gibs + severed parts (blood in the air is the AIR pool)
  const splats = [];   // ground blood pools + tire-smear streaks
  const walls = [];    // vertical wall/surface splatter decals
  const later = [];    // delayed gore beats (arterial spurts, bleed-out pools)
  // ARMED FOR THE DURATION OF ONE WET EVENT (and, via after(), of the delayed
  // beats it queues) — see THE WATER MEDIUM block. Declared up here with the
  // other module state so after() can never read it from the temporal dead
  // zone. Read by spawnBit; cleared at both gore() exits, at the top of every
  // frame, and around every delayed callback, so the worst a thrown handler
  // can do is misroute droplets for a single frame.
  let wetEvent = false;

  // ---- KILL-CONTEXT TAP -----------------------------------------------------
  // peds.js loads after us and calls CBZ.gore from inside cityKillPed without
  // saying HOW the victim died. Wrapping cityKillPed (lazily, once it exists)
  // hands gore the victim + impact + cause for the duration of that one call,
  // so cause-aware gore needs zero changes at any kill site. Consumed once per
  // kill (the explosion-stump second gore call keeps stock treatment).
  let killCtx = null, killTapped = false;
  function installKillTap() {
    const orig = CBZ.cityKillPed;
    if (!orig || orig._goreTap) { killTapped = !!orig; return; }
    CBZ.cityKillPed = function (ped, imp, cause) {
      killCtx = { ped, imp, cause, used: false };
      try { return orig(ped, imp, cause); }
      finally {
        killCtx = null;
        // peds.js's own explosion limb-hide (it sets ped._lostLimb AFTER our
        // gore pass ran) gets ADOPTED into the severed registry: it gains a
        // stump cap, a matching flying part, and the guaranteed restore-on-
        // reuse audit — instead of being a bare invisible limb.
        adoptLostLimb(ped, imp);
      }
    };
    CBZ.cityKillPed._goreTap = true;
    killTapped = true;
  }

  // schedule a delayed gore beat; hard-capped so spam can't queue a flood.
  // The beat remembers WHICH MEDIUM its kill happened in (see the water block
  // below) so a stump that keeps pumping two seconds after a drowning still
  // blooms instead of firing ballistic droplets at the seabed.
  function after(t, fn) { if (later.length > 24) return; later.push({ t, fn, wet: wetEvent }); }

  function scene() { return CBZ.scene; }
  function floorAt(x, z) { return CBZ.floorAt ? CBZ.floorAt(x, z) : 0; }
  function rm(m) { if (!m) return; if (m.parent) m.parent.remove(m); if (m.material && !m.material._shared && m.material.dispose) m.material.dispose(); }

  // ---- shared geometry (one allocation, reused by every bit/decal) ----
  const G_GIB = new THREE.BoxGeometry(1, 1, 1);       // legacy chunk (realism OFF) only — the stump
                                                      // is its own torn geometry now, see stumpGeo()
  // TORN FLESH, NOT DICE: three irregular chunk silhouettes baked ONCE at
  // startup and picked at random per piece, so no two chunks share an outline
  // and none of them has a flat square face to catch the light like a box.
  //
  // The jitter is a function of the vertex's DIRECTION, not its index. r128
  // builds every PolyhedronGeometry non-indexed — each triangle carries its own
  // copy of its three corners — so index-keyed jitter would tear the solid open
  // along every edge. Same direction in, same displacement out, seams closed by
  // construction. (blobGeo() below plays the identical trick in 2D on the
  // pools, for the identical reason.)
  function chunkGeo() {
    const g = new THREE.IcosahedronGeometry(0.5, 0);
    const pos = g.attributes.position;
    const p1 = Math.random() * 6.28, p2 = Math.random() * 6.28, p3 = Math.random() * 6.28;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const l = Math.hypot(x, y, z) || 1;
      const nx = x / l, ny = y / l, nz = z / l;
      const k = 1 + 0.30 * Math.sin(nx * 5.1 + p1) + 0.24 * Math.sin(ny * 6.3 + p2) + 0.19 * Math.sin(nz * 4.4 + p3);
      pos.setXYZ(i, nx * 0.5 * k, ny * 0.5 * k, nz * 0.5 * k);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }
  const G_CHUNK = [chunkGeo(), chunkGeo(), chunkGeo()];
  function chunk() { return G_CHUNK[(Math.random() * 3) | 0]; }

  // the WATER slick's outline (land marks use the atlas): a circle with
  // per-vertex radial jitter (sum of randomly-phased sines) baked ONCE at
  // startup. 3 shared geometries, randomly picked + spun + stretched per
  // decal, so no two pools share a silhouette and none is a perfect circle.
  function blobGeo() {
    const g = new THREE.CircleGeometry(1, 16);
    const pos = g.attributes.position;
    const p1 = Math.random() * 6.28, p2 = Math.random() * 6.28, p3 = Math.random() * 6.28;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      if (x * x + y * y < 0.25) continue;             // centre vertex stays put
      const a = Math.atan2(y, x);
      const k = 1 + 0.16 * Math.sin(a * 3 + p1) + 0.13 * Math.sin(a * 5 + p2) + 0.09 * Math.sin(a * 7 + p3);
      pos.setXY(i, x * k, y * k);
    }
    return g;
  }
  const G_BLOB = [blobGeo(), blobGeo(), blobGeo()];
  function blob() { return G_BLOB[(Math.random() * 3) | 0]; }

  // ---- shared materials (cloned only when a unique per-bit color is needed) --
  const matCache = new Map();
  function lambert(color) {
    let m = matCache.get(color);
    if (!m) { m = new THREE.MeshLambertMaterial({ color }); m._shared = true; matCache.set(color, m); }
    return m;
  }

  // GORE_GIB_MEAT — drag a body colour toward wound-dark, so a flying chunk
  // reads as flesh rather than as a piece of the shirt it came off. `k` is how
  // soaked it is. Channels are quantised to 16 before the hex is rebuilt: the
  // lambert() cache is keyed on the colour, and 99 survivors in 12 outfits would
  // otherwise mint a fresh shared material per outfit per soak level.
  // (written through CBZ.CONFIG rather than the `CFG` alias — that alias is
  // declared with the water block further down and is still in its temporal
  // dead zone up here. The alias binds the SAME object, so both agree.)
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.GORE_GIB_MEAT == null) CBZ.CONFIG.GORE_GIB_MEAT = true;
  function meatOn() { return CBZ.CONFIG.GORE_GIB_MEAT !== false; }
  function bloodied(hex, k) {
    const q = (a, b) => (Math.min(255, Math.round((a + (b - a) * k) / 16) * 16)) & 255;
    const r = q((hex >> 16) & 255, (BLOOD_D >> 16) & 255);
    const g = q((hex >> 8) & 255, (BLOOD_D >> 8) & 255);
    const b = q(hex & 255, BLOOD_D & 255);
    return (r << 16) | (g << 8) | b;
  }

  // a soft radial blood texture, generated once. The WATER slick and the air
  // mist use it; land decals have their own hard-edged atlas (landAtlas below).
  let bloodTex = null;
  function bloodTexture() {
    if (bloodTex) return bloodTex;
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.55, "rgba(255,255,255,0.95)");
    grd.addColorStop(0.82, "rgba(255,255,255,0.45)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd; g.beginPath(); g.arc(32, 32, 32, 0, 6.2832); g.fill();
    // a few irregular satellite blobs so a pool isn't a perfect circle
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * 6.28, r = 16 + Math.random() * 14;
      const bx = 32 + Math.cos(a) * r, by = 32 + Math.sin(a) * r, br = 3 + Math.random() * 6;
      const bg = g.createRadialGradient(bx, by, 0, bx, by, br);
      bg.addColorStop(0, "rgba(255,255,255,0.7)"); bg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = bg; g.beginPath(); g.arc(bx, by, br, 0, 6.2832); g.fill();
    }
    bloodTex = new THREE.CanvasTexture(c);
    bloodTex.wrapS = bloodTex.wrapT = THREE.ClampToEdgeWrapping;
    return bloodTex;
  }

  /* ============================================================
     BLOOD ON THE GROUND IS A STAIN IN THE FLOOR, NOT A STICKER ON IT.

     OWNER, on the prison fight, 2026-09-27: "blood in the jail game, gum".
     He was reading it exactly. Every pool, landing mark, smear and wall
     splat used to be its own MeshBasicMaterial disc: one flat colour, unlit,
     lifted 4-6 cm off the floor, feathered by a soft radial texture, drawn at
     opacity 0.88 (0.7 on walls). Pushed through core/renderer.js's ACES +
     saturation grade at the prison's exposure (~1.1-1.4) the "dark" decal hex
     0x300203 came out (134-189, 0, 17-24): a raspberry crimson with more blue
     than green, the SAME brightness in a dark cell as under a lamp. Its
     feathered rim then alpha-blended that over pale concrete: 45% coverage is
     (165-190, 105, 112-115), 20% is (180, 152, 155). A smooth round blob,
     glowing an even raspberry, with a bubble-gum pink halo, hovering over the
     floor, and ~25 identical 16-42 cm copies of it around every kill: gum.

     WHAT IT IS NOW. One InstancedMesh draws every land decal in the game
     (floor pools, droplet marks, impact splats, smears, wall splats, drips) in
     ONE draw call, off ONE baked atlas, with ONE shader. The decal does not
     paint a colour; it FILTERS the floor that is already drawn (a 2x multiply
     blend: screen = floor x factor). So:
       * the concrete's own texture, grime and lighting come through, a pool
         in a dark cell is dark and one under a lamp is lit;
       * the hue is set by the filter, not by the tone map, so it cannot be
         graded into raspberry: fresh blood keeps green and blue at a few % of
         red (hue 0-2 deg, pure red), dried blood lets a little more green
         than blue through (hue 5-8 deg, dark red-brown);
       * the 2x headroom is what lets fresh blood carry a GLINT: a thin wet
         highlight off the meniscus at the pool's edge, gone once it dries.
     Every shape is a noise-edged field in the atlas and the edge is a hard
     threshold on it, so there is no feathered rim to go pink. A pool GROWS
     by lowering that threshold (the edge advances into the lowest ground
     first, fingers and all), spreads for ~6-14 s and STOPS. Over tens of
     seconds it dries from the thin edge inward: deep glossy red -> matte dark
     red-brown with a darker coffee ring, soaked patchily into the pores.
     Spatter lands the size of the drop that made it, stretched along its
     flight by the impact angle (length = width / sin(angle), the forensic
     rule), tail pointing away from the wound. A kill throws one or two big
     impact splats, a pool, and a scatter of small marks, not two dozen equal
     discs. Everything sits 1.5 cm off the surface with polygonOffset.

     COST: one draw call, one 512x256 texture baked once at load, a fixed
     pool of instance slots (hard cap, recycled far-first), no per-decal
     material, no per-frame allocation. Growth and drying run on the GPU from
     one clock; the CPU writes a slot's matrix once at spawn and its alpha only
     when a fade actually changes it.

     The WATER blood (plume / slick / kill cloud) is untouched: slicks keep
     their own pooled meshes + bloodTexture(), and every water branch below
     runs exactly as before.
  ============================================================ */
  const LD_CAP = 400;                       // slots: 300 ground max + walls, with room
  const LD_CELL_W = 0.25, LD_CELL_H = 0.5;  // 4 x 2 atlas cells
  // atlas cells: [col,row] — row 0 is the TOP of the canvas (uv.y 1)
  const CELL_POOL = [[0, 0], [1, 0]], CELL_SPLAT = [[2, 0], [3, 0]];
  const CELL_DROP = [0, 1], CELL_DOT = [1, 1], CELL_DRIP = [2, 1], CELL_SMEAR = [3, 1];

  // ---- the atlas: R = arrival/thickness field, G = pore noise ---------------
  // R is 1 where the blood arrives first (the thick middle) falling to 0 where
  // it never reaches. The shader shows R > threshold, so dropping the
  // threshold over time IS the spread, and (R - threshold) IS the depth.
  function ldHash(ix, iy, s) {
    let h = (ix * 374761393 + iy * 668265263 + s * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function ldNoise(x, y, s) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = ldHash(ix, iy, s), b = ldHash(ix + 1, iy, s), c = ldHash(ix, iy + 1, s), d = ldHash(ix + 1, iy + 1, s);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }
  function ldFbm(x, y, s, oct) {
    let v = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { v += a * ldNoise(x * f, y * f, s + i * 31); n += a; f *= 2.07; a *= 0.5; }
    return v / n;
  }
  const clamp01 = (v) => (v < 0 ? 0 : (v > 1 ? 1 : v));
  // a filled dot whose field peaks at `top` in the middle
  function ldDot(u, v, cx, cy, r, top) {
    const d = Math.hypot(u - cx, v - cy);
    return d < r ? top * (1 - d / r) : 0;
  }
  // distance from p to segment a->b, and the parameter along it
  function ldSeg(u, v, ax, ay, bx, by, out) {
    const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey || 1;
    const t = clamp01(((u - ax) * ex + (v - ay) * ey) / l2);
    out.t = t; out.d = Math.hypot(u - (ax + ex * t), v - (ay + ey * t));
    return out;
  }
  function ldRand(seed) { let s = seed >>> 0; return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

  // POOL: a domain-warped radial field. The warp gives it fingers and bays
  // (liquid follows the floor), a handful of late satellites ring the edge.
  function fieldPool(seed) {
    const R = ldRand(seed), ph1 = R() * 6.28, ph2 = R() * 6.28, sats = [];
    for (let i = 0; i < 6; i++) {
      const a = R() * 6.28, r = 0.62 + R() * 0.24;
      sats.push([Math.cos(a) * r, Math.sin(a) * r, 0.025 + R() * 0.05]);
    }
    return function (u, v) {
      const wx = (ldFbm(u * 1.9 + 7.1, v * 1.9, seed, 3) - 0.5) * 0.5;
      const wy = (ldFbm(u * 1.9, v * 1.9 + 3.3, seed + 5, 3) - 0.5) * 0.5;
      const px = u + wx, py = v + wy, r = Math.hypot(px, py), th = Math.atan2(py, px);
      const edge = 0.6 + 0.07 * Math.sin(th * 2 + ph1) + 0.05 * Math.sin(th * 3 + ph2)
        + (ldFbm(Math.cos(th) * 2.2 + 11, Math.sin(th) * 2.2, seed + 9, 3) - 0.5) * 0.34;
      let f = Math.pow(clamp01(1 - r / edge), 0.8);
      for (let i = 0; i < sats.length; i++) f = Math.max(f, ldDot(u, v, sats[i][0], sats[i][1], sats[i][2], 0.16));
      return f;
    };
  }
  // SPLAT: an impact: a torn core, rays thrown out of it with a bead at the
  // tip, and fine satellite spatter. `dir` biases the rays toward +v (the way
  // the blood was travelling); without it they go all round (a wall hit).
  function fieldSplat(seed, dir) {
    const R = ldRand(seed), rays = [], sats = [], _s = { t: 0, d: 0 };
    const nr = 9 + ((R() * 6) | 0);
    for (let i = 0; i < nr; i++) {
      const a = dir ? Math.PI / 2 + (R() + R() + R() - 1.5) * 1.3 : R() * 6.28;
      const L = 0.34 + R() * (dir ? 0.5 : 0.4);
      rays.push([Math.cos(a) * L, Math.sin(a) * L, 0.028 + R() * 0.045, Math.cos(a) * (L + 0.06 + R() * 0.07), Math.sin(a) * (L + 0.06 + R() * 0.07)]);
    }
    for (let i = 0; i < 26; i++) {
      const a = dir ? Math.PI / 2 + (R() - 0.5) * 3.4 : R() * 6.28, r = 0.3 + R() * 0.6;
      sats.push([Math.cos(a) * r, Math.sin(a) * r, 0.01 + R() * R() * 0.035]);
    }
    return function (u, v) {
      const r = Math.hypot(u, v), th = Math.atan2(v, u);
      const rc = 0.24 + (ldFbm(Math.cos(th) * 3 + 5, Math.sin(th) * 3, seed, 3) - 0.5) * 0.16;
      let f = clamp01(1 - r / rc);
      for (let i = 0; i < rays.length; i++) {
        const q = ldSeg(u, v, 0, 0, rays[i][0], rays[i][1], _s);
        const w = rays[i][2] * (1 - q.t * 0.72);
        if (q.d < w) f = Math.max(f, (1 - q.d / w) * (0.62 - q.t * 0.36));
        f = Math.max(f, ldDot(u, v, rays[i][3], rays[i][4], rays[i][2] * 0.9, 0.3));
      }
      for (let i = 0; i < sats.length; i++) f = Math.max(f, ldDot(u, v, sats[i][0], sats[i][1], sats[i][2], 0.28));
      return f;
    };
  }
  // DROP: an oblique landing — a body, a tail narrowing toward +v (the flight
  // direction), a bead thrown off the tail's end, a couple of satellites.
  function fieldDrop(seed) {
    const R = ldRand(seed), bx = (R() - 0.5) * 0.12;
    return function (u, v) {
      const th = Math.atan2(v + 0.3, u);
      const e = Math.hypot(u / 0.3, (v + 0.3) / 0.33) * (1 + (ldFbm(Math.cos(th) * 3, Math.sin(th) * 3, seed, 2) - 0.5) * 0.25);
      let f = clamp01(1 - e);
      if (v > -0.3 && v < 0.58) {
        const k = (v + 0.3) / 0.88, w = 0.21 * Math.pow(1 - k, 1.25);
        if (Math.abs(u) < w) f = Math.max(f, (1 - Math.abs(u) / w) * (0.62 - k * 0.3));
      }
      f = Math.max(f, ldDot(u, v, bx, 0.72, 0.075, 0.45));
      f = Math.max(f, ldDot(u, v, 0.36, -0.38, 0.04, 0.4), ldDot(u, v, -0.33, -0.12, 0.03, 0.4));
      return f;
    };
  }
  // DOT: a drop that fell straight down — round with a scalloped crown edge.
  function fieldDot(seed) {
    const R = ldRand(seed), ph = R() * 6.28, sats = [];
    for (let i = 0; i < 5; i++) { const a = R() * 6.28, r = 0.62 + R() * 0.2; sats.push([Math.cos(a) * r, Math.sin(a) * r, 0.03 + R() * 0.04]); }
    return function (u, v) {
      const r = Math.hypot(u, v), th = Math.atan2(v, u);
      const edge = 0.46 * (1 + 0.09 * Math.sin(th * 11 + ph) + (ldFbm(Math.cos(th) * 3, Math.sin(th) * 3, seed, 2) - 0.5) * 0.3);
      let f = clamp01(1 - r / edge);
      for (let i = 0; i < sats.length; i++) f = Math.max(f, ldDot(u, v, sats[i][0], sats[i][1], sats[i][2], 0.4));
      return f;
    };
  }
  // DRIP: a run down a wall. Arrives top (+v) first, ends in a heavier bead.
  // The quad is thin, so the bead is authored squashed in v.
  function fieldDrip(seed) {
    return function (u, v) {
      if (v < -0.95 || v > 0.97) return 0;
      const xc = 0.1 * Math.sin(v * 2.6 + seed);
      const w = 0.42 + (ldFbm(0, v * 3.5, seed, 2) - 0.5) * 0.3;
      let m = 1 - Math.abs(u - xc) / w;
      const bead = 1 - Math.hypot((u - xc) / 0.7, (v + 0.82) / 0.1);
      m = Math.max(m, bead);
      if (m <= 0) return 0;
      const arr = 0.1 + 0.9 * (v + 1) / 2;
      return arr * Math.min(1, m * 3);
    };
  }
  // SMEAR: a drag. Arrives at the START (-v, under the body) first, tapers and
  // breaks into striations toward the end, the way a dragged pool thins out.
  function fieldSmear(seed) {
    return function (u, v) {
      if (v < -0.96 || v > 0.96) return 0;
      const k = (1 - v) / 2;                              // 1 at the start, 0 at the end
      const w = 0.3 + 0.55 * Math.pow(k, 0.6);
      const m = 1 - Math.abs(u + (ldFbm(v * 2, 0, seed, 2) - 0.5) * 0.2) / w;
      if (m <= 0) return 0;
      const stria = 0.45 + 0.55 * ldFbm(u * 8.5, v * 0.7, seed + 3, 3);
      return (0.1 + 0.9 * k) * Math.min(1, m * 2.6) * (k > 0.55 ? 1 : stria + (1 - stria) * (k / 0.55));
    };
  }

  let ldTex = null;
  function landAtlas() {
    if (ldTex) return ldTex;
    const W = 512, H = 256, C = 128;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d");
    const img = g.createImageData(W, H), px = img.data;
    const cells = [
      [CELL_POOL[0], fieldPool(11)], [CELL_POOL[1], fieldPool(29)],
      [CELL_SPLAT[0], fieldSplat(41, true)], [CELL_SPLAT[1], fieldSplat(57, false)],
      [CELL_DROP, fieldDrop(71)], [CELL_DOT, fieldDot(83)],
      [CELL_DRIP, fieldDrip(97)], [CELL_SMEAR, fieldSmear(101)],
    ];
    for (let k = 0; k < cells.length; k++) {
      const col = cells[k][0][0], row = cells[k][0][1], fn = cells[k][1];
      for (let y = 0; y < C; y++) {
        const v = 1 - (y + 0.5) / C * 2;                   // +1 at the cell's top
        for (let x = 0; x < C; x++) {
          const u = (x + 0.5) / C * 2 - 1;
          // hard zero on a 3-texel border so bilinear + mips never bleed cells
          const edge = Math.min(x, y, C - 1 - x, C - 1 - y) < 3 ? 0 : 1;
          const f = edge ? clamp01(fn(u, v)) : 0;
          const i = ((row * C + y) * W + col * C + x) * 4;
          px[i] = Math.round(f * 255);
          // pores: a fine, contrasty noise (world-scale grit, not a blob)
          px[i + 1] = Math.round(clamp01((ldFbm((col * C + x) * 0.11, (row * C + y) * 0.11, 3, 3) - 0.5) * 2.2 + 0.5) * 255);
          px[i + 2] = 0; px[i + 3] = 255;
        }
      }
    }
    g.putImageData(img, 0, 0);
    ldTex = new THREE.CanvasTexture(c);
    ldTex.wrapS = ldTex.wrapT = THREE.ClampToEdgeWrapping;
    return ldTex;
  }

  // ---- the filter colours, in SCREEN terms (multiplied onto the drawn floor) --
  // Tuned against a pale concrete floor at (190,188,182) on screen:
  //   fresh core (103,5,4)  fresh rim (144,22,18)   hue 0-2 deg — RED
  //   dried core (51,11,7)  dried ring (62,18,12)   hue 5-8 deg — dark red-brown
  // Partial coverage keeps green/blue falling faster than red (pow 0.3), so an
  // antialiased edge or a fading mark goes (167,53,49) salmon-red, never pink.
  const LD_VS = [
    "attribute vec4 aCell;",   // xy atlas offset, z unused, w 1 = wall
    "attribute vec4 aTime;",   // birth, grow seconds, dry seconds, revealed at birth
    "attribute vec4 aFx;",     // alpha, thickness, edge shrink, final threshold
    "uniform float uTime;",
    "varying vec2 vUv;",
    "varying vec4 vS;",        // threshold, dry, alpha, thickness
    "varying vec3 vN; varying vec3 vTx; varying vec3 vTy; varying vec3 vView;",
    "void main() {",
    "  vUv = aCell.xy + vec2(" + LD_CELL_W.toFixed(4) + ", " + LD_CELL_H.toFixed(4) + ") * uv;",
    "  float age = max(0.0, uTime - aTime.x);",
    "  float g = aTime.y > 0.0 ? clamp(age / aTime.y, 0.0, 1.0) : 1.0;",
    "  g = aTime.w + (1.0 - aTime.w) * (1.0 - pow(1.0 - g, 2.2));",   // gush, then a slow creep, then stop
    "  vS = vec4(mix(1.0, aFx.w, g) + aFx.z, clamp(age / aTime.z, 0.0, 1.0), aFx.x, aFx.y);",
    "  mat3 m3 = mat3(modelMatrix) * mat3(instanceMatrix);",
    "  vN = normalize(m3 * vec3(0.0, 0.0, 1.0));",
    "  vTx = normalize(m3 * vec3(1.0, 0.0, 0.0));",
    "  vTy = normalize(m3 * vec3(0.0, 1.0, 0.0));",
    "  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);",
    "  vView = cameraPosition - wp.xyz;",
    "  gl_Position = projectionMatrix * viewMatrix * wp;",
    "}",
  ].join("\n");
  const LD_FS = [
    "uniform sampler2D uMap;",
    "varying vec2 vUv; varying vec4 vS;",
    "varying vec3 vN; varying vec3 vTx; varying vec3 vTy; varying vec3 vView;",
    "void main() {",
    "  vec4 t = texture2D(uMap, vUv);",
    // every lookup before the discard/branches: implicit-lod reads want uniform flow
    "  float gx = texture2D(uMap, vUv + vec2(1.0 / 512.0, 0.0)).r - t.r;",
    "  float gy = texture2D(uMap, vUv + vec2(0.0, 1.0 / 256.0)).r - t.r;",
    "  float thr = vS.x;",
    "  float cov = smoothstep(thr, thr + 0.02, t.r);",
    "  float c = cov * vS.z;",
    "  float dist = length(vView);",
    "  c *= 1.0 - smoothstep(48.0, 72.0, dist);",
    "  if (c < 0.004) discard;",
    // how far inside the live edge this texel is: thin rim -> thick middle
    "  float depth = clamp((t.r - thr) / 0.32, 0.0, 1.0);",
    "  float body = clamp(depth * vS.w * (0.72 + 0.56 * t.g), 0.0, 1.0);",
    // thin blood dries first; the middle of a pool stays wet longest
    "  float dry = clamp(vS.y * (1.55 - depth * vS.w * 0.75), 0.0, 1.0);",
    "  dry = dry * dry * (3.0 - 2.0 * dry);",
    "  vec3 fresh = mix(vec3(0.76, 0.115, 0.100), vec3(0.54, 0.028, 0.022), body);",
    "  vec3 dried = mix(vec3(0.42, 0.125, 0.085), vec3(0.27, 0.058, 0.036), body);",
    "  vec3 F = mix(fresh, dried, dry);",
    // coffee ring: a dried edge is darker than just inside it
    "  F *= 1.0 - dry * (1.0 - clamp(depth / 0.25, 0.0, 1.0)) * 0.22;",
    // WET GLINT: the meniscus tilts the surface at the edge; a fixed overhead
    // key light catches it. Gone as it dries.
    "  float wet = (1.0 - dry) * (1.0 - dry);",
    "  if (wet > 0.02) {",
    "    vec3 V = normalize(vView);",
    "    vec3 N0 = dot(vN, V) < 0.0 ? -vN : vN;",
    "    float mb = (1.0 - depth) * (1.0 - depth) * 26.0 + 3.0;",
    "    vec3 N = normalize(N0 - (vTx * gx + vTy * gy) * mb);",
    "    vec3 L = normalize(vec3(0.3, 1.0, 0.22));",
    // a GLINT is crisp — on or off, a few texels wide. A soft half-strength
    // white over red is exactly pink, so there is no soft half-strength.
    "    float spec = smoothstep(0.35, 0.6, pow(max(dot(N, normalize(L + V)), 0.0), 40.0));",
    "    float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);",
    "    F = mix(F, vec3(1.25, 1.22, 1.2), clamp(wet * (spec * 0.8 + fres * 0.2), 0.0, 0.8));",
    "  }",
    "  vec3 k = vec3(1.0 + (F.r - 1.0) * c, vec2(1.0) + (F.gb - vec2(1.0)) * pow(c, 0.3));",
    // 2x multiply: blend is src*dst + dst*src, so 0.5 = leave the floor alone
    "  gl_FragColor = vec4(clamp(k * 0.5, 0.0, 1.0), 1.0);",
    "}",
  ].join("\n");

  let ldMesh = null, ldGeo = null, ldMat = null, ldCell = null, ldTime = null, ldFx = null;
  let ldClock = 0, ldMatDirty = false, ldFxDirty = false;
  const ldFree = [];                       // free slot indices
  const ldProxies = [];                    // pooled Object3D transforms (records' `m`)
  const _ldZero = new THREE.Matrix4().makeScale(0, 0, 0);
  function landLayer() {
    if (!ldMesh) {
      ldGeo = new THREE.PlaneGeometry(1, 1);
      ldCell = new THREE.InstancedBufferAttribute(new Float32Array(LD_CAP * 4), 4);
      ldTime = new THREE.InstancedBufferAttribute(new Float32Array(LD_CAP * 4), 4);
      ldFx = new THREE.InstancedBufferAttribute(new Float32Array(LD_CAP * 4), 4);
      ldCell.setUsage(THREE.DynamicDrawUsage); ldTime.setUsage(THREE.DynamicDrawUsage); ldFx.setUsage(THREE.DynamicDrawUsage);
      ldGeo.setAttribute("aCell", ldCell); ldGeo.setAttribute("aTime", ldTime); ldGeo.setAttribute("aFx", ldFx);
      ldMat = new THREE.ShaderMaterial({
        uniforms: { uMap: { value: landAtlas() }, uTime: { value: 0 } },
        vertexShader: LD_VS, fragmentShader: LD_FS,
        transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
        blendSrc: THREE.DstColorFactor, blendDst: THREE.SrcColorFactor,
        blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
        fog: false, lights: false,
      });
      ldMat._shared = true;
      ldMesh = new THREE.InstancedMesh(ldGeo, ldMat, LD_CAP);
      ldMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      ldMesh.frustumCulled = false;        // instances span the map; the unit quad's bounds say nothing
      ldMesh.raycast = function () {};     // a stain is never a surface: bullets, lenses, feet go through
      ldMesh.castShadow = ldMesh.receiveShadow = false;
      // under every other transparent layer (mist, glass, the sea), so what is
      // drawn over a stain is drawn over the stained floor
      ldMesh.renderOrder = -4;
      ldMesh.name = "gore-land-decals";
      for (let i = 0; i < LD_CAP; i++) { ldMesh.setMatrixAt(i, _ldZero); ldFree.push(LD_CAP - 1 - i); }
      ldMesh.instanceMatrix.needsUpdate = true;
    }
    const sc = scene();
    if (sc && ldMesh.parent !== sc) sc.add(ldMesh);
    return ldMesh;
  }
  // claim a slot + a transform proxy. null when the pool is full (the caller
  // recycles the oldest far mark and asks again).
  function ldAlloc() {
    landLayer();
    if (!ldFree.length) return null;
    const slot = ldFree.pop();
    const m = ldProxies.pop() || new THREE.Object3D();
    m.position.set(0, 0, 0); m.rotation.set(0, 0, 0); m.scale.set(1, 1, 1);
    return { slot, m };
  }
  // write a slot's shape + clocks once, at spawn
  function ldWrite(slot, m, cell, kind, growT, dryT, grow0, thick, thrEnd, alpha, delay) {
    m.updateMatrix();
    ldMesh.setMatrixAt(slot, m.matrix);
    const i = slot * 4;
    ldCell.array[i] = cell[0] * LD_CELL_W; ldCell.array[i + 1] = 1 - (cell[1] + 1) * LD_CELL_H;
    ldCell.array[i + 2] = 0; ldCell.array[i + 3] = kind;
    ldTime.array[i] = ldClock + (delay || 0); ldTime.array[i + 1] = growT; ldTime.array[i + 2] = Math.max(0.5, dryT); ldTime.array[i + 3] = grow0;
    ldFx.array[i] = alpha; ldFx.array[i + 1] = thick; ldFx.array[i + 2] = 0; ldFx.array[i + 3] = thrEnd;
    ldMatDirty = true; ldCell.needsUpdate = true; ldTime.needsUpdate = true; ldFxDirty = true;
  }
  // per-frame: only when a mark's fade/burial/wash actually moved it
  function ldSetFx(slot, alpha, shrink) {
    const i = slot * 4, a = ldFx.array;
    if (Math.abs(a[i] - alpha) > 0.004 || Math.abs(a[i + 2] - shrink) > 0.004) { a[i] = alpha; a[i + 2] = shrink; ldFxDirty = true; }
  }
  function ldRelease(rec) {
    if (!rec || rec.slot == null || rec.slot < 0) return;
    if (ldMesh) {
      ldMesh.setMatrixAt(rec.slot, _ldZero);
      ldFx.array[rec.slot * 4] = 0;
      ldMatDirty = true; ldFxDirty = true;
    }
    ldFree.push(rec.slot);
    if (rec.m && ldProxies.length < LD_CAP) ldProxies.push(rec.m);
    rec.slot = -1;
  }
  /* BLOOD RIDES WHAT IT HIT. (OWNER: "if i get shot in front of a door and
     then the door opens the blood floats like the door is closed ... it should
     stay on door duh".) A wall mark was stamped in WORLD space, so when the
     leaf it landed on swung open the stain stayed hanging in the empty
     doorway. Now every wall mark keeps the drawn mesh behind the collider it
     hit (c.ref: the leaf slab for a door, the wall box for a wall) and its own
     matrix in that mesh's space; when the mesh moves, the mark moves with it,
     and the GPU still draws it in the one instanced call. If the surface goes
     away instead (its collider pulled while the mesh never moved, the mesh
     hidden, or taken out of the scene) the mark goes with it: blood never
     hangs on nothing. */
  const _anM = new THREE.Matrix4();
  // 1 drawn + in a scene, 0 in a scene but hidden, -1 not in any scene
  function refShown(o) {
    let vis = true;
    for (; o; o = o.parent) { if (!o.visible) vis = false; if (o.isScene) return vis ? 1 : 0; }
    return -1;
  }
  function anchorTo(rec, col) {
    const ref = col && col.ref;
    if (!ref || !ref.isObject3D) return rec;
    const shown = refShown(ref);
    if (shown < 0) return rec;                        // a loose raycast proxy: nothing to ride
    ref.updateWorldMatrix(true, false);
    rec.ref = ref; rec.col = col; rec.shown = shown;
    rec.local = new THREE.Matrix4().copy(ref.matrixWorld).invert().multiply(rec.m.matrix);
    rec.last = ref.matrixWorld.elements.slice();
    rec.moved = false; rec.gone = false; rec.vis = 1; rec.chk = Math.random() * 0.5;
    return rec;
  }
  // per frame for an anchored mark: follow the surface; false = the surface
  // left the world, release the mark
  function rideAnchor(w, dt) {
    const ref = w.ref, e = ref.matrixWorld.elements, L = w.last;
    let k = 0;
    for (; k < 16; k++) if (Math.abs(e[k] - L[k]) > 1e-5) break;
    if (k < 16) {
      for (k = 0; k < 16; k++) L[k] = e[k];
      w.moved = true;
      _anM.multiplyMatrices(ref.matrixWorld, w.local);
      if (ldMesh && w.slot >= 0) { ldMesh.setMatrixAt(w.slot, _anM); ldMatDirty = true; }
      w.m.position.setFromMatrixPosition(_anM);
    }
    w.chk -= dt;
    if (w.chk <= 0) {
      w.chk = 0.5;
      const s = refShown(ref);
      if (s < 0) return false;
      // a door whose collider is pulled but whose leaf SWUNG still has the
      // blood on it; a collider pulled from under a mesh that never moved
      // (a leaf swapped out, a wall knocked down) leaves nothing to stain
      const pulled = !w.moved && CBZ.colliders && CBZ.colliders.indexOf(w.col) < 0;
      w.gone = (w.shown === 1 && s === 0) || pulled;
    }
    w.vis = w.gone ? Math.max(0, w.vis - dt * 4) : Math.min(1, w.vis + dt * 4);
    return true;
  }

  // end of the gore frame: push what changed (one upload each, at most)
  function ldFlush(dt) {
    ldClock += dt;
    if (!ldMesh) return;
    ldMat.uniforms.uTime.value = ldClock;
    if (ldMatDirty) { ldMesh.instanceMatrix.needsUpdate = true; ldMatDirty = false; }
    if (ldFxDirty) { ldFx.needsUpdate = true; ldFxDirty = false; }
  }

  function dist2Cam(x, z) {
    const cam = CBZ.camera && CBZ.camera.position;
    if (!cam) return 0;
    const dx = x - cam.x, dz = z - cam.z; return dx * dx + dz * dz;
  }

  // ============================================================
  //  THE WATER MEDIUM — blood does NOTHING underwater that it does in air.
  //
  //  Nothing outside this file changes to get it. gore()/gore.spray() ask
  //  goreMedium() where the wound is and branch themselves, and airDrop() /
  //  airMist() — which EVERY incidental emitter in this file funnels through
  //  (stump vents, arterial streams, blunt spit, both spray layers) —
  //  redirect blood/mist into a bloom puff while a wet event is in flight.
  //  So the whole file gains the medium, not just the shark that prompted it.
  //
  //  WHAT IT LOOKS LIKE — colour, size, motion, counts — is THE PLUME
  //  block below. Short version: dark translucent maroon that DIMS with depth
  //  (never changes hue: the owner banned brown/olive/green blood 2026-08-30),
  //  blooms small and opens up, diffuses as sqrt(age) to a hard ceiling, fades
  //  smoothly, trails a moving body as a ribbon, one instanced draw call.
  //
  //  FLAG: CBZ.CONFIG.GORE_WATER (default true). Off and every branch below is
  //  skipped, so gore is byte-identically the air system it has always been.
  // ============================================================
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.GORE_WATER == null) CFG.GORE_WATER = true;
  function waterOn() { return CBZ.CONFIG.GORE_WATER !== false; }

  const _wdir = { x: 0, y: 0, z: 0 };
  const _cur = { x: 0, z: 0 };

  // the LIVE surface height — the swell moves, so this is re-read, never cached
  // past a fraction of a second. Degrades to the mean sea plane, then to 0.
  function seaY(x, z) {
    if (CBZ.citySeaHeightAt) {
      // an undefined/NaN surface would land straight in a mesh position and
      // take out computeBoundingSphere downstream — coerce, never trust.
      try { const y = CBZ.citySeaHeightAt(x, z); if (typeof y === "number" && isFinite(y)) return y; } catch (e) {}
    }
    return CBZ.waterSeaY ? CBZ.waterSeaY() : (CBZ.SEA_Y != null ? CBZ.SEA_Y : 0);
  }
  // ---- THE ONE WATER QUERY --------------------------------------------------
  // Signed distance below the live surface, or DRY (a sentinel, not NaN) when
  // this column isn't open water at all. Everything medium-aware in the game
  // is a comparison against this one number, which is why it is exported
  // rather than re-derived: gore's medium test, the ragdoll's buoyancy and
  // predator/shark's fallback all read it, so there is exactly one place where
  // "how deep is this" is decided and exactly one place to fix when the water
  // system underneath changes shape.
  //
  // Guarded end to end AND coerced: the water field is another agent's file
  // and may be absent, mid-rebuild, or briefly returning undefined. An
  // undefined surface would make `surface - y` NaN, NaN lands in a mesh
  // position, and every downstream computeBoundingSphere throws — so a bad
  // read degrades to DRY (the air/land path), never to a poisoned number.
  const DRY = -1e9;
  function submRaw(x, y, z) {
    if (!CBZ.citySeaHeightAt) return DRY;
    try {
      if (CBZ.cityWaterAt) { if (!CBZ.cityWaterAt(x, z)) return DRY; }
      else if (CBZ.waterField && CBZ.waterField.isSurfaceWater) { if (!CBZ.waterField.isSurfaceWater(x, z, 0)) return DRY; }
      else return DRY;
      const s = CBZ.citySeaHeightAt(x, z);
      if (typeof s !== "number" || !isFinite(s)) return DRY;
      const d = s - y;
      return isFinite(d) ? d : DRY;
    } catch (e) { return DRY; }
  }
  // public: metres this point sits BELOW the live water surface. 0 in air, 0
  // on land, 0 when the water system is absent. Never NaN, never null,
  // allocation-free.
  //
  // !! NAME COLLISION, FLAGGED FOR THE OWNER: world/water_float.js exports
  // CBZ.waterSubmergenceAt(x, y, z, span) -> a 0..1 FRACTION of a body's span
  // that is under, measured from the body's BASE. This is a different question
  // with a different unit and a nearly identical name, and someone will
  // eventually call the wrong one. These two should be reconciled into one
  // file (metres is the primitive; the 0..1 fraction is metres/span clamped),
  // but water_float.js is not this agent's to edit — so this is recorded here
  // rather than silently duplicated.
  CBZ.waterSubmergence = function (x, y, z) {
    const d = submRaw(x, y, z);
    return d > 0 ? d : 0;
  };
  // a wound counts as wet a little ABOVE the waterline too — a swimmer shot in
  // the shoulder is bleeding into the sea, not into the air over it.
  function inWater(x, y, z) { return submRaw(x, y, z) >= -0.4; }
  // A KILL's medium is not quite a POINT's medium. Every kill site hands gore()
  // a CHEST-HIGH coordinate (peds.js passes pos.y + 1.0), so a swimmer shot at
  // the surface tests a metre of clear air above the swell, reads "air", and
  // rains droplets into the sea — the exact bug this block exists to kill. So
  // a wound is also wet when it sits within a body-height of the surface over
  // water deep enough to be IN rather than to stand in. A knee-deep wader at
  // the shoreline still bleeds onto the beach, which is correct.
  const SWIMMABLE = 1.2;
  function woundInWater(x, y, z) {
    const d = submRaw(x, y, z);
    if (d === DRY) return false;
    if (d >= -0.4) return true;
    if (d < -1.6 || !CBZ.cityWaterDepthAt) return false;
    try { return CBZ.cityWaterDepthAt(x, z) >= SWIMMABLE; } catch (e) { return false; }
  }
  // ---- AEROSOL IS A DRY-AIR EFFECT -----------------------------------------
  // Blood atomised over the SEA does not hang. It is centimetres-to-metres from
  // a surface that takes every droplet, and it LANDS. The "mist" bit in this
  // file is pure air physics — a camera-facing quad born with an UPWARD vy,
  // expanding 3.2x over a 0.45-0.9 s life, and its per-frame updater has no
  // water term in it anywhere. Its only guard was the module `wetEvent` flag,
  // which is armed inside CBZ.gore() and NOWHERE ELSE. So every other emitter
  // in the game hung pink aerosol in the air over open water:
  //   • CBZ.goreImpact(opts.mist) — city/creature_combat.js's biteBlood() fires
  //     it at jawWorld(attacker) on EVERY shark lunge (BITE_SEV.lunge = 1.0, so
  //     `mist` is always true), and a surface-feeding shark's jaw is ABOVE the
  //     swell, so woundInWater() answers "air" and the dry branch runs. This is
  //     the one the owner is looking at.
  //   • CBZ.gore.spray() and CBZ.gore()'s LAYER 2, whenever their wet gate fails
  //     in the shore shallows (cityWaterDepthAt < SWIMMABLE) where the beach
  //     crowd is actually eaten.
  //   • neckStumpSpurt()'s aerosol cap over the open neck.
  // (owner, watching a shark feed: "the blood clouds in water are great but they
  // float like a mist over the water — blood is never a mist lol")
  //
  // One predicate, enforced at the single choke point all of those already go
  // through (airMist, in THE AIRBORNE BLOOD), so there is no ninth copy of a
  // water check. Ballistic DROPLETS are deliberately NOT banned: they are the
  // half of a breaching bite that is real, and they go INTO the water where
  // they land — see the sea-surface test in updateAir.
  const MIST_AIRGAP = 3.5;      // more clear air than this above the swell = sky, not sea
  // ONE-CELL, ONE-FRAME MEMO. A burst is 5-18 mist bits inside a 35 cm box all
  // fired on the same frame, and "is this column open water" is a property of
  // the COLUMN — asking per bit is 18 walks of isSurfaceWater (overDeck + the
  // shore field) for one fact. Round to a metre and keep the last answer, so a
  // burst pays one query and a burst somewhere else just replaces it. Reset with
  // the other one-frame caches in the updater: the swell and the flood move.
  let _msX = 1e9, _msY = 0, _msZ = 0, _msV = false;
  function mistOverSea(x, y, z) {
    const qx = Math.round(x), qy = Math.round(y), qz = Math.round(z);
    if (qx === _msX && qy === _msY && qz === _msZ) return _msV;
    _msX = qx; _msY = qy; _msZ = qz;
    // submRaw is `surface - y`: positive under water, negative above it, and the
    // DRY sentinel (-1e9) on land or with no water system, which this test
    // rejects by magnitude alone. Allocation-free, one guarded query.
    return (_msV = submRaw(x, y, z) > -MIST_AIRGAP);
  }
  // public: anything can ask which medium a point is in. Deliberately NOT
  // gated on GORE_WATER — it answers honestly; the branch sites read the flag.
  CBZ.goreMedium = function (x, y, z) {
    if (CBZ.predatorMedium) {
      try { return CBZ.predatorMedium(x, y, z) === "water" ? "water" : "air"; } catch (e) {}
    }
    return inWater(x, y, z) ? "water" : "air";
  };

  /* ============================================================
     THE PLUME — blood in seawater, as it looks in real attack footage.
     ------------------------------------------------------------
     Owner, 2026-09-27, on the shipped Shark Sim: "the blood clouds are dumb
     ... really blood is the issue." What he was looking at, measured off the
     code this replaced:
       • COLOUR: 0xb01218 through this renderer's chain (hex read as linear,
         x1.16/0.6 exposure, ACES, sRGB) lands on screen as #EA5C64 — a
         bright candy PINK at 50% alpha. Cartoon blood.
       • SIZE: every puff grew EXPONENTIALLY (sc *= 1 + grow*dt, every frame),
         and the lid added another 35%/s on top. A 1 m haze puff ended its
         6 s life at ~11 m; a kill-cloud shell puff (0.9-2 m, 7-13 s) ended it
         at 50-160 m. A kill was a wall of pink the size of a stadium, and the
         chase camera sat inside it.
       • COUNT: one landed kill fired goreKillCloud (~33 bloom puffs + 16 shell)
         from wildlife_tame AND again from wounds.js's death scan (nobody set
         the once-flag), plus gore()'s two wet blooms, plus every spawnBit
         droplet reborn as a puff, plus a chum handle blooming ~10 puffs every
         0.35 s. Hundreds of sprites, one draw call EACH.
       • ALPHA: stepped 0.5 -> 0.3 -> 0.12 -> gone. Popped in at full strength,
         popped out at the end, never actually faded.

     What real blood in the sea does, and what this now does:
       • it is DARK and translucent — a murky maroon, never a saturated red.
         Fresh 0x220505 renders #6A161B; it DIMS (never shifts hue — the owner
         banned brown/olive/green blood on 2026-08-30, and absorption only ever
         takes light away) toward 0x0a0202 (#280708, near black) a few metres
         down, where red light is gone.
       • it BLOOMS from the wound: born small and transparent, it opens up and
         fades in over a quarter second instead of arriving at full size.
       • it DIFFUSES: radius goes as sqrt(age) to a hard ceiling (a bite wisp
         tops out near a metre, a kill plume at ~4 m), while its alpha thins
         and fades smoothly to zero. Nothing pops.
       • it TRAILS: a bleeding body lays one small puff every ~0.18 s where it
         IS, so a swimming wound leaves a ribbon behind it that drifts with the
         current and dissolves — not a pulse of clouds every third of a second.
       • at the surface it is a thin dark STAIN (goreSlick), not a cloud.
       • it gets out of the lens: a plume fades out as the camera enters it,
         so a kill in front of a chase camera never becomes a red screen.

     COST: ONE instanced draw call for every puff in the world (was one sprite
     draw per puff), fixed-size typed arrays allocated once, a hard cap that
     recycles the most-spent puff instead of refusing the fresh one. Fog-correct
     (the underwater column fogs it like everything else).
     ============================================================ */
  /* COLOUR IS AUTHORED AS THE PIXEL, NOT AS A LIGHT VALUE. The in-game
     chain is not plain ACES: core/renderer.js runs a CustomToneMapping with a
     lift/gamma/gain grade and a SATURATION BOOST, times a live day/night
     exposure from core/gfx.js. That chain took the first cut of this block's
     0x220505 (#6A161B through plain ACES) to a saturated #B01020 in the real
     Shark Sim frame — the exact "bright red smear" the owner hates. So the
     plume and the slicks are toneMapped:false and their colours are the
     sRGB hexes that land on screen (converted to linear once, because the
     output encoding still applies). Fog then mixes toward the scene's own
     already-graded fog colour, so distance and the water column still eat it. */
  const PLUME_FRESH = 0x7a0c0e, PLUME_DEEP = 0x2a0608;   // display sRGB
  const SLICK_COL = 0x5a0a0c;                             // display sRGB
  function displayColor(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }
  const PLUME_DARK_DEPTH = 6.5;         // metres under the swell to reach PLUME_DEEP
  const PUFF_VIS = 0.4, LID_GAP = 0.18; // drawn rim as a fraction of the quad; lid clearance
  const PUFF_MAX = 256;                 // hard allocation; the live cap is puffCap()
  function puffCap() { return CBZ.qScale ? CBZ.qScale(70, 160) : 110; }

  // a soft, lumpy, gaussian-ish blot — NOT bloodTexture(), whose core is 95%
  // solid out to half its radius: that is a disc, and a disc reads as a ball.
  let murkTex = null;
  function murkTexture() {
    if (murkTex) return murkTex;
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d");
    const lump = function (x, y, r, a) {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(255,255,255," + a + ")");
      gr.addColorStop(0.45, "rgba(255,255,255," + (a * 0.5) + ")");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
    };
    lump(32, 32, 26, 0.85);
    for (let i = 0; i < 9; i++) {
      const a = i * 2.39996, r = 6 + (i % 3) * 5;
      lump(32 + Math.cos(a) * r, 32 + Math.sin(a) * r, 9 + (i % 4) * 3, 0.22 + (i % 2) * 0.12);
    }
    murkTex = new THREE.CanvasTexture(c);
    murkTex.wrapS = murkTex.wrapT = THREE.ClampToEdgeWrapping;
    return murkTex;
  }

  // ---- state: parallel typed arrays, swap-remove, never reallocated ----------
  const P_X = new Float32Array(PUFF_MAX), P_Y = new Float32Array(PUFF_MAX), P_Z = new Float32Array(PUFF_MAX);
  const P_VX = new Float32Array(PUFF_MAX), P_VY = new Float32Array(PUFF_MAX), P_VZ = new Float32Array(PUFF_MAX);
  const P_T = new Float32Array(PUFF_MAX), P_LIFE = new Float32Array(PUFF_MAX), P_IN = new Float32Array(PUFF_MAX);
  const P_S0 = new Float32Array(PUFF_MAX), P_S1 = new Float32Array(PUFF_MAX), P_A = new Float32Array(PUFF_MAX);
  const P_DRAG = new Float32Array(PUFF_MAX), P_RISE = new Float32Array(PUFF_MAX);
  const P_PH = new Float32Array(PUFF_MAX), P_PH2 = new Float32Array(PUFF_MAX), P_FQ = new Float32Array(PUFF_MAX), P_WOB = new Float32Array(PUFF_MAX);
  const P_ROT = new Float32Array(PUFF_MAX), P_SPIN = new Float32Array(PUFF_MAX);
  const P_CX = new Float32Array(PUFF_MAX), P_CZ = new Float32Array(PUFF_MAX), P_CT = new Float32Array(PUFF_MAX);
  const P_SY = new Float32Array(PUFF_MAX), P_SURF = new Uint8Array(PUFF_MAX);
  const puffs = { length: 0 };          // goreAudit / clearGore read .length
  const PUFF_FIELDS = [P_X, P_Y, P_Z, P_VX, P_VY, P_VZ, P_T, P_LIFE, P_IN, P_S0, P_S1, P_A, P_DRAG, P_RISE,
    P_PH, P_PH2, P_FQ, P_WOB, P_ROT, P_SPIN, P_CX, P_CZ, P_CT, P_SY, P_SURF];

  // ---- the one draw call ------------------------------------------------------
  let plumeMesh = null, plumeGeo = null, aPos = null, aMisc = null;
  function plumeReady() {
    const sc = scene();
    if (!sc) return false;
    if (!plumeMesh) {
      const quad = new THREE.PlaneGeometry(1, 1);
      plumeGeo = new THREE.InstancedBufferGeometry();
      plumeGeo.setIndex(quad.index);
      plumeGeo.setAttribute("position", quad.attributes.position);
      plumeGeo.setAttribute("uv", quad.attributes.uv);
      aPos = new THREE.InstancedBufferAttribute(new Float32Array(PUFF_MAX * 4), 4);
      aMisc = new THREE.InstancedBufferAttribute(new Float32Array(PUFF_MAX * 4), 4);
      aPos.setUsage(THREE.DynamicDrawUsage); aMisc.setUsage(THREE.DynamicDrawUsage);
      plumeGeo.setAttribute("iPos", aPos);
      plumeGeo.setAttribute("iMisc", aMisc);
      plumeGeo.instanceCount = 0;
      const mat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
          map: { value: null },
          cFresh: { value: displayColor(PLUME_FRESH) },
          cDeep: { value: displayColor(PLUME_DEEP) },
          uAbove: { value: 0 },
          uSeaY: { value: 0 },
        }]),
        vertexShader: [
          "attribute vec4 iPos;",   // xyz centre, w = quad size (m)
          "attribute vec4 iMisc;",  // x alpha, y darkness 0..1, z rotation
          "uniform float uAbove; uniform float uSeaY;",
          "varying vec2 vUv; varying float vA; varying float vDark;",
          "#include <fog_pars_vertex>",
          "void main() {",
          "  vUv = uv;",
          "  vec4 mvPosition = modelViewMatrix * vec4(iPos.xyz, 1.0);",
          "  float vz = -mvPosition.z;",
          "  float w = iPos.w, veil = 1.0;",
          /* SEEN FROM ABOVE THE SEA. The sea writes depth at the surface and
             veils what is under it by the column to the SEABED (it reads the
             opaque depth, and a transparent plume has none), so a plume under
             it drew either nothing or a ghost. From above, the puff is slid
             along its own view ray up to where that ray meets the surface and
             shrunk by the same factor: identical on screen, but now in front
             of the sea's depth. Its own depth becomes the veil instead. */
          "  if (uAbove > 0.5 && iPos.y < uSeaY) {",
          "    float k = clamp(0.97 * (cameraPosition.y - uSeaY) / max(0.001, cameraPosition.y - iPos.y), 0.02, 1.0);",
          "    mvPosition.xyz *= k; w *= k;",
          "    veil = exp(-(uSeaY - iPos.y) * 0.3);",
          "  }",
          "  float c = cos(iMisc.z), s = sin(iMisc.z);",
          "  vec2 q = position.xy * w;",
          "  mvPosition.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y);",
          // THE LENS IS NOT INSIDE THE CLOUD: fade as the camera enters it.
          "  vA = iMisc.x * veil * smoothstep(0.35 * iPos.w, 0.9 * iPos.w + 1.2, vz);",
          "  vDark = iMisc.y;",
          "  gl_Position = projectionMatrix * mvPosition;",
          "  #ifdef USE_FOG",
          "  fogDepth = vz;",
          "  #endif",
          "}",
        ].join("\n"),
        fragmentShader: [
          "uniform sampler2D map; uniform vec3 cFresh; uniform vec3 cDeep;",
          "varying vec2 vUv; varying float vA; varying float vDark;",
          "#include <fog_pars_fragment>",
          "void main() {",
          "  float a = texture2D(map, vUv).a * vA;",
          "  if (a < 0.004) discard;",
          "  gl_FragColor = vec4(mix(cFresh, cDeep, vDark), a);",
          "  #include <encodings_fragment>",
          "  #include <fog_fragment>",
          "}",
        ].join("\n"),
        transparent: true, depthWrite: false, fog: true, toneMapped: false,
      });
      mat.uniforms.map.value = murkTexture();
      mat._shared = true;
      plumeMesh = new THREE.Mesh(plumeGeo, mat);
      plumeMesh.frustumCulled = false;   // instances span the sea; the quad's own bounds are meaningless
      plumeMesh.renderOrder = 5;
      plumeMesh.name = "gore.plume";
    }
    if (plumeMesh.parent !== sc) sc.add(plumeMesh);
    return true;
  }

  function copyPuff(d, s) { for (let k = 0; k < PUFF_FIELDS.length; k++) PUFF_FIELDS[k][d] = PUFF_FIELDS[k][s]; }
  function killPuff(i) { const last = --puffs.length; if (i !== last) copyPuff(i, last); }

  /* puff(x,y,z, vx,vy,vz, s0, s1, life, alpha, fadeIn)
     s0 -> s1 is the quad size in metres from birth to death (sqrt(age) growth).
     Full: the most-SPENT live puff is recycled, never the fresh one refused —
     the newest blood is the blood the player is looking at. */
  function puff(x, y, z, vx, vy, vz, s0, s1, life, alpha, fadeIn) {
    if (!plumeReady()) return -1;
    PLUME_AUDIT.puffs++;
    let i = puffs.length;
    const cap = Math.min(PUFF_MAX, puffCap());
    if (i >= cap) {
      let best = 0, bf = -1;
      for (let k = 0; k < puffs.length; k++) { const f = P_T[k] / P_LIFE[k]; if (f > bf) { bf = f; best = k; } }
      i = best;
    } else puffs.length++;
    // CLAMP AT SPAWN against this puff's own column, measured on its FINAL rim:
    // a plume born half out of the water is the "mist over the sea" read.
    const surf = seaY(x, z);
    const lid = surf - LID_GAP - s0 * PUFF_VIS;
    if (y > lid) y = lid;
    P_X[i] = x; P_Y[i] = y; P_Z[i] = z;
    P_VX[i] = vx; P_VY[i] = vy; P_VZ[i] = vz;
    P_T[i] = 0; P_LIFE[i] = life; P_IN[i] = fadeIn || 0.25;
    P_S0[i] = s0; P_S1[i] = Math.max(s0, s1); P_A[i] = alpha;
    P_DRAG[i] = 0.12 + Math.random() * 0.1;          // water kills momentum in a second
    P_RISE[i] = 0.03 + Math.random() * 0.07;          // blood is barely buoyant: a slow drift up
    P_PH[i] = Math.random() * 6.28; P_PH2[i] = Math.random() * 6.28;
    P_FQ[i] = 0.5 + Math.random() * 0.7; P_WOB[i] = 0.05 + Math.random() * 0.07;
    P_ROT[i] = Math.random() * 6.28; P_SPIN[i] = (Math.random() - 0.5) * 0.35;
    P_CX[i] = 0; P_CZ[i] = 0; P_CT[i] = 0; P_SY[i] = surf; P_SURF[i] = 0;
    return i;
  }

  // a ballistic droplet reborn in the sea: water kills a drop's momentum in
  // centimetres. Most drops just join the cloud they came from — only about a
  // third leave a wisp of their own, or a burst of forty drops is forty clouds.
  function puffFromBit(x, y, z, vx, vy, vz, size, mist) {
    if (Math.random() > (mist ? 0.15 : 0.3)) return;
    puff(x, y, z, vx * 0.08, 0, vz * 0.08, 0.1, 0.35 + size * 2, 1.8 + Math.random() * 1.2, 0.4, 0.2);
  }

  function updatePuffs(dt) {
    const n0 = puffs.length;
    for (let i = n0 - 1; i >= 0; i--) {
      const t = (P_T[i] += dt);
      if (t >= P_LIFE[i]) { killPuff(i); continue; }
      const dg = Math.pow(P_DRAG[i], dt);
      P_VX[i] *= dg; P_VZ[i] *= dg;
      P_VY[i] = P_RISE[i] + (P_VY[i] - P_RISE[i]) * dg;
      const f = t / P_LIFE[i];
      const sc = P_S0[i] + (P_S1[i] - P_S0[i]) * Math.sqrt(f);
      // the surface and current are broad slow fields: staggered re-sample,
      // except a puff near the lid, which tracks the moving swell every frame.
      const nearSurf = P_SURF[i] === 1 || P_Y[i] + sc * PUFF_VIS > P_SY[i] - 1.5;
      if (nearSurf) P_SY[i] = seaY(P_X[i], P_Z[i]);
      P_CT[i] -= dt;
      if (P_CT[i] <= 0) {
        P_CT[i] = 0.45 + Math.random() * 0.3;
        if (!nearSurf) P_SY[i] = seaY(P_X[i], P_Z[i]);
        if (CBZ.waterField && CBZ.waterField.currentAt) {
          try {
            const c = CBZ.waterField.currentAt(P_X[i], P_Z[i], undefined, _cur);
            P_CX[i] = isFinite(c.x) ? c.x * 0.6 : 0; P_CZ[i] = isFinite(c.z) ? c.z * 0.6 : 0;
          } catch (e) { P_CX[i] = P_CZ[i] = 0; }
        }
      }
      P_PH[i] += dt * P_FQ[i];
      const ph = P_PH[i], wob = P_WOB[i];
      P_X[i] += (P_VX[i] + P_CX[i] + Math.sin(ph) * wob) * dt;
      P_Z[i] += (P_VZ[i] + P_CZ[i] + Math.cos(ph * 0.83 + P_PH2[i]) * wob) * dt;
      P_Y[i] += (P_VY[i] + Math.sin(ph * 0.61 + P_PH2[i]) * wob * 0.4) * dt;
      P_ROT[i] += P_SPIN[i] * dt;
      // THE SURFACE IS A LID: blood arriving there stops being a volume and
      // becomes a film. The puff is held under the swell and thins out fast;
      // the throttled goreSlick decal is what you see from above.
      const lid = P_SY[i] - LID_GAP - sc * PUFF_VIS;
      if (P_Y[i] > lid) {
        P_Y[i] = lid;
        if (P_VY[i] > 0) P_VY[i] = 0;
        if (!P_SURF[i]) {
          P_SURF[i] = 1;
          surfaceSlick(P_X[i], P_Z[i], 0.35);
          if (P_LIFE[i] - t > 1.5) P_LIFE[i] = t + 1.5;
        }
      }
    }
    // ---- write the instance buffers (live count only) ----
    const n = puffs.length;
    if (!plumeGeo) return;
    plumeGeo.instanceCount = n;
    if (!n) return;
    const ap = aPos.array, am = aMisc.array;
    const cp = CBZ.camera && CBZ.camera.position;
    const camSea = cp ? seaY(cp.x, cp.z) : 0;
    const camAtLine = !!cp && Math.abs(cp.y - camSea) < 1.5;
    /* WHICH SIDE OF THE SEA IS THE LENS ON. The sea writes depth and draws in
       the transparent pass (renderOrder -1/0). Drawn AFTER it (the old 5),
       a plume seen from above was depth-rejected by the surface; drawn
       before it, the sea veiled it by the whole column to the seabed. So it
       draws after the sea and, from above, the vertex shader lifts each puff
       along its view ray onto the surface (see uAbove in the shader). */
    plumeMesh.renderOrder = 5;
    const U = plumeMesh.material.uniforms;
    U.uAbove.value = (cp && cp.y > camSea + 0.05) ? 1 : 0;
    U.uSeaY.value = camSea;
    for (let i = 0; i < n; i++) {
      const t = P_T[i], f = t / P_LIFE[i];
      const sc = P_S0[i] + (P_S1[i] - P_S0[i]) * Math.sqrt(f);
      // fade in over the bloom, then thin as it spreads: (1-f)^1.6 is the
      // mass conserved over a growing area, near enough, and it reaches 0.
      const fin = t < P_IN[i] ? t / P_IN[i] : 1;
      // holds its body through mid-life, then thins to nothing
      let alpha = P_A[i] * fin * (1 - f * Math.sqrt(f));
      const depth = P_SY[i] - P_Y[i];
      /* NO BAND AT THE WATERLINE. Puffs held under the lid all sit at the
         same height, and from a camera at the surface a row of them reads as
         one long flat smear along the waterline. Blood that has reached the
         top is the slick's job: a puff fades out as its rim nears the lid,
         and fades harder when the lens itself is at the waterline, looking
         along that row edge-on. */
      const rimGap = depth - sc * PUFF_VIS - LID_GAP;          // 0 when pinned
      let sf = rimGap / 1.2; sf = sf < 0 ? 0 : (sf > 1 ? 1 : sf);
      alpha *= camAtLine && !(cp.y > camSea) ? 0.45 + 0.55 * sf : 0.7 + 0.3 * sf;
      let dark = depth > 0 ? depth / PLUME_DARK_DEPTH : 0;
      dark = dark * 0.85 + f * 0.2; if (dark > 1) dark = 1;
      const o = i * 4;
      ap[o] = P_X[i]; ap[o + 1] = P_Y[i]; ap[o + 2] = P_Z[i]; ap[o + 3] = sc;
      am[o] = alpha; am[o + 1] = dark; am[o + 2] = P_ROT[i]; am[o + 3] = 0;
    }
    aPos.needsUpdate = true; aMisc.needsUpdate = true;
  }

  // ONE BITE, ONE CLOUD. Several producers answer the same bite (wounds.js's
  // chunk burst, goreImpact, the fallback in marine_predation...) inside the
  // same few frames. A second bloom on the same spot is the "red wall" — it
  // is cut to a third instead of stacking.
  let lastBloomX = 1e9, lastBloomY = 0, lastBloomZ = 0, lastBloomT = -1;
  let plumeClock = 0, lastBiteSlickT = -9;
  const PLUME_AUDIT = { puffs: 0, blooms: 0, kills: 0, chumPuffs: 0 };   // lifetime emit counts (goreAudit)

  // public: an UNDERWATER blood bloom at a wound. `amount` 0.3..3: ~0.5 is a
  // nick, 1 a real bite, 2+ a torn artery. A burst of small puffs thrown out
  // along `dir` that opens into one murky cloud, plus a faint haze behind it.
  CBZ.goreBloom = function (x, y, z, opts) {
    if (!waterOn() || !CBZ.scene) return;
    opts = opts || {};
    const d2 = dist2Cam(x, z);
    if (CBZ.camera && CBZ.camera.position && d2 > 80 * 80) return;
    const lod = d2 > 40 * 40 ? 0.5 : 1;
    let amt = Math.max(0.3, Math.min(3, opts.amount == null ? 1 : opts.amount));
    {
      const ex = x - lastBloomX, ey = y - lastBloomY, ez = z - lastBloomZ;
      if (plumeClock - lastBloomT < 0.3 && ex * ex + ey * ey + ez * ez < 2.5 * 2.5) amt *= 0.35;
      else { lastBloomX = x; lastBloomY = y; lastBloomZ = z; lastBloomT = plumeClock; }
    }
    const art = !!opts.arterial;
    PLUME_AUDIT.blooms++;
    let dx = 0, dy = 0, dz = 0;
    if (opts.dir) {
      dx = +opts.dir.x || 0; dy = +opts.dir.y || 0; dz = +opts.dir.z || 0;
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (l > 0.001) { dx /= l; dy /= l; dz /= l; } else { dx = dy = dz = 0; }
    }
    const big = Math.min(1.6, 0.55 + amt * 0.4);
    // the burst: small, pushed out of the wound, opens into the cloud body
    const nb = Math.max(1, Math.round((2 + amt * 1.6 + (art ? 1 : 0)) * lod));
    for (let i = 0; i < nb; i++) {
      const a = Math.random() * 6.28, r = Math.random() * 0.12 * big;
      const sp = (art ? 0.9 : 0.5) + Math.random() * 0.6;
      puff(x + Math.cos(a) * r, y + (Math.random() - 0.5) * 0.15, z + Math.sin(a) * r,
        dx * sp + Math.cos(a) * sp * 0.35, dy * sp * 0.5, dz * sp + Math.sin(a) * sp * 0.35,
        0.1 + Math.random() * 0.08, (0.55 + Math.random() * 0.45) * big,
        2.2 + Math.random() * 1.3, art ? 0.62 : 0.55, 0.22);
    }
    /* FROM ABOVE, THE STAIN IS THE BLOOD. The sea is translucent only a few
       metres around the lens and veils everything under it, so a plume half
       a metre down is nearly invisible from a camera riding the waterline —
       which is where the chase camera lives. Real footage shows the same
       thing: what you see from the surface is the dark patch ON it. So a
       wound near the top stains the water directly (its own budget, not the
       0.3 s arrival throttle, which a bite would lose to the trail). */
    if (seaY(x, z) - y < 2 && plumeClock - lastBiteSlickT > 0.4) {
      lastBiteSlickT = plumeClock;
      CBZ.goreSlick(x, z, Math.min(1.4, 0.35 + amt * 0.35));
    }
    // the haze: one or two faint, wide, slow puffs that are what is left
    const nh = Math.max(1, Math.round((0.6 + amt * 0.7) * lod));
    for (let i = 0; i < nh; i++) {
      const a = Math.random() * 6.28, r = Math.random() * 0.3 * big;
      puff(x + Math.cos(a) * r, y + (Math.random() - 0.4) * 0.3, z + Math.sin(a) * r,
        dx * 0.25 + Math.cos(a) * 0.12, 0, dz * 0.25 + Math.sin(a) * 0.12,
        0.3, (1.2 + Math.random() * 0.8) * big, 4 + Math.random() * 2, 0.3, 0.6);
    }
  };

  // public: a blood slick ON the water surface — what you see from a boat or
  // from the shore. Reuses the existing splats[] records, blob geometries and
  // bloodTexture; the `water:true` flag makes the shared updater re-read the
  // LIVE surface height each frame (the surface moves) and drift with the
  // current, instead of sitting on a fixed floorAt seat.
  // A SLICK IS NOT A POOL, and it is not free. updateChum can emit ~10/s during
  // a feeding frenzy and each one holds for 18-40s, so an unbounded slick
  // population is an unbounded per-frame cost: the shared updater re-reads the
  // LIVE surface height for every water splat every frame, and citySeaHeightAt
  // walks the whole swell table in water_spec.js. ~300 of those a frame is a
  // real budget. So slicks get: a POOLED material (never one per call), their
  // own smaller cap, a spawn-distance LOD, and a throttled surface re-read.
  const SLICK_MATS = [];          // free list — materials outlive their meshes
  let slickN = 0;                 // live water splats (kept in step by freeSlick)
  function slickCap() { return CBZ.qScale ? CBZ.qScale(8, 20) : 12; }
  function slickMat() {
    const m = SLICK_MATS.pop();
    if (m) { m.opacity = 0; return m; }
    const nm = new THREE.MeshBasicMaterial({
      color: 0xffffff, map: bloodTexture(), transparent: true, opacity: 0, depthWrite: false,
      toneMapped: false,             // see PLUME_FRESH: the grade saturated it to candy red
    });
    nm.color.copy(displayColor(SLICK_COL));
    // rm() must never dispose a pooled material — the repo's convention is a
    // _shared tag, and every disposal sweep in the game already honours it.
    nm._shared = true;
    return nm;
  }
  // hand a retiring slick's mesh + material back. EVERY water-splat removal
  // path goes through this, which is also what keeps slickN honest.
  function freeSlick(s) {
    if (!s) return;
    if (s.slot != null) { ldRelease(s); return; }   // a land mark: slot + transform back to the pool
    if (s.water) {
      slickN--;
      if (slickN < 0) slickN = 0;
      const mat = s.m && s.m.material;
      if (mat && mat._shared) {
        // rm() will not free a _shared material, so an over-full pool disposes
        // by hand rather than orphaning a GPU program.
        if (SLICK_MATS.length < 64) SLICK_MATS.push(mat);
        else if (mat.dispose) mat.dispose();
      }
    }
    rm(s.m);
  }
  // evict the FARTHEST live slick (never the one under the player's nose)
  function recycleFarSlick() {
    let worst = -1, worstD = -1;
    for (let i = 0; i < splats.length; i++) {
      const s = splats[i];
      if (!s.water) continue;
      const d = dist2Cam(s.m.position.x, s.m.position.z);
      if (d > worstD) { worstD = d; worst = i; }
    }
    if (worst >= 0) { freeSlick(splats[worst]); splats.splice(worst, 1); }
  }
  const SLICK_LOD2 = 130 * 130;   // beyond this a film of blood on water is nothing
  /* opts (all optional) — a slick that was THROWN somewhere rather than simply
     bleeding where it lies. The swash uses all three: a wave lifts blood off
     the sand, hurls it seaward at backwash speed (vx/vz, dying over `decay`
     seconds as the sheet loses its run), and the cloud must not follow the
     water DOWN through the beach when the sheet drains — `floorY` is the sand
     it was lifted from, and the surface re-read never seats below it. */
  CBZ.goreSlick = function (x, z, amount, opts) {
    if (!waterOn() || !CBZ.scene) return;
    if (dist2Cam(x, z) > SLICK_LOD2) return;              // distance LOD: don't spawn
    if (slickN >= slickCap()) recycleFarSlick();
    if (splats.length > (CBZ.qScale ? CBZ.qScale(85, 300) : 170)) recycleFarSplat();
    const amt = Math.max(0.3, Math.min(3, amount == null ? 1 : amount));
    const o = opts || {};
    const floorY = isFinite(+o.floorY) ? +o.floorY : null;
    const m = new THREE.Mesh(blob(), slickMat());
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.random() * 6.28;
    const sy = seaY(x, z) + 0.06;
    m.position.set(x, floorY != null ? Math.max(sy, floorY + 0.03) : sy, z);
    m.renderOrder = 3; m.scale.set(0.1, 0.1, 1);
    scene().add(m);
    const near = dist2Cam(x, z) < 24 * 24;
    const bt = Math.max(0, +o.decay || 0);
    slickN++;
    splats.push({
      m, water: true, t: 0, grow: 0.4 + amt * 0.55, max: 0.4 + amt * 0.55, growT: 5,
      hold: near ? 14 : 8, fade: 9,
      ax: 0.82 + Math.random() * 0.36, az: 0.82 + Math.random() * 0.36,
      cx: 0, cz: 0, curT: 0, syT: 0,
      bx: +o.vx || 0, bz: +o.vz || 0, bt, bt0: bt || 1, floorY,
    });
  };

  // ---- ONE BUDGET FOR "BLOOD REACHED THE SURFACE" ---------------------------
  // Two paths now report an arrival at the waterline — a plume pinned under the
  // lid, and a ballistic droplet punching through the swell — and both can fire
  // in bursts of dozens. goreSlick's own cap is only slickCap() = 16-46 and
  // updateChum can already spend ~10 slicks a second in a feeding frenzy, so
  // an unthrottled arrival would evict the slicks the frenzy itself just laid
  // (recycleFarSlick) and cost a live-surface re-read per decal per frame for
  // nothing. ONE module timer, ~1 slick per 0.3 s, shared by both callers.
  let surfSlickT = 0;
  function surfaceSlick(x, z, amt) {
    if (surfSlickT > 0) return false;
    surfSlickT = 0.3;
    CBZ.goreSlick(x, z, amt);
    return true;
  }

  /* THE KILL CLOUD — a death is a PLUME that clears, not weather.
     ------------------------------------------------------------------
     A bite is a wisp (goreBloom). A death is one bigger bloom plus a slow,
     murky column of a handful of wide puffs around the body, fed for a few
     seconds by a chum handle as it sinks, and a thin stain overhead. It is
     the biggest blood event in the game and it still tops out around 4-6 m
     across and is gone in under ten seconds. The old one seeded 16 shell
     puffs that grew exponentially to 50-160 m sprites for 7-13 s — a wall of
     pink with the chase camera inside it, which hid the very kill it was for.

     ONCE PER DEATH, enforced here: wildlife_tame, marine_predation and
     wounds.js's death scan can all answer the same death within a frame or
     two, and two kill clouds on one corpse was the default, not the edge
     case. A second call within 4 m and 2 s is refused. */
  const KC_X = new Float32Array(4), KC_Z = new Float32Array(4), KC_T = new Float32Array(4).fill(-99);
  let kcI = 0;
  CBZ.goreKillCloud = function (x, y, z, opts) {
    if (!waterOn() || !CBZ.scene) return false;
    if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return false;
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return false;
    if (!woundInWater(x, y, z)) return false;         // a land death is not this
    opts = opts || {};
    const size = Math.max(0.4, Math.min(3, opts.size == null ? 1 : opts.size));
    const d2 = dist2Cam(x, z);
    if (CBZ.camera && CBZ.camera.position && d2 > 110 * 110) return false;
    for (let k = 0; k < 4; k++) {
      const ex = x - KC_X[k], ez = z - KC_Z[k];
      if (plumeClock - KC_T[k] < 2 && ex * ex + ez * ez < 16) return true;   // already bleeding here
    }
    // KILLS STACK in normal play (thirty eaten in forty seconds): count the
    // recent ones and thin each new plume, so a frenzy is a murky patch of
    // water rather than a red wall.
    let recent = 0;
    for (let k = 0; k < 4; k++) if (plumeClock - KC_T[k] < 6) recent++;
    KC_X[kcI] = x; KC_Z[kcI] = z; KC_T[kcI] = plumeClock; kcI = (kcI + 1) & 3;
    PLUME_AUDIT.kills++;
    const lod = (d2 > 55 * 55 ? 0.5 : 1) / (1 + recent * 0.5);
    // 1 — the bloom at the wound (goreBloom's own merge would cut it if a bite
    //     burst just fired here, so reset that memory: this one is the kill)
    lastBloomT = -1;
    CBZ.goreBloom(x, y, z, { amount: Math.min(2.4, 0.9 + size * 0.7) * (recent ? 0.6 : 1), arterial: true });
    // 2 — the plume: a few wide, faint, slow puffs around the body, a little
    //     taller than wide (it lifts as it spreads), clearing in 6-9 s.
    const n = Math.max(1, Math.round((2 + size * 2) * lod));
    const rad = 0.3 + size * 0.35;
    const top = Math.min(4.5, 1.8 + size * 1.1);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, r = rad * (0.3 + Math.random() * 0.7);
      puff(x + Math.cos(a) * r, y + (Math.random() - 0.3) * rad, z + Math.sin(a) * r,
        Math.cos(a) * 0.12, 0.04, Math.sin(a) * 0.12,
        0.4 + size * 0.2, top * (0.7 + Math.random() * 0.3), 6 + Math.random() * 3, 0.42, 0.8);
    }
    // 3 — the body keeps leaking while it sinks
    if (opts.trail !== false) {
      try { CBZ.goreChum(x, y, z, 0.8, 3 + size * 1.5); } catch (e) {}
    }
    // and the stain overhead: from a boat, that dark patch IS the kill
    CBZ.goreSlick(x, z, (0.7 + 0.5 * size) * (recent ? 0.5 : 1));
    return true;
  };

  /* ============================================================
     THE AIRBORNE BLOOD — everything that leaves a body through the air.

     OWNER, 2026-09-28: "Blood is very good on the ground, but blood flying
     out of people is very geometric and dumb." What he was looking at, read
     off the code this replaced:
       * A DROP was its own Mesh: SphereGeometry(1,7,5), a 35-facet ball,
         scaled to a 2-5 cm radius and stretched a RANDOM 2-4x (not by its
         speed) into an 8-40 cm faceted dart. Lambert-lit, so each facet
         caught the sun as a flat plane; opaque, with a hard silhouette;
         falling at 24 m/s^2 with no air drag. 22-32 of them per kill, born up
         a 1.2 m vertical column, one draw call each.
       * THE MIST was a camera-facing quad with its OWN new MeshBasicMaterial
         (a material allocated per puff, a draw call per puff) on
         bloodTexture(), whose alpha is solid to 55% of its radius: a DISC.
         Coloured 0x8a0b10/0xb01218 and tone mapped, it came out a bright
         saturated red, and it grew 3.2x in half a second: flat red plates
         swelling in the air.
     Faceted darts and flat discs: that is "geometric".

     WHAT IT IS NOW. One InstancedBufferGeometry draws every drop and every
     puff in the air in ONE draw call. Each instance is a quad built in
     SCREEN space by the vertex shader: it runs from where the drop was one
     exposure ago to where it is now (a real motion streak, length = speed x
     shutter), it is as wide as the drop actually projects (never under ~1.5
     px, with its alpha paying for the difference), and the fragment shader
     cuts a soft capsule out of it. A streak smeared over more pixels is
     fainter, as a photographed one is. Nothing has a facet or a lit face.
       * DROPS are real sizes: 0.25-2.5 mm radius in a gunshot's spray, 1.5-5
         mm for a blade's heavy drops. Gravity, plus quadratic air drag with
         the terminal speed a drop that size really has. What lands becomes a
         spatter mark through the stain layer (spawnSplat's "drop"/"dot" on a
         floor, the same atlas cells on a wall face), sized by the drop and
         stretched by its impact angle, tail pointing the way it was going.
       * MIST is a soft gaussian puff thrown down the shot line, dragged to a
         stop in centimetres and gone in 0.2-0.4 s. Gunshots only.
       * STREAMS (a blade, an artery, an open neck or joint) are EMITTERS that
         lay drops along a jet, 45-70 a second. Near the source each drop's
         streak is stretched to meet the next one, so it reads as one
         continuous stream; the stretch relaxes over ~0.12 s, so the jet
         breaks into drops as it flies. An artery PULSES: a few beats, each
         weaker than the last.
     COLOUR is a FILTER, exactly as the stain's is: the air layer MULTIPLIES
     the drawn frame, per channel, with green/blue falling faster than red
     at partial coverage. Worked through core/renderer.js's grade and the
     sRGB framebuffer, the old lit drop came out (255,63,81) on its sunlit
     facets and the old mist (255,80,93): candy pink-red. Alpha-blending any
     honest dark red instead still goes pink over pale concrete and MAUVE
     over sky wherever it is thin (a 0.4 veil of #600609 over sky is hue 287).
     A filter cannot: a drop over pale concrete is (95,7,8), over sky
     (75,6,10), and the thinnest edge of a puff is a darker red, not a pink
     one. It also takes the scene's light for free — a drop in a dark cell or
     at night is as dark as blood there is, it never glows.
     COST: one draw call, one program, no texture, fixed typed arrays, a hard
     cap that recycles, counts LOD'd by distance at spawn, no per-frame
     allocation. Ground marks cost what they always cost (one stain slot).
  ============================================================ */
  const AIR_MAX = 1400;                            // hard allocation; the live cap is airCap()
  function airCap() { return CBZ.qScale ? CBZ.qScale(360, 1400) : 900; }
  const AIR_G = 12;                                // world units/s^2 (a rig is ~2 units tall)
  // what the drawn frame is MULTIPLIED by where the blood fully covers it
  // (screen-space, the framebuffer's own sRGB values): pale concrete
  // (190,188,182) -> (95,7,8) under a drop, (152,84,80) under a puff's core
  const AIR_T_CORE = [0.50, 0.035, 0.045], AIR_T_MIST = [0.60, 0.09, 0.10];
  const AIR_LAND_FRAME = 14;                       // marks stamped per frame, at most
  const AX = new Float32Array(AIR_MAX), AY = new Float32Array(AIR_MAX), AZ = new Float32Array(AIR_MAX);
  const AVX = new Float32Array(AIR_MAX), AVY = new Float32Array(AIR_MAX), AVZ = new Float32Array(AIR_MAX);
  const AR = new Float32Array(AIR_MAX);            // drop radius / puff start size (m)
  const AS1 = new Float32Array(AIR_MAX);           // puff end size (m)
  const AT = new Float32Array(AIR_MAX), AL = new Float32Array(AIR_MAX), AA = new Float32Array(AIR_MAX);
  const AK = new Float32Array(AIR_MAX);            // drop: quadratic drag g/vt^2; puff: linear drag /s
  const ATR = new Float32Array(AIR_MAX), ABRK = new Float32Array(AIR_MAX);   // stream stretch + breakup
  const AFL = new Float32Array(AIR_MAX), AFT = new Float32Array(AIR_MAX);    // floor cache + re-read timer
  const ASEA = new Float32Array(AIR_MAX), AMG = new Float32Array(AIR_MAX);   // sea timer, mark-size override
  const AMK = new Float32Array(AIR_MAX);           // mark-size multiplier (drops that merge on landing)
  const AKIND = new Uint8Array(AIR_MAX), AMARK = new Uint8Array(AIR_MAX);    // 0 drop / 1 mist; leaves a mark
  const AWP = new Int8Array(AIR_MAX), AWG = new Uint16Array(AIR_MAX);        // wall plane + its generation
  const AVV = new Int8Array(AIR_MAX), AVG = new Uint16Array(AIR_MAX);        // the car volume it stops in + its generation
  const AIR_FIELDS = [AX, AY, AZ, AVX, AVY, AVZ, AR, AS1, AT, AL, AA, AK, ATR, ABRK, AFL, AFT, ASEA, AMG, AMK, AKIND, AMARK, AWP, AWG, AVV, AVG];
  let airN = 0, airCursor = 0, airShutter = 1 / 120, airLands = 0;
  // A STREAM LANDS AS A FEW BIGGER MARKS, NOT SIXTY SMALL ONES: drops that
  // arrive on top of each other merge. An emitter (or a blast) sets these
  // around its own drops — the chance a drop leaves its own mark, and how
  // much bigger that mark is for the ones it absorbed.
  let airMarkP = 1, airMarkK = 1;
  // lifetime emit counts (goreAudit)
  const AIR_AUDIT = { drops: 0, mist: 0, lands: 0, wallLands: 0, water: 0, recycled: 0, streams: 0, skippedMarks: 0 };

  let airMesh = null, airGeo = null, aiPos = null, aiVel = null, aiMisc = null;
  function airReady() {
    const sc = scene();
    if (!sc) return false;
    if (!airMesh) {
      const quad = new THREE.PlaneGeometry(1, 1);
      airGeo = new THREE.InstancedBufferGeometry();
      airGeo.setIndex(quad.index);
      airGeo.setAttribute("position", quad.attributes.position);
      aiPos = new THREE.InstancedBufferAttribute(new Float32Array(AIR_MAX * 4), 4);
      aiVel = new THREE.InstancedBufferAttribute(new Float32Array(AIR_MAX * 4), 4);
      aiMisc = new THREE.InstancedBufferAttribute(new Float32Array(AIR_MAX * 2), 2);
      aiPos.setUsage(THREE.DynamicDrawUsage); aiVel.setUsage(THREE.DynamicDrawUsage); aiMisc.setUsage(THREE.DynamicDrawUsage);
      airGeo.setAttribute("iPos", aiPos);
      airGeo.setAttribute("iVel", aiVel);
      airGeo.setAttribute("iMisc", aiMisc);
      airGeo.instanceCount = 0;
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          tCore: { value: new THREE.Vector3(AIR_T_CORE[0], AIR_T_CORE[1], AIR_T_CORE[2]) },
          tMist: { value: new THREE.Vector3(AIR_T_MIST[0], AIR_T_MIST[1], AIR_T_MIST[2]) },
          uPx: { value: 2 / 900 },
        },
        vertexShader: [
          "attribute vec4 iPos;",    // xyz where the drop IS, w radius (m)
          "attribute vec4 iVel;",    // xyz velocity (m/s), w seconds of it to draw behind (shutter)
          "attribute vec2 iMisc;",   // x alpha, y kind (0 drop, 1 mist)
          "uniform float uPx;",      // one pixel, in NDC-y units
          "varying vec2 vQ; varying float vLen; varying float vA; varying float vK;",
          "void main() {",
          "  vec4 vh = modelViewMatrix * vec4(iPos.xyz, 1.0);",
          "  vec4 vt = modelViewMatrix * vec4(iPos.xyz - iVel.xyz * iVel.w, 1.0);",
          "  if (vh.z > -0.06) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; vQ = vec2(9.0); vLen = 0.0; vK = 0.0; return; }",
          "  if (vt.z > -0.06) vt = vh;",
          "  vec4 ch = projectionMatrix * vh;",
          "  vec4 ct = projectionMatrix * vt;",
          // isotropic screen space: x scaled by the aspect so a pixel is square
          "  float asp = projectionMatrix[1][1] / projectionMatrix[0][0];",
          "  vec2 sh = ch.xy / ch.w; sh.x *= asp;",
          "  vec2 st = ct.xy / ct.w; st.x *= asp;",
          "  float rTrue = iPos.w * projectionMatrix[1][1] / ch.w;",
          "  float rad = max(rTrue, uPx * 0.75);",
          "  vec2 d = sh - st; float L = length(d);",
          "  vec2 ax = L > 1e-6 ? d / L : vec2(0.0, 1.0);",
          "  vec2 nx = vec2(-ax.y, ax.x);",
          "  float along = position.y + 0.5;",                    // 0 = tail, 1 = head
          "  vec2 s = mix(st - ax * rad, sh + ax * rad, along) + nx * (position.x * 2.0) * rad;",
          "  vQ = vec2(position.x * 2.0, (along * (L + 2.0 * rad) - rad) / rad);",
          "  vLen = L / rad;",
          // a drop smaller than the pixel floor pays for it in coverage, and a
          // streak smeared over its length thins as a photographed one does —
          // but only so far: a real mm drop at 5 m is a third of a pixel, and
          // at its honest coverage it is a faint salmon hair, not blood. The
          // floors keep every drop a dense dark-red line. Past ~45 m it thins
          // out with the stains.
          "  float cov = clamp(rTrue / rad, 0.6, 1.0);",
          "  float smear = clamp(2.0 * rad / (L + 2.0 * rad), 0.6, 1.0);",
          "  float far = 1.0 - smoothstep(45.0, 70.0, -vh.z);",
          "  vA = iMisc.x * far * (iMisc.y > 0.5 ? 1.0 : cov * smear);",
          "  vK = iMisc.y;",
          "  float w = mix(ct.w, ch.w, along);",
          "  float z = mix(ct.z / ct.w, ch.z / ch.w, along);",
          "  s.x /= asp;",
          "  gl_Position = vec4(s * w, z * w, w);",
          "}",
        ].join("\n"),
        fragmentShader: [
          "uniform vec3 tCore; uniform vec3 tMist;",
          "varying vec2 vQ; varying float vLen; varying float vA; varying float vK;",
          "void main() {",
          // distance to the streak's axis segment, in radii: 0 on it, 1 at the rim
          "  float d = length(vec2(vQ.x, vQ.y - clamp(vQ.y, 0.0, vLen)));",
          "  float c; vec3 T;",
          "  if (vK < 0.5) {",
          "    c = 1.0 - smoothstep(0.55, 1.0, d);",
          // the drop leads, the blur trails it: the head end is the dense end
          "    c *= vLen > 0.01 ? 0.72 + 0.28 * clamp(vQ.y / vLen, 0.0, 1.0) : 1.0;",
          "    T = tCore;",
          "  } else {",
          "    c = exp(-d * d * 3.2) * (1.0 - smoothstep(0.75, 1.0, d));",
          "    T = tMist;",
          "  }",
          "  c *= vA;",
          "  if (c < 0.004) discard;",
          // A FILTER, NOT A PAINT (the stain's rule, for the stain's reason):
          // the screen is MULTIPLIED by this, so blood can only take light
          // away, and green/blue go faster than red at partial coverage — a
          // thin streak or the edge of a puff reads darker-red, never pink,
          // over pale concrete and sky alike, and the scene's own light
          // (a lamp, a dark cell, night) comes through untouched.
          "  float e = vK < 0.5 ? 0.3 : 0.45;",
          "  gl_FragColor = vec4(1.0 - c * (1.0 - T.r), vec2(1.0) - pow(c, e) * (vec2(1.0) - T.gb), 1.0);",
          "}",
        ].join("\n"),
        transparent: true, depthWrite: false, depthTest: true, fog: false, lights: false, toneMapped: false,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
        blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
        blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      });
      mat._shared = true;
      airMesh = new THREE.Mesh(airGeo, mat);
      airMesh.frustumCulled = false;     // instances span the map; the unit quad's bounds are meaningless
      airMesh.raycast = function () {};  // blood in the air is never a surface
      airMesh.renderOrder = 4;           // over the stains (-4), under the sea plume (5)
      airMesh.name = "gore.air";
    }
    if (airMesh.parent !== sc) sc.add(airMesh);
    return true;
  }

  function killAir(i) {
    const last = --airN;
    if (i !== last) for (let k = 0; k < AIR_FIELDS.length; k++) AIR_FIELDS[k][i] = AIR_FIELDS[k][last];
  }
  // a free slot, or (full) the next one round the ring: the air is never
  // refused fresh blood, it gives up something that has been flying longer
  function airSlot() {
    const cap = Math.min(AIR_MAX, airCap());
    if (airN < cap) return airN++;
    AIR_AUDIT.recycled++;
    airCursor = (airCursor + 1) % airN;
    return airCursor;
  }

  // a drop radius in metres, skewed small: most of a spray is fine, the odd drop is heavy
  function rMM(lo, hi) { const u = Math.random(); return (lo + (hi - lo) * u * u * u) * 0.001; }
  // how much of an event to throw at this distance from the lens
  function airLod(x, z) {
    const d2 = dist2Cam(x, z);
    return d2 < 15 * 15 ? 1 : (d2 < 30 * 30 ? 0.6 : (d2 < 50 * 50 ? 0.35 : 0.2));
  }
  // a unit vector inside a cone of half-angle `ang` round (dx,dy,dz) → _cv
  const _cv = { x: 0, y: 0, z: 0 };
  function cone(dx, dy, dz, ang) {
    let l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= l; dy /= l; dz /= l;
    let ux, uy, uz;
    if (Math.abs(dy) < 0.9) { ux = -dz; uy = 0; uz = dx; } else { ux = 0; uy = dz; uz = -dy; }
    l = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1; ux /= l; uy /= l; uz /= l;
    const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
    const th = ang * Math.sqrt(Math.random()), ph = Math.random() * 6.2832;
    const ct = Math.cos(th), st = Math.sin(th), cp = Math.cos(ph) * st, sp = Math.sin(ph) * st;
    _cv.x = dx * ct + ux * cp + vx * sp; _cv.y = dy * ct + uy * cp + vy * sp; _cv.z = dz * ct + uz * cp + vz * sp;
    return _cv;
  }

  /* airDrop(x,y,z, vx,vy,vz, r, wp, trail0, brk, markR)
     r: radius in metres. wp: a wall plane from airWall() (-1: none). trail0 /
     brk: a stream drop's stretched streak (seconds of velocity) and how long
     it takes to break up. markR: the landing mark's radius, when the caller
     knows it better than the drop does (a walking bleeder's drip). */
  function airDrop(x, y, z, vx, vy, vz, r, wp, trail0, brk, markR) {
    // a wound under the sea does not throw drops: it blooms (THE WATER MEDIUM)
    if (wetEvent) { AIR_AUDIT.water++; puffFromBit(x, y, z, vx, vy, vz, r * 20, false); return -1; }
    if (!airReady()) return -1;
    const i = airSlot();
    r *= +CBZ.CONFIG.GORE_DROP_SCALE || 1;
    AX[i] = x; AY[i] = y; AZ[i] = z; AVX[i] = vx; AVY[i] = vy; AVZ[i] = vz;
    AR[i] = r; AS1[i] = r; AT[i] = 0; AL[i] = 4; AA[i] = 0.95;
    // terminal speed by size (a 1 mm drop ~4 m/s, 3 mm ~8, 5 mm+ ~9): the fine
    // spray slows in the air and drifts down, the heavy drops keep their arc
    const vt = 0.6 + 9 * (1 - Math.exp(-(r * 1000) / 1.1));
    AK[i] = AIR_G / (vt * vt);
    ATR[i] = trail0 || 0; ABRK[i] = brk || 0.12;
    AKIND[i] = 0; AMARK[i] = airMarkP >= 1 || Math.random() < airMarkP ? 1 : 0; AMG[i] = markR || 0; AMK[i] = airMarkK;
    AWP[i] = wp == null || wp < 0 ? -1 : wp; AWG[i] = wp == null || wp < 0 ? 0 : WP_GEN[wp];
    AVV[i] = airVV; AVG[i] = airVV < 0 ? 0 : VV_GEN[airVV];
    AFL[i] = decalFloorAt(x, z); AFT[i] = 0.02 + Math.random() * 0.06; ASEA[i] = Math.random() * 0.18;
    AIR_AUDIT.drops++;
    return i;
  }
  /* airMist(x,y,z, vx,vy,vz, s0, s1, life, alpha) — one soft puff; s0 -> s1
     is its radius (m) from birth to death. */
  function airMist(x, y, z, vx, vy, vz, s0, s1, life, alpha) {
    if (wetEvent) { AIR_AUDIT.water++; puffFromBit(x, y, z, vx, vy, vz, s1 * 0.3, true); return -1; }
    if (waterOn() && mistOverSea(x, y, z)) return -1;   // no aerosol over open water
    if (!airReady()) return -1;
    const i = airSlot();
    AX[i] = x; AY[i] = y; AZ[i] = z; AVX[i] = vx; AVY[i] = vy; AVZ[i] = vz;
    AR[i] = s0; AS1[i] = Math.max(s0, s1); AT[i] = 0; AL[i] = life; AA[i] = alpha;
    AK[i] = 7 + Math.random() * 4;                      // aerosol stops in centimetres
    ATR[i] = 0; ABRK[i] = 0; AKIND[i] = 1; AMARK[i] = 0; AMG[i] = 0; AMK[i] = 1; AWP[i] = -1; AWG[i] = 0; AVV[i] = -1; AVG[i] = 0;
    AFL[i] = 0; AFT[i] = 0; ASEA[i] = 0;
    AIR_AUDIT.mist++;
    return i;
  }

  // ---- WALL PLANES: a spray headed for a wall lands ON it ---------------------
  // One scan per EVENT (the same opaque/wall-sized gate a kill's wall splat
  // passes), shared by every drop of it: a drop tests one plane per frame,
  // never the collider list. Generation-stamped so a recycled slot can never
  // catch a drop from an older event on a different wall.
  const WP_MAX = 16;
  const WP_NX = new Float32Array(WP_MAX), WP_NZ = new Float32Array(WP_MAX), WP_D = new Float32Array(WP_MAX);
  const WP_T0 = new Float32Array(WP_MAX), WP_T1 = new Float32Array(WP_MAX);
  const WP_Y0 = new Float32Array(WP_MAX), WP_Y1 = new Float32Array(WP_MAX);
  const WP_GEN = new Uint16Array(WP_MAX);
  const WP_C = new Array(WP_MAX).fill(null);         // the collider struck: its mesh is what the drops ride
  let wpCursor = 0, airWallT = 3.4;
  function airWall(x, y, z, dx, dz) {
    if (!(dx || dz)) return -1;
    const f = wallFace(x, y, z, dx, dz, 3.4);
    airWallT = f ? f.t : 3.4;
    if (!f) return -1;
    const k = wpCursor; wpCursor = (wpCursor + 1) % WP_MAX;
    const c = f.c, hx = x + dx * f.t, hz = z + dz * f.t;
    const nx = f.face === "xmin" ? -1 : (f.face === "xmax" ? 1 : 0);
    const nz = f.face === "zmin" ? -1 : (f.face === "zmax" ? 1 : 0);
    WP_NX[k] = nx; WP_NZ[k] = nz; WP_D[k] = nx * hx + nz * hz;
    if (nx) { WP_T0[k] = c.minZ; WP_T1[k] = c.maxZ; } else { WP_T0[k] = c.minX; WP_T1[k] = c.maxX; }
    WP_Y0[k] = f.y0; WP_Y1[k] = f.y1; WP_C[k] = c;
    WP_GEN[k] = (WP_GEN[k] + 1) & 0xffff;
    return k;
  }
  // a drop's mark on a wall face: the stain layer's drop/dot cells, laid in
  // the face's plane, tail pointing along the drop's in-plane travel
  function wallDrop(px, py, pz, nx, nz, vx, vy, vz, g, col) {
    if (walls.length > 34) return false;             // the kills' own wall splats come first
    const c = claimLand();
    if (!c) return false;
    const m = c.m;
    const ry = nx ? (nx > 0 ? Math.PI / 2 : -Math.PI / 2) : (nz > 0 ? 0 : Math.PI);
    const tx = Math.cos(ry), tz = -Math.sin(ry);     // the face's local +x in world
    const u = vx * tx + vz * tz, w = vy;
    const sp = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
    const sinA = Math.abs(vx * nx + vz * nz) / sp;
    const drop = sinA < 0.9 && Math.hypot(u, w) > 0.3;
    let sx = (g * 2) / (drop ? 0.6 : 0.92);
    const sy = sx * (drop ? Math.max(1, Math.min(3.4, 1 / Math.max(0.3, sinA))) : 1);
    if (Math.random() < 0.5) sx = -sx;
    m.position.set(px + nx * 0.021, py, pz + nz * 0.021);
    m.rotation.set(0, ry, drop ? Math.atan2(-u, w) : Math.random() * 6.28);
    m.scale.set(sx, sy, 1);
    ldWrite(c.slot, m, drop ? CELL_DROP : CELL_DOT, 1, 0.08, 5 + Math.random() * 5, 0.35, 0.55, 0.1, 1, 0);
    const near = dist2Cam(px, pz) < 24 * 24;
    walls.push(anchorTo({ m, slot: c.slot, t: 0, hold: near ? 40 : 14, fade: 8 }, col));
    return true;
  }
  // how big a mark a drop leaves: a few times its own size, more the faster
  // it hits (the forensic spread factor), unless the caller said otherwise
  function markOf(i, sp) { return AMG[i] || AR[i] * AMK[i] * Math.min(4.5, 1.7 + sp * 0.3); }
  function floorLand(i) {
    if (!AMARK[i]) return;
    const vx = AVX[i], vy = AVY[i], vz = AVZ[i];
    const hs = Math.hypot(vx, vz), sp = Math.hypot(hs, vy);
    const g = markOf(i, sp);
    // a 3 mm mark is real, and invisible from across the room: don't spend a
    // stain slot on one nobody can see, or on the fifteenth in one frame
    if ((g < 0.0035 && dist2Cam(AX[i], AZ[i]) > 8 * 8) || airLands >= AIR_LAND_FRAME) { AIR_AUDIT.skippedMarks++; return; }
    airLands++;
    const sinA = Math.abs(vy) / (sp || 1);
    _dropO.kind = sinA > 0.9 || hs < 0.3 ? "dot" : "drop";
    _dropO.dirX = hs > 0 ? vx / hs : 0; _dropO.dirZ = hs > 0 ? vz / hs : 0;
    _dropO.elong = 1 / Math.max(0.3, sinA);
    if (spawnSplat(AX[i], AZ[i], g, BLOOD_D, false, _dropO)) AIR_AUDIT.lands++;
  }

  // ---- STREAMS: a jet that pulses, laid down drop by drop ---------------------
  const EM_MAX = 12;
  const E_ON = new Uint8Array(EM_MAX), E_SRC = new Uint8Array(EM_MAX), E_WET = new Uint8Array(EM_MAX);
  const E_REF = new Array(EM_MAX).fill(null);   // the body / stump it rides (0 = a fixed point)
  const E_X = new Float32Array(EM_MAX), E_Y = new Float32Array(EM_MAX), E_Z = new Float32Array(EM_MAX);
  const E_Y1 = new Float32Array(EM_MAX);
  const E_DX = new Float32Array(EM_MAX), E_DY = new Float32Array(EM_MAX), E_DZ = new Float32Array(EM_MAX);
  const E_SP = new Float32Array(EM_MAX), E_DEL = new Float32Array(EM_MAX), E_T = new Float32Array(EM_MAX);
  const E_TT = new Float32Array(EM_MAX), E_PER = new Float32Array(EM_MAX), E_PL = new Float32Array(EM_MAX);
  const E_N = new Float32Array(EM_MAX), E_K = new Float32Array(EM_MAX), E_FALL = new Float32Array(EM_MAX);
  const E_ACC = new Float32Array(EM_MAX), E_RATE = new Float32Array(EM_MAX), E_SPR = new Float32Array(EM_MAX);
  const E_R0 = new Float32Array(EM_MAX), E_R1 = new Float32Array(EM_MAX);
  const _emBloom = { amount: 0.5, arterial: true };
  /* airStream(src, ref, x, y, z, dx, dy, dz, o)
     src 0: a fixed point (x,y,z). src 1: an actor — rides ref.pos, at a
     height sliding from y to o.y1 over ~0.9 s as the body goes down. src 2:
     an Object3D (a stump) — rides its world position and jets along its
     world +Y, which is the way a cut face looks out.
     o: speed (m/s at the top of a beat), pulses, period (s between beats),
     len (s a beat lasts), fall (each beat's strength vs the last), rate
     (drops/s), r0/r1 (drop radius, mm), spread (cone half-angle), delay. */
  function airStream(src, ref, x, y, z, dx, dy, dz, o) {
    let e = -1;
    for (let k = 0; k < EM_MAX; k++) if (!E_ON[k]) { e = k; break; }
    if (e < 0) return -1;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    E_ON[e] = 1; E_SRC[e] = src; E_REF[e] = ref || null; E_WET[e] = 0;
    E_X[e] = x; E_Y[e] = y; E_Z[e] = z; E_Y1[e] = o.y1 != null ? o.y1 : y;
    E_DX[e] = dx / l; E_DY[e] = dy / l; E_DZ[e] = dz / l;
    E_SP[e] = o.speed; E_N[e] = o.pulses || 1; E_PER[e] = o.period || 0.5; E_PL[e] = o.len || 0.22;
    E_FALL[e] = o.fall || 0.7; E_RATE[e] = o.rate || 55; E_R0[e] = o.r0 || 1; E_R1[e] = o.r1 || 2.5;
    E_SPR[e] = o.spread || 0.12; E_DEL[e] = o.delay || 0; E_K[e] = 1;
    E_T[e] = 0; E_TT[e] = 0; E_ACC[e] = 0.999;           // the first drop leaves on the first frame
    AIR_AUDIT.streams++;
    return e;
  }
  function stopStream(e) { E_ON[e] = 0; E_REF[e] = null; }
  const _esp = new THREE.Vector3();
  function updateStreams(dt) {
    for (let e = 0; e < EM_MAX; e++) {
      if (!E_ON[e]) continue;
      if (E_DEL[e] > 0) { E_DEL[e] -= dt; continue; }
      const ref = E_REF[e];
      let sx, sy, sz, jx = E_DX[e], jy = E_DY[e], jz = E_DZ[e];
      if (E_SRC[e] === 1) {
        const p = ref && !ref.culled ? (ref.pos || (ref.group && ref.group.position)) : null;
        if (!p) { stopStream(e); continue; }
        const k = Math.min(1, E_TT[e] / 0.9);
        sx = p.x + E_X[e]; sz = p.z + E_Z[e]; sy = (p.y || 0) + E_Y[e] + (E_Y1[e] - E_Y[e]) * k;
      } else if (E_SRC[e] === 2) {
        if (!ref || !ref.parent) { stopStream(e); continue; }
        ref.updateWorldMatrix(true, false);
        const me = ref.matrixWorld.elements;
        sx = me[12]; sy = me[13]; sz = me[14];
        const al = Math.sqrt(me[4] * me[4] + me[5] * me[5] + me[6] * me[6]) || 1;
        jx = me[4] / al; jy = me[5] / al; jz = me[6] / al;
      } else { sx = E_X[e]; sy = E_Y[e]; sz = E_Z[e]; }
      const first = E_TT[e] === 0;
      E_TT[e] += dt;
      E_T[e] += dt;
      if (E_T[e] >= E_PER[e]) {
        E_T[e] -= E_PER[e];
        if (--E_N[e] <= 0) { stopStream(e); continue; }
        E_K[e] *= E_FALL[e];
        E_ACC[e] = 0.999;
      }
      // each BEAT decides its own medium (a body can fall in the water between them)
      if (first || E_T[e] < dt) {
        E_WET[e] = waterOn() && woundInWater(sx, sy, sz) ? 1 : 0;
        if (E_WET[e]) { _emBloom.amount = 0.3 + 0.4 * E_K[e]; CBZ.goreBloom(sx, sy, sz, _emBloom); }
      }
      if (E_WET[e]) continue;
      const ph = E_T[e] / E_PL[e];
      if (ph >= 1) continue;                               // between beats
      // a beat SURGES and collapses; the stream never quite stops inside one
      const surge = Math.pow(Math.sin(Math.PI * Math.min(1, ph + 0.08)), 0.7);
      const rate = E_RATE[e] * (dist2Cam(sx, sz) > 30 * 30 ? 0.5 : 1);
      E_ACC[e] += dt * rate;
      const trail = 1.15 / rate;
      airMarkP = 0.3; airMarkK = 1.6;
      while (E_ACC[e] >= 1) {
        E_ACC[e] -= 1;
        const v = cone(jx, jy, jz, E_SPR[e]);
        const sp = E_SP[e] * E_K[e] * (0.3 + 0.7 * surge) * (0.93 + Math.random() * 0.14);
        airDrop(sx + (Math.random() - 0.5) * 0.012, sy + (Math.random() - 0.5) * 0.012, sz + (Math.random() - 0.5) * 0.012,
          v.x * sp, v.y * sp, v.z * sp, rMM(E_R0[e], E_R1[e]), -1, trail, 0.13 + Math.random() * 0.07, 0);
      }
      airMarkP = 1; airMarkK = 1;
    }
  }

  // ---- THE EVENTS --------------------------------------------------------------
  /* A ROUND THROUGH FLESH. (dx,dy,dz): the shot line, shooter -> victim.
       entry: a small cone of FINE drops thrown back toward the shooter (back
              spatter), and a wisp of mist at the hole
       exit (`through`): a bigger, faster cone out the far side along the
              bullet path, a mist puff down the line, and the wall behind it
              catches whatever reaches it
     `amt` ~0.3 a pellet .. ~1 a head. */
  function shotBlood(x, y, z, dx, dy, dz, amt, through, head, lod, pop) {
    const nE = Math.round((3 + 7 * amt) * lod);
    for (let i = 0; i < nE; i++) {
      const v = cone(-dx, -dy + 0.2, -dz, 0.62);
      const sp = 1.2 + Math.random() * 3.8;
      airDrop(x, y, z, v.x * sp, v.y * sp, v.z * sp, rMM(0.25, 1.3), -1, 0, 0, 0);
    }
    const nEM = lod < 0.5 ? 0 : (amt >= 0.5 ? 2 : 1);
    for (let i = 0; i < nEM; i++) {
      airMist(x - dx * 0.03, y, z - dz * 0.03,
        -dx * (0.8 + Math.random()) + (Math.random() - 0.5) * 0.5, 0.15 + Math.random() * 0.3, -dz * (0.8 + Math.random()) + (Math.random() - 0.5) * 0.5,
        0.02, 0.07 + 0.07 * amt, 0.18 + Math.random() * 0.08, 0.26);
    }
    if (!through) return;
    const T = head ? 0.17 : 0.26;
    const ex = x + dx * T, ey = y + dy * T, ez = z + dz * T;
    let wp = lod >= 0.6 ? airWall(ex, ey, ez, dx, dz) : -1;
    // a car on the line before the wall takes the spray ON its body
    const vv = lod >= 0.6 ? vehicleSpray(ex, ey, ez, dx, dy, dz, amt, head, wp >= 0 ? airWallT : 3.4) : -1;
    if (vv >= 0) wp = -1;
    airVV = vv;
    const nX = Math.round((8 + 20 * amt) * (head ? 1.3 : 1) * (pop ? 1.5 : 1) * lod);
    const k = 0.7 + 0.45 * Math.min(1.4, amt);
    for (let i = 0; i < nX; i++) {
      const v = cone(dx, dy + 0.08, dz, head ? 0.42 : 0.32);
      const sp = (3 + Math.random() * Math.random() * 10) * k;
      airDrop(ex + (Math.random() - 0.5) * 0.04, ey + (Math.random() - 0.5) * 0.04, ez + (Math.random() - 0.5) * 0.04,
        v.x * sp, v.y * sp, v.z * sp, rMM(0.3, head ? 2.6 : 2.2), wp, 0, 0, 0);
    }
    airVV = -1;
    const nXM = lod < 0.35 ? 1 : (head ? 4 : 2) + (amt > 0.8 ? 1 : 0) + (pop ? 3 : 0);
    const big = (head ? 1.45 : 1) * (pop ? 1.5 : 1) * (0.7 + 0.4 * Math.min(1.4, amt));
    for (let i = 0; i < nXM; i++) {
      const v = cone(dx, dy + 0.1, dz, 0.35);
      const sp = 2.5 + Math.random() * 3.5;
      airMist(ex, ey, ez, v.x * sp, v.y * sp, v.z * sp,
        0.03, (0.16 + Math.random() * 0.12) * big, 0.22 + Math.random() * 0.16, head ? 0.34 : 0.27);
    }
  }
  // no shot line (a fall, a disaster, an unknown cause): a short burst all round
  function omniBlood(x, y, z, amt, lod) {
    const n = Math.round((4 + 6 * amt) * lod);
    for (let i = 0; i < n; i++) {
      const v = cone(0, 1, 0, 1.25);
      const sp = 0.8 + Math.random() * 2.6;
      airDrop(x, y, z, v.x * sp, v.y * sp, v.z * sp, rMM(0.4, 3), -1, 0, 0, 0);
    }
  }
  // a blast: drops out in every direction, fast, and one wide dark puff
  function blastBlood(x, y, z, amt, lod) {
    const n = Math.round(26 * amt * lod);
    airMarkP = 0.4; airMarkK = 1.3;
    for (let i = 0; i < n; i++) {
      const v = cone(0, 1, 0, 1.45);
      const sp = 3 + Math.random() * 7;
      airDrop(x + (Math.random() - 0.5) * 0.4, y + (Math.random() - 0.5) * 0.6, z + (Math.random() - 0.5) * 0.4,
        v.x * sp, v.y * sp + 1.5, v.z * sp, rMM(0.4, 3.5), -1, 0, 0, 0);
    }
    airMarkP = 1; airMarkK = 1;
    const nm = Math.max(1, Math.round(5 * lod));
    for (let i = 0; i < nm; i++) {
      const v = cone(0, 1, 0, 1.4), sp = 2 + Math.random() * 3;
      airMist(x, y, z, v.x * sp, v.y * sp, v.z * sp, 0.08, 0.4 + Math.random() * 0.4, 0.3 + Math.random() * 0.15, 0.3);
    }
  }
  /* A BLADE: no aerosol. A few HEAVY drops flicked off along the cut, and a
     short stream out of the wound (two beats when it went deep). */
  function stabBlood(x, y, z, dx, dz, amt, lod) {
    const n = Math.round((3 + 3 * Math.min(1.5, amt)) * lod);
    for (let i = 0; i < n; i++) {
      const v = cone(dx, 0.45, dz, 0.6);
      const sp = 0.8 + Math.random() * 1.8;
      airDrop(x, y, z, v.x * sp, v.y * sp, v.z * sp, rMM(1.5, 5), -1, 0, 0, 0);
    }
    if (lod >= 0.35) {
      airStream(0, null, x + dx * 0.04, y, z + dz * 0.04, dx, 0.35, dz, {
        speed: 1.9 + 0.6 * Math.min(1.5, amt), pulses: amt > 1 ? 2 : 1, period: 0.42, len: 0.2 + Math.random() * 0.1,
        fall: 0.6, rate: 55, r0: 1.0, r1: 2.6, spread: 0.12,
      });
    }
  }
  /* BLUNT: a split lip or a brow. A punch throws little or nothing — a light
     hit is 0-2 fine drops, a real crunch a handful, and only a hard one
     atomises anything (opts.mist). */
  function bluntBlood(x, y, z, dx, dy, dz, hasDir, amt, lod, mist) {
    let n;
    if (amt < 0.5) n = Math.min(2, (Math.random() * amt * 5) | 0);
    else n = Math.round((2 + 5 * (amt - 0.5)) * lod);
    for (let i = 0; i < n; i++) {
      const v = hasDir ? cone(dx, dy + 0.35, dz, 0.75) : cone(0, 1, 0, 1.2);
      const sp = 0.8 + Math.random() * (1.4 + amt * 1.6);
      airDrop(x + (Math.random() - 0.5) * 0.08, y + (Math.random() - 0.5) * 0.08, z + (Math.random() - 0.5) * 0.08,
        v.x * sp, v.y * sp, v.z * sp, rMM(0.4, amt < 0.5 ? 1.6 : 3), -1, 0, 0, 0);
    }
    if (mist && lod >= 0.35) {
      const nm = amt > 1.2 ? 2 : 1;
      for (let i = 0; i < nm; i++) {
        airMist(x, y, z, dx * 1.2 + (Math.random() - 0.5) * 0.6, 0.3, dz * 1.2 + (Math.random() - 0.5) * 0.6,
          0.03, 0.1 + 0.06 * amt, 0.2 + Math.random() * 0.1, 0.22);
      }
    }
  }
  // the dedupe: a player's round runs gore.spray (entry + exit) and, if it
  // kills, CBZ.gore on the same body a moment later — one wound, one spray
  let sprayX = 1e9, sprayZ = 0, sprayT = -9;
  function noteSpray(x, z) { sprayX = x; sprayZ = z; sprayT = plumeClock; }
  function sprayedHere(x, z) {
    return plumeClock - sprayT < 0.3 && Math.abs(x - sprayX) < 1.5 && Math.abs(z - sprayZ) < 1.5;
  }

  // ---- the frame ----------------------------------------------------------------
  function updateAir(dt) {
    airLands = 0;
    updateStreams(dt);
    if (!airGeo) return;
    // a 180-degree shutter: a drop smears across half the frame's time
    airShutter = Math.min(1 / 45, Math.max(1 / 240, dt * 0.5));
    const sea = waterOn();
    for (let i = airN - 1; i >= 0; i--) {
      const t = (AT[i] += dt);
      if (t >= AL[i]) { killAir(i); continue; }
      if (AKIND[i] === 1) {
        const dg = Math.exp(-AK[i] * dt);
        AVX[i] *= dg; AVZ[i] *= dg; AVY[i] = AVY[i] * dg - 0.5 * dt;
        AX[i] += AVX[i] * dt; AY[i] += AVY[i] * dt; AZ[i] += AVZ[i] * dt;
        continue;
      }
      // quadratic drag (implicit, so a fast fine drop can never overshoot), then gravity
      let vx = AVX[i], vy = AVY[i], vz = AVZ[i];
      const f = 1 / (1 + AK[i] * Math.sqrt(vx * vx + vy * vy + vz * vz) * dt);
      vx *= f; vy = vy * f - AIR_G * dt; vz *= f;
      AVX[i] = vx; AVY[i] = vy; AVZ[i] = vz;
      const x = (AX[i] += vx * dt), y = (AY[i] += vy * dt), z = (AZ[i] += vz * dt);
      // A DROP THAT REACHES THE SEA GOES INTO IT (a jittered ~0.2 s stagger;
      // submRaw is one call returning DRY on a map with no water)
      if (sea) {
        ASEA[i] -= dt;
        if (ASEA[i] <= 0) {
          ASEA[i] = 0.16 + Math.random() * 0.08;
          const sub = submRaw(x, y, z);
          if (sub !== DRY && sub >= 0) {
            AIR_AUDIT.water++;
            puffFromBit(x, y, z, vx, vy, vz, AR[i] * 20, false);
            if (Math.random() < 0.3) surfaceSlick(x, z, 0.3);
            killAir(i); continue;
          }
        }
      }
      // the car its spray was headed for: it is on the body now (the spatter
      // decal stands for it), not falling through the bonnet to the road
      const vv = AVV[i];
      if (vv >= 0) {
        if (AVG[i] !== VV_GEN[vv]) AVV[i] = -1;
        else if (inVolume(vv, x, y, z)) { killAir(i); continue; }
      }
      // the wall its spray was headed for
      const wp = AWP[i];
      if (wp >= 0) {
        if (AWG[i] !== WP_GEN[wp]) AWP[i] = -1;
        else {
          const s = WP_NX[wp] * x + WP_NZ[wp] * z - WP_D[wp];
          if (s <= 0.01) {
            const tan = WP_NX[wp] ? z : x;
            if (tan >= WP_T0[wp] && tan <= WP_T1[wp] && y >= WP_Y0[wp] && y <= WP_Y1[wp]) {
              if (AMARK[i] && airLands < AIR_LAND_FRAME) {
                airLands++;
                const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
                if (wallDrop(x - WP_NX[wp] * s, y, z - WP_NZ[wp] * s, WP_NX[wp], WP_NZ[wp], vx, vy, vz, markOf(i, sp), WP_C[wp])) AIR_AUDIT.wallLands++;
              }
              killAir(i); continue;
            }
            AWP[i] = -1;                                  // it went past the end of that wall
          }
        }
      }
      // the floor: a slow field, re-read on a stagger, every frame near it
      AFT[i] -= dt;
      if (AFT[i] <= 0 || y < AFL[i] + 0.3) { AFT[i] = 0.08; AFL[i] = decalFloorAt(x, z); }
      if (y <= AFL[i] && vy < 0) { AY[i] = AFL[i]; floorLand(i); killAir(i); continue; }
    }
    // ---- the instance buffers (live count only) ----
    const n = airN;
    airGeo.instanceCount = n;
    if (!n) return;
    const cv = CBZ.renderer && CBZ.renderer.domElement;
    airMesh.material.uniforms.uPx.value = 2 / (cv && cv.height ? cv.height : 900);
    const ap = aiPos.array, av = aiVel.array, am = aiMisc.array;
    for (let i = 0; i < n; i++) {
      const o = i * 4, o2 = i * 2, t = AT[i];
      ap[o] = AX[i]; ap[o + 1] = AY[i]; ap[o + 2] = AZ[i];
      av[o] = AVX[i]; av[o + 1] = AVY[i]; av[o + 2] = AVZ[i];
      if (AKIND[i] === 1) {
        const f = t / AL[i], q = 1 - f;
        ap[o + 3] = AR[i] + (AS1[i] - AR[i]) * (1 - q * q * q);   // opens fast, then hangs
        av[o + 3] = 0.035;                                         // smeared a little down its flight
        am[o2] = AA[i] * q * Math.sqrt(q) * (t < 0.03 ? t / 0.03 : 1);
        am[o2 + 1] = 1;
      } else {
        let tr = airShutter;
        // a stream drop holds its full stretch (joined to the next) for the
        // first ~60% of its breakup time, then lets go
        if (ATR[i] > 0 && t < ABRK[i]) {
          const u = t / ABRK[i], k = ATR[i] * (u < 0.6 ? 1 : (1 - u) / 0.4);
          if (k > tr) tr = k;
        }
        ap[o + 3] = AR[i];
        av[o + 3] = tr;
        am[o2] = AA[i];
        am[o2 + 1] = 0;
      }
    }
    aiPos.needsUpdate = true; aiVel.needsUpdate = true; aiMisc.needsUpdate = true;
  }

  // where a gib comes to rest it bleeds. On the seabed that must NOT be a
  // ground pool — a decal lying in the dark under 30m of water is the exact
  // "invisible gore at the bottom of the ocean" bug this whole block exists to
  // stop — so a wet gib puffs where it settles instead.
  function landBleed(b, m) {
    if (b.wet) CBZ.goreBloom(m.position.x, m.position.y, m.position.z, { amount: 0.4 });
    // a chunk bleeds where it stops, but `grow` is a RADIUS: the authored
    // 0.4-0.8 was a 1.6 m pool under a piece of forearm.
    else spawnSplat(m.position.x, m.position.z, 0.16 + Math.random() * 0.16, BLOOD_D, false, _poolO);
  }

  // ---- CHUM: a sustained bleed source, and the seam the shark AI reads ------
  // A wounded thing trailing blood is only interesting if something can SMELL
  // it. goreChumList() is that seam: a live, allocation-free array of every
  // bleeding point currently in the water, which the hunt driver reads to
  // decide it has a reason to come. Positions may be numbers or functions, so
  // a moving swimmer trails from wherever it actually is.
  const chum = [], chumOut = [];
  const CHUM_CAP = 12;
  function cval(v) { return typeof v === "function" ? (+v() || 0) : (+v || 0); }
  CBZ.goreChum = function (x, y, z, rate, ttl) {
    if (!waterOn() || chum.length >= CHUM_CAP) return null;
    const h = {
      x, y, z, rate: Math.max(0.05, Math.min(1, rate == null ? 0.5 : rate)),
      ttl: Math.max(0.5, Math.min(60, ttl == null ? 8 : ttl)),
      acc: 0, probeT: 0, wet: false, dead: false,
      out: { x: 0, y: 0, z: 0, strength: 0 },
    };
    chum.push(h);
    return h;
  };
  CBZ.goreChumStop = function (h) {
    if (!h) return;
    const i = chum.indexOf(h);
    if (i >= 0) chum.splice(i, 1); else h.dead = true;
  };
  // returns the LIVE array — rebuilt in place every frame, never a fresh one,
  // because the hunt driver polls this per hunter per frame.
  CBZ.goreChumList = function () { return chumOut; };
  function updateChum(dt) {
    chumOut.length = 0;
    for (let i = chum.length - 1; i >= 0; i--) {
      const c = chum[i];
      c.ttl -= dt;
      if (c.dead || c.ttl <= 0) { chum.splice(i, 1); continue; }
      const x = cval(c.x), y = cval(c.y), z = cval(c.z);
      c.probeT -= dt;
      if (c.probeT <= 0) { c.probeT = 0.4; c.wet = inWater(x, y, z); }
      if (!c.wet) continue;                       // a bleeder on dry land is not chum
      const o = c.out;
      o.x = x; o.y = y; o.z = z;
      o.strength = c.rate * Math.min(1, c.ttl / 3);   // the trail thins as it runs out
      chumOut.push(o);
      c.acc += dt;
      if (c.acc >= 0.18) {
        c.acc = 0;
        /* THE RIBBON. A bleeding body used to fire a whole goreBloom (up to
           ~10 puffs) every 0.35 s — a string of separate clouds, a pulse of
           red every third of a second. Real blood leaves a moving wound as one
           continuous thread that widens and dissolves behind it, so this lays
           ONE small faint puff where the body is now, often: the body swims
           on, the puffs stay in the water behind it and spread with the
           current, and the line of them IS the trail. Severity sets how thick
           and how long it lingers. */
        // under load (a feeding frenzy, thirty eaten in forty seconds) the
        // ribbons thin out rather than filling the cap with trail
        if (dist2Cam(x, z) < 80 * 80 && (puffs.length < puffCap() * 0.5 || Math.random() < 0.4)) {
          PLUME_AUDIT.chumPuffs++;
          puff(x + (Math.random() - 0.5) * 0.2, y + (Math.random() - 0.5) * 0.2, z + (Math.random() - 0.5) * 0.2,
            0, 0, 0, 0.14 + c.rate * 0.1, 0.55 + c.rate * 0.9, 2.4 + c.rate * 1.8 + Math.random() * 0.6,
            0.18 + c.rate * 0.22, 0.3);
        }
        // a torn artery PUMPS: now and then a small burst, not every tick
        if (c.rate > 0.75 && Math.random() < 0.12) CBZ.goreBloom(x, y, z, { amount: 0.5, arterial: true });
        // a bleeder near the top stains the surface; one ten metres down does not
        if (Math.random() < 0.03 + c.rate * 0.05 && seaY(x, z) - y < 2.5) CBZ.goreSlick(x, z, 0.25 + c.rate * 0.45);
      }
    }
  }

  // PERMANENCE / population-pool recycle: when the gib pool is full, evict the
  // OLDEST gib that has LANDED and is FAR from the lens — never a fresh, in-air,
  // or on-screen piece (the GTA pattern: things vanish only off-camera).
  function recycleFarGib() {
    let far = 55 * 55;
    for (let i = 0; i < bits.length; i++) {
      const b = bits[i];
      if (b.kind !== "gib" || !b.landed) continue;
      if (dist2Cam(b.m.position.x, b.m.position.z) > far) { rm(b.m); bits.splice(i, 1); return true; }
    }
    // none far → drop the literal oldest LANDED gib so we never pop one in-flight
    for (let i = 0; i < bits.length; i++) {
      if (bits[i].kind === "gib" && bits[i].landed) { rm(bits[i].m); bits.splice(i, 1); return true; }
    }
    return false;
  }

  /* spawnBit — a SOLID piece in flight: a torn chunk (explosions only), a
     tooth, a skull fragment. Blood in the air is not a bit any more; it is
     THE AIRBORNE BLOOD's pool (airDrop / airMist / airStream). `kind` is
     kept in the signature for the callers, and is always "gib". */
  function spawnBit(x, y, z, vx, vy, vz, size, color, kind) {
    // Standing gibs are FADING debris now, not permanent evidence, so the pool
    // can be far smaller — a shootout can never leave a huge persistent pile.
    // With the debris law off (pre-pass revert) jail/survival keep the original
    // "true world" 520-gib budget.
    const city = debrisLaw();
    const real = realism();
    const cap = city ? (CBZ.qScale ? CBZ.qScale(45, 180) : 90) : (CBZ.qScale ? CBZ.qScale(260, 900) : 520);
    if (bits.length > cap) {
      // CITY gibs are fading debris: make room by recycling a far/old LANDED gib
      // instead of refusing to spawn the new piece.
      if (!(city && recycleFarGib())) return null;
    }
    const m = new THREE.Mesh(real ? chunk() : G_GIB, lambert(color));
    // gibs are lumpy with random proportions
    let hh = 0.06;
    if (city) {
      // rest-height: track the piece's half-Y so its BOTTOM rests on the road.
      const sy = size * (0.5 + Math.random());
      m.scale.set(size, sy, size * (0.7 + Math.random() * 0.6));
      hh = sy * 0.5;
    } else {
      m.scale.set(size, size * (0.5 + Math.random()), size * (0.7 + Math.random() * 0.6));
    }
    m.position.set(x, y, z); m.castShadow = false;
    scene().add(m);
    const rec = {
      m, vx, vy, vz, kind: "gib", mat: null,
      sx: (Math.random() - 0.5) * 18, sy: (Math.random() - 0.5) * 18, sz: (Math.random() - 0.5) * 18,
      landed: false, bled: false,
      baseScale: size, rad: hh,
      // sunk in water at spawn → the updater sinks it slowly with drag instead
      // of dropping it like a rock, and it blooms where it settles instead of
      // stamping a ground pool on the seabed. Always false on land.
      wet: wetEvent,
      // a landed chunk is short-lived debris that SHRINKS/SINKS to nothing (see
      // the updater) so the ground clears after combat.
      fade: city,
      // the coverage already down when this piece was thrown, + how much NEW
      // snow it takes to vanish under (see the SNOW BURIES BLOOD block)
      snow0: snowCover(), snowNeed: 0.26 + Math.random() * 0.24,
      life: city ? 5 + Math.random() * 4 : 7 + Math.random() * 6,
    };
    bits.push(rec);
    return rec;
  }

  // recycle the oldest pool that is FAR from the lens (never one underfoot).
  // With the debris law off, jail/survival keep the original drop-the-oldest shift.
  function recycleFarSplat() {
    if (!debrisLaw()) { freeSlick(splats.shift()); return; }
    for (let i = 0; i < splats.length; i++) {
      if (dist2Cam(splats[i].m.position.x, splats[i].m.position.z) > 50 * 50) { freeSlick(splats.splice(i, 1)[0]); return; }
    }
    freeSlick(splats.shift());
  }
  // ============================================================
  //  GROUND DECALS FOLLOW THE GROUND  (CBZ.CONFIG.GORE_SLOPE_DECALS, default on)
  //
  //  OWNER-FILMED, disaster island: "if you're on the mountain it shows FLATS
  //  that FLOAT." Every ground decal in this file was stamped with a hard
  //  `rotation.x = -PI/2` — a horizontal disc — and seated at floorAt(x,z).
  //  That is right on a street and WRONG on terrain: the survival island's
  //  refuge mountain is a 26 m cone over a 36 m radius (world/disaster_arena.js
  //  — about 36 degrees), so a 2 m pool laid flat on it hangs its uphill edge
  //  1.4 m in the air and buries the downhill edge in the hill. What you see is
  //  a red plate floating on the hillside, which is exactly the report.
  //
  //  The fix is geometric, not cosmetic: sample the LOCAL SURFACE NORMAL out of
  //  the same floorAt() field every body in the game already stands on, align
  //  the decal's plane to it, and seat it a few centimetres ALONG that normal.
  //  Flat ground gives n = (0,1,0), whose minimal rotation from the plane's
  //  local +Z is exactly the old `rotation.x = -PI/2` — so streets, roads, jail
  //  floors and the ocean slick are byte-identical, and only terrain changes.
  //
  //  And blood on a real slope does not pool: it RUNS. Past STEEP the disc is
  //  cut back and a downhill TRICKLE is drawn out of its low edge, reusing the
  //  run-over streak record, which already knows how to draw a growing smear.
  //
  //  COST: two extra floorAt() samples per decal SPAWN. The gradient is memoised
  //  on a 4 m grid for one frame — the droplet layer stamps ~20 splats per kill
  //  within a couple of metres of one another, so it is ~one sample per kill.
  //  The HEIGHT is never cached (it moves 3 m across one mountain cell); only
  //  the slowly-varying gradient is.
  // ============================================================
  if (CFG.GORE_SLOPE_DECALS == null) CFG.GORE_SLOPE_DECALS = true;
  function slopeOn() { return CBZ.CONFIG.GORE_SLOPE_DECALS !== false; }
  const STEEP = 0.42;              // rise/run past which blood runs instead of pooling
  const FLATISH = 0.025;           // below this the old flat path runs, untouched
  const SLOPE_CELL = 4;            // metres per memo cell
  const slopeMemo = new Map();
  const _V_Z = new THREE.Vector3(0, 0, 1);
  const _V_N = new THREE.Vector3();
  // dH/dx, dH/dz and the unit normal at (x,z). Forward differences — a decal
  // does not need a centred stencil, and the one-sided pair halves the cost.
  function groundGrad(x, z) {
    const key = (Math.floor(x / SLOPE_CELL) + 8192) * 65536 + (Math.floor(z / SLOPE_CELL) + 8192);
    let s = slopeMemo.get(key);
    if (s) return s;
    const e = 1.1, h0 = floorAt(x, z);
    let gx = (floorAt(x + e, z) - h0) / e, gz = (floorAt(x, z + e) - h0) / e;
    // a sinkhole lip / cliff edge is a CLIFF, not a slope: a wall-steep gradient
    // would tip the decal onto its side and read as a floating flag. Clamp the
    // fit to something a pool could plausibly cling to and let it lie flatter.
    if (!isFinite(gx)) gx = 0; if (!isFinite(gz)) gz = 0;
    const g2 = Math.hypot(gx, gz);
    if (g2 > 1.4) { gx *= 1.4 / g2; gz *= 1.4 / g2; }
    const inv = 1 / Math.sqrt(gx * gx + gz * gz + 1);
    s = { gx, gz, nx: -gx * inv, ny: inv, nz: -gz * inv, grade: Math.min(g2, 1.4) };
    if (slopeMemo.size < 96) slopeMemo.set(key, s);
    return s;
  }
  // lay a plane decal ON the surface at (x,z), spun by `spin` about its own
  // normal and lifted `lift` clear of it. `s` may be null → the original flat
  // stamp, byte for byte.
  function seatDecal(m, x, z, spin, lift, s) {
    if (!s || s.grade < FLATISH) {
      m.rotation.set(-Math.PI / 2, 0, spin);
      m.position.set(x, decalFloorAt(x, z) + lift, z);
      return;
    }
    m.quaternion.setFromUnitVectors(_V_Z, _V_N.set(s.nx, s.ny, s.nz));
    m.rotateZ(spin);                                     // local +Z is the normal now
    m.position.set(x + s.nx * lift, decalFloorAt(x, z) + s.ny * lift, z + s.nz * lift);
  }
  // A DECAL SEATS ON THE DRAWN GROUND, NOT ON THE WALKABLE FLOOR.
  //  floorAt() is 0 all across the flat city, but the city DRAWS its ground as
  //  a stack of slabs on top of that zero — roads at 0.040/0.065, the block
  //  sidewalk slab at 0.08, lot pads at 0.10 (city/world.js groundDecalY).
  //  A pool stamped at floorAt()+0.05 therefore cleared the asphalt and showed
  //  on the road, but sat 3 cm UNDER the sidewalk and was swallowed by it: land
  //  a fall from a tower on the kerb and you bled invisibly. Ask the city where
  //  its ground is actually drawn; every other mode still answers floorAt.
  //  NOTE the gradient in groundGrad() deliberately keeps sampling floorAt —
  //  the 2 cm slab steps are kerb edges, not slopes, and reading them as
  //  gradient would tip every pool at a block edge onto its side.
  function decalFloorAt(x, z) {
    const A = cityMode() && CBZ.city ? CBZ.city.arena : null;
    if (A && A.groundDecalY) { const v = +A.groundDecalY(x, z); if (isFinite(v)) return v; }
    return floorAt(x, z);
  }

  // the land decal budget (read live; the quality tier can move mid-run)
  function landCap() { return CBZ.qScale ? CBZ.qScale(85, 300) : 170; }
  // out of instance slots (walls + ground together): give up the oldest mark,
  // far ones first, and take its slot. Water slicks never hold a slot.
  function claimLand() {
    let c = ldAlloc();
    if (c) return c;
    let pick = -1;
    for (let i = 0; i < splats.length; i++) {
      const s = splats[i];
      if (s.slot == null || s.slot < 0) continue;
      if (pick < 0) pick = i;
      if (dist2Cam(s.m.position.x, s.m.position.z) > 50 * 50) { pick = i; break; }
    }
    if (pick >= 0) freeSlick(splats.splice(pick, 1)[0]);
    else if (walls.length) ldRelease(walls.shift());
    return ldAlloc();
  }
  // a mark's seat height: flush on a flat floor (polygonOffset does the rest);
  // on terrain a flat quad spans a curved hill, so it keeps the old clearance.
  function landLift(s) { return s && s.grade >= FLATISH ? 0.05 : 0.015; }

  /* spawnSplat(x, z, grow, color, linger, o) — one ground mark.
     `grow` is the mark's final RADIUS in metres (unchanged contract), `linger`
     a body's pool. o.kind picks the shape:
       "pool"  spreads from its middle over seconds and stops (default when linger)
       "splat" an impact splat, rays thrown toward o.dir (or all round, o.radial)
       "drop"  a droplet that landed at an angle: tail toward o.dir, stretched
               by o.elong (= 1 / sin(impact angle))
       "dot"   a droplet that fell straight down (default otherwise)
     `color` is ignored: the shade is the blood's age and depth, not the caller's. */
  function spawnSplat(x, z, grow, color, linger, o) {
    if (splats.length > landCap()) recycleFarSplat();
    o = o || NO_OPTS;
    const kind = o.kind || (linger ? "pool" : "dot");
    const s = slopeOn() ? groundGrad(x, z) : null;
    // a slope cannot hold a pool — the steeper it is, the less stays put (and
    // the rest leaves as the trickle below).
    const steep = !!(s && s.grade > STEEP);
    const g = steep ? grow * (0.42 + 0.28 * (STEEP / s.grade)) : grow;
    const c = claimLand();
    if (!c) return null;
    const m = c.m;
    const near = dist2Cam(x, z) < 24 * 24;
    const hasDir = o.dirX != null && (o.dirX || o.dirZ);
    let cell, sx, sy, spin = Math.random() * 6.28, growT, grow0, dryT, thick, thrEnd, hold, fade, rim;
    if (kind === "pool") {
      // the field's edge sits at ~0.58 of the half-quad, so the quad is 3.45x
      // the radius; satellites reach a little past it
      cell = CELL_POOL[(Math.random() * 2) | 0];
      sy = g * 3.45; sx = sy * (0.82 + Math.random() * 0.36);
      growT = linger ? 5 + g * 6 + Math.random() * 3 : 1.2 + g * 2;
      grow0 = linger ? 0.28 : 0.4;
      dryT = linger ? 26 + g * 26 : 14 + g * 20;
      thick = linger ? 1 : 0.8; thrEnd = 0.06 + Math.random() * 0.04;
      hold = linger ? (near ? 90 : 30) : (near ? 45 : 16); fade = linger ? 16 : 10; rim = 0.29;
    } else if (kind === "splat") {
      cell = o.radial || !hasDir ? CELL_SPLAT[1] : CELL_SPLAT[0];
      sx = sy = g * 4;
      if (hasDir) spin = Math.atan2(-o.dirX, -o.dirZ);   // rays run away from the wound
      growT = 0.16; grow0 = 0.25; dryT = 12 + g * 30; thick = 0.8; thrEnd = 0.07;
      hold = near ? 70 : 24; fade = 12; rim = 0.25;
    } else {
      // a droplet's mark, `2g` across; an angled one is longer than it is wide
      // by 1/sin(angle) and throws its tail the way it was going
      const drop = kind === "drop" && hasDir;
      cell = drop ? CELL_DROP : CELL_DOT;
      sx = (g * 2) / (drop ? 0.6 : 0.92);
      sy = sx * (drop ? Math.max(1, Math.min(3.4, o.elong || 1)) : 1);
      if (drop) spin = Math.atan2(-o.dirX, -o.dirZ);
      if (Math.random() < 0.5) sx = -sx;                   // mirror: satellites either side
      growT = 0.08; grow0 = 0.35; dryT = 5 + Math.random() * 5; thick = 0.55; thrEnd = 0.1;
      hold = near ? 40 : 14; fade = 8; rim = 0.2;
    }
    seatDecal(m, x, z, spin, landLift(s), s);
    m.scale.set(sx, sy, 1);
    ldWrite(c.slot, m, cell, 0, growT, dryT, grow0, thick, thrEnd, 1, 0);
    const rec = {
      m, slot: c.slot, land: kind, t: 0, grow: g, max: g, hold, fade, rim,
      // snow that falls FROM NOW buries it; a big pool takes more of it than a
      // droplet mark, and the jitter is what makes a field go under raggedly.
      snow0: snowCover(), snowNeed: 0.22 + Math.min(0.30, g * 0.12) + Math.random() * 0.22,
    };
    splats.push(rec);
    // THE RUN-OFF: what the hillside wouldn't hold leaves down the fall line.
    // The threshold is above every droplet mark and below every real pool, so
    // a body bleeding on a slope trails ONE streak instead of twenty.
    if (steep && grow > 0.9) {
      const dl = Math.hypot(s.gx, s.gz) || 1;
      spawnStreak(x, z, -s.gx / dl, -s.gz / dl, Math.min(5.5, grow * (0.9 + s.grade * 1.9)));
    }
    return rec;
  }
  // reused option records (no allocation per mark)
  const NO_OPTS = {}, _poolO = { kind: "pool" }, _dotO = { kind: "dot" };
  const _dropO = { kind: "drop", dirX: 0, dirZ: 0, elong: 1 };
  const _splatO = { kind: "splat", dirX: null, dirZ: null, radial: false };

  // a long blood smear dragged along a travel line (run-over kills, and the
  // downhill run-off above). It is laid at its final length and DRAWN by the
  // shader from the start (under the body) to the end over ~half a second,
  // thinning into striations the way a dragged pool does.
  function spawnStreak(x0, z0, dx, dz, len) {
    if (splats.length > landCap()) recycleFarSplat();
    const c = claimLand();
    if (!c) return null;
    const cx = x0 + dx * len * 0.5, cz = z0 + dz * len * 0.5;
    const s = slopeOn() ? groundGrad(cx, cz) : null;
    const w = 0.55 + Math.random() * 0.25;
    seatDecal(c.m, cx, cz, Math.atan2(-dx, -dz), landLift(s), s);   // local +y axis → world (dx,dz)
    c.m.scale.set(w / 0.85, len / 1.92, 1);
    ldWrite(c.slot, c.m, CELL_SMEAR, 0, 0.45, 30, 0, 0.85, 0.06, 1, 0);
    const near = dist2Cam(x0, z0) < 24 * 24;
    const rec = {
      m: c.m, slot: c.slot, land: "smear", streak: true, x0, z0, dx, dz, t: 0, grow: len, max: len,
      hold: near ? 60 : 28, fade: 14, rim: 0.45,
      snow0: snowCover(), snowNeed: 0.24 + Math.random() * 0.22,
    };
    splats.push(rec);
    return rec;
  }

  // is this collider's struck face SEE-THROUGH (intact glass pane / door vision
  // glass / water) rather than an opaque wall? The showroom-solid glass panes
  // push a collider whose .ref is the pane mesh on the shared transparent
  // glassMat — a blood plane on those would float on visible-through glass. A
  // genuine wall box is opaque. Cheap: one material flag read, no allocation.
  function isSeeThroughCol(c) {
    const r = c && c.ref;
    const mat = r && r.material;
    return !!(mat && mat.transparent && (mat.opacity == null || mat.opacity < 0.95));
  }

  // stamp a vertical blood decal on a wall/surface that sits just behind the
  // victim along the impact direction (dir points AWAY from shooter). Cheap:
  // a single AABB scan of CBZ.colliders, no raycaster, capped + distance-gated.
  // `instant` (headshot): the decal arrives pre-grown — the brain hits the wall
  // the same frame as the shot, it doesn't bloom politely afterwards.
  //
  // OWNER-FILMED FIX (floating splats): a raw nearest-face scan stamped blood on
  // ANYTHING — see-through glass curtain-walls, shot-open window holes, and tiny
  // hydrant/pole/sign colliders — so the red plane hung in mid-air on nothing
  // solid. A wall splat now requires a REAL, close, OPAQUE, WALL-SIZED solid
  // face: glass faces are skipped, an open/shattered window (cityShotHole) is
  // skipped (the bullet flew through a hole — keep scanning for a wall behind
  // it), and the struck face must span a true wall (>= MIN_FACE wide, tall
  // enough, with the splat seat inside the solid height band). No qualifying
  // opaque wall → NO splat (the wound decal + ground pool still convey the hit;
  // a missing splat beats a floating one).
  const MIN_FACE = 1.2;   // min in-plane horizontal face span for a "wall" (rejects hydrant/pole/meter/sign)
  const MIN_DOOR = 0.7;   // ...unless it is a door: door-high (>= 1.8 m, see wallFace) and at least this wide
  const MIN_WALL_H = 1.0; // min height of a height-gated band to count as wall (rejects low curbs/ledges)

  /* A BAND-LESS COLLIDER IS NOT A FULL-HEIGHT WALL — IT IS A PROP NOBODY GAVE
     A HEIGHT TO. (OWNER, filming the cell house: "look how blood shows on
     table as if there's an invisible wall.")

     He was reading the collider ledger correctly. physics.js's contract is
     that a collider with no y0/y1 blocks at EVERY height, and world/*.js is
     full of waist-high furniture drawn `{ solid: true }` with no band — a
     2.2 m mess table registers as a 2.2 m-wide box that reaches the ceiling.
     The gates above are written against `c.y1`, so on those records BOTH of
     them were skipped: the "is the splat seat inside the solid band" test and
     the MIN_WALL_H test. The scan then found a wall-sized opaque face 2.2 m
     across, and stamped a floor-to-head blood plane down the side of a table.
     That plane is the invisible wall made visible — the splat is drawn exactly
     where the collider says a wall is, and the collider is lying.

     So ask the thing that is actually drawn. `c.ref` is the Mesh addBox
     registered with the collider (world/materials.js:210), and its world
     bounds are the honest height of the prop. This is the same read
     systems/physics.js's `colliderVerticalBand` and city/buildings.js's
     `wallBandOf` already make for the same reason, and the same degrade: a
     collider with NO ref is anonymous, stays full-height, and behaves exactly
     as it did before.

     `visible` IS NOT CONSULTED, AND THAT IS THE ONE PLACE THIS DIVERGES FROM
     THE TWO PRIOR READS. Both of those bail on `ref.visible === false`,
     correctly for what they do — physics.js will not vault a prop that is not
     drawn. Here it would delete the fix outright: core/batch.js:495 merges the
     compound's static boxes into one buffer and sets EVERY original
     `visible = false`, keeping it in the graph purely as a raycast target. So
     in a batched prison almost every table's ref is invisible, and bailing
     would hand back "no band" — which is exactly the full-height lie this is
     here to stop. We are not asking whether the prop is drawn this frame, we
     are asking how tall it IS, and its geometry answers that either way.

     COST, AND WHY THERE IS NO CACHE. The derive runs only for a collider the
     ray actually HIT inside 3.4 m — the call site is placed AFTER the slab
     test, not before it — so a kill event pays for a handful of Box3 reads,
     during a frame that is already spawning thirty meshes. Memoising the
     answer onto the collider was the obvious optimisation and is the wrong
     one: CBZ.colliders is walked every frame by systems/physics.js, and
     stamping a new field onto a few records mid-run splits their hidden class
     and makes that loop pay for this one. Both prior readers (physics.js,
     buildings.js) recompute for the same reason; so does this. The shared Box3
     and the reused return record keep it allocation-free either way. */
  let splatBounds = null;
  const splatBand = { y0: 0, y1: 0 };
  function drawnBand(c) {
    const r = c.ref;
    if (!r || !(window.THREE && THREE.Box3)) return null;
    if (!splatBounds) splatBounds = new THREE.Box3();
    try {
      splatBounds.setFromObject(r);
      if ((splatBounds.isEmpty && splatBounds.isEmpty()) ||
          !isFinite(splatBounds.min.y) || !isFinite(splatBounds.max.y)) return null;
      splatBand.y0 = splatBounds.min.y; splatBand.y1 = splatBounds.max.y;
      return splatBand;
    } catch (e) { return null; }
  }
  // the three height gates, run against whichever band we have. Split out so
  // the declared-band path (free) and the derived path (a bounds read) cannot
  // drift apart — a table must fail the same test a window sill fails.
  function bandRejects(y0, y1, y) {
    if (y < y0 - 0.1 || y > y1 + 0.1) return true;   // splat seat outside the solid band
    if (y1 - y0 < MIN_WALL_H) return true;           // too short a band to be a wall (curb/ledge/table)
    if (y1 - y < 0.45) return true;                  // face too short above the splat seat
    return false;
  }
  /* wallFace(x,y,z, dx,dz, maxD) — the nearest REAL wall face ahead along
     (dx,dz): opaque, wall-sized, tall enough, the seat height inside its solid
     band, not a shot-open window. Shared by the kill's wall splat and the
     airborne spray (airWall), so both obey the one gate. Returns a reused
     record { c, t, face, y0, y1 } or null. */
  const _wf = { c: null, t: 0, face: null, y0: 0, y1: 0 };
  function wallFace(x, y, z, dx, dz, MAXD) {
    _vehNoted.length = 0;
    const cols = CBZ.colliders;
    if (!cols || !cols.length) return null;
    let best = null, bestT = MAXD, by0 = -1e9, by1 = 1e9;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i]; if (!c || c.minX == null) continue;
      // height-gated band: require the splat seat to land INSIDE the solid band
      // (tight slack), not in open air above/below a window band. DECLARED
      // bands are free to read, so they are tested here, before the ray.
      if (c.y1 != null && bandRejects(c.y0 || 0, c.y1, y)) continue;
      if (isSeeThroughCol(c)) continue;                      // intact glass pane / door vision — never a splat
      // ray (x,z)+t*(dx,dz) vs AABB slab — find nearest forward face hit
      let t0 = 0, t1 = bestT, face = null;
      if (Math.abs(dx) > 1e-4) {
        let ta = (c.minX - x) / dx, tb = (c.maxX - x) / dx, fa = dx > 0 ? "xmin" : "xmax";
        if (ta > tb) { const s = ta; ta = tb; tb = s; fa = fa === "xmin" ? "xmax" : "xmin"; }
        if (ta > t0) { t0 = ta; face = fa; } t1 = Math.min(t1, tb);
      } else if (x < c.minX || x > c.maxX) { continue; }
      if (Math.abs(dz) > 1e-4) {
        let ta = (c.minZ - z) / dz, tb = (c.maxZ - z) / dz, fa = dz > 0 ? "zmin" : "zmax";
        if (ta > tb) { const s = ta; ta = tb; tb = s; fa = fa === "zmin" ? "zmax" : "zmin"; }
        if (ta > t0) { t0 = ta; face = fa; } t1 = Math.min(t1, tb);
      } else if (z < c.minZ || z > c.maxZ) { continue; }
      if (!(face && t0 >= 0 && t0 <= t1 && t0 < bestT)) continue;
      // A VEHICLE'S COLLIDER IS A BOX ROUND THE CAR, NOT A WALL: blood on it
      // was a flat sheet standing in the air beside the doors. The car's own
      // meshes take it (vehicleSplat / vehicleSpray).
      if (c.ref) { const vr = vehicleRootOf(c.ref); if (vr) { noteVehicle(vr); continue; } }
      // WALL-SIZED face: the struck face spans the axis PERPENDICULAR to its
      // normal. A blood plane needs a real wall behind it, so require that span
      // (and enough height) — a thin hydrant/pole/meter/sign box never passes.
      const faceX = face === "xmin" || face === "xmax";
      const span = faceX ? (c.maxZ - c.minZ) : (c.maxX - c.minX);
      if (span < MIN_DOOR) continue;                         // thin prop, not a wall
      // NO DECLARED BAND: measure the thing that is drawn before believing it
      // is a wall. This is where the table gets thrown out — 2.2 m wide, and
      // 0.10 m tall. Placed after the slab test on purpose: the derive only
      // ever runs on a collider the ray already hit inside 3.4 m.
      let y0 = c.y1 != null ? (c.y0 || 0) : -1e9, y1 = c.y1 != null ? c.y1 : 1e9;
      if (c.y1 == null) {
        const band = drawnBand(c);
        if (band && bandRejects(band.y0, band.y1, y)) continue;
        if (band) { y0 = band.y0; y1 = band.y1; }
      }
      // a DOOR is narrower than a wall run (a 0.9 m leaf) but it is a full
      // door-height opaque face; before this the leaf was skipped and the
      // blood went through the closed door to whatever stood behind it
      if (span < MIN_FACE && !(y1 - y0 >= 1.8 && y1 - y0 < 50)) continue;
      // OPEN / SHATTERED WINDOW: the bullet flew through a hole — there is no
      // surface to splat. Skip and keep scanning for a real wall behind it.
      const hx = x + dx * t0, hz = z + dz * t0;
      const nx = face === "xmin" ? -1 : face === "xmax" ? 1 : 0;
      const nz = face === "zmin" ? -1 : face === "zmax" ? 1 : 0;
      if (CBZ.cityShotHole && CBZ.cityShotHole(hx, y, hz, nx, nz)) continue;
      bestT = t0; best = c; _wf.face = face; by0 = y0; by1 = y1;
    }
    if (!best) return null;
    _wf.c = best; _wf.t = bestT; _wf.y0 = by0; _wf.y1 = by1;
    return _wf;
  }
  function spawnWallSplat(x, y, z, dx, dz, amt, instant) {
    if (walls.length > 48) return;
    const best = wallFace(x, y, z, dx, dz, 3.4);
    // a car between the wound and the wall wears it, where the slug lands
    if (vehicleSplat(x, y, z, dx, 0.1, dz, best ? best.t : 3.4, amt, instant)) return;
    if (!best) return;
    const col = best.c;                                   // best is a reused record: hold the collider now
    const c = claimLand();
    if (!c) return;
    const hx = x + dx * best.t, hz = z + dz * best.t;
    let nx = 0, nz = 0;
    if (best.face === "xmin") { nx = -1; } else if (best.face === "xmax") { nx = 1; }
    else if (best.face === "zmin") { nz = -1; } else { nz = 1; }
    // 2 cm off the struck face: the collider box IS the drawn wall in the
    // prison (addBox registers both), polygonOffset wins the rest
    const off = 0.02, ry = nx ? (nx > 0 ? Math.PI / 2 : -Math.PI / 2) : (nz > 0 ? 0 : Math.PI);
    const m = c.m;
    const cy = y + 0.1 + Math.random() * 0.3;
    m.position.set(hx + nx * off, cy, hz + nz * off);
    m.rotation.set(0, ry, Math.random() * 6.28);
    // a wall is hit square-on, so the splat throws rays all round: a torn core
    // ~40 cm across for an ordinary kill, spatter out to a metre and more
    const g = (0.7 + amt * 0.7) * 0.55 * 0.55 * (0.85 + Math.random() * 0.3);
    const S = g * 4;
    m.scale.set(Math.random() < 0.5 ? -S : S, S, 1);
    ldWrite(c.slot, m, CELL_SPLAT[1], 1, instant ? 0.05 : 0.12, 20 + Math.random() * 15, instant ? 1 : 0.3, 0.85, 0.07, 1, 0);
    const near = dist2Cam(hx, hz) < 24 * 24;
    walls.push(anchorTo({ m, slot: c.slot, t: 0, hold: near ? 60 : 26, fade: 12 }, col));
    // the heavy part runs: 1-3 drips out of the core, each crawling down at a
    // few cm a second and stopping where the blood runs out
    const drips = Math.min(3, 1 + Math.round(amt));
    const core = S * 0.18;
    for (let d = 0; d < drips; d++) {
      const dc = claimLand();
      if (!dc) break;
      const dm = dc.m;
      const L = 0.2 + Math.random() * 0.6, wd = 0.03 + Math.random() * 0.03;
      const along = (Math.random() - 0.5) * core * 2;
      const top = cy - Math.random() * core * 0.6;
      dm.position.set(hx + nx * (off + 0.002) + (nx ? 0 : along), top - L * 0.5, hz + nz * (off + 0.002) + (nx ? along : 0));
      dm.rotation.set(0, ry, 0);                          // local +y is world up: it runs DOWN
      dm.scale.set(wd / 0.42, L / 1.92, 1);
      ldWrite(dc.slot, dm, CELL_DRIP, 1, L / (0.06 + Math.random() * 0.1), 18 + Math.random() * 10, 0, 0.9, 0.05, 1,
        (instant ? 0.1 : 0.25) + Math.random() * 0.5);
      walls.push(anchorTo({ m: dm, slot: dc.slot, t: 0, hold: near ? 60 : 26, fade: 12 }, col));
    }
  }

  /* ============================================================
     BLOOD ON A VEHICLE LIES ON THE BODY. (OWNER: "BLOOD SPLATTERS ONTO
     VEHICLES LOOK FAKE AS FUCK. THEY TREAT THE VEHICLE AS FLAT SO
     FLOATING, BAD PHYSICS AGAIN.")

     ROOT CAUSE. Nothing in this file knew a car was a car. The only way blood
     reached one was wallFace(): an AABB scan of CBZ.colliders, which for a
     vehicle holds a BOX ROUND THE CAR (police.js's roadblock cruisers are a
     4 x 4 m square on a 1.9 x 4.7 m car; parked hardware a footprint box).
     The splat was a flat vertical quad on that box's face, at a guessed
     height (`y + 0.1..0.4`): 0.6-1.1 m clear of the doors and the bonnet,
     standing upright in the air beside the car — and on a curved panel even
     a quad seated at the right point leaves its edges hanging off the curve.
     Every other car (traffic, parked, the player's) had no collider at all,
     so a spray toward one went THROUGH it to the wall or the road behind.

     WHAT IT IS NOW.
       * The line the blood actually travels (the shot line as a ballistic
         arc under AIR_G, the run-over's contact) is RAYCAST against the
         vehicle's drawn meshes (merged buckets, baked shut doors, glass,
         wheels; never an occupant or another decal). A collider whose ref is
         a vehicle is no longer a wall: wallFace hands it here instead.
       * The mark is a PROJECTED DECAL (systems/surfacedecal.js): the host
         mesh's own triangles inside a box at the hit, clipped to it, so it
         lies on the hood's curve, wraps the fender, follows the windscreen's
         rake. Lift 1.5 mm along the interpolated normal + polygonOffset.
       * Each piece is a child of the mesh it was cut from, so it rides the
         car, swings with a door (a shut door is a baked merge: the live leaf,
         parked off the graph, gets its own piece in its shut pose, so the
         blood is on the leaf the moment it opens), and REFITS when
         crashdeform dents the host (barycentric re-evaluation, no new
         projection).
       * Paint: the floor layer's multiply filter, so the paint's own
         clearcoat and lighting come through. Glass: a thin translucent film
         that runs DOWN the pane (a shader smear along the projected gravity),
         drawn after the glass.
       * Rain washes it, speed thins it. Per car cap 5, global cap rides the
         quality tier (10 phone .. 36), pooled meshes, materials and buffers.
  ============================================================ */
  const VD_PER_CAR = 5;
  function vdCap() { return Math.round(CBZ.qScale ? CBZ.qScale(10, 36) : 24); }
  const VD_OFF = 0.0015;            // lift along the surface normal (m)
  const VD_IN = 0.16, VD_OUT = 0.06; // the projector reaches this far under / over the hit
  const vehRecs = [];
  const VD_TIME = { value: 0 };     // one clock uniform object shared by every piece
  const VD_AUDIT = { stamps: 0, pieces: 0, glass: 0, refits: 0, misses: 0, released: 0 };

  function isVehicleRoot(o) {
    const u = o && o.userData;
    return !!(u && (u.carVisual || u.bodyKind || u.milKind || u.aircraftDims));
  }
  function vehicleRootOf(o) {
    for (let k = 0; o && k < 8; k++, o = o.parent) if (isVehicleRoot(o)) return o;
    return null;
  }
  // the car record behind a root (cityCars), for wake/speed
  function carOfRoot(root) {
    const L = CBZ.cityCars;
    if (L) for (let i = 0; i < L.length; i++) if (L[i] && L[i].group === root) return L[i];
    return null;
  }
  // root-local bounds, measured once per root (a car never changes size)
  const vehBoundsMemo = new WeakMap();
  const _vb = new THREE.Box3(), _vbm = new THREE.Matrix4(), _vbi = new THREE.Matrix4();
  function vehBounds(root) {
    let b = vehBoundsMemo.get(root);
    if (b) return b;
    root.updateWorldMatrix(true, true);
    _vbi.copy(root.matrixWorld).invert();
    const box = new THREE.Box3();
    vehMeshes(root, _vbList, false);
    for (let i = 0; i < _vbList.length; i++) {
      const m = _vbList[i], g = m.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      if (!g.boundingBox) continue;
      _vbm.multiplyMatrices(_vbi, m.matrixWorld);
      _vb.copy(g.boundingBox).applyMatrix4(_vbm);
      box.union(_vb);
    }
    _vbList.length = 0;
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -2.5), new THREE.Vector3(1, 1.6, 2.5));
    const c = box.getCenter(new THREE.Vector3());
    b = { min: box.min.clone(), max: box.max.clone(), c, r: box.getSize(new THREE.Vector3()).length() * 0.5 };
    vehBoundsMemo.set(root, b);
    return b;
  }
  const _vbList = [];
  // the meshes blood can land on: drawn (below the root: a proxied car's
  // group is hidden while its instances draw it), not a body, not a decal
  function vehMeshes(root, out, visOnly) {
    out.length = 0;
    (function walk(o, top) {
      if (!top && visOnly !== false && o.visible === false) return;
      const u = o.userData;
      if (u && (u.occupant || u.goreDecal || u.charRig || u.pilot)) return;
      if (o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && o.geometry && o.geometry.attributes &&
          o.geometry.attributes.position && o.material && !Array.isArray(o.material) && o.material.visible !== false) out.push(o);
      const ch = o.children;
      for (let i = 0; i < ch.length; i++) walk(ch[i], false);
    })(root, true);
    return out;
  }

  // ---- which vehicles are near a line ----------------------------------------
  const _vehNoted = [];             // wallFace drops vehicle colliders here
  function noteVehicle(root) { if (_vehNoted.indexOf(root) < 0 && _vehNoted.length < 8) _vehNoted.push(root); }
  const _vehCand = [];
  const _vc = new THREE.Vector3();
  function vehicleCandidates(x, y, z, dx, dy, dz, len) {
    _vehCand.length = 0;
    for (let i = 0; i < _vehNoted.length; i++) _vehCand.push(_vehNoted[i]);
    const L = CBZ.cityCars;
    if (L) {
      const mx = x + dx * len * 0.5, mz = z + dz * len * 0.5, reach = len * 0.5 + 9;
      for (let i = 0; i < L.length && _vehCand.length < 8; i++) {
        const c = L[i], g = c && c.group;
        if (!g || !g.parent || c._sleep) continue;
        const ex = g.position.x - mx, ez = g.position.z - mz;
        if (ex * ex + ez * ez > reach * reach) continue;      // world-space prefilter (cars sit on the root)
        if (_vehCand.indexOf(g) < 0) _vehCand.push(g);
      }
    }
    // the honest test: the line against each car's own bounding sphere
    let n = 0;
    for (let i = 0; i < _vehCand.length; i++) {
      const g = _vehCand[i], b = vehBounds(g);
      g.updateWorldMatrix(true, false);
      _vc.copy(b.c).applyMatrix4(g.matrixWorld);
      const px = _vc.x - x, py = _vc.y - y, pz = _vc.z - z;
      let t = px * dx + py * dy + pz * dz; t = t < 0 ? 0 : (t > len ? len : t);
      const qx = px - dx * t, qy = py - dy * t, qz = pz - dz * t;
      if (qx * qx + qy * qy + qz * qz <= (b.r + 0.6) * (b.r + 0.6)) _vehCand[n++] = g;
    }
    _vehCand.length = n;
    return _vehCand;
  }

  // ---- the ray --------------------------------------------------------------
  const _vRay = new THREE.Raycaster();
  const _vHits = [], _vMeshes = [], _vRoots = [], _vTmp = [];
  const _vO = new THREE.Vector3(), _vD = new THREE.Vector3(), _vN3 = new THREE.Matrix3();
  const VH = { root: null, mesh: null, p: new THREE.Vector3(), n: new THREE.Vector3(), d: 0, glass: false };
  // the drawn meshes of these roots, world matrices fresh: once per event,
  // not once per chord of the arc
  function gatherMeshes(roots) {
    _vMeshes.length = 0; _vRoots.length = 0;
    for (let r = 0; r < roots.length; r++) {
      roots[r].updateWorldMatrix(true, true);
      vehMeshes(roots[r], _vTmp, true);
      for (let i = 0; i < _vTmp.length; i++) { _vMeshes.push(_vTmp[i]); _vRoots.push(roots[r]); }
    }
    _vTmp.length = 0;
  }
  // nearest drawn vehicle surface on (o, dir) within len, over the gathered
  // meshes. dir unit. -> VH | null
  function vehicleRay(ox, oy, oz, dx, dy, dz, len) {
    let best = null, bestD = len;
    _vO.set(ox, oy, oz); _vD.set(dx, dy, dz);
    _vRay.set(_vO, _vD); _vRay.near = 0; _vRay.far = len;
    if (CBZ.camera) _vRay.camera = CBZ.camera;
    for (let i = 0; i < _vMeshes.length; i++) {
      const m = _vMeshes[i];
      _vHits.length = 0;
      try { m.raycast(_vRay, _vHits); } catch (e) { continue; }
      for (let k = 0; k < _vHits.length; k++) {
        const h = _vHits[k];
        if (h.distance >= bestD || !h.face) continue;
        bestD = h.distance; best = h; VH.root = _vRoots[i]; VH.mesh = m;
      }
    }
    _vHits.length = 0;
    if (!best) return null;
    VH.p.copy(best.point); VH.d = bestD;
    _vN3.getNormalMatrix(VH.mesh.matrixWorld);
    VH.n.copy(best.face.normal).applyMatrix3(_vN3).normalize();
    if (VH.n.dot(_vD) > 0) VH.n.negate();                   // the side the blood came from
    VH.glass = vehGlass(VH.mesh);
    return VH;
  }
  // the blood's real path: a slug thrown at `sp` along (dx,dy,dz), falling
  // under AIR_G, marched in short chords. -> VH (with VH.t flight seconds) | null
  function vehicleArc(x, y, z, dx, dy, dz, sp, reach, roots) {
    if (!roots.length) return null;
    gatherMeshes(roots);
    let px = x, py = y, pz = z, vx = dx * sp, vy = dy * sp, vz = dz * sp, run = 0, t = 0;
    const DT = 0.035;
    for (let s = 0; s < 24 && run < reach; s++) {
      const nx = px + vx * DT, ny = py + vy * DT - 0.5 * AIR_G * DT * DT, nz = pz + vz * DT;
      const sx = nx - px, sy = ny - py, sz = nz - pz, sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1e-6;
      const h = vehicleRay(px, py, pz, sx / sl, sy / sl, sz / sl, sl);
      if (h) { h.t = t + DT * (h.d / sl); h.run = run + Math.hypot(sx, sz) * (h.d / sl); _vMeshes.length = 0; _vRoots.length = 0; return h; }
      run += Math.hypot(sx, sz); t += DT;
      vy -= AIR_G * DT; px = nx; py = ny; pz = nz;
      if (py < -0.5) break;
    }
    _vMeshes.length = 0; _vRoots.length = 0;   // never pin a car that later leaves the world
    return null;
  }
  function vehGlass(m) {
    const mat = m && m.material;
    if (!mat) return false;
    if (m.userData && m.userData.carGlass) return true;
    if (mat._bodyPaint || mat._playerCarOwned) return false;
    if (mat.transmission > 0) return true;
    return !!(mat.transparent && (mat.opacity == null || mat.opacity < 0.95));
  }

  // ---- the decal pieces: pooled mesh + geometry + material per look ----------
  const VD_VS = [
    "uniform vec4 uCell; uniform vec4 uT; uniform vec4 uFx;",
    "uniform vec3 uTx; uniform vec3 uTy; uniform float uTime;",
    "varying vec2 vUv; varying vec4 vS;",
    "varying vec3 vN; varying vec3 vTx; varying vec3 vTy; varying vec3 vView;",
    "void main() {",
    "  vUv = uCell.xy + vec2(" + LD_CELL_W.toFixed(4) + ", " + LD_CELL_H.toFixed(4) + ") * uv;",
    "  float age = max(0.0, uTime - uT.x);",
    "  float g = uT.y > 0.0 ? clamp(age / uT.y, 0.0, 1.0) : 1.0;",
    "  g = uT.w + (1.0 - uT.w) * (1.0 - pow(1.0 - g, 2.2));",
    "  vS = vec4(mix(1.0, uFx.w, g) + uFx.z, clamp(age / uT.z, 0.0, 1.0), uFx.x, uFx.y);",
    "  if (uTime < uT.x) vS.x = 2.0;",                  // still in the air: nothing on the panel yet
    "  mat3 m3 = mat3(modelMatrix);",
    "  vN = normalize(m3 * normal); vTx = normalize(m3 * uTx); vTy = normalize(m3 * uTy);",
    "  vec4 wp = modelMatrix * vec4(position, 1.0);",
    "  vView = cameraPosition - wp.xyz;",
    "  gl_Position = projectionMatrix * viewMatrix * wp;",
    "}",
  ].join("\n");
  // GLASS: a thin film you see the cabin through, run down the pane. The
  // field is smeared along the pane's projected gravity (uDown, in cell uv),
  // every tap clamped inside this cell so nothing bleeds in from the atlas.
  const VD_FS_GLASS = [
    "uniform sampler2D uMap; uniform vec4 uCell; uniform vec2 uDown;",
    "varying vec2 vUv; varying vec4 vS;",
    "varying vec3 vN; varying vec3 vTx; varying vec3 vTy; varying vec3 vView;",
    "float tap(vec2 q) { return texture2D(uMap, clamp(q, uCell.xy, uCell.xy + uCell.zw)).r; }",
    "void main() {",
    "  vec4 t = texture2D(uMap, vUv);",
    "  vec2 st = uDown * uCell.zw * 0.075;",
    "  float f = max(t.r, max(tap(vUv - st) * 0.85, max(tap(vUv - st * 2.0) * 0.68, tap(vUv - st * 3.3) * 0.48)));",
    "  float thr = vS.x;",
    "  float c = smoothstep(thr, thr + 0.03, f) * vS.z;",
    "  float dist = length(vView);",
    "  c *= 1.0 - smoothstep(48.0, 72.0, dist);",
    "  if (c < 0.004) discard;",
    "  float depth = clamp((f - thr) / 0.32, 0.0, 1.0);",
    "  float body = clamp(depth * vS.w * (0.6 + 0.5 * t.g), 0.0, 1.0) * 0.6;",
    "  float dry = clamp(vS.y * (1.4 - depth * 0.6), 0.0, 1.0);",
    "  vec3 fresh = mix(vec3(0.46, 0.035, 0.03), vec3(0.28, 0.012, 0.01), body);",
    "  vec3 dried = mix(vec3(0.30, 0.075, 0.045), vec3(0.17, 0.04, 0.025), body);",
    "  vec3 F = mix(fresh, dried, dry);",
    "  float wet = (1.0 - dry) * (1.0 - dry);",
    "  vec3 V = normalize(vView);",
    "  vec3 N = dot(vN, V) < 0.0 ? -vN : vN;",
    "  float spec = smoothstep(0.35, 0.6, pow(max(dot(N, normalize(normalize(vec3(0.3, 1.0, 0.22)) + V)), 0.0), 40.0));",
    "  F = mix(F, vec3(0.9, 0.85, 0.85), clamp(wet * spec * 0.5, 0.0, 0.5));",
    "  gl_FragColor = vec4(F, c * (0.34 + 0.46 * body + wet * spec * 0.2));",
    "}",
  ].join("\n");
  const vdFree = { paint: [], glass: [] };
  function vdMaterial(glass) {
    const u = {
      uMap: { value: landAtlas() }, uTime: VD_TIME,
      uCell: { value: new THREE.Vector4() }, uT: { value: new THREE.Vector4() }, uFx: { value: new THREE.Vector4() },
      uTx: { value: new THREE.Vector3(1, 0, 0) }, uTy: { value: new THREE.Vector3(0, 1, 0) },
      uDown: { value: new THREE.Vector2(0, -1) },
    };
    const o = {
      uniforms: u, vertexShader: VD_VS, fragmentShader: glass ? VD_FS_GLASS : LD_FS,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.FrontSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      fog: false, lights: false,
    };
    if (!glass) {
      // the floor's 2x multiply: the paint's own clearcoat and light come through
      o.blending = THREE.CustomBlending; o.blendEquation = THREE.AddEquation;
      o.blendSrc = THREE.DstColorFactor; o.blendDst = THREE.SrcColorFactor;
      o.blendSrcAlpha = THREE.ZeroFactor; o.blendDstAlpha = THREE.OneFactor;
    }
    const m = new THREE.ShaderMaterial(o);
    m._shared = true;                 // a car being scrapped must not dispose a pooled piece's material
    return m;
  }
  function vdPiece(glass) {
    const L = glass ? vdFree.glass : vdFree.paint;
    let p = L.pop();
    if (!p) {
      const geo = new THREE.BufferGeometry();
      const mesh = new THREE.Mesh(geo, vdMaterial(glass));
      mesh.matrixAutoUpdate = false;  // the geometry is in the host's own space: identity
      mesh.raycast = function () {};  // a stain is never a surface
      mesh.castShadow = mesh.receiveShadow = false;
      mesh.userData.goreDecal = true; // crashdeform / carinstances / the blood's own ray skip it
      mesh.name = glass ? "gore-car-glass" : "gore-car-paint";
      p = { mesh, geo, glass, host: null, d: null, srcGeo: null, ver: -1, pos: null, nrm: null, off: VD_OFF };
    }
    return p;
  }
  function vdRelease(p) {
    if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
    p.host = null; p.d = null; p.srcGeo = null;
    (p.glass ? vdFree.glass : vdFree.paint).push(p);
  }
  function vdFit(p) {
    const ok = CBZ.surfaceDecal.refit(p.d, p.host.geometry, p.off, p.pos, p.nrm);
    p.srcGeo = p.host.geometry;
    p.ver = p.srcGeo.attributes.position.version;
    if (!ok) return false;
    p.geo.attributes.position.needsUpdate = true;
    p.geo.attributes.normal.needsUpdate = true;
    p.geo.computeBoundingSphere();
    return true;
  }

  // ---- stamping -------------------------------------------------------------
  const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
  const _bW = new THREE.Matrix4(), _bWi = new THREE.Matrix4(), _toBox = new THREE.Matrix4(), _hW = new THREE.Matrix4();
  const _hWi = new THREE.Matrix4(), _vt = new THREE.Vector3(), _bs = new THREE.Sphere();
  const _tgt = [], _tgtW = [];
  /* vehicleStamp(hit, sx, sy, cell, o) — a decal sx x sy metres on the body at
     hit.p, facing hit.n. o: { tx,ty,tz travel dir (the cell's +v runs along
     it; else spun at random), growT, dryT, grow0, thick, thrEnd, delay } */
  function vehicleStamp(hit, sx, sy, cell, o) {
    const SD = CBZ.surfaceDecal;
    if (!SD || !hit) return null;
    o = o || NO_OPTS;
    const root = hit.root;
    // budgets: this car's oldest mark, then the oldest anywhere, give way
    let mine = 0, oldest = -1;
    for (let i = 0; i < vehRecs.length; i++) if (vehRecs[i].root === root) { mine++; if (oldest < 0) oldest = i; }
    if (mine >= VD_PER_CAR && oldest >= 0) vdDrop(oldest);
    while (vehRecs.length >= vdCap()) vdDrop(0);
    // the projector: z out of the panel, y along the blood's travel in the panel
    _bz.copy(hit.n);
    let have = false;
    if (o.tx != null) {
      _by.set(o.tx, o.ty || 0, o.tz || 0);
      _by.addScaledVector(_bz, -_by.dot(_bz));
      have = _by.lengthSq() > 1e-4;
    }
    if (!have) {
      _by.set(0, 1, 0).addScaledVector(_bz, -_bz.y);
      if (_by.lengthSq() < 1e-4) _by.set(1, 0, 0).addScaledVector(_bz, -_bz.x);
      _by.normalize().applyAxisAngle(_bz, Math.random() * 6.2832);
    }
    _by.normalize();
    _bx.crossVectors(_by, _bz).normalize();
    const depth = VD_IN + VD_OUT;
    _vt.copy(hit.p).addScaledVector(_bz, (VD_OUT - VD_IN) * 0.5);
    _bW.makeBasis(_bx.clone().multiplyScalar(sx), _by.clone().multiplyScalar(sy), _bz.clone().multiplyScalar(depth));
    _bW.setPosition(_vt);
    _bWi.copy(_bW).invert();
    const bR = 0.5 * Math.sqrt(sx * sx + sy * sy + depth * depth);

    // WHAT IT IS CUT OUT OF: every drawn mesh of this vehicle, plus each door
    // leaf parked off the graph (vehicles.js bakeShutDoors), posed shut — so
    // the blood is already on the leaf when the door swings open
    root.updateWorldMatrix(true, true);
    vehMeshes(root, _tgt, true);
    _tgtW.length = 0;
    for (let i = 0; i < _tgt.length; i++) _tgtW.push(_tgt[i].matrixWorld);
    const vis = (root.userData && root.userData.carVisual) || root;
    const rig = vis._cbzDoorRig || root._cbzDoorRig;
    if (rig && rig.doors && !rig.split) {
      for (let di = 0; di < rig.doors.length; di++) {
        const g = rig.doors[di];
        if (g.parent) continue;
        g.updateMatrix();
        for (let k = 0; k < g.children.length; k++) {
          const m = g.children[k];
          if (!m.isMesh || !m.geometry || !m.geometry.attributes || !m.geometry.attributes.position) continue;
          m.updateMatrix();
          _tgt.push(m);
          _tgtW.push(new THREE.Matrix4().multiplyMatrices(vis.matrixWorld, g.matrix).multiply(m.matrix));
        }
      }
    }
    const rec = { root, car: carOfRoot(root), pieces: [], t: 0, hold: o.hold || 75, fade: 14, wash: 0, glass: false };
    const now = ldClock + (o.delay || 0);
    for (let i = 0; i < _tgt.length; i++) {
      const host = _tgt[i], W = _tgtW[i], geo = host.geometry;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      if (geo.boundingSphere) {
        _bs.copy(geo.boundingSphere).applyMatrix4(W);
        if (_bs.center.distanceTo(_vt) > _bs.radius + bR) continue;
      }
      _toBox.multiplyMatrices(_bWi, W);
      const d = SD.project(geo, _toBox.elements, { minFacing: 0.05, maxTris: 900 });
      if (!d) continue;
      const glass = vehGlass(host);
      const p = vdPiece(glass);
      p.host = host; p.d = d;
      p.off = VD_OFF / Math.max(1e-4, W.getMaxScaleOnAxis());   // the lift is metres in the WORLD
      p.pos = new Float32Array(d.n * 3); p.nrm = new Float32Array(d.n * 3);
      p.geo.dispose();                 // frees the last owner's GPU buffers before the swap
      p.geo.setAttribute("position", new THREE.BufferAttribute(p.pos, 3));
      p.geo.setAttribute("normal", new THREE.BufferAttribute(p.nrm, 3));
      p.geo.setAttribute("uv", new THREE.BufferAttribute(d.uv, 2));
      if (!vdFit(p)) { vdRelease(p); continue; }
      // the shader's tangent frame and the pane's down, in the host's space
      _hWi.copy(W).invert();
      const U = p.mesh.material.uniforms;
      U.uTx.value.copy(_bx).transformDirection(_hWi);
      U.uTy.value.copy(_by).transformDirection(_hWi);
      U.uCell.value.set(cell[0] * LD_CELL_W, 1 - (cell[1] + 1) * LD_CELL_H, LD_CELL_W, LD_CELL_H);
      U.uT.value.set(now, o.growT != null ? o.growT : 0.14, Math.max(0.5, o.dryT || 22), o.grow0 != null ? o.grow0 : 0.3);
      U.uFx.value.set(1, glass ? 0.6 : (o.thick || 0.85), 0, o.thrEnd || 0.07);
      // gravity in the box's uv: blood runs down the pane
      const gx = -_bx.y, gy = -_by.y, gl = Math.hypot(gx, gy);
      U.uDown.value.set(gl > 0.05 ? gx / gl : 0, gl > 0.05 ? gy / gl : -1);
      p.mesh.renderOrder = (host.renderOrder | 0) + 1;
      host.add(p.mesh);
      rec.pieces.push(p);
      if (glass) { rec.glass = true; VD_AUDIT.glass++; }
      VD_AUDIT.pieces++;
    }
    _tgt.length = 0; _tgtW.length = 0;
    if (!rec.pieces.length) { VD_AUDIT.misses++; return null; }
    // a proxied car is drawn by carinstances' pools, which cannot draw a
    // ShaderMaterial: wake it (it then declines to re-proxy while it wears blood)
    if (rec.car && rec.car._proxy && CBZ.cityWakeCar) CBZ.cityWakeCar(rec.car);
    VD_AUDIT.stamps++;
    vehRecs.push(rec);
    return rec;
  }
  function vdDrop(i) {
    const r = vehRecs[i];
    for (let k = 0; k < r.pieces.length; k++) vdRelease(r.pieces[k]);
    vehRecs.splice(i, 1);
    VD_AUDIT.released++;
  }
  // per frame: follow dents, fade, wash, let go of cars that left the world
  function updateVehicleBlood(dt) {
    VD_TIME.value = ldClock;
    const W = CBZ.weather;
    const rain = W && W.raining ? Math.max(0, (W.intensity || 0) * (1 - (W.snow || 0))) : 0;
    for (let i = vehRecs.length - 1; i >= 0; i--) {
      const r = vehRecs[i];
      r.t += dt;
      if (refShown(r.root) < 0) { vdDrop(i); continue; }
      // RAIN rinses a car (a few tens of seconds in a downpour); SPEED thins
      // a wet film off the paint, never what has already dried on
      const c = r.car;
      const sp = c ? Math.max(Math.abs(c.v || 0), Math.hypot(c.vx || 0, c.vz || 0)) : 0;
      r.wash = Math.min(1, r.wash + dt * (rain * 0.035 + (r.t < 25 ? Math.max(0, sp - 12) * 0.0025 : 0)));
      const fadeOut = r.t > r.hold ? Math.max(0, 1 - (r.t - r.hold) / r.fade) : 1;
      const a = fadeOut * (1 - r.wash);
      if (a <= 0.003) { vdDrop(i); continue; }
      for (let k = 0; k < r.pieces.length; k++) {
        const p = r.pieces[k], h = p.host;
        // a dent (crashdeform displaces in place, or swaps a same-layout clone):
        // put the blood back on the new surface. A far LOD twin has another
        // layout: refit refuses it and the mark keeps its last fit.
        const g = h.geometry, pa = g && g.attributes && g.attributes.position;
        if (pa && (g !== p.srcGeo || pa.version !== p.ver)) { vdFit(p); VD_AUDIT.refits++; }
        p.mesh.material.uniforms.uFx.value.x = a;
      }
    }
  }

  /* vehicleSplat — a kill's / a hard impact's heavy slug toward (dx,dy,dz)
     reaching a vehicle before maxT (the wall wallFace found, if any). True
     when it landed on one. */
  function vehicleSplat(x, y, z, dx, dy, dz, maxT, amt, instant) {
    if (!CBZ.surfaceDecal) return false;
    const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    const reach = Math.min(3.4, maxT);
    const roots = vehicleCandidates(x, y, z, dx, dy, dz, reach + 0.5);
    const h = vehicleArc(x, y, z, dx, dy, dz, 7, reach, roots);
    if (!h || h.run > maxT) return false;
    const g = (0.7 + amt * 0.7) * 0.55 * 0.55 * (0.85 + Math.random() * 0.3);
    const S = g * 4 * 0.85;
    vehicleStamp(h, S, S, CELL_SPLAT[0], {
      tx: dx, ty: dy, tz: dz, growT: instant ? 0.05 : 0.12, grow0: instant ? 1 : 0.3,
      dryT: 20 + Math.random() * 15, delay: h.t,
    });
    return true;
  }
  /* RUN OVER: the body meets the car's nose (or tail, reversing) at the
     bumper, and at speed folds onto the bonnet and into the windscreen.
     Rays come in from outside the car at the victim's side offset, so they
     hit the panels he actually hit. */
  function runOverBlood(car, x, y, z, amt) {
    const g = car && car.group;
    if (!g || !g.parent || !CBZ.surfaceDecal) return;
    const b = vehBounds(g);
    const h0 = car.heading != null ? car.heading : g.rotation.y;
    let fx = Math.sin(h0), fz = Math.cos(h0);
    // which end met him
    const rx = x - g.position.x, rz = z - g.position.z;
    if (rx * fx + rz * fz < 0) { fx = -fx; fz = -fz; }
    const lx = fz, lz = -fx;                            // across the car
    const half = Math.max(1.6, Math.max(Math.abs(b.min.z), Math.abs(b.max.z)));
    const halfW = Math.max(0.6, (b.max.x - b.min.x) * 0.5);
    let side = rx * lx + rz * lz;
    side = Math.max(-halfW * 0.8, Math.min(halfW * 0.8, side));
    const ox = g.position.x + fx * (half + 1.2) + lx * side, oz = g.position.z + fz * (half + 1.2) + lz * side;
    const base = g.position.y;
    gatherMeshes([g]);
    const spd = Math.max(Math.abs(car.v || 0), Math.hypot(car.vx || 0, car.vz || 0));
    // the bumper / grille at the knee-to-hip line
    let h = vehicleRay(ox, base + 0.62, oz, -fx, 0, -fz, half + 2.5);
    if (h) vehicleStamp(h, 0.55 + amt * 0.2, 0.55 + amt * 0.2, CELL_SPLAT[1], { growT: 0.1, grow0: 0.5, dryT: 24 });
    // the body folds onto the bonnet and the head meets the screen: a ray
    // dropping in from above the nose toward the cabin
    if (spd > 9) {
      const dl = Math.hypot(1, 0.75);
      h = vehicleRay(ox + fx * 0.4, base + 2.4, oz + fz * 0.4, -fx / dl, -0.75 / dl, -fz / dl, half + 4);
      if (h) vehicleStamp(h, 0.5 + amt * 0.25, 0.85 + amt * 0.3, CELL_SPLAT[0], { tx: -fx, ty: 0, tz: -fz, growT: 0.08, grow0: 0.6, dryT: 26 });
    }
    _vMeshes.length = 0; _vRoots.length = 0;
  }
  /* WHERE HE ACTUALLY HIT IT (city/carstrike.js). The strike knows the
     contact: the point on the panel and the direction INTO the car. A short
     ray from just outside along that line finds the real triangle (bumper,
     bonnet, screen glass, roof) and the mark is laid there, sized to what
     hit it. runOverBlood's three guessed rays stay for a body that got no
     full strike. */
  CBZ.goreCarStrike = function (car, x, y, z, dx, dy, dz, amt) {
    const g = car && car.group;
    if (!g || !g.parent || !CBZ.surfaceDecal) return false;
    const l = Math.hypot(dx, dy, dz);
    if (!(l > 1e-6)) return false;
    dx /= l; dy /= l; dz /= l;
    gatherMeshes([g]);
    const h = vehicleRay(x - dx * 0.45, y - dy * 0.45, z - dz * 0.45, dx, dy, dz, 1.1);
    let ok = false;
    if (h) {
      const a = Math.max(0.2, Math.min(1.2, amt || 0.7));
      const S = 0.4 + a * 0.35;
      vehicleStamp(h, S, S * (dy < -0.5 ? 1.25 : 1), CELL_SPLAT[a > 0.8 ? 0 : 1], { tx: dx, ty: 0, tz: dz, growT: 0.08, grow0: 0.55, dryT: 26 });
      ok = true;
    }
    _vMeshes.length = 0; _vRoots.length = 0;
    return ok;
  };
  function nearestCar(x, z, r) {
    const L = CBZ.cityCars;
    let best = null, bd = r * r;
    if (L) for (let i = 0; i < L.length; i++) {
      const c = L[i], g = c && c.group;
      if (!g || !g.parent) continue;
      const dx = g.position.x - x, dz = g.position.z - z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  /* the ratchet: `floatMm` is the worst distance, in mm, between any live
     vehicle-blood vertex and the panel triangle it was cut from, on the
     panel's CURRENT shape (so a dent the decal failed to follow shows up). */
  function vehicleAudit() {
    let pieces = 0, glass = 0, worst = 0;
    for (let i = 0; i < vehRecs.length; i++) {
      const r = vehRecs[i];
      for (let k = 0; k < r.pieces.length; k++) {
        const p = r.pieces[k], d = p.d, P = p.host.geometry.attributes.position;
        pieces++; if (p.glass) glass++;
        if (!P || P.count !== d.count) continue;
        for (let v = 0; v < d.n; v++) {
          const i0 = d.src[v * 3], i1 = d.src[v * 3 + 1], i2 = d.src[v * 3 + 2];
          const ax = P.getX(i0), ay = P.getY(i0), az = P.getZ(i0);
          const ex = P.getX(i1) - ax, ey = P.getY(i1) - ay, ez = P.getZ(i1) - az;
          const fx = P.getX(i2) - ax, fy = P.getY(i2) - ay, fz = P.getZ(i2) - az;
          let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
          const nl = Math.hypot(nx, ny, nz);
          if (!(nl > 0)) continue;
          const q = v * 3;
          const dist = Math.abs((p.pos[q] - ax) * nx + (p.pos[q + 1] - ay) * ny + (p.pos[q + 2] - az) * nz) / nl;
          if (dist > worst) worst = dist;
        }
      }
    }
    return Object.assign({ live: vehRecs.length, livePieces: pieces, liveGlass: glass, floatMm: +(worst * 1000).toFixed(2), cap: vdCap() }, VD_AUDIT);
  }
  // the drops of a spray whose line met a car stop ON it (the spatter decal
  // already stands for them) instead of falling through the body to the road
  const VV_MAX = 8;
  const VV_INV = new Float32Array(VV_MAX * 16), VV_B = new Float32Array(VV_MAX * 6);
  const VV_GEN = new Uint16Array(VV_MAX);
  let vvCursor = 0, airVV = -1;
  function vehicleVolume(root) {
    const k = vvCursor; vvCursor = (vvCursor + 1) % VV_MAX;
    const b = vehBounds(root);
    _hWi.copy(root.matrixWorld).invert();
    VV_INV.set(_hWi.elements, k * 16);
    VV_B[k * 6] = b.min.x; VV_B[k * 6 + 1] = b.min.y; VV_B[k * 6 + 2] = b.min.z;
    VV_B[k * 6 + 3] = b.max.x; VV_B[k * 6 + 4] = b.max.y; VV_B[k * 6 + 5] = b.max.z;
    VV_GEN[k] = (VV_GEN[k] + 1) & 0xffff;
    return k;
  }
  function inVolume(k, x, y, z) {
    const e = VV_INV, o = k * 16, B = VV_B, q = k * 6;
    const lx = e[o] * x + e[o + 4] * y + e[o + 8] * z + e[o + 12];
    if (lx < B[q] || lx > B[q + 3]) return false;
    const ly = e[o + 1] * x + e[o + 5] * y + e[o + 9] * z + e[o + 13];
    if (ly < B[q + 1] || ly > B[q + 4] * 0.92) return false;
    const lz = e[o + 2] * x + e[o + 6] * y + e[o + 10] * z + e[o + 14];
    return lz >= B[q + 2] && lz <= B[q + 5];
  }
  /* a spray's exit cone toward a car: one spatter where the cone's centre
     line meets the body, flight-delayed, sized by the burst; its drops are
     swallowed by the car's volume. -> the car volume index (or -1) and,
     when the car is nearer than the wall, the wall plane is dropped. */
  function vehicleSpray(ex, ey, ez, dx, dy, dz, amt, head, wallT) {
    if (!CBZ.surfaceDecal) return -1;
    const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    const reach = Math.min(3.4, wallT);
    const roots = vehicleCandidates(ex, ey, ez, dx, dy, dz, reach + 0.5);
    if (!roots.length) return -1;
    const h = vehicleArc(ex, ey, ez, dx, dy + 0.08, dz, 6.5, reach, roots);
    if (!h || h.run > wallT) return -1;
    const S = (0.32 + 0.3 * Math.min(1.4, amt)) * (head ? 1.3 : 1);
    vehicleStamp(h, S, S * 1.15, CELL_SPLAT[0], { tx: dx, ty: dy, tz: dz, growT: 0.1, grow0: 0.4, dryT: 14 + amt * 10, thick: 0.7, delay: h.t });
    return vehicleVolume(h.root);
  }

  // ---- WHAT TOOK THE HEAD decides if it comes apart ---------------------------
  // (user-filmed: every pistol headshot popped the skull — that's not how a
  // handgun works). The kill context carries the player's weapon key (imp.wkey,
  // fpsmode threads it) or an NPC/cop attacker whose .weapon names the gun:
  // Body parts stay attached for every ordinary bullet. Only a muzzle-close
  // shotgun has enough distributed impulse to sever; sniper/rifle/pistol rounds
  // still get direction, a wound, mist and a hard ragdoll reaction.
  function weaponKey(imp) {
    let k = imp ? (imp.wkey || (imp.attacker && imp.attacker.weapon) || "") : "";
    return ("" + k).toLowerCase();
  }
  // GORE_DECAP_SHOTGUN: the head-off read is independently revertible. Flag off
  // → a muzzle-close shotgun headshot keeps the head on (intact ragdoll + wound).
  function decapShotgunOn() { return !CBZ.CONFIG || CBZ.CONFIG.GORE_DECAP_SHOTGUN !== false; }
  function headPops(imp) {
    if (!decapShotgunOn()) return false;
    const k = weaponKey(imp);
    const d = imp && imp.dist != null ? imp.dist : 99;
    return k.indexOf("shotgun") >= 0 && d <= 5.5;
  }
  // FULL DECAPITATION: same strict close-shotgun gate as the actual sever. Used
  // to drive the neck-stump spurt; city-only is enforced at the call site.
  function headDecaps(imp) {
    if (!decapShotgunOn()) return false;
    const k = weaponKey(imp);
    const d = imp && imp.dist != null ? imp.dist : 99;
    return k.indexOf("shotgun") >= 0 && d <= 5.5;
  }
  // HEAVY NECK-STUMP SPURT: a real decapitation pumps from the open neck —
  // three beats of an arterial jet up out of the stump (it rides the stump,
  // so it follows the body down), each weaker than the last, and one dark
  // puff over it the moment the head leaves. Falls back to the neck's seat
  // when the stump is missing (a far/culled rig).
  function neckStumpSpurt(actor, x, y, z, dx, dz, lod) {
    const st = stumpOf(actor, "head");
    const o = { speed: 4.6, pulses: 3, period: 0.46, len: 0.26, fall: 0.7, rate: 70, r0: 1.2, r1: 3.5, spread: 0.16 };
    const ny = y + STUMPS.head.py - 0.06;   // y arrives chest-high; lift to the neck
    // the joint's own two-beat pump on this stump is superseded by the neck's
    if (st) { for (let e = 0; e < EM_MAX; e++) if (E_ON[e] && E_REF[e] === st) stopStream(e); airStream(2, st, 0, 0, 0, 0, 1, 0, o); }
    else airStream(0, null, x, ny, z, dx * 0.4, 1, dz * 0.4, o);
    const nm = lod < 0.5 ? 1 : 3;
    for (let i = 0; i < nm; i++) {
      const v = cone(dx * 0.5, 1, dz * 0.5, 0.6), sp = 1.2 + Math.random() * 1.6;
      airMist(x, ny + 0.08, z, v.x * sp, v.y * sp, v.z * sp, 0.04, 0.22 + Math.random() * 0.14, 0.28 + Math.random() * 0.1, 0.3);
    }
  }
  function stumpOf(actor, key) {
    for (let i = 0; i < severed.length; i++) {
      if (severed[i].actor !== actor) continue;
      const it = severed[i].items;
      for (let j = 0; j < it.length; j++) if (it[j].key === key) return it[j].stump;
    }
    return null;
  }

  // ---- HEADSHOT: dry skull fragments riding the exit line --------------------
  // bone doesn't bleed — fragments are flagged "bled" so landing leaves no pool,
  // they just skitter and settle as hard evidence of where the head came apart.
  function skullFrags(x, y, z, dx, dz, lod) {
    const n = 3 + Math.round(2 * lod);
    for (let i = 0; i < n; i++) {
      const b = spawnBit(x, y + 1.1, z,        // y already arrives chest-high — +1.1 = the head
        dx * (6 + Math.random() * 4.5) + (Math.random() - 0.5) * 3,
        3.5 + Math.random() * 4,
        dz * (6 + Math.random() * 4.5) + (Math.random() - 0.5) * 3,
        0.06 + Math.random() * 0.07, i % 3 === 2 ? BONE_D : BONE, "gib");
      if (b) b.bled = true;
    }
  }

  // ---- BLUNT KILL: teeth + spit knocked loose by the killing blow ------------
  // tiny dry gibs (teeth scatter and STAY — they're the receipt of a beating)
  // plus a couple of bright spit-blood droplets; the pool comes LATER, below.
  function bluntBurst(x, y, z, dx, dz, hasDir) {
    const n = 4 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const fx = hasDir ? dx * (2.5 + Math.random() * 2.5) : (Math.random() - 0.5) * 4;
      const fz = hasDir ? dz * (2.5 + Math.random() * 2.5) : (Math.random() - 0.5) * 4;
      const b = spawnBit(x, y + 1.1, z,        // y already arrives chest-high — +1.1 = the mouth
        fx + (Math.random() - 0.5) * 2, 2.5 + Math.random() * 3, fz + (Math.random() - 0.5) * 2,
        0.045 + Math.random() * 0.035, TOOTH, "gib");
      if (b) b.bled = true;          // teeth are dry — no pool where one lands
    }
    // and the mouth bleeds: a few drops of spit and blood off the split lip
    const ns = 3 + ((Math.random() * 3) | 0);
    for (let i = 0; i < ns; i++) {
      const v = hasDir ? cone(dx, 0.5, dz, 0.55) : cone(0, 1, 0, 1.0);
      const sp = 1.6 + Math.random() * 1.8;
      airDrop(x, y + 1.05, z, v.x * sp, v.y * sp, v.z * sp, rMM(0.6, 2.4), -1, 0, 0, 0);
    }
  }

  // ---- WHERE THE BODY ACTUALLY LIES ----------------------------------------
  // The kill pool is stamped where the ROUND landed, but a ragdoll slides a
  // metre or two before it stops — so a corpse routinely ends up sitting NEXT
  // TO its own blood, which is the other half of "it looks fake". A second,
  // later pool seated under wherever the body came to rest ties the scene back
  // into one event (and it is what actually happens: a man bleeds where he was
  // hit, then keeps bleeding where he falls).
  //
  // Deliberately actor-LESS: gore() is positional and only city kills carry a
  // victim through the kill tap, so this finds the nearest corpse itself. Every
  // mode's actor list publishes a position, so no caller changes.
  const CORPSE_LISTS = ["guards", "npcs", "cityPeds", "cityCops", "bots"];
  const _rp = { x: 0, z: 0 };
  function corpsePos(a, out) {
    if (!a || !a.dead || a.culled) return null;
    if (a.group && a.group.position) { out.x = a.group.position.x; out.z = a.group.position.z; return out; }
    if (a.pos) { out.x = a.pos.x; out.z = a.pos.z; return out; }
    return null;
  }
  function restingPool(x, z, amt) {
    if (!realism()) return;
    after(1.5, function () {
      let bx = 0, bz = 0, best = 3.6 * 3.6, found = false;
      for (let L = 0; L < CORPSE_LISTS.length; L++) {
        const list = CBZ[CORPSE_LISTS[L]];
        if (!list || !list.length) continue;
        for (let i = 0; i < list.length; i++) {
          const p = corpsePos(list[i], _rp);
          if (!p) continue;
          const dx = p.x - x, dz = p.z - z, d2 = dx * dx + dz * dz;
          if (d2 < best) { best = d2; bx = p.x; bz = p.z; found = true; }
        }
      }
      // only worth a second decal if the body genuinely travelled away from it
      if (found && best > 0.18) spawnSplat(bx, bz, (0.55 + amt * 0.3) * POOL_K * 1.35, BLOOD_D, true);
    });
  }

  // a beaten body doesn't gush — it BLEEDS OUT: the pool arrives in waves a
  // couple of seconds after the body drops, spreading under wherever it lies.
  function delayedBleedPool(ped) {
    const pk = realism() ? POOL_K : 1;
    after(1.5, function () { if (ped && ped.pos && !ped.culled) spawnSplat(ped.pos.x, ped.pos.z, 0.9 * pk, BLOOD_D, true); });
    after(3.3, function () { if (ped && ped.pos && !ped.culled) spawnSplat(ped.pos.x, ped.pos.z, 1.5 * pk, BLOOD_D, true); });
  }

  // ---- BLADE KILL: the ARTERIAL beats as the heart dies ----------------------
  // A jet out of the wound that rides the body as it goes down (chest-high at
  // the first beat, lying at the last), four beats, each weaker; every drop
  // that lands leaves its own mark. With no body to ride (the prison's kill
  // path is positional) it pumps from where the blow landed.
  function arterialArcs(ped, x, y, z, dx, dz) {
    const o = { speed: 3.4, pulses: 4, period: 0.5, len: 0.24, fall: 0.72, rate: 60, r0: 1.0, r1: 3.0, spread: 0.1, delay: 0.12, y1: 0.35 };
    const jx = dx * 0.8 + (Math.random() - 0.5) * 0.3, jz = dz * 0.8 + (Math.random() - 0.5) * 0.3;
    if (ped && (ped.pos || ped.group)) { o.y1 = 0.35; airStream(1, ped, 0, 1.15, 0, jx, 0.75, jz, o); }
    else { o.y1 = y + 0.15; airStream(0, null, x, y + 0.15, z, jx, 0.75, jz, o); }
  }

  // ---- NO CORPSE STAIN (owner 2026-10-09: "I don't really like clothes
  // changing colours because of blood. Instead it should just be the blood
  // holes"). A body lying in its pool used to have its torso/legs/arms
  // materials swapped for a darkened-blood lambert, so every corpse went
  // maroon. Deleted: the blood is in the pool under him and in the holes on
  // him (systems/wounds.js), never in the colour of his clothes.

  // walk every body slot of a rig and hand each mesh's current colour to `fn`,
  // swapping in the shared lambert `fn` names back. The ONE place that knows
  // which slots make up a body (corpseTreat rides it).
  const BODY_SLOTS = ["torso", "collar", "legs", "legsLower", "pelvis", "shoes",
    "arms", "armsLower", "hands", "stripes", "belt", "cap", "hair"];
  function eachBodyMesh(ch, slots, fn) {
    const S = ch.skinSlots;
    for (let li = 0; li < slots.length; li++) {
      const list = S[slots[li]]; if (!list) continue;
      for (let mi = 0; mi < list.length; mi++) {
        const mesh = list[mi];
        if (!mesh || !mesh.material || !mesh.material.color) continue;
        fn(mesh);
      }
    }
  }
  /* ============================================================
     THE CORPSE TELLS YOU HOW IT DIED — CBZ.corpseTreat(actor, kind).

     OWNER, second pass: "you bleed when you freeze to death — dumb tiny things
     with blood, make them way more realistic."

     Cutting the blood off the bloodless causes (systems/trauma.js) was only
     half an answer. It left a man who froze solid in a blizzard looking
     EXACTLY like a man who starved, who choked on ash, who drowned, who was
     incinerated — five completely different deaths, one factory-fresh body,
     distinguishable only by a line of text in the corner. The blood was wrong
     because it was the ONLY evidence the engine had, so it got used for
     everything. Deleting it without replacing it just moves the problem.

     So each cause gets its own honest read, and it is the SAME cheap device
     the old corpse stain used: one shared-material swap per corpse, never a
     per-frame tint, never a new mesh, never a shader.
       frost  — rime-pale, blue-white, the colour drained out (blizzard)
       char   — blackened through (lava, wildfire, a nuclear flash, lightning)
       ash    — buried under grey volcanic dust (an ashfall death)
       soak   — dark and sodden, the way clothing goes in water (drowning)
       pallor — grey-green and waxy (radiation sickness, starvation)

     The head takes its OWN target: skin does not go the same colour cloth
     does. Colours are desaturated first (death takes the chroma out before it
     adds anything) and quantised to 16 per channel before hitting the shared
     lambert cache, so ninety-nine survivors in a dozen outfits cannot mint a
     material per body.

     REVERSIBLE, because CBZ.playerChar is not rebuilt between matches the way
     the bots are: every swap records the material it replaced, and
     CBZ.corpseUntreat puts them back (modes/survival.js's reset calls it
     through CBZ.trauma.reset). Also re-points ch.skinTone at the treated head
     colour, because grapple.js's normalizeHead re-asserts skinTone on every
     hit — without that, a charred corpse caught in the next blast would snap
     its face back to living skin.
  ============================================================ */
  if (CBZ.CONFIG.GORE_DEATH_MARKS == null) CBZ.CONFIG.GORE_DEATH_MARKS = true;
  // TUNED AGAINST THE GROUND THEY LAND ON. The blizzard turns the island white
  // (systems/disasters.js progressively whitens the terrain) and the grass is
  // pale — so frost and pallor deliberately stop well short of white, keeping
  // enough of the victim's own colour that the body still reads as a BODY
  // against snow, just a rimed and bloodless one. char is the opposite problem
  // and goes nearly all the way: a burned body should be unmistakable at
  // distance. `desat` runs before the mix — death takes the chroma out before
  // it puts anything on.
  const TREATS = {
    frost:  { to: 0xbcd6ea, k: 0.50, desat: 0.60, head: 0xa8c6de, hk: 0.62 },
    char:   { to: 0x211b17, k: 0.85, desat: 0.88, head: 0x1a1512, hk: 0.88 },
    ash:    { to: 0xa09d95, k: 0.70, desat: 0.82, head: 0x94918a, hk: 0.74 },
    soak:   { to: 0x2f4049, k: 0.45, desat: 0.30, head: 0x3a4c55, hk: 0.40 },
    pallor: { to: 0x8f9c8c, k: 0.42, desat: 0.70, head: 0x9aa695, hk: 0.56 },
  };
  function treatHex(hex, to, k, desat) {
    let r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    if (desat > 0) {
      const l = r * 0.299 + g * 0.587 + b * 0.114;
      r += (l - r) * desat; g += (l - g) * desat; b += (l - b) * desat;
    }
    r += (((to >> 16) & 255) - r) * k;
    g += (((to >> 8) & 255) - g) * k;
    b += ((to & 255) - b) * k;
    const q = (v) => Math.max(0, Math.min(255, Math.round(v / 16) * 16));
    return (q(r) << 16) | (q(g) << 8) | q(b);
  }
  CBZ.corpseTreat = function (actor, kind) {
    if (!actor || CBZ.CONFIG.GORE_DEATH_MARKS === false) return false;
    const T = TREATS[kind]; if (!T) return false;
    const ch = actorChar(actor);
    if (!ch || !ch.skinSlots || ch._treated) return false;
    const undo = [];
    eachBodyMesh(ch, BODY_SLOTS, function (mesh) {
      undo.push({ m: mesh, mat: mesh.material });
      mesh.material = lambert(treatHex(mesh.material.color.getHex(), T.to, T.k, T.desat));
    });
    const head = ch.skinSlots.head && ch.skinSlots.head[0];
    if (head && head.material && head.material.color) {
      const hx = treatHex(head.material.color.getHex(), T.head, T.hk, T.desat);
      undo.push({ m: head, mat: head.material, tone: ch.skinTone });
      head.material = lambert(hx);
      ch.skinTone = hx;                 // so normalizeHead re-asserts the DEAD tone
    }
    ch._treated = { kind, undo };
    return true;
  };
  CBZ.corpseUntreat = function (actor) {
    const ch = actorChar(actor);
    const t = ch && ch._treated; if (!t) return false;
    for (let i = 0; i < t.undo.length; i++) {
      const u = t.undo[i];
      u.m.material = u.mat;
      if (u.tone !== undefined) ch.skinTone = u.tone;
    }
    ch._treated = null;
    return true;
  };
  CBZ.corpseMark = function (actor) {
    const ch = actorChar(actor);
    return (ch && ch._treated && ch._treated.kind) || null;
  };

  // GORE_WASH — how deep the standing water over (x,z) is, 0 on dry land.
  // Survival asks the MEAN column, not the live crest: during a tsunami the
  // wavy surface swings by metres at wave frequency (see disaster_arena.js's
  // note on why the swimmer's entry test went flat), and reading it here would
  // strobe decals in and out of washing as each swell passed. Elsewhere it
  // falls back to the same submergence query the water medium already uses.
  if (CBZ.CONFIG.GORE_WASH == null) CBZ.CONFIG.GORE_WASH = true;
  function washOn() { return CBZ.CONFIG.GORE_WASH !== false; }
  function washDepthAt(x, z) {
    if (CBZ.game && CBZ.islandModeOn(CBZ.game.mode)) {
      if (!CBZ.survFloodDepthMeanAt) return 0;
      try { const d = CBZ.survFloodDepthMeanAt(x, z); return isFinite(d) ? d : 0; } catch (e) { return 0; }
    }
    const d = submRaw(x, floorAt(x, z), z);
    return (d === DRY || !isFinite(d)) ? 0 : d;
  }

  /* ============================================================
     THE SWASH TAKES THE BLOOD (GORE_SWASH).

     OWNER, 2026-08-27, on the shark game's beach: "when water runs over those
     blood marks currently the blood marks stay there but are hidden while
     water covers and then they are still there after when water moves back."

     He is describing exactly what the code did. A maul on the sand stamps
     ground pools (gore.js LAYER 4 + the landing droplets), the sea washes up
     over them every few seconds, and NOTHING HAPPENED: the ocean mesh drew
     over the decal while the crest was on it, the crest went out, and the same
     crisp arterial mark was still lying there — through wave after wave, for
     the pool's whole 26-75 s clock. Blood on a beach is a stain the SEA TAKES,
     and takes visibly: the sheet lifts it, the backwash carries it out as a
     cloud, and each run-up leaves less behind until the sand is clean.

     WHY GORE_WASH ABOVE COULD NEVER HAVE DONE THIS. It asks washDepthAt, and
     washDepthAt asks the MEAN water column on purpose — a flood is a slow
     thing, and reading the live crest there would strobe every decal in a
     town. But mean sea level over dry sand is BELOW the sand by definition, so
     on a beach that query is 0 forever and no decal above the mean waterline
     was ever a candidate. The two questions are genuinely different:

        GORE_WASH   "is this ground UNDER standing water?"  -> mean column
        GORE_SWASH  "did a wave just RUN OVER this mark?"   -> live crest

     so this reads the crest, and it wants the strobe: each rising edge IS one
     wave, and one wave is one bite out of the stain. Hysteresis (3.5 cm on,
     1 cm off) keeps a crest that hovers at the threshold from counting twice.

     WHAT IT COSTS. Nothing at all outside the island modes (see the gate
     below): one boolean per frame in the city and in the prison. On the island
     it is one live-surface read — five sines out of the shared swell table —
     per candidate decal per ~0.12 s, and a decal outside the tidal band is
     retired after a single query and never asked again (s.swashOff). Measured
     on the disaster island: a kill pool and its spray on the beach leave ~15
     candidates; a pool up on the high ground leaves none.

     A DECAL DOES NOT COME BACK. dilute only rises; when it reaches 1 the mark
     retires. That is the whole point of the read the owner wants: the tide
     goes out and the sand is CLEAN, not merely un-occluded.
  ============================================================ */
  /* ISLAND WORLDS ONLY, AND THAT IS NOT A SHORTCUT — IT IS THE MEASUREMENT.
     This law needs two things: ground with real heights, and a sea that is
     drawn wherever it is higher than that ground. The disaster island has
     both (arena.groundHeightAt is a real bathymetry, and its ocean mesh
     carries uSeaHasLandMask = 0 — measured — so the sand is the only thing
     hiding the water). The city has neither: CBZ.floorAt is a flat 0 over the
     whole map INCLUDING the open sea (waterfield.js:466 measured 0.00 at all
     199 aquatic actors), so a height test there would nominate every street in
     town, and the city sea is hard-discarded at a baked land mask whose edge
     only moves with surge — its beach apron sits at +0.048 with the highest
     crest at -0.06, so water never runs over city sand in the first place.
     Nothing to model, and this way the city pays one boolean per frame. */
  if (CBZ.CONFIG.GORE_SWASH == null) CBZ.CONFIG.GORE_SWASH = true;
  function swashOn() {
    return CBZ.CONFIG.GORE_SWASH !== false
      && !!(CBZ.game && CBZ.islandModeOn && CBZ.islandModeOn(CBZ.game.mode) && CBZ.survSeaHeightAt);
  }
  const SWASH_ON = 0.035;      // m of water over the mark that counts as covered
  const SWASH_OFF = 0.010;     // and how far it must drain before the next wave counts

  // mean sea level in this world — the island publishes its own, the city's
  // is the shared water spec's, and a world with no water at all answers 0.
  function meanSeaY() {
    if (CBZ.survSeaMeanY) {
      try { const v = CBZ.survSeaMeanY(); if (isFinite(v)) return v; } catch (e) {}
    }
    if (CBZ.waterSeaY) { try { const v = CBZ.waterSeaY(); if (isFinite(v)) return v; } catch (e) {} }
    return CBZ.SEA_Y != null ? CBZ.SEA_Y : 0;
  }
  // metres of water standing over the point the decal is actually SEATED at,
  // measured against the LIVE crest — the same surface the ocean mesh is drawn
  // at, which is what makes this test agree with what the player sees covering
  // the mark. Negative on dry sand, and never NaN.
  function swashDepth(x, y, z) {
    try { const s = CBZ.survSeaHeightAt(x, z); return isFinite(s) ? s - y : -1; } catch (e) { return -1; }
  }
  // ONE test per decal, ever: is this mark inside the band a wave can reach?
  // Above it is inland; below it is already submerged, and the standing-water
  // path above owns that one. A tsunami RAISES mean sea level, and a decal
  // this test retired is then picked up by GORE_WASH instead — which is the
  // right division of labour, because a surge is standing water, not a wave.
  function swashBand(s) {
    const m = meanSeaY();
    if (!isFinite(m)) return false;
    // A metre either side of mean sea level covers every crest this world's
    // swell table can raise, with room for a storm's gain on top. Measured at
    // the island's waterline: 0.35 m peak to trough seen from 130 m away, and
    // about half a metre with the lens on it — water_spec.js scales wave
    // amplitude by distance from the CAMERA, so the swell a decal actually
    // meets is the swell the player is standing next to.
    const gap = s.m.position.y - m;
    return gap < 1.2 && gap > -1.2;
  }
  // WHICH WAY IS OUT. The backwash runs down the beach, so the cloud is thrown
  // along the ground's own fall line. On sand flat enough to have no fall line
  // (or with the slope model off) the water itself answers: the deeper side is
  // seaward. Two extra sea reads, only on the frame a wave actually lands.
  const _sea = { x: 0, z: 0 };
  function seawardAt(x, y, z) {
    let dx = 0, dz = 0;
    if (slopeOn()) { const g = groundGrad(x, z); dx = -g.gx; dz = -g.gz; }
    if (Math.hypot(dx, dz) < 0.01) {
      const e = 2;
      dx = swashDepth(x + e, y, z) - swashDepth(x - e, y, z);
      dz = swashDepth(x, y, z + e) - swashDepth(x, y, z - e);
    }
    const l = Math.hypot(dx, dz);
    if (l > 0.001) { _sea.x = dx / l; _sea.z = dz / l; } else { _sea.x = 0; _sea.z = 0; }
    return _sea;
  }
  /* ONE WAVE, ONE BITE. The sheet lifts a share of what is left of the mark,
     that share leaves as a cloud in the water, and the mark keeps the rest —
     thinner (dilute) and smaller (the pool is eaten from its edges). Three or
     four run-ups and there is nothing left, which is about what a real tide
     line does to a stain and, more to the point, is slow enough that you SEE
     it happen instead of watching a decal pop out of existence. */
  let swashEvents = 0;              // every run-up that ever took a bite, this match
  function swashTake(s, depth) {
    const x = s.m.position.x, y = s.m.position.y, z = s.m.position.z;
    swashEvents++;
    const left = 1 - (s.dilute || 0);
    // a sheet you can see your feet through lifts less than a knee-deep run-up
    const bite = Math.min(left, 0.30 + Math.min(0.34, depth * 0.55) + Math.random() * 0.12);
    s.dilute = Math.min(1, (s.dilute || 0) + bite);
    s.grow = Math.max((s.max || s.grow) * 0.34, s.grow * (1 - bite * 0.4));
    s.swashN = (s.swashN || 0) + 1;
    /* A DROPLET DOES NOT MAKE A CLOUD. The spray around a maul lands as
       dozens of marks a hand across (spawnSplat grows of 0.08-0.21); giving
       each one a slick would put twenty clouds in the water for one bite and
       spend the whole slick budget on flecks. Only a real mark — a pool, a
       drip trail, a smear — has enough in it to colour water. The flecks still
       dilute and still go; they just go quietly. */
    if (!waterOn() || (s.max || s.grow) < 0.4) return;
    // THE CLOUD IS THE EVENT. A film on the water where the mark was, thrown
    // seaward at backwash speed and handed to the current after a couple of
    // seconds — and floored at the sand, so when the sheet drains out from
    // under it what is left is a diluted stain on wet sand rather than a decal
    // that sank through the beach chasing a surface that left.
    const amt = Math.max(0.3, Math.min(2.4, (s.max || 1) * 0.55 * (0.55 + bite)));
    const d = seawardAt(x, y, z);
    const sp = 0.9 + Math.random() * 0.7;
    CBZ.goreSlick(x + d.x * 0.2, z + d.z * 0.2, amt,
      { vx: d.x * sp, vz: d.z * sp, decay: 1.5 + Math.random(), floorY: y });
    // and in water with any body to it, the cloud has a third dimension
    if (depth > 0.25) CBZ.goreBloom(x, y + depth * 0.45, z, { amount: Math.min(1.2, amt * 0.6) });
  }

  /* ============================================================
     SNOW BURIES BLOOD (GORE_SNOW_BURY).

     systems/weather.js already lies snow on the world: `cover` is a live 0..1
     coverage scalar that whitens every large up-facing surface through one
     shared uniform, and the blizzard drives it from a dusting during the
     warning to a buried island by the end of the event. Every ground decal in
     this file missed that entirely — gore pools are small unlit transparent
     planes, so the coat scan skips them by design (COAT_MIN_R) — and the
     result was the one thing a whiteout cannot have in it: an island going
     white under fresh snow with crisp arterial red still sitting on top of it,
     un-dimmed, through the whole storm and out the far side.

     THE MODEL IS "SNOW THAT FALLS AFTER YOU BLEED". Each decal remembers the
     coverage that was already on the ground when it landed, and buries against
     the coverage gained SINCE. That is the difference between a physical
     model and a global fade: blood spilled onto an already-white island still
     reads at full strength — which is the shot the blizzard actually wants,
     a red pool on fresh snow — and only the next fall of snow takes it.

     Each decal needs its own depth to disappear under (jittered), so a field
     of pools goes under raggedly the way real drifting does, instead of the
     whole island's gore dimming in lockstep on one number.

     Buried is GONE, not hidden: once it is under, melt does not give it back.
     Meltwater dilutes and drains, which is the same answer GORE_WASH already
     gives standing water, and a resurrect path would mean a storm that leaves
     the battlefield exactly as it found it.

     Vertical wall splatter is deliberately NOT buried — snow does not lie on a
     wall — so after a blizzard the ground is clean and the walls still carry
     what happened. That asymmetry is free here and it is the correct one.

     NOT MODE-GATED, on purpose. `cover` is the shared weather scalar and it is
     zero unless it is actually snowing, so this is inert everywhere it should
     be. Gating it to the island would be the exact disease scrolls/CLAUDE.md
     names — a shared verb fenced behind a mode that has no say in it.
  ============================================================ */
  if (CBZ.CONFIG.GORE_SNOW_BURY == null) CBZ.CONFIG.GORE_SNOW_BURY = true;
  function snowCover() {
    if (CBZ.CONFIG.GORE_SNOW_BURY === false || !CBZ.weather) return 0;
    const c = CBZ.weather.snowCover;
    return typeof c === "number" && isFinite(c) ? c : 0;
  }
  // 0 = untouched, 1 = fully under. `snow0` is the coverage at spawn, `snowNeed`
  // how much NEW snow this particular decal needs to disappear beneath.
  function buriedBy(rec, cover) {
    if (rec.snowNeed == null) return 0;
    const gained = cover - rec.snow0;
    if (gained <= 0) return 0;
    const k = gained / rec.snowNeed;
    return k > 1 ? 1 : k;
  }

  // A SINGLE DRIP. Deliberately not goreImpact: a man walking with an open
  // wound leaves marks, not a spray and a pool at every footfall. One tiny
  // short-lived splat, seated on the terrain like every other ground decal.
  // A POOL LAYER under a body that is still bleeding (systems/vitals.js calls
  // this as blood leaves a lying man: each call a bigger layer, to its cap).
  // `grow` is spawnSplat's own pool size (0.3 small .. 2.4 a man bled out).
  CBZ.gorePool = function (x, z, grow) {
    if (!CBZ.scene || dist2Cam(x, z) > 60 * 60) return null;
    return spawnSplat(x, z, Math.max(0.2, Math.min(2.4, grow || 0.6)) * POOL_K * 1.35, BLOOD_D, true);
  };
  CBZ.goreDrip = function (x, z, size) {
    if (!CBZ.scene) return;
    const d2 = dist2Cam(x, z);
    if (d2 > 55 * 55) return;
    // `size` keeps its old scale (0.1-0.5); a walking drip lands 2-6 cm across
    const g = Math.max(0.1, Math.min(0.5, size == null ? 0.22 : size)) * 0.12;
    // near the lens you see it FALL: a drop let go at hand height, which
    // stamps the same mark when it lands. Far off, just the mark.
    if (d2 < 22 * 22 && !wetEvent) {
      const fy = decalFloorAt(x, z);
      if (airDrop(x, fy + 0.7 + Math.random() * 0.3, z, (Math.random() - 0.5) * 0.2, -0.3, (Math.random() - 0.5) * 0.2,
        0.0015 + g * 0.05, -1, 0, 0, g) >= 0) return;
    }
    spawnSplat(x, z, g, BLOOD_D, false, _dotO);
  };

  // ============================================================
  //  REAL DISMEMBERMENT — the body that hits the ground is genuinely MISSING
  //  what came off. WHY: spraying generic red cubes while the rig keeps all
  //  its limbs reads FAKE (user-filmed). Now the actual body-part mesh on the
  //  victim's rig is HIDDEN, a clone of THAT part (same proportions, same
  //  clothing/skin materials — head flies with its face) launches from the
  //  part's exact world transform, and a torn cut face — bore, bone and hanging
  //  flaps — seats at the joint so the stump sells it (see stumpGeo below).
  //
  //  RESTORE IS GUARANTEED WHERE IT HAS TO BE: rigs are pooled/recycled and the
  //  player respawns, so every sever is held in a registry and a per-frame audit
  //  restores visibility + removes the stump the moment the actor is culled,
  //  parked, wearing a different rig, or alive again after being severed DEAD.
  //  What it no longer does is regrow a limb off a living victim who simply
  //  survived — see the permanence block on severAudit. CBZ.goreRestoreBody
  //  gives death.js an explicit same-frame restore on player respawn.
  // ============================================================
  const severed = [];                      // { actor, ch, items:[{ key, part, stump }] }
  const SEV_CAP = 24;
  /* ---- THE STUMP IS A WOUND, NOT A CAP -------------------------------------
     OWNER, on a shark taking a leg: "it puts a red square where i bit them."
     He is describing this, literally:

         stump = new THREE.Mesh(G_GIB, lambert(BLOOD_D));   // BoxGeometry(1,1,1)
         stump.scale.set(J.sx, J.sy, J.sz);                 // legs: 0.36 x 0.15 x 0.36

     A box. Untextured, axis-aligned, and BLOOD_D (0x5e070b) through this
     renderer's outputEncoding = sRGBEncoding with r128 colour management OFF
     comes out of the pipe near #a5xxxx — a bright, flat, unlit-looking red (the
     same measurement the DECAL note at the top of this file was written for).
     A 36 x 15 x 36 cm slab of that is the single most-seen object in a
     dismemberment, and from every angle it is a rectangle.

     The replacement is ONE lazily-built shared geometry and ONE shared
     material, both _shared so the disposal sweeps skip them, with the entire
     read carried in VERTEX COLOUR. That is the same trick systems/wounds.js's
     rampGeo() uses for a bullet hole and for the same reason: a Lambert/Basic
     material MULTIPLIES its colour by the per-vertex colour, so one material
     can be pale bone at the axis and near-black in the bore with no texture,
     no second draw call and no per-stump allocation. Five parts:
       • a 13-gon cut face with a randomly-phased-sine rim wobble — an ODD
         segment count so no two rim points sit opposite each other, and a
         silhouette that is never a polygon you can name and never a rectangle
       • a recessed BORE that ramps to near-black, so the wound reads as a HOLE
         even where nothing is casting a shadow into it
       • a proud pale BONE core: the one high-value note, and the thing that
         says amputation rather than red paint
       • a SKIRT of torn meat running back INTO the body, so the stump is a
         solid seen edge-on instead of a disc floating at the joint (it sits
         inside the torso/shoulder mesh, which is exactly where flesh belongs)
       • four hanging FLAPS past the rim — the ragged outline you register first
     Colours are authored DARK on purpose; see the DECAL note. flatShading is on
     so the facets read as torn (r128 derives face normals in the shader, which
     is why computeVertexNormals below is only the graceful-degradation path).
     ~95 triangles, built once, shared by every stump in the world. */
  let G_STUMP = null, M_STUMP = null;
  const STUMP_BONE = [0.62, 0.58, 0.47];    // proud bone core — this pipe lifts it to pale ivory
  const STUMP_BONE_D = [0.34, 0.31, 0.24];  // bone shading into the bore
  const STUMP_BORE = [0.055, 0.008, 0.010]; // the hole: near-black, reads as depth with no shadow
  const STUMP_RAW = [0.34, 0.048, 0.052];   // the raw margin at the cut rim
  const STUMP_MEAT = [0.13, 0.016, 0.020];  // deep meat: the skirt and the hanging flaps
  function stumpGeo() {
    if (G_STUMP) return G_STUMP;
    const N = 13;
    const p1 = Math.random() * 6.28, p2 = Math.random() * 6.28, p3 = Math.random() * 6.28;
    const rim = [], bore = [], core = [], skirt = [], rr = [];
    for (let i = 0; i < N; i++) {
      // the angle DECREASES with i, which is what makes a (centre, i, i+1) fan
      // wind FRONT-face toward +Y — the direction the cut looks out of.
      const a = -(i / N) * 6.28318;
      const w = 1 + 0.17 * Math.sin(a * 3 + p1) + 0.12 * Math.sin(a * 5 + p2) + 0.08 * Math.sin(a * 7 + p3);
      const cx = Math.cos(a), cz = Math.sin(a), R = 0.5 * w;
      rr.push(R);
      rim.push([cx * R, 0.015 + 0.035 * Math.sin(a * 4 + p2), cz * R]);   // the rim is not level either
      bore.push([cx * 0.30 * w, -0.16, cz * 0.30 * w]);
      core.push([cx * 0.13, 0.02, cz * 0.13]);
      skirt.push([cx * R * 0.88, -0.42, cz * R * 0.88]);
    }
    const P = [], C = [];
    function v(p, c) { P.push(p[0], p[1], p[2]); C.push(c[0], c[1], c[2]); }
    function tri(a, ca, b, cb, c, cc) { v(a, ca); v(b, cb); v(c, cc); }
    const CTR = [0, 0.05, 0];
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      tri(CTR, STUMP_BONE, core[i], STUMP_BONE_D, core[j], STUMP_BONE_D);            // bone core
      tri(core[i], STUMP_BONE_D, bore[i], STUMP_BORE, bore[j], STUMP_BORE);          // bore funnel
      tri(core[i], STUMP_BONE_D, bore[j], STUMP_BORE, core[j], STUMP_BONE_D);
      tri(bore[i], STUMP_BORE, rim[i], STUMP_RAW, rim[j], STUMP_RAW);                // cut face
      tri(bore[i], STUMP_BORE, rim[j], STUMP_RAW, bore[j], STUMP_BORE);
      tri(rim[i], STUMP_RAW, skirt[i], STUMP_MEAT, skirt[j], STUMP_MEAT);            // skirt into the body
      tri(rim[i], STUMP_RAW, skirt[j], STUMP_MEAT, rim[j], STUMP_RAW);
      if (i % 3 === 1) {                                                             // four torn flaps
        const am = -((i + 0.5) / N) * 6.28318, R2 = (rr[i] + rr[j]) * 0.71;
        tri(rim[i], STUMP_RAW, [Math.cos(am) * R2, -0.30, Math.sin(am) * R2], STUMP_MEAT, rim[j], STUMP_RAW);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(C), 3));
    g.computeVertexNormals();
    g._shared = true;
    G_STUMP = g;
    return g;
  }
  function stumpMat() {
    if (M_STUMP) return M_STUMP;
    // white base × per-vertex colour = the whole ramp in one material. DoubleSide
    // because the hanging flaps are single-sheet tags and you WILL walk round
    // them; r128 flips the normal for back faces, so they still light correctly.
    M_STUMP = new THREE.MeshLambertMaterial({
      color: 0xffffff, vertexColors: true, flatShading: true, side: THREE.DoubleSide,
    });
    M_STUMP._shared = true;                  // rm() must never dispose it
    return M_STUMP;
  }
  // joint geometry per part: stump position (parent-local), the cut face's
  // RADIUS, and `ay` — the joint AXIS, i.e. which way the open face looks along
  // it. A neck stump faces UP and out of the shoulders (+1); a shoulder and a
  // hip both face DOWN, along the limb that left (-1). That one number is what
  // stops a head wearing an upside-down leg wound.
  // arms + head hang off ch.body; legs hang off the root group (character.js).
  const STUMPS = {
    head: { px: 0, py: 1.96, pz: 0, r: 0.19, onBody: true, ay: 1 },
    la: { px: -0.62, py: 1.78, pz: 0, r: 0.16, onBody: true, ay: -1 },
    ra: { px: 0.62, py: 1.78, pz: 0, r: 0.16, onBody: true, ay: -1 },
    ll: { px: -0.23, py: 0.9, pz: 0, r: 0.18, onBody: false, ay: -1 },
    rl: { px: 0.23, py: 0.9, pz: 0, r: 0.18, onBody: false, ay: -1 },
  };
  const SEV_LIMBS = ["ll", "rl", "la", "ra"];
  const _svp = new THREE.Vector3();        // scratch for the stump's live world position
  function actorChar(a) { return a ? (a.char || (a.isPlayer ? CBZ.playerChar : null)) : null; }
  // "head" = the whole neck group so the face/hair/cap fly WITH the skull
  function partOf(ch, key) { return key === "head" ? ch.neck : (ch.parts ? ch.parts[key] : null); }

  /* ---- THE MOUTHFUL ----------------------------------------------------
     Owner, 2026-09-01: "how limbs come apart — I hate fake shit." What was
     fake: a shark closed its jaws on a swimmer's leg, the leg came off, and
     the leg FLEW OUT OF THE MOUTH along the bite line and sank — the animal
     that took it never had it. A limb bitten off is in the mouth that bit it.
     So when the sever arrives with `by` (creature_combat's biteWound and the
     kill sites name the biter) and that biter has an authored aquatic mouth,
     the real cloned limb is seated at the mouth's own `grip` socket, ridden
     for a beat while the jaws close on it, then drawn back into the throat
     and gone — swallowed. The joint it left bleeds exactly as before; the
     mouth bleeds too, because there is a piece of a person in it. */
  const mouthfuls = [];
  const _mfV = new THREE.Vector3();
  function mouthOf(a) {
    const g = a && a.group, mo = g && g._aquaticMouth;
    return (mo && mo.contract && mo.contract.grip && g.parent) ? mo : null;
  }
  function stripSockets(fly) {
    const stripQ = [];
    fly.traverse((o) => { if (o !== fly && o.userData && o.userData.isSocket) stripQ.push(o); });
    for (let i = 0; i < stripQ.length; i++) { if (stripQ[i].parent) stripQ[i].parent.remove(stripQ[i]); }
  }
  function holdInMouth(part, by, mo, key, wet) {
    if (mouthfuls.length >= 6) return false;
    const fly = part.clone();
    stripSockets(fly);
    fly.visible = true;
    fly.userData.isMouthful = true;               // for the tools: this child of a shark is a meal
    if (CBZ.pedInstanceReveal) CBZ.pedInstanceReveal(fly);
    part.matrixWorld.decompose(fly.position, fly.quaternion, fly.scale);
    scene().add(fly);
    const g = by.group;
    g.updateWorldMatrix(true, false);
    g.attach(fly);                                     // world pose kept; now rides the animal
    const c = mo.contract;
    // root-space (pre-scale) sockets: the grip is where a held thing sits, the
    // throat is half a jaw behind the hinge, inside the buccal sack's bore
    const jawLen = Math.max(0.3, (c.bite.x - c.hinge.x));
    const lift = key === "head" ? 0.10 : 0.05;
    mouthfuls.push({
      m: fly, by: by, mo: mo, key: key, t: 0, wet: !!wet, bledT: 0,
      draw: 0.22, hold: 0.22 + 0.85 + Math.random() * 0.5, swallow: 0.6,
      from: fly.position.clone(),
      seat: new THREE.Vector3(c.grip.x, c.grip.y + lift, 0),
      throat: new THREE.Vector3(c.hinge.x - jawLen * 0.55, c.hinge.y + 0.02, 0),
      q0: fly.quaternion.clone(), s0: fly.scale.clone(),
      spin: (Math.random() - 0.5) * 1.6,
    });
    return true;
  }
  function updateMouthfuls(dt) {
    for (let i = mouthfuls.length - 1; i >= 0; i--) {
      const f = mouthfuls[i], m = f.m;
      const g = f.by && f.by.group;
      if (!m.parent || !g || !g.parent || (f.by.culled) || !g.visible) {
        if (m.parent) m.parent.remove(m);            // shared rig materials: never dispose
        mouthfuls.splice(i, 1); continue;
      }
      f.t += dt;
      const end = f.hold + f.swallow;
      if (f.t < f.draw) {
        // drawn onto the tooth line
        const k = f.t / f.draw, e = k * k * (3 - 2 * k);
        m.position.lerpVectors(f.from, f.seat, e);
      } else if (f.t < f.hold) {
        // held: the jaws are closing on it; it jerks with the bite thrash
        const j = Math.sin(f.t * 31) * 0.012;
        m.position.set(f.seat.x + j, f.seat.y + Math.abs(j) * 0.5, f.seat.z + j * 0.6);
        m.rotation.x += f.spin * dt;
      } else if (f.t < end) {
        // swallowed: back into the throat and down to nothing
        const k = (f.t - f.hold) / f.swallow, e = k * k;
        m.position.lerpVectors(f.seat, f.throat, e);
        const sc = 1 - e * 0.92;
        m.scale.set(f.s0.x * sc, f.s0.y * sc, f.s0.z * sc);
      } else {
        m.parent.remove(m); mouthfuls.splice(i, 1); continue;
      }
      // it bleeds where it is: blooms in the water, drops in the air
      f.bledT -= dt;
      if (f.bledT <= 0 && f.t < f.hold + f.swallow * 0.5) {
        f.bledT = 0.16;
        m.getWorldPosition(_mfV);
        const wet = waterOn() && woundInWater(_mfV.x, _mfV.y, _mfV.z);
        if (wet) { if (CBZ.goreBloom) CBZ.goreBloom(_mfV.x, _mfV.y, _mfV.z, { amount: 0.30 }); }
        else {
          for (let k = 0; k < 2; k++) {
            airDrop(_mfV.x, _mfV.y - 0.05, _mfV.z, (Math.random() - 0.5) * 0.5, -0.2 - Math.random() * 0.6,
              (Math.random() - 0.5) * 0.5, rMM(1.2, 3.4), -1, 0, 0, 0);
          }
        }
      }
    }
  }
  /* WHICH LIMB THE TEETH WERE ON. The death path used to pull a limb out of a
     hat: bitten on the leg, an ARM came off. The kill site knows where the
     mouth closed; the nearest joint to that point is the one that goes. */
  function nearestLimb(ch, p, pool) {
    if (!ch || !p || p.x == null) return null;
    let best = null, bd = 1e9;
    for (let i = 0; i < pool.length; i++) {
      const part = partOf(ch, pool[i]); if (!part) continue;
      part.updateWorldMatrix(true, false);
      part.getWorldPosition(_mfV);
      // the joint is at the part's root; a limb's mass centre is half a part below it
      const d = Math.hypot(_mfV.x - p.x, (_mfV.y - 0.25) - p.y, _mfV.z - p.z);
      if (d < bd) { bd = d; best = pool[i]; }
    }
    return best;
  }
  CBZ.goreMouthfulAudit = function () {
    return { held: mouthfuls.length, keys: mouthfuls.map(function (f) { return f.key; }) };
  };

  function severBody(actor, key, opts) {
    opts = opts || {};
    if (!CBZ.scene || !STUMPS[key]) return false;
    const ch = actorChar(actor); if (!ch || !ch.group) return false;
    const part = partOf(ch, key); if (!part) return false;
    let r = null;
    for (let i = 0; i < severed.length; i++) {
      if (severed[i].actor === actor && severed[i].ch === ch) { r = severed[i]; break; }
    }
    if (r) for (let i = 0; i < r.items.length; i++) if (r.items[i].key === key) return false; // already off
    // hidden by something that ISN'T us (LOD, etc.) → leave it alone, unless
    // we're adopting peds.js's explosion hide into the registry.
    if (part.visible === false && !opts.adopt) return false;
    // grab the part's world transform BEFORE anything moves this frame
    part.updateWorldMatrix(true, false);
    // WHICH MEDIUM IS THIS JOINT ACTUALLY IN? `wetEvent` is armed inside
    // CBZ.gore() and nowhere else, and systems/wounds.js's bodyBite calls
    // CBZ.goreSever from OUTSIDE any gore event — so a leg bitten off a swimmer
    // flew ballistically like a football and landed on the seabed as a dry gib,
    // and the joint vented droplets INTO water rather than blood in it. One
    // guarded submRaw off the world transform we just updated decides it
    // honestly. Blood in the water is what the owner actually likes about this
    // system; a severed limb is where it should be earning the most of it.
    const _sm = part.matrixWorld.elements;
    const wetHere = wetEvent || (waterOn() && woundInWater(_sm[12], _sm[13], _sm[14]));
    if (!r) {
      // Never make an existing corpse visibly regrow just to free a pool slot.
      // At the cap the new cosmetic sever is suppressed; the older body stays
      // anatomically consistent until its normal corpse/recycle cleanup.
      if (severed.length >= SEV_CAP) return false;
      // deadAtSever: was this body ALREADY a corpse when the part came off? It
      // is the whole basis of the permanence rule in severAudit() below — a
      // corpse that is alive again has been respawned or recycled, while a
      // living person who loses a limb has simply lost it.
      r = {
        actor, ch, items: [],
        deadAtSever: !!(actor.isPlayer ? (CBZ.player && CBZ.player.dead) : actor.dead),
      };
      severed.push(r);
    }
    part.visible = false;
    // ---- STUMP: the torn cut face seated at the joint, riding the rig ------
    const J = STUMPS[key];
    const parent = J.onBody ? (ch.body || ch.group) : ch.group;
    let stump = null;
    if (parent) {
      stump = new THREE.Mesh(stumpGeo(), stumpMat());   // both _shared — disposal sweeps skip them
      stump.scale.setScalar(J.r * 2);                   // the geometry is authored at radius 0.5
      stump.position.set(J.px, J.py, J.pz);
      // ay flips the cut face along the joint axis (see STUMPS); the Y term is a
      // free per-stump spin about that axis so no two amputations on one body,
      // or on two bodies, present the same rim to the camera. Euler order XYZ
      // applies Y first, so the spin happens in the face's own plane and the
      // flip stays exact.
      stump.rotation.set(J.ay < 0 ? Math.PI : 0, Math.random() * 6.28, 0);
      stump.castShadow = false;
      parent.add(stump);
    }
    r.items.push({ key, part, stump });
    // The open joint pumps a couple of diminishing pulses while the corpse is
    // still present. This is tied to the real stump transform and stops the
    // instant the part is restored/recycled; it never creates free-floating FX.
    // an open joint pumps wherever it happens — the island tears limbs off now
    // too (opts.limbs), and a stump that just sits there is the tell.
    if (stump && (debrisLaw() || survMode())) {
      // the jet rides the stump itself (its +Y is the way the cut looks out),
      // decides its medium per beat, and stops the instant the stump goes
      airStream(2, stump, 0, 0, 0, 0, 1, 0, {
        speed: 2.6, pulses: 2, period: 0.54, len: 0.2, fall: 0.6, rate: 45, r0: 1.0, r1: 2.6, spread: 0.22, delay: 0.38,
      });
      // and the pool the second beat leaves is a GROUND pool. Under the sea
      // that decal lands on the seabed in the dark; the surface slick is the
      // thing anyone can actually see, so wet bleeds go there instead.
      after(0.92, function () {
        if (!stump.parent || part.visible !== false || (actor && actor.culled)) return;
        const wp = _svp; stump.getWorldPosition(wp);
        if (waterOn() && woundInWater(wp.x, wp.y, wp.z)) surfaceSlick(wp.x, wp.z, 0.4);
        else spawnSplat(wp.x, wp.z, 0.32, BLOOD_D, true);
      });
    }
    // a severed LEG = the rig can't stand: flag the char so entities/character.js
    // drops it into a one-legged collapse/crawl (limpSpeedMul → 0) instead of
    // walking on a missing limb. -1 = left leg gone, +1 = right. Cleared on the
    // restore-on-reuse audit below so a recycled rig starts whole.
    if (key === "ll" || key === "rl") { ch.legGone = key === "ll" ? -1 : 1; ch.legHurt = null; }
    // ---- INTO THE MOUTH THAT TOOK IT (see THE MOUTHFUL above) --------------
    const jaws = !opts.noFly && !opts.boom ? mouthOf(opts.by) : null;
    if (jaws && holdInMouth(part, opts.by, jaws, key, wetHere)) {
      // the joint vents in its own medium exactly as the flying path does
      const prevWet0 = wetEvent; wetEvent = wetHere;
      const _pm = part.matrixWorld.elements;
      for (let i = 0; i < 5; i++) {
        const v = cone(0, 1, 0, 0.9), sp = 1.5 + Math.random() * 2;
        airDrop(_pm[12], _pm[13], _pm[14], v.x * sp, v.y * sp, v.z * sp, rMM(1, 3), -1, 0, 0, 0);
      }
      wetEvent = prevWet0;
      return true;
    }
    // ---- FLYING PART: a clone of the REAL meshes — same proportions, same
    // clothing/skin materials (shared refs, never disposed) — launched from
    // the part's exact world transform. Never a generic red cube.
    if (!opts.noFly && bits.length < 500) {
      const fly = part.clone();
      // strip SOCKETS (hand/weapon mounts) but keep the two-segment limb's
      // `low` joint group — it holds the forearm/shin mesh + cap, and the old
      // "remove every non-Mesh child" loop would amputate the flying gib at
      // the elbow/knee. Sockets are tagged userData.isSocket in character.js.
      const stripQ = [];
      fly.traverse((o) => { if (o !== fly && o.userData && o.userData.isSocket) stripQ.push(o); });
      for (let i = 0; i < stripQ.length; i++) { if (stripQ[i].parent) stripQ[i].parent.remove(stripQ[i]); }
      fly.visible = true;
      // A SEVERED LIMB MUST BE VISIBLE EVEN WHEN ITS ORIGINAL IS INSTANCED.
      // entities/pedinstance.js parks pooled body meshes on a private layer
      // (the source keeps `visible` intact — this file's own visible-flag
      // contract above depends on that), and Object3D.copy carries
      // layers.mask into the clone, so an un-revealed gib would fly off
      // invisible. One call, guarded: a no-op when the system is off.
      if (CBZ.pedInstanceReveal) CBZ.pedInstanceReveal(fly);
      part.matrixWorld.decompose(fly.position, fly.quaternion, fly.scale);
      scene().add(fly);
      let dx = opts.dir ? opts.dir.x || 0 : 0, dz = opts.dir ? opts.dir.z || 0 : 0;
      const dl = Math.hypot(dx, dz);
      if (dl < 0.01) { const a = Math.random() * 6.28; dx = Math.cos(a); dz = Math.sin(a); }
      else { dx /= dl; dz /= dl; }
      const sp = opts.boom ? 4 + Math.random() * 4.5 : 4.5 + Math.random() * 3;
      const up = key === "head" ? 4.5 + Math.random() * 2.5 : (opts.boom ? 5 + Math.random() * 4 : 3 + Math.random() * 2);
      // Even a severed limb clears eventually so a blast doesn't leave a
      // permanent limb field — it lingers a good while (real body part, not a
      // generic cube), then sinks/shrinks away. Flag off → the ORIGINAL short
      // jail/survival limb life and no fade.
      const cityLimb = debrisLaw();
      bits.push({
        m: fly, vx: dx * sp + (Math.random() - 0.5) * 1.5, vy: up, vz: dz * sp + (Math.random() - 0.5) * 1.5,
        kind: "gib", mat: null,
        sx: (Math.random() - 0.5) * 12, sy: (Math.random() - 0.5) * 12, sz: (Math.random() - 0.5) * 12,
        landed: false, bled: false, baseScale: 1, rad: key === "head" ? 0.3 : 0.2,
        // THIS IS A REAL BODY PART, NOT A GENERIC BOX. The flag is what lets
        // CBZ.goreAudit() tell the two apart, and `gibs` (anonymous cubes) is
        // pinned at 0 on the island — see the LAYER 3 block.
        limb: true,
        // and snow lies on a severed arm exactly as it lies on a pool
        snow0: snowCover(), snowNeed: 0.26 + Math.random() * 0.24,
        wet: wetHere,                         // a limb torn off underwater sinks, it doesn't fly
        // fade against the clone's OWN scale (a limb mesh isn't unit-scaled) so
        // the shrink reads right; vScale captures that base. City-only.
        fade: cityLimb, vScale: cityLimb ? fly.scale.clone() : null,
        life: cityLimb ? 14 + Math.random() * 6 : 9 + Math.random() * 5,
      });
      // the wound VENTS at the joint — a bright burst riding the part out.
      // Armed with the joint's real medium (see wetHere): under water that burst
      // becomes a bloom through spawnBit's redirect instead of ballistic drops.
      const prevWet = wetEvent; wetEvent = wetHere;
      for (let i = 0; i < 6; i++) {
        const v = cone(dx, 0.9, dz, 0.7), sp = 1.8 + Math.random() * 2.2;
        airDrop(fly.position.x, fly.position.y, fly.position.z, v.x * sp, v.y * sp, v.z * sp, rMM(1, 3), -1, 0, 0, 0);
      }
      wetEvent = prevWet;
    }
    return true;
  }

  function restoreRecord(r) {
    if (!r) return;
    let hadLeg = false;
    for (let i = 0; i < r.items.length; i++) {
      const it = r.items[i];
      if (it.part) it.part.visible = true;
      if (it.stump) rm(it.stump);
      if (it.key === "ll" || it.key === "rl") hadLeg = true;
      // a regrown head clears the decap guard so a recycled rig can be
      // decapitated (and geyser) fresh — never permanently flagged.
      if (it.key === "head" && r.actor) r.actor._decapped = false;
    }
    r.items.length = 0;
    if (r.actor && r.actor._lostLimb) r.actor._lostLimb = null;
    // a regrown leg can stand again — clear the can't-walk flag (character.js)
    if (hadLeg && r.ch) r.ch.legGone = 0;
  }

  // adopt peds.js's explosion limb-hide (runs inside the kill tap's finally)
  function adoptLostLimb(ped, imp) {
    if (!ped || !ped._lostLimb || !CBZ.scene) return;
    const key = ped._lostLimb, ch = actorChar(ped);
    if (!ch || !STUMPS[key]) return;
    for (let i = 0; i < severed.length; i++) {
      const r = severed[i];
      if (r.actor === ped && r.ch === ch) {
        for (let j = 0; j < r.items.length; j++) if (r.items[j].key === key) return; // already ours
        break;
      }
    }
    let dir = null;
    if (imp && imp.fromX != null && ped.pos) dir = { x: ped.pos.x - imp.fromX, z: ped.pos.z - imp.fromZ };
    // far kills still get the registry (restore stays guaranteed) but skip the clone
    const far = ped.pos ? dist2Cam(ped.pos.x, ped.pos.z) > 70 * 70 : true;
    severBody(ped, key, { adopt: true, dir, boom: true, noFly: far });
  }

  // public: explicit sever (death.js drives the PLAYER's headshot/blast losses)
  CBZ.goreSever = function (actor, key, opts) { return severBody(actor, key, opts || {}); };
  // public: restore EVERYTHING this actor lost (player respawn / rig handback)
  CBZ.goreRestoreBody = function (actor) {
    if (!actor) return;
    for (let i = severed.length - 1; i >= 0; i--) {
      if (severed[i].actor === actor) { restoreRecord(severed[i]); severed.splice(i, 1); }
    }
  };
  /* ---- AN AMPUTATION IS PERMANENT FOR THE LIFE IT HAPPENED IN --------------
     The audit used to restore any severed record whose actor was ALIVE:

         const alive = a && (a.isPlayer ? !(CBZ.player && CBZ.player.dead) : !a.dead);
         if (!a || alive || a.culled || actorChar(a) !== r.ch) { restoreRecord(r); ... }

     So a shark tore a swimmer's leg off, the flying leg and the stump appeared,
     and within one audit tick (≤0.85 s) the leg POPPED BACK ON and the stump
     vanished while the victim was still swimming — plus ch.legGone cleared, so
     the one-legged collapse ended too. The audit's own comment says its job is
     RIG RECYCLING and player respawn. "This person survived" was never the
     question it was trying to answer; `alive` was just the cheapest proxy for
     "this rig has been handed to somebody else", and it is a wrong one.

     THE NEW RULE, and why it cannot leak a permanently one-legged pooled bot:

     (1) !a / a.culled / actorChar(a) !== r.ch — unchanged, and still the
         backbone. A rig that is gone, reaped, or now worn by a different
         character always hands its parts back.

     (2) a._parked — crowd.js's park() marks a pooled rig as off-map furniture
         (city/crowd.js:1309) BEFORE assign() can hand it to a stranger. This
         is the recycle path that (1) genuinely misses: park keeps the same
         ped object AND the same ch, and assign() then clears dead/culled/
         _parked in one go, so neither `culled` nor the char identity ever
         changes across a full recycle.

     (3) deadAtSever — a body that was a CORPSE when the part came off and is
         alive again did not survive anything; it is a respawn (death.js also
         calls CBZ.goreRestoreBody explicitly, so this is belt-and-braces) or a
         corpse rig put back into service. Restore.

     (4) a._crowd past SEV_RECYCLE2 — the one hole (2) cannot close by itself.
         park() and assign() can run in the SAME frame (crowd.js updatePromotion
         parks in loop 1 and promotes into a freed slot in loop 2), so `_parked`
         is not a latch anything can be guaranteed to observe. What IS
         guaranteed is the geometry: crowd.js parks only past PROMO_OUT2 = 48 m
         from the player, and a walking body cannot cross from inside 38 m to
         past 48 m in one frame. This audit now runs EVERY frame, so a pooled
         rig is always handed back whole while it is still 38-48 m out, long
         before any recycler can claim it — and 38 m of lens distance is where
         a limb reappearing is a couple of pixels. `_crowd` is set once, at
         construction, in crowd.js makePooled(), and it is the game-wide tag
         for "ambient body that will be reused" (hitman/vips/racing/campaign
         all gate on it). Every OTHER actor — named peds, gang members, island
         NPCs, the player — is a real person whose rig is never handed to
         someone else while alive: crowd.js CONSUMES the pool slot the moment a
         promoted body dies (`pool[s] = { ped: makePooled(), idx: -1 }`), and
         peds.js's corpse reap sets p.culled, which is clause (1).

     Cost of running every frame instead of every 0.85 s: severed.length is
     capped at SEV_CAP = 24 and each record is a handful of property reads. */
  const SEV_RECYCLE2 = 38 * 38;
  function severAudit() {
    for (let i = severed.length - 1; i >= 0; i--) {
      const r = severed[i], a = r.actor;
      // (1)+(2) the rig is gone, reaped, parked, or worn by someone else
      if (!a || a.culled || a._parked || actorChar(a) !== r.ch) { restoreRecord(r); severed.splice(i, 1); continue; }
      const alive = a.isPlayer ? !(CBZ.player && CBZ.player.dead) : !a.dead;
      if (!alive) continue;                     // a corpse keeps what was taken off it
      // (3) a corpse that is alive again was respawned or recycled
      if (r.deadAtSever) { restoreRecord(r); severed.splice(i, 1); continue; }
      // (4) a living POOLED body, far enough out that a recycler may claim it
      if (a._crowd && a.pos && dist2Cam(a.pos.x, a.pos.z) > SEV_RECYCLE2) { restoreRecord(r); severed.splice(i, 1); }
    }
  }

  CBZ.gore = function (x, y, z, opts) {
    opts = opts || {};
    if (!CBZ.scene) return;
    // distance gate: a death far from the camera (e.g. the bird's-eye mass
    // sim, or the far side of the island) skips the gibs/flash/shake entirely
    // so hundreds of off-screen kills can't flood the scene or strobe the view.
    const d2 = dist2Cam(x, z);
    if (CBZ.camera && CBZ.camera.position && d2 > 70 * 70) return;
    const far = d2 > 40 * 40;          // mid-distance → spawn fewer particles (LOD)
    const lod = far ? 0.5 : 1;

    // WHICH MEDIUM did this wound happen in? Everything from LAYER 1 down is
    // air physics, and goreMedium() says whether that is a lie. Arming
    // wetEvent here covers the WHOLE event, delayed beats included, so the
    // dismemberment vents below follow the medium for free.
    // opts.medium lets a caller that already knows (a shark's seize, a drowning)
    // state it outright rather than round-tripping through the terrain query.
    const wet = waterOn() && (opts.medium === "water" ||
      (opts.medium !== "air" && woundInWater(x, y, z)));
    wetEvent = wet;

    const amt = opts.amount != null ? opts.amount : 1;
    // the kill-context tap (one per cityKillPed call) tells us HOW they died —
    // consumed once so the explosion-stump second burst keeps stock treatment.
    let ctx = null;
    if (killCtx && !killCtx.used) { killCtx.used = true; ctx = killCtx; }
    /* EXPLICIT VICTIM (opts.actor) — the seam systems/childsafe.js already
       names. The kill-context tap only exists in the CITY: it wraps
       cityKillPed, so a city death arrives here knowing WHO died and gets a
       wound stamped on the body and real dismemberment for free, while every
       survival death arrived anonymous. That is why the island's deaths could
       only ever be drawn with generic flying boxes — there was no body to take
       anything off. A caller that knows its victim now simply says so. */
    if (!ctx && opts.actor) ctx = { ped: opts.actor, imp: opts.imp || null, cause: "", used: true };
    const cause = ctx ? ("" + (ctx.cause || "")).toLowerCase() : "";
    // headshot / explosion get a heavier, mistier, gorier treatment. Callers
    // signal a headshot either explicitly (opts.head) or with a fat amount(>=1.3).
    const head = !!opts.head || amt >= 1.3 || cause === "headshot";
    const boom = !!opts.explosion;
    const big = head || boom;
    // melee kills read by their weapon: blunt knocks teeth loose then bleeds
    // out slow; a blade opens an artery. Run-overs drag a smear down the road.
    const blade = opts.melee === "blade" || cause === "stabbed" || cause === "executed";
    // "beaten to death" (systems/vitals.js: a long beating of a man already out) is a
    // blunt kill too; the exact-match test used to hand it a bullet hole
    const blunt = opts.melee === "blunt" || cause === "beaten" || cause.indexOf("beaten to") === 0 || cause === "finished off";
    // a man who BLED OUT already carries the holes that did it (and a punch
    // left none): the death itself opens no new one
    const bledOut = cause === "bled out";
    const ranOver = !!opts.smear || cause === "run over";
    // BITTEN: a predator kill is neither a blade nor a blunt hit — it is two
    // opposing rows of torn punctures, which systems/wounds.js models properly
    // (CBZ.bodyBite). The kill tap already knows the cause, so routing it here
    // gets every mauling in the game the right wound with ZERO changes at any
    // kill site — the same trick blade/blunt have always used. Deliberately
    // does NOT fire the arterial-arc / bleed-out beats: those are the knife
    // and the beating, and a maul reads wrong with either.
    // NOTE the word boundaries: "beaten"/"beaten to death" are LIVE blunt-kill
    // causes in this game and they contain the substring "eaten". A naive
    // /eaten/ would have quietly turned every beating into a bite wound.
    const bitten = opts.melee === "bite" ||
      /maul|bitten|\bbit\b|savag|devour|\beaten\b|shark|jaws/.test(cause);

    // the corpse CARRIES its killing hit (systems/wounds.js): the kill tap
    // already knows WHO died and HOW, so kills arriving from ANY pipeline
    // (player, ped-vs-ped, cops) stamp an entry wound + clothing soak with
    // zero changes at the kill sites. Guarded + self-gating (distance/caps).
    if (ctx && ctx.ped && CBZ.bodyWound && !bledOut) {
      // ANCHOR AT THE REAL IMPACT POINT: the kill impulse carries the actual ray
      // hit point (fpsmode threads imp.point) and caliber, so seat the wound THERE
      // on the struck body part — not at the generic gore centre (ped.pos + 1.0)
      // the kill site handed us. Falls back to the gore centre / amount for kills
      // that carry no ray (NPC-vs-NPC rolls, melee, disasters).
      const wp = (ctx.imp && ctx.imp.point && ctx.imp.point.x != null) ? ctx.imp.point : { x, y, z };
      const wcal = (ctx.imp && ctx.imp.cal != null) ? ctx.imp.cal : amt;
      // opts.jaw (bite radius in metres) rides through so a great white leaves
      // a great white's jaw print, not the 0.22 default a dog would leave.
      // opts.dir rides through for the same reason opts.jaw does: wounds.js
      // needs the through-line to place an EXIT mark on the far face. It is
      // read seven lines below to fan the spray, so it was already here — it
      // simply was not handed to the thing that stamps the body.
      CBZ.bodyWound(ctx.ped, wp, {
        head, cal: wcal, jaw: opts.jaw, dir: opts.dir,
        melee: blunt ? "blunt" : (blade ? "blade" : (bitten ? "bite" : null)),
      });
    }

    let dx = 0, dz = 0, hasDir = false;
    if (opts.dir) { dx = opts.dir.x || 0; dz = opts.dir.z || 0; hasDir = (dx || dz); }
    const dm = Math.hypot(dx, dz) || 1; dx /= dm; dz /= dm;
    // perpendicular axis (for fanning the spray to either side of the shot line)
    const px = -dz, pz = dx;
    const skin = opts.skin != null ? opts.skin : 0xc98a5e;
    const cloth = opts.cloth != null ? opts.cloth : 0xd24a32;
    /* opts.lens === false — THE CALLER ALREADY JOLTED THE CAMERA for this
       exact event, so this death must not jolt it a second time. One event,
       one shake. Nothing else here changes; the blood, the pools and the
       dismemberment are untouched. The case that forced it: a mounted shark
       bite fires its own lens tap in city/wildlife_tame.js and THEN routes the
       kill through surv.hurt → trauma.js → here, so every mouthful shook the
       camera twice — and in Shark Sim a mouthful lands every two seconds. */
    const lens = opts.lens !== false;

    // --- REAL DISMEMBERMENT (severity follows WHAT actually hit them) --------
    //   muzzle-close shotgun headshot → the head can sever; every other round
    //   keeps the body intact; explosion → 1-3 limbs torn off BY PROXIMITY;
    //   muzzle-close shotgun body hit → rarely an arm at the shoulder. Falls/blunt/
    //   blade keep the body whole.
    let popHead = !!opts.pop;          // explicit (death.js drives the player's corpse)
    if (ctx && ctx.ped && !ctx.ped.isPlayer) {
      const sevDir = hasDir ? { x: dx, z: dz } : null;
      /* opts.limbs — HOW MANY LIMBS THIS DEATH ACTUALLY TEARS OFF, stated by
         the caller instead of inferred from a weapon. The city infers it from
         the kill (a blast's proximity, a muzzle-close shotgun) because it has
         a weapon to infer from; a tornado does not. systems/trauma.js's cause
         table prices it per cause, and this is what replaced the island's
         generic flying boxes: a tornado takes an ARM off — the real mesh,
         cloned from the real rig with the real clothing on it, tumbling and
         leaving a stump — rather than throwing anonymous red cubes. */
      if (opts.limbs != null) {
        // AN EXPLICIT COUNT IS AUTHORITATIVE and skips the inference below.
        // The tornado asks for `explosion` styling (omnidirectional spray, no
        // shot line) AND states its own limb count — without this precedence
        // the blast branch fired as well and severed a third limb off the back
        // of the proximity roll, so "2" quietly meant "2 or 3 or 4".
        const want = Math.min(4, Math.round(opts.limbs));
        const pool = SEV_LIMBS.slice();
        // A BITE TAKES THE LIMB IT CLOSED ON, and the biter keeps it (THE
        // MOUTHFUL). Every other cause still draws from the pool at random.
        const biter = bitten ? (opts.by || (ctx.imp && ctx.imp.by) || null) : null;
        const bp = bitten && ctx.imp && ctx.imp.point && ctx.imp.point.x != null ? ctx.imp.point : null;
        for (let i = 0; i < want && pool.length; i++) {
          let k = bp ? nearestLimb(actorChar(ctx.ped), bp, pool) : null;
          if (!k) k = pool[(Math.random() * pool.length) | 0];
          pool.splice(pool.indexOf(k), 1);
          severBody(ctx.ped, k, { dir: sevDir, boom: !!boom, by: biter });
        }
      } else
      // NOTE: the local `head` flag also trips on amount>=1.3 (a heat heuristic
      // for the mist/spray) — severing the actual head trusts only the explicit
      // signals, or an RPG would decapitate every victim it ALSO de-limbs.
      if (boom || cause === "explosion") {
        // Limbs lost scale with proximity, but ordinary blast deaths stay
        // whole. Only the blast seat can take two; edge victims usually keep
        // every joint and simply ragdoll from the pressure wave.
        let bd = 99;
        if (ctx.imp && ctx.imp.fromX != null && ctx.ped.pos) bd = Math.hypot(ctx.ped.pos.x - ctx.imp.fromX, ctx.ped.pos.z - ctx.imp.fromZ);
        const n = bd < 2.2 ? 1 + (Math.random() < 0.35 ? 1 : 0)
          : (bd < 4.8 ? (Math.random() < 0.55 ? 1 : 0) : (Math.random() < 0.16 ? 1 : 0));
        for (let i = 0; i < n; i++) severBody(ctx.ped, SEV_LIMBS[(Math.random() * 4) | 0], { dir: sevDir, boom: true });
      } else if (opts.head || cause === "headshot") {
        if (headPops(ctx.imp)) {
          popHead = severBody(ctx.ped, "head", { dir: sevDir });
          // CITY: only a muzzle-close SHOTGUN headshot is a FULL
          // DECAPITATION — the head mesh is already OFF (severBody hid the neck
          // group, launched the flying head + seated the stump cap); now open the
          // neck with a heavy arterial geyser so the stump reads visceral. The
          // restore-on-reuse audit regrows the head on any recycle, so a reused
          // rig is never permanently headless. Pistol/SMG never reach here.
          if (popHead && cityMode() && !ctx.ped._decapped && headDecaps(ctx.imp)) {
            ctx.ped._decapped = true;   // guard: one geyser per head (cleared on regrow)
            neckStumpSpurt(ctx.ped, x, y, z, dx, dz, lod);
          }
        }
        // no pop: the ragdoll kick already whips the skull with the round —
        // the entry burst/wound below is the rest of the read
      } else if (ctx.imp && ctx.imp.wkey === "shotgun" && (ctx.imp.dist == null ? 99 : ctx.imp.dist) <= 4.5 && Math.random() < 0.10) {
        severBody(ctx.ped, Math.random() < 0.5 ? "la" : "ra", { dir: sevDir });
      }
    }

    // --- WATER MEDIUM: everything below here is AIR physics ------------------
    // Layers 1-5 and every cause beat are ballistic or ground-frame effects:
    // droplets that arc down onto floorAt, pools stamped on the ground, a wall
    // decal found by a collider ray, a tire smear along a road. Underwater not
    // one of them is right — the spray would sink to the seabed and stamp
    // pools nobody will ever see, and the wall scan would paint blood on the
    // hull of a passing boat. So a wet kill emits the bloom + the surface
    // slick + a chum trail and returns. Dismemberment above already ran: a limb
    // torn off underwater is still torn off. The flash/shake/slow-mo/sfx tail
    // is kept, with the lens jolt cut back — see below.
    if (wet) {
      _wdir.x = hasDir ? dx : 0; _wdir.y = 0; _wdir.z = hasDir ? dz : 0;
      // the burst at the wound, then a second bloom up the body for volume
      // ONE bloom. There used to be a second one "up the body for volume" —
      // two stacked clouds on one wound is the red wall, not volume.
      CBZ.goreBloom(x, y + 0.35, z, { amount: 1.0 * amt + (big ? 0.5 : 0), dir: hasDir ? _wdir : null, arterial: true });
      CBZ.goreSlick(x, z, 0.5 + amt * 0.5 + (big ? 0.3 : 0));
      // THE KILL KEEPS BLEEDING for a beat afterwards. This is the seam a
      // hunting animal reads (CBZ.goreChumList) — it is what makes a body in
      // the water actually pull something toward it instead of being decor.
      CBZ.goreChum(x, y + 0.6, z, Math.min(1, 0.5 + amt * 0.3), 7 + amt * 2);
      if (CBZ.shake && lens) CBZ.shake(0.26 * amt + (opts.player ? 0.4 : 0) + (boom ? 0.2 : 0));
      if (opts.slowmo && CBZ.doSlowmo) CBZ.doSlowmo(opts.slowmo);
      if (opts.sfx && CBZ.sfx) CBZ.sfx(typeof opts.sfx === "string" ? opts.sfx : "hit");
      wetEvent = false;
      return;
    }

    // --- LAYERS 1+2: THE BLOOD IN THE AIR (see THE AIRBORNE BLOOD) --------
    // `y` arrives chest-high: the chest is ~+0.35 above it, the head ~+1.1.
    // Each cause throws what that cause throws: a round an entry spatter and
    // an exit spray + mist down its line, a blast a ring of drops and a dark
    // puff, a blade heavy drops and a stream (its arterial beats come with the
    // cause beats below), a beating nothing here (the split lip is bluntBurst).
    // A player's round has usually just sprayed this body through
    // CBZ.gore.spray, so the kill adds a lighter second burst, not a double.
    {
      const al = airLod(x, z) * (far ? 0.6 : 1);
      if (boom) blastBlood(x, y + 0.35, z, amt, al);
      else if (blade) stabBlood(x + dx * 0.15, y + 0.35, z + dz * 0.15, dx, dz, amt, al);
      else if (blunt) { /* bluntBurst, below */ }
      else if (!hasDir) omniBlood(x, y + 0.35, z, amt, al);
      else {
        const hy = head ? 1.1 : 0.35;
        // opts.exit: the fire path's own answer (verbs_strike V.roundExits);
        // absent = the old assumption that a killing round went through
        const through = opts.exit != null ? !!opts.exit : true;
        shotBlood(x - dx * 0.12, y + hy, z - dz * 0.12, dx, 0, dz, amt * (sprayedHere(x, z) ? 0.4 : 1), through, head, al, popHead);
      }
    }

    // --- LAYER 3: chunky GIBS — limbs/torso, heavier, tumble then settle ------
    // THE DEBRIS LAW: a normal gunshot DROPS the person (ragdoll.js leaves an
    // intact body) — it does not blow them into clothing cubes. So reserve the
    // multi-gib spray for EXPLOSIONS. Actual close-shotgun severing launches the
    // cloned body part above; an ordinary kill gets ZERO generic flying boxes.
    // Jail/survival keep the original chunky spray on every kill, UNLESS the
    // caller prices it: `opts.gib` (0 = none, 1 = stock, >1 = more) is how
    // systems/trauma.js says that a BEATING throws no body chunks while a
    // tornado throws more than a blast does. Absent → stock, byte for byte.
    let ng = Math.round((big ? 7 : 5) * amt * lod * (opts.gib == null ? 1 : Math.max(0, opts.gib)));
    // THE PRISON GETS THE SAME ANSWER (owner, on the escape shootout: "remove
    // the cubes of blood"). debrisLaw() is cityMode() || GORE_REALISM_V2, so the
    // rule the city and then the island each arrived at separately is now one
    // rule for every mode; the survMode() line below still stands for a build
    // that turns the realism flag off.
    if (debrisLaw()) ng = boom ? Math.round(6 * amt * lod) : 0;
    /* THE DISASTER ISLAND GETS THE CITY'S ANSWER (owner: "I hate the blood
       blocks"). The city deleted these for exactly this complaint a wave ago —
       "a shootout buried the floor in permanent clothing-colored boxes, not
       realistic" — and survival kept them, so a handful of deaths on a green
       hillside left a scatter of red LEGO on it. Recolouring them wound-dark
       last round made them read as MEAT bricks, which is not better.
       A generic cube was only ever a stand-in for a body part, and this file
       has had the real thing all along: severBody clones the ACTUAL limb mesh
       off the ACTUAL rig ("Never a generic red cube", its own comment). So the
       island stops throwing boxes and starts taking arms off — see opts.limbs
       above. (Jail/escape used to be exempt here; the owner filmed the prison
       yard with the same complaint, so debrisLaw() above now covers it too and
       this line only stands for a build running GORE_REALISM_V2=0.) */
    else if (survMode()) ng = 0;
    // A TORN-OFF PIECE IS NOT CLEAN LAUNDRY (owner-filmed on the island: the
    // hillside after a disaster read as pastel confetti, not as gore). Four of
    // the seven palette entries were the victim's RAW skin and shirt colours —
    // cream, pale blue, pale pink — so on a white mountain the chunks looked
    // like litter. Every piece now comes off the body already soaked: the skin
    // and cloth entries are dragged most of the way to wound-dark, so the
    // silhouette still says "that was their jacket" while the colour says meat.
    // Quantised before caching so a hundred distinct outfits cannot mint a
    // hundred distinct shared materials.
    const cols = meatOn()
      ? [BLOOD_D, bloodied(cloth, 0.62), BLOOD, bloodied(skin, 0.78), 0xb8443a, BLOOD_D, bloodied(cloth, 0.82)]
      : [skin, cloth, BLOOD, cloth, skin, 0xb8443a, BLOOD_D];
    for (let i = 0; i < ng; i++) {
      const side = (Math.random() - 0.5) * 2, a = Math.random() * 6.28, sp = 3 + Math.random() * 5;
      const omni = boom || !hasDir;
      spawnBit(x, y + 0.5 + Math.random(), z,
        omni ? Math.cos(a) * sp : dx * (5 + Math.random() * 3) + px * side * 3,
        4.5 + Math.random() * 5.5 + (boom ? 3 : 0),
        omni ? Math.sin(a) * sp : dz * (5 + Math.random() * 3) + pz * side * 3,
        0.2 + Math.random() * 0.3, cols[i % cols.length], "gib");
    }

    // --- LAYER 4: ground POOL — lingers, spreads, biased forward of the body --
    // a blunt kill barely pools NOW (the bleed-out arrives in waves, below);
    // everything else drains immediately and forward of the body.
    const pgx = hasDir ? x + dx * 0.4 : x, pgz = hasDir ? z + dz * 0.4 : z;
    const pk = realism() ? POOL_K : 1;
    spawnSplat(pgx, pgz, (blunt ? 0.45 : (1.1 + amt * 0.9 + (big ? 0.6 : 0))) * pk, BLOOD_D, true);
    if (big) spawnSplat(x - dx * 0.5, z - dz * 0.5, (0.6 + amt * 0.4) * pk, BLOOD, true);
    // A FEW BIG SPLATS, not two dozen equal blobs: the heavy slugs of blood
    // that leave the wound first land as one or two torn impact splats down
    // the shot line; the fine spray (LAYER 1) lands as small marks around them.
    if (!blunt) {
      const nbig = (head || big) ? 2 : 1;
      for (let i = 0; i < nbig; i++) {
        const r = hasDir ? 0.5 + Math.random() * 1.2 : Math.random() * 0.6, sd = (Math.random() - 0.5) * 0.6;
        _splatO.dirX = hasDir ? dx : null; _splatO.dirZ = hasDir ? dz : null; _splatO.radial = !hasDir;
        spawnSplat(x + dx * r + px * sd, z + dz * r + pz * sd, (0.1 + Math.random() * 0.1) * (0.7 + amt * 0.4), BLOOD, false, _splatO);
      }
    }
    if (!blunt) restingPool(pgx, pgz, amt);   // blunt already drains in waves below

    // --- LAYER 5: WALL SPLATTER — vertical decal on a surface behind the body -
    // headshots paint the wall INSTANTLY (pre-grown decal) and half-again bigger.
    if (hasDir && !far) spawnWallSplat(x, y + 0.5, z, dx, dz, head ? amt * 1.6 : amt, head);

    // --- CAUSE BEATS: the kill's signature (skipped at distance — pure LOD) ---
    if (!far) {
      // bone only flies when the head actually came apart — a pistol/SMG
      // headshot is a snap + blood, never skull fragments
      if (popHead && hasDir) skullFrags(x, y, z, dx, dz, lod);
      if (blade) arterialArcs(ctx && ctx.ped, x, y, z, dx, dz);
      if (blunt) {
        bluntBurst(x, y, z, dx, dz, hasDir);
        if (ctx && ctx.ped) delayedBleedPool(ctx.ped);
      }
    }
    // run-over smear: the streak starts under the body and is dragged down-range
    // along the car's travel line. Length scales with the impact fling (≈speed).
    // and the car that did it wears him: bumper, bonnet, screen
    if (ranOver && !far) {
      const rc = (ctx && ctx.imp && ctx.imp.car) || nearestCar(x, z, 5);
      // a strike paints its own contacts as they happen (CBZ.goreCarStrike)
      if (rc && !(ctx && ctx.imp && ctx.imp.strike)) runOverBlood(rc, x, y, z, amt);
    }
    if (ranOver && hasDir) {
      let sl = opts.smearLen || 0;
      if (!sl && ctx && ctx.imp && ctx.imp.fling) sl = 2.2 + Math.min(6.5, ctx.imp.fling * 0.55);
      if (!sl) sl = 4;
      spawnStreak(x - dx * 0.8, z - dz * 0.8, dx, dz, sl);
    }

    if (CBZ.shake && lens) CBZ.shake(0.26 * amt + (opts.player ? 0.4 : 0) + (boom ? 0.2 : 0));
    if (opts.slowmo && CBZ.doSlowmo) CBZ.doSlowmo(opts.slowmo);
    if (opts.sfx && CBZ.sfx) CBZ.sfx(typeof opts.sfx === "string" ? opts.sfx : "hit");
    wetEvent = false;
  };

  // LOCALIZED FLESH IMPACT — intentionally not a death event. It emits a small
  // directional wet spray/mist with no pool, gibs, flash, slow-mo or kill-context
  // consumption. fpsmode uses this once per connecting pellet; the actual death
  // pipeline calls CBZ.gore exactly once if that hit puts the actor down.
  CBZ.gore.spray = function (point, amount, dir, opts) {
    if (!point || !CBZ.scene) return;
    const d2 = dist2Cam(point.x, point.z);
    if (CBZ.camera && CBZ.camera.position && d2 > 65 * 65) return;
    const amt = Math.max(0.25, Math.min(1.4, amount == null ? 0.7 : amount));
    // WATER: a pellet hitting flesh under the sea doesn't spray, it BLOOMS —
    // one small two-layer plume instead of drops that would rain on the seabed.
    if (waterOn() && CBZ.goreMedium(point.x, point.y, point.z) === "water") {
      CBZ.goreBloom(point.x, point.y, point.z, { amount: 0.45 + amt * 0.55, dir: dir || null });
      return;
    }
    let dx = dir ? (+dir.x || 0) : 0, dy = dir ? (+dir.y || 0) : 0, dz = dir ? (+dir.z || 0) : 0;
    const dl = Math.hypot(dx, dy, dz);
    const al = airLod(point.x, point.z);
    noteSpray(point.x, point.z);
    if (dl < 0.001) { omniBlood(point.x, point.y, point.z, amt * 0.6, al); return; }
    dx /= dl; dy /= dl; dz /= dl;
    // WHAT GOES THROUGH. A full-bore round (0.58 x calibre for a body, 0.95
    // for a head) exits and throws the big spray out of the far side; a
    // buckshot pellet (0.28-0.34) or a spent round stays in, so it is the
    // entry spatter alone. When the fire path knows (opts.exit, decided by
    // verbs_strike's V.roundExits) its answer wins over the amount guess.
    const through = opts && opts.exit != null ? !!opts.exit : amt >= 0.45;
    shotBlood(point.x, point.y, point.z, dx, dy, dz, amt, through, amt >= 0.9, al, false);
  };

  /* ============================================================
     CBZ.goreImpact(x, y, z, opts) — BLUNT TRAUMA. NOT A DEATH.

     Everything above this line is a KILL event: it pools, gibs, dismembers,
     flashes the lens, consumes the kill context and can trip slow-mo. There
     was no way to say "this body is BLEEDING, not dying", so every caller who
     wanted blood had to fire a kill — which is precisely how the disaster
     island ended up opening the same red faucet for a man who FROZE TO DEATH,
     and never once for the man you threw off the mountain on the way there.

     So trauma gets its own emitter and its own physics:
       • a WET SPRAY off the struck side, thrown along the surface normal —
         the direction you were driven, mirrored back out of the flesh
       • a MIST puff only when the impact was hard enough to atomise anything
         (a shove that splits a lip does not aerosolise)
       • a GROUND POOL only once the wound is genuinely open (opts.pool) —
         a bruise leaves nothing behind, and that restraint is the whole point
       • the WALL SPLAT you earn by being driven INTO the wall (opts.wall),
         which reuses the same opaque/wall-sized scan a headshot does
     No gibs, no dismemberment, no kill-context consumption, no slow-mo, and
     the lens jolt only for the player. Water-aware for free: a wound taken
     under the sea blooms instead of raining droplets on the seabed.

     opts: { dir:{x,y,z} (away from the surface), amount:0.2..2, mist:bool,
             pool:bool, wall:bool, player:bool, sfx:bool|string,
             blade:bool (a cut: heavy drops + a short stream, no mist) }
  ============================================================ */
  CBZ.goreImpact = function (x, y, z, opts) {
    if (!CBZ.scene) return;
    opts = opts || {};
    const d2 = dist2Cam(x, z);
    if (CBZ.camera && CBZ.camera.position && d2 > 70 * 70) return;
    const lod = d2 > 40 * 40 ? 0.5 : 1;
    const amt = Math.max(0.2, Math.min(2, opts.amount == null ? 0.7 : opts.amount));

    let dx = opts.dir ? (+opts.dir.x || 0) : 0;
    let dy = opts.dir ? (+opts.dir.y || 0) : 0;
    let dz = opts.dir ? (+opts.dir.z || 0) : 0;
    const dl = Math.hypot(dx, dy, dz);
    const hasDir = dl > 0.001;
    if (hasDir) { dx /= dl; dy /= dl; dz /= dl; }

    // WATER: a body slammed into a reef or beaten in the surf blooms. Same
    // branch gore() takes, for the same reason — droplets are air physics.
    if (waterOn() && woundInWater(x, y, z)) {
      _wdir.x = dx; _wdir.y = dy; _wdir.z = dz;
      CBZ.goreBloom(x, y, z, { amount: 0.5 + amt, dir: hasDir ? _wdir : null });
      if (opts.pool) CBZ.goreSlick(x, z, 0.4 + amt * 0.6);
      if (opts.sfx && CBZ.sfx) CBZ.sfx(typeof opts.sfx === "string" ? opts.sfx : "hit");
      return;
    }

    // THE SPRAY. A blunt impact does not have a shot line to exit along, so
    // the fan is wide and the throw is short: blood leaves the wound at the
    // speed the body arrived, not at the speed of a round. opts.blade is a
    // cut: heavy drops and a short stream instead (see THE AIRBORNE BLOOD).
    const al = airLod(x, z) * lod;
    if (opts.blade) stabBlood(x, y, z, hasDir ? dx : 0, hasDir ? dz : 0, amt, al);
    else bluntBlood(x, y, z, dx, dy, dz, hasDir, amt, al, !!opts.mist);
    // the pool is the RESTRAINT: only an open wound leaves evidence on the
    // ground, so a bruising hit passes pool:false and stains nothing.
    if (opts.pool) spawnSplat(x + dx * 0.3, z + dz * 0.3, 0.5 + amt * 0.75, BLOOD_D, true);
    // driven INTO something → it wears the hit. Same wall-sized/opaque gate.
    if (opts.wall && hasDir && lod === 1) spawnWallSplat(x, y, z, -dx, -dz, amt * 0.85, true);
    // (the player's own hit is a flinch, systems/eyes.js: never a red rim)
    if (opts.sfx && CBZ.sfx) CBZ.sfx(typeof opts.sfx === "string" ? opts.sfx : "hit");
  };

  // one always-updater drives gibs + mist + pools + wall splats + the red jolt
  CBZ.onAlways(8, function (dt) {
    if (dt <= 0) return;
    wetEvent = false;                    // bound any leaked wet event to one frame
    if (surfSlickT > 0) surfSlickT -= dt; // the shared surface-slick budget (see surfaceSlick)
    // the terrain-gradient memo is a ONE-FRAME cache: a sinkhole opening or a
    // crater collapsing rewrites floorAt under us, and a decal stamped next
    // frame must fit the ground that is there NOW.
    if (slopeMemo.size) slopeMemo.clear();
    _msX = 1e9;                          // and the aerosol-over-sea cell memo (see mistOverSea)
    if (!killTapped) installKillTap();   // peds.js loads after us — tap once it exists
    // the land-decal layer lives in the scene from the first frame, so its one
    // program compiles at load and not in the frame of the first kill
    if (CBZ.scene && (!ldMesh || ldMesh.parent !== CBZ.scene)) landLayer();
    // ...and the air layer's, for the same reason
    if (CBZ.scene && !airMesh) airReady();
    // NOTHING PAINTS THE VIEW RED (owner: "the screen turning red ... is
    // dumb"): a kill beside you is the blood on the floor and on the walls.

    // delayed gore beats (arterial spurts / bleed-out pools)
    for (let i = later.length - 1; i >= 0; i--) {
      const L = later[i]; L.t -= dt;
      // the beat runs in the medium its kill happened in (see after())
      if (L.t <= 0) { later.splice(i, 1); wetEvent = L.wet; try { L.fn(); } catch (e) {} wetEvent = false; }
    }

    // water medium: the sustained bleed sources, then every live plume puff
    plumeClock += dt;
    updateChum(dt);
    updatePuffs(dt);
    // the air: streams lay their drops, every drop and puff flies, lands, stains
    if (CBZ.scene && airMesh && airMesh.parent !== CBZ.scene) airReady();
    updateAir(dt);

    // the dismemberment audit: recycled/respawned rigs get their parts back
    // THE DISMEMBERMENT AUDIT RUNS EVERY FRAME. It used to ride the 0.85 s
    // corpse-stain throttle, which was fine while its rule was "alive → restore"
    // but is not fine now that the rule is a distance one: see clause (4) in
    // severAudit — the guarantee that no pooled rig reaches crowd.js's park/
    // assign swap still missing a leg depends on this test being made on the
    // frame the body crosses SEV_RECYCLE2. At SEV_CAP = 24 records it is free.
    if (severed.length) severAudit();
    if (mouthfuls.length) updateMouthfuls(dt);

    // The debris law drives the realistic fade/settle/cull path; with it off,
    // jail/survival fall back to the original gib physics (read once per frame).
    const gibCity = debrisLaw();
    // read the shared snow coverage ONCE for the whole sweep (see the burial
    // block) — it is a getter over one integrator, but this loop runs over
    // every live bit and every live decal.
    const snowCoverNow = snowCover();
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i], m = b.m;
      // AND SNOW COVERS WHAT IS LYING ON IT. A landed chunk is a small solid
      // on the ground, so the same fall of snow that takes the pools takes it
      // — otherwise a whiteout ends with a pristine field and a scatter of red
      // boxes still sitting on top. Each piece carries its own jittered depth,
      // so they go under one at a time rather than blinking out together.
      if (b.landed && b.kind === "gib" && snowCoverNow > 0 && buriedBy(b, snowCoverNow) >= 1) {
        rm(m); bits.splice(i, 1); continue;
      }
      // CITY only: a LANDED gib has come to rest ON the ground — it stops
      // simulating (no jitter) and counts down, FADING/SINKING out near
      // end-of-life so the battlefield clears. Jail/survival never set this
      // early-rest state (b.landed stays in the original physics path below),
      // so they fall through to the byte-identical settle/expire logic.
      if (gibCity && b.landed) {
        b.life -= dt;
        // CITY debris: over the last ~1.6s of life the gib SHRINKS toward zero
        // and SINKS into the road, so it dissolves out of the world instead of
        // popping. Cheap: one scale + y nudge.
        if (b.fade && b.life < 1.6) {
          const k = Math.max(0, b.life / 1.6);   // 1 → 0
          if (b.vScale) {                        // severed-limb clone: shrink vs its own scale
            m.scale.set(b.vScale.x * k, b.vScale.y * k, b.vScale.z * k);
          } else {
            const s = b.baseScale * k;
            m.scale.set(s, s * 0.5, s);          // generic gib collapses flat as it goes
          }
          m.position.y -= b.rad * (1 - k) * dt * 1.4;  // settle into the ground
        }
        if (b.life <= 0) { rm(m); bits.splice(i, 1); }
        continue;
      }
      // a gib in the water SINKS — full 24 u/s^2 with no drag reads as a rock,
      // not as a piece of a body. One boolean set at spawn, so the land path
      // never pays for the test and stays byte-identical.
      /* A GIB CROSSES THE SURFACE TOO (2026-09-08, the owner's "the bitten-off
         fin floats in mid-air above water" — the same fix as the severed lobes
         in systems/wounds.js). `wet` was decided ONCE at spawn from the joint's
         medium and then the wrong physics ran for the rest of the flight: a leg
         torn off a swimmer at the surface flew UP out of the water at 3-5 m/s
         and hung there under water gravity and water drag, and a limb taken by
         a head that was out of the water fell through the swell as a dry gib.
         One guarded submRaw on a ~0.1 s stagger keeps the flag honest both
         ways; going in is a splash sized to the piece and the water taking most
         of the speed. Bounded: gibs are capped, and submRaw short-circuits to
         DRY with no water system, so land maps pay one call per gib per tenth. */
      if (b.kind === "gib" && waterOn()) {
        b.seaT = (b.seaT || 0) - dt;
        if (b.seaT <= 0) {
          b.seaT = 0.08 + Math.random() * 0.06;
          const sub = submRaw(m.position.x, m.position.y, m.position.z);
          const under = sub !== DRY && sub >= 0;
          if (under && !b.wet) {
            if (CBZ.waterSplashAt) {
              try { CBZ.waterSplashAt(m.position.x, m.position.y + sub, m.position.z, b.limb ? 1.4 : 0.6); } catch (e) {}
            }
            b.vx *= 0.45; b.vy *= 0.35; b.vz *= 0.45;
          }
          b.wet = under;
        }
      }
      if (b.wet) {
        b.vy -= GRAV * 0.22 * dt;
        const wd = Math.pow(0.25, dt);
        b.vx *= wd; b.vy *= wd; b.vz *= wd;
        b.sx *= wd; b.sy *= wd; b.sz *= wd;   // the tumble drags out too
      } else b.vy -= GRAV * dt;
      m.position.x += b.vx * dt; m.position.y += b.vy * dt; m.position.z += b.vz * dt;
      m.rotation.x += b.sx * dt; m.rotation.y += b.sy * dt; m.rotation.z += b.sz * dt;
      // A TORN-OFF PIECE BLEEDS AS IT FLIES: a severed limb sheds a drop every
      // ~55 ms for its first second in the air (a blast chunk, every ~0.1 s
      // for 0.6 s), carried with the piece's own speed, so
      // a severed arm draws a line of blood through the air and a spatter
      // trail where it went. Dry pieces (teeth, bone: `bled` at spawn) don't.
      if (!b.bled && !b.landed && !b.wet) {
        b.trl = (b.trl || 0) + dt;
        if (b.trl < (b.limb ? 1.0 : 0.6)) {
          b.trlT = (b.trlT || 0) - dt;
          if (b.trlT <= 0) {
            b.trlT = b.limb ? 0.04 + Math.random() * 0.03 : 0.07 + Math.random() * 0.05;
            airMarkP = 0.5;
            airDrop(m.position.x, m.position.y, m.position.z,
              b.vx * 0.85 + (Math.random() - 0.5) * 0.6, b.vy * 0.85 + (Math.random() - 0.5) * 0.6, b.vz * 0.85 + (Math.random() - 0.5) * 0.6,
              rMM(0.8, b.limb ? 2.8 : 2), -1, 0, 0, 0);
            airMarkP = 1;
          }
        }
      }
      // the DRAWN ground (see decalFloorAt) — a gib resting on floorAt=0 was
      // buried to its eyeballs in the 8 cm sidewalk slab, same bug as the pools
      const fl = decalFloorAt(m.position.x, m.position.z);
      // rr = the bit's half-height. CITY adds a hair so the piece clears the
      // road paint; jail/survival keep the original bare radius.
      const rr = gibCity ? (b.rad || 0.06) + 0.012 : (b.rad || 0.06);
      if (m.position.y <= fl + rr && b.vy < 0) {
        if (gibCity) {
          // CITY SETTLE: clamp to ground, kill vertical, bleed off horizontal +
          // spin. A slow piece comes to REST this frame; a still-fast one keeps a
          // little tumble/roll before stopping.
          m.position.y = fl + rr; b.vy = 0; b.vx *= 0.22; b.vz *= 0.22; b.sx *= 0.12; b.sy *= 0.12; b.sz *= 0.12;
          if (!b.bled) { b.bled = true; landBleed(b, m); }
          if ((b.vx * b.vx + b.vz * b.vz) < 0.5) { b.landed = true; b.vx = b.vz = b.vy = 0; b.sx = b.sy = b.sz = 0; }
        } else {
          // ORIGINAL jail/survival settle: snap to floor and mark landed at once.
          m.position.y = fl + rr; b.vy = 0; b.vx *= 0.22; b.vz *= 0.22; b.sx *= 0.1; b.sy *= 0.1; b.sz *= 0.1; b.landed = true;
          if (!b.bled) { b.bled = true; landBleed(b, m); }
        }
      }
      if (gibCity) {
        b.airT = (b.airT || 0) + dt;        // gib still in flight
        // safety: a gib flung off the map (never lands) still retires so a long
        // life can't leak the pool.
        if (b.airT > 14) { rm(m); bits.splice(i, 1); continue; }
      } else {
        // ORIGINAL: only a landed gib counts down.
        if (b.landed) b.life -= dt;
      }
      if (b.life <= 0) { rm(m); bits.splice(i, 1); }
    }

    for (let i = splats.length - 1; i >= 0; i--) {
      const s = splats[i]; s.t += dt;
      /* WATER TAKES THE BLOOD BACK (GORE_WASH). The island's headline events
         are a tsunami and a flash flood, and blood used to sit through both:
         the sea would rise eight metres over a street, drain away again, and
         every pool would still be there, crisp, on ground that had just been
         under water. Standing water lifts blood off a surface in seconds, so a
         submerged decal is pushed straight into its fade instead of holding
         its full clock. Once washed it stays washed — blood does not come back
         when the flood goes out, and that receding tide leaving CLEAN ground
         is the whole read. Throttled on a jittered ~0.6 s stagger (this runs
         for every live decal) and skipped for surface slicks, which ARE the
         water. */
      if (!s.water && s.washT !== -1 && washOn()) {
        s.washT = (s.washT || 0) - dt;
        if (s.washT <= 0) {
          s.washT = 0.5 + Math.random() * 0.35;
          if (washDepthAt(s.m.position.x, s.m.position.z) > 0.09) {
            s.hold = Math.min(s.hold, s.t);      // straight into the fade window
            s.fade = Math.min(s.fade, 2.4);      // and gone in a couple of seconds
            s.washT = -1;                        // decided; stop paying for the query
            // and it goes somewhere: standing water lifting a stain is the same
            // event as a wave lifting one, so it gets the same cloud.
            if (swashOn() && !s.dilute) swashTake(s, 0.4);
          }
        }
      }
      /* AND A WAVE RUNNING OVER IT TAKES A BITE (GORE_SWASH). See the block at
         the head of this file. One live-crest read per candidate decal per
         ~0.12 s; the band test retires everything that is not on a shoreline
         after a single query, and a mark washed to nothing retires here. */
      if (!s.water && swashOn() && !s.swashOff) {
        s.swashT = (s.swashT || 0) - dt;
        if (s.swashT <= 0) {
          s.swashT = 0.09 + Math.random() * 0.05;
          if (s.swashBand === undefined) s.swashBand = swashBand(s);
          if (!s.swashBand) s.swashOff = true;
          else {
            const wd = swashDepth(s.m.position.x, s.m.position.y, s.m.position.z);
            if (!s.wetNow && wd > SWASH_ON) { s.wetNow = true; swashTake(s, wd); }
            else if (s.wetNow && wd < SWASH_OFF) s.wetNow = false;
          }
        }
      }
      if (s.water) {
        // A SURFACE SLICK, not a ground pool: the sea MOVES, so the decal
        // re-seats on the live swell every frame instead of on a floorAt seat
        // baked at spawn, and it drifts with the current so the blood ends up
        // downstream of the body — which is the whole reason you can read a
        // kill from a boat. Spreads wider and thinner than a pool.
        s.curT -= dt;
        if (s.curT <= 0) {
          s.curT = 0.4;
          if (CBZ.waterField && CBZ.waterField.currentAt) {
            try {
              const c = CBZ.waterField.currentAt(s.m.position.x, s.m.position.z, undefined, _cur);
              s.cx = isFinite(c.x) ? c.x : 0; s.cz = isFinite(c.z) ? c.z : 0;
            } catch (e) { s.cx = s.cz = 0; }
          }
        }
        s.m.position.x += s.cx * dt; s.m.position.z += s.cz * dt;
        // THE BACKWASH. A slick the swash lifted off the sand leaves with the
        // water that lifted it — fast at first, then handed over to the
        // current as the sheet loses its run. Zero for every other slick, so
        // this is one branch and no maths for blood that just bled where it is.
        if (s.bt > 0) {
          const k = s.bt / (s.bt0 || 1);
          s.m.position.x += s.bx * k * dt; s.m.position.z += s.bz * k * dt;
          s.bt -= dt;
        }
        // THE SURFACE RE-READ IS THROTTLED, and skipped outright when the slick
        // is too far to read. citySeaHeightAt walks the whole swell table, and
        // this used to run for every slick every frame — up to ~300 full swell
        // evaluations a frame during a frenzy, to move decals nobody can see by
        // a few centimetres. ~15Hz inside 60u is indistinguishable.
        s.syT -= dt;
        if (s.syT <= 0) {
          s.syT = 0.066;
          if (dist2Cam(s.m.position.x, s.m.position.z) < 60 * 60) {
            const y = seaY(s.m.position.x, s.m.position.z) + 0.06;
            // a slick born ON THE SAND never sinks through it: when the sheet
            // drains out from under a washed cloud what is left is a diluted
            // film lying on wet sand, not a decal chasing a surface that left.
            s.m.position.y = s.floorY != null ? Math.max(y, s.floorY + 0.03) : y;
          }
        }
        const kw = Math.min(1, s.t / s.growT);
        const scw = s.grow * (0.28 + 0.72 * Math.sqrt(kw));
        s.m.scale.set(Math.max(0.1, scw * s.ax), Math.max(0.1, scw * s.az), 1);
      }
      // (land marks spread, draw and dry on the GPU off one clock — see the
      // STAIN IN THE FLOOR block; nothing to move here)
      const fadeIn = Math.min(1, s.t * 4);
      const fadeOut = s.t > s.hold ? Math.max(0, 1 - (s.t - s.hold) / s.fade) : 1;
      // a slick is a film, not a pool.
      // GOING UNDER: a surface slick is ON the water and is never snowed on.
      const under = s.water ? 0 : buriedBy(s, snowCoverNow);
      // DILUTION: what the sea has already carried off is not on the sand any
      // more. It only ever rises, so a mark the waves have thinned does not
      // come back crisp when the water goes out.
      const dil = s.dilute > 0 ? Math.min(1, s.dilute) : 0;
      /* A SLICK IS A FILM SEEN FROM ABOVE. Looked at edge-on — a chase camera
         riding the waterline — a flat disc a few metres wide foreshortens into
         a long thin smear along the horizon, which is the wrong read entirely
         (from there real blood is simply not visible on the surface). Fade by
         the camera's elevation angle over the slick: gone below ~1 degree,
         full from ~8. A slick is at most ~2 m across, so nothing
         far off can still foreshorten into a 10 m streak. */
      let seen = 1;
      if (s.water && CBZ.camera) {
        const cp = CBZ.camera.position, mp = s.m.position;
        const hx = cp.x - mp.x, hz = cp.z - mp.z;
        const el = (cp.y - mp.y) / (Math.sqrt(hx * hx + hz * hz) + 0.5);
        seen = (el - 0.01) / 0.07; seen = seen < 0 ? 0 : (seen > 1 ? 1 : seen);
      }
      if (s.water) s.m.material.opacity = 0.55 * seen * fadeIn * fadeOut * (1 - under) * (1 - dil);
      // a land mark fades by RECEDING as well as thinning (a translucent red
      // over pale concrete is pink), and what the swash ate comes off its edge
      else if (s.slot >= 0) ldSetFx(s.slot, fadeOut * (1 - under) * (1 - dil),
        (1 - Math.min(1, s.grow / (s.max || s.grow || 1))) * 0.6 + (1 - fadeOut) * 0.3);
      if (under >= 1 || dil >= 1 || s.t > s.hold + s.fade) { freeSlick(s); splats.splice(i, 1); }
    }

    for (let i = walls.length - 1; i >= 0; i--) {
      const w = walls[i]; w.t += dt;
      // splats and drips grow on the GPU; only the end of their life is ours
      const fadeOut = w.t > w.hold ? Math.max(0, 1 - (w.t - w.hold) / w.fade) : 1;
      if (w.ref && !rideAnchor(w, dt)) { ldRelease(w); walls.splice(i, 1); continue; }
      if (w.slot >= 0) ldSetFx(w.slot, fadeOut * (w.ref ? w.vis : 1), (1 - fadeOut) * 0.3);
      if (w.t > w.hold + w.fade) { ldRelease(w); walls.splice(i, 1); }
    }
    if (vehRecs.length) updateVehicleBlood(dt);
    ldFlush(dt);
  });

  /* ---- CBZ.goreAudit() — THE RATCHET FOR "FLATS THAT FLOAT" -----------------
     `float` is the worst vertical gap, in metres, between any live ground pool's
     RIM and the ground under that rim. It is the owner's report expressed as a
     number: a 2 m pool laid horizontally on the island's 36-degree refuge
     mountain reports ~1.4; a decal that actually lies ON the hillside reports
     the seat lift (~0.06) plus whatever the surface curves away by across its
     own radius. It may only ever go DOWN — pin it in the disaster gate.
     Populations come along for free (a live budget read during a shootout). */
  const _RIM = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const _rv = new THREE.Vector3();
  CBZ.goreAudit = function () {
    let pools = 0, streaks = 0, water = 0, worst = 0, worstAt = null;
    for (let i = 0; i < splats.length; i++) {
      const s = splats[i];
      if (s.water) { water++; continue; }
      if (s.streak) { streaks++; } else { pools++; }
      const m = s.m;
      m.updateMatrixWorld(true);
      for (let k = 0; k < _RIM.length; k++) {
        // a blob's geometry is a unit circle, so local (±1,0)/(0,±1) IS the rim;
        // the plane used by streaks is a unit quad, so ±0.5 — near enough for a
        // conformance probe, and deliberately the same four samples for both.
        // every land mark is a unit quad now; `rim` is where its visible edge
        // sits inside it, so this samples the mark and not the empty corners
        const rr = s.rim || 0.5;
        _rv.set(_RIM[k][0] * rr, _RIM[k][1] * rr, 0).applyMatrix4(m.matrixWorld);
        // measured against the DRAWN ground (decalFloorAt), which is what the
        // eye compares the pool to — outside the city it IS floorAt, so the
        // island's ratcheted numbers are unchanged.
        const gap = Math.abs(_rv.y - decalFloorAt(_rv.x, _rv.z));
        if (gap > worst) { worst = gap; worstAt = [+_rv.x.toFixed(1), +_rv.z.toFixed(1)]; }
      }
    }
    // how much of what is still on the ground is currently under snow — the
    // ratchet for "a whiteout does not leave crisp red on a white island".
    // ---- the cube ratchet: how big is what is in the air right now? ----
    let boxGibs = 0, maxGib = 0;
    for (let i = 0; i < bits.length; i++) {
      const b = bits[i], bm = b.m, bg = bm && bm.geometry;
      if (bg && bg.type === "BoxGeometry") boxGibs++;
      if (bg) {
        if (!bg.boundingBox) bg.computeBoundingBox();
        const bb = bg.boundingBox;
        const span = Math.max((bb.max.x - bb.min.x) * Math.abs(bm.scale.x), (bb.max.y - bb.min.y) * Math.abs(bm.scale.y),
          (bb.max.z - bb.min.z) * Math.abs(bm.scale.z));
        if (span > maxGib) maxGib = span;
      }
    }
    // the air pool: a drop's size is its DIAMETER (what used to read as a
    // floating ball was its cross-section; a streak's length is its speed)
    let drops = 0, mist = 0, fatDrop = 0;
    for (let i = 0; i < airN; i++) {
      if (AKIND[i] === 1) mist++;
      else { drops++; if (AR[i] * 2 > fatDrop) fatDrop = AR[i] * 2; }
    }
    let streams = 0;
    for (let e = 0; e < EM_MAX; e++) if (E_ON[e]) streams++;
    const cov = snowCover();
    let visible = 0, buried = 0, washes = 0, diluted = 0, candidates = 0;
    for (let i = 0; i < splats.length; i++) {
      const s = splats[i];
      if (s.water) continue;
      const u = buriedBy(s, cov);
      // DILUTION COUNTS AS GONE. `bloodVisible` is the ratchet a beach test
      // reads — what is still lying on the sand — so what the sea has already
      // carried off must come out of it exactly as snow burial does.
      const d = s.dilute > 0 ? Math.min(1, s.dilute) : 0;
      washes += s.swashN || 0;
      if (d > 0) diluted++;
      if (s.swashBand) candidates++;
      if (u >= 1 || d >= 1) buried++; else visible += (1 - u) * (1 - d);
    }
    return {
      bits: bits.length + airN, pools, streaks, slicks: water, walls: walls.length,
      air: airN, airDrawCalls: airMesh && airMesh.parent ? 1 : 0, streams, airEmits: AIR_AUDIT,
      realism: realism(), debrisLaw: debrisLaw(), mode: (CBZ.game && CBZ.game.mode) || null,
      boxGibs, drops, mist,
      maxGibCm: Math.round(maxGib * 100), maxDropCm: +(fatDrop * 100).toFixed(2),
      maxDropThickCm: +(fatDrop * 100).toFixed(2),
      // `gibs` is the count of GENERIC flying boxes still alive, and on the
      // island it may only ever be 0 — the ratchet for "I hate the blood
      // blocks". `severed` counts rigs currently missing a real body part.
      gibs: (function () { let n = 0; for (let i = 0; i < bits.length; i++) if (bits[i].kind === "gib" && !bits[i].limb) n++; return n; })(),
      // LIMBS off, not rigs affected — one body missing an arm and a leg is two
      severed: (function () { let n = 0; for (let i = 0; i < severed.length; i++) n += severed[i].items.length; return n; })(),
      severedRigs: severed.length,
      puffs: puffs.length, plumeEmits: PLUME_AUDIT, pending: later.length,
      float: +worst.toFixed(3), floatAt: worstAt,
      slopeDecals: slopeOn(),
      snowCover: +cov.toFixed(3), buried,
      /* GORE_SWASH. `swashWashes` is the MATCH total, not a sum over what is
         still lying there: a mark the sea finished off is the strongest
         evidence the law works and it deletes its own record, so counting live
         decals would report a perfect wash as zero (it did, first time out).
         The other two are live: marks the sea has thinned so far, and marks
         sitting in the band where it could reach them at all. */
      swashWashes: swashEvents, swashLiveWashes: washes,
      swashDiluted: diluted, swashCandidates: candidates,
      // sum of per-decal visibility: 0 means the ground reads clean even
      // though records may still exist mid-bury.
      bloodVisible: +visible.toFixed(2),
      vehicle: vehicleAudit(),
    };
  };

  // wipe all gore (called on a match reset / scene swap)
  CBZ.clearGore = function () {
    for (const r of severed) restoreRecord(r); severed.length = 0;   // every rig leaves whole
    for (const b of bits) rm(b.m); bits.length = 0;
    airN = 0; if (airGeo) airGeo.instanceCount = 0;
    for (let e = 0; e < EM_MAX; e++) stopStream(e);
    if (airMesh && airMesh.parent) airMesh.parent.remove(airMesh);       // re-added on the next frame
    for (const s of splats) freeSlick(s); splats.length = 0; slickN = 0;
    for (const w of walls) ldRelease(w); walls.length = 0;
    while (vehRecs.length) vdDrop(vehRecs.length - 1);
    if (ldMesh && ldMesh.parent) ldMesh.parent.remove(ldMesh);          // re-added on the next mark
    // water medium: drop the plume + every bleed source. The pooled sprites go
    // too — a scene swap orphans them, so they must be re-added, not reused.
    puffs.length = 0;
    if (plumeGeo) plumeGeo.instanceCount = 0;
    if (plumeMesh && plumeMesh.parent) plumeMesh.parent.remove(plumeMesh);   // re-added on the next scene
    chum.length = 0; chumOut.length = 0; wetEvent = false;
    later.length = 0; killCtx = null; swashEvents = 0;   // the match total is per match
  };

  // FIRST-BLOOD PREWARM: bake the shared blood texture at load instead of on
  // the first kill — a rocket's first blast is also usually the session's
  // first gore, and this canvas rasterisation used to land in that same
  // already-overloaded impact frame (see crashfx.js's first-blast block).
  bloodTexture();
  landAtlas();
})();

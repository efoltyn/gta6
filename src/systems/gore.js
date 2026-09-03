/* ============================================================
   systems/gore.js — cinematic, visceral death gore for BOTH games.

   One call, CBZ.gore(x, y, z, opts), throws a layered blood event:
     • a forward-biased SPRAY of fast droplets that fling AWAY from the
       impact (exit-wound directionality), each leaving a splat where it lands
     • a fine high-velocity MIST puff (rifle/headshot/explosion feel) that
       hangs, drifts, and fades — the subtle aerosol that reads as "real"
     • chunky flying GIBS (limbs/torso, gravity + tumble + settle as debris)
     • lingering ground POOLS that spread, darken and only slowly fade —
       irregular blob outlines (jittered geometry + random spin/stretch),
       never a perfect circle
     • WALL SPLATTER: if a surface sits just behind the victim along the shot
       line, a vertical blood decal is stamped on it (GTA-style)
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
   mode, the chunks an explosion DOES throw are torn irregular solids, droplets
   are centimetres and stretch along their own velocity, aerosol is a soft
   camera-facing puff, and a drop's landing mark is a splash rather than a
   metre-and-a-half blot. One flag reverts all of it.

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
  //   realism()  — the LOOK. Torn irregular chunks instead of boxes, droplets
  //                at real scale stretched along their own velocity, aerosol as
  //                a soft camera-facing puff on the feathered blood texture,
  //                and a droplet's landing mark sized like a splash and not
  //                like a puddle. Mode-blind: the city's blood was the same
  //                blood, so the city gets it too.
  //   debrisLaw() — the CITY's death-realism rule, promoted to every mode: a
  //                bullet DROPS a person (ragdoll.js already leaves an intact
  //                body), so it throws no generic chunks at all; an explosion
  //                or an actual sever still does; and anything that does fly
  //                settles, fades and clears instead of decorating the yard.
  function realism() { return !CBZ.CONFIG || CBZ.CONFIG.GORE_REALISM_V2 !== false; }
  function debrisLaw() { return cityMode() || realism(); }
  // A droplet's authored `size` is read as a sphere RADIUS. DROP_R below (the
  // island wave) already pulled the call-site magnitudes down for a ROUND drop;
  // this is the extra factor a STRETCHED one needs, because the same volume of
  // blood drawn out along its flight has to be thinner across. Composed, the
  // two land a spray at ~4-10 cm across and 3-6x that long. Keeps every call
  // site's relative weighting (a stump vent is still finer than an exit spray).
  const DROP_K = 0.55;
  // Body-drain pools have the same unit bug as the droplets: spawnSplat's
  // `grow` is a RADIUS, so the authored 1.87 for an ordinary kill stamped a
  // 3.7 m lake under one man. Measured against the rig it lies next to, a
  // bled-out body owns something closer to a metre and a half.
  const POOL_K = 0.42;
  // Aerosol: a soft quad hides nothing behind it, so it needs a FRACTION of the
  // reach a hard lump could get away with. `size` is still the authored sphere
  // radius; these turn a 7-puff burst into a knee-high haze at the wound rather
  // than a four-metre pink cloud over the yard.
  const MIST_K = 2.4, MIST_A = 0.24;
  function survMode() { return !!(CBZ.game && CBZ.islandModeOn(CBZ.game.mode)); }
  const GRAV = 24;
  // DECALS ARE UNLIT, AND THE PRISON FLOOR IS WHITE. A pool/wall/streak decal
  // is MeshBasicMaterial: no light touches it, and the renderer's sRGB output
  // lifts a dark hex a long way (0x5e070b measured out at (208,41,78) on the
  // yard — cherry, with a pink cast, because that hex's BLUE outranks its
  // green). Blood on a pale floor is a dark red-brown, so the decal palette
  // gets its own darker, blue-suppressed rungs. Flying droplets are NOT in
  // here: those are lit meshes seen against sky and wall, and they should stay
  // bright — arterial blood in the air really is.
  const BLOOD = 0x8a0b10, BLOOD_D = 0x5e070b, BLOOD_BRT = 0xb01218;
  // see the DECAL note above: same three rungs, re-authored for an unlit decal
  // lying on a bright floor. Unknown colours pass through untouched.
  const DECAL_C = { 0x5e070b: 0x300203, 0x8a0b10: 0x420305, 0xb01218: 0x550408 };
  function decalCol(c) { return realism() ? (DECAL_C[c] != null ? DECAL_C[c] : c) : c; }
  // Droplets stay LIT and stay bright — they have to be findable at 20 m — but
  // the old rungs came out of the sRGB pass as pillar-box red. One stop down is
  // still legible against sky and concrete and stops reading as cherry candy.
  const DROP_C = { 0x5e070b: 0x4b060a, 0x8a0b10: 0x6e090d, 0xb01218: 0x8c0e13 };
  function dropCol(c) { return realism() ? (DROP_C[c] != null ? DROP_C[c] : c) : c; }
  const BONE = 0xe6ddc8, BONE_D = 0xcfc3ad, TOOTH = 0xf2ead8;
  const bits = [];     // flying gibs + blood droplets + mist
  const splats = [];   // ground blood pools + tire-smear streaks
  const walls = [];    // vertical wall/surface splatter decals
  const later = [];    // delayed gore beats (arterial spurts, bleed-out pools)
  let flashEl = null, flashV = 0;
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
  const G_DROP = new THREE.SphereGeometry(1, 7, 5);   // blood droplet (scaled + stretched per-bit)
  /* A DROPLET IS A DROPLET, NOT A PEBBLE (owner, on the blood blocks). G_DROP
     is a 5x4 sphere — deliberately, it is cheap — but a 5x4 sphere is a
     FACETED POLYHEDRON, and the spray was scaling it to a 0.07-0.18 radius:
     up to 36 cm across. Three simultaneous kills filled the air with what read
     as flying red rocks, which is the same complaint as the cubes wearing a
     different geometry. Real spatter is millimetres; at this art scale ~8-16 cm
     is the honest read, still visible in flight and still stamping its landing
     mark. One constant, so every emitter in this file moves together.
     GORE_DROP_SCALE dials it back up (1.9 restores the old spray exactly). */
  if (CBZ.CONFIG.GORE_DROP_SCALE == null) CBZ.CONFIG.GORE_DROP_SCALE = 1;
  function DROP_R(k) {
    return (0.038 + Math.random() * 0.052) * (k || 1) * (+CBZ.CONFIG.GORE_DROP_SCALE || 1);
  }
  const G_MIST = new THREE.SphereGeometry(1, 4, 3);   // legacy aerosol lump (realism OFF)
  const G_GIB = new THREE.BoxGeometry(1, 1, 1);       // legacy chunk (realism OFF) only — the stump
                                                      // is its own torn geometry now, see stumpGeo()
  const G_PLANE = new THREE.PlaneGeometry(1, 1);      // smears, drip streaks, aerosol billboards
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

  // A DROPLET POINTS WHERE IT IS GOING. One quaternion off the velocity vector
  // turns a stretched sphere into a streak of blood in flight — the single
  // cheapest thing that stops a spray reading as a handful of thrown beads.
  const _UP = new THREE.Vector3(0, 1, 0), _aim = new THREE.Vector3();
  function aimDrop(m, vx, vy, vz) {
    _aim.set(vx, vy, vz);
    const l = _aim.length();
    if (l < 0.001) return;
    _aim.multiplyScalar(1 / l);
    m.quaternion.setFromUnitVectors(_UP, _aim);
  }
  // ground pools + wall splats: IRREGULAR blob outlines — a circle with
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

  // a soft radial blood texture, generated once, used by pools + wall splats so
  // edges feather instead of showing a hard polygon rim (much more convincing).
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

  function dist2Cam(x, z) {
    const cam = CBZ.camera && CBZ.camera.position;
    if (!cam) return 0;
    const dx = x - cam.x, dz = z - cam.z; return dx * dx + dz * dz;
  }

  // ============================================================
  //  THE WATER MEDIUM — blood does NOTHING underwater that it does in air.
  //
  //  Nothing outside this file changes to get it. gore()/gore.spray() ask
  //  goreMedium() where the wound is and branch themselves, and spawnBit() —
  //  which EVERY incidental emitter in this file already funnels through
  //  (stump vents, arterial arcs, blunt spit, skull frags, both spray layers)
  //  — redirects blood/mist into a bloom puff while a wet event is in flight.
  //  So the whole file gains the medium, not just the shark that prompted it.
  //
  //  COLOUR: BLOOD IS RED. There used to be a "colour science" ladder here
  //  that browned the plume with depth and went green-black past ~10 m, on the
  //  grounds that water absorbs red about 100x faster than blue. The physics
  //  is real; the feature was not. Owner, 2026-08-30: "blood should be
  //  fucking red — get rid of the murky brown blood."
  //
  //  He is right, and the reason is worth keeping so nobody rebuilds it. Red
  //  absorption is about the LIGHT REACHING the blood, and this engine already
  //  models that: world/water_spec.js attenuates everything seen through the
  //  water column, and the plume is drawn through it like everything else. So
  //  the ladder was tinting a second time, on top of the tint the renderer had
  //  already applied — and doing it with hand-picked hexes that nobody ran
  //  through the encoder, which is how "murky brown" reached the screen as
  //  #CA863F amber and "green-black" as #7BA070 sage. Yellow blood.
  //  Absorption can only ever take a channel AWAY; it cannot invent green.
  //
  //  So colour is now ONE dimension — age — and every rung of it is arterial
  //  red. Three SHARED materials, never one per puff and never written to per
  //  frame: a puff only ever swaps which shared material it points at.
  //
  //  MOTION: a plume that rises straight reads as SMOKE. Blood tumbles and
  //  folds, so every puff carries its own noise phase and a sin/cos wander,
  //  rises slowly (0.12-0.35 u/s) while decelerating, expands continuously,
  //  and is advected by the live current. Two layers: a tight saturated burst
  //  at the wound plus a bigger diffuse haze that lingers behind it. Soft
  //  alpha, NEVER additive — additive reads as light, i.e. as fire.
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
  // through (spawnBit), so there is no ninth copy of a water check. Ballistic
  // DROPLETS are deliberately NOT banned: they are the half of a breaching bite
  // that is real, and they now go INTO the water where they land — see the
  // sea-surface test in the bits loop.
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

  /* ---- the pooled colour ladder: ONE dimension, and it is age -------------
     BLOOD IS RED. This used to be a 3x3 table that browned the plume past 2 m
     and went "green-black" past 8 m. It rendered as neither: run through this
     renderer's real chain (outputEncoding = sRGBEncoding with r128 colour
     management OFF, so a hex is treated as LINEAR, times RENDER_EXPOSURE
     1.16 / 0.6 = a 1.93x multiply, then ACES, which desaturates toward white
     as it brightens) the "murky brown" rung came out #CA863F amber, #B18C52
     tan and #979161 OLIVE-YELLOW, and the "green-black" rung came out #7BA070
     sage GREEN. 0x33301a was the whole thing in one number: R 51, G 48, B 26
     is an olive before the encoder even touches it. Nothing diluted it either
     — bloodTexture() is pure white with an alpha feather, so the material
     colour IS the pixel.

     The table is gone rather than recalibrated, and that is the owner's call
     and the right one. Depth-tinting blood here was always double-counting:
     world/water_spec.js already attenuates everything seen through the water
     column, the plume included, so the renderer was doing the physics and this
     table was doing it a second time by hand. What is left is the fade a
     cloud actually has — it thins and darkens as it disperses — and every
     rung of it is arterial.

     Three shared materials now instead of nine. `age` indexes them directly.
     If depth ever wants to read differently again, do it by dimming what is
     already red, never by moving the hue: absorption can only take a channel
     AWAY, so no amount of it turns blood yellow or green. */
  const BLOOM_COLS = [0xb01218, 0x8e0f15, 0x7a0d12];   // fresh -> settled -> old, all arterial
  const BLOOM_ALPHA = [0.5, 0.3, 0.12];
  const bloomMats = [];
  function bloomMat(age) {
    let m = bloomMats[age];
    if (!m) {
      m = new THREE.SpriteMaterial({
        map: bloodTexture(), color: BLOOM_COLS[age],
        transparent: true, opacity: BLOOM_ALPHA[age], depthWrite: false,
      });
      m._shared = true;                  // rm() must never dispose a ladder rung
      bloomMats[age] = m;
    }
    return m;
  }

  // ---- puff pool: sprites are recycled forever, never re-allocated -----------
  /* THE SURFACE LID CLAMPS THE QUAD, NOT THE SPRITE'S CENTRE.
     ------------------------------------------------------------------
     A puff is a THREE.Sprite — a camera-facing quad — drawn at scale.set(sc,sc,1)
     on the feathered blood texture, and `sc` GROWS every single frame (b.grow is
     0.3-1.2/s over a 4.5-7.5 s haze life). The old lid pinned pos.y, the sprite's
     CENTRE, five centimetres under the swell. Half of every plume was therefore
     drawn ABOVE the waterline, and metres of a grown haze puff were. goreKillCloud
     was worse again: it seeds its shell puffs at y + c*rad*0.7 with rad up to 3.2,
     i.e. straight into the AIR, and puff() never clamped at spawn either.
     From a camera above water that is precisely the "blood clouds float like a
     mist over the water" in the report — the plume itself, not the aerosol.

     So the lid is measured against the quad's VISIBLE extent. The blood texture
     is feathered and fades out long before the corner, so the drawn radius is
     about 0.42 * sc; keeping rim + gap under the surface keeps the whole sprite
     in the water at every scale, at spawn as well as in flight.

     Nothing BELOW the surface changes: same BLOOM_COLS rungs, same age fade,
     same turbulence, same current advection. The underwater trail the
     owner calls one of the best things in the game is untouched — and the
     air-spawned half of a kill cloud now joins it instead of hanging over it,
     so there is MORE plume in the water, not less.

     KNOWN TRADE, stated rather than hidden: in genuinely shallow water a grown
     plume is wider than the column is deep, so keeping its rim under the swell
     pushes its lower half into the seabed and the bed occludes it. That is the
     honest read (blood in half a metre of water IS lying on the bottom), and
     the alternative — a floorAt query per puff per frame — is the exact cost
     this file already refuses to pay for the surface slicks. */
  // LID_GAP is not cosmetic: b.sy is a CACHED surface sample (see the stagger in
  // updatePuffs), so the gap has to swallow however far the swell can travel
  // between two samples or the sea rises out from under a clamped puff and puts
  // its rim back in the air. 18 cm covers the tightened ~0.2 s surface-tracking
  // stagger with room to spare, and against a plume metres across it is invisible.
  const PUFF_VIS = 0.42, LID_GAP = 0.18;
  const puffs = [], puffPool = [];
  function puffCap() { return CBZ.qScale ? CBZ.qScale(55, 210) : 110; }
  function puff(x, y, z, vx, vy, vz, size, life, haze, sy) {
    if (!CBZ.scene || puffs.length >= puffCap()) return null;
    // CLAMP AT SPAWN, AGAINST THIS PUFF'S OWN COLUMN. A puff seeded in the air
    // over the sea (goreKillCloud's shell, a bloom fired at a chest-high wound
    // on a swimmer) is pulled under by its own visible radius instead of being
    // born half out of the water and never tested until the first update tick.
    // The caller's `sy` is NOT good enough for the clamp and the capture proved
    // it: goreBloom samples the surface once at the wound and then scatters
    // nine puffs over a metre of swell, so up to a third of a metre of rim can
    // be born proud of a sea the caller never measured. One extra swell read
    // per puff, on a path that spawns in bursts of about nine.
    const surf = seaY(x, z);
    const lid0 = surf - LID_GAP - size * PUFF_VIS;
    if (y > lid0) y = lid0;
    let b = puffPool.pop();
    if (!b) {
      const sp = new THREE.Sprite(bloomMat(0));
      sp.renderOrder = 5;
      b = { s: sp, vx: 0, vy: 0, vz: 0, rise: 0, t: 0, life: 1, sc: 1, grow: 0.5, ph: 0, ph2: 0, freq: 1, wob: 0, age: -1, cx: 0, cz: 0, curT: 0, sy: 0, haze: false, surf: false };
      scene().add(sp);
    }
    b.s.position.set(x, y, z);
    b.vx = vx; b.vy = vy; b.vz = vz;
    b.rise = (haze ? 0.12 : 0.2) + Math.random() * 0.15;
    b.t = 0; b.life = life; b.sc = size; b.haze = !!haze;
    b.grow = haze ? 0.3 + Math.random() * 0.2 : 0.75 + Math.random() * 0.45;
    b.ph = Math.random() * 6.28; b.ph2 = Math.random() * 6.28;
    b.freq = haze ? 0.7 + Math.random() * 0.7 : 1.6 + Math.random() * 1.6;
    b.wob = haze ? 0.1 + Math.random() * 0.09 : 0.26 + Math.random() * 0.2;
    b.cx = 0; b.cz = 0; b.curT = 0; b.sy = surf; b.surf = false;
    b.age = -1;
    b.s.material = bloomMat(0);
    b.s.scale.set(size, size, 1);
    b.s.visible = true;
    puffs.push(b);
    return b;
  }
  function retirePuff(i) {
    const b = puffs[i];
    b.s.visible = false;
    puffs.splice(i, 1);
    if (puffPool.length < 240) puffPool.push(b); else rm(b.s);
  }
  // a ballistic droplet reborn as a plume seed: water kills a drop's momentum
  // in centimetres, so keep the DIRECTION, throw away almost all the speed, and
  // let the bloom take over. This is what makes the redirect look intentional
  // rather than like the air spray with the gravity turned off.
  function puffFromBit(x, y, z, vx, vy, vz, size, mist) {
    puff(x, y, z, vx * 0.1, Math.max(0, vy * 0.05), vz * 0.1,
      size * (mist ? 5 : 3.4), (mist ? 3.2 : 1.9) + Math.random() * 1.4, !!mist, seaY(x, z));
  }

  function updatePuffs(dt) {
    for (let i = puffs.length - 1; i >= 0; i--) {
      const b = puffs[i], pos = b.s.position;
      b.t += dt;
      if (b.t >= b.life) { retirePuff(i); continue; }
      // drag toward the terminal rise — decelerating, never a constant climb
      const dg = Math.pow(b.haze ? 0.5 : 0.22, dt);
      b.vx *= dg; b.vz *= dg;
      b.vy = b.rise + (b.vy - b.rise) * dg;
      // the current and the surface are broad, slow fields — re-sample on a
      // jittered ~0.5s stagger instead of per puff per frame.
      // A PUFF THAT HAS TOUCHED THE LID READS THE SWELL EVERY FRAME, and the
      // measurement is why: on a 0.14-0.24 s stagger a surface-riding plume was
      // still clamped against where the sea WAS, and the capture came back with
      // sixty sprites standing up to 0.25 m proud of the waterline — the exact
      // defect this whole block exists to remove, just small enough to look
      // like foam. A swell crest travels further than the lid gap inside one
      // stagger, so the only cache short enough is no cache. This is the same
      // cost the water-splat updater in this file already pays for every slick
      // on the surface, and for the same reason: the surface MOVES. Deep puffs
      // keep the cheap stagger — they cannot break a surface they are nowhere
      // near — and the current stays staggered for everyone, because a current
      // is a slow, broad field and nothing is clamped against it.
      // NEAR the surface, not just pinned ON it. A puff that has never touched
      // the lid can still have its rim in the air: it is clamped against a sy
      // sampled up to 0.75 s and several metres ago, and it only takes drifting
      // over a trough for the sea to be lower here than where it was measured.
      // The capture caught 57 sprites doing exactly that, up to 0.21 m proud —
      // small enough to read as foam, which is what makes it worth removing.
      // The band is generous because the test is cheap relative to being wrong.
      const nearSurf = b.surf || pos.y + b.sc * PUFF_VIS > b.sy - 1.5;
      if (nearSurf) b.sy = seaY(pos.x, pos.z);
      b.curT -= dt;
      if (b.curT <= 0) {
        b.curT = 0.45 + Math.random() * 0.3;
        if (!nearSurf) b.sy = seaY(pos.x, pos.z);
        if (CBZ.waterField && CBZ.waterField.currentAt) {
          try { const c = CBZ.waterField.currentAt(pos.x, pos.z, undefined, _cur); b.cx = c.x * 0.5; b.cz = c.z * 0.5; } catch (e) { b.cx = b.cz = 0; }
        }
      }
      // TURBULENCE: the per-puff phase is what makes the plume curl and fold.
      b.ph += dt * b.freq;
      pos.x += (b.vx + b.cx + Math.sin(b.ph) * b.wob) * dt;
      pos.z += (b.vz + b.cz + Math.cos(b.ph * 0.83 + b.ph2) * b.wob) * dt;
      pos.y += (b.vy + Math.sin(b.ph * 0.61 + b.ph2) * b.wob * 0.5) * dt;
      // the surface is a LID: a plume cannot rise through it, it spreads out
      // underneath. Measured against the QUAD's rim (see PUFF_VIS above), not
      // against the sprite's centre — that off-by-half-a-sprite is the whole
      // "mist over the water" read.
      // GROW FIRST, THEN CLAMP. The scale that gets DRAWN is the one the lid has
      // to be measured against: clamping against last frame's sc and then
      // growing left 0.42*sc*grow*dt of rim above the swell every frame, which
      // on a plume that has expanded to tens of units is decimetres of blood in
      // the air — the whole bug, one frame late.
      b.sc *= 1 + b.grow * dt;
      const pinned = pos.y > b.sy - LID_GAP - b.sc * PUFF_VIS;
      if (pinned) {
        if (b.vy > 0) b.vy = 0;
        b.sc += b.sc * 0.35 * dt;        // pinned at the lid it keeps SPREADING sideways
        pos.y = b.sy - LID_GAP - b.sc * PUFF_VIS;   // rim under the swell at the FINAL scale
        // A PLUME THAT REACHES THE SURFACE BECOMES A SLICK. Blood arriving at
        // the waterline stops being a volume and starts being a film, and this
        // file already owns the film: CBZ.goreSlick, the decal that reads right
        // from a boat and holds for 18-40 s. Fired once per puff, on first
        // contact, through the shared 1-per-0.3 s budget.
        if (!b.surf) {
          b.surf = true;
          b.curT = 0;                    // and re-read the swell NOW, then keep tracking it
          surfaceSlick(pos.x, pos.z, b.haze ? 0.5 : 0.3);
          // ...and a puff that has ALREADY SPENT most of its life climbing and
          // is now just sitting on the lid gets its long tail trimmed, so it
          // thins out instead of hovering while the slick does its job.
          // DELIBERATELY NARROW. The measured baseline says the worst offender
          // is goreKillCloud's shell, which is SPAWNED in the air (y + c*rad*0.7,
          // rad up to 3.2) and is therefore pinned on its very first tick — that
          // blood is brand new, it is the cloud the owner likes, and cutting it
          // to a second would fix "blood above the water" by deleting blood.
          // The half-life gate can never fire on a fresh puff; it only ever
          // takes a tail off one that has already had most of its run.
          if (b.t > b.life * 0.5 && b.life - b.t > 2.2) b.life = b.t + 2.2;
        }
      }
      b.s.scale.set(b.sc, b.sc, 1);
      // walk the ladder: a cloud thins and darkens as it disperses. Depth is
      // NOT a factor any more — see BLOOM_COLS. The renderer's own water column
      // already dims anything seen through it, and blood is red at every depth.
      const f = b.t / b.life;
      const age = f < 0.35 ? 0 : (f < 0.72 ? 1 : 2);
      if (age !== b.age) { b.age = age; b.s.material = bloomMat(age); }
    }
  }

  // public: an UNDERWATER blood bloom. Two layers — the tight saturated burst
  // at the wound, plus a bigger diffuse haze that lingers and desaturates.
  CBZ.goreBloom = function (x, y, z, opts) {
    if (!waterOn() || !CBZ.scene) return;
    opts = opts || {};
    const d2 = dist2Cam(x, z);
    if (CBZ.camera && CBZ.camera.position && d2 > 80 * 80) return;
    const lod = d2 > 45 * 45 ? 0.5 : 1;
    const amt = Math.max(0.3, Math.min(3, opts.amount == null ? 1 : opts.amount));
    const sy = seaY(x, z);
    const art = !!opts.arterial;
    let dx = 0, dy = 0, dz = 0;
    if (opts.dir) {
      dx = +opts.dir.x || 0; dy = +opts.dir.y || 0; dz = +opts.dir.z || 0;
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (l > 0.001) { dx /= l; dy /= l; dz /= l; } else { dx = dy = dz = 0; }
    }
    // LAYER 1 — the burst: small, fast, saturated, short-lived, at the wound.
    const nb = Math.max(2, Math.round((art ? 8 : 6) * amt * lod));
    for (let i = 0; i < nb; i++) {
      const a = Math.random() * 6.28, r = Math.random() * 0.22 * amt;
      const sp = (art ? 1.5 : 0.85) + Math.random() * 1.3;
      puff(x + Math.cos(a) * r, y + (Math.random() - 0.5) * 0.22, z + Math.sin(a) * r,
        dx * sp + Math.cos(a) * sp * 0.45, dy * sp * 0.6 + 0.1, dz * sp + Math.sin(a) * sp * 0.45,
        0.2 + Math.random() * 0.26 * amt, 1.6 + Math.random() * 1.2, false, sy);
    }
    // LAYER 2 — the haze: bigger, slower, lasts several seconds, desaturates
    // as it goes. This is the layer you still see when you turn back around.
    const nh = Math.max(1, Math.round(3 * amt * lod));
    for (let i = 0; i < nh; i++) {
      const a = Math.random() * 6.28, r = Math.random() * 0.45 * amt;
      puff(x + Math.cos(a) * r, y + (Math.random() - 0.35) * 0.4, z + Math.sin(a) * r,
        dx * 0.35 + Math.cos(a) * 0.3, 0.05, dz * 0.35 + Math.sin(a) * 0.3,
        0.6 + Math.random() * 0.7 * amt, 4.5 + Math.random() * 3, true, sy);
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
  function slickCap() { return CBZ.qScale ? CBZ.qScale(16, 46) : 28; }
  function slickMat() {
    const m = SLICK_MATS.pop();
    if (m) { m.opacity = 0; return m; }
    const nm = new THREE.MeshBasicMaterial({
      color: 0x6e0d10, map: bloodTexture(), transparent: true, opacity: 0, depthWrite: false,
    });
    // rm() must never dispose a pooled material — the repo's convention is a
    // _shared tag, and every disposal sweep in the game already honours it.
    nm._shared = true;
    return nm;
  }
  // hand a retiring slick's mesh + material back. EVERY water-splat removal
  // path goes through this, which is also what keeps slickN honest.
  function freeSlick(s) {
    if (!s) return;
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
      m, water: true, t: 0, grow: 0.9 + amt * 1.6, max: 0.9 + amt * 1.6, growT: 6,
      hold: near ? 40 : 18, fade: 16,
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

  /* THE KILL CLOUD — the payoff, and it is a different event from a bite.
     ------------------------------------------------------------------
     A landed bite is a BURST: fast, tight, at the wound, gone in two seconds
     (goreBloom above). A DEATH is not that. When a body stops swimming the
     blood stops being pumped out of it in pulses and starts simply LEAVING
     it, and what you see is a slow, enormous, low-contrast cloud that hangs
     where the animal is and is still there when you swim back. Before this,
     dying underwater in this game produced exactly the same puff as being
     nicked — which is why an orca kill read as nothing at all.

     Three layers, all through machinery that already exists so nothing here
     is a second blood system and every cap still holds:
       1. the burst goreBloom already knows how to make, at full amount
       2. a HAZE SHELL the burst cannot make: a dozen big, slow, long-lived
          puffs seeded on a sphere around the corpse rather than at a point,
          which is what turns "a puff" into "a cloud you are inside"
       3. a short, heavy chum handle, so the cloud keeps being fed for a few
          seconds as the body sinks, and every shark in smell range comes.
     Plus the slick overhead: blood from a kill reaches the surface, and from
     a boat that red patch IS the kill.

     Costs nothing when it is not called, and when it is: pooled puffs under
     the existing puffCap, one pooled slick under slickCap, one chum handle
     out of twelve. On land it is a no-op — a land death already has the
     whole air-medium gore path and does not want a plume. */
  CBZ.goreKillCloud = function (x, y, z, opts) {
    if (!waterOn() || !CBZ.scene) return false;
    if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return false;
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return false;
    if (!woundInWater(x, y, z)) return false;         // a land death is not this
    opts = opts || {};
    const size = Math.max(0.4, Math.min(3, opts.size == null ? 1 : opts.size));
    const d2 = dist2Cam(x, z);
    if (CBZ.camera && CBZ.camera.position && d2 > 110 * 110) return false;
    const lod = d2 > 55 * 55 ? 0.5 : 1;
    const sy = seaY(x, z);
    // 1 — the burst, borrowed whole
    CBZ.goreBloom(x, y, z, { amount: 1.6 * size, arterial: true });
    // 2 — the shell. Seeded on a sphere of the BODY's own scale, drifting
    //     outward slowly: a cloud has an inside, a puff does not.
    const n = Math.max(3, Math.round(9 * size * lod));
    const rad = 0.5 + size * 0.9;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, c = Math.random() * 2 - 1;
      const s = Math.sqrt(Math.max(0, 1 - c * c)), r = rad * (0.35 + Math.random() * 0.65);
      puff(x + Math.cos(a) * s * r, y + c * r * 0.7, z + Math.sin(a) * s * r,
        Math.cos(a) * s * 0.28, 0.02, Math.sin(a) * s * 0.28,
        0.9 + Math.random() * 1.1 * size, 7 + Math.random() * 6, true, sy);
    }
    // 3 — the body keeps leaking while it sinks
    if (opts.trail !== false) {
      try { CBZ.goreChum(x, y, z, 1, 4 + size * 2); } catch (e) {}
    }
    // and it reaches the surface: from above, that patch IS the kill
    CBZ.goreSlick(x, z, 1.1 * size);
    return true;
  };

  // where a gib comes to rest it bleeds. On the seabed that must NOT be a
  // ground pool — a decal lying in the dark under 30m of water is the exact
  // "invisible gore at the bottom of the ocean" bug this whole block exists to
  // stop — so a wet gib puffs where it settles instead.
  function landBleed(b, m) {
    if (b.wet) CBZ.goreBloom(m.position.x, m.position.y, m.position.z, { amount: 0.4 });
    // a chunk bleeds where it stops, but `grow` is a RADIUS: the authored
    // 0.4-0.8 was a 1.6 m pool under a piece of forearm.
    else spawnSplat(m.position.x, m.position.z,
      realism() ? 0.16 + Math.random() * 0.16 : 0.4 + Math.random() * 0.4, BLOOD_D, false);
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
      if (c.acc >= 0.35) {
        c.acc = 0;
        /* THE TRAIL SCALES WITH THE WOUND. It used to top out at 1.0 amount
           however badly the thing was bleeding, which was survivable only
           because a mauled animal used to hold three or four handles at once
           and got its density from the duplication. systems/wounds.js now
           opens exactly ONE per animal (a body bleeds; its individual holes do
           not bleed separately), which frees slots for other bleeders but
           made a single hard-bitten orca trail a third of what it did. A full
           rate is a torn artery now, not a nick. */
        CBZ.goreBloom(x, y, z, { amount: 0.35 + c.rate * 1.25, arterial: c.rate > 0.75 });
        if (Math.random() < 0.25 + c.rate * 0.3) CBZ.goreSlick(x, z, 0.3 + c.rate * 0.7);
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

  function spawnBit(x, y, z, vx, vy, vz, size, color, kind) {
    // MEDIUM REDIRECT: a droplet or an aerosol puff spawned during a WET event
    // is not ballistic, it is a bloom. ONE branch here is what gives every
    // incidental emitter in this file (stump vents, arterial arcs, blunt spit,
    // both spray layers) the water medium without a single call site changing
    // — the alternative was a water check duplicated at nine spawn sites.
    // Gibs fall through on purpose: a tooth or a severed forearm still sinks,
    // it just sinks slowly (see the b.wet drag in the updater).
    if (wetEvent && (kind === "blood" || kind === "mist")) {
      puffFromBit(x, y, z, vx, vy, vz, size, kind === "mist");
      return null;
    }
    // AND NO AEROSOL OVER OPEN WATER AT ALL (see mistOverSea). The redirect
    // above only covers emitters that came through CBZ.gore(); this one test
    // covers every emitter in the file, including the three that never had a
    // wet gate — the shark's per-lunge goreImpact above all.
    if (kind === "mist" && waterOn() && mistOverSea(x, y, z)) return null;
    // Standing gibs are FADING debris now, not permanent evidence, so the pool
    // can be far smaller — a shootout can never leave a huge persistent pile.
    // With the debris law off (pre-pass revert) jail/survival keep the original
    // "true world" 520-gib budget.
    const city = debrisLaw();
    const real = realism();
    // pool caps now ride the quality tier — read LIVE per spawn (the slider can
    // move mid-run); fallbacks = the old constants for qScale-less test runs.
    const cap = kind === "mist" ? (CBZ.qScale ? CBZ.qScale(310, 1100) : 620)
      : (kind === "gib" && city ? (CBZ.qScale ? CBZ.qScale(45, 180) : 90)
        : (CBZ.qScale ? CBZ.qScale(260, 900) : 520));
    if (bits.length > cap) {
      // CITY gibs are fading debris: make room by recycling a far/old LANDED gib
      // instead of refusing to spawn the new piece. Jail/survival keep the
      // original hard-cap drop-if-full behaviour (return null) byte-identical.
      if (kind === "gib" && city && recycleFarGib()) { /* room made */ }
      else return null;
    }
    let geo, mat;
    if (kind === "gib") { geo = real ? chunk() : G_GIB; mat = lambert(color); }
    else if (kind === "mist") {
      // AEROSOL IS NOT A SOLID. A camera-facing quad on the same feathered
      // blood texture the pools use has no silhouette to give itself away, so
      // it can be bigger AND fainter than the old lump and still read as a
      // hanging cloud instead of a floating polyhedron.
      geo = real ? G_PLANE : G_MIST;
      mat = new THREE.MeshBasicMaterial({
        color, map: real ? bloodTexture() : null,
        transparent: true, opacity: real ? MIST_A : 0.5, depthWrite: false,
      });
    }
    else { geo = G_DROP; mat = lambert(dropCol(color)); }
    const m = new THREE.Mesh(geo, mat);
    // gibs are lumpy with random proportions; drops stretch along their flight;
    // aerosol is a flat billboard sized off the same authored number.
    let hh = 0.06, dropR = 0, billScale = 0;
    if (kind === "gib") {
      if (city) {
        // rest-height: track the piece's half-Y so its BOTTOM rests on the road.
        const sy = size * (0.5 + Math.random());
        m.scale.set(size, sy, size * (0.7 + Math.random() * 0.6));
        hh = sy * 0.5;
      } else {
        // pre-pass jail/survival: original boxy scale, original 0.06 rest radius.
        m.scale.set(size, size * (0.5 + Math.random()), size * (0.7 + Math.random() * 0.6));
      }
    } else if (real && kind === "blood") {
      // ~4-10 cm across, 2-4x that along the shot line. The stretch is what
      // sells it: a sphere in the air is a bead, a streak is blood moving.
      // Don't overdo it — a UV sphere's POLES are points, and the stretch axis
      // runs through them, so a long drop sharpens into a dart. 2-4x reads as
      // motion; past that it reads as a red arrow. (The extra ring on G_DROP is
      // for the same reason: it rounds the two tips the stretch pulls on.)
      dropR = size * DROP_K;
      m.scale.set(dropR, dropR * (2.0 + Math.random() * 2.0), dropR);
      aimDrop(m, vx, vy, vz);
    } else if (real && kind === "mist") {
      billScale = size * MIST_K;
      m.scale.setScalar(billScale);
    } else m.scale.setScalar(size);
    m.position.set(x, y, z); m.castShadow = false; m.renderOrder = kind === "mist" ? 5 : 0;
    scene().add(m);
    const rec = {
      m, vx, vy, vz, kind, mat: kind === "mist" ? mat : null, mistFade: 0,
      sx: (Math.random() - 0.5) * 18, sy: (Math.random() - 0.5) * 18, sz: (Math.random() - 0.5) * 18,
      landed: false, bled: false,
      baseScale: billScale || size,
      rad: kind === "gib" ? hh : (dropR ? Math.max(0.015, dropR) : 0.06),
      // a stretched droplet is steered by its velocity every frame instead of
      // tumbling on three random axes; a billboard puff faces the lens.
      drop: !!dropR, bill: !!billScale,
      // sunk in water at spawn → the updater sinks it slowly with drag instead
      // of dropping it like a rock, and it blooms where it settles instead of
      // stamping a ground pool on the seabed. Always false on land.
      wet: wetEvent,
      // jittered stagger for the droplet's sea-surface test (bits loop). Only
      // "blood" reads it; the phase spread stops a whole spray querying the
      // swell table on the same frame.
      seaT: kind === "blood" ? Math.random() * 0.18 : 0,
      // a landed chunk is short-lived debris that SHRINKS/SINKS to nothing (see
      // the updater) so the ground clears after combat — not a permanent
      // coloured lump lying in the yard. With the debris law off, jail/survival
      // chunks PERSIST again (the original "true world" model). Blood/mist are
      // brief in every mode.
      fade: kind === "gib" && city,
      // the coverage already down when this piece was thrown, + how much NEW
      // snow it takes to vanish under (see the SNOW BURIES BLOOD block)
      snow0: kind === "gib" ? snowCover() : 0,
      snowNeed: kind === "gib" ? 0.26 + Math.random() * 0.24 : null,
      life: kind === "blood" ? 0.7 + Math.random() * 0.8
        : (kind === "mist" ? 0.45 + Math.random() * 0.45
          : (city ? 5 + Math.random() * 4 : 7 + Math.random() * 6)),
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

  function spawnSplat(x, z, grow, color, linger) {
    // splat cap rides the quality tier (read live; fallback = old 170)
    if (splats.length > (CBZ.qScale ? CBZ.qScale(85, 300) : 170)) recycleFarSplat();
    const s = slopeOn() ? groundGrad(x, z) : null;
    // a slope cannot hold a pool — the steeper it is, the less stays put (and
    // the rest leaves as the trickle below).
    const steep = !!(s && s.grade > STEEP);
    const g = steep ? grow * (0.42 + 0.28 * (STEEP / s.grade)) : grow;
    const m = new THREE.Mesh(blob(),
      new THREE.MeshBasicMaterial({ color: decalCol(color || BLOOD_D), map: bloodTexture(), transparent: true, opacity: 0, depthWrite: false }));
    seatDecal(m, x, z, Math.random() * 6.28, 0.04 + Math.random() * 0.02, s);
    m.renderOrder = 3; m.scale.set(0.1, 0.1, 1);
    scene().add(m);
    // pools GROW over a few seconds (a body keeps draining) and the ones near
    // the PLAYER linger far longer — that's the evidence you walk back past.
    // Far pools keep the short clock so the cap budget stays where it matters.
    const near = dist2Cam(x, z) < 24 * 24;
    splats.push({
      m, t: 0, grow: g, max: g, growT: linger ? 3.4 : 0.5,
      hold: linger ? (near ? 75 : 26) : (near ? 16 : 10), fade: linger ? 16 : 8,
      ax: 0.82 + Math.random() * 0.36, az: 0.82 + Math.random() * 0.36,  // per-pool stretch
      // snow that falls FROM NOW buries it; a big pool takes more of it than a
      // droplet mark, and the jitter is what makes a field go under raggedly.
      snow0: snowCover(), snowNeed: 0.22 + Math.min(0.30, g * 0.12) + Math.random() * 0.22,
    });
    // THE RUN-OFF: what the hillside wouldn't hold leaves down the fall line.
    // The threshold is above every droplet mark (the landing splats top out at
    // 0.8) and below every real pool (a kill pool starts at 2.0), so a body
    // bleeding on a slope trails ONE streak instead of twenty — the difference
    // between a run-off and a red spiderweb, and ~20 draw calls per kill.
    if (steep && grow > 0.9) {
      const dl = Math.hypot(s.gx, s.gz) || 1;
      spawnStreak(x, z, -s.gx / dl, -s.gz / dl, Math.min(5.5, grow * (0.9 + s.grade * 1.9)));
    }
  }

  // a long, thin blood smear dragged along a travel line (run-over kills, and
  // the downhill run-off above): the wheel pulls the pool with it, so the decal
  // stretches out over ~half a second along the direction given instead of
  // blooming in place. On terrain it re-seats as it draws (see the record
  // below), so a smear across a hillside follows the hillside.
  function spawnStreak(x0, z0, dx, dz, len) {
    // splat cap rides the quality tier (read live; fallback = old 170)
    if (splats.length > (CBZ.qScale ? CBZ.qScale(85, 300) : 170)) recycleFarSplat();
    const s = slopeOn() ? groundGrad(x0, z0) : null;
    const m = new THREE.Mesh(G_PLANE,
      new THREE.MeshBasicMaterial({ color: decalCol(BLOOD_D), map: bloodTexture(), transparent: true, opacity: 0, depthWrite: false }));
    seatDecal(m, x0, z0, Math.atan2(-dx, -dz), 0.045, s);   // local +y axis → world (dx,dz)
    m.renderOrder = 3; m.scale.set(0.55, 0.1, 1);
    scene().add(m);
    const near = dist2Cam(x0, z0) < 24 * 24;
    splats.push({
      m, streak: true, x0, z0, dx, dz, t: 0, grow: len, max: len,
      // A STREAK IS DRAWN, NOT STAMPED: its centre slides metres down-range as
      // it grows, so on terrain the seat it was born on is wrong by the time it
      // finishes. Any streak on a real gradient re-seats per frame while it
      // draws (the updater stops the moment it reaches full length) — a tire
      // smear down a hill needs this every bit as much as a downhill trickle
      // does, so it keys off the GROUND, not off which caller asked.
      slope: !!(s && s.grade >= FLATISH), spin: Math.atan2(-dx, -dz),
      w: 0.55 + Math.random() * 0.25, hold: near ? 60 : 28, fade: 14,
      snow0: snowCover(), snowNeed: 0.24 + Math.random() * 0.22,
    });
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
  function spawnWallSplat(x, y, z, dx, dz, amt, instant) {
    const cols = CBZ.colliders;
    if (!cols || !cols.length || walls.length > 48) return;
    const MAXD = 3.4;
    let best = null, bestT = MAXD;
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
      // WALL-SIZED face: the struck face spans the axis PERPENDICULAR to its
      // normal. A blood plane needs a real wall behind it, so require that span
      // (and enough height) — a thin hydrant/pole/meter/sign box never passes.
      const faceX = face === "xmin" || face === "xmax";
      const span = faceX ? (c.maxZ - c.minZ) : (c.maxX - c.minX);
      if (span < MIN_FACE) continue;                         // thin prop, not a wall
      // NO DECLARED BAND: measure the thing that is drawn before believing it
      // is a wall. This is where the table gets thrown out — 2.2 m wide, and
      // 0.10 m tall. Placed after the slab test on purpose: the derive only
      // ever runs on a collider the ray already hit inside 3.4 m.
      if (c.y1 == null) {
        const band = drawnBand(c);
        if (band && bandRejects(band.y0, band.y1, y)) continue;
      }
      // OPEN / SHATTERED WINDOW: the bullet flew through a hole — there is no
      // surface to splat. Skip and keep scanning for a real wall behind it.
      const hx = x + dx * t0, hz = z + dz * t0;
      const nx = face === "xmin" ? -1 : face === "xmax" ? 1 : 0;
      const nz = face === "zmin" ? -1 : face === "zmax" ? 1 : 0;
      if (CBZ.cityShotHole && CBZ.cityShotHole(hx, y, hz, nx, nz)) continue;
      bestT = t0; best = { c, t: t0, face };
    }
    if (!best) return;
    const hx = x + dx * best.t, hz = z + dz * best.t;
    const m = new THREE.Mesh(blob(),
      new THREE.MeshBasicMaterial({ color: decalCol(BLOOD_D), map: bloodTexture(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    let nx = 0, nz = 0, off = 0.03;
    if (best.face === "xmin") { nx = -1; } else if (best.face === "xmax") { nx = 1; }
    else if (best.face === "zmin") { nz = -1; } else { nz = 1; }
    m.position.set(hx + nx * off, y + 0.1 + Math.random() * 0.3, hz + nz * off);
    if (nx) m.rotation.y = nx > 0 ? Math.PI / 2 : -Math.PI / 2;
    m.rotation.z = Math.random() * 6.28;
    m.renderOrder = 4;
    const sz = (0.7 + amt * 0.7) * 0.55;   // blob radius spans 2x a unit plane
    m.scale.set(0.1, 0.1, 1);
    scene().add(m);
    walls.push({
      m, t: instant ? 0.4 : 0, grow: sz, hold: 26, fade: 12,
      wx: 0.85 + Math.random() * 0.3, wy: 0.85 + Math.random() * 0.3,  // per-splat stretch
    });
    // a couple of drip streaks running down from the splat
    const drips = Math.min(3, 1 + Math.round(amt));
    for (let d = 0; d < drips; d++) {
      const dm = new THREE.Mesh(G_PLANE,
        new THREE.MeshBasicMaterial({ color: decalCol(BLOOD_D), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      dm.position.copy(m.position); dm.rotation.copy(m.rotation);
      dm.position.x += nx ? 0 : (Math.random() - 0.5) * sz * 1.3;
      dm.position.z += nx ? (Math.random() - 0.5) * sz * 1.3 : 0;
      dm.scale.set(0.04, 0.1, 1);
      scene().add(dm);
      walls.push({ m: dm, t: 0, grow: 0, hold: 26, fade: 12, drip: 0.3 + Math.random() * 0.7, dripY: m.position.y });
    }
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
  // HEAVY NECK-STUMP SPURT: a real decapitation geysers from the open neck — a
  // dense fan of bright arterial droplets up + along the shot line, plus a thick
  // mist puff and an immediate timed second pulse (the heart pumps twice before it
  // realizes). Pooled/capped through spawnBit like every other gore bit; fades
  // like the rest. Seated at the neck joint (chest-high y + STUMPS.head.py).
  function neckStumpSpurt(x, y, z, dx, dz, lod) {
    const ny = y + STUMPS.head.py - 0.06;   // y arrives chest-high; lift to the neck
    function pulse(strength) {
      const n = Math.round(10 * strength * lod);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.28, sp = 1.4 + Math.random() * 3.2;
        spawnBit(x + (Math.random() - 0.5) * 0.16, ny + Math.random() * 0.12, z + (Math.random() - 0.5) * 0.16,
          dx * (2.0 + Math.random() * 2.8) * strength + Math.cos(a) * sp * 0.6,
          (5.5 + Math.random() * 4.0) * strength,                 // GEYSERS straight up
          dz * (2.0 + Math.random() * 2.8) * strength + Math.sin(a) * sp * 0.6,
          0.06 + Math.random() * 0.07, Math.random() < 0.7 ? BLOOD_BRT : BLOOD, "blood");
      }
      // a thick aerosol cap over the stump
      for (let i = 0; i < Math.round(5 * strength * lod); i++) {
        const a = Math.random() * 6.28, sp = 1 + Math.random() * 2.5;
        spawnBit(x + (Math.random() - 0.5) * 0.2, ny + 0.1 + Math.random() * 0.25, z + (Math.random() - 0.5) * 0.2,
          Math.cos(a) * sp, 1.5 + Math.random() * 2.5, Math.sin(a) * sp,
          0.05 + Math.random() * 0.06, BLOOD_BRT, "mist");
      }
    }
    pulse(1);                       // the burst the moment the head leaves
    after(0.45, function () { pulse(0.7); });   // a second weaker pump
    after(0.95, function () { pulse(0.45); });  // a last trickle pulse
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
    for (let i = 0; i < 3; i++) {
      spawnBit(x, y + 1.05, z,
        (hasDir ? dx * 2 : 0) + (Math.random() - 0.5) * 3, 2 + Math.random() * 2.5,
        (hasDir ? dz * 2 : 0) + (Math.random() - 0.5) * 3,
        0.05 + Math.random() * 0.04, BLOOD_BRT, "blood");
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

  // ---- BLADE KILL: 2-3 timed ARTERIAL spurts as the heart dies ----------------
  // each spurt arcs up and out of the corpse (tracking wherever the ragdoll
  // ended up), weaker each beat; every droplet stamps its own landing splat.
  function arterialArcs(ped, dx, dz) {
    for (let s = 0; s < 3; s++) {
      (function (idx) {
        after(0.3 + idx * 0.45, function () {
          if (!ped || !ped.pos || ped.culled) return;
          const px = ped.pos.x, pz = ped.pos.z, py = ped.pos.y + (idx === 0 ? 1.3 : 0.55);
          const fade = 1 - idx * 0.24;
          const n = 7 - idx * 2;
          for (let i = 0; i < n; i++) {
            spawnBit(px, py, pz,
              dx * (2.2 + Math.random() * 2.4) * fade + (Math.random() - 0.5) * 1.6,
              (4.6 + Math.random() * 2.6) * fade,
              dz * (2.2 + Math.random() * 2.4) * fade + (Math.random() - 0.5) * 1.6,
              DROP_R(0.85), Math.random() < 0.6 ? BLOOD_BRT : BLOOD, "blood");
          }
        });
      })(s);
    }
  }

  // ---- CORPSE STAIN: a body lying in a pool slowly soaks dark -----------------
  // ONE cheap shared-material swap per corpse (never a per-frame tint): torso/
  // legs/arms switch to a cached darkened-blood lambert from the same matCache
  // the gibs use (tagged _shared, so the rig disposal sweep never frees it).
  // Throttled scan, camera-gated, dead+settled bodies only.
  const stainCache = new Map();
  function stainHex(hex) {
    let s = stainCache.get(hex);
    if (s == null) {
      const r = Math.min(255, (((hex >> 16) & 255) * 0.38 + 46) | 0);
      const gr = Math.min(255, (((hex >> 8) & 255) * 0.26 + 8) | 0);
      const b = Math.min(255, ((hex & 255) * 0.26 + 10) | 0);
      s = (r << 16) | (gr << 8) | b; stainCache.set(hex, s);
    }
    return s;
  }
  // walk every body slot of a rig and hand each mesh's current colour to `fn`,
  // swapping in the shared lambert `fn` names back. The ONE place that knows
  // which slots make up a body — stainCorpse and corpseTreat both ride it.
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
  const STAIN_SLOTS = ["torso", "legs", "arms", "collar", "legsLower", "armsLower"];
  function stainCorpse(ped) {
    ped._goreStained = true;
    const ch = ped.char || (ped.isPlayer ? CBZ.playerChar : null);
    if (!ch || !ch.skinSlots) return;
    eachBodyMesh(ch, STAIN_SLOTS, function (mesh) {
      mesh.material = lambert(stainHex(mesh.material.color.getHex()));
    });
  }
  let stainT = 0;
  function stainRoster(list) {
    if (!list) return;
    // "a real kill pool, not a droplet splash" — the threshold has to ride
    // POOL_K with the pools it is filtering, or the realism pass silently
    // stops every corpse in the game from ever soaking dark.
    const kmin = 0.85 * (realism() ? POOL_K : 1);
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p || !p.dead || p._goreStained || p.culled || !p.pos || (p.deadT || 0) < 2.5) continue;
      if (dist2Cam(p.pos.x, p.pos.z) > 45 * 45) continue;     // only stain where it can be seen
      for (let j = 0; j < splats.length; j++) {
        const s = splats[j];
        if (s.streak || s.water || s.max < kmin || s.t < 1.2) continue;  // settled kill-pools only
        const dx = s.m.position.x - p.pos.x, dz = s.m.position.z - p.pos.z;
        if (dx * dx + dz * dz < 1.8) { stainCorpse(p); break; }
      }
    }
  }
  function stainScan() {
    if (!splats.length) return;
    stainRoster(CBZ.cityPeds);
    // THE ISLAND'S DEAD SOAK TOO. This scan only ever looked at CBZ.cityPeds,
    // so a survival corpse could lie face-down in its own kill pool for the
    // whole round and stay factory-clean. Same test, same throttle, same
    // camera gate — the survival roster was simply never asked.
    if (CBZ.game && CBZ.islandModeOn(CBZ.game.mode)) stainRoster(CBZ.bots);
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
     stainCorpse has always used: one shared-material swap per corpse, never a
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
  CBZ.goreDrip = function (x, z, size) {
    if (!CBZ.scene) return;
    if (dist2Cam(x, z) > 55 * 55) return;
    spawnSplat(x, z, Math.max(0.1, Math.min(0.5, size == null ? 0.22 : size)), BLOOD_D, false);
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
            spawnBit(_mfV.x, _mfV.y - 0.05, _mfV.z, (Math.random() - 0.5) * 0.8, -0.2 - Math.random(),
              (Math.random() - 0.5) * 0.8, DROP_R(0.7), Math.random() < 0.5 ? BLOOD_BRT : BLOOD, "blood");
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
      [0.38, 0.92].forEach(function (delay, pulse) {
        after(delay, function () {
          if (!stump.parent || part.visible !== false || (actor && actor.culled)) return;
          const wp = _svp; stump.getWorldPosition(wp);
          // ARM THE MEDIUM PER BEAT, off the stump's LIVE position — a corpse
          // sinks between pulses, and a body that fell in the water after the
          // sever is bleeding into it now even though it wasn't then. spawnBit's
          // own redirect turns these into blooms; the frame loop clears
          // wetEvent the instant this callback returns, so the write is bounded.
          const wet = waterOn() && woundInWater(wp.x, wp.y, wp.z);
          if (wet) wetEvent = true;
          const n = pulse ? 2 : 4;
          for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 1.8;
            spawnBit(wp.x, wp.y, wp.z, Math.cos(a) * sp, 1.6 + Math.random() * 2.4,
              Math.sin(a) * sp, 0.045 + Math.random() * 0.045,
              Math.random() < 0.55 ? BLOOD_BRT : BLOOD, "blood");
          }
          // and the pool the second pulse leaves is a GROUND pool. Under the sea
          // that decal lands on the seabed in the dark; the surface slick is the
          // thing anyone can actually see, so wet bleeds go there instead.
          if (pulse) {
            if (wet) surfaceSlick(wp.x, wp.z, 0.4);
            else spawnSplat(wp.x, wp.z, 0.32, BLOOD_D, true);
          }
        });
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
      for (let i = 0; i < 4; i++) {
        spawnBit(_pm[12], _pm[13], _pm[14], (Math.random() - 0.5) * 3, 3 + Math.random() * 3,
          (Math.random() - 0.5) * 3, DROP_R(0.9), BLOOD_BRT, "blood");
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
        kind: "gib", mat: null, mistFade: 0,
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
      for (let i = 0; i < 4; i++) {
        spawnBit(fly.position.x, fly.position.y, fly.position.z,
          dx * 2 + (Math.random() - 0.5) * 3, 3 + Math.random() * 3, dz * 2 + (Math.random() - 0.5) * 3,
          DROP_R(0.9), BLOOD_BRT, "blood");
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

  function ensureFlash() {
    if (flashEl) return flashEl;
    flashEl = document.createElement("div");
    flashEl.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:26;opacity:0;background:radial-gradient(ellipse at 50% 50%,rgba(150,0,0,0) 42%,rgba(135,0,0,.6) 100%)";
    document.body.appendChild(flashEl);
    return flashEl;
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
    const blunt = opts.melee === "blunt" || cause === "beaten" || cause === "finished off";
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
    if (ctx && ctx.ped && CBZ.bodyWound) {
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
            neckStumpSpurt(x, y, z, dx, dz, lod);
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
      CBZ.goreBloom(x, y + 0.35, z, { amount: 1.1 * amt + (big ? 0.8 : 0), dir: hasDir ? _wdir : null, arterial: true });
      CBZ.goreBloom(x, y + 0.95, z, { amount: 0.7 * amt });
      CBZ.goreSlick(x, z, 0.8 + amt * 0.7 + (big ? 0.5 : 0));
      // THE KILL KEEPS BLEEDING for a beat afterwards. This is the seam a
      // hunting animal reads (CBZ.goreChumList) — it is what makes a body in
      // the water actually pull something toward it instead of being decor.
      CBZ.goreChum(x, y + 0.6, z, Math.min(1, 0.5 + amt * 0.3), 7 + amt * 2);
      if (CBZ.shake && lens) CBZ.shake(0.26 * amt + (opts.player ? 0.4 : 0) + (boom ? 0.2 : 0));
      // lens blood is a ONE-BEAT device, and red barely exists at depth: the
      // jolt lands and is gone, instead of tinting the whole dive red.
      flashV = Math.max(flashV, (0.32 * amt + (opts.player ? 0.18 : 0)) * 0.45);
      if (opts.slowmo && CBZ.doSlowmo) CBZ.doSlowmo(opts.slowmo);
      if (opts.sfx && CBZ.sfx) CBZ.sfx(typeof opts.sfx === "string" ? opts.sfx : "hit");
      wetEvent = false;
      return;
    }

    // --- LAYER 1: directional SPRAY — fast droplets flung AWAY from impact ---
    // forward-biased fan, leaning HARD into the shot line so the exit wound
    // reads which way the bullet went; tighter+faster for a clean headshot,
    // omnidirectional only for boom. Sideways fan stays narrow vs the forward
    // push so the spray is a LINE on the ground, not a blot.
    const spread = boom ? 1.0 : (head ? 0.42 : 0.6);
    const fwd = boom ? 1.5 : (head ? 9 : 6.5);  // forward push along dir (exit wound)
    // finer drops need MORE of them to read as one wet event rather than as a
    // handful of thrown objects — the old count was sized for grapefruits.
    const nb = Math.round((head ? 24 : 16) * (realism() ? 1.35 : 1) * amt * lod);
    for (let i = 0; i < nb; i++) {
      const side = (Math.random() - 0.5) * 2;          // -1..1 across the fan
      const fanX = dx * (fwd + Math.random() * 6) + px * side * spread * (2.5 + Math.random() * 3.5);
      const fanZ = dz * (fwd + Math.random() * 6) + pz * side * spread * (2.5 + Math.random() * 3.5);
      // boom has no preferred direction → omnidirectional ring
      const omni = boom || !hasDir;
      const a = Math.random() * 6.28, sp = 2 + Math.random() * 8;
      // a directed shot throws blood FLATTER (it travels, then lands down-range);
      // only boom lofts it high.
      spawnBit(x, y + 0.3 + Math.random() * 1.2, z,
        omni ? Math.cos(a) * sp * 0.7 : fanX,
        (omni ? 3 + Math.random() * 7 : 2 + Math.random() * 5) + (boom ? 4 : 0),
        omni ? Math.sin(a) * sp * 0.7 : fanZ,
        DROP_R(), Math.random() < 0.5 ? BLOOD : BLOOD_D, "blood");
    }

    // --- LAYER 2: fine MIST — high-velocity aerosol (headshot/rifle/explosion) -
    // subtle hanging puff that drifts on the shot line and fades fast; this is
    // the touch that reads as "real" for high-velocity wounds.
    // a popped skull / blast aerosolizes far more than a through-and-through —
    // a pistol headshot keeps its mist LOCAL (the burst at the entry, not a cloud)
    const nm = Math.round(((popHead || boom) ? 18 : (head ? 12 : 8)) * amt * lod);
    for (let i = 0; i < nm; i++) {
      const a = Math.random() * 6.28, sp = 1 + Math.random() * 4;
      spawnBit(x + (Math.random() - 0.5) * 0.3, y + 0.6 + Math.random() * 1.0, z + (Math.random() - 0.5) * 0.3,
        dx * (big ? 5 : 2.5) + Math.cos(a) * sp,
        2 + Math.random() * 3,
        dz * (big ? 5 : 2.5) + Math.sin(a) * sp,
        0.05 + Math.random() * 0.07, Math.random() < 0.4 ? BLOOD_BRT : BLOOD, "mist");
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
    if (!blunt) restingPool(pgx, pgz, amt);   // blunt already drains in waves below

    // --- LAYER 5: WALL SPLATTER — vertical decal on a surface behind the body -
    // headshots paint the wall INSTANTLY (pre-grown decal) and half-again bigger.
    if (hasDir && !far) spawnWallSplat(x, y + 0.5, z, dx, dz, head ? amt * 1.6 : amt, head);

    // --- CAUSE BEATS: the kill's signature (skipped at distance — pure LOD) ---
    if (!far) {
      // bone only flies when the head actually came apart — a pistol/SMG
      // headshot is a snap + blood, never skull fragments
      if (popHead && hasDir) skullFrags(x, y, z, dx, dz, lod);
      if (blade && ctx && ctx.ped) arterialArcs(ctx.ped, dx, dz);
      if (blunt) {
        bluntBurst(x, y, z, dx, dz, hasDir);
        if (ctx && ctx.ped) delayedBleedPool(ctx.ped);
      }
    }
    // run-over smear: the streak starts under the body and is dragged down-range
    // along the car's travel line. Length scales with the impact fling (≈speed).
    if (ranOver && hasDir) {
      let sl = opts.smearLen || 0;
      if (!sl && ctx && ctx.imp && ctx.imp.fling) sl = 2.2 + Math.min(6.5, ctx.imp.fling * 0.55);
      if (!sl) sl = 4;
      spawnStreak(x - dx * 0.8, z - dz * 0.8, dx, dz, sl);
    }

    if (CBZ.shake && lens) CBZ.shake(0.26 * amt + (opts.player ? 0.4 : 0) + (boom ? 0.2 : 0));
    flashV = Math.max(flashV, 0.32 * amt + (opts.player ? 0.18 : 0));
    if (opts.slowmo && CBZ.doSlowmo) CBZ.doSlowmo(opts.slowmo);
    if (opts.sfx && CBZ.sfx) CBZ.sfx(typeof opts.sfx === "string" ? opts.sfx : "hit");
    wetEvent = false;
  };

  // LOCALIZED FLESH IMPACT — intentionally not a death event. It emits a small
  // directional wet spray/mist with no pool, gibs, flash, slow-mo or kill-context
  // consumption. fpsmode uses this once per connecting pellet; the actual death
  // pipeline calls CBZ.gore exactly once if that hit puts the actor down.
  CBZ.gore.spray = function (point, amount, dir) {
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
    const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    const real = realism();
    const drops = real ? Math.max(4, Math.round(11 * amt)) : Math.max(2, Math.round(5 * amt));
    for (let i = 0; i < drops; i++) {
      spawnBit(point.x, point.y, point.z,
        dx * (2.2 + Math.random() * 3.2) + (Math.random() - 0.5) * 1.8,
        dy * 2 + 0.7 + Math.random() * 2.2,
        dz * (2.2 + Math.random() * 3.2) + (Math.random() - 0.5) * 1.8,
        0.035 + Math.random() * 0.045, Math.random() < 0.35 ? BLOOD_BRT : BLOOD, "blood");
    }
    const mist = Math.max(1, Math.round((real ? 3.5 : 2) * amt));
    for (let i = 0; i < mist; i++) {
      spawnBit(point.x, point.y, point.z,
        dx * (1.5 + Math.random() * 2) + (Math.random() - 0.5),
        dy + 0.5 + Math.random() * 1.3,
        dz * (1.5 + Math.random() * 2) + (Math.random() - 0.5),
        0.035 + Math.random() * 0.035, BLOOD, "mist");
    }
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
             pool:bool, wall:bool, player:bool, sfx:bool|string }
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

    // THE SPRAY. A blunt impact does not have a shot line to exit along, so the
    // fan is wide and the throw is short: blood leaves the wound at the speed
    // the body arrived, not at the speed of a round.
    const px = -dz, pz = dx;
    const nb = Math.max(3, Math.round(11 * amt * lod));
    for (let i = 0; i < nb; i++) {
      const a = Math.random() * 6.28, sp = 1.6 + Math.random() * 4.6;
      const side = (Math.random() - 0.5) * 2;
      spawnBit(x + (Math.random() - 0.5) * 0.3, y + (Math.random() - 0.5) * 0.5, z + (Math.random() - 0.5) * 0.3,
        hasDir ? dx * (2.2 + Math.random() * 4.5 * amt) + px * side * 2.6 : Math.cos(a) * sp,
        (hasDir ? dy * 3.5 : 0) + 1.4 + Math.random() * 3.4 * amt,
        hasDir ? dz * (2.2 + Math.random() * 4.5 * amt) + pz * side * 2.6 : Math.sin(a) * sp,
        DROP_R(), Math.random() < 0.45 ? BLOOD_BRT : BLOOD, "blood");
    }
    if (opts.mist) {
      const nm2 = Math.max(2, Math.round(6 * amt * lod));
      for (let i = 0; i < nm2; i++) {
        const a = Math.random() * 6.28, sp = 0.8 + Math.random() * 2.4;
        spawnBit(x + (Math.random() - 0.5) * 0.35, y + 0.15 + Math.random() * 0.6, z + (Math.random() - 0.5) * 0.35,
          dx * 2.4 * amt + Math.cos(a) * sp, 1.2 + Math.random() * 2,
          dz * 2.4 * amt + Math.sin(a) * sp,
          0.045 + Math.random() * 0.06, BLOOD, "mist");
      }
    }
    // the pool is the RESTRAINT: only an open wound leaves evidence on the
    // ground, so a bruising hit passes pool:false and stains nothing.
    if (opts.pool) spawnSplat(x + dx * 0.3, z + dz * 0.3, 0.5 + amt * 0.75, BLOOD_D, true);
    // driven INTO something → it wears the hit. Same wall-sized/opaque gate.
    if (opts.wall && hasDir && lod === 1) spawnWallSplat(x, y, z, -dx, -dz, amt * 0.85, true);
    if (opts.player) flashV = Math.max(flashV, 0.12 + 0.22 * amt);
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
    if (flashV > 0.002) { ensureFlash().style.opacity = String(Math.min(0.5, flashV)); flashV *= Math.pow(0.0012, dt); }
    else if (flashEl && flashEl.style.opacity !== "0") { flashEl.style.opacity = "0"; flashV = 0; }

    // delayed gore beats (arterial spurts / bleed-out pools)
    for (let i = later.length - 1; i >= 0; i--) {
      const L = later[i]; L.t -= dt;
      // the beat runs in the medium its kill happened in (see after())
      if (L.t <= 0) { later.splice(i, 1); wetEvent = L.wet; try { L.fn(); } catch (e) {} wetEvent = false; }
    }

    // water medium: the sustained bleed sources, then every live plume puff
    updateChum(dt);
    updatePuffs(dt);

    // throttled corpse-stain scan: bodies lying in a pool soak dark, once each
    // + the dismemberment audit: recycled/respawned rigs get their parts back
    stainT -= dt;
    if (stainT <= 0) { stainT = 0.85; stainScan(); }
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
      if (b.kind === "mist") {
        // mist floats: light gravity, drag, gentle rise then settle, fades out
        b.vy -= GRAV * 0.12 * dt;
        b.vx *= Math.pow(0.04, dt); b.vz *= Math.pow(0.04, dt);
        m.position.x += b.vx * dt; m.position.y += b.vy * dt; m.position.z += b.vz * dt;
        // a billboard puff turns to face the lens — the whole point of the quad
        // is that it never shows the viewer an edge or a corner.
        if (b.bill && CBZ.camera) m.quaternion.copy(CBZ.camera.quaternion);
        b.life -= dt;
        const k = Math.max(0, b.life);
        m.scale.setScalar(b.baseScale * (1 + (1 - Math.min(1, b.life)) * 2.2));  // expand as it dissipates
        if (b.mat) b.mat.opacity = (b.bill ? MIST_A : 0.5) * Math.min(1, k * 2.2);
        if (b.life <= 0) { rm(m); bits.splice(i, 1); }
        continue;
      }
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
      if (b.wet) {
        b.vy -= GRAV * 0.22 * dt;
        const wd = Math.pow(0.25, dt);
        b.vx *= wd; b.vy *= wd; b.vz *= wd;
        b.sx *= wd; b.sy *= wd; b.sz *= wd;   // the tumble drags out too
      } else b.vy -= GRAV * dt;
      m.position.x += b.vx * dt; m.position.y += b.vy * dt; m.position.z += b.vz * dt;
      // a droplet is STEERED, not tumbled: it keeps pointing down its own
      // velocity, so the arc of a spray is legible as it falls.
      if (b.drop) aimDrop(m, b.vx, b.vy, b.vz);
      else { m.rotation.x += b.sx * dt; m.rotation.y += b.sy * dt; m.rotation.z += b.sz * dt; }
      // A DROPLET THAT REACHES THE SEA GOES INTO IT. The only vertical test in
      // this loop is decalFloorAt() — the terrain/seabed — so a drop thrown over
      // water fell straight THROUGH the swell and stamped a splat in the dark
      // under thirty metres of water, where nobody will ever see it. Crossing
      // the live surface hands the drop to puffFromBit, the same ballistic→plume
      // seam a wet event uses, so the spray off a breaching shark ends as blood
      // IN the water (the thing the owner likes) instead of as seabed litter.
      // Cost: one guarded submRaw on a jittered ~0.2 s stagger. A blood bit
      // lives 0.7-1.5 s, so that is four to seven queries for its whole flight,
      // not one per drop per frame — and submRaw short-circuits to DRY with no
      // water system at all, so land maps pay a single function call.
      if (b.kind === "blood" && waterOn()) {
        b.seaT -= dt;
        if (b.seaT <= 0) {
          b.seaT = 0.16 + Math.random() * 0.08;
          const sub = submRaw(m.position.x, m.position.y, m.position.z);
          if (sub !== DRY && sub >= 0) {                 // at or under the live surface
            puffFromBit(m.position.x, m.position.y, m.position.z, b.vx, b.vy, b.vz, b.baseScale, false);
            // and enough of them together mark the surface (throttled: see surfaceSlick)
            if (Math.random() < 0.3) surfaceSlick(m.position.x, m.position.z, 0.3);
            rm(m); bits.splice(i, 1); continue;
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
        if (b.kind === "blood") {
          // A LANDING DROPLET LEAVES A SPLASH, NOT A PUDDLE. spawnSplat's
          // `grow` is the decal's RADIUS in world units, so the authored
          // 0.3-0.8 stamped a 60-160 cm blot for every single drop — two dozen
          // of them per kill, overlapping into one red carpet. Hand-sized marks
          // let the SPRAY PATTERN read: you can see which way the round went.
          const g = realism() ? 0.08 + Math.random() * 0.13 : 0.3 + Math.random() * 0.5;
          spawnSplat(m.position.x, m.position.z, g, BLOOD_D, false);
          rm(m); bits.splice(i, 1); continue;
        }
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
        if (b.kind === "blood") b.life -= dt;
        else b.airT = (b.airT || 0) + dt;   // gib still in flight
        // safety: a gib flung off the map (never lands) still retires so a long
        // life can't leak the pool.
        if (b.airT > 14) { rm(m); bits.splice(i, 1); continue; }
      } else {
        // ORIGINAL: only a landed gib (or any blood) counts down.
        if (b.landed || b.kind === "blood") b.life -= dt;
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
      } else if (s.streak) {
        // tire smear: stretches down the travel line over ~half a second,
        // its centre sliding forward so the streak is DRAWN, not stamped.
        const k = Math.min(1, s.t / 0.45);
        const L = Math.max(0.2, s.grow * k);
        s.m.scale.set(s.w, L, 1);
        const cx = s.x0 + s.dx * L * 0.5, cz = s.z0 + s.dz * L * 0.5;
        // a smear crossing TERRAIN re-seats on the surface as its centre slides
        // (only while it is still growing — once drawn it never moves again).
        if (s.slope && k < 1) seatDecal(s.m, cx, cz, s.spin, 0.045, groundGrad(cx, cz));
        else { s.m.position.x = cx; s.m.position.z = cz; }
      } else {
        // pools GROW over seconds: a fast initial blot, then a slow creep out
        // to full size as the body drains (growT: ~3.4s for kill pools).
        const k = Math.min(1, s.t / (s.growT || 0.5));
        const sc = s.grow * (0.34 + 0.66 * Math.sqrt(k));
        s.m.scale.set(Math.max(0.1, sc * (s.ax || 1)), Math.max(0.1, sc * (s.az || 1)), 1);
      }
      const fadeIn = Math.min(1, s.t * 4);
      const fadeOut = s.t > s.hold ? Math.max(0, 1 - (s.t - s.hold) / s.fade) : 1;
      // a slick is a film, not a pool. And a pool is nearly OPAQUE: at 0.66 the
      // white prison concrete came through it and the blood rendered as bright
      // paint-pink; blood sitting on a light floor reads dark.
      // GOING UNDER: a surface slick is ON the water and is never snowed on.
      const under = s.water ? 0 : buriedBy(s, snowCoverNow);
      // DILUTION: what the sea has already carried off is not on the sand any
      // more. It only ever rises, so a mark the waves have thinned does not
      // come back crisp when the water goes out.
      const dil = s.dilute > 0 ? Math.min(1, s.dilute) : 0;
      s.m.material.opacity = (s.water ? 0.42 : (realism() ? 0.88 : 0.66)) * fadeIn * fadeOut * (1 - under) * (1 - dil);
      if (under >= 1 || dil >= 1 || s.t > s.hold + s.fade) { freeSlick(s); splats.splice(i, 1); }
    }

    for (let i = walls.length - 1; i >= 0; i--) {
      const w = walls[i]; w.t += dt;
      if (w.drip) {
        // drip streak crawls downward then halts, growing its length
        const len = Math.min(0.9, w.t * w.drip);
        w.m.scale.set(0.04 + w.t * 0.01, len, 1);
        w.m.position.y = w.dripY - len * 0.5;
      } else {
        const sc = Math.min(w.grow, w.t * 6 * w.grow);
        w.m.scale.set(Math.max(0.1, sc * (w.wx || 1)), Math.max(0.1, sc * (w.wy || 1)), 1);
      }
      const fadeIn = Math.min(1, w.t * 5);
      const fadeOut = w.t > w.hold ? Math.max(0, 1 - (w.t - w.hold) / w.fade) : 1;
      w.m.material.opacity = 0.7 * fadeIn * fadeOut;
      if (w.t > w.hold + w.fade) { rm(w.m); walls.splice(i, 1); }
    }
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
        _rv.set(_RIM[k][0], _RIM[k][1], 0).applyMatrix4(m.matrixWorld);
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
      let boxGibs = 0, drops = 0, mist = 0, maxGib = 0, maxDrop = 0, fatDrop = 0;
      for (let i = 0; i < bits.length; i++) {
        const b = bits[i], bm = b.m, bg = bm && bm.geometry;
        let span = 0, thick = 0;
        if (bg) {
          if (!bg.boundingBox) bg.computeBoundingBox();
          const bb = bg.boundingBox;
          const wx = (bb.max.x - bb.min.x) * Math.abs(bm.scale.x);
          const wy = (bb.max.y - bb.min.y) * Math.abs(bm.scale.y);
          const wz = (bb.max.z - bb.min.z) * Math.abs(bm.scale.z);
          span = Math.max(wx, wy, wz);
          // a stretched droplet's LENGTH is the point of it; what used to read as
          // a floating ball is its CROSS-SECTION, so that is the honest number.
          thick = Math.min(wx, wy, wz);
        }
        if (b.kind === "gib") {
          if (bg && bg.type === "BoxGeometry") boxGibs++;
          if (span > maxGib) maxGib = span;
        } else if (b.kind === "mist") mist++;
        else { drops++; if (span > maxDrop) maxDrop = span; if (thick > fatDrop) fatDrop = thick; }
      }
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
      bits: bits.length, pools, streaks, slicks: water, walls: walls.length,
      realism: realism(), debrisLaw: debrisLaw(), mode: (CBZ.game && CBZ.game.mode) || null,
      boxGibs, drops, mist,
      maxGibCm: Math.round(maxGib * 100), maxDropCm: Math.round(maxDrop * 100),
      maxDropThickCm: Math.round(fatDrop * 100),
      // `gibs` is the count of GENERIC flying boxes still alive, and on the
      // island it may only ever be 0 — the ratchet for "I hate the blood
      // blocks". `severed` counts rigs currently missing a real body part.
      gibs: (function () { let n = 0; for (let i = 0; i < bits.length; i++) if (bits[i].kind === "gib" && !bits[i].limb) n++; return n; })(),
      // LIMBS off, not rigs affected — one body missing an arm and a leg is two
      severed: (function () { let n = 0; for (let i = 0; i < severed.length; i++) n += severed[i].items.length; return n; })(),
      severedRigs: severed.length,
      puffs: puffs.length, pending: later.length,
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
    };
  };

  // wipe all gore (called on a match reset / scene swap)
  CBZ.clearGore = function () {
    for (const r of severed) restoreRecord(r); severed.length = 0;   // every rig leaves whole
    for (const b of bits) rm(b.m); bits.length = 0;
    for (const s of splats) freeSlick(s); splats.length = 0; slickN = 0;
    for (const w of walls) rm(w.m); walls.length = 0;
    // water medium: drop the plume + every bleed source. The pooled sprites go
    // too — a scene swap orphans them, so they must be re-added, not reused.
    for (const b of puffs) rm(b.s); puffs.length = 0;
    for (const b of puffPool) rm(b.s); puffPool.length = 0;
    chum.length = 0; chumOut.length = 0; wetEvent = false;
    later.length = 0; killCtx = null; swashEvents = 0;   // the match total is per match
    flashV = 0; if (flashEl) flashEl.style.opacity = "0";
  };

  // FIRST-BLOOD PREWARM: bake the shared blood texture at load instead of on
  // the first kill — a rocket's first blast is also usually the session's
  // first gore, and this canvas rasterisation used to land in that same
  // already-overloaded impact frame (see crashfx.js's first-blast block).
  bloodTexture();
})();

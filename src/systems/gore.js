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
       - HEADSHOT  → a distinct heavier pop: tighter/faster exit spray, dry
         skull-fragment gibs, and an INSTANT wall splat behind the head; in
         CITY a SHOTGUN (or sniper / point-blank rifle) headshot is a FULL
         DECAPITATION — the head mesh comes OFF, a flying head gib tumbles and
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

   PRESERVED public API: CBZ.gore(x,y,z,opts), CBZ.clearGore().

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
  // little-to-no flying gib (reserve dismemberment for explosions / extreme
  // overkill + a tasteful headshot pop), and any gib that DOES spawn FADES OUT
  // and despawns over a few seconds so the battlefield clears. Jail/survival
  // gore stays byte-identical (this flag is read live at every spawn site).
  function cityMode() { return !!(CBZ.game && CBZ.game.mode === "city"); }
  const GRAV = 24;
  const BLOOD = 0x8a0b10, BLOOD_D = 0x5e070b, BLOOD_BRT = 0xb01218;
  const BONE = 0xe6ddc8, BONE_D = 0xcfc3ad, TOOTH = 0xf2ead8;
  const bits = [];     // flying gibs + blood droplets + mist
  const splats = [];   // ground blood pools + tire-smear streaks
  const walls = [];    // vertical wall/surface splatter decals
  const later = [];    // delayed gore beats (arterial spurts, bleed-out pools)
  let flashEl = null, flashV = 0;

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

  // schedule a delayed gore beat; hard-capped so spam can't queue a flood
  function after(t, fn) { if (later.length > 24) return; later.push({ t, fn }); }

  function scene() { return CBZ.scene; }
  function floorAt(x, z) { return CBZ.floorAt ? CBZ.floorAt(x, z) : 0; }
  function rm(m) { if (!m) return; if (m.parent) m.parent.remove(m); if (m.material && !m.material._shared && m.material.dispose) m.material.dispose(); }

  // ---- shared geometry (one allocation, reused by every bit/decal) ----
  const G_DROP = new THREE.SphereGeometry(1, 5, 4);   // blood droplet (scaled per-bit)
  const G_MIST = new THREE.SphereGeometry(1, 4, 3);   // fine mist puff (low poly)
  const G_GIB = new THREE.BoxGeometry(1, 1, 1);       // chunky gib (scaled per-bit)
  const G_PLANE = new THREE.PlaneGeometry(1, 1);      // smears + drip streaks
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
    // CITY: standing gibs are FADING debris now, not permanent evidence, so the
    // pool can be far smaller — a shootout can never leave a huge persistent
    // pile. Jail/survival keep the original "true world" 520-gib budget.
    const city = cityMode();
    const cap = kind === "mist" ? 620 : (kind === "gib" && city ? 90 : 520);
    if (bits.length > cap) {
      // CITY gibs are fading debris: make room by recycling a far/old LANDED gib
      // instead of refusing to spawn the new piece. Jail/survival keep the
      // original hard-cap drop-if-full behaviour (return null) byte-identical.
      if (kind === "gib" && city && recycleFarGib()) { /* room made */ }
      else return null;
    }
    let geo, mat;
    if (kind === "gib") { geo = G_GIB; mat = lambert(color); }
    else if (kind === "mist") { geo = G_MIST; mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false }); }
    else { geo = G_DROP; mat = lambert(color); }
    const m = new THREE.Mesh(geo, mat);
    // gibs are boxy with random proportions; drops/mist are scaled spheres
    let hh = 0.06;
    if (kind === "gib") {
      if (city) {
        // CITY rest-height: track the box's half-Y so its BOTTOM rests on the road.
        const sy = size * (0.5 + Math.random());
        m.scale.set(size, sy, size * (0.7 + Math.random() * 0.6));
        hh = sy * 0.5;
      } else {
        // jail/survival: original boxy scale, original 0.06 rest radius.
        m.scale.set(size, size * (0.5 + Math.random()), size * (0.7 + Math.random() * 0.6));
      }
    } else m.scale.setScalar(size);
    m.position.set(x, y, z); m.castShadow = false; m.renderOrder = kind === "mist" ? 5 : 0;
    scene().add(m);
    const rec = {
      m, vx, vy, vz, kind, mat: kind === "mist" ? mat : null, mistFade: 0,
      sx: (Math.random() - 0.5) * 18, sy: (Math.random() - 0.5) * 18, sz: (Math.random() - 0.5) * 18,
      landed: false, bled: false, baseScale: size, rad: kind === "gib" ? hh : 0.06,
      // CITY: a landed gib is short-lived debris that SHRINKS/SINKS to nothing
      // (see the updater) so the ground clears after combat — not a permanent
      // colored cube. Jail/survival gibs PERSIST (true world model — evidence
      // you walk back past). Blood/mist are brief in every mode.
      fade: kind === "gib" && city,
      life: kind === "blood" ? 0.7 + Math.random() * 0.8
        : (kind === "mist" ? 0.45 + Math.random() * 0.45
          : (city ? 5 + Math.random() * 4 : 7 + Math.random() * 6)),
    };
    bits.push(rec);
    return rec;
  }

  // recycle the oldest pool that is FAR from the lens (never one underfoot).
  // CITY-only behaviour — jail/survival keep the original drop-the-oldest shift.
  function recycleFarSplat() {
    if (!cityMode()) { rm(splats.shift().m); return; }
    for (let i = 0; i < splats.length; i++) {
      if (dist2Cam(splats[i].m.position.x, splats[i].m.position.z) > 50 * 50) { rm(splats.splice(i, 1)[0].m); return; }
    }
    rm(splats.shift().m);
  }
  function spawnSplat(x, z, grow, color, linger) {
    if (splats.length > 170) recycleFarSplat();
    const m = new THREE.Mesh(blob(),
      new THREE.MeshBasicMaterial({ color: color || BLOOD_D, map: bloodTexture(), transparent: true, opacity: 0, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.random() * 6.28;
    m.position.set(x, floorAt(x, z) + 0.04 + Math.random() * 0.02, z);
    m.renderOrder = 3; m.scale.set(0.1, 0.1, 1);
    scene().add(m);
    // pools GROW over a few seconds (a body keeps draining) and the ones near
    // the PLAYER linger far longer — that's the evidence you walk back past.
    // Far pools keep the short clock so the cap budget stays where it matters.
    const near = dist2Cam(x, z) < 24 * 24;
    splats.push({
      m, t: 0, grow, max: grow, growT: linger ? 3.4 : 0.5,
      hold: linger ? (near ? 75 : 26) : (near ? 16 : 10), fade: linger ? 16 : 8,
      ax: 0.82 + Math.random() * 0.36, az: 0.82 + Math.random() * 0.36,  // per-pool stretch
    });
  }

  // a long, thin blood smear dragged along a travel line (run-over kills):
  // the wheel pulls the pool with it, so the decal stretches out over ~half a
  // second along the car's direction instead of blooming in place.
  function spawnStreak(x0, z0, dx, dz, len) {
    if (splats.length > 170) recycleFarSplat();
    const m = new THREE.Mesh(G_PLANE,
      new THREE.MeshBasicMaterial({ color: BLOOD_D, map: bloodTexture(), transparent: true, opacity: 0, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.atan2(-dx, -dz);          // local +y axis → world (dx,dz)
    m.position.set(x0, floorAt(x0, z0) + 0.045, z0);
    m.renderOrder = 3; m.scale.set(0.55, 0.1, 1);
    scene().add(m);
    const near = dist2Cam(x0, z0) < 24 * 24;
    splats.push({
      m, streak: true, x0, z0, dx, dz, t: 0, grow: len, max: len,
      w: 0.55 + Math.random() * 0.25, hold: near ? 60 : 28, fade: 14,
    });
  }

  // stamp a vertical blood decal on a wall/surface that sits just behind the
  // victim along the impact direction (dir points AWAY from shooter). Cheap:
  // a single AABB scan of CBZ.colliders, no raycaster, capped + distance-gated.
  // `instant` (headshot): the decal arrives pre-grown — the brain hits the wall
  // the same frame as the shot, it doesn't bloom politely afterwards.
  function spawnWallSplat(x, y, z, dx, dz, amt, instant) {
    const cols = CBZ.colliders;
    if (!cols || !cols.length || walls.length > 48) return;
    const MAXD = 3.4;
    let best = null, bestT = MAXD;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i]; if (!c || c.minX == null) continue;
      if (c.y1 != null && (y < c.y0 - 0.3 || y > c.y1 + 0.3)) continue; // height-gated wall out of band
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
      if (face && t0 >= 0 && t0 <= t1 && t0 < bestT) { bestT = t0; best = { c, t: t0, face }; }
    }
    if (!best) return;
    const hx = x + dx * best.t, hz = z + dz * best.t;
    const m = new THREE.Mesh(blob(),
      new THREE.MeshBasicMaterial({ color: BLOOD_D, map: bloodTexture(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
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
        new THREE.MeshBasicMaterial({ color: BLOOD_D, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
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
  // sniper always pops, a shotgun headshot ALWAYS takes the head off (full
  // decapitation in city, see headDecaps), rifle rounds only sometimes —
  // everything pistol-class snaps the head and bursts blood at the entry
  // instead (wound decal + localized splatter stay).
  function weaponKey(imp) {
    let k = imp ? (imp.wkey || (imp.attacker && imp.attacker.weapon) || "") : "";
    return ("" + k).toLowerCase();
  }
  function headPops(imp) {
    const k = weaponKey(imp);
    if (k.indexOf("sniper") >= 0) return true;
    if (k.indexOf("shotgun") >= 0) return true; // a shotgun headshot takes the head OFF (decap, below)
    if (/ak|rifle|carbine|lmg|m4|556|762/.test(k)) return Math.random() < 0.15;
    return false;
  }
  // FULL DECAPITATION (owner: a SHOTGUN headshot takes the head fully OFF, leaving
  // a neck stump + heavy spurt) — reserved for HEAVY weapons so a pistol never
  // decapitates. A shotgun decaps at any range a headshot lands; a sniper always;
  // a point-blank rifle round (<3u, the muzzle in the face) sometimes. Used to
  // drive the heavy neck-stump spurt; the head mesh is removed by severBody either
  // way, but only a decap gets the geyser. City-only is enforced at the call site.
  function headDecaps(imp) {
    const k = weaponKey(imp);
    if (k.indexOf("shotgun") >= 0) return true;
    if (k.indexOf("sniper") >= 0) return true;
    if (/ak|rifle|carbine|lmg|m4|556|762/.test(k)) {
      const d = imp && imp.dist != null ? imp.dist : 99;
      return d < 3 && Math.random() < 0.5;
    }
    return false;
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

  // a beaten body doesn't gush — it BLEEDS OUT: the pool arrives in waves a
  // couple of seconds after the body drops, spreading under wherever it lies.
  function delayedBleedPool(ped) {
    after(1.5, function () { if (ped && ped.pos && !ped.culled) spawnSplat(ped.pos.x, ped.pos.z, 0.9, BLOOD_D, true); });
    after(3.3, function () { if (ped && ped.pos && !ped.culled) spawnSplat(ped.pos.x, ped.pos.z, 1.5, BLOOD_D, true); });
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
              0.055 + Math.random() * 0.06, Math.random() < 0.6 ? BLOOD_BRT : BLOOD, "blood");
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
  function stainCorpse(ped) {
    ped._goreStained = true;
    const ch = ped.char; if (!ch || !ch.skinSlots) return;
    const slots = ch.skinSlots;
    const lists = [slots.torso, slots.legs, slots.arms, slots.collar];
    for (let li = 0; li < lists.length; li++) {
      const list = lists[li]; if (!list) continue;
      for (let mi = 0; mi < list.length; mi++) {
        const mesh = list[mi];
        if (!mesh || !mesh.material || !mesh.material.color) continue;
        mesh.material = lambert(stainHex(mesh.material.color.getHex()));
      }
    }
  }
  let stainT = 0;
  function stainScan() {
    const peds = CBZ.cityPeds;
    if (!peds || !splats.length) return;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || !p.dead || p._goreStained || p.culled || !p.pos || (p.deadT || 0) < 2.5) continue;
      if (dist2Cam(p.pos.x, p.pos.z) > 45 * 45) continue;     // only stain where it can be seen
      for (let j = 0; j < splats.length; j++) {
        const s = splats[j];
        if (s.streak || s.max < 0.85 || s.t < 1.2) continue;  // settled kill-pools only
        const dx = s.m.position.x - p.pos.x, dz = s.m.position.z - p.pos.z;
        if (dx * dx + dz * dz < 1.8) { stainCorpse(p); break; }
      }
    }
  }

  // ============================================================
  //  REAL DISMEMBERMENT — the body that hits the ground is genuinely MISSING
  //  what came off. WHY: spraying generic red cubes while the rig keeps all
  //  its limbs reads FAKE (user-filmed). Now the actual body-part mesh on the
  //  victim's rig is HIDDEN, a clone of THAT part (same proportions, same
  //  clothing/skin materials — head flies with its face) launches from the
  //  part's exact world transform, and a small dark-red cap seats at the
  //  joint so the stump sells it.
  //
  //  RESTORE IS GUARANTEED: rigs are pooled/recycled and the player respawns,
  //  so every sever is held in a registry and a throttled audit restores
  //  visibility + removes the stump the moment the actor is alive again,
  //  culled (about to recycle), or wearing a different rig. CBZ.goreRestoreBody
  //  gives death.js an explicit same-frame restore on player respawn.
  // ============================================================
  const severed = [];                      // { actor, ch, items:[{ key, part, stump }] }
  const SEV_CAP = 24;
  // joint geometry per part: stump position (parent-local) + cap size.
  // arms + head hang off ch.body; legs hang off the root group (character.js).
  const STUMPS = {
    head: { px: 0, py: 1.96, pz: 0, sx: 0.38, sy: 0.16, sz: 0.38, onBody: true },
    la: { px: -0.62, py: 1.78, pz: 0, sx: 0.32, sy: 0.15, sz: 0.32, onBody: true },
    ra: { px: 0.62, py: 1.78, pz: 0, sx: 0.32, sy: 0.15, sz: 0.32, onBody: true },
    ll: { px: -0.23, py: 0.9, pz: 0, sx: 0.36, sy: 0.15, sz: 0.36, onBody: false },
    rl: { px: 0.23, py: 0.9, pz: 0, sx: 0.36, sy: 0.15, sz: 0.36, onBody: false },
  };
  const SEV_LIMBS = ["ll", "rl", "la", "ra"];
  function actorChar(a) { return a ? (a.char || (a.isPlayer ? CBZ.playerChar : null)) : null; }
  // "head" = the whole neck group so the face/hair/cap fly WITH the skull
  function partOf(ch, key) { return key === "head" ? ch.neck : (ch.parts ? ch.parts[key] : null); }

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
    if (!r) {
      if (severed.length >= SEV_CAP) restoreRecord(severed.shift()); // oldest grows back (off-screen by now)
      r = { actor, ch, items: [] };
      severed.push(r);
    }
    part.visible = false;
    // ---- STUMP: a small dark-red cap seated at the joint, riding the rig ----
    const J = STUMPS[key];
    const parent = J.onBody ? (ch.body || ch.group) : ch.group;
    let stump = null;
    if (parent) {
      stump = new THREE.Mesh(G_GIB, lambert(BLOOD_D)); // shared cached material — disposal sweeps skip it
      stump.scale.set(J.sx, J.sy, J.sz);
      stump.position.set(J.px, J.py, J.pz);
      stump.castShadow = false;
      parent.add(stump);
    }
    r.items.push({ key, part, stump });
    // a severed LEG = the rig can't stand: flag the char so entities/character.js
    // drops it into a one-legged collapse/crawl (limpSpeedMul → 0) instead of
    // walking on a missing limb. -1 = left leg gone, +1 = right. Cleared on the
    // restore-on-reuse audit below so a recycled rig starts whole.
    if (key === "ll" || key === "rl") { ch.legGone = key === "ll" ? -1 : 1; ch.legHurt = null; }
    // ---- FLYING PART: a clone of the REAL meshes — same proportions, same
    // clothing/skin materials (shared refs, never disposed) — launched from
    // the part's exact world transform. Never a generic red cube.
    if (!opts.noFly && bits.length < 500) {
      const fly = part.clone();
      for (let i = fly.children.length - 1; i >= 0; i--) {
        if (!fly.children[i].isMesh) fly.remove(fly.children[i]); // hand/weapon sockets stay behind
      }
      fly.visible = true;
      part.matrixWorld.decompose(fly.position, fly.quaternion, fly.scale);
      scene().add(fly);
      let dx = opts.dir ? opts.dir.x || 0 : 0, dz = opts.dir ? opts.dir.z || 0 : 0;
      const dl = Math.hypot(dx, dz);
      if (dl < 0.01) { const a = Math.random() * 6.28; dx = Math.cos(a); dz = Math.sin(a); }
      else { dx /= dl; dz /= dl; }
      const sp = opts.boom ? 4 + Math.random() * 4.5 : 4.5 + Math.random() * 3;
      const up = key === "head" ? 4.5 + Math.random() * 2.5 : (opts.boom ? 5 + Math.random() * 4 : 3 + Math.random() * 2);
      // CITY: even a severed limb clears eventually so a blast doesn't leave a
      // permanent limb field — it lingers a good while (real body part, not a
      // generic cube), then sinks/shrinks away. Jail/survival keep the ORIGINAL
      // short limb life (byte-identical) and no fade.
      const cityLimb = cityMode();
      bits.push({
        m: fly, vx: dx * sp + (Math.random() - 0.5) * 1.5, vy: up, vz: dz * sp + (Math.random() - 0.5) * 1.5,
        kind: "gib", mat: null, mistFade: 0,
        sx: (Math.random() - 0.5) * 12, sy: (Math.random() - 0.5) * 12, sz: (Math.random() - 0.5) * 12,
        landed: false, bled: false, baseScale: 1, rad: key === "head" ? 0.3 : 0.2,
        // fade against the clone's OWN scale (a limb mesh isn't unit-scaled) so
        // the shrink reads right; vScale captures that base. City-only.
        fade: cityLimb, vScale: cityLimb ? fly.scale.clone() : null,
        life: cityLimb ? 14 + Math.random() * 6 : 9 + Math.random() * 5,
      });
      // the wound VENTS at the joint — a bright burst riding the part out
      for (let i = 0; i < 4; i++) {
        spawnBit(fly.position.x, fly.position.y, fly.position.z,
          dx * 2 + (Math.random() - 0.5) * 3, 3 + Math.random() * 3, dz * 2 + (Math.random() - 0.5) * 3,
          0.06 + Math.random() * 0.06, BLOOD_BRT, "blood");
      }
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
  // the audit: any severed actor that's alive again (rig recycled / player
  // respawned), culled, or wearing a fresh rig gets its parts back. One pass,
  // throttled — leak-proof bookkeeping beats trusting every recycle path.
  function severAudit() {
    for (let i = severed.length - 1; i >= 0; i--) {
      const r = severed[i], a = r.actor;
      const alive = a && (a.isPlayer ? !(CBZ.player && CBZ.player.dead) : !a.dead);
      if (!a || alive || a.culled || actorChar(a) !== r.ch) { restoreRecord(r); severed.splice(i, 1); }
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

    const amt = opts.amount != null ? opts.amount : 1;
    // the kill-context tap (one per cityKillPed call) tells us HOW they died —
    // consumed once so the explosion-stump second burst keeps stock treatment.
    let ctx = null;
    if (killCtx && !killCtx.used) { killCtx.used = true; ctx = killCtx; }
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

    // the corpse CARRIES its killing hit (systems/wounds.js): the kill tap
    // already knows WHO died and HOW, so kills arriving from ANY pipeline
    // (player, ped-vs-ped, cops) stamp an entry wound + clothing soak with
    // zero changes at the kill sites. Guarded + self-gating (distance/caps).
    if (ctx && ctx.ped && CBZ.bodyWound) {
      CBZ.bodyWound(ctx.ped, { x, y, z }, { head, cal: amt, melee: blunt ? "blunt" : (blade ? "blade" : null) });
    }

    let dx = 0, dz = 0, hasDir = false;
    if (opts.dir) { dx = opts.dir.x || 0; dz = opts.dir.z || 0; hasDir = (dx || dz); }
    const dm = Math.hypot(dx, dz) || 1; dx /= dm; dz /= dm;
    // perpendicular axis (for fanning the spray to either side of the shot line)
    const px = -dz, pz = dx;
    const skin = opts.skin != null ? opts.skin : 0xc98a5e;
    const cloth = opts.cloth != null ? opts.cloth : 0xd24a32;

    // --- REAL DISMEMBERMENT (severity follows WHAT actually hit them) --------
    //   sniper / point-blank shotgun headshot → the head POPS (the body
    //   collapses headless, face flies with the skull); rifle headshot → a
    //   small chance; pistol/SMG headshot → a hard snap + entry burst, head
    //   stays ON; explosion → 1-3 limbs torn off BY PROXIMITY; shotgun
    //   point-blank body hit → an arm comes off at the shoulder. Falls/blunt/
    //   blade keep the body whole.
    let popHead = !!opts.pop;          // explicit (death.js drives the player's corpse)
    if (ctx && ctx.ped && !ctx.ped.isPlayer) {
      const sevDir = hasDir ? { x: dx, z: dz } : null;
      // NOTE: the local `head` flag also trips on amount>=1.3 (a heat heuristic
      // for the mist/spray) — severing the actual head trusts only the explicit
      // signals, or an RPG would decapitate every victim it ALSO de-limbs.
      if (boom || cause === "explosion") {
        // limbs lost scale with how close the blast seat was — point-blank
        // shreds, the rim of the radius takes one
        let bd = 99;
        if (ctx.imp && ctx.imp.fromX != null && ctx.ped.pos) bd = Math.hypot(ctx.ped.pos.x - ctx.imp.fromX, ctx.ped.pos.z - ctx.imp.fromZ);
        const n = bd < 2.5 ? 3 : (bd < 5 ? 1 + (Math.random() < 0.6 ? 1 : 0) : 1);
        for (let i = 0; i < n; i++) severBody(ctx.ped, SEV_LIMBS[(Math.random() * 4) | 0], { dir: sevDir, boom: true });
      } else if (opts.head || cause === "headshot") {
        if (headPops(ctx.imp)) {
          popHead = severBody(ctx.ped, "head", { dir: sevDir });
          // CITY: a SHOTGUN (or sniper/point-blank) headshot is a FULL
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
      } else if (ctx.imp && ctx.imp.wkey === "shotgun" && (ctx.imp.dist == null ? 99 : ctx.imp.dist) < 7 && Math.random() < 0.75) {
        severBody(ctx.ped, Math.random() < 0.5 ? "la" : "ra", { dir: sevDir });
      }
    }

    // --- LAYER 1: directional SPRAY — fast droplets flung AWAY from impact ---
    // forward-biased fan, leaning HARD into the shot line so the exit wound
    // reads which way the bullet went; tighter+faster for a clean headshot,
    // omnidirectional only for boom. Sideways fan stays narrow vs the forward
    // push so the spray is a LINE on the ground, not a blot.
    const spread = boom ? 1.0 : (head ? 0.42 : 0.6);
    const fwd = boom ? 1.5 : (head ? 9 : 6.5);  // forward push along dir (exit wound)
    const nb = Math.round((head ? 24 : 16) * amt * lod);
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
        0.07 + Math.random() * 0.11, Math.random() < 0.5 ? BLOOD : BLOOD_D, "blood");
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
    // CITY REALISM: a normal gunshot DROPS the person (ragdoll.js leaves an
    // intact body) — it does not blow them into clothing cubes. So reserve the
    // multi-gib spray for EXPLOSIONS and extreme overkill (amount >= 1.8); a
    // headshot gets a small tasteful pop; an ordinary kill gets ZERO flying
    // boxes. Jail/survival keep the original chunky spray on every kill.
    const overkill = amt >= 1.8;
    let ng = Math.round((big ? 7 : 5) * amt * lod);
    if (cityMode()) ng = boom ? Math.round(6 * amt * lod) : (overkill ? Math.round(4 * lod) : (head ? 2 : 0));
    const cols = [skin, cloth, BLOOD, cloth, skin, 0xb8443a, BLOOD_D];
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
    spawnSplat(pgx, pgz, blunt ? 0.45 : (1.1 + amt * 0.9 + (big ? 0.6 : 0)), BLOOD_D, true);
    if (big) spawnSplat(x - dx * 0.5, z - dz * 0.5, 0.6 + amt * 0.4, BLOOD, true);

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

    if (CBZ.shake) CBZ.shake(0.26 * amt + (opts.player ? 0.4 : 0) + (boom ? 0.2 : 0));
    flashV = Math.max(flashV, 0.32 * amt + (opts.player ? 0.18 : 0));
    if (opts.slowmo && CBZ.doSlowmo) CBZ.doSlowmo(opts.slowmo);
    if (opts.sfx && CBZ.sfx) CBZ.sfx(typeof opts.sfx === "string" ? opts.sfx : "hit");
  };

  // one always-updater drives gibs + mist + pools + wall splats + the red jolt
  CBZ.onAlways(8, function (dt) {
    if (dt <= 0) return;
    if (!killTapped) installKillTap();   // peds.js loads after us — tap once it exists
    if (flashV > 0.002) { ensureFlash().style.opacity = String(Math.min(0.5, flashV)); flashV *= Math.pow(0.0012, dt); }
    else if (flashEl && flashEl.style.opacity !== "0") { flashEl.style.opacity = "0"; flashV = 0; }

    // delayed gore beats (arterial spurts / bleed-out pools)
    for (let i = later.length - 1; i >= 0; i--) {
      const L = later[i]; L.t -= dt;
      if (L.t <= 0) { later.splice(i, 1); try { L.fn(); } catch (e) {} }
    }

    // throttled corpse-stain scan: bodies lying in a pool soak dark, once each
    // + the dismemberment audit: recycled/respawned rigs get their parts back
    stainT -= dt;
    if (stainT <= 0) { stainT = 0.85; stainScan(); if (severed.length) severAudit(); }

    // CITY drives the realistic fade/settle/cull path; jail/survival fall back
    // to the original byte-identical gib physics (read once per frame).
    const gibCity = cityMode();
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i], m = b.m;
      if (b.kind === "mist") {
        // mist floats: light gravity, drag, gentle rise then settle, fades out
        b.vy -= GRAV * 0.12 * dt;
        b.vx *= Math.pow(0.04, dt); b.vz *= Math.pow(0.04, dt);
        m.position.x += b.vx * dt; m.position.y += b.vy * dt; m.position.z += b.vz * dt;
        b.life -= dt;
        const k = Math.max(0, b.life);
        m.scale.setScalar(b.baseScale * (1 + (1 - Math.min(1, b.life)) * 2.2));  // expand as it dissipates
        if (b.mat) b.mat.opacity = 0.5 * Math.min(1, k * 2.2);
        if (b.life <= 0) { rm(m); bits.splice(i, 1); }
        continue;
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
      b.vy -= GRAV * dt;
      m.position.x += b.vx * dt; m.position.y += b.vy * dt; m.position.z += b.vz * dt;
      m.rotation.x += b.sx * dt; m.rotation.y += b.sy * dt; m.rotation.z += b.sz * dt;
      const fl = floorAt(m.position.x, m.position.z);
      // rr = the bit's half-height. CITY adds a hair so the piece clears the
      // road paint; jail/survival keep the original bare radius.
      const rr = gibCity ? (b.rad || 0.06) + 0.012 : (b.rad || 0.06);
      if (m.position.y <= fl + rr && b.vy < 0) {
        if (b.kind === "blood") { spawnSplat(m.position.x, m.position.z, 0.3 + Math.random() * 0.5, BLOOD_D, false); rm(m); bits.splice(i, 1); continue; }
        if (gibCity) {
          // CITY SETTLE: clamp to ground, kill vertical, bleed off horizontal +
          // spin. A slow piece comes to REST this frame; a still-fast one keeps a
          // little tumble/roll before stopping.
          m.position.y = fl + rr; b.vy = 0; b.vx *= 0.22; b.vz *= 0.22; b.sx *= 0.12; b.sy *= 0.12; b.sz *= 0.12;
          if (!b.bled) { b.bled = true; spawnSplat(m.position.x, m.position.z, 0.4 + Math.random() * 0.4, BLOOD_D, false); }
          if ((b.vx * b.vx + b.vz * b.vz) < 0.5) { b.landed = true; b.vx = b.vz = b.vy = 0; b.sx = b.sy = b.sz = 0; }
        } else {
          // ORIGINAL jail/survival settle: snap to floor and mark landed at once.
          m.position.y = fl + rr; b.vy = 0; b.vx *= 0.22; b.vz *= 0.22; b.sx *= 0.1; b.sy *= 0.1; b.sz *= 0.1; b.landed = true;
          if (!b.bled) { b.bled = true; spawnSplat(m.position.x, m.position.z, 0.4 + Math.random() * 0.4, BLOOD_D, false); }
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
      if (s.streak) {
        // tire smear: stretches down the travel line over ~half a second,
        // its centre sliding forward so the streak is DRAWN, not stamped.
        const k = Math.min(1, s.t / 0.45);
        const L = Math.max(0.2, s.grow * k);
        s.m.scale.set(s.w, L, 1);
        s.m.position.x = s.x0 + s.dx * L * 0.5;
        s.m.position.z = s.z0 + s.dz * L * 0.5;
      } else {
        // pools GROW over seconds: a fast initial blot, then a slow creep out
        // to full size as the body drains (growT: ~3.4s for kill pools).
        const k = Math.min(1, s.t / (s.growT || 0.5));
        const sc = s.grow * (0.34 + 0.66 * Math.sqrt(k));
        s.m.scale.set(Math.max(0.1, sc * (s.ax || 1)), Math.max(0.1, sc * (s.az || 1)), 1);
      }
      const fadeIn = Math.min(1, s.t * 4);
      const fadeOut = s.t > s.hold ? Math.max(0, 1 - (s.t - s.hold) / s.fade) : 1;
      s.m.material.opacity = 0.66 * fadeIn * fadeOut;
      if (s.t > s.hold + s.fade) { rm(s.m); splats.splice(i, 1); }
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

  // wipe all gore (called on a match reset / scene swap)
  CBZ.clearGore = function () {
    for (const r of severed) restoreRecord(r); severed.length = 0;   // every rig leaves whole
    for (const b of bits) rm(b.m); bits.length = 0;
    for (const s of splats) rm(s.m); splats.length = 0;
    for (const w of walls) rm(w.m); walls.length = 0;
    later.length = 0; killCtx = null;
    flashV = 0; if (flashEl) flashEl.style.opacity = "0";
  };
})();

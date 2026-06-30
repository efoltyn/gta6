/* ============================================================
   city/aircraft.js — police AIR support.

   The police searchlight chopper (3+ stars) lives in police.js. THIS module is
   the heavy military escalation that GTA reserves for the top of the wanted
   meter:

     • 4 STARS — an ATTACK HELICOPTER joins the hunt: a low-poly gunship with a
       spinning rotor and a tracking spotlight that circles overhead and rakes
       you with a door-gun (visible tracers).
     • 5 STARS — the gunship arms its MISSILE pods (a real projectile + smoke
       trail, BIG explosion on impact) AND fighter JETS scream across the map on
       straight strafe runs, salvoing missiles at your last-known.

   Everything is hard-gated to high wanted, pooled, distance/time-sliced, and
   torn down the instant the heat drops. Every cross-module hook is feature-
   detected so a missing sibling module just degrades gracefully.
   ============================================================ */
(function () {
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const rng = Math.random;
  const cmat = CBZ.cmat || CBZ.mat || function (c, o) { return new THREE.MeshLambertMaterial({ color: c }); };

  // NEW MATERIAL API (carfx.js) with a flat-cmat fallback (auto-upgrades when
  // carfx loads). Roles: paint/glass/chrome/metal/rim/tire/lightFront/lightTail/
  // plastic/interior. Police air gets military paint + reflective glass.
  function vmat(role, color, opts) {
    if (CBZ.vehicleMat) { try { return CBZ.vehicleMat(role, color, opts); } catch (e) {} }
    return cmat(color != null ? color : 0x3a4250, opts);
  }

  // SHAPE HELPER (r128 — sculpt the position attribute, then recompute normals).
  // Scales each vertex's X/Y by a factor that depends on its Z (nose=+Z → nz,
  // tail=-Z → tz), with optional roofline (top) / keel (bot) narrowing. Returns a
  // BoxGeometry; callers flag it _shared so the cache disposer leaves it alone.
  function taperBox(w, h, d, opt) {
    opt = opt || {};
    const nz = opt.nz != null ? opt.nz : 1, tz = opt.tz != null ? opt.tz : 1;
    const top = opt.top != null ? opt.top : 1, bot = opt.bot != null ? opt.bot : 1;
    const geo = new THREE.BoxGeometry(w, h, d, opt.segW || 2, opt.segH || 2, opt.segD || 6);
    const pos = geo.attributes.position, hd = d / 2, hh = h / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const f = z / hd, zt = f >= 0 ? (1 + (nz - 1) * f) : (1 + (tz - 1) * -f);
      let sx = zt, sy = zt;
      const vy = hh > 0 ? y / hh : 0;
      if (vy > 0) sx *= (1 + (top - 1) * vy);
      if (vy < 0) sx *= (1 + (bot - 1) * -vy);
      pos.setX(i, x * sx); pos.setY(i, y * sy);
    }
    pos.needsUpdate = true; geo.computeVertexNormals();
    return geo;
  }
  // one thin tapered/drooped rotor blade geometry rooted at the hub (extends +X)
  function bladeGeo(len, droop) {
    const geo = new THREE.BoxGeometry(len, 0.06, 0.34, 6, 1, 1);
    const pos = geo.attributes.position, hl = len / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), t = (x + hl) / len;
      pos.setX(i, x + hl);                                   // root at origin, +X
      pos.setZ(i, pos.getZ(i) * (1 - 0.45 * t));
      pos.setY(i, pos.getY(i) - (droop || 0) * t * t);
    }
    pos.needsUpdate = true; geo.computeVertexNormals();
    return geo;
  }

  // ---- tunables (kept conservative so phones survive a 5-star firefight) ----
  const HELI_STAR   = 4;      // attack heli joins at 4 stars
  const JET_STAR    = 5;      // jets + missiles at 5 stars
  // The tallest tower (The Spire, 9 storeys @4m) tops out near y≈36 and a player
  // standing on its roof is ~y38, so cruise altitudes sit WELL above that: a
  // gunship/jet is never below a rooftop target it's hunting.
  const HELI_Y      = 44;     // cruise altitude of the gunship (clears the tallest roof + a player on it)
  const HELI_CLEAR  = 4;      // min air gap kept over any rooftop the gunship passes over (no fly-through)
  const HELI_R      = 22;     // orbit radius around last-known
  const HELI_SPEED  = 14;     // m/s lateral chase toward orbit point
  const MISSILE_SPD = 46;     // m/s missile travel
  const MAX_MISSILES = 6;     // hard cap on live projectiles (pool size)
  const JET_Y       = 52;     // jet pass altitude (highest — screams overhead)
  // a target this much below the aircraft's nose is a plausible down/level shot;
  // anything higher (player up on a roof above the heli) means the gunner would
  // have to fire straight up — physically can't, so the aircraft must REPOSITION.
  const FIRE_MARGIN = 3;      // metres the player must be BELOW the aircraft to be hittable
  const JET_SPEED   = 95;     // m/s — jets are FAST (a single screaming pass)
  const MAX_JETS    = 2;

  // ---- shared, never-disposed assets (cheap: one geom/mat reused everywhere)-
  let A_root = null;          // arena scene root (resolved lazily)
  let initialized = false;
  let heli = null;            // the single attack gunship, or null
  const jets = [];            // live fighter passes
  const missiles = [];        // active missiles (subset of the pool)
  const missilePool = [];     // recycled missile objects
  let cleanupBound = false;

  // shared geometry/materials — flagged ._shared so any disposer leaves them be
  let G = null;               // lazy geometry/material cache
  function assets() {
    if (G) return G;
    const shared = (o) => { if (o) o._shared = true; return o; };
    // MILITARY PAINT: dark olive-grey gunship, slate-grey fighter — routed through
    // the env-mapped vehicle roles for a clean sheen (flat-cmat fallback). Canopy
    // glass is reflective. A thin emissive police strip keeps them readable as cops.
    const matDark  = vmat('paint', 0x21262b, { ei: 0.02, emissive: 0x05070a });   // gunship olive-charcoal
    const matGrey  = vmat('metal', 0x3a4148, { emissive: 0x14171b, ei: 0.18 });   // nose/skids/struts/trim
    const matJet   = vmat('paint', 0x3a4250, { ei: 0.04, emissive: 0x0c0f14 });   // fighter slate
    const matGlass = vmat('glass', 0x121b22, { emissive: 0x0a151c, ei: 0.4 });    // reflective canopy
    const matStrip = CBZ.cmat ? CBZ.cmat(0x2f6bff, { emissive: 0x2f6bff, ei: 0.85 }) : (CBZ.mat ? CBZ.mat(0x2f6bff, { emissive: 0x2f6bff, ei: 0.85 }) : matGrey);  // POLICE blue strip
    // flag every body material _shared — module-level singletons reused by every
    // gunship/jet; the disposer must never free them (a carfx vehicleMat may be
    // cache-shared with the cars, and our own next spawn re-reads the same cache).
    shared(matDark); shared(matGrey); shared(matJet); shared(matGlass); shared(matStrip);
    G = {
      matDark, matGrey, matJet, matGlass, matStrip,
      // gunship body parts — a clean tandem-cockpit attack-heli silhouette, now
      // SCULPTED (tapered/rounded) instead of plain boxes
      heliBody:  shared(taperBox(1.75, 1.3, 4.8, { nz: 0.55, tz: 0.42, top: 0.72, bot: 0.6, segD: 8 })), // armoured fuselage
      heliNose:  shared(taperBox(1.45, 0.95, 1.1, { nz: 0.4, tz: 1.0, top: 0.7, bot: 0.55 })),  // chin/sensor nose
      heliCanopy:shared(taperBox(1.3, 0.78, 1.95, { nz: 0.6, tz: 0.9, top: 0.5, bot: 1.0 })),   // tandem bubble canopy
      heliBoom:  shared(taperBox(0.52, 0.52, 3.0, { nz: 1.0, tz: 0.5, top: 0.85, bot: 0.85 })), // tapered tail boom
      heliFin:   shared(taperBox(0.16, 1.1, 0.75, { tz: 0.5, top: 0.55 })),        // swept vertical stabiliser
      heliStab:  shared(new THREE.BoxGeometry(1.7, 0.12, 0.6)),  // horizontal tail stabiliser
      heliSkid:  shared(taperBox(0.16, 0.16, 3.4, { nz: 0.5, tz: 0.5, top: 0.8, bot: 0.8 })), // rounded skid rail
      heliStrut: shared(new THREE.BoxGeometry(0.12, 0.55, 0.12)),// skid strut
      heliPod:   shared(taperBox(0.46, 0.46, 1.6, { nz: 0.35, tz: 0.6, top: 0.8, bot: 0.8 })), // faired missile pod
      heliWing:  shared(taperBox(1.1, 0.18, 0.75, { nz: 0.85, tz: 0.75 })),  // stub weapon wing (one side)
      heliHub:   shared(new THREE.CylinderGeometry(0.24, 0.3, 0.26, 8)),     // rotor mast hub
      rotorBlade:shared(bladeGeo(4.2, 0.14)),                    // one main blade (rooted at hub, +X, drooped)
      rotorTail: shared(new THREE.BoxGeometry(0.05, 1.5, 0.28)), // one tail blade
      navBead:   shared(new THREE.BoxGeometry(0.16, 0.16, 0.16)),// nav-light bead
      strip:     shared(new THREE.BoxGeometry(0.05, 0.12, 2.4)), // thin police side strip
      bladeMat:  shared((CBZ.vehicleMat ? vmat('metal', 0x1c2229) : (CBZ.cmat ? CBZ.cmat(0x1c2229, { emissive: 0x070a0d, ei: 0.2 }) : matDark))),
      // jet — clean swept delta with canted twin tails, now sculpted/tapered
      jetBody:   shared(taperBox(1.35, 1.05, 7.8, { nz: 0.24, tz: 0.6, top: 0.72, bot: 0.6, segD: 10 })), // slim fuselage
      jetNose:   shared(new THREE.ConeGeometry(0.24, 1.2, 8)),   // fine nose tip
      jetCanopy: shared(taperBox(0.85, 0.6, 2.0, { nz: 0.5, tz: 0.95, top: 0.45, bot: 1.0 })), // reflective cockpit bubble
      jetWing:   shared(taperBox(3.4, 0.16, 3.1, { nz: 0.35, tz: 0.78, segW: 4 })),  // one swept delta half (tapered)
      jetTail:   shared(taperBox(0.14, 1.35, 1.2, { nz: 0.7, tz: 0.45, top: 0.5 })), // one canted vertical tail
      jetStab:   shared(taperBox(1.5, 0.12, 0.95, { nz: 0.4, tz: 0.7 })),  // tailplane half-span (one side)
      jetIntake: shared(taperBox(0.46, 0.62, 1.7, { nz: 0.7, top: 0.7 })),  // side air intake
      // missile + fx
      missile:   shared(new THREE.CylinderGeometry(0.16, 0.16, 1.4, 7)),
      smoke:     shared(new THREE.SphereGeometry(0.5, 7, 6)),
      // spotlight cone + ground pool
      cone:      shared(new THREE.CylinderGeometry(0.4, 5.5, 1, 14, 1, true)),
      pool:      shared(new THREE.CircleGeometry(5, 20)),
      lightMat:  shared(new THREE.MeshBasicMaterial({ color: 0xfff3c0, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false })),
      poolMat:   shared(new THREE.MeshBasicMaterial({ color: 0xfff3c0, transparent: true, opacity: 0.26, depthWrite: false })),
      // emissive nav-light mats — port red / stbd green / white tail beacon
      navR:      shared(new THREE.MeshBasicMaterial({ color: 0xff2a22 })),
      navG:      shared(new THREE.MeshBasicMaterial({ color: 0x18ff3a })),
      navW:      shared(new THREE.MeshBasicMaterial({ color: 0xeaf4ff })),
      rotorMat:  shared(new THREE.MeshBasicMaterial({ color: 0x0e1015, transparent: true, opacity: 0.5, depthWrite: false })),
      missileMat:shared(new THREE.MeshBasicMaterial({ color: 0xffe7a0 })),
      flameMat:  shared(new THREE.MeshBasicMaterial({ color: 0xffb14a, transparent: true, opacity: 0.9, depthWrite: false })),
      smokeMat:  shared(new THREE.MeshBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.5, depthWrite: false })),
    };
    return G;
  }

  function root() {
    if (A_root && A_root.parent !== undefined) return A_root;
    const arena = CBZ.city && CBZ.city.arena;
    A_root = arena ? arena.root : null;
    return A_root;
  }

  // ---------------------------------------------------------------- helpers --
  function player() { const P = CBZ.player; return P && !P.dead ? P : null; }

  function aimPoint() {
    // prefer the player's actual position if the chopper has eyes on them
    // (painted by police searchlight), else fire on last-known.
    const P = player();
    const seesYou = P && CBZ.cityChopperPaints && CBZ.cityChopperPaints();
    if (P && (seesYou || !g.cityLastKnown)) return { x: P.pos.x, y: 1.2, z: P.pos.z };
    const lk = g.cityLastKnown;
    if (lk) return { x: lk.x, y: 1.2, z: lk.z };
    return P ? { x: P.pos.x, y: 1.2, z: P.pos.z } : null;
  }

  // Can an aircraft sitting at (ax,ay,az) realistically put fire on the player?
  // TWO conditions, both required:
  //   1) GEOMETRY — the player must be meaningfully BELOW the aircraft. A door
  //      gunner / missile pod fires down or level, never straight up, so a player
  //      standing on a roof that is HIGHER than the heli is simply out of arc.
  //   2) LINE OF FIRE — nothing solid between the muzzle and the player (reuse the
  //      shared LOS helper the ground units already self-gate on).
  // Returns false → the aircraft must reposition (climb/circle) before engaging.
  function canEngage(ax, ay, az, P) {
    if (!P) return false;
    const py = (P.pos.y || 0) + 1.4;                 // aim ~chest height of the player
    if (py > ay - FIRE_MARGIN) return false;         // player is at/above us → can't fire up
    if (CBZ.clearLineOfFire && !CBZ.clearLineOfFire(ax, ay, az, P.pos.x, py, P.pos.z)) return false;
    return true;
  }

  // an edge/helipad spawn point for an inbound aircraft, biased toward an angle
  function edgePoint(angle, y) {
    const arena = CBZ.city && CBZ.city.arena;
    const cx = arena && arena.center ? arena.center.x : 0;
    const cz = arena && arena.center ? arena.center.z : 0;
    let span = 120;
    if (arena && arena.minX != null) span = Math.max(arena.maxX - arena.minX, arena.maxZ - arena.minZ) * 0.6 + 30;
    return { x: cx + Math.cos(angle) * span, y: y || HELI_Y, z: cz + Math.sin(angle) * span };
  }

  // ---------------------------------------------------- MISSILE projectiles --
  function getMissile() {
    let m = missilePool.pop();
    if (m) { m.live = true; return m; }
    if (missiles.length >= MAX_MISSILES) return null;   // pool empty + at cap
    const a = assets();
    const grp = new THREE.Group();
    const body = new THREE.Mesh(a.missile, a.missileMat);
    body.rotation.x = Math.PI / 2;     // point the cylinder along +Z (local fwd)
    grp.add(body);
    const flame = new THREE.Mesh(a.smoke, a.flameMat);
    flame.scale.set(0.5, 0.5, 0.9); flame.position.z = -0.9; grp.add(flame);
    return { group: grp, flame, live: true, trail: [], dir: new THREE.Vector3(), life: 0, byPlayer: false };
  }
  function freeMissile(m) {
    m.live = false;
    if (m.group && m.group.parent) m.group.parent.remove(m.group);
    for (const s of m.trail) { if (s.parent) s.parent.remove(s); }
    m.trail.length = 0;
    if (missilePool.length < MAX_MISSILES) missilePool.push(m);
  }

  // Internal launcher. `byPlayer` flags the projectile as the player's (so its
  // blast counts as a player crime + does player-attributed damage). The gunship
  // / jets pass no flag → false (unchanged). The PUBLIC player entry below
  // (CBZ.cityFireMissile) routes here with byPlayer:true.
  function launchMissile(fx, fy, fz, target, byPlayer) {
    if (!target) return;
    const r = root(); if (!r) return;
    const m = getMissile(); if (!m) return;
    m.group.position.set(fx, fy, fz);
    m.dir.set(target.x - fx, (target.y || 1) - fy, target.z - fz).normalize();
    m.life = 0; m.byPlayer = !!byPlayer;
    // orient nose along travel dir
    m.group.lookAt(fx + m.dir.x, fy + m.dir.y, fz + m.dir.z);
    r.add(m.group);
    if (missiles.indexOf(m) < 0) missiles.push(m);
    if (CBZ.sfx) CBZ.sfx("whoosh");
    return m;
  }

  // ---- PUBLIC: player-fired missile (the F-22 / chopper salvo) --------------
  // Fire a REAL missile from (x,y,z) travelling along the direction (dx,dy,dz).
  // It reuses the exact gunship missile pool + trail + detonate(cityExplosion)
  // chain, so it flies, smokes, and blows on the first building / ground / actor
  // it reaches — identical FX to the military's rockets. opts.byPlayer (default
  // TRUE here, since the only caller is the player's aircraft) flags the blast as
  // the player's crime. Returns true if a missile actually launched (false when
  // the MAX_MISSILES pool is saturated — the cap is respected so a mashing player
  // can't flood the scene). City-gated; a no-op outside city mode.
  //
  // We have a DIR, not a target point, so we project a target far down the ray and
  // hand it to launchMissile — the updateMissiles loop then detonates it the
  // instant it strikes geometry/ground, well before that far point.
  CBZ.cityFireMissile = function (x, y, z, dx, dy, dz, opts) {
    if (!g || g.mode !== "city") return false;
    opts = opts || {};
    // normalize the supplied direction (defend against a non-unit vector)
    let nx = dx || 0, ny = dy || 0, nz = dz || 0;
    let len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-5) return false;              // no direction → nothing to fire
    nx /= len; ny /= len; nz /= len;
    // a target FAR along the dir — the missile self-destructs at life 3.2s
    // (≈150m at MISSILE_SPD) anyway, so 400m guarantees it's never "reached".
    const FAR = 400;
    const target = { x: x + nx * FAR, y: y + ny * FAR, z: z + nz * FAR };
    const byPlayer = opts.byPlayer !== false;  // default TRUE for the player entry
    const m = launchMissile(x, y, z, target, byPlayer);
    return !!m;                                // false ⇒ pool was at MAX_MISSILES
  };

  // ---- PUBLIC: missile/blast tuning (so a player salvo reads punchy) --------
  // Read-only-ish knobs the player aircraft can consult. MISSILE_SPD/MAX_MISSILES
  // are the shared pool's tunables; the blast power/radius mirror detonate()'s
  // airstrike call so the FLIGHT agent can size its own UI/recoil to the hit.
  CBZ.cityMissileTuning = {
    speed: MISSILE_SPD,
    maxLive: MAX_MISSILES,
    blastPower: 3.0,
    blastRadius: 16,
    // how many missiles are live right now (a caller can pace its fire-rate)
    liveCount() { return missiles.length; },
  };

  function updateMissiles(dt, r) {
    const a = assets();
    for (let i = missiles.length - 1; i >= 0; i--) {
      const m = missiles[i];
      if (!m.live) { missiles.splice(i, 1); continue; }
      const p = m.group.position;
      const step = MISSILE_SPD * dt;
      p.x += m.dir.x * step; p.y += m.dir.y * step; p.z += m.dir.z * step;
      m.life += dt;
      // smoke trail — recycle puffs, cap count so it never grows unbounded
      if (m.trail.length < 10) {
        const puff = new THREE.Mesh(a.smoke, a.smokeMat);
        puff.position.copy(p); puff._age = 0; r.add(puff); m.trail.push(puff);
      }
      for (let j = m.trail.length - 1; j >= 0; j--) {
        const s = m.trail[j]; s._age += dt;
        // shared smoke mat (can't fade opacity per-puff) → grow + reap instead
        const k = 1 - s._age / 0.9;
        if (k <= 0) { if (s.parent) s.parent.remove(s); m.trail.splice(j, 1); continue; }
        s.scale.setScalar(0.4 + (1 - k) * 1.6);
      }
      // detonate on ground, on a building (losBlockers), or after a max life
      let hit = false, hx = p.x, hy = p.y, hz = p.z;
      if (p.y <= 0.6) { hit = true; hy = 0.4; }
      if (!hit && m.life > 3.2) hit = true;        // safety self-destruct
      if (!hit && hitsBlocker(p)) hit = true;
      if (hit) { detonate(hx, hy, hz, m.byPlayer); freeMissile(m); missiles.splice(i, 1); }
    }
  }

  // cheap building check: is the missile tip inside any LOS blocker's AABB?
  const _tmpBox = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  function hitsBlocker(p) {
    const cols = CBZ.colliders;
    if (!cols || !cols.length) return false;
    // only test a handful near the missile to stay cheap
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (p.x < c.minX || p.x > c.maxX || p.z < c.minZ || p.z > c.maxZ) continue;
      const y0 = c.y0 != null ? c.y0 : 0, y1 = c.y1 != null ? c.y1 : 18;
      if (p.y >= y0 && p.y <= y1) return true;
    }
    return false;
  }

  // byPlayer (default false) marks this detonation as the player's — the blast
  // is then a player crime + does player-attributed kills. Gunship/jet missiles
  // pass nothing → false (police fire, no crime on you).
  function detonate(x, y, z, byPlayer) {
    byPlayer = !!byPlayer;
    // prefer the dedicated airstrike blast (crashfx agent provides it — bigger,
    // longer, with shockwave); fall back to a beefed-up car explosion.
    if (CBZ.cityAirstrikeExplosion) {
      CBZ.cityAirstrikeExplosion(x, z, { power: 3.0, radius: 16, byPlayer: byPlayer, y: y });   // BIGGER blast, ~48m kill radius — a 5★ airstrike levels the block
    } else if (CBZ.cityExplosion) {
      CBZ.cityExplosion(x, z, { power: 2.2, radius: 11, byPlayer: byPlayer });
    }
    // cinematic structural damage on a building hit (buildings agent provides it)
    if (y > 1.5 && CBZ.cityDamageBuilding) {
      try { CBZ.cityDamageBuilding(x, y, z, 2.4); } catch (e) {}
    }
    if (CBZ.shake) CBZ.shake(1.2);
    // the explosion handles blast damage to player/crowd/cops; nothing else here.
  }

  // ------------------------------------------------------ ATTACK HELICOPTER --
  function makeHeli() {
    const r = root(); if (!r) return null;
    const a = assets();
    const grp = new THREE.Group();
    const body = new THREE.Mesh(a.heliBody, a.matDark); grp.add(body);
    // chin sensor nose — sunk into the fuselage front so there's no seam, and
    // dropped/narrowed a touch to read as a taper rather than a step.
    const nose = new THREE.Mesh(a.heliNose, a.matGrey);
    nose.position.set(0, -0.12, 2.55); grp.add(nose);   // geom already tapers — no compensating scale
    // tandem BUBBLE canopy in reflective glass, overlapping the cabin top
    const canopy = new THREE.Mesh(a.heliCanopy, a.matGlass); canopy.position.set(0, 0.6, 0.65); grp.add(canopy);
    // tapered tail boom — its front sinks INTO the rear of the fuselage (no gap)
    const boom = new THREE.Mesh(a.heliBoom, a.matDark);
    boom.position.set(0, 0.32, -3.4); grp.add(boom);    // geom already tapers aft
    const fin = new THREE.Mesh(a.heliFin, a.matDark); fin.position.set(0, 0.78, -4.55); grp.add(fin);
    const stab = new THREE.Mesh(a.heliStab, a.matDark); stab.position.set(0, 0.28, -4.3); grp.add(stab);
    // skids on struts that meet the belly
    const skidL = new THREE.Mesh(a.heliSkid, a.matGrey); skidL.position.set(-0.78, -0.86, 0.1); grp.add(skidL);
    const skidR = new THREE.Mesh(a.heliSkid, a.matGrey); skidR.position.set(0.78, -0.86, 0.1); grp.add(skidR);
    for (const sx of [-0.78, 0.78]) {
      for (const sz of [0.9, -0.9]) {
        const st = new THREE.Mesh(a.heliStrut, a.matGrey); st.position.set(sx, -0.55, sz + 0.1); grp.add(st);
      }
    }
    // stub weapon wings with missile pods — each wing root sinks INTO the
    // fuselage side (x=±0.62 with a 1.1-wide wing) so there's no root gap; the
    // pods hang at x=±1.5 (matching the missile launch offset).
    const wingL = new THREE.Mesh(a.heliWing, a.matGrey); wingL.position.set(-0.95, 0.05, 0.25); grp.add(wingL);
    const wingR = new THREE.Mesh(a.heliWing, a.matGrey); wingR.position.set(0.95, 0.05, 0.25); grp.add(wingR);
    const podL = new THREE.Mesh(a.heliPod, a.matDark); podL.position.set(-1.5, -0.05, 0.25); grp.add(podL);
    const podR = new THREE.Mesh(a.heliPod, a.matDark); podR.position.set(1.5, -0.05, 0.25); grp.add(podR);
    // rotor mast hub + a translucent blur disc + a crossed pair of REAL tapered/
    // drooped blades (the blade geom is rooted at the hub extending +X, so the
    // opposite blade is wrapped in a PI-rotated group; named `rotor` group spun by AI)
    const hub = new THREE.Mesh(a.heliHub, a.matGrey); hub.position.y = 1.02; grp.add(hub);
    const disc = new THREE.Mesh(a.pool, a.rotorMat); disc.rotation.x = -Math.PI / 2; disc.scale.setScalar(4.2 / 5); disc.position.y = 1.05; grp.add(disc);
    const rotor = new THREE.Group(); rotor.position.y = 1.06;
    rotor.add(new THREE.Mesh(a.rotorBlade, a.bladeMat));                 // +X blade
    const opp = new THREE.Group(); opp.rotation.y = Math.PI; opp.add(new THREE.Mesh(a.rotorBlade, a.bladeMat)); rotor.add(opp);  // -X blade
    grp.add(rotor);
    // tail rotor: crossed blades on the fin, group spun about local X
    const trotor = new THREE.Group(); trotor.position.set(0.16, 0.55, -4.78);
    const tb1 = new THREE.Mesh(a.rotorTail, a.bladeMat); trotor.add(tb1);
    const tb2 = new THREE.Mesh(a.rotorTail, a.bladeMat); tb2.rotation.x = Math.PI / 2; trotor.add(tb2);
    grp.add(trotor);
    // NAV LIGHTS (port red / stbd green / white tail beacon) + a thin POLICE strip
    // down each flank — keeps the grey gunship instantly readable as the law.
    const nL = (m, x, y, z) => { const b = new THREE.Mesh(a.navBead, m); b.position.set(x, y, z); grp.add(b); };
    nL(a.navR, -1.5, 0.0, 0.25); nL(a.navG, 1.5, 0.0, 0.25); nL(a.navW, 0, 1.25, -4.6);
    [-0.92, 0.92].forEach((sx) => { const s = new THREE.Mesh(a.strip, a.matStrip); s.position.set(sx, 0.18, 0.4); grp.add(s); });
    // spotlight cone + ground pool (separate, added to root so it lies flat)
    const cone = new THREE.Mesh(a.cone, a.lightMat); grp.add(cone);
    const pool = new THREE.Mesh(a.pool, a.poolMat); pool.rotation.x = -Math.PI / 2; pool.position.y = 0.08;
    r.add(pool);
    // No floating "GUNSHIP" word over the helicopter — the armoured silhouette,
    // missile pods, spotlight and rotor read as a police gunship without a label
    // (a hovering word broke the fourth wall).
    r.add(grp);
    // spawn at a rooftop helipad if buildings.js gave us one, else fly in from edge
    let sp = null;
    if (CBZ.cityHelipad) { try { sp = CBZ.cityHelipad(); } catch (e) { sp = null; } }
    if (!sp) sp = edgePoint(rng() * 6.28, HELI_Y);
    grp.position.set(sp.x, sp.y != null ? Math.max(sp.y, 6) : HELI_Y, sp.z);
    return {
      group: grp, rotor, trotor, cone, pool,
      pos: grp.position, orbit: rng() * 6.28,
      missileCD: 3.5, gunCD: 1.0, leaveT: 0, spotR: 6, climb: 0,
      hp: 140, maxHp: 140, downed: false,           // armoured — ~2 rockets / a sustained burst
      spin: 0, vy: 0, yawRate: 0, smokeCD: 0,
    };
  }

  function despawnHeli() {
    if (!heli) return;
    if (heli.group && heli.group.parent) heli.group.parent.remove(heli.group);
    if (heli.pool && heli.pool.parent) heli.pool.parent.remove(heli.pool);
    disposeGroup(heli.group);
    disposeGroup(heli.pool);
    heli = null;
  }

  function disposeGroup(obj) {
    if (!obj) return;
    obj.traverse(function (o) {
      if (o.isSprite) return;                 // shared sprite geom singleton
      if (o.geometry && !o.geometry._shared && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) {} }
      const m = o.material;
      if (m && !m._shared && m.dispose) { try { m.dispose(); } catch (e) {} }
    });
  }

  // ---- SHOOT-DOWN: the gunship is armoured but killable. Bullets chip it, a
  //      rocket nearly halves it. WHY: a 4★ air threat you can only run from is
  //      a wall; one you can FIGHT (and watch spin out of the sky into a
  //      fireball) is a power fantasy + a reason to carry the RPG. ----
  function damageHeli(dmg, fromX, fromZ) {
    if (!heli || heli.downed) return;
    heli.hp -= dmg;
    if (CBZ.bulletImpact && heli.pos) { try { CBZ.bulletImpact({ x: heli.pos.x, y: heli.pos.y, z: heli.pos.z }, { x: 0, y: 1, z: 0 }, { kind: "spark", power: 1.2 }); } catch (e) {} }
    if (heli.hp <= 0) downHeli();
  }
  function downHeli() {
    if (!heli || heli.downed) return;
    heli.downed = true;
    heli.vy = 2.5;                                          // a sick upward lurch, then it drops
    heli.yawRate = (rng() < 0.5 ? -1 : 1) * (3.5 + rng() * 3);   // tail-rotor-loss death spin
    heli.gunCD = heli.missileCD = 9999;                    // weapons dead
    if (heli.cone) heli.cone.visible = false;
    if (heli.pool) heli.pool.visible = false;
    if (CBZ.sfx) CBZ.sfx("explosion");
    if (CBZ.shake) CBZ.shake(0.4);
    // (no banner — the falling fireball IS the message)
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(50);
    if (CBZ.cityFeed) CBZ.cityFeed("You shot down a police gunship!", "#ff8b6b");
  }
  function fallHeli(dt) {
    if (!heli) return;
    heli.vy -= 17 * dt;                                     // gravity takes over
    heli.pos.y += heli.vy * dt;
    heli.group.rotation.y += heli.yawRate * dt;             // flat spin
    heli.group.rotation.z += dt * 1.7;                      // roll belly-up as it dies
    heli.group.rotation.x = Math.sin((heli.spin += dt * 4) * 0.6) * 0.45;   // pitch lurch
    if (heli.rotor) heli.rotor.rotation.y += dt * 16;       // rotor windmilling down
    if (heli.trotor) heli.trotor.rotation.x += dt * 7;
    // black smoke trail + the odd flame lick
    heli.smokeCD -= dt;
    if (heli.smokeCD <= 0) {
      heli.smokeCD = 0.045;
      if (CBZ.cityCrashSmoke) { try { CBZ.cityCrashSmoke(heli.pos.x, heli.pos.y, heli.pos.z); } catch (e) {} }
      else if (CBZ.cityExplosion && rng() < 0.12) { try { CBZ.cityExplosion(heli.pos.x, heli.pos.z, { power: 0.2, radius: 1.5, byPlayer: false, y: heli.pos.y, noDamage: true }); } catch (e) {} }
    }
    // ground / rooftop impact → detonate where it lands (the explode-on-landing the
    // player asked for: it rides down THEN blows, it doesn't pop in mid-air).
    const ground = CBZ.floorAt ? CBZ.floorAt(heli.pos.x, heli.pos.z) : 0;
    // detonate on whatever it actually hits — a ROOFTOP it falls onto, or the
    // street — so a downed heli no longer sinks through a tower to blow up at the kerb.
    const surf = Math.max(ground, roofTopAt(heli.pos.x, heli.pos.z));
    if (heli.pos.y <= surf + 1.3) {
      const ix = heli.pos.x, iz = heli.pos.z, iy = surf + 1.0;
      // A crashing wreck is a CONTAINED fuel + ordnance fireball — NOT a block-leveling
      // airstrike. That massive blast (detonate -> cityAirstrikeExplosion, power 3/r16)
      // is reserved for missiles + called-in airstrikes; a crash is a fraction of it.
      if (CBZ.cityExplosion) CBZ.cityExplosion(ix, iz, { power: 1.5, radius: 7, byPlayer: false, y: iy });
      else detonate(ix, iy, iz);
      if (CBZ.shake) CBZ.shake(0.6);
      despawnHeli();
    }
  }
  // ray-test the gunship for the player's hitscan (NO damage — the shoot loop
  // applies it, so a shotgun's pellets each count). dir must be normalized.
  CBZ.cityAircraftRayTest = function (ox, oy, oz, dx, dy, dz, range) {
    if (!heli || heli.downed || !heli.pos) return null;
    const cx = heli.pos.x - ox, cy = heli.pos.y - oy, cz = heli.pos.z - oz;
    const t = cx * dx + cy * dy + cz * dz;                  // projection onto the ray
    if (t < 0 || t > range) return null;
    const ex = ox + dx * t - heli.pos.x, ey = oy + dy * t - heli.pos.y, ez = oz + dz * t - heli.pos.z;
    const RAD = 3.6;                                        // generous hitbox (it's far + moving)
    if (ex * ex + ey * ey + ez * ez > RAD * RAD) return null;
    return { x: ox + dx * t, y: oy + dy * t, z: oz + dz * t, dist: t };
  };
  CBZ.cityAircraftDamage = function (dmg, fromX, fromZ) { damageHeli(dmg, fromX, fromZ); };
  // explosion splash (rocket / blast near the heli) — damages if in radius.
  CBZ.cityAircraftSplash = function (x, y, z, radius, dmg) {
    if (!heli || heli.downed || !heli.pos) return false;
    const dx = heli.pos.x - x, dy = heli.pos.y - y, dz = heli.pos.z - z;
    if (dx * dx + dy * dy + dz * dz > radius * radius) return false;
    damageHeli(dmg, x, z); return true;
  };

  // tallest collider top under (x,z) — buildings register wall/slab colliders with
  // y1 = roof height, so this is the rooftop the gunship must stay ABOVE (no more
  // flying through towers) and the surface a crashing heli detonates ON (not the
  // street six storeys below). Same collider data the spotlight roof-scan uses.
  function roofTopAt(x, z) {
    let topY = 0;
    const cols = CBZ.colliders || [];
    for (let ci = 0; ci < cols.length; ci++) {
      const c = cols[ci];
      if (c.y1 == null || c.y1 <= topY) continue;
      if (x < c.minX - 1 || x > c.maxX + 1 || z < c.minZ - 1 || z > c.maxZ + 1) continue;
      topY = c.y1;
    }
    return topY;
  }

  function updateHeli(dt, r) {
    if (heli && heli.downed) { fallHeli(dt); return; }     // a dying heli ignores all AI
    const stars = g.wanted | 0;
    if (stars < HELI_STAR || g.state !== "playing") {
      if (heli) { heli.leaveT += dt; heli.pos.y += dt * 6; if (heli.leaveT > 4) despawnHeli(); }
      return;
    }
    if (!heli) { heli = makeHeli(); if (!heli) return; }
    heli.leaveT = 0;
    const aim = aimPoint();
    const cx = aim ? aim.x : heli.pos.x, cz = aim ? aim.z : heli.pos.z;
    // orbit the target — tighter/faster at higher heat
    heli.orbit += dt * (0.5 + (stars - HELI_STAR) * 0.12);
    const R = HELI_R - (stars - HELI_STAR) * 3;
    const tx = cx + Math.cos(heli.orbit) * R, tz = cz + Math.sin(heli.orbit) * R;
    // base cruise — kept high so we clear the tallest tower. If the player has
    // climbed ABOVE us (on a rooftop), CLIMB to get back over them before we can
    // shoot (a gunner can't fire straight up). This is the "reposition" behaviour.
    const P0 = player();
    const needY = P0 ? (P0.pos.y || 0) + 1.4 + FIRE_MARGIN + 6 : 0;   // stay this far over the player
    const ty = Math.max(HELI_Y - (stars - HELI_STAR) * 2, needY);
    const lat = Math.min(1, dt * (HELI_SPEED / Math.max(R, 6)));
    heli.pos.x += (tx - heli.pos.x) * lat;
    heli.pos.z += (tz - heli.pos.z) * lat;
    heli.pos.y += (ty - heli.pos.y) * Math.min(1, dt * 1.2);
    // NO FLY-THROUGH: never let the body sink into a building — ride over the roof.
    const bodyTop = roofTopAt(heli.pos.x, heli.pos.z);
    if (bodyTop > 0 && heli.pos.y < bodyTop + HELI_CLEAR) heli.pos.y = bodyTop + HELI_CLEAR;
    // bank into the turn + face flight direction
    const head = Math.atan2(tx - heli.pos.x + 0.0001, tz - heli.pos.z + 0.0001);
    heli.group.rotation.y += (head - heli.group.rotation.y) * Math.min(1, dt * 2.5) * 0.4;
    heli.group.rotation.z = Math.sin(heli.orbit) * 0.14;
    heli.rotor.rotation.y += dt * 42;
    heli.trotor.rotation.x += dt * 60;
    // spotlight chases the player but lags (so you can break the beam)
    const P = player();
    const beam = heli.pool.position;
    const tgtx = P ? P.pos.x : cx, tgtz = P ? P.pos.z : cz;
    beam.x += (tgtx - beam.x) * Math.min(1, dt * 0.9);
    beam.z += (tgtz - beam.z) * Math.min(1, dt * 0.9);
    heli.spotR = 6 + stars * 0.5;
    heli.pool.scale.setScalar(heli.spotR / 5);
    // the beam lands on what's under it — over a building the pool climbs to
    // the roof and the cone stops there (same fix as the police searchlight:
    // light through six storeys onto the street read as a bug). Throttled scan.
    heli._roofT = (heli._roofT || 0) - dt;
    if (heli._roofT <= 0) {
      heli._roofT = 0.18;
      let topY = 0;
      const cols = CBZ.colliders || [];
      for (let ci = 0; ci < cols.length; ci++) {
        const c = cols[ci];
        if (c.y1 == null || c.y1 <= topY || c.y1 > heli.pos.y) continue;
        if (beam.x < c.minX - 1 || beam.x > c.maxX + 1 || beam.z < c.minZ - 1 || beam.z > c.maxZ + 1) continue;
        topY = c.y1;
      }
      heli._beamY = topY;
    }
    beam.y = (heli._beamY || 0) + 0.08;
    const len = Math.max(2, heli.pos.y - beam.y);
    heli.cone.position.set(0, -len / 2 - 0.4, 0);
    heli.cone.scale.set(1, len, 1);

    // ---- WEAPONS ---------------------------------------------------------
    if (!aim || !P) return;
    const painted = CBZ.cityChopperPaints ? CBZ.cityChopperPaints() : true;
    const dx = beam.x - P.pos.x, dz = beam.z - P.pos.z;
    const onTarget = (dx * dx + dz * dz) < (heli.spotR * heli.spotR);
    // TRACK THE PLAYER'S VELOCITY (frame delta, smoothed) so the gunner can LEAD a
    // moving target instead of always shooting where you just WERE. Self-contained
    // here — the player actor doesn't expose a velocity this module can trust, so
    // we derive it from how far the chest moved this frame. Clamped dt avoids a
    // spike when the tab re-focuses.
    if (heli._ppx != null && dt > 0.0001 && dt < 0.2) {
      const ivx = (P.pos.x - heli._ppx) / dt, ivz = (P.pos.z - heli._ppz) / dt;
      const k = 1 - Math.pow(0.001, dt);   // ~exp smoothing toward the live reading
      heli.pvx = (heli.pvx || 0) + (ivx - (heli.pvx || 0)) * k;
      heli.pvz = (heli.pvz || 0) + (ivz - (heli.pvz || 0)) * k;
    }
    heli._ppx = P.pos.x; heli._ppz = P.pos.z;
    // REALISTIC SHOT GATE: the player must be below us (down/level arc) AND we must
    // have a clear line of fire from the gun (just below the body) to them. If not,
    // hold fire — the climb above (ty/needY) is already repositioning us to regain
    // the altitude + angle. A player who is HIGHER than the heli is safe until we
    // climb over them. We still cool the timers down so the first valid shot is fast.
    const canHit = canEngage(heli.pos.x, heli.pos.y - 0.6, heli.pos.z, P);
    // DOOR GUN — the old gate only fired while the COSMETIC searchlight beam was
    // sitting on you, so against a moving target it whiffed almost everything (the
    // beam lags 0.9/s behind you on purpose). WHY: a gunship that can't hit a
    // running player is a non-threat. Now the gunner fires whenever it has a real
    // shot (canEngage: you're below the nose + clear line of fire) AND you're
    // inside engagement range — beam-independent. We keep canHit (the altitude +
    // LOS gate) so it still can't shoot through a building or straight up, which
    // preserves rooftop/behind-cover safety. Fire comes in BURSTS: a few rapid
    // tracers, then a breath — readable, survivable, and it LEADS your motion.
    const rdx = heli.pos.x - P.pos.x, rdz = heli.pos.z - P.pos.z;   // true slant range to the player
    const inGunRange = (rdx * rdx + rdz * rdz) < (HELI_R * 1.6) * (HELI_R * 1.6);
    heli.gunCD -= dt;
    if (canHit && inGunRange) {
      if (heli.burst == null || heli.burst <= 0) {
        // start a fresh burst when the per-shot timer comes up
        if (heli.gunCD <= 0) { heli.burst = 3 + ((rng() * 2) | 0); }   // 3–4 rounds
      }
      if (heli.burst > 0 && heli.gunCD <= 0) {
        heli.burst--;
        // tight cadence inside the burst, then a long cool when it empties
        heli.gunCD = heli.burst > 0 ? (0.1 + rng() * 0.06) : (0.85 + rng() * 0.7);
        heliGun(P);
      }
    } else if (heli.burst > 0) {
      heli.burst = 0;   // lost the shot mid-burst → reset (don't dump rounds on reacquire)
    }
    // missiles: only at 5 stars, on a long cooldown, with eyes on you
    if (stars >= JET_STAR) {
      heli.missileCD -= dt;
      if (heli.missileCD <= 0 && (painted || onTarget) && canHit) {
        heli.missileCD = 4.5 + rng() * 2.5;
        const side = rng() < 0.5 ? -1.5 : 1.5;
        // launch from a wing pod, lead the target a touch toward last-known
        const t = aimPoint();
        launchMissile(heli.pos.x + side, heli.pos.y - 0.4, heli.pos.z, t);
        // (no text — the missile has a smoke trail you can see)
      }
    }
  }

  function heliGun(P) {
    if (!heli) return;
    const py = (P.pos.y || 0) + 1.4;                  // the player's ACTUAL chest height (rooftop included)
    const from = { x: heli.pos.x, y: heli.pos.y - 0.6, z: heli.pos.z };
    // LEAD THE TARGET: aim where the player WILL be after the round's flight, not
    // where they are. Time-of-flight ≈ slant range / muzzle speed; the lead is the
    // tracked velocity over that time, capped so a sprinter can't drag the aim off
    // the street. A running player who holds a straight line now gets raked; juking
    // (which spikes/reverses the smoothed velocity) still throws the gun off — so
    // strafing remains the counter-play, exactly as it should be.
    const rng3 = Math.hypot(heli.pos.x - P.pos.x, heli.pos.y - py, heli.pos.z - P.pos.z);
    const tof = Math.min(0.5, rng3 / 220);            // 220 m/s notional round
    let lx = (heli.pvx || 0) * tof, lz = (heli.pvz || 0) * tof;
    const ll = Math.hypot(lx, lz), LMAX = 4.5;        // cap the lead distance
    if (ll > LMAX) { lx = lx / ll * LMAX; lz = lz / ll * LMAX; }
    const aimx = P.pos.x + lx, aimz = P.pos.z + lz;
    const to = { x: aimx + (rng() - 0.5) * 1.4, y: py, z: aimz + (rng() - 0.5) * 1.4 };
    // don't shoot through walls — test the line to the player's true elevation, not
    // a hardcoded ground height (so it neither hits a rooftop target through the roof
    // nor phantom-misses one it can plainly see from above). LOS is to the player's
    // real position (the lead only nudges the visible tracer + hit roll).
    if (CBZ.clearLineOfFire && !CBZ.clearLineOfFire(from.x, from.y, from.z, P.pos.x, py, P.pos.z)) return;
    if (CBZ.tracer) CBZ.tracer(from, to, { muzzleScale: 1.25 });
    if (CBZ.sfx) CBZ.sfx("shoot_carbine");
    // a led shot connects more often — but keep per-round damage LOW (it's a fast
    // burst), so a 5-star air rake stays survivable (the hitstop/missile caps are
    // unchanged). Hit chance rises when our lead actually tracked your motion.
    if (rng() < 0.55 && CBZ.cityHurtPlayer) {
      CBZ.cityHurtPlayer(6 + rng() * 6, heli.pos.x, heli.pos.z, "raked by a gunship", rng() < 0.02, "a police gunship");
    }
  }

  // -------------------------------------------------------- FIGHTER JETS ----
  function makeJet() {
    const r = root(); if (!r) return null;
    const a = assets();
    const grp = new THREE.Group();
    const body = new THREE.Mesh(a.jetBody, a.matJet); grp.add(body);
    // fine NEEDLE nose tip extending the fuselage taper to a sharp point (no seam —
    // the sculpted body already pinches in; this just caps it to a radar boom)
    const nose = new THREE.Mesh(a.jetNose, a.matJet); nose.rotation.x = -Math.PI / 2; nose.position.z = 4.45; grp.add(nose);
    // REFLECTIVE bubble canopy
    const canopy = new THREE.Mesh(a.jetCanopy, a.matGlass); canopy.position.set(0, 0.58, 1.7); grp.add(canopy);
    // side intakes hugging the fuselage
    const inL = new THREE.Mesh(a.jetIntake, a.matJet); inL.position.set(-0.74, -0.14, 0.6); grp.add(inL);
    const inR = new THREE.Mesh(a.jetIntake, a.matJet); inR.position.set(0.74, -0.14, 0.6); grp.add(inR);
    // swept delta wings — each half's root sinks INTO the fuselage side (x≈±0.9
    // with a 3.4-wide half) and is rotated for sweep, so the roots overlap the
    // body with no gap; wingspan ≈ fuselage length.
    const wingL = new THREE.Mesh(a.jetWing, a.matJet);
    wingL.position.set(-1.9, -0.16, -0.7); wingL.rotation.y = 0.32; wingL.rotation.z = 0.06; grp.add(wingL);   // slight dihedral
    const wingR = new THREE.Mesh(a.jetWing, a.matJet);
    wingR.position.set(1.9, -0.16, -0.7); wingR.rotation.y = -0.32; wingR.rotation.z = -0.06; grp.add(wingR);
    // tailplanes
    const stabL = new THREE.Mesh(a.jetStab, a.matJet); stabL.position.set(-0.85, 0, -3.3); stabL.rotation.y = 0.2; grp.add(stabL);
    const stabR = new THREE.Mesh(a.jetStab, a.matJet); stabR.position.set(0.85, 0, -3.3); stabR.rotation.y = -0.2; grp.add(stabR);
    // canted twin vertical tails, roots overlapping the rear fuselage top
    const tailL = new THREE.Mesh(a.jetTail, a.matJet); tailL.position.set(-0.42, 0.78, -3.0); tailL.rotation.z = 0.22; grp.add(tailL);
    const tailR = new THREE.Mesh(a.jetTail, a.matJet); tailR.position.set(0.42, 0.78, -3.0); tailR.rotation.z = -0.22; grp.add(tailR);
    // afterburner glow at the tailpipe
    const burn = new THREE.Mesh(a.smoke, a.flameMat); burn.scale.set(0.7, 0.7, 1.4); burn.position.z = -4.1; grp.add(burn);
    grp._burn = burn;
    // NAV LIGHTS: port wingtip red, stbd wingtip green, white tailfin beacon
    const nL = (m, x, y, z) => { const b = new THREE.Mesh(a.navBead, m); b.position.set(x, y, z); grp.add(b); };
    nL(a.navR, -2.5, -0.05, -1.5); nL(a.navG, 2.5, -0.05, -1.5); nL(a.navW, 0, 1.2, -3.4);
    r.add(grp);
    // a straight pass: pick a heading toward the target, start far off one edge
    const aim = aimPoint();
    const arena = CBZ.city && CBZ.city.arena;
    const cx = aim ? aim.x : (arena && arena.center ? arena.center.x : 0);
    const cz = aim ? aim.z : (arena && arena.center ? arena.center.z : 0);
    const ang = rng() * 6.28;
    const span = edgePoint(ang, JET_Y);   // entry point far on the edge
    grp.position.set(span.x, JET_Y + (rng() - 0.5) * 4, span.z);
    // velocity straight at (a bit past) the target, level flight
    const dir = new THREE.Vector3(cx - span.x, 0, cz - span.z).normalize();
    grp.rotation.y = Math.atan2(dir.x, dir.z);
    return { group: grp, burn, dir, pos: grp.position, life: 0, fired: false, target: { x: cx, z: cz } };
  }

  function despawnJet(j) {
    if (!j) return;
    if (j.group && j.group.parent) j.group.parent.remove(j.group);
    disposeGroup(j.group);
  }

  function updateJets(dt, r) {
    const stars = g.wanted | 0;
    // spawn cadence handled in the main tick; here we just fly + strafe + reap
    for (let i = jets.length - 1; i >= 0; i--) {
      const j = jets[i];
      j.life += dt;
      const step = JET_SPEED * dt;
      j.pos.x += j.dir.x * step; j.pos.z += j.dir.z * step;
      // gentle bob so it doesn't look perfectly rigid
      j.pos.y += Math.sin(j.life * 6) * dt * 0.6;
      if (j.burn) j.burn.scale.z = 1.4 + Math.sin(j.life * 30) * 0.4;
      // fire a missile salvo near closest approach to the target
      if (!j.fired) {
        const dx = j.pos.x - j.target.x, dz = j.pos.z - j.target.z;
        if (dx * dx + dz * dz < 60 * 60) {
          j.fired = true;
          const t = aimPoint();
          launchMissile(j.pos.x, j.pos.y - 0.5, j.pos.z, t);
          // (no banner — you HEAR the jet; diegetic roar below)
          if (CBZ.sfx && CBZ.player) { const dj = Math.hypot(j.pos.x - CBZ.player.pos.x, j.pos.z - CBZ.player.pos.z); CBZ.sfx("rumble", { dist: dj, ghost: true }); }
        }
      }
      // reap once well past / too long aloft (despawn if heat dropped)
      if (j.life > 6.5 || stars < JET_STAR || g.state !== "playing") {
        despawnJet(j); jets.splice(i, 1);
      }
    }
  }

  // ----------------------------------------------------------- main tick -----
  let jetCD = 6;
  function teardown() {
    despawnHeli();
    for (const j of jets) despawnJet(j);
    jets.length = 0;
    for (let i = missiles.length - 1; i >= 0; i--) { freeMissile(missiles[i]); }
    missiles.length = 0;
    jetCD = 6;
  }
  // expose a clean kill switch (wanted-reset / mode-exit can call it)
  CBZ.cityClearAircraft = teardown;

  CBZ.onUpdate(42, function (dt) {
    if (g.mode !== "city") { if (heli || jets.length || missiles.length) teardown(); return; }
    // multiplayer guest: the shared wanted level must not spawn a LOCAL gunship
    if (CBZ.net && CBZ.net.noSim()) { if (heli || jets.length || missiles.length) teardown(); return; }
    const r = root(); if (!r) return;
    if (!cleanupBound) {
      cleanupBound = true;
      // chain onto wanted-reset if it exists so aircraft vanish when you go clean
      if (CBZ.cityWantedReset && !CBZ.cityWantedReset._airWrapped) {
        const orig = CBZ.cityWantedReset;
        CBZ.cityWantedReset = function () { teardown(); return orig.apply(this, arguments); };
        CBZ.cityWantedReset._airWrapped = true;
      }
    }
    const stars = g.wanted | 0;
    const playing = g.state === "playing";

    updateHeli(dt, r);

    // JETS: spawn a fresh strafing pass every few seconds at 5 stars
    if (stars >= JET_STAR && playing) {
      jetCD -= dt;
      if (jetCD <= 0 && jets.length < MAX_JETS && aimPoint()) {
        jetCD = 7 + rng() * 5;
        const j = makeJet(); if (j) jets.push(j);
      }
    } else {
      jetCD = 5;
    }
    updateJets(dt, r);
    updateMissiles(dt, r);
  });
})();

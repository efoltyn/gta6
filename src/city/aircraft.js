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

  // ---- tunables (kept conservative so phones survive a 5-star firefight) ----
  const HELI_STAR   = 4;      // attack heli joins at 4 stars
  const JET_STAR    = 5;      // jets + missiles at 5 stars
  // The tallest tower (The Spire, 9 storeys @4m) tops out near y≈36 and a player
  // standing on its roof is ~y38, so cruise altitudes sit WELL above that: a
  // gunship/jet is never below a rooftop target it's hunting.
  const HELI_Y      = 44;     // cruise altitude of the gunship (clears the tallest roof + a player on it)
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
    const matDark  = CBZ.mat ? CBZ.mat(0x14171d, { ei: 0.02 }) : new THREE.MeshLambertMaterial({ color: 0x14171d });
    const matGrey  = CBZ.mat ? CBZ.mat(0x2a2e36) : matDark;
    const matJet   = CBZ.mat ? CBZ.mat(0x3a4250, { ei: 0.04 }) : new THREE.MeshLambertMaterial({ color: 0x3a4250 });
    shared(matDark); shared(matGrey); shared(matJet);
    G = {
      matDark, matGrey, matJet,
      // gunship body parts
      heliBody:  shared(new THREE.BoxGeometry(2.2, 1.2, 4.8)),
      heliTail:  shared(new THREE.BoxGeometry(0.42, 0.42, 3.2)),
      heliFin:   shared(new THREE.BoxGeometry(0.18, 1.0, 0.7)),
      heliSkid:  shared(new THREE.BoxGeometry(0.16, 0.16, 3.6)),
      heliPod:   shared(new THREE.BoxGeometry(0.5, 0.5, 1.6)),  // wing missile pod
      heliWing:  shared(new THREE.BoxGeometry(2.8, 0.16, 0.7)),
      rotorMain: shared(new THREE.BoxGeometry(8.4, 0.06, 0.55)),
      rotorTail: shared(new THREE.BoxGeometry(0.06, 1.6, 0.3)),
      // jet
      jetBody:   shared(new THREE.BoxGeometry(1.4, 1.0, 8.5)),
      jetNose:   shared(new THREE.ConeGeometry(0.7, 2.4, 8)),
      jetWing:   shared(new THREE.BoxGeometry(7.0, 0.18, 2.2)),
      jetTail:   shared(new THREE.BoxGeometry(0.16, 1.6, 1.4)),
      // missile + fx
      missile:   shared(new THREE.CylinderGeometry(0.16, 0.16, 1.4, 7)),
      smoke:     shared(new THREE.SphereGeometry(0.5, 7, 6)),
      // spotlight cone + ground pool
      cone:      shared(new THREE.CylinderGeometry(0.4, 5.5, 1, 14, 1, true)),
      pool:      shared(new THREE.CircleGeometry(5, 20)),
      lightMat:  shared(new THREE.MeshBasicMaterial({ color: 0xfff3c0, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false })),
      poolMat:   shared(new THREE.MeshBasicMaterial({ color: 0xfff3c0, transparent: true, opacity: 0.26, depthWrite: false })),
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
    const tail = new THREE.Mesh(a.heliTail, a.matDark); tail.position.set(0, 0.25, -3.6); grp.add(tail);
    const fin = new THREE.Mesh(a.heliFin, a.matDark); fin.position.set(0, 0.7, -4.9); grp.add(fin);
    const skidL = new THREE.Mesh(a.heliSkid, a.matGrey); skidL.position.set(-0.85, -0.78, 0); grp.add(skidL);
    const skidR = new THREE.Mesh(a.heliSkid, a.matGrey); skidR.position.set(0.85, -0.78, 0); grp.add(skidR);
    // stub wings with missile pods (so the missiles read as "from the pods")
    const wing = new THREE.Mesh(a.heliWing, a.matGrey); wing.position.set(0, -0.1, 0.3); grp.add(wing);
    const podL = new THREE.Mesh(a.heliPod, a.matDark); podL.position.set(-1.5, -0.2, 0.3); grp.add(podL);
    const podR = new THREE.Mesh(a.heliPod, a.matDark); podR.position.set(1.5, -0.2, 0.3); grp.add(podR);
    const rotor = new THREE.Mesh(a.rotorMain, a.rotorMat); rotor.position.y = 0.95; grp.add(rotor);
    const trotor = new THREE.Mesh(a.rotorTail, a.rotorMat); trotor.position.set(0.18, 0.4, -5.0); grp.add(trotor);
    // spotlight cone + ground pool (separate, added to root so it lies flat)
    const cone = new THREE.Mesh(a.cone, a.lightMat); grp.add(cone);
    const pool = new THREE.Mesh(a.pool, a.poolMat); pool.rotation.x = -Math.PI / 2; pool.position.y = 0.08;
    r.add(pool);
    const tag = CBZ.makeLabelSprite ? CBZ.makeLabelSprite("GUNSHIP", { color: "#ff7b6b" }) : null;
    if (tag) { tag.position.y = 2.3; tag.scale.set(3.4, 0.8, 1); grp.add(tag); }
    r.add(grp);
    // spawn at a rooftop helipad if buildings.js gave us one, else fly in from edge
    let sp = null;
    if (CBZ.cityHelipad) { try { sp = CBZ.cityHelipad(); } catch (e) { sp = null; } }
    if (!sp) sp = edgePoint(rng() * 6.28, HELI_Y);
    grp.position.set(sp.x, sp.y != null ? Math.max(sp.y, 6) : HELI_Y, sp.z);
    return {
      group: grp, rotor, trotor, cone, pool, tag,
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
    if (CBZ.city && CBZ.city.big) CBZ.city.big("🚁 GUNSHIP DOWN");
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
    if (heli.pos.y <= ground + 1.3) {
      const ix = heli.pos.x, iz = heli.pos.z, iy = ground + 1.0;
      detonate(ix, iy, iz);
      if (CBZ.shake) CBZ.shake(0.85);
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
    const len = Math.max(2, heli.pos.y - 0.08);
    heli.cone.position.set(0, -len / 2 - 0.4, 0);
    heli.cone.scale.set(1, len, 1);

    // ---- WEAPONS ---------------------------------------------------------
    if (!aim || !P) return;
    const painted = CBZ.cityChopperPaints ? CBZ.cityChopperPaints() : true;
    const dx = beam.x - P.pos.x, dz = beam.z - P.pos.z;
    const onTarget = (dx * dx + dz * dz) < (heli.spotR * heli.spotR);
    // REALISTIC SHOT GATE: the player must be below us (down/level arc) AND we must
    // have a clear line of fire from the gun (just below the body) to them. If not,
    // hold fire — the climb above (ty/needY) is already repositioning us to regain
    // the altitude + angle. A player who is HIGHER than the heli is safe until we
    // climb over them. We still cool the timers down so the first valid shot is fast.
    const canHit = canEngage(heli.pos.x, heli.pos.y - 0.6, heli.pos.z, P);
    // door gun: rapid tracer fire whenever the beam is roughly on you (4+ stars)
    heli.gunCD -= dt;
    if (heli.gunCD <= 0 && onTarget && canHit) {
      heli.gunCD = 0.55 + rng() * 0.4;
      heliGun(P);
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
        if (CBZ.city && CBZ.city.note && rng() < 0.5) CBZ.city.note("Gunship missile inbound!", 1.6);
      }
    }
  }

  function heliGun(P) {
    if (!heli) return;
    const py = (P.pos.y || 0) + 1.4;                  // the player's ACTUAL chest height (rooftop included)
    const from = { x: heli.pos.x, y: heli.pos.y - 0.6, z: heli.pos.z };
    const to = { x: P.pos.x + (rng() - 0.5) * 1.8, y: py, z: P.pos.z + (rng() - 0.5) * 1.8 };
    // don't shoot through walls — test the line to the player's true elevation, not
    // a hardcoded ground height (so it neither hits a rooftop target through the roof
    // nor phantom-misses one it can plainly see from above).
    if (CBZ.clearLineOfFire && !CBZ.clearLineOfFire(from.x, from.y, from.z, P.pos.x, py, P.pos.z)) return;
    if (CBZ.tracer) CBZ.tracer(from, to, { muzzleScale: 1.25 });
    if (CBZ.sfx) CBZ.sfx("shoot_carbine");
    if (rng() < 0.5 && CBZ.cityHurtPlayer) {
      CBZ.cityHurtPlayer(7 + rng() * 6, heli.pos.x, heli.pos.z, "raked by a gunship", rng() < 0.02, "a police gunship");
    }
  }

  // -------------------------------------------------------- FIGHTER JETS ----
  function makeJet() {
    const r = root(); if (!r) return null;
    const a = assets();
    const grp = new THREE.Group();
    const body = new THREE.Mesh(a.jetBody, a.matJet); grp.add(body);
    const nose = new THREE.Mesh(a.jetNose, a.matJet); nose.rotation.x = -Math.PI / 2; nose.position.z = 5.2; grp.add(nose);
    const wing = new THREE.Mesh(a.jetWing, a.matJet); wing.position.z = -0.4; grp.add(wing);
    const tail = new THREE.Mesh(a.jetTail, a.matJet); tail.position.set(0, 0.8, -3.8); grp.add(tail);
    // afterburner glow
    const burn = new THREE.Mesh(a.smoke, a.flameMat); burn.scale.set(0.7, 0.7, 1.4); burn.position.z = -4.6; grp.add(burn);
    grp._burn = burn;
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
          if (CBZ.city && CBZ.city.big && rng() < 0.4) CBZ.city.big("AIRSTRIKE");
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

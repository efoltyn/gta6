/* ============================================================
   city/aircraft.js — police AIR support.

   The police searchlight chopper (3+ stars) lives in police.js. THIS module is
   the heavy military escalation that GTA reserves for the top of the wanted
   meter:

     • 5 STARS — named soldiers leave their existing posts, board the helicopters
       and fighters already parked at Fort Brandt, spool, roll/lift from the real
       base, and only then join the hunt.  No anonymous aircraft is spawned near
       the player.  Surviving crews fly the same airframes back to their pads.

   Everything is hard-gated to high wanted, pooled, distance/time-sliced, and
   torn down the instant the heat drops. Every cross-module hook is feature-
   detected so a missing sibling module just degrades gracefully.
   ============================================================ */
(function () {
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  // seeded LCG (project convention — NEVER Math.random, so a city run replays
  // deterministically). This module previously aliased rng straight to
  // Math.random; fixed here while the file is already open for the flight
  // model work.
  let _s = 90217;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
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
  const HELI_STAR   = 5;      // military owns only the rare top wanted tier
  const JET_STAR    = 5;      // jets + missiles at 5 stars
  // Street-search baseline. Local terrain/roof clearance below raises the
  // gunship only where needed, instead of making every pass unshootably high.
  const HELI_Y      = 26;
  const HELI_AGL    = 24;
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
      heliStrut: shared(new THREE.BoxGeometry(0.2, 0.55, 0.2)), // skid strut (chunky — thin members float at distance)
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
      matDarkest:shared(vmat('interior', 0x0b0d10)),                          // gun barrels / nozzle throats / insets
      // GUNSHIP detail kit — rotor head, chin gun, FLIR, pod muzzles, crew door
      heliCowl:  shared(taperBox(0.95, 0.5, 2.0, { tz: 0.6, top: 0.7 })),     // engine cowl under the mast
      heliPlate: shared(new THREE.CylinderGeometry(0.34, 0.42, 0.12, 8)),     // swashplate ring under the hub
      heliExh:   shared(new THREE.CylinderGeometry(0.13, 0.17, 0.55, 7)),     // exhaust stub pipe
      heliChin:  shared(taperBox(0.5, 0.42, 0.75, { nz: 0.65, bot: 0.6 })),   // chin-turret cradle
      heliBarrel:shared(new THREE.CylinderGeometry(0.06, 0.06, 0.95, 6)),     // chin-gun barrel
      heliFlir:  shared(new THREE.SphereGeometry(0.26, 10, 8)),               // FLIR sensor ball
      heliLamp:  shared(new THREE.CylinderGeometry(0.17, 0.24, 0.3, 8)),      // searchlight gimbal housing
      podCap:    shared(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 8)),        // rocket-pod muzzle face
      podTube:   shared(new THREE.CylinderGeometry(0.07, 0.07, 0.24, 6)),     // pod center tube stub
      doorPanel: shared(new THREE.BoxGeometry(0.06, 0.72, 0.95)),             // crew-door inset panel
      doorStep:  shared(new THREE.BoxGeometry(0.08, 0.08, 0.9)),              // boarding step rail
      // JET detail kit — LERX chines, burner cans, wingtip rails + missiles
      jetChine:  shared(taperBox(0.5, 0.09, 2.6, { nz: 0.25 })),              // LERX strake (one side)
      jetCan:    shared(new THREE.CylinderGeometry(0.27, 0.23, 0.75, 8)),     // afterburner can
      jetCanIn:  shared(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 8)),      // dark nozzle throat
      tipRail:   shared(new THREE.BoxGeometry(0.09, 0.09, 1.1)),              // wingtip launch rail
      tipMsl:    shared(new THREE.CylinderGeometry(0.075, 0.075, 1.35, 6)),   // wingtip missile body
      tipCone:   shared(new THREE.ConeGeometry(0.075, 0.28, 6)),              // missile nose
    };
    return G;
  }

  function root() {
    if (A_root && A_root.parent !== undefined) return A_root;
    const arena = CBZ.city && CBZ.city.arena;
    A_root = arena ? arena.root : null;
    return A_root;
  }

  function angleDelta(a, b) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  function turnToward(a, b, maxStep) {
    const d = angleDelta(a, b);
    return a + Math.max(-maxStep, Math.min(maxStep, d));
  }

  // Pick an authored parked airframe and a specific living soldier.  The
  // military-vehicle registry owns availability/collider bookkeeping; this
  // module only flies the claimed object.  There is deliberately no procedural
  // fallback: if the base has no available aircraft or pilot, no air response
  // materialises from nowhere.
  function parkedMilitary(kind) {
    const list = CBZ.cityMilitaryVehicles || [];
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (!v || v.civilian || v.kind !== kind || v.taken || v._aiActive || !v.group || !v.group.parent) continue;
      if (kind === "plane" && v.model && /bomber/i.test(v.model.name || "")) continue;
      return v;
    }
    return null;
  }
  function militaryPilot(rec) {
    const troops = CBZ.cityMilitaryPersonnel || [];
    let best = null, bd = Infinity;
    for (let i = 0; i < troops.length; i++) {
      const p = troops[i];
      if (!p || p.dead || p._milPilot || p._airPilot || (CBZ.body && CBZ.body.busy && CBZ.body.busy(p))) continue;
      const d = Math.hypot(p.pos.x - rec.pos.x, p.pos.z - rec.pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  function claimMilitary(kind) {
    const rec = parkedMilitary(kind); if (!rec) return null;
    const pilot = militaryPilot(rec); if (!pilot) return null;
    if (!CBZ.cityClaimMilitaryVehicle || !CBZ.cityClaimMilitaryVehicle(rec, pilot)) return null;
    pilot._milPilot = rec; pilot._milPilotPrev = { state: pilot.state, pause: pilot.pause };
    pilot.rage = null; pilot.targetActor = null; pilot.speed = 0;
    pilot.state = "pilot"; pilot.inCar = true; pilot.group.visible = false;
    return { rec, pilot, home: Object.assign({}, rec._aiHome) };
  }
  function releaseMilitary(craft, crashed) {
    if (!craft) return;
    const rec = craft.sourceRec, p = craft.pilot;
    if (p) {
      p._milPilot = null; p.inCar = false;
      p.pos.set(crashed ? craft.pos.x : craft.home.x + 3,
        0,
        crashed ? craft.pos.z : craft.home.z + 2);
      p.group.visible = true;
      if (crashed) {
        // The pilot is a real roster person, so losing the aircraft also loses
        // its crew instead of quietly returning an invisible NPC to the base.
        if (!p.dead && CBZ.cityKillPed) CBZ.cityKillPed(p, {
          fromX: craft.pos.x - 1, fromZ: craft.pos.z - 1,
          force: 12, fling: 6, byPlayer: false,
        }, "killed in an aircraft crash");
      } else {
        p.state = p._stationed ? "walk" : ((p._milPilotPrev && p._milPilotPrev.state) || "idle");
        p.pause = 0; p.rage = null; p.targetActor = null;
      }
    }
    if (rec && CBZ.cityReleaseMilitaryVehicle) CBZ.cityReleaseMilitaryVehicle(rec, !!crashed);
    craft.pilot = null;
  }

  // ---------------------------------------------------------------- helpers --
  function player() { const P = CBZ.player; return P && !P.dead ? P : null; }
  function craftRadius(craft, fallback) {
    const r = craft && craft.sourceRec;
    if (!r) return fallback;
    return Math.max(fallback, Math.min(11, Math.max(r.footW || 0, r.footL || 0) * 0.42));
  }

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
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 8), a.missileMat);
    nose.rotation.x = -Math.PI / 2; nose.position.z = 0.9; grp.add(nose);
    for (let i = 0; i < 2; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.035, 0.30), a.matDark);
      fin.position.z = -0.58; fin.rotation.z = i * Math.PI / 2; grp.add(fin);
    }
    const flame = new THREE.Mesh(a.smoke, a.flameMat);
    flame.scale.set(0.42, 0.42, 1.45); flame.position.z = -1.05; grp.add(flame);
    return { group: grp, flame, live: true, trail: [], dir: new THREE.Vector3(), life: 0, byPlayer: false, seek: null };
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
  //
  // `seek` (optional): a zero-arg function returning a LIVE {x,y,z} point to
  // re-aim toward every frame (a simple proportional-nav-lite homer — see
  // updateMissiles). Pass null/omit for the old straight-line behaviour
  // (still used for anything fired at a static point, e.g. a building).
  function launchMissile(fx, fy, fz, target, byPlayer, seek) {
    if (!target) return;
    const r = root(); if (!r) return;
    const m = getMissile(); if (!m) return;
    m.group.position.set(fx, fy, fz);
    m.dir.set(target.x - fx, (target.y || 1) - fy, target.z - fz).normalize();
    m.life = 0; m.byPlayer = !!byPlayer; m.seek = seek || null;
    // orient nose along travel dir
    m.group.lookAt(fx + m.dir.x, fy + m.dir.y, fz + m.dir.z);
    r.add(m.group);
    if (missiles.indexOf(m) < 0) missiles.push(m);
    if (CBZ.sfx) CBZ.sfx("whoosh");
    return m;
  }

  // pick a live AI aircraft (gunship or jet) roughly ahead of a player-fired
  // missile's launch ray, within a forward cone + max range, so a player
  // salvo aimed AT the police air can lock on — but firing at a building or
  // the street (nothing hostile near that ray) stays a plain straight shot.
  // Returns a zero-arg `seek` getter (re-reads the live position every frame,
  // same lock-loss-on-death contract as the AI seekers) or null.
  const LOCK_CONE = Math.cos(18 * Math.PI / 180);   // ~18° half-angle
  const LOCK_RANGE = 160;
  function pickPlayerLockSeek(fx, fy, fz, nx, ny, nz) {
    let best = null, bestDot = LOCK_CONE;
    const consider = (obj, isHeli) => {
      if (!obj || obj.downed || !obj.pos) return;   // jets are downable now too — never lock a falling wreck
      const dx = obj.pos.x - fx, dy = obj.pos.y - fy, dz = obj.pos.z - fz;
      const d = Math.hypot(dx, dy, dz);
      if (d < 1 || d > LOCK_RANGE) return;
      const dot = (dx * nx + dy * ny + dz * nz) / d;
      if (dot > bestDot) { bestDot = dot; best = obj; }
    };
    consider(heli, true);
    for (let i = 0; i < jets.length; i++) consider(jets[i], false);
    if (!best) return null;
    return function () { return (best && best.pos && !(best.downed)) ? { x: best.pos.x, y: best.pos.y, z: best.pos.z } : null; };
  }

  // Shared seeker hookup for handheld/vehicle launchers. It returns a live
  // position getter rather than the private craft object, so other weapon
  // systems can guide toward police air without learning this module's entity
  // layout or holding a stale position after the target is shot down.
  CBZ.cityAircraftAcquireTarget = function (fx, fy, fz, nx, ny, nz, range, coneCos) {
    range = range || LOCK_RANGE;
    coneCos = coneCos != null ? coneCos : LOCK_CONE;
    let best = null, bestDot = coneCos, bestDist = Infinity, bestRadius = 3.2;
    const consider = function (obj, radius) {
      if (!obj || obj.downed || !obj.pos) return;
      const dx = obj.pos.x - fx, dy = obj.pos.y - fy, dz = obj.pos.z - fz;
      const d = Math.hypot(dx, dy, dz);
      if (d < 1 || d > range) return;
      const dot = (dx * nx + dy * ny + dz * nz) / d;
      if (dot < bestDot || (Math.abs(dot - bestDot) < 0.002 && d >= bestDist)) return;
      best = obj; bestDot = dot; bestDist = d; bestRadius = radius;
    };
    consider(heli, craftRadius(heli, 3.6));
    for (let i = 0; i < jets.length; i++) consider(jets[i], craftRadius(jets[i], 3.2));
    if (!best) return null;
    const target = best;
    return {
      kind: "aircraft", dot: bestDot, distance: bestDist, radius: bestRadius,
      seek: function () {
        return target && target.pos && !target.downed
          ? { x: target.pos.x, y: target.pos.y, z: target.pos.z }
          : null;
      },
    };
  };

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
    // HOMING: if the player's aim ray is roughly on a live police gunship/jet,
    // lock it (proportional-nav-lite, same as the AI's missiles) — otherwise
    // this stays the old straight shot (a building/ground strike never homes).
    const seek = byPlayer ? pickPlayerLockSeek(x, y, z, nx, ny, nz) : null;
    const m = launchMissile(x, y, z, target, byPlayer, seek);
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

  // proportional-nav-LITE turn rate: enough to run down a target flying
  // straight, not enough to out-turn a player who breaks hard (banks +
  // changes altitude). A fixed-wing-style cap — generous early in flight
  // (the missile is fast and the geometry forgives it), tightened by a
  // short "seeker arm" delay so a missile can't snap-track the instant it
  // leaves the rail (a real seeker has to acquire first).
  const HOMING_TURN_RATE = 1.8;     // rad/s
  const HOMING_ARM_T     = 0.35;    // s before the seeker starts steering
  function updateMissiles(dt, r) {
    const a = assets();
    for (let i = missiles.length - 1; i >= 0; i--) {
      const m = missiles[i];
      if (!m.live) { missiles.splice(i, 1); continue; }
      const p = m.group.position;
      // ---- HOMING: proportional-nav-lite. Only re-aims if the launcher gave
      // us a live `seek` getter (a static-point shot — e.g. at a building —
      // stays a straight-line projectile exactly as before). Capped turn rate
      // means a target that keeps maneuvering can fly the missile off its
      // tail; a target holding a straight line gets walked down.
      if (m.seek && m.life > HOMING_ARM_T && CBZ.aeroPhysics) {
        const tp = m.seek();
        if (tp) {
          const nd = CBZ.aeroPhysics.homingSteer(m.dir, tp.x - p.x, (tp.y != null ? tp.y : p.y) - p.y, tp.z - p.z, HOMING_TURN_RATE, dt);
          m.dir.set(nd.x, nd.y, nd.z);
          m.group.lookAt(p.x + nd.x, p.y + nd.y, p.z + nd.z);
        }
      }
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
  // Mesh-only builder (no scene/arena dependency) — used by makeHeli below and
  // exposed for tools/studio.mjs asset photography (CBZ.debugBuildPoliceAir).
  function buildGunshipGroup() {
    const a = assets();
    const grp = new THREE.Group();
    const body = new THREE.Mesh(a.heliBody, a.matDark); grp.add(body);
    // chin sensor nose — sunk into the fuselage front so there's no seam, and
    // dropped/narrowed a touch to read as a taper rather than a step.
    const nose = new THREE.Mesh(a.heliNose, a.matGrey);
    nose.position.set(0, -0.12, 2.55); grp.add(nose);   // geom already tapers — no compensating scale
    // tandem BUBBLE canopy in REAL transparent glass, overlapping the cabin top
    const canopy = new THREE.Mesh(a.heliCanopy, a.matGlass); canopy.position.set(0, 0.6, 0.65); grp.add(canopy);
    grp.userData.canopy = canopy;
    // TANDEM CREW visible through the clear canopy: two helmeted silhouettes
    // (pilot aft-high, gunner forward-low — classic gunship stagger)
    [[0.02, 0.14], [0.46, 1.02]].forEach(function (seat) {
      const torso = new THREE.Mesh(a.doorPanel, a.matDark);          // doorPanel is 0.06×0.72×0.95 — rescale per-axis
      torso.scale.set(7, 0.68, 0.3); torso.position.set(0, 0.42 + seat[0] * 0.4, seat[1]); grp.add(torso);
      const head = new THREE.Mesh(a.navBead, a.matGrey);
      head.scale.setScalar(1.6); head.position.set(0, 0.74 + seat[0] * 0.4, seat[1]); grp.add(head);
    });
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
    // pod MUZZLE faces — a dark launcher face + center tube stub so the fairings
    // read as rocket pods, not drop tanks (the x=±1.5 launch offset is unchanged)
    for (const px of [-1.5, 1.5]) {
      const cap = new THREE.Mesh(a.podCap, a.matDarkest); cap.rotation.x = Math.PI / 2; cap.position.set(px, -0.05, 1.02); grp.add(cap);
      const tube = new THREE.Mesh(a.podTube, a.matGrey); tube.rotation.x = Math.PI / 2; tube.position.set(px, -0.05, 1.12); grp.add(tube);
    }
    // CHIN GUN under the sensor nose — heliGun's tracers already originate just
    // below the belly; a visible depressed barrel sells the source of the fire.
    const chin = new THREE.Mesh(a.heliChin, a.matGrey); chin.position.set(0, -0.62, 2.2); grp.add(chin);
    const barrel = new THREE.Mesh(a.heliBarrel, a.matDarkest); barrel.rotation.x = Math.PI / 2 + 0.1; barrel.position.set(0, -0.72, 2.85); grp.add(barrel);
    // FLIR ball offset starboard under the nose + a searchlight gimbal housing
    // at the beam cone's root (the cosmetic cone itself is untouched below)
    const flir = new THREE.Mesh(a.heliFlir, a.matGlass); flir.position.set(0.34, -0.6, 2.6); grp.add(flir);
    const lamp = new THREE.Mesh(a.heliLamp, a.matGrey); lamp.position.set(0, -0.72, 0); grp.add(lamp);
    // CREW DOOR inset + boarding step on each flank, aft of the wing root
    for (const sx of [-1, 1]) {
      const door = new THREE.Mesh(a.doorPanel, a.matDarkest); door.position.set(sx * 0.72, -0.02, -0.35); grp.add(door);
      const step = new THREE.Mesh(a.doorStep, a.matGrey); step.position.set(sx * 0.78, -0.5, -0.3); grp.add(step);
    }
    // rotor mast hub + a translucent blur disc + a crossed pair of REAL tapered/
    // drooped blades (the blade geom is rooted at the hub extending +X, so the
    // opposite blade is wrapped in a PI-rotated group; named `rotor` group spun by AI)
    // rotor head: engine cowl + twin exhaust stubs + swashplate under the hub
    const cowl = new THREE.Mesh(a.heliCowl, a.matDark); cowl.position.set(0, 0.72, -0.95); grp.add(cowl);
    for (const sx of [-1, 1]) {
      const exh = new THREE.Mesh(a.heliExh, a.matDarkest);
      exh.rotation.x = Math.PI / 2; exh.position.set(sx * 0.3, 0.8, -1.95); grp.add(exh);
    }
    const plate = new THREE.Mesh(a.heliPlate, a.matGrey); plate.position.y = 0.88; grp.add(plate);
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
    // spotlight cone (the ground pool is scene-owned — makeHeli adds it)
    const cone = new THREE.Mesh(a.cone, a.lightMat); grp.add(cone);
    return { grp, rotor, trotor, cone };
  }

  function makeHeli() {
    const r = root(); if (!r) return null;
    const claim = claimMilitary("heli"); if (!claim) return null;
    const a = assets();
    const grp = claim.rec.group;
    const rotor = grp.userData && grp.userData.rotor;
    const trotor = grp.userData && grp.userData.tailRotor;
    if (!rotor || !trotor) {
      releaseMilitary({ sourceRec: claim.rec, pilot: claim.pilot, home: claim.home, pos: grp.position }, false);
      return null;
    }
    // World-space beam geometry avoids inheriting the authored model's 1.45x
    // scale.  The actual parked helicopter remains the moving visual.
    const cone = new THREE.Mesh(a.cone, a.lightMat); r.add(cone);
    const pool = new THREE.Mesh(a.pool, a.poolMat); pool.rotation.x = -Math.PI / 2; pool.position.y = 0.08;
    r.add(pool);
    pool.visible = false; cone.visible = false;
    grp.visible = true;
    grp.position.set(claim.home.x, claim.home.y, claim.home.z);
    grp.rotation.set(0, claim.home.heading, 0);
    return {
      group: grp, rotor, trotor, cone, pool,
      pos: grp.position, orbit: rng() * 6.28,
      missileCD: 3.5, gunCD: 1.0, leaveT: 0, spotR: 6, climb: 0,
      hp: 140, maxHp: 140, downed: false,           // armoured — ~2 rockets / a sustained burst
      spin: 0, vy: 0, yawRate: 0, smokeCD: 0,
      sourceRec: claim.rec, pilot: claim.pilot, home: claim.home,
      phase: "spool", launchT: 4.5, _worldCone: true,
    };
  }

  function despawnHeli(crashed) {
    if (!heli) return;
    const old = heli;
    if (heli.pool && heli.pool.parent) heli.pool.parent.remove(heli.pool);
    if (heli.cone && heli.cone.parent) heli.cone.parent.remove(heli.cone);
    if (!heli.sourceRec) {
      if (heli.group && heli.group.parent) heli.group.parent.remove(heli.group);
      disposeGroup(heli.group);
    }
    disposeGroup(heli.pool); disposeGroup(heli.cone);
    releaseMilitary(old, !!crashed);
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
    if (CBZ.cityFlavor) CBZ.cityFlavor("You shot down a military helicopter!", "#ff8b6b");
  }
  function dynamicAircraftCollider(c) {
    let o = c && c.ref;
    while (o) {
      if (o.userData && (o.userData.aircraftDims || o.userData.hijackable || o.userData.craft)) return true;
      o = o.parent;
    }
    return false;
  }
  function crashFacadeAt(x, y, z) {
    const cols = CBZ.colliders || [];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (dynamicAircraftCollider(c)) continue;
      if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      const y0 = c.y0 != null ? c.y0 : 0, y1 = c.y1 != null ? c.y1 : 18;
      if (y >= y0 && y <= y1 - 0.2) return c;
    }
    return null;
  }
  function wreckImpact(x, y, z, building) {
    if (CBZ.cityExplosion) CBZ.cityExplosion(x, z, { power: building ? 1.9 : 1.5, radius: building ? 9 : 7, byPlayer: false, y });
    else detonate(x, y, z);
    if (building && CBZ.cityDamageBuilding) { try { CBZ.cityDamageBuilding(x, y, z, 2.2); } catch (e) {} }
    if (CBZ.cityShatter) { try { CBZ.cityShatter(x, z, building ? 12 : 8); } catch (e) {} }
    if (CBZ.cityCrashSmoke) { try { CBZ.cityCrashSmoke(x, y, z); } catch (e) {} }
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
      wreckImpact(ix, iy, iz, surf > ground + 0.5);
      if (CBZ.shake) CBZ.shake(0.6);
      despawnHeli(true);
    }
  }
  // ray-test the police AIR — gunship AND jets — for the player's hitscan (NO
  // damage — the shoot loop applies it, so a shotgun's pellets each count).
  // dir must be normalized. Which craft the ray struck is remembered so the
  // cityAircraftDamage call that immediately follows lands on the right frame.
  let lastRayCraft = null;
  CBZ.cityAircraftRayTest = function (ox, oy, oz, dx, dy, dz, range) {
    let best = null, bestT = Infinity, bestCraft = null;
    const test = function (craft, rad) {
      if (!craft || craft.downed || !craft.pos) return;
      const cx = craft.pos.x - ox, cy = craft.pos.y - oy, cz = craft.pos.z - oz;
      const t = cx * dx + cy * dy + cz * dz;                // projection onto the ray
      if (t < 0 || t > range || t >= bestT) return;
      const ex = ox + dx * t - craft.pos.x, ey = oy + dy * t - craft.pos.y, ez = oz + dz * t - craft.pos.z;
      if (ex * ex + ey * ey + ez * ez > rad * rad) return;  // generous hitbox (far + moving)
      bestT = t; bestCraft = craft;
      best = { x: ox + dx * t, y: oy + dy * t, z: oz + dz * t, dist: t };
    };
    test(heli, craftRadius(heli, 3.6));
    for (let i = 0; i < jets.length; i++) test(jets[i], craftRadius(jets[i], 3.2));
    lastRayCraft = bestCraft;
    return best;
  };
  CBZ.cityAircraftDamage = function (dmg, fromX, fromZ) {
    // route to whatever the ray test just struck; the gunship stays the default
    // (splash callers and older paths never ray-tested first).
    const c = lastRayCraft;
    if (c && c !== heli) {
      if (jets.indexOf(c) >= 0) damageJet(c, dmg);
      return;   // the ray hit a jet (possibly gone by now) — never misroute to the heli
    }
    damageHeli(dmg, fromX, fromZ);
  };
  // explosion splash (rocket / blast near an aircraft) — damages ALL craft in radius.
  CBZ.cityAircraftSplash = function (x, y, z, radius, dmg) {
    let any = false;
    if (heli && !heli.downed && heli.pos) {
      const dx = heli.pos.x - x, dy = heli.pos.y - y, dz = heli.pos.z - z;
      if (dx * dx + dy * dy + dz * dz <= radius * radius) { damageHeli(dmg, x, z); any = true; }
    }
    for (let i = 0; i < jets.length; i++) {
      const j = jets[i];
      if (!j || j.downed || !j.pos) continue;
      const dx = j.pos.x - x, dy = j.pos.y - y, dz = j.pos.z - z;
      if (dx * dx + dy * dy + dz * dz <= radius * radius) { damageJet(j, dmg); any = true; }
    }
    return any;
  };

  // Physical aircraft-to-aircraft impacts identify the authored vehicle record
  // (the same object claimed from Fort Brandt). Route that impulse to the live
  // response craft instead of damaging a stale parked shell or a generic heli.
  CBZ.cityAircraftCollisionImpact = function (rec, dmg, point) {
    if (!rec || !(dmg > 0)) return false;
    if (heli && !heli.downed && heli.sourceRec === rec) {
      damageHeli(dmg, point && point.x, point && point.z);
      return true;
    }
    for (let i = 0; i < jets.length; i++) {
      const j = jets[i];
      if (!j || j.downed || j.sourceRec !== rec) continue;
      damageJet(j, dmg);
      return true;
    }
    return false;
  };

  // ---- JET SHOOT-DOWN: mirrors the gunship's damage→down→fall→detonate arc.
  //      Same design rationale as damageHeli: a 5★ jet you could only hide from
  //      was a wall; one you can swat out of its strafe run is a power fantasy.
  function damageJet(j, dmg) {
    if (!j || j.downed) return;
    j.hp -= dmg;
    if (CBZ.bulletImpact && j.pos) { try { CBZ.bulletImpact({ x: j.pos.x, y: j.pos.y, z: j.pos.z }, { x: 0, y: 1, z: 0 }, { kind: "spark", power: 1.2 }); } catch (e) {} }
    if (j.hp <= 0) downJet(j);
  }
  function downJet(j) {
    if (!j || j.downed) return;               // idempotent — one death per airframe
    j.downed = true;
    j.fired = true;                           // a dying jet never gets its missile off
    if (j.burn) j.burn.visible = false;       // flame out; the smoke trail takes over
    j.vy = 1.2;                               // a lurch up, then gravity owns it
    j.rollRate = (rng() < 0.5 ? -1 : 1) * (2.2 + rng() * 2.2);   // wing-loss death roll
    j.smokeCD = 0;
    if (CBZ.sfx) CBZ.sfx("explosion");
    if (CBZ.shake) CBZ.shake(0.4);
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(60);
    if (CBZ.cityFlavor) CBZ.cityFlavor("You shot down a military fighter jet!", "#ff8b6b");
  }
  // ballistic wreck ride-down (same shape as fallHeli): momentum bleeds off,
  // gravity + roll take over, smoke trails, and it detonates ON whatever it
  // hits — rooftop or street — with the same CONTAINED crash blast as the heli
  // (the block-leveling airstrike blast stays reserved for missiles).
  // Returns true once it has impacted (caller despawns).
  function fallJet(j, dt) {
    j.vy -= 17 * dt;
    j.crashSpd = Math.max(22, (j.crashSpd || JET_SPEED) - 40 * dt);
    const step = j.crashSpd * dt;
    j.pos.x += j.dir.x * step; j.pos.z += j.dir.z * step;
    j.pos.y += j.vy * dt;
    j.group.rotation.z += j.rollRate * dt;               // death roll
    j.group.rotation.x += dt * 0.55;                     // nose falls through the horizon
    j.smokeCD -= dt;
    if (j.smokeCD <= 0) {
      j.smokeCD = 0.05;
      if (CBZ.cityCrashSmoke) { try { CBZ.cityCrashSmoke(j.pos.x, j.pos.y, j.pos.z); } catch (e) {} }
    }
    // A dying fast mover hits a facade at its actual altitude. The previous
    // roof-only sample teleported every side impact to the roofline, making
    // jets appear to pass through the building before exploding on top.
    const facade = crashFacadeAt(j.pos.x, j.pos.y, j.pos.z);
    if (facade) {
      wreckImpact(j.pos.x, j.pos.y, j.pos.z, true);
      if (CBZ.shake) CBZ.shake(0.8);
      return true;
    }
    const surf = Math.max(CBZ.floorAt ? CBZ.floorAt(j.pos.x, j.pos.z) : 0, roofTopAt(j.pos.x, j.pos.z));
    if (j.pos.y <= surf + 1.2) {
      wreckImpact(j.pos.x, surf + 1.0, j.pos.z, surf > (CBZ.floorAt ? CBZ.floorAt(j.pos.x, j.pos.z) : 0) + 0.5);
      if (CBZ.shake) CBZ.shake(0.6);
      return true;
    }
    return false;
  }

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
    if (!heli) {
      if (stars < HELI_STAR || g.state !== "playing") return;
      heli = makeHeli(); if (!heli) return;
    }
    if ((stars < HELI_STAR || g.state !== "playing") && heli.phase !== "return") {
      heli.phase = "return"; heli.pool.visible = false; heli.cone.visible = false;
    }
    // Real spool at the authored helipad: the rotors gather speed for several
    // seconds before the skids ever leave the concrete.
    if (heli.phase === "spool") {
      if (stars < HELI_STAR || g.state !== "playing") { despawnHeli(false); return; }
      heli.launchT -= dt;
      const k = 1 - Math.max(0, heli.launchT) / 4.5;
      heli.rotor.rotation.y += dt * (2 + k * 40);
      heli.trotor.rotation.x += dt * (3 + k * 57);
      if (heli.launchT <= 0) heli.phase = "takeoff";
      return;
    }
    if (heli.phase === "takeoff") {
      if (stars < HELI_STAR || g.state !== "playing") { heli.phase = "return"; }
      else {
        heli.rotor.rotation.y += dt * 42; heli.trotor.rotation.x += dt * 60;
        const launchY = Math.max(22, heli.home.y + 22);
        heli.pos.y += Math.min(9 * dt, launchY - heli.pos.y);
        if (heli.pos.y >= launchY - 0.35) heli.phase = "inbound";
        return;
      }
    }
    if (heli.phase === "return") {
      const dx = heli.home.x - heli.pos.x, dz = heli.home.z - heli.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const safeY = Math.max(heli.home.y + 20, roofTopAt(heli.pos.x, heli.pos.z) + HELI_CLEAR + 2);
      if (d > 4) {
        const step = Math.min(d, HELI_SPEED * 1.8 * dt);
        heli.pos.x += dx / d * step; heli.pos.z += dz / d * step;
        heli.pos.y += (Math.max(safeY, heli.pos.y) - heli.pos.y) * Math.min(1, dt * 1.2);
      } else {
        heli.pos.x += dx * Math.min(1, dt * 2); heli.pos.z += dz * Math.min(1, dt * 2);
        heli.pos.y += (heli.home.y - heli.pos.y) * Math.min(1, dt * 0.65);
      }
      heli.group.rotation.y = turnToward(heli.group.rotation.y, Math.atan2(dx, dz), dt * 1.8);
      heli.group.rotation.z += (0 - heli.group.rotation.z) * Math.min(1, dt * 2.5);
      heli.rotor.rotation.y += dt * 42; heli.trotor.rotation.x += dt * 60;
      if (d < 0.8 && Math.abs(heli.pos.y - heli.home.y) < 0.3) despawnHeli(false);
      return;
    }
    heli.leaveT = 0;
    const aim = aimPoint();
    const cx = aim ? aim.x : heli.pos.x, cz = aim ? aim.z : heli.pos.z;
    // orbit the target — tighter/faster at higher heat
    heli.orbit += dt * (0.5 + (stars - HELI_STAR) * 0.12);
    const R = HELI_R - (stars - HELI_STAR) * 3;
    const tx = cx + Math.cos(heli.orbit) * R, tz = cz + Math.sin(heli.orbit) * R;
    // Local AGL cruise: climb for the roof under this orbit point, or for a
    // player who has genuinely climbed above the gunship.
    const P0 = player();
    const needY = P0 ? (P0.pos.y || 0) + 1.4 + FIRE_MARGIN + 6 : 0;   // stay this far over the player
    const localGround = CBZ.floorAt ? (+CBZ.floorAt(tx, tz) || 0) : 0;
    const localRoof = roofTopAt(tx, tz);
    const ty = Math.max(HELI_Y, localGround + HELI_AGL, localRoof + HELI_CLEAR, needY);
    const inbound = heli.phase === "inbound";
    const lat = inbound ? Math.min(1, dt * (HELI_SPEED * 1.7 / Math.max(Math.hypot(tx - heli.pos.x, tz - heli.pos.z), 1)))
                        : Math.min(1, dt * (HELI_SPEED / Math.max(R, 6)));
    const prevX = heli.pos.x, prevY = heli.pos.y, prevZ = heli.pos.z;
    heli.pos.x += (tx - heli.pos.x) * lat;
    heli.pos.z += (tz - heli.pos.z) * lat;
    heli.pos.y += (ty - heli.pos.y) * Math.min(1, dt * 1.2);
    // bank into the turn + face flight direction
    const head = Math.atan2(tx - heli.pos.x + 0.0001, tz - heli.pos.z + 0.0001);
    heli.group.rotation.y += (head - heli.group.rotation.y) * Math.min(1, dt * 2.5) * 0.4;
    // ---- AERO LAYER (lift/drag/ETL/ground-effect) ------------------------
    // The gunship is still TARGET-SEEKING (the orbit/engagement AI above is
    // proven and untouched), but its actual motion now reads through the
    // shared aero core instead of a free teleport-lerp: derive this frame's
    // real world velocity from the position delta, resolve it into the
    // body frame, and let ETL (mushy near-hover, solid forward flight) +
    // ground effect (a cushioning bonus low over a roof/street) perturb the
    // commanded altitude by a small, bounded amount — enough to feel like a
    // real rotor disc reacting to the air, never enough to break the chase.
    if (CBZ.aeroPhysics && dt > 0.0001 && dt < 0.2) {
      const A = CBZ.aeroPhysics;
      const wvx = (heli.pos.x - prevX) / dt, wvy = (heli.pos.y - prevY) / dt, wvz = (heli.pos.z - prevZ) / dt;
      const local = A.localVelocity(wvx, wvy, wvz, heli.group.rotation.y, 0, heli.group.rotation.z);
      const fwdSpeed = Math.max(0, local.z);
      const etl = A.etlMul(fwdSpeed, 8.2, 12.3);
      const groundY = Math.max(CBZ.floorAt ? CBZ.floorAt(heli.pos.x, heli.pos.z) : 0, roofTopAt(heli.pos.x, heli.pos.z));
      const agl = Math.max(0, heli.pos.y - groundY);
      const gMul = A.groundEffectMul(agl, 9.4);    // ~9.4m main-rotor diameter
      const aero = A.aeroForces(local, { liftScale: 0.004, etl, groundMul: gMul,
        dragCoef: { px: 0.07, nx: 0.07, py: 0.05, ny: 0.05, pz: 0.02, nz: 0.09 } });
      // a stalled/low-ETL disc sags slightly; ground effect cushions a low pass —
      // both are SMALL (≤~0.6m of correction) so the engagement geometry (canEngage,
      // roofTopAt clearance, spotlight) never sees a meaningful altitude surprise.
      heli._aeroSag = (heli._aeroSag || 0) + (((aero.stalled ? -0.5 : 0) + (gMul - 1) * 1.6 + (etl - 1) * 0.8) - (heli._aeroSag || 0)) * Math.min(1, dt * 2);
      heli.pos.y += heli._aeroSag * dt;
      heli._etl = etl; heli._aoa = aero.aoaDeg;
    }
    // NO FLY-THROUGH: never let the body sink into a building — ride over the roof.
    // (checked AFTER the aero sag so the small cushion/sag correction can never
    // itself cause a roof clip — this clamp always has the final say)
    const bodyTop = roofTopAt(heli.pos.x, heli.pos.z);
    if (bodyTop > 0 && heli.pos.y < bodyTop + HELI_CLEAR) heli.pos.y = bodyTop + HELI_CLEAR;
    heli.group.rotation.z = Math.sin(heli.orbit) * 0.14;
    heli.rotor.rotation.y += dt * 42;
    heli.trotor.rotation.x += dt * 60;
    if (inbound) {
      if (Math.hypot(heli.pos.x - tx, heli.pos.z - tz) < 38) {
        heli.phase = "orbit";
        heli.pool.position.set(cx, 0.08, cz);
        heli.pool.visible = true; heli.cone.visible = true;
      } else return;
    }
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
    if (heli._worldCone) {
      heli.cone.position.set(heli.pos.x, beam.y + len * 0.5, heli.pos.z);
      heli.cone.scale.set(1, len, 1);
    } else {
      heli.cone.position.set(0, -len / 2 - 0.4, 0);
      heli.cone.scale.set(1, len, 1);
    }

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
        // HOMING: re-acquire the player's live position every frame, but only
        // while the gunship still has a real shot (canEngage — below us + clear
        // LOS) — once you duck behind cover or climb above the heli, the seeker
        // loses lock and the missile coasts straight on its last heading, same
        // as before. This keeps it beatable: break the engagement geometry and
        // you break the lock, not just the aim.
        const seekHeli = function () {
          const SP = player();
          if (!SP) return null;
          if (!canEngage(heli.pos.x, heli.pos.y - 0.4, heli.pos.z, SP)) return null;
          return { x: SP.pos.x, y: (SP.pos.y || 0) + 1.2, z: SP.pos.z };
        };
        launchMissile(heli.pos.x + side, heli.pos.y - 0.4, heli.pos.z, t, false, seekHeli);
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
      CBZ.cityHurtPlayer(6 + rng() * 6, heli.pos.x, heli.pos.z, "raked by a gunship", rng() < 0.02, "a military gunship");
    }
  }

  // -------------------------------------------------------- FIGHTER JETS ----
  // Mesh-only builder (no scene dependency) — used by makeJet below and exposed
  // for tools/studio.mjs asset photography (CBZ.debugBuildPoliceAir).
  function buildPoliceJetGroup() {
    const a = assets();
    const grp = new THREE.Group();
    const body = new THREE.Mesh(a.jetBody, a.matJet); grp.add(body);
    // fine NEEDLE nose tip extending the fuselage taper to a sharp point (no seam —
    // the sculpted body already pinches in; this just caps it to a radar boom).
    // rotation.x = +PI/2 maps the cone's +Y apex to +Z — apex FORWARD (the old
    // -PI/2 flew base-first, a flat disc leading the aircraft).
    const nose = new THREE.Mesh(a.jetNose, a.matJet); nose.rotation.x = Math.PI / 2; nose.position.z = 4.45; grp.add(nose);
    // REAL transparent bubble canopy with a helmeted pilot silhouette inside
    const canopy = new THREE.Mesh(a.jetCanopy, a.matGlass); canopy.position.set(0, 0.58, 1.7); grp.add(canopy);
    grp.userData.canopy = canopy;
    const jpTorso = new THREE.Mesh(a.doorPanel, a.matGrey);          // doorPanel is 0.06×0.72×0.95 — rescale per-axis
    jpTorso.scale.set(6, 0.58, 0.27); jpTorso.position.set(0, 0.44, 1.5); grp.add(jpTorso);
    const jpHead = new THREE.Mesh(a.navBead, a.matGrey);
    jpHead.scale.setScalar(1.5); jpHead.position.set(0, 0.7, 1.5); grp.add(jpHead);
    // LERX CHINES — thin strakes blending the wing roots up the forward
    // fuselage; slanted inward so their tips ride the narrowing nose taper
    const chL = new THREE.Mesh(a.jetChine, a.matJet); chL.position.set(-0.45, 0.1, 1.9); chL.rotation.y = 0.13; grp.add(chL);
    const chR = new THREE.Mesh(a.jetChine, a.matJet); chR.position.set(0.45, 0.1, 1.9); chR.rotation.y = -0.13; grp.add(chR);
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
    // WINGTIP RAILS + AAMs — the 5★ bird visibly carries its ordnance (rail runs
    // under the tip edge, which sits near x≈±3.5 for z in −1.5..−0.4)
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(a.tipRail, a.matGrey); rail.position.set(sx * 3.5, -0.2, -0.95); grp.add(rail);
      const msl = new THREE.Mesh(a.tipMsl, a.matGrey); msl.rotation.x = Math.PI / 2; msl.position.set(sx * 3.5, -0.32, -0.95); grp.add(msl);
      const tip = new THREE.Mesh(a.tipCone, a.matDarkest); tip.rotation.x = Math.PI / 2; tip.position.set(sx * 3.5, -0.32, -0.14); grp.add(tip);
    }
    // tailplanes
    const stabL = new THREE.Mesh(a.jetStab, a.matJet); stabL.position.set(-0.85, 0, -3.3); stabL.rotation.y = 0.2; grp.add(stabL);
    const stabR = new THREE.Mesh(a.jetStab, a.matJet); stabR.position.set(0.85, 0, -3.3); stabR.rotation.y = -0.2; grp.add(stabR);
    // canted twin vertical tails, roots overlapping the rear fuselage top
    const tailL = new THREE.Mesh(a.jetTail, a.matJet); tailL.position.set(-0.42, 0.78, -3.0); tailL.rotation.z = 0.22; grp.add(tailL);
    const tailR = new THREE.Mesh(a.jetTail, a.matJet); tailR.position.set(0.42, 0.78, -3.0); tailR.rotation.z = -0.22; grp.add(tailR);
    // twin AFTERBURNER CANS with dark throats — the glow now sits behind real
    // nozzles instead of floating off a bare box tail
    for (const sx of [-1, 1]) {
      const can = new THREE.Mesh(a.jetCan, a.matGrey); can.rotation.x = Math.PI / 2; can.position.set(sx * 0.24, -0.05, -4.15); grp.add(can);
      const thr = new THREE.Mesh(a.jetCanIn, a.matDarkest); thr.rotation.x = Math.PI / 2; thr.position.set(sx * 0.24, -0.05, -4.55); grp.add(thr);
    }
    const burn = new THREE.Mesh(a.smoke, a.flameMat); burn.scale.set(0.7, 0.7, 1.4); burn.position.set(0, -0.05, -4.75); grp.add(burn);
    grp._burn = burn;
    // NAV LIGHTS: port wingtip red, stbd wingtip green, white tailfin beacon
    const nL = (m, x, y, z) => { const b = new THREE.Mesh(a.navBead, m); b.position.set(x, y, z); grp.add(b); };
    nL(a.navR, -2.5, -0.05, -1.5); nL(a.navG, 2.5, -0.05, -1.5); nL(a.navW, 0, 1.2, -3.4);
    return { grp, burn };
  }

  function makeJet() {
    const r = root(); if (!r) return null;
    const claim = claimMilitary("plane"); if (!claim) return null;
    const grp = claim.rec.group;
    const plumes = (grp.userData && grp.userData.plume) || [];
    const burn = plumes[0] || null;
    grp.visible = true;
    grp.position.set(claim.home.x, claim.home.y, claim.home.z);
    grp.rotation.set(0, claim.home.heading, 0);
    if (burn) { burn.visible = true; if (burn.material) burn.material.opacity = 0; }
    // Destination is live, but departure always starts from the authored runway.
    const aim = aimPoint();
    const arena = CBZ.city && CBZ.city.arena;
    const cx = aim ? aim.x : (arena && arena.center ? arena.center.x : 0);
    const cz = aim ? aim.z : (arena && arena.center ? arena.center.z : 0);
    const dir = new THREE.Vector3(Math.sin(claim.home.heading), 0, Math.cos(claim.home.heading));
    return {
      group: grp, burn, dir, pos: grp.position, life: 0, fired: false, target: { x: cx, z: cz },
      // shoot-down state — mirrors the gunship's (hp / downed / falling wreck).
      // Lighter than the heli: one rocket splash (90) or a sustained rifle rake
      // drops it, which is fair for a target you only have a ~6s window on.
      hp: 70, maxHp: 70, downed: false, vy: 0, rollRate: 0, smokeCD: 0, crashSpd: JET_SPEED,
      sourceRec: claim.rec, pilot: claim.pilot, home: claim.home,
      phase: "spool", launchT: 3.2, heading: claim.home.heading,
      speed: 0, phaseT: 0,
    };
  }

  function despawnJet(j, crashed) {
    if (!j) return;
    if (!j.sourceRec) {
      if (j.group && j.group.parent) j.group.parent.remove(j.group);
      disposeGroup(j.group);
    }
    releaseMilitary(j, !!crashed);
  }

  function updateJets(dt, r) {
    const stars = g.wanted | 0;
    function plume(j, power) {
      if (!j.burn) return;
      if (CBZ.setRocketPlume && j.burn.userData && j.burn.userData.rocketPlume) {
        CBZ.setRocketPlume(j.burn, power, j.life, 1.2, 1.05);
        return;
      }
      j.burn.visible = power > 0.01;
      if (j.burn.material) j.burn.material.opacity = Math.max(0, Math.min(0.95, power));
      j.burn.scale.z = 0.75 + power * 1.8 + Math.sin(j.life * 34) * 0.16;
    }
    function setHeading(j, want, rate) {
      j.heading = turnToward(j.heading, want, rate * dt);
      j.dir.set(Math.sin(j.heading), 0, Math.cos(j.heading));
      j.group.rotation.y = j.heading;
    }
    function fly(j, speed) {
      const step = speed * dt;
      j.pos.x += j.dir.x * step; j.pos.z += j.dir.z * step;
    }
    function seekPoint(j, tx, tz, rate) {
      setHeading(j, Math.atan2(tx - j.pos.x, tz - j.pos.z), rate);
    }
    function fireJet(j) {
      if (j.fired) return;
      j.fired = true;
      const t = aimPoint(); if (!t) return;
      const seekJet = function () {
        const SP = player(); if (!SP) return null;
        const py = (SP.pos.y || 0) + 1.2;
        if (CBZ.clearLineOfFire && !CBZ.clearLineOfFire(j.pos.x, j.pos.y - 0.5, j.pos.z, SP.pos.x, py, SP.pos.z)) return null;
        return { x: SP.pos.x, y: py, z: SP.pos.z };
      };
      // Launch from the authored fighter's visible nose/rail area, not a remote
      // invisible origin.  The projectile supplies its own flame and smoke.
      launchMissile(j.pos.x + j.dir.x * 5.8, j.pos.y - 0.35, j.pos.z + j.dir.z * 5.8, t, false, seekJet);
      if (CBZ.sfx && CBZ.player) {
        const d = Math.hypot(j.pos.x - CBZ.player.pos.x, j.pos.z - CBZ.player.pos.z);
        CBZ.sfx("rumble", { dist: d, ghost: true });
      }
    }

    for (let i = jets.length - 1; i >= 0; i--) {
      const j = jets[i];
      j.life += dt;
      // a shot-down jet is a ballistic wreck: it rides down trailing smoke and
      // detonates on whatever it hits (mirrors the gunship's fallHeli arc). It
      // is exempt from the live-jet reaping below so the crash always lands —
      // the life>25 clamp is only a can't-happen safety net.
      if (j.downed) {
        if (fallJet(j, dt) || j.life > 45) { despawnJet(j, true); jets.splice(i, 1); }
        continue;
      }
      if ((stars < JET_STAR || g.state !== "playing") && j.phase !== "return" && j.phase !== "landing" && j.phase !== "taxiHome") {
        if (j.phase === "spool") { despawnJet(j, false); jets.splice(i, 1); continue; }
        j.phase = "return"; j.phaseT = 0;
      }

      j.phaseT = (j.phaseT || 0) + dt;
      if (j.phase === "spool") {
        j.launchT -= dt;
        plume(j, 0.15 + (1 - Math.max(0, j.launchT) / 3.2) * 0.55);
        if (j.launchT <= 0) { j.phase = "taxi"; j.phaseT = 0; }
        continue;
      }
      if (j.phase === "taxi") {
        // Turn toward +Z, taxi the same parked fighter onto the runway, then
        // line up eastbound.  Landing gear stays at y=0 through both phases.
        setHeading(j, 0, 0.75); j.speed += (8 - j.speed) * Math.min(1, dt * 1.8);
        if (Math.abs(angleDelta(j.heading, 0)) < 0.22) fly(j, j.speed);
        plume(j, 0.5);
        if (j.pos.z >= j.home.z + 20 || j.phaseT > 8) { j.phase = "lineup"; j.phaseT = 0; }
        continue;
      }
      if (j.phase === "lineup") {
        setHeading(j, Math.PI / 2, 0.7); j.speed += (7 - j.speed) * Math.min(1, dt * 2);
        if (Math.abs(angleDelta(j.heading, Math.PI / 2)) < 0.12) { j.phase = "takeoff"; j.phaseT = 0; j._rollX = j.pos.x; }
        plume(j, 0.62);
        continue;
      }
      if (j.phase === "takeoff") {
        setHeading(j, Math.PI / 2, 0.35);
        j.speed = Math.min(78, j.speed + 22 * dt); fly(j, j.speed);
        if (j.speed > 42) j.pos.y += Math.min(8.5 * dt, 18 - j.pos.y);
        j.group.rotation.x += ((j.speed > 42 ? -0.12 : 0) - j.group.rotation.x) * Math.min(1, dt * 2.5);
        plume(j, 0.92);
        if (j.pos.y > 14 || j.pos.x - (j._rollX || j.pos.x) > 125) { j.phase = "inbound"; j.phaseT = 0; }
        continue;
      }

      const liveAim = aimPoint();
      if (liveAim) { j.target.x = liveAim.x; j.target.z = liveAim.z; }
      if (j.phase === "inbound" || j.phase === "attack") {
        const d = Math.hypot(j.target.x - j.pos.x, j.target.z - j.pos.z);
        seekPoint(j, j.target.x, j.target.z, j.phase === "attack" ? 0.48 : 0.62);
        j.speed += (JET_SPEED - j.speed) * Math.min(1, dt * 0.9); fly(j, j.speed);
        const safe = Math.max(JET_Y, roofTopAt(j.pos.x, j.pos.z) + 10,
          liveAim ? (liveAim.y || 0) + 18 : 0);
        j.pos.y += (safe - j.pos.y) * Math.min(1, dt * 0.8);
        j.group.rotation.x += (0 - j.group.rotation.x) * Math.min(1, dt * 2);
        j.group.rotation.z = Math.max(-0.42, Math.min(0.42, angleDelta(j.group.rotation.y, Math.atan2(j.target.x - j.pos.x, j.target.z - j.pos.z)) * -0.8));
        plume(j, 0.95);
        if (j.phase === "inbound" && d < 105) { j.phase = "attack"; j.phaseT = 0; }
        if (j.phase === "attack" && d < 68) fireJet(j);
        if (j.phase === "attack" && ((j.fired && j.phaseT > 2.6) || j.phaseT > 9)) { j.phase = "egress"; j.phaseT = 0; }
      } else if (j.phase === "egress") {
        j.speed += (JET_SPEED - j.speed) * Math.min(1, dt); fly(j, j.speed);
        j.pos.y += (JET_Y + 12 - j.pos.y) * Math.min(1, dt * 0.7);
        j.group.rotation.z *= Math.pow(0.05, dt); plume(j, 0.92);
        if (j.phaseT > 3.5) { j.phase = "return"; j.phaseT = 0; }
      } else if (j.phase === "return") {
        const ax = j.home.x - 95, az = j.home.z + 22;
        const d = Math.hypot(ax - j.pos.x, az - j.pos.z);
        seekPoint(j, ax, az, 0.72);
        j.speed += (82 - j.speed) * Math.min(1, dt * 0.8); fly(j, j.speed);
        const safe = Math.max(36, roofTopAt(j.pos.x, j.pos.z) + 10);
        j.pos.y += (safe - j.pos.y) * Math.min(1, dt * 0.65); plume(j, 0.72);
        if (d < 80) { j.phase = "landing"; j.phaseT = 0; }
      } else if (j.phase === "landing") {
        const runwayZ = j.home.z + 22;
        const tx = j.home.x + 8, tz = runwayZ;
        seekPoint(j, tx, tz, 0.58);
        const d = Math.hypot(tx - j.pos.x, tz - j.pos.z);
        const targetSpeed = Math.max(16, Math.min(48, d * 0.55));
        j.speed += (targetSpeed - j.speed) * Math.min(1, dt * 1.2); fly(j, j.speed);
        const wantY = Math.max(0, Math.min(14, d * 0.11));
        j.pos.y += (wantY - j.pos.y) * Math.min(1, dt * 0.9);
        j.group.rotation.x += ((j.pos.y > 1 ? 0.08 : 0) - j.group.rotation.x) * Math.min(1, dt * 2);
        plume(j, 0.42);
        if (d < 8 && j.pos.y < 1.3) { j.pos.y = 0; j.phase = "taxiHome"; j.phaseT = 0; j.speed = 7; }
      } else if (j.phase === "taxiHome") {
        const d = Math.hypot(j.home.x - j.pos.x, j.home.z - j.pos.z);
        seekPoint(j, j.home.x, j.home.z, 0.7);
        j.speed += (Math.min(7, d * 0.8) - j.speed) * Math.min(1, dt * 2); fly(j, Math.max(0, j.speed));
        j.pos.y = 0; j.group.rotation.x *= Math.pow(0.03, dt); plume(j, 0.25);
        if (d < 0.8) { despawnJet(j, false); jets.splice(i, 1); continue; }
      }

      // The aero layer still supplies ground-effect/AoA telemetry while the
      // route state machine supplies the actual authored departure/return path.
      if (CBZ.aeroPhysics && j.pos.y > 0.5) {
        const A = CBZ.aeroPhysics;
        const groundY = Math.max(CBZ.floorAt ? CBZ.floorAt(j.pos.x, j.pos.z) : 0, roofTopAt(j.pos.x, j.pos.z));
        const gMul = A.groundEffectMul(Math.max(0, j.pos.y - groundY), 10.8);
        const aero = A.aeroForces({ x: 0, y: 0, z: Math.max(1, j.speed) }, { liftScale: 0.0009, groundMul: gMul });
        j.pos.y += (gMul - 1) * 1.4 * dt; j._aoa = aero.aoaDeg;
      }
    }
  }

  // ---- studio hook: pure mesh builders for tools/studio.mjs expr shots ----
  CBZ.debugBuildPoliceAir = {
    gunship: function () { return buildGunshipGroup().grp; },
    jet: function () { return buildPoliceJetGroup().grp; },
  };

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
  function recall() {
    if (heli && !heli.downed) { heli.phase = "return"; heli.pool.visible = false; heli.cone.visible = false; }
    for (let i = 0; i < jets.length; i++) if (jets[i] && !jets[i].downed) {
      if (jets[i].phase === "spool") {
        // Still on its parking spot: shut it down immediately; nothing moved.
        despawnJet(jets[i], false); jets.splice(i--, 1);
      } else { jets[i].phase = "return"; jets[i].phaseT = 0; }
    }
    for (let i = missiles.length - 1; i >= 0; i--) freeMissile(missiles[i]);
    missiles.length = 0; jetCD = 5;
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
      // Wanted reset recalls surviving crews; it does not erase them mid-flight.
      if (CBZ.cityWantedReset && !CBZ.cityWantedReset._airWrapped) {
        const orig = CBZ.cityWantedReset;
        CBZ.cityWantedReset = function () { const out = orig.apply(this, arguments); recall(); return out; };
        CBZ.cityWantedReset._airWrapped = true;
      }
    }
    const stars = g.wanted | 0;
    const playing = g.state === "playing";

    updateHeli(dt, r);

    // JETS: request another real base airframe every few seconds at 5 stars.
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

  // Read-only runtime evidence for the gameplay QA harness and minimap/debug
  // tooling.  It exposes identity + phase, never mutable craft internals.
  CBZ.cityMilitaryAirResponse = function () {
    return {
      helicopter: heli ? {
        phase: heli.phase, pilot: heli.pilot && heli.pilot.name,
        source: heli.sourceRec && vehLabel(heli.sourceRec),
        x: heli.pos.x, y: heli.pos.y, z: heli.pos.z,
      } : null,
      jets: jets.map(function (j) { return {
        phase: j.phase, pilot: j.pilot && j.pilot.name,
        source: j.sourceRec && vehLabel(j.sourceRec),
        x: j.pos.x, y: j.pos.y, z: j.pos.z,
      }; }),
    };
  };

  function vehLabel(rec) {
    return rec && rec.model && rec.model.name || rec && rec.kind || "aircraft";
  }
})();

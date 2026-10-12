/* ============================================================
   systems/gunfx.js — THE ROUND YOU SEE. Every game, every gun.

   One system draws what a gunshot looks like, from the muzzle to whatever
   stops the round: Gang City (NPCs, cops, gunships, the player's own
   rounds through fpsmode.js), NPC War (src/battle/fire.js flies its own
   ballistics and draws through here), the prison and Warlord. Missiles,
   rockets and shells in flight are weapons/munitions.js (their bodies,
   motor flares and smoke), which every launcher shares the same way.

     CBZ.tracer(from, to, opts)  — a FLOWN round: it leaves at its cartridge's
                                   speed, is drawn as a tracer or a faint ball
                                   streak, and on arrival stops in its target
                                   or flies on to the wall/ground behind it
                                   (see THE ROUND below). Returns its record.
     CBZ.roundStreak(...)        — the one look of a round in flight (tracer /
                                   ball), for callers that fly their own.
     CBZ.muzzleFlash(pos, opts)  — a hot core + (opts.dir) a plume of burning
                                   gas thrown down the bore, sized by the gun.
     CBZ.ejectBrass(pos, r, o)   — the spent case: instanced, it lands and stays.
     CBZ.tracerStreak(...)       — the raw instanced streak those draw with.

   SUPPRESSION (combat-realism pass): being shot AT and missed should still
   cost you something, or "incoming fire" is purely cosmetic. tracer()
   already computes `inc` (0..1, how close a round's closest approach came to
   a target) for the player's own camera — that EXACT near-miss test is now
   reused, generically, against any target passed as opts.targetActor (an
   NPC defender, a guard, anyone with a {x,y,z}-ish .pos), so a shot that
   buzzes a ped's head rattles THEM too, not just the player. A connecting
   `inc` above SUPPRESS_THRESH stacks a decaying "rattled" meter on the
   target (an internal WeakMap keyed by the target object itself — CBZ.player
   included, so no actor needs a reserved field) that callers read via
   CBZ.suppressionLevel(actor)
   (0 = composed, 1 = freshly buzzed) and CBZ.suppressionAccuracyMul(actor)
   (a ready-to-multiply 1..~1.6 spread/sway penalty). Pure data — gunfx.js
   never touches anyone's aim itself; fpsmode.js (player) folds the mul into
   its spread cone, and any NPC shooter can do the same with zero coupling
   back to this file. Decays linearly over SUPPRESS_DECAY seconds back to 0.
     CBZ.bulletImpact(pos,n,o)   — impact burst; o.power scales it by
                                   CALIBER. o.material (+ o.object,
                                   o.color) = the SURFACE that was hit:
                                   it throws chips + dust of THAT
                                   material through CBZ.debris (sparks
                                   only off metal). o.kind "chip" +
                                   o.color = paint flecks off a car.
     CBZ.bulletHole(pos, n, o)   — PERSISTENT pocked decal (pooled;
                                   cap + draw distance ride the LIVE
                                   quality tier, oldest recycled).
                                   o.parent mounts it on a car body
                                   so the hole RIDES the car.
                                   o.mm = the round's BORE in millimetres
                                   (the honest input); o.size is the
                                   legacy metres-wide dial, rescaled onto
                                   the same law by WOUND_DECAL_V2.

   WHY the holes: the evidence a firefight leaves is half its drama —
   a wall you magdumped must STAY pocked, and a 7.62 hole must read
   bigger than a 9mm (o.mm / o.size carries the caliber). What it must
   NOT do is read bigger than the thing it hit: see boreMm()/SPREAD for the
   25-46 cm craters this used to stamp for a pistol round.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.scene) return;
  const THREE = window.THREE;
  const scene = CBZ.scene;

  // DETERMINISM (owner rule): this file used raw Math.random() for every
  // sprite/particle jitter — harmless-looking cosmetic VFX, but the project
  // rule is no Math.random() ANYWHERE, full stop, so a file already open for
  // the combat-realism pass gets fixed here too. Seeded LCG, same formula as
  // every other file in the codebase.
  let _s = 50321;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  // ---- SUPPRESSION STATE (c) -------------------------------------------------
  // A WeakMap keyed by the target object itself (CBZ.player, a ped/cop actor —
  // anything with a .pos) so nobody needs a reserved field on actors they
  // don't own. Value: { t: secondsRemainingAtFullStrength-ish counter, peak }.
  // We store a simple decaying TIMER (not a 0..1 level) so re-triggering while
  // already suppressed EXTENDS the clock instead of needing max() bookkeeping
  // at every read site; level is derived from the timer at read time.
  const SUPPRESS_THRESH = 0.22;   // near-miss `inc` below this is "not close enough to flinch"
  const SUPPRESS_DECAY = 3.2;     // seconds for a fresh max-strength flinch to fully decay
  const SUPPRESS_MAX_MUL = 1.65;  // worst-case spread/sway multiplier at peak suppression
  const suppression = new WeakMap();

  // tick every live suppression timer down. Lazily walks a side-list of
  // recently-touched targets (a WeakMap can't be iterated) so this stays
  // cheap regardless of how many actors exist in the city.
  const suppressedRecent = [];
  // mark `target` as freshly shot-at-and-missed, strength 0..1 (how close the
  // round's closest approach came). Re-triggering refreshes/extends the timer
  // rather than just overwriting it, so a hail of near-misses keeps someone
  // rattled instead of each shot resetting to the same single-shot decay.
  function noteSuppressed(target, strength) {
    if (!target || strength <= 0) return;
    const cur = suppression.get(target);
    const add = strength * SUPPRESS_DECAY;
    const t = cur ? Math.min(SUPPRESS_DECAY * 1.6, cur.t + add * 0.6) : add;
    suppression.set(target, { t, peak: cur ? Math.max(cur.peak, strength) : strength });
    if (suppressedRecent.indexOf(target) < 0) suppressedRecent.push(target);
  }
  // 0 (composed) .. 1 (freshly buzzed) — callers that want a raw "how rattled"
  // read (HUD shake, AI morale, etc.) rather than the ready-to-use multiplier.
  CBZ.suppressionLevel = function (target) {
    const s = target && suppression.get(target);
    if (!s || s.t <= 0) return 0;
    return Math.max(0, Math.min(1, s.t / SUPPRESS_DECAY));
  };
  // ready-to-multiply accuracy/aim-sway penalty: 1 = unaffected, up to
  // SUPPRESS_MAX_MUL at peak. Quadratic ease so a faint near-miss barely
  // registers but a close shave genuinely throws the aim off.
  CBZ.suppressionAccuracyMul = function (target) {
    const lvl = CBZ.suppressionLevel(target);
    if (lvl <= 0) return 1;
    return 1 + (SUPPRESS_MAX_MUL - 1) * lvl * lvl;
  };
  CBZ.onAlways(53, function (dt) {
    for (let i = suppressedRecent.length - 1; i >= 0; i--) {
      const tgt = suppressedRecent[i];
      const s = suppression.get(tgt);
      if (!s) { suppressedRecent.splice(i, 1); continue; }
      s.t -= dt;
      if (s.t <= 0) { suppression.delete(tgt); suppressedRecent.splice(i, 1); }
    }
  });

  // Generic near-miss closest-approach test, factored out of the player-only
  // check tracer() used to do inline (SAME math, now reusable for any actor
  // with a .pos). Returns 0..1 (0 = not close / not heading at them, 1 =
  // dead-on) for a shot segment from→to versus a point at (px,py,pz).
  function closestApproachInc(from, to, px, py, pz) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len2 = dx * dx + dy * dy + dz * dz;
    const ox = px - from.x, oy = py - from.y, oz = pz - from.z;
    if (len2 <= 16 || ox * ox + oy * oy + oz * oz <= 16) return 0;
    let t = (ox * dx + oy * dy + oz * dz) / len2;
    if (t <= 0.45) return 0;          // travelling toward the target's half of the line
    if (t > 1) t = 1;
    const mx = from.x + dx * t - px, my = from.y + dy * t - py, mz = from.z + dz * t - pz;
    const miss = Math.sqrt(mx * mx + my * my + mz * mz);
    return miss < 3.4 ? 1 - miss / 3.4 : 0;
  }

  // ---- pooled muzzle-flash sprites (the hot core: a soft additive glow) ----
  let flashTex = null;
  function makeFlashTex() {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,244,200,1)");
    g.addColorStop(0.4, "rgba(255,184,80,0.7)");
    g.addColorStop(1, "rgba(255,120,30,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  const flashPool = [];
  const liveFlashes = [];
  function takeFlash() {
    let s = flashPool.pop();
    if (!s) {
      if (!flashTex) flashTex = makeFlashTex();
      s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flashTex, transparent: true, depthTest: false, depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      s.renderOrder = 9;
      scene.add(s);
    }
    return s;
  }

  /* ---- THE FLASH HAS A SHAPE. A muzzle flash is not a ball: it is a hot
     core at the crown and a plume of burning gas thrown FORWARD down the
     line of fire, longer and fatter the more powder the cartridge burns (a
     9 mm spits a hand's length, a rifle a forearm, a .50 or a tank gun
     metres). The plume is a spindle along the bore, one InstancedMesh for
     every gun in the game, faded by instance colour; the core stays the
     camera-facing sprite. opts.dir is the bore (a unit vector); without it
     the flash is the core alone. ---- */
  const PL_CAP = 64;
  let plMesh = null, plHead = 0;
  const plLife = new Float32Array(PL_CAP), plMax = new Float32Array(PL_CAP);
  function ensurePlume() {
    if (plMesh) return plMesh;
    const prof = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      // fat just past the crown, tapering to a point downrange
      const r = Math.sin(Math.PI * Math.pow(t, 0.55)) * (1 - t * 0.35);
      prof.push(new THREE.Vector2(Math.max(0.001, r), t));
    }
    const geo = new THREE.LatheGeometry(prof, 7);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    plMesh = new THREE.InstancedMesh(geo, mat, PL_CAP);
    plMesh.name = "gunfx-flash-plumes"; plMesh.userData.fx = true;
    plMesh.frustumCulled = false; plMesh.renderOrder = 9;
    for (let i = 0; i < PL_CAP; i++) { plMesh.setMatrixAt(i, ZERO_M); plMesh.setColorAt(i, _plC.setRGB(0, 0, 0)); }
    plMesh.instanceMatrix.needsUpdate = true;
    if (plMesh.instanceColor) plMesh.instanceColor.needsUpdate = true;
    scene.add(plMesh);
    return plMesh;
  }
  const _plC = new THREE.Color(), _plQ = new THREE.Quaternion(), _plS = new THREE.Vector3(), _plP = new THREE.Vector3(), _plD = new THREE.Vector3(), _plM = new THREE.Matrix4();

  CBZ.muzzleFlash = function (pos, opts) {
    opts = opts || {};
    const s = takeFlash();
    s.position.set(pos.x, pos.y, pos.z);
    const base = opts.scale || 1;
    const dir = opts.dir;
    // with a plume the core is the crown only: a third of the old ball
    const sc = base * (dir ? 0.45 : 1) * (0.7 + rng() * 0.5);
    s.scale.set(sc, sc, sc);
    // pooled sprites keep their last tint/peak — reset both every take
    s.material.color.setHex(opts.color != null ? opts.color : 0xffffff);
    const peak = opts.peak != null ? opts.peak : 1;
    s.material.opacity = peak;
    s.visible = true;
    const life = opts.life || 0.06;
    liveFlashes.push({ spr: s, life: life, max: life, peak: peak });
    if (dir) {
      const M = ensurePlume();
      _plD.set(dir.x, dir.y, dir.z);
      if (_plD.lengthSq() > 1e-6) {
        _plD.normalize();
        const i = plHead; plHead = (plHead + 1) % PL_CAP;
        const len = base * (0.55 + rng() * 0.35), r = base * (0.09 + rng() * 0.05);
        _plQ.setFromUnitVectors(UP, _plD);
        _plS.set(r, len, r);
        _plP.set(pos.x, pos.y, pos.z);
        _plM.compose(_plP, _plQ, _plS);
        M.setMatrixAt(i, _plM);
        M.setColorAt(i, _plC.setHex(0xffc870));
        plLife[i] = plMax[i] = life * 0.9;
        M.instanceMatrix.needsUpdate = true;
        if (M.instanceColor) M.instanceColor.needsUpdate = true;
      }
    }
    return s;
  };

  /* ============================================================ THE ROUND
     CBZ.tracer(from, to, opts) — EVERY SHOT THE GAME DRAWS FOR A GUN THAT
     IS NOT THE PLAYER'S OWN (and the player's own hitscan pistols, SMGs and
     shotguns, through fpsmode.js).

     WHAT WAS SLOP. A shot was a 1-pixel line from the muzzle to the target,
     drawn whole in the frame the trigger broke and faded 70 ms later: a
     laser, not a bullet. A round coming AT you foreshortened to a dot, so a
     fat additive "bolt" and a flash three times too big were bolted on to
     make incoming fire legible. A round that missed you simply ended in the
     air beside you: no dust, no crack, no hole in the wall behind you.

     WHAT IT IS NOW. The round FLIES: it leaves the muzzle at its cartridge's
     velocity (weapons/ballistics.js CART, by the shooter's weapon) and
     covers the distance in the time it takes. What the eye keeps of it is
     what a real one leaves:
       - a BALL round (every pistol, every civilian rifle) is a faint warm
         streak, a few metres of motion blur, visible only near the lens;
       - a TRACER (every Nth round of a belt: GUN.tracer, the last rounds of
         a rifle magazine: GUN.tracerLast, or opts.tracer) is a burning red
         or green line that reads at 400 m, coloured by the cartridge.
     Where it ends depends on what it did (opts.hit, decided by the caller's
     own roll BEFORE it draws):
       hit true    it stops in the target. If the target is YOU in a car or
                   an aircraft it strikes the machine: sparks off the body, a
                   hole that rides the panel, a spider web in the glass.
       hit false   it goes past and flies on until the world stops it (the
                   LOS grid, the ground): dust off the dirt, chips off the
                   wall, a hole that stays. One passing within a couple of
                   metres of your head CRACKS (supersonic) or WHIZZES.
       undefined   it ends at `to` (callers that resolve their own impact).
     opts: weapon (a GUN key or an NPC weapon name), mm, v (m/s), tracer,
     belt (every Nth), color, hit, shooter, targetActor, muzzle (false: no
     flash), muzzleScale, brass (false: no case), byPlayer.
     ======================================================================== */
  const RD_CAP = 160;
  const RD = [];
  for (let i = 0; i < RD_CAP; i++) {
    RD.push({ on: false, ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0, len: 0, s: 0, v: 0, end: 0,
      tracer: false, col: 0, mm: 9, hit: undefined, phase: 0, snap: false, mine: false, tgtP: false,
      bx: 0, by: 0, bz: 0, nx: 0, ny: 0, nz: 0, obj: null, ground: false });
  }
  let rdHead = 0;
  const belts = new WeakMap();
  let beltAnon = 0;
  // a city NPC's weapon name → the gun row in weapons/ballistics.js
  function gunKeyOf(w) {
    if (!w) return null;
    const B = CBZ.ballistics, G = B && B.GUN;
    if (G && G[w]) return w;
    const k = String(w).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (G && G[k]) return k;
    if (/ak|kalash|762/.test(k)) return "ak47";
    if (/m4|ar15|rifle|carbine|m16|556|scar/.test(k)) return "carbine";
    if (/lmg|m249|saw|pkm|minigun|m134|door/.test(k)) return /m134|door|minigun/.test(k) ? "m134_door" : "lmg";
    if (/50|m2|browning/.test(k)) return "m2_50cal";
    if (/sniper|m24|dragunov|marksman/.test(k)) return "sniper";
    if (/shot|12g|pump/.test(k)) return "shotgun";
    if (/uzi|mac/.test(k)) return "uzi";
    if (/smg|mp5|mp7|ump|vector/.test(k)) return "smg";
    if (/deagle|eagle/.test(k)) return "deagle";
    if (/revolver|357|magnum/.test(k)) return "revolver";
    if (/taser/.test(k)) return "taser";
    return "sidearm";
  }
  const _spec = { mm: 9, v: 360, tcol: 0, belt: 0, last: 0, pellets: 0 };
  function roundSpec(opts) {
    const B = CBZ.ballistics;
    _spec.mm = 9; _spec.v = 360; _spec.tcol = 0; _spec.belt = 0; _spec.last = 0; _spec.pellets = 0;
    const gk = gunKeyOf(opts.weapon || (opts.shooter && opts.shooter.weapon));
    const g = gk && B && B.GUN ? B.GUN[gk] : null;
    const c = g && g.cart && B.CART ? B.CART[g.cart] : null;
    if (c) { _spec.mm = c.mm; _spec.v = c.v0; _spec.tcol = c.tracer || 0; _spec.pellets = c.pellets || 0; }
    if (g) { _spec.belt = g.tracer || 0; _spec.last = g.tracerLast || 0; }
    if (opts.mm > 0) _spec.mm = opts.mm;
    if (opts.v > 0) _spec.v = opts.v;
    if (opts.belt > 0) _spec.belt = opts.belt;
    return _spec;
  }
  // is THIS round of the shooter's a tracer? (belts: one in N; rifles: the
  // last few of a 30-round magazine, counted on the shooter's own trigger)
  function isTracer(opts, sp) {
    if (opts.tracer != null) return !!opts.tracer;
    const who = opts.shooter && typeof opts.shooter === "object" ? opts.shooter : null;
    let n;
    if (who) { n = (belts.get(who) || 0) + 1; belts.set(who, n); } else n = ++beltAnon;
    if (sp.belt > 0) return n % sp.belt === 0;
    if (sp.last > 0) return (n % 30) >= 30 - sp.last;
    return false;
  }

  CBZ.tracer = function (from, to, opts) {
    opts = opts || {};
    if (!from || !to) return null;
    // ---- is this round travelling AT the player? Closest approach of the
    // shot segment to the player's chest line (inc 0..1). It drives the
    // SUPPRESSION below, and a muzzle flash seen from the front is the
    // brightest one there is (a flash is thrown down the bore).
    let inc = 0;
    const P = CBZ.player;
    const mine = opts.byPlayer === true || (P && opts.shooter === P);
    if (P && P.pos && !mine) inc = closestApproachInc(from, to, P.pos.x, P.pos.y + 1.45, P.pos.z);
    // SUPPRESSION (c): a round that buzzed the PLAYER rattles their own aim
    // for a few seconds (fpsmode.js reads CBZ.suppressionAccuracyMul(CBZ.player)).
    if (inc >= SUPPRESS_THRESH && P && !mine) noteSuppressed(P, inc);
    // GENERIC near-miss for any other target (NPC defenders, guards, cops…).
    if (opts.targetActor && opts.targetActor !== opts.shooter && opts.targetActor.pos) {
      const ta = opts.targetActor.pos;
      const tInc = closestApproachInc(from, to, ta.x, (ta.y || 0) + 1.4, ta.z);
      if (tInc >= SUPPRESS_THRESH) noteSuppressed(opts.targetActor, tInc);
    }

    // ---- THE CITY REACTS to the round itself (props.js: lamps shatter,
    // hydrants geyser; cityevents.js: a gunshot is a wide sharp scare)
    if (CBZ.game && CBZ.game.mode === "city" && opts.muzzle !== false) {
      if (CBZ.cityShootProp) CBZ.cityShootProp(from, to);
      if (CBZ.cityPostEvent) CBZ.cityPostEvent({ type: "gunshot", pos: from, radius: 40, intensity: 0.9 });
    }

    // A MISS IS DRAWN MISSING. A caller whose roll said "missed" but who aims
    // the picture at the target's chest would show a round flying through a
    // body untouched: put it past him, a body's half-width and a hand aside.
    const ta = opts.hit === false && opts.targetActor && opts.targetActor.pos ? opts.targetActor.pos : null;
    if (ta) {
      const ax = to.x - from.x, az = to.z - from.z, al = Math.hypot(ax, az) || 1;
      const ux = -az / al, uz = ax / al;                     // across the line
      const off = (ta.x - to.x) * ux + (ta.z - to.z) * uz;   // how far the line already passes him
      if (Math.abs(off) < 0.5) {
        const side = off > 0 ? -1 : off < 0 ? 1 : (rng() < 0.5 ? -1 : 1);
        const push = 0.6 + rng() * 0.7 - Math.abs(off);
        _missTo.x = to.x + ux * side * push; _missTo.y = to.y + (rng() - 0.4) * 0.5; _missTo.z = to.z + uz * side * push;
        to = _missTo;
      }
    }
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const sp = roundSpec(opts);
    const tr = isTracer(opts, sp);
    // ---- the gun: flash down the bore, and the case out of the port
    if (opts.muzzle !== false && len > 1e-3) {
      _rdDir.set(dx / len, dy / len, dz / len);
      const ms = opts.muzzleScale != null ? opts.muzzleScale : 0.9;
      if (ms > 0) {
        // the plume grows with the powder the cartridge burns (bore as its proxy)
        const k = ms * (0.75 + Math.min(1.6, sp.mm / 9) * 0.35);
        const night = Math.min(1, CBZ.nightAmount || 0);
        CBZ.muzzleFlash(from, { scale: k * (1 + inc * 0.5 + night * 0.3), dir: _rdDir, life: 0.05 + inc * 0.03 });
      }
      if (opts.brass !== false && !mine) ejectFor(from, _rdDir, sp);
    }
    if (len < 0.05) return null;
    const r = RD[rdHead]; rdHead = (rdHead + 1) % RD_CAP;
    r.on = true; r.ox = from.x; r.oy = from.y; r.oz = from.z;
    r.dx = dx / len; r.dy = dy / len; r.dz = dz / len;
    r.len = len; r.end = len; r.s = 0;
    r.v = Math.max(120, sp.v * 0.97);
    r.mm = sp.mm; r.tracer = tr;
    r.col = opts.color != null ? opts.color : (sp.tcol || 0xff5a2a);
    r.hit = opts.hit; r.phase = 0; r.snap = mine; r.mine = mine; r.obj = null; r.ground = false;
    r.tgtP = !!(P && (opts.targetActor === P || (opts.targetActor == null && P.pos &&
      Math.abs(to.x - P.pos.x) < 2.5 && Math.abs(to.z - P.pos.z) < 2.5)));
    // a caller that resolves its own impact, firing into the street: the
    // shot resolvers only test walls and cars, so the round that carries
    // below the pavement plane lands THERE (dust, and a pock in the asphalt)
    if (r.hit === undefined && CBZ.game && CBZ.game.mode === "city" && to.y < 0.09 && from.y > 0.39) {
      const gt = (from.y - 0.09) / (from.y - to.y);
      r.len = r.end = len * gt; r.phase = 1; r.ground = true; r.obj = null;
      r.bx = from.x + dx * gt; r.by = 0.09; r.bz = from.z + dz * gt; r.nx = 0; r.ny = 1; r.nz = 0;
    }
    return r;
  };
  const _rdDir = new THREE.Vector3(), _missTo = { x: 0, y: 0, z: 0 };

  // the shooter's spent case, for a shot near enough the lens to see it land
  function ejectFor(from, dir, sp) {
    if (!CBZ.ejectBrass || sp.mm >= 14) return;
    const cam = CBZ.camera && CBZ.camera.position;
    if (!cam || (from.x - cam.x) * (from.x - cam.x) + (from.z - cam.z) * (from.z - cam.z) > 28 * 28) return;
    let rx = -dir.z, rz = dir.x;
    const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
    let gy = from.y - 1.35;
    if (CBZ.floorAt) { try { const f = +CBZ.floorAt(from.x, from.z, from.y); if (isFinite(f) && f < from.y) gy = f; } catch (e) { /* keep */ } }
    _ejR.x = rx; _ejR.y = 0; _ejR.z = rz; _ejF.x = dir.x; _ejF.z = dir.z;
    _ejP.x = from.x - dir.x * 0.3; _ejP.y = from.y + 0.02; _ejP.z = from.z - dir.z * 0.3;
    CBZ.ejectBrass(_ejP, _ejR, { mm: sp.mm, shell: sp.pellets > 0, groundY: gy, fwd: _ejF });
  }
  const _ejR = { x: 0, y: 0, z: 0 }, _ejF = { x: 0, z: 0 }, _ejP = { x: 0, y: 0, z: 0 };

  // ---- where a round that went past its mark comes down -------------------
  const _bkRay = new THREE.Raycaster();
  const BACKSTOP = 70;                              // m past the mark a stray round is followed
  function backstop(r) {
    const x0 = r.ox + r.dx * r.len, y0 = r.oy + r.dy * r.len, z0 = r.oz + r.dz * r.len;
    let best = BACKSTOP;
    r.obj = null; r.ground = false;
    // the walls (the LOS grid every shooter already tests its line against)
    if (CBZ.losRaycast && CBZ.losBlockers && CBZ.losBlockers.length) {
      _bkRay.ray.origin.set(x0, y0, z0);
      _bkRay.ray.direction.set(r.dx, r.dy, r.dz);
      _bkRay.near = 0.05; _bkRay.far = BACKSTOP;
      const hs = CBZ.losRaycast(_bkRay, CBZ.losBlockers);
      for (let i = 0; hs && i < hs.length; i++) {
        const h = hs[i];
        if (h.distance >= best) continue;
        const n = h.face && h.face.normal;
        if (CBZ.cityShotHole && CBZ.cityShotHole(h.point.x, h.point.y, h.point.z, n ? n.x : 0, n ? n.z : 0)) continue;
        best = h.distance; r.obj = h.object || null;
        r.nx = n ? n.x : -r.dx; r.ny = n ? n.y : 0; r.nz = n ? n.z : -r.dz;
      }
    }
    // the ground: a terrain where the game has one, else the pavement plane
    const gAt = CBZ.groundAt;
    if (r.dy < -1e-4) {
      if (typeof gAt === "function") {
        for (let t = 1.5; t < best; t += 1.5) {
          const y = y0 + r.dy * t, gy = +gAt(x0 + r.dx * t, z0 + r.dz * t);
          if (isFinite(gy) && y <= gy) { best = t; r.obj = null; r.ground = true; r.nx = 0; r.ny = 1; r.nz = 0; break; }
        }
      } else {
        const t = (y0 - 0.09) / -r.dy;
        if (t > 0 && t < best) { best = t; r.obj = null; r.ground = true; r.nx = 0; r.ny = 1; r.nz = 0; }
      }
    }
    if (best >= BACKSTOP) return false;
    r.end = r.len + best;
    r.bx = x0 + r.dx * best; r.by = y0 + r.dy * best; r.bz = z0 + r.dz * best;
    return true;
  }
  // what the round does to what stopped it
  const _hp3 = { x: 0, y: 0, z: 0 }, _hn3 = { x: 0, y: 0, z: 0 };
  function strikeWorld(r) {
    const cam = CBZ.camera && CBZ.camera.position;
    if (cam && Math.hypot(r.bx - cam.x, r.by - cam.y, r.bz - cam.z) > 160) return;
    _hp3.x = r.bx; _hp3.y = r.by; _hp3.z = r.bz;
    _hn3.x = r.nx; _hn3.y = r.ny; _hn3.z = r.nz;
    const pw = Math.min(2, 0.55 + r.mm / 14);
    if (r.ground) {
      _hp3.y += 0.02;
      const surf = CBZ.game && CBZ.game.mode === "city" ? "asphalt" : "dirt";
      CBZ.bulletImpact(_hp3, _hn3, { kind: "dust", surface: surf, power: pw });
      CBZ.bulletHole(_hp3, _hn3, { mm: r.mm, noProp: true, surface: surf });
      return;
    }
    let mat = null;
    const o = r.obj;
    if (o && o.material) mat = Array.isArray(o.material) ? o.material[0] : o.material;
    CBZ.bulletImpact(_hp3, _hn3, { kind: "spark", power: pw, material: mat || undefined, object: o || undefined });
    CBZ.bulletHole(_hp3, _hn3, { mm: r.mm, noProp: true, material: mat || undefined, object: o || undefined });
  }
  // a round that found YOU inside a machine: it strikes the machine
  function strikeYourRide(r) {
    const P = CBZ.player;
    if (!P) return;
    const V = P._aircraft && !P._aircraft.destroyed ? P._aircraft : (P.driving && P._vehicle ? P._vehicle : null);
    const grp = V && (V.group || V.grp || V.mesh);
    if (!grp) return;
    _hp3.x = r.ox + r.dx * r.len; _hp3.y = r.oy + r.dy * r.len; _hp3.z = r.oz + r.dz * r.len;
    _hn3.x = -r.dx; _hn3.y = -r.dy; _hn3.z = -r.dz;
    const pw = Math.min(2, 0.6 + r.mm / 12);
    CBZ.bulletImpact(_hp3, _hn3, { kind: "spark", power: pw });
    if (V.color != null) CBZ.bulletImpact(_hp3, _hn3, { kind: "chip", power: pw * 0.8, color: V.color });
    CBZ.bulletHole(_hp3, _hn3, { mm: r.mm, parent: grp, car: true, noProp: true });
    if (CBZ.sfx) { try { CBZ.sfx("ricochet", { volume: 0.35 + Math.min(0.4, r.mm / 40) }); } catch (e) { /* audio off */ } }
  }
  // the crack (or the whiz) of a round passing your head
  function passBy(r, s0, s1) {
    const cam = CBZ.camera && CBZ.camera.position;
    if (!cam) return;
    const qx = cam.x - r.ox, qy = cam.y - r.oy, qz = cam.z - r.oz;
    const t = qx * r.dx + qy * r.dy + qz * r.dz;
    if (t < s0 || t >= s1 || t > r.end) return;
    r.snap = true;
    const mx = qx - r.dx * t, my = qy - r.dy * t, mz = qz - r.dz * t;
    const miss = Math.sqrt(mx * mx + my * my + mz * mz);
    if (miss > 3 || miss < 0.25) return;
    const vol = Math.min(1, 1.25 - miss / 3) * Math.min(1.3, 0.6 + r.mm / 12);
    if (CBZ.sfx) { try { CBZ.sfx(r.v > 360 ? "bullet_snap" : "bullet_whiz", { dist: miss, ghost: true, volume: vol }); } catch (e) { /* audio off */ } }
  }
  /* HOW A ROUND READS IN FLIGHT — the one look, for every round every game
     draws (gunfx's own flown rounds, NPC War's fire.js, the player's rifle
     rounds in fpsmode.js). The caller hands the streak's tail and head (it
     knows the round's speed and path); this decides what that streak is:
       tracer  the burning compound: its cartridge's colour, a line that
               keeps reading out to a kilometre (width grows with range)
       ball    no compound: a faint warm blur a few metres long, seen only
               within ~110 m of the lens and dimmer with distance
     CBZ.roundStreak(x0,y0,z0, x1,y1,z1, tracer, color, mm, dt) */
  const _rdC = new THREE.Color();
  const _rsO = { color: 0, life: 0, width: 0, ball: false };
  CBZ.roundStreak = function (x0, y0, z0, x1, y1, z1, tracer, color, mm, dt) {
    const cam = CBZ.camera && CBZ.camera.position;
    if (!cam) return;
    const dc = Math.hypot(x1 - cam.x, y1 - cam.y, z1 - cam.z);
    mm = mm || 7;
    if (tracer) {
      if (dc > 1100) return;
      _rsO.color = color != null ? color : 0xff5a2a; _rsO.width = 0.014 + mm * 0.0011; _rsO.ball = false;
    } else {
      if (dc > 110) return;
      const k = 0.5 * (1 - dc / 130);
      _rdC.setRGB(0.95 * k, 0.88 * k, 0.74 * k);
      _rsO.color = _rdC.getHex(); _rsO.width = 0.0035 + mm * 0.00025; _rsO.ball = true;
    }
    _rsO.life = Math.max(0.024, (dt || 0.016) * 1.25);
    CBZ.tracerStreak(x0, y0, z0, x1, y1, z1, _rsO);
  };
  // a round's own streak this frame: a tracer's burning trace, a ball round's blur
  function drawRound(r, s0, s1, dt) {
    const tail = r.tracer ? Math.max(s0, s1 - Math.min(24, Math.max(3, r.v * 0.03)))
      : Math.max(0, s1 - Math.min(9, Math.max(2.5, r.v * 0.011)));
    if (s1 - tail < 0.05) return;
    CBZ.roundStreak(r.ox + r.dx * tail, r.oy + r.dy * tail, r.oz + r.dz * tail,
      r.ox + r.dx * s1, r.oy + r.dy * s1, r.oz + r.dz * s1, r.tracer, r.col, r.mm, dt);
  }
  function stepRounds(dt) {
    if (!(dt > 0)) return;
    for (let i = 0; i < RD_CAP; i++) {
      const r = RD[i];
      if (!r.on) continue;
      const s0 = r.s;
      r.s += r.v * dt;
      const s1 = Math.min(r.s, r.end);
      drawRound(r, s0, s1, dt);
      if (!r.snap) passBy(r, s0, s1);
      if (r.s < r.end) continue;
      if (r.phase === 0) {
        // it reached its mark
        if (r.hit === true) { if (r.tgtP) strikeYourRide(r); r.on = false; continue; }
        if (r.hit === false && backstop(r)) { r.phase = 1; continue; }
        r.on = false; continue;
      }
      strikeWorld(r);
      r.on = false;
    }
  }
  CBZ.roundsLive = function () { let n = 0; for (let i = 0; i < RD_CAP; i++) if (RD[i].on) n++; return n; };
  CBZ.roundsReset = function () { for (let i = 0; i < RD_CAP; i++) RD[i].on = false; };

  // ---- JUICY bullet impacts: a short-lived burst of debris streaks that fly
  // out along the surface normal (GTA/Max-Payne style stretched billboards),
  // plus a flat scorch puff. Pooled, additive sparks + soft dust. Drive with
  // CBZ.bulletImpact(pos, normal, {kind, power}). kind: "spark" (metal/stone,
  // bright orange sparks) | "dust" (concrete/dirt, brown puff) | "wood".
  const _v0 = new THREE.Vector3();
  const _v1 = new THREE.Vector3();
  const _vn = new THREE.Vector3();
  const _vt = new THREE.Vector3();
  const _vb = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  function makeSparkTex() {
    const c = document.createElement("canvas"); c.width = c.height = 32;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,235,1)");
    g.addColorStop(0.4, "rgba(255,196,96,0.9)");
    g.addColorStop(1, "rgba(180,60,10,0)");
    x.fillStyle = g; x.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  }
  function makePuffTex() {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(32, 32, 1, 32, 32, 31);
    g.addColorStop(0, "rgba(220,210,190,0.9)");
    g.addColorStop(0.5, "rgba(150,135,110,0.5)");
    g.addColorStop(1, "rgba(120,105,80,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  let sparkTex = null, puffTex = null;

  // streak particles (thin stretched boxes) for flying sparks/debris
  const streakGeo = new THREE.BoxGeometry(1, 1, 1);
  const streaks = [];
  let streakIdx = 0;
  for (let i = 0; i < 56; i++) {
    const m = new THREE.Mesh(streakGeo, new THREE.MeshBasicMaterial({
      color: 0xffc864, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    m.visible = false; m.frustumCulled = false; m.renderOrder = 9;
    m.name = "gunfx-streak"; m.userData.fx = true;       // (a transient impact spark: probes skip it)
    scene.add(m);
    streaks.push({ mesh: m, vel: new THREE.Vector3(), life: 0, max: 0.001, grav: 0, len: 0, w: 0 });
  }
  // flat scorch/dust puffs that bloom and fade at the impact point
  const puffs = [];
  let puffIdx = 0;
  for (let i = 0; i < 16; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      transparent: true, opacity: 0, depthWrite: false, depthTest: true,
    }));
    s.visible = false; s.renderOrder = 8;
    scene.add(s);
    puffs.push({ spr: s, life: 0, max: 0.001, grow: 1 });
  }

  CBZ.bulletImpact = function (pos, normal, opts) {
    opts = opts || {};
    if (!sparkTex) { sparkTex = makeSparkTex(); puffTex = makePuffTex(); }
    const kind = opts.kind || "spark";
    const power = opts.power != null ? opts.power : 1;
    _vn.set(normal ? normal.x : 0, normal ? normal.y : 1, normal ? normal.z : 0);
    if (_vn.lengthSq() < 1e-6) _vn.set(0, 1, 0); else _vn.normalize();
    // GROUND hit wearing a wall normal: the shot resolver reflects bullets off
    // near-vertical surfaces, but a round into the STREET (the city's ground
    // raycast plane sits at y≈0.085) must kick its debris UP off the asphalt,
    // not sideways along it.
    if (pos.y < 0.2 && Math.abs(_vn.y) < 0.5) _vn.set(_vn.x * 0.3, 1, _vn.z * 0.3).normalize();
    // tangent basis on the surface for cone-spread debris
    _vt.crossVectors(_vn, UP);
    if (_vt.lengthSq() < 1e-5) _vt.set(1, 0, 0); else _vt.normalize();
    _vb.crossVectors(_vn, _vt).normalize();

    /* THE SURFACE THROWS ITSELF. When the caller knows what the round hit
       (opts.material, the struck mesh's own material, and opts.color, its
       real colour at the hit), the burst is chips + dust of that material:
       grey concrete grit off a wall, brick-red crumbs off brick, splinters
       off wood, glass grit off glass, dirt off the ground. Sparks are what
       METAL throws, so only metal (or an unknown surface) still sparks. The
       chips are CBZ.debris's irregular instanced solids that bounce and
       settle, never stretched boxes. */
    const D = CBZ.debris;
    if (D) {
      const mat = opts.material ? (Array.isArray(opts.material) ? opts.material[0] : opts.material) : null;
      let surf = null;
      if (opts.surface) surf = opts.surface;             // a debris.js kind, stated outright
      else if (mat) surf = D.kindOf(mat, opts.object || null);
      else if (kind === "dust") surf = "dirt";
      else if (kind === "wood") surf = "wood";
      else if (kind === "chip") surf = "paint";
      if (surf && surf !== "metal") {
        const px = pos.x + _vn.x * 0.03, py = pos.y + _vn.y * 0.03, pz = pos.z + _vn.z * 0.03;
        if (surf === "paint") {
          D.chips(px, py, pz, { kind: "plastic", color: opts.color, count: Math.min(8, 2 + Math.round(3 * power)),
            dir: _vn, power: 0.6 + 0.3 * power, size: 0.022, spread: 0.2, dust: false });
        } else {
          D.chips(px, py, pz, { kind: surf, material: mat || undefined,
            color: opts.color != null ? opts.color : (mat ? undefined : (kind === "dust" ? 0xc8b48c : undefined)),
            count: Math.min(10, 3 + Math.round(3 * power)), dir: _vn, power: 0.5 + 0.35 * power,
            size: surf === "glass" ? 0.028 : 0.035, spread: 0.25, radius: 0.22 + 0.1 * power });
        }
        return;
      }
    }
    const dust = kind === "dust" || kind === "wood";
    // "chip" without CBZ.debris on the page: solid flecks in the car's coat
    const chip = kind === "chip";
    const baseColor = opts.color != null ? opts.color
      : (kind === "wood" ? 0xb98b50 : dust ? 0xc8b48c : 0xffc864);
    // power is the round's CALIBER dial: an AK burst chews visibly harder than 9mm
    const count = Math.min(12, Math.round((dust ? 4 : chip ? 5 : 6) * power) + 2);
    for (let i = 0; i < count; i++) {
      const p = streaks[streakIdx];
      streakIdx = (streakIdx + 1) % streaks.length;
      // ricochet cone hugging the normal, with random tangential scatter
      const a = rng() * Math.PI * 2;
      const spread = 0.35 + rng() * 0.75;
      const speed = (dust ? 2.2 : chip ? 3.4 : 5.5) + rng() * (dust ? 2.5 : chip ? 3 : 7) * power;
      p.vel.copy(_vn).multiplyScalar(0.6 + rng() * 0.5)
        .addScaledVector(_vt, Math.cos(a) * spread)
        .addScaledVector(_vb, Math.sin(a) * spread)
        .normalize().multiplyScalar(speed);
      p.mesh.position.copy(pos).addScaledVector(_vn, 0.02);
      p.mesh.material.color.setHex(baseColor);
      p.mesh.material.opacity = dust ? 0.7 : 1;
      p.mesh.material.blending = (dust || chip) ? THREE.NormalBlending : THREE.AdditiveBlending;
      p.len = dust ? 0.05 : chip ? 0.09 : (0.14 + rng() * 0.22);
      p.w = dust ? 0.05 : chip ? 0.032 : 0.018;
      p.grav = dust ? 1.5 : chip ? 11 : 16;
      p.life = dust ? (0.16 + rng() * 0.12) : chip ? (0.13 + rng() * 0.1) : (0.1 + rng() * 0.14);
      p.max = p.life;
      p.mesh.visible = true;
    }
    // a flat puff at the surface (chips kick a small grey paint-powder puff)
    const soft = dust || chip;
    const f = puffs[puffIdx];
    puffIdx = (puffIdx + 1) % puffs.length;
    f.spr.material.map = soft ? puffTex : sparkTex;
    f.spr.material.color.setHex(dust ? 0xffffff : chip ? 0xb9b9b9 : 0xffd28c);
    f.spr.material.blending = soft ? THREE.NormalBlending : THREE.AdditiveBlending;
    f.spr.position.copy(pos).addScaledVector(_vn, 0.03);
    const s0 = (dust ? 0.28 : chip ? 0.18 : 0.2) * (0.8 + power * 0.4);
    f.spr.scale.set(s0, s0, s0);
    f.spr.material.opacity = dust ? 0.75 : chip ? 0.6 : 1;
    f.spr.visible = true;
    f.life = soft ? 0.22 : 0.1;
    f.max = f.life;
    f.grow = dust ? 4.5 : chip ? 3.5 : 2;
  };

  // ---- PERSISTENT BULLET HOLES — the world REMEMBERS the firefight ---------
  //
  //  BULLET_HOLE_MATERIALS (2026-09-29, owner: "bullet holes ... realness").
  //  WHAT WAS FAKE: every surface in the game got the SAME grey smudge — one
  //  radial gradient on one canvas — whether the round went into brick, a
  //  steel lamp post, a pine door, a windscreen or asphalt. A hole is the
  //  most material-specific mark a firefight leaves, and ours said nothing.
  //  Worse, each pock was its own Mesh (one draw call per hole, up to 128),
  //  lit by nothing (MeshBasic), so a pale crater in a shaded alley glowed at
  //  full daylight brightness, and a wall hole took its normal from the SHOT
  //  direction flattened to horizontal, so a hole at an angle on a wall
  //  tilted off the surface by the angle of fire.
  //
  //  NOW:
  //   • ONE ATLAS (4x2 tiles, painted once at load) — a hole per MATERIAL:
  //       concrete  chipped pale crater, hairline cracks, grey dust halo
  //       brick     same crater in fresh brick core, orange dust
  //       metal     bright punched rim, bare-steel ring where the paint went
  //       wood      torn pit elongated along the grain, raw splinters
  //       glass     spider web: crushed white cone, radial + ring cracks
  //       asphalt   dark gouge with a grey scuff of pulverised aggregate
  //       carpaint  punched sheet: steel lip, bare-metal ring, primer halo
  //                 (neutral, so it reads right on every paint colour)
  //       soft      plastic / rubber / upholstery: torn hole, stress-white
  //   • WORLD holes are ONE InstancedMesh (one draw call for all of them, so
  //     the cap goes UP, not down — owner: perf via instancing, never looks).
  //     A per-instance `aTile` attribute picks the atlas tile in the vertex
  //     shader (onBeforeCompile on the uv chunk; r128 has no batched tiling).
  //   • MOUNTED holes (car panels, opening doors) stay real meshes so they ride
  //     the body; they share the SAME material through per-tile geometries
  //     that carry aTile per vertex — one program, eight tiny buffers.
  //   • LAMBERT, receiveShadow: the mark is lit and shadowed exactly like the
  //     surface it sits on (same normal), so it never glows in the shade.
  //   • FLUSH: offset 2-4 mm along the TRUE surface normal (callers pass the
  //     struck face's normal now), polygonOffset does the z-fight work.
  //
  //  Surface is chosen by, in order: opts.surface (a kind named outright),
  //  opts.material/opts.object (debris.js kindOf — the same classifier the
  //  impact chips already use, so the hole and the chips can never disagree),
  //  the snapped panel's own material for a mounted hole, else concrete.
  //  HOLES STAY (owner 2026-10-09: "bullet holes disappear after a while,
  //  which is dumb"). Nothing here has a timer; a hole goes only when a cap
  //  is reached, and then the one recycled is the one FURTHEST from the lens
  //  (behind it first), never the oldest-in-a-ring that may be the wall you
  //  are looking at. World holes are one InstancedMesh (one draw call for
  //  all of them), so the cap is generous: 4096 on desktop, a few hundred on
  //  a phone / iPad. The stamp range went 30-90 m -> 90-300 m, so a hole made
  //  down the street is still there when you walk up to it.
  const HOLE_MAX = 4096;      // instanced capacity (the tier cap never exceeds it)
  function holeCap() {
    const hi = CBZ.isMobileDevice ? 600 : HOLE_MAX;
    return (CBZ.qScale ? CBZ.qScale(Math.min(256, hi), hi) : hi) | 0;
  }
  function holeLod()    { return CBZ.qScale ? CBZ.qScale(90, 300) : 200; }
  function holePerCar() { return (CBZ.qScale ? CBZ.qScale(16, 48) : 32) | 0; }
  function mountCap()   { return (CBZ.qScale ? CBZ.qScale(60, CBZ.isMobileDevice ? 120 : 320) : 160) | 0; }
  // per-slot world position of every instanced hole, for the far-first recycle
  const slotPos = new Float32Array(HOLE_MAX * 3);
  const _cf = new THREE.Vector3();
  // the hole the player is least likely to be looking at: far, then behind the
  // lens; `n` candidates, position read by `at(i, out3)`
  function farthestOf(n, at) {
    const cam = CBZ.camera;
    if (!cam || n <= 0) return 0;
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    cam.getWorldDirection(_cf);
    let best = 0, bs = -Infinity;
    const p = _fp3;
    for (let i = 0; i < n; i++) {
      if (!at(i, p)) return i;                       // a free/dead slot: take it
      const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
      let sc = dx * dx + dy * dy + dz * dz;
      if (dx * _cf.x + dy * _cf.y + dz * _cf.z < 0) sc += 1e6;   // behind the lens
      if (sc > bs) { bs = sc; best = i; }
    }
    return best;
  }
  const _fp3 = [0, 0, 0];
  function slotAt(i, out) { out[0] = slotPos[i * 3]; out[1] = slotPos[i * 3 + 1]; out[2] = slotPos[i * 3 + 2]; return true; }

  // ---- HOW BIG IS A BULLET HOLE, ACTUALLY (WOUND_DECAL_V2) -----------------
  //  A 9 mm bore leaves a ~9 mm hole; what you SEE is the spall / chip ring /
  //  web around it, whose width depends on the MATERIAL. The quad's width is
  //  bore x SPREAD[kind]. Concrete keeps the old 10x law exactly (a 9 mm wall
  //  hole is still a 9 cm mark); metal punches clean (4x), glass webs wide.
  //  Legacy `size` callers are rescaled by HOLE_V2_MUL onto the same law.
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.WOUND_DECAL_V2 == null) CBZ.CONFIG.WOUND_DECAL_V2 = true;
  const HOLE_SPALL = 10;      // concrete: quad width ÷ bore
  const HOLE_V2_MUL = 0.36;   // legacy `size` dial → the same law
  const TILE = { concrete: 0, brick: 1, metal: 2, wood: 3, glass: 4, asphalt: 5, carpaint: 6, soft: 7 };
  const SPREAD = { concrete: 10, brick: 11, metal: 4.4, wood: 8.5, glass: 34, asphalt: 9, carpaint: 5, soft: 5.5 };
  function boreMm(opts) {
    if (opts.mm != null) return Math.max(2, Math.min(30, opts.mm));
    const v2 = CBZ.CONFIG.WOUND_DECAL_V2 !== false;
    const legacy = opts.size || 0.24;
    return (v2 ? legacy * HOLE_V2_MUL : legacy) * 1000 / HOLE_SPALL;
  }
  // debris.js kinds (and our own) → an atlas tile
  function tileKind(k) {
    if (TILE[k] != null) return k;
    if (k === "rock") return "concrete";
    if (k === "dirt") return "asphalt";
    if (k === "plastic" || k === "rubber" || k === "fabric" || k === "cloth") return "soft";
    if (k === "foliage") return "wood";
    return "concrete";
  }
  function kindFor(mat, obj) {
    const D = CBZ.debris;
    if (!mat && !obj) return null;
    if (D && D.kindOf) { try { return D.kindOf(mat, obj || null); } catch (e) { /* fall through */ } }
    return null;
  }

  // ---- the atlas: eight holes, painted once --------------------------------
  const AT_COLS = 4, AT_ROWS = 2, AT_PX = 128;
  function paintAtlas() {
    const c = document.createElement("canvas");
    c.width = AT_COLS * AT_PX; c.height = AT_ROWS * AT_PX;
    const x = c.getContext("2d");
    let s = 7741;
    const r = function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const R = AT_PX * 0.47;                       // usable radius (3 px clear margin: no mip bleed)
    function blob(cx, cy, rad, n, jit, fill, sx, sy) {
      x.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = (i % n) / n * Math.PI * 2, k = rad * (1 - jit + r() * jit * 2);
        const px = cx + Math.cos(a) * k * (sx || 1), py = cy + Math.sin(a) * k * (sy || 1);
        if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.closePath(); x.fillStyle = fill; x.fill();
    }
    function halo(cx, cy, r0, r1, rgb, a0) {
      const g = x.createRadialGradient(cx, cy, r0, cx, cy, r1);
      g.addColorStop(0, "rgba(" + rgb + "," + a0 + ")"); g.addColorStop(1, "rgba(" + rgb + ",0)");
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r1, 0, Math.PI * 2); x.fill();
    }
    function bore(cx, cy, rad) {
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, "rgba(3,3,4,1)"); g.addColorStop(0.62, "rgba(6,6,7,0.97)"); g.addColorStop(1, "rgba(10,10,12,0)");
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, rad, 0, Math.PI * 2); x.fill();
    }
    function crack(cx, cy, a, r0, r1, w, col) {
      x.strokeStyle = col; x.lineWidth = w; x.lineCap = "round";
      x.beginPath(); x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      const steps = 5;
      for (let i = 1; i <= steps; i++) {
        const rr = r0 + (r1 - r0) * i / steps, aa = a + (r() - 0.5) * 0.22;
        x.lineTo(cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr);
      }
      x.stroke();
    }
    function chips(cx, cy, n, r0, r1, sz, fill) {
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, d = r0 + r() * (r1 - r0);
        blob(cx + Math.cos(a) * d, cy + Math.sin(a) * d, sz * (0.5 + r()), 5, 0.4, fill);
      }
    }
    // a masonry crater: dust halo → chipped fresh face → shaded pit → bore
    function masonry(cx, cy, dust, face, faceDark, chip) {
      halo(cx, cy, R * 0.2, R * 0.98, dust, 0.30);
      chips(cx, cy, 14, R * 0.38, R * 0.72, R * 0.045, chip);
      blob(cx, cy, R * 0.44, 18, 0.28, face);
      blob(cx, cy, R * 0.30, 14, 0.25, faceDark);
      for (let i = 0; i < 4; i++) crack(cx, cy, r() * 6.28, R * 0.3, R * (0.62 + r() * 0.3), 1, "rgba(28,26,24,0.45)");
      bore(cx, cy, R * 0.19);
    }
    for (let t = 0; t < 8; t++) {
      const cx = (t % AT_COLS) * AT_PX + AT_PX / 2, cy = ((t / AT_COLS) | 0) * AT_PX + AT_PX / 2;
      x.save();
      x.beginPath(); x.rect(cx - AT_PX / 2 + 2, cy - AT_PX / 2 + 2, AT_PX - 4, AT_PX - 4); x.clip();
      if (t === 0) {          // concrete
        masonry(cx, cy, "70,67,62", "rgba(184,179,169,0.92)", "rgba(120,116,108,0.9)", "rgba(170,165,156,0.7)");
      } else if (t === 1) {   // brick
        masonry(cx, cy, "150,92,64", "rgba(196,112,78,0.94)", "rgba(126,62,40,0.92)", "rgba(186,106,72,0.75)");
      } else if (t === 2) {   // bare / painted metal (poles, hydrants, propane)
        halo(cx, cy, R * 0.3, R * 0.8, "22,20,18", 0.22);               // scorch / lead wipe
        blob(cx, cy, R * 0.56, 20, 0.22, "rgba(196,200,206,0.95)");     // paint knocked off: bare steel
        blob(cx, cy, R * 0.50, 20, 0.18, "rgba(168,172,178,0.95)");
        x.strokeStyle = "rgba(235,238,242,1)"; x.lineWidth = R * 0.09;  // the punched lip, bright
        x.beginPath(); x.arc(cx, cy, R * 0.25, 0, Math.PI * 2); x.stroke();
        for (let i = 0; i < 7; i++) crack(cx, cy, i / 7 * 6.28 + r() * 0.4, R * 0.18, R * 0.3, 1.4, "rgba(60,62,66,0.8)"); // petals
        bore(cx, cy, R * 0.22);
      } else if (t === 3) {   // wood — the grain runs along the tile's Y
        halo(cx, cy, R * 0.1, R * 0.7, "40,26,14", 0.22);
        for (let i = 0; i < 16; i++) {                                   // splinters, along the grain
          const up = i % 2 ? -1 : 1, off = (r() - 0.5) * R * 0.5, len = R * (0.35 + r() * 0.55);
          const w = R * (0.03 + r() * 0.05);
          x.fillStyle = r() < 0.7 ? "rgba(222,186,128,0.95)" : "rgba(160,118,70,0.9)";
          x.beginPath(); x.moveTo(cx + off - w, cy); x.lineTo(cx + off + w, cy);
          x.lineTo(cx + off + (r() - 0.5) * w * 2, cy + up * len); x.closePath(); x.fill();
        }
        blob(cx, cy, R * 0.22, 14, 0.3, "rgba(214,176,120,0.95)", 0.8, 1.5);   // raw torn fibre
        blob(cx, cy, R * 0.15, 12, 0.3, "rgba(44,28,14,0.96)", 0.75, 1.6);
        bore(cx, cy, R * 0.12);
      } else if (t === 4) {   // glass — spider web
        const n = 12, ang = [], len = [];
        for (let i = 0; i < n; i++) { ang.push(i / n * 6.28 + (r() - 0.5) * 0.4); len.push(R * (0.55 + r() * 0.42)); }
        for (let i = 0; i < n; i++) crack(cx, cy, ang[i], R * 0.04, len[i], 1.3, "rgba(236,244,247,0.85)");
        const rings = [0.16, 0.3, 0.48];
        x.strokeStyle = "rgba(226,236,240,0.6)"; x.lineWidth = 1;
        for (let k = 0; k < rings.length; k++) {
          x.beginPath();
          for (let i = 0; i <= n; i++) {
            const j = i % n; if (len[j] < R * rings[k] * 1.1) { x.moveTo(cx, cy); continue; }
            const rr = R * rings[k] * (0.85 + r() * 0.3);
            const px = cx + Math.cos(ang[j]) * rr, py = cy + Math.sin(ang[j]) * rr;
            if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
          }
          x.stroke();
        }
        halo(cx, cy, 0, R * 0.13, "238,244,246", 0.9);                  // crushed cone
        bore(cx, cy, R * 0.04);
      } else if (t === 5) {   // asphalt / dirt
        blob(cx, cy, R * 0.62, 16, 0.3, "rgba(118,113,104,0.35)", 1, 0.8); // pulverised aggregate
        chips(cx, cy, 10, R * 0.3, R * 0.7, R * 0.04, "rgba(140,134,124,0.6)");
        blob(cx, cy, R * 0.32, 14, 0.3, "rgba(22,22,22,0.92)");
        bore(cx, cy, R * 0.18);
      } else if (t === 6) {   // car paint over sheet steel
        blob(cx, cy, R * 0.66, 22, 0.25, "rgba(146,146,140,0.85)");     // primer where the coat flaked
        for (let i = 0; i < 6; i++) crack(cx, cy, r() * 6.28, R * 0.5, R * (0.72 + r() * 0.2), 1, "rgba(40,40,40,0.35)");
        blob(cx, cy, R * 0.42, 18, 0.2, "rgba(204,208,212,0.97)");     // bare metal
        x.strokeStyle = "rgba(90,92,96,0.9)"; x.lineWidth = R * 0.06;
        x.beginPath(); x.arc(cx, cy, R * 0.24, 0, Math.PI * 2); x.stroke();   // lip turned in
        bore(cx, cy, R * 0.2);
      } else {                // soft: plastic, rubber, upholstery
        blob(cx, cy, R * 0.5, 16, 0.3, "rgba(222,222,216,0.35)");       // stress whitening
        blob(cx, cy, R * 0.3, 22, 0.45, "rgba(18,18,18,0.9)");          // torn, ragged
        bore(cx, cy, R * 0.2);
      }
      x.restore();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  let holeMat = null, holeInst = null, aTileI = null;
  const tileGeos = {};          // kind → PlaneGeometry carrying aTile per VERTEX (mounted holes)
  function tileOff(kind, out, o) {
    const t = TILE[kind] | 0;
    out[o] = (t % AT_COLS) / AT_COLS;
    out[o + 1] = 1 - (((t / AT_COLS) | 0) + 1) / AT_ROWS;   // canvas y runs down, uv v runs up
  }
  function ensureHoles() {
    if (holeMat) return;
    holeMat = new THREE.MeshLambertMaterial({
      map: paintAtlas(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    holeMat._shared = true;
    holeMat.onBeforeCompile = function (sh) {
      sh.vertexShader = "attribute vec2 aTile;\n" + sh.vertexShader.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\n#ifdef USE_UV\n  vUv = vUv * vec2(0.25, 0.5) + aTile;\n#endif");
    };
    holeMat.customProgramCacheKey = function () { return "cbzHoleAtlas1"; };
    const g = new THREE.PlaneGeometry(1, 1);
    aTileI = new THREE.InstancedBufferAttribute(new Float32Array(HOLE_MAX * 2), 2);
    aTileI.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("aTile", aTileI);
    g._shared = true;
    holeInst = new THREE.InstancedMesh(g, holeMat, HOLE_MAX);
    holeInst.count = 0;
    holeInst.frustumCulled = false;            // holes are scattered city-wide
    holeInst.receiveShadow = true;
    holeInst.renderOrder = 4;
    holeInst._bulletHole = true;
    holeInst.userData.noHit = true;
    holeInst.name = "bulletHoles";
    scene.add(holeInst);
    const ks = Object.keys(TILE);
    for (let i = 0; i < ks.length; i++) {
      const pg = new THREE.PlaneGeometry(1, 1);
      const a = new Float32Array(pg.attributes.position.count * 2);
      for (let v = 0; v < pg.attributes.position.count; v++) tileOff(ks[i], a, v * 2);
      pg.setAttribute("aTile", new THREE.BufferAttribute(a, 2));
      pg._shared = true;
      tileGeos[ks[i]] = pg;
    }
  }
  let instFill = 0;
  const mounted = [];            // real meshes riding a car / door
  let holeSeq = 0;
  const _zAxis = new THREE.Vector3(0, 0, 1);
  const _hq = new THREE.Quaternion();
  const _spinQ = new THREE.Quaternion();
  const _hp = new THREE.Vector3();
  const _hn = new THREE.Vector3();
  const _hy = new THREE.Vector3();
  const _ht = new THREE.Vector3();
  const _hs = new THREE.Vector3();
  const _hm = new THREE.Matrix4();
  const _ray = new THREE.Raycaster();
  const _nm = new THREE.Matrix3();
  const _UP = new THREE.Vector3(0, 1, 0);
  // Orient +Z along the normal and spin in-plane. Wood keeps its splinters on
  // the grain (the tile's Y to world-up); everything else spins freely so no
  // two holes on a wall share a silhouette.
  function orientHole(q, n, kind) {
    q.setFromUnitVectors(_zAxis, n);
    let spin = rng() * Math.PI * 2;
    if (kind === "wood") {
      _ht.copy(_UP).addScaledVector(n, -n.y);                 // world-up, in the surface
      if (_ht.lengthSq() > 0.09) {
        _ht.normalize();
        _hy.set(0, 1, 0).applyQuaternion(q);
        _hs.crossVectors(_hy, _ht);
        spin = Math.atan2(_hs.dot(n), _hy.dot(_ht)) + (rng() - 0.5) * 0.25;
      }
    }
    _spinQ.setFromAxisAngle(_zAxis, spin);
    q.multiply(_spinQ);
    return q;
  }
  let routingProps = false;   // re-entry guard: prop reactions stamp holes of their own
  CBZ.bulletHole = function (pos, normal, opts) {
    opts = opts || {};
    const cam = CBZ.camera;
    // PLAYER-SHOT PROP ROUTING (see props.js cityShootProp) — before the LOD,
    // so a sniped hydrant still pops. opts.noProp opts out.
    if (!routingProps && !opts.noProp && CBZ.cityShootProp && CBZ.game && CBZ.game.mode === "city" && cam) {
      routingProps = true;
      try { CBZ.cityShootProp(cam.position, pos); } finally { routingProps = false; }
    }
    const d = opts.dist != null ? opts.dist
      : (cam ? Math.hypot(pos.x - cam.position.x, pos.y - cam.position.y, pos.z - cam.position.z) : 0);
    if (d > holeLod()) return null;
    ensureHoles();
    const parent = opts.parent || scene;
    _hn.set(normal ? normal.x : 0, normal ? normal.y : 0, normal ? normal.z : 1);
    if (_hn.lengthSq() < 1e-6) _hn.set(0, 0, 1); else _hn.normalize();
    _hp.set(pos.x, pos.y, pos.z);
    let kind = opts.surface || kindFor(opts.material, opts.object);
    // CAR / DOOR SNAP: a parented point/normal comes off a bounding-box slab
    // test; back out along the normal, fire a short ray back in, and stamp on
    // the first REAL panel struck (true point + true face normal + that
    // panel's own material). No panel on the ray = no hole: a floating disc
    // is exactly the bug.
    if (parent !== scene) {
      if (parent.updateWorldMatrix) parent.updateWorldMatrix(true, true);
      _ray.ray.origin.copy(_hp).addScaledVector(_hn, 1.5);
      _ray.ray.direction.copy(_hn).negate();
      _ray.near = 0; _ray.far = 4;
      let best = null;
      parent.traverse(function (o) {
        if (!o.isMesh || !o.visible || o._bulletHole) return;
        const its = _ray.intersectObject(o, false);
        if (its.length && its[0].face && (!best || its[0].distance < best.distance)) best = its[0];
      });
      if (!best) return null;
      _hp.copy(best.point);
      _nm.getNormalMatrix(best.object.matrixWorld);
      _hn.copy(best.face.normal).applyMatrix3(_nm).normalize();
      if (_hn.lengthSq() < 1e-6) _hn.set(0, 1, 0);
      if (!opts.surface) {
        let pm = best.object.material;
        if (Array.isArray(pm)) pm = pm[(best.face && best.face.materialIndex) || 0] || pm[0];
        const k = kindFor(pm, best.object);
        if (k) kind = k;
      }
      // painted bodywork: the classifier's grey-default is sheet steel here
      if (opts.car && (kind == null || kind === "concrete" || kind === "metal" || kind === "brick" || kind === "wood")) kind = "carpaint";
    }
    kind = tileKind(kind || "concrete");
    // street-level hit with a wall-style normal → the pock lies FLAT on the
    // asphalt; mounted bodywork is exempt (a rocker-panel hole is vertical).
    if (pos.y < 0.2 && Math.abs(_hn.y) < 0.5 && parent === scene) _hn.set(0, 1, 0);
    const s = boreMm(opts) * 0.001 * SPREAD[kind] * (0.85 + rng() * 0.3);
    // FLUSH: a hair along the TRUE normal (never a visible gap edge-on) and
    // polygonOffset wins the depth test. Mounted panels lead the transform by
    // a frame, so they keep a slightly larger floor.
    const off = Math.max(parent !== scene ? 0.004 : 0.002, Math.min(0.006, s * 0.03));
    _hp.addScaledVector(_hn, off);
    const seq = ++holeSeq;
    if (parent === scene) {
      orientHole(_hq, _hn, kind);
      _hm.compose(_hp, _hq, _hs.set(s, s, 1));
      const cap = Math.min(HOLE_MAX, holeCap());
      let slot;
      if (instFill < cap) { slot = instFill++; }
      else {
        // full: recycle the hole furthest from the lens (a tier drop shrinks
        // the cap: the instances past it simply stop drawing)
        if (instFill > cap) instFill = cap;
        slot = farthestOf(instFill, slotAt);
      }
      slotPos[slot * 3] = _hp.x; slotPos[slot * 3 + 1] = _hp.y; slotPos[slot * 3 + 2] = _hp.z;
      if (holeInst.parent !== scene) scene.add(holeInst);   // a world rebuild swept the scene
      holeInst.setMatrixAt(slot, _hm);
      tileOff(kind, aTileI.array, slot * 2);
      holeInst.count = instFill;
      holeInst.instanceMatrix.needsUpdate = true;
      aTileI.needsUpdate = true;
      return holeInst;
    }
    // ---- mounted: a real mesh on the moving body ----
    let m = null;
    let count = 0, oldest = null;
    for (let i = 0; i < mounted.length; i++) {
      const h = mounted[i];
      if (!h.visible) { if (!m) m = h; continue; }
      if (h.parent !== parent) {
        // a hole on a car that has left the world (scrapped, despawned) is
        // nobody's hole any more: the first free slot
        if (!m && !inScene(h)) { m = h; }
        continue;
      }
      count++;
      if (!oldest || h._holeSeq < oldest._holeSeq) oldest = h;
    }
    if (count >= holePerCar()) m = oldest;          // one riddled sedan must not eat the pool
    if (!m) {
      if (mounted.length < mountCap()) {
        m = new THREE.Mesh(tileGeos[kind], holeMat);
        m.renderOrder = 4;
        m.receiveShadow = true;
        m._bulletHole = true;
        mounted.push(m);
      } else m = mounted[farthestOf(mounted.length, mountAt)];
    }
    m.geometry = tileGeos[kind];
    m._holeSeq = seq;
    if (m.parent !== parent) parent.add(m);
    m.visible = true;
    parent.worldToLocal(_hp);
    parent.getWorldQuaternion(_hq);
    _hn.applyQuaternion(_hq.invert()).normalize();
    orientHole(m.quaternion, _hn, kind);
    m.position.copy(_hp);
    m.scale.set(s, s, 1);
    return m;
  };
  function inScene(o) { while (o) { if (o === scene) return true; o = o.parent; } return false; }
  const _mw = new THREE.Vector3();
  function mountAt(i, out) {
    const h = mounted[i];
    if (!h.visible || !inScene(h)) return false;
    h.getWorldPosition(_mw);
    out[0] = _mw.x; out[1] = _mw.y; out[2] = _mw.z;
    return true;
  }
  // wipe every pock (new run / world rebuild) — pools survive, marks don't
  CBZ.bulletHolesReset = function () {
    instFill = 0;
    if (holeInst) holeInst.count = 0;
    for (let i = 0; i < mounted.length; i++) {
      mounted[i].visible = false;
      if (mounted[i].parent !== scene) scene.add(mounted[i]);  // un-mount from dead cars
    }
  };
  // for the tools: how many marks of each surface are live
  CBZ.bulletHoleAudit = function () {
    const by = {};
    if (aTileI) {
      for (let i = 0; i < instFill; i++) {
        const u = aTileI.array[i * 2], v = aTileI.array[i * 2 + 1];
        const t = Math.round(u * AT_COLS) + (AT_ROWS - 1 - Math.round(v * AT_ROWS)) * AT_COLS;
        const k = Object.keys(TILE)[t] || "?";
        by[k] = (by[k] || 0) + 1;
      }
    }
    let mountedLive = 0;
    for (let i = 0; i < mounted.length; i++) if (mounted[i].visible) mountedLive++;
    return { world: instFill, mounted: mountedLive, bySurface: by, drawCalls: (instFill ? 1 : 0) + mountedLive };
  };

  // one always-updater fades + recycles every transient (runs in all modes,
  // like the rig/facial layers, so brief bursts never freeze mid-fade).
  CBZ.onAlways(54, function (dt) {
    stepRounds(dt);
    for (let i = liveFlashes.length - 1; i >= 0; i--) {
      const f = liveFlashes[i];
      f.life -= dt;
      f.spr.material.opacity = Math.max(0, f.life / f.max) * (f.peak != null ? f.peak : 1);
      if (f.life <= 0) { f.spr.visible = false; flashPool.push(f.spr); liveFlashes.splice(i, 1); }
    }
    // bullet-impact streaks: integrate velocity + gravity, stretch along motion
    for (let i = 0; i < streaks.length; i++) {
      const p = streaks[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      p.vel.y -= p.grav * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const sp = p.vel.length();
      if (sp > 0.01) {
        _v0.copy(p.vel).multiplyScalar(1 / sp);
        p.mesh.quaternion.setFromUnitVectors(UP, _v0);
      }
      p.mesh.scale.set(p.w, p.len + Math.min(0.4, sp * 0.012), p.w);
      p.mesh.material.opacity = Math.max(0, p.life / p.max) * (p.grav > 5 ? 1 : 0.7);
    }
    for (let i = 0; i < puffs.length; i++) {
      const f = puffs[i];
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) { f.spr.visible = false; continue; }
      const k = 1 + f.grow * dt;
      f.spr.scale.multiplyScalar(k);
      f.spr.material.opacity = Math.max(0, f.life / f.max) * (f.spr.material.blending === THREE.NormalBlending ? 0.75 : 1);
    }
  });

  /* ---- TRACER ROUNDS IN FLIGHT: CBZ.tracerStreak(x0,y0,z0, x1,y1,z1, opts)
     A tracer is a burning pellet in the base of one round in N. What the eye
     keeps of it is a short glowing streak travelling at the round's own speed,
     not a line from the muzzle to the target drawn in one frame. The caller
     (who flies the round) hands this the streak's tail and head every step;
     each one lives a few frames and fades. ONE InstancedMesh, one draw call,
     whatever the battle is doing. The width grows with distance from the
     lens so a tracer still reads as a line at 400 m (that is what tracers
     are FOR). opts: {color (hex), life (s), width (m at 10 m)} */
  const TS_CAP = 192;
  let tsMesh = null, tsHead = 0;
  const tsLife = new Float32Array(TS_CAP), tsMax = new Float32Array(TS_CAP), tsCol = new Float32Array(TS_CAP * 3);
  const _tsM = new THREE.Matrix4(), _tsQ = new THREE.Quaternion(), _tsS = new THREE.Vector3(), _tsP = new THREE.Vector3(), _tsD = new THREE.Vector3();
  const _tsC = new THREE.Color(), ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
  function ensureTs() {
    if (tsMesh) return tsMesh;
    const geo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
    geo.translate(0, 0.5, 0);                       // base at the tail, +Y to the head
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false });
    tsMesh = new THREE.InstancedMesh(geo, mat, TS_CAP);
    tsMesh.name = "gunfx-tracers"; tsMesh.userData.fx = true;
    tsMesh.frustumCulled = false; tsMesh.renderOrder = 9;
    for (let i = 0; i < TS_CAP; i++) { tsMesh.setMatrixAt(i, ZERO_M); tsMesh.setColorAt(i, _tsC.setRGB(0, 0, 0)); }
    tsMesh.instanceMatrix.needsUpdate = true;
    if (tsMesh.instanceColor) tsMesh.instanceColor.needsUpdate = true;
    scene.add(tsMesh);
    return tsMesh;
  }
  CBZ.tracerStreak = function (x0, y0, z0, x1, y1, z1, opts) {
    const M = ensureTs();
    _tsD.set(x1 - x0, y1 - y0, z1 - z0);
    const len = _tsD.length();
    if (len < 0.05) return;
    _tsD.multiplyScalar(1 / len);
    const cam = CBZ.camera && CBZ.camera.position;
    const dc = cam ? Math.hypot(x1 - cam.x, y1 - cam.y, z1 - cam.z) : 30;
    // a tracer keeps reading as a line at 400 m (that is what tracers are FOR);
    // a ball round's faint blur may not outgrow what a real one shows
    const w = ((opts && opts.width) || 0.016) * (opts && opts.ball ? Math.min(2, Math.max(1, dc / 20)) : Math.max(1, dc / 32));
    const i = tsHead; tsHead = (tsHead + 1) % TS_CAP;
    _tsQ.setFromUnitVectors(UP, _tsD);
    _tsS.set(w, len, w);
    _tsP.set(x0, y0, z0);
    _tsM.compose(_tsP, _tsQ, _tsS);
    M.setMatrixAt(i, _tsM);
    _tsC.setHex((opts && opts.color) != null ? opts.color : 0xff6a30);
    tsCol[i * 3] = _tsC.r; tsCol[i * 3 + 1] = _tsC.g; tsCol[i * 3 + 2] = _tsC.b;
    M.setColorAt(i, _tsC);
    tsLife[i] = tsMax[i] = (opts && opts.life) || 0.05;
    M.instanceMatrix.needsUpdate = true;
    if (M.instanceColor) M.instanceColor.needsUpdate = true;
  };

  /* ---- BRASS: CBZ.ejectBrass(pos, right, opts)
     The case leaves the ejection port to the right and a little forward at a
     few metres a second, tumbles, hits the ground, skips once or twice and
     lies there. A battle leaves a carpet of it. Pooled in ONE InstancedMesh
     (the oldest case recycles), each case sized to its cartridge (opts.mm
     bore, opts.len case length), shotgun hulls red. opts: {mm, len, shell,
     groundY, fwd: {x,z} the gun's facing} */
  const BR_CAP = 360;
  let brMesh = null, brHead = 0, brLive = 0;
  const BR = [];
  const _brE = new THREE.Euler(), _brC = new THREE.Color();
  function ensureBrass() {
    if (brMesh) return brMesh;
    const geo = new THREE.CylinderGeometry(1, 1, 1, 7);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x2a1800, emissiveIntensity: 0.25 });
    brMesh = new THREE.InstancedMesh(geo, mat, BR_CAP);
    brMesh.name = "gunfx-brass"; brMesh.userData.fx = true;
    brMesh.frustumCulled = false;
    brMesh.castShadow = false; brMesh.receiveShadow = false;
    for (let i = 0; i < BR_CAP; i++) {
      brMesh.setMatrixAt(i, ZERO_M);
      brMesh.setColorAt(i, _brC.setHex(0xd6a33b));
      BR.push({ on: false, rest: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, wx: 0, wz: 0, gy: 0, r: 0.005, l: 0.045, t: 0 });
    }
    brMesh.instanceMatrix.needsUpdate = true;
    if (brMesh.instanceColor) brMesh.instanceColor.needsUpdate = true;
    scene.add(brMesh);
    return brMesh;
  }
  function brWrite(i) {
    const b = BR[i];
    _brE.set(b.rx, b.ry, b.rz);
    _tsQ.setFromEuler(_brE);
    _tsS.set(b.r, b.l, b.r);
    _tsP.set(b.x, b.y, b.z);
    _tsM.compose(_tsP, _tsQ, _tsS);
    brMesh.setMatrixAt(i, _tsM);
  }
  CBZ.ejectBrass = function (pos, right, opts) {
    opts = opts || {};
    const M = ensureBrass();
    const i = brHead; brHead = (brHead + 1) % BR_CAP;
    const b = BR[i];
    const fx = opts.fwd ? opts.fwd.x : 0, fz = opts.fwd ? opts.fwd.z : 0;
    const sp = 2.6 + rng() * 1.6;
    b.on = true; b.rest = false; b.t = 0;
    b.x = pos.x + right.x * 0.06; b.y = pos.y; b.z = pos.z + right.z * 0.06;
    b.vx = right.x * sp + fx * (0.4 + rng() * 0.6) + (rng() - 0.5) * 0.5;
    b.vz = right.z * sp + fz * (0.4 + rng() * 0.6) + (rng() - 0.5) * 0.5;
    b.vy = 1.4 + rng() * 1.4;
    b.rx = rng() * 6.28; b.ry = rng() * 6.28; b.rz = rng() * 6.28;
    b.wx = (rng() - 0.5) * 50; b.wz = (rng() - 0.5) * 50;
    b.gy = opts.groundY != null ? opts.groundY : pos.y - 1.3;
    const mm = opts.shell ? 20 : (opts.mm || 5.7) * 1.95;      // the CASE is fatter than the bullet
    b.r = mm / 2000; b.l = opts.len || (opts.shell ? 0.07 : 0.045);
    M.setColorAt(i, _brC.setHex(opts.shell ? 0xa8231c : 0xd6a33b));
    if (M.instanceColor) M.instanceColor.needsUpdate = true;
    brWrite(i);
    M.instanceMatrix.needsUpdate = true;
    brLive++;
  };
  CBZ.brassReset = function () {
    if (!brMesh) return;
    for (let i = 0; i < BR_CAP; i++) { BR[i].on = false; brMesh.setMatrixAt(i, ZERO_M); }
    brMesh.instanceMatrix.needsUpdate = true; brLive = 0;
  };
  CBZ.onAlways(54.5, function (dt) {
    if (plMesh) {
      let anyP = false;
      for (let i = 0; i < PL_CAP; i++) {
        if (plLife[i] <= 0) continue;
        plLife[i] -= dt;
        anyP = true;
        if (plLife[i] <= 0) { plMesh.setMatrixAt(i, ZERO_M); plMesh.instanceMatrix.needsUpdate = true; continue; }
        const k = plLife[i] / plMax[i];
        plMesh.setColorAt(i, _plC.setRGB(1 * k, 0.78 * k, 0.44 * k));
      }
      if (anyP && plMesh.instanceColor) plMesh.instanceColor.needsUpdate = true;
    }
    if (tsMesh) {
      let any = false;
      for (let i = 0; i < TS_CAP; i++) {
        if (tsLife[i] <= 0) continue;
        tsLife[i] -= dt;
        any = true;
        if (tsLife[i] <= 0) { tsMesh.setMatrixAt(i, ZERO_M); tsMesh.instanceMatrix.needsUpdate = true; continue; }
        const k = tsLife[i] / tsMax[i];
        _tsC.setRGB(tsCol[i * 3] * k, tsCol[i * 3 + 1] * k, tsCol[i * 3 + 2] * k);
        tsMesh.setColorAt(i, _tsC);
      }
      if (any && tsMesh.instanceColor) tsMesh.instanceColor.needsUpdate = true;
    }
    if (brMesh && brLive > 0 && dt > 0) {
      const h = Math.min(dt, 0.05);
      let moved = false;
      for (let i = 0; i < BR_CAP; i++) {
        const b = BR[i];
        if (!b.on || b.rest) continue;
        b.t += h;
        b.vy -= 9.81 * h;
        b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
        b.rx += b.wx * h; b.rz += b.wz * h;
        if (b.y <= b.gy + b.r) {
          b.y = b.gy + b.r;
          if (Math.abs(b.vy) < 0.7 || b.t > 2.5) {
            // down: lying on its side, rolled to a stop
            b.rest = true; b.rx = Math.PI / 2; b.rz = 0; b.ry = rng() * 6.28;
          } else {
            b.vy = -b.vy * 0.32; b.vx *= 0.5; b.vz *= 0.5; b.wx *= 0.55; b.wz *= 0.55;
          }
        }
        brWrite(i);
        moved = true;
      }
      if (moved) brMesh.instanceMatrix.needsUpdate = true;
    }
  });

  // ---- FIRST-SHOT PREWARM (same de-spike as crashfx's first-blast block) ----
  // The tracer Line, the muzzle-flash sprite and the impact textures were all
  // minted lazily on the FIRST shot of a session — and r128 only compiles a
  // material's shader program the first time an object using it actually
  // renders, so the first trigger pull paid canvas bakes + allocations + a
  // LineBasicMaterial/SpriteMaterial program compile inside one frame. Build
  // them at load instead (visible=false, exactly the shape the pools recycle
  // into); core/fxwarm.js compiles their programs during the play-start
  // transition, so the first shot of the session hits warm caches.
  flashTex = makeFlashTex();
  sparkTex = makeSparkTex();
  puffTex = makePuffTex();
  // the impact-puff sprites above were built map-LESS (their map used to arrive
  // with the first bulletImpact, without needsUpdate). That only worked because
  // their first render happened after that assignment; with the play-start
  // renderer.compile() pass (core/fxwarm.js) their program would be frozen in
  // the no-map variant — r128 only re-keys a program on needsUpdate. Seat the
  // map NOW so the material carries one from birth and every later swap at
  // bulletImpact is texture↔texture (uniform rebind, never a program change).
  for (let i = 0; i < puffs.length; i++) puffs[i].spr.material.map = puffTex;
  // the hole atlas + its one InstancedMesh: painted and parented at load, so
  // the first pock of the session is a setMatrixAt, not a canvas bake.
  try { ensureHoles(); } catch (e) { /* headless: built lazily on first hole */ }
  for (let i = 0; i < 2; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTex, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    s.renderOrder = 9; s.visible = false;
    scene.add(s);
    flashPool.push(s);
  }
  try { ensurePlume(); ensureTs(); } catch (e) { /* headless: built on first shot */ }
})();

/* ============================================================
   city/wildlife_shark.js — THE SHARK: numbers, depth, and THE FIN.

   WHAT THIS FILE IS NOT: a shark AI loop. games/ocean.js already owns a
   complete shark FSM (patrol/circle/bump/strike/flee) for the dive minigame,
   and CLAUDE.md's ratchet already indicts this repo for "18-25 independent AI
   update loops (only 2 share code)". A third shark brain would make that 19-26
   and would be exactly the disease the BLOCK LAW exists to stop.

   So the stalking behaviour lives in CBZ.predatorHunt (systems/predator.js) —
   the ONE shared "something is hunting you and it commits" driver, which a
   wolf pack, a big cat or a future human stalker ticks the same way. This file
   contributes only the three things that are genuinely the shark's:

     1. THE NUMBERS — sense/circle/orbit radii, speeds, dive depths, the seize.
     2. THE LOCOMOTION SEAM — a `move` callback that swims through
        CBZ.waterField instead of walking on CBZ.floorAt. That callback is the
        whole reason the shared driver is medium-agnostic.
     3. THE FIN + WAKE PROXY — the dorsal triangle and its V, drawn on the
        water INDEPENDENTLY of the body's LOD.

   THE FIN IS THE POINT (Jaws' broken shark). The body is crisply visible only
   inside ~18% of the sense radius, and during the rush and the seize. Every
   other second of the encounter the player gets a fin cutting the surface and
   a wake, and nothing else. Withholding the body IS the horror technique, and
   because the proxy is three cheap meshes it is also a rendering win.

   SHALLOWS (the estuary law): wildlife.js gives a great white 34u of shoreline
   clearance and a megalodon 88u so their bodies never beach themselves while
   wandering. Taken literally that clearance makes a shark PHYSICALLY UNABLE to
   reach anyone swimming off a beach — it would orbit 34u out forever. The
   clearance is therefore relaxed by hunt state inside the move callback (never
   in aquaticClearance(), which spawn placement and the deterministic world
   build depend on): a committed shark noses into water it has no business
   being in, and swims back out to deep water when it disengages.

   Reverts with CBZ.CONFIG.SHARK_HORROR = false (then wildlife.js's ordinary
   aquatic wander runs, exactly as before this file existed).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  if (CBZ.CONFIG && CBZ.CONFIG.SHARK_HORROR == null) CBZ.CONFIG.SHARK_HORROR = true;
  function ON() { return !(CBZ.CONFIG && CBZ.CONFIG.SHARK_HORROR === false); }

  // ---- tuning (one screen; every constant the encounter has) -------------
  const SENSE_R = 110;          // u — it notices a swimmer this far out
  const CHUM_R = 220;           // u — blood in the water pulls it from much further
  const CIRCLE_R = 26;          // u — inside this it stops closing and starts orbiting
  const ORBIT_R = 18;           // u — the orbit it holds while it decides
  const CIRCLE_T = 6.5;         // s  — base time spent circling (predatorHunt jitters it)
  const SHOW_F = 0.18;          // fraction of SENSE_R inside which the BODY is visible
  const FIN_F = 1.25;           // fin/wake proxy draws inside SENSE_R * this
  const BUMP_DMG = 6;           // the investigatory shoulder-nudge
  const HOLD_S = 2.6;           // seize duration
  const ESCAPE_P = 0.35;        // base chance the player breaks free
  const TURN_RATE = 1.15;       // rad/s — a shark turns with its whole body
  const STUCK_BAIL = 0.9;       // s of blocked movement before it gives up the hunt
  // depth targets, as a MULTIPLE of the species' authored swim depth
  const DIVE = {
    cruise: 1.55, scent: 0.95, circle: 0.9, bump: 0.85,
    vanish: 9, rush: 1.9, seize: 0.8, disengage: 2.4,
  };
  // shoreline clearance by hunt state, as a fraction of the spawn clearance.
  // This is the estuary law above, in one table.
  const CLEAR = {
    cruise: 1, disengage: 1, scent: 0.55,
    circle: 0.35, bump: 0.35, vanish: 0.35, rush: 0.18, seize: 0.18,
  };

  function clock() {
    const t = (typeof performance !== "undefined" ? performance.now() : Date.now()) * 0.001;
    return t % 3600;
  }
  function shortest(a) {
    while (a > Math.PI) a -= 6.283185307;
    while (a < -Math.PI) a += 6.283185307;
    return a;
  }
  function surfaceAt(x, z, t) {
    const wf = CBZ.waterField;
    if (wf && wf.surfaceY) { const s = wf.surfaceY(x, z, t); if (isFinite(s)) return s; }
    if (CBZ.citySeaHeightAt) { const s = CBZ.citySeaHeightAt(x, z); if (isFinite(s)) return s; }
    return CBZ.waterSeaY ? CBZ.waterSeaY() : (CBZ.SEA_Y != null ? CBZ.SEA_Y : 0);
  }

  // Can this shark actually get at the target? (predatorHunt's canReach seam.)
  // A shark cannot bite someone standing on a pier, and pretending otherwise
  // would produce the single worst bug this feature could ship.
  function inWater(t) {
    if (!t) return false;
    if (CBZ.player && t === CBZ.player) {
      if (CBZ.citySwimming && CBZ.citySwimming()) return true;
      if (t._swim) return true;
    }
    const p = t.pos || (t.group && t.group.position);
    if (!p) return false;
    if (CBZ.predatorMedium) return CBZ.predatorMedium(p.x, p.y, p.z) === "water";
    if (CBZ.cityWaterAt && !CBZ.cityWaterAt(p.x, p.z)) return false;
    if (CBZ.citySeaHeightAt) return p.y <= CBZ.citySeaHeightAt(p.x, p.z) + 0.5;
    return !!(CBZ.cityWaterAt && CBZ.cityWaterAt(p.x, p.z));
  }

  // ============================================================
  //  THE PROXY — one flattened cone (the dorsal) and two stretched translucent
  //  quads (the V of the wake), living in the SAME parent as the shark group
  //  but never inside it, so the body can be hidden while the fin keeps
  //  cutting the surface. Geometry and materials are module-wide singletons;
  //  each shark owns three tiny objects and nothing is allocated per frame.
  // ============================================================
  let finGeo = null, wakeGeo = null, finMat = null, wakeMat = null;
  function assets() {
    if (finGeo) return;
    finGeo = new THREE.ConeGeometry(0.5, 1.2, 4);          // r128: (radius, height, radialSegments)
    wakeGeo = new THREE.PlaneGeometry(1, 1);
    finMat = new THREE.MeshLambertMaterial({ color: 0x59636b });
    wakeMat = new THREE.MeshBasicMaterial({
      color: 0xe2edf2, transparent: true, opacity: 0.28,
      depthWrite: false, side: THREE.DoubleSide,
    });
    // EVERY SHARK IN THE WORLD SHARES THESE FOUR OBJECTS, so the repo's
    // disposal sweeps must be told to keep their hands off: gore.js's rm(),
    // the rig teardowns and the per-group cleaners all skip anything tagged
    // _shared and dispose everything else. Today the proxy survives only
    // because of how it happens to be parented; the first sweep that reaches
    // it would otherwise dispose one shark's fin and blank every other one.
    finGeo._shared = wakeGeo._shared = true;
    finMat._shared = wakeMat._shared = true;
  }
  function makeProxy(a, s) {
    assets();
    const parent = (a.group && a.group.parent) || CBZ.scene;
    if (!parent) return null;
    const sz = Math.max(0.7, (a.species && a.species.scale) || 1) * (s.meg ? 1.5 : 1);
    const root = new THREE.Group();
    root.userData.dynamic = true;                           // batcher/freezer: hands off
    const fin = new THREE.Mesh(finGeo, finMat);
    fin.scale.set(sz, sz * 1.15, sz * 0.55);                // a dorsal is a THIN blade
    fin.rotation.z = 0.2;                                   // raked back
    fin.castShadow = false;
    root.add(fin);
    const arms = [];
    for (let i = 0; i < 2; i++) {
      const arm = new THREE.Group();
      arm.rotation.y = (i ? -1 : 1) * 0.30;
      const q = new THREE.Mesh(wakeGeo, wakeMat);
      q.rotation.x = -Math.PI / 2;                          // lie flat on the water
      q.position.set(-0.5, 0, 0);                           // extends astern
      q.renderOrder = 3;
      arm.add(q);
      root.add(arm);
      arms.push(q);
    }
    parent.add(root);
    s.root = root; s.fin = fin; s.arms = arms; s.sz = sz;
    s.finH = 1.2 * sz * 1.15;
    return root;
  }

  // The proxy is driven from the actor's LIVE transform every frame no matter
  // who moved it — that is what keeps it independent of the body's LOD.
  function proxy(a, s, dist, dt) {
    const grp = a.group; if (!grp) return;
    const t = clock();
    const surf = surfaceAt(grp.position.x, grp.position.z, t);
    const dep = surf - grp.position.y;
    if (!s.owned) s.dive = dep;                           // resync while wildlife drives it
    // speed for the wake, from real displacement (no per-frame allocation)
    const dx = s.px == null ? 0 : grp.position.x - s.px;
    const dz = s.pz == null ? 0 : grp.position.z - s.pz;
    s.px = grp.position.x; s.pz = grp.position.z;
    const spd = dt > 0 ? Math.sqrt(dx * dx + dz * dz) / dt : 0;
    s.spd += (spd - s.spd) * Math.min(1, dt * 4);

    const shallow = dep < (a.swimDepth || 2) * 1.4;
    const hidden = s.state === "vanish" || s.state === "disengage";
    const finR = ((s.opts && s.opts.senseR) || SENSE_R) * FIN_F;
    const want = (!a.dead && ON() && shallow && !hidden && dist < finR) ? 1 : 0;
    if (!want && (s.finK <= 0.02)) {                        // fully down: nothing to draw
      if (s.root && s.root.visible) s.root.visible = false;
      s.finK = 0;
      return;
    }
    if (!s.root && !makeProxy(a, s)) return;
    s.finK += (want - s.finK) * Math.min(1, dt * (want ? 1.8 : 3.2));
    const k = s.finK;
    s.root.visible = k > 0.02;
    if (!s.root.visible) return;
    s.root.position.set(grp.position.x, surf + 0.04, grp.position.z);
    s.root.rotation.y = -a.heading;                         // same yaw law as every animal
    // the fin RISES out of the water instead of popping into existence
    s.fin.position.y = s.finH * 0.5 - s.finH * (1 - k);
    // the wake grows with speed and fades with it; it is the only thing telling
    // the player how fast the thing they cannot see is moving.
    const len = (2.2 + Math.min(9, s.spd * 0.85)) * s.sz;
    const wid = (0.35 + Math.min(1.1, s.spd * 0.09)) * s.sz;
    for (let i = 0; i < s.arms.length; i++) {
      const q = s.arms[i];
      q.scale.set(len, wid, 1);
      q.position.x = -len * 0.5;
      q.visible = s.spd > 0.6;
    }
  }

  function dropProxy(a) {
    const s = a && a._shark; if (!s || !s.root) return;
    if (s.root.parent) s.root.parent.remove(s.root);
    s.root = null; s.fin = null; s.arms = null; s.finK = 0;
  }

  // ============================================================
  //  PER-ACTOR STATE — built once, never per frame. Everything predatorHunt
  //  needs is in one frozen opts object whose closures capture this actor.
  // ============================================================
  function ensure(a) {
    if (a._shark) return a._shark;
    const sp = a.species || {};
    const meg = sp.id === "megalodon" || (sp.scale || 1) >= 2.2;
    const s = a._shark = {
      meg: meg,
      baseClear: a.waterClearance || 12,
      dive: a.swimDepth || 2.5, diveWant: (a.swimDepth || 2.5) * DIVE.cruise,
      state: "cruise", owned: false, stuck: 0, bail: 0,
      finK: 0, spd: 0, px: null, pz: null, wedged: 0,
      root: null, fin: null, arms: null, sz: 1, finH: 1,
    };
    // moveInWater writes into a caller-owned scratch object; without one it
    // allocates a fresh result EVERY frame. wildlife.js gives aquatic actors
    // theirs at spawn — this is the belt-and-braces for anything hand-made.
    if (!a._waterMove) a._waterMove = { x: 0, z: 0, heading: 0, blocked: false, shore: -999 };
    const label = String(sp.name || sp.id || "shark").toLowerCase();
    // MEGALODON tunes the same knobs harder: it finds you further out, circles
    // roughly twice as long, sounds far deeper, holds twice as long and is half
    // as escapable. No second code path, just bigger numbers.
    s.opts = {
      senseR: meg ? SENSE_R * 1.45 : SENSE_R,
      chumR: meg ? CHUM_R * 1.5 : CHUM_R,
      circleR: meg ? CIRCLE_R * 1.45 : CIRCLE_R,
      orbitR: meg ? ORBIT_R * 1.45 : ORBIT_R,
      circleT: meg ? CIRCLE_T * 1.7 : CIRCLE_T,
      cruiseSpeed: (sp.spd || 2.5) * 2.4,
      rushSpeed: (sp.spd || 2.5) * (meg ? 7.5 : 8.5),
      bumpDmg: meg ? BUMP_DMG * 1.8 : BUMP_DMG,
      style: "lunge",
      medium: "water",
      reach: 2.2 + (sp.scale || 1) * 1.6,
      rate: meg ? 2.2 : 1.5,
      dmg: sp.bite || 30,
      name: sp.name || "shark",
      canReach: function (t) { return inWater(t); },
      // THE ONE MOVER. predatorHunt drives it directly, and predator.js also
      // forwards it to creature_combat's approach branch (as its opts.move) so
      // the last few metres of a rush go through waterField + the CLEAR table
      // and depth() too — instead of a second, land-shaped mover writing raw
      // x/z/y and walking the shark onto the beach mid-strike.
      move: function (hunter, want, speed, dt) { return swim(hunter, want, speed, dt); },
      onState: function (ns, os) { onState(a, ns, os); },
      // if the driver strikes without a seize (refused, flag off), damage must
      // still go through the wildlife contact bus, never straight onto .hp
      onHit: function (d) {
        if (CBZ.cityAnimalStrikePlayer) { try { CBZ.cityAnimalStrikePlayer(a, d, "lunge"); } catch (e) {} }
      },
      seize: {
        jaw: CBZ.creatureJawPoint ? CBZ.creatureJawPoint(a) : { x: 2, y: 0.7, z: 0 },
        dps: meg ? 34 : 22,
        hold: meg ? HOLD_S * 2 : HOLD_S,
        escape: meg ? ESCAPE_P * 0.5 : ESCAPE_P,
        thrash: 1, medium: "water", style: "shake",
        cause: "mauled by a " + label,
      },
    };
    return s;
  }

  function onState(a, ns) {
    const s = a._shark; if (!s) return;
    s.state = ns || "cruise";
    const d = a.swimDepth || 2.5;
    s.diveWant = d * (DIVE[s.state] != null ? DIVE[s.state] : DIVE.cruise);
    if (s.state === "vanish") s.diveWant = d * (s.meg ? 22 : 9);
    // the gape shuts whenever it is not committed
    if (CBZ.swimJaw && s.state !== "rush" && s.state !== "seize") {
      try { CBZ.swimJaw(a, 0); } catch (e) {}
    }
  }

  // ============================================================
  //  THE LOCOMOTION SEAM — predatorHunt says WHERE, this says HOW. Everything
  //  medium-specific about a shark lives in these forty lines.
  // ============================================================
  function swim(a, want, speed, dt) {
    const s = ensure(a), grp = a.group;
    if (!grp || !dt) return false;
    s.owned = true;
    // a shark turns with its whole body — no instant pivots, ever
    const turn = (s.meg ? TURN_RATE * 0.6 : TURN_RATE) * dt;
    let d = shortest((want == null ? a.heading : want) - a.heading);
    if (d > turn) d = turn; else if (d < -turn) d = -turn;
    a.heading += d;

    const t = clock();
    const clr = Math.max(2.5 + ((a.species && a.species.scale) || 1),
                         s.baseClear * (CLEAR[s.state] != null ? CLEAR[s.state] : 1));
    const wf = CBZ.waterField;
    let moved = true;
    if (wf && wf.moveInWater) {
      const nav = wf.moveInWater(grp.position.x, grp.position.z, a.heading,
                                 Math.max(0, speed || 0) * dt, clr, t, a._waterMove);
      if (nav) {
        a.heading = nav.heading;
        grp.position.x = nav.x; grp.position.z = nav.z;
        moved = !nav.blocked;
        // A HUNTING shark never takes wildlife.js's nearestWater recovery: that
        // is a hard position set, i.e. a visible teleport 10u from the player's
        // face. If it genuinely cannot move it abandons the hunt and swims out
        // under its own power instead.
        s.stuck = nav.blocked ? s.stuck + dt : 0;
        if (s.stuck > STUCK_BAIL) {
          s.stuck = 0; s.bail = 6;
          // Tell the shared driver to let go for six seconds. NOTE THE MISSING
          // ELSE: this used to fall back to `a._hunt = null`, which does not
          // disengage a hunt — it DELETES it, taking the menace gauge and the
          // commit count with it. That is the anti-habituation mechanism, and
          // wiping it here would hand the player a brand-new, un-escalated
          // shark every time one clipped a sandbar. If predator.js is not
          // loaded there is no hunt to end, so the correct fallback is nothing
          // at all; s.bail below already keeps this shark off the player.
          if (CBZ.predatorDisengage) { try { CBZ.predatorDisengage(a, 6); } catch (e) {} }
          onState(a, "disengage");
        }
      }
    } else {
      grp.position.x += Math.cos(a.heading) * speed * dt;
      grp.position.z += Math.sin(a.heading) * speed * dt;
    }
    depth(a, s, dt, t);
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(grp, a.heading);
    return moved;
  }

  // Depth is its own beat: sounding, rising to cut the surface, coming up from
  // below on the rush. Two clamps, and THE ORDER IS THE WHOLE POINT: the
  // submersion clamp (keep the torso under the surface) runs FIRST, the seabed
  // clamp runs LAST, so the bed always wins.
  //
  // It used to be the other way round, which is only invisible in deep water:
  // in ~1.55m of shallows — exactly where the CLEAR table now lets a committed
  // shark hunt — the submersion clamp overrode the bed clamp and pushed a great
  // white ~0.7m INSIDE the sand. When the two cannot both be satisfied (water
  // shallower than the body) the bed wins and the dorsal breaks the surface,
  // which is both correct and the scarier read anyway.
  function depth(a, s, dt, t) {
    const grp = a.group;
    const surf = surfaceAt(grp.position.x, grp.position.z, t);
    s.dive += (s.diveWant - s.dive) * Math.min(1, dt * (s.meg ? 0.85 : 1.3));
    let y = surf - s.dive;
    const sub = (a.swimDepth || 2) * 0.92;
    if (y > surf - sub) y = surf - sub;               // 1. keep the torso under
    const bed = CBZ.floorAt ? CBZ.floorAt(grp.position.x, grp.position.z) : null;
    if (typeof bed === "number" && isFinite(bed)) {
      const lo = bed + ((a.species && a.species.scale) || 1) * 0.9;
      if (y < lo) y = lo;                             // 2. ...but never in the bed
    }
    grp.position.y += (y - grp.position.y) * Math.min(1, dt * 3.5);
  }

  // ============================================================
  //  THE ONE ENTRY POINT — ticked by wildlife.js's aquatic branch.
  //  Returns true when the hunt owned this actor's transform.
  // ============================================================
  function sharkBrain(a, dt, P) {
    if (!ON() || !a || a.dead || a.tamed || a.ridden) return false;
    const sp = a.species;
    if (!sp || !sp.aquatic || (sp.danger || 0) < 0.5) return false;
    const s = ensure(a);
    s.owned = false;
    const grp = a.group;
    const dist = P ? Math.hypot(grp.position.x - P.x, grp.position.z - P.z) : 1e9;

    // a bail (stuck in the shallows) or a kill puts it off the player for a
    // while — escalation needs a gap, and a shark camping you is not scary.
    if (s.bail > 0) {
      s.bail -= dt;
      if (a.state === "stalk" || a.state === "charge") a.state = "wander";
      // It swims ITSELF back out to deep water: moveInWater's shore feelers
      // steer inward once the full clearance is back in force. Handing it to
      // wildlife.js here would run its nearestWater recovery — a hard position
      // set, i.e. a teleport the player would watch happen. Only if it is still
      // wedged after a few seconds do we let that recovery have it.
      const ok = swim(a, a.heading, s.opts.cruiseSpeed * 0.9, dt);
      s.wedged = ok ? 0 : (s.wedged || 0) + dt;
      proxy(a, s, dist, dt);
      if (s.wedged > 3.5) { s.wedged = 0; s.owned = false; return false; }
      return true;
    }

    const hunt = CBZ.predatorHunt;
    const player = CBZ.player;
    if (typeof hunt !== "function" || !P || !player || player.dead) {
      // DEGRADE: no shared driver (or nothing to hunt) — wildlife.js's ordinary
      // wander drives the body, and the fin still cuts the surface near shore.
      s.state = "cruise";
      proxy(a, s, dist, dt);
      return false;
    }

    let st = null;
    try { st = hunt(a, player, dt, s.opts); } catch (e) { st = null; }
    if (!st || st === "cruise") {
      if (s.state !== "cruise") onState(a, "cruise");
      proxy(a, s, dist, dt);
      return false;                                   // the caller wanders as usual
    }
    if (st !== s.state) onState(a, st);

    // MARKERS FOR FREE (belt and braces): the driver is supposed to set
    // a.state itself; if it ever stops doing so, the blip must not silently
    // die — markers.js is the only threat UI and nothing here may duplicate it.
    if (st === "rush" || st === "seize") { if (a.state !== "charge") a.state = "charge"; }
    else if (st === "scent" || st === "circle" || st === "bump") { if (a.state !== "stalk") a.state = "stalk"; }

    // MARKERS FOR FREE: systems/markers.js's cityTargetsPlayer() already lights
    // the HUD, minimap and map from a.state === "stalk"/"charge", which
    // predatorHunt sets. The ONE thing it must not do is keep the blip lit
    // while the shark has vanished — losing the marker IS the scare.
    if (st === "vanish" || st === "disengage") a.state = "wander";

    // SHOWING LESS: the body is crisp only inside ~18% of the sense radius, and
    // during the commit. Everywhere else you get the fin and your imagination.
    const showR = (s.opts.senseR || SENSE_R) * SHOW_F;
    grp.visible = (dist < showR) || st === "rush" || st === "seize";

    proxy(a, s, dist, dt);
    // Engaged means OWNED, even in the frames the driver chooses not to move
    // (the seize holds position; a sounding shark coasts). Handing a committed
    // shark back to the wander for one frame is a visible tug-of-war.
    return true;
  }

  // THE RATCHET. This file has been fully on predatorHunt/predatorSeize since
  // the day it shipped and never said so, which meant the audit undercounted
  // its own single working consumer. An audit that hides its wins is as useless
  // as one that hides its debt. The `else` branch is what actually runs today —
  // wildlife_shark.js loads AFTER predator.js, but the buffer makes the count
  // independent of index.html's ordering either way, so this cannot rot.
  if (typeof CBZ.predatorAdopt === 'function') {
    try { CBZ.predatorAdopt('wildlife_shark:hunt'); } catch (e) {}
  } else {
    try { (CBZ._predatorAdopted = CBZ._predatorAdopted || []).push('wildlife_shark:hunt'); } catch (e) {}
  }

  CBZ.sharkBrain = sharkBrain;
  CBZ.sharkFinDrop = dropProxy;
  // read-only, for tuning probes: what is this shark doing and how deep is it?
  CBZ.sharkState = function (a) {
    const s = a && a._shark;
    return s ? { state: s.state, dive: s.dive, fin: s.finK, spd: s.spd, meg: s.meg } : null;
  };
})();

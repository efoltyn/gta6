/* ============================================================
   entities/towerwatch.js — THE MEN IN THE TOWERS.

   OWNER: "nobody comes down from those towers right now. There's a few
   people, maybe even with guns, maybe with more armor."

   WHAT WAS THERE: eight glazed towers on the wall with nobody in them. The
   rifle fire that came off them on the wire (systems/capture.js) was a
   tracer drawn from a hard-coded point in the cabin, from whichever tower
   was nearest, forever, whatever you had done to it.

   WHAT IS THERE NOW: one post officer per wall tower (world/prisonkit.js
   CBZ.prisonTowers), a real guard in CBZ.guards like every other screw
   (shootable, knock-outable, lootable, he hears and sees), but kitted for
   the post: the M4 carbine and a plate carrier and ballistic helmet (city/
   armor.js's kit — a body round mostly stops in the plate, a head shot
   bounces off the helmet; systems/fpsmode.js drains it).
     · ON POST he stands forward in the cabin on the yard glass, scanning
       the compound. He sees much further than a yard screw.
     · HE COMES DOWN. At the change of shift (the morning unlock) every post
       comes down the ladder, stands roll at the foot and goes back up; at
       chow and supper half the towers come down to eat by turns; when the
       wing is locked down and you are loose near his foot, he climbs down
       and runs you down himself. All of it on the real ladder
       (systems/climb.js), rung by rung, rifle slung for the climb.
     · HE HOLDS HIS DECK. Climb his ladder while he is up there and he walks
       out to the hatch, tells you once, and puts his boot in your face: you
       fall. Come up while he is down at chow, or put him down first.
     · HE FIGHTS FROM IT. Shoot at him and he shoots back from the glass;
       get onto his deck and it is a fight (the ordinary guard brain, which
       takes over the moment you are up there with him).
     · THE WIRE FIRE IS HIS. capture.js's kill-zone volley now comes from
       the man on the nearest MANNED post in range, off his rifle's muzzle.
       A tower with nobody in it (dead, out cold, down at chow) is silent.
   Take his rifle: it drops where he does (systems/prisondrops.js, the
   "Rifle" on a tower post's belt) and it is an M4 on your rail. His belt
   also carries the Corridor Key, which is what locks his tower's door.

   THE TOWER ITSELF (2026-09-29, world/prisonkit.js section 5):
     · THE HATCH in the cab floor swings up while somebody is on the top of
       the ladder and drops shut after him.
     · OVER THE RAIL. The catwalk hangs out over the wall and its rail is a
       rail: you can vault it. What is on the other side is twelve metres of
       air and the ground (systems/capture.js CBZ.prisonFallLand: broken
       legs, a count on the ground, a hobble for the rest of the run). Land
       outside the compound you were in and it is an ESCAPE: if the man on
       that post is up and awake he watched you go (the lockdown, the beams
       on you, his rifle and the next tower's), if not the landing is still
       heard. Land outside the OUTER wire and get clear of it and you are
       out (world/escape_routes.js, "over the wall").
     · THE SMART WAY DOWN. A Bedsheet Rope tied to the rail (E at the rail)
       is a line you climb down (systems/climb.js), quietly, on your hands:
       no fall, no noise. It stays tied there for anyone to see.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  // Built when the prison is first needed, as if at this script's parse
  // point (core/prisonlazy.js). Body left at its old indent.
  CBZ.definePrison("entities/towerwatch.js", function () {
  if (!CBZ || !CBZ.spawnGuard || !CBZ.prisonTowers) return;
  const player = CBZ.player;
  const PI = Math.PI;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function h2(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

  const LINES = {
    ladder: ["Off my ladder.", "Get down. Now.", "Not one more rung."],
    shot: ["Shots fired!", "Contact, yard side!"],
    talk: ["Twelve hours up a pole.", "Nobody comes up here.", "Back off my tower."],
    over: ["Man over the wall!", "Jumper! Over the side!", "He's over! Hit the alarm!"],
  };
  function say(g, list, secs) {
    if (!CBZ.prisonSay) return;
    try { CBZ.prisonSay(g, list[(Math.random() * list.length) | 0], { secs: secs || 1.8, force: true }); } catch (e) {}
  }

  /* ---- the posts ---------------------------------------------------------- */
  const POSTS = [];
  const TW = CBZ.prisonTowers;
  const towers = TW.filter(function (t) { return (t.manned || t.registered) && t.post && t.foot; });
  towers.forEach(function (T, i) {
    const g = CBZ.spawnGuard([[T.foot.x, T.foot.z]], 3.0, 42, 0.78, { post: "tower", rank: 2 });
    if (!g) return;
    g.armed = true; g.weapon = "Rifle";
    g.flashlightPatrol = false;
    g.data.talk = LINES.talk.slice();
    // where he stands at roll: out of his shaft's door, a few metres off it
    const sd = T.shaftDoor || T.foot, ox = sd.x - T.x, oz = sd.z - T.z, ol = Math.hypot(ox, oz) || 1;
    const P = {
      g: g, T: T, i: i, state: "post", t: 0,
      spot: { x: sd.x + ox / ol * 5, z: sd.z + oz / ol * 5 },
      breakFor: 0, hp: null, provokedT: 0, engageT: 0, fireCD: 0, warnT: 0, warned: false,
      scan: i * 1.7, dressed: false,
    };
    g.towerPost = P;
    POSTS.push(P);
    toPost(P);
  });

  function toPost(P) {
    const g = P.g, T = P.T;
    g.group.position.set(T.post.x, T.floor, T.post.z);
    g.group.rotation.set(0, T.post.yaw, 0);
    P.state = "post"; P.t = 0; P.breakFor = 0;
    if (CBZ.moves && CBZ.moves.reset) { try { CBZ.moves.reset(CBZ.moves.motor(g), g.group.position); } catch (e) {} }
  }
  function deckR(T) { return T.deckR || 3.4; }
  function onDeck(P) {
    const p = P.g.group.position, T = P.T;
    return p.y > T.floor - 0.6 && h2(p.x, p.z, T.x, T.z) < deckR(T);
  }
  function inCabin(P, x, z) { return h2(x, z, P.T.x, P.T.z) < 1.9; }
  function playerOnDeck(T) { return player.pos.y > T.floor - 0.6 && player.pos.y < T.floor + 3 && h2(player.pos.x, player.pos.z, T.x, T.z) < deckR(T) + 0.1; }

  // the kit for the post: the carbine in the hands, the plate and the helmet
  function dress(P) {
    if (P.dressed) return;
    const g = P.g;
    if (CBZ.cityArmorDressPed) { try { CBZ.cityArmorDressPed(g, ["plateCarrier", "helmet"]); P.dressed = true; } catch (e) {} }
    if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(g); } catch (e) {} }
  }

  /* ---- walking about the deck: through the cabin door, never the glass ---- */
  function deckGo(P, tx, tz, sp, dt, stop) {
    const g = P.g, p = g.group.position, T = P.T, D = T.door;
    let x = tx, z = tz;
    if (D) {
      const meIn = inCabin(P, p.x, p.z), itIn = inCabin(P, tx, tz);
      if (meIn !== itIn) {
        const din = h2(p.x, p.z, D.in.x, D.in.z), dout = h2(p.x, p.z, D.x, D.z);
        if (meIn) { if (din > 0.45) { x = D.in.x; z = D.in.z; } else { x = D.x; z = D.z; } }
        else { if (dout > 0.45 && din > 0.9) { x = D.x; z = D.z; } else { x = D.in.x; z = D.in.z; } }
      }
    }
    const d = CBZ.guardWalkTo(g, x, z, sp, dt, x === tx && z === tz ? (stop || 0.3) : 0.2, false, T.floor);
    return x === tx && z === tz ? d : 9;
  }
  function goHome(P, dt) {
    const g = P.g, T = P.T;
    if (onDeck(P)) {
      const d = deckGo(P, T.post.x, T.post.z, 1.6, dt, 0.25);
      if (d < 0.35) { P.state = "post"; P.t = 0; }
      return;
    }
    // on the ground: the nav link walks him to the foot and up
    CBZ.guardWalkTo(g, T.post.x, T.post.z, 3.0, dt, 0.3, false, T.floor);
  }

  /* ---- his rifle from the glass ------------------------------------------ */
  const _m = new THREE.Vector3();
  function aimUp(P, dt) {
    const g = P.g;
    CBZ.guardFaceTo(g, player.pos.x, player.pos.z, 0.0001, dt);
    CBZ.guardStand(g, dt);
    if (CBZ.actorReadyPose) { try { CBZ.actorReadyPose(g, dt); } catch (e) {} }
  }
  function fireAt(P) {
    const g = P.g, pp = player.pos;
    let from = { x: g.group.position.x, y: g.group.position.y + 1.45, z: g.group.position.z };
    if (CBZ.actorMuzzle) { try { const m = CBZ.actorMuzzle(g, _m); if (m && isFinite(m.x)) from = { x: m.x, y: m.y, z: m.z }; } catch (e) {} }
    const d = h2(from.x, from.z, pp.x, pp.z);
    const hitP = clamp(0.75 - d / 90 - (player.crouch ? 0.15 : 0) - (Math.hypot(player.speed || 0) > 3 ? 0.2 : 0), 0.12, 0.8);
    const hit = Math.random() < hitP;
    if (CBZ.tracer) {
      try {
        CBZ.tracer(from, { x: pp.x + (hit ? 0 : (Math.random() - 0.5) * 2.4), y: pp.y + (hit ? 1.2 : 0.2 + Math.random()), z: pp.z + (hit ? 0 : (Math.random() - 0.5) * 2.4) },
          { color: 0xfff2b0, life: 0.09, muzzleScale: 1.4 });
      } catch (e) {}
    }
    if (CBZ.sfx) { try { CBZ.sfx("shoot_carbine", { dist: d, ghost: true }); } catch (e) {} }
    if (hit && CBZ.hurtPlayer) { try { CBZ.hurtPlayer(24, g.group.position.x, g.group.position.z, { weapon: "gun", shake: 0.6, stun: 0.2, by: g }); } catch (e) {} }
    const PB = CBZ.prisonBrain;
    if (PB && PB.noise) { try { PB.noise(g.group.position.x, g.group.position.z, 60, "gunshot", g); } catch (e) {} }
  }

  /* ---- the change of shift, chow, supper --------------------------------- */
  let lastBlock = null;
  function scheduleTick() {
    const S = CBZ.prisonSchedule;
    let id = null;
    try { id = S && S.enabled && S.enabled() ? S.id() : null; } catch (e) { id = null; }
    if (id === lastBlock) return;
    const prev = lastBlock;
    lastBlock = id;
    if (prev == null || !id) return;                 // the first read is not a change
    for (let i = 0; i < POSTS.length; i++) {
      const P = POSTS[i];
      let go = 0;
      if (id === "wake") go = 10;                      // the change of shift: everyone, roll at the foot
      else if (id === "mess" && P.i % 2 === 0) go = 26;
      else if (id === "supper" && P.i % 2 === 1) go = 26;
      if (go) { P.pendingBreak = go; P.pendingDelay = P.i * 3.5 + Math.random() * 2; }
    }
  }

  /* ---- THE OWNERSHIP TEST: guards.js asks it before its own brain runs ---- */
  function owns(g, dt) {
    const P = g && g.towerPost;
    if (!P || !CBZ.game || CBZ.game.mode !== "escape") return false;
    dress(P);
    // his rifle is on the floor with him, not still in his hand
    if (g.dead) {
      if (g._weaponProp) g._weaponProp.visible = false;
      g.armed = false;
      return false;
    }
    // hit: he knows where it came from
    if (P.hp == null) P.hp = g.hp == null ? 100 : g.hp;
    const hp = g.hp == null ? 100 : g.hp;
    if (hp < P.hp - 0.5) { P.provokedT = 25; if (Math.random() < 0.5) say(g, LINES.shot, 1.4); }
    P.hp = hp;
    if (P.provokedT > 0) P.provokedT -= dt;
    if (P.engageT > 0) P.engageT -= dt;
    if (g.ko > 0 || g._escort || g.intimidMode === "scared" || g.approach || g.tied || g.asleep || g.pause > 0) return false;

    const T = P.T, up = onDeck(P);
    const pDeck = playerOnDeck(T);
    // YOU ARE ON HIS DECK: the ordinary guard brain has the fight
    if (up && pDeck) {
      const sees = CBZ.guardSees ? CBZ.guardSees(g) : true;
      if (sees || h2(player.pos.x, player.pos.z, g.group.position.x, g.group.position.z) < 2.4 || P.provokedT > 0) {
        g.hunt = Math.max(g.hunt || 0, 5); g.alert = 1;
      }
      if ((g.hunt || 0) > 0) return false;
    }
    // a lockdown, and you loose near his foot on the ground: he comes down
    const lock = !!(CBZ.lockdownActive && CBZ.lockdownActive());
    const nearFoot = player.pos.y < 1.5 && h2(player.pos.x, player.pos.z, T.foot.x, T.foot.z) < 32;
    if (up && lock && nearFoot && !player.dead && (CBZ.guardSees ? CBZ.guardSees(g) : true)) {
      g.hunt = Math.max(g.hunt || 0, 8); g.alert = 1;
    }
    // down on the ground (at chow, at roll, walking back) he is a screw like
    // any other: a wanted man in front of him gets run down
    if (!up && !player.dead && ((CBZ.game.detection || 0) > 25 || P.provokedT > 0) && CBZ.guardSees && CBZ.guardSees(g)) {
      g.hunt = Math.max(g.hunt || 0, 4); g.alert = 1;
    }
    const busy = (g.hunt || 0) > 0 || (g.investigate && g.investigate.t > 0) || g._yardCase || g._doorCase || (g.warnT != null && g.warnT > 0);
    if (busy) {
      // up on the post he does not run down for every noise in the yard: a
      // hunt that is not his (you are nowhere near his foot) is watched, not run
      if (up && !pDeck && !(lock && nearFoot) && !(P.provokedT > 0 && nearFoot)) {
        g.hunt = 0; g.investigate = null; g._chase = null;
      } else return false;
    }

    P.t += dt;
    scheduleTick();
    g.group.visible = h2(player.pos.x, player.pos.z, g.group.position.x, g.group.position.z) < 160;

    // SOMEONE ON HIS LADDER
    const cl = CBZ.climb && CBZ.climb.climbing(player);
    if (up && cl && T.ladder && cl.L === T.ladder && P.state !== "stomp" && P.state !== "down" && P.state !== "break") {
      P.state = "stomp"; P.t = 0; P.warned = false; P.warnT = 0;
    }
    if (P.pendingBreak && (P.pendingDelay -= dt) <= 0 && up && P.state === "post") {
      P.breakFor = P.pendingBreak; P.pendingBreak = 0; P.state = "down"; P.t = 0;
    }

    switch (P.state) {
      case "stomp": {
        const H = T.head;
        const onL = CBZ.climb && CBZ.climb.climbing(player);
        if (!up || !onL || onL.L !== T.ladder) { P.state = up ? "home" : "home"; break; }
        const d = deckGo(P, H.x, H.z, 2.2, dt, 0.2);
        if (d < 0.5 && T.ladder) {
          CBZ.guardFaceTo(g, T.ladder.x, T.ladder.z, 0.0001, dt);
          CBZ.guardStand(g, dt);
          const near = onL.s > T.ladder.sTop - 2.4;
          if (near && !P.warned) { P.warned = true; P.warnT = 0; say(g, LINES.ladder, 1.6); }
          if (P.warned) P.warnT += dt;
          if (near && P.warned && P.warnT > 1.3) {
            if (CBZ.sfx) { try { CBZ.sfx("punch"); } catch (e) {} }
            if (CBZ.shake) CBZ.shake(0.7);
            CBZ.climb.knockOff(player, T.ladder.nx, T.ladder.nz);
            P.state = "home"; P.t = 0;
          }
        }
        break;
      }
      case "down": {
        // off the post: to the hatch in the cab floor (through the cab door
        // if he is out on the catwalk), down the ladder inside the shaft, out
        // of its door to where he stands
        if (up) {
          const H = T.head;
          if (h2(g.group.position.x, g.group.position.z, H.x, H.z) > 0.6) { deckGo(P, H.x, H.z, 1.8, dt, 0.2); break; }
        }
        const d = CBZ.guardWalkTo(g, P.spot.x, P.spot.z, 2.6, dt, 0.6);
        if (!up && d < 1.2) { P.state = "break"; P.t = 0; }
        if (P.t > 60) { P.state = "home"; P.t = 0; }
        break;
      }
      case "break": {
        // stood at the foot: roll, a smoke, a tray from the kitchen
        CBZ.guardFaceTo(g, T.x, T.z, 0.01, dt);
        CBZ.guardStand(g, dt);
        if (P.t > P.breakFor) { P.state = "home"; P.t = 0; }
        break;
      }
      case "home": {
        goHome(P, dt);
        if (P.t > 90) toPost(P);                       // a body that cannot get home is put back
        break;
      }
      default: {
        if (!up) { P.state = "home"; P.t = 0; goHome(P, dt); break; }
        const at = h2(g.group.position.x, g.group.position.z, T.post.x, T.post.z);
        if (at > 0.5) { deckGo(P, T.post.x, T.post.z, 1.4, dt, 0.25); break; }
        // SHOT AT: he answers from the glass
        const sees = CBZ.guardSees ? CBZ.guardSees(g) : false;
        if ((P.provokedT > 0 || P.engageT > 0) && !player.dead) {
          aimUp(P, dt);
          if (P.provokedT > 0 && sees && P.engageT <= 0) {
            P.fireCD -= dt;
            if (P.fireCD <= 0) { P.fireCD = 1.25 + Math.random() * 0.6; fireAt(P); }
          }
          break;
        }
        // the slow look round the compound from the yard glass
        P.scan += dt * 0.22;
        const yaw = T.post.yaw + Math.sin(P.scan) * 0.95;
        CBZ.guardFaceTo(g, T.post.x + Math.sin(yaw) * 6, T.post.z + Math.cos(yaw) * 6, 0.01, dt);
        CBZ.guardStand(g, dt);
        if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(g); } catch (e) {} }
      }
    }
    if (CBZ.updateGuardFlashlight) { try { CBZ.updateGuardFlashlight(g, dt); } catch (e) {} }
    g.state = "tower";
    return true;
  }

  /* ================================================================
     THE TOWER ITSELF: the hatch, the rope, the drop
     ================================================================ */
  const clock = function () { return (CBZ.game && CBZ.game.elapsed) || 0; };
  function onTowerDeck(T, x, y, z) { return y > T.floor - 0.6 && y < T.floor + 3 && h2(x, z, T.x, T.z) < deckR(T) + 0.2; }
  function postOf(T) { for (let i = 0; i < POSTS.length; i++) if (POSTS[i].T === T) return POSTS[i]; return null; }
  function railOf(T, x, z) {
    // the catwalk flat (x, z) faces and how far in from its rail it stands
    const a = Math.round(Math.atan2(z - T.z, x - T.x) / (PI / 4)) * (PI / 4);
    const nx = Math.cos(a), nz = Math.sin(a);
    const rail = (deckR(T) - 0.12) * Math.cos(PI / 8);
    return { nx: nx, nz: nz, rail: rail, d: rail - ((x - T.x) * nx + (z - T.z) * nz) };
  }

  /* ---- THE HATCH: up while somebody is at the top of the ladder ---------- */
  const _q = new THREE.Quaternion();
  function hatchTick(dt) {
    for (let i = 0; i < TW.length; i++) {
      const T = TW[i], H = T.hatch, L = T.ladder;
      if (!H || !L) continue;
      let want = 0;
      const c = L.climber;
      if (c) {
        const y = c.isPlayer ? player.pos.y : (c.group ? c.group.position.y : (c.pos ? c.pos.y : 0));
        if (y > T.floor - 3.2) want = 1;
      }
      if (H.open === want) continue;
      H.open += (want - H.open) * Math.min(1, dt * 7);
      if (Math.abs(want - H.open) < 0.01) H.open = want;
      _q.setFromAxisAngle(H.axis, H.sign * H.open * 1.75);          // a hundred degrees, back against its stop
      H.pivot.quaternion.copy(_q);
      H.hole.visible = H.open > 0.05;
      if (want !== H.was) {
        H.was = want;
        if (CBZ.worldSfx) { try { CBZ.worldSfx(want ? "door_open" : "door_close", H.x, H.z, { ref: 8 }); } catch (e) {} }
      }
    }
  }

  /* ---- THE ROPE: a Bedsheet Rope tied off on the rail -------------------- */
  const ROPE_MAT = new THREE.MeshLambertMaterial({ color: 0xd8d4c8 });
  let ropeArm = null;
  function econ() { return CBZ.econ || null; }
  function tieRope() {
    const A = ropeArm;
    if (!A || A.T.rope) return false;
    const E = econ();
    if (!E || !E.takeItem || !E.takeItem("Bedsheet Rope")) return false;
    const T = A.T, R = A.r;
    // it hangs from the top rail just outside the posts, to whatever is below
    const hx = T.x + R.nx * (R.rail + 0.1), hz = T.z + R.nz * (R.rail + 0.1);
    const top = T.floor + 1.07, y0 = CBZ.groundAt ? CBZ.groundAt(hx, hz, 0.5) : 0;
    const len = top - y0;
    const grp = new THREE.Group();
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, len, 6), ROPE_MAT);
    line.position.set(hx, y0 + len / 2, hz);
    grp.add(line);
    // the knots a man climbs it by, one every sixty centimetres
    const knot = new THREE.SphereGeometry(0.06, 7, 5);
    for (let y = y0 + 0.6; y < top - 0.3; y += 0.6) {
      const k = new THREE.Mesh(knot, ROPE_MAT); k.position.set(hx, y, hz); k.scale.set(1, 0.7, 1); grp.add(k);
    }
    // the hitch round the top rail and a tail over the mid rail
    const hitch = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.03, 5, 10), ROPE_MAT);
    hitch.position.set(T.x + R.nx * R.rail, top, T.z + R.nz * R.rail);
    hitch.rotation.y = Math.atan2(R.nx, R.nz); grp.add(hitch);
    grp.traverse(function (o) { o.userData.mover = true; o.castShadow = true; });
    (CBZ.prisonRoot || CBZ.scene).add(grp);
    const meta = { rope: true, T: T };
    const L = CBZ.climb ? CBZ.climb.add({
      x: hx, z: hz, nx: R.nx, nz: R.nz, y0: y0, y1: T.floor, r0: 0.6, rung: 0.3, stand: 0.42,
      top: { x: T.x + R.nx * (R.rail - 0.55), z: T.z + R.nz * (R.rail - 0.55) },
      bottom: { x: hx + R.nx * 0.8, z: hz + R.nz * 0.8 },
      name: "rope", tag: "prison-rope", mode: "escape", meta: meta,
    }) : null;
    T.rope = { mesh: grp, L: L };
    if (CBZ.sfx) { try { CBZ.sfx("loot"); } catch (e) {} }
    return true;
  }
  CBZ.towerTieRope = tieRope;                     // the verb's act (@towerTieRope)
  function ropeIdle() {
    ropeArm = null;
    const E = econ();
    if (!E || !E.hasItem || !E.hasItem("Bedsheet Rope") || !CBZ.prisonPrompt) return;
    if (CBZ.climb && CBZ.climb.climbing(player)) return;
    const p = player.pos;
    for (let i = 0; i < TW.length; i++) {
      const T = TW[i];
      if (T.rope || !onTowerDeck(T, p.x, p.y, p.z)) continue;
      const r = railOf(T, p.x, p.z);
      if (r.d > 0.85) return;                     // walk up to the rail to tie off on it
      ropeArm = { T: T, r: r };
      CBZ.prisonPrompt("tower-rope", "@towerTieRope", "Tie rope",
        { at: { x: T.x + r.nx * r.rail, y: T.floor + 1.1, z: T.z + r.nz * r.rail }, d2: r.d * r.d, bind: true, key: "e" });
      return;
    }
  }
  function clearRopes() {
    for (let i = 0; i < TW.length; i++) {
      const T = TW[i];
      if (!T.rope) continue;
      if (T.rope.mesh && T.rope.mesh.parent) T.rope.mesh.parent.remove(T.rope.mesh);
      if (T.rope.L && CBZ.climb) CBZ.climb.remove(T.rope.L);
      T.rope = null;
    }
  }

  /* ---- THE DROP: off a catwalk, or down the rope, and where you landed ---- */
  const DROP = { up: false, T: null, t: 0, via: "jump" };
  let lastDrop = null;
  const OLD = [];                                 // the old compound: the rects inside the division walls
  (function () {
    const W = CBZ.WORLD || {};
    ["northYard", "southBlock", "cellBlock", "adminWing"].forEach(function (k) { if (W[k]) OLD.push(W[k]); });
  })();
  function inOld(x, z) {
    for (let i = 0; i < OLD.length; i++) { const r = OLD[i]; if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return true; }
    return false;
  }
  function outside(x, z) { return !!(CBZ.prisonOutOfBounds && CBZ.prisonOutOfBounds(x, z)); }
  function aimBeams(x, z, secs) {
    const list = CBZ.searchlights || [];
    const byD = list.filter(function (sl) { return sl && sl.gx != null; })
      .sort(function (a, b) { return h2(a.gx, a.gz, x, z) - h2(b.gx, b.gz, x, z); }).slice(0, 2);
    for (let i = 0; i < byD.length; i++) {
      const sl = byD[i];
      if (sl._outroAim) continue;
      sl.aimAt = { x: x, z: z }; sl._dropAimT = secs;
    }
  }
  function beamTick(dt) {
    const list = CBZ.searchlights || [];
    for (let i = 0; i < list.length; i++) {
      const sl = list[i];
      if (!sl || !(sl._dropAimT > 0)) continue;
      sl._dropAimT -= dt;
      if (sl.aimAt && !sl._outroAim) { sl.aimAt.x += (player.pos.x - sl.aimAt.x) * Math.min(1, dt * 1.5); sl.aimAt.z += (player.pos.z - sl.aimAt.z) * Math.min(1, dt * 1.5); }
      if (sl._dropAimT <= 0 && !sl._outroAim) { sl.aimAt = null; sl._dropAimT = 0; }
    }
  }
  function landed(T, via) {
    const p = player.pos;
    const out = outside(p.x, p.z);
    // over the wall: out of the prison, or out of the old compound into the ring
    const over = out || (inOld(T.x, T.z) && !inOld(p.x, p.z));
    const P = postOf(T);
    const g = P && P.g;
    const watched = !!(g && !g.dead && !(g.ko > 0) && !g.tied && !g.asleep && onDeck(P));
    lastDrop = { t: clock(), x: p.x, z: p.z, over: over, outside: out, via: via, watched: watched, tower: TW.indexOf(T) };
    if (!over && !watched) return;
    if (CBZ.prisonOffense) { try { CBZ.prisonOffense("escape", { severity: over ? 4 : 2 }); } catch (e) {} }
    if (CBZ.reportCrime) { try { CBZ.reportCrime(over ? 50 : 25, { type: "escape" }); } catch (e) {} }
    if (!watched) return;                         // nobody on that post: the prison has only the noise to go on
    say(g, LINES.over, 2.2);
    P.provokedT = Math.max(P.provokedT, 20);
    if (CBZ.addHeat) { try { CBZ.addHeat(over ? 60 : 30); } catch (e) {} }
    if (over && CBZ.lockdown && CBZ.lockdown.begin) { try { CBZ.lockdown.begin("escape"); } catch (e) {} }
    if (CBZ.worldSfx) { try { CBZ.worldSfx("lockdown", T.x, T.z, { ref: 45, volume: 0.9, gap: 2 }); } catch (e) {} }
    aimBeams(p.x, p.z, 16);
    // the next posts along the wire hear the call and look
    for (let i = 0; i < POSTS.length; i++) {
      const Q = POSTS[i];
      if (Q === P || Q.g.dead || !onDeck(Q) || h2(Q.T.x, Q.T.z, p.x, p.z) > 95) continue;
      Q.engageT = Math.max(Q.engageT, 6);
    }
  }
  function dropTick() {
    const p = player.pos;
    const cl = CBZ.climb && CBZ.climb.climbing(player);
    if (cl && cl.L && cl.L.meta && cl.L.meta.rope) { DROP.up = true; DROP.T = cl.L.meta.T; DROP.t = clock(); DROP.via = "rope"; return; }
    if (cl) { if (DROP.T && cl.L === DROP.T.ladder) DROP.up = false; return; }   // the ladder down the shaft is the way down, not a drop
    for (let i = 0; i < TW.length; i++) {
      if (onTowerDeck(TW[i], p.x, p.y, p.z)) { DROP.up = true; DROP.T = TW[i]; DROP.t = clock(); DROP.via = "jump"; return; }
    }
    if (!DROP.up) return;
    if (clock() - DROP.t > 12) { DROP.up = false; return; }
    if (!player.grounded || p.y > DROP.T.floor - 3) return;
    DROP.up = false;
    landed(DROP.T, DROP.via);
  }

  // a new run: every officer back up his tower, every rope off the rails
  let runWatch = null;
  CBZ.onUpdate(19.9, function (dt) {
    if (!CBZ.game || CBZ.game.mode !== "escape") return;
    if (!runWatch && CBZ.jailBoost) runWatch = CBZ.jailBoost.newRunWatcher(0.5);
    if (runWatch && runWatch()) {
      for (let i = 0; i < POSTS.length; i++) {
        const P = POSTS[i];
        P.provokedT = 0; P.engageT = 0; P.pendingBreak = 0; P.hp = null; P.dressed = false;
        P.g.armed = !P.g.dead; P.g.weapon = "Rifle";
        if (!P.g.dead) toPost(P);
      }
      lastBlock = null;
      clearRopes();
      DROP.up = false; lastDrop = null;
    }
    if (player.dead) return;
    hatchTick(dt || 0);
    ropeIdle();
    dropTick();
    beamTick(dt || 0);
  });

  CBZ.towerWatch = {
    owns: owns,
    posts: POSTS,
    // capture.js's kill zone: the nearest manned post in range, or nobody
    shooter: function (x, z) {
      let best = null, bd = 95;
      for (let i = 0; i < POSTS.length; i++) {
        const P = POSTS[i], g = P.g;
        if (g.dead || g.ko > 0 || g.tied || !onDeck(P) || (CBZ.climb && CBZ.climb.owns(g))) continue;
        const d = h2(x, z, g.group.position.x, g.group.position.z);
        if (d < bd) { bd = d; best = g; }
      }
      return best;
    },
    engage: function (g) { const P = g && g.towerPost; if (P) P.engageT = 0.4; },
    // the last time you came off a tower some other way than its ladder
    lastDrop: function () { return lastDrop; },
    tieRope: tieRope,
    audit: function () {
      return {
        posts: POSTS.map(function (P) { return { state: P.state, up: onDeck(P), dead: !!P.g.dead, armour: P.g._armor || 0 }; }),
        ropes: TW.filter(function (T) { return !!T.rope; }).length,
        hatchesOpen: TW.filter(function (T) { return T.hatch && T.hatch.open > 0.05; }).length,
        lastDrop: lastDrop,
      };
    },
  };
  });
})();

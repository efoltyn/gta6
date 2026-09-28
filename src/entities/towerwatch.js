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
   "Rifle" on a tower post's belt) and it is an M4 on your rail.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.spawnGuard || !CBZ.prisonTowers) return;
  const player = CBZ.player;
  const PI = Math.PI;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function h2(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

  const LINES = {
    ladder: ["Off my ladder.", "Get down. Now.", "Not one more rung."],
    shot: ["Shots fired!", "Contact, yard side!"],
    talk: ["Twelve hours up a pole.", "Nobody comes up here.", "Back off my tower."],
  };
  function say(g, list, secs) {
    if (!CBZ.prisonSay) return;
    try { CBZ.prisonSay(g, list[(Math.random() * list.length) | 0], { secs: secs || 1.8, force: true }); } catch (e) {}
  }

  /* ---- the posts ---------------------------------------------------------- */
  const POSTS = [];
  const towers = CBZ.prisonTowers.filter(function (t) { return t.registered && t.post && t.foot; });
  towers.forEach(function (T, i) {
    const g = CBZ.spawnGuard([[T.foot.x, T.foot.z]], 3.0, 42, 0.78, { post: "tower", rank: 2 });
    if (!g) return;
    g.armed = true; g.weapon = "Rifle";
    g.flashlightPatrol = false;
    g.data.talk = LINES.talk.slice();
    const P = {
      g: g, T: T, i: i, state: "post", t: 0,
      spot: { x: T.foot.x + T.face.x * 9, z: T.foot.z + T.face.z * 9 },
      breakFor: 0, hp: null, provokedT: 0, engageT: 0, fireCD: 0, warnT: 0, warned: false,
      scan: i * 1.7, dressed: false,
    };
    g.towerPost = P;
    POSTS.push(P);
    toPost(P);
  });
  if (!POSTS.length) return;

  function toPost(P) {
    const g = P.g, T = P.T;
    g.group.position.set(T.post.x, T.floor, T.post.z);
    g.group.rotation.set(0, T.post.yaw, 0);
    P.state = "post"; P.t = 0; P.breakFor = 0;
    if (CBZ.moves && CBZ.moves.reset) { try { CBZ.moves.reset(CBZ.moves.motor(g), g.group.position); } catch (e) {} }
  }
  function onDeck(P) {
    const p = P.g.group.position, T = P.T;
    return p.y > T.floor - 0.6 && h2(p.x, p.z, T.x, T.z) < 3.4;
  }
  function inCabin(P, x, z) { return h2(x, z, P.T.x, P.T.z) < 1.9; }
  function playerOnDeck(T) { return player.pos.y > T.floor - 0.6 && h2(player.pos.x, player.pos.z, T.x, T.z) < 3.5; }

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
        // off the post: out of the cabin, down the ladder, to where he stands
        if (up) {
          const H = T.head;
          const inside = inCabin(P, g.group.position.x, g.group.position.z);
          if (inside) { deckGo(P, H.x, H.z, 1.8, dt, 0.2); break; }
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

  // a new run: every officer back up his tower
  let runWatch = null;
  CBZ.onUpdate(19.9, function () {
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
    }
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
    audit: function () {
      return POSTS.map(function (P) { return { state: P.state, up: onDeck(P), dead: !!P.g.dead, armour: P.g._armor || 0 }; });
    },
  };
})();

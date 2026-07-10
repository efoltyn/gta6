/* ============================================================
   city/cinematics.js — authored cinematic scenes with a scripted camera.

   The helicopter prologue proved the grammar: hold the player still, move a
   deliberate camera, let the scene do the talking. This module makes that a
   reusable DIRECTOR (CBZ.cinePlay) plus two authored story beats that ride
   the endless-contract line:

     THE SUMMONS — a mob boss office. Third-person establishing shots push in
       slowly… then CUT to the player's own eyes the instant the boss slams
       the desk. The 3rd→1st switch is the jump-scare instrument.

     THE RIDE — a car waits. The boss tells you to take the FRONT seat.
       Get in front: the camera settles behind the windshield in first
       person, the rear door opens behind you, and the last thing the lens
       does is whip to the silhouette on the back bench. Permadeath: this is
       a scripted execution (imp.fatal) — GAME OVER, the save is gone.
       Slide into the BACK instead and you pass the test: the shooter takes
       the front seat that was meant for you.

   Camera: camera.js yields to CBZ.cineCam at the top of updateCamera.
   Input: physics.js zeroes WASD while CBZ.cineActive() (same overlay gate
   as the full map). The player is holstered for the duration.
   Revert: CBZ.CONFIG.CITY_CINEMATICS = false.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE || !CBZ.game) return;
  const g = CBZ.game;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.CITY_CINEMATICS == null) CFG.CITY_CINEMATICS = true;

  // ---- the scripted camera channel (read by systems/camera.js) ------------
  const cineCam = CBZ.cineCam = {
    active: false,
    x: 0, y: 0, z: 0,        // desired camera position
    lx: 0, ly: 0, lz: 0,     // desired look-at
    snap: false,             // true for one frame after a hard CUT
  };
  CBZ.cineActive = function () { return cineCam.active; };

  // ---- director -------------------------------------------------------------
  const CINE = { playing: null, step: -1, t: 0, ctx: null, prevHolster: null };

  function camTo(shot, ctx) {
    const s = typeof shot === "function" ? shot(ctx) : shot;
    if (!s) return;
    cineCam.x = s.pos.x; cineCam.y = s.pos.y; cineCam.z = s.pos.z;
    cineCam.lx = s.look.x; cineCam.ly = s.look.y; cineCam.lz = s.look.z;
  }

  function stepEnter() {
    const st = CINE.playing[CINE.step];
    if (!st) return endScene(false);
    CINE.t = 0;
    if (st.cut) cineCam.snap = true;
    if (st.cam) camTo(st.cam, CINE.ctx);
    if (st.hideRig != null && CBZ.playerChar) CBZ.playerChar.group.visible = !st.hideRig;
    if (st.enter) { try { st.enter(CINE.ctx); } catch (e) {} }
  }

  function startScene(steps, ctx, onEnd) {
    if (CINE.playing) return false;
    CINE.playing = steps; CINE.ctx = ctx || {}; CINE.step = -1; CINE.onEnd = onEnd || null;
    cineCam.active = true;
    // the scene owns the hands: holster (restored on end) so a jumpy trigger
    // finger can't shoot the boss mid-sentence, and every witness system
    // reads the player as unarmed for the duration.
    CINE.prevHolster = !!g.cityHolstered;
    g.cityHolstered = true;
    if (CBZ.fpsActive && CBZ.fpsActive() && CBZ.setFPS) CBZ.setFPS(false);
    CINE.step = 0; stepEnter();
    return true;
  }

  function endScene(aborted) {
    if (!CINE.playing) return;
    CINE.playing = null; CINE.ctx = null;
    cineCam.active = false;
    g.cityHolstered = CINE.prevHolster;
    if (CBZ.playerChar && !CBZ.player.dead) CBZ.playerChar.group.visible = true;
    if (CBZ.campaignUI && CBZ.campaignUI.clearDialogue) { try { CBZ.campaignUI.clearDialogue(); } catch (e) {} }
    const onEnd = CINE.onEnd; CINE.onEnd = null;
    if (onEnd) { try { onEnd(!!aborted); } catch (e) {} }
  }

  CBZ.cinePlay = startScene;
  CBZ.cineAbort = function () { endScene(true); };

  CBZ.onUpdate(14.5, function (dt) {
    if (!CINE.playing) return;
    // death (any cause) hands the lens straight to death.js's own cinematics
    if (CBZ.player && CBZ.player.dead) { endScene(true); return; }
    if (g.mode !== "city" || g.state !== "playing") { endScene(true); return; }
    const st = CINE.playing[CINE.step];
    if (!st) { endScene(false); return; }
    // SEATED PLAYER: physics (order 10) re-syncs the rig to a standing pose at
    // player.pos every frame — running after it (14.5), we pin the body back
    // into the bench so the exterior shots never show a man standing through
    // the car roof.
    const cx = CINE.ctx;
    if (cx && cx.car && cx.playerSeat && CBZ.playerChar) {
      const w = seatWorld(cx.car, cx.playerSeat);
      CBZ.player.pos.set(w.x, 0, w.z); CBZ.player.vy = 0; CBZ.player.grounded = true; CBZ.player.speed = 0;
      CBZ.playerChar.group.position.set(w.x, -0.62, w.z);
      CBZ.playerChar.group.rotation.y = cx.car.heading;
    }
    CINE.t += dt;
    if (st.cam && st.track) camTo(st.cam, CINE.ctx);   // per-frame tracking shots
    if (st.tick) { try { st.tick(CINE.ctx, CINE.t, dt); } catch (e) {} }
    if (CINE.t >= (st.dur || 2)) { CINE.step++; stepEnter(); }
  });

  // ---- tiny scene-construction kit (self-owned; campaign cleanup can't
  //      tear these down mid-scene) --------------------------------------------
  const S = { props: [], actors: [], zones: [], marker: null };
  const mats = {};
  function mat(color) { return mats[color] || (mats[color] = new THREE.MeshLambertMaterial({ color })); }
  function box(parent, x, y, z, w, h, d, color, ry) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(x, y, z); if (ry) m.rotation.y = ry;
    m.castShadow = true;
    parent.add(m);
    return m;
  }
  function root() { return (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene; }
  function floorY(x, z) { return CBZ.floorAt ? CBZ.floorAt(x, z) : 0; }
  function addProp(grp) {
    grp.userData.dynamic = true;   // farcull: never cull an authored set
    root().add(grp); S.props.push(grp);
    return grp;
  }
  function say(speaker, text) {
    if (CBZ.campaignUI && CBZ.campaignUI.say) { try { CBZ.campaignUI.say(speaker, text); return; } catch (e) {} }
    if (CBZ.flashHint) CBZ.flashHint(speaker + ": " + text, 3);
  }
  function notify(from, body) {
    if (CBZ.campaignUI && CBZ.campaignUI.notify) { try { CBZ.campaignUI.notify("personal", from, body); return; } catch (e) {} }
    if (CBZ.flashHint) CBZ.flashHint(body, 3);
  }
  function spawnActor(name, x, z, opts) {
    opts = opts || {};
    if (!CBZ.cityMakePed) return null;
    let ped = null;
    const rng = (function (s) { return function () { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; })(((x * 13 + z * 7) | 0) & 0x7fffffff);
    try {
      ped = CBZ.cityMakePed(x, z, rng, {
        name, armed: !!opts.armed, weapon: opts.weapon || (opts.armed ? "Pistol" : null),
        aggr: 0.1, archetype: opts.archetype || "professional", job: "cinematic", wealth: 0.8,
      });
    } catch (e) { ped = null; }
    if (!ped) return null;
    root().add(ped.group);
    (CBZ.cityPeds || (CBZ.cityPeds = [])).push(ped);
    ped.state = "idle"; ped.pause = 9999;                 // holds the mark
    ped._cineActor = true;
    ped._campaignAnchor = { x, z };                       // campaign presenter keeps them pinned
    if (opts.face != null && ped.group) ped.group.rotation.y = opts.face;
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped);
    S.actors.push(ped);
    return ped;
  }
  function makeBeacon(x, z, color) {
    const grp = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.12, 8, 28), new THREE.MeshBasicMaterial({ color }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.25;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 26, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32 }));
    beam.position.y = 13;
    grp.add(ring, beam);
    grp.position.set(x, floorY(x, z), z);
    grp.userData.dynamic = true;
    root().add(grp);
    S.marker = grp;
    return grp;
  }
  function clearMarker() { if (S.marker) { root().remove(S.marker); S.marker = null; } }
  function teardown() {
    clearMarker();
    for (const p of S.props) { if (p.parent) p.parent.remove(p); }
    S.props.length = 0;
    for (const a of S.actors) {
      if (!a) continue;
      a._cineActor = false; a._campaignAnchor = null;
      if (a.dead) continue;
      if (a._cineSeated) {
        // they leave with the car: park the rig far off-map and let the ped
        // pool's normal distance recycling reclaim it (campaign pattern —
        // actors are released back to the world, never spliced from cityPeds).
        a.pos.set(a.pos.x, 0, a.pos.z + 4000);
        if (a.group) { a.group.position.copy(a.pos); a.group.visible = false; }
        a._cineSeated = null; a.pause = 9999;
      } else {
        a.pause = 0.2; a.state = "walk";   // walks off like any released extra
      }
    }
    S.actors.length = 0;
    for (const id of S.zones) { try { CBZ.interactions && CBZ.interactions.unregister(id); } catch (e) {} }
    S.zones.length = 0;
    rideCtx = null;
  }

  // ---- persistence: ride the campaign flags (they survive save/load) ------
  function flags() {
    return (g.cityCampaign && g.cityCampaign.flags) || (g._cineFlags = g._cineFlags || {});
  }

  // ---- shared placement -----------------------------------------------------
  function pickAnchor(minD, maxD) {
    const A = CBZ.city && CBZ.city.arena;
    const P = CBZ.player;
    if (!A || !A.lots || !P) return null;
    let best = null, bestScore = -1;
    for (let i = 0; i < A.lots.length; i++) {
      const l = A.lots[i];
      const d = l.building && l.building.door ? l.building.door : null;
      if (!d) continue;
      const dist = Math.hypot(d.x - P.pos.x, d.z - P.pos.z);
      if (dist < minD || dist > maxD) continue;
      const score = CBZ.hash01 ? CBZ.hash01(d.x, d.z, 771) : (i % 97) / 97;
      if (score > bestScore) {
        bestScore = score;
        // push the set OUT from the building along door→street so the desk
        // sits on open ground, not embedded in the facade / shop interior
        let ox = d.x - (l.cx != null ? l.cx : d.x), oz = d.z - (l.cz != null ? l.cz : d.z);
        const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
        best = { x: d.x + ox * 9, z: d.z + oz * 9, fx: -ox, fz: -oz };  // f* = set faces back toward the door
      }
    }
    return best;
  }

  const seatLocal = {           // car-local seat offsets (fwd = +Z at heading 0)
    frontP: { x: -0.42, z: 0.42 },   // front passenger — "the seat that's yours"
    rearP: { x: -0.42, z: -0.78 },
    driver: { x: 0.42, z: 0.42 },
  };
  function seatWorld(car, seat, y) {
    const h = car.heading;
    const fx = Math.sin(h), fz = Math.cos(h);        // car forward
    const rx = Math.cos(h), rz = -Math.sin(h);       // car right
    return {
      x: car.pos.x + rx * seat.x + fx * seat.z,
      y: (y != null ? y : 0),
      z: car.pos.z + rz * seat.x + fz * seat.z,
    };
  }
  function seatRig(ped, car, seat) {                  // "sit" a rig: sink + face forward
    const w = seatWorld(car, seat);
    ped.pos.set(w.x, -0.62, w.z);
    if (ped.group) {
      ped.group.position.set(w.x, -0.62, w.z);
      ped.group.rotation.y = car.heading;
    }
    ped._cineSeated = car;
    // the per-frame hold (onUpdate 14.6) re-sinks the rig here after the ped
    // update has re-grounded it — without this the seated cast pops up
    // through the roof between frames.
    ped._cineSeatAt = { x: w.x, z: w.z };
    ped._cineSeatYaw = car.heading;
  }

  // =================================================================
  //  SCENE 1 — THE SUMMONS (mob boss office)
  // =================================================================
  let officeCtx = null;
  function stageOffice() {
    const anchor = pickAnchor(60, 220) || pickAnchor(20, 400);
    if (!anchor) return false;
    const fy = floorY(anchor.x, anchor.z);
    // the set opens toward the street: local +Z maps onto the door→street
    // direction, so cameras/actors authored in local space stay composed no
    // matter which way the host lot faces.
    const outX = -anchor.fx, outZ = -anchor.fz;
    const yaw = Math.atan2(outX, outZ);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const toWorld = function (lx, y, lz) {
      return { x: anchor.x + cy * lx + sy * lz, y: fy + y, z: anchor.z - sy * lx + cy * lz };
    };
    const grp = new THREE.Group();
    grp.position.set(anchor.x, fy, anchor.z);
    grp.rotation.y = yaw;
    // the office: rug, heavy desk, tall chair, back wall with two lamps
    box(grp, 0, 0.03, 0, 9, 0.06, 7, 0x4a1f24);                    // oxblood rug
    box(grp, 0, 0.55, -1.2, 3.4, 0.16, 1.5, 0x3a2a18);             // desk top
    box(grp, -1.4, 0.26, -1.2, 0.22, 0.52, 1.3, 0x241a10);         // desk legs
    box(grp, 1.4, 0.26, -1.2, 0.22, 0.52, 1.3, 0x241a10);
    box(grp, 0, 0.95, -2.2, 1.0, 1.8, 0.3, 0x1c1410);              // the chair back
    box(grp, 0, 1.7, -3.4, 9, 3.4, 0.3, 0x2a2430);                 // back wall
    box(grp, -3.6, 1.15, -3.1, 0.3, 2.3, 0.3, 0x8a6a30);           // lamp columns
    box(grp, 3.6, 1.15, -3.1, 0.3, 2.3, 0.3, 0x8a6a30);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xffd890 }));
    glow.position.set(-3.6, 2.5, -3.1); grp.add(glow);
    const glow2 = glow.clone(); glow2.position.x = 3.6; grp.add(glow2);
    addProp(grp);

    const bp = toWorld(0, 0, -1.9), gp1 = toWorld(-3.0, 0, 0.6), gp2 = toWorld(3.0, 0, 0.6);
    const boss = spawnActor("Sal Vetti", bp.x, bp.z, { archetype: "boss", face: yaw });
    const g1 = spawnActor("bodyguard", gp1.x, gp1.z, { armed: true, weapon: "SMG", face: yaw });
    const g2 = spawnActor("bodyguard", gp2.x, gp2.z, { armed: true, weapon: "SMG", face: yaw });
    // guns stay in the leather: a drawn SMG on a sidewalk stampedes the whole
    // street through the witness/panic systems before the scene even starts.
    if (CBZ.actorHolster) { if (g1) CBZ.actorHolster(g1, true); if (g2) CBZ.actorHolster(g2, true); }
    const beaconAt = toWorld(0, 0, 3.2);
    makeBeacon(beaconAt.x, beaconAt.z, 0xd9a441);
    officeCtx = { anchor, boss, fy, toWorld, trigger: beaconAt };
    notify("BLOCKED NUMBER", "Sal Vetti is asking for you in person. The gold light marks the room. Come unarmed or don't come.");
    return true;
  }

  function officeSteps(ctx) {
    const P = CBZ.player;
    const W = ctx.toWorld;
    const bossHead = W(0, 2.0, -1.9);
    const playerEyes = function () { return { x: P.pos.x, y: P.pos.y + 2.0, z: P.pos.z }; };
    return [
      { // wide establishing: over the player's shoulder toward the desk
        dur: 2.6,
        cam: { pos: W(4.6, 3.4, 6.4), look: bossHead },
        enter() { say("SAL VETTI", "There he is. The one the phones won't shut up about."); },
      },
      { // slow push-in on the boss (dolly handled by the damped camera)
        dur: 3.2,
        cam: { pos: W(0, 1.9, 2.6), look: bossHead },
        enter() { say("SAL VETTI", "You've been taking work in my city. Contracts move, money moves… and none of it kisses the ring."); },
      },
      { // ---- THE CUT: first person, on the desk slam ----
        dur: 2.2, cut: true, hideRig: true,
        cam() { const e = playerEyes(); return { pos: e, look: bossHead }; },
        enter() {
          if (CBZ.sfx) CBZ.sfx("clank");
          if (CBZ.shake) CBZ.shake(0.55);
          say("SAL VETTI", "LOOK AT ME WHEN I'M TALKING.");
        },
      },
      { // hold in first person while he settles back
        dur: 3.4, hideRig: true, track: true,
        cam() { const e = playerEyes(); return { pos: e, look: bossHead }; },
        enter() { say("SAL VETTI", "Relax. If I wanted you in the harbor you'd be in the harbor. I want you EMPLOYED."); },
      },
      { // pull back out to third person; the offer lands
        dur: 3.6, cut: true, hideRig: false,
        cam: { pos: W(-4.2, 2.6, 4.6), look: W(0, 1.4, 0) },
        enter() { say("SAL VETTI", "There's a car outside. My driver takes you to the meet. Front seat — my guys like the company."); },
      },
      {
        dur: 1.6,
        cam: { pos: W(6.4, 4.4, 7.2), look: bossHead },
        enter() { notify("SAL VETTI", "The car is marked. FRONT seat. Don't keep the driver waiting."); },
      },
    ];
  }

  // =================================================================
  //  SCENE 2 — THE RIDE (front seat kills you; back seat passes the test)
  // =================================================================
  let rideCtx = null;
  function stageRide(nearX, nearZ) {
    if (!CBZ.cityMakeCar) return false;
    // park the car on open ground a short walk away
    const ang = (CBZ.hash01 ? CBZ.hash01(nearX, nearZ, 99) : 0.3) * Math.PI * 2;
    const cx = nearX + Math.cos(ang) * 10, cz = nearZ + Math.sin(ang) * 10;
    const model = CBZ.cityEcon && CBZ.cityEcon.carByName ? (CBZ.cityEcon.carByName("Executive") || null) : null;
    let car = null;
    try { car = CBZ.cityMakeCar(cx, cz, ang + Math.PI / 2, false, model, 0); } catch (e) { car = null; }
    if (!car) return false;
    car.ai = false; car._cineLocked = true;            // scene car: no boost, no traffic brain
    const driver = spawnActor("the driver", cx + 2, cz + 2, { archetype: "professional" });
    if (driver) seatRig(driver, car, seatLocal.driver);
    makeBeacon(car.pos.x, car.pos.z, 0xd9a441);
    rideCtx = { car, driver };

    // the choice IS the interaction: two labeled zones on the same car
    const I = CBZ.interactions;
    if (I && I.registerZone) {
      I.registerZone({
        id: "cine-ride-front", kind: "cine-front", prio: 9, radius: 3.4,
        find(px, pz) {
          if (!rideCtx || CINE.playing) return null;
          const w = seatWorld(rideCtx.car, seatLocal.frontP);
          return Math.hypot(px - w.x, pz - w.z) < 3.4 ? { x: w.x, z: w.z, pos: new THREE.Vector3(w.x, 1, w.z) } : null;
        },
        options: [{ id: "cine-front-e", slot: "e", label: "Take the FRONT seat (as told)", onSelect: () => beginRide("front") }],
      });
      I.registerZone({
        id: "cine-ride-back", kind: "cine-back", prio: 9, radius: 3.4,
        find(px, pz) {
          if (!rideCtx || CINE.playing) return null;
          const w = seatWorld(rideCtx.car, seatLocal.rearP);
          return Math.hypot(px - w.x, pz - w.z) < 2.6 ? { x: w.x, z: w.z, pos: new THREE.Vector3(w.x, 1, w.z) } : null;
        },
        options: [{ id: "cine-back-i", slot: "i", label: "Slide into the BACK seat", onSelect: () => beginRide("back") }],
      });
      S.zones.push("cine-ride-front", "cine-ride-back");
    }
    return true;
  }

  function beginRide(seat) {
    if (!rideCtx || CINE.playing) return;
    const car = rideCtx.car;
    clearMarker();
    const P = CBZ.player;
    // the player takes the chosen bench (rig seated, physics parked)
    const chosen = seat === "front" ? seatLocal.frontP : seatLocal.rearP;
    const w = seatWorld(car, chosen);
    P.pos.set(w.x, 0, w.z); P.vy = 0; P.grounded = true;
    if (CBZ.playerChar) {
      CBZ.playerChar.group.position.set(w.x, -0.62, w.z);
      CBZ.playerChar.group.rotation.y = car.heading;
    }
    if (CBZ.sfx) CBZ.sfx("door");
    startScene(seat === "front" ? rideFrontSteps(car) : rideBackSteps(car), { car, playerSeat: chosen }, function (aborted) {
      if (seat === "back" && !aborted) finishRideSurvived(car);
    });
  }

  function carCamera(car, localX, localY, localZ, lookLocalX, lookLocalY, lookLocalZ) {
    const p = seatWorld(car, { x: localX, z: localZ }, localY);
    const l = seatWorld(car, { x: lookLocalX, z: lookLocalZ }, lookLocalY);
    return { pos: { x: p.x, y: p.y, z: p.z }, look: { x: l.x, y: l.y, z: l.z } };
  }

  function rideFrontSteps(car) {
    return [
      { // exterior: the car sits under the streetlight, engine off
        dur: 2.4,
        cam: () => carCamera(car, 5.4, 2.2, 3.6, 0, 1.0, 0),
        enter() { say("THE DRIVER", "Good. Boss says you follow instructions."); },
      },
      { // CUT inside — first person, front passenger, watching the windshield
        dur: 2.6, cut: true, hideRig: true,
        cam: () => carCamera(car, -0.42, 1.18, 0.42, -0.42, 1.1, 6),
        enter() { say("THE DRIVER", "Sit tight. We're waiting on one more."); },
      },
      { // the rear door. behind you.
        dur: 2.2, hideRig: true,
        cam: () => carCamera(car, -0.42, 1.18, 0.42, -0.42, 1.1, 6),
        enter(ctx) {
          if (CBZ.sfx) CBZ.sfx("door");
          // directly behind YOUR seat — the whole point of the front-seat rule
          const w = seatWorld(car, seatLocal.rearP);
          ctx.shadow = spawnActor("a stranger", w.x, w.z, { archetype: "professional", armed: true });
          if (ctx.shadow) seatRig(ctx.shadow, car, seatLocal.rearP);
        },
      },
      { // the lens whips to the back bench. one beat of understanding.
        dur: 1.15, hideRig: true,
        cam: () => carCamera(car, -0.42, 1.18, 0.42, -0.42, 1.15, -0.78),
        enter() { say("THE DRIVER", "Nothing personal. The front seat is always for the guest."); },
      },
      { // bang.
        dur: 0.9, hideRig: true,
        cam: () => carCamera(car, -0.42, 1.18, 0.42, -0.42, 1.15, -0.78),
        enter() {
          if (CBZ.sfx) CBZ.sfx("shoot_pistol");
          if (CBZ.hitFlash) CBZ.hitFlash();
          if (CBZ.shake) CBZ.shake(0.8);
          const from = seatWorld(car, seatLocal.rearP);
          // scripted execution: imp.fatal rides into death.js → permadeath.
          if (CBZ.cityKillPlayer) CBZ.cityKillPlayer("executed", { fatal: true, headshot: true, fromX: from.x, fromZ: from.z, dmg: 200 });
        },
      },
    ];
  }

  function rideBackSteps(car) {
    return [
      { // exterior; the driver checks the mirror, says nothing
        dur: 2.4,
        cam: () => carCamera(car, 5.4, 2.2, -2.4, 0, 1.0, 0),
        enter() { say("THE DRIVER", "…That's not the seat you were told."); },
      },
      { // CUT: first person from the BACK bench — watching the front seat
        dur: 2.6, cut: true, hideRig: true,
        cam: () => carCamera(car, -0.42, 1.2, -0.78, 0.1, 1.0, 0.9),
      },
      { // the one more they were waiting on takes the FRONT — your seat
        dur: 3.0, hideRig: true,
        cam: () => carCamera(car, -0.42, 1.2, -0.78, -0.42, 1.05, 0.42),
        enter(ctx) {
          if (CBZ.sfx) CBZ.sfx("door");
          const w = seatWorld(car, seatLocal.frontP);
          ctx.shadow = spawnActor("—", w.x, w.z, { archetype: "professional", armed: true });
          if (ctx.shadow) seatRig(ctx.shadow, car, seatLocal.frontP);
          say("THE DRIVER", "Smart. The front seat is for people who don't think about who sits behind them.");
        },
      },
      { // the shooter turns; the muzzle rests on the seat-back. a long beat.
        dur: 2.8, hideRig: true,
        cam: () => carCamera(car, -0.42, 1.2, -0.78, -0.42, 1.15, 0.42),
        enter(ctx) {
          if (ctx.shadow && ctx.shadow.group) ctx.shadow.group.rotation.y = car.heading + Math.PI;
          say("THE SHOOTER", "Boss said if you picked the back, you're hired. If you picked the front… well.");
        },
      },
      { // pull out; you live
        dur: 2.4, cut: true, hideRig: false,
        cam: () => carCamera(car, 6.0, 2.6, -4.2, 0, 1.0, 0),
        enter() { say("THE DRIVER", "Vetti pays for instincts. Get out — the money's already moving."); },
      },
    ];
  }

  function finishRideSurvived(car) {
    const P = CBZ.player;
    const out = seatWorld(car, { x: -2.2, z: -0.78 });
    P.pos.set(out.x, 0, out.z); P.grounded = true; P.vy = 0;
    if (CBZ.playerChar) { CBZ.playerChar.group.position.copy(P.pos); CBZ.playerChar.group.rotation.set(0, car.heading, 0); }
    const pay = 900;
    g.cash = (g.cash || 0) + pay;
    notify("SAL VETTI", "You passed. $" + pay + " for the lesson: seats are loyalty tests. There will be more work.");
    flags().cineRideDone = true;
    if (CBZ.cityWorldCommit) { try { CBZ.cityWorldCommit(); } catch (e) {} }
    // the car leaves with both of them in it
    car._cineLocked = false; car.ai = true;
    car.destX = car.pos.x + Math.sin(car.heading) * 300;
    car.destZ = car.pos.z + Math.cos(car.heading) * 300;
    teardownSoon();
  }
  let teardownT = 0;
  function teardownSoon() { teardownT = 8; }

  // ---- triggers ---------------------------------------------------------------
  let checkT = 0;
  CBZ.onUpdate(14.6, function (dt) {
    if (teardownT > 0) { teardownT -= dt; if (teardownT <= 0) teardown(); }
    // HOLD THE MARKS: scene actors are cast, not simulated — panic, goals and
    // crowd promotion must not walk them off the set (campaign.js does the
    // same for its own casts in presentCampaign).
    for (let i = 0; i < S.actors.length; i++) {
      const a = S.actors[i];
      if (!a || a.dead || !a._cineActor) continue;
      a.pause = 9999; a.state = "idle"; a.rage = null; a.fear = 0; a.flee = null;
      if (a._cineSeated) {
        // the ped update re-grounds rigs to the floor every frame — sink the
        // seated ones back into the bench after it (this runs later at 14.6)
        if (a._cineSeatAt && a.group) {
          a.pos.set(a._cineSeatAt.x, -0.62, a._cineSeatAt.z);
          a.group.position.set(a._cineSeatAt.x, -0.62, a._cineSeatAt.z);
          a.group.rotation.y = a._cineSeatYaw || 0;
        }
        continue;
      }
      const an = a._campaignAnchor;
      if (an && Math.hypot(a.pos.x - an.x, a.pos.z - an.z) > 0.6) {
        a.pos.set(an.x, floorY(an.x, an.z), an.z);
        if (a.group) a.group.position.copy(a.pos);
      }
    }
    if (!CFG.CITY_CINEMATICS || g.mode !== "city" || g.state !== "playing" || CINE.playing) return;
    if (CBZ.player && CBZ.player.dead) return;
    checkT += dt;
    if (checkT < 1) return;
    checkT = 0;
    const f = flags();
    const contracts = (g.cityCampaign && g.cityCampaign.contractNo) | 0;
    const inEndless = !g.cityCampaign || g.cityCampaign.phase === "endless_contracts";
    // 1) office summons: after the second open contract begins
    if (!f.cineOfficeDone && !officeCtx && inEndless && contracts >= 2) {
      stageOffice();
      return;
    }
    // 2) walking into the office starts the scene
    if (officeCtx && !f.cineOfficeDone) {
      const a = officeCtx.anchor, P = CBZ.player;
      if (Math.hypot(P.pos.x - a.x, P.pos.z - a.z) < 3.4) {
        clearMarker();
        startScene(officeSteps(officeCtx), officeCtx, function (aborted) {
          const ctx = officeCtx; officeCtx = null;
          if (aborted) { teardown(); return; }   // died/left mid-scene → summons re-stages later
          f.cineOfficeDone = true;
          if (CBZ.cityWorldCommit) { try { CBZ.cityWorldCommit(); } catch (e) {} }
          if (ctx) stageRide(ctx.anchor.x, ctx.anchor.z + 6);
        });
      }
    }
  });

  // headless probes / debugging: read-only peeks + direct scene entry
  CBZ._cineDebug = {
    office: function () { return officeCtx; },
    ride: function () { return rideCtx; },
    playing: function () { return !!CINE.playing; },
    step: function () { return CINE.step; },
    beginRide: beginRide,
    stageRide: stageRide,
  };

  // mode reset: drop everything (props are transient scene dressing)
  CBZ.onAlways(14.7, function () {
    if (g.mode !== "city" && (S.props.length || S.actors.length)) { endScene(true); teardown(); officeCtx = null; rideCtx = null; }
  });
})();

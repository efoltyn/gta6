/* ============================================================
   city/restrain.js — RESTRAINT + GRAPPLE: the people-handling layer.

   The owner's loop: CUFF someone who's earned it (hands-up at gunpoint,
   knocked down, or ground out of a clinch) → MARCH them down the street
   → STUFF them in your back seat → drive to the precinct desk → HAND
   THEM OVER for a payday. WHY: bounty-hunting is money + show-off — you
   parade a Lv.40 enforcer through downtown in zip ties and the block
   watches. Mid-fight there's a GRAPPLE: clinch a swinging ped, then
   slam them into the pavement, shove them off, or wear their struggle
   down and tie them.

   THE ONE RULE (learned from the big RP frameworks' famous gating bug):
   every option gates on ONE explicit enum —
     ped.restraint = null | { state: "cuffed"|"escorted"|"in_vehicle"
                              |"grappled", by, t, vehicle }
   — never on loose booleans. DOWNED/ko stays orthogonal (hp/ko/stun are
   read, never owned, here).

   Host-authoritative shape: every transition is a small exported
   function (CBZ.cityRestrain.cuff/escort/release/seat/unseat/turnIn/
   grapple) so a net layer can drive the same machine later.

   Registers through CBZ.interactions only — interact.js untouched.
   police.js provides the desk: CBZ.cityPoliceStation() (the intake
   point) + CBZ.cityStationIntake(ped) (walked through the door,
   off-board) + cops skip restrained peds when picking targets.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;
  const I = CBZ.interactions;
  if (!I) return;   // registry is the foundation; without it there is no layer

  // ---- tuning ---------------------------------------------------------------
  const ESCORT_D = 0.9;        // marched one pace ahead of you (derived, never simulated)
  const CLINCH_D = 0.9;        // clinch range — chest to chest
  const WEAR_T = 1.2;          // seconds of clinch before their struggle is broken (tie-able)
  const CAR_REACH = 4.6;       // back-seat stuffing reach
  const STATION_R = 7;         // the desk hand-over zone radius
  const TELEPORT_D = 10;       // escort attach snapped further than this = a teleport → demote

  const restrained = [];       // every ped currently carrying a restraint record

  function nm(p) { return (p && p.name) || "them"; }
  function st(p) { return p && p.restraint ? p.restraint.state : null; }
  function pa() { return CBZ.city && CBZ.city.playerActor; }

  // ---- the cuff look: a steel band on each wrist (bling.js's cuff geometry
  //      precedent), pooled so a night of collars never re-allocates ----------
  const CUFF_GEO = CBZ.boxGeom ? CBZ.boxGeom(0.34, 0.07, 0.34) : new THREE.BoxGeometry(0.34, 0.07, 0.34);
  const CUFF_MAT = CBZ.cmat ? CBZ.cmat(0x8d949e) : new THREE.MeshLambertMaterial({ color: 0x8d949e });
  const cuffPool = [];
  function cuffMesh() {
    const m = cuffPool.pop() || new THREE.Mesh(CUFF_GEO, CUFF_MAT);
    m.visible = true;
    return m;
  }
  function addCuffs(ped) {
    const ch = ped.char; if (!ch || !ch.parts || ped._cuffMeshes) return;
    const out = [];
    for (const k of ["la", "ra"]) {
      const arm = ch.parts[k]; if (!arm) continue;
      const m = cuffMesh();
      m.position.set(0, -0.66, 0);
      arm.add(m); out.push(m);
    }
    ped._cuffMeshes = out;
  }
  function removeCuffs(ped) {
    if (!ped._cuffMeshes) return;
    for (const m of ped._cuffMeshes) { if (m.parent) m.parent.remove(m); cuffPool.push(m); }
    ped._cuffMeshes = null;
  }

  // hands pinned behind the back — applied AFTER the anim pass each frame so
  // animChar's damping can't tug the arms back to idle (the hands-up lesson).
  function cuffPose(ped) {
    const ch = ped.char; if (!ch || !ch.parts) return;
    const la = ch.parts.la, ra = ch.parts.ra;
    if (la) { la.rotation.set(0.55, 0, 0.42); la.position.z = -0.08; }
    if (ra) { ra.rotation.set(0.55, 0, -0.42); ra.position.z = -0.08; }
  }

  // ---- who's actually GOT a charge coming (the desk only pays for real
  //      collars): a rolled bounty, NPC heat the city itself polices, colors,
  //      a rampage, or bodies that follow them around -------------------------
  function isWanted(p) {
    if (!p) return false;
    return (p.bounty | 0) > 0 || (p.npcWanted | 0) >= 1 || (p.npcHeat || 0) > 10
      || !!p.gang || !!p.rampage || !!(p.gstat && (p.gstat.bodies | 0) > 0);
  }
  function bountyFor(p) {
    if ((p.bounty | 0) > 0) return p.bounty | 0;   // paper already on their head
    const lvl = CBZ.cityLevel ? CBZ.cityLevel(p) : 10;
    let pay = 250 + lvl * 18 + (p.npcWanted | 0) * 200;
    if (p.gstat) pay += (p.gstat.bodies | 0) * 120;
    if (p.rampage) pay += 600;
    return Math.round(pay);
  }

  // a clinch only works empty-handed or with a one-hand gun — you can't wrap
  // someone up around a rifle.
  const ONE_HAND = { Pistol: 1, "Desert Eagle": 1, Revolver: 1, Taser: 1 };
  function canClinch(ctx) {
    if (!ctx.gunDrawn) return true;
    const n = CBZ.cityCurrentWeaponName ? CBZ.cityCurrentWeaponName() : "";
    return !!ONE_HAND[n];
  }
  function fightingYou(p) {
    return !p.dead && (p.rage === pa() || p.state === "fight");
  }
  // a body that's stopped resisting: hands already up, knocked down, stunned,
  // guard broken, or your gunpoint hostage. Earned — never free on a walker.
  function subdued(p) {
    return p.surrender || p.poseHandsUp || (p.char && p.char.handsUp)
      || (p.ko || 0) > 0 || (p.stun || 0) > 0 || (p._broken || 0) > 0
      || p === g.cityHostage;
  }
  function cuffablePed(p) {
    return p && !p.dead && !p.vendor && p.kind !== "cop" && !p.restraint;
  }

  // ============================================================
  //  TRANSITIONS — small, host-authoritative, exported.
  // ============================================================
  function track(p) { if (restrained.indexOf(p) < 0) restrained.push(p); }
  function untrack(p) { const i = restrained.indexOf(p); if (i >= 0) restrained.splice(i, 1); }

  function cuff(ped) {
    if (!cuffablePed(ped)) return false;
    ped.restraint = { state: "cuffed", by: "player", t: 0, vehicle: null };
    track(ped);
    // hands are tied: whatever they were holding hits the pavement
    if (ped.armed && ped.weapon && CBZ.cityDropWeapon) CBZ.cityDropWeapon(ped.pos.x, ped.pos.z, ped.weapon, 12);
    ped.armed = false; ped.weapon = null;
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped);
    ped.controlled = true; ped.rage = null; ped.state = "walk"; ped.speed = 0;
    ped.pause = 0; ped.path = null; ped.finalGoal = null;
    ped.target.set(ped.pos.x, 0, ped.pos.z);
    ped.surrender = false; ped.surrenderT = 0; ped.poseHandsUp = false;
    if (ped.char) { ped.char.handsUp = false; ped.char.surrender = false; }
    if (g.cityHostage === ped) { g.cityHostage = null; ped.hostage = false; }
    if (CBZ.cityCancelReport) CBZ.cityCancelReport(ped);   // tied hands can't dial
    addCuffs(ped);
    if (CBZ.sfx) CBZ.sfx("reload");                        // the ratchet click
    // tying up a clean citizen IS a crime — the block sees it like any mugging.
    if (!isWanted(ped) && CBZ.cityCrime) CBZ.cityCrime(50, { x: ped.pos.x, z: ped.pos.z, type: "kidnapping" });
    I.refresh();
    return true;
  }

  function escort(ped) {
    if (st(ped) !== "cuffed") return false;
    ped.restraint.state = "escorted";
    I.refresh();
    return true;
  }
  // release from ESCORT only — still tied, stands where you leave them
  function stand(ped) {
    if (st(ped) !== "escorted") return false;
    ped.restraint.state = "cuffed";
    ped.target.set(ped.pos.x, 0, ped.pos.z); ped.speed = 0;
    I.refresh();
    return true;
  }
  // full release: ties cut, free person again
  function release(ped, opts) {
    if (!ped || !ped.restraint) return false;
    const r = ped.restraint;
    if (r.state === "in_vehicle") unseatBody(ped, r.vehicle);
    ped.restraint = null;
    untrack(ped);
    removeCuffs(ped);
    ped.controlled = false;
    if (ped.char) ped.char.guardBroke = 0;   // the clinch wear-down look ends with the hold
    ped.fear = Math.max(ped.fear || 0, 6); ped.alarmed = 4;
    if (!opts || !opts.silent) I.refresh();
    return true;
  }

  function seat(ped, car) {
    if (!ped || !car || car.dead) return false;
    const s = st(ped);
    if (s !== "escorted" && s !== "cuffed") return false;
    if (car._captive) return false;                  // one body per back seat
    ped.restraint.state = "in_vehicle";
    ped.restraint.vehicle = car;
    car._captive = ped;
    ped.inCar = true;                                // peds.js fully skips them (the seat IS the freeze)
    ped.group.visible = false;
    ped.pos.set(car.pos.x, 0, car.pos.z);
    if (CBZ.sfx) CBZ.sfx("door");
    I.refresh();
    return true;
  }
  function unseatBody(ped, car) {
    ped.inCar = false;
    ped.group.visible = true;
    if (car) {
      if (car._captive === ped) car._captive = null;
      const h = car.heading || 0;
      ped.pos.set(car.pos.x - Math.cos(h) * 1.8, 0, car.pos.z + Math.sin(h) * 1.8);
    }
    ped.target.set(ped.pos.x, 0, ped.pos.z); ped.speed = 0;
    if (CBZ.collide) CBZ.collide(ped.pos, 0.5, 0, 1.7);
  }
  function unseat(ped) {
    if (st(ped) !== "in_vehicle") return false;
    const car = ped.restraint.vehicle;
    unseatBody(ped, car);
    ped.restraint.state = "cuffed";
    ped.restraint.vehicle = null;
    if (CBZ.sfx) CBZ.sfx("door");
    I.refresh();
    return true;
  }

  // ---- GRAPPLE: the clinch ---------------------------------------------------
  function grapple(ped) {
    if (!cuffablePed(ped)) return false;
    ped.restraint = { state: "grappled", by: "player", t: 0, vehicle: null };
    track(ped);
    ped.controlled = true; ped.rage = null; ped.state = "walk"; ped.speed = 0;
    ped.path = null; ped.finalGoal = null;
    // their offense stops while you've got them wrapped (refreshed per frame)
    ped.attackCD = Math.max(ped.attackCD || 0, 1);
    if (CBZ.sfx) CBZ.sfx("punch");
    if (CBZ.shake) CBZ.shake(0.2);
    I.refresh();
    return true;
  }
  // how long they last in your clinch: your read vs theirs (sizeup levels)
  function breakTime(ped) {
    const mine = CBZ.cityPlayerLevel ? CBZ.cityPlayerLevel() : 10;
    const theirs = CBZ.cityLevel ? CBZ.cityLevel(ped) : 10;
    return Math.max(1.4, Math.min(7, 2.6 + (mine - theirs) * 0.09));
  }
  function breakFree(ped) {
    release(ped, { silent: true });
    ped.rage = pa(); ped.state = "fight";
    if (CBZ.citySay) CBZ.citySay(ped, "“Get OFF me!”", "#ff9a9a", 1.8);
    if (CBZ.shake) CBZ.shake(0.3);
    I.refresh();
  }
  function slam(ped) {
    if (st(ped) !== "grappled") return false;
    const fx = CBZ.player.pos.x, fz = CBZ.player.pos.z;
    release(ped, { silent: true });
    ped.hp -= 30;
    if (CBZ.sfx) CBZ.sfx("ko");
    if (CBZ.shake) CBZ.shake(0.5);
    if (ped.hp <= 0) {
      CBZ.cityKillPed && CBZ.cityKillPed(ped, { fromX: fx, fromZ: fz, force: 7 }, "slammed into the pavement");
    } else {
      ped.ko = Math.max(ped.ko || 0, 3.5);
      if (CBZ.body) CBZ.body.hit(ped, { fromX: fx, fromZ: fz, force: 9, knockdown: 1.5 });
      if (CBZ.gore && Math.random() < 0.4) CBZ.gore(ped.pos.x, 0.4, ped.pos.z, { amount: 0.4, player: false });
      CBZ.cityCrime && CBZ.cityCrime(45, { x: ped.pos.x, z: ped.pos.z, type: "assault" });
      CBZ.cityAlarm && CBZ.cityAlarm(ped.pos.x, ped.pos.z, 12, 0.8, pa());
    }
    CBZ.player._fighting = 1.5;
    I.refresh();
    return true;
  }
  function shove(ped) {
    if (st(ped) !== "grappled") return false;
    const fx = CBZ.player.pos.x, fz = CBZ.player.pos.z;
    release(ped, { silent: true });
    if (CBZ.body) CBZ.body.hit(ped, { fromX: fx, fromZ: fz, force: 5 });
    ped.fear = 6; ped.state = "flee";
    if (CBZ.sfx) CBZ.sfx("punch");
    I.refresh();
    return true;
  }

  // ---- TURN IN: the desk pays for paper, and only for paper ------------------
  function turnIn(ped) {
    if (!ped || !ped.restraint || ped.dead) return false;
    const r = ped.restraint;
    if (r.state === "in_vehicle") unseatBody(ped, r.vehicle);
    const wanted = isWanted(ped);
    const pay = wanted ? bountyFor(ped) : 0;
    const tag = ped.bountyTag || "";
    ped.restraint = null;
    untrack(ped);
    removeCuffs(ped);
    if (wanted) {
      ped.bounty = 0; ped.bountyTag = null;
      if (CBZ.cityStationIntake) CBZ.cityStationIntake(ped);   // walked through the door, off the board
      CBZ.city && CBZ.city.addCash(pay);
      CBZ.city && CBZ.city.addRespect(4);
      if (CBZ.sfx) CBZ.sfx("coin");
      CBZ.city && CBZ.city.big("COLLAR + $" + pay + (tag ? " — " + tag : ""));
      if (CBZ.pushKill) CBZ.pushKill(nm(ped) + " was turned in", "#7ed957");
    } else {
      // dragging in a clean citizen: the desk doesn't pay — it CHARGES you.
      ped.controlled = false;
      ped.fear = 10; ped.alarmed = 8; ped.state = "flee";
      CBZ.city && CBZ.city.note("“This one's clean. Cuffing citizens off the street — that's a snatch job.”", 2.6);
      CBZ.cityCrime && CBZ.cityCrime(120, { instant: true, x: CBZ.player.pos.x, z: CBZ.player.pos.z, type: "kidnapping" });
    }
    I.refresh();
    return true;
  }

  // ============================================================
  //  PER-FRAME: derived attaches, struggle clocks, robustness sweeps.
  //  Runs at 38.5 — after peds (34) / social (34.6) / vehicles (37) so the
  //  cuffed pose lands on top of the anim pass and canShow gates (39) read
  //  fresh state.
  // ============================================================
  let pleadCD = 0, copSuspectCD = 0;
  const PLEADS = [
    "“Come on, man. These are too tight.”",
    "“I got kids. Don't do this.”",
    "“You ain't even wearing a badge…”",
    "“Where are you taking me?!”",
  ];
  CBZ.onUpdate(38.5, function (dt) {
    if (g.mode !== "city") { if (restrained.length) releaseAll(); return; }
    if (!restrained.length) return;
    const P = CBZ.player;
    pleadCD -= dt; copSuspectCD -= dt;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);

    for (let i = restrained.length - 1; i >= 0; i--) {
      const ped = restrained[i];
      const r = ped && ped.restraint;
      // target died (shot mid-march, ragdolled) → the restraint dies cleanly with them
      if (!r || ped.dead) { if (ped) release(ped, { silent: true }); continue; }
      r.t += dt;

      if (r.state === "grappled") {
        // player death / driving off mid-clinch = they're loose
        if (P.dead || P.driving) { breakFree(ped); continue; }
        // derived attach: held at arm's reach, facing you. Never simulated.
        ped.pos.x = P.pos.x + fx * CLINCH_D;
        ped.pos.z = P.pos.z + fz * CLINCH_D;
        ped.pos.y = 0;
        if (CBZ.collide) CBZ.collide(ped.pos, 0.5, 0, 1.7);
        ped.target.set(ped.pos.x, 0, ped.pos.z); ped.speed = 0;
        ped.group.rotation.y = Math.atan2(P.pos.x - ped.pos.x, P.pos.z - ped.pos.z);
        ped.attackCD = Math.max(ped.attackCD || 0, 0.5);   // no swings from inside the clinch
        ped.pause = Math.max(ped.pause || 0, 0.5);
        if (CBZ.animChar) CBZ.animChar(ped.char, 0, dt);
        if (ped.char) ped.char.guardBroke = r.t >= WEAR_T ? 1 : 0;   // visibly wearing down
        if (r.t >= breakTime(ped)) { breakFree(ped); continue; }
        continue;
      }

      if (r.state === "escorted") {
        if (P.dead || P.driving) { r.state = "cuffed"; ped.target.set(ped.pos.x, 0, ped.pos.z); }
        else {
          const ax = P.pos.x + fx * ESCORT_D, az = P.pos.z + fz * ESCORT_D;
          // a teleport (lift, mode warp) snapped the attach apart → they stay put, tied
          if (Math.hypot(ax - ped.pos.x, az - ped.pos.z) > TELEPORT_D) {
            r.state = "cuffed"; ped.target.set(ped.pos.x, 0, ped.pos.z);
          } else {
            const wasX = ped.pos.x, wasZ = ped.pos.z;
            ped.pos.x = ax; ped.pos.z = az; ped.pos.y = 0;
            if (CBZ.collide) CBZ.collide(ped.pos, 0.5, 0, 1.7);   // marched, not phased, through walls
            ped.target.set(ped.pos.x, 0, ped.pos.z);
            const moved = Math.hypot(ped.pos.x - wasX, ped.pos.z - wasZ) / Math.max(dt, 1e-4);
            ped.speed = 0;
            ped.group.rotation.y = CBZ.lerpAngle ? CBZ.lerpAngle(ped.group.rotation.y, yaw + Math.PI, 1 - Math.pow(0.001, dt)) : yaw + Math.PI;
            if (CBZ.animChar) CBZ.animChar(ped.char, moved, dt);
          }
        }
      }

      if (r.state === "in_vehicle") {
        const car = r.vehicle;
        // car blown up / despawned → they tumble out at the wreck, still tied
        if (!car || car.dead || !car.group || !car.group.parent) {
          unseatBody(ped, car);
          r.state = "cuffed"; r.vehicle = null;
          ped.ko = Math.max(ped.ko || 0, 2);
          if (CBZ.body) CBZ.body.hit(ped, { dir: { x: Math.random() - 0.5, z: Math.random() - 0.5 }, force: 6, knockdown: 1.2 });
        } else {
          ped.pos.set(car.pos.x, 0, car.pos.z);   // riding along (LOS/map stay honest)
        }
        continue;
      }

      // cuffed (standing or escorted): held still, hands pinned, mouth running
      ped.controlled = true; ped.rage = null;
      if (ped.state === "flee" || ped.state === "fight") ped.state = "walk";
      if (r.state === "cuffed") {
        // pinned in place every frame so nothing (panic, gunfire) walks them off
        ped.speed = 0; ped.target.set(ped.pos.x, 0, ped.pos.z);
        if (CBZ.animChar && Math.hypot(ped.pos.x - P.pos.x, ped.pos.z - P.pos.z) < 70) CBZ.animChar(ped.char, 0, dt);
      }
      cuffPose(ped);
      if (pleadCD <= 0 && Math.hypot(ped.pos.x - P.pos.x, ped.pos.z - P.pos.z) < 8 && Math.random() < 0.3) {
        pleadCD = 9;
        if (CBZ.citySay) CBZ.citySay(ped, PLEADS[(Math.random() * PLEADS.length) | 0], "#cfd6e6", 2.2);
      }
      // a working officer clocks a stranger marching a CLEAN citizen in ties —
      // a wanted gangster in cuffs gets a nod, not a call. Once per collar.
      if (!r._copSeen && r.state === "escorted" && !isWanted(ped) && copSuspectCD <= 0) {
        copSuspectCD = 2;
        const cops = CBZ.cityCops || [];
        for (let ci = 0; ci < cops.length; ci++) {
          const c = cops[ci];
          if (c.dead) continue;
          if (Math.hypot(c.pos.x - ped.pos.x, c.pos.z - ped.pos.z) < 16) {
            r._copSeen = true;
            if (CBZ.citySay) CBZ.citySay(c, "“Hey! Step away from him — NOW.”", "#ffd27b", 2.2);
            CBZ.cityCrime && CBZ.cityCrime(70, { instant: true, x: ped.pos.x, z: ped.pos.z, type: "kidnapping" });
            break;
          }
        }
      }
    }
  });
  function releaseAll() {
    for (let i = restrained.length - 1; i >= 0; i--) release(restrained[i], { silent: true });
  }
  if (CBZ.onModeExit) CBZ.onModeExit("city", releaseAll);

  // ============================================================
  //  OPTIONS — all through the registry; every gate reads the enum.
  // ============================================================
  function escortingPed() {
    for (const p of restrained) if (st(p) === "escorted") return p;
    return null;
  }
  // your ride (owned or already boosted) parked within stuffing reach
  function nearOwnCar(px, pz) {
    let best = null, bd = CAR_REACH * CAR_REACH;
    const cars = CBZ.cityCars || [];
    for (const c of cars) {
      if (c.dead || c.player || c.npcDriver || !(c.owned || c.stolen)) continue;
      const dd = (c.pos.x - px) * (c.pos.x - px) + (c.pos.z - pz) * (c.pos.z - pz);
      if (dd < bd) { bd = dd; best = c; }
    }
    return best;
  }

  // ---- CUFF: earned two ways — at gunpoint on raised hands, or bare-handed
  //      on a body that's already down/broken. Same verb, two gates. ----
  I.register("ped", {
    id: "rs-cuff-gp", slot: "e", prio: 80, needsGunDrawn: true, bad: true,
    canShow: (p) => cuffablePed(p) && subdued(p),
    label: (p) => "Zip " + nm(p) + "'s wrists",
    onSelect: (p) => cuff(p),
  });
  I.register("ped", {
    id: "rs-cuff", slot: "e", prio: 80, bad: true,
    // slot-e prio beats the grapple record, so a downed/broken fighter reads
    // "Zip their wrists" while one still swinging reads "Grab hold" — no
    // loose-boolean cross-gating (the framework bug this file exists to avoid).
    canShow: (p, ctx) => !ctx.gunDrawn && cuffablePed(p) && subdued(p),
    label: (p) => "Zip " + nm(p) + "'s wrists",
    onSelect: (p) => cuff(p),
  });

  // ---- GRAPPLE: only on someone actually swinging, only with a free hand ----
  I.register("ped", {
    id: "rs-grapple", slot: "e", prio: 78, bad: true,
    canShow: (p, ctx) => cuffablePed(p) && fightingYou(p) && canClinch(ctx),
    label: (p) => "Grab hold of " + nm(p),
    onSelect: (p) => grapple(p),
  });
  // clinched: wear them down to tie, or end it ugly
  I.register("ped", {
    id: "rs-clinch-cuff", slot: "e", prio: 90, bad: true,
    canShow: (p) => st(p) === "grappled" && p.restraint.t >= WEAR_T,
    label: (p) => "Tie " + nm(p) + " up",
    onSelect: (p) => { if (st(p) === "grappled") { p.restraint = null; untrack(p); cuff(p); } },
  });
  I.register("ped", {
    id: "rs-slam", slot: "i", prio: 90, bad: true,
    canShow: (p) => st(p) === "grappled",
    label: "Slam them into the pavement",
    onSelect: (p) => slam(p),
  });
  I.register("ped", {
    id: "rs-shove", slot: "j", prio: 90, bad: true,
    canShow: (p) => st(p) === "grappled",
    label: "Throw them off",
    onSelect: (p) => shove(p),
  });

  // ---- CUFFED: march / stand / stuff / cut loose ----
  I.register("ped", {
    id: "rs-march", slot: "e", prio: 85,
    canShow: (p, ctx) => st(p) === "cuffed" && !ctx.driving,
    label: (p) => "March " + nm(p),
    onSelect: (p) => escort(p),
  });
  I.register("ped", {
    id: "rs-stand", slot: "e", prio: 85,
    canShow: (p) => st(p) === "escorted",
    label: "Stand them there",
    onSelect: (p) => stand(p),
  });
  I.register("ped", {
    id: "rs-stuff", slot: "i", prio: 85, bad: true,
    canShow: (p, ctx) => (st(p) === "escorted" || st(p) === "cuffed") && !ctx.driving && !!nearOwnCar(ctx.pos.x, ctx.pos.z),
    label: "Stuff them in the back",
    onSelect: (p, ctx) => { const car = nearOwnCar(ctx.pos.x, ctx.pos.z); if (car) seat(p, car); },
  });
  I.register("ped", {
    id: "rs-cut-loose", slot: "l", prio: 85,
    canShow: (p) => st(p) === "cuffed" || st(p) === "escorted",
    label: "Cut the ties",
    onSelect: (p) => release(p),
  });

  // ---- the back seat: drag a seated captive back out (on foot, your car) ----
  I.register("vehicle", {
    id: "rs-unseat", slot: "i", prio: 85, bad: true,
    canShow: (car, ctx) => !ctx.driving && !!car._captive && st(car._captive) === "in_vehicle",
    label: (car) => "Drag " + nm(car._captive) + " out of the back",
    onSelect: (car) => { if (car._captive) unseat(car._captive); },
  });

  // ---- THE DESK: hand-over zone at the precinct (police.js owns the point) ----
  const stationToken = {};
  I.registerZone({
    id: "zone-station", kind: "station", prio: 13,
    find: function (px, pz) {
      const s = CBZ.cityPoliceStation && CBZ.cityPoliceStation();
      if (!s) return null;
      if (Math.hypot(px - s.x, pz - s.z) > STATION_R) return null;
      if (!deskCaptive(px, pz)) return null;          // the desk only lights up with a body in tow
      stationToken.x = s.x; stationToken.z = s.z;
      return stationToken;
    },
    options: [{
      id: "rs-turn-in", slot: "i", prio: 20,
      label: function (t, ctx) {
        const p = deskCaptive(ctx.pos.x, ctx.pos.z);
        return p && isWanted(p) ? "Hand " + nm(p) + " over" : "Hand them over";
      },
      onSelect: function (t, ctx) {
        const p = deskCaptive(ctx.pos.x, ctx.pos.z);
        if (p) turnIn(p);
      },
    }],
  });
  // the body you could turn in right here: marched, standing beside you, or in
  // the back of a car parked at the curb.
  function deskCaptive(px, pz) {
    let best = null, bd = 1e9;
    for (const p of restrained) {
      const s = st(p);
      if (s !== "cuffed" && s !== "escorted" && s !== "in_vehicle") continue;
      const d = Math.hypot(p.pos.x - px, p.pos.z - pz);
      if (d > 9) continue;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  I.describe("station", function () {
    const p = deskCaptive(CBZ.player.pos.x, CBZ.player.pos.z);
    const note = p
      ? (isWanted(p) ? "They've got paper on this one — the desk pays cash" : "This one's clean — the desk doesn't pay for citizens")
      : "The desk takes collars";
    return { label: "🚓 Precinct Desk", note };
  });

  // ---- exports: the net layer calls these, same as the keys do --------------
  CBZ.cityRestrain = {
    stateOf: st, isWanted, bountyFor,
    cuff, grapple, escort, stand, release, seat, unseat, turnIn, slam, shove,
    releaseAll,
  };
})();

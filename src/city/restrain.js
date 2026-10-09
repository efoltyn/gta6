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

   THE HANDS ARE CBZ.verbs' (systems/verbs.js). This file keeps the RULES —
   the enum, the bounty, the back seat, the desk — and asks the shared verbs
   for every body: the zip ties (on the WRISTS, hands behind the back, solved
   every frame for any rig in any game), the clinch (a collar grip, the man's
   hands on your wrists), the march (a hand on his arm, one on the ties), the
   slam and the shove (the world in front of him decides where he goes).

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
  const ESCORT_D = 0.9;        // the perp-walk pace city/wanted.js still reads (verbs place a march from both bodies)
  const WEAR_T = 1.2;          // seconds of clinch before their struggle is broken (tie-able)
  const CAR_REACH = 4.6;       // back-seat stuffing reach
  const STATION_R = 7;         // the desk hand-over zone radius
  const TELEPORT_D = 10;       // escort attach snapped further than this = a teleport → demote

  const restrained = [];       // every ped currently carrying a restraint record

  function nm(p) { return (p && p.name) || "them"; }
  function st(p) { return p && p.restraint ? p.restraint.state : null; }
  function pa() { return CBZ.city && CBZ.city.playerActor; }

  // ---- THE TIES AND THE HANDS ARE CBZ.verbs' --------------------------------
  // The zip ties, the hands-behind-the-back solve and the player's own ties
  // used to live here (addCuffs / pinArm / cuffPose): a hand-rolled two-bone IK
  // with typed bone lengths that met the FISTS behind the back, the ties
  // buried in the hand. CBZ.verbs.setCuffs puts them on the wrists of any rig
  // in any game, and its late pass holds the wrists together every frame.
  const VB = () => CBZ.verbs || null;
  function tie(p, on) { const v = VB(); if (v && v.setCuffs) v.setCuffs(p, on); }
  function letGo(p, how) { const v = VB(); if (v && v.sessionOf(p)) v.release(p, how || "set"); }
  function held(p) { const v = VB(); return !!(v && v.sessionOf(p)); }

  // ---- THE PLAYER WEARS THE SAME TIES (city/wanted.js's arrest arc, the
  // prison haul in systems/capture.js, games/jail.js) ----------------------
  function cuffPlayer(on) {
    const v = VB();
    if (!v || !v.setCuffs) return false;
    return v.setCuffs(v.playerActor(), !!on);
  }
  function playerCuffed() { return !!(CBZ.playerChar && CBZ.playerChar.cuffed && VB() && VB().cuffed(VB().playerActor())); }
  // kept for callers: the verbs' late pass poses every cuffed rig every frame
  function posePlayerCuffs() {}

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
  // systems/arrest.js's rule when it is loaded: hands up, on his knees, down
  // or out. A staggered man is still on his feet (take him down first).
  function subdued(p) {
    if (p === g.cityHostage) return true;
    const AR = CBZ.arrest;
    if (AR && AR.cuffable) return !!AR.cuffable(p);
    return p.surrender || p.poseHandsUp || (p.char && p.char.handsUp) || (p.ko || 0) > 0;
  }
  function cuffablePed(p) {
    return p && !p.dead && !p.vendor && p.kind !== "cop" && !p.restraint;
  }

  // ============================================================
  //  TRANSITIONS — small, host-authoritative, exported.
  // ============================================================
  function track(p) { if (restrained.indexOf(p) < 0) restrained.push(p); }
  function untrack(p) { const i = restrained.indexOf(p); if (i >= 0) restrained.splice(i, 1); }

  // WHOSE HANDS TIED THEM. `by` defaulted to the literal "player" because for
  // this file's whole life the player was the only thing in the game that could
  // cuff anybody. A pirate crew tying up a steward four hundred metres offshore
  // made that assumption expensive: the kidnapping charge below landed on the
  // PLAYER, who was not there. Both existing callers pass no opts and are
  // therefore byte-identical.
  function cuff(ped, opts) {
    if (!cuffablePed(ped)) return false;
    ped.restraint = { state: "cuffed", by: (opts && opts.by) || "player", t: 0, vehicle: null };
    track(ped);
    // A PRESIDENT'S OWN HANDS: cuffing somebody is a political act
    // (city/politics.js prices it off who he is; the body stays in your hands)
    const Pol = CBZ.politics;
    if (ped.restraint.by === "player" && Pol && Pol.act && Pol.owns && CBZ.gov && CBZ.gov.holds) {
      try { const h = CBZ.gov.holds(); if (h && h.kind === "country" && Pol.owns(h.id)) Pol.act("detain", { target: ped, by: "self", keepBody: true }); } catch (e) {}
    }
    // hands are tied: whatever they were holding hits the pavement, unless the
    // officer bags it (city/custody.js: `seize` keeps it as evidence)
    if (ped.armed && ped.weapon && CBZ.cityDropWeapon && !(opts && opts.seize)) {
      CBZ.cityDropWeapon(ped.pos.x, ped.pos.z, ped.weapon, 12, { y: ped.pos.y });
    }
    ped.armed = false; ped.weapon = null;
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped);
    ped.controlled = true; ped.rage = null; ped.state = "walk"; ped.speed = 0;
    ped.pause = 0; ped.path = null; ped.finalGoal = null;
    ped.target.set(ped.pos.x, 0, ped.pos.z);
    ped.surrender = false; ped.surrenderT = 0; ped.poseHandsUp = false;
    if (ped.char) { ped.char.handsUp = false; ped.char.surrender = false; }
    if (g.cityHostage === ped) { g.cityHostage = null; ped.hostage = false; }
    if (CBZ.cityCancelReport) CBZ.cityCancelReport(ped);   // tied hands can't dial
    // YOUR hands do it: turn him, wrists behind his back, the ratchet. Anyone
    // else's (a crew offshore) is tied where he stands.
    const v = VB();
    const S = v && ped.restraint.by === "player" && pa() ? v.cuff(pa(), ped, { far: true }) : null;
    if (!S) { tie(ped, true); if (CBZ.sfx) CBZ.sfx("reload"); }
    // tying up a clean citizen IS a crime — the block sees it like any mugging.
    // But only when it was YOU: `by` is the taker, and an NPC crew's kidnapping
    // is that crew's business, not a charge filed against a player who was not
    // in the same postcode.
    if (ped.restraint.by === "player" && !isWanted(ped) && CBZ.cityCrime) {
      CBZ.cityCrime(50, { x: ped.pos.x, z: ped.pos.z, type: "kidnapping" });
    }
    I.refresh();
    return true;
  }

  // officer (optional): whose hand is on his arm. Default: yours. An officer
  // walking him to a unit is city/custody.js's escort; the tick below watches
  // that officer instead of you.
  function escort(ped, officer) {
    if (st(ped) !== "cuffed") return false;
    const v = VB();
    const by = officer && officer.pos && officer !== pa() && !officer.isPlayer ? officer : null;
    const A = by || pa();
    // a hand on his arm, one on the ties: the march is a hold
    if (!v || !A || !v.escort(A, ped, { far: true })) return false;
    ped.restraint.state = "escorted";
    ped.restraint.officer = by;
    I.refresh();
    return true;
  }
  // release from ESCORT only — still tied, stands where you leave them
  function stand(ped) {
    if (st(ped) !== "escorted") return false;
    letGo(ped, "set");
    ped.restraint.state = "cuffed"; ped.restraint.officer = null;
    ped.target.set(ped.pos.x, 0, ped.pos.z); ped.speed = 0;
    I.refresh();
    return true;
  }
  // HANDED OVER: the state has him (city/custody.js), and he is leaving the
  // world with the car that took him. The restraint record ends here without
  // pulling him out of the seat.
  function handOff(ped) {
    if (!ped) return false;
    const r = ped.restraint;
    if (r && r.vehicle) dropCaptive(r.vehicle, ped);
    ped.restraint = null;
    untrack(ped);
    letGo(ped, "set");
    tie(ped, false);
    return true;
  }
  // full release: ties cut, free person again
  function release(ped, opts) {
    if (!ped || !ped.restraint) return false;
    const r = ped.restraint;
    if (r.state === "in_vehicle" || r.state === "boarding") unseatBody(ped, r.vehicle);
    ped.restraint = null;
    untrack(ped);
    letGo(ped, "set");
    tie(ped, false);
    ped.controlled = false;
    if (ped.char) ped.char.guardBroke = 0;   // the clinch wear-down look ends with the hold
    ped.fear = Math.max(ped.fear || 0, 6); ped.alarmed = 4;
    if (!opts || !opts.silent) I.refresh();
    return true;
  }

  /* ---- STUFFING SOMEBODY IN THE BACK ---------------------------------------
     This used to be four lines and every one of them was the bug the owner
     filmed: `group.visible = false` (the body stops existing), `pos.set(car.pos)`
     (it teleports to the car's ORIGIN, which is the middle of the engine bay),
     `inCar = true` (peds.js skips it entirely — "the seat IS the freeze"), and
     a hard cap of ONE because there was exactly one hiding place.

     A real back seat has two, and city/boarding.js knows where both of them
     are because `CBZ.carCabinInfo` publishes the bench. So the cap is lifted to
     the SEAT COUNT rather than to a number, `_captive` keeps meaning "the first
     captive in this car" for the five places that read it, and the body walks
     to the door under its own legs and is put in the chair by npclife —
     visible, shootable through the glass, holding its seat while the car moves.
     The old snap survives underneath as the flag-off path, unchanged. */
  function captives(car) { return (car && car._captives) || null; }
  function noteCaptive(car, ped) {
    const a = car._captives || (car._captives = []);
    if (a.indexOf(ped) < 0) a.push(ped);
    car._captive = a[0] || null;                     // legacy single-slot view
  }
  function dropCaptive(car, ped) {
    if (!car) return;
    const a = car._captives;
    if (a) { const i = a.indexOf(ped); if (i >= 0) a.splice(i, 1); }
    if (car._captive === ped) car._captive = (a && a[0]) || null;
  }
  function boardingUp() {
    return !!(CBZ.boarding && CBZ.boarding.board && CBZ.CONFIG &&
              CBZ.CONFIG.COMPANION_BOARDING_V1 !== false);
  }
  // opts.legacy: the old hidden back seat (city/custody.js's last resort when
  // the door arc cannot take him)
  function seat(ped, car, opts) {
    if (!ped || !car || car.dead) return false;
    const s = st(ped);
    if (s !== "escorted" && s !== "cuffed") return false;
    if (ped.restraint) ped.restraint.officer = null;
    if (boardingUp() && !(opts && opts.legacy)) {
      // a real seat, reached on foot. `role: "captive"` is what sends him to
      // the BACK — the seat picker puts a tied man behind the driver, which is
      // both where he goes and why the one-body cap could be lifted at all.
      if (CBZ.boarding.freeSeats && CBZ.boarding.freeSeats(car) <= 0) return false;
      letGo(ped, "set");                             // the car takes him from here
      ped.restraint.state = "boarding";
      ped.restraint.vehicle = car;
      const ok = CBZ.boarding.board(ped, car, { role: "captive", run: false });
      if (ok) { noteCaptive(car, ped); I.refresh(); return true; }
      ped.restraint.state = s;                       // refused — nothing moved
      ped.restraint.vehicle = null;
      return false;
    }
    if (car._captive) return false;                  // one body per back seat
    letGo(ped, "set");
    ped.restraint.state = "in_vehicle";
    ped.restraint.vehicle = car;
    noteCaptive(car, ped);
    ped.inCar = true;                                // peds.js fully skips them (the seat IS the freeze)
    ped.group.visible = false;
    ped.pos.set(car.pos.x, 0, car.pos.z);
    I.refresh();
    return true;
  }
  function unseatBody(ped, car) {
    dropCaptive(car, ped);
    // a body city/boarding.js seated leaves through CBZ.cityUnseat, which is
    // the ONE sanctioned exit; only the legacy hidden rig is un-hidden here.
    if (ped._cbzSeat && CBZ.boarding && CBZ.boarding.alight) {
      CBZ.boarding.alight(ped);
      return;
    }
    ped.inCar = false;
    ped.group.visible = true;
    if (car) {
      const h = car.heading || 0;
      ped.pos.set(car.pos.x - Math.cos(h) * 1.8, 0, car.pos.z + Math.sin(h) * 1.8);
    }
    ped.target.set(ped.pos.x, 0, ped.pos.z); ped.speed = 0;
    if (CBZ.collide) CBZ.collide(ped.pos, 0.5, 0, 1.7);
  }
  function unseat(ped) {
    const s = st(ped);
    if (s !== "in_vehicle" && s !== "boarding") return false;
    const car = ped.restraint.vehicle;
    unseatBody(ped, car);
    ped.restraint.state = "cuffed";
    ped.restraint.vehicle = null;
    I.refresh();
    return true;
  }

  // ---- GRAPPLE: the clinch ---------------------------------------------------
  function grapple(ped) {
    if (!cuffablePed(ped)) return false;
    // THE CLINCH IS A COLLAR GRIP: both fists in his shirt, his hands on your
    // wrists (CBZ.verbs.grab). No grip, no clinch.
    const v = VB();
    // he FIGHTS the grip (CBZ.verbs struggle), as well as your read of each
    // other says he can: a better man than you tears loose sooner
    if (!v || !pa() || !v.grab(pa(), ped, { far: true, struggle: clinchFight(ped) })) return false;
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
  // how well he fights your clinch, 0..1: your read vs theirs (sizeup levels)
  function clinchFight(ped) {
    const mine = CBZ.cityPlayerLevel ? CBZ.cityPlayerLevel() : 10;
    const theirs = CBZ.cityLevel ? CBZ.cityLevel(ped) : 10;
    return Math.max(0.1, Math.min(1, 0.45 + (theirs - mine) * 0.03));
  }
  function breakFree(ped) {
    letGo(ped, "drop");
    release(ped, { silent: true });
    ped.rage = pa(); ped.state = "fight";
    if (CBZ.citySay) CBZ.citySay(ped, "Get OFF me!", "#ff9a9a", 1.8);
    if (CBZ.shake) CBZ.shake(0.3);
    I.refresh();
  }
  // SLAM: a heave out of the clinch into whatever is in front of him — the
  // pavement, a wall, over a rail, into the harbour (the world decides, the
  // verb says which); the damage lands when he does.
  function slam(ped) {
    if (st(ped) !== "grappled") return false;
    const v = VB();
    const fx = CBZ.player.pos.x, fz = CBZ.player.pos.z;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0;
    ped.restraint = null; untrack(ped);
    ped.controlled = false;
    if (ped.char) ped.char.guardBroke = 0;
    const hurt = function (S, kind) {
      if (ped.dead) return;
      ped.hp -= kind === "water" ? 8 : kind === "wall" ? 38 : 30;
      if (ped.hp <= 0) {
        CBZ.cityKillPed && CBZ.cityKillPed(ped, { fromX: fx, fromZ: fz, force: 7 }, kind === "wall" ? "slammed into a wall" : "slammed into the pavement");
      } else {
        ped.ko = Math.max(ped.ko || 0, kind === "water" ? 0 : 3.5);
        CBZ.cityCrime && CBZ.cityCrime(45, { x: ped.pos.x, z: ped.pos.z, type: "assault" });
        CBZ.cityAlarm && CBZ.cityAlarm(ped.pos.x, ped.pos.z, 12, 0.8, pa());
      }
    };
    const S = v && pa() ? v.throw(pa(), ped, { dir: { x: -Math.sin(yaw), z: -Math.cos(yaw) }, power: 1, onOutcome: hurt }) : null;
    if (!S) { hurt(null, "open"); if (CBZ.body) CBZ.body.hit(ped, { fromX: fx, fromZ: fz, force: 9, knockdown: 1.5 }); }
    if (CBZ.shake) CBZ.shake(0.5);
    CBZ.player._fighting = 1.5;
    I.refresh();
    return true;
  }
  // SHOVE: both palms out of the clinch; a shove near a ledge is a fall
  function shove(ped) {
    if (st(ped) !== "grappled") return false;
    const v = VB();
    const fx = CBZ.player.pos.x, fz = CBZ.player.pos.z;
    ped.restraint = null; untrack(ped);
    ped.controlled = false;
    if (ped.char) ped.char.guardBroke = 0;
    const S = v && pa() ? v.shove(pa(), ped, { power: 0.7 }) : null;
    if (!S && CBZ.body) CBZ.body.hit(ped, { fromX: fx, fromZ: fz, force: 5 });
    ped.fear = 6; ped.state = "flee";
    if (CBZ.sfx) CBZ.sfx("punch");
    I.refresh();
    return true;
  }

  // ---- TURN IN: the desk pays for paper, and only for paper ------------------
  function turnIn(ped) {
    if (!ped || !ped.restraint || ped.dead) return false;
    const r = ped.restraint;
    if (r.state === "in_vehicle" || r.state === "boarding") unseatBody(ped, r.vehicle);
    const wanted = isWanted(ped);
    const pay = wanted ? bountyFor(ped) : 0;
    const tag = ped.bountyTag || "";
    ped.restraint = null;
    untrack(ped);
    letGo(ped, "set");
    tie(ped, false);
    if (wanted) {
      // the desk takes custody: he is a detainee on the state's list from here
      // (city/custody.js), walked through the door, off the board
      if (CBZ.custody && CBZ.custody.book) { try { CBZ.custody.book(ped, { verb: "arrest", by: "player", status: "held", facility: CBZ.custody.facility("police") }); } catch (e) {} }
      ped._custodyExit = true;
      ped.bounty = 0; ped.bountyTag = null;
      if (CBZ.cityStationIntake) CBZ.cityStationIntake(ped);
      CBZ.city && CBZ.city.addCash(pay);
      CBZ.city && CBZ.city.addRespect(4);
      if (CBZ.sfx) CBZ.sfx("coin");
      CBZ.city && CBZ.city.big("COLLAR + $" + pay + (tag ? " — " + tag : ""));
      if (CBZ.pushKill) CBZ.pushKill(nm(ped) + " was turned in", "#7ed957");
    } else {
      // dragging in a clean citizen: the desk doesn't pay — it CHARGES you.
      ped.controlled = false;
      ped.fear = 10; ped.alarmed = 8; ped.state = "flee";
      // the desk officer says it: the nearest cop at the station, over his head
      const P0 = CBZ.player.pos;
      let desk = null, bd = 25 * 25;
      for (const c of (CBZ.cityCops || [])) {
        if (!c || c.dead || !c.pos) continue;
        const d2 = (c.pos.x - P0.x) * (c.pos.x - P0.x) + (c.pos.z - P0.z) * (c.pos.z - P0.z);
        if (d2 < bd) { bd = d2; desk = c; }
      }
      if (desk && CBZ.citySay) CBZ.citySay(desk, "That man did nothing. Hands on your head!", null, { secs: 2.8, force: true });
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
    "Come on, man. These are too tight.",
    "I got kids. Don't do this.",
    "You ain't even wearing a badge.",
    "Where are you taking me?!",
    "Somebody call my sister.",
    "I can't feel my hands.",
  ];
  CBZ.onUpdate(38.5, function (dt) {
    // Outside the city the NPC restraints die with the mode. The PLAYER's ties
    // are a different matter: systems/capture.js's haul scene puts them on in
    // the pen (escape) and takes them off itself, so there they are posed, not
    // cut. Every other mode still strips them.
    if (g.mode !== "city") {
      if (restrained.length) releaseAll();
      // the prison's haul scene ties the player itself and takes them off
      // itself; every other mode strips them
      if (g.mode !== "escape" && playerCuffed()) cuffPlayer(false);
      return;
    }
    if (!restrained.length) return;
    const P = CBZ.player;
    pleadCD -= dt; copSuspectCD -= dt;

    for (let i = restrained.length - 1; i >= 0; i--) {
      const ped = restrained[i];
      const r = ped && ped.restraint;
      // target died (shot mid-march, ragdolled) → the restraint dies cleanly with them
      if (!r || ped.dead) { if (ped) release(ped, { silent: true }); continue; }
      r.t += dt;

      /* MARCHING HIM TO THE DOOR IS A WALK, NOT A SNAP. While city/boarding.js
         is walking a cuffed body to a car door, easing it through the aperture
         or handing it back out at the kerb, that file owns the transform — this
         tick must not drag him back to your shoulder every frame. A CLINCH is
         deliberately excluded: you cannot be holding somebody in a headlock and
         have him politely walking to a car at the same time, so a grapple wins
         and the arc's own `arcInvalid` drops it. Feature-detected. */
      if (r.state === "boarding") {
        if (CBZ.boardingHolds && CBZ.boardingHolds(ped)) continue;
        // the arc ended: seated → riding, refused → still tied, standing there
        r.state = ped._cbzSeat ? "in_vehicle" : "cuffed";
        if (r.state === "cuffed") { r.vehicle = null; ped.target.set(ped.pos.x, 0, ped.pos.z); }
        I.refresh();
        continue;
      }
      if (r.state !== "grappled" && CBZ.boardingHolds && CBZ.boardingHolds(ped) && ped._cbzArc) continue;

      if (r.state === "grappled") {
        // player death / driving off mid-clinch / the grip gone = they're loose
        if (P.dead || P.driving || !held(ped)) { breakFree(ped); continue; }
        // CBZ.verbs.grab holds him (hands in his collar, his on your wrists)
        ped.target.set(ped.pos.x, 0, ped.pos.z); ped.speed = 0;
        ped.attackCD = Math.max(ped.attackCD || 0, 0.5);   // no swings from inside the clinch
        ped.pause = Math.max(ped.pause || 0, 0.5);
        if (ped.char) ped.char.guardBroke = r.t >= WEAR_T ? 1 : 0;   // visibly wearing down
        continue;
      }

      if (r.state === "escorted") {
        // CBZ.verbs.escort marches him (a hand on his arm, one on the ties).
        // Driving off, dying, a teleport that snapped the march: he stays put,
        // tied. An officer's escort (city/custody.js) is watched on the
        // officer, not on you.
        const H = r.officer || null;
        const lost = H
          ? (H.dead || Math.hypot(H.pos.x - ped.pos.x, H.pos.z - ped.pos.z) > TELEPORT_D || (VB() && !held(ped)))
          : (P.dead || P.driving || Math.hypot(P.pos.x - ped.pos.x, P.pos.z - ped.pos.z) > TELEPORT_D || !held(ped));
        if (lost) {
          letGo(ped, "set");
          r.state = "cuffed"; r.officer = null; ped.target.set(ped.pos.x, 0, ped.pos.z);
        } else ped.speed = 0;
      }

      if (r.state === "in_vehicle") {
        const car = r.vehicle;
        // car blown up / despawned → they tumble out at the wreck, still tied
        if (!car || car.dead || !car.group || !car.group.parent) {
          unseatBody(ped, car);
          r.state = "cuffed"; r.vehicle = null;
          ped.ko = Math.max(ped.ko || 0, 2);
          if (CBZ.body) CBZ.body.hit(ped, { dir: { x: Math.random() - 0.5, z: Math.random() - 0.5 }, force: 6, knockdown: 1.2 });
        } else if (ped._cbzSeat && ped._cbzSeat.veh === car) {
          /* HE IS IN A SEAT, VISIBLY, BEHIND THE GLASS. npclife's syncAttached
             re-asserts that seat every frame and the rig is parented to the
             car, so there is nothing to write here — writing anything would be
             the 41-files bug the shared re-assert exists to defeat. The old
             `pos.set(car.pos)` on a HIDDEN rig is the legacy path below, kept
             for the flag-off case. */
          ped.speed = 0;
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
        if (CBZ.animChar && !held(ped) && Math.hypot(ped.pos.x - P.pos.x, ped.pos.z - P.pos.z) < 70) CBZ.animChar(ped.char, 0, dt);
      }
      if (pleadCD <= 0 && Math.hypot(ped.pos.x - P.pos.x, ped.pos.z - P.pos.z) < 8 && Math.random() < 0.3) {
        pleadCD = 9;
        if (CBZ.citySay) CBZ.citySay(ped, PLEADS[(Math.random() * PLEADS.length) | 0], "#cfd6e6", 2.2);
      }
      // a working officer clocks a stranger marching a CLEAN citizen in ties —
      // a wanted gangster in cuffs gets a nod, not a call. Once per collar.
      if (!r._copSeen && r.state === "escorted" && r.by === "player" && !isWanted(ped) && copSuspectCD <= 0) {
        copSuspectCD = 2;
        const cops = CBZ.cityCops || [];
        for (let ci = 0; ci < cops.length; ci++) {
          const c = cops[ci];
          if (c.dead) continue;
          if (Math.hypot(c.pos.x - ped.pos.x, c.pos.z - ped.pos.z) < 16) {
            r._copSeen = true;
            if (CBZ.citySay) CBZ.citySay(c, "Hey! Step away from him. NOW.", "#ffd27b", 2.2);
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

  // ============================================================
  //  OPTIONS — all through the registry; every gate reads the enum.
  // ============================================================
  function escortingPed() {
    for (const p of restrained) if (st(p) === "escorted") return p;
    return null;
  }
  // your ride (owned or already boosted) parked within stuffing reach, or the
  // unit you called for him standing at the kerb (city/custody.js)
  function nearOwnCar(px, pz) {
    let best = null, bd = CAR_REACH * CAR_REACH;
    const cars = CBZ.cityCars || [];
    for (const c of cars) {
      if (c.dead || c.player) continue;
      if (c._custodyUnit) { if (c.ai) continue; }
      else if (c.npcDriver || !(c.owned || c.stolen)) continue;
      const dd = (c.pos.x - px) * (c.pos.x - px) + (c.pos.z - pz) * (c.pos.z - pz);
      if (dd < bd) { bd = dd; best = c; }
    }
    return best;
  }

  // ---- CUFF: earned two ways — at gunpoint on raised hands, or bare-handed
  //      on a body that's already down/broken. Same verb, two gates. ----
  // GRAMMAR LAW (owner): a label is a BUTTON — a bare verb phrase, one or two
  // words, NEVER the target's name (the card title already says it once).
  // "Zip Marcus's wrists" under a card titled Marcus was the canonical bug
  // (sighted on the airliner crew card, which rides these very options).
  I.register("ped", {
    id: "rs-cuff-gp", slot: "e", prio: 80, needsGunDrawn: true, bad: true,
    canShow: (p) => cuffablePed(p) && subdued(p),
    label: "Cuff",
    onSelect: (p) => cuff(p),
  });
  I.register("ped", {
    id: "rs-cuff", slot: "e", prio: 80, bad: true,
    // slot-e prio beats the grapple record, so a downed/broken fighter reads
    // "Cuff" while one still swinging reads "Grapple" — no
    // loose-boolean cross-gating (the framework bug this file exists to avoid).
    canShow: (p, ctx) => !ctx.gunDrawn && cuffablePed(p) && subdued(p),
    label: "Cuff",
    onSelect: (p) => cuff(p),
  });

  // ---- GRAPPLE: only on someone actually swinging, only with a free hand ----
  I.register("ped", {
    id: "rs-grapple", slot: "e", prio: 78, bad: true,
    canShow: (p, ctx) => cuffablePed(p) && fightingYou(p) && canClinch(ctx),
    label: "Grapple",
    onSelect: (p) => grapple(p),
  });
  // clinched: wear them down to tie, or end it ugly
  I.register("ped", {
    id: "rs-clinch-cuff", slot: "e", prio: 90, bad: true,
    canShow: (p) => st(p) === "grappled" && p.restraint.t >= WEAR_T,
    label: "Cuff",
    // the collar grip lets go and the cuff turns him (CBZ.verbs.cuff)
    onSelect: (p) => { if (st(p) === "grappled") { p.restraint = null; untrack(p); cuff(p); } },
  });
  I.register("ped", {
    id: "rs-slam", slot: "i", prio: 90, bad: true,
    canShow: (p) => st(p) === "grappled",
    label: "Slam",
    onSelect: (p) => slam(p),
  });
  I.register("ped", {
    id: "rs-shove", slot: "j", prio: 90, bad: true,
    canShow: (p) => st(p) === "grappled",
    label: "Shove",
    onSelect: (p) => shove(p),
  });

  // ---- CUFFED: march / halt / stuff / cut loose ----
  // a man officers are taking in (city/custody.js) is theirs, not yours:
  // your own collar keeps every verb, theirs offers none of them
  function stateHas(p) { const j = CBZ.custody && CBZ.custody.jobOf ? CBZ.custody.jobOf(p) : null; return !!(j && !j.opts.handsOff); }
  I.register("ped", {
    id: "rs-march", slot: "e", prio: 85,
    canShow: (p, ctx) => st(p) === "cuffed" && !ctx.driving && !stateHas(p),
    label: "March",
    onSelect: (p) => escort(p),
  });
  I.register("ped", {
    id: "rs-stand", slot: "e", prio: 85,
    canShow: (p) => st(p) === "escorted" && !stateHas(p),
    label: "Halt",
    onSelect: (p) => stand(p),
  });
  I.register("ped", {
    id: "rs-stuff", slot: "i", prio: 85, bad: true,
    canShow: (p, ctx) => (st(p) === "escorted" || st(p) === "cuffed") && !ctx.driving && !stateHas(p) && !!nearOwnCar(ctx.pos.x, ctx.pos.z),
    label: "Stuff in",
    onSelect: (p, ctx) => { const car = nearOwnCar(ctx.pos.x, ctx.pos.z); if (car) seat(p, car); },
  });
  // CALL IT IN: a unit drives up for the man you have cuffed; you put him in
  // the back (Stuff in) and it takes him away (city/custody.js)
  I.register("ped", {
    id: "rs-call-unit", slot: "j", prio: 84,
    canShow: (p, ctx) => (st(p) === "cuffed" || st(p) === "escorted") && p.restraint.by === "player" && !ctx.driving &&
      !!(CBZ.custody && CBZ.custody.take) && !CBZ.custody.jobOf(p),
    label: "Call a unit",
    onSelect: (p) => {
      const pres = !!(CBZ.presidency && CBZ.presidency.seat && CBZ.presidency.seat());
      CBZ.custody.take(p, { by: pres ? "ss" : "police", verb: pres ? "detain" : "arrest", handsOff: true, owner: "player" });
      I.refresh();
    },
  });
  I.register("ped", {
    id: "rs-cut-loose", slot: "l", prio: 85,
    canShow: (p) => (st(p) === "cuffed" || st(p) === "escorted") && !stateHas(p),
    label: "Cut loose",
    onSelect: (p) => release(p),
  });

  // ---- the back seat: drag a seated captive back out (on foot, your car) ----
  // A BENCH HOLDS TWO. `_captives` is the real list (`_captive` stays the
  // first of them for every legacy read); the label counts the bodies and the
  // verb empties the seat row, because pulling one man out of a car that has
  // two tied men in it and calling the job done is not an exit.
  function seatedCaptives(car) {
    const a = (car && car._captives) || (car && car._captive ? [car._captive] : []);
    return a.filter(function (p) { return p && !p.dead && st(p) === "in_vehicle"; });
  }
  I.register("vehicle", {
    id: "rs-unseat", slot: "i", prio: 85, bad: true,
    canShow: (car, ctx) => !ctx.driving && seatedCaptives(car).length > 0,
    label: (car) => { const n = seatedCaptives(car).length; return n > 1 ? "Drag out " + n : "Drag out"; },
    onSelect: (car) => { const a = seatedCaptives(car); for (let i = a.length - 1; i >= 0; i--) unseat(a[i]); },
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
      label: "Hand over",
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
      ? (isWanted(p) ? "They've got paper on this one, the desk pays cash" : "This one's clean, the desk doesn't pay for citizens")
      : "The desk takes collars";
    return { label: "Precinct Desk", note };
  });

  // ---- exports: the net layer calls these, same as the keys do --------------
  CBZ.cityRestrain = {
    stateOf: st, isWanted, bountyFor,
    cuff, grapple, escort, stand, release, seat, unseat, turnIn, slam, shove, handOff,
    releaseAll,
    // the player side of the same verbs (city/wanted.js's arrest arc)
    cuffPlayer, playerCuffed, posePlayerCuffs,
    // the march-one-pace-ahead offset, so the perp walk does not re-type it
    ESCORT_D,
  };
})();

/* ============================================================
   city/restrain.js — RESTRAINT + GRAPPLE: the people-handling layer.

   The owner's loop: CUFF someone who's earned it (hands-up at gunpoint,
   knocked down, or ground out of a clinch) → MARCH them down the street
   → STUFF them in your back seat → drive to the precinct desk → HAND
   THEM OVER for a payday. WHY: bounty-hunting is money + show-off — you
   parade a Lv.40 enforcer through downtown in zip ties and the block
   watches. THE HANDS are the disaster game's (systems/handverbs.js +
   grapple.js): hold E (or the thumb dock) grabs anybody, the hold set swaps
   in (Throw / Carry / Drop), a man who is down is picked up or dragged. A man
   in your hands is "grappled" on the enum below for as long as the grip
   lasts, which is what keeps the street's AI off him; hold him long enough
   and his struggle is worn down far enough to tie him.

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
   every frame for any rig in any game) and the march (a hand on his arm, one
   on the ties). The grip, the carry, the drag and the throw are the hands'
   (systems/handverbs.js), the same set the disaster game and the prison use.

   Registers through CBZ.interactions only — interact.js untouched.
   police.js provides the desk: CBZ.cityPoliceStation() (the intake
   point) + cops skip restrained peds when picking targets. The hand-over
   itself is city/custody.js's intake: he is walked through the door, never
   switched off at the desk.
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
    // A detention the state ordered on him (city/custody.js has a job: the
    // President's Detain, and nobody else's hands could reach him) is not one.
    const lawful = !!(CBZ.custody && CBZ.custody.jobOf && CBZ.custody.jobOf(ped));
    if (ped.restraint.by === "player" && !isWanted(ped) && !lawful && CBZ.cityCrime) {
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
     A real back seat, reached on foot: city/boarding.js walks the cuffed body
     to the door under its own legs and npclife puts it in the chair, visible
     through the glass, holding its seat while the car moves. The cap is the
     car's SEAT COUNT; `_captive` keeps meaning "the first captive in this car"
     for the places that read it.

     NO SEAT, NO RIDE. This used to fall back to a hidden back seat:
     `group.visible = false` and `pos.set(car.pos)`, the body gone from the
     street the frame it was "put in". city/custody.js reached for it whenever
     the door arc refused (a full car, a stuck walk), so an arrested man
     blinked out beside the cruiser in front of the player: the owner's "they
     just disappear after they get arrested". Deleted. A man who cannot be put
     in a real seat stays a body, cuffed, on the pavement, and custody.js
     walks him off instead. */
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
  function seat(ped, car) {
    if (!ped || !car || car.dead) return false;
    const s = st(ped);
    if (s !== "escorted" && s !== "cuffed") return false;
    if (!boardingUp()) return false;
    // `role: "captive"` is what sends him to the BACK: the seat picker puts a
    // tied man behind the driver
    if (CBZ.boarding.freeSeats && CBZ.boarding.freeSeats(car) <= 0) return false;
    const officer = ped.restraint.officer;
    letGo(ped, "set");                               // the car takes him from here
    ped.restraint.state = "boarding";
    ped.restraint.vehicle = car;
    ped.restraint.officer = null;
    const ok = CBZ.boarding.board(ped, car, { role: "captive", run: false });
    if (ok) { noteCaptive(car, ped); I.refresh(); return true; }
    ped.restraint.state = "cuffed";                  // refused: still tied, standing there
    ped.restraint.vehicle = null;
    ped.restraint.officer = s === "escorted" ? officer : null;
    if (s === "escorted") escort(ped, officer || undefined);
    return false;
  }
  function unseatBody(ped, car) {
    dropCaptive(car, ped);
    // in a trunk: out over the sill (city/cartrunk.js), where he was put
    if (ped._inTrunk && CBZ.carTrunk) { CBZ.carTrunk.out(ped, {}); return; }
    // a body city/boarding.js seated (or is walking to the door) leaves
    // through its door arc: CBZ.cityUnseat is the ONE sanctioned exit
    if ((ped._cbzSeat || ped._cbzArc) && CBZ.boarding && CBZ.boarding.alight) {
      CBZ.boarding.alight(ped);
      return;
    }
    ped.inCar = false;
    if (ped.group) ped.group.visible = true;
    ped.target.set(ped.pos.x, 0, ped.pos.z); ped.speed = 0;
  }
  function unseat(ped) {
    const s = st(ped);
    if (s !== "in_vehicle" && s !== "boarding") return false;
    const car = ped.restraint.vehicle;
    // a man you carried in with no ties on comes out a free man (stow below)
    if (ped.restraint.loose) { release(ped); return true; }
    unseatBody(ped, car);
    ped.restraint.state = "cuffed";
    ped.restraint.vehicle = null;
    I.refresh();
    return true;
  }

  // ---- THE HANDS (systems/handverbs.js games.city) ----------------------------
  /* The street used to have a grab of its own here: "Grapple" on a man
     swinging at you, a collar grip with Slam and Shove bolted on. It was the
     disaster game's grab with fewer verbs and its own throw. It is gone; the
     hands are one set for every game, and this file only says what they mean
     on this street: who they may take, how hard a man fights the grip (your
     read of each other), what a landing does to him, and what the city sees. */
  function clinchFight(ped) {
    const mine = CBZ.cityPlayerLevel ? CBZ.cityPlayerLevel() : 10;
    const theirs = CBZ.cityLevel ? CBZ.cityLevel(ped) : 10;
    return Math.max(0.1, Math.min(1, 0.45 + (theirs - mine) * 0.03));
  }
  // a body nothing else is moving: not in a seat, a car, a stall, a cell of
  // somebody else's job, and not already in ties (the march verbs have him)
  function handable(p) {
    if (!p || p.dead || p.isPlayer || p.player || p.culled || p.animal || p.kind === "dog") return false;
    if (!p.group || !p.group.parent || p.group.visible === false || !p.char) return false;
    if (p.inCar || p._cbzSeat || p._cbzArc || p._boardOwn || p._parked || p._propSeat || p._propLie || p._npcAttached) return false;
    if (p.vendor || p.staffPost || p._iOnly || p.hostage || p === g.cityHostage || p._custody) return false;
    if (p.restraint && p.restraint.state !== "grappled") return false;
    return true;
  }
  function handsFree() {
    const P = CBZ.player;
    if (!P || P.dead || P.driving || P._aircraft || P._mountedAnimal) return false;
    if (CBZ.cuffedPlayer && CBZ.cuffedPlayer.on()) return false;
    const sw = CBZ.citySwimState ? CBZ.citySwimState() : null;
    return !(sw && sw.swimming);
  }
  function castInto(out, list) {
    if (!list) return;
    for (let i = 0; i < list.length; i++) if (handable(list[i])) out.push(list[i]);
  }
  function lawfulHold(p) { return !!(CBZ.custody && CBZ.custody.jobOf && CBZ.custody.jobOf(p)); }
  function seen(p, amount, type) {
    if (!p || !p.pos || !CBZ.cityCrime) return;
    CBZ.cityCrime(amount, { x: p.pos.x, z: p.pos.z, type: type });
  }
  // what the street makes of hands on somebody (the harm funnel: social.js)
  function onHands(p, kind) {
    if (!p || p.dead) return;
    const rel = CBZ.cityRelShift;
    const cop = p.kind === "cop";
    if (kind === "held") {
      if (rel) rel(p, "threatened");
      if (cop) seen(p, 60, "assault");
    } else if (kind === "carried") {
      if (rel) rel(p, "passengerTaken");
      if (cop) seen(p, 80, "assault");
      else if (!isWanted(p) && !lawfulHold(p)) seen(p, 40, "kidnapping");
    } else if (kind === "thrown" || kind === "tackled") {
      if (rel) rel(p, "beaten");
      if (kind === "tackled") seen(p, cop ? 60 : 30, "assault");
    } else if (kind === "shoved") {
      if (rel) rel(p, "intimidated");
    }
  }
  // the landing is the blow: the pavement, a wall, the harbour (the world
  // decided where he went; this is what it costs him, and what the block saw)
  function thrownHurt(ped) {
    const fx = CBZ.player.pos.x, fz = CBZ.player.pos.z;
    return function (S, kind) {
      if (!S || S.verb !== "throw" || ped.dead) return;
      if (kind !== "water" && kind !== "wall" && kind !== "open" && kind !== "ledge" && kind !== "rail") return;
      ped.hp -= kind === "water" ? 8 : kind === "wall" ? 38 : 30;
      if (ped.hp <= 0) {
        if (ped.kind === "cop") { if (CBZ.cityHurtCop) CBZ.cityHurtCop(ped, 200, { fromX: fx, fromZ: fz }); }
        else if (CBZ.cityKillPed) CBZ.cityKillPed(ped, { fromX: fx, fromZ: fz, force: 7 }, kind === "wall" ? "slammed into a wall" : "slammed into the pavement");
      } else {
        if (kind !== "water") ped.ko = Math.max(ped.ko || 0, 3.5);
        seen(ped, ped.kind === "cop" ? 70 : 45, "assault");
        if (CBZ.cityAlarm) CBZ.cityAlarm(ped.pos.x, ped.pos.z, 12, 0.8, pa());
      }
      CBZ.player._fighting = 1.5;
    };
  }
  if (CBZ.handVerbs && CBZ.handVerbs.games) {
    CBZ.handVerbs.games.city = {
      can: handsFree,
      cands: function (out) { castInto(out, CBZ.cityPeds); castInto(out, CBZ.cityCops); return out; },
      // he fights a collar grip as well as your read of each other says he can
      grabOpts: function (t, opts, up) { if (up) opts.struggle = clinchFight(t); return opts; },
      onHands: onHands,
      thrown: thrownHurt,
    };
    // the islands' street is the same street (city/peds.js runs there): the
    // same hands, the same grip fights, the same crimes
    CBZ.handVerbs.games.archipelago = CBZ.handVerbs.games.city;
  }

  /* THE OWNED BODY. While your hands have him (a grip, a carry, a drag) he is
     "grappled" on the enum, so the street leaves him alone: no swing, no
     flight, no march, cops skip him (CBZ.verbs owns his root through
     _phys.heldBy, which every mover already skips). The grip ending sets him
     loose; a thrown man is the air's until he lands. */
  const HOLDS = { grab: 1, carry: 1, drag: 1 };
  let handT = null, handPed = null;
  function handTarget() {
    const v = VB(), me = pa();
    const S = v && me ? v.sessionOf(me) : null;
    // a grip becoming a carry walks in again (an approach beat): still his
    return S && S.a === me && HOLDS[S.verb] && !S.tFree && (S.phase !== "approach" || S.t === handT) ? S.t : null;
  }
  function letLoose(ped) {
    if (ped._stowing) return;          // going in the back of your car (stow below)
    if (st(ped) === "grappled") { ped.restraint = null; untrack(ped); }
    ped.controlled = false;
    if (ped.char) ped.char.guardBroke = 0;
    if (ped.dead || (ped.ko || 0) > 0) return;
    // a hard man squares up; anybody else gets away from you
    if (ped.kind !== "cop" && (ped.gang || ped.armed || (ped.aggr || 0) >= 0.6)) { ped.rage = pa(); ped.state = "fight"; }
    else if (ped.kind !== "cop") { ped.fear = Math.max(ped.fear || 0, 6); ped.state = "flee"; }
  }
  function bindHands() {
    const t = handTarget();
    if (t === handT) return;
    handT = t;
    if (handPed && handPed !== t) { letLoose(handPed); handPed = null; }
    if (t && !t.dead && t.kind !== "cop" && !t.restraint && (CBZ.cityPeds || []).indexOf(t) >= 0) {
      t.restraint = { state: "grappled", by: "player", t: 0, vehicle: null };
      track(t);
      t.controlled = true; t.rage = null; t.state = "walk"; t.speed = 0;
      t.path = null; t.finalGoal = null;
      t.attackCD = Math.max(t.attackCD || 0, 1);
      handPed = t;
    }
    I.refresh();
  }

  /* ---- THE MAN IN YOUR HANDS GOES IN THE TRUNK, OR THE BACK (stow) --------
     OWNER (2026-10-22): "when I press E to drive a car but I'm holding a
     person over my shoulder, it should put them in the trunk or backseat: my
     character should physically open it and throw them in, unless I drop
     them before entering the vehicle."

     Every way into a car ends in CBZ.cityEnterVehicle (F, the ride router,
     the door pin, a tap on the car, the pad's Y), so this is one wrap on it.
     With a man in your hands (a grip, a carry, a drag) the press becomes a
     beat at whichever of the car's two places for him you are nearer:

       THE TRUNK   (city/cartrunk.js: a boot, a tailgate's cargo floor, a
                   pickup's bed) you walk to the back of the car, the lid
                   comes up, he goes in off your shoulder and the lid slams.
       THE BACK    a free seat that is not the wheel: you walk to its door
                   (CBZ.boarding.seatFor), the real door swings open
                   (CBZ.boarding.door), you set him down into it
                   (CBZ.boarding.load), the door shuts.

     Then the ordinary entry runs (your own door, the wheel), unless it was
     the trunk's own pin ("Trunk") that started it. Drop him first (tap E)
     and F is just F. A car with neither (a full coupe, one somebody is
     driving): F is just F, and he drops when you get in.

     He rides as cargo: restraint "in_vehicle" with `loose` (no ties on him;
     `trunk` when he is in one). Drag out (the back seat) / Take out (the
     trunk) has him out again a free man; a wreck lets him go. A cuffed man is
     not carried: he is marched, then Stuffed in (rs-stuff). */
  const STOW_WALK_MAX = 6;        // s: the walk to the door gives up after this
  const STOW_REACH = 0.85;        // m from the stand point that counts as at the door
  const STOW_OPEN_T = 0.4, STOW_PUT_MAX = 1.4, STOW_SHUT_T = 0.35;
  const LID_UP_MAX = 0.9, LID_LAND_T = 0.45;
  let stowJob = null;
  function stowSeat(car) {
    const B = CBZ.boarding;
    if (!car || car.dead || car.player || !B || !B.seatFor || !B.load || !B.door) return null;
    if (car.npcDriver && !car.npcDriver.dead) return null;
    if (CBZ.carNpcDriven && CBZ.carNpcDriven(car)) return null;
    return B.seatFor(car);
  }
  function stowTrunkAt(car) {
    const TR = CBZ.carTrunk;
    if (!car || car.dead || car.player || !TR || !TR.of(car) || !TR.room(car)) return null;
    if ((car.npcDriver && !car.npcDriver.dead) || (CBZ.carNpcDriven && CBZ.carNpcDriven(car))) return null;
    return TR.standAt(car);
  }
  // opts.trunk: only the trunk; opts.enter === false: do not get in after
  function stowStart(car, opts) {
    opts = opts || {};
    const P = CBZ.player;
    if (stowJob || !P || P.dead || P.driving || P._aircraft || !CBZ.economyMode()) return false;
    const t = handTarget();
    if (!t || t.dead || t !== handPed || st(t) !== "grappled") return false;
    const T = stowTrunkAt(car);
    const seat = opts.trunk ? null : stowSeat(car);
    let trunk = !!T && (!!opts.trunk || !seat);
    // both: the nearer of the two, so F at the back of the car is the trunk
    if (T && seat && !opts.trunk) trunk = Math.hypot(T.x - P.pos.x, T.z - P.pos.z) < Math.hypot(seat.x - P.pos.x, seat.z - P.pos.z);
    if (!trunk && !seat) return false;
    t._stowing = true;
    stowJob = { car: car, seatId: trunk ? null : seat.id, trunk: trunk, ped: t, phase: "walk", t: 0, enter: opts.enter !== false };
    return true;
  }
  function stowKeys(on) { const k = CBZ.keys; if (k) { k.w = !!on; if (!on) k.shift = false; } }
  function faceTo(x, z, dt, rate) {
    const P = CBZ.player, cam = CBZ.cam;
    if (!cam || !P) return;
    const want = Math.atan2(-(x - P.pos.x), -(z - P.pos.z));
    let d = want - cam.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    cam.yaw += d * Math.min(1, dt * (rate || 9));
  }
  // walked off, shot, or he got loose: the beat is over, he is in your hands
  // or on the ground exactly as the hands left him
  function stowAbort() {
    const j = stowJob; stowJob = null;
    if (!j) return;
    if (j.phase === "walk") stowKeys(false);
    const p = j.ped;
    p._stowing = false;
    if (j.trunk && j.car && !p._inTrunk && CBZ.carTrunk) CBZ.carTrunk.lid(j.car, 0);
    if (st(p) === "grappled" && !held(p)) { if (p === handPed) { handPed = null; handT = null; } letLoose(p); }
  }
  function stowSeatIn(j) {
    const p = j.ped, car = j.car;
    if (CBZ.bodyFall && CBZ.bodyFall.active && CBZ.bodyFall.active(p) && CBZ.bodyFall.clear) CBZ.bodyFall.clear(p);
    p._stowing = false;
    if (p === handPed) { handPed = null; handT = null; }
    if (!CBZ.boarding.load(p, car, j.seatId)) {
      if (st(p) === "grappled") letLoose(p);
      return false;
    }
    p.restraint = { state: "in_vehicle", by: "player", t: 0, vehicle: car, loose: true };
    track(p);
    noteCaptive(car, p);
    I.refresh();
    return true;
  }
  // off your shoulder and into the trunk (city/cartrunk.js put: the carry
  // ends in his throw into the box, never a set-down on the road first)
  function stowTrunkIn(j) {
    const p = j.ped, car = j.car;
    p._stowing = false;
    if (p === handPed) { handPed = null; handT = null; }
    const r0 = p.restraint;
    if (!CBZ.carTrunk || !CBZ.carTrunk.put(p, car)) {
      if (st(p) === "grappled") { if (held(p)) letGo(p, "set"); letLoose(p); }
      return false;
    }
    p.restraint = { state: "in_vehicle", by: (r0 && r0.by) || "player", t: 0, vehicle: car, loose: true, trunk: true };
    track(p);
    I.refresh();
    return true;
  }
  CBZ.onUpdate(33.2, function (dt) {
    const j = stowJob;
    if (!j) return;
    const P = CBZ.player, car = j.car, p = j.ped;
    if (!CBZ.economyMode() || g.state !== "playing" || !P || P.dead || P.driving || p.dead ||
      !car || car.dead || !car.group || !car.group.parent) { stowAbort(); return; }
    j.t += dt;
    const TR = CBZ.carTrunk;
    // where you stand, and what you face: the back of the car, or the door
    let S = null;
    if (j.trunk) { const T = TR ? TR.standAt(car) : null; if (T) S = { x: T.x, z: T.z, doorX: T.faceX, doorZ: T.faceZ }; }
    else S = CBZ.boarding.seatFor(car, j.seatId);
    if (!S) { stowAbort(); return; }
    if (j.phase === "walk") {
      if (!held(p)) { stowAbort(); return; }                 // he was dropped on the way
      const d = Math.hypot(S.x - P.pos.x, S.z - P.pos.z);
      if (d <= STOW_REACH || (j.t > STOW_WALK_MAX && d < 2.2)) {
        stowKeys(false);
        j.phase = "open"; j.t = 0;
        if (!j.trunk && CBZ.sfx) { try { CBZ.sfx("door_open"); } catch (e) {} }
        return;
      }
      if (j.t > STOW_WALK_MAX) { stowAbort(); return; }
      faceTo(S.x, S.z, dt, 9);
      stowKeys(true);
      return;
    }
    if (j.trunk) {
      faceTo(S.doorX, S.doorZ, dt, 12);
      const T = TR.of(car), hasLid = !!(T && T.lid);
      if (j.phase === "open") {
        if (!held(p)) { stowAbort(); return; }
        // the free hand lifts the lid (a bed has none) and he goes in
        if (hasLid) TR.lid(car, 1);
        if (!hasLid || TR.openT(car) >= 0.85 || j.t >= LID_UP_MAX) {
          j.phase = stowTrunkIn(j) ? "land" : "enter"; j.t = 0;
        }
        return;
      }
      if (j.phase === "land") {
        if (j.t < LID_LAND_T) return;                            // he lands in the box
        if (hasLid) TR.lid(car, 0);                              // and it slams
        j.phase = "shut"; j.t = 0;
        return;
      }
      if (j.phase === "shut") {
        if (hasLid && TR.openT(car) > 0.02 && j.t < 0.6) return;
        j.phase = "enter";
      }
      stowJob = null;
      if (j.enter && CBZ.cityEnterVehicle) CBZ.cityEnterVehicle(car);
      return;
    }
    if (j.phase === "open") {
      if (!held(p)) { stowAbort(); return; }
      faceTo(S.doorX, S.doorZ, dt, 12);
      CBZ.boarding.door(car, j.seatId, Math.min(1, j.t / STOW_OPEN_T));
      if (j.t >= STOW_OPEN_T) { letGo(p, "set"); j.phase = "put"; j.t = 0; }
      return;
    }
    if (j.phase === "put") {
      CBZ.boarding.door(car, j.seatId, 1);
      if (held(p) && j.t < STOW_PUT_MAX) return;              // he is still coming off your shoulder
      if (held(p)) letGo(p, "drop");
      j.phase = stowSeatIn(j) ? "shut" : "enter"; j.t = 0;
      return;
    }
    if (j.phase === "shut") {
      CBZ.boarding.door(car, j.seatId, Math.max(0, 1 - j.t / STOW_SHUT_T));
      if (j.t < STOW_SHUT_T) return;
      if (CBZ.sfx) { try { CBZ.sfx("door_close"); } catch (e) {} }
      j.phase = "enter";
    }
    // and now you get in, through your own door
    stowJob = null;
    if (j.enter && CBZ.cityEnterVehicle) CBZ.cityEnterVehicle(car);
  });
  // one wrap on the one way into a car (after city/boarding.js's door arc)
  let stowWrapTries = 0;
  function wrapEnterForStow() {
    const f = CBZ.cityEnterVehicle;
    if (typeof f !== "function") return false;
    if (f._stowWrapped) return true;
    if (!f._boardWrapped && ++stowWrapTries < 100) return false;   // outside the door arc's wrap
    const w = function (car, opts) {
      if (opts && opts.instant) return f.apply(this, arguments);
      if (stowJob) return true;                 // the beat is running: this press is spent
      if (stowStart(car)) return true;
      return f.apply(this, arguments);
    };
    for (const k in f) { if (/Wrapped$/.test(k)) w[k] = f[k]; }
    w._stowWrapped = true;
    CBZ.cityEnterVehicle = w;
    return true;
  }
  if (!wrapEnterForStow()) { const iv = setInterval(function () { if (wrapEnterForStow()) clearInterval(iv); }, 100); }

  // ---- TURN IN: the desk pays for paper, and only for paper ------------------
  /* HE IS WALKED IN, NOT ERASED. A collar handed over here used to go through
     police.js's CBZ.cityStationIntake on the spot: `group.visible = false`
     and a teleport to (-9999, -9999), a cuffed man gone from under your hand
     at the desk. Now the desk TAKES him (city/custody.js intake): still in
     the cuffs, a desk officer's hand on his arm when one is near, walked
     through the door, and he leaves play only where nobody can see him. */
  function turnIn(ped) {
    if (!ped || !ped.restraint || ped.dead) return false;
    const r = ped.restraint;
    const wanted = isWanted(ped);
    const pay = wanted ? bountyFor(ped) : 0;
    const tag = ped.bountyTag || "";
    const CU = CBZ.custody;
    // a man the state detained (custody.js holds him: the President's Detain,
    // then Jail and you drove him in) is booked like a collar, paid only for paper
    const detainee = !!(CU && CU.jobOf && CU.jobOf(ped));
    if ((wanted || detainee) && CU && CU.intake) {
      // out of the back seat by its own door, then off your hands
      if (r.state === "in_vehicle" || r.state === "boarding") unseat(ped);
      if (r.state === "escorted") { letGo(ped, "set"); r.state = "cuffed"; r.officer = null; }
      ped.bounty = 0; ped.bountyTag = null;
      ped.npcHeat = 0; ped.npcWanted = 0; ped.rage = null; ped.rampage = null;
      const S = CBZ.cityPoliceStation && CBZ.cityPoliceStation();
      if (!CU.intake(ped, S || { x: ped.pos.x, z: ped.pos.z }, { by: "player" })) return false;
      if (pay > 0) {
        CBZ.city && CBZ.city.addCash(pay);
        CBZ.city && CBZ.city.addRespect(4);
        if (CBZ.sfx) CBZ.sfx("coin");
        CBZ.city && CBZ.city.big("COLLAR + $" + pay + (tag ? " — " + tag : ""));
      }
      if (CBZ.pushKill) CBZ.pushKill(nm(ped) + " was turned in", "#7ed957");
      I.refresh();
      return true;
    }
    if (r.state === "in_vehicle" || r.state === "boarding") unseatBody(ped, r.vehicle);
    ped.restraint = null;
    untrack(ped);
    letGo(ped, "set");
    tie(ped, false);
    if (wanted) {
      // no custody layer loaded: the old desk (police.js's intake)
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
  let copSuspectCD = 0;
  CBZ.onUpdate(38.5, function (dt) {
    // Outside the city the NPC restraints die with the mode. The PLAYER's ties
    // are a different matter: systems/capture.js's haul scene puts them on in
    // the pen (escape) and takes them off itself, so there they are posed, not
    // cut. Every other mode still strips them.
    // (the islands are policed by the same force: the cuffs stay on there too)
    if (!CBZ.economyMode()) {
      handT = null; handPed = null;
      if (restrained.length) releaseAll();
      // the prison's haul scene ties the player itself and takes them off
      // itself; every other mode strips them
      if (g.mode !== "escape" && playerCuffed()) cuffPlayer(false);
      return;
    }
    bindHands();
    if (!restrained.length) return;
    const P = CBZ.player;
    copSuspectCD -= dt;

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
         and the arc's own `arcInvalid` drops it. Feature-detected.
         THE ARC, NOT boardingHolds: boardingHolds is also true for a body
         already SEATED (`_cbzSeat`), so asking it here kept a seated man
         "boarding" forever. custody.js then gave up on the load after 14 s,
         pulled him back out and stuffed him in the old hidden back seat: the
         man vanished beside the cruiser in front of the player. */
      if (r.state === "boarding") {
        if (ped._cbzArc || ped._boardOwn) continue;
        // the arc ended: seated → riding, refused → still tied, standing there
        r.state = ped._cbzSeat ? "in_vehicle" : "cuffed";
        if (r.state === "cuffed") { r.vehicle = null; ped.target.set(ped.pos.x, 0, ped.pos.z); }
        I.refresh();
        continue;
      }
      if (r.state !== "grappled" && CBZ.boardingHolds && CBZ.boardingHolds(ped) && ped._cbzArc) continue;

      if (r.state === "grappled") {
        // player death / driving off with him in hand / the grip gone = loose
        if (P.dead || P.driving) letGo(ped, "drop");
        if (P.dead || P.driving || ped !== handPed || !held(ped)) { if (ped === handPed) handPed = null; letLoose(ped); continue; }
        // CBZ.verbs holds him (a collar grip, a shoulder, a drag)
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

      if (r.state === "in_vehicle" && r.trunk) {
        // city/cartrunk.js holds him (the lid, the crash, the water, the law);
        // a trunk that let him out without saying so has ended the record
        if (!ped._inTrunk) release(ped, { silent: true });
        continue;
      }
      if (r.state === "in_vehicle") {
        const car = r.vehicle;
        // car blown up / despawned → they tumble out at the wreck, still tied
        if (r.loose && (!car || car.dead || !car.group || !car.group.parent || !(ped._cbzSeat && ped._cbzSeat.veh === car))) {
          // carried in untied: the wreck (or a lost seat) lets him go free
          release(ped, { silent: true });
          if (car && car.dead) ped.ko = Math.max(ped.ko || 0, 2);
          continue;
        }
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
          // "in a car" with no seat under him is a state nothing can draw:
          // he is standing where he is, still tied
          r.state = "cuffed"; r.vehicle = null; dropCaptive(car, ped);
          ped.target.set(ped.pos.x, 0, ped.pos.z);
        }
        continue;
      }
      // city/custody.js is walking him (through the precinct door, or off
      // down the street with nobody to drive him): its legs, not this pin
      if (ped._custody && ped._custody.walking) continue;

      // cuffed (standing or escorted): held still, hands pinned, mouth running
      ped.controlled = true; ped.rage = null;
      if (ped.state === "flee" || ped.state === "fight") ped.state = "walk";
      if (r.state === "cuffed") {
        // pinned in place every frame so nothing (panic, gunfire) walks them off
        ped.speed = 0; ped.target.set(ped.pos.x, 0, ped.pos.z);
        if (CBZ.animChar && !held(ped) && Math.hypot(ped.pos.x - P.pos.x, ped.pos.z - P.pos.z) < 70) CBZ.animChar(ped.char, 0, dt);
      }
      // the ties went on: he says it once, to the man who did it (systems/voice.js)
      if (!r._voiced && Math.hypot(ped.pos.x - P.pos.x, ped.pos.z - P.pos.z) < 8 && CBZ.voice) {
        r._voiced = true;
        CBZ.voice.react(ped, "restrained", { by: CBZ.city && CBZ.city.playerActor });
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
    // a downed/broken man reads "Cuff" on E; the hands (hold E) are the
    // other record on the same key, no loose-boolean cross-gating (the
    // framework bug this file exists to avoid).
    canShow: (p, ctx) => !ctx.gunDrawn && cuffablePed(p) && subdued(p),
    label: "Cuff",
    onSelect: (p) => cuff(p),
  });

  // ---- THE HANDS ON THE STREET (the one grab: systems/handverbs.js) ----------
  // HOLD E on a person: Grab (Pick up on a man who is down). His options are
  // on I J K L (tap E is the first of them); the hands are hold E, and the
  // man in your hands is tap E (set down) / hold E (tie) / I (Carry). The
  // throw is the attack button's. A clinch only works empty-handed or
  // with a one-hand gun: you cannot take a man by the collar around a rifle.
  const HV = () => CBZ.handVerbs || null;
  function downed(p) { const v = VB(), B = v && v.body ? v.body(p) : null; return !!(B && B.down && B.down()); }
  I.register("ped", {
    id: "rs-hand-grab", slot: "e", hold: true, prio: 20, bad: true,
    canShow: (p, ctx) => !ctx.driving && canClinch(ctx) && handsFree() && handable(p) && !held(p) &&
      !(VB() && VB().holding(pa())),
    label: (p) => downed(p) ? "Pick up" : "Grab",
    onSelect: (p) => { const G = CBZ.grapple, H = HV(); if (G) G.grab(p, H && H.farOpts ? H.farOpts(p) : undefined); },
  });
  // THE MAN IN YOUR HANDS owns the card (a zero-distance source, like the
  // duffel on your shoulder): tap E lets him down; hold E ties him once his
  // struggle is worn down; the wheel has the rest of the hold set.
  function heldNow() { const H = HV(); return H ? H.held() : null; }
  I.registerSource({
    id: "src-hands", islands: true, kind: "pedheld", layers: ["pedheld"], prio: 45, driving: false,
    find: function (px, pz, ctx, push) { const H = heldNow(); if (H && H.t && !H.t.dead) push(H.t, 0); },
  });
  I.describe("pedheld", function (t) { return { label: (t && t.name) || "" }; });
  I.register("pedheld", {
    id: "rs-hand-drop", slot: "e", prio: 100,
    label: () => { const H = heldNow(); return H && H.kind === "drag" ? "Let go" : "Drop"; },
    onSelect: () => { if (CBZ.grapple) CBZ.grapple.release(false); },
  });
  I.register("pedheld", {
    id: "rs-hand-cuff", slot: "e", hold: true, prio: 90, bad: true,
    canShow: (p) => { const H = heldNow(); return !!(H && H.kind === "hold") && st(p) === "grappled" && p.restraint.t >= WEAR_T; },
    label: "Cuff",
    // the collar grip lets go and the cuff turns him (CBZ.verbs.cuff)
    onSelect: (p) => { if (st(p) === "grappled") { p.restraint = null; untrack(p); if (p === handPed) handPed = null; cuff(p); } },
  });
  I.register("pedheld", {
    id: "rs-hand-throw", wheel: true, prio: 80, bad: true,
    label: () => (HV() ? HV().throwWord() : "Throw"),
    canShow: () => { const H = heldNow(); return !!(H && H.kind !== "drag"); },
    onSelect: () => { if (CBZ.grapple) CBZ.grapple.release(true); },
  });
  I.register("pedheld", {
    id: "rs-hand-carry", prio: 70,
    canShow: () => { const H = heldNow(); return !!(H && H.kind === "hold"); },
    label: "Carry",
    onSelect: (p) => { const v = VB(); if (v && pa()) v.carry(pa(), p); },
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
    label: "Radio in",
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
      if (p._custody && p._custody.state === "intake") continue;   // the desk already has him
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
    cuff, escort, stand, release, seat, unseat, turnIn, handOff,
    releaseAll,
    // the man in your hands into this car's trunk (city/cartrunk.js's pin)
    stowTrunk: function (car, opts) { return stowStart(car, Object.assign({ trunk: true }, opts || {})); },
    stowBusy: function () { return !!stowJob; },
    // the player side of the same verbs (city/wanted.js's arrest arc)
    cuffPlayer, playerCuffed, posePlayerCuffs,
    // the march-one-pace-ahead offset, so the perp walk does not re-type it
    ESCORT_D,
  };
})();

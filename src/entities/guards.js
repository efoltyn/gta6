/* ============================================================
   entities/guards.js — patrolling guards: model, waypoints, AI,
   and the line-of-sight test that feeds the detection system.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { makeCharacter, animChar, lerpAngle, visionWedge, player } = CBZ;

  // jail feature flag (self-defaulting — one-line revert via CBZ.CONFIG):
  // guards call out their state changes ("STOP RIGHT THERE!") near the player.
  if (CBZ.CONFIG && CBZ.CONFIG.JAIL_GUARD_BARKS == null) CBZ.CONFIG.JAIL_GUARD_BARKS = true;

  let guardNo = 0;
  function addFlashlight(ch) {
    // ONE MODEL at every scale: weapons/flashlight.js also feeds the physical
    // death drop and the inventory thumbnail.  Its +Z is the light direction;
    // rotate that axis onto the hand socket's -Y (down the forearm), so the
    // reflector sits beyond the fingers and the parented beam leaves the lens.
    const group = CBZ.buildFlashlight ? CBZ.buildFlashlight() : new THREE.Group();
    group.position.set(0.01, -0.025, 0.025);
    group.rotation.x = Math.PI / 2;
    const lens = group.userData.lens || null;
    const lensMat = group.userData.lensMat || (lens && lens.material) || CBZ.mat(0xe8f6ff, { emissive: 0x000000, ei: 0 });
    group.visible = false;
    ch.sockets.rightHand.add(group);
    return { group, lens, lensMat };
  }

  function makeGuard(waypoints, speed, viewDist, half, opts) {
    opts = opts || {};
    const warden = opts.kind === "warden";
    // wardens wear a darker dress uniform with a peaked cap
    const ch = makeCharacter(warden ? {
      legs: 0x14182a, torso: 0x1a2138, collar: 0x0e1322, arms: 0x1a2138,
      skin: 0xdcae84, cap: 0x0e1322, shoes: 0x080808, belt: 0x0a0d18, badge: true,
    } : {
      legs: 0x232c47, torso: 0x2b3a67, collar: 0x1d2a4d, arms: 0x2b3a67,
      skin: 0xe7b58c, cap: 0x1d2a4d, shoes: 0x141414, belt: 0x14182a, badge: true,
    });
    ch.group.userData.dynamic = true;
    (CBZ.prisonRoot || CBZ.scene).add(ch.group);

    const wedge = visionWedge(viewDist, half, 18, 0xffe14d);
    wedge.visible = false;
    ch.group.add(wedge);
    const flashlight = addFlashlight(ch);

    const name = warden ? "the Warden" : "Officer #" + (++guardNo);
    const id = guardNo || 0;
    const g = {
      char: ch, group: ch.group, wedge, flashlight,
      waypoints: waypoints.map((p) => new THREE.Vector3(p[0], 0, p[1])),
      start: new THREE.Vector3(waypoints[0][0], 0, waypoints[0][1]),
      wi: 0, speed, viewDist, half, alert: 0, dead: false, ko: 0,
      state: "patrol",   // named AI state — stamped by updateGuard every frame
      kind: opts.kind || "guard", id, bribed: 0, flashlightOn: false,
      flashlightPatrol: opts.flashlightPatrol != null ? !!opts.flashlightPatrol : (warden || (id % 3 === 1)),
      flashlightPhase: opts.flashlightPhase != null ? opts.flashlightPhase : (id * 6.7 + (warden ? 2.4 : 0)),
      data: {
        name, pool: null, offer: null,
        talk: warden
          ? ["Plotting something, are we? I'm always watching.",
             "This is MY block. Step out of line and you'll regret it.",
             "The gun room stays locked. My key, my rules."]
          : ["Keep moving, inmate.", "Nothing to see here.", "Back to your block."],
      },
    };
    // a post named by the roster outranks the one systems/economy.js derives
    // from the waypoints (a corridor officer walks a long straight line that
    // the derivation would read as a yard patrol)
    if (opts.post) { g.post = opts.post; g.rank = opts.rank != null ? opts.rank : 1; }
    g.group.position.copy(g.start);
    CBZ.guards.push(g);
    return g;
  }

  // indoor patrol guarding the cell-block exit
  makeGuard([[0, -13], [0, -39]], 3.0, 12, 0.62);
  // yard patrols overlapping the centre lane to the exit
  makeGuard([[-18, 4], [-18, 46], [-2, 46], [-2, 4]], 3.6, 14, 0.6);
  makeGuard([[18, 8], [18, 44], [6, 44], [6, 8]], 3.6, 14, 0.6);
  // extra perimeter patrols (more guards, as requested)
  makeGuard([[-26, 8], [-26, 48], [-20, 48]], 3.2, 13, 0.58);
  makeGuard([[26, 12], [26, 46], [20, 46]], 3.2, 13, 0.58);
  makeGuard([[-12, 6], [12, 6], [12, 14], [-12, 14]], 3.0, 12, 0.55);
  // ---- south block patrols (the new lower yard + sally port) ----
  makeGuard([[-20, 60], [-20, 110], [-6, 110], [-6, 60]], 3.6, 14, 0.6);
  makeGuard([[20, 64], [20, 108], [6, 108], [6, 64]], 3.6, 14, 0.6);
  makeGuard([[-30, 70], [-30, 116], [-22, 116]], 3.2, 13, 0.58);
  makeGuard([[30, 74], [30, 112], [22, 112]], 3.2, 13, 0.58);
  // the sally-port detail watching the freedom gate
  // (2026-09-05: the exit is a fenced walkway x±4.7 into world/sallyport.js's
  //  building, so the detail holds its west flank instead of a box across it;
  //  his nearest waypoint is 10.8 m from the wall line, still `post: gate`,
  //  and systems/economy.js hangs the Gate Key on that post's belt)
  makeGuard([[-12, 119], [-6, 119], [-6, 111], [-12, 111]], 3.0, 15, 0.64);
  /* PERIMETER PATROLS (2026-09-04). The sterile zone world/prisongrounds.js
     fences off inside the outer wall is a patrol road, and a patrol road with
     nobody on it is the empty ring again. One man per side, walking the
     road between the corner towers; the legs are straight and clear. */
  makeGuard([[-120.5, -100], [-120.5, 112]], 3.0, 15, 0.6, { post: "perimeter" });
  makeGuard([[120.5, -100], [120.5, 112]], 3.0, 15, 0.6, { post: "perimeter" });
  makeGuard([[-108, -112.5], [84, -112.5]], 3.0, 15, 0.6, { post: "perimeter" });
  makeGuard([[-108, 124.5], [-64, 124.5]], 3.0, 15, 0.6, { post: "perimeter" });
  /* THE CORRIDORS (world/corridors.js). Movement officers walk the spine's
     four legs and carry the Corridor Key — the one ring every grille in the
     network answers to (systems/economy.js hangs it on `post: corridor`).
     A posted officer stands each ring building: he holds nothing but a
     baton, which is what a post officer holds. */
  makeGuard([[-40, -60], [-40, 36]], 2.8, 14, 0.6, { post: "corridor", rank: 2 });
  makeGuard([[40, 36], [40, -60]], 2.8, 14, 0.6, { post: "corridor", rank: 2 });
  makeGuard([[-50, 52], [-50, 112]], 2.8, 14, 0.6, { post: "corridor", rank: 2 });
  makeGuard([[50, 112], [50, 52]], 2.8, 14, 0.6, { post: "corridor", rank: 2 });
  makeGuard([[-92, 8], [-92, 34]], 2.4, 13, 0.6, { post: "industries" });
  makeGuard([[68, 72], [100, 72]], 2.4, 13, 0.6, { post: "kitchen" });
  makeGuard([[64, 20], [104, 20]], 2.4, 13, 0.6, { post: "segregation" });
  makeGuard([[68, 121], [102, 121]], 2.4, 13, 0.6, { post: "visitation" });
  makeGuard([[68, -90], [94, -90]], 2.4, 13, 0.6, { post: "warehouse" });
  makeGuard([[-80, -30], [-56, -30], [-56, -20]], 2.6, 14, 0.6, { post: "recyard" });
  makeGuard([[-12, -90], [12, -90]], 2.2, 13, 0.6, { post: "control" });
  /* THE WARDEN — slow, sharp-eyed; bribe him for the gun-room key.
     He used to patrol a 12 x 6 m rectangle of open yard outside the gun-room
     door and never leave it: the man with the highest key in the prison spent
     every hour of every day standing in a car park. world/adminwing.js now
     gives him a building and a DAY (rounds on the tier at unlock and count,
     his own office through the working hours, his quarters after 21:00), and
     it drives him off CBZ.prisonSchedule.
     These waypoints are only where he STARTS — the wing's staff checkpoint,
     inside the block. They matter because systems/state.js resets every guard
     to `g.start` on a new run, and every leg of his route is a straight walk
     through a real opening (entities/guards.js's patrol mover has no steering
     at all, :952). Starting him in the courtyard would strand him on the far
     side of the locked yard door with no way to walk home. */
  makeGuard([[-5, -11], [5, -11], [5, -12.5], [-5, -12.5]], 2.4, 16, 0.7, { kind: "warden" });

  // a couple of bent cops: they run their own contraband racket, take
  // tiny bribes, and conveniently don't see as much (smaller cone).
  [CBZ.guards[3], CBZ.guards[5]].forEach((g) => {
    if (!g) return;
    g.corrupt = true;
    g.viewDist *= 0.6;
    g.data.pool = "goods";
    g.data.offer = CBZ.econ.pickOffer("goods");
    g.data.name += " (bent)";
    g.data.talk = ["You didn't see me, I didn't see you.",
                   "You need it brought in, I'm the one who brings it.",
                   "My shelf's open when my shift's quiet."];
  });

  function nameOf(g) {
    return g.data.name.replace(/^the |^a |^an /, "");
  }

  function racketStanding() {
    return Math.max(-50, Math.min(50, (CBZ.game && CBZ.game.racketStanding) || 0));
  }

  function addRacketStanding(amount) {
    if (!CBZ.game) return 0;
    CBZ.game.racketStanding = Math.max(-50, Math.min(50, (CBZ.game.racketStanding || 0) + amount));
    return CBZ.game.racketStanding;
  }

  function racketPriceMod(scale) {
    const s = racketStanding();
    scale = scale || 1;
    return s < 0 ? Math.ceil(Math.abs(s) / (12 / scale)) : -Math.floor(s / (16 / scale));
  }

  /* THE LOCAL payoffCost() IS GONE (defect fix, 2026-08-25).
     It was a SECOND sum for the SAME purchase. This file quoted you its own
     number on the approach card — startPayoffApproach() below writes it into
     `g.approach.msg` and systems/interact.js prints it on the button — and
     then `action:"pay"` handed the transaction to CBZ.econ.payoff(), whose
     payoffCost() charged a DIFFERENT number. The two disagreed on both terms
     that matter: this one priced the racket ledger with racketPriceMod(0.75)
     while economy.js prices it off racketStanding/racketDebt/protection, and
     this one still carried a +14 WARDEN premium for a transaction the warden
     refuses outright (economy.js's payoff() turns him down before any price
     is read, owner 2026-08-19). A man who quotes nine and takes fourteen is
     a bug, not a character. The till sets the price; ask the till. */

  function contrabandCount() {
    const inv = (CBZ.game && CBZ.game.inventory) || {};
    return Object.keys(inv).filter((k) => (inv[k] || 0) > 0 && k !== "Gun").length;
  }

  function racketCost(g, extra) {
    const game = CBZ.game || {};
    const armed = CBZ.hasAnyWeapon ? CBZ.hasAnyWeapon() : (CBZ.econ && CBZ.econ.hasItem && CBZ.econ.hasItem("Gun"));
    const debt = (extra && extra.debt) || game.racketDebt || 0;
    return Math.max(5,
      3 +
      Math.ceil((game.cigs || 0) / 9) +
      contrabandCount() * 2 +
      (armed ? 3 : 0) +
      (game.gangJob ? 3 : 0) +
      Math.ceil(debt * 0.45) +
      (g.kind === "warden" ? 8 : 0) +
      racketPriceMod(1.15)
    );
  }

  function findSnitchLead() {
    let best = null, bt = 0;
    for (const n of CBZ.npcs || []) {
      if (!n || n.dead || n.escaped || !n.data) continue;
      if ((n.reportedPlayerT || 0) > bt) { best = n; bt = n.reportedPlayerT || 0; }
    }
    if (best) return best;
    const source = CBZ.game && CBZ.game.lastKnown && CBZ.game.lastKnown.source;
    if (!source) return null;
    return (CBZ.npcs || []).find((n) => n && n.data && nameOf(n) === source && !n.dead && !n.escaped) || null;
  }

  function snitchIntelCost(g, target) {
    const game = CBZ.game || {};
    const heat = game.detection || 0;
    const reports = game.snitchReports || 0;
    const grudge = target ? Math.max(0, target.playerGrudge || 0) : 0;
    return Math.max(3, Math.ceil(heat / 18) + reports + Math.ceil(grudge / 3) + (g.kind === "warden" ? 3 : 1) + racketPriceMod(0.65));
  }

  function startCleanSweep(source, amount) {
    const game = CBZ.game || {};
    let best = null, bd = Infinity;
    for (const gd of CBZ.guards || []) {
      if (!gd || gd === source || gd.corrupt || gd.dead || gd.ko > 0 || gd.bribed > 0) continue;
      const dx = player.pos.x - gd.group.position.x;
      const dz = player.pos.z - gd.group.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = gd; }
    }
    game.lastKnown = {
      x: player.pos.x,
      z: player.pos.z,
      t: 10,
      amount: amount || 14,
      type: "racket tip",
      heardOnly: false,
      source: nameOf(source),
    };
    if (CBZ.addCasePressure) CBZ.addCasePressure(amount || 14, { type: "racket tip" }, source, { corruptHold: true });
    game.witnessReportT = Math.max(game.witnessReportT || 0, 8);
    if (best) {
      best.investigate = { x: player.pos.x, z: player.pos.z, t: 7.5, scan: 0, type: "racket tip" };
      best.alert = Math.max(best.alert || 0, 0.9);
    }
  }

  function clearGuardApproach(g) {
    // answering the deal he was actually pitching settles his standing copy
    // of it too (entities/ai.js has the same contract for inmates)
    if (g.standingOffer && (!g.approach || g.approach.kind === g.standingOffer.kind)) g.standingOffer = null;
    g.approach = null;
    g.approachCD = 12 + CBZ.econ.rng() * 12;
  }

  function startPayoffApproach(g, kind, extra) {
    kind = kind || "payoffOffer";
    extra = extra || {};
    const cost = kind === "racketOffer" ? racketCost(g, extra)
      : kind === "snitchIntel" ? snitchIntelCost(g, extra.snitch)
      : CBZ.econ.payoffCost(g);          // the till's price, never a second sum
    const finalCost = extra.cost || (kind === "witnessBlackmail" ? Math.max(4, Math.ceil((extra.amount || 14) / 6) + Math.ceil(((CBZ.game && CBZ.game.detection) || 0) / 14) + 3 + racketPriceMod(0.7)) : cost);
    const msg = kind === "witnessBlackmail"
      ? `${nameOf(g)} heard ${extra.source || "a snitch"} talking and wants ${finalCost} cigs to bury it.`
      : kind === "racketOffer"
      ? `${nameOf(g)} wants ${finalCost} cigs to ignore your stash and side work.`
      : kind === "snitchIntel"
      ? `${nameOf(g)} can sell you the snitch's name for ${finalCost} cigs.`
      : `${nameOf(g)} can bury your wanted level for ${cost} cigs.`;
    g.approach = {
      kind,
      cost: finalCost,
      t: 10,
      greeted: false,
      msg,
    };
    if (extra) Object.assign(g.approach, extra);
    g.approachCD = 0;
  }

  function nudgeCleanGuard(g) {
    let best = null, bd = Infinity;
    for (const gd of CBZ.guards) {
      if (!gd || gd === g || gd.corrupt || gd.dead || gd.ko > 0) continue;
      const dx = gd.group.position.x - g.group.position.x;
      const dz = gd.group.position.z - g.group.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = gd; }
    }
    if (best && ((CBZ.game && CBZ.game.detection) || 0) > 26) {
      best.alert = Math.max(best.alert || 0, 1.2);
      best.hunt = Math.max(best.hunt || 0, 1.8);
    }
  }

  function expireGuardApproach(g, reason) {
    if (!g.approach) return;
    const a = g.approach;
    const near = Math.hypot(player.pos.x - g.group.position.x, player.pos.z - g.group.position.z) < 20;
    /* A bent screw's SALES PITCH keeps, the way an inmate's offer keeps
       (entities/ai.js OFFER_STANDS): walking off to think about buying a name
       or a clean sheet is not an answer, and punishing it made the offer read
       as a glitch. Only refusing him to his face — or true extortion
       (racketOffer, witnessBlackmail) — has walk-away teeth. */
    if ((a.kind === "payoffOffer" || a.kind === "snitchIntel") && reason !== "refuse") {
      const prev = g.standingOffer;
      const sameDeal = prev && prev.kind === a.kind;
      g.standingOffer = {
        kind: a.kind,
        saved: Object.assign({}, a),
        t: sameDeal ? prev.t : 90,
        walks: (sameDeal ? prev.walks : 0) + 1,
        needsLeave: reason === "timeout",
      };
      g.approach = null;
      g.approachCD = 3 + CBZ.econ.rng() * 3;
      if (near && CBZ.prisonSay && g.standingOffer.walks === 1) {
        CBZ.prisonSay(g, a.kind === "snitchIntel"
          ? "The name keeps. You know my post."
          : "The paperwork can wait on you. Not forever.", { rank: CBZ.PRISON_SAY ? CBZ.PRISON_SAY.act : 1 });
      }
      return;
    }
    clearGuardApproach(g);
    if (CBZ.game.role === "cop") {
      CBZ.addComplaint && CBZ.addComplaint(reason === "refuse" ? 12 : 7);
    } else {
      if (a.kind === "racketOffer") {
        CBZ.econ.addRacketDebt(Math.ceil((a.cost || 5) * (reason === "refuse" ? 0.8 : 0.45)));
        addRacketStanding(reason === "refuse" ? -8 : -4);
        startCleanSweep(g, 12 + Math.ceil((a.cost || 5) * 0.7));
        if (CBZ.player && CBZ.player.gang != null && CBZ.addGangStanding) CBZ.addGangStanding(CBZ.player.gang, -2);
      } else if (a.kind === "witnessBlackmail" || a.kind === "payoffOffer" || a.kind === "snitchIntel") {
        addRacketStanding(reason === "refuse" ? -6 : -3);
      }
      CBZ.addHeat && CBZ.addHeat(a.kind === "racketOffer" ? (reason === "refuse" ? 18 : 11) : (reason === "refuse" ? 14 : 8));
      nudgeCleanGuard(g);
    }
    // He is a man ending a conversation, so he ends it out loud — ONCE per
    // kind of business. A man does not deliver the same exit line every
    // shakedown; the second time he just goes back to his round.
    const seen = g._saidClosers || (g._saidClosers = {});
    if (near && CBZ.prisonSay && !seen[a.kind]) {
      seen[a.kind] = 1;
      CBZ.prisonSay(g, a.kind === "racketOffer" ? "The tab doesn't close because you walked." : "We're done talking.",
        { rank: CBZ.PRISON_SAY ? CBZ.PRISON_SAY.act : 1 });
    }
  }

  function considerPayoffApproach(g, dt) {
    if (!g.corrupt || g.approach || g.bribed > 0 || g.ko > 0 || g.dead || g.hunt > 0) return;
    // his standing offer only ages while he is NOT pitching it
    if (g.standingOffer) {
      g.standingOffer.t -= dt;
      if (g.standingOffer.t <= 0) g.standingOffer = null;   // he quietly stops holding the door
    }
    if (CBZ.playerApproachBusy && CBZ.playerApproachBusy(g)) return;
    g.approachCD = (g.approachCD || 0) - dt;
    if (g.approachCD > 0 || !CBZ.game || CBZ.game.state !== "playing") return;
    g.approachCD = 1.4 + CBZ.econ.rng() * 2.6;
    if (g.standingOffer) {
      /* While his offer stands he pitches nothing new — he re-opens THE SAME
         deal, in words that show he remembers making it, or he waits. */
      const s = g.standingOffer;
      const sdx = player.pos.x - g.group.position.x, sdz = player.pos.z - g.group.position.z;
      const sd = Math.hypot(sdx, sdz);
      if (s.needsLeave) {
        if (sd > 17 || sd < 3.4) s.needsLeave = false;
        else return;
      }
      if (sd >= 3.4 && sd <= 15) {
        const a = Object.assign({}, s.saved);
        a.t = 12;
        a.greeted = false;
        a.msg = a.kind === "snitchIntel"
          ? `${nameOf(g)} still has that name. ${a.cost} cigs, like before.`
          : `${nameOf(g)}: the offer to bury your sheet still stands. ${a.cost} cigs.`;
        g.approach = a;
        g.approachCD = 0;
      }
      return;
    }
    const heat = CBZ.game.role === "cop" ? (CBZ.game.complaints || 0) : (CBZ.game.detection || 0);
    const cigs = CBZ.game.cigs || 0;
    const dx = player.pos.x - g.group.position.x, dz = player.pos.z - g.group.position.z;
    const dist = Math.hypot(dx, dz);
    const stash = CBZ.game && CBZ.game.inventory ? Object.keys(CBZ.game.inventory).filter((k) => (CBZ.game.inventory[k] || 0) > 0 && k !== "Gun").length : 0;
    const armed = CBZ.hasAnyWeapon ? CBZ.hasAnyWeapon() : (CBZ.econ && CBZ.econ.hasItem && CBZ.econ.hasItem("Gun"));
    const sideWork = !!(CBZ.game && CBZ.game.gangJob);
    const witness = CBZ.game && CBZ.game.lastKnown && CBZ.game.lastKnown.t > 0;
    const snitch = findSnitchLead();
    const protectedCut = (CBZ.game.racketProtectionT || 0) > 0;
    const unpaidCut = (CBZ.game.racketDebt || 0) > 0;
    const ledger = racketStanding();
    const ledgerHeat = Math.max(0, -ledger);
    const ledgerTrust = Math.max(0, ledger);
    const racket = (unpaidCut || ledger < -14 || stash > 1 || armed || cigs >= 18 || sideWork) && dist >= 3.5 && dist <= 12;
    if ((unpaidCut || ledger < -22) && !protectedCut && cigs >= 3 && dist <= 18 && CBZ.startRacketRunner && CBZ.econ.rng() <= 0.026 + Math.min(0.032, ledgerHeat * 0.0012)) {
      if (CBZ.startRacketRunner(g)) {
        g.approachCD = 8 + CBZ.econ.rng() * 8;
        g.alert = Math.max(g.alert || 0, 0.35);
        return;
      }
    }
    if (cigs < 4 || dist < 3.5 || dist > 15) return;
    if (snitch && (snitch.reportedPlayerT || 0) > 0 && !protectedCut && CBZ.econ.rng() <= 0.030 + Math.min(0.020, ledgerTrust * 0.001)) startPayoffApproach(g, "snitchIntel", {
      snitch,
      source: nameOf(snitch),
    });
    else if (witness && !protectedCut && CBZ.econ.rng() <= 0.028 + Math.min(0.026, ledgerHeat * 0.0014)) startPayoffApproach(g, "witnessBlackmail", {
      amount: CBZ.game.lastKnown.amount || 12,
      source: CBZ.game.lastKnown.source || "a witness",
    });
    else if (heat >= 18 && CBZ.econ.rng() <= 0.020 + Math.min(0.014, ledgerTrust * 0.0007)) startPayoffApproach(g, "payoffOffer");
    else if (racket && !protectedCut && CBZ.econ.rng() <= (unpaidCut ? 0.050 : 0.018) + Math.min(0.032, ledgerHeat * 0.0012) - Math.min(0.010, ledgerTrust * 0.0004)) startPayoffApproach(g, "racketOffer", { debt: CBZ.game.racketDebt || 0 });
  }

  function bestBentGuard(maxDist) {
    let best = null, bs = -Infinity;
    for (const gd of CBZ.guards || []) {
      if (!gd || !gd.corrupt || gd.dead || gd.ko > 0 || gd.approach || gd.hunt > 0) continue;
      const dx = player.pos.x - gd.group.position.x;
      const dz = player.pos.z - gd.group.position.z;
      const d = Math.hypot(dx, dz);
      if (d > (maxDist || 18)) continue;
      const score = (maxDist || 18) - d + Math.max(0, gd.bribed || 0) * 0.08 + (gd.kind === "warden" ? 1.4 : 0);
      if (score > bs) { bs = score; best = gd; }
    }
    return best;
  }

  /* ---- THE RACKET SPEAKS FOR ITSELF ---------------------------------------
     This was `racketHint(text)` — a `flashHint` caption narrating, in the
     third person, what a named guard standing in front of you was doing. It
     was the last third-person narration lane left in the prison after the
     show-don't-tell sweep, and its two callers wanted opposite things:

       "X leans on the racket tab."  A PURE DUPLICATE. It fired on the same
       line as startPayoffApproach(), which already writes `g.approach.msg`
       and sends the man WALKING AT YOU with a bubble over his head. The
       approach is the signal; a caption on it is the caption on the camera
       cone. Deleted outright, nothing put in its place.

       "X leaks your trail to clean guards."  A REAL EVENT WITH AN INVISIBLE
       CAUSE. startCleanSweep already produces the consequence — the nearest
       clean screw turns and walks to where you were — but nothing said WHO
       sold you, so a sweep arrived out of a clear sky. That one needs a
       carrier, and there is a man standing right there who did it. He says
       it, out of his own mouth, through the shipped in-world speech surface
       (CBZ.prisonSay: 16 m, ranked, silent when he is dead or out cold) —
       and what he says is what a bent screw actually says, into his radio,
       rather than a description of the mechanic. Out of earshot you get the
       sweep with no explanation, which is correct: you were not there. */
  const RADIO = [
    "Post four, got a sighting for you. Sending it now.",
    "Yeah, he's yours. Same spot I called in.",
    "Control, I've got eyes. Passing it up the line.",
  ];
  function racketBark(g) {
    const game = CBZ.game || {};
    game.racketHintT = Math.max(0, (game.racketHintT || 0) - 1);
    if (game.racketHintT > 0) return;
    game.racketHintT = 3;
    if (!CBZ.prisonSay || !g) return;
    const i = ((g.id || 0) + ((game.caughtCount || 0) | 0)) % RADIO.length;
    try { CBZ.prisonSay(g, RADIO[i]); } catch (e) {}
  }

  function tagNearbyBadgeRumor(source, strength) {
    if (!CBZ.rememberBlockRead || !CBZ.npcs) return;
    const sx = source && source.group ? source.group.position.x : player.pos.x;
    const sz = source && source.group ? source.group.position.z : player.pos.z;
    for (const n of CBZ.npcs) {
      if (!n || !n.group || n.dead || n.ko > 0 || n.escaped || n.role === "merchant") continue;
      const d = Math.hypot(n.group.position.x - sx, n.group.position.z - sz);
      if (d > 16) continue;
      CBZ.rememberBlockRead(n, "badge", (strength || 18) * (1 - d / 24), source ? nameOf(source) : "bent cops");
    }
  }

  function updateRacketPressure(dt) {
    const game = CBZ.game || {};
    if (game.state !== "playing" || game.role === "cop") return;
    game.racketPressureT = Math.max(0, (game.racketPressureT || 0) - dt);
    if (game.racketPressureT > 0) return;
    game.racketPressureT = 4.8 + CBZ.econ.rng() * 4.2;

    const debt = game.racketDebt || 0;
    const ledger = racketStanding();
    const cigs = game.cigs || 0;
    const stash = contrabandCount();
    const protectedCut = (game.racketProtectionT || 0) > 0;
    const heat = game.detection || 0;
    const witness = game.lastKnown && game.lastKnown.t > 0;
    const snitch = findSnitchLead();
    const armed = CBZ.hasAnyWeapon ? CBZ.hasAnyWeapon() : (CBZ.econ && CBZ.econ.hasItem && CBZ.econ.hasItem("Gun"));
    const squeeze = debt >= 18 || ledger <= -24;
    const valuable = cigs >= 22 || stash >= 2 || armed || game.gangJob;
    const caseTrouble = witness || (snitch && snitch.reportedPlayerT > 0) || heat >= 32;
    if (!squeeze && !valuable && !caseTrouble) return;

    const bent = bestBentGuard(squeeze ? 22 : 16);
    if (!bent) return;
    const dist = Math.hypot(player.pos.x - bent.group.position.x, player.pos.z - bent.group.position.z);
    const canApproach = cigs >= 3 && dist >= 3.2 && dist <= 18 && !(CBZ.playerApproachBusy && CBZ.playerApproachBusy(bent));

    if (!protectedCut && canApproach) {
      if (snitch && snitch.reportedPlayerT > 0 && cigs >= 4 && CBZ.econ.rng() < 0.58) {
        startPayoffApproach(bent, "snitchIntel", { snitch, source: nameOf(snitch), thresholdPressure: true });
      } else if (witness && cigs >= 4 && CBZ.econ.rng() < 0.62) {
        startPayoffApproach(bent, "witnessBlackmail", {
          amount: game.lastKnown.amount || 12,
          source: game.lastKnown.source || "a witness",
          thresholdPressure: true,
        });
      } else if (squeeze || valuable) {
        startPayoffApproach(bent, "racketOffer", { debt, thresholdPressure: true });
      } else {
        startPayoffApproach(bent, "payoffOffer", { thresholdPressure: true });
      }
      tagNearbyBadgeRumor(bent, 18 + Math.min(20, debt + Math.max(0, -ledger) * 0.5));
      // no caption: startPayoffApproach above already sends him at you with a
      // bubble and his own line. See racketBark's note.
      game.racketPressureT = 8.5 + CBZ.econ.rng() * 5;
      return;
    }

    if (!protectedCut && (debt >= 26 || ledger <= -34 || (caseTrouble && ledger <= -18))) {
      startCleanSweep(bent, 16 + Math.min(18, debt * 0.45 + Math.max(0, -ledger) * 0.28));
      addRacketStanding(-2);
      tagNearbyBadgeRumor(bent, 24);
      racketBark(bent);                       // he says it into his radio, in the world
      game.racketPressureT = 11 + CBZ.econ.rng() * 7;
      return;
    }

    if (!protectedCut && debt >= 12 && cigs >= 3 && CBZ.startRacketRunner && CBZ.econ.rng() < 0.52) {
      if (CBZ.startRacketRunner(bent)) {
        tagNearbyBadgeRumor(bent, 16);
        game.racketPressureT = 9 + CBZ.econ.rng() * 5;
      }
    }
  }

  /* The three approaches that are career-ending favours rather than a moment
     of blindness — the ones the phone bridge gates. `payoffOffer` is a deep
     service too, but it is transacted by CBZ.econ.payoff(), which gates
     itself, so listing it here would run the gate twice and burn two lines
     out of the once-per-officer refusal. */
  function deepKind(a) {
    return !!a && (a.kind === "racketOffer" || a.kind === "witnessBlackmail" || a.kind === "snitchIntel");
  }
  /* The once-a-run honest clause, worn in front of whichever deep purchase
     happens first. It LATCHES when it returns non-empty, so it may only be
     called on a path that has already taken the money — never speculatively. */
  function paidPrefix() { return CBZ.econ.outsidePaidPrefix ? CBZ.econ.outsidePaidPrefix() : ""; }

  function resolveGuardApproach(g, action) {
    const a = g && g.approach;
    if (!a) return { ok: false, msg: "Nothing doing. Not right now." };
    if (action === "listen") {
      // NO NAME, NO COLON. These four were the last of the `Name: line` shape
      // in the prison: .pi-subtitle (systems/interact.js) carries the speaker
      // in its own element and shows only the words, so a name stapled to the
      // front is the same man introduced twice.
      /* AND HE STATES THE INSTRUMENT. Asking a bent officer what the deal is
         is the one moment the outside-money fiction belongs in a mouth: he
         says where the money actually goes, and asks the only question that
         decides whether you are in the conversation at all. Empty string when
         PRISON_PHONE_BRIDGE is off, so these four lines revert exactly. */
      const terms = deepKind(a) && CBZ.econ.phoneTerms ? CBZ.econ.phoneTerms() : "";
      const tail = terms ? " " + terms : "";
      return { ok: true, msg: a.kind === "witnessBlackmail"
        ? `${a.source || "Somebody"} gave me a trail. Pay and it never reaches the log.${tail}`
        : a.kind === "racketOffer"
        ? `Pay the cut and your contraband stays invisible.${tail}`
        : a.kind === "snitchIntel"
        ? `Pay, and I point you at the mouth feeding the log. What you do about it is yours.${tail}`
        : `${a.cost}, and the paperwork gets lost.` };
    }
    if (action === "pay") {
      /* NOBODY SELLS A CAREER FOR TOBACCO (PRISON_PHONE_BRIDGE).
         A racket's protection, a buried statement and a name off the log are
         the three deep services on this file's side of the counter, and all
         three are paid the way staff corruption is really paid: your people
         to his people. The cigarettes still leave your pocket at the same
         magnitude — they stand for what your people sent — but you cannot
         reach your people without a line out, so this is the precondition for
         the conversation and it is checked before the money is counted.
         `payoffOffer` is deliberately absent: it falls through to
         CBZ.econ.payoff() below, which runs the same gate at the till. */
      if (deepKind(a)) {
        const gate = CBZ.econ.phoneGate ? CBZ.econ.phoneGate(g) : null;
        if (gate) return gate;
      }
      if (a.kind === "snitchIntel") {
        // A REFUSAL NAMES THE THING AND THE NUMBER, and never opens on a bare
        // numeral — these three said "12. Come back with it or don't come
        // back", which is a price tag with a full stop after it.
        if ((CBZ.game.cigs || 0) < a.cost) return { ok: false, msg: `That name costs ${a.cost}. Come back with it or don't come back.` };
        CBZ.econ.addCigs(-a.cost);
        CBZ.econ.consumePhoneTime && CBZ.econ.consumePhoneTime();
        const snitch = (a.snitch && !a.snitch.dead && !a.snitch.escaped) ? a.snitch : findSnitchLead();
        g.bribed = Math.max(g.bribed || 0, 14);
        if (snitch && snitch.data) {
          snitch.reportedPlayerT = Math.max(snitch.reportedPlayerT || 0, 48);
          snitch.reportedPlayerAmount = Math.max(snitch.reportedPlayerAmount || 0, a.amount || 12);
          snitch.reportedPlayerKind = snitch.reportedPlayerKind || "paid intel";
          snitch.reportedPlayerGuard = nameOf(g);
          snitch.reportedPlayerLastKnown = snitch.reportedPlayerLastKnown || {
            x: snitch.group.position.x,
            z: snitch.group.position.z,
            type: "snitch intel",
            heardOnly: false,
          };
          snitch.playerGrudge = Math.min(14, (snitch.playerGrudge || 0) + 1);
          if (CBZ.npcEmote) CBZ.npcEmote(snitch, "!");
          if (CBZ.addHeat) CBZ.addHeat(-5);
          // THIS IS WHAT THE CIGS ACTUALLY BUY NOW (JAIL_SNITCH_KNOWLEDGE).
          // Before, the purchase set a 30-second countdown that was read by one
          // HUD chip and nothing else, while the snitch verbs were already
          // offered on every reporter for free — you were paying a bent screw
          // for information the HUD gave away. `learnSnitch` is the fact: this
          // name, permanently, and the verbs that go with it.
          if (CBZ.learnSnitch) CBZ.learnSnitch(snitch, "paid");
          addRacketStanding(1);
          CBZ.sfx && CBZ.sfx("coin");
          clearGuardApproach(g);
          return { ok: true, msg: paidPrefix() + `It was ${nameOf(snitch)}. Do what you like with that. I never said it.` };
        }
        if (CBZ.addHeat) CBZ.addHeat(-3);
        addRacketStanding(1);
        CBZ.sfx && CBZ.sfx("coin");
        clearGuardApproach(g);
        return { ok: true, msg: paidPrefix() + "Trail's cold. I'll keep the fee for the trouble." };
      }
      if (a.kind === "witnessBlackmail") {
        if ((CBZ.game.cigs || 0) < a.cost) return { ok: false, msg: `Burying a statement costs ${a.cost}. Come back with it or don't come back.` };
        CBZ.econ.addCigs(-a.cost);
        CBZ.econ.consumePhoneTime && CBZ.econ.consumePhoneTime();
        g.bribed = Math.max(g.bribed || 0, 22);
        g.alert = 0; g.hunt = 0; g.investigate = null;
        if (CBZ.addHeat) CBZ.addHeat(-(12 + (a.amount || 12) * 0.65));
        if (CBZ.reduceCasePressure) CBZ.reduceCasePressure(10 + (a.amount || 12) * 0.7, a.source);
        if (CBZ.addComplaint) CBZ.addComplaint(-8);
        if (CBZ.game) {
          CBZ.game.witnessReportT = Math.max(0, (CBZ.game.witnessReportT || 0) - 10);
          if (CBZ.game.lastKnown && (!a.source || CBZ.game.lastKnown.source === a.source || CBZ.game.lastKnown.type !== "visual")) CBZ.game.lastKnown = null;
        }
        for (const gd of CBZ.guards || []) {
          if (gd.corrupt || ((CBZ.game && CBZ.game.detection) || 0) < 28) {
            gd.hunt = 0;
            gd.alert = Math.min(gd.alert || 0, 0.25);
            gd.investigate = null;
          }
        }
        addRacketStanding(3);
        CBZ.sfx && CBZ.sfx("coin");
        clearGuardApproach(g);
        return { ok: true, msg: paidPrefix() + "That statement never got typed up. Nobody remembers taking it." };
      }
      if (a.kind === "racketOffer") {
        if ((CBZ.game.cigs || 0) < a.cost) return { ok: false, msg: `The cut is ${a.cost}. Come back with it or don't come back.` };
        CBZ.econ.addCigs(-a.cost);
        CBZ.econ.consumePhoneTime && CBZ.econ.consumePhoneTime();
        g.bribed = Math.max(g.bribed || 0, 24);
        g.alert = 0; g.hunt = 0;
        CBZ.game.racketProtectionT = Math.max(CBZ.game.racketProtectionT || 0, 32 + Math.min(28, a.cost * 2));
        CBZ.game.racketGuard = nameOf(g);
        CBZ.econ.addRacketDebt(-(a.cost * 2 + 5));
        for (const gd of CBZ.guards || []) if (gd.corrupt) {
          gd.bribed = Math.max(gd.bribed || 0, 10);
          gd.alert = 0;
          gd.hunt = 0;
        }
        if (CBZ.addHeat) CBZ.addHeat(-(18 + a.cost * 0.9));
        if (CBZ.reduceCasePressure) CBZ.reduceCasePressure(8 + a.cost * 0.5);
        if (CBZ.addComplaint) CBZ.addComplaint(-10);
        if (CBZ.game.lastKnown && (CBZ.game.detection || 0) < 38) CBZ.game.lastKnown = null;
        if (CBZ.player && CBZ.player.gang != null && CBZ.addGangStanding) CBZ.addGangStanding(CBZ.player.gang, -2);
        addRacketStanding(6);
        CBZ.sfx && CBZ.sfx("coin");
        clearGuardApproach(g);
        return { ok: true, msg: paidPrefix() + "You're under my wing for a while. Don't make me regret the arithmetic." };
      }
      // the price on the card, not a second one computed at the till — see the
      // note on econ.payoff()'s opts.cost. HAGGLE writes a.cost; this is what
      // makes that discount reach the money instead of only the chip.
      const res = CBZ.econ.payoff(g, { cost: a.cost });
      if (res && res.ok) { addRacketStanding(3); clearGuardApproach(g); }
      return res;
    }
    if (action === "haggle") {
      if (a.haggled || a.cost <= 3) return { ok: false, msg: "The price is the price." };
      a.haggled = true;
      const heat = (CBZ.game && CBZ.game.detection) || 0;
      const chance = Math.max(0.18, Math.min(0.72, (g.corrupt ? 0.45 : 0.24) - heat * 0.002 + ((CBZ.game.cigs || 0) < a.cost ? 0.12 : 0)));
      if (CBZ.econ.rng() < chance) {
        a.cost = Math.max(3, a.cost - 2 - Math.floor(CBZ.econ.rng() * 3));
        a.t = Math.max(a.t || 0, 7);
        addRacketStanding(-1);
        return { ok: true, msg: `Fine. ${a.cost}, and we never had this conversation.` };
      }
      a.cost += 2;
      if (a.kind === "racketOffer") CBZ.econ.addRacketDebt(1);
      addRacketStanding(-2);
      if (CBZ.addHeat) CBZ.addHeat(4);
      return { ok: false, msg: `Now it's ${a.cost}. Haggle again and see what happens.` };
    }
    if (action === "threaten") {
      const armed = (CBZ.playerArmed && CBZ.playerArmed()) || (CBZ.econ && CBZ.econ.hasItem && CBZ.econ.hasItem("Shiv"));
      const chance = g.corrupt ? (armed ? 0.42 : 0.20) : (armed ? 0.18 : 0.05);
      if (CBZ.econ.rng() < chance) {
        const snitch = a.kind === "snitchIntel" ? (a.snitch || findSnitchLead()) : null;
        clearGuardApproach(g);
        g.bribed = Math.max(g.bribed || 0, 6);
        if (snitch && snitch.data) {
          snitch.reportedPlayerT = Math.max(snitch.reportedPlayerT || 0, 24);
          snitch.reportedPlayerGuard = nameOf(g);
        }
        if (CBZ.addHeat) CBZ.addHeat(8);
        addRacketStanding(-5);
        return { ok: true, msg: snitch && snitch.data ? `${nameOf(g)} spits out ${nameOf(snitch)}'s name, then backs off.` : `${nameOf(g)} backs off for now, but the heat ticks up.` };
      }
      clearGuardApproach(g);
      g.bribed = 0;
      g.alert = Math.max(g.alert || 0, 1.4);
      addRacketStanding(-10);
      if (!g.corrupt) g.hunt = Math.max(g.hunt || 0, 2.6);
      if (a.kind === "racketOffer") {
        CBZ.econ.addRacketDebt(Math.ceil((a.cost || 5) * 0.7));
        startCleanSweep(g, 18 + Math.ceil((a.cost || 5) * 0.6));
      }
      if (a.kind === "snitchIntel" && CBZ.game) {
        CBZ.game.witnessReportT = Math.max(CBZ.game.witnessReportT || 0, 8);
        CBZ.econ.addRacketDebt(2);
      }
      if (CBZ.addHeat) CBZ.addHeat(g.corrupt ? 12 : 28);
      nudgeCleanGuard(g);
      return { ok: false, msg: "Wrong answer. Control, this is post one." };
    }
    if (action === "refuse") {
      expireGuardApproach(g, "refuse");
      return { ok: false, msg: "Suit yourself. I've got a long memory and a short shift." };
    }
    return { ok: false, msg: "" };
  }

  /* ---- TORCH DISCIPLINE ---------------------------------------------------
     A DUTY TORCH IS A TOOL, AND WHAT MAKES IT A TOOL IS THAT IT COSTS A HAND.
     Ungated, the search branch below lit the beam the instant a screw started
     hunting you — at noon, in an open yard, all the way in to arm's length —
     and updateFlashlight then pinned his right arm out in front of him for as
     long as it burned. That is the pose a man uses to PRESENT A WEAPON. What
     the owner saw was the warden walking up to a prisoner in broad daylight
     and AIMING a flashlight at him, then tasing him with the taser drawn into
     the same fist the torch hangs off: systems/taserfx.js parents it to
     `thirdPersonWeapon`, a CHILD of the `rightHand` socket addFlashlight uses,
     and re-poses that arm at onAlways(53) — 33 orders after us. Two props in
     one hand, two writers on one arm, and a torch used as a threat.

     Three rules, one flag (GUARD_TORCH_DISCIPLINE=0 restores the old body):

       A TORCH IS FOR THE DARK. The search branch now asks the light rig what
       the light actually IS where he is standing (systems/fixtures.js's
       level(), the same curve that prices his eyesight) rather than testing
       the sun, so a lamp answers for a room the way the sky answers for a
       yard. Measured: at noon every point in this prison — open yard, wing
       middle, wing corner — reads 1.00 and nobody draws anything; at
       lights-out the yard reads 0.00 and even the wing, with its night
       lighting, reads 0.28. The threshold below has margin on both sides.

       A DRAWN WEAPON OWNS THE FIST. While the taser is out, or predator.js
       has him mid-seize, there is no torch at all — one object per hand.

       CLOSE QUARTERS ARE HANDS, NOT LIGHT. Inside grabbing distance of the
       man he is chasing the light may stay on (after dark he still needs it)
       but the PRESENTED pose is dropped and the arm goes back to the
       animator, so the torch swings at his side while he closes instead of
       being held out at your face. Sticky radii, so a distance jittering
       across the boundary cannot twitch the arm. */
  if (CBZ.CONFIG && CBZ.CONFIG.GUARD_TORCH_DISCIPLINE == null) CBZ.CONFIG.GUARD_TORCH_DISCIPLINE = true;
  const TORCH_CQ_IN = 3.4;    // m — closing to grab you: the arm comes down
  const TORCH_CQ_OUT = 5.6;   // m — and does not go back up until here
  const TORCH_DARK = 0.62;    // light level under which a beam is worth carrying

  function torchDiscipline() {
    return !!(CBZ.CONFIG && CBZ.CONFIG.GUARD_TORCH_DISCIPLINE);
  }
  // the taser/gun and the torch hang off ONE hand; whoever drew wins it.
  function torchHandBusy(g) {
    return !!(g._seizing || (g.armed && !g._holstered));
  }
  // Is a beam worth anything where he is standing? Cached for a fifth of a
  // second: level() walks the whole fixture list after dark, and this question
  // is asked twice a frame per guard (updateGuard AND detection.js both call
  // updateGuardFlashlight).
  function torchDarkEnough(g) {
    const lights = CBZ.prisonLights;
    if (!lights || !lights.level) return true;          // no rig, no opinion
    const now = CBZ.now || 0;
    if (g._torchLitT == null || Math.abs(now - g._torchLitT) > 240) {
      g._torchLitT = now;
      let L = 1;
      try { L = lights.level(g.group.position.x, g.group.position.z); } catch (e) { L = 1; }
      g._torchLevel = typeof L === "number" && L === L ? L : 1;
    }
    return g._torchLevel < TORCH_DARK;
  }
  // sticky "he is on top of you". Only a live hunt can close it, and it opens
  // the instant the hunt ends — never a latch that outlives the chase.
  function torchCloseQuarters(g) {
    if (!(g.hunt > 0)) { g._torchCQ = false; return false; }
    const dx = player.pos.x - g.group.position.x;
    const dz = player.pos.z - g.group.position.z;
    const r = g._torchCQ ? TORCH_CQ_OUT : TORCH_CQ_IN;
    g._torchCQ = dx * dx + dz * dz < r * r;
    return g._torchCQ;
  }

  function shouldUseFlashlight(g) {
    if (g.dead || g.ko > 0 || g.asleep || g.bribed > 0) return false;
    // GONE MEANS GONE. systems/economy.js's pickpocket takes the TORCH off the
    // belt as a real item, and this is what that theft is worth: the officer
    // you robbed walks his half of the yard in the dark for the rest of the
    // run. Nothing is announced — you simply notice, later, that one beam is
    // missing from the wire. Cleared only by resetLoadouts on a new run.
    if (g.flashlightLost) return false;
    const disc = torchDiscipline();
    if (disc && torchHandBusy(g)) return false;
    const dayness = CBZ.dayness == null ? 1 : CBZ.dayness;
    const sunY = CBZ.sun && CBZ.sun.position ? CBZ.sun.position.y : 80;
    const nightAmount = CBZ.nightAmount == null ? (1 - dayness) : CBZ.nightAmount;
    const trueNight = (dayness < 0.045 && sunY < -8) || nightAmount > 0.965;
    const activeSearch = g.hunt > 0 || (g.investigate && g.investigate.t > 0);
    if (activeSearch && (!disc || torchDarkEnough(g))) return "search";
    // A NIGHT SHIFT CARRIES A TORCH. The 34% duty cycle below is an idle-hours
    // habit; during the schedule's own dark blocks (unlock, evening return,
    // secure, lights out — systems/prisonschedule.js) a screw walking a wing
    // he cannot see has his light ON, and the ones not detailed to a torch
    // draw one half the time. Without this, the darkness price this wave adds
    // to the vision cone would just make every guard blind instead of making
    // the lit ones dangerous.
    const S = CBZ.prisonSchedule;
    const torchBlock = !!(S && S.enabled() && S.torches());
    if (trueNight && (g.flashlightPatrol || torchBlock)) {
      const period = g.kind === "warden" ? 15 : 22;
      const duty = torchBlock ? (g.flashlightPatrol ? 0.86 : 0.5)
        : (g.kind === "warden" ? 0.58 : 0.34);
      const phase = (((CBZ.now || 0) * 0.001 + (g.flashlightPhase || 0)) % period + period) % period;
      if (phase < period * duty) return "night";
    }
    return "";
  }

  function updateFlashlight(g, dt) {
    const reason = shouldUseFlashlight(g);
    const on = !!reason;
    g.flashlightOn = on;
    g.flashlightReason = reason;
    // WHETHER IT BURNS AND WHETHER IT IS HELD OUT ARE TWO QUESTIONS. Presenting
    // is a searching man's carry — arm forward, beam thrown ahead of his feet.
    // A man closing the last three metres on a runner is not searching, so the
    // arm is handed straight back to animChar, which damps it into the run
    // swing on the next frame. The beam is welded to the actual reflector axis
    // (systems/prisonnight.js's driveTorches reads the world quaternion), so
    // the cone and the floor pool follow the swinging hand for free.
    const present = on && !(torchDiscipline() && torchCloseQuarters(g));
    g.flashlightPresented = present;
    if (g.wedge) g.wedge.visible = on;
    if (g.flashlight) {
      g.flashlight.group.visible = on;
      g.flashlight.lensMat.emissive.setHex(on ? 0xcff6ff : 0x000000);
      g.flashlight.lensMat.emissiveIntensity = on ? 1.6 : 0;
    }
    if (!on && g.wedge && g.wedge.material) {
      g.wedge.material.opacity = 0;
    }
    if (present && g.char && g.char.parts && g.char.parts.ra) {
      const r = g.char.parts.ra.rotation;
      const k = dt == null ? 1 : (1 - Math.exp(-14 * dt));
      r.x += (-1.05 - r.x) * k;
      r.y += (0.02 - r.y) * k;
      r.z += (-0.12 - r.z) * k;
    }
    if (!on) return;
    const m = g.wedge.material;
    if (g.hunt > 0) {
      m.color.setHex(0xff3b3b);
      m.opacity = 0.28 + 0.12 * Math.sin(CBZ.now * 0.012);
    } else if (reason === "search") {
      m.color.setHex(0xffe14d);
      m.opacity = 0.18 + 0.05 * Math.sin(CBZ.now * 0.01);
    } else if (CBZ.game && CBZ.game.role === "cop") {
      m.color.setHex(0x8fd4ff);
      m.opacity = 0.11;
    } else {
      m.color.setHex(0xffe14d);
      m.opacity = Math.max(0.045, 0.045 + ((CBZ.nightAmount || 0) * 0.055));
    }
  }

  function npcAlive(n) {
    return n && !n.dead && !(n.ko > 0) && !n.escaped && n.group && n.data;
  }

  function nearbyQuestionTarget(g) {
    let best = null, bd = 3.8 * 3.8;
    for (const n of CBZ.npcs || []) {
      if (!npcAlive(n) || n.role === "merchant" || n.aiState === "snitch") continue;
      if ((n.questionedT || 0) > 0) continue;
      const dx = n.group.position.x - g.group.position.x;
      const dz = n.group.position.z - g.group.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = n; }
    }
    return best;
  }

  function questionNpcDuringSearch(g, dt) {
    g.questionCD = Math.max(0, (g.questionCD || 0) - dt);
    for (const n of CBZ.npcs || []) if (n.questionedT > 0) n.questionedT = Math.max(0, n.questionedT - dt);
    if (!g.investigate || g.questionCD > 0) return;

    const n = nearbyQuestionTarget(g);
    if (!n) return;

    const inv = g.investigate;
    const p = n.personality || {};
    const playerGang = CBZ.player && CBZ.player.gang != null ? CBZ.player.gang : null;
    const sameGang = playerGang != null && n.gang === playerGang;
    const rivalGang = playerGang != null && n.gang >= 0 && n.gang !== playerGang;
    const protectedByGang = n.gang >= 0 && CBZ.gangProtection && CBZ.gangProtection(n.gang) > 0;
    const standing = n.gang >= 0 && CBZ.gangStanding ? CBZ.gangStanding(n.gang) : 0;
    const trust = n.playerTrust || 0;
    const fear = n.playerFear || 0;
    const grudge = n.playerGrudge || 0;
    const read = n.blockRead && n.blockRead.t > 0 ? n.blockRead : null;
    const memory = n.memory && n.memory.t > 0 ? n.memory : null;
    const knownReport = (n.reportedPlayerT || 0) > 0;
    const readHeat = read && (read.kind === "heat" || read.kind === "snitch" || read.kind === "badge") ? Math.min(0.24, (read.score || 0) * 0.0035) : 0;
    const memoryHeat = memory ? Math.min(0.24, (memory.amount || 10) * 0.012) : 0;
    const rng = CBZ.econ ? CBZ.econ.rng : Math.random;
    const who = n.data.name.replace(/^the |^a |^an /, "");
    const nearPlayer = Math.hypot(player.pos.x - n.group.position.x, player.pos.z - n.group.position.z) < 20;

    g.questionCD = 2.8 + rng() * 1.4;
    n.questionedT = 7 + rng() * 5;
    n.pause = Math.max(n.pause || 0, 0.75);
    n.group.rotation.y = lerpAngle(n.group.rotation.y, Math.atan2(g.group.position.x - n.group.position.x, g.group.position.z - n.group.position.z), 0.8);

    const coverScore =
      (sameGang ? 0.34 : 0) +
      (protectedByGang ? 0.24 : 0) +
      Math.max(0, standing) * 0.004 +
      trust * 0.035 +
      fear * 0.026 -
      grudge * 0.026 -
      (rivalGang ? 0.18 : 0) +
      (read && (read.kind === "heat" || read.kind === "snitch") ? (sameGang || protectedByGang ? readHeat : -readHeat * 0.35) : 0);
    const tellScore =
      (p.snitch || 0.5) * 0.30 +
      (p.nerve || 0.5) * 0.16 +
      grudge * 0.035 +
      (rivalGang ? 0.20 : 0) -
      trust * 0.024 -
      fear * 0.020 -
      (sameGang ? 0.18 : 0) +
      readHeat +
      memoryHeat +
      (knownReport ? 0.16 : 0);

    if (coverScore > 0.22 && rng() < Math.min(0.78, coverScore)) {
      const a = rng() * Math.PI * 2;
      const r = 9 + rng() * 9;
      inv.x += Math.cos(a) * r;
      inv.z += Math.sin(a) * r;
      inv.t = Math.max(inv.t, 4.5);
      inv.scan = 0;
      g.alert = Math.max(g.alert || 0, 0.55);
      n.playerTrust = Math.min(14, trust + 1);
      if (CBZ.addHeat) CBZ.addHeat(-3);
      if (CBZ.game) CBZ.game.witnessReportT = Math.max(0, (CBZ.game.witnessReportT || 0) - 2.5);
      if (CBZ.challengeCaseSource) CBZ.challengeCaseSource(null, 3.5 + Math.max(0, trust) * 0.35 + (protectedByGang ? 2 : 0), { reason: "stonewalled questioning" });
      if (CBZ.rememberBlockRead) CBZ.rememberBlockRead(n, "heat", Math.max(10, (read && read.score) || 0) * 0.55, "stonewall");
      n.coverDebt = {
        t: 24 + rng() * 14,
        guard: nameOf(g),
        heat: 7 + (memory ? Math.min(8, memory.amount || 0) : 0) + (knownReport ? 4 : 0),
        source: who,
      };
      n.approachCD = Math.min(n.approachCD || 2, 0.9 + rng() * 2.0);
      if (CBZ.npcEmote) CBZ.npcEmote(n, "?");
      if (nearPlayer && CBZ.prisonSay) CBZ.prisonSay(n, "Boss, I saw him going the other way. Towards the south gate.", { rank: CBZ.PRISON_SAY ? CBZ.PRISON_SAY.act : 1 });
      return;
    }

    if (tellScore > 0.28 && rng() < Math.min(0.82, tellScore)) {
      const lastKnown = (memory && memory.lastKnown) || n.reportedPlayerLastKnown || (CBZ.game && CBZ.game.lastKnown) || null;
      const accuracy = Math.max(0, Math.min(1, (p.snitch || 0.5) * 0.45 + (p.nerve || 0.5) * 0.25 + grudge * 0.035 + (knownReport ? 0.18 : 0) - (memory && memory.lastKnown && memory.lastKnown.heardOnly ? 0.16 : 0)));
      const noise = Math.max(1.2, 9.0 - accuracy * 6.8);
      const baseX = lastKnown && lastKnown.x != null ? lastKnown.x : player.pos.x;
      const baseZ = lastKnown && lastKnown.z != null ? lastKnown.z : player.pos.z;
      inv.x = baseX + (rng() - 0.5) * noise;
      inv.z = baseZ + (rng() - 0.5) * noise;
      inv.t = Math.max(inv.t, 6.5);
      inv.scan = 0;
      g.alert = Math.max(g.alert || 0, 1.0);
      const credibility = Math.max(0.24, Math.min(0.96, 0.42 + accuracy * 0.42 + (knownReport ? 0.12 : 0) + (read && read.kind === "snitch" ? 0.08 : 0)));
      if (CBZ.game) {
        CBZ.game.lastKnown = {
          x: inv.x,
          z: inv.z,
          t: 10,
          amount: 10,
          type: "questioned",
          heardOnly: false,
          source: who,
        };
      }
      if (CBZ.addCasePressure) CBZ.addCasePressure(8 + (knownReport ? 3 : 0) + (memory ? 2 : 0), { type: "questioned", credibility }, n);
      if (CBZ.addHeat) CBZ.addHeat(4 + credibility * 4);
      n.reportedPlayerT = Math.max(n.reportedPlayerT || 0, 28 + credibility * 16);
      n.reportedPlayerAmount = Math.max(n.reportedPlayerAmount || 0, 8 + Math.round(credibility * 8));
      n.reportedPlayerKind = memory ? "questioned lead" : (read ? `${read.kind} rumor` : "questioned");
      n.reportedPlayerGuard = nameOf(g);
      n.reportedPlayerCred = Math.max(n.reportedPlayerCred || 0, credibility);
      n.reportedPlayerDoubt = Math.max(0, 1 - n.reportedPlayerCred);
      n.reportedPlayerLastKnown = {
        x: inv.x,
        z: inv.z,
        type: "questioned",
        heardOnly: !!(lastKnown && lastKnown.heardOnly),
      };
      if (CBZ.rememberBlockRead) CBZ.rememberBlockRead(n, "snitch", 24 + credibility * 34, nameOf(g));
      if (CBZ.spreadReportGossip) {
        CBZ.spreadReportGossip(n, n.reportedPlayerAmount || 10, {
          type: "questioned",
          heardOnly: !!(lastKnown && lastKnown.heardOnly),
          credibility,
          lastKnown: n.reportedPlayerLastKnown,
        });
      }
      n.approachCD = Math.min(n.approachCD || 2.5, 1.0 + rng() * 2.4);
      n.playerGrudge = Math.min(14, grudge + 1);
      if (CBZ.npcEmote) CBZ.npcEmote(n, "!");
      if (nearPlayer && CBZ.prisonSay) CBZ.prisonSay(n, "Boss. Boss! He's right there.", { rank: CBZ.PRISON_SAY ? CBZ.PRISON_SAY.act : 1 });
      return;
    }

    inv.scan = Math.max(inv.scan || 0, 0.5);
    g.alert = Math.max(g.alert || 0, 0.45);
    if (CBZ.npcEmote) CBZ.npcEmote(n, "?");
  }

  // ---- named guard states + transition barks --------------------------------
  // updateGuard's priority cascade now STAMPS the branch it ran as an explicit
  // guard.state: "patrol"|"social"|"investigate"|"alert"|"hunt"|"capture"|
  // "ko"|"dead". Pure instrumentation — zero behavior change: a contract for
  // future content (campaign warden hooks can read real states) plus the
  // CBZ.jailGuardStates() debug helper. Barks ride the transitions.
  const BARKS = {
    hunt: ["STOP RIGHT THERE!", "We got a runner!", "Don't make me chase you!", "You're mine, inmate!"],
    huntWarden: ["You dare run from ME?", "MY block. MY rules. Take him down!"],
    investigate: ["I heard something over there…", "Eyes open. Something moved.", "Hold up. Checking that out."],
    // hands over his head, your gun on him — he talks like a man buying time
    heldup: ["Easy. Easy now.", "Alright. Take it easy.", "Don't do anything stupid, son."],
  };
  let barkCD = 0;   // global spacing so barks never spam the hint line

  function guardBark(g, s) {
    if (!(CBZ.CONFIG && CBZ.CONFIG.JAIL_GUARD_BARKS)) return;
    if (barkCD > 0 || !CBZ.game || CBZ.game.mode !== "escape" || CBZ.game.state !== "playing") return;
    if (g.dead || g.ko > 0 || g.bribed > 0) return;
    let pool = null;
    if (s === "hunt") pool = g.kind === "warden" ? BARKS.huntWarden : BARKS.hunt;
    else if (s === "investigate" && Math.random() < 0.6) pool = BARKS.investigate;
    if (!pool) return;
    const dx = player.pos.x - g.group.position.x, dz = player.pos.z - g.group.position.z;
    if (dx * dx + dz * dz > 26 * 26) return;   // out of earshot
    barkCD = 6;
    // A bark is speech. It was rendered as `Name: "line"` inside a HUD hint —
    // name, colon and a pair of curly quotes drawn over the world. prisonSay
    // is the surface that already speaks for this prison; the name lives in
    // its speaker slot and the quotes are the surface itself.
    const line = pool[(Math.random() * pool.length) | 0];
    if (CBZ.prisonSay) CBZ.prisonSay(g, line, { rank: CBZ.PRISON_SAY ? CBZ.PRISON_SAY.act : 1 });
    else if (CBZ.flashHint) CBZ.flashHint(line, 1.7);
  }

  function noteState(g, s) {
    if (g.state === s) return;
    g.state = s;
    guardBark(g, s);
  }

  // debug/contract helper: live head-count per named guard state
  CBZ.jailGuardStates = function () {
    const counts = {};
    for (const gd of CBZ.guards || []) {
      const s = gd.state || "patrol";
      counts[s] = (counts[s] || 0) + 1;
    }
    return counts;
  };

  // ---- per-guard movement / facing ----
  function updateGuard(g, dt) {
    const pdx = player.pos.x - g.group.position.x, pdz = player.pos.z - g.group.position.z;
    // rig draw range rides the LIVE quality tier (mid-tier ≈ the old fixed 52u)
    const nr = CBZ.qScale ? CBZ.qScale(34, 73) : 52;
    const renderNear = pdx * pdx + pdz * pdz < nr * nr;
    const renderImportant = g.alert > 0 || g.hunt > 0 || g.approach || g.investigate || g.kind === "warden";
    g.group.visible = renderNear || renderImportant;
    if (g.dead) {
      noteState(g, "dead");
      g.hunt = 0; g.alert = 0; g.approach = null; g.investigate = null;
      // systems/prisoncorpse.js owns the body — lie direction, walls, sprawl.
      // While it does, animChar must NOT run: the idle pose would fight the
      // sprawl for the same four pivots every frame. Legacy flop = flag off.
      if (!(CBZ.prisonCorpseTick && CBZ.prisonCorpseTick(g, dt))) {
        g.group.rotation.z = CBZ.damp(g.group.rotation.z, Math.PI / 2, 11, dt);
        animChar(g.char, 0, dt);
      }
      updateFlashlight(g, dt);
      return;
    }

    if (g.bribed > 0) g.bribed -= dt;
    considerPayoffApproach(g, dt);

    // OFF SHIFT AND ASLEEP (systems/prisonrest.js sets and clears `asleep`;
    // city/propuse.js owns the body while it is set). Exactly the shape of the
    // KO branch below — an inert body this function does not steer and whose
    // roll it must not damp back upright, because the sleeper's own π/2 lie
    // roll is being written by propuse's hold at order 42 and two writers on
    // one channel is a man twitching in his bed all night. The warden is the
    // only guard this is ever true for today: adminwing.js already sends him
    // to his quarters at 21:00, where he used to stand beside the bed.
    if (g.asleep) {
      noteState(g, "asleep");
      g.hunt = 0; g.alert = 0; g.investigate = null;
      updateFlashlight(g, dt);
      animChar(g.char, 0, dt);
      return;
    }

    // ON ESCORT DUTY (systems/capture.js's haul scene sets `_escort` and
    // steers the body itself — the run-in, the kneel, the perp walk). Same
    // shape as the sleeper above: an inert body this function does not move,
    // animate or roll, because two writers on one man is a man who vibrates.
    if (g._escort) {
      noteState(g, "escort");
      g.hunt = 0; g.alert = 0; g.investigate = null; g.approach = null;
      updateFlashlight(g, dt);
      return;
    }

    // knocked out: topple over, do nothing, then climb back up
    if (g.ko > 0) {
      noteState(g, "ko");
      g.ko -= dt;
      g.group.rotation.z = CBZ.damp(g.group.rotation.z, Math.PI / 2, 11, dt);
      updateFlashlight(g, dt);
      animChar(g.char, 0, dt);
      return;
    } else if (g.group.rotation.z !== 0) {
      g.group.rotation.z = CBZ.damp(g.group.rotation.z, 0, 9, dt); // stand back up
      if (Math.abs(g.group.rotation.z) < 0.02) g.group.rotation.z = 0;
    }

    // HELD AT GUNPOINT (systems/intimidate.js JAIL_GUARD_HOLDUP owns the
    // state): he stands where the muzzle found him, facing it. The hunt he
    // was on and the call he was making wait behind his hands — detection.js
    // holds his radio window while this is set, and guardSeesPoint answers
    // false for him, so nothing downstream ever acts on his eyes.
    if (g.intimidMode === "scared") {
      noteState(g, "heldup");
      g.group.rotation.y = lerpAngle(g.group.rotation.y, Math.atan2(pdx, pdz), 1 - Math.pow(0.0006, dt));
      animChar(g.char, 0, dt);
      updateFlashlight(g, dt);
      return;
    }

    if (g.approach) {
      noteState(g, "social");
      const a = g.approach;
      a.t -= dt;
      const dx = player.pos.x - g.group.position.x, dz = player.pos.z - g.group.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 20 || a.t <= 0 || CBZ.game.state !== "playing") {
        if (CBZ.game.state === "playing") expireGuardApproach(g, dist > 20 ? "walkedAway" : "timeout");
        else clearGuardApproach(g);
        updateFlashlight(g, dt);
        return;
      }
      g.group.rotation.y = lerpAngle(g.group.rotation.y, Math.atan2(dx, dz), 1 - Math.pow(0.0001, dt));
      if (dist > 2.4) {
        const sp = g.speed * 1.18;
        g.group.position.x += (dx / dist) * sp * dt;
        g.group.position.z += (dz / dist) * sp * dt;
        animChar(g.char, sp, dt);
      } else {
        animChar(g.char, 0, dt);
        if (!a.greeted) {
          a.greeted = true;
          // " Walk up to answer." was an instruction bolted onto a man's dialogue.
          // He has walked over to you and the head icon is up (systems/markers.js,
          // proximity-gated in phase 3) — the invitation is already on screen.
          if (CBZ.prisonSay) CBZ.prisonSay(g, a.msg, { secs: 2.6, rank: CBZ.PRISON_SAY ? CBZ.PRISON_SAY.act : 1 });
          else if (CBZ.flashHint) CBZ.flashHint(a.msg, 2.1);
        }
      }
      updateFlashlight(g, dt);
      return;
    }

    // HUNTING: run the player down, then try to subdue (capture.js)
    if (g.hunt > 0) {
      g.hunt -= dt;
      g.investigate = null;
      const dx = player.pos.x - g.group.position.x, dz = player.pos.z - g.group.position.z;
      const dist = Math.hypot(dx, dz);
      noteState(g, dist > 1.4 ? "hunt" : "capture");
      g.group.rotation.y = lerpAngle(g.group.rotation.y, Math.atan2(dx, dz), 1 - Math.pow(0.0001, dt));
      if (dist > 1.4) {
        const sp = g.speed * 1.7;
        g.group.position.x += (dx / dist) * sp * dt;
        g.group.position.z += (dz / dist) * sp * dt;
        animChar(g.char, sp, dt);
      } else {
        animChar(g.char, 0, dt);
        if (CBZ.tryCapture) CBZ.tryCapture(g, dt);
      }
      updateFlashlight(g, dt);
      return;
    }

    if (g.investigate && g.investigate.t > 0) {
      noteState(g, "investigate");
      const inv = g.investigate;
      inv.t -= dt;
      questionNpcDuringSearch(g, dt);
      if (guardSees(g) && (((CBZ.game && CBZ.game.detection) || 0) > 12 || ((CBZ.game && CBZ.game.witnessReportT) || 0) > 0)) {
        g.hunt = 3.2;
        g.alert = 1.0;
        g.investigate = null;
        updateFlashlight(g, dt);
        return;
      }
      const dx = inv.x - g.group.position.x, dz = inv.z - g.group.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1.2 && inv.t > 0) {
        const sp = g.speed * 1.28;
        g.group.position.x += (dx / dist) * sp * dt;
        g.group.position.z += (dz / dist) * sp * dt;
        g.group.rotation.y = lerpAngle(g.group.rotation.y, Math.atan2(dx, dz), 1 - Math.pow(0.00008, dt));
        animChar(g.char, sp, dt);
      } else {
        inv.scan = (inv.scan || 0) + dt;
        g.group.rotation.y += Math.sin(inv.scan * 3.2) * dt * 0.9;
        animChar(g.char, 0, dt);
      }
      if (inv.t <= 0) g.investigate = null;
      updateFlashlight(g, dt);
      return;
    }

    if (g.alert > 0) {
      // freeze and stare at the player while alerted
      noteState(g, "alert");
      const dx = player.pos.x - g.group.position.x;
      const dz = player.pos.z - g.group.position.z;
      g.group.rotation.y = lerpAngle(g.group.rotation.y, Math.atan2(dx, dz), 1 - Math.pow(0.0001, dt));
      g.alert -= dt;
      animChar(g.char, 0, dt);
    } else {
      noteState(g, "patrol");
      const wp = g.waypoints[g.wi];
      const dx = wp.x - g.group.position.x, dz = wp.z - g.group.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.4) {
        g.wi = (g.wi + 1) % g.waypoints.length;
        animChar(g.char, 0, dt);
      } else {
        const vx = dx / dist, vz = dz / dist;
        g.group.position.x += vx * g.speed * dt;
        g.group.position.z += vz * g.speed * dt;
        g.group.rotation.y = lerpAngle(g.group.rotation.y, Math.atan2(dx, dz), 1 - Math.pow(0.00005, dt));
        animChar(g.char, g.speed, dt);
      }
    }
    updateFlashlight(g, dt);
  }

  // ---- line-of-sight test ----
  const raycaster = new THREE.Raycaster();
  const _ro = new THREE.Vector3(), _rd = new THREE.Vector3();
  // ONE cone test, two questions. It always answered "can this screw see the
  // PLAYER" because the player was the only thing in the prison worth hiding
  // from — but an inmate deciding whether to start something cares about the
  // same cone over a different patch of yard, and that is what makes a yard
  // read like a prison instead of a pit: violence happens where the screws
  // aren't looking. Same geometry, same LOS raycast, same blind conditions.
  function guardSeesPoint(g, x, y, z, shrink) {
    // dead, down, ASLEEP, bribed, held at gunpoint or tied = blind. A
    // sleeping man is the one sensor in this prison you beat by picking the
    // hour; a man staring down your muzzle (intimidate.js) or zip-tied on
    // the floor is one you beat with your hands.
    if (g.dead || g.ko > 0 || g.asleep || g.bribed > 0 || g.intimidMode === "scared" || g.tied) return false;
    if (g.corrupt && CBZ.game && (CBZ.game.racketProtectionT || 0) > 0) return false;
    const gx = g.group.position.x, gz = g.group.position.z;
    const dx = x - gx, dz = z - gz;
    const dist = Math.hypot(dx, dz);
    let vd = g.viewDist;
    if (shrink) vd *= shrink;                 // crouching shrinks spot range
    if (dist > vd || dist < 0.05) return false;
    const yaw = g.group.rotation.y;
    const dot = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / dist;
    if (dot < Math.cos(g.half)) return false; // outside the cone angle
    // ...AND SO DOES THE DARK. One hook, in the file that owns the cone math,
    // so every caller (the detection sweep, an inmate asking guardWatching,
    // the investigate branch three functions up) gets the same answer.
    // systems/prisonnight.js publishes it off the prison's own light state —
    // undefined everywhere else, so nothing outside escape mode changes.
    // Placed AFTER the range and angle tests on purpose: the scale can only
    // ever shrink the cone, so a point already outside it never pays for a
    // light lookup, and only the handful that survive reach the raycast.
    if (CBZ.sightScale && dist > vd * CBZ.sightScale(g, x, z)) return false;
    _ro.set(gx, 1.5, gz);
    _rd.set(dx, y + 1.0 - 1.5, dz).normalize();
    raycaster.set(_ro, _rd);
    raycaster.far = Math.max(0.1, dist - 0.4);
    if ((CBZ.losRaycast ? CBZ.losRaycast(raycaster, CBZ.losBlockers) : raycaster.intersectObjects(CBZ.losBlockers, false)).length > 0) return false; // cover
    return true;
  }
  function guardSees(g) {
    return guardSeesPoint(g, player.pos.x, player.pos.y, player.pos.z, player.crouch ? 0.55 : 0);
  }
  // "Is anyone in uniform watching this spot?" — the question an inmate asks
  // before starting something, and the reason the fights that do happen happen
  // in the blind corners rather than in front of the tower.
  function guardWatching(x, y, z) {
    for (const g of CBZ.guards || []) if (guardSeesPoint(g, x, y || 0, z, 0)) return g;
    return null;
  }

  // ---- CBZ.jailBoost — ONE shared ledger for "temporarily boost an actor's
  // fields, restore the exact bases later", plus the run-lifecycle watchers
  // every jail system used to hand-roll (lockdown / difficulty /
  // reinforcements each kept private lastElapsed + lastState copies of the
  // same bookkeeping; difficulty.js even carried a "mirrors reinforcements"
  // comment). Pure refactor home — semantics preserved by each caller.
  //   apply(tag, obj, {field: value}) — set absolute values (base saved once)
  //   scale(tag, obj, {field: mult})  — set base*mult, recomputed from the
  //                                     SNAPSHOT every call (never compounds)
  //   held(tag, obj) / count(tag)     — ledger queries
  //   restore(tag, obj) / restoreAll(tag) — put the saved bases back
  //   newRunWatcher(eps)              — returns poll(): true once when
  //                                     game.elapsed falls back (a new run)
  //   onStateExit(fn, states)         — fn(state) whenever play is left
  //                                     (one shared onAlways(91) dispatcher;
  //                                     hooks run in registration order)
  CBZ.jailBoost = (function () {
    const ledgers = Object.create(null);       // tag -> Map(obj -> {field: base})
    function ledger(tag) { return ledgers[tag] || (ledgers[tag] = new Map()); }
    function put(tag, obj, fields, fromBase) {
      if (!obj || !fields) return;
      const led = ledger(tag);
      let saved = led.get(obj);
      if (!saved) { saved = {}; led.set(obj, saved); }
      for (const f in fields) {
        if (!(f in saved)) saved[f] = obj[f];  // snapshot the base exactly once
        obj[f] = fromBase ? saved[f] * fields[f] : fields[f];
      }
    }
    const exitHooks = [];
    let lastState = CBZ.game ? CBZ.game.state : "title";
    CBZ.onAlways(91, function () {
      const s = CBZ.game.state;
      if (s === lastState) return;
      if (s !== "playing") {
        for (const h of exitHooks) {
          if (h.states && h.states.indexOf(s) === -1) continue;
          try { h.fn(s); } catch (e) {}
        }
      }
      lastState = s;
    });
    return {
      apply(tag, obj, fields) { put(tag, obj, fields, false); },
      scale(tag, obj, fields) { put(tag, obj, fields, true); },
      held(tag, obj) { const led = ledgers[tag]; return !!(led && led.has(obj)); },
      count(tag) { const led = ledgers[tag]; return led ? led.size : 0; },
      restore(tag, obj) {
        const led = ledgers[tag]; if (!led) return;
        const saved = led.get(obj); if (!saved) return;
        for (const f in saved) obj[f] = saved[f];
        led.delete(obj);
      },
      restoreAll(tag) {
        const led = ledgers[tag]; if (!led) return;
        led.forEach(function (saved, obj) { for (const f in saved) obj[f] = saved[f]; });
        led.clear();
      },
      newRunWatcher(eps) {
        const e0 = eps == null ? 0.5 : eps;
        let last = (CBZ.game && CBZ.game.elapsed) || 0;
        return function poll() {
          const e = (CBZ.game && CBZ.game.elapsed) || 0;
          const fell = e + e0 < last;
          last = e;
          return fell;
        };
      },
      onStateExit(fn, states) { exitHooks.push({ fn: fn, states: states || null }); },
    };
  })();

  /* THE THREE COUNTERS THAT NAME THE BUG. `torchAsWeapon` is the whole of the
     owner's complaint reduced to a number: a torch lit and held out in front
     of a man the guard is already close enough to grab. `litInDaylight` and
     `litWithWeaponDrawn` are the two ways it got there. All three must read 0
     with GUARD_TORCH_DISCIPLINE on, and the flag off is how you see them. */
  CBZ.guardTorchAudit = function () {
    const out = {
      discipline: torchDiscipline(), guards: 0, lit: 0, presented: 0,
      closeQuarters: 0, handBusy: 0,
      torchAsWeapon: 0, litInDaylight: 0, litWithWeaponDrawn: 0,
    };
    for (const g of CBZ.guards || []) {
      if (!g || !g.group) continue;
      out.guards++;
      const busy = torchHandBusy(g);
      // The audit asks the flag-INDEPENDENT question — is he inside grabbing
      // range of the man he is hunting — rather than reading the sticky
      // `_torchCQ`, which only the disciplined path ever writes. Both sides of
      // an A/B have to be measured by the same ruler.
      const dx = player.pos.x - g.group.position.x;
      const dz = player.pos.z - g.group.position.z;
      const near = g.hunt > 0 && dx * dx + dz * dz < TORCH_CQ_OUT * TORCH_CQ_OUT;
      if (busy) out.handBusy++;
      if (near) out.closeQuarters++;
      if (!g.flashlightOn) continue;
      out.lit++;
      if (g.flashlightPresented) out.presented++;
      if (near && g.flashlightPresented) out.torchAsWeapon++;
      if (busy) out.litWithWeaponDrawn++;
      if (g.flashlightReason === "search" && !torchDarkEnough(g)) out.litInDaylight++;
    }
    return out;
  };

  CBZ.updateGuard = updateGuard;
  CBZ.updateGuardFlashlight = updateFlashlight;
  CBZ.resolveGuardApproach = resolveGuardApproach;
  CBZ.startGuardPayoffApproach = startPayoffApproach;
  CBZ.addRacketStanding = addRacketStanding;
  CBZ.racketStanding = racketStanding;
  CBZ.guardSees = guardSees;
  CBZ.guardSeesPoint = guardSeesPoint;
  CBZ.guardWatching = guardWatching;
  CBZ.spawnGuard = makeGuard;   // systems/reinforcements.js spawns extra patrols

  // drive all guards every playing frame
  CBZ.onUpdate(20, function (dt) {
    if (CBZ.game.mode !== "escape") return;   // jail-only — prison guards never run in city/disaster
    if (barkCD > 0) barkCD -= dt;
    for (const g of CBZ.guards) updateGuard(g, dt);
  });
  CBZ.onUpdate(20.5, function (dt) { if (CBZ.game.mode !== "escape") return; updateRacketPressure(dt); });
})();

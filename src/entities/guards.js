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
    const group = new THREE.Group();
    group.position.set(0.02, -0.06, 0.08);

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.52), CBZ.mat(0x171b22));
    body.position.z = 0.02;
    body.castShadow = true;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.34, 0.13), CBZ.mat(0x0b0d12));
    grip.position.set(0, -0.08, -0.12);
    grip.castShadow = true;
    const lensMat = CBZ.mat(0xe8f6ff, { emissive: 0x000000, ei: 0 });
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.05), lensMat);
    lens.position.z = 0.30;
    group.add(body, grip, lens);
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
  makeGuard([[-12, 122], [12, 122], [12, 114], [-12, 114]], 3.0, 15, 0.64);
  // the Warden — slow, sharp-eyed patrol in the courtyard; bribe him for the gun-room key
  makeGuard([[14, 2], [2, 2], [2, -4], [14, -4]], 2.4, 16, 0.7, { kind: "warden" });

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
                   "Cigs up front and I'll forget your face.",
                   "Everyone's on the take in here, kid."];
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

  function payoffCost(g) {
    const heat = (CBZ.game && CBZ.game.detection) || 0;
    const complaints = (CBZ.game && CBZ.game.complaints) || 0;
    const jobCut = CBZ.game && CBZ.game.gangJob ? 4 : 0;
    return Math.max(5, Math.ceil(heat / 8) + Math.ceil(complaints / 12) + jobCut + (g.kind === "warden" ? 14 : 5) + racketPriceMod(0.75));
  }

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
    g.approach = null;
    g.approachCD = 12 + CBZ.econ.rng() * 12;
  }

  function startPayoffApproach(g, kind, extra) {
    kind = kind || "payoffOffer";
    extra = extra || {};
    const cost = kind === "racketOffer" ? racketCost(g, extra)
      : kind === "snitchIntel" ? snitchIntelCost(g, extra.snitch)
      : payoffCost(g);
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
    clearGuardApproach(g);
    if (CBZ.game.role === "cop") {
      CBZ.addComplaint && CBZ.addComplaint(reason === "refuse" ? 12 : 7);
    } else {
      if (a.kind === "racketOffer") {
        CBZ.game.racketDebt = Math.min(40, (CBZ.game.racketDebt || 0) + Math.ceil((a.cost || 5) * (reason === "refuse" ? 0.8 : 0.45)));
        addRacketStanding(reason === "refuse" ? -8 : -4);
        startCleanSweep(g, 12 + Math.ceil((a.cost || 5) * 0.7));
        if (CBZ.player && CBZ.player.gang != null && CBZ.addGangStanding) CBZ.addGangStanding(CBZ.player.gang, -2);
      } else if (a.kind === "witnessBlackmail" || a.kind === "payoffOffer" || a.kind === "snitchIntel") {
        addRacketStanding(reason === "refuse" ? -6 : -3);
      }
      CBZ.addHeat && CBZ.addHeat(a.kind === "racketOffer" ? (reason === "refuse" ? 18 : 11) : (reason === "refuse" ? 14 : 8));
      nudgeCleanGuard(g);
    }
    if (near && CBZ.flashHint) CBZ.flashHint(`${nameOf(g)} stops being friendly.`, 1.7);
  }

  function considerPayoffApproach(g, dt) {
    if (!g.corrupt || g.approach || g.bribed > 0 || g.ko > 0 || g.dead || g.hunt > 0) return;
    if (CBZ.playerApproachBusy && CBZ.playerApproachBusy(g)) return;
    g.approachCD = (g.approachCD || 0) - dt;
    if (g.approachCD > 0 || !CBZ.game || CBZ.game.state !== "playing") return;
    g.approachCD = 1.4 + CBZ.econ.rng() * 2.6;
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

  function racketHint(text) {
    const game = CBZ.game || {};
    if (!CBZ.flashHint) return;
    game.racketHintT = Math.max(0, (game.racketHintT || 0) - 1);
    if (game.racketHintT > 0) return;
    game.racketHintT = 3;
    CBZ.flashHint(text, 1.7);
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
      racketHint(`${nameOf(bent)} leans on the racket tab.`);
      game.racketPressureT = 8.5 + CBZ.econ.rng() * 5;
      return;
    }

    if (!protectedCut && (debt >= 26 || ledger <= -34 || (caseTrouble && ledger <= -18))) {
      startCleanSweep(bent, 16 + Math.min(18, debt * 0.45 + Math.max(0, -ledger) * 0.28));
      addRacketStanding(-2);
      tagNearbyBadgeRumor(bent, 24);
      racketHint(`${nameOf(bent)} leaks your trail to clean guards.`);
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

  function resolveGuardApproach(g, action) {
    const a = g && g.approach;
    if (!a) return { ok: false, msg: "They have no offer right now." };
    if (action === "listen") {
      return { ok: true, msg: a.kind === "witnessBlackmail"
        ? `${nameOf(g)}: ${a.source || "Somebody"} gave me a trail. Pay and it never reaches the log.`
        : a.kind === "racketOffer"
        ? `${nameOf(g)}: pay the cut and your contraband stays invisible.`
        : a.kind === "snitchIntel"
        ? `${nameOf(g)}: pay and I point you at the mouth feeding the log. Handle them yourself.`
        : `${nameOf(g)}: ${a.cost} cigs and the paperwork gets lost.` };
    }
    if (action === "pay") {
      if (a.kind === "snitchIntel") {
        if ((CBZ.game.cigs || 0) < a.cost) return { ok: false, msg: `Need ${a.cost} cigs.` };
        CBZ.econ.addCigs(-a.cost);
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
          if (CBZ.game) CBZ.game.snitchIntelT = Math.max(CBZ.game.snitchIntelT || 0, 30);
          addRacketStanding(1);
          CBZ.sfx && CBZ.sfx("coin");
          clearGuardApproach(g);
          return { ok: true, msg: `${nameOf(g)} names ${nameOf(snitch)}. They are marked until you deal with them.` };
        }
        if (CBZ.addHeat) CBZ.addHeat(-3);
        addRacketStanding(1);
        CBZ.sfx && CBZ.sfx("coin");
        clearGuardApproach(g);
        return { ok: true, msg: `${nameOf(g)} takes the cigs, but the trail has gone cold.` };
      }
      if (a.kind === "witnessBlackmail") {
        if ((CBZ.game.cigs || 0) < a.cost) return { ok: false, msg: `Need ${a.cost} cigs.` };
        CBZ.econ.addCigs(-a.cost);
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
        return { ok: true, msg: `${nameOf(g)} buries the witness report. Bent trust ${racketStanding()}.` };
      }
      if (a.kind === "racketOffer") {
        if ((CBZ.game.cigs || 0) < a.cost) return { ok: false, msg: `Need ${a.cost} cigs.` };
        CBZ.econ.addCigs(-a.cost);
        g.bribed = Math.max(g.bribed || 0, 24);
        g.alert = 0; g.hunt = 0;
        CBZ.game.racketProtectionT = Math.max(CBZ.game.racketProtectionT || 0, 32 + Math.min(28, a.cost * 2));
        CBZ.game.racketGuard = nameOf(g);
        CBZ.game.racketDebt = Math.max(0, (CBZ.game.racketDebt || 0) - a.cost * 2 - 5);
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
        return { ok: true, msg: `${nameOf(g)} pockets the cut. Bent trust ${racketStanding()}, cover ${Math.ceil(CBZ.game.racketProtectionT)}s.` };
      }
      const res = CBZ.econ.payoff(g);
      if (res && res.ok) { addRacketStanding(3); clearGuardApproach(g); }
      return res;
    }
    if (action === "haggle") {
      if (a.haggled || a.cost <= 3) return { ok: false, msg: `${nameOf(g)} won't move on the price.` };
      a.haggled = true;
      const heat = (CBZ.game && CBZ.game.detection) || 0;
      const chance = Math.max(0.18, Math.min(0.72, (g.corrupt ? 0.45 : 0.24) - heat * 0.002 + ((CBZ.game.cigs || 0) < a.cost ? 0.12 : 0)));
      if (CBZ.econ.rng() < chance) {
        a.cost = Math.max(3, a.cost - 2 - Math.floor(CBZ.econ.rng() * 3));
        a.t = Math.max(a.t || 0, 7);
        addRacketStanding(-1);
        return { ok: true, msg: `${nameOf(g)} mutters, "Fine. ${a.cost} cigs."` };
      }
      a.cost += 2;
      if (a.kind === "racketOffer") CBZ.game.racketDebt = Math.min(40, (CBZ.game.racketDebt || 0) + 1);
      addRacketStanding(-2);
      if (CBZ.addHeat) CBZ.addHeat(4);
      return { ok: false, msg: `${nameOf(g)} raises it to ${a.cost}.` };
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
        CBZ.game.racketDebt = Math.min(40, (CBZ.game.racketDebt || 0) + Math.ceil((a.cost || 5) * 0.7));
        startCleanSweep(g, 18 + Math.ceil((a.cost || 5) * 0.6));
      }
      if (a.kind === "snitchIntel" && CBZ.game) {
        CBZ.game.witnessReportT = Math.max(CBZ.game.witnessReportT || 0, 8);
        CBZ.game.racketDebt = Math.min(40, (CBZ.game.racketDebt || 0) + 2);
      }
      if (CBZ.addHeat) CBZ.addHeat(g.corrupt ? 12 : 28);
      nudgeCleanGuard(g);
      return { ok: false, msg: `${nameOf(g)} reaches for the radio.` };
    }
    if (action === "refuse") {
      if (a.kind === "snitchIntel" && CBZ.game) CBZ.game.snitchIntelT = 0;
      expireGuardApproach(g, "refuse");
      return { ok: false, msg: `${nameOf(g)} smiles like that was the wrong answer.` };
    }
    return { ok: false, msg: "" };
  }

  function shouldUseFlashlight(g) {
    if (g.dead || g.ko > 0 || g.bribed > 0) return false;
    const dayness = CBZ.dayness == null ? 1 : CBZ.dayness;
    const sunY = CBZ.sun && CBZ.sun.position ? CBZ.sun.position.y : 80;
    const nightAmount = CBZ.nightAmount == null ? (1 - dayness) : CBZ.nightAmount;
    const trueNight = (dayness < 0.045 && sunY < -8) || nightAmount > 0.965;
    const activeSearch = g.hunt > 0 || (g.investigate && g.investigate.t > 0);
    if (activeSearch) return "search";
    if (trueNight && g.flashlightPatrol) {
      const period = g.kind === "warden" ? 15 : 22;
      const duty = g.kind === "warden" ? 0.58 : 0.34;
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
    if (g.wedge) g.wedge.visible = on;
    if (g.flashlight) {
      g.flashlight.group.visible = on;
      g.flashlight.lensMat.emissive.setHex(on ? 0xcff6ff : 0x000000);
      g.flashlight.lensMat.emissiveIntensity = on ? 1.6 : 0;
    }
    if (!on && g.wedge && g.wedge.material) {
      g.wedge.material.opacity = 0;
    }
    if (on && g.char && g.char.parts && g.char.parts.ra) {
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
      if (nearPlayer && CBZ.flashHint) CBZ.flashHint(`${who} misdirects ${nameOf(g)}.`, 1.5);
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
      if (nearPlayer && CBZ.flashHint) CBZ.flashHint(`${who} points ${nameOf(g)} your way.`, 1.6);
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
    investigate: ["I heard something over there…", "Eyes open — something moved.", "Hold up. Checking that out."],
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
    if (CBZ.flashHint) CBZ.flashHint(`${nameOf(g)}: “${pool[(Math.random() * pool.length) | 0]}”`, 1.7);
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
      g.group.rotation.z = CBZ.damp(g.group.rotation.z, Math.PI / 2, 11, dt);
      updateFlashlight(g, dt);
      animChar(g.char, 0, dt);
      return;
    }

    if (g.bribed > 0) g.bribed -= dt;
    considerPayoffApproach(g, dt);

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
          CBZ.flashHint && CBZ.flashHint(a.msg + " Walk up to answer.", 2.1);
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
  function guardSees(g) {
    if (g.dead || g.ko > 0 || g.bribed > 0) return false;   // dead, down, or bribed = blind
    if (g.corrupt && CBZ.game && (CBZ.game.racketProtectionT || 0) > 0) return false;
    const gx = g.group.position.x, gz = g.group.position.z;
    const dx = player.pos.x - gx, dz = player.pos.z - gz;
    const dist = Math.hypot(dx, dz);
    let vd = g.viewDist;
    if (player.crouch) vd *= 0.55;            // crouching shrinks spot range
    if (dist > vd || dist < 0.05) return false;
    const yaw = g.group.rotation.y;
    const dot = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / dist;
    if (dot < Math.cos(g.half)) return false; // outside the cone angle
    _ro.set(gx, 1.5, gz);
    _rd.set(dx, player.pos.y + 1.0 - 1.5, dz).normalize();
    raycaster.set(_ro, _rd);
    raycaster.far = Math.max(0.1, dist - 0.4);
    if ((CBZ.losRaycast ? CBZ.losRaycast(raycaster, CBZ.losBlockers) : raycaster.intersectObjects(CBZ.losBlockers, false)).length > 0) return false; // cover
    return true;
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

  CBZ.updateGuard = updateGuard;
  CBZ.updateGuardFlashlight = updateFlashlight;
  CBZ.resolveGuardApproach = resolveGuardApproach;
  CBZ.startGuardPayoffApproach = startPayoffApproach;
  CBZ.addRacketStanding = addRacketStanding;
  CBZ.racketStanding = racketStanding;
  CBZ.guardSees = guardSees;
  CBZ.spawnGuard = makeGuard;   // systems/reinforcements.js spawns extra patrols

  // drive all guards every playing frame
  CBZ.onUpdate(20, function (dt) {
    if (CBZ.game.mode !== "escape") return;   // jail-only — prison guards never run in city/disaster
    if (barkCD > 0) barkCD -= dt;
    for (const g of CBZ.guards) updateGuard(g, dt);
  });
  CBZ.onUpdate(20.5, function (dt) { if (CBZ.game.mode !== "escape") return; updateRacketPressure(dt); });
})();

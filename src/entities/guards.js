/* ============================================================
   entities/guards.js — patrolling guards: model, waypoints, AI,
   and the line-of-sight test that feeds the detection system.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  // ---- CBZ.jailBoost — ONE shared ledger (EAGER: a dozen jail systems take
  // newRunWatcher()/onStateExit() handles from it while the page parses, long
  // before the prison itself is built) for "temporarily boost an actor's
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

  // This file's CONFIG defaults are published at parse: other files read
  // them before (or without) the prison ever being built.
  if (CBZ.CONFIG.JAIL_GUARD_BARKS == null) CBZ.CONFIG.JAIL_GUARD_BARKS = true;
  if (CBZ.CONFIG.GUARD_TORCH_DISCIPLINE == null) CBZ.CONFIG.GUARD_TORCH_DISCIPLINE = true;
  // Built when the prison is first needed, as if at this script's parse
  // point (core/prisonlazy.js). Body left at its old indent.
  CBZ.definePrison("entities/guards.js", function () {
  const { makeCharacter, animChar, visionWedge, player } = CBZ;

  // jail feature flag (self-defaulting — one-line revert via CBZ.CONFIG):
  // guards call out their state changes ("STOP RIGHT THERE!") near the player.

  let guardNo = 0;
  const CO_NAMES = ["Diaz", "Kowalski", "Brennan", "Okafor", "Reyes", "Haskell", "Morrow", "Pruitt", "Nguyen", "Castellano",
    "Doyle", "Whitaker", "Boone", "Ferris", "Lindqvist", "Tate", "Mendez", "Harlan", "Sutter", "Greer", "Dunleavy", "Abernathy",
    "Rourke", "Vasquez", "Bell", "Kincaid", "Oduya", "Marsh", "Tillman", "Soto"];
  function addFlashlight(ch) {
    // ONE MODEL at every scale: weapons/flashlight.js also feeds the physical
    // death drop and the inventory thumbnail.  Its +Z is the light direction;
    // rotate that axis onto the hand socket's -Y (down the forearm), so the
    // reflector sits beyond the fingers and the parented beam leaves the lens.
    const group = CBZ.buildFlashlight ? CBZ.buildFlashlight() : new THREE.Group();
    group.position.set(0.01, -0.025, 0.025);
    group.rotation.x = Math.PI / 2;
    // the model is life-size now (weapons/flashlight.js); the rig socket draws
    // at ~0.7x, so undo that or a guard carries a pen light
    group.scale.setScalar(1 / 0.70);
    const lens = group.userData.lens || null;
    const lensMat = group.userData.lensMat || (lens && lens.material) || CBZ.mat(0xe8f6ff, { emissive: 0x000000, ei: 0 });
    group.visible = false;
    ch.sockets.rightHand.add(group);
    return { group, lens, lensMat };
  }

  function makeGuard(waypoints, speed, viewDist, half, opts) {
    opts = opts || {};
    const warden = opts.kind === "warden";
    // ONE corrections uniform: these build colours are city/outfits.js's
    // CAT.warden / CAT.corrections verbatim (that file loads later, and
    // systems/prisonoutfits.js repaints every guard to the record within
    // 0.3 s). They used to be a different navy, so every guard popped colour.
    // THE WARDEN WEARS A SUIT, NOT A UNIFORM: city/outfits.js CAT.warden (the
    // charcoal three-piece) is the record; these are its first-frame colours.
    // An officer's badge, belt, radio, torch and cuff case are NOT built here
    // (that was a gold cube on the wrong side of the chest): they ride the
    // corrections record as entities/dutykit.js's one merged kit.
    const ch = makeCharacter(warden ? {
      legs: 0x24272e, torso: 0x2c2f36, collar: 0xf1f2ec, arms: 0x2c2f36,
      skin: 0xdcae84, shoes: 0x0c0d10, belt: 0x16171b,
    } : {
      legs: 0x202936, torso: 0x34475d, collar: 0xaab7c2, arms: 0x34475d,
      skin: 0xe7b58c, cap: 0x202b3b, capKind: "peaked:police", shoes: 0x111419,
    });
    ch.group.userData.dynamic = true;
    (CBZ.prisonRoot || CBZ.scene).add(ch.group);

    const wedge = visionWedge(viewDist, half, 18, 0xffe14d);
    wedge.visible = false;
    ch.group.add(wedge);
    const flashlight = addFlashlight(ch);

    // a CO has a surname on his shirt; inmates use it ("Officer #3" was a spreadsheet row)
    const name = warden ? "the Warden" : "Officer " + CO_NAMES[guardNo % CO_NAMES.length] + (guardNo++ >= CO_NAMES.length ? " " + Math.ceil(guardNo / CO_NAMES.length) : "");
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
          ? ["What do you want.", "Keep walking.", "Not now."]
          : ["Keep moving.", "Back to your block.", "Twelve-hour shift. Don't start.", "Tuck your shirt in."],
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
     through a real opening. (The patrol mover routes through CBZ.navGrid now,
     but a locked yard door is still a wall to it: starting him in the
     courtyard would strand him on the far side with no way to walk home.) */
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
    g.data.talk = ["You didn't see me.", "Need something brought in?", "Later. When it's quiet."];
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
      ? (extra.source ? `${extra.source} talked. ${finalCost} and it goes away.` : `Somebody talked. ${finalCost} and it goes away.`)
      : kind === "racketOffer"
      ? `${finalCost} and I don't toss your cell.`
      : kind === "snitchIntel"
      ? `${finalCost} and I give you a name.`
      : `${cost} and your sheet stays clean.`;
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
          ? "You know where I am."
          : "Offer stands. For now.", { force: true });
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
      CBZ.prisonSay(g, a.kind === "racketOffer" ? "You still owe the tab." : "We're done.",
        { force: true });
    }
  }

  function wardenNear() {
    const W = CBZ.warden;
    if (!W || typeof W.presence !== "function") return false;
    try { return (+W.presence() || 0) > 0.5; } catch (e) { return false; }
  }
  CBZ.guardsWardenNear = wardenNear;
  function considerPayoffApproach(g, dt) {
    if (!g.corrupt || g.approach || g.bribed > 0 || g.ko > 0 || g.dead || g.hunt > 0) return;
    if (wardenNear()) return;                 // nobody takes money with the boss on the floor
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
          ? `Still got that name. ${a.cost}.`
          : `Still ${a.cost}. Your sheet stays clean.`;
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
    "Post four. Got him for you.",
    "He's yours. Same spot.",
    "Control, eyes on. Passing it up.",
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
    if (!a) return { ok: false, msg: "Not now." };
    if (action === "listen") {
      // NO NAME, NO COLON. These four were the last of the `Name: line` shape
      // in the prison: the line floats over the speaker's own head
      // (systems/speech.js), so a name stapled to the front is the same man
      // introduced twice.
      /* AND HE STATES THE INSTRUMENT. Asking a bent officer what the deal is
         is the one moment the outside-money fiction belongs in a mouth: he
         says where the money actually goes, and asks the only question that
         decides whether you are in the conversation at all. Empty string when
         PRISON_PHONE_BRIDGE is off, so these four lines revert exactly. */
      const terms = deepKind(a) && CBZ.econ.phoneTerms ? CBZ.econ.phoneTerms() : "";
      const tail = terms ? " " + terms : "";
      return { ok: true, msg: a.kind === "witnessBlackmail"
        ? `${a.source || "Somebody"} saw you. Pay and it goes away.${tail}`
        : a.kind === "racketOffer"
        ? `Pay the cut. Nobody finds your stuff.${tail}`
        : a.kind === "snitchIntel"
        ? `Pay and I tell you who's talking.${tail}`
        : `${a.cost} and it goes away.` };
    }
    if (action === "pay" && wardenNear()) {
      return { ok: false, msg: "Not now." };
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
        if ((CBZ.game.cigs || 0) < a.cost) return { ok: false, msg: `${a.cost}. Come back when you have it.` };
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
          return { ok: true, msg: paidPrefix() + `It was ${nameOf(snitch)}. I never said it.` };
        }
        if (CBZ.addHeat) CBZ.addHeat(-3);
        addRacketStanding(1);
        CBZ.sfx && CBZ.sfx("coin");
        clearGuardApproach(g);
        return { ok: true, msg: paidPrefix() + "Trail's cold. I keep the fee." };
      }
      if (a.kind === "witnessBlackmail") {
        if ((CBZ.game.cigs || 0) < a.cost) return { ok: false, msg: `${a.cost}. Come back when you have it.` };
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
        return { ok: true, msg: paidPrefix() + "That statement's gone." };
      }
      if (a.kind === "racketOffer") {
        if ((CBZ.game.cigs || 0) < a.cost) return { ok: false, msg: `${a.cost}. Come back when you have it.` };
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
        return { ok: true, msg: paidPrefix() + "You're covered. For a while." };
      }
      // the price on the card, not a second one computed at the till — see the
      // note on econ.payoff()'s opts.cost. HAGGLE writes a.cost; this is what
      // makes that discount reach the money instead of only the chip.
      const res = CBZ.econ.payoff(g, { cost: a.cost });
      if (res && res.ok) { addRacketStanding(3); clearGuardApproach(g); }
      return res;
    }
    if (action === "haggle") {
      if (a.haggled || a.cost <= 3) return { ok: false, msg: "That's the price." };
      a.haggled = true;
      const heat = (CBZ.game && CBZ.game.detection) || 0;
      const chance = Math.max(0.18, Math.min(0.72, (g.corrupt ? 0.45 : 0.24) - heat * 0.002 + ((CBZ.game.cigs || 0) < a.cost ? 0.12 : 0)));
      if (CBZ.econ.rng() < chance) {
        a.cost = Math.max(3, a.cost - 2 - Math.floor(CBZ.econ.rng() * 3));
        a.t = Math.max(a.t || 0, 7);
        addRacketStanding(-1);
        return { ok: true, msg: `Fine. ${a.cost}.` };
      }
      a.cost += 2;
      if (a.kind === "racketOffer") CBZ.econ.addRacketDebt(1);
      addRacketStanding(-2);
      if (CBZ.addHeat) CBZ.addHeat(4);
      return { ok: false, msg: `Now it's ${a.cost}.` };
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
        return { ok: true, msg: snitch && snitch.data ? `${nameOf(snitch)}. Now get away from me.` : "You just bought trouble." };
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
      return { ok: false, msg: "Wrong answer." };
    }
    if (action === "refuse") {
      expireGuardApproach(g, "refuse");
      return { ok: false, msg: "Suit yourself." };
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
    // the SUN's height in the old light-position units (sin x 95). Not the key
    // light's y: past twilight the key is the moon, above the horizon all night.
    const sunY = Number.isFinite(CBZ.sunHeight) ? CBZ.sunHeight * 95 : (CBZ.sun && CBZ.sun.position ? CBZ.sun.position.y : 80);
    const nightAmount = CBZ.nightAmount == null ? (1 - dayness) : CBZ.nightAmount;
    const trueNight = (dayness < 0.045 && sunY < -8) || nightAmount > 0.965;
    const activeSearch = g.hunt > 0 || !!g._chase || (g.investigate && g.investigate.t > 0);
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
    // he turns to the screw at a man's rate (entities/npc.js's mover honours a face order)
    n._faceYaw = Math.atan2(g.group.position.x - n.group.position.x, g.group.position.z - n.group.position.z);
    n._faceTTL = 0.9;

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
      if (nearPlayer && CBZ.prisonSay) CBZ.prisonSay(n, "He went that way. South gate.", { force: true });
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
      if (nearPlayer && CBZ.prisonSay) CBZ.prisonSay(n, "Boss! He's right there.", { force: true });
      return;
    }

    inv.scan = Math.max(inv.scan || 0, 0.5);
    g.alert = Math.max(g.alert || 0, 0.45);
    if (CBZ.npcEmote) CBZ.npcEmote(n, "?");
  }

  /* ============================================================
     THE GUARD BRAIN (2026-09-27). Owner: "the idea is smart but the logic is
     dumb and it's not fun." What was dumb, read straight off the old movers:

       · every mover here was `position += (goal - position) * speed`. No
         walls. A hunting screw on the wrong side of the block wall pressed
         into it until systems/actorcollide.js shoved him back, every frame.
       · a hunt homed on the player's LIVE position for as long as its timer
         ran: through walls, round corners, lights out. Breaking line of sight
         did nothing and hiding did nothing, and lockdown.js tops that timer up
         every frame, so in a lockdown every guard in the prison knew exactly
         where you were standing.
       · sight was binary: one frame in the cone was "seen".

     What it is now. The one external lever stays `g.hunt` (lockdown, capture,
     reinforcements, intimidate, the product preset all write it); it means
     "you are in pursuit", and pursuit is now honest about what he can SEE.

       PATROL      walks his round through CBZ.navGrid: doors, not walls.
       SUSPICIOUS  something in his cone he has a REASON to care about (you in a
                   staff area, a wanted man, lockdown, a man he is searching
                   for) fills a meter: he stops, his head turns first, then his
                   body, and he says so. Close, lit, running, high tier, high
                   heat fill it faster; crouching and the dark slower. Break
                   sight and it drains. A meter that sat high with nothing to
                   see sends him to look at the spot.
       HUNT        full meter (or an order): he chases where he SEES you. The
                   moment he doesn't, he runs to where he LAST saw you (his own
                   memory, or a radio fix), never to your live position.
       SEARCH      at the last known spot he looks round, then checks 2-3 nearby
                   points, first the way you were heading, for ~10-17 s (tier
                   and heat stretch it). Lockdown keeps him hunting, so there
                   the sweep widens ring by ring instead of ending.
       RETURN      walks back to the nearest point of his round.

     Noise (CBZ.guardHear) pulls the nearest one or two to a spot; a hunting
     guard's radio (systems/detection.js) sends backup to his LAST KNOWN spot.
  ============================================================ */
  // Short, the way a screw actually talks. Most state changes say nothing.
  const BARKS = {
    hunt: ["Hey!", "Stop!", "Runner!"],
    huntWarden: ["Stop him."],
    suspicious: ["Hey. You.", "Who's that?"],
    search: ["Where'd he go?", "Lost him."],
    investigate: ["Hold up.", "What was that?"],
    heldup: ["Easy.", "Easy now."],
    // systems/capture.js + prisonlaw.js speak these through CBZ.guardLine
    order: ["On the ground! Now!", "Stop right there!", "Hands where I can see them!", "Down! Get down!"],
    warned: ["Move along.", "Don't let me see it again.", "Walk away."],
    cuff: ["Hands behind your back.", "Don't move."],
    breakup: ["Break it up!", "Hey! Break it up!", "Back off! Now!"],
  };
  let barkCD = 0;   // global spacing so barks never spam the speech line

  function guardBark(g, s, prev) {
    if (!(CBZ.CONFIG && CBZ.CONFIG.JAIL_GUARD_BARKS)) return;
    if (barkCD > 0 || !CBZ.game || CBZ.game.mode !== "escape" || CBZ.game.state !== "playing") return;
    if (g.dead || g.ko > 0 || g.bribed > 0) return;
    let pool = null;
    if (s === "hunt" && prev !== "capture" && prev !== "search") pool = g.kind === "warden" ? BARKS.huntWarden : BARKS.hunt;
    else if (s === "suspicious" && Math.random() < 0.5) pool = BARKS.suspicious;
    else if (s === "search" && prev === "hunt") pool = BARKS.search;
    else if (s === "investigate" && Math.random() < 0.35) pool = BARKS.investigate;
    else if (s === "heldup") pool = BARKS.heldup;
    if (!pool) return;
    const dx = player.pos.x - g.group.position.x, dz = player.pos.z - g.group.position.z;
    if (dx * dx + dz * dz > 26 * 26) return;   // out of earshot
    barkCD = 3.5;
    const line = pool[(Math.random() * pool.length) | 0];
    if (CBZ.prisonSay) CBZ.prisonSay(g, line, { force: true });
  }
  // A line the LAW needs said now (the order, the warning, the cuffs, break it
  // up): over this screw's head, outranking chatter, ignoring the bark spacing
  // when forced. One short line, never a speech.
  CBZ.guardLine = function (g, kind, opts) {
    opts = opts || {};
    const pool = BARKS[kind];
    if (!g || !pool || !CBZ.prisonSay) return false;
    if (!opts.force && barkCD > 0) return false;
    barkCD = 3.0;
    const line = pool[((g.id || 0) + ((Math.random() * 2) | 0)) % pool.length];
    try { return CBZ.prisonSay(g, line, { secs: opts.secs || 1.8, force: true }); } catch (e) { return false; }
  };

  function noteState(g, s) {
    if (g.state === s) return;
    const prev = g.state;
    g.state = s;
    guardBark(g, s, prev);
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

  // ---- tunables -------------------------------------------------------------
  const SUS_ON = 0.3;          // meter at which he stops and turns (SUSPICIOUS)
  const SUS_OFF = 0.1;         // ... and below which he lets it go
  const SUS_CHECK = 0.5;       // a meter still this high with nothing to see: go and look
  const CAPTURE_R = 1.4;       // m: capture.js's reach (unchanged)
  const ORDER_R = 4.2;         // m: where he gives the order (capture.js ARREST.ORDER_R)
  const RADIO_FIX_EVERY = 3;   // s between a blind pursuer adopting the block's newest fix
  const GIVE_UP_STALL = 3.5;   // s without closing on a search point: skip it

  // ---- the per-frame read of the player, shared by every guard ---------------
  let wardenSharp = 1;          // 1..1.15, the warden's presence on the cone
  const ctx = {
    warden: 0,
    heat: 0, reason: 0, zone: null, lock: false, invuln: false,
    moveMul: 1, lightMul: 1, diffMul: 1, viewMul: 1, tier: 1, searchLen: 12,
    pvx: 0, pvz: 0, pv: 0,
  };
  let prevPX = null, prevPZ = null, pollGuardRun = null;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function clock() { return (CBZ.game && CBZ.game.elapsed) || 0; }
  function tierLevel() {
    const T = CBZ.prisonTier;
    try { return T && T.enabled && T.enabled() ? T.level() : 1; } catch (e) { return 1; }
  }
  function frameContext(dt) {
    const G = CBZ.game || {};
    const px = player.pos.x, pz = player.pos.z;
    if (prevPX != null && dt > 0) {
      const k = Math.min(1, dt * 8);
      const vx = clamp((px - prevPX) / dt, -12, 12), vz = clamp((pz - prevPZ) / dt, -12, 12);
      ctx.pvx += (vx - ctx.pvx) * k; ctx.pvz += (vz - ctx.pvz) * k;
      ctx.pv = Math.hypot(ctx.pvx, ctx.pvz);
    }
    prevPX = px; prevPZ = pz;
    ctx.heat = G.detection || 0;
    ctx.zone = CBZ.restrictedZoneAt ? CBZ.restrictedZoneAt(player.pos) : null;
    ctx.lock = !!(CBZ.lockdownActive && CBZ.lockdownActive()) && !(CBZ.playerInOwnCell && CBZ.playerInOwnCell());
    const wanted = ctx.heat > 18 || (G.witnessReportT || 0) > 0;
    let r = 0;
    if (ctx.zone) r = Math.max(r, ctx.zone === "the armory" ? 1.5 : 0.9);
    if (wanted) r = Math.max(r, 1.35);
    if (ctx.lock) r = Math.max(r, 1.6);
    ctx.reason = r;
    ctx.moveMul = player.crouch ? 0.6 : ctx.pv > 3.4 ? 1.55 : ctx.pv < 0.4 ? 0.8 : 1;
    let L = 1;
    const lights = CBZ.prisonLights;
    if (lights && lights.level) { try { const v = lights.level(px, pz); if (typeof v === "number" && v === v) L = v; } catch (e) {} }
    ctx.lightMul = 0.55 + 0.6 * clamp(L, 0, 1);
    ctx.tier = tierLevel();
    // DIFFICULTY: the tier is what the prison IS, heat is how hard it is
    // looking for you right now. Both nudge; neither turns a screw into a hawk.
    ctx.diffMul = (1 + 0.12 * ctx.tier) * (1 + Math.min(0.4, ctx.heat / 250));
    // THE WARDEN ON THE FLOOR (systems/prisonwarden.js): his screws look
    // harder while he is near the action (+15% reach and cone at presence 1)
    let wp = 0;
    const W = CBZ.warden;
    if (W && typeof W.presence === "function") { try { wp = +W.presence() || 0; } catch (e) { wp = 0; } }
    ctx.warden = clamp(wp, 0, 1);
    wardenSharp = 1 + 0.15 * ctx.warden;
    ctx.viewMul = (1 + Math.min(0.15, ctx.heat / 600)) * wardenSharp;
    ctx.searchLen = 10 + 1.2 * ctx.tier + Math.min(4, ctx.heat / 25);
    ctx.invuln = (G.invuln || 0) > 0 || !!player.dead ||
      !!(player.captureState && player.captureState !== "normal");
  }

  // ---- movement through the navigator ---------------------------------------
  function navOn() { return !!(CBZ.prisonNav && CBZ.prisonNav.ready && CBZ.prisonNav.ready()); }
  const NAV_OPTS = {
    speed: 3, arrive: 0.55, sealedWait: 2.5,
    wait: function (a, s) { a._navWait = Math.max(a._navWait || 0, s); },
  };
  /* ONE mover for every branch, and it is CBZ.moves (entities/moves.js).
     The navigator rewrites `_navT` into the next waypoint of a walk that
     exists (round the wall, through the door), or leaves it alone when the
     straight line is clear; the motor walks it. This used to be
     `p += dir * min(d, sp*dt)` with the yaw lerped at 1 - 0.00005^dt (16%
     of the angle per frame): full pace from a standstill, a dead stop at the
     spot, a 180 at the end of a beat inside a quarter of a second, and legs
     fed the ORDERED pace so a screw held on a doorframe ran on the spot.
     Now he speeds up and brakes like a man, turns in place at the end of a
     beat, keeps right of the inmates he passes, and his legs animate the
     ground he actually covered.
       stop  arrival radius for this order (he brakes INTO it)
       leg   a point he walks THROUGH (a patrol corner), no braking
     Returns the straight distance still left to (tx, tz). */
  const GMV = { speed: 1.4, stop: 0.3, leg: false, face: null, strafe: false,
    nbrs: null, nbrN: 0, lod: 0, accel: 0, turnRate: 0 };
  const _gNbrs = [];
  function guardLod(g) {
    const dx = g.group.position.x - player.pos.x, dz = g.group.position.z - player.pos.z;
    return CBZ.moves.lodFor(dx * dx + dz * dz, g.group.visible);
  }
  function walkTo(g, tx, tz, sp, dt, stop, leg, ty) {
    const p = g.group.position;
    /* ANOTHER LEVEL (systems/climb.js, the nav link): a man on a tower deck
       walking to the yard walks to the hatch and climbs down; a man in the
       yard going for someone up a tower walks to its foot and climbs up.
       `ty` is the target's height (undefined = the floor under it). */
    if (CBZ.climb && CBZ.climb.list.length) {
      const D = CBZ.climb.detour(g, tx, ty, tz);
      if (D) {
        if (D.climbing) return Math.hypot(tx - p.x, tz - p.z);
        tx = D.x; tz = D.z; stop = D.wait ? 0.5 : 0.25; leg = false;
        if (D.wait && Math.hypot(tx - p.x, tz - p.z) < 0.7) { stand(g, dt); return Math.hypot(tx - p.x, tz - p.z); }
      }
    }
    const T = g._navT || (g._navT = new THREE.Vector3());
    T.set(tx, 0, tz);
    // CBZ.vitals: a screw wrapping his own wound stands to do it; a groggy,
    // bled-white or leg-shot one walks slower
    const VT = CBZ.vitals;
    if (VT) {
      if (VT.busy(g)) { stand(g, dt); return Math.hypot(tx - p.x, tz - p.z); }
      sp *= VT.speedMul(g);
    }
    // the ground's navigator knows nothing above it: up a tower he walks straight
    if (navOn() && !(p.y > 1.2)) { NAV_OPTS.speed = sp; CBZ.navGrid.step(g, p, T, dt, NAV_OPTS); }
    if ((g._navWait || 0) > 0) {                    // a shut door on his route: he stands at it
      g._navWait -= dt;
      stand(g, dt);
      return Math.hypot(tx - p.x, tz - p.z);
    }
    const M = CBZ.moves, m = M.motor(g), O = GMV;
    // a navigator waypoint short of its goal is a corner: walked through
    // (a goal the grid only SNAPPED out of a bench is still a goal: braked into)
    const S = g._nav;
    // (a stair route's waypoints — navgrid's level layer — are corners too)
    const routed = !!(S && S.pts && S.gx != null && Math.hypot(T.x - S.gx, T.z - S.gz) > 0.3)
      || !!(g._lvl && g._lvl.pts);
    O.speed = sp; O.stop = routed ? 0.3 : (stop || 0.3); O.leg = routed || !!leg;
    O.face = null; O.strafe = false; O.turnRate = 0;
    O.accel = sp > 3 ? 5.2 : 0;
    O.lod = guardLod(g);
    O.nbrs = null; O.nbrN = 0;
    if (O.lod === 0 && CBZ.jailNbrs) { O.nbrN = CBZ.jailNbrs(p, _gNbrs); O.nbrs = _gNbrs; }
    const x0 = p.x, z0 = p.z;
    M.step(m, p, g.group.rotation.y, T.x, T.z, O, dt);
    g.group.rotation.y = m.yaw;
    g._cmd = (g._cmd || 0) + Math.hypot(p.x - x0, p.z - z0);
    animChar(g.char, Math.min(m.gs, m.speed + 0.4), dt);
    return Math.hypot(tx - p.x, tz - p.z);
  }
  /* STAND: brake to a halt where he is (a sprinting screw takes a step or
     two to do it, never a dead stop inside a frame) and let the legs follow
     the ground. Every "stop and ..." branch goes through this. */
  function stand(g, dt) {
    const M = CBZ.moves, m = M.motor(g), O = GMV, p = g.group.position;
    O.speed = 0; O.stop = 0.3; O.leg = false; O.face = null; O.strafe = false;
    O.accel = 0; O.turnRate = 0; O.nbrs = null; O.nbrN = 0; O.lod = 1;
    M.step(m, p, g.group.rotation.y, p.x, p.z, O, dt);
    g.group.rotation.y = m.yaw;
    animChar(g.char, Math.min(m.gs, m.speed + 0.4), dt);
  }
  // another system owns the body (a corpse, a bunk, an escort): forget motion
  function still(g) { CBZ.moves.reset(CBZ.moves.motor(g), g.group.position); }
  /* Turn the body toward a point at a man's rate. `k` was the old lerp
     sharpness; the slow ones (a suspicious look that lets the head lead) keep
     a slower bounded turn, everything else turns at the standing rate. */
  function faceTo(g, x, z, k, dt) {
    const p = g.group.position;
    const dx = x - p.x, dz = z - p.z;
    if (dx * dx + dz * dz < 1e-4) return;
    const m = CBZ.moves.motor(g);
    g.group.rotation.y = CBZ.moves.faceAt(m, g.group.rotation.y, p, x, z, dt, k >= 0.005 ? 2.2 : 0);
  }
  function wrapA(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
  // the head leads the body: a yaw offset on the neck, ADDITIVE (facial.js and
  // reactions.js add and remove their own offsets on the same channel)
  function lookAtPoint(g, x, z) {
    const b = Math.atan2(x - g.group.position.x, z - g.group.position.z);
    g._lookWant = clamp(wrapA(b - g.group.rotation.y), -1.0, 1.0);
  }
  function neckTurn(g, dt) {
    const n = g.char && g.char.neck;
    if (!n) return;
    const cur = g._neckYaw || 0, want = g._lookWant || 0;
    const nv = cur + (want - cur) * (1 - Math.exp(-7 * dt));
    n.rotation.y += nv - cur;
    g._neckYaw = nv;
  }

  // ---- perception -------------------------------------------------------------
  /* THE SPOT METER IS THE BRAIN'S (CBZ.brain.perception.awareness): the one
     sight test, filling faster close, centre-of-cone, lit and on a man who is
     moving, holding a beat after sight breaks and then draining. This file
     used to own the meter and an instant spot inside 2.6 m; the prison now
     only says WHY a screw would care (`reason`) and how hard he is looking.
     A man at arm's reach is still instant; one across a cell takes a beat.
     `g.sus` / `g.susHold` stay the meter's public face: other files write
     them (a noise turns his head, a warning stands him down), so they are
     carried into the brain's record before it moves and read back after. */
  const _aw = { range: 0, fovHalf: 0, shrink: 1, eyeY: 1.5, targetY: 1.0, light: null, reason: 0, moveMul: 1, mul: 1 };
  function perceive(g, dt) {
    const px = player.pos.x, pz = player.pos.z;
    // a man he is already looking FOR is a reason all by itself
    let reason = ctx.reason;
    const inv = g.investigate;
    if (g.hunt > 0 || (inv && inv.type === "search")) reason = Math.max(reason, 1.3);
    else if (inv && inv.looking) reason = Math.max(reason, 1.1);          // sent by a radio call
    else if (inv && inv.player && Math.hypot(px - inv.x, pz - inv.z) < 7) reason = Math.max(reason, 0.8);   // at the scene of the noise
    const per = CBZ.brain && CBZ.brain.perception;
    let sees = false;
    if (per) {
      const blindToYou = ctx.invuln || (g.corrupt && CBZ.game && (CBZ.game.racketProtectionT || 0) > 0);
      const mem = CBZ.brain.memory;
      mem.setAware(g, player, g.sus || 0, g.susHold || 0);
      _aw.range = blindToYou ? 0 : g.viewDist * ctx.viewMul;
      _aw.fovHalf = Math.min(1.45, g.half * wardenSharp);
      _aw.shrink = player.crouch ? 0.55 : 1;
      _aw.light = CBZ.sightScale ? prisonDark : null;
      _aw.reason = reason;
      _aw.moveMul = ctx.moveMul;
      _aw.mul = ctx.diffMul * (g.flashlightOn ? 1.25 : 1);
      // reason 0 (seen, nothing to care about) drains inside the brain's meter
      g.sus = per.awareness(g, player, dt, _aw);
      const r = mem.aware(g, player);
      sees = !!r.visible;
      g.susHold = r.hold;
    }
    g.seesPlayer = sees;
    if (sees) { g.lkX = px; g.lkZ = pz; g.lkVX = ctx.pvx; g.lkVZ = ctx.pvz; g.lkAt = clock(); }
    if (sees && reason > 0) { g.susX = px; g.susZ = pz; }
    // what systems/detection.js acts on: CONFIRMED sight, not a glimpse
    g.spotted = sees && (g.sus >= 1 || g.hunt > 0);
  }

  // ---- the search: last known spot, then 2-3 points around it ------------------
  const rng = () => (CBZ.econ && CBZ.econ.rng ? CBZ.econ.rng() : Math.random());
  function sweepPoints(S, n) {
    const G = navOn() ? CBZ.navGrid : null;
    const out = [];
    const cand = [];
    const sp = Math.hypot(S.vx || 0, S.vz || 0);
    const ring = S.rings || 0;
    // first, the way he was going when he was last seen
    if (sp > 0.8 && ring === 0) cand.push([S.x + (S.vx / sp) * 6.5, S.z + (S.vz / sp) * 6.5]);
    const a0 = rng() * Math.PI * 2;
    for (let k = 0; k < 6; k++) {
      const a = a0 + (k * Math.PI * 2) / 6;
      const r = 4 + ring * 3.5 + rng() * 4;
      cand.push([S.x + Math.cos(a) * r, S.z + Math.sin(a) * r]);
    }
    for (let k = 0; k < cand.length && out.length < n; k++) {
      let x = cand[k][0], z = cand[k][1];
      if (G && !G.standable(x, z)) {
        const id = G.nearestFree(x, z, 6);
        if (id < 0) continue;
        const c = G.cellCentre(id); x = c.x; z = c.z;
      }
      let dup = false;
      for (const q of out) if (Math.hypot(q.x - x, q.z - z) < 2.5) { dup = true; break; }
      if (!dup) out.push({ x, z });
    }
    return out;
  }
  // make any search record (a blind chase, an external `investigate`) walkable
  function primeSearch(S, npts) {
    if (S._primed) return S;
    S._primed = true;
    S.phase = S.phase || "goto";
    S.i = 0; S.look = 0; S.atPt = false; S.best = Infinity; S.stall = 0; S.walkT = 0;
    S.rings = S.rings || 0;
    S.npts = S.npts != null ? S.npts : npts;
    S.vx = S.vx || 0; S.vz = S.vz || 0;
    return S;
  }
  function recentre(S, x, z, vx, vz) {
    S.x = x; S.z = z; S.vx = vx || 0; S.vz = vz || 0;
    S.phase = "goto"; S.pts = null; S.i = 0; S.atPt = false; S.best = Infinity; S.stall = 0; S.walkT = 0; S.rings = 0;
  }
  function progress(S, d, dt) {
    if (d < S.best - 0.3) { S.best = d; S.stall = 0; } else S.stall += dt;
  }
  /* One step of a search. `gotoSp` is the pace to the spot, `sweepSp` round
     the points. Returns true while the search still has somewhere to go. */
  function searchStep(g, S, dt, gotoSp, sweepSp, keepWidening) {
    if (S.phase === "goto") {
      const d = walkTo(g, S.x, S.z, gotoSp, dt, 1.1);
      progress(S, d, dt);
      S.walkT += dt;
      if (d < 1.3 || S.stall > GIVE_UP_STALL || S.walkT > 30) {
        S.phase = "sweep";
        S.pts = sweepPoints(S, S.npts);
        S.i = 0; S.atPt = true; S.look = 1.4 + rng() * 1.0; S.scan = 0;
      }
      return true;
    }
    if (S.atPt) {
      // stood still, looking round: body sways, head sweeps wider
      S.look -= dt;
      S.scan = (S.scan || 0) + dt;
      g.group.rotation.y += Math.sin(S.scan * 2.1) * dt * 1.5;
      g._lookWant = Math.sin(S.scan * 2.9 + 0.7) * 0.85;
      stand(g, dt);
      if (S.look <= 0) { S.atPt = false; S.best = Infinity; S.stall = 0; }
      return true;
    }
    if (S.pts && S.i < S.pts.length) {
      const q = S.pts[S.i];
      const d = walkTo(g, q.x, q.z, sweepSp, dt, 0.8);
      progress(S, d, dt);
      if (d < 1.0 || S.stall > GIVE_UP_STALL) {
        S.i++; S.atPt = true; S.look = 1.2 + rng() * 1.3; S.scan = 0;
      }
      return true;
    }
    if (keepWidening) {                            // still ordered to hunt: widen the ring
      S.rings = (S.rings || 0) >= 4 ? 1 : (S.rings || 0) + 1;
      S.pts = sweepPoints(S, 3); S.i = 0; S.atPt = false; S.best = Infinity; S.stall = 0;
      return true;
    }
    return false;                                   // every point checked
  }

  /* A blind pursuer adopts the block's newest fix, a few seconds apart: that is
     another officer (or a lens, or a snitch) calling it in, never a leash. */
  function radioFix(g, S) {
    const lk = CBZ.game && CBZ.game.lastKnown;
    if (!lk || !(lk.t > 0) || lk.heardOnly || !isFinite(lk.x) || !isFinite(lk.z)) return;
    if ((lk.at || 0) <= (S.fixAt || 0)) return;
    if (clock() - (S.fixCheck || -99) < RADIO_FIX_EVERY) return;
    S.fixCheck = clock();
    S.fixAt = lk.at || clock();
    if (Math.hypot(lk.x - S.x, lk.z - S.z) < 3) return;
    recentre(S, lk.x, lk.z, 0, 0);
  }

  // an order with no sighting behind it: the freshest fix there is. Last
  // resort is control reading him where you stand NOW, once: a snapshot.
  function seedChase(g) {
    const now = clock();
    let S;
    if (g.lkAt != null && now - g.lkAt >= 0 && now - g.lkAt < 25) S = { x: g.lkX, z: g.lkZ, vx: g.lkVX, vz: g.lkVZ };
    else {
      const lk = CBZ.game && CBZ.game.lastKnown;
      if (lk && lk.t > 0 && isFinite(lk.x) && isFinite(lk.z)) S = { x: lk.x, z: lk.z };
      else S = { x: player.pos.x, z: player.pos.z };
    }
    S.fixAt = now;
    g._chase = primeSearch(S, 3);
    return g._chase;
  }

  function endSearch(g) {
    g.investigate = null;
    // back to the nearest point of his round, not the one he left from
    let best = g.wi || 0, bd = Infinity;
    const wps = g.waypoints || [];
    for (let i = 0; i < wps.length; i++) {
      const d = Math.hypot(wps[i].x - g.group.position.x, wps[i].z - g.group.position.z);
      if (d < bd) { bd = d; best = i; }
    }
    g.wi = best;
    g._returning = true;
  }

  // ---- per-guard think ----------------------------------------------------------
  function think(g, dt) {
    const pdx = player.pos.x - g.group.position.x, pdz = player.pos.z - g.group.position.z;
    // rig draw range rides the LIVE quality tier (mid-tier ≈ the old fixed 52u)
    const nr = CBZ.qScale ? CBZ.qScale(34, 73) : 52;
    const renderNear = pdx * pdx + pdz * pdz < nr * nr;
    const renderImportant = g.alert > 0 || g.hunt > 0 || g.approach || g.investigate || g.kind === "warden";
    g.group.visible = renderNear || renderImportant;
    g.seesPlayer = false; g.spotted = false;
    if (g.dead) {
      noteState(g, "dead");
      g.hunt = 0; g.alert = 0; g.approach = null; g.investigate = null; g._chase = null; g.sus = 0;
      // systems/prisoncorpse.js owns the body: lie direction, walls, sprawl.
      // While it does, animChar must NOT run (the idle pose would fight the
      // sprawl for the same four pivots every frame).
      if (!(CBZ.prisonCorpseTick && CBZ.prisonCorpseTick(g, dt))) {
        g.group.rotation.z = CBZ.damp(g.group.rotation.z, Math.PI / 2, 11, dt);
        animChar(g.char, 0, dt);
      }
      still(g);
      updateFlashlight(g, dt);
      return false;
    }

    if (g.bribed > 0) g.bribed -= dt;
    if (g._earCD > 0) g._earCD -= dt;
    considerPayoffApproach(g, dt);

    // OFF SHIFT AND ASLEEP (systems/prisonrest.js sets and clears `asleep`;
    // city/propuse.js owns the body while it is set, including its lie roll).
    if (g.asleep) {
      noteState(g, "asleep");
      g.hunt = 0; g.alert = 0; g.investigate = null; g._chase = null; g.sus = 0;
      still(g);
      updateFlashlight(g, dt);
      animChar(g.char, 0, dt);
      return false;
    }

    // ON ESCORT DUTY (systems/capture.js's haul scene owns the body).
    if (g._escort) {
      noteState(g, "escort");
      g.hunt = 0; g.alert = 0; g.investigate = null; g.approach = null; g._chase = null; g.sus = 0;
      still(g);
      updateFlashlight(g, dt);
      return false;
    }

    // knocked out: topple over, do nothing, then climb back up
    if (g.ko > 0) {
      noteState(g, "ko");
      g.ko -= dt;
      g._chase = null;
      // a rig fall (entities/meleeposes.js) is the visible fall, for every
      // KO (CBZ.koFall gives one to a KO that came without it); the side
      // roll about the feet is only the no-rig fallback
      if (CBZ.koFall) CBZ.koFall(g);
      if (!(g.char && g.char.fall && g.char.fall.on)) g.group.rotation.z = CBZ.damp(g.group.rotation.z, Math.PI / 2, 11, dt);
      still(g);
      updateFlashlight(g, dt);
      animChar(g.char, 0, dt);
      if (g.ko <= 0 && CBZ.koRise) CBZ.koRise(g);
      return false;
    } else if (g.group.rotation.z !== 0) {
      g.group.rotation.z = CBZ.damp(g.group.rotation.z, 0, 9, dt); // stand back up
      if (Math.abs(g.group.rotation.z) < 0.02) g.group.rotation.z = 0;
    }

    // HELD AT GUNPOINT (systems/intimidate.js owns the state): he stands where
    // the muzzle found him, facing it; guardSeesPoint answers false for him.
    if (g.intimidMode === "scared") {
      noteState(g, "heldup");
      faceTo(g, player.pos.x, player.pos.z, 0.0006, dt);
      stand(g, dt);
      updateFlashlight(g, dt);
      return true;
    }

    if (g.approach) {
      noteState(g, "social");
      const a = g.approach;
      a.t -= dt;
      const dist = Math.hypot(pdx, pdz);
      if (dist > 20 || a.t <= 0 || CBZ.game.state !== "playing") {
        if (CBZ.game.state === "playing") expireGuardApproach(g, dist > 20 ? "walkedAway" : "timeout");
        else clearGuardApproach(g);
        updateFlashlight(g, dt);
        return true;
      }
      if (dist > 2.4) walkTo(g, player.pos.x, player.pos.z, g.speed * 1.18, dt, 2.3);
      else {
        faceTo(g, player.pos.x, player.pos.z, 0.0001, dt);
        stand(g, dt);
        if (!a.greeted) {
          a.greeted = true;
          // He has walked over to you and the head icon is up (markers.js):
          // the invitation is already on screen, no instruction bolted on.
          if (CBZ.prisonSay) CBZ.prisonSay(g, a.msg, { secs: 2.6, force: true });
        }
      }
      updateFlashlight(g, dt);
      return true;
    }

    perceive(g, dt);

    // ---- THE WARDEN GIVES ORDERS; HE DOES NOT RUN THEM (systems/prisonwarden.js).
    // A hunt, a search or a yard case that lands on him becomes an order to an
    // officer before any branch below can make him chase, frisk or cuff; his
    // gun and his inspections drive the body from there when they need to.
    if (g.kind === "warden" && CBZ.warden && CBZ.warden.body) {
      let own = false;
      try { own = !!CBZ.warden.body(g, dt); } catch (e) { own = false; }
      if (own) { noteState(g, "warden"); updateFlashlight(g, dt); return true; }
    }

    // ---- HUNT --------------------------------------------------------------
    // Somebody zeroed the hunt from outside (a bribe, a payoff, a held-up
    // screw standing down): the chase dies with it. A hunt that ran out on its
    // own clock (_huntRanOut) turns into a SEARCH of where he last had you.
    if (g._chase && !(g.hunt > 0)) {
      const S = g._chase;
      g._chase = null;
      if (g._huntRanOut) {
        S.type = "search"; S.t = ctx.searchLen; S.npts = 3;
        g.investigate = S;
      }
    }
    g._huntRanOut = false;
    if (g.hunt > 0) {
      g.hunt -= dt;
      if (g.hunt <= 0) { g.hunt = 0; g._huntRanOut = true; }
      g.investigate = null;
      g._returning = false;
      // the player outranks any yard case this screw was running
      if (g._yardCase && CBZ.prisonBrain) CBZ.prisonBrain.endCase(g);
      if (g.seesPlayer) {
        // eyes on: chase what he sees, and do not give up on a man in front of him
        if (g.hunt < 1.0 && ctx.reason > 0) { g.hunt = 1.0; g._huntRanOut = false; }
        const S = g._chase || (g._chase = primeSearch({ x: player.pos.x, z: player.pos.z }, 3));
        recentre(S, player.pos.x, player.pos.z, ctx.pvx, ctx.pvz);
        S.fixAt = clock();
        // a man up a tower (or on its ladder) above him is not in arm's reach
        // however close he stands under it: the height counts
        const dist = Math.hypot(pdx, pdz, Math.max(0, Math.abs(player.pos.y - (g.group.position.y || 0)) - 0.8) * 3);
        lookAtPoint(g, player.pos.x, player.pos.z);
        // THE ORDER (systems/capture.js): inside ORDER_R he tells you, then
        // stands off at the distance the arrest asks for while you decide.
        let hold = CAPTURE_R;
        if (dist <= ORDER_R && CBZ.tryCapture) {
          const h = CBZ.tryCapture(g, dt);
          if (typeof h === "number" && h > 0) hold = h;
        }
        if (dist > hold) {
          noteState(g, "hunt");
          walkTo(g, player.pos.x, player.pos.z, g.speed * (hold > CAPTURE_R && dist < ORDER_R ? 1.0 : 1.7), dt, Math.max(0.3, hold - 0.1), false, player.pos.y);
        } else {
          noteState(g, "capture");
          faceTo(g, player.pos.x, player.pos.z, 0.0001, dt);
          stand(g, dt);
        }
      } else {
        // blind: run to where he last had you, then sweep round it. The hunt
        // clock (and lockdown's top-up) keeps him at it; nothing leashes him
        // to where you actually are.
        const S = g._chase || seedChase(g);
        radioFix(g, S);
        noteState(g, S.phase === "goto" ? "hunt" : "search");
        searchStep(g, S, dt, g.speed * 1.7, g.speed * 1.35, true);
      }
      updateFlashlight(g, dt);
      return true;
    }

    // ---- YARD LAW (systems/brain_prison.js): he saw two inmates at it and is
    // running the ladder on the one who started it — break it up, on the
    // ground, cuffs. CBZ.brain.authority decides the phase; this is his body.
    if (g._yardCase && CBZ.prisonBrain && CBZ.prisonBrain.guardLawStep(g, dt)) {
      noteState(g, "law");
      updateFlashlight(g, dt);
      return true;
    }

    // ---- A DOOR OFF THE CLOCK (systems/prisondoorwatch.js): he saw, heard or
    // was radioed about a door standing open when the day says shut. He calls
    // it, walks over, asks the officer, and shuts it himself if nobody does.
    if (g._doorCase && CBZ.prisonDoorWatch && CBZ.prisonDoorWatch.guardStep(g, dt)) {
      noteState(g, "law");
      updateFlashlight(g, dt);
      return true;
    }

    // THE PRODUCT PRESET (tools/visual-presets/prison-product.mjs) parks a man
    // with `pause`: he holds his post where he was put, eyes still open.
    if (g.pause > 0) {
      g.pause -= dt;
      noteState(g, "patrol");
      stand(g, dt);
      // an officer taking the warden's order turns to him while he hears it
      if (g._facePt) faceTo(g, g._facePt.x, g._facePt.z, 0.0001, dt);
      updateFlashlight(g, dt);
      return true;
    }

    // ---- WARNED YOU (detection.js opens `warnT` in a staff area) -----------
    if (g.warnT != null && g.warnT > 0) {
      noteState(g, "warn");
      faceTo(g, g.seesPlayer ? player.pos.x : (g.lkX != null ? g.lkX : player.pos.x),
        g.seesPlayer ? player.pos.z : (g.lkZ != null ? g.lkZ : player.pos.z), 0.0002, dt);
      stand(g, dt);
      updateFlashlight(g, dt);
      return true;
    }

    // ---- SEARCH / INVESTIGATE ----------------------------------------------
    if (g.investigate && g.investigate.t > 0) {
      const S = primeSearch(g.investigate, g.investigate.type === "search" ? 3 : g.investigate.looking ? 2 : 1);
      const lost = S.type === "search" || !!S.looking;
      noteState(g, lost ? "search" : "investigate");
      questionNpcDuringSearch(g, dt);
      // what he came to find: a wanted man, a man he is searching for, or the
      // man who made the noise, standing near where he made it
      const nearNoise = S.player && g.lkX != null && Math.hypot(g.lkX - S.x, g.lkZ - S.z) < 9;
      const wanted = ((CBZ.game && CBZ.game.detection) || 0) > 12 || ((CBZ.game && CBZ.game.witnessReportT) || 0) > 0;
      if (g.spotted && (lost || wanted || nearNoise || ctx.reason > 0)) {
        g.hunt = 3.2;
        g.alert = 1.0;
        g.investigate = null;
        updateFlashlight(g, dt);
        return true;
      }
      // the countdown is the time he spends LOOKING, not walking there; a walk
      // that goes on too long still eats it
      if (S.phase !== "goto" || S.walkT > 20) S.t -= dt;
      const go = searchStep(g, S, dt, g.speed * (lost ? 1.45 : 1.28), g.speed * 1.1, false);
      if (!go || S.t <= 0) endSearch(g);
      updateFlashlight(g, dt);
      return true;
    }
    if (g.investigate) g.investigate = null;

    // ---- SUSPICIOUS ----------------------------------------------------------
    const sus = g.sus || 0;
    if (sus >= SUS_ON || (g.state === "suspicious" && sus > SUS_OFF)) {
      // head first, then the body comes round
      if (g.susX != null) {
        lookAtPoint(g, g.susX, g.susZ);
        faceTo(g, g.susX, g.susZ, 0.08, dt);
      }
      // a meter that stays high with nothing to see: he goes to look
      if (!g.seesPlayer && (g.susHold || 0) <= 0 && sus >= SUS_CHECK && g.susX != null) {
        g.investigate = { x: g.susX, z: g.susZ, t: 4.5, scan: 0, type: "suspicious", npts: 1 };
        g.sus = Math.min(sus, 0.45);
      }
      noteState(g, "suspicious");
      stand(g, dt);
      updateFlashlight(g, dt);
      return true;
    }

    if (g.alert > 0) {
      // stop and watch: the man if he can see him, else where he last had him
      noteState(g, "alert");
      if (g.seesPlayer) faceTo(g, player.pos.x, player.pos.z, 0.0001, dt);
      else if (g.susX != null && (g.susHold || 0) > -4) faceTo(g, g.susX, g.susZ, 0.01, dt);
      g.alert -= dt;
      stand(g, dt);
      updateFlashlight(g, dt);
      return true;
    }

    // ---- PATROL / RETURN -----------------------------------------------------
    const wps = g.waypoints;
    if (!wps || !wps.length) { noteState(g, "patrol"); stand(g, dt); updateFlashlight(g, dt); return true; }
    if (g.wi >= wps.length || g.wi < 0) g.wi = 0;
    const wp = wps[g.wi];
    const d = walkTo(g, wp.x, wp.z, g.speed, dt, 0.3, !g._returning && patrolCorner(g, wps));
    if (g._returning) {
      noteState(g, "return");
      if (d < 1.0) g._returning = false;
    } else noteState(g, "patrol");
    // a waypoint he cannot quite stand on (inside a bench's collider, behind a
    // shut door) is passed once he stops closing on it, never ground into
    if (g._wpI !== g.wi || d < g._wpBest - 0.05) { g._wpI = g.wi; g._wpBest = d; g._wpStall = 0; }
    else g._wpStall = (g._wpStall || 0) + dt;
    if (d < 0.5 || (d < 2 && g._wpStall > 1.5) || g._wpStall > 8) {
      g.wi = (g.wi + 1) % wps.length;
      g._returning = false;
    }
    updateFlashlight(g, dt);
    return true;
  }

  /* Is the patrol point he is walking to a CORNER (walked through at pace) or
     the end of a beat (he brakes, turns round on the spot, walks back)? The
     turn the round makes there decides it: under ~100 degrees is a corner. */
  function patrolCorner(g, wps) {
    if (wps.length < 2) return false;
    const a = wps[g.wi], b = wps[(g.wi + 1) % wps.length], p = g.group.position;
    const ix = a.x - p.x, iz = a.z - p.z, ox = b.x - a.x, oz = b.z - a.z;
    const il = Math.hypot(ix, iz), ol = Math.hypot(ox, oz);
    if (il < 1e-3 || ol < 1e-3) return false;
    return (ix * ox + iz * oz) / (il * ol) > -0.17;
  }

  function updateGuard(g, dt) {
    g._lookWant = 0;
    if (think(g, dt)) neckTurn(g, dt);
  }

  /* ---- EARS -------------------------------------------------------------------
     CBZ.guardHear(x, z, radius, {type, player, ambient}) — a sound at a place.
     The nearest one (ambient: a yard brawl) or two (something YOU did) walk to
     check it; anyone else in earshot turns his head. Walls carry a sound 60% as
     far. A hunting man who can't see you but hears you re-aims at the sound. */
  function guardHear(x, z, radius, opts) {
    opts = opts || {};
    const G0 = CBZ.game;
    if (!G0 || G0.mode !== "escape" || G0.state !== "playing" || !(radius > 0)) return 0;
    // every brain in earshot hears it (the yard scatters from a gunshot);
    // WHICH screws walk over is decided below
    if (CBZ.prisonBrain && CBZ.prisonBrain.noise) CBZ.prisonBrain.noise(x, z, radius, opts.type, opts.player ? player : null);
    const G = navOn() ? CBZ.navGrid : null;
    const list = [];
    for (const g of CBZ.guards || []) {
      if (!g || !g.group || g.dead || g.ko > 0 || g.asleep || g._escort || g.tied || g.bribed > 0 ||
          g.intimidMode === "scared" || g.approach || g._yardCase) continue;   // a screw with a man on the ground stays with him
      if (opts.player && g.corrupt && (G0.racketProtectionT || 0) > 0) continue;
      const d = Math.hypot(x - g.group.position.x, z - g.group.position.z);
      if (d > radius) continue;
      if (d > radius * 0.6 && G && G.lineBlocked(g.group.position.x, g.group.position.z, x, z, 0.5)) continue;
      list.push({ g, d });
    }
    list.sort((a, b) => a.d - b.d);
    const send = opts.ambient ? 1 : 2;
    let sent = 0;
    for (const it of list) {
      const g = it.g;
      if (g.hunt > 0) {
        if (opts.player && g._chase && !g.seesPlayer) recentre(g._chase, x, z, 0, 0);
        continue;
      }
      if (opts.ambient && (g._earCD || 0) > 0) continue;
      g.susX = x; g.susZ = z;
      g.susHold = Math.max(g.susHold || 0, 2.0);
      const busy = g.investigate && g.investigate.t > 0;
      if (sent < send && (!busy || opts.player)) {
        if (busy && g.investigate.type === "search") recentre(g.investigate, x, z, 0, 0);
        else g.investigate = { x, z, t: opts.player ? 5 : 4, scan: 0, type: opts.type || "noise", player: !!opts.player, npts: opts.player ? 2 : 1 };
        g._returning = false;
        g._earCD = opts.ambient ? 25 : 6;
        sent++;
      } else if (!busy) g.sus = Math.max(g.sus || 0, SUS_ON + 0.02);   // a head turns
    }
    return sent;
  }
  /* The yard's brawls already make a POSITIONED sound (entities/ai.js plays
     "punch" through CBZ.worldSfx at the fight). That sound is exactly what a
     screw hears, so the ear listens on the same call instead of every fight
     site learning a second API. Installed on first tick: audio.js may load
     after this file. */
  function installEar() {
    const f = CBZ.worldSfx;
    if (!f || f._guardEar) return;
    const w = function (name, x, z) {
      const r = f.apply(this, arguments);
      if (name === "punch" && CBZ.game && CBZ.game.mode === "escape") {
        try { guardHear(x, z, 11, { type: "fight", ambient: true }); } catch (e) {}
      }
      return r;
    };
    w._guardEar = true;
    CBZ.worldSfx = w;
  }

  /* THE MEASUREMENT this rewrite answers to. Per guard, over the window since
     the last reset: seconds spent in a MOVING state, seconds of those making
     under a quarter of his walking pace (grinding / stuck), and frames the
     wall resolver (actorcollide, order 25) had to push him back out. */
  const audit = { t: 0, moving: 0, stalled: 0, pushes: 0, frames: 0, per: new Map() };
  const MOVING = { patrol: 1, hunt: 1, search: 1, investigate: 1, "return": 1, social: 1, law: 1 };
  function auditPre() {
    for (const g of CBZ.guards) { const p = g.group.position; g._auPX = p.x; g._auPZ = p.z; g._auCmd = g._cmd || 0; }
  }
  CBZ.onUpdate(24.9, function () {
    if (!CBZ.game || CBZ.game.mode !== "escape") return;
    for (const g of CBZ.guards) { const p = g.group.position; g._auCX = p.x; g._auCZ = p.z; }
  });
  CBZ.onUpdate(25.1, function (dt) {
    if (!CBZ.game || CBZ.game.mode !== "escape" || CBZ.game.state !== "playing" || !(dt > 0)) return;
    audit.t += dt; audit.frames++;
    for (const g of CBZ.guards) {
      if (g._auPX == null || !MOVING[g.state] || (g._cmd || 0) === g._auCmd) continue;   // standing on purpose (looking round, at a shut door) is not grinding
      const p = g.group.position;
      const dist = Math.hypot(player.pos.x - p.x, player.pos.z - p.z);
      if (g.state === "hunt" && dist < 2) continue;
      audit.moving += dt;
      let rec = audit.per.get(g);
      if (!rec) { rec = { stalled: 0, pushes: 0, moving: 0 }; audit.per.set(g, rec); }
      rec.moving += dt;
      const gained = Math.hypot(p.x - g._auPX, p.z - g._auPZ);
      if (gained < Math.min(g.speed * dt, (g._cmd || 0) - g._auCmd) * 0.25) { audit.stalled += dt; rec.stalled += dt; }
      if (Math.hypot(p.x - g._auCX, p.z - g._auCZ) > 0.002) { audit.pushes++; rec.pushes++; }
    }
  });
  CBZ.guardNavAudit = function (reset) {
    let grinders = 0;
    audit.per.forEach(function (r) { if (r.stalled > 5) grinders++; });
    const out = {
      seconds: +audit.t.toFixed(1), movingGuardSec: +audit.moving.toFixed(1),
      stalledGuardSec: +audit.stalled.toFixed(1),
      stalledPct: audit.moving > 0 ? +(100 * audit.stalled / audit.moving).toFixed(1) : 0,
      wallPushFrames: audit.pushes, grinders5s: grinders, states: CBZ.jailGuardStates(),
    };
    if (reset) { audit.t = 0; audit.moving = 0; audit.stalled = 0; audit.pushes = 0; audit.frames = 0; audit.per.clear(); }
    return out;
  };

  /* ---- SIGHT: ONE implementation, CBZ.brain.perception -------------------
     This file used to own the cone + raycast, and three other files kept
     copies of it (detection.js's witness cone, games/military.js, the county
     jail's wall-less cone). There is one now, in systems/brain.js. What stays
     here is what is PRISON about a screw's eyes: his cone numbers, the
     warden's presence widening it, the prison's dark (CBZ.sightScale), and a
     bent screw going blind to you while your protection is paid up. Dead, KO,
     asleep, bribed, tied, held at gunpoint: the brain's own blind list. */
  const _see = { range: 0, fovHalf: 0, shrink: 1, eyeY: 1.5, targetY: 1.0, light: null };
  function prisonDark(o, x, z) { return CBZ.sightScale ? CBZ.sightScale(o, x, z) : 1; }
  function guardSeesPoint(g, x, y, z, shrink) {
    if (!g || !g.group) return false;
    if (g.corrupt && CBZ.game && (CBZ.game.racketProtectionT || 0) > 0) return false;
    const per = CBZ.brain && CBZ.brain.perception;
    if (!per) return false;
    _see.range = g.viewDist;
    _see.fovHalf = Math.min(1.45, g.half * wardenSharp);
    _see.shrink = shrink || 1;
    _see.light = CBZ.sightScale ? prisonDark : null;
    return per.seesPoint(g, x, y || 0, z, _see);
  }
  function guardSees(g) {
    // crouching shrinks the range; a hot block looks a little harder
    return guardSeesPoint(g, player.pos.x, player.pos.y, player.pos.z, (player.crouch ? 0.55 : 1) * ctx.viewMul);
  }
  // "Is anyone in uniform watching this spot?" — the question an inmate asks
  // before starting something.
  function guardWatching(x, y, z) {
    for (const g of CBZ.guards || []) if (guardSeesPoint(g, x, y || 0, z, 0)) return g;
    return null;
  }


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
  CBZ.guardHear = guardHear;
  // the guard's own body, for systems/brain_prison.js's executor (act.use)
  CBZ.guardWalkTo = walkTo;
  CBZ.guardFaceTo = function (g, x, z, k, dt) { faceTo(g, x, z, k, dt); };
  CBZ.guardIdle = function (g, dt) { animChar(g.char, 0, dt); };
  CBZ.guardStand = stand;
  CBZ.guardLookAt = lookAtPoint;
  CBZ.spawnGuard = makeGuard;   // systems/reinforcements.js spawns extra patrols

  // drive all guards every playing frame
  CBZ.onUpdate(20, function (dt) {
    if (CBZ.game.mode !== "escape") return;   // jail-only — prison guards never run in city/disaster
    if (barkCD > 0) barkCD -= dt;
    installEar();
    // a new run (state.js puts every guard back on g.start): forget the last one
    if (!pollGuardRun && CBZ.jailBoost) pollGuardRun = CBZ.jailBoost.newRunWatcher(0.5);
    if (pollGuardRun && pollGuardRun()) {
      for (const g of CBZ.guards) {
        g.sus = 0; g.susHold = 0; g.susX = g.susZ = null; g._chase = null; g.warnT = null;
        g._returning = false; g.lkAt = null; g.lkX = g.lkZ = null; g._navWait = 0; g._nav = null;
      }
      prevPX = null;
    }
    frameContext(dt);
    // THE GUARDS' OWN PLAN BUDGET. systems/prisonnav.js hands the shared
    // budget out at order 21.75 and the inmates (order 22) spend it before the
    // next frame's guards (order 20) ever get a look in. Opening the frame here
    // gives the roster its own two plans; prisonnav re-opens it for the cast.
    if (navOn()) CBZ.navGrid.frame(2, 1.5);
    auditPre();
    for (const g of CBZ.guards) {
      if (CBZ.verbs && CBZ.verbs.held && CBZ.verbs.held(g)) continue;   // a body a verb holds is the verb's
      if (CBZ.climb && CBZ.climb.owns(g)) continue;                     // a body on a ladder is the ladder's (systems/climb.js)
      if (CBZ.towerWatch && CBZ.towerWatch.owns(g, dt)) continue;      // an officer on his tower post (entities/towerwatch.js)
      updateGuard(g, dt);
    }
  });
  CBZ.onUpdate(20.5, function (dt) { if (CBZ.game.mode !== "escape") return; updateRacketPressure(dt); });
  });
})();

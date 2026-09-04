/* DESERT WARLORD — THE BATTLE YOU COMMAND, WITH AND WITHOUT MORALE.

   THE CLAIM UNDER TEST, in one sentence: an army that can BREAK is a different
   game from an army that cannot, and the difference is visible in a still.

   src/warlord/battle.js is games/battle.html's war simulator with a warlord
   standing in it and one mechanic added — morale. battle.html's armies fight to
   the last man, which is right for a page you WATCH and wrong for a campaign,
   because it makes head count the only variable: forty levies with pistols beat
   fifteen veterans with rifles whenever the arithmetic works out, and then "who
   gets the good rifle" is a menu with no consequence. Morale inverts that
   without a single typed balance number — how much an army has lost is a POWER
   fraction (core's own W.power, already weighted by tier, gun, armour and
   wounds) and when a man breaks is combat_iq's own ROLE[].nerve column (civ
   0.62, thug 0.42, guard 0.30, soldier 0.20). Two existing tables, no new ones.

   SO THIS IS A FLAG A/B AND NOTHING ELSE. Both sides are THIS checkout, served
   by the same local server, on the same seed, with the same rosters on the same
   sand. The before side boots `?morale=old` — battle.js's own one-line revert,
   which removes the break point, the rout, the rally and the morale end
   condition all at once and leaves battle.html's behaviour exactly. Every pixel
   and every number of difference is that flag.

   IT IS A STUDIO, NOT A GALLERY. The page boots ?frozen=1 — battle.js begins
   with its clock STOPPED, which matters more than it sounds: a tool cannot
   freeze a battle before the battle exists, so on the first run of this preset
   an unknown number of real frames had already elapsed by the time the stage
   function got its hands on the page, and one side had taken a casualty at the
   beat the other was still at full strength. Frozen from birth, both builds
   start at simulated second zero and every second after that is one somebody
   asked for. advance() is the only time that passes, through the same
   injected-dt seam a person's frame-step key would use.

   Subjects run in declaration order inside one page per side, so they are a
   STORYBOARD of one battle rather than five battles — and the order they are
   in is a commander's order, not a list: hold and trade, turn the wing, then
   charge the thing you have already broken.

   WHAT EACH PICTURE HAS TO SHOW, because a metric can only check what somebody
   already thought to declare:
     lines-closing  two ranked lines walking at each other across real dunes
     flank-wing     a wing genuinely swung wide, not a second frontal line
     charge-lands   the CHARGE order arriving — first person, from inside the
                    line, the warlord's own rifle in frame
     the-rout       men running for the map edge. THIS is the subject the flag
                    exists for: with morale off there is nothing to photograph
                    here but two lines still grinding.
     aftermath      the payoff screen with REAL NAMES on the dead
*/

const subjects = [
  { id: "lines-closing", label: "The two lines close",
    focus: "THE OPENING. Two ranked columns of real soldier objects — every man carrying the wid and armour his roster row says — walking at each other across the piece of the island the encounter happened on. Identical on both sides by construction: morale has nothing to do until somebody dies, and the page boots ?frozen=1 so both builds genuinely start at simulated second zero. If these two frames are not the same picture, the A/B is not controlled and nothing after it means anything.",
    at: 12, cam: { mode: "cmd", pitch: 0.26, yaw: 1.55 } },

  { id: "hull-down", label: "Hull down, and not a rock in sight",
    focus: "THE GROUND IS THE COVER. There is nothing on this field — biome dune, zero cover props, and that is the change: desert.js used to scatter eight boulders here and battle.js thirty-four more, because combat_iq's cover search can only see BOXES and a battlefield with no boxes made every man stand upright in the open. battle.js's hullDown() searches the terrain instead, for the position where a CROUCHED man (eye 1.0 m) is hidden from the threat by the ground and a STANDING one (1.6 m) is not — the reverse slope. What to look for: men low behind a crest with the far slope empty above them, and men beside them up on the lip firing, because a fold is worked and not occupied. This beat is at t=26 and BEFORE the flank and the charge on purpose. Two reasons, both measured: a charging man clears his fold and stands up (which is the whole cost of a charge, so photographing hull-down men after the CHARGE order photographs zero of them), and at t=16 — where this beat sat on its first run — most of the line is still a FORMED SECTION marching to contact, and a section is driven by stepSquad rather than by think(), so nobody has asked for a fold yet. The fight has to have started. The old note read: a charging man clears his fold and stands up, which is the whole cost of a charge, so photographing hull-down men after the CHARGE order photographs zero of them. The counter to read is coverProps, which must be 0, and menHullDown, which must not be. This row is IDENTICAL on both columns by construction — morale has nothing to do with terrain — and a difference here means the flag is touching something it should not.",
    at: 26, order: "hold", enemyHold: true, cam: { mode: "hull" } },

  { id: "through-the-glass", label: "Ten power, and the mil ticks are real",
    focus: "THE SIGHT ON THE GUN. Every weapon in this game used to aim by narrowing the lens 25 degrees, and exactly one — the bolt sniper, named in an `if` — got an optic, at a hard-coded 16-degree FOV whose comment called it '4.7x' (that is 75/16, a ratio of angles; the honest magnification of a 16-degree lens seen from a 75-degree one is 5.46). The M24 in his hands now wears the sight the real M24 wears, a Leupold Ultra M3A 10x42: the field of view is the tangent law on ten power (8.8 degrees), the look sensitivity is 1/10, the sway is the shooter's own body at 4 milliradians standing, and the tick spacing is SOLVED from this optic's field of view so a mark is a real milliradian and holdover works. Look for the tube, the eye-relief crescent swimming against the sway, and the legend under the reticle naming the optic and what a tick is worth.",
    at: 29, order: "hold", enemyHold: true, cam: { mode: "scope" } },

  { id: "flank-wing", label: "FLANK — the wing swings wide",
    focus: "THE FIRST REAL DECISION. FLANK sends men who are out of contact to an anchor 90 degrees off the fight axis, on the side of the enemy mass with fewer of them in it, and hands them straight back to combat_iq the moment they arrive — so the gunfight on the wing is still the engine's, and only the WALK is the order's. The wing has to read as a wing: a limb reaching around the enemy mass, not a second frontal rank.",
    at: 34, order: "flank", cam: { mode: "cmd", pitch: 0.34, yaw: 1.55 } },

  { id: "charge-lands", label: "CHARGE, from inside the line",
    focus: "THE ORDER THAT FINISHES IT, photographed from where the brief says you should be: in it. CHARGE does not call combat_iq's posture() at all — posture exists to hold a weapon's preferred distance, which is precisely what a charge refuses to do — so the goal becomes the enemy himself and the slot becomes 'push'. Look for the line breaking into a run and the warlord's own rifle, the same actorweapons model every NPC carries, in the corner of the frame. The counters move together: charging costs YOU men too.",
    at: 42, order: "charge", cam: { mode: "fps" } },

  { id: "the-rout", label: "The line breaks",
    focus: "THE WHOLE POINT OF THE FLAG. AFTER: a third of an army is gone — power-weighted, so its veterans count for more than its levies — morale falls under the men's own nerve rows and the levies break first, running for their own map edge while the veterans hold. BEFORE (?morale=old): nobody CAN break, so the same simulated second is two intact lines still grinding. If both frames look the same, the mechanic is not doing anything.",
    at: 50, cam: { mode: "cmd", pitch: 0.40, yaw: 1.55 } },

  { id: "aftermath", label: "The dead, by name",
    focus: "THE PAYOFF SCREEN, which is the reason core.js gives every man a name. Your dead listed individually, the wounded who fight at 60% until they rest, promotions, the guns stripped off every body on the field with what they are worth, and the enemy survivors as PRISONERS to conscript, ransom, release or execute. The before side reaches this screen too — later, bloodier, and with fewer prisoners, because an army that cannot break has to be killed to the last man instead of captured standing on the field.",
    finish: true },
];

async function stageWarlordBattle(input) {
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.warlord) return { ok: false, err: "no CBZ.warlord" };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 200);
    }
    return false;
  };

  let S = window.__warlordStudio;
  if (!S) {
    const B0 = await until(() => window.__warlordBattle && window.__warlordBattle.live &&
      window.__warlordBattle.live(), 300000);
    if (!B0) return { ok: false, err: "battle never started" };
    const B = window.__warlordBattle;
    /* FREEZE THE WALL CLOCK. Everything after this point is advance() and
       nothing else, so the two builds walk the identical simulated seconds
       whatever the rasteriser under them is doing. */
    B.freeze();
    S = window.__warlordStudio = { B: B, t: 0, last: null, done: false };
    window.__cbzVisualCompare = {
      render() { try { S.B.render(); } catch (_) {} },
      advance(sec) { try { S.B.advance(sec); S.t += sec; } catch (_) {} },
      metrics() { return S.last || {}; },
    };
  }
  const B = S.B;
  const subject = input.subject;

  const snap = () => {
    let a = null;
    try { a = B.audit(); } catch (_) {}
    if (!a || !a.live) return S.last || {};
    let hullMen = 0, hullDown = 0;
    try {
      const men = B.men();
      for (let i = 0; i < men.length; i++) {
        if (men[i].dead || men[i].fled || men[i].you) continue;
        if (men[i].hull) hullMen++;
        if (men[i].stance === "crouch") hullDown++;
      }
    } catch (_) {}
    S.last = {
      battleT: a.simT,
      coverProps: a.field.cover,
      foldedGround: a.field.folded ? 1 : 0,
      foldProbesHit: a.field.hull ? a.field.hull.found : 0,
      coreRelief: a.field.coreRelief,
      menHullDown: hullMen,
      menCrouched: hullDown,
      menAlive: a.mine.alive,
      enemyAlive: a.them.alive,
      yourDead: a.mine.dead,
      enemyDead: a.them.dead,
      moraleMine: a.mine.morale,
      moraleThem: a.them.morale,
      routing: a.mine.routing + a.them.routing,
      fled: a.mine.fled + a.them.fled,
      fps: a.fps,
      corpsesSolved: a.solving,
      relief: a.field.relief,
    };
    return S.last;
  };

  /* ---- THE FINISH: run the fight out and photograph the payoff screen ---- */
  if (subject.finish) {
    // step in chunks until the battle resolves. The BEFORE side has no morale
    // ending, so it takes materially longer — that difference IS a metric.
    for (let i = 0; i < 60 && !S.done; i++) {
      B.advance(6);
      S.t += 6;
      let a = null;
      try { a = B.audit(); } catch (_) {}
      if (!a || !a.live) { S.done = true; break; }
      snap();
      if (a.over) { S.done = true; break; }
    }
    // endBattle hands the screen over on a real timer; rAF is frozen but
    // setTimeout is not, so the aftermath arrives on its own.
    await until(() => CBZ.warlord.phase() === "aftermath", 20000, 200);
    await wait(500);
    const st = document.getElementById("stage");
    if (st) st.scrollTop = 0;
    const S2 = CBZ.warlord.state;
    const m = Object.assign({}, S.last, {
      battleEndT: Math.round(S.t),
      prisoners: S2.prisoners.length,
      armyAfter: S2.army.length,
      lootGuns: Object.keys(S2.baggage).reduce((n, k) => n + S2.baggage[k], 0),
    });
    S.last = m;
    return { ok: true, metrics: m, phase: CBZ.warlord.phase() };
  }

  /* ---- A BATTLE BEAT ---- */
  if (subject.order) B.order(subject.order);
  /* PIN THE OTHER COMMANDER, OR THE SUBJECT IS NOT THE SUBJECT. A beat about
     men holding a reverse slope needs both lines HOLDING: enemyCommand() reads
     a 52-v-24 advantage as an invitation and orders CHARGE, and a charging man
     clears his fold by design — MEASURED, zero men in a fold on ground with
     46 m of core relief, because the enemy half of the field was running and
     my half was being overrun. Cleared again on the next beat, so the flank,
     the charge and the rout are the enemy commander's own decisions. */
  if (subject.enemyHold) B.order("hold", "them", { lock: true });
  else B.order(B.audit().enemyOrder || "hold", "them", { lock: false });
  const want = Math.max(0, (subject.at || 0) - S.t);
  if (want > 0) { B.advance(want); S.t += want; }

  const cam = subject.cam || { mode: "cmd" };

  /* ---- THE FOLD, PHOTOGRAPHED FROM THE SIDE. A hull-down man is only legible
     from across the crest line: from behind him he is a man crouching, from in
     front of him he is not there at all. So the lens goes to a man who has
     found a fold and looks ALONG the line rather than down it, low, close. */
  if (cam.mode === "hull") {
    const men = B.men();
    let pick = null;
    for (let i = 0; i < men.length; i++) {
      const m = men[i];
      if (m.dead || m.fled || m.you || !m.hull) continue;
      if (!pick || (m.stance === "crouch" && pick.stance !== "crouch")) pick = m;
      if (pick && pick.stance === "crouch") break;
    }
    B.camera("cmd");
    if (pick) B.look({ x: pick.x, z: pick.z, dist: 22, pitch: 0.12, yaw: 1.55 });
    else B.look({ dist: 40, pitch: 0.14, yaw: 1.55 });
    B.render();
    return { ok: true, metrics: snap(), simT: S.t, pick: pick ? pick.i : null };
  }

  /* ---- DOWN THE TUBE. The warlord takes the bolt gun out of his own cart
     (rearm is the same call stepPickup makes when he lifts one off the sand),
     aims at the nearest live enemy and holds the trigger hand steady; lockon.js
     engages the optic off the ADS state, exactly as a right mouse button does. */
  if (cam.mode === "scope") {
    const GP = window.__warlordGunplay;
    const W = CBZ.warlord;
    W.state.baggage = W.state.baggage || {};
    if (!W.state.baggage.sniper) W.state.baggage.sniper = 1;
    GP.heal();
    GP.rearm("sniper");
    B.camera("fps");
    B.advance(0.5); S.t += 0.5;
    /* THE FARTHEST MAN, NOT THE NEAREST. GP.nearestEnemy() is the right verb
       for a preset about a crosshair; it is the wrong one for a preset about
       TEN POWER, because the nearest man in a line that has closed is ten
       metres away and fills the eyepiece whatever the magnification is. The
       subject is the reach. */
    let mark = GP.nearestEnemy();
    try {
      const you = B.you(), men = B.men();
      let far = null, fd = -1;
      for (let i = 0; i < men.length; i++) {
        const m = men[i];
        if (m.you || m.dead || m.fled || m.team === "mine") continue;
        const d = Math.hypot(m.x - you.pos.x, m.z - you.pos.z);
        if (d > fd) { fd = d; far = m; }
      }
      if (far) mark = { x: far.x, y: B.groundAt(far.x, far.z) + 1.3, z: far.z, d: fd };
    } catch (_) {}
    GP.aim(true);
    // the FOV ease is the optic's own ADS time (0.55 s for a 10x); give it
    // enough simulated frames to arrive, then re-lay the aim through the sway
    B.advance(1.6); S.t += 1.6;
    if (mark) GP.look({ at: mark });
    B.advance(0.2); S.t += 0.2;
    if (mark) GP.look({ at: mark });
    B.render();
    const m2 = snap();
    let g = {};
    try { g = GP.audit() || {}; } catch (_) {}
    m2.scopeFov = g.fov;
    m2.opticMag = g.optic === "m3a" ? 10 : 1;
    m2.swayMrad = g.sway ? Math.round(g.sway * 100000) / 100 : 0;
    m2.markRange = mark && mark.d ? Math.round(mark.d) : 0;
    S.last = m2;
    return { ok: true, metrics: m2, simT: S.t, optic: g.optic, scoped: g.scoped };
  }

  B.camera(cam.mode);
  if (cam.mode === "cmd") {
    // no dist => battle.js sizes the range off the two masses' own separation
    B.look({ dist: cam.dist, pitch: cam.pitch, yaw: cam.yaw });
  }
  // one framing pass, then draw — the caller must not have to advance the
  // world by a frame just to find out where the camera went
  B.render();
  return { ok: true, metrics: snap(), simT: S.t };
}

export default {
  id: "warlord-battle",
  title: "Desert Warlord: The Battle You Command, and the Army That Breaks",
  description:
    "Both sides are this checkout on the same seed with the same men on the same sand; the before side boots ?morale=old, battle.js's own one-line revert of the morale/rout layer, which leaves games/battle.html's fight-to-the-last-man behaviour exactly. The rAF clock is frozen and battle.js's advance() is the only time that passes, so both builds photograph the identical simulated seconds.",
  // the game is a standalone page under games/, not the build's index.html
  page: "games/warlord.html",
  defaultBefore: "local",
  beforeParams: { morale: "old" },
  beforeLabel: "BEFORE · MORALE OFF (fight to the last man)",
  afterLabel: "AFTER · MORALE AND ROUT",
  viewport: { width: 1180, height: 700 },
  /* BOTH ROSTERS COME OUT OF makeBand, so the two armies are built by the same
     constructor and carry armour the same way — the first run of this preset
     hand-rolled the player's side with no armour at all and photographed a
     handicap match. The player's side is a FREE COMPANY against a MILITIA,
     which is a campaign encounter a warlord would actually take: better men,
     not more of them, which is the game's own thesis about who gets the good
     rifle. */
  /* bx/bz PIN THE GROUND. buildGround centres the battlefield on the
     warlord's campaign position, so without these the storyboard fights
     wherever the island happened to put him — and the hull-down subject needs
     FOLDED ground. (-4000, 2800) is a dune field with zero cover props, 46 m
     of relief in its CORE and 67/120 of the reference fan hull-down. The core
     number is the one that matters and it is why this is not (1600, 2400),
     which scores higher on the fan and has only 15 m of core relief: MEASURED,
     a battle there put ZERO men in a fold, because the fan is sampled at the
     field centre with a threat 120 m off and a real fight moves.

     HARNESS TRAP: `seed: 1337` below IS NOT APPLIED. games/warlord.html only
     starts a new game from ?seed when ?go=1 is also present; with ?battle=1
     alone the page comes up on the DEFAULT save, and CBZ.warlord.state.seed
     reads 1. Every warlord preset in this directory carries the same inert
     seed param and has since they were written, so the pairNote's "same seed"
     is true (both columns boot the same default) but the number is decoration.
     The coordinates above are measured on the world this preset ACTUALLY
     boots, seed 1 — which is why they are not the ones
     tools/warlord-cover-check.mjs picks, and it took a whole storyboard run to
     find that out. Fix the seam or leave the trap named; do not re-guess. */
  urlParams: { battle: 1, frozen: 1, mine: 24, them: 52, seed: 1337, gun: "ak47",
    bx: -4000, bz: 2800, faction: "militia", myfaction: "legion" },
  readyExpression: "!!(window.CBZ && window.CBZ.warlord)",
  // the first subject pays the whole studio boot under a software rasteriser
  stageTimeoutMs: 600000,
  pairNote: "Same checkout · seed · rosters · ground · cameras · simulated seconds — ?morale=old is the only variable",
  method:
    "games/warlord.html boots with ?battle=1, which is battle.js's own debug entry (campaign.js is written by another agent and a battle reachable only through a file that may not exist is a battle nobody can test). battle.js's freeze() stops requestAnimationFrame and advance(sec) runs exactly that many seconds of the page's own frame through microboot's headless stepSim, so every clock in the fight — the sim, combat_iq's CBZ.now, the corpse solver, the cameras — is driven from one place and cannot drift between the two builds. Orders are given through the same W.battle.order() the four HUD buttons call. Cameras are battle.js's own command/first-person seats, not a preset's private camera math.",
  metricsNote:
    "moraleMine/moraleThem are the live morale numbers: 1 - (power lost) * 1.6 + (their power lost) * 0.55, with a bonus for the warlord standing near his own line — power, not head count, so losing a veteran costs more than losing a levy. routing counts men currently running for the map edge and fled counts men who reached it; with ?morale=old both are structurally zero, which is what makes them the honest measure of what the flag adds. battleEndT is how long the whole fight took: an army that cannot break has to be killed to the last man, and prisoners is what that costs you.",
  metrics: {
    battleT: { label: "Simulated time at this beat", unit: "s" },
    coverProps: { label: "Cover props on the field", unit: "objects", better: "lower" },
    foldedGround: { label: "Ground folded enough to hide behind", unit: "0/1", better: "higher" },
    foldProbesHit: { label: "Terrain probes that found a fold", unit: "probes", better: "higher" },
    coreRelief: { label: "Relief of the ground they fight on", unit: "m" },
    menHullDown: { label: "Men holding a reverse-slope position", unit: "men", better: "higher" },
    menCrouched: { label: "Men down behind the lip this frame", unit: "men", better: "higher" },
    scopeFov: { label: "Field of view through the optic", unit: "deg", better: "lower" },
    opticMag: { label: "Magnification of the sight on the gun", unit: "x", better: "higher" },
    swayMrad: { label: "The shooter's own hold wobble", unit: "mrad", better: "lower" },
    markRange: { label: "Range to the man in the reticle", unit: "m" },
    menAlive: { label: "Your men standing", unit: "men", better: "higher" },
    enemyAlive: { label: "Enemy standing", unit: "men" },
    yourDead: { label: "Your dead", unit: "men", better: "lower" },
    enemyDead: { label: "Enemy dead", unit: "men" },
    moraleMine: { label: "Your morale", unit: "0-1" },
    moraleThem: { label: "Enemy morale", unit: "0-1" },
    routing: { label: "Men running", unit: "men", better: "higher" },
    fled: { label: "Men off the field", unit: "men" },
    corpsesSolved: { label: "Corpses on the ragdoll solver", unit: "bodies" },
    relief: { label: "Ground relief across the field", unit: "m" },
    fps: { label: "Frame rate", unit: "fps", better: "higher" },
    battleEndT: { label: "Length of the whole battle", unit: "s", better: "lower" },
    prisoners: { label: "Prisoners taken", unit: "men", better: "higher" },
    armyAfter: { label: "Your army after", unit: "men", better: "higher" },
    lootGuns: { label: "Guns in the cart after", unit: "guns" },
  },
  subjects,
  stage: stageWarlordBattle,
};

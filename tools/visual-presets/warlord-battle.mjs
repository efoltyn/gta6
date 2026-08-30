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

  { id: "flank-wing", label: "FLANK — the wing swings wide",
    focus: "THE FIRST REAL DECISION. FLANK sends men who are out of contact to an anchor 90 degrees off the fight axis, on the side of the enemy mass with fewer of them in it, and hands them straight back to combat_iq the moment they arrive — so the gunfight on the wing is still the engine's, and only the WALK is the order's. The wing has to read as a wing: a limb reaching around the enemy mass, not a second frontal rank.",
    at: 28, order: "flank", cam: { mode: "cmd", pitch: 0.34, yaw: 1.55 } },

  { id: "charge-lands", label: "CHARGE, from inside the line",
    focus: "THE ORDER THAT FINISHES IT, photographed from where the brief says you should be: in it. CHARGE does not call combat_iq's posture() at all — posture exists to hold a weapon's preferred distance, which is precisely what a charge refuses to do — so the goal becomes the enemy himself and the slot becomes 'push'. Look for the line breaking into a run and the warlord's own rifle, the same actorweapons model every NPC carries, in the corner of the frame. The counters move together: charging costs YOU men too.",
    at: 42, order: "charge", cam: { mode: "fps" } },

  { id: "the-rout", label: "The line breaks",
    focus: "THE WHOLE POINT OF THE FLAG. AFTER: a third of an army is gone — power-weighted, so its veterans count for more than its levies — morale falls under the men's own nerve rows and the levies break first, running for their own map edge while the veterans hold. BEFORE (?morale=old): nobody CAN break, so the same simulated second is two intact lines still grinding. If both frames look the same, the mechanic is not doing anything.",
    at: 58, cam: { mode: "cmd", pitch: 0.40, yaw: 1.55 } },

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
    S.last = {
      battleT: a.simT,
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
  const want = Math.max(0, (subject.at || 0) - S.t);
  if (want > 0) { B.advance(want); S.t += want; }

  const cam = subject.cam || { mode: "cmd" };
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
  urlParams: { battle: 1, frozen: 1, mine: 34, them: 34, seed: 1337, gun: "ak47",
    faction: "militia", myfaction: "company" },
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

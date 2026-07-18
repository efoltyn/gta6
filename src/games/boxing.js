/* ============================================================
   games/boxing.js — SOUTHPAW PALACE, as a GAME PACKAGE.

   Fight night ON the engine, at the game's EXISTING fight venue
   (city/arena_fights.js — the Ironjaw Arena island). Two roles, ONE
   sim — the platform proof the roadmap asks for:
     role FIGHTER — you sign the card (undercard -> co-main -> TITLE),
       fight 3-round bouts through the panel (jab/cross/hook/body +
       block/slip) against opponents with real PATTERNS; openings are
       telegraphed, stamina drains/regens, COUNTERS do double, KO comes
       off knockdowns. A cutman works you between rounds (real cash),
       judges' 10-point-must scorecards show between rounds, the belt
       persists in ctx.state.
     role BETTOR — watch an AI-vs-AI undercard (the SAME sim driving two
       real ctx.npc fighters trading animated blows in the ring) and bet
       at odds from the fighters' ratings/records.

   WHAT IS REUSED (engine), not forked:
     - VENUE: site-resolves to the Ironjaw Arena anchor (arena_fights is
       a landmass, not a lot — there is no arena lotKind), builds on the
       open north plaza so arena_fights' ring/cage/pit keep running.
     - PEDS: every fighter/ref/judge/bookie/cutman is a REAL city ped via
       ctx.npc (brain, wardrobe, gunpoint hands-up, cityKillPed death).
     - POSES/ANIMS: punches are the ENGINE's shared fight layer in
       character.js animChar — we only SET the flags it already reads
       (ch.fightStance / punchT+punchKind+punchArm / blockT / dodgeT /
       staggerT / koPose). Pinned peds get animChar(ch,0,dt) every frame
       (peds.js move()), so setting flags renders wind-up/extension/
       recoil/guard/slip/crumple with zero new animation code. The pose
       registry (poses.js) still OUTRANKS us where it must: a gun drawn on
       a fighter throws his hands up (animChar precedence) — for free.
     - COMBAT MATH: the pure state machine salvaged from games/boxing.html
       (RULES/PUNCH, stamina, openings/counters, 10-point-must scoring,
       knockdown/get-up). No THREE, no DOM — the player bout, the AI
       undercard and the headless simBout(n) all run THIS one sim.
   WHAT IS ADDED (domain only): the ring/stools/judges' table/belt case/
     betting window dressing, the two-role arc, the panels, and the thin
     glue mapping sim events onto the peds' rigs.

   Determinism: BUILD paths use ctx.rand/ctx.stream only (multiplayer
   law). Fight RNG is runtime (Math.random via a reseedable stream); the
   headless simBout(n) reseeds to a FIXED seed so the gate is stable.
   Revert: CBZ.CONFIG.PKG_BOXING = false (nothing mounts; arena_fights,
   which never referenced us, is untouched).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.games) return;
  const THREE = window.THREE;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PKG_BOXING == null) CBZ.CONFIG.PKG_BOXING = true;

  /* ==========================================================
     1. RANDOM — one gameplay funnel. RIGQ lets a probe force exact
        rolls (rig openings/counters); gameRng is a reseedable
        mulberry32 so simBout(n) is deterministic for the gate but
        live play can be reseeded off the clock for variety.
     ========================================================== */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  let gameRng = mulberry32(0xB0B0CE);
  const RIGQ = [];
  function nextRand() { return RIGQ.length ? RIGQ.shift() : gameRng(); }
  function seedRng(s) { gameRng = mulberry32(s | 0); RIGQ.length = 0; }

  /* ==========================================================
     2. RULES + PURE MATH  (salvaged from games/boxing.html)
     ========================================================== */
  const RULES = { ROUNDS: 3, ROUND_SEC: 60, KD_LIMIT: 3, COUNTER_MULT: 2, ST_FLOOR: 0.25,
    ST_FLOOR_DMG: 0.5, ST_FLOOR_WU: 1.5, EVEN_EPS: 2.5, CARD_MIN: 7, VIG: 94 };
  // wu=windup s · act=active s · rc=recover s · dmg · st=stamina cost · reach · stDmg=extra stamina to victim
  const PUNCH = {
    jab:   { wu: 0.20, act: 0.09, rc: 0.24, dmg: 3.2, st: 4.5, reach: 2.05, stDmg: 0 },
    cross: { wu: 0.32, act: 0.10, rc: 0.34, dmg: 6.0, st: 8,   reach: 2.0,  stDmg: 2 },
    hook:  { wu: 0.46, act: 0.10, rc: 0.42, dmg: 9.0, st: 11,  reach: 1.75, stDmg: 3 },
    body:  { wu: 0.36, act: 0.10, rc: 0.36, dmg: 4.5, st: 9,   reach: 1.85, stDmg: 9 } };
  const SLIP_DUR = 0.42, SLIP_CD = 0.6, SLIP_ST = 4, COUNTER_WIN = 1.15, HITSTUN = 0.3;
  const BLOCK_MULT = 0.15, BLOCK_BODY_MULT = 0.45, REGEN_GUARD = 11, REGEN_IDLE = 6;

  function punchDamage(type, opts) {
    opts = opts || {}; const p = PUNCH[type]; let d = p.dmg;
    if (opts.counter) d *= RULES.COUNTER_MULT;                     // COUNTERS DO DOUBLE
    if (opts.stPct != null && opts.stPct < RULES.ST_FLOOR) d *= RULES.ST_FLOOR_DMG;
    if (opts.pow) d *= opts.pow; return d;
  }
  function windupMult(stPct) { return stPct < RULES.ST_FLOOR ? RULES.ST_FLOOR_WU : 1; }
  // 10-point-must: winner 10 / loser 9 (dead-even 10-10), minus 1 per knockdown suffered.
  function tenPointMust(a, b) {
    let ra = 10, rb = 10;
    if (Math.abs(a.score - b.score) >= RULES.EVEN_EPS) { if (a.score > b.score) rb = 9; else ra = 9; }
    ra -= (a.kd || 0); rb -= (b.kd || 0);
    return [Math.max(RULES.CARD_MIN, ra), Math.max(RULES.CARD_MIN, rb)];
  }
  function oddsFromProb(p) { p = Math.min(0.92, Math.max(0.08, p)); return Math.round(RULES.VIG / p) / 100; }
  function payout(stake, odds) { return Math.round(stake * odds); }

  /* ==========================================================
     3. FIGHTERS — personalities. pattern = the sequence they fall
        in love with (drives AI + the corner tell); iq = how often
        they answer your leather; rating = the drawing-power number
        odds & matchmaking read.  (salvaged + rated out)
     ========================================================== */
  const DEFS = {
    you:   { name: "THE SOUTHPAW", short: "You", hp: 100, pow: 1.0, spd: 1.0, chin: 1.0, heart: 0.85, southpaw: true },
    sonny: { name: "Sonny Malone", short: "Malone", hp: 92, pow: 0.72, spd: 1.08, chin: 0.95, heart: 0.45,
             iq: 0.30, aggression: 0.62, pattern: ["jab", "jab", "cross"], rating: 52,
             blurb: "jab-happy club fighter out of the Ironjaw stable" },
    kane:  { name: 'Dee "Cobra" Kane', short: "Kane", hp: 104, pow: 0.95, spd: 1.0, chin: 1.0, heart: 0.6,
             iq: 0.55, aggression: 0.5, pattern: ["jab", "hook", "hook"], counterpuncher: true, rating: 66,
             blurb: "counter-puncher; blocks, then whips hooks" },
    vega:  { name: 'Rico "Hammer" Vega', short: "Vega", hp: 118, pow: 1.3, spd: 0.88, chin: 1.2, heart: 0.8,
             iq: 0.62, aggression: 0.7, pattern: ["body", "hook", "cross"], bodyHunter: true, rating: 90,
             blurb: "the champ; breaks bodies, then drops the hammer" },
    stone: { name: "Marek Stone", short: "Stone", hp: 108, pow: 1.05, spd: 1.02, chin: 1.05, heart: 0.7,
             iq: 0.55, aggression: 0.62, pattern: ["jab", "cross", "hook"], rating: 78 },
    okoro: { name: 'Felix "Bricks" Okoro', short: "Okoro", hp: 88, pow: 0.8, spd: 0.86, chin: 0.85, heart: 0.5,
             iq: 0.28, aggression: 0.5, pattern: ["cross", "cross"], rating: 46 } };
  // the FIGHTER career ladder — steep purse growth; your odds lengthen for the champ.
  const BOUTS = [
    { opp: "sonny", label: "UNDERCARD",   purse: 400,   youWinProb: 0.30 },
    { opp: "kane",  label: "CO-MAIN",     purse: 2200,  youWinProb: 0.44 },
    { opp: "vega",  label: "TITLE FIGHT", purse: 12000, youWinProb: 0.32 }];
  // the BETTOR undercard pool — matchups with a clear enough favourite to make odds interesting.
  const AI_CARDS = [["stone", "okoro"], ["sonny", "kane"], ["kane", "vega"], ["okoro", "sonny"], ["stone", "vega"]];
  function ratingProb(aKey, bKey) {
    const ra = DEFS[aKey].rating || 50, rb = DEFS[bKey].rating || 50;
    return Math.min(0.9, Math.max(0.1, ra / (ra + rb)));
  }

  /* ==========================================================
     4. FIGHT CORE — pure state machine (salvaged). No THREE, no DOM.
        Player bout, AI undercard and headless simBout(n) all run this.
     ========================================================== */
  function mkSide(defKey, dir) {
    const d = DEFS[defKey];
    return { key: defKey, def: d, dir: dir, hp: d.hp, hpMax: d.hp, st: 100,
      x: dir * 1.35, act: "idle", pT: 0, punch: null, resolved: false,
      slipT: 0, slipCd: 0, slipDir: 0, blockT: 0, counterT: 0, stunT: 0,
      downT: 0, downCount: 0, getupOk: false, riseHits: 0, riseNeed: 3, kdBout: 0, kdRound: 0,
      roundPts: 0, headHits: 0, swell: 0, cutmanLeft: 2, aiT: 0.4 + nextRand() * 0.4, patI: 0,
      stats: { thrown: 0, landed: 0, byType: { jab: 0, cross: 0, hook: 0, body: 0 }, counters: 0, kdFor: 0 } };
  }
  function mkBout(aKey, bKey, live) {
    return { a: mkSide(aKey, -1), b: mkSide(bKey, 1), live: !!live,
      round: 1, clock: RULES.ROUND_SEC, phase: "intro", phaseT: 1.4,
      cards: [[], [], []], over: false, winner: null, method: null, endRound: 0,
      events: [], evI: 0, time: 0 };
  }
  function other(bout, s) { return s === bout.a ? bout.b : bout.a; }
  function dist(bout) { return Math.abs(bout.a.x - bout.b.x); }
  function ev(bout, type, data) { bout.events.push({ t: type, d: data || {} }); }

  function startPunch(bout, s, type) {
    const p = PUNCH[type];
    if (s.act !== "idle" && s.act !== "block") return false;
    if (s.st < p.st * 0.6) return false;
    s.act = "punch"; s.punch = type; s.pT = 0; s.resolved = false;
    s.st = Math.max(0, s.st - p.st); s.stats.thrown++; s.stats.byType[type]++;
    ev(bout, "throw", { s: s.dir, type: type }); return true;
  }
  function startSlip(bout, s, dir) {
    if (s.slipCd > 0 || s.act === "punch" || s.st < SLIP_ST) return false;
    s.slipT = SLIP_DUR; s.slipCd = SLIP_CD; s.slipDir = dir; s.st -= SLIP_ST;
    ev(bout, "slipmove", { s: s.dir, dir: dir }); return true;
  }
  function resolvePunch(bout, s) {
    const o = other(bout, s), p = PUNCH[s.punch], d = dist(bout);
    if (d > p.reach) { ev(bout, "whiff", { s: s.dir, type: s.punch }); return; }
    if (o.act === "down" || o.act === "getup") return;
    if (o.slipT > 0) { o.counterT = COUNTER_WIN; ev(bout, "slip", { s: o.dir, type: s.punch }); return; } // timed slip -> counter window
    const counter = s.counterT > 0;
    let dmg = punchDamage(s.punch, { counter: counter, stPct: s.st / 100, pow: s.def.pow });
    dmg /= (o.def.chin || 1);
    if (o.act === "block") {
      const m = (s.punch === "body") ? BLOCK_BODY_MULT : BLOCK_MULT;
      o.hp -= dmg * m; o.st = Math.max(0, o.st - (p.stDmg + 2.5));
      s.roundPts += dmg * m; ev(bout, "blocked", { s: s.dir, type: s.punch });
    } else {
      o.hp -= dmg; o.st = Math.max(0, o.st - p.stDmg);
      o.stunT = HITSTUN;
      if (o.act === "punch" && o.pT < PUNCH[o.punch].wu * windupMult(o.st / 100)) { o.act = "idle"; o.punch = null; } // counters cancel windups
      s.stats.landed++; s.roundPts += dmg;
      if (counter) { s.stats.counters++; s.counterT = 0; }
      if (s.punch !== "body") o.headHits++;
      ev(bout, "land", { s: s.dir, type: s.punch, dmg: dmg, counter: counter });
      if (o.hp <= 0) knockdown(bout, o);
    }
  }
  function knockdown(bout, o) {
    const w = other(bout, o);
    o.kdBout++; o.kdRound++; o.act = "down"; o.downT = 0; o.downCount = 0; o.getupOk = false; o.riseHits = 0;
    o.hp = 0; w.stats.kdFor++;
    ev(bout, "knockdown", { s: o.dir, count: o.kdBout });
    if (o.kdBout >= RULES.KD_LIMIT) finish(bout, w, "TKO");
  }
  function getUp(bout, o) {
    o.act = "getup"; o.pT = 0; o.hp = Math.max(18, o.hpMax * 0.28); o.st = Math.min(100, o.st + 20);
    ev(bout, "getup", { s: o.dir });
  }
  function finish(bout, winSide, method) {
    if (bout.over) return;
    bout.over = true; bout.phase = "over";
    bout.winner = winSide ? (winSide === bout.a ? "A" : "B") : "draw";
    bout.method = method; bout.endRound = bout.round;
    ev(bout, "over", { winner: bout.winner, method: method });
  }
  function judgeRound(bout) {
    const a = bout.a, b = bout.b;
    for (let j = 0; j < 3; j++) {
      const na = 0.9 + 0.2 * nextRand(), nb = 0.9 + 0.2 * nextRand();       // per-judge noise
      const c = tenPointMust({ score: a.roundPts * na, kd: a.kdRound }, { score: b.roundPts * nb, kd: b.kdRound });
      bout.cards[j].push(c);
    }
    ev(bout, "cards", { round: bout.round });
    if (a.headHits >= 7) a.swell = Math.min(3, a.swell + 1);
    if (b.headHits >= 7) b.swell = Math.min(3, b.swell + 1);
    a.roundPts = 0; b.roundPts = 0; a.kdRound = 0; b.kdRound = 0; a.headHits = 0; b.headHits = 0;
  }
  function decide(bout) {
    let ja = 0, jb = 0;
    for (let j = 0; j < 3; j++) {
      let ta = 0, tb = 0;
      for (let r = 0; r < bout.cards[j].length; r++) { ta += bout.cards[j][r][0]; tb += bout.cards[j][r][1]; }
      if (ta > tb) ja++; else if (tb > ta) jb++;
    }
    if (ja > jb) finish(bout, bout.a, ja === 3 ? "UD" : "SD");
    else if (jb > ja) finish(bout, bout.b, jb === 3 ? "UD" : "SD");
    else finish(bout, null, "DRAW");
  }
  function cardTotals(bout) {
    const out = [];
    for (let j = 0; j < 3; j++) {
      let ta = 0, tb = 0;
      for (let r = 0; r < bout.cards[j].length; r++) { ta += bout.cards[j][r][0]; tb += bout.cards[j][r][1]; }
      out.push([ta, tb]);
    }
    return out;
  }
  // AI brain — opponents, the undercard pair, and simBout all use this.
  function aiStep(bout, s, dt) {
    const o = other(bout, s), d = dist(bout);
    s.aiT -= dt; if (s.act !== "idle" && s.act !== "block") return;
    // read the incoming punch DURING ITS WINDUP — block or slip, gated by iq (the "opening")
    if (o.act === "punch" && o.pT < PUNCH[o.punch].wu * windupMult(o.st / 100)) {
      if (s.aiT <= 0.12) {
        const r = nextRand();
        if (r < s.def.iq) {
          if (nextRand() < (s.def.counterpuncher ? 0.65 : 0.35) && s.slipCd <= 0) startSlip(bout, s, nextRand() < 0.5 ? -1 : 1);
          else { s.act = "block"; s.blockT = 0.5; }
          s.aiT = 0.24 + nextRand() * 0.3; return;
        }
      }
    }
    if (s.aiT > 0) return;
    s.aiT = (0.32 + nextRand() * 0.38) / (s.def.spd || 1);
    if (s.st < 18) { s.act = "block"; s.blockT = 0.7; return; }             // gas-tank management
    if (s.counterT > 0 && d <= 1.95) { startPunch(bout, s, s.def.counterpuncher ? "hook" : "cross"); return; }
    if (d > 2.05) { s.x -= s.dir * Math.min(0.5, (d - 1.8)) * 0.8; return; } // walk them down
    if (o.act === "punch" && o.pT > PUNCH[o.punch].wu) return;              // don't trade into active frames
    const agg = s.def.aggression || 0.5;
    if (nextRand() < agg) { const t = s.def.pattern[s.patI % s.def.pattern.length]; s.patI++; startPunch(bout, s, t); }
    else if (nextRand() < 0.4) { s.act = "block"; s.blockT = 0.35 + nextRand() * 0.3; }
  }
  function restRecover(s) { s.hp = Math.min(s.hpMax, s.hp + 6); s.st = Math.min(100, s.st + 35); }
  // resume a live bout's next round from the corner (mirrors the AI "rest" branch)
  function answerBell(bout) {
    if (bout.phase !== "cornerWait") return;
    bout.round++; bout.clock = RULES.ROUND_SEC; bout.phase = "round";
    restRecover(bout.a); restRecover(bout.b); ev(bout, "bell", { round: bout.round });
  }
  function stepFight(bout, dt, inputA) {
    if (bout.over) return;
    bout.time += dt;
    if (bout.phase === "intro") { bout.phaseT -= dt; if (bout.phaseT <= 0) { bout.phase = "round"; ev(bout, "bell", { round: bout.round }); } return; }
    if (bout.phase === "rest") {
      bout.phaseT -= dt;
      if (bout.phaseT <= 0) { bout.round++; bout.clock = RULES.ROUND_SEC; bout.phase = "round"; restRecover(bout.a); restRecover(bout.b); ev(bout, "bell", { round: bout.round }); }
      return;
    }
    if (bout.phase !== "round") return;   // "cornerWait"/"over" wait on the UI (answerBell/close)
    bout.clock -= dt;
    const sides = [bout.a, bout.b];
    for (let i = 0; i < 2; i++) {
      const s = sides[i], o = sides[1 - i];
      s.slipCd = Math.max(0, s.slipCd - dt); s.counterT = Math.max(0, s.counterT - dt);
      s.stunT = Math.max(0, s.stunT - dt);
      if (s.slipT > 0) { s.slipT -= dt; if (s.slipT <= 0) s.slipDir = 0; }
      if (s.act === "down") {
        s.downT += dt;
        const cadence = 0.85, newCount = Math.min(10, 1 + Math.floor(s.downT / cadence));
        if (newCount !== s.downCount) {
          s.downCount = newCount; ev(bout, "count", { s: s.dir, n: newCount });
          if (!bout.live || s !== bout.a) {   // AI heart check from count 4 (the player's own rise is UI-driven)
            if (newCount >= 4 && newCount < 10 && nextRand() < (s.def.heart || 0.5) * (1 - 0.22 * (s.kdBout - 1))) s.getupOk = true;
          }
          if (s.getupOk && newCount >= 4) { getUp(bout, s); continue; }
          if (newCount >= 10) finish(bout, o, "KO");
        }
        continue;
      }
      if (s.act === "getup") { s.pT += dt; if (s.pT > 0.8) { s.act = "idle"; s.pT = 0; } continue; }
      if (s.act === "punch") {
        const p = PUNCH[s.punch], wu = p.wu * windupMult(s.st / 100) / (s.def.spd || 1);
        s.pT += dt;
        if (!s.resolved && s.pT >= wu) { s.resolved = true; resolvePunch(bout, s); }
        if (s.pT >= wu + p.act + p.rc) { s.act = "idle"; s.punch = null; s.pT = 0; }
        continue;
      }
      if (s.act === "block") { s.st = Math.min(100, s.st + REGEN_GUARD * dt); if (!s.holdBlock) { s.blockT -= dt; if (s.blockT <= 0) s.act = "idle"; } }
      else if (s.act === "idle") { s.st = Math.min(100, s.st + REGEN_IDLE * dt); }
      // ring geometry: the ropes bounce you back toward centre
      const lim = 2.9;
      if (Math.abs(s.x) > lim) { s.x = s.dir * lim; if (!s.ropeCd || s.ropeCd <= 0) { ev(bout, "ropes", { s: s.dir }); s.ropeCd = 1.2; } }
      s.ropeCd = Math.max(0, (s.ropeCd || 0) - dt);
      if (!(bout.live && s === bout.a)) aiStep(bout, s, dt);
    }
    if (inputA) inputA(bout, dt);
    if (bout.clock <= 0 && bout.a.act !== "down" && bout.b.act !== "down") {
      judgeRound(bout); ev(bout, "bellEnd", { round: bout.round });
      if (bout.round >= RULES.ROUNDS) decide(bout);
      else { bout.phase = bout.live ? "cornerWait" : "rest"; bout.phaseT = bout.live ? 0 : 2.0; }
    }
  }
  // headless AI-vs-AI sim — the gate's proof the system is real (reseeds -> deterministic)
  function simBout(n, aKey, bKey, seed) {
    const out = []; n = n || 1;
    // isolate: a fixed seed + an emptied rig queue => byte-stable results for the
    // gate, and no side effect on the live stream / any rigged rolls.
    const saveRng = gameRng, saveQ = RIGQ.splice(0, RIGQ.length);
    gameRng = mulberry32(seed != null ? (seed | 0) : 0xB0B0CE);
    for (let i = 0; i < n; i++) {
      const bt = mkBout(aKey || "stone", bKey || "okoro", false);
      let guard = 0;
      while (!bt.over && guard++ < 20000) stepFight(bt, 1 / 30, null);
      out.push({ winner: bt.winner, method: bt.method, rounds: bt.endRound || bt.round,
        cards: bt.cards, totals: cardTotals(bt),
        statsA: { landed: bt.a.stats.landed, thrown: bt.a.stats.thrown, kd: bt.a.kdBout, counters: bt.a.stats.counters },
        statsB: { landed: bt.b.stats.landed, thrown: bt.b.stats.thrown, kd: bt.b.kdBout, counters: bt.b.stats.counters } });
    }
    gameRng = saveRng; for (let i = 0; i < saveQ.length; i++) RIGQ.push(saveQ[i]);
    return out;
  }

  /* ==========================================================
     5. RUNTIME STATE + venue refs
     ========================================================== */
  let C = null;       // package ctx (once mounted)
  let V = null;       // venue 3D refs {origin, fA, fB, ref, judges[], bookie, cutman, cards mesh, ...}
  let S = null;       // persisted bag (belt/record/earnings)
  let LIVE = null;    // { bout, role:"player"|"ai", aKey, bKey, boutIdx, purse, done }
  let pendingAction = null;   // one-shot queued player input (last click wins)
  let panelMode = null;       // "main"|"fighter"|"corner"|"bet"|"result"|null
  let lastPhase = null;
  let near = false;

  function bag() { return S || (S = C.state(() => ({ belt: false, wins: 0, losses: 0, kos: 0, earned: 0 }))); }
  function save() { C && C.saveState(); }
  function fmt(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function feed(m, col) { C && C.hud.feed(m, col); }
  function rank() { const s = bag(); return s.belt ? "CHAMPION" : s.wins >= 2 ? "contender" : s.wins >= 1 ? "prospect" : "nobody"; }
  function nextBoutIdx() { return Math.min(BOUTS.length - 1, bag().wins); }

  /* ==========================================================
     6. PEDS <- SIM  (the glue: sim EVENTS drive the shared anim layer)
     ========================================================== */
  const XS = 1.0;                 // sim-x -> ring-local-x scale (sim clamps |x|<=2.9; ropes at 3.4)
  const DECK_Y = 1.1;             // Ironjaw plaza deck top (world)
  const CANVAS_Y = DECK_Y + 0.92; // fighters' feet on the ring canvas (world)

  function chOf(h) { return h && h.ped && h.ped.char ? h.ped.char : null; }
  function clearFightFlags(ch) {
    if (!ch) return;
    ch.punchT = 0; ch.blockT = 0; ch.dodgeT = 0; ch.staggerT = 0; ch.kickT = 0;
    ch.koT = 0; ch.koPose = false; ch.fightStance = false;
  }
  function throwPunch(h, type) {
    const ch = chOf(h); if (!ch) return;
    const rear = (type === "cross" || type === "hook" || type === "body");
    ch.punchArm = rear ? "r" : "l";
    ch.punchKind = (type === "hook" || type === "body") ? "hook" : null;   // null => straight jab/cross
    ch.punchDur = (type === "jab") ? 0.30 : (type === "hook" || type === "body") ? 0.5 : 0.4;
    ch.punchT = ch.punchDur;
  }
  // drive one fighter ped's WORLD transform from its sim side (peds are world-space,
  // parented to the arena root — origin is the ring centre).
  function placeFighter(h, side, opp) {
    const ch = chOf(h); if (!ch || !h.ped) return;
    const o = V.origin;
    const down = (ch.koPose || ch.koT > 0);
    const zoff = Math.sin(LIVE.bout.time * 0.7 + (side.dir < 0 ? 0 : Math.PI)) * 0.45; // gentle circling
    const wx = o.x + side.x * XS, wz = o.z + zoff;
    h.ped.pos.x = wx; h.ped.pos.z = wz;
    h.ped.group.position.x = wx; h.ped.group.position.z = wz;
    if (!down) h.ped.group.position.y = CANVAS_Y;    // KO layer owns Y while down (its crumple sink)
    // face the opponent
    const ox = o.x + opp.x * XS, oz = o.z + Math.sin(LIVE.bout.time * 0.7 + (opp.dir < 0 ? 0 : Math.PI)) * 0.45;
    const face = Math.atan2(ox - wx, oz - wz);
    h.ped.group.rotation.y = face;
    if (h.ped.staffPost) h.ped.staffPost.face = face;
    ch.fightStance = !down;                          // bladed hands-up idle (shared layer) unless down
  }
  // map fresh sim events -> ped rigs + the HUD feed
  function pumpEvents(bout) {
    const A = V.fA, B = V.fB;
    const byDir = (d) => (d < 0 ? A : B);
    const foe = (d) => (d < 0 ? B : A);
    while (bout.evI < bout.events.length) {
      const e = bout.events[bout.evI++];
      const d = e.d;
      switch (e.t) {
        case "throw": throwPunch(byDir(d.s), d.type); break;
        case "land": { const ch = chOf(foe(d.s)); if (ch) { ch.staggerT = d.counter ? 0.5 : 0.35; ch.staggerDur = 0.55; } break; }
        case "blocked": { const ch = chOf(foe(d.s)); if (ch) { ch.blockT = 0.45; ch.blockHitT = 0.15; } break; }
        case "slip": { const ch = chOf(foe(d.s)); if (ch) { ch.dodgeT = 0.4; ch.dodgeDir = nextRand() < 0.5 ? -1 : 1; } break; }
        case "slipmove": { const ch = chOf(byDir(d.s)); if (ch) { ch.dodgeT = 0.4; ch.dodgeDir = d.dir; } break; }
        case "knockdown": { const ch = chOf(byDir(d.s)); if (ch) { ch.koPose = true; ch.koT = 0.7; ch.koDur = 0.7; ch.fightStance = false; }
          if (near) feed("DOWN — " + nm(byDir(d.s) === A ? bout.a : bout.b) + " hits the canvas!", "#ff9a9a"); break; }
        case "getup": { const ch = chOf(byDir(d.s)); if (ch) { ch.koPose = false; ch.koT = 0; } if (near) feed(nm(byDir(d.s) === A ? bout.a : bout.b) + " beats the count!", "#ffd166"); break; }
        case "count": if (near && d.n >= 4) feed("...the ref counts " + d.n + "..."); break;
        case "bell": if (near) feed("*DING* — Round " + d.n, "#e8b64c"); break;
        case "bellEnd": if (near) feed("*DING* — end of round " + d.n); break;
        case "cards": if (near) feed("Judges turn in Round " + d.round + " cards."); break;
        case "ropes": if (near) feed(nm(byDir(d.s) === A ? bout.a : bout.b) + " is driven into the ropes."); break;
        case "over": endOfBout(bout); break;
        default: break;
      }
    }
    if (bout.events.length > 400) { bout.events.splice(0, bout.events.length - 120); bout.evI = bout.events.length; }
  }
  function nm(side) { return side && side.def ? side.def.short || side.def.name : "?"; }

  /* ==========================================================
     7. BOUT LIFECYCLE
     ========================================================== */
  function startAIBout() {
    if (!V || !V.fA) return;
    const card = AI_CARDS[(Math.random() * AI_CARDS.length) | 0];
    const bout = mkBout(card[0], card[1], false);
    const p = ratingProb(card[0], card[1]);
    LIVE = { bout: bout, role: "ai", aKey: card[0], bKey: card[1], boutIdx: -1, purse: 0, done: false,
      oddsA: oddsFromProb(p), oddsB: oddsFromProb(1 - p), bet: null };
    resetFighterRigs();
    if (near) feed("Undercard: " + DEFS[card[0]].name + " (" + LIVE.oddsA.toFixed(2) + ") vs " +
      DEFS[card[1]].name + " (" + LIVE.oddsB.toFixed(2) + ") — [E] to bet.", "#9ad0ff");
  }
  function startPlayerBout(idx) {
    if (!V || !V.fA) { feed("The card is closed tonight."); return; }
    const B = BOUTS[idx];
    LIVE = { bout: mkBout("you", B.opp, true), role: "player", aKey: "you", bKey: B.opp,
      boutIdx: idx, purse: B.purse, done: false, oddsA: oddsFromProb(B.youWinProb), oddsB: oddsFromProb(1 - B.youWinProb), bet: null };
    resetFighterRigs();
    pendingAction = null;
    feed((idx === 2 ? "TITLE FIGHT" : B.label) + " — you vs " + DEFS[B.opp].name + ". Purse " + fmt(B.purse) + ".", "#e8b64c");
    openFighterHUD();
  }
  function resetFighterRigs() {
    [V.fA, V.fB].forEach((h) => { const ch = chOf(h); if (ch) { clearFightFlags(ch); ch.fightStance = true; } });
  }
  function endOfBout(bout) {
    if (!LIVE || LIVE.done) return;
    LIVE.done = true;
    const s = bag();
    const youWon = (LIVE.role === "player") && bout.winner === "A";
    if (LIVE.role === "player") {
      const B = BOUTS[LIVE.boutIdx], method = bout.method || "decision";
      const kod = method === "KO" || method === "TKO";
      if (youWon) {
        s.wins++; if (kod) s.kos++; s.earned += LIVE.purse;
        C.wallet.give(LIVE.purse, "Fight purse");
        if (CBZ.city && CBZ.city.addRespect) { try { CBZ.city.addRespect(LIVE.boutIdx === 2 ? 12 : 6); } catch (e) {} }
        if (LIVE.boutIdx === 2 && !s.belt) { s.belt = true; openBelt(); feed("NEW SOUTHPAW PALACE CHAMPION!", "#ffd166"); }
        else feed("Winner by " + method + " — purse " + fmt(LIVE.purse) + "!", "#ffd166");
      } else {
        s.losses++;
        feed(bout.winner === "B" ? ("Beaten by " + method + ". Journeyman's night — no purse.") : "Draw. No purse tonight.", "#ff9a9a");
      }
      save();
    } else if (LIVE.role === "ai" && LIVE.bet) {   // settle the bettor's stake
      const won = LIVE.bet.side === bout.winner;
      if (won) { const pay = payout(LIVE.bet.stake, LIVE.bet.odds); C.wallet.give(pay, "Bet cashed"); feed("Bet cashed: +" + fmt(pay), "#ffd166"); }
      else feed("Bet lost — " + fmt(LIVE.bet.stake) + " to the house.", "#ff9a9a");
      LIVE.bet = null;
    }
    if (LIVE.role === "player") { panelMode = "result"; openResult(bout); }
  }

  /* ==========================================================
     8. BUILD — the venue (deterministic; chunky; every prop a job)
     ========================================================== */
  function build(ctx, venue) {
    C = ctx;
    const g = venue.group;
    g.position.y = DECK_Y;                        // sit the whole rig on the arena plaza deck
    V = { origin: venue.origin, fA: null, fB: null, ref: null, judges: [], bookie: null, cutman: null,
      cardMesh: null, cardCanvas: null, beltLid: null, beltOpen: 0, pending: [], _venue: venue };

    const MAT = { post: 0x8a919e, red: 0xc22333, blue: 0x2246c2, neutral: 0xdfe3ea, wood: 0x4a2e1c,
      woodD: 0x33200f, steel: 0x39404c, rope: 0xe8e4da, dark: 0x1a1d24, gold: 0xe8b64c, felt: 0x2a6cc0 };
    const box = (x, y, z, w, h, d, m, ry) => ctx.box(g, x, y, z, w, h, d, ctx.mat(m), ry);

    // ---- RING platform + canvas (canvas mat) : the stage --------------------
    const half = 3.5;                             // corner-post ring half-width
    box(0, 0.45, 0, 8.2, 0.9, 8.2, MAT.steel);   // chunky platform (rests on deck: 0..0.9)
    // canvas apron: a CanvasTexture top so the ring reads as SOUTHPAW PALACE from the stands
    const canvasTex = ctx.canvasTex(256, 256, (cc, w, h) => {
      cc.fillStyle = "#d8d4c4"; cc.fillRect(0, 0, w, h);
      cc.strokeStyle = "rgba(20,24,32,.35)"; cc.lineWidth = 3; cc.strokeRect(10, 10, w - 20, h - 20);
      cc.fillStyle = "rgba(30,40,70,.55)"; cc.font = "bold 34px Arial"; cc.textAlign = "center"; cc.textBaseline = "middle";
      cc.fillText("SOUTHPAW", w / 2, h / 2 - 20); cc.fillText("PALACE", w / 2, h / 2 + 22);
    });
    const canvas = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.08, 7.8), new THREE.MeshLambertMaterial({ map: canvasTex }));
    canvas.position.set(0, 0.94, 0); g.add(canvas);
    ctx.solid(-4.1, -4.1, 4.1, 4.1, DECK_Y, DECK_Y + 1.0);   // player bumps the ring apron

    // ---- 4 corner posts + pads (red/blue corner identity) -------------------
    const corners = [[-half, -half, MAT.red], [half, half, MAT.blue], [half, -half, MAT.neutral], [-half, half, MAT.neutral]];
    corners.forEach((c) => {
      box(c[0], 0.94 + 0.85, c[1], 0.24, 1.7, 0.24, MAT.post);   // post
      box(c[0], 0.94 + 0.5, c[1], 0.42, 0.9, 0.42, c[2]);        // padded corner (chunky, load-bearing colour)
    });
    // ---- sagging ropes as thin cyls between the posts (3 rows) --------------
    const rc = half - 0.15;
    const ropeH = [0.55, 0.95, 1.35], sag = [0.16, 0.12, 0.08];
    for (let r = 0; r < 3; r++) {
      const y = 0.94 + ropeH[r], s = sag[r];
      ropeSeg(g, -rc, -rc, rc, -rc, y, s, MAT.rope);   // south
      ropeSeg(g, -rc, rc, rc, rc, y, s, MAT.rope);     // north
      ropeSeg(g, -rc, -rc, -rc, rc, y, s, MAT.rope);   // west
      ropeSeg(g, rc, -rc, rc, rc, y, s, MAT.rope);     // east
    }
    // ---- ring steps (the walk-in) on the entry (+Z) side --------------------
    box(0, 0.25, half + 1.0, 2.2, 0.5, 1.3, MAT.steel);
    box(0, 0.6, half + 0.5, 1.6, 0.5, 0.9, MAT.steel);

    // ---- corner STOOLS: you SIT on yours between rounds; the cutman works it -
    box(-half - 0.9, 0.28, -half - 0.9, 0.7, 0.55, 0.7, MAT.red);    // red corner stool
    box(half + 0.9, 0.28, half + 0.9, 0.7, 0.55, 0.7, MAT.blue);     // blue corner stool
    ctx.solid(-half - 1.25, -half - 1.25, -half - 0.55, -half - 0.55, DECK_Y, DECK_Y + 0.6);
    ctx.solid(half + 0.55, half + 0.55, half + 1.25, half + 1.25, DECK_Y, DECK_Y + 0.6);

    // ---- JUDGES' TABLE (west, ringside): 3 seats, their cards decide it ------
    const jx = -half - 3.0;
    box(jx, 0.75, 0, 1.3, 0.16, 5.2, MAT.wood);              // table top
    box(jx, 0.86, 0, 1.34, 0.26, 5.24, MAT.woodD);           // skirt
    for (let i = 0; i < 3; i++) { box(jx - 0.05, 0.35, (i - 1) * 1.7, 1.0, 0.7, 0.3, MAT.woodD);   // seat block
      box(jx - 0.9, 0.35, (i - 1) * 1.7, 0.7, 0.7, 0.7, MAT.steel); }                              // chair
    ctx.solid(jx - 0.75, -2.7, jx + 0.75, 2.7, DECK_Y, DECK_Y + 0.95);
    // a scorecard board on the table, texture-swapped between rounds (their held cards)
    V.cardCanvas = document.createElement("canvas"); V.cardCanvas.width = 384; V.cardCanvas.height = 128;
    const boardTex = new THREE.CanvasTexture(V.cardCanvas);
    V.cardMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.8), new THREE.MeshBasicMaterial({ map: boardTex, transparent: true }));
    V.cardMesh.position.set(jx + 0.75, 1.5, 0); V.cardMesh.rotation.y = Math.PI / 2; g.add(V.cardMesh);
    V.boardTex = boardTex; drawCards(null);

    // ---- BELT CASE (the GOAL, by the entry +Z, visible on the walk in) -------
    const bx = half + 2.4, bz = half + 1.6;
    box(bx, 0.55, bz, 1.4, 1.1, 1.0, MAT.woodD);            // plinth
    box(bx, 1.16, bz, 1.24, 0.12, 0.9, MAT.gold);           // shelf
    const belt = box(bx, 1.28, bz, 0.9, 0.22, 0.5, MAT.gold);  // THE BELT (plate + strap read)
    box(bx, 1.28, bz, 1.0, 0.14, 0.36, MAT.dark);
    V.belt = belt; V.beltHome = 1.28;
    // glass lid (thin transparent box) — lifts on a title win
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 0.94),
      new THREE.MeshPhongMaterial({ color: 0xbfe4ff, transparent: true, opacity: 0.18, shininess: 90 }));
    lid.position.set(bx, 1.75, bz); g.add(lid); V.beltLid = lid; V.beltLidHome = 1.75;
    for (let i = 0; i < 4; i++) box(bx + (i & 1 ? 0.6 : -0.6), 1.7, bz + (i & 2 ? 0.44 : -0.44), 0.1, 1.0, 0.1, MAT.post);
    ctx.solid(bx - 0.75, bz - 0.6, bx + 0.75, bz + 0.6, DECK_Y, DECK_Y + 1.4);

    // ---- BETTING WINDOW (east): the bettor economy + the bookie's post -------
    const wx = half + 3.2, wz = -half - 1.0;
    box(wx, 0.9, wz, 1.6, 1.8, 3.0, MAT.dark);              // booth
    box(wx - 0.85, 1.86, wz, 0.2, 0.16, 3.1, MAT.gold);     // counter lip
    const neonTex = ctx.canvasTex(256, 64, (cc, w, h) => { cc.fillStyle = "#0b0f16"; cc.fillRect(0, 0, w, h);
      cc.fillStyle = "#35e0ff"; cc.font = "bold 30px Arial"; cc.textAlign = "center"; cc.textBaseline = "middle"; cc.fillText("BOOKMAKER", w / 2, h / 2); });
    const neon = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.45), new THREE.MeshBasicMaterial({ map: neonTex }));
    neon.position.set(wx - 0.83, 2.4, wz); neon.rotation.y = -Math.PI / 2; g.add(neon);
    ctx.solid(wx - 0.8, wz - 1.5, wx + 0.8, wz + 1.5, DECK_Y, DECK_Y + 1.8);

    // ---- the LOOK: one hot pool over the ring (dark plaza / bright ring) -----
    ctx.light(0, 6.5, 0, 0xfff1d8, 1.1, 22);
    ctx.light(bx, 3.0, bz, 0xffd77a, 0.7, 7);               // belt-case glow (the goal draws the eye)

    // ---- CAST (deferred like casino: real peds need the live arena) ---------
    // fighters: role "boxer" (no catalog boxer fit → pass corner colours). RED
    // corner is sim side A, BLUE is side B — persistent across matchups, exactly
    // like a real venue's fixed corners.
    queue({ role: "boxer", name: "Red Corner", outfit: MAT.red, skin: 0xc98d5f,
      at: [-1.6, 0], face: Math.PI / 2, post: "pinned", pose: "stand" }, "fA");
    queue({ role: "boxer", name: "Blue Corner", outfit: MAT.blue, skin: 0x8a5c3a,
      at: [1.6, 0], face: -Math.PI / 2, post: "pinned", pose: "stand" }, "fB");
    queue({ role: "referee", name: "The Referee", outfit: 0xdedede, skin: 0xd8a878,
      at: [-half + 0.6, half - 0.6], face: -Math.PI / 4, post: "pinned", pose: "stand",
      dialogue: ["Protect yourself at all times.", "I stop it when I stop it. Fight."] }, "ref");
    for (let i = 0; i < 3; i++) queue({ role: "judge", name: "Judge " + (i + 1), outfit: 0x1c2230,
      at: [jx - 0.9, (i - 1) * 1.7], face: -Math.PI / 2, post: "pinned", pose: "sit",
      dialogue: ["I score what I see. Clean punches, ring generalship."] }, "judge");
    queue({ role: "bookmaker", name: "The Bookmaker", outfit: 0x6e1524, skin: 0xcaa06e,
      at: [wx - 1.2, wz], face: -Math.PI / 2, post: "pinned", pose: "stand",
      dialogue: ["Money down before the bell, friend.", "Odds are odds. The house keeps the vig."] }, "bookie");
    queue({ role: "cutman", name: "The Cutman", outfit: 0xe4e4e4, skin: 0x9c6b41,
      at: [-half - 1.4, -half - 0.4], face: 0, post: "pinned", pose: "stand",
      dialogue: ["Sit down, breathe. I'll close that cut.", "One round at a time."] }, "cutman");

    // ---- the entry point: one zone, one panel ------------------------------
    ctx.zone({
      id: "ring", pos: [0, half + 2.2], r: 3.0,
      label: () => {
        const s = bag();
        if (LIVE && LIVE.role === "player" && !LIVE.bout.over) return "[E] Back to the corner (bout live)";
        return "[E] SOUTHPAW PALACE — Fight Night" + (s.belt ? " (CHAMPION)" : "");
      },
      onUse: () => { if (LIVE && LIVE.role === "player" && !LIVE.bout.over) openFighterHUD(); else openMain(); },
    });
    ctx.zone({
      id: "belt", pos: [half + 2.4, half + 1.6], r: 1.8,
      label: () => bag().belt ? "[E] The Southpaw Palace belt — yours" : "[E] The belt case (win the title)",
      onUse: () => { const s = bag(); C.hud.toast(s.belt ? "SOUTHPAW PALACE CHAMPION" : "Win the title fight to claim the strap."); },
    });
  }

  // thin sagging rope = two cylinders forming a shallow V (mid dips by `sag`)
  function ropeSeg(g, ax, az, bx, bz, y, sag, mcol) {
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    segCyl(g, ax, y, az, mx, y - sag, mz, mcol);
    segCyl(g, mx, y - sag, mz, bx, y, bz, mcol);
  }
  function segCyl(g, ax, ay, az, bx, by, bz, mcol) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz) || 0.001;
    const mesh = C.cyl(g, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, 0.05, 0.05, len, C.mat(mcol), 6);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize());
    return mesh;
  }

  /* deferred cast (arena root/peds land after our order-88 build; casino pattern) */
  function queue(spec, tag) { if (V && V.pending) V.pending.push({ spec, tag }); }
  function arenaLive() { return !!(CBZ.city && CBZ.city.arena && CBZ.city.arena.root); }
  function drainCast() {
    if (!V || !V.pending) return;
    if (C.npc && !arenaLive()) return;              // real peds need the live arena — wait a tick
    const pend = V.pending; V.pending = null;        // null first => idempotent
    for (const item of pend) {
      const h = C.npc(item.spec);
      if (item.tag === "fA") V.fA = h;
      else if (item.tag === "fB") V.fB = h;
      else if (item.tag === "ref") V.ref = h;
      else if (item.tag === "judge") V.judges.push(h);
      else if (item.tag === "bookie") V.bookie = h;
      else if (item.tag === "cutman") V.cutman = h;
    }
    // pin the ground-level cast onto the plaza deck (ctx.npc spawns them at y=0)
    parkDeck(V.ref, CANVAS_Y); parkDeck(V.bookie, DECK_Y); parkDeck(V.cutman, DECK_Y);
    V.judges.forEach((h) => parkDeck(h, DECK_Y));
  }
  function parkDeck(h, y) { if (h && h.ped) { h.ped.pos.y = 0; h.ped.group.position.y = y; } }

  /* ==========================================================
     9. UPDATE — distance-gated sim + ped drive + HUD refresh
     ========================================================== */
  function update(ctx, dt) {
    if (!V || (V._venue && ctx.venue !== V._venue)) return;
    if (V.pending && V.pending.length) drainCast();
    if (!dt || dt > 0.4) dt = 0.05;

    const P = CBZ.player;
    const o = V.origin;
    near = !!(P && P.pos && Math.hypot(P.pos.x - o.x, P.pos.z - o.z) < 90);

    // keep the belt-case lid animation alive regardless (the goal opens on a title win)
    if (V.beltLid) {
      const t = bag().belt ? 1 : 0;
      V.beltOpen += (t - V.beltOpen) * (1 - Math.exp(-4 * dt));
      V.beltLid.position.y = V.beltLidHome + V.beltOpen * 1.1;
      if (V.belt) V.belt.position.y = V.beltHome + V.beltOpen * 0.12;
    }
    if (!near) return;   // across the map: nothing ticks (arena_fights does the same)

    // no bout running? the ring stays ALIVE with a bettable AI undercard.
    if (!LIVE || (LIVE.done && LIVE.role === "ai")) startAIBout();
    if (!LIVE) return;
    const bout = LIVE.bout;

    // advance the ONE sim. player bout feeds side A from the click queue.
    if (!bout.over && bout.phase !== "cornerWait") {
      stepFight(bout, dt, LIVE.role === "player" ? playerInput : null);
    }
    pumpEvents(bout);

    // drive the two fighter peds off the sim sides (the shared anim layer)
    if (V.fA && V.fB) { placeFighter(V.fA, bout.a, bout.b); placeFighter(V.fB, bout.b, bout.a); }
    driveRef(bout);

    // phase transitions the UI must react to (corner between rounds; cards)
    if (bout.phase !== lastPhase) {
      if (bout.phase === "cornerWait" && LIVE.role === "player") { drawCards(bout); openCorner(bout); }
      else if (bout.phase === "round" && lastPhase === "cornerWait" && LIVE.role === "player" && panelMode === "corner") openFighterHUD();
      if (bout.phase === "rest") drawCards(bout);
      lastPhase = bout.phase;
    }
    if (panelMode === "fighter") refreshFightHUD(bout);
  }

  function driveRef(bout) {
    const h = V.ref; if (!h || !h.ped) return; const ch = chOf(h);
    const o = V.origin;
    const downSide = bout.a.act === "down" ? bout.a : bout.b.act === "down" ? bout.b : null;
    let tx = o.x - 2.6, tz = o.z + 2.6;                 // neutral corner
    if (downSide) { tx = o.x + downSide.x * XS + 0.9; tz = o.z; }
    h.ped.pos.x += (tx - h.ped.pos.x) * 0.12; h.ped.pos.z += (tz - h.ped.pos.z) * 0.12;
    h.ped.group.position.x = h.ped.pos.x; h.ped.group.position.z = h.ped.pos.z; h.ped.group.position.y = CANVAS_Y;
    const cx = o.x, cz = o.z;
    h.ped.group.rotation.y = Math.atan2(cx - h.ped.pos.x, cz - h.ped.pos.z);
    if (ch) ch.fightStance = false;
  }

  // player input: apply the last-queued action to side A (jab/cross/hook/body/block/slip)
  function playerInput(bout, dt) {
    const a = bout.a;
    if (a.act === "down") { if (a.riseHits >= a.riseNeed) a.getupOk = true; return; }
    if (!pendingAction) return;
    const act = pendingAction; pendingAction = null;
    if (act.k === "punch") startPunch(bout, a, act.type);
    else if (act.k === "slip") startSlip(bout, a, act.dir);
    else if (act.k === "block") { if (a.act === "idle") { a.act = "block"; a.blockT = 0.55; } }
  }

  /* ==========================================================
     10. PANELS
     ========================================================== */
  const BTN = "display:inline-block;margin:3px 5px 3px 0;padding:9px 15px;border-radius:11px;cursor:pointer;font-weight:800;font-size:14px;user-select:none;box-shadow:0 3px 0 rgba(0,0,0,.4);";
  function btn(act, label, bg, dis) {
    return "<span data-act='" + act + "' style='" + BTN + "background:" + (bg || "#1c6b40") + ";" + (dis ? "opacity:.35;pointer-events:none;" : "") + "'>" + label + "</span>";
  }
  function head(title, sub) {
    return "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px'>" +
      "<b style='letter-spacing:2px;color:#e8b64c'>" + title + "</b><span style='opacity:.7;font-size:12px'>" + (sub || "") + " · Esc closes</span></div>";
  }
  function barHTML(id, col, pct) {
    return "<div style='height:12px;border-radius:6px;background:rgba(0,0,0,.5);overflow:hidden;border:1px solid rgba(255,255,255,.18);margin:3px 0'>" +
      "<div id='" + id + "' style='height:100%;width:" + pct + "%;background:" + col + "'></div></div>";
  }

  function openMain() {
    panelMode = "main"; const s = bag();
    const idx = nextBoutIdx(), B = BOUTS[idx];
    const fh = "<div style='font-size:12px;opacity:.85;margin:4px 0 8px'>Record <b>" + s.wins + "-" + s.losses + "</b> · " + s.kos + " KO · " +
      rank().toUpperCase() + " · cash <b>" + fmt(C.wallet.cash()) + "</b>" + (s.belt ? " · <span style='color:#e8b64c'>🏆 CHAMPION</span>" : "") + "</div>";
    const fightRow = s.belt
      ? "<div style='opacity:.8;font-size:13px;margin:6px 0'>You hold the strap. Defend it (title purse):</div>" + btn("fight", "DEFEND vs " + DEFS.vega.name + " — " + fmt(BOUTS[2].purse), "#8a1f1f")
      : "<div style='font-size:13px;margin:6px 0'>" + B.label + ": <b>you</b> vs " + DEFS[B.opp].name + " (" + DEFS[B.opp].blurb + ")<br>your odds <b>" + oddsFromProb(B.youWinProb).toFixed(2) + "</b> · purse <b>" + fmt(B.purse) + "</b></div>" + btn("fight", "SIGN — " + B.label, "#8a1f1f");
    C.hud.panel(
      head("SOUTHPAW PALACE", "Fight Night") + fh +
      "<div style='display:flex;gap:16px;flex-wrap:wrap'>" +
        "<div style='flex:1;min-width:240px'><div style='color:#ff9a9a;font-weight:800;font-size:12px;letter-spacing:1px'>ROLE · FIGHTER</div>" + fightRow + "</div>" +
        "<div style='flex:1;min-width:240px'><div style='color:#9ad0ff;font-weight:800;font-size:12px;letter-spacing:1px'>ROLE · BETTOR</div>" +
          "<div style='font-size:13px;margin:6px 0'>Watch the undercard live in the ring and back a fighter at odds from their records.</div>" +
          btn("bet", "BETTING WINDOW", "#1f4e8a") + "</div>" +
      "</div>",
      { fight: () => { if (s.belt) startPlayerBout(2); else startPlayerBout(idx); },
        bet: () => openBet(),
        close: () => C.hud.closePanel() });
  }

  function openFighterHUD() {
    panelMode = "fighter"; lastPhase = LIVE ? LIVE.bout.phase : null;
    const controls =
      btn("jab", "JAB", "#2a7a4a") + btn("cross", "CROSS", "#2a7a4a") + btn("hook", "HOOK", "#2a7a4a") + btn("body", "BODY", "#2a7a4a") +
      "<span style='display:inline-block;width:10px'></span>" +
      btn("block", "BLOCK", "#4a5260") + btn("slipL", "SLIP ◄", "#5a4636") + btn("slipR", "SLIP ►", "#5a4636") +
      "<span style='display:inline-block;width:10px'></span>" + btn("giveup", "Throw in the towel", "#6b2222");
    C.hud.panel(
      "<div style='display:flex;justify-content:space-between;align-items:center'>" +
        "<b style='color:#ff9a9a'>YOU — THE SOUTHPAW</b>" +
        "<span id='bx_round' style='color:#e8b64c;font-weight:800'>ROUND 1/3</span>" +
        "<b id='bx_opnm' style='color:#9ad0ff'>OPPONENT</b></div>" +
      "<div style='display:flex;gap:14px;margin:6px 0'>" +
        "<div style='flex:1'>HP" + barHTML("bx_yhp", "linear-gradient(180deg,#ff6a5e,#c22b21)", 100) + "STA" + barHTML("bx_yst", "linear-gradient(180deg,#ffe08a,#d99b1e)", 100) + "</div>" +
        "<div style='flex:1'>HP" + barHTML("bx_ohp", "linear-gradient(180deg,#ff6a5e,#c22b21)", 100) + "STA" + barHTML("bx_ost", "linear-gradient(180deg,#ffe08a,#d99b1e)", 100) + "</div></div>" +
      "<div id='bx_tell' style='min-height:20px;text-align:center;font-weight:800;letter-spacing:1px;color:#ffd166'></div>" +
      "<div id='bx_ctrls' style='margin-top:4px'>" + controls + "</div>",
      { jab: () => fightAct({ k: "punch", type: "jab" }), cross: () => fightAct({ k: "punch", type: "cross" }),
        hook: () => fightAct({ k: "punch", type: "hook" }), body: () => fightAct({ k: "punch", type: "body" }),
        block: () => fightAct({ k: "block" }), slipL: () => fightAct({ k: "slip", dir: -1 }), slipR: () => fightAct({ k: "slip", dir: 1 }),
        giveup: () => { if (LIVE && !LIVE.bout.over) finish(LIVE.bout, LIVE.bout.b, "RTD"); },
        close: () => C.hud.closePanel() });
  }
  // one input funnel: while you're DOWN, every button press is a get-up mash;
  // otherwise it queues the action for side A (playerInput applies it).
  function fightAct(a) {
    const bout = LIVE && LIVE.bout; if (!bout) return;
    if (bout.a.act === "down") { bout.a.riseHits++; return; }
    pendingAction = a;
  }
  function refreshFightHUD(bout) {
    const a = bout.a, b = bout.b;
    const set = (id, v, prop) => { const e = document.getElementById(id); if (e) { if (prop === "w") e.style.width = v + "%"; else if (prop === "t") e.textContent = v; else e.innerHTML = v; } };
    set("bx_yhp", Math.max(0, a.hp / a.hpMax * 100), "w"); set("bx_yst", Math.max(0, a.st), "w");
    set("bx_ohp", Math.max(0, b.hp / b.hpMax * 100), "w"); set("bx_ost", Math.max(0, b.st), "w");
    set("bx_round", "ROUND " + bout.round + "/3  " + Math.max(0, Math.ceil(bout.clock)) + "s", "t");
    set("bx_opnm", (DEFS[LIVE.bKey].name).toUpperCase(), "t");
    // TELEGRAPH the opening: opponent winding up -> slip/block now; you slipped -> counter window
    let tell = "";
    if (a.act === "down") tell = "DOWN! Mash a punch button to rise (" + a.riseHits + "/" + a.riseNeed + ")";
    else if (a.counterT > 0) tell = "COUNTER WINDOW — punch NOW for DOUBLE!";
    else if (b.act === "punch" && b.pT < PUNCH[b.punch].wu * windupMult(b.st / 100)) tell = "⚠ " + DEFS[LIVE.bKey].short + " loads a " + b.punch.toUpperCase() + " — SLIP or BLOCK!";
    else if (a.swell >= 2) tell = "Your eye is closing — see the cutman between rounds.";
    set("bx_tell", tell, "h");
  }

  function openCorner(bout) {
    panelMode = "corner";
    const a = bout.a, s = a;
    const cutOpts = s.cutmanLeft > 0
      ? btn("ice", "Ice the swelling — $150", "#1f4e8a") + btn("air", "Oxygen (stamina) — $120", "#1f4e8a") + btn("pep", "Adrenaline (HP) — $200", "#1f4e8a")
      : "<div style='opacity:.7;font-size:12px'>The cutman's done what he can this fight.</div>";
    C.hud.panel(
      head("YOUR CORNER", "Round " + bout.round + " done · cutman work: " + s.cutmanLeft + " left") +
      "<div style='font-size:12px;margin:4px 0'>" + cardTable(bout) + "</div>" +
      "<div style='font-size:13px;margin:6px 0'>HP " + Math.max(0, Math.round(a.hp)) + " · STA " + Math.max(0, Math.round(a.st)) + " · swelling " + a.swell + " · cash " + fmt(C.wallet.cash()) + "</div>" +
      cutOpts + "<div style='margin-top:8px'>" + btn("bell", "ANSWER THE BELL ►", "#8a1f1f") + "</div>",
      { ice: () => cutman("ice"), air: () => cutman("air"), pep: () => cutman("pep"),
        bell: () => { answerBell(bout); openFighterHUD(); },
        close: () => C.hud.closePanel() });
  }
  function cutman(kind) {
    const a = LIVE && LIVE.bout && LIVE.bout.a; if (!a || a.cutmanLeft <= 0) return;
    const cost = kind === "ice" ? 150 : kind === "air" ? 120 : 200;
    if (!C.wallet.spend(cost, "Cutman")) { feed("Not enough cash for the cutman."); return; }
    a.cutmanLeft--;
    if (kind === "ice") { a.swell = Math.max(0, a.swell - 2); a.hp = Math.min(a.hpMax, a.hp + 6); }
    else if (kind === "air") a.st = Math.min(100, a.st + 40);
    else a.hp = Math.min(a.hpMax, a.hp + 18);
    openCorner(LIVE.bout);
  }
  function cardTable(bout) {
    let h = "<table style='width:100%;border-collapse:collapse;font-size:12px'><tr><th style='color:#e8b64c'>Judge</th>";
    for (let r = 0; r < bout.cards[0].length; r++) h += "<th style='color:#e8b64c'>R" + (r + 1) + "</th>";
    h += "<th style='color:#e8b64c'>TOTAL</th></tr>";
    const tot = cardTotals(bout);
    for (let j = 0; j < 3; j++) {
      h += "<tr><td style='text-align:center;opacity:.8'>" + (j + 1) + "</td>";
      for (let r = 0; r < bout.cards[j].length; r++) h += "<td style='text-align:center'>" + bout.cards[j][r][0] + "-" + bout.cards[j][r][1] + "</td>";
      h += "<td style='text-align:center;font-weight:800'>" + tot[j][0] + "-" + tot[j][1] + "</td></tr>";
    }
    h += "</table><div style='font-size:11px;opacity:.7;margin-top:2px'>(you — opponent, 10-point-must)</div>";
    return h;
  }

  function openBet() {
    panelMode = "bet";
    if (!LIVE || LIVE.role !== "ai") { if (LIVE && LIVE.role === "player") { feed("Finish your own bout first."); return; } startAIBout(); }
    if (!LIVE || LIVE.bout.over) startAIBout();
    const bt = LIVE.bout, aD = DEFS[LIVE.aKey], bD = DEFS[LIVE.bKey];
    const already = LIVE.bet ? "<div style='color:#ffd166;font-size:13px'>Bet down: " + fmt(LIVE.bet.stake) + " on " + (LIVE.bet.side === "A" ? aD.short : bD.short) + " @ " + LIVE.bet.odds.toFixed(2) + "</div>" : "";
    betStake = betStake || 50;
    C.hud.panel(
      head("BETTING WINDOW", "Round " + bt.round + " · live undercard") +
      "<div style='font-size:13px;margin:4px 0'><b style='color:#ff9a9a'>" + aD.name + "</b> @ " + LIVE.oddsA.toFixed(2) + "  vs  <b style='color:#9ad0ff'>" + bD.name + "</b> @ " + LIVE.oddsB.toFixed(2) + "</div>" +
      already +
      "<div style='margin:8px 0'>Stake: <b id='bx_stake'>" + fmt(betStake) + "</b> · cash " + fmt(C.wallet.cash()) + "<br>" +
        btn("m25", "-$25", "#26343c") + btn("p25", "+$25", "#26343c") + "</div>" +
      btn("backA", "BACK " + aD.short, "#8a1f1f") + btn("backB", "BACK " + bD.short, "#1f4e8a") +
      "<div style='margin-top:6px'>" + btn("watch", "Just watch", "#26343c") + "</div>",
      { m25: () => { betStake = Math.max(25, betStake - 25); pokeStake(); }, p25: () => { betStake = Math.min(5000, betStake + 25); pokeStake(); },
        backA: () => placeBet("A"), backB: () => placeBet("B"), watch: () => C.hud.closePanel(),
        close: () => C.hud.closePanel() });
  }
  let betStake = 50;
  function pokeStake() { const e = document.getElementById("bx_stake"); if (e) e.textContent = fmt(betStake); }
  function placeBet(side) {
    if (!LIVE || LIVE.role !== "ai" || LIVE.bout.over) { feed("Too late — bout's decided."); return; }
    if (LIVE.bet) { feed("Your money's already down on this one."); return; }
    if (!C.wallet.spend(betStake, "Bet placed")) return;
    LIVE.bet = { side: side, stake: betStake, odds: side === "A" ? LIVE.oddsA : LIVE.oddsB };
    feed("Bet down: " + fmt(betStake) + " on " + (side === "A" ? DEFS[LIVE.aKey].short : DEFS[LIVE.bKey].short) + " @ " + LIVE.bet.odds.toFixed(2), "#ffd166");
    openBet();
  }

  function openResult(bout) {
    const you = bout.winner === "A";
    const title = bout.method === "KO" || bout.method === "TKO" ? (you ? "KNOCKOUT WIN" : "KNOCKED OUT") : (you ? "WINNER" : bout.winner === "draw" ? "DRAW" : "DECISION LOSS");
    const s = bag();
    const next = s.belt ? "" : (s.wins < 3 ? btn("again", "Next: " + BOUTS[nextBoutIdx()].label, "#8a1f1f") : "");
    C.hud.panel(
      head("SOUTHPAW PALACE", title + " · " + (bout.method || "")) +
      "<div style='font-size:12px;margin:4px 0'>" + cardTable(bout) + "</div>" +
      "<div style='font-size:13px;margin:6px 0'>Record " + s.wins + "-" + s.losses + " · " + s.kos + " KO · earned " + fmt(s.earned) + (s.belt ? " · <span style='color:#e8b64c'>🏆 CHAMPION</span>" : "") + "</div>" +
      next + btn("done", "Leave the ring", "#26343c"),
      { again: () => { LIVE = null; openMain(); }, done: () => { LIVE = null; panelMode = null; C.hud.closePanel(); },
        close: () => { LIVE = null; panelMode = null; C.hud.closePanel(); } });
  }

  function openBelt() { C.hud.toast("🏆 SOUTHPAW PALACE CHAMPION — the case is yours."); }

  // redraw the judges' held scorecards onto the ringside board (per round)
  function drawCards(bout) {
    if (!V.cardCanvas) return;
    const cc = V.cardCanvas.getContext("2d"), w = V.cardCanvas.width, h = V.cardCanvas.height;
    cc.clearRect(0, 0, w, h); cc.fillStyle = "rgba(12,15,22,.82)"; cc.fillRect(0, 0, w, h);
    cc.strokeStyle = "#e8b64c"; cc.lineWidth = 3; cc.strokeRect(4, 4, w - 8, h - 8);
    cc.fillStyle = "#e8b64c"; cc.font = "bold 20px Arial"; cc.textAlign = "center";
    cc.fillText("JUDGES' SCORECARDS", w / 2, 26);
    cc.font = "bold 26px Arial"; cc.fillStyle = "#fff6e2";
    if (bout && bout.cards[0].length) {
      const r = bout.cards[0].length - 1;
      for (let j = 0; j < 3; j++) cc.fillText(bout.cards[j][r][0] + " - " + bout.cards[j][r][1], w / 2, 60 + j * 22);
    } else { cc.fillStyle = "#8a929c"; cc.fillText("— fight night —", w / 2, 78); }
    if (V.boardTex) V.boardTex.needsUpdate = true;
  }

  /* ==========================================================
     11. REGISTER  (site venue: resolve to the Ironjaw Arena anchor)
     ========================================================== */
  CBZ.games.register({
    id: "boxing",
    title: "SOUTHPAW PALACE",
    // arena_fights.js is a LANDMASS (no lot kind) — resolve to its anchor and
    // build on the open NORTH plaza so its ring/cage/pit keep running untouched.
    venue: {
      site: "southpaw",
      resolve(CBZ) {
        const A = (CBZ.city && CBZ.city.arena) || CBZ._settlementArena;
        if (!A || !A.root || !A.regions) return null;           // wait until the world can answer
        let cx = 640, cz = -950;                                  // arena_fights constants (fallback)
        for (const r of A.regions) { if (r && /Ironjaw Arena/i.test(r.name || "")) { cx = r.cx; cz = r.cz; break; } }
        return { x: cx, z: cz - 52 };                             // north plaza (clear of ring 608,-950 / cage / pit)
      },
    },
    build(ctx, venue) { build(ctx, venue); },
    update(ctx, dt) { try { update(ctx, dt); } catch (e) { /* never break the frame loop */ } },

    /* probe surface — the gate asserts THROUGH this (numeric-only verify) */
    api: {
      rules: { RULES, PUNCH, COUNTER_MULT: RULES.COUNTER_MULT, punchDamage, windupMult, tenPointMust, oddsFromProb, payout, ratingProb },
      simBout,                        // (n, aKey, bKey, seed) -> deterministic results
      rig(arr) { if (Array.isArray(arr)) for (const v of arr) RIGQ.push(v); return RIGQ.length; },
      seed(s) { seedRng(s); },
      state: () => (S ? JSON.parse(JSON.stringify(S)) : { belt: false, wins: 0, losses: 0, kos: 0, earned: 0 }),
      belt: () => !!(S && S.belt),
      near: () => near,
      live: () => (LIVE && LIVE.bout ? { role: LIVE.role, round: LIVE.bout.round, phase: LIVE.bout.phase, over: LIVE.bout.over, winner: LIVE.bout.winner, method: LIVE.bout.method, aKey: LIVE.aKey, bKey: LIVE.bKey } : null),
      // headless helpers for the checker: stand up a live bout and step it, or open panels
      _startAI: () => startAIBout(),
      _startPlayer: (idx) => startPlayerBout(idx | 0),
      _bout: () => (LIVE ? LIVE.bout : null),
      _step: (dt, input) => { if (LIVE && !LIVE.bout.over) stepFight(LIVE.bout, dt || 1 / 30, input || (LIVE.role === "player" ? playerInput : null)); },
      _queue: (a) => { pendingAction = a; },
      // raw sim primitives so a probe can RIG an opening (e.g. force a counter
      // window, then a punch, and observe the landed damage double).
      _mk: mkBout, _stepRaw: stepFight, _cardTotals: cardTotals,
      _startPunch: startPunch, _startSlip: startSlip, _resolve: resolvePunch,
      open: () => openMain(), openBet: () => openBet(),
      cast: () => (V ? { fA: !!V.fA, fB: !!V.fB, ref: !!V.ref, judges: V.judges.length, bookie: !!V.bookie, cutman: !!V.cutman } : null),
    },
  });
})();

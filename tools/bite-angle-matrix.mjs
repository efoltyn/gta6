#!/usr/bin/env node
/* tools/bite-angle-matrix.mjs — THE ENGAGEMENT MATRIX for the angle law.

   Every claim in systems/bite_angles.js is a number, and this is where the
   numbers come from. It boots the real Shark Sim, stages engagements at
   controlled geometry, and drives PRODUCTION bite paths — creature_combat's
   strike frame and wildlife_tame's mounted bite — never a re-implementation.

     node tools/bite-angle-matrix.mjs                # the whole matrix, AFTER
     node tools/bite-angle-matrix.mjs --off          # ?cfg_BITE_ANGLES=0, BEFORE
     node tools/bite-angle-matrix.mjs --n 100        # engagements per cell
     node tools/bite-angle-matrix.mjs --json

   WHAT IT MEASURES
     1. THE CONTEST MATRIX. N staged animal-on-animal bites per geometry class
        (rear / flank / face / head-on), attacker small vs victim big and the
        reverse, through CBZ.creatureFight. Reports mean damage dealt, mean
        counter-damage taken, and the answer rate.
     2. THE MOUNTED MATRIX. The same four classes for the PLAYER's bite, fired
        through CBZ.cityMountedAnimalAttack exactly as Shark Sim fires it.
     3. THE DUEL. The claim in one line: hold a bull shark on an orca's TAIL
        and it kills the orca; hold the same bull shark on the orca's NOSE and
        the orca kills it. Fought to the death, both sides live, N times.
     4. THE POD. A live pod fight against the player's shark with nothing
        staged: how many of the pod's landed bites were angle-legal, and does
        the flank pass (podRams) fire at all.

   GEOMETRY IS RE-ASSERTED EVERY TICK, on purpose. The combat driver turns the
   attacker toward its mark and drags it forward through the lunge, so a
   position set once is gone in three frames. Re-asserting the bearing models
   exactly the thing being tested: a player who keeps winning the angle.
*/
import { launch, sleep, ROOT } from "./lib/cdp.mjs";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const OFF = has("--off");
const N = +arg("--n", "100");
const DUELS = +arg("--duels", "12");
const JSON_OUT = has("--json");
const SEED = arg("--seed", "90210");
const OUT = arg("--out", "");
const ONLY = arg("--only", "");        // cells | mounted | duel | pod (default: all)
/* THE CELL'S BITE IS A FIXED NUMBER, and that is the whole point of the
   experiment. Billing marineDpsAgainst() here made the matrix a measurement
   of somebody else's stat scaling: two runs ten minutes apart, on a checkout
   where the growth engine was being rewritten in a neighbouring file, came
   back with base damages of 51.6 and 0.0 for the same matchup — so a
   before/after on the ANGLE could not be read at all. A flat bite isolates
   the only thing this wave changes: what the geometry multiplies it by. The
   MOUNTED matrix deliberately keeps its production number (the species' own
   bite constant), because there the whole billing path is under test. */
const DMG = +arg("--dmg", "100");
const POD_SEC = +arg("--pod-sec", "150");   // game seconds of unstaged pod fight
const say = (m) => { if (!JSON_OUT) console.log(m); };

const rig = await launch({ rafBudget: 0 });
const report = { flag: OFF ? "BITE_ANGLES=0" : "BITE_ANGLES=1", n: N, cells: [], mounted: [], duels: [], pod: null, errors: [] };

const burst = (sec) => rig.evl(
  `(() => { for (let i = 0, n = ${Math.max(1, Math.round(sec * 30))}; i < n; i++) CBZ.stepSim(1/30); return true; })()`);

async function boot() {
  const q = `mode=sharksim&seed=${SEED}` + (OFF ? "&cfg_BITE_ANGLES=0" : "");
  await rig.open("index.html", q);
  if (!await rig.wait("window.CBZ && CBZ.game", 150000)) throw new Error("no CBZ");
  await rig.evl("CBZ.SURV_BOTS = 24");
  const playing = await rig.wait(`(() => {
    if (CBZ.game.state === 'playing' && CBZ.game.mode === 'sharksim') return true;
    if (!CBZ.cityWildlifeStock || !CBZ.spawnSurvivorBotAt || !CBZ.cityMountAnimal || !CBZ.stepSim) return false;
    const mb = document.querySelector('.mode-btn[data-mode="sharksim"]'); if (mb) mb.click();
    const pb = document.getElementById('playBtn'); if (pb) pb.click();
    return false;
  })()`, 240000, 300);
  if (!playing) throw new Error("never entered a match");
  const armed = await rig.evl(`(() => { for (let i=0;i<600;i++) CBZ.stepSim(1/30);
    return !!(CBZ.sharkSim && CBZ.sharkSim.shark && CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark); })()`);
  if (!armed) throw new Error("sim never mounted a shark");
}

/* ---------------------------------------------------------------------------
   THE IN-PAGE RIG. Installed once; every cell below is one call into it, so
   the 64 KB stdout cap never sees a per-engagement transcript.
--------------------------------------------------------------------------- */
const RIG = `(() => {
  if (window.__bam) return true;
  const CBZ = window.CBZ;
  // one deterministic stream for the whole run — a jitter that differs
  // between the before and after columns is not a controlled experiment
  let _s = 1337;
  function rnd() { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; }
  const CLASS = { rear: Math.PI, flank: Math.PI / 2, face: 0.55, headon: 0.0 };
  const FLATDMG = ${DMG};
  const JIT = { rear: 0.45, flank: 0.30, face: 0.28, headon: 0.22 };

  /* THE ONE PATCH OF SEA EVERY CELL IS STAGED IN, and it is the water the
     player's own shark is already swimming in. Picking world coordinates and
     hoping would have staged half the matrix on dry land. */
  const S0 = CBZ.sharkSim && CBZ.sharkSim.shark;
  const A = { x: S0 ? S0.pos.x : 0, y: S0 ? S0.pos.y : -2, z: S0 ? S0.pos.z : 0 };
  function face(a, h) {
    a.heading = h; a.faceH = h;
    if (CBZ.faceAnimalHeading) { try { CBZ.faceAnimalHeading(a, h); return; } catch (e) {} }
    if (a.group) a.group.rotation.y = -h;
  }
  function put(a, x, y, z, h) {
    a.pos.x = x; a.pos.y = y; a.pos.z = z;
    if (a.group) a.group.position.set(x, y, z);
    if (a._waterMove) { a._waterMove.x = x; a._waterMove.z = z; }
    face(a, h);
  }
  function len(a) { return (CBZ.marineBodyLen ? CBZ.marineBodyLen(a) : 6) || 6; }
  function beam(a) { return (CBZ.marineBodyBeam ? CBZ.marineBodyBeam(a) : 1.5) || 1.5; }
  function jawX(a) {
    const jp = (CBZ.creatureJawPoint && CBZ.creatureJawPoint(a)) || { x: 2.1 };
    return jp.x * ((a.species && a.species.scale) || 1);
  }
  /* HOW FAR OFF THE VICTIM'S CENTRE THE ATTACKER HAS TO SIT so the teeth are
     AT the surface on this bearing. An ellipse on the measured length and
     beam: a single radius puts the mouth a metre inside a 12.7 m orca astern
     and two metres short of it abeam, and both of those are a different
     experiment from the one being run. */
  function standoff(vic, att, bear) {
    const L = len(vic) * 0.5, B = beam(vic) * 0.5;
    return L * Math.abs(Math.cos(bear)) + B * Math.abs(Math.sin(bear)) + jawX(att) + 0.4;
  }
  function heal(a) { a.hp = a.maxHp || (a.species && a.species.hp) || 100; a.dead = false; }

  /* Park everything that is not in this experiment. A wild megalodon wandering
     into a staged cell is a confound, not a data point. */
  function isolate(keep) {
    for (const a of (CBZ.cityWildlife || [])) {
      if (a.dead || !a.species || keep.indexOf(a) >= 0) continue;
      a.pos.x += 320; a.hunger = 0;
      if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
      if (a.group) a.group.position.x = a.pos.x;
    }
  }

  function spawn(id, x, z) {
    if (!CBZ.cityWildlifeSpawnAt) return null;
    const a = CBZ.cityWildlifeSpawnAt(id, x, z);
    if (a) { a.hunger = 0; a.tamed = false; }
    return a;
  }

  /* THE STAGED ENGAGEMENT. Attacker held at bearing \`bear\` off the victim's
     own facing, nose pointed at the victim's centre, at contact range. Drive
     the production strike driver until it bills something, re-asserting the
     bearing every tick because the driver turns and drags the body. */
  function engage(att, vic, bear, opts, baseReach) {
    heal(att); heal(vic);
    att._atkT = 0; att._atkAnim = -1; vic._atkT = 0; vic._atkAnim = -1;
    att._biteAnswerT = -1e9; vic._biteAnswerT = -1e9;
    const vh = rnd() * 6.283;
    const R = standoff(vic, att, bear);
    /* AND THE DRIVER'S REACH HAS TO COVER THE STANDOFF, or the experiment
       measures the harness. creature_combat swings only inside opts.reach;
       the production formula for it (0.55·attacker + 0.42·victim) is written
       for a flank approach and comes up 1.2 m short ASTERN of a 12 m orca,
       so a rear cell staged at the honest surface distance sat in the
       approach branch for ninety frames with a no-op mover and never swung.
       predator.js floors the same number against its own surfaceStop for
       exactly this reason; this is that floor. */
    opts.reach = Math.max(baseReach, R + 0.6);
    const vx = A.x, vz = A.z, y = A.y;
    const dt = 1 / 30;
    const vHp0 = vic.hp, aHp0 = att.hp;
    let dealt = 0, zone = "", mult = 0, counter = 0, frames = 0, landed = false;
    let err = "", missed = 0, lastRes = null;
    const before = CBZ.biteAngleAudit ? CBZ.biteAngleAudit() : null;
    for (let i = 0; i < 90 && !landed; i++) {
      // victim: pinned facing, pinned position — the mark, not a fighter
      put(vic, vx, y, vz, vh);
      const ax = vx + Math.cos(vh + bear) * R, az = vz + Math.sin(vh + bear) * R;
      put(att, ax, y, az, Math.atan2(vz - az, vx - ax));
      let res = null;
      try { res = CBZ.creatureFight(att, vic, dt, opts); }
      catch (e) { res = null; if (!err) err = String((e && e.message) || e); }
      frames++;
      if (res) { lastRes = { inRange: !!res.inRange, dealt: res.dealt, missed: !!res.missed }; if (res.missed) missed++; }
      if (vic.hp < vHp0 || (res && res.dealt > 0)) {
        landed = true;
        dealt = vHp0 - vic.hp;
        const AU = CBZ.biteAngleAudit ? CBZ.biteAngleAudit() : null;
        if (AU) { zone = AU.lastZone; mult = AU.lastMult; }
      }
    }
    counter = Math.max(0, aHp0 - att.hp);
    const A2 = CBZ.biteAngleAudit ? CBZ.biteAngleAudit() : null;
    const answered = !!(before && A2 && A2.answers > before.answers);
    const trace = {
      err: err, missed: missed, lastRes: lastRes, frames: frames,
      atkAnim: att._atkAnim, atkT: +(att._atkT || 0).toFixed(2),
      reach: +(opts.reach || 0).toFixed(2), dmg: opts.dmg,
      dist: +Math.hypot(att.pos.x - vic.pos.x, att.pos.z - vic.pos.z).toFixed(2),
      vicHp: vic.hp, vicMax: vic.maxHp, attHp: att.hp,
      jawPt: CBZ.creatureJawPoint ? CBZ.creatureJawPoint(att) : null,
      attLen: +len(att).toFixed(2), vicLen: +len(vic).toFixed(2),
    };
    heal(att); heal(vic);
    return { landed: landed, dealt: dealt, counter: counter, zone: zone, mult: mult,
      frames: frames, answered: answered, trace: trace };
  }

  window.__bam = {
    CLASS: CLASS,
    /* CELL: N engagements of one matchup at one geometry class. */
    cell: function (attId, vicId, cls, n) {
      const S = CBZ.sharkSim && CBZ.sharkSim.shark;
      const att = spawn(attId, A.x + 6, A.z + 6);
      const vic = spawn(vicId, A.x + 10, A.z + 6);
      if (!att || !vic) return { err: "spawn failed " + attId + "/" + vicId };
      isolate([att, vic, S]);
      const opts = { reach: 0, dmg: 0, seize: false, style: "lunge",
        move: function () {}, onHit: null };
      const baseReach = (len(att) * 0.55 + len(vic) * 0.42);
      opts.reach = baseReach;
      opts.targetRad = (CBZ.marineBodyBeam ? CBZ.marineBodyBeam(vic) : 1) * 0.5;
      const base = FLATDMG;
      opts.dmg = base;
      // WHY A CELL LANDS NOTHING is not answerable from a zero. One traced
      // engagement per cell, kept beside the aggregate.
      const out = { attacker: attId, victim: vicId, cls: cls, n: 0, landed: 0,
        dealt: 0, counter: 0, answers: 0, zones: {}, mult: 0, base: +base.toFixed(2) };
      for (let i = 0; i < n; i++) {
        const jit = (rnd() * 2 - 1) * JIT[cls];
        const r = engage(att, vic, CLASS[cls] + jit, opts, baseReach);
        if (!out.trace) out.trace = r.trace;
        out.n++;
        if (r.landed) { out.landed++; out.dealt += r.dealt; out.mult += r.mult; }
        out.counter += r.counter;
        if (r.answered) out.answers++;
        if (r.zone) out.zones[r.zone] = (out.zones[r.zone] || 0) + 1;
      }
      att.dead = true; vic.dead = true;
      out.meanDealt = out.landed ? +(out.dealt / out.landed).toFixed(2) : 0;
      out.meanMult = out.landed ? +(out.mult / out.landed).toFixed(2) : 0;
      out.meanCounter = +(out.counter / out.n).toFixed(2);
      out.answerRate = +(out.answers / out.n).toFixed(2);
      out.landRate = +(out.landed / out.n).toFixed(2);
      return out;
    },

    /* MOUNTED CELL: the PLAYER's bite, fired the way Shark Sim fires it. */
    mounted: function (vicId, cls, n) {
      const S = CBZ.sharkSim && CBZ.sharkSim.shark;
      if (!S) return { err: "no mounted shark" };
      const vic = spawn(vicId, A.x + 8, A.z + 8);
      if (!vic) return { err: "spawn failed " + vicId };
      isolate([vic, S]);
      const out = { attacker: S.species.id, victim: vicId, cls: cls, n: 0, landed: 0,
        dealt: 0, counter: 0, answers: 0, zones: {}, mult: 0 };
      const R = (CBZ.creatureJawPoint ? (CBZ.creatureJawPoint(S).x * (S.species.scale || 1)) : 3) + 0.9;
      for (let i = 0; i < n; i++) {
        heal(S); heal(vic);
        S._biteAnswerT = -1e9; vic._biteAnswerT = -1e9;
        const vh = rnd() * 6.283;
        const bear = CLASS[cls] + (rnd() * 2 - 1) * JIT[cls];
        const y = A.y;
        put(vic, A.x, y, A.z, vh);
        const ax = A.x + Math.cos(vh + bear) * R, az = A.z + Math.sin(vh + bear) * R;
        const ah = Math.atan2(A.z - az, A.x - ax);
        put(S, ax, y, az, ah);
        CBZ.player.pos.x = ax; CBZ.player.pos.z = az; CBZ.player.pos.y = y + 1;
        // THE RIDE'S OWN AIM, through its published owner: inBiteFront reads
        // ride.head, not the animal's, so a mount posed without it refuses
        // every bite as "not in front of the mouth".
        if (CBZ.cityMountedHeading) CBZ.cityMountedHeading(ah);
        const before = CBZ.biteAngleAudit ? CBZ.biteAngleAudit() : null;
        const vHp0 = vic.hp, aHp0 = S.hp;
        let landed = false;
        for (let f = 0; f < 60 && !landed; f++) {
          put(vic, A.x, y, A.z, vh); put(S, ax, y, az, ah);
          if (CBZ.cityMountedHeading) CBZ.cityMountedHeading(ah);
          CBZ.player.pos.x = ax; CBZ.player.pos.z = az; CBZ.player.pos.y = y + 1;
          try { CBZ.cityMountedAnimalAttack(true); } catch (e) {}
          try { CBZ.stepSim(1 / 30); } catch (e) {}
          if (vic.hp < vHp0) landed = true;
        }
        out.n++;
        if (landed) {
          out.landed++; out.dealt += (vHp0 - vic.hp);
          const AU = CBZ.biteAngleAudit ? CBZ.biteAngleAudit() : null;
          if (AU) { out.mult += AU.lastMult; out.zones[AU.lastZone] = (out.zones[AU.lastZone] || 0) + 1; }
        }
        out.counter += Math.max(0, aHp0 - S.hp);
        const A2 = CBZ.biteAngleAudit ? CBZ.biteAngleAudit() : null;
        if (before && A2 && A2.answers > before.answers) out.answers++;
      }
      vic.dead = true; heal(S);
      out.meanDealt = out.landed ? +(out.dealt / out.landed).toFixed(2) : 0;
      out.meanMult = out.landed ? +(out.mult / out.landed).toFixed(2) : 0;
      out.meanCounter = +(out.counter / out.n).toFixed(2);
      out.answerRate = +(out.answers / out.n).toFixed(2);
      out.landRate = +(out.landed / out.n).toFixed(2);
      return out;
    },

    /* THE DUEL. Small vs big, fought to a body, with the small one HELD at one
       bearing off the big one's live facing — the orbiting player, modelled.
       Both sides swing through the production driver; nothing is scripted
       except where the small one chooses to be. */
    duel: function (smallId, bigId, cls, rounds) {
      const S = CBZ.sharkSim && CBZ.sharkSim.shark;
      const sm = spawn(smallId, A.x + 6, A.z + 6);
      const bg = spawn(bigId, A.x + 12, A.z + 6);
      if (!sm || !bg) return { err: "spawn failed" };
      isolate([sm, bg, S]);
      const dt = 1 / 30;
      const mkOpts = function (a, t) {
        return { reach: len(a) * 0.55 + len(t) * 0.42, seize: false, style: "lunge",
          targetRad: (CBZ.marineBodyBeam ? CBZ.marineBodyBeam(t) : 1) * 0.5,
          dmg: FLATDMG,
          move: function () {} };
      };
      const oS = mkOpts(sm, bg), oB = mkOpts(bg, sm);
      const out = { small: smallId, big: bigId, cls: cls, rounds: 0,
        smallWins: 0, bigWins: 0, draws: 0, smallHpLeft: 0, bigHpLeft: 0, ticks: 0,
        endSmallHp: 0, endBigHp: 0 };
      const y = A.y;
      for (let r = 0; r < rounds; r++) {
        heal(sm); heal(bg);
        sm._atkT = 0; sm._atkAnim = -1; bg._atkT = 0; bg._atkAnim = -1;
        sm._biteAnswerT = -1e9; bg._biteAnswerT = -1e9;
        let bh = rnd() * 6.283;
        let t = 0, done = 0;
        for (; t < 2400; t++) {
          // the big one turns to face whatever is biting it — that is the
          // combat driver's own yaw, read back, never written here
          bh = (typeof bg.heading === "number") ? bg.heading : bh;
          put(bg, A.x, y, A.z, bh);
          const bear = CLASS[cls] + (rnd() * 2 - 1) * JIT[cls];
          const R = standoff(bg, sm, bear);
          oS.reach = Math.max(len(sm) * 0.55 + len(bg) * 0.42, R + 0.6);
          const ax = A.x + Math.cos(bh + bear) * R, az = A.z + Math.sin(bh + bear) * R;
          put(sm, ax, y, az, Math.atan2(A.z - az, A.x - ax));
          try { CBZ.creatureFight(sm, bg, dt, oS); } catch (e) {}
          try { CBZ.creatureFight(bg, sm, dt, oB); } catch (e) {}
          if (sm.dead || sm.hp <= 0) { done = 2; break; }
          if (bg.dead || bg.hp <= 0) { done = 1; break; }
        }
        out.rounds++; out.ticks += t;
        out.endSmallHp += Math.max(0, sm.hp) / (sm.maxHp || (sm.species && sm.species.hp) || 100);
        out.endBigHp += Math.max(0, bg.hp) / (bg.maxHp || (bg.species && bg.species.hp) || 100);
        if (done === 1) { out.smallWins++; out.smallHpLeft += sm.hp / (sm.maxHp || 100); }
        else if (done === 2) { out.bigWins++; out.bigHpLeft += bg.hp / (bg.maxHp || 100); }
        else out.draws++;
      }
      sm.dead = true; bg.dead = true;
      out.smallWinRate = +(out.smallWins / out.rounds).toFixed(2);
      out.endSmallHp = +(out.endSmallHp / out.rounds).toFixed(2);
      out.endBigHp = +(out.endBigHp / out.rounds).toFixed(2);
      out.meanTicks = Math.round(out.ticks / out.rounds);
      out.smallHpLeftMean = out.smallWins ? +(out.smallHpLeft / out.smallWins).toFixed(2) : 0;
      return out;
    },
  };
  return true;
})()`;

/* --------------------------------------------------------------------------- */
try {
  await boot();
  say("booted — " + report.flag);
  const ok = await rig.evl(RIG);
  if (ok !== true) throw new Error("rig install failed: " + JSON.stringify(ok));
  await rig.evl("CBZ.biteAngleAuditReset && CBZ.biteAngleAuditReset()");

  const CLASSES = ["rear", "flank", "face", "headon"];
  const MATCHUPS = [["bull_shark", "orca"], ["orca", "bull_shark"]];

  const run = (n) => !ONLY || ONLY === "all" || ONLY === n;
  if (run("cells")) {
  say("\n— 1. the contest matrix (creature vs creature, " + N + " per cell) —");
  for (const [att, vic] of MATCHUPS) {
    for (const cls of CLASSES) {
      const r = await rig.evl(`JSON.stringify(window.__bam.cell(${JSON.stringify(att)}, ${JSON.stringify(vic)}, ${JSON.stringify(cls)}, ${N}))`);
      const c = JSON.parse(r);
      report.cells.push(c);
      if (c.err) { say("  ! " + c.err); continue; }
      if (!c.landed) say("    trace: " + JSON.stringify(c.trace));
      say(`  ${att.padEnd(11)} -> ${vic.padEnd(11)} ${cls.padEnd(7)}` +
        ` dmg ${String(c.meanDealt).padStart(7)}  counter ${String(c.meanCounter).padStart(6)}` +
        `  answer ${String(c.answerRate).padStart(5)}  land ${c.landRate}  x${c.meanMult}  ${JSON.stringify(c.zones)}`);
    }
  }

  }
  if (run("mounted")) {
  say("\n— 2. the mounted matrix (the PLAYER's bite, " + Math.min(N, 40) + " per cell) —");
  for (const cls of CLASSES) {
    const r = await rig.evl(`JSON.stringify(window.__bam.mounted("orca", ${JSON.stringify(cls)}, ${Math.min(N, 40)}))`);
    const c = JSON.parse(r);
    report.mounted.push(c);
    if (c.err) { say("  ! " + c.err); continue; }
    say(`  player(${c.attacker}) -> orca ${cls.padEnd(7)} dmg ${String(c.meanDealt).padStart(7)}` +
      `  counter ${String(c.meanCounter).padStart(6)}  answer ${String(c.answerRate).padStart(5)}` +
      `  land ${c.landRate}  x${c.meanMult}  ${JSON.stringify(c.zones)}`);
  }

  }
  if (run("duel")) {
  say("\n— 3. the duel: bull shark vs orca, held at one bearing, to the death —");
  for (const cls of ["rear", "flank", "headon"]) {
    const r = await rig.evl(`JSON.stringify(window.__bam.duel("bull_shark", "orca", ${JSON.stringify(cls)}, ${DUELS}))`);
    const c = JSON.parse(r);
    report.duels.push(c);
    if (c.err) { say("  ! " + c.err); continue; }
    say(`  bull shark on the orca's ${cls.padEnd(7)} — shark wins ${c.smallWins} · orca wins ${c.bigWins} · draws ${c.draws}` +
      `  mean ${c.meanTicks} ticks  end hp: shark ${c.endSmallHp} / orca ${c.endBigHp}`);
  }

  }
  const A = JSON.parse(await rig.evl("JSON.stringify(CBZ.biteAngleAudit ? CBZ.biteAngleAudit() : null)"));
  report.audit = A;
  say("\n  law audit: " + JSON.stringify(A));

  if (run("pod")) {
  say("\n— 4. the pod: four orcas, one shark, " + POD_SEC + " s, nothing else in the sea —");
  const pod = JSON.parse(await rig.evl(`(() => {
    const CBZ = window.CBZ, S = CBZ.sharkSim && CBZ.sharkSim.shark;
    if (!S) return JSON.stringify({ err: "no shark" });
    // give the pod a real fight: heal, bring them in, and stop healing
    S.hp = S.maxHp; S.dead = false;
    CBZ.sharkSim.podT = 0;
    /* OFFSHORE FIRST. The boot leaves the player's shark in the wading band
       (~6 m of water, where the beach buffet is), and a pod measured against
       it there never lands a blow: the orcas' own water mover keeps them off
       a shallow shelf, so the fight is decided by bathymetry rather than by
       anything this wave is about. Staged in honest open water instead. */
    {
      const A = CBZ.surv.arena, P = CBZ.player;
      const ang = Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0;
      const r = CBZ.sharkSim.waterline + 60;
      const px = A.center.x + Math.cos(ang) * r, pz = A.center.z + Math.sin(ang) * r;
      S.pos.x = px; S.pos.z = pz; P.pos.x = px; P.pos.z = pz;
      if (S._waterMove) { S._waterMove.x = px; S._waterMove.z = pz; }
      if (S.group) S.group.position.x = px, S.group.position.z = pz;
    }
    /* THE TRACE. Which of the pod's blows reach creature_combat's strike frame
       at all is the whole question a zero in the rams column cannot answer. */
    if (!window.__fightTrace) {
      const inner = CBZ.creatureFight;
      window.__fightTrace = { calls: 0, dealt: 0, missed: 0 };
      CBZ.creatureFight = function (att, tgt, dt, o) {
        const r = inner.apply(this, arguments);
        if (tgt === CBZ.sharkSim.shark) {
          const T = window.__fightTrace;
          T.calls++;
          if (r && r.dealt > 0) T.dealt++;
          if (r && r.missed) T.missed++;
        }
        return r;
      };
    }
    window.__fightTrace.calls = window.__fightTrace.dealt = window.__fightTrace.missed = 0;
    if (CBZ.marineAuditReset) CBZ.marineAuditReset();
    if (CBZ.biteAngleAuditReset) CBZ.biteAngleAuditReset();
    /* AN ARENA, NOT A TELEPORT LOOP. First run of this section measured four
       orcas ending the fight 200-336 m away with hunts:1 — they had not
       failed to attack the player, they had gone off to mob OTHER apex
       animals in the same sea (§3 scores a MOB target three times a snack and
       there were several on offer). So the only staging here is SUBTRACTION:
       every aquatic animal that is not one of these four orcas or the
       player's shark leaves, and what is left is the one fight. Nothing about
       the pod's own behaviour is scripted after that. */
    for (const a of (CBZ.cityWildlife || [])) {
      if (a.dead || !a.species || a === S) continue;
      if (a.species.id === "orca") continue;
      if (!a.species.aquatic) continue;
      // BEYOND FIGHT_R (1400 m), not merely out of sense range: §3 keeps a
      // fight it has already started running out to 1400 m, so a pod parked
      // at 900 m is a pod that chases — measured, four kills' worth.
      a.pos.x += 3000; a.hunger = 0;
      if (a._mp) { a._mp.target = null; a._mp.kind = 0; }
      if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
      if (a.group) a.group.position.x = a.pos.x;
    }
    let orcas = 0;
    const want = 4;
    for (const a of (CBZ.cityWildlife || [])) {
      if (a.dead || !a.species || a.species.id !== "orca") continue;
      if (orcas >= want) continue;
      const th = (orcas / want) * 6.283;
      a.pos.x = S.pos.x + Math.cos(th) * 26; a.pos.z = S.pos.z + Math.sin(th) * 26;
      a.pos.y = S.pos.y;
      if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
      if (a.group) a.group.position.set(a.pos.x, a.pos.y, a.pos.z);
      a.hunger = 1; a.hp = a.maxHp || a.species.hp; orcas++;
      // and drop whatever it was already chasing, or it leaves to finish it
      if (a._mp) { a._mp.target = null; a._mp.kind = 0; a._mp.scanT = 0; }
    }
    while (orcas < want && CBZ.cityWildlifeSpawnAt) {
      const th = (orcas / want) * 6.283;
      const o = CBZ.cityWildlifeSpawnAt("orca", S.pos.x + Math.cos(th) * 26, S.pos.z + Math.sin(th) * 26);
      if (!o) break;
      o.hunger = 1; orcas++;
    }
    const hp0 = S.hp;
    let died = 0;
    for (let i = 0; i < ${POD_SEC} * 30; i++) {
      CBZ.stepSim(1 / 30);
      if (S.dead || S.hp <= 0) { died = 1; S.hp = S.maxHp; S.dead = false; }
    }
    const M = CBZ.marineAudit ? CBZ.marineAudit() : {};
    const B = CBZ.biteAngleAudit ? CBZ.biteAngleAudit() : {};
    // WHY, not just WHETHER. A zero in this table is worth nothing without the
    // state that produced it, so every gate the pod passes through is read
    // back off the live actors on the last frame.
    const who = [];
    for (const a of (CBZ.cityWildlife || [])) {
      if (a.dead || !a.species || a.species.id !== "orca") continue;
      const m = a._mp || {};
      who.push({ role: m.role, kind: m.kind, onShark: m.target === S,
        d: +Math.hypot(a.pos.x - S.pos.x, a.pos.z - S.pos.z).toFixed(1),
        tgt: m.target ? (m.target === S ? "SHARK" : (m.target.species && m.target.species.id)) : null,
        st: (a._hunt && a._hunt.st) || a.state || "",
        cool: +((a._hunt && a._hunt.cool) || 0).toFixed(1),
        senseR: +((a._mp && a._mp.opts && a._mp.opts.senseR) || -1).toFixed(0),
        hasMove: !!(a._mp && a._mp.opts && typeof a._mp.opts.move === "function"),
        vis: a.group ? a.group.visible : null,
        ramRun: +(m.ramRun || 0).toFixed(2), atkT: +(a._atkT || 0).toFixed(2),
        atkAnim: +(a._atkAnim == null ? -1 : a._atkAnim).toFixed(2),
        ramReady: !!(CBZ.marinePodRamReady && CBZ.marinePodRamReady(a, S)),
        podN: CBZ.marinePodCount ? CBZ.marinePodCount(a, S) : -1,
        need: CBZ.marinePodNeeded ? CBZ.marinePodNeeded(a, S) : -1 });
    }
    return JSON.stringify({ orcas: orcas, hp0: hp0, hpEnd: +S.hp.toFixed(1), playerDied: died,
      marine: M, fight: window.__fightTrace || null, who: who, angles: B });
  })()`));
  report.pod = pod;
  if (pod.err) say("  ! " + pod.err);
  else {
    const M = pod.marine || {};
    say(`  ${pod.orcas} orcas · hp ${pod.hp0} -> ${pod.hpEnd} · died ${pod.playerDied}`);
    say("  marineAudit: " + JSON.stringify(M));
    if (pod.fight) say(`  creatureFight on the shark: calls ${pod.fight.calls} strikes ${pod.fight.dealt} missed ${pod.fight.missed}`);
    for (const w of (pod.who || [])) say("  orca " + JSON.stringify(w));
    const b = pod.angles || {};
    const tot = b.contests || 0;
    const legal = (b.rear || 0) + (b.flank || 0);
    say(`  pod bites contested: ${tot}  rear ${b.rear || 0}  flank ${b.flank || 0}  face ${b.face || 0}  clash ${b.clash || 0}`);
    say(`  angle-legal (rear+flank) fraction: ${tot ? (legal / tot).toFixed(2) : "n/a"}   player answers ${b.answers || 0} (${b.answerDmg || 0} hp), denied ${b.denied || 0}`);
  }

  }
  report.ok = true;
} catch (e) {
  report.errors.push(String(e && e.message || e));
  say("FAILED: " + report.errors[report.errors.length - 1]);
} finally {
  if (OUT) {
    await mkdir(path.dirname(OUT), { recursive: true });
    await writeFile(OUT, JSON.stringify(report, null, 2));
    say("\nwrote " + OUT);
  }
  if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
  try { await rig.close(); } catch (e) {}
  process.exit(report.ok ? 0 : 1);
}

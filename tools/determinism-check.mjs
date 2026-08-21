#!/usr/bin/env node
/* tools/determinism-check.mjs — TWO CLIENTS, ONE SEED, THE SAME MATCH?

   Multiplayer is not a transport problem first. It is a DETERMINISM problem:
   before two machines can share a match of Natural Disaster Survival, the same
   seed and the same sequence of ticks have to produce the same island, the same
   disaster arc, the same wave and the same hundred bodies on both of them.
   Otherwise every design above it — lockstep, rollback, server-authoritative
   with client prediction — is building on sand, and the bug does not show up
   until two people are playing.

   This tool measures exactly that, and nothing else. It boots the game TWICE in
   two separate browser contexts, drives an IDENTICAL scripted match in each
   (same seed, same forced disaster order, same number of fixed-size ticks, no
   input), and fingerprints the world every FP_EVERY ticks:

     the player, every bot's position/hp/dead, the director's phase and
     intensity, the sea surge, which buildings have fallen, where the holes are

   Then it compares the two tapes and reports the FIRST tick where they differ
   and what differed. A divergence is a `Math.random()` in the world path (this
   repo's determinism law forbids it and core/seed.js is what to use instead),
   an iteration over an unordered set, or a system reading wall-clock time.

     node tools/determinism-check.mjs
     node tools/determinism-check.mjs --url disaster.html --ticks 3600
     node tools/determinism-check.mjs --json

   IT IS A MEASUREMENT, NOT A GATE, until it reads clean. Ratchet the number
   down; do not pretend it is zero. */
import { launch } from "./lib/cdp.mjs";

const argv = process.argv.slice(2);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const has = (f) => argv.includes(f);

const URL_REL = arg("--url", "disaster.html");
const SEED = arg("--seed", "90210");
const TICKS = +arg("--ticks", "2400");
const BOTS = arg("--bots", "24");
const FP_EVERY = +arg("--every", "60");
const JSON_OUT = has("--json");

/* THE SCRIPTED MATCH. Everything that could differ between two runs is pinned:
   the seed comes from the URL, the bot count is set before the reset, the
   disaster order is forced rather than shuffled, and the step is a fixed
   1/60 — the same contract a lockstep client would run under. */
const RUN = (ticks, bots) => `(async () => {
  /* STOP THE RENDER LOOP FIRST. The scripted match yields to the event loop
     every 180 ticks so the browser stays responsive — and every one of those
     yields let a real animation frame run, which drove the whole updater chain
     AGAIN with a wall-clock delta. So the two runs were being fed a different
     number of extra, differently-sized ticks depending on how fast each machine
     happened to be, and the tool was measuring its own harness. This is what
     made the answer jump between 60 and 360 ticks on identical code. */
  if (window.__stopRaf) window.__stopRaf();
  await new Promise(r => setTimeout(r, 250));
  CBZ.SURV_BOTS = ${bots};
  CBZ.modes.survival.reset(CBZ.game);
  /* PIN THE CLOCK. CBZ.now is seeded from performance.now(), so it carries how
     long the PAGE took to boot — a number that differs on every machine and
     every run. Anything keyed to absolute time (a think-slice phase, a sine on
     the clock) therefore diverges immediately even with every draw seeded. A
     lockstep client would run the sim off the tick counter, not the wall, so
     the scripted match pins the clock to the same value on both sides and
     measures what is left. What this exposes is real: whatever still differs
     after this is a draw that is not seeded. */
  CBZ.now = 1000000;
  if (CBZ.fixedStep) CBZ.fixedStep.tick = 0;
  CBZ.disasters.force("quake");
  const tape = [];
  const fp = () => {
    const p = CBZ.player, A = CBZ.surv.arena;
    let h = 2166136261 >>> 0;
    const mix = (v) => {
      const n = (Math.round((v || 0) * 1000) | 0) >>> 0;
      h ^= n & 255; h = Math.imul(h, 16777619) >>> 0;
      h ^= (n >>> 8) & 255; h = Math.imul(h, 16777619) >>> 0;
      h ^= (n >>> 16) & 255; h = Math.imul(h, 16777619) >>> 0;
    };
    mix(p.pos.x); mix(p.pos.y); mix(p.pos.z); mix(p.hp); mix(p.dead ? 1 : 0);
    const b = CBZ.bots || [];
    for (let i = 0; i < b.length; i++) {
      const a = b[i];
      mix(a.pos ? a.pos.x : 0); mix(a.pos ? a.pos.y : 0); mix(a.pos ? a.pos.z : 0);
      mix(a.hp); mix(a.dead ? 1 : 0);
    }
    mix(CBZ.waterSurge ? CBZ.waterSurge() : 0);
    const A2 = A && A.fragile ? A.fragile : [];
    let fallen = 0; for (let i = 0; i < A2.length; i++) if (A2[i].fallen) fallen++;
    mix(fallen);
    mix((CBZ.survHoles || []).length);
    return {
      h: h >>> 0,
      state: CBZ.disasters.state(), cur: CBZ.disasters.current(),
      px: Math.round(p.pos.x * 100) / 100, pz: Math.round(p.pos.z * 100) / 100,
      live: b.filter(a => !a.dead).length, fallen,
      surge: Math.round((CBZ.waterSurge ? CBZ.waterSurge() : 0) * 1000) / 1000,
      /* EVERY BODY, to the millimetre, so a divergence NAMES the actor and the
         axis instead of being a hash that differs. Cheap at the bot counts this
         tool runs; the hash above is what a hundred-bot match would compare. */
      bodies: b.map(a => [Math.round(a.pos.x * 1000), Math.round(a.pos.y * 1000),
                          Math.round(a.pos.z * 1000), Math.round(a.hp * 100), a.dead ? 1 : 0]),
      player: [Math.round(p.pos.x * 1000), Math.round(p.pos.y * 1000), Math.round(p.pos.z * 1000)],
      /* The crowd's own schedule state. When two clients disagree about which
         bots thought on which tick, this is the number that says so. */
      sched: CBZ.survBotAudit ? [CBZ.survBotAudit().frame, CBZ.survBotAudit().matchNo,
                                 CBZ.survBotAudit().seeded ? 1 : 0] : null,
    };
  };
  tape.push(Object.assign({ t: 0 }, fp()));
  for (let i = 1; i <= ${ticks}; i++) {
    CBZ.stepSim(1 / 60);
    if (i % ${FP_EVERY} === 0) tape.push(Object.assign({ t: i }, fp()));
    if (i % 180 === 0) await new Promise(r => setTimeout(r, 0));
  }
  return tape;
})()`;

async function runOnce(label) {
  const rig = await launch({ rafBudget: 1200 });
  try {
    await rig.open(URL_REL, `seed=${SEED}`);
    if (!await rig.wait("window.CBZ && CBZ.game && CBZ.stepSim", 120000)) throw new Error("engine never came up");
    const playing = await rig.wait(`(() => {
      if (CBZ.game.state === 'playing' && CBZ.game.mode === 'survival') return true;
      const mb = document.querySelector('.mode-btn[data-mode="survival"]'); if (mb) mb.click();
      const pb = document.getElementById('playBtn'); if (pb) pb.click();
      return CBZ.game.state === 'playing' && CBZ.game.mode === 'survival';
    })()`, 200000, 250);
    if (!playing) throw new Error("never entered a survival match");
    const tape = await rig.evl(RUN(TICKS, BOTS), true);
    if (!JSON_OUT) console.log(`  run ${label}: ${tape.length} samples over ${TICKS} ticks`);
    return tape;
  } finally { await rig.close(); }
}

const a = await runOnce("A");
const b = await runOnce("B");

const out = { url: URL_REL, seed: SEED, ticks: TICKS, samples: a.length, firstDivergence: null, matching: 0, detail: null };
for (let i = 0; i < Math.min(a.length, b.length); i++) {
  if (a[i].h === b[i].h) { out.matching++; continue; }
  out.firstDivergence = a[i].t;
  const AX = ["x", "y", "z", "hp", "dead"];
  const who = [];
  const ab = a[i].bodies || [], bb = b[i].bodies || [];
  for (let k = 0; k < Math.max(ab.length, bb.length); k++) {
    const x = ab[k] || [], y = bb[k] || [];
    for (let f = 0; f < 5; f++) if (x[f] !== y[f]) who.push(`bot${k}.${AX[f]} ${x[f]} vs ${y[f]}`);
  }
  for (let f = 0; f < 3; f++) {
    if (a[i].player[f] !== b[i].player[f]) who.push(`player.${AX[f]} ${a[i].player[f]} vs ${b[i].player[f]}`);
  }
  const SC = ["frame", "matchNo", "seeded"];
  if (a[i].sched && b[i].sched) {
    for (let f = 0; f < 3; f++) {
      if (a[i].sched[f] !== b[i].sched[f]) who.unshift(`sched.${SC[f]} ${a[i].sched[f]} vs ${b[i].sched[f]}`);
    }
  }
  out.detail = {
    tick: a[i].t,
    what: Object.keys(a[i]).filter((k) => k !== "h" && k !== "bodies" && k !== "player" &&
      JSON.stringify(a[i][k]) !== JSON.stringify(b[i][k])),
    who: who.slice(0, 12), diverged: who.length,
  };
  break;
}
out.deterministicThrough = out.firstDivergence == null ? TICKS : out.firstDivergence - FP_EVERY;

if (JSON_OUT) console.log(JSON.stringify(out, null, 1));
else {
  console.log("");
  console.log("  page              " + out.url + "  (seed " + out.seed + ", " + BOTS + " bots)");
  console.log("  identical for     " + out.deterministicThrough + " / " + TICKS + " ticks" +
    "  (" + (out.deterministicThrough / 60).toFixed(1) + " s of match)");
  if (out.firstDivergence == null) console.log("\n  DETERMINISM: two clients on this seed run the same match.");
  else {
    console.log("  first divergence  tick " + out.firstDivergence +
      (out.detail.what.length ? " — " + out.detail.what.join(", ") : "") +
      "  (" + out.detail.diverged + " values differ)");
    for (const w of out.detail.who) console.log("    " + w);
    console.log("\n  DETERMINISM: NOT YET. Something in the world path is not seeded.");
  }
}
process.exit(0);

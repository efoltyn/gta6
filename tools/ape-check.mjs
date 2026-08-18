#!/usr/bin/env node
/* tools/ape-check.mjs — DOES THE GORILLA ACTUALLY FIGHT LIKE A GORILLA?

   The claim this gate exists to hold: a silverback in games/battle.html used to
   have exactly one animated attack and it was a wolf's. `creatureStyleFor` put
   `gorilla` on the `maul` row, and the ATTACK arm of `maul` reaches
   predator_anim's `default:` branch, which opens a jaw and does nothing else.
   Against a hundred men that is a mouth on a treadmill.

   systems/ape_combat.js is the answer, and every part of it is countable
   through CBZ.apeAudit(). None of these numbers can be produced by narration:

     charges/smashes/sweeps/bites/drums   the move set FIRED, not merely
                                          defined. A repertoire that never
                                          gets picked is a table, not a fight.
     grabs                                the ape took a man off his feet.
     spins                                the hold reached the flail.
     clubHits                             ...and the man in its hand HIT other
                                          men. This is the whole feature: a
                                          body used as a weapon. Zero here
                                          means the club swung through empty
                                          air every time, which is the fault
                                          this file cannot be allowed to ship.
     throws + slams                       every grab RESOLVED. A hold that
                                          never releases is a man welded to a
                                          fist for the rest of the run.
     stranded                             men left flagged _apeHeld/_apeFlying
                                          with no live hold behind them. MUST
                                          be 0: that flag stands the host's own
                                          mover down, so a stale one is an
                                          immortal statue in the middle of the
                                          war.
     sunk                                 held/flown bodies that ended up below
                                          the ground they landed on.

   And the reverts have to work, because a feature that cannot be turned off
   has not been measured:
     --revert   CBZ.CONFIG.APE_FLAIL = false  -> grabs MUST fall to 0 while the
                rest of the move set keeps firing (the flail is separable).
     --off      CBZ.CONFIG.APE_COMBAT = false -> the whole set goes quiet and
                the gorilla is exactly the maul it always was.

   Usage:
     node tools/ape-check.mjs                    100 men v 1 gorilla, arena
     node tools/ape-check.mjs --n 60 --seconds 50
     node tools/ape-check.mjs --map city
     node tools/ape-check.mjs --revert           the flail switch
     node tools/ape-check.mjs --off              the whole-file switch
     node tools/ape-check.mjs --keep             leave chrome up
   Exit 0 = ok.                                                              */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };

const MAP = arg("--map", "arena");
const N = parseInt(arg("--n", "100"), 10);
const SECONDS = parseInt(arg("--seconds", "70"), 10);
const SPEED = arg("--speed", "4");
const REVERT = has("--revert");     // flail off, move set on
const OFF = has("--off");           // everything off

async function claimPort(lo, n, probe) {
  for (let p = lo; p < lo + n; p++) { try { await probe(p); } catch (_) { return p; } }
  throw new Error("no free port");
}

const REMOTE = arg("--url", "");
let server = { kill() {} };
let origin;
if (REMOTE) {
  origin = REMOTE.endsWith("/") ? REMOTE : REMOTE + "/";
  try { await fetch(origin); } catch (e) { console.error("APE: FAIL cannot reach " + origin); process.exit(1); }
} else {
  const port = await claimPort(9840, 150, (p) => fetch(`http://127.0.0.1:${p}/`));
  server = spawn("python3", [path.join(ROOT, "tools/devserver.py")],
    { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  origin = `http://127.0.0.1:${port}/`;
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { try { await fetch(origin); up = true; } catch (_) { await sleep(100); } }
  if (!up) { console.error("APE: FAIL devserver never came up"); process.exit(1); }
}

const dbg = await claimPort(11080, 200, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profile = `/tmp/cbz-apecheck-${dbg}`;
await rm(profile, { recursive: true, force: true });
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=900,560",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: "ignore" });

let target = null;
for (let i = 0; i < 240 && !target; i++) {
  try {
    const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
    target = ps.find((p) => p.type === "page");
  } catch (_) {}
  if (!target) await sleep(100);
}
const bye = (code, msg) => {
  if (msg) console.log(msg);
  if (!has("--keep")) chrome.kill("SIGTERM");
  server.kill("SIGTERM");
  process.exit(code);
};
if (!target) bye(1, "APE: FAIL no page");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pend = new Map(); let errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errors.push(`${(d.url || "?").split("/").pop()}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`);
  } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 200));
  }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return { __throw: r.result.exceptionDetails.text };
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable");
await send("Page.enable");

/* WHY THIS SWEEPS BATTLES INSTEAD OF WATCHING ONE.

   Measured, and it is the single most important fact about this matchup: a
   gorilla gets THREE TO FIVE SWINGS IN ITS ENTIRE LIFE. The arena's armies
   start 120 m apart and a silverback closes at 5.5 m/s, so ~15 of the war's
   23 seconds are a march; then sixty unarmed men reach it at once and 260 hp
   is gone in about four. That is not something this file introduced — run the
   same sweep with `--off` and the war ends at the same second with the same
   survivors — it is what the shipped gorilla has always been, and it is why
   "the gorilla has no real attacks" was a fair complaint.

   One battle therefore samples three or four picks, and no honest assertion
   about a six-move repertoire can be made from three picks. So the gate runs
   the matchup REPEATEDLY and accumulates, exactly the way battle-check sweeps
   maps rather than trusting one. The per-battle counters are reset between
   runs by the page reload; the totals below are the sum. */
const RUNS = parseInt(arg("--runs", "10"), 10);
const T = { picks: 0, fanHits: 0, grabs: 0, spins: 0, clubHits: 0, throws: 0, slams: 0, drops: 0,
  sweeps: 0, smashes: 0, charges: 0, drums: 0, bites: 0 };
let strandedEver = 0, sunkEver = 0, ended = 0, bootMs = 0, samples = 0;
let audit = null, tail = null, A = null;
const fails = [];
let present = null, isApe = null;
const perRun = [];

for (let run = 0; run < RUNS; run++) {
  /* THE MATCHUP THE PAGE'S OWN MENU CALLS "100 MEN v GORILLA": unarmed
     civilians against one silverback. Nothing here is a special test rig — it
     is the preset row in games/battle.html's MATCHUPS table, expressed as the
     query string that row fills in. */
  const url = `${origin}games/battle.html?auto=1&map=${MAP}&red=${N}&blue=1` +
    `&ru=men&bu=gorilla&rw=fists&rt=civ`;
  errors = errors.concat([]);
  await send("Page.navigate", { url });
  await sleep(500);

  let up = false;
  const t0 = Date.now();
  for (let i = 0; i < 400 && !up; i++) {
    up = await evl("!!(window.__battle && __battle.audit().started)");
    if (up !== true) { up = false; await sleep(250); }
  }
  if (run === 0) bootMs = Date.now() - t0;
  if (!up) { fails.push(`run ${run + 1}: the battle never started`); continue; }

  if (run === 0) {
    // the file has to BE there before anything it does can be measured
    present = await evl("!!(window.CBZ && CBZ.apeAudit && CBZ.apeStep && CBZ.apeMove && CBZ.apeStrike)");
    if (present !== true) bye(1, "APE: FAIL systems/ape_combat.js is not loaded on games/battle.html (studio pack `beasts`)");
    isApe = await evl("!!(CBZ.apeIs && CBZ.apeIs({ species: (CBZ.WILDLIFE_SPECIES||{}).gorilla }))");
    if (isApe !== true) bye(1, "APE: FAIL the gorilla species row does not classify as an ape");
  }

  if (OFF) await evl("CBZ.CONFIG.APE_COMBAT = false");
  else if (REVERT) await evl("CBZ.CONFIG.APE_FLAIL = false");

  await evl(`__battle.speed(${SPEED})`);

  /* WATCH IT. apeAudit ACCUMULATES within a battle, so one read at the end is
     enough for the counters — but `stranded` is an INSTANTANEOUS property and
     has to be sampled throughout: a body correctly held for two seconds is not
     a fault and a body still flagged after every hold ended is. */
  const t1 = Date.now();
  let over = false;
  while ((Date.now() - t1) / 1000 < SECONDS) {
    await sleep(900);
    samples++;
    const s = await evl(`(function () {
      var A = CBZ.apeAudit();
      var men = (window.__battle && __battle.roster) ? __battle.roster() : null;
      var stranded = 0, sunk = 0;
      if (men) for (var i = 0; i < men.length; i++) {
        var m = men[i];
        if (!m) continue;
        if ((m._apeHeld || m._apeFlying) && A.holds + A.flying === 0) stranded++;
        if ((m._apeHeld || m._apeFlying) && m.pos && CBZ.floorAt &&
            m.pos.y < CBZ.floorAt(m.pos.x, m.pos.z) - 0.6) sunk++;
      }
      return { stranded: stranded, sunk: sunk };
    })()`);
    if (s && !s.__throw) { strandedEver = Math.max(strandedEver, s.stranded | 0); sunkEver = Math.max(sunkEver, s.sunk | 0); }
    const a = await evl("__battle.audit()");
    if (a && a.over) { over = true; break; }
  }
  if (over) ended++;

  // one settling beat so a hold that was mid-release when the war ended can finish
  await sleep(900);
  A = await evl("CBZ.apeAudit()");
  audit = await evl("__battle.audit()");
  tail = await evl(`(function () {
    var men = (window.__battle && __battle.roster) ? __battle.roster() : null;
    var flagged = 0;
    if (men) for (var i = 0; i < men.length; i++) if (men[i] && (men[i]._apeHeld || men[i]._apeFlying)) flagged++;
    var a = CBZ.apeAudit();
    return { flagged: flagged, holds: a.holds, flying: a.flying };
  })()`);
  if (A && !A.__throw) for (const k in T) T[k] += (A[k] | 0);
  perRun.push({ run: run + 1, simT: audit && audit.simT, red: audit && audit.red,
    apes: audit && audit.beasts, picks: A && A.picks, grabs: A && A.grabs, club: A && A.clubHits });
  if (tail && tail.flagged > 0 && tail.holds + tail.flying === 0) {
    fails.push(`run ${run + 1}: ${tail.flagged} men left flagged after every hold ended — they can never move again`);
  }
}

/* ---- THE ANSWER CONTRACT ------------------------------------------------
   The one bug in this whole feature that no counter above can see. apeStrike
   returns either a NUMBER ("I consumed this strike") or `null` ("the primary
   mark is still yours, I only did the splash"). Every hitting move must answer
   `null`, because in the city the driver's `opts.onHit` IS the player's damage
   and the target handed in is a decoy that can never appear in CBZ.worldActors
   — a hitting move that swallowed the strike would make a gorilla unable to
   hurt the player at all, and battle.html would score identically either way
   because it routes hurtWorldActor straight back into its own hurtMan.
   Only the grab and the chest beat may consume. Probed on a FRESH page so the
   splash it deals cannot contaminate the sweep's totals above. ---------- */
let contract = null;
if (!OFF) {
  await send("Page.navigate", { url: `${origin}games/battle.html?auto=1&map=${MAP}&red=20&blue=1&ru=men&bu=gorilla&rw=fists&rt=civ` });
  let cUp = false;
  for (let i = 0; i < 400 && !cUp; i++) {
    cUp = await evl("!!(window.__battle && __battle.audit().started)");
    if (cUp !== true) { cUp = false; await sleep(250); }
  }
  if (!cUp) fails.push("contract probe: the battle never started");
  else {
    contract = await evl(`(function () {
      var men = __battle.roster(), menAll = men, ape = null, man = null;
      for (var i = 0; i < men.length; i++) {
        if (men[i].beast && !men[i].dead) ape = men[i];
        else if (!men[i].dead && !man) man = men[i];
      }
      if (!ape || !man) return { __e: "no ape/man" };
      // put the mark inside the arms so the move actually resolves
      man.pos.x = ape.pos.x + 1.4; man.pos.z = ape.pos.z;
      var o = { reach: ape.reach, dmg: 10 }, out = {};
      ["ape_charge", "ape_smash", "ape_sweep", "ape_bite"].forEach(function (st) {
        var r;
        try { r = CBZ.apeStrike(ape, man, st, o, 10); } catch (e) { r = "threw: " + e; }
        out[st] = (r === null || r === undefined) ? "null" : String(r);
      });
      /* ...and the two that MAY consume. The four probes above deliberately
         apply the real knockback to the mark, which flags him airborne — and
         grabbable() correctly refuses a body that is already in the air. Put
         him back on his feet in front of the ape before asking for the grab,
         or the probe measures its own side effect. */
      man._apeFlying = 0; man._apeHeld = null; man.dead = false;
      if (man.hp <= 0) man.hp = man.maxHp || 90;
      man.pos.x = ape.pos.x + 1.4; man.pos.z = ape.pos.z;
      man.pos.y = ape.pos.y;
      ape._apeSwings = 9; ape._apeGrabT = -999;
      var g; try { g = CBZ.apeStrike(ape, man, "ape_grab", o, 10); } catch (e) { g = "threw: " + e; }
      out.ape_grab = (g === null || g === undefined) ? "null" : String(g);
      var d; try { d = CBZ.apeStrike(ape, man, "ape_drum", o, 10); } catch (e) { d = "threw: " + e; }
      out.ape_drum = (d === null || d === undefined) ? "null" : String(d);

      /* CAN THE PICKER EVEN REACH ALL SIX? Asked here, deterministically, and
         NOT inferred from what happened to come up in the sweep. A gorilla only
         lives for two or three blows, so "did every move fire in ten battles"
         is a question about dice as much as about code — and it has already
         produced a green run with the chest beat at zero. Four hundred draws
         with a thick crowd in front of it answers the LOGIC question the sweep
         cannot: is any branch unreachable by construction (which is exactly the
         bug the one-random-against-a-descending-chain build had, and which no
         amount of battle sampling would have named). */
      // the grab probe above left a live hold, and apeMove correctly refuses to
      // choose anything while one runs — clear it or this loop measures that
      try { CBZ.apeReset(); } catch (e) {}
      man._apeHeld = null; man._apeFlying = 0; man.dead = false;
      if (!(man.hp > 0)) man.hp = man.maxHp || 90;
      man.pos.x = ape.pos.x + 1.4; man.pos.z = ape.pos.z;
      /* AND IT NEEDS A CROWD IN FRONT OF IT. The grab and the chest beat are
         both gated on bodies being inside the arms, and the strike probes above
         have just launched everyone who was — so without this the loop measures
         an empty field and reports two branches "unreachable" that are simply
         not applicable. Stand six of them back up in a ring at arm's length. */
      var ring = 0;
      for (var w = 0; w < menAll.length && ring < 6; w++) {
        var rm = menAll[w];
        if (rm === ape || rm === man || rm.beast) continue;
        rm.dead = false; rm._apeFlying = 0; rm._apeHeld = null;
        if (!(rm.hp > 0)) rm.hp = rm.maxHp || 90;
        var a2 = (ring / 6) * 6.283;
        rm.pos.x = ape.pos.x + Math.cos(a2) * 2.0;
        rm.pos.z = ape.pos.z + Math.sin(a2) * 2.0;
        ring++;
      }
      var seen = {};
      for (var n = 0; n < 400; n++) {
        ape._apeSwings = (n % 5);          // walk both sides of the swing gates
        ape._atkT = 1; ape._apeGrabT = -999; ape._apeDrumT = -999;
        ape.hp = (n % 7 === 0) ? ape.maxHp * 0.3 : ape.maxHp;   // and the hurt branch
        var st = null;
        try { st = CBZ.apeMove(ape, man, o, 1.4, ape.reach); } catch (e) { st = "threw: " + e; }
        if (st) seen[st] = (seen[st] || 0) + 1;
      }
      out.__reach = seen;
      return out;
    })()`);
    if (!contract || contract.__e || contract.__throw) {
      fails.push("contract probe: " + JSON.stringify(contract));
    } else {
      ["ape_charge", "ape_smash", "ape_sweep", "ape_bite"].forEach((st) => {
        if (contract[st] !== "null") {
          fails.push(`${st} CONSUMED the strike (returned ${contract[st]}) — opts.onHit never runs, so a gorilla cannot hurt the player`);
        }
      });
      if (contract.ape_grab === "null") fails.push("ape_grab did not consume the strike — the hold is not taking the beat");
      if (contract.ape_drum !== "0") fails.push(`ape_drum returned ${contract.ape_drum} — the display must consume and cost nothing`);
      const reach = contract.__reach || {};
      for (const st of ["ape_charge", "ape_smash", "ape_sweep", "ape_bite", "ape_grab", "ape_drum"]) {
        if (!(reach[st] > 0)) fails.push(`the picker never once chose ${st} in 400 draws — that branch is unreachable`);
      }
    }
  }
}

const clean = errors.filter((e) => !/ProgressEvent|favicon|preload/i.test(e));

/* THE TOTALS, not the last battle's. `T` is the sum across every run in the
   sweep — the only number that can honestly answer "does this repertoire
   fire", given a gorilla only lives long enough for three or four swings. */
if (!A || A.__throw) fails.push("apeAudit() threw");
else if (OFF) {
  /* THE WHOLE-FILE REVERT. Nothing may fire, and — the part that actually
     matters — the battle must still run: a gorilla with ape_combat off is the
     `maul` it has always been, not a broken one. */
  const fired = T.picks + T.grabs + T.spins + T.sweeps + T.smashes + T.charges + T.drums + T.bites;
  if (fired > 0) fails.push(`--off: APE_COMBAT=false and ${fired} ape moves still fired`);
  if (!(audit && audit.simT > 8)) fails.push("--off: the battle did not run with the move set disabled");
  if (ended === 0) fails.push("--off: no battle ever reached a result with the move set disabled");
} else if (REVERT) {
  /* THE FLAIL REVERT. The club is separable from the rest of the repertoire —
     if turning it off also silences the charges and the backhands, the two are
     tangled and the switch is a lie. */
  if (T.grabs > 0) fails.push(`--revert: APE_FLAIL=false and the ape still grabbed ${T.grabs} men`);
  if (T.clubHits > 0) fails.push(`--revert: APE_FLAIL=false and ${T.clubHits} club hits still landed`);
  const rest = T.sweeps + T.smashes + T.charges + T.bites;
  if (rest === 0) fails.push("--revert: turning the flail off silenced the WHOLE move set — they are tangled");
} else {
  /* THE REAL SWEEP. Every one of these is the difference between a feature and
     a paragraph about a feature. */
  if (T.picks === 0) fails.push("the driver never once asked the ape to choose a blow");
  if (T.grabs === 0) fails.push(`the gorilla never picked anybody up across ${RUNS} battles`);
  /* AND YOU HAVE TO ACTUALLY SEE IT. This is the assertion the whole feature
     lives or dies on, and it is here because the owner reported the failure in
     exactly these words: "I didn't see the gorilla spinning around". Every
     counter above was green at the time — the flail worked perfectly and
     happened in four of ten battles for about a second and a half of a
     twenty-second war, so a person watching one battle most likely never saw
     it. A feature you cannot encounter has not shipped, so the rate is gated
     like any other number: a battle that finishes without a single grab is the
     failure being measured, and no more than a quarter of them may. */
  /* THE FLAIL IS BOUNDED ON BOTH SIDES, and both bounds are owner reports that
     pull directly against each other:

       "I didn't see the gorilla spinning around"  — it was happening in four
           battles of ten for a second and a half of a twenty-second war. Too
           rare is indistinguishable from absent.
       "that isn't gorillas only move but it should be a move"  — chasing the
           first note took it to half of every blow the animal threw, which is
           not a repertoire, it is a default with five decorations.

     They trade directly: a gorilla lives for about three blows, so every point
     of probability is BOTH the grab's share of the move set and its chance of
     showing up at all. Asserting only one of them is how this went wrong twice
     — once in each direction — so both are gated here and the tuning has to
     land in the corridor between them. */
  const dry = perRun.filter((r) => !(r.grabs > 0)).length;
  if (dry > Math.ceil(RUNS * 0.3)) {
    fails.push(`${dry} of ${RUNS} battles finished without a single grab — at that rate a person watching one war never sees the flail`);
  }
  const share = T.picks ? T.grabs / T.picks : 0;
  if (share > 0.4) {
    fails.push(`the grab is ${Math.round(share * 100)}% of every blow the gorilla throws — that is its default, not one of six moves`);
  }
  if (T.spins === 0) fails.push("a grab never reached the flail — nothing was ever swung");
  if (T.clubHits === 0) fails.push("the swung body never hit anyone: the club is decoration");
  /* EVERY GRAB MUST END. Not every grab ends in a FINISHER — an ape that dies
     with a man in its hand is a legitimate and common outcome, counted as a
     `drop` — but `grabs` and `drops + throws + slams` have to agree, because a
     hold that ends neither way is a man welded to a corpse's fist forever.
     (`- 1` allows exactly one hold still live in the final sample.) */
  const resolved = T.throws + T.slams + T.drops;
  if (resolved < T.grabs - 1) {
    fails.push(`${T.grabs} grabs but only ${resolved} ended — holds are leaking`);
  }
  /* AND AT LEAST ONE MUST REACH A FINISHER. Guarded by the sample size on
     purpose: a hold ends in a throw, a slam, or a drop (the ape dying with a
     man still in its hand, which is the commonest outcome in a losing fight),
     so a sweep that only produced two grabs can legitimately show zero
     finishers and prove nothing either way. Saying INCONCLUSIVE is the honest
     answer there — silently passing a sample too small to fail is how a gate
     stops being one. */
  if (T.grabs < 3) {
    fails.push(`only ${T.grabs} grabs across ${RUNS} battles — too small a sample to test the release path at all; raise --runs`);
  } else if (T.throws + T.slams === 0) {
    fails.push(`${T.grabs} grabs and not one reached a throw or a slam — the release code has never run`);
  }
  // the repertoire has to be a repertoire. Two of the five non-grab moves
  // firing is a coin; four is a move set.
  /* AND THEY HAVE TO HAPPEN IN A REAL FIGHT, not merely be reachable. Held at
     3 of 5 rather than 4 on purpose: a gorilla gets two or three blows in its
     life and half of them are now the grab, so demanding every move appear in
     one ten-battle sweep is a coin flip, and a gate that flips is not a gate.
     The `unreachable branch` failure — the real one, the one the single-random
     chain caused — is caught deterministically by the 400-draw probe above.
     This one only has to prove the picker is not jammed on one answer in play. */
  const kinds = [T.sweeps, T.smashes, T.charges, T.bites, T.drums].filter((n) => n > 0).length;
  if (kinds < 3) fails.push(`only ${kinds} of the 5 non-grab moves fired in ${RUNS} real battles — the picker is jammed`);
}

if (strandedEver > 0) fails.push(`${strandedEver} bodies flagged _apeHeld with no live hold behind them`);
if (sunkEver > 0) fails.push(`${sunkEver} held/flown bodies went under the ground`);
if (tail && tail.flagged > 0 && tail.holds + tail.flying === 0) {
  fails.push(`${tail.flagged} men left flagged after every hold ended — they can never move again`);
}
if (clean.length) fails.push(`${clean.length} console errors — ${clean[0]}`);

const row = {
  map: MAP, men: N, bootMs, ended, simT: audit && audit.simT, fps: audit && audit.fps,
  redAlive: audit && audit.red, apesAlive: audit && audit.beasts,
  mode: OFF ? "APE_COMBAT=false" : REVERT ? "APE_FLAIL=false" : "live",
  runs: RUNS, endedRuns: ended, samples, strandedEver, sunkEver, contract,
  totals: T, perRun,
};
console.log(JSON.stringify(row, null, 2));

if (fails.length) {
  console.log("\nAPE: FAIL");
  for (const f of fails) console.log("  - " + f);
  bye(1, "");
}
bye(0, "APE: ok  " +
  (OFF ? `(whole move set disabled, ${ended}/${RUNS} battles still reached a result)`
    : REVERT ? `(flail off; ${T.sweeps + T.smashes + T.charges + T.bites} other ape moves still fired)`
      : `${RUNS} battles · ${T.picks} blows chosen · grabs ${T.grabs} · spins ${T.spins} · club hits ${T.clubHits} · ` +
        `throws ${T.throws} · slams ${T.slams} · dropped ${T.drops} · sweeps ${T.sweeps} · smashes ${T.smashes} · ` +
        `charges ${T.charges} · bites ${T.bites} · drums ${T.drums}`));

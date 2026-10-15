#!/usr/bin/env node
/* tools/disaster-pacing-check.mjs — does the disaster island PACE itself?

   Owner, 2026-10-15: "There needs to be a time of no disaster between each;
   right now they overlap, which is dumb. Some should overlap, like
   earthquake to tsunami or earthquake to volcano."

   Boots a real match (default disaster.html), lets the REAL director run for
   --mins minutes of sim time (fixed-step CBZ.stepSim, the player kept alive
   so the round never stops on a death screen) and prints its own timeline
   (CBZ.disasters.timeline()): every disaster's warn / active / end second,
   the calm after it and when the island was actually quiet, and which links
   were chains. Then it stages one chain per causal link through
   CBZ.disasters.chainNow (the same hand-off path the defs use) so the
   chained beats show even when the seed's dice did not roll one.

   ASSERTS, per adjacent pair of rounds:
     - a non-chained disaster's warning starts only after the previous round
       ended AND the calm ran (>= SURV_CALM_MIN), and after the world went
       quiet (nothing still fading)
     - a chained link starts within a few seconds of its cause's end
     - nothing had to be cut at the end of a calm (a system that cannot fade
       inside the calm is a bug in that system)

     node tools/disaster-pacing-check.mjs                 # 10 min, disaster.html
     node tools/disaster-pacing-check.mjs --mins 4 --seed 7 --url index.html
*/
import { launch } from "./lib/cdp.mjs";

const argv = process.argv.slice(2);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const URL_REL = arg("--url", "disaster.html");
const SEED = arg("--seed", "90210");
const MINS = +arg("--mins", "10");
const STEP = 1 / 30;
const NO_CHAINS = argv.includes("--no-chains");

const fails = [];
const rig = await launch({ rafBudget: 1600 });
let tl = [], chains = [], calmMin = 12, endState = null;
try {
  await rig.open(URL_REL, `seed=${SEED}`);
  if (!await rig.wait("window.CBZ && CBZ.game", 150000)) throw new Error("page never published window.CBZ");
  const playing = await rig.wait(`(() => {
    if (CBZ.game.state === 'playing' && CBZ.game.mode === 'survival') return true;
    const mb = document.querySelector('.mode-btn[data-mode="survival"]'); if (mb) mb.click();
    const pb = document.getElementById('playBtn'); if (pb) pb.click();
    return CBZ.game.state === 'playing' && CBZ.game.mode === 'survival';
  })()`, 300000, 250);
  if (!playing) throw new Error("never entered a survival match");
  rig.clearErrors();
  calmMin = await rig.evl("CBZ.CONFIG.SURV_CALM_MIN");

  // ---- the natural run --------------------------------------------------
  const steps = Math.round(MINS * 60 / STEP);
  endState = await rig.evl(`(async () => {
    const p = CBZ.player, D = CBZ.disasters;
    const keep = () => { if (!p.dead) p.hp = Math.max(p.hp, 100); };
    for (let i = 0; i < ${steps}; i++) {
      keep(); CBZ.stepSim(${STEP});
      if (i % 120 === 0) await new Promise(r => setTimeout(r, 0));
    }
    return { state: D.state(), pace: D.pace(), round: D.round(), alive: CBZ.surv.aliveCount(), playerDead: !!p.dead };
  })()`, true);
  tl = await rig.evl("CBZ.disasters.timeline()");

  // ---- the chains, staged through the defs' own hand-off ------------------
  if (!NO_CHAINS) {
    const LINKS = [["quake", "flood", { st: { chainBearing: 0.7 } }], ["quake", "volcano", {}], ["volcano", "wildfire", {}],
      ["hurricane", "flashflood", {}], ["meteor", "flood", { st: { chainBearing: 2.4 } }]];
    for (const [a, b, o] of LINKS) {
      const r = await rig.evl(`(async () => {
        const D = CBZ.disasters, p = CBZ.player;
        CBZ.modes.survival.reset(CBZ.game);
        if (!D.force(${JSON.stringify(a)})) return { forced: false };
        let staged = false, guard = 0;
        // into the cause's active phase, a few seconds, then hand off
        while (D.state() !== 'active' && guard++ < 1200) { CBZ.stepSim(${STEP}); }
        for (let i = 0; i < 90; i++) CBZ.stepSim(${STEP});
        staged = D.chainNow(${JSON.stringify(b)}, ${JSON.stringify(o)});
        // through the effect to its end and the calm after it
        guard = 0;
        let sawEffect = false;
        while (guard++ < 6000) {
          if (!p.dead) p.hp = Math.max(p.hp, 100);
          CBZ.stepSim(${STEP});
          if (D.currentId() === ${JSON.stringify(b)}) sawEffect = true;
          if (sawEffect && D.state() === 'idle' && D.pace().calm) break;
          if (guard % 120 === 0) await new Promise(r => setTimeout(r, 0));
        }
        return { forced: true, staged, sawEffect, tl: D.timeline().slice(-4), round: D.round() };
      })()`, true);
      chains.push({ from: a, to: b, ...r });
    }
  }
  const errs = rig.errors.slice(0, 10);
  if (errs.length) fails.push(errs.length + " page errors (" + errs[0] + ")");
} catch (e) {
  fails.push(String((e && e.message) || e));
} finally {
  await rig.close();
}

// ---- the printout + the assertions ----------------------------------------
const f1 = (v) => (v == null ? "  -  " : (+v).toFixed(1).padStart(6));
console.log("");
console.log(`  DIRECTOR TIMELINE  ${URL_REL}  seed ${SEED}  ${MINS} min sim  (seconds of director time)`);
console.log("  rnd  disaster     chain-from   warn   active    end    calm  quiet   gap-before  note");
let prev = null;
for (const r of tl) {
  let gap = null, note = "";
  if (prev && prev.endAt != null) {
    gap = r.warnAt - prev.endAt;
    if (r.chainFrom) {
      note = "CHAIN " + r.chainFrom + " > " + r.id;
      if (prev.chainTo !== r.id) fails.push(`round ${r.round}: ${r.id} says chained from ${r.chainFrom} but the previous round did not hand off to it`);
      if (gap > 4) fails.push(`round ${r.round}: chained ${r.id} started ${gap.toFixed(1)} s after its cause ended`);
    } else {
      if (prev.quietAt == null) fails.push(`round ${r.round}: ${r.id} warned before ${prev.id}'s calm finished`);
      else if (r.warnAt < prev.quietAt - 0.05) fails.push(`round ${r.round}: ${r.id} warned at ${r.warnAt} before the island was quiet (${prev.quietAt})`);
      if (gap < calmMin - 0.05) fails.push(`round ${r.round}: only ${gap.toFixed(1)} s between ${prev.id} ending and ${r.id} warning (calm min ${calmMin})`);
    }
    if (r.warnAt < prev.endAt - 0.05) fails.push(`round ${r.round}: ${r.id} overlaps ${prev.id}`);
  }
  if (r.cut && r.cut.length) { note += (note ? "; " : "") + "CUT " + r.cut.join(","); fails.push(`${r.id}: the calm had to cut ${r.cut.join(", ")}`); }
  if (r.chainTo) note += (note ? "; " : "") + "hands off to " + r.chainTo;
  console.log(`  ${String(r.round).padStart(3)}  ${r.id.padEnd(12)} ${(r.chainFrom || "").padEnd(10)} ${f1(r.warnAt)} ${f1(r.activeAt)} ${f1(r.endAt)} ${f1(r.calm)} ${f1(r.quietAt)}   ${f1(gap)}      ${note}`);
  prev = r;
}
if (!tl.length) fails.push("the director logged nothing");
if (endState) console.log(`\n  after ${MINS} min: state ${endState.state}, round ${endState.round}, ${endState.alive} alive, busy [${(endState.pace.busy || []).join(", ")}]`);

if (chains.length) {
  console.log("\n  STAGED CHAINS (CBZ.disasters.chainNow, the defs' own hand-off path)");
  for (const c of chains) {
    // the cause and its effect (the effect may chain on again: quake > volcano > wildfire)
    const T = c.tl || [], bi = T.findIndex((r) => r.id === c.to && r.chainFrom === c.from);
    const a = bi > 0 ? T[bi - 1] : null, b = bi > 0 ? T[bi] : null;
    const ok = c.forced && c.staged && c.sawEffect && a && b && b.chainFrom === c.from && b.round === a.round;
    console.log(`  ${(c.from + " > " + c.to).padEnd(22)} ${ok ? "linked" : "BROKEN"}` +
      (a && b ? `   ${a.id} ${f1(a.warnAt)}-${f1(a.endAt)}  ->  ${b.id} warn ${f1(b.warnAt)} active ${f1(b.activeAt)} end ${f1(b.endAt)} (same round ${b.round === a.round}; gap ${(b.warnAt - a.endAt).toFixed(1)} s)` : ""));
    if (!ok) fails.push(`chain ${c.from} > ${c.to} did not run as one linked round`);
  }
}
console.log("");
if (!fails.length) console.log("  DISASTER-PACING: ok");
else { console.log("  DISASTER-PACING: FAIL"); for (const f of fails) console.log("    - " + f); }
process.exit(fails.length ? 1 : 0);

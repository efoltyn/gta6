"use strict";
/* src/battle/bench.js — NPC War: BENCH.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ BENCH
   The honest answer to "how many". Everybody is unkillable so the census
   is exact; every few seconds the measured frame rate decides whether two
   more platoons walk on. When it dips under 30 twice, the last size that
   held is the machine's number. */
/* HOW BIG A STEP THE BENCHMARK TAKES, AND WHY IT IS NOT ALWAYS THIRTY.

   "Two more platoons" is the right increment for men and nonsense for the
   sea. Thirty more megalodons is a step from forty to seventy of the most
   expensive body in the game — the run overshoots the machine's real number
   on its first growth and reports the floor of a huge bracket. Thirty more
   sardines is not a step at all: a shoal that costs almost nothing takes
   twenty growths to find its edge and the run never finishes.

   So the roster's own SCALE sets it, read off the live registry like
   everything else on this page. Men answer exactly 30 by construction, so a
   benchmark of riflemen returns the number it always returned and the saved
   `cbz-npcwar-max` keeps meaning what it meant. There is still NO CAP —
   this only changes how fast the count walks toward the frame rate's verdict,
   which is the only thing allowed to end the run. */
function benchScale() {
  const SP = CBZ.WILDLIFE_SPECIES || {};
  let k = 0;
  [SET.redU, SET.blueU].forEach(function (u) {
    String(u).split("|").forEach(function (id) {
      const sc = id === "men" ? 1 : ((SP[id] || {}).scale || 1);
      if (sc > k) k = sc;
    });
  });
  return k || 1;
}
function benchStepFor() {
  return Math.max(2, Math.min(160, Math.round(30 / Math.max(0.35, benchScale()))));
}
// what the number is COUNTING, so "MAX 220" is not silently a number about
// sardines being read as a number about men
function benchUnit() {
  const same = SET.redU === SET.blueU;
  return (SET.redU === "men" && same) ? "PER SIDE"
    : (same ? kindLabel(SET.redU) : "BODIES") + " PER SIDE";
}
function benchKey() {
  return SET.redU === "men" && SET.blueU === "men"
    ? "cbz-npcwar-max" : "cbz-npcwar-max-" + SET.redU + "-v-" + SET.blueU;
}
function stepBench(dt) {
  const B = bench;
  B.t += dt;
  B.fpsAcc += dt; B.fpsN++;
  if (B.t < B.nextAt) return;
  const fps = CBZ.micro.fps || 0;
  B.t = 0; B.nextAt = 3.2;
  hud.note("BENCH " + aliveCount("red") + " " + benchUnit() + "  " + fps + " FPS");
  if (fps >= 33 && spawnQueue.length === 0) {
    B.lastGood = aliveCount("red");
    B.dips = 0;
    queueMen(B.step);
    B.grown += B.step;
  } else if (fps < 30) {
    B.dips++;
    if (B.dips >= 2) {
      const n = B.lastGood || aliveCount("red");
      try { localStorage.setItem(benchKey(), String(n)); } catch (e) {}
      banner("MAX " + n + " " + benchUnit(), "AT 30 FPS ON THIS MACHINE");
      hud.note("BENCH DONE  " + n + " " + benchUnit());
      bench = { done: true, n: n, t: 0, nextAt: 1e9, fpsAcc: 0, fpsN: 0, step: 0, grown: B.grown, lastGood: n, dips: 0 };
    }
  } else B.dips = 0;
}

#!/usr/bin/env node
/* tools/npcwar-timeline.mjs — ONE INFANTRY FIGHT, SECOND BY SECOND.

   The squad check prints how a fight ENDED. This prints how it WENT: every
   few seconds, per side, who is still fighting, who is dead, down, running,
   the share lying prone, the share pinned, the mean gap to the nearest
   enemy, and the rounds fired and hits made in that slice. It is the tool
   for the question "is this what a firefight looks like?".

     node tools/npcwar-timeline.mjs [--a usa] [--b usa] [--n 30] [--range 400]
        [--secs 600] [--every 5] [--seed 3] [--ground rolling] */
import { ctx, field, side, battle } from "./lib/infantry-node.mjs";
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const A = arg("a", "usa"), Bc = arg("b", "usa"), N = +arg("n", 30), RANGE = +arg("range", 400);
const SECS = +arg("secs", 600), EVERY = +arg("every", 5), SEED = +arg("seed", 3), GROUND = arg("ground", "rolling");
const sb = ctx();
const DOC = sb.CBZ.battleInfantry.DOCTRINE || null;
const g = field({ kind: GROUND, seed: 301 + SEED, half: Math.max(700, RANGE + 300) });
const place = (s, i) => {
  const sq = (i / 10) | 0, slot = i % 10, nsq = Math.ceil(N / 10), west = s === 0, fx = west ? 1 : -1;
  const lat = (sq - (nsq - 1) / 2) * 60, k = slot === 0 ? 0 : slot <= 4 ? slot : slot - 5, sd = slot === 0 ? 0 : slot <= 4 ? -1 : 1;
  const back = slot === 0 ? 0 : 4 + k * 4.2, latm = sd * (5 + k * 4.2), x0 = west ? -RANGE / 2 : RANGE / 2;
  return { x: x0 - fx * back, z: west ? lat + latm : -(lat + latm), h: west ? Math.PI / 2 : -Math.PI / 2 };
};
const sa = side(A), sbb = side(Bc);
const B = battle({ ground: g, seed: SEED * 104729 + N, a: sa, b: sbb, na: N, nb: N, place });
const I = B.I, C = B.S.cols;
I.order[0] = { kind: "advance", x: RANGE / 2 + 100, z: 0 };
I.order[1] = { kind: "advance", x: -RANGE / 2 - 100, z: 0 };
const pin = [DOC && DOC[sa.trn] ? DOC[sa.trn].pinAt : 1.5, DOC && DOC[sbb.trn] ? DOC[sbb.trn].pinAt : 1.5];
console.log(`${A} (${sa.trn}) v ${Bc} (${sbb.trn}), ${N} a side, ${RANGE} m, ${GROUND}, seed ${SEED}`);
console.log("   t   | fight dead down ran  prone pinned | fight dead down ran  prone pinned |  gap m | rounds  hits  (slice)");
let t = 0, ps = [0, 0], ph = [0, 0], next = EVERY;
const dt = 0.05;
while (t < SECS) {
  I.step(dt); t += dt; I.nEv = 0;
  if (t + 1e-9 < next) continue;
  next += EVERY;
  const o = [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]], xs = [[], []];
  for (let r = 0; r < B.S.rows; r++) {
    const s = C.side[r], L = C.life[r];
    if (L === 4) o[s][1]++;
    else if (L === 2 || L === 3) o[s][3]++;
    else if (L === 1 && C.down[r]) o[s][2]++;
    else if (L === 1) { o[s][0]++; if (C.post[r] === 2) o[s][4]++; if (C.supp[r] > pin[s]) o[s][5]++; xs[s].push(r); }
  }
  let gap = 0, gn = 0;
  for (const r of xs[0]) { let b = 1e9; for (const q of xs[1]) { const d = Math.hypot(C.x[r] - C.x[q], C.z[r] - C.z[q]); if (d < b) b = d; } if (b < 1e9) { gap += b; gn++; } }
  const st = I.stats, sh = st.shots[0] + st.shots[1], hi = (st.hits ? st.hits[0] + st.hits[1] : 0);
  const f = (a) => a.map((v) => String(v).padStart(4)).join(" ");
  console.log(String(t.toFixed(0)).padStart(5) + "  | " + f(o[0]) + "   | " + f(o[1]) + "   | " + String(gn ? (gap / gn).toFixed(0) : "-").padStart(5) + "  | " +
    String(sh - ps[0]).padStart(5) + " " + String(hi - ph[0]).padStart(5));
  ps[0] = sh; ph[0] = hi;
  if (!o[0][0] || !o[1][0]) { console.log("over at " + t.toFixed(0) + " s: " + (o[0][0] ? A + " (west)" : o[1][0] ? Bc + " (east)" : "nobody") + " holds the field; rounds " + sh + ", hits " + hi + (hi ? ", " + (sh / hi).toFixed(1) + " a hit" : "")); break; }
}

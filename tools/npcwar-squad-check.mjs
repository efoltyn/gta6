#!/usr/bin/env node
/* tools/npcwar-squad-check.mjs — SQUADS, PLATOONS, COMPANIES on the infantry
   core (src/battle/core/infantry.js): the same men as the duel, in squads of
   ten (a leader and two fire teams), advancing to contact over open rolling
   ground from a set range. Seeded, headless, no page.

   PRINTS per matchup and size: A's win share [95%], the median time to the
   end, each side's losses (killed / down / broke and ran), the losing side's
   share that was still standing when it broke, rounds fired per hit, bounds
   made, men pinned, buddy aid given.

     node tools/npcwar-squad-check.mjs                    usa v irgc + the mirror: 10, 30, 100 a side
     node tools/npcwar-squad-check.mjs --sizes 10,30 --n 80 --range 400
     node tools/npcwar-squad-check.mjs --a usa --b irgc --ratio 3     3 IRGC men for every US man
     node tools/npcwar-squad-check.mjs --check            fail unless USA wins 10v10 >= 75% and the mirror is 35-65% */
import { ctx, field, side, battle } from "./lib/infantry-node.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes("--" + k);
const A = arg("a", "usa"), Bc = arg("b", "irgc");
const N = +arg("n", 60);
const SIZES = arg("sizes", "10,30,100").split(",").map(Number);
const RANGE = +arg("range", 400);
const RATIO = +arg("ratio", 1);
const SECS = +arg("secs", 600);
const GROUND = arg("ground", "rolling");
const CHECK = has("check");
ctx();

function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), w = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - w) / d, (c + w) / d];
}
const med = (a) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

// squads side by side, 60 m apart, each in a wedge; a side's front faces the other
function placer(na, nb, D, flip) {
  return function (s, i) {
    const n = s ? nb : na, sq = (i / 10) | 0, slot = i % 10, nsq = Math.ceil(n / 10);
    const west = (s === 0) !== !!flip;
    const fx = west ? 1 : -1;
    const lat = (sq - (nsq - 1) / 2) * 60;
    // the wedge: leader at the point, alpha left back, bravo right back
    const k = slot === 0 ? 0 : slot <= 4 ? slot : slot - 5;
    const side_ = slot === 0 ? 0 : slot <= 4 ? -1 : 1;
    const back = slot === 0 ? 0 : 4 + k * 4.2, latm = side_ * (5 + k * 4.2);
    const x0 = west ? -D / 2 : D / 2;
    return { x: x0 - fx * back, z: lat + latm * (west ? 1 : -1), h: west ? Math.PI / 2 : -Math.PI / 2 };
  };
}
function fight(sa, sb, na, nb, seed, grounds) {
  const g = grounds[seed % grounds.length];
  const flip = seed & 1;
  const B = battle({ ground: g, seed: seed * 104729 + na, a: sa, b: sb, na, nb, place: placer(na, nb, RANGE, flip) });
  const I = B.I, C = B.S.cols;
  const westX = -RANGE / 2, eastX = RANGE / 2;
  I.order[0] = { kind: "advance", x: flip ? westX - 100 : eastX + 100, z: 0 };
  I.order[1] = { kind: "advance", x: flip ? eastX + 100 : westX - 100, z: 0 };
  const dt = 0.05;
  let t = 0;
  const n0 = na, n1 = nb;
  let end = -1;
  while (t < SECS) {
    I.step(dt); t += dt;
    I.nEv = 0;
    // every 2 s: does either side still fight?
    if (((t / dt) | 0) % 40 === 0) {
      let f0 = 0, f1 = 0;
      for (let r = 0; r < B.S.rows; r++) if (C.life[r] === 1 && !C.down[r]) { if (C.side[r]) f1++; else f0++; }
      if (!f0 || !f1) { end = !f0 && !f1 ? -1 : f0 ? 0 : 1; break; }
    }
  }
  const out = { win: end, t, I, cas: [[0, 0, 0], [0, 0, 0]], standing: [0, 0] };
  for (let r = 0; r < B.S.rows; r++) {
    const s = C.side[r];
    if (C.life[r] === 4) out.cas[s][0]++;
    else if (C.down[r]) out.cas[s][1]++;
    else if (C.life[r] === 2 || C.life[r] === 3) out.cas[s][2]++;
    else if (C.life[r] === 1) out.standing[s]++;
  }
  void n0; void n1;
  return out;
}

function table(sa, sb, label) {
  const grounds = [];
  for (let k = 0; k < 6; k++) grounds.push(field({ kind: GROUND, seed: 301 + k, half: Math.max(700, RANGE + 300) }));
  console.log("\n" + label + "   (" + GROUND + ", start " + RANGE + " m apart, N=" + N + ")");
  console.log("  size        A wins [95%]     ends    A lost: dead/down/ran      B lost: dead/down/ran      rounds/hit A/B   bounds  pins  aid   ms/battle");
  const rows = [];
  for (const n of SIZES) {
    const na = n, nb = Math.round(n * RATIO);
    let wa = 0, wb = 0, dr = 0;
    const ends = [];
    const L = [[0, 0, 0], [0, 0, 0]];
    let sh = [0, 0], hi = [0, 0], bounds = 0, pins = 0, aid = 0;
    const t0 = Date.now();
    for (let s = 1; s <= N; s++) {
      const r = fight(sa, sb, na, nb, s, grounds);
      if (r.win === 0) wa++; else if (r.win === 1) wb++; else dr++;
      ends.push(r.t);
      for (let k = 0; k < 2; k++) for (let j = 0; j < 3; j++) L[k][j] += r.cas[k][j];
      sh[0] += r.I.stats.shots[0]; sh[1] += r.I.stats.shots[1]; hi[0] += r.I.stats.hits[0]; hi[1] += r.I.stats.hits[1];
      bounds += r.I.led.rushes; pins += r.I.led.pins; aid += r.I.led.aids;
    }
    const ci = wilson(wa, wa + wb);
    const ms = (Date.now() - t0) / N;
    const pc = (v, of) => (100 * v / (N * of)).toFixed(0).padStart(3) + "%";
    console.log("  " + (na + " v " + nb).padEnd(10) + "  " + (100 * wa / Math.max(1, wa + wb)).toFixed(0).padStart(3) + "% [" + (100 * ci[0]).toFixed(0) + "-" + (100 * ci[1]).toFixed(0) + "]" +
      "  " + (med(ends).toFixed(0) + " s").padStart(6) +
      "    " + [pc(L[0][0], na), pc(L[0][1], na), pc(L[0][2], na)].join(" ") +
      "           " + [pc(L[1][0], nb), pc(L[1][1], nb), pc(L[1][2], nb)].join(" ") +
      "         " + (sh[0] / Math.max(1, hi[0])).toFixed(1) + " / " + (sh[1] / Math.max(1, hi[1])).toFixed(1) +
      "    " + (bounds / N).toFixed(0).padStart(5) + " " + (pins / N).toFixed(0).padStart(5) + " " + (aid / N).toFixed(1).padStart(5) + "   " + ms.toFixed(0));
    rows.push({ n, a: wa / Math.max(1, wa + wb) });
  }
  return rows;
}
const sa = side(A), sb = side(Bc);
console.log("NPC WAR SQUADS: " + A + " (" + sa.trn + ") v " + Bc + " (" + sb.trn + ")" + (RATIO !== 1 ? ", " + RATIO + " of B for each A" : ""));
const main = table(sa, sb, A + " v " + Bc);
let fails = 0;
if (!arg("b") || has("mirror") || CHECK) {
  const mir = table(sa, sa, A + " v " + A + " (mirror)");
  if (CHECK) for (const r of mir) if (r.a < 0.35 || r.a > 0.65) { console.log("  FAIL mirror " + r.n + ": " + (100 * r.a).toFixed(0) + "%"); fails++; }
}
if (CHECK) {
  for (const r of main) if (r.n === 10 && r.a < 0.75) { console.log("  FAIL " + A + " v " + Bc + " 10v10: " + (100 * r.a).toFixed(0) + "%"); fails++; }
  console.log(fails ? fails + " FAILED" : "PASS");
  process.exit(fails ? 1 : 0);
}

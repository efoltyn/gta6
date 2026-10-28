#!/usr/bin/env node
/* tools/npcwar-duel-check.mjs — ONE SOLDIER AGAINST ONE SOLDIER, a thousand
   times, on the infantry core (src/battle/core/infantry.js): the same sim
   every NPC War man runs at every scale. No browser, no page, no dice.

   Two men start walking toward each other at a set range on open ground
   (rolling: swells and the micro-relief a prone man uses; turned 180
   degrees about the centre, so both start lines are the same ground). The
   first to see the other gets the first shot. It ends when one of them can
   no longer fight (dead, or down), or after 240 s.

   PRINTS, by range: A's win share (with its 95% interval), draws, the time
   each side's first round left the muzzle and first hit landed, rounds each
   side fired per hit, how often each side went prone, and where the hits
   went (head / vital / gut / limb / plate stops).

     node tools/npcwar-duel-check.mjs                       usa v irgc, 50/100/200/300 m, N=1000, + the mirror
     node tools/npcwar-duel-check.mjs --a usa --b irgc --n 400 --ranges 100,300
     node tools/npcwar-duel-check.mjs --a usa --b usa       a mirror
     node tools/npcwar-duel-check.mjs --ground flat|rolling|folds
     node tools/npcwar-duel-check.mjs --at elite --bt elite --ag ak47 --bg ak47   override training / gun
     --check   exit 1 unless USA beats IRGC >= 75% at 100-300 m and the mirror is 40-60% */
import { ctx, field, side, battle, standing } from "./lib/infantry-node.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes("--" + k);
const A = arg("a", "usa"), Bc = arg("b", "irgc");
const N = +arg("n", 1000);
const RANGES = arg("ranges", "50,100,200,300").split(",").map(Number);
const GROUND = arg("ground", "rolling");
const SECS = +arg("secs", 240);
const CHECK = has("check");

ctx();
function specOf(c, t, g, o) { const s = side(c, { trn: t, gun: g, optic: o != null ? +o : undefined }); return s; }
const spA = specOf(A, arg("at"), arg("ag"), arg("ao")), spB = specOf(Bc, arg("bt"), arg("bg"), arg("bo"));

function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), w = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - w) / d, (c + w) / d];
}
const med = (a) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
const fmt = (x, d = 1) => (x === x ? x.toFixed(d) : "-");

function duel(D, seed, sa, sb, grounds) {
  const g = grounds[seed % grounds.length];
  const B = battle({
    ground: g, seed: seed * 7919 + D, a: sa, b: sb, na: 1, nb: 1,
    // A on the west start, B on the east, each facing the other; the start
    // alternates by seed parity so neither spot is A's
    place: (s, i) => {
      const flip = seed & 1;
      const w = (s === 0) !== !!flip;
      void i;
      return { x: w ? -D / 2 : D / 2, z: 0, h: w ? Math.PI / 2 : -Math.PI / 2 };
    },
    order: [{ kind: "advance", x: 0, z: 0 }, { kind: "advance", x: 0, z: 0 }],
  });
  // each walks toward where the other started
  const I = B.I, C = B.S.cols;
  I.order[0] = { kind: "advance", x: C.x[1], z: 0 };
  I.order[1] = { kind: "advance", x: C.x[0], z: 0 };
  const dt = 0.05;
  let t = 0, proneA = 0, proneB = 0;
  while (t < SECS) {
    I.step(dt); t += dt;
    if (C.post[0] === 2) proneA = 1;
    if (C.post[1] === 2) proneB = 1;
    if (!standing(B, 0) || !standing(B, 1)) break;
  }
  const a = standing(B, 0), b = standing(B, 1);
  return { win: a && !b ? 0 : b && !a ? 1 : -1, t, I, proneA, proneB };
}

function table(sa, sb, label) {
  const grounds = [];
  for (let k = 0; k < 8; k++) grounds.push(field({ kind: GROUND, seed: 101 + k }));
  console.log("\n" + label + "   (" + GROUND + " ground, N=" + N + " per range)");
  console.log("  range   A wins  [95%]        draw   ends   first shot A/B   first hit A/B    rounds/hit A/B   prone A/B   all hits: brain head vital spine gut torso limb plate-stop");
  const rows = [];
  for (const D of RANGES) {
    let wa = 0, wb = 0, dr = 0;
    const fsA = [], fsB = [], fhA = [], fhB = [];
    let shA = 0, shB = 0, hA = 0, hB = 0, pA = 0, pB = 0;
    const org = { brain: 0, head: 0, vital: 0, spine: 0, gut: 0, torso: 0, limb: 0, plate: 0 }; const ends = [];
    let plate = 0, platePen = 0;
    const t0 = Date.now();
    for (let s = 1; s <= N; s++) {
      const r = duel(D, s, sa, sb, grounds);
      if (r.win === 0) wa++; else if (r.win === 1) wb++; else dr++;
      ends.push(r.t);
      const L = r.I.led, St = r.I.stats;
      if (L.firstShot[0] >= 0) fsA.push(L.firstShot[0]);
      if (L.firstShot[1] >= 0) fsB.push(L.firstShot[1]);
      if (L.firstHit[0] >= 0) fhA.push(L.firstHit[0]);
      if (L.firstHit[1] >= 0) fhB.push(L.firstHit[1]);
      shA += St.shots[0]; shB += St.shots[1]; hA += St.hits[0]; hB += St.hits[1];
      pA += r.proneA; pB += r.proneB;
      for (const k in org) org[k] += L.organs[k] || 0;
      plate += L.plate; platePen += L.platePen;
    }
    const ci = wilson(wa, wa + wb);
    const row = { D, a: wa / Math.max(1, wa + wb), lo: ci[0], hi: ci[1], draws: dr / N };
    rows.push(row);
    const ms = Date.now() - t0;
    console.log("  " + String(D).padStart(4) + " m  " + (100 * row.a).toFixed(1).padStart(5) + "%  [" + (100 * ci[0]).toFixed(0) + "-" + (100 * ci[1]).toFixed(0) + "]".padEnd(5) +
      "   " + (100 * dr / N).toFixed(1).padStart(4) + "%  " + (fmt(med(ends), 0) + " s").padStart(5) + "  " + (fmt(med(fsA)) + " / " + fmt(med(fsB)) + " s").padEnd(15) +
      "  " + (fmt(med(fhA)) + " / " + fmt(med(fhB)) + " s").padEnd(15) +
      "  " + (fmt(shA / Math.max(1, hA)) + " / " + fmt(shB / Math.max(1, hB))).padEnd(15) +
      "  " + ((100 * pA / N).toFixed(0) + "% / " + (100 * pB / N).toFixed(0) + "%").padEnd(10) +
      "  " + [org.brain, org.head, org.vital, org.spine, org.gut, org.torso, org.limb, org.plate].join(" ") + "   (" + (ms / N).toFixed(1) + " ms a duel)");
  }
  return rows;
}

console.log("NPC WAR DUEL: " + A + " (" + spA.trn + ", " + spA.gun + (spA.optic ? ", optic x" + spA.optic : ", irons") + ", plates " + (spA.kit.plates || "none") + ") v " +
  Bc + " (" + spB.trn + ", " + spB.gun + (spB.optic ? ", optic x" + spB.optic : ", irons") + ", plates " + (spB.kit.plates || "none") + ")");
const main = table(spA, spB, A + " v " + Bc);
let fails = 0;
/* --ladder: TRAINING ALONE. Both men carry the same AK on iron sights and no
   armour; only the doctrine row differs. What the table shows is what
   training buys, and nothing else. */
if (has("ladder")) {
  const L = ["elite:thug", "elite:pro", "pro:thug", "thug:civ", "swat:elite"];
  for (const p of L) {
    const [ta, tb] = p.split(":");
    const a = { trn: ta, gun: "ak47", optic: 0, kit: {} }, b = { trn: tb, gun: "ak47", optic: 0, kit: {} };
    table(a, b, "TRAINING ALONE: " + ta + " v " + tb + " (AK, irons, no armour)");
  }
  process.exit(0);
}
if (!arg("b") || has("mirror") || CHECK) {
  const mir = table(spA, spA, A + " v " + A + " (mirror)");
  if (CHECK) {
    for (const r of mir) if (r.a < 0.4 || r.a > 0.6) { console.log("  FAIL mirror at " + r.D + " m: " + (100 * r.a).toFixed(1) + "%"); fails++; }
  }
}
if (CHECK) {
  for (const r of main) if (r.D >= 100 && r.a < 0.75) { console.log("  FAIL " + A + " v " + Bc + " at " + r.D + " m: " + (100 * r.a).toFixed(1) + "% (< 75%)"); fails++; }
  console.log(fails ? "\n" + fails + " FAILED" : "\nPASS");
  process.exit(fails ? 1 : 0);
}

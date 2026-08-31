#!/usr/bin/env node
/* tools/marine-girth-check.mjs — DOES THE WHOLE ANIMAL GET BIGGER?

   The owner, 2026-08-31: "the first shark and maybe all the sharks, when they
   eat things and get bigger, only the body is getting bigger right now. The
   head and tail stay the same, and that makes the body look stupidly big."

   He was looking at the fed/lean body cue (city/wildlife_traits.js). It used
   to scale ONE mesh — the hull — by up to ±12% in y and z. On a land animal
   that is a belly. On a marine animal it is a broken weld: aquatic.js solves
   the rostrum's ring and the tail sleeve's front ring against the hull's OWN
   rings so the three meshes share a rim exactly, and fattening only the middle
   link leaves a step at both ends (and, because the mesh scale pivots on the
   group's y=0, lifts the body off its own head).

   This tool measures that directly. For each marine species in the world it
   takes one live animal, poses it lean (hunger 1) and fed (hunger 0), and
   measures the world-space box of every named piece of the body — hull,
   rostrum, tail sleeve, teeth, gills. The fed/lean ratio of each piece is that
   piece's swell.

     SPREAD = max(ratio) - min(ratio) across the pieces.

   0 means the animal swelled as ONE body. The old code scored ~0.27 on a great
   white (hull 1.27, rostrum 1.00, tail 1.00) — which is the complaint, in a
   number. Anything above SPREAD_MAX is a body coming apart at its welds.

   It also asserts the thing the fix must never break: hunger may move y and z
   (the girth), and must NEVER move group.scale.x, because every size reader in
   the repo asks group.scale.x how big an animal is.

     node tools/marine-girth-check.mjs
     node tools/marine-girth-check.mjs --json
     node tools/marine-girth-check.mjs --seed 11111

   HARNESS TRAP: an off-screen animal is invisible AND its matrices are LOD'd
   off, and core/matrixskip.js patches Object3D.updateMatrixWorld to RETURN
   IMMEDIATELY for any node with visible===false. So the usual
   `updateMatrixWorld(true)` is a no-op on exactly the animals a headless probe
   finds, and every box comes back at the size it had when it was last on
   screen — this tool's first draft scored a flawless 1.0000 on the BROKEN
   build that way. The measurement therefore does both halves by hand:
   updateMatrix() on every node (matrixAutoUpdate is false too) and then
   updateWorldMatrix(true, true), which matrixskip does not patch. */
import { launch, sleep } from "./lib/cdp.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const SEED = arg("--seed", "90210");
const JSON_OUT = has("--json");
const SPREAD_MAX = +arg("--spread-max", "0.01");
const say = (m) => { if (!JSON_OUT) console.log(m); };

const MEASURE = `(() => {
  const T = window.THREE, TR = CBZ.wildlifeTraits;
  if (!T || !TR || !CBZ.cityWildlife) return { err: "no world" };
  // one live individual per marine species, the biggest of each (the pieces
  // a small fish is built from are too few to say anything).
  const pick = new Map();
  for (const a of CBZ.cityWildlife) {
    if (!a || a.dead || !a.species || !a.species.aquatic || !a.group) continue;
    const cur = pick.get(a.species.id);
    if (!cur || (a._sizeEff || 0) > (cur._sizeEff || 0)) pick.set(a.species.id, a);
  }
  const PARTS = ["sharkHull", "cetaceanHull", "fishHull", "mantaCore", "turtleShell",
                 "sharkRostrum", "tailSleeve", "sharkUpperTooth", "sharkGill", "sharkEye"];
  const out = [];
  for (const [id, a] of pick) {
    const g = a.group;
    const parts = new Map();
    g.traverse(function (o) {
      if (!o.isMesh || !o.name || PARTS.indexOf(o.name) < 0) return;
      if (!parts.has(o.name)) parts.set(o.name, []);
      parts.get(o.name).push(o);
    });
    if (parts.size < 2) continue;
    // rotation zeroed so a swimming pose cannot leak into a box measurement
    const rot = { x: g.rotation.x, y: g.rotation.y, z: g.rotation.z };
    const hunger0 = a.hunger, bellyQ0 = a._bellyQ;
    g.rotation.set(0, 0, 0);
    const snap = function () {
      g.traverse(function (o) { o.updateMatrix(); });      // see HARNESS TRAP
      g.updateWorldMatrix(true, true);
      const r = { gs: { x: g.scale.x, y: g.scale.y, z: g.scale.z }, box: {} };
      for (const [n, list] of parts) {
        const b = new T.Box3();
        for (const m of list) b.expandByObject(m);
        if (isFinite(b.max.y) && isFinite(b.min.y)) {
          r.box[n] = { h: b.max.y - b.min.y, w: b.max.z - b.min.z, len: b.max.x - b.min.x };
        }
      }
      return r;
    };
    a.hunger = 1; a._bellyQ = null; TR.bodyCue(a); const lean = snap();
    a.hunger = 0; a._bellyQ = null; TR.bodyCue(a); const fed = snap();
    a.hunger = hunger0; a._bellyQ = null; TR.bodyCue(a); a._bellyQ = bellyQ0;
    g.rotation.set(rot.x, rot.y, rot.z);
    g.traverse(function (o) { o.updateMatrix(); });
    g.updateWorldMatrix(true, true);

    const ratio = {};
    let lo = Infinity, hi = -Infinity;
    for (const n in fed.box) {
      const L = lean.box[n], F = fed.box[n];
      if (!L || !(L.h > 1e-6) || !(L.w > 1e-6)) continue;
      // the girth is a y/z swell; average the two so one flat piece (a fin, a
      // tooth) is not judged on the axis it has no thickness in
      const r = ((F.h / L.h) + (F.w / L.w)) / 2;
      ratio[n] = +r.toFixed(4);
      if (r < lo) lo = r;
      if (r > hi) hi = r;
    }
    out.push({
      id: id, scale: +(a._sizeEff || 0).toFixed(3),
      parts: Object.keys(ratio).length,
      ratio: ratio,
      spread: +(hi - lo).toFixed(4),
      sizeMoved: +Math.abs(fed.gs.x - lean.gs.x).toFixed(6),
      girth: { lean: +(lean.gs.y / lean.gs.x).toFixed(4), fed: +(fed.gs.y / fed.gs.x).toFixed(4) },
    });
  }
  return { animals: out };
})()`;

const rig = await launch({ rafBudget: 600 });
try {
  await rig.open("/", `seed=${SEED}`);
  // the title card is a real screen — nothing exists until PLAY is pressed
  if (!await rig.wait("window.CBZ && CBZ.game && document.getElementById('playBtn')", 120000)) {
    throw new Error("the page never reached its title card");
  }
  if (!await rig.wait(`(() => { if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn"); if (b) b.click();
      return CBZ.game.state === "playing"; })()`, 120000, 250)) {
    throw new Error("PLAY never started a game");
  }
  const ok = await rig.wait("CBZ && CBZ.cityWildlife && CBZ.cityWildlife.length > 4 && CBZ.wildlifeTraits", 180000);
  if (!ok) throw new Error("world never populated");
  await sleep(400);
  const res = await rig.evl(MEASURE);
  if (res.err) throw new Error(res.err);
  const rows = res.animals || [];
  const worst = rows.reduce((m, r) => Math.max(m, r.spread), 0);
  const sizeMoved = rows.reduce((m, r) => Math.max(m, r.sizeMoved), 0);
  const pass = rows.length > 0 && worst <= SPREAD_MAX && sizeMoved <= 1e-6;

  if (JSON_OUT) {
    console.log(JSON.stringify({ seed: SEED, pass, worstSpread: worst, sizeMoved, animals: rows }, null, 1));
  } else {
    say("");
    say("  MARINE GIRTH — fed(hunger 0) vs lean(hunger 1), per body piece");
    say("  " + "-".repeat(74));
    for (const r of rows) {
      const parts = Object.keys(r.ratio).map((n) => n.replace(/^shark|^cetacean/, "") + " " + r.ratio[n].toFixed(3));
      say("  " + r.id.padEnd(20) + "x" + String(r.scale).padEnd(6) +
        "spread " + r.spread.toFixed(4).padStart(7) +
        "   girth " + r.girth.lean.toFixed(2) + "->" + r.girth.fed.toFixed(2));
      say("      " + parts.join("   "));
    }
    say("  " + "-".repeat(74));
    say("  worst spread   " + worst.toFixed(4) + "   (max " + SPREAD_MAX + ")");
    say("  size moved     " + sizeMoved.toFixed(6) + "   (group.scale.x must never ride hunger)");
    say("  " + (pass ? "PASS — the body swells as one animal" : "FAIL — the body is coming apart at its welds"));
    say("");
  }
  process.exit(pass ? 0 : 1);
} finally {
  await rig.close();
}

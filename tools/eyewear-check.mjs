#!/usr/bin/env node
/* tools/eyewear-check.mjs — GLASSES SIT ON THE HEAD THEY ARE WORN ON.

   Runs the REAL character.js + entities/eyewear.js in plain node and, for
   every style on every head (male / female / child form x narrow / medium /
   broad nose, at the head scales real bodies use), asserts:
     1. temple-to-skin clearance (closest approach of the arm's inner face to
        the skull, in metres on the body) is > 0 and < 6 mm;
     2. no vertex of the pair is inside the skull;
     3. the front (rim + lens) is in front of the eye surface + lashes;
     4. the lenses never reach the brow (lens clear of the skull by more than
        the brow strip's thickness + its expression lift);
     5. the temple clears the ear and the detail kit's earpiece bud.
     node tools/eyewear-check.mjs        exit 0 = ok */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const ctx = vm.createContext({ console, Math, performance, Date });
ctx.window = ctx; ctx.self = ctx;
ctx.CBZ = { CONFIG: {}, onAlways() {}, onUpdate() {}, on() {} };
for (const f of ["src/vendor/three.r128.min.js", "src/world/materials.js", "src/systems/fphands.js", "src/entities/footwear.js", "src/entities/character.js", "src/entities/eyewear.js"]) {
  vm.runInContext(read(f), ctx, { filename: f });
}
const { CBZ } = ctx;
const EW = CBZ.eyewear;
let fails = 0, checks = 0;
const check = (ok, msg) => { checks++; if (!ok) { fails++; console.log("  FAIL " + msg); } };
const HS = 0.70;                                  // humanScale: 1 rig unit = 0.70 m
const HK = { m: [1.0, 1.08], f: [0.917], c: [0.55, 0.8] };   // head scales real bodies wear (adult m/f, big man, kids)
const BUD = { p: [0.376, 0.30, -0.03], r: 0.024 };           // outfits.js detail-kit earpiece
let worst = { clear: [1, ""], lensBrow: [1, ""] };

for (const style of Object.keys(EW.STYLES)) {
  const shape = EW.STYLES[style].shape;
  for (const form of ["m", "f", "c"]) for (const nose of [0, 1, 2]) {
    const tag = style + "/" + form + nose;
    const F = EW.fit(shape, form, nose), g = EW.geometry(shape, form, nose);
    check(F && g, tag + ": builds");
    if (!F || !g) continue;
    const S = F.S, pos = g.attributes.position, idx = g.index.array;
    check(Array.prototype.every.call(pos.array, Number.isFinite), tag + ": finite");
    // vertices by group (0 frame, 1 lens, 2 tip, 3 pad)
    const byG = [new Set(), new Set(), new Set(), new Set()];
    for (const gr of g.groups) for (let i = gr.start; i < gr.start + gr.count; i++) byG[gr.materialIndex].add(idx[i]);
    // 2. nothing inside the skull
    let minAll = 1;
    for (let i = 0; i < pos.count; i++) minAll = Math.min(minAll, S.sdf(pos.getX(i), pos.getY(i), pos.getZ(i)));
    check(minAll > 0, tag + ": a vertex is " + (-minAll * HS * 1000).toFixed(1) + " mm inside the skull");
    // 1. temple clearance: closest approach of the arm's inner face
    let cl = 1;
    for (const p of F.temple) cl = Math.min(cl, S.sdf(p[0], p[1], p[2]) - F.tA);
    for (const hk of HK[form]) {
      const mm = cl * hk * HS * 1000;
      check(mm > 0 && mm < 6, tag + " hk " + hk + ": temple clearance " + mm.toFixed(2) + " mm (want 0..6)");
      if (mm < worst.clear[0] || worst.clear[0] === 1) worst.clear = [mm, tag + " hk" + hk];
    }
    // 3. front in front of the eye: every rim/lens vertex over the eye opening
    const E = S.eye;
    // (the eyeball's own sphere, its lashes standing 7.5% of the radius proud)
    let frontMin = 1;
    for (const set of [byG[0], byG[1]]) for (const i of set) {
      const dx = Math.abs(pos.getX(i)) - E.x, du = pos.getY(i) - E.y, z = pos.getZ(i);
      const q = E.r * E.r - dx * dx - du * du;
      if (q <= 0) continue;
      frontMin = Math.min(frontMin, z - (E.front - E.r + Math.sqrt(q) * 1.075));
    }
    check(frontMin > 0, tag + ": the front is " + (-frontMin * HS * 1000).toFixed(1) + " mm into the eye/lashes");
    // 4. lenses clear of the brow (brow strip th + angry lift 0.004 + 1 mm)
    let lensMin = 1;
    for (const i of byG[1]) lensMin = Math.min(lensMin, S.sdf(pos.getX(i), pos.getY(i), pos.getZ(i)));
    const browNeed = S.brow.th + 0.004 + 0.0015;
    check(lensMin > browNeed, tag + ": lens " + lensMin.toFixed(4) + " off the skin, brow needs " + browNeed.toFixed(4));
    if (lensMin < worst.lensBrow[0]) worst.lensBrow = [lensMin, tag];
    // 5. temple clears the ear and the earpiece bud
    let earMin = 1;
    const ear = S.earPts;
    for (const p of F.temple) for (let i = 0; i < ear.length; i += 3) earMin = Math.min(earMin, Math.hypot(p[0] - ear[i], p[1] - ear[i + 1], p[2] - ear[i + 2]));
    check(earMin > F.tA, tag + ": temple " + earMin.toFixed(4) + " from the ear (arm half-thickness " + F.tA + ")");
    let budMin = 1;
    for (const p of F.temple) budMin = Math.min(budMin, Math.hypot(p[0] - BUD.p[0], p[1] - BUD.p[1], p[2] - BUD.p[2]) - BUD.r - Math.max(F.tA, F.tB));
    check(budMin > 0, tag + ": temple through the earpiece bud (" + budMin.toFixed(4) + ")");
    check(idx.length / 3 < 6000, tag + ": " + idx.length / 3 + " tris");
  }
}
// a real rig: make() mounts at the head's own scale
{
  const ch = CBZ.makeCharacter ? CBZ.makeCharacter({}) : null;
  if (ch) {
    const m = EW.make(ch, "aviator");
    check(m && Math.abs(m.scale.x - ch.profile.headSize / 0.6) < 1e-6, "make(): scaled by the rig's hk");
    check(EW.styleFor("Aviators") === "aviator" && EW.styleFor("Sunglasses") === "wayfarer" && EW.styleFor("Diamond Grill") === null, "styleFor maps the catalog");
  }
}
console.log("eyewear-check: " + (checks - fails) + "/" + checks + " ok; tightest temple " + worst.clear[0].toFixed(2) + " mm (" + worst.clear[1] + "), lens-to-skin min " + (worst.lensBrow[0] * HS * 1000).toFixed(1) + " mm (" + worst.lensBrow[1] + ")");
process.exit(fails ? 1 : 0);

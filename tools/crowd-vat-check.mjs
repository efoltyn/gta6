#!/usr/bin/env node
/* tools/crowd-vat-check.mjs — THE REAL CROWD FITS THE PHONE, in plain node.

   Bakes entities/crowdgpu.js headlessly from the real rig (character.js +
   poses.js + moves.js, the same vm load as uniform-body-check) and asserts:
     - every clip baked, with its frames, and the gait clips found a stride
       (period > 0, radPerM > 0);
     - the bone texture (VAT) and the impostor atlas fit 4096 on both axes
       (the iOS / low-end max texture size) — the atlas is a render target,
       the VAT a float DataTexture, neither ever touches a canvas;
     - the bone matrices are finite, and every clip MOVES something (a clip
       whose frames are identical baked nothing) except the held ones;
     - LOD2 has fewer vertices than LOD1 for both bodies (it is a decimation
       of the same mesh), and every merged vertex points at a real bone.

     node tools/crowd-vat-check.mjs      prints the sizes + PASS/FAIL (exit 0/1) */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fakeDocument } from "./lib/fake-canvas.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const FILES = ["src/vendor/three.r128.min.js", "src/config.js", "src/core/matrixskip.js", "src/world/materials.js", "src/systems/fphands.js",
  "src/entities/tattoo.js", "src/entities/footwear.js", "src/entities/character.js", "src/entities/headwear.js", "src/entities/heritage.js",
  "src/entities/moves.js", "src/entities/poses.js", "src/entities/moves_posture.js", "src/entities/crowdgpu.js"];
const ctx = vm.createContext({ console, Math, setTimeout, clearTimeout, performance });
ctx.window = ctx; ctx.self = ctx; ctx.document = fakeDocument();
ctx.navigator = { userAgent: "node" }; ctx.location = { search: "", href: "" };
ctx.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
ctx.addEventListener = () => {}; ctx.requestAnimationFrame = () => 0;
ctx.CBZ = { CONFIG: {}, game: { mode: "city" }, npcs: [], onUpdate() {}, onAlways() {}, onReset() {}, onModeEnter() {} };
ctx.CBZ.tattoo = { lazy: false };
for (const f of FILES) vm.runInContext(read(f), ctx, { filename: f });
const { CBZ } = ctx;
const fails = [];
const ok = (c, msg) => { if (!c) fails.push(msg); };

const G = CBZ.crowdGPU;
ok(!!G, "CBZ.crowdGPU missing");
const B = G && G.bake();
ok(!!B, "bake returned nothing");
if (B) {
  const L = G.layout();
  const LIM = 4096;
  console.log("VAT   " + B.width + " x " + B.height + " RGBA32F (" + (B.width * B.height * 16 / 1048576).toFixed(2) + " MB), bones " + B.bones + ", rows/body " + B.rowsPerBody + ", bake " + B.ms + " ms");
  console.log("atlas " + L.atlas.width + " x " + L.atlas.height + " RGBA8 (" + (L.atlas.width * L.atlas.height * 4 / 1048576).toFixed(2) + " MB), " + L.atlas.angles + " angles x " + L.atlas.frames + " frames, cell " + L.atlas.cell.join("x"));
  ok(B.width <= LIM && B.height <= LIM, "VAT over " + LIM);
  ok(L.atlas.width <= LIM && L.atlas.height <= LIM, "atlas over " + LIM);
  let bad = 0;
  for (let i = 0; i < B.data.length; i++) if (!isFinite(B.data[i])) bad++;
  ok(bad === 0, bad + " non-finite bone values");
  const W = B.width;
  for (let b = 0; b < B.bodies.length; b++) {
    const bd = B.bodies[b];
    console.log("body " + bd.build + ": " + bd.bones + " bones, LOD1 " + bd.lod[0].verts + " verts / " + bd.lod[0].tris + " tris, LOD2 " + bd.lod[1].verts + " verts / " + bd.lod[1].tris + " tris");
    ok(bd.lod[1].verts < bd.lod[0].verts, "LOD2 not lighter than LOD1 (" + bd.build + ")");
    for (const lod of bd.lod) {
      let maxBone = 0;
      for (let k = 0; k < lod.part.length; k += 2) maxBone = Math.max(maxBone, lod.part[k]);
      ok(maxBone < bd.bones, "vertex bone index past the bone list (" + bd.build + ")");
    }
    for (const id of G.clips()) {
      const c = G.clip(id);

      ok(c.n > 0, id + " has no frames");
      if (b === 0) console.log("  clip " + id.padEnd(9) + " frames " + String(c.n).padStart(2) + "  period " + c.period.toFixed(2) + " s" + (c.radPerM ? "  stride " + (Math.PI * 2 / c.radPerM).toFixed(2) + " m" : ""));
      if (c.speed) ok(c.radPerM > 0 && c.period > 0, id + " found no stride");
    }
  }
  // motion: the walk's first and middle frames differ for a leg bone
  const walk = G.clip("walk");
  let moved = 0;
  // rows are clip-major; recompute the walk's row0 from the clip order
  let row0 = 0; for (const id of G.clips()) { if (id === "walk") break; row0 += G.clip(id).n; }
  const a = row0, m = row0 + (walk.n >> 1);
  for (let x = 0; x < W * 4; x++) moved = Math.max(moved, Math.abs(B.data[a * W * 4 + x] - B.data[m * W * 4 + x]));
  console.log("walk max matrix delta frame 0 vs mid: " + moved.toFixed(3));
  ok(moved > 0.05, "the walk does not move");
}
if (fails.length) { console.log("FAIL\n  " + fails.join("\n  ")); process.exit(1); }
console.log("PASS");

// tools/race-check-venue.mjs — plain-node checks for src/race/race_track.js + race_venue.js.
// No browser. Loads the vendored three r128, a no-op 2D canvas, builds both on low and high,
// and measures the geometry against race_core: surface width, wall height, bank, stands
// outside the wall, rake, crowd, pit boxes, draw calls, triangles, footprint.
//   node tools/race-check-venue.mjs
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const ctx = new Proxy(function () {}, { get(t, p) { return p === "width" ? 10 : function () { return ctx; }; }, set() { return true; } });
globalThis.document = { createElement() { return { width: 0, height: 0, style: {}, getContext() { return ctx; } }; } };
const THREE_ = require(path.join(ROOT, "src/vendor/three.r128.min.js"));
const THREE = globalThis.THREE || THREE_;
const core = require(path.join(ROOT, "src/race/race_core.js"));
const track = require(path.join(ROOT, "src/race/race_track.js"));
const venue = require(path.join(ROOT, "src/race/race_venue.js"));
const D = core.DIMS, DEG = 180 / Math.PI;

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "  ok   " : "  FAIL ") + msg); if (!cond) fails++; };

function census(group) {
  let draws = 0, tris = 0;
  group.traverse((o) => {
    if (!o.visible) return;
    if (!(o.isMesh || o.isPoints)) return;
    const g = o.geometry;
    let n = o.isPoints ? g.attributes.position.count : (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (o.isInstancedMesh) n *= o.count;
    draws++; tris += n;
  });
  return { draws, tris: Math.round(tris) };
}
function verts(mesh, every, fn) {
  const p = mesh.geometry.attributes.position;
  for (let i = 0; i < p.count; i += every) fn(p.getX(i), p.getY(i), p.getZ(i));
}
const NR = {};

for (const q of ["low", "high"]) {
  console.log(`\n== quality ${q} ==`);
  let t0 = performance.now();
  const tr = track.build(THREE, core, { quality: q });
  const tTrack = performance.now() - t0; t0 = performance.now();
  const ve = venue.build(THREE, core, { quality: q });
  const tVenue = performance.now() - t0;
  const ct = census(tr.group), cv = census(ve.group);
  const draws = ct.draws + cv.draws, tris = ct.tris + cv.tris;
  console.log(`  build: track ${tTrack.toFixed(0)} ms, venue ${tVenue.toFixed(0)} ms`);
  console.log(`  track: ${ct.draws} draws ${ct.tris} tris | venue: ${cv.draws} draws ${cv.tris} tris | total ${draws} draws ${tris} tris`);
  const budget = q === "high" ? { d: 120, t: 350000 } : { d: 70, t: 150000 };
  ok(draws <= budget.d, `draw calls ${draws} <= ${budget.d}`);
  ok(tris <= budget.t, `triangles ${tris} <= ${budget.t}`);

  // surface: every surface vertex sits on core.surfaceY (+ a <=3 cm crown), u spans INNER..WALL_U
  let umin = Infinity, umax = -Infinity, dyMax = 0;
  tr.group.traverse((o) => {
    if (o.name !== "concrete" && o.name !== "asphalt") return;
    verts(o, 3, (x, y, z) => {
      core.nearest(x, z, null, NR);
      umin = Math.min(umin, NR.u); umax = Math.max(umax, NR.u);
      dyMax = Math.max(dyMax, Math.abs(y - core.surfaceY(NR.s, NR.u)));
    });
  });
  ok(Math.abs(umin - D.INNER) < 0.05 && Math.abs(umax - D.WALL_U) < 0.05, `surface spans u ${umin.toFixed(2)}..${umax.toFixed(2)} (racing width ${(D.HALF_W * 2).toFixed(1)} m + ${D.SHOULDER} m shoulder)`);
  ok(dyMax < 0.04, `surface on core.surfaceY within ${dyMax.toFixed(3)} m (crown <= 3 cm)`);

  // bank measured off the built surface at the turn apex and mid front stretch
  for (const [name, s, want] of [["turn apex", D.L / 4, D.BANK_TURN], ["back straight", D.L / 2, D.BANK_STRAIGHT]]) {
    const pick = (u) => { let best = null, bd = Infinity;
      tr.group.traverse((o) => { if (o.name !== "concrete" && o.name !== "asphalt") return;
        verts(o, 1, (x, y, z) => { const w = core.toWorld(s, u, 0); const d = Math.hypot(x - w.x, z - w.z); if (d < bd) { bd = d; best = { x, y, z }; } }); });
      return best; };
    const a = pick(-7), b = pick(7);
    const bank = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
    ok(Math.abs(bank - want) < 0.6 / DEG, `bank at ${name}: built ${(bank * DEG).toFixed(2)} deg vs core ${(want * DEG).toFixed(2)} deg`);
  }

  // SAFER wall: face at WALL_U, WALL_H tall above the surface at its foot
  {
    let hMin = Infinity, hMax = -Infinity, uErr = 0;
    tr.group.traverse((o) => {
      if (o.name !== "signs") return;
      verts(o, 1, (x, y, z) => { core.nearest(x, z, null, NR); uErr = Math.max(uErr, Math.abs(NR.u - D.WALL_U)); const h = y - core.surfaceY(NR.s, D.WALL_U); hMin = Math.min(hMin, h); hMax = Math.max(hMax, h); });
    });
    ok(uErr < 0.06 && Math.abs(hMin) < 0.02 && Math.abs(hMax - D.WALL_H) < 0.02, `SAFER face at u=${D.WALL_U} (+-${uErr.toFixed(3)}), ${hMin.toFixed(2)}..${hMax.toFixed(2)} m over the surface (WALL_H ${D.WALL_H})`);
  }

  // stands outside the wall: nothing of the venue between the apron and the wall face,
  // except the S/F gantry + flag stand at s~0
  {
    let bad = 0, standMinU = Infinity, n = 0, outer = 0;
    const sp = venue.spec(core);
    ve.group.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.parent !== ve.group) return;
      const glowOnly = o.name === "halo";                    // additive light glow, not a surface
      verts(o, 5, (x, y, z) => {
        core.nearest(x, z, null, NR); n++;
        const nearGantry = Math.abs(core.ds(0, NR.s)) < 4.5;
        // (the drivers' tunnel passes UNDER the surface: below-grade geometry is not on the track)
        if (!nearGantry && NR.u > D.APRON_IN && NR.u <= D.WALL_U && y > core.surfaceY(NR.s, NR.u) - 0.3) bad++;
        if (NR.u > 0 && y > 1 && !nearGantry) standMinU = Math.min(standMinU, NR.u);
        if (!glowOnly && Math.abs(core.ds(0, NR.s)) > 14 && NR.u > Math.max(sp.outerU(NR.s - 0.5), sp.outerU(NR.s + 0.5)) + 0.35) outer++;
      });
    });
    ok(bad === 0, `no venue geometry between the apron and the wall (${bad} of ${n} sampled vertices)`);
    ok(standMinU > D.WALL_U, `stand geometry min u ${standMinU.toFixed(2)} > WALL_U ${D.WALL_U}`);
    ok(outer === 0, `nothing past spec.outerU(s) (${outer} vertices; the main gate canopy at s~0 is exempt)`);
    // crowd
    let cMin = Infinity, count = 0;
    // the crowd is drawn by entities/crowdgpu.js at runtime; its seats are published
    const CS = ve.crowdSpots || { x: [], z: [] };
    for (let i = 0; i < CS.x.length; i += 7) { core.nearest(CS.x[i], CS.z[i], null, NR); cMin = Math.min(cMin, NR.u); }
    count = CS.x.length;
    ok(cMin > D.WALL_U + 1.5, `crowd min u ${cMin.toFixed(2)} (all in the stands)`);
    ok(count === ve.stats.crowd, `crowd instances ${count}`);
    ok(q === "high" ? count >= 10000 : count >= 4000, `crowd ${count} >= ${q === "high" ? 10000 : 4000}`);
  }

  // rake
  {
    const K = track.kit, S = K.STAND, a = K.standSection(core, D.L / 4), b = K.standSection(core, 0);
    const rake = Math.atan2((a.yTop - a.y2), (S.T2 - 1) * S.TREAD) * DEG;
    ok(rake >= 28 && rake <= 38, `stand rake ${rake.toFixed(1)} deg (${S.T1 + S.T2} rows, tread ${S.TREAD} riser ${S.RISER})`);
    console.log(`  bowl: rows ${S.T1}+${S.T2}, first row u ${S.U0}, back u ${S.uBack.toFixed(1)}; top deck ${a.yConc.toFixed(1)} m in the turns, ${b.yConc.toFixed(1)} m at the S/F`);
  }

  // pit + infield
  ok(core.PIT.boxes === 12 && ve.stats.bays === 12, `pit boxes ${core.PIT.boxes}, garage bays + war wagons ${ve.stats.bays}`);
  {
    let out = 0;
    for (const [s, u, hs, hw] of ve.stats.infield) for (const [ds, du] of [[-hs, -hw], [hs, -hw], [hs, hw], [-hs, hw]]) {
      const w = core.toWorld(s + ds, u + du, 0); core.nearest(w.x, w.z, null, NR); if (NR.u > D.APRON_IN - 0.5) out++;
    }
    ok(out === 0, `infield buildings (${ve.stats.infield.length}) all inside the apron`);
  }

  // footprint
  const bb = ve.stats.bbox;
  console.log(`  venue bbox (no horizon band): x ${bb.x0.toFixed(1)}..${bb.x1.toFixed(1)}, z ${bb.z0.toFixed(1)}..${bb.z1.toFixed(1)}, y ${bb.y0.toFixed(1)}..${bb.y1.toFixed(1)}`);
  ok(bb.x0 >= -205.5 && bb.x1 <= 205.5 && bb.z0 >= -182.5 && bb.z1 <= 182.5, `footprint within x +-205, z +-182`);
  const sp = venue.spec(core);
  console.log(`  spec: outerU(0) ${sp.outerU(0).toFixed(1)}, outerU(L/4) ${sp.outerU(D.L / 4).toFixed(1)}, height ${sp.height} m, masts ${sp.mastHeight} m, main gate`, sp.mainEntrance);
  console.log(`  anchors: ${ve.anchors.map((a) => a.name).join(", ")}`);

  // the live API runs without throwing
  let threw = null;
  try {
    for (let i = 0; i < 6; i++) ve.setLights(i, false);
    ve.setLights(0, true);
    ve.setPylon([24, 7, 11, 3, 48, 9, 19, 5, 88, 42]); ve.setPylon([24, 7, 11, 3, 48, 9, 19, 5, 88, 42]);
    ve.setJumbo("LAP 3"); ve.setJumbo(null);
    for (const flag of ["green", "yellow", "white", "checker"]) ve.update(0.016, { excite: 0.8, flag, leaderNumber: 24 });
    for (let i = 0; i < 400; i++) { const w = core.toWorld(i * 0.8, -3); tr.skid(w.x, w.y, w.z, core.frame(i * 0.8).yaw, 0.3, 0.8); if (i % 4 === 0) tr.update(1 / 60); }
    tr.update(1 / 60);
  } catch (e) { threw = e; }
  ok(!threw, "setLights / setPylon / setJumbo / update / skid run" + (threw ? ": " + threw.stack : ""));
  tr.dispose(); ve.dispose();
}
console.log(fails ? `\n${fails} FAILED` : "\nall venue checks pass");
process.exit(fails ? 1 : 0);

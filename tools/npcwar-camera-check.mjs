#!/usr/bin/env node
/* tools/npcwar-camera-check.mjs — IS THE NPC WAR CAMERA STEADY?

   Owner, 2026-10-28: "The camera is fucking horrible. It glitches around so
   fast." This boots games/battle.html exactly as a player gets it (probe=0,
   so the director's slow-motion beats are in), freezes the rAF, and drives
   the page's own frame with __battle.advance(1/60) for SECS seconds, reading
   the lens after every frame. Desktop and a phone viewport with touch
   emulation, at several battle sizes.

   What it counts, per run:
     cuts      director cuts (a cut is meant to jump; excluded from the rest)
     jerk      frames where the view direction turned > 6 deg, or the eye
               moved > 3 m (180 m/s), with no cut on that frame
     maxTurn   the worst no-cut turn of the view direction, deg / frame
     p95Turn   95th percentile of it
     eyeJit    mean frame-to-frame change of the eye's VELOCITY, metres /
               frame (a steady pan is 0; a lens that wanders randomly
               every frame is not)
     subjSwaps the director's subject changed with no cut
     nan       frames with a non-finite camera

     node tools/npcwar-camera-check.mjs [--secs 20] [--sizes 30,1000,100000]
        [--views desktop,phone] [--shots <dir>]   (--shots: a frame strip)
   Exits 1 if any run has nan > 0 or jerk > 2 % of its frames.          */
import { launch, sleep } from "./lib/cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SECS = +arg("--secs", 20);
const SIZES = arg("--sizes", "30,1000,100000").split(",").map(Number);
const VIEWS = arg("--views", "desktop,phone").split(",");
const SHOTS = arg("--shots", "");
const MAP = arg("--map", "");
const EXTRA = arg("--q", "");
const WARM = +arg("--warm", 4);
const DUMP = arg("--dump", "");

const VIEW = {
  desktop: { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, touch: false },
  phone: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, touch: true },
};

const rig = await launch({ rafBudget: 0 });
const out = [];
let bad = 0;
try {
  for (const view of VIEWS) {
    const V = VIEW[view];
    await rig.send("Emulation.setDeviceMetricsOverride", { width: V.width, height: V.height, deviceScaleFactor: V.deviceScaleFactor, mobile: V.mobile });
    await rig.send("Emulation.setTouchEmulationEnabled", { enabled: V.touch, maxTouchPoints: V.touch ? 5 : 0 });
    for (const N of SIZES) {
      rig.clearErrors();
      await rig.open("games/battle.html", `auto=1&probe=0&red=${N}&blue=${N}` + (MAP ? "&map=" + MAP : "") + (EXTRA ? "&" + EXTRA : ""));
      await sleep(500);
      const up = await rig.wait("window.__battle && __battle.audit().started", 240000, 400);
      if (!up) { console.log(`${view} ${N}: never started`, rig.errors.slice(0, 3)); bad++; continue; }
      await rig.evl("__battle.freeze()");
      // a few seconds of march first: the record is of the battle, not the parade ground
      await rig.evl(`__battle.advance(${WARM}, 1/30)`);
      const frames = Math.round(SECS * 60);
      const t0 = Date.now();
      const rec = await rig.evl(`(() => {
        const c = CBZ.camera, R = [], F = new THREE.Vector3();
        for (let i = 0; i < ${frames}; i++) {
          __battle.advance(1/60);
          const d = __battle.director();
          c.getWorldDirection(F);
          R.push([c.position.x, c.position.y, c.position.z, F.x, F.y, F.z, c.fov, d.cuts, d.on, d.shot, d.mode, men.length, +cam.focus.x.toFixed(2), +cam.focus.z.toFixed(2), +simT.toFixed(3)]);
        }
        return R;
      })()`, false);
      const wall = ((Date.now() - t0) / 1000).toFixed(0);
      if (DUMP) { mkdirSync(DUMP, { recursive: true }); writeFileSync(path.join(DUMP, `${view}-${N}.json`), JSON.stringify(rec)); }
      // the numbers
      let cuts = 0, jerk = 0, nan = 0, maxTurn = 0, jit = 0, jn = 0, subj = 0;
      const turns = [];
      let pv = null;
      for (let i = 1; i < rec.length; i++) {
        const a = rec[i - 1], b = rec[i];
        if (!b.slice(0, 7).every(Number.isFinite)) { nan++; continue; }
        if (b[7] !== a[7]) { cuts++; pv = null; continue; }
        if (b[8] !== a[8]) subj++;
        const dot = Math.max(-1, Math.min(1, a[3] * b[3] + a[4] * b[4] + a[5] * b[5]));
        const turn = Math.acos(dot) * 180 / Math.PI;
        const mv = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        // the look point ~ eye + dir * (distance from eye to the ground-ish focus); use the eye velocity change
        const v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        if (pv) { jit += Math.hypot(v[0] - pv[0], v[1] - pv[1], v[2] - pv[2]); jn++; }
        pv = v;
        turns.push(turn);
        if (turn > maxTurn) maxTurn = turn;
        if (turn > 6 || mv > 3) jerk++;
      }
      turns.sort((x, y) => x - y);
      const p95 = turns.length ? turns[Math.floor(turns.length * 0.95)] : 0;
      const r = { view, N, frames: rec.length, cuts, subjSwaps: subj, jerk, maxTurn: +maxTurn.toFixed(2), p95Turn: +p95.toFixed(3),
        eyeJit: +(jit / Math.max(1, jn)).toFixed(4), nan, wall: wall + "s", errors: rig.errors.length };
      out.push(r);
      console.log(JSON.stringify(r));
      if (nan > 0 || jerk > rec.length * 0.02) bad++;
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        for (let k = 0; k < 4; k++) {
          await rig.evl("__battle.advance(0.5, 1/60); __battle.render()");
          const png = await rig.send("Page.captureScreenshot", { format: "png" });
          writeFileSync(path.join(SHOTS, `${view}-${N}-${k}.png`), Buffer.from(png.result.data, "base64"));
        }
      }
    }
  }
} finally {
  await rig.close();
}
console.log(bad ? "CAMERA: FAIL " + bad : "CAMERA: ok");
process.exit(bad ? 1 : 0);

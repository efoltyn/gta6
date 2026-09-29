#!/usr/bin/env node
/* ============================================================
   tools/race-check.mjs — THE RACING GAME, CHECKED IN PLAIN NODE.

   No browser. The circuit (race_core), then each area's own check:
     tools/race-check-car.mjs       the car: real dimensions, parts, draw calls
     tools/race-check-venue.mjs     track + stadium: widths, banks, stands, budget
     tools/race-check-physics.mjs   driving + AI: lap times, braking, grip, a 10-car race
     tools/race-check-game.mjs      the page loop itself: grid, lights, laps, flag, board, restart

     node tools/race-check.mjs            # everything
     node tools/race-check.mjs core       # the circuit only
============================================================ */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const only = process.argv[2] || "all";
let fails = 0;
const check = (name, ok, got) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${got != null ? "  (" + got + ")" : ""}`); };

// ---- the circuit -------------------------------------------------------------
const C = require(path.join(ROOT, "src/race/race_core.js"));
const D = C.DIMS;
const DEG = 180 / Math.PI;
check("lap closes on itself", D.closure < 0.01, D.closure.toExponential(2) + " m");
check("lap length is a half-mile bullring (740-880 m)", D.L > 740 && D.L < 880, D.L.toFixed(1) + " m");
check("racing surface 12-20 m wide", 2 * D.HALF_W >= 12 && 2 * D.HALF_W <= 20, 2 * D.HALF_W + " m");
let bMax = 0, bMin = 1, kMax = 0, jump = 0, prev = null;
for (let s = 0; s < D.L; s += 0.5) {
  const f = C.frame(s);
  bMax = Math.max(bMax, f.bank); bMin = Math.min(bMin, f.bank); kMax = Math.max(kMax, Math.abs(f.k));
  if (prev) jump = Math.max(jump, Math.abs(f.bank - prev.bank), Math.hypot(f.x - prev.x, f.z - prev.z) - 0.5);
  prev = f;
}
check("turn banking 22-30 deg", bMax * DEG >= 22 && bMax * DEG <= 30, (bMax * DEG).toFixed(1));
check("straight banking 4-10 deg", bMin * DEG >= 4 && bMin * DEG <= 10, (bMin * DEG).toFixed(1));
check("tightest turn radius 55-80 m", 1 / kMax >= 55 && 1 / kMax <= 80, (1 / kMax).toFixed(1) + " m");
check("bank and position are continuous (no step > 0.2 deg / 1 cm per 0.5 m)", jump < Math.max(0.2 / DEG, 0.01), jump.toFixed(4));
const wallTop = C.surfaceY(D.L * 0.27, D.WALL_U);
check("the high side of a turn stands 6-10 m over the apron", wallTop > 6 && wallTop < 10, wallTop.toFixed(2) + " m");
let worst = 0;
for (let i = 0; i < 400; i++) {
  const s = (i * 37.3) % D.L, u = -12 + (i * 7.7) % 22;
  const w = C.toWorld(s, u), n = C.nearest(w.x, w.z);
  worst = Math.max(worst, Math.abs(C.ds(n.s, s)), Math.abs(n.u - u));
}
check("nearest() inverts toWorld() to 5 cm", worst < 0.05, worst.toFixed(4) + " m");
const g0 = C.GRID.slot(0), g9 = C.GRID.slot(9);
check("the grid is on the front stretch, behind the line", C.ds(g9.s, 0) > 0 && C.ds(g0.s, 0) > 0 && C.ds(g9.s, 0) < 60, `${C.ds(g0.s, 0).toFixed(1)}..${C.ds(g9.s, 0).toFixed(1)} m back`);
check("the Gang City site holds the circuit (x within 205 m)", D.bbox.x1 + D.WALL_U < 205, (D.bbox.x1 + D.WALL_U).toFixed(1));

// ---- each area's own check -----------------------------------------------------
if (only === "all") {
  for (const f of ["race-check-car.mjs", "race-check-venue.mjs", "race-check-physics.mjs", "race-check-game.mjs"]) {
    const p = path.join(ROOT, "tools", f);
    if (!fs.existsSync(p)) { check(f + " exists", false); continue; }
    console.log(`\n---- ${f}`);
    const r = spawnSync(process.execPath, [p], { cwd: ROOT, stdio: "inherit" });
    check(f, r.status === 0, "exit " + r.status);
  }
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);

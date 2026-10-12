#!/usr/bin/env node
/* tools/convoy-check.mjs — THE ROAD SIDE OF THE CONVOY, in node. No browser.

   systems/roadgraph.js (CBZ.roadGraph, the one router: Gang City's
   motorcade, the map arrows, every column) and systems/convoy.js
   (CBZ.convoy) on road data, the way Gang City hands them over. NPC War's
   open-ground half (the terrain planner under fire) is
   tools/npcwar-headless.mjs scenario 18.

     1  THE GRAPH: a downtown grid with a divided highway, a service spur, a
        T-junction stopping at the kerb, a causeway docking 4 m off the grid
        and a diagonal avenue: every route is connected leg to leg, the lane
        is on the driver's right on every leg, the diagonal meets the grid.
     2  A ROAD OR A BRIDGE IS GONE: close() takes it out of every route,
        reopen() puts it back; G.ver counts.
     3  OPEN GROUND: a ridge with one pass and a lake: the terrain planner
        goes through the pass, never into the water, never up a slope the
        column cannot climb.
     4  THE ARMY SEAM: CBZ.convoy.fulfil(force, { kind: "move along route" })
        with real unit defs (Humvee, Abrams, MaxxPro, FMTV) on the city roads
        through the core host (units/kit/vehicle.js drive models): order of
        march, the right-hand lane, close intervals in town, the bridge on
        its route blown mid-march (re-routed), markers far from the lens and
        back without a jump, arrival.                                       */
import path from "node:path";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, passes = 0;
function check(ok, msg) { if (ok) { passes++; console.log("  PASS " + msg); } else { fails++; console.log("  FAIL " + msg); } }

const sb = { console, Math, JSON, Object, Array, Number, String, Boolean, Map, Set, WeakMap, Symbol, Error, Promise,
  Float64Array, Float32Array, Int32Array, Uint8Array, Uint16Array, isFinite, isNaN, parseFloat, parseInt };
sb.window = sb; sb.CBZ = {};
vm.createContext(sb);
const run = (rel) => vm.runInContext(fs.readFileSync(path.join(ROOT, rel), "utf8"), sb, { filename: rel });
for (const f of ["src/systems/roadgraph.js", "src/systems/convoy.js", "src/units/unitkit.js", "src/units/manifest.js", "src/units/kit/vehicle.js",
  "src/units/vehicles/hmmwv.js", "src/units/vehicles/m1_abrams.js", "src/units/vehicles/maxxpro_mrap.js", "src/units/vehicles/fmtv.js"]) run(f);
const CBZ = sb.CBZ, RG = CBZ.roadGraph, CV = CBZ.convoy;
// Gang City's lane rule (src/config.js roadLaneCenter): right-hand traffic, 3.4 m lanes
CBZ.roadLaneCenter = (r, dir, idx) => (r.vertical ? -1 : 1) * (dir < 0 ? -1 : 1) * ((r.median ? 1 : 0) + (Math.max(0, idx | 0) + 0.5) * 3.4);

/* the city: a 9 x 9 grid 80 m apart (downtown), a divided highway along z =
   160 west of it, a service spur, a T that stops at the kerb, a causeway
   docking 4 m off the north edge, a diagonal avenue across the south-east */
const roads = [];
for (let i = 0; i < 9; i++) {
  roads.push({ x: i * 80, z: 320, vertical: true, len: 640, w: 14, district: "downtown" });
  roads.push({ x: 320, z: i * 80, vertical: false, len: 640, w: 14, district: "downtown" });
}
roads.push({ x: -400, z: 160, vertical: false, len: 790, w: 28, district: "highway", median: true });     // ends 5 m short of the grid: a dock
roads.push({ x: 40, z: 100, vertical: true, len: 33, w: 10, access: "service" });
roads.push({ x: -800, z: 400, vertical: true, len: 480, w: 14, district: "suburb" });
const causeway = { x: -196, z: 644, vertical: false, len: 380, w: 14, district: "highway", bridge: true };   // 7 m off the grid's corner
roads.push(causeway);
roads.push({ ax: 640, az: 360, bx: 900, bz: 620, w: 14, district: "downtown" });         // a diagonal avenue

console.log("1  the graph");
const G = RG.build(roads);
check(G.segs.length === roads.length && G.nx.length > 100, "every record is a segment (" + G.segs.length + "), " + G.nx.length + " nodes");
let s = 11; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let ok = 0, bad = [], laneWrong = 0, legs = 0;
for (let k = 0; k < 300; k++) {
  const f = { x: -900 + rnd() * 1800, z: -40 + rnd() * 700 }, t = { x: -900 + rnd() * 1800, z: -40 + rnd() * 700 };
  const R = RG.route(G, f, t);
  if (!R || !R.ok) { bad.push(JSON.stringify([f, t])); continue; }
  // connected: every leg runs along its own segment (its ends on that road's surface), or is a dock connector
  let conn = true;
  for (let i = 0; i + 1 < R.pts.length; i++) {
    const a = R.pts[i], b = R.pts[i + 1], si = R.legs[i];
    if (si < 0) { if (Math.hypot(a.x - b.x, a.z - b.z) > 16) conn = false; continue; }
    const sg = G.segs[si];
    for (const p of [a, b]) { const tt = Math.max(0, Math.min(sg.len, (p.x - sg.ax) * sg.ux + (p.z - sg.az) * sg.uz)); if (Math.hypot(sg.ax + sg.ux * tt - p.x, sg.az + sg.uz * tt - p.z) > sg.hw + 2) conn = false; }   // on the road surface (a T meets past the end)
  }
  if (conn) ok++; else bad.push("disconnected " + JSON.stringify([f, t]));
  // the lane: every along-segment leg of the lane polyline sits right of its centreline
  const L = RG.lanes(G, R);
  for (let i = 0; i + 1 < L.pts.length; i++) {
    const a = L.pts[i], b = L.pts[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 15) continue;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, sn = RG.snap(G, mx, mz), sg = G.segs[sn.si];
    if (Math.abs(((b.x - a.x) * sg.uz - (b.z - a.z) * sg.ux) / len) > 0.05) continue;    // a corner, not a leg
    const fx = (b.x - a.x) / len, fz = (b.z - a.z) / len, rx = -fz, rz = fx;                  // the driver's right
    legs++;
    if ((mx - sn.x) * rx + (mz - sn.z) * rz < 0.5) laneWrong++;
  }
}
check(ok === 300, "300 random trips route, leg to leg (" + ok + "; " + bad.slice(0, 2).join(" ") + ")");
check(legs > 300 && laneWrong === 0, "on every one the lane is on the driver's right (" + legs + " legs, " + laneWrong + " wrong)");
const Rd = RG.route(G, { x: 700, z: 400 }, { x: 880, z: 600 });
check(Rd && Rd.ok && Rd.legs.some((si) => si >= 0 && G.segs[si].r.ax != null), "the diagonal avenue is part of the graph (a route uses it)");
const Rc = RG.route(G, { x: -380, z: 644 }, { x: 640, z: 100 });
check(Rc && Rc.ok && Rc.legs.some((si) => si >= 0 && G.segs[si].r === causeway), "the causeway docks onto the grid 7 m off its corner");
check(RG.route(G, { x: -700, z: 160 }, { x: 600, z: 160 }).legs.some((si) => si >= 0 && G.segs[si].r.district === "highway"), "a long trip takes the highway");

console.log("2  a road or a bridge is gone");
const before = RG.route(G, { x: -380, z: 644 }, { x: 320, z: 640 });
const v0 = G.ver, n = RG.close(G, -200, 644, 10);
const after = RG.route(G, { x: -380, z: 644 }, { x: 320, z: 640 });
check(n >= 1 && G.ver === v0 + 1 && G.closed.size >= 1, "close() shuts the causeway (" + n + " segment, ver " + G.ver + ")");
check(!after || !after.ok || !after.legs.some((si) => G.closed.has(si)), "no route uses it afterwards (" + (after && after.ok ? "routed round" : "no way across: honest") + ")");
const det = RG.route(G, { x: 320, z: 0 }, { x: 320, z: 640 });
RG.close(G, 320, 320, 5);
const det2 = RG.route(G, { x: 320, z: 0 }, { x: 320, z: 640 });
check(det2.ok && !det2.legs.some((si) => G.closed.has(si)) && det2.cost > det.cost, "a closed street in the grid is driven round (" + Math.round(det.cost) + " m -> " + Math.round(det2.cost) + " m)");
RG.reopen(G, 320, 320, 5); RG.reopen(G, -200, 644, 10);
check(G.closed.size === 0 && Math.abs(RG.route(G, { x: 320, z: 0 }, { x: 320, z: 640 }).cost - det.cost) < 1e-6, "reopen() puts them back");

console.log("3  open ground");
// a ridge along x = 300 (35 % flanks) with one pass at z = 150; a lake at (600, -100) r 90
const ridge = (x, z) => { const d = Math.abs(x - 300); const pass = Math.abs(z - 150) < 40 ? 0.15 : 1; return Math.max(0, 30 - d * 0.35) * pass; };
const world = { groundAt: ridge, waterAt: (x, z) => Math.hypot(x - 600, z + 100) < 90 };
const T = RG.terrain({ x: 0, z: -100 }, { x: 800, z: -100 }, world, { maxGrade: 0.3 });
const P = RG.path(T.pts, T.radii);
let wet = 0, steep = 0, passX = null;
for (let q = 0; q <= P.len; q += 2) {
  const p = RG.pathAt(P, q);
  if (world.waterAt(p.x, p.z)) wet++;
  const g = Math.max(Math.abs(ridge(p.x + 1, p.z) - ridge(p.x - 1, p.z)), Math.abs(ridge(p.x, p.z + 1) - ridge(p.x, p.z - 1))) / 2;
  if (g > 0.3 * 1.25) steep++;
  if (Math.abs(p.x - 300) < 3) passX = p.z;
}
check(T.ok && passX != null && Math.abs(passX - 150) < 45, "the route crosses the ridge through its pass (at z " + (passX == null ? "-" : passX.toFixed(0)) + ", " + Math.round(P.len) + " m)");
check(wet === 0, "and never goes into the lake (" + wet + " wet samples)");
check(steep === 0, "and never up a slope the column cannot climb (" + steep + " too steep)");
const Pl = RG.plan({ groundAt: ridge, waterAt: world.waterAt, roads: null }, { x: 0, z: -100 }, { x: 800, z: -100 }, { maxGrade: 0.3 });
check(Pl.kind === "terrain" && Pl.ok, "plan() falls back to the terrain where the map has no roads");
const Pr = RG.plan({ groundAt: () => 0, roads: roads }, { x: 5, z: 5 }, { x: 600, z: 620 }, {});
check(Pr.kind === "road" && Pr.ok && Pr.segs.size > 0, "and drives the roads where it has them");

console.log("4  the army seam: a column on the city's roads");
const defs = ["hmmwv", "fmtv", "maxxpro_mrap", "m1_abrams", "fmtv", "maxxpro_mrap"].map((id) => Object.assign({ id: id }, CBZ.unitKit.get(id)));
check(defs.every((d) => d && d.stats), "the unit files load in node (their defs drive the column)");
// core units, parked in a row on 2nd street in the order the army spawned them (not the order of march)
const units = defs.map((d, i) => ({ def: d, pos: { x: 160 + 2.1, y: 0, z: 40 + i * 14 }, h: 0, ds: { v: 0, w: 0, steer: 0 }, vs: { mobility: false } }));
let cam = { x: 160, z: 40 };
const town = (x, z) => { const sn = RG.snap(G, x, z); return !!sn && G.segs[sn.si].r.district !== "highway"; };
const host = CV.cityHost({ roads: () => roads, groundAt: () => 0, waterAt: null, speedLimit: (x, z) => 13.4, town: town, camPos: () => cam, collide: null });
const force = { side: "republic", units: units };
check(CV.handles("move along route"), "CBZ.convoy handles the army's 'move along route' order");
const cv = CV.fulfil(Object.assign(force, { host: host }), { kind: "move along route", to: { x: 640, z: 600 } });
check(!!cv && cv.plan.kind === "road", "fulfil() made a convoy on the road graph (" + (cv && cv.plan.kind) + ", " + (cv && Math.round(cv.P.len)) + " m)");
if (!cv) { console.log("\n" + passes + " passed, " + (fails + 1) + " failed"); process.exit(1); }
check(cv.members.map((m) => m.def.id).join(" ") === "hmmwv m1_abrams maxxpro_mrap fmtv fmtv maxxpro_mrap",
  "order of march: " + cv.members.map((m) => m.def.id).join(" > "));
const dt = 0.05;
let jumps = 0, tt = 0, laneOff = [], gapsTown = [], blown = false, lodSeen = false, lodBack = null;
const prev = units.map((u) => ({ x: u.pos.x, z: u.pos.z }));
while (!cv.done && tt < 600) {
  CV.tick(dt); tt += dt;
  units.forEach((u, k) => {
    const d = Math.hypot(u.pos.x - prev[k].x, u.pos.z - prev[k].z);
    if (cv.lod === "full" && d > Math.abs(u.ds.v) * dt * 1.5 + 0.2) jumps++;
    prev[k].x = u.pos.x; prev[k].z = u.pos.z;
  });
  if (cv.phase === "move" && tt > 20 && Math.round(tt / dt) % 20 === 0) {
    const a = CV.audit(cv);
    if (cv.members.every((m) => town(m.x, m.z))) gapsTown.push(...a.gaps);
    // every vehicle on the right of the road it is on (straight stretches)
    cv.members.forEach((m) => {
      const sn = RG.snap(G, m.x, m.z), sg = G.segs[sn.si];
      const along = Math.abs(Math.sin(m.h) * sg.ux + Math.cos(m.h) * sg.uz);
      if (along < 0.98 || sn.d > 8) return;
      const dir = Math.sign(Math.sin(m.h) * sg.ux + Math.cos(m.h) * sg.uz), rx = -Math.cos(m.h), rz = Math.sin(m.h);
      laneOff.push((m.x - sn.x) * rx + (m.z - sn.z) * rz);
    });
  }
  // the bridge on its way is blown once the column is rolling
  if (!blown && tt > 40) {
    const P0 = cv.P, sL = cv.members[0].s;
    for (let q = sL + 80; q < P0.len - 60; q += 10) {
      const p = RG.pathAt(P0, q), sn = RG.snap(G, p.x, p.z);
      if (sn.d < 6 && G.segs[sn.si].r.vertical === false && G.segs[sn.si].r.district === "downtown") { blown = { x: sn.x, z: sn.z, q: q }; break; }
    }
    if (blown) CV.roadClosed(blown.x, blown.z, 6);
    else blown = true;
  }
  // markers: the lens 4 km away for 20 s, then back on the column
  if (tt > 70 && tt < 70 + dt) cam = { x: 9000, z: 9000 };
  if (cv.lod === "marker") lodSeen = true;
  if (tt > 90 && tt < 90 + dt) cam = { x: cv.members[0].x, z: cv.members[0].z };
  if (lodSeen && cv.lod === "full" && lodBack == null) lodBack = tt;
}
const lane = laneOff.reduce((a, b) => a + b, 0) / Math.max(1, laneOff.length);
check(laneOff.length > 50 && lane > 1 && lane < 3.5, "the column drives the right-hand lane (mean " + lane.toFixed(2) + " m right of the centreline over " + laneOff.length + " samples)");
const gm = gapsTown.reduce((a, b) => a + b, 0) / Math.max(1, gapsTown.length);
check(gapsTown.length > 20 && gm > 18 && gm < 34, "closed up to ~25 m intervals in town (mean " + gm.toFixed(0) + " m)");
const rr = cv.log.find((e) => e.kind === "reroute" && e.why === "road closed");
check(blown && blown.x != null && !!rr, "a street on its route was blown mid-march: it re-routed (" + JSON.stringify(rr || null) + ")");
if (blown && blown.x != null) {
  let near = Infinity; const sL = cv.members[0].s;
  for (let i = 0; i < cv.P.n; i++) near = Math.min(near, Math.hypot(cv.P.x[i] - blown.x, cv.P.z[i] - blown.z));
  check(near > 7, "and the new route stays off the closed street (" + near.toFixed(1) + " m from the crater)");
}
check(lodSeen && lodBack != null, "far from the lens it became markers, and drove again when the lens came back (" + (lodBack ? lodBack.toFixed(1) + " s" : "-") + ")");
check(jumps === 0, "no vehicle ever moved further in a step than its speed carried it (" + jumps + ")");
check(cv.done && cv.log.some((e) => e.kind === "done" && e.why === "arrived"), "it arrived (" + tt.toFixed(0) + " s, " + cv.phase + ")");
const lead = units.find((u) => u.def.id === "hmmwv");
check(Math.hypot(lead.pos.x - 640, lead.pos.z - 600) < 30, "the lead stands at the objective (" + Math.round(Math.hypot(lead.pos.x - 640, lead.pos.z - 600)) + " m off)");

console.log("\n" + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);

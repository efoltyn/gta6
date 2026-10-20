#!/usr/bin/env node
/* tools/island-stairs-check.mjs — THE ISLAND'S STAIRS AND ROOFS, AUDITED IN NODE.

   OWNER: "The stairs start all the way at the wall, so there needs to be an
   area to get onto the stairs at the bottom" and "one-floor buildings have
   stairs that go to the roof, but then the roof has no colliders."

   Runs the island's own plan (world/island_roads.js + world/island_plan.js),
   probes every building's facade crown with the kit's own dry run
   (city/facade_kit.js CBZ.facadeCrownProbe, every grammar in city/facades/),
   and asks world/island_building.js for the shell plan disaster_arena.js
   builds — the same functions, the same numbers, no browser, no THREE.
   Then it walks every plan and counts what a person would trip on:

     landing     a flight's bottom or top has no landing (or floor) at least
                 a lane deep in the walking direction, at its own height
     wall        a flight's bottom or top nosing is closer than a landing's
                 depth to the wall it walks toward (the old foot-of-the-
                 stair-against-the-front-wall)
     pitch       a riser outside 0.17-0.19 m or a going outside 0.25-0.28 m
     headroom    under 2.05 m clear over any nosing (a landing, slab, flight
                 or roof above it in its lane)
     connect     a landing that does not meet its floor's slab (or, on the
                 ground floor, an approach that does not reach the door walk)
     roof        a roof the stair reaches without: a walkable slab under the
                 whole walk area, a bulkhead with a doorway onto it, a parapet
                 on every open edge, a clear apron outside the door, and a
                 collider for every crown piece standing in head height on it
     reach       an upper floor no stair reaches
     tower       a lift tower whose roof stop has no parapet on every edge or
                 an un-collided crown piece over its walk ring

     node tools/island-stairs-check.mjs          # the report; exit 1 on any violation
     node tools/island-stairs-check.mjs -v       # every building's plan line
     node tools/island-stairs-check.mjs --json   # the numbers as JSON
     node tools/island-stairs-check.mjs --legacy # the old hand-laid stair, same rules */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const V = argv.includes("-v"), JSON_OUT = argv.includes("--json");
// --legacy: the same audit over the stair disaster_arena.js laid by hand
// before world/island_building.js (the "before" number, kept so the rules
// can be shown to bite)
const LEGACY = argv.includes("--legacy");

// ---- the game's own files in a bare context -------------------------------
const ctx = { console, Math, Object, Array, Set, Map, WeakMap, JSON, Number, String, Boolean, Symbol, Error, TypeError,
  Infinity, NaN, isFinite, isNaN, parseInt, parseFloat, Float32Array, Float64Array, Uint8Array, Uint16Array, Uint32Array, Int32Array,
  URLSearchParams };
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
ctx.location = { search: "", href: "http://x/", hostname: "x" };
ctx.CBZ = { CONFIG: {} };
vm.createContext(ctx);
const load = (rel) => vm.runInContext(readFileSync(path.join(ROOT, rel), "utf8"), ctx, { filename: rel });
const html = readFileSync(path.join(ROOT, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script src="([^"?]+)(\?[^"]*)?"/g)].map((m) => m[1]);
load("src/core/seed.js");
if (existsSync(path.join(ROOT, "src/city/facade_openings.js"))) load("src/city/facade_openings.js");
load("src/city/facade_kit.js");
for (const f of scripts.filter((s) => /^src\/city\/facades\//.test(s))) load(f);
load("src/world/island_roads.js");
load("src/world/island_plan.js");
load("src/world/island_building.js");
const CBZ = ctx.CBZ, IB = CBZ.islandBuilding;

// the facade table the arena hands the plan (ids + storey ranges)
const ids = [], tall = {}, low = {};
for (const f of CBZ.facadeList()) {
  ids.push(f.id);
  const def = CBZ.facadeDef(f.id);
  if (def.minStoreys) tall[f.id] = def.minStoreys;
  if (def.maxStoreys !== Infinity) low[f.id] = def.maxStoreys;
}
const cfgSrc = readFileSync(path.join(ROOT, "src/config.js"), "utf8");
const am = /arena:\s*\{\s*cx:\s*(-?\d+),\s*cz:\s*(-?\d+),\s*radius:\s*(\d+)/.exec(cfgSrc);
const A = am ? { cx: +am[1], cz: +am[2], R: +am[3] } : { cx: 0, cz: 600, R: 240 };
const PLAN = CBZ.islandPlan.make({ cx: A.cx, cz: A.cz, R: A.R, facades: ids, tall, low });

const FH = IB.FH, R = IB.RULE, EPS = 1e-6;
const violations = [];
const rows = [];
const bad = (b, kind, msg) => violations.push({ id: b.id, kind: b.kind, style: b.style, what: kind, msg });
const ov = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
const inside = (r, x0, x1, z0, z1, tol) => r.x0 <= x0 + (tol || 1e-4) && r.x1 >= x1 - (tol || 1e-4) && r.z0 <= z0 + (tol || 1e-4) && r.z1 >= z1 - (tol || 1e-4);

// the walkable surfaces at a height, from a shell plan: ground floor (the
// whole room), slabs, landings
function surfacesAt(P, y) {
  const out = [];
  if (Math.abs(y - IB.FLOOR0) < 0.1) out.push({ x0: P.ix[0], x1: P.ix[1], z0: P.iz[0], z1: P.iz[1], what: "ground" });
  for (const s of P.slabs) if (Math.abs(s.y - y) < 0.02) out.push(Object.assign({ what: "slab" }, s));
  for (const l of P.landings) if (Math.abs(l.y - y) < 0.02) out.push(Object.assign({ what: "landing" }, l));
  return out;
}
// is the rect [x0,x1]x[z0,z1] at height y covered by those surfaces? (0.1 m grid)
function covered(surfs, x0, x1, z0, z1) {
  for (let x = x0 + 0.05; x < x1; x += 0.1) for (let z = z0 + 0.05; z < z1; z += 0.1) {
    if (!surfs.some((s) => x >= s.x0 - 1e-4 && x <= s.x1 + 1e-4 && z >= s.z0 - 1e-4 && z <= s.z1 + 1e-4)) return false;
  }
  return true;
}

function checkShell(b, P) {
  const [ixMin, ixMax] = P.ix, [izMin, izMax] = P.iz;
  const LD = R.landMin;
  // every upper floor reachable
  const reach = P.levels;
  if (reach < P.storeys - 1) bad(b, "reach", `stair reaches level ${reach} of ${P.storeys - 1}`);
  for (const F of P.flights) {
    const tag = `flight ${F.k} (L${F.L0}->L${F.L1})`;
    // pitch
    if (F.rise < R.riseMin - EPS || F.rise > R.riseMax + EPS) bad(b, "pitch", `${tag} rise ${F.rise.toFixed(3)} m`);
    if (F.going < R.goMin - EPS || F.going > R.goMax + EPS) bad(b, "pitch", `${tag} going ${F.going.toFixed(3)} m`);
    // walls: the walking direction is F.dir along z; the bottom's wall is
    // behind the bottom nosing, the top's wall ahead of the top nosing
    const wallBehind = F.dir > 0 ? F.zb - izMin : izMax - F.zb;
    const wallAhead = F.dir > 0 ? izMax - F.zt : F.zt - izMin;
    if (wallBehind < LD - EPS) bad(b, "wall", `${tag} bottom nosing ${wallBehind.toFixed(2)} m from the wall`);
    if (wallAhead < LD - EPS) bad(b, "wall", `${tag} top nosing ${wallAhead.toFixed(2)} m from the wall`);
    // the lane sits in the room, clear of the side walls
    if (F.x0 < ixMin - EPS || F.x1 > ixMin + IB.SW + EPS) bad(b, "wall", `${tag} lane outside the stair strip`);
    // landings: the stair's full width, a lane deep, at the flight's own height
    const bz0 = F.dir > 0 ? F.zb - LD : F.zb, bz1 = F.dir > 0 ? F.zb : F.zb + LD;
    const tz0 = F.dir > 0 ? F.zt : F.zt - LD, tz1 = F.dir > 0 ? F.zt + LD : F.zt;
    if (!covered(surfacesAt(P, F.yb), F.x0, F.x1, bz0, bz1)) bad(b, "landing", `${tag} no landing at its foot (y ${F.yb.toFixed(2)})`);
    if (!covered(surfacesAt(P, F.yt), F.x0, F.x1, tz0, tz1)) bad(b, "landing", `${tag} no landing at its head (y ${F.yt.toFixed(2)})`);
    // a rail on every side that is not the building's wall (the other lane,
    // or the room a storey below): nobody steps off a flight sideways
    for (const xs of [F.x0, F.x1]) {
      if (Math.abs(xs - ixMin) < 0.02) continue;
      const rails = P.guards.filter((g) => g.kind === "rail" && xs >= g.x0 - 1e-3 && xs <= g.x1 + 1e-3);
      const z0 = Math.min(F.zb, F.zt), z1 = Math.max(F.zb, F.zt);
      let gap = false;
      for (let z = z0 + 0.05; z < z1; z += 0.1) if (!rails.some((g) => z >= g.z0 - 1e-3 && z <= g.z1 + 1e-3)) { gap = true; break; }
      if (gap) bad(b, "rail", `${tag} has no rail on its open side at x ${xs.toFixed(2)}`);
    }
    // headroom over every nosing
    for (let i = 0; i < F.risers; i++) {
      const z = F.zb + F.dir * i * F.going, y = F.yb + (i + 1) * F.rise;
      let clear = Infinity;
      const over = (x0, x1, z0, z1, yUnder) => {
        if (ov(x0, x1, F.x0 + 0.05, F.x1 - 0.05) > 0 && z > z0 && z < z1 && yUnder > y + 0.05) clear = Math.min(clear, yUnder - y);
      };
      for (const l of P.landings) over(l.x0, l.x1, l.z0, l.z1, l.y - 0.2);
      for (const s of P.slabs) over(s.x0, s.x1, s.z0, s.z1, s.y - 0.2);
      for (const G of P.flights) {
        if (G === F) continue;
        const za = Math.min(G.zb, G.zt + G.dir * G.going), zc = Math.max(G.zb, G.zt + G.dir * G.going);
        if (z <= za || z >= zc || ov(G.x0, G.x1, F.x0, F.x1) <= 0) continue;
        const t = (z - G.zb) / (G.dir * G.going * G.risers);
        const soffit = G.yb + t * (G.yt - G.yb) - 0.32;
        if (soffit > y + 0.05) clear = Math.min(clear, soffit - y);
      }
      if (P.roof.bulkhead) over(P.roof.bulkhead.x0, P.roof.bulkhead.x1, P.roof.bulkhead.z0, P.roof.bulkhead.z1, P.roof.bulkhead.y1);
      if (clear < R.head - EPS) { bad(b, "headroom", `${tag} nosing ${i + 1}: ${clear.toFixed(2)} m clear`); break; }
    }
  }
  // every integer landing meets its floor's slab along the stair strip's edge
  for (const l of P.landings) {
    if (l.L % 1 !== 0) {
      if (!P.guards.some((g) => g.kind === "half" && Math.abs(g.L - l.L) < EPS && g.z0 <= l.z0 + 0.06 && g.z1 >= l.z1 - 0.06)) bad(b, "connect", `half landing L${l.L} has no guard on its room side`);
      continue;
    }
    const slab = P.slabs.find((s) => s.L === l.L && s.part === "room");
    if (!slab || Math.abs(slab.x0 - l.x1) > 0.02 || ov(slab.z0, slab.z1, l.z0, l.z1) < LD - EPS) bad(b, "connect", `landing L${l.L} does not meet its floor`);
  }
  // the ground approach: in front of the first flight, reaching the walk from the door
  if (P.flights.length) {
    const a = P.approach;
    if (!a || a.z0 > izMin + 0.01 || a.z1 - a.z0 < LD - EPS) bad(b, "connect", "no approach to the first flight from the door walk");
  }
  // the knee walls: every upper floor's stairwell edge is guarded except at its landing
  for (let L = 1; L < P.storeys + (P.roof.access ? 0 : 0); L++) {
    if (L > P.levels) continue;
    const lg = P.landingAt(L);
    const open = [[izMin, izMax]];
    const cut = (z0, z1) => { for (let i = open.length - 1; i >= 0; i--) { const o = open[i]; if (z1 <= o[0] || z0 >= o[1]) continue; open.splice(i, 1); if (o[0] < z0) open.push([o[0], z0]); if (z1 < o[1]) open.push([z1, o[1]]); } };
    if (lg) cut(lg.z0 - 0.06, lg.z1 + 0.06);
    for (const g of P.guards) if (g.kind === "knee" && g.L === L) cut(g.z0, g.z1);
    for (const o of open) if (o[1] - o[0] > 0.12) bad(b, "connect", `floor L${L}: the stairwell edge is open from z ${o[0].toFixed(2)} to ${o[1].toFixed(2)}`);
  }

  // THE ROOF
  const RF = P.roof;
  const reachesRoof = P.flights.some((F) => Math.abs(F.yt - P.rTop) < 0.02);
  if (reachesRoof !== RF.access) bad(b, "roof", `the stair ${reachesRoof ? "reaches" : "does not reach"} the roof but the plan says access=${RF.access}`);
  if (reachesRoof) {
    const W = RF.walk;
    if (!W) bad(b, "roof", "a stair reaches the roof and there is no roof walk");
    else {
      if (!covered(surfacesAt(P, P.rTop).filter((s) => s.what === "slab"), W.x0, W.x1, W.z0, W.z1)) bad(b, "roof", "the roof walk is not all slab (a collider)");
      // every open edge of the walk has a parapet; the -x edge is the bulkhead's front
      const hw = P.w / 2, hd = P.d / 2;
      const edge = (x0, x1, z0, z1, name) => {
        if (!RF.parapets.some((p) => inside(p, x0, x1, z0, z1, 0.02) && p.y1 - p.y0 >= 0.7)) bad(b, "roof", `no parapet on the roof's ${name} edge`);
      };
      edge(W.x0, hw, hd - IB.WT, hd, "+z");
      edge(W.x0, hw, -hd, -hd + IB.WT, "-z");
      edge(hw - IB.WT, hw, W.z0, W.z1, "+x");
      const BK = RF.bulkhead;
      if (!BK) bad(b, "roof", "a stair reaches the roof with no bulkhead over it");
      else {
        const front = BK.walls.filter((wl) => wl.solid && Math.abs(wl.x0 - P.sEdge) < 0.02);
        const door = RF.door;
        if (!door || door.z1 - door.z0 < R.landMin - 0.15) bad(b, "roof", "the bulkhead has no doorway a lane wide");
        else {
          // the front wall closes the strip everywhere but the doorway
          let span = 0;
          for (const wl of front) span += wl.z1 - wl.z0;
          if (Math.abs(span + (door.z1 - door.z0) - (izMax - izMin)) > 0.05) bad(b, "roof", "the bulkhead's front wall leaves a gap besides the door");
          const top = P.landings.find((l) => Math.abs(l.y - P.rTop) < 0.02);
          if (!top || door.z0 < top.z0 - 1e-3 || door.z1 > top.z1 + 1e-3) bad(b, "roof", "the bulkhead door is not where the stair arrives");
          // the apron outside the door: walk, and no crown piece without a collider
          if (!covered(surfacesAt(P, P.rTop).filter((s) => s.what === "slab"), P.sEdge + IB.BXT, P.sEdge + IB.BXT + IB.APRON, door.z0, door.z1)) bad(b, "roof", "no roof outside the bulkhead door");
          if (b.head.some((c) => ov(c[0], c[1], P.sEdge + IB.BXT, P.sEdge + IB.BXT + IB.APRON) > 0.01 && ov(c[4], c[5], door.z0, door.z1) > 0.01)) bad(b, "roof", "crown outside the bulkhead door");
        }
        for (const side of ["-x", "-z", "+z"]) {
          const ok = side === "-x" ? BK.walls.some((wl) => wl.solid && Math.abs(wl.x0 + P.w / 2) < 0.02 && wl.z1 - wl.z0 >= P.d - 0.02)
            : BK.walls.some((wl) => wl.solid && (side === "-z" ? Math.abs(wl.z0 + P.d / 2) < 0.02 : Math.abs(wl.z1 - P.d / 2) < 0.02));
          if (!ok) bad(b, "roof", `the bulkhead has no ${side} wall`);
        }
      }
      // every crown piece in head height over the walk is a collider
      let ghosts = 0, area = 0;
      for (const c of b.head) {
        const x0 = Math.max(c[0], W.x0), x1 = Math.min(c[1], W.x1), z0 = Math.max(c[4], W.z0), z1 = Math.min(c[5], W.z1);
        if (x1 - x0 <= 0.02 || z1 - z0 <= 0.02) continue;
        if (!RF.solids.some((s) => inside(s, x0, x1, z0, z1, 0.01) && s.y1 >= c[3] - 0.01)) { ghosts++; area += (x1 - x0) * (z1 - z0); }
      }
      if (ghosts) bad(b, "roof", `${ghosts} crown pieces (${area.toFixed(1)} m2) stand on the roof walk with no collider`);
    }
  } else if (P.storeys >= 1) {
    // the roof nobody climbs: closed over the strip (it is the top floor's ceiling)
    if (!covered(surfacesAt(P, P.rTop).filter((s) => s.what === "slab"), ixMin, ixMax, izMin, izMax)) bad(b, "roof", "the unreached roof is open over the stairwell");
  }
}

function checkTower(b, T) {
  if (!T.access) return;
  const hw = b.w / 2, hd = b.d / 2, tw = 0.4;
  const edges = [[-hw, hw, hd - tw, hd, "+z"], [-hw, hw, -hd, -hd + tw, "-z"], [-hw, -hw + tw, -hd + tw, hd - tw, "-x"], [hw - tw, hw, -hd + tw, hd - tw, "+x"]];
  for (const e of edges) if (!T.parapets.some((p) => inside(p, e[0], e[1], e[2], e[3], 0.02) && p.y1 - p.y0 >= 1.0)) bad(b, "tower", `no parapet on the roof's ${e[4]} edge`);
  let ghosts = 0;
  for (const c of b.head) for (const r of T.walk) {
    const x0 = Math.max(c[0], r.x0), x1 = Math.min(c[1], r.x1), z0 = Math.max(c[4], r.z0), z1 = Math.min(c[5], r.z1);
    if (x1 - x0 <= 0.02 || z1 - z0 <= 0.02) continue;
    if (!T.solids.some((s) => inside(s, x0, x1, z0, z1, 0.01))) ghosts++;
  }
  if (ghosts) bad(b, "tower", `${ghosts} crown pieces stand on the roof ring with no collider`);
}


/* THE OLD STAIR, AS IT WAS LAID (disaster_arena.js before 2026-10-20), in
   the plan's shape: nine risers a storey (0.38 m), the first 0.3 m off the
   front wall, a 1.1 m landing at the top only, a flight to the roof of every
   building whatever its facade stood there, no crown colliders, no parapet on
   a tower's roof. */
function legacyPlan(w, d, storeys, crown) {
  const WT = IB.WT, SW = IB.SW, LANE = SW / 2;
  const ixMin = -w / 2 + WT, ixMax = w / 2 - WT, izMin = -d / 2 + WT, izMax = d / 2 - WT;
  const sEdge = ixMin + SW, rTop = storeys * FH, LDo = 1.1, zA = izMin + 0.3, zB = izMax - 0.3;
  const P = { w, d, storeys, ix: [ixMin, ixMax], iz: [izMin, izMax], sEdge, rTop, flights: [], landings: [], slabs: [], guards: [], levels: storeys,
    approach: { x0: ixMin, x1: ixMin + LANE, z0: izMin, z1: zA }, roof: { access: true, walk: { x0: sEdge, x1: ixMax, z0: izMin, z1: izMax, y: rTop }, parapets: [], solids: [], bulkhead: null, door: null } };
  P.landingAt = (L) => P.landings.find((l) => l.L === L) || null;
  for (let k = 0; k < storeys; k++) {
    const dir = k % 2 === 0 ? 1 : -1, startZ = dir > 0 ? zA : zB, endZ = dir > 0 ? zB : zA, rampEndZ = endZ - dir * LDo;
    const lx0 = ixMin + (k % 2) * LANE, run = Math.abs(rampEndZ - startZ);
    P.flights.push({ k, lane: k % 2, x0: lx0, x1: lx0 + LANE, dir, zb: startZ, zt: rampEndZ, yb: k * FH, yt: (k + 1) * FH, risers: 9, rise: FH / 9, going: run / 9, L0: k, L1: k + 1 });
    const lz0 = dir > 0 ? rampEndZ - 0.1 : izMin, lz1 = dir > 0 ? izMax : rampEndZ + 0.1;
    P.landings.push({ L: k + 1, y: (k + 1) * FH, x0: ixMin, x1: ixMin + SW, z0: lz0, z1: lz1 });
  }
  for (let L = 1; L <= storeys; L++) P.slabs.push({ L, y: L * FH, x0: sEdge, x1: ixMax, z0: izMin, z1: izMax, part: "room" });
  const knee = (L) => {
    const lg = P.landingAt(L), y = L * FH, add = (z0, z1) => { if (z1 - z0 >= 0.1) P.guards.push({ kind: "knee", L, x0: sEdge, x1: sEdge + 0.1, z0, z1, y0: y, y1: y + 0.99 }); };
    if (!lg) add(izMin, izMax); else if (lg.z0 <= izMin + 0.01) add(lg.z1 + 0.05, izMax); else add(izMin, lg.z0 - 0.05);
  };
  for (let L = 1; L < storeys; L++) knee(L);
  const bx1 = sEdge + 0.12;
  const bulk = !crown.some((c) => c[1] > -w / 2 && c[0] < bx1 && c[5] > -d / 2 && c[4] < d / 2 && c[3] > rTop + 0.7 && c[2] < rTop + 2.9);
  const R = P.roof, pp = (x0, x1, z0, z1) => R.parapets.push({ x0, x1, z0, z1, y0: rTop, y1: rTop + 0.76 });
  pp(sEdge, w / 2, d / 2 - WT, d / 2); pp(w / 2 - WT, w / 2, -d / 2 + WT, d / 2 - WT); pp(sEdge, w / 2, -d / 2, -d / 2 + WT);
  const top = P.landingAt(storeys);
  if (bulk) {
    const dz0 = Math.max(izMin, top.z0 + 0.05), dz1 = Math.min(izMax, top.z1 - 0.05);
    R.door = { z0: dz0, z1: dz1 };
    R.bulkhead = { x0: -w / 2, x1: bx1, z0: -d / 2, z1: d / 2, y0: rTop, y1: rTop + 2.6, walls: [
      { x0: -w / 2, x1: -w / 2 + WT, z0: -d / 2, z1: d / 2, solid: true }, { x0: -w / 2 + WT, x1: bx1, z0: -d / 2, z1: -d / 2 + WT, solid: true },
      { x0: -w / 2 + WT, x1: bx1, z0: d / 2 - WT, z1: d / 2, solid: true }, { x0: sEdge, x1: bx1, z0: izMin, z1: dz0, solid: true },
      { x0: sEdge, x1: bx1, z0: dz1, z1: izMax, solid: true }] };
  } else {
    pp(-w / 2, -w / 2 + WT, -d / 2, d / 2); pp(-w / 2 + WT, sEdge, -d / 2, -d / 2 + WT); pp(-w / 2 + WT, sEdge, d / 2 - WT, d / 2); knee(storeys);
  }
  return P;
}

// ---- every lot -------------------------------------------------------------
const HOUSE_PALETTE = 0xd8cdb8;     // the crown does not depend on colour; any will do
const byKind = {};
let roofs = 0, roofsReached = 0, flights = 0;
for (const l of PLAN.lots) {
  if (l.kind === "station" || l.kind === "showroom") continue;   // no upstairs, no roof access
  const b = { id: l.id, kind: l.kind, style: l.style || null, storeys: l.storeys, w: l.w, d: l.d };
  const k = byKind[l.kind] || (byKind[l.kind] = { n: 0, roof: 0, flights: 0 });
  k.n++;
  if (l.kind === "tower" || l.kind === "hotel") {
    // the arena's makeTower numbers
    const storeys = Math.max(4, Math.round(l.storeys * FH / FH)), realH = storeys * FH, TW = 0.4;
    const s = Math.min(l.w / 2 - TW, l.d / 2 - TW) * 0.42;
    const fc = IB.facadeCtx({ ox: l.x, oz: l.z, w: l.w, d: l.d, storeys, fh: FH, wt: TW, rTop: realH, pp: 0.6, doorSide: 0, color: HOUSE_PALETTE, style: l.style });
    if (l.helipad) fc.keepClear = [{ x0: -l.w / 2 - 1, x1: l.w / 2 + 1, z0: -l.d / 2 - 1, z1: l.d / 2 + 1, y0: realH - 0.3, y1: realH + 120 }];
    let lift = null;
    try { lift = CBZ.facadeLiftTop(fc, { x0: -s, x1: s, z0: -s, z1: s }, { ring: 1.2 }); } catch (e) { lift = null; }
    // the dressed crown is the probe's, minus the keep-clear carve
    let crown = CBZ.facadeCrownProbe(fc);
    const keep = (lift ? lift.keepClear : []).concat(fc.keepClear || []);
    const sub = CBZ.FACADE_F && CBZ.FACADE_F.subtractBox;
    if (sub) for (const kc of keep) {
      const next = [];
      for (const c of crown) {
        const hit = c[1] > kc.x0 && c[0] < kc.x1 && c[5] > kc.z0 && c[4] < kc.z1 && c[3] > kc.y0 && c[2] < (kc.y1 != null ? kc.y1 : Infinity);
        if (hit) next.push(...sub(c, kc)); else next.push(c);
      }
      crown = next;
    }
    const T = LEGACY ? { access: !(lift && lift.roofBuried), parapets: [], solids: [], walk: IB.towerRoof({ w: l.w, d: l.d, tw: TW, realH, s, crown: [], roofStop: true }).walk }
      : IB.towerRoof({ w: l.w, d: l.d, tw: TW, realH, s, crown, roofStop: !(lift && lift.roofBuried) });
    b.head = crown.filter((c) => c[2] < realH + 0.1 + R.head + 0.05 && c[3] > realH + 0.25);
    checkTower(b, T);
    if (T.access) { roofs++; roofsReached++; k.roof++; }
    rows.push(`${l.id} ${l.kind} ${l.style} ${storeys}st lift roof ${T.access ? "stop" : "buried"} parapets ${T.parapets.length} solids ${T.solids.length}`);
    continue;
  }
  const rTop = l.storeys * FH;
  const fc = IB.facadeCtx({ ox: l.x, oz: l.z, w: l.w, d: l.d, storeys: l.storeys, fh: FH, wt: IB.WT, rTop, pp: 0.7, doorSide: 0, color: HOUSE_PALETTE, style: l.style });
  const crown = l.style ? CBZ.facadeCrownProbe(fc) : [];
  const P = LEGACY ? legacyPlan(l.w, l.d, l.storeys, crown) : IB.plan({ w: l.w, d: l.d, storeys: l.storeys, crown });
  b.head = crown.filter((c) => c[2] < rTop + R.head + 0.05 && c[3] > rTop + 0.15);
  checkShell(b, P);
  roofs++; if (P.roof.access) { roofsReached++; k.roof++; }
  flights += P.flights.length; k.flights += P.flights.length;
  rows.push(`${l.id} ${l.kind} ${l.style} ${l.storeys}st ${l.w}x${l.d} ${P.mode} ${P.flights.length} flights` +
    (P.flights.length ? ` rise ${P.flights[P.flights.length - 1].rise.toFixed(3)} going ${P.flights[0].going.toFixed(3)} landing ${(P.approach.z1 - P.approach.z0).toFixed(2)}` : "") +
    ` roof ${P.roof.access ? "REACHED (" + P.roof.solids.length + " crown solids)" : "closed: " + P.roof.why}`);
}

/* THE SWEEP: the planner over shells the island does not have (yet) — rooms
   too short for a straight flight (the dog-leg), tall narrow ones, a flat
   roof and a fully crowned one — so a future lot cannot walk into a case
   nobody ever audited. Same rules, its own count. */
let swept = 0, sweptBad = 0, doglegs = 0;
if (!LEGACY) {
  const before = violations.length;
  const FULL = (w, d, st) => [[-w / 2, w / 2, st * FH, st * FH + 3, -d / 2, d / 2]];   // a hipped roof's mass
  for (const w of [8, 10.5, 14, 22]) for (const d of [6.5, 7.5, 8.5, 10, 13, 18]) for (const st of [1, 2, 3, 6]) for (const full of [false, true]) {
    const crown = full ? FULL(w, d, st) : [];
    const P = IB.plan({ w, d, storeys: st, crown });
    const b = { id: `sweep ${w}x${d}/${st}${full ? "/crowned" : ""}`, kind: "sweep", style: null, head: crown.filter((c) => c[2] < st * FH + R.head + 0.05 && c[3] > st * FH + 0.15) };
    if (P.mode === "dogleg") doglegs++;
    checkShell(b, P);
    swept++;
  }
  sweptBad = violations.length - before;
}

const byWhat = violations.reduce((o, v) => { o[v.what] = (o[v.what] || 0) + 1; return o; }, {});
if (JSON_OUT) {
  console.log(JSON.stringify({ violations: violations.length, byWhat, byKind, roofs, roofsReached, flights, list: violations }, null, 1));
} else {
  console.log(`ISLAND STAIRS + ROOFS${LEGACY ? " (LEGACY: the old hand-laid stair)" : ""}: ${PLAN.lots.length} lots, ${flights} flights, ${roofsReached}/${roofs} roofs reachable`);
  for (const k in byKind) console.log(`  ${k.padEnd(8)} ${String(byKind[k].n).padStart(3)} buildings, ${String(byKind[k].flights).padStart(3)} flights, ${byKind[k].roof} roofs reached`);
  if (V) for (const r of rows) console.log("  " + r);
  if (!LEGACY) console.log(`SWEEP: ${swept} synthetic shells (${doglegs} dog-legs), ${sweptBad} violations`);
  console.log(`VIOLATIONS: ${violations.length}` + (violations.length ? "  " + JSON.stringify(byWhat) : ""));
  for (const v of violations.slice(0, V ? 400 : 40)) console.log(`  x ${v.id} ${v.kind}/${v.style} [${v.what}] ${v.msg}`);
}
process.exit(LEGACY ? 0 : violations.length ? 1 : 0);

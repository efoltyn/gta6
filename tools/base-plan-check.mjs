#!/usr/bin/env node
/* tools/base-plan-check.mjs — is every military base laid out like one?

   Loads src/world/basekit.js in node (the planner is pure data) and audits
   the plans the game actually raises:
     • Fort Brandt (city/island_military.js, also NPC War's MILITARY ISLAND),
       with the deep shelter bunkers.js digs reserved;
     • the portable air base (world/airbase.js) at its default size.
   A plan fails if any structure overlaps another, anything sits on the
   runway, an aircraft is parked off the pavement or outside its shelter,
   two parked machines overlap, or anything is outside the wire.

   usage: node tools/base-plan-check.mjs [--verbose]                       */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { console, module: { exports: {} } };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, "src/world/basekit.js"), "utf8"), ctx, { filename: "basekit.js" });
const CBZ = ctx.CBZ;
const verbose = process.argv.includes("--verbose");

// the Fort Brandt build: the same call island_military.js makes
const fortOpts = { hx: 240, hz: 250, northGate: 60, fighters: 5, hangars: 2,
  reserve: [{ id: "brandt-shelter", x: -142, z: -172, w: 36, d: 30 }] };
// the portable base: world/airbase.js's default 1800 m runway on a 2040 x 760 pad
const portOpts = { hx: 1020, hz: 380, northGate: null, fighters: 8, hangars: 4, runwayLength: 1800 };

let fail = 0;
for (const [name, o] of [["Fort Brandt", fortOpts], ["portable airbase", portOpts]]) {
  const P = CBZ.basePlan(o);
  const bad = CBZ.basePlanAudit(P);
  const air = P.stands.filter((s) => /fighter|drone|b2|bomber|cargo|heli/i.test(s.kind)).length;
  console.log(`${bad.length ? "FAIL" : "PASS"}  ${name}: ${P.build.length} structures, ${P.stands.length} parked (${air} aircraft), ` +
    `${P.pave.length} paved areas, runway ${P.runway.len} m`);
  for (const b of bad) console.log("      - " + b);
  if (verbose) for (const s of P.stands) console.log(`        ${s.kind.padEnd(10)} ${String(s.x).padStart(6)} ${String(s.z).padStart(6)} yaw ${(s.yaw || 0).toFixed(2)}${s.shelter ? " in " + s.shelter : ""}`);
  // every aircraft has a taxi path that ends on the runway centreline
  for (const s of P.stands) {
    if (!/fighter|b2|bomber|cargo|heli/i.test(s.kind) || s.shelter && /hangar/.test(s.shelter)) continue;
    for (const dir of [1, -1]) {
      const t = CBZ.baseTaxiPath(P, s, dir);
      const last = t.points[t.points.length - 1];
      if (Math.abs(last.z - P.runway.z) > 0.01 || last.x < P.runway.x0 || last.x > P.runway.x1) {
        console.log(`      - ${s.kind}@${s.x},${s.z} taxi path does not end on the runway`); bad.push("taxi");
      }
    }
  }
  if (bad.length) fail++;
}
process.exit(fail ? 1 : 0);

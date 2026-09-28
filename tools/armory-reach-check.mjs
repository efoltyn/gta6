#!/usr/bin/env node
/* tools/armory-reach-check.mjs — CAN YOU GET TO THE C4 ON EVERY RUN?

   Owner, 2026-09-28: "if for some reason nobody has a key to the room with
   the explosives in it for the jail game, that's kind of dumb. That room
   should be accessible, but hard to access."

   The C4 crate (and the M249 / RPG / 40mm / bolt sniper) sits in the gun
   room's INNER CAGE (world/gunroom.js). Two doors deep:

     OUTER  Keycard: the block desk card, a rank-2 officer's belt, or the Old
            Timer (systems/escapeplan.js PRICE). Cop role walks in on staff keys.
     CAGE   Gun-Room Key on a real belt (the warden, or the run's ARMORY
            SERGEANT carrying the duplicate), the warden's safe at night, a
            bent officer's copy once he trusts you, OR a Hacksaw Blade (the
            workshop bench / the Old Timer) ground through the padlock.

   This loads the REAL systems/economy.js in a vm against the REAL guard
   roster parsed out of entities/guards.js, and for N run seeds proves:
     1. the warden wears the cage key on every seed (it was a 70% roll)
     2. exactly one ordinary officer carries the duplicate, and he is one of
        the three officers whose beat passes nearest the gun-room door
     3. the sergeant is not the same man every run (it is seeded)
     4. a downed / cuffed man's belt is a near-certain lift
     5. every seed has at least one route through each door (the static
        routes are checked against the files that own them)

     node tools/armory-reach-check.mjs [--n 200]   exit 0 = ok */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const argv = process.argv.slice(2);
const N = argv.indexOf("--n") >= 0 ? Number(argv[argv.indexOf("--n") + 1]) : 200;

let fails = 0;
const rows = [];
function check(ok, name, detail) { rows.push({ ok, name, detail }); if (!ok) fails++; }

// ---- the real roster: every makeGuard([...waypoints], ..., opts) in guards.js
const guardsSrc = read("src/entities/guards.js");
const ROSTER = [];
for (const m of guardsSrc.matchAll(/^\s*makeGuard\((\[\[.*?\]\])\s*,[^{\n]*?(\{[^}]*\})?\);/gm)) {
  const wps = JSON.parse(m[1]).map((p) => ({ x: p[0], z: p[1] }));
  const kind = m[2] && /kind:\s*"warden"/.test(m[2]) ? "warden" : "guard";
  const post = m[2] && (m[2].match(/post:\s*"(\w+)"/) || [])[1];
  const rank = m[2] && (m[2].match(/rank:\s*(\d)/) || [])[1];
  ROSTER.push({ wps, kind, post: post || null, rank: rank ? +rank : 0 });
}
check(ROSTER.length >= 20 && ROSTER.filter((r) => r.kind === "warden").length === 1,
  "guards.js roster parsed", `${ROSTER.length} officers, 1 warden`);

const econSrc = read("src/systems/economy.js");
const DOOR = { x: 19, z: 1 };
const beatD = (r) => Math.min(...r.wps.map((p) => Math.hypot(p.x - DOOR.x, p.z - DOOR.z)));
const nearest3 = ROSTER.map((r, i) => ({ i, d: beatD(r), kind: r.kind }))
  .filter((r) => r.kind === "guard").sort((a, b) => a.d - b.d || a.i - b.i).slice(0, 3).map((r) => r.i);

function loadEcon(seed) {
  let s = seed >>> 0 || 1;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const noop = () => {};
  const game = { mode: "escape", state: "playing", cigs: 0, inventory: {}, koLog: {}, role: "inmate", elapsed: 0 };
  const CBZ = {
    game, el: { cigText: {} }, CONFIG: {}, onUpdate: noop, sfx: noop, npcs: [{}], guards: [],
  };
  const ctx = vm.createContext({
    window: { CBZ }, CBZ, console, Math: Object.assign(Object.create(Math), { random: rand }),
    document: { createElement: () => ({ style: {}, appendChild: noop, addEventListener: noop }), getElementById: () => null, body: { appendChild: noop } },
    performance: { now: () => 0 }, setTimeout: noop, clearTimeout: noop,
  });
  vm.runInContext(econSrc, ctx, { filename: "src/systems/economy.js" });
  CBZ.guards = ROSTER.map((r, i) => ({
    kind: r.kind, waypoints: r.wps, post: r.post, rank: r.rank, data: { name: "Officer " + i },
    group: { position: { x: r.wps[0].x, z: r.wps[0].z } },
  }));
  return CBZ;
}

let wardenAll = true, oneDup = true, dupNear = true, anyOuter = true, anyCage = true;
const sergeants = new Set();
let downedOdds = 1;
// the static half of the route table, read from the files that own each route
const escSrc = read("src/systems/escapeplan.js");
const yardSrc = read("src/world/yardfurniture.js");
const kcSrc = read("src/entities/keycard.js");
const gunSrc = read("src/world/gunroom.js");
const awSrc = read("src/world/adminwing.js");
const deskCard = /const KX = [\d.]+, KZ = -?[\d.]+/.test(kcSrc);
const oldTimerCard = /PRICE = \{[^}]*"Keycard"/.test(escSrc);
const oldTimerSaw = /PRICE = \{[^}]*"Hacksaw Blade"/.test(escSrc);
const benchSaw = /item: "Hacksaw Blade"/.test(yardSrc);
const cageTakesSaw = /hasItem\("Hacksaw Blade"\)/.test(gunSrc) && /inner\.saw >= 6/.test(gunSrc);
const cageTakesKey = /keys: \["Gun-Room Key"\]/.test(gunSrc);
const sawIsHeard = /inner\.heard = true/.test(gunSrc);
const safeHook = /keyOnHook/.test(awSrc) && /layDrop\("Gun-Room Key"/.test(awSrc);
check(deskCard && oldTimerCard, "outer door: desk card + Old Timer card exist", `desk=${deskCard} oldTimer=${oldTimerCard}`);
check(cageTakesKey && cageTakesSaw && (benchSaw || oldTimerSaw), "cage: key lock + hacksaw route with a blade source", `key=${cageTakesKey} saw=${cageTakesSaw} bench=${benchSaw} oldTimer=${oldTimerSaw}`);
check(sawIsHeard, "sawing the cage is heard (guards come, it is a crime)");
check(safeHook, "the warden's key moves hip <-> safe hook (one object)");

for (let seed = 1; seed <= N; seed++) {
  const CBZ = loadEcon(seed * 7919);
  const E = CBZ.econ;
  E.reseed();
  E.mintLoadouts();
  const holders = CBZ.guards.filter((a) => a.loadout && a.loadout.items.includes("Gun-Room Key"));
  const w = CBZ.guards.find((a) => a.kind === "warden");
  if (!holders.includes(w)) wardenAll = false;
  const dups = holders.filter((a) => a.kind === "guard");
  if (dups.length !== 1) oneDup = false;
  else {
    const idx = CBZ.guards.indexOf(dups[0]);
    sergeants.add(idx);
    if (!nearest3.includes(idx)) dupNear = false;
  }
  // routes that exist on THIS seed
  const cardBelts = CBZ.guards.filter((a) => a.loadout && a.loadout.items.includes("Keycard")).length;
  const outer = (deskCard ? 1 : 0) + (oldTimerCard ? 1 : 0) + cardBelts;
  const cage = holders.length + (benchSaw || oldTimerSaw ? 1 : 0) + (safeHook ? 1 : 0);
  if (!outer) anyOuter = false;
  if (!cage) anyCage = false;
  // a man on the floor
  const t = dups[0] || w;
  t.ko = 5;
  downedOdds = Math.min(downedOdds, E.stealOdds(t));
  t.ko = 0;
}
check(wardenAll, "warden wears the cage key on every seed", `${N} seeds`);
check(oneDup, "exactly one officer carries the duplicate on every seed");
check(dupNear, "the duplicate is on one of the 3 officers nearest the gun-room door", `nearest=${nearest3.join(",")}`);
check(sergeants.size >= 2, "the armory sergeant changes between runs", `distinct=${[...sergeants].join(",")}`);
check(downedOdds >= 0.9, "a downed officer's belt is a near-certain lift", `min odds ${downedOdds.toFixed(2)}`);
check(anyOuter && anyCage, "every seed has a route through BOTH doors", `outer=${anyOuter} cage=${anyCage}`);

for (const r of rows) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}${r.detail ? "  (" + r.detail + ")" : ""}`);
console.log(fails ? `FAIL: ${fails}` : "PASS");
process.exit(fails ? 1 : 0);

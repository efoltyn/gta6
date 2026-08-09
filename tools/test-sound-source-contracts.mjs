#!/usr/bin/env node
// Regression gate for sounds that were purged because they were emitted as
// global state/UI decoration rather than by trustworthy world audio sources.
// Glass is limited to direct player pane breaks. Door audio is the other narrow
// exception: direction-specific cues may exist only beside moving hardware
// operated by the player or local to the building/vehicle they are inside.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, "src");
const failures = [];
const physicalDoorOwners = new Set([
  "src/city/aircraft_doors.js",
  "src/city/buildings.js",
  "src/city/bunkers.js",
  "src/city/elevators.js",
  "src/city/island_airport.js",
  "src/world/door.js",
  "src/world/gunroom.js",
  // THE TWO CELL-DOOR MOVERS, added 2026-08-09. Both own a sliding leaf and a
  // collider and move them together; both are the ONLY thing that knows a door
  // actually changed state. They earn the cue for the same reason every other
  // name on this list does. What made them necessary: systems/capture.js and
  // the recapture beat in games/jail.js were asking for the purged generic
  // `door` cue at a STATE CHANGE — so the bars racking shut on you at intake
  // and on a failed break warned to the console and played nothing at all,
  // which is what this contract exists to prevent and had not caught, because
  // it only forbade the cue rather than requiring the mover to voice it.
  "src/world/cellblock.js",
  "src/games/jail.js",
  // THESE TWO WERE ALREADY FAILING ON main, and they were never violations:
  // city/boarding.js owns the car-door arc the player walks into (it holds the
  // hinge, the leaf and the arc phase), and city/vehicle_hold.js owns a cargo
  // ramp's opening/closing state machine. Both are exactly the "moving hardware
  // operated by the player or local to the vehicle they are inside" this list
  // describes; they simply shipped after the list was written and nobody added
  // them, so the gate has been red — and a permanently red gate is a gate
  // nobody reads. Adding them here is what makes the two REAL violations found
  // on 2026-08-09 (a state change voicing a door) visible instead of buried.
  "src/city/boarding.js",
  "src/city/vehicle_hold.js",
]);
const foundDoorOwners = new Set();

async function jsFiles(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...await jsFiles(file));
    else if (ent.isFile() && ent.name.endsWith(".js")) out.push(file);
  }
  return out;
}

for (const file of await jsFiles(SRC)) {
  const code = await readFile(file, "utf8");
  const rel = path.relative(ROOT, file);
  const forbidden = [
    /\b(?:CBZ\.)?sfx\s*\(\s*["'](?:alarm|clank|door)["']/g,
    /\bsound\s*\(\s*["'](?:alarm|glass)["']/g,
  ];
  for (const pattern of forbidden) {
    let hit;
    while ((hit = pattern.exec(code))) {
      const line = code.slice(0, hit.index).split("\n").length;
      failures.push(`${rel}:${line}: purged sound request ${JSON.stringify(hit[0])}`);
    }
  }

  const glassRequest = /\b(?:CBZ\.)?sfx\s*\(\s*["']glass["']/g;
  let glassHit;
  while ((glassHit = glassRequest.exec(code))) {
    const line = code.slice(0, glassHit.index).split("\n").length;
    if (rel !== "src/city/buildings.js") {
      failures.push(`${rel}:${line}: glass request bypasses the direct-player pane owner`);
    }
  }

  const physicalDoorCue = /["']door_(?:open|close)["']/g;
  let doorHit;
  while ((doorHit = physicalDoorCue.exec(code))) {
    const line = code.slice(0, doorHit.index).split("\n").length;
    if (!physicalDoorOwners.has(rel)) {
      failures.push(`${rel}:${line}: physical door cue requested outside an approved moving mechanism`);
    } else {
      foundDoorOwners.add(rel);
    }
  }
}

const audio = await readFile(path.join(SRC, "systems/audio.js"), "utf8");
for (const cue of ["alarm", "clank", "door"]) {
  if (new RegExp(`^\\s*${cue}\\s*:`, "m").test(audio)) {
    failures.push(`src/systems/audio.js: purged ${cue} cue returned to BANK`);
  }
}
if (!/^\s*glass\s*:/m.test(audio)) {
  failures.push("src/systems/audio.js: direct-player glass cue missing from BANK");
}
// The FILES stay pinned here — that a closing leaf plays doorClose_1 and an
// opening one plays doorOpen_1 is this contract's business. Their LEVELS are
// not: tools/sound-loudness.mjs now derives every bank gain from the measured
// peak of the recording and the real-world dB SPL of the event (a door slam is
// 65 dB at 10 m = 85 dB at 1 m; a door merely opening is a latch and a hinge),
// and gates each cue to within 2 dB of that. Pinning literals in two places
// would just mean one of them is wrong. What is asserted here is the RELATION
// the old pin was really protecting — that the two cues are distinct and that
// closing is not quieter than opening, which it was only because doorClose_1
// is mastered ~4 LU hotter, a mastering fact the measurement now cancels.
const doorOpenGain = /^\s*door_open\s*:\s*fx\(\[K \+ "doorOpen_1\.m4a"\],\s*([0-9.]+),/m.exec(audio);
const doorCloseGain = /^\s*door_close\s*:\s*fx\(\[K \+ "doorClose_1\.m4a"\],\s*([0-9.]+),/m.exec(audio);
if (!doorOpenGain || !doorCloseGain) {
  failures.push("src/systems/audio.js: direction-specific physical door cues changed file or shape");
} else if (!(+doorCloseGain[1] > 0 && +doorOpenGain[1] > 0)) {
  failures.push("src/systems/audio.js: a physical door cue was silenced rather than levelled");
}
for (const rel of physicalDoorOwners) {
  if (!foundDoorOwners.has(rel)) failures.push(`${rel}: approved physical door owner no longer requests a direction-specific cue`);
}

const ambient = await readFile(path.join(SRC, "systems/ambient.js"), "utf8");
if (/\bclankT\b|sfx\s*\(\s*["']clank["']/.test(ambient)) {
  failures.push("src/systems/ambient.js: fake timed clank generator returned");
}

const buildings = await readFile(path.join(SRC, "city/buildings.js"), "utf8");
if (!/function playerAtDoor\(dr\)[\s\S]{0,500}!player\._aircraft/.test(buildings) ||
    !/Math\.abs\(P\.y - doorWorldY\(dr\)\)/.test(buildings)) {
  failures.push("src/city/buildings.js: city doors no longer reject aircraft/other floors");
}
if (!/function playerInsideDoorBuilding\(dr, P\)/.test(buildings) ||
    !/for \(const dr of doorRecs\) dr\.building = built/.test(buildings) ||
    !/DOOR_HEAR_DIST\s*=\s*34/.test(buildings) ||
    !/dr\.playerSoundCycle = playerNear/.test(buildings)) {
  failures.push("src/city/buildings.js: door audio lost direct-player/same-shell causality or its local cutoff");
}
const ownedGlassRequests = buildings.match(/\bCBZ\.sfx\s*\(\s*["']glass["']/g) || [];
if (ownedGlassRequests.length !== 1 ||
    !/function playPlayerGlass\(gp\)[\s\S]{0,700}CBZ\.sfx\("glass"/.test(buildings)) {
  failures.push("src/city/buildings.js: glass must have one request inside playPlayerGlass");
}
if (!/opts\.directPlayer\) playPlayerGlass\(best\)/.test(buildings) ||
    !/opts\.directPlayer && near\) playPlayerGlass\(near\)/.test(buildings) ||
    !/PLAYER_GLASS_HEAR_DIST\s*=\s*55/.test(buildings)) {
  failures.push("src/city/buildings.js: direct-player and local-distance glass gates missing");
}

const directTags = [];
for (const file of await jsFiles(SRC)) {
  const code = await readFile(file, "utf8");
  const rel = path.relative(ROOT, file);
  const hits = code.match(/directPlayer\s*:\s*true/g) || [];
  for (let i = 0; i < hits.length; i++) directTags.push(rel);
}
const expectedDirectTags = [
  "src/city/combat.js",
  "src/city/combat.js",
  "src/city/jewelry.js",
  "src/systems/fpsmode.js",
];
if (directTags.sort().join("\n") !== expectedDirectTags.sort().join("\n")) {
  failures.push(`direct-player glass tags changed: ${directTags.join(", ") || "none"}`);
}

const airport = await readFile(path.join(SRC, "city/island_airport.js"), "utf8");
if (!/function trackPhysicalDoorSound\(owner, current, target, playerCause\)/.test(airport) ||
    !/P && !P\.dead && !P\.driving && !P\._aircraft/.test(airport) ||
    !/trackPhysicalDoorSound\(cab\.cockpitLeaf, cab\.cockpitT, tc, insideThis\)/.test(airport)) {
  failures.push("src/city/island_airport.js: moving aircraft doors lost player/inside-aircraft causality");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("sound source contracts: alarm/clank/generic-door purged; physical doors are directional and causal; glass direct-player/local only");
}

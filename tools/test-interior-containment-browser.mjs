#!/usr/bin/env node
// Structural + real-Chrome regression for indoor fixtures.
//
// The normal interior clamp sees only b.lbox calls made while a dresser runs.
// Bank, gun, jewelry, clothing, pawn, realty, airport and forex modules build
// later with raw THREE meshes on the world root. This gate first finds that
// source pattern and requires those modules to register a host shell, then
// boots deterministic worlds and checks every registered mesh/instance AABB
// against its building's inner wall faces.
//
// Usage:
//   node tools/test-interior-containment-browser.mjs
//   node tools/test-interior-containment-browser.mjs --seeds 90210,1337
//   node tools/test-interior-containment-browser.mjs --static-only

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const argS = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : fallback;
};
const seeds = argS("--seeds", "90210").split(",")
  .map((s) => +s.trim()).filter(Number.isFinite);
const steps = Math.max(1, +argS("--step", "20") || 20);
const staticOnly = argv.includes("--static-only");
const failures = [];

function fail(message) {
  failures.push(message);
  console.error("  ✗ " + message);
}
function pass(message) {
  console.log("  ✓ " + message);
}

async function source(rel) {
  return readFile(path.join(ROOT, rel), "utf8");
}
async function jsFiles(rel) {
  const out = [];
  async function walk(dir) {
    const entries = await readdir(path.join(ROOT, dir), { withFileTypes: true });
    for (const entry of entries) {
      const next = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(next);
      else if (entry.isFile() && entry.name.endsWith(".js")) out.push(next);
    }
  }
  await walk(rel);
  return out;
}

console.log("INTERIOR CONTAINMENT — source coverage");
const files = [...await jsFiles("src/city"), ...await jsFiles("src/sim")];
const lateDisplayFiles = [];
for (const rel of files) {
  const text = await source(rel);
  if (/function\s+buildDisplays\s*\(/.test(text) &&
      /new\s+THREE\.Group\s*\(/.test(text) &&
      /\broot\.add\s*\(\s*group\s*\)/.test(text)) {
    lateDisplayFiles.push(rel);
    if (!/interiorTrackFixture\s*\(/.test(text))
      fail(`${rel} builds a late raw display group but does not register an interior host`);
  }
}
if (lateDisplayFiles.length === 6 &&
    lateDisplayFiles.every((rel) => !failures.some((f) => f.startsWith(rel)))) {
  pass(`all ${lateDisplayFiles.length} late buildDisplays modules register a host shell`);
} else if (lateDisplayFiles.length !== 6) {
  fail(`late display census changed: expected 6 modules, found ${lateDisplayFiles.length} (${lateDisplayFiles.join(", ")})`);
}

const expectedSites = {
  "src/city/gunstore.js": "gun-store",
  "src/city/jewelry.js": "jewelry-store",
  "src/city/bank.js": "bank-lobby",
  "src/city/pawnshop.js": "pawn-shop",
  "src/city/clothingstore.js": "clothing-store",
  "src/city/realtyoffice.js": "realty-office",
};
for (const [rel, site] of Object.entries(expectedSites)) {
  const text = await source(rel);
  if (!text.includes(`interiorTrackFixture("${site}"`))
    fail(`${rel} is missing fixture site "${site}"`);
}

const forex = await source("src/sim/forex.js");
for (const site of ["forex-airport", "forex-bank"]) {
  if (!forex.includes(`interiorTrackFixture("${site}"`))
    fail(`src/sim/forex.js is missing fixture site "${site}"`);
}
if (!/arena\.airportTerminal/.test(forex))
  fail("forex airport kiosk no longer derives from the live terminal host");
if (/AIRPORT_KIOSK|Sits just outside the branch/.test(forex))
  fail("forex restored a copied airport coordinate or an explicitly exterior bank desk");

const airport = await source("src/city/island_airport.js");
if (!/city\.airportTerminal\s*=\s*terminal/.test(airport) ||
    !/interiorTrackFixture\(\s*"airport-terminal"/.test(airport))
  fail("airport terminal does not publish and register its interior fixture group");

const casino = await source("src/city/casino.js");
if (!/interiorBounded[\s\S]{0,180}dressInterior/.test(casino))
  fail("casino raw lbox dresser bypasses the shared interior boundary");
const buildings = await source("src/city/buildings.js");
if (!/bounded\(b,\s*"exec-office"/.test(buildings))
  fail("executive office dresser bypasses the shared interior boundary");
const town = await source("src/city/towngen.js");
if (!/interiorBounded\(b,\s*drawCounter,\s*"town-counter"\)/.test(town))
  fail("town shop counter bypasses the shared interior boundary");

const owner = await source("src/city/interior_programs.js");
for (const api of ["interiorTrackFixture", "interiorFixtureAudit", "interiorContainsWorldBox"]) {
  if (!owner.includes(`CBZ.${api}`)) fail(`shared interior owner is missing CBZ.${api}`);
}
if (!failures.length) pass("late fixtures and direct lbox dressers are covered by one boundary owner");

if (staticOnly) {
  if (failures.length) {
    console.error(`INTERIOR CONTAINMENT: FAIL (${failures.length})`);
    process.exit(1);
  }
  console.log("INTERIOR CONTAINMENT: PASS (static)");
  process.exit(0);
}

const EXPECTED_RUNTIME = [
  "airport-terminal", "bank-lobby", "clothing-store", "forex-airport",
  "forex-bank", "gun-store", "jewelry-store", "pawn-shop", "realty-office",
];
const expression = `(function () {
  const audit = CBZ.interiorAudit();
  const lot = CBZ.cityBankLot && CBZ.cityBankLot();
  const b = lot && lot.building;
  const shell = b && CBZ.interiorWorldShell(b);
  let synthetic = null;
  if (shell) {
    const inside = {
      minX: shell.minX + 0.1, maxX: shell.minX + 0.2,
      minY: shell.minY + 0.1, maxY: shell.minY + 0.2,
      minZ: shell.minZ + 0.1, maxZ: shell.minZ + 0.2
    };
    const outside = Object.assign({}, inside, {
      minX: shell.minX - 1.0, maxX: shell.minX - 0.5
    });
    synthetic = {
      inside: CBZ.interiorContainsWorldBox(b, inside).inside,
      outside: CBZ.interiorContainsWorldBox(b, outside).inside
    };
  }
  return {
    spill: audit.spill,
    spillCaught: audit.spillCaught,
    spillUnbounded: audit.spillUnbounded,
    spillSites: audit.spillSites,
    fixtureGroups: audit.fixtureGroups,
    fixturePieces: audit.fixturePieces,
    fixtureOutside: audit.fixtureOutside,
    fixtureUnbounded: audit.fixtureUnbounded,
    fixtureInvalid: audit.fixtureInvalid,
    fixtureSites: audit.fixtureSites,
    fixtureEscapes: audit.fixtureEscapes,
    synthetic: synthetic
  };
})()`;

console.log("INTERIOR CONTAINMENT — real Chrome");
for (const seed of seeds) {
  let result;
  let stderr = "";
  try {
    const run = await execFileAsync(process.execPath, [
      path.join(ROOT, "tools/probe.mjs"),
      "--isolated", "--seed", String(seed), "--step", String(steps), expression,
    ], { cwd: ROOT, maxBuffer: 20 * 1024 * 1024, timeout: 600000 });
    stderr = run.stderr || "";
    result = JSON.parse(run.stdout);
  } catch (error) {
    const detail = [error.message, error.stderr, error.stdout].filter(Boolean).join("\n").slice(0, 2400);
    fail(`seed ${seed} browser audit could not run\n${detail}`);
    continue;
  }

  const sites = result.fixtureSites || {};
  const missing = EXPECTED_RUNTIME.filter((site) => !sites[site]);
  if (missing.length) fail(`seed ${seed} missing runtime fixture sites: ${missing.join(", ")}`);
  if (result.spill !== 0) fail(`seed ${seed} has ${result.spill} physical piece(s) outside their host shell`);
  if (result.fixtureOutside !== 0) fail(`seed ${seed} has ${result.fixtureOutside} escaped fixture group(s)`);
  if (result.fixtureUnbounded !== 0 || result.spillUnbounded !== 0)
    fail(`seed ${seed} has unbounded interior work (fixture=${result.fixtureUnbounded}, total=${result.spillUnbounded})`);
  if (result.fixtureInvalid !== 0) fail(`seed ${seed} has ${result.fixtureInvalid} mesh(es) with invalid bounds`);
  if (!result.synthetic || result.synthetic.inside !== true || result.synthetic.outside !== false)
    fail(`seed ${seed} containment oracle failed its inside/outside control`);

  console.log(`  seed ${seed}: ${result.fixtureGroups} fixture groups, ${result.fixturePieces} physical pieces`);
  for (const site of Object.keys(sites).sort()) {
    const s = sites[site];
    const b = s.bounds;
    const span = b
      ? `x ${b.minX.toFixed(1)}..${b.maxX.toFixed(1)}, z ${b.minZ.toFixed(1)}..${b.maxZ.toFixed(1)}`
      : "no physical bounds";
    console.log(`    ${site.padEnd(18)} ${String(s.pieces).padStart(3)} pieces  ${span}`);
  }
  if (result.spillCaught) {
    console.log(`    build-time clamp corrected ${result.spillCaught} attempted spill(s): ${JSON.stringify(result.spillSites)}`);
  }
  if (result.fixtureEscapes && result.fixtureEscapes.length) {
    for (const e of result.fixtureEscapes.slice(0, 20))
      console.error(`    ESCAPE ${e.site} ${e.object}: ${JSON.stringify(e.overBy)}`);
  }
  if (/console errors:/i.test(stderr))
    console.error(`    browser diagnostics: ${stderr.trim().split("\n").slice(-1)[0]}`);
}

if (failures.length) {
  console.error(`INTERIOR CONTAINMENT: FAIL (${failures.length})`);
  process.exit(1);
}
console.log(`INTERIOR CONTAINMENT: PASS (${seeds.length} seed${seeds.length === 1 ? "" : "s"})`);

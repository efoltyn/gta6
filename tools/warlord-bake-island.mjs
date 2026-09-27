#!/usr/bin/env node
/* warlord-bake-island: THE DESERT ISLAND AS A WAR MAP, baked from the game's
   own terrain so the strategic map and the ground you ride are one island.

   Loads core.js + desert.js in Node (they are pure maths until build()),
   seeds 1337, samples heightAt/biomeAt/slopeAt per tile, reproduces
   campaign.js's outpost placement (its own seeded stream) and
   territory.js's region anchors (a pure function of the island), and writes
   src/warlord/war/maps/island.js in the map format of CONTRACT.md section 1.

   node tools/warlord-bake-island.mjs [--seed 1337] [--grid 220]
*/
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SEED = +opt("--seed", 1337);
const GRID = +opt("--grid", 220);

require(join(ROOT, "src/warlord/core.js"));
require(join(ROOT, "src/warlord/desert.js"));
const W = globalThis.CBZ.warlord;
const D = W.desert;
D.reseed(SEED);
const TAU = Math.PI * 2;
const B = D.BOUNDS;

/* ---------------------------------------------------------------- the raster
   Row 0 is world z = -BOUNDS, the same orientation as desert.mapTexture, so
   the projection says north = -BOUNDS, south = +BOUNDS. */
const w = GRID, h = GRID, N = w * h, step = (2 * B) / GRID;
const cx = (x) => -B + (x + 0.5) * step, cz = (y) => -B + (y + 0.5) * step;
const BIOMES = ["sea", "dune", "rock", "salt", "gravel", "wadi", "oasis", "shore"];
const terrain = new Uint8Array(N), heightB = new Uint8Array(N), biome = new Uint8Array(N);
const H_OFF = -80, H_SCALE = 0.75;          // -80 m (the deep shelf) .. +111 m (the tallest butte)
let hmin = Infinity, hmax = -Infinity;
const tc = new Array(8).fill(0);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const i = x + y * w, X = cx(x), Z = cz(y);
  const hy = D.heightAt(X, Z);
  const b = D.biomeAt(X, Z);
  if (hy < hmin) hmin = hy; if (hy > hmax) hmax = hy;
  heightB[i] = Math.max(0, Math.min(255, Math.round((hy - H_OFF) / H_SCALE)));
  biome[i] = Math.max(0, BIOMES.indexOf(b));
  let t;
  if (b === "sea" || hy <= 0.3) t = 0;
  else {
    // by province, not by slope: a per-tile slope test salts the map with
    // one-tile "hills" on every dune slip face, which is noise, not ground
    switch (b) {
      case "dune": t = 5; break;                                          // erg
      case "rock": t = hy > 45 ? 4 : 3; break;                            // mesa tables vs the talus round them
      case "salt": t = 1; break;                                          // a pan is open, flat, empty ground
      case "gravel": t = 1; break;                                        // reg: flat stony plain
      case "wadi": t = 6; break;                                          // a dry wash: cover and a slow crossing
      case "oasis": t = 2; break;                                         // palm groves
      default: t = 1;                                                     // shore
    }
  }
  terrain[i] = t; tc[t]++;
}

/* ---------------------------------------------------------------- outposts
   campaign.js placeOutposts(), same stream and same rules, minus levelPad's
   <=180 m polish (two tiles at most). */
const PAD_R = 20, GOLD = 2.399963229728653, PAD_OK = 1.7;
function wet(x, z, y) {
  for (const o of D.oases) { const dx = x - o.x, dz = z - o.z; if (dx * dx + dz * dz <= o.r * o.r && y < o.waterY + 0.8) return true; }
  return false;
}
function padAt(x, z) {
  let lo = 1e9, hi = -1e9, soaked = false;
  for (let i = 0; i < 13; i++) {
    const a = i * GOLD, rr = Math.sqrt((i + 0.35) / 13) * PAD_R;
    const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr, y = D.heightAt(px, pz);
    if (y < lo) lo = y; if (y > hi) hi = y;
    if (!soaked && (!D.onLand(px, pz) || wet(px, pz, y))) soaked = true;
  }
  return { relief: hi - lo, wet: soaked };
}
function coastPoint(a) {
  for (let r = D.RADIUS + 1100; r > 800; r -= 40) {
    const x = Math.cos(a) * r, z = Math.sin(a) * r, y = D.heightAt(x, z);
    if (y <= 4 || D.slopeAt(x, z) >= 0.22) continue;
    const pad = padAt(x, z);
    if (!pad.wet && pad.relief <= PAD_OK) return { x, z };
  }
  return null;
}
const outposts = [];
{
  const R = W.rngFrom(((SEED | 0) * 7919 + 13) >>> 0);
  const named = ["MARA", "TIN OUZAL", "DUST GATE", "SABKHA", "REDWALL", "GHARIB", "SALT CROSS", "LOW WELL", "BONE CAMP", "FARKH LANDING"];
  let n = 0;
  for (let i = 0; i < D.oases.length && n < 5; i++) {
    const o = D.oases[i];
    let p = null, bestR = 1e9;
    for (let t = 0; t < 10; t++) {
      const q = D.landPoint(R, { near: { x: o.x, z: o.z }, nearR: o.r * 2.4, maxSlope: 0.24 });
      if (!q) continue;
      const pad = padAt(q.x, q.z);
      if (pad.wet) continue;
      if (pad.relief < bestR) { bestR = pad.relief; p = q; }
      if (pad.relief <= PAD_OK) break;
    }
    if (!p) continue;
    outposts.push({ name: named[n % named.length], kind: n % 3 === 1 ? "camp" : "well", x: p.x, z: p.z, at: o.name });
    n++;
  }
  for (let guard = 0; guard < 400 && outposts.length < 8; guard++) {
    const p = coastPoint(R() * TAU);
    if (!p) continue;
    if (outposts.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 1800)) continue;
    outposts.push({ name: named[n % named.length], kind: n % 2 ? "depot" : "camp", x: p.x, z: p.z, at: null });
    n++;
  }
  for (let guard = 0, made = 0; guard < 600 && made < 2; guard++) {
    const a = R() * TAU, rr = D.RADIUS * (0.10 + R() * 0.24);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (!D.onLand(x, z) || D.slopeAt(x, z) > 0.20) continue;
    const pad = padAt(x, z);
    if (pad.wet || pad.relief > PAD_OK) continue;
    if (outposts.some((o) => Math.hypot(o.x - x, o.z - z) < 2000)) continue;
    outposts.push({ name: named[n % named.length], kind: "market", x, z, at: null });
    n++; made++;
  }
}

/* ---------------------------------------------------------------- regions
   territory.js buildAnchors()+nameAnchors(): its forty holdings. Each one
   that is not already an oasis or an outpost gets its well. */
const anchors = [];
{
  const TARGET = 40, R = D.RADIUS;
  for (const o of D.oases) anchors.push({ x: o.x, z: o.z, kind: "oasis", name: o.name });
  let land = 0;
  for (let i = 0; i < 1200; i++) {
    const a = i * 2.399963, r = Math.sqrt((i + 0.5) / 1200) * R * 1.15;
    if (D.coastAt(Math.cos(a) * r, Math.sin(a) * r) > 0) land++;
  }
  const landArea = Math.PI * Math.pow(R * 1.15, 2) * (land / 1200);
  let sep = Math.sqrt(landArea / TARGET) * 1.02;
  for (let pass = 0; pass < 6 && anchors.length < TARGET; pass++) {
    for (let i = 0; i < 3000 && anchors.length < TARGET; i++) {
      const a = i * 2.399963, r = Math.sqrt((i + 0.5) / 3000) * R * 1.06;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (D.coastAt(x, z) < 90) continue;
      if (anchors.some((k) => Math.hypot(k.x - x, k.z - z) < sep * (k.kind === "oasis" ? 0.82 : 1))) continue;
      anchors.push({ x, z, kind: D.biomeAt(x, z), name: null });
    }
    sep *= 0.86;
  }
  const NOUNS = {
    rock: ["MESAS", "THE BUTTES", "STONE TABLE", "RED ROCK"], salt: ["SALT PAN", "THE WHITE FLAT", "BITTER PAN"],
    dune: ["GREAT ERG", "DUNE SEA", "THE SANDS", "LONG DUNES"], wadi: ["THE WADI", "DRY RIVER", "THE CUT"],
    gravel: ["HARDPAN", "GRAVEL PLAIN", "THE FLATS", "STONY GROUND"], shore: ["SHORE", "THE COAST", "LANDING", "SALT BEACH"],
    oasis: ["OASIS"], sea: ["THE SHALLOWS"],
  };
  const bearing = (x, z) => {
    if (Math.hypot(x, z) < R * 0.3) return "INNER";
    const k = ((Math.round(Math.atan2(x, -z) / (TAU / 8)) % 8) + 8) % 8;
    return ["NORTH", "NORTH-EAST", "EAST", "SOUTH-EAST", "SOUTH", "SOUTH-WEST", "WEST", "NORTH-WEST"][k];
  };
  const used = {};
  for (const a of anchors) {
    if (a.name) { used[a.name] = 1; continue; }
    const pool = NOUNS[a.kind] || NOUNS.gravel, bear = bearing(a.x, a.z);
    let name = null;
    for (let k = 0; k < pool.length * 2 && !name; k++) {
      const noun = pool[(Math.floor(W.hash01(a.x, a.z, 4400 + k) * pool.length) + k) % pool.length];
      const cand = k < pool.length ? bear + " " + noun : noun;
      if (!used[cand]) name = cand;
    }
    a.name = name || bear + " " + pool[0] + " II";
    used[a.name] = 1;
  }
}

/* ---------------------------------------------------------------- towns
   Populations are what such places hold in the real Sahara: an oasis
   village of 1,500-6,000 (Siwa's villages, the Fezzan's ksour), a landing
   of a few thousand, a well of a few hundred herders' tents. */
// "SOUTH-WEST THE SANDS" (territory.js's naming) reads as "South-West Sands" on a town
const title = (s) => s.toLowerCase().replace(/(\S) the /, "$1 ").replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const towns = [];
const round = (v, q) => Math.round(v / q) * q;
for (const o of D.oases) {
  // a bigger pond waters more gardens: radius 62-116 m -> 1,500-6,000 people
  const pop = round(1500 + (o.r - 62) / 54 * 4500, 100);
  towns.push({ id: slug(o.name), name: title(o.name), at: [+o.x.toFixed(1), +o.z.toFixed(1)], pop, owner: null, kind: "oasis" });
}
for (const o of outposts) {
  if (o.at) continue;                                   // the oasis's own compound IS the oasis town
  // a landing is a port if a boat can reach it: within 800 m of the water
  const port = (o.kind === "depot" || o.kind === "camp") && D.coastAt(o.x, o.z) < 800;
  const pop = o.kind === "market" ? 600 + round(W.hash01(o.x, o.z, 71) * 300, 50) : o.kind === "depot" ? 3000 : 1200;
  towns.push({ id: slug(o.name), name: title(o.name), at: [+o.x.toFixed(1), +o.z.toFixed(1)], pop, owner: null, port, kind: o.kind });
}
// the island's harbour: the biggest landing becomes its port town
{
  const land = towns.filter((t) => t.port).sort((a, b) => b.pop - a.pop)[0];
  if (land) land.pop = 8000;
}
for (const a of anchors) {
  if (a.kind === "oasis") continue;
  if (towns.some((t) => Math.hypot(t.at[0] - a.x, t.at[1] - a.z) < 1200)) continue;
  const pop = 200 + round(W.hash01(a.x, a.z, 97) * 400, 10);
  const nearSea = D.coastAt(a.x, a.z) < 400;
  towns.push({ id: slug(a.name), name: title(a.name), at: [+a.x.toFixed(1), +a.z.toFixed(1)], pop, owner: null, port: nearSea || undefined, kind: "well" });
}

/* ---------------------------------------------------------------- owners
   Five factions spread over the five oases farthest from each other; each
   also holds the nearest other settlement. The player holds one small well,
   the one farthest from every faction's home. */
const FACTIONS = [
  { id: "bandit", name: "Sand Bandits", colour: "#d8382c", ai: { aggression: 0.9, expand: 0.6 } },
  { id: "militia", name: "Oasis Militia", colour: "#4a8f5a", ai: { aggression: 0.4, expand: 0.5 } },
  { id: "company", name: "Free Company", colour: "#3f7fb8", ai: { aggression: 0.6, expand: 0.6 } },
  { id: "legion", name: "Desert Legion", colour: "#e0c341", ai: { aggression: 0.8, expand: 0.8 } },
  { id: "rival", name: "Rival Warlord", colour: "#8f4fb8", ai: { aggression: 0.9, expand: 0.7 } },
  { id: "warlord", name: "Your Band", colour: "#ff8a3d", ai: { aggression: 0.5, expand: 0.5 } },
];
const dist = (a, b) => Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]);
{
  const oases = towns.filter((t) => t.kind === "oasis").sort((a, b) => b.pop - a.pop);
  const homes = [oases[0]];
  while (homes.length < 5) {
    let best = null, bd = -1;
    for (const t of oases) {
      if (homes.includes(t)) continue;
      const d = Math.min(...homes.map((hh) => dist(hh, t)));
      if (d > bd) { bd = d; best = t; }
    }
    homes.push(best);
  }
  // the biggest oasis goes to the Legion (the strongest), the rest in list order
  const order = ["legion", "militia", "company", "bandit", "rival"];
  homes.forEach((t, k) => { t.owner = order[k]; t.capital = true; FACTIONS.find((f) => f.id === order[k]).capital = t.id; });
  for (const hh of homes) {
    let best = null, bd = Infinity;
    for (const t of towns) if (!t.owner && dist(t, hh) < bd) { bd = dist(t, hh); best = t; }
    if (best) best.owner = hh.owner;
  }
  let pick = null, pd = -1;
  for (const t of towns) {
    if (t.owner || t.kind !== "well") continue;
    const d = Math.min(...towns.filter((u) => u.owner).map((u) => dist(u, t)));
    if (d > pd) { pd = d; pick = t; }
  }
  pick.owner = "warlord"; pick.capital = true;
  FACTIONS.find((f) => f.id === "warlord").capital = pick.id;
}

/* ---------------------------------------------------------------- armies
   Hundreds, not thousands: core.js's biggest band is a few hundred men and
   the island's whole carrying capacity is ~1,400 (territory.js). */
const MEN = { legion: 320, company: 240, militia: 180, bandit: 150, rival: 260, warlord: 40 };
const armies = FACTIONS.map((f) => ({ owner: f.id, at: f.capital, men: MEN[f.id] }));
const rogues = [];
{
  const R = W.rngFrom(((SEED | 0) * 104729 + 7) >>> 0);
  const bands = [["Deserters", 40], ["Wadi raiders", 90], ["Salt thieves", 25], ["Bandit stragglers", 120]];
  for (const [name, men] of bands) {
    const p = D.landPoint(R, { minR: 1500, maxR: D.RADIUS * 0.85, maxSlope: 0.3 });
    rogues.push({ name, at: [+p.x.toFixed(1), +p.z.toFixed(1)], men });
  }
}

const ids = FACTIONS.map((f) => f.id);
const wars = [];
for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
  const A = ids[a], Bb = ids[b];
  if ((A === "militia" && Bb === "company") || (A === "company" && Bb === "militia")) continue;   // the one alliance
  // the player starts at war only with the two who would never talk: bandits and the rival
  if ((A === "warlord" || Bb === "warlord") && !["bandit", "rival"].includes(A === "warlord" ? Bb : A)) continue;
  wars.push([A, Bb]);
}

const b64 = (u8) => Buffer.from(u8).toString("base64");
const data = {
  id: "island",
  name: "The Island",
  blurb: "The desert island you ride, seen from above. Seven oases, five warbands, and you with forty men at a well.",
  projection: { kind: "metres", west: -B, east: B, north: -B, south: B },
  grid: { w, h },
  raster: { w, h, terrain: b64(terrain), height: b64(heightB), heightScale: H_SCALE, heightOffset: H_OFF,
            biome: { names: BIOMES, data: b64(biome) } },
  towns: towns.map((t) => { const o = { id: t.id, name: t.name, at: t.at, pop: t.pop, owner: t.owner }; if (t.capital) o.capital = true; if (t.port) o.port = true; return o; }),
  factions: FACTIONS.map((f) => ({ id: f.id, name: f.name, colour: f.colour, capital: f.capital, ai: f.ai })),
  startRadiusKm: 1.4,
  wars,
  alliances: [["militia", "company"]],
  armies,
  rogues,
  // desert herders on open ground, gardens under the palms, nobody on a mesa
  ruralPerKm2: { plains: 1.5, forest: 60, hills: 0.5, mountains: 0.1, desert: 0.2, marsh: 2 },
  startDate: null,
  win: { share: 0.7 },
  // a warband war on 75 m tiles: towns arm a bigger share, columns cross in days
  knobs: { GARRISON_SHARE: 0.07, GARRISON_GROW: 0.0005, MAX_TILES_DAY: 8, CATCH_KM: 4, FORAGE_KM: 1.2 },
};

const header = `/* ============================================================
   warlord/war/maps/island.js — THE ISLAND, baked by tools/warlord-bake-island.mjs
   from desert.js (seed ${SEED}) on a ${w}x${h} grid of ${step.toFixed(1)} m tiles.
   DO NOT EDIT: re-run the baker. Rasters are base64 Uint8, north row first
   (north = world z -${B}); height metres = v * ${H_SCALE} + (${H_OFF}).
   Towns: the oases, campaign.js's landings and markets, and a well in each
   of territory.js's holdings that has no other settlement.
============================================================ */
`;
const js = header + `(function () {
  "use strict";
  const G = typeof window !== "undefined" ? window : globalThis;
  const W = ((G.CBZ = G.CBZ || {}).warlord = G.CBZ.warlord || {});
  const WAR = (W.war = W.war || {});
  (WAR.mapData = WAR.mapData || {})["island"] = ${JSON.stringify(data)};
})();
`;
const out = join(ROOT, "src/warlord/war/maps/island.js");
writeFileSync(out, js);

console.log(`baked ${out} (${(js.length / 1024).toFixed(1)} KB)`);
console.log(`grid ${w}x${h}, tile ${step.toFixed(1)} m, height ${hmin.toFixed(1)}..${hmax.toFixed(1)} m`);
console.log("terrain: " + ["sea", "plains", "forest", "hills", "mountains", "desert", "marsh", "lake"].map((k, i) => `${k} ${tc[i]}`).join(", "));
console.log(`oases ${D.oases.length}, outposts ${outposts.length} (${outposts.map((o) => o.name + (o.at ? "@" + o.at : "")).join(", ")}), regions ${anchors.length}`);
console.log(`towns ${towns.length}: ` + towns.map((t) => `${t.name} ${t.pop}${t.owner ? " [" + t.owner + "]" : ""}`).join(", "));

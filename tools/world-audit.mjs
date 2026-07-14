#!/usr/bin/env node
/* tools/world-audit.mjs — WORLD GEOMETRY AUDIT: the "find dumb-placed things" loop.

   Boots the game headless at one or more seeds, presses PLAY, walks the LIVE
   world (regions, lots/buildings, roads, highways, street props, worldLayout
   features, vehicles/aircraft/player) and produces, per seed:

     tools/audit/seed<N>/objects.json          every placed thing {layer,type,name,aabb,center,dims,source}
     tools/audit/seed<N>/overlaps.json         pairwise true-shape overlaps, ranked (containment ratio of the SMALLER object)
     tools/audit/seed<N>/ratio-violations.json measured dims vs real-world reference bands (human=1.8u anchor)
     tools/audit/seed<N>/lint.json             props-in-road, props-on-highway, structures-in-water, peds-on-runway
     tools/audit/seed<N>/report.txt            human-readable top-20 overlap report + worst ratios + lint counts
     tools/audit/seed<N>/annotated.png         top-down map: red=overlaps, orange=ratio offenders,
                                               yellow=props-in-road, magenta=props-on-highway, cyan=in-water, + legend

   Usage: node tools/world-audit.mjs [seed ...]     (default: 90210)
          --no-map    skip the annotated PNG

   Heuristics (near-zero false positives by design):
   - pair MATRIX prunes legitimate nesting (props-in-lots, lots-in-regions, causeway links...)
   - containment ratio C = overlap / area(smaller), NOT raw volume (big regions dwarf everything)
   - TRUE circle geometry for circular islands (AABB corners lie)
   - vertical gate: elevated decks over ground roads never flag
   - roads tested against TRAVEL lanes (curbside lamps/hydrants never flag)

   Zero npm dependencies: CDP over the system browser. */
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const seeds = args.filter((a) => !a.startsWith("--")).map(Number).filter(Number.isFinite);
if (!seeds.length) seeds.push(90210);
const DRAW_MAP = !args.includes("--no-map");
const REANALYZE = args.includes("--reanalyze");   // re-run analysis from an existing objects.json (no browser, no map)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R2 = (n) => Math.round(n * 100) / 100;

/* ================= reference tables ================= */

// prop footprints (metres) — streetProps records carry only {x,z,type}
const PROP_SPECS = {
  lamp: { r: 0.3, h: 7.5 }, hydrant: { r: 0.35, h: 1.0 }, mailbox: { r: 0.4, h: 1.4 },
  bin: { r: 0.5, h: 1.2 }, meter: { r: 0.15, h: 1.3 }, newsbox: { r: 0.4, h: 1.2 },
  tree: { r: 1.2, h: 8 }, planter: { r: 0.9, h: 0.8 }, sign: { r: 0.3, h: 3.2 },
  patio: { r: 1.8, h: 1.0 }, bikerack: { r: 1.0, h: 1.0 }, propane: { r: 0.6, h: 1.8 },
  busstop: { r: 2.2, h: 2.6 }, billboard: { r: 2.5, h: 6 }, cart: { r: 1.0, h: 1.8 },
  camp: { r: 2.0, h: 1.5 }, default: { r: 0.5, h: 1.5 },
};

// real-world bands, human = 1.8u anchor.  [lo, hi]
const BANDS = {
  "human height": [1.6, 2.0],
  "car length": [3.8, 5.9], "car width": [1.6, 2.2], "car height": [1.2, 2.0],
  "farm rig length": [3.5, 11], "farm rig width": [2.2, 4.5], "farm rig height": [2.2, 4.5],
  "boat length": [4, 15], "boat width": [1.5, 4], "boat height": [0.8, 4],
  "lane width": [3.0, 3.9], "door height": [1.9, 2.3], "floor height": [2.7, 3.5],
  "GA plane max-dim": [6.5, 22], "airliner max-dim": [28, 45], "heli max-dim": [10, 20],
  "tank max-dim": [6, 11],
  "motorsports park footprint": [250, 600], "runway length": [800, 3000], "runway width": [28, 46],
};

function bandCheck(subject, bandName, measured, note) {
  const band = BANDS[bandName];
  if (!band || !Number.isFinite(measured) || measured <= 0) return null;
  const [lo, hi] = band;
  const factor = measured > hi ? measured / hi : measured < lo ? lo / measured : 1;
  if (factor <= 1.001) return null;
  return {
    subject, band: bandName, measured: R2(measured), expected: [lo, hi],
    factor: R2(factor), score: R2(Math.log2(factor)),
    tier: factor > 2 ? "ERROR" : factor > 1.5 ? "WARN" : "INFO",
    note: note || null,
  };
}

/* ================= geometry ================= */

const rectArea = (r) => Math.max(0, r.maxX - r.minX) * Math.max(0, r.maxZ - r.minZ);
const objArea = (o) => (o.shape === "circle" ? Math.PI * o.r * o.r : rectArea(o));

function rectRectOverlap(a, b) {
  const minX = Math.max(a.minX, b.minX), maxX = Math.min(a.maxX, b.maxX);
  const minZ = Math.max(a.minZ, b.minZ), maxZ = Math.min(a.maxZ, b.maxZ);
  const ox = maxX - minX, oz = maxZ - minZ;
  if (ox <= 0 || oz <= 0) return { area: 0, rect: null };
  return { area: ox * oz, rect: { minX, maxX, minZ, maxZ } };
}

function circleLensArea(a, b) {
  const d = Math.hypot(a.cx - b.cx, a.cz - b.cz);
  const r1 = a.r, r2 = b.r;
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const t1 = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const t2 = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const t3 = 0.5 * Math.sqrt(Math.max(0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
  return t1 + t2 - t3;
}

function circlePoly(cx, cz, r, n = 40) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]); }
  return pts;
}
function clipPolyHalfPlane(poly, inside, intersect) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], prev = poly[(i + poly.length - 1) % poly.length];
    const cIn = inside(cur), pIn = inside(prev);
    if (cIn) { if (!pIn) out.push(intersect(prev, cur)); out.push(cur); }
    else if (pIn) out.push(intersect(prev, cur));
  }
  return out;
}
function clipPolyToRect(poly, rect) {
  const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const planes = [
    [(p) => p[0] >= rect.minX, (p, q) => lerp(p, q, (rect.minX - p[0]) / (q[0] - p[0]))],
    [(p) => p[0] <= rect.maxX, (p, q) => lerp(p, q, (rect.maxX - p[0]) / (q[0] - p[0]))],
    [(p) => p[1] >= rect.minZ, (p, q) => lerp(p, q, (rect.minZ - p[1]) / (q[1] - p[1]))],
    [(p) => p[1] <= rect.maxZ, (p, q) => lerp(p, q, (rect.maxZ - p[1]) / (q[1] - p[1]))],
  ];
  let out = poly;
  for (const [inside, intersect] of planes) { out = clipPolyHalfPlane(out, inside, intersect); if (!out.length) return out; }
  return out;
}
function polyArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % poly.length]; s += x1 * z2 - x2 * z1; }
  return Math.abs(s) / 2;
}

// TRUE-shape 2D overlap area between two objects (rect or circle), plus an
// AABB of the intersection for drawing.
function trueOverlap(a, b) {
  const bb = rectRectOverlap(a, b);
  if (bb.area <= 0) return { area: 0, rect: null };
  let area;
  if (a.shape === "circle" && b.shape === "circle") area = circleLensArea(a, b);
  else if (a.shape === "circle") area = polyArea(clipPolyToRect(circlePoly(a.cx, a.cz, a.r), b));
  else if (b.shape === "circle") area = polyArea(clipPolyToRect(circlePoly(b.cx, b.cz, b.r), a));
  else area = bb.area;
  return { area, rect: bb.rect };
}

const yOverlap = (a, b) => {
  const a0 = a.y0 == null ? -Infinity : a.y0, a1 = a.y1 == null ? Infinity : a.y1;
  const b0 = b.y0 == null ? -Infinity : b.y0, b1 = b.y1 == null ? Infinity : b.y1;
  return Math.min(a1, b1) - Math.max(a0, b0);
};

function pointInObj(x, z, o, pad = 0) {
  if (o.shape === "circle") return Math.hypot(x - o.cx, z - o.cz) <= o.r + pad;
  return x >= o.minX - pad && x <= o.maxX + pad && z >= o.minZ - pad && z <= o.maxZ + pad;
}

/* ================= overlap analysis (the pair matrix) ================= */

const LINKY = /bridge|causeway|link|edge|ring|backdrop|shore/i;
const DOCKY = /dock|marina|pier|quay|wharf|jetty|hull|boat|moor|slip|harbor|beach/i;
const isRealRegion = (o) => !o.underlay && o.subtitle !== "Country" && !LINKY.test(o.name || "");
const famOf = (id) => String(id || "").split(":")[0];

function analyzeOverlaps(objects) {
  const regions = objects.filter((o) => o.layer === "region");
  const lands = objects.filter((o) => o.layer === "land");
  const structures = objects.filter((o) => o.layer === "structure");
  const roads = objects.filter((o) => o.layer === "road");
  const features = objects.filter((o) => o.layer === "feature");
  const out = [];

  const emit = (cls, a, b, ov, extra) => {
    const smaller = Math.max(1, Math.min(objArea(a), objArea(b)));
    const union = objArea(a) + objArea(b) - ov.area;
    const C = ov.area / smaller, iou = ov.area / Math.max(1, union);
    out.push({
      class: cls,
      a: { id: a.id, layer: a.layer, type: a.type, name: a.name },
      b: { id: b.id, layer: b.layer, type: b.type, name: b.name },
      area: Math.round(ov.area), smallerCoveredPct: R2(C * 100), iou: R2(iou),
      severity: R2(C * Math.log10(Math.min(objArea(a), objArea(b)) + 10)),
      tier: null, at: ov.rect ? { x: Math.round((ov.rect.minX + ov.rect.maxX) / 2), z: Math.round((ov.rect.minZ + ov.rect.maxZ) / 2) } : null,
      rect: ov.rect, ...extra,
    });
    return out[out.length - 1];
  };

  // 1. region ∩ region (both real) — the island/stadium/terrain class. True shapes.
  const realRegions = regions.filter(isRealRegion);
  for (let i = 0; i < realRegions.length; i++) for (let j = i + 1; j < realRegions.length; j++) {
    const a = realRegions[i], b = realRegions[j];
    const ov = trueOverlap(a, b);
    if (ov.area <= 25) continue;
    const smaller = Math.max(1, Math.min(objArea(a), objArea(b)));
    const C = ov.area / smaller;
    if (C <= 0.05) continue;
    const rec = emit("region-region", a, b, ov);
    rec.tier = rec.iou > 0.5 ? "DUPLICATE" : C > 0.15 ? "ERROR" : "WARN";
  }
  // 1b. real region ∩ mainland/annex (an island interpenetrating the mainland)
  for (const a of realRegions) for (const b of lands) {
    const ov = trueOverlap(a, b);
    if (ov.area <= 25) continue;
    const C = ov.area / Math.max(1, Math.min(objArea(a), objArea(b)));
    if (C <= 0.05) continue;
    const rec = emit("region-mainland", a, b, ov);
    rec.tier = C > 0.15 ? "ERROR" : "WARN";
  }

  // 2. structure ∩ structure — buildings should abut, never interpenetrate.
  for (let i = 0; i < structures.length; i++) for (let j = i + 1; j < structures.length; j++) {
    const a = structures[i], b = structures[j];
    if (yOverlap(a, b) <= 0.5) continue;
    const ov = rectRectOverlap(a, b);
    if (ov.area <= 2) continue;
    const C = ov.area / Math.max(1, Math.min(rectArea(a), rectArea(b)));
    if (C <= 0.05 && ov.area <= 8) continue;
    const rec = emit("structure-structure", a, b, ov);
    rec.tier = C > 0.15 || ov.area > 8 ? "ERROR" : "WARN";
  }

  // 3. structure ∩ road TRAVEL lanes (stoop-on-sidewalk is fine; wall-in-lane is not)
  for (const s of structures) for (const r of roads) {
    if (yOverlap(s, r) <= 0.3) continue;
    const ov = rectRectOverlap(s, r.travelRect);
    if (ov.area <= 2) continue;
    const rec = emit("structure-road", s, r, ov);
    rec.tier = ov.area > 8 ? "ERROR" : "WARN";
  }

  // 3b. terrain ∩ foreign region / terrain ∩ terrain — the owner-visible
  // "terrains overlap each other" class. Terrain slabs are organic shapes in
  // loose AABBs, so thresholds are higher (C>0.15) and each slab is assigned
  // an OWNER region (the real region overlapping it most); only overlap with a
  // DIFFERENT real region flags.
  const terrains = objects.filter((o) => o.layer === "terrain");
  const worldArea = rectArea({
    minX: Math.min(...lands.map((l) => l.minX), ...regions.map((r) => r.minX)),
    maxX: Math.max(...lands.map((l) => l.maxX), ...regions.map((r) => r.maxX)),
    minZ: Math.min(...lands.map((l) => l.minZ), ...regions.map((r) => r.minZ)),
    maxZ: Math.max(...lands.map((l) => l.maxZ), ...regions.map((r) => r.maxZ)),
  });
  const islandTerrains = terrains.filter((t) => rectArea(t) < worldArea * 0.4); // skip world-sized sea/backdrop slabs
  const ownerOf = new Map();   // terrain id -> owning region object (or land)
  for (const t of islandTerrains) {
    let best = null, bestA = 0;
    for (const r of [...realRegions, ...lands]) {
      const a = trueOverlap(t, r).area;
      if (a > bestA) { bestA = a; best = r; }
    }
    ownerOf.set(t.id, best);
  }
  const ownerName = (t) => { const o = ownerOf.get(t.id); return o ? o.name : null; };
  for (const t of islandTerrains) for (const r of realRegions) {
    const own = ownerOf.get(t.id);
    if (own && own.id === r.id) continue;
    const ov = trueOverlap(t, r);
    if (ov.area <= 400) continue;
    const C = ov.area / Math.max(1, Math.min(rectArea(t), objArea(r)));
    if (C <= 0.15) continue;
    const rec = emit("terrain-region", t, r, ov, { terrainOwner: ownerName(t) });
    rec.a.name = (rec.a.name || "terrain") + " (of " + (ownerName(t) || "?") + ")";
    rec.tier = C > 0.3 ? "ERROR" : "WARN";
  }
  for (let i = 0; i < islandTerrains.length; i++) for (let j = i + 1; j < islandTerrains.length; j++) {
    const a = islandTerrains[i], b = islandTerrains[j];
    const oa = ownerOf.get(a.id), ob = ownerOf.get(b.id);
    if (!oa || !ob || oa.id === ob.id) continue;      // same island's own layers may stack
    const ov = rectRectOverlap(a, b);
    if (ov.area <= 400) continue;
    const C = ov.area / Math.max(1, Math.min(rectArea(a), rectArea(b)));
    if (C <= 0.15) continue;
    const rec = emit("terrain-terrain", a, b, ov);
    rec.a.name = (rec.a.name || "terrain") + " (of " + oa.name + ")";
    rec.b.name = (rec.b.name || "terrain") + " (of " + ob.name + ")";
    rec.tier = C > 0.3 ? "ERROR" : "WARN";
  }

  // 4. feature ∩ feature — cross-family only (snow:* vs snow:* is one generator's plan)
  for (let i = 0; i < features.length; i++) for (let j = i + 1; j < features.length; j++) {
    const a = features[i], b = features[j];
    if (famOf(a.name) === famOf(b.name)) continue;
    if (yOverlap(a, b) <= 0) continue;
    const ov = rectRectOverlap(a, b);
    if (ov.area <= 4) continue;
    const C = ov.area / Math.max(1, Math.min(rectArea(a), rectArea(b)));
    if (C <= 0.05) continue;
    const rec = emit("feature-feature", a, b, ov);
    rec.tier = C > 0.15 ? "ERROR" : "WARN";
  }

  out.sort((a, b) => (b.severity - a.severity) || (b.area - a.area));
  return out;
}

/* ================= placement lint ================= */

function analyzeLint(objects, extras) {
  const roads = objects.filter((o) => o.layer === "road");
  const props = objects.filter((o) => o.layer === "prop");
  const structures = objects.filter((o) => o.layer === "structure");
  const features = objects.filter((o) => o.layer === "feature");
  const landUnion = objects.filter((o) => o.layer === "land" || o.layer === "region");

  // A. prop in the travel lanes of a road (point+radius vs inset travel rect)
  const propsInRoad = [], propsOnHighway = [];
  for (const p of props) {
    const spec = PROP_SPECS[p.type] || PROP_SPECS.default;
    for (const r of roads) {
      const half = r.len / 2;
      const along = r.vertical ? Math.abs(p.cz - r.z) : Math.abs(p.cx - r.x);
      if (along > half + spec.r) continue;
      const perp = r.vertical ? Math.abs(p.cx - r.x) : Math.abs(p.cz - r.z);
      const margin = spec.r + 0.25;
      if (perp >= r.travelWidth / 2 - margin) continue;
      if (r.type === "highway-road") {
        if (r.deckY != null && r.deckY > 1.5) continue;   // ground prop UNDER an elevated deck: fine
        propsOnHighway.push({ type: p.type, x: p.cx, z: p.cz, road: r.id, perp: R2(perp) });
      } else {
        propsInRoad.push({ type: p.type, x: p.cx, z: p.cz, road: r.id, roadType: r.type, perp: R2(perp) });
      }
      break;
    }
  }

  // B. structure / feature in water.  A centre-only probe misses the exact
  // failure players notice: a wide building whose centre is legal while one
  // wall and its NPC pavement hang over the shore.  Live structure records
  // therefore carry a 3x3 footprint sample from the rendered coast oracle.
  const inWater = [];
  for (const s of [...structures, ...features]) {
    if (DOCKY.test((s.name || "") + " " + (s.type || ""))) continue;
    const cx = (s.minX + s.maxX) / 2, cz = (s.minZ + s.maxZ) / 2;
    let onLand = false;
    for (const l of landUnion) if (pointInObj(cx, cz, l, l.pad == null ? 2 : l.pad)) { onLand = true; break; }
    if (!onLand || (Number.isFinite(s.shoreMin) && s.shoreMin < -0.25)) {
      inWater.push({ layer: s.layer, type: s.type, name: s.name, x: R2(cx), z: R2(cz),
        reason: !onLand ? "center-off-land" : "footprint-crosses-shore", shoreMin: s.shoreMin });
    }
  }

  // C. highway-mounted streetlights (buildHighway opts.lights InstancedMesh —
  //    the owner-visible "streetlights on highways/bridges" class; these are
  //    NOT in streetProps, they are read straight off each highway's group)
  const hwyLights = (extras.highwayLamps || []).map((l) => ({ type: "hwy-lamp", x: l.x, z: l.z, hwy: l.hwy, deckY: l.deckY }));
  const hwyLightCounts = {};
  for (const l of hwyLights) hwyLightCounts["highway-" + l.hwy] = (hwyLightCounts["highway-" + l.hwy] || 0) + 1;
  const allOnHighway = propsOnHighway.concat(hwyLights);

  // World-size regression: this is physical geography, so a wider camera FOV
  // cannot satisfy it. Expansion V2 must add substantial walkable area, a long
  // traversable circuit, four landmarks, and keep all of it on dry terrain.
  const ws = extras.worldScale || null, worldScaleFailures = [];
  if (ws && ws.enabled) {
    if (!(ws.areaGainPct >= 30)) worldScaleFailures.push("playable area gain <30%");
    if (!(ws.frontierLoopMeters >= 10000)) worldScaleFailures.push("frontier loop <10km");
    if (!(ws.frontierLandmarks >= 4)) worldScaleFailures.push("fewer than four frontier landmarks");
    if (!(ws.frontierRoadMinShore >= 20)) worldScaleFailures.push("frontier road approaches water");
    if (!(ws.frontierLandmarkMinShore >= 20)) worldScaleFailures.push("frontier landmark approaches water");
  }

  return {
    propsInRoad, propsOnHighway: allOnHighway, highwayLightCounts: hwyLightCounts,
    structuresInWater: inWater,
    worldScaleFailures,
    pedsOnRunway: extras.pedsOnRunway || [],
    pedsInOpenWater: extras.pedsInOpenWater || [],
    roadMismatches: extras.roadMismatches || 0,
    colliderSummary: extras.colliderSummary || null,
    counts: {
      propsInRoad: propsInRoad.length, propsOnHighway: allOnHighway.length,
      structuresInWater: inWater.length, pedsOnRunway: (extras.pedsOnRunway || []).length,
      pedsInOpenWater: (extras.pedsInOpenWater || []).length,
      worldScaleFailures: worldScaleFailures.length,
    },
  };
}

/* ================= ratio audit ================= */

function analyzeRatios(dump) {
  const v = [];
  const m = dump.measures || {};
  const pushIf = (x) => { if (x) v.push(x); };

  if (m.player) {
    pushIf(bandCheck("player rig", "human height", m.player.h, "declared character-model dimensions; UI labels and held effects excluded"));
    const playerMax = Math.max(m.player.w, m.player.h, m.player.l);
    const seenPlane = new Set();
    for (const p of (m.craft || []).filter((c) => c.kind === "plane")) {
      if (seenPlane.has(p.name)) continue;
      seenPlane.add(p.name);
      const planeMax = Math.max(p.dims.w, p.dims.l);
      const ratio = playerMax / Math.max(0.1, planeMax);
      if (ratio > 0.45) v.push({
        subject: "player vs " + (p.name || "plane"), band: "cross-ratio player/plane footprint",
        measured: R2(ratio), expected: [0, 0.35], factor: R2(ratio / 0.35), score: R2(Math.log2(Math.max(1, ratio / 0.35))),
        tier: ratio > 0.6 ? "ERROR" : "WARN",
        note: "player max-dim " + R2(playerMax) + "u vs plane max-dim " + R2(planeMax) + "u — a person should be well under 0.35 of a GA plane",
      });
      // the "player is nearly as big as a plane" feel is mostly HEIGHT:
      // a standing person visibly taller than a parked aircraft's spine.
      const hRatio = m.player.h / Math.max(0.1, p.dims.h);
      if (hRatio > 0.85) v.push({
        subject: "player height vs " + (p.name || "plane") + " height", band: "cross-ratio player/plane height",
        measured: R2(hRatio), expected: [0, 0.7], factor: R2(hRatio / 0.7), score: R2(Math.log2(Math.max(1, hRatio / 0.7))),
        tier: hRatio > 1 ? "ERROR" : "WARN", at: { x: p.x, z: p.z },
        note: "player rig " + m.player.h + "u tall vs " + (p.name || "plane") + " " + p.dims.h + "u tall" + (hRatio > 1 ? " — the PLAYER IS TALLER THAN THE PLANE" : ""),
      });
    }
    // character-vs-car scale: real people are ~1.2x a car's height, ~0.4x its length
    const carH = (m.cars || []).map((c) => c.dims && c.dims.height).filter(Number.isFinite).sort((a, b) => a - b);
    if (carH.length) {
      const medCarH = carH[Math.floor(carH.length / 2)];
      const r = m.player.h / medCarH;
      if (r > 1.6) v.push({
        subject: "player height vs median car height", band: "cross-ratio player/car height",
        measured: R2(r), expected: [0.9, 1.4], factor: R2(r / 1.4), score: R2(Math.log2(r / 1.4)),
        tier: r > 2 ? "ERROR" : "WARN",
        note: "player " + m.player.h + "u vs median car " + R2(medCarH) + "u — characters are oversized relative to vehicles",
      });
    }
  }
  for (const p of m.peds || []) pushIf(bandCheck("ped " + (p.name || ""), "human height", p.h, "sampled city ped rig"));
  const seenModel = new Set();
  for (const c of m.cars || []) {
    const key = c.model || "car";
    if (seenModel.has(key)) continue;
    seenModel.add(key);
    if (!c.dims) continue;
    const farm = /tractor|combine|harvester/i.test(key);
    const boat = /boat|skiff|yacht/i.test(key);
    const family = farm ? "farm rig" : (boat ? "boat" : "car");
    pushIf(bandCheck(family + " " + key, family + " length", c.dims.length));
    pushIf(bandCheck(family + " " + key, family + " width", c.dims.width));
    pushIf(bandCheck(family + " " + key, family + " height", c.dims.height));
  }
  const seenCraft = new Set();
  for (const c of m.craft || []) {
    const key = (c.kind || "?") + ":" + (c.name || "?");
    if (seenCraft.has(key) || !c.dims) continue;
    seenCraft.add(key);
    const maxDim = Math.max(c.dims.w, c.dims.l);
    if (c.kind === "plane") {
      const ga = /private|fighter|general|cessna|business/i.test(c.name || "") || maxDim < 23;
      pushIf(bandCheck(c.name || "plane", ga ? "GA plane max-dim" : "airliner max-dim", maxDim, "dimension contract for " + (c.name || "plane") + " at (" + c.x + "," + c.z + ")"));
    }
    else if (c.kind === "heli") pushIf(bandCheck(c.name || "heli", "heli max-dim", maxDim));
    else if (c.kind === "tank") pushIf(bandCheck(c.name || "tank", "tank max-dim", maxDim));
  }
  pushIf(bandCheck("lane", "lane width", dump.laneW, "CBZ.CITY.traf.laneW"));
  if (dump.floorHeights && dump.floorHeights.length) {
    const med = dump.floorHeights.slice().sort((a, b) => a - b)[Math.floor(dump.floorHeights.length / 2)];
    pushIf(bandCheck("building floor-to-floor (median of " + dump.floorHeights.length + ")", "floor height", med));
  }
  if (dump.runway) {
    pushIf(bandCheck("runway", "runway length", dump.runway.maxX - dump.runway.minX));
    pushIf(bandCheck("runway", "runway width", dump.runway.maxZ - dump.runway.minZ));
  }
  const speedway = (dump.objects || []).find((o) => o.layer === "region" && /speedway|stadium/i.test(o.name || ""));
  if (speedway) pushIf(bandCheck(speedway.name, "motorsports park footprint", speedway.shape === "circle" ? speedway.r * 2 : Math.max(speedway.maxX - speedway.minX, speedway.maxZ - speedway.minZ)));

  // locate offenders on the map where possible
  for (const viol of v) {
    const craft = (m.craft || []).find((c) => c.name && viol.subject.includes(c.name));
    if (craft) viol.at = { x: craft.x, z: craft.z };
    else if (/runway/.test(viol.subject) && dump.runway) viol.at = { x: (dump.runway.minX + dump.runway.maxX) / 2, z: (dump.runway.minZ + dump.runway.maxZ) / 2 };
    else if (speedway && viol.subject === speedway.name) viol.at = { x: (speedway.minX + speedway.maxX) / 2, z: (speedway.minZ + speedway.maxZ) / 2 };
  }
  v.sort((a, b) => b.score - a.score);
  return v;
}

/* ================= in-page collector ================= */

const COLLECT = String.raw`(() => {
  const A = CBZ.city && CBZ.city.arena;
  if (!A) throw new Error("world audit: no arena");
  const R2 = (n) => Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  const objects = [];
  let oid = 0;
  const push = (o) => { o.id = oid++; objects.push(o); return o; };
  const rectOf = (cx, cz, w, d) => ({ minX: R2(cx - w / 2), maxX: R2(cx + w / 2), minZ: R2(cz - d / 2), maxZ: R2(cz + d / 2) });
  const shoreAt = A.mapTerrain && typeof A.mapTerrain.shoreAt === "function" ? A.mapTerrain.shoreAt : null;
  const footprintShoreMin = (r) => {
    if (!shoreAt) return null;
    let mn = Infinity;
    for (let iz = 0; iz < 3; iz++) for (let ix = 0; ix < 3; ix++) {
      const x = r.minX + (r.maxX - r.minX) * ix / 2;
      const z = r.minZ + (r.maxZ - r.minZ) * iz / 2;
      let s = Infinity; try { s = +shoreAt(x, z); } catch (_) {}
      if (Number.isFinite(s) && s < mn) mn = s;
    }
    return Number.isFinite(mn) ? R2(mn) : null;
  };

  // ---- land (mainland grid + annex) ----
  push({ layer: "land", type: "mainland", name: "Mainland", shape: "rect",
    minX: A.minX, maxX: A.maxX, minZ: A.minZ, maxZ: A.maxZ, pad: 2, source: "city/world" });
  if (A.annex && Number.isFinite(A.annex.cx))
    push({ layer: "land", type: "annex", name: "Commerce Annex", shape: "circle",
      cx: A.annex.cx, cz: A.annex.cz, r: A.annex.radius,
      minX: A.annex.cx - A.annex.radius, maxX: A.annex.cx + A.annex.radius,
      minZ: A.annex.cz - A.annex.radius, maxZ: A.annex.cz + A.annex.radius, pad: 2, source: "city/expansion" });

  // ---- regions ----
  (A.regions || []).forEach((r, i) => {
    if (!Number.isFinite(r.minX) || !Number.isFinite(r.maxX)) return;
    push({ layer: "region", type: r.biome || "region", name: r.name || ("region-" + i),
      subtitle: r.subtitle || null, underlay: !!r.underlay, pad: r.pad == null ? 2 : r.pad,
      shape: r.kind === "circle" ? "circle" : "rect",
      cx: r.kind === "circle" ? r.cx : (r.minX + r.maxX) / 2,
      cz: r.kind === "circle" ? r.cz : (r.minZ + r.maxZ) / 2,
      r: r.kind === "circle" ? r.r : null,
      minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ, source: "registerCityRegion" });
  });

  // ---- structures (lots + annex lots) ----
  const lotRec = (l, src) => {
    if (!l || !Number.isFinite(l.cx) || !Number.isFinite(l.w)) return;
    const b = l.building;
    const footprint = rectOf(l.cx, l.cz, l.w, l.d);
    push(Object.assign({ layer: "structure", type: l.kind || (b && b.shop ? "shop" : b ? "building" : "lot"),
      name: (b && b.name) || null, shape: "rect", district: l.district || null,
      shoreMin: footprintShoreMin(footprint),
      y0: 0, y1: (b && Number.isFinite(b.h)) ? R2(b.h) : 8,
      storeys: (b && b.storeys) || null, FH: (b && R2(b.FH)) || null,
      // A generated mini-city lot may be a "tower" structurally while its
      // ground floor is a casino/bank/etc. Prefer that live shop program so the
      // audit reports what the building is FOR, not merely its shell family.
      purpose: (b && b.shop && b.shop.kind) || (b && b.office ? "office" : null)
        || (b && b.home ? "residential" : null) || (b && b.purpose) || l.kind || (b && b.park ? "park" : null),
      enclosed: !!(b && b.group), hasDoor: !!(b && b.door),
      enterable: !!(b && b.group && b.door && !b.park), source: src }, footprint));
  };
  (A.lots || []).forEach((l) => lotRec(l, "city/buildings"));
  if (A.annex && Array.isArray(A.annex.lots)) A.annex.lots.forEach((l) => lotRec(l, "city/expansion"));

  // ---- highways first (so road records can carry deckY via identity match) ----
  const hwys = (CBZ.cityHighways ? CBZ.cityHighways() : []) || [];
  const segDeck = new Map();
  hwys.forEach((h, i) => {
    (h.roads || []).forEach((seg) => segDeck.set(seg, h.deckY));
    push({ layer: "highway", type: "highway", name: "highway-" + i, shape: "rect",
      minX: h.footprint.minX, maxX: h.footprint.maxX, minZ: h.footprint.minZ, maxZ: h.footprint.maxZ,
      width: R2(h.width), length: R2(h.length), deckY: R2(h.deckY),
      y0: h.deckY - 0.5, y1: h.deckY + 1.2, source: "city/highways" });
  });

  // ---- roads ----
  const T = (CBZ.CITY && CBZ.CITY.traf) || {};
  const RW = (CBZ.CITY && CBZ.CITY.road) || 18;
  (A.roads || []).forEach((r) => {
    const lanesPerDir = Number.isFinite(r.lanesPerDir) ? r.lanesPerDir : (Number.isFinite(T.lanesPerDir) ? T.lanesPerDir : 2);
    const laneW = Number.isFinite(r.laneW) ? r.laneW : (Number.isFinite(T.laneW) ? T.laneW : 3.6);
    const width = Number.isFinite(r.width) ? r.width : (Number.isFinite(r.w) ? r.w : RW);
    const travel = lanesPerDir * laneW * 2 + (Number.isFinite(r.medianW) ? r.medianW : (Number.isFinite(r.median) ? r.median : 0));
    const half = r.len / 2, hw = width / 2, ht = travel / 2;
    const rect = r.vertical
      ? { minX: r.x - hw, maxX: r.x + hw, minZ: r.z - half, maxZ: r.z + half }
      : { minX: r.x - half, maxX: r.x + half, minZ: r.z - hw, maxZ: r.z + hw };
    const travelRect = r.vertical
      ? { minX: r.x - ht, maxX: r.x + ht, minZ: r.z - half, maxZ: r.z + half }
      : { minX: r.x - half, maxX: r.x + half, minZ: r.z - ht, maxZ: r.z + ht };
    push(Object.assign({ layer: "road",
      type: r.district === "highway" ? "highway-road" : (r.avenue ? "avenue" : "street"),
      name: null, shape: "rect", x: r.x, z: r.z, len: r.len, vertical: !!r.vertical,
      width: R2(width), travelWidth: R2(travel), travelRect,
      deckY: segDeck.has(r) ? R2(segDeck.get(r)) : null,
      y0: 0, y1: 0.3, source: "city/world+highways" }, rect));
  });

  // ---- annex bridge ----
  if (A.bridge && Number.isFinite(A.bridge.minX))
    push({ layer: "highway", type: "bridge", name: "Annex Bridge", shape: "rect",
      minX: A.bridge.minX, maxX: A.bridge.maxX, minZ: A.bridge.minZ, maxZ: A.bridge.maxZ,
      y0: 0, y1: 1, source: "city/expansion" });

  // ---- street props ----
  (A.streetProps || []).forEach((p) => {
    push({ layer: "prop", type: p.type || "prop", name: null, shape: "rect",
      cx: R2(p.x), cz: R2(p.z), minX: p.x - 0.5, maxX: p.x + 0.5, minZ: p.z - 0.5, maxZ: p.z + 0.5,
      y0: 0, y1: 2, source: "city/props" });
  });

  // ---- worldLayout named features ----
  ((CBZ.worldLayout && CBZ.worldLayout.snapshot) ? CBZ.worldLayout.snapshot() : []).forEach((f) => {
    push({ layer: "feature", type: f.kind || "feature", name: f.id, zone: f.zone || null,
      shape: "rect", minX: f.minX, maxX: f.maxX, minZ: f.minZ, maxZ: f.maxZ,
      y0: f.minY, y1: f.maxY, source: f.source || "worldLayout" });
  });
  // Continent V2's scale landmarks are intentionally outside A.lots (they are
  // open navigation shelters, not pretend enterable businesses). Publish their
  // real footprints so the same structure-in-water lint still proves them safe.
  (A.frontierLandmarks || []).forEach((l) => {
    const fp = { minX: l.minX, maxX: l.maxX, minZ: l.minZ, maxZ: l.maxZ };
    push(Object.assign({ layer: "feature", type: "frontier-landmark", name: l.name,
      zone: "frontier", shape: "rect", shoreMin: footprintShoreMin(fp),
      y0: 0, y1: 31.5, source: "city/continent" }, fp));
  });

  // ---- terrain surface meshes (userData.terrain / worldSurface) ----
  // The owner-visible "terrains overlap" class: each island paints an organic
  // ground skirt that can spill far past its declared region rect. Instanced
  // prop meshes also carry userData.terrain (farcull flag) — the >=400 m2
  // footprint filter keeps only real ground slabs.
  const tbox = new THREE.Box3(), tsize = new THREE.Vector3();
  CBZ.scene.traverse((o) => {
    if (!o || (!o.isMesh && !o.isInstancedMesh)) return;
    if (!o.userData || (!o.userData.terrain && !o.userData.worldSurface)) return;
    try {
      tbox.setFromObject(o); tbox.getSize(tsize);
      if (!Number.isFinite(tbox.min.x) || tsize.x * tsize.z < 400) return;
      let nm = o.name || "";
      for (let p = o.parent; p && !nm; p = p.parent) nm = p.name || "";
      push({ layer: "terrain", type: o.userData.worldSurface ? "worldSurface" : "terrain",
        name: nm || (o.isInstancedMesh ? "instanced-terrain" : "terrain-mesh"),
        shape: "rect", minX: R2(tbox.min.x), maxX: R2(tbox.max.x), minZ: R2(tbox.min.z), maxZ: R2(tbox.max.z),
        y0: R2(tbox.min.y), y1: R2(tbox.max.y), instances: o.isInstancedMesh ? o.count : 1, source: "scene(userData.terrain)" });
    } catch (e) {}
  });

  // ---- highway-mounted streetlights (InstancedMesh lamp poles inside each
  //      buildHighway group: CylinderGeometry height 7 — highways.js opts.lights) ----
  const highwayLamps = [];
  hwys.forEach((h, i) => {
    if (!h.group) return;
    h.group.traverse((o) => {
      if (!o || !o.isInstancedMesh || !o.geometry || !o.geometry.parameters) return;
      const g = o.geometry.parameters;
      if (o.geometry.type !== "CylinderGeometry" || g.height !== 7) return;
      const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      for (let k = 0; k < o.count; k++) {
        o.getMatrixAt(k, m4); m4.decompose(p, q, s);
        highwayLamps.push({ hwy: i, x: R2(p.x), z: R2(p.z), y: R2(p.y), deckY: R2(h.deckY) });
      }
    });
  });

  // ---- measured actors (ratio audit) ----
  const box = (o) => { try { const b = new THREE.Box3().setFromObject(o), s = new THREE.Vector3(); b.getSize(s);
    return { w: R2(s.x), h: R2(s.y), l: R2(s.z), minY: R2(b.min.y) }; } catch (e) { return null; } };
  const measures = { player: null, peds: [], cars: [], craft: [] };
  if (CBZ.playerChar && (CBZ.playerChar.model || CBZ.playerChar.group)) {
    measures.player = box(CBZ.playerChar.model || CBZ.playerChar.group);
    const m = CBZ.playerChar.metric || (CBZ.playerChar.group.userData && CBZ.playerChar.group.userData.characterMetric);
    if (measures.player && m) { measures.player.w = R2(m.width); measures.player.h = R2(m.height); measures.player.l = R2(m.depth); }
  }
  (CBZ.cityPeds || []).slice(0, 6).forEach((p) => {
    if (p && p.char && (p.char.model || p.char.group)) {
      const d = box(p.char.model || p.char.group), m = p.char.metric || (p.char.group.userData && p.char.group.userData.characterMetric);
      if (d) measures.peds.push({ name: p.name || null, h: m ? R2(m.height) : d.h });
    }
  });
  (CBZ.cityCars || []).slice(0, 60).forEach((c) => {
    if (c && c.dims) measures.cars.push({ model: (c.model && (c.model.name || c.model.id)) || (typeof c.model === "string" ? c.model : null), dims: c.dims });
  });
  const vp = new THREE.Vector3();
  CBZ.scene.traverse((o) => {
    if (!o || !o.userData || !o.userData.milKind) return;
    const declared = o.userData.aircraftDims;
    const d = declared
      ? { w: R2(declared.span), h: R2(declared.height), l: R2(declared.length), minY: 0 }
      : box(o);
    if (!d) return;
    o.getWorldPosition(vp);
    measures.craft.push({ kind: o.userData.milKind, name: o.userData.milName || o.name || null, dims: d, x: R2(vp.x), z: R2(vp.z) });
  });

  // ---- floor heights sample ----
  const floorHeights = [];
  (A.lots || []).forEach((l) => { if (l.building && Number.isFinite(l.building.FH)) floorHeights.push(R2(l.building.FH)); });

  const hasAirport = (A.regions || []).some((r) => /airport|field/i.test(r.name || "") || r.biome === "airport");
  // island_airport publishes its closure-local geometry as a read-only audit
  // contract; never mirror runway constants here (that stale copy concealed
  // scale fixes in earlier reports).
  const airportAudit = A.airportAudit || (CBZ.city && CBZ.city.airportAudit) || null;
  const runway = airportAudit && airportAudit.runway
    ? { minX: airportAudit.runway.minX, maxX: airportAudit.runway.maxX, minZ: airportAudit.runway.minZ, maxZ: airportAudit.runway.maxZ }
    : null;
  const pedsOnRunway = !hasAirport ? [] : (CBZ.cityPeds || [])
    .filter((p) => runway && p && p.pos && !p.dead && p.pos.x >= runway.minX && p.pos.x <= runway.maxX && p.pos.z >= runway.minZ && p.pos.z <= runway.maxZ)
    .map((p) => ({ name: p.name || null, job: p.job || null, x: R2(p.pos.x), z: R2(p.pos.z) }));
  // Ground-level people over the rendered coast's negative field are the
  // exact "NPC standing in open water" failure. Ignore moving-parent actors
  // (aircraft passengers) and elevated occupants; those can legitimately be
  // above the ocean without being a water population.
  const pedsInOpenWater = !shoreAt ? [] : (CBZ.cityPeds || [])
    .filter((p) => {
      if (!p || !p.pos || p.dead || p._parked || p._npcAttached || (p.pos.y || 0) > 1.5) return false;
      try { return +shoreAt(p.pos.x, p.pos.z) < -0.25; } catch (_) { return false; }
    })
    .map((p) => ({ name: p.name || null, job: p.job || null, x: R2(p.pos.x), z: R2(p.pos.z), shore: R2(+shoreAt(p.pos.x, p.pos.z)) }));

  // ---- collider sanity ----
  const cols = CBZ.colliders || [];
  const colliderSummary = { count: cols.length, invalid: 0, duplicates: 0 };
  const keys = new Set();
  for (const c of cols) {
    if (!Number.isFinite(c.minX) || !Number.isFinite(c.maxX) || c.minX > c.maxX || c.minZ > c.maxZ) { colliderSummary.invalid++; continue; }
    const k = [c.minX, c.maxX, c.minZ, c.maxZ, c.y0, c.y1].join("|");
    if (keys.has(k)) colliderSummary.duplicates++; else keys.add(k);
  }

  // map bounds from regions/land only — terrain/backdrop meshes can be huge
  const bounds = objects.reduce((b, o) => (o.layer !== "region" && o.layer !== "land") ? b : ({
    minX: Math.min(b.minX, o.minX), maxX: Math.max(b.maxX, o.maxX),
    minZ: Math.min(b.minZ, o.minZ), maxZ: Math.max(b.maxZ, o.maxZ),
  }), { minX: A.minX, maxX: A.maxX, minZ: A.minZ, maxZ: A.maxZ });

  // ---- gameplay contracts (read-only; no test mutates the live run) ----
  const crimeTypes = Array.isArray(CBZ.cityCrimeTypes) ? CBZ.cityCrimeTypes.slice() : [];
  const identities = CBZ.cityIdentities && CBZ.cityIdentities.all ? CBZ.cityIdentities.all() : [];
  const offlinePeople = CBZ.cityNpcLedger && CBZ.cityNpcLedger.serialize
    ? ((CBZ.cityNpcLedger.serialize() || {}).ids || []) : [];
  const wild = CBZ.cityWildlife || [];
  const dogs = CBZ.cityDogs || [];
  const air = CBZ.cityAirTrafficList ? CBZ.cityAirTrafficList() : [];
  const aiCars = (CBZ.cityCars || []).filter((c) => c && c.ai && !c.dead);
  const roadDistricts = {};
  aiCars.forEach((c) => { const d = c.road && c.road.district || "mainland"; roadDistricts[d] = (roadDistricts[d] || 0) + 1; });
  const identityKinds = {};
  identities.forEach((i) => { const k = i.kind || "npc"; identityKinds[k] = (identityKinds[k] || 0) + 1; });
  const programmedLots = objects.filter((o) => o.layer === "structure");
  const purposeCounts = {};
  programmedLots.forEach((o) => { const k = o.purpose || "unprogrammed"; purposeCounts[k] = (purposeCounts[k] || 0) + 1; });
  const builtLots = programmedLots.filter((o) => o.purpose !== "park");
  const gameplay = {
    wanted: {
      v2: !CBZ.CONFIG || CBZ.CONFIG.WANTED_STARS_V2 !== false,
      militaryGrace: CBZ.CONFIG && CBZ.CONFIG.WANTED_MIL_ZONE_GRACE,
      starHeat: CBZ.CITY && CBZ.CITY.starHeat ? CBZ.CITY.starHeat.slice() : [],
      crimeTypes,
      requiredCrimeIdsPresent: ["boosting", "carjacking", "grand-theft-police", "aircraft-hijacking", "grand-theft-military", "grand-theft-aircraft"].every((k) => crimeTypes.includes(k)),
      militaryBaseRegistered: !!CBZ._militaryBase,
    },
    identity: {
      registry: !!(CBZ.cityIdentities && CBZ.cityIdentities.register && CBZ.cityIdentities.markDead && CBZ.cityIdentities.serialize),
      offlineLedger: !!(CBZ.cityPedStash && CBZ.cityPedDeal && CBZ.cityLedgerSample),
      total: identities.length, kinds: identityKinds, offlinePeople: offlinePeople.length,
    },
    buildings: {
      totalLots: programmedLots.length,
      builtLots: builtLots.length,
      purposeCounts,
      unprogrammed: programmedLots.filter((o) => !o.purpose).map((o) => o.name || o.id),
      enclosedWithoutDoor: builtLots.filter((o) => o.enclosed && !o.hasDoor).map((o) => o.name || o.id),
      casinoLots: programmedLots.filter((o) => o.purpose === "casino").length,
      casinoGames: typeof CBZ.cityOpenActivities === "function",
    },
    spawn: {
      noSpawn: (A.noSpawn || []).map((z) => ({ label: z.label || null, minX: z.minX, maxX: z.maxX, minZ: z.minZ, maxZ: z.maxZ })),
      airportAudit,
      runwayPeds: pedsOnRunway.length,
      openWaterPeds: pedsInOpenWater.length,
    },
    population: {
      namedPeds: (CBZ.cityPeds || []).filter((p) => p && typeof p.name === "string" && p.name.trim()).length,
      jobbedPeds: (CBZ.cityPeds || []).filter((p) => p && typeof p.job === "string" && p.job.trim()).length,
      dailySchedule: typeof CBZ.citySchedProposal === "function" && typeof CBZ.citySunHour === "function",
      wildlife: wild.length, livingWildlife: wild.filter((a) => a && !a.dead).length,
      species: [...new Set(wild.map((a) => a && a.species && (a.species.id || a.species.name)).filter(Boolean))],
      wildlifeMotion: typeof CBZ.cityWildlifeMotionStats === "function" ? CBZ.cityWildlifeMotionStats() : null,
      dogs: dogs.length, livingDogs: dogs.filter((d) => d && !d.dead).length,
      traffic: aiCars.length, roadDistricts, ambientAircraft: air.length,
    },
    worldScale: A.worldScale ? Object.assign({}, A.worldScale) : null,
  };

  return {
    generatedAt: new Date().toISOString(), seed: CBZ.WORLD_SEED,
    bounds, objects, measures, floorHeights, highwayLamps,
    laneW: Number.isFinite(T.laneW) ? T.laneW : 3.6, roadW: RW,
    runway: hasAirport && runway ? runway : null, pedsOnRunway, pedsInOpenWater,
    colliderSummary, gameplay,
    roadMismatches: (A.roads || []).filter((r) => {
      const width = Number.isFinite(r.width) ? r.width : (Number.isFinite(r.w) ? r.w : RW);
      const travel = (r.lanesPerDir || 2) * (r.laneW || 3.6) * 2 + (Number.isFinite(r.medianW) ? r.medianW : 0);
      return width + 0.01 < travel;
    }).length,
    counts: {
      regions: (A.regions || []).length, lots: (A.lots || []).length, roads: (A.roads || []).length,
      props: (A.streetProps || []).length, highways: hwys.length,
      peds: (CBZ.cityPeds || []).length, cars: (CBZ.cityCars || []).length,
    },
  };
})()`;

// A short, disposable behavior probe. The audit browser is thrown away after
// capture, so it can exercise each wanted tier and restore the player without
// contaminating a real save. Geometry is collected first and remains read-only.
const GAMEPLAY_PROBE = String.raw`(async () => {
  const g = CBZ.game, P = CBZ.player;
  if (!g || !P || !P.pos || !CBZ.cityWantedReset || !CBZ.cityCrime) return { available: false };
  const old = { x: P.pos.x, y: P.pos.y, z: P.pos.z };
  const test = (type, severity) => {
    CBZ.cityWantedReset();
    CBZ.cityCrime(severity, { type, instant: true, x: old.x, z: old.z });
    return g.wanted | 0;
  };
  const theftTiers = {
    boosting: test("boosting", 60),
    carjacking: test("carjacking", 120),
    policeCruiser: test("grand-theft-police", 130),
    aircraft: test("aircraft-hijacking", 180),
    militaryAircraft: test("grand-theft-aircraft", 220),
  };
  CBZ.cityWantedReset();
  const B = CBZ._militaryBase;
  let militaryEntry = null;
  let wantedUpdaterCount = 0;
  if (B && B.center) {
    P.pos.x = B.center.x; P.pos.z = B.center.z;
    // Run the same order-33 callbacks used by the live loop once while the
    // player is inside the wire. This avoids a headless tab's rAF throttling
    // turning a valid jurisdiction rule into a false audit failure.
    const wantedBand = (CBZ.updaters || []).filter((u) => u && u.order === 33 && typeof u.fn === "function");
    wantedUpdaterCount = wantedBand.length;
    wantedBand.forEach((u) => { try { u.fn(0.016); } catch (e) {} });
    militaryEntry = g.wanted | 0;
  }
  P.pos.x = old.x; P.pos.y = old.y; P.pos.z = old.z;
  CBZ.cityWantedReset();
  return {
    available: true,
    theftTiers,
    militaryEntry,
    wantedUpdaterCount,
    pass: theftTiers.boosting === 1 && theftTiers.carjacking === 2
      && theftTiers.policeCruiser === 3 && theftTiers.aircraft === 4
      && theftTiers.militaryAircraft === 5 && militaryEntry === 5,
  };
})()`;

/* ================= in-page annotated map renderer ================= */

const MAP_SETUP = String.raw`(() => {
  if (window.__auditMap) return true;
  window.__auditMap = function (payloadJSON) {
    const P = JSON.parse(payloadJSON);
    CBZ.game.state = "world-audit";              // freeze updaters (loop still renders; we render manually)
    if (CBZ.scene) CBZ.scene.fog = null;
    CBZ.scene.traverse((o) => { if (o && (o.isMesh || o.isInstancedMesh)) o.frustumCulled = false; });
    const W = 1400, H = 1400;
    const cx = (P.minX + P.maxX) / 2, cz = (P.minZ + P.maxZ) / 2;
    const span = Math.max(P.maxX - P.minX, P.maxZ - P.minZ) * 0.54;
    const cam = new THREE.OrthographicCamera(-span, span, span, -span, 1, 4000);
    cam.position.set(cx, 1200, cz);
    cam.up.set(0, 0, -1);
    cam.lookAt(cx, 0, cz);
    cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
    CBZ.renderer.setSize(W, H, false);
    CBZ.renderer.render(CBZ.scene, cam);          // manual render...
    // ...and copy it out IN THE SAME TASK (no preserveDrawingBuffer): the game
    // loop keeps stomping the WebGL canvas, but our 2D copy is safe.
    let cv = document.getElementById("auditMapCanvas");
    if (!cv) {
      cv = document.createElement("canvas"); cv.id = "auditMapCanvas";
      cv.width = W; cv.height = H;
      cv.style.cssText = "position:fixed;left:0;top:0;width:" + W + "px;height:" + H + "px;z-index:999999;background:#000;";
      document.body.appendChild(cv);
      const st = document.createElement("style");
      st.textContent = "body > :not(#auditMapCanvas) { display:none !important; }";
      document.head.appendChild(st);
    }
    const ctx = cv.getContext("2d");
    ctx.drawImage(CBZ.renderer.domElement, 0, 0, W, H);
    // world -> pixel through the LIVE camera (never hand-roll the mapping)
    const v = new THREE.Vector3();
    const px = (x, z) => { v.set(x, 0, z).project(cam); return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H]; };
    ctx.lineWidth = 1.5;
    ctx.font = "13px monospace";
    for (const a of P.ann) {
      ctx.strokeStyle = a.color; ctx.fillStyle = a.color;
      if (a.kind === "rect") {
        const p0 = px(a.minX, a.minZ), p1 = px(a.maxX, a.maxZ);
        const rx = Math.min(p0[0], p1[0]), ry = Math.min(p0[1], p1[1]);
        const rw = Math.abs(p1[0] - p0[0]), rh = Math.abs(p1[1] - p0[1]);
        if (a.fill) { ctx.globalAlpha = 0.3; ctx.fillRect(rx, ry, rw, rh); ctx.globalAlpha = 1; }
        ctx.lineWidth = a.lw || 1.5;
        ctx.strokeRect(rx, ry, Math.max(rw, 2), Math.max(rh, 2));
      } else if (a.kind === "circle") {
        const p0 = px(a.cx, a.cz), p1 = px(a.cx + a.r, a.cz);
        ctx.lineWidth = a.lw || 1.5;
        ctx.beginPath(); ctx.arc(p0[0], p0[1], Math.abs(p1[0] - p0[0]), 0, Math.PI * 2); ctx.stroke();
      } else if (a.kind === "dot") {
        const p0 = px(a.x, a.z);
        ctx.beginPath(); ctx.arc(p0[0], p0[1], a.r || 3, 0, Math.PI * 2); ctx.fill();
      } else if (a.kind === "label") {
        const p0 = px(a.x, a.z);
        ctx.save(); ctx.shadowColor = "#000"; ctx.shadowBlur = 4;
        ctx.fillText(a.text, p0[0] + (a.dx || 4), p0[1] + (a.dy || -4)); ctx.restore();
      }
    }
    // legend
    const L = P.legend;
    ctx.globalAlpha = 0.82; ctx.fillStyle = "#0b0f14";
    ctx.fillRect(10, 10, 400, 30 + L.length * 20); ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff"; ctx.font = "bold 14px monospace";
    ctx.fillText(P.title, 20, 30);
    ctx.font = "13px monospace";
    L.forEach((row, i) => {
      ctx.fillStyle = row[0]; ctx.fillRect(20, 40 + i * 20, 12, 12);
      ctx.fillStyle = "#eee"; ctx.fillText(row[1], 40, 51 + i * 20);
    });
    return true;
  };
  return true;
})()`;

function buildAnnotations(dump, overlaps, ratios, lint) {
  const ann = [];
  // region outlines + names (white / gray for links) — the base "see the map" layer
  for (const o of dump.objects) {
    if (o.layer !== "region" && o.layer !== "land") continue;
    const real = o.layer === "land" || isRealRegion(o);
    const color = real ? "rgba(255,255,255,0.75)" : "rgba(160,160,160,0.4)";
    if (o.shape === "circle") ann.push({ kind: "circle", cx: o.cx, cz: o.cz, r: o.r, color });
    else ann.push({ kind: "rect", minX: o.minX, maxX: o.maxX, minZ: o.minZ, maxZ: o.maxZ, color });
    if (real && o.name) ann.push({ kind: "label", x: o.minX, z: o.minZ, dx: 4, dy: 14, text: o.name, color: "#fff" });
  }
  // red: overlap intersections (top 40, labels for top 12)
  overlaps.slice(0, 40).forEach((ov, i) => {
    if (!ov.rect) return;
    ann.push({ kind: "rect", minX: ov.rect.minX, maxX: ov.rect.maxX, minZ: ov.rect.minZ, maxZ: ov.rect.maxZ, color: "#ff2d2d", fill: true, lw: 2 });
    if (i < 12) ann.push({ kind: "label", x: ov.rect.minX, z: ov.rect.maxZ, dy: 16, text: "#" + (i + 1) + " " + (ov.a.name || ov.a.type) + " x " + (ov.b.name || ov.b.type), color: "#ff6d6d" });
  });
  // orange: locatable ratio offenders
  for (const r of ratios.filter((x) => x.at).slice(0, 20)) {
    ann.push({ kind: "dot", x: r.at.x, z: r.at.z, r: 5, color: "#ff9c1a" });
    ann.push({ kind: "label", x: r.at.x, z: r.at.z, text: r.subject + " " + r.factor + "x", color: "#ff9c1a" });
  }
  // yellow: props in roads; magenta: props on highways; cyan: in water
  for (const p of lint.propsInRoad.slice(0, 400)) ann.push({ kind: "dot", x: p.x, z: p.z, r: 3, color: "#ffe100" });
  for (const p of lint.propsOnHighway.slice(0, 400)) ann.push({ kind: "dot", x: p.x, z: p.z, r: 3, color: "#ff3df2" });
  for (const s of lint.structuresInWater.slice(0, 60)) ann.push({ kind: "dot", x: s.x, z: s.z, r: 5, color: "#22d6ff" });
  const legend = [
    ["#ff2d2d", "overlap (top " + Math.min(40, overlaps.length) + " of " + overlaps.length + ")"],
    ["#ff9c1a", "ratio offender (" + ratios.length + ")"],
    ["#ffe100", "prop in road lanes (" + lint.counts.propsInRoad + ")"],
    ["#ff3df2", "prop on highway (" + lint.counts.propsOnHighway + ")"],
    ["#22d6ff", "structure in water (" + lint.counts.structuresInWater + ")"],
    ["#ffffff", "region outline + name"],
  ];
  return {
    minX: dump.bounds.minX, maxX: dump.bounds.maxX, minZ: dump.bounds.minZ, maxZ: dump.bounds.maxZ,
    ann, legend, title: "world-audit seed " + dump.seed,
  };
}

/* ================= report ================= */

function makeReport(dump, overlaps, ratios, lint) {
  const L = [];
  L.push("WORLD AUDIT — seed " + dump.seed + "  (" + dump.generatedAt + ")");
  L.push("counts: " + JSON.stringify(dump.counts));
  const ws = dump.gameplay && dump.gameplay.worldScale;
  if (ws) {
    const km2 = (n) => Number.isFinite(n) ? (n / 1e6).toFixed(2) : "?";
    const m0 = (n) => Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "?";
    L.push("world scale: " + m0(ws.authoredWidth) + "x" + m0(ws.authoredDepth) + "m authored -> "
      + m0(ws.playableWidth) + "x" + m0(ws.playableDepth) + "m playable; "
      + km2(ws.authoredArea) + " -> " + km2(ws.playableArea) + " km2 bounding area (+"
      + (Number.isFinite(ws.areaGainPct) ? ws.areaGainPct.toFixed(1) : "?") + "%)");
    L.push("frontier: " + m0(ws.frontierLoopMeters) + "m road loop, " + (ws.frontierLandmarks || 0)
      + " landmarks; shore clearance road/landmark=" + [ws.frontierRoadMinShore, ws.frontierLandmarkMinShore]
        .map((n) => Number.isFinite(n) ? n.toFixed(1) + "m" : "?").join(" / "));
  }
  L.push("");
  L.push("== TOP 20 OVERLAPS (ranked by containment of the smaller object) ==");
  if (!overlaps.length) L.push("  none above thresholds");
  overlaps.slice(0, 20).forEach((o, i) => {
    L.push("  #" + String(i + 1).padStart(2) + " [" + o.tier + "] " + o.class + ": "
      + (o.a.name || o.a.type) + " x " + (o.b.name || o.b.type)
      + " — " + o.area + " m2, " + o.smallerCoveredPct + "% of smaller covered"
      + (o.at ? " @ (" + o.at.x + "," + o.at.z + ")" : ""));
  });
  L.push("");
  L.push("== WORST RATIO VIOLATIONS (human = 1.8u anchor) ==");
  if (!ratios.length) L.push("  none");
  ratios.slice(0, 20).forEach((r, i) => {
    L.push("  #" + String(i + 1).padStart(2) + " [" + r.tier + "] " + r.subject + ": " + r.measured
      + " vs expected [" + r.expected.join("-") + "] (" + r.band + ") — " + r.factor + "x off"
      + (r.note ? "  // " + r.note : ""));
  });
  L.push("");
  L.push("== PLACEMENT LINT ==");
  L.push("  props in road travel lanes: " + lint.counts.propsInRoad
    + (lint.propsInRoad.length ? "   e.g. " + lint.propsInRoad.slice(0, 5).map((p) => p.type + "@(" + p.x + "," + p.z + ")").join(" ") : ""));
  L.push("  props on highway decks:     " + lint.counts.propsOnHighway
    + (lint.propsOnHighway.length ? "   e.g. " + lint.propsOnHighway.slice(0, 5).map((p) => p.type + "@(" + p.x + "," + p.z + ")").join(" ") : ""));
  if (lint.highwayLightCounts && Object.keys(lint.highwayLightCounts).length)
    L.push("    highway-mounted lamp instances per span: " + JSON.stringify(lint.highwayLightCounts));
  L.push("  structures in water:        " + lint.counts.structuresInWater
    + (lint.structuresInWater.length ? "   e.g. " + lint.structuresInWater.slice(0, 5).map((s) => (s.name || s.type) + "@(" + s.x + "," + s.z + ")").join(" ") : ""));
  L.push("  peds on runway:             " + lint.counts.pedsOnRunway);
  L.push("  peds in open water:         " + lint.counts.pedsInOpenWater
    + (lint.pedsInOpenWater.length ? "   e.g. " + lint.pedsInOpenWater.slice(0, 5).map((p) => (p.name || p.job || "ped") + "@(" + p.x + "," + p.z + ")").join(" ") : ""));
  L.push("  road width<travel mismatches: " + (dump.roadMismatches || 0));
  L.push("  world-scale contract failures: " + ((lint.worldScaleFailures && lint.worldScaleFailures.length) || 0)
    + (lint.worldScaleFailures && lint.worldScaleFailures.length ? "   " + lint.worldScaleFailures.join("; ") : ""));
  L.push("  colliders: " + JSON.stringify(dump.colliderSummary));
  if (dump.gameplay) {
    const g = dump.gameplay;
    L.push("");
    L.push("== GAMEPLAY CONTRACTS ==");
    L.push("  wanted ids / military base: " + !!(g.wanted && g.wanted.requiredCrimeIdsPresent) + " / " + !!(g.wanted && g.wanted.militaryBaseRegistered)
      + "   grace=" + (g.wanted && g.wanted.militaryGrace));
    L.push("  identity registry / offline ledger: " + !!(g.identity && g.identity.registry) + " / " + !!(g.identity && g.identity.offlineLedger)
      + "   named roles / offline people=" + [((g.identity && g.identity.total) || 0), ((g.identity && g.identity.offlinePeople) || 0)].join(" / "));
    L.push("  airport no-spawn zones / runway peds: " + ((g.spawn && g.spawn.noSpawn && g.spawn.noSpawn.length) || 0)
      + " / " + ((g.spawn && g.spawn.runwayPeds) || 0));
    L.push("  programmed lots / enclosed without doors / casinos: "
      + [g.buildings && g.buildings.totalLots, g.buildings && g.buildings.enclosedWithoutDoor && g.buildings.enclosedWithoutDoor.length,
        g.buildings && g.buildings.casinoLots].join(" / ")
      + "   casino games=" + !!(g.buildings && g.buildings.casinoGames));
    L.push("  wildlife / dogs / traffic / ambient aircraft: "
      + [g.population.wildlife, g.population.dogs, g.population.traffic, g.population.ambientAircraft].join(" / "));
    L.push("  named / jobbed peds + daily schedule: "
      + [g.population.namedPeds, g.population.jobbedPeds].join(" / ") + " + " + !!g.population.dailySchedule);
    if (g.probes) L.push("  wanted behavior probe: " + !!g.probes.pass
      + "   theft=" + JSON.stringify(g.probes.theftTiers) + " military-entry=" + g.probes.militaryEntry);
  }
  return L.join("\n");
}

/* ================= CDP harness ================= */

async function auditSeed(seed) {
  const outDir = path.join(ROOT, "tools", "audit", "seed" + seed);
  await mkdir(outDir, { recursive: true });
  const port = 8811;
  const dbg = 9810 + Math.floor(Math.random() * 80);
  const profile = `/tmp/cbz-audit-${process.pid}-${dbg}`;
  await rm(profile, { recursive: true, force: true });
  const base = `http://127.0.0.1:${port}/?seed=${seed}`;
  const chromeBin = process.env.CBZ_CHROME || (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");

  const server = spawn("python3", [path.join(ROOT, "tools", "devserver.py")], {
    cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: "ignore",
  });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base)).ok) break; } catch (_) {} await sleep(400); }

  const chrome = spawn(chromeBin, [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--mute-audio",
    "--window-size=1400,1400", `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, base,
  ], { cwd: ROOT, stdio: "ignore" });

  const errors = [];
  let ws = null;
  try {
    let page = null;
    for (let i = 0; i < 120 && !page; i++) {
      try {
        const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
        page = ps.find((p) => p.type === "page" && p.url.includes(`seed=${seed}`));
      } catch (_) {}
      if (!page) await sleep(250);
    }
    if (!page) throw new Error("no chrome page target");
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
    let id = 1; const pending = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
      if (m.method === "Runtime.exceptionThrown") {
        const d = m.params.exceptionDetails;
        errors.push(`${d.url || "?"}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`);
      } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
        errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 200));
      }
    });
    const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const evl = async (expression, awaitPromise = false) => {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
      const res = r.result;
      if (res && res.exceptionDetails) throw new Error("in-page: " + ((res.exceptionDetails.exception && res.exceptionDetails.exception.description) || res.exceptionDetails.text || "eval failed").split("\n")[0]);
      return res && res.result && res.result.value;
    };
    await send("Runtime.enable"); await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 1400, deviceScaleFactor: 1, mobile: false });

    // wait for scripts, then re-click PLAY until the state actually flips
    for (let i = 0; i < 120; i++) {
      if (await evl("!!(window.CBZ && CBZ.game && document.getElementById('playBtn'))").catch(() => false)) break;
      await sleep(500);
    }
    // Audit the complete sandbox simulation, not the campaign prologue's
    // deliberate observation gate (which keeps street traffic/crowds cold while
    // the player is on the rooftop). This changes only the disposable tab.
    await evl("(() => { CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false; return true; })()");
    console.log(`[seed ${seed}] scripts ready — pressing PLAY (world build takes a while headless)...`);
    let playing = false;
    for (let i = 0; i < 320 && !playing; i++) {
      await evl("(() => { const b = document.getElementById('playBtn'); if (b) { b.click(); b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); b.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); } return true; })()").catch(() => {});
      await sleep(1500);
      playing = await evl("!!(window.CBZ && CBZ.game && CBZ.game.state === 'playing' && CBZ.city && CBZ.city.arena)").catch(() => false);
    }
    if (!playing) throw new Error("game never reached playing state with a built arena");
    // let props/peds settle
    for (let i = 0; i < 40; i++) {
      if (await evl("!!(CBZ.city.arena.streetProps && CBZ.city.arena.streetProps.length)").catch(() => false)) break;
      await sleep(500);
    }
    await sleep(2000);

    console.log(`[seed ${seed}] collecting objects...`);
    const dump = await evl(COLLECT);
    if (dump.gameplay) dump.gameplay.probes = await evl(GAMEPLAY_PROBE, true);
    const overlaps = analyzeOverlaps(dump.objects);
    const ratios = analyzeRatios(dump);
    const lint = analyzeLint(dump.objects, {
      pedsOnRunway: dump.pedsOnRunway, pedsInOpenWater: dump.pedsInOpenWater, roadMismatches: dump.roadMismatches,
      colliderSummary: dump.colliderSummary, highwayLamps: dump.highwayLamps,
      worldScale: dump.gameplay && dump.gameplay.worldScale,
    });
    overlaps.forEach((o) => { if (!o.tier) o.tier = "WARN"; });

    await writeFile(path.join(outDir, "objects.json"), JSON.stringify(dump, null, 1));
    await writeFile(path.join(outDir, "overlaps.json"), JSON.stringify(overlaps, null, 1));
    await writeFile(path.join(outDir, "ratio-violations.json"), JSON.stringify(ratios, null, 1));
    await writeFile(path.join(outDir, "lint.json"), JSON.stringify(lint, null, 1));
    const report = makeReport(dump, overlaps, ratios, lint);
    await writeFile(path.join(outDir, "report.txt"), report + "\n");
    console.log(report);

    if (DRAW_MAP) {
      await evl(MAP_SETUP);
      const payload = buildAnnotations(dump, overlaps, ratios, lint);
      await evl("__auditMap(" + JSON.stringify(JSON.stringify(payload)) + ")");
      await sleep(600);
      const shot = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(path.join(outDir, "annotated.png"), Buffer.from(shot.result.data, "base64"));
      console.log(`[seed ${seed}] map: ${path.relative(ROOT, path.join(outDir, "annotated.png"))}`);
    }
    const uniq = [...new Set(errors)];
    if (uniq.length) console.log(`[seed ${seed}] browser errors (${uniq.length}): ` + uniq.slice(0, 5).join(" | "));
    return { seed, overlaps: overlaps.length, ratios: ratios.length, lint: lint.counts };
  } finally {
    try { if (ws && ws.readyState === WebSocket.OPEN) ws.close(); } catch (_) {}
    try { chrome.kill("SIGTERM"); } catch (_) {}
    try { server.kill("SIGTERM"); } catch (_) {}
    await sleep(300);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

async function reanalyzeSeed(seed) {
  const outDir = path.join(ROOT, "tools", "audit", "seed" + seed);
  const dump = JSON.parse(await readFile(path.join(outDir, "objects.json"), "utf8"));
  const overlaps = analyzeOverlaps(dump.objects);
  const ratios = analyzeRatios(dump);
  const lint = analyzeLint(dump.objects, {
    pedsOnRunway: dump.pedsOnRunway, pedsInOpenWater: dump.pedsInOpenWater, roadMismatches: dump.roadMismatches,
    colliderSummary: dump.colliderSummary, highwayLamps: dump.highwayLamps,
    worldScale: dump.gameplay && dump.gameplay.worldScale,
  });
  overlaps.forEach((o) => { if (!o.tier) o.tier = "WARN"; });
  await writeFile(path.join(outDir, "overlaps.json"), JSON.stringify(overlaps, null, 1));
  await writeFile(path.join(outDir, "ratio-violations.json"), JSON.stringify(ratios, null, 1));
  await writeFile(path.join(outDir, "lint.json"), JSON.stringify(lint, null, 1));
  const report = makeReport(dump, overlaps, ratios, lint);
  await writeFile(path.join(outDir, "report.txt"), report + "\n");
  console.log(report);
  return { seed, overlaps: overlaps.length, ratios: ratios.length, lint: lint.counts };
}

const results = [];
for (const seed of seeds) {
  try { results.push(await (REANALYZE ? reanalyzeSeed(seed) : auditSeed(seed))); }
  catch (err) { console.error(`[seed ${seed}] FAIL: ${err.message || err}`); results.push({ seed, failed: true }); process.exitCode = 1; }
}
console.log("\n[world-audit] " + JSON.stringify(results));

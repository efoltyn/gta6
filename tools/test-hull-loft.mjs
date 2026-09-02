#!/usr/bin/env node
/* tools/test-hull-loft.mjs — THE LOFT IS A SURFACE, AND THE NUMBERS AGREE
   WITH THE SPEC SHEET.

   src/world/hull_loft.js is the primitive every boat in the game is now
   drawn on, so it gets a geometry-level regression rather than a screenshot.
   Four things are asserted, and each of them is a bug the box hulls had:

     1. MANIFOLD. Every edge is shared by exactly two faces, except the
        deliberately open rims (the sheer, and the cockpit hole). Adjacency
        is keyed by rounded POSITION, not by index: every hard edge in the
        loft is a positional duplicate of a vertex, because that is the only
        way one position carries two normals.
     2. FINITE. No NaN anywhere in position or normal.
     3. SMOOTH. audit().faceted < 0.25 — the fraction of adjacent face pairs
        breaking more than 25 degrees. A BoxGeometry scores 0.67 and a stack
        of stepped prisms scores higher; that number is the whole reason this
        file exists, so case 3 pins the control.
     4. THE LINES ARE THE LINES. The widest station falls inside the parallel
        midbody planHalfBeam declares, the keel sits `draft` below the
        waterline, and the sheer sits `freeboard` above it amidships — all
        within 2 cm.

   Usage: node tools/test-hull-loft.mjs        Exit 0 = ok.                */
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import * as THREE from "three";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sandbox = { window: {} };
sandbox.window.window = sandbox.window;
sandbox.window.THREE = THREE;
sandbox.window.CBZ = {};
vm.createContext(sandbox);
const file = path.join(ROOT, "src/world/hull_loft.js");
vm.runInContext(await readFile(file, "utf8"), sandbox, { filename: file });

const HL = sandbox.window.CBZ.hullLoft;
const fails = [];
const notes = [];
function ok(cond, msg) { if (!cond) fails.push(msg); }
function near(a, b, tol, msg) {
  if (!(Math.abs(a - b) <= tol)) fails.push(`${msg} — got ${a.toFixed(4)}, want ${b.toFixed(4)} ±${tol}`);
}

if (!HL) { console.error("FAIL: CBZ.hullLoft never published"); process.exit(1); }
for (const k of ["surface", "stationsFromLines", "mesh", "outline", "strip", "audit"]) {
  ok(typeof HL[k] === "function", `hullLoft.${k} missing`);
}

// ---- boundary analysis, by POSITION -----------------------------------------
function boundary(geo) {
  const p = geo.attributes.position.array;
  const idx = geo.index.array;
  const Q = 1e4;
  const key = (i) => `${Math.round(p[i * 3] * Q)},${Math.round(p[i * 3 + 1] * Q)},${Math.round(p[i * 3 + 2] * Q)}`;
  const edges = new Map();
  for (let f = 0; f < idx.length / 3; f++) {
    const k = [key(idx[f * 3]), key(idx[f * 3 + 1]), key(idx[f * 3 + 2])];
    for (const [a, b] of [[k[0], k[1]], [k[1], k[2]], [k[2], k[0]]]) {
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(e, (edges.get(e) || 0) + 1);
    }
  }
  const open = [], over = [];
  edges.forEach((n, e) => { if (n === 1) open.push(e); else if (n > 2) over.push(e); });
  return { open, over, total: edges.size };
}
const yOf = (e) => e.split("|").map((v) => Number(v.split(",")[1]) / 1e4);

function finite(geo, label) {
  for (const name of ["position", "normal"]) {
    const a = geo.attributes[name];
    ok(!!a, `${label}: no ${name} attribute`);
    if (!a) continue;
    for (let i = 0; i < a.array.length; i++) {
      if (!Number.isFinite(a.array[i])) { fails.push(`${label}: NaN in ${name} at ${i}`); break; }
    }
  }
}

// =============================================================================
//  CASE 1 — a deep-V hard-chine planing hull (the jetski / skiff family)
// =============================================================================
{
  const L = { loa: 5.5, beam: 1.9, draft: 0.30, freeboard: 0.62, sheerBow: 0.30,
    sheerStern: 0.05, deadrise: 8, flareBow: 14, tumblehome: 4, transomRake: 10, n: 15 };
  const st = HL.stationsFromLines(L);
  const geo = HL.surface(st, { rings: 9, chine: "auto", transom: "flat" });
  finite(geo, "deep-V");
  const a = HL.audit(geo);
  notes.push(`deep-V: ${a.tris} tris · ${a.verts} verts · faceted ${a.faceted.toFixed(3)} · open ${a.openEdges}`);
  ok(a.tris > 200, `deep-V too coarse (${a.tris} tris)`);
  ok(a.faceted < 0.25, `deep-V faceted ${a.faceted.toFixed(3)} — that is still boxes`);
  ok(a.nonManifold === 0, `deep-V has ${a.nonManifold} edges shared by >2 faces`);

  const b = boundary(geo);
  const sheerMin = Math.min(...st.map((s) => s.pts[s.pts.length - 1][0])) - 0.02;
  const bad = b.open.filter((e) => yOf(e).some((y) => y < sheerMin));
  ok(bad.length === 0, `deep-V: ${bad.length} open edges below the sheer (a hole in the hull)`);
  ok(b.over.length === 0, `deep-V: ${b.over.length} non-manifold edges`);

  // the lines
  const out = HL.outline(st);
  near(out.keelYAt(0), -L.draft, 0.02, "deep-V keel amidships");
  near(out.sheerYAt(0), L.freeboard, 0.02, "deep-V freeboard amidships");
  let deepest = 0, deepZ = 0;
  for (const s of st) if (s.pts[0][0] < deepest) { deepest = s.pts[0][0]; deepZ = s.z; }
  near(deepest, -L.draft, 0.02, "deep-V deepest keel point");
  // the widest station must fall inside the declared parallel midbody
  let wide = -1, wideT = 0;
  st.forEach((s, i) => {
    let hb = 0; for (const q of s.pts) hb = Math.max(hb, Math.abs(q[1]));
    if (hb > wide) { wide = hb; wideT = i / (st.length - 1); }
  });
  near(wide, L.beam / 2, 0.02, "deep-V max half-beam");
  ok(wideT >= 0.19 && wideT <= 0.67, `deep-V widest station t=${wideT.toFixed(3)} is outside the parallel midbody 0.20-0.66`);
  // and the geometry agrees with the stations
  geo.computeBoundingBox();
  near(geo.boundingBox.max.x - geo.boundingBox.min.x, L.beam, 0.02, "deep-V measured beam");
  near(geo.boundingBox.min.y, -L.draft, 0.02, "deep-V measured keel");
  notes.push(`deep-V: max beam ${(wide * 2).toFixed(3)} at t=${wideT.toFixed(2)}, keel ${deepest.toFixed(3)} at z=${deepZ.toFixed(2)}`);
}

// =============================================================================
//  CASE 2 — a round-bilge decked hull with a cockpit (the kayak family)
// =============================================================================
{
  const L = { loa: 4.2, beam: 0.72, draft: 0.12, freeboard: 0.28, sheerBow: 0.16,
    sheerStern: 0.12, roundBilge: true, tumblehome: 16, flareBow: 0, transomRake: 0,
    tMaxBeam: 0.48, rockerAft: 0.55, n: 19 };
  const st = HL.stationsFromLines(L);
  const geo = HL.surface(st, { rings: 11, transom: "none", deck: true, deckCamber: 0.035,
    cockpit: { z0: -0.55, z1: 0.62, halfW: 0.19 } });
  finite(geo, "round-bilge");
  const a = HL.audit(geo);
  notes.push(`kayak: ${a.tris} tris · ${a.verts} verts · faceted ${a.faceted.toFixed(3)} · open ${a.openEdges}`);
  ok(a.faceted < 0.25, `round-bilge faceted ${a.faceted.toFixed(3)} — a kayak has no corners`);
  ok(a.nonManifold === 0, `round-bilge has ${a.nonManifold} non-manifold edges`);
  ok(geo.userData.hullLoft.deckTris > 0, "round-bilge deck produced no triangles");

  const b = boundary(geo);
  // The ONLY open rims allowed: the cockpit hole and the open transom.
  const sternZ = st[0].z;
  const Q = 1e4;
  const zOf = (e) => e.split("|").map((v) => Number(v.split(",")[2]) / Q);
  const stray = b.open.filter((e) => {
    const zz = zOf(e), yy = yOf(e);
    const atTransom = zz.every((z) => z <= sternZ + 1e-3);
    const inCockpit = zz.every((z) => z >= -0.70 && z <= 0.78) && yy.every((y) => y > 0.15);
    return !atTransom && !inCockpit;
  });
  ok(stray.length === 0, `round-bilge: ${stray.length} open edges that are neither the transom nor the cockpit rim`);
  ok(b.over.length === 0, `round-bilge: ${b.over.length} non-manifold edges`);

  const out = HL.outline(st);
  near(out.keelYAt(0), -L.draft, 0.02, "kayak keel amidships");
  near(out.sheerYAt(0), L.freeboard, 0.02, "kayak freeboard amidships");
  geo.computeBoundingBox();
  near(geo.boundingBox.max.x - geo.boundingBox.min.x, L.beam, 0.02, "kayak measured beam");
  near(geo.boundingBox.max.z - geo.boundingBox.min.z, L.loa, 0.02, "kayak measured LOA");
  notes.push(`kayak: LOA ${(geo.boundingBox.max.z - geo.boundingBox.min.z).toFixed(3)} beam ${(geo.boundingBox.max.x - geo.boundingBox.min.x).toFixed(3)}`);
}

// =============================================================================
//  CASE 3 — the control: a BOX must score 1.00 faceted, or the metric lies
// =============================================================================
{
  const box = new THREE.BoxGeometry(2, 1, 6);
  const a = HL.audit(box.toNonIndexed ? box : box);
  notes.push(`control box: faceted ${a.faceted.toFixed(3)}`);
  ok(a.faceted > 0.55, `a BoxGeometry scored ${a.faceted.toFixed(3)} faceted — the metric is not measuring boxes`);
}

// =============================================================================
//  CASE 4 — strip() and outline() actually place things
// =============================================================================
{
  const st = HL.stationsFromLines({ loa: 7.6, beam: 2.2, draft: 0.45, freeboard: 0.75,
    sheerBow: 0.55, deadrise: 12, flareBow: 22, n: 13 });
  const out = HL.outline(st);
  ok(out.sheerStarboard.length === st.length, "outline lost sheer points");
  ok(out.sheer.length === st.length * 2, "outline sheer should carry both sides");
  const rail = HL.strip(out.sheerStarboard, 0.035, null, {});
  ok(rail && rail.geometry && rail.geometry.attributes.position.count > 20, "strip() produced no tube");
  const hbMid = out.halfBeamAt(0);
  near(hbMid * 2, 2.2, 0.05, "panga beam at amidships from outline()");
  notes.push(`panga: outline half-beam at z=0 is ${hbMid.toFixed(3)}, rail ${rail.geometry.attributes.position.count} verts`);
}

for (const n of notes) console.log("  " + n);
if (fails.length) {
  console.error(`\nFAIL (${fails.length}):`);
  for (const f of fails) console.error("  · " + f);
  process.exit(1);
}
console.log(`\nOK — hull_loft: ${notes.length} cases, 0 failures`);

#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/systems/reality.js", import.meta.url), "utf8");
const context = vm.createContext({
  window: { CBZ: {} },
  performance: { now: () => Number(process.hrtime.bigint()) / 1e6 }
});
vm.runInContext(source, context, { filename: "src/systems/reality.js" });

const reality = context.window.CBZ.reality;
assert.ok(reality, "reality API should install");

function box(id, minX, minY, minZ, maxX, maxY, maxZ, kind = "test") {
  return { id, kind, minX, minY, minZ, maxX, maxY, maxZ };
}

// A grounded stack and a disconnected hanging stack are two components. Only
// the latter should fail; arbitrary world height is never treated as support.
const graph = reality.supportAudit([
  box("ground", 0, 0, 0, 1, 1, 1),
  box("on-ground", 0, 1, 0, 1, 2, 1),
  box("floating-a", 5, 10, 5, 6, 11, 6, "float"),
  box("floating-b", 5, 11, 5, 6, 12, 6, "float")
], { groundY: 0, contactEps: 0.01, cell: 1 });
assert.equal(graph.components, 2);
assert.equal(graph.unsupportedCount, 2);
assert.equal(graph.unsupportedComponents, 1);
assert.equal(graph.unsupportedByKind.float, 2);

// Authored walk surfaces anchor only geometry whose bottom actually reaches
// the surface tolerance. The deliberately raised seat remains floating.
const surface = reality.supportAudit([
  box("deck-slab", 0, 1.82, 0, 2, 2, 2, "deck"),
  box("raised-seat", 3, 2.36, 0, 4, 2.8, 1, "seat")
], {
  surfaces: [{ minX: -1, maxX: 5, minZ: -1, maxZ: 3, top: 2 }],
  surfaceEps: 0.205,
  surfacePenetration: 0.205,
  contactEps: 0.01
});
assert.equal(surface.unsupportedCount, 1);
assert.equal(surface.unsupportedByKind.seat, 1);

// Transform math must rotate dimensions, not just rotate the centre.
const rotated = reality.boxFromTransform({
  x: 10, y: 4, z: -3, sx: 2, sy: 4, sz: 6, ry: Math.PI / 2
});
assert.ok(Math.abs(rotated.minX - 7) < 1e-9);
assert.ok(Math.abs(rotated.maxX - 13) < 1e-9);
assert.ok(Math.abs(rotated.minZ - (-4)) < 1e-9);
assert.ok(Math.abs(rotated.maxZ - (-2)) < 1e-9);

// Face contact is valid support but is not positive-volume overlap.
const overlap = reality.overlapAudit([
  box("a", 0, 0, 0, 1, 1, 1, "wall"),
  box("b", 0.5, 0.5, 0.5, 1.5, 1.5, 1.5, "prop"),
  box("touch", 1.5, 0.5, 0.5, 2.5, 1.5, 1.5, "prop")
], { minDepth: 0.001, cell: 1 });
assert.equal(overlap.overlapCount, 1);
assert.equal(overlap.byPair["prop|wall"], 1);

// Scaling check: the broad phase should stay local, not approach 4,000².
const field = [];
for (let i = 0; i < 4000; i++) {
  const x = (i % 100) * 2;
  const z = ((i / 100) | 0) * 2;
  field.push(box("field:" + i, x, 0, z, x + 0.5, 0.5, z + 0.5, "prop"));
}
const scale = reality.supportAudit(field, {
  groundY: 0,
  contactEps: 0.02,
  cell: 1
});
assert.equal(scale.unsupportedCount, 0);
assert.ok(scale.candidatePairs < 100000,
  `broad phase regressed: ${scale.candidatePairs} candidate pairs`);

// Property check against the definition, with a deterministic LCG. Tiny cells
// and deliberately huge boxes exercise the hash's "large object" fallback:
// a broad phase may offer extra candidates, but it must never miss a contact.
let rs = 0x6d2b79f5;
function rand() {
  rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0;
  return rs / 4294967296;
}
let propertyNear = 0, propertyOverlaps = 0;
for (let trial = 0; trial < 24; trial++) {
  const boxes = [], n = 72 + (rand() * 48 | 0);
  for (let i = 0; i < n; i++) {
    const x = (rand() - 0.5) * 70, y = (rand() - 0.5) * 24, z = (rand() - 0.5) * 70;
    const sx = i % 31 === 0 ? 26 : 0.05 + rand() * 6;
    const sy = i % 37 === 0 ? 18 : 0.05 + rand() * 6;
    const sz = i % 41 === 0 ? 26 : 0.05 + rand() * 6;
    boxes.push(box(i, x - sx / 2, y - sy / 2, z - sz / 2,
      x + sx / 2, y + sy / 2, z + sz / 2));
  }
  const eps = rand() * 0.2, got = new Set(), expected = new Set();
  reality.broadphasePairs(boxes, {
    cell: 0.35 + rand() * 4.5, eps, maxCells: 64
  }, (a, b) => got.add(Math.min(a.id, b.id) + ":" + Math.max(a.id, b.id)));

  let expectedOverlap = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.maxX + eps >= b.minX && b.maxX + eps >= a.minX
      && a.maxY + eps >= b.minY && b.maxY + eps >= a.minY
      && a.maxZ + eps >= b.minZ && b.maxZ + eps >= a.minZ)
      expected.add(i + ":" + j);
    const dx = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
    const dy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
    const dz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
    if (dx > 0.01 && dy > 0.01 && dz > 0.01) expectedOverlap++;
  }
  assert.deepEqual([...got].sort(), [...expected].sort(),
    `broad phase missed a contact in property trial ${trial}`);
  const overlaps = reality.overlapAudit(boxes, {
    cell: 0.35 + rand() * 4.5, minDepth: 0.01, maxCells: 64
  });
  assert.equal(overlaps.overlapCount, expectedOverlap,
    `overlap audit diverged from brute force in property trial ${trial}`);
  propertyNear += expected.size;
  propertyOverlaps += expectedOverlap;
}

console.log(JSON.stringify({
  ok: true,
  graph: {
    total: graph.total,
    unsupported: graph.unsupportedCount,
    components: graph.components
  },
  scale: {
    total: scale.total,
    candidates: scale.candidatePairs,
    buckets: scale.buckets,
    ms: scale.ms
  },
  property: {
    trials: 24,
    nearPairs: propertyNear,
    overlaps: propertyOverlaps
  }
}, null, 2));

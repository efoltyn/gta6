#!/usr/bin/env node
/*
 * Bake the exact geometry used by Three.js's webgl_loader_ifc example into a
 * static GLB. Runtime IFC parsing is intentionally avoided: the source BIM is
 * 42 MB and StreamAllMeshes is a synchronous, one-time authoring operation.
 *
 * Usage:
 *   node --max-old-space-size=8192 tools/bake-official-ifc.mjs [input] [output]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as THREE from "three";

const require = createRequire(import.meta.url);
const { IfcAPI } = require("web-ifc");
const input = process.argv[2] || "assets/official/ifc/rac_advanced_sample_project.ifc";
const output = process.argv[3] || "assets/official/ifc/rac_advanced_sample_project.glb";

const api = new IfcAPI();
await api.Init();
const data = new Uint8Array(readFileSync(input));
const modelID = api.OpenModel(data, { COORDINATE_TO_ORIGIN: true });

const buckets = {
  opaque: { chunks: [], vertexCount: 0, indexCount: 0 },
  transparent: { chunks: [], vertexCount: 0, indexCount: 0 },
};
const matrix = new THREE.Matrix4();
const normalMatrix = new THREE.Matrix3();
const p = new THREE.Vector3();
const n = new THREE.Vector3();
const color = new THREE.Color();
const worldMin = new THREE.Vector3(Infinity, Infinity, Infinity);
const worldMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
let placementCount = 0;

api.StreamAllMeshes(modelID, (flatMesh) => {
  const placed = flatMesh.geometries;
  for (let i = 0; i < placed.size(); i++) {
    const pg = placed.get(i);
    const owned = api.GetGeometry(modelID, pg.geometryExpressID);
    const srcVertices = api.GetVertexArray(owned.GetVertexData(), owned.GetVertexDataSize());
    const srcIndices = api.GetIndexArray(owned.GetIndexData(), owned.GetIndexDataSize());
    const vertexCount = srcVertices.length / 6;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 4);
    const indices = new Uint32Array(srcIndices.length);

    matrix.fromArray(pg.flatTransformation);
    normalMatrix.getNormalMatrix(matrix);
    color.setRGB(pg.color.x, pg.color.y, pg.color.z, THREE.SRGBColorSpace);

    for (let v = 0; v < vertexCount; v++) {
      const s = v * 6, d3 = v * 3, d4 = v * 4;
      p.set(srcVertices[s], srcVertices[s + 1], srcVertices[s + 2]).applyMatrix4(matrix);
      n.set(srcVertices[s + 3], srcVertices[s + 4], srcVertices[s + 5]).applyNormalMatrix(normalMatrix);
      positions[d3] = p.x; positions[d3 + 1] = p.y; positions[d3 + 2] = p.z;
      normals[d3] = n.x; normals[d3 + 1] = n.y; normals[d3 + 2] = n.z;
      colors[d4] = color.r; colors[d4 + 1] = color.g; colors[d4 + 2] = color.b; colors[d4 + 3] = pg.color.w;
      worldMin.min(p); worldMax.max(p);
    }
    for (let j = 0; j < srcIndices.length; j++) indices[j] = srcIndices[j];

    const bucket = pg.color.w < 0.999 ? buckets.transparent : buckets.opaque;
    bucket.chunks.push({ positions, normals, colors, indices, baseVertex: bucket.vertexCount });
    bucket.vertexCount += vertexCount;
    bucket.indexCount += indices.length;
    placementCount++;
    owned.delete();
  }
});
api.CloseModel(modelID);

function mergeBucket(bucket) {
  if (!bucket.vertexCount) return null;
  const positions = new Float32Array(bucket.vertexCount * 3);
  const normals = new Float32Array(bucket.vertexCount * 3);
  const colors = new Float32Array(bucket.vertexCount * 4);
  const indices = new Uint32Array(bucket.indexCount);
  let v3 = 0, v4 = 0, ii = 0;
  for (const c of bucket.chunks) {
    positions.set(c.positions, v3); normals.set(c.normals, v3); colors.set(c.colors, v4);
    for (let j = 0; j < c.indices.length; j++) indices[ii + j] = c.indices[j] + c.baseVertex;
    v3 += c.positions.length; v4 += c.colors.length; ii += c.indices.length;
  }
  return { positions, normals, colors, indices };
}

const merged = [mergeBucket(buckets.opaque), mergeBucket(buckets.transparent)];
const json = {
  asset: { version: "2.0", generator: "CBZ exact Three.js IFC sample bake" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: "RAC Advanced Sample Project" }],
  meshes: [{ name: "RAC Advanced Sample Project", primitives: [] }],
  materials: [
    { name: "IFC opaque vertex colors", doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.72 } },
    { name: "IFC transparent vertex colors", doubleSided: true, alphaMode: "BLEND", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.72 } },
  ],
  buffers: [{ byteLength: 0 }], bufferViews: [], accessors: [],
};
const binaryParts = [];
let byteOffset = 0;
function addView(typed, target) {
  const pad = (4 - (byteOffset & 3)) & 3;
  if (pad) { binaryParts.push(Buffer.alloc(pad)); byteOffset += pad; }
  const src = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  const view = json.bufferViews.length;
  json.bufferViews.push({ buffer: 0, byteOffset, byteLength: src.length, target });
  binaryParts.push(src); byteOffset += src.length;
  return view;
}
function accessor(view, componentType, count, type, min, max, normalized) {
  const a = { bufferView: view, componentType, count, type };
  if (min) a.min = min; if (max) a.max = max; if (normalized) a.normalized = true;
  json.accessors.push(a); return json.accessors.length - 1;
}
for (let i = 0; i < merged.length; i++) {
  const m = merged[i]; if (!m) continue;
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < m.positions.length; v += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], m.positions[v + k]); max[k] = Math.max(max[k], m.positions[v + k]);
  }
  const pView = addView(m.positions, 34962), nView = addView(m.normals, 34962), cView = addView(m.colors, 34962), iView = addView(m.indices, 34963);
  json.meshes[0].primitives.push({
    attributes: {
      POSITION: accessor(pView, 5126, m.positions.length / 3, "VEC3", min, max),
      NORMAL: accessor(nView, 5126, m.normals.length / 3, "VEC3"),
      COLOR_0: accessor(cView, 5126, m.colors.length / 4, "VEC4"),
    },
    indices: accessor(iView, 5125, m.indices.length, "SCALAR"), material: i,
  });
}
json.buffers[0].byteLength = byteOffset;

let jsonBuf = Buffer.from(JSON.stringify(json));
jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length & 3)) & 3, 0x20)]);
let binBuf = Buffer.concat(binaryParts);
binBuf = Buffer.concat([binBuf, Buffer.alloc((4 - (binBuf.length & 3)) & 3)]);
const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(jsonBuf.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binBuf.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
writeFileSync(output, Buffer.concat([header, jsonHeader, jsonBuf, binHeader, binBuf]));

console.log(JSON.stringify({
  input, output, placements: placementCount,
  vertices: merged.reduce((s, m) => s + (m ? m.positions.length / 3 : 0), 0),
  triangles: merged.reduce((s, m) => s + (m ? m.indices.length / 3 : 0), 0),
  bounds: { min: worldMin.toArray(), max: worldMax.toArray() }, bytes: total,
}, null, 2));

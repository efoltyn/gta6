import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Use the game's shipped Three r128, not the newer npm dependency. No
// `document` here: the kit must build every geometry with no canvas to paint.
const ctx = vm.createContext({ console });
ctx.window = ctx; ctx.self = ctx;
ctx.CBZ = { CONFIG: {}, qScale: (_lo, hi) => hi };
for (const file of ['src/vendor/three.r128.min.js', 'src/vendor/BufferGeometryUtils.js',
  'src/world/treeaudit.js', 'src/world/vegetation.js', 'src/world/rockscliffs.js']) {
  vm.runInContext(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), ctx, { filename: file });
}
const { THREE: T, CBZ: C } = ctx;
const tris = geo => (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
const NOMINAL = { 'landscape-crown': [8.1, 11.4], 'mature-crown': [9.3, 12.8], 'conifer-spire': [3.15, 23], thicket: [4.0, 4.3] };
for (const kind of Object.keys(NOMINAL)) {
  const hashes = [];
  for (let v = 0; v < 3; v++) {
    const g = C.vegetationKit.geometry(kind, v);
    assert.equal(g, C.vegetationKit.geometry(kind, v), 'geometry is cached');
    assert.ok(g.attributes.position.array.every(Number.isFinite));
    assert.ok(g.attributes.uv && g.attributes.normal && g.attributes.color, 'leaf cards carry uv, normal, color');
    assert.ok(g.userData.leafCards > 8, 'a crown is a cloud of cards');
    assert.ok(Math.abs(g.boundingBox.min.y) < 1e-5, 'crown starts on its authored seat');
    assert.ok(Math.abs(g.boundingBox.max.y - NOMINAL[kind][1]) < 1e-3, 'crown height is the nominal height');
    const r = Math.max(-g.boundingBox.min.x, g.boundingBox.max.x, -g.boundingBox.min.z, g.boundingBox.max.z);
    assert.ok(Math.abs(r - NOMINAL[kind][0]) < 1e-3, 'crown radius is the nominal radius');
    hashes.push(Array.from(g.attributes.position.array).join(','));
    if (kind === 'landscape-crown') {
      const wood = C.vegetationKit.geometry('landscape-wood');
      assert.ok(tris(g) + tris(wood) <= 400, `country-wide tree stays within budget (${tris(g)} + ${tris(wood)})`);
      const crownBox = g.boundingBox.clone().translate(new T.Vector3(0, 13, 0));
      assert.ok(wood.boundingBox.intersectsBox(crownBox), 'crown joins the timber');
      assert.ok(wood.attributes.uv, 'bark has uvs');
    }
  }
  assert.equal(new Set(hashes).size, 3, 'three distinct crown geometries');
}
// the ONE TREE GRAMMAR routes to the kit
const street = C.treeCrownGeo({ tiers: 2, r: 0.82, h: 1.8, leaf: true, site: 'test' });
assert.ok(street.userData.leafCards > 8, 'treeCrownGeo leaf:true builds cards');
assert.ok(Math.abs(street.boundingBox.max.y - 1.8) < 1e-3 && Math.abs(street.boundingBox.min.y) < 1e-5);
const lifted = C.treeCrownGeo({ tiers: 3, r: 0.62, h: 1.18, y0: 0.13, leaf: true, site: 'test' });
assert.ok(Math.abs(lifted.boundingBox.min.y - 0.13) < 1e-5, 'y0 seats a lifted crown');
assert.equal(C.treeCrownGeo({ tiers: 2, r: 0.82, h: 1.8, leaf: true, site: 'test' }), street, 'custom crowns are cached');
const legacy = C.treeCrownGeo({ tiers: 2, r: 1, h: 1 });
assert.ok(!legacy.userData.leafCards, 'without leaf:true the cone stack still exists');
// materials build without a document (no map) and with the shared flags
const fol = C.vegetationKit.material('mature-crown');
assert.equal(fol, C.vegetationKit.material('landscape-crown'), 'one foliage material');
assert.ok(fol.vertexColors && !fol.flatShading);
assert.notEqual(fol, C.vegetationKit.material('mature-wood'));

const a = C.makeRock(2, 123, 1), b = C.makeRock(2, 220, 1), again = C.makeRock(2, 123, 1);
assert.deepEqual(a.attributes.position.array, again.attributes.position.array, 'seed is deterministic');
assert.notDeepEqual(a.attributes.position.array, b.attributes.position.array, 'seed changes actual fractures');
assert.equal(a.attributes.position.count, new T.IcosahedronGeometry(2, 1).attributes.position.count);
assert.ok(a.attributes.normal.array.every(Number.isFinite), 'fractures retain normals');
const p = a.attributes.position;
let cut = 0;
const edgeUse = new Map();
const key = i => [p.getX(i), p.getY(i), p.getZ(i)].map(x => Math.round(x * 1e5)).join(',');
for (let i = 0; i < p.count; i++) {
  const r = Math.hypot(p.getX(i), p.getY(i), p.getZ(i));
  assert.ok(r <= 2.00001, 'scraping never expands the stone');
  if (r < 1.95) cut++;
}
for (let i = 0; i < p.count; i += 3) {
  for (const [j, k] of [[0, 1], [1, 2], [2, 0]]) {
    const edge = [key(i + j), key(i + k)].sort().join('|');
    edgeUse.set(edge, (edgeUse.get(edge) || 0) + 1);
  }
}
assert.ok(cut > p.count / 5, 'fracturing reaches the rendered surface');
assert.ok([...edgeUse.values()].every(n => n === 2), 'welded rock has no open seams');
const lc = C.vegetationKit.geometry('landscape-crown'), lw = C.vegetationKit.geometry('landscape-wood');
console.log(`PASS: r${T.REVISION}; leaf-card crowns (landscape ${lc.userData.leafCards} cards / ${tris(lc)} tris, wood ${tris(lw)} tris); deterministic, closed fractured rocks (${cut}/${p.count} cut corners).`);

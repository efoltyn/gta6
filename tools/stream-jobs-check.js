// tools/stream-jobs-check.js — plain node, no browser: a streamed job is built, freed when far
// (its objects, colliders, shops and placement leave; its world data stays) and re-run when near.
//   node tools/stream-jobs-check.js
const path = require("path"), fs = require("fs"), vm = require("vm");
const ROOT = path.resolve(__dirname, "..");
const THREE = require(ROOT + "/src/vendor/three.r128.min.js");
const win = { THREE, performance, console, setTimeout, clearTimeout, location: { search: "?stream=1" }, document: { readyState: "complete" }, URLSearchParams };
win.window = win; win.self = win;
const ctx = vm.createContext(win);
const CBZ = win.CBZ = { CONFIG: {}, colliders: [], platforms: [], losBlockers: [], updaters: [], always: [], game: { mode: "city" } };
CBZ.onUpdate = (o, fn) => CBZ.updaters.push({ o, fn });
CBZ.scene = new THREE.Scene();
const root = new THREE.Group(); CBZ.scene.add(root);
CBZ.city = { arena: { root, regions: [], roads: [], shops: [] } };
CBZ.player = { pos: new THREE.Vector3(0, 0, 0) };
for (const f of ["src/core/slice.js", "src/core/citystream.js", "src/city/placement.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
}
CBZ.streamBegin(0, 0);
const S = CBZ.slice; S.r = 150;
console.log("keepR", S.keepR());
let built = 0;
function town(x) { return function () {
  built++;
  const g = new THREE.Group(); g.name = "town" + x;
  const m = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial()); m.position.set(x, 0, 0); g.add(m); root.add(g);
  CBZ.colliders.push({ minX: x - 5, maxX: x + 5, minZ: -5, maxZ: 5, ref: m });
  CBZ.city.arena.shops.push({ x });
  CBZ.city.arena.regions.push({ name: "T" + x, minX: x - 20, maxX: x + 20, minZ: -20, maxZ: 20 });
  CBZ.placement.reserve({ minX: x - 5, maxX: x + 5, minZ: -5, maxZ: 5 });
}; }
CBZ.sliceAt({ minX: 90, maxX: 110, minZ: -10, maxZ: 10 }, town(100), { name: "near" });
CBZ.sliceAt({ minX: 3990, maxX: 4010, minZ: -10, maxZ: 10 }, town(4000), { name: "far" });
const stat = () => ({ built, kids: root.children.length, cols: CBZ.colliders.length, shops: CBZ.city.arena.shops.length, regions: CBZ.city.arena.regions.length, res: CBZ.placement.snapshot().length, jobs: CBZ.streamJobs.map(j => j.name + ":" + j.state).join(",") });
console.log("boot", JSON.stringify(stat()));
// drive to the far town
CBZ.player.pos.set(3900, 0, 0); CBZ.streamTick(true);
console.log("at far", JSON.stringify(stat()));
// drive far away from both
CBZ.player.pos.set(9000, 0, 9000); CBZ.streamTick(true);
console.log("away", JSON.stringify(stat()), JSON.stringify(CBZ.streamStats));
// back to the far town: re-run
CBZ.player.pos.set(3900, 0, 0); CBZ.streamTick(true);
console.log("back", JSON.stringify(stat()));
CBZ.player.pos.set(9000, 0, 9000); CBZ.streamTick(true);
CBZ.player.pos.set(0, 0, 0); CBZ.streamTick(true);
console.log("home", JSON.stringify(stat()));

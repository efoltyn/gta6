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
for (const f of ["src/core/slice.js", "src/core/sight.js", "src/core/citystream.js", "src/city/placement.js"]) {
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
// ---- nested: a "town" job whose parcels are child jobs (built when seen)
let lotsBuilt = 0;
function townWithLots(x0) { return function () {
  CBZ.city.arena.shops.push({ town: x0 });
  for (let i = 0; i < 6; i++) {
    const lx = x0 + i * 300;
    CBZ.sliceAt({ minX: lx - 10, maxX: lx + 10, minZ: -10, maxZ: 10 }, function () {
      lotsBuilt++;
      const m = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), new THREE.MeshBasicMaterial()); m.position.set(lx, 0, 0); root.add(m);
      CBZ.colliders.push({ minX: lx - 2, maxX: lx + 2, minZ: -2, maxZ: 2, ref: m });
    }, { name: "lot" });
  }
}; }
CBZ.sliceAt({ minX: 20000, maxX: 21600, minZ: -10, maxZ: 10 }, townWithLots(20000), { name: "town" });
CBZ.player.pos.set(20000, 0, 0); CBZ.streamTick(true);
const lotJobs = () => CBZ.streamJobs.filter(j => j.name === "lot");
console.log("town near its west end", JSON.stringify({ lotsBuilt, lotJobs: lotJobs().map(j => j.state).join(","), cols: CBZ.colliders.length }));
const inline = lotsBuilt;
CBZ.player.pos.set(21500, 0, 0); CBZ.streamTick(true);
console.log("drive to the east end", JSON.stringify({ lotsBuilt, lotJobs: lotJobs().map(j => j.state).join(","), cols: CBZ.colliders.length }));
CBZ.player.pos.set(0, 0, 0); CBZ.streamTick(true);
const left = { lotJobs: lotJobs().length, cols: CBZ.colliders.length, kids: root.children.length, shops: CBZ.city.arena.shops.length };
console.log("home again", JSON.stringify(left));
let nfail = 0;
if (inline < 1 || inline >= 6) { nfail++; console.log("FAIL: only the parcels in sight build with the town"); }
if (lotsBuilt <= inline) { nfail++; console.log("FAIL: far parcels never built on approach"); }
if (left.lotJobs !== 0) { nfail++; console.log("FAIL: freed town left child jobs"); }
console.log(nfail ? "NESTED FAIL" : "NESTED OK");
if (nfail) process.exit(1);

// ---- a job in STEPS (an array of independent parts): the frames build it a
// part at a time, its parts stay out of the scene until the last one, then it
// joins as one unit; a forced tick (a teleport) builds it whole at once
const stepRuns = [0, 0, 0, 0, 0];
const parts = stepRuns.map(function (_, i) { return function () {
  stepRuns[i]++;
  const m = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial()); m.position.set(40000 + i * 5, 0, 0); m.name = "part" + i; root.add(m);
  CBZ.colliders.push({ minX: 40000 + i * 5 - 1, maxX: 40000 + i * 5 + 1, minZ: -1, maxZ: 1, ref: m });
  CBZ.losBlockers.push(m);          // a sight blocker: never raycast while its part is held out
  // a slow part: well over a frame's share
  const t = performance.now(); while (performance.now() - t < 6) {}
}; });
CBZ.sliceAt({ minX: 39990, maxX: 40030, minZ: -10, maxZ: 10 }, parts, { name: "cell" });
const cellJob = () => CBZ.streamJobs.find(j => j.name === "cell");
const frame = (dt) => { for (const u of CBZ.updaters) u.fn(dt); };
const partsIn = () => root.children.filter(o => /^part/.test(o.name)).length;
// approach from far enough that it is not in view (the frames build it)
CBZ.player.pos.set(39990 - CBZ.slice.view() - 15, 0, 0); CBZ.streamTick(false);
let sawHalf = false, frames = 0, losHeld = true;
const losParts = () => CBZ.losBlockers.filter(m => /^part/.test(m.name)).length;
while (cellJob().state !== "built" && frames < 200) { frame(1 / 60); frames++; if (cellJob().state === "building" && (partsIn() > 0 || losParts() > 0)) sawHalf = true; }
if (losParts() !== 5) losHeld = false;
const stepped = { state: cellJob().state, frames, runs: stepRuns.join(""), inScene: partsIn(), sawHalf };
console.log("stepped cell", JSON.stringify(stepped));
let sfail = 0;
if (stepped.state !== "built" || stepped.runs !== "11111" || stepped.inScene !== 5) { sfail++; console.log("FAIL: the stepped job did not build each part once and join whole"); }
if (stepped.frames < 2) { sfail++; console.log("FAIL: the stepped job was built in one frame"); }
if (sawHalf) { sfail++; console.log("FAIL: a half-built stepped job showed parts in the scene (or its sight blockers in the LOS list)"); }
if (!losHeld) { sfail++; console.log("FAIL: the stepped job's sight blockers did not come back with it"); }
CBZ.player.pos.set(0, 0, 0); CBZ.streamTick(true);
const away = { state: cellJob().state, inScene: partsIn(), cols: CBZ.colliders.filter(c => c.minX > 39000).length };
console.log("stepped cell away", JSON.stringify(away));
if (away.inScene || away.cols || away.state !== "queued") { sfail++; console.log("FAIL: the stepped job was not freed"); }
CBZ.player.pos.set(40000, 0, 0); CBZ.streamTick(true);
console.log("teleport into it", JSON.stringify({ state: cellJob().state, runs: stepRuns.join(""), inScene: partsIn() }));
if (cellJob().state !== "built" || stepRuns.join("") !== "22222" || partsIn() !== 5) { sfail++; console.log("FAIL: a forced tick did not build the stepped job whole"); }
console.log(sfail ? "STEPS FAIL" : "STEPS OK");
if (sfail) process.exit(1);

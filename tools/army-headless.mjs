#!/usr/bin/env node
/* tools/army-headless.mjs — GANG CITY'S ARMY, IN NODE. No browser.

   Boots the battle core with the CITY host (src/city/army.js loads the core
   and compiles the sim into its realm between city/armypage.js and
   city/armyrealm.js, exactly as it does on index.html) over a stub city:
   a rolling floor (CBZ.floorAt), a block of buildings as real collider
   records under the city's own physics names (CBZ.collide,
   CBZ.queryCollidersNear, CBZ.rayColliders), the player, the city's hurt and
   explosion seams. Real three.js r128 (math + scene graph), the real brain,
   combat_iq, ballistics and weapon table; a person is a bare group (the
   node world has no character rig), a vehicle builds from its real unit file.

     node tools/army-headless.mjs           every scenario
     node tools/army-headless.mjs 2         one

   1  two forces meet on city streets: the core's own men fight it out
      through the city host (no war-room page), somebody wins, nothing threw
   2  orders: hold keeps a force on its ground, move takes it somewhere,
      attack sends it at the objective; the far rows march (tiers) too
   3  the player: a hostile side shoots at him through cityHurtPlayer, his
      round lands on a soldier through CBZ.army.shot, a city blast reaches
      the soldiers through CBZ.army.blast
   4  armour in the city: an M1 Abrams and riflemen v riflemen (the unit file
      builds, the crew plan seats the force's own men, the hull fights)
   5  the route seam: a "route" order goes to a registered driver; with none
      the force walks the points and reports route-done
   6  disband: a force leaves the map and its rows are freed               */
import path from "node:path";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const only = process.argv[2] ? +process.argv[2] : 0;
let fails = 0, passes = 0;
function check(ok, msg) { if (ok) { passes++; console.log("  PASS " + msg); } else { fails++; console.log("  FAIL " + msg); } }
const src = (rel) => fs.readFileSync(path.join(ROOT, "src", rel), "utf8");

/* ---------------------------------------------------------------- the stub city */
function boot(opts) {
  opts = opts || {};
  let clock = 0;
  const sb = {
    console, Math, JSON, Date, Promise, Map, Set, WeakMap, Symbol, Proxy, Reflect, Array, Object, Number, String, Boolean,
    Float32Array, Float64Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Int16Array, Uint8ClampedArray, ArrayBuffer, DataView,
    Error, TypeError, RangeError, SyntaxError, ReferenceError, parseInt, parseFloat, isFinite, isNaN, Infinity, NaN, undefined,
    URLSearchParams, TextDecoder, TextEncoder, setTimeout: (f) => { try { f(); } catch (e) { console.error(e); } return 0; }, clearTimeout() {},
    performance: { now: () => clock * 1000 },
    navigator: { maxTouchPoints: 0, userAgent: "node" }, innerWidth: 1280, innerHeight: 720,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    addEventListener() {}, removeEventListener() {},
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  vm.createContext(sb);
  const run = (rel) => vm.runInContext(src(rel), sb, { filename: "src/" + rel });
  run("vendor/three.r128.min.js");
  const THREE = sb.THREE;
  sb.CBZ = { CONFIG: {}, game: { mode: "city", state: "playing" }, now: 0 };
  const CBZ = sb.CBZ;
  for (const f of ["core/seed.js", "weapons/weapon-data.js", "weapons/ballistics.js", "systems/brain.js", "systems/combat_iq.js", "systems/armour.js"]) {
    try { run(f); } catch (e) { console.log("  (load " + f + " threw: " + e.message + ")"); }
  }
  CBZ.scene = new THREE.Scene();
  CBZ.camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 9000);
  CBZ.camera.position.set(0, 30, 0);
  // the floor: a rolling city basin (solidground.js's CBZ.floorAt)
  CBZ.floorAt = (x, z) => 2 * Math.sin(x * 0.01) * Math.cos(z * 0.012) + 0.5 * Math.sin((x + z) * 0.04);
  // a few city blocks as collider records ({minX..maxZ, y0, y1}), physics.js's shape
  const COL = [];
  for (const b of opts.blocks || []) {
    const g = CBZ.floorAt((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
    COL.push({ minX: b[0], minZ: b[1], maxX: b[2], maxZ: b[3], y0: g - 1, y1: g + (b[4] || 20) });
  }
  CBZ.colliders = COL;
  CBZ.queryCollidersNear = (x, z, r, out) => {
    out = out || []; out.length = 0;
    for (const c of COL) if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) out.push(c);
    return out;
  };
  CBZ.collide = (p, r, feet, head) => {
    let moved = false;
    for (const c of COL) {
      if (feet != null && head != null && (head <= c.y0 || feet >= c.y1)) continue;
      const cx = Math.max(c.minX, Math.min(p.x, c.maxX)), cz = Math.max(c.minZ, Math.min(p.z, c.maxZ));
      const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
      if (d >= r) continue;
      moved = true;
      if (d < 1e-6) {
        const ex = [p.x - c.minX, c.maxX - p.x, p.z - c.minZ, c.maxZ - p.z], k = ex.indexOf(Math.min(...ex));
        if (k === 0) p.x = c.minX - r; else if (k === 1) p.x = c.maxX + r; else if (k === 2) p.z = c.minZ - r; else p.z = c.maxZ + r;
      } else { p.x = cx + dx / d * r; p.z = cz + dz / d * r; }
    }
    return moved;
  };
  CBZ.rayColliders = (ox, oy, oz, dx, dy, dz, maxT, out) => {
    let best = maxT, bc = null;
    for (const c of COL) {
      let t0 = 0, t1 = best;
      const lo = [c.minX, c.y0, c.minZ], hi = [c.maxX, c.y1, c.maxZ], a = [ox, oy, oz], d = [dx, dy, dz];
      let hit = true;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(d[k]) < 1e-12) { if (a[k] < lo[k] || a[k] > hi[k]) { hit = false; break; } continue; }
        let u = (lo[k] - a[k]) / d[k], v = (hi[k] - a[k]) / d[k];
        if (u > v) { const q = u; u = v; v = q; }
        if (u > t0) t0 = u; if (v < t1) t1 = v; if (t0 > t1) { hit = false; break; }
      }
      if (hit && t0 < best) { best = t0; bc = c; }
    }
    if (out) { out.hit = !!bc; out.c = bc; out.t = best; out.nx = 0; out.ny = 0; out.nz = 0; }
    return bc;
  };
  // a person: the node world has no character rig (CBZ.makeCharacter), so a
  // bare group stands in for the body; everything it does is the sim's
  CBZ.makeCharacter = () => { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.3), new THREE.MeshLambertMaterial())); return g; };
  CBZ.cmat = (c) => new THREE.MeshLambertMaterial({ color: c });
  CBZ.tracer = () => {}; CBZ.sfx = () => {}; CBZ.bulletImpact = () => {}; CBZ.bulletHole = () => {}; CBZ.muzzleFlash = () => {};
  CBZ.WILDLIFE_SPECIES = {};
  // the player and the city's seams
  const P = { pos: new THREE.Vector3(0, 0, 0), hp: 200, maxHp: 200, dead: false, speed: 0 };
  CBZ.player = P;
  const hurt = { n: 0, dmg: 0 };
  CBZ.cityHurtPlayer = (dmg) => { hurt.n++; hurt.dmg += dmg; P.hp -= dmg; if (P.hp <= 0) P.dead = true; };
  let stars = 0;
  CBZ.cityStars = () => stars;
  const booms = [];
  CBZ.cityExplosion = (x, z, o) => { booms.push({ x, z, o }); if (CBZ.army && CBZ.army.blast) CBZ.army.blast(x, z, (o.radius || 6) * (o.power || 1), o.power || 1, o); };
  // the loader: the file system for <script> and fetch (city/army.js io)
  run("city/army.js");
  CBZ.army.io = {
    script: (rel) => { try { run(rel); } catch (e) { console.log("  (script " + rel + " threw: " + e.message + ")"); } return Promise.resolve(true); },
    text: (rel) => Promise.resolve(src(rel)),
  };
  // unit files load through unitkit's tags: run them for real here
  const loadedUnits = new Set();
  const origLoadUnits = CBZ.army.loadUnits;
  CBZ.army.loadUnits = (ids) => CBZ.army.loadKit().then(() => {
    const K = CBZ.unitKit, M = CBZ.UNIT_MANIFEST || {};
    for (const id of ids || []) {
      if (!id || id === "men" || loadedUnits.has(id) || !K.fileOf(id)) continue;
      loadedUnits.add(id);
      for (const n of (M[id] && M[id].needs) || []) { try { run(n); } catch (e) { console.log("  (needs " + n + " threw: " + e.message + ")"); } }
      try { run(K.fileOf(id)); } catch (e) { console.log("  (unit " + id + " threw: " + e.message + ")"); }
    }
    return ids.filter((id) => K.has(id));
  });
  void origLoadUnits;
  return {
    sb, CBZ, THREE, P, hurt, booms, setStars: (s) => { stars = s; },
    step: (secs, each) => { let t = 0; while (t < secs - 1e-9) { const dt = 1 / 20; clock += dt; CBZ.now += dt * 1000; CBZ.army.step(dt); t += dt; if (each && each(t) === false) break; } return t; },
  };
}
async function settle() { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); }

/* ---------------------------------------------------------------- scenarios */
const scen = [];
function scenario(n, name, fn) { scen.push({ n, name, fn }); }
// two streets of buildings between the forces' start lines
const BLOCKS = [[-30, 30, -10, 70, 18], [10, 30, 30, 70, 24], [-30, -70, -10, -30, 15], [10, -70, 30, -30, 30]];

scenario(1, "two forces meet on city streets and fight it out through the city host", async () => {
  const W = boot({ blocks: BLOCKS });
  const A = W.CBZ.army;
  const a = A.spawnForce({ side: "republic", units: ["men*20"], training: "elite", gun: "carbine", at: { x: 0, z: -140 }, face: { x: 0, z: 140 },
    order: { type: "attack", at: { x: 0, z: 140 } } });
  const b = A.spawnForce({ side: "kesh", units: ["men*20"], training: "elite", gun: "ak47", at: { x: 0, z: 140 }, face: { x: 0, z: -140 },
    order: { type: "attack", at: { x: 0, z: -140 } } });
  await a.promise; await b.promise;
  check(A.ready && a.ready && b.ready, "the war engine compiled its realm and both forces stood up (" + JSON.stringify(A.audit().sides) + ")");
  const au = A.audit();
  check(au.rows >= 40, "every man is a row in the unit store (" + au.rows + " rows)");
  let contactT = -1;
  A.on((e) => { if (e.type === "contact" && contactT < 0) contactT = W.sb.CBZ.army.realm.simT; });
  W.step(240, () => { const sa = A.status(a), sb2 = A.status(b); return sa.alive > 0 && sb2.alive > 0; });
  const sa = A.status(a), sbb = A.status(b), aud = A.audit();
  check(contactT > 0, "they found each other in the streets (contact at " + Math.round(contactT) + " s)");
  check(sa.dead + sbb.dead > 5, "men died on both sides of the fight (" + sa.dead + " / " + sbb.dead + ")");
  check(sa.alive === 0 || sbb.alive === 0 || aud.simT >= 239, "it was fought to a finish (" + sa.alive + " v " + sbb.alive + ", " + aud.simT + " s)");
  const arms = aud.arms;
  check(arms && arms.rounds > 50, "the rounds were the sim's own flown rounds (" + (arms ? arms.rounds : 0) + " rounds, " + (arms ? arms.hits : 0) + " hits)");
  check(aud.mass && aud.mass.on, "the tiers ran (" + JSON.stringify(aud.mass.tiers) + ", promoted " + aud.mass.stats.promoted + ")");
});

scenario(2, "orders: hold, move, attack", async () => {
  const W = boot({ blocks: [] });
  const A = W.CBZ.army;
  const f = A.spawnForce({ side: "republic", units: ["men*10"], at: { x: 0, z: 0 }, heading: 0 });
  await f.promise;
  W.step(10);
  let s = A.status(f);
  check(s.order === "hold" && Math.hypot(s.x, s.z - (-4.5)) < 12, "a force with no order holds where it stood (" + Math.round(s.x) + ", " + Math.round(s.z) + ")");
  A.orderForce(f, { type: "move", at: { x: 120, z: 60 } });
  let arrived = false;
  A.on((e) => { if (e.type === "arrived" && e.force === f.id) arrived = true; });
  W.step(90, () => !arrived);
  s = A.status(f);
  check(arrived && Math.hypot(s.x - 120, s.z - 60) < 25, "MOVE took it there (" + Math.round(s.x) + ", " + Math.round(s.z) + ", arrived " + arrived + ")");
  // a far force moves as rows (the lens is far away)
  W.CBZ.camera.position.set(5000, 30, 5000);
  const g = A.spawnForce({ side: "republic", units: ["men*30"], at: { x: -300, z: 0 }, heading: 0 });
  await g.promise;
  A.orderForce(g, { type: "attack", at: { x: -300, z: 400 } });
  W.step(40);
  const sg = A.status(g), au = A.audit();
  // (a route march with kit is ~1.75 m/s, the squads forming their wedges first: 40 s is ~50 m,
  //  not the old tier's 4.6 m/s run)
  check(sg.z > 40, "ATTACK marches on its objective, far from the lens (centre z " + Math.round(sg.z) + ")");
  check(au.mass.tiers.far + au.mass.tiers.mid >= 30, "far from the lens it is fought by the tier sim, not rigs (" + JSON.stringify(au.mass.tiers) + ")");
});

scenario(3, "the player: shot at by a hostile side, his rounds and blasts land", async () => {
  const W = boot({ blocks: [] });
  const A = W.CBZ.army;
  W.P.pos.set(0, W.CBZ.floorAt(0, 60), 60);
  W.CBZ.camera.position.set(0, 20, 50);
  const f = A.spawnForce({ side: "junta", units: ["men*10"], training: "elite", hostile: "wanted", stars: 2, at: { x: 0, z: 0 }, face: { x: 0, z: 60 } });
  await f.promise;
  W.step(15);
  check(W.hurt.n === 0, "a side hostile only to the wanted leaves a clean man alone (" + W.hurt.n + " hits)");
  W.setStars(3);
  W.step(25, () => W.hurt.n === 0);
  check(W.hurt.n > 0, "at three stars they shoot him, and the rounds land through cityHurtPlayer (" + W.hurt.n + " hits, " + Math.round(W.hurt.dmg) + " damage)");
  W.setStars(0); W.P.hp = 200; W.P.dead = false;
  const L = W.CBZ.cityArmy;
  check(Array.isArray(L) && L.length > 0, "the soldiers near the lens are on CBZ.cityArmy for the city's guns (" + (L ? L.length : 0) + ")");
  const man = L && L[0];
  const hp0 = man ? man.hp : 0;
  if (man) A.shot(man, 60, { head: false }, { key: "carbine" });
  check(man && man.hp < hp0, "his round lands through the sim's hurtMan (" + hp0 + " -> " + (man ? Math.round(man.hp) : "-") + ")");
  const st0 = A.status(f).alive;
  W.CBZ.cityExplosion(man.pos.x, man.pos.z, { power: 2, radius: 6, byPlayer: true });
  W.step(1);
  check(A.status(f).alive < st0, "a city blast reaches the soldiers (" + st0 + " -> " + A.status(f).alive + ")");
  // the men he blew up broke and ran (their squad lost a third at once); a
  // fresh force of the same side comes in: the side is his enemy now
  W.P.hp = 200; W.P.dead = false; W.hurt.n = 0;
  const g = A.spawnForce({ side: "junta", units: ["men*10"], training: "elite", at: { x: 60, z: 60 }, face: { x: 0, z: 60 } });
  await g.promise;
  W.step(20, () => W.hurt.n === 0);
  if (process.env.ARMY_DEBUG) console.log("    dbg", JSON.stringify(A.status(g)), JSON.stringify(A.realm.sides.red), A.realm.simT, W.P.dead, JSON.stringify(A.realm.units(g.rf).map((u) => [u.routed, u.tgt ? u.tgt.id : null, u.slot, Math.round(u.pos.x), Math.round(u.pos.z)])));
  check(W.hurt.n > 0, "and the side he blew up is his enemy now, stars or not (" + W.hurt.n + " hits from a fresh force of it)");
});

scenario(4, "armour in the city: an M1 Abrams with its riflemen", async () => {
  const W = boot({ blocks: BLOCKS });
  const A = W.CBZ.army;
  const a = A.spawnForce({ side: "republic", units: ["m1_abrams*1", "men*12"], at: { x: 0, z: -150 }, order: { type: "attack", at: { x: 0, z: 150 } } });
  const b = A.spawnForce({ side: "kesh", units: ["men*25"], training: "pro", gun: "ak47", at: { x: 0, z: 150 }, order: { type: "hold", at: { x: 0, z: 150 } } });
  await a.promise; await b.promise;
  const hull = A.realm.units(a.rf).find((u) => u.vehicle);
  check(!!hull && hull.unitId === "m1_abrams", "the Abrams is the unit file's hull (" + (hull ? hull.unitId + (hull.group.userData.standIn ? ", STAND-IN" : "") : "none") + ")");
  const crew = hull ? hull.seats.filter((s) => s.crew && s.man).length : 0;
  check(crew === 4, "its crew are the force's own men in their seats (" + crew + " of 4)");
  W.step(200, () => A.status(b).alive > 0);
  const sb2 = A.status(b);
  check(sb2.dead > 10, "the hull and its infantry took the position (" + sb2.dead + " dead, " + sb2.alive + " left)");
  check(hull && !hull.dead, "the tank came through rifle fire");
});

scenario(5, "the route seam: a driver owns a route order; without one the force walks it", async () => {
  const W = boot({ blocks: [] });
  const A = W.CBZ.army;
  const f = A.spawnForce({ side: "republic", units: ["men*10"], at: { x: 0, z: 0 } });
  await f.promise;
  let done = false;
  A.on((e) => { if (e.type === "route-done" && e.force === f.id) done = true; });
  A.orderForce(f, { type: "route", route: [{ x: 40, z: 0 }, { x: 40, z: 60 }] });
  W.step(120, () => !done);
  const s = A.status(f);
  check(done && Math.hypot(s.x - 40, s.z - 60) < 25, "with no driver the force walks the route and reports route-done (" + Math.round(s.x) + ", " + Math.round(s.z) + ")");
  let steps = 0, apiOk = false;
  A.routeDriver((force, order, api) => {
    apiOk = typeof api.move === "function" && typeof api.vehicles === "function" && !!api.status();
    api.move(order.route[0]);
    return { step: () => { steps++; if (steps === 40) api.done(); }, stop: () => {} };
  });
  done = false;
  A.orderForce(f, { type: "route", route: [{ x: 0, z: 0 }] });
  W.step(4);
  check(apiOk && steps >= 40 && done, "a registered driver gets the order and the api, steps every frame, ends it (" + steps + " steps)");
});

scenario(6, "disband: a force leaves the map", async () => {
  const W = boot({ blocks: [] });
  const A = W.CBZ.army;
  const f = A.spawnForce({ side: "republic", units: ["men*20"], at: { x: 0, z: 0 } });
  await f.promise;
  W.step(3);
  const r0 = A.audit().mass.rows;
  A.disband(f);
  W.step(1);
  const au = A.audit();
  check(au.forces.length === 0 && au.men === 0, "no force and no FULL body left (" + au.forces.length + " forces, " + au.men + " men)");
  const f2 = A.spawnForce({ side: "kesh", units: ["men*20"], at: { x: 50, z: 0 } });
  await f2.promise;
  check(A.audit().rows <= r0 + 20 && A.status(f2).alive === 20, "its rows were freed and taken by the next force (" + A.audit().rows + " rows)");
});

for (const s of scen) {
  if (only && s.n !== only) continue;
  console.log(s.n + "  " + s.name);
  try { await s.fn(); await settle(); }
  catch (e) { fails++; console.log("  FAIL threw: " + (e.stack || e).toString().split("\n").slice(0, 6).join("\n    ")); }
}
console.log("\n" + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);

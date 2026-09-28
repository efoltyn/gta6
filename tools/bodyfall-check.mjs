#!/usr/bin/env node
/* tools/bodyfall-check.mjs — DOES A SHOT MAN FALL LIKE A BODY, OR PIVOT ON A FOOT?

   The REAL rig (entities/character.js), the REAL keyed collapse
   (entities/meleeposes.js), grapple.js's body physics and systems/bodyfall.js,
   run frame by frame at 60 fps in plain node (tools/lib/verbs-vm.mjs). A man
   facing +z is killed by a round from each side, the way the city's cheap
   path and survival kill him (CBZ.body.hit with a knockdown), and we measure
   the live rig:

     1. ROOT follows the round: the group's ground travel . bullet dir > 0
     2. NO SPIN: the group's yaw never strays more than 30 degrees
     3. THE CENTRE OF MASS FALLS: the hips' world height never rises by more
        than 2 cm on the way down (legs give, no pop-up, no plank lever)
     4. RESTS ON THE FLOOR: lowest vertex of the body within [-6 cm, +8 cm]
        of the floor, hips low (a lying body, not a standing one)
     5. NO WALL: a wall 0.7 m behind him along the round; no vertex of the
        body ends inside it
     6. STAYS PUT: settled (asleep) inside 3 s, and not one vertex moves in
        the next second

   Plus: a runner shot from the front falls FORWARD along his run; a body on a
   15 degree slope lies along it; a living man knocked down gets up and ends
   upright with the rig's fall finished.

     node tools/bodyfall-check.mjs          exit 0 = ok */
import { loadVerbsVM } from "./lib/verbs-vm.mjs";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const DT = 1 / 60;
let fails = 0;
const rows = [];
const v = loadVerbsVM({ mode: "survival" });
const { CBZ, THREE } = v;
if (!CBZ.bodyFall) { console.log("FAIL: systems/bodyfall.js did not load"); process.exit(1); }

const _v = new THREE.Vector3();
function vertices(g, fn) {
  g.updateMatrixWorld(true);
  g.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !o.geometry || !o.geometry.attributes.position) return;
    for (let p = o; p; p = p.parent) if (p.visible === false) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { _v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); fn(_v, o); }
  });
}
function lowest(g, floor) {
  let m = Infinity;
  vertices(g, (p) => { const d = p.y - (floor ? floor(p.x, p.z) : 0); if (d < m) m = d; });
  return m;
}
function snapshot(g) { const a = []; vertices(g, (p) => a.push(p.x, p.y, p.z)); return a; }
function hips(ch) {
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  ch.group.updateMatrixWorld(true);
  ch.parts.ll.getWorldPosition(a); ch.parts.rl.getWorldPosition(b);
  return a.add(b).multiplyScalar(0.5);
}
// the body's centre of mass, near enough: hips, knees, chest (neck base), head
function com(ch) {
  const P = [[ch.parts.ll, 0.2], [ch.parts.rl, 0.2], [ch.low.ll, 0.06], [ch.low.rl, 0.06], [ch.neck, 0.4], [ch.head, 0.08]];
  ch.group.updateMatrixWorld(true);
  let y = 0;
  const t = new THREE.Vector3();
  for (const [o, w] of P) { o.getWorldPosition(t); y += t.y * w; }
  return y;
}
function wrap(x) { x = (x + Math.PI) % (Math.PI * 2); if (x < 0) x += Math.PI * 2; return x - Math.PI; }
function check(name, ok, detail) { rows.push({ name, ok, detail }); if (!ok) fails++; }

function scene(o) {
  v.clearActors();
  v.world({ floor: o.floor || (() => 0), colliders: o.colliders || [] });
  const a = v.actor({ build: o.build || "m", x: 0, z: 0, yaw: 0, bot: true, name: o.name });
  a.group.position.y = o.floor ? o.floor(0, 0) : 0;
  for (let i = 0; i < 8; i++) v.frame(DT);
  return a;
}

/* ---- 1..6: a kill from each side ---- */
const SIDES = [
  ["front", 0, -1],   // shooter ahead of him, the round travels -z
  ["back", 0, 1],
  ["left", -1, 0],    // shooter on his right (+x), round travels -x
  ["right", 1, 0],
  ["diag", 0.7071, -0.7071],
];
for (const [side, bx, bz] of SIDES) {
  for (const [force, walled] of [[6, false], [16, false], [6, true], [16, true]]) {
    const wall = { minX: -9, maxX: 9, minZ: -9, maxZ: 9, y0: 0, y1: 3 };
    // a slab 0.7 m behind him along the round, 0.4 m thick, 4 m wide across it
    const cx = bx * 1.1, cz = bz * 1.1;
    if (Math.abs(bx) > Math.abs(bz)) { wall.minX = cx - 0.2; wall.maxX = cx + 0.2; wall.minZ = -2; wall.maxZ = 2; }
    else { wall.minZ = cz - 0.2; wall.maxZ = cz + 0.2; wall.minX = -2; wall.maxX = 2; }
    const a = scene({ name: side, colliders: walled ? [wall] : [] });
    const ch = a.char, g = a.group;
    const x0 = g.position.x, z0 = g.position.z, yaw0 = g.rotation.y;
    let comPrev = com(ch), rise = 0, yawMax = 0;
    a.dead = true;
    CBZ.body.hit(a, { dir: { x: bx, z: bz }, force, knockdown: 9999 });
    let sleptAt = -1;
    for (let i = 0; i < 180; i++) {
      v.frame(DT);
      const h = com(ch);
      if (h - comPrev > rise) rise = h - comPrev;
      if (h < comPrev) comPrev = h;
      yawMax = Math.max(yawMax, Math.abs(wrap(g.rotation.y - yaw0)));
      if (sleptAt < 0 && CBZ.bodyFall.asleep(a)) sleptAt = i * DT;
    }
    const tx = g.position.x - x0, tz = g.position.z - z0;
    const along = tx * bx + tz * bz;
    const low = lowest(g);
    const hy = hips(ch).y;
    let inWall = 0; const hitNames = new Set();
    vertices(g, (p, o) => {
      if (p.y < wall.y1 && p.x > wall.minX + 0.02 && p.x < wall.maxX - 0.02 && p.z > wall.minZ + 0.02 && p.z < wall.maxZ - 0.02) { inWall++; const dp = Math.min(p.x - wall.minX, wall.maxX - p.x, p.z - wall.minZ, wall.maxZ - p.z); let nm = ""; for (let q = o; q && !nm; q = q.parent) nm = q.name || ""; hitNames.add(nm + " " + (dp * 100).toFixed(1) + "cm"); }
    });
    const s0 = snapshot(g);
    for (let i = 0; i < 60; i++) v.frame(DT);
    const s1 = snapshot(g);
    let drift = 0;
    for (let i = 0; i < s0.length; i++) drift = Math.max(drift, Math.abs(s1[i] - s0[i]));
    const tag = `${side} f${force}${walled ? " wall" : ""}`;
    if (!walled) check(`${tag}: root follows the round`, along > 0.02, `travel ${along.toFixed(2)} m along the round (${tx.toFixed(2)}, ${tz.toFixed(2)})`);
    check(`${tag}: no spin`, yawMax <= 0.5236 + 1e-3, `max yaw change ${(yawMax * 57.3).toFixed(1)} deg`);
    check(`${tag}: centre of mass falls`, rise <= 0.02, `worst COM rise ${(rise * 100).toFixed(1)} cm; hips end at ${hy.toFixed(2)} m`);
    check(`${tag}: rests on the floor`, low >= -0.06 && low <= 0.08 && hy < 0.4, `lowest vertex ${(low * 100).toFixed(1)} cm, hips ${hy.toFixed(2)} m`);
    if (walled) check(`${tag}: not in the wall behind`, inWall === 0, `${inWall} vertices inside ${[...hitNames].slice(0, 4).join(", ")}`);
    check(`${tag}: settles and stays put`, sleptAt >= 0 && drift < 1e-4, `asleep at ${sleptAt.toFixed(2)} s, then moved ${(drift * 1000).toFixed(2)} mm`);
    if (!CBZ.bodyFall.active(a)) check(`${tag}: bodyfall owns the corpse`, false, "not active");
  }
}

/* ---- a runner shot from the front falls forward along his run ---- */
{
  const a = scene({ name: "runner" });
  const g = a.group, ch = a.char;
  a._mv = { vx: 0, vz: 5.2 };                 // running +z (CBZ.moves' motor record)
  const z0 = g.position.z;
  a.dead = true;
  CBZ.body.hit(a, { dir: { x: 0, z: -1 }, force: 6, knockdown: 9999 });
  for (let i = 0; i < 150; i++) v.frame(DT);
  const dz = g.position.z - z0;
  check("runner: falls forward along the run", ch.fall && ch.fall.variant === "face" && dz > 0.8, `variant ${ch.fall && ch.fall.variant}, carried ${dz.toFixed(2)} m forward`);
}

/* ---- a slope: the body lies along it, on it ---- */
{
  const slope = (x, z) => 0.27 * z;           // ~15 degrees rising toward +z
  const a = scene({ name: "slope", floor: slope });
  const g = a.group;
  a.dead = true;
  CBZ.body.hit(a, { dir: { x: 0, z: -1 }, force: 6, knockdown: 9999 });   // falls back, head downhill
  for (let i = 0; i < 180; i++) v.frame(DT);
  const low = lowest(g, slope);
  check("slope: tilts to the ground", Math.abs(g.rotation.x) > 0.12, `group pitch ${(g.rotation.x * 57.3).toFixed(1)} deg`);
  check("slope: rests on it", low >= -0.08 && low <= 0.1, `lowest vertex ${(low * 100).toFixed(1)} cm off the slope`);
}

/* ---- a living man knocked down gets up ---- */
{
  const a = scene({ name: "living" });
  const g = a.group, ch = a.char;
  CBZ.body.knockdown(a, { dir: { x: 0, z: -1 }, force: 6, t: 1.2 });
  let lowHip = 9;
  for (let i = 0; i < 60 * 6; i++) { v.frame(DT); lowHip = Math.min(lowHip, hips(ch).y); }
  const up = !(ch.fall && ch.fall.on) && !CBZ.body.busy(a) && Math.abs(g.rotation.x) < 1e-3 && Math.abs(g.rotation.z) < 1e-3;
  check("living: goes down and gets up", lowHip < 0.35 && up && hips(ch).y > 0.55, `lowest hips ${lowHip.toFixed(2)} m, now ${hips(ch).y.toFixed(2)} m, fall ${ch.fall && ch.fall.on}, busy ${CBZ.body.busy(a)}`);
}

/* ---- THE CITY VERLET BODY (city/ragdoll.js): what a blast or a car throws.
   A body launched off its feet (m >= 14); a real blast (m >= 20) lifts it, so
   only the landing questions apply there. The spin is the hip line heading. ---- */


{
  CBZ.CONFIG.RAGDOLL_ANY_MODE = true;
  vm.runInContext(readFileSync(new URL("../src/city/ragdoll.js", import.meta.url), "utf8"), v.ctx, { filename: "src/city/ragdoll.js" });
  v.updaters.sort((x, y) => x.order - y.order);
  const world3 = new THREE.Scene();
  const hipHeading = (ch) => {
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    ch.group.updateMatrixWorld(true);
    ch.parts.ll.getWorldPosition(a); ch.parts.rl.getWorldPosition(b);
    return Math.atan2(b.x - a.x, b.z - a.z);
  };
  for (const [side, bx, bz] of SIDES) {
    for (const [mag, walled, head] of [[14, false, false], [18, false, false], [24, false, false], [16, true, false]]) {
      const wall = { minX: -9, maxX: 9, minZ: -9, maxZ: 9, y0: 0, y1: 3 };
      const cx = bx * 1.1, cz = bz * 1.1;
      if (Math.abs(bx) > Math.abs(bz)) { wall.minX = cx - 0.2; wall.maxX = cx + 0.2; wall.minZ = -2; wall.maxZ = 2; }
      else { wall.minZ = cz - 0.2; wall.maxZ = cz + 0.2; wall.minX = -2; wall.maxX = 2; }
      const a = scene({ name: "rag-" + side, colliders: walled ? [wall] : [] });
      world3.add(a.group);                     // ragdoll.js releases a body whose group left the scene
      const ch = a.char, g = a.group;
      const h0 = hips(ch), hd0 = hipHeading(ch);
      let comPrev = com(ch), rise = 0, spin = 0;
      a.dead = true;
      const point = { x: -bx * 0.12, y: head ? 1.62 : 1.05, z: -bz * 0.12 };
      const ok = CBZ.cityRagdoll(a, point, { x: bx, y: 0, z: bz }, mag);
      if (!ok) { check(`ragdoll ${side}: started`, false, "cityRagdoll refused"); continue; }
      let slept = -1;
      for (let i = 0; i < 60 * 4; i++) {
        v.frame(DT);
        const h = com(ch);
        if (h - comPrev > rise) rise = h - comPrev;
        if (h < comPrev) comPrev = h;
        spin = Math.max(spin, Math.abs(wrap(hipHeading(ch) - hd0)));
        if (slept < 0 && CBZ.ragdollAudit().frozen > 0) slept = i * DT;
      }
      const h1 = hips(ch);
      const along = (h1.x - h0.x) * bx + (h1.z - h0.z) * bz;
      const low = lowest(g);
      let inWall = 0;
      let deep = 0;
      vertices(g, (p) => { if (p.y < wall.y1 && p.x > wall.minX + 0.02 && p.x < wall.maxX - 0.02 && p.z > wall.minZ + 0.02 && p.z < wall.maxZ - 0.02) { inWall++; deep = Math.max(deep, Math.min(p.x - wall.minX, wall.maxX - p.x, p.z - wall.minZ, wall.maxZ - p.z)); } });
      const s0 = snapshot(g);
      for (let i = 0; i < 60; i++) v.frame(DT);
      const s1 = snapshot(g);
      let drift = 0;
      for (let i = 0; i < s0.length; i++) drift = Math.max(drift, Math.abs(s1[i] - s0[i]));
      const tag = `ragdoll ${side} m${mag}${head ? " head" : ""}${walled ? " wall" : ""}`;
      if (!walled) check(`${tag}: hips follow the round`, along > 0.05, `hips travel ${along.toFixed(2)} m along the round`);
      if (mag < 20) check(`${tag}: no spin`, spin <= 0.5236, `hip line turned ${(spin * 57.3).toFixed(1)} deg`);
      // (no centre-of-mass question: a launch lifts the body, that is what it is)
      void rise;
      check(`${tag}: rests on the floor`, low >= -0.06 && low <= 0.12 && h1.y < 0.45, `lowest vertex ${(low * 100).toFixed(1)} cm, hips ${h1.y.toFixed(2)} m`);
      if (walled) check(`${tag}: not in the wall`, inWall === 0, `${inWall} vertices inside, deepest ${(deep * 100).toFixed(1)} cm`);
      check(`${tag}: settles and stays put`, slept >= 0 && drift < 1e-4, `frozen at ${slept.toFixed(2)} s, then moved ${(drift * 1000).toFixed(2)} mm`);
      if (CBZ.ragdollDrop) CBZ.ragdollDrop(a);
    }
  }
}

/* ---- BODY PERSISTS (owner: "when you shoot someone, they just DISAPPEAR").
   Each game's death path, as the game drives it, and then 3 minutes of sim:
   the body must still be in the scene, drawn, lying where it fell, frozen.
   Then the corpse law: never removed on screen or within 60 m, oldest first
   past the cap once hidden. ---- */
{
  const world3 = new THREE.Scene();
  const SIM = 60 * 180;                         // three minutes at 60 fps (bodies sleep, so it is cheap)
  function persists(tag, a, driver) {
    const x0 = a.group.position.x, z0 = a.group.position.z;
    for (let i = 0; i < 90; i++) { v.frame(DT); if (driver) driver(DT); }
    const lieX = a.group.position.x, lieZ = a.group.position.z, hy0 = hips(a.char).y;
    for (let i = 0; i < SIM; i++) { CBZ.now += DT * 1000; if (driver) driver(DT); if (i % 60 === 0) v.frame(DT); }
    const moved = Math.hypot(a.group.position.x - lieX, a.group.position.z - lieZ);
    const ok = !!a.group.parent && a.group.visible !== false && !a.culled && hips(a.char).y < 0.4 && moved < 0.01;
    check(`persists: ${tag}`, ok, `in scene ${!!a.group.parent}, visible ${a.group.visible !== false}, hips ${hips(a.char).y.toFixed(2)} m (at fall ${hy0.toFixed(2)}), moved ${(moved * 100).toFixed(1)} cm after 3 min, fell ${Math.hypot(lieX - x0, lieZ - z0).toFixed(2)} m from where he stood`);
  }
  const mk = (name, x) => { const a = scene({ name }); a.group.position.x = x; world3.add(a.group); return a; };

  // city ped and a crowd-pool ped: cityKillPed's cheap path is a knockdown into the collapse
  CBZ.game.mode = "city";
  CBZ.cityPeds = [];
  {
    const a = mk("city ped", 0); CBZ.cityPeds.push(a); CBZ.bots.length = 0;
    a.dead = true; CBZ.body.knockdown(a, { dir: { x: 0, z: -1 }, force: 7, t: 9999 });
    persists("city ped (shot)", a);
  }
  {
    const a = mk("crowd ped", 0); a._crowd = true; CBZ.cityPeds.length = 0; CBZ.cityPeds.push(a); CBZ.bots.length = 0;
    a.dead = true; CBZ.body.knockdown(a, { dir: { x: 1, z: 0 }, force: 7, t: 9999 });
    persists("crowd-pool ped (shot)", a);
  }
  {
    // a bare `dead = true` (a bleed-out, a fire): nobody told the body; grapple's ensureFall does
    const a = mk("bled out", 0); CBZ.cityPeds.length = 0; CBZ.cityPeds.push(a); CBZ.bots.length = 0;
    a.dead = true;
    persists("city ped (bare dead flag, no fall called)", a);
  }
  CBZ.cityPeds.length = 0;
  CBZ.game.mode = "survival";

  // disaster survivor: a bot that dies without a hit (drowned fields aside)
  {
    const a = mk("survivor", 0);
    a.dead = true;
    persists("disaster survivor (bare dead flag)", a);
  }

  // prison inmate and a guard: ai.js kill() -> prisoncorpse.place, the movers tick it
  vm.runInContext(readFileSync(new URL("../src/systems/prisoncorpse.js", import.meta.url), "utf8"), v.ctx, { filename: "src/systems/prisoncorpse.js" });
  for (const who of ["prison inmate", "prison guard"]) {
    v.clearActors();
    const a = v.actor({ build: "m", x: 0, z: 0, yaw: 0, name: who });   // not a bot: the prison movers own it
    world3.add(a.group);
    for (let i = 0; i < 8; i++) v.frame(DT);
    a.dead = true;
    CBZ.prisonCorpsePlace(a, { group: { position: { x: 0, z: 3 } } }, { force: 7 });
    persists(who, a, (dt) => CBZ.prisonCorpseTick(a, dt));
  }

  // gun-game bot: on respawn the dead rig is handed to the corpse keeper and he
  // comes back in a fresh body (modes/gungame.js freshBody)
  {
    v.clearActors();
    const b = v.actor({ build: "m", x: 0, z: 0, yaw: 0, bot: true, name: "gg bot" });
    world3.add(b.group);
    for (let i = 0; i < 8; i++) v.frame(DT);
    b.dead = true; CBZ.body.knockdown(b, { fromX: 0, fromZ: 3, force: 7, t: 9999 });
    for (let i = 0; i < 60 * 3; i++) v.frame(DT);                  // the 3 s respawn timer
    const rec = CBZ.corpses.keep(b, { tag: "gungame" });
    CBZ.bots.length = 0;                                            // the live bot is a new rig now
    const lie = { x: rec.group.position.x, z: rec.group.position.z };
    for (let i = 0; i < 60 * 180; i++) { CBZ.now += DT * 1000; if (i % 30 === 0) v.frame(DT * 30); }
    const moved = Math.hypot(rec.group.position.x - lie.x, rec.group.position.z - lie.z);
    check("persists: gun-game bot (body kept through the respawn)", CBZ.corpses.list.indexOf(rec) >= 0 && !!rec.group.parent && moved < 0.01 && hips(rec.char).y < 0.4,
      `kept ${CBZ.corpses.list.indexOf(rec) >= 0}, in scene ${!!rec.group.parent}, hips ${hips(rec.char).y.toFixed(2)} m, moved ${(moved * 100).toFixed(1)} cm`);
    CBZ.corpses.clear("gungame");
  }

  // THE LAW: 60 bodies at the player's feet stay (over the cap but near and on screen);
  // once the player is 200 m away and looking elsewhere, the oldest go down to the cap.
  {
    v.clearActors();
    CBZ.player.pos.set(0, 0, 0);
    CBZ.camera.position.set(0, 3, -8); CBZ.camera.lookAt(0, 0, 0); CBZ.camera.updateMatrixWorld();
    for (let i = 0; i < 60; i++) {
      const a = v.actor({ build: "m", x: (i % 10) * 1.5 - 7, z: Math.floor(i / 10) * 2, yaw: 0, name: "c" + i });
      world3.add(a.group); a.dead = true;
      CBZ.corpses.keep(a, { tag: "law" });
    }
    for (let i = 0; i < 240; i++) v.frame(DT);
    const nearKept = CBZ.corpses.list.length;
    CBZ.player.pos.set(400, 0, 400); CBZ.camera.position.set(400, 3, 392); CBZ.camera.lookAt(400, 0, 400); CBZ.camera.updateMatrixWorld();
    for (let i = 0; i < 240; i++) v.frame(DT);
    const farKept = CBZ.corpses.list.length;
    check("law: none removed near the player / on screen, even over the cap", nearKept === 60, `${nearKept} of 60 kept`);
    check("law: hidden and far, trimmed to the cap oldest first", farKept === CBZ.corpseLaw.LAW.CAP, `${farKept} kept (cap ${CBZ.corpseLaw.LAW.CAP})`);
    CBZ.corpses.clear("law");
    CBZ.player.pos.set(0, 0, -30); CBZ.camera.position.set(0, 3, -8);
  }
}

/* ---- the plan: pure ---- */
{
  const P = CBZ.bodyFall.plan;
  const f = P(0, 0, -1), b = P(0, 0, 1), l = P(0, -1, 0.001), d = P(0, 0.7, -0.7);
  check("plan: pushed back -> on his back", f.variant === "back" && Math.abs(f.drift) < 1e-6, JSON.stringify(f));
  check("plan: pushed forward -> on his face", b.variant === "face" && Math.abs(b.drift) < 1e-6, JSON.stringify(b));
  check("plan: side push drifts at most 29 deg", Math.abs(l.drift) <= CBZ.bodyFall.FALL_DRIFT + 1e-9, JSON.stringify(l));
  check("plan: 45 deg push lands within 20 deg of it", d.err < 0.35, JSON.stringify(d));
}

for (const r of rows) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}  ${r.detail}`);
if (v.errors.length) { console.log("runtime errors:"); for (const e of v.errors.slice(0, 5)) console.log("  " + e); fails++; }
console.log(fails ? `\n${fails} FAILED` : `\nall ${rows.length} ok`);
process.exit(fails ? 1 : 0);

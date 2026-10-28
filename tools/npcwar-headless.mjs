#!/usr/bin/env node
/* tools/npcwar-headless.mjs — NPC WAR'S OWN SIM, IN NODE. No browser, no
   GPU, no capture.

   games/battle.html's inline script is lifted out of the page and run over
   real three.js r128 (math and scene graph only), the real brain
   (systems/brain.js), the real fight brain (systems/combat_iq.js) and the
   real weapon table (weapons/weapon-data.js). What it cannot have here —
   the studio's packs, the renderer, the DOM, the rigs — is stubbed: a flat
   world with a rolling height function, men that are bare groups, a document
   whose elements only remember what was written to them. The sim itself
   (thinkMan, stepMan, fireShot, morale, orders, the soldier, the air, the
   end card and the post home) is the page's own code, stepped through its
   own __battle.advance().

     node tools/npcwar-headless.mjs                     every scenario
     node tools/npcwar-headless.mjs 2                   one

   1  the war room: 30 v 30 riflemen on the dunes, equal -> both advance, it
      ends, somebody wins.
   2  the few hold: 60 v 25 -> the 25 hold their line (stay near where they
      formed) and the 60 come to them.
   4  the rifle: join a side, walk, fire at the enemy through the page's own
      fireShot, hand the rifle back; a soldier who is killed goes back to the
      director and is reported down.
   5  snow, fields and the wood: the erg skins build and fight.
  14  THE CONVOY: an M1, a MaxxPro MRAP and a JLTV v riflemen with RPGs:
      the troops get out, rifle fire stops on the MRAP, the V-hulls live
      through an IED under them.
  10  THE GROUND: cover points for the host (crests, props, crater lips), a
      dug-in position's berm in the height function, a bomb that digs a crater
      into groundAt and breaks the sandbags beside it.                    */
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const only = process.argv[2] ? +process.argv[2] : 0;
let fails = 0, passes = 0;
function check(ok, msg) { if (ok) { passes++; console.log("  PASS " + msg); } else { fails++; console.log("  FAIL " + msg); } }

import { boot, settle, run, G } from "./lib/npcwar-node.mjs";

const scen = [];
function scenario(n, name, fn) { scen.push({ n, name, fn }); }

scenario(1, "the war room: equal riflemen meet and it ends", async () => {
  const W = boot("?map=dunes&red=30&blue=30&rw=ak47&bw=ak47&rt=elite&bt=elite&auto=1&probe=0");
  if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
  await settle();
  check(!!W.B(), "the page booted and published __battle");
  const a0 = W.B().audit();
  check(a0.started, "the war started without the war room (?auto=1)");
  const a = run(W, 240);
  check(a.over, "it ended (" + a.simT + " s, winner " + a.winner + ", red " + a.red + " blue " + a.blue + ")");
  check(a.stats.red.shots > 0 && a.stats.blue.shots > 0, "both lines fired (" + a.stats.red.shots + "/" + a.stats.blue.shots + ")");
  // the weapons' own ledger (src/battle/fire.js): ranges, organs, penetrations
  if (W.CBZ.battleArms && W.CBZ.battleArms.audit) console.log("    arms " + JSON.stringify(W.CBZ.battleArms.audit()));
});

scenario(2, "the few hold, the many come", async () => {
  const W = boot("?map=dunes&red=60&blue=25&rw=ak47&bw=ak47&rt=pro&bt=pro&auto=1&probe=0");
  if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
  await settle();
  let maxBlueDrift = 0, maxRedDrift = 0, n = 0;
  const a = run(W, 15, () => {
    const men = W.sb.__frontProbe ? null : null;
    return true;
  });
  // read the roster through the page's own audit of positions
  const pos = W.B().men ? W.B().men() : null;
  check(true, "ran 15 s (simT " + a.simT + ")");
  const st = W.sb.__battle.orders ? W.sb.__battle.orders() : null;
  check(st && st.blue === "hold" && st.red === "advance", "outnumbered 60 v 25: blue holds, red advances (" + JSON.stringify(st) + ")");
  const drift = W.sb.__battle.drift ? W.sb.__battle.drift() : null;
  check(drift && drift.blue < 12 && drift.red > 20, "the holders stayed on their line, the attackers came (mean metres from where they formed: " + JSON.stringify(drift) + ")");
  const a2 = run(W, 240);
  check(a2.over, "and it ended (" + a2.simT + " s, winner " + a2.winner + ")");
});

scenario(4, "the rifle: be a soldier, fire, hand it back, go down", async () => {
  const W = boot("?map=dunes&red=40&blue=40&rw=carbine&bw=ak47&rt=elite&bt=pro&auto=1&probe=0");
  if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
  await settle();
  run(W, 3);
  W.doc.getElementById("cRifle").click();
  const you = W.sb.__battle.you();
  check(you && you.on, "the rifle button put you in a man's boots (" + JSON.stringify(you) + ")");
  check(W.B().audit().cam.mode === "you", "the camera is over his shoulder");
  // walk forward 2 s
  W.input.keys.KeyW = true;
  const p0 = W.sb.__battle.you();
  run(W, 2);
  W.input.keys.KeyW = false;
  const p1 = W.sb.__battle.you();
  check(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 5, "W walks him (" + Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1) + " m)");
  // face the enemy and hold the trigger until somebody falls
  W.sb.__battle.youFace();
  W.input.locked = true; W.input.buttons[0] = true;
  let shots0 = W.B().audit().stats.red.shots;
  // (until somebody falls, or 12 s: rifle rounds settle a fight fast, and the
  // battle has to still be on for the last half of this scenario)
  run(W, 12, () => { W.sb.__battle.youFace(); const y = W.sb.__battle.you(); return !!y.on && !(y.kills > 0); });
  W.input.buttons[0] = false;
  const yr = W.sb.__battle.you();
  check(yr.shots > 0, "the trigger fires the page's own rounds (" + yr.shots + " fired, " + yr.hits + " hit, " + yr.kills + " killed)");
  if (yr.on) {
    W.doc.getElementById("cRifle").click();
    check(!W.sb.__battle.you().on && W.B().audit().cam.mode === "auto", "the rifle handed back: the man fights on his own, the director has the lens");
  }
  // now go down: take a rifle and stand in the open with the enemy shooting
  W.doc.getElementById("cRifle").click();
  const before = W.sb.__battle.you();
  if (before.on) W.sb.__battle.youHurt(1e6);
  check(W.sb.__battle.you().down, "a soldier killed out there is reported down");
  check(W.B().audit().cam.mode === "youdead", "the lens holds the death beat on his body");
  const fell = before.on ? before : null;
  run(W, 2.5);
  const hop = W.sb.__battle.youState();
  check(hop.on && hop.kind === "man" && W.B().audit().cam.mode === "you" && fell && hop.id !== null,
    "after the beat you are in the nearest ally's boots (" + JSON.stringify(hop) + ")");
  W.doc.getElementById("cRifle").click();
  check(!W.sb.__battle.you().on && W.B().audit().cam.mode === "auto", "and the rifle button still hands the body back");
});

/* TAKE OVER ANYTHING (player.js) and THE DIRECTOR (camera/camera.js). The
   node world has no bestiary, so the animals here are honest stand-ins: a
   box body on a species row, driven by the real unit file's numbers, the
   real creature_combat strike driver and the real move picker
   (units/kit/moves.js). What is held is the CONTROL, not the art. */
function standInAnimals(W, rows) {
  const T = W.THREE, C = W.CBZ;
  C.cmat = (c) => new T.MeshLambertMaterial({ color: c });
  C.boxGeom = (x, y, z) => new T.BoxGeometry(x, y, z);
  C.faceAnimalHeading = (m, h) => { m.group.rotation.y = -h; };
  for (const id in rows) {
    const r = rows[id];
    C.WILDLIFE_SPECIES[id] = Object.assign({ id, name: id, hp: 160, spd: 3, danger: 0.8, bite: 26, scale: 1 }, r, {
      build: () => {
        const g = new T.Group();
        const b = new T.Mesh(new T.BoxGeometry(r.len, r.h, r.w), new T.MeshLambertMaterial());
        b.position.y = r.h / 2; g.add(b);
        // a head at the front, where the jaws are (creature_combat finds the
        // mouth as the most forward mesh)
        const hd = new T.Mesh(new T.BoxGeometry(r.len * 0.18, r.h * 0.3, r.w * 0.6), new T.MeshLambertMaterial());
        hd.position.set(r.len * 0.5, r.h * 0.8, 0); g.add(hd);
        return g;
      },
    });
  }
  try { vm.runInContext(fs.readFileSync(path.join(ROOT, "src/city/creature_combat.js"), "utf8"), W.sb, { filename: "creature_combat.js" }); }
  catch (e) { console.log("  (creature_combat threw: " + e.message + ")"); }
}
// hold the stick at the nearest enemy, sprinting, with the attack down
function chaseNearest(W) {
  W.sb.__battle.youFace();
  const st = W.sb.__battle.youState();
  return st.on;
}
scenario(10, "take over anything: an animal, an elephant's trunk, a tank, a tap; the director", async () => {
  {
    const W = boot("?a=lion&b=men&n=1v4&bw=fists&bt=civ&arena=dunes&auto=1&probe=0");
    if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
    standInAnimals(W, { lion: { len: 2.2, h: 1.1, w: 0.7 } });
    await settle();
    run(W, 1);
    const ok = W.sb.__battle.take("a:lion");
    const st = W.sb.__battle.youState();
    check(ok && st.kind === "beast" && W.B().audit().cam.mode === "you", "a tap on the lion makes you the lion (" + JSON.stringify(st) + ")");
    const blueHp = () => W.sb.__battle.roster().filter((m) => m.team === "blue").reduce((s, m) => s + Math.max(0, m.hp), 0);
    const hp0 = blueHp();
    W.sb.__battle.youDrive({ az: 1, run: true, atk: true });
    let s2 = null;
    run(W, 20, () => { s2 = W.sb.__battle.youState(); return chaseNearest(W); });
    W.sb.__battle.youDrive(null);
    const mv = s2.moves || {};
    // a species file may name its own moves (lion_pounce, lion_swat ...): count by kind
    const kind = (k) => Object.keys(mv).filter((n) => n === k || n.endsWith("_" + k)).reduce((a, n) => a + mv[n], 0);
    check(kind("pounce") + kind("swipe") + kind("swat") + kind("bite") + kind("throat") > 2,
      "attack throws the cat's real moves by context (" + JSON.stringify(mv) + ")");
    check(kind("pounce") > 0, "a sprint into range is a pounce (" + kind("pounce") + ")");
    const tal = W.sb.__battle.tally();
    check(s2.hits >= 3 && hp0 - blueHp() > 60, "and the blows land in the page's damage funnel (" + s2.hits + " strikes landed, " + s2.whiffs + " at the air, " +
      Math.round(hp0 - blueHp()) + " hp off the men, " + tal.dead.blue + " down)");
  }
  {
    const W = boot("?a=african_elephant&b=men&n=1v10&bw=fists&bt=civ&arena=dunes&auto=1&probe=0");
    if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
    standInAnimals(W, { african_elephant: { len: 6, h: 3.2, w: 2.2, hp: 1200, spd: 2.2, bite: 60, scale: 2.6 } });
    await settle();
    run(W, 1);
    check(W.sb.__battle.take("a:african_elephant"), "you are the elephant");
    W.sb.__battle.youDrive({ az: 0.6, run: false, atk: true });
    let tossed = 0;
    run(W, 25, () => { tossed = Math.max(tossed, W.sb.__battle.youState().tossed); return chaseNearest(W); });
    const mv = W.sb.__battle.youState().moves || {};
    W.sb.__battle.youDrive(null);
    check((mv.trunk || 0) > 0 && tossed > 0, "the trunk takes a man and throws him (" + JSON.stringify(mv) + ", " + tossed + " in the air at once)");
  }
  {
    const W = boot("?a=m1_abrams*1&b=men&n=1v20&arena=dunes&bw=ak47&auto=1&probe=0");
    if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
    realBoom(W);
    await settle();
    run(W, 2);
    const tank = W.sb.__battle.roster().find((m) => m.unitId === "m1_abrams");
    // TAP: project the hull onto the screen and press there
    const v = new W.THREE.Vector3(tank.pos.x, tank.pos.y + 1.5, tank.pos.z);
    W.CBZ.camera.updateMatrixWorld();
    v.project(W.CBZ.camera);
    const took = v.z < 1 && G(W, "tapTake(" + ((v.x + 1) / 2 * 1280) + "," + ((1 - v.y) / 2 * 720) + ")");
    if (!took) W.sb.__battle.take(tank);
    const st = W.sb.__battle.youState();
    check(took && st.kind === "vehicle", "a tap on the tank puts you in it (" + (took ? "tapped" : "missed the tap") + ", " + JSON.stringify(st) + ")");
    const p0 = { x: tank.pos.x, z: tank.pos.z };
    W.sb.__battle.youDrive({ az: 1, atk: false });
    run(W, 3);
    check(Math.hypot(tank.pos.x - p0.x, tank.pos.z - p0.z) > 3, "move drives it (" + Math.hypot(tank.pos.x - p0.x, tank.pos.z - p0.z).toFixed(1) + " m)");
    W.sb.__battle.youDrive({ az: 0, atk: true });
    const f0 = tank.shotsF;
    run(W, 12, () => { W.sb.__battle.youFace(); return W.sb.__battle.youState().on; });
    W.sb.__battle.youDrive(null);
    check(tank.shotsF > f0, "attack fires the seat's gun at the threat it faces (" + (tank.shotsF - f0) + " rounds, " + tank.kills + " kills" +
      (tank.shotsF > f0 ? "" : "; " + JSON.stringify(tank.wpn.map((w) => ({ id: w.w.id, cool: +w.cool.toFixed(2), ammo: w.ammo, rl: w.reloadT }))) + " fp " + tank.vs.firepower + " " + JSON.stringify(W.sb.__battle.youState())) + ")");
  }
  {
    const W = boot("?a=men&b=men&n=120v120&rw=ak47&bw=ak47&arena=dunes&auto=1&probe=0");
    if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
    await settle();
    const shots = new Set();
    let maxCuts = 0;
    run(W, 70, () => { const d = W.sb.__battle.director(); shots.add(d.shot); maxCuts = d.cuts; return true; });
    check(maxCuts >= 3, "the director cuts on its own (" + maxCuts + " cuts)");
    check(shots.has("hero") && (shots.has("establish") || shots.has("general")), "close follows and wides, by what is happening (" + [...shots].join(", ") + ")");
  }
});

scenario(5, "snow, fields and the wood: the skins build and fight", async () => {
  for (const map of ["snow", "grass", "forest"]) {
    const W = boot("?map=" + map + "&red=20&blue=20&rw=ak47&bw=ak47&rt=pro&bt=pro&auto=1&probe=0");
    if (W.err) { check(false, map + ": page threw at boot: " + (W.err.stack || W.err)); continue; }
    await settle();
    const a0 = W.B().audit();
    check(a0.started && a0.map === map && a0.terrainLos !== undefined, map + ": booted (relief " + a0.relief + " m, terrain sight " + a0.terrainLos + ")");
    const a = run(W, 240);
    check(a.over, map + ": it ended (" + a.simT + " s, winner " + a.winner + ")");
  }
});

/* 10  THE GROUND IS COVER, AND IT REMEMBERS. The host hands the battle core
   cover points (arenas/cover.js); the dunes carry a dug-in position whose
   berm is in the height function; a bomb digs a crater INTO groundAt and
   breaks the sandbag wall beside it (the collider goes, the points die). */
scenario(10, "the ground: cover for the host, earthworks, craters, broken cover", async () => {
  const W = boot("?map=dunes&red=20&blue=20&rw=ak47&bw=ak47&rt=pro&bt=pro&auto=1&probe=0");
  if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
  await settle();
  const a0 = W.B().audit();
  const T = a0.terrain || {};
  check(T.cover && T.cover.points > 200 && T.cover.terrain > 50, "the dunes give cover points (" + JSON.stringify(T.cover) + ")");
  check(T.dress && T.dress.placed > 10, "and real objects to fight from (" + JSON.stringify(T.dress) + ")");
  run(W, 1);                                     // the armies come in over the first frames
  const HOST = vm.runInContext("HOST", W.sb), MAP = vm.runInContext("MAP", W.sb);
  check(typeof HOST.coverNear === "function" && typeof HOST.coverFrom === "function", "the host interface carries coverNear / coverFrom");
  const red = W.sb.__battle.man("red");      // (a rifleman is a row of the infantry core: a rig or a ghost)
  const blue = W.sb.__battle.man("blue");
  const pt = HOST.coverFrom(red.pos.x, red.pos.z, blue.pos.x, blue.pos.z, 60);
  check(pt && ((blue.pos.x - pt.x) * pt.nx + (blue.pos.z - pt.z) * pt.nz) < 0,
    "coverFrom finds a point with the cover between a red man and the blue line (" + (pt ? pt.kind + " " + pt.h.toFixed(2) + " m" : "none") + ")");
  check(T.ground && T.ground.earthworks >= 6, "the dug-in positions are earthworks in the ground (" + (T.ground && T.ground.earthworks) + ")");
  // a bomb on a sandbag wall: the ground digs, the wall breaks
  const G = W.CBZ.battleGround, C = W.CBZ.battleCover;
  const bag = C.list().find((r) => r.kind === "sandbags" && r.alive);
  check(!!bag, "there is a sandbag wall to break");
  if (bag) {
    const x = bag.x + 3, z = bag.z;
    const before = MAP.groundAt(x, z);
    const ptsBefore = C.stats().points;
    G.blast(x, before, z, W.CBZ.munitionTable.W("mk82"), {});   // a Mk 82 (the charge: weapons/munitiontable.js)
    const after = MAP.groundAt(x, z);
    check(before - after > 0.4, "a bomb digs a crater into groundAt (" + (before - after).toFixed(2) + " m deep)");
    check(!bag.alive, "and breaks the sandbag wall 3 m away (hp " + Math.round(bag.hp) + ")");
    check(C.stats().destroyed >= 1 && C.stats().points !== ptsBefore, "its cover points changed with it (" + ptsBefore + " -> " + C.stats().points + ")");
  }
});

/* 7  DOES HOLDING THE LINE HELP THE MEN HOLDING IT? The same outnumbered army,
   once told to hold (the default now) and once in the old meeting engagement
   (?hold=0), on each open ground. Holding must not make them die faster:
   the exchange (attackers lost per holder lost) is printed and held to
   at least what the meeting engagement got. A LOSS is a man out of the
   fight — dead, fled or taken, or still running at the end — since the
   squads (src/battle/ai/squad.js) break and fall back long before the last
   man dies; a man is added to each side so a 6-0 is a number, not infinity. */
scenario(7, "holding the line: the exchange, held v met", async () => {
  const CASES = [
    { g: "dunes", r: 60, b: 25, rt: "pro", bt: "pro" },
    { g: "snow", r: 45, b: 28, rt: "elite", bt: "elite" },
    { g: "grass", r: 40, b: 24, rt: "thug", bt: "elite" },
  ];
  let better = 0;
  for (const c of CASES) {
    const out = {};
    // three seeds a side and the losses summed: one battle on the dunes is
    // decided by who reached the crest first, which is a coin, not a verdict
    for (const hold of ["1", "0"]) {
      let rl = 0, bl = 0, rd = 0, bd = 0, wins = "";
      for (let seed = 0; seed < 3; seed++) {
        const W = boot("?map=" + c.g + "&red=" + c.r + "&blue=" + c.b + "&rt=" + c.rt + "&bt=" + c.bt + "&rw=ak47&bw=ak47&auto=1&probe=0&hold=" + hold);
        if (W.err) { check(false, "page threw: " + W.err); continue; }
        G(W, "_s = " + (421371 + seed * 7919));
        await settle();
        run(W, 300);
        const T = W.sb.__battle.tally();
        rl += T.dead.red + T.fled.red + T.routed.red; bl += T.dead.blue + T.fled.blue + T.routed.blue;
        rd += T.dead.red; bd += T.dead.blue; wins += (T.winner || "-")[0];
      }
      out[hold] = { wins, xr: Math.round((rl + 1) / (bl + 1) * 100) / 100, rLost: rl, bLost: bl, rd, bd };
    }
    console.log("    " + c.g.padEnd(6) + (c.r + " " + c.rt + " attack " + c.b + " " + c.bt).padEnd(28) +
      " held: " + JSON.stringify(out["1"]) + "   met: " + JSON.stringify(out["0"]));
    if (out["1"] && out["0"] && out["1"].xr >= out["0"].xr * 0.9) better++;
  }
  check(better >= CASES.length - 1, "holding trades at least as well as meeting them in the open (" + better + "/" + CASES.length + ")");
});

/* 8  VEHICLES. A tank is a unit on a side (src/battle/vehicles.js): its file
   (src/units/vehicles/m1_abrams.js, which draws itself) loads at START, the
   side's men take its seats, it drives, its guns land through the page's own
   paths, rifle ball does nothing to its front plate, and the war ends.
   The node world's studio.boom is a stub; here it is given the shape of the
   real one (modecaps blastWorldActors: everyone inside 0.55 R takes the
   blast, with `by` and `fromX/Z`) so a high-explosive round can kill. */
function realBoom(W) {
  W.CBZ.studio.boom = function (p, o) {
    const R = (o && o.radius) || 6, LR = R * 0.55;
    const list = W.sb.__battle.roster().slice();
    for (const a of list) {
      if (a.dead || a.fled || (a.group && a.group.visible === false)) continue;
      if (Math.hypot(a.pos.x - p.x, a.pos.z - p.z) > LR || Math.abs(a.pos.y - p.y) > LR + 3) continue;
      W.sb.hurtMan(a, 1e6, { fromX: p.x, fromZ: p.z, by: (o && o.by) || null, cause: "explosion" });
    }
  };
}
scenario(8, "vehicles: 1 man + 1 M1 Abrams v 30 men, and 3 M1 Abrams v 60 brawlers", async () => {
  {
    const W = boot("?a=m1_abrams*1,men*1&b=men&n=2v30&arena=dunes&bw=ak47&bt=pro&auto=1&probe=0");
    if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
    realBoom(W);
    await settle();
    run(W, 2);
    const R = W.sb.__battle.roster();
    const tank = R.find((m) => m.vehicle && m.unitId === "m1_abrams");
    check(!!tank, "the Abrams is on the field (" + R.filter((m) => m.vehicle).length + " vehicle, " + R.filter((m) => !m.vehicle && m.team === "red").length + " red men on foot)");
    if (!tank) return;
    check(!!tank.group && !tank.group.userData.standIn, "built by its own unit file (units/vehicles/m1_abrams.js), not a stand-in (rig " + !!tank.rig + ")");
    const crew = tank.seats.filter((s) => s.crew && s.man).map((s) => s.seat);
    check(crew.length === 1 && crew[0] === "driver", "the side's one man is in the driver's seat (" + JSON.stringify(crew) + ")");
    const blue = W.sb.__battle.man("blue");    // (a rig, or a ghost of a row of the infantry core)
    const hp0 = tank.hp;
    const sx = blue.pos.x, sz = blue.pos.z;
    blue.pos.x = tank.pos.x + Math.sin(tank.h) * 60; blue.pos.z = tank.pos.z + Math.cos(tank.h) * 60;
    for (let k = 0; k < 20; k++) W.sb.hurtMan(tank, 40, { by: blue });
    blue.pos.x = sx; blue.pos.z = sz;
    check(tank.hp === hp0 && !tank.dead, "twenty AK hits on the front plate do nothing (hp " + hp0 + " -> " + tank.hp + ", last " + JSON.stringify(tank.lastHit && { zone: tank.lastHit.zone, pen: tank.lastHit.pen }) + ")");
    const p0 = { x: tank.pos.x, z: tank.pos.z };
    let moved = 0;
    const a = run(W, 300, () => { moved = Math.max(moved, Math.hypot(tank.pos.x - p0.x, tank.pos.z - p0.z)); return true; });
    // one man drives OR fights: with the enemy already inside its standoff
    // he stops and shoots, so the distance is reported, not held
    console.log("    (one crewman: drove " + moved.toFixed(1) + " m, fought from where he stood)");
    check(tank.shotsF > 0, "its guns fired (" + tank.shotsF + " rounds, " + tank.hitsF + " hits; " + tank.wpn.map((w) => w.w.id + " " + ((w.w.ammo || 0) - w.ammo)).join(", ") + ")");
    check(tank.kills > 0, "and killed (" + tank.kills + ")");
    const cmdGun = tank.wpn.filter((w) => w.w.seat && w.w.seat !== tank.wpn[0].w.seat);
    check(cmdGun.every((w) => w.n === 0), "a lone driver works the main gun's seat, never an empty one's (" + cmdGun.map((w) => w.w.id + " " + w.n).join(", ") + ")");
    check(a.over, "the war ended (" + a.simT + " s, winner " + a.winner + ", red " + a.red + " blue " + a.blue + ")");
  }
  {
    /* the gorilla half of this is not buildable here: the node world has no
       bestiary (CBZ.WILDLIFE_SPECIES is empty, so no animal spawns at all).
       Sixty bare-handed men are the same question to a tank: something that
       wants to close to arm's length against armour it cannot hurt. */
    const W = boot("?a=m1_abrams*3&b=men&n=3v60&bw=fists&bt=thug&arena=dunes&auto=1&probe=0");
    if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
    realBoom(W);
    await settle();
    run(W, 2);
    const tanks = W.sb.__battle.roster().filter((m) => m.vehicle);
    check(tanks.length === 3 && tanks.every((t) => t.seats.filter((s) => s.crew && s.implicit).length === 4),
      "three Abrams, each with its full crew of four (nobody on the side to take the seats)");
    const p0 = tanks.map((t) => ({ x: t.pos.x, z: t.pos.z }));
    let moved = 0;
    const a = run(W, 300, () => { tanks.forEach((t, j) => { moved = Math.max(moved, Math.hypot(t.pos.x - p0[j].x, t.pos.z - p0[j].z)); }); return true; });
    check(moved > 5, "a crewed tank drives (" + moved.toFixed(1) + " m)");
    const k = tanks.reduce((s, t) => s + t.kills, 0);
    check(k > 0, "the tanks killed the mob (" + k + ")");
    check(tanks.every((t) => !t.dead), "fists do not go through armour (tanks standing: " + tanks.filter((t) => !t.dead).length + ")");
    check(a.over, "the war ended (" + a.simT + " s, winner " + a.winner + ")");
  }
  {
    // a carrier: 3 crew + 6 riflemen in the back, against a tank and 10 men
    const W = boot("?a=bradley_ifv*1,men*9&b=m1_abrams*1,men*10&arena=dunes&rw=ak47&bw=ak47&auto=1&probe=0");
    if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
    realBoom(W);
    await settle();
    run(W, 2);
    const ifv = W.sb.__battle.roster().find((m) => m.unitId === "bradley_ifv");
    check(!!ifv && ifv.seats.filter((s) => !s.crew && s.man).length === 6 && ifv.seats.filter((s) => s.crew && s.man).length === 3,
      "the Bradley carries its crew of three and six riflemen");
    let out = 0;
    const a = run(W, 300, () => { if (ifv && ifv.dismounted) out = 1; return true; });
    check(out === 1, "the riflemen got out (" + (ifv && ifv.dismounted ? "dismounted" : "never") + ")");
    check(a.over, "the war ended (" + a.simT + " s, winner " + a.winner + ")");
  }
});

/* 12  WHEELS. A Humvee and a loaded M35 against riflemen: both are their own
   unit files on units/kit/hull.js (not stand-ins), the M35 carries sixteen,
   rifle ball bounces off the Humvee's B-kit and goes through the truck's
   sheet metal, the truck puts its men out BEFORE it parks on its firing line
   (dismountAt > 1.15 x standoff), the .50s fire, and a wheeled hull never
   corners harder than its grip. */
scenario(12, "wheels: a Humvee and a loaded M35 v 30 riflemen", async () => {
  const W = boot("?a=m35_truck*1,hmmwv*1,men*23&b=men&n=25v30&arena=dunes&aw=ak47&bw=ak47&bt=pro&auto=1&probe=0");
  if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
  realBoom(W);
  await settle();
  run(W, 0.1);                                   // the spawn queue drains; nobody has thought yet
  const R = W.sb.__battle.roster();
  const hm = R.find((m) => m.unitId === "hmmwv"), tr = R.find((m) => m.unitId === "m35_truck");
  check(!!hm && !!tr, "both are on the field (" + R.filter((m) => m.vehicle).map((m) => m.unitId).join(", ") + ")");
  if (!hm || !tr) return;
  check(!hm.group.userData.standIn && !tr.group.userData.standIn && !!(hm.rig && hm.rig.mark && tr.rig && tr.rig.mark),
    "built by their own files on the hull kit (rigs with mark/fire/damage)");
  const nearest = () => {
    let d = 1e9;
    for (const o of W.sb.__battle.roster()) if (o.team === "blue" && !o.dead) d = Math.min(d, Math.hypot(o.pos.x - tr.pos.x, o.pos.z - tr.pos.z));
    return d;
  };
  const d0 = nearest();
  // 23 men: 5 take the crew seats (2 drivers, the gunner, 2 commanders), 16
  // the truck's benches, 2 the Humvee's back seats. The armies form ~160 m
  // apart, inside the truck's 520 m: the men get out on the first think,
  // where the truck stands, not after it has driven them into the enemy
  const onFoot = R.filter((m) => m.team === "red" && !m.vehicle && !m.inVeh).length;
  const crewN = [hm, tr].reduce((s, v) => s + v.seats.filter((x) => x.crew && x.man).length, 0);
  check(crewN === 5 && onFoot === 18 && tr.dismounted, "5 crew aboard; the 16 riflemen and the Humvee's 2 got out at once (" + crewN + " crew, " + onFoot + " on foot, enemy " + Math.round(d0) + " m)");
  run(W, 2);
  const blue = W.sb.__battle.man("blue");
  const sx = blue.pos.x, sz = blue.pos.z;
  const hp0 = hm.hp;
  blue.pos.x = hm.pos.x + Math.sin(hm.h) * 80; blue.pos.z = hm.pos.z + Math.cos(hm.h) * 80;
  for (let k = 0; k < 12; k++) W.sb.hurtMan(hm, 30, { by: blue });
  check(hm.hp === hp0, "AK ball off the Humvee's armoured front does nothing (hp " + hp0 + " -> " + hm.hp + ")");
  const tp0 = tr.hp;
  blue.pos.x = tr.pos.x + Math.sin(tr.h) * 80; blue.pos.z = tr.pos.z + Math.cos(tr.h) * 80;
  for (let k = 0; k < 3; k++) W.sb.hurtMan(tr, 30, { by: blue });
  check(tr.hp < tp0 && !tr.dead, "and goes through the truck's sheet metal (hp " + tp0 + " -> " + Math.round(tr.hp) + ")");
  blue.pos.x = sx; blue.pos.z = sz;
  let maxLat = 0;
  const a = run(W, 300, () => {
    for (const v of [hm, tr]) if (!v.dead) maxLat = Math.max(maxLat, Math.abs(v.ds.v * v.ds.w));
    return true;
  });
  check(hm.shotsF + tr.shotsF > 0, "the .50s fired (" + hm.shotsF + " + " + tr.shotsF + " rounds, " + (hm.kills + tr.kills) + " kills)");
  check(maxLat <= 0.75 * 9.8, "no wheeled hull cornered harder than its grip (max " + (maxLat / 9.8).toFixed(2) + " g)");
  check(a.over, "the war ended (" + a.simT + " s, winner " + a.winner + ")");
});

/* 16  THE CONVOY. An M1 leading a MaxxPro MRAP and a JLTV (the troop
   carriers the US actually uses, both their own files on units/kit/hull.js)
   against riflemen with RPGs. The MRAP carries six and the JLTV one behind
   their crews; the men get out (the armies form inside both dismount
   ranges); rifle ball stops on every face of the MRAP, in the scripted
   check AND in the battle (every small-arms round that reaches it is
   counted); the MRAP corners inside its rollover limit and heels further
   than the JLTV doing it; and a buried charge under each hull: the V-hulls
   live, the Humvee's flat floor does not. */
scenario(16, "the convoy: an M1, a MaxxPro and a JLTV v riflemen with RPGs", async () => {
  const W = boot("?a=m1_abrams*1,maxxpro_mrap*1,jltv*1,men*17&b=men&n=20v60&arena=dunes&aw=carbine&bw=ak47,ak47,ak47,ak47,bazooka&bt=elite&auto=1&probe=0");
  if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
  realBoom(W);
  await settle();
  run(W, 0.1);
  const R = W.sb.__battle.roster();
  const mr = R.find((m) => m.unitId === "maxxpro_mrap"), jl = R.find((m) => m.unitId === "jltv"), tk = R.find((m) => m.unitId === "m1_abrams");
  check(!!mr && !!jl && !!tk, "the column is on the field (" + R.filter((m) => m.vehicle).map((m) => m.unitId).join(", ") + ")");
  if (!mr || !jl || !tk) return;
  check(!mr.group.userData.standIn && !jl.group.userData.standIn && !!(mr.rig && mr.rig.mark && jl.rig && jl.rig.mark),
    "the MaxxPro and the JLTV are built by their own files on the hull kit (rigs with mark/fire/damage)");
  const crew = (v) => v.seats.filter((x) => x.crew && x.man).length, pax = (v) => v.seats.filter((x) => !x.crew && x.man).length;
  // 17 men: 10 take the crew seats (4 in the tank, 3 + 3), 6 the MRAP's benches, 1 the JLTV's back seat
  const onFoot = R.filter((m) => m.team === "red" && !m.vehicle && !m.inVeh).length;
  check(crew(tk) === 4 && crew(mr) === 3 && crew(jl) === 3, "crews aboard: tank 4, MaxxPro 3, JLTV 3 (" + crew(tk) + ", " + crew(mr) + ", " + crew(jl) + ")");
  check(mr.dismounted && jl.dismounted && onFoot === 7 && pax(mr) === 0 && pax(jl) === 0,
    "the MaxxPro's six and the JLTV's one got out (" + onFoot + " riflemen on foot)");
  // the scripted check: an AK man 80 m off each face of the MRAP, a sniper off its flank
  run(W, 1);
  const blue = W.sb.__battle.man("blue", (m) => !m.launcher);
  const sx = blue.pos.x, sz = blue.pos.z, sw = blue.wid;
  const hp0 = mr.hp, faces = [];
  for (const [name, a] of [["front", 0], ["side", Math.PI / 2], ["rear", Math.PI], ["other side", -Math.PI / 2]]) {
    blue.pos.x = mr.pos.x + Math.sin(mr.h + a) * 80; blue.pos.z = mr.pos.z + Math.cos(mr.h + a) * 80;
    for (let k = 0; k < 10; k++) W.sb.hurtMan(mr, 30, { by: blue });
    faces.push(name + " " + (mr.lastHit && mr.lastHit.zone));
  }
  blue.wid = "sniper";
  blue.pos.x = mr.pos.x + Math.sin(mr.h + Math.PI / 2) * 300; blue.pos.z = mr.pos.z + Math.cos(mr.h + Math.PI / 2) * 300;
  for (let k = 0; k < 10; k++) W.sb.hurtMan(mr, 60, { by: blue });
  blue.wid = sw; blue.pos.x = sx; blue.pos.z = sz;
  check(mr.hp === hp0 && !mr.dead, "40 AK rounds on all four faces and 10 sniper rounds on the flank do nothing to the MRAP (hp " + hp0 + " -> " + mr.hp + "; " + faces.join(", ") + ")");
  // the battle: count every round that reaches the MRAP, by what it was
  const D = W.CBZ.vehicleDrive, hurt0 = W.sb.hurtMan;
  const led = { small: 0, smallPen: 0, heavy: 0, heavyPen: 0 };
  W.sb.hurtMan = function (m, dmg, imp) {
    const live = m === mr && dmg > 0 && !mr.dead;
    const r = hurt0.apply(this, arguments);
    if (live) {
      const th = D.threatOf(imp || {}, imp && imp.by);
      const pen = !!(mr.lastHit && mr.lastHit.pen);
      if (th.cls === "small") { led.small++; if (pen) led.smallPen++; } else { led.heavy++; if (pen) led.heavyPen++; }
    }
    return r;
  };
  let latM = 0, latJ = 0, rollM = 0, rollJ = 0;
  const a = run(W, 300, () => {
    if (!mr.dead) { latM = Math.max(latM, Math.abs(mr.ds.v * mr.ds.w)); rollM = Math.max(rollM, Math.abs(mr.rig.roll || 0)); }
    if (!jl.dead) { latJ = Math.max(latJ, Math.abs(jl.ds.v * jl.ds.w)); rollJ = Math.max(rollJ, Math.abs(jl.rig.roll || 0)); }
    return true;
  });
  W.sb.hurtMan = hurt0;
  console.log("    MRAP ledger " + JSON.stringify(led) + ", hp " + Math.round(mr.hp) + "/" + mr.maxHp + (mr.dead ? " (knocked out)" : "") + "; JLTV hp " + Math.round(jl.hp) + (jl.dead ? " (knocked out)" : "") +
    "; guns " + [tk, mr, jl].map((v) => v.unitId + " " + v.shotsF + "/" + v.kills).join(", "));
  check(led.small > 0 && led.smallPen === 0, "in the fight, " + led.small + " rifle rounds reached the MRAP and none got through");
  check(mr.shotsF + jl.shotsF > 0, "the .50s on the MRAP's ring and the JLTV's CROWS fired (" + mr.shotsF + " + " + jl.shotsF + " rounds)");
  check(latM <= 0.42 * 9.8 * 1.05, "the MRAP never cornered past its rollover limit (max " + (latM / 9.8).toFixed(2) + " g of 0.42)");
  // (sixty against a column can stall into a long fight: the end is reported, not required)
  check(!mr.dead, "the MRAP came through the fight (" + a.simT + " s, " + (a.over ? "winner " + a.winner : "still fighting") + ", red " + a.red + " blue " + a.blue + ")");

  // A BURIED CHARGE under each hull: the V-hulls take it on the belly and live
  const W2 = boot("?a=maxxpro_mrap*1,jltv*1,hmmwv*1&b=men&n=3v5&arena=dunes&bw=ak47&auto=1&probe=0");
  if (W2.err) { check(false, "page threw at boot: " + (W2.err.stack || W2.err)); return; }
  await settle();
  run(W2, 0.1);
  const R2 = W2.sb.__battle.roster();
  // TOP-HEAVY: each hull floored for 8 s, then full lock for 5 s. The MRAP's
  // driver is held to its rollover limit (0.42 g) and still heels over
  // further than the JLTV pulling nearly twice the g
  const turn = {};
  for (const id of ["maxxpro_mrap", "jltv"]) {
    const v = R2.find((m) => m.unitId === id);
    let lat = 0, roll = 0;
    for (let k = 0; k < 650; k++) {
      W2.sb.vehMove(v, 0.02, { throttle: 1, steer: k < 400 ? 0 : 1, brake: 0 });
      W2.sb.vehAnimate(v, 0.02);
      if (k >= 400) { lat = Math.max(lat, Math.abs(v.ds.v * v.ds.w)); roll = Math.max(roll, Math.abs(v.rig.roll)); }
    }
    turn[id] = { g: lat / 9.8, deg: roll * 57.3 };
  }
  console.log("    full lock " + JSON.stringify(turn));
  check(turn.maxxpro_mrap.g <= 0.42 * 1.02 && turn.maxxpro_mrap.g > 0.3, "the MRAP's driver takes a tight turn at its rollover limit (" + turn.maxxpro_mrap.g.toFixed(2) + " g of 0.42)");
  check(turn.maxxpro_mrap.deg > turn.jltv.deg * 1.5, "and its body rolls over much further than the JLTV's at " + turn.jltv.g.toFixed(2) + " g (" + turn.maxxpro_mrap.deg.toFixed(1) + " v " + turn.jltv.deg.toFixed(1) + " deg)");
  const out = {};
  for (const id of ["maxxpro_mrap", "jltv", "hmmwv"]) {
    const v = R2.find((m) => m.unitId === id);
    let pens = 0, zone = null;
    const hp = v.hp, vs0 = JSON.stringify(v.vs);
    for (let k = 0; k < 20; k++) {
      if (v.dead) break;
      W2.sb.hurtMan(v, 400, { cause: "ied", fromX: v.pos.x, fromZ: v.pos.z });
      zone = v.lastHit && v.lastHit.zone;
      if (v.lastHit && v.lastHit.pen) pens++;
      if (!v.dead) { Object.assign(v.vs, JSON.parse(vs0)); v.hp = hp; }       // the same hull, twenty times over
    }
    out[id] = { pens: pens, zone: zone, dead: !!v.dead };
  }
  console.log("    IED " + JSON.stringify(out));
  check(out.maxxpro_mrap.zone === "belly" && out.maxxpro_mrap.pens === 0 && !out.maxxpro_mrap.dead, "twenty IEDs under the MaxxPro: the V-hull takes every one on its belly, nothing through");
  check(out.jltv.pens <= 2 && !out.jltv.dead, "the JLTV's MRAP-class floor holds (" + out.jltv.pens + " of 20 through)");
  check(out.hmmwv.pens > 0, "the Humvee's flat floor does not (" + out.hmmwv.pens + " through, " + (out.hmmwv.dead ? "knocked out" : "standing") + ")");
});

/* 17  THE CONVOY. An Abrams and two FMTV M1083A1s with a squad of sixteen on
   each bed, against forty riflemen. The trucks are their own file on the hull
   kit; they fill before they unload (the spawn queue no longer races the
   dismount), the men ride drawn on the benches, the tailgates drop and the
   thirty-two get out and fight. Armour by place (stats.plates): rifle ball
   bounces off the LTAS cab and leaves its strike on it, goes through the bed,
   and a .50 goes through the cab. */
scenario(17, "the convoy: an Abrams and two loaded FMTVs v 40 riflemen; the squads dismount and fight", async () => {
  const W = boot("?a=m1_abrams*1,fmtv*2,men*40&b=men&n=43v40&arena=dunes&aw=ak47&bw=ak47&bt=pro&auto=1&probe=0");
  if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
  realBoom(W);
  await settle();
  // the moment each truck unloads: who is in the back, and how many its rig draws
  const most = new Map(), drawn = new Map(), riders = new Set();
  const unload = W.sb.vehDismount;
  W.sb.vehDismount = function (u) {
    if (u.unitId === "fmtv") {
      const on = u.seats.filter((s) => !s.crew && s.man);
      on.forEach((s) => riders.add(s.man));
      most.set(u, on.length);
      if (u.rig && u.rig.troops) { u.rig.dt = 0.05; u.rig.crew(u); drawn.set(u, u.rig.troops.im.count); }
    }
    return unload(u);
  };
  run(W, 2);
  const R = W.sb.__battle.roster();
  const trucks = R.filter((m) => m.unitId === "fmtv"), tank = R.find((m) => m.unitId === "m1_abrams");
  check(trucks.length === 2 && !!tank, "the convoy is on the field (" + R.filter((m) => m.vehicle).map((m) => m.unitId).join(", ") + ")");
  if (trucks.length !== 2 || !tank) return;
  check(trucks.every((t) => !t.group.userData.standIn && t.rig && t.rig.mark && t.rig.troops && t.rig.tailgate),
    "built by units/vehicles/fmtv.js on the hull kit (rig with troops, tailgate, mark)");
  check(trucks.every((t) => t.tactics && t.tactics.role === "transport" && t.tactics.convoy) && trucks[0].def.label !== "",
    "def.tactics marks it a convoy transport (" + JSON.stringify(trucks[0].tactics.convoy) + ")");
  check(trucks.every((t) => most.get(t) === 16), "each truck filled its sixteen bench seats before it unloaded (" + trucks.map((t) => most.get(t)).join(", ") + ")");
  check(trucks.every((t) => drawn.get(t) === 16), "and drew all sixteen on the benches while they rode (" + trucks.map((t) => drawn.get(t)).join(", ") + ")");
  check(trucks.every((t) => t.seats.filter((s) => s.crew && s.man).length === 2), "driver and commander in each cab");
  check(trucks.every((t) => t.dismounted && t.seats.every((s) => s.crew || !s.man)), "the squads got out (the armies form inside the 520 m dismount range)");
  check(trucks.every((t) => t.rig.tailgate.obj.rotation.x < -1.2), "the tailgates are down (" + trucks.map((t) => t.rig.tailgate.obj.rotation.x.toFixed(2)).join(", ") + ")");
  // ARMOUR BY PLACE: a man 80 m off the face, a round with its impact point
  const blue = W.sb.__battle.man("blue");
  const t = trucks[0], sx = blue.pos.x, sz = blue.pos.z;
  const world = (hx, hy, hz) => {
    const c = Math.cos(t.h), s = Math.sin(t.h);
    return { x: t.pos.x + hx * c + hz * s, y: t.pos.y + hy, z: t.pos.z - hx * s + hz * c };
  };
  const off = (hx, hz, d) => { const p = world(hx * d, 0, hz * d); blue.pos.x = p.x; blue.pos.z = p.z; };
  const hp0 = t.hp, strikes = t.group.getObjectByName("strikes");
  off(0, 1, 80);
  for (let k = 0; k < 8; k++) W.sb.hurtMan(t, 40, { by: blue, pen: 7, at: world((k % 3 - 1) * 0.5, 2.0 + (k % 2) * 0.5, 3.465) });
  check(t.hp === hp0, "AK ball on the armoured cab's face bounces (hp " + hp0 + " -> " + t.hp + ", last " + JSON.stringify(t.lastHit && { zone: t.lastHit.zone, armour: t.lastHit.armour, pen: t.lastHit.pen }) + ")");
  check(!!strikes && strikes.count === 8, "and leaves its strikes on the cab (" + (strikes && strikes.count) + " marks)");
  off(1, 0, 80);
  for (let k = 0; k < 4; k++) W.sb.hurtMan(t, 40, { by: blue, pen: 7, at: world(1.22, 2.2, 2.4) });
  check(t.hp === hp0, "and off the door's B-kit panel (hp " + t.hp + ")");
  for (let k = 0; k < 3; k++) W.sb.hurtMan(t, 40, { by: blue, pen: 7, at: world(1.22, 1.9, -1.5) });
  const hpBed = t.hp;
  check(hpBed < hp0 && t.lastHit.pen && t.lastHit.armour < 2, "but goes straight through the bed's sheet steel (hp " + hp0 + " -> " + Math.round(hpBed) + ", " + t.lastHit.armour + " mm)");
  off(0, 1, 80);
  W.sb.hurtMan(t, 120, { by: blue, pen: 19, at: world(0.3, 2.4, 3.465) });
  check(t.hp < hpBed && t.lastHit.pen && t.lastHit.armour === 11, "a .50 round goes through the cab (" + t.lastHit.armour + " mm, hp " + Math.round(hpBed) + " -> " + Math.round(t.hp) + ")");
  blue.pos.x = sx; blue.pos.z = sz;
  // THE FIGHT
  const a = run(W, 300);
  const pax = [...riders];
  const shots = pax.reduce((s, m) => s + (m.shotsF || 0), 0), kills = pax.reduce((s, m) => s + (m.kills || 0), 0);
  check(pax.length === 32 && shots > 0, "the " + pax.length + " who rode in fought on foot (" + shots + " rounds, " + kills + " kills)");
  check(kills > 0, "and killed");
  check(trucks.some((v) => v.shotsF > 0), "the ring .50s fired (" + trucks.map((v) => v.shotsF).join(" + ") + " rounds)");
  check(a.over, "the war ended (" + a.simT + " s, winner " + a.winner + ", red " + a.red + " blue " + a.blue + "; trucks " + trucks.map((v) => v.dead ? "lost" : Math.round(v.hp) + " hp").join(", ") + ")");
});

/* 11  AIRCRAFT. The vehicle contract's air half (docs/npcwar/ARCHITECTURE.md):
   a helicopter fights from battle positions (masked low, up to fire, down,
   sidestep), a jet flies attack runs at a real height; every unit animates
   itself on the battle clock and names the weapon of every round. */
/* 15  ROCKET ARTILLERY. The M142 HIMARS (src/units/vehicles/m270_mlrs.js)
   against a company of riflemen: built by its own file on the hull kit, it
   keeps out of its minimum range, stops, lays the pod, and ripples GUIDED
   GMLRS (rig.launched sets the homing mark): the rockets land on the group
   and kill (the old 220 m/s lob flew 45 s and killed nothing). */
scenario(15, "rocket artillery: a HIMARS fire mission on 40 riflemen", async () => {
  const W = boot("?a=m270_mlrs*1&b=men&n=1v40&arena=dunes&bw=ak47&auto=1&probe=0");
  if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
  realBoom(W);
  await settle();
  run(W, 0.1);
  const R = W.sb.__battle.roster();
  const h = R.find((m) => m.unitId === "m270_mlrs");
  check(!!h && !h.group.userData.standIn && !!(h.rig && h.rig.launched && h.rig.canFire), "the HIMARS is built by its own file (rig with launched / canFire)");
  if (!h) return;
  let guided = 0, minD = 1e9;
  const orig = h.rig.launched.bind(h.rig);
  h.rig.launched = function (rk, shot, t) { orig(rk, shot, t); if (rk.homing) guided++; };
  const blueDead = () => W.sb.__battle.soldiers("blue").filter((m) => m.dead).length;     // (rows of the infantry core included)
  const a = run(W, 150, () => {
    for (const o of W.sb.__battle.roster()) if (o.team === "blue" && !o.dead) minD = Math.min(minD, Math.hypot(o.pos.x - h.pos.x, o.pos.z - h.pos.z));
    return true;
  });
  check(h.shotsF >= 1 && guided === h.shotsF, "it fired, every rocket guided (" + h.shotsF + " fired, " + guided + " guided)");
  check(h.kills > 0 || blueDead() > 0, "the rockets killed (" + h.kills + " credited, " + blueDead() + " blue dead in " + a.simT + " s, winner " + a.winner + ")");
});

scenario(11, "aircraft: an Apache's battle positions, an F-35's attack runs", async () => {
  {
    const W = boot("?a=ah64_apache*1&b=men&n=1v30&arena=dunes&bw=ak47&auto=1&probe=0");
    if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
    realBoom(W);
    await settle();
    run(W, 2);
    const h = W.sb.__battle.roster().find((m) => m.unitId === "ah64_apache");
    const agl = () => h.pos.y - vm.runInContext("MAP", W.sb).groundAt(h.pos.x, h.pos.z);
    check(!!h && h.air && agl() > 3, "the Apache is in the air (" + (h ? Math.round(agl()) : "-") + " m over the ground)");
    if (!h) return;
    /* THE VEHICLE CONTRACT (docs/npcwar/ARCHITECTURE.md): the unit's own
       animate runs on the battle clock, the side's nation reached build(),
       every round names its weapon, and a fixed weapon only fires with the
       nose on the mark. Wrapped around the rig's own hooks. */
    check(h.side && h.side.nation === "kesh" && (h.side.flag || !(W.CBZ.flags && W.CBZ.flags.designFor)), "build(ctx) was told the side: " + (h.side && h.side.nation));
    const R0 = h.rig.state, clock0 = R0.clock;
    const fired = {}, offNose = [];
    const fire0 = h.rig.fire;
    h.rig.fire = function (shot) {
      fired[shot.wid] = (fired[shot.wid] || 0) + 1;
      const W0 = h.wpn[shot.wi];
      if (W0.mount === "fixed" && shot.target) {
        const off = Math.abs(W.CBZ.vehicleDrive.wrap(Math.atan2(shot.target.pos.x - h.pos.x, shot.target.pos.z - h.pos.z) - h.h));
        if (off > W0.arc + 0.02) offNose.push(shot.wid + " " + off.toFixed(2));
      }
      return fire0.apply(this, arguments);
    };
    const phases = {};
    let lo = 1e9, hi = -1e9;
    const a = run(W, 300, () => { phases[h.airPhase] = 1; if (!h.dead) { lo = Math.min(lo, agl()); hi = Math.max(hi, agl()); } return true; });
    check(R0.clock > clock0 + 1, "its own animate ran on the battle clock (rig clock " + clock0.toFixed(1) + " -> " + R0.clock.toFixed(1) + " s)");
    check(Object.keys(fired).length > 0 && Object.keys(fired).every((k) => h.wpn.some((w) => w.w.id === k)),
      "every round named its weapon (" + JSON.stringify(fired) + ")");
    check(offNose.length === 0, "fixed weapons fired only with the nose on the mark (" + (offNose.slice(0, 4).join(", ") || "none off") + ")");
    console.log("    (flight: phases " + Object.keys(phases).join(" ") + ", " + Math.round(lo) + "-" + Math.round(hi) + " m over the ground)");
    check(phases.mask && phases.pop, "it fought from battle positions: masked low, popped up to fire");
    check(h.kills > 0, "and it killed from there (" + h.kills + ")");
    check(a.over, "the war ended (" + a.simT + " s, winner " + a.winner + ")");
  }
  {
    /* A JET FLIES ATTACK RUNS AT A REAL HEIGHT: the F-35 bombs from medium
       altitude (GBU-12s released kilometres short, guided onto the mark),
       then strafes in a dive with the nose on the mark. */
    const W = boot("?a=f35*1&b=men&n=1v30&arena=dunes&bw=ak47&auto=1&probe=0");
    if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
    realBoom(W);
    await settle();
    run(W, 1);
    const j = W.sb.__battle.roster().find((m) => m.unitId === "f35");
    if (!j) { check(false, "the F-35 is on the field"); return; }
    const agl = () => j.pos.y - vm.runInContext("MAP", W.sb).groundAt(j.pos.x, j.pos.z);
    check(agl() > 3000, "the F-35 comes in at medium altitude (" + Math.round(agl()) + " m)");
    let relD = 0, lo = 1e9;
    const R = W.sb.__battle.roster();
    // the weapons by kind, not by place in the list (the unit file orders them)
    const bombW = () => j.wpn.find((w) => w.w.kind === "bombs" && !w.off) || j.wpn.find((w) => w.w.kind === "bombs");
    const gunW = () => j.wpn.find((w) => w.w.kind === "autocannon");
    const a = run(W, 300, () => {
      if (!j.dead) lo = Math.min(lo, agl());
      const W0 = bombW();
      if (!relD && W0 && W0.n > 0) {
        const t = j.tgt || R.find((m) => m.team === "blue" && !m.dead);
        relD = t ? Math.hypot(t.pos.x - j.pos.x, t.pos.z - j.pos.z) : -1;
      }
      return true;
    });
    check(bombW().n > 0 && relD > 2000, "it released its bombs a stand-off short of the mark (" + bombW().n + " " + bombW().w.id + " away, first " + Math.round(relD) + " m out)");
    check(gunW().n === 0 || lo < 1400, "the gun run was a dive (" + gunW().n + " rounds, lowest " + Math.round(lo) + " m)");
    check(lo >= 59, "never below 60 m over the ground (" + Math.round(lo) + " m)");
    console.log("    (F-35: " + j.kills + " kills, war " + (a.over ? "over at " + a.simT + " s" : "still on") + ")");
  }
  {
    /* THE STEALTH LOAD (src/units/vehicles/f35.js): against armour the jet is
       tasked with eight SDBs; the bays are open at every release (kilometres
       out, guided) and shut again once the pass is over. */
    const W = boot("?a=f35*1&b=m1_abrams*3&n=1v3&arena=dunes&auto=1&probe=0");
    if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
    realBoom(W);
    await settle();
    run(W, 1);
    const j = W.sb.__battle.roster().find((m) => m.unitId === "f35");
    if (!j || !j.rig || !j.rig.state) { check(false, "the F-35 is on the field with its own rig"); return; }
    const S = j.rig.state, rel = [];
    const fire0 = j.rig.fire;
    j.rig.fire = function (shot) {
      if (shot.kind === "bombs") rel.push({ wid: shot.wid, bay: S.bay, d: shot.target ? Math.round(Math.hypot(shot.target.pos.x - j.pos.x, shot.target.pos.z - j.pos.z)) : -1 });
      return fire0.apply(this, arguments);
    };
    let shutAfter = false, wasOpen = false;
    run(W, 200, () => { if (S.bay > 0.95) wasOpen = true; else if (wasOpen && j.airPhase === "out" && S.bay < 0.05) shutAfter = true; return true; });
    check(S.load === "sdb", "armour tasks the SDB load (" + S.load + ")");
    check(rel.length >= 2 && rel.every((r) => r.wid === "gbu39_sdb" && r.bay > 0.95 && r.d > 2000), "every SDB left an open bay, kilometres out (" + JSON.stringify(rel) + ")");
    check(shutAfter, "the bays shut again after the pass (stealth)");
    console.log("    (F-35 v 3 M1: " + j.kills + " kills, " + rel.length + " SDBs)");
  }
});


/* SIDES, SERIES AND THE URL MATCHUP (docs/npcwar/ARCHITECTURE.md §5-7).
   A side is what is on it, never a colour: the war room and the end card say
   "20 SOLDIERS" / "12 MEN" (or the nations, when two sides say the same
   thing); the new URL names (a b n arena at bt af bf bo sa sb) build the war;
   a best-of-3 at 1-0 scores this round, says the series, and hands the next
   round the score in its URL. Nothing a player reads says RED or BLUE. */
/* 12  AIR ASSAULT. A UH-60 carries its squad low to a landing zone short of
   the enemy, hovers at its fast-rope height and puts them down the ropes
   one at a time; nobody leaves it while it is flying anywhere else. Then
   its door guns work the area, each only inside its own sector. */
scenario(12, "air assault: a Black Hawk fast-ropes its squad in, then its door guns fight", async () => {
  const W = boot("?a=uh60_black_hawk*1,men*15&b=men&n=16v25&arena=dunes&bw=ak47&auto=1&probe=0");
  if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
  realBoom(W);
  await settle();
  run(W, 1);
  const B = W.sb.__battle, MAP = vm.runInContext("MAP", W.sb);
  const h = B.roster().find((m) => m.unitId === "uh60_black_hawk");
  check(!!h && h.air, "the Black Hawk is in the air");
  if (!h) return;
  const pax0 = h.seats.filter((s) => !s.crew && s.man).length;
  check(pax0 === 11, "eleven troops on the benches, four crew in their seats (" + pax0 + " aboard, crew " + h.seats.filter((s) => s.crew && (s.man || s.implicit)).length + ")");
  check(!!(h.rig && h.rig.state), "its own rig was built (not the stand-in box)");
  const outs = [];
  let last = pax0, firstDrop = null;
  const fired = {}, offSector = [];
  const fire0 = h.rig.fire;
  h.rig.fire = function (shot) {
    fired[shot.wid] = (fired[shot.wid] || 0) + 1;
    if (shot.target) {
      const rel = W.CBZ.vehicleDrive.wrap(Math.atan2(shot.target.pos.x - h.pos.x, shot.target.pos.z - h.pos.z) - h.h);
      if ((shot.wid === "m240h_port" && rel < -0.2) || (shot.wid === "m240h_stbd" && rel > 0.2)) offSector.push(shot.wid + " " + rel.toFixed(2));
    }
    return fire0.apply(this, arguments);
  };
  run(W, 240, () => {
    const n = h.dead ? last : h.seats.filter((s) => !s.crew && s.man).length;
    if (n < last) {
      const agl = h.pos.y - MAP.groundAt(h.pos.x, h.pos.z);
      outs.push({ t: B.audit().simT, agl: +agl.toFixed(1), v: +h.ds.v.toFixed(1), ph: h.airPhase });
      if (firstDrop == null) firstDrop = B.audit().simT;
    }
    last = n;
    return true;
  });
  console.log("    (drops: " + outs.length + ", e.g. " + JSON.stringify(outs.slice(0, 3)) + "; fired " + JSON.stringify(fired) + ")");
  check(outs.length > 0, "the squad got out (" + (pax0 - last) + " of " + pax0 + ")");
  check(outs.every((o, i) => o.agl > 8 && o.agl < 16 && (i === outs.length - 1 || (o.ph === "insert" && o.v < 3.5))), "every man came down a rope from a hover at ~12 m (" + JSON.stringify(outs.slice(-2)) + ")");
  check(outs.length < 2 || outs.length >= 6, "one at a time over several steps, not all in one frame (" + outs.length + " drops)");
  check(offSector.length === 0, "each door gun fired only inside its own sector (" + (offSector.slice(0, 3).join(", ") || "none out") + ")");
});

/* 13  THE B-52. It comes in from beyond the horizon at 9 km, opens the bay
   on the run-in, and walks ONE stick of Mk-82s across the mark from its
   own bay stations (each bomb drawn falling), released kilometres short. */
scenario(13, "the B-52: a high-altitude run, the bay opens, a stick walks across the mark", async () => {
  const W = boot("?a=b52*1&b=men&n=1v60&arena=dunes&bw=ak47&auto=1&probe=0");
  if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
  realBoom(W);
  await settle();
  run(W, 1);
  const b = W.sb.__battle.roster().find((m) => m.unitId === "b52");
  if (!b) { check(false, "the B-52 is on the field"); return; }
  const MAP = vm.runInContext("MAP", W.sb);
  const agl = () => b.pos.y - MAP.groundAt(b.pos.x, b.pos.z);
  const R = b.rig && b.rig.state;
  check(!!R && !!R.skins && R.skins.length > 0, "its own skinned airframe was built (not the stand-in)");
  check(agl() > 8500, "it comes in at bombing height (" + Math.round(agl()) + " m)");
  const enemy = W.sb.__battle.soldiers("blue").filter((m) => !m.dead);
  const d0 = Math.min.apply(null, enemy.map((m) => Math.hypot(m.pos.x - b.pos.x, m.pos.z - b.pos.z)));
  check(d0 > 10500, "from beyond its release distance, so the first pass is a real run (" + Math.round(d0) + " m out)");
  let doorAtFirst = -1, first = -1, firstD = 0, maxStick = 0, stick = 0, lastN = 0, lastT = 0;
  const W0 = b.wpn[0];
  const a = run(W, 160, (t) => {
    if (W0.n > lastN) {
      if (first < 0) { first = t; doorAtFirst = R.door; const tg = b.tgt; firstD = tg ? Math.hypot(tg.pos.x - b.pos.x, tg.pos.z - b.pos.z) : 0; }
      stick = t - lastT < 1.5 ? stick + (W0.n - lastN) : (W0.n - lastN);
      maxStick = Math.max(maxStick, stick); lastN = W0.n; lastT = t;
    }
    return true;
  });
  check(first >= 0, "it released (" + W0.n + " Mk-82s)");
  check(doorAtFirst > 0.9, "the bay doors were open before the first bomb left (" + doorAtFirst.toFixed(2) + ")");
  check(firstD > 7000, "released kilometres short of the mark (" + Math.round(firstD) + " m)");
  check(maxStick >= 12, "a stick, not a few bombs a pass (" + maxStick + " in one ripple)");
  const dead = W.sb.__battle.soldiers("blue").filter((m) => m.dead).length;
  console.log("    (B-52: " + dead + " of 60 dead, " + b.kills + " kills, war " + (a.over ? "over at " + a.simT + " s" : "still on at " + a.simT + " s") + ")");
  check(dead > 0, "the stick killed (" + dead + ")");
});

/* 14  AIR DEFENCE. A Patriot launcher turns its tail to the threat, emplaces
   (outriggers down, the launcher up to its fixed 38 degrees), holds its site
   instead of driving at its mark, and kills helicopters with PAC-3 MSEs that
   only leave a launcher that is up, slewed and still. */
scenario(14, "air defence: a Patriot emplaced, two Apaches; then riflemen close in and it displaces", async () => {
  {
    const W = boot("?a=patriot_launcher*1&b=ah64_apache*2&n=1v2&arena=dunes&auto=1&probe=0");
    if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
    realBoom(W);
    await settle();
    run(W, 0.5);
    const B = W.sb.__battle, wrap = W.CBZ.vehicleDrive.wrap;
    const p = B.roster().find((m) => m.unitId === "patriot_launcher");
    check(!!p && !p.group.userData.standIn && !!(p.rig && p.rig.isPatriot), "built by its own file (tractor, articulated trailer, M903)");
    if (!p) return;
    const foe = B.roster().filter((m) => m.team !== p.team);
    const fx = foe.reduce((s, m) => s + m.pos.x, 0) / foe.length, fz = foe.reduce((s, m) => s + m.pos.z, 0) / foe.length;
    const tail = Math.abs(wrap(p.h - Math.atan2(p.pos.x - fx, p.pos.z - fz)));
    check(tail < 0.6 && p.rig.jack >= 1 && p.rig.elev > 0.6, "it opens emplaced, tail to the threat (nose " + tail.toFixed(2) + " rad off straight away from it; jacks " + p.rig.jack + ", launcher " + (p.rig.elev * 180 / Math.PI).toFixed(0) + " deg)");
    const x0 = p.pos.x, z0 = p.pos.z;
    const bad = [];
    let fired = 0;
    const fire0 = p.rig.fire;
    p.rig.fire = function (shot) {
      if (shot.kind === "sam") {
        fired++;
        if (!(this.jack >= 1 && this.elev > 0.6 && p.speed < 0.5 && Math.abs(wrap(this.travWant - this.trav)) < 0.06)) bad.push("jack " + this.jack.toFixed(2) + " elev " + this.elev.toFixed(2) + " v " + p.speed.toFixed(1));
      }
      return fire0.apply(this, arguments);
    };
    run(W, 240, () => true);
    const moved = Math.hypot(p.pos.x - x0, p.pos.z - z0);
    const ap = B.roster().filter((m) => m.unitId === "ah64_apache");
    console.log("    (" + fired + " PAC-3 launched, " + p.kills + " kills, moved " + Math.round(moved) + " m, Apaches down " + ap.filter((m) => m.dead).length + ", launcher " + (p.dead ? "knocked out" : "alive, hp " + Math.round(p.hp)) + ")");
    check(moved < 30, "it held its site instead of driving at the helicopters (" + Math.round(moved) + " m)");
    check(fired > 0 && bad.length === 0, "PAC-3s left only an emplaced, slewed, still launcher (" + fired + " launched" + (bad.length ? ", " + bad.slice(0, 2).join("; ") : "") + ")");
    check(ap.some((m) => m.dead), "and an Apache came down (" + ap.filter((m) => m.dead).length + " of 2)");
    // the trailer's kinematics: a steady turn settles at the real hitch angle
    const r = p.rig, phi0 = r.phi;
    r.phi = 0;
    for (let i = 0; i < 600; i++) r.stepTrailer(1 / 60, 5, 0.3, null);
    const want = Math.asin((0.3 * (1.45 - 1.34) - 0.3 * 8.2) / 5);
    check(Math.abs(r.phi - want) < 0.08, "in a steady turn the trailer settles at its hitch angle (" + r.phi.toFixed(2) + " v " + want.toFixed(2) + " rad)");
    r.phi = phi0;
  }
  {
    const W = boot("?a=patriot_launcher*1&b=men&n=1v8&arena=dunes&bw=ak47&auto=1&probe=0");
    if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
    realBoom(W);
    await settle();
    run(W, 0.5);
    const B = W.sb.__battle;
    const p = B.roster().find((m) => m.unitId === "patriot_launcher");
    if (!p) { check(false, "the Patriot is on the field"); return; }
    const x0 = p.pos.x, z0 = p.pos.z;
    let movedJacked = 0, stowed = false;
    const samN = () => p.wpn.filter((W0) => W0.w.kind === "sam").reduce((s, W0) => s + W0.n, 0);
    const sams = samN();
    run(W, 90, () => {
      if (!p.dead && p.rig.jack > 0.02 && p.speed > 0.8) movedJacked++;
      if (!p.dead && p.rig.jack === 0 && p.rig.elev === 0) stowed = true;
      return true;
    });
    const moved = Math.hypot(p.pos.x - x0, p.pos.z - z0);
    console.log("    (v riflemen: moved " + Math.round(moved) + " m, mode " + (p.rig.ai && p.rig.ai.mode) + ", .50 rounds " + p.wpn[1].n + ", " + (p.dead ? "knocked out" : "hp " + Math.round(p.hp)) + ")");
    check(stowed && moved > 60 && movedJacked === 0, "riflemen inside 450 m: it march-ordered (launcher down, jacks up) and only then drove off (" + Math.round(moved) + " m, " + movedJacked + " steps moving jacked)");
    check(samN() === sams, "no interceptor was wasted on men");
  }
});

scenario(9, "sides, best-of, the URL matchup: no colour on screen", async () => {
  const W = boot("?a=men&b=men&n=20v12&arena=dunes&aw=ak47&bw=ak47&at=elite&bt=thug&af=kesh&bf=veridia&bo=3&sa=1&sb=0&auto=1&probe=0");
  if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
  await settle();
  const a0 = W.B().audit();
  check(a0.started && a0.map === "dunes", "a b n arena booted the war on the dunes");
  check(G(W, "SET").redN === 20 && G(W, "SET").blueN === 12 && G(W, "SET").redT === "elite" && G(W, "SET").blueT === "thug",
    "n=20v12, at/bt read (" + G(W, "SET").redN + " v " + G(W, "SET").blueN + ", " + G(W, "SET").redT + "/" + G(W, "SET").blueT + ")");
  check(G(W, "TEAMS").red.name === "20 SOLDIERS" && G(W, "TEAMS").blue.name === "12 MEN",
    "the sides are named by what is on them (" + G(W, "TEAMS").red.name + " v " + G(W, "TEAMS").blue.name + ")");
  check(G(W, "SIDES").red.nation === "kesh" && G(W, "SIDES").blue.nation === "veridia", "each army fights for its nation (af/bf)");
  const a = run(W, 300);
  check(a.over && !!a.winner, "the round ended (" + a.simT + " s, " + a.winner + ")");
  const endT = W.doc.getElementById("endT").textContent;
  check(endT === (a.winner === "red" ? "20 SOLDIERS WIN" : "12 MEN WIN"), "the end card names the winner (" + endT + ")");
  const ser = W.doc.getElementById("endSeries").textContent;
  check(/^BEST OF 3/.test(ser), "the card carries the series (" + ser + ")");
  const won = a.winner === "red";
  check(W.doc.getElementById("endAgain").textContent === (won ? "REMATCH" : "NEXT ROUND"),
    "1-0 up in a best of 3: a win takes the series, a loss plays another round (" + W.doc.getElementById("endAgain").textContent + ")");
  W.doc.getElementById("endAgain").click();
  const href = String(W.sb.location.href);
  check(won ? !/sa=/.test(href) : /bo=3/.test(href) && /sa=1/.test(href) && /sb=1/.test(href), "the next URL carries the score (" + href + ")");
  // nothing a player reads says red or blue
  const seen = [];
  for (const id of Object.keys(W.doc._byId)) {
    const e = W.doc._byId[id];
    // the species lists say RED FOX, which is a fox: option rows are names, not sides
    const t = (String(e.textContent || "") + " " + String(e._html || "")).replace(/<option[^>]*>[^<]*<\/option>/g, "");
    if (/\b(RED|BLUE)\b/i.test(t.replace(/class="[^"]*"/g, "").replace(/data-[a-z]+="[^"]*"/g, ""))) seen.push(id + ": " + t.slice(0, 60));
  }
  check(seen.length === 0, "no RED / BLUE in any text the page wrote (" + JSON.stringify(seen) + ")");
  // two sides that say the same thing are told apart by their nations
  const W2 = boot("?a=men&b=men&n=30v30&at=elite&bt=elite&af=solara&bf=mbeya&auto=1&probe=0");
  if (W2.err) { check(false, "page threw at boot: " + W2.err); return; }
  await settle();
  check(G(W2, "TEAMS").red.name !== G(W2, "TEAMS").blue.name, "30 soldiers v 30 soldiers: named by nation (" + G(W2, "TEAMS").red.name + " v " + G(W2, "TEAMS").blue.name + ")");
  // the counted roster grammar
  const R = W2.CBZ.battleRoster;
  check(R.size("m1_abrams*3,men*20") === 23 && R.kindAt("m1_abrams*3,men*20", 2) === "m1_abrams" && R.kindAt("m1_abrams*3,men*20", 3) === "men" &&
    R.kindAt("men|dolphin", 3) === "dolphin", "roster grammar: counted and alternating");
  const S = W2.CBZ.battleSeries;
  const s1 = S.record(S.make(5, 1, 1), "red"), s2 = S.record(s1, "red");
  check(!s1.over && s1.a === 2 && s2.over && s2.winner === "red" && S.record(S.make(3, 0, 0), null).round === 1,
    "series: best of 5 goes to 3, a draw replays the round");
});

for (const s of scen) {
  if (only && s.n !== only) continue;
  console.log(s.n + "  " + s.name);
  try { await s.fn(); } catch (e) { fails++; console.log("  FAIL threw: " + (e && e.stack || e)); }
}
console.log("\n" + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);

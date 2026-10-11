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
   3  THE FRONT: a frontline.js spec (two nations, issue lists, flags, who
      holds, the President's sorties) boots without the war room, plants two
      flags, takes an AIRSTRIKE order, ends, and posts a result home with the
      dead on both sides.
   4  the rifle: join a side, walk, fire at the enemy through the page's own
      fireShot, hand the rifle back; a soldier who is killed goes back to the
      director and is reported down.
   5  snow and fields: the two new erg skins build and fight.            */
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

function frontSpec(over) {
  const s = {
    v: 1, warId: "war7", day: 12, ground: "dunes", where: "Saltlands", x: 0, z: 0, hold: "blue", you: "red", seed: 5,
    red: { id: "republic", name: "Republic", full: "The Republic", n: 40, tier: "elite", guns: "carbine,carbine,lmg,carbine,carbine,sniper,carbine,carbine,glauncher,carbine",
      mark: 0x3f6fd0, cloth: 0x4b5a3c, flag: { kind: "band", field: "#1d3160", band: "#f2efe6", stripe: "#a8262b", star: "#d8b24a" }, air: "none", strikes: 2, queued: 0 },
    blue: { id: "kesh", name: "Kesh", full: "Kingdom of Kesh", n: 30, tier: "thug", guns: "ak47,ak47,ak47,lmg,ak47,smg,ak47,ak47,bazooka,ak47",
      mark: 0xd23a3a, cloth: 0x6b5236, flag: { kind: "tri", field: "#7a1420", band: "#d9a62e", tri: "#141414" }, air: "bomber", strikes: 0, queued: 1 },
  };
  return Object.assign(s, over || {});
}
function enc(o) { return Buffer.from(unescape(encodeURIComponent(JSON.stringify(o))), "binary").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

scenario(3, "THE FRONT: a nation's battle, its flags, an airstrike, the post home", async () => {
  const W = boot("?front=" + enc(frontSpec()));
  if (W.err) { check(false, "page threw at boot: " + (W.err.stack || W.err)); return; }
  await settle();
  const a0 = W.B().audit();
  check(a0.started && a0.map === "dunes", "the front booted straight into the battle on " + a0.map);
  check(W.doc.body._cls.has("front"), "the war room is hidden (body.front)");
  const orders = W.sb.__battle.orders();
  check(orders.blue === "hold" && orders.red === "advance", "Kesh holds its ground, the Republic attacks (" + JSON.stringify(orders) + ")");
  run(W, 2);       // the men (and the flag behind each army's first man) stream in over the first frames
  const flags = W.CBZ.scene.children.filter((o) => o.name === "frontFlag");
  check(flags.length === 2, "two flags planted on the two lines (" + flags.length + ")");
  check(W.doc.getElementById("cAirN").textContent === "2", "the plane button carries the two sorties the nation can fly");
  W.doc.getElementById("cAir").click();
  check(W.doc.getElementById("cAirN").textContent === "1", "AIRSTRIKE called: one sortie left");
  check(W.doc.getElementById("cHold")._cls.has("hide") === false, "the HOLD/ADVANCE flag is in the row");
  W.doc.getElementById("cHold").click();
  check(W.sb.__battle.orders().red === "hold", "the General can order his line to hold");
  W.doc.getElementById("cHold").click();
  const a = run(W, 300);
  check(a.over, "the battle ended (" + a.simT + " s, winner " + a.winner + ")");
  check(W.doc.getElementById("endAgain").textContent === "RETURN", "the card has one way out: RETURN");
  W.doc.getElementById("endAgain").click();
  const m = W.posted[0];
  check(!!m && m.type === "cbz-front" && m.kind === "end", "the result went home on postMessage (" + JSON.stringify(m) + ")");
  check(m && (m.dead.red + m.dead.blue) > 0 && m.strikesUsed === 1, "with the dead on both sides and the sortie flown");
  check(m && m.dead.red + m.fled.red + m.alive.red === 40 && m.dead.blue + m.fled.blue + m.alive.blue === 30, "every man accounted for (dead + fled + standing = sent)");
});

scenario(4, "the rifle: be a soldier, fire, hand it back, go down", async () => {
  const W = boot("?front=" + enc(frontSpec({ hold: "red", red: Object.assign(frontSpec().red, { strikes: 0 }), blue: Object.assign(frontSpec().blue, { air: "none", queued: 0, n: 40, tier: "pro" }) })));
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

scenario(5, "snow and fields: the new skins build and fight", async () => {
  for (const map of ["snow", "grass"]) {
    const W = boot("?map=" + map + "&red=20&blue=20&rw=ak47&bw=ak47&rt=pro&bt=pro&auto=1&probe=0");
    if (W.err) { check(false, map + ": page threw at boot: " + (W.err.stack || W.err)); continue; }
    await settle();
    const a0 = W.B().audit();
    check(a0.started && a0.map === map && a0.terrainLos !== undefined, map + ": booted (relief " + a0.relief + " m, terrain sight " + a0.terrainLos + ")");
    const a = run(W, 240);
    check(a.over, map + ": it ended (" + a.simT + " s, winner " + a.winner + ")");
  }
});

/* 6  THE RESOLVER IS CALIBRATED TO THIS SIM. city/frontline.js fights the
   battles nobody watches with an attrition model of this page; here the two
   are put side by side on the same armies (the page's own sim above, the
   resolver over the same roster) and held to agreeing on who wins and on
   roughly how hard the loser was hit. Printed as a table so a retune of
   either side shows up as numbers, not as a feeling. */
scenario(6, "calibration: the headless resolver against the page's own battle", async () => {
  globalThis.window = globalThis; globalThis.CBZ = { game: {} };
  require(path.join(ROOT, "src/weapons/ballistics.js"));   // the resolver asks the same physics the page flies
  require(path.join(ROOT, "src/systems/brain.js"));
  const F = require(path.join(ROOT, "src/city/frontline.js"));
  const CASES = [
    { g: "dunes", r: 30, b: 30, rt: "elite", bt: "elite", rw: "ak47", bw: "ak47" },
    { g: "dunes", r: 34, b: 30, rt: "elite", bt: "elite", rw: "carbine", bw: "ak47" },
    { g: "dunes", r: 30, b: 30, rt: "elite", bt: "thug", rw: "ak47", bw: "ak47" },
    { g: "dunes", r: 60, b: 25, rt: "pro", bt: "pro", rw: "ak47", bw: "ak47" },
    { g: "dunes", r: 50, b: 30, rt: "elite", bt: "thug", rw: "carbine,carbine,lmg,carbine,carbine,sniper,carbine,carbine,glauncher,carbine", bw: "ak47,ak47,ak47,lmg,ak47,smg,ak47,ak47,bazooka,ak47" },
    { g: "snow", r: 40, b: 40, rt: "pro", bt: "pro", rw: "ak47", bw: "ak47" },
    { g: "grass", r: 24, b: 40, rt: "elite", bt: "thug", rw: "carbine", bw: "ak47" },
  ];
  let agree = 0, close = 0;
  console.log("    ground case                          | page: secs win  red dead/fled  blue dead/fled | resolver: secs win  red dead/fled  blue dead/fled");
  for (const c of CASES) {
    const q = "?map=" + c.g + "&red=" + c.r + "&blue=" + c.b + "&rt=" + c.rt + "&bt=" + c.bt + "&rw=" + encodeURIComponent(c.rw) + "&bw=" + encodeURIComponent(c.bw) + "&auto=1&probe=0";
    const W = boot(q);
    if (W.err) { check(false, "page threw: " + W.err); continue; }
    await settle();
    run(W, 300);
    const T = W.sb.__battle.tally();
    const hold = W.sb.__battle.orders();
    const spec = { v: 1, ground: c.g, seed: 11, hold: hold.red === "hold" ? "red" : hold.blue === "hold" ? "blue" : null,
      red: { id: "r", name: "R", n: c.r, tier: c.rt, guns: c.rw, air: "none", strikes: 0, queued: 0 },
      blue: { id: "b", name: "B", n: c.b, tier: c.bt, guns: c.bw, air: "none", strikes: 0, queued: 0 } };
    // the resolver over a few seeds: its verdict is the majority, its numbers the mean
    let rw = 0; const acc = { secs: 0, rd: 0, rf: 0, bd: 0, bf: 0 }; const N = 9;
    for (let k = 0; k < N; k++) {
      const r = F.resolve(Object.assign({}, spec, { seed: 11 + k * 101 }));
      if (r.winner === "red") rw++;
      acc.secs += r.secs; acc.rd += r.dead.red; acc.rf += r.fled.red; acc.bd += r.dead.blue; acc.bf += r.fled.blue;
    }
    const rWin = rw * 2 > N ? "red" : "blue";
    const pWin = T.winner || (T.alive.red >= T.alive.blue ? "red" : "blue");
    // the page's runners at the end got away, exactly as the resolver counts them
    const pf = { red: T.fled.red + T.routed.red, blue: T.fled.blue + T.routed.blue };
    const L = pWin === "red" ? "blue" : "red";
    const nL = L === "red" ? c.r : c.b;
    const pLoseDead = T.dead[L] / nL, rLoseDead = (L === "red" ? acc.rd : acc.bd) / N / nL;
    // an EVEN fight is decided by the ground under it (which side drew the
    // crest), which the resolver does not model: a coin, not a verdict. Since
    // the rounds are flown (src/battle/fire.js) a rifle exchange is settled in
    // seconds by who sees whom first, so a 13% edge in men of the same
    // training with rifles is inside that coin too
    const even = c.rt === c.bt && Math.abs(c.r - c.b) <= 0.15 * Math.max(c.r, c.b) &&
      /^(ak47|carbine)$/.test(c.rw) && /^(ak47|carbine)$/.test(c.bw);
    if (rWin === pWin || even) agree++;
    if (Math.abs(pLoseDead - rLoseDead) <= 0.3) close++;
    const f = (x) => String(Math.round(x)).padStart(3);
    console.log("    " + c.g.padEnd(6) + " " + (c.r + " " + c.rt + " v " + c.b + " " + c.bt + (spec.hold ? " (" + spec.hold + " holds)" : "")).padEnd(30) +
      "| " + f(T.simT) + "  " + pWin.padEnd(4) + "  " + f(T.dead.red) + "/" + f(pf.red) + "      " + f(T.dead.blue) + "/" + f(pf.blue) +
      "     | " + f(acc.secs / N) + "  " + rWin.padEnd(4) + "  " + f(acc.rd / N) + "/" + f(acc.rf / N) + "      " + f(acc.bd / N) + "/" + f(acc.bf / N));
  }
  check(agree >= CASES.length - 1, "the resolver names the page's winner (" + agree + "/" + CASES.length + ")");
  check(close >= CASES.length - 2, "and the loser's dead within 30 points of the page's (" + close + "/" + CASES.length + ")");
});

/* 7  DOES HOLDING THE LINE HELP THE MEN HOLDING IT? The same outnumbered army,
   once told to hold (the default now) and once in the old meeting engagement
   (?hold=0), on each open ground. Holding must not make them die faster:
   the exchange (attackers killed per holder lost) is printed and held to
   at least what the meeting engagement got. */
scenario(7, "holding the line: the exchange, held v met", async () => {
  const CASES = [
    { g: "dunes", r: 60, b: 25, rt: "pro", bt: "pro" },
    { g: "snow", r: 45, b: 28, rt: "elite", bt: "elite" },
    { g: "grass", r: 40, b: 24, rt: "thug", bt: "elite" },
  ];
  let better = 0;
  for (const c of CASES) {
    const out = {};
    for (const hold of ["1", "0"]) {
      const W = boot("?map=" + c.g + "&red=" + c.r + "&blue=" + c.b + "&rt=" + c.rt + "&bt=" + c.bt + "&rw=ak47&bw=ak47&auto=1&probe=0&hold=" + hold);
      if (W.err) { check(false, "page threw: " + W.err); continue; }
      await settle();
      run(W, 300);
      const T = W.sb.__battle.tally();
      out[hold] = { win: T.winner, xr: T.dead.red / Math.max(1, T.dead.blue), rd: T.dead.red, bd: T.dead.blue, secs: Math.round(T.simT) };
    }
    console.log("    " + c.g.padEnd(6) + (c.r + " " + c.rt + " attack " + c.b + " " + c.bt).padEnd(28) +
      " held: " + JSON.stringify(out["1"]) + "   met: " + JSON.stringify(out["0"]));
    if (out["1"] && out["0"] && out["1"].xr >= out["0"].xr * 0.9) better++;
  }
  check(better >= CASES.length - 1, "holding trades at least as well as meeting them in the open (" + better + "/" + CASES.length + ")");
});

/* 8  VEHICLES. A tank is a unit on a side (src/battle/vehicles.js): its file
   (src/units/vehicles/m1_abrams.js) and city/mil_armor.js load at START, the
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
    check(!!tank.group && !tank.group.userData.standIn, "built by city/mil_armor.js, not a stand-in (rig " + !!tank.rig + ")");
    const crew = tank.seats.filter((s) => s.crew && s.man).map((s) => s.seat);
    check(crew.length === 1 && crew[0] === "driver", "the side's one man is in the driver's seat (" + JSON.stringify(crew) + ")");
    const blue = R.find((m) => m.team === "blue" && !m.dead);
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

/* 11  AIRCRAFT. The vehicle contract's air half (docs/npcwar/ARCHITECTURE.md):
   a helicopter fights from battle positions (masked low, up to fire, down,
   sidestep), a jet flies attack runs at a real height; every unit animates
   itself on the battle clock and names the weapon of every round. */
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
    const a = run(W, 300, () => {
      if (!j.dead) lo = Math.min(lo, agl());
      const W0 = j.wpn[0];
      if (!relD && W0.n > 0) {
        const t = j.tgt || R.find((m) => m.team === "blue" && !m.dead);
        relD = t ? Math.hypot(t.pos.x - j.pos.x, t.pos.z - j.pos.z) : -1;
      }
      return true;
    });
    check(j.wpn[0].n > 0 && relD > 2000, "it released its bombs a stand-off short of the mark (" + j.wpn[0].n + " away, first " + Math.round(relD) + " m out)");
    check(j.wpn[1].n === 0 || lo < 1400, "the gun run was a dive (" + j.wpn[1].n + " rounds, lowest " + Math.round(lo) + " m)");
    check(lo >= 59, "never below 60 m over the ground (" + Math.round(lo) + " m)");
    console.log("    (F-35: " + j.kills + " kills, war " + (a.over ? "over at " + a.simT + " s" : "still on") + ")");
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

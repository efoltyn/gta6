// tools/brain-sim-city.mjs — CITY STREET ROUTER scenarios for CBZ.brain.
//
// Plain node, no browser: loads the REAL systems/brain.js + systems/casttraits.js
// + city/brain_city.js against fake street bodies (the duck-typed fields
// peds.js's move()/think() read), and checks what the street must now do:
//   1. a shooting in a crowd of 12 — witnesses by sight, staggered reactions
//      (no same-frame flip), a mix of flee / film / cower / report, calls
//      that LAND through social.onReport("city") a few seconds later, and
//      one runner sets others running (panic contagion through morale).
//   2. gang retaliation is PROPORTIONAL — a shove gets glares/shoves, never a
//      gun; gunfire gets fists-or-guns; a "fists" man keeps his gun holstered.
//   3. a crew ROUTS when its leader drops (brain morale), and does not when a
//      single foot soldier does.
//   4. gang standing round-trips through brain.rep.
//
//   node tools/brain-sim-city.mjs          exit 0 = all pass
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ---- a fake world ---------------------------------------------------------
const UPD = [];
globalThis.window = {
  CBZ: {
    game: { mode: "city", elapsed: 0, state: "playing" },
    onUpdate: (order, fn) => UPD.push(fn),
    CITY: { aggro: { flee: 0.3, bold: 0.5, crook: 0.72, violent: 0.88 } },
  },
};
const CBZ = globalThis.window.CBZ;
require(path.join(ROOT, "src/systems/brain.js"));
require(path.join(ROOT, "src/systems/casttraits.js"));
require(path.join(ROOT, "src/city/brain_city.js"));
const B = CBZ.brain, CB = CBZ.cityBrain;
B.seed(1234);

let fails = 0;
function check(name, ok, detail) {
  console.log((ok ? "  PASS " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
  if (!ok) fails++;
}

function vec(x, z) { return { x, y: 0, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; } }; }
function mkPed(name, x, z, o) {
  const pos = vec(x, z);
  return Object.assign({
    name, pos, group: { position: pos, rotation: { y: 0 } }, target: vec(x, z),
    aggr: 0.3, hp: 100, maxHp: 100, state: "walk", kind: "civilian", snitch: 0.3, wealth: 0.5,
    fear: 0, alarmed: 0, dead: false, ko: 0, speed: 1, baseSpeed: 1.5, pause: 0, armed: false, weapon: null,
    _log: [],
  }, o || {});
}
const player = { name: "PLAYER", isPlayer: true, pos: vec(0, 0), group: { position: null, rotation: { y: 0 } }, dead: false };
player.group.position = player.pos;
CBZ.player = player;
CBZ.city = { playerActor: player, note() {} };
CBZ.cityCops = [];
CBZ.cityHasGun = () => true;
// the panic field (peds.js's, verbatim shape)
const PANIC = [];
CBZ.cityPanicRaise = (x, z, a) => { PANIC.push({ x, z, a: a || 1, t: 0 }); if (PANIC.length > 32) PANIC.shift(); };
CBZ.cityPanicAt = (x, z) => { let s = 0; for (const p of PANIC) { const d = Math.hypot(p.x - x, p.z - z); if (d > 26) continue; s += p.a * (1 - d / 26) * Math.max(0, 1 - p.t / 7); } return Math.min(2.5, s); };
function panicDecay(dt) { for (let i = PANIC.length - 1; i >= 0; i--) { PANIC[i].t += dt; if (PANIC[i].t > 7) PANIC.splice(i, 1); } }
CBZ.cityFleeFrom = (p, x, z) => { p.state = "flee"; const dx = p.pos.x - x, dz = p.pos.z - z, d = Math.hypot(dx, dz) || 1; p.target.set(p.pos.x + dx / d * 20, 0, p.pos.z + dz / d * 20); };
CBZ.cityMarkGunpoint = (p) => { if (p.armed) return false; p.surrender = true; p.state = "surrender"; return true; };
CBZ.cityEndReportVisual = (p) => { p.reportState = null; p.reportTarget = null; p.reportT = 0; };
CBZ.citySay = (p, line) => { p._log.push(line); };

function step(peds, dt, ctx) {
  CBZ.game.elapsed += dt;
  panicDecay(dt);
  for (const f of UPD) f(dt);
  for (const p of peds) {
    if (p.dead) continue;
    // move: fleeing bodies actually open distance (so a caller can get clear)
    if (p.state === "flee") { const dx = p.target.x - p.pos.x, dz = p.target.z - p.pos.z, d = Math.hypot(dx, dz); if (d > 0.3) { p.pos.x += dx / d * 3.3 * dt; p.pos.z += dz / d * 3.3 * dt; } }
    if (p.alarmed > 0) p.alarmed -= dt;
    CB.think(p, dt, ctx);
  }
}

// ============================================================
console.log("\n[1] a shooting in a crowd of 12");
{
  B.reset(); CBZ.game.elapsed = 100;
  const peds = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, r = 5 + (i % 4) * 6;
    const p = mkPed("Civ" + i + "_" + ["Ana", "Bo", "Cy", "Dee"][i % 4], Math.sin(a) * r, Math.cos(a) * r, {
      aggr: 0.15 + (i % 5) * 0.12, snitch: i % 3 === 0 ? 0.8 : 0.3, cliqueId: i < 4 ? "A" : null,
    });
    // 9 of 12 face the shooter; 3 face away (they only HEAR it)
    p.group.rotation.y = Math.atan2(-p.pos.x, -p.pos.z) + (i % 4 === 3 ? Math.PI : 0);
    peds.push(p);
  }
  CBZ.cityPeds = peds;
  const reports = [];
  B.social.onReport("city", (r) => reports.push({ t: B.now(), r }));
  for (const f of UPD) f(0.016);                 // the clock + executor + subscription
  const t0 = B.now();
  const nW = CB.crime("shots-fired", 0, 0, player, 250);
  const heard = CB.hearBang(0, 0, 36, "gunshot", player);
  check("witnesses chosen by sight/hearing", nW >= 8, nW + " witnesses, " + heard + " heard the shot");
  const first = new Map(), resp = {};
  const ctx = { playerArmed: true, dpl: 99 };
  for (let k = 0; k < 400; k++) {                // 20 s at 20 Hz
    step(peds, 0.05, ctx);
    for (const p of peds) {
      if (!first.has(p) && p._cbResp) { first.set(p, B.now() - t0); resp[p._cbResp] = (resp[p._cbResp] || 0) + 1; }
    }
  }
  const times = [...first.values()].sort((a, b) => a - b);
  const uniq = new Set(times.map((t) => t.toFixed(2))).size;
  check("everybody reacted", first.size >= 10, first.size + "/12");
  check("staggered, not same-frame", uniq >= Math.ceil(first.size / 2) && times[times.length - 1] - times[0] > 0.4,
    "first " + times[0].toFixed(2) + "s .. last " + times[times.length - 1].toFixed(2) + "s, " + uniq + " distinct instants");
  check("nobody reacts on the shot's own frame", times[0] >= 0.05, "earliest " + times[0].toFixed(2) + "s");
  const kinds = Object.keys(resp);
  check("a mix of responses", kinds.length >= 2 && (resp.flee || 0) >= 1, JSON.stringify(resp));
  check("reports arrive", reports.length >= 1, reports.length + " calls landed");
  const lag = reports.length ? Math.min(...reports.map((x) => x.t - t0)) : 0;
  check("…after a real delay (dialling, getting clear)", lag >= 2.5, "first call landed at +" + lag.toFixed(1) + "s");
  check("…and the player is the one reported", reports.every((x) => x.r.perp === player || x.r.perp == null));
  // contagion: a bystander OUTSIDE sight/hearing of the crime, standing where
  // the runners run past, is rattled by the panic field
  const late = mkPed("Late_Joe", 30, 0, { aggr: 0.2 });
  late.group.rotation.y = Math.PI / 2;
  peds.push(late);
  CB.adopt(late);
  const r0 = late._brain.rattle;
  CBZ.cityPanicRaise(29, 0, 1); CBZ.cityPanicRaise(31, 1, 1);
  CB.respond(late, null, 29, 0, true, false, "panic");
  check("one runner sets others running (panic → rattle)", late._brain.rattle > r0, "rattle " + r0.toFixed(2) + " → " + late._brain.rattle.toFixed(2));
}

// ============================================================
console.log("\n[2] gang retaliation is proportional");
{
  B.reset(); CBZ.game.elapsed = 300;
  const gang = { id: "g1", members: [], boss: null, standing: 0 };
  CBZ.cityGangs = [gang];
  CBZ.cityGangById = (id) => (id === "g1" ? gang : null);
  function crew(prefix) {
    const out = [];
    for (let i = 0; i < 6; i++) {
      const m = mkPed(prefix + i + "_" + ["Rico", "Tee", "Dre", "Mo", "Lil", "Jay"][i], 2 + (i % 3) * 2, (i < 3 ? 1 : 4), {
        gang: "g1", kind: "gang", aggr: 0.55 + i * 0.07, armed: true, weapon: "Pistol", ammo: 30, behavior: "hothead",
      });
      out.push(m);
    }
    return out;
  }
  const lvl = (list) => { const c = {}; for (const e of list || []) c[e.level] = (c[e.level] || 0) + 1; return c; };
  // a shove (harm 0.15)
  let m = crew("S"); gang.members = m; CBZ.cityPeds = m; for (const p of m) CB.adopt(p);
  CBZ.cityHasGun = () => false;
  const slap = lvl(CB.retaliate(m[0], player, 0.15));
  check("a shove never gets a gun or a fist", !slap.weapon && !slap.fight, JSON.stringify(slap));
  check("…and nobody pulled a weapon out", m.every((p) => !p.rage));
  // a beating (harm 0.5) → at most fists, and the fists men holster
  B.reset(); m = crew("F"); gang.members = m; CBZ.cityPeds = m; for (const p of m) CB.adopt(p);
  const beat = lvl(CB.retaliate(m[0], player, 0.5));
  check("a beating gets at most fists", !beat.weapon && (beat.fight || beat.shove || beat.glare), JSON.stringify(beat));
  const fists = m.filter((p) => p.rage === player);
  check("…fists men keep the gun holstered", fists.length === 0 || fists.every((p) => !p.armed && p._holster), fists.length + " swinging");
  // the player draws: the holstered men draw too
  CBZ.cityHasGun = () => true;
  for (const f of UPD) f(0.05);
  check("…and draw the moment it stops being a fist fight", fists.every((p) => p.armed && !p._holster));
  // gunfire (harm 0.95) → guns
  B.reset(); m = crew("G"); gang.members = m; CBZ.cityPeds = m; for (const p of m) CB.adopt(p);
  for (const p of m) B.memory.grudge(p, player, 0.5);
  const shot = lvl(CB.retaliate(m[0], player, 0.95));
  check("gunfire gets guns", (shot.weapon || 0) >= 1, JSON.stringify(shot));
}

// ============================================================
console.log("\n[3] a crew routs when its leader drops");
{
  function setup(tag) {
    B.reset(); CBZ.game.elapsed = 500;
    const gang = { id: "r" + tag, members: [], boss: null };
    CBZ.cityGangs = [gang];
    CBZ.cityGangById = (id) => (id === gang.id ? gang : null);
    const m = [];
    for (let i = 0; i < 7; i++) {
      const p = mkPed(tag + i + "_" + ["Boss", "Kay", "Vee", "Omar", "Zed", "Pip", "Nate"][i], (i % 4) * 2.5, Math.floor(i / 4) * 2.5, {
        gang: gang.id, kind: "gang", aggr: 0.6, armed: true, weapon: "Pistol",
        isBoss: i === 0, rank: i === 0 ? "boss" : i === 1 ? "lt" : "soldier",
      });
      m.push(p);
    }
    gang.boss = m[0]; gang.members = m;
    CBZ.cityPeds = m;
    for (const p of m) CB.adopt(p);
    return m;
  }
  function kill(p) { p.dead = true; p.hp = 0; CB.memberDown(p); }
  function brokenAfter(m, secs) { for (let k = 0; k < secs * 20; k++) { CBZ.game.elapsed += 0.05; B.morale.tick(0.05); } return m.filter((p) => !p.dead && CB.broken(p)).length; }
  // control: one foot soldier drops
  let m = setup("C");
  kill(m[6]);
  const ctrl = brokenAfter(m, 0.5);
  check("one foot soldier down: the set holds", ctrl <= 1, ctrl + "/6 broken, set morale " + B.morale.group("gang:rC").morale.toFixed(2));
  // the boss AND his lieutenant drop
  m = setup("L");
  kill(m[0]); kill(m[1]);
  const brk = brokenAfter(m, 0.5);
  check("the leader drops: the crew routs", brk >= 3, brk + "/5 broken, set morale " + B.morale.group("gang:rL").morale.toFixed(2));
  check("…the rout reads through threat.respond as flight", m.filter((p) => !p.dead && CB.broken(p)).every((p) => CB.respond(p, player, 0, 0, true, false, "armed") === "flee"));
}

// ============================================================
console.log("\n[4] gang standing is brain.rep");
{
  B.reset();
  const gang = { id: "s1", members: [], standing: 0 };
  CBZ.cityGangs = [gang];
  CB.addStanding("s1", 30);
  check("+30 standing = respect", CB.standing("s1") === 30 && Math.abs(B.rep.get("gang:s1").respect - 0.3) < 1e-9);
  CB.addStanding("s1", -50);
  check("-50 spends respect, then builds hostility", CB.standing("s1") === -20 && B.rep.get("gang:s1").hostility > 0.19, JSON.stringify(B.rep.get("gang:s1")));
  gang.standing = 40; gang._repStanding = -20;   // a loaded save
  CB.syncFactions();
  check("a loaded gang.standing folds back into rep", CB.standing("s1") === 40 && gang.standing === 40);
}

console.log(fails ? "\n" + fails + " FAILED" : "\nall city street scenarios pass");
process.exit(fails ? 1 : 0);

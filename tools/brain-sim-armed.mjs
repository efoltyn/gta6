#!/usr/bin/env node
/* tools/brain-sim-armed.mjs — THE OWNER'S BUG AS A TEST.

   Owner, 2026-09-27: "I get a keycard, go into the jail room, get guns, and
   EVERYBODY charges me while I'm shooting. Not everybody should be charging
   at me. That's stupid logic... unless they had a gun. Or short range, if they
   have a knife, maybe they'll come at me if they're already close."

   Plain node, the real CBZ.brain (src/systems/brain.js) and the real prison
   router (src/systems/brain_prison.js), a trivial kinematic mover. Scenarios:

     1  a room: a shooter with a gun, 20 unarmed inmates (hard men and grudges
        included), 2 with guns, 1 with a shank at 3 m. 10 s of shooting, a
        reload in the middle. No unarmed man closes in; the guns go to cover
        and then engage from where they are; the shank comes only inside
        3.5 m while the gun is being reloaded; nobody flips flee<->fight.
     2  a gunshot in a crowd: every unarmed body moves AWAY from it, and no
        unarmed body walks over to look.
     3  retaliation against a gunman: unarmed cliquemates AVOID (grudge kept),
        a gun answers with the gun, a blade only in its window.
     4  the PRISON path: men set on the player (huntPlayer, as provokeGang /
        answerFor / a snub leave them) meet the gate in brain_prison.js —
        nobody walks at the muzzle, a man hides in an open cell behind him,
        the shank man hunts only during the reload; a player gunshot
        scatters the yard away from it.
     5  the same rule through the old paths with no gun out: fists still
        answer fists (nothing about an unarmed fight changed).

     node tools/brain-sim-armed.mjs        # all
     node tools/brain-sim-armed.mjs 4      # one scenario
*/
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let rs = 4242;
function rand() { rs = (rs * 1103515245 + 12345) >>> 0; return (rs >>> 8) / 16777216; }

const player = { pos: { x: 0, y: 0, z: 0 }, dead: false };
let GUN = { key: "pistol", nonlethal: false };             // what CBZ.currentGun() hands back
const CBZ = {
  game: { mode: "escape", state: "playing", elapsed: 0, detection: 0 },
  player, npcs: [], guards: [],
  econ: { rng: rand },
  fps: { reloading: 0 },
  currentGun() { return GUN; },
  fpsHasWeapon() { return !!GUN; },
  isAimingWeapon() { return false; },
  prisonSay() { return true; },
  npcStare(a) { a._stared = (a._stared || 0) + 1; },
  npcAvert() {},
  prisonLawCount() {},
  guardWalkTo() {}, guardFaceTo() {}, guardIdle() {}, guardLookAt() {},
  cellblock: { cells: [] },
};
let playerYaw = 0;
CBZ.playerChar = { group: { rotation: { get y() { return playerYaw; } } } };
globalThis.window = { CBZ };
const B = require(path.join(ROOT, "src/systems/brain.js"));
const PB = require(path.join(ROOT, "src/systems/brain_prison.js"));

let fails = 0, passes = 0;
function check(ok, msg) {
  if (ok) { passes++; console.log("  PASS " + msg); }
  else { fails++; console.log("  FAIL " + msg); }
}
const scenarios = [];
function scenario(n, name, fn) { scenarios.push({ n, name, fn }); }

function actor(x, z, yaw, extra) { return Object.assign({ pos: { x, y: 0, z }, yaw: yaw || 0, hp: 100, maxHp: 100 }, extra || {}); }
function fresh(seed) {
  B.reset(); B.seed(seed || 7); rs = seed || 4242;
  CBZ.game.elapsed = 0; B.clock(0);
  CBZ.npcs.length = 0; CBZ.guards.length = 0; CBZ.cellblock.cells.length = 0;
  CBZ.fps.reloading = 0; GUN = { key: "pistol", nonlethal: false }; playerYaw = 0;
  player.pos.x = 0; player.pos.z = 0;
  PB.reset(); PB.tick(1 / 60);
}
let T = 0;
function advance(dt) { T += dt; CBZ.game.elapsed = T; B.clock(T); }
const FIGHT = (r) => r === "fight";
const YIELD = (r) => r === "flee" || r === "freeze" || r === "surrender";
function flips(hist) {
  let n = 0, last = null;
  for (const r of hist) {
    if (FIGHT(r) || YIELD(r)) {
      if (last && ((FIGHT(last) && YIELD(r)) || (YIELD(last) && FIGHT(r)))) n++;
      last = r;
    }
  }
  return n;
}
function dist(a, b) { return Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z); }
const ROOM = 15;   // the gun room is 30 x 30 m, the shooter at its centre
function clampRoom(a) { a.pos.x = Math.max(-ROOM, Math.min(ROOM, a.pos.x)); a.pos.z = Math.max(-ROOM, Math.min(ROOM, a.pos.z)); }

// =========================================================================
scenario(1, "a gun room: 20 unarmed + 2 guns + 1 shank vs a shooter, 10 s with a reload", function () {
  fresh(11); T = 0;
  const shooter = actor(0, 0, 0, { isPlayer: true });
  const blade = actor(0.4, 3.0, Math.PI, { weapon: "Shiv", armed: false });     // right in front of the muzzle
  B.register(blade, "inmate", { game: "sim", clique: "reds", personality: { courage: 0.85, aggression: 0.9, discipline: 0.3, curiosity: 0.5, loyalty: 0.8 } });
  const guns = [actor(6, 8, Math.PI, { armed: true, weapon: "Pistol" }), actor(-7, 5, Math.PI, { armed: true, weapon: "Pistol" })];
  for (const g of guns) B.register(g, "inmate", { game: "sim", clique: "reds" });
  const men = [];
  for (let i = 0; i < 20; i++) {
    const ang = (i / 20) * Math.PI * 2 + 0.13, r = 2.5 + (i % 5) * 2.4;
    const a = actor(Math.sin(ang) * r, Math.cos(ang) * r, ang + Math.PI, { armed: false });
    // the hard cases too: max aggression, max courage, a clique and a grudge
    const hard = i % 4 === 0;
    B.register(a, "inmate", { game: "sim", clique: i % 2 ? "reds" : "blues",
      personality: hard ? { courage: 1, aggression: 1, discipline: 0.1, curiosity: 0.5, loyalty: 1 } : undefined });
    B.memory.grudge(a, shooter, hard ? 1 : 0.3);
    men.push(a);
  }
  const everyone = men.concat(guns, [blade]);
  const d0 = new Map(everyone.map((a) => [a, dist(a, shooter)]));
  const hist = new Map(everyone.map((a) => [a, []]));
  const hows = new Map(everyone.map((a) => [a, []]));
  const th = { source: shooter, x: 0, z: 0, weapon: "gun", reloading: false, yaw: 0, aimingAtMe: false, distance: null, kind: "armed", armed: true };
  let rushAt = null, rushD = null, rushReload = null;
  let worstClose = 0, worstMan = -1, frozeOpen = 0;
  const dt = 0.05;
  for (let f = 0; f < 200; f++) {
    advance(dt);
    const t = T;
    // the shooter: faces the blade and fires; reloads 4..6 s, facing him still
    th.reloading = t >= 4 && t < 6;
    CBZ.fps.reloading = th.reloading ? 1 : 0;
    playerYaw = Math.atan2(blade.pos.x, blade.pos.z);
    th.yaw = playerYaw;
    if (!th.reloading && f % 10 === 0) B.perception.noise(0, 0, 48, "gunshot", shooter);
    for (const a of everyone) {
      if (f % 2 === 0) {
        th.distance = null;
        const p = a.pos;
        th.cornered = Math.abs(p.x) >= ROOM - 0.3 && Math.abs(p.z) >= ROOM - 0.3;
        const r = B.threat.respond(a, th);
        hist.get(a).push(r); hows.get(a).push(B.threat.how(a));
        if (r === "freeze" && !th.cornered) frozeOpen++;
      }
      const r = hist.get(a)[hist.get(a).length - 1], how = hows.get(a)[hows.get(a).length - 1];
      const dx = a.pos.x - shooter.pos.x, dz = a.pos.z - shooter.pos.z, L = Math.hypot(dx, dz) || 1;
      if (r === "flee") { a.pos.x += dx / L * 4 * dt; a.pos.z += dz / L * 4 * dt; }
      else if (r === "fight" && how === "rush") {
        if (rushAt == null) { rushAt = t; rushD = L; rushReload = th.reloading; }
        const s = Math.min(L - 0.6, 6 * dt); if (s > 0) { a.pos.x -= dx / L * s; a.pos.z -= dz / L * s; }
      }
      clampRoom(a);
    }
    for (let i = 0; i < men.length; i++) {
      const close = d0.get(men[i]) - dist(men[i], shooter);
      if (close > worstClose) { worstClose = close; worstMan = i; }
    }
  }
  const tally = {};
  for (const a of men) { const r = hist.get(a)[hist.get(a).length - 1] + "/" + hows.get(a)[hows.get(a).length - 1]; tally[r] = (tally[r] || 0) + 1; }
  console.log("    unarmed end states: " + JSON.stringify(tally) + " (the frozen ones ran into the corners of the room)");
  check(frozeOpen === 0, "a man freezes only once he is cornered (" + frozeOpen + " froze in the open)");
  check(worstClose <= 0.25, "no unarmed man closed in on the gun (worst: " + worstClose.toFixed(2) + " m" + (worstMan >= 0 ? ", man " + worstMan : "") + ")");
  check(men.every((a) => !hist.get(a).includes("fight")), "no unarmed man ever chose to fight a gunman (hard men and grudges included)");
  for (const [i, g] of guns.entries()) {
    const h = hist.get(g), firstFight = h.indexOf("fight");
    check(h[0] === "cover" && firstFight > 0 && h.slice(0, firstFight).every((r) => r === "cover"), "gun " + i + ": cover first (" + h.slice(0, firstFight).length + " decisions), then engage");
    check(hows.get(g)[firstFight] === "engage" && Math.abs(dist(g, shooter) - d0.get(g)) < 1e-9, "gun " + i + ": engages from where it is (did not move: " + dist(g, shooter).toFixed(2) + " m)");
  }
  const bh = hist.get(blade);
  check(rushAt != null && rushAt >= 4 && rushReload === true && rushD <= 3.5, "the shank comes only inside 3.5 m while the gun is reloading (rush at " + (rushAt == null ? "never" : rushAt.toFixed(2) + " s, " + rushD.toFixed(2) + " m") + ")");
  check(bh.slice(0, Math.floor(4 / 0.1) - 1).every((r) => r !== "fight"), "…and not before, with the gun on him (" + [...new Set(bh.slice(0, 38).map((r, k) => r + "/" + hows.get(blade)[k]))].join(", ") + ")");
  const flipN = everyone.map((a) => flips(hist.get(a)));
  check(flipN.every((n) => n === 0), "nobody flip-flops between flee and fight (" + flipN.reduce((s, n) => s + n, 0) + " flips)");
  const changes = men.map((a) => { let c = 0; const h = hist.get(a); for (let k = 1; k < h.length; k++) if (h[k] !== h[k - 1]) c++; return c; });
  check(Math.max(...changes) <= 3, "unarmed decisions are steady (max " + Math.max(...changes) + " changes in 10 s)");
});

// =========================================================================
scenario(2, "a gunshot in a crowd: every unarmed body moves AWAY, nobody unarmed goes to look", function () {
  fresh(21); T = 0;
  const crowd = [];
  for (let i = 0; i < 40; i++) {
    const ang = (i / 40) * Math.PI * 2, r = 3 + (i % 6) * 2.2;
    const a = actor(10 + Math.sin(ang) * r, 10 + Math.cos(ang) * r, rand() * 6.28);
    B.register(a, i % 2 ? "civilian" : "inmate", { game: "sim", personality: { courage: rand(), aggression: rand(), discipline: rand(), curiosity: 0.9, loyalty: rand() } });
    crowd.push(a);
  }
  const cops = [actor(22, 10, -Math.PI / 2), actor(10, -4, 0)];
  for (const c of cops) B.register(c, "cop", { game: "sim", personality: { courage: 0.8, aggression: 0.4, discipline: 0.8, curiosity: 0.9, loyalty: 0.8 } });
  const d0 = crowd.map((a) => Math.hypot(a.pos.x - 10, a.pos.z - 10));
  advance(0.05);
  B.perception.noise(10, 10, 48, "gunshot", null);
  const looked = new Set(), copLooked = new Set();
  for (let f = 0; f < 160; f++) {           // 8 s: past the 3 s scare into the memory window
    advance(0.05);
    for (const a of crowd.concat(cops)) {
      const I = B.tick(a, 0.05, {});
      if (I.kind === "investigate") (cops.includes(a) ? copLooked : looked).add(a);
      if (I.speed > 0 && I.kind !== "investigate") {
        const dx = I.x - a.pos.x, dz = I.z - a.pos.z, L = Math.hypot(dx, dz);
        if (L > 0.05) { const s = Math.min(L, 4 * 0.05); a.pos.x += dx / L * s; a.pos.z += dz / L * s; }
      }
    }
  }
  const d1 = crowd.map((a) => Math.hypot(a.pos.x - 10, a.pos.z - 10));
  const away = d1.filter((d, i) => d > d0[i] + 1).length, closer = d1.filter((d, i) => d < d0[i] - 0.05).length;
  check(closer === 0, "no unarmed body ended up closer to the shot (" + closer + ")");
  check(away === crowd.length, "every unarmed body moved away from it (" + away + "/" + crowd.length + ")");
  check(looked.size === 0, "no unarmed body walked over to investigate the gunfire (" + looked.size + ")");
  check(copLooked.size > 0, "armed authority does go and look (" + copLooked.size + "/2)");
});

// =========================================================================
scenario(3, "retaliation against a gunman: unarmed avoid (grudge kept), a gun answers with the gun, a blade only in its window", function () {
  fresh(31);
  const gunman = actor(0, 0, 0, { armed: true, weapon: "Pistol" });
  B.register(gunman, "inmate", { game: "sim", clique: "blues" });
  const victim = actor(0, 5, Math.PI, { armed: false });
  B.register(victim, "inmate", { game: "sim", clique: "reds" });
  const hardP = { courage: 1, aggression: 1, discipline: 0.2, curiosity: 0.5, loyalty: 1 };
  const fists = [];
  for (let i = 0; i < 5; i++) { const a = actor(-2 + i, 7, Math.PI, { armed: false }); B.register(a, "inmate", { game: "sim", clique: "reds", personality: hardP }); fists.push(a); }
  const shooterMate = actor(3, 8, Math.PI, { armed: true, weapon: "Pistol" }); B.register(shooterMate, "inmate", { game: "sim", clique: "reds", personality: hardP });
  const bladeNear = actor(0.5, 2.5, Math.PI, { weapon: "Shiv", armed: false }); B.register(bladeNear, "inmate", { game: "sim", clique: "reds", personality: hardP });
  const levelOf = (list, a) => (list.find((e) => e.actor === a) || {}).level;
  // he shoots a man dead with the gun pointed at the blade
  let list = B.social.retaliate(victim, gunman, 1, { yaw: 0, reloading: false });
  const fl = fists.map((a) => levelOf(list, a));
  check(fl.every((l) => l === "avoid"), "five hard unarmed men with max loyalty: " + fl.join(", "));
  check(fists.every((a) => B.memory.grudge(a, gunman) > 0.3), "…and every one of them now holds the grudge (" + B.memory.grudge(fists[0], gunman).toFixed(2) + ")");
  check(levelOf(list, shooterMate) === "weapon", "the man with a gun answers with it (" + levelOf(list, shooterMate) + ")");
  check(levelOf(list, bladeNear) === "avoid", "the blade at 2.5 m with the gun on him: " + levelOf(list, bladeNear));
  list = B.social.retaliate(victim, gunman, 1, { yaw: 0, reloading: true });
  check(levelOf(list, bladeNear) === "fight" || levelOf(list, bladeNear) === "weapon", "…the same blade while the gunman reloads: " + levelOf(list, bladeNear));
  // the brain's own tick plays AVOID as getting out of the line, not closing
  const I = B.tick(fists[0], 0.05, {});
  check(I.kind === "avoid" && Math.hypot(I.x, I.z) > Math.hypot(fists[0].pos.x, fists[0].pos.z), "tick plays it as stepping out of the line (" + I.kind + ")");
  // a slap from an UNARMED man is still the old proportional ladder
  const slapper = actor(0, 0, 0, { armed: false }); B.register(slapper, "inmate", { game: "sim", clique: "blues" });
  list = B.social.retaliate(victim, slapper, 0.5);
  check(list.some((e) => e.level === "fight" || e.level === "shove") && !list.some((e) => e.level === "avoid"), "an unarmed beating still gets fists (" + list.map((e) => e.level).join(",") + ")");
});

// =========================================================================
// the prison's own inmates, the way ai.js builds them
let nid = 1;
function vec(x, z) { return { x, y: 0, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; } }; }
function inmate(x, z, gang, extra) {
  const n = Object.assign({ id: nid++, kind: "inmate", role: "inmate", gang: gang == null ? -1 : gang, aiState: "wander",
    hp: 100, maxHp: 100, baseSpeed: 2, group: { position: vec(x, z), rotation: { y: 0 } },
    target: vec(x, z), char: {}, personality: { nerve: 0.8, loyalty: 0.9, snitch: 0.5 }, loadout: { items: [] } }, extra || {});
  CBZ.npcs.push(n);
  return n;
}
function pdist(n) { return Math.hypot(n.group.position.x - player.pos.x, n.group.position.z - player.pos.z); }
function walkTo(n, x, z, sp, dt) {
  const p = n.group.position, dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
  if (!(sp > 0) || d < 0.05) return;
  const s = Math.min(d, sp * dt); p.x += dx / d * s; p.z += dz / d * s;
}
// a stand-in for aiThink: the gate first, then the hunt / flee it leaves him in
function think(n, dt) {
  const sp = PB.gunThink(n, dt);
  if (sp != null) { if (sp > 0) walkTo(n, n.target.x, n.target.z, sp, dt); return "gate"; }
  if ((n.huntPlayer || 0) > 0) { n.huntPlayer -= dt; if (pdist(n) > 0.9) walkTo(n, player.pos.x, player.pos.z, 3, dt); return "hunt"; }
  if (n.aiState === "flee" && n._fleeX != null) { n.fleeT -= dt; walkTo(n, n._fleeX, n._fleeZ, 3.4, dt); if (n.fleeT <= 0) { n.aiState = "wander"; n._fleeX = null; } return "flee"; }
  return "idle";
}

scenario(4, "the PRISON gate: men set on the player meet the gun — nobody walks at the muzzle, the shank only in the reload", function () {
  fresh(41); T = 0;
  // two open cells behind the crowd, one at the shooter's own door
  CBZ.cellblock.cells.push({ x: 0, z: 14, hx: 1.5, hz: 1.5, tier: 0, locked: false, player: false });
  CBZ.cellblock.cells.push({ x: 1, z: -2, hx: 1.5, hz: 1.5, tier: 0, locked: false, player: false });
  const men = [];
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2 + 0.2, r = 4 + (i % 3) * 3;
    const n = inmate(Math.sin(ang) * r, Math.cos(ang) * r, i % 2);
    men.push(n);
  }
  const blade = inmate(0.5, 3.1, 0, { loadout: { items: ["Shiv"] } });
  const gunner = inmate(-6, 9, 1, { hasGun: true, armed: true, weapon: "Pistol" });
  let fired = 0;
  CBZ.prisonNpcFire = function () { fired++; };
  PB.sync();
  blade._brain.personality.aggression = 0.95; blade._brain.personality.courage = 0.9;
  for (const n of men) { n._brain.personality.aggression = 1; n._brain.personality.courage = 1; }   // the worst case
  const all = men.concat([blade, gunner]);
  // every one of them has just been set on you (the shot man's provokeGang,
  // his clique's answerFor, the witnesses' responder, a snub...)
  for (const n of all) n.huntPlayer = 12;
  const d0 = new Map(all.map((n) => [n, pdist(n)]));
  let bladeHuntAt = null, bladeHuntD = null, bladeHuntReload = null, worst = 0;
  const modes = new Map(all.map((n) => [n, []]));
  const dt = 1 / 30;
  for (let f = 0; f < 300; f++) {          // 10 s
    advance(dt);
    const t = T;
    CBZ.fps.reloading = t >= 4 && t < 6 ? 1 : 0;
    playerYaw = Math.atan2(blade.group.position.x, blade.group.position.z);   // the gun stays on the blade
    PB.tick(dt);
    if (f % 15 === 0 && !CBZ.fps.reloading) PB.noise(0, 0, 40, "gunfire", player);
    for (const n of all) {
      const m = think(n, dt);
      modes.get(n).push(m);
      if (n === blade && m === "hunt" && bladeHuntAt == null) { bladeHuntAt = t; bladeHuntD = pdist(n); bladeHuntReload = !!CBZ.fps.reloading; }
    }
    for (const n of men) worst = Math.max(worst, d0.get(n) - pdist(n));
  }
  check(worst <= 0.25, "none of 12 unarmed men set on the player closed on the gun (worst " + worst.toFixed(2) + " m)");
  check(men.every((n) => !modes.get(n).includes("hunt")), "…not one hunt step taken by an unarmed man");
  check(men.every((n) => (n.playerGrudge || 0) > 0), "…and they all keep the grudge (" + men.map((n) => (n.playerGrudge || 0).toFixed(1)).join(" ") + ")");
  const hid = men.filter((n) => n._fleeX === 0 && n._fleeZ === 14).length;
  check(hid > 0, "some ran for the open cell behind them (" + hid + ")");
  check(men.every((n) => !(n._fleeX === 1 && n._fleeZ === -2)), "nobody ran for the cell at the shooter's own door");
  check(bladeHuntAt != null && bladeHuntReload && bladeHuntD <= 3.5, "the shank man hunts only in the reload, inside 3.5 m (" + (bladeHuntAt == null ? "never" : bladeHuntAt.toFixed(2) + " s at " + bladeHuntD.toFixed(2) + " m") + ")");
  check(!modes.get(gunner).includes("hunt") && pdist(gunner) >= d0.get(gunner) - 0.25 && fired > 0, "the armed inmate never walks in: he gets set and fires from range (" + fired + " shots, " + pdist(gunner).toFixed(1) + " m)");
  // the gun goes away: the gate lets go, nothing is left posed
  GUN = null; PB.shotFired && (CBZ.game.elapsed += 20);
  advance(20); PB.tick(dt);
  for (const n of all) PB.gunThink(n, dt);
  check(all.every((n) => !n.char.handsUp && !n.char.surrender && !n.poseAimBack), "gun away: every pose the gate set is released");
});

scenario(5, "no gun out: the gate stays out of an ordinary fight; a player gunshot scatters the yard AWAY", function () {
  fresh(51); T = 0;
  GUN = null;
  const n = inmate(0, 3, 0);
  PB.sync();
  n.huntPlayer = 5;
  advance(0.05); PB.tick(0.05);
  check(PB.gunThink(n, 0.05) == null && n.huntPlayer > 0, "fists vs fists: the hunt is untouched");
  check(!PB.gunRefuses(n), "…and requestHunt is not refused");
  // a gunshot from the player, gun out: the yard runs away from it
  GUN = { key: "pistol" };
  const yard = [];
  for (let i = 0; i < 16; i++) { const a = (i / 16) * 6.283; yard.push(inmate(Math.sin(a) * (3 + i % 4 * 3), Math.cos(a) * (3 + i % 4 * 3), i % 2)); }
  PB.sync();
  const d0 = yard.map(pdist);
  advance(0.05); PB.tick(0.05);
  PB.noise(0, 0, 40, "gunfire", player);
  for (let f = 0; f < 90; f++) { advance(1 / 30); PB.tick(1 / 30); for (const m of yard) think(m, 1 / 30); }
  const d1 = yard.map(pdist);
  check(d1.every((d, i) => d >= d0[i] - 0.05), "nobody in the yard moved toward the shot (" + d1.filter((d, i) => d < d0[i] - 0.05).length + ")");
  check(d1.filter((d, i) => d > d0[i] + 1).length >= yard.length * 0.75, "most of the yard put real distance between them and it (" + d1.filter((d, i) => d > d0[i] + 1).length + "/" + yard.length + ")");
});

// =========================================================================
const only = process.argv[2] ? +process.argv[2] : null;
for (const s of scenarios) {
  if (only != null && s.n !== only) continue;
  console.log("\n[" + s.n + "] " + s.name);
  try { s.fn(); } catch (e) { fails++; console.log("  FAIL threw: " + (e && e.stack || e)); }
}
console.log("\n" + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);

#!/usr/bin/env node
/* tools/tactics-check.mjs — DOES A GUNMAN PICK A SPOT, STOP, AND SHOOT?

   Pure-math check of systems/combat_iq.js's POSITION layer (block 3b/3c —
   the owner's "when they're shooting at you they should be picking position…
   in general, you would stop to shoot"). No browser, no THREE, no boot: the
   module's only dependency is window.CBZ, so each scenario hands it a
   synthetic city (collider boxes + a seeded hash + a hand-stepped clock) and
   drives posture()/shot()/moveGate() directly. That makes every claim below
   an assertion about the exact arithmetic the game ships, at ~zero cost.

   What it pins:
     stop-to-shoot   a moving shooter hits measurably worse than a planted
                     one, and a trigger pull opens a halt window (moveGate)
     plant           a lone shooter CONVERGES onto one committed position,
                     plants there, stays in his weapon's band, and his goal
                     stops churning (the old brain re-wrote it every frame)
     wall rule       picked positions are wall-projected: real firing lane,
                     straight-line reachable, never inside a collider — on a
                     map where the naive bearing goal is INSIDE the wall
     cover/peek      a hurt shooter's goal is the FAR side of the box; with
                     the fire token it is the box's EDGE with a real lane
     hide            a hurt shooter with no cover breaks AWAY from the gun,
                     gaining distance, not 9 m straight down the same lane
     geometry        the walk/fire duality: a low wall stops bodies but not
                     chest-height rounds; an elevated sign stops neither
     tokens          six guns on one mark still take turns
     determinism     the same fight twice is the same fight, bytewise
     battle safety   OFF-city, posture() never creates a position — the
                     battle page's beloved chase-and-retreat is untouched
     cop band halt   an officer with the token, eyes on, in band, halts
                     (no position system needed), and keeps arrest footwork

   Usage: node tools/tactics-check.mjs [--verbose]
   Exit 0 = TACTICS: ok. Anything else = FAIL (exit 1).                    */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = readFileSync(path.join(ROOT, "src/systems/combat_iq.js"), "utf8");
const VERBOSE = process.argv.includes("--verbose");

let fails = 0, passes = 0;
function ok(name, cond, detail) {
  if (cond) { passes++; if (VERBOSE) console.log("  ok  " + name + (detail ? "  (" + detail + ")" : "")); }
  else { fails++; console.error("  FAIL " + name + (detail ? "  (" + detail + ")" : "")); }
}

// deterministic stand-in for core/seed.js's hash01 (stable per-person trait)
function hash01(x, z, salt) {
  let s = 0;
  if (typeof salt === "string") { for (let i = 0; i < salt.length; i++) s = (s * 31 + salt.charCodeAt(i)) | 0; }
  else s = salt | 0;
  let h = (Math.round(x * 10) * 374761393 + Math.round(z * 10) * 668265263) ^ (s * 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

// one fresh module instance per scenario — combat_iq is an IIFE over window.CBZ
function boot(opts) {
  opts = opts || {};
  const boxes = opts.boxes || [];
  const CBZ = {
    CONFIG: Object.assign({}, opts.config),
    game: { mode: opts.mode || "city" },
    now: 1000,
    hash01,
    cityPeds: [], cityCops: [],
    onUpdate: function () {},
    queryCollidersNear: function (x, z, r, out) {
      out = out || []; out.length = 0;
      for (const c of boxes) {
        const nx = Math.max(c.minX, Math.min(x, c.maxX));
        const nz = Math.max(c.minZ, Math.min(z, c.maxZ));
        if ((nx - x) * (nx - x) + (nz - z) * (nz - z) <= r * r) out.push(c);
      }
      return out;
    },
  };
  new Function("window", SRC)({ CBZ });
  return CBZ;
}

function actor(CBZ, x, z, o) {
  const a = Object.assign({
    pos: { x, y: 0, z },
    target: { x, y: 0, z, set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; } },
    armed: true, weapon: "Pistol", ammo: 999,
    hp: 100, maxHp: 100, speed: 0, aggr: 0.9,     // aggr .9 → thug row
  }, o || {});
  (a.kind === "cop" ? CBZ.cityCops : CBZ.cityPeds).push(a);
  return a;
}
const mark = (x, z) => ({ pos: { x, y: 0, z }, isPlayer: true });
const dist2 = (a, b) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);

/* one sim tick: advance the clock, run the brain, integrate the mover the way
   peds.js move() does (walk at spd toward target unless the gate halts). */
function tick(CBZ, a, tgt, dt, spd) {
  CBZ.now += dt * 1000;
  const slot = CBZ.combatIQ.posture(a, tgt, dt);
  const d = dist2(a, tgt);
  const mg = CBZ.combatIQ.moveGate(a, tgt, d, slot);
  const gx = a.target.x - a.pos.x, gz = a.target.z - a.pos.z;
  const gd = Math.hypot(gx, gz);
  let sp = 0;
  if (!(mg && mg.halt) && gd > 0.5) {
    sp = spd;
    a.pos.x += (gx / gd) * Math.min(spd * dt, gd);
    a.pos.z += (gz / gd) * Math.min(spd * dt, gd);
  }
  a.speed = sp;
  return slot;
}

/* ============================================================ 1. STOP-TO-SHOOT */
{
  console.log("[1] stop-to-shoot arithmetic");
  const CBZ = boot();
  const IQ = CBZ.combatIQ;
  const t = mark(0, 0);
  const a = actor(CBZ, 0, 10, {});
  // settle fully onto the mark (clear the reaction beat)
  for (let i = 0; i < 40; i++) { CBZ.now += 100; IQ.aimTick(a, t, 0.1); }
  a.speed = 4.2;                        // sprinting between positions
  CBZ.now += 16; const mv = IQ.shot(a, t, 10, 0.016, 14);
  const aimAfterRun = a._iqAimT;
  a.speed = 0;                          // planted
  for (let i = 0; i < 40; i++) { CBZ.now += 100; IQ.aimTick(a, t, 0.1); }
  CBZ.now += 16; const st = IQ.shot(a, t, 10, 0.016, 14);
  ok("both shots fired", !!(mv && mv.fire && st && st.fire));
  ok("moving hit < 0.75 × planted hit", mv.hit < st.hit * 0.75, mv.hit.toFixed(3) + " vs " + st.hit.toFixed(3));
  ok("a runner never settles past 40%", aimAfterRun <= 0.9 * 0.4 + 1e-9, "aimT " + aimAfterRun.toFixed(3));
  // the trigger pull opens a plant window that then decays
  ok("trigger pull opens a halt window", IQ.moveGate(a, t, 30, "").halt === true);
  CBZ.now += 16; IQ.aimTick(a, t, 1.2);
  ok("halt window decays", IQ.moveGate(a, t, 30, "").halt === false);
}

/* ============================================================ 2. PLANT + NO CHURN */
function runConverge(seedX) {
  const CBZ = boot();
  const t = mark(0, 0);
  const a = actor(CBZ, seedX, 30, {});
  let jumps = 0, px = null, pz = null, plantedTicks = 0;
  for (let i = 0; i < 480; i++) {
    tick(CBZ, a, t, 1 / 60, 3.4);
    if (px != null && Math.hypot(a.target.x - px, a.target.z - pz) > 1.2) jumps++;
    px = a.target.x; pz = a.target.z;
    if (i >= 420 && a._iqPlant) plantedTicks++;
  }
  return { CBZ, a, jumps, plantedTicks, d: dist2(a, t) };
}
{
  console.log("[2] a shooter converges, plants, and his goal stops churning");
  const r = runConverge(0);
  ok("planted through the last second", r.plantedTicks === 60, r.plantedTicks + "/60");
  ok("holds the pistol's band (3..15.5)", r.d > 3 && r.d < 15.5, "d=" + r.d.toFixed(2));
  ok("goal re-committed, not re-rolled (≤3 jumps in 8 s)", r.jumps <= 3, "jumps=" + r.jumps);
  const au = r.CBZ.combatIQAudit();
  ok("audit sees the position layer", au.flags.positions === true && au.posPicks >= 1, "picks=" + au.posPicks);
}

/* ============================================================ 3. THE WALL RULE */
{
  console.log("[3] positions are wall-projected (the naive goal was inside the wall)");
  const wall = { minX: -8, maxX: 8, minZ: 8, maxZ: 9.4, y0: 0, y1: 3 };
  const CBZ = boot({ boxes: [wall] });
  const IQ = CBZ.combatIQ;
  const t = mark(0, 0);
  const a = actor(CBZ, 0, 26, {});
  for (let i = 0; i < 600; i++) tick(CBZ, a, t, 1 / 60, 3.4);
  const P = a._iqPos;
  ok("naive bearing spot was INSIDE the wall", IQ.geom.pointBlocked(0, 8.8) === true);
  ok("a position was committed anyway", !!P);
  if (P) {
    ok("picked spot is outside every collider", IQ.geom.pointBlocked(P.x, P.z) === false);
    ok("picked spot has a real firing lane", IQ.geom.fireBlocked(P.x, P.z, 0, 0) === false);
    ok("picked spot went AROUND the wall", Math.abs(P.x) > 8 || P.z < 8, "(" + P.x.toFixed(1) + "," + P.z.toFixed(1) + ")");
    ok("body arrived and planted", a._iqPlant === true, "gd=" + Math.hypot(a.pos.x - P.x, a.pos.z - P.z).toFixed(2));
  }
}

/* ============================================================ 4. COVER + PEEK */
{
  console.log("[4] cover is the far side of the box; the peek is its edge, with a lane");
  const kiosk = { minX: -1.2, maxX: 1.2, minZ: 14, maxZ: 16, y0: 0, y1: 2.2 };
  const CBZ = boot({ boxes: [kiosk] });
  const IQ = CBZ.combatIQ;
  const t = mark(0, 0);
  // pure cover() first: far-side placement is a sign test against the box centre
  const c1 = actor(CBZ, 0, 18, {});
  const cv = IQ.cover(c1, 0, 0);
  ok("cover found off the real collider", !!cv);
  if (cv) {
    const sgn = (cv.x - 0) * (0 - 0) + (cv.z - 15) * (0 - 15);   // (hide−box)·(threat−box)
    ok("hide point is on the FAR side", sgn < 0, "z=" + cv.z.toFixed(2));
  }
  // full posture: hurt single shooter holds the token → peek at the box EDGE
  const a = actor(CBZ, 0.5, 18, { hp: 30 });
  let slot = null;
  for (let i = 0; i < 240; i++) slot = tick(CBZ, a, t, 1 / 60, 3.4);
  ok("hurt token-holder is peeking or covered", slot === "peek" || slot === "cover", "slot=" + slot);
  if (slot === "peek") {
    ok("peek spot clears the box edge", Math.abs(a.target.x) > 1.2, "x=" + a.target.x.toFixed(2));
    ok("peek spot has a firing lane", IQ.geom.fireBlocked(a.target.x, a.target.z, 0, 0) === false);
  }
}

/* ============================================================ 5. HIDE / RETREAT */
{
  console.log("[5] a hurt man with no cover breaks AWAY and gains ground");
  const CBZ = boot();
  const t = mark(0, 0);
  const a = actor(CBZ, 0, 12, { hp: 20 });
  const d0 = dist2(a, t);
  const slot = tick(CBZ, a, t, 1 / 60, 3.4);
  ok("slot is hide (positions) — not a blind straight-back", slot === "hide", "slot=" + slot);
  const gdx = a.target.x - a.pos.x, gdz = a.target.z - a.pos.z;
  const tdx = t.pos.x - a.pos.x, tdz = t.pos.z - a.pos.z;
  ok("goal is strictly AWAY from the gun", gdx * tdx + gdz * tdz < 0);
  ok("goal gains distance on the threat", Math.hypot(a.target.x, a.target.z) > d0 + 4);
}

/* ============================================================ 6. WALK/FIRE GEOMETRY */
{
  console.log("[6] the walk/fire duality (low wall = half cover; sign = neither)");
  const low = { minX: -4, maxX: 4, minZ: 4, maxZ: 5, y0: 0, y1: 0.9 };     // planter
  const tall = { minX: -4, maxX: 4, minZ: 14, maxZ: 15, y0: 0, y1: 3 };    // wall
  const sign = { minX: -4, maxX: 4, minZ: 24, maxZ: 25, y0: 1.6, y1: 4 };  // elevated sign
  const IQ = boot({ boxes: [low, tall, sign] }).combatIQ;
  ok("low wall stops bodies", IQ.geom.walkBlocked(0, 2, 0, 7) === true);
  ok("low wall does NOT stop chest-height fire", IQ.geom.fireBlocked(0, 2, 0, 7) === false);
  ok("tall wall stops fire", IQ.geom.fireBlocked(0, 12, 0, 17) === true);
  ok("tall wall stops bodies", IQ.geom.walkBlocked(0, 12, 0, 17) === true);
  ok("elevated sign stops neither (walk)", IQ.geom.walkBlocked(0, 22, 0, 27) === false);
  ok("elevated sign stops neither (fire)", IQ.geom.fireBlocked(0, 22, 0, 27) === false);
}

/* ============================================================ 7. TOKENS STILL RULE */
{
  console.log("[7] six guns on one mark still take turns");
  const CBZ = boot();
  const t = mark(0, 0);
  const crew = [];
  for (let i = 0; i < 6; i++) crew.push(actor(CBZ, Math.sin(i) * 14, 10 + Math.cos(i) * 9, {}));
  let fire = 0;
  for (let k = 0; k < 30; k++) { CBZ.now += 16; for (const a of crew) CBZ.combatIQ.posture(a, t, 0.016); }
  for (const a of crew) { const s = CBZ.combatIQ.slot(a, t, 0.016); if (s === "fire") fire++; }
  ok("someone is firing", fire >= 1, "fire=" + fire);
  ok("not everyone is firing", fire < 6, "fire=" + fire);
}

/* ============================================================ 8. DETERMINISM */
{
  console.log("[8] the same fight twice is the same fight");
  const r1 = runConverge(3), r2 = runConverge(3);
  ok("final position identical", r1.a.pos.x === r2.a.pos.x && r1.a.pos.z === r2.a.pos.z,
    r1.a.pos.x.toFixed(4) + "," + r1.a.pos.z.toFixed(4));
  ok("same pick count", r1.CBZ.combatIQAudit().posPicks === r2.CBZ.combatIQAudit().posPicks);
}

/* ============================================================ 9. BATTLE SAFETY */
{
  console.log("[9] off-city, posture() never grows a position (battle.html untouched)");
  const CBZ = boot({ mode: "battle" });
  const t = mark(0, 0);
  const a = actor(CBZ, 0, 30, {});
  for (let i = 0; i < 120; i++) { CBZ.now += 16; CBZ.combatIQ.posture(a, t, 1 / 60); }
  ok("no position object off-city", a._iqPos == null && a._iqPosF == null);
  // the legacy band solve: a raw goal on the bearing at the weapon's preferred
  // hold (pistol pref = lo 5 + (14−5)·0.42 = 8.78), NOT a committed/planted spot
  const gd = Math.hypot(a.target.x - t.pos.x, a.target.z - t.pos.z);
  ok("legacy band goal preserved (≈pref radius)", Math.abs(gd - 8.78) < 3, "goalDist=" + gd.toFixed(2));
  ok("never plants off-city", !a._iqPlant);
  ok("drives() answers false off-city", CBZ.combatIQ.drives(a) === false);
}

/* ============================================================ 9b. THE ONE-LINE REVERT */
{
  console.log("[9b] cfg_NPC_IQ_POSITIONS=0 reverts EVERYTHING — in the city");
  const CBZ = boot({ config: { NPC_IQ_POSITIONS: false } });
  const IQ = CBZ.combatIQ;
  const t = mark(0, 0);
  const a = actor(CBZ, 0, 10, {});
  for (let i = 0; i < 40; i++) { CBZ.now += 100; IQ.aimTick(a, t, 0.1); }
  a.speed = 4.2;
  CBZ.now += 16; const mv = IQ.shot(a, t, 10, 0.016, 14);
  a.speed = 0;
  CBZ.now += 16; const st = IQ.shot(a, t, 10, 0.016, 14);
  ok("no moving penalty with the flag off", !!(mv && st) && Math.abs(mv.hit - st.hit) < 1e-9,
    (mv && mv.hit.toFixed(3)) + " vs " + (st && st.hit.toFixed(3)));
  ok("no plant window with the flag off", !(a._iqFiredT > 0));
  ok("moveGate inert with the flag off", IQ.moveGate(a, t, 10, "fire") === null);
  const b = actor(CBZ, 0, 30, {});
  for (let i = 0; i < 120; i++) { CBZ.now += 16; IQ.posture(b, t, 1 / 60); }
  ok("no positions with the flag off", b._iqPos == null && !b._iqPlant);
}

/* ============================================================ 10. THE COP BAND HALT */
{
  console.log("[10] an officer with the token, eyes on, in band, stands to deliver");
  const CBZ = boot();
  const IQ = CBZ.combatIQ;
  const t = mark(0, 0);
  const c = actor(CBZ, 0, 10, { kind: "cop", weapon: null, aggr: 0 });
  ok("in-band fire slot halts", IQ.moveGate(c, t, 10, "fire").halt === true);
  ok("out of band keeps closing", IQ.moveGate(c, t, 22, "fire").halt === false);
  ok("close quarters keeps arrest footwork", IQ.moveGate(c, t, 2, "fire").halt === false);
  ok("no token keeps maneuvering", IQ.moveGate(c, t, 10, "cover").halt === false);
}

console.log("");
if (fails) { console.error("TACTICS: FAIL — " + fails + " of " + (fails + passes) + " assertions"); process.exit(1); }
console.log("TACTICS: ok — " + passes + " assertions across 11 scenarios");

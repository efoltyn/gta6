#!/usr/bin/env node
/* tools/brain-sim.mjs — plain-node scenarios for src/systems/brain.js (CBZ.brain).

   No browser, no THREE, no captures. A fake `window.CBZ`, a few duck-typed
   actors ({ pos, yaw, hp }), a sim executor registered with act.use("sim"),
   and the brain's own clock. Every check prints PASS/FAIL; any FAIL exits 1.

     node tools/brain-sim.mjs            # all scenarios
     node tools/brain-sim.mjs 3 5        # just scenarios 3 and 5

   Routers (prison / city / President / disaster+war) may add scenarios at the
   bottom, in the ROUTER SCENARIOS section, as scenario(n, name, fn). */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
globalThis.window = { CBZ: {} };
const B = require(path.join(ROOT, "src/systems/brain.js"));

let fails = 0, passes = 0;
function check(ok, msg) {
  if (ok) { passes++; console.log("  PASS " + msg); }
  else { fails++; console.log("  FAIL " + msg); }
}
const scenarios = [];
function scenario(n, name, fn) { scenarios.push({ n, name, fn }); }

// ---- a tiny world ---------------------------------------------------------
function actor(x, z, yaw, extra) {
  const a = { pos: { x, y: 0, z }, yaw: yaw || 0, hp: 100, maxHp: 100, speed: 0 };
  if (extra) Object.assign(a, extra);
  return a;
}
function faceTo(a, x, z) { a.yaw = Math.atan2(x - a.pos.x, z - a.pos.z); }
const verbs = [];
const said = [];
B.act.use("sim", {
  moveTo(a, x, z, o) { a._goal = { x, z, v: (o && o.speedMps) || 1.4, arrive: (o && o.arrive) || 1 }; return true; },
  stop(a) { a._goal = null; return true; },
  face(a, x, z) { faceTo(a, x, z); return true; },
  posture(a, p) { a._posture = p; return true; },
  say(a, line) { said.push({ a, line, t: B.now() }); return true; },
  verb(name, a, b) { verbs.push({ name, a, b, t: B.now() }); return { ok: true, name }; },
});
function integrate(a, dt) {
  const g = a._goal; if (!g) return;
  const dx = g.x - a.pos.x, dz = g.z - a.pos.z, d = Math.hypot(dx, dz);
  if (d <= g.arrive) return;
  const s = Math.min(d - g.arrive, g.v * dt);
  a.pos.x += dx / d * s; a.pos.z += dz / d * s;
  a.yaw = Math.atan2(dx, dz);
}
function fresh(seed) {
  B.reset(); B.seed(seed || 1234); B.perception.setOcclusion(null); B.perception.setLight(null);
  verbs.length = 0; said.length = 0; T = 0; B.clock(0);
}
let T = 0;
function advance(dt) { T += dt; B.clock(T); B.morale.tick(dt); }

// =========================================================================
scenario(1, "cop: spot -> warn -> order -> comply -> approach -> cuff; runner -> escalate -> force", function () {
  fresh(11);
  const cop = actor(0, 0, 0), sus = actor(0, 22, 0);
  B.register(cop, "cop", { game: "sim" });
  // gradual spotting: not instant at 22 m, but within a few seconds
  let aw = 0, t = 0;
  const first = B.perception.awareness(cop, sus, 0.1);
  check(first > 0 && first < 1, "awareness fills gradually (first tick " + first.toFixed(3) + ")");
  for (t = 0.1; t < 10 && aw < 1; t += 0.1) { advance(0.1); aw = B.perception.awareness(cop, sus, 0.1); }
  check(aw >= 1 && t > 0.3 && t < 6, "cop SPOTS the suspect after " + t.toFixed(1) + " s");
  check(!!B.memory.lastSeen(cop, sus), "memory.lastSeen records the sighting");

  // the ladder, compliant suspect (stands still, hands up)
  B.authority.begin(cop, sus, "assault", { roe: "nonlethal" });
  const phases = [];
  const st = { speed: 0, handsUp: true, armed: false };
  for (let i = 0; i < 400; i++) {
    const r = B.authority.step(cop, 0.05, st);
    if (!phases.length || phases[phases.length - 1] !== r.phase) phases.push(r.phase);
    integrate(cop, 0.05); advance(0.05);
    if (r.phase === "done") break;
  }
  const seq = phases.join(">");
  check(/warn/.test(seq) && /order/.test(seq) && /approach/.test(seq) && /cuff/.test(seq) && /done$/.test(seq), "ladder " + seq);
  check(!/escalate|force|lethal/.test(seq), "a complying suspect is never forced");
  const cuffV = verbs.find((v) => v.name === "restrain");
  check(!!cuffV && cuffV.a === cop && cuffV.b === sus, "act.verb('restrain', cop, suspect) was called");
  check(B.authority.caseOf(cop) === null && cop._brain.case.outcome === "cuffed", "case closed as cuffed");
  check(said.some((s) => /Stop right there|Hey! Stop|Hold it/.test(s.line)) && said.some((s) => /ground|Hands/.test(s.line)), "warn + order lines spoken in-world: " + said.map((s) => s.line).join(" | "));

  // second run: he runs
  fresh(12);
  const cop2 = actor(0, 0, 0), run = actor(0, 8, 0);
  B.register(cop2, "cop", { game: "sim" });
  B.authority.begin(cop2, run, "theft", { roe: "nonlethal" });
  const ph2 = [];
  const rs = { speed: 0, armed: false };
  let lethalSeen = false;
  for (let i = 0; i < 600; i++) {
    const r = B.authority.step(cop2, 0.05, rs);
    if (!ph2.length || ph2[ph2.length - 1] !== r.phase) ph2.push(r.phase);
    if (r.phase === "lethal") lethalSeen = true;
    if (r.phase === "order" || r.phase === "escalate" || r.phase === "force") { run.pos.z += 5 * 0.05; rs.speed = 5; }
    integrate(cop2, 0.05); advance(0.05);
    if (r.phase === "force" && verbs.some((v) => v.name === "tase")) break;
  }
  const s2 = ph2.join(">");
  check(/order>escalate>force/.test(s2), "runner: " + s2);
  check(verbs.some((v) => v.name === "tase" && v.a === cop2), "force used the taser via act.verb");
  check(!lethalSeen, "nonlethal ROE never goes lethal");

  // third: armed and aiming, SWAT (lethal ROE) goes lethal; a beat cop does not
  fresh(13);
  const swat = actor(0, 0, 0), gun = actor(0, 9, Math.PI);
  B.register(swat, "swat", { game: "sim" });
  B.authority.begin(swat, gun, "armed", {});
  let r3 = null;
  for (let i = 0; i < 10; i++) { r3 = B.authority.step(swat, 0.05, { speed: 0, armed: true, aiming: true }); advance(0.05); }
  check(r3.phase === "lethal" && r3.act === "shoot", "SWAT vs an armed man aiming: lethal");
  const beat = actor(0, 0, 0);
  B.register(beat, "cop", { game: "sim" });
  B.authority.begin(beat, gun, "armed", {});
  for (let i = 0; i < 10; i++) { r3 = B.authority.step(beat, 0.05, { speed: 0, armed: true, aiming: true }); advance(0.05); }
  check(r3.phase !== "lethal", "beat cop (nonlethal ROE) vs the same man: " + r3.phase);
});

// =========================================================================
scenario(2, "crowd of 12 witnesses a shooting: flee / film / report; delayed reports; dead witnesses stay silent", function () {
  fresh(21);
  const shooter = actor(0, 0, 0, { isPlayer: true });
  const crowd = [];
  for (let i = 0; i < 12; i++) {
    const ang = i / 12 * Math.PI * 2, r = 6 + (i % 4) * 4;
    const c = actor(Math.sin(ang) * r, Math.cos(ang) * r, 0);
    // half face the shooter, half face away (they only HEAR it)
    if (i % 2 === 0) faceTo(c, 0, 0); else faceTo(c, c.pos.x * 2, c.pos.z * 2);
    B.register(c, "civilian", { game: "sim" });
    crowd.push(c);
  }
  const reports = [];
  const off = B.social.onReport("sim", (rp) => reports.push(rp));
  const tCrime = T;
  const n = B.social.crime("shooting", 0, 0, shooter, 0.9, { game: "sim", type: "shooting" });
  check(n === 12, "all 12 became witnesses (" + n + ")");
  const resp = {};
  for (const c of crowd) resp[c._brain.witness.response] = (resp[c._brain.witness.response] || 0) + 1;
  console.log("    responses " + JSON.stringify(resp));
  check((resp.flee || 0) > 0, "some flee");
  check((resp.film || 0) > 0, "some film");
  const reporters = crowd.filter((c) => c._brain.witness.reportAt != null);
  check(reporters.length >= 2, reporters.length + " will phone it in");
  check(crowd.filter((c) => !c._brain.witness.saw).every((c) => c._brain.witness.perp === null), "those who only heard it cannot name the shooter");
  check(reports.length === 0, "no report lands on the instant of the crime");
  // kill the reporter who would call LAST... and the earliest one, before they call
  reporters.sort((a, b) => a._brain.witness.reportAt - b._brain.witness.reportAt);
  const victim = reporters[0];
  victim.dead = true; victim.hp = 0;
  for (let i = 0; i < 300; i++) advance(0.05);
  check(reports.length === reporters.length - 1, reports.length + " reports arrived (" + (reporters.length - 1) + " expected)");
  check(reports.every((r) => r.t - tCrime >= 0.5), "every report came after a delay (" + reports.map((r) => (r.t - tCrime).toFixed(1)).join(", ") + " s)");
  check(!reports.some((r) => r.witness === victim), "the witness killed before calling never reports");
  check(reports.every((r) => r.kind === "shooting" && r.opts && r.opts.type === "shooting"), "report carries the crime's fields");
  // intimidation also stops a call
  fresh(22);
  B.define("sim_snitch", { witness: { report: 1, flee: 0, film: 0, cower: 0, ignore: 0, intervene: 0, cheer: 0 } });
  const w2 = actor(0, 5, Math.PI); B.register(w2, "sim_snitch", { game: "sim" });
  const w3 = actor(0, -5, 0); B.register(w3, "sim_snitch", { game: "sim" });
  const cop = actor(0, -20, 0); B.register(cop, "cop", { game: "sim" });
  let got = 0; B.social.onReport("sim", () => got++);
  B.social.crime("murder", 0, 0, shooter, 1, { game: "sim" });
  check(w2._brain.witness.reportAt != null && B.social.pending() === 3, "two snitches + the cop's radio are pending (" + B.social.pending() + ")");
  check(w3._brain.witness.toAuth === cop && B.tick(w3, 0.05, {}).kind === "report" && B.tick(w3, 0.05, {}).target === cop, "a reporter with an officer near walks to him");
  const silenced = B.social.silence(w2, "intimidated");
  w3.bribed = 30;                                   // bribed witnesses do not call
  for (let i = 0; i < 300; i++) advance(0.05);
  check(silenced && got === 1, "intimidated + bribed witnesses never report; only the cop's radio lands (" + got + ")");
  off();
});

// =========================================================================
scenario(3, "President's detail hears a gunshot: cp cover, countersnipers hold, protectee evacuates", function () {
  fresh(31);
  const pres = actor(0, 0, 0);
  B.register(pres, "protectee", { game: "sim", safe: { x: -20, z: 0 } });
  const lead = actor(1.5, 0, 0); B.register(lead, "agent_lead", { game: "sim", protect: pres });
  const cps = [];
  for (let i = 0; i < 4; i++) {
    const ang = i / 4 * Math.PI * 2;
    const a = actor(Math.sin(ang) * 2.5, Math.cos(ang) * 2.5, ang);
    B.register(a, "agent_cp", { game: "sim", protect: pres });
    cps.push(a);
  }
  const snipers = [actor(30, 30, Math.PI), actor(-30, 30, Math.PI)];
  for (const s of snipers) { s.pos.y = 10; B.register(s, "countersniper", { game: "sim" }); }
  const shooter = actor(20, 10, 0);
  const heardN = B.perception.noise(20, 10, 48, "gunshot", shooter);
  check(heardN === 8, "the shot reached all 8 of the detail (" + heardN + ")");
  const h = B.memory.heard(pres);
  check(!!h && h.kind === "gunshot" && Math.abs(h.x - 20) < 1e-9, "memory.heard holds the gunshot and its spot");
  advance(0.05);
  const ctx = {};
  const cpRes = cps.map((a) => { const I = B.tick(a, 0.05, ctx); return I.kind + "/" + I.response; });
  check(cpRes.every((r) => r === "cover/cover"), "close protection: " + cpRes.join(", "));
  const I0 = B.tick(cps[0], 0.05, ctx);
  const between = Math.hypot(I0.x - 20, I0.z - 10) < Math.hypot(pres.pos.x - 20, pres.pos.z - 10);
  check(between, "cover spot is between the principal and the shot (" + I0.x.toFixed(2) + ", " + I0.z.toFixed(2) + ")");
  const sn = snipers.map((a) => { const I = B.tick(a, 0.05, ctx); return I.kind + "/" + I.response; });
  check(sn.every((r) => r === "hold/hold"), "countersnipers stay static: " + sn.join(", "));
  const IP = B.tick(pres, 0.05, ctx);
  check(IP.kind === "evacuate" && IP.x === -20 && IP.z === 0 && IP.speed > 3, "protectee: " + IP.kind + " to (" + IP.x + ", " + IP.z + ")");
  const IL = B.tick(lead, 0.05, ctx);
  check(IL.kind === "cover", "agent_lead: " + IL.kind);
});

// =========================================================================
scenario(4, "inmate clique: proportional retaliation; leader dies -> morale drops -> weakest routs", function () {
  fresh(41);
  const pers = [
    { courage: 0.8, aggression: 0.7, loyalty: 0.9, discipline: 0.3, curiosity: 0.5 },   // leader
    { courage: 0.6, aggression: 0.6, loyalty: 0.8, discipline: 0.3, curiosity: 0.5 },   // A (the victim)
    { courage: 0.95, aggression: 0.9, loyalty: 0.9, discipline: 0.2, curiosity: 0.5 },  // bravest
    { courage: 0.5, aggression: 0.4, loyalty: 0.6, discipline: 0.3, curiosity: 0.5 },
    { courage: 0.6, aggression: 0.5, loyalty: 0.7, discipline: 0.3, curiosity: 0.5 },
    { courage: 0.1, aggression: 0.2, loyalty: 0.5, discipline: 0.3, curiosity: 0.5 },   // weakest
  ];
  const clique = pers.map((p, i) => {
    const a = actor((i % 3) * 2, Math.floor(i / 3) * 2, 0);
    B.register(a, "inmate", { game: "sim", clique: "yard", personality: p, leader: i === 0 });
    return a;
  });
  const [leader, A, brave, , , weak] = clique;
  const X = actor(3, 3, 0); B.register(X, "inmate", { game: "sim", clique: "kitchen" });
  const slap = B.social.retaliate(A, X, 0.15).map((e) => e.level);
  check(slap.length >= 3 && slap.every((l) => l === "glare" || l === "shove"), "slap -> " + slap.join(", "));
  const stab = B.social.retaliate(A, X, 0.9).map((e) => e.level);
  check(stab.some((l) => l === "fight" || l === "weapon") && stab.every((l) => l !== "glare"), "stabbing -> " + stab.join(", "));
  check(B.memory.grudge(brave, X) > 0.3, "cliquemates now hold a grudge against the stabber (" + B.memory.grudge(brave, X).toFixed(2) + ")");
  const m0 = B.morale.group("yard").morale;
  check(m0 > 0.95, "clique morale starts high (" + m0.toFixed(2) + ")");
  // the leader goes down
  leader.dead = true; leader.hp = 0;
  B.morale.death("yard", leader);
  advance(0.1);
  const G = B.morale.group("yard");
  check(G.leaderDown && G.morale < 0.5, "leader dead: morale " + m0.toFixed(2) + " -> " + G.morale.toFixed(2));
  check(B.morale.broken(weak) === true, "weakest member breaks (morale.of " + B.morale.of(weak).toFixed(2) + " < nerve " + B.morale.nerve(weak).toFixed(2) + ")");
  check(B.morale.broken(brave) === false, "bravest holds (morale.of " + B.morale.of(brave).toFixed(2) + " vs nerve " + B.morale.nerve(brave).toFixed(2) + ")");
  const I = B.tick(weak, 0.05, {});
  check(I.kind === "rout", "the broken man's intent is rout (" + I.kind + ")");
});

// =========================================================================
scenario(5, "morale parity with the old warlord + battle.html formulas", function () {
  // ---- the ORIGINALS, verbatim (src/warlord/battle.js moraleFrom/brokenSide/stepRout core)
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function oldMoraleFrom(o) {
    let mo = 1 - o.lost * 1.6 + o.theirLost * 0.55;
    if (o.leader) mo += o.leaderDown ? -0.30 : (o.leaderNear ? 0.16 : 0);
    mo -= o.malus || 0;
    mo -= clamp(o.routingFrac, 0, 1) * 0.25;
    return clamp(mo, 0, 1);
  }
  function oldBrokenSide(side, fled) {
    if (side.men0.length <= 2) return false;
    const fighting = side.alive - side.routing;
    const gone = side.deadN + side.routing + fled;
    return fighting <= Math.max(1, Math.floor(side.men0.length * 0.1)) && gone >= side.men0.length * 0.3;
  }
  let mism = 0, n = 0;
  B.seed(55);
  for (let step = 0; step < 400; step++) {
    const o = {
      lost: step / 400 * 0.9, theirLost: (step % 37) / 60, leader: step % 3 !== 0,
      leaderDown: step > 250, leaderNear: step % 2 === 0, malus: step < 40 ? 0.2 : 0,
      routingFrac: ((step * 7) % 23) / 22 * 1.2,
    };
    n++; if (oldMoraleFrom(o) !== B.morale.fromLosses(o)) mism++;
    const side = { men0: { length: 20 + (step % 5) }, alive: 20 - (step % 18), routing: step % 7, deadN: step % 9 };
    n++; if (oldBrokenSide(side, step % 4) !== B.morale.brokenSide(side, step % 4)) mism++;
  }
  check(mism === 0, "warlord moraleFrom + brokenSide: " + n + " cases, " + mism + " mismatches");
  // stepRout hysteresis (0.14), scripted morale curve down and back up
  const mOld = { routed: false }, mNew = { routed: false };
  let rm = 0;
  for (let i = 0; i < 200; i++) {
    const sm = 0.5 + 0.45 * Math.sin(i / 13), nerve = 0.3;
    if (!mOld.routed) { if (sm < nerve) mOld.routed = true; } else if (sm > nerve + 0.14) mOld.routed = false;
    B.morale.stepRout(mNew, sm, nerve);
    if (mOld.routed !== mNew.routed) rm++;
  }
  check(rm === 0, "warlord stepRout hysteresis: 200 ticks, " + rm + " mismatches");

  // ---- games/battle.html updateMorale per-army block + moraleOnDeath shock, verbatim
  const SHOCK_TAU = 7, SHOCK_K = 1.8, SUPP_K = 0.16, WOUND_K = 0.28;
  function armyRec() { return { p0: 0, pNow: 0, men0: 0, morale: 1, shock: 0, alive: 0, routing: 0, broken: false }; }
  function oldUpdate(ARMY, dt, events) {
    const k = Math.exp(-dt / SHOCK_TAU);
    ["red", "blue"].forEach(function (t) {
      const A = ARMY[t], F = ARMY[t === "red" ? "blue" : "red"];
      A.shock *= k;
      const lost = A.p0 > 0 ? Math.max(0, 1 - A.pNow / A.p0) : 0;
      const theirLost = F.p0 > 0 ? Math.max(0, 1 - F.pNow / F.p0) : 0;
      let mo = 1 - lost * 1.5 + theirLost * 0.5 - (A.alive ? A.routing / A.alive : 0) * 0.35 - A.shock;
      A.morale = Math.max(0, Math.min(1, mo));
      if (!A.broken && A.alive >= 2 && A.routing >= A.alive * 0.5) { A.broken = true; events.push(t + ":rout"); }
      else if (A.broken && A.alive - A.routing > 0 && A.routing < A.alive * 0.25) { A.broken = false; events.push(t + ":rally"); }
    });
  }
  function oldManMorale(A, m) { const hf = Math.max(0, Math.min(1, m.hp / (m.maxHp || 1))); return (A ? A.morale : 1) - (m.supp || 0) * SUPP_K - (1 - hf) * WOUND_K; }
  // two armies, tiers weighted like battle.html manWeight
  const TIER_W = { civ: 0.7, thug: 0.85, pro: 1.0, elite: 1.25, swat: 1.4 }, tiers = Object.keys(TIER_W);
  function mkArmy(team, nMen) { const out = []; for (let i = 0; i < nMen; i++) out.push({ team, tier: tiers[(i * 3 + team.length) % 5], hp: 100, maxHp: 100, dead: false, routed: false, supp: 0, w: 0 }); for (const m of out) m.w = TIER_W[m.tier]; return out; }
  const men = mkArmy("red", 24).concat(mkArmy("blue", 20));
  const OLD = { red: armyRec(), blue: armyRec() }, NEW = { red: armyRec(), blue: armyRec() };
  for (const m of men) for (const L of [OLD, NEW]) { L[m.team].p0 += m.w; L[m.team].men0++; }
  let bm = 0, ticks = 0; const evO = [], evN = [];
  for (let tick = 0; tick < 120; tick++) {
    const dt = 0.6;
    // the script: casualties, wounds, rattle, a rout wave and a partial rally
    const victim = men[(tick * 7) % men.length];
    if (tick % 3 === 0 && !victim.dead && tick < 90) {
      victim.dead = true;
      OLD[victim.team].shock += SHOCK_K * victim.w / OLD[victim.team].p0;   // old moraleOnDeath
      B.morale.deathShock(NEW[victim.team], victim.w);
    }
    const hurt = men[(tick * 5 + 3) % men.length]; if (!hurt.dead) hurt.hp = Math.max(1, hurt.hp - 17);
    for (const m of men) { m.supp = ((tick + m.w * 10) % 9) / 8; if (!m.dead) m.routed = (tick > 40 && tick < 80 && m.team === "red" && m.tier !== "swat"); }
    for (const L of [OLD, NEW]) for (const t of ["red", "blue"]) { L[t].alive = 0; L[t].routing = 0; L[t].pNow = 0; }
    for (const m of men) {
      if (m.dead) continue;
      for (const L of [OLD, NEW]) {
        const A = L[m.team]; A.alive++; if (m.routed) A.routing++;
        const hf = Math.max(0, Math.min(1, m.hp / (m.maxHp || 1)));
        A.pNow += m.w * (0.45 + 0.55 * hf);
      }
    }
    oldUpdate(OLD, dt, evO);
    for (const t of ["red", "blue"]) { const e = B.morale.armyStep(NEW[t], NEW[t === "red" ? "blue" : "red"], dt); if (e) evN.push(t + ":" + e); }
    for (const t of ["red", "blue"]) {
      ticks++;
      if (OLD[t].morale !== NEW[t].morale || OLD[t].broken !== NEW[t].broken || OLD[t].shock !== NEW[t].shock) bm++;
    }
    for (const m of men) if (!m.dead && oldManMorale(OLD[m.team], m) !== B.morale.manMorale(NEW[m.team].morale, m.supp, m.hp / m.maxHp)) bm++;
  }
  check(bm === 0, "battle.html army morale / shock / break latch / manMorale: " + ticks + " army-ticks, " + bm + " mismatches");
  check(evO.join() === evN.join() && evO.length > 0, "rout/rally events identical: " + evN.join(", "));
  let nv = 0;
  for (let i = 0; i < 40; i++) for (const t of tiers) {
    const base = { civ: 0.62, thug: 0.42, pro: 0.30, elite: 0.20, swat: 0.16 }[t];
    if (B.morale.nerveFor(t, i) !== base + (((i * 37) % 11) - 5) * 0.012) nv++;
  }
  check(nv === 0, "battle.html nerveFor (tier + seeded jitter) identical");
  check(B.morale.K.SUPP_K === 0.16 && B.morale.K.WOUND_K === 0.28, "SUPP_K 0.16 / WOUND_K 0.28 carried over");
});

// =========================================================================
scenario(6, "occlusion: a wall blocks sight, a gunshot still carries at half range", function () {
  fresh(61);
  // a wall on the plane x = 5 (from z -50..50), as a pluggable occlusion fn
  B.perception.setOcclusion(function (ox, oy, oz, tx, ty, tz) {
    if ((ox - 5) * (tx - 5) >= 0) return false;
    const t = (5 - ox) / (tx - ox), z = oz + (tz - oz) * t;
    return Math.abs(z) < 50;
  });
  const eye = actor(0, 0, Math.PI / 2);          // facing +x
  B.register(eye, "guard", { game: "sim" });
  check(B.perception.sees(eye, actor(4, 0)) === true, "sees a man 4 m ahead on this side of the wall");
  check(B.perception.sees(eye, actor(10, 0)) === false, "does NOT see a man 10 m ahead behind the wall");
  check(B.perception.sees(eye, { x: 10, y: 0, z: 0 }, { occlude: false }) === true, "opts.occlude:false ignores the wall");
  check(B.perception.seesPoint(eye, -4, 0, 0) === false, "does not see behind his own back");
  // listeners around a gunshot at x = 10 (the far side of the wall)
  const near = actor(-8, 0), far = actor(-20, 0), open = actor(35, 0);
  for (const a of [near, far, open]) B.register(a, "civilian", { game: "sim" });
  B.perception.noise(10, 0, 48, "gunshot", null);
  check(!!B.memory.heard(near), "18 m through the wall (inside half range 24 m): heard");
  check(!B.memory.heard(far), "30 m through the wall (past half range): NOT heard");
  check(!!B.memory.heard(open), "25 m in the open (full range 48 m): heard");
  B.perception.setOcclusion(null);
});

// =========================================================================
scenario(7, "budget: 600 registered brains, sense + tick, no runaway allocation", function () {
  fresh(71);
  const P = actor(0, 0, 0, { isPlayer: true });
  const crowd = [];
  for (let i = 0; i < 600; i++) {
    const a = actor((i % 30) * 4 - 60, Math.floor(i / 30) * 4 - 40, i);
    B.register(a, i % 10 === 0 ? "cop" : "civilian", { game: "sim" });
    crowd.push(a);
  }
  const ctx = { target: P };
  const t0 = process.hrtime.bigint();
  for (let f = 0; f < 120; f++) {
    advance(1 / 60);
    if (f % 30 === 0) B.perception.noise(0, 0, 48, "gunshot", P);
    for (let i = 0; i < crowd.length; i++) B.tick(crowd[i], 1 / 60, ctx);
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 120;
  console.log("    " + ms.toFixed(3) + " ms / frame for 600 brains");
  check(ms < 8, "600 brains tick under 8 ms a frame in node (" + ms.toFixed(2) + " ms)");
});

// =========================================================================
scenario(8, "prison minor matter: frisk + warning, no cuffs; survivors keep to shelter; schedule + drives", function () {
  fresh(81);
  const g = actor(0, 0, 0), inm = actor(0, 3, Math.PI);
  B.register(g, "guard", { game: "sim" });
  B.authority.begin(g, inm, "contraband", { minor: true });
  let r = null;
  for (let i = 0; i < 200; i++) { r = B.authority.step(g, 0.05, { speed: 0, kneeling: true }); integrate(g, 0.05); advance(0.05); if (r.phase === "done") break; }
  check(g._brain.case.outcome === "warned" && verbs.some((v) => v.name === "frisk") && !verbs.some((v) => v.name === "restrain"), "minor + complied = frisk and a warning, no cuffs (" + g._brain.case.outcome + ")");
  // disaster: the same hazard, one survivor out in the open, one sheltered
  const out = actor(0, 0, 0), inside = actor(5, 0, 0);
  B.register(out, "survivor", { game: "sim", personality: { courage: 0.3, discipline: 0.3 } });
  B.register(inside, "survivor", { game: "sim", personality: { courage: 0.3, discipline: 0.3 } });
  const hz = { x: 30, z: 0, kind: "hazard", armed: false, aimingAtMe: false };
  const a1 = B.threat.respond(out, hz);
  const a2 = B.threat.respond(inside, Object.assign({ sheltered: true }, hz));
  check(a1 === "flee" && a2 === "cover", "hazard: out in the open " + a1 + ", in a shelter " + a2);
  // routine + drives
  B.needs.define("inmate", [{ id: "lights", from: 22, activity: "sleep" }, { id: "wake", from: 6, activity: "breakfast" }, { id: "yard", from: 10, activity: "yard" }, { id: "count", from: 17, activity: "count" }]);
  const i2 = actor(0, 0, 0); B.register(i2, "inmate", { game: "sim" });
  check(B.needs.current(i2, 23.5).activity === "sleep" && B.needs.current(i2, 3).activity === "sleep" && B.needs.current(i2, 12).activity === "yard", "schedule wraps through midnight (23:30 + 03:00 sleep, noon yard)");
  B.needs.drive(i2, "hunger", -0.9);
  check(B.needs.top(i2) === "hunger", "the emptied drive is the most urgent (" + B.needs.top(i2) + ")");
});

// =========================================================================
scenario(9, "core follow-up: idempotent morale, clear/recycle, per-game walls, nerve, reason 0, reports, hold/disarm/force", function () {
  // ---- 1. morale.tick idempotent per clock stamp; single group; memory.tick owns rattle
  fresh(91);
  const m1 = actor(0, 0, 0), m2 = actor(1, 0, 0);
  B.register(m1, "inmate", { game: "sim", clique: "a" }); B.register(m2, "inmate", { game: "sim", clique: "b" });
  B.morale.hit("a", 0.5); B.morale.hit("b", 0.5);
  T += 1; B.clock(T);
  B.morale.tick(1); const sA = B.morale.group("a").shock; B.morale.tick(1);
  check(B.morale.group("a").shock === sA, "a second morale.tick on the same clock stamp is a no-op");
  T += 1; B.clock(T);
  B.morale.tick(1, "a");
  check(B.morale.group("a").shock < sA && B.morale.group("b").shock === sA, "tick(dt, groupId) ticks only that group");
  B.morale.rattle(m1, 1); B.memory.tick(m1, 0.5); const r1 = m1._brain.rattle;
  T += 0.5; B.clock(T); B.morale.tick(0.5);
  check(m1._brain.rattle === r1, "memory-ticked brain: morale.tick does not drain his rattle again");
  B.morale.rattle(m2, 1); const r2 = m2._brain.rattle; T += 0.5; B.clock(T); B.morale.tick(0.5);
  check(m2._brain.rattle < r2, "a brain nobody memory-ticks is drained by morale.tick");
  // ---- 2. clear / unregister / recycled body
  fresh(92);
  const crew = [0, 1, 2, 3].map((i) => { const a = actor(i, 0, 0); B.register(a, "crew", { game: "sim", group: "g" }); return a; });
  check(B.morale.group("g").men0 === 4, "group counts 4");
  crew[0].dead = true; crew[0].hp = 0; B.unregister(crew[0]);
  check(B.morale.group("g").men0 === 4 && B.morale.group("g").members.length === 3, "a dead man leaves the members but his loss stays");
  crew[0].dead = false; crew[0].hp = 100; B.register(crew[0], "crew", { game: "sim", group: "g" });
  check(B.morale.group("g").men0 === 4 && B.morale.group("g").members.length === 4, "the recycled body refills his slot, starting size stays 4");
  B.unregister(crew[1]);
  check(B.morale.group("g").men0 === 3, "unregistering a live man removes him from his group");
  B.morale.config("g", { lostK: 1 }); B.morale.clear("g");
  const G = B.morale.group("g");
  check(G.men0 === 0 && G.members.length === 0 && G.k.lostK === 1 && crew[2]._brain._gid == null, "morale.clear empties the group, keeps its config");
  // ---- 3. occlusion per game
  fresh(93);
  const ga = actor(0, 0, Math.PI / 2), gb = actor(0, 5, Math.PI / 2);
  B.register(ga, "guard", { game: "walls" }); B.register(gb, "guard", { game: "open" });
  B.perception.setOcclusion(() => true, "walls");
  check(!B.perception.sees(ga, actor(6, 0)) && B.perception.sees(gb, actor(6, 5)), "setOcclusion(fn, game) walls one game only");
  B.perception.setOcclusion(null, "walls");
  check(B.perception.sees(ga, actor(6, 0)), "clearing it restores the global default");
  // ---- 4. nerve + no RNG when the whole person is handed in
  fresh(94);
  const before = B.rng(); fresh(94);
  const full = { courage: 0.5, aggression: 0.5, discipline: 0.5, curiosity: 0.5, loyalty: 0.5 };
  const det = actor(0, 0, 0); B.register(det, "inmate", { game: "sim", personality: full, nerve: 0.33 });
  check(B.rng() === before, "full personality + nerve consume no brain RNG");
  check(B.morale.nerve(det) === 0.33, "register({ nerve }) is the man's break point");
  // ---- 5. reason 0: seen, not suspicious -> the meter drains
  fresh(95);
  const scr = actor(0, 0, 0), man = actor(0, 8, 0);
  B.register(scr, "guard", { game: "sim" });
  B.memory.setAware(scr, man, 0.8, 0);
  B.perception.awareness(scr, man, 0.5, { reason: 0 });
  const rec = B.memory.aware(scr, man);
  check(rec.visible === true && rec.aware < 0.8, "reason 0 while visible drains (" + rec.aware.toFixed(3) + ") and still marks him seen");
  // ---- 6. reports: bias, heat/type, hold + fileNow, accuse
  fresh(96);
  const got = [];
  B.social.onReport("sim", (r) => got.push(r));
  B.social.setReportBias(() => 0, "sim");
  const civ = actor(0, 4, Math.PI); B.register(civ, "sim_snitch", { game: "sim" });
  B.social.crime("assault", 0, 0, actor(0, 0), 0.5, { game: "sim", heat: 40, type: "assault" });
  check(civ._brain.witness.reportAt == null, "setReportBias 0 means nobody in that game calls");
  B.social.setReportBias(null, "sim");
  B.social.crime("assault", 0, 0, actor(0, 0), 0.6, { game: "sim", heat: 40, type: "assault" });
  check(B.social.holdReport(civ) && civ._brain.witness.reportAt === Infinity, "holdReport keeps it until he gets there");
  for (let i = 0; i < 40; i++) advance(0.5);
  check(got.length === 0, "a held report never lands on its own");
  check(B.social.fileNow(civ) && got.length === 1 && got[0].heat === 40 && got[0].type === "assault", "fileNow lands it at once, heat/type carried (" + got.length + ")");
  const lone = actor(3, 3); B.register(lone, "inmate", { game: "sim" });
  B.social.accuse(lone, civ, "stole", 0.4, { game: "sim", heat: 12 });
  check(got.length === 2 && got[1].witness === lone && got[1].perp === civ && got[1].heat === 12, "accuse: a lone grudge-holder reports");
  // ---- 8. inmates can report inmates
  const i1 = actor(0, 0), i2 = actor(1, 0);
  B.register(i1, "inmate", { game: "sim" }); B.register(i2, "inmate", { game: "sim" });
  check(B.social.attitude(i1, i2) === 0.2 && B.social.attitude(civ, actor(9, 9)) === 0, "inmate selfAttitude 0.2");
  // ---- 7 / 9 / 10 / 11: authority
  fresh(97);
  const ag = actor(0, 0, 0), walker = actor(0, 5, Math.PI);
  B.register(ag, "agent_cp", { game: "sim" });
  B.authority.begin(ag, walker, "approach", { hold: true, roe: "nonlethal", patience: 1 });
  let r = null;
  for (let i = 0; i < 80; i++) { r = B.authority.step(ag, 0.05, { speed: 1.2, armed: false }); walker.pos.z += 0.06; advance(0.05); if (!r || r.phase === "done") break; }
  check(ag._goal == null, "hold: the agent never walks or chases (outcome " + ag._brain.case.outcome + ")");
  fresh(98);
  const cop = actor(0, 0, 0), gunman = actor(0, 5, Math.PI);
  B.register(cop, "cop", { game: "sim" });
  B.authority.begin(cop, gunman, "open carry", { comply: "disarm", outcome: "release", rechallenge: true });
  let ph = [];
  const st = { speed: 1, armed: true };
  for (let i = 0; i < 200; i++) { r = B.authority.step(cop, 0.05, st); if (ph[ph.length - 1] !== r.phase) ph.push(r.phase); if (i === 30) st.armed = false; advance(0.05); if (r.phase === "done") break; }
  check(cop._brain.case.outcome === "released" && !verbs.some((v) => v.name === "restrain"), "gun-stop: holstered = released, no cuffs (" + ph.join(">") + ")");
  const p1 = cop._brain.case.patience;
  B.authority.begin(cop, gunman, "open carry", { comply: "disarm", rechallenge: true });
  check(cop._brain.case.patience < p1 && cop._brain.case.challengeN === 2, "re-challenge inside 60 s is shorter (" + p1 + " -> " + cop._brain.case.patience + ")");
  check(cop._brain.movedAt > -1e9 && cop._brain.movedFrame >= 0 && !B.act.movedThisFrame(cop), "act records movedAt / movedFrame (and a new frame clears movedThisFrame)");
  // no taser here: straight to the tackle, and a man merely walking off in reach is tackled
  fresh(99);
  B.act.use("notaser", { verb(name, a, b) { verbs.push({ name, a, b }); return name === "tase" ? false : { ok: true }; }, moveTo() { return true; }, stop() { return true; }, face() { return true; } });
  const c2 = actor(0, 0, 0), w2 = actor(0, 2, 0);
  B.register(c2, "cop", { game: "notaser" });
  B.authority.begin(c2, w2, "theft", { skipWarn: true, patience: 0.5 });
  for (let i = 0; i < 60; i++) { r = B.authority.step(c2, 0.05, { speed: 1.8, armed: false }); advance(0.05); if (verbs.some((v) => v.name === "tackle")) break; }
  check(verbs.some((v) => v.name === "tase") && verbs.some((v) => v.name === "tackle"), "taser answered false -> tackle; a walking (not running) non-complier in reach is tackled");
  // police.js's gun-stop exactly as it begins it: hold + silent + complyHold 0
  fresh(100);
  const beat = actor(0, 0, 0), carrier = actor(0, 3, Math.PI);
  B.register(beat, "cop", { game: "sim" });
  const GS = { comply: "disarm", outcome: "release", rechallenge: true, patience: 14, hold: true, silent: true, skipWarn: true, warnRange: 16, complyHold: 0, roe: "nonlethal" };
  const K1 = B.authority.begin(beat, carrier, "open carry", GS);
  const gst = { speed: 0, armed: true, dist: 3 };
  for (let i = 0; i < 20; i++) { B.authority.step(beat, 0.05, gst); advance(0.05); }
  gst.armed = false;
  B.authority.step(beat, 0.05, gst);
  check(K1.outcome === "released" && said.length === 0 && beat._goal == null, "gun-stop: the frame he holsters, released; silent, never walked");
  const K2 = B.authority.begin(beat, carrier, "open carry", GS);
  gst.armed = true; let last = null;
  for (let i = 0; i < 400 && K2.active; i++) { last = B.authority.step(beat, 0.05, gst); advance(0.05); if (last.phase === "escalate") break; }
  check(last && last.phase === "escalate" && K2.t < 7.2 && K2.t > 6.8, "gun-stop re-challenge: patience 7 s, then escalate (" + K2.t.toFixed(2) + " s)");
});

// =========================================================================
// ROUTER SCENARIOS — prison / city / President / disaster+war leads add theirs
// below this line, as scenario(<n>, "<name>", fn). Keep the core ones above.
// =========================================================================

// ---- run ------------------------------------------------------------------
const only = process.argv.slice(2).map(Number).filter((n) => n > 0);
for (const s of scenarios) {
  if (only.length && !only.includes(s.n)) continue;
  console.log("\n[" + s.n + "] " + s.name);
  try { s.fn(); } catch (e) { fails++; console.log("  FAIL threw: " + (e && e.stack || e)); }
}
console.log("\n" + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);

#!/usr/bin/env node
/* tools/melee-sim.mjs — DOGFOOD THE FIGHT: real rigs brawling in plain node.

   Real three r128 rigs (entities/character.js), the real pose layer
   (entities/meleeposes.js), the real blow (systems/verbs_strike.js: a punch
   lands on the frame the fist meets a zone of the other man's live rig) and
   the real brain (systems/melee.js: the fighter, the ring) through
   tools/lib/verbs-vm.mjs, at 60 fps. The only thing this file adds is what a
   game page adds: who is on which side, walking to the fight, and an hp
   gauge (a blow costs 4 + 9 x its force x where it landed; out of hp is a
   stoppage, the way a ref or a crowd ends it).

     node tools/melee-sim.mjs              all scenarios, the table
     node tools/melee-sim.mjs --quick      fewer bouts
     node tools/melee-sim.mjs --json       machine-readable

   Scenarios: 1v1 even, 1v1 a skilled man vs a novice, a FRESH man vs a
   TIRED one (same skill; the tired one starts gassed and winded), 1v3 (a
   good fighter against three), and a 10v10 brawl. Reported: who wins, how
   long it takes, knockdowns and knockouts per fight, how fights end (KO,
   stoppage, gave up, ran), how many blows land and where, and in the group
   fights how the attackers spread round a man and how many swing at once. */
import { loadVerbsVM } from "./lib/verbs-vm.mjs";

const QUICK = process.argv.includes("--quick");
const JSON_OUT = process.argv.includes("--json");
const DT = 1 / 60;

function runScenario(name, makeTeams, bouts, maxT, seed0) {
  const W = loadVerbsVM({ mode: "slice", seed: seed0 });
  const { CBZ } = W;
  const V = CBZ.verbs, ML = CBZ.melee;
  if (!ML || !V.fighter) throw new Error("melee.js did not load: " + W.errors.join(" / "));
  CBZ.doHitstop = () => {}; CBZ.shake = () => {};
  const out = { name, bouts: 0, redWins: 0, blueWins: 0, draws: 0, dur: [], kd: 0, ko: 0, ends: { ko: 0, stoppage: 0, yield: 0, flee: 0, time: 0 },
    thrown: 0, landed: 0, gnp: 0, blocked: 0, parried: 0, zones: {}, kinds: {}, swingersMax: 0, swingersAvg: 0, swingersN: 0, spread: [], counters: 0, blind: 0 };
  for (let b = 0; b < bouts; b++) {
    W.clearActors();
    const seed = seed0 * 977 + b * 131;
    let rs = seed >>> 0;
    const rnd = () => { rs = (rs + 0x6D2B79F5) >>> 0; let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const teams = makeTeams(rnd);
    const men = [];
    for (const side of ["red", "blue"]) {
      const list = teams[side];
      list.forEach((spec, i) => {
        const x = (i - (list.length - 1) / 2) * 1.6 + (rnd() - 0.5) * 0.4;
        const z = (side === "red" ? -1 : 1) * (2.6 + rnd() * 0.6);
        const a = W.actor({ x, z, yaw: side === "red" ? 0 : Math.PI, bot: true, name: side + i });
        a.char.phase = 0; a.char.breath = 0;
        a.team = side; a.hp = 100; a.maxHp = 100; a.out = null;
        a._chinRoll = rnd();
        const F = V.fighter(a, { skill: spec.skill, aggression: spec.aggr, seed: (seed + i * 7 + (side === "red" ? 0 : 999)) | 0, style: spec.style, weapon: spec.weapon || null });
        if (spec.tired) {
          F.stam = 0.12;
          const c = V.condition(a); c.wind = 0.7; c.gst = 0.3;
        }
        a.F = F; a.spec = spec;
        men.push(a);
      });
    }
    const downsAt = new Map(men.map((m) => [m, 0]));
    const onLand = (res) => {
      const t = res.target, a = res.attacker;
      if (!t || t.out || t.dead) { res.reaction = "none"; return; }
      const gnp = res.kind === "gnp" || res.kind === "gnpElbow" || res.kind === "hammer";
      if (gnp) out.gnp++; else out.landed++;
      if (res.blocked) out.blocked++;
      if (res.parried) out.parried++;
      if (res.counter) out.counters++;
      if (res.blind) out.blind++;
      out.zones[res.zone] = (out.zones[res.zone] || 0) + 1;
      // a blade CUTS: the gauge drops twice as fast (a game opens a bleed instead)
      const dmg = (3 + 7 * (res.force || res.power || 0.5)) * (res.dmgMul == null ? 1 : res.dmgMul) * (res.weapon && res.weapon.blade ? 2 : 1);
      t.hp -= dmg;
      if (res.ko) { t.out = "ko"; return; }
      if (t.hp <= 0) {
        // the stoppage: he cannot defend himself any more
        t.out = "stoppage";
        res.reaction = "knockdown"; res.ko = true;
      }
      void a;
    };
    const O = { perform: true, quit: true, onLand };
    let t = 0, winner = null, end = "time";
    const alive = (m) => !m.out && !m.dead;
    for (; t < maxT; t += DT) {
      // ---- each man's brain: pick the man to fight, fight him, walk to him
      for (const m of men) {
        if (!alive(m)) { W.setSpeed(m, 0); continue; }
        const B = V.body(m);
        if (B.down()) { W.setSpeed(m, 0); continue; }
        let best = null, bs = 1e9;
        for (const e of men) {
          if (e.team === m.team || !alive(e)) continue;
          const d = Math.hypot(e.pos.x - m.pos.x, e.pos.z - m.pos.z);
          const s = d + 0.9 * ML.attackersOn(e) * (m.F.target === e ? 0 : 1) - (m.F.target === e ? 0.8 : 0);
          if (s < bs) { bs = s; best = e; }
        }
        if (!best) { W.setSpeed(m, 0); continue; }
        const act = m.F.tick(DT, best, O);
        if (m.F.quit) { m.out = m.F.quit; continue; }
        if (act && act.type === "strike") out.thrown++;
        if (act && act.type === "strike") out.kinds[act.kind] = (out.kinds[act.kind] || 0) + 1;
        // walk in (a game page's own steering); inside 2.3 m the fighter's
        // footwork owns the feet
        const d = Math.hypot(best.pos.x - m.pos.x, best.pos.z - m.pos.z);
        const g = m.F.goal;
        if (g.on && !V.strikeOf(m) && (d > 2.3 || Math.hypot(g.x - m.pos.x, g.z - m.pos.z) > 0.6)) {
          const gx = g.x - m.pos.x, gz = g.z - m.pos.z, gl = Math.hypot(gx, gz);
          if (gl > 0.3 && !(m.char.footStep && m.char.footStep.on)) {
            const v = gl > 3 ? 3.2 : 1.3;
            m.pos.x += gx / gl * v * DT; m.pos.z += gz / gl * v * DT;
            m.group.rotation.y = Math.atan2(gx, gz);
            W.setSpeed(m, v);
          } else W.setSpeed(m, 0);
        } else W.setSpeed(m, 0);
      }
      // ---- bodies do not stand inside each other
      for (let i = 0; i < men.length; i++) {
        const a = men[i]; if (a.dead || V.body(a).down()) continue;
        for (let j = i + 1; j < men.length; j++) {
          const c = men[j]; if (c.dead || V.body(c).down()) continue;
          const dx = c.pos.x - a.pos.x, dz = c.pos.z - a.pos.z, d = Math.hypot(dx, dz);
          if (d < 0.62 && d > 1e-4) { const k = (0.62 - d) * 0.5 / d; a.pos.x -= dx * k; a.pos.z -= dz * k; c.pos.x += dx * k; c.pos.z += dz * k; }
        }
      }
      W.frame(DT);
      // ---- the knockdowns (any fall) and the men put out
      for (const m of men) {
        const c = m._mc;
        if (c && c.downs > downsAt.get(m)) { out.kd += c.downs - downsAt.get(m); downsAt.set(m, c.downs); }
        if (m.out === "ko" || m.out === "stoppage") {
          if (!m._counted) { m._counted = true; out.ko += m.out === "ko" ? 1 : 0; if (m.F) m.F.leave(); m.ko = 999; }
        }
      }
      // ---- the ring census: how many swing at once, how spread they are
      if (men.length > 2 && ((t * 60) | 0) % 6 === 0) {
        for (const m of men) {
          if (!alive(m)) continue;
          const ring = ML.ring(m).filter((q) => alive(q) && !V.body(q).down());
          if (ring.length < 2) continue;
          let sw = 0;
          for (const q of ring) { const S = V.strikeOf(q); if (S && S.p < 0.62) sw++; }
          out.swingersMax = Math.max(out.swingersMax, sw);
          out.swingersAvg += sw; out.swingersN++;
          // the widest gap between attackers round him (radians): small = surrounded
          const ang = ring.map((q) => Math.atan2(q.pos.x - m.pos.x, q.pos.z - m.pos.z)).sort((p, q) => p - q);
          let gap = 0;
          for (let k = 0; k < ang.length; k++) gap = Math.max(gap, ((ang[(k + 1) % ang.length] - ang[k]) + Math.PI * 2) % (Math.PI * 2) || Math.PI * 2);
          out.spread.push(Math.PI * 2 - gap);
        }
      }
      const rl = men.some((m) => m.team === "red" && alive(m)), bl = men.some((m) => m.team === "blue" && alive(m));
      if (!rl || !bl) { winner = rl ? "red" : bl ? "blue" : null; break; }
    }
    out.bouts++;
    out.dur.push(t);
    if (winner === "red") out.redWins++; else if (winner === "blue") out.blueWins++; else out.draws++;
    // how the LOSING side's last man went
    const lost = men.filter((m) => m.team !== winner && m.out);
    if (!winner) out.ends.time++;
    else for (const m of lost) out.ends[m.out] = (out.ends[m.out] || 0) + 1;
  }
  if (W.errors.length) out.errors = W.errors.slice(0, 5);
  return out;
}

const N = QUICK ? 0.5 : 1;
const fresh = (s, a) => ({ skill: s, aggr: a });
const results = [];
const t0 = Date.now();
results.push(runScenario("1v1 even (skill .5 v .5)", () => ({ red: [fresh(0.5, 0.6)], blue: [fresh(0.5, 0.6)] }), Math.round(20 * N), 120, 11));
results.push(runScenario("1v1 pro (.85) v novice (.25)", () => ({ red: [fresh(0.85, 0.6)], blue: [fresh(0.25, 0.6)] }), Math.round(14 * N), 120, 12));
results.push(runScenario("1v1 FRESH (red) v TIRED (blue), both .5", () => ({ red: [fresh(0.5, 0.6)], blue: [{ skill: 0.5, aggr: 0.6, tired: true }] }), Math.round(20 * N), 120, 13));
results.push(runScenario("1v1 BAT (red) v fists, both .5", () => ({ red: [{ skill: 0.5, aggr: 0.6, weapon: { kind: "bat" } }], blue: [fresh(0.5, 0.6)] }), Math.round(10 * N), 120, 16));
results.push(runScenario("1v1 KNIFE (red) v fists, both .5", () => ({ red: [{ skill: 0.5, aggr: 0.6, weapon: { kind: "knife", blade: true } }], blue: [fresh(0.5, 0.6)] }), Math.round(10 * N), 120, 17));
results.push(runScenario("1v3: one .8 (red) v three .4", () => ({ red: [fresh(0.8, 0.65)], blue: [fresh(0.4, 0.6), fresh(0.4, 0.6), fresh(0.4, 0.6)] }), Math.round(10 * N), 120, 14));
results.push(runScenario("10v10 street brawl (mixed .2-.8)", (r) => ({
  red: Array.from({ length: 10 }, () => fresh(0.2 + 0.6 * r(), 0.4 + 0.5 * r())),
  blue: Array.from({ length: 10 }, () => fresh(0.2 + 0.6 * r(), 0.4 + 0.5 * r())),
}), Math.max(1, Math.round(3 * N)), 150, 15));
const secs = (Date.now() - t0) / 1000;

const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
if (JSON_OUT) { console.log(JSON.stringify({ secs, results }, null, 1)); process.exit(0); }
console.log("\nmelee-sim — real rigs, real blows, the real brain (" + secs.toFixed(1) + " s)\n");
for (const r of results) {
  const n = r.bouts;
  console.log("== " + r.name + "  (" + n + " fights)");
  console.log("   wins red/blue/draw " + r.redWins + "/" + r.blueWins + "/" + r.draws +
    "   duration median " + med(r.dur).toFixed(1) + " s (avg " + avg(r.dur).toFixed(1) + ")");
  console.log("   knockdowns " + (r.kd / n).toFixed(2) + "/fight, knockouts " + (r.ko / n).toFixed(2) + "/fight" +
    "   ends: " + Object.entries(r.ends).filter(([, v]) => v).map(([k, v]) => k + " " + v).join(", "));
  console.log("   blows thrown " + (r.thrown / n).toFixed(0) + "/fight, landed " + (r.landed / Math.max(1, r.thrown) * 100).toFixed(0) + "%" +
    " (blocked " + (r.blocked / Math.max(1, r.landed) * 100).toFixed(0) + "% of contacts, parried " + r.parried +
    ", counters " + r.counters + ", blind " + r.blind + ", ground-and-pound blows " + r.gnp + ")");
  const zt = Object.values(r.zones).reduce((x, y) => x + y, 0) || 1;
  console.log("   where: " + Object.entries(r.zones).sort((p, q) => q[1] - p[1]).map(([k, v]) => k + " " + (v / zt * 100).toFixed(0) + "%").join("  "));
  const kt = Object.values(r.kinds).reduce((x, y) => x + y, 0) || 1;
  console.log("   thrown: " + Object.entries(r.kinds).sort((p, q) => q[1] - p[1]).slice(0, 10).map(([k, v]) => k + " " + (v / kt * 100).toFixed(0) + "%").join("  "));
  if (r.swingersN) console.log("   ring: swinging at once avg " + (r.swingersAvg / r.swingersN).toFixed(2) + " max " + r.swingersMax +
    ", attackers spread round a man (median arc) " + (med(r.spread) * 180 / Math.PI).toFixed(0) + " deg");
  if (r.errors) console.log("   ERRORS: " + r.errors.join(" | "));
}

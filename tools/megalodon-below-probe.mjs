#!/usr/bin/env node
/* tools/megalodon-below-probe.mjs — THE FAST ORACLE for §THE ASCENT.

   The before/after report is the deliverable, but a visual-compare run is two
   full browser boots and several minutes, which is a terrible loop to iterate
   a behaviour in. This is the same staging with no screenshots and no PDF: it
   boots the seeded city into free play, puts a real SWIMMER in deep water at
   an authored depth, drops a megalodon in the dark underneath, commits the
   production predatorHunt FSM at the player, and prints what the engine's own
   seams say happened — per game second.

   IT STAGES A DIVER, NOT A RIDDEN SHARK, and that took a run to learn. Shark
   Sim is the obvious venue and it is the wrong one: the player there is
   mounted, a mounted shark must keep swimming, and the whole hunt was
   photographed with the "diver" fleeing the scene at 22 m/s (measured: the
   gap grew 36 m -> 226 m while the megalodon closed at full rush speed). The
   owner's shot is somebody treading water and looking down. So this uses the
   same seam tools/visual-presets/underwater-look.mjs does — CBZ.citySwimBegin
   — which puts the player in the sea at a depth and leaves him there.

   It asks exactly the four questions the feature is about:

     1. Is the megalodon UNDER its quarry?      (belowQuarryM > 0)
     2. Does it CLIMB?                          (climbing, vyMS)
     3. Does the nose point where it is going?  (pitchDeg, derived not authored)
     4. Does it ARRIVE at the diver's depth rather than biting from the dark?

   Run it against both code paths — the flag is the whole A/B:

     node tools/megalodon-below-probe.mjs
     node tools/megalodon-below-probe.mjs --ascent-off      (the old behaviour)
     node tools/megalodon-below-probe.mjs --json
*/
import { launch, sleep } from "./lib/cdp.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const OFF = has("--ascent-off");
const JSON_OUT = has("--json");
const SEED = arg("--seed", "90210");
const DIVE_M = +arg("--dive", "14");
const SECS = +arg("--secs", "16");
/* --trace-y: install a write trap on the megalodon's group.position.y and log
   any single assignment that moves it more than 3 m, with a stack. Off by
   default because it monkeypatches a live THREE.Vector3, but it earned its
   place: it is how the 23 m one-frame teleport in this act was traced to
   city/creature_combat.js's animateAttack slamming every swimming attacker to
   its nominal resting draft for the duration of a bite — a bug older than this
   feature and invisible to every number the probe prints. */
const TRACE_Y = has("--trace-y");
const say = (m) => { if (!JSON_OUT) console.log(m); };

const q = OFF ? "&cfg_SHARK_ASCENT=0" : "";
const rig = await launch({ rafBudget: 0 });
await rig.open("index.html", `seed=${SEED}&cfg_BOOT_METER=0${q}`);
if (!await rig.wait("window.CBZ && CBZ.game && CBZ.stepSim", 240000)) {
  console.error("page never published CBZ"); await rig.close(); process.exit(1);
}

const burst = (sec) => rig.evl(
  `(() => { for (let i=0,n=${Math.max(1, Math.round(sec * 30))}; i<n; i++) { CBZ.hitstop=0; CBZ.slowmo=0; CBZ.stepSim(1/30); } return true; })()`);
async function evl(src) { return rig.evl(`(()=>{try{return (${src})}catch(e){return {__err:String(e&&e.message||e)}}})()`); }
const die = async (m) => {
  console.error(m);
  const jumps = await evl(`(window.__yJumps||[])`);
  if (Array.isArray(jumps) && jumps.length) {
    say("\n  Y JUMPS (>3 m in one assignment)");
    for (const j of jumps.slice(0, 6)) say(`    ${j.from} -> ${j.to}\n       ${j.at}`);
  }
  await rig.close();
  process.exit(1);
};

// ---- boot into free play ---------------------------------------------------
say(`booting free play  (SHARK_ASCENT ${OFF ? "OFF — the old code path" : "ON"})`);
if (!await rig.wait("CBZ.game && (CBZ.bootComplete || CBZ.game.state==='title') && CBZ.stepSim && document.getElementById('playBtn')", 300000)) {
  await die("never booted");
}
await rig.evl(`(()=>{ if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false; return 1 })()`);
if (!await rig.wait(`(()=>{ if (CBZ.game.state==='playing') return true; const b=document.getElementById('playBtn'); if(b)b.click(); return CBZ.game.state==='playing'; })()`, 180000)) {
  await die("never reached playing");
}
await rig.evl(`(()=>{ try{ if(CBZ.setQualityLevel) CBZ.setQualityLevel(3); }catch(e){}
                      try{ if(CBZ.dayPhase) CBZ.dayPhase(0.25); }catch(e){}
                      window.requestAnimationFrame = function(){ return 0; }; return 1 })()`);
await sleep(700);
await burst(3);
say("  ✓ playing");

// ---- find deep water, put a SWIMMER in it ---------------------------------
const place = await evl(`(() => {
  const P = CBZ.player, Z = -300;
  if (!CBZ.waterField || !CBZ.waterField.shoreAt) return { __err: "no shore field" };
  const shoreAt = (x) => CBZ.waterField.shoreAt(x, Z);
  let inner = null, outer = null;
  for (let x = 0; x < 16000; x += 40) {
    const s = shoreAt(x);
    if (s > 0) inner = x; else if (inner != null) { outer = x; break; }
  }
  if (outer == null) return { __err: "no coast" };
  let a = inner, b = outer;
  for (let i = 0; i < 26; i++) { const m = (a+b)/2; if (shoreAt(m) > 0) a = m; else b = m; }
  let best = null, bestD = -1;
  for (let off = 300; off < 4000; off += 60) {
    const x = b + off;
    const d = CBZ.cityWaterDepthAt ? CBZ.cityWaterDepthAt(x, Z) : 0;
    if (d > bestD) { bestD = d; best = x; }
    if (d >= 60) { best = x; bestD = d; break; }
  }
  const x = best, z = Z;
  const surf = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : 0;
  const y = surf - ${DIVE_M};
  P.pos.set(x, y, z);
  if (CBZ.citySwimBegin) CBZ.citySwimBegin({ y: y });
  P.hp = 100;
  return { x: +x.toFixed(1), z: z, columnM: +bestD.toFixed(1), surfY: +surf.toFixed(2) };
})()`);
if (!place || place.__err) await die("place failed: " + (place && place.__err));
await burst(1.5);
const swimming = await evl(`(() => {
  const P = CBZ.player;
  const surf = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(P.pos.x, P.pos.z) : 0;
  return { swim: !!(CBZ.citySwimming && CBZ.citySwimming()), depth: +(surf - P.pos.y).toFixed(1) };
})()`);
say(`  ✓ column ${place.columnM} m — diver at ${swimming.depth} m, swimming=${swimming.swim}`);

// ---- a megalodon in the dark underneath, committed at the diver -----------
const spawn = await evl(`(() => {
  const P = CBZ.player;
  /* THIS BEAT IS ABOUT THE PLAYER BEING HUNTED, NOT ABOUT THE FOOD WEB.
     marine_predation.js gets first refusal on every aquatic actor and it wins:
     left on, it hands this megalodon a fish hundreds of metres away and drives
     it off across the map, and the hunt we committed never runs at all
     (measured: gapM 435, quarry at the surface). Off for the duration, on both
     columns identically, so the FSM under test is the one photographed. */
  if (CBZ.CONFIG) CBZ.CONFIG.MARINE_PREDATION = false;
  if (!CBZ.cityWildlifeSpawnAt) return { __err: "no spawner" };
  const m = CBZ.cityWildlifeSpawnAt("megalodon", P.pos.x + 40, P.pos.z + 10);
  if (!m) return { __err: "no megalodon" };
  m.__probe = 1;
  return { ok: 1 };
})()`);
if (!spawn || spawn.__err) await die("spawn failed: " + (spawn && spawn.__err));
for (let t = 0; t < 40; t++) {
  const built = await evl(`(() => { for (const w of CBZ.cityWildlife||[]) if (w.__probe && w.group && w.group.children.length) return true; return false; })()`);
  if (built === true) break;
  await burst(0.3);
}

const staged = await evl(`(() => {
  const P = CBZ.player;
  let m = null;
  for (const w of CBZ.cityWildlife||[]) if (w.__probe) { m = w; break; }
  if (!m || !m.group) return { __err: "lost it" };
  const surf = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(P.pos.x, P.pos.z) : 0;
  const col = CBZ.cityWaterDepthAt ? CBZ.cityWaterDepthAt(P.pos.x, P.pos.z) : 60;
  const down = Math.min(col - 6, ${DIVE_M} + 26);
  const y = surf - down;
  m.pos.x = P.pos.x + 30; m.pos.z = P.pos.z + 4; m.pos.y = y;
  m.group.position.set(m.pos.x, y, m.pos.z);
  /* AND POINT IT AT THE DIVER. Not a cheat — the state a committing shark is
     already IN. A rush is the last beat of scent -> circle -> commit, so by the
     time it fires the animal has been orbiting its quarry and is bow-on. Drop
     one in cold at a spawn heading and you photograph something else entirely:
     measured, it started 151 degrees off, and a 20 m body turning at 0.69 rad/s
     while making 18.5 m/s has a ~27 m turn radius, so it physically cannot come
     round onto something 47 m away before the rush times out. That is correct
     physics for an animal that size and it is exactly why the real FSM spends
     the circle getting lined up first. */
  m.heading = Math.atan2(P.pos.z - m.pos.z, P.pos.x - m.pos.x);
  if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(m.group, m.heading);
  if (m._waterMove) { m._waterMove.x = m.pos.x; m._waterMove.z = m.pos.z; }
  if (m._shark) { m._shark.dive = surf - y; m._shark.bail = 0; }
  m.hunger = 1;
  if (CBZ.predatorCommit) CBZ.predatorCommit(m, CBZ.player);
  // TRAP WHOEVER ELSE MOVES THIS BODY. A jump of >3 m in one assignment is not
  // a swim stroke; log where it came from.
  window.__yJumps = [];
  if (!${TRACE_Y}) return { startDepth: +(surf - y).toFixed(1), draft: +(m.swimDepth||0).toFixed(2), colM: +col.toFixed(1) };
  const gp = m.group.position;
  let _y = gp.y;
  Object.defineProperty(gp, "y", {
    configurable: true,
    get: function () { return _y; },
    set: function (v) {
      if (Math.abs(v - _y) > 3 && window.__yJumps.length < 12) {
        window.__yJumps.push({ from: +_y.toFixed(2), to: +v.toFixed(2),
          at: (new Error().stack || "").split(String.fromCharCode(10)).slice(1, 6).join(" << ") });
      }
      _y = v;
    },
  });
  return { startDepth: +(surf - y).toFixed(1), draft: +(m.swimDepth||0).toFixed(2), colM: +col.toFixed(1) };
})()`);
if (!staged || staged.__err) await die("stage failed: " + (staged && staged.__err));
say(`  ✓ megalodon (draft ${staged.draft} m) staged ${staged.startDepth} m down, committed\n`);

// ---- watch, per game second ----------------------------------------------
const READ = `(() => {
  let m = null;
  for (const w of CBZ.cityWildlife||[]) if (w.__probe) { m = w; break; }
  if (!m) return { __err: "gone" };
  if (m.dead) return { __err: "dead" };
  const R = CBZ.sharkAscentRead ? CBZ.sharkAscentRead(m) : null;
  const A = CBZ.sharkAscentAudit ? CBZ.sharkAscentAudit() : {};
  const P = CBZ.player;
  const surf = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(P.pos.x, P.pos.z) : 0;
  const h = m._hunt, s = m._shark;
  return {
    st: (h && h.st) || (s && s.state) || "?",
    megDepth: +(surf - m.group.position.y).toFixed(1),
    playerDepth: +(surf - P.pos.y).toFixed(1),
    below: R ? R.belowQuarryM : null,
    gap: R ? R.gapM : null,
    climbing: R ? R.climbing : 0,
    vy: R ? R.vyMS : 0,
    /* PITCH ONLY WHILE CLIMBING. sharkAscentRead.pitchDeg is the body's live
       rotation.z, which a swim/attack animation writes too — so reporting it
       unconditionally made the ASCENT-OFF column print a peak nose-up of 28.4
       degrees for a pass in which nothing ever climbed. The claim is about the
       climb, so the number is about the climb. */
    pitch: R && R.climbing ? R.pitchDeg : 0,
    rawPitch: R ? R.pitchDeg : 0,
    ascents: A.ascents || 0,
    dw: s ? +s.diveWant.toFixed(1) : null,
    hv: s ? +s.hv.toFixed(1) : null,
    bail: s ? +s.bail.toFixed(1) : null,
    air: s ? s.air : null,
    hp: +P.hp,
    tgtP: !!(h && h._fightTarget === CBZ.player) ? 1 : 0,
    hdg: +((m.heading||0)*57.29578).toFixed(0),
    brg: +(Math.atan2(P.pos.z-m.group.position.z, P.pos.x-m.group.position.x)*57.29578).toFixed(0),
    off: +((((Math.atan2(P.pos.z-m.group.position.z, P.pos.x-m.group.position.x)-(m.heading||0))*57.29578)%360+540)%360-180).toFixed(0),
    owned: (s && s.owned)?1:0,
    why: A.lastWhy || "", fr: A.lastFrames||0, aqy: A.lastQuarryDepthM, ayy: A.lastOwnDepthM,
    gained: A.lastClimbM,
    air: s ? s.air : 0,
  };
})()`;

const rows = [];
say("  t  state      megDep  plyDep   below    gap  climb    vy   pitch  asc  |    dw    hv  bail  air   hp tgtP");
say("  ─────────────────────────────────────────────────────────────────────────────────────────────────────");
for (let t = 0; t < SECS; t++) {
  await burst(1);
  const r = await evl(READ);
  if (!r || r.__err) { say(`  ${t + 1}  (${r && r.__err})`); break; }
  rows.push(r);
  const f = (v, w, d) => String(v == null ? "—" : (typeof v === "number" ? v.toFixed(d == null ? 1 : d) : v)).padStart(w);
  say(`  ${String(t + 1).padStart(2)}  ${String(r.st).padEnd(9)}` +
      `${f(r.megDepth, 7)}${f(r.playerDepth, 8)}${f(r.below, 8)}${f(r.gap, 7)}` +
      `${f(r.climbing, 7, 0)}${f(r.vy, 6)}${f(r.pitch, 8)}${f(r.ascents, 5, 0)}  |` +
      `${f(r.air, 5, 0)}${f(r.hdg, 5, 0)}${f(r.off, 5, 0)}  | ${String(r.why||"-").padEnd(9)}${f(r.fr, 3, 0)}${f(r.aqy, 7)}${f(r.ayy, 7)}${f(r.gained, 7)}`);
}

const pick = (fn, seed, cmp) => rows.reduce((m, r) => (cmp(fn(r), m) ? fn(r) : m), seed);
const out = {
  ascent: !OFF,
  columnM: staged.colM,
  diverDepthM: swimming.depth,
  stagedDepthM: staged.startDepth,
  peakBelowQuarryM: +pick((r) => (r.below == null ? -99 : r.below), -99, (a, b) => a > b).toFixed(2),
  closestBelowQuarryM: +pick((r) => (r.below == null ? 99 : Math.abs(r.below)), 99, (a, b) => a < b).toFixed(2),
  peakClimbMS: +pick((r) => r.vy || 0, 0, (a, b) => a > b).toFixed(2),
  peakPitchDeg: +pick((r) => r.pitch || 0, 0, (a, b) => a > b).toFixed(1),
  ascents: rows.length ? rows[rows.length - 1].ascents : 0,
  minHp: pick((r) => r.hp, 100, (a, b) => a < b),
};
if (JSON_OUT) console.log(JSON.stringify(out, null, 2));
else {
  say("\n  SUMMARY");
  say(`    diver at                          ${out.diverDepthM} m,  megalodon staged ${out.stagedDepthM} m down`);
  say(`    deepest it sat UNDER the diver    ${out.peakBelowQuarryM} m   (>0 = underneath = the ambush)`);
  say(`    closest it came, VERTICALLY       ${out.closestBelowQuarryM} m   (~0 = it arrived at the diver's depth)`);
  say(`    peak climb rate                   ${out.peakClimbMS} m/s`);
  say(`    peak nose-up pitch                ${out.peakPitchDeg}°`);
  say(`    solved ascents begun              ${out.ascents}`);
  say(`    diver hp                          ${out.minHp}`);
}
const jumps = await evl(`(window.__yJumps||[])`);
if (Array.isArray(jumps) && jumps.length) {
  say("\n  Y JUMPS (>3 m in one assignment)");
  for (const j of jumps.slice(0, 6)) say(`    ${j.from} -> ${j.to}\n       ${j.at}`);
}
await rig.close();

#!/usr/bin/env node
/* tools/npcwar-ai-metrics.mjs — HOW DUMB ARE THE SOLDIERS? Measured, in node.

   NPC War's own sim (tools/npcwar-headless.mjs's harness: the page's
   src/battle files over real three.js, brain.js and combat_iq.js) run on a
   handful of fights, sampled every quarter second, and scored on the things
   a watcher calls stupid:

     exposedAdvance   man-seconds walking/running upright in the open while
                      rounds are snapping round him (supp > 0.4), not in cover,
                      not in a fold, not running away, not assaulting the last
                      few (hunt) — "walking into fire in the open"
     standShot        man-seconds standing still and upright in the open while
                      being hit or heavily suppressed (supp > 0.6), not firing
                      for the last 1.5 s — "standing there being shot"
     bunching         share of contact samples in which a fighting man has two
                      or more of his own within 2.5 m (a grenade's dinner)
     oscillation      direction reversals per man-minute: two consecutive
                      half-second moves (> 0.5 m each) more than 120 deg apart
     blindShots       rounds fired at a mark with no line to it, a dead or
                      out-of-fight mark, or rifle ball at plate it cannot go
                      through ("shooting at nothing")
     throughMate      rounds fired down a lane one of his own stands in
     friendlyHits     damage events whose author is on the victim's side
     stuck            man-seconds asking to move (> 1 m/s) and covering < 20%
                      of it
     idle             man-seconds with a visible mark inside 70 m (a rifle's reach),
                      not reloading, not moving, not fired for 5 s
   plus the outcome: who won, how long, dead / fled / surrendered per side,
   rounds per kill. Animals and vehicles are not scored on these (they are
   not soldiers); the men facing them are.

     node tools/npcwar-ai-metrics.mjs              every case, a table
     node tools/npcwar-ai-metrics.mjs --json       the same, machine-readable
     node tools/npcwar-ai-metrics.mjs open         cases whose name contains "open"

   The node world has no bestiary, so an animal is a stand-in body here (a box
   of the species' size with a plain charge-and-bite on the unit file's own
   numbers): it measures the MEN's answer to a charging animal, not the
   animal. */
process.env.NPCWAR_HEADLESS_LIB = "1";
const H = await import("./npcwar-headless.mjs");
const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const OLD = args.includes("--old");          // the same build, squad brain off (?tac=old): the before
const FILTER = args.filter((a) => !a.startsWith("--"))[0] || "";

// a cover field: low walls and crates scattered across no-man's land
function coverField(seed) {
  let s = seed || 7;
  const r = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const out = [];
  for (let i = 0; i < 46; i++) {
    const x = (r() - 0.5) * 230, z = (r() - 0.5) * 120;
    const big = r() < 0.35;
    const w = big ? 2.4 + r() * 4 : 1.2 + r() * 1.4, d = big ? 0.6 + r() * 0.8 : 1.0 + r() * 1.2;
    const along = r() < 0.5;
    out.push({ minX: x - (along ? d : w) / 2, maxX: x + (along ? d : w) / 2, minZ: z - (along ? w : d) / 2, maxZ: z + (along ? w : d) / 2,
      y0: 0, y1: big ? 1.1 + r() * 1.6 : 1.0 + r() * 0.3 });
  }
  return out;
}
const CASES = [
  { name: "open dunes 30 v 30 riflemen", q: "?a=men&b=men&n=30v30&arena=dunes&aw=ak47&bw=ak47&at=elite&bt=elite&auto=1&probe=0", secs: 200 },
  { name: "open grass 40 pro v 40 thugs", q: "?a=men&b=men&n=40v40&arena=grass&aw=ak47&bw=ak47&at=pro&bt=thug&auto=1&probe=0", secs: 200 },
  { name: "cover field 30 v 30", q: "?a=men&b=men&n=30v30&arena=grass&aw=carbine&bw=ak47&at=elite&bt=pro&auto=1&probe=0", secs: 220, boxes: coverField(7) },
  { name: "mixed arms 50 v 50 (lmg, sniper, rockets)", q: "?a=men&b=men&n=50v50&arena=dunes&aw=" + encodeURIComponent("carbine,carbine,lmg,carbine,carbine,sniper,carbine,carbine,glauncher,carbine") + "&bw=" + encodeURIComponent("ak47,ak47,ak47,lmg,ak47,smg,ak47,ak47,bazooka,ak47") + "&at=elite&bt=pro&auto=1&probe=0", secs: 220, boxes: coverField(11) },
  { name: "40 men v 2 tigers", q: "?a=men&b=bengal_tiger&n=40v2&arena=grass&aw=ak47&at=pro&auto=1&probe=0", secs: 120, beasts: true },
  { name: "40 men v 3 elephants", q: "?a=men&b=african_elephant&n=40v3&arena=grass&aw=ak47&at=pro&auto=1&probe=0", secs: 150, beasts: true },
  { name: "tanks + men v men with rockets", q: "?a=m1_abrams*2,men*24&b=men&n=26v40&arena=dunes&aw=ak47&bw=" + encodeURIComponent("ak47,ak47,bazooka,ak47,ak47,lmg,ak47,bazooka,ak47,ak47") + "&at=elite&bt=pro&auto=1&probe=0", secs: 240, boom: true },
];

// the node world has no bestiary: give the roster's species a body and a bite
function stubBeasts(W) {
  const { CBZ, THREE } = W;
  CBZ.boxGeom = CBZ.boxGeom || ((x, y, z) => new THREE.BoxGeometry(x, y, z));
  CBZ.cmat = CBZ.cmat || ((c) => new THREE.MeshLambertMaterial({ color: c }));
  CBZ.faceAnimalHeading = CBZ.faceAnimalHeading || ((m, h) => { if (m.group) m.group.rotation.y = -h; });
  CBZ.wildlifeRig = CBZ.wildlifeRig || { buildGait() {}, animateGait() {}, classify: () => ({ atkM: 2.2 }) };
  CBZ.creatureFight = function (m, t, dt, o) {
    const dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z, d = Math.hypot(dx, dz) || 1;
    if (d > o.reach * 0.8) { o.move(m, dx / d, dz / d, o.speed * dt); m.heading = Math.atan2(dz, dx); return null; }
    m._bt = (m._bt || 0) - dt;
    if (m._bt > 0) return null;
    m._bt = o.rate;
    o.onHit(o.dmg);
    return { dealt: o.dmg };
  };
  const SIZE = { bengal_tiger: [2.8, 1.0, 0.7], african_elephant: [6.0, 3.3, 2.2], lion: [2.6, 1.1, 0.7] };
  for (const id of CBZ.unitKit.ids("species")) {
    const def = CBZ.unitKit.get(id), st = def.stats || {};
    const sz = SIZE[id] || [1.6, 0.8, 0.5];
    const build = () => { const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(sz[0], sz[1], sz[2])); b.position.y = sz[1] / 2; g.add(b); return g; };
    def.build = build; def.animate = () => {}; def.fight = null;
    CBZ.WILDLIFE_SPECIES[id] = Object.assign({ id, name: id.replace(/_/g, " "), build }, st, { scale: 1 });
  }
}
function realBoom(W) {
  W.CBZ.studio.boom = function (p, o) {
    const R = (o && o.radius) || 6, LR = R * 0.55;
    for (const a of W.sb.__battle.roster().slice()) {
      if (a.dead || a.fled || (a.group && a.group.visible === false)) continue;
      const d = Math.hypot(a.pos.x - p.x, a.pos.z - p.z);
      if (d > LR || Math.abs(a.pos.y - p.y) > LR + 3) continue;
      W.sb.hurtMan(a, a.vehicle ? 260 : (d < LR * 0.5 ? 1e6 : 60), { fromX: p.x, fromZ: p.z, by: (o && o.by) || null, cause: "explosion" });
    }
  };
}

async function measure(C, seed) {
  const W = H.boot(C.q + (OLD ? "&tac=old" : ""), { boxes: C.boxes });
  if (W.err) return { name: C.name, err: String(W.err && W.err.stack || W.err) };
  H.G(W, "_s = " + (421371 + seed * 7919));        // the page's one seeded stream
  // the per-tier think cost wants a real clock (the harness's performance.now is the sim's)
  W.sb.__tacClock = () => Number(process.hrtime.bigint()) / 1e6;
  if (C.boom) realBoom(W);
  await H.settle();
  if (C.beasts) stubBeasts(W);
  const sb = W.sb, B = W.B();
  const G = (e) => H.G(W, e);
  const M = { exposedAdvance: 0, standShot: 0, bunchS: 0, contactS: 0, reversals: 0, manMin: 0,
    blindShots: 0, throughMate: 0, friendlyHits: 0, stuck: 0, idle: 0, shots: 0, grenades: 0, drags: 0 };
  // wrap the page's trigger and its damage funnel (top-level functions are
  // properties of the context's global, and every caller looks them up there)
  const fs0 = sb.fireShot;
  sb.fireShot = function (m, tgt, r) {
    M.shots++;
    // a man down in cover putting rounds over the top (ai/squad.js blindFire)
    // is doing it on purpose: counted, but not as a shot at nothing
    if (m._blindShot) M.blindFire = (M.blindFire || 0) + 1;
    else if (!tgt || tgt.dead || tgt.fled || tgt.surrendered || tgt.downed || !sb.eyeLos(m, tgt)) { M.blindShots++; if (m.vehicle) M.blindVeh = (M.blindVeh || 0) + 1; }
    else if (tgt.vehicle && !m.vehicle && tgt.def && tgt.def.stats && tgt.def.stats.armour && (tgt.def.stats.armour.side || 0) > 30) M.blindShots++;
    if (sb.mateInLane(m, tgt)) M.throughMate++;
    return fs0.apply(this, arguments);
  };
  const hm0 = sb.hurtMan;
  sb.hurtMan = function (m, dmg, imp) {
    if (m && !m.dead && imp && imp.by && imp.by.team === m.team && imp.by !== m) M.friendlyHits++;
    return hm0.apply(this, arguments);
  };
  const DT = 0.25;
  const prev = new Map();
  let t = 0, contact = false;
  while (t < C.secs) {
    B.advance(DT, 1 / 20);
    t += DT;
    const simT = G("simT");
    const men = B.roster();
    if (!contact) for (const m of men) if (m.tgt && !m.dead && m.sees) { contact = true; break; }
    // THE LINE NEVER GOES SILENT: with an animal inside 60 m of the men, how
    // often has nobody fired for a whole second?
    if (C.beasts) {
      let cx = 0, cz = 0, n = 0, last = -99;
      for (const m of men) if (!m.dead && !m.beast && !m.vehicle && !m.fled) { cx += m.pos.x; cz += m.pos.z; n++; if ((m.lastShotT || -99) > last) last = m.lastShotT; }
      if (n) {
        cx /= n; cz /= n;
        // ...and somebody has it in his sights (a line cannot fire at what it cannot see)
        let near = false;
        for (const m of men) if (!m.beast && !m.dead && m.tgt && m.tgt.beast && !m.tgt.dead && m.sees &&
          Math.hypot(m.tgt.pos.x - m.pos.x, m.tgt.pos.z - m.pos.z) < 60) { near = true; break; }
        if (near) { M.beastS = (M.beastS || 0) + 1; if (simT - last > 1.0) M.silentS = (M.silentS || 0) + 1; }
      }
    }
    for (const m of men) {
      if (m.dead || m.fled || m.beast || m.vehicle || m.you) continue;
      let P = prev.get(m);
      if (!P) { P = { x: m.pos.x, z: m.pos.z, hp: m.hp, mvx: 0, mvz: 0, acc: 0, ax: m.pos.x, az: m.pos.z }; prev.set(m, P); continue; }
      const mx = m.pos.x - P.x, mz = m.pos.z - P.z, md = Math.hypot(mx, mz);
      const v = md / DT;
      const hit = m.hp < P.hp - 0.01;
      const covered = m.slot === "cover" || m.slot === "peek" || (m.slot === "hull" && m.hull) || m.inCover || m.stance === "prone";
      const out = m.routed || m.downed || m.surrendered || m.dragging;
      if (!out && contact) {
        M.manMin += DT / 60;
        if (v > 1 && m.stance !== "prone" && m.stance !== "crouch" && (m.supp || 0) > 0.4 && !covered && !m.hunt) M.exposedAdvance += DT;
        if (v < 0.3 && m.stance === "stand" && !covered && (hit || (m.supp || 0) > 0.6) && simT - (m.lastShotT || -9) > 1.5) M.standShot += DT;
        if ((m.speed || 0) > 1 && v < (m.speed || 0) * 0.2) M.stuck += DT;
        const tg = m.tgt;
        if (tg && !tg.dead && m.sees && !m.reloadT && v < 0.3 && simT - (m.lastShotT || -9) > 5 && !m.fists) {
          const d = Math.hypot(tg.pos.x - m.pos.x, tg.pos.z - m.pos.z);
          if (d < 70 && !(tg.vehicle && !m.launcher)) M.idle += DT;
        }
        // bunching: own fighting men within 2.5 m
        let near = 0;
        for (const o of men) {
          if (o === m || o.team !== m.team || o.dead || o.vehicle || o.beast || o.fled) continue;
          if (Math.abs(o.pos.x - m.pos.x) < 2.5 && Math.abs(o.pos.z - m.pos.z) < 2.5 && Math.hypot(o.pos.x - m.pos.x, o.pos.z - m.pos.z) < 2.5) { if (++near >= 2) break; }
        }
        M.contactS++;
        if (near >= 2) M.bunchS++;
      }
      // reversals over half-second legs
      P.acc += DT;
      if (P.acc >= 0.5) {
        const lx = m.pos.x - P.ax, lz = m.pos.z - P.az, ld = Math.hypot(lx, lz);
        if (ld > 0.5) {
          const pd = Math.hypot(P.mvx, P.mvz);
          if (pd > 0.5 && !out && (lx * P.mvx + lz * P.mvz) / (ld * pd) < -0.5) M.reversals++;
          P.mvx = lx; P.mvz = lz;
        } else { P.mvx = 0; P.mvz = 0; }
        P.ax = m.pos.x; P.az = m.pos.z; P.acc = 0;
      }
      P.x = m.pos.x; P.z = m.pos.z; P.hp = m.hp;
    }
    if (B.audit().over) break;
  }
  const a = B.audit();
  const T = sb.__battle.tally ? sb.__battle.tally() : null;
  const tac = sb.__battle.tactics ? sb.__battle.tactics() : null;
  const kills = (a.stats.red.kills + a.stats.blue.kills) || 1;
  const mm = Math.max(0.01, M.manMin);
  return {
    name: C.name, over: a.over, winner: a.winner, secs: Math.round(a.simT),
    dead: T ? T.dead : null, fled: T ? T.fled : null, surrendered: tac ? tac.surrendered : null,
    exposedAdvance: +(M.exposedAdvance / mm).toFixed(2),       // s per man-minute
    standShot: +(M.standShot / mm).toFixed(2),
    bunching: +(M.bunchS / Math.max(1, M.contactS) * 100).toFixed(1),   // % of samples
    oscillation: +(M.reversals / mm).toFixed(2),               // per man-minute
    blindShots: +(M.blindShots / Math.max(1, M.shots) * 100).toFixed(1),   // % of rounds
    blindByVehicles: +((M.blindVeh || 0) / Math.max(1, M.shots) * 100).toFixed(1),   // ...of which a hull's guns
    blindFire: M.blindFire || 0,                                     // deliberate, from cover
    throughMate: +(M.throughMate / Math.max(1, M.shots) * 100).toFixed(1),
    friendlyHits: M.friendlyHits,
    stuck: +(M.stuck / mm).toFixed(2),
    idle: +(M.idle / mm).toFixed(2),
    roundsPerKill: Math.round(M.shots / kills),
    lineSilent: M.beastS ? +(M.silentS / M.beastS * 100).toFixed(1) : 0,      // % of animal-contact samples
    tactics: tac,
  };
}

const SEEDS = +((args.find((a) => a.startsWith("--seeds=")) || "--seeds=3").slice(8));
const KEYS = ["exposedAdvance", "standShot", "bunching", "oscillation", "blindShots", "blindByVehicles", "blindFire", "throughMate", "friendlyHits", "stuck", "idle", "roundsPerKill", "lineSilent", "secs"];
const rows = [];
for (const C of CASES) {
  if (FILTER && !C.name.includes(FILTER)) continue;
  const t0 = Date.now();
  // every case over SEEDS seeds: the numbers are the mean, the outcome is each seed's
  let r = null; const outs = [];
  for (let k = 0; k < SEEDS; k++) {
    const q = await measure(C, k);
    if (q.err) { r = q; break; }
    const sr = q.surrendered && (q.surrendered.red + q.surrendered.blue) ? " " + q.surrendered.red + "/" + q.surrendered.blue + " surr" : "";
    outs.push((q.over ? q.winner : "none") + " " + q.secs + "s " + q.dead.red + "/" + q.dead.blue + " dead" +
      (q.fled.red + q.fled.blue ? " " + q.fled.red + "/" + q.fled.blue + " fled" : "") + sr);
    if (!r) r = Object.assign({}, q);
    else for (const k2 of KEYS) r[k2] += q[k2];
    if (k === SEEDS - 1) for (const k2 of KEYS) r[k2] = +(r[k2] / SEEDS).toFixed(2);
  }
  r.outcomes = outs;
  r.wall = ((Date.now() - t0) / 1000).toFixed(1);
  rows.push(r);
  if (!JSON_OUT) {
    if (r.err) { console.log(C.name + ": THREW " + r.err); continue; }
    console.log(C.name.padEnd(44) + " | " + r.outcomes.join("  |  "));
    console.log("    exposedAdvance " + r.exposedAdvance + "  standShot " + r.standShot + "  bunching " + r.bunching + "%  oscillation " + r.oscillation +
      "  blindShots " + r.blindShots + "% (hulls " + r.blindByVehicles + "%, deliberate " + r.blindFire + ")  throughMate " + r.throughMate + "%  friendlyHits " + r.friendlyHits + "  stuck " + r.stuck + "  idle " + r.idle + "  rnds/kill " + r.roundsPerKill + (r.lineSilent ? "  lineSilent " + r.lineSilent + "%" : "") + "  (" + r.wall + " s)");
    if (r.tactics) console.log("    tactics " + JSON.stringify(r.tactics));
  }
}
if (JSON_OUT) console.log(JSON.stringify(rows, null, 1));

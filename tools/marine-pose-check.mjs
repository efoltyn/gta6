#!/usr/bin/env node
/* tools/marine-pose-check.mjs — IS THE BODY IN A POSE THE WATER WOULD ALLOW?

   The owner, 2026-09-01: "Orca does this thing occasionally where it looks like
   its head is balancing on water and its tail is in the air maybe this is a
   trick or non dive glitch but it's a weird look for a second and violates
   physics."

   That is a describable pose, so it is a measurable one. This tool watches
   every wild marine body in the live world and scores three things the sea
   would never permit:

     HEADSTAND   the tail is higher than the nose, the nose is AT or above the
                 waterline, and the tail is clear of it. The animal is standing
                 on its face. This is the owner's report, in a number.
     LEVITATION  the body's own centre is above the surface while the animal is
                 not doing something ballistic (a breach or a porpoise, which
                 have earned their air). Metres of daylight under a whale.
     DISAGREE    the body is pitched one way and travelling the other — nose
                 down while rising, nose up while sinking. Radians of lie
                 between the pose and the velocity, only counted while the
                 animal is actually moving through the water.

   NOTHING IS ASSUMED ABOUT SIGNS. Which end is the nose is decided by
   projecting the model's own local X extent onto the animal's heading, in
   world space, every sample — this repo has already burned one session on an
   orca pitch sign convention that turned out to be the other way round. The
   ends are measured, never derived from `rotation.z`.

   Two phases:
     STAGED  every orca act (blow, spyhop, taillob, breach) forced on a real
             animal with CBZ.orcaStage and sampled through its whole duration,
             so the "occasional" thing happens on demand.
     FREE    N seconds of the pod and the sharks left alone, sampled every
             frame, to catch what staging does not think to ask for.

     node tools/marine-pose-check.mjs
     node tools/marine-pose-check.mjs --json
     node tools/marine-pose-check.mjs --free 120 --seed 11111

   HARNESS TRAP: core/matrixskip.js patches Object3D.updateMatrixWorld to
   return immediately when visible===false, and a headless probe finds exactly
   those animals. Every sample therefore does both halves by hand —
   updateMatrix() on the node, then updateWorldMatrix(true, true), which
   matrixskip does not patch — or the world-space ends come back stale and a
   broken build scores clean. (Same trap marine-girth-check.mjs documents.) */
import { launch, sleep } from "./lib/cdp.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const SEED = arg("--seed", "90210");
const JSON_OUT = has("--json");
const FREE_SEC = +arg("--free", "90");
const say = (m) => { if (!JSON_OUT) console.log(m); };

/* ---- the sampler, installed once and driven from node ------------------- */
const INSTALL = `(() => {
  const T = window.THREE, CBZ = window.CBZ;
  if (!T || !CBZ || !CBZ.cityWildlife) return { err: "no world" };
  const S = window.__marinePose = {
    ends: new Map(),          // species id -> local +/-X extent of the body
    prev: new Map(),          // animal -> last sample (for velocity)
    hang: new Map(),          // animal -> seconds spent standing on its face
    rows: [],                 // one accumulator per bucket
    bucket: "free",
  };

  /* THE BODY'S OWN LOCAL EXTENT, measured once per species off the mesh, with
     the group's rotation temporarily zeroed so a swimming pose cannot leak
     into the box. Fins are included on purpose: the flukes ARE the thing that
     comes out of the water in a lobtail. */
  S.localEnds = function (a) {
    const id = (a.species && a.species.id) || "?";
    if (S.ends.has(id)) return S.ends.get(id);
    const g = a.group;
    const rot = { x: g.rotation.x, y: g.rotation.y, z: g.rotation.z };
    g.rotation.set(0, 0, 0);
    g.traverse(function (o) { o.updateMatrix(); });
    g.updateWorldMatrix(true, true);
    const b = new T.Box3();
    g.traverse(function (o) { if (o.isMesh && o.visible !== false) b.expandByObject(o); });
    g.rotation.set(rot.x, rot.y, rot.z);
    g.traverse(function (o) { o.updateMatrix(); });
    g.updateWorldMatrix(true, true);
    // back into the group's own local frame (the box came out in world space
    // with the group at identity rotation, so subtract the group position and
    // divide by its scale)
    const sc = (g.scale && g.scale.x) || 1;
    const e = isFinite(b.max.x) && isFinite(b.min.x)
      ? { lo: (b.min.x - g.position.x) / sc, hi: (b.max.x - g.position.x) / sc }
      : { lo: -2, hi: 2 };
    S.ends.set(id, e);
    return e;
  };

  S.bucketOf = function (name) {
    let r = null;
    for (const q of S.rows) if (q.name === name) { r = q; break; }
    if (!r) {
      r = { name: name, n: 0, headstand: 0, headstandM: 0, levitate: 0, levitateM: 0,
            disagree: 0, disagreeRad: 0, aboveM: 0, noseAboveM: 0, tailAboveM: 0,
            hangN: 0, hangSec: 0, byAct: {} };
      S.rows.push(r);
    }
    return r;
  };

  /* ONE SAMPLE OF ONE ANIMAL. Everything is metres relative to the LIVE
     surface directly under the body. */
  S.sample = function (a, dt) {
    const g = a && a.group;
    if (!g || a.dead || !a.species || !a.species.aquatic) return;
    if (a.ridden || a === (CBZ.sharkSim && CBZ.sharkSim.shark)) return;   // the player's mount is another file's problem
    g.traverse(function (o) { o.updateMatrix(); });
    g.updateWorldMatrix(true, true);
    const e = S.localEnds(a);
    const p0 = g.localToWorld(new T.Vector3(e.hi, 0, 0));
    const p1 = g.localToWorld(new T.Vector3(e.lo, 0, 0));
    // WHICH END IS THE NOSE IS MEASURED, NOT ASSUMED: the one whose offset
    // from the body's origin points along the animal's own heading.
    const h = +a.heading || 0, fx = Math.cos(h), fz = Math.sin(h);
    const d0 = (p0.x - g.position.x) * fx + (p0.z - g.position.z) * fz;
    const nose = d0 >= 0 ? p0 : p1, tail = d0 >= 0 ? p1 : p0;
    const surf = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(g.position.x, g.position.z) : 0;

    const orca = a._orca || null, shark = a._shark || null;
    const act = orca ? (orca.act || (orca.porp ? "porpoise" : "")) : (shark && shark.air ? "breach" : "");
    // BALLISTIC = the animal has bought its air with speed. Everything else is
    // supposed to be in the water.
    const ballistic = act === "breach" || act === "porpoise" ||
      !!(shark && shark.air) || !!(orca && orca.porp);

    const noseUp = nose.y - surf, tailUp = tail.y - surf, midUp = g.position.y - surf;
    const len = Math.max(0.5, Math.hypot(nose.x - tail.x, nose.y - tail.y, nose.z - tail.z));

    const prev = S.prev.get(a);
    const vy = prev && dt > 0 ? (g.position.y - prev.y) / dt : 0;
    const vh = prev && dt > 0
      ? Math.hypot(g.position.x - prev.x, g.position.z - prev.z) / dt : 0;
    S.prev.set(a, { x: g.position.x, y: g.position.y, z: g.position.z });

    const R = S.bucketOf(S.bucket);
    R.n++;
    const A = R.byAct[act || "swim"] ||
      (R.byAct[act || "swim"] = { n: 0, headstand: 0, worstM: 0, aboveM: 0, hangSec: 0,
                                  noseM: -99, tailM: -99, midM: -99 });
    A.n++;

    /* HEADSTAND — the owner's report. The tail is above the nose, the nose has
       come up to the waterline or through it, and the tail is genuinely in the
       air. A body doing this is balancing on its face. */
    const stand = tailUp > noseUp + 0.5 && noseUp > -0.35 && tailUp > 0.5;
    if (stand) {
      R.headstand++; A.headstand++;
      const m = tailUp - noseUp;
      if (m > R.headstandM) R.headstandM = m;
      if (m > A.worstM) A.worstM = m;
    }
    /* IS IT FALLING, OR IS IT BALANCING? A breaching body comes down nose-first
       with its flukes in the air and that is not a bug, it is the re-entry.
       What the owner saw was a body HOLDING the pose. So the frames that count
       hardest are the ones where the animal stands on its face and goes
       nowhere: a HANG, tracked as a dwell per animal so one long hold reads as
       one event instead of a scatter of frames. */
    const hang = stand && Math.abs(vy) < 2.2;
    const run = hang ? (S.hang.get(a) || 0) + dt : 0;
    S.hang.set(a, run);
    if (hang) {
      R.hangN++;
      if (run > R.hangSec) R.hangSec = run;
      if (run > A.hangSec) A.hangSec = run;
    }
    /* LEVITATION — the body's centre in the air with nothing ballistic to pay
       for it. depth()'s submersion clamp exists to make this impossible; an
       act that sets airborne lifts the clamp, and this counts who abuses it. */
    if (!ballistic && midUp > 0) {
      R.levitate++;
      if (midUp > R.levitateM) R.levitateM = midUp;
    }
    /* DISAGREE — pose vs travel. Only while genuinely moving: a hovering
       animal has no direction to agree with. The pose angle is read off the
       measured ends, so it carries no sign convention. */
    /* ...and only for a SUBMERGED animal with no act running. A spy-hopping
       whale is deliberately not pointed where it is drifting, and a body at the
       waterline is riding waves, so neither has a travel direction its attitude
       owes anything to. Judging them here made the pose law look broken by the
       act it had just fixed. */
    if (!ballistic && !act && midUp < -0.5 && Math.hypot(vh, vy) > 0.9) {
      const posed = Math.asin(Math.max(-1, Math.min(1, (nose.y - tail.y) / len)));
      const going = Math.atan2(vy, Math.max(0.35, vh));
      const err = Math.abs(posed - going);
      if (err > 0.55) R.disagree++;
      if (err > R.disagreeRad) R.disagreeRad = err;
    }
    if (noseUp > A.noseM) A.noseM = noseUp;
    if (tailUp > A.tailM) A.tailM = tailUp;
    if (midUp > A.midM) A.midM = midUp;
    const above = Math.max(noseUp, tailUp, midUp);
    if (above > R.aboveM) R.aboveM = above;
    if (above > A.aboveM) A.aboveM = above;
    if (noseUp > R.noseAboveM) R.noseAboveM = noseUp;
    if (tailUp > R.tailAboveM) R.tailAboveM = tailUp;
  };

  S.tick = function (dt) {
    for (const a of CBZ.cityWildlife) S.sample(a, dt);
  };
  S.reset = function (name) { S.bucket = name; S.prev = new Map(); S.hang = new Map(); };
  /* AN ACT ON AN ANIMAL NOBODY IS NEAR NEVER RUNS, AND A POD DRAGGED INTO THE
     SHALLOWS CANNOT ACT EITHER. Two failed runs taught both halves. Staging the
     four acts on a pod 300 m out measured a flat 0.0 m of body above the water
     for all four — a spy-hop that rises two drafts cannot score zero — so
     something has to close the distance. But closing it by teleporting the pod
     to the player, who in this mode is standing on an island, put three orcas
     in a metre of surf where cityAquaticBedRestY pins them to the bed, and the
     run went to zero everywhere, the free phase included.

     So the PLAYER goes to the POD. The LOD and the off-screen sim exemptions
     are keyed on the player (city/wildlife.js), the pod keeps the deep water it
     chose for itself, and nothing about the animals is disturbed. */
  S.visit = function () {
    const P = CBZ.player, list = S.orcas();
    if (!P || !list.length) return 0;
    let best = null, deep = -1e9;
    for (const a of list) {
      const g = a.group;
      const surf = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(g.position.x, g.position.z) : 0;
      const bed = CBZ.cityAquaticBedRestY
        ? CBZ.cityAquaticBedRestY(g.position.x, g.position.z, 2.6, 1.4, 0, surf) : surf - 40;
      const room = surf - bed;                 // water under this animal
      if (room > deep) { deep = room; best = a; }
    }
    if (!best) return 0;
    const g = best.group;
    P.pos.x = g.position.x + 22;
    P.pos.z = g.position.z;
    P.pos.y = (CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(P.pos.x, P.pos.z) : 0) + 1.2;
    return Math.round(deep * 10) / 10;
  };
  S.orcas = function () {
    const out = [];
    for (const a of CBZ.cityWildlife) {
      if (a && !a.dead && a.species && a.species.id === "orca" && a.group) out.push(a);
    }
    return out;
  };
  return { ok: true };
})()`;

/* advance the world and sample every frame in ONE evaluation — a burst that
   returns to node between frames is a burst that loses frames to the page's
   own event loop (the one-evaluation lesson from tools/shark-shake-check.mjs) */
const burst = (sec) => `(() => {
  const S = window.__marinePose, dt = 1 / 30, n = Math.max(1, Math.round(${sec} * 30));
  for (let i = 0; i < n; i++) { CBZ.stepSim(dt); S.tick(dt); }
  return n;
})()`;

const rig = await launch({ rafBudget: 0 });
const report = { seed: SEED, pass: false, buckets: [], fails: [] };
try {
  await rig.open("/", `mode=survival&seed=${SEED}&cfg_BOOT_METER=0`);
  if (!await rig.wait("window.CBZ && CBZ.game && CBZ.stepSim && document.getElementById('playBtn')", 120000)) {
    throw new Error("the page never reached its title card");
  }
  if (!await rig.wait(`(() => { if (CBZ.game.state === "playing") return true;
      const m = document.querySelector('.mode-btn[data-mode="survival"]'); if (m) m.click();
      const b = document.getElementById("playBtn"); if (b) b.click();
      return CBZ.game.state === "playing"; })()`, 120000, 250)) {
    throw new Error("PLAY never started a game");
  }
  if (!await rig.wait("CBZ.cityWildlife && CBZ.cityWildlife.length > 4 && CBZ.citySeaHeightAt", 180000)) {
    throw new Error("world never populated");
  }
  await sleep(400);
  const ins = await rig.evl(INSTALL);
  if (!ins || ins.err) throw new Error((ins && ins.err) || "sampler never installed");

  // orcas may need a beat (and a nudge) to exist at all
  let orcaN = await rig.evl("window.__marinePose.orcas().length");
  if (!orcaN) {
    await rig.evl(`(() => {
      const P = CBZ.player, A = CBZ.surv && CBZ.surv.arena;
      if (!A || !CBZ.cityWildlifeSpawnAt) return 0;
      let n = 0;
      for (let i = 0; i < 3; i++) {
        const ang = i * 2.1, r = A.radius + 80 + i * 12;
        if (CBZ.cityWildlifeSpawnAt("orca", A.center.x + Math.cos(ang) * r, A.center.z + Math.sin(ang) * r)) n++;
      }
      return n;
    })()`);
    await rig.evl(burst(1));
    orcaN = await rig.evl("window.__marinePose.orcas().length");
  }
  if (!orcaN) throw new Error("no orcas in the water to watch");
  say(`  ${orcaN} orcas in the water`);

  // ---- STAGED: every act, on demand, sampled through its whole duration ----
  const ACTS = [
    { id: "blow", dur: 4.2 },
    { id: "spyhop", dur: 4.6 },
    { id: "taillob", dur: 3.1 },
    { id: "breach", dur: 2.9 },
  ];
  for (const act of ACTS) {
    await rig.evl(`(() => {
      const S = window.__marinePose;
      S.reset(${JSON.stringify(act.id)});
      S.visit();
      for (const a of S.orcas()) CBZ.orcaStage(a, "");
      return true;
    })()`);
    await rig.evl(burst(0.8));                       // let the move settle
    await rig.evl(`(() => {
      const S = window.__marinePose;
      S.reset(${JSON.stringify(act.id)});
      for (const a of S.orcas()) CBZ.orcaStage(a, ${JSON.stringify(act.id)}, ${act.dur});
      return true;
    })()`);
    await rig.evl(burst(act.dur + 0.6));
  }
  // ---- FREE: leave them alone and watch ----------------------------------
  /* SNAPSHOT THE COUNTERS HERE, not at the end: the staged phase above starts
     twelve acts itself, and AUDIT counts STARTS — so a build that cancels every
     act on the next frame still scores twelve. What is worth knowing is what
     the animals do when nobody asks, so the repertoire is measured across the
     FREE phase only, as a delta. */
  const acts0 = await rig.evl(`(() => { const A = CBZ.orcaAudit ? CBZ.orcaAudit().counters : null;
    return A ? { blows: A.blows, spyhops: A.spyhops, breaches: A.breaches,
                 tailLobs: A.tailLobs, porpoises: A.porpoises } : null; })()`);
  await rig.evl(`window.__marinePose.reset("free")`);
  const CHUNK = 10;
  for (let t = 0; t < FREE_SEC; t += CHUNK) await rig.evl(burst(Math.min(CHUNK, FREE_SEC - t)));

  /* DID THE ANIMAL DO ANYTHING AT ALL? The pose gate above can only judge
     poses that happen, and a build where the whole repertoire is suppressed
     scores a flawless zero on every one of them — which is exactly what the
     baseline does, so the counters have to be part of the report or "PASS"
     means two opposite things. CBZ.orcaAudit is the file's own tally. */
  const acts1 = await rig.evl(`(() => { const A = CBZ.orcaAudit ? CBZ.orcaAudit().counters : null;
    return A ? { blows: A.blows, spyhops: A.spyhops, breaches: A.breaches,
                 tailLobs: A.tailLobs, porpoises: A.porpoises } : null; })()`);
  const acts = (acts0 && acts1) ? {
    blows: acts1.blows - acts0.blows, spyhops: acts1.spyhops - acts0.spyhops,
    breaches: acts1.breaches - acts0.breaches, tailLobs: acts1.tailLobs - acts0.tailLobs,
    porpoises: acts1.porpoises - acts0.porpoises,
  } : null;
  report.acts = acts;

  const rows = await rig.evl(`(() => window.__marinePose.rows.map(function (r) {
    return { name: r.name, n: r.n,
      headstand: r.headstand, headstandM: +r.headstandM.toFixed(2),
      levitate: r.levitate, levitateM: +r.levitateM.toFixed(2),
      disagree: r.disagree, disagreeRad: +r.disagreeRad.toFixed(2),
      hangN: r.hangN, hangSec: +r.hangSec.toFixed(2),
      aboveM: +r.aboveM.toFixed(2), noseAboveM: +r.noseAboveM.toFixed(2),
      tailAboveM: +r.tailAboveM.toFixed(2),
      byAct: r.byAct };
  }))()`);
  report.buckets = rows;

  const sum = (k) => rows.reduce((m, r) => m + r[k], 0);
  const worst = (k) => rows.reduce((m, r) => Math.max(m, r[k]), 0);
  const frames = sum("n") || 1;
  const headPct = (sum("headstand") / frames) * 100;
  const levPct = (sum("levitate") / frames) * 100;

  report.headstandPct = +headPct.toFixed(2);
  report.headstandWorstM = worst("headstandM");
  report.levitatePct = +levPct.toFixed(2);
  report.levitateWorstM = worst("levitateM");
  report.disagreeWorstRad = worst("disagreeRad");
  report.hangWorstSec = +worst("hangSec").toFixed(2);
  report.headstandFrames = sum("headstand");

  // THE GATE. A headstand is never right and neither is a whale hovering over
  // the sea it lives in; both must be zero. The pose/travel disagreement is
  // allowed a little slack — a body turning is briefly pointed where it is
  // about to go rather than where it has been.
  /* THE GATE IS THE HANG, NOT THE FRAME. A body coming down out of a breach
     enters nose-first with its flukes in the air and that is the re-entry, not
     a bug — it is over in a few frames and the vertical speed proves it. What
     the owner saw was a body HOLDING that attitude, so that is what fails:
     tail over nose, nose at the waterline, and going nowhere. */
  if (report.hangWorstSec > 0.35) report.fails.push(
    `body held standing on its face for ${report.hangWorstSec}s (worst ${report.headstandWorstM} m of tail over nose)`);
  if (report.levitateWorstM > 0.05) report.fails.push(
    `body centre ${report.levitateWorstM} m above the sea with nothing ballistic paying for it`);
  /* DISAGREE IS REPORTED, NOT GATED. It is the softest of the three: a body
     that has just landed out of a breach, or is turning hard, is briefly
     pointed where it is going NEXT rather than where it has been, and tightening
     the test until those stop counting would leave it measuring nothing. The
     two invariants above are unambiguous — a held headstand and a levitating
     whale are wrong at any speed — so those are the gate. */
  /* A BUILD WHERE THE ANIMAL NEVER DOES ANYTHING IS NOT A BUILD THAT PASSED.
     The pose gate can only judge poses that happen; the baseline suppresses
     every act on a populated island and therefore scores a flawless zero on
     all three invariants. Without this line "PASS" would mean two opposite
     things and the tool would certify the dead build. */
  if (acts && !(acts.blows + acts.spyhops + acts.breaches + acts.tailLobs + acts.porpoises)) {
    report.fails.push("the orcas did NOTHING unprompted in " + FREE_SEC + "s — no blow, spy-hop, breach, lobtail or porpoise");
  }
  report.pass = report.fails.length === 0;

  if (JSON_OUT) console.log(JSON.stringify(report, null, 1));
  else {
    say("");
    say("  MARINE POSE — what the water would allow");
    say("  " + "-".repeat(78));
    say("  " + "phase".padEnd(11) + "frames".padStart(7) + "headstand".padStart(12) +
      "levitate".padStart(12) + "disagree".padStart(11) + "highest".padStart(10));
    for (const r of rows) {
      say("  " + r.name.padEnd(11) + String(r.n).padStart(7) +
        (r.headstand ? (r.headstand + " (" + r.headstandM.toFixed(1) + "m)") : "-").padStart(12) +
        (r.levitate ? (r.levitate + " (" + r.levitateM.toFixed(1) + "m)") : "-").padStart(12) +
        (r.disagree ? (r.disagree + " (" + r.disagreeRad.toFixed(2) + ")") : "-").padStart(11) +
        (r.aboveM.toFixed(1) + "m").padStart(10));
      const acts = Object.keys(r.byAct).filter((k) => r.byAct[k].n > 0);
      for (const k of acts) {
        const A = r.byAct[k];
        say("      " + k.padEnd(12) + String(A.n).padStart(5) + "f   peak nose " +
          A.noseM.toFixed(1).padStart(6) + "   tail " + A.tailM.toFixed(1).padStart(6) +
          "   mid " + A.midM.toFixed(1).padStart(6) +
          (A.headstand ? "   HEADSTAND " + A.headstand + " (worst " + A.worstM.toFixed(1) +
            " m, hang " + A.hangSec.toFixed(1) + " s)" : ""));
      }
    }
    say("  " + "-".repeat(78));
    say("  headstand   " + report.headstandFrames + " frames (" + report.headstandPct.toFixed(2) +
      "%)   worst " + report.headstandWorstM.toFixed(2) + " m of tail over nose");
    say("  HELD        " + report.hangWorstSec.toFixed(2) + " s   <- the gate: a pose held, not a body falling");
    say("  levitation  " + report.levitatePct.toFixed(2) + "% of frames   worst " +
      report.levitateWorstM.toFixed(2) + " m of daylight under the body");
    say("  disagree    worst " + report.disagreeWorstRad.toFixed(2) + " rad between pose and travel");
    if (acts) {
      const total = acts.blows + acts.spyhops + acts.breaches + acts.tailLobs + acts.porpoises;
      say("  repertoire  " + total + " acts in " + FREE_SEC + "s unprompted   (" +
        "blow " + acts.blows + ", spy-hop " + acts.spyhops + ", breach " + acts.breaches +
        ", lobtail " + acts.tailLobs + ", porpoise " + acts.porpoises + ")");
      if (!total) say("              ^ ZERO. Nothing the orca file can do reached the water.");
    }
    say("");
    for (const f of report.fails) say("  ✗ " + f);
    say("  " + (report.pass ? "PASS — every body was in a pose the sea would allow"
                            : "FAIL — the sea would not allow this"));
    say("");
  }
  process.exit(report.pass ? 0 : 1);
} finally {
  await rig.close();
}

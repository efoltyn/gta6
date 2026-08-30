#!/usr/bin/env node
/* tools/orca-swim-check.mjs — DOES A MARINE BODY GLIDE, OR DOES IT ZIGZAG?

   OWNER (2026-08-30): "orcas move way too right-to-left, glitchy... it's not
   the orca MOVING right to left, it's the ANIMATION of an orca swimming
   straight that looks like it's zigzagging, glitchy, fast."

   The first thing this tool established is WHERE that yaw comes from, because
   the obvious suspect is wrong: the tail rig never touches yaw. Trapping every
   write to a live orca's euler showed exactly one writer — faceAnimalHeading,
   from the water mover — so the visible bearing of a marine animal is exactly
   -a.heading, and a heading that will not sit still IS the zigzag. That makes
   the water navigator the only thing worth measuring.

   TWO MEASUREMENTS, and the first one is the one to trust.

   1. THE BENCH (controlled). waterField.moveInWater is a pure function of
      position, heading, step, clearance and the world's coast field, so it is
      called directly in a loop from a fixed start — no brain, no LOD, nothing
      else writing the transform, and repeatable between two checkouts.

      The caller steers too, and that is the case that matters: every real
      caller (the herd boids, the orca's pod station, the shark's turn limiter,
      the wander kick) rewrites the heading between calls, so a bench that
      feeds the navigator its own last output forever is the one situation
      that never happens in play. Here the caller asks for a slow smooth course
      and the bench reports THE NAVIGATOR'S OWN CONTRIBUTION on top of it:

        navDegPerFrame     how hard it steers
        navReversalsPerSec how often that steering CHANGES SIGN — the zigzag
        blockedPct         ..and whether the price of calm is a beached animal
        closestShore       how near land it actually let the body get

      Rows with blockedPct 100 are degenerate — the start point is inside the
      surf, the body cannot fit and never moves — and are marked, not read.

   2. THE SEA (as it actually runs). Orcas staged in open water with nothing to
      hunt, sampled every tick: the world bearing of the transformed nose axis,
      its bank and its pitch. Honest, but the ocean is chaotic and two runs of
      different code diverge, so it is context for the bench, not a verdict.

     node tools/orca-swim-check.mjs
     node tools/orca-swim-check.mjs --sec 20 --json
     node tools/orca-swim-check.mjs --off        # MARINE_STEER_V2=0, the v1 body
*/
import { launch } from "./lib/cdp.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const SEC = +arg("--sec", "14");
const SEED = arg("--seed", "90210");
const OFF = has("--off");
const JSON_OUT = has("--json");
const say = (m) => { if (!JSON_OUT) console.log(m); };

const rig = await launch({ rafBudget: 0 });
try {
  await rig.open("index.html", `mode=sharksim&seed=${SEED}` + (OFF ? "&cfg_MARINE_STEER_V2=0" : ""));
  if (!await rig.wait("window.CBZ && CBZ.game", 150000)) throw new Error("no CBZ");
  await rig.evl("CBZ.SURV_BOTS = 8");
  const playing = await rig.wait(`(() => {
    if (CBZ.game.state === 'playing' && CBZ.game.mode === 'sharksim') return true;
    if (!CBZ.cityWildlifeStock || !CBZ.stepSim) return false;
    const mb = document.querySelector('.mode-btn[data-mode="sharksim"]'); if (mb) mb.click();
    const pb = document.getElementById('playBtn'); if (pb) pb.click();
    return false;
  })()`, 240000, 300);
  if (!playing) throw new Error("never entered a match");
  await rig.evl(`(() => { for (let i=0;i<300;i++) CBZ.stepSim(1/30); return 1; })()`);

  const RIG = `(() => {
  if (window.__osc) return true;
  const CBZ = window.CBZ, T = window.THREE;
  const O = window.__osc = {};

  // ---- shared statistics -------------------------------------------------
  function unwrap(v) {
    const o = [v[0]];
    for (let i = 1; i < v.length; i++) {
      let d = v[i] - v[i-1];
      while (d > Math.PI) d -= 6.283185307; while (d < -Math.PI) d += 6.283185307;
      o.push(o[i-1] + d);
    }
    return o;
  }
  function detrend(v, w) {
    const n = v.length, o = [];
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let j = Math.max(0,i-w); j <= Math.min(n-1,i+w); j++) { s += v[j]; c++; }
      o.push(v[i] - s/c);
    }
    return o;
  }
  function stat(v) {
    let lo=1e9, hi=-1e9, flips=0, prev=0, snap=0;
    for (let i=0;i<v.length;i++){
      if (v[i]<lo) lo=v[i]; if (v[i]>hi) hi=v[i];
      const s = v[i] > 1e-4 ? 1 : v[i] < -1e-4 ? -1 : 0;
      if (s && prev && s !== prev) flips++;
      if (s) prev = s;
      if (i) snap = Math.max(snap, Math.abs(v[i]-v[i-1]));
    }
    return { p2pDeg:+((hi-lo)*57.2958).toFixed(2), reversalsPerSec:+(flips/(v.length/30)).toFixed(2),
             snapDeg:+(snap*57.2958).toFixed(2) };
  }

  // ---- 1. THE BENCH ------------------------------------------------------
  O.bench = function (opts) {
    const wf = CBZ.waterField;
    const A = CBZ.surv.arena, P = CBZ.player;
    const ang = Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0;
    const runs = [];
    for (const off of (opts.offsets || [4, 12, 30, 60, 140, 300])) {
      for (const clr of (opts.clears || [95, 34])) {     // an orca's, a great white's
        const r = (CBZ.sharkSim.waterline || 0) + off;
        let x = A.center.x + Math.cos(ang) * r, z = A.center.z + Math.sin(ang) * r;
        let h = ang + Math.PI * 0.5;                     // along the coast
        const nav = {}, own = [];
        let blk = 0, worst = -1e9;
        const wob = opts.callerTurn == null ? 0.007 : opts.callerTurn;   // rad/frame
        for (let i = 0; i < (opts.steps || 400); i++) {
          h += Math.sin(i * 0.045) * wob;                // the caller's own course
          const hIn = h;
          const o = wf.moveInWater(x, z, h, opts.dist || 1.5, clr, i / 30, nav);
          let d = o.heading - hIn;
          while (d > Math.PI) d -= 6.283185307; while (d < -Math.PI) d += 6.283185307;
          own.push(d);
          if (o.blocked) blk++;
          if (o.shore > worst) worst = o.shore;
          h = o.heading; x = o.x; z = o.z;
        }
        let abs = 0, snap = 0, flips = 0, prev = 0;
        for (let i = 0; i < own.length; i++) {
          abs += Math.abs(own[i]);
          if (Math.abs(own[i]) > snap) snap = Math.abs(own[i]);
          const sg = own[i] > 1e-6 ? 1 : own[i] < -1e-6 ? -1 : 0;
          if (sg && prev && sg !== prev) flips++;
          if (sg) prev = sg;
        }
        runs.push({ offset: off, clr: clr,
                    blockedPct: +(100 * blk / own.length).toFixed(1),
                    closestShore: +worst.toFixed(1),
                    navDegPerFrame: +((abs/own.length)*57.2958).toFixed(3),
                    navSnapDeg: +(snap*57.2958).toFixed(2),
                    navReversalsPerSec: +(flips/(own.length/30)).toFixed(2) });
      }
    }
    return runs;
  };

  // ---- 2. THE SEA --------------------------------------------------------
  O.stage = function (want) {
    const S = CBZ.sharkSim && CBZ.sharkSim.shark;
    const A = CBZ.surv.arena, P = CBZ.player;
    const ang = Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0;
    const r = (CBZ.sharkSim.waterline || 0) + 110;
    const cx = A.center.x + Math.cos(ang) * r, cz = A.center.z + Math.sin(ang) * r;
    const orcas = [];
    for (const a of (CBZ.cityWildlife || [])) {
      if (!a.species) continue;
      if (a.species.id === "orca" && !a.dead && orcas.length < want) { orcas.push(a); continue; }
      if (!a.species.aquatic) continue;
      a.pos.x += 4000; a.hunger = 0;                     // an empty sea: nothing to react to
      if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
      if (a.group) a.group.position.x = a.pos.x;
    }
    while (orcas.length < want && CBZ.cityWildlifeSpawnAt) {
      const o = CBZ.cityWildlifeSpawnAt("orca", cx + orcas.length * 70, cz + orcas.length * 50);
      if (!o) break; orcas.push(o);
    }
    for (let i = 0; i < orcas.length; i++) {
      const a = orcas[i];
      a.pos.x = cx + i * 70; a.pos.z = cz + i * 50; a.hunger = 0;
      if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
      if (a.group) a.group.position.set(a.pos.x, a.pos.y, a.pos.z);
      if (a._mp) { a._mp.target = null; a._mp.kind = 0; }
    }
    if (S) { S.pos.x += 4000; if (S.group) S.group.position.x = S.pos.x; }
    O.orcas = orcas;
    return orcas.length;
  };
  const fwd = new T.Vector3(), up = new T.Vector3();
  O.run = function (n) {
    const os = O.orcas, tr = os.map(() => []);
    for (let i = 0; i < n; i++) {
      CBZ.stepSim(1/30);
      for (let k = 0; k < os.length; k++) {
        const a = os[k], g = a.group; if (!g) continue;
        g.updateMatrixWorld(true);
        fwd.set(1,0,0).applyQuaternion(g.quaternion);
        up.set(0,1,0).applyQuaternion(g.quaternion);
        const yaw = Math.atan2(fwd.z, fwd.x);
        const pitch = Math.asin(Math.max(-1, Math.min(1, fwd.y)));
        let sx = fwd.z, sz = -fwd.x; const sl = Math.hypot(sx, sz) || 1; sx/=sl; sz/=sl;
        const bank = Math.atan2(up.x*sx + up.z*sz, up.y);
        tr[k].push([yaw, pitch, bank, g.position.x, g.position.z]);
      }
    }
    return tr.map(function (rows) {
      const m = rows.length;
      const x0=rows[0][3], z0=rows[0][4], x1=rows[m-1][3], z1=rows[m-1][4];
      let ux=x1-x0, uz=z1-z0; const ul=Math.hypot(ux,uz)||1; ux/=ul; uz/=ul;
      let off=0; for (const r of rows) off = Math.max(off, Math.abs((r[3]-x0)*uz - (r[4]-z0)*ux));
      return { yaw: stat(detrend(unwrap(rows.map(r=>r[0])), 4)),
               bank: stat(detrend(rows.map(r=>r[2]), 4)),
               pitch: stat(detrend(rows.map(r=>r[1]), 4)),
               pathOffset:+off.toFixed(2), travelled:+ul.toFixed(1) };
    });
  };
  return true;
})()`;
  await rig.evl(RIG);
  const out = { steerV2: await rig.evl("CBZ.CONFIG.MARINE_STEER_V2 !== false") };
  out.bench = await rig.evl(`window.__osc.bench({ steps: 400, dist: 1.5 })`);
  out.benchSlow = await rig.evl(`window.__osc.bench({ steps: 400, dist: 0.36 })`);
  const staged = await rig.evl("window.__osc.stage(3)");
  if (staged) {
    await rig.evl(`(() => { for (let i=0;i<120;i++) CBZ.stepSim(1/30); return 1; })()`);
    out.sea = await rig.evl(`window.__osc.run(${Math.round(SEC * 30)})`);
  }

  if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); }
  else {
    say("MARINE_STEER_V2: " + out.steerV2);
    for (const [tag, label] of [["bench", "cruise 1.5 u/frame"], ["benchSlow", "drift 0.36 u/frame"]]) {
      say("\n== the bench, " + label + " — the NAVIGATOR's own steering ==");
      say("   off  clr | deg/frame  snap°  reversals/s | blocked%  closest shore");
      for (const r of out[tag]) {
        const dead = r.blockedPct >= 99.9 ? "   (degenerate: body does not fit, never moves)" : "";
        say(`  ${String(r.offset).padStart(4)} ${String(r.clr).padStart(4)} | ` +
            `${r.navDegPerFrame.toFixed(3).padStart(9)} ${r.navSnapDeg.toFixed(2).padStart(6)} ` +
            `${r.navReversalsPerSec.toFixed(2).padStart(12)} | ${r.blockedPct.toFixed(1).padStart(8)} ` +
            `${r.closestShore.toFixed(1).padStart(14)}${dead}`);
      }
    }
    if (out.sea) {
      say("\n== the sea, " + SEC + "s, orcas in open water with nothing to hunt ==");
      out.sea.forEach((s, i) => say("  orca#" + i + " yaw " + JSON.stringify(s.yaw) +
        "  travelled " + s.travelled + "  off-line " + s.pathOffset));
    }
    const real = out.benchSlow.filter((r) => r.blockedPct < 99.9);
    const rev = real.reduce((a, r) => a + r.navReversalsPerSec, 0) / (real.length || 1);
    const open = out.benchSlow.filter((r) => r.offset >= 60);
    const openDeg = open.reduce((a, r) => a + r.navDegPerFrame, 0) / (open.length || 1);
    say(`\nVERDICT: mean reversals/s in real water ${rev.toFixed(3)} · ` +
        `navigator steering in OPEN water ${openDeg.toFixed(3)} deg/frame ` +
        `(both want to be 0 — a body with nothing to avoid should be handed back its own course)`);
  }
  if (rig.errors.length) say("\npage errors:\n  " + rig.errors.slice(0, 6).join("\n  "));
} finally { await rig.close(); }

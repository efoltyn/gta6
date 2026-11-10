#!/usr/bin/env node
/* tools/npcwar-ground-contact.mjs — DO THE BODIES TOUCH THE GROUND?

   Boots games/battle.html, runs a rifle fight and, every few seconds, takes
   every rig on the field and measures the gap between the LOWEST POINT OF ITS
   MESH (a world-space bounding box of the whole rig) and the ground under it.
   A man on the ground has a gap of zero: positive is floating, negative is
   sunk. Reported by what he is doing (standing, kneeling, prone, running,
   down, dead), as median / worst-float / worst-sink and the share of samples
   more than 12 cm out. Exits 1 when any state has more than 10 % out.

     node tools/npcwar-ground-contact.mjs [--secs 120] [--every 4] [--q "a=men*40&b=men*40&arena=dunes"] */
import { launch } from "./lib/cdp.mjs";
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SECS = +arg("--secs", 120), EVERY = +arg("--every", 4), Q = arg("--q", "a=men*40&b=men*40&arena=dunes");
const rig = await launch({ rafBudget: 0 });
let fail = 0;
try {
  await rig.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await rig.open("games/battle.html", `auto=1&probe=1&${Q}`);
  await rig.wait("window.__battle && __battle.audit().started", 240000, 400);
  await rig.evl("__battle.freeze()");
  const all = {};
  for (let t = 0; t < SECS; t += EVERY) {
    await rig.evl(`__battle.advance(${EVERY}, 1/30)`);
    const rows = await rig.evl(`(() => {
      const B = new THREE.Box3(), out = [], v = new THREE.Vector3();
      const list = men.concat(corpses.filter(c => men.indexOf(c) < 0));
      for (const m of list) {
        if (m.vehicle || m.beast || !m.group || !m.group.visible || m.inVeh || m.fled) continue;
        m.group.updateMatrixWorld(true);
        B.setFromObject(m.group);
        if (!Number.isFinite(B.min.y)) continue;
        // the body in a 3 x 3 grid over its own footprint: the lowest mesh
        // point in each cell against the ground under that cell (a man lying
        // along a slope is ON the ground at his head and at his feet)
        const N = 3, lo = new Array(N * N).fill(Infinity);
        const sx = Math.max(0.01, B.max.x - B.min.x), sz = Math.max(0.01, B.max.z - B.min.z);
        m.group.traverse((o) => {
          if (!o.isMesh || !o.geometry || !o.visible) return;
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          const b = o.geometry.boundingBox;
          for (let i = 0; i < 8; i++) {
            v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(o.matrixWorld);
            const cx = Math.min(N - 1, Math.floor((v.x - B.min.x) / sx * N)), cz = Math.min(N - 1, Math.floor((v.z - B.min.z) / sz * N));
            if (v.y < lo[cz * N + cx]) lo[cz * N + cx] = v.y;
          }
        });
        let fl = -Infinity, sk = Infinity, nearest = Infinity;
        for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) {
          const y = lo[cz * N + cx];
          if (!Number.isFinite(y)) continue;
          const g = MAP.groundAt(B.min.x + (cx + 0.5) / N * sx, B.min.z + (cz + 0.5) / N * sz);
          const gap = y - g;
          if (gap < sk) sk = gap;
          if (gap < nearest) nearest = gap;
          if (gap > fl) fl = gap;
        }
        const st = m.dead ? (m.ragdoll ? "dead (ragdoll)" : "dead (no ragdoll)") : m.downed ? "down" : m.stance || "stand";
        const lying = (B.max.y - B.min.y) < 1.0;
        // float: his LOWEST point is clear of the ground (a lying body: any part of him is)
        out.push([st, +(lying ? fl : nearest).toFixed(3), +sk.toFixed(3), +(B.max.y - B.min.y).toFixed(2)]);
      }
      return out;
    })()`, false);
    for (const [st, fl, sk, h] of rows) (all[st] || (all[st] = [])).push([fl, sk, h]);
  }
  const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
  console.log("state               n    sink median   worst float   worst sink     out      height");
  for (const st of Object.keys(all).sort()) {
    const A = all[st];
    const fl = A.map((r) => r[0]), sk = A.map((r) => r[1]);
    // a prone man's rifle and elbows are legitimately off the ground: 35 cm for a lying body's highest gap
    const bad = A.filter((r) => r[0] > (r[2] < 1 ? 0.35 : 0.12) || r[1] < -0.12).length;
    const share = bad / A.length;
    if (share > 0.1) fail++;
    console.log(st.padEnd(18), String(A.length).padStart(4), "  ", (med(sk) * 100).toFixed(0).padStart(6) + " cm", "  ", (Math.max(...fl) * 100).toFixed(0).padStart(6) + " cm", "  ",
      (Math.min(...sk) * 100).toFixed(0).padStart(6) + " cm", "  ", (share * 100).toFixed(0).padStart(5) + " %", "   ", med(A.map((r) => r[2])).toFixed(2) + " m");
  }
  console.log("errors", JSON.stringify(rig.errors.slice(0, 3)));
} finally { await rig.close(); }
console.log(fail ? "GROUND CONTACT: FAIL " + fail : "GROUND CONTACT: ok");
process.exit(fail ? 1 : 0);

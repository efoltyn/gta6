#!/usr/bin/env node
/* tools/probe-pieces.mjs — WHERE DID THAT PIECE GO? One disaster on the
   island, sampled once a second: the highest collapse body and the highest
   debris body, with their velocity, contact and what holds them. The trace
   behind a CBZ.debrisAudit failure ("N pieces more than 120 m up").

     node tools/probe-pieces.mjs --only flood [--url disaster.html] [--secs 40] */
import { launch } from "./lib/cdp.mjs";
const argv = process.argv.slice(2);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const ID = arg("--only", "flood"), URL_REL = arg("--url", "disaster.html"), SECS = +arg("--secs", "40");
const rig = await launch({ rafBudget: 1600 });
try {
  await rig.open(URL_REL, "seed=90210");
  await rig.wait("window.CBZ && CBZ.game", 150000);
  await rig.wait(`(() => { if (CBZ.game.state === 'playing' && CBZ.game.mode === 'survival') return true;
    const mb = document.querySelector('.mode-btn[data-mode="survival"]'); if (mb) mb.click();
    const pb = document.getElementById('playBtn'); if (pb) pb.click(); return false; })()`, 300000, 250);
  const out = await rig.evl(`(async () => {
    const rows = [];
    for (const id of ${JSON.stringify(ID.split(','))}) {
    CBZ.modes.survival.reset(CBZ.game);
    CBZ.disasters.force(id);
    for (let s = 0; s < ${SECS}; s++) {
      for (let i = 0; i < 60; i++) CBZ.stepSim(1 / 60);
      await new Promise(r => setTimeout(r, 0));
      const B = (CBZ.collapse && CBZ.collapse._bodies) || [];
      let top = null;
      for (const b of B) if (!top || b.pos.y > top.pos.y) top = b;
      let dtop = null;
      if (CBZ.debris) CBZ.debris.forEachLive(function (b) { if (!dtop || b.mesh.position.y > dtop.mesh.position.y) dtop = b; });
      rows.push({ id, s, st: CBZ.disasters.state(), bodies: B.length,
        cTop: top ? { key: top.S.key, y: +top.pos.y.toFixed(1), vy: +top.v.y.toFixed(1), vh: +Math.hypot(top.v.x, top.v.z).toFixed(1), c: top.contact, floorY: +top.floorY.toFixed(1), maxUp: top.maxUp, t: +top.t.toFixed(1), n: top.chunks.length, lo: +top.lo.y.toFixed(1), parts: top.parts.length, cols: (top.cols||[]).filter(c=>c.y1!=null&&c.y1>top.pos.y-6&&c.y1<top.pos.y+6).map(c=>[+c.y1.toFixed(1), c.debris?'d':'w', c.debrisOwner||'']).slice(0,4) } : null,
        dTop: dtop ? { y: +dtop.mesh.position.y.toFixed(1), vy: +dtop.v.y.toFixed(1), owner: dtop.owner, med: !!dtop.inMedium } : null });
    }
    }
    return rows;
  })()`, true);
  for (const r of out) console.log(JSON.stringify(r));
  if (rig.errors.length) console.log("errors:", rig.errors.slice(0, 5));
} finally { await rig.close(); }

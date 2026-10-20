#!/usr/bin/env node
/* tools/island-cars-probe.mjs — boot disaster.html into a match and print
   CBZ.islandCarsAudit() a few times (are the island's real cars standing and
   drawn?). node tools/island-cars-probe.mjs [--url disaster.html] */
import { launch } from "./lib/cdp.mjs";
const argv = process.argv.slice(2);
const i = argv.indexOf("--url");
const URL_REL = i >= 0 ? argv[i + 1] : "disaster.html";
const rig = await launch({ rafBudget: 1600 });
try {
  await rig.open(URL_REL, "seed=90210&surv_bots=8");
  await rig.wait("window.CBZ && CBZ.game", 150000);
  await rig.evl("CBZ.SURV_BOTS = 8");
  const ok = await rig.wait(`(() => {
    if (CBZ.game.state === 'playing' && CBZ.game.mode === 'survival') return true;
    const mb = document.querySelector('.mode-btn[data-mode="survival"]'); if (mb) mb.click();
    const pb = document.getElementById('playBtn'); if (pb) pb.click();
    return false; })()`, 300000, 250);
  if (!ok) throw new Error("never entered a match");
  for (const secs of [1, 4, 10]) {
    await rig.evl(`(() => { const s = CBZ.stepSim || null; if (s) for (let k = 0; k < ${secs * 30}; k++) s(1 / 30); return true; })()`);
    const a = await rig.evl("JSON.stringify(CBZ.islandCarsAudit ? CBZ.islandCarsAudit() : null)");
    console.log("after +" + secs + " s:", a);
  }
  // --q file.js: one more expression evaluated in the page at the end (a diagnostic)
  const qi = argv.indexOf("--q");
  if (qi >= 0) console.log("q:", await rig.evl((await import("node:fs")).readFileSync(argv[qi + 1], "utf8")));
  if (rig.errors.length) console.log("errors:", rig.errors.slice(0, 8));
} finally { await rig.close(); }

#!/usr/bin/env node
/* tools/probes/people-island-probe.mjs — is the island player dressed, and
   does the sim still step? Boots disaster.html (or --url), starts a match,
   steps the sim with the forward key held and reports: any throw out of
   stepSim, how far the player went, what the chest is wearing. A find-the-bug
   probe, not a look: it prints numbers.
     node tools/probes/people-island-probe.mjs [--url index.html] */
import { launch } from "../lib/cdp.mjs";
const argv = process.argv.slice(2);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const URL_REL = arg("--url", "disaster.html");
const rig = await launch({ rafBudget: 1600 });
try {
  await rig.open(URL_REL, "seed=90210&surv_bots=12");
  if (!await rig.wait("window.CBZ && CBZ.game", 150000)) throw new Error("engine never came up");
  await rig.evl("CBZ.SURV_BOTS = 12");
  const playing = await rig.wait(`(() => {
    if (CBZ.game.state === 'playing' && CBZ.game.mode === 'survival') return true;
    const m = document.querySelector('[data-mode="survival"]'); if (m && CBZ.game.mode !== 'survival') m.click();
    const pb = document.getElementById('playBtn'); if (pb) pb.click();
    return false; })()`, 300000);
  if (!playing) throw new Error("never reached playing");
  const out = await rig.evl(`(async () => {
    const p = CBZ.player, ch = CBZ.playerChar, r = { throws: [] };
    const x0 = p.pos.x, z0 = p.pos.z;
    CBZ.keys = CBZ.keys || {};
    CBZ.keys.w = CBZ.keys.W = CBZ.keys.ArrowUp = true;
    for (let i = 0; i < 90; i++) {
      try { CBZ.stepSim(1 / 60); } catch (e) { if (r.throws.length < 3) r.throws.push(String(e && e.stack || e).slice(0, 600)); }
      if (i % 30 === 0) await new Promise(q => setTimeout(q, 0));
    }
    CBZ.keys.w = CBZ.keys.W = CBZ.keys.ArrowUp = false;
    r.travelled = +Math.hypot(p.pos.x - x0, p.pos.z - z0).toFixed(2);
    r.speed = p.speed; r.dead = p.dead; r.stun = p.stun; r.ko = p.ko; r.captureState = p.captureState; r.hp = p.hp;
    const t = ch.skinSlots.torso[0];
    r.chest = { map: !!(t.material && t.material.map), hex: t.material && t.material.color ? t.material.color.getHex().toString(16) : null, clothesKey: ch._clothesKey || null };
    r.have = { composite: !!CBZ.cityApplyComposite, recolor: !!CBZ.cityRecolorRig, face: !!CBZ.faceRegister, collide: !!CBZ.collide };
    r.radius = p.radius; r.grounded = p.grounded; r.y = +p.pos.y.toFixed(2);
    return JSON.stringify(r); })()`, true);
  console.log(typeof out === "string" ? JSON.stringify(JSON.parse(out), null, 1) : JSON.stringify(out));
  console.log("page errors:", JSON.stringify(rig.errors.slice(0, 6), null, 1));
} catch (e) { console.log("PROBE FAILED:", e.message); console.log(JSON.stringify(rig.errors.slice(0, 6))); }
await rig.close();

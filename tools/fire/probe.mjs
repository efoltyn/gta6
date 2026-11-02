#!/usr/bin/env node
/* tools/fire/probe.mjs — boot the island on the real GPU, run a disaster to a
   second, then evaluate an expression in the page and print it.

     node tools/fire/probe.mjs [--gpu webgpu] [--force volcano] [--state active] [--secs 7] [--mag 0.7] --expr '<js>'

   The same frozen-clock staging as tools/fire/shot.mjs, for questions a
   screenshot cannot answer (what is that black box, how many lights, what
   does the volume's uniform say). ONE Chrome, killed at the end. */
import { launch, sleep } from "../lib/cdp.mjs";
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const GPU = arg("gpu", "webgpu");
// --expr-file f: the body of an async function (await allowed), read from a file
const EXPR = arg("expr-file") ? `return (async function(){ ${readFileSync(arg("expr-file"), "utf8")} })();` : arg("expr", "return CBZ.gpuParticles.stats()");
const rig = await launch({ gpu: "real", rafBudget: 0, window: "1280,800" });
try {
  await rig.open(arg("page", "disaster.html"), "gpu=" + GPU);
  if (!(await rig.wait(`window.CBZ && CBZ.game && CBZ.stepSim && document.getElementById("playBtn")`, 400000, 500))) throw new Error("never booted");
  if (!(await rig.wait(`(function(){ if (CBZ.game.state === "playing" && CBZ.surv && CBZ.surv.arena) return true;
    const b = document.getElementById("playBtn"); if (b) b.click(); return false; })()`, 300000, 700))) throw new Error("never reached the island");
  if (GPU === "webgpu") await rig.evl(`CBZ.renderer.cbzReady`, true);
  const out = await rig.evl(`(async function(){
    window.requestAnimationFrame = function () { return 0; };
    const step = (s) => { for (let i = 0; i < Math.round(s * 60); i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
      if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; } if (CBZ.game.state !== "playing") CBZ.game.state = "playing"; } };
    step(1.5);
    const force = ${JSON.stringify(arg("force", ""))};
    if (force) {
      window.__volcanoMagPin = ${+arg("mag", 0.7)};
      CBZ.disasters.force(force); step(0.1);
      let g = 400; while (g-- > 0 && CBZ.disasters.state() !== ${JSON.stringify(arg("state", "active"))}) step(0.1);
      step(${+arg("secs", 6)});
    }
    try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {}
    return (function(){ ${EXPR} })();
  })()`, true);
  console.log(JSON.stringify(out, null, 1));
  const errs = rig.errors.filter((e) => !/not compatible/.test(e));
  if (errs.length) console.log("errors:\n  " + errs.slice(0, 15).join("\n  "));
} catch (e) { console.error("FAILED", e.message); }
finally { await rig.close(); }

/* tools/visual-presets/marine-pose.mjs — WHAT THE ORCA IS ACTUALLY DOING.

   OWNER, 2026-09-01: "Orca does this thing occasionally where it looks like
   its head is balancing on water and it's tail is in the air maybe this is a
   trick or non dive glitch but it's a weird look for a second and violates
   physics, improve shark and orca movement and animations."

   It IS a trick — a spy-hop, the move where an orca rises vertically to put
   its eye above the water and look at you. It looked like that because the
   height and the attitude were two unrelated hand-drawn curves that had never
   been asked to agree about where the sea was: the pitch was signed backwards
   (this repo's convention is that positive rotation.z on a nose-toward-+X body
   is NOSE UP, and all five orca acts wrote negative for it), and the act
   separately raised the whole body 5.5 m. Head on the water, flukes nine
   metres up, held for two seconds.

   Each subject freezes one beat of one animal and photographs it from the
   side, with the waterline in frame, so the pose is readable as a pose.

   THE BEFORE COLUMN IS A COMMIT, not a flag — launchSides() at the bottom
   stands the baseline up in its own worktree on its own port, so

     ba marine-pose

   is the whole command. */

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
/* PINNED BY SHA. Several agents push to this main, so "the commit before mine"
   stops being HEAD~1 the moment anyone else lands anything. */
const BASE_SHA = process.env.BA_POSE_BASE || "f645dc9";

async function stageMarinePose(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let D = window.__marinePoseBA;
  if (!D) {
    D = window.__marinePoseBA = {
      booted: false,
      step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); },
      sec(s) { D.step(Math.max(1, Math.round(s * 30))); },
      async boot() {
        if (D.booted) return true;
        for (let t = 0; t < 600 && CBZ.game.state !== "playing"; t++) {
          const m = document.querySelector('.mode-btn[data-mode="survival"]');
          if (m) m.click();
          const b = document.getElementById("playBtn");
          if (b) b.click();
          await sleep(150);
        }
        if (CBZ.game.state !== "playing") return false;
        for (let t = 0; t < 80 && !(CBZ.cityWildlife && CBZ.cityWildlife.length > 4); t++) {
          D.step(10); await sleep(40);
        }
        D._rafOrig = window.requestAnimationFrame;
        const orig = D._rafOrig;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => orig.call(window, () => res()));
        D.booted = true;
        return true;
      },
      orcas() {
        const out = [];
        for (const a of CBZ.cityWildlife || []) {
          if (a && !a.dead && a.species && a.species.id === "orca" && a.group) out.push(a);
        }
        return out;
      },
      sharks() {
        const out = [];
        for (const a of CBZ.cityWildlife || []) {
          if (a && !a.dead && !a.ridden && a.species && a.species.aquatic && a.group &&
              /shark|megalodon/.test(a.species.id)) out.push(a);
        }
        return out;
      },
      /* THE PLAYER GOES TO THE ANIMAL, never the other way round: the LOD and
         the off-screen sim exemptions are keyed on the player (wildlife.js),
         and dragging a whale to the beach only parks it on the seabed. */
      visit(a) {
        const P = CBZ.player, g = a.group;
        if (!P) return;
        P.pos.x = g.position.x + 40;
        P.pos.z = g.position.z;
        P.pos.y = (CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(P.pos.x, P.pos.z) : 0) + 1.4;
      },
      /* A HUNTING ANIMAL DOES NOT PERFORM. marine_predation owns any orca with
         a target, and orcaBrain's own ladder cancels an act over a committed
         rush — so the pod is stood down before a display act is staged. This
         is staging, not a behaviour change: it makes the "occasional" thing
         happen on cue, identically on both sides. */
      calm() {
        for (const a of D.orcas()) {
          a.hunger = 0;
          if (a._mp) { a._mp.target = null; a._mp.shipTarget = null; a._mp.rolling = null; }
          if (a._orca) { a._orca.committed = false; a._orca.state = "cruise"; a._orca.cool = 0; }
        }
      },
      /* THE SIDE-ON TRIPOD WITH THE SEA IN IT. The waterline is the whole
         subject, so the lens sits just above it and looks slightly down the
         body's beam — a pose photographed from above reads as a blob. */
      /* THE UNDERWATER TINT IS DRIVEN BY THE PLAYER, NOT THE CAMERA
         (world/water_underwater.js grades off CBZ.player's depth), and stepping
         the sim drops a floating player under the surface — which is why the
         first run of this preset came back with one column graded teal and the
         other not. The rider is lifted clear immediately before every capture. */
      dry() {
        const P = CBZ.player;
        if (!P) return;
        P.pos.y = (CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(P.pos.x, P.pos.z) : 0) + 2.2;
        if (P._phys) { P._phys.air = false; P._phys.down = 0; }
      },
      beamShot(a, back) {
        D.dry();
        const g = a.group;
        const surf = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(g.position.x, g.position.z) : 0;
        const h = a.heading || 0, side = h + Math.PI / 2;
        const R = back == null ? 15 : back;
        D.tripod(
          g.position.x + Math.cos(side) * R, surf + 3.4, g.position.z + Math.sin(side) * R,
          g.position.x, surf + 0.2, g.position.z);
      },
      tripod(px, py, pz, tx, ty, tz) {
        const cam = CBZ.camera; if (!cam) return;
        cam.position.set(px, py, pz);
        cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(tx, ty, tz));
      },
      /* WHERE THE ENDS OF THE ANIMAL ACTUALLY ARE, in world space, measured —
         never derived from rotation.z, because the sign of that is the thing
         under test. matrixskip.js short-circuits updateMatrixWorld on an
         invisible node, so both halves are done by hand. */
      ends(a) {
        const g = a.group;
        g.traverse(function (o) { o.updateMatrix(); });
        g.updateWorldMatrix(true, true);
        const id = (a.species && a.species.id) || "?";
        D._ends = D._ends || {};
        if (!D._ends[id]) {
          const rot = { x: g.rotation.x, y: g.rotation.y, z: g.rotation.z };
          g.rotation.set(0, 0, 0);
          g.traverse(function (o) { o.updateMatrix(); });
          g.updateWorldMatrix(true, true);
          const b = new T.Box3();
          g.traverse(function (o) { if (o.isMesh && o.visible !== false) b.expandByObject(o); });
          const sc = (g.scale && g.scale.x) || 1;
          D._ends[id] = { lo: (b.min.x - g.position.x) / sc, hi: (b.max.x - g.position.x) / sc };
          g.rotation.set(rot.x, rot.y, rot.z);
          g.traverse(function (o) { o.updateMatrix(); });
          g.updateWorldMatrix(true, true);
        }
        const e = D._ends[id];
        const p0 = g.localToWorld(new T.Vector3(e.hi, 0, 0));
        const p1 = g.localToWorld(new T.Vector3(e.lo, 0, 0));
        const hh = a.heading || 0;
        const d0 = (p0.x - g.position.x) * Math.cos(hh) + (p0.z - g.position.z) * Math.sin(hh);
        const nose = d0 >= 0 ? p0 : p1, tail = d0 >= 0 ? p1 : p0;
        const surf = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(g.position.x, g.position.z) : 0;
        return {
          noseM: +(nose.y - surf).toFixed(2),
          tailM: +(tail.y - surf).toFixed(2),
          midM: +(g.position.y - surf).toFixed(2),
        };
      },
      /* Force an act and run it to the beat worth photographing. Returns the
         animal, or null if this build cannot get the act to run at all — which
         on the BEFORE side is itself the finding, so it is reported rather
         than thrown. */
      act(name, dur, hold) {
        const list = D.orcas();
        if (!list.length) return null;
        const a = list[0];
        D.visit(a);
        D.calm();
        D.step(20);
        D.calm();
        if (!CBZ.orcaStage) return null;
        CBZ.orcaStage(a, "");
        CBZ.orcaStage(a, name, dur);
        for (let i = 0; i < Math.round(hold * 30); i++) { D.step(1); D.calm(); }
        return a;
      },
    };
    window.__cbzVisualCompare = {
      async render() {
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
        if (!CBZ.renderer) return;
        const raf = D._rafOrig;
        if (raf) {
          await new Promise((res) => raf.call(window, () => {
            CBZ.renderer.render(CBZ.scene, CBZ.camera);
            res();
          }));
        } else CBZ.renderer.render(CBZ.scene, CBZ.camera);
        await new Promise((r) => setTimeout(r, 1200));
      },
      advance(sec) { D.sec(sec); },
    };
  }

  if (!await D.boot()) return { ok: false, error: "no island match" };
  const out = {};
  let shot = null;

  /* EVERY SUBJECT IS A FIXED BEAT. The first cut of this preset hunted for the
     peak of each act by stepping and keeping the best frame — which is fine on
     a build where the act runs and useless on one where it does not, so the two
     columns ended up photographing different moments of different things. A
     fixed number of simulated steps after a forced start is the same instant on
     both sides by construction, and if one side has nothing happening at that
     instant, THAT is the finding. */
  const BEAT = { spyhop: 2.6, taillob: 0.62, breach: 1.45 };

  if (sub.id === "spyhop" || sub.id === "taillob" || sub.id === "breach") {
    const dur = sub.id === "spyhop" ? 4.6 : sub.id === "taillob" ? 3.1 : 2.9;
    const a = D.act(sub.id, dur, BEAT[sub.id]);
    if (!a) return { ok: false, error: "no orca" };
    const e = D.ends(a);
    out.noseM = e.noseM; out.tailM = e.tailM; out.midM = e.midM;
    if (sub.id === "spyhop") out.headOutM = e.noseM;
    if (sub.id === "taillob") out.flukesOutM = e.tailM;
    if (sub.id === "taillob") out.headUnderTailM = +(e.tailM - e.noseM).toFixed(2);
    D.beamShot(a, sub.id === "breach" ? 24 : 15);
    shot = e;
  } else if (sub.id === "shark-breach") {
    const list = D.sharks();
    if (!list.length) return { ok: false, error: "no shark" };
    const a = list[0];
    D.visit(a);
    D.step(6);
    /* THE BEAT IS PHYSICAL, NOT A STOPWATCH. "0.75 s after firing" is a
       different moment on the two builds — the after side is no longer having
       its pitch clipped, so the same wall time finds it further round the arc —
       and the first run of this subject duly photographed one shark climbing
       and one already coming down. The comparable instant is the one the water
       defines: THE FRAME THE BODY'S CENTRE FIRST CLEARS THE SURFACE. Both sides
       reach it, and it is the same event. */
    let fired = false;
    if (CBZ.sharkBreachNow) { try { fired = !!CBZ.sharkBreachNow(a); } catch (e2) { fired = false; } }
    out.fired = fired ? 1 : 0;
    let out0 = false;
    for (let i = 0; i < 150; i++) {
      D.step(1);
      const e2 = D.ends(a);
      if (e2.midM >= 0) { out0 = true; break; }
    }
    out.leftTheWater = out0 ? 1 : 0;
    const e = D.ends(a);
    out.noseM = e.noseM; out.tailM = e.tailM; out.midM = e.midM;
    /* THE ATTITUDE, IN DEGREES, off the measured ends — the number the clamp
       was eating. Not read from rotation.z: its sign is the thing under test. */
    const len = Math.max(0.5, Math.hypot(e.noseM - e.tailM, 6));
    out.climbDeg = +(Math.asin(Math.max(-1, Math.min(1, (e.noseM - e.tailM) / len))) * 57.2958).toFixed(1);
    D.beamShot(a, 22);
    shot = e;
  }

  window.__cbzVisualCompare.render();
  return { ok: true, side: input.side, debug: shot, metrics: out };
}

export default {
  id: "marine-pose",
  title: "Orca & Shark — A Pose The Water Would Allow",
  description: "The orca's own tricks, photographed side-on with the waterline in frame. BEFORE: the spy-hop is 72 degrees of NOSE-DOWN with the whole body lifted 5.5 m clear of the sea — head on the water, flukes in the air, held for two seconds; the lobtail does the same thing; and none of it even ran on a populated island, because the brain call that drives it was being swallowed one link up the chain. AFTER: an act names an angle and WHICH END is supposed to be out, and the depth is solved from the geometry — a spy-hop is a vertical whale with its face out of the water and the rest of it under, a lobtail is a head going under and flukes coming out, and a breach takes its pitch from the arc it is actually flying.",
  beforeLabel: "BEFORE · height and attitude drawn separately",
  afterLabel: "AFTER · the attitude decides the depth",
  pairNote: "Same island · same seed · same staged act · only the code differs",
  method: "Both columns boot index.html?mode=survival on the pinned seed by clicking the tile and PLAY like a player, then freeze the page's frame loop and advance the real match with CBZ.stepSim so a capture cannot race the renderer. The player is moved out to the pod (wildlife LOD is keyed on the player, and dragging a whale inshore only parks it on the seabed), the hunt is stood down so a display act is allowed to start at all, and the act is forced with the engine's own CBZ.orcaStage seam. Every number in the table is measured in WORLD SPACE off the model's own local X extent transformed through its matrix — never read off rotation.z, whose sign is the thing under test — with the matrices updated by hand because matrixskip.js short-circuits updateMatrixWorld on an off-screen body.",
  stageTimeoutMs: 360000,
  metrics: {
    headOutM: { label: "Spy-hop: rostrum above the sea", unit: "m", better: "higher" },
    flukesOutM: { label: "Lobtail: flukes above the sea", unit: "m", better: "higher" },
    noseM: { label: "Nose, relative to the surface", unit: "m" },
    tailM: { label: "Tail, relative to the surface", unit: "m" },
    midM: { label: "Body centre, relative to the surface", unit: "m" },
    climbDeg: { label: "Shark breach: nose-up as the body clears the sea", unit: "deg", better: "higher" },
    leftTheWater: { label: "Shark breach: body centre cleared the surface", better: "higher" },
    headUnderTailM: { label: "Lobtail: flukes above the head", unit: "m", better: "higher" },
  },
  metricsNote: "nose/tail/mid carry no better-direction on purpose: what is right depends on the act. A spy-hop wants the NOSE above zero and the tail below it; a lobtail wants exactly the opposite. Read them as a pair — in the before column both acts put the tail up and the head on the water, which is the complaint.",
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.cityWildlife && document.getElementById('playBtn')",
  beforeParams: { mode: "survival", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "survival", seed: "90210", cfg_BOOT_METER: "0" },
  subjects: [
    {
      id: "spyhop",
      label: "The Spy-Hop — The Move That Started This",
      focus: "An orca rises vertically to put its eye over the water and look at you. BEFORE: 72 degrees of nose-DOWN over a body lifted clear of the sea — the rostrum sits ON the waterline and the flukes stand in the air. AFTER: nose up, rostrum out, and the rest of the whale where a whale goes.",
    },
    {
      id: "taillob",
      label: "The Lobtail — Flukes Out, Head Under",
      focus: "0.62 s into a forced tail-lob — the first peak of the act's own swing, the same instant on both sides. BEFORE: the pitch is signed backwards against this repo's own convention and the body is RAISED while it happens. AFTER: the head goes down and the tailstock levers up, and the depth is solved so the flukes are what clears the water.",
    },
    {
      id: "breach",
      label: "The Breach — Nose Where The Body Is Going",
      focus: "Mid-arc. BEFORE: the pitch is a hand-drawn cosine, signed backwards, so the animal climbs nose-down and comes down nose-up. AFTER: the pitch is the arctangent of the arc's own vertical rate — the same law wildlife_shark.js has always used for its breach — so it cannot disagree with the flight.",
    },
    {
      id: "shark-breach",
      label: "The Shark's Arc, Un-Clipped",
      focus: "Not an orca bug, the same bug: wildlife_shark.js solves an honest ballistic pitch and then wildlife_rig.js's animateSwim overwrote it, clamped to its own ±0.5 rad, because the pass order every marine file documents is not the order that runs. BEFORE: a breach flattened to 29 degrees. AFTER: the arc the shark actually solved.",
    },
  ],
  stage: stageMarinePose,

  /* ---- THE BEFORE COLUMN IS A COMMIT --------------------------------------
     The worktree is REMOVED AND RE-ADDED every run: a reused one is a previous
     run's leftovers plus whatever wrote into it since, which looks like a clean
     pair and is comparing nothing. */
  async launchSides(ctx) {
    const root = (ctx && ctx.repoRoot) || ROOT;
    const wt = path.join(os.tmpdir(), "ba-marine-pose-base");
    const git = (args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
    try { git(["worktree", "remove", "--force", wt]); } catch (e) {}
    try { git(["worktree", "prune"]); } catch (e) {}
    git(["worktree", "add", "--detach", "--force", wt, BASE_SHA]);

    const serverPath = path.join(wt, "tools", "devserver.py");
    if (!existsSync(serverPath)) throw new Error("baseline worktree has no tools/devserver.py at " + serverPath);
    // a port nothing else here claims (probe.mjs 9200+, ba's static server
    // 8700+, megalodon-sight 8931, shark-orca-no-card 8933)
    const port = 8935;
    const srv = spawn("python3", [serverPath], {
      cwd: wt, env: Object.assign({}, process.env, { PORT: String(port) }),
      stdio: "ignore", detached: true,
    });
    const origin = `http://127.0.0.1:${port}/`;
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try { up = (await fetch(origin, { method: "HEAD" })).ok; } catch (e) { /* not yet */ }
      if (!up) await sleepMs(150);
    }
    if (!up) throw new Error("baseline server never answered at " + origin);
    if (ctx && ctx.log) ctx.log(`[marine-pose] BEFORE = ${BASE_SHA} at ${wt} on ${origin}`);

    return {
      before: origin,
      label: `${BASE_SHA} vs working tree`,
      async close() {
        try { process.kill(-srv.pid, "SIGTERM"); } catch (e) { try { srv.kill(); } catch (e2) {} }
        try { git(["worktree", "remove", "--force", wt]); } catch (e) {}
      },
    };
  },
};

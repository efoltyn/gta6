/* THE APEX FORM YOU COULD NOT SEE, FROM A CAMERA THAT COULD NOT SURFACE.

   THREE COMPLAINTS, ONE ANIMAL (owner, 2026-08-31):

     "when I get to be the megalodon it's so zoomed out that I can't even see
      myself in most water"

     "my camera is stuck underwater ... with the other sharks I can rise to
      surface and just swim on the surface and see the world from the surface.
      But with megalodon it's zoomed out and I'm stuck under it, looking up at
      it"

     "megalodon has this little black triangle-ish area in their underbody
      near where their head meets their body ... there shouldn't be black
      underneath, it should be white"

   THE BOOM WAS SOLVED AGAINST A WATER THAT DOES NOT EXIST. The previous wave
   sized the chase boom off the measured hull and capped it at a CONSTANT 24 m,
   picked off a tripod ladder shot in clear ocean at noon. This game solves its
   own sighting range from Duntley's law every frame (world/water_underwater.js
   publishes it as CBZ.waterSight) and that range moves by a factor of eight
   between open sea and the surf band. MEASURED on the live page, seed 90210, a
   20.8 m ridden megalodon at the surface: the water carried 15.9 m and the
   boom stood at 21.0 m — 93% of the distance at which this sea erases a body.
   The boom is now capped at 0.65 of the live range in the lens's own
   direction, which is where a body sits at ~5x the eye's contrast threshold
   rather than AT it, and the FOV opens by exactly what the shortened boom cost
   so the framing the last wave won is not handed back.

   THE DIVE RIG ASKED HOW BIG THE ANIMAL WAS AND CALLED IT DEPTH. Its authority
   ramp read `surf - W.y`: the submergence of the model ORIGIN, in metres.
   Every shark cruises with its back at the waterline; all that differs is how
   many metres of animal hang below it. So the ramp saturated for exactly one
   species, the rig never stood down, and its target — the origin, pushed back
   along a lens aimed several metres higher — became a feedback loop that
   settled with the eye 19.4 m UNDER the water while the animal's back was in
   the air. It now asks the animal's BACK (the saddle socket the ride already
   measures), which reads zero when the dorsal breaks the surface on a bull
   shark and a megalodon alike.

   THE BLACK TRIANGLE WAS THE THROAT, COMING THROUGH THE BELLY. hullShell's
   mouth notch lifts every ventral vertex forward of the jaw onto the seam, and
   a vertex only exists at a ring — so the lift is interpolated across the band
   from the last un-notched ring to the first notched one. On the megalodon
   that band is x = 1.60 -> 2.41 with nothing in between, and the belly is
   dragged up as one straight ramp under the head while the chin does not start
   until 2.1. RAYCAST INTO THE LIVE RIG, ventral centreline: at x = 1.9 the
   first thing a ray from below hits is sharkThroat group 1, colour 0x020101,
   standing 0.080 units proud of the skin meant to cover it. An un-notched ring
   is now pinned at the notch's own leading edge; the same pass resolves the
   authored countershading against the ring table it was written for, so
   truncation can no longer squeeze the belly line forward.

   FLAGLESS, SO THE BEFORE COLUMN IS A BUILD AND NOT A BRANCH. Nothing here
   ships behind a cfg_ toggle — git is the undo. launchSides() checks HEAD out
   into a throwaway worktree and serves it, so BEFORE is the shipped commit and
   AFTER is this working tree, byte for byte, on one machine at one seed.

     ba megalodon-sight            (or: node tools/before-after.mjs megalodon-sight)
*/

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

const subjects = [
  {
    id: "bull-anchor", ch: 0,
    label: "The Anchor — The Small End, Untouched",
    focus: "The control, and the whole reason to trust the rest. The starting bull shark under the game's own chase camera, in the water where the sighting cap never binds. BEFORE and AFTER should be the SAME picture: the boom curve is unchanged, only its ceiling moved, and on a 5 m shark in clear sea the ceiling is nowhere near. If this pair drifts, the cap is biting where it should not.",
  },
  {
    id: "meg-surface", ch: 1,
    label: "MEGALODON — The Lens Comes Up With The Animal",
    focus: "The beat the second complaint is about. Rise held, the megalodon at the top of its column with its back out of the water. BEFORE: the dive rig has full authority (the ramp read 3.52 m of origin submergence and saturated), it drags the eye down its own boom, and the lens settles 19.4 m under the sea looking UP at a shark that is in the air — green water, caustic ceiling, the belly overhead. AFTER: the rig measures the BACK, reads it at the waterline, stands down, and the walking camera frames a surfaced shark from above the surface. Sky, horizon, and the dorsal cutting it.",
  },
  {
    id: "meg-deep", ch: 2,
    label: "MEGALODON — The Boom The Water Can Carry",
    focus: "The first complaint, in open water. BEFORE: a boom sized off the hull alone, standing at a fraction of the sighting range the sea actually has that frame — the animal fading into its own fog. AFTER: the boom stops at 0.65 of the live Duntley range in the lens's direction and the FOV opens to pay back the framing, so the apex form is SOLID in frame rather than a grey suggestion at the threshold. The metric under it is the ratio, not the distance: a shorter boom is not the win, a visible shark is.",
  },
  {
    id: "meg-chin", ch: 3,
    label: "MEGALODON — The Black Under The Jaw",
    focus: "The third complaint, close enough to settle. A tripod under and forward of the head/body junction, looking up at the ventral surface. BEFORE: a dark wedge on the white belly right where the head meets the body, widest on the centreline and tapering to the flanks — the throat tube, whose containment is solved against un-notched ring radii, standing proud of a belly the mouth notch ramped up over it. AFTER: white skin. The metric is a raycast count, not an adjective: how many of a fixed grid of rays fired up into the belly land on an unlit near-black material instead of skin.",
  },
];

async function stageMegalodonSight(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const NEED = [0, 14, 34, 75];
  Math.random = (function (s) { return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })(20260831);

  let D = window.__megaSight;
  if (!D) {
    D = window.__megaSight = {
      chapter: -1, waterline: 0,
      step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); },

      async boot() {
        try { localStorage.setItem("CBZ_SHARK_VIEW_V1", "chase"); } catch (e) {}
        for (let t = 0; t < 600 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
          const mb = document.querySelector('.mode-btn[data-mode="sharksim"]');
          if (mb) mb.click();
          const pb = document.getElementById("playBtn");
          if (pb) pb.click();
          await sleep(150);
        }
        if (CBZ.game.state !== "playing") return false;
        for (let t = 0; t < 80 && !D.armed(); t++) { D.step(15); await sleep(20); }
        if (!D.armed()) return false;
        D.waterline = CBZ.sharkSim.waterline;
        const card = document.getElementById("sharkviewpick");
        if (card) { const b = card.querySelector("button"); if (b) b.click(); }
        /* AND PIN IT, LOUDLY. The shark sim has two views and the dive rig
           deliberately stands down in the other one ("first person already
           rides the body"). A run that drifts into fpsmode photographs a
           camera that is not the one under test and does it SILENTLY — the
           numbers still come back, they are just about something else. This
           cost a full measurement round before it was caught, so it fails
           here instead of lying. */
        if (CBZ.setFPS) { try { CBZ.setFPS(false); } catch (e) {} }
        D.step(20);
        if (CBZ.fps && CBZ.fps.active) return false;
        D._rafOrig = window.requestAnimationFrame;
        await D.killFrames();
        return true;
      },
      async killFrames() {
        const orig = D._rafOrig || window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => orig.call(window, () => res()));
      },
      armed() {
        return !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
          CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark);
      },

      // ---- the island ------------------------------------------------------
      arena() { return CBZ.surv.arena; },
      playerAngle() {
        const A = D.arena(), P = CBZ.player;
        return Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0;
      },
      ringPoint(ang, r) {
        const A = D.arena();
        return { x: A.center.x + Math.cos(ang) * r, z: A.center.z + Math.sin(ang) * r };
      },
      depth(x, z) { return CBZ.survFloodDepthMeanAt ? Math.max(0, CBZ.survFloodDepthMeanAt(x, z)) : 0; },
      camYawAlong(h) { return Math.atan2(-Math.cos(h), -Math.sin(h)); },
      chaseAlong(pitch) {
        const S = CBZ.sharkSim.shark;
        if (CBZ.cam) { CBZ.cam.yaw = D.camYawAlong(S.heading || 0); CBZ.cam.pitch = pitch == null ? 0.26 : pitch; }
        D.step(12);
      },
      level(sec) {
        const k = CBZ.keys;
        k.control = false; k[" "] = false; k.shift = false; k.w = true;
        D.step(Math.max(1, Math.round((sec || 3) * 30)));
        k.w = false; D.step(20);
      },
      /* HOLD THE RISE. The surface beat is about a body at the TOP of its
         column, which is a held input, not a place you can teleport to — the
         ride's own clamp decides how high it may ride and the camera pass is
         what this preset is arguing about. */
      rise(sec) {
        const k = CBZ.keys;
        k.control = false; k[" "] = true; k.w = true;
        D.step(Math.max(1, Math.round((sec || 10) * 30)));
        k.w = false; D.step(60); k[" "] = false;
      },
      dive(sec) {
        const k = CBZ.keys;
        k.w = true; k.control = true;
        D.step(Math.max(1, Math.round((sec || 4) * 30)));
        k.control = false; k.w = false;
      },
      offshore(want) {
        const P = CBZ.player, ang = D.playerAngle();
        let best = null, bestD = -1;
        for (let r = D.waterline + 20; r < D.waterline + 620; r += 6) {
          const p = D.ringPoint(ang, r);
          const d = D.depth(p.x, p.z);
          if (d > bestD) { bestD = d; best = p; }
          if (d >= (want || 30)) { P.pos.x = p.x; P.pos.z = p.z; D.step(4); return d; }
        }
        if (best) { P.pos.x = best.x; P.pos.z = best.z; D.step(4); }
        return bestD;
      },
      peace() {
        for (const a of CBZ.cityWildlife || []) {
          if (a.dead || !a.species) continue;
          if (CBZ.sharkSim && a === CBZ.sharkSim.shark) continue;
          if (a.species.id === "orca" || (a.species.aquatic && (a.species.bite || 0) >= 24)) {
            a.pos.x += 500; a.hunger = 0;
            if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
          }
        }
        if (CBZ.sharkSim) {
          const S = CBZ.sharkSim.shark;
          if (S) S.hp = S.maxHp;
          CBZ.sharkSim.podT = 45;
        }
      },
      shallow(extra) {
        const P = CBZ.player, p = D.ringPoint(D.playerAngle(), D.waterline + 6 + (extra || 0));
        P.pos.x = p.x; P.pos.z = p.z;
      },
      jawAhead() {
        const S = CBZ.sharkSim.shark;
        const jp = (CBZ.creatureJawPoint && CBZ.creatureJawPoint(S)) || { x: 2.1 };
        return jp.x * ((S.group && S.group.scale.x) || 1);
      },
      bait(n, extra) {
        const S = CBZ.sharkSim.shark, h = S.heading || 0, jaw = D.jawAhead();
        let placed = 0;
        for (const b of CBZ.bots) {
          if (!b || b.dead || placed >= n) continue;
          const d = jaw + (extra || 1.2) + placed * 1.0;
          b.pos.x = S.pos.x + Math.cos(h) * d; b.pos.z = S.pos.z + Math.sin(h) * d;
          b.pos.y = CBZ.surv.floorAt(b.pos.x, b.pos.z);
          b.target.set(b.pos.x, 0, b.pos.z); b.pause = 40;
          placed++;
        }
        return placed;
      },
      feedToTier(tier) {
        const sim = CBZ.sharkSim;
        for (let round = 0; round < 8 && sim.tier < tier; round++) {
          D.peace(); D.shallow(4); D.step(12);
          sim.mass = Math.max(sim.mass, NEED[tier]);
          D.bait(2, 1.2);
          for (let s = 0; s < 160 && sim.tier < tier; s++) D.step(1);
        }
        return sim.tier >= tier && D.armed();
      },

      /* A TRIPOD UNDER THE CHIN, in body lengths, so a bull and a megalodon
         are photographed at the same relative distance and the black wedge is
         argued about at the same apparent size on both columns. */
      underChin(a, lengths, rise) {
        const cam = CBZ.camera; if (!cam || !a || !a.group) return;
        const c = a.group.position, h = a.heading || 0;
        const L = D.hull(a), d = Math.max(2.5, L * lengths);
        // in front of the nose and BELOW the belly, looking back up the throat
        const tx = c.x + Math.cos(h) * L * 0.42, tz = c.z + Math.sin(h) * L * 0.42;
        cam.position.set(tx + Math.cos(h) * d, c.y - d * (rise == null ? 0.55 : rise), tz + Math.sin(h) * d);
        cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(tx, c.y + L * 0.06, tz));
        cam.updateMatrixWorld(true);
      },

      // ---- what the pair claims, as numbers --------------------------------
      hull(a) {
        const b = CBZ.cityRideBoom && CBZ.cityRideBoom(a);
        if (b && b.len > 0) return b.len;
        return CBZ.marineBodyLen ? CBZ.marineBodyLen(a) : 6;
      },
      /* HOW FAR UNDER THE WATERLINE THE EYE IS. Negative is in the air. This is
         the second complaint stated as one signed number, and it is measured
         against the surface under the CAMERA, which is the same column
         water_underwater.js decides the green tint from. */
      camDepth() {
        const cam = CBZ.camera;
        if (!cam || !CBZ.citySeaHeightAt) return null;
        return +(CBZ.citySeaHeightAt(cam.position.x, cam.position.z) - cam.position.y).toFixed(2);
      },
      /* THE BOOM AS A FRACTION OF WHAT THE WATER CAN CARRY. 1.0 means the body
         sits exactly at the distance this sea erases it; the fix targets 0.65,
         where it sits at about five times the eye's contrast threshold. Above
         water there is no cap and this reads near zero. */
      seeFrac(a) {
        const cam = CBZ.camera, ws = CBZ.waterSight;
        if (!cam || !ws || !a || !a.group) return null;
        const c = a.group.position;
        const dy = c.y - cam.position.y;
        const d = Math.hypot(c.x - cam.position.x, dy, c.z - cam.position.z);
        if (!(d > 0.01)) return null;
        const r = ws.rangeAt(d > 0 ? dy / d : 0);
        return r > 0 ? +(d / r).toFixed(3) : null;
      },
      inFramePct(a) {
        const cam = CBZ.camera; if (!cam || !a || !a.group) return null;
        const box = new T.Box3().setFromObject(a.group);
        if (!isFinite(box.min.x) || !isFinite(box.max.x)) return null;
        cam.updateMatrixWorld(true);
        const v = new T.Vector3();
        let inside = 0;
        for (let i = 0; i < 8; i++) {
          v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
          v.project(cam);
          if (v.z >= -1 && v.z <= 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1) inside++;
        }
        return Math.round(inside * 100 / 8);
      },
      /* THE BLACK, COUNTED. A fixed grid of rays fired straight UP into the
         ventral surface at the head/body junction, in the body's own frame
         with rotation zeroed: how many of them hit a near-black unlit material
         (throat, sack, chin shell) instead of skin. A ray entering a FrontSide
         mesh from OUTSIDE hits it, which is why this fires upward from below
         and not downward from inside — the r128 sidedness trap. */
      blackUnderChin(a) {
        const g = a && a.group; if (!g) return null;
        const rx = g.rotation.x, ry = g.rotation.y, rz = g.rotation.z;
        g.rotation.set(0, 0, 0); g.updateMatrixWorld(true);
        const O = g.position, s = g.scale.x || 1;
        const rc = new T.Raycaster(); rc.far = 400;
        const meshes = [];
        g.traverse(function (o) { if (o.isMesh && o.visible && o.geometry) meshes.push(o); });
        const grpOf = function (h) {
          const gs = h.object.geometry.groups;
          if (!gs || !gs.length) return 0;
          const i = h.faceIndex * 3;
          for (const q of gs) if (i >= q.start && i < q.start + q.count) return q.materialIndex | 0;
          return 0;
        };
        let dark = 0, hits = 0;
        for (let lz = -0.6; lz <= 0.6001; lz += 0.1) {
          for (let lx = 1.2; lx <= 2.6001; lx += 0.1) {
            rc.set(new T.Vector3(O.x + lx * s, O.y - 8 * s, O.z + lz * s), new T.Vector3(0, 1, 0));
            const h = rc.intersectObjects(meshes, false);
            if (!h.length) continue;
            hits++;
            const M = h[0].object.material, gi = grpOf(h[0]);
            const m = Array.isArray(M) ? (M[gi] || M[0]) : M;
            let lum = 1;
            try { lum = 0.2126 * m.color.r + 0.7152 * m.color.g + 0.0722 * m.color.b; } catch (e) { lum = 1; }
            if (lum < 0.02) dark++;          // 0x020101 / 0x010000 / 0x000000
          }
        }
        g.rotation.set(rx, ry, rz); g.updateMatrixWorld(true);
        return hits ? dark : null;
      },
      shot(a) {
        return {
          camDepth: D.camDepth(),
          seeFrac: D.seeFrac(a),
          inFramePct: D.inFramePct(a),
          blackUnderChin: D.blackUnderChin(a),
        };
      },
    };

    window.__cbzVisualCompare = {
      async render() {
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
        const flash = document.getElementById("sharkflash");
        if (flash) { flash.style.transition = "none"; flash.style.opacity = "0"; }
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
      advance(sec) { D.step(Math.max(1, Math.round(sec * 30))); },
    };
  }

  const out = {};
  const CH = [
    async function bullAnchor() {
      if (!await D.boot()) throw new Error("no match / sim never armed");
      D.peace();
      D.offshore(24);
      D.dive(2.6);
      D.level(2.4);
      D.chaseAlong(0.28);
      Object.assign(out, D.shot(CBZ.sharkSim.shark));
      /* THE ANCHOR SCORES NOTHING IT CANNOT CLAIM. A bull shark in clear water
         is a CONTROL: the cap never binds on it and it is not the animal that
         could not surface, so a signed depth and a sighting ratio here are
         staging noise wearing a better/worse arrow. What this beat is for is
         the two that must not move — the framing and the skin. */
      out.camDepth = null;
      out.seeFrac = null;
    },
    async function megSurface() {
      if (!D.feedToTier(3)) throw new Error("never evolved to megalodon");
      D.peace();
      /* WATER DEEP ENOUGH TO SWIM IN, NOT THE DEEPEST HOLE ON THE ISLAND.
         The beat is about the TOP of the column, and a megalodon climbs at
         about 3 m/s — starting it 60 m down spends the whole hold getting
         back, which is how the first run of this preset photographed the lens
         still 5 m under and called it the answer. Twenty-four metres is deep
         water for this shore and the rise finishes inside the hold. */
      D.offshore(24);
      D.rise(30);
      D.chaseAlong(0.10);
      Object.assign(out, D.shot(CBZ.sharkSim.shark));
      out.seeFrac = D.seeFrac(CBZ.sharkSim.shark);
    },
    async function megDeep() {
      D.peace();
      D.offshore(40);
      D.dive(4.0);
      D.level(3.2);
      D.chaseAlong(0.30);
      Object.assign(out, D.shot(CBZ.sharkSim.shark));
      // being deep is the POINT of a deep beat; a depth with a "lower is
      // better" arrow on it would score the staging, not the change
      out.camDepth = null;
    },
    async function megChin() {
      D.peace();
      /* LIT WATER, NOT THE ABYSS. The first run of this preset photographed
         the belly at 40 m down, where a black wedge on white skin is a black
         wedge on grey skin — the mark was there and it was hard to look at.
         The complaint is about a surface a player sees while hunting the
         shallows, so shoot it in the light that reaches them. */
      D.offshore(18);
      D.dive(1.0);
      D.level(2.0);
      const S = CBZ.sharkSim.shark;
      D.underChin(S, 0.34, 0.5);
      Object.assign(out, D.shot(S));
      out.seeFrac = null;                 // a tripod's distance is not the rig's
      out.camDepth = null;
    },
  ];

  while (D.chapter < sub.ch) {
    D.chapter++;
    await CH[D.chapter]();
  }

  await window.__cbzVisualCompare.render();
  return {
    ok: true, side: input.side, chapter: sub.ch,
    debug: {
      state: CBZ.game.state,
      tier: CBZ.sharkSim ? CBZ.sharkSim.tier : null,
      boom: CBZ.cityRideBoom ? CBZ.cityRideBoom() : null,
      fov: CBZ.camera ? +CBZ.camera.fov.toFixed(1) : null,
    },
    metrics: out,
  };
}

export default {
  id: "megalodon-sight",
  title: "Megalodon — The Boom The Water Can Carry, The Lens That Surfaces, The Belly That Is White",
  description:
    "A FLAGLESS before/after on the live shark sim. BEFORE is the shipped commit, checked out into a throwaway git worktree and served from it; AFTER is this working tree. Both boot index.html?mode=sharksim on the same island at the same seed, click the tile and PLAY like a player, and climb the real ladder to the megalodon by eating real survivors. Three changes are under test at once because they are one animal's three complaints: the chase boom now stops at what the water's own Duntley sighting range can carry (with the FOV opening to pay back the framing), the dive rig's authority is measured off the animal's BACK instead of its origin so a surfaced megalodon hands the frame to a camera that is above the waterline, and the hull gets an un-notched ring at the mouth notch's leading edge so the black throat stops coming through the white belly at the head/body junction.",
  beforeLabel: "BEFORE · HEAD (the shipped build)",
  afterLabel: "AFTER · this working tree",
  pairNote: "Same machine · same island · same seed · the game's own chase camera and HUD",
  method:
    "launchSides() checks HEAD out into a detached git worktree under the system temp dir and serves it on its own port, so the before column is a BUILD rather than a flag — none of these three changes ships behind a cfg_ toggle. Each side then boots index.html?mode=sharksim on the pinned seed, clicks the mode tile and PLAY exactly like a player with the view pref pinned to the chase boom, and a per-page driver advances the real match with CBZ.stepSim (the frame loop is frozen after boot so a capture cannot race the renderer). The ladder is climbed by baiting and eating real survivor bots. The three chase beats leave framing entirely to the game's own rig and only point the player's yaw down the body's axis; the chin beat uses a fixed tripod placed in BODY LENGTHS so both columns photograph the same anatomy at the same apparent size.",
  metrics: {
    camDepth: { label: "The eye, below the waterline", unit: "m", better: "lower" },
    seeFrac: { label: "Boom ÷ what the water can carry", better: "neutral" },
    inFramePct: { label: "Corners of the body inside the frame", unit: "%", better: "higher" },
    blackUnderChin: { label: "Rays into the belly that land on black", better: "lower" },
  },
  metricsNote:
    "seeFrac has NO better/worse direction on purpose, and that is the whole point of it: it has a TARGET, not a direction. 1.0 is the distance at which this sea erases a body, and the cap aims at 0.65 — about five times the eye's contrast threshold — so scoring it 'lower is better' would call the design point a regression and would score a camera jammed inside the animal, which is the PREVIOUS complaint, as a perfect result. Read it as a band: near 0.9 is 'I can't see myself', 0.65 is solid, near 0 is a wall of skin. camDepth is SIGNED and negative means the lens is in the air — on the surface beat that flip from a large positive number to a negative one IS the second complaint, answered. seeFrac is the first complaint stated arithmetically: 1.0 is the distance at which this sea erases a body, so anything near it is 'I can't see myself', and the target is 0.65 (about five times the eye's contrast threshold), not zero — a camera jammed against the animal would score 0.0 and be the previous complaint. inFramePct is the guard on that trade: it must NOT collapse while seeFrac falls, which is what the FOV compensation is for — with one honest exception it will flag: on the surface beat it falls 88 -> 75, because putting the eye ON the waterline of a 21 m animal genuinely costs corners of the box. That is the trade the second complaint asks for and it is stated here rather than hidden by nulling the metric. And read it next to seeFrac before believing it, because inFramePct is GEOMETRIC — it projects eight corners of a bounding box and cannot tell you whether any pixels arrived. On the deep beat the before column scores 88% at seeFrac 1.23, which is 88% of a body standing PAST the distance this sea erases it: the corners are in frame and the shark is not on the screen. Look at the pair. A visible 75% beats an invisible 88%. blackUnderChin is a raycast count and 0 is the whole claim; camDepth and seeFrac are null on the chin beat because a fixed tripod's distance is the preset's number, not the rig's.",
  viewport: { width: 1280, height: 720 },
  readyExpression:
    "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.cityMountAnimal && document.getElementById('playBtn')",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 360000,
  subjects,
  stage: stageMegalodonSight,

  /* ---- THE BEFORE COLUMN IS A COMMIT, NOT A FLAG -------------------------
     ba's web adapter offers launchSides() for presets whose two sides are two
     SERVERS rather than one server and a query param. That is exactly the
     shape a flagless change needs, and this repo's doctrine is flagless: git
     is the undo, so there is no cfg_ toggle to flip and the only honest
     baseline is the commit itself.

     The worktree is REMOVED AND RE-ADDED every run. A reused one is a
     previous run's leftovers plus whatever wrote into it since, and a "before"
     column quietly serving a dirty tree is the worst failure this tool has —
     it looks like a clean pair and is comparing nothing. */
  async launchSides(ctx) {
    const root = (ctx && ctx.repoRoot) || ROOT;
    const wt = path.join(os.tmpdir(), "ba-megalodon-sight-head");
    const git = (args, opts) => execFileSync("git", args, Object.assign({ cwd: root, stdio: "ignore" }, opts || {}));
    try { git(["worktree", "remove", "--force", wt]); } catch (e) {}
    try { git(["worktree", "prune"]); } catch (e) {}
    git(["worktree", "add", "--detach", "--force", wt, "HEAD"]);

    const serverPath = path.join(wt, "tools", "devserver.py");
    if (!existsSync(serverPath)) throw new Error("HEAD worktree has no tools/devserver.py at " + serverPath);
    // a port nothing else in this repo's tooling claims (probe.mjs takes 9200+,
    // ba's own static server 8700+)
    const port = 8931;
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
    if (!up) throw new Error("HEAD worktree server never answered at " + origin);
    if (ctx && ctx.log) ctx.log(`[megalodon-sight] BEFORE = HEAD worktree at ${wt} on ${origin}`);

    return {
      before: origin,
      label: "HEAD vs working tree",
      async close() {
        try { process.kill(-srv.pid, "SIGTERM"); } catch (e) { try { srv.kill(); } catch (e2) {} }
        try { git(["worktree", "remove", "--force", wt]); } catch (e) {}
      },
    };
  },
};

/* THE APEX FORM, FRAMED — and the stickers taken off its back.

   A same-checkout flag A/B. Both columns boot the SAME build of
   index.html?mode=sharksim on the disaster island with the same pinned seed,
   click the tile and PLAY like a player, and climb the real ladder by eating
   real survivors. The ONLY difference is the query string:

     BEFORE  ?cfg_CAM_SHARK_FIT=0 &cfg_SHARK_RAKE_SCARS=1   the shipped code
     AFTER   (nothing)                                      this wave

   TWO COMPLAINTS, ONE SCREEN (owner, 2026-08-30):

     "for megalodon in shark sim the camera is way way zoomed in, it needs to
      be smarter and zoom out when the shark gets bigger"

     "find the white markers on the backs of all sharks and maybe orcas but
      def sharks and get rid of them"

   THE CAMERA. city/wildlife_tame.js's dive rig sized its boom as
   `4.2 + speciesScale * 3.2` — linear in a number that says nothing about how
   long the animal is. Measured on this seed: the bull shark rides a 7.5 m boom
   on a 4.8 m hull (1.55 body lengths) and the megalodon a 14.5 m boom on a
   24.4 m hull (0.59). The apex form the whole ladder climbs toward was the one
   body the camera sat INSIDE. The boom is now solved off the animal's own
   measured hull, and it holds a hard stand-off at every depth instead of
   handing the frame back to the walking camera's 4.35 m boom the moment the
   dorsal breaks the surface.

   THE MARKERS. city/wildlife/aquatic.js painted 8–14 pale rake scars
   (0x99a3a7 … 0xaeb6b8) on each shark's UPPER surfaces — that is, on the only
   part of a countershaded animal that is dark. They did not read as healed
   bite marks from any angle the game actually uses. They read as white
   stickers stuck to the back. Deleted; the dark flank folds stay.

   Nothing here is posed in a studio. Every capture is the live game's own
   screen, HUD and killfeed included, advanced with CBZ.stepSim so the
   storyboard cannot depend on how fast this machine rasterises.

     node tools/before-after.mjs megalodon-camera
*/

const subjects = [
  {
    id: "bull-chase", ch: 0,
    label: "The Small End, Unchanged",
    focus: "The control. The starting bull shark under the game's own chase camera, the framing nobody ever complained about. BEFORE and AFTER should be the same picture at 7.5 m of boom — the new curve is ANCHORED here, so if this pair drifts the anchor is wrong. What does differ is the skin: look along the back for the pale rake marks.",
  },
  {
    id: "bull-back", ch: 1,
    label: "The White Markers, Close Up",
    focus: "The same bull shark from over its own shoulder, close enough to settle it. BEFORE: nine pale ribbons lying across the dark dorsal surface — the 'white markers on the back'. AFTER: bare skin. The dark horizontal flank folds behind the head are untouched; they were never the complaint, and they are the crease read the reference sheet asked for.",
  },
  {
    id: "megalodon-chase", ch: 2,
    label: "MEGALODON — The Camera Was Inside The Animal",
    focus: "The beat this wave exists for. Same match, same seed, the apex form in deep water under the live chase camera. BEFORE: 14.5 m of boom on 24.4 m of shark — the body overflows the frame in every direction and the player is flying a wall of grey skin. AFTER: the boom is solved off the measured hull and the whole megalodon is in frame, still filling far more of it than the bull ever did.",
  },
  {
    id: "megalodon-shallow", ch: 3,
    label: "MEGALODON — Dorsal Out, In The Shallows",
    focus: "The half the dive rig used to drop. Above its surface dead band the old pass returned outright and handed the frame to systems/camera.js's 4.35 m walking boom — fine on a bull shark, and INSIDE a megalodon. A shallow cruise with the dorsal out is most of the shore hunting in this game. AFTER: the fit distance is a floor at every depth, so the lens holds its stand-off across the waterline instead of falling into the back it is supposed to be following.",
  },
  {
    id: "great-white-back", ch: 4,
    label: "Every Shark, Not Just Yours",
    focus: "A WILD body, not the one you are wearing — the rake scars were declared on four species (great white 11, megalodon 14, great hammerhead 8, bull 9), so every shark in the sea carried them, not just yours. This is the honest end of the pair: on the great white's own pale grey back the eleven ribbons are far subtler than they are on the bull's dark one, which is exactly why the metric under it is a triangle count and not an adjective. 88 → 0."
  },
];

async function stageMegalodonCamera(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const NEED = [0, 14, 34, 75];              // the ladder's mass thresholds
  // one deterministic stream on both sides
  Math.random = (function (s) { return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })(20260830);

  let D = window.__megaCam;
  if (!D) {
    D = window.__megaCam = {
      chapter: -1, waterline: 0,
      step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); },
      sec(s) { D.step(Math.max(1, Math.round(s * 30))); },

      async boot() {
        // the view pref decides where a match STARTS; this preset is about the
        // chase boom, so pin it before the mode ever opens its chooser card
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
        /* From here the match advances ONLY when a chapter steps it. Killing
           the page's own frame loop is what lets a staged camera survive to
           the capture; drain the one already-queued callback in a frame we
           control so its re-arm hits the stub and the chain is dead for good. */
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

      // ---- the island's geometry -----------------------------------------
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
      // the camera yaw that looks ALONG a world heading (keys.w moves (-sin,-cos)·yaw)
      camYawAlong(h) { return Math.atan2(-Math.cos(h), -Math.sin(h)); },
      // point the PLAYER's camera down the body's own axis and let the game's
      // rig do the framing — the whole subject of this preset is that rig
      chaseAlong(pitch) {
        const S = CBZ.sharkSim.shark;
        if (CBZ.cam) { CBZ.cam.yaw = D.camYawAlong(S.heading || 0); CBZ.cam.pitch = pitch == null ? 0.26 : pitch; }
        // camera.js smooth-damps its boom; three ticks photographs the damp,
        // not the framing. Twelve is past the time constant on both sides.
        D.step(12);
      },
      /* LEVEL OUT. A body still pitched out of a dive puts the boom under its
         own belly and photographs the seabed — which is a picture of the
         staging, not of the boom. Ordinary forward swimming with no vertical
         input is the pose the chase camera actually exists for. */
      level(sec) {
        const k = CBZ.keys;
        k.control = false; k[" "] = false; k.shift = false; k.w = true;
        D.step(Math.max(1, Math.round((sec || 3) * 30)));
        k.w = false;
        D.step(20);
      },
      // a detached tripod, in body lengths, for the two skin close-ups
      shoulder(a, lengths, elev, swing) {
        const cam = CBZ.camera; if (!cam || !a || !a.group) return;
        const c = a.group.position, h = a.heading || 0;
        const d = Math.max(2.5, D.hull(a) * lengths), ax = h + (swing == null ? 2.5 : swing);
        const r = d * Math.cos(elev);
        cam.position.set(c.x + Math.cos(ax) * r, c.y + d * Math.sin(elev), c.z + Math.sin(ax) * r);
        cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(c.x, c.y, c.z));
        cam.updateMatrixWorld(true);
      },

      // ---- the match ------------------------------------------------------
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
      /* A FIXED BERTH, not "wherever the shark drifted to". The two columns
         run the same script but not the same camera, and a beat that parks off
         the player's CURRENT bearing lands them in different water — which on
         the two skin close-ups means different light, and a pair whose halves
         are lit differently is arguing about the wrong thing. PARK_ANG is a
         constant, so both sides photograph the same patch of sea. */
      PARK_ANG: 0.9,
      park(extra) {
        const P = CBZ.player, p = D.ringPoint(D.PARK_ANG, D.waterline + (extra || 12));
        P.pos.x = p.x; P.pos.z = p.z;
        D.step(24);
      },
      /* Offshore into the deepest column this bearing has, then DIVE — the
         chase beats are about the boom, and a boom photographed against the
         seabed is a picture of the seabed. */
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
      dive(sec) {
        const k = CBZ.keys;
        k.w = true; k.control = true;
        D.step(Math.max(1, Math.round((sec || 4) * 30)));
        k.control = false; k.w = false;
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
      findWild(id) {
        for (const a of CBZ.cityWildlife || []) {
          if (a && !a.dead && !a.external && !a.ridden && a.species && a.species.id === id && a.group) return a;
        }
        return null;
      },
      /* A wild body of a named species, parked beside the player at the
         player's own depth so the two columns photograph the same animal in
         the same water rather than whatever the sea happened to be doing. */
      wildBeside(id, ahead, side) {
        let a = D.findWild(id);
        const P = CBZ.player, S = CBZ.sharkSim.shark, h = S.heading || 0;
        if (!a && CBZ.cityWildlifeSpawnAt) {
          a = CBZ.cityWildlifeSpawnAt(id, P.pos.x + 24, P.pos.z + 24);
          if (a) D.step(8);
        }
        if (!a) return null;
        a.hunger = 0; a.state = "wander";
        a.pos.x = P.pos.x + Math.cos(h) * ahead + Math.cos(h + 1.57) * side;
        a.pos.z = P.pos.z + Math.sin(h) * ahead + Math.sin(h + 1.57) * side;
        a.pos.y = S.pos.y;
        if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
        D.step(6);
        if (a.group) {
          a.group.position.set(a.pos.x, S.group.position.y, a.pos.z);
          a.group.updateMatrixWorld(true);
        }
        return a;
      },

      // ---- what the pair is claiming, as numbers --------------------------
      hull(a) {
        const b = CBZ.cityRideBoom && CBZ.cityRideBoom(a);
        if (b && b.len > 0) return b.len;
        return CBZ.marineBodyLen ? CBZ.marineBodyLen(a) : 6;
      },
      /* The boom, MEASURED off the live lens rather than read back out of the
         formula that is the thing under test. Distance from the eye to the
         animal's own origin. */
      boomM(a) {
        const cam = CBZ.camera; if (!cam || !a || !a.group) return null;
        const c = a.group.position;
        return +Math.hypot(cam.position.x - c.x, cam.position.y - c.y, cam.position.z - c.z).toFixed(2);
      },
      /* CAN YOU SEE YOUR OWN SHARK. Eight corners of the animal's world box,
         projected: the share of them that land inside the frame. This is the
         complaint stated as a number — "the camera is way way zoomed in" is
         exactly "the corners of the body are off-screen". */
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
      /* The stickers, counted. sharkSkinMarks is one two-group mesh: group 0
         is the pale rake scars, group 1 the dark flank folds. Count the scar
         triangles, so "the marks are gone" is a zero and not an opinion. */
      scarTris(a) {
        const g = a && a.group; if (!g) return null;
        let n = 0, found = false;
        g.traverse(function (o) {
          if (!o.isMesh || o.name !== "sharkSkinMarks" || !o.geometry) return;
          found = true;
          const gr = o.geometry.groups || [];
          for (const q of gr) if ((q.materialIndex | 0) === 0) n += (q.count / 3) | 0;
        });
        return found ? n : 0;
      },
      shot(a) {
        return {
          boomM: D.boomM(a),
          hullM: +D.hull(a).toFixed(2),
          inFramePct: D.inFramePct(a),
          scarTris: D.scarTris(a),
        };
      },
    };

    window.__cbzVisualCompare = {
      /* Awaited by the comparator before every capture. With the page's frame
         loop dead, a canvas rendered outside an animation frame is never
         PRESENTED — the compositor keeps serving the last pre-kill frame. So
         render inside ONE real animation frame (the loop's own chain is
         already broken; lending RAF back for a single callback cannot restart
         it) and then wait out SwiftShader's compositor. */
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
      advance(sec) { D.sec(sec); },
    };
  }

  // ---- the chapters: one per subject, a one-way match timeline ------------
  const out = {};
  const CH = [
    async function bullChase() {
      if (!await D.boot()) throw new Error("no match / sim never armed");
      D.peace();
      D.offshore(24);
      D.dive(2.6);
      D.level(2.4);
      D.chaseAlong(0.28);
      Object.assign(out, D.shot(CBZ.sharkSim.shark));
    },
    async function bullBack() {
      /* THE MARKS ARE A LIGHTING PROBLEM AS MUCH AS A GEOMETRY ONE — pale
         ribbons on a dark back are invisible in forty metres of blue. This
         beat photographs the skin in the shallow, lit water where a player
         actually looks at their own shark. */
      D.peace(); D.park(12); D.level(1.0);
      const S = CBZ.sharkSim.shark;
      D.shoulder(S, 1.15, 0.6, 2.5);
      Object.assign(out, D.shot(S));
      out.boomM = null;                  // a tripod's distance is not the rig's
    },
    async function megChase() {
      if (!D.feedToTier(3)) throw new Error("never evolved to megalodon");
      D.peace();
      D.offshore(40);
      D.dive(3.0);
      D.level(3.2);
      D.chaseAlong(0.30);
      Object.assign(out, D.shot(CBZ.sharkSim.shark));
    },
    async function megShallow() {
      D.peace();
      D.shallow(14);
      D.level(2.4);
      D.chaseAlong(0.22);
      Object.assign(out, D.shot(CBZ.sharkSim.shark));
    },
    async function greatWhiteBack() {
      D.peace();
      D.park(16);
      D.level(1.0);
      const a = D.wildBeside("great_white_shark", 16, 3);
      if (!a) throw new Error("no wild great white");
      D.shoulder(a, 1.15, 0.6, 2.5);
      Object.assign(out, D.shot(a));
      out.boomM = null;
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
      scale: CBZ.sharkSim && CBZ.sharkSim.shark ? +CBZ.sharkSim.shark.group.scale.x.toFixed(3) : null,
      fitFlag: !(CBZ.CONFIG && CBZ.CONFIG.CAM_SHARK_FIT === false),
      scarFlag: !!(CBZ.CONFIG && CBZ.CONFIG.SHARK_RAKE_SCARS),
    },
    metrics: out,
  };
}

export default {
  id: "megalodon-camera",
  title: "Megalodon — The Boom That Fits, And The Stickers Off The Back",
  description: "A same-checkout flag A/B on the live shark sim. BEFORE runs the shipped code path (?cfg_CAM_SHARK_FIT=0 &cfg_SHARK_RAKE_SCARS=1): a chase boom sized off a species constant, which frames the 24 m megalodon at 14.5 m and puts the lens inside the animal, plus 8–14 pale rake scars painted on every shark's dark dorsal surface. AFTER runs this wave: the boom is solved off the animal's own measured hull and held as a stand-off at every depth, so the apex form is whole in frame; the rake scars are deleted and the dark flank folds stay. Both columns boot the same build, click the same tile, and climb the same ladder by eating real survivors.",
  beforeLabel: "BEFORE · species-constant boom + rake scars",
  afterLabel: "AFTER · hull-fitted boom + bare skin",
  pairNote: "Same checkout · same island · same seed · the game's own chase camera and HUD",
  method: "Each side boots index.html?mode=sharksim on the pinned seed and clicks the tile + PLAY exactly like a player, with the view pref pinned to the chase boom. A per-page driver advances the real match with CBZ.stepSim (the frame loop is frozen after boot so captures cannot race the renderer), climbs the ladder by baiting and eating real survivor bots, and photographs the full page, HUD and killfeed included. The two chase beats leave the framing entirely to the game's own rig and only point the player's yaw down the body's axis; the two skin beats use a tripod placed in BODY LENGTHS so a bull and a great white are photographed at the same relative distance.",
  defaultBefore: "local",
  /* cfg_BOOT_METER=0: the presented start eases its boot card on a RAF chain,
     and this preset freezes the page's frame loop after boot — one dead frame
     in that chain leaves state.js's bootBusy latched. With the meter off,
     startRunPresented falls through to the synchronous startRun and the whole
     run needs no frame loop at all. */
  beforeParams: {
    mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0",
    cfg_CAM_SHARK_FIT: "0", cfg_SHARK_RAKE_SCARS: "1",
  },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 300000,
  metrics: {
    boomM: { label: "Chase boom — eye to body", unit: "m" },
    hullM: { label: "The animal, measured", unit: "m", better: "neutral" },
    inFramePct: { label: "Corners of the body inside the frame", unit: "%", better: "higher" },
    scarTris: { label: "Pale rake-scar triangles on the back", better: "lower" },
  },
  metricsNote: "boomM has NO better/worse direction on purpose — the bull shark is the anchor the new curve is fitted to, so its boom is supposed to sit still, and a metric that scored 'bigger is better' would call the anchor holding a regression. inFramePct carries the claim instead. hullM is the control: the SAME animal is photographed on both sides, so any drift there means the two columns are not looking at the same body. boomM is null on the two skin close-ups — those use a fixed tripod in body lengths, so their distance is the preset's number, not the rig's. inFramePct is the complaint stated arithmetically: 'way way zoomed in' is 'the corners of the shark are off-screen'.",
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.cityMountAnimal && document.getElementById('playBtn')",
  subjects,
  stage: stageMegalodonCamera,
};

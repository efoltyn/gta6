/* Shark Sim, before/after — EVERY SCREEN OF THE GAME, on the live build.

   Both columns boot the SAME checkout of index.html on the disaster island
   (pinned seed). The BEFORE column opens ?mode=survival — plain Natural
   Disaster Survival, the game that was already there. The AFTER column
   opens ?mode=sharksim — the registered mode the Shark Sim tile now
   selects — and plays Shark Sim through its whole arc with the production
   engine: the real
   mount, the real automatic bite, the real killfeed, the real win and death
   cards. Nothing is posed in a studio; every capture is the actual screen a
   player sees, HUD included, driven forward with CBZ.stepSim so the
   storyboard does not depend on how fast this machine renders.

   The pairing is the point: each subject shows the SAME beat of island life
   in both games. The crowd that wandered the interior now lines the surf.
   The wader nobody threatened is now food. The hammerhead / great white /
   megalodon that swam free as wildlife are now bodies YOU wear. The pod
   that cruised blue water now hunts you. And the same two end cards —
   VICTORY and ELIMINATED — now say APEX PREDATOR and EATEN BY THE POD. */

const subjects = [
  {
    id: "match-start", ch: 0,
    label: "Match Start — The Same Island, A Different Game",
    focus: "BEFORE: you drop onto the island as one more survivor. AFTER: the match opens with you already in the water — the spawn banner, the species pill, and the island now seen from the sea.",
  },
  {
    id: "the-beach", ch: 1,
    label: "The Crowd Moves To The Water",
    focus: "Same shoreline, same camera. BEFORE: the crowd wanders the interior and the sand is empty. AFTER: the survivors live on the beach and wade in the surf — the whole island becomes the edge of the plate.",
  },
  {
    id: "first-blood", ch: 2, strip: { frames: 5, stepSec: 0.4 },
    label: "The Automatic Bite — Two Seconds, Five Frames",
    focus: "A film strip of the same two seconds. BEFORE: you stand in the surf among the waders and nothing in the water wants anyone. AFTER: the shark closes on a wader with no attack input — the mouth opens on the way in, the bite lands, the killfeed logs the meal.",
  },
  {
    id: "hammerhead", ch: 3,
    label: "The First Evolution — Great Hammerhead",
    focus: "BEFORE: a wild great hammerhead swimming the island band as huntable wildlife. AFTER: the same species is now YOUR body — the evolution banner, the pill naming the form, the progress bar aimed at the next one.",
  },
  {
    id: "great-white", ch: 4,
    label: "The Second Evolution — Great White",
    focus: "BEFORE: the wild great white cruising free. AFTER: you wear it — same split-jaw body the wildlife work built, now player-piloted, with the ladder reading eat-count to MEGALODON.",
  },
  {
    id: "pod-hunt", ch: 5,
    label: "The Threat Curve — The Pod Has Your Scent",
    focus: "BEFORE: the orca pod minds its own blue water; the player means nothing to it. AFTER: the pod converges on YOU — marine predation's one `huntable` exception — and it says so by turning and coming, not in words (the status line that used to print \"the pod has your scent\" is gone; see the shark-show-dont-tell preset).",
  },
  {
    id: "megalodon", ch: 6,
    label: "The Apex Form — Megalodon In The Surf",
    focus: "BEFORE: the island's one wild megalodon, deep water only. AFTER: you are it, riding the seabed into water shallower than its own body — dorsal out — with one objective left on the pill: eat an orca.",
  },
  {
    id: "apex-win", ch: 7,
    label: "The Win Card — Last One Standing vs Apex Predator",
    focus: "The same victory screen, re-purposed. BEFORE: survival's own win — outlast the field. AFTER: the megalodon eats an orca and the card reads APEX PREDATOR, with the kill in the feed.",
  },
  {
    id: "eaten-by-the-pod", ch: 8,
    label: "The Death — Eliminated vs Eaten",
    focus: "The same elimination flow, re-aimed. BEFORE: a disaster kills you and the spectate banner drops. AFTER: the pod finishes your shark, the rider's body comes back for the ragdoll, and the feed reads EATEN BY THE POD.",
  },
];

async function stageSharkSim(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  const after = input.side === "after";
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const NEED = [0, 14, 34, 75];              // the ladder's mass thresholds

  let D = window.__sharkBA;
  if (!D) {
    D = window.__sharkBA = {
      after: after, chapter: -1, waterline: 0,
      step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); },
      sec(s) { D.step(Math.max(1, Math.round(s * 30))); },

      async boot() {
        const wantMode = D.after ? "sharksim" : "survival";
        for (let t = 0; t < 600 && !(CBZ.game.state === "playing" && CBZ.game.mode === wantMode); t++) {
          const mb = document.querySelector('.mode-btn[data-mode="' + wantMode + '"]');
          if (mb) mb.click();
          const pb = document.getElementById("playBtn");
          if (pb) pb.click();
          await sleep(150);
        }
        if (CBZ.game.state !== "playing") return false;
        if (D.after) {
          for (let t = 0; t < 60 && !D.armed(); t++) { D.step(15); await sleep(20); }
          if (!D.armed()) return false;
          D.waterline = CBZ.sharkSim.waterline;
        } else {
          D.step(30);
          D.waterline = D.measureWaterline();
        }
        /* From here the match advances ONLY when a subject steps it. Killing
           the page's own frame loop is what lets a detached camera survive to
           the capture; the comparator's own barrier falls back to a timer,
           and its render hook (below) draws each frame explicitly. */
        D._rafOrig = window.requestAnimationFrame;
        await D.killFrames();
        return true;
      },
      /* Stub the frame loop AND drain the one already-queued loop callback
         in a frame we control. Left alone, that straggler fires at some
         arbitrary later compositor tick: it re-stamps the camera (caught
         red-handed by a position spy — updateCamera ← loop()) and presents
         its own frame over a staged capture; queued first, it even runs
         ahead of our render inside a borrowed frame. Draining it here means
         its re-arm hits the stub and the chain is dead for good. */
      async killFrames() {
        const orig = D._rafOrig || window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => orig.call(window, () => res()));
      },
      rafOff() { window.requestAnimationFrame = function () { return 0; }; },
      armed() {
        return !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
          CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark);
      },

      depth(x, z) { return CBZ.survFloodDepthMeanAt ? Math.max(0, CBZ.survFloodDepthMeanAt(x, z)) : 0; },
      measureWaterline() {
        const A = CBZ.surv.arena; let sum = 0;
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * 6.283;
          let lo = A.radius * 0.9, hi = A.radius + 44;
          for (let it = 0; it < 20; it++) {
            const mid = (lo + hi) / 2;
            if (D.depth(A.center.x + Math.cos(a) * mid, A.center.z + Math.sin(a) * mid) > 0.02) hi = mid; else lo = mid;
          }
          sum += (lo + hi) / 2;
        }
        return sum / 16;
      },
      playerAngle() {
        const A = CBZ.surv.arena, P = CBZ.player;
        return Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0;
      },
      ringPoint(ang, r) {
        const A = CBZ.surv.arena;
        return { x: A.center.x + Math.cos(ang) * r, z: A.center.z + Math.sin(ang) * r };
      },

      // the camera yaw that looks ALONG a world heading (keys.w moves (-sin,-cos)·yaw)
      camYawAlong(h) { return Math.atan2(-Math.cos(h), -Math.sin(h)); },
      playerCam(h, pitch) {
        if (CBZ.cam) { CBZ.cam.yaw = D.camYawAlong(h); CBZ.cam.pitch = pitch == null ? 0.34 : pitch; }
        D.step(2);                        // camera.js frames it on the sim tick
      },
      // a detached tripod: set AFTER the last sim step, survives because the
      // page's frame loop is dead and the comparator renders explicitly
      tripod(px, py, pz, tx, ty, tz) {
        const cam = CBZ.camera; if (!cam) return;
        cam.position.set(px, py, pz);
        cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(tx, ty, tz));
      },

      liveBots() { let n = 0; for (const b of CBZ.bots) if (!b.dead) n++; return n; },
      shorePct() {
        const A = CBZ.surv.arena; let live = 0, shore = 0;
        for (const b of CBZ.bots) {
          if (b.dead) continue; live++;
          const r = Math.hypot(b.pos.x - A.center.x, b.pos.z - A.center.z);
          if (r > A.radius && r < A.radius + 40) shore++;
        }
        return live ? Math.round((shore / live) * 100) : 0;
      },
      podNearest() {
        const P = CBZ.player; let near = null;
        for (const a of CBZ.cityWildlife || []) {
          if (a.dead || !a.species || a.species.id !== "orca") continue;
          const d = Math.hypot(a.pos.x - P.pos.x, a.pos.z - P.pos.z);
          if (near == null || d < near) near = d;
        }
        return near == null ? null : Math.round(near);
      },
      findWild(id) {
        for (const a of CBZ.cityWildlife || []) {
          if (a && !a.dead && !a.external && !a.ridden && a.species && a.species.id === id && a.grow == null) return a;
        }
        return null;
      },
      wildOrSpawn(id) {
        let a = D.findWild(id);
        if (!a && CBZ.cityWildlifeSpawnAt) {
          const p = D.ringPoint(D.playerAngle() + 1.1, D.waterline + 60);
          a = CBZ.cityWildlifeSpawnAt(id, p.x, p.z);
        }
        return a;
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
        return jp.x * (S.species.scale || 1);
      },
      bait(n, extra) {
        const S = CBZ.sharkSim.shark, h = S.heading || 0;
        const jaw = D.jawAhead();
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
        for (let round = 0; round < 6 && sim.tier < tier; round++) {
          D.peace(); D.shallow(4); D.step(12);
          sim.mass = Math.max(sim.mass, NEED[tier]);
          D.bait(2, 1.2);
          for (let s = 0; s < 120 && sim.tier < tier; s++) D.step(1);
        }
        return sim.tier >= tier && D.armed();
      },
      banner(big, small) {
        if (!CBZ.sharkSim || !CBZ.sharkSim.banner) return;
        CBZ.sharkSim.banner(big, small);
        // captures must not race the fade-in — snap the banner fully on
        const f = document.getElementById("sharkflash");
        if (f) { f.style.transition = "none"; f.style.opacity = "1"; }
      },
      clearBanner() {
        // a beat that is not ABOUT the banner must not be photobombed by the
        // previous beat's (sim time between captures is short by design)
        const f = document.getElementById("sharkflash");
        if (f) { f.style.transition = "none"; f.style.opacity = "0"; }
      },
      /* The full-body portrait: a ¾ tripod above the surface, distance and
         height scaled to the species so a bull and a megalodon both fill the
         frame instead of the chase camera sitting inside the bigger hulls.
         SURFACE THE BODY FIRST: this sea reads opaque from any height (a
         submerged hull photographs as empty water — two runs of banners over
         nothing proved it), so a deep body is lifted to just under the
         waterline for its portrait, dorsal out, exactly the frame the
         surfaced hammerhead and megalodon shots already showed works. No sim
         steps run between the lift and the capture, so nothing re-clamps it.
         The HUD is DOM — pill, banner, killfeed and bars ride every shot. */
      bodyShot(S) {
        const s = Math.max(1, (S.species && S.species.scale) || 1);
        const h = S.heading || 0, ang = h + 2.35;
        const D0 = 6.5 + 5.5 * s;
        const sy = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(S.pos.x, S.pos.z) : -0.8;
        if (sy - S.pos.y > 0.25 * s) {
          // AWASH, not "just submerged": measured on the live page, a bull
          // 0.4 m under this sea is invisible from any angle — the surface
          // haze is effectively opaque. The portrait rides the body with its
          // back out of the water, the frame the hammerhead proved.
          S.group.position.y = sy - 0.08 * s;
          S.group.updateMatrixWorld(true);
        }
        D.tripod(
          S.pos.x + Math.cos(ang) * D0 * 0.8, sy + 1.1 + 1.1 * s, S.pos.z + Math.sin(ang) * D0 * 0.8,
          S.pos.x, S.pos.y + 0.2 * s, S.pos.z);
      },
      /* The on-foot SURVIVOR verb panel is honest UI — but it belongs to the
         beat about the crowd, not to a wildlife portrait it happens to
         photobomb because the player is still standing among the waders. */
      decrowd() {
        const P = CBZ.player;
        for (const b of CBZ.bots) {
          if (b.dead) continue;
          const d = Math.hypot(b.pos.x - P.pos.x, b.pos.z - P.pos.z);
          if (d < 7) {
            b.pos.x += 16; b.pos.z += 6;
            b.pos.y = CBZ.surv.floorAt(b.pos.x, b.pos.z);
            b.target.set(b.pos.x, 0, b.pos.z);
          }
        }
        D.step(2);                       // let the panel notice its target left
      },
      async replay() {
        // with the boot meter off the restart is synchronous; RAF is lent
        // back anyway in case anything in the flow schedules a frame, and
        // killFrames() drains whatever got queued before taking it again
        if (D._rafOrig) window.requestAnimationFrame = D._rafOrig;
        const btn = document.getElementById("survAgainBtn");
        if (btn) btn.click();
        let ok = false;
        for (let t = 0; t < 240 && !ok; t++) {
          ok = CBZ.game.state === "playing" && (!D.after || D.armed());
          if (!ok) { D.step(8); await sleep(250); }
        }
        await D.killFrames();
        return ok;
      },
    };
    window.__cbzVisualCompare = {
      /* Awaited by the comparator before every capture. The wait is the
         point: under SwiftShader the compositor takes over a second to
         PRESENT a rendered canvas, and the comparator's own 180 ms fallback
         barrier captured the PREVIOUS composite — every frame carried a
         fresh DOM HUD over sometimes-stale 3D, which is exactly the class of
         bug that made three runs of tripod shots look haunted. */
      async render() {
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
        if (!CBZ.renderer) return;
        /* THE PRESENT IS THE PRODUCT. With the page's frame loop dead, a
           canvas rendered outside an animation frame is never PRESENTED —
           the compositor keeps serving the last pre-kill frame, so every
           screenshot photographed a frozen surface while the backbuffer
           (proved via toDataURL) held the correct staged image the whole
           time. Render inside ONE real animation frame — the game loop's
           own chain is already broken, so lending RAF back for a single
           callback cannot restart it — then wait out SwiftShader's
           compositor before the comparator captures. */
        const raf = D._rafOrig;
        if (raf) {
          await new Promise((res) => raf.call(window, () => {
            CBZ.renderer.render(CBZ.scene, CBZ.camera);
            res();
          }));
        } else CBZ.renderer.render(CBZ.scene, CBZ.camera);
        await new Promise((r) => setTimeout(r, 1200));
      },
      advance(sec) { D.sec(sec); },        // film strips step the real match
    };
  }

  // ---- the chapters: one per subject, a one-way match timeline -----------
  const out = {};
  const CH = D.after ? [
    async function start() {
      if (!await D.boot()) throw new Error("no match / sim never armed");
      D.peace();
      D.step(2);
      D.bodyShot(CBZ.sharkSim.shark);
      D.banner("YOU ARE THE SHARK", "eat fish and swimmers · avoid the pod · become the MEGALODON");
      out.shoreCrowdPct = D.shorePct();
    },
    async function beach() {
      D.clearBanner();
      const ang = D.playerAngle() + 0.5;
      const at = D.ringPoint(ang, D.waterline - 6);          // the sand
      const from = D.ringPoint(ang - 0.22, D.waterline + 26); // just offshore
      D.step(6);
      D.tripod(from.x, 7.5, from.z, at.x, 0.5, at.z);
      out.shoreCrowdPct = D.shorePct();
    },
    async function firstBlood() {
      D.clearBanner();
      D.peace(); D.shallow(2); D.step(8);
      const S = CBZ.sharkSim.shark;
      D.bait(1, 8.5);                                        // a wader, two seconds out
      CBZ.keys.w = true;                                     // the strip swims the approach
      if (CBZ.cam) { CBZ.cam.yaw = D.camYawAlong(S.heading || 0); CBZ.cam.pitch = 0.3; }
      D.step(1);
      out.eaten = CBZ.sharkSim.eaten;
    },
    async function hammerhead() {
      CBZ.keys.w = false;
      if (!D.feedToTier(1)) throw new Error("never evolved to hammerhead");
      D.step(4);
      D.bodyShot(CBZ.sharkSim.shark);
      D.banner("YOU ARE THE GREAT HAMMERHEAD", "Next: GREAT WHITE");
      out.eaten = CBZ.sharkSim.eaten;
    },
    async function greatWhite() {
      if (!D.feedToTier(2)) throw new Error("never evolved to great white");
      D.step(4);
      D.bodyShot(CBZ.sharkSim.shark);
      D.banner("YOU ARE THE GREAT WHITE", "Next: MEGALODON");
      out.eaten = CBZ.sharkSim.eaten;
    },
    async function podHunt() {
      D.clearBanner();
      const S = CBZ.sharkSim.shark, P = CBZ.player;
      D.shallow(24); D.step(6);
      let placed = 0;
      for (let i = 0; i < 3; i++) {
        const o = i === 0 ? (D.findWild("orca") || (CBZ.cityWildlifeSpawnAt && CBZ.cityWildlifeSpawnAt("orca", P.pos.x + 30, P.pos.z)))
                          : (CBZ.cityWildlifeSpawnAt && CBZ.cityWildlifeSpawnAt("orca", P.pos.x + 30 + i * 6, P.pos.z + (i - 1) * 10));
        if (!o) continue;
        const side = (i - 1) * 0.55;
        o.pos.x = P.pos.x + Math.cos((S.heading || 0) + Math.PI + side) * (18 + i * 4);
        o.pos.z = P.pos.z + Math.sin((S.heading || 0) + Math.PI + side) * (18 + i * 4);
        o.pos.y = P.pos.y - 0.5;
        o.hunger = 1;
        if (o._waterMove) { o._waterMove.x = o.pos.x; o._waterMove.z = o.pos.z; }
        placed++;
      }
      if (!placed) throw new Error("no orcas for the hunt");
      D.sec(1.4);                                            // they commit and close
      // the shot: over your own shark's back, the pod bearing down
      let nearest = null, nd = 1e9;
      for (const a of CBZ.cityWildlife) {
        if (a.dead || !a.species || a.species.id !== "orca") continue;
        const d = Math.hypot(a.pos.x - P.pos.x, a.pos.z - P.pos.z);
        if (d < nd) { nd = d; nearest = a; }
      }
      if (!nearest) throw new Error("the pod vanished");
      const toPod = Math.atan2(nearest.pos.z - P.pos.z, nearest.pos.x - P.pos.x);
      const sy = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(P.pos.x, P.pos.z) : -0.8;
      D.tripod(
        P.pos.x - Math.cos(toPod) * 13, Math.max(sy + 4.2, P.pos.y + 4), P.pos.z - Math.sin(toPod) * 13,
        nearest.pos.x, nearest.pos.y + 0.5, nearest.pos.z);
      out.podNearestM = D.podNearest();
    },
    async function megalodon() {
      D.peace();
      if (!D.feedToTier(3)) throw new Error("never evolved to megalodon");
      D.shallow(2); D.sec(1.2);                              // ride the bed, dorsal out
      D.bodyShot(CBZ.sharkSim.shark);
      D.banner("YOU ARE THE MEGALODON", "Now eat an orca.");
      out.eaten = CBZ.sharkSim.eaten;
    },
    async function apexWin() {
      const sim = CBZ.sharkSim, S = sim.shark;
      let won = false;
      for (let round = 0; round < 4 && !won; round++) {
        let o = D.findWild("orca") || (CBZ.cityWildlifeSpawnAt && CBZ.cityWildlifeSpawnAt("orca", S.pos.x + 40, S.pos.z));
        if (!o) break;
        const h = S.heading || 0, jaw = D.jawAhead();
        o.hp = 40;
        o.pos.x = S.pos.x + Math.cos(h) * (jaw + 1.5);
        o.pos.z = S.pos.z + Math.sin(h) * (jaw + 1.5);
        o.pos.y = S.pos.y;
        if (o._waterMove) { o._waterMove.x = o.pos.x; o._waterMove.z = o.pos.z; }
        for (let s = 0; s < 120 && !won; s++) { D.step(1); won = CBZ.game.state === "won" && sim.apex; }
      }
      if (!won) throw new Error("apex win never fired");
      out.eaten = sim.eaten;
    },
    async function eaten() {
      if (!await D.replay()) throw new Error("play-again never re-armed");
      D.clearBanner();                                       // the fresh match re-flashed the spawn banner
      const S = CBZ.sharkSim.shark;
      S.hp = 0; S.dead = true;
      D.sec(2.6);                                            // deathcam beat, then ELIMINATED lands
      D.clearBanner();
    },
  ] : [
    async function start() {
      if (!await D.boot()) throw new Error("no survival match");
      D.sec(1);
      const A = CBZ.surv.arena, P = CBZ.player;
      const h = Math.atan2(A.center.z - P.pos.z, A.center.x - P.pos.x);
      if (CBZ.cam) { CBZ.cam.yaw = D.camYawAlong(h); CBZ.cam.pitch = 0.3; }
      D.step(2);
      out.shoreCrowdPct = D.shorePct();
    },
    async function beach() {
      const ang = D.playerAngle() + 0.5;
      const at = D.ringPoint(ang, D.waterline - 6);
      const from = D.ringPoint(ang - 0.22, D.waterline + 26);
      D.step(6);
      D.tripod(from.x, 7.5, from.z, at.x, 0.5, at.z);
      out.shoreCrowdPct = D.shorePct();
    },
    async function firstBlood() {
      // you, standing IN the crowd, in the same surf — and nothing hunts
      // anyone. ONE angle for player, waders and camera: recomputing
      // playerAngle after the teleport drifted the crowd out of frame.
      const P = CBZ.player, ang = D.playerAngle() + 0.5;
      const p = D.ringPoint(ang, D.waterline + 1.5);
      P.pos.x = p.x; P.pos.z = p.z;
      P.pos.y = CBZ.surv.floorAt(p.x, p.z);
      let placed = 0;
      for (const b of CBZ.bots) {
        if (b.dead || placed >= 3) continue;
        const bp = D.ringPoint(ang + (placed - 1) * 0.02, D.waterline + 0.5 + placed * 1.4);
        b.pos.x = bp.x; b.pos.z = bp.z; b.pos.y = CBZ.surv.floorAt(bp.x, bp.z);
        b.target.set(bp.x, 0, bp.z); b.pause = 40;
        placed++;
      }
      if (CBZ.cam) { CBZ.cam.yaw = D.camYawAlong(ang); CBZ.cam.pitch = 0.24; }
      D.step(2);
    },
    async function hammerhead() { D.wildShot("hammerhead_shark"); },
    async function greatWhite() { D.wildShot("great_white_shark"); },
    async function podHunt() {
      D.decrowd();
      const o = D.wildOrSpawn("orca");
      if (!o) throw new Error("no orca to photograph");
      D.sec(1);
      D.bodyShot(o);
      out.podNearestM = D.podNearest();
    },
    async function megalodon() { D.wildShot("megalodon"); },
    async function apexWin() {
      for (const b of CBZ.bots) if (!b.dead) CBZ.surv.killBot(b, null, "swept out to sea");
      for (let s = 0; s < 90 && CBZ.game.state !== "won"; s++) D.step(1);
      if (CBZ.game.state !== "won") throw new Error("survival win never fired");
    },
    async function eaten() {
      if (!await D.replay()) throw new Error("play-again never restarted");
      D.sec(1);
      CBZ.surv.hurt(CBZ.surv.playerActor, 1e6, { cause: "struck by lightning" });
      D.sec(2.6);
    },
  ];
  // the wild-body portrait shared by the before column's species chapters —
  // the same adaptive tripod the after column uses, so the pairing is the
  // species itself, not two different camera grammars
  D.wildShot = D.wildShot || function (id) {
    D.decrowd();
    const a = D.wildOrSpawn(id);
    if (!a) throw new Error("no wild " + id);
    D.sec(1.2);
    D.bodyShot(a);
  };

  while (D.chapter < sub.ch) {
    D.chapter++;
    await CH[D.chapter]();
  }

  window.__cbzVisualCompare.render();
  return {
    ok: true, side: input.side, chapter: sub.ch,
    debug: {
      state: CBZ.game.state,
      tier: CBZ.sharkSim ? CBZ.sharkSim.tier : null,
      mass: CBZ.sharkSim ? CBZ.sharkSim.mass : null,
      aliveBots: D.liveBots(),
      waterline: Number(D.waterline.toFixed(1)),
    },
    metrics: out,
  };
}

export default {
  id: "shark-sim",
  title: "Shark Sim — The Island Before, The Food Chain After",
  description: "Nine beats of the disaster island, photographed in both of its games. BEFORE (?mode=survival): plain Natural Disaster Survival — the crowd inland, the sharks as wildlife, the standard win and death cards. AFTER (?mode=sharksim, the Shark Sim tile): Shark Sim — you ARE the shark; the crowd lines the surf, the automatic bite feeds, the ladder climbs bull → hammerhead → great white → MEGALODON, the pod hunts you, and the same two end cards read APEX PREDATOR and EATEN BY THE POD. Every capture is the live game's own screen, HUD and killfeed included, advanced with CBZ.stepSim.",
  beforeLabel: "BEFORE · ?mode=survival (Natural Disaster Survival)",
  afterLabel: "AFTER · ?mode=sharksim (SHARK SIM)",
  pairNote: "Same checkout · same island · same seed · the game's own camera and HUD",
  method: "Each side boots index.html into its own mode (?mode=survival / ?mode=sharksim) with a pinned seed and clicks its tile + PLAY exactly like a player. A per-page driver advances the real match with CBZ.stepSim (the page's own frame loop is frozen after boot so captures cannot race the renderer), stages each beat with engine APIs only — no studio scenes — and photographs the full page, HUD, banners, killfeed and end cards included. The film-strip subject steps the identical simulated seconds on both sides.",
  defaultBefore: "local",
  /* cfg_BOOT_METER=0: the presented start eases its boot card on a RAF chain,
     and this preset freezes the page's frame loop after boot — one dead frame
     in that chain leaves state.js's bootBusy latched and every Play Again a
     silent no-op (the death beat could never restage). With the meter off,
     startRunPresented falls through to the synchronous startRun and the whole
     run needs no frame loop at all. */
  beforeParams: { mode: "survival", shark: "0", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "survival", shark: "1", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 300000,
  metrics: {
    shoreCrowdPct: { label: "Live crowd on the beach/surf band", unit: "%", better: "higher" },
    eaten: { label: "Things eaten so far", better: "higher" },
    podNearestM: { label: "Nearest orca to the player", unit: "m", better: "lower" },
  },
  metricsNote: "BEFORE is plain survival, so its columns read as the island's resting state: the crowd mostly inland, nothing eaten, the pod far away and indifferent.",
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.cityWildlifeStock && CBZ.spawnSurvivorBotAt && CBZ.cityMountAnimal && document.getElementById('playBtn')",
  subjects,
  stage: stageSharkSim,
};

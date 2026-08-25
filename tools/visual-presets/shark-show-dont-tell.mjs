/* SHOW, DON'T TELL + THE BITE THAT COSTS SOMETHING — a flag A/B on ONE build.

   Both columns are THIS checkout, the same seed, the same island, the same
   staged situation, driven by the same code path. The ONLY difference between
   them is three query flags:

     ?cfg_SHARK_SHOW_DONT_TELL=0   modes/shark_sim.js keeps its mid-play text
                                   (the scent line, the hint, the evolution
                                   banner, the mount toast) and stages none of
                                   the physical beats that replaced them
     ?cfg_BITE_CINEMATIC=0         city/wildlife_tame.js's above-weight kill
                                   ends on the ordinary chomp instead of the
                                   clamp / death-roll / tear / release finish
     ?cfg_CREATURE_BITE_CHUNK=0    systems/wounds.js stops taking material off
                                   a bitten body, so a pod bite leaves nothing

   That is the tool's designed A/B for a behaviour change (--before local), and
   it is the only honest way to photograph this one: the claim is not "a new
   scene looks nicer", it is "the same second of the same match reads
   completely differently".

   THE OWNER'S TWO COMPLAINTS, one subject each:
     1  "I HATE WORDS POPPING UP ON THE SCREEN. Like 'the pod has your
         scent' — it's dumb slop. SHOW don't tell."
     2  "Biting is too fast and doesn't look cool enough — especially when a
         shark kills an orca bigger than it."
*/

const subjects = [
  {
    id: "scent", ch: 0, strip: { frames: 4, stepSec: 0.5 },
    label: "The Pod Locks On — A Sentence vs Three Fins",
    focus: "The exact moment the old build printed \"the pod has your scent\" in amber. BEFORE: the words appear in the HUD pill and nothing in the water changes. AFTER: no words at all — the orcas rise until their backs and dorsals are out, they leave converging wake, and the commit itself is a hit of white water and a camera shake. Same 55 m threshold, same three animals, same second.",
    state: "POD LOCK · 55 m", metric: "Words on screen · how far off you the fins are pointed",
  },
  {
    id: "evolve", ch: 1, strip: { frames: 4, stepSec: 0.25 },
    label: "Evolution — A Banner vs A Body That Grows",
    focus: "The frame the ladder climbs a rung. BEFORE: the old body is swapped for a bigger one between two frames and a banner announces it in words. AFTER: no banner — the new body starts at the old one's size and visibly SWELLS into its own over three quarters of a second, with a splash ring, a shake and a beat of slow motion.",
    state: "RUNG CLIMBED", metric: "Banner text on screen · body scale mid-beat",
  },
  {
    id: "bitten", ch: 2,
    label: "Bitten — A Health Bar vs A Missing Piece",
    focus: "After the pod has landed its flank bites on YOUR great white. BEFORE: the body is untouched; the only evidence a bite ever landed is a number in the health bar. AFTER: material is gone from the part the jaws closed on, the cut is capped with raw torn tissue, and the wound trails chum for the rest of the match. It is persistent — this is the state the shark carries from here on.",
    state: "AFTER THE PASS", metric: "Chunks taken · rig shrink · live chum sources",
  },
  {
    id: "bigkill", ch: 3, strip: { frames: 5, stepSec: 0.55 },
    label: "Killing Something Bigger Than You — Two And A Half Seconds",
    focus: "A great white takes an orca longer than itself. BEFORE: the same ~0.9 s chomp a mackerel gets; the carcass simply stops being a problem and the frame after is ordinary swimming. AFTER: the jaws clamp, the shark loses all way, and it goes into a death roll — spinning about its own long axis with the carcass locked in its teeth, tearing material off it on every half turn and putting blood in the water each time — before the jaws part and the body is let go to drift.",
    state: "ABOVE-WEIGHT KILL", metric: "Body roll · seconds of finish · pieces torn off",
  },
];

async function stageShowDontTell(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let D = window.__sharkSDT;
  if (!D) {
    D = window.__sharkSDT = {
      chapter: -1, waterline: 0, _rafOrig: null,
      step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); },
      sec(s) { D.step(Math.max(1, Math.round(s * 30))); },
      armed() {
        return !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
          CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark);
      },
      /* Freeze the page's own frame loop AND drain the straggler callback in a
         frame we control (shark-sim.mjs learned this the hard way: the queued
         loop re-stamps the camera and presents its own frame over a staged
         capture). Everything after this advances only when a chapter says so. */
      async killFrames() {
        const orig = D._rafOrig || window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => orig.call(window, () => res()));
      },
      async boot() {
        for (let t = 0; t < 600 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
          const mb = document.querySelector('.mode-btn[data-mode="sharksim"]');
          if (mb) mb.click();
          const pb = document.getElementById("playBtn");
          if (pb) pb.click();
          await sleep(150);
        }
        if (CBZ.game.state !== "playing") return false;
        for (let t = 0; t < 60 && !D.armed(); t++) { D.step(15); await sleep(20); }
        if (!D.armed()) return false;
        D.waterline = CBZ.sharkSim.waterline;
        D._rafOrig = window.requestAnimationFrame;
        await D.killFrames();
        return true;
      },
      // deterministic staging: no capture may depend on a lucky draw
      seed() {
        let s = 1337;
        Math.random = function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      },
      ringPoint(ang, r) {
        const A = CBZ.surv.arena;
        return { x: A.center.x + Math.cos(ang) * r, z: A.center.z + Math.sin(ang) * r };
      },
      playerAngle() {
        const A = CBZ.surv.arena, P = CBZ.player;
        return Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0;
      },
      tripod(px, py, pz, tx, ty, tz) {
        const cam = CBZ.camera; if (!cam) return;
        cam.position.set(px, py, pz);
        cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(tx, ty, tz));
      },
      // put the shark in honest open water, well off the sand
      offshore(extra) {
        const S = CBZ.sharkSim.shark, P = CBZ.player;
        const p = D.ringPoint(D.playerAngle(), D.waterline + (extra == null ? 40 : extra));
        S.pos.x = p.x; S.pos.z = p.z;
        if (S._waterMove) { S._waterMove.x = p.x; S._waterMove.z = p.z; }
        P.pos.x = p.x; P.pos.z = p.z;
        D.step(3);
      },
      pod() {
        const out = [];
        for (const a of CBZ.cityWildlife || []) {
          if (a && !a.dead && a.species && a.species.id === "orca") out.push(a);
        }
        return out;
      },
      podNearest() {
        const P = CBZ.player; let near = null;
        for (const a of D.pod()) {
          const d = Math.hypot(a.pos.x - P.pos.x, a.pos.z - P.pos.z);
          if (near == null || d < near) near = d;
        }
        return near == null ? null : Math.round(near);
      },
      /* HOW DEEP THE POD IS RIDING, and the first version of this metric was
         wrong in an instructive way: it read `group.y + swimDepth - seaY`,
         but swimDepth is the DRAFT the surface show halves — so the number
         fell on the side where the animals had actually risen. The honest
         read is the body origin against the water: smaller = more of it out. */
      depthOf(a) {
        const y = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(a.pos.x, a.pos.z) : -0.8;
        return y - a.group.position.y;
      },
      podDepth() {
        const l = D.pod(); if (!l.length) return 0;
        let s = 0; for (const a of l) s += D.depthOf(a);
        return +(s / l.length).toFixed(2);
      },
      /* ARE THE FINS POINTED AT YOU. Mean angle between each orca's own
         heading and the bearing to the player, in degrees. This is the
         convergence the deleted sentence was claiming: low = three fins
         coming at you, high = three animals on their own errands. */
      podFacingDeg() {
        const l = D.pod(), P = CBZ.player;
        if (!l.length) return 0;
        let s = 0;
        for (const a of l) {
          const want = Math.atan2(P.pos.z - a.pos.z, P.pos.x - a.pos.x);
          let d = (a.heading == null ? 0 : a.heading) - want;
          while (d > Math.PI) d -= 6.283185307;
          while (d < -Math.PI) d += 6.283185307;
          s += Math.abs(d);
        }
        return +((s / l.length) * 57.2958).toFixed(1);
      },
      // stand N orcas up around the shark at radius r, all pointed at it
      placePod(n, r, aimAt) {
        const S = CBZ.sharkSim.shark, base = (S.heading || 0) + Math.PI;
        const have = D.pod();
        let placed = 0;
        for (let i = 0; i < n; i++) {
          let o = have[i];
          if (!o && CBZ.cityWildlifeSpawnAt) o = CBZ.cityWildlifeSpawnAt("orca", S.pos.x + 40, S.pos.z + i * 8);
          if (!o) continue;
          const th = base + (i - (n - 1) / 2) * 0.62;
          o.pos.x = S.pos.x + Math.cos(th) * r;
          o.pos.z = S.pos.z + Math.sin(th) * r;
          o.pos.y = S.pos.y;
          /* AIMED ACROSS YOU, NOT AT YOU. Pre-pointing the pod at the shark
             would stage the very thing the after side is supposed to do, and
             the first version of this did exactly that — both columns read
             ~4 degrees off and the comparison proved nothing. Start them on a
             tangent, milling, and let each build decide whether they turn. */
          o.heading = Math.atan2(S.pos.z - o.pos.z, S.pos.x - o.pos.x) + (aimAt ? 0 : Math.PI * 0.5);
          o.faceH = o.heading; o.hunger = 1;
          if (o._waterMove) { o._waterMove.x = o.pos.x; o._waterMove.z = o.pos.z; o._waterMove.heading = o.heading; }
          placed++;
        }
        return placed;
      },
      peace() {
        for (const a of CBZ.cityWildlife || []) {
          if (a.dead || !a.species || a === CBZ.sharkSim.shark) continue;
          if (a.species.id === "orca" || (a.species.aquatic && (a.species.bite || 0) >= 24)) {
            a.pos.x += 600; a.hunger = 0;
            if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
          }
        }
        const S = CBZ.sharkSim.shark;
        if (S) S.hp = S.maxHp;
        CBZ.sharkSim.podT = 200;
      },
      jawAhead(S) {
        const jp = (CBZ.creatureJawPoint && CBZ.creatureJawPoint(S)) || { x: 2.1 };
        return jp.x * (S.species.scale || 1);
      },
      bait(n, extra) {
        const S = CBZ.sharkSim.shark, h = S.heading || 0, jaw = D.jawAhead(S);
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
      shallow(extra) {
        const P = CBZ.player, S = CBZ.sharkSim.shark;
        const p = D.ringPoint(D.playerAngle(), D.waterline + 6 + (extra || 0));
        P.pos.x = p.x; P.pos.z = p.z;
        S.pos.x = p.x; S.pos.z = p.z;
        if (S._waterMove) { S._waterMove.x = p.x; S._waterMove.z = p.z; }
      },
      /* Climb to a rung by PLAYING: bait, let the automatic bite feed, repeat.
         The last rung is deliberately reached by a real evolve() so the growth
         beat under test is the production one, not a poked variable. */
      feedToTier(tier) {
        const NEED = [0, 14, 34, 75], sim = CBZ.sharkSim;
        for (let round = 0; round < 8 && sim.tier < tier; round++) {
          D.peace(); D.shallow(4); D.step(12);
          sim.mass = Math.max(sim.mass, NEED[sim.tier + 1] - 1);
          D.bait(2, 1.2);
          for (let s = 0; s < 120 && sim.tier < tier; s++) D.step(1);
        }
        return sim.tier >= tier && D.armed();
      },
      // the chase-cam yaw that looks ALONG a world heading
      camYawAlong(h) { return Math.atan2(-Math.cos(h), -Math.sin(h)); },
      hudText() {
        const h = document.getElementById("sharkhud");
        return h ? h.innerText.replace(/\s+/g, " ").trim() : "";
      },
      /* The match-start title card is a TITLE CARD — it is allowed, it fades
         on its own 2.8 s timer, and it is not what any of these beats are
         about. The staging compresses match time, so drop it explicitly on
         BOTH sides rather than let it photobomb the first subject on one. */
      clearBanner() {
        const f = document.getElementById("sharkflash");
        if (f) { f.style.transition = "none"; f.style.opacity = "0"; }
      },
      flashText() {
        const f = document.getElementById("sharkflash");
        if (!f || f.style.opacity === "0") return "";
        return f.innerText.replace(/\s+/g, " ").trim();
      },
      noteText() {
        // the city toast lane the mount announces itself through
        const n = document.getElementById("cityNote") || document.querySelector(".citynote, #note");
        return n && n.offsetParent !== null ? n.innerText.replace(/\s+/g, " ").trim() : "";
      },
      // every word this mode is putting on screen mid-play, right now
      words() {
        return (D.hudText() + " " + D.flashText() + " " + D.noteText()).replace(/\s+/g, " ").trim();
      },
      chunkAudit() {
        return (CBZ.creatureBiteChunkAudit && CBZ.creatureBiteChunkAudit()) || { actors: 0, chunks: 0, deepest: 0 };
      },
      mountAudit() { return (CBZ.aquaticMountAudit && CBZ.aquaticMountAudit()) || {}; },
      /* THE FINISH IS MOTION, so its numbers cannot be a single sample. Every
         sim step of the kill chapter — including the ones the film strip
         itself takes through advance() — folds its peak in here. */
      peak: { finishS: 0, roll: 0, chunks: 0, clamps: 0 },
      notePeak() {
        const S = CBZ.sharkSim && CBZ.sharkSim.shark;
        const au = D.mountAudit();
        if (au.clampT > D.peak.finishS) D.peak.finishS = au.clampT;
        if ((au.clamps | 0) > D.peak.clamps) D.peak.clamps = au.clamps | 0;
        if (S && S.group) {
          const r = Math.abs(S.group.rotation.x || 0);
          if (r > D.peak.roll) D.peak.roll = r;
        }
        const c = D.chunkAudit().chunks - (D._chunkBase || 0);
        if (c > D.peak.chunks) D.peak.chunks = c;
      },
    };

    window.__cbzVisualCompare = {
      /* The comparator awaits this before every capture. With the page's frame
         loop dead a canvas rendered outside an animation frame is never
         PRESENTED, so render inside ONE borrowed frame and then wait out
         SwiftShader's compositor. Straight from shark-sim.mjs, for the same
         reason it exists there. */
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
      /* Merged by the runner AFTER the film strip, so a motion claim can be
         measured over the exact photographed frames instead of frame 0 —
         which is where the kill chapter's roll and tear counts have to come
         from, the roll not having started yet on the frame the jaws close. */
      metrics() {
        // the evolution beat: what the body did between the captured frame and
        // its settled size, which is the swell — and is exactly zero when the
        // body was simply swapped for a bigger one between two frames
        if (D._swell > 0) {
          const S = CBZ.sharkSim && CBZ.sharkSim.shark;
          const now = S && S.group ? S.group.scale.x : 0;
          return { bodyScaleSettled: +now.toFixed(3),
            bodySwellPct: now > 0 ? Math.round(Math.abs(now - D._swell) / now * 100) : 0 };
        }
        if (!D._filming) return null;
        D.notePeak();
        return {
          finishSeconds: +D.peak.finishS.toFixed(2),
          bodyRollRad: +D.peak.roll.toFixed(2),
          piecesTornOff: D.peak.chunks,
          finishesRun: D.peak.clamps,
        };
      },
      advance(sec) {
        // step in small slices so a 0.55 s strip frame cannot skip the peak
        const n = Math.max(1, Math.round(sec * 30));
        for (let i = 0; i < n; i++) { CBZ.stepSim(1 / 30); if (D._filming) D.notePeak(); }
      },
    };
  }

  const out = {};
  const CH = [
    /* 0 — THE SCENT MOMENT. Three orcas cross the 55 m ring, which is the
       exact event that used to print the sentence. Nothing here reads a flag:
       both columns stage the identical closing pod and photograph it. */
    async function scent() {
      if (!await D.boot()) throw new Error("no match / sim never armed");
      D.seed();
      D.offshore(46);
      const S = CBZ.sharkSim.shark;
      CBZ.sharkSim._podClose = false;
      if (!D.placePod(3, 72)) throw new Error("no pod to stage");
      D.sec(0.6);
      D.placePod(3, 48);                 // ..and they cross the ring
      D.sec(1.6);
      D.clearBanner();                   // the title card is not this beat
      out.wordsOnScreen = D.words().length;
      out.podDepthM = D.podDepth();
      out.podFacingDeg = D.podFacingDeg();
      out.podNearestM = D.podNearest();
      out.podShows = CBZ.sharkSim.podShows | 0;
      // over your own back, looking at what is coming
      const near = D.pod().sort(function (a, b) {
        return Math.hypot(a.pos.x - S.pos.x, a.pos.z - S.pos.z) - Math.hypot(b.pos.x - S.pos.x, b.pos.z - S.pos.z);
      })[0];
      const toPod = Math.atan2(near.pos.z - S.pos.z, near.pos.x - S.pos.x);
      const sy = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(S.pos.x, S.pos.z) : -0.8;
      D.tripod(S.pos.x - Math.cos(toPod) * 17, sy + 3.4, S.pos.z - Math.sin(toPod) * 17,
        near.pos.x, sy + 0.2, near.pos.z);
    },

    /* 1 — THE RUNG. Climb to a great white by eating, so the last evolve()
       is the production one, and photograph the beat that follows it. */
    async function evolve() {
      D.peace();
      if (!D.feedToTier(1)) throw new Error("never reached hammerhead");
      D.peace(); D.offshore(34); D.sec(0.4);
      const sim = CBZ.sharkSim;
      /* One rung short, then feed a REAL meal so the production evolve() —
         and therefore the beat under test — fires right here. Retried,
         because a single bait-and-wait is a coin flip on whether the mouth
         happens to line up, and it lost that flip once on the before side. */
      let grew = false;
      for (let round = 0; round < 8 && !grew; round++) {
        D.peace(); D.shallow(4); D.step(12);
        sim.mass = 33;
        D.bait(2, 1.2);
        for (let s = 0; s < 150 && !grew; s++) { D.step(1); grew = sim.tier >= 2; }
      }
      if (!grew) throw new Error("never evolved to great white");
      const S = sim.shark;
      out.wordsOnScreen = D.words().length;   // measured BEFORE any clear: the
      out.bodyScaleNow = +(S.group.scale.x).toFixed(3);
      D._swell = S.group.scale.x;      // read again by metrics(), after the strip
      out.evolveBeats = sim.evolveBeats | 0;
      const s2 = Math.max(1, (S.species && S.species.scale) || 1);
      const h = S.heading || 0, ang = h + 2.35;
      const sy = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(S.pos.x, S.pos.z) : -0.8;
      if (sy - S.pos.y > 0.25 * s2) { S.group.position.y = sy - 0.08 * s2; S.group.updateMatrixWorld(true); }
      const R = 6.5 + 5.5 * s2;
      D.tripod(S.pos.x + Math.cos(ang) * R * 0.8, sy + 1.1 + 1.1 * s2, S.pos.z + Math.sin(ang) * R * 0.8,
        S.pos.x, S.pos.y + 0.2 * s2, S.pos.z);
    },

    /* 2 — BITTEN. Real pod, real flank passes, real damage. The loop is
       driven by the shark's HEALTH, which both columns lose the same way —
       never by the chunk count, which only one column can produce. */
    async function bitten() {
      /* WHY THIS BEAT COMES AFTER THE RUNG, and it is not staging taste.
         marine_predation's flank BITE pass — the thing that tears a piece off
         you — belongs to the MOB row of its predation graph: the pod-only
         relation that exists because a pod cannot simply eat what it is
         hunting. Against a BULL shark an orca is not in that row at all, it
         is straight predation, and this chapter measured what that looks
         like: zero passes, zero damage, two runs running. Against a GREAT
         WHITE the row applies and the pass is the pod's actual behaviour.
         So the beat is staged on the body the mechanic is about. */
      D._swell = 0;                    // the growth beat's metrics hook is done
      const S = CBZ.sharkSim.shark;
      D.peace(); D.offshore(46); S.hp = S.maxHp; D.sec(0.4);
      out.podRelation = 0;
      for (let round = 0; round < 22 && (S.maxHp - S.hp) < S.maxHp * 0.25; round++) {
        D.placePod(3, 14 + (round % 3) * 4, true);
        for (const o of D.pod()) {
          o.hunger = 1;
          if (CBZ.marinePodJoin) out.podRelation = CBZ.marinePodJoin(o, S) || out.podRelation;
        }
        D.sec(1.2);
        if (S.dead) break;
      }
      out.hpLostPct = Math.round(100 * (S.maxHp - S.hp) / (S.maxHp || 1));
      out.podRams = (CBZ.marineAudit && CBZ.marineAudit().rams) || 0;
      const au = D.chunkAudit();
      out.chunksTaken = au.chunks;
      out.chunkDepth = au.deepest;
      out.chumSources = (CBZ.goreChumList && CBZ.goreChumList().length) || 0;
      out.wordsOnScreen = D.words().length;
      // the pod goes away so the portrait is of the DAMAGE, not of the fight
      D.peace(); S.hp = S.maxHp; D.sec(0.4);
      // three-quarter rear tripod: the tail and flank the jaws closed on
      const s = Math.max(1, (S.species && S.species.scale) || 1);
      const h = S.heading || 0, ang = h + Math.PI * 0.78;
      const sy = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(S.pos.x, S.pos.z) : -0.8;
      if (sy - S.pos.y > 0.25 * s) { S.group.position.y = sy - 0.08 * s; S.group.updateMatrixWorld(true); }
      const R = 5.0 + 4.2 * s;
      D.tripod(S.pos.x + Math.cos(ang) * R, sy + 1.0 + 0.9 * s, S.pos.z + Math.sin(ang) * R,
        S.pos.x - Math.cos(h) * 1.2 * s, S.pos.y + 0.15 * s, S.pos.z - Math.sin(h) * 1.2 * s);
    },

    /* 3 — THE ABOVE-WEIGHT KILL. A GREAT WHITE, not the megalodon: an orca is
       measurably longer than a great white, which is the owner's exact case
       ("a shark kills an orca bigger than it") — and it is not the apex win,
       so no victory card can cover the finish on either side. */
    async function bigkill() {
      const sim = CBZ.sharkSim, S = sim.shark;
      D.peace(); D.offshore(52); S.hp = S.maxHp; D.sec(0.5);
      const h = S.heading || 0, jaw = D.jawAhead(S);
      let o = null;
      for (const a of CBZ.cityWildlife || []) if (!a.dead && a.species && a.species.id === "orca") { o = a; break; }
      if (!o && CBZ.cityWildlifeSpawnAt) o = CBZ.cityWildlifeSpawnAt("orca", S.pos.x + Math.cos(h) * (jaw + 4), S.pos.z + Math.sin(h) * (jaw + 4));
      if (!o) throw new Error("no orca to kill");
      o.pos.x = S.pos.x + Math.cos(h) * (jaw + 1.6);
      o.pos.z = S.pos.z + Math.sin(h) * (jaw + 1.6);
      o.pos.y = S.pos.y;
      o.heading = h + Math.PI * 0.5; o.faceH = o.heading;
      if (o._waterMove) { o._waterMove.x = o.pos.x; o._waterMove.z = o.pos.z; o._waterMove.heading = o.heading; }
      o.hp = Math.max(1, Math.round((o.maxHp || 600) * 0.015));   // one bite from done
      out.sharkLenM = +((CBZ.marineBodyLen && CBZ.marineBodyLen(S)) || 0).toFixed(1);
      out.orcaLenM = +((CBZ.marineBodyLen && CBZ.marineBodyLen(o)) || 0).toFixed(1);
      // the shot: a low three-quarter tripod on the mouth, held for the strip
      const sy = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(S.pos.x, S.pos.z) : -0.8;
      /* STAND BACK. At 15 m and eye level the tripod sat INSIDE the blood
         cloud and both columns photographed a red lens instead of a kill —
         the aquatic gore bloom is a screen-filling volume at close range.
         26 m and 9 m up frames the whole roll and keeps the cloud a cloud. */
      const ang = h + 2.1, R = 26;
      D.tripod(S.pos.x + Math.cos(ang) * R, sy + 9.0, S.pos.z + Math.sin(ang) * R,
        S.pos.x + Math.cos(h) * jaw * 0.5, S.pos.y + 0.2, S.pos.z + Math.sin(h) * jaw * 0.5);
      // fire the bite; stop the moment the kill lands so the film strip's own
      // stepping (advance -> notePeak) films whatever the build does NEXT
      // the running total already carries YOUR wounds from the bite beat;
      // this chapter's claim is about the carcass, so start from that baseline
      D._chunkBase = D.chunkAudit().chunks;
      D.peak = { finishS: 0, roll: 0, chunks: 0, clamps: 0 };
      D._filming = true;
      for (let s = 0; s < 90 && !o.dead; s++) { D.step(1); D.notePeak(); }
      D.notePeak();
      out.orcaDead = !!o.dead;
      out.mountedBites = D.mountAudit().hits | 0;
    },
  ];

  while (D.chapter < sub.ch) {
    D.chapter++;
    await CH[D.chapter]();
  }
  // A STRIP THAT FILMS MOTION CANNOT REPORT FRAME 0. The kill chapter's
  // numbers are peaks folded in across every step, the strip's included.
  if (sub.ch === 3) {
    D.notePeak();
    out.finishSeconds = +D.peak.finishS.toFixed(2);
    out.bodyRollRad = +D.peak.roll.toFixed(2);
    out.piecesTornOff = D.peak.chunks;
    out.finishesRun = D.peak.clamps;
  }

  window.__cbzVisualCompare.render();
  return {
    ok: true, side: input.side, chapter: sub.ch,
    debug: {
      state: CBZ.game.state,
      species: CBZ.sharkSim && CBZ.sharkSim.shark ? CBZ.sharkSim.shark.species.id : null,
      tier: CBZ.sharkSim ? CBZ.sharkSim.tier : null,
      words: D.words().slice(0, 140),
      showDontTell: CBZ.CONFIG.SHARK_SHOW_DONT_TELL !== false,
      biteCinematic: CBZ.CONFIG.BITE_CINEMATIC !== false,
      biteChunk: CBZ.CONFIG.CREATURE_BITE_CHUNK !== false,
    },
    metrics: out,
  };
}

export default {
  id: "shark-show-dont-tell",
  title: "Shark Sim — Show, Don't Tell (and a kill that earns its screen time)",
  description: "Four beats of one Shark Sim match, photographed twice on the SAME checkout with only three config flags between the columns. BEFORE keeps the mid-play text (the scent line, the hint, the evolution banner, the mount toast) and the instant end-of-bite. AFTER deletes every one of those sentences and stages the thing each of them was describing instead: the pod rises and converges with wake and a shake, the body visibly swells when it evolves, an orca's bite takes material off your shark and leaves it bleeding for the rest of the match, and an above-weight kill becomes a clamp and a death roll instead of a chomp.",
  beforeLabel: "BEFORE · ?cfg_SHARK_SHOW_DONT_TELL=0&cfg_BITE_CINEMATIC=0&cfg_CREATURE_BITE_CHUNK=0",
  afterLabel: "AFTER · flags default-on (shipped)",
  pairNote: "Same checkout · same seed · same island · same staging code · only the flags differ",
  method: "Both columns serve THIS checkout (--before local) and boot index.html?mode=sharksim with a pinned seed, click the tile and PLAY like a player, then freeze the page's frame loop and advance the real match with CBZ.stepSim. One staging path runs on both sides — it never reads a flag — so any difference in the pictures is the flags and nothing else. The pod is stood up with real orcas at real bearings, the ladder is climbed by actually eating, and the kill is a production mounted bite on a live orca. Film strips step the identical simulated seconds on both sides.",
  defaultBefore: "local",
  /* cfg_BOOT_METER=0: the presented start eases its boot card on a RAF chain
     and this preset freezes the frame loop after boot, which would latch
     state.js's bootBusy forever (shark-sim.mjs pays the same toll). */
  beforeParams: {
    mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0",
    cfg_SHARK_SHOW_DONT_TELL: "0", cfg_BITE_CINEMATIC: "0", cfg_CREATURE_BITE_CHUNK: "0",
  },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 360000,
  metricsWhitelist: true,
  metrics: {
    wordsOnScreen: { label: "Characters of mid-play text on screen", unit: "chars", better: "lower" },
    podDepthM: { label: "Mean pod body depth under the surface", unit: "m", better: "lower" },
    podFacingDeg: { label: "How far off you the pod is pointed", unit: "deg", better: "lower" },
    podNearestM: { label: "Nearest orca", unit: "m", better: "lower" },
    hpLostPct: { label: "Health the pod actually took", unit: "%", better: "higher" },
    podRams: { label: "Flank bites landed on you", better: "higher" },
    podRelation: { label: "Predation-graph row the pod is in (2 = pod-only)", better: "higher" },
    chunksTaken: { label: "Pieces bitten out of your body", better: "higher" },
    chunkDepth: { label: "Deepest single wound (fraction of the part gone)", better: "higher" },
    chumSources: { label: "Wounds still bleeding into the sea", better: "higher" },
    bodyScaleNow: { label: "Body scale at the captured instant", better: "lower" },
    bodyScaleSettled: { label: "Body scale once the beat has settled", better: "higher" },
    bodySwellPct: { label: "How much the body grew across the strip", unit: "%", better: "higher" },
    finishSeconds: { label: "Finish still running after the kill", unit: "s", better: "higher" },
    bodyRollRad: { label: "Peak body roll during the finish", unit: "rad", better: "higher" },
    piecesTornOff: { label: "Pieces torn off the carcass", better: "higher" },
    finishesRun: { label: "Above-weight finishes staged", better: "higher" },
    mountedBites: { label: "Mounted bites landed", better: "higher" },
  },
  metricsNote: "wordsOnScreen is the owner's actual complaint as a number: every character of HUD text, banner and toast standing over live play at the captured instant. bodySwellPct is the growth beat caught in flight: the body at the captured frame against the same body once the strip has run it out. A body that was swapped for a bigger one between two frames has nothing to grow into, so BEFORE can only ever read zero.",
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.cityWildlifeStock && CBZ.spawnSurvivorBotAt && CBZ.cityMountAnimal && document.getElementById('playBtn')",
  subjects,
  stage: stageShowDontTell,
};

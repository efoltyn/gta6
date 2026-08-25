/* SHARK SIM — THE PILL DIES, A WORDLESS METER LIVES. A flag A/B on ONE build.

   Both columns are THIS checkout, the same seed, the same island, the same
   staged match, driven by the same staging code. The ONLY difference is one
   query flag:

     ?cfg_SHARK_HUD_WORDLESS=0   modes/shark_sim.js keeps the old top-centre
                                 pill — species name, progress bar, and a
                                 "→ GREAT WHITE" label in a dark box

   THE OWNER'S DIRECTION, verbatim:

     "the most important thing: the popup on the screen saying shark name
      arrow next shark should be GONE ... instead each time the shark eats
      something it gets bigger, and a level-up meter moves up until the shark
      cinematically evolves."

   He does not hate bars. He hates WORDS. The body is the readout for "what am
   I" (every meal grows it), so the only thing left for a HUD to say is how
   close the next form is — and it can say that without a single character.

   THE NUMBER THIS PRESET EXISTS TO MOVE is charsOnScreen: every character of
   HUD/banner/toast text standing over LIVE play at the captured instant. The
   title card and the end cards are not live play and are not counted (they own
   the screen when play is not happening); the killfeed is standing owner
   doctrine and stays. Target: zero.
*/

const subjects = [
  {
    id: "midplay",
    label: "Mid-Play — A Box Of Words vs A Sliver",
    focus: "An ordinary second of a hammerhead's match, halfway to the great white. BEFORE: a dark pill sits at the top of the screen printing what you already are (\"GREAT HAMMERHEAD\") and what you will be (\"→ GREAT WHITE\") over the water. AFTER: nothing is over the water. The same progress is a 3 px wordless line seated under the health and stamina bars at the bottom, at their width — part of the instrument cluster, not a popup.",
    state: "TIER 2 · HALFWAY UP",
    metric: "Characters of text over live play · where the readout sits",
  },
  {
    id: "evolving",
    label: "The Level-Up — The Meter Fills, Flares, And Empties",
    strip: { frames: 5, stepSec: 0.3 },
    label2: "",
    focus: "The rung being climbed, filmed. The meter runs to full on the meal that crosses the threshold, holds full and flares white for the three quarters of a second the body spends visibly swelling out of its old size, then falls back to zero against the NEXT form's threshold. BEFORE, the same seconds: the pill's bar does the same arithmetic under a line of type that changes which species it names.",
    state: "RUNG CLIMBED",
    metric: "Characters of text over live play · meter fill across the beat",
  },
  {
    id: "apex",
    label: "Megalodon — The Meter Knows When To Leave",
    focus: "The top of the ladder. There is no next form, so AFTER the meter fades out permanently: a bar that can never move again is furniture. What is left to do — find an orca — is a thing to find in the water, not a thing to fill on a bar. BEFORE the pill is still there, pinned at 100%, telling you \"MEGALODON → ORCA\" for the rest of the match.",
    state: "TOP OF THE LADDER",
    metric: "Characters of text over live play · meter opacity",
  },
];

async function stageWordlessHud(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let D = window.__sharkHud;
  if (!D) {
    D = window.__sharkHud = {
      chapter: -1, waterline: 0, _rafOrig: null,
      step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); },
      sec(s) { D.step(Math.max(1, Math.round(s * 30))); },
      armed() {
        return !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
          CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark);
      },
      /* Freeze the page's own frame loop AND drain the straggler callback in a
         frame we control — the queued loop re-stamps the camera and presents
         its own frame over a staged capture (shark-sim.mjs learned this). */
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
      offshore(extra) {
        const S = CBZ.sharkSim.shark, P = CBZ.player;
        const p = D.ringPoint(D.playerAngle(), D.waterline + (extra == null ? 40 : extra));
        S.pos.x = p.x; S.pos.z = p.z;
        if (S._waterMove) { S._waterMove.x = p.x; S._waterMove.z = p.z; }
        P.pos.x = p.x; P.pos.z = p.z;
      },
      /* Predators shoved off the map and the shark topped up. These four
         helpers (peace / jawAhead / bait / shallow) are lifted verbatim from
         shark-show-dont-tell.mjs, which is where they were debugged: bait MOVES
         live survivors into the mouth rather than spawning new ones, and
         shallow means "into the shallows where the crowd can stand", not "lower
         the body". A first pass that reinvented both fed the shark nothing. */
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
      /* Climb a rung by PLAYING: bait, let the automatic bite feed, repeat.
         The rung that matters is always reached by a real evolve(). */
      feedToTier(tier) {
        const NEED = [0, 14, 34, 75], sim = CBZ.sharkSim;
        for (let round = 0; round < 12 && sim.tier < tier; round++) {
          D.peace(); D.shallow(4); D.step(12);
          sim.mass = Math.max(sim.mass, NEED[sim.tier + 1] - 1);
          D.bait(2, 1.2);
          for (let s = 0; s < 140 && sim.tier < tier; s++) D.step(1);
        }
        return sim.tier >= tier && D.armed();
      },
      /* eat until the rung climbs, from one meal short of the threshold */
      eatOneRung() {
        const NEED = [0, 14, 34, 75], sim = CBZ.sharkSim, from = sim.tier;
        for (let round = 0; round < 12 && sim.tier === from; round++) {
          D.peace(); D.shallow(4); D.step(12);
          sim.mass = NEED[from + 1] - 1;
          D.bait(2, 1.2);
          for (let s = 0; s < 150 && sim.tier === from; s++) D.step(1);
        }
        return sim.tier > from;
      },
      /* THE MEGALODON DIVES. Left alone it settles deep enough that the chase
         camera is under the surface and the whole frame is a blue veil with no
         animal in it — the apex portrait photographed nothing twice before this
         existed. Put the body just under the waterline and keep the rider (who
         the underwater tint keys on) with it. */
      surface() {
        const S = CBZ.sharkSim.shark, P = CBZ.player;
        const s2 = Math.max(1, (S.species && S.species.scale) || 1);
        const sy = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(S.pos.x, S.pos.z) : -0.8;
        S.pos.y = sy - 0.30 * s2;
        P.pos.y = S.pos.y;
        if (S._waterMove && S._waterMove.y != null) S._waterMove.y = S.pos.y;
      },
      /* THE CHASE VIEW this game actually plays in: behind and above the body.

         SIZED OFF THE BODY'S LENGTH, not off species.scale. scale is ~1 for the
         megalodon as much as for the hammerhead, so a scale-sized pullback that
         frames a 4 m hammerhead perfectly puts the camera INSIDE an 18 m
         megalodon — which is what the apex portrait was: a tail fin filling the
         screen, three runs in a row. marineBodyLen() is the number that
         actually differs, and at hammerhead size it lands within 1 m of the old
         framing, so the earlier shots are unchanged by this.

         IT ALSO AIMS AT THE RENDERED BODY, not at actor.pos: the surface nudge
         below moves group.position.y, and a deep-swimming shark's actor origin
         can be tens of metres under the thing on screen. */
      chase(S) {
        const h = S.heading || 0;
        const sy = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(S.pos.x, S.pos.z) : -0.8;
        const s2 = Math.max(1, (S.species && S.species.scale) || 1);
        const len = Math.max(3, (CBZ.marineBodyLen && CBZ.marineBodyLen(S)) || 4 * s2);
        // keep the body at the surface so the shot is a shark, not a silhouette
        if (S.group && sy - S.group.position.y > 0.25 * s2) {
          S.group.position.y = sy - 0.10 * s2;
          S.group.updateMatrixWorld(true);
        }
        const by = S.group ? S.group.position.y : S.pos.y;
        const R = 8 + 1.6 * len;
        D.tripod(S.pos.x - Math.cos(h) * R, sy + 3.0 + 0.5 * len, S.pos.z - Math.sin(h) * R,
          S.pos.x + Math.cos(h) * len * 0.9, by + 0.2 * s2, S.pos.z + Math.sin(h) * len * 0.9);
      },
      /* The match-start title card is a TITLE CARD: allowed, self-expiring,
         and not what any of these beats is about. Dropped on BOTH sides. */
      clearBanner() {
        const f = document.getElementById("sharkflash");
        if (f) { f.style.transition = "none"; f.style.opacity = "0"; }
      },
      /* world/water_underwater.js is a read-only OBSERVER of the camera, and it
         only looks during an update. The tripod moves the camera after the last
         step, so a veil decided while the game's own chase cam was under the
         surface stays painted over a shot taken from above it — a stale overlay
         describing a camera that no longer exists. Drop it on BOTH sides, the
         same way the title card is dropped. */
      dryLens() {
        const o = document.getElementById("cbzUnderwater");
        if (o) { o.style.transition = "none"; o.style.opacity = "0"; o.style.display = "none"; }
      },
      hudEl() { return document.getElementById("sharkhud"); },
      // the moving part, in BOTH designs — the pill's bar carries the same id
      barEl() { return document.getElementById("sharkhudfill"); },
      // the track the bar runs in: what the touch-collision claim is about
      trackEl() { const b = D.barEl(); return (b && b.parentElement) || D.hudEl(); },
      hudText() {
        const h = D.hudEl();
        return h ? (h.innerText || "").replace(/\s+/g, " ").trim() : "";
      },
      flashText() {
        const f = document.getElementById("sharkflash");
        if (!f || f.style.opacity === "0") return "";
        return (f.innerText || "").replace(/\s+/g, " ").trim();
      },
      noteText() {
        const n = document.getElementById("cityNote") || document.querySelector(".citynote, #note");
        return n && n.offsetParent !== null ? (n.innerText || "").replace(/\s+/g, " ").trim() : "";
      },
      // every word this mode is putting over LIVE play, right now
      words() {
        return (D.hudText() + " " + D.flashText() + " " + D.noteText()).replace(/\s+/g, " ").trim();
      },
      meterPct() {
        const b = D.barEl();
        if (!b) return 0;
        return Math.round(parseFloat(b.style.width || "0") || 0);
      },
      meterOpacity() {
        const h = D.hudEl();
        if (!h) return 0;
        if (h.style.display === "none") return 0;
        return +(parseFloat(getComputedStyle(h).opacity) || 0).toFixed(2);
      },
      // where the readout sits, as a fraction of screen height from the top
      hudTopFrac() {
        const t = D.trackEl();
        if (!t) return 0;
        const r = t.getBoundingClientRect();
        return +(r.top / (window.innerHeight || 1)).toFixed(2);
      },
      hudHeightPx() {
        const t = D.trackEl(); if (!t) return 0;
        return Math.round(t.getBoundingClientRect().height);
      },
      /* THE TOUCH CLAIM AS A NUMBER: how many square pixels of the shark HUD
         are underneath a touch control or the health/stamina bars. Anything
         above zero is a readout the thumb is standing on. */
      railOverlapPx() {
        const t = D.trackEl(); if (!t) return 0;
        const a = t.getBoundingClientRect();
        if (!a.width || !a.height) return 0;
        let worst = 0;
        const sel = "#tstick, #tbtns .tbtn, #tveh .tvbtn, #tveh #tvAux, #survBars .sbar:not(#sharkhud)";
        for (const el of document.querySelectorAll(sel)) {
          if (!el.offsetParent && getComputedStyle(el).position !== "fixed") continue;
          if (getComputedStyle(el).display === "none") continue;
          const b = el.getBoundingClientRect();
          if (!b.width || !b.height) continue;
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const hh = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (w > 0 && hh > 0) worst = Math.max(worst, Math.round(w * hh));
        }
        return worst;
      },
      snap(out) {
        out.charsOnScreen = D.words().length;
        out.hudChars = D.hudText().length;
        out.meterFillPct = D.meterPct();
        out.meterOpacity = D.meterOpacity();
        out.hudTopFrac = D.hudTopFrac();
        out.railOverlapPx = D.railOverlapPx();
        const S = CBZ.sharkSim && CBZ.sharkSim.shark;
        out.bodyLenM = S ? +(((CBZ.marineBodyLen && CBZ.marineBodyLen(S)) || 0)).toFixed(1) : 0;
      },
    };

    window.__cbzVisualCompare = {
      /* With the page's frame loop dead, a canvas rendered outside an
         animation frame is never PRESENTED — render inside ONE borrowed frame,
         then wait out SwiftShader's compositor. */
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
      /* Merged by the runner AFTER the film strip — so every name in here must
         be its OWN name. Returning `meterFillPct` clobbered the frame-0 value
         with the post-strip one and cost three runs chasing a meter that was,
         in the actual photograph, full and white the whole time. */
      metrics() {
        if (!D._filming) return null;
        return {
          meterPeakPct: D._peakFill | 0,
          meterEndPct: D.meterPct(),
        };
      },
      advance(sec) {
        const n = Math.max(1, Math.round(sec * 30));
        for (let i = 0; i < n; i++) {
          CBZ.stepSim(1 / 30);
          if (D._filming) D._peakFill = Math.max(D._peakFill || 0, D.meterPct());
        }
      },
    };
  }

  const out = {};
  const CH = [
    /* 0 — AN ORDINARY SECOND. A hammerhead, halfway to the great white,
       in open water with nothing happening. This is the frame the owner was
       looking at when he asked for the pill to go. */
    async function midplay() {
      if (!await D.boot()) throw new Error("no match / sim never armed");
      D.seed();
      D.peace();
      if (!D.feedToTier(1)) throw new Error("never reached hammerhead");
      const sim = CBZ.sharkSim;
      sim.mass = 14 + (34 - 14) * 0.55;      // 55% of the way to the great white
      D.peace(); D.offshore(44); D.sec(1.0);
      D.clearBanner();
      D.sec(0.4);                            // let the 0.25 s HUD clock tick
      D.chase(sim.shark);
      D.snap(out);
      out.tier = sim.tier;
    },

    /* 1 — THE RUNG. Eat the meal that crosses the threshold and film what the
       meter does across the evolve beat: full, white flare, then zero against
       the next rung. The evolve() is the production one. */
    async function evolving() {
      const sim = CBZ.sharkSim;
      D.peace(); D.offshore(40); D.sec(0.4);
      const before = sim.tier;
      if (!D.eatOneRung()) throw new Error("never climbed a rung");
      /* One fifth of a second past the swap, on purpose: the HUD refreshes on
         a 0.25 s clock and the flare runs 0.75 s, so frame 0 catches the meter
         held full and white while the body is still swelling, and the strip's
         later frames catch it emptied against the NEW rung. */
      /* NO EXTRA STEPPING BEFORE THE CAPTURE. evolve() runs inside a sim step
         and the HUD's own tick at the END of that same step is what notices the
         rung and lights the flare — so the frame the loop above stopped on is
         already the flared one. Measured: the flare holds 100% for 15 further
         steps, which is what the film strip walks through. */
      D.clearBanner();                       // the flag-off banner is chapter 0's claim
      D._filming = true; D._peakFill = D.meterPct();
      D.snap(out);
      out.growLive = sim.grow ? 1 : 0;
      out.bodyScaleNow = +((sim.shark.group && sim.shark.group.scale.x) || 0).toFixed(3);
      out.evolveBeats = sim.evolveBeats | 0;
      out.tierFrom = before; out.tierTo = sim.tier;
      D.chase(sim.shark);
    },

    /* 2 — THE TOP. Megalodon: nothing left to evolve into. */
    async function apex() {
      D._filming = false;
      const sim = CBZ.sharkSim;
      D.peace();
      if (!D.feedToTier(3)) throw new Error("never reached megalodon");
      /* THE SHALLOWS, NOT THE DEEP. Offshore, a megalodon settles far enough
         under that the chase camera ends up below the surface and the portrait
         comes back as a blue rectangle (photographed three times before this
         line existed). The near-shore water the rest of this preset shoots in
         is shallow enough that the body stays where the camera can see it. */
      D.peace(); D.shallow(14); D.surface(); D.sec(2.5);  // past the flare, into the fade
      D.clearBanner();
      D.surface();
      D.sec(0.6);
      D.surface();
      D.dryLens();
      /* REAL milliseconds, not game seconds. Everything above runs in a few
         ms of wall clock, and the meter's exit is a 0.7 s CSS transition —
         which is wall clock. Reading the opacity without this waits for
         nothing and photographs a fade that has not started. */
      await sleep(900);
      D.chase(sim.shark);
      D.snap(out);
      out.tier = sim.tier;
    },
  ];

  while (D.chapter < sub.ch) {
    D.chapter++;
    await CH[D.chapter]();
  }

  window.__cbzVisualCompare.render();
  return {
    ok: true, side: input.side, chapter: sub.ch,
    debug: {
      state: CBZ.game.state,
      species: CBZ.sharkSim && CBZ.sharkSim.shark ? CBZ.sharkSim.shark.species.id : null,
      tier: CBZ.sharkSim ? CBZ.sharkSim.tier : null,
      words: D.words().slice(0, 140),
      hudWordless: CBZ.CONFIG.SHARK_HUD_WORDLESS !== false,
      showDontTell: CBZ.CONFIG.SHARK_SHOW_DONT_TELL !== false,
    },
    metrics: out,
  };
}

// chapter index is positional, so keep it off the literal above
subjects[0].ch = 0;
subjects[1].ch = 1;
subjects[2].ch = 2;

export default {
  id: "shark-wordless-hud",
  title: "Shark Sim — The Pill Dies, A Wordless Meter Lives",
  description: "Three beats of one Shark Sim match, photographed twice on the SAME checkout with one config flag between the columns. BEFORE keeps the top-centre pill: the species you already are, a bar, and a \"→ GREAT WHITE\" label in a box over the water. AFTER deletes all of it and leaves one 3 px wordless sliver seated with the health and stamina bars — it fills as you eat, flares white for the beat the body swells into its next form, empties into the new rung, and fades out for good once there is no next form left.",
  beforeLabel: "BEFORE · ?cfg_SHARK_HUD_WORDLESS=0 (the pill)",
  afterLabel: "AFTER · flag default-on (shipped)",
  pairNote: "Same checkout · same seed · same island · same staging code · only the flag differs",
  method: "Both columns serve THIS checkout (--before local) and boot index.html?mode=sharksim with a pinned seed, click the tile and PLAY like a player, then freeze the page's frame loop and advance the real match with CBZ.stepSim. One staging path runs on both sides and never reads a flag, so any difference in the pictures is the flag. The ladder is climbed by actually eating — every evolve() in these frames is the production one — and the mid-play text is counted off the live DOM at the captured instant.",
  defaultBefore: "local",
  /* cfg_BOOT_METER=0: the presented start eases its boot card on a RAF chain
     and this preset freezes the frame loop after boot, which would otherwise
     latch state.js's bootBusy forever. */
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0", cfg_SHARK_HUD_WORDLESS: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 360000,
  metricsWhitelist: true,
  metrics: {
    charsOnScreen: { label: "Characters of text over live play", unit: "chars", better: "lower" },
    hudChars: { label: "Characters printed by the shark HUD itself", unit: "chars", better: "lower" },
    meterFillPct: { label: "Progress to the next form at the captured frame", unit: "%" },
    meterPeakPct: { label: "Peak fill across the filmed beat", unit: "%" },
    meterEndPct: { label: "Fill once the filmed beat has run out", unit: "%" },
    growLive: { label: "Body still swelling at the captured frame (1 = yes)" },
    bodyScaleNow: { label: "Body scale at the captured frame" },
    meterOpacity: { label: "Meter opacity (0 = it has left the screen)", better: "lower" },
    hudTopFrac: { label: "Where the readout sits (0 = top of screen, 1 = bottom)", better: "higher" },
    railOverlapPx: { label: "Readout pixels under a touch control or another bar", unit: "px²", better: "lower" },
    evolveBeats: { label: "Cinematic evolutions staged" },
    tier: { label: "Rung of the ladder" },
    bodyLenM: { label: "Body length at the captured frame", unit: "m" },
  },
  metricsNote: "charsOnScreen is the owner's complaint as a number: every character of HUD, banner and toast text standing over LIVE play at the captured instant — the title card and the end cards are cleared on both sides because they own the screen when play is not happening, and the killfeed is standing doctrine. hudTopFrac says where the readout lives: the pill sits at 0.01 (pinned over the water at the top), the sliver at ~0.94 (down in the instrument cluster). railOverlapPx is the touch claim: zero square pixels of the meter under a thumb control on an iPad.",
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.cityWildlifeStock && CBZ.spawnSurvivorBotAt && CBZ.cityMountAnimal && document.getElementById('playBtn')",
  subjects,
  stage: stageWordlessHud,
};

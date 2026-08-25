/* Island Sea Life, before/after — IS THERE ANYTHING IN THIS OCEAN?

   OWNER, of Shark Sim: "check why there's so few others — it's just orca, no
   other sharks or small fish."

   He was right, and the reason was not that the sea was under-stocked. It was
   stocked — thirty-odd animals across fourteen species, seeded the moment the
   island builds — and then every single one of them was placed on the SAME
   dead coordinate: city/wildlife.js's ocean sampler asked the CITY's water
   field where the water was, got "nowhere" (the city terrain is never built
   in this mode), fell through a validation ladder whose first rung was always
   taken and always false, and returned a hardcoded constant point — the
   mid-radius of a fantasy 780 m band, due east of the island. That point is
   187 m outside the fence world/water_survival.js's navigator walls the
   swimmable sea with, so every fish, every rival shark and the megalodon
   reported `blocked` on their first step and never moved again, 300 m from
   anybody, LOD-hidden, for the whole match. The orcas were the only animals
   ever met because the shark brain steers them without ever asking that
   navigator.

   BOTH COLUMNS BOOT THE SAME MODE — ?mode=sharksim, the real game, the real
   mount, the real HUD — and run the same match forward with CBZ.stepSim. The
   only difference is the build: BEFORE is pristine HEAD, AFTER is the working
   tree. So every difference in these frames is the change and nothing else.

   The metrics are the argument; the frames are the evidence. `Sea life that
   MOVED in two seconds` is the one that names the bug: on the before build a
   sea that is not empty is still a sea of statues. */

const subjects = [
  {
    id: "the-play-ring", ch: 0,
    label: "The Play Ring — What The Sea Looks Like From The Shark",
    focus: "The game's own camera, over your own shark's back, in the water you actually swim. BEFORE: open blue in every direction — the sea's whole population is stacked on one point far outside the fence, frozen. AFTER: schools and bodies in the water around you, placed inside the band the navigator will actually let them swim in.",
  },
  {
    id: "bait-ball", ch: 1,
    label: "A Bait Ball, For Free",
    focus: "city/marine_frenzy.js has always opened a bait ball when a school of mackerel or sardine is on screen with something toothed inside 130 m — and the player's own shark is something toothed. It never fired here because there was never a school. AFTER: fix the population and the frenzy system lights up with no edit of its own; the shark closes on a ball of silver driven up against the surface.",
  },
  {
    id: "a-rival-in-the-water", ch: 2,
    label: "Another Shark",
    focus: "The nearest rival shark to the player, photographed where it swims. BEFORE: the island's bull sharks and great whites exist in the roster and are all parked on the dead point — the nearest one is a quarter of a kilometre away and has not moved since the match began. AFTER: rivals cruise the play ring, restocked to a count that follows the ladder you are on.",
  },
  {
    id: "the-whole-sea", ch: 3,
    label: "The Wide — How Much Is In Here",
    focus: "Swim to the busiest water within 160 m — ten seconds for a shark — and look at it. BEFORE: there is no busiest water; the ocean's entire population is a quarter of a kilometre away and has not moved since the match began, so the camera has nothing to turn toward. AFTER: a sea with things in it.",
  },
];

async function stageSeaLife(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let D = window.__seaLifeBA;
  if (!D) {
    D = window.__seaLifeBA = {
      chapter: -1, waterline: 0,
      step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); },
      sec(s) { D.step(Math.max(1, Math.round(s * 30))); },

      armed() {
        return !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
          CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark);
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
      async killFrames() {
        const orig = D._rafOrig || window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => orig.call(window, () => res()));
      },

      // ---- the world, measured ------------------------------------------
      sea(fn) {
        const S = CBZ.sharkSim && CBZ.sharkSim.shark;
        let n = 0;
        for (const a of CBZ.cityWildlife || []) {
          if (!a || a.dead || a.external || a === S) continue;
          if (!a.species || !a.species.aquatic) continue;
          n++; if (fn) fn(a);
        }
        return n;
      },
      pos(a) { return (a.group && a.group.position) || a.pos; },
      distP(a) {
        const P = CBZ.player, p = D.pos(a);
        return Math.hypot(p.x - P.pos.x, p.z - P.pos.z);
      },
      /* THE METRIC THAT NAMES THE BUG. Snapshot every sea body, step two
         seconds of the real match, and count how many of them are somewhere
         else. A frozen sea and an empty one photograph identically; this is
         the number that tells them apart. */
      movedPct() {
        const was = [], list = [];
        // the sea you are IN, 120 m — inside the wildlife LOD radius at every
        // quality tier, so this measures whether the animals are ALIVE and not
        // whether they are being ticked. Far sea life idles by design on both
        // builds; counting it would be measuring the LOD.
        D.sea(function (a) { if (D.distP(a) > 120) return; list.push(a); const p = D.pos(a); was.push(p.x, p.z); });
        if (!list.length) return 0;
        D.sec(2);
        let moved = 0;
        for (let i = 0; i < list.length; i++) {
          const p = D.pos(list[i]);
          if (Math.hypot(p.x - was[i * 2], p.z - was[i * 2 + 1]) > 0.5) moved++;
        }
        return Math.round((moved / list.length) * 100);
      },
      nearCount(r) { let n = 0; D.sea(function (a) { if (D.distP(a) < r) n++; }); return n; },
      speciesNear(r) {
        const seen = {};
        D.sea(function (a) { if (D.distP(a) < r) seen[a.species.id] = 1; });
        return Object.keys(seen).length;
      },
      /* THE BUSIEST WATER within reach. Underwater sight lines here are short
         — a body 60 m off is fog — so "is the sea populated" has to be
         photographed where the sea IS, not from wherever the match happened
         to leave the camera. O(n^2) over at most a few dozen bodies, once. */
      bestCluster(maxD, r, pred) {
        const list = [];
        D.sea(function (a) {
          if (D.distP(a) > maxD) return;
          if (pred && !pred(a)) return;
          const p = D.pos(a); list.push({ x: p.x, z: p.z });
        });
        let best = null, bn = 0;
        for (const c of list) {
          let n = 0;
          for (const q of list) if (Math.hypot(q.x - c.x, q.z - c.z) < r) n++;
          if (n > bn) { bn = n; best = c; }
        }
        return best ? { x: best.x, z: best.z, n: bn } : null;
      },
      nearest(pred) {
        let best = null, bd = 1e9;
        D.sea(function (a) { if (!pred(a)) return; const d = D.distP(a); if (d < bd) { bd = d; best = a; } });
        return best ? { a: best, d: bd } : null;
      },
      isBait(a) { const h = a.species.herd; return Array.isArray(h) && (+h[1] || 0) >= 12 && !(a.species.bite > 0); },
      isRival(a) { return (a.species.bite || 0) >= 20 && a.species.id !== "orca"; },

      // ---- staging --------------------------------------------------------
      playerAngle() {
        const A = CBZ.surv.arena, P = CBZ.player;
        return Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0;
      },
      ringPoint(ang, r) {
        const A = CBZ.surv.arena;
        return { x: A.center.x + Math.cos(ang) * r, z: A.center.z + Math.sin(ang) * r };
      },
      moveTo(x, z) {
        const P = CBZ.player, S = CBZ.sharkSim && CBZ.sharkSim.shark;
        P.pos.x = x; P.pos.z = z;
        if (S) {
          S.pos.x = x; S.pos.z = z;
          if (S.group) { S.group.position.x = x; S.group.position.z = z; }
          if (S._waterMove) { S._waterMove.x = x; S._waterMove.z = z; }
          if (S.home) { S.home.x = x; S.home.z = z; }
        }
        D.step(3);
      },
      // the camera yaw that looks ALONG a world heading (matches shark-sim.mjs)
      camYawAlong(h) { return Math.atan2(-Math.cos(h), -Math.sin(h)); },
      lookAlong(h, pitch) {
        if (CBZ.cam) { CBZ.cam.yaw = D.camYawAlong(h); CBZ.cam.pitch = pitch == null ? 0.12 : pitch; }
        D.step(2);
      },
      lookAt(x, z, pitch) {
        const P = CBZ.player;
        D.lookAlong(Math.atan2(z - P.pos.z, x - P.pos.x), pitch);
      },
      seaY(x, z) { return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : -0.8; },
    };

    window.__cbzVisualCompare = {
      /* Awaited before every capture. Under SwiftShader the compositor takes
         over a second to PRESENT, and the page's own frame loop is dead — so
         render inside ONE borrowed animation frame and then wait the
         compositor out, or the screenshot is the previous beat. */
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

  const out = {};
  const CH = [
    /* 0. THE PLAY RING. Boot, then let the match run: forty seconds is long
          enough for anything that is going to arrive to have arrived, and
          short enough that nothing has been eaten down. */
    async function playRing() {
      if (!await D.boot()) throw new Error("shark sim never armed");
      /* Swim out to the play ring FIRST and let the match run there. The order
         matters: the top-up places arrivals around wherever the player is, so
         forty seconds spent in the surf and then a teleport offshore would
         photograph water the sea life has not caught up with — which is the
         tool lying about the change rather than measuring it. */
      const ang0 = D.playerAngle();
      const p0 = D.ringPoint(ang0, D.waterline + 45);     // open water, off the beach
      D.moveTo(p0.x, p0.z);
      D.sec(45);
      const ang = D.playerAngle();
      out.seaLive = D.sea();
      out.nearPlayer = D.nearCount(150);
      out.speciesNear = D.speciesNear(150);
      out.movedPct = D.movedPct();                        // steps 2 s
      // Point the player's own camera at the busiest water within sight,
      // which is what a player does. Nothing is moved for the frame.
      const c = D.bestCluster(70, 30) || (D.nearest(function () { return true; }) || {}).a;
      const cp = c && (c.x != null ? c : D.pos(c));
      if (cp) D.lookAt(cp.x, cp.z, 0.18);
      else D.lookAlong(ang + Math.PI / 2, 0.16);          // ..or empty ocean
    },
    /* 1. THE BAIT BALL. Swim to the nearest school and wait: marine_frenzy
          polls at 2 Hz and opens a site on its own the moment a toothed body
          is within 130 m of a bait species on screen. Nothing here reaches
          into that file. */
    async function baitBall() {
      const school = D.nearest(D.isBait);
      /* ONLY IF IT IS ACTUALLY REACHABLE. Swimming to whatever the nearest
         bait fish happens to be would, on the before build, teleport the
         player 300 m out to the dead point where the whole ocean is stacked —
         and photograph a crowd. The tool would then be manufacturing the
         result it exists to measure. A school you would not swim to is a
         school that is not there. */
      if (school && school.d < 160) {
        const p = D.pos(school.a);
        const h = Math.atan2(p.z - CBZ.player.pos.z, p.x - CBZ.player.pos.x);
        D.moveTo(p.x - Math.cos(h) * 26, p.z - Math.sin(h) * 26);
        D.lookAt(p.x, p.z, 0.06);
        D.sec(6);                                        // the poll opens it
      }
      const sites = CBZ.marineFrenzySites ? CBZ.marineFrenzySites([]) : [];
      const ball = sites.find((s) => s.kind === "bait") || null;
      if (ball) {
        D.moveTo(ball.x - 22, ball.z - 8);
        D.lookAt(ball.x, ball.z, 0.02);
        D.sec(1.5);
        D.lookAt(ball.x, ball.z, 0.02);
      } else if (school) {
        D.lookAt(D.pos(school.a).x, D.pos(school.a).z, 0.06);
      } else {
        D.lookAlong(D.playerAngle() + Math.PI / 2, 0.08);
      }
      out.schoolM = school ? Math.round(school.d) : null;
      // the SHOAL number: the most bait fish within 20 m of one another
      // anywhere in reach. A school that has scattered is not a school.
      const sh = D.bestCluster(150, 20, D.isBait);
      out.shoalN = sh ? sh.n : 0;
    },
    /* 2. A RIVAL. The nearest shark that is not you and not an orca, come
          alongside and looked at. */
    async function rival() {
      /* WAIT FOR ONE, do not go and get it. A shark on this island cruises the
         whole ring in under a minute, so "is there a rival near me" is a
         question about the population and not about where the camera is
         pointed — and going to fetch one would, on the before build, be a
         teleport into the frozen pile. Twenty-five seconds of the real match
         is a fair wait; if nothing comes past, nothing is out there. */
      let r = D.nearest(D.isRival);
      for (let t = 0; t < 25 && !(r && r.d < 130); t++) { D.sec(1); r = D.nearest(D.isRival); }
      out.rivalM = r ? Math.round(r.d) : null;
      out.rivalsNear = 0;
      D.sea(function (a) { if (D.isRival(a) && D.distP(a) < 200) out.rivalsNear++; });
      if (!r || r.d > 130) { D.lookAlong(D.playerAngle() + Math.PI / 2, 0.08); return; }
      /* THE GAME'S OWN CAMERA, not a tripod. Two runs of detached shots
         proved the point the hard way: this sea has a surface plane and a
         seabed ring that both read as flat black slabs edge-on, and a
         hand-placed lens near the waterline photographs one or the other.
         The chase camera keeps itself in the water column by construction —
         and it is also the frame a player actually gets. */
      /* THIRTY METRES BACK, AND NO SIM TIME BETWEEN THE MOVE AND THE FRAME.
         The chase camera orbits the PLAYER, so anything nearer than about
         twenty metres is directly behind your own hull — an earlier cut came
         alongside at 22 m, let a second of match run, and the rival swam to
         three metres and vanished inside the player's own shark. */
      const p = D.pos(r.a), P0 = CBZ.player;
      const away = Math.atan2(P0.pos.z - p.z, P0.pos.x - p.x);
      D.moveTo(p.x + Math.cos(away) * 30, p.z + Math.sin(away) * 30);
      const q = D.pos(r.a);
      D.lookAt(q.x, q.z, 0.14);
    },
    /* 3. THE WIDE. Same water, pulled back — the frame that answers "how much
          is in here" rather than "what is that". Detached, in the water (this
          sea reads opaque from above the surface, so an aerial census
          photographs as empty water no matter what is under it). */
    async function wholeSea() {
      D.sec(2);
      out.seaLive = D.sea();
      out.speciesNear = D.speciesNear(230);
      out.nearPlayer = D.nearCount(150);
      const P = CBZ.player;
      /* Swim to the busiest water inside 160 m — a distance a shark covers in
         ten seconds — and look at it. Nothing beyond 160 m counts, which is
         what keeps the before column honest: going to fetch its one frozen
         pile would be the tool manufacturing the crowd it exists to measure. */
      const c = D.bestCluster(160, 34);
      out.clusterN = c ? c.n : 0;
      if (!c) { D.lookAlong(D.playerAngle() + Math.PI / 2, 0.2); return; }
      const toward = Math.atan2(c.z - P.pos.z, c.x - P.pos.x);
      D.moveTo(c.x - Math.cos(toward) * 32, c.z - Math.sin(toward) * 32);
      D.lookAt(c.x, c.z, 0.2);
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
      mode: CBZ.game.mode,
      tier: CBZ.sharkSim ? CBZ.sharkSim.tier : null,
      seaAdds: CBZ.sharkSim ? (CBZ.sharkSim.seaAdds || 0) : 0,
      navRing: CBZ.survNavRing ? CBZ.survNavRing(20) : null,
      waterline: Number(D.waterline.toFixed(1)),
    },
    metrics: out,
  };
}

export default {
  id: "island-sea-life",
  title: "Shark Sim — The Sea Was Never Empty, It Was Frozen",
  description: "Four beats of one Shark Sim match, on the same seed, in the same mode, forty seconds in. BEFORE is pristine HEAD: the island's whole sea life is seeded onto one hardcoded point 187 m outside the fence its own navigator walls the swimmable water with, so every fish and every rival shark is blocked on its first step and LOD-hidden for the entire match — only the orcas, which the shark brain steers without asking that navigator, are ever met. AFTER is the working tree: the spawner asks the island where a body of a given clearance can actually swim, the two water-field functions the survival wrap forgot are wrapped, species that cannot fit the bowl are skipped instead of frozen, and the mode keeps its own sea stocked as the player eats it.",
  beforeLabel: "BEFORE · pristine HEAD",
  afterLabel: "AFTER · working tree",
  pairNote: "Same mode (?mode=sharksim) · same island · same seed · same 40 simulated seconds",
  method: "Both sides boot index.html, click the Shark Sim tile and PLAY exactly like a player, then freeze the page's frame loop and advance the real match with CBZ.stepSim so no capture can race the renderer. Every shot is the game's own chase camera, aimed the way a player would aim it: at the busiest water within reach, or at whatever is nearest. Nothing is posed — no body is moved, hidden, surfaced or lit for a frame, and the only teleports are of the PLAYER, never further than a shark swims in ten seconds, so the before column can never be handed a crowd it would not have found.",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 300000,
  metrics: {
    seaLive: { label: "Living sea animals in the world", better: "higher" },
    nearPlayer: { label: "Sea animals within 150 m of the player", better: "higher" },
    speciesNear: { label: "Distinct species within reach", better: "higher" },
    movedPct: { label: "Sea life within 120 m that MOVED in two seconds", unit: "%", better: "higher" },
    shoalN: { label: "Biggest shoal in reach (bait fish within 20 m of each other)", better: "higher" },
    schoolM: { label: "Nearest school of bait fish", unit: "m", better: "lower" },
    rivalM: { label: "Nearest rival shark", unit: "m", better: "lower" },
    rivalsNear: { label: "Rival sharks within 200 m", better: "higher" },
    clusterN: { label: "Bodies in the busiest water within reach", better: "higher" },
  },
  metricsNote: "\"Sea life that MOVED in two seconds\" is the one that names the bug: a frozen ocean and an empty one photograph identically, and only this number tells them apart.",
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.cityWildlifeStock && CBZ.cityWildlifeSpawnAt && CBZ.cityMountAnimal && document.getElementById('playBtn')",
  subjects,
  stage: stageSeaLife,
};

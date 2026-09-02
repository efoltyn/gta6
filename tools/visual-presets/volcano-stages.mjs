/* THE STRATOVOLCANO storyboard for tools/visual-compare.mjs.

   Boots the REAL survival mode (title → Disaster Survival → Play), freezes
   the rAF loop, forces the director to the volcano, and photographs the same
   simulated seconds of the same seeded eruption on both sides.

   FLAG A/B AS OF 2026-08-26: both sides are THIS checkout; the before side
   boots with ?cfg_VOLCANO_PLUME_V2=0. That is the exact current geometric
   bead-column. The after side keeps the same eruption, wind, ash, lava and
   lighting but replaces those giant synchronized cards with the RPG blast's
   lumpy smoke mask, per-puff grow/drift/fade, a dense dark core and an
   irregular cauliflower edge. The column is also brought back from a
   seven-mountain-height needle to the broader landscape proportion in the
   owner's two reference photographs.

   VOLCANO ONLY (owner, 2026-08-15: "I just wanted the volcano to be more
   real... I never mentioned nuke"). The four nuke-finale beats this preset
   used to end on are gone with the finale itself — the island's arc is
   nature all the way now, and a volcano report photographs the volcano.

   Skeleton lifted from disaster-sequence.mjs (same boot, same rAF freeze,
   same stepSim clock, same HUD-hide sweep). What is different is the AIMING:

   THE HAZARD TELLS THE CAMERA WHERE TO STAND. The pyroclastic lane and the
   lahar channel are chosen per-run off the mountain's own fall line, so a
   hard-coded tripod would photograph an empty hillside half the time. Every
   travelling beat instead reads CBZ.disasters.hazards() — which already
   publishes the flow front as {line:true,x,z,dx,dz} for the minimap — and
   frames the front from its FLANK, looking along the direction of travel.
   `ok:false` if the hazard is not there: a shot that cannot find its subject
   is a lie, and it says so instead of photographing grass.

   Beats:
     warn-lane    the telegraph. Rock coming down the corridor the flow will
                  take, crater glow, first ash, crowd clearing the lane.
     column       the eruption itself, fountain + ash column.
     pyroclastic  THE MONEY SHOT. The density current mid-descent, flank-on,
                  racing toward the town side of the island.
     lahar        wet concrete in the channel, boulders riding it.
     ash-street   the graying blanket over the town, with roofs failing under
                  the load.
     lava-night   close-up. Opaque crust, incandescent channels, and the flow
                  lighting the hillside at night.

   Metrics ride the two ratchets: CBZ.volcanoAudit() (lavaTransparent MUST be
   0 — that is the owner's "see thru" complaint as a number) and
   CBZ.disasterAudit() (pyroRuns / laharRuns / ashRoofCollapses).

   AND THE BODY COUNT, which is the owner's OTHER complaint — "the volcano
   kills way too many people and randomly" — as a number. `aliveNow` and
   `killedThisBeat` are read off CBZ.surv.aliveCount(), which the DEPLOYED
   build already exports, so this is a like-for-like measurement of the same
   seeded lobby rather than a new counter that only the after side can answer.
   The preset heals the PLAYER every tick, so every death in these numbers is
   a bot the eruption actually killed. */

/* EVERY HAZARD BEAT RE-FORCES THE ERUPTION. The volcano's active window is
   20 s and there are seven things to photograph in it; a single run cannot
   hold all seven at the age each one wants, and a beat that arrives after the
   event ended photographs an empty hillside (it did, twice, before this).
   Forcing per beat costs ~6 s of warn each time and buys every beat its own
   correctly-aged eruption on both sides of the comparison.

   EVERY, not most. Two of the lava beats used to inherit the eruption their
   PREDECESSOR had forced, and that quietly made the storyboard order
   load-bearing: `--subjects lava-day` on its own photographed an idle island
   with a fallback tripod and cheerfully reported ok:true, which is the one
   thing this preset's header promises it will not do. A beat that cannot
   stage its own subject is not a beat. */
const subjects = [
  { id: "volcano-idle", label: "The volcano at rest — a mountain that could erupt", hud: false,
    focus: "No disaster running, midday, wide from offshore. Before: the refuge mountain is a white nine-sided pyramid with a snow cone glued on. After: a stratovolcano with a crater — dark scoria summit, gullied concave flanks, snow above the snowline, grass skirt — the same footprint and peak the flood refuge needs.",
    act: { day: true, settleSecs: 2 },
    cam: { volcano: true, dist: 150, alt: 22, aboveVent: 12, fov: 60 } },

  { id: "warn-lane", label: "Warning — the lane announces itself", hud: false,
    focus: "THE MOUNTAIN, in daylight, before it blows. Before: a white nine-sided pyramid with a snow cone on top — a linear cone, one colour, under a bright sun. After: a stratovolcano — concave flanks with radial gullies, dark scoria at the summit, a real crater bowl inside the rim, snow only above the snowline. Rockfall down the lane and the crowd clearing it are the same on both sides. The tan coin hanging in the sky on the before side is the crater pre-glow: disc() stands a mesh on the floor and was handed the peak height AGAIN, so it floated 26 m over the summit.",
    act: { force: "volcano", untilState: "warn", extraSecs: 4.2 },
    cam: { lane: true, ahead: 60, side: 26, alt: 26, fallback: { x: 108, y: 46, z: 672, ax: 0, ay: 20, az: 600 } } },

  { id: "column-young", label: "The young plume — smoke is born at the vent", hud: false,
    focus: "t+2.4 s. The column must be born AT the crater: before, every puff was invisible until 13 m up (opacity ramped in after the puff had already climbed), so the plume hung over a gap of orange confetti. After: a Strombolian fountain of incandescent clots on ballistic arcs fills that gap, and the soot rises out of the fountain.",
    act: { force: "volcano", untilState: "active", extraSecs: 2.4, pinWind: [0.7, -0.7] },
    cam: { volcano: true, dist: 62, alt: 10, aboveVent: 38, fov: 72 } },

  { id: "column", label: "The mature eruption column — the silhouette", hud: false,
    focus: "The matched wide read at t+8 s. Before: a 5-10 m wide string of round grey-green puffs over a 72 m wide mountain — a chimney, not an eruption. After: base as wide as the vent, widening by entrainment into a broad turbulent head, dark soot with a sun-lit crown, standing on a fountain — the landscape proportion of the reference photographs.",
    /* force: this beat used to inherit whatever disaster the director
       happened to be on — run alone (`--subjects column`) it photographed a
       LIGHTNING STORM and reported ok:true, the exact order-dependence the
       header note above forbids. */
    /* pinWind perpendicular to the tripod's sightline, so the column leans
       in PROFILE — a lean toward or away from the lens reads as nothing. */
    act: { force: "volcano", untilState: "active", extraSecs: 8, pinWind: [0.7, -0.7] },
    /* Wide enough to hold the old oversized head and the new landscape-scale
       plume in one locked frame. */
    cam: { volcano: true, dist: 200, alt: 25, aboveVent: 88, fov: 66 } },

  { id: "column-close", label: "The smoke at reading distance — no cards", hud: false,
    focus: "Close enough to judge the mass. Before: individual round puffs legible up the whole stem, a floating base, grey-green pigment. After: overlap deep enough that no single puff reads, dark brown-grey at the base lit from below, and the fountain under it.",
    act: { force: "volcano", untilState: "active", extraSecs: 8, pinWind: [0.7, -0.7] },
    cam: { volcano: true, dist: 54, alt: 9, aboveVent: 46, fov: 74 } },

  { id: "eruption-night", label: "Night eruption — fire under ash", hud: false,
    focus: "The first reference regime (Fuego by night): a black cone, a fan of incandescent lava, a white-orange throat, a fountain of fire, and a charcoal plume whose BASE catches the vent glow while the rest is black against the sky. Before: the plume was PALE grey at night — lighter than the sky — and the fountain was dots.",
    act: { night: true, force: "volcano", untilState: "active", extraSecs: 9, pinWind: [0.7, -0.7] },
    cam: { volcano: true, dist: 58, alt: 9, aboveVent: 43, fov: 74 } },

  { id: "lava-day", label: "Lava close-up — opaque crust", hud: false,
    focus: "THE BIBLE SHOT (owner's Etna close-up, 2026-08-15): a DARK crusted surface with a bright connected LACE of melt cracked through it. Before: a smooth pale-gold plastic ramp with ruler edges, pale levees and no lace at all, on a tan hillside dotted with grey ash blobs. After: dark levees, a red-orange channel, a bright lace, a margin that bellies — on a dark volcanic flank under a uniform ash veil. vol_lavaTransparent must read 0 on both.",
    act: { force: "volcano", untilState: "active", extraSecs: 12 },
    cam: { lava: true, frame: 0.55, out: 30, alt: 20, behind: 3, fallback: { x: 26, y: 12, z: 626, ax: 4, ay: 4, az: 606 } } },

  { id: "lava-front", label: "The advancing nose — does it FLOW?", hud: false,
    focus: "The leading edge at close range: it noses forward continuously, the lace travels downstream, the run forks (vol_lavaBranches). The machinery is the same on both sides; what changes is that the crust is dark and the melt is fire instead of gold.",
    /* behind 6 (was -5): stand UP-flow of the nose, above it, looking down
       the descent. Down-flow of a nose on a cone means below its own ridge
       line, and the peek run photographed the ridge instead of the rock. */
    act: { force: "volcano", untilState: "active", extraSecs: 9 },
    cam: { lava: true, frame: 1, out: 20, alt: 16, behind: 6, fallback: { x: 22, y: 9, z: 620, ax: 4, ay: 3, az: 604 } } },

  { id: "pyroclastic", label: "Pyroclastic flow — mid-descent", hud: false,
    focus: "CONTROL — THE KILLER. A ground-hugging avalanche of 600 C rock and gas boiling down the fall line at 6x sprinting speed. V3 leaves the current alone; the only after-side difference in frame should be the taller column and the greyer downwind air behind it.",
    act: { force: "volcano", untilState: "active", extraSecs: 5.4, needLine: true },
    cam: { lane: true, ahead: 44, side: 15, alt: 34, fallback: { x: 96, y: 34, z: 664, ax: 0, ay: 16, az: 604 } } },

  { id: "pyro-close", label: "The cloud at reading distance", hud: false,
    focus: "CONTROL. The cloud close enough that individual elements are legible: it must read as churning ash with soft irregular edges on BOTH sides — V3 does not touch the current's sprites.",
    act: { force: "volcano", untilState: "active", extraSecs: 4.3, needLine: true },
    cam: { lane: true, ahead: 20, side: 30, alt: 13, fallback: { x: 74, y: 22, z: 646, ax: 10, ay: 12, az: 610 } } },

  { id: "lahar", label: "Lahar in the channel", hud: false,
    focus: "Wet concrete: a matte grey-brown mud river down the VALLEY rather than the fall line, carrying boulders and logs. Slower than the flow, and it sets where it stops.",
    act: { force: "volcano", untilState: "active", extraSecs: 11.5 },
    cam: { lahar: true, ahead: 34, side: 22, alt: 24, fallback: { x: 62, y: 20, z: 660, ax: 0, ay: 6, az: 612 } } },

  { id: "ash-wedge", label: "The wedge — ash with an outside", hud: false,
    focus: "ASHFALL AS A VEIL. Before: a leopard print — hundreds of identical grey alpha-cutout blobs on bright green grass (the deposit quads at partial coverage). After: everything downwind goes uniformly grey through the surface coat (the same seam the blizzard whitens with), thin veil first, deepening along the wind; the quads survive only as drifts where the deposit is deep. Upwind keeps its colour on both sides — that is the wedge.",
    act: { day: true, force: "volcano", untilState: "active", extraSecs: 10, pinWind: [0.6, 0.8] },
    cam: { wedge: true, along: 0.72, side: 0.5, alt: 34, fallback: { x: 46, y: 26, z: 662, ax: 0, ay: 8, az: 600 } } },

  { id: "dark-noon", label: "Darkness at noon — the ash blots the sun", hud: false,
    focus: "Late in the event, staged at MIDDAY, shot wide from upwind. The deposit is deep downwind, the sun is choked (sunIntensity), roofs fail under the load (audit_ashRoofCollapses) — on both sides. After: the downwind island is a grey veil instead of grey spots, and the mountain under the column is black.",
    act: { day: true, force: "volcano", untilState: "active", extraSecs: 17.5, pinWind: [0.6, 0.8] },
    cam: { wedge: true, upwind: true, along: 0.55, side: 0.15, alt: 42, lookY: 40, fallback: { x: -120, y: 44, z: 540, ax: 30, ay: 40, az: 620 } } },

  { id: "lava-night", label: "Lava at night — it lights the hill", hud: false,
    focus: "The wide bible photo's regime: a BLACK cone wearing a branching incandescent fan, the lace unchanged from noon (unlit IS incandescent), the vent apron the brightest thing in frame, pooled lights painting the hillside. Both sides now stage REAL night — the old staging set the clock before stepping 40 simulated seconds and photographed dawn.",
    act: { night: true, force: "volcano", untilState: "active", extraSecs: 12 },
    /* KNOWN LIMIT, measured: the island's terrain is UNLIT material (a
       capture with sunIntensity=0 still renders bright green lawn), so
       survival night reads on the sky, the fog, the lit buildings and the
       lava's own light — never on the grass. The flank election frames the
       flow itself, which is where the night regime actually shows. */
    cam: { lava: true, frame: 0.55, out: 30, alt: 20, behind: 3, fallback: { x: 26, y: 12, z: 626, ax: 4, ay: 4, az: 606 } } },

  { id: "cooled", label: "When the eruption ends — the flow dies where it stands", hud: false,
    focus: "CONTROL. The supply stops, so the river stalls and chills BLACK in place: crusted dark rock, ember seams fading, kept on the cone as a scar. Identical quench on both sides; the strip should dim the same way in both rows.",
    act: { force: "volcano", untilState: "active", extraSecs: 21 },
    strip: { frames: 3, stepSec: 2.6 },
    cam: { lava: true, scar: true, frame: 0.5, out: 24, alt: 12, behind: 2, fallback: { x: 26, y: 12, z: 626, ax: 4, ay: 4, az: 606 } } },

  { id: "ash-aftermath", label: "The morning after — ash is weather, not wallpaper", hud: false,
    focus: "THE OWNER'S NAMED COMPLAINT: 'the ash left afterwards is like a CHECKERBOARD over the map'. Shot PLUMB DOWN over the downwind wedge ~6 s after the eruption ends. Before: a frozen lattice of same-pitch quads — every ground cell drawing a dark fleck even at zero coverage — that lies there untouched for the rest of the match. After: a continuous drifted field (jittered centres, spatially-correlated mottle, slope shedding) already thinning and streaking away on the wind. ashGridPeriodicity is the checkerboard as a number — luminance self-similarity at exactly the cell pitch; positive = periodic lattice. ashResidueDepth should FALL across the strip on the after side only.",
    act: { day: true, force: "volcano", untilState: "active", pinWind: [0.6, 0.8], untilIdle: true, extraSecs: 6 },
    strip: { frames: 3, stepSec: 2.2 },
    ashMetric: true,
    /* side: walk the tripod off the wind axis so the frame STRADDLES the
       wedge boundary — the saturated blanket on one side, the partial-coverage
       fringe on the other. The fringe is where the checkerboard lives (the
       first plumb framing sat over pure blanket and measured nothing). */
    cam: { ashfield: true, out: 0.55, side: 0.42, alt: 72, fov: 60, fallback: { x: 46, y: 80, z: 662, ax: 46, ay: 0, az: 664 } } },

  { id: "small-one", label: "A SMALL one — a burp you could stand and watch", hud: false,
    focus: "Magnitude pinned to 0.07: a short steam-and-ash burp — a ~55 m column, two narrow lava tongues near the vent, a light dusting, no pyroclastic collapse, no lahar. After: even the burp stands on its crater and its little fountain instead of floating.",
    act: { day: true, force: "volcano", untilState: "active", extraSecs: 6, pinWind: [0.7, -0.7], magPin: 0.07 },
    cam: { volcano: true, dist: 135, alt: 20, aboveVent: 34, fov: 66 } },

  { id: "the-big-one", label: "The BIG one — a column that blots the sun", hud: false,
    focus: "Magnitude pinned to 1.0 at MIDDAY: the ~190 m column. Before: a taller pencil of puffs. After: a broad convecting mass with a spreading head over a fountain, ash reaching the town as a veil, the sun visibly choked.",
    /* t+18: a column takes time to BUILD. At 11 s both sides were still mid-
       climb and photographed the same height; at 18 s the before column is
       finished (~108 m) and the after is well past it on its way to ~194. */
    act: { day: true, force: "volcano", untilState: "active", extraSecs: 18, pinWind: [0.7, -0.7], magPin: 1.0 },
    cam: { volcano: true, dist: 265, alt: 30, aboveVent: 130, fov: 66 } },

];

async function stageVolcano(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (e) { if (e && e.__baFatal) throw e; /* HARNESS TRAP: an empty catch here hid every staging failure */ }
      await wait(stepMs || 250);
    }
    return false;
  };
  const setHud = (visible) => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__volcanoOverlay") continue;
      /* #nukeFlash is HIDDEN with the rest of the HUD. The exception that
         used to live here served the deleted nuke-pov beat; with it gone,
         all it did was whitewash whichever side's healed player happened to
         be standing in the pyroclastic lane at capture time — a dark-noon
         before frame shipped at ~90% white that way. */
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__volcanoSeq;
  if (!S) {
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="survival"]'),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="survival"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    /* HARNESS TRAP: "playing" IS NOT "playing THE RIGHT WORLD". This gate used
       to stop at CBZ.game.state === "playing", which the CITY satisfies. When
       the survival click did not take, every shot below was captured in the
       city — and because the camera resolver invented a volcano when it could
       not find one (see cam.volcano), the run produced a full, confident
       receipt of a skyline with a smudge of smoke in it. The 2026-08-29
       volcano-wave-final report is 29 pages of exactly that. Prove the world
       exists before photographing it. */
    const inWorld = await until(
      () => CBZ.game.mode === "survival" && CBZ.surv && CBZ.surv.arena &&
            CBZ.surv.arena.hills && CBZ.surv.arena.hills.length > 0,
      60000, 300
    );
    if (!inWorld) {
      return { ok: false, err: "never reached the SURVIVAL world (mode=" +
        (CBZ.game && CBZ.game.mode) + ", arena=" + !!(CBZ.surv && CBZ.surv.arena) +
        ") — the volcano does not exist here, so every shot would be a lie" };
    }
    if (!CBZ.disasters || typeof CBZ.disasters.force !== "function") {
      return { ok: false, err: "no CBZ.disasters.force" };
    }
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (e) { if (e && e.__baFatal) throw e; /* HARNESS TRAP: an empty catch here hid every staging failure */ }

    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    for (let i = 0; i < 90; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    const overlay = document.createElement("div");
    overlay.id = "__volcanoOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__volcanoSeq = { overlay, dayPhase: null, tripod: null };
    window.__cbzVisualCompare = {
      /* re-aim before every harness render: a film strip's advance() steps
         the LIVE sim, whose camera controller re-follows the player — so
         without this, frame t+1 of every strip photographs the player's
         back instead of the staged tripod. */
      render() {
        try {
          const T2 = window.__volcanoSeq && window.__volcanoSeq.tripod;
          if (T2) {
            CBZ.camera.position.set(T2.x, T2.y, T2.z);
            CBZ.camera.lookAt(T2.ax, T2.ay, T2.az);
            if (typeof CBZ.skySync === "function") CBZ.skySync();
          }
          CBZ.renderer.render(CBZ.scene, CBZ.camera);
        } catch (e) { if (e && e.__baFatal) throw e; /* HARNESS TRAP: an empty catch here hid every staging failure */ }
      },
      /* the film-strip hook: step THIS page's frozen sim by stepSec so both
         sides photograph identical simulated seconds. Self-contained (this
         object outlives the stage call), so it re-implements the healed
         step loop instead of closing over it. */
      async advance(stepSec) {
        const n = Math.max(1, Math.round(stepSec * 60));
        for (let i = 0; i < n; i++) {
          CBZ.hitstop = 0; CBZ.slowmo = 0;
          CBZ.stepSim(1 / 60);
          if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
          if (CBZ.game && CBZ.game.state !== "playing") CBZ.game.state = "playing";
        }
      },
    };
  }

  const subject = input.subject;
  const act = subject.act || {};
  const heal = () => {
    if (!CBZ.player) return;
    CBZ.player.hp = 100; CBZ.player.dead = false;
    if (CBZ.player.stamina != null) CBZ.player.stamina = 100;
    /* AND PUT THE RUN BACK. Healing the player is not enough: a pyroclastic
       flow that reaches him flips CBZ.game.state out of "playing" on the same
       tick, and core/loop.js only ticks the UPDATER chain while playing — so
       the disaster director silently froze at idle and every later beat
       photographed an empty island. Restoring hp without restoring the run
       state looks like it works right up until something actually kills you. */
    if (CBZ.game && CBZ.game.state !== "playing") CBZ.game.state = "playing";
  };
  let ticks = 0, totalMs = 0, maxMs = 0, over33 = 0;
  const step = (secs) => {
    const n = Math.max(0, Math.round(secs * 60));
    for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      const t0 = performance.now();
      CBZ.stepSim(1 / 60);
      const ms = performance.now() - t0;
      ticks++; totalMs += ms;
      if (ms > maxMs) maxMs = ms;
      if (ms > 33) over33++;
      heal();
    }
  };
  const stepUntilState = (want, budgetSecs) => {
    let guard = Math.round((budgetSecs || 20) * 10);
    while (guard-- > 0 && CBZ.disasters.state() !== want) step(0.1);
  };

  // NIGHT: the lava beat only proves "it lights its surroundings" in the dark.
  // dayPhase is the engine's own clock write, so this is the same night the
  // game has, not a light rig invented for a screenshot.
  if (act.night && CBZ.dayPhase) { try { CBZ.dayPhase(0.93); } catch (e) { if (e && e.__baFatal) throw e; /* HARNESS TRAP: an empty catch here hid every staging failure */ } }
  if (act.day && CBZ.dayPhase) { try { CBZ.dayPhase(0.42); } catch (e) { if (e && e.__baFatal) throw e; /* HARNESS TRAP: an empty catch here hid every staging failure */ } }

  /* THE BODY COUNT. Read the lobby BEFORE this beat simulates anything, so
     `killedThisBeat` is the deaths those exact simulated seconds caused and
     not a running total. aliveCount() is on the deployed build too, which is
     the only reason the two sides can be compared at all here. */
  const aliveOf = () => { try { return CBZ.surv.aliveCount(); } catch (_) { return -1; } };
  const aliveBefore = aliveOf();

  /* PIN THE WIND. The eruption takes its plume bearing from the live weather
     wind when one is blowing (startEruption's windVec() branch), and the
     seeded hazard stream DIVERGES between the two sides long before the ash
     beats run — kill counts differ, quake.js draws differ, so by beat eight
     the same rnd() call hands each side a different bearing and the "same"
     wedge falls on two different towns. act.pinWind wraps CBZ.weatherWind
     with a fixed vector BEFORE the force, so both sides drop their ash — and
     lean their columns — over the same streets, and the wind-aimed tripod
     stands on the same ground in both frames. The wrap persists for the rest
     of the page on purpose: every later eruption on both sides stays pinned,
     which is the consistency the comparison needs. */
  if (act.pinWind && CBZ.weatherWind) {
    const l = Math.hypot(act.pinWind[0], act.pinWind[1]) || 1;
    window.__volcanoWindPin = { x: act.pinWind[0] / l, z: act.pinWind[1] / l, speed: 8 };
    if (!window.__volcanoWindWrapped) {
      window.__volcanoWindWrapped = true;
      const orig = CBZ.weatherWind;
      CBZ.weatherWind = () => window.__volcanoWindPin || orig();
    }
  }
  /* MAGNITUDE PIN — after-side only by construction: the before build has no
     per-eruption magnitude and never reads the global. Every volcano beat
     pins; 0.42 reproduces the historical fixed eruption (10+24*0.42 ≈ 20 s
     active, ~108 m column) so the matched control beats stay matched, and
     the two size beats override it to photograph the ends of the range. */
  if (act.force === "volcano") {
    window.__volcanoMagPin = act.magPin != null ? act.magPin : 0.42;
  }
  if (act.settleSecs) step(act.settleSecs);
  if (act.force) { CBZ.disasters.force(act.force); step(0.1); }
  if (act.untilState) stepUntilState(act.untilState, 30);
  /* the aftermath beat's clock: run the eruption OUT, whatever active length
     this build rolled for it, then let the deposit sit into the gap */
  if (act.untilIdle) { let guard = 700; while (guard-- > 0 && CBZ.disasters.state() === "active") step(0.1); }
  if (act.extraSecs) step(act.extraSecs);
  /* NIGHT, RE-ASSERTED. Setting dayPhase(0.93) up top and then stepping
     30-40 simulated seconds rolled the 150 s day clock straight past
     midnight and into the morning — every "night" beat this preset ever
     shipped was actually photographed at dawn, which is why the
     lava-lights-the-hill claim never looked like the Fuego reference. Pin
     the clock again AFTER the sim has run, and give it a couple of
     simulated seconds (not a couple of ticks: the light rig LERPS toward
     the clock, and 0.1 s photographs the lerp's starting point — midday). */
  if (act.night && CBZ.dayPhase) { try { CBZ.dayPhase(0.93); step(2.5); } catch (e) { if (e && e.__baFatal) throw e; /* HARNESS TRAP: an empty catch here hid every staging failure */ } }

  // GROUND ZERO: put the player where the front is about to arrive, so the
  // whiteout is photographed from inside the blast and not next to it.
  if (act.atGroundZero && CBZ.player && CBZ.player.pos && CBZ.player.pos.set) {
    const arena = (CBZ.SURV && CBZ.SURV.arena) || { cx: 0, cz: 600 };
    const gx = arena.cx + 6, gz = arena.cz + 6;
    const gy = CBZ.surv && CBZ.surv.arena ? CBZ.surv.arena.groundHeightAt(gx, gz) : 0;
    CBZ.player.pos.set(gx, gy + 1.2, gz);
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(CBZ.player.pos);
    step(0.25);
  }

  /* ---- THE HAZARD AIMS THE CAMERA -------------------------------------- */
  const hazards = () => { try { return CBZ.disasters.hazards() || []; } catch (_) { return []; } };
  const lineHazard = () => hazards().find((h) => h && h.line);
  const ringHazard = () => hazards().find((h) => h && !h.line && h.fill === false);
  let aimed = null, aimNote = "tripod";
  const cam = subject.cam || {};
  if (cam.ashfield) {
    /* PLUMB OVER THE WEDGE. The checkerboard is a ground pattern, and the one
       honest way to photograph a ground pattern is straight down — where the
       lattice pitch is uniform in screen pixels and can be MEASURED (the
       ashGridPeriodicity metric below depends on this framing). Near-plumb:
       the aim point is nudged 2 m so lookAt's default up-vector never
       degenerates. */
    try {
      const arena = (CBZ.surv && CBZ.surv.arena) || null;
      const hill = arena && arena.hills ? arena.hills[0] : { x: 0, z: 600 };
      const Rw = (arena && (arena.radius || arena.R)) || 120;
      const wp = window.__volcanoWindPin || { x: 0.6, z: 0.8 };
      const wl = Math.hypot(wp.x, wp.z) || 1;
      const out = cam.out != null ? cam.out : 0.5;
      const sideK = cam.side || 0;
      const cxp = hill.x + (wp.x / wl) * Rw * out + (-wp.z / wl) * Rw * sideK;
      const czp = hill.z + (wp.z / wl) * Rw * out + (wp.x / wl) * Rw * sideK;
      const gy = arena ? arena.groundHeightAt(cxp, czp) : 0;
      aimed = { x: cxp, y: gy + (cam.alt || 72), z: czp, ax: cxp, ay: gy, az: czp + 2 };
      aimNote = "plumb over the wedge";
    } catch (e) { if (e && e.__baFatal) throw e; /* HARNESS TRAP: an empty catch here hid every staging failure */ }
  } else if (cam.volcano) {
    /* REFERENCE FRAMING: the cone is the subject, not a tiny prop behind the
       skyline. Stand just offshore and elect the first compass bearing with a
       clear ray to the crater, so the mountain fills the lower frame while
       the plume owns the sky. Same election on both sides; no smoke object is
       considered a blocker. */
    try {
      /* HARNESS TRAP: never invent the subject. This read used to fall back to a
         hardcoded { x: 0, z: 600, peak: 26 } — a mountain that exists nowhere —
         so a camera asked to stand 62 m off the vent stood 62 m off NOTHING and
         photographed whatever happened to be there. A missing arena is a failed
         stage, not a default coordinate. */
      const hill = (CBZ.surv && CBZ.surv.arena && CBZ.surv.arena.hills) ? CBZ.surv.arena.hills[0] : null;
      if (!hill) throw Object.assign(new Error("no survival arena: there is no volcano to aim at"), { __baFatal: true });
      const gAtV = (x, z) => (CBZ.surv && CBZ.surv.arena ? CBZ.surv.arena.groundHeightAt(x, z) : 0);
      const solids = [];
      CBZ.scene.traverse((ob) => {
        if (ob.isMesh && ob.visible && !(ob.userData && ob.userData.waterSurface)) solids.push(ob);
      });
      const ray = new T.Raycaster();
      const vent = new T.Vector3(hill.x, hill.peak + 3, hill.z);
      const clearRay = (px, py, pz, target) => {
        const origin = new T.Vector3(px, py, pz);
        const dir = target.clone().sub(origin), len = dir.length() || 1;
        dir.multiplyScalar(1 / len); ray.set(origin, dir); ray.near = 0.1; ray.far = Math.max(0.2, len - 10);
        try { return ray.intersectObjects(solids, false).length === 0; } catch (_) { return false; }
      };
      const dist = cam.dist || 140, alt = cam.alt || 20;
      const baseA = cam.angle != null ? cam.angle : -Math.PI * 0.5;
      const angles = [];
      for (let i = 0; i < 16; i++) angles.push(baseA + i * Math.PI * 0.125);
      /* HARNESS TRAP: THE ELECTION USED TO ELECT A BLOCKED BEARING. `pick` was
         seeded with the FIRST candidate unconditionally (`if (!pick) pick =
         ...`), so when all sixteen bearings were blocked the loop simply ended
         and the camera shot from a blocked one anyway — standing behind the
         island's towers, aiming at a crater it could not see. The whole 29-page
         volcano-wave-final report was captured that way: correct sim, real
         metrics, and a photograph of a skyline with a smudge in it. A camera
         that cannot see its subject is a FAILED stage, not a default.

         It also only ever tried ONE distance. The vent is ~26 m of hill under a
         190 m column, so at the close framings the towers win every bearing.
         Back off and climb until the crater and both shoulders are clear. */
      /* NOTE (2026-08-30): a frustum-coverage score lived here briefly and was
         WRONG — it capped ray.far at the distance to the cone, so it only ever
         counted things BETWEEN the camera and the vent. The towers that fill
         the close beats are BEYOND the cone: they are the island's skyline in
         the background of a 72-degree lens at 62 m, not occluders. Nothing is
         blocked, so no occlusion test can fix those framings. What they need
         is composition — a tighter fov or a higher angle that puts the cone
         and its plume against sky. Left undone: unverifiable at load 134. */
      let pick = null, picked = null;
      const rings = [[dist, alt], [dist * 1.6, alt + 14], [dist * 2.4, alt + 34],
                     [dist * 3.4, alt + 62], [dist * 4.6, alt + 96]];
      for (const [d, y0] of rings) {
        for (const a of angles) {
          const px = hill.x + Math.cos(a) * d, pz = hill.z + Math.sin(a) * d;
          const py = Math.max(0, gAtV(px, pz)) + y0;
          // Crater plus both shoulders: a tower beside the vent is still a bad
          // volcano portrait even when the one centre ray technically lands.
          const vx = Math.cos(a), vz = Math.sin(a), sx = -vz, sz = vx;
          const shoulder = (hill.r || 36) * 0.68;
          const left = new T.Vector3(hill.x + sx * shoulder, 8, hill.z + sz * shoulder);
          const right = new T.Vector3(hill.x - sx * shoulder, 8, hill.z - sz * shoulder);
          /* THE COLUMN IS THE SUBJECT, SO TEST THE COLUMN. Electing on the
             crater and its shoulders alone passed a bearing with a tower
             standing straight through the plume — which is the one thing a
             shot called "the silhouette" exists to show. Sample the aim point
             and two heights up the column as well. */
          const aimY = hill.peak + (cam.aboveVent != null ? cam.aboveVent : 48);
          const colA = new T.Vector3(hill.x, aimY, hill.z);
          const colB = new T.Vector3(hill.x, hill.peak + (aimY - hill.peak) * 0.5, hill.z);
          if (clearRay(px, py, pz, vent) && clearRay(px, py, pz, left) && clearRay(px, py, pz, right) &&
              clearRay(px, py, pz, colA) && clearRay(px, py, pz, colB)) {
            pick = { x: px, y: py, z: pz };
            picked = { d: Math.round(d), alt: Math.round(y0), bearing: Math.round(a * 57.3) };
            break;
          }
        }
        if (pick) break;
      }
      if (!pick) {
        throw Object.assign(new Error(
          "no clear bearing to the crater at any of " + rings.length +
          " distances (" + Math.round(dist) + "-" + Math.round(dist * 4.6) +
          " m): every angle is blocked, so this shot would photograph a wall"),
          { __baFatal: true });
      }
      aimed = {
        x: pick.x, y: pick.y, z: pick.z,
        ax: hill.x, ay: hill.peak + (cam.aboveVent != null ? cam.aboveVent : 48), az: hill.z,
      };
      aimNote = "offshore volcano @ " + picked.d + "m/" + picked.alt + "m";
    } catch (e) { if (e && e.__baFatal) throw e; /* HARNESS TRAP: an empty catch here hid every staging failure */ }
  } else if (cam.lane || cam.lahar) {
    const H = cam.lane ? lineHazard() : (ringHazard() || lineHazard());
    if (H) {
      const dx = H.dx != null ? H.dx : 1, dz = H.dz != null ? H.dz : 0;
      const px = -dz, pz = dx;
      /* STAND IN FRONT OF IT AND LOOK BACK. A flank shot of a density current
         is a picture of a hillside with something beside it; the shot that
         says what the hazard IS is the one from the town it is about to
         reach, looking back up the lane at the oncoming front. `ahead` walks
         the camera down-lane, `side` offsets it enough to see the flank, and
         it is lifted clear of the rooftops so it stops landing inside a
         tower (it did, once, and photographed a stairwell). */
      const ahead = cam.ahead != null ? cam.ahead : -(cam.back || 20);
      const cxp = H.x + dx * ahead + px * (cam.side || 60);
      const czp = H.z + dz * ahead + pz * (cam.side || 60);
      const gy = CBZ.surv && CBZ.surv.arena ? CBZ.surv.arena.groundHeightAt(cxp, czp) : 0;
      aimed = {
        x: cxp, y: gy + (cam.alt || 25), z: czp,
        ax: H.x, ay: (CBZ.surv && CBZ.surv.arena ? CBZ.surv.arena.groundHeightAt(H.x, H.z) : 0) + 7, az: H.z,
      };
      aimNote = cam.lane ? "flow front" : "mud head";
    }
  } else if (cam.lava) {
    // THE FLOW TELLS THE CAMERA WHERE IT IS. volcanoAudit publishes the live
    // fronts and their axes; frame the one that has run furthest.
    try {
      const A = CBZ.volcanoAudit ? CBZ.volcanoAudit() : null;
      let tips = (A && A.lavaTips) || [];
      let mids = (A && A.lavaMids) || [];
      /* cam.scar: the post-eruption beat's subject is the QUENCHED flow, and
         the audit deliberately excludes quenched noses from lavaTips (live
         cameras must not frame dead rock). On a build with no quench at all
         the scar arrays are absent, tips stay empty, and the beat drops to
         its fallback tripod — which photographs the bare cone the old
         behaviour actually leaves. */
      if (cam.scar && A && A.lavaScarTips && A.lavaScarTips.length) {
        tips = A.lavaScarTips; mids = A.lavaScarMids || mids;
      }
      const hill = (CBZ.surv && CBZ.surv.arena && CBZ.surv.arena.hills) ? CBZ.surv.arena.hills[0] : null;
      if (!hill) throw Object.assign(new Error("no survival arena: there is no volcano to aim at"), { __baFatal: true });   // HARNESS TRAP: see cam.volcano
      /* PREFER A FLOW STILL ON THE CONE. "Furthest tip from the hill" used
         to be the whole rule, and once the flows learned to branch and run
         long it reliably elected a nose deep in the town — where the tripod
         maths landed the camera inside somebody's stairwell (again). The
         braid the shot exists to judge lives on the mountainside, so among
         tips still within ~1.7 r of the peak take the furthest-run one, and
         only fall back to the global winner when nothing is on the cone. */
      /* 1.25 r, not more: the arena's town starts ~1.4 r out, and a radius
         that reaches the town elects some flow's cold toe next to a road —
         the night peek framed an ash-dusted street with the lava reduced to
         orange crumbs at the margin. The braid lives on the flank. */
      const onR = (hill.r || 30) * 1.25;
      let best = null, bd = -1, bi = -1, bdOn = -1, biOn = -1;
      for (let i = 0; i < tips.length; i++) {
        const d = Math.hypot(tips[i].x - hill.x, tips[i].z - hill.z);
        if (d > bd) { bd = d; best = tips[i]; bi = i; }
        if (d <= onR && d > bdOn) { bdOn = d; biOn = i; }
      }
      if (biOn >= 0) { best = tips[biOn]; bi = biOn; }
      const mid = bi >= 0 ? mids[bi] : null;
      if (best && mid) {
        /* TWO POINTS ON THE FLOW BEAT ONE POINT AND A GUESS.

           Three tripods failed here before this one. The last of them framed
           the ribbon as the straight line from the vent to its toe — which is
           right only for a flow that never turned, and a fall line's whole
           job is to turn. On a cone that shoulders away under it, the point
           "55% of the way from the vent to the tip" sits out on open
           hillside with the actual lava thirty metres to one side, which is
           precisely what the last set of shots photographed.

           world/volcanofx.js now publishes `lavaMids` beside `lavaTips`, so
           the axis is measured off two points that are both ON the flow.
           `frame` slides the look-at from the middle of the river (0) to its
           advancing nose (1), and the camera stands square to that axis. */
        let fx = best.x - mid.x, fz = best.z - mid.z;
        const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
        const f = cam.frame != null ? cam.frame : 0.2;
        const mx = mid.x + (best.x - mid.x) * f, mz = mid.z + (best.z - mid.z) * f;
        const gAtP = (x, z) => (CBZ.surv && CBZ.surv.arena ? CBZ.surv.arena.groundHeightAt(x, z) : 0);
        const my = gAtP(mx, mz);
        const out = cam.out != null ? cam.out : 24;
        /* THE TRIPOD PROVES ITS OWN SIGHTLINE. Every blind placement rule
           tried here has been defeated by some seed's town: the fixed sign
           parked the camera against the cone, the away-from-the-mountain
           flip parked it inside a tower, and a photograph of an obstruction
           is a failed beat that reports ok:true. So the flank is chosen the
           way a photographer chooses it: candidate stands (near/far, both
           sides, rising altitude) are tested with a real raycast at the
           look-at point, and the first stand that can actually SEE the flow
           wins. Sprites, particle motes and water do not count as walls; a
           hit within 6 m of the subject IS the subject. Identical logic on
           both sides of the comparison — it is pure scene geometry. */
        /* Solids collected ONCE with the sprite/particle/water strata already
           filtered out. Handing intersectObjects the raw scene children found
           two failure modes at once: any exotic object that made the walk
           throw turned the try/catch into "sure, that stand can see", and a
           blocked tripod passed the audition — the full-run day beat shipped
           a portrait of an office block that way. */
        const solids = [];
        CBZ.scene.traverse((ob) => {
          if (ob.isMesh && ob.visible && !(ob.userData && ob.userData.waterSurface)) solids.push(ob);
        });
        const ray = new T.Raycaster();
        const canSee = (px, py, pz) => {
          const dir = new T.Vector3(mx - px, my + 1.2 - py, mz - pz);
          const len = dir.length() || 1;
          dir.multiplyScalar(1 / len);
          ray.set(new T.Vector3(px, py, pz), dir);
          ray.near = 0.1; ray.far = Math.max(0.2, len - 6);   // the last 6 m IS the subject
          try { return ray.intersectObjects(solids, false).length === 0; }
          catch (_) { return false; }                          // a stand that cannot be proved is not chosen
        };
        const c1x = mx - fz * out, c1z = mz + fx * out;
        const c2x = mx + fz * out, c2z = mz - fx * out;
        const away = Math.hypot(c2x - hill.x, c2z - hill.z) > Math.hypot(c1x - hill.x, c1z - hill.z) ? 1 : -1;
        const alt0 = cam.alt || 12;
        /* the ladder climbs: same-side near, other side, then higher and
           further on both sides. If every rung is blocked the HIGHEST stand
           wins — over the rooftops beats behind a wall every time. */
        const rungs = [
          [away, 1, 1], [-away, 1, 1], [away, 1.45, 1.9], [-away, 1.45, 1.9],
          [away, 2, 3.1], [-away, 2, 3.1],
        ];
        let cxp = null, czp = null, cyp = 0;
        for (const [flip, oMul, aMul] of rungs) {
          const tx = mx + flip * fz * out * oMul - fx * (cam.behind || 0);
          const tz = mz - flip * fx * out * oMul - fz * (cam.behind || 0);
          const ty = Math.max(gAtP(tx, tz), my) + alt0 * aMul;
          cxp = tx; czp = tz; cyp = ty;                        // fallback: the last (highest) rung
          if (canSee(tx, ty, tz)) break;
        }
        aimed = { x: cxp, y: cyp, z: czp, ax: mx, ay: my + 1.2, az: mz };
        aimNote = "lava flank";
      }
    } catch (e) { if (e && e.__baFatal) throw e; /* HARNESS TRAP: an empty catch here hid every staging failure */ }
  } else if (cam.wedge) {
    /* THE WIND AIMS THE CAMERA. The ash wedge has no hazards() entry — it is
       ground, not a front — but its axis IS the weather's wind vector, which
       both sides drove identically from the same seed during warn. Stand
       down-wind (or up-wind with cam.upwind, for the wide darkness shot),
       offset sideways so the mountain and the wedge share the frame, and
       look at the mid-wedge ground. On the before side the identical tripod
       photographs the same ground staying green, which is the comparison. */
    try {
      const hill = (CBZ.surv && CBZ.surv.arena && CBZ.surv.arena.hills) ? CBZ.surv.arena.hills[0] : null;
      if (!hill) throw Object.assign(new Error("no survival arena: there is no volcano to aim at"), { __baFatal: true });   // HARNESS TRAP: see cam.volcano
      const R = (CBZ.SURV && CBZ.SURV.arena && CBZ.SURV.arena.radius) || 120;
      const w = CBZ.weatherWind ? CBZ.weatherWind() : null;
      let wx = 1, wz = 0;
      if (w && Math.hypot(w.x || 0, w.z || 0) > 0.01) {
        const l = Math.hypot(w.x, w.z); wx = w.x / l; wz = w.z / l;
      }
      const sgn = cam.upwind ? -1 : 1;
      const px = -wz, pz = wx;
      const dist = R * (cam.along != null ? cam.along : 0.7);
      const sx = hill.x + sgn * wx * dist + px * R * (cam.side != null ? cam.side : 0.35);
      const sz = hill.z + sgn * wz * dist + pz * R * (cam.side != null ? cam.side : 0.35);
      const gAtW = (x, z) => (CBZ.surv && CBZ.surv.arena ? CBZ.surv.arena.groundHeightAt(x, z) : 0);
      const lx = hill.x + wx * R * 0.4, lz = hill.z + wz * R * 0.4;
      aimed = {
        x: sx, y: Math.max(gAtW(sx, sz), 0) + (cam.alt || 30), z: sz,
        // lookY tilts the frame up so a tall column can share it with the
        // ground — the dark-noon beat's subject is BOTH at once
        ax: lx, ay: gAtW(lx, lz) + (cam.lookY != null ? cam.lookY : 6), az: lz,
      };
      aimNote = cam.upwind ? "upwind wide" : "downwind wedge";
    } catch (e) { if (e && e.__baFatal) throw e; /* HARNESS TRAP: an empty catch here hid every staging failure */ }
  }
  if (!aimed && cam.fallback) { aimed = cam.fallback; aimNote = "fallback tripod"; }
  if (act.needLine && !lineHazard()) {
    return { ok: false, err: "no travelling front published — nothing to photograph", state: CBZ.disasters.state() };
  }

  setHud(true);
  void document.documentElement.offsetHeight;

  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = cam.fov || 55;
  camera.near = 0.5;
  // NOTE: `far` is deliberately NOT forced here. The finale's frustum is the
  // thing under test — src/systems/disasters.js widens it off the live cloud's
  // own reported size, and a preset that overrode it would photograph a fix
  // that is not in the build.
  if (cam.player && CBZ.player && CBZ.player.pos) {
    const p = CBZ.player.pos;
    camera.position.set(p.x, p.y + (cam.up || 3), p.z + (cam.back || 8));
    camera.lookAt(p.x, p.y + 1.2, p.z - 6);
  } else if (aimed) {
    camera.position.set(aimed.x, aimed.y, aimed.z);
    camera.lookAt(aimed.ax, aimed.ay, aimed.az);
  } else {
    camera.position.set(cam.x, cam.y, cam.z);
    camera.lookAt(cam.ax, cam.ay, cam.az);
  }
  camera.updateProjectionMatrix();
  // remember the tripod for the strip re-aim in render() above; the
  // player-follow framing deliberately stays live (it is ABOUT the player)
  S.tripod = null;
  if (!(cam.player && CBZ.player && CBZ.player.pos)) {
    S.tripod = aimed
      ? { x: aimed.x, y: aimed.y, z: aimed.z, ax: aimed.ax, ay: aimed.ay, az: aimed.az }
      : { x: cam.x, y: cam.y, z: cam.z, ax: cam.ax, ay: cam.ay, az: cam.az };
  }
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
    if (skyRig && skyRig.position) skyRig.position.set(camera.position.x, 0, camera.position.z);
  }
  if (!subject.hud) setHud(false);
  /* NIGHT, PINNED AS THE LAST ACT. The mid-stage re-assert above proved
     insufficient in real harness runs — the capture still photographed
     daylight while dayPhase read 0.947 — so the pin is repeated here as the
     final thing before the render the harness will flush. The metrics
     record sunInt/fog below, so a capture whose picture disagrees with its
     own staged lighting can be caught by number instead of by squint. */
  if (act.night && CBZ.dayPhase) { try { CBZ.dayPhase(0.93); step(0.5); } catch (e) { if (e && e.__baFatal) throw e; /* HARNESS TRAP: an empty catch here hid every staging failure */ } }
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const render = (CBZ.renderer.info && CBZ.renderer.info.render) || {};

  /* THE CHECKERBOARD AS A NUMBER. Same-task readback (drawImage right after
     render needs no preserveDrawingBuffer): downsample the central square of
     the frame, then compare mean |ΔL| at HALF the ash-cell pitch against
     mean |ΔL| at the FULL pitch, along both screen axes. A periodic lattice
     repeats at its own pitch, so D(pitch) < D(pitch/2) and the score goes
     positive; a continuous drifted deposit scores ~0 or negative. Only the
     plumb aftermath beat computes it — the pitch is only uniform plumb. */
  let ashGrid = null, ashResidue = null, ashFlecks = null;
  if (subject.ashMetric) {
    try {
      const A0 = CBZ.volcanoAudit ? CBZ.volcanoAudit() : null;
      if (A0) ashResidue = Number((+A0.ashPeakDepth || 0).toFixed(3));
      const srcC = CBZ.renderer.domElement;
      const sideC = Math.min(srcC.width, srcC.height);
      const N = 340;
      const cnv = document.createElement("canvas"); cnv.width = N; cnv.height = N;
      const c2 = cnv.getContext("2d");
      c2.drawImage(srcC, (srcC.width - sideC) / 2, (srcC.height - sideC) / 2, sideC, sideC, 0, 0, N, N);
      const img = c2.getImageData(0, 0, N, N).data;
      const L = new Float32Array(N * N);
      for (let i = 0; i < N * N; i++) L[i] = 0.299 * img[i * 4] + 0.587 * img[i * 4 + 1] + 0.114 * img[i * 4 + 2];
      // the ash cell pitch in analysis pixels: cell count off the audit, the
      // frame's world height off the plumb camera's own alt + fov
      const arena = (CBZ.surv && CBZ.surv.arena) || null;
      const Rw = (arena && (arena.radius || arena.R)) || 120;
      // ashCells sums across every stacked field (older eruptions persist as
      // scars) — divide by ashFields for ONE field's cell count first
      const cellsPer = A0 && A0.ashCells > 8 ? A0.ashCells / Math.max(1, A0.ashFields || 1) : 0;
      const NC = cellsPer > 8 ? Math.round(Math.sqrt(cellsPer * 4 / Math.PI)) : 72;
      const cellWorld = (2 * Rw) / Math.max(6, NC);
      const altV = (subject.cam && subject.cam.alt) || 72;
      const worldH = 2 * altV * Math.tan(((camera.fov || 60) * Math.PI / 180) / 2);
      const pitch = Math.max(4, Math.round(cellWorld * (N / worldH)));
      const D = (k) => {
        let s = 0, n = 0;
        for (let y = 0; y < N; y++) for (let x = 0; x + k < N; x++) { s += Math.abs(L[y * N + x] - L[y * N + x + k]); n++; }
        for (let y = 0; y + k < N; y++) for (let x = 0; x < N; x++) { s += Math.abs(L[y * N + x] - L[(y + k) * N + x]); n++; }
        return s / Math.max(1, n);
      };
      const dHalf = D(Math.max(2, Math.round(pitch / 2))), dFull = D(pitch);
      ashGrid = Number((100 * (dHalf - dFull) / Math.max(dHalf, 1e-3)).toFixed(1));
      /* AND COUNT THE FLECKS — the checkerboard dots themselves: connected
         grey components of 3..260 analysis-px. The town's own greys (roads,
         roofs) render identically on both sides, so the between-side DELTA
         is the ash's isolated-patch count. A frozen leopard field scores in
         the hundreds; welded drifts and eroded streaks score far fewer. */
      const isGrey = (i) => {
        const r = img[i * 4], g = img[i * 4 + 1], b = img[i * 4 + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        return (mx - mn) < 26 && mx > 92 && mx < 235 && !(g > r + 14);
      };
      const lab = new Uint8Array(N * N);
      const stack = [];
      let comps = 0;
      for (let p0 = 0; p0 < N * N; p0++) {
        if (lab[p0] || !isGrey(p0)) continue;
        let area = 0; lab[p0] = 1; stack.push(p0);
        while (stack.length) {
          const p = stack.pop(); area++;
          const px2 = p % N;
          if (px2 > 0 && !lab[p - 1] && isGrey(p - 1)) { lab[p - 1] = 1; stack.push(p - 1); }
          if (px2 < N - 1 && !lab[p + 1] && isGrey(p + 1)) { lab[p + 1] = 1; stack.push(p + 1); }
          if (p >= N && !lab[p - N] && isGrey(p - N)) { lab[p - N] = 1; stack.push(p - N); }
          if (p < N * N - N && !lab[p + N] && isGrey(p + N)) { lab[p + N] = 1; stack.push(p + N); }
        }
        if (area >= 3 && area <= 260) comps++;
      }
      ashFlecks = comps;
    } catch (e) { if (e && e.__baFatal) throw e; /* HARNESS TRAP: an empty catch here hid every staging failure */ }
  }

  const before = input.side === "before";
  const query = (name) => S.overlay.querySelector(`[data-${name}]`);
  query("side").textContent = before ? input.beforeLabel : input.afterLabel;
  query("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  query("name").textContent = subject.label;
  query("name").style.cssText = "position:absolute;top:202px;left:26px;font-size:21px;font-weight:800;line-height:1.08;letter-spacing:-.02em;max-width:430px";
  query("focus").textContent = `${CBZ.disasters.current() || "—"} · ${CBZ.disasters.state()} · cam ${aimNote} · far ${Math.round(camera.far)}`;
  query("focus").style.cssText = "position:absolute;top:266px;left:27px;color:#c0cfda;font-size:12px;font-weight:550";

  let vol = null, dis = null;
  try { vol = CBZ.volcanoAudit ? CBZ.volcanoAudit() : null; } catch (e) { if (e && e.__baFatal) throw e; /* HARNESS TRAP: an empty catch here hid every staging failure */ }
  try { dis = CBZ.disasterAudit ? CBZ.disasterAudit() : null; } catch (e) { if (e && e.__baFatal) throw e; /* HARNESS TRAP: an empty catch here hid every staging failure */ }

  query("perf").textContent = ticks
    ? `sim ${ticks} ticks · avg ${(totalMs / ticks).toFixed(1)}ms · worst ${maxMs.toFixed(0)}ms\n` +
      `lava ${vol ? vol.lavaFlows : "-"} flows / ${vol ? vol.lavaTransparent : "-"} see-thru · pyro ${dis ? dis.pyroRuns : "-"} · lahar ${dis ? dis.laharRuns : "-"}\n` +
      `ash ${vol ? vol.ashPeakDepth : "-"} m · roofs ${dis ? dis.ashRoofs : "-"} @ ${dis ? dis.ashRoofMax : "-"} m · lost ${dis ? dis.ashRoofCollapses : "-"}`
    : "—";
  query("perf").style.cssText = `position:absolute;right:24px;top:24px;text-align:right;white-space:pre-line;line-height:1.5;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:${maxMs > 100 ? "#ff9c9c" : "#9fe8c3"}`;
  query("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  query("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  const aliveNow = aliveOf();
  // the sky clock and the LIGHTS at capture — the numbers that catch "night
  // was actually dawn" without anyone having to squint at a thumbnail
  let dph = -1, sunNow = -1;
  try { dph = Number(CBZ.dayPhase().toFixed(3)); } catch (e) { if (e && e.__baFatal) throw e; /* HARNESS TRAP: an empty catch here hid every staging failure */ }
  try { sunNow = Number(CBZ.sun.intensity.toFixed(3)); } catch (e) { if (e && e.__baFatal) throw e; /* HARNESS TRAP: an empty catch here hid every staging failure */ }
  const metrics = {
    dayPhase: dph,
    sunIntensity: sunNow,
    tickAvgMs: ticks ? Number((totalMs / ticks).toFixed(2)) : 0,
    tickMaxMs: Number(maxMs.toFixed(1)),
    ticksOver33: over33,
    drawCalls: Number(render.calls || 0),
    cameraFar: Math.round(camera.far),
    aliveNow: aliveNow,
    killedThisBeat: Math.max(0, aliveBefore - aliveNow),
  };
  if (ashGrid != null) metrics.ashGridPeriodicity = ashGrid;
  if (ashResidue != null) metrics.ashResidueDepth = ashResidue;
  if (ashFlecks != null) metrics.ashFleckCount = ashFlecks;
  const carry = (obj, prefix) => {
    if (!obj) return;
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (typeof v === "boolean") metrics[prefix + key] = v ? 1 : 0;
      else if (Number.isFinite(Number(v))) metrics[prefix + key] = Number(v);
    }
  };
  carry(vol, "vol_");
  carry(dis, "audit_");

  return {
    ok: true,
    disaster: CBZ.disasters.current(),
    state: CBZ.disasters.state(),
    metrics,
  };
}

export default {
  id: "volcano-stages",
  title: "The Stratovolcano",
  description: "Tree-vs-tree on the shipped disaster.html: HEAD (a white pyramid, gold plastic lava, a pencil of smoke floating over confetti, leopard-print ash) against the stratovolcano wave (a dark gullied cone with a crater, dark crust with an incandescent lace, a broad soot column standing on a fountain of fire, ashfall as a downwind veil). Same seeded eruptions, same pinned wind and magnitude on both sides.",
  defaultBefore: "local",
  /* beforeParams used to pin cfg_VOLCANO_PLUME_V2=0 — the 2026-08-26 plume
     wave's flag A/B. That earn-back shipped; the preset is back to a plain
     tree-vs-tree comparison (flagless waves: HEAD worktree as --before). */
  beforeLabel: "BEFORE · HEAD b0566c8",
  afterLabel: "AFTER · THE STRATOVOLCANO WAVE",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  /* THE SHIPPED PAGE, NOT THE HUB. index.html builds the gang city before the
     survival island, and the island sits INSIDE the city's coordinates — so
     every volcano report since 2026-08-29 photographed skyscrapers standing on
     the island (the "29 pages of skyline" trap above was only the worst case).
     disaster.html is the App Store page: it opens on the island and never
     builds the city. Regenerate it with `node tools/build-disaster-page.mjs`
     before shooting — it is generated from index.html and goes stale. */
  page: "disaster.html",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metricsNote: "vol_* comes from CBZ.volcanoAudit() (world/volcanofx.js) and audit_* from CBZ.disasterAudit(). lavaTransparent counts LIVE lava materials that are transparent or additively blended — the thing the owner could see through. Only the rows named below are printed; the full audit dump stays in metadata.json for debugging.",
  metricsWhitelist: true,
  metrics: {
    /* THE OWNER'S SECOND COMPLAINT AS A NUMBER. A stratovolcano is supposed to
       be survivable by getting off its side; "kills way too many people" means
       the lobby is being deleted by hazards nobody could read or dodge. Lower
       is better here for the same reason higher is better for pyroRuns — the
       hazard should still HAPPEN, it just should not be a lottery. */
    killedThisBeat: { label: "Bots killed in this beat", better: "lower" },
    aliveNow: { label: "Lobby still alive", better: "higher" },
    vol_lavaTransparent: { label: "See-through lava materials", better: "lower" },
    vol_lavaFlows: { label: "Live lava flows", better: "higher" },
    /* The 2026-08-15 bible as numbers: a stem that forks is organic, a vent
       that floods white is the photograph's brightest pixel. Both are 0 on
       any build older than the bible. */
    vol_lavaBranches: { label: "Lava forks grown", better: "higher" },
    vol_lavaScars: { label: "Cooled flows kept as scars", better: "higher" },
    vol_ventGlows: { label: "Incandescent vent aprons", better: "higher" },
    vol_ashColumns: { label: "Sprite ash columns", better: "higher" },
    vol_columnPuffs: { label: "Overlapping plume puffs", better: "higher" },
    vol_fountains: { label: "Lava fountains (ballistic clots)", better: "higher" },
    vol_fountainClots: { label: "Fountain clots in flight", better: "higher" },
    vol_pyroLive: { label: "Pyroclastic flows live", better: "higher" },
    /* V3 brings the ash LEDGER back as a downwind wedge (see the flag note
       in world/volcanofx.js), so depth is a feature again — on the axis,
       where the wedge is, never map-wide. The roof-collapse row returns
       with the mechanic: roofs failing under load inside one event is the
       indoors-tension the 2026-08-16 removal threw out with the blanket. */
    vol_ashPeakDepth: { label: "Downwind ash deposited", unit: "m", better: "higher" },
    /* THE OWNER'S NAMED COMPLAINT AS NUMBERS (aftermath beat only). Lattice
       periodicity: luminance self-similarity at exactly the deposit's cell
       pitch, plumb-down — positive means the ground repeats at grid pitch,
       i.e. a checkerboard. Residue: ash still standing after the event ends —
       it must thin away like snow, not lie there for the rest of the match. */
    ashGridPeriodicity: { label: "Ash checkerboard (lattice periodicity)", better: "lower" },
    ashFleckCount: { label: "Isolated grey flecks (checkerboard dots)", better: "lower" },
    ashResidueDepth: { label: "Ash left after the event", unit: "m", better: "lower" },
    audit_ashRoofCollapses: { label: "Roofs lost to ash load", better: "higher" },
    sunIntensity: { label: "Sun at capture (ash blots it)", better: "lower" },
    audit_pyroRuns: { label: "Pyroclastic runs", better: "higher" },
    audit_laharRuns: { label: "Lahar runs", better: "higher" },
    tickAvgMs: { label: "Sim tick avg", unit: "ms", better: "lower" },
    tickMaxMs: { label: "Sim tick worst", unit: "ms", better: "lower" },
    drawCalls: { label: "Draw calls", better: "lower" },
  },
  subjects,
  stage: stageVolcano,
};

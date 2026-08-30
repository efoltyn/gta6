/* THE STRATOVOLCANO storyboard for tools/visual-compare.mjs.

   Boots the REAL survival mode (title → Disaster Survival → Play), freezes
   the rAF loop, forces the director to the volcano, and photographs the same
   simulated seconds of the same seeded eruption on both sides.

   HEAD vs WORKING TREE AS OF 2026-08-30 (the ash-removal wave). There is no
   flag to flip any more, because the thing under test was DELETED rather than
   switched off: `node tools/ba-head.mjs volcano-stages` serves pristine HEAD
   as the before column and this checkout as the after one. Run it that way or
   the before column is the deployed build, which is honest but forty commits
   wide.

   WHAT THE ASH BEATS NOW ARGUE. For four waves the ground ash deposit was the
   thing being defended: bigger cells, an eroded alpha cutout, jittered
   centres, smooth value-noise mottle, a downwind wedge instead of an island-
   wide blanket. The owner rejected every one of them on sight, in the same
   words each time, ending 2026-08-30: "these ash checkers cover the whole
   ground of the world. It's so stupid." So the deposit is gone, and these
   beats exist to photograph its absence — the mountain still erupting, the
   column still standing, the lava and the flow and the mud all untouched,
   and the GROUND still being the ground.

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
     ash-onset    PLUMB DOWN a few seconds in — the exact moment the owner
                  named ("literally right when the volcano starts"). Before:
                  the lattice arrives. After: grass.
     lava-night   close-up. Opaque crust, incandescent channels, and the flow
                  lighting the hillside at night.

   Metrics ride the two ratchets: CBZ.volcanoAudit() (lavaTransparent MUST be
   0 — that is the owner's "see thru" complaint as a number) and
   CBZ.disasterAudit() (pyroRuns / laharRuns). The ash rows are now a DELETION
   ratchet: ashFields / ashCells / ashPeakDepth are pinned at 0 in the audit,
   so a future build that quietly reinstates ground ash shows up as a number
   that stopped being zero. The pixel metrics below do not trust the audit at
   all — they measure the photograph.

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
  { id: "warn-lane", label: "Warning — the lane announces itself", hud: false,
    focus: "CONTROL. The warn telegraph is untouched by V3: crater glow, rock trickling down the corridor the flow will take, the crowd clearing it. The two sides must be near-identical — drift here is a regression.",
    act: { force: "volcano", untilState: "warn", extraSecs: 4.2 },
    cam: { lane: true, ahead: 60, side: 26, alt: 26, fallback: { x: 108, y: 46, z: 672, ax: 0, ay: 20, az: 600 } } },

  { id: "column-young", label: "The young plume — smoke is born at the vent", hud: false,
    focus: "At t+2.4 s the plume must grow continuously out of the hot throat. Before: separated opaque coins. After: small hot RPG-style billows overlap into a dark core, cool to soot and travel upward—no fixed seats and no bouncing.",
    act: { force: "volcano", untilState: "active", extraSecs: 2.4, pinWind: [0.7, -0.7] },
    cam: { volcano: true, dist: 62, alt: 10, aboveVent: 38, fov: 72 } },

  { id: "column", label: "The mature eruption column — the silhouette", hud: false,
    focus: "The matched wide read at t+8 s. Before is the current seven-cone-height bead chain. After must be a shorter, broader, continuous soot volume with a turbulent cauliflower crown and the same pinned wind lean.",
    /* force: this beat used to inherit whatever disaster the director
       happened to be on — run alone (`--subjects column`) it photographed a
       LIGHTNING STORM and reported ok:true, the exact order-dependence the
       header note above forbids. */
    /* pinWind perpendicular to the tripod's sightline, so the column leans
       in PROFILE — a lean toward or away from the lens reads as nothing. */
    act: { force: "volcano", untilState: "active", extraSecs: 8, pinWind: [0.7, -0.7] },
    /* Wide enough to hold the old oversized head and the new landscape-scale
       plume in one locked frame. */
    cam: { volcano: true, dist: 172, alt: 25, aboveVent: 70, fov: 64 } },

  { id: "column-close", label: "The smoke at reading distance — no cards", hud: false,
    focus: "Close enough to judge the mask and overlap. The silhouette needs ragged multi-scale edges, darker self-shadowed core, lighter thinning fringes and independent puff rotation/fade—the exact cues that make the RPG smoke convincing.",
    act: { force: "volcano", untilState: "active", extraSecs: 8, pinWind: [0.7, -0.7] },
    cam: { volcano: true, dist: 54, alt: 9, aboveVent: 46, fov: 74 } },

  { id: "eruption-night", label: "Night eruption — fire under ash", hud: false,
    focus: "The first reference regime: a dark cone, connected incandescent lava, a white-orange throat, and a charcoal plume whose base catches the eruption glow without turning the whole cloud brown.",
    act: { night: true, force: "volcano", untilState: "active", extraSecs: 9, pinWind: [0.7, -0.7] },
    cam: { volcano: true, dist: 58, alt: 9, aboveVent: 43, fov: 74 } },

  { id: "lava-day", label: "Lava close-up — opaque crust", hud: false,
    focus: "CONTROL — THE BIBLE SHOT (owner's Etna close-up, 2026-08-15): a DARK crusted surface with a bright connected LACE of melt cracked through it. V3 does not touch the lava; the two sides must match. vol_lavaTransparent must read 0 on both.",
    act: { force: "volcano", untilState: "active", extraSecs: 12 },
    cam: { lava: true, frame: 0.55, out: 22, alt: 11, behind: 3, fallback: { x: 26, y: 12, z: 626, ax: 4, ay: 4, az: 606 } } },

  { id: "lava-front", label: "The advancing nose — does it FLOW?", hud: false,
    focus: "CONTROL. The leading edge at close range: it noses forward continuously, the lace travels downstream, the run forks (vol_lavaBranches). Identical machinery on both sides.",
    /* behind 6 (was -5): stand UP-flow of the nose, above it, looking down
       the descent. Down-flow of a nose on a cone means below its own ridge
       line, and the peek run photographed the ridge instead of the rock. */
    act: { force: "volcano", untilState: "active", extraSecs: 9 },
    cam: { lava: true, frame: 1, out: 13, alt: 9, behind: 6, fallback: { x: 22, y: 9, z: 620, ax: 4, ay: 3, az: 604 } } },

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

  { id: "ash-onset", label: "Right when it starts — the checkers arrive", hud: false,
    focus: "THE OWNER'S EXACT COMPLAINT, 2026-08-30: 'literally right when the volcano starts, these ash checkers cover the whole ground of the world.' Shot PLUMB DOWN over the ground 5 s into the eruption, which is when he saw it. Before: a lattice of grey quads switching on across the grass at uniform pitch. After: the same grey arriving as a SHADER COAT — a smooth aperiodic tint on up-facing surfaces, no cells to count. Both sides should read as ashfall; only one of them should read as a grid. ashGridPeriodicity and ashFleckCount are that difference, measured off the photograph rather than off an audit either side could lie about.",
    act: { day: true, force: "volcano", untilState: "active", extraSecs: 5, pinWind: [0.6, 0.8] },
    ashMetric: true,
    cam: { ashfield: true, out: 0.5, side: 0.3, alt: 72, fov: 60, fallback: { x: 46, y: 80, z: 662, ax: 46, ay: 0, az: 664 } } },

  { id: "ash-wedge", label: "The ground, mid-eruption, from the side", hud: false,
    focus: "THE WEDGE, KEPT — the property the deleted field was right about. Mid-eruption from the flank: the downwind ground greys while the upwind side holds its colour, on BOTH sides. Before draws that wedge with four thousand quads; after evaluates it per fragment off world position, so it has an outside without having a pitch. If the after side is uniformly grey edge to edge, the lobe is broken and that is what this beat catches.",
    act: { day: true, force: "volcano", untilState: "active", extraSecs: 10, pinWind: [0.6, 0.8] },
    cam: { wedge: true, along: 0.72, side: 0.5, alt: 34, fallback: { x: 46, y: 26, z: 662, ax: 0, ay: 8, az: 600 } } },

  { id: "dark-noon", label: "Darkness at noon — the ash blots the sun", hud: false,
    focus: "THE FEATURE THAT SURVIVED THE DELETION. Late in the event, staged at MIDDAY, shot wide from upwind. Darkness-at-noon used to be driven by the ground deposit's peak depth; it now rides the eruption's own age and magnitude, so the sun still chokes (sunIntensity), the fog wall still closes in, and the cause is the column overhead instead of paint underfoot. The two sides should look CLOSE in the sky and different only on the ground — if the after side is brighter, the rewire is mis-tuned and that is the regression this beat is for.",
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
    cam: { lava: true, frame: 0.55, out: 22, alt: 11, behind: 3, fallback: { x: 26, y: 12, z: 626, ax: 4, ay: 4, az: 606 } } },

  { id: "cooled", label: "When the eruption ends — the flow dies where it stands", hud: false,
    focus: "CONTROL. The supply stops, so the river stalls and chills BLACK in place: crusted dark rock, ember seams fading, kept on the cone as a scar. Identical quench on both sides; the strip should dim the same way in both rows.",
    act: { force: "volcano", untilState: "active", extraSecs: 21 },
    strip: { frames: 3, stepSec: 2.6 },
    cam: { lava: true, scar: true, frame: 0.5, out: 24, alt: 12, behind: 2, fallback: { x: 26, y: 12, z: 626, ax: 4, ay: 4, az: 606 } } },

  { id: "ash-aftermath", label: "The morning after — ash is weather, not wallpaper", hud: false,
    focus: "THE SAME COMPLAINT, ONE EVENT LATER: 'the ash left afterwards is like a CHECKERBOARD over the map'. Shot PLUMB DOWN ~6 s after the eruption ends — the state the island then sits in for the REST OF THE MATCH, which is what made this the worst of the four. That was TWO faults, the lattice and the permanence, and the coat answers both: no grid, and it blows away over about a minute instead of lying there forever. At +6 s the after side should still be visibly dirty (ash does not vanish the instant the vent shuts) and visibly SMOOTH.",
    act: { day: true, force: "volcano", untilState: "active", pinWind: [0.6, 0.8], untilIdle: true, extraSecs: 6 },
    strip: { frames: 3, stepSec: 2.2 },
    ashMetric: true,
    /* side: walk the tripod off the wind axis so the frame STRADDLES the
       wedge boundary — the saturated blanket on one side, the partial-coverage
       fringe on the other. The fringe is where the checkerboard lives (the
       first plumb framing sat over pure blanket and measured nothing). */
    cam: { ashfield: true, out: 0.55, side: 0.42, alt: 72, fov: 60, fallback: { x: 46, y: 80, z: 662, ax: 46, ay: 0, az: 664 } } },

  { id: "small-one", label: "A SMALL one — a burp you could stand and watch", hud: false,
    focus: "COOKIE-CUTTER NO MORE (owner: 'all the natural disasters are cookie cutter size'). Magnitude pinned to 0.07: a short steam-and-ash burp — a ~55 m column, two narrow lava tongues near the vent, a light dusting, NO pyroclastic collapse, NO lahar, bombs rare. The before build has no magnitude at all, so it stages the same one-size eruption as every other beat.",
    act: { day: true, force: "volcano", untilState: "active", extraSecs: 6, pinWind: [0.7, -0.7], magPin: 0.07 },
    cam: { volcano: true, dist: 135, alt: 20, aboveVent: 34, fov: 66 } },

  { id: "the-big-one", label: "The BIG one — a column that blots the sun", hud: false,
    focus: "Magnitude pinned to 1.0, staged at MIDDAY: a ~190 m column, a six-stem lava fan, fast wide pyroclastic collapses, heavy ash reaching the town, the sun visibly choked while the event still runs, and a longer active window. Before: the same fixed eruption as always, in full daylight.",
    /* t+18: a column takes time to BUILD. At 11 s both sides were still mid-
       climb and photographed the same height; at 18 s the before column is
       finished (~108 m) and the after is well past it on its way to ~194. */
    act: { day: true, force: "volcano", untilState: "active", extraSecs: 18, pinWind: [0.7, -0.7], magPin: 1.0 },
    cam: { volcano: true, dist: 205, alt: 30, aboveVent: 105, fov: 62 } },

];

async function stageVolcano(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
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
    if (!CBZ.disasters || typeof CBZ.disasters.force !== "function") {
      return { ok: false, err: "no CBZ.disasters.force" };
    }
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

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
        } catch (_) {}
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
  if (act.night && CBZ.dayPhase) { try { CBZ.dayPhase(0.93); } catch (_) {} }
  if (act.day && CBZ.dayPhase) { try { CBZ.dayPhase(0.42); } catch (_) {} }

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
  if (act.night && CBZ.dayPhase) { try { CBZ.dayPhase(0.93); step(2.5); } catch (_) {} }

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
    } catch (_) {}
  } else if (cam.volcano) {
    /* REFERENCE FRAMING: the cone is the subject, not a tiny prop behind the
       skyline. Stand just offshore and elect the first compass bearing with a
       clear ray to the crater, so the mountain fills the lower frame while
       the plume owns the sky. Same election on both sides; no smoke object is
       considered a blocker. */
    try {
      const hill = (CBZ.surv && CBZ.surv.arena) ? CBZ.surv.arena.hills[0] : { x: 0, z: 600, peak: 26 };
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
      let pick = null;
      for (const a of angles) {
        const px = hill.x + Math.cos(a) * dist, pz = hill.z + Math.sin(a) * dist;
        const py = Math.max(0, gAtV(px, pz)) + alt;
        if (!pick) pick = { x: px, y: py, z: pz };
        // Crater plus both shoulders: a tower beside the vent is still a bad
        // volcano portrait even when the one centre ray technically lands.
        const vx = Math.cos(a), vz = Math.sin(a), sx = -vz, sz = vx;
        const shoulder = (hill.r || 36) * 0.68;
        const left = new T.Vector3(hill.x + sx * shoulder, 8, hill.z + sz * shoulder);
        const right = new T.Vector3(hill.x - sx * shoulder, 8, hill.z - sz * shoulder);
        if (clearRay(px, py, pz, vent) && clearRay(px, py, pz, left) && clearRay(px, py, pz, right)) {
          pick = { x: px, y: py, z: pz }; break;
        }
      }
      aimed = {
        x: pick.x, y: pick.y, z: pick.z,
        ax: hill.x, ay: hill.peak + (cam.aboveVent != null ? cam.aboveVent : 48), az: hill.z,
      };
      aimNote = "offshore volcano";
    } catch (_) {}
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
      const hill = (CBZ.surv && CBZ.surv.arena) ? CBZ.surv.arena.hills[0] : { x: 0, z: 600 };
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
    } catch (_) {}
  } else if (cam.wedge) {
    /* THE WIND AIMS THE CAMERA. The ash wedge has no hazards() entry — it is
       ground, not a front — but its axis IS the weather's wind vector, which
       both sides drove identically from the same seed during warn. Stand
       down-wind (or up-wind with cam.upwind, for the wide darkness shot),
       offset sideways so the mountain and the wedge share the frame, and
       look at the mid-wedge ground. On the before side the identical tripod
       photographs the same ground staying green, which is the comparison. */
    try {
      const hill = (CBZ.surv && CBZ.surv.arena) ? CBZ.surv.arena.hills[0] : { x: 0, z: 600 };
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
    } catch (_) {}
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
  if (act.night && CBZ.dayPhase) { try { CBZ.dayPhase(0.93); step(0.5); } catch (_) {} }
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
    } catch (_) {}
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
  try { vol = CBZ.volcanoAudit ? CBZ.volcanoAudit() : null; } catch (_) {}
  try { dis = CBZ.disasterAudit ? CBZ.disasterAudit() : null; } catch (_) {}

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
  try { dph = Number(CBZ.dayPhase().toFixed(3)); } catch (_) {}
  try { sunNow = Number(CBZ.sun.intensity.toFixed(3)); } catch (_) {}
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
  // THE COAT IS IN A THIRD FILE NOW. Ash stopped being the volcano's own
  // geometry on 2026-08-30 and became a term in the shared weather surface
  // coat, so the audit that can say whether it is actually ON is weather's.
  try { carry(CBZ.weatherAudit ? CBZ.weatherAudit() : null, "wx_"); } catch (_) {}

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
  description: "The ground ash deposit is deleted (2026-08-30) after four rewrites the owner rejected on sight. These beats photograph its absence against everything the eruption still does: the column, the lava, the pyroclastic flow, the lahar and the darkness at noon are all matched controls. Run with tools/ba-head.mjs so BEFORE is pristine HEAD rather than the deployed build.",
  /* NO defaultBefore. There is no flag left to flip — the deposit was deleted,
     not switched off — so a same-checkout A/B is impossible by construction.
     tools/ba-head.mjs passes pristine HEAD as --before; without it this falls
     through to before-after.mjs's deployed-build default, which is a true
     before for the ash but is also every other commit since the last deploy. */
  beforeLabel: "BEFORE · GROUND ASH",
  afterLabel: "AFTER · NO GROUND ASH",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
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
    vol_organicColumns: { label: "Organic lifecycle columns", better: "higher" },
    vol_blastSmokeColumns: { label: "Columns sharing RPG smoke mask", better: "higher" },
    vol_pyroLive: { label: "Pyroclastic flows live", better: "higher" },
    /* THE DELETION RATCHET. Every one of these is a number that must now be
       ZERO on the after side, and each says a different thing if it is not.
       The two pixel metrics are the ones that matter, because they measure the
       PHOTOGRAPH: no audit key can talk them out of a lattice on the grass.
         periodicity  luminance self-similarity at exactly the old deposit's
                      cell pitch, plumb-down. Positive = the ground repeats at
                      grid pitch = a checkerboard, whatever built it.
         flecks       connected grey components of 3..260 analysis-px. The
                      town's own greys score on both sides, so the DELTA is
                      the ash. A tiled field scores in the hundreds.
         depth/residue  the ledger itself, live and after the event. Pinned to
                      0 in the audit today; a build that reinstates ground ash
                      makes them speak again, which is the point of keeping
                      the rows rather than deleting them with the feature. */
    ashGridPeriodicity: { label: "Ash checkerboard (lattice periodicity)", better: "lower" },
    ashFleckCount: { label: "Isolated grey flecks (checkerboard dots)", better: "lower" },
    vol_ashPeakDepth: { label: "Ground ash deposited", unit: "m", better: "lower" },
    ashResidueDepth: { label: "Ash left after the event", unit: "m", better: "lower" },
    vol_ashFields: { label: "Ground ash fields built", better: "lower" },
    /* THE COAT, MEASURED RATHER THAN SQUINTED AT. ashCoat is the live strength
       of the shader term; coatedMaterials is how many big surfaces are
       carrying the uniforms at all — if that is 0 the coat is not broken, it
       simply never got applied, and those are very different bugs. */
    wx_ashCoat: { label: "Ash coat strength", better: "higher" },
    wx_coatedMaterials: { label: "Surfaces carrying the coat", better: "higher" },
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

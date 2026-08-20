/* THE STRATOVOLCANO storyboard for tools/visual-compare.mjs.

   Boots the REAL survival mode (title → Disaster Survival → Play), freezes
   the rAF loop, forces the director to the volcano, and photographs the same
   simulated seconds of the same seeded eruption on both sides.

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
  { id: "warn-lane", label: "Warning — the lane announces itself", hud: false,
    focus: "Warn phase, no words. The crater glows and ROCK is already coming down the corridor the pyroclastic flow will take. Before-side: the same telegraph buried under a grey ash rain (owner, 2026-08-16: gone) and a heavier haze.",
    act: { force: "volcano", untilState: "warn", extraSecs: 4.2 },
    cam: { lane: true, ahead: 60, side: 26, alt: 26, fallback: { x: 108, y: 46, z: 672, ax: 0, ay: 20, az: 600 } } },

  { id: "column", label: "The eruption column", hud: false,
    focus: "OWNER, 2026-08-16: the smoke 'looks like flat bouncing circle ish things'. It did — every puff was a fixture bobbing on three sinusoids. The column is now an emitter (the RPG-smoke lifecycle): puffs born small over the vent, growing as they climb, spreading into the cauliflower head, so the pillar visibly RISES instead of jittering in place.",
    /* force: this beat used to inherit whatever disaster the director
       happened to be on — run alone (`--subjects column`) it photographed a
       LIGHTNING STORM and reported ok:true, the exact order-dependence the
       header note above forbids. The nuke-wide/landmark beats are the ONLY
       deliberate inheritors (they continue nuke-fireball's cloud, and
       re-forcing would reset its age). */
    act: { force: "volcano", untilState: "active", extraSecs: 3.2 },
    cam: { x: 118, y: 40, z: 686, ax: 0, ay: 30, az: 600 } },

  { id: "lava-day", label: "Lava close-up — opaque crust", hud: false,
    focus: "THE BIBLE SHOT (owner's Etna close-up, 2026-08-15): a DARK crusted surface with a bright connected LACE of melt cracked through it — thin filaments wrapping irregular black islands, meandering between the levees. Before-side: one smooth bright band of even orange, the 'glowing road'. Organic, never geometric. vol_lavaTransparent must read 0.",
    act: { force: "volcano", untilState: "active", extraSecs: 12 },
    cam: { lava: true, frame: 0.55, out: 22, alt: 11, behind: 3, fallback: { x: 26, y: 12, z: 626, ax: 4, ay: 4, az: 606 } } },

  { id: "lava-front", label: "The advancing nose — does it FLOW?", hud: false,
    focus: "The leading edge at close range. It must nose forward continuously, the lace must travel downstream, and — new with the 2026-08-15 bible — the run should FORK: vol_lavaBranches counts the children a stem has grown, and a fan of lobed noses is what 'organic' means here. Before-side: one uniform ribbon, no forks, smooth even glow.",
    /* behind 6 (was -5): stand UP-flow of the nose, above it, looking down
       the descent. Down-flow of a nose on a cone means below its own ridge
       line, and the peek run photographed the ridge instead of the rock. */
    act: { force: "volcano", untilState: "active", extraSecs: 9 },
    cam: { lava: true, frame: 1, out: 13, alt: 9, behind: 6, fallback: { x: 22, y: 9, z: 620, ax: 4, ay: 3, az: 604 } } },

  { id: "pyroclastic", label: "Pyroclastic flow — mid-descent", hud: false,
    focus: "THE KILLER. A ground-hugging avalanche of 600 C rock and gas boiling down the fall line at 6x sprinting speed, engulfing its lane. Opaque overlapping billows with an incandescent basal fringe — not translucent orange rocks. Before-side has no such hazard at all.",
    act: { force: "volcano", untilState: "active", extraSecs: 5.4, needLine: true },
    cam: { lane: true, ahead: 44, side: 15, alt: 34, fallback: { x: 96, y: 34, z: 664, ax: 0, ay: 16, az: 604 } } },

  { id: "pyro-close", label: "The cloud at reading distance", hud: false,
    focus: "OWNER: 'there's big rocks looking of smoke — smoke doesn't look like big bouncing boulders'. Close enough that INDIVIDUAL elements are legible, which is exactly where the before-side falls apart: lit low-poly icosahedra up to ~21 m across, visibly tumbling on their own axes. It has to read as a churning ash cloud with soft irregular edges, not as a rockslide.",
    act: { force: "volcano", untilState: "active", extraSecs: 4.3, needLine: true },
    cam: { lane: true, ahead: 20, side: 30, alt: 13, fallback: { x: 74, y: 22, z: 646, ax: 10, ay: 12, az: 610 } } },

  { id: "lahar", label: "Lahar in the channel", hud: false,
    focus: "Wet concrete: a matte grey-brown mud river down the VALLEY rather than the fall line, carrying boulders and logs. Slower than the flow, and it sets where it stops.",
    act: { force: "volcano", untilState: "active", extraSecs: 11.5 },
    cam: { lahar: true, ahead: 34, side: 22, alt: 24, fallback: { x: 62, y: 20, z: 660, ax: 0, ay: 6, az: 612 } } },

  { id: "ash-street", label: "The town late in the eruption — no blanket", hud: false,
    focus: "OWNER, 2026-08-16: 'the ash covering the map is not needed... the ash covers everything in a dumb way.' Before-side: the downwind town greyed over by the quad blanket, deep in fog. After: the blanket, the ash rain and the choke are gone — the town keeps its own colour for the whole event and the eruption reads on the mountain, not as a map-wide grey filter.",
    act: { force: "volcano", untilState: "active", extraSecs: 17.5 },
    cam: { x: 46, y: 15, z: 662, ax: -6, ay: 3, az: 618 } },

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
    focus: "The supply stops, so the river stalls and chills BLACK in place: crusted dark rock, the last ember seams fading in the deepest cracks, kept on the cone as a scar (the lahar's precedent). Before-side: the glowing flows are DELETED the frame the eruption ends — the strip photographs a bare hillside three times. The strip is the proof: the after row dims across the same simulated seconds.",
    act: { force: "volcano", untilState: "active", extraSecs: 21 },
    strip: { frames: 3, stepSec: 2.6 },
    cam: { lava: true, scar: true, frame: 0.5, out: 24, alt: 12, behind: 2, fallback: { x: 26, y: 12, z: 626, ax: 4, ay: 4, az: 606 } } },

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
      // the whiteout sheet is the SUBJECT of nuke-pov — never hide it
      if (child.id === "nukeFlash") continue;
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

  if (act.force) { CBZ.disasters.force(act.force); step(0.1); }
  if (act.untilState) stepUntilState(act.untilState, 30);
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
  if (cam.lane || cam.lahar) {
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
  }
  if (!aimed && cam.fallback) { aimed = cam.fallback; aimNote = "fallback tripod"; }
  if (act.needLine && !lineHazard()) {
    return { ok: false, err: "no travelling front published — nothing to photograph", state: CBZ.disasters.state() };
  }

  setHud(true);
  void document.documentElement.offsetHeight;

  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 55;
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

  const before = input.side === "before";
  const query = (name) => S.overlay.querySelector(`[data-${name}]`);
  query("side").textContent = before ? input.beforeLabel : input.afterLabel;
  query("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  query("name").textContent = subject.label;
  query("name").style.cssText = "position:absolute;top:212px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:360px";
  query("focus").textContent = `${CBZ.disasters.current() || "—"} · ${CBZ.disasters.state()} · cam ${aimNote} · far ${Math.round(camera.far)}`;
  query("focus").style.cssText = "position:absolute;top:250px;left:27px;color:#c0cfda;font-size:12px;font-weight:550";

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
  description: "One seeded survival match per build, the director forced through the volcano's beats and stepped to identical simulated seconds. The travelling beats aim themselves off CBZ.disasters.hazards() so the camera stands on the flank of the ACTUAL flow rather than a guessed hillside, and the lava tripod raycasts its own sightline. vol_lavaTransparent is the owner's 'see thru' complaint as a number and must read 0.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
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
    vol_pyroLive: { label: "Pyroclastic flows live", better: "higher" },
    /* The ash blanket was deliberately REMOVED on 2026-08-16 (owner: "the
       ash covering the map is not needed"), so its old higher-is-better
       rows would paint the fix red. The depth stays printed — reading 0 on
       the after side IS the feature — and the roof-collapse row goes with
       the mechanic that fed it. */
    vol_ashPeakDepth: { label: "Ash covering the map (removed)", unit: "m", better: "lower" },
    audit_pyroRuns: { label: "Pyroclastic runs", better: "higher" },
    audit_laharRuns: { label: "Lahar runs", better: "higher" },
    tickAvgMs: { label: "Sim tick avg", unit: "ms", better: "lower" },
    tickMaxMs: { label: "Sim tick worst", unit: "ms", better: "lower" },
    drawCalls: { label: "Draw calls", better: "lower" },
  },
  subjects,
  stage: stageVolcano,
};

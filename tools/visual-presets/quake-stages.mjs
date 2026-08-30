/* THE SUBDUCTION-ZONE EARTHQUAKE storyboard for tools/visual-compare.mjs.

   Skeleton lifted from disaster-sequence.mjs (same boot, same rAF freeze, same
   CBZ.stepSim clock), narrowed to ONE disaster and staged along its real
   timeline so every beat of the new kill model gets its own frame:

     pre-shock          the foreshock. A still cannot carry motion, so this is
                        shot as a PAIR 0.12 s apart from one fixed camera —
                        parked cars buzzing on their springs, canopies
                        shivering, horizon dead still. Compare the two frames.
     mainshock          street level beside a facade: glass and masonry coming
                        OFF the building and falling into the strip of ground a
                        person would be standing on. This is the whole thesis.
     pancake            a collapse mid-fall.
     cover              the survival lesson: bots ducked under the day-room
                        tables, framed against the street.
     aftermath          the second wave of deaths — gas fires burning in the
                        damaged buildings, a downed conductor arcing on the
                        ground, rubble.
     aftershock         a decaying repeat re-shedding what the mainshock
                        already weakened.

   CAMERAS ARE SOLVED, NOT TYPED. A hardcoded island coordinate photographs
   whatever happens to be there in this seed; every beat here instead asks the
   LIVE WORLD for its subject (the worst-damaged standing building, a bot that
   is actually ducked, a downed line's real position) and frames THAT. A beat
   whose subject does not exist says so in the frame instead of lying.

   The after-side loads src/systems/quake.js by injection when the page did not
   already carry it, so this preset works before the index.html seam patch has
   landed; the deployed before-side simply 404s and shows the old quake, which
   is exactly the comparison wanted. */

import { baselineBuild } from "../ba-lib/head-build.mjs";

const subjects = [
  { id: "preshock-a", label: "Foreshock — frame 1 of 2", pair: "preshock",
    focus: "Warn phase. The ground is already moving: parked cars buzz on their springs and canopies shiver while the horizon holds still. Frame 1 of a 0.12 s pair — compare against frame 2.",
    act: { force: "quake", untilState: "warn", extraSecs: 3.2 },
    cam: { aim: "cars", back: 11, up: 2.4 } },
  { id: "preshock-b", label: "Foreshock — frame 2 of 2", pair: "preshock",
    focus: "The same camera 0.12 s later. Every loose object has moved and nothing fixed has. That difference IS the telegraph the deleted banner used to spell out.",
    act: { extraSecs: 0.12 },
    cam: { aim: "cars", back: 11, up: 2.4, hold: true } },

  /* From here every beat is pinned to an ABSOLUTE sim-second of the quake's
     active phase (`atSecs`) — and, now that the timeline is the MAGNITUDE'S
     (an M7.6 mainshock runs ~44 s where the old build's ran 14), each
     post-mainshock beat ALSO names the physical phase it wants
     (`untilPhase`), read live off CBZ.quake.motionState(). A build with no
     motion core (the deployed before) answers every phase test immediately
     and lands on its old absolute second — which is exactly the honest
     comparison. The storyboard quake is FORCED to M7.6 on builds that can
     roll one, so the same seconds mean the same event on every rerun. */
  { id: "mainshock-facade", requireQuake: true, label: "Mainshock — the facade sheds",
    focus: "Street level against a wounded building. Glass panes and masonry chunks are OFF the wall and in the air. The kill zone is this strip of ground; the open square behind the camera is survivable. Debris density scales with the structural stage.",
    act: { atSecs: 6.5 },
    cam: { aim: "worst", tight: true, back: 24, up: 4.5, look: 13, swing: 0.5 } },

  { id: "mainshock-wide", requireQuake: true, label: "Mainshock — the block",
    focus: "The same seconds from above: dust, several buildings shedding at once, the ones closest to collapse shedding hardest.",
    act: { atSecs: 9 },
    cam: { aim: "worst", back: 46, up: 26, look: 6 } },

  { id: "pancake", requireQuake: true, label: "Pancake collapse, mid-fall",
    focus: "A building coming down through the shared ledger, caught mid-fall with its rubble field already forming.",
    act: { atSecs: 11.5 },
    cam: { aim: "falling", back: 34, up: 15, look: 8 } },

  { id: "cover", requireQuake: true, label: "Drop, cover, hold on",
    focus: "The survival lesson made visible: some of the crowd sprinted for open ground, some dived under a heavy table and are holding there. A masonry block takes 5% of its damage through a solid worktop and all of it in a doorway.",
    act: { atSecs: 13 },
    cam: { aim: "ducked", back: 7.5, up: 2.6, look: 1.2 } },

  { id: "aftermath", requireQuake: true, untilPhase: "aftermath", label: "Aftermath — gas fire",
    focus: "The mainshock is over and the second wave of deaths has started: a ruptured main has lit a damaged building, and it is burning. Where a real city lot exists this runs through city/structural.js's BURNING state and its fire-spread automaton; on the island a compact local flame stands in and reports its structural damage back to the ledger that owns the building.",
    act: { atSecs: 16 },
    cam: { aim: "fire", back: 24, up: 9, look: 5 } },

  { id: "downed-line", requireQuake: true, untilPhase: "aftermath", label: "Aftermath — the line that fell outward",
    focus: "A pole came down AWAY from the structure it stood beside — across exactly the open ground the sensible half of the crowd ran to. The conductor is live and arcing at the break; touching it is 'electrocuted on a downed line'.",
    act: { atSecs: 17 },
    cam: { aim: "line", back: 15, up: 5, look: 0.6, swing: 1.15 } },

  { id: "aftershock", requireQuake: true, untilPhase: "aftershock", label: "Aftershock — re-shedding the weakened",
    focus: "A decaying repeat several sim-seconds after the mainshock. It re-sheds buildings the mainshock already opened up, which is when most of the remaining collapses actually happen.",
    act: { atSecs: 21.6 },
    cam: { aim: "worst", back: 40, up: 22, look: 6 } },

  { id: "chain", label: "The chain — the sea goes out", untilPhase: "drawdown",
    focus: "The subduction handoff — now gated on MAGNITUDE, not on how late in the round it is: only an offshore rupture at ~M7.4+ lifts the water column. On one, the drawdown begins WHILE the aftershocks are still running and the director is handed to the tsunami — one event, not two in a row. (If this seed's rupture went inland the mountain may be erupting instead; either way, a great quake did not end alone.)",
    act: { atSecs: 25, thenSecs: 3 },
    cam: { aim: "sea", back: 0, up: 34, look: 0 } },

  /* THE SIZE RANGE, on one page. Every quake used to be the same 26-second
     quake; these two force the ends of the rolled scale onto the SAME street
     with the SAME camera. A still cannot carry shaking, so both are film
     strips, and the stepper measures what the frames cannot: camera
     displacement per tick, cars off their rest pose, the player's feet. */
  { id: "m4-crockery", label: "Magnitude 4.1 — rattled crockery", pair: "size",
    focus: "The small quake, made real: PGA ~0.03 g, a few seconds of 5 Hz rattle. The cars buzz on their springs and dust lifts — and NOTHING is damaged: no shed, no collapse, no fires, no one knocked down. Below M5.2 a quake is a thing that happens to your coffee, which is what makes drawing one genuinely fun instead of a shorter disaster.",
    act: { force: "quake", forceMag: 4.1, untilState: "active", extraSecs: 2.2 },
    strip: { frames: 5, stepSec: 0.4 },
    cam: { aim: "cars", back: 11, up: 2.4 } },
  { id: "m8-bigone", label: "Magnitude 8.3 — the big one", pair: "size",
    focus: "The same street under an M8.3: PGA ~0.9 g, a minute of 0.9 Hz ROLLING — the P bang, then the S waves, then a coda still punching aftershocks. You cannot stay standing (footing knockdowns roll off live PGA), facades shed, the low ground liquefies, the fault reaches daylight. Duration, frequency, damage, aftershock count all come off the one rolled magnitude.",
    act: { force: "quake", forceMag: 8.3, untilState: "active", extraSecs: 8 },
    strip: { frames: 5, stepSec: 0.5 },
    cam: { aim: "cars", back: 11, up: 2.4 } },
];

async function stageQuake(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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
      if (child.id === "__quakeOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__quakeSeq;
  if (!S) {
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="survival"]'), 300000);
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="survival"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn");
      if (b) b.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (!CBZ.disasters || typeof CBZ.disasters.force !== "function") return { ok: false, err: "no CBZ.disasters.force" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    // THE SEAM, honestly declared: the shared quake core needs a <script> tag
    // in index.html and that file is the orchestrator's to patch. Until it
    // lands, load it here so the after-side photographs the real build. A
    // build that already has the tag skips this; the deployed before-side
    // 404s and keeps the quake it shipped with.
    if (!CBZ.quake) {
      await new Promise((resolve) => {
        const s = document.createElement("script");
        s.src = "src/systems/quake.js?visualpreset=1";
        s.onload = resolve; s.onerror = resolve;
        document.head.appendChild(s);
        setTimeout(resolve, 8000);
      });
    }

    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    for (let i = 0; i < 90; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    const overlay = document.createElement("div");
    overlay.id = "__quakeOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__quakeSeq = { overlay, cam: null, t0: null, coreLoaded: !!CBZ.quake, probe: null, lastCam: null, step: null };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
      /* THE STRIP'S STEPPER. A still cannot show shaking, so the film strip
         measures it instead of miming it: each advance steps the frozen sim
         in lockstep on both sides, samples the camera every tick (the shake
         the frames cannot carry — camera.js repositions CBZ.camera inside
         stepSim, so the per-tick displacement IS the shake), counts parked
         cars off their rest pose (the WORLD moving, not the lens) and
         whether the player still has their feet. The staged cinematic
         camera is re-applied before the capture so all strip frames
         photograph the same view and the world's motion reads against a
         fixed frame. */
      advance(secs) {
        const S2 = window.__quakeSeq, C = window.CBZ;
        if (!S2 || !S2.step || !C) return;
        const cam = C.camera;
        const n = Math.max(1, Math.round((secs || 0.5) * 60));
        let px = cam.position.x, py = cam.position.y, pz = cam.position.z;
        for (let i = 0; i < n; i++) {
          C.hitstop = 0; C.slowmo = 0;
          C.stepSim(1 / 60);
          const P = S2.probe;
          /* THE FIRST TWO TICKS ARE THE FOLLOW-CAMERA SNAPPING BACK from the
             staged cinematic pose to gameplay framing — a ~20 m jump that is
             rig motion, not ground motion. CBZ.shake itself is clamped at
             3.5 m/axis (≤ ~6 m of displacement), so anything bigger is the
             rig and is excluded from the shake ruler. The first pass of this
             probe averaged 5.6 m/tick on a STILL street for exactly this. */
          if (P && i >= 2) {
            const d = Math.hypot(cam.position.x - px, cam.position.y - py, cam.position.z - pz);
            if (d < 6) { P.ticks++; P.camSum += d; if (d > P.camMax) P.camMax = d; }
            P.footTicks++;
            try { if (C.body && C.body.busy && C.body.busy(C.player)) P.downTicks++; } catch (_) {}
          }
          px = cam.position.x; py = cam.position.y; pz = cam.position.z;
          if (C.player) { C.player.hp = 100; C.player.dead = false; }
        }
        const P = S2.probe;
        if (P) {
          let mv = 0;
          const arena = C.surv && C.surv.arena;
          const cars = (arena && arena.cars) || [];
          for (let i = 0; i < cars.length; i++) {
            const c = cars[i];
            if (c && c.group && !c.flung && Math.hypot(c.group.position.x - c.x, c.group.position.z - c.z) > 0.02) mv++;
          }
          if (mv > P.moving) P.moving = mv;
        }
        if (S2.lastCam) {
          cam.position.set(S2.lastCam.px, S2.lastCam.py, S2.lastCam.pz);
          cam.quaternion.set(S2.lastCam.qx, S2.lastCam.qy, S2.lastCam.qz, S2.lastCam.qw);
          cam.updateMatrixWorld(true);
        }
        if (typeof C.skySync === "function") C.skySync();
        try { C.renderer.render(C.scene, cam); } catch (_) {}
      },
      /* Called once after the strip; merged into the subject's metrics so
         the numbers describe exactly the photographed seconds. */
      metrics() {
        const S2 = window.__quakeSeq, C = window.CBZ;
        const P = (S2 && S2.probe) || { ticks: 0, camSum: 0, camMax: 0, moving: 0, downTicks: 0, footTicks: 0 };
        const qa = (C && typeof C.quakeAudit === "function") ? C.quakeAudit() : {};
        const da = (C && typeof C.disasterAudit === "function") ? C.disasterAudit() : {};
        return {
          camShakePerTickM: P.ticks ? +(P.camSum / P.ticks).toFixed(4) : 0,
          camShakeMaxM: +(P.camMax || 0).toFixed(3),
          carsInMotion: P.moving || 0,
          playerDownPct: P.footTicks ? Math.round(100 * P.downTicks / P.footTicks) : 0,
          quakeMag: Number(qa.mag) || 0,
          pgaPeakG: Number(qa.pgaPeak) || 0,
          knockdowns: Number(qa.knockdowns) || 0,
          staggers: Number(qa.staggers) || 0,
          aftershocksFired: Number(qa.aftershocksFired) || 0,
          quakeDurSecs: Number(da.quakeActiveSecs) || 0,
        };
      },
    };
  }

  const subject = input.subject;
  const act = subject.act || {};
  const heal = () => {
    if (!CBZ.player) return;
    CBZ.player.hp = 100; CBZ.player.dead = false;
    if (CBZ.player.stamina != null) CBZ.player.stamina = 100;
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
  const stepUntilState = (want, budget) => {
    let guard = Math.round((budget || 30) * 10);
    while (guard-- > 0 && CBZ.disasters.state() !== want) step(0.1);
  };
  S.step = step;                    // the strip's advance() steps with this

  /* ORDER-INDEPENDENCE. These beats are sequential moments of ONE run, but a
     `--subjects` subset (which is how you iterate) would otherwise photograph
     whatever the director happened to be doing — the first pass of this preset
     labelled a LIGHTNING STORM "Mainshock". Any beat that needs the quake says
     so and re-forces it, and then seeks to its own absolute second. */
  /* THE STORYBOARD QUAKE HAS A NAMED MAGNITUDE. The def now rolls one per
     occurrence, so an unpinned force() would photograph whatever size the
     stream dealt — an M4.5 whose mainshock is over before the 11.5 s beat.
     CBZ.quake.forceMag is the one-shot tool seam for exactly this; a build
     without it (the deployed before) ignores the pin and plays its one-size
     quake, which is the comparison. */
  const armMag = (m) => {
    try { if (CBZ.quake && CBZ.quake.forceMag) CBZ.quake.forceMag(m); } catch (_) {}
  };
  const armQuake = () => {
    armMag(7.6);
    CBZ.disasters.force("quake"); step(0.1);
    stepUntilState("active", 40);
    S.t0 = CBZ.disasters.timeLeft();       // the quake's own clock, captured once
  };
  if (subject.requireQuake && CBZ.disasters.current() !== "EARTHQUAKE" && !act.force) armQuake();
  if (act.force) {
    if (act.force === "quake") armMag(act.forceMag != null ? act.forceMag : 7.6);
    CBZ.disasters.force(act.force); step(0.1);
    if (act.force === "quake") S.t0 = null;
  }
  if (act.untilState) stepUntilState(act.untilState, 40);
  if (act.atSecs != null) {
    if (CBZ.disasters.state() !== "active") stepUntilState("active", 40);
    if (S.t0 == null) S.t0 = CBZ.disasters.timeLeft();
    let guard = 900;
    while (guard-- > 0 && CBZ.disasters.state() === "active" &&
           CBZ.disasters.current() === "EARTHQUAKE" &&
           (S.t0 - CBZ.disasters.timeLeft()) < act.atSecs) step(0.1);
  }
  /* PHYSICAL-PHASE WAIT (the README's own rule: pin to a condition, not a
     second). The magnitude owns the timeline now, so a post-mainshock beat
     walks on from its absolute second until the LIVE wave train reports the
     phase it wants. A build with no motion core answers true immediately
     and keeps its old absolute-second framing. */
  if (subject.untilPhase) {
    const want = subject.untilPhase;
    const there = () => {
      if (!(CBZ.quake && CBZ.quake.motionState)) return true;   // old build
      const st = CBZ.quake.motionState();
      if (!st.on) return true;
      if (want === "aftermath") return st.phase === "coda" || st.phase === "aftershock" || st.phase === "done";
      if (want === "aftershock") return st.shocksFired > 0;
      if (want === "drawdown") return (CBZ.waterSurge ? CBZ.waterSurge() : 0) < -0.5;
      return true;
    };
    let guard = want === "drawdown" ? 450 : 1400;
    while (guard-- > 0 && CBZ.disasters.state() === "active" &&
           CBZ.disasters.current() === "EARTHQUAKE" && !there()) step(0.1);
    if (!there()) step(0);           // guard expired: photograph honestly where we are
    else if (want !== "drawdown") step(0.8);   // let the phase land visibly
  }
  if (act.extraSecs) step(act.extraSecs);
  if (act.thenSecs) step(act.thenSecs);

  // ---- SOLVE THE CAMERA off live world state -----------------------------
  const A = (CBZ.SURV && CBZ.SURV.arena) || { cx: 0, cz: 600, r: 120 };
  const arena = CBZ.surv && CBZ.surv.arena;
  const cam = subject.cam || {};
  let target = null, note = "";
  const frag = (arena && arena.fragile) || [];
  const standing = frag.filter((b) => !b.fallen);
  const pick = (list, score) => {
    let best = null, bs = -1e9;
    for (const b of list) { const s = score(b); if (s > bs) { bs = s; best = b; } }
    return best;
  };
  if (cam.hold && S.cam) {
    target = S.cam.target; note = S.cam.note;
  } else if (cam.aim === "cars") {
    const cars = (arena && arena.cars) || [];
    const c = cars.length ? cars[Math.min(3, cars.length - 1)] : null;
    if (c) { target = { x: c.x, y: 1.4, z: c.z }; note = "parked cars"; }
  } else if (cam.aim === "worst") {
    const b = pick(standing, (x) => (x._dmg || 0) + x.h * 0.004);
    if (b) { target = { x: b.x, y: (b.gy || 0) + Math.min(9, b.h * 0.35), z: b.z, girth: Math.max(b.w, b.d), tall: b.h }; note = "dmg " + ((b._dmg || 0).toFixed(2)); }
  } else if (cam.aim === "falling") {
    const b = pick(frag, (x) => (x.fallen ? 10 : 0) + (x._dmg || 0));
    if (b) { target = { x: b.x, y: (b.gy || 0) + Math.min(12, b.h * 0.4), z: b.z, girth: Math.max(b.w, b.d), tall: b.h }; note = b.fallen ? "collapsed" : "dmg " + ((b._dmg || 0).toFixed(2)); }
  } else if (cam.aim === "ducked") {
    const bots = CBZ.bots || [];
    const d = bots.find((b) => b && !b.dead && b._quakeDuck);
    const anchor = d ? d._quakeDuck
      : (CBZ.quake && CBZ.quake.coverNear ? CBZ.quake.coverNear(A.cx, A.cz, null, 999) : null);
    if (anchor) {
      target = { x: anchor.x, y: (anchor.y || 0) + 0.9, z: anchor.z };
      note = d ? "ducked bot under a table" : "cover anchor, nobody under it";
      /* SHOOT IT THROUGH THE DOORWAY. The table is inside a walled room, so a
         camera placed by the generic centre-outward rule stands INSIDE the
         wall — which is exactly what the second pass of this preset
         photographed. The anchor knows its host's doorway, so put the eye on
         the line table→door, extended outside, and the opening frames it. */
      if (anchor.door) {
        let ex = anchor.door.x - anchor.x, ez = anchor.door.z - anchor.z;
        const el = Math.hypot(ex, ez) || 1; ex /= el; ez /= el;
        target.eye = { x: anchor.door.x + ex * 1.4, y: (anchor.y || 0) + 1.5, z: anchor.door.z + ez * 1.4 };
        target.look = 0.75;
      }
    }
  } else if (cam.aim === "fire" || cam.aim === "line") {
    /* SHOOT FROM THE OPEN SIDE. Both hazards are attached to a structure —
       a fire to a wall face, a downed pole to the bearing it fell along — so
       the hazard's own outward normal is the one direction guaranteed not to
       put the camera inside the building it belongs to. Pass 2 of this preset
       buried the downed-line shot in a neighbouring tower for want of it. */
    const hz = (CBZ.quake && CBZ.quake.hazards) ? CBZ.quake.hazards() : [];
    const h = hz.find((k) => k.kind === cam.aim);
    if (h) {
      const base = cam.aim === "line"
        ? { x: (h.baseX + h.tipX) / 2, z: (h.baseZ + h.tipZ) / 2, y: 1.1 }
        : { x: h.x, z: h.z, y: h.y != null ? h.y : 2.2 };
      target = { x: base.x, y: base.y, z: base.z };
      const d = cam.back != null ? cam.back : 16;
      target.eye = { x: base.x + h.nx * d, y: base.y + (cam.up != null ? cam.up : 5), z: base.z + h.nz * d };
      try {
        const g = CBZ.floorAt ? CBZ.floorAt(target.eye.x, target.eye.z) : 0;
        if (target.eye.y < g + 2.4) target.eye.y = g + 2.4;
      } catch (_) {}
      note = cam.aim + " (shot from its open side)";
    }
  } else if (cam.aim === "sea") {
    target = { x: A.cx, y: 0, z: A.cz + (A.r || 120) * 0.75 }; note = "surge " + (CBZ.waterSurge ? CBZ.waterSurge().toFixed(2) : "?");
  }
  if (!target) {
    const b = standing[0] || frag[0];
    target = b ? { x: b.x, y: (b.gy || 0) + 6, z: b.z } : { x: A.cx, y: 4, z: A.cz };
    note = note || "fallback";
  }
  if (!cam.hold) S.cam = { target, note };

  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 55; camera.near = 0.4; camera.far = 20000;
  /* Stand off the island CENTRE-outward and swing 34° round, so the subject
     is between us and the town and we see the CORNER of a building rather
     than pressing our nose against one wall. Then two guards that cost
     nothing and stop the camera lying:
       · STAND OFF THE SUBJECT'S OWN SIZE — a fixed 17 m is outside a
         shopfront and INSIDE a 20 m glass tower (pass 1 of this preset
         photographed the inside of a curtain wall for exactly that reason);
       · NEVER STAND INSIDE THE GROUND — the eye is lifted above CBZ.floorAt
         at its own position, which is what buried the downed-line shot in a
         hillside on pass 2. */
  let ox = target.x - A.cx, oz = target.z - A.cz;
  const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
  const sw = cam.swing != null ? cam.swing : 0.6;         // radians round the subject
  const rx = ox * Math.cos(sw) - oz * Math.sin(sw);
  const rz = ox * Math.sin(sw) + oz * Math.cos(sw);
  ox = rx; oz = rz;
  const girth = target.girth || 0, tall = target.tall || 0;
  // `tight` = a deliberate STREET-LEVEL shot: keep the authored eye height
  // instead of the safe 3/4 lift, because looking UP a shedding facade is the
  // whole point of that beat and an aerial makes the debris read as grit.
  const back = cam.tight
    ? Math.max(cam.back != null ? cam.back : 20, girth * 1.1 + 10)
    : Math.max(cam.back != null ? cam.back : 20, girth * 1.15 + tall * 0.45 + 8);
  const up = cam.tight ? (cam.up != null ? cam.up : 5) : Math.max(cam.up != null ? cam.up : 8, back * 0.42);
  const lookY = (target.y || 0) + (target.look != null ? target.look : (cam.look != null ? cam.look : 2));
  if (cam.aim === "sea") {
    camera.position.set(A.cx, Math.max(up, 34), A.cz + (A.r || 120) * 1.25);
    camera.lookAt(A.cx, 0, A.cz);
  } else if (target.eye) {
    camera.position.set(target.eye.x, target.eye.y, target.eye.z);
    camera.lookAt(target.x, lookY, target.z);
  } else {
    const ex = target.x + ox * back, ez = target.z + oz * back;
    let ey = (target.y || 0) + up;
    try { const g = CBZ.floorAt ? CBZ.floorAt(ex, ez) : 0; if (ey < g + 2.2) ey = g + 2.2; } catch (_) {}
    camera.position.set(ex, ey, ez);
    camera.lookAt(target.x, lookY, target.z);
  }
  camera.updateProjectionMatrix();
  // remember the solved shot + zero the strip probe, so advance() can hold
  // this exact framing across the film strip and measure only ITS seconds
  S.lastCam = { px: camera.position.x, py: camera.position.y, pz: camera.position.z,
    qx: camera.quaternion.x, qy: camera.quaternion.y, qz: camera.quaternion.z, qw: camera.quaternion.w };
  S.probe = { ticks: 0, camSum: 0, camMax: 0, moving: 0, downTicks: 0, footTicks: 0 };
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const rig = CBZ.skyDome && CBZ.skyDome.parent;
    if (rig && rig.position) rig.position.set(camera.position.x, 0, camera.position.z);
  }
  setHud(false);
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const render = (CBZ.renderer.info && CBZ.renderer.info.render) || {};

  const qa = (typeof CBZ.quakeAudit === "function") ? CBZ.quakeAudit() : {};
  const da = (typeof CBZ.disasterAudit === "function") ? CBZ.disasterAudit() : {};

  const before = input.side === "before";
  const q = (n) => S.overlay.querySelector(`[data-${n}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;top:212px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:360px";
  q("focus").textContent =
    `${CBZ.disasters.current() || "—"} · ${CBZ.disasters.state()} · subject: ${note}` +
    (qa.mag ? ` · M${qa.mag} · ${qa.motionPhase || ""}` : "") +
    (S.coreLoaded || CBZ.quake ? "" : " · NO SHARED CORE");
  q("focus").style.cssText = "position:absolute;top:250px;left:27px;color:#c0cfda;font-size:12px;font-weight:550;max-width:380px";
  q("perf").textContent =
    `debris ${qa.debrisSpawned || 0} spawned / ${qa.debrisHits || 0} hits / ${qa.debrisKills || 0} kills\n` +
    `cover ${qa.coverAnchors || 0} anchors · ducked ${qa.ducked || 0} · saves ${qa.coverSaves || 0}\n` +
    `fires ${da.gasFires || 0} · lines ${da.linesDown || 0} · chained ${da.chained || 0}\n` +
    `sim ${ticks} ticks · avg ${(ticks ? totalMs / ticks : 0).toFixed(1)}ms · worst ${maxMs.toFixed(0)}ms`;
  q("perf").style.cssText = `position:absolute;right:24px;top:24px;text-align:right;white-space:pre;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:${maxMs > 100 ? "#ff9c9c" : "#9fe8c3"}`;
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  const metrics = {
    debrisSpawned: Number(qa.debrisSpawned || 0),
    debrisHits: Number(qa.debrisHits || 0),
    debrisKills: Number(qa.debrisKills || 0),
    coverAnchors: Number(qa.coverAnchors || 0),
    coverSaves: Number(qa.coverSaves || 0),
    ducked: Number(qa.ducked || 0),
    gasFires: Number(da.gasFires || 0),
    linesDown: Number(da.linesDown || 0),
    chained: Number(da.chained || 0),
    quakeMag: Number(qa.mag) || 0,
    pgaPeakG: Number(qa.pgaPeak) || 0,
    knockdowns: Number(qa.knockdowns) || 0,
    staggers: Number(qa.staggers) || 0,
    aftershocksFired: Number(qa.aftershocksFired) || 0,
    tickAvgMs: ticks ? Number((totalMs / ticks).toFixed(2)) : 0,
    tickMaxMs: Number(maxMs.toFixed(1)),
    ticksOver33: over33,
    drawCalls: Number(render.calls || 0),
  };

  return { ok: true, disaster: CBZ.disasters.current(), state: CBZ.disasters.state(), note, metrics };
}

export default {
  id: "quake-stages",
  title: "The Subduction-Zone Earthquake",
  description: "One seeded survival match per build, the director forced to the earthquake and stepped through the same simulated seconds. Before: one cookie-cutter 26-second quake — a linear camera ramp with three canned aftershocks, the same size every round. After: a rolled Richter MAGNITUDE per occurrence (the storyboard pins M7.6; the last pair shows M4.1 beside M8.3) driving a real WAVE TRAIN — P bang, S rolling at the magnitude's own frequency, decaying coda, a Båth-law aftershock schedule — plus footing (stagger and knockdown off live PGA), liquefaction, surface rupture, and buildings that SHED debris that kills at head height. A still cannot carry shaking, so the film strips measure it: camera displacement per tick, cars off their rest pose, the player's feet.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  /* THE BEFORE IS PRISTINE, EVERY RUN. `--before local` on this shared
     checkout serves the WORKING TREE on both sides — this preset's first
     full run photographed the new quake against itself and called the noise
     regressions. baselineBuild gives the true baseline for a checkout that
     eleven other agents are writing to: HEAD plus every uncommitted edit
     this wave does NOT own, so the two columns differ by exactly the quake
     files. An explicit --before URL still wins. */
  async launchSides(ctx) {
    return baselineBuild(ctx, {
      owned: [
        "src/systems/quake.js",
        "src/systems/disasters.js",
        "tools/visual-presets/quake-stages.mjs",
      ],
    });
  },
  metricsNote: "Counts come from CBZ.quakeAudit() and CBZ.disasterAudit(), measured off live state at the moment of the frame; strip metrics are sampled tick-by-tick over exactly the photographed seconds. debrisSpawned 0 on a build means the quake only shook the camera; quakeMag 0 means the build has no magnitude at all (every quake the same size); knockdowns 0 through an M8 means the ground never took anyone's feet. camShakePerTickM is the same camera-displacement ruler tools/shark-shake-check.mjs reads.",
  metrics: {
    quakeMag: { label: "Magnitude (Richter)" },
    pgaPeakG: { label: "Peak ground acceleration", unit: "g" },
    quakeDurSecs: { label: "Active duration", unit: "s" },
    camShakePerTickM: { label: "Camera shake per tick (strip)", unit: "m" },
    camShakeMaxM: { label: "Camera shake, worst tick (strip)", unit: "m" },
    carsInMotion: { label: "Cars off their rest pose (strip)", better: "higher" },
    playerDownPct: { label: "Player off their feet (strip)", unit: "%" },
    knockdowns: { label: "Footing knockdowns" },
    staggers: { label: "Staggers" },
    aftershocksFired: { label: "Aftershocks fired" },
    debrisSpawned: { label: "Debris spawned", better: "higher" },
    debrisHits: { label: "Debris strikes on people", better: "higher" },
    debrisKills: { label: "Debris kills", better: "higher" },
    coverAnchors: { label: "Cover anchors in world", better: "higher" },
    coverSaves: { label: "Hits absorbed by cover", better: "higher" },
    ducked: { label: "Bots that took cover", better: "higher" },
    gasFires: { label: "Gas fires", better: "higher" },
    linesDown: { label: "Downed live lines", better: "higher" },
    chained: { label: "Chained events", better: "higher" },
    tickAvgMs: { label: "Sim tick avg", unit: "ms", better: "lower" },
    tickMaxMs: { label: "Sim tick worst", unit: "ms", better: "lower" },
    drawCalls: { label: "Draw calls", better: "lower" },
  },
  subjects,
  stage: stageQuake,
};

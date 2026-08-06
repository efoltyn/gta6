/* THE STRATOVOLCANO storyboard for tools/visual-compare.mjs.

   Boots the REAL survival mode (title → Disaster Survival → Play), freezes
   the rAF loop, forces the director to the volcano, and photographs the same
   simulated seconds of the same seeded eruption on both sides. Then it forces
   the NUKE and photographs the finale, wide and from inside.

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
     nuke-wide    the finale from off-island: the REAL gang-city mushroom
                  (city/nukefx.js) standing over the arena.
     nuke-pov     the death view. You see light, not geometry.

   Metrics ride the two ratchets: CBZ.volcanoAudit() (lavaTransparent MUST be
   0 — that is the owner's "see thru" complaint as a number) and
   CBZ.disasterAudit() (pyroRuns / laharRuns / ashRoofCollapses /
   nukeUsedNukefx / cameraFar). */

/* EACH HAZARD BEAT RE-FORCES THE ERUPTION. The volcano's active window is
   20 s and there are five things to photograph in it; a single run cannot
   hold all five at the age each one wants, and a beat that arrives after the
   event ended photographs an empty hillside (it did, twice, before this).
   Forcing per beat costs ~6 s of warn each time and buys every beat its own
   correctly-aged eruption on both sides of the comparison. */
const subjects = [
  { id: "warn-lane", label: "Warning — the lane announces itself", hud: false,
    focus: "Warn phase, no words. The crater glows, ash starts, and ROCK is already coming down the corridor the pyroclastic flow will take. Before-side: a glowing disc and nothing about direction.",
    act: { force: "volcano", untilState: "warn", extraSecs: 4.2 },
    cam: { lane: true, ahead: 60, side: 26, alt: 26, fallback: { x: 108, y: 46, z: 672, ax: 0, ay: 20, az: 600 } } },

  { id: "column", label: "ACT 1 — the column climbs", hud: false,
    focus: "First seconds of the active phase: the vent opens, the column starts climbing out of it. Before-side: three THREE.Points clouds — untextured square dots you can count individually, with empty bands between them (the owner's 'separate rocks ... several circular clouds').",
    /* FORCES ITS OWN ERUPTION. The three ACT beats are one continuous event
       — that is the point of them — so only the first may inherit, and it
       must not inherit from `warn-lane`: --subjects can drop that beat, and
       when it did, ACT 2 photographed a lightning storm. */
    act: { force: "volcano", untilState: "active", extraSecs: 3.2 },
    cam: { x: 118, y: 40, z: 686, ax: 0, ay: 30, az: 600 } },

  { id: "column-tall", label: "ACT 2 — sustained, and it KEEPS going", hud: false,
    focus: "Fourteen seconds in, the middle of the event. Reference: Mount St Helens. One continuous opaque cauliflower — narrow incandescent gas thrust at the vent, convective stem, and an umbrella several times wider than the stem spreading downwind. Pale grey, not brown. Before-side: the event is nearly OVER by now (it was 20 s, not 36).",
    act: { extraSecs: 11 },
    // far enough back that the UMBRELLA fits: the cap is the silhouette, and
    // a frame that crops it is a photograph of a stem
    cam: { x: 235, y: 150, z: 880, ax: 0, ay: 150, az: 600 } },

  { id: "ash-out", label: "ACT 3 — the island inside its own cloud", hud: false,
    focus: "Thirty seconds in. THE OWNER'S ASK: 'when it ends it's a huge gray cloud ... just fill the entire map with a cloud'. The column loses buoyancy and comes down, and 300 m of visibility collapses to 26 — driven through the scene's own fog, which costs nothing and works at every distance. It goes BRIGHTER, not darker: inside fine ash you are in a luminous grey nothing, so the sun goes out and the hemi comes up. Before-side has no third act at all.",
    act: { extraSecs: 16 },
    cam: { x: 46, y: 16, z: 664, ax: -4, ay: 8, az: 618 } },

  { id: "lava-day", label: "The flow — black plate, glowing CRACKS", hud: false,
    focus: "Reference: Fagradalsfjall. A flow is not a dark ribbon with a bright stripe down it — it is a near-black crusted PLATE broken into slabs, with the incandescence showing through a network of seams that pinch and gape, plus one small very bright throat at the vent. Before-side: a wide bright channel painted down the middle, and four fat ribbons instead of eight thin rivulets.",
    // its OWN eruption: this beat used to inherit whatever second the previous
    // one left behind, and with a 36 s event that landed it inside the ash-out
    // photographing a white screen
    act: { force: "volcano", untilState: "active", extraSecs: 9 },
    cam: { lava: true, side: 15, alt: 8, back: 19, fallback: { x: 26, y: 12, z: 626, ax: 4, ay: 4, az: 606 } } },

  { id: "pyroclastic", label: "Pyroclastic flow — mid-descent", hud: false,
    focus: "THE KILLER. A ground-hugging avalanche of 600 C rock and gas boiling down the fall line at 6x sprinting speed, engulfing its lane. Opaque overlapping billows with an incandescent basal fringe — not translucent orange rocks. Before-side has no such hazard at all.",
    act: { force: "volcano", untilState: "active", extraSecs: 5.4, needLine: true },
    cam: { lane: true, ahead: 44, side: 15, alt: 34, fallback: { x: 96, y: 34, z: 664, ax: 0, ay: 16, az: 604 } } },

  { id: "lahar", label: "Lahar in the channel", hud: false,
    focus: "Wet concrete: a matte grey-brown mud river down the VALLEY rather than the fall line, carrying boulders and logs. Slower than the flow, and it sets where it stops.",
    act: { force: "volcano", untilState: "active", extraSecs: 11.5 },
    cam: { lahar: true, ahead: 34, side: 22, alt: 24, fallback: { x: 62, y: 20, z: 660, ax: 0, ay: 6, az: 612 } } },

  { id: "ash-street", label: "Ash with weight — the town", hud: false,
    focus: "The blanket. Ash accumulates as COVERAGE, not as a translucent sheet: the downwind ground and roofs grey over while upwind stays green, and past ~9 cm the roofs start failing through the ONE structural ledger. audit_ashRoofCollapses is the number.",
    act: { force: "volcano", untilState: "active", extraSecs: 17.5 },
    cam: { x: 46, y: 15, z: 662, ax: -6, ay: 3, az: 618 } },

  { id: "lava-cold", label: "AFTER — it turns black and hardens", hud: false,
    focus: "Four seconds after the eruption ends. OWNER: 'the other picture actually shows what it looks like at the end where it turns kinda black and hardens.' The cracks close, the glow goes out over ~9 s and the flows STAY — eight black basalt tongues down the cone for the rest of the match. Before-side deleted every flow the instant the timer ran out.",
    act: { force: "volcano", untilState: "active", extraSecs: 41 },
    cam: { x: 92, y: 44, z: 690, ax: 0, ay: 26, az: 604 } },

  { id: "lava-night", label: "Lava at night — it lights the hill", hud: false,
    focus: "The same flow after dark. The channel is an UNLIT material, so it stays exactly as bright as it was at noon (that IS incandescence), and its pooled point lights paint the hillside around it. The eruption's own sky tint now follows the day cycle instead of overriding night into noon.",
    act: { night: true, force: "volcano", untilState: "active", extraSecs: 4.5 },
    cam: { lava: true, side: 15, alt: 8, back: 19, fallback: { x: 26, y: 12, z: 626, ax: 4, ay: 4, az: 606 } } },

  { id: "nuke-fireball", label: "The finale — t+7s, the fireball", hud: false,
    focus: "Seven seconds in: still the incandescent phase, hot billows and the cap glow. Orange here is CORRECT — it is a fireball. The complaint was about the end stage, which is the next two beats.",
    act: { day: true, force: "nuke", untilState: "active", extraSecs: 7.0 },
    cam: { x: 0, y: 460, z: 1850, ax: 0, ay: 700, az: 600 } },

  { id: "nuke-wide", label: "The nuclear finale — the mature cloud", hud: false,
    focus: "t+26s, THE END STAGE the owner was describing. This must be city/nukefx.js's RESEARCHED mushroom standing over the island — cap kilometres up, one coherent grey-brown body. Before-side clipped it off at the 1 km far plane and left the low ground-surge lobes hanging unfogged: the 'orange floating rocks'.",
    act: { extraSecs: 19 },
    cam: { x: 0, y: 620, z: 2950, ax: 0, ay: 1750, az: 600 } },

  { id: "nuke-landmark", label: "The finale — the cloud as a landmark", hud: false,
    focus: "t+70s. NUKE_FX_AFTERMATH keeps the cloud maturing over the island instead of deleting it. With the arena frustum open it is finally VISIBLE from the island; before, the far plane cut it off entirely.",
    act: { extraSecs: 44 },
    cam: { x: 0, y: 620, z: 3900, ax: 0, ay: 2300, az: 600 } },

  { id: "nuke-pov", label: "The nuclear finale — from inside it", hud: true,
    focus: "The death view. Standing in it you see LIGHT, not geometry: the #nukeFlash whiteout, the same sheet the gang city uses. HUD left on so the sheet is photographed where the player sees it.",
    act: { atGroundZero: true, extraSecs: 0.35 },
    cam: { player: true, back: 7, up: 3 } },
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

    S = window.__volcanoSeq = { overlay, dayPhase: null };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
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

  if (act.force) { CBZ.disasters.force(act.force); step(0.1); }
  if (act.untilState) stepUntilState(act.untilState, 30);
  if (act.extraSecs) step(act.extraSecs);

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
    // fronts; frame the one furthest down the hill, from downslope, so the
    // shot looks UP the channel at the incandescent core.
    try {
      const A = CBZ.volcanoAudit ? CBZ.volcanoAudit() : null;
      const tips = (A && A.lavaTips) || [];
      const hill = (CBZ.surv && CBZ.surv.arena) ? CBZ.surv.arena.hills[0] : { x: 0, z: 600 };
      let best = null, bd = -1;
      for (const t of tips) {
        const d = Math.hypot(t.x - hill.x, t.z - hill.z);
        if (d > bd) { bd = d; best = t; }
      }
      if (best && bd > 4) {
        const dx = (best.x - hill.x) / bd, dz = (best.z - hill.z) / bd;
        aimed = {
          x: best.x + dx * (cam.back || 10) - dz * (cam.side || 11),
          y: best.y + (cam.alt || 6),
          z: best.z + dz * (cam.back || 10) + dx * (cam.side || 11),
          ax: best.x - dx * 6, ay: best.y + 1.2, az: best.z - dz * 6,
        };
        aimNote = "lava front";
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
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
    if (skyRig && skyRig.position) skyRig.position.set(camera.position.x, 0, camera.position.z);
  }
  if (!subject.hud) setHud(false);
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
      `ash ${vol ? vol.ashPeakDepth : "-"} m · roofs ${dis ? dis.ashRoofs : "-"} @ ${dis ? dis.ashRoofMax : "-"} m · lost ${dis ? dis.ashRoofCollapses : "-"} · nukefx ${dis && dis.nukeUsedNukefx ? "YES" : "no"}`
    : "—";
  query("perf").style.cssText = `position:absolute;right:24px;top:24px;text-align:right;white-space:pre-line;line-height:1.5;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:${maxMs > 100 ? "#ff9c9c" : "#9fe8c3"}`;
  query("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  query("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  const metrics = {
    tickAvgMs: ticks ? Number((totalMs / ticks).toFixed(2)) : 0,
    tickMaxMs: Number(maxMs.toFixed(1)),
    ticksOver33: over33,
    drawCalls: Number(render.calls || 0),
    cameraFar: Math.round(camera.far),
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
  title: "The Stratovolcano (and an honest nuke)",
  description: "One seeded survival match per build, the director forced through the volcano and then the nuclear finale, stepped to identical simulated seconds. The travelling beats aim themselves off CBZ.disasters.hazards() so the camera stands on the flank of the ACTUAL flow rather than a guessed hillside. vol_lavaTransparent is the owner's 'see thru' complaint as a number and must read 0; audit_nukeUsedNukefx says whether the finale drew city/nukefx.js's real mushroom or something standing in for it.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metricsNote: "vol_* comes from CBZ.volcanoAudit() (world/volcanofx.js) and audit_* from CBZ.disasterAudit(). lavaTransparent counts LIVE lava materials that are transparent or additively blended — the thing the owner could see through. cameraFar is the finale's frustum: below ~2600 the mushroom's cap is clipped off.",
  metrics: {
    vol_lavaTransparent: { label: "See-through lava materials", better: "lower" },
    vol_lavaFlows: { label: "Live lava flows", better: "higher" },
    vol_pyroLive: { label: "Pyroclastic flows live", better: "higher" },
    vol_ashPeakDepth: { label: "Peak ash depth", unit: "m", better: "higher" },
    audit_pyroRuns: { label: "Pyroclastic runs", better: "higher" },
    audit_laharRuns: { label: "Lahar runs", better: "higher" },
    audit_ashRoofCollapses: { label: "Roofs lost to ash load", better: "higher" },
    audit_nukeUsedNukefx: { label: "Finale used nukefx", better: "higher" },
    cameraFar: { label: "Camera far plane", unit: "m", better: "higher" },
    tickAvgMs: { label: "Sim tick avg", unit: "ms", better: "lower" },
    tickMaxMs: { label: "Sim tick worst", unit: "ms", better: "lower" },
    drawCalls: { label: "Draw calls", better: "lower" },
  },
  subjects,
  stage: stageVolcano,
};

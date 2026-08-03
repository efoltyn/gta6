/* Diamond Speedway STUDIO for tools/visual-compare.mjs.

   This is not a storyboard of one event (see nuke-sequence.mjs for that) —
   it is a camera rig for ONE venue. Every subject below is a tripod written
   in TRACK COORDINATES, and the stage is a generic interpreter of those
   fields. Adding a shot, a close-up or a whole new layer later is one line
   in `subjects`, not new browser code. That is what makes it a studio.

   THE COORDINATE SYSTEM. Nothing here is a hardcoded world position. Every
   camera and every aim point is (t, s, u, h):
     t  lap fraction on the centreline, 0 = the start/finish line
     s  metres further along the track from t (converted with the real lap
        length, CBZ.speedwayTrackLen)
     u  metres outboard of the centreline along the frame's OUTWARD normal
        (negative = infield). May be given as {apron: d} = APRON_EDGE + d or
        {wall: d} = SAFER-wall centreline + d, both derived live from the
        frame's own halfW, so a change to the cross-section moves the camera
        with it instead of leaving it inside a wall.
     h  metres above the DRAWN surface at that point (CBZ.speedwaySurfaceY,
        the same oracle the ribbon mesh and the car conformer use), or `y`
        for an absolute world height, or `gantrySign` for an offset from the
        live-computed centre of the start/finish sign.
   CBZ.speedwayFrame(t) is the authoritative frame and exists on the deployed
   build too, so the BEFORE side resolves the identical geometry.

   WHY THE SIGN SHOTS ARE SHAPED LIKE THIS. The gantry sign is a 0.2 m-thin
   box whose faces point UP and DOWN the straight (island_speedway.js builds
   it with width on the normal, depth on the tangent), so the only way to
   read it is from on the racing line, at sign height, 58 m away — once from
   each side. Two subjects, not one: a mirrored back face is invisible until
   you photograph the back. The two hoarding shots are the same board from
   cameras 0.4 m apart: a still cannot show flicker, but z-fighting is
   view-dependent, so a pair that disagrees IS the flicker, on paper.

   STAGING FACTS THIS PRESET DEPENDS ON (verified 2026-08-02):
   - core/loop.js re-arms itself through requestAnimationFrame, so stubbing
     rAF after boot freezes the world; CBZ.stepSim(dt) is then the only clock
     and both sides sample the same simulated seconds on any machine.
   - core/sky.js parents the sky to a rig that follows the camera at y = 0
     under an r = 850 dome: every tripod stays under ~700 m and the rig is
     recentred by hand before each render, or the sky reads as a ball.
   - The race is the REAL one: citySpawnOwnedCar → cityEnterVehicle →
     cityStartSpeedwayRace, which builds the six-car championship field on
     the painted grid and hands the player the back row. The gantry lights,
     the jumbotron and the scoring pylon are driven by the speedway's own
     CBZ.onUpdate, so stepping the sim runs the countdown for free.
   - racehud.js appends #raceHud, #raceLights and #raceBoard as direct body
     children; the HUD sweep hides everything but the canvas and re-shows
     exactly those three for the subjects that declare showRaceUI.
   - If a side cannot start a race (module missing on the deployed build) the
     stage still returns ok:true and photographs the empty track — a report
     that dies proves nothing.  */

const subjects = [
  {
    id: "stadium-aerial",
    label: "01 · Diamond Speedway from the air",
    focus: "The whole campus as one object: tri-oval, embankment, stands, infield, paddock and car park. Read the silhouette and the seams between the venue and the island.",
    cam: { t: 0.60, u: 430, h: 300 }, aim: { center: true, y: 16 }, fov: 46, settle: 60,
  },
  {
    id: "stadium-ground",
    label: "02 · The ground beneath it",
    focus: "Trackside at grade: graded embankment, SAFER wall, banked racing surface, apron, and the infield behind. The venue has to stand ON terrain, not float over a plate.",
    cam: { t: 0.135, u: 42, h: 8 }, aim: { t: 0.03, u: { apron: 2 }, h: 1.6 }, fov: 62, settle: 24,
  },
  {
    id: "gantry-sign-front",
    label: "03 · Gantry sign, approach face",
    focus: "DIAMOND SPEEDWAY as a driver reads it on the run to the line. Text upright and legible, panel opaque, lattice struts in FRONT of the panel where the truss actually is.",
    cam: { t: 0, s: -58, u: -2, gantrySign: 0 },
    aim: { t: 0, u: { gantryMid: true }, gantrySign: 0 }, fov: 32, settle: 12,
  },
  {
    id: "gantry-sign-back",
    label: "04 · Gantry sign, back face",
    focus: "The same panel from the other side. A sign textured on one face and mirrored on the other shows here and nowhere else — read the letters, not the colour.",
    cam: { t: 0, s: 58, u: -2, gantrySign: 0 },
    aim: { t: 0, u: { gantryMid: true }, gantrySign: 0 }, fov: 32, settle: 12,
  },
  {
    id: "jumbotron",
    label: "05 · Infield jumbotron",
    focus: "The 22 x 12 screen on its raked frame, shot from the apron it faces. Emissive panel flush in its bezel, support struts behind it, no z-fight halo around the screen edge.",
    cam: { t: -0.05, s: 26, u: { apron: -6 }, h: 16 },
    aim: { t: -0.05, u: -60, y: 15 }, fov: 38, settle: 16,
  },
  {
    id: "pylon",
    label: "06 · Scoring pylon",
    focus: "The 34 m lattice pylon and its four position boards. Boards must sit outboard of the lattice, not inside it, and the crown label must read from the stand side.",
    cam: { t: 0.055, s: 34, u: { apron: -8 }, h: 26 },
    aim: { t: 0.055, u: -62, y: 21 }, fov: 50, settle: 16,
  },
  {
    id: "hoardings-graze",
    label: "07 · Sponsor hoardings, grazing angle",
    focus: "Sixty metres of turn-1 hoarding seen almost edge-on. Coplanar decals tear into stripes at this angle — the defect a head-on shot hides.",
    cam: { t: 0.135, u: { apron: -1.0 }, h: 1.15 },
    aim: { t: 0.30, u: { apron: -2.6 }, h: 0.7 }, fov: 42, settle: 10,
  },
  {
    id: "hoardings-graze-b",
    label: "08 · Same hoarding, camera moved 0.4 m",
    focus: "The A/B of shot 07. Two cameras 0.4 m apart must show the SAME board; any panel that changes between them is z-fighting, which in motion is the flicker.",
    cam: { t: 0.135, s: 0.4, u: { apron: -1.15 }, h: 1.15 },
    aim: { t: 0.30, u: { apron: -2.6 }, h: 0.7 }, fov: 42, settle: 0,
  },
  {
    id: "race-start",
    label: "09 · Green flag",
    focus: "A real race: six championship cars on the painted grid, the player in the back row, stepped through the 3.9 s countdown to lights out under the gantry.",
    raceAction: "start", showRaceUI: true,
    cam: { t: 0, s: -62, u: 6, h: 5.5 }, aim: { t: 0, s: 6, u: 0, h: 7 }, fov: 54,
  },
  {
    id: "race-running",
    label: "10 · Fifteen seconds in",
    focus: "The pack mid-race, framed on its own centre of mass from outside the wall. Cars on the banking, HUD live, venue working as a venue.",
    raceAction: "advance", advanceSec: 15, showRaceUI: true,
    cam: { rel: true, s: -40, u: { wall: 14 }, h: 8 },
    aim: { rel: true, s: 12, u: 0, h: 1.6 }, fov: 46,
  },
];

async function stageRaceStadium(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const subject = input.subject || {};
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };

  let S = window.__raceStadium;
  if (!S) {
    // ---- one-time: boot the real world into free play --------------------
    const booted = await until(
      () => CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") &&
        CBZ.stepSim && document.getElementById("playBtn"),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 120000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    // Headless SwiftShader settles into the LOW quality tier; the owner plays
    // at high, and signage/emissive detail differs by tier. Pin it.
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    try { if (CBZ.dayPhase) CBZ.dayPhase(0.45); } catch (_) {}   // legible daylight

    // Freeze the rAF loop: CBZ.stepSim becomes the only clock.
    window.requestAnimationFrame = function () { return 0; };
    await wait(700); // let the already-scheduled frame fire and die

    for (let i = 0; i < 120; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    const overlay = document.createElement("div");
    overlay.id = "__raceStadiumOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__raceStadium = {
      overlay: overlay, raceStarted: false, raceGreen: false, raceNote: null,
      simT: 0, g: null,
    };
    window.__cbzVisualCompare = {
      render() {
        try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {}
      },
    };
  }

  if (typeof CBZ.speedwayFrame !== "function") {
    return { ok: false, err: "no CBZ.speedwayFrame on this build" };
  }
  const LEN = (typeof CBZ.speedwayTrackLen === "function" && CBZ.speedwayTrackLen()) || 1000;

  // ---- track-space helpers (all derived, nothing hardcoded) --------------
  const surfaceY = (x, z) => {
    let y = 0;
    try { y = Number(CBZ.speedwaySurfaceY ? CBZ.speedwaySurfaceY(x, z) : 0) || 0; } catch (_) { y = 0; }
    let f = 0;
    try { f = Number(CBZ.floorAt ? CBZ.floorAt(x, z) : 0) || 0; } catch (_) { f = 0; }
    return Math.max(y, f);
  };

  if (!S.g) {
    // The gantry geometry, re-derived from the live cross-section: the towers
    // stand at APRON_EDGE-4.5 (infield) and WALL_U+9 (outfield), the beam is
    // 10.5 m over the taller foot and the sign hangs 3.4 m above the beam.
    const f0 = CBZ.speedwayFrame(0);
    const halfW = Number(f0.halfW) || 11;
    const uIn = -(halfW + 9) - 4.5, uOut = halfW + 1.6 + 9;
    const footY = (u) => surfaceY(f0.x + f0.nx * u, f0.z + f0.nz * u);
    const beam = Math.max(footY(uIn), footY(uOut)) + 10.5;
    // Campus centre: the mean of eight frames, so the aerial aims at the
    // oval's own centroid rather than a copied constant.
    let cx = 0, cz = 0;
    for (let i = 0; i < 8; i++) { const f = CBZ.speedwayFrame(i / 8); cx += f.x; cz += f.z; }
    S.g = { halfW, uIn, uOut, midU: (uIn + uOut) / 2, signY: beam + 3.4, cx: cx / 8, cz: cz / 8 };
  }

  const resolveU = (u) => {
    if (u == null) return 0;
    if (typeof u === "number") return u;
    if (u.gantryMid) return S.g.midU;
    if (u.apron != null) return -(S.g.halfW + 9) + Number(u.apron);   // APRON_EDGE + d
    if (u.wall != null) return S.g.halfW + 1.6 + Number(u.wall);      // WALL_U + d
    return 0;
  };
  const resolveNode = (node, baseT) => {
    const n = node || {};
    if (n.center) return { x: S.g.cx, y: Number(n.y || 0), z: S.g.cz };
    let t = (n.rel ? baseT : 0) + Number(n.t || 0) + Number(n.s || 0) / LEN;
    t -= Math.floor(t);
    const f = CBZ.speedwayFrame(t);
    const u = resolveU(n.u);
    const x = f.x + f.nx * u, z = f.z + f.nz * u;
    let y;
    if (n.gantrySign != null) y = S.g.signY + Number(n.gantrySign);
    else if (n.y != null) y = Number(n.y);
    else y = surfaceY(x, z) + Number(n.h || 0);
    return { x: x, y: y, z: z };
  };

  // ---- the sim clock ----------------------------------------------------
  let ticks = 0, totalMs = 0, maxMs = 0, over33 = 0;
  const tick = (dt) => {
    CBZ.hitstop = 0; CBZ.slowmo = 0;
    const step = dt || 1 / 60;
    const t0 = performance.now();
    try { CBZ.stepSim(step); } catch (_) {}
    const ms = performance.now() - t0;
    S.simT += step;
    ticks++; totalMs += ms;
    if (ms > maxMs) maxMs = ms;
    if (ms > 33) over33++;
    try { if (CBZ.player) CBZ.player.hp = 100; } catch (_) {}
  };

  // ---- race actions -----------------------------------------------------
  const greenFlag = () => {
    try {
      const list = CBZ.raceDrivers ? CBZ.raceDrivers.list("speedway") : null;
      if (list && list.length) return list.some((m) => m.state !== "grid");
      const R = CBZ.speedwayRaceState ? CBZ.speedwayRaceState() : null;
      return !!(R && R.active && R.phase !== "grid");
    } catch (_) { return true; }
  };
  if (subject.raceAction === "start" && !S.raceStarted) {
    S.raceStarted = true;
    try {
      // Spawn beside the line from the FRAME, never from a copied coordinate.
      const f0 = CBZ.speedwayFrame(0);
      const sx = f0.x + f0.nx * -5, sz = f0.z + f0.nz * -5;
      const car = CBZ.citySpawnOwnedCar ? CBZ.citySpawnOwnedCar(sx, sz, "Ferrari 488") : null;
      if (!car) {
        S.raceNote = "citySpawnOwnedCar unavailable — shooting the empty track";
      } else {
        if (CBZ.player && CBZ.player.pos) CBZ.player.pos.set(car.pos.x, 0, car.pos.z);
        if (CBZ.cityEnterVehicle) CBZ.cityEnterVehicle(car);
        if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(1000);
        if (CBZ.cityStartSpeedwayRace) CBZ.cityStartSpeedwayRace();
        else S.raceNote = "cityStartSpeedwayRace unavailable — shooting the empty track";
      }
    } catch (e) {
      S.raceNote = "race start threw: " + ((e && e.message) || e);
    }
    // Countdown is RACE.countT = 3.9 s; the gantry lamps run off the speedway
    // updater, so stepping the sim IS the countdown. Cap the wait at 10 s.
    let guard = 0;
    while (!greenFlag() && guard < 600) { tick(); guard++; }
    S.raceGreen = greenFlag();
  } else if (subject.raceAction === "advance") {
    const n = Math.round(Number(subject.advanceSec || 10) * 60);
    for (let i = 0; i < n; i++) tick();
  }

  // ---- where the pack is (circular mean of the field's lap params) -------
  let packT = 0;
  {
    let sx = 0, sz = 0, n = 0;
    const add = (t) => {
      if (!Number.isFinite(t)) return;
      const a = t * Math.PI * 2; sx += Math.cos(a); sz += Math.sin(a); n++;
    };
    try {
      const list = CBZ.raceDrivers ? CBZ.raceDrivers.list("speedway") : null;
      if (list) for (const m of list) add(Number(m.t));
    } catch (_) {}
    if (!n) {
      try {
        const R = CBZ.speedwayRaceState ? CBZ.speedwayRaceState() : null;
        if (R && R.racers) for (const r of R.racers) add(Number(r.t));
      } catch (_) {}
    }
    if (n) { packT = Math.atan2(sz, sx) / (Math.PI * 2); packT -= Math.floor(packT); }
  }

  // ---- the tripod: resolved here, COPIED on the after side ---------------
  let camPos, camTarget, fov;
  const ref = input.referenceStage && input.referenceStage.camera;
  if (ref && ref.pos && ref.target) {
    camPos = { x: ref.pos[0], y: ref.pos[1], z: ref.pos[2] };
    camTarget = { x: ref.target[0], y: ref.target[1], z: ref.target[2] };
    fov = Number(ref.fov) || 50;
  } else {
    camPos = resolveNode(subject.cam, packT);
    camTarget = resolveNode(subject.aim, packT);
    fov = Number(subject.fov) || 50;
  }

  // Outside a race the player is the streaming anchor: park them under the
  // aim point so peds, cars and props are resident before the shutter opens.
  if (!S.raceStarted && CBZ.player && CBZ.player.pos) {
    const py = surfaceY(camTarget.x, camTarget.z);
    CBZ.player.pos.set(camTarget.x, py + 1.1, camTarget.z);
    CBZ.player.hp = 100;
  }
  const settle = subject.raceAction ? 0 : Math.round(Number(subject.settle == null ? 24 : subject.settle));
  for (let i = 0; i < settle; i++) tick();

  // ---- HUD sweep: canvas only, plus the race UI when a shot asks for it --
  {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    const allow = subject.showRaceUI ? ["raceHud", "raceLights", "raceBoard"] : [];
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__raceStadiumOverlay") continue;
      child.style.visibility = allow.indexOf(child.id) >= 0 ? "" : "hidden";
    }
  }

  // ---- pose and render once ---------------------------------------------
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = fov;
  camera.near = 0.4;
  camera.far = 40000;
  camera.position.set(camPos.x, camPos.y, camPos.z);
  camera.lookAt(camTarget.x, camTarget.y, camTarget.z);
  camera.updateProjectionMatrix();
  // core/sky.js: the sky rides a rig that the (frozen) loop normally keeps
  // under the camera at y = 0. Recentre it by hand or the sky is a ball.
  const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
  if (skyRig && skyRig.position) skyRig.position.set(camPos.x, 0, camPos.z);
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const render = (CBZ.renderer.info || {}).render || {};

  // ---- caption ----------------------------------------------------------
  const before = input.side === "before";
  const query = (name) => S.overlay.querySelector("[data-" + name + "]");
  query("side").textContent = before ? input.beforeLabel : input.afterLabel;
  query("side").style.cssText = "position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:" + (before ? "#c94c4c" : "#218b60") + ";font-size:12px;font-weight:900;letter-spacing:.12em";
  query("name").textContent = subject.label || subject.id;
  query("name").style.cssText = "position:absolute;top:64px;left:26px;font-size:27px;font-weight:800;letter-spacing:-.02em";
  query("focus").textContent = subject.focus || "";
  query("focus").style.cssText = "position:absolute;top:100px;left:28px;color:#c0cfda;font-size:13px;font-weight:550;max-width:720px";
  const perfBits = [];
  if (ticks) perfBits.push("sim " + ticks + " ticks · worst " + maxMs.toFixed(0) + "ms");
  perfBits.push("draws " + (render.calls || 0));
  if (subject.raceAction) perfBits.push(S.raceGreen ? "GREEN" : "no race");
  if (S.raceNote && subject.raceAction) perfBits.push(S.raceNote);
  query("perf").textContent = perfBits.join(" · ");
  query("perf").style.cssText = "position:absolute;right:24px;top:24px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:" + (maxMs > 100 ? "#ff9c9c" : "#9fe8c3");
  query("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  query("source").style.cssText = "position:absolute;bottom:18px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  const metrics = { drawCalls: Number(render.calls || 0), triangles: Number(render.triangles || 0) };
  if (ticks) {
    metrics.tickAvgMs = Number((totalMs / ticks).toFixed(2));
    metrics.tickMaxMs = Number(maxMs.toFixed(1));
    metrics.ticksOver33 = over33;
  }

  return {
    ok: true,
    simT: Number(S.simT.toFixed(2)),
    packT: Number(packT.toFixed(4)),
    raceGreen: !!S.raceGreen,
    note: S.raceNote || null,
    camera: {
      pos: [camPos.x, camPos.y, camPos.z],
      target: [camTarget.x, camTarget.y, camTarget.z],
      fov: fov,
    },
    metrics: metrics,
  };
}

export default {
  id: "race-stadium",
  title: "Diamond Speedway: Studio",
  description: "A camera rig for one venue. Ten tripods written in track coordinates — campus aerial, ground and banking, both faces of the start/finish sign, jumbotron, scoring pylon, a hoarding shot twice from 0.4 m apart, and a real six-car championship race stepped from lights-out to fifteen seconds in. Same seed, same frozen clock, same framing on both builds.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  defaultFocus: "Compare signage legibility, panel depth-sorting, strut occlusion and how the venue meets the ground.",
  pairNote: "Same seed · frozen rAF · sim clock · track-space tripod · viewport",
  method: "One page per build boots the real world at seed 90210, freezes requestAnimationFrame and advances only through CBZ.stepSim, so both sides photograph the same simulated seconds. Every tripod is resolved from CBZ.speedwayFrame in track coordinates on the BEFORE side and copied verbatim to the AFTER side, so the source change is the only variable.",
  metricsNote: "Draw calls and triangles from each tripod, plus the cost of the sim ticks that subject advanced (the race subjects are the ones that step real time).",
  metrics: {
    drawCalls: { label: "Draw calls", better: "lower" },
    triangles: { label: "Triangles", better: "lower" },
    tickAvgMs: { label: "Sim tick avg", unit: "ms", better: "lower" },
    tickMaxMs: { label: "Sim tick worst", unit: "ms", better: "lower" },
    ticksOver33: { label: "Ticks over 33 ms", better: "lower" },
  },
  subjects,
  stage: stageRaceStadium,
};

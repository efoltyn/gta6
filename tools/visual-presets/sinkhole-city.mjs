/* THE SINKHOLE storyboard for tools/visual-compare.mjs.

   Owner reference: the 2010 Guatemala City sinkhole — a sheer-walled shaft
   that swallowed an intersection, the road sheared clean at the lip, the
   buildings standing intact at the edge, stratified walls going black with
   depth, far deeper than it is wide. These beats photograph whether that
   picture is on the screen.

   Staging is the disaster-sequence.mjs skeleton (verified 2026-08-02): boot
   the REAL survival mode from the title card, freeze rAF so CBZ.stepSim is the
   only clock, force the director with CBZ.disasters.force("sinkhole") and poll
   CBZ.disasters.state(). Every camera that looks at a hole is aimed at the LIVE
   shaft record (CBZ.groundShafts / CBZ.survHoles), never at a typed coordinate:
   the before build's holes and the after build's holes are in different places
   and a fixed camera would photograph empty grass on one side.

   The camera is derived from the shaft: `cam.frame` says WHERE relative to the
   hole (oblique / lip / bottom), and the framing solves off the shaft's own
   radius and depth. That is also the degrade path — a side with no shaft at all
   still gets a picture of the ground where one should be. */

const subjects = [
  { id: "warn-cracks", label: "The warning — cracks at the site", hud: false,
    focus: "Warn phase. BEFORE scatters hairline cracks at random points across the whole island (information you cannot act on). AFTER opens a ring of cracks AT the site, dust venting out of them and slabs already tipping inward — and warnSafeDir points off it, so the crowd moves.",
    act: { force: "sinkhole", untilState: "warn", extraSecs: 3.0 },
    cam: { frame: "warn" } },
  { id: "first-drop", label: "The first drop", hud: false,
    focus: "The core plug goes at full depth with a dust burst and rim chunks shearing off the edge. Anything standing on it is entrained inward and DOWN — bots fall (CBZ.body owns them mid-air), they no longer teleport to the floor.",
    act: { untilState: "active", extraSecs: 1.4 },
    cam: { frame: "oblique", near: true } },
  /* THE BEAT THE OWNER IS ACTUALLY LOOKING AT. Every other camera here is
     raised and oblique, which is the one condition under which a shaft cannot
     help reading as a shaft — you are above it, so you see down it. A player
     is almost never above it: the third-person camera puts a hole 80 m away
     about 9° below the horizon, the near rim occludes the whole interior, and
     what reaches the screen is three metres of far wall plus the lip. If that
     is bright, the sinkhole is a ring, and no oblique storyboard would ever
     have shown it. This frame is that photograph. */
  { id: "from-far-away", label: "From far away — the ring test", hud: false,
    focus: "The player's own viewing angle: 80 m out, ~9° above the ground. The near rim hides the shaft's interior, so the ONLY thing on screen is the top few metres of the far wall, the lip collar and the topmost stair treads. BEFORE lights all three fully and paints the collar soil-brown across green grass — a ring. AFTER runs one sky-occlusion ladder from the rim down (throatShade) and gives the collar the ground's own colour, so the mouth reads as a void at the distance it is actually seen from.",
    act: { extraSecs: 1 },
    cam: { frame: "far" } },
  { id: "open-shaft", label: "The shaft — the Guatemala framing", hud: false,
    focus: "THE MONEY SHOT. Raised oblique: rim + depth + intact surroundings. Sheer stratified walls (topsoil→clay→silt→rock in vertex colour), a torn overhanging lip where the surface sheared, black at the bottom, and the ground beside it untouched.",
    act: { extraSecs: 9 },
    cam: { frame: "oblique" } },
  { id: "sheared-lip", label: "The sheared lip", hud: false,
    focus: "Close on the edge. The surface does not slope in — it STOPS, cut square, the crust standing proud over the soil section beneath it. The rim is torn per-vertex, never a machined circle.",
    act: { extraSecs: 1 },
    cam: { frame: "lip" } },
  { id: "from-the-bottom", label: "The bottom, looking up", hud: false,
    focus: "Where the owner's survival note happens: the rubble cone, the wedged slabs that publish VOID SPACES (the only thing that stops the burial DOT), the spiral of sheared ledges that is the way out, and the circle of daylight far above.",
    act: { extraSecs: 1, teleport: "bottom", thenSecs: 0.6 },
    cam: { frame: "bottom" } },
  { id: "island-wide", label: "The island keeps the scar", hud: false,
    focus: "Wide. The event is over and the hole is still there — end() no longer fills it in. Permanent damage is the point; a sinkhole that heals on a round timer is the same lie the black disc was.",
    act: { untilState: "idle", extraSecs: 2, dropIn: true },
    cam: { frame: "wide" } },
];

async function stageSinkhole(input) {
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
      if (child.id === "__shaftOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__shaftSeq;
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
    if (!CBZ.disasters || typeof CBZ.disasters.force !== "function") return { ok: false, err: "no CBZ.disasters.force" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    for (let i = 0; i < 90; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    const overlay = document.createElement("div");
    overlay.id = "__shaftOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__shaftSeq = { overlay };
    window.__cbzVisualCompare = { render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} } };
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
  const stepUntilState = (want, budgetSecs) => {
    let guard = Math.round((budgetSecs || 25) * 10);
    while (guard-- > 0 && CBZ.disasters.state() !== want) step(0.1);
  };

  // SELF-HEALING CHAIN. The beats are sequenced beats of ONE run, so a subject
  // normally inherits the hole the previous one opened. Running a subset
  // (--subjects, the cheap iteration loop) breaks that chain, so any beat that
  // needs a hole and cannot find one starts the event itself.
  const anyShaft = () => ((CBZ.groundShafts || CBZ.survHoles || []).length > 0);
  const needsShaft = (subject.cam || {}).frame !== "warn";
  if (needsShaft && !act.force && !anyShaft() && CBZ.disasters.current() !== "sinkhole") {
    CBZ.disasters.force("sinkhole");
    stepUntilState("active", 40);
    step(4);
  }
  if (act.force) { CBZ.disasters.force(act.force); step(0.1); }
  if (act.untilState) stepUntilState(act.untilState, 40);
  if (act.extraSecs) step(act.extraSecs);

  // ---- find the live hole. Both builds publish CBZ.survHoles; the after
  //      build also publishes CBZ.groundShafts (the same array under the name
  //      the city reads). Pick the biggest, so the picture is of the event.
  const holes = (CBZ.groundShafts || CBZ.survHoles || []).slice();
  let H = null;
  for (const h of holes) if (h && h.r != null && (!H || h.r > H.r)) H = h;
  // still warning? the sequence knows where it is going before the shaft exists
  let warnAt = null;
  try {
    const hz = CBZ.disasters.hazards ? CBZ.disasters.hazards() : [];
    if (hz && hz.length) warnAt = hz[0];
  } catch (_) {}

  /* THE FALL IS THE KILL, SO THE FALL GETS MEASURED. Nothing in a storyboard
     of an empty street proves the shaft can kill anybody — and in this run the
     bots correctly RAN AWAY, so `shaft_falls` stayed 0 for the honest reason.
     Put the player over the mouth and let go: the sim's own gravity takes him
     down 49 m and shaft_falls / the killfeed cause answer for themselves. The
     per-tick heal keeps the storyboard alive; the counter still ticks. */
  if (act.dropIn && H && CBZ.player && CBZ.player.pos && CBZ.player.pos.set) {
    CBZ.player.pos.set(H.x, H.gy + 2.5, H.z);
    if (CBZ.player._phys) { CBZ.player._phys.air = false; CBZ.player._phys.vy = 0; }
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(CBZ.player.pos);
    step(5);
  }
  if (act.teleport === "bottom" && H && CBZ.player && CBZ.player.pos && CBZ.player.pos.set) {
    // drop the player in at the floor, off-centre, where the void pockets are
    CBZ.player.pos.set(H.x + H.mouth * 0.35, H.bottom + 1.2, H.z);
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(CBZ.player.pos);
    step(act.thenSecs || 0.5);
  }

  // ---- frame the shot off the shaft's own geometry ----
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 55;
  camera.near = 0.4;
  camera.far = 20000;
  const A = (CBZ.SURV && CBZ.SURV.arena) || { cx: 0, cz: 600, r: 120 };
  const frame = (subject.cam || {}).frame || "oblique";
  // the after side reuses the before side's bearing so both pictures look at
  // the hole from the same side of the world
  /* A CAMERA THAT PHOTOGRAPHS A WALL IS A LIE (CLAUDE.md's aimlib rule, cheap
     version): the site is chosen by the game's own placement law and there is
     deliberately a building standing at the lip, so a fixed bearing puts a
     tower between the lens and the hole about a third of the time. Sweep the
     bearings and take the first one whose line to the rim is clear. */
  const bearing0 = (input.referenceStage && input.referenceStage.bearing != null)
    ? input.referenceStage.bearing : 2.3;
  const shotRoot = (CBZ.surv && CBZ.surv.arena && CBZ.surv.arena.root) || CBZ.scene;
  function clearBearing(ox, oz, oy, orad, high, back) {
    for (let i = 0; i < 12; i++) {
      const b = bearing0 + (i * Math.PI * 2) / 12;
      const p = new T.Vector3(ox + Math.cos(b) * back, oy + high, oz + Math.sin(b) * back);
      const d = new T.Vector3(ox - p.x, (oy + 1) - p.y, oz - p.z);
      const len = d.length();
      d.normalize();
      let blocked = false;
      try {
        const rc = new T.Raycaster(p, d, 0.5, Math.max(1, len - orad * 1.1));
        const hits = rc.intersectObject(shotRoot, true) || [];
        for (const hit of hits) {
          let o = hit.object, mine = false;
          while (o) { if (o.userData && o.userData.groundShaft) { mine = true; break; } o = o.parent; }
          if (!mine && hit.object.visible) { blocked = true; break; }
        }
      } catch (_) {}
      if (!blocked) return b;
    }
    return bearing0;
  }
  const cx = H ? H.x : (warnAt ? warnAt.x : A.cx);
  const cz = H ? H.z : (warnAt ? warnAt.z : A.cz);
  const gy = H ? H.gy : 0;
  const rr = H ? H.r : (warnAt ? warnAt.r || 9 : 9);
  const dep = H ? H.depth : 34;
  // the clear-bearing sweep has to be run against the geometry the shot will
  // actually use — a "far" beat cleared at the oblique beat's height and range
  // is a different ray, and the tower it misses is the one in the picture
  const farBack = Math.max(58, rr * 8);
  const bearing = (frame === "bottom")
    ? bearing0
    : (frame === "far")
      ? clearBearing(cx, cz, gy, rr, farBack * Math.tan(9 * Math.PI / 180), farBack)
      : clearBearing(cx, cz, gy, rr, Math.max(18, dep * 0.8), rr * 2.4 + 6);
  const cb = Math.cos(bearing), sb = Math.sin(bearing);
  let px, py, pz, ax, ay, az;
  if (frame === "bottom" && H) {
    // stand on the floor and look UP the far wall: the shot has to carry the
    // rubble and the wedged slabs at your feet AND the circle of sky, so it is
    // aimed at the wall two-thirds up rather than straight overhead
    px = H.x + H.mouth * 0.5 * cb; py = H.bottom + 1.7; pz = H.z + H.mouth * 0.5 * sb;
    ax = H.x - H.mouth * 0.95 * cb; ay = H.bottom + H.depth * 0.6; az = H.z - H.mouth * 0.95 * sb;
  } else if (frame === "lip") {
    px = cx + (rr * 1.9) * cb; py = gy + 2.6; pz = cz + (rr * 1.9) * sb;
    ax = cx - rr * 0.35 * cb; ay = gy - rr * 0.9; az = cz - rr * 0.35 * sb;
  } else if (frame === "warn") {
    px = cx + (rr * 3.0) * cb; py = gy + 6.5; pz = cz + (rr * 3.0) * sb;
    ax = cx; ay = gy + 0.2; az = cz;
  } else if (frame === "far") {
    // the player's own geometry, solved not typed: stand back 8 shaft radii
    // and put the lens at the depression angle a third-person camera gives at
    // that range (~9°), which is the angle at which the interior stops being
    // visible at all and the rim decides the whole read
    const back = farBack;
    px = cx + back * cb; py = gy + back * Math.tan(9 * Math.PI / 180); pz = cz + back * sb;
    ax = cx; ay = gy - 0.5; az = cz;
  } else if (frame === "wide") {
    px = cx + 78 * cb; py = gy + 44; pz = cz + 78 * sb;
    ax = cx; ay = gy - 6; az = cz;
  } else {
    // THE GUATEMALA FRAMING: raised oblique, high enough to see the far wall
    // all the way down, close enough that the intact ground beside it is in
    // the picture. Both distances are solved off the shaft, never typed.
    const back = rr * 2.4 + 6;
    px = cx + back * cb; py = gy + Math.max(18, dep * 0.8); pz = cz + back * sb;
    ax = cx - rr * 0.15 * cb; ay = gy - dep * 0.42; az = cz - rr * 0.15 * sb;
    if ((subject.cam || {}).near) { px = cx + (rr * 2.2 + 5) * cb; py = gy + Math.max(11, dep * 0.4); pz = cz + (rr * 2.2 + 5) * sb; }
  }
  camera.position.set(px, py, pz);
  camera.lookAt(ax, ay, az);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
    if (skyRig && skyRig.position) skyRig.position.set(camera.position.x, 0, camera.position.z);
  }
  if (!subject.hud) setHud(false); else setHud(true);
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const render = (CBZ.renderer.info && CBZ.renderer.info.render) || {};

  const before = input.side === "before";
  const query = (name) => S.overlay.querySelector(`[data-${name}]`);
  query("side").textContent = before ? input.beforeLabel : input.afterLabel;
  query("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  query("name").textContent = subject.label;
  query("name").style.cssText = "position:absolute;top:212px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:340px";
  query("focus").textContent = H
    ? `shaft r ${H.r.toFixed(1)} m · depth ${(H.depth || 0).toFixed(1)} m · deep/wide ${((H.depth || 0) / (H.r * 2)).toFixed(2)}`
    : `no shaft yet · ${CBZ.disasters.current() || "—"} ${CBZ.disasters.state()}`;
  query("focus").style.cssText = "position:absolute;top:244px;left:27px;color:#c0cfda;font-size:12px;font-weight:550";
  // the kill counters ride the perf line: a storyboard of an empty pit proves
  // nothing about whether the pit can kill, so the numbers are IN the picture
  let kills = "";
  try {
    if (typeof CBZ.shaftAudit === "function") {
      const a = CBZ.shaftAudit();
      kills = ` · fell ${a.falls} · crushed ${a.crushed} · buried ${a.buried} · voids ${a.voidSaves}`;
    }
  } catch (_) {}
  query("perf").textContent = ticks
    ? `sim ${ticks} ticks · avg ${(totalMs / ticks).toFixed(1)}ms · worst ${maxMs.toFixed(0)}ms${kills}`
    : kills;
  query("perf").style.cssText = `position:absolute;right:24px;top:24px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:${maxMs > 100 ? "#ff9c9c" : "#9fe8c3"}`;
  query("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  query("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  const metrics = {
    holes: holes.length,
    shaftDepth: H ? Number((H.depth || 0).toFixed(1)) : 0,
    deepOverWide: H ? Number(((H.depth || 0) / (H.r * 2)).toFixed(2)) : 0,
    tickAvgMs: ticks ? Number((totalMs / ticks).toFixed(2)) : 0,
    tickMaxMs: Number(maxMs.toFixed(1)),
    ticksOver33: over33,
    drawCalls: Number(render.calls || 0),
  };
  try {
    if (typeof CBZ.shaftAudit === "function") {
      const a = CBZ.shaftAudit();
      for (const k of Object.keys(a || {})) if (Number.isFinite(Number(a[k]))) metrics[`shaft_${k}`] = Number(a[k]);
    }
  } catch (_) {}
  try {
    if (typeof CBZ.disasterAudit === "function") {
      const a = CBZ.disasterAudit();
      for (const k of ["openHoles", "holeDepth", "holesOnSlopes", "holeSlopeMax"]) {
        if (a && Number.isFinite(Number(a[k]))) metrics[`audit_${k}`] = Number(a[k]);
      }
    }
  } catch (_) {}

  return {
    ok: true,
    disaster: CBZ.disasters.current(),
    state: CBZ.disasters.state(),
    stage: { bearing },
    metrics,
  };
}

export default {
  id: "sinkhole-city",
  title: "The Sinkhole: a shaft, not a disc",
  description: "One seeded survival match per build, the director forced to the sinkhole and stepped to the same simulated seconds. Every camera is solved off the LIVE shaft record, so each side is photographed at its own hole rather than at a typed coordinate. Beats: the warning cracks, the first drop, the Guatemala oblique, the sheared lip, the bottom looking up, and the scar the island keeps.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metricsNote: "deepOverWide is the reference photograph as arithmetic (a shaft reads far deeper than it is wide; a crater does not). shaft_holesOnSlopes is the owner's placement law — sinkholes on the ground, never on the side of a mountain — and may only ever read 0. shaft_throatShade is the ring fault as one number: the brightness of the only wall a camera at a normal depression angle can see, against sunlit ground sitting near 1.0. shaft_lidsOverMouth is the ground mask actually taking — a flat unmasked surface still spanning the mouth is a hole with a lid on it, and may only ever read 0.",
  metrics: {
    shaft_throatShade: { label: "Throat brightness at 9°", better: "lower" },
    shaft_lidsOverMouth: { label: "Unmasked lids over mouth", better: "lower" },
    shaftDepth: { label: "Shaft depth", unit: "m", better: "higher" },
    deepOverWide: { label: "Depth / width", better: "higher" },
    shaft_holesOnSlopes: { label: "Holes on slopes", better: "lower" },
    shaft_falls: { label: "Fall deaths", better: "higher" },
    tickAvgMs: { label: "Sim tick avg", unit: "ms", better: "lower" },
    tickMaxMs: { label: "Sim tick worst", unit: "ms", better: "lower" },
    drawCalls: { label: "Draw calls", better: "lower" },
  },
  subjects,
  stage: stageSinkhole,
};

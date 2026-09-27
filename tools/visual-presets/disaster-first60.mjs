/* Disaster Survival — THE FIRST SIXTY SECONDS, as a stranger sees them.

   The product covers (disaster-product.mjs) photograph the three best beats
   of a match from a director's tripod. This preset photographs what a new
   player actually gets: the spawn frame through the game's own chase camera
   with the HUD on, a look at the volcano, a walk through the town, the beach,
   the island from a boat offshore, and the director's FIRST warning and FIRST
   active disaster — whichever one the seeded arc deals, not a forced one.

   Staging (same family as disaster-sequence.mjs):
   - rAF is stubbed after boot, CBZ.stepSim is the only clock; hitstop and
     slowmo are zeroed per tick; the player is healed per tick.
   - Subjects run in order on ONE live match, so "t" in the labels is match
     seconds (spawn ~ 2 s, warn/active whenever the arc gets there).
   - Player-camera subjects let the game's own camera rig place the lens
     (CBZ.cam.yaw is the only thing touched: fwd = (-sin yaw, -cos yaw)).
   - Tripod subjects set CBZ.camera directly and call CBZ.skySync().

   HARNESS TRAP: stage() is SERIALIZED into the page, so every knob rides on
   input.subject. */

const subjects = [
  { id: "spawn", label: "Spawn (player camera, HUD on)", hud: true,
    focus: "The very first frame a new player sees after PLAY: the chase camera behind their character, wherever the seed dropped them.",
    act: { secs: 2 }, cam: { player: true } },
  { id: "look-volcano", label: "Turn to face the mountain", hud: true,
    focus: "The player turns toward the island's centre: the volcano, the town in front of it. This is the island's signature silhouette.",
    act: { secs: 1.2, faceVolcano: true }, cam: { player: true } },
  { id: "town-street", label: "Standing in town", hud: false,
    focus: "Eye level (1.7 m) in the town on the far side of the mountain from the sun, looking back at the volcano over the rooftops.",
    act: { secs: 0.2 }, cam: { tripod: "town" } },
  { id: "beach", label: "On the beach", hud: false,
    focus: "Eye level on the sand at the waterline, looking along the shore: sand, surf, sea colour, the horizon.",
    act: { secs: 0.2 }, cam: { tripod: "beach" } },
  { id: "offshore", label: "The island from the sea", hud: false,
    focus: "From a boat 110 m offshore, 22 m up: does it read as a real island or a toy on a plate?",
    act: { secs: 0.2 }, cam: { tripod: "offshore" } },
  { id: "first-brief", label: "The first announcement", hud: true,
    focus: "Two seconds after the director names the first disaster (after builds only: CBZ.disasters.advice().phase === 'brief'). Before builds have no announcement; they are shot at the same match second.",
    act: { untilBrief: true, budget: 30, extraSecs: 2 }, cam: { player: true } },
  { id: "first-warn", label: "The first warning", hud: true,
    focus: "The director's first warning in the natural seeded arc, 3 s in, through the player camera.",
    act: { untilState: "warn", budget: 90, extraSecs: 3 }, cam: { player: true } },
  { id: "first-active", label: "The first disaster", hud: false,
    focus: "The same disaster 6 s after it goes active, framed wide from above the town so the whole event reads.",
    act: { untilState: "active", budget: 60, extraSecs: 6 }, cam: { tripod: "wide" } },
];

async function stageFirst60(input) {
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return { ok: false, missing: "CBZ/THREE" };
  const sub = input.subject, act = sub.act || {}, camSpec = sub.cam || {};
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
      if (child.tagName === "SCRIPT" || child.tagName === "STYLE") continue;
      /* HARNESS TRAP: with rAF stubbed the boot meter never runs its own
         finish() fade, so "BUILDING THE WORLD" sits over a live match. A
         player never sees it there; hide it (and its worker canvas). */
      if (child.id === "bootload" || (child.tagName === "CANVAS" && child !== canvas && child.id !== "minimap")) { child.style.display = "none"; continue; }
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__first60;
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
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    S = window.__first60 = { t: 0 };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const heal = () => {
    if (!CBZ.player) return;
    CBZ.player.hp = 100; CBZ.player.dead = false;
    if (CBZ.player.stamina != null) CBZ.player.stamina = 100;
  };
  let ticks = 0, totalMs = 0, maxMs = 0;
  const step = (secs) => {
    const n = Math.max(0, Math.round(secs * 60));
    for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      const t0 = performance.now();
      CBZ.stepSim(1 / 60);
      const ms = performance.now() - t0;
      ticks++; totalMs += ms; if (ms > maxMs) maxMs = ms;
      heal(); S.t += 1 / 60;
    }
  };
  const A = CBZ.surv && CBZ.surv.arena;
  if (!A) return { ok: false, err: "no arena" };
  const V = A.hills[0];
  const gh = (x, z) => { try { return A.groundHeightAt(x, z); } catch (_) { return 0; } };

  if (act.faceVolcano && CBZ.cam && CBZ.player) {
    const dx = V.x - CBZ.player.pos.x, dz = V.z - CBZ.player.pos.z;
    CBZ.cam.yaw = Math.atan2(-dx, -dz);
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.rotation.y = CBZ.cam.yaw + Math.PI;
  }
  if (act.secs) step(act.secs);
  if (act.untilBrief) {
    // a build without advice() is shot at the after build's brief second (t=5 s)
    let guard = Math.round((act.budget || 30) * 10);
    if (CBZ.disasters.advice) { while (guard-- > 0 && !CBZ.disasters.advice()) step(0.1); }
    else step(Math.max(0, 3 - S.t));
  }
  if (act.untilState) {
    let guard = Math.round((act.budget || 60) * 10);
    while (guard-- > 0 && CBZ.disasters.state() !== act.untilState) step(0.1);
  }
  if (act.extraSecs) step(act.extraSecs);

  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.updateProjectionMatrix();
  if (camSpec.tripod) {
    // the sun sits at +x/-z of the island (survival.js onAlways 93): shoot
    // from the -x/+z side so the key light rakes the subject, not backlights it
    const sunDir = { x: 70 / Math.hypot(70, 50), z: -50 / Math.hypot(70, 50) };
    let cx, cy, cz, ax, ay, az, fov = 55;
    if (camSpec.tripod === "town") {
      const d = V.r + 16;
      cx = V.x - sunDir.x * d - sunDir.z * 18; cz = V.z - sunDir.z * d + sunDir.x * 18;
      cy = gh(cx, cz) + 1.7; ax = V.x; az = V.z; ay = V.peak * 0.7; fov = 62;
    } else if (camSpec.tripod === "beach") {
      const r = A.radius * 0.97, a = Math.atan2(-sunDir.z, -sunDir.x) + 0.35;
      cx = A.center.x + Math.cos(a) * r; cz = A.center.z + Math.sin(a) * r;
      cy = gh(cx, cz) + 1.7;
      const t = a + 0.5;
      ax = A.center.x + Math.cos(t) * r * 1.02; az = A.center.z + Math.sin(t) * r * 1.02; ay = cy - 0.5; fov = 62;
    } else if (camSpec.tripod === "offshore") {
      const r = A.radius + 110, a = Math.atan2(-sunDir.z, -sunDir.x) - 0.3;
      cx = A.center.x + Math.cos(a) * r; cz = A.center.z + Math.sin(a) * r; cy = 22;
      ax = A.center.x; az = A.center.z; ay = 14; fov = 50;
    } else {
      const r = A.radius * 0.9, a = Math.atan2(-sunDir.z, -sunDir.x);
      cx = A.center.x + Math.cos(a) * r; cz = A.center.z + Math.sin(a) * r; cy = 55;
      ax = A.center.x; az = A.center.z; ay = 10; fov = 60;
    }
    camera.fov = fov; camera.updateProjectionMatrix();
    camera.position.set(cx, cy, cz);
    camera.lookAt(ax, ay, az);
  }
  camera.updateMatrixWorld(true);
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  setHud(!!sub.hud);
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const render = (CBZ.renderer.info && CBZ.renderer.info.render) || {};
  return {
    ok: true, matchT: +S.t.toFixed(1),
    disaster: CBZ.disasters.current(), state: CBZ.disasters.state(),
    metrics: {
      tickAvgMs: ticks ? +(totalMs / ticks).toFixed(2) : 0,
      tickMaxMs: +maxMs.toFixed(1),
      drawCalls: Number(render.calls || 0),
      triangles: Number(render.triangles || 0),
    },
  };
}

export default {
  id: "disaster-first60",
  title: "Disaster Survival — the first sixty seconds",
  description: "What a stranger sees in the first minute of Natural Disaster Survival: spawn frame, the mountain, the town, the beach, the island from the sea, and the first natural warning and disaster of the seeded arc.",
  defaultBefore: "local",
  viewport: { width: 1280, height: 800 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 600000,
  metrics: {
    tickAvgMs: { label: "sim tick avg", unit: "ms", better: "lower" },
    drawCalls: { label: "draw calls", better: "lower" },
  },
  subjects,
  stage: stageFirst60,
};

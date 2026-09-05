/* prison-corridors.mjs — the corridor wave (2026-09-05): the spine, the wings, the grilles, the three ports, the populated ring, the tower deck, the armoury rack. Staging is prison-exterior's. */

const subjects = [
  { id: "aerial", label: "The compound from the air", hud: false,
    focus: "South-east, high. The corridor spine around the old compound, its wings to every ring building, the three ports on the south wall.",
    cam: { x: 175, y: 125, z: 205, ax: -10, ay: 0, az: 5 } },
  { id: "interlock", label: "Through the west yard gate", hud: false,
    focus: "From the north yard at the west sally gate: the card door, then the corridor's first grille four metres on — an interlock — and the block corridor beyond.",
    cam: { x: -26, y: 1.6, z: 22, ax: -66, ay: 2.0, az: 22 } },
  { id: "spine", label: "The west spine, looking south", hud: false,
    focus: "Inside the corridor at its north end: block walls, polished floor, strips, a grille every thirty-odd metres, the EXIT sign over each.",
    cam: { x: -40, y: 1.6, z: -68, ax: -40, ay: 2.0, az: 40 } },
  { id: "grille", label: "A corridor grille, up close", hud: false,
    focus: "Two metres from a spine grille: the fixed panel, the sliding leaf on its header, the lock with its lamp. It takes the Corridor Key.",
    cam: { x: -39.2, y: 1.6, z: -11.5, ax: -40, ay: 1.9, az: -4 } },
  { id: "junction", label: "Where the shop wing meets the spine", hud: false,
    focus: "Standing in the industries wing looking east into the spine crossing: openings both ways, the yard gate's interlock beyond.",
    cam: { x: -56, y: 1.6, z: 22, ax: -30, ay: 2.0, az: 22 } },
  { id: "east-port", label: "The east spine into its sally port", hud: false,
    focus: "The south end of the east leg: the corridor runs straight into the second sally port's glass entry; an alternative way out.",
    cam: { x: 50, y: 1.6, z: 96, ax: 50, ay: 2.2, az: 128 } },
  { id: "rec-yard", label: "The recreation yard, populated", hud: false,
    focus: "From the picnic tables across the turf to the track: bodies on the yard where there were none.",
    cam: { x: -70, y: 1.7, z: -18, ax: -95, ay: 2, az: -60 } },
  { id: "industries", label: "The shop floor, populated", hud: false,
    focus: "Inside prison industries from its door: benches, racks, the crib — and men working it, with an officer posted.",
    cam: { x: -67, y: 1.7, z: 20, ax: -100, ay: 2, az: 22 } },
  { id: "tower-deck", label: "From the tower deck", hud: false,
    focus: "Standing on the north-west yard tower's deck after the climb: the rail, the yard below, the block, the towers opposite.",
    cam: { x: -30, y: 14.6, z: 52, ax: 0, ay: 2, az: 20 } },
  { id: "armory-rack", label: "The armoury rack", hud: false,
    focus: "A metre from the gun rack. It is solid now; the take verb still reaches over it.",
    cam: { x: 25.2, y: 1.6, z: 1, ax: 27.3, ay: 1.3, az: 1 } },
];

async function stageCorridors(input) {
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
      if (child.id === "__corOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__corSeq;
  if (!S) {
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="escape"]'),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="escape"]').click();
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
    // mid-morning, sun from the south-east: the towers throw a shadow
    const pin = () => { try { if (CBZ.dayPhase) CBZ.dayPhase((10 - 6) / 24); } catch (_) {} };
    for (let i = 0; i < 180; i++) {
      if (i % 30 === 0) pin();
      CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
      if (CBZ.player) { CBZ.player.hp = Math.max(CBZ.player.hp || 100, 60); CBZ.player.dead = false; }
    }
    pin();
    if (CBZ.player && CBZ.player.pos) CBZ.player.pos.set(-11, 0, -41);
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;

    const overlay = document.createElement("div");
    overlay.id = "__corOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);
    S = window.__corSeq = { overlay };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const subject = input.subject;
  const cam = subject.cam;
  const camera = new T.PerspectiveCamera(62, input.width / input.height, 0.1, 900);
  camera.position.set(cam.x, cam.y, cam.z);
  camera.lookAt(cam.ax, cam.ay, cam.az);
  camera.updateMatrixWorld(true);
  if (CBZ.camera) {
    CBZ.camera.position.copy(camera.position);
    CBZ.camera.quaternion.copy(camera.quaternion);
    CBZ.camera.updateMatrixWorld(true);
    // the first-person view model rides CBZ.camera; a survey has no hands
    for (const child of CBZ.camera.children) child.visible = false;
  }
  const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
  if (skyRig && skyRig.position) skyRig.position.set(camera.position.x, 0, camera.position.z);
  // the sun's shadow box follows the camera in play; a fixed survey camera
  // 150 m from the origin would otherwise photograph an unshadowed corner
  try {
    const sun = CBZ.sun || (CBZ.lights && CBZ.lights.sun);
    if (sun && sun.target && sun.shadow) {
      sun.target.position.set(cam.ax, 0, cam.az);
      sun.position.set(cam.ax + 48, 90, cam.az - 10);
      sun.target.updateMatrixWorld(true);
      sun.shadow.camera.updateProjectionMatrix();
    }
  } catch (_) {}

  if (!subject.hud) setHud(false);
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const render = (CBZ.renderer.info && CBZ.renderer.info.render) || {};

  let audit = {};
  try { if (typeof CBZ.prisonExteriorAudit === "function") audit = CBZ.prisonExteriorAudit() || {}; } catch (_) {}
  let corr = {};
  try { if (typeof CBZ.prisonCorridorAudit === "function") corr = CBZ.prisonCorridorAudit() || {}; } catch (_) {}
  const old = (x, z) => (x > -30 && x < 30 && z > -8 && z < 52) || (x > -44 && x < 44 && z > 52 && z < 128) || (x > -20 && x < 20 && z > -64 && z < -8);
  const npcsRing = (CBZ.npcs || []).filter((n) => n.group && !old(n.group.position.x, n.group.position.z)).length;
  const guardsRing = (CBZ.guards || []).filter((g) => g.start && !old(g.start.x, g.start.z)).length;
  const ports = 1 + ((CBZ.altExitZones || []).length);

  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;top:72px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:420px";
  q("focus").textContent = `${corr.corridorM || 0} m of corridor · ${corr.grilles || 0} grilles · ${ports} exits · ${npcsRing + guardsRing} bodies in the ring`;
  q("focus").style.cssText = "position:absolute;top:104px;left:27px;color:#c0cfda;font-size:12px;font-weight:550";
  q("perf").textContent = `draw ${render.calls || 0} · tris ${Math.round((render.triangles || 0) / 1000)}k`;
  q("perf").style.cssText = "position:absolute;right:24px;top:24px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3";
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    metrics: {
      drawCalls: Number(render.calls || 0),
      triangles: Number(render.triangles || 0),
      corridorM: Number(corr.corridorM || 0),
      grilles: Number(corr.grilles || 0),
      exits: ports,
      ladders: Number(corr.ladders || 0),
      npcsRing, guardsRing,
      guards: (CBZ.guards || []).length,
      ringOpenShare: audit.ringOpenShare == null ? 1 : Number(audit.ringOpenShare.toFixed(3)),
    },
  };
}

/* BEFORE = HEAD (or BA_BEFORE_REF), served off a detached worktree on its
   own port. Removed in close(). An explicit --before URL still wins. */
async function launchSides(ctx) {
  const { spawn, execFileSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const net = await import("node:net");
  const repo = ctx.repoRoot;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ba-head-"));
  fs.rmdirSync(dir);
  const ref = process.env.BA_BEFORE_REF || (ctx.env && ctx.env.BA_BEFORE_REF) || "HEAD";
  execFileSync("git", ["worktree", "add", "--detach", dir, ref], { cwd: repo, stdio: "ignore" });
  const port = await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on("error", reject);
  });
  const proc = spawn("python3", ["tools/devserver.py"], {
    cwd: dir, env: { ...process.env, PORT: String(port) }, stdio: "ignore",
  });
  const origin = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 20000;
  let up = false;
  while (Date.now() < deadline && !up) {
    try { up = (await fetch(origin, { method: "HEAD" })).ok; } catch (_) {}
    if (!up) await new Promise((r) => setTimeout(r, 150));
  }
  if (!up) { try { proc.kill(); } catch (_) {} throw new Error("HEAD worktree server never came up"); }
  return {
    before: origin,
    label: `${ref} worktree ${dir} :${port} vs working tree`,
    async close() {
      try { proc.kill(); } catch (_) {}
      try { execFileSync("git", ["worktree", "remove", "--force", dir], { cwd: repo, stdio: "ignore" }); } catch (_) {}
    },
  };
}

export default {
  id: "prison-corridors",
  title: "The corridors",
  description: "The corridor spine and its wings, the grilles, the three sally ports, the populated ring, the tower deck, the armoury rack. HEAD against the working tree.",
  beforeLabel: "BEFORE · HEAD",
  afterLabel: "AFTER · WORKING TREE",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metrics: {
    drawCalls: { label: "Draw calls", better: "lower" },
    triangles: { label: "Triangles" },
    corridorM: { label: "Enclosed corridor", unit: "m" },
    grilles: { label: "Corridor grilles" },
    exits: { label: "Ways out through a sally port" },
    ladders: { label: "Tower ladders you can climb" },
    npcsRing: { label: "Named inmates in the ring" },
    guardsRing: { label: "Officers posted in the ring" },
    guards: { label: "Officers on shift" },
    ringOpenShare: { label: "Ring ground with no use", better: "lower" },
  },
  subjects,
  stage: stageCorridors,
  launchSides,
};

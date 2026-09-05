/* prison-exterior.mjs — THE COMPOUND FROM THE GROUND. Twelve fixed
   photographs of the prison's OUTSIDE: the towers, the wire, the wall, and
   the ring of ground the 2026-08-11 enlargement threw around the old
   compound.

   OWNER (2026-09-04): "there's a shit ton of jail that's just not real at
   all like the guard towers, and half the jail is empty and dumb waste of
   space … rn it looks like cardboard at high def."

   The shots are what a man sees at eye height in each quarter of the ring,
   one tower up close from the yard, one corner tower from the sterile zone,
   the perimeter wall from the patrol road, the vehicle gate, the freedom
   gate, the compound from outside the wire, and one aerial so the whole
   plan reads at once.

   METRICS. `drawCalls`/`triangles` are the price. `towers` is CBZ.towers
   (the ones capture.js fires from — must not change). The rest come from
   CBZ.prisonExteriorAudit() when the working tree has it: `fenceM` metres
   of chain-link, `masts` floodlight masts, `programmedM2` square metres of
   ring ground that now have a stated use (rec yard, service yard, patrol
   road, walkway…), `ringOpenShare` the fraction of the ring's walkable
   ground with no programme at all — the "empty and dumb" number.

   BEFORE is served off a detached HEAD worktree on its own port
   (launchSides), so the pair is "what is committed" against "this
   checkout" with no flag. */

const subjects = [
  { id: "aerial", label: "The compound from the air", hud: false,
    focus: "South-east, high. The whole plan: the old compound in the middle, the ring around it, what fills the ring.",
    cam: { x: 175, y: 125, z: 205, ax: -10, ay: 0, az: 5 } },
  { id: "tower-yard", label: "A yard tower from the exercise yard", hud: false,
    focus: "Eye height in the north yard looking at the north-west tower over the division wall: shaft, cabin, glazing, catwalk, roof, the way up.",
    cam: { x: -8, y: 1.7, z: 14, ax: -30, ay: 8, az: -8 } },
  { id: "tower-south", label: "The mid-east tower over the south block", hud: false,
    focus: "From the lower yard: the tower on the east division wall, the infirmary under it, the wire on the wall top.",
    cam: { x: 14, y: 1.7, z: 104, ax: 44, ay: 11, az: 90 } },
  { id: "tower-corner", label: "The north-east corner tower", hud: false,
    focus: "From the ring floor: the 12 m corner tower where the north and east walls meet, and the wall either side of it.",
    cam: { x: 108, y: 1.7, z: -94, ax: 120, ay: 9, az: -112 } },
  { id: "wall-road", label: "The west wall from the patrol road", hud: false,
    focus: "Standing inside the outer wall looking north along it: the wall face, its top, the fence beside it, the masts.",
    cam: { x: -120.5, y: 1.7, z: 44, ax: -121, ay: 5, az: -70 } },
  { id: "nw-ring", label: "The north-west quarter", hud: false,
    focus: "From the shop's north-east corner looking into the biggest void in the compound (72 x 104 m).",
    cam: { x: -50, y: 1.7, z: -8, ax: -100, ay: 3, az: -80 } },
  { id: "ne-ring", label: "The north-east quarter", hud: false,
    focus: "From segregation's north-west corner looking into the other void.",
    cam: { x: 50, y: 1.7, z: -8, ax: 95, ay: 3, az: -80 } },
  { id: "vehicle-gate", label: "The north wall's vehicle gate", hud: false,
    focus: "Across the north-east quarter to the north wall: where a prison this size takes its trucks in.",
    cam: { x: 104, y: 1.7, z: -84, ax: 102, ay: 6, az: -116 } },
  { id: "west-gate", label: "Through the west yard gate", hud: false,
    focus: "From the west sally gate looking at the shop door 36 m away: what a man walks along to get there.",
    cam: { x: -33, y: 1.7, z: 22, ax: -66, ay: 2.5, az: 20 } },
  { id: "sw-ring", label: "The south-west quarter", hud: false,
    focus: "From the lower west gate: the ground beyond the powerhouse to the south-west corner.",
    cam: { x: -47, y: 1.7, z: 92, ax: -100, ay: 8, az: 120 } },
  { id: "east-lane", label: "The east lane", hud: false,
    focus: "The strip between the old east wall and the east-wing rooms, looking south past the kitchen door.",
    cam: { x: 47, y: 1.7, z: 48, ax: 55, ay: 2.5, az: 104 } },
  { id: "freedom-gate", label: "The freedom gate from the sally port", hud: false,
    focus: "Inside looking south at the exit: the two gate towers, the south wall, the wire on it.",
    cam: { x: -6, y: 1.7, z: 102, ax: 0, ay: 5, az: 128 } },
  { id: "boom-beam", label: "The sally port's boom, up close", hud: false,
    focus: "Two metres from the red overhead beam at the checkpoint, high tier. It is painted steel: it must not read as sandpaper.",
    cam: { x: 3.2, y: 3.1, z: 121.2, ax: 0, ay: 3.4, az: 118 } },
  { id: "outside", label: "From outside the wire", hud: false,
    focus: "Beyond the south-east corner looking back at the wall and its tower — what the place is from the road.",
    cam: { x: 152, y: 2.0, z: 152, ax: 110, ay: 8, az: 126 } },
];

async function stageExterior(input) {
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
      if (child.id === "__extOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__extSeq;
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
    overlay.id = "__extOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);
    S = window.__extSeq = { overlay };
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
  const towers = (CBZ.towers || []).length;

  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;top:72px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:420px";
  const share = audit.ringOpenShare == null ? "?" : Math.round(audit.ringOpenShare * 100) + "%";
  q("focus").textContent = `${towers} towers · ${audit.fenceM == null ? "0" : Math.round(audit.fenceM)} m of fence · ${audit.masts || 0} masts · ${share} of the ring unprogrammed`;
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
      towers,
      fenceM: audit.fenceM == null ? 0 : Number(audit.fenceM.toFixed(0)),
      masts: Number(audit.masts || 0),
      programmedM2: Number(audit.programmedM2 || 0),
      ringOpenShare: audit.ringOpenShare == null ? 1 : Number(audit.ringOpenShare.toFixed(3)),
      texturedWalls: Number(audit.texturedWalls || 0),
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
  id: "prison-exterior",
  title: "The compound from the ground",
  description: "Twelve fixed photographs of the prison's outside — towers, wire, wall, and the ring of ground around the old compound. HEAD against the working tree.",
  beforeLabel: "BEFORE · HEAD",
  afterLabel: "AFTER · WORKING TREE",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metrics: {
    drawCalls: { label: "Draw calls", better: "lower" },
    triangles: { label: "Triangles" },
    towers: { label: "Towers capture.js fires from" },
    fenceM: { label: "Chain-link fence", unit: "m" },
    masts: { label: "Floodlight masts" },
    programmedM2: { label: "Ring ground with a use", unit: "m²" },
    ringOpenShare: { label: "Ring ground with no use", better: "lower" },
    texturedWalls: { label: "Wall/tower pieces with a real surface" },
  },
  subjects,
  stage: stageExterior,
  launchSides,
};

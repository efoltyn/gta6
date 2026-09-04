/* prison-tier.mjs — THE CELL HOUSE AS A ROOM. Eight fixed photographs of the
   wing, no story, no acts: what a man standing in the hall sees.

   OWNER (2026-09-04, with a reference photograph of a two-tier cell house:
   cells stacked two high along the long walls, a steel gallery with a rail in
   front of the upper tier, an open stair at the end, one big concrete floor,
   pendant lamps on stems off a trussed roof): "LOOK HOW THIS JAIL LOOKS —
   our cells are not laid out in a realistic way and our cell room has
   floating shit like the desk the keycard is on and some lights. The jail
   room just needs improvement overall."

   The shots are the reference's viewpoints turned on OUR wing: the hall from
   the south throat at eye height (the photograph's own framing), the same
   hall from a high corner, straight down from the lid, the two galleries, the
   officer's post, the duty desk the card lies on, and one lamp against the
   ceiling it hangs from.

   METRICS. `tiers` is how many storeys of cells the wing has, `cells` how
   many, `floatingFixtures` how many light fittings hang with air between
   their top and the lid (CBZ.cellblockAudit().floatingFixtures — the wing
   counts its own), `sleepGap` the bed shortfall the wing must never reopen
   (every man has a bed, cellblock.js header). `drawCalls` is the price.

   BEFORE is served off a detached HEAD worktree on its own port (launchSides),
   so the pair is "what is committed" against "this checkout" with no flag. */

const subjects = [
  { id: "hall-south", label: "The hall from the south throat", hud: false,
    focus: "Eye height at the south door looking north up the tier — the reference photograph's own framing. Cells should line the walls, stacked; the middle should be one open floor.",
    cam: { x: 0, y: 1.7, z: -9.5, ax: 0, ay: 2.6, az: -40 } },
  { id: "hall-corner", label: "The hall from a high corner", hud: false,
    focus: "Three-quarter view from the south-west corner under the lid. Tiers, gallery, rail, stair, and whatever is floating.",
    cam: { x: -9.2, y: 7.5, z: -10.2, ax: 6, ay: 1.0, az: -36 } },
  { id: "hall-north", label: "The hall from the north landing", hud: false,
    focus: "From the upper landing over the officer's post looking south: both galleries, the two stairs at the far end, the south door between them.",
    cam: { x: 0, y: 5.7, z: -36.3, ax: 0, ay: 1.0, az: -8 } },
  { id: "gallery-on", label: "Standing on the west gallery", hud: false,
    focus: "Eye height on the upper walkway looking north along the tier: the rail on the right, the upper cell fronts on the left, the drop to the hall.",
    cam: { x: -10.95, y: 5.55, z: -11.5, ax: -11.4, ay: 5.2, az: -36 } },
  { id: "stair", label: "The west stair from the hall", hud: false,
    focus: "From the floor looking at the flight against the south wall: treads, stringers, handrail, where it lands on the gallery.",
    cam: { x: -1.5, y: 1.7, z: -15.5, ax: -8.5, ay: 2.6, az: -9.4 } },
  { id: "gallery-west", label: "The west gallery", hud: false,
    focus: "Up the west side at eye height. Ground-floor cell fronts on the left; what is over them.",
    cam: { x: -9.0, y: 1.7, z: -11, ax: -12, ay: 2.4, az: -36 } },
  { id: "gallery-east", label: "The east gallery", hud: false,
    focus: "Up the east side at eye height, past the duty desk.",
    cam: { x: 9.0, y: 1.7, z: -11, ax: 12, ay: 2.4, az: -36 } },
  { id: "officer-post", label: "The officer's post", hud: false,
    focus: "The north end: the duty board, desk, key board and wing sign over the staff door.",
    cam: { x: 0, y: 1.7, z: -33, ax: 0, ay: 1.6, az: -43 } },
  { id: "duty-desk", label: "The desk the keycard lies on", hud: false,
    focus: "The south-east corner: the keycard's desk. Legs on the floor, card on the top, nothing hovering.",
    cam: { x: 11.2, y: 1.55, z: -13.6, ax: 13.9, ay: 0.95, az: -11.5 } },
  { id: "lamp", label: "One lamp against the lid", hud: false,
    focus: "A hall lamp seen from below and beside it. It must hang FROM something.",
    cam: { x: 2.4, y: 6.6, z: -26.5, ax: 0, ay: 8.3, az: -30 } },
];

async function stageTier(input) {
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
      if (child.id === "__tierOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__tierSeq;
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
    const pin = () => { try { if (CBZ.dayPhase) CBZ.dayPhase((10 - 6) / 24); } catch (_) {} };
    for (let i = 0; i < 180; i++) {
      if (i % 30 === 0) pin();
      CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
      if (CBZ.player) { CBZ.player.hp = Math.max(CBZ.player.hp || 100, 60); CBZ.player.dead = false; }
    }
    pin();
    // the player's own rig out of every frame: this is a survey, not a selfie
    if (CBZ.player && CBZ.player.pos) CBZ.player.pos.set(-11, 0, -41);
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;

    const overlay = document.createElement("div");
    overlay.id = "__tierOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);
    S = window.__tierSeq = { overlay };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const subject = input.subject;
  const cam = subject.cam;
  const camera = new T.PerspectiveCamera(62, input.width / input.height, 0.1, 600);
  camera.position.set(cam.x, cam.y, cam.z);
  camera.lookAt(cam.ax, cam.ay, cam.az);
  camera.updateMatrixWorld(true);
  if (CBZ.camera) {
    CBZ.camera.position.copy(camera.position);
    CBZ.camera.quaternion.copy(camera.quaternion);
    CBZ.camera.updateMatrixWorld(true);
  }
  const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
  if (skyRig && skyRig.position) skyRig.position.set(camera.position.x, 0, camera.position.z);

  if (!subject.hud) setHud(false);
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const render = (CBZ.renderer.info && CBZ.renderer.info.render) || {};

  const audit = (typeof CBZ.cellblockAudit === "function") ? (CBZ.cellblockAudit() || {}) : {};
  // can a body get up there: the ground the physics answers on the west
  // flight's midpoint (asked from knee height) and on the gallery (asked
  // from the gallery); 0 on both means there is no stair and no tier.
  const g = CBZ.groundAt || (() => 0);
  const stairMidY = Number(g(-7.175, -9.35, 1.6).toFixed(2));
  const galleryY = Number(g(-10.9, -20, 3.9).toFixed(2));
  const hallUnderGalleryY = Number(g(-10.9, -20, 0).toFixed(2));
  // the men upstairs: how many, how many are on their bunks, and the lowest
  // pair of feet among them (3.9 = on the tier floor; 0 = fallen through it)
  let upperResidents = 0, upperSeated = 0, upperFeetMinY = null;
  for (const c of ((CBZ.cellblock && CBZ.cellblock.cells) || [])) {
    if (!c.tier || !c.owner || c.owner === "player" || !c.owner.group) continue;
    upperResidents++;
    if (c.owner.char && c.owner.char.sitting) upperSeated++;
    const y = c.owner.group.position.y;
    if (upperFeetMinY == null || y < upperFeetMinY) upperFeetMinY = y;
  }
  upperFeetMinY = upperFeetMinY == null ? 0 : Number(upperFeetMinY.toFixed(2));
  let rest = {};
  try { if (typeof CBZ.prisonRestAudit === "function") rest = CBZ.prisonRestAudit() || {}; } catch (_) {}

  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;top:72px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:380px";
  q("focus").textContent = `${audit.cells || 0} cells · ${audit.tiers || 1} tier${(audit.tiers || 1) === 1 ? "" : "s"} · ${audit.floatingFixtures == null ? "?" : audit.floatingFixtures} floating fittings`;
  q("focus").style.cssText = "position:absolute;top:104px;left:27px;color:#c0cfda;font-size:12px;font-weight:550";
  q("perf").textContent = `draw ${render.calls || 0}`;
  q("perf").style.cssText = "position:absolute;right:24px;top:24px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3";
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    metrics: {
      cells: Number(audit.cells || 0),
      tiers: Number(audit.tiers || 1),
      floatingFixtures: audit.floatingFixtures == null ? null : Number(audit.floatingFixtures),
      spineBlocked: Number(audit.spineBlocked || 0),
      spawnBlocked: Number(audit.spawnBlocked || 0),
      beds: Number(rest.beds || 0),
      sleepGap: Number(rest.sleepGap || 0),
      drawCalls: Number(render.calls || 0),
      stairMidY, galleryY, hallUnderGalleryY,
      upperResidents, upperSeated, upperFeetMinY,
    },
  };
}

/* BEFORE = HEAD, served off a detached worktree on its own port. The
   worktree is made once per run under the system temp dir and removed in
   close(). An explicit --before URL still wins (web adapter contract). */
async function launchSides(ctx) {
  const { spawn, execFileSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const net = await import("node:net");
  const repo = ctx.repoRoot;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ba-head-"));
  fs.rmdirSync(dir);
  // BA_BEFORE_REF names the commit to photograph as BEFORE (default HEAD)
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
  id: "prison-tier",
  title: "The cell house as a room",
  description: "Eight fixed photographs of the cell wing — the reference's viewpoints on our building. HEAD against the working tree.",
  beforeLabel: "BEFORE · HEAD",
  afterLabel: "AFTER · WORKING TREE",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metrics: {
    cells: { label: "Cells" },
    tiers: { label: "Tiers" },
    floatingFixtures: { label: "Fittings hanging in air", better: "lower" },
    spineBlocked: { label: "Patrol spine blocked", better: "lower" },
    spawnBlocked: { label: "Spawn blocked", better: "lower" },
    beds: { label: "Beds" },
    sleepGap: { label: "Inmates without beds", better: "lower" },
    drawCalls: { label: "Draw calls", better: "lower" },
    stairMidY: { label: "Ground on the west flight, mid", unit: "m" },
    galleryY: { label: "Ground on the west gallery", unit: "m" },
    hallUnderGalleryY: { label: "Ground under it, from the floor", unit: "m", better: "lower" },
    upperResidents: { label: "Men housed upstairs" },
    upperSeated: { label: "…of them on their bunks" },
    upperFeetMinY: { label: "Lowest feet upstairs", unit: "m" },
  },
  subjects,
  stage: stageTier,
  launchSides,
};

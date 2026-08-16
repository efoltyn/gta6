/* "When NPCs sit on their bed, they sit in front, not actually sitting on
   anything." — the owner, 2026-08-15, with a screenshot.

   This preset photographs ONE thing: a cell resident whose ambient pose is
   "sitting on his bunk", shot from three angles that make hip-to-mattress
   contact impossible to fudge. Both sides are the SAME local build; the only
   difference is `?cfg_PRISON_BUNK_PERCH=0`, which restores the old 0.62 m
   lateral offset and door-facing yaw exactly (world/cellblock.js).

   Staging is jail-scene.mjs's: boot the real escape mode, stub rAF so
   CBZ.stepSim is the only clock, then step the live wing. The subject cell is
   chosen by the wing's own position hash, so both sides photograph the same
   man in the same cell at the same simulated second; the cameras are derived
   from that cell's bunk record, so the two frames are pixel-comparable.

   The claim is also a number: CBZ.cellSitAudit() reports how far each seated
   body's hips are from the bunk's centre line, and the mattress is only
   +-0.525 m wide. */

const subjects = [
  { id: "perch-across", label: "Sitting on his bunk", hud: false,
    focus: "Straight across the bed from inside the cell. The hips belong ON the mattress with the thighs coming off its near edge and the soles on the concrete. BEFORE: the whole body floats beside the frame at mattress height, sitting on nothing.",
    cam: { lat: 3.0, along: 1.25, y: 1.45, aimLat: 0.34, aimY: 0.82, aimAlong: 0.0 } },
  { id: "perch-low", label: "Hips and mattress", hud: false,
    focus: "Camera on the mattress plane. This is the contact test: is there bed under the man, or air between his weight and the frame?",
    cam: { lat: 2.1, along: 1.9, y: 0.86, aimLat: 0.30, aimY: 0.78, aimAlong: 0.15 } },
  { id: "perch-foot", label: "From the foot of the bed", hud: false,
    focus: "Down the bed's long axis. Reads the FACING: a man perched on a bunk faces out of it across the short axis, never straddling it lengthways at the door.",
    // Kept off the bunk's own foot post (lat 0.60, along 1.28 in this frame):
    // a corner post through the subject reads as a staging accident.
    cam: { lat: 1.9, along: 2.4, y: 1.35, aimLat: 0.30, aimY: 0.80, aimAlong: -0.1 } },
];

async function stagePerch(input) {
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
      if (child.id === "__perchOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__perchSeq;
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
    for (let i = 0; i < 120; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    const overlay = document.createElement("div");
    overlay.id = "__perchOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__perchSeq = { overlay };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const step = (secs) => {
    const n = Math.max(0, Math.round(secs * 60));
    for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      CBZ.stepSim(1 / 60);
      if (CBZ.player) { CBZ.player.hp = Math.max(CBZ.player.hp || 100, 60); CBZ.player.dead = false; }
    }
  };

  /* ---- the subject cell. The wing hashes each cell's pose from its own
     coordinates, so "the first occupied cell whose man sits on his bunk" is
     the same cell on both sides. If the schedule has him elsewhere this
     second, we ASK for the pose rather than photograph an empty bed — the
     ambient pose is exactly what is under test. */
  const wing = CBZ.cellblock;
  if (!wing || !wing.cells) return { ok: false, err: "no cellblock" };
  if (!S.cell) {
    const live = wing.cells.filter((c) => c && c.bunk && c.owner && c.owner !== "player" &&
      c.owner.group && c.owner.char && !c.owner.dead && !c.owner.escaped);
    const c = live.find((x) => x.owner._cellPose === "bunk") || live[0];
    if (!c) return { ok: false, err: "no cell resident" };
    const n = c.owner;
    n._cellPose = "bunk";
    try { if (n._propBed && CBZ.propWake) CBZ.propWake(n, { instant: true }); } catch (_) {}
    try { if (CBZ.propStand) CBZ.propStand(n, { instant: true }); } catch (_) {}
    S.cell = c; S.actor = n;
    step(3.5);                       // walk him in and let the seat solve settle
  } else {
    S.actor._cellPose = "bunk";
    step(0.5);
  }
  const cell = S.cell, actor = S.actor;
  for (let i = 0; i < 90; i++) { try { CBZ.animChar(actor.char, 0, 1 / 60); } catch (_) {} }

  // Keep the player's own rig out of a detached inspection lens.
  if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;

  /* ---- camera, in the CELL's frame ------------------------------------
     `lat` is across the bed (away from the wall it backs onto), `along` runs
     toward the foot end (bunkRig puts the pillow at -z). Positions are held
     inside the cell so no camera ends up inside a partition. */
  const b = cell.bunk;
  const lat = cell.dz !== 0 ? 1 : cell.dx;
  const cam = input.subject.cam || {};
  const clampX = (x) => Math.max(cell.x - cell.hx + 0.30, Math.min(cell.x + cell.hx - 0.30, x));
  const clampZ = (z) => Math.max(cell.z - cell.hz + 0.30, Math.min(cell.z + cell.hz - 0.30, z));
  const px = clampX(b.x + lat * (cam.lat || 2.4));
  const pz = clampZ(b.z + (cam.along || 1.2));
  const ax = b.x + lat * (cam.aimLat || 0.34);
  const az = b.z + (cam.aimAlong || 0);

  setHud(true);
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 52;
  camera.near = 0.12;
  camera.far = 20000;
  camera.position.set(px, cam.y || 1.4, pz);
  camera.lookAt(ax, cam.aimY || 0.82, az);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  if (!input.subject.hud) setHud(false);
  CBZ.renderer.render(CBZ.scene, camera);

  const audit = (typeof CBZ.cellSitAudit === "function") ? CBZ.cellSitAudit()
    : { seated: 0, offMattress: 0, worstOverhangCm: 0, latCm: [] };
  // This man specifically: how far his hips are from the bunk's centre line,
  // and how much of that is past the 0.525 m mattress edge.
  const hipLat = Math.abs(actor.group.position.x - b.x);
  const overhang = Math.max(0, hipLat - 0.525);

  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = input.subject.label;
  q("name").style.cssText = "position:absolute;top:72px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:360px";
  q("focus").textContent = `cell ${cell.tag || cell.i} · ${(actor.data && actor.data.name) || "inmate"} · hips ${Math.round(hipLat * 100)} cm from bunk centre (mattress edge 52.5 cm)`;
  q("focus").style.cssText = "position:absolute;top:104px;left:27px;color:#c0cfda;font-size:12px;font-weight:550";
  q("perf").textContent = `${overhang > 0 ? `OFF THE MATTRESS by ${Math.round(overhang * 100)} cm` : "ON the mattress"} · seated ${audit.seated} · off ${audit.offMattress}`;
  q("perf").style.cssText = `position:absolute;right:24px;top:24px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:${overhang > 0 ? "#ff9c9c" : "#9fe8c3"}`;
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname + new URL(input.sourceUrl).search;
  q("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    poseDebug: {
      cell: cell.tag || cell.i,
      x: Number(actor.group.position.x.toFixed(3)),
      z: Number(actor.group.position.z.toFixed(3)),
      yaw: Number(actor.group.rotation.y.toFixed(3)),
      bunkX: Number(b.x.toFixed(3)), bunkZ: Number(b.z.toFixed(3)),
      sitting: !!(actor.char && actor.char.sitting),
      seatKind: (actor.char && actor.char.seatRef && actor.char.seatRef.kind) || null,
      latCm: audit.latCm,
    },
    metrics: {
      hipLatCm: Math.round(hipLat * 100),
      hipOverhangCm: Math.round(overhang * 100),
      seatedOnBunks: audit.seated,
      sittingOnAir: audit.offMattress,
      worstOverhangCm: audit.worstOverhangCm,
    },
  };
}

export default {
  id: "prison-bunk-perch",
  title: "Prison Escape: sitting ON the bunk",
  description: "One cell resident in the ambient \"sit on your bunk\" pose, shot across, along and at mattress height. Before = the same local build with ?cfg_PRISON_BUNK_PERCH=0.",
  beforeLabel: "BEFORE · sits in front of the bed",
  afterLabel: "AFTER · sits on the bed",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metricsNote: "The mattress is 1.05 m wide, so its edge is 52.5 cm from the bunk's centre line. A seated body further out than that has no bed under it — hipOverhangCm is exactly how much air he is sitting on, and sittingOnAir counts every cell in the wing doing it.",
  metrics: {
    hipLatCm: { label: "Hips from bunk centre", unit: "cm" },
    hipOverhangCm: { label: "Hips past the mattress edge", unit: "cm", better: "lower" },
    sittingOnAir: { label: "Cells sitting on air", better: "lower" },
    worstOverhangCm: { label: "Worst overhang in the wing", unit: "cm", better: "lower" },
    seatedOnBunks: { label: "Bodies seated on bunks" },
  },
  subjects,
  stage: stagePerch,
};

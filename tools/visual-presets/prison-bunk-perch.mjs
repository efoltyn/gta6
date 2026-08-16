/* "When NPCs sit on their bed, they sit in front, not actually sitting on
   anything." — the owner, 2026-08-15, with a screenshot.

   "do you see how you really didnt fix shit because the head now intersects
   with the bunk bed? does this mean the bunk bead has to be taller?" — the
   same owner, the next morning. Yes: the two halves are the POSE (where his
   hips go) and the GEOMETRY (whether there is room for his head there), and
   this preset photographs both.

   A cell resident in the ambient "sitting on his bunk" pose, from angles that
   make hip-to-mattress contact and head-to-rack clearance impossible to fudge,
   plus the stack itself and a sleeper on its upper rack. Both sides are the
   SAME local build; the only difference is
   `?cfg_PRISON_BUNK_PERCH=0&cfg_PRISON_BUNK_HEADROOM=0`, which restores the
   old 0.62 m lateral offset, the door-facing yaw and the low rack exactly
   (world/cellblock.js).

   Staging is jail-scene.mjs's: boot the real escape mode, stub rAF so
   CBZ.stepSim is the only clock, then step the live wing. The subject cell is
   chosen by the wing's own position hash, so both sides photograph the same
   man in the same cell at the same simulated second; the cameras are derived
   from that cell's bunk record, so the two frames are pixel-comparable.

   The claim is also a number: CBZ.cellSitAudit() reports how far each seated
   body's hips are from the bunk's centre line, and the mattress is only
   +-0.525 m wide. */

const subjects = [
  { id: "perch-across", label: "Perched on the edge", style: "edge", hud: false,
    focus: "Straight across the bed. The hips belong ON the mattress with the thighs coming off its near edge, the soles on the concrete, and the head clear of the rack above. BEFORE: the body floats beside the frame at mattress height with its skull inside the steel.",
    cam: { lat: 3.0, along: 1.25, y: 1.45, aimLat: 0.34, aimY: 0.82, aimAlong: 0.0 } },
  { id: "perch-low", label: "Hips and mattress", style: "edge", hud: false,
    focus: "Camera on the mattress plane. The contact test: is there bed under the man, or air between his weight and the frame?",
    cam: { lat: 2.1, along: 1.9, y: 0.86, aimLat: 0.30, aimY: 0.78, aimAlong: 0.15 } },
  { id: "sit-back", label: "Sat back in the bed", style: "back", hud: false,
    focus: "The relaxed read the owner asked for: hips down the mattress, shoulders against the wall the pillow is under, legs run out ALONG the bed instead of hanging off it. Note the lean is backward and the head still clears the rack — the duck solve runs mirrored.",
    cam: { lat: 2.7, along: 0.1, y: 1.42, aimLat: 0.06, aimY: 0.90, aimAlong: -0.40 } },
  { id: "sit-back-side", label: "Sat back, from the foot", style: "back", hud: false,
    focus: "Down the bed's own axis. Both shins should lie along the mattress with the heels on the bedding, not folded down through the frame.",
    cam: { lat: 1.75, along: 2.5, y: 1.55, aimLat: 0.05, aimY: 0.86, aimAlong: -0.55 } },
  { id: "sit-brace", label: "Braced back on his arms", style: "brace", hud: false,
    focus: "Half relaxed: feet still on the concrete, weight thrown back onto straight arms planted behind the hips. The third posture exists so a row of cells does not read as one animation played thirteen times.",
    cam: { lat: 2.8, along: 1.5, y: 1.40, aimLat: 0.34, aimY: 0.88, aimAlong: 0.1 } },
  { id: "stack-whole", label: "The whole stack", style: "edge", hud: false,
    focus: "Both racks and the ladder from the aisle. Raising the upper rack has to leave a bunk, not a scaffold: the ladder grows the rung it needs, rail and posts travel with the deck, and the top mattress stays well under a 3.6 m cell roof.",
    cam: { outside: true, lat: 2.6, y: 1.75, aimLat: 0.0, aimY: 1.42, aimAlong: 0.0 } },
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
  /* ONE CELL PER POSTURE, and a REAL one: the wing hashes each cell's posture
     from its own coordinates (CBZ.cellblock.bunkStyle), independently of the
     flags, so both sides of the comparison photograph the same man in the
     same cell doing the same thing. Nothing here forces a pose that the live
     wing would not have chosen by itself — the flag decides how it is played,
     never who plays it. */
  S.byStyle = S.byStyle || {};
  const want = input.subject.style || "edge";
  if (!S.byStyle[want]) {
    const live = wing.cells.filter((c) => c && c.bunk && c.owner && c.owner !== "player" &&
      c.owner.group && c.owner.char && !c.owner.dead && !c.owner.escaped);
    const styleOf = (c) => (wing.bunkStyle ? wing.bunkStyle(c) : "edge");
    const c = live.find((x) => styleOf(x) === want && x.owner._cellPose === "bunk") ||
      live.find((x) => styleOf(x) === want) || live[0];
    if (!c) return { ok: false, err: "no cell resident for " + want };
    const n = c.owner;
    n._cellPose = "bunk";
    try { if (n._propBed && CBZ.propWake) CBZ.propWake(n, { instant: true }); } catch (_) {}
    try { if (CBZ.propStand) CBZ.propStand(n, { instant: true }); } catch (_) {}
    S.byStyle[want] = { cell: c, actor: n };
    step(3.5);                       // walk him in and let the seat solve settle
  } else {
    S.byStyle[want].actor._cellPose = "bunk";
    step(0.5);
  }
  S.cell = S.byStyle[want].cell; S.actor = S.byStyle[want].actor;
  const cell = S.cell, actor = S.actor;
  /* The upper-rack beat borrows the same man: propuse owns him while he is in
     a bed, and the wing's leash stands aside for exactly that (`_propBed`), so
     the following subjects have to hand him back. */
  /* A body propuse has put to bed is propuse's, and the wing's leash stands
     aside for exactly that. Hand him back before photographing the pose. */
  if (actor._propBed || actor._propLie) {
    try { if (CBZ.propWake) CBZ.propWake(actor, { instant: true }); } catch (_) {}
    try { if (CBZ.propStand) CBZ.propStand(actor, { instant: true }); } catch (_) {}
    actor._cellPose = "bunk";
    step(1.2);
  }
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
  // `outside` shoots from the aisle through the barred face — the only way to
  // get a 2.5 m stack in frame, since the cell is 3.2 m wide and the clamp
  // below (rightly) will not put a lens inside a partition.
  const px = cam.outside ? cell.x + cell.dx * (cell.hx + (cam.lat || 2.4))
    : clampX(b.x + lat * (cam.lat || 2.4));
  const pz = cam.outside ? cell.z + cell.dz * (cell.hz + (cam.lat || 2.4))
    : clampZ(b.z + (cam.along || 1.2));
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
  /* DOES HIS HEAD FIT UNDER THE RACK. Measured off the head MESH (the
     nametag sprite rides at ~1.97 and would flatter every reading), against
     the upper frame's own published underside. Negative headroom is steel
     through a skull — the owner's second report. */
  let headTop = null, headroom = null;
  const headMesh = actor.char && actor.char.skinSlots && actor.char.skinSlots.head &&
    actor.char.skinSlots.head[0];
  const rackUnder = b.rackUnder != null ? b.rackUnder : (b.topBunk != null ? b.topBunk - 0.41 : null);
  if (headMesh) {
    try {
      headMesh.updateWorldMatrix(true, false);
      headTop = new T.Box3().setFromObject(headMesh).max.y;
      if (rackUnder != null) headroom = rackUnder - headTop;
    } catch (_) {}
  }
  // This man specifically: how far his hips are from the bunk's centre line,
  // and how much of that is past the 0.525 m mattress edge.
  const hipLat = Math.abs(actor.group.position.x - b.x);
  const overhang = Math.max(0, hipLat - 0.525);

  const seated = !!(actor.char && actor.char.sitting);
  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = input.subject.label;
  q("name").style.cssText = "position:absolute;top:72px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:360px";
  q("focus").textContent = `cell ${cell.tag || cell.i} · ${(actor.data && actor.data.name) || "inmate"} · posture "${actor._bunkStyle || "edge"}"` +
    (seated ? ` · hips ${Math.round(hipLat * 100)} cm from bunk centre (mattress edge 52.5 cm)` : "");
  q("focus").style.cssText = "position:absolute;top:104px;left:27px;color:#c0cfda;font-size:12px;font-weight:550";
  const bad = seated && (overhang > 0 || (headroom != null && headroom < 0));
  q("perf").innerHTML = !seated
    ? `upper rack ${Math.round((b.topBunk || 0) * 100)} cm · asleep on it`
    : `${overhang > 0 ? `OFF THE MATTRESS by ${Math.round(overhang * 100)} cm` : "ON the mattress"}<br>` +
      (headroom == null ? "" : `${headroom < 0 ? `HEAD ${Math.round(-headroom * 100)} cm INSIDE the rack` : `head clears the rack by ${Math.round(headroom * 100)} cm`}`);
  q("perf").style.cssText = `position:absolute;right:24px;top:24px;text-align:right;line-height:1.7;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:${bad ? "#ff9c9c" : "#9fe8c3"}`;
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname + new URL(input.sourceUrl).search;
  q("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    poseDebug: {
      lying: !!(actor.char && actor.char.lying),
      propBed: !!actor._propBed,
      cell: cell.tag || cell.i,
      x: Number(actor.group.position.x.toFixed(3)),
      z: Number(actor.group.position.z.toFixed(3)),
      yaw: Number(actor.group.rotation.y.toFixed(3)),
      bunkX: Number(b.x.toFixed(3)), bunkZ: Number(b.z.toFixed(3)),
      sitting: !!(actor.char && actor.char.sitting),
      seatKind: (actor.char && actor.char.seatRef && actor.char.seatRef.kind) || null,
      style: actor._bunkStyle || null,
      styles: audit.styles || null,
      latCm: audit.latCm,
    },
    metrics: {
      upperMattressCm: b.topBunk == null ? 0 : Math.round(b.topBunk * 100),
      // Seated claims only. A sleeper on the upper rack is not "sitting on
      // air" and has no rack over his head; reporting him against those gauges
      // would put a made-up number in a table meant to settle an argument.
      ...(seated ? {
        hipLatCm: Math.round(hipLat * 100),
        hipOverhangCm: Math.round(overhang * 100),
        headroomCm: headroom == null ? 0 : Math.round(headroom * 100),
        headTopCm: headTop == null ? 0 : Math.round(headTop * 100),
      } : {}),
      rackUnderCm: rackUnder == null ? 0 : Math.round(rackUnder * 100),
      sitHeadroomCm: b.sitHeadroom == null ? 0 : Math.round(b.sitHeadroom * 100),
      seatedOnBunks: audit.seated,
      sittingOnAir: audit.offMattress,
      worstOverhangCm: audit.worstOverhangCm,
    },
  };
}

export default {
  id: "prison-bunk-perch",
  title: "Prison Escape: sitting ON the bunk, three ways",
  description: "One cell resident in the ambient \"sit on your bunk\" pose, shot across, along and at mattress height, plus the stack he is sitting on. Before = the same local build with ?cfg_PRISON_BUNK_PERCH=0&cfg_PRISON_BUNK_HEADROOM=0.",
  beforeLabel: "BEFORE · in front of the bed, head in the rack",
  afterLabel: "AFTER · on the bed, under the rack",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metricsNote: "The mattress is 1.05 m wide, so its edge is 52.5 cm from the bunk's centre line. A seated body further out than that has no bed under it — hipOverhangCm is exactly how much air he is sitting on, and sittingOnAir counts every cell in the wing doing it.",
  metrics: {
    hipLatCm: { label: "Hips from bunk centre", unit: "cm" },
    hipOverhangCm: { label: "Hips past the mattress edge", unit: "cm", better: "lower" },
    headroomCm: { label: "Head to the rack above", unit: "cm", better: "higher" },
    sitHeadroomCm: { label: "Mattress to rack underside", unit: "cm", better: "higher" },
    sittingOnAir: { label: "Cells sitting on air", better: "lower" },
    worstOverhangCm: { label: "Worst overhang in the wing", unit: "cm", better: "lower" },
    seatedOnBunks: { label: "Bodies seated on bunks" },
  },
  subjects,
  stage: stagePerch,
};

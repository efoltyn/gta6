/* prison-cell-free.mjs — THE CELL FLOOR, and a resident who can USE his open door.

   OWNER (2026-09-04, verbatim): "improve the cell and improve the prison floor
   and remove the weird red line in the middle, there's weird things on the
   floor rn i dont understand … npc will run at the open cell door and cant
   escape the cell, its dumb coding. when cell door is open they should be
   able to run thru — they are tied to their spot and they run at the open cell
   door glitchily like they're running in place trying to get out of it."

   TWO CLAIMS, ONE PRESET.

   1. THE FLOOR. Four plates of concrete: the player's own cell from its bunk
      end, the same cell through its open door, the centre hall at eye height
      and the hall from the roof. Nothing is staged — this is what the wing's
      ground looks like on a fresh boot at 09:00.

   2. THE DOOR. world/cellblock.js's leash clamped every cell resident into his
      cell's box EVERY FRAME, door open or shut. The brain (entities/ai.js)
      writes a target outside the cell — the player, a foe, a friend — at
      order 22, after the pre-mover clamp at 21.9 has already run, so the mover
      takes a step toward the door and the post-mover clamp at 22.6 takes it
      back. That is a body running on a treadmill in its own doorway, which is
      exactly the owner's sentence. `resident-hunt` provokes it on purpose: the
      player stands in the hall four metres from a resident's OPEN door and the
      resident is given a grudge (huntPlayer). BEFORE he treads at the door
      plane; AFTER he walks through it and arrives.

      `treadmillS` is the number: how much of the provocation's last two
      seconds his thigh swung while his body gained nothing. A man walking
      somewhere scores ~0; a man running in place scores his whole stride.
      `pastDoorM` is how far past his own door plane he stands at the end.

   3. THE DAY. `wing-day` lets the wing run forty seconds of mid-morning and
      counts residents standing anywhere other than inside their own cell.
      BEFORE that is 0 by construction; AFTER the tier has men on it.

   Staging is jail-scene.mjs's: boot the real escape mode, stub rAF so
   CBZ.stepSim is the only clock, pin the sun to 09:00 (systems/dayplan.js
   reads the world's sun and nothing else) and step the live wing. */

const subjects = [
  { id: "cell-floor", label: "Your cell, from the bunk end", shot: "cell-in", hud: false,
    focus: "Floor level, looking at the open door from inside. The concrete, the leaf's floor track, anything lying on the slab that should not be." },
  { id: "cell-from-aisle", label: "Your cell through its open door", shot: "cell-out", hud: false,
    focus: "From the cross-aisle, through the pocketed leaf. The threshold and the floor inside it." },
  { id: "hall-floor", label: "Up the centre hall at eye height", shot: "hall", hud: false,
    focus: "Standing at the south throat looking north up the tier. Whatever runs down the middle of this floor is what the owner is pointing at." },
  { id: "hall-above", label: "The hall from the roof", shot: "above", hud: false,
    focus: "Straight down on the walkway between rows D and E. Lines on the concrete are unmissable from here." },
  { id: "resident-hunt", label: "A resident with a grudge, door open", shot: "door", act: "hunt", hud: false,
    focus: "The player stands in the hall four metres from a resident's OPEN door and the resident is given a grudge. BEFORE: he runs on the spot at his own door plane, clamped into his cell by a leash that never asked whether the door was open. AFTER: he walks through it." },
  { id: "wing-day", label: "The wing at mid-morning", shot: "above", act: "day", hud: false,
    focus: "Forty seconds of 09:00 with every leaf pocketed. A tier with open doors has men on it; a tier where every man is tied to his cell is a wallpaper of thirteen identical rooms." },
];

async function stageCell(input) {
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
      if (child.id === "__cellOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__cellFreeSeq;
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

    const overlay = document.createElement("div");
    overlay.id = "__cellOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__cellFreeSeq = { overlay, hour: 9, dayRan: false };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const pin = (h) => { try { if (CBZ.dayPhase) CBZ.dayPhase((h - 6) / 24); } catch (_) {} };
  const stepOne = () => {
    CBZ.hitstop = 0; CBZ.slowmo = 0;
    CBZ.stepSim(1 / 60);
    if (CBZ.player) { CBZ.player.hp = Math.max(CBZ.player.hp || 100, 60); CBZ.player.dead = false; }
  };
  const hold = (secs) => {
    const n = Math.max(0, Math.round(secs * 60));
    for (let i = 0; i < n; i++) { if (i % 30 === 0) pin(S.hour); stepOne(); }
    pin(S.hour);
  };
  const place = (x, z) => {
    const P = CBZ.player;
    if (!P || !P.pos) return;
    P.pos.set(x, 0, z); P.vy = 0;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.set(x, 0, z);
  };

  const wing = CBZ.cellblock;
  if (!wing || !wing.cells || !wing.cells.length) return { ok: false, err: "no cellblock" };
  const cells = wing.cells;
  const alive = (n) => n && n !== "player" && n.group && !n.dead && !n.escaped;
  const inCell = (c, p, pad) => p.x >= c.x - c.hx - pad && p.x <= c.x + c.hx + pad && p.z >= c.z - c.hz - pad && p.z <= c.z + c.hz + pad;

  if (!S.settled) { hold(3); S.settled = true; }

  const sub = input.subject;
  let hunt = null;
  if (sub.act === "hunt") {
    if (!S.hunt) {
      // an inner-row resident (his door opens onto the centre hall) who is not
      // asleep — the hall is the one aisle wide enough to photograph the run.
      const pick = cells.find((c) => c.dx !== 0 && Math.abs(c.faceX) < 8 && alive(c.owner) && !c.owner._propLie)
        || cells.find((c) => c.dx !== 0 && alive(c.owner)) || cells.find((c) => alive(c.owner));
      if (!pick) return { ok: false, err: "no resident" };
      const n = pick.owner;
      try { if (n._propBed && CBZ.propWake) CBZ.propWake(n, { instant: true }); } catch (_) {}
      try { if (CBZ.propStand) CBZ.propStand(n, { instant: true }); } catch (_) {}
      if (pick.locked && wing.setDoor) wing.setDoor(pick, false);
      hold(0.5);
      place(pick.faceX + pick.dx * 4.0, pick.doorZ);
      n.huntPlayer = 14; n.pause = 0;
      /* THE TREADMILL IS INVISIBLE TO A POSITION TRAIL. The clamp undoes the
         mover's step inside the same frame, so a body sampled once per frame
         never moved at all — the only thing that moved was the walk cycle
         entities/npc.js fed the rig. So the number is read off the RIG: frames
         where his left thigh swung (entities/character.js animChar drives
         parts.ll.rotation.x only while it is handed a speed) while his body
         gained under half a centimetre. That is a man running on the spot,
         literally, and it is the same test on both builds. */
      let tread = 0;
      const thigh = () => (n.char && n.char.parts && n.char.parts.ll) ? n.char.parts.ll.rotation.x : 0;
      for (let i = 0; i < 6 * 60; i++) {
        if (i % 30 === 0) pin(S.hour);
        n.huntPlayer = Math.max(n.huntPlayer, 4);
        // the player never fights back, and never falls: the beat is the walk
        if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
        const bx = n.group.position.x, bz = n.group.position.z, t0 = thigh();
        stepOne();
        place(pick.faceX + pick.dx * 4.0, pick.doorZ);
        if (i >= 4 * 60) {
          const moved = Math.hypot(n.group.position.x - bx, n.group.position.z - bz);
          if (Math.abs(thigh() - t0) > 0.02 && moved < 0.005) tread++;
        }
      }
      S.hunt = { cell: pick, actor: n, tread: tread / 60 };
    }
    hunt = S.hunt;
  }
  if (sub.act === "day" && !S.dayRan) {
    if (S.hunt) { S.hunt.actor.huntPlayer = 0; }
    place(0, -9.4);
    hold(40);
    S.dayRan = true;
  }

  // ---- the census, one instrument on both builds -------------------------
  let residents = 0, out = 0, doorsOpen = 0, treadmill = 0;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (!c.locked) doorsOpen++;
    if (!alive(c.owner)) continue;
    residents++;
    if (!inCell(c, c.owner.group.position, 0.1)) out++;
  }

  // ---- camera -------------------------------------------------------------
  const pc = wing.playerCell || cells[0];
  let cam;
  switch (sub.shot) {
    case "cell-in":
      cam = { x: pc.x + 0.35, y: 1.45, z: pc.z - pc.hz + 0.95, ax: pc.doorX, ay: 0.15, az: pc.doorZ + 1.6, fov: 62 };
      break;
    case "cell-out":
      cam = { x: pc.doorX + 0.5, y: 1.25, z: pc.doorZ + 2.9, ax: pc.x - 0.2, ay: 0.25, az: pc.z - 0.6, fov: 58 };
      break;
    case "hall":
      cam = { x: 0, y: 1.7, z: -9.6, ax: 0, ay: 0.35, az: -30, fov: 58 };
      break;
    case "above":
      // under the wing's own roof deck (world/roofs.js lids the block at WH 9)
      cam = { x: 0, y: 8.3, z: -9.0, ax: 0, ay: 0, az: -27, fov: 64 };
      break;
    case "door": {
      const c = hunt.cell;
      cam = { x: c.faceX + c.dx * 5.4, y: 1.75, z: c.doorZ + 1.6, ax: c.doorX, ay: 0.85, az: c.doorZ, fov: 56 };
      break;
    }
    default:
      cam = { x: 0, y: 1.7, z: -9.6, ax: 0, ay: 0.35, az: -30, fov: 58 };
  }
  // the player's own rig is not the subject of any plate
  if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = cam.fov || 56;
  camera.near = 0.12;
  camera.far = 20000;
  camera.position.set(cam.x, cam.y, cam.z);
  camera.lookAt(cam.ax, cam.ay, cam.az);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  setHud(false);
  CBZ.renderer.render(CBZ.scene, camera);

  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = sub.label;
  q("name").style.cssText = "position:absolute;top:72px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:380px";
  q("focus").style.cssText = "position:absolute;top:104px;left:27px;color:#c0cfda;font-size:12px;font-weight:550;max-width:420px";
  q("perf").style.cssText = "position:absolute;right:24px;top:24px;text-align:right;line-height:1.7;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3";
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname + new URL(input.sourceUrl).search;
  q("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  const metrics = { residents, residentsOut: out, doorsOpen };
  if (hunt) {
    const c = hunt.cell, p = hunt.actor.group.position;
    const past = c.dx !== 0 ? (p.x - c.faceX) * c.dx : (p.z - c.faceZ) * c.dz;
    treadmill = hunt.tread;
    const toPlayer = Math.hypot(p.x - CBZ.player.pos.x, p.z - CBZ.player.pos.z);
    metrics.pastDoorM = Math.round(past * 100) / 100;
    metrics.treadmillS = Math.round(treadmill * 100) / 100;
    metrics.reachedPlayer = toPlayer < 2.4 ? 1 : 0;
    q("focus").textContent = `cell ${c.tag || c.i} · ${(hunt.actor.data && hunt.actor.data.name) || "inmate"} · door ${c.locked ? "SHUT" : "open"}`;
    q("perf").innerHTML = `${past > 0.3 ? `${past.toFixed(1)} m PAST his door` : `${(-past).toFixed(1)} m INSIDE his door`}<br>` +
      `${treadmill.toFixed(1)} s of the last 2 s walking on the spot<br>` +
      `${toPlayer.toFixed(1)} m from the player`;
    q("perf").style.color = past > 0.3 && treadmill < 0.3 ? "#9fe8c3" : "#ff9c9c";
  } else {
    q("focus").textContent = `${residents} residents · ${out} outside their cell · ${doorsOpen}/${cells.length} leaves open · ${S.hour}:00`;
    q("perf").innerHTML = sub.act === "day" ? `${out} of ${residents} residents out on the tier` : "";
    q("perf").style.color = sub.act === "day" ? (out > 0 ? "#9fe8c3" : "#ff9c9c") : "#9fe8c3";
  }

  return { ok: true, metrics };
}

export default {
  id: "prison-cell-free",
  title: "Prison Escape: the cell floor, and a door a resident can use",
  description: "Four plates of the wing's floor, then a resident provoked through his OPEN door (the leash used to clamp him into his cell regardless), then forty seconds of mid-morning to count men on the tier. Before = a HEAD worktree on its own port.",
  beforeLabel: "BEFORE · leashed with the door open",
  afterLabel: "AFTER · the door means something",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 600000,
  metricsNote: "treadmillS is how much of the provocation's last two seconds the resident spent swinging his legs while his body gained under 5 mm in the frame (read off the rig, not the mover): a man walking somewhere scores ~0, a man running in place at a door scores the whole two seconds. pastDoorM is positive once he is outside his own door plane. residentsOut counts cell residents standing anywhere but inside their own cell.",
  metrics: {
    pastDoorM: { label: "Past his own door", unit: "m", better: "higher" },
    treadmillS: { label: "Walking on the spot", unit: "s", better: "lower" },
    reachedPlayer: { label: "Reached the player", better: "higher" },
    residentsOut: { label: "Residents out on the tier", better: "higher" },
    residents: { label: "Cell residents" },
    doorsOpen: { label: "Leaves open" },
  },
  subjects,
  stage: stageCell,
};

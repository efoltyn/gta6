/* steal-mark.mjs — what a man in the prison does when you keep going through
   his pockets, photographed at conversational distance.

   OWNER 2026-09-04: "when i try to steal multiple times from someone there's
   an emoji that shows over their head ... no emojis over heads, it should be
   bodily movement etc, i want npcs more real acting."

   The emoji was systems/markers.js: three canvas sprites ("!" for a screw who
   is getting suspicious, "!" in a white disc for a man who has told on you,
   a torch for a cop-role tip). A failed lift feeds the victim's grudge into
   detection.js's snitch roll, so the second or third lift on the same man
   sends HIM to the guards — and the disc lit over his head.

   Three beats, each a REAL state written through the game's own seams (the
   steal verb itself, reportedPlayerT, guard alert), stepped on a frozen
   clock, shot from the subject's right-front so a hand at the hip and a head
   turned off you both read. Nothing pokes a bone: the picture is whatever
   the live drivers do with that state on each build.

   Flagless: shoot the before on HEAD, edit, then --reuse-before.

     ba --preset steal-mark --only before --no-open
     ba --preset steal-mark --reuse-before <that dir>
*/

/* ORDER MATTERS: a failed lift files a crime (case pressure, a last-known
   position) that puts the block's guards on a hunt in a later beat — so the
   screw is photographed first, before anybody has been robbed. */
const subjects = [
  {
    id: "guard-suspicious",
    label: "A screw who is getting suspicious",
    focus: "guard.alert = 0.5, no hunt, no torch. Before: an orange '!' over his cap. After: nothing over his head — he watches you instead, and his hand rests on his belt.",
    beat: "guard",
  },
  {
    id: "snitch-walkup",
    label: "The man who already told on you",
    focus: "reportedPlayerT set — he has been to the screws about you. Before: the '!' disc. After: he won't hold your eye — head turned off you, a sidelong glance every couple of seconds (and, off-frame, a step back when you close inside 2.8 m).",
    beat: "snitch",
  },
  {
    id: "mark-repeat-lift",
    label: "The man you keep robbing",
    focus: "CBZ.econ.steal() on the same inmate until he goes to tell (the owner's repro). Before: a white disc with a '!' floats over his head. After: no icon — the first catch, his hand clamps over his pocket and his body turns side-on; the second, he squares up and comes at you.",
    beat: "lift",
  },
];

async function stageStealMark(input) {
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
  const groundAt = (x, z) => {
    try {
      const y = CBZ.floorAt ? CBZ.floorAt(x, z) : 0;
      return Number.isFinite(y) ? y : 0;
    } catch (_) { return 0; }
  };

  let S = window.__stealMark;
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
    await until(() => {
      const card = document.getElementById("bootload");
      return !card || getComputedStyle(card).display === "none";
    }, 20000, 50);
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    for (let i = 0; i < 360; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    const live = (a) => a && a.char && a.group && !a.dead;
    const inmates = (CBZ.npcs || []).filter((n) => live(n) && (n.role === "inmate" || n.role === "thief") && n.gang >= 0);
    const guards = (CBZ.guards || []).filter(live);
    if (inmates.length < 2 || !guards.length) return { ok: false, err: "not enough live rigs: " + inmates.length + " inmates, " + guards.length + " guards" };

    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      child.style.visibility = "hidden";
    }
    const overlay = document.createElement("div");
    overlay.id = "__stealMarkOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-state></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__stealMark = { inmates, guards, overlay };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const subject = input.subject;
  const player = CBZ.player;
  const playerChar = CBZ.playerChar;
  if (!player || !playerChar) return { ok: false, err: "missing player" };

  const actor = subject.beat === "guard" ? S.guards[0] : subject.beat === "lift" ? S.inmates[0] : S.inmates[1];
  if (!actor) return { ok: false, err: "no actor for " + subject.id };

  // ---- studio: subject 2.6 m up the lane from the player, both facing ------
  const PX = 0, PZ = 34, GX = 0, GZ = 31.4;
  const py = groundAt(PX, PZ), gy = groundAt(GX, GZ);
  CBZ.dayPhase(0.25);
  try { if (CBZ.fpsSetAim) CBZ.fpsSetAim(false); } catch (_) {}
  try { if (CBZ.fpsSetActive) CBZ.fpsSetActive(false); } catch (_) {}
  if (CBZ.invOpen && CBZ.toggleInventory) CBZ.toggleInventory();

  // everybody else out of the frame and out of witness range
  for (const a of (CBZ.guards || []).concat(CBZ.npcs || [])) {
    if (a === actor || !a || !a.group) continue;
    a.group.position.set(a.group.position.x, gy, -260);
    a.group.visible = false;
    if (a.kind === "guard" || a.kind === "warden") { a.hunt = 0; a.alert = 0; a.investigate = null; a.flashlightLost = true; }
  }
  actor.group.visible = true;
  actor.dead = false; actor.ko = 0; actor.asleep = false;
  actor.hunt = 0; actor.alert = 0; actor.investigate = null;
  actor.flashlightOn = false; actor.flashlightLost = true;
  actor.hp = actor.maxHp || 100;

  player.dead = false; player.hp = 100; player.stun = 0;
  player.captureState = "normal"; player.captureT = 0;
  playerChar.cuffed = false;
  CBZ.game.cigs = Math.max(CBZ.game.cigs || 0, 40);

  const pinPlayer = () => {
    player.pos.set(PX, py, PZ);
    player.vy = 0; player.grounded = true; player.dead = false; player.hp = 100;
    playerChar.group.position.set(PX, py, PZ);
    playerChar.group.rotation.y = Math.atan2(GX - PX, GZ - PZ);
    if (CBZ.cam) CBZ.cam.yaw = Math.atan2(-(GX - PX), -(GZ - PZ));
  };
  // held actors stand 0.6 rad off the player (turned toward the tripod), so a
  // head that turns onto him is a visible turn and not a zero-degree stare
  const pinActor = () => {
    actor.group.position.set(GX, gy, GZ);
    actor.group.rotation.y = Math.atan2(PX - GX, PZ - GZ) + 0.6;
    if (actor.pos && actor.pos !== actor.group.position) actor.pos.set(GX, gy, GZ);
  };
  const step = (frames, holdActor) => {
    for (let i = 0; i < frames; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      pinPlayer();
      if (holdActor) pinActor();
      if (subject.beat === "guard") { actor.alert = 0.5; actor.hunt = 0; actor.investigate = null; actor.flashlightOn = false; }
      // the snitch beat is about ONE fact (he has talked). His wander brain
      // rolls approaches, flees and vendettas on its own clock and each of
      // those changes the frame run to run; pin the state so the pair is a
      // pair. (Real fields, the ones his brain reads — not a bone.)
      if (subject.beat === "snitch") { actor.aiState = "wander"; actor.approach = null; actor.hunt = 0; actor.huntPlayer = 0; }
      CBZ.stepSim(1 / 60);
      pinPlayer();
      if (holdActor) pinActor();
    }
  };

  // settle on the mark with the actor held, then run the beat
  pinActor();
  step(45, true);

  let attempts = 0, lifts = 0, caught = false, lines = [];
  if (subject.beat === "lift") {
    // the owner's repro: keep going through the same man's pockets. Every
    // failed lift rolls him as a snitch (detection.js trySnitch, his grudge in
    // the odds), so this stops the moment he goes to tell — or after ten.
    const told = () => actor.aiState === "snitch" || (actor.reportedPlayerT || 0) > 0;
    while (attempts < 10 && !told() && CBZ.econ && CBZ.econ.steal) {
      attempts++;
      let r = null;
      try { r = CBZ.econ.steal(actor); } catch (e) { lines.push("steal threw: " + (e && e.message)); break; }
      if (r && r.ok) lifts++; else { caught = true; if (r && r.msg) lines.push(r.msg); }
      step(12, true);
    }
    lines.push(told() ? "he went to tell" : "never told");
  } else if (subject.beat === "snitch") {
    actor.reportedPlayerT = 30;
    actor.reportedPlayerCred = 0.8;
    actor.playerGrudge = Math.max(actor.playerGrudge || 0, 4);
  }
  // the reaction window. The lift mark and the guard are HELD on the mark so
  // the frame is of a body 2.6 m away and not of a man leaving it (the lift
  // sends him to the screws on the build under test — a walk-off is real,
  // but it is not the picture); the snitch is free so a step off you can show.
  // (The snitch is held too: his wander brain walked him out of frame on both
  // builds, and the picture is his HEAD. The step off you he takes inside
  // 2.8 m is real — CBZ.npcStepBack — but is not in this frame.)
  step(subject.beat === "guard" ? 60 : 36, true);

  // ---- read the body, not the HUD ----------------------------------------
  const ch = actor.char || {};
  const deg = (v) => Math.round(Math.abs(v || 0) * 180 / Math.PI);
  const sprites = ["_tipMarker", "_snitchMarker", "_alertMarker"]
    .map((k) => actor[k]).filter((s) => s && s.visible && s.material && s.material.opacity > 0.02).length;
  const ap = actor.group.position;
  const standoff = Math.hypot(ap.x - PX, ap.z - PZ);
  const neckYawDeg = deg(ch.neck && ch.neck.rotation.y);
  const bodyYawDeg = deg(ch.body && ch.body.rotation.y);
  const armDeg = deg(ch.parts && ch.parts.la && ch.parts.la.rotation.x);
  const elbowDeg = deg(ch.low && ch.low.la && ch.low.la.rotation.x);

  // ---- camera: the subject's right-front, head to thigh --------------------
  const camera = CBZ.camera;
  const locked = input.referenceStage && input.referenceStage.camera;
  const cam = locked || { x: GX + 2.2, y: 1.62, z: GZ + 2.25, ax: GX, ay: 1.18, az: GZ, fov: 40 };
  camera.aspect = input.width / input.height;
  camera.fov = cam.fov || 40;
  camera.near = 0.08;
  camera.far = 20000;
  camera.position.set(cam.x, cam.y, cam.z);
  camera.lookAt(cam.ax, cam.ay, cam.az);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();

  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;top:72px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em";
  const who = (actor.data && actor.data.name) || actor.name || actor.kind || "actor";
  q("state").textContent = `${who} · ${standoff.toFixed(1)} m` +
    (subject.beat === "lift" ? ` · ${attempts} lifts, ${lifts} clean, ${caught ? "CAUGHT" : "never caught"}` : "") +
    ` · state ${actor.aiState || "-"}${(actor.huntPlayer || 0) > 0 ? " · COMING AT YOU" : ""} · grudge ${(actor.playerGrudge || 0).toFixed(1)} · icons over head ${sprites}`;
  q("state").style.cssText = "position:absolute;top:104px;left:27px;color:#c0cfda;font-size:11px;font-weight:700;letter-spacing:.08em";
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname + new URL(input.sourceUrl).search;
  q("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  camera.updateMatrixWorld(true);
  CBZ.renderer.render(CBZ.scene, camera);

  return {
    ok: true,
    actor: who, aiState: actor.aiState || null, attempts, lifts, caught, lines,
    body: { huntPlayer: actor.huntPlayer, fightStance: !!(ch.fightStance), stareAvert: !!actor.stareAvert, stareAt: actor.stareAt ? ((actor.stareAt.data && actor.stareAt.data.name) || actor.stareAt.kind || "other") : "player", neckY: ch.neck ? ch.neck.rotation.y : null, reported: actor.reportedPlayerT, alert: actor.alert, armed: !!actor.armed, holstered: actor._holstered, pocketGuardT: actor.pocketGuardT, stareT: actor.stareT, hunt: actor.hunt, flashlightOn: !!actor.flashlightOn, hasLow: !!(ch.low && ch.low.la), hasLa: !!(ch.parts && ch.parts.la) },
    camera: { x: cam.x, y: cam.y, z: cam.z, ax: cam.ax, ay: cam.ay, az: cam.az, fov: cam.fov || 40 },
    // only the rows that mean something on this beat: an arm angle on a man
    // mid-stride is a walk cycle, not a tell, and printing it as a regression
    // would be a lie the verdict line repeats.
    // The lift beat's arm rows are NOT reported: on HEAD the confrontation
    // brain (approachPlayer, "Hands. Now.") already bends that arm, so the
    // pocket clamp measures as a few degrees either way. The guard beat, whose
    // before is a straight idle arm, is where the clamp is measured.
    metrics: subject.beat === "lift"
      ? { iconsOverHead: sprites, bodyYawDeg, squaredUp: ch.fightStance ? 1 : 0 }
      : subject.beat === "guard"
        ? { iconsOverHead: sprites, neckYawDeg, armDeg, elbowDeg }
        : { iconsOverHead: sprites, neckYawDeg },
  };
}

export default {
  id: "steal-mark",
  title: "Cell Block Z: the man you keep robbing — an icon over his head, or a body that reacts",
  description: "Three live prison beats — a mark caught on a repeat lift, a man who has already told on you, a screw getting suspicious — shot at 2.6 m from the subject's right-front. The question in every frame is whether the game says it with a floating symbol or with the man.",
  beforeLabel: "BEFORE · ICON OVER HEAD",
  afterLabel: "AFTER · THE BODY SAYS IT",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 64321 },
  stageTimeoutMs: 420000,
  pairNote: "Same escape mode · seed · actors · marks · camera · noon · same state written through the game's own seams",
  method: "Boots the registered Prison Escape mode on both sources, freezes the clock, walks every other actor out of witness range, and runs the REAL steal verb (or writes the real snitch / alert state) on one live man 2.6 m from the real player. Then 0.6–1.0 s of sim with the man free to move, and one frame from a fixed tripod.",
  metricsNote: "iconsOverHead counts systems/markers.js sprites visible on the subject. The other rows are read straight off his rig: neck yaw (a stare or an averted head), body yaw (turned side-on), left arm pitch + elbow (a hand at the pocket), and how far he stands from you at capture.",
  metrics: {
    iconsOverHead: { label: "Icons floating over his head", better: "lower" },
    neckYawDeg: { label: "Head turned (deg)", unit: "deg", better: "higher" },
    bodyYawDeg: { label: "Body turned side-on (deg)", unit: "deg", better: "higher" },
    squaredUp: { label: "Squared up to hit you (second catch)", better: "higher" },
    armDeg: { label: "Left arm pitch (deg)", unit: "deg", better: "higher" },
    elbowDeg: { label: "Left elbow bend (deg)", unit: "deg", better: "higher" },
    standoffM: { label: "Distance from you at capture", unit: "m", better: "higher" },
  },
  subjects,
  stage: stageStealMark,
};

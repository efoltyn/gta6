/* Prison Escape guard-torch discipline proof for tools/visual-compare.mjs.

   The owner watched a screw walk up to him and said the guards and the warden
   use their flashlights like a weapon in close quarters. This preset
   photographs that claim instead of arguing about it: the real Escape mode
   boots, rAF freezes, and one live guard is put on an authored mark with a
   REAL hunt running against the real player rig — 5.4 m out in daylight, at
   arm's length with the taser actually drawn through systems/taserfx.js, at
   2.4 m in the dark, and searching an empty yard at lights-out.

   Nothing here is a mannequin: `g.hunt` is set and updateGuard is stepped, so
   the guard turns, animates and lights (or does not light) his torch by the
   same code path a player meets at 3 a.m. Only his POSITION is pinned each
   tick, because a hunting man closes the distance and a storyboard needs a
   fixed mark.

   Runs as a flag A/B against ONE local server — both sides same build, same
   seed, same marks, differing only by the flag under test:

     PORT=8611 python3 tools/devserver.py &
     node tools/visual-compare.mjs --preset guard-torch \
       --before "http://127.0.0.1:8611/?cfg_GUARD_TORCH_DISCIPLINE=0" \
       --after  "http://127.0.0.1:8611/" \
       --before-label "BEFORE · TORCH AS WEAPON" --after-label "AFTER · TORCH DISCIPLINE" \
       --out artifacts/visual-comparisons/guard-torch --no-open
*/

const subjects = [
  {
    id: "noon-charge",
    label: "Daylight charge · 5.4 m and closing",
    focus: "A guard running a prisoner down under a midday sun. There is nothing for a beam to do here — his hands should be empty and swinging. A lit torch held out at the man he is chasing is the whole complaint.",
    state: "noon-charge",
    cam: { x: 6.05, y: 2.05, z: 31.30, ax: 0, ay: 1.28, az: 31.10, fov: 42 },
  },
  {
    id: "noon-contact",
    label: "Contact · the taser is out",
    focus: "Arm's length, taser drawn through the real taserfx seam. The taser and the torch hang off the SAME right hand socket — one object per fist, or the arrest is performed with a flashlight welded to the weapon.",
    state: "noon-contact",
    cam: { x: 3.55, y: 1.72, z: 33.35, ax: 0, ay: 1.24, az: 33.30, fov: 34 },
  },
  {
    id: "night-close",
    label: "Lights out · 2.4 m and closing",
    focus: "After dark the light is legitimate — he needs it — but the CARRY is not. The torch should hang from a running arm, not be presented at the prisoner's face like a muzzle.",
    state: "night-close",
    cam: { x: 4.70, y: 1.92, z: 32.85, ax: 0, ay: 1.30, az: 32.70, fov: 38 },
  },
  {
    id: "night-search",
    label: "Lights out · searching an empty yard",
    focus: "The control plate. The night stealth loop — a beam thrown ahead of a searching man, a cone in the air and a pool on the concrete — must survive this change untouched. These two frames should be indistinguishable.",
    state: "night-search",
    cam: { x: 5.60, y: 2.45, z: 31.20, ax: 0, ay: 0.95, az: 26.10, fov: 46 },
  },
];

async function stageGuardTorch(input) {
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

  let S = window.__guardTorch;
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
    // startRunPresented hides its boot card two RAFs after the synchronous
    // build; freezing RAF before those frames preserves the card forever.
    await until(() => {
      const card = document.getElementById("bootload");
      return !card || getComputedStyle(card).display === "none";
    }, 20000, 50);
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    // Let the prison reveal rail finish. A camera staged during the reveal is
    // silently overwritten and photographs a wall.
    for (let i = 0; i < 360; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    const guards = (CBZ.guards || []).filter((g) => g && g.char && g.group && !g.dead);
    if (!guards.length) return { ok: false, err: "no live guard rigs" };

    // HUD off: this is a storyboard of two bodies, not a screenshot of a game.
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      child.style.visibility = "hidden";
    }
    const overlay = document.createElement("div");
    overlay.id = "__guardTorchOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-state></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__guardTorch = { guards, overlay };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const subject = input.subject;
  const player = CBZ.player;
  const playerChar = CBZ.playerChar;
  const actor = S.guards[0];
  if (!actor || !player || !playerChar) return { ok: false, err: "missing live actors" };

  // ---- the four marks ------------------------------------------------------
  // phase 0.25 = noon, 0.75 = the middle of the prison night (core/daynight.js
  // gives escape a 12-minute day). `gz` is how far up the lane from the player
  // the guard stands, which is the only variable that decides "close quarters".
  const MARKS = {
    "noon-charge": { phase: 0.25, gz: 28.60, hunt: true, taser: false },
    "noon-contact": { phase: 0.25, gz: 32.75, hunt: true, taser: true },
    "night-close": { phase: 0.75, gz: 31.60, hunt: true, taser: false },
    "night-search": { phase: 0.75, gz: 27.00, hunt: false, taser: false },
  };
  const mark = MARKS[subject.state] || MARKS["noon-charge"];

  const PX = 0, PZ = 34;
  const py = groundAt(PX, PZ);
  const gx = 0, gz = mark.gz;
  const gy = groundAt(gx, gz);

  let audit = null, lightLevel = null;
  let camera = CBZ.camera;

  // ---- the yard, cleared ---------------------------------------------------
  try { if (CBZ.fpsSetAim) CBZ.fpsSetAim(false); } catch (_) {}
  try { if (CBZ.fpsSetActive) CBZ.fpsSetActive(false); } catch (_) {}
  if (CBZ.invOpen && CBZ.toggleInventory) CBZ.toggleInventory();
  CBZ.dayPhase(mark.phase);

  // Every guard who is not the subject is walked out of frame and stripped of
  // his torch — `flashlightLost` is the game's own "this man has no light"
  // state (systems/economy.js's pickpocket sets it), so the audit at the
  // bottom counts ONE torch and both sides are stripped identically.
  for (const g of S.guards) {
    if (g === actor) continue;
    g.flashlightLost = true;
    g.hunt = 0; g.alert = 0; g.investigate = null;
    if (g.group) { g.group.position.set(g.group.position.x, gy, -260); g.group.visible = false; }
  }
  for (const n of CBZ.npcs || []) if (n && n.group) n.group.visible = false;

  actor.dead = false; actor.ko = 0; actor.asleep = false; actor.bribed = 0;
  actor.flashlightLost = false;
  actor.flashlightPatrol = true;          // he is one of the torch-carrying detail
  actor.flashlightPhase = 0;              // pin the duty cycle: both sides, same beam
  actor.group.visible = true;
  actor.hp = actor.maxHp || 140;
  actor._seizing = null;
  actor.armed = false; actor._holstered = undefined; actor.weapon = null;
  if (actor._weaponProp) actor._weaponProp.visible = false;

  player.dead = false; player.hp = 100; player.driving = false; player._swim = false;
  player.subdue = 0;
  player.stun = 0; player.captureState = "normal"; player.captureT = 0;
  player.pos.set(PX, py, PZ);
  player.vy = 0; player.grounded = true;
  playerChar.group.visible = true;
  playerChar.cuffed = false;

  // ---- run the real brain, pin only the marks ------------------------------
  const pin = () => {
    actor.group.position.set(gx, gy, gz);
    player.pos.set(PX, py, PZ);
    player.vy = 0; player.grounded = true;
    player.dead = false; player.hp = 100;
    player.stun = 0; player.captureState = "normal"; player.captureT = 0;
    playerChar.group.position.set(PX, py, PZ);
    // the prisoner looks at the man walking him down — the guard's OWN facing
    // formula (entities/guards.js), read the other way round.
    playerChar.group.rotation.y = Math.atan2(gx - PX, gz - PZ);
    for (const n of CBZ.npcs || []) if (n && n.group) n.group.visible = false;
  };
  const step = (frames) => {
    for (let i = 0; i < frames; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      if (mark.hunt) { actor.hunt = 3.0; actor.alert = 1.0; actor.investigate = null; }
      else {
        actor.hunt = 0; actor.alert = 0.4;
        actor.investigate = { x: gx, z: gz - 6, t: 6, scan: 0.6 };
      }
      pin();
      CBZ.stepSim(1 / 60);
      pin();
    }
  };

  // Settle the sky, the light rig and the rig pose on the mark before anything
  // is judged: dayness/nightAmount are written by an updater, and the schedule
  // drives the fixtures on its own 0.35 s beat.
  step(90);

  // The taser is drawn through the real seam, not faked: taserfx sets
  // weapon/armed/_holstered and parents the model to `thirdPersonWeapon`, a
  // CHILD of the same rightHand socket the torch hangs off. That collision is
  // the plate.
  if (mark.taser && CBZ.taserFx && CBZ.taserFx.actorTasePlayer) {
    try { CBZ.taserFx.actorTasePlayer(actor); } catch (_) {}
    step(10);
  }

  try { audit = CBZ.guardTorchAudit ? CBZ.guardTorchAudit() : null; } catch (_) { audit = null; }
  try {
    lightLevel = CBZ.prisonLights && CBZ.prisonLights.level
      ? CBZ.prisonLights.level(gx, gz) : null;
  } catch (_) { lightLevel = null; }

  // ---- camera --------------------------------------------------------------
  camera = CBZ.camera;
  const locked = input.referenceStage && input.referenceStage.camera;
  const cam = locked || subject.cam;
  camera.aspect = input.width / input.height;
  camera.fov = cam.fov || 50;
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
  const reason = actor.flashlightOn ? (actor.flashlightReason || "on") : "dark";
  const carry = actor.flashlightOn ? (actor.flashlightPresented ? "PRESENTED" : "AT HIS SIDE") : "NO TORCH";
  q("state").textContent = `${Math.hypot(gx - PX, gz - PZ).toFixed(1)} m · torch: ${carry} · reason: ${reason}` +
    (lightLevel == null ? "" : ` · light ${Math.round(lightLevel * 100)}%`);
  q("state").style.cssText = "position:absolute;top:104px;left:27px;color:#c0cfda;font-size:11px;font-weight:700;letter-spacing:.08em";
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname + new URL(input.sourceUrl).search;
  q("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  camera.updateMatrixWorld(true);
  CBZ.renderer.render(CBZ.scene, camera);

  const metrics = {};
  if (audit) {
    metrics.torchAsWeapon = audit.torchAsWeapon;
    metrics.litInDaylight = audit.litInDaylight;
    metrics.litWithWeaponDrawn = audit.litWithWeaponDrawn;
    metrics.torchesLit = audit.lit;
    metrics.torchesPresented = audit.presented;
  }
  if (lightLevel != null) metrics.lightLevelPct = Math.round(lightLevel * 100);
  return {
    ok: true,
    camera: { x: cam.x, y: cam.y, z: cam.z, ax: cam.ax, ay: cam.ay, az: cam.az, fov: cam.fov || 50 },
    metrics,
  };
}

export default {
  id: "guard-torch",
  title: "Prison Escape: What a Guard Does With His Torch When He Is On Top Of You",
  description: "One live guard, one live hunt, four marks: a daylight charge, an arm's-length arrest with the taser drawn, a dark close, and a night search. The question in every frame is whether the duty flashlight is a tool or a weapon.",
  beforeLabel: "BEFORE · TORCH AS WEAPON",
  afterLabel: "AFTER · TORCH DISCIPLINE",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 64321 },
  stageTimeoutMs: 420000,
  pairNote: "Same escape mode · seed · guard · marks · camera · day phase · real hunt stepped 90 ticks",
  method: "The runner boots the registered Prison Escape mode on both sources, freezes the game clock, then runs a REAL hunt (g.hunt set, updateGuard stepped) against the real player rig with only the two floor marks pinned. The taser plate draws through systems/taserfx.js, the same seam capture.js uses. Both sides are the same build; the only difference is cfg_GUARD_TORCH_DISCIPLINE.",
  metricsNote: "Live counts from CBZ.guardTorchAudit() at the instant of capture. `torchAsWeapon` is the owner's complaint reduced to a number: a lit torch held out in front of a man the guard is already close enough to grab.",
  metrics: {
    torchAsWeapon: { label: "Torches presented inside grabbing range", better: "lower" },
    litInDaylight: { label: "Search torches lit in usable light", better: "lower" },
    litWithWeaponDrawn: { label: "Torches sharing a fist with a drawn weapon", better: "lower" },
    torchesLit: { label: "Torches burning" },
    torchesPresented: { label: "Torches held out in the search carry" },
    lightLevelPct: { label: "Light on the guard's mark", unit: "%" },
  },
  subjects,
  stage: stageGuardTorch,
};

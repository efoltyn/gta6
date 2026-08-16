/* Prison Escape blood + gunshot appearance proof for tools/visual-compare.mjs.

   The owner filmed the prison shootout and said the blood reads as CUBES. This
   preset photographs that claim instead of arguing about it: the real escape
   mode boots, rAF freezes, and every plate is a REAL gore event fired through
   the same seams a live prison bullet reaches — CBZ.bodyWound + CBZ.gore.spray
   for a body hit, CBZ.aiKill (entities/ai.js kill(), which calls CBZ.gore) for
   a death — then the clock is stepped a known number of frames so the camera
   catches a named moment: the burst leaving the body, the debris on the floor
   two seconds later, the yard after a five-man firefight, the pool under a
   corpse.

   Math.random is replaced with a seeded LCG for the whole of each subject's
   staging, so the two sides differ by the CODE UNDER TEST and nothing else —
   the same droplet gets the same fan angle on both plates. This matters more
   here than in any other preset in this directory: gore is the most
   random-driven system in the game, and an unseeded pair would show two
   different shootouts and prove nothing.

   Runs as a flag A/B against ONE local server:
     node tools/visual-compare.mjs --preset prison-blood \
       --before "http://127.0.0.1:PORT/?cfg_GORE_REALISM_V2=0" \
       --after  "http://127.0.0.1:PORT/"
*/

const subjects = [
  {
    id: "kill-burst",
    label: "Prison kill · the burst leaving the body",
    focus: "A real prison death 7 frames in. What leaves the body must read as blood and aerosol travelling down the shot line — not as flying coloured boxes big enough to count.",
    state: "kill-burst",
    cam: { x: 3.30, y: 2.02, z: 30.85, ax: 0, ay: 1.22, az: 25.50, fov: 44 },
  },
  {
    id: "gibs-settled",
    label: "Two seconds later · what is on the floor",
    focus: "The same kill after everything has landed. The yard should hold a spreading pool and a body, not a scatter of half-metre clothing-coloured cubes lying on the concrete.",
    state: "gibs-settled",
    cam: { x: 2.55, y: 1.32, z: 30.30, ax: 0, ay: 0.22, az: 25.70, fov: 46 },
  },
  {
    id: "firefight-floor",
    label: "After a five-man firefight · the yard",
    focus: "Five real kills across the north yard, four seconds after the last one. This is the shot the owner filmed: the floor must not be buried in permanent coloured blocks.",
    state: "firefight-floor",
    cam: { x: 1.20, y: 5.20, z: 37.20, ax: 0, ay: 0.30, az: 26.60, fov: 52 },
  },
  {
    id: "impact-spray",
    label: "Getting shot · the impact frame",
    focus: "One round into a living guard's chest, 5 frames in. The impact should read as a fine wet spray off the entry with a hole left behind, and the droplets should be droplets — small, stretched along their flight, not floating beads.",
    state: "impact-spray",
    // The shooter's own three-quarter view — what a player actually sees when
    // they put a round into someone. The entry side faces the lens (a purely
    // side-on camera hides the impact behind the body it just went into).
    cam: { x: 2.20, y: 1.85, z: 28.80, ax: 0, ay: 1.30, az: 25.60, fov: 34 },
  },
  {
    id: "blood-macro",
    label: "Macro · a single droplet fan",
    focus: "The droplets at close range, where the geometry has nowhere to hide. Each bit should be a small elongated drop, not a faceted lump the size of a fist.",
    state: "blood-macro",
    cam: { x: 2.35, y: 1.42, z: 25.95, ax: 0.05, ay: 1.30, az: 25.35, fov: 24 },
  },
  {
    id: "corpse-pool",
    label: "Corpse · six seconds of bleeding",
    focus: "The evidence you walk back past. A grown pool under the body with the debris gone, reading as blood soaking into concrete.",
    state: "corpse-pool",
    cam: { x: 2.85, y: 0.92, z: 29.60, ax: 0, ay: 0.12, az: 25.50, fov: 42 },
  },
];

async function stagePrisonBlood(input) {
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
  const setHud = (visible) => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__prisonBloodOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__prisonBlood;
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
    // Let the prison reveal rail finish. A detached inspection camera staged
    // during the reveal is silently overwritten and photographs a wall.
    for (let i = 0; i < 360; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
    }

    const guards = (CBZ.guards || []).filter((g) => g && g.char && g.group && !g.dead);
    if (!guards.length) return { ok: false, err: "no live guard rigs" };
    const overlay = document.createElement("div");
    overlay.id = "__prisonBloodOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-state></div><div data-source></div>";
    document.body.appendChild(overlay);
    S = window.__prisonBlood = { guards, overlay };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const subject = input.subject;
  const player = CBZ.player;
  const playerChar = CBZ.playerChar;
  const victim = S.guards[0];
  if (!victim || !victim.group || !player || !playerChar) return { ok: false, err: "missing live actors" };

  // ---- one seeded world for both sides ------------------------------------
  // Every layer of gore.js samples Math.random (fan angle, droplet size, gib
  // proportions, pool stretch). Pin it for the whole staging block so the
  // before/after pair is a comparison of code, not of two different dice rolls.
  const priorRandom = Math.random;
  let rngState = 0x51ed270b;
  Math.random = function () {
    rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
    return rngState / 4294967296;
  };

  let audit = null;
  let camera = CBZ.camera;
  try {
    const targetX = 0, targetZ = 25.5, targetY = groundAt(targetX, targetZ);
    const playerX = 0, playerZ = 34, playerY = groundAt(playerX, playerZ);

    // Clean tableau: no leftover gore, no leftover wounds, every rig that is
    // not part of this plate parked out of frame.
    try { if (CBZ.clearGore) CBZ.clearGore(); } catch (_) {}
    try { if (CBZ.clearWounds) CBZ.clearWounds(); } catch (_) {}
    try { if (CBZ.prisonDropClear) CBZ.prisonDropClear(); } catch (_) {}
    try { if (CBZ.fpsSetAim) CBZ.fpsSetAim(false); } catch (_) {}
    try { if (CBZ.fpsSetActive) CBZ.fpsSetActive(false); } catch (_) {}
    if (CBZ.invOpen && CBZ.toggleInventory) CBZ.toggleInventory();
    if (CBZ.dayPhase) CBZ.dayPhase(0.25);   // noon: the blood has to survive full light

    // The firefight plate needs a squad; every other plate needs exactly one
    // body. Positions are authored, not wandered into, so the two sides put
    // the same men on the same paving stones.
    const SQUAD = [
      { x: 0.0, z: 25.5 },
      { x: -2.6, z: 27.4 },
      { x: 2.9, z: 27.9 },
      { x: -1.4, z: 30.2 },
      { x: 2.1, z: 23.4 },
    ];
    const wide = subject.state === "firefight-floor";
    const cast = wide ? S.guards.slice(0, Math.min(3, S.guards.length)) : [victim];
    for (const g of S.guards) {
      const i = cast.indexOf(g);
      if (i < 0) { if (g.group) g.group.visible = false; continue; }
      const spot = SQUAD[i];
      const gy = groundAt(spot.x, spot.z);
      g.dead = false; g.ko = 0; g.asleep = false; g.bribed = 0;
      g.hp = 140; g.alert = 0; g.hunt = 0; g.investigate = null;
      g.pause = 999;
      g.aiState = "idle"; g.foe = null;
      g.group.position.set(spot.x, gy, spot.z);
      g.group.rotation.set(0, Math.PI, 0);          // facing the shooter
      g.group.visible = true;
      try { if (CBZ.goreRestoreBody) CBZ.goreRestoreBody(g); } catch (_) {}
    }
    for (const n of CBZ.npcs || []) if (n && n.group) n.group.visible = false;

    player.dead = false; player.hp = 100; player.driving = false; player._swim = false;
    player.pos.set(playerX, playerY, playerZ);
    player.vy = 0; player.grounded = true;
    playerChar.group.position.copy(player.pos);
    playerChar.group.rotation.set(0, 0, 0);
    playerChar.group.visible = false;

    const step = (frames) => {
      for (let i = 0; i < frames; i++) {
        CBZ.hitstop = 0; CBZ.slowmo = 0;
        CBZ.stepSim(1 / 60);
        player.pos.set(playerX, playerY, playerZ);
        player.vy = 0; player.grounded = true; player.dead = false; player.hp = 100;
        for (const n of CBZ.npcs || []) if (n && n.group) n.group.visible = false;
      }
    };
    // Settle the rigs before anybody is shot, pinning the standing cast so a
    // patrol brain cannot walk the subject out of the authored spot.
    for (let i = 0; i < 24; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
      for (let k = 0; k < cast.length; k++) {
        const g = cast[k], spot = SQUAD[k];
        g.group.position.set(spot.x, groundAt(spot.x, spot.z), spot.z);
        g.group.rotation.y = Math.PI;
        g.pause = 999; g.hunt = 0; g.alert = 0;
      }
      player.pos.set(playerX, playerY, playerZ);
    }

    const shotDir = (g) => new T.Vector3(
      g.group.position.x - playerX, 0, g.group.position.z - playerZ
    ).normalize();

    // A live body hit through the real seams: the entry hole (wounds.js), the
    // wet spray (gore.js) and the physical reaction (ragdoll), in that order.
    const shoot = (g, opts) => {
      opts = opts || {};
      g.group.updateMatrixWorld(true);
      // The rigs are authored facing local -Z, so the cast is turned PI to look
      // at the shooter and the entry point must be taken on local -Z too. Taking
      // it on +Z put the hole and the whole spray out of the man's BACK, which
      // photographs as an untouched guard from any camera on the shooter's side.
      const p = g.group.localToWorld(new T.Vector3(-0.06, opts.head ? 1.62 : 1.28, -0.24));
      const dir = shotDir(g);
      try { if (CBZ.bodyWound) CBZ.bodyWound(g, p, { cal: 1.6, dir, head: !!opts.head }); } catch (_) {}
      try { if (CBZ.gore && CBZ.gore.spray) CBZ.gore.spray(p, opts.head ? 0.9 : 0.6, dir); } catch (_) {}
      try { if (CBZ.body && CBZ.body.hit) CBZ.body.hit(g, { fromX: playerX, fromZ: playerZ, dir, force: 6 }); } catch (_) {}
      return p;
    };
    // The death itself: entities/ai.js kill(), the same choke point a lethal
    // prison round reaches, which is what calls CBZ.gore.
    const kill = (g) => {
      try {
        if (CBZ.aiKill) CBZ.aiKill(g, { group: playerChar.group }, { noDrop: true, quiet: true, cause: "visual proof" });
      } catch (_) {}
    };

    if (subject.state === "impact-spray") {
      shoot(victim);
      step(5);
    } else if (subject.state === "blood-macro") {
      shoot(victim);
      step(4);
    } else if (subject.state === "kill-burst") {
      shoot(victim);
      kill(victim);
      step(7);
    } else if (subject.state === "gibs-settled") {
      shoot(victim);
      kill(victim);
      step(165);
    } else if (subject.state === "corpse-pool") {
      shoot(victim);
      kill(victim);
      step(400);
    } else if (subject.state === "firefight-floor") {
      // Three real rigs die where they stand; the two men the prison did not
      // lend us bleed through the same public entry point ai.js uses, at the
      // last two authored marks. Five kills, one clock.
      for (const g of cast) { shoot(g); kill(g); step(9); }
      for (let i = cast.length; i < SQUAD.length; i++) {
        const spot = SQUAD[i];
        const dir = { x: spot.x - playerX, z: spot.z - playerZ };
        try {
          if (CBZ.gore) CBZ.gore(spot.x, groundAt(spot.x, spot.z) + 1.1, spot.z, { dir, amount: 1.2, player: false });
        } catch (_) {}
        step(9);
      }
      step(240);
    }

    setHud(false);
    playerChar.group.visible = false;

    // ---- camera ----------------------------------------------------------
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
    const stateLabels = {
      "kill-burst": "REAL KILL · 7 FRAMES IN",
      "gibs-settled": "SAME KILL · 2.75 s LATER",
      "firefight-floor": "FIVE KILLS · 4 s AFTER THE LAST",
      "impact-spray": "LIVE BODY HIT · 5 FRAMES IN",
      "blood-macro": "LIVE BODY HIT · MACRO",
      "corpse-pool": "SAME KILL · 6.7 s LATER",
    };
    q("state").textContent = stateLabels[subject.state] || "REAL PRISON GORE";
    q("state").style.cssText = "position:absolute;top:104px;left:27px;color:#c0cfda;font-size:11px;font-weight:700;letter-spacing:.08em";
    q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
    q("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

    // ---- measurements ----------------------------------------------------
    // gore.js owns its own pools; it publishes them through CBZ.goreAudit()
    // rather than having the preset guess at scene children. A build without
    // the export simply reports nulls instead of lying.
    try { audit = CBZ.goreAudit ? CBZ.goreAudit() : null; } catch (_) { audit = null; }

    camera.updateMatrixWorld(true);
    CBZ.renderer.render(CBZ.scene, camera);
  } finally {
    Math.random = priorRandom;
  }

  const metrics = {};
  if (audit) {
    metrics.flyingChunks = audit.gibs;
    metrics.boxChunks = audit.boxGibs;
    metrics.biggestChunkCm = audit.maxGibCm;
    metrics.dropThicknessCm = audit.maxDropThickCm;
    metrics.bloodDrops = audit.drops;
    metrics.groundPools = audit.pools;
  }
  // wounds.js publishes its per-actor decal count on the rig; the meshes carry
  // no marker of their own, so a scene traversal would report zero even with
  // the hole and the soak sitting on the chest.
  if (victim && victim._woundN != null) metrics.woundDecals = victim._woundN;
  const cam = (input.referenceStage && input.referenceStage.camera) || subject.cam;
  return {
    ok: true,
    camera: { x: cam.x, y: cam.y, z: cam.z, ax: cam.ax, ay: cam.ay, az: cam.az, fov: cam.fov || 50 },
    metrics,
  };
}

export default {
  id: "prison-blood",
  title: "Prison Escape: Blood, Gunshot Impact, and What the Kill Leaves Behind",
  description: "Matched, seeded gore events in the real Prison Escape runtime: the burst leaving a body, the floor two seconds later, a five-man firefight, a live body hit, a macro of the droplets, and the pool under a corpse.",
  beforeLabel: "BEFORE · CUBES",
  afterLabel: "AFTER · BLOOD",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 64321 },
  stageTimeoutMs: 420000,
  pairNote: "Same escape mode · seed · actors · camera · noon light · seeded gore RNG",
  method: "The runner boots the registered Prison Escape mode on both sources, freezes the game clock, seeds Math.random for the whole of each subject's staging, and fires real wounds/gore/kill seams at authored yard marks. Each plate is the same event stepped the same number of frames on both sides.",
  metricsNote: "Live gore-pool measurements from CBZ.goreAudit() at the instant of capture — how many chunks are in the world, how many of them are boxes, and how big the biggest one is.",
  metrics: {
    flyingChunks: { label: "Body chunks in the world", better: "lower" },
    boxChunks: { label: "Chunks that are literal cubes", better: "lower" },
    biggestChunkCm: { label: "Biggest chunk", unit: "cm", better: "lower" },
    dropThicknessCm: { label: "Fattest droplet across", unit: "cm", better: "lower" },
    bloodDrops: { label: "Blood droplets alive" },
    groundPools: { label: "Ground pools / decals" },
    woundDecals: { label: "Wound decals on the victim", better: "higher" },
  },
  subjects,
  stage: stagePrisonBlood,
};

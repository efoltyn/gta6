/* GUNPOINT STUDIO — a reaction rig for tools/visual-compare.mjs.

   OWNER, 2026-08-13: "the before after tool is like a studio to allow you to
   say player in first person with a gun pointed at a police or at 5 police or
   at inmates and see in a storyboard like a cartoon how reactions work and to
   let you really test play without playing and much much faster."

   So this preset is not a gallery of finished looks (that is what
   prison-combat-looks.mjs is). It is a STAGE. It puts the real player, holding
   a real gun, in front of a cast it places by hand, and photographs what the
   crowd does about it — from the player's own eye and from the side, across a
   fixed set of simulated seconds. Nothing here fakes a pose: every reaction on
   camera came out of systems/intimidate.js deciding, and systems/reactions.js
   plus entities/character.js drawing.

   WHAT IT WAS BUILT TO CATCH (the bug that started it)
   ---------------------------------------------------
   Inmates held at gunpoint were meant to throw their hands overhead. On screen
   their arms hovered at their sides, twitching. The cause is a two-driver
   fight: entities/character.js damps every arm toward its walk/idle target
   each frame (~-0.34 rad, at the sides), while systems/reactions.js adds a
   damped OFFSET toward SURRENDER_ARM and backs that offset out again at the
   top of the next frame. Because the offset is removed before it is re-derived,
   the surrender pose restarts from the idle base every single frame and can
   never converge — it lands a fixed fraction of the way up and then jitters
   with the walk cycle underneath it.

   A still frame cannot show a twitch, so this preset measures it. `armJitterCm`
   samples the arm's world height across a burst of frames and reports the
   spread. A fought pose has a big spread; a settled pose has almost none. That
   number, next to a picture of the same man, is the whole proof.

   THE STAGE
   ---------
   North yard, flat and open (jail-scene.mjs's own notes: northYard spans
   x[-30,30] z[-8,52]). The player stands at MARK facing -Z; the cast is placed
   on a shallow arc in front of him at a named distance. Every camera is
   derived from those fixed numbers, so both builds photograph the identical
   geometry and the runner's referenceStage lock keeps the after side honest.

   CASTING
   -------
   `act.cast` says who stands there and what they are carrying, and the
   reaction is then left to the game:
     kind    "inmate" | "guard"      — which live list to draw the body from
     n       how many
     dist    metres in front of MARK
     arm     "none"  → hasGun=false, so decideReaction can only surrender
             "gun"   → hasGun=true, and the roll is pinned so he DRAWS
             "mixed" → alternating, for a crowd that splits
   The roll is pinned by swapping CBZ.econ.rng for the two frames in which
   decideReaction runs, then putting the real one back. The branch taken is the
   real branch; only the coin is loaded, and only long enough to make the shot
   repeatable.
*/

const MARK = { x: 0, z: 30 };          // where the player stands, every shot
const EYE = 1.65;                      // fpsmode.js standing eye height

/* Cameras are all derived from MARK so a change to the stage moves every shot
   together. `fp` is the player's own eye looking down the barrel — the view the
   owner asked to be able to stage. `profile` steps to the side to read a pose
   that a first-person shot flattens. */
const fp = (dist, lift) => ({
  x: MARK.x, y: EYE + (lift || 0), z: MARK.z,
  ax: MARK.x, ay: 1.5, az: MARK.z - dist, fov: 55,
});
const profile = (dist, side, height) => ({
  x: MARK.x + (side || 4.6), y: height || 1.9, z: MARK.z - dist,
  ax: MARK.x, ay: 1.5, az: MARK.z - dist, fov: 42,
});

const subjects = [
  /* ---- THE BUG, HELD STILL AND THEN MEASURED --------------------------
     One unarmed man, close, in profile, a full second and a half after the
     gun came up — long past any honest settle time. This is the frame the
     arms are supposed to be locked overhead in. armJitterCm is sampled here
     across 36 frames after the picture is composed. */
  { id: "surrender-profile", label: "One man surrendering, from the side", hud: false,
    focus: "THE POSE ITSELF. Both arms should be clearly ABOVE the head and completely still. If the arms hang at the sides, or sit half-raised and shivering, the two-driver fight is live. Read armJitterCm next to this picture: a settled pose is under ~0.5 cm, a fought one is several times that.",
    act: { cast: { kind: "inmate", n: 1, dist: 4.2, arm: "none" }, secs: 1.5, sample: 36 },
    cam: profile(4.2, 4.4, 1.9) },

  { id: "surrender-fp-near", label: "Down the barrel, close", hud: false,
    focus: "The same surrender from the player's eye at conversation range. The hands should read as up and empty without a word on screen — this is the frame that has to carry what the deleted popup used to say.",
    act: { cast: { kind: "inmate", n: 1, dist: 3.2, arm: "none" }, secs: 1.5, sample: 36 },
    cam: fp(3.2) },

  /* ---- THE STORYBOARD: one reaction, four beats ------------------------
     The owner asked for a cartoon. These four share a camera and differ only
     in simulated seconds, so the contact sheet reads left-to-right as the
     hands actually going up. */
  { id: "beat-1-raise", label: "Beat 1 — the gun comes up (0.1s)", hud: false,
    focus: "First tenth of a second. He has registered the gun and nothing else has happened yet.",
    act: { cast: { kind: "inmate", n: 1, dist: 5.0, arm: "none" }, secs: 0.1 },
    cam: profile(5.0, 4.8, 1.9) },
  { id: "beat-2-rising", label: "Beat 2 — arms rising (0.35s)", hud: false,
    focus: "Mid-raise. The arms should be visibly on their way overhead, not vibrating in place.",
    act: { cast: { kind: "inmate", n: 1, dist: 5.0, arm: "none" }, secs: 0.35 },
    cam: profile(5.0, 4.8, 1.9) },
  { id: "beat-3-up", label: "Beat 3 — hands up (0.8s)", hud: false,
    focus: "The pose should be reached and holding by here.",
    act: { cast: { kind: "inmate", n: 1, dist: 5.0, arm: "none" }, secs: 0.8 },
    cam: profile(5.0, 4.8, 1.9) },
  { id: "beat-4-held", label: "Beat 4 — still held (2.5s)", hud: false,
    focus: "Two and a half seconds in. Identical to beat 3 if the pose is stable; different from it if the pose is being fought.",
    act: { cast: { kind: "inmate", n: 1, dist: 5.0, arm: "none" }, secs: 2.5, sample: 36 },
    cam: profile(5.0, 4.8, 1.9) },

  /* ---- THE CROWD SHOTS ------------------------------------------------- */
  { id: "five-inmates-fp", label: "Five inmates at gunpoint", hud: false,
    focus: "The shot the owner named. Five men, one gun. Every one of them should read the same way at a glance — a row of raised hands. Any man still walking his idle cycle in this frame is a man the reaction never reached.",
    act: { cast: { kind: "inmate", n: 5, dist: 6.5, arm: "none" }, secs: 1.6, sample: 36 },
    cam: fp(6.5) },

  { id: "five-inmates-wide", label: "Five inmates, from the side", hud: false,
    focus: "The same five in profile, so the arm height can be read against their own heads instead of foreshortened down the barrel.",
    act: { cast: { kind: "inmate", n: 5, dist: 6.5, arm: "none" }, secs: 1.6 },
    cam: profile(6.5, 9.5, 2.4) },

  { id: "five-guards-fp", label: "Five guards at gunpoint", hud: false,
    focus: "The same staging pointed at the screws instead. Guards keep their own hunt behaviour — intimidate.js deliberately only reacts to inmates — so this frame is the CONTROL: it shows what the crowd does when nothing is posing them.",
    act: { cast: { kind: "guard", n: 5, dist: 7.5, arm: "none" }, secs: 1.6 },
    cam: fp(7.5) },

  /* ---- THE OTHER BRANCH ------------------------------------------------ */
  { id: "standoff-draw", label: "An armed man draws instead", hud: false,
    focus: "The draw branch, with the roll pinned so it happens every run. His gun arm should come level at the player. This is the reaction the owner says currently fires far too often — the picture is here so the rebalance can be judged on how RARE it becomes, not on how it looks.",
    act: { cast: { kind: "inmate", n: 1, dist: 6.0, arm: "gun" }, secs: 1.2 },
    cam: profile(6.0, 5.2, 1.9) },

  { id: "mixed-five", label: "Five men, some draw", hud: false,
    focus: "A crowd that splits: alternating men are armed and pinned to draw. This is the frame that shows whether a yard full of gunpoint reads as ONE event or as five unrelated animations.",
    act: { cast: { kind: "inmate", n: 5, dist: 6.5, arm: "mixed" }, secs: 1.2 },
    cam: fp(6.5) },

  /* ---- THE HUD BEAT ---------------------------------------------------- */
  { id: "hud-at-gunpoint", label: "The screen as the player sees it", hud: true,
    focus: "Same moment as the close surrender, with the HUD left on. hudTextChars is the show-don't-tell number: the popup and the pill that used to sit here are what this preset exists to watch disappear, while the pose above carries the same information.",
    act: { cast: { kind: "inmate", n: 1, dist: 3.2, arm: "none" }, secs: 1.5 },
    cam: fp(3.2) },
];

async function stageGunpointStudio(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  // The runner serializes THIS FUNCTION and evaluates it inside the page, so
  // nothing at module scope is reachable from in here — the mark has to be
  // restated rather than imported. Subjects' `cam` values are plain data and
  // travel fine, so the two only need to agree on these numbers.
  const MARK = { x: 0, z: 30 };
  const EYE = 1.65;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  const groundAt = (x, z) => {
    try { const y = CBZ.floorAt ? CBZ.floorAt(x, z) : 0; return Number.isFinite(y) ? y : 0; }
    catch (_) { return 0; }
  };
  const setHud = (visible) => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };
  // Total rendered HUD text, the same measurement disaster-sequence.mjs uses.
  // Counts only what is actually painted, so a display:none popup does not
  // flatter the number.
  const hudTextChars = () => {
    let n = 0;
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    const walk = (el) => {
      if (!el || el === canvas) return;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return;
      for (const node of el.childNodes) {
        if (node.nodeType === 3) n += (node.textContent || "").trim().length;
        else if (node.nodeType === 1) walk(node);
      }
    };
    for (const child of Array.from(document.body.children)) walk(child);
    return n;
  };

  /* ---- boot once, then freeze the clock ------------------------------- */
  let S = window.__gunpointStudio;
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
      const b = document.getElementById("playBtn");
      if (b) b.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    // Let the prison's reveal rail finish before anything is staged; a camera
    // parked during the reveal is silently overwritten (jail-scene.mjs's note).
    for (let i = 0; i < 360; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    // The player needs a real gun in hand or armed() is false and
    // isAimingWeapon() never returns true, so nobody would ever react.
    if (CBZ.unlockWeapon) CBZ.unlockWeapon("sidearm");
    if (CBZ.setCurrentWeapon) CBZ.setCurrentWeapon("sidearm");

    S = window.__gunpointStudio = { realRng: null };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const subject = input.subject;
  const act = subject.act || {};
  const cast = act.cast || { kind: "inmate", n: 1, dist: 4, arm: "none" };
  const player = CBZ.player;
  if (!player) return { ok: false, err: "no player" };

  /* ---- reset anyone a previous subject posed --------------------------- */
  const allNpcs = CBZ.npcs || [];
  const allGuards = CBZ.guards || [];
  for (const a of allNpcs.concat(allGuards)) {
    if (!a) continue;
    a.intimidMode = null; a.intimidT = 0; a.intimidDrawT = 0; a.intimidFireT = 0;
    a.poseHandsUp = false; a.poseAimBack = false; a._reactHinted = false;
    if (a.char) { a.char.handsUp = false; a.char.surrender = false; }
  }

  /* ---- stand the player on his mark, gun up, facing -Z ----------------- */
  const py = groundAt(MARK.x, MARK.z);
  player.pos.x = MARK.x; player.pos.z = MARK.z; player.pos.y = py;
  player.vel && player.vel.set && player.vel.set(0, 0, 0);
  player.crouch = false; player.prone = false;
  player.hp = 100;
  if (CBZ.cam) { CBZ.cam.yaw = 0; CBZ.cam.pitch = 0; }   // yaw 0 → forward is -Z
  if (CBZ.fps) { CBZ.fps.active = true; CBZ.fps.fp = 0; CBZ.fps.reloading = 0; }

  /* ---- place the cast on a shallow arc in front of him ----------------- */
  const pool = (cast.kind === "guard" ? allGuards : allNpcs)
    .filter((a) => a && a.group && a.char && !a.dead && !a.escaped && !(a.ko > 0));
  if (!pool.length) return { ok: false, err: "no live " + cast.kind + " rigs" };

  // CAST ORDER. The man under the crosshair has to be the one the shot is
  // about, and intimidate.js only ever reacts to whoever the ray hits — so the
  // hero is placed dead centre and is pool[0], never whichever body happened
  // to spawn nearest the mark.
  const placed = [];
  const spread = 1.55;                       // metres between shoulders
  const order = [];                          // centre first, then out both ways
  for (let i = 0; i < cast.n; i++) {
    const half = Math.ceil(i / 2);
    order.push(i === 0 ? 0 : (i % 2 ? -half : half));
  }
  for (let i = 0; i < cast.n && i < pool.length; i++) {
    const a = pool[i];
    const off = order[i] * spread;
    const z = MARK.z - cast.dist + Math.abs(off) * 0.18;   // slight arc, ends further
    const x = MARK.x + off;
    a.group.position.set(x, groundAt(x, z), z);
    // rotation.y = 0 faces the player here: intimidate.js's own think() aims
    // for atan2(px - x, pz - z), which is 0 for a man directly down -Z of the
    // mark. Setting it wrong photographs a row of backs.
    a.group.rotation.y = 0;
    if (a.target && a.target.set) a.target.set(x, 0, z);
    a.hp = a.hp != null ? Math.max(a.hp, 60) : 60;
    a.aiState = null; a.fleeT = 0; a.foe = null; a.hunt = 0; a.huntPlayer = 0;
    a.approach = null;
    a._intimidInit = true;                   // we own hasGun for this shot
    a.hasGun = cast.arm === "gun" || (cast.arm === "mixed" && i % 2 === 1);
    placed.push(a);
  }
  const hero = placed[0];

  // CLEAR THE STAGE. Everyone not in this shot goes far away. Two reasons, and
  // the second is the one that actually bit: a stray body wanders into frame,
  // and — worse — a guard standing between the mark and the cast eats the aim
  // raycast, so the man the shot is about is never acquired and never reacts.
  const away = [];
  let parked = 0;
  for (const a of allNpcs.concat(allGuards)) {
    if (!a || !a.group || placed.indexOf(a) >= 0) continue;
    const x = 150 + (parked % 24) * 2.2, z = 150 + Math.floor(parked / 24) * 2.2;
    a.group.position.set(x, groundAt(x, z), z);
    if (a.target && a.target.set) a.target.set(x, 0, z);
    a.hunt = 0; a.huntPlayer = 0; a.foe = null;
    away.push(a); parked++;
  }

  /* ---- pin the coin, run the decision, put the coin back --------------- */
  // decideReaction reads CBZ.econ.rng. Forcing it to 0 makes `rng() < draw`
  // true whenever draw > 0, so an armed man always draws and an unarmed man
  // (draw === 0) still cannot. The real branch runs either way.
  const econ = CBZ.econ;
  const realRng = econ && econ.rng;
  if (econ && realRng) econ.rng = () => 0;
  for (let i = 0; i < 3; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
  if (econ && realRng) econ.rng = realRng;

  /* ---- hold the gun on them for the subject's simulated seconds -------- */
  const frames = Math.max(1, Math.round((act.secs != null ? act.secs : 1.2) * 60));
  for (let i = 0; i < frames; i++) {
    CBZ.hitstop = 0; CBZ.slowmo = 0;
    player.hp = 100;                         // a standoff must not end on a death screen
    CBZ.stepSim(1 / 60);
  }

  /* ---- compose the camera --------------------------------------------- */
  setHud(!!subject.hud);
  const camera = CBZ.camera;
  const locked = input.referenceStage && input.referenceStage.camera;
  const cam = locked || subject.cam;
  camera.aspect = input.width / input.height;
  camera.fov = cam.fov || 50;
  camera.near = 0.15;
  camera.far = 20000;
  camera.position.set(cam.x, cam.y, cam.z);
  camera.lookAt(cam.ax, cam.ay, cam.az);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const rig = CBZ.skyDome && CBZ.skyDome.parent;
    if (rig && rig.position) rig.position.set(camera.position.x, 0, camera.position.z);
  }
  // The player's own body would fill a first-person frame from the inside.
  if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;

  /* ---- measure -------------------------------------------------------- */
  // Arm height is read as a world-space box so it needs no rig knowledge and
  // cannot be fooled by a rotation that looks right on one axis. "Above head"
  // is the only definition of hands-up that matters to a player.
  // Box3.setFromObject reads WORLD matrices, and in a frozen-rAF world those
  // are only refreshed by a render — so measuring before one photographs the
  // rig's matrices from some earlier frame (or from identity). The result is a
  // number that disagrees with the picture taken milliseconds later, which is
  // worse than no number at all. prison-combat-looks.mjs already pays this
  // toll before its own Box3 work; this is the same toll.
  const boxTop = (obj) => {
    if (!obj) return null;
    try {
      obj.updateWorldMatrix(true, true);
      const b = new T.Box3().setFromObject(obj);
      return Number.isFinite(b.max.y) ? b.max.y : null;
    } catch (_) { return null; }
  };
  const armTop = (a) => {
    if (!a || !a.char || !a.char.parts) return null;
    const l = boxTop(a.char.parts.la), r = boxTop(a.char.parts.ra);
    if (l == null && r == null) return null;
    return Math.max(l == null ? -1e9 : l, r == null ? -1e9 : r);
  };
  const headTop = (a) => {
    if (!a || !a.char) return null;
    return boxTop(a.char.parts && a.char.parts.head) ?? boxTop(a.char.neck);
  };

  const metrics = {};
  if (hero) {
    const at = armTop(hero), ht = headTop(hero);
    if (at != null && ht != null) metrics.handsAboveHeadCm = Number(((at - ht) * 100).toFixed(1));
    if (hero.char && hero.char.parts && hero.char.parts.la) {
      metrics.armPitchDeg = Number((hero.char.parts.la.rotation.x * 180 / Math.PI).toFixed(1));
    }
  }

  // THE FLICKER NUMBER. Step the sim on and re-read the arm each frame; a pose
  // that has settled barely moves, a pose being fought by two drivers sweeps a
  // visible range. Sampling is opt-in per subject because it costs frames and
  // only the held beats are supposed to be still.
  if (act.sample && hero) {
    let lo = Infinity, hi = -Infinity, ok = 0;
    for (let i = 0; i < act.sample; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      player.hp = 100;
      CBZ.stepSim(1 / 60);
      const y = armTop(hero);
      if (y != null) { ok++; if (y < lo) lo = y; if (y > hi) hi = y; }
    }
    if (ok > 1) metrics.armJitterCm = Number(((hi - lo) * 100).toFixed(2));
    // recompose: the sampling burst moved the world on past the picture
    camera.position.set(cam.x, cam.y, cam.z);
    camera.lookAt(cam.ax, cam.ay, cam.az);
    camera.updateProjectionMatrix();
  }

  let scared = 0, drew = 0;
  for (const a of placed) {
    if (a.intimidMode === "scared") scared++;
    else if (a.intimidMode === "draw" || a.intimidMode === "standoff") drew++;
  }
  metrics.surrendering = scared;
  metrics.drawing = drew;
  metrics.reacting = scared + drew;
  if (subject.hud) metrics.hudTextChars = hudTextChars();

  CBZ.renderer.render(CBZ.scene, camera);
  return {
    ok: true,
    camera: { x: cam.x, y: cam.y, z: cam.z, ax: cam.ax, ay: cam.ay, az: cam.az, fov: cam.fov || 50 },
    metrics,
  };
}

export default {
  id: "gunpoint-studio",
  title: "Gunpoint Studio: How the Prison Reacts to a Drawn Gun",
  description: "A staged reaction rig, not a gallery. The real player holds a real sidearm on a cast placed by hand — one man, five men, inmates, guards, armed and unarmed — and every frame is what systems/intimidate.js decided and systems/reactions.js drew. Built to catch a surrender pose that never reaches the top of its arc.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 64321 },
  stageTimeoutMs: 420000,
  pairNote: "Same escape mode · seed · mark · cast · distance · camera · simulated seconds",
  method: "Both builds boot the registered Prison Escape mode, freeze the rAF clock, and hand the player a real sidearm through CBZ.unlockWeapon. The cast is placed on a fixed arc in front of a fixed mark and the gun is held on them for a named number of simulated seconds via CBZ.stepSim. Reactions are never authored: hasGun is set per shot and the decision roll is pinned to 0 for the two frames decideReaction runs, so the real surrender/draw branch is taken repeatably. The deployed camera is carried into the local capture.",
  metricsNote: "handsAboveHeadCm is the honest test of a surrender — the top of the arms measured against the top of the head, in world space. armJitterCm is the pose fight made visible in a number: the arm's vertical sweep across 36 held frames, which a settled pose keeps near zero. surrendering/drawing report which branch the cast actually took, and hudTextChars is the narration the poses are meant to replace.",
  metrics: {
    handsAboveHeadCm: { label: "Hands above head", unit: "cm", better: "higher" },
    armJitterCm: { label: "Arm sweep over 36 held frames", unit: "cm", better: "lower" },
    armPitchDeg: { label: "Upper-arm pitch", unit: "deg" },
    surrendering: { label: "Cast surrendering", better: "higher" },
    drawing: { label: "Cast drawing", better: "lower" },
    reacting: { label: "Cast reacting at all", better: "higher" },
    hudTextChars: { label: "HUD text on screen", unit: "chars", better: "lower" },
  },
  subjects,
  stage: stageGunpointStudio,
};

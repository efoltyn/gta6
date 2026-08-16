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

  /* ---- FISTS: the punch, and the thing that gates the punch ------------
     OWNER: "POPUP WHEN I PUNCH — PUNCHING LEGIT IS A MOTION."
     He is right, and character.js:2509 has driven a real jab/cross/hook off
     punchArm/punchKind/punchT the whole time. These two shots are the proof
     for the deletion, and for the pose that had to be BUILT before the
     second caption could go: punch stamina gated every swing and had no body
     at all, so "Catch your breath." was standing in for an animation. */
  { id: "fists-guard-fresh", label: "Fists up, fresh", hud: false,
    focus: "The fight stance with a full tank: forearms up at the chin, bladed torso, sprung knees, a live weave. This is the BASELINE — winded is 0 here and the pose arithmetic must reduce to exactly what it always was.",
    act: { cast: { kind: "inmate", n: 1, dist: 2.6, arm: "none" }, secs: 0.4, fists: true },
    cam: profile(2.6, 3.4, 1.7) },

  { id: "fists-gassed", label: "Fists up, gassed", hud: false,
    focus: "THE POSE THAT REPLACED A POPUP. Same man, same camera, stamina spent. The guard should be visibly DOWN off the chin, the shoulders open, the knees straight and the chest heaving. If this frame looks like the one before it, the deletion of \"Catch your breath.\" left the player with no way to know why his fists stopped working.",
    act: { cast: { kind: "inmate", n: 1, dist: 2.6, arm: "none" }, secs: 0.4, fists: true, punches: 20 },
    cam: profile(2.6, 3.4, 1.7) },

  /* ---- IMPACT: the glow, and what was under it -------------------------
     OWNER: "glow on punch impact is super dumb... show physics of punch
     landing instead better or even blood flying if it's a hard enough punch
     but no fake shit blood on every punch or on Random punches."
     Both directions, both photographed on the frame the blow lands. */
  { id: "impact-player-hits-npc", label: "You land one on him", hud: false,
    focus: "THE FRAME THE PUNCH LANDS, player to NPC. The deployed side has an additive white-orange flare hanging between the two bodies. This side should have no flare at all — instead the hit reads as hit-stop, the camera shake, a real velocity knockback and his head whipping along the punch line. If this frame looks empty, the flare was doing work the physics is not.",
    act: { cast: { kind: "inmate", n: 1, dist: 1.6, arm: "none" }, secs: 0.3, fists: true, punchLand: true },
    cam: profile(1.6, 3.1, 1.7) },

  { id: "impact-npc-hits-player", label: "He lands one on you", hud: false,
    focus: "THE SAME MOMENT REVERSED, NPC to player. His punch animation plays and your health drops through the mode's own damage entry. Read whether the blow lands as a physical event on YOUR body rather than as a screen effect.",
    act: { cast: { kind: "inmate", n: 1, dist: 1.5, arm: "none" }, secs: 0.3, fists: true, npcPunch: true },
    cam: profile(1.5, 3.4, 1.7) },

  { id: "impact-blood-earned", label: "Hard enough to bleed", hud: false,
    focus: "A HEAVY blow onto a man already worn past half health — the only fists case that draws blood now. It is a check, not a roll: the same punches in the same order bleed the same way every run. A jab on a fresh man must NOT bleed, which is what the first impact shot above proves.",
    act: { cast: { kind: "inmate", n: 1, dist: 1.6, arm: "none" }, secs: 0.3, fists: true, punchLand: true, wearDown: true, blows: 3 },
    cam: profile(1.6, 3.1, 1.7) },

  /* ---- THE MARK A PUNCH LEAVES ----------------------------------------
     OWNER: "punches don't leave a fucking bullet hole lol... the idea of a
     mark in certain cases after a real beating is decent but the current mark
     and oftenness of it is dumb af." Two shots: one jab (must leave NOTHING)
     and a real beating (may mark, and must read as swelling not a puncture). */
  { id: "mark-fresh-control", label: "Untouched — the control", hud: false,
    focus: "THE CONTROL. Nobody has hit this man. Whatever his face looks like here is the baseline both other shots are read against — without it, 'no mark' and 'mark too subtle to see' are the same picture.",
    act: { cast: { kind: "inmate", n: 1, dist: 1.6, arm: "none" }, secs: 0.3, fists: true, faceCam: true },
    cam: profile(1.6, 2.6, 1.78) },

  { id: "mark-one-jab", label: "One jab, close on the face", hud: false,
    focus: "A SINGLE JAB on a fresh man. The deployed side stamps a wound decal on every landed punch, so one glancing hit marks a man for the rest of the run. This side must show NOTHING — and the control shot above is what proves 'nothing' rather than 'too subtle to see'.",
    act: { cast: { kind: "inmate", n: 1, dist: 1.6, arm: "none" }, secs: 0.3, fists: true, punchLand: true, blows: 1, faceCam: true },
    cam: profile(1.6, 2.6, 1.78) },

  { id: "mark-real-beating", label: "After a real beating", hud: false,
    focus: "THE SAME FACE after a full beating. The deployed side carries the purple disc — on the CLOTHES as often as the skin, arriving instantly when real bruising takes hours, and drawn with the same pit geometry as a bullet hole. This side must be clean: a punch leaves no mark at all now. A black eye that arrives late and sits on skin is a separate feature, and it starts from nothing rather than from this.",
    act: { cast: { kind: "inmate", n: 1, dist: 1.6, arm: "none" }, secs: 0.3, fists: true, punchLand: true, blows: 6, faceCam: true },
    cam: profile(1.6, 2.6, 1.78) },

  { id: "fists-mid-punch", label: "Mid-swing", hud: true,
    focus: "The punch itself, caught mid-arc, with the HUD ON. The arm is visibly thrown — that motion is the whole reason \"Swing...\" was deleted. hudTextChars is the number that should have dropped.",
    act: { cast: { kind: "inmate", n: 1, dist: 2.2, arm: "none" }, secs: 0.4, fists: true, punch: 0.26 },
    cam: profile(2.2, 3.2, 1.7) },
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

  /* ---- FISTS MODE: stage the player's own fight stance ------------------
     `fists` puts the player in the guard, `gas` forces the winded value the
     pose reads (systems/combat.js normally publishes it from punch stamina),
     and `punch` throws a real swing and steps to a named point in its arc so
     the frame catches the arm mid-throw rather than at rest. Nothing here
     authors a pose: every field written is one entities/character.js already
     drives, and the punch goes through CBZ.punch so it is the real swing. */
  const pchar = CBZ.playerChar;
  if (act.fists && pchar) {
    // A GUN BEATS THE GUARD. character.js gates the fight stance behind
    // !aimingPose && !carryPose, and the studio hands the player a sidearm at
    // boot for the gunpoint shots — so fists mode has to actually disarm him
    // or the stance silently never runs and every frame shows arms at rest.
    if (CBZ.weaponInventory) CBZ.weaponInventory.length = 0;
    CBZ.currentWeaponId = null;
    if (CBZ.onWeaponInventoryChanged) { try { CBZ.onWeaponInventoryChanged(null, false); } catch (_) {} }
    if (CBZ.fps) CBZ.fps.active = false;    // fists are a third-person read
    pchar.aimingPose = false; pchar.carryPose = false;
    pchar.fightStance = true;
    pchar.group.visible = true;
  } else if (pchar) {
    pchar.fightStance = false;
    pchar.winded = 0;
    if (!CBZ.weaponInventory || !CBZ.weaponInventory.length) {
      if (CBZ.unlockWeapon) CBZ.unlockWeapon("sidearm");
      if (CBZ.setCurrentWeapon) CBZ.setCurrentWeapon("sidearm");
    }
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

  /* GAS HIM OUT FOR REAL. combat.js republishes `winded` from its own private
     stamina every tick, so writing the value here is overwritten within a
     frame. Throwing actual punches spends actual stamina, which means this
     shot proves the shipped path — the guard drops because the man is tired,
     not because the preset said so. */
  if (act.punches && CBZ.punch) {
    // Stamina regenerates at 0.42/s while a punch costs 0.22-0.34, so a lazy
    // cadence breaks even and never gasses anyone. Re-throw as soon as the
    // previous swing has RESOLVED (pendingPunch clears at ~0.15s) rather than
    // waiting out the full animation, which is also how a real player mashes.
    for (let p = 0; p < act.punches; p++) {
      try { CBZ.punch(); } catch (_) {}
      for (let i = 0; i < 14; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
    }
    // let the LAST swing finish, or the frame photographs an arm in flight and
    // calls it a guard
    for (let i = 0; i < 22; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
  }

  /* IMPACT SHOTS. `punchLand` throws a real punch through CBZ.punch and steps
     to the frame the blow actually connects (landPunch defers the hit to the
     animation's drive frame, ~0.15s), so the camera catches the impact rather
     than the wind-up. `wearDown` takes the target past half health first,
     which is the condition the blood rule checks. `npcPunch` runs it the other
     way: the inmate is pointed at the player and pushed into his own attack so
     the reverse direction is photographed by the same rig. */
  const maxHp = hero && (hero.kind === "guard" || hero.kind === "warden") ? 140 : 100;
  if (act.punchLand && CBZ.punch && hero) {
    if (act.wearDown) hero.hp = Math.round((hero.hp == null ? 100 : hero.hp) * 0.35);
    /* HEAVY IS THE THIRD OF A COMBO (combo % 3), so a single punch is never
       heavy and could never satisfy the blood rule — the first attempt at this
       shot photographed a jab and concluded the blood was broken. Throw the
       real chain: jab, cross, then the hook that is the blow the rule is about.
       `blows` therefore also documents the rule — 3 to bleed, 1 to prove a
       light hit does NOT. */
    const blows = act.blows || 1;
    for (let b = 0; b < blows; b++) {
      if (act.wearDown) hero.hp = Math.min(hero.hp, Math.round(maxHp * 0.35));
      try { CBZ.punch(); } catch (_) {}
      const settle = (b === blows - 1) ? 11 : 26;   // stop ON the last impact
      for (let i = 0; i < settle; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
    }
  }
  if (act.npcPunch && hero) {
    hero.foe = CBZ.player;
    hero.aiState = "fight";
    hero.huntPlayer = Math.max(hero.huntPlayer || 0, 6);
    hero.attackCD = 0;
    for (let i = 0; i < 90; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      if (CBZ.player.hp < 40) CBZ.player.hp = 100;   // keep the run alive, not the frame clean
      CBZ.stepSim(1 / 60);
      if (hero.char && hero.char.punchT > 0.12) break;   // caught mid-blow
    }
  }

  // THE SWING, caught in flight. CBZ.punch is the real entry point the mouse
  // uses, so this photographs the shipped animation rather than a pose set by
  // hand; the short step lands the camera inside the arc.
  if (act.punch != null && CBZ.punch) {
    // Reproduce the SHIPPED input path. combat.js's mousedown handler is
    // `const r = punch(); if (r && r.msg) CBZ.flashHint(r.msg, 1.4);` — the
    // popup never lived inside punch() itself, so calling punch() bare would
    // measure a HUD the old build also never printed. Mirroring the handler
    // makes hudTextChars honest on both sides: the deployed build still
    // returns "Swing..." and shows it, this one returns "" and shows nothing.
    try {
      const r = CBZ.punch();
      if (r && r.msg && CBZ.flashHint) CBZ.flashHint(r.msg, 1.4);
    } catch (_) {}
    const pf = Math.max(1, Math.round(act.punch * 60));
    for (let i = 0; i < pf; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      CBZ.stepSim(1 / 60);
    }
  }

  /* ---- compose the camera --------------------------------------------- */
  setHud(!!subject.hud);
  const camera = CBZ.camera;
  const locked = input.referenceStage && input.referenceStage.camera;
  const cam = locked || subject.cam;
  camera.aspect = input.width / input.height;
  // faceCam tightens the lens right onto the head — a mark on a cheek cannot be
  // judged from a shot that frames the whole man.
  camera.fov = act.faceCam ? 34 : (cam.fov || 50);
  camera.near = 0.15;
  camera.far = 20000;
  /* faceCam is derived from the HERO, not from the mark: he stands facing the
     player (+Z), so a `profile` camera sits dead side-on and photographs an ear
     while every mark is on the front of his face. This is a three-quarter view
     from over the player's shoulder — in front of him and offset — which is the
     angle a fight is actually read from. */
  if (act.faceCam && hero && hero.group) {
    const hp2 = hero.group.position;
    camera.position.set(hp2.x + 0.95, (hp2.y || 0) + 1.80, hp2.z + 1.25);
    camera.lookAt(hp2.x, (hp2.y || 0) + 1.68, hp2.z);
  } else camera.position.set(cam.x, cam.y, cam.z);
  if (act.faceCam && hero && hero.group) { /* look already set above */ }
  if (!act.faceCam) camera.lookAt(cam.ax, cam.ay, cam.az);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const rig = CBZ.skyDome && CBZ.skyDome.parent;
    if (rig && rig.position) rig.position.set(camera.position.x, 0, camera.position.z);
  }
  // The player's own body would fill a first-person frame from the inside —
  // except in fists mode, where his body IS the subject.
  // faceCam is a close read of the TARGET's face — the player's own body is
  // stood between the lens and it, and at 15deg he simply fills the frame.
  if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = !!act.fists && !act.faceCam;

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

  // FISTS: measure the guard height directly, so "the guard came down" is a
  // number and not an impression. Wrist-to-shoulder pitch is what a viewer
  // reads as a guard, so the arm pitch IS the metric.
  if (act.fists && pchar && pchar.parts) {
    if (pchar.parts.la) metrics.guardPitchDeg = Number((pchar.parts.la.rotation.x * 180 / Math.PI).toFixed(1));
    metrics.winded = Number((pchar.winded || 0).toFixed(2));
    const at = armTop(pchar.parts ? { char: pchar } : null), ht = headTop({ char: pchar });
    if (at != null && ht != null) metrics.guardVsHeadCm = Number(((at - ht) * 100).toFixed(1));
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

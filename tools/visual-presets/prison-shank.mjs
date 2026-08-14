/* Prison Escape SHANK proof for tools/visual-compare.mjs.

   The owner looked at the shivs in Prison Escape and said: look how many
   players have them, and look how it's not actually a thing that you
   physically have and can stab people with.

   Both halves of that are true and both are photographable, so this preset
   photographs them instead of arguing. The real Escape mode boots on both
   sides, rAF freezes, and five marks are staged with the LIVE rigs — the same
   player rig you walk around in, the same inmates the loot tables armed, the
   same stash the I key opens:

     1. what this game thinks a shiv looks like, in a hand, at 30 cm;
     2. a carrier committing to violence — does the blade come out;
     3. the player's own thrust, on the impact frame, against a live man;
     4. what it leaves in him;
     5. the bag, because an item that is a weapon should not be a doodle.

   Nothing is a mannequin. The stab goes through systems/combat.js's real
   pendingPunch, so it lands on the animation's drive frame and draws real
   wounds; the NPC draw goes through systems/prisonshanks.js's real commit
   test with a real huntPlayer running. Only POSITIONS are pinned, because a
   man coming to stab you closes the distance and a storyboard needs a mark.

   Runs as a flag A/B against ONE local server — same build, same seed, same
   marks, differing only by the flag under test:

     PORT=8613 python3 tools/devserver.py &
     node tools/visual-compare.mjs --preset prison-shank \
       --before "http://127.0.0.1:8613/?cfg_PRISON_SHANK=0" \
       --after  "http://127.0.0.1:8613/" \
       --before-label "BEFORE · A SHIV IS A NUMBER" --after-label "AFTER · A SHANK IS AN OBJECT" \
       --out artifacts/visual-comparisons/prison-shank --no-open
*/

const subjects = [
  {
    id: "the-object",
    label: "The object · what a shiv IS",
    focus: "Ask the game for the shiv's model and put it in the player's fist at arm's length. BEFORE this is a 9 MM PISTOL — actorweapons' normalizeWeaponId had no row for a blade name and answered 'sidearm' for anything it did not know, so the prison's signature weapon was literally a gun. AFTER it must be a hand-ground strip of stock with a bedsheet grip: flat, dull, one bright honed edge, and a loose wrap tail. No guard, no moulded handle — that would be a knife somebody bought.",
    state: "object",
    cam: { x: 0.17, y: 1.62, z: 33.16, ax: 0.02, ay: 1.28, az: 34.00, fov: 34 },
  },
  {
    id: "the-draw",
    label: "The draw · a carrier commits",
    focus: "One inmate whose rolled loadout holds a Shiv, with a real hunt running against the player at conversational distance. BEFORE his hands are empty — roughly half this wing carries a blade and not one of them has ever held it. AFTER the shank is out of the waistband and in his right fist, carried LOW and canted across the body, not presented two-handed like a pistol.",
    state: "draw",
    cam: { x: 3.05, y: 1.74, z: 34.75, ax: 0, ay: 1.02, az: 32.42, fov: 34 },
  },
  {
    id: "the-stab",
    label: "The stab · the impact frame",
    focus: "The player's own attack, caught on the frame the damage lands. BEFORE this is a bare-knuckle jab: the shiv is in the bag adding +9 to a fist, so the hand on screen is empty. AFTER the right arm is chambered-and-driven — a straight low piston with the blade leading and the free hand hooking the man in — and there is steel in the hand doing it.",
    state: "stab",
    cam: { x: 3.95, y: 1.72, z: 33.56, ax: 0, ay: 1.10, az: 33.50, fov: 34 },
  },
  {
    id: "the-wound",
    label: "The wound · what it leaves",
    focus: "The same man after four hits. BEFORE the prison could only ever ask wounds.js for melee:'blunt' — broad flat BRUISES, the mark of a fist, no matter what you were holding. AFTER the hits are narrow blade slits and he is bleeding: systems/wounds.js has drawn the blade kind since it was written, and nothing in this mode could reach it until the shank existed.",
    state: "wound",
    cam: { x: 3.05, y: 1.54, z: 33.82, ax: 0, ay: 1.16, az: 33.02, fov: 32 },
  },
  {
    id: "the-bag",
    label: "The bag · the icon",
    focus: "The real stash, opened with the I key, with a Shiv in it. BEFORE the cell holds a 24x24 hand-drawn glyph while the guns beside it are photographs of their actual models — two art forms in one grid. AFTER the shiv is shot under the same lamps as the guns, because it now HAS a model to shoot. The point is not that it got a gun's icon; it is that it earned one the same way a gun does.",
    state: "bag",
    hud: true,
    cam: { x: 2.95, y: 1.48, z: 33.42, ax: 0, ay: 1.06, az: 32.62, fov: 34 },
  },
];

async function stagePrisonShank(input) {
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

  let S = window.__prisonShank;
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

    // HUD is hidden per-subject rather than once at boot, because one of the
    // five marks IS the HUD. Remember the chrome so it can come back.
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    const chrome = Array.from(document.body.children).filter(
      (child) => !(child === canvas || (canvas && child.contains && child.contains(canvas)))
    );
    const overlay = document.createElement("div");
    overlay.id = "__prisonShankOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-state></div><div data-source></div>";
    document.body.appendChild(overlay);

    // A held-model stand for subject 1: the game's own answer to "what does a
    // shiv look like", parented to the world so the camera can get close
    // without a first-person viewmodel or a HUD in the way.
    const stand = new T.Group();
    stand.name = "visual-proof-shank-stand";
    (CBZ.prisonRoot || CBZ.scene).add(stand);

    /* HOW MANY MEN IN THIS WING ARE CARRYING — snapshotted ONCE, on the
       untouched world, before any plate has been staged. The live audit
       counts the living, and the five marks share one page per side: by the
       fourth plate the after side has stabbed people, so a live read drifts
       (measured 23 -> 20) and the one number that is explicitly NOT supposed
       to move between sides looked like it had. `carriedRoster` counts the
       whole cast the tables armed, dead or alive, so it cannot drift with the
       yard's body count either — this is the loot tables' own answer to the
       owner's question, and it is the same number on both sides. */
    let carriedAtBoot = 0;
    try {
      const a = CBZ.prisonShankAudit ? CBZ.prisonShankAudit() : null;
      if (a) carriedAtBoot = a.carriedRoster != null ? a.carriedRoster : a.carried;
    } catch (_) {}

    S = window.__prisonShank = { overlay, chrome, stand, canvas, carriedAtBoot };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const subject = input.subject;
  const player = CBZ.player;
  const playerChar = CBZ.playerChar;
  if (!player || !playerChar) return { ok: false, err: "missing live player rig" };

  // Re-scanned every subject, not cached at boot: the prison creates chrome
  // LATE (a narration line, a killfeed row, a hint pill), and a list taken
  // once at boot cannot hide an element that did not exist yet. The first
  // smoke run caught exactly that — "inmate has run package for the Blues"
  // printed across the middle of a storyboard plate.
  const setChrome = (visible) => {
    const canvas = S.canvas;
    // RECURSE into the canvas's ancestors. core/renderer.js parents the canvas
    // into #game, and the HUD/narration/killfeed are its SIBLINGS in there —
    // so a flat pass over document.body.children skips #game as "contains the
    // canvas" and leaves every one of them on screen. That is how "inmate has
    // hold rival turf for the Reds." ended up printed across a storyboard.
    const walk = (parent) => {
      for (const child of Array.from(parent.children)) {
        if (child === canvas || child === S.overlay) continue;
        if (canvas && child.contains && child.contains(canvas)) { walk(child); continue; }
        child.style.visibility = visible ? "" : "hidden";
      }
    };
    walk(document.body);
    S.overlay.style.visibility = "";
  };

  // ---- the yard, cleared, same on both sides --------------------------------
  const PX = 0, PZ = 34;
  const py = groundAt(PX, PZ);
  // The man in front of you. The two plates where the player ATTACKS put him
  // at arm's length — a shank's reach is 2.12 m in the weapon row but an arm
  // is 65 cm, so a mark set at conversational distance photographs a thrust
  // that lands mechanically while visibly touching nothing.
  const MX = 0;
  const MZ = (subject.state === "stab" || subject.state === "wound") ? 33.02 : 32.35;
  const my = groundAt(MX, MZ);

  try { if (CBZ.fpsSetAim) CBZ.fpsSetAim(false); } catch (_) {}
  try { if (CBZ.fpsSetActive) CBZ.fpsSetActive(false); } catch (_) {}
  if (CBZ.invOpen && CBZ.toggleInventory) CBZ.toggleInventory();
  if (CBZ.prisonDropClear) CBZ.prisonDropClear();
  try { if (CBZ.clearGore) CBZ.clearGore(); } catch (_) {}
  try { if (CBZ.clearWounds) CBZ.clearWounds(); } catch (_) {}
  CBZ.dayPhase(0.25);                        // noon: this is about objects, not light
  S.stand.visible = false;
  setChrome(!!subject.hud);

  // Pick ONE carrier — an inmate whose own rolled loadout holds a Shiv. This is
  // not staged: it is whoever systems/economy.js already armed. Deterministic
  // (same seed → same roster → same man) so both sides photograph the same body.
  const carriers = (CBZ.npcs || []).filter((n) => {
    if (!n || !n.group || !n.char) return false;
    const ld = n.loadout || (CBZ.econ && CBZ.econ.rollLoadout ? CBZ.econ.rollLoadout(n) : null);
    const items = (ld && ld.items) || [];
    return items.indexOf("Shiv") >= 0;
  });
  // Sorted by NAME, not left in spawn order. Loadouts are minted lazily, so
  // the array order the two sides see is not guaranteed to match — and the
  // first run photographed a different inmate on each side, which is a weak
  // A/B even when both men are genuinely carrying. The roster is seeded, so
  // the alphabetically-first carrier is the same man on both sides.
  carriers.sort((a, b) => String((a.data && a.data.name) || "").localeCompare(String((b.data && b.data.name) || "")));
  const mark = carriers[0] || (CBZ.npcs || []).find((n) => n && n.group && n.char);
  if (!mark) return { ok: false, err: "no live inmate rigs" };

  // everybody else leaves the frame
  for (const n of CBZ.npcs || []) if (n && n.group && n !== mark) n.group.visible = false;
  for (const g of CBZ.guards || []) if (g && g.group) { g.group.visible = false; g.hunt = 0; g.alert = 0; }

  mark.dead = false; mark.ko = 0; mark.hp = 100; mark.escaped = false; mark.cuffed = false;
  mark.hasGun = false; mark._bleed = 0;
  mark.group.visible = true;
  mark.huntPlayer = 0; mark.foe = null; mark.aiState = "idle";

  player.dead = false; player.hp = 100; player.driving = false; player._swim = false;
  player.stun = 0; player.captureState = "normal"; player.captureT = 0;
  player.pos.set(PX, py, PZ);
  player.vy = 0; player.grounded = true;
  playerChar.group.visible = true;
  playerChar.cuffed = false;
  playerChar.punchT = 0; playerChar.punchKind = "";
  if (CBZ.cam) { CBZ.cam.yaw = 0; CBZ.cam.pitch = 0; }

  const pin = () => {
    mark.group.position.set(MX, my, MZ);
    mark.group.rotation.y = Math.atan2(PX - MX, PZ - MZ);
    player.pos.set(PX, py, PZ);
    player.vy = 0; player.grounded = true; player.dead = false; player.hp = 100;
    player.stun = 0;
    playerChar.group.position.set(PX, py, PZ);
    playerChar.group.rotation.y = Math.atan2(MX - PX, MZ - PZ);
    for (const n of CBZ.npcs || []) if (n && n.group && n !== mark) n.group.visible = false;
    for (const g of CBZ.guards || []) if (g && g.group) g.group.visible = false;
  };
  const step = (frames, hunting) => {
    for (let i = 0; i < frames; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      if (hunting) mark.huntPlayer = 12;
      pin();
      CBZ.stepSim(1 / 60);
      pin();
    }
  };

  step(45, false);

  /* THE SHIV THE PLAYER OWNS. Given through the real economy seam, because
     that seam is half the change: addItem is the choke point that now tells
     the weapon rail a blade exists. On the BEFORE side the same call adds the
     same item and nothing happens, which is the point. */
  let gaveShiv = false;
  try {
    if (CBZ.econ && !CBZ.econ.hasItem("Shiv")) { CBZ.econ.addItem("Shiv", 1); }
    gaveShiv = !!(CBZ.econ && CBZ.econ.hasItem("Shiv"));
  } catch (_) {}
  let drewShank = false;
  try {
    if (CBZ.hasWeapon && CBZ.hasWeapon("shank") && CBZ.setCurrentWeapon) {
      drewShank = CBZ.setCurrentWeapon("shank");
    }
  } catch (_) {}
  /* A FIRST-EVER prison weapon acquisition arms the optional first-person
     handoff, and first person HIDES THE WHOLE PLAYER RIG — which is how a
     storyboard about a thing in a hand photographed an empty yard with one
     inmate in it and captioned itself "in the player's hand: EMPTY". Campaign
     Escape is authored over the shoulder, so disarm the handoff and reassert
     third person AFTER the acquisition, never before it. (Same guard, same
     reason, as tools/visual-presets/prison-combat-looks.mjs.) */
  try { if (CBZ.disarmFPSAfterIntro) CBZ.disarmFPSAfterIntro(); } catch (_) {}
  try { if (CBZ.fpsSetActive) CBZ.fpsSetActive(false); } catch (_) {}
  try { if (CBZ.fpsSetAim) CBZ.fpsSetAim(false); } catch (_) {}
  step(20, false);
  try { if (CBZ.fpsSetActive) CBZ.fpsSetActive(false); } catch (_) {}
  playerChar.group.visible = subject.state !== "draw";

  let stabDamage = null, thrust = null, standModelId = null;

  if (subject.state === "object") {
    /* WHAT DOES THIS GAME THINK A SHIV LOOKS LIKE. One question, asked of the
       one function that owns the answer, on both sides. No staging, no pose:
       whatever buildActorWeapon hands back for the name "Shiv" is hung in
       front of the camera at the player's eye. On the before side that is a
       9 mm pistol and the plate makes the bug undeniable. */
    while (S.stand.children.length) S.stand.remove(S.stand.children[0]);
    if (CBZ.buildActorWeapon) {
      const model = CBZ.buildActorWeapon("Shiv");
      standModelId = (model.userData && model.userData.weaponId) || "?";
      model.position.set(0, 0, 0);
      model.rotation.set(0, 0, 0);
      model.scale.setScalar(1.0);
      const spin = new T.Group();
      /* The long axis has to lie ACROSS the frame. buildActorWeapon authors
         the working end down -Z and the camera on this plate looks along +Z,
         so an unrotated model points straight at the lens and photographs as a
         stub — which is what the first smoke run produced. A yaw of +pi/2 maps
         -Z onto -X; the extra 0.30 and the pitch give the 3/4 hero angle the
         inventory icon rig uses, so this plate and the bag icon agree. */
      spin.rotation.set(0.08, Math.PI / 2 + 0.30, 0.10);
      spin.add(model);
      S.stand.add(spin);
    }
    // Kept low enough that the camera looks DOWN on it. Level with the lens the
    // blade is edge-on, which is a 1 cm line — a flat object has to be shown
    // its face or it photographs as a wire.
    S.stand.position.set(0.02, 1.28, 34.00);
    S.stand.visible = true;
    playerChar.group.visible = false;      // the object, not the man holding it
    step(4, false);
  } else if (subject.state === "draw") {
    // A REAL COMMIT. huntPlayer is the game's own "he is coming for you", and
    // prisonshanks.js's draw test reads it — nothing here reaches into the
    // weapon prop directly.
    // The plate is about HIM, so the player rig steps out of frame: from the
    // only angle that shows this man's weapon hand, the player's own shoulder
    // sits in the foreground and hides the thing being photographed.
    playerChar.group.visible = false;
    step(110, true);
    // Freeze him in the CARRY, not mid-swing. He is inside striking range, so
    // ai.js keeps throwing — and a thrust caught halfway is subject 3's job,
    // not this one's. hitCD is the AI's own attack clock; parking it lets
    // prisonshanks' carry pose own the arm for the shutter.
    mark.hitCD = 99;
    if (mark.char) { mark.char.punchT = 0; mark.char.punchKind = ""; }
    step(16, true);
    mark.hitCD = 99;
    playerChar.group.visible = false;
  } else if (subject.state === "stab" || subject.state === "wound") {
    mark.huntPlayer = 0;
    const hits = subject.state === "wound" ? 4 : 1;
    const hp0 = mark.hp;
    for (let h = 0; h < hits; h++) {
      const strike = (drewShank && CBZ.prisonStab) ? CBZ.prisonStab : CBZ.punch;
      try { if (strike) strike(mark); } catch (_) {}
      if (subject.state === "stab") {
        /* STOP ON THE ACTUAL IMPACT FRAME, per side. systems/combat.js defers
           the hit to `pendingPunch.t`, and that delay is not the same on both
           sides — a fist commits for 0.15 s, a thrust for 0.12 — so a fixed
           frame count photographs the hit on one side and a frame short of it
           on the other (measured: the before plate captioned itself "0
           damage" while the arm was mid-jab). Stepping until the damage
           actually lands makes "the impact frame" true rather than
           approximately true, on whichever side is being shot. */
        thrust = { kind: playerChar.punchKind, arm: playerChar.punchArm };
        const hpAtSwing = mark.hp;
        for (let f = 0; f < 16 && mark.hp >= hpAtSwing; f++) step(1, false);
        /* HOLD that pose while the impact FLASH decays. systems/combat.js
           fires a full-brightness additive sprite between the two bodies on a
           landed punch (flashSpark, 0.16 s) — photographed on the frame it is
           born, it blows the whole plate white and erases the two men the
           plate is about. The pose is re-pinned every frame, so this is still
           the impact frame; only the one-frame flare has aged out. Applied
           identically to both sides, and the AFTER side has no flare to lose
           because a blade going in is not a knuckle sparking off a jaw. */
        const holdT = playerChar.punchT, holdK = playerChar.punchKind, holdA = playerChar.punchArm;
        for (let f = 0; f < 10; f++) {
          step(1, false);
          playerChar.punchT = holdT; playerChar.punchKind = holdK; playerChar.punchArm = holdA;
        }
        break;
      }
      step(38, false);
      mark.hp = Math.max(12, mark.hp);      // he stays up so the body can be read
      mark.dead = false; mark.ko = 0;
    }
    stabDamage = Math.round(hp0 - mark.hp);
    if (subject.state === "wound") { mark.hp = 60; mark.dead = false; mark.ko = 0; step(10, false); }
  } else if (subject.state === "bag") {
    try { if (CBZ.refreshInventory) CBZ.refreshInventory(); } catch (_) {}
    try { if (!CBZ.invOpen && CBZ.toggleInventory) CBZ.toggleInventory(); } catch (_) {}
    await wait(220);                        // the bag paints its cells on a tick
    step(2, false);
  }

  // ---- camera --------------------------------------------------------------
  const camera = CBZ.camera;
  const locked = input.referenceStage && input.referenceStage.camera;
  const cam = locked || subject.cam;
  camera.aspect = input.width / input.height;
  camera.fov = cam.fov || 50;
  camera.near = 0.05;
  camera.far = 20000;
  camera.position.set(cam.x, cam.y, cam.z);
  camera.lookAt(cam.ax, cam.ay, cam.az);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();

  let audit = null, carry = null;
  try { audit = CBZ.prisonShankAudit ? CBZ.prisonShankAudit() : null; } catch (_) {}
  try { carry = CBZ.prisonShankCarryAudit ? CBZ.prisonShankCarryAudit() : null; } catch (_) {}

  // What is ACTUALLY parented into the player's right hand this frame — read
  // off the rig, not off a flag, because "the flag says armed" is exactly the
  // kind of claim this whole pass exists to stop trusting.
  let handModel = "empty";
  try {
    const socket = playerChar.sockets && (playerChar.sockets.thirdPersonWeapon || playerChar.sockets.weapon);
    if (socket) {
      socket.traverse((o) => {
        if (o.userData && o.userData.weaponId && o.visible) handModel = o.userData.weaponId;
      });
    }
  } catch (_) {}
  let npcHand = "empty";
  try {
    const p = mark._weaponProp;
    if (p && p.visible && p.userData && p.userData.weaponId) npcHand = p.userData.weaponId;
  } catch (_) {}

  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;top:72px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em";
  const bits = [];
  bits.push(`carried by ${S.carriedAtBoot} inmates`);
  if (subject.state === "object") {
    // This plate hides the player rig on purpose, so "the hand" is the wrong
    // caption for it — the question here is what the model factory answered.
    bits.push(`buildActorWeapon("Shiv") → ${(standModelId || "?").toUpperCase()}`);
  } else {
    bits.push(`in the player's hand: ${handModel.toUpperCase()}`);
  }
  if (subject.state === "draw") bits.push(`in his fist: ${npcHand.toUpperCase()}`);
  if (stabDamage != null) bits.push(`${stabDamage} damage`);
  if (thrust) bits.push(`anim: ${thrust.kind || "jab"} · ${thrust.arm} hand`);
  q("state").textContent = bits.join("  ·  ");
  q("state").style.cssText = "position:absolute;top:104px;left:27px;color:#c0cfda;font-size:11px;font-weight:700;letter-spacing:.08em";
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname + new URL(input.sourceUrl).search;
  q("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  // Hide the chrome AGAIN, immediately before the shutter. The pass at the top
  // of this function cannot hold: the prison writes narration, killfeed rows
  // and hint pills DURING the frames we step, so a plate staged clean was
  // still being captioned "Vince has prison gossip for you." by the time it
  // was photographed.
  setChrome(!!subject.hud);

  camera.updateMatrixWorld(true);
  CBZ.renderer.render(CBZ.scene, camera);

  const metrics = {};
  if (audit) {
    metrics.carried = S.carriedAtBoot;
    metrics.drawable = audit.drawable;
    metrics.modelIsPistol = audit.modelIsPistol;
    metrics.phantomBuff = audit.phantomBuff;
    metrics.stabHits = audit.stabHits;
    metrics.bladeWounds = audit.bladeWounds;
  }
  if (carry) {
    metrics.carriersHolding = carry.holding;
    metrics.carriersPosed = carry.posed;
  }
  metrics.shivOwned = gaveShiv ? 1 : 0;
  metrics.shankSelectable = drewShank ? 1 : 0;
  metrics.handIsShank = handModel === "shank" ? 1 : 0;
  metrics.handIsGun = handModel === "sidearm" ? 1 : 0;
  if (stabDamage != null) metrics.hitDamage = stabDamage;

  return {
    ok: true,
    camera: { x: cam.x, y: cam.y, z: cam.z, ax: cam.ax, ay: cam.ay, az: cam.az, fov: cam.fov || 50 },
    metrics,
  };
}

export default {
  id: "prison-shank",
  title: "Prison Escape: The Shiv That Was A Number",
  description: "Two dozen men in this wing carry a shiv and none of them has ever held one. Five marks — the object itself, a carrier drawing it, the player's thrust, the wound it leaves, and the bag it lives in — asking whether a shank is a thing you physically have and can stab someone with, or a +9 on a bare fist.",
  beforeLabel: "BEFORE · A SHIV IS A NUMBER",
  afterLabel: "AFTER · A SHANK IS AN OBJECT",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 64321 },
  stageTimeoutMs: 420000,
  pairNote: "Same escape mode · seed · roster · marks · camera · noon · one Shiv given through the real economy seam",
  method: "The runner boots the registered Prison Escape mode on both sources, freezes the game clock, and stages the LIVE player and one LIVE inmate whose own rolled loadout already held a Shiv. The draw runs prisonshanks.js's real commit test off a real huntPlayer; the stab runs systems/combat.js's real deferred hit, so the impact frame is the frame the damage lands. The held model on every plate is read back off the rig's hand socket, not off a flag. Both sides are the same build; the only difference is cfg_PRISON_SHANK.",
  metricsNote: "Live from CBZ.prisonShankAudit() and CBZ.prisonShankCarryAudit() at the instant of capture. `carried` is the loot tables' own number and is NOT supposed to move — it was always right. Everything under it is the gap between what the tables said and what the world could do about it.",
  metrics: {
    carried: { label: "Inmates carrying a shiv" },
    carriersHolding: { label: "…with the blade actually in a fist", better: "higher" },
    carriersPosed: { label: "…drawn as a real posed mesh", better: "higher" },
    handIsShank: { label: "Player's hand holds a shank", better: "higher" },
    modelIsPistol: { label: "Asking for a shiv's model returns a gun", better: "lower" },
    drawable: { label: "Shiv can be drawn as a weapon", better: "higher" },
    shankSelectable: { label: "Shiv reached the weapon rail", better: "higher" },
    phantomBuff: { label: "Shiv is a passive +9 on a bare fist", better: "lower" },
    stabHits: { label: "Stabs landed", better: "higher" },
    bladeWounds: { label: "Blade wounds drawn (not bruises)", better: "higher" },
    hitDamage: { label: "Damage on the mark" },
  },
  subjects,
  stage: stagePrisonShank,
};

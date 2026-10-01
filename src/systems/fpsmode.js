/* ============================================================
   systems/fpsmode.js - FIRST-PERSON MODE.

   The armory now unlocks a compact shooter loadout instead of one
   flat debug pistol: a sidearm, pump shotgun, and carbine with distinct
   magazines, reserve ammo, recoil, spread, fire cadence, tracers,
   impact puffs, shell ejection, reload behavior, and viewmodel motion.

   BULLETS MARK THE WORLD BY CALIBER (owner's rule: a gun that exists
   must AFFECT buildings and cars). Every impact is threaded with the
   firing weapon's round weight: 7.62/12g visibly chew concrete (bigger
   bursts, dust, the odd knocked-off chunk, deeper thuds), punch car
   panels (real engine damage + crumple + a panel shudder + paint chips
   in the car's own coat) and blow out glass at ANY range — while a 9mm
   stays light and only breaks panes up close. Persistent pooled pock
   decals (gunfx.js CBZ.bulletHole) keep the evidence on walls AND on
   the cars you sprayed — the aftermath of a firefight is half its drama.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  if (CBZ.weaponPhysics && CBZ.weaponPhysics.adopt) CBZ.weaponPhysics.adopt("fps-death");

  const SENS = (CBZ.TUNE && CBZ.TUNE.sens) || 0.0024;
  const MELEE = 1.9;
  const BODY_R = 0.60;

  // ---- DETERMINISM (owner rule): every roll in this file — shot spread,
  // recoil jitter, casing tumble, the death-drop toss — goes through this
  // seeded LCG instead of Math.random(). Combat outcome (where a bullet
  // actually lands) used to be the one place in fpsmode.js that broke the
  // project's seeded-RNG contract; fixed here for all of it, cosmetic rolls
  // included (a death-drop toss isn't decision-critical, but a stray
  // Math.random() left in a file this central is exactly the kind of thing
  // that quietly reintroduces non-determinism later).
  let _s = 77345;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  const WEAPONS = (CBZ.FPS_WEAPONS && CBZ.FPS_WEAPONS.length) ? CBZ.FPS_WEAPONS : [{
    key: "sidearm", label: "9MM SIDEARM", short: "9MM",
    mag: 15, reserve: 75, reload: 1.15, interval: 0.16, range: 78,
    damage: 38, headMult: 2.65, dropStart: 42, minDamage: 0.58,
    spread: 0.010, bodyRadius: 0.48, headRadius: 0.28,
    recoil: 0.23, maxRecoil: 0.62, climb: 0.026, sideKick: 0.018,
    shake: 0.28, heat: 45, knock: 1.35, flash: 0.38,
    sfx: "shoot_pistol", tracer: 0.018, auto: false,
  }];

  const fps = CBZ.fps = {
    active: false,
    fp: 0.0,
    weapon: 0,
    ammo: WEAPONS[0].mag,
    mag: WEAPONS[0].mag,
    reserve: WEAPONS[0].reserve,
    reloading: 0,
    rounds: WEAPONS.map((w) => w.mag),
    reserves: WEAPONS.map((w) => w.reserve),
    rocketAmmoType: "standard",
  };

  // One transition record is shared with holsterprops.js. Gameplay changes
  // weapon state immediately; the record lets the first-person view dip the
  // old gun briefly and lets the third-person body carry that same gun all the
  // way to its physical back/hip mount instead of teleporting it there.
  let weaponTransitionSeq = 0;
  let fpSwapT = 0, fpSwapDur = 0.34, fpSwapFrom = null, fpSwapTo = null, fpSwapP = 1;
  function markWeaponTransition(from, to, reason) {
    if (from === to) return;
    const now = (window.performance && performance.now) ? performance.now() : Date.now();
    const rec = CBZ.weaponTransition = {
      seq: ++weaponTransitionSeq,
      from: from || null,
      to: to || null,
      reason: reason || "switch",
      mode: CBZ.game && CBZ.game.mode,
      at: now,
    };
    fpSwapT = fpSwapDur;
    fpSwapFrom = rec.from;
    fpSwapTo = rec.to;
    fpSwapP = 0;
    try {
      document.dispatchEvent(new CustomEvent("cbz-weapon-transition", { detail: rec }));
    } catch (_) {}
  }
  CBZ.weaponTransitionState = function () { return CBZ.weaponTransition || null; };
  CBZ.fpsHolsterVisualState = function () {
    return {
      active: fpSwapT > 0 && !!fpSwapFrom && !fpSwapTo,
      from: fpSwapFrom,
      to: fpSwapTo,
      progress: fpSwapP,
    };
  };

  // ---- reusable math temporaries ----
  const eye = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const aimUp = new THREE.Vector3();
  const shotDir = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const tmpMuzzle = new THREE.Vector3();
  const hitPoint = new THREE.Vector3();
  const preKickAim = new THREE.Vector3();
  const sightPoint = new THREE.Vector3();
  const reticleOrigin = new THREE.Vector3();
  const reticleDir = new THREE.Vector3();
  const reticlePoint = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const ray = new THREE.Raycaster();
  const wallQ = new THREE.Quaternion();   // rocket impacts: raycast face normal → world

  function weaponIdOf(i) { return WEAPONS[i] && (WEAPONS[i].id || WEAPONS[i].key); }
  // effective magazine size for weapon slot i — a bought Extended/Drum mag
  // (city/gunmods.js) bumps the base capacity. One helper so syncAmmo, reload,
  // finishReloadStep and resetWeapons all agree on the true mag size.
  function magOf(i) {
    const w = WEAPONS[i]; if (!w) return 0;
    return (CBZ.gunModsMag) ? CBZ.gunModsMag(weaponIdOf(i), w.mag) : w.mag;
  }
  function weaponIndex(id) {
    for (let i = 0; i < WEAPONS.length; i++) if (weaponIdOf(i) === id || WEAPONS[i].key === id) return i;
    return -1;
  }
  function hasWeaponIndex(i) {
    const id = weaponIdOf(i);
    if (!id) return false;
    if (CBZ.hasWeapon && CBZ.hasWeapon(id)) return true;
    return !!(CBZ.econ && CBZ.econ.hasItem("Gun") && (!CBZ.weaponInventory || CBZ.weaponInventory.length === 0));
  }
  function availableIndices() {
    const out = [];
    for (let i = 0; i < WEAPONS.length; i++) if (hasWeaponIndex(i)) out.push(i);
    return out;
  }
  function normalizeWeapon() {
    if (CBZ.currentWeaponId) {
      const idx = weaponIndex(CBZ.currentWeaponId);
      if (idx >= 0 && hasWeaponIndex(idx)) fps.weapon = idx;
    }
    if (hasWeaponIndex(fps.weapon)) return;
    const av = availableIndices();
    if (av.length) {
      fps.weapon = av[0];
      CBZ.currentWeaponId = weaponIdOf(fps.weapon);
    }
  }
  function weapon() { normalizeWeapon(); return WEAPONS[fps.weapon] || WEAPONS[0]; }
  const DEFAULT_ROCKET_SPEC = Object.freeze({ id: "guided", label: "GUIDED", homing: true, lockRange: 280, lockConeDeg: 22, turnRate: 2.8, speed: 92 });
  function rocketAmmoSpec(w, id) {
    const modes = w && w.ammoTypes;
    if (!modes || !modes.length) return w && w.explosive ? DEFAULT_ROCKET_SPEC : null;
    id = id || fps.rocketAmmoType;
    for (let i = 0; i < modes.length; i++) if (modes[i].id === id) return modes[i];
    return modes[0];
  }
  function setRocketAmmoType(id) {
    const w = weapon(), spec = rocketAmmoSpec(w, id);
    if (!w.explosive || !spec) return false;
    fps.rocketAmmoType = spec.id;
    if (typeof document !== "undefined" && typeof CustomEvent !== "undefined") {
      document.dispatchEvent(new CustomEvent("cbz-rocket-ammo", { detail: { id: spec.id, label: spec.label || spec.id } }));
    }
    setAmmoHud();
    return true;
  }
  function cycleRocketAmmoType() {
    const w = weapon(), modes = w.ammoTypes;
    if (!w.explosive || !modes || modes.length < 2) return false;
    let idx = 0;
    for (let i = 0; i < modes.length; i++) if (modes[i].id === fps.rocketAmmoType) { idx = i; break; }
    return setRocketAmmoType(modes[(idx + 1) % modes.length].id);
  }
  CBZ.fpsRocketAmmoType = function () { return fps.rocketAmmoType; };
  CBZ.fpsSetRocketAmmoType = setRocketAmmoType;
  CBZ.fpsCycleRocketAmmoType = cycleRocketAmmoType;
  // HOLSTER / FISTS. City keeps its de-escalation flag; Prison Escape gets the
  // same gate because key 1 is a permanent empty-hands slot. Ownership and the
  // selected gun remain intact while armed() returns false, so drawing it again
  // is a reversible physical action rather than deleting/re-adding inventory.
  function holstered() {
    if (CBZ.game.mode === "city") return !!CBZ.game.cityHolstered;
    if (CBZ.game.mode === "escape") return !!CBZ.game.prisonHolstered;
    return false;
  }
  CBZ.playerHolster = function (on) {
    const mode = CBZ.game.mode;
    if (mode !== "city" && mode !== "escape") return false;
    const old = armed() ? CBZ.currentWeaponId : null;
    const key = mode === "city" ? "cityHolstered" : "prisonHolstered";
    CBZ.game[key] = (on === undefined) ? !CBZ.game[key] : !!on;
    const next = armed() ? CBZ.currentWeaponId : null;
    if (old !== next) markWeaponTransition(old, next, next ? "draw" : "holster");
    setAmmoHud();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  };
  CBZ.cityHolster = function (on) {
    if (CBZ.game.mode !== "city") return false;
    return CBZ.playerHolster(on);
  };
  /* CUFFED: THE HANDS ARE BEHIND YOUR BACK (CBZ.arrest.playerCuffed, the
     one question). Nothing is in them, so nothing is drawn: armed() reads
     false (no fire, no swap, no aim, no carried gun on the body in third
     person), and the whole first-person viewmodel goes (no fists, no arms,
     no gun, no reticle). Ownership and the selected gun are untouched, so
     taking the cuffs off hands everything straight back. */
  function cuffedHands() {
    const C = CBZ.cuffedPlayer;
    if (C && C.on) return C.on();
    const pc = CBZ.playerChar;
    return !!(pc && pc.cuffed);
  }
  function armed() {
    if (holstered()) return false;
    if (cuffedHands()) return false;   // holstered = read as unarmed (fists show; city also de-escalates)
    return availableIndices().length > 0 && !(CBZ.game.mode === "city" && CBZ.game.cityMeleeWeapon);
  }
  CBZ.fpsArmed = armed;   // systems/helditems.js: a drawn gun puts the held charge/frag away
  // ---- YOU ARE THE ANIMAL: NO HANDS ------------------------------------
  // Owner, on shark sim: "our first person is still a person mounted on shark,
  // which is a cool angle but human ARMS occasionally show lol." They did:
  // first person with nothing equipped draws the FIST viewmodel (see
  // `fists.visible = !armed()` in the per-frame pass), and nothing in this file
  // knew the player was a passenger on a bull shark rather than a man standing
  // on a street — so a pair of swaying human forearms drifted into the eye of
  // the shark, worst on the auto-bite punch-in and for a frame after every
  // evolution re-mounts the ride.
  //
  // AQUATIC mounts only, and deliberately so. Riding a shark/dolphin, the ride
  // owns the trigger outright (city/wildlife_tame.js cityMountedAnimalAttack
  // returns true and fireControl hands the whole input over), the mouth is the
  // weapon, and the camera sits on the animal's back looking down its nose:
  // there is nothing a hand could be doing. A LAND pet is the opposite case —
  // that trigger call returns false, you really can fire a gun from the saddle,
  // and hiding the gun you are shooting would be a new bug. So: on a fish, no
  // viewmodel; on a horse, unchanged.
  //
  // WHY THE FLAG IS SAFE TO READ HERE: the ride republishes `_aquaticMount`
  // every frame from its own tick at onAlways 49.8 — i.e. immediately BEFORE
  // this file's onAlways 52 — and shark_sim's evolution dismounts and re-mounts
  // inside a single synchronous call, so there is no frame in which this reads
  // stale-false and lets the hands through.
  function aquaticRide() {
    const p = CBZ.player;
    return !!(p && p._aquaticMount);
  }
  /* THE WINDOW IS A FIRING POSITION (city/view.js CAR_FP_LEAN). This file
     bows out of every car — shoot(), the viewmodel, the mouse — because the
     car owns the camera. When the seated first-person eye is out of the
     window with a firearm in hand, that one seat behaves like first person:
     the viewmodel shows in the game camera (it is a camera child, so the
     car's own eye carries it), the trigger works, and the aim is the lens.
     carGunEligible() is the wider gate for the mouse: seated in car FP with
     a gun, so that HOLDING aim is what puts you out of the window. */
  function carGun() {
    return !!(CBZ.carLeanActive && CBZ.carLeanActive() && armed() && CBZ.player && CBZ.player.driving);
  }
  function carGunEligible() {
    return !!(CBZ.carFpActive && CBZ.carFpActive() && armed() && CBZ.player && CBZ.player.driving && !CBZ.player._aircraft);
  }
  CBZ.fpsCarGun = carGun;
  function shoulderActive() {
    const p = CBZ.player;
    // The shoulder owner is strictly an alive, on-foot third-person state.
    // Previously it stayed true in cars/aircraft and after death, leaving the
    // crosshair/context-menu capture and aim pose active while another controller
    // owned the player. Downstream one-off guards hid some symptoms, not the state.
    return !fps.active && !!p && !p.dead && !p.driving && armed() && CBZ.game.state === "playing";
  }
  // ---- TP PRESENT SIGNAL (owner: "TP camera moves too much / arms always up") --
  // The twitchy armed camera tier and the raised aim pose used to key off merely
  // OWNING an un-holstered gun (shoulderActive), and the default city loadout
  // hands you one at spawn — so the player lived permanently in the aim stance.
  // "Presenting" is the actual intent signal: scoping (RMB/ADS), holding the
  // trigger, or a short post-shot linger while the recoil settles. Merely-armed
  // now reads as the relaxed carry (camera AND pose).
  if (CBZ.CONFIG.CITY_TP_ADS_CAMERA == null) CBZ.CONFIG.CITY_TP_ADS_CAMERA = true;
  if (CBZ.CONFIG.CITY_TP_LOWREADY == null) CBZ.CONFIG.CITY_TP_LOWREADY = true;
  const PRESENT_LINGER = 0.9;   // s after the last shot before the gun lowers
  function presenting() {
    if (!shoulderActive()) return false;
    return aimHeld || triggerHeld || sinceShot < PRESENT_LINGER;
  }
  // Camera-side hook (systems/camera.js): gates the tight armed tier — yaw
  // snap, tight position/look damps, pitch-follow, close collision floor —
  // on presenting instead of merely-armed. Framing (DIST/SIDE/FOV/HEIGHT) is
  // already flat for merely-armed by design and is not touched by this. With
  // CITY_TP_ADS_CAMERA=false it reverts to the old merely-armed gate exactly.
  CBZ.tpPresenting = function () {
    if (CBZ.CONFIG.CITY_TP_ADS_CAMERA === false) return shoulderActive();
    return presenting();
  };
  function maxHpOf(a) { return (a.kind === "guard" || a.kind === "warden") ? 140 : 100; }

  // ---- CALIBER: how hard each round MARKS the world -----------------------
  // One scalar per weapon threaded into every surface impact: burst size,
  // debris, decal diameter, thud depth, car damage, glass reach. WHY: buying
  // the AK has to SHOW — the street it shot up must read differently from a
  // street a 9mm shot up, or the price tag bought nothing visible.
  const CAL = {
    sniper: 1.9, ak47: 1.6, shotgun: 1.5, lmg: 1.35, deagle: 1.3,
    carbine: 1.2, revolver: 1.15, smg: 0.85, sidearm: 0.8, uzi: 0.7, taser: 0.25,
  };
  function caliber(w) { return CAL[w.key] != null ? CAL[w.key] : (w.damage >= 30 ? 1.2 : 0.8); }
  // rifle-class rounds keep their authority at range (full-distance glass
  // breaks, deep marks); pocket calibers shed energy fast.
  function heavyRound(w) { return caliber(w) >= 1.0; }
  const GLASS_PISTOL_REACH = 28;   // a 9mm/SMG slug only breaks a pane this close

  // per-weapon impact THUD (reused opts object — no per-shot allocation; far
  // must be re-cleared because audio.js sets it on the object for far hits)
  const thudSfxOpts = { pitch: 1, volume: 1, dist: null, far: false };
  function surfaceThud(name, cal, dist) {
    if (!CBZ.sfx) return;
    thudSfxOpts.pitch = Math.max(0.6, 1.18 - cal * 0.3) * (0.95 + rng() * 0.1);  // heavier round = deeper smack
    thudSfxOpts.volume = 0.35 + cal * 0.4;
    thudSfxOpts.dist = dist;
    thudSfxOpts.far = false;
    CBZ.sfx(name, thudSfxOpts);
  }

  function syncAmmo() {
    fps.ammo = fps.rounds[fps.weapon];
    fps.mag = magOf(fps.weapon);
    fps.reserve = fps.reserves[fps.weapon];
  }

  function resetWeapons() {
    if (CBZ.game.mode === "city") CBZ.game.cityHolstered = false;   // a fresh run / respawn is never holstered (PROG also zeroes it)
    if (CBZ.game.mode === "escape") CBZ.game.prisonHolstered = false;
    fps.weapon = CBZ.currentWeaponId ? Math.max(0, weaponIndex(CBZ.currentWeaponId)) : 0;
    normalizeWeapon();
    fps.rounds = WEAPONS.map((w, i) => magOf(i));
    fps.reserves = WEAPONS.map((w) => w.reserve);
    fps.reloading = 0;
    fps.rocketAmmoType = "standard";
    shotCD = 0;
    dryCD = 0;
    triggerHeld = false;
    recoil = 0; recoilSide = 0; bloom = 0; recoilHold = 0;
    recoilPitch = 0; recoilYaw = 0; shotsInBurst = 0; sinceShot = 99;
    fpsHipFov = 0;
    fpSwapT = 0; fpSwapP = 1; fpSwapFrom = fpSwapTo = null;
    hitMarkerT = 0;
    if (hitMarker && hitMarker.wrap) hitMarker.wrap.style.display = "none";
    syncAmmo();
    setAmmoHud();
  }

  function forward(out) {
    const y = CBZ.cam.yaw, p = fps.fp, cp = Math.cos(p);
    out.set(-Math.sin(y) * cp, Math.sin(p), -Math.cos(y) * cp);
    return out;
  }

  function buildBasis(dir) {
    right.crossVectors(dir, UP);
    if (right.lengthSq() < 0.0001) right.set(1, 0, 0);
    else right.normalize();
    aimUp.crossVectors(right, dir).normalize();
  }

  function spreadDir(base, cone, out) {
    buildBasis(base);
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * cone;
    out.copy(base)
      .addScaledVector(right, Math.cos(a) * r)
      .addScaledVector(aimUp, Math.sin(a) * r)
      .normalize();
    return out;
  }

  // ---- viewmodel ----
  const vm = new THREE.Group();
  vm.visible = false;
  CBZ.camera.add(vm);

  const gun = new THREE.Group();
  const weaponModels = [];
  const carriedGun = new THREE.Group();
  const carriedModels = [];
  const mat = {
    dark: new THREE.MeshLambertMaterial({ color: 0x161a20 }),
    black: new THREE.MeshLambertMaterial({ color: 0x080a0c }),
    bore: new THREE.MeshLambertMaterial({ color: 0x010203 }),
    steel: new THREE.MeshLambertMaterial({ color: 0x48515c }),
    worn: new THREE.MeshLambertMaterial({ color: 0x747f8c }),
    tan: new THREE.MeshLambertMaterial({ color: 0x8b6a42 }),
    polymer: new THREE.MeshLambertMaterial({ color: 0x232a24 }),
    brass: new THREE.MeshLambertMaterial({ color: 0xd6a33b, emissive: 0x2b1600, emissiveIntensity: 0.2 }),
    redShell: new THREE.MeshLambertMaterial({ color: 0x9d2523, emissive: 0x210000, emissiveIntensity: 0.12 }),
    skin: new THREE.MeshLambertMaterial({ color: 0xf0c39a }),
  };
  const brass = mat.brass;
  const redShell = mat.redShell;

  function box(parent, sx, sy, sz, mat, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    parent.add(m);
    return m;
  }

  function cyl(parent, r, len, mat, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    parent.add(m);
    return m;
  }

  const appearanceCtx = { THREE, box, cyl, mat };
  function fallbackAppearance() {
    const g = new THREE.Group();
    box(g, 0.14, 0.10, 0.48, mat.steel, 0, 0.03, -0.28);
    box(g, 0.12, 0.22, 0.12, mat.dark, 0, -0.15, -0.04, -0.25);
    g.userData.muzzle = new THREE.Vector3(0, 0.05, -0.58);
    return g;
  }

  function buildWeaponModel(w) {
    const builder = CBZ.weaponAppearance && CBZ.weaponAppearance[w.appearanceFactory || w.key];
    return builder ? builder(appearanceCtx) : fallbackAppearance();
  }

  /* THE OFF HAND, IN FIRST PERSON — GRASPED onto the part it really holds.
     Each gun names that part in userData.grips.hold (weapons/appearances/*):
       guard  a handguard / pump / fore-end: a prism along the bore. The palm
              cups UNDER it, the fingers close up the far side until they
              touch, the thumb runs forward along the near side, the hand
              yawed so the wrist sits back and left (where the forearm comes
              from). On a pump gun the hand is a child of the pump and racks it.
       vgrip  a vertical foregrip (RPG, grenade launcher): wrapped like a
              pistol grip, back of the hand to the left.
       (none, on a two-hand pistol) the modern thumbs-forward hold: the palm
              fills the left panel, the fingers close round the FIRING fingers
              (the grip plus their thickness), the thumb points forward along
              the frame under the firing thumb.
     The old version closed a fixed-size table pose round a guessed centre,
     so on the M4 the off hand gripped air in front of the handguard and on
     the pistols it floated below the fist. The arm is solved per frame
     (poseFpArms). A melee weapon gets its fist here too. */
  const FPH = CBZ.fpHands || null;
  const _ofA = new THREE.Vector3(), _ofB = new THREE.Vector3(), _ofC = new THREE.Vector3();
  const FORE_REAL = 0.265;                  // forearm, wrist to elbow, real metres (ARM_BODY[1])
  /* THE FIRING FOREARM GOES ROUND THE GUN, NOT THROUGH IT. Its natural line
     was the straight wrist, and on a rifle's raked pistol grip that points
     straight back down the gun's centre plane: on the M4 the forearm ran
     right under — and 2.4 cm into — the stock, on the shotgun 4 cm into it,
     the RPG's tube and the LMG's butt the same. A real firing forearm leaves
     the grip back, down and OUT to its own side (the elbow is out beside the
     body, the stock in the shoulder pocket). So once per gun, at build, the
     natural line is the nearest direction to the straight wrist whose whole
     forearm (a third of the way up, to the elbow, at its real girth) clears
     every drawn part of the gun — measured against the parts' boxes in
     model space — preferring out to the side over down. */
  function gunPartBoxes(model) {
    const out = [], M = new THREE.Matrix4();
    const skip = (o) => { for (let p = o; p && p !== model; p = p.parent) if (/^fp_hand/.test(p.name)) return true; return false; };
    model.traverse((o) => {
      if (!o.isMesh || !o.geometry || skip(o)) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      M.identity();
      for (let p = o; p && p !== model; p = p.parent) { p.updateMatrix(); M.premultiply(p.matrix); }
      out.push(o.geometry.boundingBox.clone().applyMatrix4(M));
    });
    return out;
  }
  function clearFiringFore(model, fire) {
    const boxes = gunPartBoxes(model);
    // the wrist and the hand's frame in model space, and the hand's model units per metre
    const W = new THREE.Vector3(), hq = new THREE.Quaternion();
    let kM = 1;
    for (let p = fire; p && p !== model; p = p.parent) { p.updateMatrix(); W.applyMatrix4(p.matrix); hq.premultiply(p.quaternion); kM *= p.scale.x; }
    const L = FORE_REAL * kM, margin = 0.004 * kM;
    const base = new THREE.Vector3(0, 0, 1).applyQuaternion(hq);
    const side = new THREE.Vector3(1, 0, 0), down = new THREE.Vector3(0, -1, 0);
    const d = new THREE.Vector3(), p = new THREE.Vector3();
    const clearance = (dir) => {
      let worst = Infinity;
      for (let u = 0.3; u <= 1.0001; u += 0.1) {
        const s = FPH.math.foreHalf(u), r = Math.max(s.rx, s.ry) * kM;
        p.copy(W).addScaledVector(dir, L * u);
        for (let i = 0; i < boxes.length; i++) worst = Math.min(worst, boxes[i].distanceToPoint(p) - r);
      }
      return worst;
    };
    if (clearance(base) >= margin) return;          // a pistol: the straight wrist is already clear
    let best = null, bestCost = Infinity, most = null, mostC = -Infinity;
    for (let tx = 0; tx <= 1.2001; tx += 0.05) {
      for (let ty = -0.3; ty <= 1.0001; ty += 0.05) {
        d.copy(base).addScaledVector(side, tx).addScaledVector(down, ty).normalize();
        if (d.angleTo(base) > 0.9) continue;        // a wrist bends only so far off its line
        const cost = tx + 2 * Math.abs(ty);
        if (cost >= bestCost) continue;
        const c = clearance(d);
        if (c >= margin) { bestCost = cost; best = d.clone(); }
        else if (c > mostC) { mostC = c; most = d.clone(); }
      }
    }
    const dir = best || most;
    if (dir) fire.userData.foreLocal = dir.applyQuaternion(hq.invert());
  }
  function fitOffHand(model, w) {
    if (!FPH || !mat.skin) return;
    let fire = null;
    model.traverse((o) => { if (!fire && o.userData && o.userData.fpGripHand) fire = o; });
    if (!fire && w && w.melee) {
      // a shank / blade: a hammer fist round the wrap, thumb toward the point,
      // knuckles up and to the left, forearm leaving to the lower right
      fire = FPH.attachGrip(model, {
        side: 1, pose: "grip", scale: 1.6,
        center: _ofC.set(0, 0.004, 0.06),
        axis: _ofA.set(0, 0.1, -1), dorsal: _ofB.set(-0.84, -0.5, 0.1),
      }, mat.skin);
      fire.userData.fpGripHand = true;
      fire.userData.foreLocal = new THREE.Vector3(0, 0, 1);
    }
    model.userData.fpFire = fire;
    if (fire && fire.userData.grasp) {
      // the gun is finished now: the thumb re-closes on the whole of it
      FPH.regraspWithSolids(fire, model);
      clearFiringFore(model, fire);
    }
    // the firing hand's hold, for a bolt it leaves to work (fpReloadHands)
    if (fire) { fire.userData.basePos = fire.position.clone(); fire.userData.pose0 = fire.userData.pose; }
    const solids = FPH.solidsOf(model, model);
    const gr = model.userData.grips, hold = gr && gr.hold;
    const fg = fire && fire.userData.grasp;
    if (!gr || !gr.support || !fg || hold === null) {
      model.userData.fpSupport = null;
      // a one-handed gun still reloads with the other hand (the taser's cartridge)
      if (gr && fg && gr.mag && !(w && w.melee)) model.userData.fpReloadHand = reloadOnlyHand(model, fg, fire);
      return;
    }
    // the off hand is the same size as the firing hand, in MODEL units
    const k = fg.k * (fire.parent && fire.parent !== model ? fire.parent.scale.x : 1);
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    let spec, foreDir, maxDev = 0;
    if (hold && hold.kind === "guard") {
      // cupped under the handguard, yawed: fingers up the far side and forward
      const yaw = 0.62;
      spec = {
        side: -1, k: k, name: "guard:" + [hold.y, hold.z, hold.w, hold.h].join("/"),
        prism: { o: V(0, hold.y, hold.z), axis: V(0, 0, -1), u: V(1, 0, 0), hw: hold.w / 2, hh: hold.h / 2, rc: hold.rc, hl: hold.len ? hold.len / 2 : Infinity },
        n: V(-0.30, -1, 0),
        heading: V(Math.cos(yaw), 0.18, -Math.sin(yaw)),
        // a touch behind the part's middle: the elbow stays bent under the gun
        at: V(0, hold.y, hold.z + (hold.slide == null ? 0.03 : hold.slide)),
        palm: [0.004, -FPH.PALM.th * 0.5, -0.056],
        thumbAim: V(-0.10, 0.22, -1),
        thumbBend: [0.9, 0.7, 0.5],
      };
      foreDir = V(-0.55, -0.62, 0.56);          // wrist -> elbow: down, back, out to the left
    } else if (hold && hold.kind === "vgrip") {
      const ax = V(0, Math.cos(hold.rake || 0), -Math.sin(hold.rake || 0));
      const u = V(1, 0, 0), fwd = new THREE.Vector3().crossVectors(ax, u);
      const top = V(0, hold.y, hold.z);
      spec = {
        side: -1, k: k, name: "vgrip:" + [hold.y, hold.z, hold.w, hold.d].join("/"),
        prism: { o: top, axis: ax, u: u, hw: hold.w / 2, hh: hold.d / 2, rc: Math.min(hold.w, hold.d) * 0.22 },
        n: u.clone().negate().addScaledVector(fwd, -0.22),
        heading: fwd.clone(),
        at: top.clone().addScaledVector(ax, -0.050 * k),
        palm: [0, -FPH.PALM.th * 0.5, -(0.096 - hold.d * 0.5 / k - 0.004)],
        thumbAim: u.clone().addScaledVector(fwd, -0.35).addScaledVector(ax, 0.10),
      };
      foreDir = V(-0.45, -0.55, 0.70);
    } else {
      // THUMBS FORWARD on a pistol: over the firing fist, from the left
      const P = fg.prism, e = 0.020 * k;             // the firing fingers' thickness
      const fwd = P.v.clone();                       // front strap side
      spec = {
        side: -1, k: k, name: "cup:" + fg.pose.name,
        prism: { o: P.o.clone(), axis: P.axis.clone(), u: P.u.clone(), hw: P.hw + e, hh: P.hh + e * 0.8, rc: P.rc + e },
        n: P.u.clone().negate().addScaledVector(fwd, -0.30),
        heading: fwd.clone().multiplyScalar(0.90).addScaledVector(P.axis, -0.60),
        at: P.o.clone().addScaledVector(P.axis, -0.034 * k),
        palm: [0.006, -FPH.PALM.th * 0.5, -0.050],
        thumbAim: V(0.25, -0.10, -1),
        thumbAim2: V(0.12, -0.02, -1),
      };
      /* THE WATCH READS. The player's watch (entities/watch.js) sits 2.6 cm
         up this forearm, i.e. at this wrist — and the cup's wrist hung so
         low at the hip that the watch sat ON the bottom edge of the frame:
         the Desert Eagle's case ran from 74% to 106% down the lens, cut in
         half (the revolver's touched the edge, the Glock's reached 90%).
         The cup now closes 1.2 cm higher on the firing fist (at) with its
         fingers raked further down the grip (heading), which lifts the
         wrist, and its forearm leaves back and out to the left, low but not
         plunging, held near that line (maxDev): the case sits whole in the
         lower frame (the Eagle's 62-85%). */
      foreDir = V(-0.62, -0.30, 0.72);
      maxDev = 0.30;
    }
    // the support thumb rests on whatever of the gun it meets: a handguard's
    // on the receiver or barrel nut beside it, a pistol cup's forward along
    // the frame under the firing thumb
    spec.solids = solids;
    // on a pump gun the hand rides the pump (it racks with it)
    const holder = (model.userData.pump && model.userData.pump.parent === model) ? model.userData.pump : model;
    const hand = FPH.graspHand(null, spec, mat.skin);
    if (holder !== model) hand.position.sub(holder.position);
    holder.add(hand);
    // the forearm's natural line, in the hand's own frame (so it rides every rack, dip and kick)
    hand.userData.foreLocal = foreDir.normalize().applyQuaternion(hand.quaternion.clone().invert());
    if (maxDev) hand.userData.foreLocal.maxDev = maxDev;      // gunArm's wrist limit for this hold
    hand.userData.pose0 = hand.userData.pose;
    hand.userData.baseQ = hand.quaternion.clone();
    hand.userData.basePos = hand.position.clone();
    model.userData.fpSupport = hand;
  }
  /* A one-handed gun's off hand exists only for its reload: hidden, parked at
     the pouch, the same size as the firing hand, palm toward the gun's left
     flank (poseFpArms shows it while fps.reloading runs). */
  function reloadOnlyHand(model, fg, fire) {
    const k = fg.k * (fire.parent && fire.parent !== model ? fire.parent.scale.x : 1);
    const h = FPH.makeHand(-1, "relaxed", mat.skin);
    h.scale.setScalar(k);
    h.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    h.visible = false;
    model.add(h);
    h.userData.reloadOnly = true;
    h.userData.basePos = h.position.clone();
    h.userData.baseQ = h.quaternion.clone();
    h.userData.pose0 = "relaxed";
    h.userData.foreLocal = new THREE.Vector3(0, 0, 1);
    return h;
  }

  WEAPONS.forEach((w, i) => {
    const viewModel = buildWeaponModel(w);
    if (!viewModel.userData.muzzle) viewModel.userData.muzzle = new THREE.Vector3(0, 0.05, -0.58);  // every gun MUST have a barrel tip (else tracers fall back to the head)
    viewModel.visible = i === 0;
    viewModel.scale.setScalar(1.28);
    fitOffHand(viewModel, w);
    viewModel.traverse((obj) => {
      obj.renderOrder = 1000;
      if (obj.material) {
        // REAL depth WITHIN the gun (USER-FILMED: with depthTest off, the
        // gun's parts drew over each other in arbitrary order — the pistol
        // read as detached, half-transparent pieces up close, while the same
        // model looked perfect in an NPC's hand). The gun still never clips
        // into walls: a sentinel mesh below clears the depth buffer right
        // before the viewmodel draws, so it always paints over the world.
        obj.material.depthTest = true;
        obj.material.depthWrite = true;
        // transparent:true moves the gun into the TRANSPARENT render queue
        // (renderOrder still wins the sort there). The depth-clear sentinel
        // must fire AFTER the world's glass — when it lived in the opaque
        // queue, every transparent pane in the city depth-tested against a
        // wiped buffer and bled through solid buildings (user-filmed).
        obj.material.transparent = true;
      }
    });
    weaponModels.push(viewModel);
    gun.add(viewModel);

    const carried = buildWeaponModel(w);
    if (!carried.userData.muzzle) carried.userData.muzzle = new THREE.Vector3(0, 0.05, -0.58);
    carried.visible = i === 0;
    // REAL-DIMENSION SIZING (weapons/weapon-scale.js): same law as every
    // other world display of a gun — real researched length × class READ.
    // The legacy 1.45 (screenshot-tuned so the gun didn't vanish into the
    // blocky hand) stays as the module-absent fallback.
    carried.scale.setScalar((CBZ.weaponHeldScale && CBZ.weaponHeldScale(w.id)) || 1.45);
    carriedModels.push(carried);
    carriedGun.add(carried);
  });
  carriedGun.position.set(0.02, 0.02, 0.03);
  // Local orientation so the barrel lies along the socket -Y (down the forearm):
  // rotation.x ≈ -π/2 (no Math.PI on Y). Paired with animChar's -1.571 arm
  // baseline (character.js) this points the muzzle HORIZONTAL-FORWARD at the
  // crosshair instead of double-rotating it skyward.
  carriedGun.rotation.set(-1.571, 0, 0);
  carriedGun.visible = false;
  // world barrel-lock scratch (no per-frame allocation)
  const _blGunPos = new THREE.Vector3(), _blDir = new THREE.Vector3(), _blTarget = new THREE.Vector3();
  const _blZero = new THREE.Vector3(0, 0, 0), _blUp = new THREE.Vector3(0, 1, 0);
  const _blMat = new THREE.Matrix4();
  const _blWorldQ = new THREE.Quaternion(), _blParentQ = new THREE.Quaternion();
  function attachCarriedGun() {
    const ch = CBZ.playerChar;
    const socket = ch && ch.sockets && (ch.sockets.thirdPersonWeapon || ch.sockets.weapon);
    if (socket && carriedGun.parent !== socket) socket.add(carriedGun);
    else if (!socket && ch && ch.body && carriedGun.parent !== ch.body) ch.body.add(carriedGun);
  }
  attachCarriedGun();

  // muzzle flash sprite at the active barrel tip
  const flashTex = (function () {
    const c = document.createElement("canvas"); c.width = c.height = 48;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(24, 24, 1, 24, 24, 23);
    g.addColorStop(0, "rgba(255,255,235,1)");
    g.addColorStop(0.34, "rgba(255,210,90,.9)");
    g.addColorStop(0.68, "rgba(255,110,34,.45)");
    g.addColorStop(1, "rgba(255,60,20,0)");
    x.fillStyle = g; x.fillRect(0, 0, 48, 48);
    return new THREE.CanvasTexture(c);
  })();
  // A taser has a tight blue-white cartridge snap, not burning propellant.
  // Keep a separate map so tinting the shared orange firearm texture cannot
  // turn its yellow/red pixels into a muddy pseudo-electric flash.
  const taserFlashTex = (function () {
    const c = document.createElement("canvas"); c.width = c.height = 48;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(24, 24, 1, 24, 24, 23);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.28, "rgba(165,235,255,.96)");
    g.addColorStop(0.66, "rgba(50,155,255,.46)");
    g.addColorStop(1, "rgba(20,70,255,0)");
    x.fillStyle = g; x.fillRect(0, 0, 48, 48);
    return new THREE.CanvasTexture(c);
  })();
  const muzzle = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flashTex, transparent: true, depthTest: false, blending: THREE.AdditiveBlending,
  }));
  muzzle.visible = false;
  gun.add(muzzle);
  const worldMuzzle = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flashTex, transparent: true, depthTest: false, blending: THREE.AdditiveBlending,
  }));
  worldMuzzle.visible = false;
  CBZ.scene.add(worldMuzzle);

  /* UNARMED FIRST PERSON — TWO HANDS THAT FIGHT, ON TWO REAL ARMS.
     A relaxed right hand when nothing is happening; both fists up in a guard
     the moment a man squares up to you, you swing, or you take one; each
     punch kind has its own arc, timed to the SAME envelope the third-person
     rig uses so the fist is at full reach on the frame combat.js bills the
     hit; a landed hit jolts the fist back; a hit taken tucks the guard.

     WHY THE ARMS USED TO CROSS. Each fist was a Group whose forearm box was a
     RIGID CHILD of the fist, so the forearm could only ever point where the
     fist's hand-typed Euler pointed it — and the guard table yawed both fists
     INWARD (ry -0.50 right, +0.55 left). Both 0.28 m forearm tails therefore
     converged on the midline (x +0.03 and -0.04) and the two 0.16 m boxes
     overlapped into an X at the bottom of the frame. The hook was worse: it
     ended the right fist at x -0.12, inside the left guard at -0.16, so the
     right forearm went straight through the left one.

     Now the tables say only WHERE THE WRIST IS (vm space), how the fist is
     rolled about the forearm and how the wrist bends. The arm is SOLVED:
     systems/fphands.js two-bone IK from a fixed shoulder to that wrist with
     the elbow pole DOWN and OUT on its own side. A fist may cross the
     midline (a hook ends in front of the chin); an elbow never does, so the
     forearms cannot pass through each other. tools/fp-hands-check.mjs
     asserts it for every pose. */
  const fists = new THREE.Group();
  // roll: positive turns the thumb up (either hand); bend: + = back of the hand up
  const HAND_REST = { x: 0.26, y: -0.26, z: 0.04, roll: 0.95, bend: -0.20 };
  const LEFT_DOWN = { x: -0.30, y: -0.60, z: 0.10, roll: 0.95, bend: -0.20 };
  // vm sits 0.66 m out; a guard wrist at +0.20 is 0.46 m from the eye — INSIDE
  // an opponent's face (0.55-0.70 m at fist range), or his head hides your hands
  // vm space: the root sits 0.30 m under the eye, so chin height is y ≈ +0.15
  const GUARD_R = { x: 0.17, y: 0.10, z: 0.20, roll: 1.15, bend: 0.10 };
  const GUARD_L = { x: -0.19, y: 0.09, z: 0.15, roll: 1.15, bend: 0.10 };
  // THE FIST WEARS WHAT YOU WEAR: hand (skin or glove), forearm (bare for a
  // tee, a sleeve with a cuff for a jacket), upper arm (the shirt) — read off
  // the live body every frame by fphands.dressOf (heritage skin comes through
  // the rig). The jumpsuit literals are only the floor with no body at all.
  const FIST_SLEEVE_FALLBACK = 0xff7a1a;
  const FIST_SKIN_FALLBACK = 0xf0c39a;
  const fistSleeve = new THREE.MeshLambertMaterial({ color: FIST_SLEEVE_FALLBACK });
  const fistUpper = new THREE.MeshLambertMaterial({ color: FIST_SLEEVE_FALLBACK });
  const HAND_K = 1.9;                 // FP hand size (the viewmodel world is ~2x real)
  const handR = FPH ? FPH.makeHand(1, "relaxed", mat.skin) : new THREE.Group();
  const handL = FPH ? FPH.makeHand(-1, "fist", mat.skin) : new THREE.Group();
  handR.scale.setScalar(HAND_K); handL.scale.setScalar(HAND_K);
  handL.visible = false;
  fists.add(handR, handL);
  // the two arms: shared by the fists AND the gun (one pair of arms, whatever you hold)
  const fpArms = new THREE.Group();
  fpArms.name = "fp_arms";
  const armR = FPH ? FPH.makeArm({ fore: fistSleeve, upper: fistUpper }, 1) : new THREE.Group();
  const armL = FPH ? FPH.makeArm({ fore: fistSleeve, upper: fistUpper }, -1) : new THREE.Group();
  fpArms.add(armR, armL);
  let armSleeved = false;
  let fistSleeveHex = -1, fistUpperHex = -1, fistSkinHex = -1;
  function dressFists() {
    const d = FPH ? FPH.dressOf(CBZ.playerChar, { skin: FIST_SKIN_FALLBACK, sleeve: FIST_SLEEVE_FALLBACK }) : null;
    const handHex = d ? d.hand : FIST_SKIN_FALLBACK;
    const foreHex = d ? d.fore : FIST_SLEEVE_FALLBACK;
    const upperHex = d ? d.upper : FIST_SLEEVE_FALLBACK;
    armSleeved = !!(d && d.sleeved);
    if (fistSleeveHex !== foreHex) { fistSleeveHex = foreHex; fistSleeve.color.setHex(foreHex); }
    if (fistUpperHex !== upperHex) { fistUpperHex = upperHex; fistUpper.color.setHex(upperHex); }
    if (fistSkinHex !== handHex) { fistSkinHex = handHex; mat.skin.color.setHex(handHex); }
  }

  vm.add(gun, fists, fpArms);
  [fists, fpArms].forEach((grp) => grp.traverse((obj) => {
    obj.renderOrder = 1000;
    obj.frustumCulled = false;
    if (obj.material) {
      obj.material.depthTest = true;     // hands self-occlude like the guns
      obj.material.depthWrite = true;
      obj.material.transparent = true;   // same late-queue ride as the guns
    }
  }));
  // the gun's own hands (firing + support) ride the same flags via the gun traverse
  // DEPTH-CLEAR SENTINEL: a degenerate, invisible triangle that renders just
  // before the viewmodel (renderOrder 999 < 1000, opaque queue) and wipes the
  // depth buffer — the world is already drawn, so the gun then depth-tests
  // only against ITSELF: correct part-on-part occlusion, zero wall clipping.
  (function () {
    const dcGeo = new THREE.BufferGeometry();
    dcGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    const dcMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, transparent: true });
    const dc = new THREE.Mesh(dcGeo, dcMat);
    dc.frustumCulled = false;
    dc.renderOrder = 999;
    dc.onBeforeRender = function (renderer) { renderer.clearDepth(); };
    vm.add(dc);
  })();
  vm.position.set(0.36, -0.34, -0.72);

  let recoil = 0, recoilSide = 0, vmPunch = 0, bobPhase = 0, muzzleT = 0, worldMuzzleT = 0, pumpT = 0;
  // seconds since a BOLT gun's shot: its bolt is worked by the firing hand
  // (published as CBZ.fpsBoltCycle 0..1; systems/gunhands.js CBZ.gunReload)
  let boltT = -1;
  const _fpWork = [0, 0, 0, 0, 0];
  const BOLT_DELAY = 0.12, BOLT_DUR = 0.85;
  let punchT = 0;
  // BLOOM: an extra spread term (radians) that GROWS while moving + auto-firing
  // and TIGHTENS back toward the weapon's base cone when you stand still. This
  // is the "fire discipline" reward — tap or hold still for laser shots, run-
  // and-gun and the cone opens up. recoilHold delays recoil recovery slightly
  // for a snappier kick-then-settle (instead of an instant rubber-band).
  let bloom = 0, recoilHold = 0;
  // View-return debt. A shot kicks the actual first/third-person aim, then a
  // damped spring returns most (not all) of that impulse. There is no hidden
  // bullet-only recoil channel: what moves on screen is what moves the shot.
  let recoilPitch = 0, recoilYaw = 0;
  // systems/sights.js's per-frame inputs (one reused record, no allocation)
  const adsOpts = { aim: false, dt: 0, recoil: 0, recoilSide: 0, punch: 0, reload: false, swap: false, bobX: 0, bobY: 0 };
  let shotsInBurst = 0;                    // pattern position; reset by a fire gap
  let sinceShot = 99;                      // s since last shot — drives the burst reset
  // deterministic L/R yaw weave (signed fractions of basePitch): straight up for
  // the first few, then a learnable side-to-side sway. Scaled per weapon by
  // w.yawWeave. This is the PATTERN (skill expression), not random bloom.
  const YAW_PATTERN = [0, 0.10, 0.20, 0.15, -0.10, -0.25, -0.15, 0.20, 0.35, 0.30, 0.10, -0.20, -0.30, -0.10, 0.25];
  // ramp curve: first ~3 shots controllable (1.0), then climb to rampMax over
  // shots 3..12, clamped thereafter — sustained auto fire kicks harder.
  function rampCurve(n, rampMax) {
    if (n < 3) return 1.0;
    if (n >= 12) return rampMax;
    return 1.0 + (rampMax - 1.0) * ((n - 3) / 9);
  }
  // ADS multiplier: holding RMB (CBZ.isADS) softens recoil ~0.55x. Applies in
  // ALL modes (strict feel improvement); RMB is already wired (aimHeld).
  function adsRecoilMul() { return aimHeld ? 0.55 : 1; }

  /* ============================================================ STANCE
     THE BODY IS PART OF THE WEAPON, and until now the gun did not know it was
     attached to one. systems/physics.js has owned a real three-state stance
     machine for months — press C/Ctrl to crouch, press again mid-sprint to
     slide, double-press to go prone — and it publishes `player.crouch` /
     `player.prone` on the record this file reads every frame. The ONLY thing
     in this file that ever asked was bipodActive(), for one weapon. So going
     prone with a rifle changed your silhouette, your eye height and your
     walking speed and did not change a single round's flight.

     Three scalars, read by every accuracy path below, and one shared reader so
     lockon.js's optic sway and the warlord's AI ask the same question:

       SWAY_STANCE   the body's own hold wobble, in RADIANS. These are real
                     marksmanship figures, not feel numbers: an unsupported
                     standing hold on a service rifle wanders about 4 mrad
                     (~13.7 MOA, roughly a 1.2 m circle at 300 m), kneeling
                     /crouched about 2, and prone or bipod-supported about 1.
                     Through a magnified optic that wobble LOOKS mag times
                     bigger, which is the whole reason a 10x scope is hard to
                     hold — so nothing multiplies it by mag a second time.
       STANCE_SPREAD the cone multiplier. A braced body puts rounds closer
                     together; that is the same physical fact as the sway.
       STANCE_RECOIL how much of the kick the body eats. Prone is the deepest
                     brace there is short of a bipod (which still outranks it).

     Movement speed and eye height are NOT set here: physics.js already owns
     both in the city, and warlord/gunplay.js owns both on the desert page.
     One stance, two bodies, no third copy of what crouching means. */
  const SWAY_STANCE = { stand: 0.0040, crouch: 0.0022, prone: 0.0010 };
  const STANCE_SPREAD = { stand: 1.0, crouch: 0.72, prone: 0.52 };
  const STANCE_RECOIL = { stand: 1.0, crouch: 0.80, prone: 0.58 };
  function stanceOf() {
    const p = CBZ.player;
    if (!p) return "stand";
    if (p.prone) return "prone";
    if (p.crouch) return "crouch";
    return "stand";
  }
  // PUBLIC, because three other files need the same answer and none of them
  // should re-derive it off two booleans: lockon.js scales optic sway by it,
  // warlord/gunplay.js drives it, and a probe prints it.
  CBZ.playerStance = stanceOf;
  // the body's hold wobble right now, in radians — stance x the sight picture
  // the equipped weapon presents (a pistol at arm's length is worse than the
  // same body behind a shouldered carbine). A deployed bipod is the floor.
  CBZ.playerSwayRad = function (w) {
    w = w || (armed() ? weapon() : null);
    let base = SWAY_STANCE[stanceOf()] || SWAY_STANCE.stand;
    if (bipodActive(w)) base = Math.min(base, SWAY_STANCE.prone) * 0.6;
    const o = CBZ.weaponOptic ? CBZ.weaponOptic(w) : null;
    return base * ((o && o.swayMul) || 1);
  };
  // The M249's authored legs are a real support, not decoration.  Crouch,
  // shoulder the gun, and stop on a solid surface to load the receiver into the
  // bipod: recoil, yaw and cone tighten hard.  Moving/airborne/swimming breaks
  // the support immediately; no hidden toggle or fourth-wall prompt.
  //
  // TWO CORRECTIONS (2026-08-03, owner: "guns like the light machine gun that
  // have a bipod"):
  // (a) THE TEST IS THE HARDWARE, NOT THE NAME. `w.key === "lmg"` meant the
  //     day a second belt-fed gun or a bipod'd sniper ships, this branch — and
  //     every consumer of it (recoil, cone, reticle, and now the third-person
  //     rest pose) — silently excludes it. weapon-data.js declares `bipod:true`
  //     and appearances/lmg.js draws the legs; both read the same fact.
  // (b) PRONE IS THE BIPOD'S OWN STANCE. A crouched shooter has to WORK for
  //     the brace (shoulder it, hold still); a prone one has already put the
  //     legs on the deck — the gun is physically resting on them, which is
  //     exactly what entities/character.js now draws. Requiring ADS on top of
  //     that would mean the body shows a deployed gun the ballistics refuse to
  //     believe in. Flag WEAPON_BIPOD_PRONE reverts just that half.
  if (CBZ.CONFIG.WEAPON_BIPOD_PRONE == null) CBZ.CONFIG.WEAPON_BIPOD_PRONE = true;
  function hasBipod(w) { return !!(w && (w.bipod || w.key === "lmg")); }
  function bipodActive(w) {
    const p = CBZ.player;
    if (!hasBipod(w) || !p || p.grounded === false || p._swim) return false;
    if (Math.abs(p.speed || 0) >= 0.8) return false;
    if (p.prone) return CBZ.CONFIG.WEAPON_BIPOD_PRONE !== false;
    return !!(aimHeld && p.crouch);
  }
  CBZ.fpsWeaponHasBipod = function (w) { return hasBipod(w || weapon()); };
  CBZ.fpsBipodActive = function () { return bipodActive(weapon()); };
  /* THE LEGS SAY WHAT THE BALLISTICS SAY. The M249's bipod is modelled (see
     weapons/appearances/lmg.js userData.bipod) and was never unfolded: prone
     or braced, the recoil/cone/sway above tightened on a gun whose legs were
     still folded under the barrel. Every frame, each bipod'd viewmodel (and
     the legacy carried copy survival shows) is driven off bipodActive() —
     the one notion of "deployed" — and animates there. holsterprops.js does
     the same for the third-person drawn gun. Runs before the viewmodel pass
     (onAlways 52) so the legs a frame shows match that frame's brace. */
  CBZ.onAlways(51.5, function (dt) {
    const on = armed() && bipodActive(weapon());
    // …and the body's rest solve (entities/character.js gunGroundRest) reads
    // the same bit, refreshed here even when the aim branch below early-outs
    // (holstered, driving), so a stale "deployed" never pulls a gun down.
    if (CBZ.playerChar) CBZ.playerChar.aimBipod = on;
    for (let i = 0; i < WEAPONS.length; i++) {
      const want = on && i === fps.weapon;
      const a = weaponModels[i] && weaponModels[i].userData.bipod;
      const b = carriedModels[i] && carriedModels[i].userData.bipod;
      if (a && a.drive) a.drive(want, dt);
      if (b && b.drive) b.drive(want, dt);
    }
  });
  function kickView(pitchKick, yawKick) {
    if (fps.active) fps.fp = Math.max(-1.3, Math.min(1.3, fps.fp + pitchKick));
    // systems/camera.js owns the third-person envelope (CBZ.camPitchRange); a
    // copy here would cap recoil climb below where the view can actually go.
    else if (CBZ.cam) { const r = CBZ.camPitchRange ? CBZ.camPitchRange() : [-1.0, 0.9]; CBZ.cam.pitch = Math.max(r[0], Math.min(r[1], CBZ.cam.pitch - pitchKick)); }
    if (CBZ.cam) CBZ.cam.yaw += yawKick;
    // Return about 72%; the remaining displacement is player-controllable
    // muzzle climb instead of a rubber-band that erases every burst.
    recoilPitch = Math.min(0.10, recoilPitch + pitchKick * 0.72);
    recoilYaw = Math.max(-0.065, Math.min(0.065, recoilYaw + yawKick * 0.72));
  }
  // FPS ADS zoom: fpsmode owns the FPS camera (runs after systems/camera.js), so
  // the slight zoom-on-RMB lives here. We track the HIP fov (whatever camera.js
  // set this frame, captured only while NOT aiming so it never ratchets) and ease
  // toward the equipped optic's own ADS field of view when RMB is held.
  let fpsHipFov = 0;          // last-known hip fov (refreshed every non-ADS frame)
  /* ADS_FOV_DROP IS GONE, and it is worth naming what it was: ONE constant,
     25 degrees, applied to every weapon in the game. A .50 Desert Eagle, an
     MP5 and an M249 all "aimed" by narrowing the lens by exactly the same
     amount, and the bolt sniper was special-cased somewhere else entirely
     (systems/lockon.js). The ADS lens is now derived from the SIGHT THAT IS
     ON THE GUN — CBZ.weaponAdsFov, one tangent-law owner in weapon-data.js —
     so irons lean in 12 degrees, a red dot 17, and the M24's 10x M3A takes the
     lens to 8.8 degrees because that is what ten power actually is. */
  const PUNCH_DUR = 0.26;
  let shotCD = 0, dryCD = 0, punchCD = 0, triggerHeld = false, reloadWeapon = 0;
  // reusable per-shot sfx options (no per-shot allocation at auto-fire rates):
  // heavy guns (AK) re-pitch a shared sample DOWN for a deeper bark — same
  // audio file, different character, zero new assets.
  const shotSfxOpts = { pitch: 1, volume: 1 };

  // ---- the fight state of the two hands ----
  let guardK = 0;            // 0 relaxed … 1 both fists up
  let guardHold = 0;         // seconds the guard stays up after the last reason for it
  let threatPoll = 0;
  let swing = null;          // { t, dur, kind, side, silent }
  let impactT = 0;           // a landed hit: the fist jolts back
  let flinchT = 0;           // a hit taken: the guard tucks
  let fpRoll = 0, fpRollV = 0;
  let weave = 0;

  function triggerFistPunch(silent) {
    // the kind and the arm come off the body the way the third-person rig
    // reads them: systems/combat.js writes punchKind/punchArm/punchDur right
    // before it asks for the swing. Anything else (grapple, a press) is a jab.
    const ch = CBZ.playerChar;
    const fromBody = ch && ch.punchT > 0 && ch.punchKind != null;
    const kind = fromBody ? (ch.punchKind || "jab") : "jab";
    const side = fromBody ? (ch.punchArm === "l" ? -1 : 1) : 1;
    const dur = fromBody && ch.punchDur > 0 ? ch.punchDur : PUNCH_DUR;
    swing = { t: dur, dur, kind, side, silent: !!silent };
    punchT = dur;
    vmPunch = 0.5;                    // small viewmodel kick
    guardHold = Math.max(guardHold, 2.5);
    // One restrained cloth movement per real swing. Callers that reuse the
    // hand animation for pressing/placing objects can request a silent pose.
    if (!silent && CBZ.sfx) CBZ.sfx("whoosh");
  }
  // disaster grapple-punch (grapple.js) triggers the same hand swing
  CBZ.fpsPunchAnim = triggerFistPunch;
  // systems/combat.js: the fist arrived — hold it there, then jolt it back
  CBZ.fpsPunchLanded = function (kind, heavy) {
    impactT = heavy ? 0.16 : 0.12;
    vmPunch = Math.max(vmPunch, heavy ? 0.9 : 0.6);
    fpRollV += (swing ? -swing.side : -1) * (heavy ? 0.9 : 0.5);
  };
  // systems/combat.js playerHitReact: you took one — the guard tightens
  CBZ.fpsHitTaken = function () {
    flinchT = 0.24;
    guardHold = Math.max(guardHold, 2.5);
    fpRollV += (Math.random() < 0.5 ? -1 : 1) * 0.7;
  };
  CBZ.fpsGuardK = function () { return guardK; };

  function wantGuard() {
    if (guardHold > 0) return true;
    if ((CBZ.meleeFocusT || 0) > 0 || (CBZ.player.hitT || 0) > 0) return true;
    return false;
  }
  function pollThreat(dt) {
    threatPoll -= dt;
    if (threatPoll > 0) return;
    threatPoll = 0.25;
    if (CBZ.game.mode !== "escape" || !CBZ.npcs) return;
    const P = CBZ.player.pos;
    for (let i = 0; i < CBZ.npcs.length; i++) {
      const n = CBZ.npcs[i];
      if (!(n.huntPlayer > 0) || n.dead || n.ko > 0 || !n.group) continue;
      const dx = n.group.position.x - P.x, dz = n.group.position.z - P.z;
      if (dx * dx + dz * dz < 36) { guardHold = Math.max(guardHold, 1.2); return; }
    }
  }
  function lerpPose(out, a, b, k) {
    out.x = a.x + (b.x - a.x) * k; out.y = a.y + (b.y - a.y) * k; out.z = a.z + (b.z - a.z) * k;
    out.roll = a.roll + (b.roll - a.roll) * k; out.bend = a.bend + (b.bend - a.bend) * k;
    return out;
  }
  /* where a given punch kind puts the striking WRIST at full reach (vm space).
     Full reach puts the wrist ~0.70 m from the eye. The hook finishes in
     front of the chin (x -0.02), not across the far guard: it travels on a
     wide arc and its elbow comes up and out (see HOOK_POLE). */
  function reachPose(kind, side, out) {
    const s = side;
    if (kind === "hook") { out.x = -s * 0.02; out.y = 0.15; out.z = 0.02; out.roll = 0.30; out.bend = 0.0; }
    else if (kind === "upper") { out.x = s * 0.07; out.y = 0.32; out.z = 0.04; out.roll = 2.55; out.bend = 0.15; }
    else if (kind === "stab") { out.x = 0.10; out.y = -0.02; out.z = -0.06; out.roll = 1.25; out.bend = 0.0; }   // the body, not the chin
    else if (kind === "cross") { out.x = s * 0.05; out.y = 0.17; out.z = -0.10; out.roll = 0.10; out.bend = 0.05; }
    else { out.x = s * 0.07; out.y = 0.16; out.z = -0.04; out.roll = 0.20; out.bend = 0.05; }   // jab / default: the fist corkscrews palm-down
    return out;
  }
  // where the wind-up chambers it
  function windPose(kind, side, base, out) {
    const s = side;
    copyPose(base, out);
    if (kind === "hook") { out.x = base.x + s * 0.18; out.y = base.y + 0.01; out.z = base.z + 0.08; out.roll = base.roll - 0.5; }
    else if (kind === "upper") { out.x = base.x + s * 0.02; out.y = base.y - 0.18; out.z = base.z + 0.10; out.roll = base.roll + 0.6; }
    else if (kind === "stab") { out.x = 0.30; out.y = -0.44; out.z = 0.14; out.roll = 1.2; out.bend = -0.1; }
    else { out.x = base.x + s * 0.03; out.y = base.y - 0.02; out.z = base.z + 0.07; }
    return out;
  }
  const _reach = {}, _wind = {}, _base = {};
  function copyPose(a, out) { out.x = a.x; out.y = a.y; out.z = a.z; out.roll = a.roll; out.bend = a.bend; return out; }
  function rollAmt(kind) {
    return kind === "hook" ? 0.048 : kind === "cross" ? 0.032 : kind === "upper" ? 0.022 : kind === "stab" ? 0.014 : 0.012;
  }
  // this frame's wrist targets for the two fists (vm space), read by poseFpArms
  const fistT = [
    { x: 0, y: 0, z: 0, roll: 0, bend: 0, vis: true, curl: "relaxed", hook: 0 },
    { x: 0, y: 0, z: 0, roll: 0, bend: 0, vis: false, curl: "fist", hook: 0 },
  ];

  function animFists(dt) {
    if (punchT > 0) punchT = Math.max(0, punchT - dt);
    if (impactT > 0) impactT = Math.max(0, impactT - dt);
    if (flinchT > 0) flinchT = Math.max(0, flinchT - dt);
    if (guardHold > 0) guardHold = Math.max(0, guardHold - dt);
    pollThreat(dt);
    const up = wantGuard();
    guardK += ((up ? 1 : 0) - guardK) * Math.min(1, dt * (up ? 14 : 5));
    if (guardK < 1e-3) guardK = 0;
    weave += dt * 2.6;

    // the two resting poses: relaxed vs guard, blended by guardK
    const wv = Math.sin(weave), wv2 = Math.sin(weave * 2 + 1.3);
    const gR = copyPose(GUARD_R, _base);
    gR.y += wv2 * 0.012 * guardK; gR.x += wv * 0.008 * guardK;
    // the striking hand rides its own arc; the other holds the guard
    let strikeSide = 0, prog = 0, wind = 0, drive = 0, recover = 0;
    if (swing && punchT > 0) {
      swing.t = punchT;
      prog = 1 - punchT / swing.dur;
      wind = Math.max(0, 1 - prog / 0.24);
      drive = Math.sin(Math.min(1, Math.max(0, (prog - 0.16) / 0.54)) * Math.PI);
      recover = Math.max(0, (prog - 0.62) / 0.38);
      strikeSide = swing.side;
    } else if (swing) swing = null;

    const flinch = flinchT > 0 ? Math.sin(Math.min(1, flinchT / 0.24) * Math.PI) : 0;
    const jolt = impactT > 0 ? impactT / 0.14 : 0;

    for (let i = 0; i < 2; i++) {
      const T = fistT[i], s = i === 0 ? 1 : -1;
      const guard = i === 0 ? gR : GUARD_L;
      const rest = i === 0 ? HAND_REST : LEFT_DOWN;
      T.hook = 0;
      if (strikeSide === s) {
        // base = the guard (a man who is swinging has his hands up)
        const base = guard;
        windPose(swing.kind, s, base, _wind);
        reachPose(swing.kind, s, _reach);
        // wind out of the base, drive from the wound-up chamber to full reach, settle home
        lerpPose(T, base, _wind, wind);
        const wx = T.x, wy = T.y, wz = T.z, wr = T.roll, wb = T.bend;
        T.x = wx + (_reach.x - wx) * drive; T.y = wy + (_reach.y - wy) * drive; T.z = wz + (_reach.z - wz) * drive;
        T.roll = wr + (_reach.roll - wr) * drive; T.bend = wb + (_reach.bend - wb) * drive;
        if (swing.kind === "hook") {
          // a hook travels on an arc, not a line: it swings wide before it comes in,
          // and the elbow rises and goes OUT (never across)
          T.x += s * 0.16 * Math.sin(drive * Math.PI);
          T.hook = Math.max(drive, wind * 0.4);
        }
        // the landed hit: the fist stops short and kicks back at the wrist
        if (jolt > 0) { T.z += 0.07 * jolt; T.y += 0.02 * jolt; T.bend += 0.25 * jolt; }
        // recovery eases toward the guard blend rather than snapping
        const home = 1 - guardK;
        T.x += (rest.x - guard.x) * home * recover; T.y += (rest.y - guard.y) * home * recover; T.z += (rest.z - guard.z) * home * recover;
        T.vis = true;
        T.curl = "fist";
      } else {
        // the guard hand (or the relaxed hand): rest → guard by guardK
        lerpPose(T, rest, guard, guardK);
        // an off-hand during a stab reaches to grab the collar
        if (swing && punchT > 0 && swing.kind === "stab" && s === -1) {
          const k = Math.min(1, drive + wind * 0.3);
          T.x += (-0.12 - T.x) * k; T.y += (0.12 - T.y) * k; T.z += (0.02 - T.z) * k;
          T.roll += 0.4 * k;
        }
        // a cross / hook turns the torso: the guard hand pulls in and back a
        // touch — toward its OWN side of the chin, never across it
        if (strikeSide !== 0 && (swing.kind === "cross" || swing.kind === "hook")) {
          T.x += s * 0.01 * drive; T.z += 0.05 * drive; T.y += 0.02 * drive;
        }
        // the flinch: tuck, rise, pull in
        if (flinch > 0) { T.y += 0.06 * flinch; T.x -= s * 0.03 * flinch; T.z += 0.05 * flinch; T.bend += 0.25 * flinch; }
        T.vis = i === 0 || guardK > 0.02;
        T.curl = guardK > 0.35 || (swing && punchT > 0) ? "fist" : "relaxed";
      }
    }

    // the lens rolls with the torso: a spring toward the swing's own roll
    const rollTarget = (strikeSide !== 0 ? -strikeSide * rollAmt(swing.kind) * drive : 0);
    fpRollV += (rollTarget - fpRoll) * 140 * dt;
    fpRollV *= Math.max(0, 1 - 16 * dt);
    fpRoll += fpRollV * dt;
    if (Math.abs(fpRoll) < 1e-5 && Math.abs(fpRollV) < 1e-4) { fpRoll = 0; fpRollV = 0; }
  }

  /* ---- HANDS ON THE LEDGE, DOWN THE LENS -----------------------------------
     A vault or a mantle plants the BODY's palms on the obstacle (entities/
     character.js traversePlants: a real point on its top, the exact arm IK).
     In first person the same contact has to be what you see: the bare hands
     go to that point instead of holding their guard in the air while the
     view climbs over a wall. Same rule the pickup uses to put a hand on a
     thing (systems/verbs_pickup.js fpPickup): the grip point rides the ray to
     the real point, as far as the arm reaches, so the palm sits over the
     contact on screen; the palm lies flat on the top, fingers along the move,
     and it carries exactly the body plant's weight (it arrives and lets go
     with it). Unarmed only: a drawn gun keeps both hands. */
  const FP_SH = [[0.30, -0.45, 0.12], [-0.30, -0.45, 0.12]];   // shoulders, camera space (as fpPickup)
  const _fpC = new THREE.Vector3(), _fpS = new THREE.Vector3(), _fpG = new THREE.Vector3(), _fpO = new THREE.Vector3();
  const _fpX = new THREE.Vector3(), _fpY = new THREE.Vector3(0, 1, 0), _fpZ = new THREE.Vector3();
  const _fpM = new THREE.Matrix4(), _fpQ = new THREE.Quaternion(), _fpCQ = new THREE.Quaternion(), _fpVI = new THREE.Matrix4();
  const _fpVQ = new THREE.Quaternion();
  /* EVERY HAND ON THE WORLD, NOT JUST THE VAULT'S. The same mechanism takes
     CBZ.verbs.touchPlants() too (systems/verbs_pickup.js CBZ.verbs.touch: a
     palm on a door, a finger on a lift button, a hand round a car handle,
     palms on a crate or a wall): each carries its point, arm, weight, the
     hand's frame (bk = where the back of the hand faces, fg = where the
     fingers point) and its pose, whose own contact point (fpHands.contactOf)
     is what lands on the point. */
  const _fpPC = new THREE.Vector3();
  let _fpList = [];
  function fpPlants() {
    fistT[0].plantW = 0; fistT[1].plantW = 0;
    // a vault's plants, or (systems/climb.js) the rungs your hands are on;
    // failing both, the touches (a vault or a climb owns the hands)
    const rig = CBZ.playerChar, tp0 = rig && rig.traversePose;
    const tp = (tp0 && tp0._plants) ? tp0 : (CBZ.climb && CBZ.climb.fpSource ? CBZ.climb.fpSource() : null);
    const trav = tp && tp._plants;
    const touch = CBZ.verbs && CBZ.verbs.touchPlants ? CBZ.verbs.touchPlants() : null;
    if ((!trav || !trav.length) && (!touch || !touch.length)) return false;
    if (!CBZ.camera || !FPH || !FPH.PLANT_CONTACT) return false;
    _fpList.length = 0;
    if (trav && trav.length) for (let k = 0; k < trav.length; k++) _fpList.push(trav[k]);
    else for (let k = 0; k < touch.length; k++) _fpList.push(touch[k]);
    const plants = _fpList;
    const cam = CBZ.camera;
    cam.updateMatrixWorld(true);
    vm.updateMatrix();
    _fpVI.copy(vm.matrix).invert();
    cam.getWorldQuaternion(_fpCQ).invert();
    _fpVQ.copy(vm.quaternion).invert();
    let any = false;
    for (let k = 0; k < plants.length; k++) {
      const pl = plants[k], w = Math.min(1, pl.w || 0);
      if (!(w > 0.01)) continue;
      const i = pl.arm === "l" ? 1 : 0, T = fistT[i], side = i ? -1 : 1;
      // along the ray to the real point, as far as this arm reaches
      _fpC.copy(pl.p); cam.worldToLocal(_fpC);
      const D = _fpC.length() || 1;
      _fpC.multiplyScalar(1 / D);
      if (_fpC.z > -0.25) { _fpC.z = -0.25; _fpC.normalize(); }
      const sh = FP_SH[i];
      _fpS.set(sh[0], sh[1], sh[2]);
      const us = _fpC.dot(_fpS), disc = us * us - _fpS.lengthSq() + 1;
      const dR = Math.max(0.5, Math.min(D, Math.min(1.0, disc > 0 ? us + Math.sqrt(disc) : 0.8)));
      _fpG.copy(_fpC).multiplyScalar(dR).applyMatrix4(_fpVI);              // the palm's point, vm space
      // the hand's frame: +Y the back of the hand, fingers (-Z); a vault's
      // palm is flat on the top with the fingers along the move; world -> camera -> vm
      if (pl.bk && pl.fg) { _fpY.copy(pl.bk); _fpZ.copy(pl.fg).negate(); }
      else { _fpY.set(0, 1, 0); _fpZ.set(-(tp ? tp.dirX : 0), 0, -(tp ? tp.dirZ : 1)); }
      _fpZ.addScaledVector(_fpY, -_fpZ.dot(_fpY)).normalize();
      _fpX.crossVectors(_fpY, _fpZ);
      _fpM.makeBasis(_fpX, _fpY, _fpZ);
      _fpQ.setFromRotationMatrix(_fpM).premultiply(_fpCQ).premultiply(_fpVQ);
      T.plantQ = (T.plantQ || new THREE.Quaternion()).copy(_fpQ);
      // the wrist that puts the pose's contact point there
      const pose = pl.pose || "plant";
      if (FPH.contactOf) FPH.contactOf(pose, _fpPC); else _fpPC.fromArray(FPH.PLANT_CONTACT);
      _fpO.set(_fpPC.x * side, _fpPC.y, _fpPC.z).multiplyScalar(HAND_K).applyQuaternion(_fpQ);
      _fpG.sub(_fpO);
      T.x += (_fpG.x - T.x) * w; T.y += (_fpG.y - T.y) * w; T.z += (_fpG.z - T.z) * w;
      T.vis = true;
      T.hook = 0;
      if (w > 0.3) T.curl = pl.pose || (tp && tp.curl) || "plant";
      T.plantW = w;
      any = true;
    }
    return any;
  }

  /* ---- THE ARMS, SOLVED EVERY FRAME ---------------------------------------
     Shoulders are fixed in CAMERA space (a body, not the swaying viewmodel)
     and carried into vm space through vm's own transform, so bob and recoil
     move the hands against the shoulders the way a real body does. The elbow
     pole is always down and OUT on the arm's own side. */
  const SHOULDER_CAM = [[0.30, -0.45, 0.12], [-0.30, -0.45, 0.12]];
  const ARM_FIST = [0.46, 0.44];            // upper, fore (vm metres at HAND_K)
  /* ARMED, THE BODY IS THE GUN'S SCALE. The viewmodel is a ~2.56x world (the
     guns are built ~2x real and vm scales them 1.28), and the old arms were
     not: shoulders 0.30 m out and 0.45 down with 0.60/0.62 bones, so a
     rifle's support hand was out of reach (the arm locked straight and lay
     along the gun as a giant sleeve) and a pistol's arms folded into a V
     under the gun. Now a real body at the hand's own scale: shoulder joints
     17 cm out, 24 cm under and 6 cm behind the eye, upper arm 30 cm, forearm
     26.5 cm, all times the hand's vm scale. And the wrist is limited
     (fphands.math.clampFore): the forearm leaves each hand within
     WRIST_DEV of its natural line, so the joint never kinks at an angle no
     wrist can make, and the forearms enter from the bottom corners. */
  const SHOULDER_BODY = [[0.17, -0.24, 0.06], [-0.17, -0.24, 0.06]];
  const ARM_BODY = [0.30, 0.265];
  const WRIST_DEV = [0.70, 0.70];                 // firing, support (radians)
  // where each forearm LEAVES the frame (camera space, wrist -> elbow): down
  // and back toward its own bottom corner, never at the lens
  const ARM_EXIT = [[0.30, -1, 0.30], [-0.50, -1, 0.30]];
  const _vmInv = new THREE.Matrix4();
  const _aS = new THREE.Vector3(), _aW = new THREE.Vector3(), _aE = new THREE.Vector3(), _aAlong = new THREE.Vector3();
  const _aQ = new THREE.Quaternion(), _aP = new THREE.Vector3();
  const _sArr = [0, 0, 0], _wArr = [0, 0, 0], _pArr = [0, 0, 0];
  function shoulderVm(i, out) {
    const s = SHOULDER_CAM[i];
    return out.set(s[0], s[1], s[2]).applyMatrix4(_vmInv);
  }
  function elbowFor(i, W, S, pole, lens, out) {
    _sArr[0] = S.x; _sArr[1] = S.y; _sArr[2] = S.z;
    _wArr[0] = W.x; _wArr[1] = W.y; _wArr[2] = W.z;
    const e = FPH.math.solveElbow(_sArr, _wArr, pole, lens[0], lens[1]);
    return out.set(e[0], e[1], e[2]);
  }
  function defaultPole(side, hook, out) {
    // down and out; a hook lifts the elbow up and out to the side
    out[0] = side * (0.45 + 0.55 * hook); out[1] = -1 + 1.15 * hook; out[2] = 0.15 + 0.1 * hook;
    return out;
  }
  // position + orientation of a descendant of vm, in vm space
  function inVm(obj, localPoint, outP, outQ) {
    outP.copy(localPoint || _zeroV);
    if (outQ) outQ.identity();
    let o = obj;
    while (o && o !== vm) {
      o.updateMatrix();
      outP.applyMatrix4(o.matrix);
      if (outQ) outQ.premultiply(o.quaternion);
      o = o.parent;
    }
    return o === vm;
  }
  const _zeroV = new THREE.Vector3();
  function worldScaleInVm(obj) {
    let k = 1, o = obj;
    while (o && o !== vm) { k *= o.scale.x; o = o.parent; }
    return k;
  }
  /* ---- THE RELOAD, FIRST PERSON -------------------------------------------
     The same table, parts and anchors as the body's (systems/gunhands.js
     CBZ.gunReload): the viewmodel's own magazine drops out of the well, the
     fresh one rides the off hand up from the pouch and seats, the handle or
     slide comes back under it; the bolt gun's FIRING hand leaves the grip to
     work the bolt (between shots too, CBZ.fpsBoltCycle). Anchors are in the
     gun's model space; the pouch is on the body, below the lens (camera
     space at the hand's own scale, like the shoulders). Each hand is moved so
     the middle of its palm is on the anchor — placed from its hold every
     frame, never accumulated. */
  const FP_POUCH = { l: [-0.17, -0.60, -0.04], r: [0.17, -0.58, -0.02], rocket: [-0.30, -0.30, 0.10] };
  const HAND_PALM = [0, -0.026, -0.052];          // the palm's middle, hand frame (right-hand canonical)
  const _fh = new THREE.Matrix4(), _fhi = new THREE.Matrix4(), _fmv = new THREE.Matrix4();
  const _fa = new THREE.Vector3(), _fb = new THREE.Vector3(), _ft = new THREE.Vector3(), _fg = new THREE.Vector3(), _fq = new THREE.Vector3(), _fc = new THREE.Vector3();
  function chainTo(obj, root, out) {
    out.identity();
    for (let o = obj; o && o !== root; o = o.parent) { o.updateMatrix(); out.premultiply(o.matrix); }
    return out;
  }
  // the middle of a hand's palm, in the gun's model space
  function fpPalm(model, hand, out) {
    hand.updateMatrix();
    out.set(hand.userData.side * HAND_PALM[0], HAND_PALM[1], HAND_PALM[2]).applyMatrix4(hand.matrix);
    return out.applyMatrix4(chainTo(hand.parent, model, _fh));
  }
  // the pouch, below the lens, in the gun's model space
  function fpPouch(model, hand, key, out) {
    const P = FP_POUCH[key] || FP_POUCH.l, k = worldScaleInVm(hand);
    out.set(P[0] * k, P[1] * k, P[2] * k).applyMatrix4(_vmInv);            // camera -> vm
    return out.applyMatrix4(_fmv.copy(chainTo(model, vm, _fh)).invert());  // vm -> model
  }
  // put this hand's palm on the path at p (rows from the one table)
  function fpWalk(model, hand, rows, p, side, pouchKey) {
    const RLk = CBZ.gunReload, s = RLk.seg(rows, p);
    fpPalm(model, hand, _fg);                        // at home (the caller homed it)
    const at = (key, out) => (key === "support" || key === "grip")
      ? (hand.userData.reloadOnly ? fpPouch(model, hand, pouchKey, out) : out.copy(_fg))
      : key === "pouch" ? fpPouch(model, hand, pouchKey, out)
        : (RLk.point(model, key, out) || out.copy(_fg));
    at(s.a, _fa); at(s.b, _fb);
    _ft.lerpVectors(_fa, _fb, s.u);
    // bow the path out to the hand's own side and down, clear of the gun
    if (s.arc > 0) { _ft.x += side * s.arc * 0.7; _ft.y -= s.arc; }
    // move the wrist by what the palm must move, in the hand's parent space
    _fhi.copy(chainTo(hand.parent, model, _fh)).invert();
    _ft.applyMatrix4(_fhi); _fq.copy(_fg).applyMatrix4(_fhi);
    hand.position.add(_ft).sub(_fq);
    FPH.setPose(hand, s.dwell ? "grip" : "relaxed");
    return s;
  }
  function fpReloadHands(model, fire, sup) {
    // every frame from the hold: the hands are placed, not accumulated
    if (fire && fire.userData.basePos) { fire.position.copy(fire.userData.basePos); FPH.setPose(fire, fire.userData.pose0); }
    if (sup && sup.userData.basePos) { sup.position.copy(sup.userData.basePos); FPH.setPose(sup, sup.userData.pose0); }
    const RLk = CBZ.gunReload;
    if (!RLk || !model || !model.userData.grips) return -1;
    const rp = CBZ.gunReloadPose ? CBZ.gunReloadPose() : null;
    const p = rp && rp.active ? rp.p : -1;
    const cyc = p < 0 && CBZ.fpsBoltCycle != null ? CBZ.fpsBoltCycle : -1;
    const rec = RLk.recipe(model), cycle = cyc >= 0 ? RLk.cycle(model) : null;
    if (!(p >= 0) && !cycle) { if (model.userData._reloadRig) RLk.pose(model, -1); return -1; }
    const style = RLk.styleOf(model);
    RLk.pose(model, p, { cycle: cyc, drop: "fall" });          // the parts first: hands go where they ARE
    if (p >= 0 && rec.l && sup) fpWalk(model, sup, rec.l, p, -1, style === "rocket" ? "rocket" : "l");
    const rrows = p >= 0 ? rec.r : cycle && cycle.r;
    if (rrows && fire && fire.userData.basePos) fpWalk(model, fire, rrows, p >= 0 ? p : cyc, 1, "r");
    if (p >= 0) {
      const carrier = rec.carry === "r" ? fire : sup;
      if (carrier) RLk.pose(model, p, { cycle: cyc, drop: "fall", hand: fpPalm(model, carrier, _fc) });
    }
    return p;
  }
  const _poleArr = [0, 0, 0];

  function poseFpArms(dt) {
    if (!FPH) return;
    if (ddT >= 0) {
      // the death drop: the gun tumbles out of the grip — the off hand lets go
      fpArms.visible = false;
      const dm = weaponModels[fps.weapon];
      if (dm && dm.userData.fpSupport) dm.userData.fpSupport.visible = false;
      return;
    }
    const showFists = fists.visible && vm.visible;
    const model = gun.visible && vm.visible ? weaponModels[fps.weapon] : null;
    fpArms.visible = !!(showFists || model);
    if (!fpArms.visible) return;
    dressFists();
    vm.updateMatrix();
    _vmInv.copy(vm.matrix).invert();
    if (showFists) {
      for (let i = 0; i < 2; i++) {
        const T = fistT[i], hand = i === 0 ? handR : handL, arm = i === 0 ? armR : armL, side = i === 0 ? 1 : -1;
        hand.visible = T.vis; arm.visible = T.vis;
        if (!T.vis) continue;
        FPH.setPose(hand, T.curl);
        _aW.set(T.x, T.y, T.z);
        shoulderVm(i, _aS);
        elbowFor(i, _aW, _aS, defaultPole(side, T.hook, _poleArr), ARM_FIST, _aE);
        _aAlong.subVectors(_aW, _aE);
        FPH.orientAlong(side, _aAlong, T.roll, T.bend, hand.quaternion);
        if (T.plantW > 0 && T.plantQ) hand.quaternion.slerp(T.plantQ, T.plantW);   // flat on the ledge (fpPlants)
        hand.position.copy(_aW);
        FPH.poseArm(arm, _aW, _aE, _aS, hand.quaternion, HAND_K, armSleeved);
      }
      return;
    }
    // ARMED: the firing arm grows out of the gun's own hand; the off arm out
    // of the support hand (or hangs out of frame on a one-handed weapon)
    const fire = model && model.userData.fpFire;
    // a one-handed gun's reload hand comes only for its reload
    const rh = model && model.userData.fpReloadHand;
    if (rh) rh.visible = false;
    const sup = model && (model.userData.fpSupport ||
      (rh && CBZ.gunReloadPose && CBZ.gunReloadPose().active ? rh : null));
    fpReloadHands(model, fire, sup);
    armR.visible = !!fire;
    if (fire) gunArm(0, fire, armR);
    /* HOW MANY HANDS (systems/actorweapons.js CBZ.holds): a handgun is two
       hands only down the sights, one at the hip; the off hand comes up onto
       the gun with the sight blend and drops back out of the frame below
       it. A reload always brings it (it works the magazine). */
    const k2 = fpSupportK(sup, dt);
    armL.visible = !!sup && k2 > 0.02;
    if (sup) sup.visible = k2 > 0.02;
    if (sup && k2 > 0.02) {
      // (the reload has already walked it through the gun's anchors: fpReloadHands)
      if (k2 < 1) sup.position.addScaledVector(FP_SUP_DROP, (1 - k2) * (1 - k2) / worldScaleInVm(sup.parent));
      gunArm(1, sup, armL);
    }
  }
  // the off hand's share of a one-hand-at-the-hip gun (eased: it travels)
  let fpSupEase = 1;
  const FP_SUP_DROP = new THREE.Vector3(-0.12, -0.64, 0.34);   // viewmodel units: down, back and out of the frame
  function fpSupportK(sup, dt) {
    let want = 1;
    const w = WEAPONS[fps.weapon];
    if (sup && w && CBZ.holds && !(fps.reloading > 0)) {
      const hip = CBZ.holds.hands(w, { view: "fp", aimed: false }), aimed = CBZ.holds.hands(w, { view: "fp", aimed: true });
      want = hip >= 2 ? 1 : (aimed >= 2 ? (CBZ.fpsAdsK ? CBZ.fpsAdsK() : 0) : 0);
    }
    fpSupEase += (want - fpSupEase) * Math.min(1, (dt || 0.016) * 14);
    if (Math.abs(want - fpSupEase) < 1e-3) fpSupEase = want;
    return fpSupEase;
  }
  const _aF = new THREE.Vector3(), _eArr = [0, 0, 0], _fArr = [0, 0, 0];
  function armShoulderVm(i, k, out) {
    const s = SHOULDER_BODY[i];
    return out.set(s[0] * k, s[1] * k, s[2] * k).applyMatrix4(_vmInv);
  }
  // one gun arm: the forearm heads for its bottom corner of the frame, as far
  // as the wrist allows off the hand's natural line; the upper arm joins it
  // to a shoulder at the hand's own scale (below and behind the lens)
  const _vmQi = new THREE.Quaternion();
  function gunArm(i, hand, arm) {
    const k = worldScaleInVm(hand);
    inVm(hand, null, _aW, _aQ);
    armShoulderVm(i, k, _aS);
    const lens = [ARM_BODY[0] * k, ARM_BODY[1] * k];
    const x = ARM_EXIT[i];
    _vmQi.copy(vm.quaternion).invert();
    _aE.set(x[0], x[1], x[2]).normalize().applyQuaternion(_vmQi).multiplyScalar(lens[1]).add(_aW);
    const fl = hand.userData.foreLocal;
    if (fl) {
      _aF.copy(fl).applyQuaternion(_aQ);
      _wArr[0] = _aW.x; _wArr[1] = _aW.y; _wArr[2] = _aW.z;
      _eArr[0] = _aE.x; _eArr[1] = _aE.y; _eArr[2] = _aE.z;
      _fArr[0] = _aF.x; _fArr[1] = _aF.y; _fArr[2] = _aF.z;
      const e = FPH.math.clampFore(_wArr, _eArr, _fArr, fl.maxDev || WRIST_DEV[i], lens[1]);   // a hold may keep its forearm nearer its own line (the pistol cup)
      _aE.set(e[0], e[1], e[2]);
    }
    FPH.poseArm(arm, _aW, _aE, _aS, _aQ, k, armSleeved);
  }
  // THE TORCH HAND (systems/playerflashlight.js CBZ.fpTorchHold): called right
  // after poseFpArms with this view of the viewmodel, so a lit torch can take
  // an off hand (or the empty right hand) and re-solve its arm the same way.
  const FP_TORCH_VIEW = {
    vm, fists, handR, handL, armR, armL, HAND_K, gunArm, inVm, worldScaleInVm,
    model: () => (gun.visible && vm.visible ? weaponModels[fps.weapon] || null : null),
    dying: () => ddT >= 0,
  };
  let aimHeld = false;     // third-person ADS (right mouse): raise the gun to aim
  let switchCD = 0;        // debounce weapon switching so mashing Q can't spam/stall
  let qWasDown = false;    // edge-detect Q in the frame loop (not per keydown event)
  let introWantsFPS = false;

  // ---- tracer pool ----
  const tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.9, depthWrite: false });
  const tracers = [];
  let tracerIdx = 0;
  for (let i = 0; i < 22; i++) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat.clone());
    mesh.visible = false;
    CBZ.scene.add(mesh);
    tracers.push({ mesh, life: 0, max: 0.055 });
  }

  function fireTracer(from, to, radius, life) {
    const d = tmp.copy(to).sub(from);
    const len = d.length();
    if (len < 0.1) return;
    const t = tracers[tracerIdx];
    tracerIdx = (tracerIdx + 1) % tracers.length;
    t.mesh.position.copy(from).addScaledVector(d, 0.5);
    t.mesh.scale.set(radius, len, radius);
    t.mesh.quaternion.setFromUnitVectors(UP, d.normalize());
    t.mesh.material.opacity = 0.9;
    t.mesh.visible = true;
    t.life = life || 0.055;
    t.max = t.life;
  }

  // ---- REAL ROCKET FLIGHT (b) -------------------------------------------------
  // The RPG used to be "a hitscan-to-impact rocket" (resolve impact instantly,
  // draw a tracer, detonate the same frame) — every other heavy-ordnance game
  // gives a rocket actual hang time you can see and react to. The impact POINT
  // (and the wall it lands on) is still resolved up-front at the moment of
  // firing, exactly like before (so it always lands precisely under the
  // reticle — the existing "no recoil bias, ever" contract is unchanged) and
  // handed to launchRocket() as the flight's fixed endpoint; only WHEN the
  // detonation actually fires moved, from instant to a real flight-time delay.
  // shoot()'s explosive branch builds a `detonate` closure that runs the
  // EXACT same FX call sequence the old instant branch ran and passes it in
  // as onArrive — see (b) there for the full original-vs-new diff explanation.
  // ---- THE ROUND IN FLIGHT IS A PG-7V -----------------------------------------
  // (was: a cylinder, a cone and four box fins, one flat sprite smoke puff per
  // frame that died in 0.7 s, and two flame sprites drawn THROUGH walls with
  // depthTest off). Now, the same profile as the round seated in the launcher
  // (weapons/appearances/bazooka.js CBZ.rpgRound): the 85 mm bulb, the ogive
  // nose, the slim sustainer tail, and four fins that SPRING OPEN in the first
  // 0.1 s. It leaves the tube on its booster (a kick of flame and a cloud at
  // the muzzle, the BACKBLAST out of the venturi behind the shooter), coasts,
  // and ~10 m out the sustainer lights: a flickering white-orange motor flare
  // and a dense smoke trail laid down BY DISTANCE (a fast rocket leaves no
  // gaps) that billows, drifts downwind and hangs for seconds. The body spins
  // and corkscrews slightly the way a spin-stabilised RPG does.
  // weapons/munitions.js's two pooled GPU point clouds carry every particle.
  // The round's shape, the smoke and the fire all come from ONE shared
  // system (weapons/munitions.js): the PG-7V and the 40 mm shell are its
  // cached geometries, every puff/flare rides its two pooled point clouds
  // (one draw call each, shared with every missile in the game).
  const MU = CBZ.munitions;
  const fxr = MU.rand;                        // cosmetic stream, never the gameplay rng
  const ROUND_LEN = MU.spec("pg7").L;         // fuze tip → nozzle, real 0.90 m
  const SHELL_LEN = MU.spec("g40").L;
  // a fin: a thin blade hinged at its root (local origin), length up +Y, chord +X.
  // PG-7V: four folding fins on the sustainer nozzle, ~105 mm long.
  const FIN_L = 0.105, FIN_C = 0.032;
  const finGeo = new THREE.BoxGeometry(FIN_C, FIN_L, 0.0035);
  finGeo.translate(FIN_C / 2, FIN_L / 2, 0);
  finGeo._shared = true;
  const finMat = new THREE.MeshLambertMaterial({ color: 0x2c3024 });
  const FIN_HINGE_Y = -0.86, FIN_HINGE_R = 0.0195, FIN_OPEN = 1.5708;
  const SUSTAIN_M = 500;                      // PG-7V sustainer burns out ~500 m downrange
  const rockets = [];
  // Pool of 6: the old pool of 3 round-robined onto ACTIVE slots — fire 4
  // rockets at long range (5 carried; a 450u shot flies ~4s) and the first
  // one's detonate closure was silently overwritten, so it never exploded.
  // 6 covers the grenade launcher's full drum in the air at once, and
  // launchRocket below now FLUSHES a still-active slot (detonating it where
  // it is) instead of eating it.
  for (let i = 0; i < 6; i++) {
    const root = new THREE.Group();         // flies the path; +Y is the travel direction
    const spin = new THREE.Group();         // rolls + corkscrews inside it
    root.add(spin);
    // munition geometry is nose +Z, centred: tip it onto +Y, nose at y=0
    const body = MU.build("pg7");
    body.rotation.x = -Math.PI / 2; body.position.y = -ROUND_LEN / 2;
    spin.add(body);
    const shell = MU.build("g40");
    shell.rotation.x = -Math.PI / 2; shell.position.y = -SHELL_LEN / 2;
    shell.visible = false;
    spin.add(shell);
    const fins = [];
    for (let f = 0; f < 4; f++) {
      const a = f * Math.PI * 0.5;
      const pivot = new THREE.Group();
      pivot.position.set(Math.cos(a) * FIN_HINGE_R, FIN_HINGE_Y, Math.sin(a) * FIN_HINGE_R);
      pivot.rotation.set(0, -a, 0);        // local +X points radially out
      pivot.add(new THREE.Mesh(finGeo, finMat));
      spin.add(pivot);
      fins.push(pivot);
    }
    root.visible = false;
    CBZ.scene.add(root);
    rockets.push({
      mesh: root, spin: spin, body: body, shell: shell, fins: fins, slot: i,
      flare: MU.claimFlares(2),                    // core + halo, rewritten per frame
      active: false, t: 0, dur: 0.3, plain: false,
      ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0,   // origin + impact point (straight-line endpoints)
      sagY: 0,                                     // peak mid-flight gravity sag (world units, visual only)
      detonate: null,                               // bound closure: () => runs the exact old detonation block
      homing: false, seek: null, speed: 0, turnRate: 0, life: 0, maxLife: 0, targetRadius: 2,
      velocity: new THREE.Vector3(), impactPoint: null, onImpact: null,
      age: 0, flown: 0, lit: false, spinA: 0,
      dir: new THREE.Vector3(0, 0, -1), lastEmit: new THREE.Vector3(),
    });
  }
  const smokePuff = MU.smoke, firePuff = MU.fire;

  // ---- launch: booster kick, muzzle cloud, backblast ------------------------
  const _bbDir = new THREE.Vector3(), _bbSide = new THREE.Vector3(), _bbUp = new THREE.Vector3(), _bbP = new THREE.Vector3();
  const _bbBack = new THREE.Vector3();
  function coneDir(axis, spread, out) {
    // a random direction within `spread` (radians-ish) of axis
    _bbSide.set(axis.z, 0, -axis.x);
    if (_bbSide.lengthSq() < 1e-6) _bbSide.set(1, 0, 0);
    _bbSide.normalize();
    _bbUp.crossVectors(_bbSide, axis).normalize();
    const a = fxr() * 6.283, r = Math.sqrt(fxr()) * spread;
    return out.copy(axis).addScaledVector(_bbSide, Math.cos(a) * r).addScaledVector(_bbUp, Math.sin(a) * r).normalize();
  }
  function launchFx(muzzle, dir, tail) {
    // BOOSTER KICK at the muzzle: a hard white-orange flash and a grey cloud
    // blown forward and out (the booster burns out inside the first metres)
    firePuff(muzzle.x + dir.x * 0.3, muzzle.y + dir.y * 0.3, muzzle.z + dir.z * 0.3, dir.x * 4, dir.y * 4, dir.z * 4, 0.9, 1.6, 0.07, 1, 1, 0.92, 0.7, { drag: 6, rise: 0, wind: 0, fadeIn: 0 });
    for (let i = 0; i < 4; i++) {
      coneDir(dir, 0.35, _bbDir);
      const v = 10 + fxr() * 12;
      firePuff(muzzle.x, muzzle.y, muzzle.z, _bbDir.x * v, _bbDir.y * v, _bbDir.z * v, 0.35, 0.9, 0.06 + fxr() * 0.05, 0.9, 1, 0.55 + fxr() * 0.2, 0.18, { drag: 9, rise: 0, wind: 0, fadeIn: 0 });
    }
    for (let i = 0; i < 9; i++) {
      coneDir(dir, 0.9, _bbDir);
      const v = 2 + fxr() * 5, sh = 0.62 + fxr() * 0.12;
      smokePuff(muzzle.x, muzzle.y, muzzle.z, _bbDir.x * v, _bbDir.y * v + 0.3, _bbDir.z * v, 0.35, 1.8 + fxr() * 1.2, 2.2 + fxr() * 1.6, 0.5, sh, sh, sh * 0.97, { drag: 2.4 });
    }
    // BACKBLAST: a cone of flame and a wall of dust out of the venturi, 2-4 m
    // behind the shooter. If a wall is right behind him it slaps back off it.
    if (!tail) return;
    const back = _bbBack.copy(dir).negate();
    const wall = wallDistance(tail, back, 3.2);
    const reach = wall && wall.distance < 3.2 ? Math.max(0.25, wall.distance - 0.15) : 3.4;
    for (let i = 0; i < 14; i++) {
      coneDir(back, 0.32, _bbDir);
      const d = fxr() * Math.min(reach, 2.4), v = 6 + fxr() * 14;
      firePuff(tail.x + _bbDir.x * d, tail.y + _bbDir.y * d, tail.z + _bbDir.z * d,
        _bbDir.x * v, _bbDir.y * v, _bbDir.z * v, 0.35 + d * 0.25, 1.1 + d * 0.5, 0.09 + fxr() * 0.12, 0.95,
        1, 0.45 + fxr() * 0.35, 0.12, { drag: 10, rise: 0.5, wind: 0, fadeIn: 0 });
    }
    for (let i = 0; i < 20; i++) {
      coneDir(back, 0.5, _bbDir);
      const d = fxr() * reach, v = 2 + fxr() * 7;
      // dust kicked off the ground reads warmer than the propellant smoke
      const dust = fxr() < 0.5, g0 = dust ? 0.56 + fxr() * 0.08 : 0.66 + fxr() * 0.1;
      smokePuff(tail.x + _bbDir.x * d, tail.y + _bbDir.y * d - (dust ? 0.4 : 0), tail.z + _bbDir.z * d,
        _bbDir.x * v, _bbDir.y * v + (dust ? 0.2 : 0.6), _bbDir.z * v, 0.5, 2.2 + fxr() * 1.8, 2.6 + fxr() * 2.2, dust ? 0.42 : 0.5,
        g0 * (dust ? 1.06 : 1), g0 * (dust ? 0.98 : 1), g0 * (dust ? 0.86 : 0.98), { drag: 2.2 });
    }
    if (wall && wall.distance < 2.2) {
      // the billow back off the wall: flame and dust spread along the face and
      // roll back toward (and around) the shooter
      const hp = wall.point || _bbP.copy(tail).addScaledVector(back, wall.distance);
      for (let i = 0; i < 12; i++) {
        coneDir(dir, 1.1, _bbDir);
        const v = 3 + fxr() * 5;
        smokePuff(hp.x, hp.y, hp.z, _bbDir.x * v, _bbDir.y * v + 0.4, _bbDir.z * v, 0.6, 2.4 + fxr() * 1.4, 2.2 + fxr() * 1.8, 0.52, 0.62, 0.6, 0.55, { drag: 2.6 });
      }
      for (let i = 0; i < 6; i++) {
        coneDir(dir, 1.2, _bbDir);
        const v = 4 + fxr() * 6;
        firePuff(hp.x, hp.y, hp.z, _bbDir.x * v, _bbDir.y * v, _bbDir.z * v, 0.5, 1.4, 0.1 + fxr() * 0.08, 0.8, 1, 0.5, 0.15, { drag: 9, rise: 0, wind: 0, fadeIn: 0 });
      }
    }
  }

  // ---- per-frame dressing of a flying round -----------------------------------
  const IGNITE_AT = 11;                       // m: the sustainer lights clear of the shooter (PG-7V: ~11 m)
  const _trTail = new THREE.Vector3(), _trSeg = new THREE.Vector3(), _trP = new THREE.Vector3();
  function burning(r) { return r.lit && r.flown < SUSTAIN_M; }
  function dressRocket(r, dt, stepLen) {
    r.age += dt;
    r.flown += stepLen;
    if (r.plain) return;
    // fins spring open in the first 0.1 s
    const fk = Math.min(1, r.age / 0.1), fo = 1 - (1 - fk) * (1 - fk);
    for (let f = 0; f < r.fins.length; f++) r.fins[f].rotation.z = -FIN_OPEN * fo;
    // spin + a slight corkscrew (the round is spin-stabilised, not a dart)
    r.spinA += dt * 6.283 * 4.5;
    r.spin.rotation.y = r.spinA;
    const wob = Math.min(1, r.flown / 12) * 0.035;
    r.spin.position.set(Math.cos(r.spinA * 0.5) * wob, 0, Math.sin(r.spinA * 0.5) * wob);
    // the tail, in world
    _trTail.copy(r.spin.position).setY(-ROUND_LEN);
    r.mesh.localToWorld(_trTail);
    if (!r.lit && r.flown >= IGNITE_AT) {
      r.lit = true;
      // ignition: a bright pop and a small knot of smoke where it caught
      firePuff(_trTail.x, _trTail.y, _trTail.z, 0, 0, 0, 0.5, 1.3, 0.08, 1, 1, 0.9, 0.6, { drag: 0, rise: 0, wind: 0, fadeIn: 0 });
      for (let i = 0; i < 4; i++) smokePuff(_trTail.x, _trTail.y, _trTail.z, (fxr() - 0.5) * 2, (fxr() - 0.5) * 2, (fxr() - 0.5) * 2, 0.3, 1.6, 2.5 + fxr() * 1.5, 0.5, 0.74, 0.73, 0.7);
    }
    // burnt out: the round coasts clean, no more trail
    if (r.lit && !burning(r)) { r.lastEmit.copy(_trTail); return; }
    // the trail, laid by distance from the last puff to the tail now
    _trSeg.copy(_trTail).sub(r.lastEmit);
    const segLen = _trSeg.length();
    const spacing = r.lit ? Math.min(2.2, 0.6 + r.flown * 0.008) : 1.4;   // dense by the shooter, thinner far out (the pool is capped)
    if (segLen >= spacing) {
      const n = Math.min(40, Math.floor(segLen / spacing));
      _trSeg.multiplyScalar(1 / segLen);
      for (let k = 1; k <= n; k++) {
        _trP.copy(r.lastEmit).addScaledVector(_trSeg, k * spacing);
        const j = (fxr() - 0.5) * 0.25;
        if (r.lit) {
          const sh = 0.70 + fxr() * 0.12;
          smokePuff(_trP.x + j, _trP.y + j * 0.5, _trP.z - j,
            -r.dir.x * 1.2 + (fxr() - 0.5) * 0.6, -r.dir.y * 1.2 + (fxr() - 0.5) * 0.5, -r.dir.z * 1.2 + (fxr() - 0.5) * 0.6,
            0.28, 1.7 + fxr() * 1.5, 3 + fxr() * 3, 0.55, sh, sh, sh * 0.97, { drag: 1.2, rise: 0.25 });
        } else {
          // the coast before ignition: a thin grey wisp off the spent booster
          smokePuff(_trP.x + j, _trP.y, _trP.z - j, 0, 0, 0, 0.18, 0.7, 1.2 + fxr() * 0.8, 0.3, 0.7, 0.7, 0.68, { drag: 1, rise: 0.15 });
        }
      }
      r.lastEmit.copy(_trP);
    }
  }
  // the motor flare: the round's two reserved additive slots, rewritten per frame
  function flareRocket(r) {
    if (!(r.active && !r.plain && burning(r))) { MU.flareOff(r.flare, 2); return; }
    _trTail.copy(r.spin.position).setY(-ROUND_LEN - 0.06);
    r.mesh.localToWorld(_trTail);
    MU.motorFlare(r.flare, _trTail.x, _trTail.y, _trTail.z, r.dir.x, r.dir.y, r.dir.z, 1.25);
  }

  // ---- the round on the launcher: gone when fired, back when reloaded ----------
  // Derived every frame from the ammo itself (rounds in the tube, and how far
  // the reload has run), so it cannot desync from the count. The fresh round
  // in the off hand, pushed into the muzzle, is the reload rig's carried part
  // (systems/gunhands.js CBZ.gunReload, style "rocket"): it seats at the same
  // p this shows the tube's round again.
  function rocketReloadP(i) {
    if (!(fps.reloading > 0) || reloadWeapon !== i) return -1;
    const w = WEAPONS[i];
    return Math.max(0, Math.min(1, 1 - fps.reloading / Math.max(0.05, w.reload || fps.reloading)));
  }
  function syncWarheads() {
    const rec = CBZ.gunReload && CBZ.gunReload.RECIPES.rocket;
    const SEAT = rec ? rec.seat : 0.84;
    for (let i = 0; i < weaponModels.length; i++) {
      const vmM = weaponModels[i], tpM = carriedModels[i];
      const wh = vmM && vmM.userData.warhead;
      if (!wh) continue;
      const seated = (fps.rounds[i] || 0) > 0 || rocketReloadP(i) >= SEAT;
      wh.visible = seated;
      if (tpM && tpM.userData.warhead) tpM.userData.warhead.visible = seated;
    }
  }

  // The venturi in WORLD space, for the backblast. Third person: the drawn
  // launcher's own venturi socket. First person the viewmodel is a
  // camera-space prop, so the real tube's end is reckoned from the round's
  // world muzzle back along the bore by the loaded length (~1.35 m).
  const _tailW = new THREE.Vector3();
  function rocketTailWorld(muzzle, dir) {
    const m = shoulderActive() ? carriedModels[fps.weapon] : null;
    if (m && m.userData.venturi && m.visible !== false) {
      m.updateWorldMatrix(true, false);
      return m.localToWorld(_tailW.copy(m.userData.venturi)).clone();
    }
    return _tailW.copy(muzzle).addScaledVector(dir, -1.45).clone();
  }

  // the old API name the frame loop calls: the launcher's round + the motor
  // flares (the clouds themselves are stepped by munitions.js at 52.3)
  function updateRocketSmoke(dt) {
    syncWarheads();
    for (let i = 0; i < rockets.length; i++) flareRocket(rockets[i]);
  }
  CBZ.rpgFxStats = function () { const s = MU.stats(); return { smoke: s.smoke, smokeCap: s.smokeCap, fire: s.fire, fireCap: s.fireCap }; };
  let rocketIdx = 0;
  // launch a projectile from `from`→`to` over `dur` seconds, sagging under
  // `sag` world-units of (visual) gravity at the midpoint, then call `onArrive`.
  function acquireHomingTarget(from, dir, spec) {
    const range = (spec && spec.lockRange) || 240;
    const cone = Math.cos((((spec && spec.lockConeDeg) || 18) * Math.PI) / 180);
    let best = null, bestScore = Infinity;
    if (CBZ.game.mode === "city" && CBZ.cityAircraftAcquireTarget) {
      const a = CBZ.cityAircraftAcquireTarget(from.x, from.y, from.z, dir.x, dir.y, dir.z, range, cone);
      if (a) { best = a; bestScore = (1 - a.dot) * 8 + a.distance / range * 0.08; }
    }
    // Passenger aircraft use the same live records that boarding and flight
    // consume. Include them in lock-on instead of inventing a target proxy.
    if (CBZ.game.mode === "city" && CBZ.cityCivilAircraftAcquireTarget) {
      const a = CBZ.cityCivilAircraftAcquireTarget(from.x, from.y, from.z, dir.x, dir.y, dir.z, range, cone);
      if (a) {
        let covered = false;
        const p = a.seek && a.seek();
        if (p) {
          _rocketWant.set(p.x - from.x, p.y - from.y, p.z - from.z);
          const d = _rocketWant.length();
          if (d > 1e-5) {
            _rocketWant.multiplyScalar(1 / d);
            const cover = wallDistance(from, _rocketWant, d);
            covered = !!(cover && cover.distance < d - 1.2);
          }
        }
        const score = (1 - a.dot) * 8 + a.distance / range * 0.08;
        if (!covered && score < bestScore) { best = a; bestScore = score; }
      }
    }
    const cars = CBZ.game.mode === "city" && CBZ.cityCars;
    if (cars) for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || c.dead || c.player || !c.pos || !c.group || (c.group.visible === false && !c._proxy)) continue;   // proxied = drawn instanced
      const dims = c.dims || {};
      const cy = (c.pos.y || 0) + (dims.height || 1.8) * 0.5;
      const dx = c.pos.x - from.x, dy = cy - from.y, dz = c.pos.z - from.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 5 || d > range) continue;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / d;
      if (dot < cone) continue;
      // Do not lock a car through a building; acquisition only runs once per
      // trigger pull, so this single raycast per plausible candidate is cheap.
      _rocketWant.set(dx / d, dy / d, dz / d);
      const cover = wallDistance(from, _rocketWant, d);
      if (cover && cover.distance < d - 1.2) continue;
      const score = (1 - dot) * 8 + d / range * 0.08;
      if (score >= bestScore) continue;
      const target = c;
      bestScore = score;
      best = {
        kind: "car", dot, distance: d,
        radius: Math.max(1.4, Math.min(3.0, (dims.length || 4.6) * 0.45)),
        seek: function () {
          if (!target || target.dead || !target.pos || !target.group || target.group.visible === false) return null;
          const td = target.dims || {};
          return { x: target.pos.x, y: (target.pos.y || 0) + (td.height || 1.8) * 0.5, z: target.pos.z };
        },
      };
    }
    return best;
  }

  function launchRocket(from, to, dur, sag, onArrive, opts) {
    opts = opts || {};
    // prefer a FREE slot; only steal an active one when all six are flying
    let r = null;
    for (let i = 0; i < rockets.length; i++) {
      const c = rockets[(rocketIdx + i) % rockets.length];
      if (!c.active) { r = c; rocketIdx = (rocketIdx + i + 1) % rockets.length; break; }
    }
    if (!r) {
      r = rockets[rocketIdx];
      rocketIdx = (rocketIdx + 1) % rockets.length;
      // never silently drop a live round's detonate — blow it where it is
      if (r.active) finishRocket(r, r.mesh.position, null);
    }
    r.active = true; r.t = 0; r.dur = Math.max(0.02, dur);
    r.ox = from.x; r.oy = from.y; r.oz = from.z;
    r.dx = to.x; r.dy = to.y; r.dz = to.z;
    r.sagY = sag;
    r.detonate = onArrive;
    r.homing = !!(opts.homing && opts.seek);
    r.seek = r.homing ? opts.seek : null;
    r.speed = opts.speed || 0;
    r.turnRate = opts.turnRate || 2.4;
    r.life = 0;
    r._owe = 0;                     // sustainer deficit ledger (softAuthority)
    r.maxLife = opts.maxLife || Math.max(3.2, r.dur + 2.0);
    r.targetRadius = opts.targetRadius || 2;
    r.impactPoint = opts.impactPoint || null;
    r.onImpact = typeof opts.onImpact === "function" ? opts.onImpact : null;
    // plain flight (grenade launcher): a launched 40 mm shell, not a burning
    // rocket — the short blunt shell instead of the PG-7V, no motor, no trail.
    const plain = !!opts.plain;
    r.plain = plain;
    r.body.visible = !plain;
    r.shell.visible = plain;
    for (let i = 0; i < r.fins.length; i++) { r.fins[i].visible = !plain; r.fins[i].rotation.z = 0; }   // folded in the tube
    r.age = 0; r.flown = 0; r.lit = false; r.spinA = 0;
    r.spin.position.set(0, 0, 0); r.spin.rotation.set(0, 0, 0);
    r.velocity.set(to.x - from.x, to.y - from.y, to.z - from.z);
    if (r.velocity.lengthSq() < 1e-6) r.velocity.set(0, 0, -1);
    r.dir.copy(r.velocity).normalize();
    r.velocity.normalize().multiplyScalar(r.speed || (from.distanceTo(to) / r.dur));
    r.mesh.position.copy(from);
    r.mesh.quaternion.setFromUnitVectors(UP, r.dir);
    r.mesh.visible = true;
    // the trail starts at the tail as it leaves the tube
    r.lastEmit.copy(from).addScaledVector(r.dir, -ROUND_LEN);
    if (!plain) launchFx(from, r.dir, opts.tail || null);
    return r;
  }
  // quadratic sag added to a straight-line lerp (peaks at the midpoint, zero
  // at both ends) — reads as gravity without a full ballistic re-solve, and
  // the rocket still ARRIVES exactly at the pre-resolved impact point.
  const _rocketPos = new THREE.Vector3(), _rocketPrev = new THREE.Vector3();
  const _rocketDir = new THREE.Vector3(), _rocketWant = new THREE.Vector3();
  function finishRocket(r, point, wallHit) {
    if (point && r.impactPoint && r.impactPoint.copy) r.impactPoint.copy(point);
    if (r.onImpact) { try { r.onImpact(point || r.mesh.position, wallHit || null); } catch (e) {} }
    r.active = false; r.mesh.visible = false;
    const fn = r.detonate;
    r.detonate = null; r.seek = null; r.onImpact = null; r.impactPoint = null; r.homing = false;
    if (fn) fn();
  }
  // SOFT LAUNCH (owner: "start kind of slow just at the very start, just so
  // you can see the rocket — beautiful and very satisfying"): the round
  // leaves the tube slow and eases to full authority. Homing rockets scale
  // their position advance AND turn authority together (a slow rocket must
  // not out-turn its own speed and orbit); ballistic rockets remap their arc
  // progress with a power curve — same arrival time, slow ignition, fast
  // cruise. Theater, not a nerf.
  if (CBZ.CONFIG.WEAPON_ROCKET_SOFTLAUNCH == null) CBZ.CONFIG.WEAPON_ROCKET_SOFTLAUNCH = true;
  // ROCKET PACE V2 (owner report, 2026-07-27: "i shoot the rpg and the
  // explosion looks amazing but it takes too long from after i shoot... i
  // wouldn't mind if it took realistically long but it's just too long").
  // MEASURED cause, not vibes: the original soft launch (35% authority for
  // 0.3s, full only by 0.7s) preserved arrival time on the BALLISTIC path
  // (progress remap, pow(k,1.55)) but on the HOMING path it scaled the real
  // position advance with NO repayment — every guided shot (both RPG ammo
  // types are homing:true, so the plane shot the owner filmed is always this
  // path) arrived ~326ms LATE over 30m: 642ms measured vs the 316ms the
  // speed constant promises. V2 keeps the owner's visible-launch beat but
  // makes it stop costing time, the way a real RPG-7 does (booster ejects at
  // ~115 m/s, sustainer accelerates to ~295 m/s — slow leave, HOT cruise):
  //   (a) the slow beat shrinks to the first ~0.22s (50% authority, still a
  //       clearly visible leave with the dense smoke trail),
  //   (b) the homing path REPAYS the ramp deficit with a sustainer burst (up
  //       to +100% cruise until the owed seconds are burned) — arrival now
  //       matches dist/speed to within one frame (30m: 279ms vs 263 ideal;
  //       60m: 529 vs 526; 100m: 879 vs 877 — integrated, not guessed),
  //   (c) all rocket speeds run ×1.2 (95→114 u/s standard — still well under
  //       a real RPG's sustained ~295 m/s, so the flight stays readable).
  // Flip false → the shipped 0.3/0.7/0.35 no-repay 95 u/s behaviour,
  // byte-identical. WEAPON_ROCKET_SOFTLAUNCH=false still kills the theater
  // entirely (both paths fly flat-out from the muzzle).
  if (CBZ.CONFIG.WEAPON_ROCKET_PACE_V2 == null) CBZ.CONFIG.WEAPON_ROCKET_PACE_V2 = true;
  function softOn() { return CBZ.CONFIG.WEAPON_ROCKET_SOFTLAUNCH !== false; }
  function paceOn() { return CBZ.CONFIG.WEAPON_ROCKET_PACE_V2 !== false; }
  function softT0() { return paceOn() ? 0.08 : 0.3; }
  function softT1() { return paceOn() ? 0.22 : 0.7; }
  function softK0() { return paceOn() ? 0.5 : 0.35; }
  const PACE_SPEED_MUL = 1.2;   // (c) above — applied once, in shoot()
  const SOFT_BOOST = 1.0;       // (b) max extra sustainer authority while repaying
  function softRamp(t) {
    const T0 = softT0(), T1 = softT1(), K0 = softK0();
    if (t <= T0) return K0;
    if (t >= T1) return 1;
    const u = (t - T0) / (T1 - T0);
    return K0 + (1 - K0) * u * u * (3 - 2 * u);
  }
  // Homing-path authority for this frame: the ramp while igniting, then >1
  // while the owed deficit is repaid (r._owe accumulates the seconds of
  // full-speed travel the ramp withheld). The ballistic path never calls
  // this — its power remap is arrival-preserving by construction.
  function softAuthority(r, dt) {
    if (!softOn()) return 1;
    const k = softRamp(r.life);
    if (k < 1) { r._owe = (r._owe || 0) + (1 - k) * dt; return k; }
    if (paceOn() && r._owe > 0 && dt > 0) {
      const b = Math.min(SOFT_BOOST, r._owe / dt);
      r._owe -= b * dt;
      return 1 + b;
    }
    return 1;
  }
  function updateRockets(dt) {
    for (let i = 0; i < rockets.length; i++) {
      const r = rockets[i];
      if (!r.active) continue;
      _rocketPrev.copy(r.mesh.position);
      if (r.homing) {
        r.t += dt; r.life += dt;
        // ONE authority sample per frame (it owns the deficit bookkeeping) —
        // position advance and turn authority must share it so a slow rocket
        // cannot out-turn its own speed, and a sustainer-hot one keeps its
        // turn radius.
        const auth = softAuthority(r, dt);
        const target = r.seek ? r.seek() : null;
        if (target) {
          _rocketDir.copy(r.velocity).normalize();
          _rocketWant.set(target.x - r.mesh.position.x, target.y - r.mesh.position.y, target.z - r.mesh.position.z);
          if (_rocketWant.lengthSq() > 1e-6) {
            _rocketWant.normalize();
            const dot = Math.max(-1, Math.min(1, _rocketDir.dot(_rocketWant)));
            const angle = Math.acos(dot), maxTurn = r.turnRate * dt * auth;
            if (angle <= maxTurn || angle < 1e-4) _rocketDir.copy(_rocketWant);
            else _rocketDir.lerp(_rocketWant, maxTurn / angle).normalize();
            r.velocity.copy(_rocketDir).multiplyScalar(r.speed);
          }
        }
        r.mesh.position.addScaledVector(r.velocity, dt * auth);
        _rocketPos.copy(r.mesh.position);
        _rocketDir.copy(_rocketPos).sub(_rocketPrev);
        const stepLen = _rocketDir.length();
        let wallHit = null, impact = null;
        if (stepLen > 1e-5) {
          _rocketDir.multiplyScalar(1 / stepLen);
          wallHit = wallDistance(_rocketPrev, _rocketDir, stepLen + 0.12);
          if (wallHit && wallHit.distance <= stepLen + 0.1) impact = wallHit.point;
        }
        const gy = CBZ.floorAt ? (+CBZ.floorAt(_rocketPos.x, _rocketPos.z) || 0) : 0;
        if (!impact && _rocketPos.y <= gy + 0.1) {
          _rocketPos.y = gy + 0.1; impact = _rocketPos; wallHit = null;
        }
        if (!impact && target) {
          const dx = target.x - _rocketPos.x, dy = target.y - _rocketPos.y, dz = target.z - _rocketPos.z;
          if (dx * dx + dy * dy + dz * dz <= Math.pow(r.targetRadius + Math.min(2, stepLen), 2)) impact = _rocketPos;
        }
        if (!impact && r.life >= r.maxLife) impact = _rocketPos;
        if (stepLen > 1e-6) { r.dir.copy(_rocketDir); r.mesh.quaternion.setFromUnitVectors(UP, _rocketDir); }
        dressRocket(r, dt, stepLen);   // fins, spin, ignition, the trail up to here
        if (impact) finishRocket(r, impact, wallHit);
        continue;
      }
      r.t += dt;
      const kLin = Math.min(1, r.t / r.dur);
      // power remap: slow start, same arrival (pow(1,x)=1) — the soft launch
      const k = softOn() ? Math.pow(kLin, 1.55) : kLin;
      const sag = r.sagY * 4 * k * (1 - k);
      _rocketPos.set(
        r.ox + (r.dx - r.ox) * k,
        r.oy + (r.dy - r.oy) * k - sag,
        r.oz + (r.dz - r.oz) * k
      );
      r.mesh.position.copy(_rocketPos);
      // orient along the instantaneous travel direction so the body+exhaust
      // glow visibly pitches through the arc instead of staying level.
      tmp.copy(_rocketPos).sub(_rocketPrev);
      const stepB = tmp.length();
      if (stepB > 1e-3) { tmp.multiplyScalar(1 / stepB); r.dir.copy(tmp); r.mesh.quaternion.setFromUnitVectors(UP, tmp); }
      dressRocket(r, dt, stepB);
      if (k >= 1) {
        finishRocket(r, _rocketPos, null);
      }
    }
  }

  // ---- LATENCY LEDGER (ratchet) ---------------------------------------------
  // The owner's "the explosion takes too long after i shoot" as a NUMBER
  // instead of a feeling. Per weapon, in ms, for a shot at `dist` (default
  // 30m ≈ the 100ft plane shot he filmed):
  //   pressToSpawnMs   — physical press → projectile/ray exists. Fire is
  //                      event-driven (mousedown → shoot() same JS turn, no
  //                      first-shot gate), so this is only the half-frame
  //                      mean wait for the same-frame render.
  //   spawnToImpactMs  — flight time, integrated with the LIVE softRamp/
  //                      softAuthority/pace math (not a copy), so any drift
  //                      in the constants moves this number. Homing-capable
  //                      weapons report the GUIDED path (the felt case — a
  //                      locked plane shot); hitscan reports 0; the sniper
  //                      reports its deliberate travel-feel defer.
  //   impactToVisibleMs— detonate/hit → first visible frame. cityExplosion
  //                      runs synchronously inside the arrival frame, and
  //                      with crashfx's FX_BLAST_FIRSTFRAME fix its flash is
  //                      ~93% bright on that same frame (half-frame render
  //                      alignment). Flag off restores the measured legacy
  //                      defect — the flash spawned at opacity 0 and
  //                      updatePuffs (onAlways 9.5) had already run before
  //                      the rocket updater (52), so the birth frame drew
  //                      NOTHING: one extra full frame, reported honestly.
  //   physicsMs        — dist/speed, the part that is real ballistics (KEEP).
  //   overheadMs       — spawnToImpactMs − physicsMs, the artificial part
  //                      (DELETE). THE RATCHET: with PACE_V2 on, the RPG's
  //                      guided overhead at 30m is ~16ms (one frame; was
  //                      ~326ms) and ~0 from 60m out. It may only ever go
  //                      DOWN.
  CBZ.weaponLatencyAudit = function (dist) {
    dist = dist || 30;
    const F = 1000 / 60, out = {};
    for (let i = 0; i < WEAPONS.length; i++) {
      const w = WEAPONS[i];
      let flight = 0, physics = 0;
      if (w.explosive) {
        const spec = (w.ammoTypes && w.ammoTypes[0]) || rocketAmmoSpec(w) || {};
        const mul = paceOn() ? PACE_SPEED_MUL : 1;
        const v = ((spec.homing && spec.speed) || w.projSpeed || 0) * mul;
        physics = v > 0 ? (dist / v) * 1000 : 0;
        if (spec.homing && v > 0) {
          // integrate the real homing authority curve (ramp + sustainer)
          const sim = { life: 0, _owe: 0 };
          let t = 0, d = 0; const step = 1 / 240;
          while (d < dist && t < 12) { sim.life += step; d += v * softAuthority(sim, step) * step; t += step; }
          flight = t * 1000;
        } else {
          flight = physics;   // ballistic: arrival is dist/speed by construction
        }
      } else if (ballisticRound(w)) {
        // a FLOWN bullet: time of flight is the integral of its own decaying
        // velocity, so physics and flight are the same number by construction
        // and the overhead row is zero. Nothing artificial is left in it.
        flight = physics = bulletFlightTime(w, dist) * 1000;
      }
      const visMs = F / 2 + (CBZ.CONFIG.FX_BLAST_FIRSTFRAME === false && w.explosive ? F : 0);
      out[w.id] = {
        pressToSpawnMs: Math.round(F / 2),
        spawnToImpactMs: Math.round(flight),
        impactToVisibleMs: Math.round(visMs),
        physicsMs: Math.round(physics),
        overheadMs: Math.round(Math.max(0, flight - physics)),
        totalMs: Math.round(F / 2 + flight + visMs),
      };
    }
    // vehicle ordnance (F-22 / gunship / tank / car pods — city/aircraft.js's
    // one shared pool): constant-velocity flight, speed read LIVE off
    // cityMissileTuning so AIR_MISSILE_PACE_V2 moves this row. The 0.35s
    // seeker-arm delay is steering-only (the round is already flying) and
    // therefore adds no flight time.
    const mt = CBZ.cityMissileTuning;
    if (mt && mt.speed > 0) {
      const vm = (dist / mt.speed) * 1000;
      out["vehicle-missile"] = {
        pressToSpawnMs: Math.round(F / 2),
        spawnToImpactMs: Math.round(vm),
        impactToVisibleMs: Math.round(F / 2),
        physicsMs: Math.round(vm),
        overheadMs: 0,
        totalMs: Math.round(F + vm),
      };
    }
    return out;
  };


  // ---- impact puff pool ----
  function radialTexture(stops) {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(32, 32, 1, 32, 32, 30);
    stops.forEach((s) => g.addColorStop(s[0], s[1]));
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  const sparkTex = radialTexture([
    [0, "rgba(255,255,235,1)"], [0.35, "rgba(255,178,74,.88)"], [1, "rgba(90,90,90,0)"],
  ]);
  const dustTex = radialTexture([
    [0, "rgba(215,40,34,.95)"], [0.45, "rgba(125,10,10,.75)"], [1, "rgba(80,0,0,0)"],
  ]);
  const impacts = [];
  let impactIdx = 0;
  for (let i = 0; i < 18; i++) {
    const mesh = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sparkTex, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    }));
    mesh.visible = false;
    CBZ.scene.add(mesh);
    impacts.push({ mesh, life: 0, max: 0.14 });
  }

  /* What a round actually hit: the struck mesh, its material (the face's own
     slot of a multi-material mesh), and its colour AT the hit (the face's
     vertex colour times the material colour, since merged city facades are
     white materials painted per vertex). Feeds CBZ.bulletImpact so the chips
     are made of the wall. */
  const _surfC = new THREE.Color();
  function surfaceAt(wh) {
    const out = { material: null, object: null, color: undefined };
    const o = wh && wh.object;
    if (!o || !o.material) return out;
    let m = o.material;
    if (Array.isArray(m)) m = m[(wh.face && wh.face.materialIndex) || 0] || m[0];
    out.material = m; out.object = o;
    if (m && m.color) {
      _surfC.copy(m.color);
      const ca = o.geometry && o.geometry.attributes && o.geometry.attributes.color;
      if (m.vertexColors && ca && wh.face) {
        const f = wh.face;
        _surfC.r *= (ca.getX(f.a) + ca.getX(f.b) + ca.getX(f.c)) / 3;
        _surfC.g *= (ca.getY(f.a) + ca.getY(f.b) + ca.getY(f.c)) / 3;
        _surfC.b *= (ca.getZ(f.a) + ca.getZ(f.b) + ca.getZ(f.c)) / 3;
      }
      if (o.isInstancedMesh && o.instanceColor && wh.instanceId != null) {
        const ic = o.instanceColor;
        _surfC.r *= ic.getX(wh.instanceId); _surfC.g *= ic.getY(wh.instanceId); _surfC.b *= ic.getZ(wh.instanceId);
      }
      // a textured face's colour is in its texture, not its (white) tint:
      // leave it to debris.js to colour the chips by material kind
      if (!(m.map && !(m.vertexColors && ca))) out.color = _surfC.getHex();
    }
    return out;
  }

  function spawnImpact(pos, blood, big, power) {
    const p = impacts[impactIdx];
    impactIdx = (impactIdx + 1) % impacts.length;
    p.mesh.material.map = blood ? dustTex : sparkTex;
    p.mesh.material.blending = blood ? THREE.NormalBlending : THREE.AdditiveBlending;
    p.mesh.position.copy(pos);
    const k = Math.max(0.55, Math.min(1.7, power == null ? 1 : power));
    p.mesh.scale.setScalar((big ? 0.92 : 0.5) * k);
    p.mesh.material.opacity = 1;
    p.mesh.visible = true;
    p.life = blood ? 0.18 : 0.12;
    p.max = p.life;
  }

  // ---- casing pool ----
  const casingGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.085, 8);
  const casings = [];
  let casingIdx = 0;
  for (let i = 0; i < 28; i++) {
    const mesh = new THREE.Mesh(casingGeo, brass);
    mesh.visible = false;
    CBZ.scene.add(mesh);
    casings.push({ mesh, vel: new THREE.Vector3(), life: 0 });
  }

  function ejectCasing(w) {
    aimForward(fwd); buildBasis(fwd);
    const c = casings[casingIdx];
    casingIdx = (casingIdx + 1) % casings.length;
    c.mesh.material = w.key === "shotgun" ? redShell : brass;
    c.mesh.scale.setScalar(w.key === "shotgun" ? 1.45 : 1);
    c.mesh.position.copy(muzzleWorld(tmp2))
      .addScaledVector(right, 0.18)
      .addScaledVector(aimUp, -0.16)
      .addScaledVector(fwd, -0.08);
    c.vel.copy(right).multiplyScalar(2.4 + rng() * 1.2)
      .addScaledVector(aimUp, 1.0 + rng() * 0.9)
      .addScaledVector(fwd, -0.25 + rng() * 0.25);
    c.mesh.rotation.set(rng() * 4, rng() * 4, rng() * 4);
    c.mesh.visible = true;
    c.life = 1.5;
    if (CBZ.sfx && w.key !== "carbine") setTimeout(() => CBZ.sfx("shell"), 90 + rng() * 80);
  }

  // ---- DEATH DROP: the gun leaves your hands when you die -------------------
  // WHY: dying with the viewmodel welded to the lens (and the carried gun still
  // posed in the corpse's grip) reads fake — a body lets go. On death the
  // first-person gun pitches forward, drops and yaws out of frame (~0.5s,
  // TRANSFORM-ONLY on the `gun` group: the depth-clear sentinel + transparent
  // material setup are untouched), and a cosmetic world mesh of the same
  // weapon tumbles from the body and lies beside it. Purely visual: inventory
  // and ammo survive the respawn and NPCs can't loot it (it's not a cityDrop).
  let ddT = -1;                        // >=0 while the viewmodel tumble plays
  const DD_DUR = 0.5;
  let dropMesh = null, dropBody = null, dropVx = 0, dropVy = 0, dropVz = 0,
    dropSx = 0, dropSy = 0, dropSz = 0, dropLife = 0, dropLanded = false;
  function clearWorldDrop() {
    if (!dropMesh) return;
    if (dropBody && CBZ.weaponPhysics && CBZ.weaponPhysics.release) CBZ.weaponPhysics.release(dropBody);
    if (dropMesh.parent) dropMesh.parent.remove(dropMesh);
    dropMesh.traverse((o) => {
      if (o.geometry && o.geometry.dispose && !o.geometry._shared) o.geometry.dispose();
    });   // actorweapons geometries + materials are shared — never dispose them
    dropMesh = null; dropBody = null;
  }
  function spawnWorldDrop(w) {
    clearWorldDrop();
    if (!CBZ.scene || !CBZ.player || !CBZ.player.pos) return;
    const p = CBZ.player.pos;
    dropMesh = buildWeaponModel(w);
    dropMesh.scale.setScalar(1.05);
    const a = rng() * 6.28;
    dropMesh.position.set(p.x + Math.cos(a) * 0.3, p.y + 1.35, p.z + Math.sin(a) * 0.3);   // out of the dying grip, hand-high
    dropMesh.rotation.set(rng() * 6.28, rng() * 6.28, 0);
    CBZ.scene.add(dropMesh);
    dropVx = Math.cos(a) * (1.2 + rng() * 1.2);
    dropVz = Math.sin(a) * (1.2 + rng() * 1.2);
    dropVy = 2.0 + rng() * 1.2;
    dropSx = (rng() - 0.5) * 14; dropSy = (rng() - 0.5) * 10; dropSz = (rng() - 0.5) * 14;
    dropLife = 30; dropLanded = false;
    if (CBZ.weaponPhysics && CBZ.weaponPhysics.drop) {
      dropBody = CBZ.weaponPhysics.drop(dropMesh, {
        source: "fps-death", sound: "shell",
        vx: dropVx, vy: dropVy, vz: dropVz,
        wx: dropSx, wy: dropSy, wz: dropSz,
      });
    }
  }
  // called by city/death.js the frame you die; returns true when the
  // first-person tumble plays (death.js holds the orbit cam a beat for it)
  CBZ.fpsDeathDrop = function () {
    if (!armed()) return false;
    // City Inventory V2 creates the REAL lootable gun(s) at this same death
    // choke point. Do not add a second cosmetic duplicate beside them. Other
    // modes retain this view-owned world prop, now on the shared weapon body.
    const realCityDrop = CBZ.game && CBZ.game.mode === "city" &&
      (!CBZ.CONFIG || CBZ.CONFIG.INVENTORY_V2 !== false) &&
      typeof CBZ.cityDropItem === "function";
    if (!realCityDrop) spawnWorldDrop(weapon());
    carriedGun.visible = false;        // third person: nothing left in the grip
    if (!fps.active) return false;
    ddT = 0;                           // first person: the viewmodel tumbles away
    return true;
  };
  // respawn / mode reset: cancel the tumble, restore the gun group, clear the prop
  CBZ.fpsDeathDropReset = function () {
    if (ddT >= 0) { ddT = -1; gun.position.set(0, 0, 0); gun.rotation.set(0, 0, 0); vm.visible = fps.active && !cuffedHands(); }
    clearWorldDrop();
  };

  // The model socket is the source of truth. Previous camera-space component
  // clamps could silently relocate a perfectly valid socket, so the flash stayed
  // on the barrel while the bullet began beside it. Keep only a catastrophic-rig
  // fallback; every healthy shot leaves the exact rendered front tip.
  const _muzM = new THREE.Matrix4();
  function clampMuzzleBelowEye(out) {
    const cam = CBZ.camera; if (!cam) return out;
    if (cam.updateWorldMatrix) cam.updateWorldMatrix(true, false);
    const e = _muzM.extractRotation(cam.matrixWorld).elements;
    const rx = e[0], ry = e[1], rz = e[2], ux = e[4], uy = e[5], uz = e[6], fx = -e[8], fy = -e[9], fz = -e[10];
    const dx = out.x - cam.position.x, dy = out.y - cam.position.y, dz = out.z - cam.position.z;
    const f = dx * fx + dy * fy + dz * fz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (Number.isFinite(d2) && d2 > 0.02 && d2 < 36 && f > 0.08) return out;
    return out.set(cam.position.x, cam.position.y, cam.position.z)
      .addScaledVector({ x: rx, y: ry, z: rz }, 0.18)
      .addScaledVector({ x: ux, y: uy, z: uz }, -0.34)
      .addScaledVector({ x: fx, y: fy, z: fz }, 0.5);
  }

  // THIRD-PERSON (shoulder cam) clamp: the camera-space box above is wrong out
  // here — the lens hangs 5–16m BEHIND the player (camera.js zoom clamp), so
  // "0.45–3.2m in front of the lens, just under its eye-line" is a point in
  // mid-air behind the character that projects EXACTLY onto his head on screen.
  // That's the filmed bug: every clamped round poured from the skull. From the
  // shoulder the truth anchor is the GUN HAND — bound the origin to a sphere of
  // THIS gun's barrel length (+slack) around the carried-gun root. A healthy
  // pose sits exactly at barrel length, so this is a pure safety net (no-op
  // every normal frame) that catches degenerate rigs/unparented guns instead of
  // ever relocating the stream. Rounds pour from the muzzle, tap or mag-dump.
  const _handPos = new THREE.Vector3();
  function clampMuzzleToHand(out, model) {
    carriedGun.getWorldPosition(_handPos);   // r128: refreshes parent matrices itself
    const sc = (model.scale && model.scale.x) || 1;
    const r = model.userData.muzzle.length() * sc * 2.5 + 1.0;
    const d = out.distanceTo(_handPos);
    if (!Number.isFinite(d) || d > r) {
      aimForward(fwd);
      out.copy(_handPos).addScaledVector(fwd, Math.min(2.2, model.userData.muzzle.length() * sc));
    }
    return out;
  }

  function muzzleWorld(out) {
    if (shoulderActive()) {
      const model = carriedModels[fps.weapon];
      if (model && model.userData.muzzle) {
        attachCarriedGun();
        // A shot can happen between render frames. Force every parent transform
        // current before converting the barrel socket, otherwise stale hand/rig
        // matrices make tracers appear to leave the player's chest.
        if (model.updateWorldMatrix) model.updateWorldMatrix(true, false);
        else {
          if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.updateMatrixWorld(true);
          model.updateMatrixWorld(true);
        }
        // hand-anchored clamp (NOT the camera box — see clampMuzzleToHand)
        return clampMuzzleToHand(model.localToWorld(out.copy(model.userData.muzzle)), model);
      }
    }
    if (fps.active) {
      const model = weaponModels[fps.weapon];
      if (model && model.userData.muzzle) {
        // The viewmodel is parented camera -> vm -> gun -> model. Updating only
        // the leaf can leave vm/gun stale on the input event, which visually
        // launches the tracer from the camera/face instead of the barrel.
        if (model.updateWorldMatrix) model.updateWorldMatrix(true, false);
        else {
          if (CBZ.camera) CBZ.camera.updateMatrixWorld(true);
          model.updateMatrixWorld(true);
        }
        return clampMuzzleBelowEye(model.localToWorld(out.copy(model.userData.muzzle)));
      }
    }
    // last-resort fallback: drop it to GUN height/forward (down + out from the
    // eye) so a tracer never visibly streaks out of the player's head. From the
    // shoulder cam the lens is metres BEHIND the player (a tracer from there
    // would streak THROUGH the body), so anchor at the gun-side chest instead.
    aimForward(fwd); buildBasis(fwd);
    if (shoulderActive() && CBZ.player && CBZ.player.pos) {
      const pp = CBZ.player.pos;
      return out.set(pp.x, pp.y + 1.45, pp.z)
        .addScaledVector(right, 0.24)
        .addScaledVector(fwd, 0.5);
    }
    return out.copy(CBZ.camera.position)
      .addScaledVector(right, 0.18)
      .addScaledVector(aimUp, -0.34)
      .addScaledVector(fwd, 0.5);
  }

  function setMuzzleSpriteFromModel(sprite, model) {
    if (!model || !model.userData.muzzle) return false;
    if (model.updateWorldMatrix) model.updateWorldMatrix(true, false);
    else {
      if (CBZ.camera) CBZ.camera.updateMatrixWorld(true);
      model.updateMatrixWorld(true);
    }
    if (gun.updateWorldMatrix) gun.updateWorldMatrix(true, false);
    else gun.updateMatrixWorld(true);
    model.localToWorld(tmpMuzzle.copy(model.userData.muzzle));
    gun.worldToLocal(tmpMuzzle);
    sprite.position.copy(tmpMuzzle);
    return true;
  }

  function aimForward(out) {
    // out of a car window the camera IS the aim (the car's own attitude is
    // composed into it by city/view.js); cam.yaw/fps.fp know nothing of that
    if (carGun() && CBZ.camera) return out.set(0, 0, -1).applyQuaternion(CBZ.camera.quaternion).normalize();
    if (shoulderActive()) {
      // PINNED THIRD-PERSON FRAME (systems/camera.js, CAM_TP_FIXED_ANGLE): the
      // lens is held at the rig's resting angle on purpose, so it is no longer
      // the aim — reading it here would nail every round, the acquire cone and
      // the reticle to that one angle and the gun could not be raised at all.
      // Take the aim off the input the player is actually moving. Sign: in
      // third person a POSITIVE cam.pitch is the camera above looking DOWN
      // (the orbit is `oy = sin(pitch)·dist`), which is the opposite of the
      // first-person fps.fp convention `forward()` uses two lines down — hence
      // the -sin here and the +sin there. Degrades to the lens when the flag is
      // off, when the frame is free (aiming down sights), or in any build where
      // camera.js predates the hook.
      if (CBZ.camAimDecoupled && CBZ.camAimDecoupled() && CBZ.cam) {
        const y = CBZ.cam.yaw || 0, p = CBZ.cam.pitch || 0, cp = Math.cos(p);
        return out.set(-Math.sin(y) * cp, -Math.sin(p), -Math.cos(y) * cp).normalize();
      }
      return CBZ.camera.getWorldDirection(out).normalize();
    }
    return forward(out);
  }

  // Recoil now moves the visible view, so a bullet never receives an invisible
  // second aim offset. The reticle, lens and round always agree.
  function aimWithRecoil(out) {
    return aimForward(out);
  }

  // ---- HUD ----
  /* THE RETICLE NODE IS RESOLVED FRESH, NOT CACHED FOR THE PAGE'S LIFETIME.

     OWNER (2026-09-01): "warlord during a battle should have a crosshair ...
     failing at the req lol."

     These were `const el = document.getElementById(...)` evaluated ONCE, at
     module load, which is true exactly as long as nobody ever replaces the
     element. warlord/gunplay.js does: it builds #wgpHud (containing its own
     #crosshair and #ammo) on mount and REMOVES the whole wrapper on unmount,
     so every battle after the first hands the page a brand-new node while
     this file goes on styling the detached one. display:"block" lands on an
     orphan, `_crossShown` is updated to say it worked, and the player gets no
     reticle for the rest of the session. #ammo and #hitMarker (inserted
     relative to #crosshair) go the same way.

     A detached node still answers every property you ask it, which is why this
     failed silently for the whole battle rather than throwing once. `isConnected`
     is the cheap question that catches it: one property read per frame in the
     common case, and a re-query only after somebody swapped the DOM out. */
  let _crossEl = null, _ammoEl = null;
  function crossEl() {
    if (!_crossEl || !_crossEl.isConnected) _crossEl = document.getElementById("crosshair");
    return _crossEl;
  }
  function ammoHudEl() {
    if (!_ammoEl || !_ammoEl.isConnected) _ammoEl = document.getElementById("ammo");
    return _ammoEl;
  }
  const stripEl = document.getElementById("weaponStrip");
  // One reticle element serves both camera modes. Keep the cached visibility
  // beside the element so setActive() can invalidate/update it when V toggles
  // between first person and the third-person shoulder owner.
  let _crossShown = null;
  const reticleState = { blocked: false, target: "", x: 50, y: 50, conePx: 16 };
  CBZ.fpsReticleState = function () {
    return { blocked: reticleState.blocked, target: reticleState.target, x: reticleState.x, y: reticleState.y, conePx: reticleState.conePx };
  };

  function reticleHitIdentity(hit) {
    if (!hit) return null;
    return hit.actor || hit.corpse || hit.car || hit.civilAircraft || (hit.aircraft ? "response-aircraft" : null) ||
      (hit.wallHit && hit.wallHit.object) || null;
  }
  function reticleHitKind(hit) {
    if (!hit) return "";
    if (hit.actor) return "person";
    if (hit.corpse) return "body";
    if (hit.car) return "vehicle";
    if (hit.civilAircraft) return "aircraft";
    if (hit.aircraft) return "aircraft";
    if (hit.wall) return "surface";
    return "";
  }
  function reticleDamageable(hit) {
    return !!(hit && (hit.actor || hit.corpse || hit.car || hit.civilAircraft || hit.aircraft));
  }

  // ---- HIT MARKER ----------------------------------------------------------
  // Built entirely in JS (no index.html/CSS edits): four angled ticks that
  // splay out around the crosshair on a connecting shot (GTA/CoD feel). A plain
  // hit is a white flash; a KILL turns the marker red and spins it slightly
  // into an X (the GTA "you got 'em" tell); a headshot adds a sharper snap.
  const hitMarker = (function () {
    const wrap = document.createElement("div");
    wrap.id = "hitMarker";
    wrap.style.cssText =
      "position:absolute;left:50%;top:50%;width:34px;height:34px;" +
      "transform:translate(-50%,-50%);pointer-events:none;display:none;" +
      "opacity:0;z-index:30;will-change:transform,opacity;";
    // four ticks, each a short bar pointing diagonally out from centre
    const ticks = [];
    const angles = [45, 135, 225, 315];
    for (let i = 0; i < 4; i++) {
      const t = document.createElement("div");
      t.style.cssText =
        "position:absolute;left:50%;top:50%;width:2.2px;height:9px;" +
        "background:#fff;border-radius:1px;box-shadow:0 0 3px rgba(0,0,0,.85);" +
        "transform-origin:50% 50%;";
      wrap.appendChild(t);
      ticks.push(t);
    }
    function placeTicks(spread) {
      for (let i = 0; i < 4; i++) {
        const a = angles[i] * Math.PI / 180;
        const dx = Math.cos(a) * spread, dy = Math.sin(a) * spread;
        ticks[i].style.transform =
          "translate(-50%,-50%) translate(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px) rotate(" + (angles[i]) + "deg)";
      }
    }
    const cross = crossEl();
    if (cross && cross.parentNode) cross.parentNode.insertBefore(wrap, cross.nextSibling);
    else document.body.appendChild(wrap);
    return { wrap, ticks, placeTicks };
  })();
  let hitMarkerT = 0, hitMarkerDur = 0.001, hitMarkerKill = false;

  function flashHitMarker(kill, head) {
    const col = kill ? "#ff3b30" : (head ? "#fff0b0" : "#ffffff");
    for (let i = 0; i < hitMarker.ticks.length; i++) {
      hitMarker.ticks[i].style.background = col;
      hitMarker.ticks[i].style.height = (kill ? 11 : head ? 10 : 8.5).toFixed(1) + "px";
    }
    hitMarkerKill = !!kill;
    hitMarkerDur = kill ? 0.42 : 0.18;
    hitMarkerT = hitMarkerDur;
    const cross = crossEl();
    if (cross) {
      hitMarker.wrap.style.left = cross.style.left || "50%";
      hitMarker.wrap.style.top = cross.style.top || "50%";
    }
    hitMarker.wrap.style.display = "block";
    hitMarker.wrap.style.opacity = "1";
  }
  CBZ.fpsHitMarker = flashHitMarker;

  /* ============================================================
     THE AMMO GAUGE — the one ammo readout every game draws (the prison, the
     city, gun game, survival, the battles). Owner: "the ammo counter is in a
     bad spot and looks boring." It was a line of text ("12 / 60", a reload
     arrow on top) floating at right:22 bottom:210, mid-air over the world,
     and the city drew a SECOND one of its own under its slot bar (#cAmmo,
     city/hud.js, now deleted).

     WHAT IT IS (no words, ever):
       · the magazine as a big numeral, what you carry as a small one beside
         it, behind a hairline;
       · a row of rounds under them that empties as you fire (one pip per
         round up to PIP_MAX; a belt or a drum is one bar that drains);
       · LOW (the last quarter): amber, and the numeral breathes; DRY: red;
       · RELOAD: the pips fill back in on the reload animation's own clock,
         from the moment the fresh magazine is in the hand to the moment it
         seats (CBZ.gunReload's recipe grab -> seat; a shell gun fills one
         pip per shell), and the numeral counts up with them;
       · the held gun's own render, as a quiet white silhouette (the same
         cached picture the hotbar draws, so it costs nothing).
     WHERE: bottom-right on a desktop (the shooter's corner; the hotbar is
     bottom-centre, the radar left); raised over the campaign phone and over
     the car cluster when you shoot from a car. On touch the thumbs own both
     bottom corners, so it sits centred just above the hotbar, and on a
     portrait phone in the right column under the radar (top:200, the slot
     systems/runstats.js reserves for it). Shown only while a gun is in the
     hands. The CSS lives here, so every page that mounts fpsmode (index,
     disaster, the warlord battles) gets the same gauge.
     ============================================================ */
  const PIP_MAX = 40;
  const AG_CSS =
    "#ammo.ag{position:fixed;left:auto;top:auto;right:calc(24px + env(safe-area-inset-right,0px));" +
      "bottom:calc(22px + env(safe-area-inset-bottom,0px));transform:none;flex-direction:column;align-items:flex-end;gap:5px;" +
      "pointer-events:none;z-index:14;white-space:normal;letter-spacing:0;line-height:1;text-align:right;font-family:inherit;" +
      "font-size:16px;font-weight:700;color:#eef2f6;text-shadow:0 1px 3px rgba(0,0,0,.75);transition:opacity .3s;" +
      "--ag-ink:#eef2f6;--ag-dim:rgba(238,242,246,.55);--ag-off:rgba(238,242,246,.17);--ag-hot:#eef2f6}" +
    "#ammo.ag .agRow{display:flex;align-items:flex-end;gap:10px}" +
    "#ammo.ag .agGun{display:block;height:22px;width:auto;max-width:76px;object-fit:contain;margin-bottom:6px;" +
      "filter:brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0,0,0,.6));opacity:.4}" +
    "#ammo.ag .agGun[hidden]{display:none}" +
    "#ammo.ag .agLock{font-size:15px;color:var(--ag-dim);margin-bottom:8px}" +
    "#ammo.ag .agLock[hidden]{display:none}" +
    "#ammo.ag .agMag{font-size:40px;font-weight:700;color:var(--ag-hot);font-variant-numeric:tabular-nums;text-align:right}" +
    "#ammo.ag .agRes{font-size:17px;font-weight:600;color:var(--ag-dim);font-variant-numeric:tabular-nums;" +
      "padding:0 0 5px 10px;border-left:1.5px solid rgba(238,242,246,.26)}" +
    "#ammo.ag .agPips{display:flex;justify-content:flex-end;gap:2px;height:9px}" +
    "#ammo.ag .agPip{flex:1 1 0;min-width:2px;max-width:9px;border-radius:1.5px;background:var(--ag-off)}" +
    "#ammo.ag .agPip.on{background:var(--ag-hot);box-shadow:0 0 2px rgba(0,0,0,.55)}" +
    "#ammo.ag .agPip.nx{background:linear-gradient(to top,var(--ag-fill) 0 calc(var(--f,0) * 100%),var(--ag-off) 0)}" +
    "#ammo.ag .agBar{position:relative;height:7px;border-radius:3.5px;background:var(--ag-off);overflow:hidden}" +
    "#ammo.ag .agFill{position:absolute;left:0;top:0;bottom:0;width:100%;transform-origin:100% 50%;background:var(--ag-hot)}" +
    // the last quarter: amber, and the numeral breathes
    "#ammo.ag.low{--ag-hot:#ffb547}" +
    "#ammo.ag.dry{--ag-hot:#ff5d52}" +
    "#ammo.ag.dry .agRes{color:rgba(255,93,82,.75)}" +
    "#ammo.ag.low .agMag,#ammo.ag.dry .agMag{animation:agBreath 1.1s ease-in-out infinite}" +
    "@keyframes agBreath{0%,100%{opacity:1}50%{opacity:.5}}" +
    // reloading: the rounds coming in are a cooler white
    "#ammo.ag.rl{--ag-hot:#eef2f6;--ag-fill:#bfe2ff}" +
    "#ammo.ag.rl .agMag{opacity:.82;animation:none}" +
    "#ammo.ag.rl .agPip.in{background:var(--ag-fill)}" +
    "@media (prefers-reduced-motion:reduce){#ammo.ag .agMag{animation:none!important}}" +
    // over the campaign phone (bottom-right, 45px) and the car cluster
    "body.campaign-active:not(.touch) #ammo.ag{bottom:calc(78px + env(safe-area-inset-bottom,0px))}" +
    "#ammo.ag.car{bottom:calc(214px + env(safe-area-inset-bottom,0px))}" +
    // a narrow desktop window: a long hotbar can reach the corner, so stand on it
    "@media (max-width:1000px){body:not(.touch) #ammo.ag{bottom:calc(86px + env(safe-area-inset-bottom,0px))}}" +
    // TOUCH: both bottom corners are thumbs. Centred, just above the hotbar.
    "body.touch #ammo.ag{right:auto;left:50%;transform:translateX(-50%);align-items:center;gap:4px;" +
      "bottom:calc(84px + env(safe-area-inset-bottom,0px))}" +
    "body.touch #ammo.ag .agGun{display:none}" +
    "body.touch #ammo.ag .agMag{font-size:28px}" +
    "body.touch #ammo.ag .agRes{font-size:14px;padding-bottom:3px}" +
    "body.touch #ammo.ag .agPips{height:7px}" +
    "body.touch #ammo.ag.car{bottom:auto;top:calc(200px + env(safe-area-inset-top,0px))}" +
    // a portrait phone: the joystick ring reaches the middle; the right column is clear
    "@media (orientation:portrait) and (max-width:560px){body.touch #ammo.ag{left:auto;transform:none;align-items:flex-end;" +
      "right:calc(18px + env(safe-area-inset-right,0px));bottom:auto;top:calc(200px + env(safe-area-inset-top,0px))}}";

  function agEnsureStyle() {
    if (document.getElementById("ammoGaugeStyle")) return;
    const s = document.createElement("style");
    s.id = "ammoGaugeStyle";
    s.textContent = AG_CSS;
    (document.head || document.body).appendChild(s);
  }
  function agMake(tag, cls, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }
  // build the gauge into #ammo once (an element warlord/gunplay swapped in gets its own)
  function agOf(el) {
    if (el._ag) return el._ag;
    agEnsureStyle();
    el.textContent = "";
    el.classList.add("ag");
    const row = agMake("div", "agRow", el);
    const gun = agMake("img", "agGun", row);
    gun.alt = ""; gun.hidden = true;
    const lock = agMake("span", "agLock", row);
    lock.textContent = "◎"; lock.hidden = true;
    const mag = agMake("span", "agMag", row);
    const res = agMake("span", "agRes", row);
    const pips = agMake("div", "agPips", el);
    el._ag = { gun, lock, mag, res, pips, gunId: null, cap: -1, bar: null, fill: null, pipEls: [],
      magTxt: "", resTxt: "", cls: "", lit: -1, inTo: -1, nxF: -1, fillK: -1 };
    return el._ag;
  }
  function agSetCap(G, cap) {
    if (G.cap === cap) return;
    G.cap = cap;
    G.pips.textContent = ""; G.pipEls.length = 0; G.bar = G.fill = null;
    G.lit = -1; G.inTo = -1; G.nxF = -1; G.fillK = -1;
    if (cap > PIP_MAX) {
      G.pips.style.width = "";
      G.bar = agMake("div", "agBar", G.pips);
      G.bar.style.width = "150px";
      G.fill = agMake("div", "agFill", G.bar);
    } else if (cap > 0) {
      // one pip per round, the row as wide as the magazine is deep: a shotgun's
      // six are fat shells, a rifle's thirty are thin cartridges
      const each = cap <= 8 ? 11 : cap <= 20 ? 7.5 : 4.4;
      G.pips.style.width = Math.min(160, Math.round(cap * each)) + "px";
      for (let i = 0; i < cap; i++) G.pipEls.push(agMake("i", "agPip", G.pips));
    }
    G.mag.style.minWidth = String(cap).length + "ch";
  }
  // where the reload is in its own animation: 0 until the fresh magazine is in
  // the hand, 1 once it seats (CBZ.gunReload recipe; a shell, one shell)
  function agReloadFill(i) {
    if (!(fps.reloading > 0) || reloadWeapon !== i) return -1;
    const w = WEAPONS[i];
    const p = Math.max(0, Math.min(1, 1 - fps.reloading / Math.max(0.05, w.reload || fps.reloading)));
    const R = CBZ.gunReload && CBZ.gunReload.recipe ? CBZ.gunReload.recipe(weaponModels[i]) : null;
    const g0 = R && R.grab != null ? R.grab : 0.4, g1 = R && R.seat != null ? R.seat : 0.82;
    const u = Math.max(0, Math.min(1, (p - g0) / Math.max(0.05, g1 - g0)));
    return u * u * (3 - 2 * u);
  }
  function agRender(el, w) {
    const G = agOf(el);
    const i = fps.weapon, cap = Math.max(0, fps.mag | 0), ammo = Math.max(0, fps.ammo | 0), reserve = Math.max(0, fps.reserve | 0);
    agSetCap(G, cap);
    // the held gun's silhouette: the hotbar's own cached render
    const gid = weaponIdOf(i) || "";
    if (G.gunId !== gid) {
      G.gunId = gid;
      let src = "";
      try { src = (CBZ.itemIconGun && CBZ.itemIconGun(gid)) || (CBZ.weaponThumbnail && CBZ.weaponThumbnail(gid)) || ""; } catch (e) { src = ""; }
      if (src) G.gun.src = src;
      G.gun.hidden = !src;
    }
    const rocketSpec = w.explosive ? rocketAmmoSpec(w) : null;
    G.lock.hidden = !(rocketSpec && rocketSpec.homing);
    // reload: rounds coming in on the animation's clock
    const f = agReloadFill(i);
    const rl = f >= 0;
    const give = rl ? Math.max(0, Math.min(w.shellReload ? 1 : cap - ammo, reserve)) : 0;
    const inF = rl ? give * f : 0;
    const shownN = ammo + Math.floor(inF + 1e-6);
    const magTxt = String(shownN), resTxt = String(reserve - (shownN - ammo));
    if (G.magTxt !== magTxt) { G.magTxt = magTxt; G.mag.textContent = magTxt; }
    if (G.resTxt !== resTxt) { G.resTxt = resTxt; G.res.textContent = resTxt; }
    const lowN = cap > 2 ? Math.max(1, Math.ceil(cap * 0.25)) : 0;
    const cls = rl ? "rl" : ammo === 0 ? "dry" : ammo <= lowN ? "low" : "";
    if (G.cls !== cls) {
      if (G.cls) el.classList.remove(G.cls);
      if (cls) el.classList.add(cls);
      G.cls = cls;
    }
    if (G.fill) {
      const k = cap > 0 ? Math.min(1, (ammo + inF) / cap) : 0;
      const kk = Math.round(k * 400) / 400;
      if (G.fillK !== kk) { G.fillK = kk; G.fill.style.transform = "scaleX(" + kk + ")"; }
    } else if (G.pipEls.length) {
      // pips drain from the left: the row's right end is the round on top
      const P = G.pipEls, n = P.length;
      const lit = Math.min(n, shownN), inTo = rl ? lit : -1;
      const nx = rl && lit < n && lit < ammo + give ? Math.round((inF - Math.floor(inF + 1e-6)) * 20) / 20 : -1;
      if (G.lit !== lit || G.inTo !== inTo || G.nxF !== nx) {
        for (let p = 0; p < n; p++) {
          const slot = n - 1 - p;              // p-th round from the right
          const on = p < lit;
          const e = P[slot];
          const want = "agPip" + (on ? " on" : "") + (on && rl && p >= ammo ? " in" : "") + (p === lit && nx > 0 ? " nx" : "");
          if (e.className !== want) e.className = want;
          if (p === lit && nx > 0) e.style.setProperty("--f", String(nx));
        }
        G.lit = lit; G.inTo = inTo; G.nxF = nx;
      }
    }
  }
  function setAmmoHud() {
    const ammoEl = ammoHudEl();
    if (!ammoEl) return;
    syncAmmo();
    // A MELEE WEAPON HAS NO MAGAZINE: the shank never gets an ammo gauge.
    // Shown whenever a gun is the thing in your hands: aiming or not, first
    // person or third, in every game; never behind the wheel unless the gun is
    // out of the window, never dead, never with the city HUD hidden.
    const wAmmo = weapon();
    const P = CBZ.player;
    const inCar = !!(P && P.driving);
    const hudHidden = CBZ.game.mode === "city" && CBZ.cityCharPanel && CBZ.cityCharPanel.hudHidden && CBZ.cityCharPanel.hudHidden();
    if ((fps.active || shoulderActive() || CBZ.game.mode === "city" || carGun()) && armed() && !(wAmmo && wAmmo.melee) &&
        !(P && P.dead) && (!inCar || carGun()) && !hudHidden) {
      agRender(ammoEl, wAmmo);
      const car = inCar;
      if (ammoEl._agCar !== car) { ammoEl._agCar = car; ammoEl.classList.toggle("car", car); }
      if (ammoEl.style.display !== "flex") ammoEl.style.display = "flex";
    } else if (ammoEl.style.display !== "none") ammoEl.style.display = "none";
    setWeaponStrip();
  }

  // THE WEAPON STRIP IS GONE (2026-09-28). The guns you carry are drawn by
  // exactly one bar per game: systems/inventory.js's #hotbar everywhere but
  // the city, city/hud.js's #cSlots in the city. This used to be a third
  // renderer (a text row, later a docked chip row) that other files spent
  // years hiding and re-parenting. The element stays in the page, empty.
  function setWeaponStrip() {
    if (stripEl && stripEl.style.display !== "none") { stripEl.innerHTML = ""; stripEl.style.display = "none"; }
  }

  // ---- raycast helpers ----
  function wallDistance(origin, dir, maxRange) {
    ray.set(origin, dir);
    ray.far = maxRange;
    const hits = CBZ.losRaycast ? CBZ.losRaycast(ray, CBZ.losBlockers) : ray.intersectObjects(CBZ.losBlockers, false);
    // city: a wall hit landing inside an OPEN (shattered) window pane's rect
    // (CBZ.cityShotHole, buildings.js) is a hole, not a wall — skip it and
    // keep tracing, so firing out of (or into) a broken window carries past
    // the frame instead of stamping a bullet pock on thin air. Intact glass
    // still protects: panes aren't blockers, their SOLID wall is, and the
    // first round breaks the pane (cityShatterRay below) so the next pass.
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      if (CBZ.game.mode === "city" && CBZ.cityShotHole) {
        const n = h.face && h.face.normal;   // axis-aligned walls: object-space normal == world
        if (CBZ.cityShotHole(h.point.x, h.point.y, h.point.z, n ? n.x : 0, n ? n.z : 0)) continue;
      }
      return h;
    }
    return null;
  }

  // Long-lived wall wounds belong only to static architecture. A raycast can
  // also hit a parked/moving aircraft or other dynamic prop; stamping that
  // world-space point left a dark disc hanging in empty air after the object
  // moved — the filmed RPG "painting thin air" bug.
  function canLeaveBlastScar(hit) {
    let o = hit && hit.object;
    while (o) {
      const u = o.userData || {};
      if (u.aircraftDims || u.hijackable || u.craft || u.milKind || u.dynamic || u.transient) return false;
      o = o.parent;
    }
    return !!hit;
  }

  // Persistent wall pocks normally live in world space. A moving LOS blocker
  // (the Prison Escape keycard door / armory gate) is different: leaving its
  // pocks in the scene makes them hang across the empty doorway after the leaf
  // slides up. Mount only those marks on the mover that the ray actually hit;
  // gunfx.js converts the world hit into this parent's local frame.
  // World normal of the face a raycast struck (instanced meshes included),
  // turned to face the shooter. null when the hit carries no face.
  const _fnN = new THREE.Vector3(), _fnM3 = new THREE.Matrix3(), _fnM4 = new THREE.Matrix4(), _fnI = new THREE.Matrix4();
  const _fnOut = { x: 0, y: 0, z: 0 };
  function faceNormalOf(wh, shotDir) {
    const o = wh && wh.object;
    if (!o || !wh.face || !wh.face.normal || !o.matrixWorld) return null;
    _fnM4.copy(o.matrixWorld);
    if (o.isInstancedMesh && wh.instanceId != null) { o.getMatrixAt(wh.instanceId, _fnI); _fnM4.multiply(_fnI); }
    _fnM3.getNormalMatrix(_fnM4);
    _fnN.copy(wh.face.normal).applyMatrix3(_fnM3);
    if (_fnN.lengthSq() < 1e-8) return null;
    _fnN.normalize();
    if (shotDir && _fnN.x * shotDir.x + _fnN.y * shotDir.y + _fnN.z * shotDir.z > 0) _fnN.negate();
    _fnOut.x = _fnN.x; _fnOut.y = _fnN.y; _fnOut.z = _fnN.z;
    return _fnOut;
  }
  function wallWoundParent(hit) {
    let o = hit && hit.object;
    while (o && o !== CBZ.scene) {
      if (o.userData && o.userData.mover) return o;
      o = o.parent;
    }
    return null;
  }

  // ---- ray vs the CAR fleet (cars were invisible to bullets before this) ----
  // WHY: cars are the street furniture of every firefight — they must take the
  // round (panel hole, paint chips, engine damage) AND act as real cover so a
  // ped crouched behind a sedan is actually safe. Cheap sphere broad-phase per
  // car, then a slab test in the car's yaw-local frame; tracks WHICH face the
  // bullet entered so the decal/debris hug the actual panel.
  function findCarHit(origin, dir, maxT) {
    if (CBZ.game.mode !== "city" || !CBZ.cityCars || !CBZ.cityCars.length) return null;
    const cars = CBZ.cityCars;
    let best = null, bestT = maxT, bnx = 0, bny = 0, bnz = 0;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || c.dead || !c.group || (c.player && CBZ.player.driving)) continue;
      const dims = c.dims;
      const hy = dims ? dims.height * 0.5 : 0.95;
      const cx = c.pos.x, cy = hy, cz = c.pos.z;
      // broad phase: closest approach of the ray to the car centre
      const ox = cx - origin.x, oy = cy - origin.y, oz = cz - origin.z;
      const tc = ox * dir.x + oy * dir.y + oz * dir.z;
      const rad = (dims ? dims.length : 4.6) * 0.6 + 0.6;
      if (tc < -rad || tc - rad > bestT) continue;
      const px = ox - dir.x * tc, py = oy - dir.y * tc, pz = oz - dir.z * tc;
      if (px * px + py * py + pz * pz > rad * rad) continue;
      // narrow phase: slab test in the car's local frame (yaw = heading)
      const h = c.heading || 0, ch = Math.cos(h), sh = Math.sin(h);
      const lox = ch * -ox - sh * -oz, loy = -oy, loz = sh * -ox + ch * -oz;  // origin rel. centre, un-yawed
      const ldx = ch * dir.x - sh * dir.z, ldy = dir.y, ldz = sh * dir.x + ch * dir.z;
      const hx = (dims ? dims.width : 2.2) * 0.5 + 0.05;
      const hz = (dims ? dims.length : 4.6) * 0.5 + 0.05;
      let tmin = 0.05, tmax = bestT, axis = -1, sign = 1;
      let miss = false;
      // x slab
      if (Math.abs(ldx) < 1e-8) { if (Math.abs(lox) > hx) continue; }
      else {
        let t0 = (-hx - lox) / ldx, t1 = (hx - lox) / ldx;
        if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
        if (t0 > tmin) { tmin = t0; axis = 0; sign = ldx > 0 ? -1 : 1; }
        if (t1 < tmax) tmax = t1;
        if (tmin > tmax) continue;
      }
      // y slab (box sits feet-to-roof: centre cy, half height hy)
      if (Math.abs(ldy) < 1e-8) { if (Math.abs(loy) > hy) miss = true; }
      else {
        let t0 = (-hy - loy) / ldy, t1 = (hy - loy) / ldy;
        if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
        if (t0 > tmin) { tmin = t0; axis = 1; sign = ldy > 0 ? -1 : 1; }
        if (t1 < tmax) tmax = t1;
        if (tmin > tmax) miss = true;
      }
      if (miss) continue;
      // z slab
      if (Math.abs(ldz) < 1e-8) { if (Math.abs(loz) > hz) continue; }
      else {
        let t0 = (-hz - loz) / ldz, t1 = (hz - loz) / ldz;
        if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
        if (t0 > tmin) { tmin = t0; axis = 2; sign = ldz > 0 ? -1 : 1; }
        if (t1 < tmax) tmax = t1;
        if (tmin > tmax) continue;
      }
      if (axis < 0 || tmin >= bestT) continue;   // started inside / not nearest
      // entry-face normal, yawed back to world
      const lnx = axis === 0 ? sign : 0, lny = axis === 1 ? sign : 0, lnz = axis === 2 ? sign : 0;
      best = c; bestT = tmin;
      bnx = ch * lnx + sh * lnz; bny = lny; bnz = -sh * lnx + ch * lnz;
    }
    return best ? { car: best, dist: bestT, normal: { x: bnx, y: bny, z: bnz } } : null;
  }

  // ---- PANEL SHUDDER: a shot car's hull jolts for a beat -------------------
  // Tiny decaying rotation.x wobble on the deformable body mesh (crumpleCar
  // owns rotation.z/position — rotation.x is exclusively ours, restored to 0
  // when done so the wreck pose is untouched). Bounded to 6 live shudders.
  const shudders = [];
  function carShudder(car, cal) {
    const ud = car.group && car.group.userData;
    if (!ud || !ud.body) return;
    for (let i = 0; i < shudders.length; i++) {
      if (shudders[i].car === car) { shudders[i].t = 0; shudders[i].amp = Math.max(shudders[i].amp, 0.015 + cal * 0.02); return; }
    }
    if (shudders.length >= 6) {
      const old = shudders.shift();
      const oud = old.car.group && old.car.group.userData;
      if (oud && oud.body) oud.body.rotation.x = 0;
    }
    shudders.push({ car, t: 0, dur: 0.18, amp: 0.015 + cal * 0.02 });
  }

  // Hitboxes tuned to the ACTUAL character model (feet at y≈0): the head
  // cube sits ~y2.15, the torso ~y1.4, the legs ~y0.65. The head sphere is
  // checked FIRST and wins outright — if the ray passes through it the shot
  // is a headshot regardless of the body behind it, so aiming at the head
  // connects cleanly instead of the body "stealing" the hit.
  const HEAD_Y = 1.50, TORSO_Y = 1.00, LEG_Y = 0.46;

  // distance at which a ray ENTERS a sphere (or -1 if it misses)
  function sphereEntry(origin, dir, cx, cy, cz, r, maxT) {
    tmp.set(cx, cy, cz).sub(origin);
    const t = tmp.dot(dir);
    if (t > maxT + r) return -1;
    const perpSq = tmp.lengthSq() - t * t;
    if (perpSq > r * r) return -1;
    let entry = t - Math.sqrt(Math.max(0, r * r - perpSq));
    if (entry < 0) entry = Math.max(0.05, t); // muzzle already inside the sphere
    if (entry < 0.05 || entry > maxT) return -1;
    return entry;
  }

  // ---- VEHICLE/AIRCRAFT OCCUPANTS as aim candidates ------------------------
  // OWNER: "if there's a person in a helicopter, autoscoping should scope for
  // the person in that helicopter, just like it works for a person in front of
  // me." The acquire stack (assist spheres, hot crosshair, CBZ.aimedActor
  // consumers) only scanned ON-FOOT lists, so people seated inside vehicles /
  // aircraft were invisible to it even when you could SEE them through the
  // real glass. Two halves, one flag:
  //   • findActorHit: a hidden-body actor seated in a LIVE car (hijackers and
  //     scripted riders use the `a.inCar = <car record>` convention) presents
  //     seated head/torso spheres at the cabin — the PERSON acquires, and car
  //     glass never blocks the snap (car meshes are not LOS blockers).
  //   • aimedActor: the police gunship/jets + civil planes join via their
  //     published ray tests, so aiming at a visible pilot acquires a live
  //     person-grade target.
  // DAMAGE IS UNCHANGED — exactly what a direct manual shot does today:
  // resolveShot already ray-tests the same craft (hull/canopy hit →
  // cityAircraftDamage / cityDamageCivilAircraft) and findCarHit clamps
  // cabin-bound rounds at the panel (the car takes the hit). No new damage
  // systems; the acquire just stops being blind to people inside vehicles.
  if (CBZ.CONFIG.AIM_VEHICLE_OCCUPANTS == null) CBZ.CONFIG.AIM_VEHICLE_OCCUPANTS = true;
  const OCC_HEAD_Y = 1.12, OCC_TORSO_Y = 0.78;   // seated heights above the cabin floor
  const occPoint = new THREE.Vector3();
  // one cached pseudo-record for aircraft crew: enough shape (kind/pos) for
  // generic consumers, deliberately WITHOUT char/vendor/relPlayer fields so
  // aim_dossier's person filter skips it instead of pinning UI to a proxy.
  const occPilot = { kind: "pilot", occupant: true, name: "Pilot", pos: new THREE.Vector3() };

  // ---- AIM ASSIST IS FOR TARGETS, AND A CHILD IS NOT ONE -------------------
  // systems/childsafe.js already refuses every DAMAGE path to a child (its
  // wraps plus the hp seal). Its own OPEN census names the one surface it
  // structurally could not reach from outside this file, verbatim:
  //   "src/systems/fpsmode.js findActorHit — module-private (not on CBZ), so it
  //    cannot be wrapped. A child stays an acquirable bullet target and still
  //    receives head/body aim-assist radii; the DAMAGE is refused (the seal)
  //    but the crosshair still snaps."
  //
  // That combination is the worst possible state and it is exactly what the
  // owner is seeing: the gun PULLS onto a kid, the reticle goes hot, and then
  // nothing happens. Three separate surfaces do the pulling; all three close
  // on this one predicate:
  //   • the ASSIST SPHERES below — the inflated head/body radii that turn a
  //     near-miss into a hit. A protected actor is tested against the weapon's
  //     RAW silhouette instead, so nothing is magnetic about them.
  //   • the SOFT AIM-LOCK (lockValid, further down) — the one that physically
  //     writes cam.yaw / cam.pitch. A child is never a candidate, and a lock
  //     already held releases the moment its record reads protected.
  //   • the HOT reticle — a crosshair that goes red over somebody no weapon in
  //     the game can hurt is the HUD telling a lie.
  //
  // WHAT IS DELIBERATELY *NOT* CHANGED — and this is why the census's suggested
  // `continue` was not the fix: the bullet stays PHYSICAL. The actor is still
  // scanned, so a round still stops on a real body, the impact still lands, and
  // childsafe's veto still flinches and flees them — which is that file's own
  // stated design ("The shot still cracks, the impact FX still land"). Skipping
  // the actor outright would make every child a ghost you fire through, and
  // would be a change to damage/occlusion, which this is not.
  //
  // Never cached: crowd pooling recycles ped records, so the predicate is
  // re-asked every test (childsafe.js's obligation 2). Feature-detected, so
  // this file is unchanged when childsafe.js is absent.
  // One-line revert: CBZ.CONFIG.AIM_CHILD_NO_ASSIST = false.
  if (CBZ.CONFIG.AIM_CHILD_NO_ASSIST == null) CBZ.CONFIG.AIM_CHILD_NO_ASSIST = true;
  let aimChildSkips = 0;                       // telemetry: assists denied (childSafeStats' sibling)
  function childUnaided(a) {
    if (CBZ.CONFIG.AIM_CHILD_NO_ASSIST === false) return false;
    return !!(CBZ.isProtectedActor && CBZ.isProtectedActor(a));
  }
  CBZ.aimAssistAudit = function () {
    return { on: CBZ.CONFIG.AIM_CHILD_NO_ASSIST !== false, childSafe: !!CBZ.isProtectedActor, denied: aimChildSkips };
  };

  function findActorHit(origin, dir, maxT, w) {
    // generous-but-fair aim assist (bigger from the third-person shoulder cam)
    const headAssist = shoulderActive() ? 0.22 : (fps.active ? 0.13 : 0);
    const bodyAssist = shoulderActive() ? 0.40 : (fps.active ? 0.16 : 0);
    const hrRaw = (w.headRadius || 0.33), brRaw = (w.bodyRadius || BODY_R);
    const hrA = hrRaw + headAssist;            // the ASSISTED radii — everyone but a child
    const brA = brRaw + bodyAssist;
    let bestActor = null, bestDist = maxT, bestHead = false, bestOcc = false;
    const scan = function (list) {
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!a || a.dead || a.escaped || !a.group) continue;
        // A LIVING MAN ON THE FLOOR (knocked out, shot down, tased) is a body
        // lying there, not a standing silhouette: the round is tested against
        // the rig itself, the same way a corpse is (lyingBodyEntry below)
        if (lyingLiving(a)) {
          if (a.group.visible === false) continue;
          const ld0 = lyingBodyEntry(origin, dir, a, bestDist);
          if (ld0 >= 0 && ld0 < bestDist) { bestActor = a; bestDist = ld0; bestHead = _corpseHead; bestOcc = false; }
          continue;
        }
        // per-actor radii: a protected actor gets the bare silhouette, so only
        // a literal ray through the real body registers. (See the block above.)
        // PERF (exact, and the predicate is still never cached): the bare radii
        // are strictly CONTAINED in the assisted ones, so an actor the ray
        // misses at ASSISTED size is missed at bare size too — the protection
        // question only needs asking for an actor the ray could actually
        // touch. The standing branch below tests assisted spheres first and
        // asks childUnaided() only on a potential hit; the two seated branches
        // (rare) ask it up front as before. This took the predicate from ~630
        // calls/frame (every ped, every frame, from the hot reticle) to ~hits.
        let bare = false, hr = hrA, br = brA;
        if (a.group.visible === false) {
          // SEATED OCCUPANT (hidden body, live vehicle): only LIVE riders whose
          // record links the actual car object. (AIM_VEHICLE_OCCUPANTS)
          if (CBZ.CONFIG.AIM_VEHICLE_OCCUPANTS === false) continue;
          const car = a.inCar;
          if (!car || typeof car !== "object" || !car.pos || car.dead) continue;
          if (car.bulletproof) continue;               // armoured glass: the panel takes it (city/los.js)
          // an invisible ped is USUALLY just culled, so the protection question
          // is asked only after the occupant checks prove there is a target here
          bare = childUnaided(a);
          if (bare) { aimChildSkips++; hr = hrRaw; br = brRaw; }
          const cy = car.pos.y || 0;
          // refresh the rider's dead-while-driving pos so anything reading it
          // (overhead tags, map dots) points at the car, not the sidewalk spot
          // where they got in (eject rewrites it from car.pos anyway).
          if (a.pos && a.pos.set) a.pos.set(car.pos.x, cy, car.pos.z);
          const ohd = sphereEntry(origin, dir, car.pos.x, cy + OCC_HEAD_Y, car.pos.z, hr, maxT);
          if (ohd >= 0 && ohd < bestDist) { bestActor = a; bestDist = ohd; bestHead = true; bestOcc = true; continue; }
          const otd = sphereEntry(origin, dir, car.pos.x, cy + OCC_TORSO_Y, car.pos.z, br, maxT);
          if (otd >= 0 && otd < bestDist) { bestActor = a; bestDist = otd; bestHead = false; bestOcc = true; }
          continue;
        }
        // SEATED-IN-PARENT actor (aircraft cabin/cockpit — npclife attach):
        // group.position is PLANE-LOCAL, so the standing sphere stack below
        // would test empty air near the parent's local origin — these people
        // were simply absent from the bullet's world (owner: "you can't shoot
        // them"). Use the world-pos mirror npclife syncs every tick plus the
        // LIVE head world point, and hang a seated-height body stack off that
        // head so the spheres self-adapt to whichever seat pose variant posed
        // the rig. (CHAR_SEATED_HITTABLE)
        if (a._npcAttached) {
          if (CBZ.CONFIG.CHAR_SEATED_HITTABLE === false) continue;
          if (a.inCar && a.inCar.bulletproof && !a.inCar.dead) continue;   // armoured glass (city/los.js)
          const ap = a.pos;
          if (!ap) continue;
          bare = childUnaided(a);
          if (bare) { aimChildSkips++; hr = hrRaw; br = brRaw; }
          let hx = ap.x, hy = ap.y + 0.95, hz = ap.z;   // fallback: seated head guess
          const hm = a.char && a.char.head;
          if (hm && hm.getWorldPosition) { hm.getWorldPosition(occPoint); hx = occPoint.x; hy = occPoint.y; hz = occPoint.z; }
          const shd = sphereEntry(origin, dir, hx, hy, hz, hr, maxT);
          if (shd >= 0 && shd < bestDist) { bestActor = a; bestDist = shd; bestHead = true; bestOcc = false; continue; }
          const oy = Math.max(0.4, hy - ap.y);          // head height above the seat anchor
          const std = sphereEntry(origin, dir, (hx + ap.x) / 2, ap.y + oy * 0.5, (hz + ap.z) / 2, br, maxT);
          const sld = sphereEntry(origin, dir, ap.x, ap.y + oy * 0.18, ap.z, br * 0.82, maxT);
          const sbd = Math.min(std < 0 ? Infinity : std, sld < 0 ? Infinity : sld);
          if (sbd < bestDist) { bestActor = a; bestDist = sbd; bestHead = false; bestOcc = false; }
          continue;
        }
        const gp = a.group.position, gy = gp.y || 0;
        // ASSISTED-radius pre-pass (superset of the bare spheres — see above)
        let hd = sphereEntry(origin, dir, gp.x, gy + HEAD_Y, gp.z, hrA, maxT);
        let td = sphereEntry(origin, dir, gp.x, gy + TORSO_Y, gp.z, brA, maxT);
        let ld = sphereEntry(origin, dir, gp.x, gy + LEG_Y, gp.z, brA * 0.82, maxT);
        if (!((hd >= 0 && hd < bestDist) || (td >= 0 && td < bestDist) || (ld >= 0 && ld < bestDist))) continue;
        if (childUnaided(a)) {
          aimChildSkips++;
          // protected: re-test at the bare silhouette — only a literal hit counts
          hd = sphereEntry(origin, dir, gp.x, gy + HEAD_Y, gp.z, hrRaw, maxT);
          td = sphereEntry(origin, dir, gp.x, gy + TORSO_Y, gp.z, brRaw, maxT);
          ld = sphereEntry(origin, dir, gp.x, gy + LEG_Y, gp.z, brRaw * 0.82, maxT);
        }
        // HEAD first — small high sphere, takes priority
        if (hd >= 0 && hd < bestDist) { bestActor = a; bestDist = hd; bestHead = true; bestOcc = false; continue; }
        // BODY — torso + legs spheres
        let bd = Math.min(td < 0 ? Infinity : td, ld < 0 ? Infinity : ld);
        if (bd < bestDist) { bestActor = a; bestDist = bd; bestHead = false; bestOcc = false; }
      }
    };
    if (CBZ.game.mode === "city") { scan(CBZ.cityPeds); scan(CBZ.cityCops); if (CBZ.cityMedics) scan(CBZ.cityMedics); if (CBZ.cityWildlife) scan(CBZ.cityWildlife); }   // same gun, city targets (wildlife are huntable too)
    else { scan(CBZ.guards); scan(CBZ.npcs); }
    // multiplayer: remote player avatars + host-synced puppet NPCs are real targets
    if (CBZ.net && CBZ.net.active && CBZ.net.targetList) scan(CBZ.net.targetList());
    // the ambient instanced crowd is also a valid target (so you can shoot ANYONE,
    // not just the few promoted peds). It competes on distance → real occlusion.
    let crowdIdx = -1;
    if (CBZ.game.mode === "city" && CBZ.cityCrowdRayHit) {
      // The instanced crowd is index-addressed and this call takes ONE pair of
      // radii for the whole sweep, so per-agent radii are not expressible from
      // here — the assisted pair stands. childsafe.js's OPEN census already
      // carries `crowd.js cityCrowdRayHit` as its own separate item, whose
      // stated close is a `cityCrowdChild(i)` seam inside crowd.js.
      const ch = CBZ.cityCrowdRayHit(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, bestDist, hrA, brA);
      if (ch) { bestActor = null; crowdIdx = ch.i; bestDist = ch.dist; bestHead = ch.head; bestOcc = false; }
    }
    if (!bestActor && crowdIdx < 0) return null;
    return { actor: bestActor, crowd: crowdIdx >= 0 ? crowdIdx : null, occupant: bestOcc, dist: bestDist, head: bestHead, point: origin.clone().addScaledVector(dir, bestDist) };
  }

  // ---- ray vs the DOWNED (every game) ----------------------------------------
  // OWNER: you must be able to keep shooting a corpse — more holes, it reacts.
  // findActorHit deliberately skips dead actors (so a live target isn't blocked
  // by a body in front of it); this is its dead-only twin. A corpse lies PRONE,
  // so the standing head/torso/leg spheres don't fit — instead we test a couple
  // of low, fat spheres around the body's settled root (group.position tracks the
  // ragdoll). Returns the nearest dead actor + whether the hit landed up near the
  // head end (for the decap read). The other games test the lying rig itself.
  const CORPSE_R = 0.62;        // prone body is a low fat sausage
  // a living man lying on the floor: knocked out / down (a.ko, the prison and
  // city brains), in the keyed fall (meleeposes), or in his collapse (bodyfall)
  function lyingLiving(a) {
    if (!a || a.dead) return false;
    if (a.ko > 0) return true;
    const f = a.char && a.char.fall;
    if (f && f.on && f.phase !== "getup") return true;
    return !!(a._bf && a._bf.on);
  }
  /* EVERY OTHER GAME: the body lies where its collapse put it
     (systems/bodyfall.js), and the rig knows where its head and hips are, so
     the round is tested against the body itself: five spheres from the head
     through the hips and on down the legs. Returns the entry distance, and
     sets _corpseHead when the nearest sphere was the head. */
  const _cH = new THREE.Vector3(), _cP = new THREE.Vector3();
  let _corpseHead = false;
  function lyingBodyEntry(origin, dir, a, maxT) {
    const ch = a.char;
    if (!ch || !ch.head || !ch.parts || !ch.parts.ll || !ch.parts.rl) return -1;
    const gp = a.group.position;
    // cheap reject: nothing of a lying man is 1.6 m from his root
    if (sphereEntry(origin, dir, gp.x, (gp.y || 0) + 0.4, gp.z, 1.6, maxT) < 0) return -1;
    ch.head.getWorldPosition(_cH);
    ch.parts.ll.getWorldPosition(_cP);
    const hx = _cP.x, hy = _cP.y, hz = _cP.z;
    ch.parts.rl.getWorldPosition(_cP);
    _cP.set((hx + _cP.x) / 2, (hy + _cP.y) / 2, (hz + _cP.z) / 2);   // the pelvis
    let bd = -1;
    _corpseHead = false;
    for (let i = 0; i < 5; i++) {
      // 0 = the head, 2 = the hips, 4 = the knees/shins
      const t = i / 2;
      const x = _cH.x + (_cP.x - _cH.x) * t, y = _cH.y + (_cP.y - _cH.y) * t, z = _cH.z + (_cP.z - _cH.z) * t;
      const d = sphereEntry(origin, dir, x, y, z, i === 0 ? 0.2 : i < 3 ? 0.3 : 0.2, maxT);
      if (d >= 0 && (bd < 0 || d < bd)) { bd = d; _corpseHead = i === 0; }
    }
    return bd;
  }
  function findCorpseHit(origin, dir, maxT) {
    let best = null, bestDist = maxT, bestHead = false;
    if (CBZ.game.mode !== "city") {
      const seen = new Set();
      const scanBody = function (list) {
        if (!list) return;
        for (let i = 0; i < list.length; i++) {
          const a = list[i];
          if (!a || !a.dead || a.escaped || !a.group || a.group.visible === false || seen.has(a)) continue;
          seen.add(a);
          const d = lyingBodyEntry(origin, dir, a, bestDist);
          if (d >= 0 && d < bestDist) { best = a; bestDist = d; bestHead = _corpseHead; }
        }
      };
      scanBody(CBZ.guards); scanBody(CBZ.npcs);
      // bodies a game keeps past the man (systems/bodyfall.js CBZ.corpses) and
      // the dead a game lists for its guns (warlord: its own men list)
      if (CBZ.corpses) scanBody(CBZ.corpses.list);
      scanBody(CBZ.corpseTargets);
      if (!best) return null;
      return { corpse: best, dist: bestDist, head: bestHead, point: origin.clone().addScaledVector(dir, bestDist) };
    }
    const scan = function (list) {
      if (!list) return;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!a || !a.dead || a.escaped || !a.group || a.group.visible === false) continue;
        const gp = a.group.position, gy = gp.y || 0;
        // a settled body hugs the ground: one sphere at the torso mass (low),
        // one a touch higher toward the head end. Heading is unknown post-topple,
        // so we keep them vertically split — a head shot reads as the upper hit.
        const td = sphereEntry(origin, dir, gp.x, gy + 0.35, gp.z, CORPSE_R, maxT);
        if (td >= 0 && td < bestDist) { best = a; bestDist = td; bestHead = false; }
        const hd = sphereEntry(origin, dir, gp.x, gy + 0.62, gp.z, CORPSE_R * 0.7, maxT);
        if (hd >= 0 && hd < bestDist) { best = a; bestDist = hd; bestHead = true; }
      }
    };
    scan(CBZ.cityPeds); scan(CBZ.cityCops); scan(CBZ.cityMedics);
    if (!best) return null;
    return { corpse: best, dist: bestDist, head: bestHead, point: origin.clone().addScaledVector(dir, bestDist) };
  }

  /* `reach` (optional) is how far THIS trace looks, in metres. It exists
     because a flown bullet resolves one frame-length SEGMENT at a time — the
     weapon's whole `range` is the wrong question for a 15 m step — and it
     defaults to w.range, so every hitscan caller is byte-identical. */
  function resolveShot(w, dir, rayOrigin, reach) {
    eye.copy(rayOrigin || CBZ.camera.position);
    const far = reach > 0 ? reach : w.range;
    const wall = wallDistance(eye, dir, far);
    let maxT = wall ? Math.max(0.1, wall.distance - 0.04) : far;
    // CARS are hard cover AND targets: the nearest car along the ray clamps the
    // search so a ped ducked behind a sedan is safe — the panel eats the round.
    const carHit = findCarHit(eye, dir, maxT);
    if (carHit) maxT = Math.max(0.1, carHit.dist - 0.04);
    const hit = findActorHit(eye, dir, maxT, w);
    // the police gunship overhead is a valid target — ray-test it (no damage here;
    // the shoot loop / rocket splash applies it) and take it if it's the nearest.
    const policeAir = (CBZ.game.mode === "city" && CBZ.cityAircraftRayTest) ? CBZ.cityAircraftRayTest(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, maxT) : null;
    const civilAir = (CBZ.game.mode === "city" && CBZ.cityCivilAircraftRayTest) ? CBZ.cityCivilAircraftRayTest(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, maxT) : null;
    // Air-1 (police.js) and the ambient GA fleet (airtraffic.js) had splash seams
    // but no bullet ray-test, so PLAIN GUNFIRE passed straight through them (owner:
    // "they also can't be shot"). Ray-test both; each returns a hull hit carrying a
    // per-bullet damage callback into its own module's hp pool. Nearest of the two
    // takes the light-air slot, then competes on distance with gunship/civil/ped.
    const polLightAir = (CBZ.game.mode === "city" && CBZ.cityPoliceAirRayTest) ? CBZ.cityPoliceAirRayTest(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, maxT) : null;
    const trafLightAir = (CBZ.game.mode === "city" && CBZ.cityAirTrafficRayTest) ? CBZ.cityAirTrafficRayTest(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, maxT) : null;
    let lightAir = polLightAir;
    if (trafLightAir && (!lightAir || trafLightAir.dist < lightAir.dist)) lightAir = trafLightAir;
    let air = policeAir;
    let civil = false, light = false;
    if (civilAir && (!air || civilAir.dist < air.dist)) { air = civilAir; civil = true; }
    if (lightAir && (!air || lightAir.dist < air.dist)) { air = lightAir; civil = false; light = true; }
    if (hit && (!air || hit.dist <= air.dist)) return hit;
    if (air) {
      const point = new THREE.Vector3(air.x, air.y, air.z);
      if (light) return { actor: null, lightAir: air, dist: air.dist, point };
      return civil
        ? { actor: null, civilAircraft: air.rec, dist: air.dist, point }
        : { actor: null, aircraft: true, dist: air.dist, point };
    }
    // a DOWNED body in the path (city-only): only when NO live actor was hit, so a
    // corpse never shadows a living target. Competes on distance with car/wall —
    // shoot it for more holes + a jerk; wins only if it's nearer than those.
    const corpse = findCorpseHit(eye, dir, maxT);
    if (corpse && (!carHit || corpse.dist <= carHit.dist)) return corpse;
    if (carHit) return { actor: null, car: carHit.car, normal: carHit.normal, dist: carHit.dist, point: eye.clone().addScaledVector(dir, carHit.dist) };
    return {
      actor: null,
      wall: !!wall,
      wallHit: wall || null,   // raw raycast hit (face/object) — rockets stamp the struck face
      dist: wall ? wall.distance : far,
      point: wall ? wall.point.clone() : eye.clone().addScaledVector(dir, far),
    };
  }


  // ---- BULLET PENETRATION + RICOCHET (d) -------------------------------------
  // Every raycast used to stop dead at the first solid hit. Two small, RARE,
  // clearly-telegraphed additions (own request: flavor/danger, not a core
  // mechanic — neither fires often and both are capped to a single extra
  // event per shot, so a firefight doesn't turn into a pinball table):
  //   PENETRATION — a "thin" wall (read the SAME way los.js derives real wall
  //   thickness: BoxGeometry.parameters along the struck face's axis) lets a
  //   sufficiently powerful round carry through to whatever's standing right
  //   behind it, at reduced exit damage. Pellet guns (shotgun) never
  //   penetrate (a shot charge dumps its energy into the first thing it
  //   hits — also keeps a 9-pellet blast from rolling 9 penetration checks).
  //   RICOCHET — a hit on a THICK/hard wall at a shallow GRAZING angle (the
  //   shot direction nearly parallel to the surface, not punching square into
  //   it) has a small chance to kick a deflected tracer off along the
  //   reflection vector, with a much smaller chance of clipping a nearby
  //   actor for token stray damage. Visual-first: the deflected beam is what
  //   sells it ("that round just skipped off the wall"), the stray hit is a
  //   rare bonus, never the point.
  const PEN_THIN_MAX = 0.22;      // at/under this real thickness, a wall is "thin" (PWT≈0.16 partitions qualify; WT=0.4 exterior walls don't)
  const PEN_MIN_CAL = 0.9;        // rounds lighter than this (uzi/sidearm/taser) don't reliably punch even thin cover
  const PEN_DMG_MUL = 0.45;       // reduced exit damage on whatever's struck behind the cover
  const RICOCHET_GRAZE = 0.16;    // |shotDir·wallNormal| below this = a shallow enough graze to maybe deflect
  const RICOCHET_CHANCE = 0.16;   // telegraphed-rare: most grazing hits do NOT ricochet
  const RICOCHET_STRAY_CHANCE = 0.12;  // of the ricochets that DO fire, how often a nearby actor catches token stray damage
  const RICOCHET_STRAY_DMG = 6;        // flavor-tier, never a real threat on its own

  // Real thickness of the struck axis-aligned wall box, along the face's
  // horizontal normal — identical technique to los.js's boxThicknessAlong
  // (separate IIFE closures can't share the helper, so this is the fpsmode
  // copy; both read the same BoxGeometry.parameters convention). Returns
  // Infinity (never "thin") for non-box geometry — can't penetrate what we
  // can't measure.
  function wallThickness(wallHit) {
    const obj = wallHit && wallHit.object, n = wallHit && wallHit.face && wallHit.face.normal;
    const geo = obj && obj.geometry, p = geo && geo.parameters;
    if (!p || p.width == null || p.depth == null) return Infinity;
    const nx = n ? n.x : 0, nz = n ? n.z : 0;
    return Math.abs(nx) >= Math.abs(nz) ? p.width : p.depth;
  }

  // Attempts penetration first; if it doesn't apply, attempts a ricochet.
  // Mutually exclusive per shot (a round either punches through OR skips off,
  // never both) — called once from the hit.wall branch in shoot()'s pellet
  // loop, AFTER the normal wall pock/spark/hole have already been stamped.
  // `wnx,wnz` is the wall-facing normal the caller already computed (a
  // SYNTHETIC reflected-shot-direction approximation used for the spark
  // cone's cosmetics — NOT the wall's true face normal). The grazing-angle
  // test below needs the REAL face normal instead (the synthetic one is, by
  // construction, always anti-parallel-ish to shotDir and would make every
  // shot read as a square hit) — read straight off wallHit.face, the same
  // axis-aligned-object-space-equals-world-space assumption this file
  // already relies on elsewhere (wallDistance/cityShotHole). Fires RARELY
  // (thin-wall gate / grazing-angle-plus-dice-roll gate below), so this
  // deliberately allocates plain Vector3s instead of fighting over the
  // file's hot-path scratch pool — clarity over micro-reuse for a cold path.
  function tryPenetrateOrRicochet(w, hit, shotDir, cal, wnx, wnz) {
    if (w.pellets) return;                       // shotgun: no penetration/ricochet rolls
    const wallHit = hit.wallHit;
    if (!wallHit) return;
    if (wallHit.object && wallHit.object.userData && wallHit.object.userData.bulletproof) return;   // armoured glass stops it cold
    const faceN = wallHit.face && wallHit.face.normal;
    const fnx = faceN ? faceN.x : wnx, fnz = faceN ? faceN.z : wnz;
    const graze = Math.abs(shotDir.x * fnx + shotDir.z * fnz);   // ~0 = parallel to the TRUE wall face, ~1 = square hit
    const thickness = wallThickness(wallHit);

    // PENETRATION — thin cover + a round heavy enough to carry through.
    if (thickness <= PEN_THIN_MAX && cal >= PEN_MIN_CAL && hit.dist < w.range - 0.5) {
      const exitPt = hit.point.clone().addScaledVector(shotDir, thickness + 0.06);
      const remaining = Math.max(0.5, w.range - hit.dist - thickness);
      const beyondActor = findActorHit(exitPt, shotDir, Math.min(remaining, 24), w);
      if (beyondActor && beyondActor.actor) {
        // a SECOND, lighter gunHit on whatever was standing behind the cover —
        // same damage pipeline (falloff, headshot, city/prison routing), just
        // pre-multiplied down for the energy the wall already ate.
        const exitHit = { actor: beyondActor.actor, head: beyondActor.head, dist: hit.dist + thickness + beyondActor.dist, point: beyondActor.point };
        const penW = Object.create(w); penW.damage = w.damage * PEN_DMG_MUL;   // cheap prototype override — never mutates the shared weapon table
        gunHit(exitHit, penW, shotDir);
        spawnImpact(beyondActor.point, true, false, cal * 0.75);
        if (CBZ.gore && CBZ.gore.spray) CBZ.gore.spray(beyondActor.point, 0.4, shotDir, goreOpts(beyondActor, w, cal, true));
        fireTracer(exitPt, beyondActor.point, w.tracer * 0.8, 0.05);
      } else {
        // nothing behind it: still show the round carrying through the cover —
        // a short, visibly DIFFERENT exit puff so a penetration clearly reads
        // as "that went through", not a second impossible impact on the wall.
        const farPt = exitPt.clone().addScaledVector(shotDir, Math.min(remaining, 6));
        fireTracer(exitPt, farPt, w.tracer * 0.7, 0.04);
      }
      return;
    }

    // RICOCHET — thick/hard surface, shallow grazing angle, rare + telegraphed.
    if (graze < RICOCHET_GRAZE && rng() < RICOCHET_CHANCE) {
      // reflect shotDir off the TRUE wall normal (horizontal-plane reflection
      // — walls here are near-vertical, same simplification the wall-impact
      // branch above already makes for its spark cone, but using fnx/fnz
      // here — not the synthetic wnx/wnz — so the deflection is a real
      // physical reflection, not just "back roughly the way it came".
      const dot = shotDir.x * fnx + shotDir.z * fnz;
      const rx = shotDir.x - 2 * dot * fnx, rz = shotDir.z - 2 * dot * fnz;
      const rl = Math.hypot(rx, rz) || 1;
      const deflectDir = new THREE.Vector3(rx / rl, shotDir.y * 0.4, rz / rl).normalize();
      const deflectEnd = hit.point.clone().addScaledVector(deflectDir, 7 + rng() * 5);
      fireTracer(hit.point, deflectEnd, w.tracer * 0.6, 0.06);
      if (CBZ.bulletImpact) CBZ.bulletImpact(hit.point, { x: fnx, y: 0.25, z: fnz }, { kind: "spark", power: cal * 1.2 });
      CBZ.sfx && CBZ.sfx("hit", { pitch: 1.3, volume: 0.5 });
      // tiny stray-damage roll: a nearby actor along the deflection MIGHT eat
      // a token hit. Deliberately small range + flat damage — this is flavor,
      // never the headline outcome of firing a gun near a wall.
      if (rng() < RICOCHET_STRAY_CHANCE) {
        const strayHit = findActorHit(hit.point, deflectDir, 9, w);
        if (strayHit && strayHit.actor) {
          const strayW = Object.create(w); strayW.damage = RICOCHET_STRAY_DMG; strayW.headMult = 1;
          gunHit({ actor: strayHit.actor, head: false, dist: strayHit.dist, point: strayHit.point }, strayW, deflectDir);
          spawnImpact(strayHit.point, true, false, 0.65);
        }
      }
    }
  }

  function aimedActor(maxRange) {
    aimForward(fwd);
    const p = CBZ.player;
    if (shoulderActive()) eye.copy(CBZ.camera.position);
    else eye.set(p.pos.x, p.pos.y + (p.prone ? 0.55 : p.crouch ? 1.18 : 1.65), p.pos.z);
    const w = armed() ? weapon() : { range: maxRange, bodyRadius: BODY_R, headRadius: 0.32 };
    const wall = wallDistance(eye, fwd, maxRange);
    const lim = wall ? Math.max(0.1, wall.distance - 0.04) : maxRange;
    const hit = findActorHit(eye, fwd, lim, w);
    // AIRCRAFT CREW (AIM_VEHICLE_OCCUPANTS): the police gunship/jets and civil
    // planes fly with real pilots visible through real canopy glass, but they
    // live outside the on-foot lists, so the acquire was blind to them. Ray-
    // test the SAME published craft volumes resolveShot fires against — the
    // nearest wins against any on-foot hit, walls still occlude (lim), and the
    // canopy glass IS the craft: a snap onto it routes today's manual damage
    // (cityAircraftDamage / cityDamageCivilAircraft), no new damage path.
    if (CBZ.CONFIG.AIM_VEHICLE_OCCUPANTS !== false && CBZ.game.mode === "city") {
      const cap = hit ? hit.dist : lim;
      const pol = CBZ.cityAircraftRayTest ? CBZ.cityAircraftRayTest(eye.x, eye.y, eye.z, fwd.x, fwd.y, fwd.z, cap) : null;
      const civ = CBZ.cityCivilAircraftRayTest ? CBZ.cityCivilAircraftRayTest(eye.x, eye.y, eye.z, fwd.x, fwd.y, fwd.z, cap) : null;
      let air = pol, civil = false;
      if (civ && (!air || civ.dist < air.dist)) { air = civ; civil = true; }
      if (air && (!hit || air.dist < hit.dist)) {
        occPilot.pos.set(air.x, air.y, air.z);   // live cockpit point for pos consumers
        occPoint.set(air.x, air.y, air.z);
        return civil
          ? { actor: null, occupant: occPilot, civilAircraft: air.rec, dist: air.dist, head: false, point: occPoint }
          : { actor: null, occupant: occPilot, aircraft: true, dist: air.dist, head: false, point: occPoint };
      }
    }
    return hit;
  }

  // ---- damage ----
  // CITY mode reuses this exact hitscan but routes the hit into the city's own
  // death/loot/crime systems (cops, gangs, wanted) instead of the prison AI.
  // ---- GORE_LOCATIONAL: hit LOCATION drives lethality (owner: "depending
  //   where, be DEAD... It's just physics"). A head hit is already a one-shot
  //   kill (lethalHead, below); this adds the LIMB read — an arm/leg round
  //   carries far less energy into the vitals than a torso hit, so it does
  //   reduced damage. Torso keeps the weapon's baseline. Flag off → flat body
  //   damage (pre-flag behaviour), a one-line revert. ----
  function locational() { return !CBZ.CONFIG || CBZ.CONFIG.GORE_LOCATIONAL !== false; }
  const LIMB_DMG_MULT = 0.55;        // arms/legs bleed the round's lethality
  const _locV = new THREE.Vector3();
  // classify a NON-head body hit as "torso" or "limb" from the world hit point,
  // in the actor ROOT local frame — the SAME rig bands wounds.js pickPart() uses,
  // so the damage and the visible hole always agree. Trustworthy only for a
  // normal standing rig; the caller gates on that.
  function bodyRegionAt(a, wp) {
    const g = a.group; if (!g) return "torso";
    g.updateWorldMatrix(true, false);
    _locV.copy(wp); g.worldToLocal(_locV);
    const x = _locV.x, y = _locV.y;
    if (y < 1.02) return "limb";                          // below the hips → leg
    if (y <= 1.98 && Math.abs(x) > 0.47) return "limb";   // lateral in the torso band → arm
    return "torso";
  }
  /* A ROUND INTO A LIVING MAN. One call for every survivor of a player shot
     in every mode: CBZ.verbs.shot (systems/verbs_strike.js) reads the zone
     off his rig at the hit point, sums a shotgun's pellets into one blast,
     and answers with a snap / fold and steps / a knee / a dead arm. False =
     no rig to answer with; the caller keeps its old body impulse. */
  const _shotO = { point: null, dir: null, cal: 1, wkey: "", dist: 0, share: 1, head: false };
  /* did this round go through him (systems/verbs_strike.js V.roundExits, the
     one rule): handed to the blood as opts.exit so an exit wound sprays out of
     the far side and a round that stays in bleeds from the entry alone */
  const _goreO = { exit: false, cal: 1, head: false };
  function goreOpts(hit, w, cal, spent) {
    const V = CBZ.verbs, a = hit.actor || hit.corpse || null;
    const zone = a && V && V.shotZone && hit.point ? V.shotZone(a, hit.point) : null;
    _goreO.exit = V && V.roundExits ? V.roundExits({ cal, wkey: w.key, pellets: w.pellets, head: !!hit.head, zone, dist: hit.dist, spent: !!spent, nonlethal: !!w.nonlethal }) : !w.pellets;
    _goreO.cal = cal; _goreO.head = !!hit.head;
    return _goreO;
  }
  /* THE ROUND GOES INTO HIS BODY (systems/vitals.js): a bleed where it went
     in, and the one answer to "is he dead": the head, the heart or a body
     riddled with rounds kills; anything else whose hp ran out puts him DOWN,
     awake and bleeding (he bleeds out unless someone wraps it). noKill: the
     caller keeps the death (gun game / warlord keep their hp deaths and only
     want the bleed). Returns vitals' { outcome, zone } or null. */
  const _vwO = { kind: "bullet", point: null, head: false, zone: null, cal: 1, by: null, fromX: 0, fromZ: 0, critical: false, noKill: true };
  function vitalsRound(a, hit, w, cal, critical) {
    const VT = CBZ.vitals;
    if (!VT || !VT.wound || w.nonlethal || !a || a.dead || a.animal || a.netKind) return null;
    const VB = CBZ.verbs;
    _vwO.point = hit.point || null; _vwO.head = !!hit.head; _vwO.cal = cal;
    _vwO.zone = hit.head ? "head" : (VB && VB.shotZone && hit.point && !hit.occupant ? VB.shotZone(a, hit.point) : null);
    _vwO.by = CBZ.player; _vwO.fromX = CBZ.player.pos.x; _vwO.fromZ = CBZ.player.pos.z;
    _vwO.critical = !!critical; _vwO.noKill = true;
    try { return VT.wound(a, _vwO); } catch (e) { return null; }
  }
  function shotLiving(a, hit, w, shotDir, cal) {
    const V = CBZ.verbs;
    if (!V || !V.shot || w.nonlethal || !a || a.dead || a.animal || a.netKind) return false;
    // a man already on the floor does not stagger: the round shoves him where he lies
    if (lyingLiving(a)) {
      if (a._bf && a._bf.on && CBZ.bodyFall && shotDir) CBZ.bodyFall.poke(a, shotDir.x, shotDir.z, 3 + 2 * cal, hit.point);
      return true;
    }
    _shotO.point = hit.point || null; _shotO.dir = shotDir || null; _shotO.cal = cal;
    _shotO.wkey = w.key || ""; _shotO.dist = hit.dist || 0;
    _shotO.share = w.pellets > 1 ? 1 / w.pellets : 1; _shotO.head = !!hit.head;
    return V.shot(a, _shotO);
  }
  function cityGunHit(a, hit, w, shotDir) {
    if (shotDir) hit.dir = shotDir; // wildlife + downstream death physics read the same resolved trajectory
    // WILDLIFE: an animal routes into the hunting system (its own damage/skin
    // path — never the human death/wanted/gore chain). See city/wildlife.js.
    if (a.animal && CBZ.cityWildlifeHit) return CBZ.cityWildlifeHit(a, hit, w);
    // multiplayer target (remote player or synced puppet): authority is over the
    // wire — net code routes the damage and plays the local juice.
    if (a.netKind && CBZ.net && CBZ.net.localGunHit) return CBZ.net.localGunHit(a, hit, w);
    // (e) per-weapon-CLASS falloff SHAPE, not one shared linear ramp — the
    // shotgun/sniper/smg/rifle curves live once in weapon-data.js and every
    // shooter (this + the prison gunHit below) calls the same evaluator.
    const fall = CBZ.weaponFalloffMul ? CBZ.weaponFalloffMul(w, hit.dist)
      : (hit.dist <= w.dropStart ? 1 : Math.max(w.minDamage, 1 - ((hit.dist - w.dropStart) / Math.max(1, w.range - w.dropStart)) * (1 - w.minDamage)));
    // GORE_LOCATIONAL limb falloff — trustworthy only for a normal standing rig
    // (a seated/occupant/hidden rig's local frame can't be trusted → treat as
    // torso). Headshots (lethalHead) are unaffected; torso keeps the baseline.
    let locMult = 1;
    if (locational() && !hit.head && hit.point && !hit.occupant && !a._npcAttached &&
        a.group && a.group.visible !== false && bodyRegionAt(a, hit.point) === "limb") {
      locMult = LIMB_DMG_MULT;
    }
    const dmg = Math.max(1, Math.round(w.damage * (hit.head ? w.headMult : 1) * fall * locMult));
    const lethalHead = hit.head && !w.nonlethal;
    const fx = CBZ.player.pos.x, fz = CBZ.player.pos.z;
    const cal = caliber(w);
    const dir = shotDir ? { x: shotDir.x, y: shotDir.y, z: shotDir.z } : null;
    // One coherent impulse record follows the round into survivors, deaths and
    // cops. Weapon knock, caliber and remaining range energy now affect the
    // reaction; the exact ray direction replaces generic "away from player".
    const force = (3.0 + ((w.knock || 1) * 2.7)) * (0.72 + cal * 0.28) * Math.sqrt(Math.max(0.25, fall));
    const fling = w.key === "shotgun" && hit.dist <= 7 ? 6.5 : Math.max(1.4, force * 0.38);
    const imp = {
      fromX: fx, fromZ: fz, dir: dir, force: force, fling: fling,
      cal: cal, wkey: w.key, dist: hit.dist, point: hit.point,
      share: w.pellets > 1 ? 1 / w.pellets : 1,     // one pellet's part of the blast (CBZ.verbs.shot)
      headshot: !!hit.head, byPlayer: true,
    };
    if (a.gang && CBZ.cityGangProvoke) CBZ.cityGangProvoke(a.gang, 0.4);
    let down = false, dropped = false;
    if (a.kind === "cop") {
      CBZ.cityHurtCop && CBZ.cityHurtCop(a, lethalHead ? 9999 : dmg, imp);
      down = !!a.dead;
      if (!down) vitalsRound(a, hit, w, cal, false);                 // he bleeds from it
    } else if (w.nonlethal) {
      CBZ.cityKOPed && CBZ.cityKOPed(a, fx, fz); down = true;       // taser → KO
    } else {
      if (lethalHead) a.hp = 0; else a.hp -= dmg;
      // THE BODY DECIDES (systems/vitals.js): the head, the heart, a riddled
      // chest kill here; a man whose hp ran out otherwise goes DOWN, awake,
      // bleeding hard, and dies of it only if nobody wraps it in time
      const vr = vitalsRound(a, hit, w, cal, a.hp <= 0);
      const dies = vr ? vr.outcome === "dead" : a.hp <= 0;
      if (dies) { CBZ.cityKillPed && CBZ.cityKillPed(a, imp, hit.head ? "headshot" : "shot"); down = true; }
      else if (vr && vr.outcome === "down") {
        a.hp = Math.max(1, a.hp);            // alive: vitals holds him on the floor
        dropped = true;
        const supp = !!(CBZ.gunModsSuppressed && CBZ.gunModsSuppressed(CBZ.currentWeaponId));
        CBZ.cityAlarm && CBZ.cityAlarm(a.pos.x, a.pos.z, supp ? 6 : 16, 1, CBZ.city.playerActor);
        a.rage = null; a.state = "flee";
      }
      else {
        // a suppressed round barely carries — far fewer bystanders snap to it
        const supp = !!(CBZ.gunModsSuppressed && CBZ.gunModsSuppressed(CBZ.currentWeaponId));
        CBZ.cityAlarm && CBZ.cityAlarm(a.pos.x, a.pos.z, supp ? 6 : 16, 1, CBZ.city.playerActor);
        // a living man takes the round on his rig: zone, caliber, steps
        // (CBZ.verbs.shot); the old slide + limb flail only for a body with no rig
        if (!shotLiving(a, hit, w, shotDir, cal)) CBZ.body && CBZ.body.hit(a, { fromX: fx, fromZ: fz, dir: dir, force: force * (hit.head ? 1.2 : 1) });
        // getting shot provokes fight-or-flight. ANYONE HOLDING A GUN shoots BACK —
        // a person who's strapped and gets hit draws and returns fire (self-defence),
        // even a normally-meek civilian. Only the UNARMED + non-bold flee.
        const B = (CBZ.CITY && CBZ.CITY.aggro) || {};
        if (!a.rage) {
          if (a.armed || a.aggr >= (B.bold || 0.5)) { a.rage = CBZ.city.playerActor; a.state = "fight"; a.alarmed = Math.max(a.alarmed || 0, 6); }
          else { a.state = "flee"; a.alarmed = Math.max(a.alarmed || 0, 6); }
        }
      }
    }
    // every connecting shot pops the target's head (same juice as the prison) —
    // the death/cop paths route through their own systems, so flash explicitly.
    if (CBZ.body && CBZ.body.flash) CBZ.body.flash(a);
    if (CBZ.doHitstop) CBZ.doHitstop(hit.head ? 0.085 : 0.05);
    if (lethalHead && down && CBZ.doSlowmo) CBZ.doSlowmo(0.18);
    else if (hit.head && CBZ.doSlowmo) CBZ.doSlowmo(0.1);   // reward a non-fatal headshot too
    return { head: hit.head, down, dropped, dmg };
  }

  function gunHit(hit, w, shotDir) {
    const a = hit.actor;
    if (CBZ.game.mode === "city") return cityGunHit(a, hit, w, shotDir);
    const guardish = a.kind === "guard" || a.kind === "warden";
    if (a.hp == null) a.hp = maxHpOf(a);
    // (e) same shared per-class falloff evaluator as cityGunHit above.
    const fall = CBZ.weaponFalloffMul ? CBZ.weaponFalloffMul(w, hit.dist)
      : (hit.dist <= w.dropStart ? 1 : Math.max(w.minDamage, 1 - ((hit.dist - w.dropStart) / Math.max(1, w.range - w.dropStart)) * (1 - w.minDamage)));
    let dmg = Math.max(1, Math.round(w.damage * (hit.head ? w.headMult : 1) * fall));
    let lethalHeadshot = hit.head && !w.nonlethal;
    /* WORN ARMOUR (city/armor.js's kit, dressed on a prison body: the tower
       posts wear a plate carrier and a helmet). The plate eats most of a
       body round while it lasts; the helmet turns a head shot from the end
       into a hard knock. Both wear down, the same pool the city drains. */
    const kit = a._armorKitMap;
    if (kit && (a._armor || 0) > 0 && !w.nonlethal) {
      const K = CBZ.ARMOR_KITS || {};
      if (hit.head && kit.head) {
        lethalHeadshot = false;
        const eat = Math.round(dmg * (1 - ((K[kit.head] && K[kit.head].headFrac) || 0.25)));
        a._armor = Math.max(0, a._armor - eat); dmg = Math.max(1, dmg - eat);
      } else if (!hit.head && kit.chest) {
        const eat = Math.round(dmg * ((K[kit.chest] && K[kit.chest].absorb) || 0.7));
        a._armor = Math.max(0, a._armor - eat); dmg = Math.max(1, dmg - eat);
      }
      if (CBZ.sfx) { try { CBZ.sfx("hit", { dist: hit.dist, volume: 0.5, ghost: true }); } catch (e) {} }
    }
    if (lethalHeadshot) a.hp = 0;
    else a.hp -= dmg;

    // A surviving prison target now enters the SAME directional body-impulse
    // contract as a surviving city target. Previously jail rounds exposed only
    // root knockback, then reactions.js guessed a 0.55-rad torso hinge from the
    // player's position—the torch hand folded through the face and the real ray
    // direction was lost. Keep the established root shove below; this record
    // supplies the missing direction/energy to the pose without changing travel.
    if (!w.nonlethal && !lethalHeadshot && a.hp > 0 && !shotLiving(a, hit, w, shotDir, caliber(w)) && CBZ.body && CBZ.body.hit) {
      const cal = caliber(w);
      const force = (3.0 + ((w.knock || 1) * 2.7)) * (0.72 + cal * 0.28) * Math.sqrt(Math.max(0.25, fall));
      const dir = shotDir ? { x: shotDir.x, y: shotDir.y, z: shotDir.z } : null;
      CBZ.body.hit(a, {
        fromX: CBZ.player.pos.x, fromZ: CBZ.player.pos.z,
        dir: dir, force: force, cal: cal, wkey: w.key,
        dist: hit.dist, point: hit.point, byPlayer: true,
      });
    }
    if (CBZ.knockback) CBZ.knockback(a, CBZ.player.pos.x, CBZ.player.pos.z, w.knock * (hit.head ? 1.25 : 1));
    if (guardish) a.hunt = 3;
    else if (CBZ.provokeGang) CBZ.provokeGang(a, 12);

    if (w.nonlethal) {
      a.hp = Math.max(a.hp, 28);
      // the taser: the legs go, the muscles lock, he is conscious and cuffable
      if (CBZ.vitals && CBZ.vitals.tase) { try { CBZ.vitals.tase(a, 6, { by: CBZ.player }); } catch (e) { /* vitals off */ } }
      a.ko = Math.max(a.ko || 0, guardish ? 4.5 : 5.5);
      a.aiState = a.aiState === "fight" ? "flee" : a.aiState;
      CBZ.game.kos = (CBZ.game.kos || 0) + 1;
      if (CBZ.game.koLog) CBZ.game.koLog[a.data.name] = true;
      if (!guardish && a.gang >= 0 && CBZ.noteGangIncident) CBZ.noteGangIncident(a, "ko", 7, { source: w.key || "taser" });
      if (CBZ.killstreakOnDown) CBZ.killstreakOnDown(a, w.key);
      CBZ.doHitstop && CBZ.doHitstop(0.075);
      if (CBZ.econ && CBZ.econ.lootActor) CBZ.econ.lootActor(a, {}); // frisk the stunned target
      return { head: false, down: true, dmg };
    }

    // THE BODY DECIDES in the prison (systems/vitals.js): the head, the heart
    // or a riddled chest kill; hp run out otherwise = DOWN, awake, bleeding.
    // The gun game and warlord keep their fast hp deaths; the round still
    // opens a bleed in every survivor (drips, a trail, a slower man).
    const vitalsDecides = CBZ.game.mode === "escape";
    const vr = vitalsRound(a, hit, w, caliber(w), vitalsDecides && a.hp <= 0);
    const dies = vitalsDecides && vr ? vr.outcome === "dead" : (lethalHeadshot || a.hp <= 0);
    let down = false, dropped = false;
    if (!dies && vr && vitalsDecides && vr.outcome === "down") { a.hp = Math.max(1, a.hp); dropped = true; }
    if (dies && !a.dead) {
      down = true;
      if (CBZ.aiKill) CBZ.aiKill(a, { group: CBZ.playerChar.group }, { noKnock: true, exit: goreOpts(hit, w, caliber(w)).exit });
      else { a.dead = true; a.ko = 0; a.hp = 0; }
      if (CBZ.game.koLog) CBZ.game.koLog[a.data.name] = true;
      if (CBZ.killstreakOnDown) CBZ.killstreakOnDown(a, w.key);
      CBZ.doHitstop && CBZ.doHitstop(hit.head ? 0.085 : 0.055);
      if (hit.head && CBZ.doSlowmo) CBZ.doSlowmo(0.18);
    }
    return { head: hit.head, down, dropped, dmg: lethalHeadshot ? maxHpOf(a) : dmg };
  }

  // ---- firing and reload control ----
  function finishReloadStep() {
    const w = WEAPONS[reloadWeapon];
    const cap = magOf(reloadWeapon);   // extended/drum mag capacity (gunmods.js)
    if (reloadWeapon !== fps.weapon) { fps.reloading = 0; syncAmmo(); setAmmoHud(); return; }

    if (w.shellReload) {
      if (fps.rounds[reloadWeapon] < cap && fps.reserves[reloadWeapon] > 0) {
        fps.rounds[reloadWeapon]++;
        fps.reserves[reloadWeapon]--;
        CBZ.sfx && CBZ.sfx("shell");
      }
      if (fps.rounds[reloadWeapon] < cap && fps.reserves[reloadWeapon] > 0 && !triggerHeld) {
        fps.reloading = w.reload;
      } else {
        fps.reloading = 0;
        CBZ.sfx && CBZ.sfx("rack");
        // the rack you HEAR is a rack you see: the pump slides back and home
        // under the off hand (first person, and the third-person gun rides
        // the same stroke off CBZ.fpsPumpRack)
        if (w.pump) pumpT = 1;
      }
      syncAmmo();
      setAmmoHud();
      return;
    }

    const need = cap - fps.rounds[reloadWeapon];
    const give = Math.min(need, fps.reserves[reloadWeapon]);
    fps.rounds[reloadWeapon] += give;
    fps.reserves[reloadWeapon] -= give;
    fps.reloading = 0;
    CBZ.sfx && CBZ.sfx("rack");
    syncAmmo();
    setAmmoHud();
  }

  function reload() {
    if (!(fps.active || shoulderActive()) || !armed()) return;
    const w = weapon();
    if (fps.reloading > 0 || fps.rounds[fps.weapon] >= magOf(fps.weapon) || fps.reserves[fps.weapon] <= 0) return;
    reloadWeapon = fps.weapon;
    fps.reloading = w.reload;
    CBZ.sfx && CBZ.sfx("reload");
    setAmmoHud();
  }

  // ---- ratchet declaration (see CBZ.prisonPromptAudit in interactions.js).
  // act:null = the key glyph is gone but the ACTION already had a touch
  // surface, so a second pill would be duplicate chrome.
  (CBZ._prisonPromptSites || (CBZ._prisonPromptSites = [])).push(
    { id: "dryfire", act: null, was: "Empty - press R", surface: "#treload" }
  );

  function dryClick() {
    if (dryCD > 0) return;
    dryCD = 0.22;
    CBZ.sfx && CBZ.sfx("empty");
    // PRISON_TOUCH_PROMPTS: "press R" is unactionable on a touchscreen. No pill
    // is needed here — touch.js already ships a RELOAD button (#treload, wired
    // to CBZ.fpsReload), so the fix is to name the surface the player HAS.
    const ptp = !CBZ.CONFIG || CBZ.CONFIG.PRISON_TOUCH_PROMPTS !== false;
    const touch = !!(CBZ.touchMode || (document.body && document.body.classList.contains("touch")));
    const dry = ptp && touch ? "Empty - tap RELOAD" : "Empty - press R";
    // THE CHIP ALREADY SAYS IT. The shared hotbar draws a dry gun with the
    // empty marker, and a dry-fire click is the other half. Both were on
    // screen while this line printed the same fact in words.
    if (CBZ.jailTell) CBZ.jailTell.hint(fps.reserve > 0 ? dry : "No reserve ammo", 1.0);
    else if (CBZ.flashHint) CBZ.flashHint(fps.reserve > 0 ? dry : "No reserve ammo", 1.0);
  }

  /* A THRUST WITH THE DRAWN BLADE. Its own cooldown (`shotCD`, the same field
     the guns use — one weapon rhythm, not two) and its own reach, both read
     from the weapon row so the shank's speed is tuning data and not a constant
     buried in a shooter. The first-person hand swings silently: the stab's
     audio is the hit, and `triggerFistPunch`'s whoosh is a bare-knuckle cue. */
  /* THE DEAD ARE STILL THERE. aimedActor() looks for the living; with nobody
     standing in reach, a body on the floor in front of you is what the blade
     or the fist goes into. A ray at the lying rig (findCorpseHit), no further
     than a arm's reach along the floor. */
  function aimedCorpse(reach) {
    aimForward(fwd);
    const p = CBZ.player;
    if (shoulderActive()) eye.copy(CBZ.camera.position);
    else eye.set(p.pos.x, p.pos.y + (p.prone ? 0.55 : p.crouch ? 1.18 : 1.65), p.pos.z);
    const far = (shoulderActive() ? eye.distanceTo(p.pos) : 0) + 2.6;
    const wall = wallDistance(eye, fwd, far);
    const hit = findCorpseHit(eye, fwd, wall ? Math.max(0.1, wall.distance - 0.04) : far);
    if (!hit || Math.hypot(hit.point.x - p.pos.x, hit.point.z - p.pos.z) > reach) return null;
    return hit;
  }
  function strikeCorpse(blade) {
    const c = aimedCorpse(1.6);
    if (!c) return false;
    const dir = { x: fwd.x, y: fwd.y, z: fwd.z };
    if (blade && CBZ.corpseStab) CBZ.corpseStab(c.corpse, c.point, dir, { by: CBZ.player });
    else if (CBZ.bodyFall && CBZ.bodyFall.poke) CBZ.bodyFall.poke(c.corpse, dir.x, dir.z, 2.4, c.point);   // a fist or a boot: a shove, no mark
    triggerFistPunch(true);
    CBZ.sfx && CBZ.sfx(blade ? "hit" : "punch");
    return true;
  }
  function meleeStrike(w) {
    if (shotCD > 0) return;
    shotCD = w.interval || 0.42;
    const hit = aimedActor(w.range || MELEE);
    if (!(hit && hit.actor) && strikeCorpse(true)) return;
    const strike = CBZ.prisonStab || CBZ.punch;
    if (!strike) { triggerFistPunch(true); CBZ.sfx && CBZ.sfx("step"); return; }
    const r = strike(hit && hit.actor);
    // the first-person hand swings AFTER the body has its kind and clock, so
    // both views run the same stab on the same beat
    if (r && r.ok) triggerFistPunch(true);
    if (r && r.msg) { if (CBZ.jailTell) CBZ.jailTell.hint(r.msg, 2.4); else if (CBZ.flashHint) CBZ.flashHint(r.msg, 2.4); }
  }

  /* ============================================================ ONE ROUND, LANDED
     EVERY consequence of a bullet arriving somewhere: the glass it went
     through, the flesh, the corpse, the crowd, the aircraft, the car, the wall
     — plus penetration and ricochet. This used to be the INSIDE of shoot()'s
     per-pellet loop, which is exactly why it could only ever describe a
     hitscan round: to be a projectile a bullet has to be able to arrive on a
     LATER frame than the trigger pull, and none of this could be reached from
     there. It is otherwise unchanged, line for line.

     `acc` is the trigger pull's tally (head / down / hitSomething / the two
     thud distances) — a shotgun fires nine of these and gets ONE hit marker,
     and a flown rifle round carries its own so the marker arrives with it. */
  function newLand(a) {
    a = a || {};
    a.head = false; a.down = false; a.hitSomething = false;
    a.wallThud = -1; a.carThud = -1;
    return a;
  }
  function roundFeedback(w, cal, acc) {
    // Impact thud by caliber: a 7.62 lands a deeper, louder concrete smack.
    // Once per trigger pull (or once per flown round), never over the flesh foley.
    if (acc.wallThud >= 0 && !acc.hitSomething) surfaceThud("hit", cal, acc.wallThud);
    // HIT MARKER: one flash per round that connected. Kills paint it red.
    // (no "HEADSHOT"/"TARGET DOWN" text — the marker, gore and foley own the kill)
    if (acc.hitSomething) flashHitMarker(acc.down, acc.head);
    if (acc.head) { CBZ.sfx && CBZ.sfx("headshot"); }
    else if (acc.hitSomething) { CBZ.sfx && CBZ.sfx("hit"); }
  }
  /* `segReach` is set ONLY by a flown bullet: the length of the SEGMENT this
     round covered on this frame. It exists because updateBullets rewrites
     hit.dist to the true travelled distance (the damage falloff, the impact
     LOD and the bullet-hole ladder all mean "how far has this round flown"),
     and the glass ray below means something completely different — how far
     along THIS segment to look for a pane. Left conflated, a 300 m sniper
     round shattered every window within 300 m of where it landed. */
  function landRound(w, hit, shotDir, origin, cal, acc, segReach) {
      // city: a window in this pellet's path shatters (glass never blocks the
      // shot). EVERY round breaks the pane it actually passes through, out to
      // wherever the bullet really travels (reach = the hit distance, already
      // bounded by the wall/actor it strikes and the weapon's range). A 9mm
      // round through a far window breaks it just like a rifle slug does — the
      // old caliber clamp (GLASS_PISTOL_REACH) made only rifles break far glass.
      // FIX 5 — GLASS-BEHIND-WALL POCK SUPPRESSION. cityShatterRay publishes the
      // muzzle-ray distance at which it just broke a pane (CBZ.cityLastShatterDist,
      // -1 if nothing broke). When THIS round broke a pane and the solid wall the
      // raycast returned sits at (or just behind) that pane, the wall hit is really
      // a wall BEHIND a now-open window — stamping a pock there double-marks a fresh
      // break (the filmed bug: a fresh window break also pocks the wall behind it).
      // We compare WORLD impact points because cityShatterRay measures from the
      // muzzle `origin` while resolveShot measures `hit.dist` from the camera `eye`
      // — different frames; the pane's world point is origin+shotDir*lastShatterDist.
      let glassPockSuppress = false;
      if (CBZ.game.mode === "city" && CBZ.cityShatterRay) {
        // POINT-BLANK FIX (owner: "shoot a window close-up → it shoots through
        // it"). The muzzle `origin` sits ~0.6-0.9m FORWARD of the eye, so pressing
        // the barrel to a pane puts the muzzle PAST the glass. cityShatterRay only
        // breaks a pane the ray CROSSES going forward, so a pane entirely behind
        // the muzzle is never tested and survives the shot. Start the glass ray at
        // the EYE instead — always on the near side of whatever the player is up
        // against — and extend the reach by the same pull-back so the far endpoint
        // is unchanged. FP: the camera IS the eye, so back up exactly to it (a pane
        // BEHIND the eye then lands at negative t and is correctly ignored). TP
        // (shoulder cam — the lens hangs metres back, so it is NOT the eye): a
        // bounded pull-back behind the muzzle reaches the near side without reaching
        // a pane behind the player. Backing up ALONG -shotDir keeps the ray colinear
        // with the shot (no parallax onto a neighbouring pane).
        // a flown round starts its glass ray where it actually was; only a
        // muzzle shot needs the pull-back to the eye (see above).
        let gback = segReach != null ? 0.05 : 1.0;
        if (segReach == null && fps.active && CBZ.camera) gback = Math.min(6.5, origin.distanceTo(CBZ.camera.position));
        const gox = origin.x - shotDir.x * gback, goy = origin.y - shotDir.y * gback, goz = origin.z - shotDir.z * gback;
        const reach = (segReach != null ? segReach + 0.5 : (hit.dist != null ? hit.dist + 0.5 : w.range)) + gback;
        CBZ.cityShatterRay(gox, goy, goz, shotDir.x, shotDir.y, shotDir.z, reach,
          true, { directPlayer: true });
        const sd = CBZ.cityLastShatterDist;
        if (sd != null && sd >= 0 && hit.wall && hit.point) {
          // pane world impact along the (eye-anchored) glass ray
          const gpx = gox + shotDir.x * sd, gpy = goy + shotDir.y * sd, gpz = goz + shotDir.z * sd;
          const ddx = hit.point.x - gpx, ddy = hit.point.y - gpy, ddz = hit.point.z - gpz;
          // wall sits within the pane's offset + a wall depth (≈0.62) past it (or
          // essentially coincident) → it's the wall behind the just-broken glass.
          if (ddx * ddx + ddy * ddy + ddz * ddz < 0.95 * 0.95) glassPockSuppress = true;
        }
      }
      if (hit.actor) {
        acc.hitSomething = true;
        const r = gunHit(hit, w, shotDir);
        acc.head = acc.head || r.head;
        acc.down = acc.down || r.down;
        // taserfx owns the contact glow/arcs; the generic round impact is a
        // large white bullet spark that visually erases the two probe contacts.
        if (w.key !== "taser") spawnImpact(hit.point, !w.nonlethal, w.key === "shotgun", cal);
        // One small flesh response per round/pellet. The death path already emits
        // its single full gore event; calling that here as well used to create a
        // pool-sized explosion for every pellet in a shotgun blast.
        if (!w.nonlethal && !hit.actor.animal && CBZ.gore && CBZ.gore.spray) {
          const wet = w.pellets ? 0.34 : (r.head ? 0.95 : 0.58) * Math.max(0.7, cal);
          CBZ.gore.spray(hit.point, wet, shotDir, goreOpts(hit, w, cal));
        }
        // the body CARRIES the hit: a dark entry wound stamped on the struck
        // part + blood soaking into the clothing (systems/wounds.js). Per
        // pellet — a shotgun blast scatters wounds (wounds.js caps the burst).
        // `dir` is what lets wounds.js work out where the round came OUT.
        // shotDir is the normalised ray this shot was fired along and was
        // already in scope — it just was not handed over, so the player's own
        // shots produced entry marks only while SWAT fire (the one caller that
        // did pass a direction) got exits.
        if (CBZ.bodyWound && !w.nonlethal && !hit.actor.animal && (!r.down || hit.actor.kind === "cop")) CBZ.bodyWound(hit.actor, hit.point, { head: hit.head, cal, dir: shotDir });
      } else if (hit.corpse) {
        // DOWNED BODY (every game): keep shooting it — it accumulates holes AND
        // jerks. CBZ.corpseHit (systems/bodyfall.js) re-kicks a verlet slot
        // (city/ragdoll.js) or shoves and jolts a body lying in its collapse,
        // and STAMPS the wound itself — so we do NOT call bodyWound here (that
        // would double-stamp). Force scales with caliber on the same scale
        // cityRagdoll uses (~6 pistol .. ~14 shotgun).
        acc.hitSomething = true;
        const force = (w.pellets ? 5.2 : 4.4) * (0.65 + 0.42 * cal) * (w.knock || 1);
        const took = CBZ.corpseHit ? CBZ.corpseHit(hit.corpse, hit.point, shotDir, force, { cal, head: hit.head, by: CBZ.player }) : false;
        if (!took && !w.nonlethal) {
          if (CBZ.bodyWound) CBZ.bodyWound(hit.corpse, hit.point, { head: hit.head, cal, dir: shotDir });
          if (CBZ.vitals) CBZ.vitals.wound(hit.corpse, { kind: "bullet", point: hit.point, head: hit.head, cal });   // the pool grows
        }
        spawnImpact(hit.point, !w.nonlethal, w.key === "shotgun", cal);
        if (!w.nonlethal && CBZ.gore && CBZ.gore.spray) CBZ.gore.spray(hit.point, w.pellets ? 0.28 : 0.42 * cal, shotDir, goreOpts(hit, w, cal));
        // Only a muzzle-close shotgun headshot can sever even post-mortem
        // (gore.js's decap read), guarded so one head only severs once. Live kills
        // route this through cityKillPed's killCtx; a corpse has no kill ctx, so we
        // drive the public sever directly. Non-heavy guns never reach here.
        if (CBZ.game.mode === "city" && hit.head && !w.nonlethal && !hit.corpse._decapped
            && CBZ.goreSever && w.key === "shotgun" && hit.dist <= 5.5) {
          if (CBZ.goreSever(hit.corpse, "head", { dir: shotDir })) hit.corpse._decapped = true;
        }
      } else if (hit.crowd != null) {
        // shot an ambient crowd member (the far NPCs that used to be unkillable)
        acc.hitSomething = true;
        if (!w.nonlethal && CBZ.cityCrowdKill) { CBZ.cityCrowdKill(hit.crowd, { head: hit.head, fromX: origin.x, fromZ: origin.z }); acc.down = true; }
        acc.head = acc.head || hit.head;
        spawnImpact(hit.point, !w.nonlethal, w.key === "shotgun", cal);
        if (!w.nonlethal && CBZ.gore && CBZ.gore.spray) CBZ.gore.spray(hit.point, hit.head ? 0.9 : 0.55, shotDir, goreOpts(hit, w, cal));
      } else if (hit.aircraft) {
        // bullets chip the gunship — sparks off the hull, damage routed to the heli
        acc.hitSomething = true;
        if (CBZ.cityAircraftDamage) CBZ.cityAircraftDamage(w.damage, origin.x, origin.z);
        spawnImpact(hit.point, false, true);
        if (CBZ.bulletImpact) CBZ.bulletImpact(hit.point, { x: -shotDir.x, y: 0.4, z: -shotDir.z }, { kind: "spark", power: 1.3 });
      } else if (hit.lightAir) {
        // plain gunfire on Air-1 / the ambient GA fleet: route the round into the
        // module's own hp pool (police.js / airtraffic.js) via the callback the ray
        // test attached — a small per-bullet chip, so it takes a burst. Same spark +
        // decal feedback as the gunship; the module owns the wounded-smoke + down arc.
        acc.hitSomething = true;
        if (hit.lightAir.hitBullet) hit.lightAir.hitBullet(w.damage, origin.x, origin.z, hit.lightAir.rec);
        spawnImpact(hit.point, false, true);
        if (CBZ.bulletImpact) CBZ.bulletImpact(hit.point, { x: -shotDir.x, y: 0.4, z: -shotDir.z }, { kind: "spark", power: 1.3 });
      } else if (hit.civilAircraft) {
        // The parked gate plane itself takes the round. Damage, boarding and
        // later flight all share this record, so a wreck can never be hijacked.
        acc.hitSomething = true;
        if (CBZ.cityDamageCivilAircraft) CBZ.cityDamageCivilAircraft(hit.civilAircraft, w.damage, hit.point, { byPlayer: true });
        spawnImpact(hit.point, false, true);
        if (CBZ.bulletImpact) CBZ.bulletImpact(hit.point, { x: -shotDir.x, y: 0.35, z: -shotDir.z }, { kind: "spark", power: Math.max(1, cal) });
      } else if (hit.car) {
        // CALIBER vs SHEET METAL: real engine damage (rifle rounds punch panels
        // ~2x harder than a 9mm; heavy rounds also dent), a panel shudder, paint
        // chips in THIS car's coat, and a persistent hole that RIDES the panel.
        const car = hit.car;
        if (CBZ.cityDamageCar) CBZ.cityDamageCar(car, (w.pellets ? 1.7 : 4.2) * cal, { byPlayer: true, crumple: cal >= 1.0, point: hit.point, normal: hit.normal, cal: cal });
        spawnImpact(hit.point, false, cal >= 1.3);
        if (CBZ.bulletImpact) {
          CBZ.bulletImpact(hit.point, hit.normal, { kind: "spark", power: cal });
          if (hit.dist < 45) CBZ.bulletImpact(hit.point, hit.normal, { kind: "chip", power: cal * 0.8, color: car.color });
        }
        if (CBZ.bulletHole && car.group) CBZ.bulletHole(hit.point, hit.normal, { size: 0.12 + cal * 0.1, parent: car.group, dist: hit.dist, car: true });
        carShudder(car, cal);
        if (acc.carThud < 0) acc.carThud = hit.dist;
      } else if (hit.wall && glassPockSuppress) {
        // FIX 5: the "wall" the ray returned is the solid wall BEHIND a pane this
        // round just shattered — the bullet really flew through the fresh hole, so
        // we stamp NO mark on the wall behind the glass (no pock, no spark/dust, no
        // thud). The glass break + its shards/SFX already came from cityShatterRay
        // above. Once the pane is open, follow-up rounds get hit.wall === false
        // (cityShotHole skips the open frame) and fly past normally.
      } else if (hit.wall) {
        // B5: a confirmed losBlockers hit whose struck object carries
        // userData.pieceId (systems/pieces.js stamps this on every piece
        // mesh it builds) is a player-built piece taking a bullet — chip it
        // for the weapon's base damage (structdamage.js applies the wood-
        // tier bullet mult, ~0.35, so ~30 rifle rounds fell a 250hp wall).
        // Only wall/doorframe-shaped pieces register as losBlockers today
        // (systems/building.js's blockLOS flags), so this is the whole
        // hit-testable set this wave; other bullet paths (car/actor/corpse/
        // crowd/aircraft above) have no piece concept to hook.
        const wallObj = hit.wallHit && hit.wallHit.object;
        const pieceId = wallObj && wallObj.userData && wallObj.userData.pieceId;
        if (pieceId != null && CBZ.structDamage) CBZ.structDamage.hit(pieceId, w.damage, "bullet");
        spawnImpact(hit.point, false, cal >= 1.3);
        // surface normal of the struck wall (faces back toward the shooter):
        // walls in this game are near-vertical, so reflect the shot dir onto the
        // horizontal plane for a believable ricochet cone + a persistent hole.
        const nx = -shotDir.x, nz = -shotDir.z;
        const nl = Math.hypot(nx, nz) || 1;
        const wnx = nx / nl, wnz = nz / nl;
        if (CBZ.bulletImpact) {
          // the struck face's OWN material + colour: the impact throws chips
          // of what was hit (gunfx.js: sparks only off metal)
          const surf = surfaceAt(hit.wallHit);
          CBZ.bulletImpact(hit.point, { x: wnx, y: 0.18, z: wnz }, { kind: "spark", power: cal, material: surf.material, object: surf.object, color: surf.color });
          // heavy rounds CHEW concrete: a second dust kick + the odd chunk
          // knocked clean off the face (LOD: only worth drawing inside ~45u)
          if (cal >= 1.2 && hit.dist < 45) {
            CBZ.bulletImpact(hit.point, { x: wnx, y: 0.3, z: wnz }, { kind: "dust", power: cal - 0.3, material: surf.material, object: surf.object, color: surf.color });
            if (CBZ.cityChunk && rng() < (cal - 1.1) * 0.45) CBZ.cityChunk(hit.point.x, hit.point.y, hit.point.z, { count: 1, force: 1.6, material: surf.material, color: surf.color, dirx: wnx, dirz: wnz });
          }
        }
        // persistent pock — static walls remember the hit in world space;
        // moving doors carry the same mark with the panel when they open.
        // The hole lies on the STRUCK FACE's own normal (not the shot direction
        // flattened to horizontal — that tilted every oblique hole off the
        // wall) and is drawn in the struck material (gunfx.js atlas).
        if (CBZ.bulletHole) {
          const hs = surfaceAt(hit.wallHit);
          const fn = faceNormalOf(hit.wallHit, shotDir);
          CBZ.bulletHole(hit.point, fn || { x: wnx, y: 0, z: wnz }, {
            size: 0.15 + cal * 0.13, dist: hit.dist,
            parent: wallWoundParent(hit.wallHit),
            material: hs.material, object: hs.object,
          });
        }
        else if (CBZ.cityBulletHole) CBZ.cityBulletHole(hit.point.x, hit.point.y, hit.point.z, wnx, 0, wnz);
        // rifle-class rounds CHEW: sustained heavy fire on one wall cell quietly
        // grinds open a murder hole (city/fracture.js counts per 1.2u cell)
        if ((CBZ.modeHas ? CBZ.modeHas("breach") : CBZ.game.mode === "city") &&
            cal >= 1.2 && !w.pellets && CBZ.cityFracture && CBZ.cityFracture.chewWall)
          CBZ.cityFracture.chewWall(hit.point.x, hit.point.y, hit.point.z);
        if (acc.wallThud < 0) acc.wallThud = hit.dist;
        // (d) PENETRATION / RICOCHET — purely additive flavor on top of the
        // normal wall mark above; rare + telegraphed (see the function header).
        tryPenetrateOrRicochet(w, hit, shotDir, cal, wnx, wnz);
      }
  }

  /* ============================================================ PROJECTILES
     THE ROUND LEAVES THE BARREL AND THEN IT HAS TO GET THERE.

     WHAT WAS WRONG. Every bullet in this game was a Raycaster call in the same
     frame as the trigger pull, and the ONE weapon that pretended otherwise —
     the sniper — did it by bending a hitscan ray downward by an invented angle
     and delaying the HIT MARKER by an invented number of milliseconds. So a
     400 m shot arrived instantly, drop was a cosmetic nudge nobody could aim
     around, and the scope's mil ticks marked nothing.

     WHAT IS TRUE NOW. A rifle-class round is a real body: it leaves the muzzle
     at the cartridge's published velocity, loses speed to drag at a rate
     solved from that cartridge's published retained velocity at 300 m, and
     falls at 9.81 m/s^2 the whole way. Each frame it resolves the SEGMENT it
     covered (one raycast, through the same resolveShot every hitscan round
     uses, so cover, cars, glass and actors all behave identically) and lands
     through landRound() above the instant it touches something.

     WHICH WEAPONS. The test is the CARTRIDGE, not a list of names:
     v0 >= 600 m/s is the rifle line — carbine, AK, M249, the M24. Below it sit
     the pistols, the SMGs and the shotgun, and they stay hitscan on purpose:
     their engagement bands top out around 90 m, where a 9 mm at 360 m/s has
     dropped 3.7 cm, which is under half a torso width and invisible. Flying
     them would cost a raycast a frame each to model something no player can
     see. Pellet weapons are excluded outright (nine flying bodies per trigger
     pull for a gun whose whole character is the cone).

     ?cfg_WEAPON_BALLISTICS=0 puts every weapon back on hitscan — the one
     subsystem-level revert this pass ships. */
  const GRAV = 9.81;
  function ballisticRound(w) {
    return !!(w && w.v0 >= 600 && !w.pellets && !w.melee && !w.explosive &&
      CBZ.CONFIG.WEAPON_BALLISTICS !== false);
  }
  /* Time of flight to `dist`, integrated the same way the live bullet is
     stepped: v(t) = v0 * exp(-dragK * t), so distance is the integral of that
     and the inverse has a closed form. Used by the latency audit and by any
     tool asking "how long is this round in the air". */
  function bulletFlightTime(w, dist) {
    const v0 = w.v0 || 0, k = w.dragK || 0;
    if (v0 <= 0) return 0;
    if (k <= 1e-4) return dist / v0;
    const reach = v0 / k;                     // asymptotic maximum travel
    if (dist >= reach * 0.999) return 12;     // never gets there
    return -Math.log(1 - dist / reach) / k;
  }
  CBZ.bulletFlightTime = bulletFlightTime;
  /* THE DROP, in metres, of a level shot at `dist`. Not used by the sim (the
     live bullet just falls); published because a probe has to be able to state
     the holdover the mil ticks are for, and re-deriving it in the tool is how
     a tool ends up measuring its own arithmetic. */
  CBZ.bulletDrop = function (w, dist) {
    if (!ballisticRound(w)) return 0;
    const t = bulletFlightTime(w, dist);
    return 0.5 * GRAV * t * t;
  };

  const BULLET_MAX = 24;
  const bullets = [];
  for (let i = 0; i < BULLET_MAX; i++) {
    bullets.push({ live: false, w: null, cal: 1, t: 0, dist: 0, max: 0,
                   x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, acc: newLand() });
  }
  let bulletIdx = 0;
  /* ONE integration step. At 900 m/s a frame is ~15 m of travel and the
     gravity sag WITHIN that step is 1.4 mm, so the frame-length segment
     between two of these is a straight enough line to raycast and sub-stepping
     buys nothing. Drag is exponential velocity decay at the cartridge's own
     dragK; gravity is 9.81 and applies to the vertical channel only. */
  function stepBullet(b, dt) {
    const k = b.w.dragK || 0;
    const decay = k > 0 ? Math.exp(-k * dt) : 1;
    b.vx *= decay; b.vz *= decay;
    b.vy = b.vy * decay - GRAV * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  }
  const _bPrev = new THREE.Vector3(), _bNow = new THREE.Vector3(), _bDir = new THREE.Vector3();
  function launchBullet(w, origin, dir, cal) {
    const b = bullets[bulletIdx];
    bulletIdx = (bulletIdx + 1) % bullets.length;
    b.live = true; b.w = w; b.cal = cal; b.t = 0; b.dist = 0;
    b.max = w.range;
    b.x = origin.x; b.y = origin.y; b.z = origin.z;
    const v = w.v0 || 800;
    b.vx = dir.x * v; b.vy = dir.y * v; b.vz = dir.z * v;
    newLand(b.acc);
    return b;
  }
  function updateBullets(dt) {
    if (dt <= 0) return;
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      if (!b.live) continue;
      const w = b.w;
      _bPrev.set(b.x, b.y, b.z);
      stepBullet(b, dt);
      _bNow.set(b.x, b.y, b.z);
      b.t += dt;
      const seg = _bNow.distanceTo(_bPrev);
      b.dist += seg;
      if (seg > 1e-4) {
        _bDir.copy(_bNow).sub(_bPrev).multiplyScalar(1 / seg);
        const hit = resolveShot(w, _bDir, _bPrev, Math.min(seg, Math.max(0.2, b.max - (b.dist - seg))));
        // resolveShot always answers; a "wall:false, actor:null" answer at the
        // end of the segment is empty air and the round keeps flying.
        const struck = hit && (hit.actor || hit.wall || hit.car || hit.corpse ||
          hit.crowd != null || hit.aircraft || hit.civilAircraft || hit.lightAir);
        // the visible round IS the tracer: one short streak per frame along the
        // segment it actually covered, so the streak travels instead of drawing
        // the whole flight path in the frame the trigger was pulled.
        fireTracer(_bPrev, struck && hit.point ? hit.point : _bNow, w.tracer, 0.055);
        if (struck) {
          /* hit.dist IS MEASURED FROM THE SEGMENT, and everything downstream
             means "how far has this round flown": the damage falloff curve,
             the 45 m impact-detail LOD, the bullet-hole size ladder. Left
             alone, a 300 m sniper round would report the 13 m it covered in
             the last frame and land at point-blank damage. Rewritten to the
             true travelled distance before landRound ever sees it. */
          const segT = hit.dist || 0;
          hit.dist = (b.dist - seg) + segT;
          landRound(w, hit, _bDir, _bPrev, b.cal, b.acc, segT);
          roundFeedback(w, b.cal, b.acc);
          b.live = false;
          continue;
        }
        /* GLASS ON A SEGMENT THAT HIT NOTHING. landRound owns the pane a
           round breaks on the way to what it struck; a bullet that crosses a
           window mid-flight and carries on has no landRound call to do it, so
           the pane would survive a rifle round passing through it. Same ray,
           city only, once per segment. */
        if (CBZ.game.mode === "city" && CBZ.cityShatterRay) {
          CBZ.cityShatterRay(_bPrev.x, _bPrev.y, _bPrev.z, _bDir.x, _bDir.y, _bDir.z, seg,
            true, { directPlayer: true });
        }
      }
      if (b.dist >= b.max || b.t > 4) b.live = false;   // out of range / lost
    }
  }
  /* WHAT A LEVEL SHOT DOES AT RANGE — DRIVE-ONLY, for
     tools/warlord-cover-check.mjs. It runs the SAME stepBullet the live round
     runs, on a scratch body, with no world in the way: fire dead level from
     the origin and report how far the round has fallen by the time it has
     covered `dist`. It exists because the alternative is a tool re-deriving
     the drop in node, which measures the tool's arithmetic and not the game's.
     A hitscan weapon answers 0, which is the truthful answer for one. */
  CBZ.fpsBallisticProbe = function (id, dist) {
    const w = CBZ.weaponById ? CBZ.weaponById(id) : null;
    if (!w) return null;
    const out = { id: id, ballistic: ballisticRound(w), v0: w.v0 || 0, dist: dist,
                  drop: 0, tof: 0, vEnd: w.v0 || 0 };
    if (!out.ballistic) return out;
    const b = { w: w, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: -(w.v0 || 800) };
    const h = 1 / 480;
    let flown = 0, t = 0;
    while (flown < dist && t < 6) {
      const x0 = b.x, y0 = b.y, z0 = b.z;
      stepBullet(b, h);
      flown += Math.hypot(b.x - x0, b.y - y0, b.z - z0);
      t += h;
    }
    out.drop = Math.round(-b.y * 1000) / 1000;
    out.tof = Math.round(t * 1000) / 1000;
    out.vEnd = Math.round(Math.hypot(b.vx, b.vy, b.vz));
    return out;
  };
  CBZ.fpsBulletsInFlight = function () {
    let n = 0;
    for (let i = 0; i < bullets.length; i++) if (bullets[i].live) n++;
    return n;
  };

  const _shotAcc = newLand();
  function shoot() {
    if (!(fps.active || shoulderActive() || carGun()) || CBZ.game.state !== "playing" || CBZ.player.dead || (CBZ.player.stun || 0) > 0 || (CBZ.player.driving && !carGun()) || CBZ.player._swim) return;
    if (!armed()) {
      if (CBZ.game.mode === "city") return;   // city/combat.js owns unarmed melee in the city
      const hit = aimedActor(MELEE);
      if (!(hit && hit.actor) && punchCD <= 0 && strikeCorpse(false)) { punchCD = 0.38; return; }
      // A PUNCH IS A PUNCH. The swing animates, the body reacts, the health
      // moves; the returned sentence describing all three was the caption.
      // The hand swings AFTER combat.js has agreed to the punch (it is the one
      // that knows the kind and the arm, and whether a swing is still in
      // flight) — the hand used to swing on every click, punch or no punch.
      if (CBZ.punch) {
        const r = CBZ.punch(hit && hit.actor);
        if (r && r.ok) triggerFistPunch();
        if (r && r.msg) { if (CBZ.jailTell) CBZ.jailTell.hint(r.msg, 2.4); else if (CBZ.flashHint) CBZ.flashHint(r.msg, 2.4); }
      }
      else { triggerFistPunch(); CBZ.sfx && CBZ.sfx("step"); }
      return;
    }

    const w = weapon();
    /* ---- MELEE WEAPONS DO NOT FIRE -------------------------------------
       The divert happens HERE, above every line that assumes a magazine:
       the mod lookups, the shot cooldown, the reload interrupt, the dry
       click, the round decrement, the recoil ladder, the tracer. A shank
       has none of those and faking them (a 1-round mag that "reloads")
       is how a melee weapon ends up behaving like a very short gun.

       Everything a thrust needs already exists three lines above, in the
       unarmed branch: aimedActor() finds the man in front of you and
       CBZ.punch lands on the animation's drive frame. The stab is the same
       two calls with the blade profile — systems/combat.js owns what a
       blade does; this file only owns the trigger. */
    if (w && w.melee) { meleeStrike(w); return; }
    // ---- attached weapon mods (city/gunmods.js): a suppressor kills the flash
    // + muffles the report, a muzzle brake / grip settles the recoil, a grip /
    // laser tightens the cone. All no-ops (mul 1, supp false) when nothing's on
    // the gun or gunmods.js isn't loaded, so every other mode is byte-identical.
    const _mid = weaponIdOf(fps.weapon);
    const modSupp = !!(CBZ.gunModsSuppressed && CBZ.gunModsSuppressed(_mid));
    const modRec = (CBZ.gunModsRecoilMul && CBZ.gunModsRecoilMul(_mid)) || 1;
    const modSpr = (CBZ.gunModsSpreadMul && CBZ.gunModsSpreadMul(_mid)) || 1;
    if (shotCD > 0) return;
    if (fps.reloading > 0) {
      if (w.shellReload && fps.rounds[fps.weapon] > 0) {
        fps.reloading = 0;
        CBZ.sfx && CBZ.sfx("rack");
        setAmmoHud();
      } else return;
    }
    if (fps.rounds[fps.weapon] <= 0) { dryClick(); return; }

    shotCD = w.interval;
    fps.rounds[fps.weapon]--;
    syncAmmo();
    setAmmoHud();

    // Sample intent before the discharge kicks the view. The first round leaves
    // on the aim the player saw; the next round naturally reads the kicked view.
    aimForward(preKickAim);

    const RK = 0.32;  // controlled climb; view kick still sells weapon weight
    // BURST RESET: a fire gap > 0.25s wipes the ramp + pattern position, so the
    // next round is a fresh first-shot (soft, dead-centre). sinceShot was
    // accumulated by the frame loop; reset it now that we've fired.
    if (sinceShot > 0.25) shotsInBurst = 0;
    sinceShot = 0;
    const adsK = adsRecoilMul();
    // support ladder: a loaded bipod (crouch+ADS+still, above) is the deepest
    // brace; otherwise PRONE steadies the LMG (~0.45x, physics.js's stance
    // machine publishes the hook — feature-detected so this file stands alone).
    // One choke point: supportK feeds the cosmetic recoil, side kick, bloom
    // pump AND the real pitch/yaw view kicks below.
    /* THE BRACE LADDER. A deployed bipod is the floor; below it, the stance
       the body is actually in. physics.js's playerProneSteady was an LMG-only
       special case bolted on top of a stance the gun otherwise ignored — it
       still composes, so the M249 keeps its extra prone reward, but every
       other weapon in the game now gets paid for going down too. */
    const supportK = bipodActive(w)
      ? 0.34
      : (STANCE_RECOIL[stanceOf()] || 1) * (CBZ.playerProneSteady ? CBZ.playerProneSteady(w) : 1);
    // cosmetic accumulators (viewmodel kick + reticle bloom) — unchanged feel,
    // just softened under ADS so holding RMB visibly settles the gun.
    recoil = Math.min(w.maxRecoil, recoil + w.recoil * RK * adsK * supportK * modRec);
    recoilSide += (rng() * 2 - 1) * w.sideKick * RK * adsK * supportK * modRec;
    /* SETTLE TIME IS PER WEAPON. 0.06 s for everything meant a Desert Eagle
       and an Uzi returned to centre on the same clock. `w.settle` is how long
       the muzzle stays up before the spring starts pulling it back — short on
       a light fast gun, long on a bolt gun you have to work anyway. */
    recoilHold = w.settle > 0 ? w.settle : 0.06;
    // each shot pumps bloom; auto fire stacks fast, single shots barely at all.
    // capped so even mag-dumps stay usable. moving adds extra below in the loop.
    bloom = Math.min(w.spread * 2.6, bloom + w.spread * (w.auto ? 0.9 : 0.45) * adsK * supportK);
    if (!w.noRecoil) {
      // AIM-OFFSET kick (the part that decides where bullets go) — into the
      // dedicated recoilPitch/recoilYaw channels, NOT the player's stored aim.
      const ramp = rampCurve(shotsInBurst, w.rampMax || 1.6);
      // first shot of a fresh burst is SOFTER (0.6x) + dead-centre — pinpoint tap.
      const firstShot = shotsInBurst === 0 ? 0.6 : 1;
      const basePitch = w.climb * RK;
      const jitter = 0.92 + rng() * 0.16;                       // <=8% noise
      const pitchKick = basePitch * ramp * firstShot * jitter * adsK * supportK * modRec;
      /* THE PATTERN IS THE WEAPON'S OWN. YAW_PATTERN was ONE fifteen-entry
         table shared by every automatic weapon in the game, scaled by a single
         per-gun `yawWeave` amplitude — so an AK-47 and an MP5 climbed and
         weaved through the identical shape at different sizes, and there was
         nothing to LEARN about a particular gun. A row's `spray` (weapon-data)
         is that gun's own horizontal signature; the shared table is the
         fallback for anything that has not declared one, so nothing regresses.
         Vertical climb stays w.climb x the ramp: the shape a rifle draws is
         mostly up, and the horizontal is what tells two rifles apart. */
      const sprayTab = (w.spray && w.spray.length) ? w.spray : YAW_PATTERN;
      const pat = sprayTab[shotsInBurst % sprayTab.length];
      const yawKick = (pat * (w.yawWeave || 0.6) + (rng() * 2 - 1) * 0.15) * basePitch * ramp * adsK * supportK * modRec;
      kickView(pitchKick, yawKick);
      shotsInBurst++;
    }
    pumpT = w.pump ? 1 : pumpT;
    if (w.fireMode === "bolt") boltT = 0;       // up, back, forward, down before the next round

    // a suppressor chokes the muzzle flash down to a dim spit and clips the tail
    const taserShot = w.key === "taser";
    const flashScale = (taserShot ? 0.14 : w.flash) * (0.9 + rng() * 0.28) * (modSupp ? 0.2 : 1);
    const flashT = taserShot ? 0.07 : (modSupp ? 0.02 : (w.key === "shotgun" ? 0.065 : 0.04));
    if (fps.active) {
      const activeModel = weaponModels[fps.weapon];
      if (!setMuzzleSpriteFromModel(muzzle, activeModel)) muzzle.position.copy(activeModel.userData.muzzle);
      muzzle.material.map = taserShot ? taserFlashTex : flashTex;
      muzzle.scale.setScalar(flashScale);
      muzzle.rotation.z = rng() * Math.PI * 2;
      muzzle.visible = flashScale > 0.02;
      muzzleT = flashT;
    } else {
      worldMuzzle.position.copy(muzzleWorld(tmp2));
      worldMuzzle.material.map = taserShot ? taserFlashTex : flashTex;
      worldMuzzle.scale.setScalar(flashScale * 1.2);
      worldMuzzle.material.opacity = 1;
      worldMuzzle.visible = flashScale > 0.02;
      worldMuzzleT = flashT;
    }

    if (CBZ.sfx) {
      // suppressed: drop the volume + pitch to a muffled "thup" (the audio system
      // reads {pitch,volume}); otherwise the weapon's own sfx tuning stands.
      if (modSupp || w.sfxPitch || w.sfxVol) {
        shotSfxOpts.pitch = (w.sfxPitch || 1) * (modSupp ? 0.78 : 1) * (0.96 + rng() * 0.08);  // jitter so bursts don't sound machine-stamped
        shotSfxOpts.volume = (w.sfxVol || 1) * (modSupp ? 0.34 : 1);
        CBZ.sfx(w.sfx || "shoot", shotSfxOpts);
      } else CBZ.sfx(w.sfx || "shoot");
    }
    CBZ.shake && CBZ.shake(w.shake);
    CBZ.doHitstop && CBZ.doHitstop(w.key === "shotgun" ? 0.028 : 0.014);
    if (CBZ.game.mode !== "city") CBZ.reportCrime && CBZ.reportCrime(w.heat, { type: w.nonlethal ? "taser" : "gunfire", actorRole: CBZ.game.role, weapon: w.key });
    // A taser expends a front cartridge; there is no hot brass case to eject.
    if (!taserShot) ejectCasing(w);

    const origin = muzzleWorld(tmp2);
    // Two-ray shoulder aim: camera ray establishes intent, then the actual ray
    // starts at the rendered muzzle and converges on that point. Close cover can
    // therefore catch the barrel-side shot (truthful parallax), while open-space
    // rounds still land exactly under the reticle instead of leaving the chest.
    fwd.copy(preKickAim);
    const sight = resolveShot(w, fwd);
    if (sight && sight.point) sightPoint.copy(sight.point);
    else sightPoint.copy(CBZ.camera.position).addScaledVector(fwd, w.range);
    fwd.copy(sightPoint).sub(origin).normalize();
    if (CBZ.net && CBZ.net.active && CBZ.net.onShot) CBZ.net.onShot(origin, fwd, w);

    // EXPLOSIVE (RPG/bazooka) — REAL PROJECTILE FLIGHT (b): the impact POINT is
    // still resolved synchronously at the moment of firing (so it always lands
    // exactly under the reticle — unchanged from before), but the rocket no
    // longer detonates the same frame it's fired. A visible projectile now
    // flies the eye→impact line over a real flight time (launchRocket, with a
    // gravity sag), and `detonate()` below — the EXACT same FX call sequence
    // the old instant branch ran, unchanged line-for-line — fires once it
    // actually arrives. CITY-ONLY (escape/survival never see these systems).
    // The BLAST is the kill, so the normal per-pellet damage loop is skipped.
    if (w.explosive) {
      const MIN_DET = 4;
      const ammoSpec = rocketAmmoSpec(w) || { id: "standard", homing: false };
      // LOCK-ON (systems/lockon.js): a RED on-screen lock overrides pull-time
      // acquisition — undefined means that system is absent/disabled, so the
      // legacy path below runs byte-identically; null means it's on with no
      // lock, which flies dead straight (the owner's "no lock, no homing").
      let guidedTarget = CBZ.lockonFireTarget ? CBZ.lockonFireTarget() : undefined;
      if (guidedTarget === undefined) guidedTarget = ammoSpec.homing ? acquireHomingTarget(origin, fwd, ammoSpec) : null;
      // a rocket REACHES across the whole map — its detonation must not be capped
      // at the gun's per-pellet `range` (200), or a tower you aim at 250u down a
      // boulevard shows the fireball in empty air SHORT of the wall and the facade
      // never reacts (owner-filmed "far/high building unaffected"). FAR ≈ the map
      // diagonal: long enough to reach any facade, the trace is the same cheap
      // losBlockers raycast regardless of distance.
      const FAR = 450;
      const hit = resolveShot(w, fwd, origin);
      // an aircraft hit in OPEN AIR (Air-1 / ambient fleet / airborne gunship) must
      // not spray solid debris cubes out of empty sky (owner: "shooting cubes down"
      // instead of real damage) — the craft's own crash arc is the wreckage. Flagged
      // here, honoured by the airburst gate on the cityExplosion call below.
      const airTarget = !!(hit && (hit.aircraft || hit.civilAircraft || hit.lightAir));
      // A DEDICATED long-range wall trace so a distant facade beyond w.range is
      // actually struck — resolveShot only looks out to w.range, so a far tower
      // returns wall:false and the rocket used to die at 200u in open air.
      const farWall = wallDistance(eye, fwd, FAR);
      // Detonate at the NEAREST of: what the close ray HIT (actor/car/near wall),
      // the FAR wall down the sightline, where the ray crosses the STREET, or FAR.
      // The ground-crossing is the original "far-away" fix; the far-wall trace is
      // the new one — together a rocket lands ON whatever it's pointed at, near or
      // far, and the big blast radius does the rest.
      let detT = (hit.wall || hit.actor || hit.car || hit.aircraft || hit.civilAircraft || hit.lightAir) && hit.dist ? Math.max(0.1, hit.dist) : FAR;
      if (farWall && farWall.distance < detT) detT = Math.max(0.1, farWall.distance);
      if (fwd.y < -0.01) { const gt = (0 - eye.y) / fwd.y; if (gt > 0 && gt < detT) detT = gt; }  // ground (street ≈ y0)
      detT = Math.max(MIN_DET, Math.min(detT, FAR));   // never on the shooter, never past the map
      // the wall the rocket actually lands on (close hit OR the far facade) — used
      // below to stamp the struck face's scar at the real impact point.
      let wallStruck = (hit.wall && hit.wallHit && hit.dist <= detT + 0.6) ? hit.wallHit
        : (farWall && Math.abs(farWall.distance - detT) < 0.6) ? farWall : null;
      let wallPoint = (hit.wall && hit.wallHit && hit.dist <= detT + 0.6) ? hit.point
        : (farWall && Math.abs(farWall.distance - detT) < 0.6 && farWall.point) ? farWall.point.clone() : null;
      const pt = eye.clone().addScaledVector(fwd, detT);
      // pre-resolved shot direction + origin for the detonation closure below.
      // MUST be clones, not the shared `eye`/`fwd` scratch vectors — detonate()
      // can now run many frames after this shot (real flight time), by which
      // point other shots/frames will have overwritten the shared vectors.
      const launchDir = fwd.clone();
      const launchEye = eye.clone();
      const detonate = function () {
        // ---- THE SPLIT (2026-08-06) ----------------------------------------
        // OWNER: "in prison mode the RPGs don't blow up, but in Gang City the
        // RPGs blow up beautifully." This whole body used to sit inside ONE
        // `if (CBZ.game.mode === "city")`, so a rocket fired in the prison, in
        // Gun Game or on the disaster island produced a camera shake and
        // nothing else — no fireball, no damage, no sound, no scorch.
        //
        // The block was never city-shaped as a whole. It is two things welded
        // together, and they are separated here:
        //
        //   BLAST      the fireball, smoke, shockwave, sound, shake, ground
        //              scorch and blast damage. Owned by crashfx.js's
        //              cityExplosion, which draws with the pooled FX system and
        //              reads no city record. Runs wherever the mode declares
        //              the capability (systems/modecaps.js) — which is
        //              everywhere. THE PEOPLE it hurts are resolved by the
        //              mode's own roster (CBZ.blastWorldActors, called from
        //              applyBlastDamage), so a rocket in the mess hall kills
        //              the men in the mess hall through CBZ.aiKill and not
        //              through a city helper pasted into the prison.
        //   CITY WORLD glass, the facade carve, the walkable breach, the
        //              aircraft splashes and the car it landed on. Every one of
        //              these reads a CITY record (cityGlass, cityFracture,
        //              cityCars, the aircraft fleets) that does not exist in
        //              the other maps. Stays on the mode enum, deliberately.
        //
        // The prison and the arena get the explosion; the city keeps the
        // demolition. When those systems grow a non-city owner (a prison wall
        // that can be breached), the second gate is where that lands.
        const cityWorld = CBZ.game.mode === "city";
        const blastOn = CBZ.modeHas ? CBZ.modeHas("blast") : cityWorld;
        if (blastOn) {
          const groundHit = pt.y < 3.5;   // the blast actually couples to the street
          // the fireball/smoke/damage bloom AT the impact height — a tower hit
          // 30u up no longer pops at the kerb below it (crashfx reads opts.y). This
          // single call is ALSO what carves the facade: cityExplosion is wrapped to
          // run the fracture chain (cityFracture.blastAt at opts.y, power-scaled), so
          // the hole/scar appears at ANY impact height. The RPG branch must NOT carve
          // the same wall a second time — it only adds flavor (scar/debris/breach).
          // AIRBURST: suppress the falling-cube debris when the rocket detonates on
          // an aircraft (or otherwise high in open air) with no wall/ground to couple
          // to — crashfx then skips its chunk spray, leaving a clean fiery airburst;
          // the downed craft's own fall arc (fireball/smoke/scorch on impact) is the
          // real wreckage. Wall/ground blasts pass airburst:false → debris unchanged.
          // pt.y > 12 is the backstop for a homing hit whose fire-time ray missed
          // the hull sphere (airTarget false) yet still detonates up at aircraft
          // altitude — clearly above street/low-ledge combat, below every craft.
          const airburst = !groundHit && !wallStruck && (airTarget || pt.y > 12);
          // THE ROCKET NAMES ITS ORDNANCE (systems/impactbus.js). One verb
          // replaces the hand-rolled power/radius pair and buys what the
          // inline call could never have: the structural ledger at the real
          // impact height, a fuel-fire term, the ejecta direction, and the
          // ordnance identity every downstream wrapper reads (which is what
          // lets a car under the blast tell an RPG from a car fire). The
          // "rpg" row IS these numbers — 1.9 power / 13 radius, straight off
          // weapon-data.js — so nothing about the fireball moves; the row was
          // corrected UP to match the weapon, not the other way round.
          // The 40 mm launcher shares this branch and is deliberately
          // byte-identical to the rocket (weapon-data gives both 1.9/13), so
          // it rides the same row rather than inventing a duplicate.
          // THE NUMBER GUARD is not paranoia: `w.blastPower/blastRadius` are
          // WEAPON DATA, and a future explosive authored with different ones
          // must not be quietly re-priced as an RPG. It takes the row only
          // when the row IS its numbers, and otherwise fires the exact line
          // the rocket has always fired. Same for flag-off / bus-absent.
          // CITY-ONLY BUS: the ordnance bus's extra work beyond the fireball is
          // the STRUCTURAL ledger (city/structural.js, cityDamageBuilding, the
          // fracture escalation) — city records, every one. Outside the city we
          // take the plain cityExplosion line, which is the same numbers by
          // construction (the "rpg" row IS 1.9/13, straight off weapon-data),
          // so the picture and the damage are identical and only the building
          // bookkeeping is skipped.
          const useBus = cityWorld && CBZ.detonate && CBZ.CONFIG && CBZ.CONFIG.ORDNANCE_BUS_ALL !== false &&
                         (w.blastPower || 1.4) === 1.9 && (w.blastRadius || 7) === 13;
          if (useBus) {
            CBZ.detonate(pt.x, pt.y, pt.z, "rpg", {
              byPlayer: true, airburst: airburst,
              dirx: launchDir.x, dirz: launchDir.z,
              kind: w.projPlain ? undefined : "rpg", dir: launchDir,
            });
          } else {
            // CBZ.cityExplosion is the head of a wrapper chain that couples the
            // blast to city records (structural ledger, bank vaults, site
            // walls, wildlife, armored trucks) and stays installed for the rest
            // of the session once the city has been visited. Outside the city
            // we detonate through CBZ.cityBlastCore — the same fireball,
            // damage, sound and shake, before any of those wraps. City mode is
            // untouched and still runs the full chain.
            const boom = cityWorld ? CBZ.cityExplosion : (CBZ.cityBlastCore || null);
            if (boom) boom(pt.x, pt.z, { power: w.blastPower || 1.4, radius: w.blastRadius || 7, byPlayer: true, y: pt.y, airburst: airburst,
              kind: w.projPlain ? undefined : "rpg", dir: launchDir });
          }
          /* ENOUGH ROCKETS OPEN IT (systems/breach.js). The rocket banks its
             warhead mass into the wall it hit, at the STANDOFF coupling — a
             shaped charge penetrates rather than breaches, which is why the
             research says an RPG hole is ~30 cm and never a doorway. So one
             rocket wrecks; several into the same panel eventually open it, and
             a vault or a door opens when the running total reaches the pounds
             it declared. WARHEAD_LB is the PG-7-class filler in TNT-equivalent
             pounds; at 0.35 coupling that is 0.77 lb a shot, so a man-sized
             hole costs about seven rockets — or one 5 lb brick in contact. */
          if (CBZ.breachDeliver) {
            const WARHEAD_LB = 2.2;
            try { CBZ.breachDeliver(pt.x, pt.y, pt.z, WARHEAD_LB, false, { byPlayer: true }); } catch (e) {}
          }
          /* ---- THE TWO HALVES THAT WERE NEVER CITY-SHAPED -----------------
             OWNER (2026-08-11): "make RPGs and explosions work in the prison
             game like how they work in Gang City."

             The 2026-08-06 split (see the top of this closure) moved the
             fireball, the sound, the shake and the blast damage out onto the
             capability, and MEASURED in escape mode they all fire — a rocket
             in the yard kills the men in the yard and carves the wall it hits
             (cityFracture.blastAt asks CBZ.modeHas("breach"), so the prison's
             room walls open and its `noBreach` perimeter refuses). What stayed
             behind in the city block was the part you SEE at the wall: the
             facade coming down, and the ground-level widening that turns a
             hole into a doorway. Neither is city-shaped, and one of them says
             so in its own header — city/crashfx.js:1789 opens cityBlastWall
             with "NO MODE GATE. fpsmode.js calls this on every rocket that
             finds a wall, in every mode; outside the city it was the silent
             half of the RPG the owner filmed. Reads CBZ.colliders for the
             roofline and nothing else." It then sat inside `if (cityWorld)`.
             cityBreach (city/buildings.js:2194) is the same: colliders,
             carveHole, cityChunk, and a self-dedup against the fracture ledger
             it shares — no lot, no building record, no arena.

             So both now ask for `breach`, the capability that already decides
             whether a blast may open a wall here at all. City mode is
             byte-identical (modeHas("breach") is 1 there and always was); the
             prison, Gun Game and the disaster island get the avalanche and the
             doorway they were always meant to have. ---- */
          const mayOpen = CBZ.modeHas ? CBZ.modeHas("breach") : cityWorld;
          // a DIRECT hit on a ground-floor wall widens into a real, WALKABLE
          // hole. Self-dedups via cityFracture.recent() (armed synchronously by
          // blastAt a tick ago), so it never double-carves the wall the
          // explosion chain already opened.
          if (mayOpen && !cityWorld && groundHit && CBZ.cityBreach) {
            try { CBZ.cityBreach(pt.x, pt.z, (w.blastRadius || 7) * 0.28); } catch (e) {}
          }
          // detonated ON a face → the facade REACTS: debris avalanche pouring
          // down it, concrete dust out of the wound, a parapet block near the
          // roofline. Flavor only — the real hole is the carve above.
          if (mayOpen && !cityWorld && wallStruck && canLeaveBlastScar(wallStruck) && CBZ.cityBlastWall) {
            const sd0 = new THREE.Vector3(-launchDir.x, 0, -launchDir.z);
            if (sd0.lengthSq() < 1e-6) sd0.set(0, 1, 0); else sd0.normalize();
            const wf0 = wallStruck.face, wo0 = wallStruck.object;
            if (wf0 && wo0 && wo0.getWorldQuaternion) {
              const wn0 = wf0.normal.clone().applyQuaternion(wo0.getWorldQuaternion(wallQ));
              if (wn0.lengthSq() > 0.25) {
                if (wn0.dot(launchDir) > 0) wn0.multiplyScalar(-1);
                sd0.copy(wn0.normalize());
              }
            }
            try { CBZ.cityBlastWall(wallPoint || pt, sd0, { power: w.blastPower || 1.4 }); } catch (e) {}
          }

          // ---- everything below reads a CITY record ------------------------
          if (cityWorld) {
          // a guest's blast never reaches the host's sim otherwise — the host
          // can't count structural HP for a detonation it never saw (mirrors
          // localGunHit's "hit" forwarding in net.js). FX stays local (above);
          // this only feeds the host's demolition ledger.
          if (CBZ.net && CBZ.net.active && !CBZ.net.isHost()) {
            CBZ.net.sendEv({ e: "blast", to: CBZ.net.hostId, x: pt.x, z: pt.z, y: pt.y, power: w.blastPower || 1.4, radius: w.blastRadius || 7 });
          }
          // wreck the storefront HARD — shatter a wide radius of glass (was +2)
          if (CBZ.cityShatter) CBZ.cityShatter(pt.x, pt.z, (w.blastRadius || 7) + 8);
          // AND ray-shatter every pane in the rocket's ACTUAL flight path (eye→impact):
          // the radial burst above only reaches glass near where the blast LANDS, so a
          // rocket that detonates a hair short of (or beside) a tower used to leave the
          // window you aimed at intact. This is the SAME path ray-shatter that makes the
          // rifle reliably break far glass — now on the rocket, so "even RPGs" break it.
          if (CBZ.cityShatterRay) CBZ.cityShatterRay(launchEye.x, launchEye.y, launchEye.z, launchDir.x, launchDir.y, launchDir.z, detT + (w.blastRadius || 7), true);
          if (groundHit && CBZ.cityScorch) CBZ.cityScorch(pt.x, pt.z, (w.blastRadius || 7) * 0.6);   // big scorch on the building/ground
          // a DIRECT hit on a ground-floor wall blasts a real, WALKABLE hole through
          // it (blastRadius 13 → r≈3.6, a satisfying car-sized breach you can run in).
          // GROUND-ONLY BONUS: the facade carve at any height already came from the
          // cityExplosion chain above; this just widens a street-level hit into a
          // walkable breach. cityBreach self-dedups via cityFracture.recent() (which
          // blastAt armed synchronously a tick ago) so it never double-carves.
          if (groundHit && CBZ.cityBreach) CBZ.cityBreach(pt.x, pt.z, (w.blastRadius || 7) * 0.28);
          // detonated ON a building face (near OR far) → the facade REACTS (crashfx):
          // debris avalanche pouring down the facade, a lingering smoke column from
          // the wound, a parapet block near the roofline, concrete dust. NO carve
          // (cityBlastWall is flavor only — the real hole is the cityExplosion chain).
          // DEGATED: now fires for a far facade too, not just a near-wall hit.
          if (wallStruck && canLeaveBlastScar(wallStruck) && CBZ.cityBlastWall) {
            // wall-face normal: the raycast's struck face rotated to world (the
            // exact face-entry normal, same idea as findCarHit's AABB slabs);
            // falls back to the reflected horizontal shot direction.
            const sd = new THREE.Vector3(-launchDir.x, 0, -launchDir.z);
            if (sd.lengthSq() < 1e-6) sd.set(0, 1, 0); else sd.normalize();
            const wf = wallStruck.face, wo = wallStruck.object;
            if (wf && wo && wo.getWorldQuaternion) {
              const wn = wf.normal.clone().applyQuaternion(wo.getWorldQuaternion(wallQ));
              if (wn.lengthSq() > 0.25) {
                if (wn.dot(launchDir) > 0) wn.multiplyScalar(-1);   // always face the shooter
                sd.copy(wn.normalize());
              }
            }
            // MIN_DET can push pt past a point-blank wall — stamp at the wall point
            CBZ.cityBlastWall(wallPoint || pt, sd, { power: w.blastPower || 1.4 });
          }
          // a rocket that lands on/near the gunship nearly halves it (≈2 rockets kill)
          if (CBZ.cityAircraftSplash) CBZ.cityAircraftSplash(pt.x, pt.y, pt.z, (w.blastRadius || 7) + 4, 90);
          // Civil aircraft are the real boardable plane records, not disposable
          // target dummies. A direct RPG wrecks one; a near miss falls off.
          if (CBZ.cityCivilAircraftSplash) CBZ.cityCivilAircraftSplash(pt.x, pt.y, pt.z, (w.blastRadius || 7) + 4, 520, { byPlayer: true });
          // Air-1 + the ambient GA fleet joined the lockable pool (lockon.js)
          // before they had damage models, so a homing hit detonated ON them
          // for nothing. Same fan-out, their own seams — police.js /
          // airtraffic.js own the shoot-down arcs, and both seams no-op
          // behind POLICE_AIR_DAMAGE / AIRTRAFFIC_DAMAGE. One rocket downs
          // these light airframes at contact; both seams fall damage off with
          // distance so a near miss wounds into tier smoke instead.
          if (CBZ.cityPoliceAirSplash) CBZ.cityPoliceAirSplash(pt.x, pt.y, pt.z, (w.blastRadius || 7) + 4, 90);
          if (CBZ.cityAirTrafficSplash) CBZ.cityAirTrafficSplash(pt.x, pt.y, pt.z, (w.blastRadius || 7) + 4, 140);
          // ---- A ROCKET INTO A CAR DID NOTHING TO THE CAR. --------------
          // `hit.car` was resolved at fire time and used for ONE thing: to
          // decide where the rocket stops (detT, above). The explosive branch
          // deliberately skips the per-pellet damage loop because "the BLAST
          // is the kill" — but nothing in the blast chain had ever touched
          // CBZ.cityCars, so the vehicle you aimed at absorbed the shot and
          // drove on. The general fix is the vehicle coupling on the blast
          // primitives themselves (systems/impactbus.js); THIS is the other
          // half of it — a DIRECT hit is not a near miss, and it should not
          // be priced by distance falloff like one.
          //   `direct: true` is what buys the 0.2-0.4 s fuel-flash beat in
          //   vehicles.js instead of the blast's 0.4-1.6 s fuse: you shot the
          //   car, so it goes now — but never in the same frame, because the
          //   flash before the fireball is the whole read.
          //   The crater comes through cityCarImpact along the rocket's own
          //   flight vector, so the hole is where the round went in.
          if (hit && hit.car && !hit.car.dead && hit.car.pos && CBZ.cityDamageCar &&
              Math.hypot(hit.car.pos.x - pt.x, hit.car.pos.z - pt.z) < 6) {
            const tgt = hit.car;
            if (CBZ.cityCarImpact) {
              try {
                CBZ.cityCarImpact(tgt, hit.point || pt,
                  { x: launchDir.x, y: Math.min(-0.1, launchDir.y), z: launchDir.z },
                  32, { r: 1.5 });
              } catch (e) {}
            }
            try {
              CBZ.cityDamageCar(tgt, 260, {
                byPlayer: true, blast: true, direct: true,
                fromX: pt.x, fromZ: pt.z, cause: "explosion",
              });
            } catch (e) {}
          }
          }   // end cityWorld (glass / facade / breach / aircraft / cars)
        }     // end blastOn (the shared fireball + damage)
        // kick scales with how close the blast is to the lens — a rocket at your
        // feet rattles, one parked 100u up a tower rumbles (crashfx attenuates
        // its own explosion shake the same way)
        const camD = CBZ.camera ? CBZ.camera.position.distanceTo(pt) : 0;
        CBZ.shake && CBZ.shake(((w.shake || 1) + 0.6) * Math.max(0.3, Math.min(1, 1.25 - camD / 130)));
        CBZ.doHitstop && CBZ.doHitstop(0.05);
      };
      // FLIGHT TIME + visible arc: projSpeed/projGravity (weapon-data.js) drive
      // a real travel delay instead of detonating the instant the trigger is
      // pulled. Weapons without projSpeed (defensive default) keep the OLD
      // instant-detonate behaviour so this never silently breaks a future
      // explosive that doesn't carry the new fields. PACE V2 (c): rockets
      // cruise 20% hotter — see the WEAPON_ROCKET_PACE_V2 block above.
      const projSpeed = ((guidedTarget && ammoSpec.speed) || w.projSpeed || 0) * (paceOn() ? PACE_SPEED_MUL : 1);
      if (projSpeed > 0) {
        const lockPoint = guidedTarget && guidedTarget.seek ? guidedTarget.seek() : null;
        const flightDist = lockPoint
          ? Math.hypot(lockPoint.x - origin.x, lockPoint.y - origin.y, lockPoint.z - origin.z)
          : origin.distanceTo(pt);
        const flightDur = Math.max(0.04, flightDist / projSpeed);
        // visual sag: how far the arc dips at its midpoint under projGravity
        // over the flight time (s = 1/8 * g * t^2 for a midpoint sag — the
        // peak of a parabola released over the full duration), capped so a
        // very long shot doesn't sag the rocket into the ground mid-flight.
        const sag = guidedTarget ? 0 : Math.min(flightDist * 0.18, 0.125 * (w.projGravity || 0) * flightDur * flightDur);
        const guideOpts = guidedTarget ? {
          homing: true,
          seek: guidedTarget.seek,
          speed: projSpeed,
          turnRate: guidedTarget.turnRate || ammoSpec.turnRate || 2.4,   // lockon.js carries a per-weapon cap
          targetRadius: guidedTarget.radius || 2,
          maxLife: Math.max(3.8, Math.min(8, flightDur + 2.5)),
          impactPoint: pt,
          onImpact: function (actualPoint, actualWall) {
            pt.copy(actualPoint);
            detT = launchEye.distanceTo(pt);
            wallStruck = actualWall || null;
            wallPoint = actualWall && actualWall.point ? actualWall.point.clone() : null;
          },
        } : null;
        const flightOpts = guideOpts || {};
        if (w.projPlain) flightOpts.plain = true;   // launched shell, no exhaust dressing
        else flightOpts.tail = rocketTailWorld(origin, launchDir);   // where the backblast leaves
        launchRocket(origin, pt, flightDur, sag, detonate, flightOpts);
        // a brief launch flare only (the flying mesh IS the tracer now) — no
        // fireTracer() instant line all the way to `pt`, which would visibly
        // spoil the flight by drawing the whole path before the rocket arrives.
      } else {
        fireTracer(origin, pt, w.tracer, 0.07);
        detonate();
      }
      // firing still raises wanted: replicate the witnessed-crime block below so
      // launching a rocket is at least as loud as discharging a firearm. This
      // fires at LAUNCH (the report is "shots fired", not "it landed") so a
      // witness reacts to the whoosh/launch sound immediately, same as before.
      if (CBZ.game.mode === "city" && CBZ.cityCrime) {
        CBZ.cityCrime(120, { x: CBZ.player.pos.x, z: CBZ.player.pos.z, type: "shots-fired" });
        CBZ.cityEvent && CBZ.cityEvent("bullet-impact", { weapon: w.key, panic: 4, damage: 0.3 }, { silent: true, noWanted: true });
        CBZ.cityAlarm && CBZ.cityAlarm(CBZ.player.pos.x, CBZ.player.pos.z, 40, 1.6, CBZ.city.playerActor);
      }
      return;
    }

    const pellets = w.pellets || 1;
    // effective cone = base spread, opened by recoil + accumulated bloom, with
    // a hipfire/movement penalty (moving fast while shooting throws shots wide).
    // Standing still + tapping ≈ the gun's tight base cone for precise shots.
    const supported = bipodActive(w);
    const moving = supported ? 0 : (CBZ.player.grounded === false ? 0.6 : Math.min(1, (CBZ.player.speed || 0) / 6));
    // per-weapon movement penalty: heavy rifles (AK moveSpread 2.3) punish
    // run-and-gun harder than the 1.4 default — plant your feet for the payoff.
    const moveBloom = w.spread * moving * (w.moveSpread || 1.4);
    // ADS (RMB held) collapses the whole cone ~0.4x for pinpoint shots — the
    // single biggest accuracy change, à la CoD. Applies in all modes (strict
    // improvement); hip cone unchanged when RMB isn't held.
    const adsSpreadK = aimHeld ? 0.4 : 1;
    /* STANCE. A crouched shooter groups tighter than a standing one and a
       prone one tighter again — see the STANCE block above for where these
       come from. This is the ONE place the cone learns the body exists.
       bipodActive() still outranks it (0.32 below), because a gun resting on
       its own legs is a better brace than any human position. */
    const stanceSpreadK = STANCE_SPREAD[stanceOf()] || 1;
    // SUPPRESSION (c): a round that just buzzed the player rattles their aim
    // for a few seconds (gunfx.js tracks it off the SAME near-miss test that
    // already drives the "you're being shot at" muzzle-flash/bolt juice — no
    // new detection, just a real cost wired onto an existing read). Feature-
    // detected so this file degrades gracefully if gunfx.js isn't loaded.
    // modSpr = the equipped scope/grip's spread multiplier (gun-mods branch).
    const suppressK = CBZ.suppressionAccuracyMul ? CBZ.suppressionAccuracyMul(CBZ.player) : 1;
    const cone = (w.spread * (1 + recoil * 0.18) + bloom + moveBloom) * adsSpreadK *
      stanceSpreadK * (supported ? 0.32 : 1) * suppressK * modSpr;
    const cal = caliber(w);   // round weight, threaded into every surface impact below
    /* PROJECTILE OR RAY — see the PROJECTILES block. A ballistic round is
       launched here and lands on a later frame; everything else resolves in
       this one, exactly as it always did. */
    const ballistic = ballisticRound(w);
    const acc = newLand(_shotAcc);
    for (let i = 0; i < pellets; i++) {
      spreadDir(fwd, cone, shotDir);
      if (ballistic) { launchBullet(w, origin, shotDir, cal); continue; }
      const hit = resolveShot(w, shotDir, origin);
      const end = hit.point || eye.clone().addScaledVector(shotDir, w.range);
      if (i < 5 || pellets === 1) {
        if (w.key === "taser" && CBZ.taserFx && CBZ.taserFx.fire) {
          // Twin physical probe wires + body arc replace the firearm tracer.
          CBZ.taserFx.fire(origin, end, { target: hit.actor || null });
        } else fireTracer(origin, end, w.tracer, w.key === "shotgun" ? 0.045 : 0.055);
      }
      landRound(w, hit, shotDir, origin, cal, acc);
    }
    /* A FLOWN ROUND HAS NOT ARRIVED YET, so there is nothing to confirm: the
       marker, the thud and the flesh-hit foley all travel WITH the bullet and
       fire from updateBullets the frame it actually lands. acc is empty for a
       ballistic shot, so this is a no-op rather than a branch. */
    roundFeedback(w, cal, acc);
    // discharging a firearm in the city is a witnessed crime (city wanted system)
    if (CBZ.game.mode === "city" && CBZ.cityCrime) {
      CBZ.cityCrime(w.nonlethal ? 20 : (acc.hitSomething ? 100 : 55), { x: CBZ.player.pos.x, z: CBZ.player.pos.z, type: "shots-fired" });
      CBZ.cityEvent && CBZ.cityEvent("bullet-impact", { weapon: w.key, panic: w.nonlethal ? 1 : 3, damage: acc.hitSomething ? 0 : 0.3 }, { silent: true, noWanted: true });
      CBZ.cityAlarm && CBZ.cityAlarm(CBZ.player.pos.x, CBZ.player.pos.z, 24, 1.2, CBZ.city.playerActor);
    }
  }

  function fireControl(down) {
    // Mounted aquatic predators own the trigger before firearm state does.
    // This covers mouse, keyboard and gamepad; touch also intercepts at its
    // outer edge so third-person unarmed taps reach the same mouth action.
    const animalDown = typeof down === "boolean" ? down : true;
    if (CBZ.cityMountedAnimalAttack && CBZ.cityMountedAnimalAttack(animalDown)) {
      triggerHeld = false;
      return;
    }
    // a charge / the detonator / a frag in your hand (systems/helditems.js):
    // the trigger is that object's use, never a punch or a shot
    if (CBZ.heldItem && CBZ.heldItem.use(animalDown)) { triggerHeld = false; return; }
    if (typeof down === "boolean") {
      triggerHeld = down;
      if (down) shoot();
      return;
    }
    shoot();
  }

  function switchWeapon(delta) {
    if (!armed()) return;
    if (switchCD > 0) return;            // ignore rapid repeats — prevents Q spam/lag
    const av = availableIndices();
    if (av.length <= 1) return;          // nothing to switch to: stay silent, no sfx churn
    switchCD = 0.22;
    const pos = Math.max(0, av.indexOf(fps.weapon));
    const oldId = CBZ.currentWeaponId || weaponIdOf(fps.weapon);
    fps.weapon = av[(pos + delta + av.length) % av.length];
    CBZ.currentWeaponId = weaponIdOf(fps.weapon);
    markWeaponTransition(oldId, CBZ.currentWeaponId, "switch");
    fps.reloading = 0;
    // per-weapon draw time: a heavy rifle (AK equip 0.5s) takes a beat to
    // shoulder before it can fire — switching itself stays instant.
    shotCD = Math.max((WEAPONS[fps.weapon] && WEAPONS[fps.weapon].equip) || 0, Math.min(shotCD, 0.08));
    syncAmmo();
    weaponModels.forEach((m, i) => { m.visible = i === fps.weapon; });
    carriedModels.forEach((m, i) => { m.visible = i === fps.weapon; });
    muzzle.position.copy(weaponModels[fps.weapon].userData.muzzle);
    CBZ.sfx && CBZ.sfx("switch");
    // the boxed hotbar highlights the slot you just switched to, which is the
    // whole point of having a boxed hotbar. Naming it in text as well was the
    // second readout the shared renderer exists to remove.
    if (CBZ.jailTell) CBZ.jailTell.hint(weapon().label, 0.85);
    else if (CBZ.flashHint) CBZ.flashHint(weapon().label, 0.85);
    setAmmoHud();
    if (CBZ.game.mode === "city" && CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // DIRECT SLOT SELECT (number keys 1-9) — pick the Nth weapon in the hotbar,
  // in the SAME order the city HUD draws them, so [1]..[9] map to what you see.
  // WHY: scrolling/Q through a growing arsenal is clumsy; an RPG, an AK and a
  // sidearm should each be one keypress (GTA/CS muscle memory). 0-based slot.
  function selectWeaponSlot(slot) {
    if (cuffedHands()) return false;
    const oldId = armed() ? (CBZ.currentWeaponId || weaponIdOf(fps.weapon)) : null;
    if (CBZ.game.mode === "city") CBZ.game.cityHolstered = false;   // drawing a gun un-holsters (re-arms)
    if (CBZ.game.mode === "escape") CBZ.game.prisonHolstered = false;
    const av = availableIndices();
    if (slot < 0 || slot >= av.length) return false;
    const idx = av[slot];
    if (idx === fps.weapon) {
      const sameId = weaponIdOf(idx);
      CBZ.currentWeaponId = sameId;
      markWeaponTransition(oldId, sameId, oldId ? "select" : "draw");
      setAmmoHud();
      if (CBZ.game.mode === "city" && CBZ.cityHudDirty) CBZ.cityHudDirty();
      return true;
    }
    fps.weapon = idx;
    CBZ.currentWeaponId = weaponIdOf(fps.weapon);
    markWeaponTransition(oldId, CBZ.currentWeaponId, oldId ? "switch" : "draw");
    fps.reloading = 0;
    shotCD = Math.max((WEAPONS[fps.weapon] && WEAPONS[fps.weapon].equip) || 0, Math.min(shotCD, 0.08));  // heavy guns take a beat to shoulder
    syncAmmo();
    weaponModels.forEach((m, i) => { m.visible = i === fps.weapon; });
    carriedModels.forEach((m, i) => { m.visible = i === fps.weapon; });
    if (weaponModels[fps.weapon] && weaponModels[fps.weapon].userData.muzzle) muzzle.position.copy(weaponModels[fps.weapon].userData.muzzle);
    CBZ.sfx && CBZ.sfx("switch");
    // the boxed hotbar highlights the slot you just switched to, which is the
    // whole point of having a boxed hotbar. Naming it in text as well was the
    // second readout the shared renderer exists to remove.
    if (CBZ.jailTell) CBZ.jailTell.hint(weapon().label, 0.85);
    else if (CBZ.flashHint) CBZ.flashHint(weapon().label, 0.85);
    setAmmoHud();
    if (CBZ.game.mode === "city" && CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }
  CBZ.fpsSelectSlot = selectWeaponSlot;
  // Select by WEAPON ID. systems/inventory.js's docked jail bar speaks ids:
  // it renders CBZ.weaponInventory order (via weaponSlotsHTML) while slots
  // here index availableIndices' catalog order, and the mapping between the
  // two belongs to the file that owns both orderings — this one.
  CBZ.fpsSelectWeaponId = function (id) {
    const idx = weaponIndex(id);
    if (idx < 0) return false;
    const s = availableIndices().indexOf(idx);
    return s >= 0 ? selectWeaponSlot(s) : false;
  };

  // ---- THE CITY BAR IS THE INVENTORY -----------------------------------------
  // OWNER: "only guns are cool, and the keycard is cool af. All other inventory
  // is dumb af... The flashlight is a cool thing in inventory because at night
  // it helps. Its icon should be the flashlight, like how the guns are."
  // So the city carries ONE row and nothing else: the owned GUNS (their
  // left-to-right order), then THROWABLES (grenade / C4: weapons, one chip per
  // kind with a count), then the FLASHLIGHT once you own one, then the PHONE
  // when the campaign handset is live. No fists chip: empty hands are simply
  // nothing lit, and selecting the gun you already hold puts it away. Food and
  // medicine are not chips any more: city/hunger.js eats and patches up on its
  // own when you need it. Drugs are product; the dealers' trade flows read them
  // straight out of g.cityInv.
  // Each entry: { kind:"gun"|"throwable"|"detonator"|"flashlight"|"phone", label, short,
  //   id?, gunSlot?, item?, count?, active }. city/hud.js renders exactly this;
  // CBZ.cityHotbarSelect dispatches a bar index. Pure read so renderers poll.
  //
  // cityBarEntries is the PURE assembly (no CBZ reads), so the order contract
  // can be checked in plain node: it takes what the world already knows.
  function cityBarEntries(s) {
    const bar = [];
    const guns = s.guns || [];
    for (let i = 0; i < guns.length; i++) {
      const gn = guns[i];
      bar.push({ kind: "gun", id: gn.id, gunSlot: i, label: gn.label, short: gn.short, active: !s.holstered && !!gn.held });
    }
    const th = s.throwables || [];
    for (let i = 0; i < th.length; i++) {
      if (!(th[i].count > 0)) continue;
      bar.push({ kind: "throwable", item: th[i].name, label: th[i].name, short: th[i].name, count: th[i].count | 0,
                 held: th[i].held || null, active: !!(th[i].held && th[i].held === s.held) });
    }
    // the detonator is its own thing in your hand once a charge is out
    if ((s.planted | 0) > 0) {
      bar.push({ kind: "detonator", item: "Detonator", label: "Detonator", short: "DET", held: "detonator", count: s.planted | 0, active: s.held === "detonator" });
    }
    // a gauze roll while you carry one (systems/vitals.js): in your hand, held use = wrap
    if (s.bandage && (s.bandage.count | 0) > 0) {
      bar.push({ kind: "bandage", item: "Bandage", label: "Bandage", short: "", count: s.bandage.count | 0, held: "bandage", active: !!s.bandage.active });
    }
    if (s.flashlight && s.flashlight.owned) {
      bar.push({ kind: "flashlight", item: "Flashlight", label: "Flashlight", short: "LIGHT", active: !!s.flashlight.on });
    }
    const ph = s.phone;
    if (ph && ph.available) {
      bar.push({ kind: "phone", label: "Phone", short: "PHONE", item: "Phone", active: !!ph.open, unread: !!ph.unread, buzz: !!ph.buzz });
    }
    return bar;
  }
  function cityThrowables() {
    // stable order: ITEMS catalog declaration order, filtered to owned throwables
    const inv = CBZ.game.cityInv || {}, ITEMS = (CBZ.cityEcon && CBZ.cityEcon.ITEMS) || {};
    const out = [];
    const HM = CBZ.heldItemModel;
    for (const name in ITEMS) {
      const it = ITEMS[name];
      if (it && it.tag === "throwable" && (inv[name] || 0) > 0) {
        out.push({ name: name, count: inv[name] | 0, held: HM ? HM.heldKindOf(name, it) : null });
      }
    }
    return out;
  }
  function cityHotbar() {
    if (CBZ.game.mode !== "city") return [];
    const idx = availableIndices();
    const guns = [];
    for (let s = 0; s < idx.length; s++) {
      const w = WEAPONS[idx[s]];
      guns.push({ id: w.id || w.key, label: w.label, short: w.short, held: idx[s] === fps.weapon });
    }
    // The flashlight: systems/playerflashlight.js owns the lamp and whether you
    // own one; this bar only gives it a slot. The phone: city/campaign_ui.js
    // owns the device, publishing its chip state read-only.
    let fl = null;
    try {
      const PF = CBZ.playerFlashlight;
      if (PF && typeof PF.owned === "function" && PF.owned()) fl = { owned: true, on: !!(PF.on && PF.on()) };
    } catch (e) { fl = null; }
    let ph = null;
    try { ph = (typeof CBZ.campaignPhoneChip === "function") ? CBZ.campaignPhoneChip() : null; } catch (e) { ph = null; }
    const H = CBZ.heldItem;
    return cityBarEntries({ guns: guns, holstered: !!CBZ.game.cityHolstered, throwables: cityThrowables(), flashlight: fl, phone: ph,
      bandage: CBZ.hotbarBandage ? CBZ.hotbarBandage() : null,
      held: H ? H.current() : null, planted: CBZ.cityC4Planted ? CBZ.cityC4Planted() : 0 });
  }
  CBZ.cityHotbar = cityHotbar;

  // dispatch a bar index: gun -> draw it (fpsSelectSlot, which un-holsters), or
  // put it away when it is already the one in your hands; throwable -> the
  // EXISTING throw / plant path for that kind; flashlight -> click the lamp;
  // phone -> raise/stow the handset. Returns true if it acted on a valid slot.
  function cityHotbarSelect(barIdx) {
    if (CBZ.game.mode !== "city" || cuffedHands()) return false;
    const bar = cityHotbar();
    if (barIdx < 0 || barIdx >= bar.length) return false;
    const e = bar[barIdx];
    if (e.kind === "gun") {
      if (e.active) { CBZ.cityHolster(true); return true; }
      CBZ.game.cityHolstered = false;
      return selectWeaponSlot(e.gunSlot);
    }
    // a charge, a frag, the detonator: it goes IN YOUR HAND (systems/
    // helditems.js); the use input does the rest. Anything else throwable
    // with no held form still leaves on the tap.
    if ((e.kind === "throwable" || e.kind === "detonator" || e.kind === "bandage") && e.held && CBZ.heldItem) {
      return !!CBZ.heldItem.select(e.held);
    }
    if (e.kind === "throwable") {
      if (CBZ.cityThrowFromInventory) { CBZ.cityThrowFromInventory(); return true; }
      return false;
    }
    if (e.kind === "flashlight") {
      const PF = CBZ.playerFlashlight;
      if (PF && typeof PF.toggle === "function") { try { PF.toggle(); } catch (err) { return false; } return true; }
      return false;
    }
    if (e.kind === "phone") { try { return !!(CBZ.campaignPhoneToggle && CBZ.campaignPhoneToggle()); } catch (err) { return false; } }
    return false;
  }
  CBZ.cityHotbarSelect = cityHotbarSelect;

  // number-key bar in CITY (jail keeps its own bar in systems/inventory.js).
  // [1]..[9] map across the visible chips, so a keypress matches what
  // city/hud.js draws. Gated so it never fires while a menu/map is up.
  addEventListener("keydown", function (e) {
    if (e.repeat || CBZ.game.mode !== "city" || CBZ.game.state !== "playing") return;
    if (CBZ.cityMenuOpen || (CBZ.fullMap && CBZ.fullMap.active)) return;
    const n = "123456789".indexOf(e.key);
    if (n < 0) return;
    // the roll's digit, held, is the use input held (systems/helditems.js)
    const be = cityHotbar()[n];
    if (be && be.kind === "bandage" && CBZ.heldItem && CBZ.heldItem.keyHold) { if (CBZ.heldItem.keyHold("bandage", e.code || e.key)) e.preventDefault(); return; }
    if (cityHotbarSelect(n)) e.preventDefault();
  });

  const fpBody = { on: false, hid: [] };   // YOUR BODY UNDER THE LENS, below
  function setActive(on) {
    fps.active = on;
    if (!on && fpBody.on) fpBodyOff();
    if (CBZ.playerChar) CBZ.playerChar.group.visible = !on;
    // Same owner as the per-frame pass below (aquaticRide): the eye toggle can
    // land AFTER this frame's onAlways(52), so without it a [V] pressed mid-ride
    // flashed one frame of fists before the next frame took them away.
    vm.visible = on && !aquaticRide() && !cuffedHands();
    const cross = crossEl();
    if (cross) {
      // Leaving FP used to write display:none even though shoulderActive()
      // became true in the same call. The per-frame change-only cache still
      // remembered `true`, so it never restored the element in third person.
      // Resolve the final shared owner now and keep the cache honest.
      // ...and not on an animal — same owner as the per-frame pass and the
      // viewmodel above it. Without it, toggling the eye view mid-ride flashes
      // a reticle for the frame before onAlways(52) catches up.
      const show = (fps.active || shoulderActive()) && !aquaticRide() &&
        CBZ.game.state === "playing";
      cross.style.display = show ? "block" : "none";
      _crossShown = show;
    }
    document.body.classList.toggle("fps", on);
    setAmmoHud();
    if (on && fps.fp === 0) fps.fp = 0.06;
    if (!on) {
      triggerHeld = false;
      // hand the FP look pitch to the third-person orbit so toggling out of
      // first person keeps looking where you were looking — the orbit used to
      // inherit whatever stale cam.pitch was left over (often the steep spawn
      // value), which armed-3PS turned into a sky/ceiling stare.
      // SIGN: fps.fp is UP-positive, cam.pitch is DOWN-positive (this file
      // already says so twice — at aimForward and at applyAimLock). Copying
      // fps.fp straight across FLIPPED your view vertically on every [V]: leave
      // first person looking up at a roof and the orbit swung above you and
      // stared at the pavement. Negate, and clamp in the orbit's own sense
      // (-0.9 = look up, 0.6 = look down) rather than fps.fp's.
      if (CBZ.cam && typeof fps.fp === "number") CBZ.cam.pitch = Math.max(-0.9, Math.min(0.6, -fps.fp));
    }
    // toggling FPS on hides the body; clear the 3PS present-weapon/carry poses
    // so the rig's arms are not stuck raised when the body re-appears
    // unarmed/holstered.
    if (CBZ.playerChar && on) { CBZ.playerChar.aimingPose = false; CBZ.playerChar.carryPose = false; }
  }

  /* ---- YOUR BODY UNDER THE LENS (prison, 2026-09-29) ----------------------
     Owner: low health is known "by blood coming out, by looking down and
     seeing a hole, by limping". First person used to hide the whole rig
     (setActive above), so looking down showed the floor and the hole the
     round made in you was nowhere. In the prison the rig now stays drawn
     under the eye: the head and neck go (the lens is in them) and the arms go
     (the viewmodel hands are the arms here), and the body stands square to
     the lens with the front of the chest ~13 cm ahead of the eye. Straight
     ahead the shoulders sit under the bottom edge of the frame (the frame's
     lowest ray passes 31 degrees down, the shoulder edge is ~49 degrees
     down); look down and there is your chest, your gut, your legs, and the
     holes and the stains wounds.js stamped on them.
     Not while crouched or prone (the torso folds forward into the lens), on
     the floor, seated, riding or diving: the rig is hidden then, as before. */
  const FP_BODY_FRONT = 0.13;     // m the chest's front face sits ahead of the eye
  function fpBodyWanted() {
    const P = CBZ.player, ch = CBZ.playerChar, g = CBZ.game;
    if (!fps.active || !ch || !ch.group || !P || P.dead) return false;
    if (!g || g.mode !== "escape" || g.state !== "playing") return false;
    if (P.prone || P.crouch || P.driving || (P.ko || 0) > 0) return false;
    if (ch.crouch || ch.pronePose || ch.slidePose || ch.skydiving || ch.riding || ch.lying || ch.sitting) return false;
    if (ch.fall && ch.fall.on) return false;
    if (CBZ.playerDowned && CBZ.playerDowned()) return false;
    if (P.captureState && P.captureState !== "normal") return false;
    if (aquaticRide()) return false;
    // the eye is a fixed 1.65 m: only a body it sits in (head above, shoulders below)
    const m = ch.group.userData && ch.group.userData.characterMetric;
    if (m && (m.height < 1.6 || m.height > 2.1)) return false;
    return true;
  }
  function fpBodyOff() {
    for (let i = 0; i < fpBody.hid.length; i++) fpBody.hid[i].visible = true;
    fpBody.hid.length = 0;
    fpBody.on = false;
  }
  CBZ.fpBodyOn = function () { return fpBody.on; };
  CBZ.onAlways(52.5, function () {
    const ch = CBZ.playerChar;
    if (!fpBodyWanted()) {
      if (fpBody.on) {
        fpBodyOff();
        if (ch && ch.group && fps.active) ch.group.visible = false;
      }
      return;
    }
    if (!fpBody.on) {
      fpBody.on = true;
      const L = ch.low || {}, Pp = ch.parts || {};
      const cut = [ch.head, ch.neck, Pp.la, Pp.ra, L.la, L.ra];
      for (let i = 0; i < cut.length; i++) {
        const o = cut[i];
        if (o && o.visible !== false && fpBody.hid.indexOf(o) < 0) { o.visible = false; fpBody.hid.push(o); }
      }
    }
    ch.group.visible = true;
    // square to the lens, and stood so the chest front is FP_BODY_FRONT ahead
    // of the eye (written absolutely off player.pos, as physics.js writes it)
    const yaw = Math.atan2(-Math.sin(CBZ.cam.yaw), -Math.cos(CBZ.cam.yaw));
    ch.group.rotation.y = yaw;
    const hs = (ch.group.userData && ch.group.userData.humanScale) || 0.7;
    const half = ((ch.profile && ch.profile.torsoD) || 0.5) * hs * 0.5;
    const back = half - FP_BODY_FRONT;
    const P = CBZ.player;
    ch.group.position.x = P.pos.x - Math.sin(yaw) * back;
    ch.group.position.z = P.pos.z - Math.cos(yaw) * back;
  });

  CBZ.toggleFPS = function () { setActive(!fps.active); };
  CBZ.setFPS = function (on) { setActive(!!on); };
  CBZ.armFPSAfterIntro = function () {
    introWantsFPS = true;
    if (fps.active) setActive(false);
  };
  // Campaign prison runs deliberately stay in the same over-the-shoulder
  // language as the city.  State.js calls this before starting the prison
  // reveal so a stale one-shot arm from an earlier run cannot flip the camera
  // back to first person when camera.js announces intro completion.
  CBZ.disarmFPSAfterIntro = function () {
    introWantsFPS = false;
    if (fps.active) setActive(false);
  };
  const prevIntroComplete = CBZ.onIntroComplete;
  CBZ.onIntroComplete = function () {
    if (prevIntroComplete) prevIntroComplete();
    if (introWantsFPS && CBZ.game.state === "playing") {
      introWantsFPS = false;
      setActive(true);
      fps.fp = Math.max(fps.fp, 0.06);
    }
  };
  CBZ.fpsFire = fireControl;
  CBZ.fpsReload = reload;
  CBZ.fpsNextWeapon = function () { switchWeapon(1); };
  CBZ.fpsPrevWeapon = function () { switchWeapon(-1); };
  CBZ.fpsResetWeapons = resetWeapons;
  // add reserve ammo to a weapon (city shops / ammo boxes top you up)
  CBZ.fpsAddAmmo = function (n, id) {
    const i = id != null ? weaponIndex(id) : fps.weapon;
    if (i < 0 || !fps.reserves) return;
    fps.reserves[i] = (fps.reserves[i] || 0) + (n || 0);
    if (i === fps.weapon) syncAmmo();
    setAmmoHud();
  };
  CBZ.fpsActive = function () { return fps.active; };
  CBZ.fpsSetActive = setActive;                       // programmatic FP enter/exit (scope snap)
  // ---- gamepad + weapon-mod hooks ----
  // let a controller (systems/gamepad.js) drive ADS the same as holding RMB.
  CBZ.fpsSetAim = function (on) { aimHeld = !!on; };
  CBZ.fpsAimHeld = function () { return aimHeld; };
  // expose the per-weapon view/carry model arrays + id lookup so city/gunmods.js
  // can bolt scope / suppressor / grip child meshes onto the actual held guns.
  CBZ.fpsWeaponModels = weaponModels;      // first-person viewmodels (index === weapon slot)
  CBZ.fpsCarriedModels = carriedModels;    // third-person carried guns
  CBZ.fpsWeaponIdOf = weaponIdOf;
  CBZ.fpsWeaponCount = function () { return WEAPONS.length; };
  CBZ.fpsWeaponIndex = function () { return fps.weapon; };
  // DO YOU ACTUALLY OWN A GUN — not "is first person on". fps.weapon is only
  // ever an INDEX into WEAPONS; it is 0 (the first slot) on a player who has
  // never picked anything up, so reading it as a weapon says "armed" to an
  // empty-handed inmate. availableIndices() is the same ownership test the
  // swap/reload paths already normalise against, so this cannot drift from
  // what those verbs would actually do.
  CBZ.fpsHasWeapon = function () { return availableIndices().length > 0; };
  // re-seed the current mag/reserve display after a mod purchase changes capacity
  CBZ.fpsResyncAmmo = function () { syncAmmo(); setAmmoHud(); };
  // TRUE while the player is HOLDING RMB to aim down sights, with a gun out and
  // mid-play (FPS or the 3PS shoulder). Read by city/camera.js to punch the
  // over-shoulder cam IN + narrow FOV on ADS. (Spread/recoil reduction is read
  // locally via aimHeld; this is the camera-side hook.)
  CBZ.isADS = function () { return aimHeld && armed() && (fps.active || shoulderActive()) && CBZ.game.state === "playing"; };
  CBZ.weaponThirdPersonActive = shoulderActive;
  CBZ.playerArmed = armed;
  CBZ.playerMuzzleWorld = function (out) { return muzzleWorld(out || new THREE.Vector3()); };
  // THE intent ray, for the other systems that used to re-derive it from the
  // lens. Once the third-person frame can be pinned (CAM_TP_FIXED_ANGLE) the
  // lens and the aim are two different directions, and every consumer that
  // guesses gets a different answer than the round does.
  CBZ.playerAimDir = function (out) { return aimForward(out || new THREE.Vector3()); };
  // ---- aim introspection for other systems (e.g. systems/intimidate.js) ----
  CBZ.currentGun = function () { return armed() ? weapon() : null; };   // equipped weapon or null
  CBZ.aimedActor = aimedActor;                                         // {actor,dist,head,point} | null
  // true while the player is actively presenting a firearm (FPS or the
  // third-person shoulder), in either pointing or aiming stance, mid-play.
  CBZ.isAimingWeapon = function () {
    return CBZ.game.state === "playing" && armed() && (fps.active || shoulderActive());
  };
  CBZ.onWeaponInventoryChanged = function (id, first) {
    const idx = weaponIndex(id);
    if (idx >= 0) fps.weapon = idx;
    normalizeWeapon();
    fps.reloading = 0;
    syncAmmo();
    weaponModels.forEach((m, i) => { m.visible = i === fps.weapon; });
    carriedModels.forEach((m, i) => { m.visible = i === fps.weapon; });
    setAmmoHud();
    if (CBZ.game.mode === "city" && CBZ.cityHudDirty) CBZ.cityHudDirty();
    // Auto-drop into FIRST-PERSON the moment you actually pick up a gun in
    // third person — FPS-with-a-gun is the intended way to shoot. Only on a
    // brand-new acquisition (first), only mid-play, never in survival.
    if (first && !fps.active && CBZ.game.state === "playing" && !CBZ.islandModeOn(CBZ.game.mode) && CBZ.game.mode !== "city") {
      setActive(true);
      fps.fp = Math.max(fps.fp, 0.06);
      // (no announcement — the camera dropping into first person IS the message)
    }
  };

  // ---- input ----
  document.addEventListener("mousemove", (e) => {
    if (!fps.active || document.pointerLockElement == null) return;
    // scoped look is proportionally finer (systems/lockon.js real sniper scope)
    const sensMul = CBZ.fpsLookSensMul ? CBZ.fpsLookSensMul() : 1;
    fps.fp = Math.max(-1.3, Math.min(1.3, fps.fp - e.movementY * SENS * sensMul));
    // cuffed: you can still look round, just not straight up or down at your feet
    if (CBZ.cuffedPlayer && cuffedHands()) fps.fp = CBZ.cuffedPlayer.clampPitch(true, fps.fp);
  });
  document.addEventListener("mousedown", (e) => {
    if (CBZ.islandModeOn(CBZ.game.mode)) return;   // island games: grapple / the mount own the pointer, not gunplay
    if ((fps.active || shoulderActive() || carGunEligible()) && CBZ.game.state === "playing" && document.pointerLockElement) {
      e.preventDefault();
      if (e.button === 0) fireControl(true);
      else if (e.button === 2) aimHeld = !cuffedHands();   // RMB raises the gun to aim (in a car: out of the window)
    }
  });
  document.addEventListener("mouseup", (e) => {
    if (e.button === 0) fireControl(false);
    else if (e.button === 2) aimHeld = false;
  });
  // suppress the context menu so right-click can drive third-person aiming
  document.addEventListener("contextmenu", (e) => {
    if ((fps.active || shoulderActive() || carGunEligible()) && CBZ.game.state === "playing") e.preventDefault();
  });
  addEventListener("wheel", (e) => {
    // CITY: the wheel walks EMPTY HANDS -> each gun -> back round. Only the
    // durable selection: a throwable, the flashlight or the phone would fire
    // just from scrolling past them; they answer the number keys and taps.
    if (CBZ.game.mode === "city") {
      if (CBZ.game.state !== "playing" || CBZ.cityMenuOpen || (CBZ.fullMap && CBZ.fullMap.active)) return;
      if (CBZ.verbWheel && CBZ.verbWheel.isOpen()) return;          // scrolling the verb wheel, not the guns
      // guns put away for a cop (police.js stowGuns): a scroll brings them back
      if ((CBZ.game._copStow || CBZ.game.cityStowedWeapon) && CBZ.cityRedrawWeapon) { e.preventDefault(); CBZ.cityRedrawWeapon(); return; }
      const bar = cityHotbar();
      const sel = [-1];                          // -1 = nothing in your hands
      let cur = -1;
      for (let i = 0; i < bar.length; i++) {
        if (bar[i].kind !== "gun") continue;
        sel.push(i);
        if (bar[i].active) cur = i;
      }
      if (sel.length <= 1) return;
      e.preventDefault();
      const pos = sel.indexOf(cur);
      const next = sel[(pos + (e.deltaY > 0 ? 1 : -1) + sel.length) % sel.length];
      if (next < 0) CBZ.cityHolster(true);
      else cityHotbarSelect(next);
      return;
    }
    if (!(fps.active || shoulderActive()) || !armed()) return;
    e.preventDefault();
    switchWeapon(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    // city owns [V] via city/view.js; Shark Sim has one camera and no [V]
    if (k === "v" && CBZ.game.mode !== "city" && CBZ.game.mode !== "sharksim") CBZ.toggleFPS();
    else if (k === "r" && (fps.active || shoulderActive())) reload();
    else if (k === "x" && (fps.active || shoulderActive()) && weapon().explosive &&
      !CBZ.cityMenuOpen && !(CBZ.fullMap && CBZ.fullMap.active) &&
      !(CBZ.buildMode && CBZ.buildMode.active)) {
      if (cycleRocketAmmoType()) { e.preventDefault(); if (CBZ.sfx) CBZ.sfx("rack", { volume: 0.35 }); }
    }
    // NOTE: Q (swap gun) is intentionally NOT handled here. Browsers buffer
    // keydown events during a lag spike and drain them over the following
    // frames, which produced "leftover" weapon switches after you stopped
    // mashing. Instead we read the live key state once per frame below
    // (rising-edge + cooldown), so buffered duplicates collapse to nothing.
    // F fires too, except in the city, where F is get in / get out
    // (city/interactions.js key map) and a trigger on it would shoot the car.
    else if (k === "f" && (fps.active || shoulderActive()) && !CBZ.islandModeOn(CBZ.game.mode) && CBZ.game.mode !== "city") fireControl(true);
    // H: homing on/off (owner toggle). Missile-class contexts only; state
    // cue is the rack sfx pitch + the lock squares standing down — no HUD.
    else if (k === "h" && CBZ.lockonHomingSet &&
      ((fps.active || shoulderActive()) && weapon().explosive || (CBZ.player && CBZ.player._aircraft))) {
      CBZ.lockonHomingSet(!CBZ.lockonHomingOn());
      if (CBZ.sfx) CBZ.sfx("rack", { volume: 0.3, pitch: CBZ.lockonHomingOn() ? 1.25 : 0.8 });
    }
  });
  addEventListener("keyup", (e) => {
    if (e.key.toLowerCase() === "f" && CBZ.game.mode !== "city") fireControl(false);
  });

  // ---- per-run reset ----
  let lastElapsed = 0;
  function checkReset() {
    const el = (CBZ.game.elapsed || 0);
    if (el + 0.001 < lastElapsed) {
      if (fps.active) setActive(false);
      if (CBZ.gunModsReset) CBZ.gunModsReset();   // a fresh run strips fitted attachments before rounds re-seed
      resetWeapons();
      // a fresh run starts on unmarked streets — wipe last run's bullet pocks
      // and rocket scars/smoking wounds
      if (CBZ.bulletHolesReset) CBZ.bulletHolesReset();
      if (CBZ.cityBlastFxReset) CBZ.cityBlastFxReset();
      shudders.length = 0;
    }
    lastElapsed = el;
  }

  // ---- SOFT AIM-LOCK (GTA-style, on-foot) ----------------------------------
  // When you aim down sights — even without a scope — the reticle eases onto the
  // nearest target in a forward cone and tracks it. Modeled on the vehicle
  // homing acquisition (cone-dot score + nearest), but instead of steering a
  // projectile it nudges cam.yaw / pitch, so the muzzle ray (and the bullet)
  // follow for free. One-line revert: CBZ.CONFIG.AIM_LOCK_ASSIST = false.
  if (CBZ.CONFIG.AIM_LOCK_ASSIST == null) CBZ.CONFIG.AIM_LOCK_ASSIST = true;
  let lockTarget = null, lockScanT = 0;
  const _lockEye = new THREE.Vector3(), _lockDir = new THREE.Vector3(), _lockRay = new THREE.Vector3();
  const _lockCands = [];
  // A CHILD IS NEVER A LOCK CANDIDATE (AIM_CHILD_NO_ASSIST). This is the
  // surface that literally moves the camera onto a target, so it is the one the
  // owner means by "the crosshair snaps to them". Putting the test in
  // lockValid — not in pickLockActor — closes BOTH ends at once: the acquire
  // never picks a child, AND applyAimLock re-runs lockValid on the held target
  // every frame, so a lock releases instantly if a record becomes protected
  // (crowd pooling recycles ped records; nothing here may be cached).
  function lockValid(a) { return a && !a.dead && (a.ko || 0) <= 0 && !a.escaped && a.group && a.group.visible !== false && !childUnaided(a); }
  function pickLockActor(eye, fwd, range, coneCos) {
    _lockCands.length = 0;
    const consider = function (list) {
      if (!list) return;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!lockValid(a)) continue;
        const gp = a.group.position, gy = gp.y || 0;
        const tx = gp.x - eye.x, ty = (gy + TORSO_Y) - eye.y, tz = gp.z - eye.z;
        const dist = Math.hypot(tx, ty, tz); if (dist < 0.6 || dist > range) continue;
        const dot = (tx * fwd.x + ty * fwd.y + tz * fwd.z) / dist;
        if (dot < coneCos) continue;                       // outside the acquire cone
        _lockCands.push({ a: a, dist: dist, nx: tx / dist, ny: ty / dist, nz: tz / dist,
          score: (1 - dot) * 8 + (dist / range) * 0.08 }); // most on-axis wins, nearness breaks ties
      }
    };
    consider(CBZ.cityPeds); consider(CBZ.cityCops); if (CBZ.cityMedics) consider(CBZ.cityMedics);
    _lockCands.sort(function (p, q) { return p.score - q.score; });
    // Best-first, first candidate with a clear line of sight wins — the same
    // no-lock-through-walls contract as the rocket acquisition above. Capped
    // raycasts (rescans run at 10Hz, so keep the per-tick cost bounded).
    for (let i = 0; i < _lockCands.length && i < 4; i++) {
      const c = _lockCands[i];
      _lockRay.set(c.nx, c.ny, c.nz);
      const cover = wallDistance(eye, _lockRay, c.dist);
      if (cover && cover.distance < c.dist - 1.2) continue;   // behind a wall
      return c.a;
    }
    return null;
  }
  // Ease the live aim toward the locked target's chest. Corrects against the
  // ACTUAL aim direction, so it works identically in FPS and 3rd-person shoulder
  // (both map an increasing cam.yaw to an increasing atan2(x,z) heading).
  function applyAimLock(dt) {
    if (CBZ.CONFIG.AIM_LOCK_ASSIST === false || !armed() || !CBZ.camera || !(CBZ.isADS && CBZ.isADS())) { lockTarget = null; return; }
    aimForward(_lockDir);
    CBZ.camera.getWorldPosition(_lockEye);
    lockScanT -= dt;
    if (!lockValid(lockTarget) || lockScanT <= 0) {
      lockScanT = 0.1;
      // The pick embeds the occlusion test, so re-running it every tick also
      // BREAKS the lock when the held target ducks behind cover — no tracking
      // people through walls (matches the dossier's aim contract).
      lockTarget = pickLockActor(_lockEye, _lockDir, 55, Math.cos(0.45));   // ~26° cone, 55m
    }
    if (!lockValid(lockTarget)) return;
    const gp = lockTarget.group.position, gy = gp.y || 0;
    const dx = gp.x - _lockEye.x, dy = (gy + TORSO_Y) - _lockEye.y, dz = gp.z - _lockEye.z;
    const dlen = Math.hypot(dx, dy, dz) || 1;
    let dHead = Math.atan2(dx / dlen, dz / dlen) - Math.atan2(_lockDir.x, _lockDir.z);
    while (dHead > Math.PI) dHead -= 2 * Math.PI; while (dHead < -Math.PI) dHead += 2 * Math.PI;
    const dPitch = Math.asin(Math.max(-1, Math.min(1, dy / dlen))) - Math.asin(Math.max(-1, Math.min(1, _lockDir.y)));
    const k = 1 - Math.pow(0.02, dt);                     // smooth ~fast settle onto target
    if (CBZ.cam) CBZ.cam.yaw += dHead * k;
    if (fps.active) fps.fp = Math.max(-1.3, Math.min(1.3, fps.fp + dPitch * k));
    // CBZ.camPitchRange is the single owner of the third-person envelope, so the
    // lock can settle onto a target as high as the view is allowed to look.
    // SIGN (fixed 2026-08-15): dPitch is UP-positive — it is a difference of
    // asin(y) terms — and so is fps.fp, but third-person cam.pitch is DOWN-
    // positive (the orbit is `oy = sin(pitch)·dist`, so a positive pitch puts
    // the lens ABOVE the pivot looking down). Adding it here drove the reticle
    // the wrong way in every third-person soft-lock: a target above your sights
    // pushed the aim further below them, then the lock re-measured a bigger
    // error and pushed harder. Only the branch's sign was ever wrong.
    else if (CBZ.cam) { const r = CBZ.camPitchRange ? CBZ.camPitchRange() : [-1.0, 0.9]; CBZ.cam.pitch = Math.max(r[0], Math.min(r[1], CBZ.cam.pitch - dPitch * k)); }
  }
  CBZ.aimLockTarget = function () { return lockTarget; };

  // ---- camera override and effects update ----
  // change-only style write: setting style.display every frame invalidates
  // style and measured milliseconds across a session (perf pass)
  CBZ.onAlways(52, function (dt) {
    checkReset();
    const chutePresentation = !!((CBZ.cityChuteState && CBZ.cityChuteState()) ||
      (CBZ.playerChar && CBZ.playerChar.skydiving));
    // bailout.js owns a dedicated two-hand/riser viewmodel. Hide the generic
    // fist/gun while it is active, then restore it automatically on landing.
    /* The gun stays in your hands down a scope too: you look THROUGH its
       ocular (systems/sights.js), not at a black mask with the gun deleted. */
    const seatGun = carGun();
    const cuffs = cuffedHands();
    if (ddT < 0) vm.visible = !!((fps.active || seatGun) && !chutePresentation && !aquaticRide() && !cuffs);
    const aiming = fps.active || shoulderActive() || seatGun;
    /* A SHARK HAS NO GUNSIGHT.

       OWNER (2026-09-01): "first person shark game should not have a crosshair
       ... failing at the req lol."

       The line above this one already knows: `vm.visible` drops the first-person
       hands on an aquatic mount, because you are the animal and animals have no
       hands. The reticle was the one piece of the gun HUD that never got the
       memo — it was gated on fpsmode being ACTIVE, full stop, with no reference
       to `armed()` or `aquaticRide()`. The ammo readout hides itself for free
       (it asks `armed()`, which is false on a shark); the crosshair asked
       nothing, so riding a shark in the eye view put a firearm reticle in the
       middle of the screen and left it there.

       Same predicate as the hands, for the same reason, so the two cannot
       disagree about whether you are currently a person. */
    // ...and not down the sights: the sight on the gun IS the reticle then
    const sighted = fps.active && !!(CBZ.fpsAdsK && CBZ.fpsAdsK() > 0.6);
    const crossShow = aiming && !chutePresentation && !aquaticRide() && !cuffs && !sighted &&
      CBZ.game.state === "playing";
    const cross = crossEl();
    if (cross && crossShow !== _crossShown) { cross.style.display = crossShow ? "block" : "none"; _crossShown = crossShow; }

    if (shotCD > 0) shotCD = Math.max(0, shotCD - dt);
    if (dryCD > 0) dryCD = Math.max(0, dryCD - dt);
    if (punchCD > 0) punchCD = Math.max(0, punchCD - dt);
    if (switchCD > 0) switchCD = Math.max(0, switchCD - dt);
    if (fpSwapT > 0) {
      fpSwapT = Math.max(0, fpSwapT - dt);
      fpSwapP = 1 - fpSwapT / fpSwapDur;
      if (fpSwapT <= 0) fpSwapP = 1;
    }

    // Q = swap gun, polled at frame rate. A switch only fires on a fresh
    // press (key was up last frame, down now) and only when off cooldown,
    // so a backlog of buffered keydowns can never replay as extra switches.
    const qNow = !!(CBZ.keys && CBZ.keys["q"]);
    // (not in the city: Q there is the verb wheel, and the mouse wheel swaps)
    if (qNow && !qWasDown && switchCD <= 0 && aiming && armed() && CBZ.game.mode !== "city") switchWeapon(1);
    qWasDown = qNow;

    for (let i = 0; i < tracers.length; i++) {
      const t = tracers[i];
      if (t.life > 0) {
        t.life -= dt;
        t.mesh.material.opacity = Math.max(0, t.life / t.max) * 0.9;
        if (t.life <= 0) t.mesh.visible = false;
      }
    }
    updateRockets(dt);   // (b) in-flight RPG projectiles: fly the arc, detonate on arrival
    updateRocketSmoke(dt);
    updateBullets(dt);   // rounds in flight: step, raycast the segment, land
    for (let i = 0; i < impacts.length; i++) {
      const p = impacts[i];
      if (p.life > 0) {
        p.life -= dt;
        p.mesh.material.opacity = Math.max(0, p.life / p.max);
        p.mesh.scale.multiplyScalar(1 + dt * 5.5);
        if (p.life <= 0) p.mesh.visible = false;
      }
    }
    for (let i = 0; i < casings.length; i++) {
      const c = casings[i];
      if (c.life > 0) {
        c.life -= dt;
        c.vel.y -= 8.5 * dt;
        c.mesh.position.addScaledVector(c.vel, dt);
        c.mesh.rotation.x += dt * 9;
        c.mesh.rotation.z += dt * 6;
        if (c.mesh.position.y < 0.06) {
          c.mesh.position.y = 0.06;
          c.vel.y = Math.abs(c.vel.y) * 0.22;
          c.vel.x *= 0.72;
          c.vel.z *= 0.72;
        }
        if (c.life <= 0) c.mesh.visible = false;
      }
    }

    // PANEL SHUDDER decay: shot cars wobble then settle dead-flat. Runs here
    // (above the !aiming early-out) so a shudder finishes even if the player
    // holsters the instant after the burst.
    for (let i = shudders.length - 1; i >= 0; i--) {
      const s = shudders[i];
      s.t += dt;
      const ud = s.car.group && s.car.group.userData;
      if (!ud || !ud.body || s.car.dead) { shudders.splice(i, 1); continue; }
      const k = s.t / s.dur;
      if (k >= 1) { ud.body.rotation.x = 0; shudders.splice(i, 1); continue; }
      ud.body.rotation.x = Math.sin(s.t * 72) * s.amp * (1 - k);
    }

    if (worldMuzzleT > 0) {
      worldMuzzleT -= dt;
      worldMuzzle.material.opacity = Math.max(0, worldMuzzleT / 0.065);
      if (worldMuzzleT <= 0) worldMuzzle.visible = false;
    }

    // DEATH DROP — runs in the unconditional zone so it finishes even though
    // view.js flips fps off the instant you die. The viewmodel pitches forward,
    // accelerates down and yaws/rolls out of the grip, then hides; meanwhile
    // the world prop falls from hand height, smacks the pavement and settles
    // on its side beside the body.
    if (ddT >= 0) {
      ddT += dt;
      const k = Math.min(1, ddT / DD_DUR);
      vm.visible = true; gun.visible = true; fists.visible = false; muzzle.visible = false; fpArms.visible = false;
      gun.position.set(k * 0.34, -k * k * 1.5, -k * 0.18);     // falls away, accelerating
      gun.rotation.set(k * 1.9, -k * 0.8, k * 1.1);            // pitches forward, yaws + rolls free
      if (k >= 1) { ddT = -1; gun.position.set(0, 0, 0); gun.rotation.set(0, 0, 0); vm.visible = false; }
    }
    if (dropMesh && !dropBody) {
      dropLife -= dt;
      if (dropLife <= 0) clearWorldDrop();
      else if (!dropLanded) {
        dropVy -= 20 * dt;
        dropMesh.position.x += dropVx * dt; dropMesh.position.y += dropVy * dt; dropMesh.position.z += dropVz * dt;
        dropMesh.rotation.x += dropSx * dt; dropMesh.rotation.y += dropSy * dt; dropMesh.rotation.z += dropSz * dt;
        const fl = (CBZ.floorAt ? CBZ.floorAt(dropMesh.position.x, dropMesh.position.z) : 0) + 0.09;
        if (dropMesh.position.y <= fl && dropVy < 0) {
          dropMesh.position.y = fl; dropLanded = true;
          dropMesh.rotation.set(0, dropMesh.rotation.y, Math.PI / 2 - 0.18);   // settles on its side
          if (CBZ.sfx) CBZ.sfx("shell");                                        // the clatter of steel on pavement
        }
      }
    }

    // HIT MARKER animation: ticks punch OUT from centre on the hit, then ease
    // back in while fading. A kill marker also rotates the whole cluster a few
    // degrees into an X and lingers longer. Runs unconditionally so it always
    // finishes its fade even if you lower the gun the instant after a kill.
    if (hitMarkerT > 0) {
      hitMarkerT = Math.max(0, hitMarkerT - dt);
      const k = hitMarkerT / hitMarkerDur;             // 1 -> 0
      const e = k * k;                                  // ease-out fade
      // splay snaps wide (~9px) then settles to ~5px as it fades
      const spread = 5 + e * 5;
      hitMarker.placeTicks(spread);
      const spin = hitMarkerKill ? (1 - k) * 14 : 0;    // tilt into an X on a kill
      const sc = 0.85 + e * 0.35;
      hitMarker.wrap.style.transform =
        "translate(-50%,-50%) rotate(" + spin.toFixed(1) + "deg) scale(" + sc.toFixed(2) + ")";
      hitMarker.wrap.style.opacity = Math.min(1, k * 1.6).toFixed(3);
      if (hitMarkerT <= 0) hitMarker.wrap.style.display = "none";
    }

    // a corpse doesn't present a weapon: shoulderActive() doesn't know about
    // death, so without this gate the carried gun stayed posed in the dead
    // player's grip and the arm-damp below kept aiming the ragdoll (user: "you
    // don't hold your weapon when you die"). The death tumble above owns the vm.
    if (!aiming || (CBZ.player && CBZ.player.dead)) {
      carriedGun.visible = false;
      // STUCK-POSE FIX: this early-out skips the pose writer at the bottom of
      // the TP branch, so holstering / switching to melee / dying while in TP
      // used to leave aimingPose latched true and the rig frozen squared-up
      // forever ("holds arms up like squaring up all the time"). Clear both
      // stance flags on the way out so animChar's natural idle takes over.
      if (CBZ.playerChar) { CBZ.playerChar.aimingPose = false; CBZ.playerChar.carryPose = false; }
      return;
    }

    if (fps.reloading > 0) {
      fps.reloading -= dt;
      if (fps.reloading <= 0) finishReloadStep();
      else setAmmoHud();
    }
    // NOTE: held-trigger auto fire moved BELOW the pose updates — see end of
    // this callback. Firing here read last frame's camera/rig mid-recoil-swing,
    // which is the other half of "sustained fire creeps off the barrel".

    let bobY = 0, bobX = 0;
    const p = CBZ.player;
    if (fps.active) {
      const eyeH = p.prone ? 0.55 : p.crouch ? 1.18 : 1.65;   // prone (stance machine) hugs the deck
      if (p.grounded && p.speed > 0.6 && (p.stun || 0) <= 0) {
        bobPhase += dt * (6 + p.speed * 1.1);
        bobY = Math.sin(bobPhase * 2) * 0.035;
        bobX = Math.sin(bobPhase) * 0.03;
      }
      forward(fwd);
      buildBasis(fwd);
      // a car door beat (CBZ.moves board/alight) carries the head down into
      // the cabin and back out: the lens rides the head, not a fixed 1.65 m
      const carEye = CBZ.moves && CBZ.moves.eyeY ? CBZ.moves.eyeY(p) : null;
      eye.set(p.pos.x, carEye != null ? carEye : p.pos.y + eyeH + bobY, p.pos.z).addScaledVector(right, bobX);
      CBZ.camera.position.copy(eye);
      tmp.copy(eye).add(fwd);
      CBZ.camera.lookAt(tmp);
      if (fpRoll !== 0 && !armed()) CBZ.camera.rotateZ(fpRoll);   // the torso turns behind a cross or a hook
      // ADS ZOOM (RMB): ease the FPS lens ~14° tighter while aiming, back out on
      // release. Capture the hip fov from camera.js's value only while NOT aiming
      // (and clamp sane) so reading our own zoomed value can never ratchet it.
      //
      // SINGLE-OWNER GATE (city FPS-FOV flicker fix): in the CITY, the first-person
      // lens is OWNED by systems/camera.js's cc.fp branch (onAlways 50) — it eases
      // camera.fov toward an ADS-aware target with its OWN SmoothDamp state. This
      // block ALSO ran every city frame easing toward the ADS fov with a
      // SEPARATE easing; two writers racing toward the (same) target with different
      // smoothing states produced the in/out ADS FLICKER while RMB was held. So in
      // city we SKIP this entirely and let camera.js solely drive the FOV. Outside
      // city (prison/escape FPS) camera.js's city branch never runs, so this block
      // remains the sole FOV owner there — byte-identical behaviour for those modes.
      // FP-FOV runs in ALL modes now. While fps.active, camera.js bows out of the
      // FP lens (it early-returns) so THIS block is the genuine sole FP-FOV owner
      // — no second writer to race, no flicker. (The old `mode!=="city"` gate left
      // city FP with nobody narrowing the FOV → RMB never zoomed.)
      {
        const ads = aimHeld && armed();
        // HIP FOV IS A STABLE BASELINE — captured ONCE, never re-read from the
        // live lens. The old code re-captured it every non-ADS frame; that was
        // the RATCHET bug: camera.js now bows out of the FP lens (sole-owner fix),
        // so right after you release RMB the lens is still easing BACK from the
        // ADS punch-in — re-capturing that half-zoomed value as the new "hip" made
        // every right-click zoom in further and never zoom back out. A fixed hip
        // means RMB eases to hip−DROP and release eases cleanly back to hip.
        if (fpsHipFov === 0) fpsHipFov = 75;   // FP hip; the ADS target is the weapon's own optic (below)
        // a mounted scope (city/gunmods.js) overrides the ADS target with a much
        // tighter lens — a red-dot barely nudges it, a sniper scope slams it to ~12°.
        // The factory sniper's REAL scope (systems/lockon.js) reads first; it
        // returns null whenever a gunsmith optic is fitted, so exactly one wins.
        const scopeF = (CBZ.fpsScopeFov && CBZ.fpsScopeFov()) || (CBZ.cityScopeFov && CBZ.cityScopeFov());
        const aw = armed() ? weapon() : null;
        const wantFov = scopeF ? scopeF
          : (ads && CBZ.weaponAdsFov ? CBZ.weaponAdsFov(aw, fpsHipFov) : (ads ? fpsHipFov - 25 : fpsHipFov));
        /* AND THE SPEED OF THE PUNCH-IN IS THE OPTIC'S OWN. A Glock comes up
           in 0.20 s and a 7 kg belt-fed gun with a magnified sight does not;
           the old single `dt * 12` meant every weapon in the game shouldered
           at the same rate, which is the same flatness the FOV had. Coming
           OUT is always fast — dropping a gun off the eye is not the same
           motion as bringing it up. */
        const oRow = CBZ.weaponOptic ? CBZ.weaponOptic(aw) : null;
        const adsSec = Math.max(0.06, (oRow && oRow.ads) || 0.22);
        const easeK = ads ? (1 / adsSec) : 9;
        if (Math.abs(CBZ.camera.fov - wantFov) > 0.05) {
          CBZ.camera.fov += (wantFov - CBZ.camera.fov) * Math.min(1, dt * easeK * 2.2);
          CBZ.camera.updateProjectionMatrix();
        }
      }
    }

    // SMOOTHER recoil RECOVERY: after a brief hold (so the kick reads), the gun
    // springs back toward true centre with an ease that's gentle near zero —
    // no abrupt rubber-band snap, no lingering offset. recoilSide settles a bit
    // faster (horizontal kick should self-correct first, like real muzzle climb
    // recovery). Pulling the muzzle climb (fp/pitch) back down is what makes a
    // mag-dump return to where you were aiming instead of drifting up the wall.
    if (recoilHold > 0) recoilHold = Math.max(0, recoilHold - dt);
    else {
      const rk = 1 - Math.pow(0.0004, dt);          // ~smooth critically-damped feel (settles a touch faster — mag dumps recenter)
      recoil += (0 - recoil) * rk;
    }
    // Return the visible camera impulse. Recovery moves the same pitch/yaw the
    // shot kicked; it cannot silently bend a bullet away from the reticle.
    {
      const wNow = armed() ? weapon() : null;
      const recenter = (wNow && wNow.recenter) || 0.18;     // seconds to settle
      // "firing this frame" while an auto weapon's trigger is held → recover slow
      // (so the kick reads); otherwise recover full speed (4x).
      const firing = recoilHold > 0 || (triggerHeld && wNow && wNow.auto && fps.rounds[fps.weapon] > 0);
      const recoverK = firing ? 0.25 : 1.0;
      // ADS_RECOIL_SETTLE: while aiming, recover the view-return debt faster so
      // the reticle SETTLES back onto the target between shots instead of
      // wandering up-screen. Reuses adsRecoilMul()'s aimHeld predicate as the ADS
      // gate; the recoil KICK is untouched — only the recentering RATE is tuned.
      // Clamped ≤1 so a fast burst can't over-correct past true centre.
      const adsSettle = (CBZ.CONFIG.ADS_RECOIL_SETTLE !== false && adsRecoilMul() < 1) ? 1.7 : 1.0;
      const settle = Math.min(1, recoverK * adsSettle * (1 - Math.exp(-dt / recenter)));
      const rp = recoilPitch * settle;
      const ry = recoilYaw * settle;
      if (fps.active) fps.fp = Math.max(-1.3, Math.min(1.3, fps.fp - rp));
      // Recovery must clamp against the same envelope the kick did (owned by
      // CBZ.camPitchRange), or a shot fired near the top would not fully return.
      else if (CBZ.cam) { const r = CBZ.camPitchRange ? CBZ.camPitchRange() : [-1.0, 0.9]; CBZ.cam.pitch = Math.max(r[0], Math.min(r[1], CBZ.cam.pitch + rp)); }
      if (CBZ.cam) CBZ.cam.yaw -= ry;
      recoilPitch -= rp;
      recoilYaw -= ry;
      if (Math.abs(recoilPitch) < 1e-5) recoilPitch = 0;
      if (Math.abs(recoilYaw) < 1e-5) recoilYaw = 0;
      // BURST RESET: a fire gap of >0.25s wipes the ramp + pattern position so
      // the next round is a fresh, pinpoint first shot.
      sinceShot += dt;
      if (sinceShot > 0.25 && shotsInBurst !== 0) shotsInBurst = 0;
    }
    recoilSide += (0 - recoilSide) * Math.min(1, 13 * dt);
    vmPunch += (0 - vmPunch) * Math.min(1, 10 * dt);
    pumpT = Math.max(0, pumpT - dt * 4.5);
    if (boltT >= 0) {
      boltT += dt;
      // done, or taken over by a reload / a weapon that has no bolt
      const bw = WEAPONS[fps.weapon];
      if (boltT > BOLT_DELAY + BOLT_DUR || fps.reloading > 0 || !bw || bw.fireMode !== "bolt") boltT = -1;
    }
    // BLOOM tightens back toward zero when not firing; faster while standing
    // still (the discipline reward). triggerHeld auto-fire keeps it propped up.
    {
      const settleSpeed = (CBZ.player.speed || 0) < 0.6 && CBZ.player.grounded !== false ? 6.5 : 3.2;
      bloom = Math.max(0, bloom - bloom * Math.min(1, settleSpeed * dt) - 0.0008 * dt);
    }

    if (!armed()) animFists(dt);

    const w = weapon();
    const reloadDip = fps.reloading > 0 ? 0.13 + Math.sin(CBZ.now * 0.018) * 0.025 : 0;
    if (fps.active || seatGun) {
      // First-person: the player body is hidden, so the 3PS aim/carry poses
      // must not linger on the rig (animChar reads these flags). Clear here.
      if (CBZ.playerChar) { CBZ.playerChar.aimingPose = false; CBZ.playerChar.carryPose = false; }
      // A holster flips the gameplay gate immediately, but its outgoing gun
      // must begin from the armed carry pose. Starting it from the fist pose
      // pulled a long gun inward/UP before the stow offsets ran, which read as
      // a draw. Keep the old viewmodel on its actual carry baseline until it
      // has dipped out, then reveal the fist.
      const fpStowingGun = fpSwapT > 0 && !!fpSwapFrom && !fpSwapTo && fpSwapP < 0.80;
      if (armed() || fpStowingGun) {
        // THE HIP CARRY, then the sight. systems/sights.js solves the raise:
        // the gun's own sight eye point onto the camera, its line of sight
        // onto the view axis, both hands still on it (the arms re-solve off
        // the moved gun in poseFpArms). Bullets fly the camera ray, which is
        // now exactly the sight line. Recoil at the hip kicks the corner
        // carry; down the sights it kicks the gun OFF the sight line and
        // sights.js lets it settle back as `recoil` decays.
        vm.position.set(
          0.36 - bobX * 0.5 + recoilSide * 0.55,
          -0.34 + bobY * 0.5 - recoil * 0.08 - vmPunch * 0.18 - reloadDip,
          -0.72 + recoil * 0.12 - vmPunch * 0.3
        );
        vm.rotation.set(-0.10 + recoil * 0.26 + vmPunch * 0.4 + reloadDip * 0.8, 0, recoilSide * 0.7 - bobX * 0.18);
        if (CBZ.sights && CBZ.sights.fpApply && !fpStowingGun) {
          adsOpts.aim = aimHeld; adsOpts.dt = dt; adsOpts.recoil = recoil; adsOpts.recoilSide = recoilSide;
          adsOpts.punch = vmPunch; adsOpts.reload = fps.reloading > 0; adsOpts.swap = fpSwapT > 0;
          adsOpts.bobX = bobX; adsOpts.bobY = bobY;
          CBZ.sights.fpApply(vm, weaponModels[fps.weapon], w, adsOpts);
        }
        // A RELOAD BRINGS THE GUN IN to the off hand: toward the chest, turned
        // and canted so the part being worked faces it (CBZ.gunReload fp row)
        if (fps.reloading > 0 && CBZ.gunReload && CBZ.gunReloadPose) {
          const rpw = CBZ.gunReloadPose();
          const fw = CBZ.gunReload.fpWork(weaponModels[fps.weapon], rpw.active ? rpw.p : -1, _fpWork);
          vm.position.x += fw[0]; vm.position.y += fw[1]; vm.position.z += fw[2];
          vm.rotation.y += fw[3]; vm.rotation.z += fw[4];
        }
      } else {
        // unarmed single hand sits low and to the right (Minecraft-style)
        vm.position.set(0.12 * (1 - guardK) + bobX * 0.4, -0.30 + bobY * 0.5 - vmPunch * 0.05, -0.66 - vmPunch * 0.05);
        vm.rotation.set(vmPunch * 0.10, 0, -bobX * 0.10);   // (y too: a sighted pose may have left a yaw)
      }
      // First person gets only the near-field portion of a holster: the old
      // gun dips out below/right, then the fist rises. The full hand-to-mount
      // travel belongs to the visible third-person body in holsterprops.js.
      if (fpStowingGun) {
        const k = fpSwapP / 0.80;
        const e = k * k * (3 - 2 * k);
        vm.position.x += 0.25 * e;
        vm.position.y -= 0.65 * e;
        vm.position.z -= 0.16 * e;
        vm.rotation.x += 0.30 * e;
        vm.rotation.z += 0.20 * e;
      } else if (fpSwapT > 0 && fpSwapTo) {
        const dip = Math.sin(Math.PI * fpSwapP) * 0.08;
        vm.position.y -= dip;
        vm.rotation.x += dip * 0.9;
      }
      carriedGun.visible = false;
    } else {
      attachCarriedGun();
      carriedGun.visible = armed() && !CBZ.player._swim && !chutePresentation;
      // the hold engine's class (systems/actorweapons.js CBZ.holds): the Uzi
      // rides slot "auto" but is a handgun; the stocked MP5 is a long gun
      const longGun = CBZ.holds ? CBZ.holds.classOf(w) === "long" : (w.slot === "long" || w.slot === "rifle" || w.slot === "auto");
      const util = w.slot === "utility";
      // Two carry stances: a relaxed LOW-READY (gun lowered and tucked to
      // the side so it never juts through the chest when viewed from
      // behind) and a raised AIM pose. We only raise when actually PRESENTING
      // — aiming (RMB), holding the trigger, or while recoil settles after a
      // shot — so by default the player CARRIES the weapon (RDR2/Fortnite
      // carry) instead of permanently pointing it. A regression had hard-wired
      // `aim = true`, which both squared the arms up forever AND barrel-locked
      // the gun along the camera ray every frame — from the over-shoulder cam
      // a forward-locked barrel is foreshortened to a few pixels behind the
      // torso, which is why the owner never SAW the gun in third person.
      // CITY_TP_LOWREADY=false reverts to the old always-raised behavior.
      const aim = CBZ.CONFIG.CITY_TP_LOWREADY === false ? true : presenting();
      // gun sits a touch lower / tilted down when at the ready
      // Nudge the carried gun a touch UP + FORWARD so the muzzle clears the
      // chest silhouette when the arm is raised into the present-weapon pose
      // (animChar owns the arm; this just keeps the barrel reading on-screen).
      carriedGun.position.set(
        (longGun ? 0.04 : 0.00) + recoilSide * 0.18,
        (aim ? (longGun ? 0.04 : 0.01) : -0.12) - reloadDip * 0.16,
        (aim ? (longGun ? 0.30 : (util ? 0.14 : 0.22)) : 0.02) - recoil * 0.07
      );
      // Barrel-down-the-forearm baseline (-π/2, no Math.PI on Y) — the FALLBACK
      // orientation if the world barrel-lock below can't run (no parent yet).
      carriedGun.rotation.set(
        -1.571 + (aim ? 0.0 : 0.18) + recoil * 0.12 + reloadDip * 0.22,
        -0.04,
        -0.03 + recoilSide * 0.75
      );
      // ---- WORLD BARREL LOCK (the owner-reported "gun faces the wrong way" in
      // third person): the pose chain (body-yaw damp → shoulder → elbow → hand)
      // only APPROXIMATES the aim, so the barrel visibly drifted off the
      // crosshair — FP is exact because it draws its own viewmodel. Standard TP
      // fix: keep the gun's POSITION parented to the hand, but override its
      // ORIENTATION in world space every frame so the barrel points exactly at
      // the crosshair ray's far point (parallax-correct from the gun's own
      // position). Recoil/reload kick re-applied as local perturbations on top.
      // Only while PRESENTING — the low-ready carry keeps the local
      // down-forward fallback pose above (a lowered gun locked to the horizon
      // crosshair would twist against the hip-carry arm).
      if (aim && carriedGun.parent && CBZ.camera) {
        carriedGun.parent.updateWorldMatrix(true, false);
        carriedGun.getWorldPosition(_blGunPos);
        // aimForward() rather than the lens quaternion: identical while the
        // camera IS the aim (it is literally getWorldDirection), and the only
        // correct answer once the frame is pinned (CAM_TP_FIXED_ANGLE) — a
        // barrel locked to a lens that no longer follows the reticle would
        // photograph a man firing level at something above his head.
        aimForward(_blDir);
        _blTarget.copy(CBZ.camera.position).addScaledVector(_blDir, 120);
        _blDir.copy(_blTarget).sub(_blGunPos).normalize();
        // matrix with -Z along the aim dir (+Y kept upright) = barrel on target
        _blMat.lookAt(_blZero, _blDir, _blUp);
        _blWorldQ.setFromRotationMatrix(_blMat);
        carriedGun.parent.getWorldQuaternion(_blParentQ);
        carriedGun.quaternion.copy(_blParentQ.invert()).multiply(_blWorldQ);
        // kick: muzzle climbs on recoil, dips on reload — about the gun's own X
        carriedGun.rotateX(recoil * 0.12 + reloadDip * 0.22);
      }
      if (CBZ.playerChar) {
        const yaw = Math.atan2(-Math.sin(CBZ.cam.yaw), -Math.cos(CBZ.cam.yaw));
        // CAM_FACING_BLEND: ramp the ease rate in after a draw (see physics.js's
        // twin on the unarmed side) so drawing a gun sweeps the body to camera-
        // forward instead of snapping it.
        const faceEase = CBZ.camFacingEase ? CBZ.camFacingEase() : 1;
        CBZ.playerChar.group.rotation.y = CBZ.lerpAngle(CBZ.playerChar.group.rotation.y, yaw, 1 - Math.pow(0.00008, dt * faceEase));
        // HAND OFF the arm pose to animChar (the single owner of the arms — see
        // entities/character.js). fpsmode no longer writes ra/la directly: it
        // only RAISES the flag + feeds the data the pose needs, so the per-frame
        // animChar pass can HOLD the aim pose without a tug-of-war damping the
        // arm back toward idle. animChar reads aimingPose / aimLong / aimRecoil /
        // aimRecoilSide and builds the Fortnite-style present-weapon pose.
        // TWO-STANCE: present pose only while actually presenting; otherwise
        // the LOW-READY carry (armed() is guaranteed true in this branch —
        // shoulderActive() gates `aiming`). Unarmed/holstered never reaches
        // here (early-out above clears both flags), giving the NPC-style idle.
        CBZ.playerChar.aimingPose = aim;
        CBZ.playerChar.carryPose = !aim;
        CBZ.playerChar.aimLong = longGun;
        CBZ.playerChar.aimRecoil = recoil;
        CBZ.playerChar.aimRecoilSide = recoilSide;
        // HOW HEAVY IS THIS THING (weapon-data.js `hold`) — the pose is the
        // rig's, the WEIGHT is the weapon's. Same hand-off contract as
        // aimLong: fpsmode raises no arm, it just publishes the data. Absent
        // `hold` reads 0 and every existing weapon poses exactly as before.
        const hold = w && w.hold;
        CBZ.playerChar.aimHeavy = hold ? (hold.heavy || 0) : 0;
        CBZ.playerChar.aimSupport = hold ? (hold.support || 0) : 0;
        // The body draws a deployed bipod off the same signal the ballistics
        // brace off — one notion of "supported", never two.
        CBZ.playerChar.aimBipod = bipodActive(w);
      }
    }

    weaponModels.forEach((m, i) => { m.visible = i === fps.weapon; });
    carriedModels.forEach((m, i) => { m.visible = i === fps.weapon; });
    // THE RACK: one stroke (CBZ.gunReload.rack), on the viewmodel and the carried gun
    const RLk = CBZ.gunReload;
    const rackDz = RLk ? RLk.rackAt(pumpT) : Math.sin(pumpT * Math.PI) * 0.22;
    const sg = weaponModels[1];
    if (sg && sg.userData.pump) sg.userData.pump.position.z = sg.userData.pumpBaseZ + rackDz;
    const carriedSg = carriedModels[1];
    if (carriedSg && carriedSg.userData.pump) carriedSg.userData.pump.position.z = carriedSg.userData.pumpBaseZ + rackDz;
    // the same rack, published for the third-person gun (systems/holsterprops.js
    // slides that prop's pump and systems/actorweapons.js the support hand on it)
    CBZ.fpsPumpRack = rackDz;
    // …and the bolt: where the firing hand is in working it (-1 = on the grip)
    CBZ.fpsBoltCycle = boltT >= BOLT_DELAY ? Math.min(1, (boltT - BOLT_DELAY) / BOLT_DUR) : -1;
    const fpStowingGun = fps.active && fpSwapT > 0 && !!fpSwapFrom && !fpSwapTo && fpSwapP < 0.80;
    // TAKING A THING (systems/verbs_pickup.js): for its beat a pickup owns one
    // hand's wrist target; a held gun dips out of frame and comes back after.
    const pick = CBZ.verbs && CBZ.verbs.fpPickup ? CBZ.verbs.fpPickup(vm, fistT, handR, handL, armed() || fpStowingGun) : null;
    // the charge / detonator / frag in the right hand owns its wrist target
    // (systems/helditems.js), unless a pickup has the hand this beat
    if (CBZ.heldItem) CBZ.heldItem.fpHold(pick ? null : vm, fistT, pick ? null : handR, handL);
    // a vault / mantle puts the bare hands on the obstacle (after the fists' own pose)
    if (!pick && !armed()) fpPlants(); else { fistT[0].plantW = 0; fistT[1].plantW = 0; }
    gun.visible = (armed() || fpStowingGun) && !(pick && pick.hands);
    fists.visible = (!armed() && !fpStowingGun) || !!(pick && pick.hands);
    if (ddT < 0) gun.position.y = pick ? -0.9 * pick.gunDip : 0;
    poseFpArms(dt);
    if (CBZ.fpTorchHold) CBZ.fpTorchHold(FP_TORCH_VIEW);

    if (muzzleT > 0) {
      muzzleT -= dt;
      muzzle.material.opacity = Math.max(0, muzzleT / (w.key === "taser" ? 0.07 : (w.key === "shotgun" ? 0.065 : 0.04)));
      if (muzzleT <= 0) muzzle.visible = false;
    }

    // SOFT AIM-LOCK: ease the reticle onto the nearest target while ADS, before
    // the held-fire + reticle sample below read the aim — so both track the lock.
    applyAimLock(dt);

    // HELD-TRIGGER auto fire — AFTER this frame's camera + viewmodel +
    // carried-gun/arm pose are final, so every round of a burst samples the
    // SAME fresh matrices a single tap does (taps fire post-render from the
    // mouse event). The flash sprite, tracer and casing all read muzzleWorld
    // off the pose that's about to be RENDERED, keeping the stream visually
    // welded to the barrel through a whole mag-dump.
    if (triggerHeld && w.auto) shoot();

    // `cross` is already resolved at the top of this same pass
    if (cross) {
      const aim = aimedActor(armed() ? w.range : MELEE);
      // reticle breathes with the live cone: tight at rest, blooms with recoil,
      // bloom accumulation, movement AND suppression — so the crosshair
      // HONESTLY shows where shots will land (the AAA contract between
      // reticle and spread; suppressK mirrors the same penalty shoot() folds
      // into the actual cone, so a rattled player SEES why they're missing).
      const mv = CBZ.player.grounded === false ? 0.6 : Math.min(1, (CBZ.player.speed || 0) / 6);
      const suppK = CBZ.suppressionAccuracyMul ? CBZ.suppressionAccuracyMul(CBZ.player) : 1;
      const adsReticleK = aimHeld ? 0.58 : 1;
      const bipodK = bipodActive(w) ? 0.48 : 1;
      const size = armed()
        ? Math.min(30, Math.max(16, (12 + w.spread * 180 + bloom * 240 + recoil * 16 + mv * 7 + (fps.reloading > 0 ? 6 : 0)) * suppK * adsReticleK * bipodK))
        : 18;
      cross.style.width = size.toFixed(1) + "px";
      cross.style.height = size.toFixed(1) + "px";
      reticleState.conePx = size;

      // Project the REAL muzzle ray's nearest impact. In open space this sits
      // at screen centre; beside a wall it shifts to expose shoulder parallax
      // instead of promising a shot the barrel cannot physically make.
      let cameraHit = null, muzzleHit = null, muzzleBlocked = false;
      if (armed() && CBZ.camera) {
        aimForward(reticleDir);
        cameraHit = resolveShot(w, reticleDir);
        if (cameraHit && cameraHit.point) reticlePoint.copy(cameraHit.point);
        else reticlePoint.copy(CBZ.camera.position).addScaledVector(reticleDir, w.range);
        muzzleWorld(reticleOrigin);
        const intendedDistance = reticleOrigin.distanceTo(reticlePoint);
        reticleDir.copy(reticlePoint).sub(reticleOrigin).normalize();
        muzzleHit = resolveShot(w, reticleDir, reticleOrigin);
        const cameraIdentity = reticleHitIdentity(cameraHit);
        const muzzleIdentity = reticleHitIdentity(muzzleHit);
        // Camera intent and barrel truth are allowed to disagree beside cover,
        // but the HUD must SAY so. Amber means the actual muzzle ray is caught
        // by something nearer than the object under the centre sight.
        muzzleBlocked = !!(cameraIdentity && muzzleIdentity !== cameraIdentity && muzzleHit &&
          muzzleHit.dist + 0.22 < intendedDistance && (muzzleHit.wall || reticleDamageable(muzzleHit)));
        if (muzzleHit && muzzleHit.point) reticlePoint.copy(muzzleHit.point);
        reticlePoint.project(CBZ.camera);
        if (Number.isFinite(reticlePoint.x) && Number.isFinite(reticlePoint.y) && reticlePoint.z > -1 && reticlePoint.z < 1) {
          const sx = Math.max(4, Math.min(96, (reticlePoint.x * 0.5 + 0.5) * 100));
          const sy = Math.max(4, Math.min(96, (-reticlePoint.y * 0.5 + 0.5) * 100));
          cross.style.left = sx.toFixed(2) + "%";
          cross.style.top = sy.toFixed(2) + "%";
          reticleState.x = sx; reticleState.y = sy;
        } else {
          cross.style.left = cross.style.top = "50%";
          reticleState.x = reticleState.y = 50;
        }
      } else {
        reticleState.x = reticleState.y = 50;
      }
      reticleState.blocked = muzzleBlocked;
      reticleState.target = reticleHitKind(muzzleHit || cameraHit);
      // A HOT reticle over somebody no weapon in this game can hurt is the HUD
      // promising a shot that childsafe.js will refuse (AIM_CHILD_NO_ASSIST).
      // Tested on BOTH the acquire and the real muzzle hit, because either can
      // be the protected actor; childUnaided(null) is false, so nothing else
      // changes and the "blocked"/"dry"/"locked" states are untouched.
      const aimProtected = childUnaided(aim && aim.actor) || childUnaided(muzzleHit && muzzleHit.actor);
      cross.classList.toggle("hot", !muzzleBlocked && !aimProtected && (!!aim || reticleDamageable(muzzleHit)));
      cross.classList.toggle("blocked", muzzleBlocked);
      cross.classList.toggle("dry", armed() && fps.ammo <= 0);
      cross.classList.toggle("locked", !!lockTarget);   // soft aim-lock is tracking someone
    }
  });

  // keep ammo HUD honest if you pick up the gun mid-FPS
  CBZ.onUpdate(53, setAmmoHud);

  // Declared at LOAD, not on the first trigger pull, so CBZ.blastAudit()
  // reports what the world is WIRED with rather than what has been shot. The
  // rocket and the 40 mm share this one site: weapon-data gives both the same
  // 1.9/13, and both leave through the same `w.explosive` branch. An ARRAY
  // because this file loads well before systems/impactbus.js does.
  (CBZ.ordnanceBusSites = CBZ.ordnanceBusSites || []).push("fps:rocket");
})();

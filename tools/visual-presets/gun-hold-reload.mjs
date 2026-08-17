/* How the player HOLDS a gun, and what happens when they reload it.
   For tools/visual-compare.mjs. Run: `npm run ba -- gun-hold-reload`.

   OWNER (2026-08-17): "I want animation in player for reloading gun, and I
   want to improve how they hold gun — right now it looks like the non-trigger
   hand is holding ABOVE the gun, not holding it."

   Staged like weapon-holds.mjs / outfit-gallery.mjs, which is to say: the REAL
   city boots once per side with a pinned seed, free play is entered through
   the actual play button, rAF is stubbed so CBZ.stepSim(1/60) is the only
   clock, and every weapon is acquired through CBZ.unlockWeapon — the real
   path. Nothing here pokes a rig transform to fake a pose. The reload
   subjects press the game's own CBZ.fpsReload() and then step the sim to the
   frame being photographed, so the picture is whatever the shipped animation
   does at that instant, including "nothing".

   ---- THE NUMBERS, measurable identically on BOTH sides ------------------
   The fix adds authored grip anchors to the weapon models, so "the hand is on
   the handguard" cannot be scored against an anchor the BEFORE build does not
   have. Both metrics below are computed from geometry that has shipped for
   months — the weapon's own `userData.muzzle` and the rig's left-hand socket
   — so the comparison is honest in both directions.

     axisGap    cm from the off hand to the weapon's BORE AXIS (the segment
                from the prop's origin to its authored muzzle). A hand
                actually wrapped round a handguard sits ~7-12 cm off the bore
                — the thickness of the gun plus the hand. A hand posed by a
                guess that never saw this weapon sits wherever it sits.
                LOWER IS BETTER, and there is a floor: 0 would mean the hand
                is inside the barrel.
     handAbove  cm the off hand rides ABOVE the nearest point of that axis.
                This is the owner's sentence as a signed number: positive and
                large is the reported bug, "holding above the gun".
     travel     cm the off hand moves, MEASURED IN BODY SPACE so walking and
                turning cannot inflate it, over one complete reload. A build
                with no reload animation scores its breathing. HIGHER IS
                BETTER, and it is the only metric here that is.

   Diagnostics printed under each frame (weapon, stance, reload phase, whether
   the drawn prop publishes grips) say WHY a frame looks the way it does
   rather than leaving the reader to guess. */

const HOLD = (id, weapon, label, focus, view, extra) => Object.assign(
  { id, weapon, label, focus, view, kind: "hold" }, extra || {});
const RELOAD = (id, weapon, at, label, focus, view) =>
  ({ id, weapon, at, label, focus, view, kind: "reload" });

const subjects = [
  HOLD("hold-carbine", "carbine", "Presenting · M4 carbine · side",
    "THE BUG, most common weapon. The off hand belongs UNDER the polymer handguard, wrapped round it. Watch the gap between the left fist and the top of the gun.",
    "side"),
  HOLD("hold-lmg", "lmg", "Presenting · M249 LMG · side",
    "The worst case: 7.5 kg and the longest receiver in the game. Any support pose authored as fixed angles rather than solved to THIS gun misses it by the most here.",
    "side"),
  HOLD("hold-ak47", "ak47", "Presenting · AK-47 · three-quarter front",
    "Down-range of the shooter: from the front you can see whether the left hand is closed on the wood handguard or hovering in the air beside it.",
    "quarter"),
  HOLD("hold-shotgun", "shotgun", "Presenting · 12g pump · side",
    "The support hand on a pump gun is not decoration — it is the hand that works the action. It has to be ON the fore-end.",
    "side"),
  HOLD("hold-sidearm", "sidearm", "Presenting · 9mm sidearm · three-quarter front",
    "A pistol is a two-hand shot. Both hands should meet at the grip in one fist, not float apart.",
    "quarter"),
  HOLD("carry-carbine", "carbine", "LOW READY · M4 carbine · side",
    "Not presenting — the walking-around carry, which is what the player sees most of the time. The rifle is still a two-hand object.",
    "side", { aim: false }),
  RELOAD("reload-ak-drop", "ak47", 0.22, "RELOAD · AK-47 · empty mag leaving the gun",
    "Frame one of the story: hand on the magwell, gun rolled to show it, the spent magazine on its way to the pavement.", "quarter"),
  RELOAD("reload-carbine-belt", "carbine", 0.50, "RELOAD · M4 · reaching the belt",
    "Mid-reload. The off hand should be down at the pouch on the left hip with a fresh magazine, nowhere near the handguard.", "side"),
  RELOAD("reload-ak-seat", "ak47", 0.83, "RELOAD · AK-47 · seating the fresh mag",
    "The slap. Hand back at the magwell, gun still canted, about to run forward to the charging handle.", "quarter"),
  RELOAD("reload-lmg", "lmg", 0.50, "RELOAD · M249 · belt change",
    "A belt gun is not fed from a magwell: cover up, ammo box off, box on, belt laid in. Different choreography, same solver.", "side"),
  RELOAD("reload-revolver", "revolver", 0.55, "RELOAD · .357 magnum · cylinder out",
    "A wheelgun rolls hardest of anything in the game — you have to look into the chambers to load them.", "quarter"),
  RELOAD("reload-shotgun", "shotgun", 0.60, "RELOAD · 12g pump · feeding one shell",
    "Shells go in one at a time through the port under the receiver, so this whole path runs again for every shell.", "quarter"),
];

async function stage(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  const hideHud = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__ghOverlay") continue;
      child.style.visibility = "hidden";
    }
  };
  const tick = (n) => {
    for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      CBZ.stepSim(1 / 60);
      if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
    }
  };
  const groundAt = (x, z, fromY) => {
    if (CBZ.groundAt) { try { const y = CBZ.groundAt(x, z, fromY); if (isFinite(y)) return y; } catch (_) {} }
    if (CBZ.floorAt) { try { const y = CBZ.floorAt(x, z); if (isFinite(y)) return y; } catch (_) {} }
    return 0;
  };

  // ---- boot once per side -------------------------------------------------
  let S = window.__ghSeq;
  if (!S) {
    const booted = await until(
      () => CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") &&
        CBZ.stepSim && document.getElementById("playBtn"), 300000);
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    /* THE A/B. Both sides are THIS checkout, staged by THIS code, and the only
       difference is the four one-line revert flags the change ships with. That
       is a stricter comparison than photographing the deployed build, which
       cannot be staged the same way — under this preset's staging it never
       arms the player, so every BEFORE frame came back "held NONE" and the
       report measured the staging rather than the work. Flags off = the pose
       and reload behaviour that shipped. */
    if (CBZ.CONFIG && input.side === "before") {
      CBZ.CONFIG.CHAR_SUPPORT_HAND_IK = false;
      CBZ.CONFIG.CHAR_RELOAD_ANIM = false;
      CBZ.CONFIG.CHAR_SHOULDER_LONGGUN = false;
      CBZ.CONFIG.NPC_SUPPORT_HAND_IK = false;
    }
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn");
      if (b) b.click();
      return CBZ.game.state === "playing";
    }, 120000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    /* SETTLE UNTIL THE PLAYER IS ACTUALLY THE PLAYER'S. On a COLD first load
       the arrival sequence still owns the body for several seconds after
       game.state flips to "playing": it moves them, and it will not let them
       arm. The second side of a run is warm and gets there sooner, which is
       why the FIRST side captured — whichever it was — came back "held NONE"
       every time while the second rendered a drawn weapon correctly. That is
       a race, not a difference between the two builds, and a fixed tick count
       cannot see it. Step until the body stops being moved for a whole
       second, with a real budget. */
    {
      let still = 0, lastX = NaN, lastZ = NaN;
      for (let i = 0; i < 900 && still < 60; i++) {
        tick(1);
        const p = CBZ.player;
        if (!p) continue;
        if (Math.abs(p.pos.x - lastX) < 0.002 && Math.abs(p.pos.z - lastZ) < 0.002) still++;
        else still = 0;
        lastX = p.pos.x; lastZ = p.pos.z;
      }
    }

    // NO STUDIO TELEPORT. weapon-holds.mjs needs one because a prone body plus
    // its gun occupies three metres of ground and the slope under it IS the
    // subject. Here the subject is two hands, the player is standing, and
    // moving them was the one staging difference between this preset and
    // tools/gunhands-check.mjs — which arms the player reliably. Round two of
    // this preset captioned every single frame "held NONE" because of it.
    // Shoot the player where the game put them.
    const overlay = document.createElement("div");
    overlay.id = "__ghOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-num></div><div data-diag></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__ghSeq = { overlay };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const sub = input.subject;
  const px = CBZ.player ? CBZ.player.pos.x : 0;
  const pz = CBZ.player ? CBZ.player.pos.z : 0;
  const py = groundAt(px, pz);
  const yaw = 0;                               // +Z is the rig's facing

  // ---- reset the actor onto the mark, standing, in third person ----------
  if (CBZ.cam) { CBZ.cam.yaw = yaw - Math.PI; CBZ.cam.pitch = 0; }
  if (CBZ.player) {
    CBZ.player.driving = false; CBZ.player._swim = false; CBZ.player.dead = false;
    CBZ.player.vy = 0; CBZ.player.grounded = true; CBZ.player.hp = 100;
  }
  if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.rotation.y = yaw;
  // THIRD PERSON IS THE SUBJECT. holsterprops.js hides the hand weapon the
  // instant fps.active is true, so a run that slips into first person
  // photographs an empty hand (round 1 of this preset did exactly that: every
  // frame captioned "held NONE"). Force it out through the module's own
  // programmatic exit AND park the game camera at a normal chase distance, or
  // the follow logic flips straight back on the next tick.
  if (CBZ.fpsSetActive && CBZ.fps && CBZ.fps.active) CBZ.fpsSetActive(false);
  if (CBZ.camera && CBZ.player && CBZ.player.pos) {
    CBZ.camera.position.set(CBZ.player.pos.x, CBZ.player.pos.y + 2.2, CBZ.player.pos.z - 6);
  }
  for (let i = 0; i < 4 && CBZ.player && (CBZ.player.prone || CBZ.player.crouch); i++) {
    if (CBZ.playerCrouchPress) CBZ.playerCrouchPress();
    tick(30);
  }
  if (!CBZ.unlockWeapon) return { ok: false, err: "no CBZ.unlockWeapon" };
  if (CBZ.fpsSetAim) CBZ.fpsSetAim(sub.aim === false ? false : true);
  // ARM UNTIL IT TAKES, don't arm once and hope. Anything that owns the body
  // (an arrival sequence, a vehicle, a holster) can swallow a single attempt,
  // and a preset that assumes it worked photographs an empty hand and captions
  // it as the subject.
  const armOnce = () => {
    if (CBZ.game) { CBZ.game.cityHolstered = false; CBZ.game.cityMeleeWeapon = null; }
    CBZ.unlockWeapon(sub.weapon, { select: true });
    if (CBZ.fpsSelectWeaponId) { try { CBZ.fpsSelectWeaponId(sub.weapon); } catch (_) {} }
    if (CBZ.fpsAddAmmo) { try { CBZ.fpsAddAmmo(400); } catch (_) {} }
  };
  armOnce();
  // Settle, and WAIT FOR THE GUN rather than stepping a fixed count: a
  // gun-to-gun switch runs holsterprops' stow transfer first (~0.9 s) with the
  // incoming prop deliberately hidden, and first person hides it outright.
  // Re-assert every eight passes so a sequence that steals the body loses.
  let armed = null;
  for (let i = 0; i < 60 && !armed; i++) {
    if (i > 0 && i % 8 === 0) armOnce();
    if (CBZ.player) {
      CBZ.player.driving = false; CBZ.player.dead = false;
      CBZ.player.pos.x = px; CBZ.player.pos.z = pz;
    }
    if (CBZ.cam) { CBZ.cam.yaw = yaw - Math.PI; CBZ.cam.pitch = 0; }
    if (CBZ.fpsSetActive && CBZ.fps && CBZ.fps.active) CBZ.fpsSetActive(false);
    tick(8);
    if (i >= 6) armed = drawnProp();
  }
  if (!armed) return { ok: false, err: "never drew " + sub.weapon + " (game state " +
    (CBZ.game && CBZ.game.state) + ", armed " + (CBZ.playerArmed && CBZ.playerArmed()) + ")" };

  const ch = CBZ.playerChar;
  if (!ch || !ch.group || !ch.sockets) return { ok: false, err: "no player rig" };
  ch.group.visible = true;
  ch.group.updateMatrixWorld(true);

  // ---- find the drawn hand weapon, the same way on either build ----------
  // Reads CBZ.playerChar directly rather than closing over the `ch` const
  // below — the settle loop above calls this while that binding is still in
  // its temporal dead zone.
  function drawnProp() {
    const c = CBZ.playerChar;
    if (!c || !c.sockets) return null;
    if (CBZ.tpHandWeapon) { const p = CBZ.tpHandWeapon(); if (p) return p; }
    const socket = c.sockets.thirdPersonWeapon || c.sockets.weapon;
    if (!socket) return null;
    for (const kid of socket.children) {
      if (kid.visible && kid.userData && kid.userData.weaponId &&
          kid.children && kid.children.length) return kid;
    }
    return null;
  }

  // ---- THE MEASUREMENT ---------------------------------------------------
  // Bore axis = prop origin → authored muzzle, both shipped for months, so
  // this reads on the deployed build and locally without either one having to
  // publish anything new.
  const _p = new T.Vector3(), _q = new T.Vector3(), _h = new T.Vector3();
  function boreProbe(prop) {
    if (!prop) return null;
    prop.updateWorldMatrix(true, false);
    const a = prop.localToWorld(_p.set(0, 0, 0)).clone();
    const mz = prop.userData && prop.userData.muzzle;
    if (!mz) return null;
    prop.updateWorldMatrix(true, false);
    const b = prop.localToWorld(_q.copy(mz)).clone();
    ch.sockets.leftHand.updateWorldMatrix(true, false);
    const hand = ch.sockets.leftHand.getWorldPosition(_h).clone();
    const ab = b.clone().sub(a);
    const len2 = ab.lengthSq() || 1e-6;
    const t = Math.max(0, Math.min(1, hand.clone().sub(a).dot(ab) / len2));
    const closest = a.clone().addScaledVector(ab, t);
    return { gap: hand.distanceTo(closest), above: hand.y - closest.y, along: t, hand, closest };
  }
  // Hand path length in BODY space — walking and turning cannot inflate it.
  const _bl = new T.Vector3();
  function handLocal() {
    ch.body.updateWorldMatrix(true, false);
    ch.sockets.leftHand.updateWorldMatrix(true, false);
    ch.sockets.leftHand.getWorldPosition(_bl);
    return ch.body.worldToLocal(_bl).clone();
  }

  let prop = drawnProp();
  const rowOf = () => (CBZ.FPS_WEAPONS && CBZ.fps ? CBZ.FPS_WEAPONS[CBZ.fps.weapon] : null);
  const magIndex = () => (CBZ.fps ? CBZ.fps.weapon : -1);

  // ---- reload subjects: run the game's own reload twice ------------------
  // Pass 1 measures the whole path. Pass 2 stops on the frame being shot.
  let travel = null, reachedP = null, reloadOk = false;
  if (sub.kind === "reload" && CBZ.fpsReload && CBZ.fps) {
    const i = magIndex();
    const total = (rowOf() && rowOf().reload) || 1;
    const runReload = (stopAt, measure) => {
      if (i < 0) return { ok: false, path: 0, p: null };
      CBZ.fps.rounds[i] = 0;
      CBZ.fps.reserves[i] = Math.max(400, CBZ.fps.reserves[i] || 0);
      CBZ.fps.reloading = 0;
      CBZ.fpsReload();
      if (!(CBZ.fps.reloading > 0)) return { ok: false, path: 0, p: null };
      let prev = handLocal(), path = 0, p = 0, guard = 0;
      // shellReload re-arms per shell; cap the run at one full magazine's
      // worth of steps so a six-shell 12g cannot spin here forever
      const cap = Math.ceil((total * 8) * 60) + 120;
      while (guard++ < cap) {
        if (CBZ.player) { CBZ.player.pos.x = px; CBZ.player.pos.z = pz; }
        tick(1);
        if (measure) {
          const now = handLocal();
          path += now.distanceTo(prev);
          prev = now;
        }
        const left = CBZ.fps.reloading;
        if (!(left > 0)) { p = 1; break; }
        p = Math.max(0, Math.min(1, 1 - left / total));
        if (stopAt != null && p >= stopAt) break;
      }
      return { ok: true, path, p };
    };
    const full = runReload(null, true);
    travel = full.path;
    tick(20);
    const shot = runReload(sub.at, false);
    reloadOk = shot.ok;
    reachedP = shot.p;
    prop = drawnProp();
  } else {
    // a hold subject still gets a travel reading so the two columns are
    // directly comparable: this is what "the arm does nothing" looks like
    let prev = handLocal(), path = 0;
    for (let k = 0; k < 60; k++) {
      if (CBZ.player) { CBZ.player.pos.x = px; CBZ.player.pos.z = pz; }
      tick(1);
      const now = handLocal(); path += now.distanceTo(prev); prev = now;
    }
    travel = path;
    prop = drawnProp();
  }

  const probe = boreProbe(prop);
  const audit = CBZ.gunHandAudit ? CBZ.gunHandAudit() : null;
  const reloadState = CBZ.gunReloadPose ? CBZ.gunReloadPose() : null;

  // ---- tripod ------------------------------------------------------------
  const base = new T.Vector3();
  ch.group.getWorldPosition(base);
  const fwd = new T.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const right = new T.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.near = 0.03; camera.far = 4000;
  const floorY = groundAt(base.x, base.z);
  const aim = new T.Vector3(), eye = new T.Vector3();
  // Frame the HANDS: a support grip that cannot be read at conversational
  // distance has not been fixed. The tripod STANDS BACK (weapon-holds.mjs's
  // proven 5 m / 3.6 m marks — close-in tripods end up inside street props)
  // and the crop comes from the lens instead.
  camera.fov = 27;
  aim.copy(base).addScaledVector(fwd, 0.26);
  aim.y = floorY + 1.14;
  if (sub.view === "quarter") {
    eye.copy(base).addScaledVector(right, 2.6).addScaledVector(fwd, 3.7);
    eye.y = floorY + 1.34;
  } else {
    eye.copy(base).addScaledVector(right, 3.8).addScaledVector(fwd, 0.30);
    eye.y = floorY + 1.34;
  }
  camera.position.copy(eye);
  camera.lookAt(aim);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const rig = CBZ.skyDome && CBZ.skyDome.parent;
    if (rig && rig.position) rig.position.set(camera.position.x, 0, camera.position.z);
  }
  hideHud();
  CBZ.renderer.render(CBZ.scene, camera);

  // ---- caption -----------------------------------------------------------
  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  const cm = (v) => (v == null ? "n/a" : (v * 100).toFixed(1) + " cm");
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = sub.label;
  q("name").style.cssText = "position:absolute;top:64px;left:26px;font-size:25px;font-weight:800;letter-spacing:-.02em";
  q("focus").textContent = sub.focus;
  q("focus").style.cssText = "position:absolute;top:99px;left:28px;color:#c0cfda;font-size:13px;font-weight:550;max-width:700px";
  q("num").textContent =
    "off hand → bore " + cm(probe && probe.gap) +
    " · above axis " + cm(probe && probe.above) +
    " · travel " + cm(travel) +
    (sub.kind === "reload" ? " · phase " + (reachedP == null ? "MISSED" : reachedP.toFixed(2)) : "");
  q("num").style.cssText = "position:absolute;right:24px;top:24px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3";
  q("diag").textContent =
    "held " + (prop ? (prop.userData && prop.userData.weaponId) || "?" : "NONE") +
    " · grips " + (prop && prop.userData && prop.userData.grips ? "authored" : "none") +
    " · aimingPose " + (ch.aimingPose ? "Y" : "N") + " carryPose " + (ch.carryPose ? "Y" : "N") +
    " · reload " + (reloadState && reloadState.active
      ? reloadState.style + " p=" + reloadState.p.toFixed(2) + " w=" + reloadState.weight.toFixed(2) : "idle") +
    " · fps.reloading " + (CBZ.fps ? (CBZ.fps.reloading || 0).toFixed(2) : "?") +
    " · along bore " + (probe ? probe.along.toFixed(2) : "?") +
    (audit ? " · audit gap " + cm(audit.gap) : " · audit n/a (build has no gunHandAudit)");
  q("diag").style.cssText = "position:absolute;left:26px;bottom:40px;max-width:1040px;padding:5px 8px;border-radius:5px;background:rgba(8,12,16,.72);font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:#e8c98f";
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:18px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  const metrics = {};
  if (probe) {
    metrics.axisGap = Math.round(probe.gap * 1000) / 10;
    metrics.handAbove = Math.round(probe.above * 1000) / 10;
  }
  if (travel != null) metrics.travel = Math.round(travel * 1000) / 10;

  return {
    ok: true,
    weapon: sub.weapon,
    kind: sub.kind,
    held: prop ? (prop.userData && prop.userData.weaponId) || null : null,
    hasGrips: !!(prop && prop.userData && prop.userData.grips),
    aimingPose: !!ch.aimingPose,
    carryPose: !!ch.carryPose,
    reloadOk,
    reachedP,
    reloadState,
    audit,
    metrics,
    camera: { position: eye.toArray(), target: aim.toArray() },
  };
}

export default {
  id: "gun-hold-reload",
  title: "The Off Hand Holds the Gun — and Reloads It",
  description:
    "The real city boots once per side, the rAF loop is frozen, weapons are acquired through CBZ.unlockWeapon and reloads are pressed through CBZ.fpsReload — then the sim is stepped to the exact frame being photographed. axisGap is centimetres from the player's off hand to the drawn weapon's bore axis (prop origin → its own authored muzzle, geometry both builds have shipped for months): a hand wrapped round a handguard reads ~7-12 cm, a hand posed by a fixed table that never saw this weapon reads whatever it reads. handAbove is the owner's sentence as a signed number — how far the off hand rides ABOVE that axis. travel is centimetres the off hand moves in BODY space over one complete reload, so walking cannot inflate it; a build with no reload animation scores its own breathing.",
  defaultBefore: "local",
  beforeLabel: "BEFORE · FLAGS OFF",
  afterLabel: "AFTER · FLAGS ON",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metricsNote:
    "axisGap / handAbove: centimetres from the off hand to the drawn weapon's bore axis, and how far above it. travel: centimetres of off-hand motion in body space across one reload — higher is better, and it is the only one here that is.",
  metrics: {
    axisGap: { label: "Off hand → bore axis", unit: "cm", better: "lower" },
    handAbove: { label: "Off hand above the axis", unit: "cm", better: "lower" },
    travel: { label: "Off-hand travel per reload", unit: "cm", better: "higher" },
  },
  subjects,
  stage,
};

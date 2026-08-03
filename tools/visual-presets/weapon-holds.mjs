/* Weapon holds vs. the ground, for tools/visual-compare.mjs.

   OWNER BUG (2026-08-03): "fix how character holds guns, especially those like
   light machine gun that have a bipod — when player lies down, right now the
   gun goes UNDERGROUND. It's dumb physics. The gun should respect the ground."

   Stages the REAL game (modelled on outfit-gallery.mjs): boots the city once
   per side with a pinned seed, enters free play, freezes rAF so CBZ.stepSim is
   the only clock, grants a weapon through CBZ.unlockWeapon (the real
   acquisition path), drops the player prone through the REAL stance input
   (CBZ.playerCrouchPress twice inside physics.js's PRONE_WINDOW), and then
   photographs the live rig from a ground-level side tripod — the one angle
   that shows whether a barrel, an ammo box or a bipod foot is buried.

   THE NUMBER, not an opinion: `gunSink` is metres of the drawn hand weapon's
   real lowest vertex BELOW the ground measured under its own footprint (nine
   samples across the world AABB, so a rifle bridging a slope is judged at both
   ends, not under the hand). 0 = the gun rests on or above the surface.
   `bipodSink` is the same measurement taken at the LMG's two authored bipod
   feet (weapons/appearances/lmg.js publishes userData.bipod), which is the
   specific thing the owner can see. Both are "lower is better", both read on
   the deployed page and locally, so the fix is checkable and not arguable.

   Staging facts inherited from nuke-sequence/outfit-gallery (verified):
   - core/loop.js self-schedules via rAF; stubbing rAF after boot freezes the
     loop and CBZ.stepSim(1/60) becomes the only clock.
   - core/sky.js keeps the sky on a rig following the camera; call CBZ.skySync
     (or recentre skyDome.parent) before rendering by hand.
   - the player is healed every tick so a stray patrol cannot end the shoot. */

const subjects = [
  { id: "prone-lmg", label: "Prone · M249 LMG · ground-level side",
    focus: "THE MONEY SHOT. Belt-fed gun with an authored bipod, player flat on the deck. Ammo box, bipod feet and muzzle must all sit ON the surface — nothing submerged, nothing floating.",
    weapon: "lmg", stance: "prone", view: "side" },
  { id: "prone-lmg-rear", label: "Prone · M249 LMG · low three-quarter from the front",
    focus: "Down-range of the shooter at knee height: does the gun read as DEPLOYED — legs planted, receiver level — or as a rifle stabbed into the dirt?",
    weapon: "lmg", stance: "prone", view: "quarter" },
  { id: "prone-sniper", label: "Prone · bolt sniper · ground-level side",
    focus: "The game's longest barrel. If the class of bug is fixed and not one weapon, this long gun clears the ground too.",
    weapon: "sniper", stance: "prone", view: "side" },
  { id: "prone-carbine", label: "Prone · carbine · ground-level side",
    focus: "The default rifle — the most common prone silhouette in play.",
    weapon: "carbine", stance: "prone", view: "side" },
  { id: "stand-lmg", label: "Standing · M249 LMG · side",
    focus: "Heavy carry: the support hand belongs under the front handguard with the weight visibly low, not the one-size-fits-all pistol grip carry.",
    weapon: "lmg", stance: "stand", view: "side" },
  { id: "crouch-lmg", label: "Crouched · M249 LMG · side",
    focus: "Crouch is the other stance that can bury a long barrel: the hand drops ~0.5 m and the gun keeps its length.",
    weapon: "lmg", stance: "crouch", view: "side" },
  { id: "slope-lmg", label: "Prone on a SLOPE · M249 LMG · side",
    focus: "The gun must follow the ground under ITSELF, not the ground under the player's hips. Downhill of the shooter the muzzle may not stab in; uphill it may not float.",
    weapon: "lmg", stance: "prone", view: "side", slope: true },
];

async function stageWeaponHold(input) {
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
  const hideHud = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__holdOverlay") continue;
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

  let S = window.__holdSeq;
  if (!S) {
    const booted = await until(
      () => CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") &&
        CBZ.stepSim && document.getElementById("playBtn"),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 120000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    tick(60);

    // ---- studio spots -----------------------------------------------------
    // A prone body plus its gun occupies ~3 m of ground, so "flat" has to mean
    // flat across THAT, not at one point. The lot centroid — which
    // outfit-gallery can use because a standing rig touches one square metre —
    // put the shipped seed's player 0.6 m BELOW the slab its own muzzle
    // overhung, and a correct rest solve then honestly floated the whole gun
    // onto the higher surface. Measured, not assumed: the flatness of each
    // candidate is the worst deviation over a 3 m ring, and the sweep is a
    // deterministic grid from the same seed, so both sides pick one spot.
    const lots = (CBZ.city && CBZ.city.arena && CBZ.city.arena.lots) || [];
    let cx0 = 0, cz0 = 0, count = 0;
    for (const lot of lots) {
      const x = Number(lot.x != null ? lot.x : lot.cx);
      const z = Number(lot.z != null ? lot.z : lot.cz);
      if (Number.isFinite(x) && Number.isFinite(z)) { cx0 += x; cz0 += z; count++; }
    }
    cx0 = count ? cx0 / count : 0;
    cz0 = count ? cz0 / count : 0;
    const wet = (x, z) => !!(CBZ.cityWaterAt && CBZ.cityWaterAt(x, z));
    const RING = [[3, 0], [-3, 0], [0, 3], [0, -3], [2.1, 2.1], [-2.1, 2.1], [2.1, -2.1], [-2.1, -2.1],
                  [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]];
    // worst |dh| across the ring, and the mean plane gradient
    function terrainAt(x, z) {
      const h = groundAt(x, z);
      if (!isFinite(h)) return null;
      let rough = 0;
      for (const [dx, dz] of RING) {
        const n = groundAt(x + dx, z + dz);
        if (!isFinite(n)) return null;
        rough = Math.max(rough, Math.abs(n - h));
      }
      const gx = (groundAt(x + 3, z) - groundAt(x - 3, z)) / 6;
      const gz = (groundAt(x, z + 3) - groundAt(x, z - 3)) / 6;
      return { h, rough, grade: Math.hypot(gx, gz), gx, gz };
    }
    let fx = cx0, fz = cz0, fRough = Infinity;
    let sx = cx0, sz = cz0, sgrad = 0, sRough = 0;
    for (let ix = -26; ix <= 26; ix++) {
      for (let iz = -26; iz <= 26; iz++) {
        const x = cx0 + ix * 36, z = cz0 + iz * 36;
        if (wet(x, z)) continue;
        const t = terrainAt(x, z);
        if (!t) continue;
        // FLAT: minimise roughness; ties broken by nearness to the centroid
        const near = (Math.abs(ix) + Math.abs(iz)) * 1e-4;
        if (t.rough + near < fRough) { fRough = t.rough + near; fx = x; fz = z; }
        // SLOPE: the steepest SMOOTH hillside — a step is not a slope, so the
        // ring deviation must stay close to what the plane itself predicts.
        if (t.grade > 0.08 && t.grade < 0.34 && t.rough < t.grade * 4.5 &&
            t.grade > sgrad) { sgrad = t.grade; sx = x; sz = z; sRough = t.rough; }
      }
    }
    const gx = fx, gz = fz;

    const overlay = document.createElement("div");
    overlay.id = "__holdOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
      overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-num></div><div data-diag></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__holdSeq = { gx, gz, sx, sz, sgrad, sRough, fRough, overlay };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const sub = input.subject;
  const px = sub.slope ? S.sx : S.gx;
  const pz = sub.slope ? S.sz : S.gz;
  const py = groundAt(px, pz);

  // ---- stance: back to standing first, through the machine's own exits -----
  // HEADING FIRST, and never touched again after the settle ticks: the held
  // gun's world orientation is written by holsterprops.js INSIDE the sim tick
  // off the rig's yaw, so rotating the rig afterwards drags a stale gun pose
  // round with it (round 1 of this preset photographed exactly that lie).
  // Downhill on the slope subject; +Z on the flat.
  let yaw = 0;
  if (sub.slope) {
    const hx = groundAt(px + 8, pz) - groundAt(px - 8, pz);
    const hz = groundAt(px, pz + 8) - groundAt(px, pz - 8);
    yaw = Math.atan2(-hx, -hz);   // rig +Z is its facing
  }
  // fpsmode drives the armed body's yaw from the camera: it targets
  // atan2(-sin(cam.yaw), -cos(cam.yaw)) === cam.yaw + PI.
  if (CBZ.cam) { CBZ.cam.yaw = yaw - Math.PI; CBZ.cam.pitch = 0; }
  if (CBZ.player) {
    CBZ.player.driving = false; CBZ.player._swim = false; CBZ.player.dead = false;
    CBZ.player.pos.set(px, py + 0.08, pz);
    CBZ.player.vy = 0; CBZ.player.grounded = true; CBZ.player.hp = 100;
  }
  if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.rotation.y = yaw;
  // THIRD PERSON IS THE SUBJECT. holsterprops.js hides the hand weapon the
  // moment fps.active is true, so a run that slips into first person
  // photographs an empty hand and a viewmodel in the corner (round 5 did, from
  // subject 2 on). Force it out through the module's own programmatic exit,
  // and park the game camera at a normal chase distance so the follow logic
  // does not flip back on the next tick.
  if (CBZ.fpsSetActive && CBZ.fps && CBZ.fps.active) CBZ.fpsSetActive(false);
  if (CBZ.camera && CBZ.player && CBZ.player.pos) {
    CBZ.camera.position.set(CBZ.player.pos.x, CBZ.player.pos.y + 2.2, CBZ.player.pos.z - 6);
  }
  // Leave whatever stance the previous subject left behind. Each press is
  // separated by more than physics.js's PRONE_WINDOW (0.4 s), so a press is
  // unambiguously "the next stance out": prone -> crouch -> stand.
  for (let i = 0; i < 4 && CBZ.player && (CBZ.player.prone || CBZ.player.crouch); i++) {
    if (CBZ.playerCrouchPress) CBZ.playerCrouchPress();
    tick(30);
  }
  if (CBZ.player) { CBZ.player.pos.set(px, py + 0.08, pz); CBZ.player.vy = 0; }
  tick(20);

  // ---- weapon: the real acquisition path ---------------------------------
  if (CBZ.game) { CBZ.game.cityHolstered = false; CBZ.game.cityMeleeWeapon = null; }
  if (!CBZ.unlockWeapon) return { ok: false, err: "no CBZ.unlockWeapon" };
  CBZ.unlockWeapon(sub.weapon, { select: true });
  if (CBZ.fpsAddAmmo) { try { CBZ.fpsAddAmmo(300); } catch (_) {} }
  tick(10);

  // ---- stance: the real input path ---------------------------------------
  // physics.js: one crouch press -> crouch; a SECOND inside PRONE_WINDOW
  // (0.4 s) -> prone. No sprint memory here, so the slide branch cannot fire.
  if (sub.stance === "crouch" || sub.stance === "prone") {
    if (CBZ.playerCrouchPress) CBZ.playerCrouchPress();
    tick(3);
    if (sub.stance === "prone") { if (CBZ.playerCrouchPress) CBZ.playerCrouchPress(); tick(3); }
  }
  const stanceOk = !!CBZ.player && (sub.stance === "prone" ? !!CBZ.player.prone
    : sub.stance === "crouch" ? (!!CBZ.player.crouch && !CBZ.player.prone)
    : (!CBZ.player.crouch && !CBZ.player.prone));
  // hold the studio spot and the heading while the pose damps in (the prone
  // blend is ~0.5 s and the armed body-yaw ease is another ~0.3 s)
  for (let i = 0; i < 10; i++) {
    if (CBZ.player) { CBZ.player.pos.x = px; CBZ.player.pos.z = pz; }
    if (CBZ.cam) { CBZ.cam.yaw = yaw - Math.PI; CBZ.cam.pitch = 0; }
    if (CBZ.fpsSetActive && CBZ.fps && CBZ.fps.active) CBZ.fpsSetActive(false);
    tick(8);
  }

  const ch = CBZ.playerChar;
  if (!ch || !ch.group) return { ok: false, err: "no player rig" };
  ch.group.visible = true;
  yaw = ch.group.rotation.y;      // whatever the sim actually settled on
  ch.group.updateMatrixWorld(true);

  // ---- THE NUMBER --------------------------------------------------------
  // The drawn hand weapon lives on the rig's thirdPersonWeapon socket
  // (systems/holsterprops.js parents it there). Measure its REAL world AABB
  // and compare its lowest vertex against the ground under its own footprint.
  const socket = ch.sockets && (ch.sockets.thirdPersonWeapon || ch.sockets.weapon);
  let held = null;
  const kidDump = [];
  if (socket) {
    socket.updateMatrixWorld(true);
    for (const c of socket.children) {
      const bbc = new T.Box3().setFromObject(c);
      kidDump.push([
        (c.userData && c.userData.weaponId) || c.type,
        c.visible ? "vis" : "hid",
        "sc" + (c.scale ? c.scale.x.toFixed(2) : "?"),
        "dy" + (isFinite(bbc.min.y) ? (bbc.max.y - bbc.min.y).toFixed(2) : "?"),
      ].join(":"));
      // same rule the rig uses: the DRAWN prop declares a weaponId; fpsmode's
      // legacy carried-gun group on the same socket does not
      if (!held && c.visible && c.userData && c.userData.weaponId &&
          c.children && c.children.length) held = c;
    }
  }
  let gunSink = null, bipodSink = null, gunLen = null, gunLowY = null, groundUnder = null;
  if (held) {
    held.updateMatrixWorld(true);
    const bb = new T.Box3().setFromObject(held);
    if (isFinite(bb.min.y)) {
      gunLen = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
      gunLowY = bb.min.y;
      const xs = [bb.min.x, (bb.min.x + bb.max.x) / 2, bb.max.x];
      const zs = [bb.min.z, (bb.min.z + bb.max.z) / 2, bb.max.z];
      let g = -Infinity;
      for (const x of xs) for (const z of zs) g = Math.max(g, groundAt(x, z, bb.max.y + 0.5));
      groundUnder = g;
      gunSink = Math.max(0, g - bb.min.y);
    }
    const bp = held.userData && held.userData.bipod;
    if (bp && bp.feet && bp.feet.length) {
      let worst = -Infinity;
      for (const f of bp.feet) {
        const w = held.localToWorld(f.clone());
        worst = Math.max(worst, groundAt(w.x, w.z, w.y + 0.5) - w.y);
      }
      bipodSink = Math.max(0, worst);
    }
  }
  // barrel bearing, for the report: the prop convention is barrel along -Z.
  let gunDir = null, gunPitchDeg = null;
  if (held) {
    const d = new T.Vector3(0, 0, -1).applyQuaternion(held.getWorldQuaternion(new T.Quaternion()));
    gunDir = [Math.round(d.x * 100) / 100, Math.round(d.y * 100) / 100, Math.round(d.z * 100) / 100];
    gunPitchDeg = Math.round(Math.asin(Math.max(-1, Math.min(1, d.y))) * 180 / Math.PI);
  }
  const socketKids = socket ? socket.children.length : -1;
  // Diagnostics that say WHY a frame is wrong: where the mount hand actually
  // is relative to the floor, and how deep the gun's own body hangs below its
  // barrel axis (the ammo box / bipod that no direction-only solve can lift).
  // WHICH surface the solve is answering to. floorAt is terrain; groundAt adds
  // walkable platforms, and a platform ABOVE the terrain under the gun's
  // footprint is exactly the kind of thing that can float a weapon.
  let probe = null;
  if (held) {
    const bb2 = new T.Box3().setFromObject(held);
    const cx = (bb2.min.x + bb2.max.x) / 2, cz = (bb2.min.z + bb2.max.z) / 2;
    let plats = 0;
    if (Array.isArray(CBZ.platforms)) {
      for (const p of CBZ.platforms) {
        if (cx >= p.minX && cx <= p.maxX && cz >= p.minZ && cz <= p.maxZ) plats++;
      }
    }
    probe = {
      floor: CBZ.floorAt ? CBZ.floorAt(cx, cz) : 0,
      ground: CBZ.groundAt ? CBZ.groundAt(cx, cz, bb2.max.y + 0.4) : 0,
      plats,
    };
  }
  // entities/character.js's own ground-rest ledger, when the build has it
  let rest = null;
  if (CBZ.charGunRestAudit) {
    try {
      const a = CBZ.charGunRestAudit();
      rest = { restY: Math.round((a.restY || 0) * 1000) / 1000, residual: a.residual,
               sunk: a.sunk, lift: a.lifted, rested: a.rested, last: a.last };
    } catch (_) {}
  }
  let handOverFloor = null, bellyDepth = null;
  if (socket) {
    const hp = socket.getWorldPosition(new T.Vector3());
    handOverFloor = hp.y - groundAt(hp.x, hp.z, hp.y + 1);
    if (held && gunLowY != null) bellyDepth = hp.y - gunLowY;
  }

  // ---- tripod: ground level, side on -------------------------------------
  const base = new T.Vector3();
  ch.group.getWorldPosition(base);
  const fwd = new T.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const right = new T.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.near = 0.03;
  camera.far = 4000;
  camera.fov = 32;
  const floorY = groundAt(base.x, base.z);
  const eye = new T.Vector3();
  const aim = new T.Vector3();
  const prone = sub.stance === "prone";
  // A prone body is ~2 m of rig plus a metre of gun ahead of it, so the side
  // tripod stands back far enough to hold the whole line, at just above the
  // ground — the height that makes "is it in the dirt" unarguable.
  aim.copy(base).addScaledVector(fwd, prone ? 0.55 : 0.10);
  aim.y = floorY + (prone ? 0.34 : 1.00);
  if (sub.view === "quarter") {
    // AHEAD of the shooter, not behind: from the rear the body hides the very
    // thing under test. This is the muzzle's-eye view of the deployed legs.
    eye.copy(base).addScaledVector(right, 2.6).addScaledVector(fwd, 3.6);
    eye.y = floorY + 0.62;
  } else {
    eye.copy(base).addScaledVector(right, prone ? 5.2 : 5.0).addScaledVector(fwd, prone ? 0.9 : 0.2);
    eye.y = floorY + (prone ? 0.55 : 1.15);
  }
  camera.position.copy(eye);
  camera.lookAt(aim);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
    if (skyRig && skyRig.position) skyRig.position.set(camera.position.x, 0, camera.position.z);
  }
  hideHud();
  CBZ.renderer.render(CBZ.scene, camera);

  const before = input.side === "before";
  const query = (name) => S.overlay.querySelector(`[data-${name}]`);
  query("side").textContent = before ? input.beforeLabel : input.afterLabel;
  query("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  query("name").textContent = sub.label;
  query("name").style.cssText = "position:absolute;top:64px;left:26px;font-size:26px;font-weight:800;letter-spacing:-.02em";
  query("focus").textContent = sub.focus;
  query("focus").style.cssText = "position:absolute;top:100px;left:28px;color:#c0cfda;font-size:13px;font-weight:550;max-width:720px";
  const fmt = (v) => (v == null ? "n/a" : (v * 100).toFixed(1) + " cm");
  query("num").textContent =
    "gun sink " + fmt(gunSink) + (bipodSink != null ? " · bipod " + fmt(bipodSink) : "") +
    " · stance " + sub.stance + (stanceOk ? "" : " !!MISSED!!") +
    " · held " + (held ? (held.userData && held.userData.weaponId) || "?" : "NONE") +
    (gunPitchDeg != null ? " · barrel " + gunPitchDeg + "°" : "") +
    (sub.slope ? " · grade " + (S.sgrad * 100).toFixed(0) + "%" : "");
  query("num").style.cssText = "position:absolute;right:24px;top:24px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3";
  query("diag").textContent =
    "hand over floor " + fmt(handOverFloor) + " · gun lowest below hand " + fmt(bellyDepth) +
    " · barrel dir " + (gunDir ? gunDir.join(",") : "n/a") +
    " · len " + (gunLen != null ? gunLen.toFixed(2) + " m" : "n/a") +
    " · bipodActive " + (CBZ.fpsBipodActive && CBZ.fpsBipodActive() ? "Y" : "N") +
    " · terrain " + (probe ? probe.floor.toFixed(2) + "/" + probe.ground.toFixed(2) + " plats " + probe.plats : "?") +
    " · socket[" + kidDump.join(" | ") + "]" +
    (rest ? " · rest " + JSON.stringify(rest) : " · rest n/a (build has no charGunRestAudit)");
  query("diag").style.cssText = "position:absolute;left:26px;bottom:40px;max-width:1040px;padding:5px 8px;border-radius:5px;background:rgba(8,12,16,.72);font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:#e8c98f";
  query("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  query("source").style.cssText = "position:absolute;bottom:18px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  const metrics = {};
  if (gunSink != null) metrics.gunSink = Math.round(gunSink * 1000) / 10;      // cm
  if (bipodSink != null) metrics.bipodSink = Math.round(bipodSink * 1000) / 10;
  return {
    ok: true,
    weapon: sub.weapon,
    stance: sub.stance,
    prone: !!(CBZ.player && CBZ.player.prone),
    crouch: !!(CBZ.player && CBZ.player.crouch),
    stanceOk,
    heldId: held ? (held.userData && held.userData.weaponId) || null : null,
    gunLen, gunLowY, groundUnder, gunDir, gunPitchDeg, socketKids, kidDump,
    handOverFloor, bellyDepth, terrain: probe, rest,
    bipodDeployed: !!(CBZ.fpsBipodActive && CBZ.fpsBipodActive()),
    gameState: CBZ.game && CBZ.game.state,
    metrics,
    camera: { position: eye.toArray(), target: aim.toArray() },
  };
}

export default {
  id: "weapon-holds",
  title: "Guns Respect the Ground: Prone, Crouched and Heavy Carries",
  description: "The real city boots once per side, the rAF loop is frozen, and the live player is handed a weapon through CBZ.unlockWeapon and dropped prone through physics.js's own crouch-press stance machine. Ground-level side tripods photograph the drawn weapon against the surface it is supposed to rest on. gunSink is centimetres of the weapon's real lowest vertex below the ground measured under its own footprint (nine AABB samples, so a long gun bridging a slope is judged at both ends); bipodSink is the same measurement taken at the M249's two authored bipod feet. Zero means the gun is on the ground instead of in it.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metricsNote: "gunSink / bipodSink: centimetres of drawn weapon geometry below the ground under its own footprint. 0 = resting on the surface.",
  metrics: {
    gunSink: { label: "Weapon below ground", unit: "cm", better: "lower" },
    bipodSink: { label: "Bipod feet below ground", unit: "cm", better: "lower" },
  },
  subjects,
  stage: stageWeaponHold,
};

/* ============================================================
   systems/actorweapons.js - visible actor-carried guns + muzzle sockets.

   City combat, police response, gangs, and prison/city stand-offs should not
   invent their own "shot origin" coordinates. This helper attaches the same
   weapon appearance models to actor hands and exposes a world-space barrel tip.

   It also OWNS gun-away intent: a beat cop's pistol on the belt at 0★ is what
   makes the DRAW an escalation cue, and a stowed gun behind cover is what keeps
   muzzles from poking through walls. actor.armed=false (how police.js ships
   holstering today) and the canonical actor._holstered both read "in the
   leather"; actor._gunLowered / actor._gunHidden (police gun-stops, combat.js
   walled-off stows) read "drawn but away". The per-frame pose pass respects
   ALL of them — its self-heal must never force a deliberately-stowed gun back
   into the hand. Stowing is a visibility flip ONLY: the prop never leaves its
   socket and a re-draw never rebuilds geometry (we're draw-call/alloc bound).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  const tmp = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const quat = new THREE.Quaternion();

  const NAME_TO_ID = {
    Pistol: "sidearm",
    pistol: "sidearm",
    Sidearm: "sidearm",
    sidearm: "sidearm",
    Gun: "sidearm",
    gun: "sidearm",
    SMG: "smg",
    smg: "smg",
    Carbine: "carbine",
    carbine: "carbine",
    Rifle: "carbine",
    rifle: "carbine",
    Shotgun: "shotgun",
    shotgun: "shotgun",
    Taser: "taser",
    taser: "taser",
    Revolver: "revolver", revolver: "revolver",
    "Desert Eagle": "deagle", deagle: "deagle",
    Uzi: "uzi", uzi: "uzi",
    "AK-47": "ak47", ak47: "ak47",   // the status rifle gets its OWN model (wood + banana mag) — it must be recognizable in NPC hands
    Sniper: "sniper", sniper: "sniper",
    LMG: "lmg", lmg: "lmg",
  };

  const mat = {
    dark: new THREE.MeshLambertMaterial({ color: 0x161a20 }),
    black: new THREE.MeshLambertMaterial({ color: 0x080a0c }),
    steel: new THREE.MeshLambertMaterial({ color: 0x48515c }),
    worn: new THREE.MeshLambertMaterial({ color: 0x747f8c }),
    tan: new THREE.MeshLambertMaterial({ color: 0x8b6a42 }),
    polymer: new THREE.MeshLambertMaterial({ color: 0x232a24 }),
    brass: new THREE.MeshLambertMaterial({ color: 0xd6a33b }),
    redShell: new THREE.MeshLambertMaterial({ color: 0x9d2523 }),
    skin: new THREE.MeshLambertMaterial({ color: 0x161a20 }),
  };
  Object.keys(mat).forEach((k) => { mat[k]._shared = true; });

  // geometry cache: every armed actor rebuilds the same 8-24 boxes/cylinders
  // per weapon model — cops spawn in bursts, so uncached geometry was pure GC
  // churn (every other geometry factory in the repo caches; this one didn't).
  const GEO = new Map();
  function boxGeo(sx, sy, sz) {
    const k = "b" + sx + "," + sy + "," + sz;
    let g = GEO.get(k);
    if (!g) { g = new THREE.BoxGeometry(sx, sy, sz); g._shared = true; GEO.set(k, g); }
    return g;
  }
  function cylGeo(r, len) {
    const k = "c" + r + "," + len;
    let g = GEO.get(k);
    if (!g) { g = new THREE.CylinderGeometry(r, r, len, 12); g._shared = true; GEO.set(k, g); }
    return g;
  }

  function box(parent, sx, sy, sz, material, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(boxGeo(sx, sy, sz), material);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  function cyl(parent, r, len, material, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(cylGeo(r, len), material);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  function normalizeWeaponId(name) {
    if (!name) return "sidearm";
    const direct = CBZ.weaponById && CBZ.weaponById(name);
    if (direct) return direct.id || direct.key;
    return NAME_TO_ID[name] || NAME_TO_ID[String(name).toLowerCase()] || "sidearm";
  }

  function weaponMeta(id) {
    if (CBZ.weaponById) {
      const meta = CBZ.weaponById(id);
      if (meta) return meta;
    }
    return { id, key: id, slot: id === "sidearm" || id === "taser" ? "pistol" : "long" };
  }

  function fallbackWeapon() {
    const g = new THREE.Group();
    box(g, 0.15, 0.10, 0.54, mat.steel, 0, 0.04, -0.3);
    box(g, 0.12, 0.23, 0.12, mat.dark, 0, -0.15, -0.02, -0.2);
    g.userData.muzzle = new THREE.Vector3(0, 0.06, -0.62);
    return g;
  }

  function buildActorWeapon(name) {
    const id = normalizeWeaponId(name);
    const meta = weaponMeta(id);
    const builder = CBZ.weaponAppearance && CBZ.weaponAppearance[meta.appearanceFactory || meta.key || id];
    const model = builder ? builder({ THREE, box, cyl, mat }) : fallbackWeapon();
    model.userData.weaponId = id;
    model.userData.weaponSlot = meta.slot || "pistol";
    model.scale.setScalar((meta.slot === "pistol" || meta.slot === "utility") ? 0.92 : 0.82);
    model.position.set(0.02, 0.02, 0.03);
    // barrel runs ALONG the forearm (grip in the hand, muzzle past the fingers)
    // so an extended arm points the gun FORWARD, upright. (+π/2, π) verified
    // numerically: arm −1.45 → barrel (0,−0.17,+0.99) forward, up (0,+0.99,…).
    model.rotation.set(Math.PI / 2, Math.PI, 0);
    model.traverse((obj) => {
      if (obj.material) obj.material.depthWrite = true;
    });
    return model;
  }

  function disposeGroup(group) {
    group.traverse((obj) => {
      // cached weapon geometries (_shared) outlive any one prop — disposing
      // them would evict the GL buffers out from under every other armed actor
      if (obj.geometry && obj.geometry.dispose && !obj.geometry._shared) obj.geometry.dispose();
      if (obj.material) {
        const m = obj.material;
        if (Array.isArray(m)) m.forEach((x) => x && !x._shared && x.dispose && x.dispose());
        else if (!m._shared && m.dispose) m.dispose();
      }
    });
  }

  function socketOf(actor) {
    const ch = actor && actor.char;
    return ch && ch.sockets && (ch.sockets.thirdPersonWeapon || ch.sockets.weapon || ch.sockets.rightHand);
  }

  function syncActorWeapon(actor) {
    if (!actor || !actor.char) return null;
    // HOLSTER GATE: armed=false (police.js holsterGun ships exactly this) and
    // the canonical _holstered flag both mean "gun's in the leather" — hide the
    // prop but KEEP it socketed with its id intact, so the next draw is a free
    // visibility flip (a rebuild is for weapon SWAPS only). _gunLowered /
    // _gunHidden are deliberately NOT honored here: an explicit sync call is a
    // firing path saying "gun out NOW" (police fireAt clears its lowering
    // first) — the per-frame pose pass is what enforces those visual stows.
    const shouldShow = !!(actor.armed && !actor.dead && !actor._holstered);
    const id = shouldShow ? normalizeWeaponId(actor.weapon || (actor.swat ? "SMG" : "Pistol")) : null;
    if (!shouldShow) {
      if (actor._weaponProp) actor._weaponProp.visible = false;
      return null;
    }
    const socket = socketOf(actor);
    if (!socket) return null;
    if (!actor._weaponProp || actor._weaponPropId !== id) {
      if (actor._weaponProp && actor._weaponProp.parent) actor._weaponProp.parent.remove(actor._weaponProp);
      if (actor._weaponProp) disposeGroup(actor._weaponProp);
      actor._weaponProp = buildActorWeapon(id);
      actor._weaponPropId = id;
    }
    if (actor._weaponProp.parent !== socket) socket.add(actor._weaponProp);
    actor._weaponProp.visible = true;
    return actor._weaponProp;
  }

  function actorForward(actor, out) {
    const g = actor && actor.group;
    if (g) {
      g.updateMatrixWorld(true);
      out.set(0, 0, 1).applyQuaternion(g.getWorldQuaternion(quat)).normalize();
      return out;
    }
    return out.set(0, 0, 1);
  }

  function actorMuzzle(actor, out) {
    out = out || new THREE.Vector3();
    const prop = syncActorWeapon(actor);
    if (prop && prop.userData && prop.userData.muzzle) {
      if (actor && actor.group) actor.group.updateMatrixWorld(true);
      prop.updateMatrixWorld(true);
      return prop.localToWorld(out.copy(prop.userData.muzzle));
    }
    const socket = socketOf(actor);
    if (socket) {
      if (actor && actor.group) actor.group.updateMatrixWorld(true);
      socket.updateMatrixWorld(true);
      return socket.localToWorld(out.set(0, 0.04, 0.45));
    }
    actorForward(actor, fwd);
    const pos = actor && actor.pos ? actor.pos : { x: 0, y: 0, z: 0 };
    return out.set(pos.x, (pos.y || 0) + 1.42, pos.z).addScaledVector(fwd, 0.46);
  }

  function actorAimAt(actor, target, dt) {
    if (!actor || !target || !actor.group || !target.pos) return;
    const dx = target.pos.x - actor.pos.x;
    const dz = target.pos.z - actor.pos.z;
    if (dx * dx + dz * dz > 0.0001) {
      const turn = dt != null ? 1 - Math.pow(0.0005, dt) : 1;
      const lerp = CBZ.lerpAngle || function (a, b, t) {
        let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
        if (d < -Math.PI) d += Math.PI * 2;
        return a + d * t;
      };
      actor.group.rotation.y = lerp(actor.group.rotation.y, Math.atan2(dx, dz), turn);
    }
    const ch = actor.char;
    if (!ch || !ch.parts) return;
    const slot = actor._weaponProp && actor._weaponProp.userData && actor._weaponProp.userData.weaponSlot;
    setReadyPose(ch, slot === "long" || slot === "rifle" || slot === "auto");
  }

  // hold the gun FORWARD at chest height (not dangling at the hip). The right arm
  // swings up to roughly horizontal so the muzzle reads as "weapon ready".
  // mirror the PLAYER's known-good forward-aim arm pose (fpsmode third-person)
  // so NPC guns point forward at chest height — not at the hip, not up at the sky.
  function setReadyPose(ch, longGun) {
    if (!ch || !ch.parts) return;
    // gun arm raised to ~horizontal-forward, NO y/z twist (twist was throwing the
    // muzzle off). With the prop's +π/2 mount this points the barrel forward.
    if (ch.parts.ra) {
      ch.parts.ra.rotation.set(longGun ? -1.50 : -1.45, 0, 0);
      ch.parts.ra.position.z = 0.14;
    }
    // support hand comes up under a long gun; a pistol stays one-handed (let the
    // left arm swing naturally with the walk).
    if (longGun && ch.parts.la) {
      ch.parts.la.rotation.set(-1.20, 0.20, 0.22);
      ch.parts.la.position.z = 0.20;
    }
  }

  // every frame (AFTER the walk animation), force any actor whose gun is OUT
  // to carry it in the ready pose so it never droops to the hip while standing
  // or walking. "Out" respects intent: holstered/lowered/hidden actors are
  // skipped (and kept stowed) so escalation cues and wall-stows actually read.
  function poseList(list) {
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || a.dead || a._parked || (a.ko > 0) || !a.armed) continue;
      if (a.surrender || (a.surrenderT || 0) > 0 || (a.char && (a.char.surrender || a.char.handsUp))) continue;
      // INTENT FLAGS BEAT THE SELF-HEAL: _holstered (canonical, CBZ.actorHolster),
      // _gunLowered (police gun-stop challenge / combat.js walled-off stow) and
      // _gunHidden (occlusion hide) are deliberate "armed but gun away" states.
      // Force-re-showing here every frame was exactly what defeated them — a
      // challenge never read as a lowered muzzle and stowed guns popped back
      // through walls. Enforce the hide (visibility flip only — prop stays on
      // its socket) and leave the arms free for the owning system / reactions.
      if (a._holstered || a._gunLowered || a._gunHidden) {
        if (a._weaponProp && a._weaponProp.visible) a._weaponProp.visible = false;
        continue;
      }
      // Skip ONLY a genuinely ragdolling body (down / airborne / held). Do NOT use
      // CBZ.body.busy() here: in city it was widened to report ANY body still
      // slightly pitched (rotation.x>0.04) as busy — which would steal the gun-
      // ready pose from a shooter that merely has a tiny lean, leaving its arm
      // (and gun) dangling at the hip and the shots reading as "from the chest".
      const ph = a._phys;
      if (ph && (ph.down > 0 || ph.air || ph.heldBy)) continue;
      // ATTACH + show the gun prop right here if it isn't already (self-heal): if
      // the spawn-time syncActorWeapon ever no-op'd (armed flipped on later, a
      // recycle, etc.) the ped would otherwise fire an INVISIBLE gun from the
      // hand. Building is cheap — syncActorWeapon early-returns when the prop is
      // already attached with the right id, only rebuilding when the weapon changed.
      const prop = syncActorWeapon(a);
      if (!prop) continue;
      setReadyPose(a.char, prop.userData && prop.userData.weaponSlot === "long");
    }
  }
  if (CBZ.onUpdate) CBZ.onUpdate(36, function () {
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    poseList(CBZ.cityPeds); poseList(CBZ.cityCops);
  });

  // ---- CANONICAL HOLSTER INTENT --------------------------------------------
  // WHY: police.js holsters by flipping .armed — honored above forever (back-
  // compat). But .armed doubles as "this actor HAS a gun", so any system that
  // wants "the gun stays his, it's just in the leather" (gang truces, club
  // door checks, cop adoption later) sets intent here instead of mutating
  // .armed and confusing threat-assessment readers. Visibility flip ONLY: the
  // prop never leaves its socket and a re-draw never rebuilds geometry.
  function actorHolster(actor, on) {
    if (!actor) return;
    actor._holstered = on !== false;
    if (actor._holstered) {
      if (actor.weapon) actor._beltGun = actor.weapon;   // what rides the belt (same field police.js uses)
      if (actor._weaponProp) actor._weaponProp.visible = false;
    } else {
      if (!actor.weapon && actor._beltGun) actor.weapon = actor._beltGun;
      if (actor.armed && !actor.dead) syncActorWeapon(actor);
    }
  }

  CBZ.weaponIdFromName = normalizeWeaponId;
  CBZ.buildActorWeapon = buildActorWeapon;
  CBZ.syncActorWeapon = syncActorWeapon;
  CBZ.actorHolster = actorHolster;
  CBZ.actorMuzzle = actorMuzzle;
  CBZ.actorAimAt = actorAimAt;
})();

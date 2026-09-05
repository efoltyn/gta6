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

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.WEAPON_GROUND_PHYSICS == null) CBZ.CONFIG.WEAPON_GROUND_PHYSICS = true;

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
    // MELEE. Without these rows the fall-through below hands a 9 mm pistol to
    // anyone carrying a blade — "Shiv" is the name nine years of prison loot
    // tables use, "Shank" is what the weapon row calls itself, and both have
    // to land on the same model or an inmate frisked for a shiv draws a Glock.
    Shank: "shank", shank: "shank",
    Shiv: "shank", shiv: "shank",
  };

  const mat = {
    dark: new THREE.MeshLambertMaterial({ color: 0x161a20 }),
    black: new THREE.MeshLambertMaterial({ color: 0x080a0c }),
    bore: new THREE.MeshLambertMaterial({ color: 0x010203 }),
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
    const id = direct ? (direct.id || direct.key)
      : (NAME_TO_ID[name] || NAME_TO_ID[String(name).toLowerCase()]);
    /* PRISON_SHANK=0 means "give me the body this game had before the shank",
       and that body INCLUDED the bug the missing row was hiding: with no entry
       for a blade name, the fall-through below answered "sidearm", so asking
       this function what a shiv looks like handed back a 9 mm pistol. The
       revert has to reproduce that too, or the flag's off-side is a world that
       never existed and the A/B is measuring the wrong difference. */
    if (id === "shank" && CBZ.CONFIG && CBZ.CONFIG.PRISON_SHANK === false) return "sidearm";
    return id || "sidearm";
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
    // Does this prop have a BARREL? Every consumer that reasons about aim —
    // muzzle direction, arm elevation, gunpoint reactions — has been able to
    // assume "a weapon is out" means "a gun is out", because until the shank
    // there was no other kind. Stamped once at build so a per-frame reader
    // never has to look the row up again.
    model.userData.weaponMelee = !!meta.melee;
    model.userData.weaponHold = Object.assign({ heavy: 0, support: 0, stance: "" }, meta.hold || {});
    // REAL-DIMENSION SIZING (weapons/weapon-scale.js): the scalar is derived
    // from the researched real gun length so an NPC's rifle is the SAME size
    // as the player's — the old 0.82/0.92 pair drew NPC guns ~35% smaller
    // than the player's identical third-person gun ("guns feel small"). The
    // legacy pair stays as the fallback when the scale module is absent or
    // CBZ.CONFIG.WEAPON_REAL_SCALE=false.
    const heldScale = (CBZ.weaponHeldScale && CBZ.weaponHeldScale(id)) ||
      ((meta.slot === "pistol" || meta.slot === "utility") ? 0.92 : 0.82);
    model.scale.setScalar(heldScale);
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

  /* ============================================================
     THE WEAPON/GROUND LAW

     A gun is geometry with mass, not a marker:
       • a held barrel samples the ground ALONG its whole length, including
         the muzzle point, and lifts only enough to stop intersecting it;
       • a released gun carries world velocity + angular momentum, substeps
         wall/ground contact, bounces, and settles on its measured thin side;
       • the pickup record follows the physical model, so the thing you grab
         is where the gun actually came to rest.

     This lives beside buildActorWeapon because that is the one owner which
     knows every gun's real model. Inventory, death and third-person posing
     consume it; none keeps a second gun-physics approximation.
     ============================================================ */
  const WP_REQUIRED = ["tp-held", "inventory-drops", "fps-death"];
  const wpAdopters = new Set();
  const wpBodies = [];
  const WP_CAP = 64;
  const WP_GRAVITY = 20.5;
  const WP_CLEAR = 0.012;
  const WP_CORPSE_CLEAR = 0.018;
  const WP_CORPSE_PASSES = 12;
  const wpBox = new THREE.Box3();
  const wpCorpseBox = new THREE.Box3();
  const wpLocalBox = new THREE.Box3();
  const wpInvRoot = new THREE.Matrix4();
  const wpRel = new THREE.Matrix4();
  const wpCorner = new THREE.Vector3();
  const wpSize = new THREE.Vector3();
  const wpCenter = new THREE.Vector3();
  const wpHalf = new THREE.Vector3();
  const wpPos = new THREE.Vector3();
  const wpLocalPos = new THREE.Vector3();
  const wpCenterOff = new THREE.Vector3();
  const wpAxisX = new THREE.Vector3();
  const wpAxisY = new THREE.Vector3();
  const wpAxisZ = new THREE.Vector3();
  const wpParentQ = new THREE.Quaternion();
  const wpWorldQ = new THREE.Quaternion();
  const wpDeltaQ = new THREE.Quaternion();
  const wpEuler = new THREE.Euler(0, 0, 0, "YXZ");
  const wpSpinEuler = new THREE.Euler();
  const wpSeenActors = new Set();
  const wpSeenParts = new Set();
  const WP_STATS = { attached: 0, settled: 0, wallHits: 0, groundHits: 0, corpseHits: 0 };

  function wpFinite(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }
  function wpGround(x, z, fromY, override) {
    if (override) {
      const y = override(x, z, fromY);
      return isFinite(y) ? y : 0;
    }
    if (CBZ.groundAt) {
      try {
        const y = CBZ.groundAt(x, z, fromY);
        if (isFinite(y)) return y;
      } catch (e) {}
    }
    if (CBZ.floorAt) {
      try {
        const y = CBZ.floorAt(x, z);
        if (isFinite(y)) return y;
      } catch (e) {}
    }
    return 0;
  }

  // Mutates `dir` in place. Four samples catch a kerb/brow BETWEEN the hand
  // and muzzle; three passes account for the x/z samples moving inward as the
  // barrel pitches up. The final direction stays normalized and keeps azimuth.
  function wpSolveGroundDirection(origin, dir, length, clearance, groundFn) {
    length = Math.max(0.02, wpFinite(length, 0));
    clearance = Math.max(0, wpFinite(clearance, 0.05));
    if (!origin || !dir || length <= 0.02) return dir;
    const dl = Math.hypot(dir.x, dir.y, dir.z);
    if (!(dl > 1e-5)) return dir;
    dir.multiplyScalar(1 / dl);
    for (let pass = 0; pass < 3; pass++) {
      let needY = dir.y;
      for (let i = 1; i <= 4; i++) {
        const t = i * 0.25;
        const x = origin.x + dir.x * length * t;
        const z = origin.z + dir.z * length * t;
        const fromY = origin.y + Math.max(0, dir.y * length * t) + 0.45;
        const floor = wpGround(x, z, fromY, groundFn);
        needY = Math.max(needY, (floor + clearance - origin.y) / (length * t));
      }
      if (dir.y >= needY - 1e-5) break;
      const y = Math.min(0.985, Math.max(-0.985, needY));
      const h = Math.hypot(dir.x, dir.z);
      if (h < 1e-5) dir.set(0, 1, 0);
      else {
        const k = Math.sqrt(Math.max(0, 1 - y * y)) / h;
        dir.set(dir.x * k, y, dir.z * k);
      }
    }
    return dir.normalize();
  }

  function wpClearDirection(origin, dir, length, clearance) {
    if (CBZ.CONFIG.WEAPON_GROUND_PHYSICS === false) return dir;
    return wpSolveGroundDirection(origin, dir, length, clearance, null);
  }

  // Geometry bounds in the weapon ROOT's local frame. This is measured once
  // when the body is born; cached/shared child geometry remains untouched.
  function wpMeasureLocal(mesh) {
    wpLocalBox.makeEmpty();
    mesh.updateWorldMatrix(true, true);
    wpInvRoot.copy(mesh.matrixWorld).invert();
    mesh.traverse(function (o) {
      const geo = o.geometry;
      if (!geo) return;
      if (!geo.boundingBox && geo.computeBoundingBox) geo.computeBoundingBox();
      const b = geo.boundingBox;
      if (!b || b.isEmpty()) return;
      wpRel.multiplyMatrices(wpInvRoot, o.matrixWorld);
      for (let ix = 0; ix < 2; ix++) for (let iy = 0; iy < 2; iy++) for (let iz = 0; iz < 2; iz++) {
        wpCorner.set(ix ? b.max.x : b.min.x, iy ? b.max.y : b.min.y, iz ? b.max.z : b.min.z);
        wpLocalBox.expandByPoint(wpCorner.applyMatrix4(wpRel));
      }
    });
    if (wpLocalBox.isEmpty()) {
      wpCenter.set(0, 0, 0); wpHalf.set(0.28, 0.08, 0.12);
    } else {
      wpLocalBox.getCenter(wpCenter);
      wpLocalBox.getSize(wpSize);
      wpHalf.copy(wpSize).multiplyScalar(0.5);
    }
    const sx = Math.abs(mesh.scale.x || 1), sy = Math.abs(mesh.scale.y || 1), sz = Math.abs(mesh.scale.z || 1);
    return {
      center: new THREE.Vector3(wpCenter.x * sx, wpCenter.y * sy, wpCenter.z * sz),
      half: new THREE.Vector3(wpHalf.x * sx, wpHalf.y * sy, wpHalf.z * sz),
    };
  }

  function wpMeasureSpan(b) {
    wpCenterOff.copy(b.center).applyQuaternion(b.q);
    wpAxisX.set(1, 0, 0).applyQuaternion(b.q);
    wpAxisY.set(0, 1, 0).applyQuaternion(b.q);
    wpAxisZ.set(0, 0, 1).applyQuaternion(b.q);
    const ext = Math.abs(wpAxisX.y) * b.half.x +
      Math.abs(wpAxisY.y) * b.half.y +
      Math.abs(wpAxisZ.y) * b.half.z;
    const cy = b.pos.y + wpCenterOff.y;
    b.bottom = cy - ext;
    b.top = cy + ext;
    return b;
  }

  function wpWrite(b) {
    const m = b.mesh;
    if (!m) return;
    const parent = m.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      wpLocalPos.copy(b.pos);
      parent.worldToLocal(wpLocalPos);
      m.position.copy(wpLocalPos);
      parent.getWorldQuaternion(wpParentQ);
      m.quaternion.copy(wpParentQ.invert()).multiply(b.q);
    } else {
      m.position.copy(b.pos);
      m.quaternion.copy(b.q);
    }
    m.updateMatrixWorld(true);
  }

  function wpSyncRecord(b) {
    const r = b.record;
    if (!r) return;
    r.x = b.pos.x; r.z = b.pos.z; r.y = b.pos.y;
    r.y0 = b.settled ? b.supportY : b.pos.y;
  }

  // A dead actor is not scenery. Prison death drops are born beside the body
  // which owned them, so floor/wall-only physics lets a perfectly solid gun or
  // torch finish inside the torso while the corpse topples. Consume the real
  // articulated rig here: each anatomical mesh contributes its current world
  // AABB, including the group's fall rotation and the limb pose. No guessed
  // corpse capsule and no prison-local second weapon solver.
  const WP_CORPSE_SLOT_KEYS = [
    "torso", "collar", "pelvis", "legs", "legsLower", "shoes",
    "arms", "armsLower", "hands", "head",
  ];

  function wpEachCorpsePart(b, visit) {
    wpSeenActors.clear();
    const lists = [CBZ.guards, CBZ.npcs, CBZ.cityPeds, CBZ.cityCops];
    const scanActor = function (actor, group, ch) {
      if (!actor || !actor.dead || !group || !group.parent || group.visible === false || !ch || !ch.skinSlots) return true;
      if (wpSeenActors.has(actor)) return true;
      wpSeenActors.add(actor);
      const dx = b.pos.x - group.position.x, dz = b.pos.z - group.position.z;
      const metric = ch.metric || (group.userData && group.userData.characterMetric) || {};
      const reach = Math.max(2.4, wpFinite(metric.height, 1.82) + Math.max(b.half.x, b.half.z) + 0.55);
      if (dx * dx + dz * dz > reach * reach) return true;
      wpSeenParts.clear();
      for (let k = 0; k < WP_CORPSE_SLOT_KEYS.length; k++) {
        const slot = ch.skinSlots[WP_CORPSE_SLOT_KEYS[k]] || [];
        for (let i = 0; i < slot.length; i++) {
          const part = slot[i];
          if (!part || !part.isMesh || !part.parent || part.visible === false || wpSeenParts.has(part)) continue;
          wpSeenParts.add(part);
          const geo = part.geometry;
          if (!geo) continue;
          if (!geo.boundingBox && geo.computeBoundingBox) geo.computeBoundingBox();
          if (!geo.boundingBox || geo.boundingBox.isEmpty()) continue;
          part.updateWorldMatrix(true, false);
          wpCorpseBox.copy(geo.boundingBox).applyMatrix4(part.matrixWorld);
          // A toppled voxel rig can extend a hidden sliver below the floor. That
          // buried volume must not shove a floor-resting weapon away from air.
          const cx = (wpCorpseBox.min.x + wpCorpseBox.max.x) * 0.5;
          const cz = (wpCorpseBox.min.z + wpCorpseBox.max.z) * 0.5;
          const floor = wpGround(cx, cz, wpCorpseBox.max.y + 0.3);
          wpCorpseBox.min.y = Math.max(wpCorpseBox.min.y, floor - 0.01);
          if (wpCorpseBox.max.y <= wpCorpseBox.min.y + 0.006) continue;
          if (visit(wpCorpseBox, actor, part) === false) return false;
        }
      }
      return true;
    };
    for (let l = 0; l < lists.length; l++) {
      const list = lists[l] || [];
      for (let i = 0; i < list.length; i++) if (scanActor(list[i], list[i] && list[i].group, list[i] && list[i].char) === false) return;
    }
    // Player-death weapon drops use the same law even though the player record
    // stores its render group on CBZ.playerChar rather than `player.group`.
    if (CBZ.player && CBZ.player.dead && CBZ.playerChar) {
      scanActor(CBZ.player, CBZ.playerChar.group, CBZ.playerChar);
    }
  }

  function wpCorpseOverlapCount(b) {
    if (!b || !b.mesh || !b.mesh.parent || !b.corpseCollision) return 0;
    wpWrite(b);
    wpBox.setFromObject(b.mesh);
    let overlaps = 0;
    wpEachCorpsePart(b, function (c) {
      const ox = Math.min(wpBox.max.x, c.max.x) - Math.max(wpBox.min.x, c.min.x);
      const oy = Math.min(wpBox.max.y, c.max.y) - Math.max(wpBox.min.y, c.min.y);
      const oz = Math.min(wpBox.max.z, c.max.z) - Math.max(wpBox.min.z, c.min.z);
      if (ox > 0.004 && oy > 0.004 && oz > 0.004) overlaps++;
    });
    return overlaps;
  }

  function wpResolveCorpses(b) {
    const contact = { hit: false, landed: false, impact: 0 };
    if (!b.corpseCollision || !b.mesh || !b.mesh.parent) return contact;
    for (let pass = 0; pass < WP_CORPSE_PASSES; pass++) {
      wpWrite(b);
      wpBox.setFromObject(b.mesh);
      let moved = false;
      wpEachCorpsePart(b, function (c) {
        const ox = Math.min(wpBox.max.x, c.max.x) - Math.max(wpBox.min.x, c.min.x);
        const oy = Math.min(wpBox.max.y, c.max.y) - Math.max(wpBox.min.y, c.min.y);
        const oz = Math.min(wpBox.max.z, c.max.z) - Math.max(wpBox.min.z, c.min.z);
        if (ox <= 0.001 || oy <= 0.001 || oz <= 0.001) return true;

        const sx0 = c.min.x - wpBox.max.x - WP_CORPSE_CLEAR;
        const sx1 = c.max.x - wpBox.min.x + WP_CORPSE_CLEAR;
        const sx = Math.abs(sx0) <= Math.abs(sx1) ? sx0 : sx1;
        const sz0 = c.min.z - wpBox.max.z - WP_CORPSE_CLEAR;
        const sz1 = c.max.z - wpBox.min.z + WP_CORPSE_CLEAR;
        const sz = Math.abs(sz0) <= Math.abs(sz1) ? sz0 : sz1;
        // Corpse volume below the weapon is support. Never resolve downward
        // through the floor; an overhead hit either sets the object on top or
        // lets the smaller horizontal separation roll it clear.
        const sy = c.max.y - wpBox.min.y + WP_CORPSE_CLEAR;
        const ax = Math.abs(sx), ay = Math.abs(sy), az = Math.abs(sz);
        if (ay <= ax && ay <= az) {
          const impact = Math.max(0, -b.vy);
          b.pos.y += sy;
          if (b.vy < 0) b.vy = 0;
          b.vx *= 0.70; b.vz *= 0.70;
          contact.landed = true;
          contact.impact = Math.max(contact.impact, impact);
        } else if (ax <= az) {
          b.pos.x += sx;
          if ((sx > 0 && b.vx < 0) || (sx < 0 && b.vx > 0)) b.vx *= -0.24;
          else b.vx *= 0.55;
        } else {
          b.pos.z += sz;
          if ((sz > 0 && b.vz < 0) || (sz < 0 && b.vz > 0)) b.vz *= -0.24;
          else b.vz *= 0.55;
        }
        b.wx *= 0.72; b.wy *= 0.72; b.wz *= 0.72;
        wpMeasureSpan(b);
        WP_STATS.corpseHits++;
        contact.hit = moved = true;
        return false; // recompute the weapon box before resolving another part
      });
      if (!moved) break;
    }
    wpWrite(b);
    return contact;
  }

  function wpClatter(b, impact) {
    if (b.sounded || impact < 1.4 || !CBZ.sfx) return;
    if (CBZ.camera) {
      const dx = b.pos.x - CBZ.camera.position.x, dz = b.pos.z - CBZ.camera.position.z;
      if (dx * dx + dz * dz > 70 * 70) return;
    }
    b.sounded = true;
    try { CBZ.sfx(b.sound || "shell"); } catch (e) {}
  }

  function wpRestOnGround(b) {
    // Set the model's REAL lowest vertex on the highest support under its
    // footprint. The corner/centre sweep prevents a long rifle bridging a
    // kerb or slope from leaving one end below the surface.
    wpWrite(b);
    wpBox.setFromObject(b.mesh);
    let support = -Infinity;
    const xs = [wpBox.min.x, (wpBox.min.x + wpBox.max.x) * 0.5, wpBox.max.x];
    const zs = [wpBox.min.z, (wpBox.min.z + wpBox.max.z) * 0.5, wpBox.max.z];
    const fromY = wpBox.max.y + 0.5;
    for (let ix = 0; ix < 3; ix++) for (let iz = 0; iz < 3; iz++) {
      support = Math.max(support, wpGround(xs[ix], zs[iz], fromY));
    }
    if (!isFinite(support)) support = wpGround(b.pos.x, b.pos.z, b.pos.y + 0.5);
    b.pos.y += support + WP_CLEAR - wpBox.min.y;
    b.supportY = support;
    wpMeasureSpan(b);
    wpWrite(b);
    return support;
  }

  function wpSettle(b) {
    // A firearm rests on a SIDE, never balanced upright on its grip. Keep the
    // tumble's yaw so two drops do not form a copied row.
    wpEuler.setFromQuaternion(b.q, "YXZ");
    wpEuler.set(0, wpEuler.y, b.side * (Math.PI / 2 - 0.06), "YXZ");
    b.q.setFromEuler(wpEuler);
    b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0;
    b.settled = true;
    wpRestOnGround(b);
    // Resting against a corpse is still resting: separate from the actual
    // posed body after the ground snap, then keep tracking this body while the
    // corpse finishes its fall so a later frame cannot rotate through it.
    wpResolveCorpses(b);
    wpSyncRecord(b);
    WP_STATS.settled++;
  }

  function wpStepResting(b) {
    wpRestOnGround(b);
    wpResolveCorpses(b);
    wpMeasureSpan(b);
    wpWrite(b);
    wpSyncRecord(b);
  }

  function wpRelease(bodyOrMesh) {
    const body = bodyOrMesh && bodyOrMesh.mesh ? bodyOrMesh
      : bodyOrMesh && bodyOrMesh.userData && bodyOrMesh.userData.weaponBody;
    if (!body) return false;
    body.dead = true;
    if (body.mesh && body.mesh.userData && body.mesh.userData.weaponBody === body) {
      delete body.mesh.userData.weaponBody;
    }
    const i = wpBodies.indexOf(body);
    if (i >= 0) wpBodies.splice(i, 1);
    return true;
  }

  function wpDrop(mesh, opts) {
    opts = opts || {};
    if (!mesh || CBZ.CONFIG.WEAPON_GROUND_PHYSICS === false) return null;
    if (mesh.userData && mesh.userData.weaponBody) wpRelease(mesh);
    while (wpBodies.length >= WP_CAP) {
      const old = wpBodies.shift();
      if (old && old.mesh && old.mesh.parent) wpSettle(old);
    }
    const bounds = wpMeasureLocal(mesh);
    mesh.getWorldPosition(wpPos);
    mesh.getWorldQuaternion(wpWorldQ);
    const body = {
      mesh: mesh, record: opts.record || null, source: opts.source || "unknown",
      pos: wpPos.clone(), q: wpWorldQ.clone(), center: bounds.center, half: bounds.half,
      vx: wpFinite(opts.vx, 0), vy: wpFinite(opts.vy, 0), vz: wpFinite(opts.vz, 0),
      wx: wpFinite(opts.wx, (Math.random() - 0.5) * 10),
      wy: wpFinite(opts.wy, (Math.random() - 0.5) * 8),
      wz: wpFinite(opts.wz, (Math.random() - 0.5) * 12),
      wallR: Math.max(0.05, Math.min(0.22, Math.min(bounds.half.x, bounds.half.z) * 0.7)),
      side: opts.side === -1 ? -1 : opts.side === 1 ? 1 : (Math.random() < 0.5 ? -1 : 1),
      sound: opts.sound || "shell", sounded: false, bounces: 0, t: 0,
      bottom: 0, top: 0, supportY: 0, settled: false, dead: false,
      corpseCollision: !!opts.corpseCollision,
    };
    mesh.userData = mesh.userData || {};
    mesh.userData.weaponBody = body;
    wpBodies.push(body);
    wpMeasureSpan(body);
    wpSyncRecord(body);
    WP_STATS.attached++;
    return body;
  }

  function wpStepBody(b, dt) {
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    const steps = Math.max(1, Math.min(8, Math.ceil(speed * dt / 0.24)));
    const sdt = dt / steps;
    for (let n = 0; n < steps && !b.settled; n++) {
      b.t += sdt;
      b.vy -= WP_GRAVITY * sdt;
      b.pos.x += b.vx * sdt; b.pos.y += b.vy * sdt; b.pos.z += b.vz * sdt;
      wpSpinEuler.set(b.wx * sdt, b.wy * sdt, b.wz * sdt, "XYZ");
      wpDeltaQ.setFromEuler(wpSpinEuler);
      b.q.multiply(wpDeltaQ).normalize();
      wpMeasureSpan(b);

      if (CBZ.collide) {
        const ox = b.pos.x, oz = b.pos.z;
        CBZ.collide(b.pos, b.wallR, b.bottom, b.top);
        if (Math.abs(b.pos.x - ox) > 1e-5) { b.vx *= -0.24; WP_STATS.wallHits++; }
        if (Math.abs(b.pos.z - oz) > 1e-5) { b.vz *= -0.24; WP_STATS.wallHits++; }
        if (b.pos.x !== ox || b.pos.z !== oz) { b.wx *= 0.72; b.wy *= 0.72; b.wz *= 0.72; wpMeasureSpan(b); }
      }

      const corpseContact = wpResolveCorpses(b);
      if (corpseContact.landed) {
        const impact = corpseContact.impact;
        wpClatter(b, impact);
        if (impact > 1.45 && b.bounces < 2) {
          b.bounces++;
          b.vy = impact * (b.bounces === 1 ? 0.18 : 0.10);
          b.vx *= 0.48; b.vz *= 0.48;
          b.wx *= 0.45; b.wy *= 0.40; b.wz *= 0.45;
        } else {
          wpSettle(b);
          break;
        }
      }

      const support = wpGround(b.pos.x, b.pos.z, b.top + 0.2);
      if (b.bottom <= support && b.vy <= 0) {
        const impact = -b.vy;
        b.pos.y += support + WP_CLEAR - b.bottom;
        b.supportY = support;
        WP_STATS.groundHits++;
        wpClatter(b, impact);
        if (impact > 1.45 && b.bounces < 2) {
          b.bounces++;
          b.vy = impact * (b.bounces === 1 ? 0.22 : 0.12);
          b.vx *= 0.52; b.vz *= 0.52;
          b.wx *= 0.48; b.wy *= 0.42; b.wz *= 0.48;
        } else wpSettle(b);
      }
      const airDrag = Math.pow(0.985, sdt);
      b.vx *= airDrag; b.vz *= airDrag;
      if (b.t > 4 && !b.settled) wpSettle(b);
    }
    if (!b.settled) { wpWrite(b); wpSyncRecord(b); }
  }

  if (CBZ.onUpdate) CBZ.onUpdate(37.45, function (dt) {
    if (CBZ.CONFIG.WEAPON_GROUND_PHYSICS === false) return;
    dt = Math.min(0.1, Math.max(0, dt || 0));
    for (let i = wpBodies.length - 1; i >= 0; i--) {
      const b = wpBodies[i];
      if (!b || b.dead || !b.mesh || !b.mesh.parent ||
          !b.mesh.userData || b.mesh.userData.weaponBody !== b) {
        wpBodies.splice(i, 1); continue;
      }
      if (b.settled) {
        if (b.corpseCollision) wpStepResting(b);
        else wpBodies.splice(i, 1);
      } else wpStepBody(b, dt);
    }
  });

  CBZ.weaponPhysics = {
    clearDirection: wpClearDirection,
    drop: wpDrop,
    release: wpRelease,
    adopt: function (id) { if (id) wpAdopters.add(String(id)); },
  };
  CBZ.weaponPhysicsAudit = function () {
    const o = new THREE.Vector3(0, 0.55, 0);
    const d = new THREE.Vector3(0.12, -0.82, 0.56).normalize();
    const testGround = function (x, z) { return 0.08 + z * 0.20 + Math.max(0, x - 0.18) * 0.28; };
    wpSolveGroundDirection(o, d, 1.55, 0.05, testGround);
    let solverPenetration = 0;
    for (let i = 1; i <= 8; i++) {
      const t = i / 8;
      const x = o.x + d.x * 1.55 * t, z = o.z + d.z * 1.55 * t;
      const y = o.y + d.y * 1.55 * t;
      if (y < testGround(x, z) + 0.05 - 1e-4) solverPenetration++;
    }
    let underground = 0, active = 0, corpseOverlaps = 0, corpseTracked = 0;
    for (let i = 0; i < wpBodies.length; i++) {
      const b = wpBodies[i];
      if (!b.settled) active++;
      wpMeasureSpan(b);
      if (b.bottom < wpGround(b.pos.x, b.pos.z, b.top + 0.2) - 0.02) underground++;
      if (b.corpseCollision) {
        corpseTracked++;
        corpseOverlaps += wpCorpseOverlapCount(b);
      }
    }
    const missing = WP_REQUIRED.filter(function (id) { return !wpAdopters.has(id); });
    return {
      required: WP_REQUIRED.length, adopted: wpAdopters.size, missing: missing,
      solverPenetration: solverPenetration, active: active, tracked: wpBodies.length,
      underground: underground, cap: WP_CAP,
      attached: WP_STATS.attached, settled: WP_STATS.settled,
      wallHits: WP_STATS.wallHits, groundHits: WP_STATS.groundHits,
      corpseTracked: corpseTracked, corpseOverlaps: corpseOverlaps, corpseHits: WP_STATS.corpseHits,
    };
  };

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
    setReadyPose(ch, actor._weaponProp || syncActorWeapon(actor));
  }

  // hold the gun FORWARD at chest height (not dangling at the hip). The right arm
  // swings up to roughly horizontal so the muzzle reads as "weapon ready".
  // mirror the PLAYER's known-good forward-aim arm pose (fpsmode third-person)
  // so NPC guns point forward at chest height — not at the hip, not up at the sky.
  function setReadyPose(ch, prop) {
    if (!ch || !ch.parts) return;
    const ud = prop && prop.userData ? prop.userData : {};
    const slot = ud.weaponSlot || "pistol";
    const longGun = slot === "long" || slot === "rifle" || slot === "auto";
    const hold = ud.weaponHold || {};
    const heavy = Math.max(0, Math.min(1, hold.heavy || 0));
    const support = Math.max(0, Math.min(0.5, hold.support || 0));
    const shoulder = hold.stance === "shoulder";
    const elbow = function (part, angle) {
      const low = part && part.userData && part.userData.low;
      if (low) low.rotation.x = angle;
    };
    // gun arm raised to ~horizontal-forward, NO y/z twist (twist was throwing the
    // muzzle off). With the prop's +π/2 mount this points the barrel forward.
    if (ch.parts.ra) {
      ch.parts.ra.rotation.set((longGun ? -1.54 : -1.50) + heavy * 0.10, longGun ? 0.12 : 0.18, longGun ? 0.30 : 0.34);
      ch.parts.ra.position.z = 0.14;
      elbow(ch.parts.ra, shoulder ? -0.28 : (longGun ? -0.10 - heavy * 0.12 : -0.16));
    }
    // Every firearm is a two-hand object while presented. Pistols meet at the
    // firing wrist; long guns move the left hand forward by the weapon's own
    // support measurement. A shoulder launcher stays close to the receiver.
    if (ch.parts.la) {
      if (longGun) {
        ch.parts.la.rotation.set(
          (shoulder ? -1.38 : -1.55) - heavy * 0.10,
          shoulder ? -0.18 : -0.34 - heavy * 0.08,
          shoulder ? -0.34 : -0.42 - support * 0.18
        );
        ch.parts.la.position.z = (shoulder ? 0.16 : 0.24) + support * 0.5;
        elbow(ch.parts.la, shoulder ? -0.48 : -0.72 - heavy * 0.26);
      } else {
        ch.parts.la.rotation.set(-1.56, -0.32, -0.68);
        ch.parts.la.position.z = 0.20;
        elbow(ch.parts.la, -0.22 - heavy * 0.12);
      }
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
      // A culled ped's group is out of the scene (city/peds.js removes it);
      // posing arms nobody can see is a walk over ~700 actors for nothing.
      if (a.culled) continue;
      // character.js owns every limb during a vault/mantle. A late gun-ready
      // overwrite would pin one arm forward and erase the hand plant/grab that
      // makes the obstacle contact physically readable.
      if (a._traversal || (a.char && a.char.traversePose)) continue;
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
      setReadyPose(a.char, prop);
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
  CBZ.actorReadyPose = function (actor) {
    const prop = syncActorWeapon(actor);
    if (prop && actor && actor.char) setReadyPose(actor.char, prop);
    return prop;
  };
})();

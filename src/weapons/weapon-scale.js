/* ============================================================
   weapons/weapon-scale.js — every gun's display size, DERIVED, not typed.

   OWNER (2026-08-16): "look at all of the guns in the game. Do some research
   on the sizes of those actual guns. Many feel small scale to human in game —
   make all math sized."

   WHAT WAS WRONG, measured before this pass. The same appearance model was
   shown at FIVE unrelated magic scalars, so the same rifle changed size every
   time it changed hands, and guns' sizes relative to EACH OTHER were fiction:
     · NPC hands (actorweapons)      0.82 long / 0.92 pistol
     · player TP hand (holsterprops) 1.25 long / 1.15 pistol   (53% bigger than
       the identical gun in the cop's hand next to you — the "NPC guns feel
       small" read in one number)
     · stowed back/hip mounts        0.92
     · armory rack (gunroom)         1.25 small / 1.05 long — in WORLD units,
       so a racked M4 was 1.56m long and shrank 45% when picked up
     · gun store wall / floor drops  0.95 / 1.05 / 1.2 — world units again
   And the authored models themselves were inconsistently oversized against
   the real guns they portray: the pistols/uzis ~80-90% over real proportion,
   the rifles only ~15-25% — which is why a revolver drew at over HALF an M4's
   length (real ratio: about a third).

   THE LAW. Each weapon row (weapon-data.js) now carries its researched
   real-world overall length. The rig is real-scaled (an adult is ~1.82m —
   entities/character.js HUMAN_SCALE), so ONE formula sizes every world
   display of a gun:

       worldLen(gun) = real.len × READ(class)
       scale(prop)   = worldLen / authoredLen        (world-parented prop)
       scale(prop)   = worldLen / authoredLen / rig  (rig-socketed prop — the
                       socket chain already applies the rig's 0.70 metre
                       conversion, so divide it back out)

   READ is the single remaining stylization knob, per silhouette class, and it
   is calibrated against the two reads the owner already screenshot-approved:
     · long 1.45 — the player's tuned third-person rifles keep their size
       within a few percent (M4 −7%, sniper ±0%, shotgun +4%, M249 +5%) while
       NPC long guns GROW 30-70% to the same law (a cop's M4 goes 0.86m →
       1.21m — the "feel small" fix);
     · compact 1.75 — small silhouettes need proportionally more boost to
       survive gameplay distance (the same rule gunroom's rack already
       encoded); calibrated so NPC belt pistols hold their size (±4%) while
       relative proportions snap to real (a Python is now a third of an M4,
       not over half of one).
   authoredLen is MEASURED from the live appearance factory (z-span of every
   mesh except the skin-material hand block), never typed, so a re-authored
   model can never drift out of true.

   Consumers guard-call CBZ.weaponWorldScale / CBZ.weaponHeldScale and fall
   back to their legacy scalars if this file is absent or the flag is off.
   One-line revert: CBZ.CONFIG.WEAPON_REAL_SCALE = false.
   Verify live: CBZ.weaponScaleAudit() prints every gun's real vs displayed
   length and the % of body height it now spans.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.WEAPON_REAL_SCALE == null) CBZ.CONFIG.WEAPON_REAL_SCALE = true;

  // The one stylization knob (see header). thrown covers hand grenades —
  // small enough that they take the compact boost so a lobbed one stays
  // visible in flight.
  const READ = { compact: 1.75, long: 1.45, thrown: 1.75 };
  CBZ.WEAPON_READ = READ;

  // M67 frag grenade, the thrown prop's reference: 64mm diameter, 90mm tall
  // (Wikipedia/Nammo). Not a weapon-data row (grenades are a key-thrown
  // consumable, not a weapon slot), so its real dims live here.
  const GRENADE_REAL_H = 0.090;

  // The rig's metre conversion, mirrored from entities/character.js: sockets
  // live under the model node scaled by HUMAN_SCALE (0.70 default), so a
  // rig-socketed prop inherits it. CHAR_SCALE_REAL=false is the legacy
  // unscaled-rig revert path and must track here too.
  function rigScale() {
    if (CBZ.CONFIG && CBZ.CONFIG.CHAR_SCALE_REAL === false) return 1.0;
    return (CBZ.HUMAN_SCALE > 0) ? CBZ.HUMAN_SCALE : 0.70;
  }

  // ---- canonical measurement rig -------------------------------------------
  // Own THREE ctx so measurement never depends on which consumer built first.
  // Same helper signatures every appearance factory expects; the mat table
  // matches actorweapons' key set. mat.skin marks the held-only hand block —
  // it is a POSE prop, not part of the firearm, so the measured length
  // excludes any mesh carrying it (gunroom's display path hides it the same
  // way for the same reason).
  let mat = null;
  function measureMats(THREE) {
    if (mat) return mat;
    mat = {
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
    Object.keys(mat).forEach(function (k) { mat[k]._shared = true; });
    return mat;
  }

  function mBox(parent, sx, sy, sz, material, x, y, z, rx, ry, rz) {
    const THREE = window.THREE;
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    parent.add(m);
    return m;
  }
  function mCyl(parent, r, len, material, x, y, z, rx, ry, rz) {
    const THREE = window.THREE;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), material);
    m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0);
    parent.add(m);
    return m;
  }

  // Authored barrel-axis span of a built model, model-root units. Walks every
  // mesh through its composed matrix (taser nests a scaled group; the numbers
  // must survive that), skips the skin hand block, reads the wanted axis of
  // all 8 bounding-box corners.
  function spanOf(model, axis) {
    model.updateMatrixWorld(true);
    const THREE = window.THREE;
    const corner = new THREE.Vector3();
    let min = Infinity, max = -Infinity;
    model.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      if (mat && o.material === mat.skin) return;
      const geo = o.geometry;
      if (!geo.boundingBox && geo.computeBoundingBox) geo.computeBoundingBox();
      const b = geo.boundingBox;
      if (!b || b.isEmpty()) return;
      for (let ix = 0; ix < 2; ix++) for (let iy = 0; iy < 2; iy++) for (let iz = 0; iz < 2; iz++) {
        corner.set(ix ? b.max.x : b.min.x, iy ? b.max.y : b.min.y, iz ? b.max.z : b.min.z);
        corner.applyMatrix4(o.matrixWorld);
        const v = axis === "y" ? corner.y : corner.z;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    });
    return max > min ? max - min : 0;
  }

  function disposeMeasured(model) {
    model.traverse(function (o) {
      // _shared geometry/materials (shank's module-cached locals, this file's
      // own mat table, lazily-added wood) belong to their owners; everything
      // else here was made for this one measurement.
      if (o.geometry && o.geometry.dispose && !o.geometry._shared) o.geometry.dispose();
      const m = o.material;
      if (m && !Array.isArray(m) && !m._shared && m.dispose) m.dispose();
    });
  }

  // authored gun length per appearance-factory key, measured once.
  const authored = new Map();
  function authoredLen(factoryKey) {
    if (authored.has(factoryKey)) return authored.get(factoryKey);
    let len = 0;
    const THREE = window.THREE;
    const builder = THREE && CBZ.weaponAppearance && CBZ.weaponAppearance[factoryKey];
    if (builder) {
      try {
        const model = builder({ THREE, box: mBox, cyl: mCyl, mat: measureMats(THREE) });
        if (model) {
          len = spanOf(model, "z");
          disposeMeasured(model);
        }
      } catch (e) { len = 0; }
    }
    authored.set(factoryKey, len);
    return len;
  }

  // "Pistol"/"Shiv"/"AK-47"/"sidearm" all resolve to the canonical row.
  // weaponIdFromName (actorweapons) knows the legacy display names; it loads
  // later in the boot order but exists by the time anything asks for a scale.
  function rowOf(idOrName) {
    if (!idOrName) return null;
    let row = CBZ.weaponById ? CBZ.weaponById(idOrName) : null;
    if (!row && CBZ.weaponIdFromName && CBZ.weaponById) {
      row = CBZ.weaponById(CBZ.weaponIdFromName(idOrName));
    }
    return row || null;
  }

  function readFor(row) {
    return (row.slot === "pistol" || row.slot === "utility") ? READ.compact : READ.long;
  }

  // The length this gun should span IN WORLD METRES, wherever it is shown.
  function worldLen(idOrName) {
    const row = rowOf(idOrName);
    if (!row || !row.real || !(row.real.len > 0)) return 0;
    return row.real.len * readFor(row);
  }

  /* scalar for a prop parented to WORLD space (racks, shop walls, floor
     drops). 0 when the answer isn't derivable (unknown id, missing builder,
     flag off) — every caller keeps its legacy number as the fallback. */
  CBZ.weaponWorldScale = function (idOrName) {
    if (CBZ.CONFIG.WEAPON_REAL_SCALE === false) return 0;
    const row = rowOf(idOrName);
    if (!row) return 0;
    const target = worldLen(row.id);
    const a = authoredLen(row.appearanceFactory || row.key || row.id);
    return (target > 0 && a > 0) ? target / a : 0;
  };

  /* scalar for a prop socketed on a character rig (NPC or player hand, back/
     hip mounts) — the socket chain applies the rig's metre conversion, so it
     is divided back out here to land on the same world length. */
  CBZ.weaponHeldScale = function (idOrName) {
    const w = CBZ.weaponWorldScale(idOrName);
    return w > 0 ? w / rigScale() : 0;
  };

  CBZ.weaponRealLen = function (idOrName) {
    const row = rowOf(idOrName);
    return row && row.real && row.real.len > 0 ? row.real.len : 0;
  };

  // Thrown frag prop (appearances/grenade.js applies this at build). The
  // factory itself is measured, so a re-modelled grenade stays true; the
  // guard breaks the build→measure→build recursion by answering 1 while the
  // measurement's own inner build is running.
  let grenadeAuthoredH = 0, measuringGrenade = false;
  CBZ.grenadeRealScale = function () {
    if (CBZ.CONFIG.WEAPON_REAL_SCALE === false) return 0;
    if (measuringGrenade) return 0;
    const THREE = window.THREE;
    if (!grenadeAuthoredH && THREE && CBZ.grenadeMesh) {
      measuringGrenade = true;
      try {
        const m = CBZ.grenadeMesh(THREE);
        if (m) {
          grenadeAuthoredH = spanOf(m, "y");   // authored upright: height is the long axis
          disposeMeasured(m);
        }
      } catch (e) { grenadeAuthoredH = 0; }
      measuringGrenade = false;
    }
    return grenadeAuthoredH > 0 ? (GRENADE_REAL_H * READ.thrown) / grenadeAuthoredH : 0;
  };

  /* ---- the proof ----------------------------------------------------------
     One row per weapon: researched real length, measured authored length,
     the derived world length everywhere it is displayed, and that length as
     a % of the 1.82m adult — the number the owner's complaint was about. */
  CBZ.weaponScaleAudit = function () {
    const rows = [];
    const body = 2.60 * rigScale();   // the adult rig (character.js metric)
    const list = CBZ.FPS_WEAPONS || [];
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      const a = authoredLen(w.appearanceFactory || w.key || w.id);
      const target = worldLen(w.id);
      rows.push({
        id: w.id,
        ref: w.real && w.real.ref || "(no real data)",
        realLen: w.real && w.real.len || 0,
        authoredLen: Math.round(a * 1000) / 1000,
        read: w.real ? readFor(w) : 0,
        worldLen: Math.round(target * 1000) / 1000,
        worldScale: Math.round((CBZ.weaponWorldScale(w.id) || 0) * 1000) / 1000,
        heldScale: Math.round((CBZ.weaponHeldScale(w.id) || 0) * 1000) / 1000,
        pctOfBody: target > 0 ? Math.round((target / body) * 100) : 0,
      });
    }
    const gScale = CBZ.grenadeRealScale ? CBZ.grenadeRealScale() : 0;
    return {
      enabled: CBZ.CONFIG.WEAPON_REAL_SCALE !== false,
      read: READ,
      rigScale: rigScale(),
      bodyM: Math.round(body * 100) / 100,
      grenade: { realH: GRENADE_REAL_H, authoredH: Math.round(grenadeAuthoredH * 1000) / 1000, scale: Math.round(gScale * 1000) / 1000 },
      derived: rows.filter(function (r) { return r.worldScale > 0; }).length,
      rows,
    };
  };
})();

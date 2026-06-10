/* ============================================================
   systems/wounds.js — THE BODY CARRIES THE HITS (universal gore).

   Shoot someone and the damage stays LEGIBLE on the rig:
     • WOUND DECALS: tiny dark entry-wound discs stamped on the exact body
       part at the exact hit point (world hit → part-local, snapped to the
       face the bullet came through, sitting slightly proud). ONE shared
       CircleGeometry + 3 shared unlit materials (fresh dark red → drying
       brown after ~12s; blunt hits leave a bruise-dark patch, no hole).
     • BLOOD SOAK: the hit part's clothing climbs a 3-step soak ladder
       (clean → bloodied → soaked) via CACHED darkened-material swaps —
       the exact corpse-stain discipline gore.js already uses: shared
       `cmat` clothing is SWAPPED to a cached `_shared` soak lambert
       (never mutated, never per-ped cloned); the head's per-actor
       unshared material is tinted in place (reactions.js's emissive
       flash keeps working).
     • SEVERITY READS: headshot = wound at the head + the shirt goes
       straight to soaked (blood runs down); a shotgun blast scatters
       2-3 wounds (per-pellet calls collapse into one ≤3-wound burst);
       melee blunt = bigger bruise patch, no hole, no blood soak.

   Budget discipline (the game is draw-call bound):
     • hard caps: 6 wounds per actor, 140 global — recycled oldest-first;
       a free-mesh pool so churn never reallocates.
     • wounds are CHILDREN of the rig's part meshes → they animate, fall
       and despawn WITH the body for free; a throttled (0.8s) sweep frees
       records once a rig leaves the scene. ZERO per-frame cost while
       nobody is being shot (one early-out).
     • spawn distance-gated at 45u (matches gore.js's LOD band) so far
       NPC-vs-NPC scraps cost nothing.

   Public API:
     CBZ.bodyWound(actor, worldPoint, opts) — opts:
        { head:bool, cal|caliber:0.7..1.6, melee:"blunt"|"blade"|true,
          fromX, fromZ }  (fromX/Z bias a synthetic centre-point toward
          the attacker so the wound lands on the facing surface)
     CBZ.clearWounds() — also chained automatically onto CBZ.clearGore.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  const CAP = 140;          // global live-wound cap (each is 1 tiny draw call)
  const PER_ACTOR = 6;      // a body holds 6 readable hits, then recycles
  const SPAWN_D2 = 45 * 45; // matches gore.js's "only where it can be seen" band
  const DRY_T = 12;         // seconds until a fresh wound dries brown
  const PROUD = 0.013;      // how far the disc sits off the surface (no z-fight)

  // ---- shared geometry + materials (whole system = 1 geom, 3 mats) ---------
  const G_WOUND = new THREE.CircleGeometry(1, 8);
  G_WOUND._shared = true;
  function unlit(color) {
    // unlit = the wound reads as a HOLE (no light catch), and it's the
    // cheapest material in the renderer. _shared → rig-disposal sweeps skip it.
    const m = new THREE.MeshBasicMaterial({ color });
    m._shared = true;
    return m;
  }
  const MAT_FRESH = unlit(0x4e070b);   // fresh entry wound: near-black red
  const MAT_DRY = unlit(0x351409);     // dried: dark brown scab
  const MAT_BRUISE = unlit(0x3a2334);  // blunt trauma: purple-dark, no hole

  // ---- soak ladder materials: cached per (base colour, step), shared -------
  const SOAK_K = [0, 0.45, 0.75];      // blend toward blood per step
  const soakCache = new Map();
  function blendHex(base, k) {
    const tr = 0x3c, tg = 0x06, tb = 0x0b;  // dried-blood target
    const r = ((base >> 16) & 255), g = ((base >> 8) & 255), b = (base & 255);
    return (((r + (tr - r) * k) | 0) << 16) | (((g + (tg - g) * k) | 0) << 8) | ((b + (tb - b) * k) | 0);
  }
  function soakMat(base, lvl) {
    const key = base * 4 + lvl;
    let m = soakCache.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: blendHex(base, SOAK_K[lvl]) });
      m._shared = true;
      soakCache.set(key, m);
    }
    return m;
  }

  const wounds = [];   // FIFO: { m, actor, age, kind, dried }
  const free = [];     // recycled meshes awaiting reuse
  const soaked = [];   // { actor, mesh, base, unshared } — for restore on reset
  const tmpV = new THREE.Vector3();

  function dist2Cam(x, z) {
    const c = CBZ.camera && CBZ.camera.position;
    if (!c) return 0;
    const dx = x - c.x, dz = z - c.z;
    return dx * dx + dz * dz;
  }

  // ---- which body part did the hit land on? --------------------------------
  // Classified in the ACTOR ROOT's local frame (handles facing + ragdoll
  // topple): head sphere flag wins outright, else height + lateral offset
  // split torso / arm / leg, matching the rig layout in entities/character.js.
  function pickPart(actor, px, py, pz, headFlag) {
    const S = actor.char.skinSlots, g = actor.group;
    g.updateWorldMatrix(true, false);
    tmpV.set(px, py, pz);
    g.worldToLocal(tmpV);
    const x = tmpV.x, y = tmpV.y;
    if ((headFlag || y > 1.98) && S.head && S.head[0]) return { mesh: S.head[0], region: "head" };
    if (y > 1.02) {
      if (Math.abs(x) > 0.47 && S.arms && S.arms.length === 2) {
        return x < 0 ? { mesh: S.arms[0], region: "armL" } : { mesh: S.arms[1], region: "armR" };
      }
      return { mesh: S.torso && S.torso[0], region: "torso" };
    }
    if (S.legs && S.legs.length === 2) {
      return x < 0 ? { mesh: S.legs[0], region: "legL" } : { mesh: S.legs[1], region: "legR" };
    }
    return { mesh: S.torso && S.torso[0], region: "torso" };
  }

  function regionMeshes(S, region) {
    switch (region) {
      case "head": return S.head || [];
      case "torso": return (S.torso || []).concat(S.collar || []);
      case "armL": return S.arms && S.arms[0] ? [S.arms[0]] : [];
      case "armR": return S.arms && S.arms[1] ? [S.arms[1]] : [];
      case "legL": return S.legs && S.legs[0] ? [S.legs[0]] : [];
      case "legR": return S.legs && S.legs[1] ? [S.legs[1]] : [];
    }
    return [];
  }

  // ---- BLOOD SOAK: climb the part's clean → bloodied → soaked ladder -------
  // Shared (cmat) clothing → SWAP to a cached _shared soak lambert (the
  // gore.js corpse-stain pattern — zero clones). The head's fresh per-actor
  // material (reactions.js flashes its emissive) is tinted IN PLACE instead.
  function applySoak(actor, region, bump) {
    if (!bump) return;
    const ch = actor.char;
    if (!ch || !ch.skinSlots) return;
    const st = actor._soak || (actor._soak = {});
    const cur = st[region] || 0;
    const lvl = Math.min(2, cur + bump);
    if (lvl === cur) return;
    st[region] = lvl;
    const list = regionMeshes(ch.skinSlots, region);
    for (let i = 0; i < list.length; i++) {
      const mesh = list[i];
      if (!mesh || !mesh.material || !mesh.material.color) continue;
      let base = mesh.userData._woundSoakBase;
      if (base == null) {
        base = mesh.material.color.getHex();
        mesh.userData._woundSoakBase = base;
        if (soaked.length > 420) soaked.shift();  // bound restore bookkeeping
        soaked.push({ actor, mesh, base, unshared: !mesh.material._shared });
      }
      if (mesh.material._shared) mesh.material = soakMat(base, lvl);
      else mesh.material.color.setHex(blendHex(base, SOAK_K[lvl]));
    }
  }

  // ---- mesh pool ------------------------------------------------------------
  function dropWound(i, reuse) {
    const r = wounds.splice(i, 1)[0];
    if (r.m.parent) r.m.parent.remove(r.m);
    if (r.actor) r.actor._woundN = Math.max(0, (r.actor._woundN || 1) - 1);
    if (!reuse && free.length < 36) free.push(r.m);  // reuse = caller takes the mesh
    return r.m;
  }
  function meshFor(actor) {
    // per-actor cap: recycle THIS body's oldest hit first
    if ((actor._woundN || 0) >= PER_ACTOR) {
      for (let i = 0; i < wounds.length; i++) {
        if (wounds[i].actor === actor) return dropWound(i, true);
      }
    }
    if (free.length) return free.pop();
    if (wounds.length >= CAP) return dropWound(0, true);   // global cap: oldest-first
    const m = new THREE.Mesh(G_WOUND, MAT_FRESH);
    m.castShadow = m.receiveShadow = false;
    return m;
  }

  // ---- CBZ.bodyWound(actor, worldPoint, opts) -------------------------------
  CBZ.bodyWound = function (actor, wp, opts) {
    if (!actor || !wp || actor.culled || !CBZ.scene) return;
    const ch = actor.char;
    if (!ch || !ch.skinSlots || !actor.group || actor.group.visible === false) return;
    opts = opts || {};
    let px = wp.x, py = wp.y, pz = wp.z;
    if (px == null || py == null || pz == null) return;
    if (dist2Cam(px, pz) > SPAWN_D2) return;   // only where it can be seen

    // burst window: a shotgun's pellets (or a same-frame double report) land
    // 2-3 SCATTERED wounds, never a pool-flushing spray of 8.
    const now = performance.now();
    if (now - (actor._woundT || -1e9) < 90) {
      if ((actor._woundBurst || 0) >= 3) return;
      actor._woundBurst = (actor._woundBurst || 0) + 1;
    } else {
      actor._woundBurst = 1;
    }
    actor._woundT = now;

    // a synthetic centre-point (NPC hit rolls have no ray) leans toward the
    // shooter so the wound lands on the surface FACING them.
    if (opts.fromX != null && opts.fromZ != null) {
      let nx = opts.fromX - px, nz = opts.fromZ - pz;
      const nl = Math.hypot(nx, nz);
      if (nl > 0.01) {
        px += (nx / nl) * 0.45;
        pz += (nz / nl) * 0.45;
        // scatter a touch so a magdump doesn't stack one pixel
        px += (Math.random() - 0.5) * 0.18;
        py += (Math.random() - 0.5) * 0.22;
        pz += (Math.random() - 0.5) * 0.18;
      }
    }

    const melee = opts.melee === true ? "blunt" : opts.melee;
    const kind = melee === "blunt" ? "bruise" : (melee === "blade" ? "blade" : "shot");
    const cal = opts.cal != null ? opts.cal : (opts.caliber != null ? opts.caliber : 1);

    const pick = pickPart(actor, px, py, pz, !!opts.head);
    const part = pick.mesh;
    if (!part || !part.geometry) return;

    const m = meshFor(actor);
    m.material = kind === "bruise" ? MAT_BRUISE : MAT_FRESH;

    // world hit → part-local, snapped to the box face the round came through
    part.updateWorldMatrix(true, false);
    const lp = tmpV.set(px, py, pz);
    part.worldToLocal(lp);
    const prm = part.geometry.parameters || {};
    const hx = (prm.width || 0.6) * 0.5, hy = (prm.height || 0.9) * 0.5, hz = (prm.depth || 0.45) * 0.5;
    const rx = Math.abs(lp.x) / hx, ry = Math.abs(lp.y) / hy, rz = Math.abs(lp.z) / hz;
    let ax = "z";                                 // front/back wins ties
    if (rx > rz + 0.02 && rx > ry) ax = "x";
    else if (ry > rz + 0.02 && ry > rx) ax = "y";
    const cl = (v, h) => Math.max(-h * 0.78, Math.min(h * 0.78, v));
    const spin = Math.random() * 6.28;            // disc spin in its own plane
    if (ax === "x") {
      const s = lp.x >= 0 ? 1 : -1;
      m.position.set(s * (hx + PROUD), cl(lp.y, hy), cl(lp.z, hz));
      m.rotation.set(0, s * Math.PI / 2, spin);
    } else if (ax === "y") {
      const s = lp.y >= 0 ? 1 : -1;
      m.position.set(cl(lp.x, hx), s * (hy + PROUD), cl(lp.z, hz));
      m.rotation.set(s > 0 ? -Math.PI / 2 : Math.PI / 2, 0, spin);
    } else {
      const s = lp.z >= 0 ? 1 : -1;
      m.position.set(cl(lp.x, hx), cl(lp.y, hy), s * (hz + PROUD));
      m.rotation.set(0, s > 0 ? 0 : Math.PI, spin);
    }

    // severity → size: caliber widens the hole; the head wound reads a touch
    // bigger (it's the kill tell); a bruise is a broad flat patch; a blade
    // leaves a thin slash.
    let s0 = 0.045 + 0.032 * cal;
    if (pick.region === "head") s0 *= 1.15;
    if (kind === "bruise") {
      const b = s0 * 2.2;
      m.scale.set(b * (0.85 + Math.random() * 0.3), b * (0.7 + Math.random() * 0.3), 1);
    } else if (kind === "blade") {
      m.scale.set(s0 * 0.55, s0 * 1.9, 1);
    } else {
      m.scale.set(s0 * (0.85 + Math.random() * 0.3), s0 * (0.85 + Math.random() * 0.3), 1);
    }

    part.add(m);   // rides the part: animates, ragdolls and despawns with the rig
    wounds.push({ m, actor, age: 0, kind, dried: false });
    actor._woundN = (actor._woundN || 0) + 1;

    // ---- BLOOD SOAK (a bruise doesn't bleed) ----
    if (kind !== "bruise") {
      if (pick.region === "head") {
        applySoak(actor, "head", 1);
        applySoak(actor, "torso", 2);   // headshot: blood runs straight down the shirt
      } else {
        applySoak(actor, pick.region, kind === "shot" && cal >= 1.25 ? 2 : 1);
      }
    }
  };

  // ---- reset: detach everything, walk every soak swap back to clean --------
  CBZ.clearWounds = function () {
    for (let i = 0; i < wounds.length; i++) {
      const r = wounds[i];
      if (r.m.parent) r.m.parent.remove(r.m);
      if (free.length < 36) free.push(r.m);
      if (r.actor) { r.actor._woundN = 0; r.actor._soak = null; }
    }
    wounds.length = 0;
    for (let i = 0; i < soaked.length; i++) {
      const s = soaked[i], mesh = s.mesh;
      if (!mesh) continue;
      if (s.unshared) { if (mesh.material && mesh.material.color) mesh.material.color.setHex(s.base); }
      else mesh.material = soakMat(s.base, 0);
      if (mesh.userData) mesh.userData._woundSoakBase = null;
      if (s.actor) s.actor._soak = null;
    }
    soaked.length = 0;
  };

  // chain onto CBZ.clearGore (match reset / scene swap) — checked lazily every
  // frame (cheap flag read) so script order vs gore.js never matters.
  function wrapClearGore() {
    const orig = CBZ.clearGore;
    CBZ.clearGore = function () { CBZ.clearWounds(); return orig.apply(this, arguments); };
    CBZ.clearGore._wounds = true;
  }

  // ---- one throttled updater: ZERO cost while nobody is being shot ----------
  let tick = 0;
  CBZ.onAlways(9, function (dt) {
    if (CBZ.clearGore && !CBZ.clearGore._wounds) wrapClearGore();
    if (!wounds.length && !soaked.length) return;   // the whole system sleeps
    tick += dt;
    if (tick < 0.8) return;
    const step = tick;
    tick = 0;
    for (let i = wounds.length - 1; i >= 0; i--) {
      const r = wounds[i], a = r.actor;
      // rig left the scene (corpse cull / crowd replacement) → free the record
      if (!a || a.culled || !a.group || !a.group.parent) { dropWound(i); continue; }
      r.age += step;
      if (r.kind === "shot" && !r.dried && r.age > DRY_T) { r.dried = true; r.m.material = MAT_DRY; }
    }
    for (let i = soaked.length - 1; i >= 0; i--) {
      const a = soaked[i].actor;
      if (!a || a.culled || !a.group || !a.group.parent) soaked.splice(i, 1);
    }
  });
})();

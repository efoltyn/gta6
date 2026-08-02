/* ============================================================
   city/armor.js — HUMAN BODY ARMOR: the prop IS the stat.

   WHY (owner's #1 rule): armor is not a hidden number you "have" — it
   is a VEST you can SEE on a cop, PEEL off a SWAT corpse, and STRAP on
   yourself, where it visibly sits over your chest and a helmet caps
   your head. The armor BAR is just that prop's condition; when the pool
   hits zero the vest has done its job and visibly FALLS OFF ("ARMOR
   GONE"). Best armor (the SWAT plate) is police-issue: LOOT-ONLY — you
   cannot buy your way to the best, you have to take it off a body.

   The live damage pool is CBZ.player._armor (death.js already absorbs
   through it). This module UPGRADES that bare scalar into tiered, visible,
   lootable kits without changing death.js's pool contract:

     • CBZ.ARMOR_KITS        — the kit catalog (points / absorb / look)
     • CBZ.cityEquipArmor    — strap a kit on the PLAYER (mounts the mesh)
     • CBZ.cityArmorDressPed — mount armor on a cop/SWAT (pooled, cheap)
     • CBZ.cityArmorKitOf    — read a ped's kit record
     • CBZ.cityLootArmorFromCorpse — take a body's _armorLoot onto you
     • CBZ.cityArmorBroke    — vest spent → unmount + "ARMOR GONE" note

   The meshes are POOLED (bling.js pattern): ONE shared geometry per part
   + ONE shared material per kit finish, acquired/released, so dressing a
   wave of SWAT is draw-call cheap and survives ped promotion/recast.

   Mesh layout against the rig (entities/character.js):
     • torso box at body-local y 1.42 (0.92×0.95×0.5) → a vest is a
       slightly-inflated shell over it, mounted on ch.body.
     • neck pivot at y 1.88, head 0.6 cube at neck-local y 0.3 → a helmet
       is a shell over the head, mounted on ch.neck.

   Headless-safe: every THREE / rig / API touch is guarded so the harness
   (stub THREE, rigs with empty parts) never throws. A death-reset hook is
   wrapped around CBZ.cityDeathReset so the player's kit/pool/meshes clear
   on respawn (outfits.js wrap pattern).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  // SWAT REDESIGN (city-swat-redesign): the helmet becomes a real tactical lid
  // (brim + rails + clear visor + NVG stub + counterweight) and the SWAT plate
  // becomes a full carrier (shoulder pads, side plates, groin flap). One-line
  // revert: flip the flag and the old plain dome/box mount is back.
  if (CBZ.CONFIG && CBZ.CONFIG.CITY_SWAT_REDESIGN == null) CBZ.CONFIG.CITY_SWAT_REDESIGN = true;
  function redesignOn() { return !CBZ.CONFIG || CBZ.CONFIG.CITY_SWAT_REDESIGN !== false; }

  // ---- KIT CATALOG ----------------------------------------------------------
  // pts    : armor points the piece contributes to the pool (the bar's length).
  // absorb : fraction of an incoming BODY hit the pool eats (chest pieces).
  //          soft=pistol-grade, plate=rifle-grade, swat=best (loot-only).
  // headFrac: with a helmet on, a HEADSHOT only pushes this fraction through to
  //          flesh-equivalent absorb math (lower = better head protection).
  // color  : the vest/helmet tint so each tier reads at a glance.
  const ARMOR_KITS = {
    softVest:     { id: "softVest",     name: "Soft Vest",     slot: "chest", pts: 50,  absorb: 0.55, color: 0x2b2f36 },
    plateCarrier: { id: "plateCarrier", name: "Plate Carrier", slot: "chest", pts: 100, absorb: 0.72, color: 0x3a3d33 },
    swatVest:     { id: "swatVest",     name: "SWAT Plate",    slot: "chest", pts: 150, absorb: 0.82, color: 0x14161a, lootOnly: true },
    helmet:       { id: "helmet",       name: "Ballistic Helmet", slot: "head", pts: 25, headFrac: 0.25, color: 0x1b1d22 },
  };
  CBZ.ARMOR_KITS = ARMOR_KITS;
  function kit(id) { return id && ARMOR_KITS[id] ? ARMOR_KITS[id] : null; }

  // default absorb/headFrac when nothing is equipped (mirrors death.js fallbacks)
  const BASE_ABSORB = 0.7, BASE_HEADFRAC = 0.45;

  // ---- pooled meshes (bling.js pattern) ------------------------------------
  const POOL_MAX = 48;
  const geos = {}, pools = {};
  function geoFor(kind) {
    let gm = geos[kind];
    if (gm) return gm;
    if (!THREE || !CBZ.boxGeom) return null;
    // vest = inflated shell over the 0.92×0.95×0.5 torso; helmet = shell over
    // the 0.6 head cube.
    if (kind === "vest")        gm = CBZ.boxGeom(1.02, 0.86, 0.62);
    else if (kind === "vestHi") gm = CBZ.boxGeom(1.04, 0.30, 0.64);   // plate band across the chest
    else if (kind === "helmet") gm = CBZ.boxGeom(0.70, 0.46, 0.70);   // dome over the upper head
    // tactical-helmet furniture (city-swat-redesign) — all chunky voxel blocks
    else if (kind === "helmBrim")  gm = CBZ.boxGeom(0.74, 0.09, 0.30);   // brim lip over the eyes
    else if (kind === "helmRail")  gm = CBZ.boxGeom(0.07, 0.14, 0.46);   // side accessory rails
    else if (kind === "helmRear")  gm = CBZ.boxGeom(0.30, 0.18, 0.12);   // rear counterweight pack
    else if (kind === "helmMount") gm = CBZ.boxGeom(0.12, 0.10, 0.10);   // NVG mount stub
    else if (kind === "visor")     gm = CBZ.boxGeom(0.56, 0.20, 0.05);   // clear face visor slab
    // plate-carrier furniture (city-swat-redesign)
    else if (kind === "shPad")     gm = CBZ.boxGeom(0.30, 0.12, 0.44);   // shoulder pad blocks
    else if (kind === "sidePlate") gm = CBZ.boxGeom(0.08, 0.44, 0.36);   // cummerbund side plates
    else if (kind === "groin")     gm = CBZ.boxGeom(0.36, 0.28, 0.08);   // groin flap
    else gm = CBZ.boxGeom(1.0, 0.8, 0.6);
    geos[kind] = gm;
    return gm;
  }
  function acquire(kind) {
    const pool = pools[kind] || (pools[kind] = []);
    let mesh = pool.pop();
    if (!mesh) {
      const gm = geoFor(kind);
      if (!gm || !THREE) return null;
      mesh = new THREE.Mesh(gm, null);
      mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.userData.armorKind = kind;
    }
    mesh.visible = true;
    return mesh;
  }
  function releaseMesh(mesh) {
    if (!mesh) return;
    if (mesh.parent) mesh.parent.remove(mesh);
    const pool = pools[mesh.userData.armorKind];
    if (pool && pool.length < POOL_MAX) pool.push(mesh);
  }

  // ---- shared materials per kit finish (cmat caches by color) ---------------
  const _kitMat = {};
  function matFor(kitId, color) {
    let m = _kitMat[kitId];
    if (m) return m;
    if (!CBZ.cmat) return null;
    m = CBZ.cmat(color != null ? color : 0x2b2f36, { emissive: 0x0a0c0f, ei: 0.18 });
    _kitMat[kitId] = m;
    return m;
  }
  // the visor is the one see-through piece: ONE shared translucent slab material
  // (cmat can't do transparency; built once, flagged _shared so nothing disposes it)
  let _visorMat = null;
  function visorMat() {
    if (_visorMat) return _visorMat;
    if (!THREE || !THREE.MeshLambertMaterial) return null;
    _visorMat = new THREE.MeshLambertMaterial({ color: 0xaad4e8, transparent: true, opacity: 0.35 });
    _visorMat._shared = true;
    return _visorMat;
  }

  /* ---- ARMOUR SITS ON TOP OF CLOTHES, AND "ON TOP" IS A MEASUREMENT --------
     OWNER: "outfits with armour on glitch — the outfit and armour glitch
     colors." Exactly the shoulder-yoke fault (entities/character.js), one file
     over: every number above is a TYPED absolute in the adult-male body frame,
     authored against a torso this file cannot see — so a piece lands on a plane
     the GARMENT already owns, and two differently-coloured coplanar faces are
     what "glitch colors" looks like. Measured on the shipped rig:
       • the plate BAND's back face (-0.30) == the jacket shell's back (-0.30);
       • the cummerbund side plate's inner face (0.46) == the chest's side face;
       • the shoulder pad's bottom (1.84) == the upper arm's top face (1.84);
       • and the instant clothes.js's shell moved to 0.62 deep (the head-
         clearance fix in this same wave) the VEST's entire front and back would
         have landed on it — an unoccluded stipple over the whole chest, which
         is the loudest possible version of this bug. That one is why this is
         derived rather than re-typed: a typed clearance is only correct until
         somebody edits the other file.
     So every piece is now clamped against what this rig is ACTUALLY wearing:
     strictly PROUD of the outermost garment surface, or strictly BURIED inside
     it, by at least CHAR_YOKE_CLEAR per face — never ON it. A buried face is as
     safe as a proud one and cannot open a seam, which is why the two pieces
     that were butting the body go inward and only the vest grows. Nothing is
     re-styled: each clamp moves its piece by 0.01-0.02, and only when it would
     otherwise share a plane. Revert with CBZ.CONFIG.CHAR_YOKE_CLEAR = false. */
  function clearance() {
    if (CBZ.CONFIG && CBZ.CONFIG.CHAR_YOKE_CLEAR === false) return 0;
    return (CBZ.CHAR_YOKE_CLEAR != null) ? CBZ.CHAR_YOKE_CLEAR : 0.01;
  }
  function boxDims(mesh) {
    // MEASURE, don't assume: a BoxGeometry keeps .parameters, and a DRESSED
    // mesh keeps its flat original in userData._cbzFlat (clothes.js).
    const g = (mesh && mesh.userData && mesh.userData._cbzFlat && mesh.userData._cbzFlat.g) || (mesh && mesh.geometry);
    const p = g && g.parameters;
    return (p && p.width > 0) ? p : null;
  }
  // The outermost dressed torso surface on THIS rig, in body-local units, plus
  // the two landmarks the furniture butts against. Falls back to the adult-male
  // literals this file used to hard-code, so a stub rig is unchanged.
  function armorFit(ch) {
    const c = clearance();
    let halfW = 0.46, halfD = 0.25, chestHalfW = 0.46, shoulderY = 1.84;
    const s = ch && ch.skinSlots;
    const cb = boxDims(s && s.torso && s.torso[0]);
    if (cb) { halfW = chestHalfW = cb.width / 2; halfD = cb.depth / 2; }
    const jm = ch && ch._jacketMesh;                  // clothes.js's inflated shell
    if (jm && jm.visible) {
      const jb = boxDims(jm);
      if (jb) { halfW = Math.max(halfW, jb.width / 2); halfD = Math.max(halfD, jb.depth / 2); }
    }
    const la = ch && ch.parts && ch.parts.la;         // the shoulder pivot IS the arm's top face
    if (la && la.position && la.position.y > 0) shoulderY = la.position.y;
    // the groin flap bridges the vest and the body BELOW the chest, so the
    // pelvis is one of its neighbours too — and the shipped flap's back face
    // sat exactly on it (0.24 == pelvisD/2).
    const pb = boxDims(s && s.pelvis && s.pelvis[0]);
    const innerHalfD = Math.min(cb ? cb.depth / 2 : 0.25, pb ? pb.depth / 2 : 0.24);
    const vestW = Math.max(1.02, (halfW + c) * 2);
    const vestD = Math.max(0.62, (halfD + c) * 2);
    const VEST_Y = 1.40, VEST_H = 0.86;
    /* THE VEST'S TOP FACE IS A PLANE TOO (probe, 2026-07-29): the width/depth
       clamps above solved the vertical faces and left the horizontal ones
       authored — and on any profile whose chest top lands at 1.830, the vest's
       up-facing lid and the chest's share a plane (measured live on a staffed
       guard: vest.yp == chest.yp @ 1.830). Same law as everything else here:
       bury the face strictly PAST any same-facing garment plane by c. Only
       same-facing pairs are solved — an up-facing lid meeting a down-facing
       underside culls one of the two and cannot stipple. The adult male is
       byte-identical (his chest top is 1.895, 0.065 clear). */
    let vestY = VEST_Y;
    const chestM = s && s.torso && s.torso[0], waistM = s && s.torso && s.torso[1];
    const wbD = boxDims(waistM);
    const ups = [], downs = [];
    if (cb && chestM && chestM.position) { ups.push(chestM.position.y + cb.height / 2); downs.push(chestM.position.y - cb.height / 2); }
    if (wbD && waistM.position) { ups.push(waistM.position.y + wbD.height / 2); downs.push(waistM.position.y - wbD.height / 2); }
    if (jm && jm.visible && cb && chestM && chestM.position) {
      const jb2 = boxDims(jm);
      if (jb2) { ups.push(chestM.position.y + jm.position.y + jb2.height / 2); downs.push(chestM.position.y + jm.position.y - jb2.height / 2); }
    }
    if (c > 0) for (let pass = 0; pass < 3; pass++) {
      const top = vestY + VEST_H / 2, bot = vestY - VEST_H / 2;
      let shift = 0;
      for (let i = 0; i < ups.length; i++) if (Math.abs(top - ups[i]) < c) shift = Math.min(shift, ups[i] - c - top);
      for (let i = 0; i < downs.length; i++) if (Math.abs(bot - downs[i]) < c) shift = Math.min(shift, downs[i] - c - bot);
      if (!shift) break;
      vestY += shift;                                // always downward — converges
    }
    const vestTop = vestY + VEST_H / 2;
    return {
      vest: [vestW, 0.86, vestD],
      vestY: vestY,
      bandY: 1.58 + (vestY - VEST_Y),                // the band rides the vest's shift
      // THE BAND IS DERIVED FROM THE VEST, not from the body. Its authored
      // 0.64-at-z+0.02 was correct RELATIVE to the vest (0.03 proud, 0.01
      // buried) and still landed on the shell, because the shell is a third
      // box sandwiched between them: at only 0.01 of bury there was exactly
      // one plane to hit and it hit it. Matching the vest's depth doubles the
      // bury to 0.02 and puts the back face clear on the proud side of the
      // shell, which holds for any shell this rig can be wearing.
      band: [vestW + 0.02, 0.30, vestD], bandZ: 0.02,
      // SIDE PLATE: inner face just INSIDE the chest (it is invisible in there
      // either way — it used to be invisible AND coplanar).
      sideX: chestHalfW - c + 0.04,
      // SHOULDER PAD: bottom buried under BOTH planes it can meet — the arm's
      // top face and the vest's. Clearing only the arm (the first draft of this
      // line) simply moved the pad onto the vest's top instead; the sweep
      // caught it, which is the whole reason clearances are solved against
      // min/max of the real neighbours rather than against one of them.
      padY: Math.min(shoulderY, vestTop) - c + 0.06,
      // GROIN FLAP: it BRIDGES from proud of the vest down to buried in the
      // body, so both ends are solved and its DEPTH falls out of them — the
      // authored 0.08 slab was too shallow to clear both once the vest grew,
      // and as shipped its back face was exactly on the pelvis's front. At the
      // shipped 0.62 vest this reproduces the authored 0.08 depth at z 0.28.
      groin: [0.36, 0.28, (vestD / 2 + c) - (innerHalfD - c)],
      groinZ: ((vestD / 2 + c) + (innerHalfD - c)) / 2,
    };
  }
  CBZ.cityArmorFit = armorFit;                        // charpanel.js's portrait mirrors it
  function dimGeo(d) { return (CBZ.boxGeom && d) ? CBZ.boxGeom(d[0], d[1], d[2]) : null; }

  /* ---- THE FIT IS ONLY TRUE UNTIL THE NEXT OUTFIT (probe, 2026-07-29) ------
     OWNER: "armor flickers with the outfit." armorFit measures what the rig is
     wearing AT MOUNT TIME — and every cop mounts armor in makeCop, 0-0.8 s
     BEFORE outfits.js's throttled sweep paints the uniform and creates the
     0.62-deep jacket shell. So the vest was fitted against a bare 0.50 torso,
     took its 0.62 floor, and the shell then arrived at exactly 0.62: measured
     live, EVERY armored officer had vest.zp==jacketShell.zp@0.310 and
     .zn==.zn@-0.310 — the vest's entire front and back coplanar with the
     uniform, which is the full-chest stipple the owner calls flicker.
     Ordering, not arithmetic — so the cure is structural: wrap the ONE
     chokepoint every dresser goes through (CBZ.cityRecolorRig — spawn paint,
     the cop sweep, crowd promotion redress, the player's applyPlayer, corpse
     swaps all end there) and re-solve the mounted pieces against what the rig
     is wearing NOW. Pool-cheap: geometry comes from the boxGeom cache and only
     rigs actually carrying armor pay anything. Revert: CITY_ARMOR_REFIT=false. */
  if (CBZ.CONFIG && CBZ.CONFIG.CITY_ARMOR_REFIT == null) CBZ.CONFIG.CITY_ARMOR_REFIT = true;
  const CHEST_KINDS = { vest: 1, vestHi: 1, shPad: 1, sidePlate: 1, groin: 1 };
  function refitRig(ch) {
    if (CBZ.CONFIG && CBZ.CONFIG.CITY_ARMOR_REFIT === false) return false;
    if (!ch || !ch.body || !ch.body.children || !ch.body.children.length) return false;
    let fit = null;
    const kids = ch.body.children;
    for (let i = 0; i < kids.length; i++) {
      const m = kids[i], kind = m && m.userData && m.userData.armorKind;
      if (!kind || !CHEST_KINDS[kind]) continue;
      if (!fit) fit = armorFit(ch);
      if (kind === "vest") { const gm = dimGeo(fit.vest); if (gm) m.geometry = gm; m.position.y = fit.vestY; }
      else if (kind === "vestHi") { const gb = dimGeo(fit.band); if (gb) m.geometry = gb; m.position.set(0, fit.bandY, fit.bandZ); }
      else if (kind === "shPad") m.position.y = fit.padY;
      else if (kind === "sidePlate") m.position.x = (m.position.x < 0 ? -1 : 1) * fit.sideX;
      else if (kind === "groin") { const gg = dimGeo(fit.groin); if (gg) m.geometry = gg; m.position.z = fit.groinZ; }
    }
    return !!fit;
  }
  CBZ.cityArmorRefit = refitRig;
  // lazy idempotent wrap (bling.js pattern — outfits.js may load either side of us)
  function wrapRecolor() {
    const orig = CBZ.cityRecolorRig;
    if (typeof orig !== "function" || orig._armorWrapped) return !!(orig && orig._armorWrapped);
    const w = function (ch) { const r = orig.apply(this, arguments); try { refitRig(ch); } catch (e) {} return r; };
    w._armorWrapped = true; w._armorOrig = orig;
    CBZ.cityRecolorRig = w;
    return true;
  }
  let _wRecolor = wrapRecolor();

  /* ---- RATCHET (CLAUDE.md law #5): CBZ.armorFitAudit() ---------------------
     Counts SAME-FACING coplanar face pairs between every mounted chest-armor
     piece and the garment surfaces it is worn over (chest / waist / pelvis /
     jacket shell), across every live armored body including the player. A
     coplanar same-facing pair IS the z-fight stipple the owner reports as
     flicker, so with the recolor wrap above this is structurally 0 — pinned in
     tools/math-gate.mjs. EPS 0.004 sits under the 0.01 clearance law and far
     above float noise. */
  const AUDIT_EPS = 0.004;
  function facePlanes(dims, x, y, z) {
    return { xp: x + dims.width / 2, xn: x - dims.width / 2,
             yp: y + dims.height / 2, yn: y - dims.height / 2,
             zp: z + dims.depth / 2, zn: z - dims.depth / 2 };
  }
  function garmentPlanes(ch) {
    const out = [];
    const s = ch && ch.skinSlots; if (!s) return out;
    function push(mesh, label, extraY, extraZ) {
      if (!mesh || !mesh.position) return;
      const d = boxDims(mesh); if (!d) return;
      out.push({ label, p: facePlanes(d, mesh.position.x, (extraY || 0) + mesh.position.y, (extraZ || 0) + mesh.position.z) });
    }
    push(s.torso && s.torso[0], "chest");
    push(s.torso && s.torso[1], "waist");
    push(s.pelvis && s.pelvis[0], "pelvis");
    const jm = ch._jacketMesh, chest = s.torso && s.torso[0];
    if (jm && jm.visible && chest && chest.position) push(jm, "shell", chest.position.y, chest.position.z);
    return out;
  }
  function auditRig(ch, res) {
    if (!ch || !ch.body || !ch.body.children) return;
    let garments = null;
    for (const m of ch.body.children) {
      const kind = m && m.userData && m.userData.armorKind;
      if (!kind || !CHEST_KINDS[kind]) continue;
      if (!garments) { garments = garmentPlanes(ch); res.armored++; }
      const d = boxDims(m); if (!d) continue;
      const ap = facePlanes(d, m.position.x, m.position.y, m.position.z);
      for (const gp of garments) for (const f in ap) {
        if (Math.abs(ap[f] - gp.p[f]) < AUDIT_EPS) {
          res.coplanar++;
          if (res.sample.length < 6) res.sample.push(kind + "." + f + "==" + gp.label + "." + f + "@" + ap[f].toFixed(3));
        }
      }
    }
  }
  CBZ.armorFitAudit = function () {
    const res = { armored: 0, coplanar: 0, sample: [] };
    const pools = [CBZ.cityCops, CBZ.cityPeds];
    for (const pool of pools) if (pool) for (const p of pool) { if (p && p.char) auditRig(p.char, res); }
    if (CBZ.playerChar) auditRig(CBZ.playerChar, res);
    return res;
  };

  // build the pooled meshes for ONE chest kit + helmet onto a rig, push into out[].
  function mountKitMeshes(an, kitId, out) {
    const k = kit(kitId);
    if (!k || !an) return;
    const fit = armorFit(an.ch);
    // tiny local mounter: pooled part + material + position onto a parent
    function put(parent, kind, mat2, x, y, z) {
      if (!mat2) return null;
      const p = acquire(kind);
      if (!p) return null;
      p.material = mat2; p.position.set(x, y, z); parent.add(p); out.push(p);
      return p;
    }
    if (k.slot === "chest" && an.body && an.body.add) {
      const mat = matFor(k.id, k.color);
      const vest = acquire("vest");
      if (vest) {
        const gm = dimGeo(fit.vest); if (gm) vest.geometry = gm;   // fitted to what it is worn OVER
        vest.material = mat; vest.position.set(0, fit.vestY != null ? fit.vestY : 1.40, 0); an.body.add(vest); out.push(vest);
      }
      // the harder kits get a raised plate band so a SWAT reads heavier than a beat-cop vest
      if (k.id !== "softVest") {
        const band = acquire("vestHi");
        if (band) {
          const gb = dimGeo(fit.band); if (gb) band.geometry = gb;
          band.material = mat; band.position.set(0, fit.bandY != null ? fit.bandY : 1.58, fit.bandZ); an.body.add(band); out.push(band);
        }
      }
      // SWAT plate → a full CARRIER (city-swat-redesign): shoulder pad blocks,
      // cummerbund side plates, groin flap. Torso box is 0.92×0.95×0.5 at
      // body-local y 1.42, so pads cap the shoulders and the flap hangs at the
      // belt line. Side plates stay slim so swinging arms don't eat them.
      if (k.id === "swatVest" && redesignOn()) {
        put(an.body, "shPad", mat, -0.40, fit.padY, 0);
        put(an.body, "shPad", mat, 0.40, fit.padY, 0);
        put(an.body, "sidePlate", mat, -fit.sideX, 1.32, 0);
        put(an.body, "sidePlate", mat, fit.sideX, 1.32, 0);
        const gf = put(an.body, "groin", mat, 0, 0.88, fit.groinZ);
        if (gf) { const gg = dimGeo(fit.groin); if (gg) gf.geometry = gg; }
      }
    } else if (k.slot === "head" && an.neck && an.neck.add) {
      const mat = matFor(k.id, k.color);
      const helm = acquire("helmet");
      if (helm) { helm.material = mat; helm.position.set(0, 0.40, 0); an.neck.add(helm); out.push(helm); }
      // real tactical lid (city-swat-redesign): brim lip, side rails, a clear
      // visor slab under the brim, NVG mount stub + rear counterweight. Head is
      // the 0.6 cube at neck-local y 0.3; the dome spans y 0.17–0.63.
      if (redesignOn()) {
        put(an.neck, "helmBrim", mat, 0, 0.22, 0.26);
        put(an.neck, "helmRail", mat, -0.37, 0.40, 0.02);
        put(an.neck, "helmRail", mat, 0.37, 0.40, 0.02);
        put(an.neck, "helmRear", mat, 0, 0.42, -0.40);
        put(an.neck, "helmMount", mat, 0, 0.55, 0.32);
        put(an.neck, "visor", visorMat(), 0, 0.30, 0.36);
      }
    }
  }

  // ---- kit math: derive pool/absorb from a {chest,head} kit map -------------
  function kitPts(kitMap) {
    let pts = 0;
    if (!kitMap) return 0;
    const c = kit(kitMap.chest), h = kit(kitMap.head);
    if (c) pts += c.pts | 0;
    if (h) pts += h.pts | 0;
    return pts;
  }
  function kitAbsorb(kitMap) {
    const c = kitMap && kit(kitMap.chest);
    return c && c.absorb != null ? c.absorb : BASE_ABSORB;
  }
  function kitHeadFrac(kitMap) {
    const h = kitMap && kit(kitMap.head);
    return h && h.headFrac != null ? h.headFrac : BASE_HEADFRAC;
  }

  // ============================================================
  //  PLAYER
  // ============================================================
  let _pMeshes = null;   // pooled meshes currently on the player rig

  function playerAnchors() {
    const ch = CBZ.playerChar;
    if (!ch) return null;
    // `ch` rides along so mountKitMeshes can MEASURE the body it is armouring
    // (armorFit) instead of assuming the adult male it was authored against.
    return { ch: ch, body: ch.body, neck: ch.neck };
  }
  function unmountPlayer() {
    if (!_pMeshes) return;
    for (let i = 0; i < _pMeshes.length; i++) releaseMesh(_pMeshes[i]);
    _pMeshes = null;
  }
  // (re)mirror the player's worn kit as meshes — strip then mount from _armorKit.
  function syncPlayerMesh() {
    unmountPlayer();
    const P = CBZ.player; if (!P || !P._armorKit) return;
    const an = playerAnchors();
    if (!an) return;
    const out = [];
    if (P._armorKit.chest) mountKitMeshes(an, P._armorKit.chest, out);
    if (P._armorKit.head)  mountKitMeshes(an, P._armorKit.head, out);
    if (out.length) _pMeshes = out;
  }
  CBZ.cityArmorPlayerResync = syncPlayerMesh;

  // ---- equip a kit on the player: set the slot, recompute pool/fractions,
  //      mount the visible mesh. Pool is RAISED to the equipped total (a fresh
  //      vest is full) but never lowered (a half-spent vest you re-mount keeps
  //      its wear). Returns true on a real equip.
  CBZ.cityEquipArmor = function (kitId) {
    const P = CBZ.player; if (!P) return false;
    const k = kit(kitId); if (!k) return false;
    if (!P._armorKit) P._armorKit = { chest: null, head: null };
    if (k.slot === "chest") P._armorKit.chest = k.id;
    else if (k.slot === "head") P._armorKit.head = k.id;
    const max = kitPts(P._armorKit);
    P._armorMax = max;
    P._armor = Math.max(P._armor || 0, max);               // a fresh kit tops you up
    P._armorAbsorb = kitAbsorb(P._armorKit);
    P._armorHeadFrac = kitHeadFrac(P._armorKit);
    syncPlayerMesh();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  };

  // ---- the vest is spent: unmount the prop (it visibly comes off) + flash a
  //      note. Called by death.js the instant the pool drains to 0. Keeps the
  //      kit fractions cleared so you're back to bare-flesh absorb.
  CBZ.cityArmorBroke = function () {
    const P = CBZ.player; if (!P) return;
    P._armor = 0; P._armorMax = 0;
    P._armorKit = { chest: null, head: null };
    P._armorAbsorb = BASE_ABSORB; P._armorHeadFrac = BASE_HEADFRAC;
    unmountPlayer();
    if (CBZ.city && CBZ.city.note) CBZ.city.note("ARMOR GONE", 1.8);
    else if (CBZ.city && CBZ.city.big) CBZ.city.big("ARMOR GONE");
    if (CBZ.sfx) try { CBZ.sfx("hit"); } catch (e) {}
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  };

  // ---- PED (cop/SWAT) armor: mount visible meshes + set the soak pool/kit ----
  // kitIds is an ordered list e.g. ["swatVest","helmet"]. Sets ped._armor (the
  // pool police.js's cityHurtCop drains), ped._armorKit (ids → the loot drop),
  // and ped._armorMax. Cheap pooled meshes; re-callable after a recast.
  CBZ.cityArmorDressPed = function (ped, kitIds) {
    if (!ped) return false;
    // strip any previous armor meshes first (recast / re-dress)
    if (ped._armorMeshes) { for (let i = 0; i < ped._armorMeshes.length; i++) releaseMesh(ped._armorMeshes[i]); ped._armorMeshes = null; }
    const ids = Array.isArray(kitIds) ? kitIds : (kitIds ? [kitIds] : []);
    const map = { chest: null, head: null };
    let pts = 0;
    for (let i = 0; i < ids.length; i++) {
      const k = kit(ids[i]); if (!k) continue;
      if (k.slot === "chest") map.chest = k.id;
      else if (k.slot === "head") map.head = k.id;
      pts += k.pts | 0;
    }
    ped._armorKit = ids.slice();          // flat id list — police.js copies this to _armorLoot on death
    ped._armorKitMap = map;
    ped._armorMax = pts;
    ped._armor = pts;                      // the soak pool
    // mount meshes (guarded: harness rigs have no body/neck)
    const ch = ped.char;
    const an = ch ? { ch: ch, body: ch.body, neck: ch.neck } : null;
    if (an) {
      const out = [];
      if (map.chest) mountKitMeshes(an, map.chest, out);
      if (map.head)  mountKitMeshes(an, map.head, out);
      if (out.length) ped._armorMeshes = out;
    }
    return true;
  };

  // ---- read a ped's kit record ----
  CBZ.cityArmorKitOf = function (ped) {
    if (!ped) return null;
    return ped._armorKitMap || (ped._armorKit ? { ids: ped._armorKit.slice() } : null);
  };

  // ---- take a corpse's dropped armor onto the player. Reads body._armorLoot
  //      (a flat id list police.js stamps on a downed cop), equips each piece,
  //      clears the loot so it's a one-time take, returns the ids taken. ----
  CBZ.cityLootArmorFromCorpse = function (body) {
    if (!body || !body._armorLoot || !body._armorLoot.length) return null;
    const took = [];
    for (let i = 0; i < body._armorLoot.length; i++) {
      const id = body._armorLoot[i];
      if (kit(id) && CBZ.cityEquipArmor(id)) took.push(id);
    }
    body._armorLoot = null;
    // the corpse's worn vest mesh comes OFF — it's on you now
    if (body._armorMeshes) { for (let i = 0; i < body._armorMeshes.length; i++) releaseMesh(body._armorMeshes[i]); body._armorMeshes = null; }
    if (took.length) {
      const names = took.map(function (id) { const k = kit(id); return k ? k.name : id; });
      if (CBZ.city && CBZ.city.big) CBZ.city.big("Took their armor — " + names.join(" + "));
      else if (CBZ.city && CBZ.city.note) CBZ.city.note("Took their armor", 2);
      if (CBZ.sfx) try { CBZ.sfx("loot"); } catch (e) {}
    }
    return took.length ? took : null;
  };

  // ---- corpse-armor pickup sweep: a downed cop/SWAT carrying _armorLoot offers
  //      its vest to a player who walks over it. Self-contained (the generic
  //      corpse-loot loop in interact.js only scans cityPeds for deadLoot — cop
  //      corpses live in cityCops and carry _armorLoot, not deadLoot). The PROP
  //      transfers on contact: you see the vest leave the body and appear on you.
  const PICK_R2 = 2.6 * 2.6;
  CBZ.onUpdate(38.5, function () {
    if (!g || g.mode !== "city" || g.state !== "playing") return;
    const P = CBZ.player; if (!P || P.dead || !P.pos) return;
    const px = P.pos.x, pz = P.pos.z;
    function trySrc(list) {
      if (!list) return false;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (!c || !c.dead || !c._armorLoot || !c._armorLoot.length || !c.pos) continue;
        const dx = c.pos.x - px, dz = c.pos.z - pz;
        if (dx * dx + dz * dz <= PICK_R2) { CBZ.cityLootArmorFromCorpse(c); return true; }
      }
      return false;
    }
    // one take per frame is plenty (you walked onto one body)
    if (trySrc(CBZ.cityCops)) return;
    trySrc(CBZ.cityPeds);
  });

  // also fold armor into the generic body-loot path: when interact.js loots a
  // body that happens to carry _armorLoot, take the vest too (lazy idempotent
  // wrap — bling.js pattern, load-order-proof).
  let _wLoot = false;
  function wrapLoot() {
    const orig = CBZ.cityLootCorpse;
    if (typeof orig !== "function" || orig._armorWrapped) return !!(orig && orig._armorWrapped);
    const w = function (ped) {
      const ret = orig.apply(this, arguments);
      try { if (ret && ped && ped._armorLoot && ped._armorLoot.length) CBZ.cityLootArmorFromCorpse(ped); } catch (e) {}
      return ret;
    };
    w._armorWrapped = true; w._armorOrig = orig;
    CBZ.cityLootCorpse = w;
    return true;
  }
  CBZ.onUpdate(38.6, function () {
    if (!_wLoot) _wLoot = wrapLoot();
    if (!_wRecolor) _wRecolor = wrapRecolor();   // outfits.js can load after us
    // drop the player's mesh when we leave city mode (mirror bling.js) so the
    // jail jumpsuit / survival rig never wears a city vest.
    if (g && g.mode !== "city" && _pMeshes) unmountPlayer();
  });

  // ---- death-reset hook: clear the player's kit + pool + meshes on respawn.
  //      Wrap (never replace) CBZ.cityDeathReset — outfits.js pattern. Also runs
  //      a guarded immediate clear if death.js hasn't loaded yet (it does).
  function clearPlayerArmor() {
    const P = CBZ.player; if (!P) return;
    P._armor = 0; P._armorMax = 0;
    P._armorKit = { chest: null, head: null };
    P._armorAbsorb = BASE_ABSORB; P._armorHeadFrac = BASE_HEADFRAC;
    unmountPlayer();
  }
  CBZ.cityArmorResetPlayer = clearPlayerArmor;
  (function wrapDeathReset() {
    const orig = CBZ.cityDeathReset;
    if (typeof orig === "function") {
      if (orig._armorWrapped) return;
      const w = function () { const r = orig.apply(this, arguments); try { clearPlayerArmor(); } catch (e) {} return r; };
      w._armorWrapped = true; w._armorOrig = orig;
      CBZ.cityDeathReset = w;
    } else {
      // death.js loads after us in some orders — install a placeholder that the
      // real one can chain through once it lands (re-wrap on first frame).
      let done = false;
      CBZ.onUpdate(38.7, function () {
        if (done) return;
        const o = CBZ.cityDeathReset;
        if (typeof o === "function" && !o._armorWrapped) {
          const w = function () { const r = o.apply(this, arguments); try { clearPlayerArmor(); } catch (e) {} return r; };
          w._armorWrapped = true; w._armorOrig = o;
          CBZ.cityDeathReset = w; done = true;
        }
      });
    }
  })();

  // seed the player fields so death.js's reads are always defined, even before
  // the first equip (death.js has its own fallbacks, but this keeps the bar/HUD
  // honest from frame 0).
  (function seed() {
    const P = CBZ.player;
    if (!P) return;
    if (P._armorKit == null) P._armorKit = { chest: null, head: null };
    if (P._armorMax == null) P._armorMax = 0;
    if (P._armor == null) P._armor = 0;
    if (P._armorAbsorb == null) P._armorAbsorb = BASE_ABSORB;
    if (P._armorHeadFrac == null) P._armorHeadFrac = BASE_HEADFRAC;
  })();
})();

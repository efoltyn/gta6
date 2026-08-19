/* ============================================================
   city/pelts.js — THE PELT IS WORN, AND THE HOOD IS THE ANIMAL'S OWN HEAD.

   OWNER (2026-08-02, with the Eastern-Wind-Studio bear-hood photo): "When I
   kill and skin an animal I should get to wear it like this automatically."
   The photo is the contract: the animal's HEAD worn as a hood above the face
   (muzzle jutting forward over the brow, ears/antlers up), a huge FUR MANTLE
   over both shoulders, and a cord with a clasp across the chest.

   THE RULE THAT MAKES THIS FREE FOR EVERY SPECIES — the hood is a PHOTOGRAPH
   OF THE ASSET, never a drawing (the itemicons law, applied to clothing): we
   rebuild the species' own `build(ctx)` model and harvest its head cluster
   with wildlife.js's PROVEN geometric discovery (legs = taller-than-wide
   ground-touchers, head = far-forward-and-up — the exact test buildGaitRig
   ships on all 45 species). The cloned head meshes share the model's cached
   cmat materials, so a brown bear hood is brown-bear coloured BY CONSTRUCTION
   and a species added tomorrow is wearable with no edit here. NO SPECIES
   TABLE — adding a species must never mean adding a row.

   WORN, NOT CONSUMED — economy.js's own outfit grammar (equip: "worn, still
   owned; you must OWN it to put it on"): wearing the pelt requires the hide
   item in your pocket, the hide stays sellable at a fence, and the moment the
   hide LEAVES the pocket (sold / pawned / dropped) the mantle comes off. One
   dead body → one hide → one worn pelt; no duplication fiction.

   CONSUMERS (all in this change):
     1. wildlife.js skin()      — auto-wears the fresh pelt (the owner's ask)
     2. itemicons.js cityUseItem — pocket "Wear / Take off" toggle on hide rows
     3. worldstate hydrate       — re-wears the saved pelt on reload/respawn

   API:
     CBZ.peltWear(itemName)   CBZ.peltUnwear()    CBZ.peltWorn() -> name|null
     CBZ.peltWearable(name)   -> species record | null
     CBZ.peltWearItem(name)   -> pocket toggle (true = handled)
     CBZ.peltOnSkin(sp, name) -> the skin() hook
     CBZ.peltMountOn(ch, speciesId) -> mount on any rig (future adopters)
     CBZ.peltAudit()          -> the ratchet report

   Flags (declared here, the owning file — CLAUDE.md law):
     PELT_WEAR      master; false strips the meshes and disables wearing
     PELT_WEAR_AUTO false = skin() stops auto-equipping (pocket verb remains)

   Mount geometry (armor.js's measured frame): hood on ch.neck (head is the
   0.6 cube at neck-local y 0.3, dome 0.17–0.63, forward = +Z), mantle on
   ch.body sized by CBZ.cityArmorFit so it sits PROUD of whatever outfit or
   vest the rig actually wears (the armour-sits-proud law, one layer further
   out). First person hides the whole player group, so the hood can never
   block the camera. Headless-safe: every THREE / rig / econ touch is guarded.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  if (CBZ.CONFIG && CBZ.CONFIG.PELT_WEAR == null) CBZ.CONFIG.PELT_WEAR = true;
  if (CBZ.CONFIG && CBZ.CONFIG.PELT_WEAR_AUTO == null) CBZ.CONFIG.PELT_WEAR_AUTO = true;
  function ON() { return !CBZ.CONFIG || CBZ.CONFIG.PELT_WEAR !== false; }
  function AUTO() { return ON() && (!CBZ.CONFIG || CBZ.CONFIG.PELT_WEAR_AUTO !== false); }

  // ---- species / item plumbing ---------------------------------------------
  // A fur that is FOOD (a fish) is dinner, not a garment — same name-derived
  // test wildlife.js uses (copied, not imported: it is 3 lines and private
  // there; the regex is the contract, not the function object).
  function furIsFood(sp) {
    if (!sp || !sp.aquatic || !sp.fur) return false;
    return /^fresh\b|\bfish$|\bfillet\b|\broe\b/i.test(sp.fur);
  }
  function speciesOf(itemName) {
    if (!itemName) return null;
    const S = CBZ.WILDLIFE_SPECIES || {};
    // registerPelts stamps `species` on every hide row — the direct road.
    const econ = CBZ.cityEcon;
    const row = econ && econ.ITEMS && econ.ITEMS[itemName];
    if (row && row.species && S[row.species]) return S[row.species];
    // fallback (a save hydrating before the catalog exists): match by fur name,
    // accepting the "Pristine " prefix skin() mints.
    const bare = String(itemName).replace(/^Pristine /, "");
    for (const id in S) if (S[id] && S[id].fur === bare) return S[id];
    return null;
  }
  function wearable(itemName) {
    const sp = speciesOf(itemName);
    if (!sp || !sp.fur || furIsFood(sp)) return null;
    if (typeof sp.build !== "function") return null;
    return sp;
  }
  CBZ.peltWearable = wearable;

  // ---- rebuild the species model (deterministic, hood-stable) --------------
  // The rng is a seeded LCG scaled to 0..0.72: deterministic per species (the
  // same buck always wears the same rack on every client — the determinism
  // law) and biased LOW so the `r() < 0.5` feature gates the builds use
  // (antlers, manes) usually INCLUDE the trophy feature a hood exists to show.
  // No species build contains a loop on rng (checked), so the bias is safe.
  function buildModel(sp) {
    if (!THREE) return null;
    const mat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };
    let n = 1;
    const idStr = String(sp.id || "pelt");
    for (let i = 0; i < idStr.length; i++) n = (n * 31 + idStr.charCodeAt(i)) % 2147483647;
    if (n < 2) n = 2;
    const rng = function () { n = (n * 16807) % 2147483647; return (n / 2147483647) * 0.72; };
    let grp = null;
    try { grp = sp.build({ THREE: THREE, mat: mat, rng: rng }); } catch (e) { grp = null; }
    return grp;
  }

  // ---- head-cluster harvest — wildlife.js buildGaitRig's own discovery -----
  function meshDims(m) {
    const p = m.geometry && m.geometry.parameters;
    if (p && p.width != null) return { w: Math.max(p.width, p.depth || p.width), h: p.height, d: p.depth || p.width, x: p.width };
    const bb = m.geometry && (m.geometry.boundingBox || (m.geometry.computeBoundingBox(), m.geometry.boundingBox));
    if (!bb) return null;
    return { w: Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z), h: bb.max.y - bb.min.y, d: bb.max.z - bb.min.z, x: bb.max.x - bb.min.x };
  }
  function harvestHead(grp) {
    const kids = grp.children, cols = [], rest = [];
    let maxX = 0;
    for (let i = 0; i < kids.length; i++) {
      const m = kids[i]; if (!m.isMesh) continue;
      const d = meshDims(m); if (!d) continue;
      if (m.position.x > maxX) maxX = m.position.x;
      const bottom = m.position.y - d.h / 2;
      // a LEG: taller than wide, planted at the ground (the shipped test)
      if (d.h >= 0.14 && d.h >= d.w * 1.1 && bottom <= 0.16 && bottom >= -0.05) {
        let col = null;
        for (let c = 0; c < cols.length; c++) {
          if (Math.abs(cols[c].x - m.position.x) <= 0.14 && Math.abs(cols[c].z - m.position.z) <= 0.14) { col = cols[c]; break; }
        }
        if (!col) { col = { x: m.position.x, z: m.position.z, top: 0, h: d.h }; cols.push(col); }
        col.top = Math.max(col.top, m.position.y + d.h / 2);
        col.h = Math.max(col.h, d.h);
      } else {
        rest.push({ m: m, d: d, bottom: bottom });
      }
    }
    const head = [];
    let headMesh = null, headVol = 0;
    for (let i = 0; i < rest.length; i++) {
      const r = rest[i], m = r.m;
      let joined = false;
      for (let c = 0; c < cols.length; c++) {
        const col = cols[c];
        if (Math.abs(col.x - m.position.x) <= 0.13 && Math.abs(col.z - m.position.z) <= 0.13 &&
            m.position.y - r.d.h / 2 < col.top && r.d.h <= col.h * 1.2) { joined = true; break; }
      }
      // head cluster: far forward, up off the ground — never a leg, hoof or paw
      if (!joined && maxX > 0.4 && m.position.x >= maxX * 0.55 && r.bottom >= 0.3) {
        head.push(m);
        const vol = r.d.w * r.d.w * r.d.h;
        if (m.position.x >= maxX * 0.62 && vol > headVol) { headVol = vol; headMesh = m; }
      }
    }
    return { head: head, headMesh: headMesh };
  }

  // the mantle's fur is the animal's own dominant coat — the largest-volume
  // mesh in the whole build (the body barrel) names the colour; no palette
  // table, so a new species' mantle matches its model for free.
  function dominantHex(grp, sp) {
    let best = null, bv = 0;
    const kids = grp.children;
    for (let i = 0; i < kids.length; i++) {
      const m = kids[i]; if (!m.isMesh) continue;
      const p = m.geometry && m.geometry.parameters; if (!p || p.width == null) continue;
      const v = p.width * p.height * (p.depth || p.width);
      if (v > bv) { bv = v; best = m; }
    }
    if (best && best.material && best.material.color) return best.material.color.getHex();
    return (sp && sp.color) || 0x7a5a3a;
  }
  function shade(hex, k) {
    const r = Math.min(255, (((hex >> 16) & 255) * k) | 0);
    const gg = Math.min(255, (((hex >> 8) & 255) * k) | 0);
    const b = Math.min(255, ((hex & 255) * k) | 0);
    return (r << 16) | (gg << 8) | b;
  }
  function fmat(hex) {
    return (CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); })(hex);
  }

  // ---- the HOOD — the harvested head, sized and seated like the photo ------
  // Sizing is three clamps, no taste per species: width targets the discovered
  // head BOX's own lateral depth at world scale (clamped 0.5–0.95 so a fox hat
  // stays foxy and a moose does not swallow you), then total length ≤ 1.15
  // (a crocodile's metre of muzzle stays wearable) and total height ≤ 1.45
  // (a full whitetail rack reads as a crown, not a mast).
  function buildHood(sp) {
    const grp = buildModel(sp); if (!grp) return null;
    const hv = harvestHead(grp);
    if (!hv.head.length) return null;
    const wrap = new THREE.Group();
    for (let i = 0; i < hv.head.length; i++) {
      const c = hv.head[i].clone();      // shares geometry + cached materials
      c.castShadow = false; c.receiveShadow = false;
      wrap.add(c);
    }
    // rebase about the cluster centre so scale/pitch turn about the hood itself
    const b0 = new THREE.Box3().setFromObject(wrap);
    const c0 = b0.getCenter(new THREE.Vector3());
    for (let i = 0; i < wrap.children.length; i++) wrap.children[i].position.sub(c0);
    const size = b0.getSize(new THREE.Vector3());
    const hm = hv.headMesh && meshDims(hv.headMesh);
    const lateral = Math.max(0.08, (hm && hm.d) || size.z);
    const natural = lateral * (sp.scale || 1);
    let k = Math.min(0.95, Math.max(0.5, natural)) / lateral;
    if (size.x * k > 1.15) k = 1.15 / size.x;
    if (size.y * k > 1.45) k = 1.45 / size.y;
    wrap.scale.setScalar(k);
    // nose +X -> the wearer's forward +Z, muzzle pitched UP over the brow —
    // the photo's tilt. One euler (XYZ): yaw first in matrix terms, pitch last.
    wrap.rotation.set(-0.42, -Math.PI / 2, 0);
    // seat it: measure the rotated+scaled box at the origin, then place its
    // underside INTO the upper head (dome 0.17–0.63) so it reads worn.
    wrap.updateMatrixWorld(true);
    const b1 = new THREE.Box3().setFromObject(wrap);
    wrap.position.y = 0.38 - b1.min.y;
    wrap.position.z = 0.10 - (b1.min.z + b1.max.z) / 2;
    wrap.userData.pelt = true;
    return wrap;
  }

  // ---- the MANTLE — fur over both shoulders, cord + clasp on the chest -----
  // Every dimension rides CBZ.cityArmorFit's MEASUREMENT of what this rig is
  // actually wearing (the armour-sits-proud law): the mantle is the outermost
  // layer, 0.04 proud of the vest/jacket plane, so no outfit can stipple it.
  function buildMantleMeshes(ch, furHex) {
    const out = [];
    if (!THREE || !CBZ.boxGeom) return out;
    const fit = (CBZ.cityArmorFit && ch) ? CBZ.cityArmorFit(ch) : null;
    const vestW = fit ? fit.vest[0] : 1.02;
    const vestD = fit ? fit.vest[2] : 0.62;
    const topY = fit ? Math.max(fit.vestY + fit.vest[1] / 2, fit.padY) : 1.84;
    const F = fmat(furHex);                 // the coat
    const D = fmat(shade(furHex, 0.66));    // shadowed under-fur
    const C = fmat(shade(furHex, 0.38));    // the leather cord
    const S = fmat(0xc7cdd6);               // the pewter clasp
    function put(w, h, d, m2, x, y, z, rz, rx) {
      const mesh = new THREE.Mesh(CBZ.boxGeom(w, h, d), m2);
      mesh.position.set(x, y, z);
      if (rz) mesh.rotation.z = rz;
      if (rx) mesh.rotation.x = rx;
      mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.userData.pelt = true;
      out.push(mesh);
      return mesh;
    }
    const sx = vestW / 2 + 0.02, fz = vestD / 2;
    // shoulders: a deep dark under-slab and a higher coat slab, sloping outward
    put(0.56, 0.22, vestD + 0.36, D, -sx, topY + 0.06, 0, 0.30, 0);
    put(0.56, 0.22, vestD + 0.36, D, sx, topY + 0.06, 0, -0.30, 0);
    put(0.44, 0.18, vestD + 0.22, F, -sx - 0.05, topY + 0.20, 0, 0.42, 0);
    put(0.44, 0.18, vestD + 0.22, F, sx + 0.05, topY + 0.20, 0, -0.42, 0);
    // the collar roll behind the neck + the back panel and long drape
    put(0.58, 0.20, 0.24, F, 0, topY + 0.16, -(fz - 0.04), 0, 0.18);
    put(vestW + 0.26, 0.52, 0.16, F, 0, topY - 0.14, -(fz + 0.10), 0, 0.10);
    put(vestW * 0.78, 0.92, 0.10, D, 0, topY - 0.66, -(fz + 0.13), 0, 0.04);
    // chest fronts framing the V opening
    put(0.34, 0.46, 0.15, F, -(sx - 0.13), topY - 0.16, fz + 0.06, -0.16, 0);
    put(0.34, 0.46, 0.15, F, (sx - 0.13), topY - 0.16, fz + 0.06, 0.16, 0);
    // the cord: two straps meeting at the clasp, tails hanging below it
    put(0.035, 0.42, 0.03, C, -0.08, topY - 0.10, fz + 0.10, 0.10, 0);
    put(0.035, 0.42, 0.03, C, 0.08, topY - 0.10, fz + 0.10, -0.10, 0);
    put(0.12, 0.12, 0.05, S, 0, topY - 0.34, fz + 0.12, 0, 0);
    put(0.03, 0.60, 0.025, C, -0.035, topY - 0.72, fz + 0.10, 0, 0);
    put(0.03, 0.60, 0.025, C, 0.035, topY - 0.72, fz + 0.10, 0, 0);
    return out;
  }

  // ---- mount / unmount ------------------------------------------------------
  let _meshes = [];        // everything currently mounted (hood + mantle + flaps)
  let _mountedOn = null;   // the rig they are mounted on (playerChar identity)
  function unmount() {
    for (let i = 0; i < _meshes.length; i++) {
      const m = _meshes[i];
      if (m && m.parent) m.parent.remove(m);
    }
    _meshes = []; _mountedOn = null;
  }
  // Mount the full pelt on a rig. Exported so a future consumer (a shaman ped,
  // a wardrobe preview) can dress ANY rig — nothing in here is player-specific.
  function mountOn(ch, speciesId) {
    if (!ch || !ch.neck || !ch.body || !THREE) return null;
    const sp = (CBZ.WILDLIFE_SPECIES || {})[speciesId];
    if (!sp) return null;
    const out = [];
    const grp = buildModel(sp);
    const furHex = grp ? dominantHex(grp, sp) : ((sp && sp.color) || 0x7a5a3a);
    const hood = buildHood(sp);
    if (hood) { ch.neck.add(hood); out.push(hood); }
    // side fur flaps framing the face (the photo's cheek fur), on the neck so
    // they turn with the head like the hood does.
    const F = fmat(furHex);
    [-1, 1].forEach(function (s) {
      const flap = new THREE.Mesh(CBZ.boxGeom(0.15, 0.36, 0.22), F);
      flap.position.set(s * 0.36, 0.24, 0.08);
      flap.rotation.z = s * 0.18;
      flap.castShadow = false; flap.receiveShadow = false;
      flap.userData.pelt = true;
      ch.neck.add(flap); out.push(flap);
    });
    const mantle = buildMantleMeshes(ch, furHex);
    for (let i = 0; i < mantle.length; i++) { ch.body.add(mantle[i]); out.push(mantle[i]); }
    return out.length ? out : null;
  }
  CBZ.peltMountOn = mountOn;

  function playerRig() { return CBZ.playerChar || null; }
  function state() { return (g && g.cityPelt) || null; }
  function mountPlayer() {
    unmount();
    const st = state(); if (!st || !ON()) return false;
    const ch = playerRig(); if (!ch) return false;
    const sp = wearable(st.item); if (!sp) return false;
    const out = mountOn(ch, sp.id);
    if (!out) return false;
    _meshes = out; _mountedOn = ch;
    return true;
  }

  // ---- the public wear verbs ------------------------------------------------
  function peltWorn() { const st = state(); return st ? st.item : null; }
  CBZ.peltWorn = peltWorn;

  function peltWear(itemName) {
    if (!ON() || !g) return false;
    const sp = wearable(itemName); if (!sp) return false;
    const econ = CBZ.cityEcon;
    // worn, not consumed — but you must be CARRYING the hide (economy.js law)
    if (econ && econ.count && econ.count(itemName) <= 0) {
      if (CBZ.city && CBZ.city.note) CBZ.city.note("You're not carrying that hide.", 1.6);
      return false;
    }
    g.cityPelt = { item: itemName, species: sp.id };
    mountPlayer();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }
  CBZ.peltWear = peltWear;

  function peltUnwear(silent) {
    if (!g || !g.cityPelt) return false;
    g.cityPelt = null;
    unmount();
    if (!silent && CBZ.city && CBZ.city.note) CBZ.city.note("Pelt off, it's back to a hide in your pocket.", 1.8);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }
  CBZ.peltUnwear = peltUnwear;

  // pocket toggle — itemicons.js's USE dispatcher tries this FIRST on "wear";
  // returns true only when the item is a hide (so clothing falls through to
  // outfits.js untouched).
  CBZ.peltWearItem = function (itemName) {
    if (!wearable(itemName)) return false;
    if (peltWorn() === itemName) { peltUnwear(); return true; }
    if (peltWear(itemName)) {
      if (CBZ.city && CBZ.city.note) CBZ.city.note("Wearing the " + itemName + " · hood and mantle.", 2);
      if (CBZ.sfx) { try { CBZ.sfx("equip"); } catch (e) {} }
      return true;
    }
    return true;   // it WAS a hide; a refused wear already spoke its note
  };

  // ---- consumer 1: skin() — the owner's ask, kill → skin → WEARING IT ------
  CBZ.peltOnSkin = function (sp, peltName) {
    if (!AUTO() || !sp) return false;
    if (!wearable(peltName)) return false;         // fish and food furs fall out
    if (peltWorn() === peltName) { mountPlayer(); return true; }   // fresh mount, same pelt
    if (!peltWear(peltName)) return false;
    if (CBZ.city && CBZ.city.note) CBZ.city.note("You pull the " + sp.name + " pelt on, hood up.", 2.4);
    if (CBZ.sfx) { try { CBZ.sfx("equip"); } catch (e) {} }
    return true;
  };

  // ---- persistence — the pawnshop.js one-shot stamp/hydrate pattern --------
  function stampLedger() {
    if (!g) return;
    const led = g.cityWorld;
    if (led && typeof led === "object") led.cityPelt = g.cityPelt ? { item: g.cityPelt.item, species: g.cityPelt.species } : null;
  }
  let _wrapsDone = false;
  function ensureSaveWraps() {
    if (_wrapsDone) return;
    _wrapsDone = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._peltWrap) {
      const w = function () { stampLedger(); return commit.apply(this, arguments); };
      w._peltWrap = true; CBZ.cityWorldCommit = w;
    }
    const col = CBZ.cityWorldCollect;
    if (typeof col === "function" && !col._peltWrap) {
      const wc = function () { stampLedger(); return col.apply(this, arguments); };
      wc._peltWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    if (!g) return;
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.cityPelt && led.cityPelt.item) g.cityPelt = { item: led.cityPelt.item, species: led.cityPelt.species };
  }

  // ---- outfit changes re-solve the fit (armor.js's recolor wrap pattern) ---
  let _wrapRecolorDone = false;
  function ensureRecolorWrap() {
    if (_wrapRecolorDone) return;
    const orig = CBZ.cityRecolorRig;
    if (typeof orig !== "function" || orig._peltWrapped) { _wrapRecolorDone = !!(orig && orig._peltWrapped); return; }
    _wrapRecolorDone = true;
    const w = function (ch) {
      const r = orig.apply(this, arguments);
      try { if (ch && ch === _mountedOn && state()) mountPlayer(); } catch (e) {}
      return r;
    };
    w._peltWrapped = true; w._peltOrig = orig;
    CBZ.cityRecolorRig = w;
  }

  // ---- the guard tick — cheap truth-keeping, every frame, early-outs -------
  //  • hydrates a freshly-swapped world ledger (load / respawn / MP adopt)
  //  • the hide left the pocket (sold/pawned/dropped) → the mantle comes off
  //  • the rig was rebuilt (death respawn, outfit vault swap) → re-mount
  //  • the master flag went off → strip
  CBZ.onUpdate(38.7, function () {
    if (!g || g.mode !== "city") return;
    ensureSaveWraps(); ensureRecolorWrap(); hydrateFromLedger();
    const st = state();
    if (!st) { if (_meshes.length) unmount(); return; }
    if (!ON()) { unmount(); return; }
    const econ = CBZ.cityEcon;
    if (econ && econ.count && econ.count(st.item) <= 0) {
      peltUnwear(true);
      if (CBZ.city && CBZ.city.note) CBZ.city.note("The " + st.item + " left your pocket, the pelt comes off.", 2);
      return;
    }
    if (_mountedOn !== playerRig()) mountPlayer();
  });

  // ---- RATCHET (CLAUDE.md law #5): CBZ.peltAudit() -------------------------
  // `wearable` counts species whose hide can be worn; `hoodless` names the
  // species whose harvest finds no head cluster (snakes lie on the ground —
  // legitimately hoodless, they wear mantle-only). REPORTED, not pinned:
  // whoever runs it first writes the number into CLAUDE.md (never pin a guess).
  CBZ.peltAudit = function () {
    const S = CBZ.WILDLIFE_SPECIES || {};
    let wearableN = 0;
    const hoodless = [];
    for (const id in S) {
      const sp = S[id];
      if (!sp || !sp.fur || furIsFood(sp) || typeof sp.build !== "function") continue;
      wearableN++;
      const grp = buildModel(sp);
      const hv = grp ? harvestHead(grp) : { head: [] };
      if (!hv.head.length) hoodless.push(id);
    }
    return {
      flag: ON(), auto: AUTO(),
      worn: peltWorn(), species: (state() && state().species) || null,
      mounted: _meshes.length, onRig: !!_mountedOn,
      wearable: wearableN, hoodless: hoodless.length, hoodlessIds: hoodless,
    };
  };
})();

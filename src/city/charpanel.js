/* ============================================================
   city/charpanel.js — YOU, ON YOUR OWN SCREEN: the [I] inventory /
   wardrobe screen.

   WHY (the missing self-read): the city already KNOWS everything about
   you — your worn fit (g.cityFit), the chain/watch/ring you OWN
   (g.cityInv), your level/title (CBZ.cityPlayerLevel / cityPlayerTitle),
   the price on your head (CBZ.cityBounty), your stars, your net worth —
   but there was never a single place to SEE yourself: to confirm the
   tux you bought is actually ON you, that the iced-out chain is worn and
   not just sitting in a duffel. This panel is that mirror.

   • (the persistent top-left card that used to live here was cut in the
     2026-09-27 HUD purge; its portrait renderer survives for the [I]
     screen and mugshot.js.)

   • (2026-09-28: no key opens this any more — the city bar IS the
     inventory. The overlay below survives only as a harness seam
     (CBZ.cityCharPanel.open) and for its portrait renderer.)
     INVENTORY OVERLAY — the Minecraft E-screen, done the city way
     so it can never misfire: on open CBZ.cityMenuOpen=true +
     document.exitPointerLock(); on close CBZ.cityMenuOpen=false +
     CBZ.requestLock(). A bigger portrait (same rig), the 9 ACCESSORY
     slots (hat/top/outer/bottom/shoes/glasses/chain/watch/ring) read
     straight from g.cityFit + your owned jewellery, a GRID of carried
     items (g.cityInv). Click an
     accessory to equip/unequip through the EXISTING wardrobe
     (CBZ.cityWear / cityUnwear) — no parallel wardrobe, the model
     updates on the next signature tick. (Its hotbar mirror is gone:
     the one bar is systems/inventory.js's #hotbar.)

   • [O] HIDE-HUD — hides/shows ALL city HUD (this panel + #cityHud) for
     a clean, immersive frame ([Shift+O]; H belongs to heists.js /
     realestate.js / interact.js).

   COSMETIC ADDITION. Removes nothing, breaks nothing. CITY-ONLY (gated
   on g.mode === "city"); jail / disaster-survival are byte-identical
   (the whole module no-ops outside the city). Self-mounted DOM, the
   bank.js / clothingstore.js pattern. Headless-guarded.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.onUpdate) return;            // engine namespace required
  const THREE = window.THREE;
  const g = CBZ.game;
  if (!g) return;

  // ---- small utils ---------------------------------------------------------
  function fmt$(n) { n = Math.round(n || 0); const s = (n < 0 ? "-" : "") + "$" + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); return s; }
  function netWorth() { const e = CBZ.cityEcon; if (e && e.netWorth) { const v = e.netWorth(); if (isFinite(v)) return v; } return (g.cash || 0) + (g.cityBank || 0); }
  function cityNow() { return g.mode === "city"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // ============================================================
  //  THE 9 ACCESSORY SLOTS — one read of WHAT IS WORN, routed through
  //  the EXISTING wardrobe. Cloth slots map to clothes.js COMP slots
  //  (the value in g.cityFit.items); jewellery slots are read from the
  //  bling classifier's worn set (best owned piece per body slot).
  //  We never invent a parallel wardrobe — equip = CBZ.cityWear,
  //  unequip = CBZ.cityUnwear; jewellery is worn automatically by
  //  bling.js when owned, so its slots are read-only (informational).
  // ============================================================
  // panel slot -> { cloth: COMP slot name } OR { bling: bling slot key }
  const SLOTS = [
    { key: "hat",     name: "Hat",     icon: "", cloth: "head" },
    { key: "top",     name: "Top",     icon: "", cloth: "shirt" },
    { key: "outer",   name: "Outer",   icon: "", cloth: "jacket" },
    { key: "bottom",  name: "Bottom",  icon: "", cloth: "legs" },
    { key: "shoes",   name: "Shoes",   icon: "", cloth: "shoes" },
    { key: "glasses", name: "Glasses", icon: "", bling: "eyes" },
    { key: "chain",   name: "Chain",   icon: "", bling: "neck" },
    { key: "watch",   name: "Watch",   icon: "", bling: "wristL" },
    { key: "ring",    name: "Ring",    icon: "", bling: "ring" },
  ];

  // the composable spec for a worn visualId (clothes.js owns the table)
  function compSpec(id) { return (CBZ.cityComposableSpec && CBZ.cityComposableSpec(id)) || null; }
  function fitItems() { const f = g.cityFit; return (f && Array.isArray(f.items)) ? f.items : []; }

  // what visualId (if any) is worn in a given COMP slot
  function clothWornIn(slotName) {
    const items = fitItems();
    for (let i = 0; i < items.length; i++) {
      const sp = compSpec(items[i]);
      if (!sp) continue;
      const s = sp.legsHex != null ? "legs" : (sp.slot || null);
      // a fully-painted special (tuxedo) reads as the top/outer
      if (sp.painted) { if (slotName === "outer" || slotName === "top") return items[i]; continue; }
      if (s === slotName) return items[i];
    }
    return null;
  }

  // best OWNED jewellery name for a bling slot (mirrors bling.js flexTable
  // classification, read-only). Returns the catalog name or null.
  function blingWornIn(slotKey) {
    // eyewear is its own axis (a face-mounted shade, not a body jewel) — the
    // panel's "Glasses" slot reads it like a bling slot for a uniform "Worn"
    // grid, but the OWNED-item test differs (sunglass/shades, never a grill),
    // so we delegate to the single eyewear classifier rather than duplicate it.
    if (slotKey === "eyes") return eyewearWornIn();
    const econ = CBZ.cityEcon;
    if (!econ || !econ.ITEMS || !g.cityInv) return null;
    const items = econ.ITEMS;
    let best = null, bestV = -1;
    for (const name in g.cityInv) {
      if ((g.cityInv[name] | 0) <= 0) continue;
      const it = items[name];
      if (!it || (it.tag !== "wearable" && it.tag !== "valuable" && it.tag !== "jewelry")) continue;
      // the ladder that used to live here was a drifted copy of bling.js's
      // classifier (it still hand-excepted "earring") — one classifier, one
      // answer, for the street, the audit and this panel alike.
      const cl = CBZ.cityBlingClassify && CBZ.cityBlingClassify(name);
      if (!cl || cl.slot !== slotKey) continue;
      const v = it.value || 0;
      if (v > bestV) { bestV = v; best = name; }
    }
    return best;
  }

  // a human label for a slot's worn content
  function slotLabel(def) {
    if (def.cloth) {
      const id = clothWornIn(def.cloth);
      if (!id) return null;
      const sp = compSpec(id);
      return (sp && sp.label) || id;
    }
    if (def.bling) return blingWornIn(def.bling);
    return null;
  }

  // ============================================================
  //  WORN JEWELLERY ON THE PORTRAIT — every slot the street mounts.
  //  clothes.js dresses the rig's FABRIC (cityApplyComposite); the
  //  worn jewellery is mounted SEPARATELY by bling.js onto the LIVE
  //  player rig (CBZ.playerChar) and so never reaches the portrait's
  //  own rig. The live player's dress call is CBZ.cityBlingResyncPed
  //  (a ped-shaped { char, valuables, gang, ... } → its .char gets the
  //  shared pooled meshes), but that path is camera-distance gated and
  //  pushes onto bling.js's global "dressed" roster — wrong for an
  //  isolated offscreen rig. Meshes are built once and re-pointed on
  //  change — no per-frame allocation, no street pool touched.
  // ============================================================
  // The geometry table, finish table, part lists and slot ladder that used to
  // live here were a FOURTH copy of bling.js's answer, and they had drifted
  // (hand-typed earring exception; a watch cuff the street had already moved).
  // bling.js now exports the one answer: cityBlingParts resolves a catalog name
  // through the same classifier and look table the street mounts from, and
  // cityBlingBuild raises FRESH meshes (never the street pool — this rig strips
  // without releasing) from the same shared geometry + materials. The portrait
  // and the street can no longer disagree about what a piece looks like.
  //
  // THE WRIST AND THE HAND ARE STILL NOT TYPED HERE. Both landmarks come off
  // the rig being drawn (CBZ.charArmLandmarks), so a portrait of a woman or a
  // child puts the watch on HER wrist. Degrade-safe: no export → the
  // adult-male literals.
  function armLM(rig) {
    return (CBZ.charArmLandmarks && CBZ.charArmLandmarks(rig)) || { wrist: -0.22, hand: -0.34 };
  }

  // every body-jewel slot the street can mount (eyes stays on the eyewear
  // axis — the panel's shades ride the fabric path, not this one).
  const JEWEL_SLOTS = ["neck", "wristL", "wristR", "ring", "mouth", "ears", "crown"];

  // a stable signature of the player's WORN jewellery — pieces re-mount only
  // when this changes (keeps the redraw-on-change perf contract).
  function jewelSig() {
    let sig = "";
    for (let i = 0; i < JEWEL_SLOTS.length; i++) sig += (blingWornIn(JEWEL_SLOTS[i]) || "") + "|";
    return sig;
  }

  // anchors mirror bling.js SLOTS: neck→body, wrist/ring→the ELBOW groups on
  // two-segment rigs, head-level pieces (grill/earrings/tiara)→the neck group.
  function jewelAnchor(rig, slot) {
    if (slot === "neck") return rig.body;
    if (slot === "wristL") return (rig.low && rig.low.la) || (rig.parts && rig.parts.la);
    if (slot === "wristR" || slot === "ring") return (rig.low && rig.low.ra) || (rig.parts && rig.parts.ra);
    return rig.neck;
  }

  // (re)dress the portrait rig's worn jewellery to match the player. Idempotent:
  // strips the previous pieces, mounts the current worn set. Called on look change.
  function applyPortraitJewelry(rig) {
    if (!rig) return;
    // strip any previously-mounted jewellery meshes
    if (rig._cpJewel) {
      for (let i = 0; i < rig._cpJewel.length; i++) {
        const m = rig._cpJewel[i];
        if (m && m.parent) m.parent.remove(m);
      }
      rig._cpJewel = null;
    }
    if (!CBZ.cityBlingParts || !CBZ.cityBlingBuild) return; // engine not up yet
    const lm = armLM(rig);
    const out = [];
    for (let i = 0; i < JEWEL_SLOTS.length; i++) {
      const name = blingWornIn(JEWEL_SLOTS[i]);
      if (!name) continue;
      CBZ.cityBlingBuild(CBZ.cityBlingParts(name), jewelAnchor(rig, JEWEL_SLOTS[i]), out, lm, rig);
    }
    if (out.length) rig._cpJewel = out;
  }

  // ============================================================
  //  WORN ARMOR ON THE PORTRAIT — vest + chest plate band + helmet.
  //  Same separate-mesh story as the jewellery above: armor.js mounts the
  //  player's kit (CBZ.player._armorKit) as POOLED shells on the LIVE rig via
  //  CBZ.cityArmorPlayerResync — tied to armor.js's own pool + the live-player
  //  anchors, wrong for this isolated offscreen rig. So we mount the SAME shells
  //  here directly, at the EXACT geometry + local transforms armor.js uses
  //  (geoFor / mountKitMeshes), coloured from the public CBZ.ARMOR_KITS table.
  //  Built once, re-pointed on change — no per-frame alloc, no pool touched.
  // ============================================================
  const AG = {};                                   // shared armour geometry by kind
  function ageo(kind) {
    if (AG[kind] !== undefined) return AG[kind];
    const B = CBZ.boxGeom; let gm = null;
    if (B) {
      if (kind === "vest") gm = B(1.02, 0.86, 0.62);
      else if (kind === "vestHi") gm = B(1.04, 0.30, 0.64);
    }
    AG[kind] = gm;
    return gm;
  }
  const _amats = {};                               // shared armour finishes by colour (mirror armor.js matFor)
  function amat(color) {
    if (color == null) color = 0x2b2f36;
    if (_amats[color]) return _amats[color];
    const C = CBZ.cmat; if (!C) return null;
    return (_amats[color] = C(color, { emissive: 0x0a0c0f, ei: 0.18 }));
  }
  // a stable signature of the player's worn armour — re-mount only on change.
  function armorSig() {
    const P = CBZ.player, k = P && P._armorKit;
    if (!k) return "";
    return (k.chest || "") + "|" + (k.head || "");
  }
  function mountArmorMesh(kind, anchor, color, x, y, z, out, dims) {
    if (!anchor || !anchor.add || !THREE) return;
    const geo = (dims && CBZ.boxGeom) ? CBZ.boxGeom(dims[0], dims[1], dims[2]) : ageo(kind);
    const mat = amat(color);
    if (!geo || !mat) return;
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = false; m.receiveShadow = false;
    m.position.set(x, y, z);
    anchor.add(m); out.push(m);
  }
  // (re)dress the portrait rig's worn armour to match the player. Idempotent:
  // strips the previous shells, mounts the current kit. Vest/band ride the body,
  // helmet rides the neck — the exact anchors + transforms armor.js mounts on.
  function applyPortraitArmor(rig) {
    if (!rig) return;
    if (rig._cpArmor) {
      for (let i = 0; i < rig._cpArmor.length; i++) { const m = rig._cpArmor[i]; if (m && m.parent) m.parent.remove(m); }
      rig._cpArmor = null;
    }
    if (CBZ.headwear) CBZ.headwear.wear(rig, null, { owner: "armor" });
    const P = CBZ.player, k = P && P._armorKit, KITS = CBZ.ARMOR_KITS;
    if (!k || !KITS) return;                        // no kit worn — fabric only
    const out = [];
    const chest = k.chest && KITS[k.chest];
    if (chest) {
      // FITTED, not typed — armor.js owns the one answer to "how far proud of
      // this outfit does the armour sit" (CBZ.cityArmorFit), so the portrait
      // cannot drift into the coplanar vest/jacket stipple the live body just
      // had. Degrade-safe: no export → the authored shells, exactly as before.
      const fit = CBZ.cityArmorFit && CBZ.cityArmorFit(rig);
      mountArmorMesh("vest", rig.body, chest.color, 0, fit ? fit.vestY : 1.40, 0, out, fit && fit.vest);
      if (chest.id !== "softVest") mountArmorMesh("vestHi", rig.body, chest.color, 0, fit ? fit.bandY : 1.58, fit ? fit.bandZ : 0.02, out, fit && fit.band);   // raised plate band (SWAT/plate reads heavier)
    }
    const head = k.head && KITS[k.head];
    // the helmet is the same fitted ballistic lid armor.js puts on the live
    // body (entities/headwear.js, "armor" owner over the role cap)
    if (head && CBZ.headwear) CBZ.headwear.wear(rig, "ballistic", { owner: "armor", variant: "swat", color: head.color });
    if (out.length) rig._cpArmor = out;
  }

  // ============================================================
  //  WORN EYEWEAR ON THE PORTRAIT — sunglasses / designer shades.
  //  Same separate-mesh story as the jewellery + armour above: bling.js
  //  mounts the player's shades as a 5-part shell (two lenses + bridge + two
  //  temples) on the LIVE rig's "eyes" group — which resolves to the head/neck
  //  bone, so the glasses RIDE AND TURN with the head — but that path is the
  //  live-player roster + camera-distance gated, wrong for this isolated
  //  offscreen rig. So we mount the SAME shell here directly, at the EXACT
  //  geometry, local transforms and finishes bling.js uses, anchored on the
  //  rig's NECK group (transforms are NECK-LOCAL). Built once, re-pointed on
  //  change — no per-frame alloc, no global roster touched.
  //
  //  WHY a face-mounted shade reads at all on a tiny portrait: the small panel
  //  frames the upper body and the big [I] view shows the whole rig — the head
  //  is the focal point of both, so a worn pair of shades is the single most
  //  visible accessory; without this the portrait lied (bare eyes) the instant
  //  the player put shades on, exactly the "is it actually ON me?" doubt this
  //  whole mirror exists to kill.
  // ============================================================
  const EG = {};                                   // shared eyewear geometry by kind (mirror bling.js)
  function egeo(kind) {
    if (EG[kind] !== undefined) return EG[kind];
    const B = CBZ.boxGeom; let gm = null;
    if (B) {
      if (kind === "lens") gm = B(0.20, 0.17, 0.05);         // one shade lens over an eye
      else if (kind === "bridge") gm = B(0.09, 0.055, 0.05); // nose bridge joining the lenses
      else if (kind === "temple") gm = B(0.035, 0.045, 0.30);// arm running back over the ear
    }
    EG[kind] = gm;
    return gm;
  }
  let _emats = null;                               // shared eyewear finishes (mirror bling.js)
  function emats() {
    if (_emats) return _emats;
    const C = CBZ.cmat; if (!C) return null;
    _emats = {
      lensDark: C(0x0a0d12, { emissive: 0x1b2535, ei: 0.30 }),   // basic sunglasses lens
      lensMirror: C(0x0e1422, { emissive: 0x37588a, ei: 0.50 }), // designer mirrored lens
      frameDark: C(0x111317, { emissive: 0x000000, ei: 0.0 }),   // black plastic frame
      gold: C(0xc9a44a, { emissive: 0x6b4f12, ei: 0.4 }),        // designer frame (same gold the jewelry uses)
    };
    return _emats;
  }
  // the 5-part shade shell (kind + finish + neck-local transform) — copied 1:1
  // from bling.js so the portrait reads identically to the live body. The basic
  // pair is all-black with dark lenses; the designer pair is the SAME 5
  // transforms with mirrored lenses + a gold frame.
  function eyewearParts(name) {
    const M = emats(); if (!M) return null;
    const designer = String(name).toLowerCase().indexOf("designer") >= 0;
    const lens = designer ? M.lensMirror : M.lensDark;
    const frame = designer ? M.gold : M.frameDark;
    return [
      { kind: "lens", mat: lens, x: -0.145, y: 0.345, z: 0.34 },
      { kind: "lens", mat: lens, x: 0.145, y: 0.345, z: 0.34 },
      { kind: "bridge", mat: frame, x: 0.0, y: 0.345, z: 0.34 },
      { kind: "temple", mat: frame, x: -0.27, y: 0.345, z: 0.17 },
      { kind: "temple", mat: frame, x: 0.27, y: 0.345, z: 0.17 },
    ];
  }
  // best OWNED eyewear NAME (or null) — scans g.cityInv + CBZ.cityEcon.ITEMS
  // exactly like blingWornIn does, but with the eyewear name test: a "sunglass"
  // or "shades" item (NEVER a "grill", which slots to glasses but is a mouth
  // piece). Designer Shades (value 420) outrank Sunglasses (value 140), so the
  // highest-value owned pair wins.
  function eyewearWornIn() {
    const econ = CBZ.cityEcon;
    if (!econ || !econ.ITEMS || !g.cityInv) return null;
    const items = econ.ITEMS;
    let best = null, bestV = -1;
    for (const name in g.cityInv) {
      if ((g.cityInv[name] | 0) <= 0) continue;
      const it = items[name];
      if (!it) continue;
      const s = name.toLowerCase();
      if (s.indexOf("grill") >= 0) continue;                 // a grill slots to glasses but is NOT eyewear
      if (s.indexOf("sunglass") < 0 && s.indexOf("shades") < 0) continue;
      const v = it.value || 0;
      if (v > bestV) { bestV = v; best = name; }
    }
    return best;
  }
  function mountEyewearMesh(kind, anchor, mat, x, y, z, out) {
    if (!anchor || !anchor.add || !THREE || !mat) return;
    const geo = egeo(kind);
    if (!geo) return;
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = false; m.receiveShadow = false;
    m.position.set(x, y, z);
    anchor.add(m); out.push(m);
  }
  // (re)dress the portrait rig's worn eyewear to match the player. Idempotent:
  // strips the previous shade shell, mounts the current pair on the NECK group
  // (so it rides the head exactly like bling.js's "eyes" anchor). No pool shared
  // with bling — its own tracked list on rig._cpEyewear.
  function applyPortraitEyewear(rig) {
    if (!rig) return;
    if (rig._cpEyewear) {
      for (let i = 0; i < rig._cpEyewear.length; i++) { const m = rig._cpEyewear[i]; if (m && m.parent) m.parent.remove(m); }
      rig._cpEyewear = null;
    }
    if (!emats()) return;                           // engine primitives not up yet
    const worn = eyewearWornIn();
    if (!worn) return;                              // no shades owned — bare eyes
    const out = [];
    const parts = eyewearParts(worn);
    if (parts) for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      mountEyewearMesh(p.kind, rig.neck, p.mat, p.x, p.y, p.z, out);
    }
    if (out.length) rig._cpEyewear = out;
  }

  // ============================================================
  //  DRESS THE PORTRAIT IN THE PLAYER'S ACTUAL WORN CLOTHING.
  //
  //  THE BUG: the portrait dressed only via cityApplyComposite(g.cityFit) —
  //  but g.cityFit is just the COMPOSITE BASE (a shirt color + jean legs + a
  //  list of owned blazer/tie/shirt visualIds). When the player wears a
  //  CATALOG fit — the tuxedo, a police/EMS/SWAT uniform, gang colors, a
  //  business suit, a hoodie/tracksuit, designer drip — that fit lives in
  //  g.cityWornOutfit and OVERRIDES the composite while worn (outfits.js
  //  applyPlayer → recolorRig(ch, w.colors, w)). The composite is empty/plain
  //  for everyone in a catalog fit, so the portrait body read BARE while the
  //  jewellery (mounted off the OWNED set, a separate axis) still showed.
  //
  //  FIX: dress the portrait off the SAME source of truth and the SAME paint
  //  path the live player rig uses. CBZ.cityOutfitGet() is the worn RECORD;
  //  CBZ.cityRecolorRig(rig, rec.colors, rec) is exactly what applyPlayer
  //  calls — it routes composites → cityApplyComposite, painted catalog fits
  //  (tux/cop) → cityApplyClothes, flat fits → flat tint, AND mounts/clears
  //  the gang bandana. We then replay applyPlayer's player-only kit (hide jail
  //  stripes, paint the belt, show the badge; the role hat comes from
  //  recolorRig itself) so a uniform/tux portrait reads identically to the in-world body.
  //  No parallel wardrobe — we call the engine's own dress functions.
  // ============================================================
  function portraitHasStructuredCollar(w) {
    const compItems = w && w.composite && Array.isArray(w.composite.items) ? w.composite.items : null;
    const outfitId = String(w && (w.id || w.name) || "");
    return !!(w && w.cop ||
      /collar|blazer|jacket|bomber|tie|tux|suit|uniform|coat|puffer|tracksuit|varsity/i.test(outfitId) ||
      (compItems && compItems.some(function (id) {
        return /collar|blazer|jacket|bomber|tie|tux|suit/i.test(String(id || ""));
      })));
  }
  function dressPortrait(rig) {
    if (!rig || !rig.skinSlots) return;
    // use the EFFECTIVE worn record (mirrors applyPlayer's PLAIN_BASE->composite
    // substitution) so a default player's portrait matches the live body's white-tee
    // composite, not the raw grey 'street' base. Falls back to the raw worn record.
    const w = ((CBZ.cityOutfitGetEffective && CBZ.cityOutfitGetEffective()) ||
               (CBZ.cityOutfitGet && CBZ.cityOutfitGet())) || null;
    if (w && w.colors && CBZ.cityRecolorRig) {
      // the worn record — catalog fit OR the player's composite, whichever is
      // active — painted through the player's exact recolor path.
      CBZ.cityRecolorRig(rig, w.colors, w);
    } else {
      // fallback: the raw composite (engine primitives mid-load / no record yet)
      const f = g.cityFit;
      if (CBZ.cityApplyComposite && f && typeof f === "object") {
        CBZ.cityApplyComposite(rig, { shirt: f.shirt, legs: f.legs, items: Array.isArray(f.items) ? f.items.slice() : [] });
      }
    }
    // replay applyPlayer's player-only kit so cop/tux/uniform portraits match
    const s = rig.skinSlots;
    const setP = function (list, color, vis) {
      if (!list) return;
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        if (!m) continue;
        if (color != null) CBZ.paintMesh(m, color);
        if (vis != null) m.visible = vis;
      }
    };
    const cop = !!(w && w.cop);
    const beltHex = (w && w.colors && w.colors.belt != null) ? w.colors.belt : 0x17191f;
    // The base rig's broad collar box is useful under a uniform/jacket, but on
    // a plain tee it reads as a rigid white ring around the neck. Composite
    // clothing that actually includes a collar/jacket keeps it; a bare tee does
    // not. This is the portrait-only copy — the player's worn record remains
    // the single clothing source of truth.
    // A DRESSED YOKE IS A GARMENT, NOT A RING. clothes.js paints the shoulder
    // yoke with the outfit's own cloth now (collar stand, neckline, lapel
    // wedges) and tags the mesh userData._cbzPart = "yoke". Hiding THAT would
    // take the collar off a suit in the portrait while the body in the world
    // still wears one — the same two-sources split this panel already closed
    // once by dressing through cityRecolorRig. So the name test only has to
    // answer for looks that were never painted at all; a painted yoke wins.
    const yokeDressed = !!(s.collar && s.collar[0] && s.collar[0].userData &&
                           s.collar[0].userData._cbzPart === "yoke");
    const structuredCollar = yokeDressed || portraitHasStructuredCollar(w);
    setP(s.stripes, null, false);          // no city fit has jail stripes
    setP(s.belt, beltHex, true);
    setP(s.collar, null, structuredCollar);
    setP(s.badge, null, cop);              // the badge rides the uniform
    // (the role hat was already put on by cityRecolorRig -> outfits.js roleHat,
    // the same headwear.js call the live body gets; the hair stays under it)
  }

  // ============================================================
  //  THE OFFSCREEN PORTRAIT — a dedicated rig + scene + renderer.
  //  Built once, lazily, and only in the city. Redraws ONLY when the
  //  panel is visible AND the look/level signature changed.
  // ============================================================
  const PORT = {
    ready: false, broken: false,
    rend: null, scene: null, cam: null, rig: null, light: null,
    sig: "", spin: 0,
  };

  function buildPortrait() {
    if (PORT.ready || PORT.broken) return PORT.ready;
    if (!THREE || !CBZ.makeCharacter) return false;
    try {
      const rend = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
      rend.setPixelRatio(1);
      rend.setClearColor(0x000000, 0);
      const scene = new THREE.Scene();
      const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
      // a flat, friendly key + fill so the painted fabric reads
      const amb = new THREE.AmbientLight(0xffffff, 0.92);
      const key = new THREE.DirectionalLight(0xffffff, 0.7);
      key.position.set(0.6, 1.4, 1.2);
      const rim = new THREE.DirectionalLight(0x9fc0ff, 0.32);
      rim.position.set(-1.0, 0.6, -0.8);
      scene.add(amb, key, rim);

      // a plain player-skin rig — recolored each redraw to match g.cityFit
      const rig = CBZ.makeCharacter({
        legs: 0x39414f, torso: 0xf2f2f2, collar: 0xf2f2f2, arms: 0xf2f2f2,
        skin: 0xf0c39a, hair: 0x4a3526, shoes: 0x2b2b2b,
      });
      rig.group.position.y = 0;
      rig._inkFrom = "player";          // the portrait wears the player's own ink (entities/tattoo.js)
      scene.add(rig.group);

      PORT.rend = rend; PORT.scene = scene; PORT.cam = cam; PORT.rig = rig;
      PORT.ready = true;
      return true;
    } catch (e) { PORT.broken = true; return false; }
  }

  // current look/level signature — cheap string; an unchanged look = no redraw.
  // The WORN look is NOT just g.cityFit (the composite base): a CATALOG fit
  // (tuxedo / police uniform / gang colors / a business suit) lives in
  // g.cityWornOutfit and overrides the composite while worn — so the signature
  // MUST key off the worn RECORD (id + its cloth colors), or putting a tuxedo on
  // (which leaves g.cityFit untouched) would never trigger a portrait redraw.
  function lookSig() {
    const f = g.cityFit || {};
    const items = Array.isArray(f.items) ? f.items.join(",") : "";
    const lvl = CBZ.cityPlayerLevel ? CBZ.cityPlayerLevel() : 0;
    // worn jewellery influences the read too (informational on the portrait)
    const j = (blingWornIn("neck") || "") + "|" + (blingWornIn("wristL") || "") + "|" + (blingWornIn("ring") || "");
    // worn armour (vest/plate/helmet) — so strapping a kit on redraws the portrait
    const arm = armorSig();
    // worn eyewear (sunglasses/designer shades) — so putting shades on redraws too
    const eye = eyewearWornIn() || "";
    // the WORN catalog/composite record — what's actually painted onto the body
    const w = (CBZ.cityOutfitGet && CBZ.cityOutfitGet()) || null;
    let ws = "";
    if (w) {
      const c = w.colors || {};
      const ci = w.composite && Array.isArray(w.composite.items) ? w.composite.items.join(",") : "";
      ws = (w.id || "") + "/" + (c.torso || 0) + "/" + (c.legs || 0) + "/" + (c.collar || 0) +
           "/" + (c.arms || 0) + "/" + (c.shoes || 0) + "/" + (c.gloss ? 1 : 0) + "/" + (w.gang || "") +
           "/" + (w.cop ? 1 : 0) + "/" + ci +
           // pattern + name: two pinstripe/checked suits can share every hashed
           // color — without these the portrait kept a stale flat-suit render
           // while the body wore the patterned one (owner bug).
           "/" + (w.pattern || "") + "/" + (w.name || "") +
           // PAINTED-SUIT STYLE INDEX. clothes.js resolves "suit" to one of 22
           // SUIT_STYLES; outfits.js now pins the chosen index onto the worn
           // record (see its pinSuitStyle note — that pin is the actual fix for
           // "the portrait's suit is a different colour than the character").
           // Hashing it here means changing suits inside the same catalog id
           // still forces a portrait redraw.
           "/" + (w.style != null ? w.style : "-");
    }
    // outfit revision (outfits.js applyPlayer bumps it on EVERY application) —
    // catches swiped fits / same-record re-dresses the field hash can't see.
    const rev = CBZ.cityOutfitRev || 0;
    return (f.shirt || 0) + ":" + (f.legs || 0) + ":" + items + ":" + lvl + ":" + j + ":" + ws + ":" + arm + ":" + eye + ":" + rev;
  }

  // dress the portrait rig exactly like the player and render one frame
  function drawPortrait(canvas, px) {
    if (!buildPortrait() || !canvas) return;
    // dress the rig in the player's ACTUAL worn clothing (catalog fit OR the
    // composite — whichever is active), via the player's own paint path.
    dressPortrait(PORT.rig);
    // mount the player's WORN jewellery (chains/watch/ring) onto the same rig —
    // re-seated only when the worn set changed (gated by lookSig's jewel field)
    applyPortraitJewelry(PORT.rig);
    applyPortraitArmor(PORT.rig);                   // + worn vest/plate/helmet (gated by lookSig's armor field)
    applyPortraitEyewear(PORT.rig);                 // + worn sunglasses/designer shades (gated by lookSig's eyewear field)
    // a calm front 3/4 view; gentle idle so it reads "live", not a freeze-frame
    const rig = PORT.rig;
    rig.group.rotation.y = -0.32;
    if (rig.neck) rig.neck.rotation.set(0, 0, 0);
    // frame the upper body — the fit is what we're confirming. Framing scaled
    // by HUMAN_SCALE (0.70) to match the shrunk ~1.82m rig: the rig scales about
    // its feet (y=0), so scaling cam height + distance by the same 0.70 keeps the
    // exact composition (character no longer sits small/low in the card).
    PORT.cam.position.set(0, 1.64, 3.92);
    PORT.cam.lookAt(0, 1.40, 0);

    PORT.rend.setSize(px, px, false);
    if (canvas.width !== px || canvas.height !== px) { canvas.width = px; canvas.height = px; }
    PORT.rend.render(PORT.scene, PORT.cam);
    // blit the offscreen render onto the visible 2D canvas
    const ctx = canvas.getContext("2d");
    if (ctx) { ctx.clearRect(0, 0, px, px); ctx.drawImage(PORT.rend.domElement, 0, 0, px, px); }
  }

  // ============================================================
  //  STYLES (self-mounted once)
  // ============================================================
  function ensureCss() {
    if (CBZ.itemIconCss) { try { CBZ.itemIconCss(); } catch (e) {} }   // shared item-icon sizing
    if (document.getElementById("cpCss")) return;
    const st = document.createElement("style");
    st.id = "cpCss";
    st.textContent =

      // full-screen inventory overlay
      "#cpInv{position:fixed;inset:0;z-index:120;display:none;align-items:center;justify-content:center;background:rgba(4,6,10,.72);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);font-family:inherit;color:#e8ecf2}" +
      "#cpInv .cpWrap{display:flex;gap:18px;max-width:880px;width:calc(100% - 48px);max-height:calc(100% - 48px);padding:20px 22px;background:rgba(10,13,20,.92);border:1px solid rgba(232,236,242,.14);border-radius:16px;box-shadow:0 18px 60px rgba(0,0,0,.6)}" +
      "#cpInv .cpLeft{flex:none;width:240px;display:flex;flex-direction:column;align-items:center}" +
      "#cpInv .cpTitle{width:100%;font-size:15px;font-weight:800;letter-spacing:.6px;color:#fff;margin-bottom:2px}" +
      "#cpInv .cpSub{width:100%;font-size:11px;color:#9fb0c6;margin-bottom:10px}" +
      "#cpInv .cpBigCanvasWrap{width:230px;height:300px;border-radius:12px;background:radial-gradient(ellipse at 50% 36%,rgba(60,74,98,.4),rgba(8,11,17,0) 72%);border:1px solid rgba(232,236,242,.1)}" +
      "#cpInv .cpBigCanvasWrap canvas{display:block;width:230px;height:300px}" +
      "#cpInv .cpRight{flex:1;min-width:0;display:flex;flex-direction:column;gap:14px;overflow:auto}" +
      "#cpInv .cpH{font-size:11px;font-weight:800;letter-spacing:1px;color:#9fb0c6;margin-bottom:6px;text-transform:uppercase}" +
      "#cpInv .cpAcc{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}" +
      "#cpInv .cpSlot{display:flex;flex-direction:column;gap:2px;min-height:52px;padding:7px 9px;border-radius:9px;background:rgba(255,255,255,.04);border:1px solid rgba(232,236,242,.1);cursor:pointer;transition:border-color .1s,background .1s}" +
      "#cpInv .cpSlot:hover{border-color:rgba(125,231,255,.5);background:rgba(125,231,255,.08)}" +
      "#cpInv .cpSlot.empty{opacity:.55;cursor:default}" +
      "#cpInv .cpSlot.empty:hover{border-color:rgba(232,236,242,.1);background:rgba(255,255,255,.04)}" +
      "#cpInv .cpSlot .sn{font-size:9px;letter-spacing:.6px;color:#7f8ba0;text-transform:uppercase;display:flex;align-items:center;gap:4px}" +
      "#cpInv .cpSlot .sv{font-size:12px;font-weight:700;color:#e8ecf2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      "#cpInv .cpSlot.worn{border-color:rgba(255,209,102,.45);background:rgba(255,209,102,.07)}" +
      "#cpInv .cpSlot.worn .sv{color:#ffd166}" +
      "#cpInv .cpGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(58px,1fr));gap:7px}" +
      "#cpInv .cpItem{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;height:58px;border-radius:9px;background:rgba(255,255,255,.04);border:1px solid rgba(232,236,242,.1);padding:4px}" +
      "#cpInv .cpItem .ic{font-size:20px;line-height:1.05}" +
      "#cpInv .cpItem .itemIcn{width:28px;height:28px}" +
      "#cpInv .cpItem .nm{font-size:8px;color:#9fb0c6;text-align:center;line-height:1.05;margin-top:2px;max-width:54px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      "#cpInv .cpItem .ct{position:absolute;right:3px;top:2px;font-size:9px;font-weight:800;color:#fff;background:rgba(8,11,17,.85);border-radius:6px;padding:0 4px}" +
      "#cpInv .cpEmpty{font-size:12px;color:#7f8ba0;padding:8px 2px}" +
      "#cpInv .cpBuild{display:flex;gap:6px;width:100%}" +
      "#cpInv .cpBuildBtn{flex:1;font-family:inherit;font-size:11px;font-weight:700;letter-spacing:.3px;color:#9fb0c6;background:rgba(255,255,255,.04);border:1px solid rgba(232,236,242,.12);border-radius:8px;padding:6px 4px;cursor:pointer;transition:border-color .1s,background .1s,color .1s}" +
      "#cpInv .cpBuildBtn:hover{border-color:rgba(125,231,255,.5);color:#e8ecf2}" +
      "#cpInv .cpBuildBtn.active{border-color:rgba(255,209,102,.55);background:rgba(255,209,102,.1);color:#ffd166}" +
      "#cpInv .cpClose{margin-top:10px;font-size:11px;color:#7f8ba0;text-align:center}" +
      "#cpInv .cpClose b{color:#9fb0c6}";
    document.head.appendChild(st);
  }

  // (CUT 2026-09-27, HUD PURGE: the persistent top-left CHARACTER CARD,
  //  portrait, Lv/title, stars, bounty, net worth and an "[I] Inventory
  //  [Shift+O] Hide" key legend, sat on screen for the whole session. The
  //  mirror moved where it belongs: the [I] inventory overlay below draws the
  //  same portrait big, and the world shows the rest.)
  let hudHidden = false;

  // ============================================================
  //  [I] INVENTORY OVERLAY DOM
  // ============================================================
  let inv = null, invBigCanvas = null, invAcc = null, invGrid = null, invBuild = null;
  let invOpen = false, invBigSig = "";

  // The LOOT_ICON / ITEM_ICON glyph tables that used to sit here were the THIRD
  // copy of the same idea, and (like the other three) the repo-wide emoji strip
  // had emptied every entry to "" — so this grid drew a blank box for every item
  // you owned. Faces come from city/itemicons.js now, drawn from the item's KIND
  // so runtime registrations (species meat, pelts, the fishing catch) are covered
  // too. Degrade-safe: no module -> the old blank, exactly as before.
  function itemFace(name, row) {
    if (CBZ.itemIconHtml) { const h = CBZ.itemIconHtml(name, row, "md"); if (h) return h; }
    return "<div class='ic'></div>";
  }

  function buildInv() {
    if (inv) return;
    ensureCss();
    inv = document.createElement("div");
    inv.id = "cpInv";
    inv.innerHTML =
      "<div class='cpWrap'>" +
      "<div class='cpLeft'>" +
      "<div class='cpTitle'>CHARACTER</div>" +
      "<div class='cpSub'></div>" +
      "<div class='cpBigCanvasWrap'><canvas width='230' height='300'></canvas></div>" +
      "<div class='cpH' style='margin-top:10px'>Build</div>" +
      "<div class='cpBuild'>" +
      "<button type='button' class='cpBuildBtn' data-build='m'>Male</button>" +
      "<button type='button' class='cpBuildBtn' data-build='f'>Female</button>" +
      "</div>" +
      "<div class='cpClose'><b>[I]</b> / <b>[Esc]</b> to close</div>" +
      "</div>" +
      "<div class='cpRight'>" +
      "<div><div class='cpH'>Worn</div><div class='cpAcc'></div></div>" +
      "<div><div class='cpH'>Carried</div><div class='cpGrid'></div></div>" +
      "</div>" +
      "</div>";
    document.body.appendChild(inv);
    invBigCanvas = inv.querySelector("canvas");
    invAcc = inv.querySelector(".cpAcc");
    invGrid = inv.querySelector(".cpGrid");
    invBuild = inv.querySelector(".cpBuild");
    // INVENTORY V2 (city/inventory.js): the Carried grid becomes the live
    // Minecraft-style 27-slot grid — the module binds its own click handlers.
    if (CBZ.CONFIG && CBZ.CONFIG.INVENTORY_V2 !== false && CBZ.cityInventory && CBZ.cityInventory.attach) {
      CBZ.cityInventory.attach(invGrid);
    }
    // a click on the dim backdrop (outside the wrap): with an item held on the
    // V2 cursor it DROPS the stack to the ground (Minecraft rule); else closes.
    inv.addEventListener("click", function (e) {
      if (e.target !== inv) return;
      const ci = CBZ.cityInventory;
      if (CBZ.CONFIG && CBZ.CONFIG.INVENTORY_V2 !== false && ci && ci.hasCursor && ci.hasCursor()) { ci.dropCursorToGround(); return; }
      closeInv();
    });
    // BUILD toggle (W4): Male/Female — persists + reloads via CBZ.setPlayerBuild
    if (invBuild) invBuild.addEventListener("click", function (e) {
      const btn = e.target.closest && e.target.closest(".cpBuildBtn");
      if (!btn) return;
      e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      if (CBZ.setPlayerBuild) CBZ.setPlayerBuild(btn.dataset.build);
    });
  }

  // highlight the active build button (reads CBZ.getPlayerBuild(), set at boot)
  function renderBuild() {
    if (!invBuild) return;
    const cur = (CBZ.getPlayerBuild && CBZ.getPlayerBuild()) || "m";
    const btns = invBuild.querySelectorAll(".cpBuildBtn");
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      b.classList.toggle("active", b.dataset.build === cur);
    }
  }

  function renderAcc() {
    if (!invAcc) return;
    let html = "";
    for (let i = 0; i < SLOTS.length; i++) {
      const def = SLOTS[i];
      const label = slotLabel(def);
      const worn = !!label;
      // only CLOTH slots are clickable (jewellery is auto-worn by bling.js)
      const clickable = !!def.cloth;
      const cls = "cpSlot" + (worn ? " worn" : " empty") + (worn && clickable ? " clk" : "");
      html += "<div class='" + cls + "' data-slot='" + def.key + "' data-clickable='" + (clickable && worn ? 1 : 0) + "'>" +
        "<div class='sn'>" + def.icon + " " + esc(def.name) + "</div>" +
        "<div class='sv'>" + (worn ? esc(label) : "<span style='color:#5a6473'>—</span>") + "</div>" +
        "</div>";
    }
    invAcc.innerHTML = html;
  }

  function renderGrid() {
    if (!invGrid) return;
    // INVENTORY V2: the interactive slot grid renders itself (falls through to
    // the legacy read-only grid when the flag/module is off — one-line revert).
    if (CBZ.CONFIG && CBZ.CONFIG.INVENTORY_V2 !== false && CBZ.cityInventory && CBZ.cityInventory.renderPlayerGrid) {
      if (CBZ.cityInventory.renderPlayerGrid(invGrid)) return;
    }
    const econ = CBZ.cityEcon, items = econ && econ.ITEMS, invMap = g.cityInv || {};
    const rows = [];
    for (const name in invMap) {
      const n = invMap[name] | 0;
      if (n <= 0) continue;
      const it = items && items[name];
      rows.push({ name, n, it, face: itemFace(name, it), val: (it && it.value) || 0 });
    }
    if (!rows.length) { invGrid.innerHTML = "<div class='cpEmpty'>Empty, nothing carried.</div>"; return; }
    rows.sort((a, b) => (b.val - a.val) || (b.n - a.n));
    let html = "";
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      let tip = r.name;
      if (CBZ.itemTip) { try { tip = CBZ.itemTip(r.name, r.it, r.n); } catch (e) {} }
      html += "<div class='cpItem' title='" + esc(tip) + "'>" +
        (r.n > 1 ? "<div class='ct'>" + r.n + "</div>" : "") +
        r.face +
        "<div class='nm'>" + esc(r.name) + "</div></div>";
    }
    invGrid.innerHTML = html;
  }

  function renderInvAll() {
    if (!inv) return;
    const lvl = CBZ.cityPlayerLevel ? CBZ.cityPlayerLevel() : 1;
    const title = CBZ.cityPlayerTitle ? CBZ.cityPlayerTitle() : "";
    const sub = inv.querySelector(".cpSub");
    if (sub) sub.textContent = "Lv." + lvl + " " + title + "   " + fmt$(netWorth());
    renderAcc();
    renderGrid();
    renderBuild();
    // big portrait — redraw on look change (or first open)
    const sig = lookSig();
    if (sig !== invBigSig) { invBigSig = sig; drawBigPortrait(); }
  }

  // big portrait reuses the SAME offscreen rig, framed full-body
  function drawBigPortrait() {
    if (!buildPortrait() || !invBigCanvas) return;
    // dress in the player's actual worn clothing (catalog fit OR composite)
    dressPortrait(PORT.rig);
    applyPortraitJewelry(PORT.rig);                // worn chains/watch/ring on the big model too
    applyPortraitArmor(PORT.rig);                  // + worn vest/plate/helmet on the big model
    applyPortraitEyewear(PORT.rig);                // + worn sunglasses/designer shades on the big model
    PORT.rig.group.rotation.y = -0.3;
    // full-body framing scaled by HUMAN_SCALE (0.70) for the shrunk ~1.82m rig.
    PORT.cam.position.set(0, 1.40, 5.18);
    PORT.cam.lookAt(0, 1.09, 0);
    const W = 230, H = 300;
    PORT.cam.aspect = W / H; PORT.cam.updateProjectionMatrix();
    PORT.rend.setSize(W, H, false);
    PORT.rend.render(PORT.scene, PORT.cam);
    if (invBigCanvas.width !== W) invBigCanvas.width = W;
    if (invBigCanvas.height !== H) invBigCanvas.height = H;
    const ctx = invBigCanvas.getContext("2d");
    if (ctx) { ctx.clearRect(0, 0, W, H); ctx.drawImage(PORT.rend.domElement, 0, 0, W, H); }
    // restore the square aspect the small portrait expects
    PORT.cam.aspect = 1; PORT.cam.updateProjectionMatrix();
  }

  // a click inside the inventory: equip/unequip an accessory or fire a hotbar slot
  function onInvClick(e) {
    let n = e.target;
    // accessory slot
    let slotEl = n; while (slotEl && slotEl !== inv && !slotEl.dataset.slot) slotEl = slotEl.parentNode;
    if (slotEl && slotEl !== inv && slotEl.dataset.slot) {
      if (slotEl.dataset.clickable !== "1") return;     // empty / jewellery slot = informational
      const def = SLOTS.find((s) => s.key === slotEl.dataset.slot);
      if (!def || !def.cloth) return;
      const id = clothWornIn(def.cloth);
      if (id && CBZ.cityUnwear) { CBZ.cityUnwear(id); invBigSig = ""; renderInvAll(); }
      return;
    }
  }

  // ---- open / close the overlay (the city-panel convention) ----------------
  function openInv() {
    if (invOpen || !cityNow()) return;
    if (g.state !== "playing") return;
    buildInv();
    invOpen = true;
    CBZ.cityMenuOpen = true;
    try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) { /* ignore */ }
    if (CBZ.cityInventory && CBZ.cityInventory.onOpen) CBZ.cityInventory.onOpen();   // V2: resync slots vs truth
    invBigSig = "";                                    // force a fresh portrait
    renderInvAll();
    inv.style.display = "flex";
  }
  function closeInv() {
    if (!invOpen) return;
    invOpen = false;
    if (inv) inv.style.display = "none";
    if (CBZ.cityInventory && CBZ.cityInventory.onClose) CBZ.cityInventory.onClose(); // V2: stash cursor + persist
    CBZ.cityMenuOpen = false;
    if (CBZ.requestLock && g.state === "playing") CBZ.requestLock();
  }

  // ============================================================
  //  HIDE-HUD [O] — hide/show ALL city HUD for immersion (toggle via the
  //  verified-unbound [O] key or the on-panel [×] control; NOT [H], which
  //  heists.js / realestate.js / interact.js already own).
  // ============================================================
  function setHudHidden(on) {
    hudHidden = !!on;
    const cHud = document.getElementById("cityHud");
    if (cHud) cHud.style.display = hudHidden ? "none" : "";
  }

  // ============================================================
  //  KEY HANDLER — guarded like every city panel so it can't misfire
  // ============================================================
  // [I] NO LONGER OPENS ANYTHING. OWNER: "Inventory: only guns are cool...
  // All other inventory is dumb af. The button to open the inventory is dumb."
  // The one bar (systems/inventory.js #hotbar) is the inventory now; food and meds use
  // themselves (city/hunger.js), drugs are product the dealers read from
  // g.cityInv, clothes are worn at the clothing store's mirror. So the key is
  // gone rather than left opening a screen of things you can't do anything
  // with. open()/close() stay as harness seams; Esc still shuts it if one ran.
  window.addEventListener("keydown", function (e) {
    const k = (e.key || "").toLowerCase();
    if (invOpen) {
      if (k === "escape") {
        e.preventDefault();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        e.stopPropagation();
        closeInv();
      }
      return;
    }
    if (!cityNow() || g.state !== "playing") return;
    if (CBZ.cityMenuOpen) return;
    if (CBZ.fullMap && CBZ.fullMap.active) return;
    if (CBZ.player && CBZ.player.dead) return;
    if (k === "o" && e.shiftKey) {
      // [Shift+O] HIDE-HUD. Plain [O] falls through to playergang.js's crew menu.
      e.preventDefault();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      e.stopPropagation();
      setHudHidden(!hudHidden);
    }
  }, true);

  // ============================================================
  //  PER-FRAME maintenance — cheap; the portrait only redraws on change
  // ============================================================
  CBZ.onUpdate(37.2, function () {
    if (!cityNow()) {
      if (invOpen) closeInv();
      hudHidden = false;
      return;
    }
    // keep the open overlay's live readouts (hotbar/bounty) current
    if (invOpen) {
      // light refresh: meta + hotbar are cheap; the grid/acc redraw on demand
      const sub = inv.querySelector(".cpSub");
      if (sub) { const lvl = CBZ.cityPlayerLevel ? CBZ.cityPlayerLevel() : 1; sub.textContent = "Lv." + lvl + " " + (CBZ.cityPlayerTitle ? CBZ.cityPlayerTitle() : "") + "   " + fmt$(netWorth()); }
    }
  });

  // PRE-WARM during the title screen: the offscreen portrait renderer costs
  // ~1.3s to stand up (a WebGLRenderer). Building it while the player is still
  // reading the title keeps the first [I] open (and mugshot.js, which borrows
  // this renderer) from hitching.
  addEventListener("load", function () {
    setTimeout(function () { try { buildPortrait(); } catch (e) {} }, 2500);
  }, { once: true });

  // ---- public hooks (debug / harness) --------------------------------------
  CBZ.cityCharPanel = {
    open: openInv, close: closeInv,
    isOpen: function () { return invOpen; },
    hideHud: setHudHidden, hudHidden: function () { return hudHidden; },
    slots: function () { return SLOTS.map((s) => ({ key: s.key, worn: slotLabel(s) || null })); },
    portraitHasStructuredCollar: portraitHasStructuredCollar,
    // Read-only harness seam: proves that the actual 0.94-wide structural mesh
    // is hidden for collarless looks, rather than merely recoloured.
    portraitRig: function () { return PORT.rig || null; },
  };

  // ONE GL CONTEXT FOR EVERY OFFSCREEN PORTRAIT IN THE GAME. This renderer is
  // the expensive part (tools/perf-ab/LOG.md: building it cost a ~1.3s first-
  // frame hitch, which is why it is prewarmed on the title screen) and a
  // WebGLRenderer is scene-agnostic — it will draw anybody's scene. So
  // city/mugshot.js's photo booth borrows THIS one instead of standing up a
  // second context; it keeps its own scene/camera/rig and only asks us to
  // render. Returns null before the portrait exists (mugshot then builds its
  // own, exactly as it does when charpanel never loaded).
  CBZ.cityPortraitRenderer = function (build) {
    if (build !== false && !PORT.ready && !PORT.broken) buildPortrait();
    return PORT.ready ? PORT.rend : null;
  };
})();

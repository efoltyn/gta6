/* ============================================================
   systems/prisonoutfits.js — Prison Escape adopts the shared wardrobe.

   Gang City's police/SWAT outfits already solve the hard visual problems:
   painted garment structure, one cached atlas per fit, fitted jacket shells,
   clone-safe recolouring, caps/badges on the rig's real slots, and repairable
   material ownership. Direct Prison Escape used the same character rig but
   stopped at flat constructor colours. This file is the small domain adapter:
   it assigns penitentiary roles to canonical city/outfits.js records and sends
   the live player, guards and inmates through CBZ.cityRecolorRig.

   No second wardrobe, no copied armor mesh and no nearby display doubles. The
   people this dresses are the real CBZ.player/guards/npcs that patrol, fight,
   speak, die and reset in mode "escape". Medical and chapel looks are explicit
   assignments on entities/npc.js; everyone else stays in the same institutional
   orange. Riot reinforcements reuse the real Gang City SWAT record and armor
   API. PRISON_OUTFITS_V2=false leaves the original builders untouched next boot.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PRISON_OUTFITS_V2 == null) CBZ.CONFIG.PRISON_OUTFITS_V2 = true;
  function on() { return CBZ.CONFIG.PRISON_OUTFITS_V2 !== false; }

  const NPC_FIT = {
    inmate: "inmate",
    cap: "inmate_cap",
    orderly: "inmate_orderly",
    chapel: "inmate_chapel",
  };
  const REQUIRED = ["inmate", "inmate_cap", "inmate_orderly", "inmate_chapel", "corrections", "warden", "swat"];

  function catalog() {
    try { return CBZ.cityOutfitCatalog ? CBZ.cityOutfitCatalog() : null; } catch (e) { return null; }
  }
  function paint() { return CBZ.cityPaintSlot || null; }
  function staffFit(id) { return id === "corrections" || id === "warden" || id === "swat"; }

  function dressChar(ch, id) {
    if (!ch || !ch.skinSlots || !id || typeof CBZ.cityRecolorRig !== "function") return false;
    const cat = catalog(), rec = cat && cat[id];
    if (!rec || !rec.colors) return false;
    // A reset deliberately clears _prisonOutfitKey in entities/player.js. New
    // reinforcement/crowd rigs have no marker. Everybody else pays this once.
    if (ch._prisonOutfitKey === id && ch._clothesKey != null) return true;
    // Same canonical SWAT record, colors, carrier construction and fit used by
    // Gang City; only its rejected wordmark layer is disabled for the prison.
    const worn = id === "swat" ? Object.assign({}, rec, { id: "swat_unmarked" }) : rec;
    if (!CBZ.cityRecolorRig(ch, rec.colors, worn)) return false;

    // Constructor-era prison stripes/belts are separate geometry, outside the
    // painted atlas. Hide the old orange hoops on every fit; only staff keep a
    // physical duty belt. This goes through the wardrobe's clone-safe slot API
    // so a cached material can never recolour another actor's hands or shoes.
    const p = paint(), s = ch.skinSlots;
    if (p) {
      p(s.stripes, null, false);
      // Prison NPC LOD treats ch.detail as a bucket and normally unhides every
      // member when an actor comes close. Mark retired constructor stripes so
      // that canonical LOD can preserve this wardrobe decision instead of
      // resurrecting the old orange hoops after the first distance change.
      for (let i = 0; i < (s.stripes || []).length; i++) {
        const stripe = s.stripes[i];
        if (stripe) (stripe.userData || (stripe.userData = {}))._cbzDetailSuppressed = true;
      }
      p(s.belt, rec.colors.belt != null ? rec.colors.belt : 0x111419, staffFit(id));
      p(s.badge, null, !!rec.badge);
    }
    ch._prisonOutfitKey = id;
    return true;
  }

  function npcFit(n) {
    const role = n && n.prisonOutfit;
    return NPC_FIT[role] || "inmate";
  }
  function guardFit(g) {
    if (g && g.kind === "warden") return "warden";
    if (g && g._reinf) return "swat";
    return "corrections";
  }
  function dressGuard(g) {
    if (!g || !g.char) return false;
    const id = guardFit(g);
    const dressed = dressChar(g.char, id);
    // Riot responders are not a painted imitation of armor: mount the same
    // pooled carrier + helmet kit Gang City's SWAT actors wear. The marker
    // prevents the 0.30 s adoption sweep from remounting an unchanged kit.
    if (id === "swat" && typeof CBZ.cityArmorDressPed === "function" && g._prisonRiotArmorRig !== g.char) {
      CBZ.cityArmorDressPed(g, ["swatVest", "helmet"]);
      g._prisonRiotArmorRig = g.char;
    }
    return dressed;
  }
  function syncNow() {
    if (!on() || !CBZ.game || CBZ.game.mode !== "escape") return false;
    let changed = false;
    const playerId = CBZ.player && CBZ.player.role === "cop" ? "corrections" : "inmate";
    changed = dressChar(CBZ.playerChar, playerId) || changed;
    const guards = CBZ.guards || [];
    for (let i = 0; i < guards.length; i++) {
      const g = guards[i];
      if (g && g.char) changed = dressGuard(g) || changed;
    }
    const npcs = CBZ.npcs || [];
    for (let i = 0; i < npcs.length; i++) {
      const n = npcs[i];
      if (n && n.char) changed = dressChar(n.char, npcFit(n)) || changed;
    }
    return changed;
  }
  CBZ.prisonOutfitSyncNow = syncNow;

  // New reinforcements/crowd promotions can appear after boot; a throttled pass
  // adopts only unmarked rigs. The actual per-frame clothing repair remains the
  // wardrobe owner's job (outfits.js integritySweep), not this adapter's.
  let t = 0;
  CBZ.onUpdate(34.82, function (dt) {
    if (!on() || !CBZ.game || CBZ.game.mode !== "escape") return;
    t -= dt;
    if (t > 0) return;
    t = 0.30;
    syncNow();
  });

  function visibleSlotCount(ch, slot) {
    const list = ch && ch.skinSlots && ch.skinSlots[slot];
    if (!list) return 0;
    let n = 0;
    for (let i = 0; i < list.length; i++) if (list[i] && list[i].visible !== false) n++;
    return n;
  }
  function texturedGarments(ch) {
    if (!ch || !ch.skinSlots) return 0;
    const seen = new Set(), slots = ["torso", "collar", "arms", "armsLower", "legs", "legsLower"];
    let n = 0;
    for (let si = 0; si < slots.length; si++) {
      const list = ch.skinSlots[slots[si]] || [];
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        if (!m || seen.has(m) || m.visible === false) continue;
        seen.add(m);
        if (m.material && m.material.map) n++;
      }
    }
    const j = ch._jacketMesh;
    if (j && j.visible && j.material && j.material.map && !seen.has(j)) n++;
    return n;
  }
  function expectedFor(actor, kind) {
    if (kind === "player") return actor && actor.role === "cop" ? "corrections" : "inmate";
    if (kind === "guard") return guardFit(actor);
    return npcFit(actor);
  }

  // Runtime ratchet consumed by the visual preset and focused browser checks.
  // It proves ownership/coverage facts the screenshots cannot: every live real
  // rig has the expected canonical record and no constructor stripe survived.
  CBZ.prisonOutfitAudit = function () {
    const rows = [];
    if (CBZ.playerChar) rows.push({ actor: CBZ.player, ch: CBZ.playerChar, kind: "player" });
    for (const g of CBZ.guards || []) if (g && g.char) rows.push({ actor: g, ch: g.char, kind: "guard" });
    for (const n of CBZ.npcs || []) if (n && n.char) rows.push({ actor: n, ch: n.char, kind: "npc" });
    let styled = 0, mismatched = 0, stripesVisible = 0, textured = 0;
    let riotActors = 0, riotSwatFits = 0, riotArmored = 0;
    const variants = {};
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], expected = expectedFor(r.actor, r.kind), actual = r.ch._prisonOutfitKey || "";
      variants[expected] = (variants[expected] || 0) + 1;
      if (actual) styled++;
      if (actual !== expected) mismatched++;
      stripesVisible += visibleSlotCount(r.ch, "stripes");
      textured += texturedGarments(r.ch);
      if (r.kind === "guard" && r.actor && r.actor._reinf) {
        riotActors++;
        if (actual === "swat") riotSwatFits++;
        if (r.actor._armorMeshes && r.actor._armorMeshes.length) riotArmored++;
      }
    }
    const cat = catalog();
    let records = 0;
    for (let i = 0; i < REQUIRED.length; i++) if (cat && cat[REQUIRED[i]]) records++;
    return {
      enabled: on() ? 1 : 0,
      actors: rows.length,
      styled: styled,
      mismatched: mismatched,
      stripesVisible: stripesVisible,
      texturedMeshes: textured,
      variants: variants,
      riotActors: riotActors,
      riotSwatFits: riotSwatFits,
      riotArmored: riotArmored,
      requiredRecords: REQUIRED.length,
      records: records,
      canonicalWardrobe: (typeof CBZ.cityOutfitFor === "function" && typeof CBZ.cityRecolorRig === "function" &&
        typeof CBZ.cityApplyClothes === "function") ? 1 : 0,
    };
  };
})();

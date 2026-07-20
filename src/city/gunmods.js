/* ============================================================
   city/gunmods.js — WEAPON ATTACHMENTS (scopes · mags · silencer · grips).

   WHY: a gun store that only sells the gun is half a gun store. Ammu-Nation's
   real fantasy is the WORKBENCH — you walk in with an AK and walk out with a
   scoped, suppressed, drum-fed AK that YOU built. This module is that bench.
   It owns:

     • the ATTACHMENT CATALOG — real optics (red-dot, reflex, holographic,
       4× ACOG, 8× sniper scope, 6× thermal), extended + drum mags, a
       suppressor, a muzzle brake, a foregrip and a laser sight — each priced,
       each with a compatibility rule (a sniper scope doesn't bolt onto a
       pistol; a drum mag is for autos, not a bolt gun).
     • the fitted-mod STATE per owned weapon (g.cityGunMods[weaponId]).
     • the gameplay EFFECTS, exposed as the tiny hooks systems/fpsmode.js reads
       every shot: gunModsMag (bigger clips), gunModsSuppressed (killed flash +
       muffled report + quieter alarm), gunModsRecoilMul / gunModsSpreadMul
       (brake/grip/laser tighten the gun), and gunModsScopeOf (which optic →
       city/scopeview.js does the zoom + overlay).
     • the VISUAL: real child meshes bolted onto the held gun (the scope tube on
       the rail, the can on the muzzle, the grip under the barrel) so what you
       bought is what you SEE — first person, third person, every instance.
     • the GUNSMITH BENCH menu the gun store opens ([E] at the bench).

   Self-contained + city-gated: no effect (all muls === 1, supp false) when
   nothing's fitted or this file never loaded, so jail/survival stay identical.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  // ---- weapon groups (compatibility) ---------------------------------------
  const PISTOLS = { sidearm: 1, revolver: 1, deagle: 1 };
  const SMGS = { smg: 1, uzi: 1 };
  const RIFLES = { carbine: 1, ak47: 1 };
  const MG = { lmg: 1 };
  const SNIPERS = { sniper: 1 };
  const SHOTGUNS = { shotgun: 1 };
  const NOMOD = { bazooka: 1, taser: 1, grenade: 1 };   // launcher / stun / thrown take nothing

  function isFirearm(id) { return !!id && !NOMOD[id]; }

  // ---- the catalog ---------------------------------------------------------
  // slot: only one mod per slot at a time (a new buy replaces the old one).
  // fits(id): true when this mod can bolt onto weapon `id`.
  // Effect fields are read by the hooks below.
  const MODS = {
    // ---- OPTICS (slot "scope") — fov is the aimed-lens the scope forces ----
    reddot:  { id: "reddot",  name: "Red Dot Sight",        slot: "scope", price: 900,
               blurb: "1× illuminated dot — fast target pickup, tiny zoom.",
               scope: { fov: 42, overlay: "dot",    tint: "#ff5b5b" },
               fits: (id) => isFirearm(id) },
    reflex:  { id: "reflex",  name: "Reflex Sight",         slot: "scope", price: 1100,
               blurb: "1× open reflex — wide window, unlimited eye relief.",
               scope: { fov: 43, overlay: "reflex", tint: "#5bff8a" },
               fits: (id) => isFirearm(id) },
    holo:    { id: "holo",    name: "Holographic Sight",    slot: "scope", price: 1600,
               blurb: "1× holo ring + chevron — both eyes open, fastest CQB.",
               scope: { fov: 40, overlay: "holo",   tint: "#5bff8a" },
               fits: (id) => isFirearm(id) },
    acog:    { id: "acog",    name: "Tactical Scope · 4×",  slot: "scope", price: 2800,
               blurb: "4× prism (ACOG) — mid-range precision, chevron reticle.",
               scope: { fov: 26, overlay: "acog",   tint: "#ffcf5b" },
               fits: (id) => SMGS[id] || RIFLES[id] || MG[id] || SNIPERS[id] },
    sniper:  { id: "sniper",  name: "Sniper Scope · 8×",    slot: "scope", price: 4500,
               blurb: "8× magnified — full scoped view + mil-dot crosshair.",
               scope: { fov: 11, overlay: "scope", highMag: true, tint: "#e8f4ff" },
               fits: (id) => RIFLES[id] || SNIPERS[id] || MG[id] },
    thermal: { id: "thermal", name: "Thermal Scope · 6×",   slot: "scope", price: 8000,
               blurb: "6× white-hot thermal — targets glow through the dark.",
               scope: { fov: 17, overlay: "scope", highMag: true, thermal: true, tint: "#ff9a3c" },
               fits: (id) => RIFLES[id] || SNIPERS[id] || MG[id] },

    // ---- MAGS (slot "mag") -------------------------------------------------
    extmag:  { id: "extmag",  name: "Extended Mag",         slot: "mag", price: 1200,
               blurb: "+50% capacity — fewer reloads mid-fight.",
               magMul: 1.5,
               fits: (id) => isFirearm(id) },
    drummag: { id: "drummag", name: "Drum Mag",             slot: "mag", price: 3000,
               blurb: "2.5× capacity — spray without breathing.",
               magMul: 2.5,
               fits: (id) => SMGS[id] || RIFLES[id] || MG[id] },

    // ---- MUZZLE (slot "muzzle") -------------------------------------------
    suppressor: { id: "suppressor", name: "Suppressor",     slot: "muzzle", price: 2200,
               blurb: "Kills the flash, muffles the shot, halves the noise — go quiet.",
               suppress: true, spreadMul: 0.96,
               fits: (id) => isFirearm(id) },
    brake:   { id: "brake",   name: "Muzzle Brake",         slot: "muzzle", price: 1400,
               blurb: "Vents gas up — cuts muzzle climb ~30%.",
               recoilMul: 0.7,
               fits: (id) => isFirearm(id) },

    // ---- UNDER-BARREL / RAIL (slot "under") -------------------------------
    grip:    { id: "grip",    name: "Tactical Grip",        slot: "under", price: 1000,
               blurb: "Foregrip — steadier hold, tighter cone.",
               recoilMul: 0.85, spreadMul: 0.9,
               fits: (id) => SMGS[id] || RIFLES[id] || MG[id] || SHOTGUNS[id] || SNIPERS[id] },
    laser:   { id: "laser",   name: "Laser Sight",          slot: "under", price: 1300,
               blurb: "Boresight laser — much tighter hip-fire.",
               spreadMul: 0.78,
               fits: (id) => isFirearm(id) },
  };
  const SLOTS = ["scope", "mag", "muzzle", "under"];
  const SLOT_LABEL = { scope: "Optic", mag: "Magazine", muzzle: "Muzzle", under: "Under-barrel" };

  // ---- fitted-mod state ----------------------------------------------------
  function store() { g.cityGunMods = g.cityGunMods || {}; return g.cityGunMods; }
  function recOf(id) {
    const s = store();
    if (!s[id]) s[id] = { scope: null, mag: null, muzzle: null, under: null };
    return s[id];
  }
  function has(id, modId) {
    const r = store()[id]; if (!r) return false;
    return r.scope === modId || r.mag === modId || r.muzzle === modId || r.under === modId;
  }
  function fitsWeapon(modId, id) { const m = MODS[modId]; return !!(m && id && m.fits(id)); }

  // ---- EFFECT HOOKS (read by systems/fpsmode.js every shot / reload) -------
  CBZ.gunModsMag = function (id, base) {
    const r = store()[id]; if (!r || !r.mag) return base;
    const m = MODS[r.mag]; if (!m || !m.magMul) return base;
    return Math.max(1, Math.round(base * m.magMul));
  };
  CBZ.gunModsSuppressed = function (id) {
    const r = store()[id]; if (!r || !r.muzzle) return false;
    return !!(MODS[r.muzzle] && MODS[r.muzzle].suppress);
  };
  CBZ.gunModsRecoilMul = function (id) {
    const r = store()[id]; if (!r) return 1;
    let k = 1;
    if (r.muzzle && MODS[r.muzzle] && MODS[r.muzzle].recoilMul) k *= MODS[r.muzzle].recoilMul;
    if (r.under && MODS[r.under] && MODS[r.under].recoilMul) k *= MODS[r.under].recoilMul;
    return k;
  };
  CBZ.gunModsSpreadMul = function (id) {
    const r = store()[id]; if (!r) return 1;
    let k = 1;
    SLOTS.forEach((sl) => { const mid = r[sl]; if (mid && MODS[mid] && MODS[mid].spreadMul) k *= MODS[mid].spreadMul; });
    return k;
  };
  // the fitted optic spec (or null) — city/scopeview.js drives the zoom+overlay
  CBZ.gunModsScopeOf = function (id) {
    const r = store()[id]; if (!r || !r.scope) return null;
    const m = MODS[r.scope]; if (!m || !m.scope) return null;
    return Object.assign({ id: m.id, name: m.name }, m.scope);
  };
  // read-only view of what's fitted (for HUD / bench)
  CBZ.gunModsEquipped = function (id) { const r = store()[id]; return r ? { scope: r.scope, mag: r.mag, muzzle: r.muzzle, under: r.under } : { scope: null, mag: null, muzzle: null, under: null }; };
  CBZ.gunModsSpec = function (modId) { return MODS[modId] || null; };
  CBZ.gunModsFits = fitsWeapon;

  // ==========================================================================
  //  VISUAL — bolt real child meshes onto the held gun
  // ==========================================================================
  const M = {};   // shared materials
  const GEO = {}; // shared geometry cache
  function mats() {
    if (M._ready || !THREE) return M;
    const mk = (o) => { const m = new THREE.MeshLambertMaterial(o); m._shared = true; return m; };
    M.dark = mk({ color: 0x14171c });
    M.steel = mk({ color: 0x3a424c });
    M.can = mk({ color: 0x1a1d22 });
    M.lensRed = mk({ color: 0x2a0000, emissive: 0xff4d4d, emissiveIntensity: 0.9 });
    M.lensGreen = mk({ color: 0x00220f, emissive: 0x4dff86, emissiveIntensity: 0.9 });
    M.lensAmber = mk({ color: 0x231600, emissive: 0xffc24d, emissiveIntensity: 0.85 });
    M.lensCyan = mk({ color: 0x00201f, emissive: 0x6fe6ff, emissiveIntensity: 0.85 });
    M.laser = (function () { const m = new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.35 }); m._shared = true; return m; })();
    M._ready = true;
    return M;
  }
  function cyl(r, len, m) {
    const k = "c" + r.toFixed(3) + "_" + len.toFixed(3);
    let ggeo = GEO[k];
    if (!ggeo) { ggeo = GEO[k] = new THREE.CylinderGeometry(r, r, len, 12); }
    const mesh = new THREE.Mesh(ggeo, m);
    mesh.rotation.x = Math.PI / 2;   // length runs along local Z (the bore axis)
    mesh.castShadow = false;
    return mesh;
  }
  function box(w, h, d, m) {
    const k = "b" + w.toFixed(3) + "_" + h.toFixed(3) + "_" + d.toFixed(3);
    let gg = GEO[k];
    if (!gg) { gg = GEO[k] = new THREE.BoxGeometry(w, h, d); }
    const mesh = new THREE.Mesh(gg, m); mesh.castShadow = false; return mesh;
  }
  function lensMat(tint) {
    if (tint === "#5bff8a") return M.lensGreen;
    if (tint === "#ffcf5b" || tint === "#ffc24d") return M.lensAmber;
    if (tint === "#e8f4ff" || tint === "#ff9a3c") return M.lensCyan;
    return M.lensRed;
  }

  // build the attachment child-group for a weapon id from its fitted record,
  // using the model's own barrel-tip (userData.muzzle) so it sits right on ANY
  // appearance factory. `pistol` shrinks everything for the little frames.
  function buildAttachGroup(id, model) {
    const r = store()[id]; if (!r) return null;
    if (!r.scope && !r.mag && !r.muzzle && !r.under) return null;
    mats();
    const grp = new THREE.Group();
    grp.name = "_gmods";
    const mz = (model.userData && model.userData.muzzle) || new THREE.Vector3(0, 0.05, -0.6);
    const pistol = !!PISTOLS[id];
    const sK = pistol ? 0.72 : 1;
    const barrelY = mz.y;
    const railY = barrelY + (pistol ? 0.055 : 0.085);
    const railZ = mz.z * (pistol ? 0.5 : 0.26);

    // ---- OPTIC on the top rail — shared with the sniper's factory glass ----
    if (r.scope && MODS[r.scope]) {
      const sp = MODS[r.scope].scope || {};
      const high = !!sp.highMag;
      const rTube = (high ? 0.05 : 0.036) * sK;
      const len = (high ? 0.34 : 0.15) * sK;
      if (CBZ.createWeaponOptic) {
        grp.add(CBZ.createWeaponOptic({
          name: "fitted-" + r.scope, x: 0, y: railY, z: railZ,
          length: len, radius: rTube, highMag: high, tint: sp.tint,
          materials: { dark: M.dark, steel: M.steel },
        }));
      }
    }

    // ---- MUZZLE device (suppressor OR brake) ----
    if (r.muzzle && MODS[r.muzzle]) {
      const supp = !!MODS[r.muzzle].suppress;
      const rs = (pistol ? 0.03 : 0.045);
      const len = supp ? (pistol ? 0.13 : 0.2) : (pistol ? 0.07 : 0.09);
      const can = cyl(rs, len, M.can);
      can.position.set(mz.x, mz.y, mz.z - len / 2 + 0.01);
      grp.add(can);
      if (!supp) { // brake: a couple of ported rings
        const ring = cyl(rs * 1.15, 0.02, M.steel); ring.position.set(mz.x, mz.y, mz.z - len + 0.01); grp.add(ring);
      }
    }

    // ---- UNDER-BARREL (grip OR laser) ----
    if (r.under && MODS[r.under]) {
      if (r.under === "grip") {
        const grip = box(0.045, 0.16 * sK, 0.05, M.dark);
        grip.position.set(0, barrelY - 0.11 * sK, mz.z * 0.6);
        grp.add(grip);
      } else if (r.under === "laser") {
        const unit = box(0.04, 0.03, 0.06, M.dark);
        unit.position.set(0.035, railY - 0.02, railZ);
        grp.add(unit);
        const dot = box(0.012, 0.012, 0.012, M.lensRed);
        dot.position.set(0.035, railY - 0.02, railZ - 0.035);
        grp.add(dot);
        // a faint boresight beam down the bore (rides the gun so it points true)
        const beam = cyl(0.004, 6, M.laser);
        beam.position.set(mz.x, mz.y, mz.z - 3);
        grp.add(beam);
      }
    }
    return grp;
  }

  function dressModel(model, id) {
    if (!model) return;
    const old = model.getObjectByName && model.getObjectByName("_gmods");
    if (old) model.remove(old);
    // A fitted optic replaces the sniper's factory scope instead of clipping
    // through it. Removing the mod restores the complete factory optic.
    const baseOptic = model.getObjectByName && model.getObjectByName("_baseOptic");
    const rec = store()[id];
    if (baseOptic) baseOptic.visible = !(rec && rec.scope);
    const grp = buildAttachGroup(id, model);
    if (grp) model.add(grp);
  }
  // (re)build the child meshes for one weapon slot on BOTH the FP viewmodel and
  // the 3PS carried gun.
  function dressIndex(i) {
    const vm = CBZ.fpsWeaponModels, cm = CBZ.fpsCarriedModels, idOf = CBZ.fpsWeaponIdOf;
    if (!vm || !cm || !idOf) return;
    const id = idOf(i); if (!id) return;
    dressModel(vm[i], id);
    dressModel(cm[i], id);
  }
  function dressAll() {
    const n = CBZ.fpsWeaponCount ? CBZ.fpsWeaponCount() : 0;
    for (let i = 0; i < n; i++) dressIndex(i);
  }
  CBZ.gunModsDress = dressIndex;
  CBZ.gunModsDressAll = dressAll;
  function dressWeaponId(id) {
    const n = CBZ.fpsWeaponCount ? CBZ.fpsWeaponCount() : 0, idOf = CBZ.fpsWeaponIdOf;
    for (let i = 0; i < n; i++) if (idOf && idOf(i) === id) dressIndex(i);
  }

  // ==========================================================================
  //  BUYING
  // ==========================================================================
  function fmt$(n) { n = Math.round(n || 0); return "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function equippedGunId() {
    if (g && g.cityHolstered) return null;
    if (CBZ.playerArmed && !CBZ.playerArmed()) return null;
    return CBZ.currentWeaponId || null;
  }
  function gunLabel(id) { const w = CBZ.weaponById && CBZ.weaponById(id); return (w && w.label) || (id || "weapon"); }

  // buy `modId` for the CURRENTLY equipped gun. Returns true on success.
  CBZ.gunModsBuy = function (modId) {
    const m = MODS[modId];
    if (!m || !CBZ.city) return false;
    const id = equippedGunId();
    if (!id) { CBZ.city.note("Draw a firearm first — mods bolt onto the gun in your hands.", 2.2); if (CBZ.sfx) CBZ.sfx("glass"); return false; }
    if (!m.fits(id)) { CBZ.city.note("A " + m.name + " won't fit the " + gunLabel(id) + ".", 2.2); if (CBZ.sfx) CBZ.sfx("glass"); return false; }
    const r = recOf(id);
    if (r[m.slot] === modId) { CBZ.city.note("The " + gunLabel(id) + " already wears a " + m.name + ".", 1.8); return false; }
    if (!CBZ.city.spend(m.price)) { CBZ.city.note("The " + m.name + " runs " + fmt$(m.price) + " — come back with the money.", 2.2); if (CBZ.sfx) CBZ.sfx("glass"); return false; }
    const replaced = r[m.slot] ? (MODS[r[m.slot]] || {}).name : null;
    r[m.slot] = modId;
    dressWeaponId(id);
    if (CBZ.fpsResyncAmmo) CBZ.fpsResyncAmmo();          // extended/drum mag → new capacity on the HUD
    if (CBZ.sfx) CBZ.sfx("coin");
    if (CBZ.city.addRespect) CBZ.city.addRespect(1);
    CBZ.city.note("Fitted the " + m.name + " to your " + gunLabel(id) + (replaced ? " (swapped the " + replaced + ")" : "") + ".", 2.4);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    renderBench();
    return true;
  };

  // the full priced catalog for the store bench (grouped by slot).
  CBZ.gunModsCatalog = function () {
    return Object.keys(MODS).map((k) => { const m = MODS[k]; return { id: m.id, name: m.name, slot: m.slot, slotLabel: SLOT_LABEL[m.slot], price: m.price, blurb: m.blurb }; });
  };

  // ==========================================================================
  //  THE GUNSMITH BENCH menu (opened from the gun store)
  // ==========================================================================
  let panel = null, benchList = [];
  function ensurePanel() {
    if (panel || typeof document === "undefined" || !document.body) return panel;
    const d = document.createElement("div");
    d.id = "gunsmithPanel";
    d.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;display:none;" +
      "width:min(560px,92vw);max-height:86vh;overflow:auto;background:rgba(13,16,21,.97);border:1px solid #3a4150;" +
      "border-radius:16px;padding:18px 18px 14px;color:#e8eef7;font-family:Fredoka,system-ui,sans-serif;" +
      "box-shadow:0 24px 60px rgba(0,0,0,.55)";
    document.body.appendChild(d);
    panel = d;
    return d;
  }
  function slotChip(equippedId) {
    if (!equippedId) return "<span style='color:#7f8794'>— empty —</span>";
    const m = MODS[equippedId];
    return "<span style='color:#7ed957'>" + (m ? m.name : equippedId) + "</span>";
  }
  function renderBench() {
    if (!panel || panel.style.display === "none") return;
    const id = equippedGunId();
    const eq = id ? CBZ.gunModsEquipped(id) : null;
    let html = "<div style='display:flex;justify-content:space-between;align-items:baseline;gap:10px'>" +
      "<div style='font-size:22px;font-weight:700'>Gunsmith Bench</div>" +
      "<div style='color:#9fb0c3;cursor:pointer' id='gsmithClose'>Close [Esc]</div></div>";
    if (!id) {
      html += "<p style='color:#ffb35b;margin:12px 0 4px'>You're not holding a firearm. Buy a gun off the wall (or draw one with the number keys), then step back to the bench — mods fit the weapon in your hands.</p>";
      panel.innerHTML = html;
      wireClose();
      return;
    }
    html += "<div style='color:#9fb0c3;margin:2px 0 12px'>Modding: <b style='color:#e8eef7'>" + gunLabel(id) + "</b></div>";
    // currently fitted
    html += "<div style='display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;margin-bottom:12px;font-size:13px'>";
    SLOTS.forEach((sl) => { html += "<div><span style='color:#7f8794'>" + SLOT_LABEL[sl] + ":</span> " + slotChip(eq[sl]) + "</div>"; });
    html += "</div>";
    // buyable list (only mods that fit this gun), grouped by slot, numbered 1..9
    benchList = [];
    SLOTS.forEach((sl) => {
      const inSlot = Object.keys(MODS).map((k) => MODS[k]).filter((m) => m.slot === sl && m.fits(id));
      if (!inSlot.length) return;
      html += "<div style='margin:10px 0 4px;color:#ffd166;font-weight:600;font-size:13px;letter-spacing:.04em;text-transform:uppercase'>" + SLOT_LABEL[sl] + "</div>";
      inSlot.forEach((m) => {
        const owned = eq[sl] === m.id;
        const n = benchList.length + 1;
        benchList.push(m.id);
        const affordable = CBZ.city && CBZ.city.canAfford && CBZ.city.canAfford(m.price);
        html += "<div class='gsmithRow' data-mod='" + m.id + "' style='display:flex;justify-content:space-between;align-items:center;gap:10px;" +
          "padding:8px 10px;margin:4px 0;border-radius:10px;cursor:pointer;background:" + (owned ? "rgba(126,217,87,.14)" : "rgba(255,255,255,.03)") + ";border:1px solid " + (owned ? "#3f7a45" : "#2a303a") + "'>" +
          "<div style='min-width:0'><div style='font-weight:600'>" + (n <= 9 ? "<span style='color:#7f8794'>[" + n + "]</span> " : "") + m.name +
          (owned ? " <span style='color:#7ed957;font-size:12px'>· fitted</span>" : "") + "</div>" +
          "<div style='color:#9fb0c3;font-size:12px'>" + m.blurb + "</div></div>" +
          "<div style='color:" + (affordable || owned ? "#7ed957" : "#ff7a7a") + ";font-weight:700;white-space:nowrap'>" + (owned ? "—" : fmt$(m.price)) + "</div></div>";
      });
    });
    html += "<div style='color:#7f8794;font-size:12px;margin-top:12px'>Click a mod or press its number to fit it. One per slot — a new optic/mag/muzzle swaps the old.</div>";
    panel.innerHTML = html;
    wireClose();
    panel.querySelectorAll(".gsmithRow").forEach((row) => {
      row.addEventListener("click", () => { const mid = row.getAttribute("data-mod"); if (mid) CBZ.gunModsBuy(mid); });
    });
  }
  function wireClose() {
    const c = panel.querySelector("#gsmithClose");
    if (c) c.addEventListener("click", closeBench);
  }
  function openBench() {
    if (!g || g.mode !== "city") return;
    ensurePanel();
    if (!panel) return;
    panel.style.display = "block";
    CBZ.cityMenuOpen = true;
    renderBench();
  }
  function closeBench() {
    if (panel) panel.style.display = "none";
    CBZ.cityMenuOpen = false;
  }
  CBZ.gunModsOpenBench = openBench;
  CBZ.gunModsCloseBench = closeBench;
  CBZ.gunModsBenchOpen = function () { return !!(panel && panel.style.display === "block"); };

  // bench keyboard: number keys buy, Esc/E close (capture so it wins over the
  // world). Only live while the panel is open.
  addEventListener("keydown", function (e) {
    if (!panel || panel.style.display !== "block") return;
    const k = (e.key || "").toLowerCase();
    if (k === "escape" || k === "e") { e.preventDefault(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); closeBench(); return; }
    if (/^[1-9]$/.test(k)) {
      const idx = parseInt(k, 10) - 1;
      if (idx < benchList.length) { e.preventDefault(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); CBZ.gunModsBuy(benchList[idx]); }
    }
  }, true);

  // ---- dress owned guns once the weapon models exist (idempotent) ----------
  let dressed = false;
  CBZ.onUpdate(38, function () {
    if (!g || g.mode !== "city") return;
    if (!dressed && CBZ.fpsWeaponModels && CBZ.fpsWeaponModels.length) { dressAll(); dressed = true; }
  });
  // safety: never leave the bench menu (and its cityMenuOpen soft-lock) up if the
  // player dies, leaves the city, or the run ends while standing at it. onAlways
  // so it fires even once state leaves "playing".
  CBZ.onAlways(38, function () {
    if (panel && panel.style.display === "block") {
      if (!g || g.mode !== "city" || g.state !== "playing" || (CBZ.player && CBZ.player.dead)) closeBench();
    }
  });
  // a fresh run wipes fitted mods (weapons reset too) — re-dress clean next time
  CBZ.gunModsReset = function () { g.cityGunMods = {}; dressed = false; dressAll(); };
})();

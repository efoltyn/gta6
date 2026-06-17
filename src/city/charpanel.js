/* ============================================================
   city/charpanel.js — YOU, ON YOUR OWN SCREEN: the persistent
   top-left CHARACTER PANEL + the [I] inventory / wardrobe screen.

   WHY (the missing self-read): the city already KNOWS everything about
   you — your worn fit (g.cityFit), the chain/watch/ring you OWN
   (g.cityInv), your level/title (CBZ.cityPlayerLevel / cityPlayerTitle),
   the price on your head (CBZ.cityBounty), your stars, your net worth —
   but there was never a single place to SEE yourself: to confirm the
   tux you bought is actually ON you, that the iced-out chain is worn and
   not just sitting in a duffel. This panel is that mirror.

   • TOP-LEFT PERSISTENT PANEL — a tiny live FRONT-FACING PORTRAIT of
     your rig (a dedicated CBZ.makeCharacter body, dressed exactly like
     you via CBZ.cityApplyComposite(g.cityFit)), rendered to a small
     <canvas> through a dedicated offscreen WebGLRenderer. PERF: it
     redraws ONLY when the panel is visible AND a cheap signature
     (fit + items + level) changed — an unchanged look costs nothing.
     Below it: "Lv.N Title", your wanted ★, the BOUNTY ($), net worth,
     and the "[I] Inventory" caption.

   • [I] INVENTORY OVERLAY — the Minecraft E-screen, done the city way
     so it can never misfire: on open CBZ.cityMenuOpen=true +
     document.exitPointerLock(); on close CBZ.cityMenuOpen=false +
     CBZ.requestLock(). A bigger portrait (same rig), the 9 ACCESSORY
     slots (hat/top/outer/bottom/shoes/glasses/chain/watch/ring) read
     straight from g.cityFit + your owned jewellery, a GRID of carried
     items (g.cityInv), and a mirror of CBZ.cityHotbar(). Click an
     accessory to equip/unequip through the EXISTING wardrobe
     (CBZ.cityWear / cityUnwear) — no parallel wardrobe, the model
     updates on the next signature tick. Click a hotbar slot to
     CBZ.cityHotbarSelect it.

   • [O] HIDE-HUD — hides/shows ALL city HUD (this panel + #cityHud) for
     a clean, immersive frame. (Was [H]; H is owned by heists.js /
     realestate.js / interact.js — a 4th handler made H "open a relic",
     so the hide toggle moved to the verified-free [O], plus an on-panel
     [×] click control. See the keydown handler + buildPanel.)

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
    { key: "hat",     name: "Hat",     icon: "🎩", cloth: "head" },
    { key: "top",     name: "Top",     icon: "👕", cloth: "shirt" },
    { key: "outer",   name: "Outer",   icon: "🧥", cloth: "jacket" },
    { key: "bottom",  name: "Bottom",  icon: "👖", cloth: "legs" },
    { key: "shoes",   name: "Shoes",   icon: "👟", cloth: "shoes" },
    { key: "glasses", name: "Glasses", icon: "🕶️", cloth: "face" },
    { key: "chain",   name: "Chain",   icon: "📿", bling: "neck" },
    { key: "watch",   name: "Watch",   icon: "⌚", bling: "wristL" },
    { key: "ring",    name: "Ring",    icon: "💍", bling: "ring" },
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
    const econ = CBZ.cityEcon;
    if (!econ || !econ.ITEMS || !g.cityInv) return null;
    const items = econ.ITEMS;
    let best = null, bestV = -1;
    for (const name in g.cityInv) {
      if ((g.cityInv[name] | 0) <= 0) continue;
      const it = items[name];
      if (!it || (it.tag !== "wearable" && it.tag !== "valuable" && it.tag !== "jewelry")) continue;
      const s = name.toLowerCase();
      let slot = null;
      if (s.indexOf("chain") >= 0 || s.indexOf("necklace") >= 0) slot = "neck";
      else if (s.indexOf("rolex") >= 0 || s.indexOf("omega") >= 0 || s.indexOf("piguet") >= 0 ||
               s.indexOf("patek") >= 0 || s.indexOf("mille") >= 0 || s.indexOf("watch") >= 0) slot = "wristL";
      else if (s.indexOf("earring") < 0 && (s.indexOf("ring") >= 0 || s.indexOf("pinky") >= 0)) slot = "ring";
      if (slot !== slotKey) continue;
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
  //  WORN JEWELLERY ON THE PORTRAIT — chains / watch / ring.
  //  clothes.js dresses the rig's FABRIC (cityApplyComposite); the
  //  worn jewellery is mounted SEPARATELY by bling.js onto the LIVE
  //  player rig (CBZ.playerChar) and so never reaches the portrait's
  //  own rig. The live player's dress call is CBZ.cityBlingResyncPed
  //  (a ped-shaped { char, valuables, gang, ... } → its .char gets the
  //  shared pooled meshes), but that path is camera-distance gated and
  //  pushes onto bling.js's global "dressed" roster — wrong for an
  //  isolated offscreen rig. So we mount the SAME pieces here directly,
  //  reusing the engine's shared CBZ.boxGeom / CBZ.cmat primitives, at
  //  the EXACT local transforms bling.js uses (character.js rig space:
  //  torso front face z≈0.25, collar ≈ y1.75, forearm end y≈-0.66,
  //  hand front edge y≈-0.80). Meshes are built once and re-pointed on
  //  change — no per-frame allocation, no global state touched.
  // ============================================================
  const JG = {};                                   // shared jewellery geometry by kind
  function jgeo(kind) {
    if (JG[kind]) return JG[kind];
    const B = CBZ.boxGeom;
    let gm = null;
    if (!B) return null;
    if (kind === "link") gm = B(0.30, 0.035, 0.03);
    else if (kind === "linkThin") gm = B(0.30, 0.026, 0.024);
    else if (kind === "linkThick") gm = B(0.30, 0.055, 0.035);
    else if (kind === "pendant") gm = B(0.07, 0.07, 0.03);
    else if (kind === "cuff") gm = B(0.32, 0.05, 0.32);
    else if (kind === "face") gm = B(0.10, 0.07, 0.03);
    else if (kind === "ring") gm = B(0.05, 0.04, 0.05);
    JG[kind] = gm;
    return gm;
  }
  let _jmats = null;                               // shared finishes (mirror bling.js)
  function jmats() {
    if (_jmats) return _jmats;
    const C = CBZ.cmat;
    if (!C) return null;
    _jmats = {
      gold: C(0xc9a44a, { emissive: 0x6b4f12, ei: 0.4 }),
      silver: C(0xb9c0c8, { emissive: 0x7e8790, ei: 0.35 }),
      ice: C(0xeaf6ff, { emissive: 0x9fd8ff, ei: 0.65 }),
      glint: C(0xffffff, { emissive: 0xcfeaff, ei: 0.95 }),
    };
    return _jmats;
  }

  // part lists per worn piece (kind + finish + local transform) — copied 1:1
  // from bling.js looks() so the portrait reads identically to the live body.
  const JCHAIN_Y = 1.65, JCHAIN_Z = 0.268, JCHAIN_TILT = 0.83;
  function chainParts(name) {
    const M = jmats(); if (!M) return null;
    const s = String(name).toLowerCase();
    let link = "link", pmat = M.gold;
    if (s.indexOf("necklace") >= 0 || s.indexOf("diamond") >= 0) { link = "linkThin"; pmat = M.glint; }
    else if (s.indexOf("iced") >= 0) { link = "linkThick"; pmat = M.ice; }
    const lmat = (link === "linkThin") ? M.silver : (link === "linkThick" ? M.ice : M.gold);
    return [
      { kind: link, mat: lmat, x: -0.10, y: JCHAIN_Y, z: JCHAIN_Z, rz: -JCHAIN_TILT },
      { kind: link, mat: lmat, x: 0.10, y: JCHAIN_Y, z: JCHAIN_Z, rz: JCHAIN_TILT },
      { kind: "pendant", mat: pmat, x: 0, y: 1.515, z: 0.272 },
    ];
  }
  function watchParts(name) {
    const M = jmats(); if (!M) return null;
    const s = String(name).toLowerCase();
    let band = M.gold, face = M.gold;
    if (s.indexOf("piguet") >= 0 || s.indexOf("patek") >= 0 || s.indexOf("mille") >= 0 || s.indexOf("iced") >= 0) { band = M.ice; face = M.glint; }
    else if (s.indexOf("omega") >= 0) { band = M.silver; face = M.silver; }
    return [
      { kind: "cuff", mat: band, x: 0, y: -0.66, z: 0 },
      { kind: "face", mat: face, x: 0, y: -0.66, z: 0.165 },
    ];
  }
  function ringParts() {
    const M = jmats(); if (!M) return null;
    return [{ kind: "ring", mat: M.glint, x: 0.10, y: -0.80, z: 0.17 }];
  }

  // a stable signature of the player's WORN jewellery — chains/watch/ring re-mount
  // only when this changes (keeps the redraw-on-change perf contract).
  function jewelSig() {
    return (blingWornIn("neck") || "") + "|" + (blingWornIn("wristL") || "") + "|" + (blingWornIn("ring") || "");
  }

  // mount one part list onto a rig anchor; the created meshes are tracked so the
  // next change can strip them. Anchors mirror bling.js: neck→body, watch→la, ring→ra.
  function mountJewelParts(parts, anchor, out) {
    if (!parts || !anchor || !anchor.add || !THREE) return;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const geo = jgeo(p.kind);
      if (!geo || !p.mat) continue;
      const m = new THREE.Mesh(geo, p.mat);
      m.castShadow = false; m.receiveShadow = false;
      m.position.set(p.x, p.y, p.z);
      m.rotation.set(p.rx || 0, 0, p.rz || 0);
      anchor.add(m);
      out.push(m);
    }
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
    if (!jmats()) return;                           // engine primitives not up yet
    const neck = blingWornIn("neck"), wrist = blingWornIn("wristL"), ring = blingWornIn("ring");
    if (!neck && !wrist && !ring) return;           // nothing worn — fabric only
    const out = [];
    const la = rig.parts && rig.parts.la, ra = rig.parts && rig.parts.ra;
    if (neck) mountJewelParts(chainParts(neck), rig.body, out);
    if (wrist) mountJewelParts(watchParts(wrist), la, out);
    if (ring) mountJewelParts(ringParts(), ra, out);
    if (out.length) rig._cpJewel = out;
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
      scene.add(rig.group);

      PORT.rend = rend; PORT.scene = scene; PORT.cam = cam; PORT.rig = rig;
      PORT.ready = true;
      return true;
    } catch (e) { PORT.broken = true; return false; }
  }

  // current look/level signature — cheap string; an unchanged look = no redraw
  function lookSig() {
    const f = g.cityFit || {};
    const items = Array.isArray(f.items) ? f.items.join(",") : "";
    const lvl = CBZ.cityPlayerLevel ? CBZ.cityPlayerLevel() : 0;
    // worn jewellery influences the read too (informational on the portrait)
    const j = (blingWornIn("neck") || "") + "|" + (blingWornIn("wristL") || "") + "|" + (blingWornIn("ring") || "");
    return (f.shirt || 0) + ":" + (f.legs || 0) + ":" + items + ":" + lvl + ":" + j;
  }

  // dress the portrait rig exactly like the player and render one frame
  function drawPortrait(canvas, px) {
    if (!buildPortrait() || !canvas) return;
    const f = g.cityFit;
    // dress via the EXISTING composite pipeline (idempotent re-dress)
    if (CBZ.cityApplyComposite && f && typeof f === "object") {
      CBZ.cityApplyComposite(PORT.rig, { shirt: f.shirt, legs: f.legs, items: Array.isArray(f.items) ? f.items.slice() : [] });
    }
    // mount the player's WORN jewellery (chains/watch/ring) onto the same rig —
    // re-seated only when the worn set changed (gated by lookSig's jewel field)
    applyPortraitJewelry(PORT.rig);
    // a calm front 3/4 view; gentle idle so it reads "live", not a freeze-frame
    const rig = PORT.rig;
    rig.group.rotation.y = -0.32;
    if (rig.neck) rig.neck.rotation.set(0, 0, 0);
    // frame the upper body — the fit is what we're confirming
    PORT.cam.position.set(0, 2.35, 5.6);
    PORT.cam.lookAt(0, 2.0, 0);

    PORT.rend.setSize(px, px, false);
    if (canvas.width !== px || canvas.height !== px) { canvas.width = px; canvas.height = px; }
    PORT.rend.setSize(px, px, false);
    PORT.rend.render(PORT.scene, PORT.cam);
    // blit the offscreen render onto the visible 2D canvas
    const ctx = canvas.getContext("2d");
    if (ctx) { ctx.clearRect(0, 0, px, px); ctx.drawImage(PORT.rend.domElement, 0, 0, px, px); }
  }

  // ============================================================
  //  STYLES (self-mounted once)
  // ============================================================
  function ensureCss() {
    if (document.getElementById("cpCss")) return;
    const st = document.createElement("style");
    st.id = "cpCss";
    st.textContent =
      "#cpPanel{position:fixed;left:14px;top:14px;z-index:60;width:128px;font-family:inherit;color:#e8ecf2;pointer-events:none;user-select:none}" +
      "#cpPanel .cpCard{position:relative;background:rgba(8,11,17,.55);border:1px solid rgba(232,236,242,.12);border-radius:10px;backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);overflow:hidden;box-shadow:0 3px 12px rgba(0,0,0,.4)}" +
      "#cpPanel .cpHide{position:absolute;right:4px;top:4px;z-index:2;width:20px;height:20px;line-height:18px;text-align:center;font-size:15px;font-weight:700;color:#9fb0c6;background:rgba(8,11,17,.6);border:1px solid rgba(232,236,242,.16);border-radius:6px;cursor:pointer;padding:0;pointer-events:auto;font-family:inherit}" +
      "#cpPanel .cpHide:hover{color:#fff;background:rgba(255,90,90,.32);border-color:rgba(255,120,120,.5)}" +
      "#cpPanel canvas{display:block;width:128px;height:128px;background:radial-gradient(ellipse at 50% 38%,rgba(60,74,98,.35),rgba(8,11,17,.0) 70%)}" +
      "#cpPanel .cpMeta{padding:6px 8px 7px}" +
      "#cpPanel .cpLvl{font-size:13px;font-weight:700;letter-spacing:.2px;line-height:1.15;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.7)}" +
      "#cpPanel .cpLvl .n{color:#ffd166}" +
      "#cpPanel .cpStars{font-size:13px;line-height:1.1;margin-top:3px;letter-spacing:1px}" +
      "#cpPanel .cpRow{display:flex;justify-content:space-between;align-items:baseline;font-size:11px;margin-top:4px;color:#9fb0c6}" +
      "#cpPanel .cpRow b{color:#e8ecf2;font-weight:700;font-variant-numeric:tabular-nums}" +
      "#cpPanel .cpRow.bounty b{color:#ff8b6a}" +
      "#cpPanel .cpRow.worth b{color:#7ed957}" +
      "#cpPanel .cpHint{margin-top:6px;font-size:10px;letter-spacing:.4px;color:#7f8ba0;text-align:center}" +
      "#cpPanel .cpHint b{color:#9fb0c6}" +

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
      "#cpInv .cpItem .nm{font-size:8px;color:#9fb0c6;text-align:center;line-height:1.05;margin-top:2px;max-width:54px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      "#cpInv .cpItem .ct{position:absolute;right:3px;top:2px;font-size:9px;font-weight:800;color:#fff;background:rgba(8,11,17,.85);border-radius:6px;padding:0 4px}" +
      "#cpInv .cpEmpty{font-size:12px;color:#7f8ba0;padding:8px 2px}" +
      "#cpInv .cpHot{display:flex;flex-wrap:wrap;gap:7px}" +
      "#cpInv .cpHs{display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:50px;height:46px;padding:4px 8px;border-radius:9px;background:rgba(255,255,255,.04);border:1px solid rgba(232,236,242,.1);cursor:pointer;position:relative}" +
      "#cpInv .cpHs:hover{border-color:rgba(125,231,255,.5)}" +
      "#cpInv .cpHs .s{font-size:12px;font-weight:800;color:#e8ecf2;line-height:1.05}" +
      "#cpInv .cpHs .a{font-size:9px;color:#7f8ba0;margin-top:1px}" +
      "#cpInv .cpHs.active{border-color:rgba(125,231,255,.6);box-shadow:0 0 0 1px rgba(125,231,255,.35)}" +
      "#cpInv .cpHs .ct{position:absolute;right:2px;top:1px;font-size:8px;font-weight:800;color:#fff;background:rgba(8,11,17,.85);border-radius:5px;padding:0 3px}" +
      "#cpInv .cpClose{margin-top:10px;font-size:11px;color:#7f8ba0;text-align:center}" +
      "#cpInv .cpClose b{color:#9fb0c6}";
    document.head.appendChild(st);
  }

  // ============================================================
  //  TOP-LEFT PANEL DOM
  // ============================================================
  let panel = null, pCanvas = null, pLvl = null, pStars = null, pBounty = null, pWorth = null;
  let hudHidden = false;
  let lastMetaSig = "";

  function buildPanel() {
    if (panel) return;
    ensureCss();
    panel = document.createElement("div");
    panel.id = "cpPanel";
    panel.innerHTML =
      "<div class='cpCard'>" +
      "<button type='button' class='cpHide' title='Hide HUD ([O])' aria-label='Hide HUD'>×</button>" +
      "<canvas width='128' height='128'></canvas>" +
      "<div class='cpMeta'>" +
      "<div class='cpLvl'>Lv.<span class='n'>1</span> <span class='ti'>Nobody</span></div>" +
      "<div class='cpStars'></div>" +
      "<div class='cpRow bounty'><span>Bounty</span><b>$0</b></div>" +
      "<div class='cpRow worth'><span>Net worth</span><b>$0</b></div>" +
      "<div class='cpHint'><b>[I]</b> Inventory &nbsp; <b>[O]</b> Hide</div>" +
      "</div></div>";
    document.body.appendChild(panel);
    pCanvas = panel.querySelector("canvas");
    pLvl = panel.querySelector(".cpLvl");
    pStars = panel.querySelector(".cpStars");
    pBounty = panel.querySelector(".cpRow.bounty b");
    pWorth = panel.querySelector(".cpRow.worth b");
    // on-panel hide control — the only pointer-interactive element on this
    // pointer-events:none panel, so it can't eat clicks meant for the world.
    const hideBtn = panel.querySelector(".cpHide");
    if (hideBtn) hideBtn.addEventListener("click", function (e) {
      e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      setHudHidden(true);
    });
  }

  function starsHtml(w) {
    w = w | 0; let s = "";
    for (let i = 1; i <= 5; i++) s += i <= w ? "<span style='color:#ffd166;text-shadow:0 0 7px rgba(255,209,102,.6)'>★</span>" : "<span style='color:#3a4049'>★</span>";
    return s;
  }

  // refresh the panel's text + portrait (portrait only on signature change)
  function refreshPanel() {
    if (!panel) return;
    const lvl = CBZ.cityPlayerLevel ? CBZ.cityPlayerLevel() : 1;
    const title = CBZ.cityPlayerTitle ? CBZ.cityPlayerTitle() : "";
    const bty = CBZ.cityBounty ? CBZ.cityBounty() : 0;
    const nw = netWorth();
    const w = g.wanted | 0;
    const metaSig = lvl + "|" + title + "|" + bty + "|" + nw + "|" + w;
    if (metaSig !== lastMetaSig) {
      lastMetaSig = metaSig;
      pLvl.querySelector(".n").textContent = lvl;
      pLvl.querySelector(".ti").textContent = title;
      pStars.innerHTML = starsHtml(w);
      pBounty.textContent = fmt$(bty);
      pWorth.textContent = fmt$(nw);
    }
    // portrait: redraw only when the look/level changed
    const sig = lookSig();
    if (sig !== PORT.sig) { PORT.sig = sig; drawPortrait(pCanvas, 128); }
  }

  // ============================================================
  //  [I] INVENTORY OVERLAY DOM
  // ============================================================
  let inv = null, invBigCanvas = null, invAcc = null, invGrid = null, invHot = null;
  let invOpen = false, invBigSig = "";

  const LOOT_ICON = { drug: "💊", wearable: "💎", valuable: "💰", throwable: "🧨", tool: "🧰", food: "🍔", weapon: "🔫", ammo: "📦" };
  const ITEM_ICON = {
    Grenade: "🧨", "C4 Charge": "🧨", Rolex: "⌚", Omega: "⌚", "Audemars Piguet": "⌚", "Patek Philippe": "⌚",
    "Richard Mille": "⌚", "Gold Bar": "🥇", "Gold Chain": "📿", "Diamond Ring": "💍", "Engagement Ring": "💍",
    Medkit: "🩹", "Body Armor": "🦺", Weed: "🌿", Coke: "❄️", "Cash Stack": "💵", "Briefcase of Cash": "💼",
    Phone: "📱", Laptop: "💻", Wallet: "👛", Burger: "🍔", Soda: "🥤",
  };

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
      "<div class='cpClose'><b>[I]</b> / <b>[Esc]</b> to close</div>" +
      "</div>" +
      "<div class='cpRight'>" +
      "<div><div class='cpH'>Worn</div><div class='cpAcc'></div></div>" +
      "<div><div class='cpH'>Carried</div><div class='cpGrid'></div></div>" +
      "<div><div class='cpH'>Hotbar</div><div class='cpHot'></div></div>" +
      "</div>" +
      "</div>";
    document.body.appendChild(inv);
    invBigCanvas = inv.querySelector("canvas");
    invAcc = inv.querySelector(".cpAcc");
    invGrid = inv.querySelector(".cpGrid");
    invHot = inv.querySelector(".cpHot");
    // a click on the dim backdrop (outside the wrap) closes
    inv.addEventListener("click", function (e) { if (e.target === inv) closeInv(); });
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
    const econ = CBZ.cityEcon, items = econ && econ.ITEMS, invMap = g.cityInv || {};
    const rows = [];
    for (const name in invMap) {
      const n = invMap[name] | 0;
      if (n <= 0) continue;
      const it = items && items[name];
      const tag = it && it.tag;
      const icon = ITEM_ICON[name] || (tag && LOOT_ICON[tag]) || "📦";
      rows.push({ name, n, icon, val: (it && it.value) || 0 });
    }
    if (!rows.length) { invGrid.innerHTML = "<div class='cpEmpty'>Empty — nothing carried.</div>"; return; }
    rows.sort((a, b) => (b.val - a.val) || (b.n - a.n));
    let html = "";
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      html += "<div class='cpItem' title='" + esc(r.name) + "'>" +
        (r.n > 1 ? "<div class='ct'>" + r.n + "</div>" : "") +
        "<div class='ic'>" + r.icon + "</div>" +
        "<div class='nm'>" + esc(r.name) + "</div></div>";
    }
    invGrid.innerHTML = html;
  }

  function renderHot() {
    if (!invHot) return;
    const bar = (CBZ.cityHotbar && CBZ.cityHotbar()) || [];
    if (!bar.length) { invHot.innerHTML = "<div class='cpEmpty'>—</div>"; return; }
    let html = "";
    for (let i = 0; i < bar.length; i++) {
      const e = bar[i];
      const short = e.short || e.label || "?";
      const sub = e.kind === "holster" ? "fists" : (e.kind === "item" ? "use" : "gun");
      html += "<div class='cpHs" + (e.active ? " active" : "") + "' data-bar='" + i + "'>" +
        (e.count != null && e.count > 1 ? "<div class='ct'>" + (e.count | 0) + "</div>" : "") +
        "<div class='s'>" + esc(short) + "</div><div class='a'>" + sub + "</div></div>";
    }
    invHot.innerHTML = html;
  }

  function renderInvAll() {
    if (!inv) return;
    const lvl = CBZ.cityPlayerLevel ? CBZ.cityPlayerLevel() : 1;
    const title = CBZ.cityPlayerTitle ? CBZ.cityPlayerTitle() : "";
    const sub = inv.querySelector(".cpSub");
    if (sub) sub.textContent = "Lv." + lvl + " " + title + "  ·  " + fmt$(netWorth());
    renderAcc();
    renderGrid();
    renderHot();
    // big portrait — redraw on look change (or first open)
    const sig = lookSig();
    if (sig !== invBigSig) { invBigSig = sig; drawBigPortrait(); }
  }

  // big portrait reuses the SAME offscreen rig, framed full-body
  function drawBigPortrait() {
    if (!buildPortrait() || !invBigCanvas) return;
    const f = g.cityFit;
    if (CBZ.cityApplyComposite && f && typeof f === "object") {
      CBZ.cityApplyComposite(PORT.rig, { shirt: f.shirt, legs: f.legs, items: Array.isArray(f.items) ? f.items.slice() : [] });
    }
    applyPortraitJewelry(PORT.rig);                // worn chains/watch/ring on the big model too
    PORT.rig.group.rotation.y = -0.3;
    PORT.cam.position.set(0, 2.0, 7.4);
    PORT.cam.lookAt(0, 1.55, 0);
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
      if (id && CBZ.cityUnwear) { CBZ.cityUnwear(id); invBigSig = ""; renderInvAll(); refreshPanel(); }
      return;
    }
    // hotbar slot
    let barEl = n; while (barEl && barEl !== inv && !barEl.dataset.bar) barEl = barEl.parentNode;
    if (barEl && barEl !== inv && barEl.dataset.bar != null) {
      const idx = parseInt(barEl.dataset.bar, 10);
      if (!isNaN(idx) && CBZ.cityHotbarSelect) { CBZ.cityHotbarSelect(idx); renderHot(); refreshPanel(); }
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
    invBigSig = "";                                    // force a fresh portrait
    renderInvAll();
    inv.style.display = "flex";
  }
  function closeInv() {
    if (!invOpen) return;
    invOpen = false;
    if (inv) inv.style.display = "none";
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
    if (panel) panel.style.display = hudHidden ? "none" : "";
    const cHud = document.getElementById("cityHud");
    if (cHud) cHud.style.display = hudHidden ? "none" : "";
  }

  // ============================================================
  //  KEY HANDLER — guarded like every city panel so it can't misfire
  // ============================================================
  window.addEventListener("keydown", function (e) {
    const k = (e.key || "").toLowerCase();
    // while the inventory overlay is up, it owns I / Esc
    if (invOpen) {
      if (k === "i" || k === "escape") {
        e.preventDefault();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        e.stopPropagation();
        closeInv();
      }
      return;
    }
    // strict city-only / playing-only gate; never steal a key from a menu/map
    if (!cityNow() || g.state !== "playing") return;
    if (CBZ.cityMenuOpen) return;
    if (CBZ.fullMap && CBZ.fullMap.active) return;
    if (CBZ.player && (CBZ.player.dead || CBZ.player.driving)) {
      // still allow the hide-HUD toggle while driving/dead; [I] is gated to on-foot
      if (k !== "o") return;
    }
    if (k === "i") {
      e.preventDefault();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      e.stopPropagation();
      openInv();
    } else if (k === "o") {
      // [O] HIDE-HUD — H was already owned by heists/realestate/interact
      // (our 4th handler made H "open a relic"); O is verified-unbound.
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
      // outside the city, this panel does not exist (jail/survival untouched)
      if (panel && panel.style.display !== "none") panel.style.display = "none";
      if (invOpen) closeInv();
      hudHidden = false;
      return;
    }
    if (!panel) buildPanel();
    // honor the hide-HUD toggle; otherwise show + refresh
    if (hudHidden) { if (panel.style.display !== "none") panel.style.display = "none"; }
    else {
      if (panel.style.display === "none") panel.style.display = "";
      refreshPanel();
    }
    // keep the open overlay's live readouts (hotbar/bounty) current
    if (invOpen) {
      // light refresh: meta + hotbar are cheap; the grid/acc redraw on demand
      const sub = inv.querySelector(".cpSub");
      if (sub) { const lvl = CBZ.cityPlayerLevel ? CBZ.cityPlayerLevel() : 1; sub.textContent = "Lv." + lvl + " " + (CBZ.cityPlayerTitle ? CBZ.cityPlayerTitle() : "") + "  ·  " + fmt$(netWorth()); }
    }
  });

  // ---- public hooks (debug / harness) --------------------------------------
  CBZ.cityCharPanel = {
    open: openInv, close: closeInv,
    isOpen: function () { return invOpen; },
    hideHud: setHudHidden, hudHidden: function () { return hudHidden; },
    slots: function () { return SLOTS.map((s) => ({ key: s.key, worn: slotLabel(s) || null })); },
  };
})();

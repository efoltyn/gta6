/* ============================================================
   city/mugshot.js — A PICTURE OF THE PERSON.

   OWNER (2026-08-18): "hitman mode, when the phone shows you the contract and
   tells you to kill — show you a picture. THE OUTFIT. We really built outfits,
   there's so much potential for that. And it removes a lot of the verbosity."

   That is the whole idea. The city already dresses every single body through
   ONE wardrobe (city/outfits.js casting -> city/clothes.js painted atlas), so
   a target's clothes are not decoration: they are the thing you actually scan
   a crowd for. A paragraph that says "works as a line cook, clocks in at the
   diner, shift 9-17, beds down in Riverside" is four facts you cannot see. A
   PICTURE of the man in his chef whites is one fact you can.

   THE ONE PHOTO BOOTH. This file owns no wardrobe, no casting, no palette:

     who is wearing what  -> CBZ.cityOutfitOf(ped)   (samples the LIVE rig, so
                             district wardrobes / tourist brights / a vips
                             repaint all travel — visual truth, not catalog)
     the body             -> CBZ.makeCharacter       (the same rig the world uses)
     dressing it          -> CBZ.cityRecolorRig      (painted garment + composite
                             + cap/badge/bandana, isolated per rig)
     skin / hair / style  -> read straight off the target's OWN rig
                             (ch.skinTone, hair material, userData.hairStyle)

   So the photo is not "an illustration of the outfit". It is the same rig,
   wearing the same painted cloth, lit flat and shot from the front — the
   person you are about to walk up to.

   HOW IT RENDERS: an offscreen scene + rig, drawn with charpanel.js's EXISTING
   portrait WebGLRenderer (CBZ.cityPortraitRenderer — a renderer is scene-
   agnostic, and that context is already built and prewarmed; a second one
   would cost another ~1.3s hitch and another of the browser's ~16 GL
   contexts). Only if charpanel never loaded do we build our own. The frame is
   blitted onto a 2D canvas with a backdrop, so the result is a photo card.
   Both handles are SYNCHRONOUS:

     CBZ.cityMugshotCanvas(spec, opts) -> <canvas>   (drawImage it anywhere:
                                                      a cork board, a HUD, a
                                                      canvasTexLive texture)
     CBZ.cityMugshot(spec, opts)       -> data: URL  (an <img> on the phone)

   spec: { ped }                       — the usual call: photograph this body
         { outfit, skin, hair, hairStyle, build, age, cap, shortSleeve }
                                       — or describe one that isn't spawned
   opts: { w, h }                      — default 168x224 (a 3:4 ID card)

   CACHED by look signature, so re-rendering the same person costs nothing and
   a card that repaints every frame never touches the GPU twice.

   FLAG: CBZ.CONFIG.CITY_MUGSHOT — false makes both handles return null, which
   every caller already treats as "no photo, show the words". One-line revert.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.CITY_MUGSHOT == null) CFG.CITY_MUGSHOT = true;

  const DEF_W = 168, DEF_H = 224;                 // 3:4 — head to knee
  const CACHE_MAX = 24;

  let R = null, broken = false, renders = 0;
  const cache = [];                                // [{ sig, canvas, url }] — small, LRU by splice

  function try_(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }

  /* ---------------- the booth ------------------------------------------- */
  function booth() {
    if (R || broken) return R;
    if (!THREE || !CBZ.makeCharacter || typeof document === "undefined") { broken = true; return null; }
    try {
      // borrow the portrait context; stand up our own only if there isn't one
      let rend = CBZ.cityPortraitRenderer ? try_(function () { return CBZ.cityPortraitRenderer(); }, null) : null;
      let owned = false;
      if (!rend) { rend = new THREE.WebGLRenderer({ antialias: true, alpha: true }); owned = true; }
      rend.setPixelRatio(1);
      rend.setClearColor(0x000000, 0);
      const scene = new THREE.Scene();
      // flat and friendly: the painted fabric has to READ, this is not a mood shot
      const amb = new THREE.AmbientLight(0xffffff, 0.95);
      const key = new THREE.DirectionalLight(0xffffff, 0.72); key.position.set(0.7, 1.4, 1.25);
      const rim = new THREE.DirectionalLight(0x9fc0ff, 0.34); rim.position.set(-1.0, 0.6, -0.9);
      scene.add(amb, key, rim);
      const cam = new THREE.PerspectiveCamera(26, DEF_W / DEF_H, 0.1, 40);
      R = { rend: rend, owned: owned, scene: scene, cam: cam, rig: null, bodySig: "" };
      return R;
    } catch (e) { broken = true; return null; }
  }

  /* ---------------- reading a real body --------------------------------- */
  function hairMesh(ch) {
    const s = ch && ch.skinSlots;
    return (s && s.hair && s.hair.length) ? s.hair[0] : null;
  }
  function hexOf(mesh, dflt) {
    const m = mesh && mesh.material;
    return (m && m.color && m.color.getHex) ? m.color.getHex() : dflt;
  }
  function capWorn(ch) {
    const s = ch && ch.skinSlots;
    return !!(s && s.cap && s.cap.length && s.cap[0] && s.cap[0].visible);
  }
  // a short-sleeve body paints its FOREARM with the face's tone — that is the
  // rig's own tell, so the photo doesn't put a sleeve on a bare arm.
  function shortSleeveOf(ch) {
    const s = ch && ch.skinSlots;
    if (!s || !s.armsLower || !s.armsLower.length || ch.skinTone == null) return false;
    return hexOf(s.armsLower[0], -1) === (ch.skinTone | 0);
  }

  // Resolve a spec into the complete LOOK we are about to photograph.
  function look(spec) {
    spec = spec || {};
    const p = spec.ped || null;
    const ch = spec.rig || (p && p.char) || null;
    const hm = hairMesh(ch);
    const rec = spec.outfit !== undefined ? spec.outfit
      : (p && CBZ.cityOutfitOf) ? try_(function () { return CBZ.cityOutfitOf(p); }, null)
      : null;
    const capHex = (rec && rec.capColor != null) ? rec.capColor : 0x1c1f26;
    const cap = spec.cap !== undefined ? !!spec.cap
      : (ch ? capWorn(ch) : !!(rec && (rec.cop || rec.cap)));
    return {
      rec: rec,
      skin: spec.skin != null ? spec.skin : (ch && ch.skinTone != null ? ch.skinTone : 0xcf9a72),
      hair: spec.hair != null ? spec.hair : hexOf(hm, 0x4a3526),
      hairStyle: spec.hairStyle || (hm && hm.userData ? hm.userData.hairStyle : null) || null,
      build: spec.build || ((p && p.gender === "f") ? "f" : "m"),
      age: spec.age !== undefined ? spec.age : (p ? p.ageYears : null),
      cap: cap, capColor: capHex,
      shortSleeve: spec.shortSleeve !== undefined ? !!spec.shortSleeve : shortSleeveOf(ch),
    };
  }

  function colorSig(c) {
    if (!c) return "-";
    return [c.legs, c.torso, c.collar, c.arms, c.shoes, c.gloss ? 1 : 0].join(".");
  }
  function bodySigOf(L) {
    return [L.build, L.age == null ? "-" : Math.round(L.age), L.skin, L.hair, L.hairStyle || "-",
      L.cap ? L.capColor : "-", L.shortSleeve ? 1 : 0].join("|");
  }
  function lookSig(L, w, h) {
    const r = L.rec || {};
    const comp = (r.composite && Array.isArray(r.composite.items)) ? r.composite.items.join(",") : "";
    return bodySigOf(L) + "#" + [r.id || "-", colorSig(r.colors), r.gang || "-", r.cop ? 1 : 0,
      r.pattern || "-", r.style != null ? r.style : "-", comp].join("|") + "@" + w + "x" + h;
  }

  /* ---------------- the shot -------------------------------------------- */
  function buildRig(B, L) {
    if (B.rig && B.rig.group) B.scene.remove(B.rig.group);
    const c = {
      legs: 0x39414f, torso: 0x8a939c, collar: 0x8a939c, arms: 0x8a939c,
      skin: L.skin, hair: L.hair, shoes: 0x2b2b2b,
      build: L.build === "f" ? "f" : "m",
      shortSleeve: L.shortSleeve,
    };
    if (L.age != null) c.age = L.age;
    if (L.hairStyle) c.hairStyle = L.hairStyle;
    // a rig only grows hair OR a cap at construction — so the cap has to be
    // decided here, not painted on later (character.js's own rule).
    if (L.cap) c.cap = L.capColor;
    const rig = CBZ.makeCharacter(c);
    rig.group.position.set(0, 0, 0);
    B.scene.add(rig.group);
    B.rig = rig;
    B.bodySig = bodySigOf(L);
    return rig;
  }

  function backdrop(cc, w, h) {
    const gr = cc.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, "#2a333d");
    gr.addColorStop(1, "#141a20");
    cc.fillStyle = gr; cc.fillRect(0, 0, w, h);
    // a faint measuring wall — this is a photo taken of someone, not a render
    cc.strokeStyle = "rgba(255,255,255,.055)"; cc.lineWidth = 1;
    for (let y = h * 0.18; y < h; y += h * 0.14) {
      cc.beginPath(); cc.moveTo(0, Math.round(y) + 0.5); cc.lineTo(w, Math.round(y) + 0.5); cc.stroke();
    }
    const vg = cc.createRadialGradient(w / 2, h * 0.45, h * 0.18, w / 2, h * 0.5, h * 0.78);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,.42)");
    cc.fillStyle = vg; cc.fillRect(0, 0, w, h);
  }

  function shoot(L, w, h) {
    const B = booth();
    if (!B) return null;
    const rig = (B.rig && B.bodySig === bodySigOf(L)) ? B.rig : buildRig(B, L);
    if (!rig) return null;

    // DRESS THE BODY through the one wardrobe. `iso` clones the garment
    // material for this rig alone, so photographing somebody can never repaint
    // the people sharing that cached atlas out in the street.
    if (L.rec && L.rec.colors && CBZ.cityRecolorRig) {
      try_(function () { CBZ.cityRecolorRig(rig, L.rec.colors, L.rec, { iso: true }); });
    }

    // a calm standing 3/4 — the fit reads, the face reads, nothing is posed
    rig.group.rotation.y = -0.34;
    if (rig.neck) rig.neck.rotation.set(0, 0, 0);
    // FRAME OFF THE ACTUAL BODY, never off an assumed height. The rig is built
    // at HUMAN_SCALE and a child's is shorter again, so a hard-coded camera
    // guessed wrong and cropped the fit at the thigh. Measure, then frame the
    // crown down to just below the knee — enough leg for the trousers and the
    // silhouette to read, close enough that the face is still a face.
    const box = new THREE.Box3().setFromObject(rig.group);
    const bot = isFinite(box.min.y) ? box.min.y : 0;
    const bodyH = Math.max(0.6, (isFinite(box.max.y) ? box.max.y : 1.8) - bot);
    const yTop = bot + bodyH * 1.10, yBot = bot + bodyH * 0.16;   // headroom, then down past the knee
    const cy = (yTop + yBot) / 2;
    B.cam.aspect = w / h;
    B.cam.fov = 26;
    // the 3/4 turn swings a shoulder toward the lens — a little pad, so the
    // near arm never clips the frame edge
    const dist = ((yTop - yBot) / 2) / Math.tan((B.cam.fov * Math.PI / 180) / 2) * 1.06;
    B.cam.position.set(0, cy, dist);
    B.cam.lookAt(0, cy, 0);
    B.cam.updateProjectionMatrix();
    B.rend.setSize(w, h, false);
    B.rend.render(B.scene, B.cam);
    renders++;

    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const cc = canvas.getContext("2d");
    if (!cc) return null;
    backdrop(cc, w, h);
    cc.drawImage(B.rend.domElement, 0, 0, w, h);   // same tick — the buffer is still live
    return canvas;
  }

  /* ---------------- the handles ----------------------------------------- */
  function entry(spec, opts) {
    if (CFG.CITY_MUGSHOT === false) return null;
    opts = opts || {};
    const w = Math.max(48, Math.min(512, opts.w | 0 || DEF_W));
    const h = Math.max(48, Math.min(512, opts.h | 0 || DEF_H));
    const L = look(spec);
    const sig = lookSig(L, w, h);
    for (let i = 0; i < cache.length; i++) {
      if (cache[i].sig === sig) { const hit = cache.splice(i, 1)[0]; cache.push(hit); return hit; }
    }
    const canvas = shoot(L, w, h);
    if (!canvas) return null;
    const e = { sig: sig, canvas: canvas, url: "" };
    cache.push(e);
    while (cache.length > CACHE_MAX) cache.shift();
    return e;
  }

  CBZ.cityMugshotCanvas = function (spec, opts) {
    const e = entry(spec, opts);
    return e ? e.canvas : null;
  };
  CBZ.cityMugshot = function (spec, opts) {
    const e = entry(spec, opts);
    if (!e) return null;
    if (!e.url) e.url = try_(function () { return e.canvas.toDataURL("image/png"); }, "") || "";
    return e.url || null;
  };
  // what is this body wearing, in words — the caption under the picture.
  CBZ.cityMugshotWearing = function (spec) {
    const rec = (spec && spec.outfit) || ((spec && spec.ped && CBZ.cityOutfitOf)
      ? try_(function () { return CBZ.cityOutfitOf(spec.ped); }, null) : null);
    if (!rec) return null;
    if (rec.swiped || rec.id === "civvies") return "street clothes";
    return rec.name || null;
  };

  CBZ.cityMugshotAudit = function () {
    return {
      enabled: CFG.CITY_MUGSHOT !== false, booth: !!R, broken: broken,
      sharedContext: !!(R && !R.owned),          // 1 = borrowing charpanel's renderer (the goal)
      cached: cache.length, renders: renders,
    };
  };
})();

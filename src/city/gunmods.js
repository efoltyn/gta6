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
       systems/sights.js draws the sight picture).
     • the VISUAL: real child meshes bolted onto the held gun (the scope tube on
       the rail, the can on the muzzle, the grip under the barrel) so what you
       bought is what you SEE — first person, third person, every instance.
     • the GUNSMITH BENCH menu the gun store opens ([E] at the bench).

   Self-contained + economy-gated (CBZ.economyMode: Gang City and the Isles,
   where every island gun store keeps the bench in its back room): no effect
   (all muls === 1, supp false) when nothing's fitted or this file never
   loaded, so jail/survival stay identical.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  // the one gate for money and the shops: Gang City and the islands
  function econOn() { return !!g && (CBZ.economyMode ? CBZ.economyMode(g.mode) : g.mode === "city"); }

  // ---- weapon groups (compatibility) ---------------------------------------
  const PISTOLS = { sidearm: 1, revolver: 1, deagle: 1 };
  const SMGS = { smg: 1, uzi: 1 };
  const RIFLES = { carbine: 1, ak47: 1 };
  const MG = { lmg: 1 };
  const SNIPERS = { sniper: 1 };
  const SHOTGUNS = { shotgun: 1 };
  const NOMOD = { bazooka: 1, glauncher: 1, taser: 1, grenade: 1 };   // launchers / stun / thrown take nothing

  function isFirearm(id) { return !!id && !NOMOD[id]; }

  // ---- the catalog ---------------------------------------------------------
  // slot: only one mod per slot at a time (a new buy replaces the old one).
  // fits(id): true when this mod can bolt onto weapon `id`.
  // Effect fields are read by the hooks below.
  const MODS = {
    // ---- OPTICS (slot "scope") — fov is the aimed-lens the scope forces ----
    reddot:  { id: "reddot",  name: "Red Dot Sight",        slot: "scope", price: 900,
               blurb: "1× illuminated dot, fast target pickup, tiny zoom.",
               scope: { fov: 42, overlay: "dot",    tint: "#ff5b5b" },
               fits: (id) => isFirearm(id) },
    reflex:  { id: "reflex",  name: "Reflex Sight",         slot: "scope", price: 1100,
               blurb: "1× open reflex, wide window, unlimited eye relief.",
               scope: { fov: 43, overlay: "reflex", tint: "#5bff8a" },
               fits: (id) => isFirearm(id) },
    holo:    { id: "holo",    name: "Holographic Sight",    slot: "scope", price: 1600,
               blurb: "1× holo ring + chevron, both eyes open, fastest CQB.",
               scope: { fov: 40, overlay: "holo",   tint: "#5bff8a" },
               fits: (id) => isFirearm(id) },
    acog:    { id: "acog",    name: "Tactical Scope · 4×",  slot: "scope", price: 2800,
               blurb: "4× prism (ACOG), mid-range precision, chevron reticle.",
               scope: { fov: 26, overlay: "acog",   tint: "#ffcf5b" },
               fits: (id) => SMGS[id] || RIFLES[id] || MG[id] || SNIPERS[id] },
    sniper:  { id: "sniper",  name: "Sniper Scope · 8×",    slot: "scope", price: 4500,
               blurb: "8× magnified, full scoped view + mil-dot crosshair.",
               scope: { fov: 11, overlay: "scope", highMag: true, tint: "#e8f4ff" },
               fits: (id) => RIFLES[id] || SNIPERS[id] || MG[id] },
    thermal: { id: "thermal", name: "Thermal Scope · 6×",   slot: "scope", price: 8000,
               blurb: "6× white-hot thermal, targets glow through the dark.",
               scope: { fov: 17, overlay: "scope", highMag: true, thermal: true, tint: "#ff9a3c" },
               fits: (id) => RIFLES[id] || SNIPERS[id] || MG[id] },

    // ---- MAGS (slot "mag") -------------------------------------------------
    extmag:  { id: "extmag",  name: "Extended Mag",         slot: "mag", price: 1200,
               blurb: "+50% capacity, fewer reloads mid-fight.",
               magMul: 1.5,
               fits: (id) => isFirearm(id) },
    drummag: { id: "drummag", name: "Drum Mag",             slot: "mag", price: 3000,
               blurb: "2.5× capacity, spray without breathing.",
               magMul: 2.5,
               fits: (id) => SMGS[id] || RIFLES[id] || MG[id] },

    // ---- MUZZLE (slot "muzzle") -------------------------------------------
    suppressor: { id: "suppressor", name: "Suppressor",     slot: "muzzle", price: 2200,
               blurb: "Kills the flash, muffles the shot, halves the noise, go quiet.",
               suppress: true, spreadMul: 0.96,
               fits: (id) => isFirearm(id) },
    brake:   { id: "brake",   name: "Muzzle Brake",         slot: "muzzle", price: 1400,
               blurb: "Vents gas up, cuts muzzle climb ~30%.",
               recoilMul: 0.7,
               fits: (id) => isFirearm(id) },

    // ---- UNDER-BARREL / RAIL (slot "under") -------------------------------
    grip:    { id: "grip",    name: "Tactical Grip",        slot: "under", price: 1000,
               blurb: "Foregrip, steadier hold, tighter cone.",
               recoilMul: 0.85, spreadMul: 0.9,
               fits: (id) => SMGS[id] || RIFLES[id] || MG[id] || SHOTGUNS[id] || SNIPERS[id] },
    laser:   { id: "laser",   name: "Laser Sight",          slot: "under", price: 1300,
               blurb: "Boresight laser, much tighter hip-fire.",
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
  // the fitted optic spec (or null) — systems/sights.js reads it
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
  //  VISUAL — bolt real attachments onto the held gun
  //
  //  Every part is authored in REAL METRES (an Aimpoint Micro is 68 mm long,
  //  a rifle can 38 mm across) in its own little group, and that group is
  //  scaled by the gun's anchors.k (model units per real metre, the
  //  contract in weapons/appearances/sidearm.js). So a suppressor on a Glock
  //  and one on an M4 are the same real object at each gun's own scale, and
  //  nothing here guesses a "pistol shrink" factor.
  //
  //  WHERE each part goes is measured, not assumed: the muzzle device seats
  //  on anchors.muzzle; the optic, foregrip and laser are placed by casting a
  //  ray at the DRAWN gun (the rail top, the handguard's belly, its 3 o'clock
  //  flank), so they sit on the surface of whichever appearance is in hand.
  //
  //  MAGAZINES are real too: an extended mag stretches the gun's own
  //  part_mag meshes along the mag's axis about its top, a drum swaps their
  //  geometry for a drum + feed neck. The swap happens ON the part_mag mesh
  //  (geometry only, the original kept in userData._gmGeo), so the reload
  //  rig (systems/gunhands.js), which moves part_mag, carries the drum out
  //  and back in. Removing the mod restores the original geometry.
  // ==========================================================================
  const M = {};   // shared materials
  const GEO = {}; // shared geometry cache (real-metre parts, keyed by name)
  function mats() {
    if (M._ready || !THREE) return M;
    const ph = (c, sh, sp, o) => { const m = new THREE.MeshPhongMaterial(Object.assign({ color: c, shininess: sh, specular: sp }, o || {})); m._shared = true; return m; };
    const lb = (o) => { const m = new THREE.MeshLambertMaterial(o); m._shared = true; return m; };
    M.dark = ph(0x1b1d20, 22, 0x2a2e34);          // hard-anodised black aluminium
    M.steel = ph(0x30353b, 30, 0x3c434b);         // parkerised steel / screws
    M.can = ph(0x222427, 12, 0x24272b);           // high-temp cerakote can
    M.poly = lb({ color: 0x18191b });             // glass-filled polymer (grip, laser)
    M.rubber = lb({ color: 0x0f1011 });
    M.port = lb({ color: 0x050506 });             // the black of a port / bore
    M.glass = ph(0x1d2a33, 90, 0x8fb4cc, { transparent: true, opacity: 0.55, depthWrite: false });
    M.glassRed = ph(0x3a1a12, 90, 0xd8a080, { transparent: true, opacity: 0.6, depthWrite: false });
    M.lensRed = lb({ color: 0x2a0000, emissive: 0xff3b2e, emissiveIntensity: 1.0 });
    M.lensGreen = lb({ color: 0x00220f, emissive: 0x4dff86, emissiveIntensity: 0.9 });
    M.lensAmber = lb({ color: 0x231600, emissive: 0xffc24d, emissiveIntensity: 0.85 });
    M.lensCyan = lb({ color: 0x00201f, emissive: 0x6fe6ff, emissiveIntensity: 0.85 });
    M.laser = (function () { const m = new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.32, depthWrite: false }); m._shared = true; return m; })();
    M._ready = true;
    return M;
  }
  function lensMat(tint) {
    if (tint === "#5bff8a") return M.lensGreen;
    if (tint === "#ffcf5b" || tint === "#ffc24d") return M.lensAmber;
    if (tint === "#e8f4ff" || tint === "#ff9a3c") return M.lensCyan;
    return M.lensRed;
  }

  // ---- real-metre geometry helpers (cached; every geo _shared) ------------
  function cg(key, make) {
    let gg = GEO[key];
    if (!gg) { gg = GEO[key] = make(); gg._shared = true; }
    return gg;
  }
  function shapeOf(Ctor, pts) {
    const s = new Ctor();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    s.closePath();
    return s;
  }
  // a part turned about the bore: pts [radius, forward], forward = -z
  function latheZ(key, pts, segs) {
    return cg("lz:" + key, () => {
      const g = new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), segs || 20);
      g.rotateX(-Math.PI / 2);
      g.computeVertexNormals();
      return g;
    });
  }
  // a part turned about +Y: pts [radius, y]
  function latheY(key, pts, segs) {
    return cg("ly:" + key, () => {
      const g = new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), segs || 16);
      g.computeVertexNormals();
      return g;
    });
  }
  // a side profile [forward, up] extruded across the gun (x), chamfered
  function side(key, pts, width, bevel) {
    return cg("sd:" + key, () => {
      const b = bevel == null ? 0.0012 : bevel, depth = Math.max(0.0005, width - 2 * b);
      const g = new THREE.ExtrudeGeometry(shapeOf(THREE.Shape, pts), { depth: depth, steps: 1, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: 4 });
      g.translate(0, 0, -depth / 2);
      g.rotateY(Math.PI / 2);          // shape x (forward) -> -z, extrusion -> x
      g.computeVertexNormals();
      return g;
    });
  }
  // a front profile [x, y] (holes allowed) extruded along the bore
  function front(key, pts, holes, depth, bevel) {
    return cg("fr:" + key, () => {
      const b = bevel == null ? 0.0008 : bevel, d = Math.max(0.0005, depth - 2 * b);
      const s = shapeOf(THREE.Shape, pts);
      (holes || []).forEach((h) => s.holes.push(shapeOf(THREE.Path, h)));
      const g = new THREE.ExtrudeGeometry(s, { depth: d, steps: 1, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: 6 });
      g.translate(0, 0, -d / 2);
      g.computeVertexNormals();
      return g;
    });
  }
  function boxG(w, h, d) { return cg("bx:" + w + ":" + h + ":" + d, () => new THREE.BoxGeometry(w, h, d)); }
  function cylX(r, len, segs) { return cg("cx:" + r + ":" + len, () => new THREE.CylinderGeometry(r, r, len, segs || 12).rotateZ(Math.PI / 2)); }
  function cylY(r, len, segs) { return cg("cy:" + r + ":" + len, () => new THREE.CylinderGeometry(r, r, len, segs || 12)); }
  function cylZ(r, len, segs) { return cg("cz:" + r + ":" + len, () => new THREE.CylinderGeometry(r, r, len, segs || 16).rotateX(Math.PI / 2)); }
  function put(parent, geo, mat, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = false;
    parent.add(m);
    return m;
  }
  // a part group authored in real metres, scaled into the gun's units
  function partGroup(name, k) {
    const g = new THREE.Group();
    g.name = name;
    g.scale.setScalar(k);
    return g;
  }

  // ---- the parts (real metres; origin = the mounting point; -Z forward) ---

  // Suppressors: a rifle can (38 mm x 170 mm, QD collar over the flash hider)
  // and a 9 mm can (33 mm x 165 mm with its booster housing step).
  function suppressor(nine) {
    const g = new THREE.Group();
    if (nine) {
      put(g, latheZ("can9", [[0, -0.020], [0.0105, -0.020], [0.0125, -0.017], [0.0125, -0.004], [0.0150, -0.002],
        [0.0165, 0.002], [0.0165, 0.138], [0.0155, 0.143], [0.0110, 0.146], [0.0045, 0.146], [0.0045, 0.141], [0, 0.141]], 22), M.can);
      put(g, latheZ("can9.band", [[0.0168, 0.004], [0.0168, 0.010]], 22), M.steel);
    } else {
      put(g, latheZ("can556", [[0, -0.042], [0.0150, -0.042], [0.0178, -0.039], [0.0178, -0.031], [0.0172, -0.029],
        [0.0172, -0.025], [0.0190, -0.022], [0.0190, 0.120], [0.0178, 0.126], [0.0120, 0.130], [0.0048, 0.130],
        [0.0048, 0.124], [0, 0.124]], 24), M.can);
      // the QD collar's knurl: three raised rings
      for (let i = 0; i < 3; i++) put(g, latheZ("can556.k", [[0.0181, 0], [0.0181, 0.0022]], 24), M.steel, 0, 0, 0.040 - i * 0.0045);
      put(g, latheZ("can556.band", [[0.0192, 0], [0.0192, 0.006]], 24), M.steel, 0, 0, -0.112);
    }
    return g;
  }
  // Muzzle brakes: a three-port rifle brake, a ported pistol compensator.
  function brake(nine) {
    const g = new THREE.Group();
    if (nine) {
      put(g, side("comp9", [[-0.004, -0.010], [0.030, -0.010], [0.032, -0.006], [0.032, 0.011], [0.026, 0.013], [-0.004, 0.013]], 0.024, 0.0015), M.dark);
      for (let i = 0; i < 3; i++) put(g, boxG(0.012, 0.003, 0.0045), M.port, 0, 0.0128, -0.008 - i * 0.008);
      put(g, cylZ(0.0045, 0.002, 12), M.port, 0, 0, -0.0322);
    } else {
      put(g, latheZ("brake556", [[0, -0.010], [0.0100, -0.010], [0.0112, -0.007], [0.0112, 0.050], [0.0100, 0.054],
        [0.0042, 0.054], [0.0042, 0.050], [0, 0.050]], 18), M.dark);
      for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) put(g, boxG(0.004, 0.012, 0.0052), M.port, sx * 0.0098, 0, -0.012 - i * 0.012);
      for (let i = 0; i < 2; i++) put(g, boxG(0.0042, 0.004, 0.0042), M.port, 0, 0.0099, -0.016 - i * 0.012);
      put(g, boxG(0.0232, 0.010, 0.006), M.dark, 0, 0, 0.002);   // wrench flats
    }
    return g;
  }
  // A vertical foregrip on a Picatinny clamp, finger-grooved; origin = the
  // rail's belly, the grip hangs down -Y.
  function foregrip() {
    const g = new THREE.Group();
    put(g, side("vfg.clamp", [[-0.022, -0.012], [0.022, -0.012], [0.025, -0.006], [0.025, 0.0], [-0.025, 0.0], [-0.025, -0.006]], 0.030, 0.0015), M.dark);
    put(g, cylX(0.0032, 0.034, 8), M.steel, 0, -0.006, 0.012);   // cross-bolt
    put(g, latheY("vfg.body", [[0, -0.104], [0.0140, -0.103], [0.0160, -0.098], [0.0162, -0.088], [0.0153, -0.080],
      [0.0160, -0.072], [0.0151, -0.063], [0.0157, -0.055], [0.0149, -0.046], [0.0150, -0.022], [0.0140, -0.012], [0, -0.012]], 16), M.poly);
    put(g, latheY("vfg.cap", [[0, -0.109], [0.0130, -0.109], [0.0148, -0.104], [0, -0.104]], 16), M.rubber);
    return g;
  }
  // A compact laser module (DBAL/CMR class) on its rail clamp; origin = the
  // rail surface, the unit stands off +Y. Its emitter is returned so the
  // boresight beam can be laid from it.
  function laser() {
    const g = new THREE.Group();
    put(g, side("lsr.clamp", [[-0.018, 0], [0.018, 0], [0.018, 0.006], [-0.018, 0.006]], 0.024, 0.001), M.dark);
    put(g, side("lsr.body", [[-0.032, 0.006], [0.024, 0.006], [0.030, 0.011], [0.030, 0.026], [0.024, 0.031], [-0.028, 0.031], [-0.032, 0.026]], 0.026, 0.002), M.poly);
    put(g, latheZ("lsr.emit", [[0.0068, 0], [0.0068, 0.008], [0.0055, 0.010], [0, 0.010]], 14), M.dark, 0, 0.0185, -0.028);
    const em = put(g, cylZ(0.0042, 0.0012, 14), M.lensRed, 0, 0.0185, -0.0386);
    put(g, cylZ(0.0035, 0.0012, 10), M.glass, 0.007, 0.0122, -0.0306);   // IR window
    put(g, boxG(0.010, 0.004, 0.012), M.rubber, 0, 0.032, 0.012);       // pressure switch
    put(g, cylX(0.0035, 0.003, 10), M.steel, 0.0145, 0.0185, 0.004);     // adjuster
    g.userData.emitter = em;
    return g;
  }

  // Optics. Each returns a group in real metres whose origin sits on the
  // rail top, and stamps its own anchors (CBZ.gunAnchors.optic, k = 1 since
  // the group's own scale carries the gun's k into model space).
  function stampOptic(g, o) {
    g.userData.isWeaponOptic = true;
    if (CBZ.gunAnchors && CBZ.gunAnchors.optic) CBZ.gunAnchors.optic(THREE, g, Object.assign({ k: 1 }, o));
  }
  // Aimpoint Micro T-2 on a riser: a 30 mm-class body, flip caps' hinges,
  // turret caps on top and right.
  function redDot(tint) {
    const g = new THREE.Group(), H = 0.0335;
    put(g, side("rd.mount", [[-0.026, 0], [0.026, 0], [0.026, 0.006], [0.020, 0.012], [0.018, 0.020], [-0.018, 0.020], [-0.020, 0.012], [-0.026, 0.006]], 0.026, 0.0015), M.dark);
    put(g, cylX(0.0055, 0.008, 12), M.steel, -0.016, 0.006, 0.004);       // clamp knob
    put(g, latheZ("rd.body", [[0.0102, -0.034], [0.0135, -0.034], [0.0142, -0.031], [0.0142, -0.013], [0.0131, -0.011],
      [0.0131, 0.011], [0.0142, 0.013], [0.0142, 0.031], [0.0135, 0.034], [0.0102, 0.034], [0.0102, -0.034]], 24), M.dark, 0, H, 0);
    put(g, cylY(0.0078, 0.0085, 14), M.dark, 0, H + 0.0158, 0);            // elevation cap
    put(g, cylX(0.0078, 0.0085, 14), M.dark, 0.0158, H, 0);                // windage cap
    put(g, side("rd.neck", [[-0.010, 0.019], [0.010, 0.019], [0.010, H - 0.008], [-0.010, H - 0.008]], 0.016, 0.001), M.dark);
    put(g, cylZ(0.0101, 0.0012, 20), M.glass, 0, H, 0.030);
    put(g, cylZ(0.0101, 0.0012, 20), M.glassRed, 0, H, -0.030);
    put(g, cylZ(0.0006, 0.0008, 6), lensMat(tint), 0, H, -0.029);          // the dot
    stampOptic(g, { type: "reddot", mag: 1, rear: [0, H, 0.034], front: [0, H, -0.034], lensR: 0.0102, eyeRelief: 0.20 });
    return g;
  }
  // An open reflex (RMR class): a low body, a hooded window, the emitter at
  // the back. Low enough to ride a pistol slide.
  function reflex(tint, riser) {
    const g = new THREE.Group(), r = riser ? 0.020 : 0;
    if (riser) put(g, side("rx.riser", [[-0.026, 0], [0.024, 0], [0.024, 0.014], [0.020, 0.020], [-0.026, 0.020]], 0.024, 0.0015), M.dark);
    put(g, side("rx.base", [[-0.024, 0], [0.022, 0], [0.022, 0.006], [0.016, 0.009], [-0.020, 0.009], [-0.024, 0.006]], 0.025, 0.0012), M.dark, 0, r, 0);
    put(g, front("rx.hood", [[-0.0128, 0], [0.0128, 0], [0.0124, 0.019], [0.0080, 0.0255], [-0.0080, 0.0255], [-0.0124, 0.019]],
      [[[-0.0102, 0.0068], [0.0102, 0.0068], [0.0098, 0.0175], [0.0064, 0.0225], [-0.0064, 0.0225], [-0.0098, 0.0175]]], 0.010, 0.0008), M.dark, 0, r, -0.016);
    put(g, boxG(0.0196, 0.0150, 0.0010), M.glassRed, 0, r + 0.0140, -0.016, 0.12, 0, 0);
    put(g, side("rx.emit", [[0.002, 0.006], [0.016, 0.006], [0.016, 0.0095], [0.004, 0.0115]], 0.012, 0.0008), M.dark, 0, r, 0);
    put(g, boxG(0.003, 0.0018, 0.002), lensMat(tint), 0, r + 0.0108, 0.004);
    put(g, cylX(0.0028, 0.002, 8), M.steel, 0.0130, r + 0.0045, 0.010);      // screw heads
    put(g, cylX(0.0028, 0.002, 8), M.steel, 0.0130, r + 0.0045, -0.010);
    const H = r + 0.0145;
    stampOptic(g, { type: "reddot", mag: 1, rear: [0, H, -0.011], front: [0, H, -0.021], lensR: 0.0095, eyeRelief: 0.26 });
    return g;
  }
  // EOTech EXPS-class holographic: battery body over a QD clamp, the tall
  // hood with front and rear windows, the button pad at the back.
  function holo(tint) {
    const g = new THREE.Group(), WY = 0.0455;
    put(g, side("ho.clamp", [[-0.048, 0], [0.044, 0], [0.044, 0.006], [0.040, 0.012], [-0.048, 0.012]], 0.032, 0.0015), M.dark);
    put(g, side("ho.body", [[-0.052, 0.012], [0.032, 0.012], [0.042, 0.019], [0.042, 0.030], [-0.052, 0.030]], 0.036, 0.002), M.dark);
    put(g, front("ho.hood", [[-0.0205, 0.028], [0.0205, 0.028], [0.0195, 0.0610], [0.0155, 0.0660], [-0.0155, 0.0660], [-0.0195, 0.0610]],
      [[[-0.0168, 0.0325], [0.0168, 0.0325], [0.0168, 0.0590], [-0.0168, 0.0590]]], 0.062, 0.0012), M.dark, 0, 0, -0.012);
    put(g, boxG(0.0336, 0.0265, 0.0010), M.glass, 0, WY, 0.0185);
    put(g, boxG(0.0336, 0.0265, 0.0010), M.glassRed, 0, WY, -0.0425);
    put(g, cylZ(0.0035, 0.0006, 16), lensMat(tint), 0, WY, -0.0420);         // the ring of the reticle
    put(g, boxG(0.012, 0.007, 0.004), M.rubber, -0.010, 0.022, 0.0335);      // buttons
    put(g, boxG(0.012, 0.007, 0.004), M.rubber, 0.010, 0.022, 0.0335);
    put(g, side("ho.qd", [[-0.040, 0.002], [0.030, 0.004], [0.040, 0.008], [0.036, 0.012], [-0.040, 0.011]], 0.004, 0.0006), M.steel, -0.0175, 0, 0);
    put(g, cylX(0.006, 0.012, 12), M.steel, 0.020, 0.006, 0.020);            // cross-bolt nut
    stampOptic(g, { type: "holo", mag: 1, rear: [0, WY, 0.0185], front: [0, WY, -0.0425], lensR: 0.016, eyeRelief: 0.18 });
    return g;
  }

  // ---- measuring the drawn gun --------------------------------------------
  const RC = THREE ? new THREE.Raycaster() : null;
  const _o = THREE ? new THREE.Vector3() : null, _d = THREE ? new THREE.Vector3() : null;
  const _inv = THREE ? new THREE.Matrix4() : null;
  function solidParts(model, only) {
    const out = [];
    (only || model).traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      for (let p = o; p && p !== model; p = p.parent) {
        if (p.visible === false || p.name === "_gmods" || p.name === "part_mag" || (p.userData && p.userData.fpGripHand)) return;
      }
      if (o.material && o.material.transparent) return;
      out.push(o);
    });
    return out;
  }
  // the first surface of the drawn gun along a model-space ray, in model space
  function hit(model, ox, oy, oz, dx, dy, dz, only) {
    if (!RC) return null;
    model.updateMatrixWorld(true);
    _o.set(ox, oy, oz).applyMatrix4(model.matrixWorld);
    _d.set(dx, dy, dz).transformDirection(model.matrixWorld);
    RC.set(_o, _d);
    RC.near = 0; RC.far = Infinity;
    const hits = RC.intersectObjects(solidParts(model, only), false);
    if (!hits.length) return null;
    _inv.copy(model.matrixWorld).invert();
    return hits[0].point.clone().applyMatrix4(_inv);
  }
  function anchorsOf(model) { return (model.userData && model.userData.anchors) || null; }
  function relMatrix(obj, model) {
    const m = new THREE.Matrix4();
    for (let o = obj; o && o !== model; o = o.parent) { o.updateMatrix(); m.premultiply(o.matrix); }
    return m;
  }

  // ---- magazines ------------------------------------------------------------
  const EMPTY = THREE ? (function () { const e = new THREE.BufferGeometry(); e.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3)); e.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(9), 3)); e._shared = true; return e; })() : null;
  const MAGGEO = new Map();
  function magParts(model) {
    const out = [];
    model.traverse(function (o) { if (o.isMesh && o.name === "part_mag" && o.geometry) out.push(o); });
    return out;
  }
  function restoreMags(model) {
    model.traverse(function (o) {
      if (o.userData && o.userData._gmGeo) { o.geometry = o.userData._gmGeo; delete o.userData._gmGeo; }
    });
  }
  // extent of the mag parts along unit axis a (model space): [min, max]
  function extentAlong(parts, model, a) {
    let lo = Infinity, hi = -Infinity;
    const v = new THREE.Vector3();
    parts.forEach(function (o) {
      const R = relMatrix(o, model), pa = o.geometry.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        v.fromBufferAttribute(pa, i).applyMatrix4(R);
        const s = v.dot(a);
        if (s < lo) lo = s; if (s > hi) hi = s;
      }
    });
    return [lo, hi];
  }
  // merge [{geo, matrix}] into one non-indexed position+normal geometry
  function merge(list) {
    let n = 0;
    const parts = list.map(function (e) { const g = e.geo.index ? e.geo.toNonIndexed() : e.geo.clone(); g.applyMatrix4(e.m); n += g.attributes.position.count; return g; });
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3);
    let at = 0;
    parts.forEach(function (g) {
      P.set(g.attributes.position.array, at * 3);
      N.set(g.attributes.normal.array, at * 3);
      at += g.attributes.position.count;
      g.dispose();
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(P, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    out.computeBoundingBox(); out.computeBoundingSphere();
    out._shared = true;
    return out;
  }
  function magAxis(A) {
    if (!A || !A.mag || !A.mag.quat) return null;
    const a = new THREE.Vector3(0, 1, 0).applyQuaternion(A.mag.quat).normalize();
    if (a.y < 0) a.negate();
    return a.y > 0.55 ? a : null;   // only a mag that hangs under the gun changes shape
  }
  function swapGeo(o, geo) {
    if (!o.userData._gmGeo) o.userData._gmGeo = o.geometry;
    o.geometry = geo;
  }
  // stretch the gun's own magazine by `addM` real metres, about its top
  function extendMag(model, A, addM) {
    const a = magAxis(A), parts = magParts(model);
    if (!a || !parts.length) return;
    const ex = extentAlong(parts, model, a), len = ex[1] - ex[0];
    if (!(len > 1e-4)) return;
    const f = 1 + (addM * A.k) / len;
    // S = T(top) * (I + (f-1) a a^T) * T(-top), top on the axis line
    const S = new THREE.Matrix4().set(
      1 + (f - 1) * a.x * a.x, (f - 1) * a.x * a.y, (f - 1) * a.x * a.z, 0,
      (f - 1) * a.y * a.x, 1 + (f - 1) * a.y * a.y, (f - 1) * a.y * a.z, 0,
      (f - 1) * a.z * a.x, (f - 1) * a.z * a.y, 1 + (f - 1) * a.z * a.z, 0,
      0, 0, 0, 1);
    const top = a.clone().multiplyScalar(ex[1]);
    const T = new THREE.Matrix4().makeTranslation(top.x, top.y, top.z).multiply(S).multiply(new THREE.Matrix4().makeTranslation(-top.x, -top.y, -top.z));
    parts.forEach(function (o) {
      const R = relMatrix(o, model), L = R.clone().invert().multiply(T).multiply(R);
      const key = "x:" + o.geometry.uuid + ":" + L.elements.map(function (e) { return e.toFixed(4); }).join(",");
      let g2 = MAGGEO.get(key);
      if (!g2) { g2 = o.geometry.clone(); g2.applyMatrix4(L); g2.computeBoundingSphere(); g2._shared = true; MAGGEO.set(key, g2); }
      swapGeo(o, g2);
    });
  }
  // a drum (AK-75 / Beta-C class: one drum, its feed neck) in place of the mag
  function drumMag(model, A, smgSize) {
    const a = magAxis(A), parts = magParts(model);
    if (!a || !parts.length) return;
    const k = A.k;
    const well = (A.mag.well || A.mag.pos).clone();
    const R = (smgSize ? 0.050 : 0.062) * k, T = (smgSize ? 0.050 : 0.068) * k;
    const neck = (smgSize ? 0.030 : 0.040) * k;
    // the feed neck: the mag's own cross-section, from inside the well down
    const b = new THREE.Box3();
    parts.forEach(function (o) { const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox(); b.union(g.boundingBox.clone().applyMatrix4(relMatrix(o, model))); });
    const w = Math.min(b.max.x - b.min.x, 0.030 * k), d = Math.min(b.max.z - b.min.z, (smgSize ? 0.034 : 0.062) * k);
    const up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion().setFromUnitVectors(up, a);
    const neckTop = well.clone().addScaledVector(a, 0.02 * k);
    const neckLen = neck + 0.02 * k + R * 0.35;
    const neckC = neckTop.clone().addScaledVector(a, -neckLen / 2);
    const drumC = neckTop.clone().addScaledVector(a, -(neckLen + R * 0.62));
    const key = "d:" + (smgSize ? 1 : 0) + ":" + [k, well.x, well.y, well.z, a.x, a.y, a.z, w, d].map(function (v) { return (+v).toFixed(4); }).join(",");
    let geo = MAGGEO.get(key);
    if (!geo) {
      const shell = new THREE.LatheGeometry([[0, -T / 2], [R * 0.50, -T / 2], [R * 0.93, -T / 2 + 0.002 * k], [R, -T / 2 + 0.008 * k],
        [R, T / 2 - 0.008 * k], [R * 0.93, T / 2 - 0.002 * k], [R * 0.50, T / 2], [0, T / 2]].map(function (p) { return new THREE.Vector2(p[0], p[1]); }), 28);
      shell.rotateZ(Math.PI / 2);   // turn axis across the gun (x)
      shell.computeVertexNormals();
      const rib = new THREE.LatheGeometry([[R * 0.62, -0.003 * k], [R * 0.66, 0], [R * 0.66, 0.002 * k], [R * 0.62, 0.003 * k]].map(function (p) { return new THREE.Vector2(p[0], p[1]); }), 24);
      rib.rotateZ(Math.PI / 2); rib.computeVertexNormals();
      const knob = new THREE.CylinderGeometry(0.010 * k, 0.012 * k, 0.010 * k, 12).rotateZ(Math.PI / 2);
      const wing = new THREE.BoxGeometry(0.004 * k, 0.030 * k, 0.006 * k);
      const neckG = new THREE.BoxGeometry(w, neckLen, d);
      const at = function (p, rq, ox) { const m = new THREE.Matrix4().compose(p.clone().add(new THREE.Vector3(ox || 0, 0, 0)), rq || new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)); return m; };
      geo = merge([
        { geo: shell, m: at(drumC) },
        { geo: rib, m: at(drumC, null, -T / 2 - 0.0005 * k) },
        { geo: rib, m: at(drumC, null, T / 2 + 0.0005 * k) },
        { geo: knob, m: at(drumC, null, -T / 2 - 0.005 * k) },
        { geo: wing, m: at(drumC, null, -T / 2 - 0.011 * k) },
        { geo: neckG, m: at(neckC, q) },
      ]);
      [shell, rib, knob, wing, neckG].forEach(function (g0) { g0.dispose(); });
      MAGGEO.set(key, geo);
    }
    parts.forEach(function (o, i) {
      if (i > 0) { swapGeo(o, EMPTY); return; }
      const L = relMatrix(o, model).invert();
      const k2 = key + ":" + L.elements.map(function (e) { return e.toFixed(4); }).join(",");
      let g2 = MAGGEO.get(k2);
      if (!g2) { g2 = geo.clone(); g2.applyMatrix4(L); g2.computeBoundingSphere(); g2._shared = true; MAGGEO.set(k2, g2); }
      swapGeo(o, g2);
    });
  }

  // build the attachment child-group for a weapon id from its fitted record.
  // Placement reads the model's anchors (muzzle, grip, support, mag, k) and
  // the drawn surface under them; a model without anchors falls back to its
  // userData.muzzle and a k of 2.
  function buildAttachGroup(id, model) {
    const r = store()[id]; if (!r) return null;
    if (!r.scope && !r.mag && !r.muzzle && !r.under) return null;
    mats();
    const grp = new THREE.Group();
    grp.name = "_gmods";
    const A = anchorsOf(model);
    const k = (A && A.k) || 2.0;
    const mz = (A && A.muzzle && A.muzzle.pos) || (model.userData && model.userData.muzzle) || new THREE.Vector3(0, 0.05, -0.6);
    const pistol = !!PISTOLS[id];
    const nine = pistol || !!SMGS[id];
    const gripZ = A && A.grip ? A.grip.pos.z : mz.z * 0.15;
    const top = function (z, fallbackY) {
      const h = hit(model, 0, mz.y + 5, z, 0, -1, 0);
      return h ? h.y : fallbackY;
    };

    // ---- OPTIC on the top rail ----
    if (r.scope && MODS[r.scope]) {
      const sp = MODS[r.scope].scope || {};
      const base = model.getObjectByName && model.getObjectByName("_baseOptic");
      let zM;
      if (base) {
        const bb = new THREE.Box3();
        base.traverse(function (o) { if (o.isMesh && o.geometry) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); bb.union(o.geometry.boundingBox.clone().applyMatrix4(relMatrix(o, model))); } });
        zM = bb.isEmpty() ? gripZ - 0.10 * k : (bb.min.z + bb.max.z) / 2;
      } else if (pistol && A && A.sight && A.sight.rear) zM = A.sight.rear.z - 0.034 * k;
      else zM = gripZ - (pistol || id === "uzi" ? 0.03 : 0.10) * k;   // a mag-in-grip gun's top cover sits over its grip
      // the LOWEST surface across the mount's footprint, so a sight post or
      // a rear-sight ear under one sample does not lift the whole optic
      const fy = mz.y + (pistol ? 0.03 : 0.05) * k;
      const railY = Math.min(top(zM - 0.018 * k, fy), top(zM, fy), top(zM + 0.018 * k, fy));
      let opt = null;
      if (r.scope === "reddot") opt = pistol ? reflex(sp.tint, false) : redDot(sp.tint);
      else if (r.scope === "reflex") opt = reflex(sp.tint, !pistol);
      else if (r.scope === "holo") opt = holo(sp.tint);
      if (opt) {
        const og = partGroup("fitted-" + r.scope, k);
        og.add(opt);
        og.position.set(0, railY, zM);
        // the anchors ride the inner group: carry them onto the outer one
        og.userData.isWeaponOptic = true;
        if (opt.userData.opticAnchors && CBZ.gunAnchors && CBZ.gunAnchors.inParent) {
          const rec = CBZ.gunAnchors.inParent(THREE, opt, og, opt.userData.opticAnchors);
          og.userData.opticAnchors = rec;
        }
        opt.userData.isWeaponOptic = false;
        grp.add(og);
      } else if (CBZ.createWeaponOptic) {
        // the magnified glass is the one riflescope factory (weapons/optics.js)
        const high = !!sp.highMag;
        const tR = (high ? 0.0152 : 0.0150) * k;
        const drop = tR + (high ? 0.022 : 0.016) * k;
        grp.add(CBZ.createWeaponOptic({
          name: "fitted-" + r.scope, x: 0, y: railY + drop, z: zM,
          length: (high ? (sp.thermal ? 0.26 : 0.33) : 0.165) * k, radius: tR,
          objectiveRadius: (high ? 0.027 : 0.0205) * k, ocularRadius: 0.0195 * k,
          mountDrop: drop, highMag: high, tint: sp.tint, k: k,
          mag: high ? (sp.thermal ? 6 : 8) : 4,
          materials: { dark: M.dark, steel: M.steel },
        }));
      }
    }

    // ---- MUZZLE device (suppressor OR brake) on the bore's exit ----
    if (r.muzzle && MODS[r.muzzle]) {
      const dev = partGroup("fitted-" + r.muzzle, k);
      dev.add(MODS[r.muzzle].suppress ? suppressor(nine) : brake(nine));
      dev.position.copy(mz);
      grp.add(dev);
    }

    // ---- UNDER-BARREL / RAIL (grip OR laser) ----
    if (r.under && MODS[r.under]) {
      const sup = A && A.support;
      if (r.under === "grip") {
        // on the pump when there is one (it slides with it), else under the guard
        const pump = model.userData && model.userData.pump;
        const host = (sup && sup.kind === "pump" && pump && pump.isObject3D) ? pump : null;
        const zG = sup && sup.kind !== "cup" ? sup.pos.z - 0.02 * k : (mz.z + gripZ) * 0.5;
        const h = hit(model, 0, mz.y - 5, zG, 0, 1, 0, host || null);
        const yB = h ? h.y : mz.y - 0.03 * k;
        const fg = partGroup("fitted-grip", k);
        fg.add(foregrip());
        if (host) {
          const p = new THREE.Vector3(0, yB, zG).applyMatrix4(relMatrix(host, model).invert());
          fg.position.copy(p);
          fg.userData.onPump = true;
          host.add(fg);
          grp.userData.pumpPart = fg;
        } else {
          fg.position.set(0, yB, zG);
          grp.add(fg);
        }
      } else if (r.under === "laser") {
        const lz = new THREE.Group();
        const unit = laser();
        const lg = partGroup("fitted-laser", k);
        lg.add(unit);
        let ok = false;
        if (!pistol && sup && sup.kind !== "cup") {
          // the 3 o'clock rail, ahead of the support hand
          const zL = Math.max(mz.z + 0.06 * k, sup.pos.z - 0.05 * k);
          const yL = mz.y;
          const h = hit(model, 2 + 0.5 * k, yL, zL, -1, 0, 0);
          if (h) { lg.position.set(h.x, yL, zL); lg.rotation.z = -Math.PI / 2; ok = true; }
        }
        if (!ok) {
          // under the dust cover, ahead of the trigger guard
          const zL = mz.z * 0.62 + gripZ * 0.38;
          const h = hit(model, 0, mz.y - 5, zL, 0, 1, 0);
          lg.position.set(0, h ? h.y : mz.y - 0.03 * k, zL);
          lg.rotation.z = Math.PI;
        }
        lz.add(lg);
        grp.add(lz);
        // the boresight beam from the emitter, parallel to the bore
        lz.updateMatrixWorld(true);
        const e = new THREE.Vector3();
        unit.userData.emitter.updateMatrixWorld(true);
        unit.userData.emitter.getWorldPosition(e);
        lz.worldToLocal(e);
        const beam = new THREE.Mesh(cg("beam", () => new THREE.CylinderGeometry(0.0035, 0.0035, 6, 6).rotateX(Math.PI / 2)), M.laser);
        beam.position.set(e.x, e.y, e.z - 3);
        beam.name = "laserBeam";
        lz.add(beam);
      }
    }
    return grp;
  }

  function dressModel(model, id) {
    if (!model) return;
    const old = model.getObjectByName && model.getObjectByName("_gmods");
    if (old) {
      if (old.userData.pumpPart && old.userData.pumpPart.parent) old.userData.pumpPart.parent.remove(old.userData.pumpPart);
      model.remove(old);
    }
    restoreMags(model);
    // A fitted optic replaces the factory one instead of clipping through
    // it. Removing the mod restores the complete factory optic.
    const baseOptic = model.getObjectByName && model.getObjectByName("_baseOptic");
    const rec = store()[id];
    if (baseOptic) baseOptic.visible = !(rec && rec.scope);
    const grp = buildAttachGroup(id, model);
    if (grp) model.add(grp);
    if (rec && rec.mag && MODS[rec.mag] && THREE) {
      const A = anchorsOf(model);
      if (A && A.k) {
        // a drum hangs off a mag well in front of the grip; a mag-in-grip
        // gun (the Uzi) takes the long stick instead
        if (rec.mag === "drummag" && id === "uzi") extendMag(model, A, 0.13);
        else if (rec.mag === "drummag") drumMag(model, A, !!SMGS[id]);
        else extendMag(model, A, PISTOLS[id] ? 0.045 : SMGS[id] ? 0.070 : 0.062);
      }
    }
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
    if (!id) { CBZ.city.note("Draw a firearm first, mods bolt onto the gun in your hands.", 2.2); return false; }
    if (!m.fits(id)) { CBZ.city.note("A " + m.name + " won't fit the " + gunLabel(id) + ".", 2.2); return false; }
    const r = recOf(id);
    if (r[m.slot] === modId) { CBZ.city.note("The " + gunLabel(id) + " already wears a " + m.name + ".", 1.8); return false; }
    if (!CBZ.city.spend(m.price)) { CBZ.city.note("The " + m.name + " runs " + fmt$(m.price) + " · come back with the money.", 2.2); return false; }
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
    if (!equippedId) return "<span style='color:#7f8794'>, empty, </span>";
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
      html += "<p style='color:#ffb35b;margin:12px 0 4px'>You're not holding a firearm. Buy a gun off the wall (or draw one with the number keys), then step back to the bench, mods fit the weapon in your hands.</p>";
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
    html += "<div style='color:#7f8794;font-size:12px;margin-top:12px'>Click a mod or press its number to fit it. One per slot, a new optic/mag/muzzle swaps the old.</div>";
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
    if (!econOn()) return;
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
    if (!econOn()) return;
    if (!dressed && CBZ.fpsWeaponModels && CBZ.fpsWeaponModels.length) { dressAll(); dressed = true; }
  });
  // safety: never leave the bench menu (and its cityMenuOpen soft-lock) up if the
  // player dies, leaves the city, or the run ends while standing at it. onAlways
  // so it fires even once state leaves "playing".
  CBZ.onAlways(38, function () {
    if (panel && panel.style.display === "block") {
      if (!econOn() || g.state !== "playing" || (CBZ.player && CBZ.player.dead)) closeBench();
    }
  });
  // a fresh run wipes fitted mods (weapons reset too) — re-dress clean next time
  CBZ.gunModsReset = function () { g.cityGunMods = {}; dressed = false; dressAll(); };
})();

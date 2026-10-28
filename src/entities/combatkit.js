/* ============================================================
   entities/combatkit.js — CBZ.combatKit: WHAT A SOLDIER WEARS.

   NPC War's armies were the city's men with a flat team colour over torso,
   collar and cap, and the cap BOX re-shaped into a dome (battle/men.js's old
   helmetOn): toy soldiers. A rifleman wears kit, and the kit is what you read
   first at any distance: the plate carrier and its pouches, the helmet, the
   uniform's camouflage. This file is that kit, FITTED to the one human body
   (entities/character.js), for every game that has soldiers in it.

   THE KIT (by LOADOUT, below)
     • PLATE CARRIER: a front and a back plate bag, each a rigid plate
       following THIS body's chest and back (CBZ.human's torso surface, bridged
       where the body dips: a plate does not follow the sternum), shooter's cut
       at the upper corners, chamfered edges, MOLLE webbing rows; the side
       CUMMERBUND round the body's real section (CBZ.bodySection) from plate to
       plate; padded SHOULDER STRAPS laid over the trapezius crest.
     • POUCHES by role: rifle magazine pouches with the magazines' baseplates
       showing, a gunner's 100-round box pouches, a marksman's single 7.62
       pouches and rangefinder, an officer's admin pouch and manpack radio, a
       medic's aid bag and IFAK. Every soldier: an IFAK, a radio, a smoke
       pouch, a tourniquet on the strap, a hydration carrier (its drink tube
       over the shoulder), a drag handle.
     • HELMET: entities/headwear.js's real lids, by nation: ACH/ECH (MICH cut,
       ARC rails, NVG shroud, harness chinstrap) or the Russian 6B47 (fuller
       cut, cover band in the cover's own darker cloth, NVG bracket,
       counterweight pouch; never the side's colour: a bright ring round a
       helmet is no army's practice and the ID tape already says whose he is), PASGT for an older
       army. EYE PRO: entities/eyewear.js's wraparound "eyepro". GLOVES on the
       real hands. KNEE PADS on the shins (they ride the knee pivot, so no pose
       separates them). COMBAT BOOTS (entities/footwear.js "combat").
     • UNIFORM: the nation's real camouflage (CBZ.camo: OCP / MultiCam,
       woodland M81, EMR digital, digital desert, flecktarn, three-colour
       desert), drawn on the body's own cloth meshes by a triplanar shader in
       object space, so no garment needs UVs and the pattern is the same
       physical size on a sleeve and a chest. One shared material per pattern.
     • ID TAPE: a band of the side's mark colour round both upper arms (what
       real armies do when two sides wear the same thing), and a medic's
       armband with the cross.
     • SLING: the body run of a two-point sling (over the support shoulder,
       across the back, to the strong side) is part of the carrier. There are
       NO free runs to the rifle: they were two rigid straight bars re-laid
       each frame from the chest to the gun's swivels, and in every firing
       pose they read as a stick poking out of the arm (owner, 2026-10-13).
       A real sling hangs slack; a straight box never looks like one.

   FIT. Everything is built in the body's own frame from its measured shape
   (torsoShape, bodySection, torsoFrontZ/BackZ, the limb lofts) and hung on
   the node that moves it: the carrier on rig.body, pads on the shin, bands on
   the upper arm, eye pro on the neck. The arms carry clear of the carrier the
   way people in plate do (CBZ.humanArmClear). tools/combatkit-check.mjs
   measures it on every body type and pose.

   COST. ONE merged, vertex-coloured mesh per carrier, cached per (body shape,
   loadout, kit colour, LOD): a company of average men wearing the rifleman's
   kit share one buffer. Knee pads and bands are cached per limb geometry.
   One shared Phong material for all kit. The far LOD (rig LOD 2, the limbs'
   own switch) drops webbing, small furniture and segments.

   API (CBZ.combatKit)
     wear(ch, spec)    dress a rig as a soldier: spec = { loadout, nation, mark,
                       grade, seed } (loadout: LOADOUTS id; nation: NATIONS id;
                       mark: the side's colour for ID tape; grade "second" =
                       second-line plates). null strips the hard kit. Returns
                       the record (ch._combatKit) whose .armour is a fresh
                       CBZ.armour state for the wearer.
     strip(ch)         take the hard kit off (the uniform stays)
     lod(ch, lod)      rig LOD (character.js setLimbLod calls it)
     roleFor(o)        { wid, slot, i, tier } -> a LOADOUT id
     nation(id)        the NATIONS row (unknown ids -> a sensible default)
     camoMaterial(pattern)   the shared triplanar uniform material
     crowdLook(spec)   palette colours for entities/crowdgpu.js's baked soldier
     geometry(ch, loadout, kitHex, lod)   the cached carrier geometry
     LOADOUTS, NATIONS
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE) return;
  if (CBZ.combatKit && CBZ.combatKit.version) return;

  // ---- colours of the hardware -------------------------------------------
  const POLY = 0x24241f, BLACK = 0x161714, BUCKLE = 0x2a2a26, RADIO = 0x2b2d2a, TQ = 0x1b1c1a;
  const RED = 0xb3242a, WHITE = 0xe8e6de, TUBE = 0x2a2c27;

  /* ---- THE NATIONS (city/flags.js ids) -----------------------------------
     A nation fields ONE look, always: its issue camouflage, kit colour,
     helmet and plates. The flags are fictional; the kit is real, so each
     nation wears a real army's issue (named in the comment). */
  const NATIONS = {
    // the US Army: OCP (Scorpion W2), coyote kit, ACH, ESAPI + ESBI
    republic: { camo: "ocp", kit: 0x7a6a4e, helmet: "ballistic", helmetHex: 0x6f6650, plates: "esapi", sides: "esbi", soft: "iiia", boots: 0x8a7556, gloves: 0x6e5f47, armour: "b" },
    // the Gulf kingdom: digital desert, tan kit, the 6B47 under a sand cover, 6B45 Gr.6
    kesh: { camo: "marpat", kit: 0x8c7a58, helmet: "b6b47", helmetHex: 0x95835f, plates: "gr6", soft: "iiia", boots: 0x8e7a5a, gloves: 0x7e6c50 },
    // the Bundeswehr: flecktarn, olive kit, the MICH-cut Gefechtshelm, ESAPI-class plates
    veridia: { camo: "flecktarn", kit: 0x4f5438, helmet: "ballistic", helmetHex: 0x4c5135, plates: "esapi", soft: "iiia", boots: 0x1b1b1a, gloves: 0x2a2b24 },
    // the Russian Army: EMR digital, ranger-green Ratnik kit, the 6B47, Gr.6 plates
    solara: { camo: "emr", kit: 0x4a4e38, helmet: "b6b47", helmetHex: 0x51573c, plates: "gr6", soft: "iiia", boots: 0x1c1c1a, gloves: 0x2c2d26 },
    // an older army: M81 woodland, olive drab kit, PASGT, Level III steel
    mbeya: { camo: "woodland", kit: 0x4f5136, helmet: "pasgt", helmetHex: 0x4c5236, plates: "lvl3", soft: "iiia", boots: 0x1a1a19, gloves: 0x2e2e28 },
    // a front's factions (city/frontline.js): irregulars in what they have
    rebels: { camo: "ragpatch", kit: 0x5a5440, helmet: null, plates: null, soft: null, boots: 0x2b2620, gloves: null, irregular: true },
    junta: { camo: "drab", kit: 0x4f5136, helmet: "pasgt", helmetHex: 0x4f5336, plates: "lvl3", soft: "iiia", boots: 0x1c1c1a, gloves: 0x2e2e28 },
    terror: { camo: "drab", kit: 0x2a2a26, helmet: null, plates: null, soft: null, boots: 0x1c1c1a, gloves: 0x1c1c1a, irregular: true },
  };
  // a real country or force (battle/core/countries.js) brings its own row
  function nation(id) {
    if (NATIONS[id]) return NATIONS[id];
    const C = CBZ.countries && CBZ.countries.kit ? CBZ.countries.kit(id) : null;
    return C || NATIONS.republic;
  }

  /* ---- THE LOADOUTS: who wears what --------------------------------------
     carrier: "plates" (a plate carrier) | "chest" (a chest rig, no plates) |
     null; front: the pouches across the front; back: what rides the back;
     armour: which of the nation's pieces he wears (CBZ.armour.issue). */
  const LOADOUTS = {
    rifleman: { label: "rifleman", carrier: "plates", front: "mags3", back: "hydration", radio: "small", eyepro: true, gloves: true, knees: true, helmet: true, sling: true, armour: ["plates", "soft", "helmet"] },
    gunner:   { label: "machine gunner", carrier: "plates", front: "box2", back: "hydration", radio: null, eyepro: true, gloves: true, knees: true, helmet: true, sling: true, armour: ["plates", "soft", "helmet"], weight: 0.9 },
    marksman: { label: "marksman", carrier: "plates", front: "dmr3", back: "hydration", radio: "small", rangefinder: true, eyepro: true, gloves: true, knees: true, helmet: true, sling: true, armour: ["plates", "soft", "helmet"] },
    medic:    { label: "medic", carrier: "plates", front: "mags2ifak", back: "aidbag", radio: "small", eyepro: true, gloves: true, knees: true, helmet: true, sling: true, armband: "medic", armour: ["plates", "soft", "helmet"], weight: 0.93 },
    officer:  { label: "officer", carrier: "plates", front: "admin", back: "manpack", radio: null, eyepro: true, gloves: true, knees: false, helmet: true, sling: true, armour: ["plates", "soft", "helmet"] },
    militia:  { label: "militia", carrier: "chest", front: "ak4", back: null, radio: null, eyepro: false, gloves: false, knees: false, helmet: false, sling: true, armour: [], weight: 0.99 },
    swat:     { label: "police tactical", carrier: "plates", front: "mags3", back: null, radio: "small", eyepro: true, gloves: true, knees: true, helmet: true, sling: true, armour: ["plates", "soft", "helmet"], police: true },
    civilian: { label: "civilian", carrier: null, armour: [] },
  };
  const SWAT = { camo: null, kit: 0x1d1f1e, helmet: "ballistic", helmetVariant: "swat", helmetHex: 0x1b1d1f, plates: "lvl3", soft: "iiia", boots: 0x111213, gloves: 0x141516, uniform: 0x23262a };

  // a battle man's role: by his weapon and his place in the squad
  function roleFor(o) {
    o = o || {};
    if (o.tier === "civ") return "civilian";
    /* TRAINING IS SKILL, NOT A COSTUME. A real army's or force's men
       (battle/core/countries.js) wear their issue kit at any training: an IRGC
       conscript in his helmet and plates is still a conscript. Militia kit is
       for irregulars, and for a street side of the city's own nations. */
    const real = o.nation && CBZ.countries && CBZ.countries.get ? CBZ.countries.get(o.nation) : null;
    const irregular = !!(real ? real.kit && real.kit.irregular : o.nation && NATIONS[o.nation] && NATIONS[o.nation].irregular);
    if (irregular && o.tier !== "swat") return "militia";
    if (o.tier === "thug" && !real) return "militia";
    if (o.tier === "swat") return "swat";
    if (o.wid === "lmg") return "gunner";
    if (o.wid === "sniper") return "marksman";
    const i = o.i | 0;
    if (i % 30 === 0) return "officer";
    if (i % 10 === 9) return "medic";
    return "rifleman";
  }

  /* KIT COLOURS ARE sRGB, AND THE CAMO TILE IS DECODED AS sRGB, so the kit is
     too: every hex in this file is converted to the linear value the renderer
     expects before it reaches a vertex or a material. (The engine's flat
     cmat colours are fed raw, which renders a tan carrier as cream next to a
     correctly decoded uniform: the plate bag and the shirt must agree.) */
  const LIN = new Map();
  function lin(hex) {
    let v = LIN.get(hex);
    if (v != null) return v;
    const f = (c) => { c /= 255; c = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); return Math.round(c * 255); };
    v = (f((hex >> 16) & 255) << 16) | (f((hex >> 8) & 255) << 8) | f(hex & 255);
    LIN.set(hex, v);
    return v;
  }
  const cm = (hex) => (CBZ.cmat ? CBZ.cmat(lin(hex)) : new THREE.MeshLambertMaterial({ color: lin(hex) }));

  // ---- the shared material ------------------------------------------------
  let _mat = null;
  function material() {
    if (_mat) return _mat;
    _mat = new THREE.MeshPhongMaterial({ color: 0xffffff, vertexColors: true, specular: 0x161616, shininess: 14 });
    _mat._shared = true;
    _mat.name = "combat-kit";
    return _mat;
  }

  // ---- a small mesh builder (positions / normals / colours / index) --------
  function Builder() { this.p = []; this.n = []; this.c = []; this.i = []; }
  Builder.prototype.v = function (p, n, hex) {
    hex = lin(hex);
    this.p.push(p[0], p[1], p[2]);
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    this.n.push(n[0] / l, n[1] / l, n[2] / l);
    this.c.push(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
    return this.p.length / 3 - 1;
  };
  Builder.prototype.t = function (a, b, c) { this.i.push(a, b, c); };
  Builder.prototype.q = function (a, b, c, d) { this.i.push(a, b, c, a, c, d); };
  // every triangle is turned to face the way its vertex normals point
  Builder.prototype.geometry = function () {
    const P = this.p, N = this.n, I = this.i;
    for (let k = 0; k < I.length; k += 3) {
      const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      const d = fx * (N[a] + N[b] + N[c]) + fy * (N[a + 1] + N[b + 1] + N[c + 1]) + fz * (N[a + 2] + N[b + 2] + N[c + 2]);
      if (d < 0) { const s = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = s; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(N), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(this.c), 3));
    const nv = P.length / 3;
    g.setIndex(new THREE.BufferAttribute(nv > 65535 ? new Uint32Array(I) : new Uint16Array(I), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    g._shared = true;
    return g;
  };
  const add = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const neg = (a) => [-a[0], -a[1], -a[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const lerp = (a, b, t) => a + (b - a) * t;
  const sm = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  // a frame: origin o, t (right), u (up), n (out); t = u x n
  function frame(o, n, up) {
    n = norm(n);
    const U = up || [0, 1, 0];
    const u = norm(add(U, n, -dot(U, n)));
    return { o: o, t: cross(u, n), u: u, n: n };
  }
  function at(F, a, b, c) { return add(add(add(F.o, F.t, a), F.u, b), F.n, c); }
  // a box in frame F: centre (a, b, c), size w (t) x h (u) x d (n)
  function box(B, F, a, b, c, w, h, d, hex, hexTop) {
    const C = at(F, a, b, c), hw = w / 2, hh = h / 2, hd = d / 2;
    const faces = [[F.n, F.t, F.u, hd, hw, hh], [neg(F.n), F.t, F.u, hd, hw, hh], [F.t, F.u, F.n, hw, hh, hd],
      [neg(F.t), F.u, F.n, hw, hh, hd], [F.u, F.t, F.n, hh, hw, hd], [neg(F.u), F.t, F.n, hh, hw, hd]];
    for (let k = 0; k < 6; k++) {
      const f = faces[k], N = f[0], A = f[1], Bv = f[2], o = add(C, N, f[3]), col = (k === 4 && hexTop != null) ? hexTop : hex;
      const i0 = B.v(add(add(o, A, -f[4]), Bv, -f[5]), N, col), i1 = B.v(add(add(o, A, f[4]), Bv, -f[5]), N, col);
      const i2 = B.v(add(add(o, A, f[4]), Bv, f[5]), N, col), i3 = B.v(add(add(o, A, -f[4]), Bv, f[5]), N, col);
      B.q(i0, i1, i2, i3);
    }
  }
  // a rounded-ish soft pouch: a box with its front face pushed out (a bulge row)
  function pouch(B, F, a, b, w, h, d, hex, flapHex) {
    box(B, F, a, b, d / 2, w, h, d, hex);
    if (flapHex != null) box(B, F, a, b + h / 2 - h * 0.14, d + d * 0.06, w * 1.03, h * 0.3, d * 0.12, flapHex);
  }
  // a tube through points (each [x,y,z]), sides-gon, radius r
  function tube(B, pts, r, hex, sides) {
    sides = sides || 6;
    let prev = null;
    for (let k = 0; k < pts.length; k++) {
      const d = norm(sub(pts[Math.min(pts.length - 1, k + 1)], pts[Math.max(0, k - 1)]));
      const ref = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const e1 = norm(cross(d, ref)), e2 = cross(d, e1);
      const ring = [];
      for (let s = 0; s <= sides; s++) {
        const an = s / sides * Math.PI * 2, nn = add(add([0, 0, 0], e1, Math.cos(an)), e2, Math.sin(an));
        ring.push(B.v(add(pts[k], nn, r), nn, hex));
      }
      if (prev) for (let s = 0; s < sides; s++) B.q(prev[s], prev[s + 1], ring[s + 1], ring[s]);
      prev = ring;
    }
  }
  // a flat strap (w wide, h thick) along points, laid with its broad face on `nrm`
  function strap(B, pts, nrm, w, h, hex) {
    const rows = [];
    for (let k = 0; k < pts.length; k++) {
      const d = norm(sub(pts[Math.min(pts.length - 1, k + 1)], pts[Math.max(0, k - 1)]));
      let n = nrm[k]; n = norm(add(n, d, -dot(n, d)));
      const s = norm(cross(d, n));
      const p = pts[k];
      rows.push([add(add(p, s, -w / 2), n, 0), add(add(p, s, w / 2), n, 0), add(add(p, s, w / 2), n, h), add(add(p, s, -w / 2), n, h), n, s]);
    }
    for (let k = 0; k < rows.length - 1; k++) {
      const A = rows[k], C = rows[k + 1];
      B.q(B.v(A[3], A[4], hex), B.v(A[2], A[4], hex), B.v(C[2], C[4], hex), B.v(C[3], C[4], hex));      // top
      B.q(B.v(A[0], neg(A[4]), hex), B.v(A[1], neg(A[4]), hex), B.v(C[1], neg(C[4]), hex), B.v(C[0], neg(C[4]), hex));
      B.q(B.v(A[1], A[5], hex), B.v(A[2], A[5], hex), B.v(C[2], C[5], hex), B.v(C[1], C[5], hex));
      B.q(B.v(A[0], neg(A[5]), hex), B.v(A[3], neg(A[5]), hex), B.v(C[3], neg(C[5]), hex), B.v(C[0], neg(C[5]), hex));
    }
  }
  function tone(hex, k) {
    let r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    if (k > 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; } else { r *= 1 + k; g *= 1 + k; b *= 1 + k; }
    return ((r | 0) << 16) | ((g | 0) << 8) | (b | 0);
  }
  function scaleOf(ch) {
    const g = ch && ch.group, hs = g && g.userData && g.userData.humanScale;
    return hs > 0 ? hs : ((ch && ch.model && ch.model.scale && ch.model.scale.x) || 0.7);
  }

  /* ---- A RIGID PLATE ON THE BODY ------------------------------------------
     side +1 = the front (torsoFrontZ), -1 = the back. The inner face is the
     body's surface (the max over a little window: a plate does not dip into a
     hollow) plus clearance, then bridged across every dip in both directions
     so it is a plate and not a shrink-wrap. Returns a sampler over (u, v) in
     [0,1]^2: inner point + outward normal. cut: the shooter's cut, narrowing
     the top corners for the arms. */
  function plateSurface(ch, side, hw, yB, yT, clr, cut, NX, NY, m) {
    const f = side > 0 ? ch.torsoFrontZ : ch.torsoBackZ;
    const G = [];
    for (let j = 0; j < NY; j++) {
      const v = j / (NY - 1), y = lerp(yB, yT, v);
      const w = hw * (cut ? lerp(1, 0.66, sm((v - 0.6) / 0.4)) : lerp(1, 0.9, sm((v - 0.8) / 0.2)));
      const row = [];
      for (let i = 0; i < NX; i++) {
        const x = w * (2 * i / (NX - 1) - 1);
        let zb = -1e9;
        for (const dy of [-0.02, -0.01, 0, 0.01, 0.02]) for (const dx of [-0.012, 0, 0.012]) {
          const z = side * f(x + dx * m, y + dy * m);
          if (z > zb) zb = z;
        }
        row.push([x, y, zb + clr]);
      }
      G.push(row);
    }
    // bridge the dips: across (the sternum, between the pecs/bust) and down
    for (let pass = 0; pass < 6; pass++) {
      for (let j = 0; j < NY; j++) for (let i = 1; i < NX - 1; i++) {
        const a = (G[j][i - 1][2] + G[j][i + 1][2]) / 2;
        if (a > G[j][i][2]) G[j][i][2] = a;
      }
      for (let i = 0; i < NX; i++) for (let j = 1; j < NY - 1; j++) {
        const a = (G[j - 1][i][2] + G[j + 1][i][2]) / 2;
        if (a > G[j][i][2]) G[j][i][2] = a;
      }
    }
    for (const row of G) for (const p of row) p[2] *= side;
    function P(u, v) {
      const fu = Math.min(NX - 1.0001, Math.max(0, u * (NX - 1))), fv = Math.min(NY - 1.0001, Math.max(0, v * (NY - 1)));
      const i = Math.floor(fu), j = Math.floor(fv), s = fu - i, t = fv - j;
      const a = G[j][i], b = G[j][i + 1], c = G[j + 1][i], d = G[j + 1][i + 1];
      const r = [0, 1, 2].map((k) => lerp(lerp(a[k], b[k], s), lerp(c[k], d[k], s), t));
      return r;
    }
    function N(u, v) {
      const e = 0.04;
      const du = sub(P(Math.min(1, u + e), v), P(Math.max(0, u - e), v)), dv = sub(P(u, Math.min(1, v + e)), P(u, Math.max(0, v - e)));
      let n = norm(cross(du, dv));
      if (n[2] * side < 0) n = neg(n);
      return n;
    }
    return { P: P, N: N, side: side };
  }
  /* The plate BAG: inner face on the surface, outer face T proud, a chamfer
     of `bev` round the edge. Returns the outer sampler for hanging pouches. */
  function plateBag(B, S, T, bev, NU, NV, hex, edgeHex) {
    const inset = (u, v) => [lerp(bev, 1 - bev, u), lerp(bev * 0.7, 1 - bev * 0.7, v)];
    const OUT = (u, v) => { const q = inset(u, v), p = S.P(q[0], q[1]), n = S.N(q[0], q[1]); return add(p, n, T); };
    const outer = [], inner = [];
    for (let j = 0; j <= NV; j++) {
      const ro = [], ri = [];
      for (let i = 0; i <= NU; i++) {
        const u = i / NU, v = j / NV;
        ro.push(B.v(OUT(u, v), S.N(u, v), hex));
        ri.push(B.v(S.P(u, v), neg(S.N(u, v)), tone(hex, -0.25)));
      }
      outer.push(ro); inner.push(ri);
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      B.q(outer[j][i], outer[j][i + 1], outer[j + 1][i + 1], outer[j + 1][i]);
      B.q(inner[j][i], inner[j + 1][i], inner[j + 1][i + 1], inner[j][i + 1]);
    }
    // the edge: from the inner border out to the inset outer border
    const ring = [];
    for (let i = 0; i <= NU; i++) ring.push([i / NU, 0]);
    for (let j = 1; j <= NV; j++) ring.push([1, j / NV]);
    for (let i = NU - 1; i >= 0; i--) ring.push([i / NU, 1]);
    for (let j = NV - 1; j >= 0; j--) ring.push([0, j / NV]);
    const cu = 0.5, cv = 0.5;
    for (let k = 0; k < ring.length - 1; k++) {
      const a = ring[k], b = ring[k + 1];
      const pa = S.P(a[0], a[1]), pb = S.P(b[0], b[1]), oa = OUT(a[0], a[1]), ob = OUT(b[0], b[1]);
      const mid = S.P(cu, cv);
      const ea = norm(add(sub(pa, mid), S.N(a[0], a[1]), 0.2)), eb = norm(add(sub(pb, mid), S.N(b[0], b[1]), 0.2));
      B.q(B.v(pa, ea, edgeHex), B.v(pb, eb, edgeHex), B.v(ob, eb, edgeHex), B.v(oa, ea, edgeHex));
    }
    return { P: OUT, N: S.N, side: S.side };
  }
  // a frame on a plate bag's outer face; t points to the wearer's left on the
  // front (and his right on the back: t = up x out)
  function bagFrame(O, u, v) { return frame(O.P(u, v), O.N(u, v)); }
  // MOLLE rows: thin webbing strips a hair proud across the bag
  function molle(B, O, rows, v0, v1, hh, hex, NU) {
    for (let r = 0; r < rows; r++) {
      const v = lerp(v0, v1, rows > 1 ? r / (rows - 1) : 0);
      const top = [], bot = [];
      for (let i = 0; i <= NU; i++) {
        const u = lerp(0.04, 0.96, i / NU), n = O.N(u, v);
        const p = add(O.P(u, v), n, 0.0022 * hh.m);
        top.push(B.v(add(p, [0, 1, 0], hh.h), n, hex)); bot.push(B.v(add(p, [0, 1, 0], -hh.h), n, hex));
      }
      for (let i = 0; i < NU; i++) B.q(bot[i], bot[i + 1], top[i + 1], top[i]);
    }
  }

  // the trapezius crest: the surface height at (x, z) over the shoulders
  function crestY(S, x, z) {
    const width = (y) => {
      const R = S.at(y), b = z >= (R.zc || 0) ? R.zf : R.zb, q = Math.abs(z - (R.zc || 0)) / b;
      return q >= 1 ? 0 : R.a * Math.pow(1 - Math.pow(q, R.n), 1 / R.n);
    };
    let lo = S.shoulderY - 0.25 * S.vs, hi = S.yN;
    if (width(lo) < Math.abs(x)) return lo;
    for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (width(mid) > Math.abs(x)) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  /* A strap over the shoulder from the front bag's top to the back bag's top,
     at |x| = xs: the crest sampled front to back, held clr off it. */
  /* The strap is w wide and lies ON the slope of the trapezius (it falls away
     toward the shoulder): its centre sits clr over the crest at xs, tilted to
     the crest's own sideways slope, and lifted where that would still put its
     inner edge (nearer the neck, higher) into the body. */
  function shoulderPath(S, xs, zF, yF, zB, yB, clr, n, w, ch) {
    const pts = [], slope = [];
    const e = 0.01, sg = xs < 0 ? -1 : 1;
    for (let k = 0; k <= n; k++) {
      const t = k / n, z = lerp(zF, zB, t);
      const y0 = lerp(yF, yB, t);
      const yc = crestY(S, xs, z);
      const sx = (crestY(S, xs + e, z) - crestY(S, xs - e, z)) / (2 * e);   // dy/dx at the strap
      // the inner edge: where the tilted strap meets the crest nearer the neck
      const yIn = crestY(S, xs - sg * w / 2, z), yTilt = yc - sg * sx * w / 2;
      const y = Math.max(y0, yc + clr + Math.max(0, yIn - yTilt));
      // the crest is the raw ring; the drawn surface carries relief (the
      // shoulder blades, the spine): never inside THAT either
      let zz = z;
      if (ch && y < S.yN) for (const dx of [-w / 2, 0, w / 2]) {
        const f = ch.torsoFrontZ(xs + dx, y), b = ch.torsoBackZ(xs + dx, y);
        if (zz < f + clr && zz > b - clr) zz = (zz > (f + b) / 2) ? Math.max(zz, f + clr) : Math.min(zz, b - clr);
      }
      pts.push([xs, y, zz]); slope.push(y > y0 + 1e-6 ? sx : 0);
    }
    const nrm = [];
    for (let k = 0; k <= n; k++) {
      const d = norm(sub(pts[Math.min(n, k + 1)], pts[Math.max(0, k - 1)]));
      let nn = [0, d[2], -d[1]];
      if (nn[1] < 0) nn = neg(nn);
      nn = norm(nn);
      nrm.push(norm([-slope[k] * nn[1], nn[1], nn[2]]));
    }
    return { pts: pts, nrm: nrm };
  }

  /* ============================================================ THE CARRIER */
  const GEO = Object.create(null);
  function geometry(ch, loadout, kitHex, lod) {
    const L = LOADOUTS[loadout], S = ch && ch.torsoShape;
    if (!L || !L.carrier || !S || !S.at || !ch.torsoFrontZ || !CBZ.bodySection) return null;
    const far = lod >= 2;
    const m = 1 / scaleOf(ch);
    const key = S.key + "|" + loadout + "|" + kitHex + "|" + (far ? 2 : 1) + "|" + m.toFixed(4);
    if (GEO[key]) return GEO[key];
    const B = new Builder();
    const kit = kitHex, dk = tone(kit, -0.22), web = tone(kit, -0.12), edge = tone(kit, -0.3);
    const sz = Math.min(1, S.vs);
    const clr = 0.004 * m;
    const notch = S.yN - S.tf - 0.03 * S.vs;
    const yT = notch - 0.02 * m;
    /* SIZED TO THIS BODY. The rig is drawn broad (an adult chest is ~0.64 m
       across), so a plate cut to a real 25 x 32 cm SAPI reads as a postage
       stamp on it. The plate keeps a real plate's PROPORTION of the torso
       (about 0.58 of the chest's half-width, notch to two thirds of the way
       to the belt) and everything hung on it scales with it (ps). */
    const yB = Math.max(yT - 0.66 * (yT - S.pTop), S.pTop + 0.05 * m);
    const hw = S.W * 0.58;
    const ps = Math.max(0.8, Math.min(1.8, hw / (0.125 * m)));
    const mp = m * ps;
    const md = m * Math.min(ps, 1.12);      // depths stay near real: the arms swing past them
    const NX = far ? 5 : 9, NY = far ? 4 : 7;
    const out = { front: null, back: null };
    const chest = L.carrier === "chest";
    let F0 = null, B0 = null;
    if (!chest) {
      // ---- the PLATE BAGS: front and back, 3.4 cm of plate and cordura
      const T = 0.034 * m, bev = 0.06;
      const sf = plateSurface(ch, 1, hw, yB, yT, clr + 0.004 * m, true, NX, NY, m);
      F0 = plateBag(B, sf, T, bev, NX - 1, NY - 1, kit, edge);
      const sb = plateSurface(ch, -1, hw * 1.02, yB + 0.01 * m, yT + 0.02 * m, clr + 0.004 * m, false, NX, NY, m);
      B0 = plateBag(B, sb, T * 0.9, bev, NX - 1, NY - 1, kit, edge);
      out.front = F0; out.back = B0;
      if (!far) {
        molle(B, F0, 5, 0.08, 0.62, { h: 0.0125 * m, m: m }, web, NX - 1);
        molle(B, B0, 6, 0.08, 0.80, { h: 0.0125 * m, m: m }, web, NX - 1);
        // the drag handle on the back plate's top
        const fh = bagFrame(B0, 0.5, 0.97);
        box(B, fh, 0, 0.012 * m, 0.006 * m, 0.11 * m, 0.03 * m, 0.012 * m, dk);
      }
    }
    // ---- THE CUMMERBUND (or a chest rig's waist band) round the real section
    const cy0 = chest ? S.pTop + 0.07 * m : yB + 0.012 * m;
    const cy1 = chest ? cy0 + 0.16 * mp : Math.min(cy0 + 0.13 * mp, yT - 0.07 * m);
    const NS = CBZ.bodySection.NS;
    const span = CBZ.bodySection.span(ch, cy0, cy1, 4).map((p) => p.slice());
    for (let pass = 0; pass < 3; pass++) for (let j = 0; j < NS; j++) {         // a band is stiff: bridge the dips
      const a = span[(j + NS - 1) % NS], b = span[j], c = span[(j + 1) % NS];
      const ra = Math.hypot(a[0], a[1]), rb = Math.hypot(b[0], b[1]) || 1, rc = Math.hypot(c[0], c[1]);
      const want = (ra + rc) / 2;
      if (want > rb) span[j] = [b[0] * want / rb, b[1] * want / rb];
    }
    const Tc = 0.013 * m;
    const ringAt = (j, off) => { const p = span[j % NS], r = Math.hypot(p[0], p[1]) || 1; return [p[0] * (r + off) / r, p[1] * (r + off) / r]; };
    // a chest rig is a band across the front only; a cummerbund goes all round
    // (its front and back run is inside the plate bags)
    const step = far ? 2 : 1;
    const inArc = (j) => { if (!chest) return true; const th = j / NS * 360; return th <= 72 || th >= 288; };
    const outerRing = [];
    for (let j = 0; j < NS; j++) outerRing.push(ringAt(j, clr + Tc));
    for (let j = 0; j < NS; j += step) {
      if (!inArc(j) || !inArc(j + step)) continue;
      const a0 = ringAt(j, clr), a1 = ringAt(j + step, clr), b0 = ringAt(j, clr + Tc), b1 = ringAt(j + step, clr + Tc);
      const n0 = CBZ.bodySection.normal(span, j / NS * Math.PI * 2), n1 = CBZ.bodySection.normal(span, (j + step) / NS * Math.PI * 2);
      B.q(B.v([b0[0], cy0, b0[1]], n0, kit), B.v([b1[0], cy0, b1[1]], n1, kit), B.v([b1[0], cy1, b1[1]], n1, kit), B.v([b0[0], cy1, b0[1]], n0, kit));
      B.q(B.v([a0[0], cy0, a0[1]], neg(n0), dk), B.v([a1[0], cy0, a1[1]], neg(n1), dk), B.v([a1[0], cy1, a1[1]], neg(n1), dk), B.v([a0[0], cy1, a0[1]], neg(n0), dk));
      for (const [y, up] of [[cy0, -1], [cy1, 1]]) B.q(B.v([a0[0], y, a0[1]], [0, up, 0], edge), B.v([a1[0], y, a1[1]], [0, up, 0], edge), B.v([b1[0], y, b1[1]], [0, up, 0], edge), B.v([b0[0], y, b0[1]], [0, up, 0], edge));
      if (!far && !chest) for (const yy of [cy0 + 0.045 * m, cy0 + 0.1 * m]) {   // two webbing rows round the sides
        const c0 = ringAt(j, clr + Tc + 0.002 * m), c1 = ringAt(j + step, clr + Tc + 0.002 * m), h = 0.012 * m;
        B.q(B.v([c0[0], yy - h, c0[1]], n0, web), B.v([c1[0], yy - h, c1[1]], n1, web), B.v([c1[0], yy + h, c1[1]], n1, web), B.v([c0[0], yy + h, c0[1]], n0, web));
      }
    }
    // a frame on the band's outer face at angle deg (0 = front, +90 = his left)
    const bandF = (deg) => {
      const th = deg * Math.PI / 180, p = CBZ.bodySection.at(outerRing, th);
      return frame([p[0], (cy0 + cy1) / 2, p[1]], CBZ.bodySection.normal(span, th));
    };
    // ---- SHOULDER STRAPS over the trapezius crest
    const sw = 0.05 * mp, sth = 0.012 * m;
    const xs = Math.max(hw * 0.62, S.nRx + 0.016 * m + sw / 2);
    const paths = {};
    for (const s of [1, -1]) {
      let zF, yF, zB, yBk;
      if (!chest) {
        const uF = 0.5 + 0.5 * s * xs / (hw * 0.66), uB = 0.5 - 0.5 * s * xs / (hw * 0.92);
        const pf = F0.P(Math.min(0.98, Math.max(0.02, uF)), 0.96), pb = B0.P(Math.min(0.98, Math.max(0.02, uB)), 0.96);
        yF = pf[1]; yBk = pb[1];
        // tucked a little under the bag's top edge, but never into the body there
        let zf = -1e9, zb = 1e9;
        for (const dx of [-sw / 2, 0, sw / 2]) for (const dy of [0, 0.03, 0.06, 0.09]) { zf = Math.max(zf, ch.torsoFrontZ(s * xs + dx, yF + dy * m)); zb = Math.min(zb, ch.torsoBackZ(s * xs + dx, yBk + dy * m)); }
        zF = Math.max(pf[2] - 0.008 * m, zf + clr + sth); zB = Math.min(pb[2] + 0.008 * m, zb - clr - sth);
      } else {
        zF = 0; yF = 0; zB = 0; yBk = 0;
      }
      let path;
      if (!chest) path = shoulderPath(S, s * xs, zF, yF, zB, yBk, clr * 2.5, far ? 8 : 24, sw, ch);
      else {
        /* a chest rig's harness runs UP the chest from the band, over the
           crest, and DOWN the back: on the body's surface the whole way (the
           straight line between the band and the crest goes through the pecs) */
        const yUp = S.shoulderY - 0.03 * m, yb = cy1 + 0.06 * m, run = (side, y0, y1, n) => {
          const pts = [], nrm = [];
          for (let k = 0; k <= n; k++) {
            const y = lerp(y0, y1, k / n);
            let z = side > 0 ? -1e9 : 1e9;
            const hy = (y1 - y0) / n * 0.6;
            for (const dx of [-sw / 2, 0, sw / 2]) for (const dy of [-hy, 0, hy]) {
              const zz = side > 0 ? ch.torsoFrontZ(s * xs + dx, y + dy) : ch.torsoBackZ(s * xs + dx, y + dy);
              z = side > 0 ? Math.max(z, zz) : Math.min(z, zz);
            }
            pts.push([s * xs, y, z + side * clr]); nrm.push([0, 0, side]);
          }
          return { pts: pts, nrm: nrm };
        };
        const fr = run(1, cy1 - 0.02 * m, yUp, far ? 4 : 10), bk = run(-1, yUp, yb, far ? 4 : 10);
        bk.pts.reverse(); bk.nrm.reverse();
        const top = shoulderPath(S, s * xs, fr.pts[fr.pts.length - 1][2], yUp, bk.pts[bk.pts.length - 1][2], yUp, clr, far ? 4 : 8, sw);
        bk.pts.reverse(); bk.nrm.reverse();
        path = { pts: fr.pts.concat(top.pts.slice(1, -1), bk.pts), nrm: fr.nrm.concat(top.nrm.slice(1, -1), bk.nrm) };
      }
      paths[s] = path;
      strap(B, path.pts, path.nrm, sw, sth, kit);
    }
    if (chest) {
      // the chest rig's back: the straps cross into an X down to the band
      const yb = cy1 - 0.02 * m;
      for (const s of [1, -1]) {
        const a = paths[s].pts[paths[s].pts.length - 1];
        const pts = [], nrm = [];
        for (let k = 0; k <= 6; k++) {
          const t = k / 6, x = lerp(a[0], -s * hw * 0.8, t), y = lerp(a[1], yb, t);
          let z = 1e9;
          for (const dx of [-0.025, 0, 0.025]) z = Math.min(z, ch.torsoBackZ(x + dx * m, y));
          z -= clr + 0.004 * m;
          pts.push([x, y, z]); nrm.push([0, 0, -1]);
        }
        strap(B, pts, nrm, sw * 0.8, sth * 0.6, kit);
      }
    }
    if (!far) {
      // ---- the BODY RUN OF THE SLING: over the support (left, +x) shoulder on
      // top of the strap, down the back on the diagonal to the strong side
      const sp = paths[1].pts.map((p, k) => add(p, paths[1].nrm[k], sth + 0.002 * m));
      const last = sp[sp.length - 1];
      const tail = [];
      for (let k = 1; k <= 10; k++) {
        const t = k / 10, x = lerp(last[0], -S.W * 0.85, t), y = lerp(last[1], cy1 + 0.03 * m, t);
        let zb = 1e9;
        for (const dx of [-0.02, 0, 0.02]) for (const dy of [-0.02, 0, 0.02]) zb = Math.min(zb, ch.torsoBackZ(x + dx * m, y + dy * m));
        // over the back plate bag where it crosses it, on the shirt beside it
        const z = zb - clr - (!chest && Math.abs(x) < hw && y > yB && y < yT ? 0.04 * m : 0.004 * m);
        tail.push([x, y, z]);
      }
      const all = sp.concat(tail), nr = all.map((p, k) => k < sp.length ? paths[1].nrm[k] : [0, 0, -1]);
      strap(B, all, nr, 0.032 * m, 0.004 * m, tone(kit, -0.35));
      // ---- a TOURNIQUET on the left strap, front
      // (on the front bag's upper left, where a right-hander reaches it with the support hand... his left)
      if (F0) {
        const Ft = bagFrame(F0, 0.86, 0.8);
        box(B, Ft, 0, 0, 0.012 * md, 0.03 * mp, 0.1 * mp, 0.024 * md, TQ);
      }
    }
    // ---- THE FRONT POUCHES
    const chestFrame = (u, v) => {
      if (!chest) return bagFrame(F0, u, v);
      const x = lerp(-hw * 1.15, hw * 1.15, u), y = lerp(cy0, cy1, v);
      // a chest rig's pouch hangs off its band: clear of the body under its whole face
      let zz = -1e9;
      for (const dy of [-0.08, -0.04, 0, 0.04, 0.08]) for (const dx of [-0.04, 0, 0.04]) zz = Math.max(zz, ch.torsoFrontZ(x + dx * mp, y + dy * mp));
      const ring = CBZ.bodySection.at(outerRing, Math.atan2(x, Math.max(0.01, zz)));
      return frame([x, y, Math.max(zz + clr, ring[1]) + 0.002 * m], [0, 0, 1]);
    };
    const magRow = (n, w, h, d, v, magW, magD, rise) => {
      for (let k = 0; k < n; k++) {
        const u = n === 1 ? 0.5 : lerp(0.18, 0.82, k / (n - 1));
        const F = chestFrame(u, v);
        pouch(B, F, 0, 0, w * mp, h * mp, d * md, kit, far ? null : dk);
        if (!far && magW) box(B, F, 0, (h / 2 + rise / 2) * mp, d * 0.5 * md, magW * mp, rise * mp, magD * md, POLY, BLACK);
      }
    };
    switch (L.front) {
      case "mags3": magRow(3, 0.072, 0.115, 0.048, 0.28, 0.064, 0.03, 0.024); break;
      case "mags2ifak": {
        magRow(2, 0.072, 0.115, 0.048, 0.28, 0.064, 0.03, 0.024);
        if (!far) {
          const F = chestFrame(0.5, 0.74);
          pouch(B, F, 0, 0, 0.15 * mp, 0.08 * mp, 0.055 * md, kit, dk);
          box(B, F, 0, 0, 0.0565 * md, 0.04 * mp, 0.012 * mp, 0.003 * md, RED);
          box(B, F, 0, 0, 0.0565 * md, 0.012 * mp, 0.04 * mp, 0.003 * md, RED);
        }
        break;
      }
      case "box2": magRow(2, 0.115, 0.135, 0.085, 0.3, 0, 0, 0); break;
      case "dmr3": magRow(3, 0.06, 0.12, 0.036, 0.28, 0.052, 0.024, 0.022); break;
      case "admin": {
        magRow(2, 0.072, 0.115, 0.048, 0.24, 0.064, 0.03, 0.024);
        const F = chestFrame(0.5, 0.7);
        pouch(B, F, 0, 0, 0.19 * mp, 0.11 * mp, 0.03 * md, kit, dk);
        if (!far) for (const a of [-0.05, -0.03, 0.04]) box(B, F, a * mp, 0.04 * mp, 0.032 * md, 0.008 * mp, 0.04 * mp, 0.008 * md, a < 0 ? BLACK : 0x585a54);   // pens / a light
        break;
      }
      case "ak4": magRow(4, 0.068, 0.14, 0.045, 0.45, 0.06, 0.032, 0.02); break;
    }
    if (L.rangefinder && !far) {
      const F = chestFrame(0.78, 0.82);
      pouch(B, F, 0, 0, 0.06 * mp, 0.08 * mp, 0.045 * md, kit, dk);
    }
    // ---- THE SIDES, behind the arms' swing: IFAK rear left, smoke rear right;
    // the radio rides the back panel's upper left with its antenna up
    if (!chest) {
      const Fi = bandF(148);
      pouch(B, Fi, 0, -0.01 * mp, 0.1 * mp, 0.13 * mp, 0.06 * md, kit, far ? null : dk);
      if (!far) { box(B, Fi, 0, 0.04 * mp, 0.061 * md, 0.036 * mp, 0.012 * mp, 0.003 * md, RED); box(B, Fi, 0, 0.04 * mp, 0.061 * md, 0.012 * mp, 0.036 * mp, 0.003 * md, RED); }
      const Fs = bandF(-146);
      pouch(B, Fs, 0, 0, 0.065 * mp, 0.12 * mp, 0.06 * md, kit, far ? null : dk);
      if (!far) box(B, Fs, 0, 0.07 * mp, 0.03 * md, 0.05 * mp, 0.02 * mp, 0.04 * md, 0x6f726a);   // the smoke's cap
      if (L.radio === "small" && B0) {
        const Fr = bagFrame(B0, 0.84, 0.72);
        box(B, Fr, 0, 0, 0.024 * md, 0.07 * mp, 0.15 * mp, 0.045 * md, RADIO);
        if (!far) tube(B, [at(Fr, -0.02 * mp, 0.07 * mp, 0.03 * md), at(Fr, -0.03 * mp, 0.34 * mp, 0.09 * md)], 0.005 * m, BLACK, 5);
      }
    }
    // ---- THE BACK
    if (B0 && L.back === "hydration") {
      const F = bagFrame(B0, 0.4, 0.46);
      box(B, F, 0, 0, 0.022 * md, 0.2 * mp, 0.25 * mp, 0.044 * md, kit);
      if (!far) {
        // the drink tube up over his right shoulder and down the strap
        const rp = paths[-1];
        const top = at(F, 0.06 * mp, 0.13 * mp, 0.03 * mp);
        const pts = [top];
        for (let k = rp.pts.length - 1; k >= 2; k -= 2) pts.push(add(rp.pts[k], rp.nrm[k], sth + 0.006 * mp));
        tube(B, pts, 0.006 * mp, TUBE, 5);
      }
    } else if (B0 && L.back === "aidbag") {
      const F = bagFrame(B0, 0.5, 0.42);
      box(B, F, 0, -0.02 * mp, 0.08 * md, 0.3 * mp, 0.36 * mp, 0.16 * md, kit);
      box(B, F, 0, 0.12 * mp, 0.165 * md, 0.31 * mp, 0.1 * mp, 0.012 * md, dk);
      box(B, F, 0, -0.03 * mp, 0.1615 * md, 0.11 * mp, 0.11 * mp, 0.003 * md, WHITE);
      box(B, F, 0, -0.03 * mp, 0.1635 * md, 0.08 * mp, 0.024 * mp, 0.003 * md, RED);
      box(B, F, 0, -0.03 * mp, 0.1635 * md, 0.024 * mp, 0.08 * mp, 0.003 * md, RED);
    } else if (B0 && L.back === "manpack") {
      const F = bagFrame(B0, 0.5, 0.5);
      box(B, F, 0, 0, 0.055 * md, 0.22 * mp, 0.27 * mp, 0.1 * md, kit);
      box(B, F, 0, 0.02 * mp, 0.11 * md, 0.17 * mp, 0.2 * mp, 0.012 * md, RADIO);
      if (!far) {
        tube(B, [at(F, 0.07 * mp, 0.13 * mp, 0.08 * mp), at(F, 0.09 * mp, 0.4 * mp, 0.1 * mp), at(F, 0.12 * mp, 0.95 * mp, 0.16 * mp)], 0.004 * mp, BLACK, 4);
        // the handset clipped to the left strap
        const Fh = bagFrame(F0, 0.16, 0.8);
        box(B, Fh, 0, 0, 0.018 * md, 0.05 * mp, 0.09 * mp, 0.03 * md, RADIO);
      }
    }
    const g = B.geometry();
    g.userData.combatKit = { loadout: loadout, yB: yB, yT: yT, cy0: cy0, cy1: cy1, hw: hw };
    return (GEO[key] = g);
  }

  /* ---- KNEE PADS: a cup on the front of each shin's top, a strap round the back */
  const KNEE = new Map();
  function kneeGeometry(g, kit, m) {
    const Lm = g && g.userData && g.userData.limb;
    if (!Lm || !CBZ.humanLimbHalfAt) return null;
    const key = Lm.y0.toFixed(4) + "|" + Lm.sy.toFixed(4) + "|" + Lm.sx.toFixed(4) + "|" + Lm.sz.toFixed(4) + "|" + kit;
    if (KNEE.has(key)) return KNEE.get(key);
    const B = new Builder();
    const clr = 0.003 * m, T = 0.016 * m, top = Lm.y0 + 0.02 * m, bot = Lm.y0 - 0.13 * m;
    const half = (y) => CBZ.humanLimbHalfAt(g, Math.min(Lm.y0, y));
    const NA = 9, NV = 6, A = 1.25;
    const rows = [];
    for (let j = 0; j <= NV; j++) {
      const y = lerp(bot, top, j / NV), h = half(y), cap = 1 - 0.35 * Math.pow(Math.abs(j / NV - 0.55) * 1.8, 2);
      const ri = [], ro = [];
      for (let i = 0; i <= NA; i++) {
        const a = lerp(-A, A, i / NA), n = [Math.sin(a), 0, Math.cos(a)];
        const pi = [(h.hx + clr) * n[0], y, h.cz + (h.hz + clr) * n[2]];
        const po = add(pi, n, T * Math.max(0.35, cap) * (1 - 0.5 * Math.pow(Math.abs(a) / A, 3)));
        ri.push(B.v(pi, neg(n), BLACK)); ro.push(B.v(po, n, Math.abs(a) < 0.75 && j > 0 && j < NV ? BLACK : tone(kit, -0.2)));
      }
      rows.push([ri, ro]);
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NA; i++) {
      B.q(rows[j][1][i], rows[j][1][i + 1], rows[j + 1][1][i + 1], rows[j + 1][1][i]);
      B.q(rows[j][0][i], rows[j + 1][0][i], rows[j + 1][0][i + 1], rows[j][0][i + 1]);
    }
    // the strap round the back of the calf
    const ys = Lm.y0 - 0.09 * m, hs = half(ys), sh = 0.012 * m, sr = [];
    for (let i = 0; i <= 12; i++) {
      const a = lerp(A, Math.PI * 2 - A, i / 12), n = [Math.sin(a), 0, Math.cos(a)];
      const p = [(hs.hx + clr) * n[0], ys, hs.cz + (hs.hz + clr) * n[2]];
      sr.push([B.v(add(add(p, n, 0.004 * m), [0, 1, 0], sh), n, tone(kit, -0.3)), B.v(add(add(p, n, 0.004 * m), [0, 1, 0], -sh), n, tone(kit, -0.3))]);
    }
    for (let i = 0; i < 12; i++) B.q(sr[i][1], sr[i + 1][1], sr[i + 1][0], sr[i][0]);
    const out = B.geometry();
    KNEE.set(key, out);
    return out;
  }
  /* ---- BANDS on the upper arm: ID tape in the side's colour, a medic's armband */
  const BAND = new Map();
  function bandGeometry(g, kind, hex, outSide, m) {
    const Lm = g && g.userData && g.userData.limb;
    if (!Lm || !CBZ.humanLimbHalfAt) return null;
    const key = Lm.y0.toFixed(4) + "|" + Lm.sy.toFixed(4) + "|" + Lm.sx.toFixed(4) + "|" + kind + "|" + hex + "|" + outSide;
    if (BAND.has(key)) return BAND.get(key);
    const B = new Builder();
    const yc = Lm.y0 - (kind === "medic" ? 0.12 : 0.06) * m, hh = (kind === "medic" ? 0.045 : 0.018) * m;
    const h = CBZ.humanLimbHalfAt(g, yc), off = 0.004 * m, N = 16;
    let top = null;
    for (let i = 0; i <= N; i++) {
      const a = i / N * Math.PI * 2, n = [Math.sin(a), 0, Math.cos(a)];
      const p = [(h.hx + off) * n[0], yc, h.cz + (h.hz + off) * n[2]];
      const r = [B.v(add(p, [0, 1, 0], hh), n, hex), B.v(add(p, [0, 1, 0], -hh), n, hex)];
      if (top) B.q(top[1], r[1], r[0], top[0]);
      top = r;
    }
    if (kind === "medic") {
      const F = frame([outSide * (h.hx + off + 0.0015 * m), yc, h.cz], [outSide, 0, 0]);
      box(B, F, 0, 0, 0.001 * m, 0.05 * m, 0.016 * m, 0.002 * m, RED);
      box(B, F, 0, 0, 0.001 * m, 0.016 * m, 0.05 * m, 0.002 * m, RED);
    }
    const out = B.geometry();
    BAND.set(key, out);
    return out;
  }

  /* ---- THE UNIFORM: camouflage on the body's own cloth --------------------
     A Lambert whose diffuse colour is the camo tile sampled TRIPLANAR in the
     mesh's object space (model units x humanScale = metres), so the pattern
     lands at its real size on every garment with no UVs. One per pattern. */
  const CAMO_MAT = new Map();
  function camoMaterial(pattern, tint) {
    const key = pattern + "|" + (tint == null ? "" : tint);
    if (CAMO_MAT.has(key)) return CAMO_MAT.get(key);
    const C = CBZ.camo;
    let mat = null;
    const tex = C && C.texture ? C.texture(pattern, { repeat: 1 }) : null;
    const rec = C && C.pattern ? C.pattern(pattern) : null;
    if (!tex || !rec) {
      let hex = 0x4d5038;
      try { if (C && C.mean) hex = C.mean(pattern); } catch (e) {}
      mat = cm(hex);
    } else {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      // the colour is the tile's mean (what any system that re-tints a body by
      // its material colour, gore's char and blood, reads); the shader draws
      // the tile itself, scaled by tint
      let mean = 0x4d5038;
      try { mean = C.mean(pattern); } catch (e) {}
      mat = new THREE.MeshLambertMaterial({ color: lin(mean) });
      const tintC = new THREE.Color(tint == null ? 0xffffff : tint);
      const scale = 0.7 / rec.metres;
      mat.userData.camo = pattern;
      mat.onBeforeCompile = function (sh) {
        sh.uniforms.uCamo = { value: tex };
        sh.uniforms.uCamoScale = { value: scale };
        sh.uniforms.uCamoTint = { value: tintC };
        sh.vertexShader = sh.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vCamoP;\nvarying vec3 vCamoN;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCamoP = transformed;\nvCamoN = objectNormal;");
        sh.fragmentShader = sh.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform sampler2D uCamo;\nuniform float uCamoScale;\nuniform vec3 uCamoTint;\nvarying vec3 vCamoP;\nvarying vec3 vCamoN;")
          .replace("vec4 diffuseColor = vec4( diffuse, opacity );",
            "vec4 diffuseColor = vec4( diffuse, opacity );\n" +
            "{ vec3 bw = abs(normalize(vCamoN)); bw = bw * bw * bw * bw; bw /= (bw.x + bw.y + bw.z + 1e-5);\n" +
            "  vec3 q = vCamoP * uCamoScale;\n" +
            "  vec3 cc = texture2D(uCamo, q.zy).rgb * bw.x + texture2D(uCamo, q.xz).rgb * bw.y + texture2D(uCamo, q.xy).rgb * bw.z;\n" +
            "  diffuseColor.rgb = sRGBToLinear(vec4(cc, 1.0)).rgb * uCamoTint; }");
      };
      mat.customProgramCacheKey = function () { return "cbz-camo"; };
    }
    mat._shared = true;
    mat.name = "camo-" + pattern;
    CAMO_MAT.set(key, mat);
    return mat;
  }
  function uniformHexOf(pattern) {
    try { if (CBZ.camo && CBZ.camo.mean) return CBZ.camo.mean(pattern); } catch (e) {}
    return 0x4d5038;
  }
  function paintUniform(ch, shirtMat, legMat) {
    const s = ch.skinSlots;
    if (!s) return;
    const put = (list, mt) => { if (list && mt) for (const x of list) if (x && x.material) x.material = mt; };
    put(s.torso, shirtMat); put(s.collar, shirtMat); put(s.arms, shirtMat); put(s.armsLower, shirtMat);
    put(s.legs, legMat); put(s.legsLower, legMat); put(s.pelvis, legMat);
  }
  function boots(ch, hex) {
    const FW = CBZ.footwear;
    if (!FW || !ch.parts || !ch._fw) return;
    for (const leg of [ch.parts.ll, ch.parts.rl]) {
      if (!leg) continue;
      FW.fit(leg, "combat", hex, ch._fw.skin, leg.position && leg.position.x < 0 ? 1 : -1);
      const cap = leg.userData.cap;
      if (cap) cap.material = cm(hex);
    }
    ch._fw.style = "combat";
  }
  function gloves(ch, hex) {
    const hands = ch.skinSlots && ch.skinSlots.hands;
    if (!hands) return;
    for (const h of hands) if (h && h.material && CBZ.cmat) h.material = hex != null ? cm(hex) : CBZ.cmat(ch.skinTone != null ? ch.skinTone : 0xcf9a72);
  }

  // militia: what he has (a shemagh, a beanie, a ball cap, or his own hair)
  const MILITIA_HATS = [["shemagh", 0xd9d2c0, 0x121212], ["beanie", 0x2a2d33], ["ballcap", 0x4b4a3f], null, ["headband", 0x3b3d33], null];
  const MILITIA_SHIRTS = [0x5b5a48, 0x6f6450, 0x3d4436, 0x7a6f58, 0x4a4a44];
  const MILITIA_LEGS = [0x2f3a4c, 0x3a3830, 0x4a4d3a, 0x2a2d33];

  /* ============================================================ WEAR */
  function strip(ch) {
    const K = ch && ch._combatKit;
    if (!K) return;
    for (const o of K.meshes) if (o && o.parent) o.parent.remove(o);
    if (K.eyewear && K.eyewear.parent) K.eyewear.parent.remove(K.eyewear);
    if (CBZ.headwear) { try { CBZ.headwear.wear(ch, null, { owner: "armor" }); } catch (e) {} }
    if (K.armBase != null) { ch.armOutZ = K.armBase; ch.armWear = 0; }
    if (K.hands) gloves(ch, null);
    ch._combatKit = null;
  }
  function wear(ch, spec) {
    if (!ch || !ch.body || !ch.torsoShape) return null;
    const young = ch.child || (ch.ageYears != null && ch.ageYears < 16);
    const L = spec && LOADOUTS[spec.loadout];
    if (!spec || !L || young) { strip(ch); return null; }
    strip(ch);
    const N = L.police ? SWAT : nation(spec.nation);
    const m = 1 / scaleOf(ch);
    const seed = (spec.seed | 0) >>> 0;
    const K = { loadout: spec.loadout, nation: spec.nation || null, meshes: [], eyewear: null, armBase: null, hands: false, armour: null, lod: 1, kitHex: N.kit };
    ch._combatKit = K;
    // ---- the uniform
    if (spec.loadout !== "civilian") {
      if (L.police) {
        const flat = cm(N.uniform);
        paintUniform(ch, flat, flat);
      } else if (spec.loadout === "militia") {
        // a militia wears what it has: an issue shirt or a drab one, its own trousers
        const camoShirt = (seed % 3) === 0 && N.camo;
        const SH = N.shirts || MILITIA_SHIRTS, LG = N.legs || MILITIA_LEGS;
        const shirt = camoShirt ? camoMaterial(N.camo) : cm(SH[seed % SH.length]);
        const legs = (seed % 2) === 0 && N.camo ? camoMaterial(N.camo) : cm(LG[(seed >> 2) % LG.length]);
        paintUniform(ch, shirt, legs);
      } else if (N.camo) {
        const mt = camoMaterial(N.camo);
        paintUniform(ch, mt, mt);
      }
    }
    if (spec.loadout === "civilian") return K;
    boots(ch, N.boots || 0x1c1c1a);
    // ---- the carrier
    const g = geometry(ch, spec.loadout, N.kit, 1);
    if (g) {
      const mesh = new THREE.Mesh(g, material());
      mesh.name = "combat-kit";
      mesh.castShadow = true; mesh.receiveShadow = false;
      mesh.userData.combatKit = true;
      ch.body.add(mesh);
      K.meshes.push(mesh); K.carrier = mesh;
      // how far the kit stands proud of the chest, as the extra shoulder flexion
      // that carries a rifle out over it (entities/soldier.js reads it)
      { const gk0 = g.userData.combatKit, ym = (gk0.cy0 + gk0.cy1) / 2; g.computeBoundingBox();
        const proud = (g.boundingBox.max.z - ch.torsoFrontZ(0, ym)) / m;
        K.chestDepth = Math.max(0, Math.min(0.3, (proud - 0.015) / 0.4)); }
      // the arms carry clear of the carrier (the solve the body owns)
      if (CBZ.humanArmClear && g.userData.combatKit && ch.profile) {
        const gk = g.userData.combatKit;
        const base = ch.armOutZ != null ? ch.armOutZ : ch.profile.armOutZ;
        g.computeBoundingBox();
        const hwx = Math.max(Math.abs(g.boundingBox.min.x), Math.abs(g.boundingBox.max.x));
        // the side pouches stick out further than the band; clear what is at each height
        const a = CBZ.humanArmClear(ch, function (y) { return y >= gk.cy0 - 0.02 * m && y <= gk.cy1 + 0.04 * m ? hwx : (y <= gk.yT ? hwx * 0.82 : 0); },
          gk.yT, gk.cy0 - 0.02 * m, 0.008 * m);
        if (a != null && a > base) { K.armBase = base; ch.armOutZ = a; ch.armWear = a - base; }
      }
    }
    // ---- knee pads, bands
    if (L.knees && ch.skinSlots && ch.skinSlots.legsLower) {
      for (const lo of ch.skinSlots.legsLower) {
        const kg = lo && kneeGeometry(lo.geometry, N.kit, m);
        if (!kg) continue;
        const pad = new THREE.Mesh(kg, material());
        pad.name = "knee-pad"; pad.castShadow = false;
        pad.userData.combatKit = true;
        lo.add(pad); K.meshes.push(pad);
      }
    }
    const arms = ch.skinSlots && ch.skinSlots.arms;
    if (arms) for (const up of arms) {
      if (!up || !up.geometry) continue;
      const outSide = up.parent && up.parent.position && up.parent.position.x < 0 ? -1 : 1;
      const list = [];
      if (spec.mark != null && !L.police) list.push(["tape", spec.mark | 0]);
      if (L.armband === "medic" && outSide > 0) list.push(["medic", WHITE]);
      for (const it of list) {
        const bg = bandGeometry(up.geometry, it[0], it[1], outSide, m);
        if (!bg) continue;
        const b = new THREE.Mesh(bg, material());
        b.name = "arm-band"; b.castShadow = false; b.userData.combatKit = true;
        b.position.copy(up.position);
        up.parent.add(b); K.meshes.push(b);
      }
    }
    // ---- helmet, eye pro, gloves
    const HW = CBZ.headwear;
    if (HW) {
      try {
        if (L.helmet && N.helmet) {
          const kind = N.helmetVariant ? N.helmet + ":" + N.helmetVariant : N.helmet;
          HW.wear(ch, kind, { owner: "armor", color: lin(N.helmetHex), accent: N.helmet === "b6b47" ? lin(tone(N.helmetHex, -0.3)) : undefined });
        } else if (spec.loadout === "militia") {
          const HT = N.hats || MILITIA_HATS, h = HT[seed % HT.length];
          HW.wear(ch, null, { owner: "outfit" });            // no issue cap on a militiaman
          if (h) HW.wear(ch, h[0], { owner: "armor", color: lin(h[1]), accent: h[2] != null ? lin(h[2]) : undefined });
        }
      } catch (e) {}
    }
    if (L.eyepro && CBZ.eyewear && ch.neck) {
      try {
        const ew = CBZ.eyewear.make(ch, "eyepro");
        if (ew) { ch.neck.add(ew); K.eyewear = ew; }
      } catch (e) {}
    }
    if (L.gloves && N.gloves != null) { gloves(ch, N.gloves); K.hands = true; }
    // ---- the armour this kit IS (systems/armour.js)
    // (the mapping is CBZ.armour.kitSpec's: the infantry core issues the same pieces)
    if (CBZ.armour && L.armour.length) K.armour = CBZ.armour.issue(CBZ.armour.kitSpec(N, L.armour, spec.grade));
    K.weight = L.weight || (L.carrier === "plates" ? 0.94 : 1);
    return K;
  }
  function lod(ch, l) {
    const K = ch && ch._combatKit;
    if (!K || !K.carrier) return;
    l = l >= 2 ? 2 : 1;
    if (K.lod === l) return;
    K.lod = l;
    const g = geometry(ch, K.loadout, K.kitHex, l);
    if (g) K.carrier.geometry = g;
    for (const o of K.meshes) if (o !== K.carrier) o.visible = l < 2;
    if (K.eyewear) K.eyewear.visible = l < 2;
  }

  // the colours a far (crowdgpu) soldier wears, so a promoted man keeps them
  function crowdLook(spec) {
    const L = LOADOUTS[spec && spec.loadout] || LOADOUTS.rifleman;
    const N = L.police ? SWAT : nation(spec && spec.nation);
    const cam = N.camo ? uniformHexOf(N.camo) : (N.uniform || 0x4d5038);
    return { shirt: cam, pants: cam, sleeve: cam, shoes: N.boots || 0x1c1c1a, kit: N.kit };
  }

  CBZ.combatKit = {
    version: 1,
    LOADOUTS: LOADOUTS, NATIONS: NATIONS, SWAT: SWAT,
    nation: nation, roleFor: roleFor,
    wear: wear, strip: strip, lod: lod,
    geometry: geometry, kneeGeometry: kneeGeometry, bandGeometry: bandGeometry,
    material: material, camoMaterial: camoMaterial, crowdLook: crowdLook, lin: lin,
  };
})();

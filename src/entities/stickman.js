/* ============================================================
   entities/stickman.js — STICK CITY: every person a black stick figure,
   and the only thing that says who they are is the hat.

   Owner (2026-11-02): "Make an alternate Gang City where characters are
   simple black stickmen and the only thing is hats — bandana, police hat,
   general hat etc etc. See what the savings are, and it's a cooler game —
   why try to be real life."

   THE SWITCH. CBZ.stickLook is decided ONCE, before any body is built:
     window.CBZ = { STICK_LOOK: true }   (the published stick-city.html page)
     ?stick=1                            (any index.html URL; ?stick=0 forces it off)
     ?cfg_STICK_LOOK=1                   (the usual CONFIG override)
   Off (the default), this file defines nothing but CBZ.stickLook = false and
   regular Gang City is byte-for-byte what it was.

   THE SAME BODY, A DIFFERENT SKIN. The rig is still entities/character.js's
   makeCharacter (every joint, the walk, the aim, the IK, the ragdoll, the
   brain), so stickmen walk, run, fight, drive, die exactly like people. Two
   one-line switches in makeCharacter hand the rig here:
     top:    c = CBZ.stickSpec(c)       no hair, beard, uniform hat, clothes
     bottom: CBZ.stickify(rig, c)       every body part becomes a stick
   stickify keeps the rig's OWN meshes (gore, first person, pedinstance and
   the GPU crowd bake all address them through rig.skinSlots) and locks each
   one to a shared stick geometry and ONE shared black material, so the many
   writers that repaint a body (outfits, reactions, gore tints, the skin
   restore) cannot turn it back into a person. The face, collar, waist, belt,
   stripes and bare-arm pieces leave the graph.

   WHAT IS SKIPPED (the savings): the Blender skinned people (PEOPLE_SKINNED
   off: no pack.bin, no skin/garment textures), the painted wardrobe (garment
   atlases, canvases, composite suits), shoes, watches, jewellery, eyewear,
   tattoo charts, duty kits, armour/combat-kit meshes, wound decals on
   bodies, corpse tints, the realistic headwear. Gameplay records (armour
   pools, combat-kit armour) are kept; only their meshes are dropped.

   THE HAT is entities/hats.js (CBZ.hats). A role sweep reads each actor's
   record (gang, rank, cop, SWAT, soldier rank, job, VIP title, archetype)
   and puts the right one on, so a ped whose role changes changes hats.
   Hats fly off on a death or a knockdown (always in a blast), land, and can
   be worn: walk up to one and press H (or tap the button). The clothes shop
   sells hats; the Snapback/Beanie/Fedora items wear the library's hats.
   The GPU crowd wears hats too: CBZ.crowdGPU bakes the crowd hat set as
   gear classes and each person's look picks one (bareheaded is common).
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  const THREE = window.THREE;

  // ---------------------------------------------------------------- the switch
  let on = CBZ.STICK_LOOK === true || !!(CBZ.CONFIG && (CBZ.CONFIG.STICK_LOOK === true || CBZ.CONFIG.STICK_LOOK === "1"));
  try {
    const q = typeof location !== "undefined" && location.search ? new URLSearchParams(location.search).get("stick") : null;
    if (q === "1" || q === "true") on = true;
    else if (q === "0" || q === "false") on = false;
  } catch (e) {}
  if (!on || !THREE || !CBZ.hats) { CBZ.stickLook = false; return; }
  CBZ.stickLook = true;
  const H = CBZ.hats;
  const CONFIG = CBZ.CONFIG = CBZ.CONFIG || {};
  // the realistic layers that would paint a person back over the stick
  CONFIG.PEOPLE_SKINNED = false;            // entities/people.js: no Blender bodies, the pack is never fetched
  CONFIG.CITY_OUTFIT_GUARANTEE = false;     // outfits.js integrity sweep: it "repairs" bodies with no clothes
  CONFIG.GORE_DEATH_MARKS = false;          // gore.js corpseTreat re-tints every body part
  if (typeof document !== "undefined" && document.documentElement) document.documentElement.classList.add("stick-look");

  // linear: the renderer writes sRGB, so this reads as a near-black ink (~#151517)
  const STICK_HEX = 0x020203;
  const TAU = Math.PI * 2;

  /* ---------------------------------------------------------------- the material
     ONE material for every stick part in the city. Its colour is FROZEN: a
     shared material must never be mutated (materials.js), but a body has
     dozens of writers and some write straight through; a frozen colour and
     opacity mean no writer can repaint every stickman at once. */
  function frozenColor(hex) {
    const c = new THREE.Color(hex);
    const r = c.r, g = c.g, b = c.b;
    const self = function () { return this; };
    ["set", "setHex", "setRGB", "setHSL", "setStyle", "setColorName", "setScalar", "copy", "copyGammaToLinear", "copyLinearToGamma",
      "copySRGBToLinear", "copyLinearToSRGB", "convertSRGBToLinear", "convertLinearToSRGB", "convertGammaToLinear", "convertLinearToGamma",
      "offsetHSL", "add", "addColors", "addScalar", "sub", "multiply", "multiplyScalar", "lerp", "lerpColors", "lerpHSL", "fromArray", "fromBufferAttribute"]
      .forEach(function (k) { c[k] = self; });
    Object.defineProperty(c, "r", { get: function () { return r; }, set: function () {} });
    Object.defineProperty(c, "g", { get: function () { return g; }, set: function () {} });
    Object.defineProperty(c, "b", { get: function () { return b; }, set: function () {} });
    return c;
  }
  function freeze(mat, hex, emHex) {
    const col = frozenColor(hex), em = frozenColor(emHex || 0);
    Object.defineProperty(mat, "color", { get: function () { return col; }, set: function () {}, configurable: true });
    Object.defineProperty(mat, "emissive", { get: function () { return em; }, set: function () {}, configurable: true });
    Object.defineProperty(mat, "opacity", { get: function () { return 1; }, set: function () {}, configurable: true });
    Object.defineProperty(mat, "transparent", { get: function () { return false; }, set: function () {}, configurable: true });
    Object.defineProperty(mat, "map", { get: function () { return null; }, set: function () {}, configurable: true });
    mat._shared = true;
    return mat;
  }
  let STICK = null;
  function stickMat() {
    if (STICK) return STICK;
    STICK = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.08 });
    STICK.name = "stick";
    freeze(STICK, STICK_HEX, 0);
    return STICK;
  }
  CBZ.stickMaterial = stickMat;
  let HATMAT = null;
  function hatMat() {
    if (HATMAT) return HATMAT;
    HATMAT = H.material();
    freeze(HATMAT, 0xffffff, 0);
    return HATMAT;
  }

  /* ---------------------------------------------------------------- geometry
     A STICK is a capsule from a to b (radius r) in its mesh's own frame,
     cached on the rounded endpoints so every adult of a body shape shares
     one buffer (pedinstance pools on geometry identity: one draw per shape). */
  const GEO = new Map();
  const _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
  function capsuleRaw(a, b, r, seg, ncap) {
    _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const L = _d.length();
    const nc = ncap || 3, pts = [];
    for (let i = 0; i <= nc; i++) { const t = -Math.PI / 2 + (Math.PI / 2) * i / nc; pts.push(new THREE.Vector2(Math.max(1e-4, r * Math.cos(t)), r * Math.sin(t))); }
    for (let i = 0; i <= nc; i++) { const t = (Math.PI / 2) * i / nc; pts.push(new THREE.Vector2(Math.max(1e-4, r * Math.cos(t)), L + r * Math.sin(t))); }
    pts[0].x = 0; pts[pts.length - 1].x = 0;
    const g = new THREE.LatheGeometry(pts, seg || 8);
    if (L > 1e-6) { _d.multiplyScalar(1 / L); _q.setFromUnitVectors(_up, _d); }
    else _q.identity();
    _m.makeRotationFromQuaternion(_q);
    g.applyMatrix4(_m);
    g.translate(a[0], a[1], a[2]);
    return g;
  }
  function q2(v) { return Math.round(v * 100) / 100; }
  function capsule(a, b, r) {
    a = a.map(q2); b = b.map(q2); r = Math.round(r * 1000) / 1000;
    const key = "c|" + a + "|" + b + "|" + r;
    let g = GEO.get(key);
    if (!g) { g = capsuleRaw(a, b, r, 8); g.computeBoundingSphere(); g._shared = true; g.userData.stick = true; g.userData.spec = { t: "c", a: a, b: b, r: r }; GEO.set(key, g); }
    return g;
  }
  function mergeGeos(list) {
    let n = 0;
    // indexed: shared vertices stay shared (a crowd instance pays every one)
    let ni = 0;
    for (const f of list) { n += f.attributes.position.count; ni += f.index ? f.index.count : f.attributes.position.count; }
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), idx = n > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let o = 0, io = 0;
    for (const f of list) {
      const base = o / 3;
      pos.set(f.attributes.position.array, o); nrm.set(f.attributes.normal.array, o);
      if (f.index) for (let k = 0; k < f.index.count; k++) idx[io++] = base + f.index.getX(k);
      else for (let k = 0; k < f.attributes.position.count; k++) idx[io++] = base + k;
      o += f.attributes.position.array.length;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g._shared = true; g.userData.stick = true;
    return g;
  }
  function multiCapsule(segs, r) {
    const key = "m|" + r.toFixed(3) + "|" + segs.map(function (s) { return s[0].map(q2) + ">" + s[1].map(q2) + (s[2] ? "@" + s[2].toFixed(3) : ""); }).join(";");
    let g = GEO.get(key);
    if (!g) { g = mergeGeos(segs.map(function (s) { return capsuleRaw(s[0].map(q2), s[1].map(q2), s[2] || r, 8); })); g.userData.spec = { t: "m", segs: segs, r: r }; GEO.set(key, g); }
    return g;
  }
  function ball(c, r, ws) {
    const key = "b|" + c.map(q2) + "|" + r.toFixed(3) + "|" + (ws || 0);
    let g = GEO.get(key);
    if (!g) {
      g = new THREE.SphereGeometry(r, ws || 20, ws ? Math.max(6, (ws * 0.7) | 0) : 14);
      g.translate(c[0], c[1], c[2]);
      g.computeBoundingSphere(); g._shared = true; g.userData.stick = true; g.userData.spec = { t: "b", c: c, r: r };
      GEO.set(key, g);
    }
    return g;
  }

  // a mesh locked to its stick: nothing may swap its geometry or material
  function lock(mesh, geo, mat) {
    Object.defineProperty(mesh, "geometry", { get: function () { return geo; }, set: function () {}, configurable: true });
    Object.defineProperty(mesh, "material", { get: function () { return mat; }, set: function () {}, configurable: true });
    mesh.userData.stick = true;
    mesh.userData.cgSlot = 6;           // crowdgpu: a FIXED colour (the baked black), never the look's palette
    mesh.castShadow = true; mesh.receiveShadow = false;
  }
  function detach(o) { if (o && o.parent) o.parent.remove(o); }
  const arr = function (o) { return o && o.toArray ? o.toArray() : [0, 0, 0]; };
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

  /* ---------------------------------------------------------------- the spec
     What a stick body is built from: the same skeleton numbers, none of the
     appearance. The role hat the caller asked for is remembered as a hint. */
  const CAP_KIND = [
    [/^peaked:police|^patrol|^police/, "police"], [/^peaked:captain|^captain/, "captain"], [/^peaked:chauffeur/, "pilot", 1],
    [/^peaked:officer/, "general"], [/^peaked/, "police"], [/milcap|pasgt|b6b47|kpot|ratnik|helmet|mich/, "helmet"],
    [/campaign|smokey|stetson/, "campaign"], [/hardhat/, "hardhat"], [/ballistic|swat/, "swat"], [/riot/, "riot"],
    [/^moto/, "moto"], [/^race/, "racing"], [/beret/, "beret"], [/fedora/, "fedora"], [/trilby/, "trilby"], [/cowboy/, "cowboy"],
    [/bucket/, "bucket"], [/^sun/, "sunhat"], [/beanie/, "beanie"], [/durag|rag/, "durag"], [/bandana/, "bandana"],
    [/headband/, "headband"], [/turban/, "turban"], [/shemagh/, "keffiyeh"], [/snap/, "snapback"], [/ballcap|cap/, "ballcap"],
  ];
  function hatOfKind(kind) {
    if (!kind) return null;
    kind = String(kind).toLowerCase();
    if (H.has(kind)) return { id: kind };
    for (let i = 0; i < CAP_KIND.length; i++) if (CAP_KIND[i][0].test(kind)) return { id: CAP_KIND[i][1], cw: CAP_KIND[i][2] || 0 };
    return null;
  }
  CBZ.stickSpec = function (c) {
    if (!c) return c;
    let hint = null;
    if (c.cap) hint = hatOfKind(c.capKind || "peaked:police");
    else if (c.hat) hint = hatOfKind(c.hat === "sun" ? "sunhat" : (c.hat === "cap" ? (c.hatBack ? "ballcap_back" : "ballcap") : c.hat));
    const o = Object.assign({}, c, { bald: true, beard: null, cap: null, capKind: null, hat: null, clothes: null, stripes: null, badge: null, belt: null });
    o._stickHint = hint;
    return o;
  };

  /* ---------------------------------------------------------------- the body
     Radii in METRES, divided by the rig's humanScale into model units. */
  const R_LIMB = 0.03, R_TORSO = 0.05, R_HAND = 0.042, HEAD_K = 1.12, SHOULDER_K = 0.55;
  CBZ.stickify = function (rig, c) {
    if (!rig || rig._stick || !rig.skinSlots) return rig;
    const P = rig.profile || {};
    const hs = (rig.group && rig.group.userData && rig.group.userData.humanScale) || 0.7;
    const kid = P.child ? 0.85 : 1;
    const rl = R_LIMB / hs * kid, rt = R_TORSO / hs * kid, rh = R_HAND / hs * kid;
    const M = stickMat();
    const s = rig.skinSlots, parts = rig.parts;
    // NARROW SHOULDERS: a stick figure's arms hang from the top of its spine,
    // not from a broad chest. The pivots move in (the rig gets its own
    // profile copy so verbposes' cuff reset and every reader agree on armX);
    // the arm-vs-body solver measures the stick spine, so nothing pushes back.
    if (parts.la && parts.ra && P.armX) {
      const nx = P.armX * SHOULDER_K;
      rig.profile = Object.assign({}, P, { armX: nx });
      parts.la.position.x = nx; parts.ra.position.x = -nx;
    }

    // ---- limbs: upper from the pivot to the joint, lower from the joint to the wrist/sole
    function limbStick(grp, wristY) {
      const up = grp.userData.main, lo = grp.userData.lower, low = grp.userData.low;
      if (up) lock(up, capsule(sub([0, 0, 0], arr(up.position)), sub(arr(low.position), arr(up.position)), rl), M);
      if (lo) lock(lo, capsule(sub([0, 0, 0], arr(lo.position)), sub([0, wristY, 0], arr(lo.position)), rl * 0.96), M);
      if (up && up.userData.bare) detach(up.userData.bare);
    }
    const P_handH = P.handH || 0.2, P_armLo = P.armLo || 0.6;
    for (const k of ["la", "ra"]) {
      const grp = parts[k]; if (!grp) continue;
      limbStick(grp, P_handH - P_armLo + 0.02);
      const hand = grp.userData.cap;
      if (hand) {
        const fs = (hand.userData.fit && hand.userData.fit.s) || hand.scale.x || 1;
        // the hand's own frame: fingers down -Z; the ball sits a touch past the wrist
        lock(hand, ball([0, 0, -rh * 0.55 / fs], rh / fs, 12), M);
      }
    }
    for (const k of ["ll", "rl"]) {
      const grp = parts[k]; if (!grp) continue;
      const foot = grp.userData.foot, sole = foot && foot.userData.dims ? foot.userData.dims.sole : -((P.legLo || 0.5) + 0.05);
      limbStick(grp, sole + rl);
    }
    // ---- the spine + collar bones (one mesh, on the chest) and the hip bar (on the pelvis)
    const chest = s.torso && s.torso[0];
    const hipY = rig.hipY || ((P.legUp || 0.5) + (P.legLo || 0.5));
    const neckAt = arr(rig.neck.position);
    if (chest) {
      const o = arr(chest.position);
      const sh = parts.la ? arr(parts.la.position) : [0.3, neckAt[1] - 0.1, 0], sh2 = parts.ra ? arr(parts.ra.position) : [-sh[0], sh[1], 0];
      const top = [0, sh[1] + rt * 0.4, neckAt[2] * 0.5];
      lock(chest, multiCapsule([
        [sub([0, hipY + 0.02, 0], o), sub([0, neckAt[1] - rt * 0.2, neckAt[2]], o), rt],
        [sub(top, o), sub(sh, o), rl * 1.05],
        [sub(top, o), sub(sh2, o), rl * 1.05],
      ], rt), M);
    }
    const pelvis = s.pelvis && s.pelvis[0];
    if (pelvis && parts.ll && parts.rl) {
      const o = arr(pelvis.position), a = arr(parts.ll.position), b = arr(parts.rl.position);
      const mid = [0, hipY + 0.03, 0];
      lock(pelvis, multiCapsule([[sub(mid, o), sub(a, o), rl * 1.05], [sub(mid, o), sub(b, o), rl * 1.05]], rl), M);
    }
    // ---- the head: a ball sitting on the neck pivot, in the head mesh's own frame
    const head = rig.head;
    const headSize = P.headSize || 0.6, hk = headSize / 0.6;
    const R = headSize * 0.5 * HEAD_K, cy = R * 0.96, cz = 0.0;
    if (head) {
      const hp = arr(head.position), sc = head.scale.x || hk;
      lock(head, ball([(0 - hp[0]) / sc, (cy - hp[1]) / sc, (cz - hp[2]) / sc], R / sc, 22), M);
    }
    rig._stickHead = { y: cy, z: cz, r: R };
    // ---- what a stick figure does not have
    const gone = [].concat(s.torso ? s.torso.slice(1) : [], s.collar || [], s.stripes || [], s.belt || [], s.badge || [], s.hair || [], s.beard || [], s.cap || [], s.shoes || []);
    for (const m of gone) detach(m);
    if (rig.faceNodes) { detach(rig.faceNodes.near); detach(rig.faceNodes.far); }
    if (rig.neck) rig.neck.children.slice().forEach(function (ch) { if (ch.name === "face") detach(ch); });
    rig.skinTone = STICK_HEX;
    rig._stick = true;
    rig._stickHint = c && c._stickHint || null;
    rig._clothesKey = null;             // outfits.js's cop sweep: already dressed
    // watch.js registers a wrist on its own (its recolour wrap calls a local
    // fit): a placeholder record that is never in its roster is never mounted
    // (its rig is a stand-in, so the player's default watch never applies either)
    if (!rig._ww) {
      const ww = { stick: true, rig: { group: rig.group }, R: function () { return 0; }, tier: 0 };
      // a restyle may assign a role: it never sticks
      Object.defineProperty(ww, "role", { get: function () { return null; }, set: function () {} });
      Object.defineProperty(ww, "over", { get: function () { return null; }, set: function () {} });
      rig._ww = ww;
    }
    if (rig._stickHint) wearHat(rig, rig._stickHint.id, rig._stickHint.cw || 0);
    return rig;
  };

  /* ---------------------------------------------------------------- hats on rigs */
  function wearHat(rig, id, cw) {
    if (!rig || !rig.neck || !rig._stickHead) return null;
    const key = id ? id + "|" + (typeof cw === "object" ? JSON.stringify(cw) : (cw | 0)) : "";
    const cur = rig._hat;
    if (cur && cur.key === key) return cur.mesh;
    if (cur && cur.mesh) detach(cur.mesh);
    rig._hat = null;
    if (!id || !H.has(id)) { rig._hat = { key: "", id: null, mesh: null }; return null; }
    const g = H.geometry(id, { cw: cw, lod: 0 });
    const m = new THREE.Mesh(g, hatMat());
    lock(m, g, hatMat());
    m.userData.cgSlot = undefined;
    m.name = "stickhat";
    const S = rig._stickHead;
    m.position.set(0, S.y, S.z);
    m.scale.setScalar(S.r);
    m.castShadow = true;
    rig.neck.add(m);
    rig._hat = { key: key, id: id, cw: cw, mesh: m };
    return m;
  }
  CBZ.stickWearHat = wearHat;

  /* ---------------------------------------------------------------- who wears what */
  function gangOf(id) {
    const L = (CBZ.CITY && CBZ.CITY.gangs) || [];
    for (let i = 0; i < L.length; i++) if (L[i].id === id) return L[i];
    return null;
  }
  function hash(a, b) { let h = (Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35)) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; return (h ^ (h >>> 12)) >>> 0; }
  // THE STREET'S HATS: what an ordinary person might wear (about half go bareheaded)
  const CIV = ["ballcap", "ballcap", "ballcap_back", "snapback", "trucker", "beanie", "beanie", "beanie_pom", "bucket", "flatcap", "newsboy",
    "fedora", "trilby", "porkpie", "bowler", "beret", "cowboy", "sunhat", "visor", "headphones", "boater", "bikehelmet", "kufi", "turban",
    "durag", "headband", "ballcap_side", "homburg"];
  const FUN = ["party", "propeller", "crown", "viking", "tricorne", "wizard", "witch", "santa", "jester", "catears", "bunny", "halo", "horns", "cone", "tophat", "sombrero", "grad", "fez", "knight", "tiara"];
  function civilianHat(skin, shirt) {
    const h = hash(skin | 0, shirt | 0);
    const r = h % 100;
    if (r < 42) return null;
    if (r >= 97) return { id: H.pick(FUN, h >>> 8), cw: (h >>> 16) & 7 };
    return { id: H.pick(CIV, h >>> 8), cw: (h >>> 16) & 7 };
  }
  CBZ.stickCivilianHat = civilianHat;
  const JOB = [
    [/fire/i, "fire"], [/construction|builder|roofer|welder|site/i, "hardhat"], [/miner|quarry/i, "miner"],
    [/chef|cook|kitchen|baker/i, "chef"], [/nurse/i, "nurse"], [/doctor|surgeon|physician/i, "scrubcap"], [/paramedic|ems|medic/i, "medic"],
    [/sheriff|deputy|ranger|trooper/i, "campaign"], [/pilot|aviator|first officer|aircrew/i, "pilot"],
    [/captain|skipper|mariner|harbou?r master/i, "captain"], [/sailor|deckhand|navy/i, "sailor"], [/lifeguard/i, "bucket", 5],
    [/racer|driver.*race|pit crew/i, "racing"], [/biker/i, "moto"], [/bartender/i, "porkpie"], [/waiter|valet|bellhop|porter|concierge/i, "bellhop"],
    [/chauffeur/i, "pilot", 1], [/cab|taxi/i, "newsboy"], [/detective|investigator/i, "fedora"], [/warden/i, "homburg"],
    [/corrections|guard|jailer/i, "police", 3], [/inmate|prisoner|convict/i, "convict"], [/mechanic|garage/i, "trucker", 2],
    [/dock|warehouse|courier|delivery|longshore/i, "beanie", 4], [/hunter|ground crew|marshal/i, "boonie"], [/farm|rancher|cowboy/i, "cowboy"],
    [/vendor|hot ?dog|food truck|soda/i, "paper"], [/judge/i, "bowler"], [/senator|mayor|councillor|official|minister/i, "homburg"],
    [/president/i, "tophat"], [/tourist/i, "sunhat"], [/jogger|athlete|trainer|boxer|fighter/i, "sweatband"], [/busker|musician|dj/i, "porkpie", 3],
    [/student/i, "ballcap_back"], [/professor|teacher/i, "flatcap"], [/priest|imam|rabbi/i, "kufi", 1], [/scientist|lab/i, "scrubcap", 3],
    [/soldier|private|infantry|rifleman/i, "helmet"], [/general/i, "general"], [/officer/i, "beret"],
    [/close protection|bodyguard|secret service|agent|counter-sniper/i, "fedora", 1], [/doorman|bouncer/i, "beanie", 6], [/security/i, "police", 3],
  ];
  function jobHat(job) {
    if (!job) return null;
    for (let i = 0; i < JOB.length; i++) if (JOB[i][0].test(job)) return { id: JOB[i][1], cw: JOB[i][2] || 0 };
    return null;
  }
  // GANGS: the bandana in the crew's colour; a crew's style for a few; rank shows on top
  const GANG_STYLE = { cosa: "fedora", cartel: "cowboy", angels: "moto", brand: "beanie" };
  function gangHat(p) {
    const gd = gangOf(p.gang);
    const col = gd ? gd.color : ((CBZ.game && CBZ.game.playerGang && CBZ.game.playerGang.id === p.gang && CBZ.game.playerGang.color) || 0xb079ea);
    const acc = gd && gd.accent != null ? gd.accent : 0x15161a;
    const rank = p.rank || "";
    if (p.isBoss || rank === "boss") return { id: "crown", cw: { a: 0xe0b440, b: col, c: col } };
    if (rank === "lt" || rank === "lieutenant") return { id: "durag", cw: { a: col, b: acc } };
    const st = GANG_STYLE[p.gang];
    if (st === "fedora") return { id: "fedora", cw: { a: 0x22232a, b: col } };
    if (st === "cowboy") return { id: "cowboy", cw: { a: 0xd8c8a0, b: col, c: 0xc9ccd2 } };
    if (st === "moto") return { id: "moto", cw: { a: col, b: acc, c: 0x2a3a4a } };
    if (st === "beanie") return { id: "beanie", cw: { a: col, b: acc } };
    return { id: "bandana", cw: { a: col, b: acc, c: 0xeceae4 } };
  }
  function hatFor(p) {
    if (!p) return null;
    const job = p.job || "";
    if (p.kind === "cop" || p.isCop) {
      if (p.swat) return { id: "swat" };
      if (p.copRank === "captain" || p.copRank === "chief") return { id: "police_chief" };
      if (/riot/i.test(job)) return { id: "riot" };
      if (/sheriff|deputy/i.test(job)) return { id: "campaign" };
      return { id: "police" };
    }
    if (p.kind === "medic") return { id: "medic" };
    if (p.vipTitle) {
      const v = String(p.vipTitle);
      if (/magnate|tycoon/i.test(v)) return { id: "tophat" };
      if (/don|boss/i.test(v)) return { id: "fedora", cw: 3 };
      if (/senator|official|mayor/i.test(v)) return { id: "homburg" };
      if (/star|celebrity/i.test(v)) return { id: "beret", cw: 4 };
      if (/judge/i.test(v)) return { id: "bowler" };
      if (/president/i.test(v)) return { id: "tophat" };
    }
    // a gang's own wear its colours (a gang "soldier" is a rank, not the army);
    // its families stay civilians
    if (p.gang && !p.isFamily && job !== "family" && (p.kind === "gang" || p.rank || p.kind === "crew" || p.recruited || /gang/i.test(job))) return gangHat(p);
    if (p.milRank) {
      if (p.milRank === "general") return { id: "general" };
      if (p.milRank === "lieutenant") return { id: "beret", cw: 1 };
      return { id: "helmet" };
    }
    if (p.kind === "security") return jobHat(job) || { id: "police", cw: 3 };
    const jh = jobHat(job) || jobHat(p._role) || jobHat(p.archetype === "tourist" ? "tourist" : "");
    if (jh) return jh;
    if (p.vagrant || p.archetype === "vagrant") return { id: "beanie", cw: 5 };
    if (p.archetype === "dealer" || p._role === "dealer") return { id: (hash(p.tag | 0, 7) & 1) ? "durag" : "ballcap_back", cw: 2 };
    if (p.archetype === "hustler") return { id: "snapback" };
    if (p.archetype === "tweaker" || p.archetype === "junkie" || p._role === "junkie") return { id: "beanie", cw: 3 };
    if (p.archetype === "official") return { id: "homburg" };
    if (p.gang && !p.isFamily && job !== "family") return gangHat(p);
    if (p.child) {
      const h = hash((p.tag | 0) + 3, 11) % 4;
      return h === 0 ? { id: "propeller", cw: (p.tag | 0) % 3 } : h === 1 ? { id: "ballcap", cw: (p.tag | 0) & 7 } : h === 2 ? { id: "beanie_pom", cw: (p.tag | 0) % 5 } : null;
    }
    const L = p.char && p.char.look;
    return civilianHat(L ? L.skin : (p.skin | 0), L ? L.torso : (p.outfit | 0) + (p.tag | 0));
  }
  CBZ.stickHatFor = hatFor;

  /* ---------------------------------------------------------------- the player's hat
     Priority: a hat you picked up / bought last > the uniform you wear >
     your gang's colours > the story you chose. */
  const ORIGIN = { contract: { id: "fedora", cw: 1 }, exec: { id: "trilby", cw: 1 }, pilot: { id: "pilot" }, racer: { id: "racing" },
    captain: { id: "captain" }, president: { id: "tophat" }, hustler: { id: "snapback" }, debtor: { id: "flatcap" }, wick: null,
    barfly: { id: "porkpie", cw: 1 }, tenant: { id: "beanie" } };
  let playerPick = null, lastShopHat = null;
  function shopHatName() {
    const E = CBZ.cityEcon;
    try { const n = E && E.outfit ? E.outfit().hat : null; return n && E.count(n) > 0 ? n : null; } catch (e) { return null; }
  }
  function playerHat() {
    const g = CBZ.game || {};
    const sh = shopHatName();
    if (sh !== lastShopHat) {
      lastShopHat = sh;
      if (sh) { const it = CBZ.cityEcon.ITEMS[sh]; const k = it && it.hatLook; const hh = k && (H.has(k) ? { id: k, cw: it.hatCw || 0 } : hatOfKind(k)); if (hh) playerPick = hh; }
    }
    if (playerPick) return playerPick.id ? playerPick : null;
    const wo = g.cityWornOutfit;
    if (wo) { const w = typeof wo === "string" ? wo : (wo.id || wo.name || ""); const j = /swat/i.test(w) ? { id: "swat" } : /police|cop/i.test(w) ? { id: "police" } : jobHat(w); if (j) return j; }
    const gid = (g.cityMembership && g.cityMembership.gangId) || (g.playerGang && g.playerGang.id);
    if (gid) return gangHat({ gang: gid, rank: g.cityMembership && g.cityMembership.rank });
    const o = g.cityOrigin && ORIGIN[g.cityOrigin];
    if (o !== undefined) return o;
    return { id: "ballcap", cw: 1 };
  }

  /* ---------------------------------------------------------------- flying hats
     A hat leaves the head on a death or a knockdown (always in a blast),
     tumbles on its own, lands and lies there to be worn. */
  const LOOSE = [];
  const MAX_LOOSE = 40;
  const _w = new THREE.Vector3(), _wq = new THREE.Quaternion(), _ws = new THREE.Vector3();
  function groundAt(x, z, fallback) {
    try { const y = typeof CBZ.groundAt === "function" ? CBZ.groundAt(x, z) : null; if (y != null && isFinite(y)) return y; } catch (e) {}
    return fallback;
  }
  function knockHat(rig, imp, big) {
    const h = rig && rig._hat;
    if (!h || !h.mesh || !h.mesh.parent || !CBZ.scene) return false;
    const m = h.mesh;
    m.updateWorldMatrix(true, false);
    m.matrixWorld.decompose(_w, _wq, _ws);
    detach(m);
    CBZ.scene.add(m);
    m.position.copy(_w); m.quaternion.copy(_wq); m.scale.copy(_ws);
    let dx = 0, dz = 0;
    if (imp && imp.dir) { dx = imp.dir.x || 0; dz = imp.dir.z || 0; }
    else if (imp && imp.fromX != null && rig.group) { dx = rig.group.position.x - imp.fromX; dz = rig.group.position.z - imp.fromZ; }
    const l = Math.hypot(dx, dz);
    if (l > 1e-3) { dx /= l; dz /= l; } else { const a = Math.random() * TAU; dx = Math.sin(a); dz = Math.cos(a); }
    const sp = big ? 5 + Math.random() * 5 : 1.6 + Math.random() * 1.8;
    const baseY = rig.group ? rig.group.position.y : _w.y - 1.6;
    LOOSE.push({ mesh: m, id: h.id, cw: h.cw, vx: dx * sp, vy: big ? 6 + Math.random() * 4 : 2.4 + Math.random() * 1.5, vz: dz * sp,
      sx: (Math.random() - 0.5) * (big ? 16 : 7), sz: (Math.random() - 0.5) * (big ? 16 : 7), t: 0, rest: false, floor: baseY });
    rig._hat = { key: "", id: null, mesh: null, off: true };
    if (LOOSE.length > MAX_LOOSE) { const o = LOOSE.shift(); detach(o.mesh); }
    return true;
  }
  CBZ.stickKnockHat = knockHat;
  const _up2 = new THREE.Vector3(0, 1, 0), _hu = new THREE.Vector3(), _qq = new THREE.Quaternion();
  function stepLoose(dt) {
    for (let i = LOOSE.length - 1; i >= 0; i--) {
      const L = LOOSE[i], m = L.mesh;
      L.t += dt;
      if (L.t > 240) { detach(m); LOOSE.splice(i, 1); continue; }
      if (L.rest) continue;
      L.vy -= 18 * dt;
      m.position.x += L.vx * dt; m.position.y += L.vy * dt; m.position.z += L.vz * dt;
      m.rotation.x += L.sx * dt; m.rotation.z += L.sz * dt;
      const gy = groundAt(m.position.x, m.position.z, L.floor);
      const bb = m.geometry.boundingBox, bot = bb ? -bb.min.y * m.scale.y : m.scale.y * 0.2;
      const lift = Math.max(m.scale.y * 0.25, bot * 0.6);
      if (m.position.y <= gy + lift && L.vy < 0) {
        m.position.y = gy + lift;
        if (Math.abs(L.vy) > 2.5) { L.vy = -L.vy * 0.3; L.vx *= 0.5; L.vz *= 0.5; L.sx *= 0.4; L.sz *= 0.4; }
        else {
          // settle: crown up, a little lean, at rest
          _hu.set(0, 1, 0).applyQuaternion(m.quaternion);
          const yaw = Math.atan2(_hu.x, _hu.z) + Math.random();
          m.rotation.set(0, yaw, 0);
          m.rotation.x = (Math.random() - 0.5) * 0.3;
          m.position.y = gy + bot + 0.01;
          L.rest = true;
        }
      }
    }
  }
  // the nearest resting hat within reach of the player
  function nearHat() {
    const p = CBZ.player && CBZ.player.pos;
    if (!p) return null;
    let best = null, bd = 2.0 * 2.0;
    for (let i = 0; i < LOOSE.length; i++) {
      const L = LOOSE[i]; if (!L.rest) continue;
      const dx = L.mesh.position.x - p.x, dz = L.mesh.position.z - p.z, dy = L.mesh.position.y - (p.y || 0);
      if (Math.abs(dy) > 2.2) continue;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = L; }
    }
    return best;
  }
  function takeHat(L) {
    const pc = CBZ.playerChar;
    if (!L || !pc) return false;
    const i = LOOSE.indexOf(L); if (i < 0) return false;
    LOOSE.splice(i, 1); detach(L.mesh);
    // what you had drops at your feet
    if (pc._hat && pc._hat.mesh) knockHat(pc, null, false);
    playerPick = { id: L.id, cw: L.cw };
    wearHat(pc, L.id, L.cw);
    const info = H.info(L.id);
    if (CBZ.city && CBZ.city.note) CBZ.city.note("You put on the " + (info ? info.name : "hat") + ".", 1.6);
    return true;
  }
  // a row of hats at your feet when the run starts: pick one
  function layShowcase() {
    const pc = CBZ.playerChar, p = CBZ.player && CBZ.player.pos;
    if (!pc || !p || !CBZ.scene || !pc._stickHead) return false;
    const set = ["fedora", "tophat", "cowboy", "crown", "snapback", "beanie_pom", "viking", "sombrero", "wizard", "propeller", "tricorne", "party"];
    const yaw = CBZ.player.yaw || 0;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const r = pc._stickHead.r * ((pc.group && pc.group.userData.humanScale) || 0.7);
    const baseY = pc.group ? pc.group.position.y : (p.y || 0);
    for (let i = 0; i < set.length; i++) {
      const a = (i / set.length) * TAU;
      const x = p.x + Math.sin(a) * 2.4, z = p.z + Math.cos(a) * 2.4;
      const m = new THREE.Mesh(H.geometry(set[i], { cw: i % 3 }), hatMat());
      m.scale.setScalar(r); m.castShadow = true;
      const bb = m.geometry.boundingBox;
      m.position.set(x, baseY - (bb ? bb.min.y : -0.2) * r + 0.01, z);
      m.rotation.y = a + Math.PI;
      CBZ.scene.add(m);
      LOOSE.push({ mesh: m, id: set[i], cw: i % 3, vx: 0, vy: 0, vz: 0, sx: 0, sz: 0, t: 0, rest: true, floor: baseY });
    }
    return true;
  }

  /* ---------------------------------------------------------------- the prompt (keyboard H + a tap target) */
  let btn = null, btnFor = null;
  function ensureBtn() {
    if (btn || typeof document === "undefined" || !document.body) return btn;
    btn = document.createElement("button");
    btn.id = "stickHatBtn";
    btn.type = "button";
    btn.style.cssText = "position:fixed;left:50%;bottom:22%;transform:translateX(-50%);z-index:60;display:none;" +
      "font:700 15px/1 Fredoka,Arial,sans-serif;color:#111;background:#ffd166;border:0;border-radius:999px;padding:11px 18px;" +
      "box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer;letter-spacing:.02em";
    btn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); if (btnFor) takeHat(btnFor); });
    btn.addEventListener("touchstart", function (e) { e.preventDefault(); e.stopPropagation(); if (btnFor) takeHat(btnFor); }, { passive: false });
    document.body.appendChild(btn);
    return btn;
  }
  function inCity() { const g = CBZ.game; return !!(g && (g.mode === "city" || g.mode === "archipelago") && g.state === "playing"); }
  if (typeof addEventListener === "function") addEventListener("keydown", function (e) {
    if (e.code !== "KeyH" || e.repeat || !inCity()) return;
    const t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    const L = nearHat(); if (L) { takeHat(L); e.preventDefault(); }
  });

  /* ---------------------------------------------------------------- the role sweep */
  const STATE = new WeakMap();      // actor -> {dead, ko}
  let sweepI = 0, showcased = false;
  function actors() {
    const out = [];
    const lists = [CBZ.cityPeds, CBZ.cityCops, CBZ.cityMedics, CBZ.citySecurity];
    for (const L of lists) if (L && L.length) for (let i = 0; i < L.length; i++) out.push(L[i]);
    return out;
  }
  function sweepOne(p) {
    const ch = p && p.char;
    if (!ch || !ch._stick) return;
    if (!p._bling) p._bling = { meshes: [], nVal: 0, looted: false, stick: true };   // bling.js: no jewellery on a stick
    let st = STATE.get(p);
    if (!st) { st = { dead: !!p.dead, ko: (p.ko || 0) > 0 }; STATE.set(p, st); }
    const dead = !!p.dead, ko = (p.ko || 0) > 0;
    if (dead && !st.dead) { if (Math.random() < 0.6) knockHat(ch, p._stickImp || null, !!p._stickBig); }
    else if (ko && !st.ko && !dead) { if (Math.random() < 0.4) knockHat(ch, p._stickImp || null, false); }
    st.dead = dead; st.ko = ko;
    // gore took the head: the hat does not stay floating over the neck
    if (ch._hat && ch._hat.mesh && ch.head && (ch.head.visible === false || ch.head.parent !== ch.neck)) knockHat(ch, p._stickImp || null, true);
    if (dead || (ch._hat && ch._hat.off)) return;          // a body keeps what it has; a knocked-off hat stays off
    const want = hatFor(p);
    if (want) wearHat(ch, want.id, want.cw || 0); else wearHat(ch, null);
  }
  function tick(dt) {
    if (!inCity()) return;
    stepLoose(dt || 0.016);
    // the player
    const pc = CBZ.playerChar;
    if (pc && pc._stick && CBZ.player) {
      if (!showcased && CBZ.player.pos) showcased = layShowcase();
      const pl = CBZ.player;
      if (pl.dead && !(pc._hat && pc._hat.off)) knockHat(pc, null, false);
      else if (!pl.dead) { if (pc._hat && pc._hat.off) pc._hat = null; const w = playerHat(); wearHat(pc, w && w.id, w ? w.cw || 0 : 0); }
    }
    // everyone else, a slice a frame
    const A = actors();
    const n = Math.min(A.length, 40);
    for (let k = 0; k < n; k++) { sweepI = (sweepI + 1) % Math.max(1, A.length); sweepOne(A[sweepI]); }
    // the prompt
    const L = nearHat();
    if (ensureBtn()) {
      if (L && !(CBZ.player && (CBZ.player.dead || CBZ.player.driving))) {
        if (btnFor !== L) { const info = H.info(L.id); btn.textContent = "Wear the " + (info ? info.name : "hat") + "  [H]"; btnFor = L; }
        btn.style.display = "block";
      } else if (btnFor || btn.style.display !== "none") { btn.style.display = "none"; btnFor = null; }
    }
  }
  if (CBZ.onUpdate) CBZ.onUpdate(97.5, tick);

  /* ---------------------------------------------------------------- the GPU crowd's hats
     Each crowd hat kind is baked onto the bake rig's head as a gear class
     (crowdgpu.js: class 8 + k, shown when the instance's hat selector is k),
     its primary in the per-instance colour and its trim baked. */
  const CROWD = ["ballcap", "ballcap_back", "snapback", "beanie", "bucket", "flatcap", "fedora", "cowboy", "sunhat", "party"];
  const CROWD_IX = Object.create(null);
  CROWD.forEach(function (id, i) { CROWD_IX[id] = i + 1; });
  // the crowd's body: the same sticks at a fraction of the vertices
  const LOW = new Map();
  function lowOf(g) {
    const sp = g && g.userData && g.userData.spec;
    if (!sp) return null;
    let L = LOW.get(g);
    if (L) return L;
    if (sp.t === "c") L = capsuleRaw(sp.a, sp.b, sp.r, 5, 2);
    else if (sp.t === "m") L = mergeGeos(sp.segs.map(function (s) { return capsuleRaw(s[0].map(q2), s[1].map(q2), s[2] || sp.r, 5, 2); }));
    else if (sp.t === "b") { L = new THREE.SphereGeometry(sp.r, 10, 7); L.translate(sp.c[0], sp.c[1], sp.c[2]); }
    LOW.set(g, L);
    return L;
  }
  function crowdGear(ch) {
    if (!ch || !ch._stick || !ch.neck) return;
    const S = ch._stickHead;
    ch.group.traverse(function (o) {
      if (!o.isMesh || !o.userData.stick || o.name === "stickhat") return;
      const L = lowOf(o.geometry);
      if (L) lock(o, L, o.material);
    });
    for (let i = 0; i < CROWD.length; i++) {
      const sp = H.split(CROWD[i], { lod: 2, cw: 0 });
      const cls = 8 + i + 1;
      if (sp.main) {
        const m = new THREE.Mesh(sp.main, new THREE.MeshLambertMaterial({ color: 0xffffff }));
        m.userData.cgGear = cls; m.userData.cgSlot = 8;
        m.position.set(0, S.y, S.z); m.scale.setScalar(S.r); ch.neck.add(m);
      }
      if (sp.detail) {
        const d = new THREE.Mesh(sp.detail, new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }));
        d.userData.cgGear = cls; d.userData.cgSlot = 6;
        d.position.set(0, S.y, S.z); d.scale.setScalar(S.r); ch.neck.add(d);
      }
    }
  }
  const _lc = new THREE.Color();
  function linHex(hex) { return _lc.setHex(hex).convertSRGBToLinear().getHex(); }
  // look record -> {k, color}: the same pick a promoted rig makes from the same colours
  function crowdHat(lk) {
    if (!lk) return null;
    const h = civilianHat(lk.skin, lk.shirt);
    if (!h || !CROWD_IX[h.id]) {
      if (!h) return null;
      // a hat the crowd set lacks: the nearest everyday one
      const alt = H.pick(CROWD.slice(0, 12), hash(lk.skin | 0, (lk.shirt | 0) + 1));
      return { k: CROWD_IX[alt], color: linHex(H.colorOf(alt, h.cw).a) };
    }
    return { k: CROWD_IX[h.id], color: linHex(H.colorOf(h.id, h.cw).a) };
  }

  /* ---------------------------------------------------------------- the skips
     Installed as soon as each module exists. Each guard leaves the module
     whole for any other page; it only stops it dressing a stick. */
  function stubs() {
    const F = CBZ.footwear;
    if (F && !F._stick) { F._stick = true; const d = F.dress, r = F.restyle; F.dress = function () { return null; }; F.restyle = function () { return null; }; F._stickOrig = { dress: d, restyle: r }; }
    const W = CBZ.wristwatch;
    if (W && !W._stick) { W._stick = true; W.fit = function () { return null; }; if (W.restyle) W.restyle = function () { return null; }; if (W.attach) W.attach = function () { return null; }; if (W.wristPlace) W.wristPlace = function () { return null; }; }
    const HW = CBZ.headwear;
    if (HW && !HW._stick) { HW._stick = true; HW.wear = function () { return null; }; if (HW.setLod) HW.setLod = function () {}; }
    const E = CBZ.eyewear;
    if (E && !E._stick) { E._stick = true; E.make = function () { return null; }; }
    const T = CBZ.tattoo;
    if (T && !T._stick) { T._stick = true; T.refresh = function () { return false; }; if (T.assign) T.assign = function () { return null; }; }
    const J = CBZ.jewel;
    if (J && !J._stick) { J._stick = true; ["necklace", "ring", "earrings", "grill", "tiara", "bracelet"].forEach(function (k) { if (J[k]) J[k] = function () { return null; }; }); if (J.setPlayerRing) J.setPlayerRing = function () {}; }
  }
  stubs();
  function copyTags(from, to) { for (const k in from) { try { to[k] = from[k]; } catch (e) {} } return to; }
  function lateStubs() {
    stubs();
    const R = CBZ.cityRecolorRig;
    if (typeof R === "function" && !R._stickWrapped) {
      // the wardrobe: a stick is dressed by its hat, nothing else
      const w = copyTags(R, function (ch) { if (ch && ch._stick) return true; return R.apply(this, arguments); });
      w._stickWrapped = true; CBZ.cityRecolorRig = w;
    }
    for (const k of ["applyClothes", "cityApplyClothes", "cityApplyComposite"]) {
      const f = CBZ[k];
      if (typeof f === "function" && !f._stickWrapped) { const w = copyTags(f, function (ch) { if (ch && ch._stick) return null; return f.apply(this, arguments); }); w._stickWrapped = true; CBZ[k] = w; }
    }
    for (const k of ["cityAttachBandana", "cityRoleHat"]) {
      const f = CBZ[k];
      if (typeof f === "function" && !f._stickWrapped) { const w = copyTags(f, function (ch) { if (ch && ch._stick) return null; return f.apply(this, arguments); }); w._stickWrapped = true; CBZ[k] = w; }
    }
    if (typeof CBZ.cityArmColors === "function" && !CBZ.cityArmColors._stickWrapped) {
      const f = CBZ.cityArmColors;
      const w = function (ch) { if (ch && ch._stick) return { skin: STICK_HEX, sleeve: STICK_HEX }; return f.apply(this, arguments); };
      w._stickWrapped = true; CBZ.cityArmColors = w;
    }
    const DK = CBZ.dutyKit;
    if (DK && DK.wear && !DK._stick) { DK._stick = true; const f = DK.wear; DK.wear = function (ch) { if (ch && ch._stick) return null; return f.apply(this, arguments); }; }
    const CK = CBZ.combatKit;
    if (CK && CK.wear && !CK._stick) {
      CK._stick = true; const f = CK.wear;
      // the armour is gameplay (fpsmode reads it): keep the record, drop the meshes
      CK.wear = function (ch) {
        const K = f.apply(this, arguments);
        if (ch && ch._stick && K) { (K.meshes || []).forEach(detach); detach(K.eyewear); }
        return K;
      };
    }
    const AD = CBZ.cityArmorDressPed;
    if (typeof AD === "function" && !AD._stickWrapped) {
      const w = copyTags(AD, function (ped) {
        const r = AD.apply(this, arguments);
        if (ped && ped.char && ped.char._stick && ped._armorMeshes) ped._armorMeshes.forEach(function (m) { if (m) m.visible = false; });
        return r;
      });
      w._stickWrapped = true; CBZ.cityArmorDressPed = w;
    }
    for (const k of ["bodyWound", "bodyBite"]) {
      const f = CBZ[k];
      if (typeof f === "function" && !f._stickWrapped) {
        const w = copyTags(f, function (actor) { const ch = actor && (actor.char || (actor === CBZ.player ? CBZ.playerChar : null)); if (ch && ch._stick) return undefined; return f.apply(this, arguments); });
        w._stickWrapped = true; CBZ[k] = w;
      }
    }
    // a death or a knockdown: remember the blow so the hat flies the right way
    for (const k of ["cityKillPed", "cityKOPed"]) {
      const f = CBZ[k];
      if (typeof f === "function" && !f._stickWrapped) {
        const w = copyTags(f, function (ped, imp, cause) {
          if (ped) {
            ped._stickImp = imp || null;
            ped._stickBig = !!(imp && (imp.explosion || imp.blast || imp.vehicle || imp.car || imp.fling)) || /explo|blast|rocket|grenade|bomb|car|vehicle|run ?over|nuke|missile/i.test(String(cause || (imp && imp.cause) || ""));
            if (ped._stickBig && ped.char) knockHat(ped.char, imp, true);
          }
          return f.apply(this, arguments);
        });
        w._stickWrapped = true; CBZ[k] = w;
      }
    }
    // the GPU crowd
    const CG = CBZ.crowdGPU;
    if (CG && CG.gear && !CG._stick) { CG._stick = true; CG.gear(crowdGear); if (CG.hats) CG.hats(crowdHat); }
    // the shop sells hats
    shopHats();
  }

  /* ---------------------------------------------------------------- the shop */
  const SHOP = [
    ["Baseball Cap", "ballcap", 40, 1], ["Trucker Cap", "trucker", 40, 1], ["Bucket Hat", "bucket", 60, 1], ["Flat Cap", "flatcap", 90, 2],
    ["Newsboy Cap", "newsboy", 110, 2], ["Cowboy Hat", "cowboy", 260, 4], ["Top Hat", "tophat", 900, 9], ["Bowler", "bowler", 320, 5],
    ["Pork Pie", "porkpie", 280, 4], ["Trilby", "trilby", 300, 4], ["Homburg", "homburg", 650, 7], ["Boater", "boater", 220, 3],
    ["Beret", "beret", 150, 3], ["Durag", "durag", 30, 1], ["Headphones", "headphones", 350, 4], ["Motorbike Helmet", "moto", 400, 3],
    ["Sombrero", "sombrero", 180, 3], ["Viking Helmet", "viking", 500, 5], ["Pirate Hat", "tricorne", 450, 5], ["Wizard Hat", "wizard", 420, 4],
    ["Crown", "crown", 25000, 30], ["Party Hat", "party", 15, 1], ["Propeller Beanie", "propeller", 25, 1], ["Traffic Cone", "cone", 10, 1],
  ];
  let shopDone = false;
  function shopHats() {
    if (shopDone) return;
    const E = CBZ.cityEcon;
    if (!E || !E.ITEMS || !E.SHOP_STOCK) return;
    shopDone = true;
    for (const s of SHOP) if (!E.ITEMS[s[0]]) E.ITEMS[s[0]] = { value: s[2], tag: "wearable", slot: "hat", drip: s[3], hatLook: s[1], hatColor: H.colorOf(s[1], 0).a };
    // the old three wear the library's hats; everything that is not a hat is meaningless on a stick
    const isHat = function (n) { const it = E.ITEMS[n]; return it && it.slot === "hat"; };
    E.SHOP_STOCK.clothing = ["Baseball Cap", "Snapback", "Beanie", "Bucket Hat", "Cowboy Hat", "Durag", "Headphones", "Party Hat", "Traffic Cone"].concat(E.SHOP_STOCK.clothing.filter(function (n) { return isHat(n) && ["Snapback", "Beanie"].indexOf(n) < 0; }));
    E.SHOP_STOCK.boutique = ["Fedora", "Homburg", "Trilby", "Top Hat", "Bowler", "Pork Pie", "Boater", "Beret", "Crown"];
    E.SHOP_STOCK.barber = ["Flat Cap", "Newsboy Cap", "Trucker Cap", "Motorbike Helmet", "Sombrero", "Viking Helmet", "Pirate Hat", "Wizard Hat", "Propeller Beanie"];
  }

  /* ---------------------------------------------------------------- the front door */
  function titleCard() {
    if (typeof document === "undefined") return;
    try {
      document.title = "Stick City";
      const city = document.querySelector(".mode-city-only");
      if (city) {
        const logo = city.querySelector(".logo"); if (logo) logo.innerHTML = "STICK <span class=\"z\">CITY</span>";
        const k = city.querySelector(".hub-kicker"); if (k) k.textContent = "Everyone is a stickman. The hat is who you are.";
        const sb = city.querySelector(".sub"); if (sb) sb.textContent = "Knock a hat off and wear it. Gangs wear their colours. Cops wear the cap.";
      }
      const mb = document.querySelector('#modeSelect .mode-btn[data-mode="city"] span'); if (mb) mb.textContent = "Stick City";
    } catch (e) {}
  }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { lateStubs(); titleCard(); });
    else { lateStubs(); titleCard(); }
  }
  // modules that load lazily or wrap late get caught on the next frames
  if (CBZ.onAlways) { let n = 0; CBZ.onAlways(0.4, function () { if (++n % 30 === 0 && n < 3000) lateStubs(); }); }

  /* ---------------------------------------------------------------- the other bodies
     The city draws a few people that are not rigs: the seated figure in a
     passing car (city/vehicles.js occGeo) and the queue / office figures
     (city/citystaff.js). Each gets a stick in its own frame. */
  const _vc = new THREE.Color();
  function paintGeo(g, hex, linear) {
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    _vc.setHex(hex); if (!linear) _vc.convertSRGBToLinear();
    for (let i = 0; i < n; i++) { a[i * 3] = _vc.r; a[i * 3 + 1] = _vc.g; a[i * 3 + 2] = _vc.b; }
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    return g;
  }
  function concat(list) {
    let n = 0;
    const flat = list.map(function (g) { const f = g.index ? g.toNonIndexed() : g; n += f.attributes.position.count; return f; });
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let o = 0;
    for (const f of flat) { pos.set(f.attributes.position.array, o); nrm.set(f.attributes.normal.array, o); col.set(f.attributes.color.array, o); o += f.attributes.position.array.length; }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeBoundingSphere(); g._shared = true;
    return g;
  }
  const SEATED = new Map();
  // seated body: origin on the seat, facing +z, head at 0.84 (vehicles.js's frame)
  CBZ.stickSeatedGeo = function (variant) {
    let g = SEATED.get(variant);
    if (g) return g;
    const r = 0.028, ink = function (geo) { return paintGeo(geo, STICK_HEX, true); };
    const parts = [
      ink(capsuleRaw([0, 0.12, -0.06], [0, 0.66, -0.05], 0.04, 8)),                         // spine
      ink(capsuleRaw([0.1, 0.1, -0.02], [0.1, 0.12, 0.4], r, 8)), ink(capsuleRaw([-0.1, 0.1, -0.02], [-0.1, 0.12, 0.4], r, 8)),   // thighs
      ink(capsuleRaw([0.1, 0.12, 0.4], [0.1, -0.3, 0.46], r, 8)), ink(capsuleRaw([-0.1, 0.12, 0.4], [-0.1, -0.3, 0.46], r, 8)),   // shins
      ink(capsuleRaw([0, 0.62, -0.04], [0.11, 0.6, -0.03], r, 8)), ink(capsuleRaw([0, 0.62, -0.04], [-0.11, 0.6, -0.03], r, 8)),
      ink(capsuleRaw([0.11, 0.6, -0.03], [0.16, 0.4, 0.14], r, 8)), ink(capsuleRaw([-0.11, 0.6, -0.03], [-0.16, 0.4, 0.14], r, 8)),
      ink(capsuleRaw([0.16, 0.4, 0.14], [0.15, 0.48, 0.36], r, 8)), ink(capsuleRaw([-0.16, 0.4, 0.14], [-0.15, 0.48, 0.36], r, 8)),
      ink(new THREE.SphereGeometry(0.115, 16, 12).translate(0, 0.84, -0.03)),
    ];
    // a hat on most drivers: the street's own pick for this variant
    const h = civilianHat(0x8d5b3a + variant * 977, 0x3b5a8c + variant * 131);
    if (h && H.has(h.id)) {
      const hg = H.geometry(h.id, { cw: h.cw, lod: 1 }).clone();
      hg.scale(0.115, 0.115, 0.115); hg.translate(0, 0.84, -0.03);
      parts.push(hg);
    }
    g = concat(parts);
    SEATED.set(variant, g);
    return g;
  };
  let STAFF = null;
  // a standing figure centred at y 0.62 above its feet (citystaff.js's body box)
  CBZ.stickStaffGeo = function () {
    if (STAFF) return STAFF;
    const r = 0.03, y = -0.62;
    const P = function (a, b, rr) { return capsuleRaw([a[0], a[1] + y, a[2]], [b[0], b[1] + y, b[2]], rr || r, 8); };
    STAFF = mergeGeos([
      P([0, 0.9, 0], [0, 1.2, 0], 0.045),
      P([0.08, 0.9, 0], [0.09, 0.05, 0]), P([-0.08, 0.9, 0], [-0.09, 0.05, 0]),
      P([0, 1.16, 0], [0.12, 1.14, 0]), P([0, 1.16, 0], [-0.12, 1.14, 0]),
      P([0.12, 1.14, 0], [0.15, 0.72, 0.03]), P([-0.12, 1.14, 0], [-0.15, 0.72, 0.03]),
    ]);
    return STAFF;
  };
  CBZ.stickStaffHeadGeo = function () { return ball([0, 0, 0], 0.13, 14); };
  CBZ.STICK_HEX = STICK_HEX;

  CBZ.stickAudit = function () {
    let rigs = 0, hats = 0;
    for (const p of actors()) if (p && p.char && p.char._stick) { rigs++; if (p.char._hat && p.char._hat.mesh) hats++; }
    return { on: true, rigs: rigs, hatted: hats, loose: LOOSE.length, geometries: GEO.size, hatKinds: H.ids().length, hatGeos: H.audit().geometries,
      player: CBZ.playerChar && CBZ.playerChar._hat ? CBZ.playerChar._hat.id : null };
  };
  CBZ.stickLoose = LOOSE;
  CBZ.stickTakeHat = takeHat;           // (the H key's action, for tools)
  CBZ.stickNearHat = nearHat;
})();

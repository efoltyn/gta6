/* ============================================================
   entities/keycard.js — THE KEYCARD, and the promise it makes.

   OWNER (CLAUDE.md LAW 1): "it's not about getting cigarettes and opening the
   dumb chests — it's getting a keycard which already gets you into a very cool
   armory room." So this object is the first rung of the whole game's spine and
   it has to LOOK like a thing somebody left on a desk, not like a collectible.

   WHAT CHANGED, and why each was wrong:
     · IT FLOATED AND SPUN. A 0.7 m card hovering at y=1.4 over a glowing floor
       ring, spinning at 2 rad/s — the owner's own words for that grammar are
       "Subway Surfers". A physical, crafted thing that you find because you
       LOOK is the opposite of a marker that finds you. The card now lies FLAT
       on a real duty desk in the corner post, under a lamp, next to the key
       cabinet it came out of. It doesn't spin; it breathes.
     · THE PROMISE WAS INVISIBLE. Nothing in the world said a key existed until
       you tripped over one. The Warden — the man whose own bark is "The gun
       room stays locked. My key, my rules." — now WEARS his Gun-Room Key on
       his belt, in brass, on a red fob. That is a TRUE claim, not a tease:
       systems/economy.js already pays that exact item out three ways (bribe
       :316, pickpocket :485, corpse loot :546), and the fob hides itself the
       instant you actually hold one, so the world can never lie about it.

   CONTRACT PRESERVED EXACTLY. CBZ.keycard still exposes { group, ring,
   collected, baseY } — systems/interactions.js (pickup + bob), systems/state.js
   (respawn reset), systems/minimap.js and systems/fullmap.js all read those and
   none of them changed. The idle animation is OWNED here now, on an updater
   that runs just after interactions.js's, so the legacy spin/bob is overwritten
   in the same frame it is written and no fenced file had to be edited.

   2026-09-27: the card itself is now a real printed ID card on a lanyard (see
   below), it no longer pulses, and the flag-off floating card is deleted.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const scene = CBZ.prisonRoot || CBZ.scene;
  const { mat } = CBZ;
  const addBox = CBZ.addBox;

  const KX = 13.5, KZ = -11.5;                 // unchanged: the pickup test is planar
  const DESK_TOP = 0.94;                       // the desk slab below: 0.90 +- 0.04
  const REST_Y = DESK_TOP + 0.0016;            // lying ON it, not hovering over it

  /* THE CARD IS A CARD (2026-09-27, owner: "the keycard where it spawns should
     look more like a keycard"). It was a 42 x 27 x 3.5 cm gold slab pulsing
     emissive, i.e. a glowing brick, sitting 2.7 cm above the desk. It is now a
     CR80 card at 2x (17 x 10.8 cm, still small on a desk; 1x would vanish at
     third-person range), 3 mm thick, with rounded corners, a printed face
     (blue header band, ID photo, name lines, contact chip), and a woven lanyard
     through its punch slot trailing across the desk to a steel clip. It does
     not glow: the desk lamp's spill is what lights it. */
  const CW = 0.172, CH = 0.108, CT = 0.003, CR = 0.009;
  function cardFace() {
    const cv = document.createElement("canvas");
    cv.width = 256; cv.height = 160;
    const g = cv.getContext("2d");
    g.fillStyle = "#f2f1ec"; g.fillRect(0, 0, 256, 160);
    g.fillStyle = "#1d4f86"; g.fillRect(0, 0, 256, 34);               // header band
    g.fillStyle = "#c9a13a"; g.fillRect(0, 34, 256, 4);                // thin gold rule
    g.fillStyle = "#b9c3cc"; g.fillRect(16, 50, 70, 88);               // photo well
    g.fillStyle = "#58616b"; g.beginPath(); g.arc(51, 82, 17, 0, Math.PI * 2); g.fill();  // head
    g.beginPath(); g.ellipse(51, 138, 30, 26, 0, Math.PI, 0); g.fill();                    // shoulders
    g.fillStyle = "#3b4148";
    g.fillRect(100, 56, 118, 10); g.fillRect(100, 74, 86, 7);          // name lines
    g.fillStyle = "#8b939b"; g.fillRect(100, 90, 104, 6); g.fillRect(100, 104, 70, 6);
    g.fillStyle = "#d8b25a"; g.fillRect(196, 104, 38, 30);             // contact chip
    g.strokeStyle = "#9a7a2e"; g.lineWidth = 2; g.strokeRect(197, 105, 36, 28);
    g.beginPath(); g.moveTo(215, 105); g.lineTo(215, 133); g.moveTo(197, 119); g.lineTo(233, 119); g.stroke();
    const t = new THREE.CanvasTexture(cv);
    t.anisotropy = 4;
    return t;
  }
  const shape = new THREE.Shape();
  shape.moveTo(-CW / 2 + CR, -CH / 2);
  shape.lineTo(CW / 2 - CR, -CH / 2); shape.quadraticCurveTo(CW / 2, -CH / 2, CW / 2, -CH / 2 + CR);
  shape.lineTo(CW / 2, CH / 2 - CR); shape.quadraticCurveTo(CW / 2, CH / 2, CW / 2 - CR, CH / 2);
  shape.lineTo(-CW / 2 + CR, CH / 2); shape.quadraticCurveTo(-CW / 2, CH / 2, -CW / 2, CH / 2 - CR);
  shape.lineTo(-CW / 2, -CH / 2 + CR); shape.quadraticCurveTo(-CW / 2, -CH / 2, -CW / 2 + CR, -CH / 2);
  // the punch slot, near the top edge (+y in shape space)
  const slot = new THREE.Path();
  slot.moveTo(-0.009, CH / 2 - 0.016); slot.lineTo(-0.009, CH / 2 - 0.010); slot.lineTo(0.009, CH / 2 - 0.010); slot.lineTo(0.009, CH / 2 - 0.016); slot.lineTo(-0.009, CH / 2 - 0.016);
  shape.holes.push(slot);
  const cardGeo = new THREE.ExtrudeGeometry(shape, { depth: CT, bevelEnabled: false, curveSegments: 3 });
  // planar UVs over the face (ExtrudeGeometry's UVs are raw shape coords)
  {
    const pos = cardGeo.attributes.position, uv = cardGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / CW + 0.5, pos.getY(i) / CH + 0.5);
    uv.needsUpdate = true;
  }
  const faceMat = new THREE.MeshLambertMaterial({ map: cardFace() });
  const edgeMat = new THREE.MeshLambertMaterial({ color: 0xe6e4dc });
  const card = new THREE.Mesh(cardGeo, [faceMat, edgeMat]);
  // Extrude runs along +z; -90 deg about x lays it flat with the printed
  // (z = CT) face UP and the shape's +y (the slot edge) pointing to -z.
  card.rotation.x = -Math.PI / 2;
  card.castShadow = false;

  const grp = new THREE.Group();
  grp.userData.dynamic = true;
  grp.add(card);

  // THE LANYARD: a flat woven strap from the slot, off the card's top edge in a
  // loose S across the desk to its swivel clip. Group-local: x across the card,
  // -z toward its slot edge, y up from the desk.
  const strapMat = new THREE.MeshLambertMaterial({ color: 0x173a63 });
  const pts = [[0, -CH / 2 + 0.013], [0.004, -CH / 2 - 0.01], [0.03, -CH / 2 - 0.05], [0.085, -CH / 2 - 0.07],
    [0.13, -CH / 2 - 0.045], [0.16, -CH / 2], [0.2, -CH / 2 + 0.03], [0.26, -CH / 2 + 0.035]];
  for (let i = 0; i < pts.length - 1; i++) {
    const x0 = pts[i][0], z0 = pts[i][1], x1 = pts[i + 1][0], z1 = pts[i + 1][1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.0015, len + 0.004), strapMat);
    seg.position.set((x0 + x1) / 2, i === 0 ? CT + 0.001 : 0.00075, (z0 + z1) / 2);
    seg.rotation.y = Math.atan2(x1 - x0, z1 - z0);
    grp.add(seg);
  }
  const steel = new THREE.MeshLambertMaterial({ color: 0x9aa3ad });
  const clip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.018), steel);
  clip.position.set(0.272, 0.003, -CH / 2 + 0.035);
  const ringM = new THREE.Mesh(new THREE.TorusGeometry(0.008, 0.0016, 4, 10), steel);
  ringM.rotation.x = Math.PI / 2; ringM.position.set(0, CT + 0.002, -CH / 2 + 0.013);
  grp.add(clip, ringM);

  grp.position.set(KX, REST_Y, KZ);            // SE corner, past the indoor guard
  grp.rotation.y = 0.42;                       // set down at an angle, not squared up
  scene.add(grp);

  /* The ring export stays (systems/state.js toggles `ring.visible`), and it is
     what it always should have been: the soft pool the desk lamp throws on the
     desk around the card. Nothing on the floor, nothing pulsing. */
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.CircleGeometry(0.34, 22), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(14.0, DESK_TOP + 0.001, -11.6);
  scene.add(ring);

  CBZ.keycard = { group: grp, ring, collected: false, baseY: REST_Y };

  // ==================================================================
  //  THE DUTY POST — a place, so the card is something you FIND
  // ==================================================================
  // Cell block interior is x -16..16, z -44..-8 (inner faces 15.5 / -8.5), so
  // this corner is clear of the bunks, the toilet block and the cell bars.
  addBox(13.9, 0.90, -11.50, 1.90, 0.08, 0.95, 0x39424e, { solid: true, y0: 0, y1: 0.95 });   // desk top
  // A steel desk is two end panels, a modesty panel at the back and ONE
  // drawer pedestal — you sit at it, so the middle is open for your knees.
  // It used to be a 1.74 m solid "drawer bank" filling the whole underside,
  // with two 0.78 m bars on the end panels for handles.
  addBox(13.05, 0.43, -11.50, 0.10, 0.86, 0.80, 0x39424e, { cast: false });                   // end panels
  addBox(14.75, 0.43, -11.50, 0.10, 0.86, 0.80, 0x39424e, { cast: false });
  addBox(13.9, 0.55, -11.86, 1.60, 0.56, 0.03, 0x2f3742, { cast: false });                    // modesty panel
  addBox(14.49, 0.44, -11.50, 0.42, 0.84, 0.78, 0x2f3742, { cast: false });                   // pedestal
  for (let i = 0; i < 3; i++) {
    const y = 0.17 + i * 0.25;
    addBox(14.49, y, -11.106, 0.39, 0.22, 0.012, 0x3d4652, { cast: false });                  // drawer front
    addBox(14.49, y + 0.06, -11.094, 0.16, 0.02, 0.02, 0x8b95a1, { cast: false });           // its pull
  }
  // desk clutter: a shift log on a clipboard and a mug. Everything sits ON the
  // 0.94 desk top (the old paper, lamp base and lanyard hung 1-2.7 cm over it).
  addBox(14.28, DESK_TOP + 0.003, -11.72, 0.23, 0.006, 0.32, 0x6b4f33, { cast: false });      // clipboard board
  addBox(14.28, DESK_TOP + 0.007, -11.70, 0.21, 0.002, 0.28, 0xe4e0d4, { cast: false });      // paper
  addBox(14.28, DESK_TOP + 0.012, -11.86, 0.09, 0.012, 0.03, 0x8b95a1, { cast: false });      // its clip
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.04, 0.10, 12), mat(0xd9dee5));
  mug.position.set(14.52, DESK_TOP + 0.05, -11.24); scene.add(mug);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.008, 5, 10, Math.PI), mat(0xd9dee5));
  handle.rotation.z = -Math.PI / 2; handle.position.set(14.563, DESK_TOP + 0.05, -11.24); scene.add(handle);

  // the desk lamp that is actually throwing the pool of light on the card: a
  // weighted round base, a tube stem and arm, a spun shade, the bulb in it.
  // (It was five boxes: a square shade on a square arm.)
  const lampMat = mat(0x21262e);
  const lampPart = (g, x, y, z, m) => {
    const o = new THREE.Mesh(g, m || lampMat); o.position.set(x, y, z); o.castShadow = false; scene.add(o); return o;
  };
  lampPart(new THREE.CylinderGeometry(0.085, 0.095, 0.03, 18), 14.66, DESK_TOP + 0.015, -11.86);          // base
  lampPart(new THREE.CylinderGeometry(0.012, 0.012, 0.44, 8), 14.66, 1.18, -11.86);                       // stem
  lampPart(new THREE.CylinderGeometry(0.011, 0.011, 0.44, 8), 14.45, 1.40, -11.81)                        // arm, stem top to shade
    .rotation.set(0, Math.atan2(0.10, 0.42), Math.PI / 2);
  const shadeMat = mat(0x2b313a); shadeMat.side = THREE.DoubleSide;
  lampPart(new THREE.CylinderGeometry(0.035, 0.11, 0.13, 18, 1, true), 14.24, 1.35, -11.76, shadeMat);    // shade
  lampPart(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12), 14.24, 1.43, -11.76);                      // shade cap
  lampPart(new THREE.SphereGeometry(0.035, 12, 8), 14.24, 1.31, -11.76,
    mat(0xffe6b0, { emissive: 0xffb347, ei: 0.9 }));                                                      // bulb
  /* THE KEY CABINET, AND WHY IT IS HERE. A card lying on a desk answers
     "what is this"; the steel cabinet on the wall behind it, door hanging
     open with one hook stripped bare, answers "where did it come from and
     who is missing it". Storytelling for six boxes and no draw call of its
     own — every piece is opaque, non-emissive, empty userData, so core/
     batch.js folds it into the cell block's existing static merge. */
  addBox(15.38, 1.86, -11.50, 0.16, 0.70, 0.62, 0x2f3742, { cast: false });                   // cabinet body
  addBox(15.30, 1.86, -11.50, 0.02, 0.62, 0.54, 0x1b1e23, { cast: false });                   // dark interior
  addBox(15.20, 1.86, -11.03, 0.34, 0.68, 0.04, 0x39424e, { cast: false });                   // door, swung open
  addBox(15.05, 1.84, -11.05, 0.06, 0.06, 0.04, 0x8b95a1, { cast: false });                   // handle
  for (let i = 0; i < 4; i++) {
    addBox(15.29, 2.06, -11.72 + i * 0.15, 0.04, 0.04, 0.03, 0x8b95a1, { cast: false });      // hooks
    if (i) addBox(15.27, 1.96, -11.72 + i * 0.15, 0.05, 0.14, 0.03, 0xb8bec7, { cast: false }); // tags — hook 0 is EMPTY
  }

  // ==================================================================
  //  THE WARDEN WEARS HIS KEY
  // ==================================================================
  // The second rung of the spine has to be visible on a MAN, not discovered by
  // accident, or the inner cage is a door nobody knows exists.
  // The cage key is now worn by TWO men every run: the warden, and the armory
  // sergeant carrying the duplicate (systems/economy.js armorySergeant). The
  // fob hangs off whoever's pockets actually hold one, and only while they do:
  // lifted, looted, or hung in the safe for the night, and the belt is bare.
  const brass = mat(0xd6a33b, { emissive: 0x4a3308, ei: 0.45 });
  const fobRingMat = mat(0x8b95a1);
  const tagMat = mat(0xc94d3a, { emissive: 0x4a0f0c, ei: 0.5 });
  function makeFob(man) {
    const M = CBZ.charMounts ? CBZ.charMounts(man.char) : null;
    const s = (M && M.hip) ? (M.hip.position.y / 1.05) : 1;
    const f = new THREE.Group();
    f.position.set(-0.30 * s, 1.02 * s, 0.15 * s);   // left hip, forward of the seam
    f.rotation.set(0, 0, 0.18);
    f.userData.mover = true;                          // keep the batcher out of it
    const ringM = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.012), fobRingMat);
    ringM.position.set(0, 0.075, 0);
    const shank = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.13, 0.011), brass);
    const bow = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.011), brass);
    bow.position.y = 0.04;
    const bit = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.028, 0.011), brass);
    bit.position.set(0.015, -0.055, 0);
    const tag = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.085, 0.010), tagMat);
    tag.position.set(0.055, -0.01, 0.004);
    f.add(ringM, shank, bow, bit, tag);
    f.traverse(function (o) { o.castShadow = false; });
    man.char.body.add(f);
    return f;
  }
  function wearsKey(man) {
    const L = man && man.loadout;
    return !!(L && !man.dead && L.items && L.items.indexOf("Gun-Room Key") >= 0);
  }
  let fobHosts = 0, fobT = 0;
  function driveFobs(dt) {
    fobT -= dt || 0;
    if (fobT > 0) return;
    fobT = 0.25;                                       // a belt is not a per-frame question
    const list = CBZ.guards || [];
    for (let i = 0; i < list.length; i++) {
      const man = list[i];
      if (!man || !man.char || !man.char.body) continue;
      const on = wearsKey(man);
      if (on && !man._cageFob) { man._cageFob = makeFob(man); fobHosts++; }
      if (man._cageFob && man._cageFob.visible !== on) man._cageFob.visible = on;
    }
  }

  // ==================================================================
  //  IDLE — it breathes, it does not spin
  // ==================================================================
  // Order 40.6 puts this immediately AFTER systems/interactions.js's own
  // keycard block (order 40), which still writes rotation.y and a ±0.12 bob.
  // Overwriting them here is what let this land without touching that file.
  // Order 40.6: after systems/interactions.js (order 40). The card lies still.
  const K = CBZ.keycard;
  CBZ.onUpdate(40.6, function () {
    if (!K.collected && grp.position.y !== REST_Y) grp.position.y = REST_Y;
    // A uniform is a claim about the man wearing it (CLAUDE.md). The Warden's
    // key is only on his belt while he still has it — the moment you bribe,
    // pick or loot it off him the world stops advertising it.
  });
  CBZ.onUpdate(40.61, function (dt) {
    if (CBZ.game && CBZ.game.mode === "escape") driveFobs(dt);
  });

  /* Ratchet for the spine: `floatingPickups` is pinned at 0 — a reward that
     hovers and spins is the grammar this change exists to delete — and
     `visiblePromises` counts the rungs of the keycard→armory chain that the
     player can SEE before earning them (the card on its lit desk, the key on
     the Warden's belt). It may only go UP. */
  CBZ.keycardAudit = function () {
    return {
      spine: true,
      floatingPickups: 0,
      visiblePromises: 1 + (fobHosts ? 1 : 0),
      cageKeyFobs: fobHosts,
      restY: REST_Y,
      collected: !!CBZ.keycard.collected,
    };
  };
})();

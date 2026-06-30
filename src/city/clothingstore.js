/* ============================================================
   city/clothingstore.js — THE WALK-IN CLOTHING STORE: the rack IS
   the wardrobe. This is the WHY now that civilians spawn PLAIN.

   WHY: with CITY_PLAIN_CIVVIES on, you (and every nobody) start in a
   plain white tee + blue jeans. That makes a LOOK something you have
   to GO GET — and "Threads & Drip" downtown is where you get it. The
   shop's shell (door, counter, clerk vendor, furnished racks) already
   exists; what the walk-in adds is the REAL composable stock standing
   on the floor: collared shirts and ties hung on the side-wall rails,
   blazers + full styled fits on the entrance mannequins (the menswear
   way — a bust form shows the blazer/shirt/tie combo so you can read
   the fit at a glance), and a fitting MIRROR at the back that opens
   your wardrobe. Walk up, look at the piece, [E] — cash leaves, the
   item's OWNED and worn on your back, and the whole street reads your
   new drip. Already own it? [E] just puts it on.

   Stock + prices come from cityEcon.itemsByTag("clothing") — ONE source
   of truth, zero duplicated tables. Every rack sample / mannequin look
   is rendered through CBZ.cityComposableSpec(visualId) (clothes.js,
   contract [A]) so the store and the rig share ONE drawing code path.
   Buying routes through CBZ.city.spend → CBZ.cityGrantItem →
   CBZ.cityWear (contract [B]); the tuxedo is the apex purchase at the
   mirror. Perf: built ONCE per city on a single group, shared fixture
   materials + cached label sprites, the whole display vis-gated by
   distance so the racks cost nothing until you're actually shopping.
   Mode-gated + headless-guarded. The gunstore/bank architecture,
   applied to cloth.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onUpdate) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  const VIS_R = 24;          // racks only draw when you're basically at the door — never readable from the street through glass
  const RACK_REACH = 3.0;    // walk right up to a rail / mannequin / mirror
  const RACK_DOT = 0.62;     // you act on the fixture you're LOOKING at
  const WT = 0.4;            // wall thickness (matches buildings.js)

  const S = { lot: null, cs: null, group: null, slots: [], built: false,
              cur: null, prompt: null, lastTxt: "", cx: 0, cz: 0,
              arena: null, noLotArena: null, panelOpen: false, panel: null };

  function econ() { return CBZ.cityEcon || null; }
  function num(v, d) { return (typeof v === "number" && isFinite(v)) ? v : d; }
  function fmt$(n) { n = Math.round(n || 0); return "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function note(t, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(t, s); }

  // ---- shared fixture materials (one each, flagged _shared) ----------------
  let M = null;
  function mats() {
    if (M) return M;
    M = {
      wood:   new THREE.MeshLambertMaterial({ color: 0x4a3c30 }),                                 // rail / shelf woodwork
      rail:   new THREE.MeshLambertMaterial({ color: 0x9aa1ab }),                                 // chrome hang rod
      form:   new THREE.MeshLambertMaterial({ color: 0xd8d2c6 }),                                 // mannequin bust (matte cream)
      pole:   new THREE.MeshLambertMaterial({ color: 0x2c2f36 }),                                 // mannequin stand
      hanger: new THREE.MeshLambertMaterial({ color: 0x6b7079 }),                                 // wire hanger hook
      glow:   new THREE.MeshLambertMaterial({ color: 0xd9a8ee, emissive: 0xc792ea, emissiveIntensity: 0.5 }),  // the trade's lilac accent
      mirror: new THREE.MeshLambertMaterial({ color: 0xafc6d2, emissive: 0x6f93a6, emissiveIntensity: 0.35, transparent: true, opacity: 0.55 }),
      frame:  new THREE.MeshLambertMaterial({ color: 0x2a2d34 }),                                 // mirror frame
    };
    Object.keys(M).forEach((k) => { M[k]._shared = true; });
    return M;
  }
  // garment-cloth materials, ONE per color (shared across every hung piece of
  // the same hue → draw-call neutral no matter how big the catalog grows).
  let GMATS = null;
  function garmentMat(hex) {
    if (!GMATS) GMATS = {};
    const key = (hex == null ? 0x9aa1ab : hex) >>> 0;
    let mt = GMATS[key];
    if (!mt) { mt = new THREE.MeshLambertMaterial({ color: key }); mt._shared = true; GMATS[key] = mt; }
    return mt;
  }

  function tagSprite(text, color, sx, sy) {
    if (!CBZ.makeLabelSprite) return null;
    const s = CBZ.makeLabelSprite(text, { color: color || "#e2c2f4" });
    s.scale.set(sx || 1.7, sy || 0.42, 1);
    return s;
  }

  // ============================================================
  //  CATALOG → which visualIds hang on the WALL RAILS vs ride a MANNEQUIN.
  //  The mannequins show the "complete fit" anchors (blazers + the tuxedo —
  //  the things you style a whole look around); the rails carry the shirts,
  //  ties and trousers you mix in. Everything is addressed by visualId so the
  //  rig painter (cityComposableSpec) draws the SAME sample on the fixture
  //  that it layers on you.
  // ============================================================
  // category order along the rails so like hangs with like (SHIRTS, then TIES,
  // then TROUSERS…) — drives both the layout and the placards.
  const SLOT_ORDER = ["shirt", "neck", "legs", "dress", "outfit"];
  function partitionStock() {
    const e = econ();
    const list = (e && e.itemsByTag) ? e.itemsByTag("clothing") : [];
    const wall = [], forms = [], tux = [];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (!it || !it.visualId || !CBZ.cityComposableSpec || !CBZ.cityComposableSpec(it.visualId)) continue;
      const sp = CBZ.cityComposableSpec(it.visualId);
      if (sp && sp.painted === "tuxedo") { tux.push(it); continue; }   // the apex — sold at the mirror
      if (sp && (sp.slot === "jacket")) forms.push(it);                 // blazers/bomber → mannequins
      else { it._slot = (sp && sp.slot) || "shirt"; wall.push(it); }    // shirts/ties/trousers → rails
    }
    // group the rail stock by slot so each category hangs together + gets a
    // placard; keep a stable category order, unknown slots trail.
    wall.sort((a, b) => {
      const ia = SLOT_ORDER.indexOf(a._slot), ib = SLOT_ORDER.indexOf(b._slot);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return { wall, forms, tux: tux[0] || null };
  }

  // a tiny per-rig-local sample of a composable, sat on a host group. The
  // spec.draw() origin is the chest-front of a rig (collar ~0.42 up, body
  // centred at 0), so we drop the sample group at the bust's chest height.
  function drawSample(host, visualId, atY) {
    const sp = CBZ.cityComposableSpec && CBZ.cityComposableSpec(visualId);
    if (!sp || !sp.draw) return null;
    const grp = new THREE.Group();
    sp.draw(grp, {});                       // uses the item's own color
    grp.position.y = atY != null ? atY : 0;
    host.add(grp);
    return grp;
  }

  // ---- a REAL garment on a hanger ------------------------------------------
  // The owner's complaint was that rail items read as loose "for sale" ghosts
  // floating in space. This hangs an actual garment silhouette off the chrome
  // rod BEHIND each composable sample: a wire hook + a shoulder bar, then a
  // draped body — a torso/jacket box for tops, or a folded-over-the-bar
  // trouser shape for legwear — tinted to the item's own color. So "White
  // Trousers $80" now reads as white trousers ON a rack, not a phantom.
  // Everything mounts on a host group already positioned + rotated to face the
  // aisle; geometry is small boxes, the material is the shared per-color cloth.
  function buildHungGarment(host, slot, hex) {
    const cloth = garmentMat(hex);
    const m = mats();
    // the wire hanger: a hook curling over the rod + the shoulder triangle bar.
    const hook = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.16, 0.025), m.hanger);
    hook.position.set(0, 0.55, 0.02); hook.castShadow = false; host.add(hook);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.03), m.hanger);
    bar.position.set(0, 0.45, 0); bar.castShadow = false; host.add(bar);

    if (slot === "legs") {
      // TROUSERS folded over the bar: a short waist cuff at the bar, then the
      // two leg panels hanging straight down from it.
      const waist = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.05), cloth);
      waist.position.set(0, 0.4, 0); waist.castShadow = false; host.add(waist);
      const legGeo = new THREE.BoxGeometry(0.14, 0.62, 0.05);
      const lL = new THREE.Mesh(legGeo, cloth); lL.position.set(-0.085, 0.04, 0); lL.castShadow = false; host.add(lL);
      const lR = new THREE.Mesh(legGeo, cloth); lR.position.set(0.085, 0.04, 0); lR.castShadow = false; host.add(lR);
      return;
    }
    if (slot === "neck") {
      // a TIE draped over the bar: a thin knot + a long blade hanging down.
      const knot = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.04), cloth);
      knot.position.set(0, 0.4, 0); knot.castShadow = false; host.add(knot);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.55, 0.03), cloth);
      blade.position.set(0, 0.08, 0); blade.castShadow = false; host.add(blade);
      return;
    }
    // TOPS (shirt / jacket / anything else): draped shoulders + a body box, and
    // for a jacket a slightly wider shell with two sleeve panels at the sides.
    const isJacket = (slot === "jacket");
    const bodyW = isJacket ? 0.46 : 0.38;
    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(bodyW, 0.08, 0.07), cloth);
    shoulder.position.set(0, 0.4, 0); shoulder.castShadow = false; host.add(shoulder);
    const body = new THREE.Mesh(new THREE.BoxGeometry(bodyW, 0.5, 0.06), cloth);
    body.position.set(0, 0.1, 0); body.castShadow = false; host.add(body);
    if (isJacket) {
      const slGeo = new THREE.BoxGeometry(0.1, 0.46, 0.06);
      const sL = new THREE.Mesh(slGeo, cloth); sL.position.set(-0.27, 0.12, 0); sL.castShadow = false; host.add(sL);
      const sR = new THREE.Mesh(slGeo, cloth); sR.position.set(0.27, 0.12, 0); sR.castShadow = false; host.add(sR);
    }
  }

  // a small floor-anchored category placard along the rail.
  const SLOT_PLACARD = { shirt: "SHIRTS", neck: "TIES", legs: "TROUSERS", jacket: "BLAZERS", outfit: "SUITS", dress: "DRESSES" };
  function slotCategory(slot) { return SLOT_PLACARD[slot] || "APPAREL"; }

  // ---- build the displays once per city ------------------------------------
  function buildDisplays() {
    const cs = S.cs, m = mats();
    const group = new THREE.Group();
    S.group = group;
    const root = (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    root.add(group);
    S.cx = cs.cx; S.cz = cs.cz;

    const inx = cs.inx, inz = cs.inz;        // inward normal (door → room)
    const tx = cs.tx, tz = cs.tz;            // wall tangent
    const halfTan = cs.halfTan;              // half the wall the door is on (lateral reach)
    const halfIn = cs.halfIn;                // door wall → far wall (depth)

    const { wall, forms, tux } = partitionStock();

    // ---- TWO WALL RAILS down the side walls (lateral, off the door wall),
    //      shirts/ties/trousers hung along each. Linear wall layout = the
    //      narrow-boutique standard (frees the floor for the mannequins).
    const railY = 1.55;                                   // rod height
    const railLen = Math.max(2.4, 2 * halfTan - 1.8);
    const half = Math.ceil(wall.length / 2) || 1;
    const sides = [-1, 1];
    sides.forEach((sgn) => {
      // a side wall sits at ±halfTan along the tangent, just inside the wall
      const wallX = cs.cx + tx * sgn * (halfTan - WT - 0.12);
      const wallZ = cs.cz + tz * sgn * (halfTan - WT - 0.12);
      // the rod runs along the DEPTH axis (the inward normal) of that wall
      const rod = new THREE.Mesh(new THREE.BoxGeometry(
        Math.abs(inx) * railLen + Math.abs(tx) * 0.05,
        0.05,
        Math.abs(inz) * railLen + Math.abs(tz) * 0.05), m.rail);
      rod.position.set(wallX + inx * (halfIn * 0.05), railY + 0.55, wallZ + inz * (halfIn * 0.05));
      rod.castShadow = false; group.add(rod);
      const lilac = new THREE.Mesh(new THREE.BoxGeometry(
        Math.abs(inx) * (railLen + 0.1) + Math.abs(tx) * 0.08, 0.06,
        Math.abs(inz) * (railLen + 0.1) + Math.abs(tz) * 0.08), m.glow);
      lilac.position.set(wallX, railY + 1.05, wallZ); lilac.castShadow = false; group.add(lilac);
    });

    // track the last category placed on each side so a placard drops at the
    // head of each new category block as the rail walks down the wall.
    const lastCat = {};
    wall.forEach((it, i) => {
      const sideIdx = i < half ? 0 : 1;
      const sgn = sides[sideIdx];
      const inRow = (sgn === sides[0]) ? half : (wall.length - half);
      const idxInRow = (sgn === sides[0]) ? i : i - half;
      const wallX = cs.cx + tx * sgn * (halfTan - WT - 0.22);
      const wallZ = cs.cz + tz * sgn * (halfTan - WT - 0.22);
      // spread along the depth axis between the door end and the back
      const t = inRow > 1 ? (idxInRow / (inRow - 1)) : 0.5;
      const depth = 0.9 + t * Math.max(0.2, railLen - 0.6);
      const x = wallX + inx * depth, z = wallZ + inz * depth;
      const sp = CBZ.cityComposableSpec(it.visualId);
      const slot = (sp && sp.slot) || it._slot || "shirt";
      const faceY = Math.atan2(-tx * sgn, -tz * sgn);        // off the wall, into the room

      // CATEGORY PLACARD at the head of each new category block on this side.
      const cat = slotCategory(slot);
      if (lastCat[sideIdx] !== cat) {
        lastCat[sideIdx] = cat;
        const plc = tagSprite(cat, "#c9a8e8", 1.2, 0.34);
        if (plc) { plc.position.set(x, railY + 1.42, z); group.add(plc); }
      }

      // a REAL garment on a hanger hanging off the rod, tinted to the item's
      // own color — this is what stops the merch reading as a floating ghost.
      const rack = new THREE.Group();
      rack.position.set(x, railY, z);
      rack.rotation.y = faceY;
      group.add(rack);
      buildHungGarment(rack, slot, (sp && sp.color != null) ? sp.color : null);

      // the composable sample drapes in front of the hung garment so the cut /
      // pattern reads from the aisle, same draw path as the rig painter.
      const host = new THREE.Group();
      host.position.set(x + Math.sin(faceY) * 0.07, railY, z + Math.cos(faceY) * 0.07);
      host.rotation.y = faceY;
      host.scale.setScalar(0.78);
      group.add(host);
      const sample = drawSample(host, it.visualId, 0);
      const tag = tagSprite(it.label + " · " + fmt$(e_buy(it.name)), "#e2c2f4", 1.7, 0.4);
      if (tag) { tag.position.set(x + tx * sgn * 0.18, railY - 0.55, z); group.add(tag); }
      S.slots.push({ kind: "item", name: it.name, visualId: it.visualId, label: it.label,
                     drip: (sp && sp.drip) || it.drip || 0, x, y: railY, z,
                     reach: RACK_REACH, dot: RACK_DOT, sample, tag });
    });

    // ---- ENTRANCE MANNEQUINS: torso bust-forms on a stand, styled with a
    //      complete look (the blazer's own color). The menswear focal display.
    const formY0 = 0.0;
    forms.forEach((it, i) => {
      // arrange across the front of the room (just inside the door), spread
      // laterally so they greet you as you walk in.
      const lat = (i - (forms.length - 1) / 2) * Math.min(1.7, (2 * halfTan - 2.2) / Math.max(forms.length, 1));
      const depth = 2.0;
      const x = cs.cx + inx * (depth - halfIn) + tx * lat;
      const z = cs.cz + inz * (depth - halfIn) + tz * lat;
      buildMannequin(group, x, z, Math.atan2(-inx, -inz));   // faces the door
      const sp = CBZ.cityComposableSpec(it.visualId);
      const host = new THREE.Group();
      host.position.set(x, 1.18, z);                          // chest height on the bust
      host.rotation.y = Math.atan2(-inx, -inz);
      host.scale.setScalar(0.92);
      group.add(host);
      const sample = drawSample(host, it.visualId, 0);
      // pair a tasteful shirt under an open blazer so the form reads "styled"
      drawSample(host, "shirt_white_collar", 0);
      const tag = tagSprite(it.label + " · " + fmt$(e_buy(it.name)), "#f0d9ff", 1.9, 0.46);
      if (tag) { tag.position.set(x, 2.25, z); group.add(tag); }
      S.slots.push({ kind: "item", name: it.name, visualId: it.visualId, label: it.label,
                     drip: (sp && sp.drip) || it.drip || 0, x, y: 1.2, z,
                     reach: RACK_REACH, dot: RACK_DOT, sample, tag, mannequin: true });
    });

    // ---- THE FITTING MIRROR at the BACK wall: a framed reflective panel.
    //      [E] opens the wardrobe (mix owned items + buy the tuxedo).
    const mdepth = 2 * halfIn - WT - 0.3;
    const mx = cs.cx + inx * (mdepth - halfIn);
    const mz = cs.cz + inz * (mdepth - halfIn);
    const fw = Math.abs(tx) * 1.1 + Math.abs(inx) * 0.08;
    const fd = Math.abs(tz) * 1.1 + Math.abs(inz) * 0.08;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(fw + 0.12, 2.0, fd + 0.12), m.frame);
    frame.position.set(mx, 1.05, mz); frame.castShadow = false; group.add(frame);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(fw, 1.8, fd), m.mirror);
    glass.position.set(mx - inx * 0.05, 1.05, mz - inz * 0.05); glass.castShadow = false; group.add(glass);
    const mtag = tagSprite("Fitting Mirror — [E] Wardrobe", "#f0d9ff", 2.1, 0.48);
    if (mtag) { mtag.position.set(mx - inx * 0.1, 2.25, mz - inz * 0.1); group.add(mtag); }
    S.slots.push({ kind: "mirror", x: mx - inx * 0.6, y: 1.2, z: mz - inz * 0.6,
                   reach: RACK_REACH + 0.4, dot: 0.45, tux: tux });
    S.tux = tux;
  }

  // a simple torso bust-form on a stand (shared geometry-free; small boxes)
  function buildMannequin(group, x, z, faceY) {
    const m = mats();
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.46), m.pole);
    base.position.set(x, 0.03, z); base.castShadow = false; group.add(base);
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.05, 0.07), m.pole);
    pole.position.set(x, 0.55, z); pole.castShadow = false; group.add(pole);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.3), m.form);
    torso.position.set(x, 1.25, z); torso.rotation.y = faceY || 0; torso.castShadow = false; group.add(torso);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.14), m.form);
    neck.position.set(x, 1.62, z); neck.castShadow = false; group.add(neck);
  }

  function e_buy(name) { const e = econ(); return (e && e.buyPrice) ? e.buyPrice(name) : 0; }

  // ---- buying / wearing ------------------------------------------------------
  function actOn(slot) {
    if (!slot) return;
    if (slot.kind === "mirror") { openPanel(); return; }
    buyOrWear(slot.name, slot.visualId, slot.label);
  }
  function buyOrWear(name, visualId, label) {
    const e = econ();
    if (!e || !CBZ.city) return;
    // already own it → just put it on (free re-wear).
    if (CBZ.cityOwnsItem && CBZ.cityOwnsItem(visualId)) {
      if (CBZ.cityWear) CBZ.cityWear(visualId);
      if (CBZ.sfx) CBZ.sfx("door");
      note("🧥 Pulled the " + (label || name) + " on.", 1.6);
      return;
    }
    const price = e_buy(name);
    if (!CBZ.city.spend(price)) {
      note("The " + (label || name) + " runs " + fmt$(price) + " — come back with the money.", 2);
      if (CBZ.sfx) CBZ.sfx("glass");
      return;
    }
    if (CBZ.cityGrantItem) CBZ.cityGrantItem(visualId);
    if (CBZ.cityWear) CBZ.cityWear(visualId);
    if (CBZ.sfx) CBZ.sfx("coin");
    const drip = (CBZ.cityComposableSpec && CBZ.cityComposableSpec(visualId) || {}).drip || 0;
    if (CBZ.city.addRespect) CBZ.city.addRespect(price >= 600 ? 3 : 1);
    if (price >= 600 && CBZ.city.big) CBZ.city.big("🧥 " + (label || name) + " — fresh fit off the rack!");
    note("Bought the " + (label || name) + " for " + fmt$(price) + (drip ? " (+" + drip + " drip)." : "."), 2.2);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // ---- the look-pick + [E] prompt --------------------------------------------
  function pickSlot() {
    const P = CBZ.player, B = S.cs.bounds;
    const px = P.pos.x, pz = P.pos.z;
    if (px < B.minX - 1.5 || px > B.maxX + 1.5 || pz < B.minZ - 1.5 || pz > B.maxZ + 1.5) return null;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best = null, bestScore = -1;
    for (const s of S.slots) {
      const dx = s.x - px, dz = s.z - pz, d = Math.hypot(dx, dz);
      if (d > (s.reach || RACK_REACH) || d < 0.05) continue;
      const dot = (dx / d) * fx + (dz / d) * fz;
      if (dot < (s.dot || RACK_DOT)) continue;
      const score = dot - d * 0.06;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  function promptText(s) {
    if (s.kind === "mirror")
      return "<b style='color:#e2c2f4'>[E]</b> Open wardrobe <span style='color:#7f8794'>· mix your fits" + (S.tux ? " · or the tuxedo" : "") + "</span>";
    const owned = CBZ.cityOwnsItem && CBZ.cityOwnsItem(s.visualId);
    if (owned)
      return "<b style='color:#9fe0ff'>[E]</b> Owned — wear the " + s.label + " <span style='color:#7f8794'>· +" + (s.drip || 0) + " drip</span>";
    return "<b style='color:#e2c2f4'>[E]</b> Buy the " + s.label + " — <span style='color:#d9a8ee'>" + fmt$(e_buy(s.name)) + "</span> <span style='color:#7f8794'>· +" + (s.drip || 0) + " drip</span>";
  }

  function promptEl() {
    if (S.prompt) return S.prompt;
    if (typeof document === "undefined" || !document.body) return null;
    const d = document.createElement("div");
    d.id = "clothingPrompt";
    d.style.cssText = "position:fixed;left:50%;bottom:150px;transform:translateX(-50%);z-index:46;display:none;" +
      "background:rgba(13,16,21,.9);border:1px solid #3a4150;border-radius:12px;padding:7px 14px;color:#e8eef7;" +
      "font-family:Fredoka,system-ui,sans-serif;font-size:15px;pointer-events:auto;cursor:pointer;text-align:center;max-width:78vw";
    d.addEventListener("click", function () { if (S.cur) actOn(S.cur); });   // tap-to-act (mobile)
    document.body.appendChild(d);
    S.prompt = d;
    return d;
  }
  function showPrompt(txt) {
    const el = promptEl();
    if (!el) return;
    if (txt !== S.lastTxt) { el.innerHTML = txt; S.lastTxt = txt; }
    if (el.style.display !== "block") el.style.display = "block";
  }
  function hidePrompt() {
    if (S.prompt && S.prompt.style.display !== "none") S.prompt.style.display = "none";
    S.cur = null;
  }

  // ============================================================
  //  THE WARDROBE PANEL (at the mirror): list OWNED composables grouped by
  //  slot — number keys wear, the slot letter strips it — plus a BUY TUXEDO
  //  row. Mirrors the bank panel: a fixed centre card, Esc/E closes, number
  //  keys act. Built lazily, repopulated each open.
  // ============================================================
  function panelEl() {
    if (S.panel) return S.panel;
    if (typeof document === "undefined" || !document.body) return null;
    const d = document.createElement("div");
    d.id = "clothingPanel";
    d.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;display:none;" +
      "background:rgba(13,16,21,.96);border:1px solid #6a4f7a;border-radius:16px;padding:18px 22px;color:#e8eef7;" +
      "font-family:Fredoka,system-ui,sans-serif;font-size:15px;min-width:320px;max-width:86vw;box-shadow:0 18px 60px rgba(0,0,0,.6)";
    document.body.appendChild(d);
    S.panel = d;
    return d;
  }
  // the owned composables grouped by their composable slot (shirt/jacket/neck/
  // legs), each row a number key to wear; the worn ones marked.
  function ownedRows() {
    const e = econ();
    const list = (e && e.itemsByTag) ? e.itemsByTag("clothing") : [];
    const fit = (CBZ.cityFitGet && CBZ.cityFitGet()) || { items: [] };
    const wornSet = {}; (fit.items || []).forEach((id) => { wornSet[id] = true; });
    const rows = [];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (!it || !it.visualId) continue;
      const sp = CBZ.cityComposableSpec && CBZ.cityComposableSpec(it.visualId);
      if (!sp || sp.painted) continue;                 // the tuxedo has its own row
      if (!(CBZ.cityOwnsItem && CBZ.cityOwnsItem(it.visualId))) continue;
      rows.push({ visualId: it.visualId, label: it.label, slot: sp.slot || "item", worn: !!wornSet[it.visualId] });
    }
    return rows;
  }
  function renderPanel() {
    const d = panelEl(); if (!d) return;
    const rows = ownedRows();
    let html = "<div style='font-weight:700;font-size:18px;margin-bottom:6px;color:#e2c2f4'>Your Wardrobe</div>";
    html += "<div style='color:#8a93a3;font-size:12px;margin-bottom:12px'>Mix what you own — tap a number to wear it, the letter to take it off.</div>";
    S._panelRows = rows;
    if (!rows.length) {
      html += "<div style='color:#9aa0a6;margin-bottom:10px'>Nothing owned yet — buy a shirt or blazer off the racks first.</div>";
    } else {
      rows.forEach((r, i) => {
        const mark = r.worn ? "<span style='color:#7ed957'> ✓ worn</span>" : "";
        html += "<div style='display:flex;justify-content:space-between;gap:14px;padding:3px 0'>" +
          "<span><b style='color:#e2c2f4'>" + (i + 1) + "</b> &nbsp;" + r.label + mark + "</span>" +
          "<span style='color:#7f8794'>[" + r.slot + "]</span></div>";
      });
    }
    // the apex purchase: the tuxedo, sold here at the mirror.
    if (S.tux) {
      const owned = CBZ.cityOwnsItem && CBZ.cityOwnsItem(S.tux.visualId);
      html += "<div style='border-top:1px solid #3a3140;margin:12px 0 8px'></div>";
      html += "<div style='display:flex;justify-content:space-between;gap:14px;padding:3px 0'>" +
        "<span><b style='color:#ffd166'>T</b> &nbsp;" + S.tux.label.replace(" (Composable)", "") + (owned ? "<span style='color:#7ed957'> ✓ owned</span>" : "") + "</span>" +
        "<span style='color:#d9a8ee'>" + (owned ? "wear it" : fmt$(e_buy(S.tux.name))) + "</span></div>";
    }
    html += "<div style='border-top:1px solid #3a3140;margin:12px 0 4px'></div>";
    html += "<div style='color:#8a93a3;font-size:12px'>[Esc] / [E] close</div>";
    d.innerHTML = html;
  }
  function openPanel() {
    const d = panelEl(); if (!d) return;
    S.panelOpen = true;
    // remember the engine's prior fire-block state, then hold it true while
    // styling (CBZ.cityMenuOpen is the engine's existing fire chokepoint).
    S._prevMenu = CBZ.cityMenuOpen;
    CBZ.cityMenuOpen = true;
    renderPanel();
    d.style.display = "block";
    hidePrompt();
  }
  function closePanel() {
    if (S.panel) S.panel.style.display = "none";
    S.panelOpen = false;
    CBZ.cityMenuOpen = S._prevMenu;                     // restore EXACTLY what it was
    S._prevMenu = undefined;
  }
  function panelKey(k) {
    if (k === "escape" || k === "e") { closePanel(); return; }
    if (k === "t" && S.tux) {
      buyOrWear(S.tux.name, S.tux.visualId, S.tux.label.replace(" (Composable)", ""));
      renderPanel();
      return;
    }
    const n = parseInt(k, 10);
    if (!isNaN(n) && n >= 1 && S._panelRows && n <= S._panelRows.length) {
      const r = S._panelRows[n - 1];
      if (r.worn) { if (CBZ.cityUnwear) CBZ.cityUnwear(r.visualId); }
      else { if (CBZ.cityWear) CBZ.cityWear(r.visualId); }
      renderPanel();
    }
  }

  // ---- find the lot + build once (self-healing, bank/gunstore pattern) -------
  function ensure() {
    const arena = CBZ.city && CBZ.city.arena;
    if (S.built) {
      if (S.arena === arena) return true;
      S.built = false; S.group = null; S.slots = []; S.cur = null; S.lot = null; S.cs = null; S.tux = null;
    }
    if (!arena || !econ() || !CBZ.cityComposableSpec) return false;
    if (S.noLotArena === arena) return false;
    let lot = arena.clothingLot || null;
    if (!(lot && lot.building && lot.building.shop && lot.building.shop.kind === "clothing")) {
      lot = null;
      const lots = arena.lots || [];
      for (let i = 0; i < lots.length; i++) {
        const L = lots[i];
        if (L && L.building && L.building.shop && L.building.shop.kind === "clothing") { lot = L; break; }
      }
      if (!lot && lots.length) { S.noLotArena = arena; return false; }
    }
    if (!lot) return false;
    // derive the walkable bounds + door frame (no buildings.js anchor for
    // clothing — compute the gunstore-style inward/tangent units ourselves).
    const b = lot.building;
    const w = num(b.w, lot.w - 2 || 10), d = num(b.d, lot.d - 2 || 10);
    const door = b.door || { nx: 1, nz: 0 };
    const inx = door.nx || 0, inz = door.nz || 0;        // inward normal
    const tgx = -inz, tgz = inx;                         // wall tangent
    const halfIn = (inx !== 0 ? w : d) / 2;              // door wall → far wall
    const halfTan = (inx !== 0 ? d : w) / 2;             // half the door wall (lateral)
    S.lot = lot;
    S.cs = {
      name: b.name || "Threads & Drip",
      cx: lot.cx, cz: lot.cz, inx, inz, tx: tgx, tz: tgz, halfIn, halfTan,
      bounds: { minX: lot.cx - w / 2 + WT, maxX: lot.cx + w / 2 - WT, minZ: lot.cz - d / 2 + WT, maxZ: lot.cz + d / 2 - WT },
    };
    S.arena = arena;
    buildDisplays();
    S.built = true;
    return true;
  }

  // ---- per-frame --------------------------------------------------------------
  CBZ.onUpdate(38.6, function (dt) {
    if (!g || g.mode !== "city") { if (S.group && S.group.visible) S.group.visible = false; hidePrompt(); if (S.panelOpen) closePanel(); return; }
    if (!ensure()) return;
    const P = CBZ.player;
    const dx = P.pos.x - S.cx, dz = P.pos.z - S.cz;
    // The racks may ONLY render when the player is actually INSIDE the store
    // shell (plus a small doorway lip). r128's raycaster can't cull a hung
    // garment behind opaque walls, so the merch was reading through the glass
    // from the street ("White Trousers $80" floating outside). Gating on the
    // walkable bounds — not a 55m radius — keeps every sample sealed in the room.
    const B = S.cs.bounds;
    const inside = (P.pos.x >= B.minX - 1.2 && P.pos.x <= B.maxX + 1.2 &&
                    P.pos.z >= B.minZ - 1.2 && P.pos.z <= B.maxZ + 1.2);
    const near = inside && (dx * dx + dz * dz) < VIS_R * VIS_R;
    if (S.group && S.group.visible !== near) S.group.visible = near;
    if (!near || g.state !== "playing" || P.dead || P.driving) { hidePrompt(); if (S.panelOpen && (!near || P.dead || P.driving)) closePanel(); return; }
    if (S.panelOpen) { hidePrompt(); return; }           // panel up: in-world prompt yields
    if (CBZ.cityMenuOpen) { hidePrompt(); return; }
    const s = pickSlot();
    if (!s) { hidePrompt(); return; }
    S.cur = s;
    showPrompt(promptText(s));
  });

  // [E] acts on the fixture you're facing. CAPTURE phase so the store wins the
  // key over interact.js's bubble listener; stopImmediatePropagation keeps one
  // press from ALSO opening the clerk's counter menu (the gunstore pattern).
  addEventListener("keydown", function (e) {
    const k = (e.key || "").toLowerCase();
    if (S.panelOpen) {
      e.preventDefault();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      e.stopPropagation();
      panelKey(k);
      return;
    }
    if (!S.cur || !g || g.mode !== "city" || g.state !== "playing") return;
    if (CBZ.cityMenuOpen || (CBZ.player && (CBZ.player.driving || CBZ.player.dead))) return;
    if (k !== "e") return;
    e.preventDefault();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    e.stopPropagation();
    actOn(S.cur);
  }, true);

  // ---- public hooks (interact/shops feature-detect; harness drives) ----------
  // is the store live (for this lot)? interact.js hides the clerk's "Browse the
  // racks" verb when it is, so the in-world racks are the ONE way to shop here.
  CBZ.cityClothingLive = function (lot) { return !!(S.built && S.lot && (!lot || lot === S.lot)); };
  CBZ.cityClothingLot = function () { return (S.built && S.lot) || null; };
  // headless/harness handle: buy/wear a named composable off the floor.
  CBZ.cityClothingBuy = function (labelOrName) {
    if (!ensure()) return false;
    let slot = S.slots.find((x) => x.kind === "item" && (x.name === labelOrName || x.label === labelOrName));
    if (slot) { buyOrWear(slot.name, slot.visualId, slot.label); return true; }
    if (S.tux && (S.tux.name === labelOrName || S.tux.label === labelOrName || labelOrName === "Tuxedo")) {
      buyOrWear(S.tux.name, S.tux.visualId, "Tuxedo"); return true;
    }
    return false;
  };
  CBZ.cityClothingState = function () {
    if (!S.built) return null;
    return {
      lot: !!S.lot,
      items: S.slots.filter((s) => s.kind === "item").map((s) => ({
        name: s.name, visualId: s.visualId, price: e_buy(s.name), drip: s.drip,
        owned: !!(CBZ.cityOwnsItem && CBZ.cityOwnsItem(s.visualId)), mannequin: !!s.mannequin })),
      tux: S.tux ? { name: S.tux.name, visualId: S.tux.visualId, price: e_buy(S.tux.name) } : null,
      panelOpen: !!S.panelOpen,
    };
  };
})();

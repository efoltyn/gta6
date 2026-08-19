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
  const HERO_FORMS = 3;      // display forms that greet you at the door (the rest hang)

  // STORE_DRESS_V2 — the MERCHANDISED store. OWNER: "clothing stores are simple:
  // mannequins and outfits in the store. All stores have weird interior walls and
  // random shit." Four things were wrong and all four are geometry, not taste:
  // the mannequin was a bust on a stick, the catalog (~50 composables) was crushed
  // onto TWO rails at ~0.3 m spacing, the street saw nothing, and the fitting
  // mirror sat behind the clerk's counter with no room around it. Declared HERE,
  // in the owning file, so the revert is one line and local.
  if (CBZ.CONFIG && CBZ.CONFIG.STORE_DRESS_V2 == null) CBZ.CONFIG.STORE_DRESS_V2 = true;
  function v2() { return !(CBZ.CONFIG && CBZ.CONFIG.STORE_DRESS_V2 === false); }
  // Per-store variation (stance angle, form tone, which corner the fitting room
  // takes) comes off the LOT's own coordinates — never Math.random in a build
  // path, the world must be byte-identical per seed on every client.
  function h01(x, z, salt) { return CBZ.hash01 ? CBZ.hash01(x, z, salt) : 0.5; }
  // cached-geometry box (CBZ.boxGeom dedupes by dimension across the whole city)
  function box(w, h, d, mat) {
    const geo = CBZ.boxGeom ? CBZ.boxGeom(w, h, d) : new THREE.BoxGeometry(w, h, d);
    const mh = new THREE.Mesh(geo, mat);
    mh.castShadow = false; mh.receiveShadow = false;
    return mh;
  }
  function put(host, mh, x, y, z, ry) { mh.position.set(x, y, z); if (ry) mh.rotation.y = ry; host.add(mh); return mh; }

  const WIN_R = 26;          // how far down the pavement the window display reads

  const S = { lot: null, cs: null, group: null, winGroup: null, slots: [], built: false,
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
      formDark: new THREE.MeshLambertMaterial({ color: 0x33363d }),                               // the charcoal display form (half the city's stores run dark)
      plinth: new THREE.MeshLambertMaterial({ color: 0xe8e3d8 }),                                 // window riser (pale studio stone)
      card:   new THREE.MeshLambertMaterial({ color: 0xf4f1e8 }),                                 // price / section card stock
      spot:   new THREE.MeshLambertMaterial({ color: 0xfff2d0, emissive: 0xffe9b8, emissiveIntensity: 0.85 }), // window + fitting-room spill
      seat:   new THREE.MeshLambertMaterial({ color: 0x5a4636 }),                                 // fitting-room bench leather
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
    // PROPS_PURPOSE (owner order): NO floating words over shop items — the
    // garments/mannequins speak for themselves; the walk-up prompt carries
    // the price. All call sites null-guard, so returning null degrades
    // cleanly. Revert: CBZ.CONFIG.PROPS_PURPOSE=false.
    if (!CBZ.CONFIG || CBZ.CONFIG.PROPS_PURPOSE !== false) return null;
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
  const SLOT_ORDER = ["shirt", "neck", "legs", "jacket", "dress", "outfit"];
  // hue of a garment colour, 0..1 around the wheel; NEUTRALS answer below zero
  // (light → dark) so every block opens on white/grey/black and then walks the
  // wheel. This is the whole "colour story" — a rail sorted by hue reads as a
  // buyer's edit, the same rail sorted by catalog order reads as a bin.
  function hueOf(hex) {
    const r = ((hex >> 16) & 255) / 255, gr = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
    const mx = Math.max(r, gr, b), mn = Math.min(r, gr, b), d = mx - mn;
    if (d < 0.06) return -1 + (1 - mx);
    let h;
    if (mx === r) h = ((gr - b) / d + 6) % 6;
    else if (mx === gr) h = (b - r) / d + 2;
    else h = (r - gr) / d + 4;
    return h / 6;
  }
  function partitionStock() {
    const e = econ();
    const list = (e && e.itemsByTag) ? e.itemsByTag("clothing") : [];
    const wall = [], jackets = [], tux = [];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (!it || !it.visualId || !CBZ.cityComposableSpec || !CBZ.cityComposableSpec(it.visualId)) continue;
      const sp = CBZ.cityComposableSpec(it.visualId);
      if (sp && sp.painted === "tuxedo") { tux.push(it); continue; }   // the apex — sold at the mirror
      it._slot = (sp && sp.slot) || "shirt";
      it._hue = hueOf((sp && sp.color != null) ? sp.color : 0x8a8f97);
      if (sp && sp.slot === "jacket") jackets.push(it);                 // blazers/bomber → display forms
      else wall.push(it);                                               // shirts/ties/trousers/looks → the runs
    }
    // THE ENTRANCE IS A DISPLAY, NOT A WAREHOUSE. Every jacket-slot piece used
    // to stand its own bust form, so eight of them lined up shoulder-to-shoulder
    // across the door — the crowd the owner was looking at. Three HEROES greet
    // you (the priciest looks, i.e. the thing the store wants you to want) and
    // the rest hang on the runs like any other garment. Nothing stops being
    // buyable: every one of them is still a slot, just on a hanger.
    let forms = jackets;
    if (v2()) {
      jackets.sort(function (a, b) { return (e_buy(b.name) - e_buy(a.name)) || (a.name < b.name ? -1 : 1); });
      forms = jackets.slice(0, HERO_FORMS);
      for (let i = HERO_FORMS; i < jackets.length; i++) wall.push(jackets[i]);
    }
    // group the rail stock by slot so each category hangs together + gets a
    // placard; keep a stable category order, unknown slots trail. Inside a
    // category the colour story orders the block (ties broken by name so the
    // layout is deterministic for a given catalog).
    wall.sort((a, b) => {
      const ia = SLOT_ORDER.indexOf(a._slot), ib = SLOT_ORDER.indexOf(b._slot);
      const ra = ia < 0 ? 99 : ia, rb = ib < 0 ? 99 : ib;
      if (ra !== rb) return ra - rb;
      if (!v2()) return 0;
      return (a._hue - b._hue) || (a.name < b.name ? -1 : 1);
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

  // ---- CARDS: the cheapest "this is a shop" signal there is ------------------
  // A shop without price cards is a warehouse with nice lighting. These are ONE
  // box each, no text (PROPS_PURPOSE: no floating words over merchandise — the
  // walk-up prompt carries the name and the price). They exist to be READ as
  // signage from across the room, which is a silhouette job, not a font job.
  // A SIGN HANGS OFF THE HARDWARE IT NAMES: the stem meets the rod, the card
  // sits above it. (props.js's lamp arm and utility_lines' conductors were both
  // bugs of exactly this shape — a fixture drawn from its own numbers, ending
  // in mid-air beside the thing it was supposed to be attached to.)
  function sectionCard(host, x, y, z, faceY) {
    const m = mats();
    const fx = Math.sin(faceY) * 0.09, fz = Math.cos(faceY) * 0.09;
    const stem = box(0.02, 0.13, 0.02, m.hanger);
    stem.position.set(x + fx, y, z + fz);
    host.add(stem);
    const c = box(0.34, 0.2, 0.02, m.card);
    c.position.set(x + fx, y + 0.1, z + fz); c.rotation.y = faceY; c.rotation.x = -0.12;
    host.add(c);
  }
  // a card leaning on a display form's own base plate (baseY = the plinth top
  // it stands on, so a window form's card rides the plinth instead of sinking
  // into it)
  function formCard(host, x, z, faceY, baseY) {
    const m = mats();
    const c = box(0.24, 0.16, 0.02, m.card);
    c.position.set(x + Math.sin(faceY) * 0.3, (baseY || 0) + 0.14, z + Math.cos(faceY) * 0.3);
    c.rotation.y = faceY; c.rotation.x = -0.55;
    host.add(c);
  }

  // ---- THE CENTRE GONDOLA ----------------------------------------------------
  // A hang rail on posts over a folded-stack shelf, standing down the middle of
  // the room with a face to each aisle. WHY it exists: the catalog is ~50
  // composables and two wall rails spaced them ~0.3 m apart — garments literally
  // inside each other, which is the "random shit" read. Two more RUNS is the
  // whole fix, and a gondola is how a real shop gets them: the floor was empty.
  // The folded stacks under the rail are display-only (a stack of tees you can
  // buy from the rail two metres away is a duplicate purchase point, not depth).
  function buildGondola(host, cs, d0, d1, stock) {
    const m = mats(), inx = cs.inx, inz = cs.inz, tx = cs.tx, tz = cs.tz, halfIn = cs.halfIn;
    const len = d1 - d0;
    const at = function (lat, depth) {
      return { x: cs.cx + tx * lat + inx * (depth - halfIn), z: cs.cz + tz * lat + inz * (depth - halfIn) };
    };
    const mid = at(0, (d0 + d1) / 2);
    // (w = across the aisle, l = down the room) → world X/Z, whichever way the
    // door faces. Every fixture in this file sizes itself through this pair.
    const along = function (w, l) { return Math.abs(tx) * w + Math.abs(inx) * l; };
    const across = function (w, l) { return Math.abs(tz) * w + Math.abs(inz) * l; };
    put(host, box(along(1.05, len + 0.3), 0.12, across(1.05, len + 0.3), m.wood), mid.x, 0.06, mid.z);   // base
    put(host, box(along(0.92, len), 0.06, across(0.92, len), m.wood), mid.x, 0.74, mid.z);               // shelf
    // uprights carry the two rods (railY + 0.55 = 2.10): a post to that height
    // and a crossarm the rods actually sit on. A rail that ends in mid-air is
    // the lamp-arm bug from props.js in another costume — hardware first, then
    // the thing that hangs off it.
    for (const e of [-1, 1]) {
      const p = at(0, (d0 + d1) / 2 + e * (len / 2 + 0.1));
      put(host, box(0.08, 2.04, 0.08, m.rail), p.x, 1.02, p.z);                                          // upright
      put(host, box(along(1.05, 0.06), 0.06, across(1.05, 0.06), m.rail), p.x, 2.07, p.z);               // crossarm
    }
    // FOLDED STACKS: four piles of three, tinted off the real stock so the
    // shelf tells the same colour story the rail above it is telling.
    for (let i = 0; i < 4; i++) {
      const p = at(0, d0 + (i + 0.5) * (len / 4));
      const it = stock[Math.min(stock.length - 1, Math.floor(i * stock.length / 4))];
      const sp = it && CBZ.cityComposableSpec && CBZ.cityComposableSpec(it.visualId);
      const cloth = garmentMat(sp && sp.color != null ? sp.color : null);
      for (let k = 0; k < 3; k++) {
        const s = 0.36 - k * 0.02;
        put(host, box(along(s, s), 0.055, across(s, s), cloth), p.x, 0.81 + k * 0.06, p.z, k * 0.05);
      }
    }
  }

  // ---- THE WINDOW: what the store says to the STREET --------------------------
  // Two forms on a low plinth right behind the storefront glass, facing OUT,
  // under a spot bar. WHY it earns its meshes: the tuxedo is the $2,500 apex
  // purchase and it was sold at a mirror at the BACK of the room — you could not
  // want it until you had already walked in. In the window it is a thing you can
  // SEE from the pavement (doctrine: build gradients of visible access, doors
  // beat markers). Display ONLY — no slot, no prompt. The window advertises; the
  // floor sells. Anything else would be a second purchase point for one item.
  function buildWindow(host, cs, forms, tux, dark) {
    const m = mats(), inx = cs.inx, inz = cs.inz, tx = cs.tx, tz = cs.tz;
    const halfIn = cs.halfIn, halfTan = cs.halfTan;
    const looks = [];
    if (tux) looks.push(tux.visualId);
    for (let i = 0; i < forms.length && looks.length < 2; i++) looks.push(forms[i].visualId);
    if (!looks.length) return 0;
    const lat0 = Math.min(halfTan - 1.1, 2.1);
    if (lat0 < 1.3) return 0;                       // narrow shopfront: the doorway wins
    const depth = 1.05, faceOut = Math.atan2(-inx, -inz);
    const along = function (w, l) { return Math.abs(tx) * w + Math.abs(inx) * l; };
    const across = function (w, l) { return Math.abs(tz) * w + Math.abs(inz) * l; };
    let n = 0;
    for (let i = 0; i < looks.length; i++) {
      const lat = (i === 0 ? -1 : 1) * lat0;
      const x = cs.cx + tx * lat + inx * (depth - halfIn), z = cs.cz + tz * lat + inz * (depth - halfIn);
      put(host, box(along(1.15, 0.95), 0.18, across(1.15, 0.95), m.plinth), x, 0.09, z);
      buildMannequin(host, x, z, faceOut, 10 + i, 0.18, dark);
      const dress = new THREE.Group();
      dress.position.set(x, 0.18 + 1.18, z);
      dress.rotation.y = faceOut;
      dress.scale.setScalar(0.92);
      host.add(dress);
      drawSample(dress, looks[i], 0);
      // the spot: a housing and an emissive lens (the house glow pattern)
      put(host, box(along(0.5, 0.16), 0.09, across(0.5, 0.16), m.frame), x, 2.44, z);
      put(host, box(along(0.42, 0.1), 0.04, across(0.42, 0.1), m.spot), x, 2.37, z);
      formCard(host, x, z, faceOut, 0.18);
      n++;
    }
    return n;
  }

  // ---- THE FITTING CORNER -----------------------------------------------------
  // The mirror already sold the tuxedo and opened the wardrobe, but it stood at
  // the dead centre of the back wall — which is exactly where buildings.js parks
  // the clerk's counter, so the one fixture in the store with a PANEL behind it
  // was something you reached across a counter. Moved into a back corner and
  // given the furniture that makes a corner a room: a bench, a return rail with
  // two garments hung on it, a floor mat and a soft light. All display-only.
  function buildFittingRoom(host, cs, mlat, mdepth, stock) {
    const m = mats(), inx = cs.inx, inz = cs.inz, tx = cs.tx, tz = cs.tz;
    const halfIn = cs.halfIn, halfTan = cs.halfTan;
    const sgn = mlat < 0 ? -1 : 1;
    const at = function (lat, depth) {
      return { x: cs.cx + tx * lat + inx * (depth - halfIn), z: cs.cz + tz * lat + inz * (depth - halfIn) };
    };
    const along = function (w, l) { return Math.abs(tx) * w + Math.abs(inx) * l; };
    const across = function (w, l) { return Math.abs(tz) * w + Math.abs(inz) * l; };
    // the mat marks the room's footprint — this is the "you are standing in the
    // fitting corner" cue, and it costs one box.
    const mat0 = at(mlat, mdepth - 1.05);
    put(host, box(along(2.0, 1.8), 0.02, across(2.0, 1.8), m.frame), mat0.x, 0.012, mat0.z);
    // bench BESIDE the mirror (in front of it is where you stand)
    const bp = at(mlat - sgn * 1.15, mdepth - 0.55);
    put(host, box(along(0.95, 0.44), 0.1, across(0.95, 0.44), m.seat), bp.x, 0.45, bp.z);
    for (const e of [-1, 1]) {
      const lp = at(mlat - sgn * 1.15 + e * 0.36, mdepth - 0.55);
      put(host, box(along(0.1, 0.36), 0.4, across(0.1, 0.36), m.wood), lp.x, 0.22, lp.z);
    }
    // a RETURN RAIL on the side wall with two garments on it — the pieces you
    // carried in to try. Two hangers, drawn by the same garment builder the
    // sales rails use, so a try-on piece and a for-sale piece are the same cloth.
    const rl = at(sgn * (halfTan - 0.4), mdepth - 1.25);
    put(host, box(along(0.05, 1.3), 0.05, across(0.05, 1.3), m.rail), rl.x, 2.02, rl.z);
    const faceIn = Math.atan2(-tx * sgn, -tz * sgn);
    for (let i = 0; i < 2; i++) {
      const it = stock[Math.max(0, stock.length - 1 - i)];
      if (!it) break;
      const sp = CBZ.cityComposableSpec && CBZ.cityComposableSpec(it.visualId);
      const p = at(sgn * (halfTan - 0.5), mdepth - 0.85 - i * 0.8);
      const hang = new THREE.Group();
      hang.position.set(p.x, 1.47, p.z);
      hang.rotation.y = faceIn;
      host.add(hang);
      buildHungGarment(hang, (sp && sp.slot) || it._slot || "shirt", (sp && sp.color != null) ? sp.color : null);
    }
    // soft light over the mirror (emissive box — the house pattern)
    const lp2 = at(mlat, mdepth - 0.25);
    put(host, box(along(1.3, 0.12), 0.05, across(1.3, 0.12), m.spot), lp2.x, 2.36, lp2.z);
  }

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
    // one deterministic coin per STORE: which tone the display forms wear, and
    // which back corner the fitting room takes. Two stores in one city read as
    // two different shops without a single extra mesh.
    const darkForms = h01(cs.cx, cs.cz, "formtone") > 0.5;

    // ---- THE HANGING RUNS -------------------------------------------------
    // Both side walls, plus (when the room is deep enough) the two faces of a
    // centre GONDOLA. WHY four runs: the catalog is ~50 composables and TWO
    // rails spaced them about 0.3 m apart — garments standing inside each other,
    // which is precisely the "random shit" read. Four runs is ~0.6 m, boutique
    // density, and every garment still owns its own x/z, so the look-pick never
    // has to choose between two pieces in one spot (that would silently cost a
    // purchase point). The runs also stop 2.9 m short of the back wall now, which
    // is what frees the corner for the fitting room.
    const railY = 1.55;                                   // rod height
    const railLen = Math.max(2.4, 2 * halfIn - (v2() ? 3.2 : 1.8));
    const wallLat = halfTan - WT - 0.22;
    const atPt = function (lat, depth) {
      return { x: cs.cx + tx * lat + inx * (depth - halfIn), z: cs.cz + tz * lat + inz * (depth - halfIn) };
    };
    const runs = [];
    [-1, 1].forEach(function (sgn) {
      runs.push({ lat: sgn * wallLat, face: -sgn, d0: 0.9, d1: 0.9 + Math.max(0.2, railLen - 0.6) });
    });
    // the gondola only stands if it can hold a real run without crowding the
    // door or the clerk's counter (buildings.js parks that at depth 2*halfIn-2.8).
    const gd0 = 3.4, gd1 = 2 * halfIn - 4.3;
    const gondola = v2() && (gd1 - gd0) >= 2.4 && halfTan >= 3.4;
    if (gondola) [-1, 1].forEach(function (sgn) {
      runs.push({ lat: sgn * 0.46, face: sgn, d0: gd0, d1: gd1, gond: true });
    });
    runs.forEach(function (run) {
      const mid = atPt(run.lat, (run.d0 + run.d1) / 2);
      const len = (run.d1 - run.d0) + 0.5;
      put(group, box(Math.abs(inx) * len + Math.abs(tx) * 0.05, 0.05,
                     Math.abs(inz) * len + Math.abs(tz) * 0.05, m.rail), mid.x, railY + 0.55, mid.z);
      if (run.gond) return;                                // a mid-floor cove strip would just float
      put(group, box(Math.abs(inx) * (len + 0.1) + Math.abs(tx) * 0.08, 0.06,
                     Math.abs(inz) * (len + 0.1) + Math.abs(tz) * 0.08, m.glow), mid.x, railY + 1.05, mid.z);
    });
    if (gondola) buildGondola(group, cs, gd0, gd1, wall);
    S._runs = runs.length; S._gondola = !!gondola;

    // Hand each garment a run and a place in it — contiguous slices, so the
    // colour-sorted catalog stays sorted as it walks run to run. The slices are
    // sized by run LENGTH, not by run count: an equal split would have put the
    // same number of pieces on an 8 m wall as on a 4 m gondola face and packed
    // one of them to half the spacing of the other, which is the crowding this
    // whole layout exists to answer.
    const lens = runs.map(function (r) { return Math.max(0.5, r.d1 - r.d0); });
    let totalLen = 0; lens.forEach(function (l) { totalLen += l; });
    const runCount = []; let assigned = 0;
    for (let r = 0; r < runs.length; r++) {
      const q = (r === runs.length - 1) ? (wall.length - assigned)
        : Math.min(wall.length - assigned, Math.round(wall.length * lens[r] / totalLen));
      runCount[r] = Math.max(0, q); assigned += runCount[r];
    }
    const runOf = [], posOf = [];
    let curRun = 0, inRun = 0;
    for (let i = 0; i < wall.length; i++) {
      while (curRun < runs.length - 1 && inRun >= (runCount[curRun] || 0)) { curRun++; inRun = 0; }
      runOf[i] = curRun; posOf[i] = inRun++;
    }

    // track the last category placed on each run so a placard drops at the
    // head of each new category block as the rail walks down the wall.
    const lastCat = {};
    wall.forEach((it, i) => {
      const ri = runOf[i], run = runs[ri], n = runCount[ri] || 1;
      const t = n > 1 ? (posOf[i] / (n - 1)) : 0.5;
      const depth = run.d0 + t * (run.d1 - run.d0);
      const p = atPt(run.lat, depth);
      const x = p.x, z = p.z;
      const sp = CBZ.cityComposableSpec(it.visualId);
      const slot = (sp && sp.slot) || it._slot || "shirt";
      const faceY = Math.atan2(tx * run.face, tz * run.face);   // off the fixture, into the aisle

      // CATEGORY PLACARD at the head of each new category block on this run.
      const cat = slotCategory(slot);
      if (lastCat[ri] !== cat) {
        lastCat[ri] = cat;
        if (v2()) sectionCard(group, x, railY + 0.62, z, faceY);
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
      if (tag) { tag.position.set(x - tx * run.face * 0.18, railY - 0.55, z); group.add(tag); }
      S.slots.push({ kind: "item", name: it.name, visualId: it.visualId, label: it.label,
                     drip: (sp && sp.drip) || it.drip || 0, x, y: railY, z,
                     reach: RACK_REACH, dot: RACK_DOT, sample, tag });
    });

    // ---- THE ENTRANCE HEROES: full display forms styled with a complete look
    //      (the blazer's own color over a collared shirt). Three, not eight —
    //      see partitionStock. Each gets a price card leaning on its base plate.
    // WHICH SIDE OF THE DOOR: the old row was centred on the door, so on an odd
    // count one form stood in the doorway you walk through — you clipped a
    // mannequin every time you entered. They cluster to one side now (the side
    // is the lot's own coin), which is also how a real shop stages a hero group.
    const heroSide = h01(cs.cx, cs.cz, "heroes") < 0.5 ? -1 : 1;
    forms.forEach((it, i) => {
      // arrange just inside the door, spread laterally so they greet you as you
      // walk in without standing in the entry lane.
      const lat = v2() ? heroSide * Math.min(halfTan - 0.9, 1.4 + i * 1.25)
                       : (i - (forms.length - 1) / 2) * Math.min(1.7, (2 * halfTan - 2.2) / Math.max(forms.length, 1));
      const depth = v2() ? 2.15 : 2.0;
      const x = cs.cx + inx * (depth - halfIn) + tx * lat;
      const z = cs.cz + inz * (depth - halfIn) + tz * lat;
      const faceOut = Math.atan2(-inx, -inz);
      buildMannequin(group, x, z, faceOut, i, 0, darkForms);   // faces the door
      const sp = CBZ.cityComposableSpec(it.visualId);
      const host = new THREE.Group();
      host.position.set(x, 1.18, z);                          // chest height on the form
      host.rotation.y = faceOut;
      host.scale.setScalar(0.92);
      group.add(host);
      const sample = drawSample(host, it.visualId, 0);
      // pair a tasteful shirt under an open blazer so the form reads "styled"
      drawSample(host, "shirt_white_collar", 0);
      if (v2()) formCard(group, x, z, faceOut);
      const tag = tagSprite(it.label + " · " + fmt$(e_buy(it.name)), "#f0d9ff", 1.9, 0.46);
      if (tag) { tag.position.set(x, 2.25, z); group.add(tag); }
      S.slots.push({ kind: "item", name: it.name, visualId: it.visualId, label: it.label,
                     drip: (sp && sp.drip) || it.drip || 0, x, y: 1.2, z,
                     reach: RACK_REACH, dot: RACK_DOT, sample, tag, mannequin: true });
    });

    // ---- THE WINDOW (street-facing, display only) --------------------------
    // It lives in its OWN group, because the sales floor is hard-gated to
    // "player is inside the shell" — r128 cannot cull a hung garment behind an
    // opaque wall, and merch reading through the facade from the street was a
    // real bug this file already fixed once. A window display that only renders
    // once you are through the door would be a stat fiction, so this group runs
    // the opposite gate: visible from the PAVEMENT IN FRONT of the shop (the
    // one direction where seeing it through the glass is the correct answer)
    // and nowhere else.
    S._forms = forms.length;
    if (v2()) {
      const wg = new THREE.Group();
      S.winGroup = wg;
      root.add(wg);
      S._window = buildWindow(wg, cs, forms, tux, darkForms);
      if (CBZ.interiorTrackFixture) CBZ.interiorTrackFixture("clothing-window", S.lot.building, wg);
    } else { S._window = 0; }

    // ---- THE FITTING MIRROR: a framed reflective panel. [E] opens the
    //      wardrobe (mix owned items + buy the tuxedo). It moves OFF the back
    //      wall's centre when the room is wide enough, because the centre of
    //      the back wall is where buildings.js parks the clerk's counter — the
    //      one fixture with a panel behind it was a fixture you reached across
    //      a counter to touch. In a corner it gets a room around it instead.
    const mdepth = 2 * halfIn - WT - 0.3;
    const alcove = v2() && (halfTan - 1.5) >= 2.9;
    const mlat = alcove ? (h01(cs.cx, cs.cz, "fitroom") < 0.5 ? -1 : 1) * (halfTan - 1.5) : 0;
    const mx = cs.cx + tx * mlat + inx * (mdepth - halfIn);
    const mz = cs.cz + tz * mlat + inz * (mdepth - halfIn);
    const fw = Math.abs(tx) * 1.1 + Math.abs(inx) * 0.08;
    const fd = Math.abs(tz) * 1.1 + Math.abs(inz) * 0.08;
    put(group, box(fw + 0.12, 2.0, fd + 0.12, m.frame), mx, 1.05, mz);
    put(group, box(fw, 1.8, fd, m.mirror), mx - inx * 0.05, 1.05, mz - inz * 0.05);
    if (alcove) buildFittingRoom(group, cs, mlat, mdepth, wall);
    S._alcove = !!alcove;
    const mtag = tagSprite("Fitting Mirror. [E] Wardrobe", "#f0d9ff", 2.1, 0.48);
    if (mtag) { mtag.position.set(mx - inx * 0.1, 2.25, mz - inz * 0.1); group.add(mtag); }
    S.slots.push({ kind: "mirror", x: mx - inx * 0.6, y: 1.2, z: mz - inz * 0.6,
                   reach: RACK_REACH + 0.4, dot: 0.45, tux: tux });
    S.tux = tux;
    if (CBZ.interiorTrackFixture) CBZ.interiorTrackFixture("clothing-store", S.lot.building, group);
  }

  // ---- A DISPLAY FORM, NOT A BUST ON A STICK ---------------------------------
  // The old mannequin was four boxes — plate, pole, torso block, neck — i.e. a
  // tailor's bust, which is why a full look draped on it read as a jacket
  // floating in the air with nothing wearing it. A shop form has a head, a neck,
  // shoulders, a waist and hips, and it STANDS somehow: either on legs or on a
  // tailored pole-to-hip stand. Twelve boxes, matte, and the matte is the point
  // — the FORM must never compete with the garment for colour, so it is studio
  // white or charcoal and the clothes carry every hue in the room.
  // Built into its own group so a pose is one rotation instead of twelve
  // position sums, and the stance/head-turn come off the lot's own hash (no
  // Math.random can enter a build path).
  function buildMannequin(group, x, z, faceY, idx, baseY, dark) {
    const m = mats();
    if (!v2()) {                                   // one-line revert: the old bust form
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.46), m.pole);
      base.position.set(x, 0.03, z); base.castShadow = false; group.add(base);
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.05, 0.07), m.pole);
      pole.position.set(x, 0.55, z); pole.castShadow = false; group.add(pole);
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.3), m.form);
      torso.position.set(x, 1.25, z); torso.rotation.y = faceY || 0; torso.castShadow = false; group.add(torso);
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.14), m.form);
      neck.position.set(x, 1.62, z); neck.castShadow = false; group.add(neck);
      return null;
    }
    const seed = h01(x, z, "form" + (idx | 0));
    const g2 = new THREE.Group();
    g2.position.set(x, baseY || 0, z);
    g2.rotation.y = (faceY || 0) + (seed - 0.5) * 0.5;     // stance angle: no two forms square up
    group.add(g2);
    const form = dark ? m.formDark : m.form;
    const add = function (w, h, d, px, py, pz, mat, rz, rx) {
      const mh = box(w, h, d, mat || form);
      mh.position.set(px, py, pz);
      if (rz) mh.rotation.z = rz;
      if (rx) mh.rotation.x = rx;
      g2.add(mh); return mh;
    };
    add(0.42, 0.05, 0.42, 0, 0.025, 0, m.pole);                    // floor plate
    if (((idx | 0) % 2) === 0) {                                   // legged form
      add(0.13, 0.82, 0.16, -0.10, 0.44, 0.01);
      add(0.13, 0.82, 0.16, 0.10, 0.44, -0.01, null, 0, -0.03);    // weight on the back leg
    } else {
      add(0.09, 0.92, 0.09, 0, 0.48, 0, m.pole);                   // tailored pole stand
    }
    add(0.34, 0.26, 0.22, 0, 1.00, 0);                             // hips
    add(0.40, 0.36, 0.24, 0, 1.28, 0);                             // torso
    add(0.50, 0.16, 0.26, 0, 1.48, 0);                             // shoulder yoke
    for (const e of [-1, 1]) add(0.10, 0.14, 0.22, e * 0.26, 1.45, 0);   // shoulder caps
    const arm = seed < 0.5 ? -1 : 1;                               // ONE arm, bent — the "pose"
    add(0.09, 0.30, 0.12, arm * 0.30, 1.30, 0, null, arm * 0.14);
    add(0.08, 0.26, 0.11, arm * 0.37, 1.05, 0.05, null, arm * 0.30, -0.25);
    add(0.12, 0.13, 0.12, 0, 1.62, 0);                             // neck
    const head = add(0.20, 0.24, 0.22, 0, 1.80, 0);                // head knob
    head.rotation.y = (seed - 0.5) * 0.7;
    return g2;
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
      note("Pulled the " + (label || name) + " on.", 1.6);
      return;
    }
    const price = e_buy(name);
    if (!CBZ.city.spend(price)) {
      note("The " + (label || name) + " runs " + fmt$(price) + " · come back with the money.", 2);
      return;
    }
    if (CBZ.cityGrantItem) CBZ.cityGrantItem(visualId);
    if (CBZ.cityWear) CBZ.cityWear(visualId);
    if (CBZ.sfx) CBZ.sfx("coin");
    const drip = (CBZ.cityComposableSpec && CBZ.cityComposableSpec(visualId) || {}).drip || 0;
    if (CBZ.city.addRespect) CBZ.city.addRespect(price >= 600 ? 3 : 1);
    if (price >= 600 && CBZ.city.big) CBZ.city.big("" + (label || name) + " · fresh fit off the rack!");
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
      return "<b style='color:#9fe0ff'>[E]</b> Owned, wear the " + s.label + " <span style='color:#7f8794'>· +" + (s.drip || 0) + " drip</span>";
    return "<b style='color:#e2c2f4'>[E]</b> Buy the " + s.label + " · <span style='color:#d9a8ee'>" + fmt$(e_buy(s.name)) + "</span> <span style='color:#7f8794'>· +" + (s.drip || 0) + " drip</span>";
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
    if (CBZ.touchPromptHTML) txt = CBZ.touchPromptHTML(txt);   // touch: [E] → tappable verb pill
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
    html += "<div style='color:#8a93a3;font-size:12px;margin-bottom:12px'>Mix what you own, tap a number to wear it, the letter to take it off.</div>";
    S._panelRows = rows;
    if (!rows.length) {
      html += "<div style='color:#9aa0a6;margin-bottom:10px'>Nothing owned yet, buy a shirt or blazer off the racks first.</div>";
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
    if (!CBZ.touchMode) html += "<div style='color:#8a93a3;font-size:12px'>[Esc] / [E] close</div>";
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
      S.built = false; S.group = null; S.winGroup = null; S.slots = []; S.cur = null; S.lot = null; S.cs = null; S.tux = null;
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
      // the centre of the DOOR WALL, in world — the window gate measures how far
      // out on the pavement you are from this point.
      dwx: lot.cx - inx * halfIn, dwz: lot.cz - inz * halfIn,
      bounds: { minX: lot.cx - w / 2 + WT, maxX: lot.cx + w / 2 - WT, minZ: lot.cz - d / 2 + WT, maxZ: lot.cz + d / 2 - WT },
    };
    S.arena = arena;
    buildDisplays();
    S.built = true;
    return true;
  }

  // ---- per-frame --------------------------------------------------------------
  CBZ.onUpdate(38.6, function (dt) {
    if (!g || g.mode !== "city") {
      if (S.group && S.group.visible) S.group.visible = false;
      if (S.winGroup && S.winGroup.visible) S.winGroup.visible = false;
      hidePrompt(); if (S.panelOpen) closePanel(); return;
    }
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
    // THE WINDOW runs the opposite gate to the sales floor: it is meant to be
    // seen THROUGH the storefront glass, so it draws when you are out on the
    // pavement in front of this shop (or inside). Standing behind or beside the
    // building shows you nothing — that is the wall-see-through bug this file
    // already paid for once.
    if (S.winGroup) {
      const ox = P.pos.x - S.cs.dwx, oz = P.pos.z - S.cs.dwz;
      const out = ox * -S.cs.inx + oz * -S.cs.inz;                 // metres out from the shopfront
      const side = Math.abs(ox * S.cs.tx + oz * S.cs.tz);          // metres along it
      const winVis = near || (out > 0.2 && out < WIN_R && side < S.cs.halfTan + 4);
      if (S.winGroup.visible !== winVis) S.winGroup.visible = winVis;
    }
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
  // EXPORT ONLY (a gate/probe calls this; nothing in the game does). What the
  // store actually STANDS, so a dressing regression is a number and not a
  // screenshot: display forms, the street window, how many hanging runs the
  // catalog got spread over, and the whole group's real mesh count — the last
  // one is the perf ceiling this file has to live under.
  CBZ.cityClothingDressAudit = function () {
    if (!S.built) return null;
    let meshes = 0, sprites = 0, winMeshes = 0;
    const count = function (o) { if (o.isMesh) meshes++; else if (o.isSprite) sprites++; };
    if (S.group) S.group.traverse(count);
    if (S.winGroup) { S.winGroup.traverse(count); S.winGroup.traverse(function (o) { if (o.isMesh) winMeshes++; }); }
    const items = S.slots.filter((s) => s.kind === "item");
    return {
      v2: v2(),
      heroForms: S._forms | 0,               // styled display forms at the entrance
      windowForms: S._window | 0,            // street-facing forms behind the glass
      mannequins: (S._forms | 0) + (S._window | 0),
      runs: S._runs | 0, gondola: !!S._gondola, alcove: !!S._alcove,
      hangers: items.length - (S._forms | 0), // garments on a rail (vs on a form)
      slots: S.slots.length, items: items.length,
      meshes: meshes, winMeshes: winMeshes, sprites: sprites,
      winVisible: !!(S.winGroup && S.winGroup.visible),
    };
  };
})();

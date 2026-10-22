/* ============================================================
   city/jewelry.js — THE JEWELLER: real pieces under real glass. Buy the
   ice, or break the case.

   Owner (2026-10-22): "every gun, or piece of jewelry. It's actual
   jewelry." Every piece in the cases is the piece you wear (entities/
   jewelry_kit.js, entities/watch.js make both): the watches drawn distinct
   at real size over velvet pillows (a steel dress watch, a diver, a two-tone
   gold chrono, a bust-down), chains on velvet neck forms, rings on ivory
   finger cones, the grill and the tiara on cushions. Names, prices and looks
   come from cityEcon.itemsByTag("jewelry"), so the case, the price and the
   piece on your body are the same record.

   THE CASES are counter-height showcases (kick plinth, walnut — the vault:
   gunmetal — cabinet with a brass inlay and clerk-side doors, a velvet deck
   and a raised step, the glass box framed in brass, lit inside only). Two
   retail cases up front, a feature island with the headline watches, and
   the VAULT behind the counter at the clerk's back with the steal-only crown
   pieces. THREE ways in:
   • BUY — [Buy] the piece you are looking at in a case the clerk is behind:
     cash (then bank) leaves, the REAL item is yours and city/bling.js puts
     it on your body the same frame. Pawn it later for a haircut.
   • LOUD — a bullet, a swing or [Smash] breaks the glass (Gang City's panes
     are city glass, CBZ.cityRegisterGlass; the islands' are CBZ.islandGlass,
     the same rounds break both). The alarm screams, the burglary is
     reported (CBZ.cityCrime: the clerk is an eyewitness), and [Grab] scoops
     the case. Everything taken this way is hot.
   • QUIET — at night, on a case the clerk can't see, a slow pry takes one
     piece without the alarm; every pull risks him turning round.
   Cases restock on a ~10-minute timer.

   ONE STORE PER SHOP: Gang City's (its case anchors stamped
   lot.building.jewelry by city/buildings.js) and one per island jeweller
   (CBZ.islandVenue "jewelry": the floor cleared, the counter across the
   room, the vault behind it, a jeweller at his post).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onUpdate) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  const RESTOCK = 600;       // seconds an EMPTIED case stays bare (insurance re-stock)
  const VIS_R = 55;          // display group draws only when you're near the shop
  const DRESS_R = 110;
  const REACH = 2.8;         // you smash/grab/pry at arm's length
  const LOOK_DOT = 0.55;     // you act on the case you're LOOKING at
  const PRY_TIME = 4.2;      // seconds a quiet pry takes (slow = the price of silence)
  const PRY_RISK = 0.22;     // per finished pry: chance the clerk turns around
  const NIGHT_MIN = 0.5;     // CBZ.nightAmount past this = dark enough to case it
  const ALARM_TIME = 18;     // how long the alarm screams after a smash
  const CASE_W = 1.35, CASE_D = 0.85;   // glass case footprint (long side faces the aisle)

  // What each case HOLDS, value-tiered front → vault. Two kinds of slot:
  //   { id }   — a BUYABLE catalog piece (visualId from cityEcon jewelry tag)
  //   { loot } — a steal-ONLY jackpot (a $250k necklace / $5M rock isn't on the
  //              retail floor): smash-and-grab or pry only, fenced at the pawn.
  const STOCK = [
    [{ id: "watch_steel" }, { id: "chain_gold" }, { id: "ring_diamond" }],   // front: entry retail
    [{ id: "watch_diver" }, { id: "grill_diamond" }, { id: "chain_iced" }],  // front: sport + iced retail
    [{ id: "watch_gold" }, { id: "watch_iced" }],                            // feature island: the headline watches
    [{ loot: "Diamond Necklace" }, { loot: "Diamond Tiara" }, { loot: "Engagement Ring" }],  // the VAULT (steal-only)
  ];
  const RING_RESTOCK_ODDS = 0.35;   // the $5M rock returns to the vault this often

  const STORES = [];
  let cityStore = null;

  function econ() { return CBZ.cityEcon || null; }
  function SF() { return CBZ.shopFloor || null; }
  function fmt$(n) { n = Math.round(n || 0); return "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  // ---- the BUYABLE catalog, keyed by visualId -------------------------------
  let CAT = null;
  function catalog() {
    if (CAT) return CAT;
    const e = econ(); if (!e || !e.itemsByTag) return null;
    CAT = {};
    const arr = e.itemsByTag("jewelry") || [];
    for (let i = 0; i < arr.length; i++) { const it = arr[i]; if (it && it.visualId) CAT[it.visualId] = it; }
    return CAT;
  }
  function resolvePiece(slot) {
    const e = econ(); if (!e) return null;
    if (slot && slot.id) {
      const cat = catalog(); const rec = cat && cat[slot.id];
      if (!rec) return null;
      const label = (rec.label || rec.name || "").replace(/\s*\(Composable\)\s*$/i, "");
      return { name: rec.name, label, value: rec.value | 0,
               drip: rec.drip | 0, visualId: rec.visualId, kind: rec.visualId, buyable: true };
    }
    const name = slot && slot.loot;
    if (!name) return null;
    const it = e.ITEMS && e.ITEMS[name]; if (!it) return null;
    const value = (e.buyPrice && e.buyPrice(name)) || it.value || 0;
    return { name, label: name, value, drip: it.drip | 0, visualId: null, kind: name, buyable: false,
             showpiece: name === "Engagement Ring" };
  }

  /* ---- THE PIECES, at real size (x DISPLAY) ------------------------------ */
  const DISPLAY = 1.2;
  const PI = Math.PI;
  const PR = 0.03;
  const DISPLAY_STYLE = { watch_steel: "steel", watch_diver: "diver", watch_gold: "gold", watch_iced: "iced" };
  function buildWatch(visualId, grp) {
    const W = CBZ.wristwatch;
    if (W && W.display) grp.add(W.display(DISPLAY_STYLE[visualId] || "steel", PR, 35 * PI / 180));
    return grp;
  }
  const DISPLAY_KIT = {
    chain_gold: ["necklace", "curb"], chain_iced: ["necklace", "cuban"], "Diamond Necklace": ["necklace", "riviera"],
    ring_diamond: ["ring", "solitaire"], "Engagement Ring": ["ring", "rock"],
    grill_diamond: ["grill"], "Diamond Tiara": ["tiara"],
  };
  function buildPiece(kind) {
    const grp = new THREE.Group();
    const D = CBZ.jewel && CBZ.jewel.display, how = DISPLAY_KIT[kind] || ["ring", "pinky"];
    if (kind === "watch_steel" || kind === "watch_diver" || kind === "watch_gold" || kind === "watch_iced") buildWatch(kind, grp);
    else if (D) {
      if (how[0] === "necklace") grp.add(D.necklace(how[1], 0.036 / DISPLAY));
      else if (how[0] === "ring") grp.add(D.ring(how[1]));
      else if (how[0] === "grill") grp.add(D.grill());
      else if (how[0] === "tiara") grp.add(D.tiara());
    }
    grp.scale.setScalar(DISPLAY);
    return grp;
  }

  /* ---- THE CASE: a counter-height showcase ------------------------------- */
  const DECK = 0.68, GLASS_H = 0.34, STEP_H = 0.05, STEP_D = 0.3, STEP_Z = -0.14;
  const MOUNT = { chain_gold: "neck", chain_iced: "neck", "Diamond Necklace": "neck", ring_diamond: "finger",
                  "Engagement Ring": "finger", "Diamond Tiara": "pillow", grill_diamond: "pillow",
                  watch_steel: "watch", watch_diver: "watch", watch_gold: "watch", watch_iced: "watch" };
  function buildMount(k, kind, x, y, z, vault) {
    const mk = MOUNT[kind] || "pillow";
    const VEL = vault ? 0x141016 : 0x2a1016, IVORY = 0xe6e0d2;
    if (mk === "neck") {
      k.box(x, y + 0.006, z, 0.16, 0.012, 0.09, VEL);
      k.cyl(x, y + 0.062, z, 0.05, 0.1, 0.1, VEL, "solid", 0, 0, 0, 18);
      k.cyl(x, y + 0.165, z, 0.034, 0.042, 0.11, VEL, "solid", 0, 0, 0, 16);
      k.cyl(x, y + 0.224, z, 0.03, 0.034, 0.008, VEL, "solid", 0, 0, 0, 16);
      return { y: y + 0.17, z: z };
    }
    if (mk === "finger") {
      k.cyl(x, y + 0.005, z, 0.022, 0.024, 0.01, 0x1a1a1c, "gloss");
      k.cyl(x, y + 0.04, z, 0.0085, 0.0145, 0.06, IVORY, "solid", 0, 0, 0, 14);
      return { y: y + 0.042, z: z };
    }
    if (mk === "watch") {
      const ax = y + 0.047;
      for (const s of [-1, 1]) k.box(x + s * 0.0435, y + 0.026, z, 0.012, 0.052, 0.05, 0x1a1a1c, "gloss");
      k.cyl(x, ax, z, PR * DISPLAY, PR * DISPLAY, 0.075, VEL, "solid", 0, 0, PI / 2, 16);
      return { y: ax, z: z };
    }
    k.cyl(x, y + 0.012, z, 0.07, 0.072, 0.024, VEL, "solid", 0, 0, 0, 20);
    return { y: y + 0.024, z: z };
  }

  // the dressed jewellery counter: walnut cladding, brass trim, a white stone
  // worktop, the till and card reader at one end, a velvet service mat and a
  // loupe where the jeweller shows you the piece, a countertop mirror.
  function dressCounter(S, group, FY) {
    const K = CBZ.storeFixtureKit;
    const C = S.C;
    if (!C || !K) return;
    const L = Math.max(C.w, C.d), D = Math.min(C.w, C.d);
    const k = K.create().frame(C.x, 0, C.z, K.yawOf(C.tx, C.tz));
    const top = K.dressCounter(k, L, D, C.top, FY, { clad: 0x3a2618, trim: 0xc9a44a, work: 0xe9e5dc, kick: 0x151210 });
    K.till(k, -L / 2 + 0.55, top, D);
    k.box(0.15, top + 0.003, 0.1, 0.42, 0.006, 0.3, 0x14101a);                             // service mat
    k.cyl(0.05, top + 0.014, 0.12, 0.012, 0.014, 0.018, 0x1a1a1c, "gloss");                 // loupe
    k.cyl(0.05, top + 0.024, 0.12, 0.011, 0.011, 0.004, 0xdcecf2, "glass");
    const mx = Math.min(L / 2 - 0.25, 0.9);                                                  // countertop mirror
    k.cyl(mx, top + 0.01, 0.15, 0.07, 0.075, 0.02, 0xc9a44a, "metal");
    k.cyl(mx, top + 0.08, 0.15, 0.008, 0.008, 0.12, 0xc9a44a, "metal");
    k.cyl(mx, top + 0.24, 0.15, 0.115, 0.115, 0.018, 0xc9a44a, "metal", PI / 2, 0, 0, 28);
    k.cyl(mx, top + 0.24, 0.16, 0.105, 0.105, 0.004, 0xd8e2e8, "metal", PI / 2, 0, 0, 28);
    k.build(group);
    if (S.kind === "island") {
      const a = k.world(-L / 2 - 0.04, -D / 2 - 0.06), b = k.world(L / 2 + 0.04, D / 2 + 0.06);
      const c = { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z), y0: FY, y1: C.top + 0.05 };
      CBZ.colliders.push(c); S.cols.push(c);
    }
  }

  /* ---- THE GLASS --------------------------------------------------------
     Gang City's case panes are city glass (city/buildings.js: bullets,
     blasts, the re-glaze). The islands' are CBZ.islandGlass panes
     (city/shopfloor.js): the same rounds break them (fpsmode calls
     CBZ.islandGlassRay where the city calls cityShatterRay). */
  let ISLE_GLASS_MAT = null;
  function isleGlassMat() {
    if (!ISLE_GLASS_MAT) {
      ISLE_GLASS_MAT = new THREE.MeshPhongMaterial({ color: 0xdcecf2, specular: 0xffffff, shininess: 120, transparent: true, opacity: 0.16, depthWrite: false });
      ISLE_GLASS_MAT._shared = true;
    }
    return ISLE_GLASS_MAT;
  }
  function addPane(S, group, x, y, z, w, h, d) {
    if (S.kind === "city") return CBZ.cityRegisterGlass ? CBZ.cityRegisterGlass(group, x, y, z, w, h, d, 0, 0, null) : null;
    if (!CBZ.islandGlass) return null;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), isleGlassMat());
    m.position.set(x, y, z); m.renderOrder = 1; m.castShadow = false;
    group.add(m);
    const rec = CBZ.islandGlass.add({ x: x, y: y, z: z, hw: w / 2, hh: h / 2, hd: d / 2, mesh: m });
    S.panes.push(rec);
    return rec;
  }
  function breakPane(S, cs) {
    if (!cs.pane || cs.pane.shattered) return;
    if (S.kind === "city") { if (CBZ.cityShatter) CBZ.cityShatter(cs.x, cs.z, 0.8, { directPlayer: true }); }
    else if (CBZ.islandGlass) CBZ.islandGlass.burst(cs.pane, null);
  }
  function mendPane(S, cs) {
    if (!cs.pane) return;
    if (S.kind === "city") { cs.pane.shattered = false; cs.pane.cracked = false; if (cs.pane.mesh) cs.pane.mesh.visible = true; }
    else if (CBZ.islandGlass) CBZ.islandGlass.mend(cs.pane);
  }

  /* ---- A STORE -----------------------------------------------------------
     d: { kind, lot, jw (bounds, tx, tz, cases [{x, z, tier, vault}], name),
          C (the counter: x, z, w, d, top, tx, tz), FY, root, clerk, where,
          inStore(x, z) } */
  function makeStore(d) {
    const jw = d.jw;
    const S = {
      kind: d.kind, lot: d.lot, jw: jw, C: d.C, FY: d.FY, root: d.root, clerk: d.clerk, where: d.where, inStore: d.inStore,
      group: null, cases: [], panes: [], cols: [], dressed: false, near: false, dead: false, pry: null, alarmT: 0,
      cx: (jw.bounds.minX + jw.bounds.maxX) / 2, cz: (jw.bounds.minZ + jw.bounds.maxZ) / 2,
    };
    STORES.push(S);
    return S;
  }
  function disposeStore(S) {
    if (!S || S.dead) return;
    S.dead = true;
    const i = STORES.indexOf(S); if (i >= 0) STORES.splice(i, 1);
    for (const p of S.panes) if (CBZ.islandGlass) CBZ.islandGlass.remove(p);
    S.panes.length = 0;
    if (S.group) { if (S.group.parent) S.group.parent.remove(S.group); if (SF()) SF().disposeTree(S.group); }
    if (SF()) SF().dropCols(S.cols);
    if (S.clerk && S.clerk.dispose) S.clerk.dispose();
    S.group = null; S.cases = [];
  }

  // ---- build the four cases once per store ----------------------------------
  function buildDisplays(S) {
    const jw = S.jw;
    const group = new THREE.Group();
    group.name = "jewelry-store";
    S.group = group;
    (S.root || CBZ.scene).add(group);
    const FY = S.FY;
    const KIT = CBZ.storeFixtureKit;
    const tx = jw.tx, tz = jw.tz;
    const yaw = KIT.yawOf(tx, tz);
    // long side of every case faces the aisle (the counter's tangent, or the
    // side wall it stands along)
    const k = KIT.create();
    const BRASS = 0xc9a44a;

    jw.cases.forEach((anchor, idx) => {
      const vault = !!anchor.vault;
      // a case on a side wall faces into the room (anchor.fx, fz: its front)
      const aT = anchor.fx != null ? { x: anchor.fz, z: -anchor.fx } : { x: tx, z: tz };
      const yawA = anchor.fx != null ? KIT.yawOf(aT.x, aT.z) : yaw;
      const gwA = Math.abs(aT.x) * CASE_W + Math.abs(aT.z) * CASE_D, gdA = Math.abs(aT.z) * CASE_W + Math.abs(aT.x) * CASE_D;
      k.frame(anchor.x, 0, anchor.z, yawA);
      const W = CASE_W, Dp = CASE_D, BODY = vault ? 0x2c313a : 0x3a2618, VEL = vault ? 0x141016 : 0x3c1420;
      k.box(0, FY + 0.05, 0, W - 0.06, 0.1, Dp - 0.06, 0x111214);                            // recessed kick
      k.box(0, FY + 0.1 + (DECK - 0.12) / 2, 0, W, DECK - 0.12, Dp, BODY, vault ? "metal" : "solid");
      k.box(0, FY + DECK - 0.1, Dp / 2 + 0.002, W + 0.002, 0.012, 0.004, BRASS, "metal");      // brass inlay
      for (const sx of [-1, 1]) k.box(sx * W / 6, FY + 0.1 + (DECK - 0.26) / 2 + 0.02, Dp / 2 + 0.001, 0.006, DECK - 0.3, 0.003, 0x1a120c);
      for (const sx of [-1, 1]) {                                                            // clerk-side doors
        k.box(sx * W / 4, FY + 0.36, -Dp / 2 - 0.006, W / 2 - 0.03, 0.44, 0.012, vault ? 0x353b45 : 0x46301f, vault ? "metal" : "solid");
        k.cyl(sx * 0.06, FY + 0.5, -Dp / 2 - 0.016, 0.008, 0.008, 0.012, BRASS, "metal", PI / 2);
      }
      k.box(0, FY + DECK - 0.01, 0, W + 0.02, 0.02, Dp + 0.02, BRASS, "metal");               // brass rim
      k.box(0, FY + DECK + 0.006, 0, W - 0.04, 0.012, Dp - 0.04, VEL);                        // velvet deck
      k.box(0, FY + DECK + 0.012 + STEP_H / 2, STEP_Z, W - 0.16, STEP_H, STEP_D, VEL);        // the raised step
      const gy0 = FY + DECK, gy1 = FY + DECK + GLASS_H;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(sx * (W / 2 - 0.02), (gy0 + gy1) / 2, sz * (Dp / 2 - 0.02), 0.018, GLASS_H, 0.018, BRASS, "metal");
      for (const sz of [-1, 1]) k.box(0, gy1 - 0.008, sz * (Dp / 2 - 0.02), W - 0.04, 0.016, 0.016, BRASS, "metal");
      for (const sx of [-1, 1]) k.box(sx * (W / 2 - 0.02), gy1 - 0.008, 0, 0.016, 0.016, Dp - 0.04, BRASS, "metal");
      let props = 1;
      if (!vault) {
        k.box(0, gy1 - 0.019, Dp / 2 - 0.03, W - 0.12, 0.006, 0.014, 0xfff2d8, "glow");       // LED strip, inside the front rail
        props++;
      } else {
        k.cyl(0, gy1 - 0.014, STEP_Z, 0.005, 0.005, W - 0.06, BRASS, "metal", 0, 0, PI / 2);  // the pin-spot rod
        props++;
      }
      const pane = addPane(S, group, anchor.x, FY + DECK + GLASS_H / 2, anchor.z, gwA - 0.04, GLASS_H, gdA - 0.04);
      // keep the body solid for walkers
      const col = { minX: anchor.x - gwA / 2 - 0.04, maxX: anchor.x + gwA / 2 + 0.04,
                    minZ: anchor.z - gdA / 2 - 0.04, maxZ: anchor.z + gdA / 2 + 0.04, y0: FY - 0.1, y1: FY + DECK + GLASS_H };
      CBZ.colliders.push(col); S.cols.push(col);

      const cs = { idx, store: S, x: anchor.x, z: anchor.z, tier: anchor.tier | 0, vault,
                   pane, pieces: [], smashed: false, charged: false, restockT: 0 };
      const slots = STOCK[anchor.stock != null ? anchor.stock : Math.min(idx, STOCK.length - 1)] || [];
      const resolved = [];
      for (let s = 0; s < slots.length; s++) { const r = resolvePiece(slots[s]); if (r) resolved.push(r); }
      const stepTop = FY + DECK + 0.012 + STEP_H;
      resolved.forEach((r, i) => {
        const lat = (i - (resolved.length - 1) / 2) * ((W - 0.4) / Math.max(resolved.length - 1, 1));
        const mt = buildMount(k, r.kind, lat, stepTop, STEP_Z, vault);
        props++;
        const model = buildPiece(r.kind);
        const wp = k.world(lat, mt.z);
        model.position.set(wp.x, mt.y, wp.z);
        model.rotation.y = yawA;
        group.add(model);
        if (vault) {                                                                          // one pin-spot per jackpot piece
          k.cyl(lat, gy1 - 0.028, STEP_Z, 0.016, 0.012, 0.018, 0x2a2d31, "metal");
          k.cyl(lat, gy1 - 0.038, STEP_Z, 0.01, 0.01, 0.002, 0xfff2d8, "glow");
          props++;
        }
        const card = KIT.tentCard();
        const cp = k.world(lat, Dp / 2 - 0.08);
        card.position.set(cp.x, FY + DECK + 0.012, cp.z);
        card.rotation.y = yawA;
        group.add(card);
        props++;
        cs.pieces.push({ name: r.name, label: r.label, value: r.value, drip: r.drip, visualId: r.visualId,
                         buyable: !!r.buyable, model, card, taken: false, showpiece: !!r.showpiece });
      });
      cs.props = props;
      S.cases.push(cs);
    });
    k.build(group);
    dressCounter(S, group, FY);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    if (S.kind === "city" && CBZ.interiorTrackFixture) CBZ.interiorTrackFixture("jewelry-store", S.lot.building, group);
  }

  // ---- piece/case state ------------------------------------------------------
  function setTaken(p, on) {
    p.taken = !!on;
    if (p.model) p.model.visible = !on;
    if (p.card) p.card.visible = !on;
  }
  function piecesLeft(cs) { let n = 0; for (const p of cs.pieces) if (!p.taken) n++; return n; }
  function caseEmptied(cs) { cs.restockT = RESTOCK * (0.9 + Math.random() * 0.3); }
  function restock(cs) {
    cs.restockT = 0; cs.smashed = false; cs.charged = false;
    mendPane(cs.store, cs);
    for (const p of cs.pieces) {
      // the $5M showpiece only SOMETIMES returns — scarcity keeps it a jackpot
      if (p.showpiece && Math.random() > RING_RESTOCK_ODDS) { setTaken(p, true); continue; }
      setTaken(p, false);
    }
  }

  // ---- the ALARM + the charge (the normal wanted flow) -----------------------
  function startAlarm(S, cs) {
    if (S.alarmT <= 0 && CBZ.sfx) CBZ.sfx("alarm");
    S.alarmT = ALARM_TIME;
    chargeCase(S, cs, 140, "burglary");
    if (S.clerk && S.clerk.sees(cs.x, cs.z)) S.clerk.say("thief");
  }
  function chargeCase(S, cs, sev, type) {
    if (cs.charged) return;
    const P = CBZ.player;
    // only YOUR hit gets charged to you — a stray firefight or runaway car
    // popping a case from across the map shouldn't frame the player.
    if (!P || Math.hypot(P.pos.x - cs.x, P.pos.z - cs.z) > 30) return;
    cs.charged = true;
    const eye = !!(S.clerk && S.clerk.sees(P.pos.x, P.pos.z));
    if (CBZ.cityCrime) CBZ.cityCrime(sev, { type, x: cs.x, z: cs.z, instant: eye });
  }

  // ---- the CLERK's eyes ---------------------------------------------------------
  function clerkSees(S, x, z) { return !!(S.clerk && S.clerk.sees(x, z)); }
  function clerkAlive(S) { return !!(S.clerk && S.clerk.alive()); }
  function isNight() { return (CBZ.nightAmount || 0) >= NIGHT_MIN; }
  function pryEligible(cs) {
    const S = cs.store;
    return !cs.smashed && (!cs.pane || !cs.pane.shattered) && piecesLeft(cs) > 0 && isNight() && !clerkSees(S, cs.x, cs.z);
  }

  // ---- BUY: pay the clerk, the piece goes on your body ------------------------
  function buyTarget(cs) {
    const S = cs.store;
    if (!clerkAlive(S) || (cs.pane && cs.pane.shattered)) return null;
    const P = CBZ.player; if (!P) return null;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best = null, bestDot = -2;
    for (const p of cs.pieces) {
      if (p.taken || !p.buyable) continue;
      const mp = p.model && p.model.position; if (!mp) { if (!best) best = p; continue; }
      const dx = mp.x - P.pos.x, dz = mp.z - P.pos.z, d = Math.hypot(dx, dz) || 1;
      const dot = (dx / d) * fx + (dz / d) * fz;
      if (dot > bestDot) { bestDot = dot; best = p; }
    }
    return best;
  }
  function affordPrice() { return (CBZ.game.cash || 0) + (CBZ.game.cityBank || 0); }
  function chargeCashThenBank(price) {
    let owe = price;
    const fromCash = Math.min(CBZ.game.cash || 0, owe); CBZ.game.cash = (CBZ.game.cash || 0) - fromCash; owe -= fromCash;
    if (owe > 0) CBZ.game.cityBank = (CBZ.game.cityBank || 0) - owe;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
  }
  function buyPiece(cs, p) {
    if (!p || p.taken || !p.buyable) return false;
    const e = econ(); if (!e) return false;
    const price = p.value | 0;
    if (affordPrice() < price) return false;
    chargeCashThenBank(price);
    // the REAL econ item: an owned, PAWNABLE asset bling.js renders by ownership
    e.add(p.name, 1);
    if (p.visualId && CBZ.cityGrantItem) CBZ.cityGrantItem(p.visualId);
    if (CBZ.cityBlingPlayerDirty) CBZ.cityBlingPlayerDirty();   // on your body this frame
    setTaken(p, true);
    if (piecesLeft(cs) === 0) caseEmptied(cs);
    if (CBZ.sfx) CBZ.sfx("coin");
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(p.drip >= 20 ? 3 : 1);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }

  // ---- LOUD: scoop a smashed case (TAKEN WITH A HAND, systems/verbs_pickup.js)
  function scoop(cs) {
    const e = econ();
    if (!e || piecesLeft(cs) === 0 || cs._taking) return;
    let first = null;
    for (const p of cs.pieces) if (!p.taken && p.model) { first = p; break; }
    cs._taking = true;
    const took = function () { cs._taking = false; scoopNow(cs); };
    if (CBZ.verbs && CBZ.verbs.pickup) CBZ.verbs.pickup(CBZ.player, first ? first.model : null, { pose: "grip", onTaken: took });
    else took();
  }
  function scoopNow(cs) {
    const e = econ(), S = cs.store;
    if (!e || piecesLeft(cs) === 0) return;
    // grabbing from someone ELSE's broken case is still theft if you weren't
    // already charged for the smash (witnesses decide, as always)
    chargeCase(S, cs, 90, "theft");
    let total = 0;
    for (const p of cs.pieces) {
      if (p.taken) continue;
      setTaken(p, true);
      e.add(p.name, 1);
      if (CBZ.cityMarkHot) CBZ.cityMarkHot(p.name, 1, S.where);
      total += p.value;
    }
    if (CBZ.sfx) CBZ.sfx("coin");
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(total >= 90000 ? 8 : 3);   // the grab IS the flex
    if (CBZ.cityBlingPlayerDirty) CBZ.cityBlingPlayerDirty();
    caseEmptied(cs);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // ---- QUIET: the slow pry ----------------------------------------------------
  function startPry(cs) {
    const P = CBZ.player, S = cs.store;
    S.pry = { cs, t: 0, px: P.pos.x, pz: P.pos.z };
  }
  function cancelPry(S) { S.pry = null; }
  function finishPry(S, cs) {
    S.pry = null;
    const e = econ();
    if (!e) return;
    let best = null;                       // you came for the priciest piece
    for (const p of cs.pieces) if (!p.taken && (!best || p.value > best.value)) best = p;
    if (!best) return;
    if (CBZ.verbs && CBZ.verbs.pickup && best.model) {
      CBZ.verbs.pickup(CBZ.player, best.model, { pose: "card", onTaken: function () { pryTaken(S, cs, best); } });
    } else pryTaken(S, cs, best);
  }
  function pryTaken(S, cs, best) {
    const e = econ();
    if (!e || best.taken) return;
    setTaken(best, true);
    e.add(best.name, 1);
    if (CBZ.cityMarkHot) CBZ.cityMarkHot(best.name, 1, S.where);
    if (CBZ.sfx) CBZ.sfx("pickup");
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(best.value >= 90000 ? 6 : 2);
    if (piecesLeft(cs) === 0) caseEmptied(cs);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    // every pull risks the clerk turning around mid-lift
    if (clerkAlive(S) && Math.random() < PRY_RISK) startAlarm(S, cs);
  }

  // ---- THE CASES ARE CANDIDATES (city/interactions.js registerFixtures) -----
  function inBounds(S, px, pz) {
    const B = S.jw && S.jw.bounds;
    return !!B && px >= B.minX - 1.5 && px <= B.maxX + 1.5 && pz >= B.minZ - 1.5 && pz <= B.maxZ + 1.5;
  }
  function storeAt(px, pz) {
    for (const S of STORES) if (!S.dead && S.dressed && S.near && inBounds(S, px, pz)) return S;
    return null;
  }
  const loose = (cs) => !!(cs.pane && cs.pane.shattered) && piecesLeft(cs) > 0;
  let fixturesWired = false;
  function wireFixtures() {
    if (fixturesWired || !CBZ.interactions || !CBZ.interactions.registerFixtures) return;
    fixturesWired = true;
    CBZ.interactions.registerFixtures({
      id: "jewel-case", kind: "jewel-case", prio: 9, islands: true,
      list: function (ctx, px, pz) { const S = storeAt(px, pz); return S && !S.pry ? S.cases : null; },
      reach: function () { return REACH; },
      dot: function () { return LOOK_DOT; },
      verbs: [
        { id: "jewel-grab", slot: "e", prio: 7, label: "Grab", forceYes: true, canShow: loose, onSelect: scoop },
        { id: "jewel-buy", slot: "e", prio: 6,
          label: (cs) => { const p = buyTarget(cs); return p ? "Buy " + fmt$(p.value) : "Buy"; },
          canShow: (cs) => { const p = buyTarget(cs); return !!p && affordPrice() >= (p.value | 0); },
          onSelect: (cs) => { if (!cs.store.pry) { const p = buyTarget(cs); if (p) buyPiece(cs, p); } } },
        { id: "jewel-pry", slot: "e", prio: 5, bad: true, label: "Pry", canShow: pryEligible, onSelect: (cs) => { if (!cs.store.pry) startPry(cs); } },
        // the bat's swing, for a thumb: the glass goes, the alarm follows
        { id: "jewel-smash", prio: 3, bad: true, label: "Smash",
          canShow: (cs) => !(cs.pane && cs.pane.shattered) && piecesLeft(cs) > 0,
          onSelect: (cs) => breakPane(cs.store, cs) },
      ],
    });
  }

  // ---- GANG CITY's store --------------------------------------------------------
  function ensureCity() {
    if (cityStore && !cityStore.dead) return cityStore;
    const arena = CBZ.city && CBZ.city.arena;
    if (!arena || !econ() || !CBZ.cityRegisterGlass) return null;
    let lot = arena.jewelryLot || null;
    if (!(lot && lot.building && lot.building.jewelry)) {
      lot = null;
      const lots = arena.lots || [];
      for (let i = 0; i < lots.length; i++) { const L = lots[i]; if (L && L.building && L.building.jewelry) { lot = L; break; } }
    }
    if (!lot) return null;
    const b = lot.building, K = CBZ.storeFixtureKit;
    const FY = ((b && Array.isArray(b.floorTops) && b.floorTops[0] != null) ? b.floorTops[0] : 0.14) + 0.06;   // the fit-out's finished floor
    cityStore = makeStore({ kind: "city", lot: lot, jw: b.jewelry, C: K ? K.counterOf(lot) : null, FY: FY,
      root: arena.root || CBZ.scene, clerk: SF() ? SF().cityClerk(lot) : null, where: "city",
      inStore: function (x, z) { return inBounds(cityStore, x, z); } });
    // the city glass is built with the run (a re-glaze restores it), so the
    // showroom stands from the first look
    cityStore.dressed = true;
    buildDisplays(cityStore);
    return cityStore;
  }
  function dress(S) {
    if (!S || S.dressed || S.dead) return;
    S.dressed = true;
    buildDisplays(S);
  }

  /* ---- THE ISLANDS: a jeweller per building (CBZ.islandVenue "jewelry") ---
     A real jeweller's floor: a row of lit cases down each side wall, long
     side to the aisle, the feature island with the headline watches in the
     middle, the counter across the room, the vault case behind it beside
     the jeweller's post, the office safe in the back room. The rest (the
     dark panelling and the mirrors, the carpet, the pin-spots, the seats by
     the window, the name) is city/shopfloor.js dressShop. */
  function islandFit(b, lot, job) {
    const F = SF(), IV = CBZ.islandVenue;
    if (!F || !IV || !econ() || !CBZ.islandGlass) return null;
    const P0 = F.plan(b, { backRoom: true });
    if (!P0) return null;
    IV.clear(b, 0);
    const shell = P0.back ? F.shell(P0, lot, { goods: "boxes", wall: 0x3a2a20, trim: 0x2a1a10, safeGrade: "office", safeOf: 16000, safeName: "safe" }) : null;
    const gd = F.gunDescriptor(P0);
    const zone = F.counterZone(P0, gd);
    const C = gd.counter;
    const zFront = C.zL - C.D / 2;                         // the counter's customer face (local z)
    const cases = [], keep = [];
    const caseAt = function (lx, lz, o, along) {
      cases.push(Object.assign(P0.w(lx, lz), o));
      const hx = (along ? CASE_D : CASE_W) / 2 + 0.06, hz = (along ? CASE_W : CASE_D) / 2 + 0.06;
      keep.push({ x0: lx - hx, x1: lx + hx, z0: lz - hz, z1: lz + hz });
    };
    // THE SIDE ROWS: from past the front walk to an aisle short of the counter
    const z0c = P0.z0 + 1.45 + CASE_W / 2, z1c = zFront - 1.0 - CASE_W / 2, step = CASE_W + 0.3;
    const nRow = z1c >= z0c ? Math.min(3, 1 + Math.floor((z1c - z0c) / step)) : 0;
    const roomFor = P0.W - 2 * (0.12 + CASE_D) >= CASE_W + 2.0;
    if (nRow && roomFor) {
      for (const side of [-1, 1]) {
        const lx = side < 0 ? P0.x0 + 0.12 + CASE_D / 2 : P0.x1 - 0.12 - CASE_D / 2;
        const inn = P0.v(-side, 0);
        for (let i = 0; i < nRow; i++) caseAt(lx, z0c + i * step, { tier: 0, stock: (i + (side > 0 ? 1 : 0)) % 2, fx: inn.x, fz: inn.z }, true);
      }
      const zMid = Math.min(zFront - 1.3, Math.max(z0c, (z0c + zFront) / 2));
      if (zFront - zMid >= 1.3) caseAt(P0.xc, zMid, { tier: 1, stock: 2 }, false);
    } else {
      // a narrow shop: two retail cases either side of the aisle up front,
      // the feature island between them and the counter
      const zCase = P0.z0 + 3.4;
      const off = Math.max(1.2, Math.min(1.9, P0.W / 2 - 0.75 - CASE_W / 2));
      const zMid = Math.min(zFront - 1.3, Math.max(zCase + 1.7, (zCase + zFront) / 2));
      const edge = off + CASE_W / 2 + 0.7;
      const ax = P0.x0 + edge <= P0.x1 - edge ? Math.max(P0.x0 + edge, Math.min(P0.x1 - edge, 0)) : P0.xc;
      caseAt(ax - off, zCase, { tier: 0, stock: 0 }, false);
      caseAt(ax + off, zCase, { tier: 0, stock: 1 }, false);
      if (zMid <= zFront - 1.0) caseAt(ax, zMid, { tier: 1, stock: 2 }, false);
    }
    caseAt(P0.xc - Math.min(1.6, P0.W / 2 - 0.8), P0.wallFace - 0.62, { tier: 2, vault: true, stock: 3 }, false);
    const clerk = F.postedClerk({ b: b, lot: lot, lx: zone.post.lx, lz: zone.post.lz, face: zone.post.face, armed: null, job: "jeweller" });
    // the register in the counter, and the office safe (city/islandmoney.js):
    // in the back room when there is one (the shell put it there)
    F.register(P0, gd, clerk, -C.L / 2 + 0.55, (lot.name || "jeweller") + " register");
    if (!P0.back && IV.safe) {
      try { IV.safe(b, { k: 0, lx: P0.x1 - 0.5, lz: P0.wallFace - 0.55, yaw: -Math.PI / 2, grade: "office", of: 16000, name: "safe" }); }
      catch (e) { console.error("[jeweller safe]", e); }
    }
    const S = makeStore({
      kind: "island", lot: lot, FY: P0.fy, root: CBZ.scene, clerk: clerk, where: F.whereKey(lot.island),
      jw: { name: b.name || null, bounds: P0.room, tx: C.tx, tz: C.tz, inx: C.inx, inz: C.inz, cases: cases },
      C: { x: C.x, z: C.z, w: C.w, d: C.d, top: C.top, tx: C.tx, tz: C.tz },
      inStore: function (x, z) { return P0.inside(x, z, 0.4); },
    });
    if (F.dressShop) { try { F.dressShop(P0, lot, "jewelry", gd, { keep: keep }); } catch (e) { console.error("[jeweller dress]", e); } }
    return function () { disposeStore(S); if (shell) shell.dispose(); };
  }
  if (CBZ.islandVenue && CBZ.islandVenue.on) CBZ.islandVenue.on("jewelry", islandFit);

  // ---- per-frame ---------------------------------------------------------------
  function tickStore(S, dt, live) {
    const P = CBZ.player;
    if (!live || !P) {
      if (S.group && S.group.visible) S.group.visible = false;
      S.near = false; S.pry = null;
      return;
    }
    const dx = P.pos.x - S.cx, dz = P.pos.z - S.cz, d2 = dx * dx + dz * dz;
    if (!S.dressed && d2 < DRESS_R * DRESS_R) dress(S);
    for (const cs of S.cases) {
      // someone (you, a bullet, a bumper) just broke this case's glass → ALARM.
      if (cs.pane && cs.pane.shattered && !cs.smashed) { cs.smashed = true; startAlarm(S, cs); }
      // a full city re-glaze (new run) restored the pane under us → fresh store
      if (cs.smashed && cs.pane && !cs.pane.shattered) restock(cs);
      if (cs.restockT > 0) { cs.restockT -= dt; if (cs.restockT <= 0) restock(cs); }
    }
    if (S.alarmT > 0) S.alarmT -= dt;
    const near = d2 < VIS_R * VIS_R;
    if (S.group && S.group.visible !== near) S.group.visible = near;
    S.near = near;
    const inside = S.inStore(P.pos.x, P.pos.z);
    if (S.clerk && S.clerk.look) S.clerk.look(inside ? P.pos.x : null, P.pos.z);
    if (S.clerk) S.clerk.tick(dt);
    if (!near || g.state !== "playing" || P.dead || P.driving || CBZ.cityMenuOpen) { cancelPry(S); return; }
    // a live pry: stand still, stay close, and the case must stay intact
    if (S.pry) {
      const pr = S.pry, cs = pr.cs;
      const moved = Math.hypot(P.pos.x - pr.px, P.pos.z - pr.pz) > 0.5;
      const away = Math.hypot(P.pos.x - cs.x, P.pos.z - cs.z) > REACH + 0.8;
      if (moved || away || (cs.pane && cs.pane.shattered) || piecesLeft(cs) === 0) cancelPry(S);
      else {
        pr.t += dt;
        // the readout is a hairline on the case lid, not a "Prying... N%" line
        if (CBZ.workLine) CBZ.workLine("jewel-pry", { x: cs.x, y: P.pos.y + 1.25, z: cs.z }, pr.t / PRY_TIME);
        if (pr.t >= PRY_TIME) finishPry(S, cs);
      }
    }
  }
  CBZ.onUpdate(38, function (dt) {
    const econMode = !!g && (CBZ.economyMode ? CBZ.economyMode(g.mode) : g.mode === "city");
    const cityLive = econMode && !!(CBZ.cityArenaLive ? CBZ.cityArenaLive() : (g.mode === "city"));
    if (cityLive) ensureCity();
    if (econMode) wireFixtures();
    for (let i = STORES.length - 1; i >= 0; i--) {
      const S = STORES[i];
      tickStore(S, dt, S.kind === "city" ? cityLive : (econMode && g.mode !== "city"));
    }
  });

  // a MELEE swing (fists/bat/knife — no gun drawn) on the case you're facing
  // smashes its glass: bullets already break it, this gives the swing the same
  // payoff. A clerk-watched case you can BUY from takes the click as a sale.
  addEventListener("mousedown", function (e) {
    if (e.button !== 0 || !g || g.state !== "playing" || !(CBZ.economyMode ? CBZ.economyMode(g.mode) : g.mode === "city")) return;
    if (CBZ.cityMenuOpen || !CBZ.player || CBZ.player.driving || CBZ.player.dead) return;
    if (CBZ.cityHasGun && CBZ.cityHasGun()) return;        // gunfire path handles glass itself
    const cur = CBZ.interactions && CBZ.interactions.currentCand ? CBZ.interactions.currentCand() : null;
    const cs = cur && cur.kind === "jewel-case" ? cur.t : null;
    if (!cs || !cs.store || (cs.pane && cs.pane.shattered)) return;
    if (buyTarget(cs) && clerkSees(cs.store, cs.x, cs.z)) { const p = buyTarget(cs); if (p && !cs.store.pry) buyPiece(cs, p); return; }
    breakPane(cs.store, cs);
  });

  // ---- public hooks (headless/harness handles, gunstore-style) ----------------
  CBZ.cityJewelryLive = function (lot) {
    if (!g || g.mode !== "city") return false;
    const S = ensureCity();
    return !!(S && (!lot || lot === S.lot));
  };
  CBZ.cityJewelryLot = function () { return (cityStore && cityStore.lot) || null; };
  CBZ.cityJewelryBuy = function (idOrLabel) {
    const S = ensureCity();
    if (!S) return false;
    for (const cs of S.cases) for (const p of cs.pieces) {
      if (p.taken || !p.buyable) continue;
      if (p.visualId === idOrLabel || p.label === idOrLabel || p.name === idOrLabel) return buyPiece(cs, p);
    }
    return false;
  };
  CBZ.cityJewelrySmash = function (i) {
    const S = ensureCity();
    const cs = S && S.cases[i | 0];
    if (!cs || (cs.pane && cs.pane.shattered)) return false;
    breakPane(S, cs);
    return true;
  };
  CBZ.cityJewelryScoop = function (i) {
    const S = ensureCity();
    const cs = S && S.cases[i | 0];
    if (!cs || !(cs.pane && cs.pane.shattered) || piecesLeft(cs) === 0) return false;
    scoop(cs);
    return true;
  };
  function stateOf(S) {
    return {
      kind: S.kind, name: (S.jw && S.jw.name) || null, alarm: S.alarmT > 0, clerkAlive: clerkAlive(S),
      cases: S.cases.map((cs) => ({ tier: cs.tier, vault: !!cs.vault, x: cs.x, z: cs.z,
        smashed: !!(cs.pane && cs.pane.shattered), left: piecesLeft(cs), restockT: cs.restockT,
        pieces: cs.pieces.map((p) => ({ name: p.name, label: p.label, value: p.value, drip: p.drip,
          visualId: p.visualId, buyable: !!p.buyable, taken: !!p.taken })) })),
    };
  }
  CBZ.cityJewelryState = function () { return cityStore && cityStore.dressed ? stateOf(cityStore) : null; };
  CBZ.jewelryStores = function () { return STORES.map(stateOf); };
  // EXPORT ONLY (a gate/probe calls this): what each case actually STANDS,
  // plus the group's real mesh count (the showroom's perf ceiling).
  CBZ.cityJewelryDressAudit = function () {
    const S = cityStore;
    if (!S || !S.dressed) return null;
    let meshes = 0, sprites = 0;
    if (S.group) S.group.traverse(function (o) { if (o.isMesh) meshes++; else if (o.isSprite) sprites++; });
    let panes = 0, cards = 0;
    S.cases.forEach(function (cs) {
      if (cs.pane) panes++;
      cs.pieces.forEach(function (p) { if (p.card) cards++; });
    });
    return {
      meshes: meshes, sprites: sprites, cards: cards,
      cases: S.cases.map(function (cs) { return { tier: cs.tier, vault: !!cs.vault, pieces: cs.pieces.length, props: cs.props | 0 }; }),
      theft: { panes: panes, cases: S.cases.length, clerkAlive: clerkAlive(S) },
    };
  };
})();

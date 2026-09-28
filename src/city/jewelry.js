/* ============================================================
   city/jewelry.js — THE JEWELRY STORE: buy the ice OR smash the case.

   WHY: the loot economy's crown pieces (Diamond Necklace, the $5M
   Engagement Ring) only spawned in pockets — you had to get LUCKY to touch
   the jackpot tier. A glass case downtown holding them in plain sight is
   the purest make-money-show-off loop in the game: you WALK PAST your next
   score every day. But the store is also a real STORE: the front cases hold
   the buyable catalog (a steel diver, a two-tone gold case, a fully iced-out
   bust-down, gold + iced chains, a diamond ring + grill) — pay the clerk and
   it goes STRAIGHT ON YOUR BODY (the same bling.js wrist/neck/hand meshes the
   whole street reads), AND it's a wearable ASSET you can pawn back later.
   Case → fence (or buy → flex → pawn): every piece is money on your neck.

   The watches are drawn distinct per visualId at REAL size (40-42 mm cases)
   lying over velvet pillows: a steel dress watch with baton markers, a diver
   with a dark bezel insert, blue dial and lume, a two-tone gold chrono with
   three subdials, and a bust-down paved in stones. Chains drape round velvet
   neck forms, rings sit on ivory finger cones, the grill and the tiara on
   cushions. Names/prices/visualIds come from CBZ.cityEcon.itemsByTag("jewelry")
   so the case, the prompt and the equipped body reference the same catalog.

   THE CASES (de-slop pass 2026-09-27) are counter-height showcases: kick
   plinth, walnut cabinet (the vault: gunmetal) with a brass inlay and clerk-
   side doors, brass rim, velvet deck and a raised step, the registered glass
   box framed in brass posts and rails, lit INSIDE only (an LED strip under
   the front rail; the vault's pin-spots hang from a rod under its lid).
   Deleted: the glowing slab lying under every case's velvet, 12 cm watches
   floating above their rolls, 11 cm rings, price cards hovering a centimetre
   over the velvet, the vault's "beams" floating in mid-case, and the
   STORE_DRESS_V2 flag. The counter the clerk stands behind is dressed here
   too (walnut, brass, stone top, till, mirror, loupe).

   The jewelry lot's shell (door/counter/clerk) already exists; buildings.js
   stamps lot.building.jewelry with four pre-clamped WORLD case anchors (two
   front, one mid-aisle feature island, the back VAULT case). TWO ways in:
   • LOUD — any bullet (fpsmode already rays every city shot through
     cityShatterRay) or melee swing breaks the case glass: the panes are
     registered as REAL city glass via CBZ.cityRegisterGlass, so cracks,
     shards, blasts and the new-run re-glaze are all the existing pane
     systems. Breaking one screams the alarm + charges burglary through
     CBZ.cityCrime (witnesses + cop-LOS → the NORMAL wanted flow, zero
     special-case police code). Then [E] scoops that case's pieces.
   • QUIET — at night, on a case the clerk can't see (the SAME posted
     vendor ped; their gaze + line-of-sight checked live — the vault sits
     at their BACK by design), [E] starts a slow pry: one piece, no alarm,
     but every pull risks the clerk turning around.
   • BUY — a clerk-watched, intact buyable case ([E] Buy) charges cash-then-
     bank, drops the REAL economy item into your inventory (so bling.js renders
     it the same frame), and equips the matching wardrobe visualId (contract
     [B] cityGrantItem + cityWear) so the look persists / serializes. No alarm,
     no crime — it's a legit purchase. You can pawn it back later for a haircut.
   Cases restock on a ~10-minute timer (the insurance payout re-stocks the
   shop — and the re-glazed glass invites you back).

   Loot/buys are the REAL economy items (econ.add) so fencing/wearing/drip all
   work untouched. Perf: built ONCE per city on one group, shared geometries
   + materials for every ring/watch/bust, whole display vis-gated at 55m.
   Mode-gated + headless-guarded. The gunstore architecture, applied to ice.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onUpdate) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  const RESTOCK = 600;       // seconds an EMPTIED case stays bare (insurance re-stock)
  const VIS_R = 55;          // display group draws only when you're near the shop
  const REACH = 2.8;         // you smash/grab/pry at arm's length
  const LOOK_DOT = 0.55;     // you act on the case you're LOOKING at
  const PRY_TIME = 4.2;      // seconds a quiet pry takes (slow = the price of silence)
  const PRY_RISK = 0.22;     // per finished pry: chance the clerk turns around
  const NIGHT_MIN = 0.5;     // CBZ.nightAmount past this = dark enough to case it
  const ALARM_TIME = 18;     // how long the alarm screams after a smash
  const CASE_W = 1.35, CASE_D = 0.85;   // glass case footprint (long side faces the aisle)

  // What each case HOLDS, value-tiered front → vault. Two kinds of slot:
  //   { id }   — a BUYABLE catalog piece (visualId from cityEcon jewelry tag):
  //              [E] Buy it (clerk-watched + intact case), it equips on your body
  //              and persists; OR smash + grab/pry it like anything else.
  //   { loot } — a steal-ONLY jackpot (a $250k necklace / $5M rock isn't on the
  //              retail floor): smash-and-grab or pry only, fenced at the pawn.
  // The two front cases are the buyable RETAIL floor; the feature island holds
  // the two headline watches (gold two-tone + the iced bust-down); the VAULT is
  // the steal-only crown set. Names/prices come from the catalog at build time.
  const STOCK = [
    [{ id: "watch_steel" }, { id: "chain_gold" }, { id: "ring_diamond" }],   // front: entry retail
    [{ id: "watch_diver" }, { id: "grill_diamond" }, { id: "chain_iced" }],  // front: sport + iced retail
    [{ id: "watch_gold" }, { id: "watch_iced" }],                            // feature island: the headline watches
    [{ loot: "Diamond Necklace" }, { loot: "Diamond Tiara" }, { loot: "Engagement Ring" }],  // the VAULT (steal-only)
  ];
  const RING_RESTOCK_ODDS = 0.35;   // the $5M rock returns to the vault this often

  const S = { lot: null, jw: null, group: null, cases: [], built: false,
              cur: null, pry: null, alarmT: 0, beepT: 0, prompt: null, lastTxt: "", cx: 0, cz: 0 };

  function econ() { return CBZ.cityEcon || null; }
  function fmt$(n) { n = Math.round(n || 0); return "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function note(t, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(t, s); }

  // ---- the BUYABLE catalog, keyed by visualId -------------------------------
  // Pulled ONCE from CBZ.cityEcon.itemsByTag("jewelry") so the case model, the
  // price tag and the equipped wardrobe item all agree on name/price/visualId.
  let CAT = null;
  function catalog() {
    if (CAT) return CAT;
    const e = econ(); if (!e || !e.itemsByTag) return null;
    CAT = {};
    const arr = e.itemsByTag("jewelry") || [];
    for (let i = 0; i < arr.length; i++) { const it = arr[i]; if (it && it.visualId) CAT[it.visualId] = it; }
    return CAT;
  }
  // a flat WHY line for the buyable pieces (these are wearable ASSETS).
  function dripWord(drip) {
    drip = drip | 0;
    if (drip >= 22) return "drips INSANE";
    if (drip >= 12) return "drips hard";
    if (drip >= 7) return "real drip";
    return "clean drip";
  }
  // Resolve a STOCK slot into a normalized piece descriptor. Buyable pieces
  // carry their catalog record (id/price/drip/visualId); loot pieces fall back
  // to the legacy valuable name + its pawn value. `kind` selects the display
  // model (the four distinct watches key off the visualId).
  function resolvePiece(slot) {
    const e = econ(); if (!e) return null;
    if (slot && slot.id) {
      const cat = catalog(); const rec = cat && cat[slot.id];
      if (!rec) return null;
      // strip the catalog's "(Composable)" disambiguation suffix for the tag/prompt
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

  // ---- shared geometries + materials (one each, flagged _shared) ------------
  // METAL IS A HIGHLIGHT, NOT A COLOUR: Phong gives every piece a specular
  // highlight that moves as you walk the aisle. Emissive is kept LOW: a piece
  // of jewellery does not light itself, the case light does (the old ice ran
  // at 0.78 and the "glint" at 0.95, i.e. glowing white dots).
  let M = null;
  const GEO = new Map();
  function G(key, make) { let g2 = GEO.get(key); if (!g2) { g2 = make(); g2._shared = true; GEO.set(key, g2); } return g2; }
  function metal(color, emissive, ei, shininess, spec) {
    return new THREE.MeshPhongMaterial({ color: color, emissive: emissive, emissiveIntensity: ei, specular: spec, shininess: shininess });
  }
  function mats() {
    if (M) return M;
    M = {
      // metal finishes match bling.js's player-worn tones (gold 0xc9a44a,
      // silver 0xb9c0c8, ice 0xeaf6ff), so the case piece and the wrist it
      // lands on read as the SAME metal.
      gold: metal(0xc9a44a, 0x3a2a08, 0.25, 90, 0xfff0c0),
      silver: metal(0xc6cdd6, 0x2a2f38, 0.2, 110, 0xffffff),
      ice: metal(0xeaf6ff, 0x6a8aa8, 0.22, 160, 0xffffff),
      glint: metal(0xffffff, 0x9fb8d0, 0.3, 200, 0xffffff),
      dial: new THREE.MeshPhongMaterial({ color: 0x14171d, specular: 0x444a55, shininess: 80 }),
      blueDial: new THREE.MeshPhongMaterial({ color: 0x1c3a66, specular: 0x5a7aa8, shininess: 80 }),
      bezelIn: new THREE.MeshPhongMaterial({ color: 0x0f1c38, specular: 0x333a48, shininess: 60 }),
      lume: new THREE.MeshLambertMaterial({ color: 0xd8ffe6, emissive: 0x6fdf9a, emissiveIntensity: 0.35 }),
    };
    Object.keys(M).forEach((k) => { M[k]._shared = true; });
    return M;
  }
  function mesh(geo, mat, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = false; m.receiveShadow = false;
    return m;
  }
  const cylG = (rt, rb, h, seg) => G("c" + rt + "," + rb + "," + h + "," + (seg || 16), () => new THREE.CylinderGeometry(rt, rb, h, seg || 16));
  const torG = (r, t, seg, arc) => G("t" + r + "," + t + "," + (seg || 24) + "," + (arc || 0), () => new THREE.TorusGeometry(r, t, 6, seg || 24, arc || Math.PI * 2));
  const boxG = (w, h, d) => G("b" + w + "," + h + "," + d, () => new THREE.BoxGeometry(w, h, d));
  const octG = (r) => G("o" + r, () => new THREE.OctahedronGeometry(r, 0));
  const PI = Math.PI;

  /* ---- THE PIECES, at real size (x DISPLAY) ------------------------------
     Every piece is its own small Group (it leaves the case when bought or
     taken) over shared geometry. Real dimensions: a watch case is 40-42 mm,
     a ring 18 mm inside, a necklace hangs in a ~14 cm loop. DISPLAY scales
     the piece a hair (a display case is lit and looked at from 1.5 m) without
     going back to the old 12 cm watches and 11 cm rings. */
  const DISPLAY = 1.2;

  // A watch lying over a cushion: the bracelet wraps the pillow (radius PR),
  // the head sits on the pillow's front shoulder 35 degrees up, dial facing
  // out. Origin = pillow axis; the mount (buildMount) draws the pillow itself.
  const PR = 0.03;
  function buildWatch(visualId, grp) {
    const m = mats();
    const band = visualId === "watch_iced" ? m.ice : m.silver;
    // the bracelet: a flat band all the way round the pillow
    const br = mesh(torG(PR + 0.004, 0.0035, 28), band, 0, 0, 0, 0, PI / 2, 0);
    br.scale.z = 2.7; grp.add(br);
    if (visualId === "watch_gold") { const c = mesh(torG(PR + 0.0055, 0.0022, 28), m.gold, 0, 0, 0, 0, PI / 2, 0); c.scale.z = 1.5; grp.add(c); }   // two-tone centre links
    if (visualId === "watch_iced") for (let i = 0; i < 14; i++) {                                                  // stones set in the links
      const a = PI * 0.15 + (i / 14) * PI * 1.3;
      grp.add(mesh(octG(0.0022), m.glint, 0, Math.sin(a) * (PR + 0.0075), Math.cos(a) * (PR + 0.0075)));
    }
    // the head: +Y is the dial's outward normal
    const ang = 35 * PI / 180, R = PR + 0.0075;
    const head = new THREE.Group();
    head.position.set(0, Math.sin(ang) * R, Math.cos(ang) * R);
    head.rotation.x = PI / 2 - ang;
    grp.add(head);
    const caseMat = visualId === "watch_gold" ? m.gold : (visualId === "watch_iced" ? m.ice : m.silver);
    const rCase = visualId === "watch_diver" ? 0.0215 : 0.0205;
    head.add(mesh(cylG(rCase, rCase, 0.011, 24), caseMat, 0, 0.0055, 0));
    for (const s of [-1, 1]) head.add(mesh(boxG(0.018, 0.006, 0.01), caseMat, s * (rCase + 0.001), 0.004, 0, 0, 0, 0));   // lugs
    head.add(mesh(cylG(0.0025, 0.0025, 0.005, 10), caseMat, rCase + 0.0025, 0.006, 0, 0, 0, PI / 2));                   // crown
    const dialMat = visualId === "watch_diver" ? m.blueDial : (visualId === "watch_iced" ? m.glint : m.dial);
    const rDial = rCase - 0.0035;
    head.add(mesh(cylG(rDial, rDial, 0.001, 24), dialMat, 0, 0.0112, 0));
    if (visualId === "watch_diver" || visualId === "watch_gold" || visualId === "watch_iced") {
      head.add(mesh(torG(rCase - 0.0015, 0.0022, 28), visualId === "watch_diver" ? m.bezelIn : caseMat, 0, 0.0112, 0, PI / 2));
    }
    if (visualId === "watch_iced") for (let i = 0; i < 16; i++) {
      const a = (i / 16) * PI * 2;
      head.add(mesh(octG(0.0018), m.glint, Math.cos(a) * (rCase - 0.0015), 0.0128, Math.sin(a) * (rCase - 0.0015)));
    }
    const handMat = visualId === "watch_diver" ? m.lume : (visualId === "watch_gold" ? m.gold : m.silver);
    head.add(mesh(boxG(0.0014, 0.0008, 0.011), handMat, 0.002, 0.0122, -0.004, 0, 0.6, 0));
    head.add(mesh(boxG(0.0012, 0.0008, 0.015), handMat, -0.002, 0.0126, -0.0055, 0, -0.3, 0));
    if (visualId === "watch_diver") {
      for (let i = 0; i < 12; i++) { const a = (i / 12) * PI * 2; head.add(mesh(cylG(0.0012, 0.0012, 0.0008, 6), m.lume, Math.cos(a) * 0.013, 0.0118, Math.sin(a) * 0.013)); }
    } else if (visualId === "watch_gold") {
      for (const p of [[-0.0065, 0.002], [0.0065, 0.002], [0, -0.0065]]) head.add(mesh(cylG(0.0035, 0.0035, 0.0006, 12), m.gold, p[0], 0.0117, p[1]));
    } else if (visualId === "watch_steel") {
      for (let i = 0; i < 4; i++) { const a = (i / 4) * PI * 2; head.add(mesh(boxG(0.0012, 0.0006, 0.003), m.silver, Math.cos(a) * 0.012, 0.0118, Math.sin(a) * 0.012, 0, -a, 0)); }
    }
    return grp;
  }

  // the small model for a piece; `kind` = the visualId (buyable) or the loot
  // name (vault). Origin = where it meets its mount (see MOUNT_H).
  function buildPiece(kind) {
    const m = mats();
    const grp = new THREE.Group();
    if (kind === "watch_steel" || kind === "watch_diver" || kind === "watch_gold" || kind === "watch_iced") buildWatch(kind, grp);
    else if (kind === "chain_gold" || kind === "chain_iced" || kind === "Diamond Necklace") {
      // draped on a neck form: a loop tilted forward round the neck, the
      // pendant hanging at its lowest point
      const iced = kind !== "chain_gold";
      const loop = mesh(torG(0.05, kind === "chain_gold" ? 0.0042 : 0.0032, 32), kind === "Diamond Necklace" ? m.silver : (iced ? m.ice : m.gold), 0, 0, 0.004, PI / 2 + 0.55);
      grp.add(loop);
      const py = -Math.sin(0.55) * 0.05, pz = Math.cos(0.55) * 0.05 + 0.006;
      if (kind === "Diamond Necklace") {
        for (let i = -3; i <= 3; i++) { const a = PI / 2 + i * 0.22; grp.add(mesh(octG(0.0045 + (i === 0 ? 0.004 : 0)), m.glint, Math.cos(a) * 0.05, -Math.sin(0.55) * Math.sin(a) * 0.05 - (i === 0 ? 0.008 : 0), Math.cos(0.55) * Math.sin(a) * 0.05 + 0.008)); }
      } else {
        const pend = mesh(octG(iced ? 0.009 : 0.007), iced ? m.glint : m.gold, 0, py - 0.012, pz);
        pend.scale.set(1, 1.35, 0.5); grp.add(pend);
        grp.add(mesh(torG(0.0035, 0.0012, 10), iced ? m.ice : m.gold, 0, py - 0.001, pz));        // the bail
      }
    } else if (kind === "ring_diamond" || kind === "Engagement Ring") {
      // lying on its finger cone: band horizontal, the stone set on top at the front
      const big = kind === "Engagement Ring";
      grp.add(mesh(torG(0.0105, 0.0022, 24), big ? m.silver : m.silver, 0, 0, 0, PI / 2));
      const st = mesh(octG(big ? 0.0085 : 0.0055), m.glint, 0, big ? 0.009 : 0.006, 0.0115);
      st.scale.set(1, 1.2, 1); grp.add(st);
      for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 4; grp.add(mesh(cylG(0.0007, 0.0007, big ? 0.008 : 0.006, 5), m.silver, Math.cos(a) * 0.004, big ? 0.004 : 0.003, 0.0115 + Math.sin(a) * 0.004)); }
      if (!big) for (const s of [-1, 1]) grp.add(mesh(octG(0.0024), m.glint, s * 0.0055, 0.0025, 0.0098));
    } else if (kind === "grill_diamond") {
      // a top grill: six iced caps on an arc, the backing bar behind them
      grp.add(mesh(torG(0.024, 0.0022, 16, PI), m.silver, 0, 0.004, 0, -PI / 2, 0, PI));
      for (let i = 0; i < 6; i++) {
        const a = PI * (0.12 + 0.76 * i / 5);
        const t = mesh(boxG(0.008, 0.011, 0.005), m.glint, Math.cos(a) * 0.026, 0.0065, Math.sin(a) * 0.026, 0, PI / 2 - a, 0);
        grp.add(t);
      }
    } else if (kind === "Diamond Tiara") {
      // standing on its cushion: an arc of white metal with five stone peaks
      grp.add(mesh(torG(0.062, 0.0035, 32, PI), m.silver));
      for (let i = 0; i < 5; i++) {
        const a = PI * (0.18 + 0.64 * i / 4), big = i === 2;
        const r = 0.062 + (big ? 0.022 : 0.012);
        grp.add(mesh(cylG(0.0012, 0.0012, big ? 0.022 : 0.012, 5), m.silver, Math.cos(a) * (0.062 + (big ? 0.011 : 0.006)), Math.sin(a) * (0.062 + (big ? 0.011 : 0.006)), 0, 0, 0, a - PI / 2));
        grp.add(mesh(octG(big ? 0.009 : 0.0055), m.glint, Math.cos(a) * r, Math.sin(a) * r, 0.002));
      }
      for (let i = 0; i < 9; i++) { const a = PI * (0.1 + 0.8 * i / 8); grp.add(mesh(octG(0.0028), m.ice, Math.cos(a) * 0.062, Math.sin(a) * 0.062, 0.003)); }
    } else {
      grp.add(mesh(torG(0.0105, 0.0022, 24), m.gold, 0, 0, 0, PI / 2));
      grp.add(mesh(octG(0.005), m.ice, 0, 0.005, 0.0115));
    }
    grp.scale.setScalar(DISPLAY);
    return grp;
  }

  /* ---- THE CASE: a counter-height showcase -------------------------------
     Kick plinth, a walnut (vault: gunmetal) cabinet with a brass inlay line
     and panel reveals on the customer face and two storage doors on the
     clerk's side, a brass rim and a velvet deck at 0.68 m, a raised velvet
     step at the back, then the glass box (the registered city pane) framed
     by brass corner posts and top rails. Retail cases light the stock with an
     LED strip under the front top rail; the vault drops that and hangs one
     pin-spot per piece from a rod under the lid, so it is the darker, harder
     lit case you actually came for. Everything is drawn in a frame whose +X
     runs along the case and +Z faces the customer (see the kit in gunstore.js). */
  const DECK = 0.68, GLASS_H = 0.34, STEP_H = 0.05, STEP_D = 0.3, STEP_Z = -0.14;
  // where each mount kind stands and how tall it is (the piece sits on top)
  const MOUNT = { chain_gold: "neck", chain_iced: "neck", "Diamond Necklace": "neck", ring_diamond: "finger",
                  "Engagement Ring": "finger", "Diamond Tiara": "pillow", grill_diamond: "pillow",
                  watch_steel: "watch", watch_diver: "watch", watch_gold: "watch", watch_iced: "watch" };
  function buildMount(k, kind, x, y, z, vault) {
    const mk = MOUNT[kind] || "pillow";
    const VEL = vault ? 0x141016 : 0x2a1016, IVORY = 0xe6e0d2;
    if (mk === "neck") {
      // a velvet neck form: a flat foot, a shoulder flare, the neck, a cap
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
      // a watch pillow held in a cradle by its two ends, high enough that
      // the bracelet wrapped round it clears the velvet; axis along the case
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
  function dressCounter(group, FY) {
    const K = CBZ.storeFixtureKit;
    const C = K && K.counterOf(S.lot);
    if (!C) return;
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
  }

  // ---- build the four cases once per city -----------------------------------
  function buildDisplays() {
    const jw = S.jw;
    const group = new THREE.Group();
    S.group = group;
    const root = (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    root.add(group);
    S.cx = (jw.bounds.minX + jw.bounds.maxX) / 2;
    S.cz = (jw.bounds.minZ + jw.bounds.maxZ) / 2;
    const b = S.lot.building;
    const FY = ((b && Array.isArray(b.floorTops) && b.floorTops[0] != null) ? b.floorTops[0] : 0.14) + 0.06;   // the fit-out's finished floor
    const KIT = CBZ.storeFixtureKit;
    const tx = jw.tx, tz = jw.tz;
    const yaw = KIT.yawOf(tx, tz);
    // long side of every case faces the aisle (runs along the wall tangent)
    const gw = Math.abs(tx) * CASE_W + Math.abs(tz) * CASE_D;
    const gd = Math.abs(tz) * CASE_W + Math.abs(tx) * CASE_D;
    const k = KIT.create();
    const BRASS = 0xc9a44a;

    jw.cases.forEach((anchor, idx) => {
      const vault = !!anchor.vault;
      k.frame(anchor.x, 0, anchor.z, yaw);
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
      // brass frame round the glass: corner posts + top rails
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
      // the GLASS — registered as REAL city glass: bullets crack-then-burst
      // it (cityShatterRay), blasts/crashes pop it (cityShatter), a new run
      // re-glazes it (cityGlassReset). No bespoke shatter code at all.
      const pane = CBZ.cityRegisterGlass
        ? CBZ.cityRegisterGlass(group, anchor.x, FY + DECK + GLASS_H / 2, anchor.z, gw - 0.04, GLASS_H, gd - 0.04, 0, 0, null)
        : null;
      // keep the body solid for walkers
      const col = { minX: anchor.x - gw / 2 - 0.04, maxX: anchor.x + gw / 2 + 0.04,
                    minZ: anchor.z - gd / 2 - 0.04, maxZ: anchor.z + gd / 2 + 0.04, y0: 0, y1: FY + DECK + GLASS_H };
      if (CBZ.colliders) CBZ.colliders.push(col);

      const cs = { idx, x: anchor.x, z: anchor.z, tier: anchor.tier | 0, vault,
                   pane, pieces: [], smashed: false, charged: false, restockT: 0 };
      // the pieces stand on the step along the case's long side, each on the
      // mount made for it, a tent card at the front edge in front of each.
      const slots = STOCK[Math.min(idx, STOCK.length - 1)] || [];
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
        model.rotation.y = yaw;
        group.add(model);
        if (vault) {                                                                          // one pin-spot per jackpot piece
          k.cyl(lat, gy1 - 0.028, STEP_Z, 0.016, 0.012, 0.018, 0x2a2d31, "metal");
          k.cyl(lat, gy1 - 0.038, STEP_Z, 0.01, 0.01, 0.002, 0xfff2d8, "glow");
          props++;
        }
        const card = KIT.tentCard();
        const cp = k.world(lat, Dp / 2 - 0.08);
        card.position.set(cp.x, FY + DECK + 0.012, cp.z);
        card.rotation.y = yaw;
        group.add(card);
        props++;
        cs.pieces.push({ name: r.name, label: r.label, value: r.value, drip: r.drip, visualId: r.visualId,
                         buyable: !!r.buyable, model, card, taken: false,
                         showpiece: !!r.showpiece });   // the $5M exhibit
      });
      cs.props = props;
      S.cases.push(cs);
    });
    k.build(group);
    dressCounter(group, FY);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    if (CBZ.interiorTrackFixture) CBZ.interiorTrackFixture("jewelry-store", S.lot.building, group);
  }

  // ---- piece/case state ------------------------------------------------------
  function setTaken(p, on) {
    p.taken = !!on;
    if (p.model) p.model.visible = !on;
    // the card goes with the piece and comes BACK with the re-stock — a priced
    // card standing over an empty mount would be advertising stock that is on
    // your neck. The MOUNT deliberately stays either way.
    if (p.card) p.card.visible = !on;
  }

  function piecesLeft(cs) { let n = 0; for (const p of cs.pieces) if (!p.taken) n++; return n; }
  function caseEmptied(cs) { cs.restockT = RESTOCK * (0.9 + Math.random() * 0.3); }
  function restock(cs) {
    cs.restockT = 0; cs.smashed = false; cs.charged = false;
    // re-glaze the case's own pane (mirrors cityGlassReset for one rec)
    if (cs.pane) { cs.pane.shattered = false; cs.pane.cracked = false; if (cs.pane.mesh) cs.pane.mesh.visible = true; }
    for (const p of cs.pieces) {
      // the $5M showpiece only SOMETIMES returns — scarcity keeps it a jackpot
      if (p.showpiece && Math.random() > RING_RESTOCK_ODDS) { setTaken(p, true); continue; }
      setTaken(p, false);
    }
    const P = CBZ.player;
    if (P && Math.hypot(P.pos.x - cs.x, P.pos.z - cs.z) < 30)
      note("Fresh ice under new glass at " + S.jw.name + ".", 2.2);
  }

  // ---- the ALARM + the charge (normal wanted flow, no special cop code) ------
  function startAlarm(cs) {
    if (S.alarmT <= 0) {
      note("Alarm at " + S.jw.name + "! Every head on the block just turned.", 2.2);
      S.beepT = 1.4;
    }
    S.alarmT = ALARM_TIME;
    chargeCase(cs, 140, "burglary");
  }
  function chargeCase(cs, sev, type) {
    if (cs.charged) return;
    const P = CBZ.player;
    // only YOUR hit gets charged to you — a stray NPC firefight or runaway car
    // popping a case from across the map shouldn't frame the player.
    if (!P || Math.hypot(P.pos.x - cs.x, P.pos.z - cs.z) > 30) return;
    cs.charged = true;
    if (CBZ.cityCrime) CBZ.cityCrime(sev, { type, x: cs.x, z: cs.z });   // tags witnesses + cop-LOS → wanted
  }

  // ---- the CLERK's eyes (the existing posted vendor ped) ----------------------
  // gaze = alive, close, the case is in their forward cone, and no wall between.
  // The vault lives behind their counter post, at their BACK — by design.
  function clerkSees(x, z) {
    const v = S.lot && S.lot.building && S.lot.building.vendor;
    if (!v || v.dead || !v.pos) return false;
    const dx = x - v.pos.x, dz = z - v.pos.z, d = Math.hypot(dx, dz);
    if (d > 16) return false;
    if (d > 0.4) {
      const ry = v.group ? v.group.rotation.y : 0;
      const fx = Math.sin(ry), fz = Math.cos(ry);               // ped forward
      if ((dx / d) * fx + (dz / d) * fz < 0.3) return false;    // behind their back
    }
    if (CBZ.clearLineOfFire && !CBZ.clearLineOfFire(v.pos.x, (v.pos.y || 0) + 1.6, v.pos.z, x, 1.2, z)) return false;
    return true;
  }
  function isNight() { return (CBZ.nightAmount || 0) >= NIGHT_MIN; }
  function pryEligible(cs) {
    return !cs.smashed && (!cs.pane || !cs.pane.shattered) && piecesLeft(cs) > 0 && isNight() && !clerkSees(cs.x, cs.z);
  }
  // the store is OPEN to sell when a live clerk is posted (you pay them across
  // the counter). A dead clerk's store can only be robbed, never bought from.
  function clerkAlive() { const v = S.lot && S.lot.building && S.lot.building.vendor; return !!(v && !v.dead); }
  function clerkName() { const v = S.lot && S.lot.building && S.lot.building.vendor; return (v && v.name) || "Jeweler"; }

  // ---- BUY: pay the clerk, the piece goes on your body ------------------------
  // The buyable piece in the case nearest your aim (so you buy what you point at,
  // not a random one). Skips taken pieces + loot-only jackpots.
  function buyTarget(cs) {
    if (!clerkAlive() || (cs.pane && cs.pane.shattered)) return null;
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
    // mirrors realestate.js: spend cash first, then dip into the bank for the rest
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
    if (affordPrice() < price) { note("Need " + fmt$(price) + " (cash + bank) for the " + p.label + ".", 2); return false; }
    chargeCashThenBank(price);
    // 1) the REAL econ item lands in inventory → it's an owned, PAWNABLE asset
    //    with the right identity + value (pawnshop/fence read g.cityInv by name).
    e.add(p.name, 1);
    // 2) wardrobe contract [B]: own + WEAR the matching visualId so the look is
    //    persisted/serialized, the drip counts toward club status, and the body
    //    renders the piece the instant the composable jewelry parts exist (see
    //    DEVIATION: the watch_*/chain_*/ring_*/grill_* visualIds have no render
    //    spec yet in clothes.js COMP or bling.js — they're catalog-only today).
    // jewelry RENDERS (bling reads g.cityInv ownership) and COUNTS for drip
    // (best-owned-per-slot) by OWNERSHIP — it is not a clothing composite, so it
    // does NOT route through cityWear (that's the shirt/blazer/tie fit, and a
    // jewelry id there is inert clutter). Grant marks it owned for the wardrobe
    // list; cityBlingPlayerDirty (below) seats it on the body this frame.
    if (p.visualId && CBZ.cityGrantItem) CBZ.cityGrantItem(p.visualId);
    if (CBZ.cityBlingPlayerDirty) CBZ.cityBlingPlayerDirty();   // re-seat worn ice this frame
    // bought pieces are off the display (it's now on YOU); restock returns it.
    setTaken(p, true);
    if (piecesLeft(cs) === 0) caseEmptied(cs);
    if (CBZ.sfx) CBZ.sfx("coin");
    note("Bought the " + p.label + ", " + fmt$(price) + ". " + dripWord(p.drip) + ". (pawn it later)", 2.6);
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(p.drip >= 20 ? 3 : 1);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }

  // ---- LOUD: scoop a smashed case ---------------------------------------------
  // TAKEN WITH A HAND (systems/verbs_pickup.js): the hand goes into the
  // broken case and comes out with the ice; the haul lands on the grab frame
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
    const e = econ();
    if (!e || piecesLeft(cs) === 0) return;
    // grabbing from someone ELSE's broken case is still theft if you weren't
    // already charged for the smash (witnesses decide, as always)
    chargeCase(cs, 90, "theft");
    let total = 0; const names = [];
    for (const p of cs.pieces) {
      if (p.taken) continue;
      setTaken(p, true);
      e.add(p.name, 1);
      total += p.value; names.push(p.name);
    }
    if (CBZ.sfx) CBZ.sfx("coin");
    note("Scooped: " + names.join(" + ") + ", " + fmt$(total) + " in ice.", 2.6);
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(total >= 90000 ? 8 : 3);   // the grab IS the flex
    if (total >= 200000 && CBZ.city && CBZ.city.big) CBZ.city.big("" + fmt$(total) + " SMASH-AND-GRAB!");
    caseEmptied(cs);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // ---- QUIET: the slow pry ----------------------------------------------------
  function startPry(cs) {
    const P = CBZ.player;
    S.pry = { cs, t: 0, px: P.pos.x, pz: P.pos.z };
    note("Working the lock, stay still, stay quiet…", 1.4);
  }
  function cancelPry(why) {
    if (!S.pry) return;
    S.pry = null;
    if (why) note(why, 1.2);
  }
  function finishPry(cs) {
    S.pry = null;
    const e = econ();
    if (!e) return;
    let best = null;                       // you came for the priciest piece
    for (const p of cs.pieces) if (!p.taken && (!best || p.value > best.value)) best = p;
    if (!best) return;
    // TAKEN WITH A HAND (systems/verbs_pickup.js): the piece comes out of the
    // case in the hand; it is yours (and the clerk's chance to turn) on the
    // grab frame
    if (CBZ.verbs && CBZ.verbs.pickup && best.model) {
      CBZ.verbs.pickup(CBZ.player, best.model, { pose: "card", onTaken: function () { pryTaken(cs, best); } });
    } else pryTaken(cs, best);
  }
  function pryTaken(cs, best) {
    const e = econ();
    if (!e || best.taken) return;
    setTaken(best, true);
    e.add(best.name, 1);
    if (CBZ.sfx) CBZ.sfx("coin");
    note("Slipped the " + best.name + " (" + fmt$(best.value) + ") out clean, no alarm.", 2.4);
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(best.value >= 90000 ? 6 : 2);
    if (piecesLeft(cs) === 0) caseEmptied(cs);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    // every pull risks the clerk turning around mid-lift
    const v = S.lot && S.lot.building && S.lot.building.vendor;
    if (v && !v.dead && Math.random() < PRY_RISK) {
      note("The " + (v.name || "Jeweler") + " spun around, you're MADE!", 2.2);
      startAlarm(cs);
    }
  }

  // ---- the look-pick + [E] prompt ---------------------------------------------
  function pickCase() {
    const P = CBZ.player, B = S.jw.bounds;
    const px = P.pos.x, pz = P.pos.z;
    if (px < B.minX - 1.5 || px > B.maxX + 1.5 || pz < B.minZ - 1.5 || pz > B.maxZ + 1.5) return null;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best = null, bestScore = -1;
    for (const cs of S.cases) {
      const dx = cs.x - px, dz = cs.z - pz, d = Math.hypot(dx, dz);
      if (d > REACH || d < 0.05) continue;
      const dot = (dx / d) * fx + (dz / d) * fz;
      if (dot < LOOK_DOT) continue;
      const score = dot - d * 0.06;
      if (score > bestScore) { bestScore = score; best = cs; }
    }
    return best;
  }

  function promptText(cs) {
    const left = piecesLeft(cs);
    const broken = cs.pane && cs.pane.shattered;
    if (broken && left > 0)
      return "<b style='color:#ffd166'>[E]</b> Grab the ice <span style='color:#7f8794'>" + left + " piece" + (left > 1 ? "s" : "") + " loose in the glass</span>";
    if (left === 0)
      return "<span style='color:#7f8794'>Cleaned out, the insurance re-stock is coming.</span>";
    if (S.pry && S.pry.cs === cs)
      return "<span style='color:#7f8794'>Don't move</span>";
    // OPEN-STORE BUY: clerk posted + intact case + a buyable piece in your aim →
    // pay the counter and it goes ON YOU (then pawn it later). The WHY hint says
    // it: a wearable asset. (If you'd rather take it, the glass is right there.)
    const buy = buyTarget(cs);
    if (buy) {
      const can = affordPrice() >= (buy.value | 0);
      const why = "<span style='color:#7f8794'>" + dripWord(buy.drip) + ", pawn it later</span>";
      if (can)
        return "<b style='color:#9be37a'>[E]</b> Buy the " + buy.label + ", <b style='color:#ffd166'>" + fmt$(buy.value) + "</b> " + why;
      return "<span style='color:#ff9e9e'>" + buy.label + ", " + fmt$(buy.value) + "</span> <span style='color:#7f8794'>short on cash + bank, the glass, though…</span>";
    }
    if (pryEligible(cs))
      return "<b style='color:#9fe0ff'>[E]</b> Pry the case <span style='color:#7f8794'>slow + silent, one piece, the clerk might turn</span>";
    if (!isNight())
      return "<span style='color:#7f8794'>Locked case, too many eyes in daylight. The glass, though…</span>";
    return "<span style='color:#ff9e9e'>The " + clerkName() + " is watching this case.</span> <span style='color:#7f8794'>the glass, though…</span>";
  }

  function promptEl() {
    if (S.prompt) return S.prompt;
    if (typeof document === "undefined" || !document.body) return null;
    const d = document.createElement("div");
    d.id = "jewelryPrompt";
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

  function actOn(cs) {
    if (S.pry) return;                                 // hands are busy
    const broken = cs.pane && cs.pane.shattered;
    if (broken && piecesLeft(cs) > 0) { scoop(cs); return; }
    const buy = buyTarget(cs);
    if (buy) { buyPiece(cs, buy); return; }            // open store → pay the clerk
    if (pryEligible(cs)) { startPry(cs); return; }
  }

  // ---- find the lot + build once (self-healing, gunstore pattern) ------------
  function ensure() {
    if (S.built) return true;
    const arena = CBZ.city && CBZ.city.arena;
    if (!arena || !econ() || !CBZ.cityRegisterGlass) return false;
    let lot = arena.jewelryLot || null;
    if (!(lot && lot.building && lot.building.jewelry)) {
      lot = null;
      const lots = arena.lots || [];
      for (let i = 0; i < lots.length; i++) { const L = lots[i]; if (L && L.building && L.building.jewelry) { lot = L; break; } }
    }
    if (!lot) return false;
    S.lot = lot; S.jw = lot.building.jewelry;
    buildDisplays();
    S.built = true;
    return true;
  }

  // ---- per-frame ---------------------------------------------------------------
  CBZ.onUpdate(38, function (dt) {
    if (!g || g.mode !== "city") { if (S.group && S.group.visible) S.group.visible = false; hidePrompt(); S.pry = null; return; }
    if (!ensure()) return;
    const P = CBZ.player;

    for (const cs of S.cases) {
      // someone (you, a bullet, a bumper) just broke this case's glass → ALARM.
      if (cs.pane && cs.pane.shattered && !cs.smashed) {
        cs.smashed = true;
        startAlarm(cs);
      }
      // a full city re-glaze (new run) restored the pane under us → fresh store
      if (cs.smashed && cs.pane && !cs.pane.shattered) restock(cs);
      // insurance re-stock keeps ticking while you're away
      if (cs.restockT > 0) { cs.restockT -= dt; if (cs.restockT <= 0) restock(cs); }
    }

    // the alarm screams in bursts until it times out (cops come via wanted flow)
    if (S.alarmT > 0) {
      S.alarmT -= dt;
    }

    // distance VIS-GATE: the showroom draws only when you're near the shop
    const dx = P.pos.x - S.cx, dz = P.pos.z - S.cz;
    const near = (dx * dx + dz * dz) < VIS_R * VIS_R;
    if (S.group && S.group.visible !== near) S.group.visible = near;
    if (!near || g.state !== "playing" || P.dead || P.driving || CBZ.cityMenuOpen) { hidePrompt(); cancelPry(); return; }

    // a live pry: stand still, stay close, and the case must stay intact
    if (S.pry) {
      const pr = S.pry, cs = pr.cs;
      const moved = Math.hypot(P.pos.x - pr.px, P.pos.z - pr.pz) > 0.5;
      const away = Math.hypot(P.pos.x - cs.x, P.pos.z - cs.z) > REACH + 0.8;
      if (moved || away) cancelPry("The pry slipped, you moved.");
      else if ((cs.pane && cs.pane.shattered) || piecesLeft(cs) === 0) cancelPry();
      else {
        pr.t += dt;
        // the slow pry IS the price of silence, so it keeps its time; the
        // readout is a hairline on the case lid, not a "Prying... N%" line
        if (CBZ.workLine) CBZ.workLine("jewel-pry", { x: cs.x, y: P.pos.y + 1.25, z: cs.z }, pr.t / PRY_TIME);
        if (pr.t >= PRY_TIME) finishPry(cs);
      }
      if (S.pry) { S.cur = cs; showPrompt(promptText(cs)); return; }
    }

    const cs = pickCase();
    if (!cs) { hidePrompt(); return; }
    S.cur = cs;
    showPrompt(promptText(cs));
  });

  // [E] acts on the case you're looking at. CAPTURE phase so the case wins the
  // key over interact.js's bubble listener; stopImmediatePropagation keeps one
  // press from ALSO opening the clerk's counter menu (the gunstore pattern).
  addEventListener("keydown", function (e) {
    if (!S.cur || !g || g.mode !== "city" || g.state !== "playing") return;
    if (CBZ.cityMenuOpen || (CBZ.player && (CBZ.player.driving || CBZ.player.dead))) return;
    if ((e.key || "").toLowerCase() !== "e") return;
    e.preventDefault();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    e.stopPropagation();
    actOn(S.cur);
  }, true);

  // a MELEE swing (fists/bat/knife — no gun drawn) on the case you're facing
  // smashes its glass: bullets already break it through fpsmode's
  // cityShatterRay pass, this gives the bat the same one-swing payoff.
  addEventListener("mousedown", function (e) {
    if (e.button !== 0 || !S.built || !g || g.mode !== "city" || g.state !== "playing") return;
    if (CBZ.cityMenuOpen || !CBZ.player || CBZ.player.driving || CBZ.player.dead) return;
    if (CBZ.cityHasGun && CBZ.cityHasGun()) return;        // gunfire path handles glass itself
    const cs = pickCase();
    if (!cs || (cs.pane && cs.pane.shattered)) return;
    // OPEN STORE: a left-click at a clerk-watched, intact case you can BUY from is
    // a purchase, NOT a smash — browsing the counter shouldn't frame you for
    // burglary. Robbing in daylight still works via a GUN; the bat smashes when
    // the clerk can't see (night / their blind side) or is down. (E-key buys too.)
    if (buyTarget(cs) && clerkSees(cs.x, cs.z)) { actOn(cs); return; }
    // pop just THIS case's pane through the shared glass system (sfx + shards
    // + the alarm transition above all follow from the pane state change)
    if (CBZ.cityShatter) CBZ.cityShatter(cs.x, cs.z, 0.8, { directPlayer: true });
  });

  // ---- public hooks (headless/harness handles, gunstore-style) ----------------
  // FEATURE-DETECT (contract [F], mirrors cityGunWallLive): interact.js trims the
  // generic "Shop here" vendor verb on the jewelry clerk when this is true, so
  // the in-world cases ARE the store (buy/smash/pry — no text menu). ensure()
  // builds-on-approach so the very first walk-up reports live.
  CBZ.cityJewelryLive = function (lot) {
    if (!g || g.mode !== "city") return false;
    if (!ensure()) return false;
    return !!(S.lot && (!lot || lot === S.lot));
  };
  CBZ.cityJewelryLot = function () { return (S.built && S.lot) || null; };
  // headless/harness handle: buy a named buyable display by visualId or label.
  CBZ.cityJewelryBuy = function (idOrLabel) {
    if (!ensure()) return false;
    for (const cs of S.cases) for (const p of cs.pieces) {
      if (p.taken || !p.buyable) continue;
      if (p.visualId === idOrLabel || p.label === idOrLabel || p.name === idOrLabel) return buyPiece(cs, p);
    }
    return false;
  };
  CBZ.cityJewelrySmash = function (i) {
    if (!ensure()) return false;
    const cs = S.cases[i | 0];
    if (!cs || (cs.pane && cs.pane.shattered)) return false;
    if (CBZ.cityShatter) CBZ.cityShatter(cs.x, cs.z, 0.8);
    return true;
  };
  CBZ.cityJewelryScoop = function (i) {
    if (!ensure()) return false;
    const cs = S.cases[i | 0];
    if (!cs || !(cs.pane && cs.pane.shattered) || piecesLeft(cs) === 0) return false;
    scoop(cs);
    return true;
  };
  CBZ.cityJewelryState = function () {
    if (!S.built) return null;
    return {
      alarm: S.alarmT > 0, clerkAlive: clerkAlive(),
      cases: S.cases.map((cs) => ({ tier: cs.tier, vault: !!cs.vault, x: cs.x, z: cs.z,
        smashed: !!(cs.pane && cs.pane.shattered), left: piecesLeft(cs), restockT: cs.restockT,
        pieces: cs.pieces.map((p) => ({ name: p.name, label: p.label, value: p.value, drip: p.drip,
          visualId: p.visualId, buyable: !!p.buyable, taken: !!p.taken })) })),
    };
  };
  // EXPORT ONLY (a gate/probe calls this; nothing in the game does). What each
  // case actually STANDS — pieces, display props (riser, mounts, lamp, cards) —
  // plus the group's real mesh count, which is the perf ceiling this showroom
  // has to live under. The theft block re-states the mechanics this must never
  // have touched: every case still owns a registered pane, and the vault still
  // sits at the clerk's back.
  CBZ.cityJewelryDressAudit = function () {
    if (!S.built) return null;
    let meshes = 0, sprites = 0;
    if (S.group) S.group.traverse(function (o) { if (o.isMesh) meshes++; else if (o.isSprite) sprites++; });
    let panes = 0, cards = 0;
    S.cases.forEach(function (cs) {
      if (cs.pane) panes++;
      cs.pieces.forEach(function (p) { if (p.card) cards++; });
    });
    return {
      meshes: meshes, sprites: sprites, cards: cards,
      cases: S.cases.map(function (cs) {
        return { tier: cs.tier, vault: !!cs.vault, pieces: cs.pieces.length, props: cs.props | 0 };
      }),
      theft: { panes: panes, cases: S.cases.length, clerkAlive: clerkAlive() },
    };
  };
})();

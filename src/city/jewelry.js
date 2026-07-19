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

   The watches are drawn distinct + low-poly per visualId (websearch-grounded
   dress / dive / two-tone-chrono / iced-pavé silhouettes): a slim steel dress
   case, a chunky diver with a rotating bezel + lume pip, a two-tone gold case
   with chrono subdials, and a white-gold case paved with a grid of ice. The
   names/prices/visualIds come from CBZ.cityEcon.itemsByTag("jewelry") so the
   case, the price tag and the equipped body all reference the same catalog.

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
  let M = null, GEO = null;
  function mats() {
    if (M) return M;
    M = {
      body: new THREE.MeshLambertMaterial({ color: 0x2a2320 }),                                   // dark walnut pedestal
      vault: new THREE.MeshLambertMaterial({ color: 0x2c313a }),                                  // the vault's steel body
      brass: new THREE.MeshLambertMaterial({ color: 0xcaa64a }),                                  // brass trim
      velvet: new THREE.MeshLambertMaterial({ color: 0x4a1420 }),                                 // deep velvet pad
      glow: new THREE.MeshLambertMaterial({ color: 0xffe08a, emissive: 0xffe08a, emissiveIntensity: 0.6 }),  // case under-light (the trade's warm accent)
      // metal finishes match bling.js's player-worn tones, so the case piece and
      // the wrist it lands on read as the SAME metal: gold 0xc9a44a, silver
      // 0xb9c0c8, ice 0xeaf6ff. (case versions glow a touch more for the display.)
      gold: new THREE.MeshLambertMaterial({ color: 0xc9a44a, emissive: 0x7a5c1c, emissiveIntensity: 0.4 }),
      silver: new THREE.MeshLambertMaterial({ color: 0xc6cdd6, emissive: 0x70798a, emissiveIntensity: 0.32 }),
      ice: new THREE.MeshLambertMaterial({ color: 0xeaf6ff, emissive: 0xa6d6ff, emissiveIntensity: 0.78 }),  // diamonds READ from the door
      glint: new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xdff0ff, emissiveIntensity: 0.95 }), // a single hot sparkle
      dial: new THREE.MeshLambertMaterial({ color: 0x14171d, emissive: 0x0a0c10, emissiveIntensity: 0.12 }),  // dark sunburst dial
      blueDial: new THREE.MeshLambertMaterial({ color: 0x1c3a66, emissive: 0x0c2244, emissiveIntensity: 0.25 }), // diver blue dial
      lume: new THREE.MeshLambertMaterial({ color: 0xd8ffe6, emissive: 0x8fffba, emissiveIntensity: 0.7 }),   // glowing lume markers
    };
    Object.keys(M).forEach((k) => { M[k]._shared = true; });
    return M;
  }
  function geos() {
    if (GEO) return GEO;
    GEO = {
      box: new THREE.BoxGeometry(1, 1, 1),
      ring: new THREE.TorusGeometry(0.055, 0.018, 6, 12),
      band: new THREE.TorusGeometry(0.075, 0.016, 6, 12),
      link: new THREE.TorusGeometry(0.1, 0.014, 6, 14),
      gem: new THREE.OctahedronGeometry(0.045, 0),
      face: new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10),
      bust: new THREE.CylinderGeometry(0.07, 0.12, 0.24, 8),
      // ---- richer WATCH parts (websearch-grounded silhouettes) -------------
      // a watch sits upright on a little wedge stand so the dial faces the door.
      stand: new THREE.CylinderGeometry(0.045, 0.075, 0.12, 10),         // display wedge
      caseR: new THREE.CylinderGeometry(0.06, 0.06, 0.028, 16),          // round watch case (dress)
      caseT: new THREE.CylinderGeometry(0.066, 0.066, 0.03, 14),         // tool/diver case (chunkier)
      bezel: new THREE.TorusGeometry(0.062, 0.012, 8, 18),               // rotating dive bezel ring
      dial: new THREE.CylinderGeometry(0.046, 0.046, 0.006, 16),         // the dial face
      subdial: new THREE.CylinderGeometry(0.013, 0.013, 0.004, 10),      // chrono subdial
      pip: new THREE.CylinderGeometry(0.008, 0.008, 0.006, 8),           // lume pip / hour marker
      hand: new THREE.BoxGeometry(0.006, 0.04, 0.004),                   // watch hand
      crown: new THREE.CylinderGeometry(0.01, 0.01, 0.02, 8),            // winding crown
      bandSeg: new THREE.BoxGeometry(0.085, 0.052, 0.022),               // bracelet link segment
      icegem: new THREE.OctahedronGeometry(0.012, 0),                    // pavé stone (tiny)
      tile: new THREE.BoxGeometry(0.014, 0.012, 0.006),                  // grill tooth tile
    };
    Object.keys(GEO).forEach((k) => { GEO[k]._shared = true; });
    return GEO;
  }
  function mesh(geo, mat, sx, sy, sz) {
    const m = new THREE.Mesh(geo, mat);
    if (sx != null) m.scale.set(sx, sy == null ? sx : sy, sz == null ? sx : sz);
    m.castShadow = false; m.receiveShadow = false;
    return m;
  }

  // ---- the four DISTINCT watch models (websearch silhouettes) ---------------
  // Built upright on a little wedge stand, dial facing +Z (the caller rotates
  // the group so it faces the door). Each is a clean low-poly read: dress vs
  // diver vs two-tone-chrono vs iced is legible from across the aisle. Shared
  // geometry + the per-finish shared mats keep the whole wall a few dozen meshes.
  function buildWatch(visualId, grp) {
    const GG = geos(), m = mats();
    // common: the display stand + an upright case the dial sits on. We stand the
    // case on its edge (rotate the cylinder so its flat face points at the door).
    const stand = mesh(GG.stand, m.body); stand.position.y = 0.06; grp.add(stand);
    const caseY = 0.21;
    const place = function (mh, y) { mh.rotation.x = Math.PI / 2; mh.position.set(0, y == null ? caseY : y, 0); return mh; };

    if (visualId === "watch_steel") {                 // SLIM STEEL DRESS WATCH
      grp.add(place(mesh(GG.caseR, m.silver)));        // thin round steel case
      const dial = place(mesh(GG.dial, m.dial)); dial.position.z = 0.016; grp.add(dial);
      // two slim hands + a couple of stick markers — minimal, elegant
      const hh = mesh(GG.hand, m.silver); hh.position.set(0, caseY + 0.012, 0.02); hh.scale.set(1, 0.7, 1); grp.add(hh);
      const mh = mesh(GG.hand, m.silver); mh.position.set(0, caseY + 0.02, 0.02); grp.add(mh);
      for (const s of [-1, 1]) { const p = mesh(GG.pip, m.silver); p.rotation.x = Math.PI / 2; p.position.set(s * 0.035, caseY, 0.018); grp.add(p); }
      const cr = mesh(GG.crown, m.silver); cr.rotation.z = Math.PI / 2; cr.position.set(0.066, caseY, 0); grp.add(cr);
      bracelet(grp, m.silver, caseY);
    } else if (visualId === "watch_diver") {           // CHUNKY STEEL DIVER
      grp.add(place(mesh(GG.caseT, m.silver)));         // beefier tool case
      const bz = mesh(GG.bezel, m.silver); bz.position.set(0, caseY, 0.016); grp.add(bz);   // rotating bezel ring
      const dial = place(mesh(GG.dial, m.blueDial)); dial.position.z = 0.017; grp.add(dial); // signature blue dial
      // a fat lume pip at 12 + lume hour pips around the dial (Submariner read)
      const top = mesh(GG.pip, m.lume, 1.5); top.rotation.x = Math.PI / 2; top.position.set(0, caseY + 0.05, 0.02); grp.add(top);
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; const p = mesh(GG.pip, m.lume); p.rotation.x = Math.PI / 2; p.position.set(Math.cos(a) * 0.034, caseY + Math.sin(a) * 0.034, 0.02); grp.add(p); }
      const hh = mesh(GG.hand, m.lume); hh.position.set(0, caseY + 0.014, 0.022); grp.add(hh);
      const cr = mesh(GG.crown, m.silver); cr.rotation.z = Math.PI / 2; cr.position.set(0.072, caseY, 0); grp.add(cr);
      bracelet(grp, m.silver, caseY);
    } else if (visualId === "watch_gold") {            // TWO-TONE GOLD CHRONO
      grp.add(place(mesh(GG.caseR, m.gold)));           // gold case…
      const bz = mesh(GG.bezel, m.gold); bz.position.set(0, caseY, 0.016); grp.add(bz);
      const dial = place(mesh(GG.dial, m.dial)); dial.position.z = 0.016; grp.add(dial);
      // two chrono subdials (the two-tone-chrono signature) + gold hands
      for (const s of [-1, 1]) { const sd = mesh(GG.subdial, m.gold); sd.rotation.x = Math.PI / 2; sd.position.set(s * 0.022, caseY - 0.006, 0.019); grp.add(sd); }
      const sd3 = mesh(GG.subdial, m.gold); sd3.rotation.x = Math.PI / 2; sd3.position.set(0, caseY + 0.024, 0.019); grp.add(sd3);
      const hh = mesh(GG.hand, m.gold); hh.position.set(0, caseY + 0.012, 0.02); grp.add(hh);
      const cr = mesh(GG.crown, m.gold); cr.rotation.z = Math.PI / 2; cr.position.set(0.066, caseY, 0); grp.add(cr);
      bracelet(grp, m.silver, caseY, m.gold);           // …on a STEEL bracelet with gold center links = two-tone
    } else {                                            // watch_iced — FULLY ICED BUST-DOWN
      grp.add(place(mesh(GG.caseT, m.ice)));
      const bz = mesh(GG.bezel, m.ice); bz.position.set(0, caseY, 0.016); grp.add(bz);
      const dial = place(mesh(GG.dial, m.glint)); dial.position.z = 0.017; grp.add(dial);
      // a tight PAVÉ ring of tiny ice stones around the bezel (the bust-down look)
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; const gm = mesh(GG.icegem, m.glint); gm.position.set(Math.cos(a) * 0.062, caseY + Math.sin(a) * 0.062, 0.024); grp.add(gm); }
      const hh = mesh(GG.hand, m.silver); hh.position.set(0, caseY + 0.012, 0.022); grp.add(hh);
      bracelet(grp, m.ice, caseY, m.glint);             // iced bracelet, every link a stone
    }
    return grp;
  }
  // a short run of bracelet links hanging below the case (lug → wrist), plus a
  // couple above. centerMat (optional) tints the middle link → two-tone look.
  function bracelet(grp, mat, caseY, centerMat) {
    const GG = geos();
    const ys = [caseY - 0.07, caseY - 0.125, caseY + 0.07];
    for (let i = 0; i < ys.length; i++) {
      const seg = mesh(GG.bandSeg, mat); seg.position.set(0, ys[i], -0.004); grp.add(seg);
      if (centerMat) { const c = mesh(GG.box, centerMat, 0.028, 0.05, 0.024); c.position.set(0, ys[i], 0.006); grp.add(c); }
    }
  }

  // the tiny display model for a piece — shared geometry, a few meshes each, so
  // the whole showroom of ice costs a few dozen draw-gated meshes total. `kind`
  // is the visualId for buyable pieces (routes the four distinct watches) or the
  // legacy loot name for the steal-only jackpot pieces.
  function buildPiece(kind) {
    const GG = geos(), m = mats();
    const grp = new THREE.Group();
    if (kind === "watch_steel" || kind === "watch_diver" || kind === "watch_gold" || kind === "watch_iced") {
      return buildWatch(kind, grp);
    }
    if (kind === "chain_gold" || kind === "chain_iced") {                 // composable chains on the velvet
      const iced = kind === "chain_iced";
      const link = mesh(GG.link, iced ? m.ice : m.gold, 1.05);
      link.rotation.x = Math.PI / 2; link.position.y = 0.02; grp.add(link);
      const pend = mesh(GG.gem, iced ? m.glint : m.gold, iced ? 1.1 : 0.9); pend.position.set(0, 0.03, 0.085); grp.add(pend);
    } else if (kind === "ring_diamond") {                                 // composable diamond ring
      const r = mesh(GG.ring, m.silver); const gm = mesh(GG.gem, m.glint, 0.95); gm.position.y = 0.078;
      grp.add(r); grp.add(gm);
    } else if (kind === "grill_diamond") {                                // composable diamond grill: a row of iced teeth
      const base = mesh(GG.box, m.silver, 0.14, 0.04, 0.06); base.position.y = 0.028; grp.add(base);
      for (let i = -2; i <= 2; i++) { const t = mesh(GG.tile, m.glint); t.position.set(i * 0.026, 0.055, 0.022); grp.add(t); }
    } else if (kind === "Diamond Necklace") {
      const b = mesh(GG.bust, m.velvet); b.position.y = 0.12;
      const c = mesh(GG.link, m.gold, 0.85); c.rotation.x = Math.PI / 2 - 0.35; c.position.y = 0.17;
      const p = mesh(GG.gem, m.ice, 0.8); p.position.set(0, 0.1, 0.075);
      grp.add(b); grp.add(c); grp.add(p);
    } else if (kind === "Diamond Tiara") {
      const c = mesh(GG.link, m.silver, 1.1); c.rotation.x = Math.PI / 2; c.position.y = 0.02;
      for (let i = -1; i <= 1; i++) { const gm = mesh(GG.gem, m.ice, 0.7 + (i === 0 ? 0.35 : 0)); gm.position.set(i * 0.07, 0.055 + (i === 0 ? 0.02 : 0), 0.08); grp.add(gm); }
      grp.add(c);
    } else {  // rings: the Engagement Ring (the $5M vault rock) + any other loot ring
      const big = kind === "Engagement Ring";
      const r = mesh(GG.ring, big ? m.silver : m.gold, big ? 1.2 : 1);
      const gm = mesh(GG.gem, big ? m.glint : m.ice, big ? 1.6 : 0.8); gm.position.y = big ? 0.1 : 0.075;
      grp.add(r); grp.add(gm);
    }
    return grp;
  }

  function tagSprite(text, color, sx, sy) {
    if (!CBZ.makeLabelSprite) return null;
    const s = CBZ.makeLabelSprite(text, { color: color || "#ffd166" });
    s.scale.set(sx || 1.6, sy || 0.4, 1);
    return s;
  }

  // ---- build the four cases once per city -----------------------------------
  function buildDisplays() {
    const jw = S.jw, m = mats(), GG = geos();
    const group = new THREE.Group();
    S.group = group;
    const root = (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    root.add(group);
    S.cx = (jw.bounds.minX + jw.bounds.maxX) / 2;
    S.cz = (jw.bounds.minZ + jw.bounds.maxZ) / 2;
    const tx = jw.tx, tz = jw.tz;
    // long side of every case faces the aisle (runs along the wall tangent)
    const gw = Math.abs(tx) * CASE_W + Math.abs(tz) * CASE_D;
    const gd = Math.abs(tz) * CASE_W + Math.abs(tx) * CASE_D;

    jw.cases.forEach((anchor, idx) => {
      const vault = !!anchor.vault;
      // pedestal (solid: you walk AROUND the score, never through it)
      const body = mesh(GG.box, vault ? m.vault : m.body, gw, 0.95, gd);
      body.position.set(anchor.x, 0.475, anchor.z); body.receiveShadow = true;
      group.add(body);
      const rim = mesh(GG.box, m.brass, gw + 0.06, 0.05, gd + 0.06);
      rim.position.set(anchor.x, 0.975, anchor.z);
      group.add(rim);
      const pad = mesh(GG.box, m.velvet, gw - 0.1, 0.05, gd - 0.1);
      pad.position.set(anchor.x, 1.02, anchor.z);
      group.add(pad);
      const glowStrip = mesh(GG.box, m.glow, gw - 0.16, 0.03, gd - 0.16);
      glowStrip.position.set(anchor.x, 1.045, anchor.z);
      group.add(glowStrip);
      // the GLASS TOP — registered as REAL city glass: bullets crack-then-burst
      // it (cityShatterRay), blasts/crashes pop it (cityShatter), a new run
      // re-glazes it (cityGlassReset). No bespoke shatter code at all.
      const pane = CBZ.cityRegisterGlass
        ? CBZ.cityRegisterGlass(group, anchor.x, 1.32, anchor.z, gw - 0.04, 0.52, gd - 0.04, 0, 0, null)
        : null;
      // keep the body solid for walkers (height-gated like showroom panes)
      const col = { minX: anchor.x - gw / 2 - 0.04, maxX: anchor.x + gw / 2 + 0.04,
                    minZ: anchor.z - gd / 2 - 0.04, maxZ: anchor.z + gd / 2 + 0.04, y0: 0, y1: 1.0 };
      if (CBZ.colliders) CBZ.colliders.push(col);

      const cs = { idx, x: anchor.x, z: anchor.z, tier: anchor.tier | 0, vault,
                   pane, pieces: [], smashed: false, charged: false, restockT: 0 };
      // the pieces, spread along the case's long side, each with its sticker.
      // STOCK slots resolve through the econ catalog so name/price/visualId all
      // agree; a slot the catalog can't resolve is simply skipped (never throws).
      const slots = STOCK[Math.min(idx, STOCK.length - 1)] || [];
      const resolved = [];
      for (let s = 0; s < slots.length; s++) { const r = resolvePiece(slots[s]); if (r) resolved.push(r); }
      resolved.forEach((r, i) => {
        const lat = (i - (resolved.length - 1) / 2) * ((CASE_W - 0.35) / Math.max(resolved.length - 1, 1));
        const px = anchor.x + tx * lat, pz = anchor.z + tz * lat;
        const model = buildPiece(r.kind);
        model.position.set(px, 1.07, pz);
        model.rotation.y = Math.atan2(-jw.inx, -jw.inz);   // pieces face the door
        group.add(model);
        // crisp two-line sticker: the NAME up top, the PRICE below (+ a BUY/VAULT
        // accent) — gold for retail, warm amber for the vault crown set.
        const sub = r.buyable ? fmt$(r.value) + "  · BUY" : fmt$(r.value);
        const tag = tagSprite(r.label + " · " + sub, cs.vault ? "#ffe08a" : (r.buyable ? "#bfe6ff" : "#ffd166"), 1.6, 0.36);
        if (tag) { tag.position.set(px, 1.8 + (i % 2) * 0.3, pz); group.add(tag); }
        cs.pieces.push({ name: r.name, label: r.label, value: r.value, drip: r.drip, visualId: r.visualId,
                         buyable: !!r.buyable, model, tag, taken: false,
                         showpiece: !!r.showpiece });   // the rotating $5M exhibit
      });
      S.cases.push(cs);
    });
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }

  // ---- piece/case state ------------------------------------------------------
  function setTaken(p, on) {
    p.taken = !!on;
    if (p.model) p.model.visible = !on;
    if (p.tag) p.tag.visible = false;
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
      note("💎 Fresh ice under new glass at " + S.jw.name + ".", 2.2);
  }

  // ---- the ALARM + the charge (normal wanted flow, no special cop code) ------
  function startAlarm(cs) {
    if (S.alarmT <= 0) {
      note("🚨 ALARM — " + S.jw.name + "! Every head on the block just turned.", 2.2);
      if (CBZ.sfx) CBZ.sfx("alarm");
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
    note("💎 Bought the " + p.label + " — " + fmt$(price) + ". " + dripWord(p.drip) + ". (pawn it later)", 2.6);
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(p.drip >= 20 ? 3 : 1);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }

  // ---- LOUD: scoop a smashed case ---------------------------------------------
  function scoop(cs) {
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
    note("💎 Scooped: " + names.join(" + ") + " — " + fmt$(total) + " in ice.", 2.6);
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(total >= 90000 ? 8 : 3);   // the grab IS the flex
    if (total >= 200000 && CBZ.city && CBZ.city.big) CBZ.city.big("💎 " + fmt$(total) + " SMASH-AND-GRAB!");
    caseEmptied(cs);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // ---- QUIET: the slow pry ----------------------------------------------------
  function startPry(cs) {
    const P = CBZ.player;
    S.pry = { cs, t: 0, px: P.pos.x, pz: P.pos.z };
    note("🤫 Working the lock — stay still, stay quiet…", 1.4);
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
    setTaken(best, true);
    e.add(best.name, 1);
    if (CBZ.sfx) CBZ.sfx("coin");
    note("🤫 Slipped the " + best.name + " (" + fmt$(best.value) + ") out clean — no alarm.", 2.4);
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(best.value >= 90000 ? 6 : 2);
    if (piecesLeft(cs) === 0) caseEmptied(cs);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    // every pull risks the clerk turning around mid-lift
    const v = S.lot.building && S.lot.building.vendor;
    if (v && !v.dead && Math.random() < PRY_RISK) {
      note("👀 The " + (v.name || "Jeweler") + " spun around — you're MADE!", 2.2);
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
      return "<b style='color:#ffd166'>[E]</b> Grab the ice <span style='color:#7f8794'>· " + left + " piece" + (left > 1 ? "s" : "") + " loose in the glass</span>";
    if (left === 0)
      return "<span style='color:#7f8794'>Cleaned out — the insurance re-stock is coming.</span>";
    if (S.pry && S.pry.cs === cs)
      return "<span style='color:#9fe0ff'>Prying… " + Math.round(100 * S.pry.t / PRY_TIME) + "%</span> <span style='color:#7f8794'>· don't move</span>";
    // OPEN-STORE BUY: clerk posted + intact case + a buyable piece in your aim →
    // pay the counter and it goes ON YOU (then pawn it later). The WHY hint says
    // it: a wearable asset. (If you'd rather take it, the glass is right there.)
    const buy = buyTarget(cs);
    if (buy) {
      const can = affordPrice() >= (buy.value | 0);
      const why = "<span style='color:#7f8794'>· " + dripWord(buy.drip) + " · pawn it later</span>";
      if (can)
        return "<b style='color:#9be37a'>[E]</b> Buy the " + buy.label + " — <b style='color:#ffd166'>" + fmt$(buy.value) + "</b> " + why;
      return "<span style='color:#ff9e9e'>" + buy.label + " — " + fmt$(buy.value) + "</span> <span style='color:#7f8794'>· short on cash + bank · the glass, though…</span>";
    }
    if (pryEligible(cs))
      return "<b style='color:#9fe0ff'>[E]</b> Pry the case <span style='color:#7f8794'>· slow + silent · one piece · the clerk might turn</span>";
    if (!isNight())
      return "<span style='color:#7f8794'>Locked case — too many eyes in daylight. The glass, though…</span>";
    return "<span style='color:#ff9e9e'>The " + clerkName() + " is watching this case.</span> <span style='color:#7f8794'>· the glass, though…</span>";
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
      S.alarmT -= dt; S.beepT -= dt;
      if (S.beepT <= 0) { if (CBZ.sfx) CBZ.sfx("alarm"); S.beepT = 1.6; }
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
      if (moved || away) cancelPry("The pry slipped — you moved.");
      else if ((cs.pane && cs.pane.shattered) || piecesLeft(cs) === 0) cancelPry();
      else {
        pr.t += dt;
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
    if (CBZ.cityShatter) CBZ.cityShatter(cs.x, cs.z, 0.8);
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
})();

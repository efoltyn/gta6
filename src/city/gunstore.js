/* ============================================================
   city/gunstore.js — the WALK-IN gun store: the wall IS the menu.

   WHY: the AK shipped with a price in a text menu — but a status gun
   deserves a counter, a wall, and a clerk. Walking into Ammu-Nation,
   SEEING the actual AK hanging behind the register, and walking out
   holding it IS the purchase fantasy; menus are for groceries. So the
   guns lot's existing shell (buildings.js stamps lot.building.gunstore)
   gets the city's real purchasable stock hung as the REAL appearance
   models (CBZ.buildActorWeapon → the same wood-and-steel AK every NPC
   carries), each with a price tag. Walk up, look at the piece, [E] —
   cash leaves, the gun's in your hands with starter rounds, and the
   rack shows a SOLD gap until the restock truck refills it. Pistols
   live under counter glass; ammo crates sell over the counter. The
   clerk is the SAME vendor ped peds.js already posts (so "Rob the
   register" and the counter menu keep working untouched).

   Prices/stock come from cityEcon (buyPrice/stockFor) — ONE source of
   truth, zero duplicated price tables. Perf: built once per city on a
   single group, shared fixture materials, and the whole display is
   visibility-gated by distance so the ~dozen gun models cost nothing
   until you're actually shopping. Mode-gated + headless-guarded.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onUpdate) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  const RESTOCK = 150;       // seconds a SOLD slot stays a gap (the truck's coming)
  const VIS_R = 55;          // display group draws only when you're near the shop
  const RACK_REACH = 6.0;    // long guns are bought ACROSS the counter (real gun-store style)
  const CASE_REACH = 3.0;    // counter glass / ammo crate: walk right up
  const RACK_DOT = 0.60;     // look-cone for the wall (farther away, more central)
  const CASE_DOT = 0.82;     // tighter cone up close so the clerk's E ("Shop here") isn't stolen

  const S = { lot: null, gs: null, group: null, slots: [], built: false,
              cur: null, prompt: null, lastTxt: "", cx: 0, cz: 0,
              arena: null, noLotArena: null };

  function econ() { return CBZ.cityEcon || null; }
  function fmt$(n) { n = Math.round(n || 0); return "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  // ---- shared fixture materials (one each, flagged _shared) ----------------
  let M = null;
  function mats() {
    if (M) return M;
    M = {
      board: new THREE.MeshLambertMaterial({ color: 0x23262c }),                                 // rack pegboard
      glass: new THREE.MeshLambertMaterial({ color: 0xbfe9f7, emissive: 0x3f8aa6, emissiveIntensity: 0.35, transparent: true, opacity: 0.32 }),
      glow: new THREE.MeshLambertMaterial({ color: 0x7ed957, emissive: 0x7ed957, emissiveIntensity: 0.55 }),  // the trade's green accent
      crate: new THREE.MeshLambertMaterial({ color: 0x4a5232 }),                                 // olive ammo crates
    };
    Object.keys(M).forEach((k) => { M[k]._shared = true; });
    return M;
  }

  // the REAL gun model — the exact appearance factory NPCs carry (actorweapons).
  // ITEMS[name].gun is the engine id ("ak47"/"bazooka"/…); buildActorWeapon
  // normalizes the rest (Pistol→sidearm, Rifle→carbine) so the wall never
  // shows a placeholder for a buyable piece.
  function buildModel(name) {
    if (!CBZ.buildActorWeapon) return null;
    const e = econ(), it = e && e.ITEMS[name];
    const m = CBZ.buildActorWeapon((it && it.gun) || name);
    if (!m) return null;
    m.rotation.set(0, 0, 0);
    m.position.set(0, 0, 0);
    return m;
  }

  function tagSprite(text, color, sx, sy) {
    // PROPS_PURPOSE (owner order): NO floating words over shop items — the
    // displays speak for themselves and the walk-up prompt carries the price.
    // Every call site already null-guards (the makeLabelSprite-absent path),
    // so returning null degrades cleanly. Revert: CBZ.CONFIG.PROPS_PURPOSE=false.
    if (!CBZ.CONFIG || CBZ.CONFIG.PROPS_PURPOSE !== false) return null;
    if (!CBZ.makeLabelSprite) return null;
    const s = CBZ.makeLabelSprite(text, { color: color || "#ffd166" });
    s.scale.set(sx || 2.3, sy || 0.55, 1);
    return s;
  }

  // ---- build the displays once per city ------------------------------------
  function buildDisplays() {
    const e = econ(), gs = S.gs, m = mats();
    const group = new THREE.Group();
    S.group = group;
    const root = (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    root.add(group);
    S.cx = (gs.bounds.minX + gs.bounds.maxX) / 2;
    S.cz = (gs.bounds.minZ + gs.bounds.maxZ) / 2;

    // partition the shop's REAL stock: long guns → the back wall, pistols →
    // the counter glass. (Melee/armor/grenades stay the clerk's counter menu.)
    const stock = e.stockFor("guns");
    const longs = [], pistols = [];
    for (const n of stock) {
      const it = e.ITEMS[n];
      if (!it || !it.gun) continue;
      const model = buildModel(n);
      if (!model) continue;
      const slot = { name: n, model, sold: false, restockT: 0, tag: null, soldTag: null, x: 0, y: 0, z: 0, reach: 3, dot: CASE_DOT };
      if (model.userData && model.userData.weaponSlot === "long") longs.push(slot); else pistols.push(slot);
    }

    // ---- THE BACK-WALL RACK (behind the clerk; buy across the counter) ----
    const R = gs.rack;
    const perRow = Math.max(2, Math.min(5, Math.floor(R.span / 2.0)));
    const rows = Math.max(1, Math.ceil(longs.length / perRow));
    const boardH = 0.55 + rows * 0.95;
    const bw = Math.abs(R.tx) * (R.span + 0.6) + Math.abs(R.nx) * 0.12;
    const bd = Math.abs(R.tz) * (R.span + 0.6) + Math.abs(R.nz) * 0.12;
    const yTop = 2.55;
    const board = new THREE.Mesh(new THREE.BoxGeometry(bw, boardH, bd), m.board);
    board.position.set(R.x, yTop + 0.5 - boardH / 2, R.z);   // board top just over the top row
    board.castShadow = false; board.receiveShadow = true;
    group.add(board);
    // the green ARMORY strip over the rack (the trade accent — reads from the door)
    const strip = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.98 + Math.abs(R.nx) * 0.02, 0.08, bd * 0.98 + Math.abs(R.nz) * 0.02), m.glow);
    strip.position.set(R.x + R.nx * 0.02, yTop + 0.62, R.z + R.nz * 0.02);
    strip.castShadow = false;
    group.add(strip);

    longs.forEach((s, i) => {
      const row = (i / perRow) | 0;
      const inRow = Math.min(perRow, longs.length - row * perRow);
      const col = i - row * perRow;
      const lat = (col - (inRow - 1) / 2) * (R.span / Math.max(inRow, 1));
      const y = yTop - row * 0.95;
      const x = R.x + R.nx * 0.22 + R.tx * lat;
      const z = R.z + R.nz * 0.22 + R.tz * lat;
      // barrel lies ALONG the wall; origin is the grip, so re-centre the silhouette
      s.model.rotation.y = Math.atan2(-R.tx, -R.tz);
      s.model.scale.setScalar(0.95);
      s.model.position.set(x - R.tx * 0.38, y, z - R.tz * 0.38);
      group.add(s.model);
      s.x = x; s.y = y; s.z = z; s.reach = RACK_REACH; s.dot = RACK_DOT;
      s.tag = tagSprite(s.name + " · " + fmt$(e.buyPrice(s.name)), "#ffd166");
      if (s.tag) { s.tag.position.set(x + R.nx * 0.12, y - 0.44, z + R.nz * 0.12); group.add(s.tag); }
      S.slots.push(s);
    });

    // ---- THE COUNTER GLASS CASE (pistols, shifted off the register half so
    //      [E] at the case never collides with the clerk's "Shop here") ----
    const C = gs.counter;
    const longLen = Math.max(C.w, C.d);
    const caseLen = Math.max(1.4, Math.min(2.6, longLen * 0.45));
    const caseW = Math.min(0.72, Math.min(C.w, C.d));
    const caseOff = Math.max(0, longLen / 2 - caseLen / 2 - 0.25);   // toward the + tangent end
    const ccx = C.x + C.tx * caseOff, ccz = C.z + C.tz * caseOff;
    const gw = Math.abs(C.tx) * caseLen + Math.abs(C.tz) * caseW;
    const gd = Math.abs(C.tz) * caseLen + Math.abs(C.tx) * caseW;
    const caseMesh = new THREE.Mesh(new THREE.BoxGeometry(gw, 0.36, gd), m.glass);
    caseMesh.position.set(ccx, C.top + 0.18, ccz);
    caseMesh.castShadow = false;
    group.add(caseMesh);
    const underGlow = new THREE.Mesh(new THREE.BoxGeometry(gw * 0.94, 0.04, gd * 0.94), m.glow);
    underGlow.position.set(ccx, C.top + 0.03, ccz);
    underGlow.castShadow = false;
    group.add(underGlow);

    pistols.forEach((s, i) => {
      const lat = (i - (pistols.length - 1) / 2) * (caseLen / Math.max(pistols.length, 1));
      const x = ccx + C.tx * lat, z = ccz + C.tz * lat;
      const y = C.top + 0.15;
      s.model.rotation.y = Math.atan2(-C.tx, -C.tz);
      s.model.position.set(x - C.tx * 0.1, y, z - C.tz * 0.1);
      group.add(s.model);
      s.x = x; s.y = y; s.z = z; s.reach = CASE_REACH; s.dot = CASE_DOT;
      s.tag = tagSprite(s.name + " · " + fmt$(e.buyPrice(s.name)), "#ffd166", 1.7, 0.42);
      if (s.tag) { s.tag.position.set(x, C.top + 0.66, z); group.add(s.tag); }
      S.slots.push(s);
    });

    // ---- AMMO CRATES at the case end of the counter (always stocked) ----
    const ax = C.x + C.tx * (longLen / 2 + 0.55), az = C.z + C.tz * (longLen / 2 + 0.55);
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.62), m.crate);
    c1.position.set(ax, 0.21, az); c1.castShadow = false;
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.5), m.crate);
    c2.position.set(ax, 0.59, az); c2.castShadow = false;
    group.add(c1); group.add(c2);
    const ammoMeta = e.ITEMS["Ammo Box"] || {};
    const ammo = { name: "Ammo Box", ammo: true, sold: false, x: ax, y: 0.7, z: az, reach: CASE_REACH, dot: CASE_DOT };
    ammo.tag = tagSprite("Ammo Box · " + fmt$(e.buyPrice("Ammo Box")), "#9fe0ff", 1.7, 0.42);
    if (ammo.tag) { ammo.tag.position.set(ax, 1.15, az); group.add(ammo.tag); }
    S.slots.push(ammo);

    // ---- THE ARMOR RACK (a mannequin row at the OTHER end of the counter) ----
    // WHY: a gun store IS where you walk in unarmored and walk out plated — the
    // non-violent path to body armor (the violent path: peel a SWAT vest off a
    // corpse). Kits come from armor.js (CBZ.ARMOR_KITS); equipping routes through
    // CBZ.cityEquipArmor. swatVest is OMITTED on purpose — police issue, LOOT-ONLY.
    buildArmorRack(group, m, C, longLen);

    // ---- THE DEMOLITION END (past the ammo crates): a frag crate + a C4
    //      satchel. Consumables sold by COUNT exactly like the Ammo Box —
    //      the throw lives in city/combat.js ([G]) and the plant/detonate in
    //      city/explosives.js ([B]); the store just moves the product. ----
    if (e.ITEMS["Grenade"]) {
      const fx = C.x + C.tx * (longLen / 2 + 1.35), fz = C.z + C.tz * (longLen / 2 + 1.35);
      const fc = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.38, 0.56), m.crate);
      fc.position.set(fx, 0.19, fz); fc.castShadow = false;
      group.add(fc);
      if (CBZ.grenadeMesh) for (let i = 0; i < 3; i++) {   // a few frags nested in the straw
        const gm = CBZ.grenadeMesh(THREE);
        if (!gm) break;
        gm.position.set(fx + (i - 1) * 0.15, 0.42, fz + (Math.random() - 0.5) * 0.12);
        group.add(gm);
      }
      const gren = { name: "Grenade", boom: true, sold: false, x: fx, y: 0.5, z: fz, reach: CASE_REACH, dot: CASE_DOT };
      gren.tag = tagSprite("Frag Crate · " + fmt$(e.buyPrice("Grenade")), "#ff9e6a", 1.7, 0.42);
      if (gren.tag) { gren.tag.position.set(fx, 0.95, fz); group.add(gren.tag); }
      S.slots.push(gren);
    }
    if (e.ITEMS["C4 Charge"]) {   // registered by explosives.js — guard for safety
      const bx = C.x + C.tx * (longLen / 2 + 2.1), bz = C.z + C.tz * (longLen / 2 + 2.1);
      const bc = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), m.crate);
      bc.position.set(bx, 0.15, bz); bc.castShadow = false;
      group.add(bc);
      if (CBZ.cityC4Mesh) {   // the real charge model on the lid (shared geo/mats)
        const cm = CBZ.cityC4Mesh();
        if (cm) { cm.position.set(bx, 0.36, bz); cm.rotation.y = Math.random() * 6.28; group.add(cm); }
      }
      const c4 = { name: "C4 Charge", boom: true, sold: false, x: bx, y: 0.42, z: bz, reach: CASE_REACH, dot: CASE_DOT };
      c4.tag = tagSprite("C4 Charge · " + fmt$(e.buyPrice("C4 Charge")), "#ff6a6a", 1.7, 0.42);
      if (c4.tag) { c4.tag.position.set(bx, 0.92, bz); group.add(c4.tag); }
      S.slots.push(c4);
    }

    // ---- THE GUNSMITH BENCH: walk up, [E], and fit the gun in your hands with
    //      scopes / bigger mags / a suppressor / grips (city/gunmods.js owns the
    //      catalog + the menu; this is just the in-world workbench you approach).
    //      Placed toward the store interior (customer side) so it's always
    //      reachable inside the browse apron. ----
    if (CBZ.gunModsOpenBench) {
      let inx = S.cx - C.x, inz = S.cz - C.z; const il = Math.hypot(inx, inz) || 1; inx /= il; inz /= il;
      const wx = C.x + C.tx * (longLen * 0.28) + inx * 1.6;
      const wz = C.z + C.tz * (longLen * 0.28) + inz * 1.6;
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.12, 0.7), m.board);
      top.position.set(wx, 0.92, wz); top.castShadow = false; group.add(top);
      const legGeo = new THREE.BoxGeometry(0.08, 0.86, 0.08);
      [[-0.42, -0.28], [0.42, -0.28], [-0.42, 0.28], [0.42, 0.28]].forEach((o) => {
        const lg = new THREE.Mesh(legGeo, m.board); lg.position.set(wx + o[0], 0.43, wz + o[1]); lg.castShadow = false; group.add(lg);
      });
      const vise = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.16), m.glow);
      vise.position.set(wx, 1.06, wz); vise.castShadow = false; group.add(vise);
      const bench = { name: "Gunsmith Bench", mod: true, sold: false, x: wx, y: 1.06, z: wz, reach: CASE_REACH + 0.6, dot: CASE_DOT - 0.08 };
      bench.tag = tagSprite("🔧 Gunsmith Bench · scopes · mags · silencer", "#7ed957", 3.2, 0.52);
      if (bench.tag) { bench.tag.position.set(wx, 1.55, wz); group.add(bench.tag); }
      S.slots.push(bench);
    }
  }

  // which kits the store SELLS, in display order. swatVest is intentionally NOT
  // here — it's police issue, taken off a dead SWAT (the loot-only why). Prices
  // come from cityEcon if the kit name is registered there; else a sane default.
  const ARMOR_FOR_SALE = [
    { kit: "softVest",     label: "Kevlar Vest",    price: 450,  color: "#9fe0ff" },
    { kit: "plateCarrier", label: "Plate Carrier",  price: 2400, color: "#ffd166" },
    { kit: "helmet",       label: "Combat Helmet",  price: 600,  color: "#9fe0ff" },
  ];
  function armorKit(id) { return (CBZ.ARMOR_KITS && CBZ.ARMOR_KITS[id]) || null; }
  function armorPrice(spec) {
    const e = econ();
    const kit = armorKit(spec.kit);
    if (kit && (kit.price | 0) > 0) return kit.price | 0;                 // kit may carry its own price
    if (e && e.ITEMS && e.ITEMS[spec.label] && e.buyPrice) { const p = e.buyPrice(spec.label); if (p) return p; }
    return spec.price;
  }

  // a small armored-mannequin row past the ammo crates (counter's far + tangent
  // end). Each kit that actually EXISTS in CBZ.ARMOR_KITS gets a torso block +
  // (for the helmet) a head dome + a price tag; missing kits are skipped so the
  // store degrades gracefully if armor.js never loaded.
  function buildArmorRack(group, m, C, longLen) {
    const kits = CBZ.ARMOR_KITS;
    if (!kits) return;                                       // armor.js absent — no rack, no crash
    const sells = ARMOR_FOR_SALE.filter((sp) => armorKit(sp.kit));
    if (!sells.length) return;
    // mannequins sit at the - tangent end (ammo/explosives took the + end)
    const baseOff = -(longLen / 2 + 0.7);
    const vestMat = m.armorVest || (m.armorVest = (function () {
      const mm = new THREE.MeshLambertMaterial({ color: 0x2c3340 }); mm._shared = true; return mm;
    })());
    sells.forEach((sp, i) => {
      const off = baseOff - i * 0.9;
      const x = C.x + C.tx * off, z = C.z + C.tz * off;
      const isHelmet = (armorKit(sp.kit) || {}).slot === "helmet" || sp.kit === "helmet";
      // a stubby torso plate; the helmet kit gets a dome on a short post instead
      if (isHelmet) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), m.board);
        post.position.set(x, 0.45, z); post.castShadow = false; group.add(post);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.7), vestMat);
        dome.position.set(x, 1.02, z); dome.castShadow = false; group.add(dome);
      } else {
        const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.78, 0.32), vestMat);
        torso.position.set(x, 0.95, z); torso.castShadow = false; group.add(torso);
        const stand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 0.1), m.board);
        stand.position.set(x, 0.3, z); stand.castShadow = false; group.add(stand);
      }
      const slot = { name: sp.label, armor: true, kit: sp.kit, price: sp.price,
                     sold: false, x: x, y: isHelmet ? 1.02 : 0.95, z: z, reach: CASE_REACH, dot: CASE_DOT };
      const price = armorPrice(sp);
      slot.tag = tagSprite(sp.label + " · " + fmt$(price), sp.color, 1.9, 0.44);
      if (slot.tag) { slot.tag.position.set(x, (isHelmet ? 1.5 : 1.55), z); group.add(slot.tag); }
      S.slots.push(slot);
    });
  }

  // ---- SOLD gap / restock ----------------------------------------------------
  function setSold(s, on) {
    s.sold = !!on;
    if (s.model) s.model.visible = !on;
    if (s.tag) s.tag.visible = false;
    if (on) {
      if (!s.soldTag) {
        s.soldTag = tagSprite("SOLD — restock soon", "#ff7a7a", 2.0, 0.5);
        if (s.soldTag) { s.soldTag.position.set(s.tag ? s.tag.position.x : s.x, s.tag ? s.tag.position.y : s.y, s.tag ? s.tag.position.z : s.z); S.group.add(s.soldTag); }
      } else s.soldTag.visible = true;
      s.restockT = RESTOCK * (0.8 + Math.random() * 0.5);
    } else if (s.soldTag) s.soldTag.visible = false;
  }

  // ---- buying ----------------------------------------------------------------
  function buySlot(s) {
    const e = econ();
    if (!s || !e || !CBZ.city) return;
    if (s.mod) { if (CBZ.gunModsOpenBench) CBZ.gunModsOpenBench(); return; }   // open the gunsmith menu
    if (s.ammo) {
      const meta = e.ITEMS["Ammo Box"] || {}, price = e.buyPrice("Ammo Box");
      if (!CBZ.city.spend(price)) { CBZ.city.note("Ammo runs " + fmt$(price) + " a box.", 1.6); if (CBZ.sfx) CBZ.sfx("glass"); return; }
      if (CBZ.cityAddAmmo) CBZ.cityAddAmmo(meta.rounds || 60);
      if (CBZ.sfx) CBZ.sfx("coin");
      CBZ.city.note("+" + (meta.rounds || 60) + " rounds over the counter.", 1.6);
      return;
    }
    // ARMOR: a kit off the rack. Charge, then route through armor.js's equip
    // (sets the player's armor bar + mesh). Never "sells out" — you can re-buy
    // to top your plate back up after it's been shot off. swatVest isn't here.
    if (s.armor) {
      if (!CBZ.cityEquipArmor) { CBZ.city.note("Body armor's not stocked right now.", 1.8); if (CBZ.sfx) CBZ.sfx("glass"); return; }
      const price = armorPrice({ kit: s.kit, label: s.name, price: s.price });
      if (!CBZ.city.spend(price)) { CBZ.city.note("The " + s.name + " runs " + fmt$(price) + " — come back with the money.", 2); if (CBZ.sfx) CBZ.sfx("glass"); return; }
      CBZ.cityEquipArmor(s.kit);
      if (CBZ.sfx) CBZ.sfx("coin");
      CBZ.city.note("Strapped on the " + s.name + " for " + fmt$(price) + " — you're plated up.", 2.2);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      return;
    }
    // explosive consumables: bought by COUNT, never sell out (crates restock
    // off-screen). Counts mirror to g.cityGrenades / g.cityC4 for HUD readers.
    if (s.boom) {
      const price = e.buyPrice(s.name);
      if (!CBZ.city.spend(price)) { CBZ.city.note("The " + s.name + " runs " + fmt$(price) + " — come back with the money.", 2); if (CBZ.sfx) CBZ.sfx("glass"); return; }
      e.add(s.name, 1);
      const n = e.count ? e.count(s.name) : 0;
      if (s.name === "Grenade") g.cityGrenades = n;
      if (s.name === "C4 Charge") g.cityC4 = n;
      if (CBZ.sfx) CBZ.sfx("coin");
      CBZ.city.note(s.name === "C4 Charge"
        ? "C4 in the bag (" + n + " carried) — [B] plants it, hold [B] to send the signal."
        : "Frag in the bag (" + n + " carried) — [G] throws it.", 2.4);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      return;
    }
    if (s.sold) { CBZ.city.note("That slot's sold out — restock truck's rolling.", 1.8); return; }
    const meta = e.ITEMS[s.name];
    if (!meta) return;
    const price = e.buyPrice(s.name);   // the SAME price the counter menu reads
    if (!CBZ.city.spend(price)) {
      CBZ.city.note("The " + s.name + " runs " + fmt$(price) + " — come back with the money.", 2);
      if (CBZ.sfx) CBZ.sfx("glass");
      return;
    }
    e.add(s.name, 1);
    if (CBZ.cityGiveWeapon) CBZ.cityGiveWeapon(s.name);
    // starter ammo: two mags so the piece leaves the store LOADED (launchers
    // get a spare rocket) — small enough next to the sticker price to never
    // beat the $60 ammo box as an economy exploit.
    const rounds = Math.max(2, (meta.ammo | 0) * 2);
    if (CBZ.cityAddAmmo) CBZ.cityAddAmmo(rounds);
    setSold(s, true);
    if (CBZ.sfx) CBZ.sfx("coin");
    if (CBZ.city.addRespect) CBZ.city.addRespect(price >= 3000 ? 3 : 1);   // walking out heavy IS the flex
    if (price >= 3000 && CBZ.city.big) CBZ.city.big("🔫 " + s.name + " — straight off the wall!");
    CBZ.city.note("Bought the " + s.name + " for " + fmt$(price) + " (+" + rounds + " starter rounds).", 2.2);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // ---- the look-pick + [E] prompt --------------------------------------------
  function pickSlot() {
    const P = CBZ.player, B = S.gs.bounds;
    const px = P.pos.x, pz = P.pos.z;
    // browse gate: only while you're actually IN the store (small apron at the door)
    if (px < B.minX - 1.5 || px > B.maxX + 1.5 || pz < B.minZ - 1.5 || pz > B.maxZ + 1.5) return null;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best = null, bestScore = -1;
    for (const s of S.slots) {
      const dx = s.x - px, dz = s.z - pz, d = Math.hypot(dx, dz);
      if (d > (s.reach || 3) || d < 0.05) continue;
      const dot = (dx / d) * fx + (dz / d) * fz;
      if (dot < (s.dot || CASE_DOT)) continue;          // you buy the one you're LOOKING at
      const score = dot - d * 0.06;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  function promptText(s) {
    const e = econ();
    if (s.mod) return "<b style='color:#ffd166'>[E]</b> Gunsmith Bench — <span style='color:#7ed957'>fit scopes · bigger mags · silencer · grips</span>";
    if (s.ammo) {
      const meta = e.ITEMS["Ammo Box"] || {};
      return "<b style='color:#ffd166'>[E]</b> Ammo Box — <span style='color:#7ed957'>" + fmt$(e.buyPrice("Ammo Box")) + "</span> <span style='color:#7f8794'>· +" + (meta.rounds || 60) + " rounds</span>";
    }
    if (s.boom) {
      const use = s.name === "C4 Charge" ? "remote det · [B] plant, hold [B] boom" : "frag · [G] throws it";
      return "<b style='color:#ffd166'>[E]</b> Buy " + s.name + " — <span style='color:#7ed957'>" + fmt$(e.buyPrice(s.name)) + "</span> <span style='color:#7f8794'>· " + use + "</span>";
    }
    if (s.armor) {
      const kit = armorKit(s.kit) || {};
      const price = armorPrice({ kit: s.kit, label: s.name, price: s.price });
      const stats = ((kit.pts | 0) > 0 ? "+" + kit.pts + " armor" : "body armor") + (kit.slot === "helmet" ? " · head" : "");
      return "<b style='color:#ffd166'>[E]</b> Equip " + s.name + " — <span style='color:#7ed957'>" + fmt$(price) + "</span> <span style='color:#7f8794'>· " + stats + "</span>";
    }
    if (s.sold) return "<span style='color:#ff9e9e'>" + s.name + " — SOLD</span> <span style='color:#7f8794'>· restock truck's rolling</span>";
    const meta = e.ITEMS[s.name] || {};
    const price = e.buyPrice(s.name);
    const stats = ((meta.dmg | 0) > 1 ? meta.dmg + " dmg" : "explosive") + (meta.ammo ? " · " + meta.ammo + "-rd mag" : "");
    return "<b style='color:#ffd166'>[E]</b> Buy " + s.name + " — <span style='color:#7ed957'>" + fmt$(price) + "</span> <span style='color:#7f8794'>· " + stats + "</span>";
  }

  function promptEl() {
    if (S.prompt) return S.prompt;
    if (typeof document === "undefined" || !document.body) return null;
    const d = document.createElement("div");
    d.id = "gunstorePrompt";
    d.style.cssText = "position:fixed;left:50%;bottom:150px;transform:translateX(-50%);z-index:46;display:none;" +
      "background:rgba(13,16,21,.9);border:1px solid #3a4150;border-radius:12px;padding:7px 14px;color:#e8eef7;" +
      "font-family:Fredoka,system-ui,sans-serif;font-size:15px;pointer-events:auto;cursor:pointer;text-align:center;max-width:78vw";
    d.addEventListener("click", function () { if (S.cur) buySlot(S.cur); });   // tap-to-buy (mobile)
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

  // ---- find the lot + build once (self-healing, clubLot pattern) -------------
  // PERF: the fallback lot scan is O(all lots) — fine ONCE, but this runs from a
  // per-frame updater, so a city with no gun-store lot must not rescan forever.
  // The gunstore stamp + arena.gunShopLot land synchronously at build
  // (buildings.js), so one failed scan per arena is a true answer — remember it.
  // An arena REBUILD (new run) also invalidates a previously-built wall: the old
  // display group died with the old root, so tear down and rebuild on the new one.
  function ensure() {
    const arena = CBZ.city && CBZ.city.arena;
    if (S.built) {
      if (S.arena === arena) return true;
      S.built = false; S.group = null; S.slots = []; S.cur = null; S.lot = null; S.gs = null;
    }
    if (!arena || !econ() || !CBZ.buildActorWeapon) return false;
    if (S.noLotArena === arena) return false;          // this city has no gun wall — answered once
    let lot = arena.gunShopLot || null;
    if (!(lot && lot.building && lot.building.gunstore)) {
      lot = null;
      const lots = arena.lots || [];
      for (let i = 0; i < lots.length; i++) { const L = lots[i]; if (L && L.building && L.building.gunstore) { lot = L; break; } }
      if (!lot && lots.length) { S.noLotArena = arena; return false; }
    }
    if (!lot) return false;
    S.lot = lot; S.gs = lot.building.gunstore; S.arena = arena;
    buildDisplays();
    S.built = true;
    return true;
  }

  // ---- per-frame --------------------------------------------------------------
  CBZ.onUpdate(37, function (dt) {
    if (!g || g.mode !== "city") { if (S.group && S.group.visible) S.group.visible = false; hidePrompt(); return; }
    if (!ensure()) return;
    // restock timers keep ticking — the street keeps moving while you're away
    for (const s of S.slots) {
      if (!s.sold) continue;
      s.restockT -= dt;
      if (s.restockT <= 0) {
        setSold(s, false);
        const P = CBZ.player;
        if (P && CBZ.city && Math.hypot(P.pos.x - s.x, P.pos.z - s.z) < 30)
          CBZ.city.note("🚚 Fresh steel on the rack — the " + s.name + " is back in stock.", 2.2);
      }
    }
    // distance VIS-GATE: the dozen display models draw only when you're near
    const P = CBZ.player;
    const dx = P.pos.x - S.cx, dz = P.pos.z - S.cz;
    const near = (dx * dx + dz * dz) < VIS_R * VIS_R;
    if (S.group && S.group.visible !== near) S.group.visible = near;
    if (!near || g.state !== "playing" || P.dead || P.driving || CBZ.cityMenuOpen) { hidePrompt(); return; }
    const s = pickSlot();
    if (!s) { hidePrompt(); return; }
    S.cur = s;
    showPrompt(promptText(s));
  });

  // [E] buys the piece you're looking at. CAPTURE phase so the wall wins the
  // key over interact.js's bubble listener; stopImmediatePropagation keeps a
  // single press from ALSO opening the clerk's counter menu.
  addEventListener("keydown", function (e) {
    if (!S.cur || !g || g.mode !== "city" || g.state !== "playing") return;
    if (CBZ.cityMenuOpen || (CBZ.player && (CBZ.player.driving || CBZ.player.dead))) return;
    if ((e.key || "").toLowerCase() !== "e") return;
    e.preventDefault();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    e.stopPropagation();
    buySlot(S.cur);
  }, true);

  // ---- public hooks -------------------------------------------------------------
  // is the wall live (for this lot)? shops.js trims firearms off the counter
  // menu when it is, so the wall is the ONE way to buy a gun here.
  CBZ.cityGunWallLive = function (lot) { return !!(S.built && S.lot && (!lot || lot === S.lot)); };
  // headless/harness handle: buy a named display off the wall ("AK-47", "Ammo Box")
  CBZ.cityGunstoreBuy = function (name) {
    if (!ensure()) return false;
    const s = S.slots.find((x) => x.name === name);
    if (!s) return false;
    buySlot(s);
    return true;
  };
  CBZ.cityGunstoreLot = function () { return (S.built && S.lot) || null; };
})();

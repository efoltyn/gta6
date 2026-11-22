/* ============================================================
   city/realestate.js — A HOUSE YOU BUY, AS A PLACE.

   OWNER: "Improve the logic to buy a house." and "No dashboards are needed.
   Everything can be existing in the world."

   The deeds, the prices and the mortgages are city/zillow.js's ledger. The
   FOR SALE sign in the yard is city/plots.js's. This file is everything a
   house IS once those two exist, and there is no menu in it:

   THE DOOR. A house on the market is locked. The sign in its yard has a
   lockbox: take the key (E at the sign) and the front door, and every room
   door behind it, opens for you while you look round. Buy it and the key
   is yours for good (a real key in your pockets, city/keys.js); your crew
   and your tenants walk in and out, nobody else does.

   THE AGENT. Keystone Realty's keeper is a person with a book of houses.
   Ask him and he tells you one, out loud: what it is, where it is, what it
   costs. Dearer / Cheaper turns the page; See it puts the key in your hand
   and the house on your map; Buy closes it there and then; Finance and Rent
   are on his wheel. He is the one who sells the penthouse its hangar.

   THE HOUSE, WHEN IT IS YOURS. Each thing in its own place in the house's
   floor plan (city/house_plan.js spot(): the house says where), solid:
     the safe      in the main bedroom's closet (the study, in a house with
                   one). Cash goes in and comes out by hand (and the duffels
                   city/cashstore.js always kept there)
     the gun rack  on a wall the house keeps clear for it. The gun in your
                   hands goes on a peg, where you can see it; take one down
                   and it is in your hands
     the wardrobe  the main bedroom's own. Change into the next thing you own
   A flat in a tower has them in the flat, on its own floor, by its bed.
   WHAT YOU OWN, AT THE AGENT. He sells a place for you (it is also sold by
   standing its FOR SALE sign back up: city/plots.js) and takes what the bank
   is owed on it; so does the bank's own counter.
   The bed is the house's own bed (city/propuse.js): sleeping in a bed you
   own is the full night (healed, fed, rested, wounds dressed, the heat off
   you) and makes that house the one you wake up in.
   The car is in the drive. Leave a car you own on your driveway and it is
   there when you come back, today or after a reload; drive it away and the
   drive is empty. Nothing is "stored" and nothing is "retrieved".

   (This file used to be two screens: the realtor's numbered list of five
   homes, and a "safehouse menu" on your own front door with Sleep, Deposit,
   Store car and Pull car as rows. Both are deleted, with the rented room
   that had no room.)

   Exposes: CBZ.cityHome { isHouse, hasKey, view, buy, sold, spot, stash,
   cars, market }, CBZ.cityHomeSpot, CBZ.cityHomeKey, CBZ.cityHomeSlept,
   CBZ.cityRealtyLive, CBZ.cityHomeMenu (the shop counter's "Homes" row: the
   agent starts talking), CBZ.cityHomeSerialize / cityHomeRestore /
   cityRealEstateReset (city/worldstate.js's save seam, unchanged).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const C = () => CBZ.CITY || {};

  function money(n) { n = Math.round(+n); if (!isFinite(n)) n = 0; return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US"); }
  function Z() { return CBZ.cityZillow || null; }
  function arena() { return CBZ.city && CBZ.city.arena; }
  function inCity() { return g && g.mode === "city"; }
  function sfx(n) { if (CBZ.sfx) { try { CBZ.sfx(n); } catch (e) {} } }
  function say(p, line, secs) {
    if (!p || p.dead || !line || !CBZ.citySay) return false;
    try { return !!CBZ.citySay(p, line, "#ffffff", secs || 3.2); } catch (e) { return false; }
  }
  function pick(a, salt) { return a[Math.abs((salt | 0)) % a.length]; }
  let T = 0;                                    // this file's clock, seconds

  /* ---- THE LOT ---------------------------------------------------------------
     Everything is read off the lot record: its key, whether it is a house,
     which way it faces. No coordinates. */
  function lotKey(lot) { return Math.round(lot.cx) + "," + Math.round(lot.cz); }
  function homeOf(lot) { return lot && lot.building && lot.building.home; }
  // one household behind one front door (a town house, a street house): that
  // door is the home's door. A tower's street door is a lobby everybody uses.
  function isHouse(lot) {
    const b = lot && lot.building;
    if (!b || !b.home || lot.demolished) return false;
    return lot.kind === "home" || b.name === "House" || (b.storeys | 0) <= 2;
  }
  function owns(lot) { return !!(CBZ.cityOwnsLot && CBZ.cityOwnsLot(lot)); }
  function renting(lot) { const z = Z(); return !!(z && z.isRentingLot && z.isRentingLot(lot)); }
  function nameOf(lot) { const z = Z(); return (z && z.nameOfLot && z.nameOfLot(lot)) || (lot.building && lot.building.name) || "the house"; }
  function addressOf(lot) { const z = Z(), rec = z && z.listingForLot ? z.listingForLot(lot) : null; return (rec && rec.address) || ""; }
  function rectOf(lot) {
    const b = lot.building || {};
    const cx = b.ox != null ? b.ox : (b.x != null ? b.x : lot.cx), cz = b.oz != null ? b.oz : (b.z != null ? b.z : lot.cz);
    return { cx: cx, cz: cz, hw: (b.w || lot.w || 16) / 2, hd: (b.d || lot.d || 16) / 2 };
  }
  // the front wall at the door: out of the house (ox, oz), along the wall
  // (tx, tz). city/playergang.js publishes the same read; this is it again
  // only because this file loads first.
  function front(lot) {
    if (CBZ.cityLotFront) return CBZ.cityLotFront(lot);
    const b = lot && lot.building, d = b && b.door; if (!d) return null;
    const r = rectOf(lot), dx = d.x - r.cx, dz = d.z - r.cz;
    let ox = 0, oz = 0, fx, fz;
    if (Math.abs(dx) / r.hw > Math.abs(dz) / r.hd) { ox = dx < 0 ? -1 : 1; fx = r.cx + ox * r.hw; fz = d.z; }
    else { oz = dz < 0 ? -1 : 1; fx = d.x; fz = r.cz + oz * r.hd; }
    return { x: fx, z: fz, ox: ox, oz: oz, tx: -oz, tz: ox, lot: lot };
  }
  function floorY(x, z) { if (CBZ.floorAt) { try { const y = +CBZ.floorAt(x, z); return isFinite(y) ? y : 0; } catch (e) {} } return 0; }

  /* ============================================================
     1. THE KEY AND THE DOOR
     ============================================================ */
  function keyId(lot) { return "home:" + lotKey(lot); }
  function viewing(lot) { const v = g.cityViewing; return !!(v && v.k === lotKey(lot) && T < v.until); }
  function hasKey(lot) { return !!lot && (owns(lot) || renting(lot) || viewing(lot)); }
  CBZ.cityHomeKey = hasKey;
  // the tag on the key: the house's name, or its street when the name is just
  // "House" (never the street NUMBER: the ledger hashes one until the house
  // is built and reads the real plate after, and a key must not change name)
  function keyLabel(lot) {
    const n = nameOf(lot), street = addressOf(lot).replace(/^\d+\s+/, "");
    const plain = !n || /^(house|apartments)$/i.test(n);
    return "Key to " + (plain ? "the house" + (street ? " on " + street : "") : n + (street ? ", " + street : ""));
  }
  function grantKey(lot) {
    const K = CBZ.cityKeys;
    if (!K || !K.grant) return;
    try { if (!K.has(keyId(lot))) K.grant(keyId(lot), keyLabel(lot)); } catch (e) {}
  }
  function dropKey(lot) { const K = CBZ.cityKeys; if (K && K.take) { try { K.take(keyId(lot)); } catch (e) {} } }
  // the sign's lockbox: the house is open to you for a while
  const VIEW_SECS = 480;
  function view(lot, by) {
    if (!lot || hasKey(lot)) return false;
    g.cityViewing = { k: lotKey(lot), until: T + VIEW_SECS };
    sfx("pickup");
    if (by) say(by, pick(["Here's the key. Have a look round, then come and tell me.", "Take the key. Sign's out front, you can't miss it."], lot.cx + lot.cz));
    if (CBZ.interactions && CBZ.interactions.refresh) { try { CBZ.interactions.refresh(); } catch (e) {} }
    return true;
  }
  // a house on the market keeps its door shut to you until you hold a key
  function lockTick() {
    const A = arena(), P = CBZ.player; if (!A || !P || !P.pos) return;
    for (const lot of A.homeLots || []) {
      const b = lot.building; if (!b || !b.doors || !isHouse(lot)) continue;
      const dx = lot.cx - P.pos.x, dz = lot.cz - P.pos.z;
      if (dx * dx + dz * dz > 120 * 120) continue;
      for (const dr of b.doors) if (dr && !dr._homeLot) { dr._homeLot = lot; dr._playerLock = doorLocked; }
    }
    const v = g.cityViewing;
    if (v && T >= v.until) g.cityViewing = null;
    for (const h of ownedHomes()) if (h.lot && isHouse(h.lot)) grantKey(h.lot);
  }
  function doorLocked(dr) { const lot = dr && dr._homeLot; return !!lot && !lot.demolished && !dr._kicked && !hasKey(lot); }
  // a locked door that is not yours can still be opened the other way: it is
  // loud, it is a burglary, and the door stays broken
  function kickIn(dr) {
    if (!dr || !doorLocked(dr)) return;
    dr._kicked = true; dr.open = true; dr.hold = 2.5;
    sfx("door_open");
    if (CBZ.cityAlarm) { try { CBZ.cityAlarm(dr.wx, dr.wz, 22, 0.7, CBZ.city && CBZ.city.playerActor); } catch (e) {} }
    if (CBZ.cityCrime) { try { CBZ.cityCrime(40, { x: dr.wx, z: dr.wz, type: "burglary" }); } catch (e) {} }
  }
  function lockedDoorAt(px, pz, r) {
    const A = arena(); if (!A) return null;
    let best = null, bd = r * r;
    for (const lot of A.homeLots || []) {
      const b = lot.building; if (!b || !b.doors) continue;
      const dx0 = lot.cx - px, dz0 = lot.cz - pz;
      if (dx0 * dx0 + dz0 * dz0 > 40 * 40) continue;
      for (const dr of b.doors) {
        if (!dr || !dr._playerLock || !doorLocked(dr)) continue;
        const d = (dr.wx - px) * (dr.wx - px) + (dr.wz - pz) * (dr.wz - pz);
        if (d < bd) { bd = d; best = dr; }
      }
    }
    return best;
  }

  /* ============================================================
     2. BUYING IT. One function, whoever you are standing in front of: the
        sign (city/plots.js) or the agent. The money is zillow's to move.
     ============================================================ */
  // (the sign in the yard says SOLD for a minute and comes down: city/plots.js)
  function sold(lot) { const Pl = CBZ.cityPlots; return !!(Pl && Pl.isSold && Pl.isSold(lot)); }
  function armPenthouse(lot) {
    const h = homeOf(lot);
    if (!h || !(h.id === "penthouse" || h.flagship === true)) return;
    g.cityOwnsPenthouse = true; g.cityOwnsHeli = true;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  function buy(lot, how, by) {
    const z = Z(); if (!z || !lot) return false;
    if (owns(lot)) { if (by) say(by, "That one's already yours."); return false; }
    const price = z.buyPriceForLot ? z.buyPriceForLot(lot) : null;
    const have = (g.cash || 0) + (g.cityBank || 0);
    if (how === "finance") {
      const fq = z.financeQuoteForLot ? z.financeQuoteForLot(lot) : null;
      if (!fq || fq.approved === false) { if (by) say(by, "The bank won't carry it. " + ((fq && fq.reason) || "Not this one.")); return false; }
      if (have < fq.down) { if (by) say(by, "You'd need " + money(fq.down) + " down."); sfx("empty"); return false; }
      z.financeByLot(lot);
    } else if (how === "rent") {
      if (!z.rentByLot) return false;
      z.rentByLot(lot);
      if (renting(lot)) { g.cityViewing = null; grantKey(lot); if (by) say(by, "It's yours while the rent comes in. Here's the key."); return true; }
      if (by) say(by, (z.lastMessage && z.lastMessage()) || "Not that one.");
      return false;
    } else {
      if (price == null) return false;
      if (have < price) { if (by) say(by, pick(["You're short. It's " + money(price) + ".", money(price) + ". Come back when you have it, or ask me about the bank."], price)); sfx("empty"); return false; }
      z.buyByLot(lot);
    }
    if (!owns(lot)) { if (by) say(by, (z.lastMessage && z.lastMessage()) || "The sale didn't close."); return false; }
    // IT IS YOURS: the key, the sign, the house you wake up in if you had none
    g.cityViewing = null;
    grantKey(lot);
    armPenthouse(lot);
    spotCache.delete(lot);
    if (CBZ.cityPlots) { try { if (CBZ.cityPlots.sync) CBZ.cityPlots.sync(); if (CBZ.cityPlots.markSold) CBZ.cityPlots.markSold(lot); } catch (e) {} }
    if (by) say(by, pick(["Congratulations. It's yours. Here are the keys.", "Done. The keys. Enjoy the place."], lot.cx));
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (CBZ.interactions && CBZ.interactions.refresh) { try { CBZ.interactions.refresh(); } catch (e) {} }
    return true;
  }

  /* ============================================================
     3. THE AGENT. The keeper of the realty office (a real person: the lot's
        own vendor, city/peds.js), with a book.
     ============================================================ */
  function isAgent(p) { return !!(p && !p.dead && p.vendor && p.vendor.building && p.vendor.building.realtor && !p.vendor.demolished && p.pos); }
  // every home on the market, cheapest first
  function market() {
    const A = arena(), z = Z(); if (!A || !z || !z.canBuyLot) return [];
    const out = [];
    for (const lot of A.homeLots || []) {
      if (!homeOf(lot) || lot.demolished || !z.canBuyLot(lot)) continue;
      const p = z.buyPriceForLot(lot);
      if (p != null) out.push({ lot: lot, price: p });
    }
    out.sort(function (a, b) { return a.price - b.price; });
    return out;
  }
  function whereWords(from, lot) {
    const dx = lot.cx - from.x, dz = lot.cz - from.z, d = Math.hypot(dx, dz);
    const ns = dz < 0 ? "north" : "south", ew = dx < 0 ? "west" : "east";
    const dir = Math.abs(dx) > Math.abs(dz) * 1.8 ? ew : Math.abs(dz) > Math.abs(dx) * 1.8 ? ns : ns + ew;
    const far = d < 120 ? "a short walk " : d < 500 ? "a few blocks " : d < 1500 ? "a drive " : "a long drive ";
    return far + dir;
  }
  function placeWords(lot) {
    if (typeof lot.town === "string" && lot.town) return lot.town;
    const zn = CBZ.cityZoneAt ? CBZ.cityZoneAt(lot.cx, lot.cz) : null;
    return zn && zn.name ? zn.name : "";
  }
  function describe(m, from) {
    const lot = m.lot, h = homeOf(lot), b = lot.building;
    const bits = [];
    const beds = (h && h.beds) || 1;
    bits.push(beds > 1 ? beds + " bedrooms" : "one bedroom");
    if (isHouse(lot)) { bits.push("its own front door"); if (standOf(lot)) bits.push("a drive"); }
    else if (b && b.storeys) bits.push("top of a " + b.storeys + " storey block");
    const place = placeWords(lot), addr = addressOf(lot);
    const what = bits.join(", ") + ", " + whereWords(from, lot);
    return nameOf(lot) + (addr ? ", " + addr : "") + (place && addr.indexOf(place) < 0 ? ", " + place : "") + ". " +
      what.charAt(0).toUpperCase() + what.slice(1) + ". " + money(m.price) + ".";
  }
  function pitchOf(p) { const s = p && p._pitch; return s && T < s.until && s.list.length ? s : null; }
  function tell(p) {
    const s = pitchOf(p); if (!s) return;
    s.until = T + 90;
    say(p, describe(s.list[s.i], p.pos), 5.5);
  }
  function startPitch(p) {
    const list = market();
    if (!list.length) { say(p, "Nothing on the books today. Come back."); return; }
    // open the book at the best house you could close on today
    const have = (g.cash || 0) + (g.cityBank || 0);
    let i = 0;
    for (let k = 0; k < list.length; k++) if (list[k].price <= have) i = k;
    p._own = null;
    p._pitch = { list: list, i: i, until: T + 90 };
    tell(p);
  }
  function turn(p, d) {
    const s = pitchOf(p); if (!s) return;
    // the book is re-read (a house may have sold, a price may have moved)
    const cur = s.list[s.i].lot;
    s.list = market();
    let i = s.list.findIndex(function (m) { return m.lot === cur; });
    if (i < 0) i = Math.min(s.i, s.list.length - 1);
    s.i = Math.max(0, Math.min(s.list.length - 1, i + d));
    if (!s.list.length) { p._pitch = null; say(p, "That was the last of them."); return; }
    tell(p);
  }
  function pitchLot(p) { const s = pitchOf(p); return s ? s.list[s.i].lot : null; }
  function hangarPrice() {
    const home = g.cityHome && homeOf(g.cityHome.lot);
    return (home && home.hangarPrice) || (((C().homes || []).find(function (x) { return x.id === "penthouse"; }) || {}).hangarPrice) || 1200000;
  }
  function buyHangar(p) {
    if (!g.cityOwnsPenthouse || g.cityOwnsHangar) return;
    const cost = hangarPrice();
    if ((g.cash || 0) + (g.cityBank || 0) < cost) { say(p, "The deck hangar is " + money(cost) + ". You're not there yet."); sfx("empty"); return; }
    let owe = cost; const fromCash = Math.min(g.cash || 0, owe); g.cash -= fromCash; owe -= fromCash; if (owe > 0) g.cityBank = (g.cityBank || 0) - owe;
    g.cityOwnsHangar = true;
    CBZ.city.addRespect(40);
    sfx("coin");
    say(p, "The hangar's yours. It's the deck under the tower.");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  // the office is staffed and this file is talking: the counter's text menu
  // stands aside (city/interact.js richModuleLive)
  CBZ.cityRealtyLive = function (lot) { return !!(lot && lot.building && lot.building.realtor && CBZ.interactions); };
  // the shop counter's "Homes" row (city/shops.js): the agent starts talking
  CBZ.cityHomeMenu = function () {
    if (CBZ.cityCloseShop) { try { CBZ.cityCloseShop(); } catch (e) {} }
    const P = CBZ.player; if (!P || !P.pos) return;
    let best = null, bd = 14;
    for (const p of CBZ.cityPeds || []) { if (!isAgent(p)) continue; const d = Math.hypot(p.pos.x - P.pos.x, p.pos.z - P.pos.z); if (d < bd) { bd = d; best = p; } }
    if (best) startPitch(best);
  };

  /* ============================================================
     4. THE HALL OF A HOUSE YOU OWN: the safe, the gun rack, the wardrobe.
        Each stands against a side wall of the hall behind the front door,
        clear of the walkway, at a place read off the door.
     ============================================================ */
  // how far the hall runs sideways from the door's own line before something
  // solid (the building's own colliders: a wall, or furniture already there)
  function wallDist(lot, f, inn, sign) {
    const cols = lot.building && lot.building.colliders;
    if (!cols || !cols.length) return null;
    const px = f.x - f.ox * inn, pz = f.z - f.oz * inn;
    const dx = f.tx * sign, dz = f.tz * sign;
    let best = null;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.y0 != null && c.y0 > 1.3) continue;
      if (c.y1 != null && c.y1 < 0.9) continue;
      let d;
      if (dx !== 0) { if (pz < c.minZ - 0.05 || pz > c.maxZ + 0.05) continue; d = dx > 0 ? c.minX - px : px - c.maxX; }
      else { if (px < c.minX - 0.05 || px > c.maxX + 0.05) continue; d = dz > 0 ? c.minZ - pz : pz - c.maxZ; }
      if (d < 0.6 || d > 4.5) continue;
      if (best == null || d < best) best = d;
    }
    return best;
  }
  const spotCache = new WeakMap();
  function spots(lot) {
    const b0 = lot.building;
    const built = (b0 && b0.colliders && b0.colliders.length ? "b" : "") + (b0 && b0._house ? "h" : "") + (b0 && b0.group ? "g" : "");
    const hit = spotCache.get(lot);
    if (hit && hit.built === built) return hit.s;
    /* THE HOUSE SAYS WHERE (city/house_plan.js): the safe in the bedroom
       closet or the study, the rack on a wall kept clear for it, the wardrobe
       in the main bedroom; in a tower, clear wall in the flat itself, on its
       own floor. Each spot carries its floor height (y). What follows is the
       fallback for a home with no plan yet: the hall behind the door. */
    const HK = CBZ.cityHouse;
    if (HK && HK.spot) {
      let a = null, r = null, w = null;
      try { a = HK.spot(lot, "safe"); r = HK.spot(lot, "rack"); w = HK.spot(lot, "wardrobe"); } catch (e) { a = r = w = null; }
      if (a && r && w) { const sp = { safe: a, rack: r, wardrobe: w }; spotCache.set(lot, { built: built, s: sp }); return sp; }
    }
    const f = front(lot); if (!f) return null;
    const ix = -f.ox, iz = -f.oz;                        // into the house
    const at = function (inn, lat, back) {
      return { x: f.x + ix * inn + f.tx * lat, z: f.z + iz * inn + f.tz * lat, fx: f.tx * back, fz: f.tz * back };
    };
    // each thing's back is on the wall: its place is the wall less its depth
    const side = function (inn, sign, depth) { const d = wallDist(lot, f, inn, sign); return sign * Math.max(0.75, (d != null ? d : 1.6) - depth); };
    // one wall takes the wardrobe (by the door) and the safe (further in); the
    // rack hangs on the other, near the door, clear of whatever the hall
    // already has on its walls deeper in
    const s = { safe: at(2.5, side(2.5, 1, 0.36), 1), rack: at(1.25, side(1.25, -1, 0.31), -1), wardrobe: at(0.95, side(0.95, 1, 0.32), 1) };
    spotCache.set(lot, { built: built, s: s });
    return s;
  }
  // (fx, fz) points from the room INTO the wall the thing has its back to
  CBZ.cityHomeSpot = function (lot, what) { const s = lot ? spots(lot) : null; return s ? s[what || "safe"] : null; };

  function stashes() { return g.cityHomeStash || (g.cityHomeStash = {}); }
  function stashOf(lot) { const S = stashes(), k = lotKey(lot); return S[k] || (S[k] = { cash: 0, guns: [] }); }
  function ownedHomes() {
    try { return CBZ.cityRealtyOwnedHomes ? (CBZ.cityRealtyOwnedHomes() || []) : []; } catch (e) { return []; }
  }
  // the owned home you are in or at: measured off its walls (a flat's things
  // are up in the flat, not by the street door)
  function homeNear(x, z, r) {
    let best = null, bd = r * r;
    for (const h of ownedHomes()) {
      const lot = h.lot; if (!lot || lot.demolished) continue;
      const q = rectOf(lot);
      const dx = Math.max(0, Math.abs(x - q.cx) - q.hw), dz = Math.max(0, Math.abs(z - q.cz) - q.hd);
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = lot; }
    }
    return best;
  }
  function spotY(p) { return p && p.y != null ? p.y : floorY(p.x, p.z); }

  // ---- what you see: built for the one owned house you are at ----
  const cm = function (c) { return CBZ.cmat ? CBZ.cmat(c) : new THREE.MeshLambertMaterial({ color: c }); };
  const box = function (w, h, d) { return CBZ.boxGeom ? CBZ.boxGeom(w, h, d) : new THREE.BoxGeometry(w, h, d); };
  let vis = null;            // { lot, grp, rack, sig }
  function gunMesh(id) {
    let m = null;
    try { m = CBZ.buildActorWeapon ? CBZ.buildActorWeapon(id) : null; } catch (e) { m = null; }
    if (!m) { m = new THREE.Mesh(box(0.5, 0.1, 0.05), cm(0x24272c)); return m; }
    const sc = (CBZ.weaponWorldScale && CBZ.weaponWorldScale((m.userData && m.userData.weaponId) || id)) || 1;
    m.scale.setScalar(sc);
    return m;
  }
  function fillRack(lot) {
    if (!vis || !vis.rack) return;
    const R = vis.rack;
    for (let i = R.children.length - 1; i >= 0; i--) if (R.children[i].userData && R.children[i].userData.gun) R.remove(R.children[i]);
    const guns = stashOf(lot).guns;
    for (let i = 0; i < guns.length && i < 6; i++) {
      const m = gunMesh(guns[i]);
      m.userData.gun = true;
      // two columns of three pegs; a gun lies along the board, muzzle to one side
      const col = i % 2, row = (i / 2) | 0;
      m.position.set(-0.36 + col * 0.72, 1.55 - row * 0.34, 0.07);
      m.rotation.set(0, Math.PI / 2, 0);
      R.add(m);
    }
    vis.sig = guns.join(",");
  }
  function buildVis(lot) {
    dropVis();
    const A = arena(), s = spots(lot); if (!A || !A.root || !s) return;
    const grp = new THREE.Group(); grp.userData.transient = true;
    const wood = cm(0x6b4a2e), woodD = cm(0x4a3220), steel = cm(0x2b2f35), brass = cm(0xb89a4a);
    // EACH IS SOLID. A thing with its back on a wall: `wide` along the wall,
    // from the wall `d0`..`d1` out into the room (its place is 0.31 m off it)
    const cols = [];
    const solid = function (sp, wide, d0, d1, ya, yb) {
      const cx = sp.x + sp.fx * (0.31 - (d0 + d1) / 2), cz = sp.z + sp.fz * (0.31 - (d0 + d1) / 2);
      const hx = Math.abs(sp.fx) > 0.5 ? (d1 - d0) / 2 : wide / 2, hz = Math.abs(sp.fx) > 0.5 ? wide / 2 : (d1 - d0) / 2;
      const c = { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz, y0: ya, y1: yb, ref: grp, noStep: true, homeFixture: true };
      if (CBZ.colliderAdd) CBZ.colliderAdd(c); else if (CBZ.colliders) { CBZ.colliders.push(c); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
      cols.push(c);
    };
    const yR = spotY(s.rack), yS = spotY(s.safe), yW = spotY(s.wardrobe);
    solid(s.rack, 1.56, 0, 0.14, yR + 0.7, yR + 1.95);
    solid(s.safe, 0.64, 0, 0.6, yS, yS + 0.82);
    // the gun rack: a board on the wall with pegs
    const rk = new THREE.Group();
    rk.position.set(s.rack.x - s.rack.fx * 0.02, yR, s.rack.z - s.rack.fz * 0.02);
    rk.rotation.y = Math.atan2(-s.rack.fx, -s.rack.fz);
    const board = new THREE.Mesh(box(1.5, 1.15, 0.04), wood); board.position.set(0, 1.3, -0.28); rk.add(board);
    const rail = new THREE.Mesh(box(1.56, 0.06, 0.07), woodD); rail.position.set(0, 1.9, -0.27); rk.add(rail);
    for (let i = 0; i < 6; i++) {
      const col = i % 2, row = (i / 2) | 0;
      for (const dx of [-0.2, 0.2]) {
        const peg = new THREE.Mesh(box(0.025, 0.025, 0.12), steel);
        peg.position.set(-0.36 + col * 0.72 + dx, 1.5 - row * 0.34, -0.2); rk.add(peg);
      }
    }
    const pegs = new THREE.Group(); pegs.position.set(0, 0, -0.26); rk.add(pegs);
    grp.add(rk);
    // the wardrobe: two doors, a plinth, a rail of hangers showing at the top.
    // (A house with a floor plan has its own in the main bedroom, the
    // fit-out's, solid already: `drawn`. This one is a flat's.)
    if (!s.wardrobe.drawn) {
      const wd = new THREE.Group();
      wd.position.set(s.wardrobe.x + s.wardrobe.fx * 0.02, yW, s.wardrobe.z + s.wardrobe.fz * 0.02);
      wd.rotation.y = Math.atan2(-s.wardrobe.fx, -s.wardrobe.fz);
      const carc = new THREE.Mesh(box(1.1, 2.0, 0.55), woodD); carc.position.set(0, 1.03, -0.02); carc.castShadow = true; wd.add(carc);
      for (const sx of [-1, 1]) {
        const door = new THREE.Mesh(box(0.52, 1.86, 0.03), wood); door.position.set(sx * 0.27, 1.05, 0.27); wd.add(door);
        const knob = new THREE.Mesh(box(0.025, 0.12, 0.03), brass); knob.position.set(sx * 0.05, 1.05, 0.295); wd.add(knob);
      }
      const plinth = new THREE.Mesh(box(1.14, 0.06, 0.58), steel); plinth.position.set(0, 0.03, -0.02); wd.add(plinth);
      grp.add(wd);
      solid(s.wardrobe, 1.12, 0, 0.6, yW, yW + 2.04);
    }
    A.root.add(grp);
    vis = { lot: lot, grp: grp, rack: pegs, sig: null, cols: cols, spots: s };
    fillRack(lot);
  }
  function dropVis() {
    if (vis && vis.grp && vis.grp.parent) vis.grp.parent.remove(vis.grp);
    if (vis && vis.cols) for (const c of vis.cols) {
      if (CBZ.colliderRemove) { try { CBZ.colliderRemove(c); } catch (e) {} }
      else if (CBZ.colliders) { const i = CBZ.colliders.indexOf(c); if (i >= 0) { CBZ.colliders.splice(i, 1); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); } }
    }
    vis = null;
  }

  // ---- what you do ----
  function gunsOn() { return (CBZ.weaponInventory || []).filter(function (id) { return id && id !== "fists" && id !== "fist" && id !== "hands"; }); }
  function gunName(id) {
    try { const W = CBZ.WEAPONS || CBZ.weaponData; const w = W && W[id]; if (w && w.name) return w.name; } catch (e) {}
    return String(id || "gun").replace(/^\w/, function (c) { return c.toUpperCase(); });
  }
  function heldGun() { const id = CBZ.currentWeaponId; return id && gunsOn().indexOf(id) >= 0 && !g.cityHolstered ? id : (gunsOn()[0] || null); }
  function rackPut(lot) {
    const id = heldGun(), S = stashOf(lot);
    if (!id || !CBZ.lockWeapon || S.guns.length >= 6) return false;
    if (!CBZ.lockWeapon(id)) return false;
    S.guns.push(id);
    sfx("pickup"); fillRack(lot); commit();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }
  function rackTake(lot) {
    const S = stashOf(lot);
    if (!S.guns.length || !CBZ.unlockWeapon) return false;
    const id = S.guns.pop();
    CBZ.unlockWeapon(id, { select: true });
    sfx("pickup"); fillRack(lot); commit();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }
  function cashIn(lot) {
    const n = Math.floor(g.cash || 0);
    if (n < 1 || !(CBZ.city && CBZ.city.spend && CBZ.city.spend(n))) return false;
    stashOf(lot).cash += n; sfx("coin"); commit();
    return true;
  }
  function cashOut(lot) {
    const S = stashOf(lot), n = Math.floor(S.cash || 0);
    if (n < 1) return false;
    S.cash = 0;
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(n); else g.cash = (g.cash || 0) + n;
    sfx("coin"); commit();
    return true;
  }
  // the next thing you own (and your gang's colours, when you have a gang)
  function wardrobeNext() {
    if (!CBZ.cityWearOutfit) return false;
    const own = g.cityOutfitsOwned || (g.cityOutfitsOwned = { street: true });
    // what you take off hangs in the wardrobe: the clothes on your back are yours
    if (g.cityOutfitId && g.cityOutfitId.indexOf("gang:") !== 0 && !own[g.cityOutfitId]) own[g.cityOutfitId] = true;
    const ids = Object.keys(own).filter(function (k) { return own[k]; });
    if (ids.indexOf("street") < 0) ids.unshift("street");
    if (g.playerGang && g.playerGang.founded && ids.indexOf("gang:player") < 0) ids.push("gang:player");
    if (ids.length < 2) return false;
    const cur = ids.indexOf(g.cityOutfitId || "street");
    for (let k = 1; k <= ids.length; k++) {
      const id = ids[(cur + k + ids.length) % ids.length];
      let ok = false; try { ok = CBZ.cityWearOutfit(id, { silent: true }); } catch (e) { ok = false; }
      if (ok) { sfx("pickup"); return true; }
    }
    return false;
  }
  function wardrobeHas() {
    const own = g.cityOutfitsOwned || {};
    let n = 0; for (const k in own) if (own[k]) n++;
    if (!own.street) n++;
    if (g.cityOutfitId && g.cityOutfitId.indexOf("gang:") !== 0 && !own[g.cityOutfitId]) n++;
    if (g.playerGang && g.playerGang.founded && !own["gang:player"]) n++;
    return n >= 2;
  }
  function commit() { if (CBZ.cityWorldCommit) { try { CBZ.cityWorldCommit(); } catch (e) {} } }

  /* ============================================================
     5. THE NIGHT. city/propuse.js lies you down and skips to morning; in a
        bed you own it calls this. Full health, fed, rested, wounds dressed,
        the heat bled off you while you were off the street, and this is the
        house you wake up in from now on.
     ============================================================ */
  CBZ.cityHomeSlept = function (lot) {
    const P = CBZ.player; if (!P || !lot) return false;
    const stars = g.wanted | 0;
    P.hp = P.maxHp || 100;
    P.stamina = P.maxStamina || 100;
    g.hunger = 100; g.tired = 0;
    if (CBZ.cityHealWounds) { try { CBZ.cityHealWounds(); } catch (e) {} }
    if (CBZ.city && CBZ.city.addHeat && (g.heat || 0) > 0) {
      const before = g.heat || 0;
      const sh = (CBZ.CITY && CBZ.CITY.starHeat) || [];
      const cut = stars <= 2 ? before : Math.max(before - (sh[Math.max(0, stars - 2)] || 0), before * 0.45);
      CBZ.city.addHeat(-cut);
    }
    const z = Z();
    if (homeOf(lot) && (!g.cityHome || g.cityHome.lot !== lot) && z && z.setHomeByLot && owns(lot)) z.setHomeByLot(lot);
    const d = lot.building && lot.building.door;
    if (d) g.citySpawnPoint = { x: d.x, z: d.z };
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    commit();
    return true;
  };

  /* ============================================================
     6. THE CAR IN THE DRIVE. A car you own, left standing on the driveway of
        a house you own, belongs there: g.cityGarage carries it (model, paint,
        every mod, and which house) and it is put back on the drive when you
        come home to an empty one, today or after a reload. Drive it off and
        the record goes with it.
     ============================================================ */
  // where a car stands at this house: the lot's own driveway
  function standOf(lot) {
    const b = lot && lot.building; if (!b) return null;
    if (b.garage && isFinite(b.garage.x)) return { x: b.garage.x, z: b.garage.z, heading: b.garage.heading || 0 };
    const f = front(lot);
    if (!f || !isFinite(b.driveAt)) return null;
    // the drive's centre along the street (city/house_yard.js plan), 4 m out
    // from the garage wing's face, nose to the garage
    const lat = (lot.cx + f.tx * b.driveAt - f.x) * f.tx + (lot.cz + f.tz * b.driveAt - f.z) * f.tz;
    return { x: f.x + f.tx * lat + f.ox * 4.2, z: f.z + f.tz * lat + f.oz * 4.2, heading: Math.atan2(-f.ox, -f.oz) };
  }
  function carCap(lot) {
    const h = homeOf(lot); if (!standOf(lot)) return 0;
    const gs = lot.building.garage && lot.building.garage.stands;
    return gs && gs.length ? Math.min(2, gs.length) : Math.max(1, Math.min(2, (h && h.garage) | 0));
  }
  function standN(lot, n) {
    // a lot that says where each of its cars stands (city/house_yard.js: side
    // by side before a double garage, nose to tail on a single drive)
    const gs = lot && lot.building && lot.building.garage && lot.building.garage.stands;
    if (gs && gs[n] && isFinite(gs[n].x)) return { x: gs[n].x, z: gs[n].z, heading: gs[n].heading || 0 };
    const s = standOf(lot); if (!s || !n) return s;
    // the second car stands behind the first, toward the street
    return { x: s.x - Math.sin(s.heading) * 5.6 * n, z: s.z - Math.cos(s.heading) * 5.6 * n, heading: s.heading };
  }
  const live = new Map();                    // garage record -> the car in the world
  function garage() { return g.cityGarage || (g.cityGarage = []); }
  function carsOf(lot) { const k = lotKey(lot); return garage().filter(function (r) { return r && typeof r === "object" && !r.marine && r.lot === k; }); }
  function recOfCar(car) { for (const [r, c] of live) if (c === car) return r; return null; }
  function carGone(car) { return !car || car.dead || !CBZ.cityCars || CBZ.cityCars.indexOf(car) < 0; }
  function driveTick() {
    const P = CBZ.player; if (!P || !P.pos || !CBZ.cityCars) return;
    const gar = garage();
    // an old save's garage held bare cars with no house: they are at home
    if (g.cityHome && g.cityHome.lot && carCap(g.cityHome.lot)) {
      const hk = lotKey(g.cityHome.lot);
      for (let i = 0; i < gar.length; i++) {
        let r = gar[i];
        if (typeof r === "string") r = gar[i] = { name: r };
        if (r && !r.marine && !r.lot && !r.key && !r.berthId && carsOf(g.cityHome.lot).length < carCap(g.cityHome.lot)) r.lot = hk;
      }
    }
    for (const h of ownedHomes()) {
      const lot = h.lot, cap = lot ? carCap(lot) : 0;
      if (!cap) continue;
      const st = standOf(lot);
      const dP = Math.hypot(st.x - P.pos.x, st.z - P.pos.z);
      if (dP > 170) continue;
      const recs = carsOf(lot);
      // a car that was here and is being driven away is no longer here
      for (const r of recs) {
        const c = live.get(r);
        if (!c) continue;
        if (carGone(c)) { live.delete(r); continue; }                 // the world dropped it: it comes back
        if (Math.hypot(c.pos.x - st.x, c.pos.z - st.z) > 22) {         // you took it
          live.delete(r); const i = gar.indexOf(r); if (i >= 0) gar.splice(i, 1); commit();
        }
      }
      // a car you own, left standing on the drive, stays
      if (carsOf(lot).length < cap) {
        for (const c of CBZ.cityCars) {
          if (!c || c.dead || !(c.owned || c.stolen) || c.ai || !c.pos || c === P._vehicle || c.airClass || recOfCar(c)) continue;
          if (Math.abs(c.v || 0) > 0.4) continue;
          if (Math.hypot(c.pos.x - st.x, c.pos.z - st.z) > 7.5) continue;
          const rec = { name: c.model ? c.model.name : "Sedan", lot: lotKey(lot) };
          if (c.color != null) rec.color = c.color;
          if (c.mods) { try { rec.mods = JSON.parse(JSON.stringify(c.mods)); } catch (e) {} }
          gar.push(rec); live.set(rec, c); commit();
          if (carsOf(lot).length >= cap) break;
        }
      }
      // the drive is empty and the house has a car: it is on the drive
      if (dP < 140) {
        const now = carsOf(lot);
        for (let n = 0; n < now.length; n++) {
          const r = now[n];
          if (live.get(r) || !CBZ.citySpawnOwnedCar) continue;
          const sp = standN(lot, n);
          let blocked = false;
          for (const c of CBZ.cityCars) if (c && !c.dead && c.pos && Math.hypot(c.pos.x - sp.x, c.pos.z - sp.z) < 3.2) { blocked = true; break; }
          if (blocked) continue;
          let car = null;
          try { car = CBZ.citySpawnOwnedCar(sp.x, sp.z, r.name); } catch (e) { car = null; }
          if (!car) continue;
          car.heading = sp.heading; car.v = 0; car.ai = false;
          if (car.pos) { car.pos.x = sp.x; car.pos.z = sp.z; }
          if (car.group) { car.group.position.x = sp.x; car.group.position.z = sp.z; car.group.rotation.y = sp.heading; }
          if (CBZ.cityRestoreCarMods) { try { CBZ.cityRestoreCarMods(car, r); } catch (e) {} }
          live.set(r, car);
        }
      }
    }
  }

  /* ============================================================
     7. THE VERBS (city/interactions.js), wired once the registry is up.
     ============================================================ */
  let wired = false;
  function wire() {
    const I = CBZ.interactions;
    if (wired || !I || !I.registerZone || !I.register) return;
    wired = true;
    // one target object per thing: the card's hysteresis compares identity
    const tgt = { safe: { pos: { x: 0, y: 0.6, z: 0 } }, rack: { pos: { x: 0, y: 1.4, z: 0 } }, wardrobe: { pos: { x: 0, y: 1.2, z: 0 } } };
    const finder = function (what, reach) {
      return function (px, pz, ctx) {
        const lot = homeNear(px, pz, 3); if (!lot) return null;
        const s = spots(lot); if (!s) return null;
        const p = s[what];
        if (Math.hypot(p.x - px, p.z - pz) > reach) return null;
        // on the floor it stands on (the study's safe is not the bedroom's above it)
        const y = spotY(p), py = ctx && ctx.pos ? ctx.pos.y : (CBZ.player && CBZ.player.pos ? CBZ.player.pos.y : y);
        if (py < y - 1.0 || py > y + 1.9) return null;
        const t = tgt[what]; t.x = t.pos.x = p.x; t.z = t.pos.z = p.z; t.lot = lot;
        t.pos.y = y + (what === "safe" ? 0.6 : 1.3);
        return t;
      };
    };
    const bags = function (t) { const CS = CBZ.cashStore, h = CS && CS.homeAt ? CS.homeAt(t.x, t.z) : null; return h ? { h: h, st: CS.homeStored(h.id) } : null; };
    I.registerZone({
      id: "home-safe", kind: "homesafe", radius: 2.4, prio: 9, driving: false, find: finder("safe", 2.4),
      options: [
        { id: "home-safe-in", slot: "e", prio: 5, campaignSafe: true, canShow: function () { return Math.floor(g.cash || 0) >= 1; },
          label: function () { return "Put in " + money(Math.floor(g.cash || 0)); }, onSelect: function (t) { cashIn(t.lot); } },
        { id: "home-safe-out", slot: "e", hold: true, prio: 5, campaignSafe: true, canShow: function (t) { return stashOf(t.lot).cash >= 1; },
          label: function (t) { return "Take out " + money(stashOf(t.lot).cash); }, onSelect: function (t) { cashOut(t.lot); } },
        // the duffels city/cashstore.js keeps beside it
        { id: "home-safe-bag", wheel: true, prio: 3, campaignSafe: true, canShow: function (t) { const b = bags(t); return !!(b && b.st.bags > 0); },
          label: "Take a bag", onSelect: function (t) { const b = bags(t); if (b) CBZ.cashStore.homePull(b.h); } },
      ],
    });
    I.registerZone({
      id: "home-rack", kind: "homerack", radius: 2.2, prio: 9, driving: false, find: finder("rack", 2.2),
      options: [
        { id: "home-rack-put", slot: "e", prio: 5, campaignSafe: true, canShow: function (t) { return !!heldGun() && stashOf(t.lot).guns.length < 6; },
          label: function () { return "Rack the " + gunName(heldGun()); }, onSelect: function (t) { rackPut(t.lot); } },
        { id: "home-rack-take", slot: "e", hold: true, prio: 5, campaignSafe: true, canShow: function (t) { return stashOf(t.lot).guns.length > 0; },
          label: function (t) { const G = stashOf(t.lot).guns; return "Take the " + gunName(G[G.length - 1]); }, onSelect: function (t) { rackTake(t.lot); } },
      ],
    });
    I.registerZone({
      id: "home-wardrobe", kind: "homewardrobe", radius: 2.2, prio: 9, driving: false, find: finder("wardrobe", 2.2),
      options: [
        { id: "home-wardrobe-change", slot: "e", prio: 5, campaignSafe: true, canShow: wardrobeHas, label: "Change", onSelect: function () { wardrobeNext(); } },
      ],
    });
    // a house door that is locked to you
    I.registerZone({
      id: "home-door-locked", kind: "homedoor", radius: 2.4, prio: 7, driving: false,
      find: function (px, pz) {
        const dr = lockedDoorAt(px, pz, 2.4); if (!dr) return null;
        const t = dr._lockTgt || (dr._lockTgt = { pos: { x: 0, y: 1.2, z: 0 } });
        t.x = t.pos.x = dr.wx; t.z = t.pos.z = dr.wz; t.door = dr; t.lot = dr._homeLot;
        return t;
      },
      options: [
        { id: "home-door-try", slot: "e", prio: 4, campaignSafe: true, label: "Try the door", onSelect: function () { sfx("empty"); } },
        { id: "home-door-kick", slot: "e", hold: true, bad: true, prio: 4, label: "Kick it in", onSelect: function (t) { kickIn(t.door); } },
      ],
    });
    if (I.describe) {
      I.describe("homedoor", function (t) { return { label: nameOf(t.lot), note: "locked" }; });
      I.describe("homesafe", function (t) { const c = stashOf(t.lot).cash; return { label: "Safe", note: c >= 1 ? money(c) + " in it" : "empty" }; });
      I.describe("homerack", function (t) { const n = stashOf(t.lot).guns.length; return { label: "Gun rack", note: n ? n + (n === 1 ? " gun" : " guns") : "empty" }; });
      I.describe("homewardrobe", function () { return { label: "Wardrobe", note: "" }; });
    }

    // ---- the agent ----
    const A = function (id, prio, label, canShow, onSelect, wheel) {
      I.register("ped:vendor", { id: id, prio: prio, campaignSafe: true, forceYes: true, wheel: !!wheel, label: label, canShow: canShow, onSelect: onSelect });
    };
    A("home-ask", 70, "Ask about homes", function (p) { return isAgent(p) && !pitchOf(p); }, startPitch);
    A("home-see", 74, "See it", function (p) { const l = isAgent(p) && pitchLot(p); return !!l && !hasKey(l); },
      function (p) {
        const l = pitchLot(p);
        if (!view(l, p)) return;
        const d = l.building && l.building.door;
        if (d && CBZ.fullMap && CBZ.fullMap.setWaypoint) { try { CBZ.fullMap.setWaypoint(d.x, d.z, nameOf(l)); } catch (e) {} }
      });
    A("home-buy", 73, function (p) { const s = pitchOf(p); return s ? "Buy " + money(s.list[s.i].price) : "Buy"; },
      function (p) { return isAgent(p) && !!pitchOf(p); },
      function (p) { const l = pitchLot(p); if (buy(l, "cash", p)) p._pitch = null; });
    A("home-dearer", 72, "Dearer", function (p) { const s = isAgent(p) && pitchOf(p); return !!s && s.i < s.list.length - 1; }, function (p) { turn(p, 1); });
    A("home-cheaper", 71, "Cheaper", function (p) { const s = isAgent(p) && pitchOf(p); return !!s && s.i > 0; }, function (p) { turn(p, -1); });
    A("home-finance", 30, function (p) { const l = pitchLot(p), z = Z(), fq = l && z && z.financeQuoteForLot ? z.financeQuoteForLot(l) : null; return fq ? "Finance " + money(fq.down) + " down" : "Finance"; },
      function (p) { const l = isAgent(p) && pitchLot(p), z = Z(), fq = l && z && z.financeQuoteForLot ? z.financeQuoteForLot(l) : null; return !!(fq && fq.approved !== false); },
      function (p) { const l = pitchLot(p); if (buy(l, "finance", p)) p._pitch = null; }, true);
    A("home-rent", 29, function (p) { const l = pitchLot(p), z = Z(), r = l && z && z.rentEstimateForLot ? z.rentEstimateForLot(l) : null; return r != null ? "Rent " + money(r) : "Rent"; },
      function (p) { const l = isAgent(p) && pitchLot(p), z = Z(); return !!(l && z && z.rentEstimateForLot && z.rentEstimateForLot(l) != null); },
      function (p) { const l = pitchLot(p); if (buy(l, "rent", p)) p._pitch = null; }, true);
    A("home-hangar", 28, function () { return "Buy the hangar " + money(hangarPrice()); },
      function (p) { return isAgent(p) && !!g.cityOwnsPenthouse && !g.cityOwnsHangar; }, buyHangar, true);

    // ---- what you own: he sells it for you, he takes what the bank is owed ----
    A("own-ask", 69, "Ask about my properties", function (p) { return isAgent(p) && !ownPitch(p) && ownedList().length > 0; }, startOwn);
    A("own-sell", 73, function (p) { const m = ownCur(p); return m ? (ownPitch(p).sure === m.lot ? "Yes, sell it for " : "Sell it for ") + money(m.price) : "Sell it"; },
      function (p) { return isAgent(p) && !!ownCur(p) && ownCur(p).price != null; }, sellOwn);
    A("own-payoff", 72, function (p) { const m = ownCur(p); return "Pay off the bank " + money(m ? m.owe : 0); },
      function (p) { const m = isAgent(p) && ownCur(p); return !!m && m.owe > 0 && (g.cash || 0) + (g.cityBank || 0) >= m.owe; }, function (p) { payOwn(p, 1); });
    A("own-payhalf", 71, function (p) { const m = ownCur(p); return "Pay the bank " + money(m ? Math.round(m.owe * 0.5) : 0); },
      function (p) { const m = isAgent(p) && ownCur(p); return !!m && m.owe > 0 && (g.cash || 0) + (g.cityBank || 0) >= Math.round(m.owe * 0.5); }, function (p) { payOwn(p, 0.5); });
    A("own-next", 70, "The next one", function (p) { const s = isAgent(p) && ownPitch(p); return !!s && s.list.length > 1; }, function (p) { const s = ownPitch(p); s.i = (s.i + 1) % s.list.length; s.sure = null; tellOwn(p); });
    // ---- the bank's own counter takes a mortgage payment too ----
    const isBanker = function (p) {
      const v = p && !p.dead && p.vendor; const b = v && v.building;
      return !!(b && !v.demolished && (v.kind === "bank" || (b.shop && b.shop.kind === "bank")));
    };
    const owedMost = function () { let best = null; for (const m of ownedList()) if (m.owe > 0 && (!best || m.owe > best.owe)) best = m; return best; };
    const payBank = function (p, frac) {
      const m = owedMost(), z = Z(); if (!m || !z || !z.payMortgageByLot) return;
      const msg = z.payMortgageByLot(m.lot, frac);
      sfx("coin"); say(p, typeof msg === "string" && msg ? msg : "That's come off what you owe.");
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    };
    A("bank-mortgage-off", 40, function () { const m = owedMost(); return m ? "Pay off " + nameOf(m.lot) + " " + money(m.owe) : "Pay off the mortgage"; },
      function (p) { const m = isBanker(p) && owedMost(); return !!m && (g.cash || 0) + (g.cityBank || 0) >= m.owe; }, function (p) { payBank(p, 1); }, true);
    A("bank-mortgage-half", 39, function () { const m = owedMost(); return m ? "Pay " + money(Math.round(m.owe * 0.5)) + " off " + nameOf(m.lot) : "Pay the mortgage"; },
      function (p) { const m = isBanker(p) && owedMost(); return !!m && (g.cash || 0) + (g.cityBank || 0) >= Math.round(m.owe * 0.5); }, function (p) { payBank(p, 0.5); }, true);
  }

  /* ---- WHAT YOU OWN, AT THE AGENT -------------------------------------------
     The same book, your pages: he tells you one of your properties (what he
     can get for it today, what the bank is owed on it) and sells it on your
     word, said twice. (It used to be the Sell row of a panel on the lot's
     address post.) */
  function ownedList() {
    const z = Z(); if (!z || !z.ownedLots) return [];
    const out = [];
    let L = []; try { L = z.ownedLots() || []; } catch (e) { L = []; }
    for (const lot of L) {
      if (!lot) continue;
      const mt = z.mortgageForLot ? z.mortgageForLot(lot) : null;
      out.push({ lot: lot, price: z.sellPriceForLot ? z.sellPriceForLot(lot) : null, owe: mt && mt.balance > 0 ? Math.round(mt.balance) : 0 });
    }
    return out;
  }
  function ownPitch(p) { const s = p && p._own; return s && T < s.until && s.list.length ? s : null; }
  function ownCur(p) { const s = ownPitch(p); return s ? s.list[Math.min(s.i, s.list.length - 1)] : null; }
  function tellOwn(p) {
    const s = ownPitch(p), m = ownCur(p); if (!s || !m) return;
    s.until = T + 90;
    const addr = addressOf(m.lot);
    say(p, nameOf(m.lot) + (addr ? ", " + addr : "") + ". " + (m.price != null ? "I can get you " + money(m.price) + " for it today." : "") +
      (m.owe > 0 ? " The bank is owed " + money(m.owe) + " on it." : ""), 5.5);
  }
  function startOwn(p) {
    const list = ownedList();
    if (!list.length) { say(p, "You don't own anything I can sell."); return; }
    p._pitch = null;
    p._own = { list: list, i: 0, until: T + 90, sure: null };
    tellOwn(p);
  }
  function sellOwn(p) {
    const s = ownPitch(p), m = ownCur(p), z = Z(); if (!s || !m || !z || !z.sellByLot) return;
    if (s.sure !== m.lot) { s.sure = m.lot; s.until = T + 30; say(p, "Sell " + nameOf(m.lot) + " for " + money(m.price) + "? Say the word and it's done."); return; }
    const lot = m.lot;
    let ok = false; try { ok = !!z.sellByLot(lot); } catch (e) { ok = false; }
    if (!ok) { say(p, (z.lastMessage && z.lastMessage()) || "I can't sell that one."); s.sure = null; return; }
    sfx("coin");
    if (isHouse(lot)) dropKey(lot);
    if (CBZ.cityPlots) { try { if (CBZ.cityPlots.sync) CBZ.cityPlots.sync(); if (CBZ.cityPlots.markSold) CBZ.cityPlots.markSold(lot); } catch (e) {} }
    say(p, pick(["Sold. The money's yours.", "Done. It's off your hands, the money's in."], lot.cx));
    s.list = ownedList(); s.i = 0; s.sure = null;
    if (!s.list.length) p._own = null;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    commit();
  }
  function payOwn(p, frac) {
    const m = ownCur(p), z = Z(); if (!m || !z || !z.payMortgageByLot) return;
    const msg = z.payMortgageByLot(m.lot, frac);
    sfx("coin");
    say(p, typeof msg === "string" && msg ? msg : "That's come off what you owe.");
    const s = ownPitch(p); if (s) { s.list = ownedList(); s.i = Math.min(s.i, Math.max(0, s.list.length - 1)); }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  /* ============================================================
     8. THE TICK
     ============================================================ */
  let slow = 0, lockT = 0;
  CBZ.onUpdate(40.8, function (dt) {
    if (!inCity()) { if (vis) dropVis(); return; }
    T += dt || 0;
    wire();
    lockT -= dt || 0;
    if (lockT <= 0) { lockT = 0.7; lockTick(); }
    slow -= dt || 0;
    if (slow > 0) return;
    slow = 1;
    const P = CBZ.player;
    if (!P || !P.pos || g.state !== "playing") return;
    // the hall of the owned house you are at
    const lot = homeNear(P.pos.x, P.pos.z, 45);
    if (lot) {
      if (!vis || vis.lot !== lot || vis.grp.parent !== (arena() && arena().root) || vis.spots !== spots(lot)) buildVis(lot);
      else if (vis.sig !== stashOf(lot).guns.join(",")) fillRack(lot);
    } else if (vis) dropVis();
    driveTick();
  });

  // the property-empire economy tick (zillow owns the portfolio data): rent
  // in, tax and mortgage out, on the engine clock
  CBZ.onUpdate(38.4, function (dt) {
    if (g.mode !== "city") return;
    if (CBZ.cityZillowTick) CBZ.cityZillowTick(dt);
  });

  /* ============================================================
     9. THE SAVE SEAM (city/worldstate.js calls these three; unchanged
        names). The descriptor it stores now carries the safes and racks too.
     ============================================================ */
  CBZ.cityHomeSerialize = function () {
    const out = {};
    if (g.cityHome && g.cityHome.lot) {
      const lot = g.cityHome.lot, door = lot.building && lot.building.door;
      out.tier = g.cityHome.tier; out.id = g.cityHome.id; out.name = g.cityHome.name;
      out.doorX = door ? door.x : null; out.doorZ = door ? door.z : null;
      out.home = true;
    }
    const S = g.cityHomeStash || {};
    const st = {};
    let any = false;
    for (const k in S) { const s = S[k]; if (s && ((s.cash | 0) > 0 || (s.guns && s.guns.length))) { st[k] = { cash: Math.round(s.cash || 0), guns: (s.guns || []).slice(0, 6) }; any = true; } }
    if (any) out.stash = st;
    return (out.home || any) ? out : null;
  };
  CBZ.cityHomeRestore = function (desc) {
    if (!desc) return false;
    if (desc.stash && typeof desc.stash === "object") {
      g.cityHomeStash = {};
      for (const k in desc.stash) { const s = desc.stash[k] || {}; g.cityHomeStash[k] = { cash: Math.max(0, +s.cash || 0), guns: Array.isArray(s.guns) ? s.guns.slice(0, 6) : [] }; }
    }
    if (desc.home === false || (desc.home == null && desc.id == null && desc.tier == null)) return true;
    const A = arena(), pool = A && A.homeLots;
    if (!pool || !pool.length) return false;
    let best = null, bestD = Infinity;
    for (const lot of pool) {
      const h = homeOf(lot);
      if (!h || (desc.id != null && h.id !== desc.id)) continue;
      const door = lot.building.door;
      const d = (door && desc.doorX != null) ? Math.hypot(door.x - desc.doorX, door.z - desc.doorZ) : 0;
      if (d < bestD) { bestD = d; best = lot; }
    }
    if (!best) for (const lot of pool) { const h = homeOf(lot); if (h && h.tier === desc.tier) { best = lot; break; } }
    if (!best) return false;
    best.building.home.owned = true;
    g.cityHome = { lot: best, tier: desc.tier, id: desc.id, name: desc.name };
    g.citySpawnPoint = g.citySpawnPoint || { x: best.building.door.x, z: best.building.door.z };
    armPenthouse(best);
    return true;
  };
  CBZ.cityRealEstateReset = function () {
    g.cityHome = null; g.cityRentTier = null; g.cityGarage = []; g.citySpawnPoint = null;
    g.cityOwnsPenthouse = false; g.cityOwnsHeli = false; g.cityOwnsHangar = false;
    g.cityHomeStash = {}; g.cityViewing = null;
    live.clear(); dropVis();
    const A = arena();
    if (A && A.homeLots) for (const l of A.homeLots) if (l.building && l.building.home) l.building.home.owned = false;
    // mode.js's reset() calls this AFTER the ledger was re-pointed at the
    // current character, so re-hydrate from it here (the one place guaranteed
    // to run after both the wipe above and the ledger swap)
    const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
    if (w) {
      g.cityGarage = Array.isArray(w.cityGarage) ? w.cityGarage.slice() : [];
      g.cityOwnsPenthouse = !!w.cityOwnsPenthouse;
      g.cityOwnsHeli = !!w.cityOwnsHeli;
      g.cityOwnsHangar = !!w.cityOwnsHangar;
      if (w.cityHome) CBZ.cityHomeRestore(w.cityHome);
    }
  };

  CBZ.cityHome = {
    isHouse: isHouse, hasKey: hasKey, view: view, buy: buy, sold: sold,
    spot: function (lot, what) { return CBZ.cityHomeSpot(lot, what); },
    stash: function (lot) { return stashOf(lot); },
    stand: standOf,
    cars: function (lot) { return carsOf(lot).map(function (r) { return { name: r.name, here: !!live.get(r) }; }); },
    market: market,
    // what the agent would say about a house from where you stand (a read)
    describe: function (lot, from) { const z = Z(); return describe({ lot: lot, price: z.buyPriceForLot(lot) }, from || CBZ.player.pos); },
  };
})();
